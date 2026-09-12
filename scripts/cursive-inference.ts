import { connectedComponents, decode, type Point, type Segment } from './stroke-routing.ts';

export const CURSIVE_INFERENCE_PROFILE = 'source-guarded-cursive-v1';
export const hasCursiveProfile = (id: string): boolean => id === 'meddon' || id === 'italianno';

export interface PocketRepair {
  pixels: number[];
}

const adjacent = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function backgroundComponents(bitmap: Uint8Array, width: number, height: number, diagonal = false): {
  labels: Int32Array; components: number[][]; exterior: Set<number>;
} {
  const labels = new Int32Array(bitmap.length).fill(-1);
  const components: number[][] = [];
  const exterior = new Set<number>();
  for (let start = 0; start < bitmap.length; start++) {
    if (bitmap[start] || labels[start] !== -1) continue;
    const id = components.length;
    const queue = [start];
    labels[start] = id;
    for (let index = 0; index < queue.length; index++) {
      const pixel = queue[index], x = pixel % width, y = Math.floor(pixel / width);
      if (!x || !y || x === width - 1 || y === height - 1) exterior.add(id);
      for (const [dx, dy] of diagonal ? [...adjacent, [-1, -1], [1, -1], [-1, 1], [1, 1]] : adjacent) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || bitmap[next] || labels[next] !== -1) continue;
        labels[next] = id;
        queue.push(next);
      }
    }
    components.push(queue);
  }
  return { labels, components, exterior };
}

export function sourceCounters(bitmap: Uint8Array, width: number, height: number): number[][] {
  const { components, exterior } = backgroundComponents(bitmap, width, height, true);
  return components.filter((_, id) => !exterior.has(id));
}

/** Remove only tiny raster pockets diagonally connected to exterior or a larger counter. */
export function repairDiagonalPockets(
  bitmap: Uint8Array, width: number, height: number, referencePixels: number,
): { bitmap: Uint8Array; repairs: PocketRepair[] } {
  const { labels, components, exterior } = backgroundComponents(bitmap, width, height);
  const limit = Math.max(1, Math.floor(4 * (referencePixels / 144) ** 2));
  const spanLimit = Math.max(2, Math.ceil(3 * referencePixels / 144));
  const candidates = new Set(components.flatMap((pixels, id) => {
    if (exterior.has(id) || pixels.length > limit) return [];
    const xs = pixels.map(p => p % width), ys = pixels.map(p => Math.floor(p / width));
    return Math.max(...xs) - Math.min(...xs) < spanLimit && Math.max(...ys) - Math.min(...ys) < spanLimit ? [id] : [];
  }));
  const links = new Map<number, Set<number>>();
  for (const id of candidates) {
    const next = new Set<number>();
    for (const p of components[id]) {
      const x = p % width, y = Math.floor(p / width);
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const other = labels[ny * width + nx];
        if (other !== -1 && other !== id) next.add(other);
      }
    }
    links.set(id, next);
  }
  const reachesOpenBackground = (start: number): boolean => {
    const seen = new Set([start]), queue = [start];
    for (let index = 0; index < queue.length; index++) {
      for (const id of links.get(queue[index]) ?? []) {
        if (exterior.has(id) || components[id].length > limit) return true;
        if (candidates.has(id) && !seen.has(id)) { seen.add(id); queue.push(id); }
      }
    }
    return false;
  };
  const result = bitmap.slice();
  const repairs = [...candidates].filter(reachesOpenBackground).map(id => ({ pixels: components[id] }));
  for (const { pixels } of repairs) for (const pixel of pixels) result[pixel] = 1;
  if (repairs.length && (sourceCounters(bitmap, width, height).length !== sourceCounters(result, width, height).length
    || connectedComponents(bitmap, width, height).length !== connectedComponents(result, width, height).length)) {
    return { bitmap: bitmap.slice(), repairs: [] };
  }
  return { bitmap: result, repairs };
}

const pointDistance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

function inside(point: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/** Cut a redundant local cycle, never a source counter or an extended cluster. */
export function removeRedundantCycles(
  segments: Segment[], bitmap: Uint8Array, width: number, referencePixels: number,
  onRemove?: (points: Point[]) => void,
): Segment[] {
  const limit = 8 * referencePixels / 144;
  let current = segments.slice();
  for (;;) {
    const incident = new Map<number, number[]>();
    current.forEach((s, i) => {
      incident.set(s.start, [...(incident.get(s.start) ?? []), i]);
      incident.set(s.end, [...(incident.get(s.end) ?? []), i]);
    });
    let remove = -1;
    // Short edges first: preserve long medial branches and all original node positions.
    const order = current.map((s, i) => ({ i, length: s.length })).sort((a, b) => a.length - b.length || a.i - b.i);
    for (const { i } of order) {
      const edge = current[i];
      if (edge.length > limit) continue;
      const queue: Array<{ node: number; points: number[]; length: number; used: Set<number> }> = [
        { node: edge.end, points: [edge.end], length: 0, used: new Set([i]) },
      ];
      for (let n = 0; n < queue.length && n < 256; n++) {
        const path = queue[n];
        if (path.node === edge.start) {
          const polygon = [...edge.points, ...path.points.slice(1)].map(decode);
          const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
          const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
          if (Math.max(maxX - minX, maxY - minY) > limit / 2) continue;
          let counter = false;
          for (let y = Math.ceil(minY); y <= maxY && !counter; y++) {
            for (let x = Math.ceil(minX); x <= maxX; x++) {
              if (!bitmap[y * width + x] && inside({ x, y }, polygon)) { counter = true; break; }
            }
          }
          if (!counter) { remove = i; break; }
        }
        for (const next of incident.get(path.node) ?? []) {
          if (path.used.has(next)) continue;
          const s = current[next];
          if (edge.length + path.length + s.length > limit * 2) continue;
          const reverse = s.end === path.node;
          const points = reverse ? s.points.slice().reverse() : s.points;
          queue.push({
            node: reverse ? s.start : s.end, points: [...path.points, ...points.slice(1)],
            length: path.length + s.length, used: new Set([...path.used, next]),
          });
        }
      }
      if (remove !== -1) break;
    }
    if (remove === -1) return current;
    onRemove?.(current[remove].points.map(decode));
    current = current.filter((_, index) => index !== remove);
  }
}

/** Positive-length collinear overlap, including partial/reversed simplified chords. */
export function repeatedChordLength(strokes: Point[][], tolerance = 0.002): number {
  const edges = strokes.flatMap((s, stroke) => s.slice(1).map((b, index) => ({ a: s[index], b, stroke, index })));
  let repeated = 0;
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i], size = pointDistance(a.a, a.b);
    if (size < 1e-9) continue;
    const dx = (a.b.x - a.a.x) / size, dy = (a.b.y - a.a.y) / size;
    for (let j = 0; j < i; j++) {
      const b = edges[j];
      const offset = (p: Point): number => Math.abs((p.x - a.a.x) * dy - (p.y - a.a.y) * dx);
      if (offset(b.a) > tolerance || offset(b.b) > tolerance) continue;
      const t0 = (b.a.x - a.a.x) * dx + (b.a.y - a.a.y) * dy;
      const t1 = (b.b.x - a.a.x) * dx + (b.b.y - a.a.y) * dy;
      const overlap = Math.min(size, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (overlap > tolerance) repeated += overlap;
    }
  }
  return repeated;
}

const strokeLength = (points: Point[]): number => points.slice(1)
  .reduce((sum, point, index) => sum + pointDistance(points[index], point), 0);

/**
 * The two t outlines have separated crossbar junctions. Repartition at actual
 * shared raster nodes, before simplification, so the ascender reaches its stem.
 * No connector, snapped point, or repeated edge is introduced.
 */
export function reweaveCursiveTrails(
  trails: Point[][], id: string, character: string, normalized: (point: Point) => Point,
): Point[][] {
  if (character !== 't' || !hasCursiveProfile(id)) return trails;
  const reverse = (points: Point[]): Point[] => points.slice().reverse();
  const join = (a: Point[], b: Point[]): Point[] => [...a, ...b.slice(1)];
  let result: Point[][];
  if (id === 'meddon') {
    if (trails.length !== 4) throw new Error('Reinspect the Meddon t crossbar/ascender topology.');
    const [stem, loop, bar, entry] = trails;
    const end = loop[loop.length - 1];
    const at = stem.findIndex(p => p.x === end.x && p.y === end.y);
    if (at <= 0 || at === stem.length - 1) throw new Error('Meddon t lost its shared ascender junction.');
    result = [reverse(entry), join(loop, stem.slice(at)), bar, reverse(stem.slice(0, at + 1))];
  } else {
    if (trails.length !== 3) throw new Error('Reinspect the Italianno t crossbar/ascender topology.');
    const [upper, rightBar, lower] = trails;
    let shared: { a: number; b: number; distance: number } | null = null;
    upper.forEach((point, a) => {
      const b = lower.findIndex(p => p.x === point.x && p.y === point.y);
      if (b < 0) return;
      const distance = pointDistance(normalized(point), { x: 5.87, y: 6.684 });
      if (!shared || distance < shared.distance) shared = { a, b, distance };
    });
    const junction = shared as { a: number; b: number; distance: number } | null;
    if (!junction || junction.distance > 0.3 || junction.a === 0 || junction.b === 0) {
      throw new Error('Italianno t lost its source-identified crossbar junction.');
    }
    result = [
      reverse(upper.slice(junction.a)),
      join(upper.slice(0, junction.a + 1), lower.slice(junction.b)),
      lower.slice(0, junction.b + 1), reverse(rightBar),
    ];
  }
  const total = (strokes: Point[][]): number => strokes.reduce((sum, points) => sum + strokeLength(points), 0);
  if (result.some(s => s.length < 2) || Math.abs(total(result) - total(trails)) > 1e-7) {
    throw new Error('Cursive junction planning must preserve every retained edge exactly once.');
  }
  return result;
}

// Signed, one-based trail hints describe inspected source anatomy, not new glyph
// geometry. Fail closed if extraction changes the topology requiring a new review.
// m/n: left entrance, stems/shoulders in reading order, right exit.
// looped l/k/b: entrance before the ascender/body; a/d/q/g: bowl before stem/exit.
// i/j: body before the separate source dot (whose direction stays untouched).
const TRAIL_ORDER: Record<string, Record<string, number[]>> = {
  meddon: {
    a: [-3, 2, 1], d: [-3, 2, 1],
    m: [2, 3, -1], n: [1, -2], l: [-2, 1], k: [-2, 1, 4, -3],
    b: [-2, 1, 4, -3], q: [2, 1, -3], i: [-3, 2, 1], j: [2, -3, 1],
    y: [2, 1, 3],
  },
  italianno: {
    a: [2, 1], d: [2, 1], g: [2, 1],
    m: [-2, 1, -4, -3], n: [-2, 1, -3], l: [-2, 1], k: [-4, 1, 3, 2],
    b: [-2, 1], q: [2, 1, -3], i: [-3, 2, 1], j: [2, 1],
    y: [2, 1],
  },
};

export function planCursiveStrokes(strokes: Point[][], id: string, character: string): Point[][] {
  if (!hasCursiveProfile(id) || !/^[a-z]$/.test(character) || character === 't') return strokes;
  const hint = TRAIL_ORDER[id][character];
  if (hint) {
    if (hint.length !== strokes.length || new Set(hint.map(Math.abs)).size !== strokes.length) {
      throw new Error(`Reinspect ${id}:${character}: its source-identified trail order changed.`);
    }
    return hint.map(index => index < 0 ? strokes[-index - 1].slice().reverse() : strokes[index - 1]);
  }
  const minX = Math.min(...strokes.flat().map(p => p.x)), maxX = Math.max(...strokes.flat().map(p => p.x));
  const total = strokes.reduce((sum, s) => sum + strokeLength(s), 0);
  // A slanted downstem is not an entrance stroke. Only shallow x-height-level
  // connectors/shoulders reverse; a bowl with an attached exit finishes at that exit.
  const oriented = strokes.map(stroke => {
    const a = stroke[0], b = stroke[stroke.length - 1];
    return a.y >= 5 && a.y <= 17 && b.y >= 5 && b.y <= 17
      && Math.abs(a.y - b.y) <= 4 && a.x - b.x > 2
      && (pointDistance(a, b) > strokeLength(stroke) * 0.35 || a.x >= maxX - 0.25)
      ? stroke.slice().reverse() : stroke;
  });
  const connector = (s: Point[]): boolean => {
    const a = s[0], b = s[s.length - 1];
    return a.y >= 5 && a.y <= 17 && b.y >= 5 && b.y <= 17
      && strokeLength(s) < total * 0.3 && pointDistance(a, b) > strokeLength(s) * 0.75;
  };
  const entry = oriented.filter(s => character !== 'f' && connector(s) && s[0].x <= minX + 0.25);
  const exit = oriented.filter(s => !entry.includes(s) && connector(s) && s[s.length - 1].x >= maxX - 0.25);
  const body = oriented.filter(s => !entry.includes(s) && !exit.includes(s));
  if ('uvwr'.includes(character)) body.sort((a, b) => Math.min(...a.map(p => p.x)) - Math.min(...b.map(p => p.x)));
  return [...entry, ...body, ...exit];
}
