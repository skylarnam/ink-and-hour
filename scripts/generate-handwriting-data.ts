import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { HANDWRITING_IDS, HANDWRITING_STYLES } from '../src/handwriting.ts';
import { parseStrokePath } from '../src/writing/paths.ts';
import {
  buildGraph, connectedComponents, contractMicroJunctions, decode, decodeSegment, decomposeIntoTrails,
  extractSegments, key, neighbors, nodeOrder, pruneSegments,
  type Point,
} from './stroke-routing.ts';

const PRINTABLE_ASCII = Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33));
const TARGET_X_HEIGHT = 10.5;
const BASELINE = 16.5;
const ADVANCE_MULTIPLIER = 1.68;
const RASTER_X_HEIGHT = 144;
const { values: args } = parseArgs({
  options: {
    preview: { type: 'boolean' }, regenerate: { type: 'string', multiple: true },
    'inspect-glyph': { type: 'string' }, 'audit-stroke-flow': { type: 'string' },
  },
});
const regenerate = new Set(args.regenerate ?? []);
const approximations: ComponentApproximation[] = [];
// One entry per connected glyph component that reaches extractTrails, win or lose.
// inkLength is the unique skeleton length (the graph's own segment lengths, each
// counted once); penLength is what the produced trails actually draw. A fixed
// traversal keeps penLength == inkLength (no backtracking); trailCount is the
// number of separate pen-down strokes (lifts) used to cover it.
const strokeFlowAudit: Array<{ inkLength: number; penLength: number; trailCount: number }> = [];

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

interface ComponentApproximation {
  id: string;
  character: string;
  component: number;
  method: string;
  reason: string;
  rasterXHeight: number | null;
  sourceBounds: { xMin: number; yMin: number; xMax: number; yMax: number };
  sourceMetrics?: { underlinePosition: number; underlineThickness: number; advanceWidth: number };
  stroke: string;
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

function buildBitmap(
  font: opentype.Font,
  character: string,
  renderScale: number,
  alphaThreshold = 160,
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
    bitmap[index] = alpha[index * 4 + 3] > alphaThreshold ? 1 : 0;
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
      // A dot has no traversable graph edge. Its source component is handled separately.
      continue;
    }
    // A moderately thick diagonal stroke often thins to a short false-branch cluster
    // rather than a clean 1px medial axis; contracting it first keeps segment
    // extraction (and therefore trail decomposition) working from the one real joint.
    const { nodes: contractedNodes, graph: contractedGraph } = contractMicroJunctions(component, graph);
    const segments = pruneSegments(extractSegments(contractedNodes, contractedGraph))
      .filter((segment) => segment.length >= 1 || segment.points.length <= 2)
      .map(decodeSegment);
    // decomposeIntoTrails covers every segment exactly once, splitting a fork or
    // crossing into separate pen-down strokes instead of drawing one stroke that
    // backtracks over ink it already laid down (see scripts/stroke-routing.ts).
    const componentTrails = decomposeIntoTrails(segments);
    strokeFlowAudit.push({
      inkLength: segments.reduce((sum, segment) => sum + segment.length, 0),
      penLength: componentTrails.reduce((sum, trail) => sum + trail.slice(1)
        .reduce((s, point, index) => s + Math.hypot(point.x - trail[index].x, point.y - trail[index].y), 0), 0),
      trailCount: componentTrails.length,
    });
    trails.push(...componentTrails);
  }
  return trails;
}

function componentGeometry(component: number[], width: number) {
  const points = component.map((index) => ({ x: index % width, y: Math.floor(index / width) }));
  const bounds = points.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y),
    maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= points.length;
  center.y /= points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    xx += (point.x - center.x) ** 2;
    xy += (point.x - center.x) * (point.y - center.y);
    yy += (point.y - center.y) ** 2;
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  return { points, bounds, center, axis: { x: Math.cos(angle), y: Math.sin(angle) } };
}

function isCompactMark(component: number[], width: number, referencePixels: number): boolean {
  const { bounds } = componentGeometry(component, width);
  const spanX = bounds.maxX - bounds.minX + 1;
  const spanY = bounds.maxY - bounds.minY + 1;
  return Math.max(spanX, spanY) <= referencePixels * 0.4
    && Math.min(spanX, spanY) / Math.max(spanX, spanY) >= 0.35
    && component.length / (spanX * spanY) >= 0.42;
}

function sourceMark(component: number[], bitmap: Uint8Array, width: number): Point[] {
  const { points, center, axis } = componentGeometry(component, width);
  const projections = points.map((point) => (point.x - center.x) * axis.x + (point.y - center.y) * axis.y);
  const span = Math.max(...projections) - Math.min(...projections) + 1;
  let halfLength = span * 0.22;
  for (let attempt = 0; attempt < 8; attempt++, halfLength /= 2) {
    const stroke = [-1, 1].map((sign) => ({
      x: center.x + sign * axis.x * halfLength,
      y: center.y + sign * axis.y * halfLength,
    }));
    if (stroke.every((point) => bitmap[Math.floor(point.y + 0.5) * width + Math.floor(point.x + 0.5)])) return stroke;
  }
  throw new Error('A compact source mark has no reliable interior principal-axis stroke.');
}

function sourceBounds(
  component: number[], raster: ReturnType<typeof buildBitmap>, renderScale: number,
): ComponentApproximation['sourceBounds'] {
  const { bounds } = componentGeometry(component, raster.width);
  return {
    xMin: round((bounds.minX - raster.xOffset) / renderScale, 4),
    yMin: round((raster.yOffset - bounds.maxY - 1) / renderScale, 4),
    xMax: round((bounds.maxX + 1 - raster.xOffset) / renderScale, 4),
    yMax: round((raster.yOffset - bounds.minY) / renderScale, 4),
  };
}

function normalizeStroke(
  stroke: Point[], raster: ReturnType<typeof buildBitmap>,
  renderScale: number, referenceHeight: number, legacy = false,
): Point[] {
  const fontPoints = simplify(stroke.map((point) => ({
    x: (point.x + 0.5 - raster.xOffset) / renderScale,
    y: (raster.yOffset - (point.y + 0.5)) / renderScale,
  })), (legacy ? 2.2 : 1.6) / renderScale);
  const normalized = fontPoints.map((point) => ({
    x: round(point.x * (TARGET_X_HEIGHT / referenceHeight), legacy ? 2 : 3),
    y: round(BASELINE - point.y * (TARGET_X_HEIGHT / referenceHeight), legacy ? 2 : 3),
  }));
  return normalized.filter((point, index) => index === 0 || pointKey(point) !== pointKey(normalized[index - 1]));
}

function centerline(
  font: opentype.Font,
  character: string,
  referenceHeight: number,
  id: string,
): { strokes: Point[][]; advance: number } {
  const original = font.charToGlyph(character);
  if (!original.path.commands.length) {
    if (id !== 'italianno' || character !== '_') throw new Error(`Empty source outline for ${id}:${character}.`);
    const { underlinePosition, underlineThickness } = font.tables.post;
    const advanceWidth = original.advanceWidth;
    if (![underlinePosition, underlineThickness, advanceWidth].every(Number.isFinite)
      || underlineThickness <= 0 || advanceWidth <= 0 || underlinePosition >= 0) {
      throw new Error('The original Italianno underline metrics are unusable.');
    }
    const scale = TARGET_X_HEIGHT / referenceHeight;
    const strokes = [[
      { x: 0, y: round(BASELINE - underlinePosition * scale, 3) },
      { x: round(advanceWidth * scale, 3), y: round(BASELINE - underlinePosition * scale, 3) },
    ]];
    approximations.push({
      id, character, component: 0, method: 'source-underline-metrics',
      reason: 'The unmodified Italianno source maps underscore to an empty outline. This one centerline is reconstructed from that glyph’s original advance and the font’s own post-table underline position and thickness, not from an unrelated glyph or arbitrary coordinates.',
      rasterXHeight: null,
      sourceBounds: { xMin: 0, xMax: advanceWidth, yMin: underlinePosition - underlineThickness / 2, yMax: underlinePosition + underlineThickness / 2 },
      sourceMetrics: { underlinePosition, underlineThickness, advanceWidth },
      stroke: pathString(strokes),
    });
    return { strokes, advance: round(advanceWidth * scale) };
  }
  for (const referencePixels of [RASTER_X_HEIGHT, RASTER_X_HEIGHT * 2, RASTER_X_HEIGHT * 4]) {
    const renderScale = referencePixels / referenceHeight;
    const raster = buildBitmap(font, character, renderScale, 128);
    const { bitmap, width, height } = raster;
    const components = connectedComponents(bitmap, width, height);
    const skeleton = prune(thin(bitmap, width, height), width, height, 3);
    const unresolved = components.flatMap((component, index) =>
      component.some((pixel) => skeleton[pixel] && neighbors(skeleton, width, pixel % width, Math.floor(pixel / width)).length)
        ? [] : [{ component, index }]);
    if (!components.length || unresolved.some(({ component }) => !isCompactMark(component, width, referencePixels))) {
      if (args.preview) console.log(`${id}:${character} at ${referencePixels}px`, unresolved.map(({ component }) => ({
        sourcePixels: component.length, skeletonPixels: component.filter((pixel) => skeleton[pixel]).length,
        bounds: componentGeometry(component, width).bounds, compact: isCompactMark(component, width, referencePixels),
      })));
      continue;
    }
    const strokes = extractTrails(skeleton, width, height)
      .map((stroke) => normalizeStroke(stroke, raster, renderScale, referenceHeight));
    const marks = unresolved.map(({ component, index }) => ({
      component, index,
      stroke: normalizeStroke(sourceMark(component, bitmap, width), raster, renderScale, referenceHeight),
    }));
    if ([...strokes, ...marks.map(({ stroke }) => stroke)].some((stroke) => stroke.length < 2)) {
      if (args.preview) console.log(`${id}:${character} at ${referencePixels}px: a trail collapsed during normalization.`);
      continue;
    }
    for (const { component, index, stroke } of marks) {
      strokes.push(stroke);
      approximations.push({
        id, character, component: index, method: 'compact-source-principal-axis',
        reason: 'The filled compact source component thins to a point or disappears. A short interior stroke follows its raster centroid and principal axis; no missing-glyph replacement is used.',
        rasterXHeight: referencePixels, sourceBounds: sourceBounds(component, raster, renderScale),
        stroke: pathString([stroke]),
      });
    }
    if (!strokes.length) continue;
    const advance = font.charToGlyph(character).advanceWidth * (TARGET_X_HEIGHT / referenceHeight);
    return { strokes, advance: round(advance) };
  }
  throw new Error(`No reliable source centerline for ${id}:${character}, even with adaptive high-resolution rasterization.`);
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
    const glyph = centerline(font, character, referenceHeight, style.id);
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
  if (args.preview) console.log(style.id, { name, referenceHeight, space, glyphs: chars.length });
  return generated;
}

function fitNewStudyToLine(style: (typeof HANDWRITING_STYLES)[number], data: GeneratedFontData): void {
  const points = data.chars.flatMap((glyph) => parseStrokePath(glyph.d).flat());
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const naturalScale = style.script ? 1.66 : 1.52;
  // Tall calligraphic swashes must not collide with the following line.
  data.scale = Math.floor(Math.min(naturalScale, (data.lineHeight - 8) / (maxY - minY)) * 10000) / 10000;
}

function auditRetainedMarks(style: (typeof HANDWRITING_STYLES)[number], data: GeneratedFontData): void {
  const font = parseFont(new URL(`../public${style.publicFontPath}`, import.meta.url).pathname);
  const referenceHeight = measureReferenceHeight(font);
  const renderScale = 72 / referenceHeight;
  for (const character of PRINTABLE_ASCII) {
    const raster = buildBitmap(font, character, renderScale);
    const { bitmap, width, height } = raster;
    const skeleton = prune(thin(bitmap, width, height), width, height, Math.max(3, Math.round(renderScale)));
    const sourceComponents = connectedComponents(bitmap, width, height);
    for (const component of connectedComponents(skeleton, width, height)) {
      if (component.length !== 1) continue;
      const index = component[0];
      const x = index % width;
      const y = Math.floor(index / width);
      const stroke = pathString([normalizeStroke([
        { x: x + 0.25, y: y + 0.5 }, { x: x + 0.75, y: y + 0.5 },
      ], raster, renderScale, referenceHeight, true)]);
      if (!data.chars[character.charCodeAt(0) - 33].d.includes(stroke)) {
        throw new Error(`Retained singleton audit disagrees with the preserved data for ${style.id}:${character}.`);
      }
      const sourceIndex = sourceComponents.findIndex((source) => source.includes(index));
      if (sourceIndex < 0) throw new Error(`Retained dot is outside its source in ${style.id}:${character}.`);
      approximations.push({
        id: style.id, character, component: sourceIndex, method: 'preserved-v1-raster-singleton',
        reason: 'Existing selected data is preserved exactly: the original generator represented this source skeleton pixel by a half-pixel mark.',
        rasterXHeight: 72, sourceBounds: sourceBounds(sourceComponents[sourceIndex], raster, renderScale), stroke,
      });
    }
  }
}

const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const hash = (path: string): string => digest(readFileSync(new URL(`../public${path}`, import.meta.url)));
if (args['inspect-glyph']) {
  const [id, character] = args['inspect-glyph'].split(':');
  const style = HANDWRITING_STYLES.find((style) => style.id === id);
  if (!style || style.id === 'correspondence' || !PRINTABLE_ASCII.includes(character)) throw new Error('Inspect an inferred selected glyph with --inspect-glyph id:character.');
  const font = parseFont(new URL(`../public${style.publicFontPath}`, import.meta.url).pathname);
  const glyph = centerline(font, character, measureReferenceHeight(font), style.id);
  console.log(JSON.stringify({ id, character, ...glyph, approximations }, null, 2));
  process.exit(0);
}
if (args['audit-stroke-flow']) {
  // Measures, straight from the source outlines (no committed data involved), how far
  // trail decomposition draws relative to the unique ink for every printable glyph of
  // one style: penLength/inkLength close to 1 means no backtracking. This raw check
  // runs in raster pixel space, before the Douglas-Peucker simplify() and font-unit
  // normalization that also run on --regenerate. It also prints a font-unit finalPenLength
  // and finalTrailCount per character, directly comparable to the same fields printed
  // by an unfixed checkout of this script (e.g. via `git show <old-rev>:scripts/generate-handwriting-data.ts`
  // run the same way), for a true before/after total-drawing-distance comparison.
  const id = args['audit-stroke-flow'];
  const style = HANDWRITING_STYLES.find((style) => style.id === id);
  if (!style || style.id === 'correspondence') throw new Error('Audit an inferred style with --audit-stroke-flow id.');
  const font = parseFont(new URL(`../public${style.publicFontPath}`, import.meta.url).pathname);
  const referenceHeight = measureReferenceHeight(font);
  for (const character of PRINTABLE_ASCII) {
    strokeFlowAudit.length = 0;
    const glyph = centerline(font, character, referenceHeight, style.id);
    let finalPenLength = 0;
    for (const stroke of glyph.strokes) {
      for (let index = 1; index < stroke.length; index++) {
        finalPenLength += Math.hypot(stroke[index].x - stroke[index - 1].x, stroke[index].y - stroke[index - 1].y);
      }
    }
    const inkLength = strokeFlowAudit.reduce((sum, component) => sum + component.inkLength, 0);
    const penLength = strokeFlowAudit.reduce((sum, component) => sum + component.penLength, 0);
    const retrace = inkLength > 0 ? penLength / inkLength - 1 : 0;
    console.log(JSON.stringify({
      id, character, inkLength: round(inkLength), penLength: round(penLength), retrace: round(retrace, 4),
      finalPenLength: round(finalPenLength), finalTrailCount: glyph.strokes.length,
    }));
  }
  process.exit(0);
}
const snapshot = JSON.parse(readFileSync(new URL('../font-review/applied-selection.json', import.meta.url), 'utf8'));
if (JSON.stringify(snapshot.selected) !== JSON.stringify(HANDWRITING_IDS)) {
  throw new Error('Active styles must match the explicitly applied snapshot, not the live review checkboxes.');
}
const addedStyles = HANDWRITING_STYLES.filter((style) => style.id !== 'correspondence');
for (const id of regenerate) {
  if (!addedStyles.some((style) => style.id === id)) throw new Error(`Cannot regenerate unselected or original face: ${id}.`);
}
const existing: Record<string, GeneratedFontData> = JSON.parse(readFileSync(new URL('../src/writing/handwriting-fonts.json', import.meta.url), 'utf8'));
const previousAttribution = JSON.parse(readFileSync(new URL('../public/data/HANDWRITING-ATTRIBUTION.json', import.meta.url), 'utf8'));
let studyNumber = Math.max(0, ...Object.values(existing).map(({ name }) => Number(name.match(/Ink Stroke Study (\d+)/)?.[1]) || 0));
let generatedCount = 0;
const generationErrors: Error[] = [];
const data: Record<string, GeneratedFontData> = {};
for (const style of addedStyles) {
  const approved = snapshot.fonts.find((record) => record.id === style.id);
  if (!approved || hash(style.publicFontPath) !== approved.fontSha256 || hash(style.publicLicensePath) !== approved.licenseSha256) {
    throw new Error(`The original approved font or license changed for ${style.id}.`);
  }
  if (existing[style.id] && !regenerate.has(style.id)) {
    const priorSource = previousAttribution.fonts.find((record) => record.id === style.id);
    if (!priorSource || priorSource.fontSha256 !== approved.fontSha256 || priorSource.licenseSha256 !== approved.licenseSha256) {
      throw new Error(`The preserved centerlines for ${style.id} do not match the approved original.`);
    }
    if (priorSource.centerlineSha256 && priorSource.centerlineSha256 !== digest(JSON.stringify(existing[style.id]))) {
      throw new Error(`The saved centerline bytes changed for ${style.id}; use explicit --regenerate to replace them.`);
    }
    data[style.id] = existing[style.id];
    if (previousAttribution.version === 2) {
      approximations.push(...previousAttribution.approximations.filter((record) => record.id === style.id));
    } else {
      auditRetainedMarks(style, existing[style.id]);
    }
    continue;
  }
  const name = existing[style.id]?.name ?? `Ink Stroke Study ${String(++studyNumber).padStart(2, '0')}`;
  try {
    data[style.id] = fontData(style, name);
    generatedCount++;
    console.log(`Generated ${style.id}: ${data[style.id].chars.length} centerline glyphs.`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    generationErrors.push(error);
    console.error(error.message);
  }
}
if (generationErrors.length) throw new AggregateError(generationErrors, 'No generated files were changed; resolve the source glyph failures above.');
for (const style of addedStyles) {
  if (!snapshot.preservedCenterlines.some((record) => record.id === style.id)) fitNewStudyToLine(style, data[style.id]);
}

writeFileSync(
  new URL('../src/writing/handwriting-fonts.json', import.meta.url),
  `${JSON.stringify(data)}\n`,
);

writeFileSync(new URL('../public/data/HANDWRITING-ATTRIBUTION.json', import.meta.url), `${JSON.stringify({
  version: 2,
  method: 'Unmodified source fonts; offline inferred centerlines with separately named stroke studies.',
  modified: 'Stroke order is heuristic, not recovered human ductus. A branch or crossing is drawn as separate pen-lift strokes instead of retracing ink already drawn; no glyph outlines or typeset reveals are drawn.',
  sourceSelection: { file: 'font-review/applied-selection.json', revision: snapshot.sourceRevision, sha256: snapshot.sourceSha256 },
  generation: {
    method: 'Rasterized original outlines, Zhang-Suen medial-axis thinning, source-component preservation, graph traversal and polyline simplification.',
    rasterXHeight: RASTER_X_HEIGHT, adaptiveRasterXHeights: [RASTER_X_HEIGHT * 2, RASTER_X_HEIGHT * 4],
    legacyRasterXHeight: 72, printableNonSpaceAsciiGlyphs: PRINTABLE_ASCII.length,
    arbitraryMissingGlyphFallbacks: false,
    blankSourceOutlines: ['italianno:_'],
    sourceMetricReconstruction: 'Only Italianno underscore: its mapped source glyph is empty, so its own advance and post-table underline metrics provide an explicitly attributed centerline.',
    compactMarks: 'Only compact filled source components without a traversable skeleton use an attributed short interior principal-axis stroke. Other failures abort generation.',
    newStudySizing: 'Natural script/print scales are capped by all 94 glyphs’ vertical extents to leave at least eight writing-canvas units between lines. Existing selected study metrics remain exact.',
  },
  tinyPunctuationFallbacks: [],
  approximations,
  originals: HANDWRITING_STYLES.filter((style) => style.id === 'correspondence').map((style) => ({
    id: style.id, sourceFamily: style.family, source: style.source, license: style.license,
    font: style.publicFontPath, fontSha256: hash(style.publicFontPath),
    licenseFile: style.publicLicensePath, licenseSha256: hash(style.publicLicensePath),
    data: 'src/writing/fonts.json', dataSha256: digest(readFileSync(new URL('../src/writing/fonts.json', import.meta.url))),
    method: 'Original ordered Hershey Correspondence centerlines preserved exactly.',
  })),
  fonts: addedStyles.map((style) => ({
    id: style.id, sourceFamily: style.family, strokeStudy: data[style.id].name,
    source: style.source, license: style.license,
    font: style.publicFontPath, fontSha256: hash(style.publicFontPath),
    licenseFile: style.publicLicensePath, licenseSha256: hash(style.publicLicensePath),
    centerlineSha256: digest(JSON.stringify(data[style.id])),
    preservedOriginalStudy: snapshot.preservedCenterlines.some((record) => record.id === style.id && record.sha256 === digest(JSON.stringify(data[style.id]))),
    writingScale: data[style.id].scale, lineHeight: data[style.id].lineHeight,
    heuristicStrokeOrder: true,
  })),
}, null, 2)}\n`);

console.log(`Wrote ${Object.keys(data).length} selected inferred datasets (${generatedCount} generated, ${addedStyles.length - generatedCount} preserved).`);
console.log(`Attributed ${approximations.length} source-grounded approximations, including the original blank Italianno underscore; no arbitrary missing-glyph lines.`);
