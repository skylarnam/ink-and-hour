import type { Point } from '../types.ts';

export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
export const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));
export const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const ease = (t: number): number => t * t * (3 - 2 * t);

export function parseStrokePath(path: string): Point[][] {
  const tokenPattern = /[ML]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  if (path.replace(tokenPattern, '').replace(/[\s,]/g, '')) {
    throw new Error('Only absolute M/L centerline paths are supported.');
  }
  const tokens = path.match(tokenPattern) ?? [];
  const strokes: Point[][] = [];
  let stroke: Point[] | undefined;
  let command: 'M' | 'L' | undefined;
  let needsPair = false;

  for (let index = 0; index < tokens.length;) {
    const token = tokens[index++];
    if (token === 'M' || token === 'L') {
      if (needsPair || (token === 'L' && !stroke)) throw new Error('Invalid stroke path command.');
      command = token;
      needsPair = true;
      continue;
    }
    if (!command) throw new Error('A stroke must begin with M.');
    const x = Number(token);
    const y = Number(tokens[index++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid stroke coordinates.');
    if (command === 'M') {
      stroke = [];
      strokes.push(stroke);
      command = 'L';
    }
    if (!stroke) throw new Error('A stroke must begin with M.');
    stroke.push({ x, y });
    needsPair = false;
  }
  if (needsPair) throw new Error('Missing stroke coordinates.');
  return strokes;
}

export function smoothStroke(points: Point[], script: boolean): Point[] {
  const source = points.filter((point, index) => index === 0 || distance(points[index - 1], point) > 1e-9);
  if (source.length < 3) return source.map((point) => ({ ...point }));
  const result: Point[] = [{ ...source[0] }];
  const append = (point: Point): void => {
    if (distance(result[result.length - 1], point) > 1e-9) result.push(point);
  };

  for (let index = 1; index < source.length - 1; index++) {
    const before = source[index - 1];
    const point = source[index];
    const after = source[index + 1];
    const incoming = distance(before, point);
    const outgoing = distance(point, after);
    const cosine = ((point.x - before.x) * (after.x - point.x)
      + (point.y - before.y) * (after.y - point.y)) / (incoming * outgoing);
    const turn = Math.acos(clamp(cosine, -1, 1));
    if (turn < 0.01 || turn > (script ? 1.72 : 1.22)) {
      append({ ...point });
      continue;
    }
    // Local quadratic rounding stays inside the original polygon; cusps and M endpoints stay put.
    const trim = Math.min(script ? 0.65 : 0.45, incoming * 0.23, outgoing * 0.23);
    const entry = mix(point, before, trim / incoming);
    const exit = mix(point, after, trim / outgoing);
    append(entry);
    for (let step = 1; step <= 4; step++) {
      const t = step / 4;
      append(mix(mix(entry, point, t), mix(point, exit, t), t));
    }
  }
  append({ ...source[source.length - 1] });
  return result;
}
