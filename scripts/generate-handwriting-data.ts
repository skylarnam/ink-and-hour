import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { createHash } from 'node:crypto';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';

const PRINTABLE_ASCII = Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33));
const TARGET_X_HEIGHT = 10.5;
const BASELINE = 16.5;
const ADVANCE_MULTIPLIER = 1.68;
const PREVIEW = process.argv.includes('--preview');
const fallbackGlyphs: string[] = [];
const allowedPunctuationFallbacks = new Set(['coming-soon:.', 'coming-soon::', 'schoolbell:.']);

interface Point {
  x: number;
  y: number;
}

interface StrokeGlyph {
  d: string;
  o: number;
}

interface GeneratedFontData {
  name: string;
  sourceFamily: string;
  space: number;
  scale: number;
  lineHeight: number;
  terminalPadding: number;
  chars: StrokeGlyph[];
}

function parseFont(path: string) {
  const bytes = readFileSync(path);
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function glyphBox(font: opentype.Font, character: string) {
  const glyph = font.charToGlyph(character);
  const { xMin, yMin, xMax, yMax } = glyph.getMetrics();
  return { glyph, xMin, yMin, xMax, yMax, width: xMax - xMin, height: yMax - yMin };
}

function measureReferenceHeight(font: opentype.Font): number {
  for (const character of ['x', 'n', 'a']) {
    const { height } = glyphBox(font, character);
    if (Number.isFinite(height) && height > 0) return height;
  }
  return font.unitsPerEm * 0.5;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function key(x: number, y: number): number {
  return (y << 16) | x;
}

function decode(value: number): Point {
  return { x: value & 0xffff, y: value >> 16 };
}

function buildBitmap(
  font: opentype.Font,
  character: string,
  renderScale: number,
): {
  bitmap: Uint8Array;
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  const { glyph, xMin, yMin, xMax, yMax, width, height } = glyphBox(font, character);
  const padding = Math.max(18, Math.ceil(Math.max(width, height) * renderScale * 0.1));
  const canvasWidth = Math.max(8, Math.ceil(width * renderScale + padding * 2));
  const canvasHeight = Math.max(8, Math.ceil(height * renderScale + padding * 2));
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#000';
  const xOffset = padding - xMin * renderScale;
  const yOffset = padding + yMax * renderScale;
  glyph.getPath(xOffset, yOffset, font.unitsPerEm * renderScale).draw(ctx);
  const alpha = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;
  const bitmap = new Uint8Array(canvasWidth * canvasHeight);
  for (let index = 0; index < bitmap.length; index++) {
    bitmap[index] = alpha[index * 4 + 3] > 160 ? 1 : 0;
  }
  return { bitmap, width: canvasWidth, height: canvasHeight, xOffset, yOffset, xMin, xMax, yMin, yMax };
}

function transitions(pixels: Uint8Array, width: number, x: number, y: number): number {
  const offsets = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1],
  ];
  let count = 0;
  for (let index = 0; index < offsets.length - 1; index++) {
    const [ax, ay] = offsets[index];
    const [bx, by] = offsets[index + 1];
    const a = pixels[(y + ay) * width + x + ax];
    const b = pixels[(y + by) * width + x + bx];
    if (a === 0 && b === 1) count++;
  }
  return count;
}

function neighbors(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (dx !== 0 && dy !== 0 && pixels[y * width + nx] && pixels[ny * width + x]) continue;
      if (pixels[ny * width + nx]) result.push(key(nx, ny));
    }
  }
  return result;
}

function thin(bitmap: Uint8Array, width: number, height: number): Uint8Array {
  const pixels = bitmap.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (const phase of [0, 1] as const) {
      const remove: number[] = [];
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const index = y * width + x;
          if (!pixels[index]) continue;
          const p2 = pixels[(y - 1) * width + x];
          const p4 = pixels[y * width + x + 1];
          const p6 = pixels[(y + 1) * width + x];
          const p8 = pixels[y * width + x - 1];
          const count = p2 + p4 + p6 + p8
            + pixels[(y - 1) * width + x + 1]
            + pixels[(y + 1) * width + x + 1]
            + pixels[(y + 1) * width + x - 1]
            + pixels[(y - 1) * width + x - 1];
          if (count < 2 || count > 6 || transitions(pixels, width, x, y) !== 1) continue;
          if (phase === 0) {
            if (p2 && p4 && p6) continue;
            if (p4 && p6 && p8) continue;
          } else {
            if (p2 && p4 && p8) continue;
            if (p2 && p6 && p8) continue;
          }
          remove.push(index);
        }
      }
      if (remove.length) {
        changed = true;
        for (const index of remove) pixels[index] = 0;
      }
    }
  }
  return pixels;
}

function connectedComponents(bitmap: Uint8Array, width: number, height: number): number[][] {
  const seen = new Uint8Array(bitmap.length);
  const components: number[][] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const start = y * width + x;
      if (!bitmap[start] || seen[start]) continue;
      const queue = [start];
      const component: number[] = [];
      seen[start] = 1;
      while (queue.length) {
        const index = queue.pop()!;
        component.push(index);
        const px = index % width;
        const py = Math.floor(index / width);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = px + dx;
            const ny = py + dy;
            const next = ny * width + nx;
            if (!bitmap[next] || seen[next]) continue;
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
      components.push(component);
    }
  }
  return components;
}

function prune(bitmap: Uint8Array, width: number, height: number, spurLimit: number): Uint8Array {
  const pixels = bitmap.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of connectedComponents(pixels, width, height)) {
      if (component.length <= 2) continue;
      const nodeNeighbors = new Map<number, number[]>();
      for (const index of component) {
        const x = index % width;
        const y = Math.floor(index / width);
        nodeNeighbors.set(index, neighbors(pixels, width, x, y).map((value) => {
          const { x: nx, y: ny } = decode(value);
          return ny * width + nx;
        }));
      }
      for (const start of component) {
        const degree = nodeNeighbors.get(start)!.length;
        if (degree !== 1) continue;
        const trail = [start];
        let previous = -1;
        let current = start;
        while (trail.length <= spurLimit + 1) {
          const options = nodeNeighbors.get(current)!.filter((value) => value !== previous);
          if (!options.length) break;
          previous = current;
          current = options[0];
          trail.push(current);
          const nextDegree = nodeNeighbors.get(current)!.length;
          if (nextDegree !== 2) break;
        }
        const endDegree = nodeNeighbors.get(current)!.length;
        if (trail.length - 1 <= spurLimit && endDegree > 2) {
          for (const index of trail.slice(0, -1)) pixels[index] = 0;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return pixels;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const sqTolerance = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDistance = 0;
    let split = -1;
    const a = points[start];
    const b = points[end];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const length = vx * vx + vy * vy || 1;
    for (let index = start + 1; index < end; index++) {
      const p = points[index];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / length));
      const px = a.x + vx * t;
      const py = a.y + vy * t;
      const distance = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
      if (distance > maxDistance) {
        maxDistance = distance;
        split = index;
      }
    }
    if (maxDistance > sqTolerance && split !== -1) {
      keep[split] = 1;
      stack.push([start, split], [split, end]);
    }
  }
  return points.filter((_, index) => keep[index]).map((point) => ({ ...point }));
}

interface Segment {
  start: number;
  end: number;
  points: number[];
  length: number;
}

function nodeOrder(a: number, b: number): number {
  const left = decode(a);
  const right = decode(b);
  return left.y - right.y || left.x - right.x;
}

function pathLength(points: number[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const a = decode(points[index - 1]);
    const b = decode(points[index]);
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function buildGraph(bitmap: Uint8Array, width: number, height: number): Map<number, number[]> {
  const graph = new Map<number, number[]>();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!bitmap[y * width + x]) continue;
      graph.set(key(x, y), neighbors(bitmap, width, x, y));
    }
  }
  return graph;
}

function extractSegments(nodes: number[], graph: Map<number, number[]>): Segment[] {
  const nodeSet = new Set(nodes);
  const keys = new Set(nodes.filter((node) => (graph.get(node) ?? []).length !== 2));
  const visited = new Set<string>();
  const segments: Segment[] = [];
  const outgoing = (node: number) => (graph.get(node) ?? []).filter((neighbor) => nodeSet.has(neighbor));

  if (!keys.size && nodes.length === 1) {
    return [{ start: nodes[0], end: nodes[0], points: [nodes[0], nodes[0]], length: 0.5 }];
  }

  const walk = (start: number, first: number): Segment => {
    const points = [start, first];
    visited.add(edgeKey(start, first));
    let previous = start;
    let current = first;
    while (!keys.has(current)) {
      const options = outgoing(current).filter((neighbor) => neighbor !== previous && !visited.has(edgeKey(current, neighbor)));
      if (!options.length) break;
      const next = options[0];
      points.push(next);
      visited.add(edgeKey(current, next));
      previous = current;
      current = next;
    }
    return { start, end: current, points, length: pathLength(points) };
  };

  for (const start of [...keys].sort(nodeOrder)) {
    for (const neighbor of outgoing(start).sort(nodeOrder)) {
      if (visited.has(edgeKey(start, neighbor))) continue;
      segments.push(walk(start, neighbor));
    }
  }

  for (const start of nodes.sort(nodeOrder)) {
    for (const neighbor of outgoing(start).sort(nodeOrder)) {
      if (visited.has(edgeKey(start, neighbor))) continue;
      const points = [start, neighbor];
      visited.add(edgeKey(start, neighbor));
      let previous = start;
      let current = neighbor;
      while (current !== start) {
        const options = outgoing(current).filter((candidate) => candidate !== previous && !visited.has(edgeKey(current, candidate)));
        if (!options.length) break;
        const next = options.sort(nodeOrder)[0];
        points.push(next);
        visited.add(edgeKey(current, next));
        previous = current;
        current = next;
      }
      if (points[points.length - 1] !== start) points.push(start);
      segments.push({ start, end: start, points, length: pathLength(points) });
    }
  }

  return segments;
}

function pruneSegments(segments: Segment[]): Segment[] {
  let current = segments;
  while (true) {
    const degree = new Map<number, number>();
    for (const segment of current) {
      degree.set(segment.start, (degree.get(segment.start) ?? 0) + 1);
      degree.set(segment.end, (degree.get(segment.end) ?? 0) + 1);
    }
    const next = current.filter((segment) => {
      if (segment.length >= 7) return true;
      const startDegree = degree.get(segment.start) ?? 0;
      const endDegree = degree.get(segment.end) ?? 0;
      return !((startDegree > 2 && endDegree <= 1) || (endDegree > 2 && startDegree <= 1));
    });
    if (next.length === current.length) return current;
    current = next;
  }
}

function edgeDirection(points: Point[], reverse = false): Point {
  if (points.length < 2) return { x: 1, y: 0 };
  const ordered = reverse ? points.slice().reverse() : points;
  for (let index = 1; index < ordered.length; index++) {
    const dx = ordered[index].x - ordered[index - 1].x;
    const dy = ordered[index].y - ordered[index - 1].y;
    if (Math.hypot(dx, dy) > 1e-9) return { x: dx, y: dy };
  }
  return { x: 1, y: 0 };
}

function turnScore(previous: Point | null, next: Point): number {
  if (!previous) return 0;
  const dot = previous.x * next.x + previous.y * next.y;
  const length = (Math.hypot(previous.x, previous.y) || 1) * (Math.hypot(next.x, next.y) || 1);
  return Math.acos(Math.max(-1, Math.min(1, dot / length)));
}

function chooseSegment(
  previous: Point | null,
  candidates: Array<{ index: number; reverse: boolean; points: Point[] }>,
): { index: number; reverse: boolean; points: Point[] } {
  return candidates.sort((left, right) => {
    const score = ({ reverse, points }: { reverse: boolean; points: Point[] }): [number, number, number] => {
      const direction = edgeDirection(points, reverse);
      const start = reverse ? points[points.length - 1] : points[0];
      return [turnScore(previous, direction), start.y, start.x];
    };
    const a = score(left);
    const b = score(right);
    for (let index = 0; index < a.length; index++) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return left.index - right.index;
  })[0];
}

function extractTrails(bitmap: Uint8Array, width: number, height: number): Point[][] {
  const graph = buildGraph(bitmap, width, height);
  const components = connectedComponents(bitmap, width, height).map((component) =>
    component.map((index) => key(index % width, Math.floor(index / width))));
  const trails: Point[][] = [];
  for (const component of components.sort((left, right) => nodeOrder(
    left.slice().sort(nodeOrder)[0],
    right.slice().sort(nodeOrder)[0],
  ))) {
    if (component.length === 1) {
      const point = decode(component[0]);
      trails.push([
        { x: point.x + 0.25, y: point.y + 0.5 },
        { x: point.x + 0.75, y: point.y + 0.5 },
      ]);
      continue;
    }
    const segments = pruneSegments(extractSegments(component, graph))
      .filter((segment) => segment.length >= 1 || segment.points.length <= 2)
      .map((segment) => ({
        ...segment,
        points: segment.points.map((node) => decode(node)),
      }));
    const incident = new Map<number, number[]>();
    segments.forEach((segment, index) => {
      incident.set(segment.start, [...(incident.get(segment.start) ?? []), index]);
      incident.set(segment.end, [...(incident.get(segment.end) ?? []), index]);
    });
    const used = new Set<number>();
    while (used.size < segments.length) {
      const remainingNodes = [...incident.keys()].filter((node) =>
        (incident.get(node) ?? []).some((index) => !used.has(index)));
      const odd = remainingNodes.filter((node) =>
        (incident.get(node) ?? []).filter((index) => !used.has(index)).length % 2 === 1);
      const start = (odd.length ? odd : remainingNodes).sort(nodeOrder)[0];
      const path: Point[] = [decode(start)];
      const walk = (current: number, previous: Point | null): void => {
        while (true) {
          const candidates = (incident.get(current) ?? [])
            .filter((index) => !used.has(index))
            .map((index) => {
              const segment = segments[index];
              return {
                index,
                reverse: segment.end === current,
                points: segment.points,
              };
            });
          if (!candidates.length) return;
          const next = chooseSegment(previous, candidates);
          used.add(next.index);
          const points = next.reverse ? next.points.slice().reverse() : next.points;
          path.push(...points.slice(1));
          const other = next.reverse ? segments[next.index].start : segments[next.index].end;
          const outgoing = edgeDirection(points, true);
          walk(other, { x: -outgoing.x, y: -outgoing.y });
          if (used.size === segments.length) return;
          path.push(...points.slice(0, -1).reverse());
        }
      };
      walk(start, null);
      trails.push(path);
    }
  }
  return trails;
}

function fallbackTrails(bitmap: Uint8Array, width: number, height: number): Point[][] {
  return connectedComponents(bitmap, width, height).map((component) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const index of component) {
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const centerX = (minX + maxX + 1) / 2;
    const centerY = (minY + maxY + 1) / 2;
    if (maxX - minX >= maxY - minY) {
      return [
        { x: minX + 0.5, y: centerY },
        { x: maxX + 0.5, y: centerY },
      ];
    }
    return [
      { x: centerX, y: minY + 0.5 },
      { x: centerX, y: maxY + 0.5 },
    ];
  });
}

function centerline(
  font: opentype.Font,
  character: string,
  referenceHeight: number,
  fallbackKey: string,
): { strokes: Point[][]; advance: number } {
  const renderScale = 72 / referenceHeight;
  const { bitmap, width, height, xOffset, yOffset } = buildBitmap(font, character, renderScale);
  const skeleton = prune(thin(bitmap, width, height), width, height, Math.max(3, Math.round(10 * renderScale / 10)));
  const sourceTrails = extractTrails(skeleton, width, height);
  if (!sourceTrails.length) {
    if (!allowedPunctuationFallbacks.has(fallbackKey)) throw new Error(`No reliable centerline for ${fallbackKey}.`);
    fallbackGlyphs.push(fallbackKey);
  }
  const strokes = (sourceTrails.length ? sourceTrails : fallbackTrails(bitmap, width, height)).map((stroke) => {
    const fontPoints = simplify(stroke.map((point) => ({
      x: (point.x + 0.5 - xOffset) / renderScale,
      y: (yOffset - (point.y + 0.5)) / renderScale,
    })), 2.2 / renderScale);
    const normalized = fontPoints.map((point) => ({
      x: round(point.x * (TARGET_X_HEIGHT / referenceHeight)),
      y: round(BASELINE - point.y * (TARGET_X_HEIGHT / referenceHeight)),
    }));
    const compact = normalized.filter((point, index) => index === 0 || pointKey(point) !== pointKey(normalized[index - 1]));
    if (compact.length >= 2) return compact;
    const only = compact[0];
    if (!only) throw new Error(`Empty centerline in ${fallbackKey}.`);
    return [
      { x: round(only.x - 0.25), y: round(only.y) },
      { x: round(only.x + 0.25), y: round(only.y) },
    ];
  }).filter((stroke) => stroke.length >= 2);
  const advance = font.charToGlyph(character).advanceWidth * (TARGET_X_HEIGHT / referenceHeight);
  return { strokes, advance: round(advance) };
}

function pathString(strokes: Point[][]): string {
  return strokes.map((stroke) =>
    `M${stroke[0].x},${stroke[0].y} L${stroke.slice(1).map((point) => `${point.x},${point.y}`).join(' ')}`
  ).join(' ');
}

function fontData(style: (typeof HANDWRITING_STYLES)[number], name: string): GeneratedFontData {
  const font = parseFont(new URL(`../public${style.publicFontPath}`, import.meta.url).pathname);
  const referenceHeight = measureReferenceHeight(font);
  const chars = PRINTABLE_ASCII.map((character) => {
    if (font.charToGlyphIndex(character) === 0) throw new Error(`${style.id} is missing ${JSON.stringify(character)}`);
    const glyph = centerline(font, character, referenceHeight, `${style.id}:${character}`);
    if (!glyph.strokes.length) throw new Error(`${style.id} produced no centerline for ${JSON.stringify(character)}`);
    return { d: pathString(glyph.strokes), o: round(glyph.advance / ADVANCE_MULTIPLIER) };
  });
  const space = round(font.charToGlyph(' ').advanceWidth * (TARGET_X_HEIGHT / referenceHeight));
  const isScript = style.script;
  const generated: GeneratedFontData = {
    name,
    sourceFamily: font.names.fontFamily.en,
    space,
    scale: isScript ? 1.66 : 1.52,
    lineHeight: isScript ? 66 : 59,
    terminalPadding: isScript ? 0.2 : 0.34,
    chars,
  };
  if (PREVIEW) console.log(style.id, generated);
  return generated;
}

const addedStyles = HANDWRITING_STYLES.filter((style) => style.id !== 'correspondence' && style.id !== 'print');
const data = Object.fromEntries(addedStyles.map((style, index) =>
  [style.id, fontData(style, `Ink Stroke Study ${String(index + 1).padStart(2, '0')}`)]));

writeFileSync(
  new URL('../src/writing/handwriting-fonts.json', import.meta.url),
  `${JSON.stringify(data)}\n`,
);

const hash = (path: string): string => createHash('sha256')
  .update(readFileSync(new URL(`../public${path}`, import.meta.url))).digest('hex');
writeFileSync(new URL('../public/data/HANDWRITING-ATTRIBUTION.json', import.meta.url), `${JSON.stringify({
  method: 'Unmodified source fonts; offline inferred centerlines with separately named stroke studies.',
  modified: 'Stroke order is inferred. Short shared branches can be retraced; no glyph outlines are drawn.',
  tinyPunctuationFallbacks: fallbackGlyphs,
  fonts: addedStyles.map((style) => ({
    id: style.id, sourceFamily: style.family, strokeStudy: data[style.id].name,
    source: style.source, license: style.license,
    font: style.publicFontPath, fontSha256: hash(style.publicFontPath),
    licenseFile: style.publicLicensePath, licenseSha256: hash(style.publicLicensePath),
  })),
}, null, 2)}\n`);

console.log(`Wrote ${Object.keys(data).length} inferred handwriting datasets.`);
if (fallbackGlyphs.length) console.log(`Fallback glyphs: ${fallbackGlyphs.join(', ')}`);
