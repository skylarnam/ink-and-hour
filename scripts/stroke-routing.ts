// Offline stroke-routing helpers shared by scripts/generate-handwriting-data.ts.
//
// This module turns a skeletonized ink graph (pixels connected to their neighbors)
// into a set of pen trails: polylines a human pen could plausibly draw without ever
// re-inking a segment it already covered. It is deliberately independent of font
// rasterization so its topology decisions (straight strokes, forks, loops, branches)
// can be exercised directly with synthetic graphs in tests/stroke-routing.test.mjs.

export interface Point {
  x: number;
  y: number;
}

// A graph edge between two nodes (each an encoded pixel coordinate), following the
// exact chain of pixels between them. `points` holds raw encoded node ids until
// `decodeSegment` converts them to Points for trail assembly.
export interface Segment {
  start: number;
  end: number;
  points: number[];
  length: number;
}

// The same edge with its pixel chain already decoded to font-space points, ready to
// be walked and stitched into pen trails.
export interface DecodedSegment {
  start: number;
  end: number;
  points: Point[];
  length: number;
}

export function key(x: number, y: number): number {
  return (y << 16) | x;
}

export function decode(value: number): Point {
  return { x: value & 0xffff, y: value >> 16 };
}

export function neighbors(pixels: Uint8Array, width: number, x: number, y: number): number[] {
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

export function connectedComponents(bitmap: Uint8Array, width: number, height: number): number[][] {
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

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function nodeOrder(a: number, b: number): number {
  const left = decode(a);
  const right = decode(b);
  return left.y - right.y || left.x - right.x;
}

export function pathLength(points: number[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const a = decode(points[index - 1]);
    const b = decode(points[index]);
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

export function buildGraph(bitmap: Uint8Array, width: number, height: number): Map<number, number[]> {
  const graph = new Map<number, number[]>();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!bitmap[y * width + x]) continue;
      graph.set(key(x, y), neighbors(bitmap, width, x, y));
    }
  }
  return graph;
}

export function extractSegments(nodes: number[], graph: Map<number, number[]>): Segment[] {
  const nodeSet = new Set(nodes);
  const keys = new Set(nodes.filter((node) => (graph.get(node) ?? []).length !== 2));
  const visited = new Set<string>();
  const segments: Segment[] = [];
  const outgoing = (node: number) => (graph.get(node) ?? []).filter((neighbor) => nodeSet.has(neighbor));

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

// Thinning can leave adjacent branch pixels where the ink has one junction.
// Collapse only compact groups: a representative must be within one raster step
// of every member. Long staircase clusters remain split instead of being snapped
// to one distant point. Moving both endpoints bounds a resulting edge by three
// raster steps, rather than introducing a long connector across the glyph.
const MAX_SAFE_HOP = Math.SQRT2 + 1e-9;

export function contractMicroJunctions(
  nodes: number[], graph: Map<number, number[]>,
): { nodes: number[]; graph: Map<number, number[]> } {
  const nodeSet = new Set(nodes);
  const degree = (node: number): number => (graph.get(node) ?? []).filter((neighbor) => nodeSet.has(neighbor)).length;

  const parent = new Map<number, number>();
  const findCluster = (node: number): number => {
    if (!parent.has(node)) parent.set(node, node);
    let root = node;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let current = node;
    while (parent.get(current) !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  for (const node of nodes) {
    if (degree(node) <= 2) continue;
    for (const neighbor of graph.get(node) ?? []) {
      if (!nodeSet.has(neighbor) || neighbor <= node || degree(neighbor) <= 2) continue;
      const rootA = findCluster(node);
      const rootB = findCluster(neighbor);
      if (rootA !== rootB) parent.set(rootB, rootA);
    }
  }
  const clusters = new Map<number, number[]>();
  for (const node of nodes) {
    if (degree(node) <= 2) continue;
    const clusterRoot = findCluster(node);
    clusters.set(clusterRoot, [...(clusters.get(clusterRoot) ?? []), node]);
  }

  const chosenRoot = new Map<number, number>();
  // Returns the point in `group` with the smallest worst-case distance to every
  // other point in `group`, plus that worst-case distance, or null if no single
  // point in the group is within MAX_SAFE_HOP of every other point in it.
  const medoidOf = (group: number[]): { root: number; maxDist: number } | null => {
    let best: { root: number; maxDist: number } | null = null;
    for (const candidate of group) {
      const { x, y } = decode(candidate);
      let maxDist = 0;
      let ok = true;
      for (const member of group) {
        if (member === candidate) continue;
        const dist = Math.hypot(decode(member).x - x, decode(member).y - y);
        if (dist > MAX_SAFE_HOP) { ok = false; break; }
        maxDist = Math.max(maxDist, dist);
      }
      if (!ok) continue;
      if (!best || maxDist < best.maxDist || (maxDist === best.maxDist && nodeOrder(candidate, best.root) < 0)) {
        best = { root: candidate, maxDist };
      }
    }
    return best;
  };
  for (const members of clusters.values()) {
    if (members.length <= 1) continue; // a lone branch pixel is already its own correct node
    // Greedily merge the tightest compatible groups, rechecking the movement
    // bound across their whole union rather than relying on transitive adjacency.
    let groups: number[][] = members.map((member) => [member]);
    for (;;) {
      let bestPair: { i: number; j: number; root: number; maxDist: number } | null = null;
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const candidate = medoidOf([...groups[i], ...groups[j]]);
          if (!candidate) continue;
          if (!bestPair || candidate.maxDist < bestPair.maxDist) bestPair = { i, j, ...candidate };
        }
      }
      if (!bestPair) break;
      const merged = [...groups[bestPair.i], ...groups[bestPair.j]];
      groups = groups.filter((_, index) => index !== bestPair!.i && index !== bestPair!.j);
      groups.push(merged);
    }
    for (const group of groups) {
      if (group.length <= 1) continue;
      const { root } = medoidOf(group)!;
      for (const member of group) chosenRoot.set(member, root);
    }
  }
  const find = (node: number): number => chosenRoot.get(node) ?? node;

  const contractedGraph = new Map<number, number[]>();
  for (const node of nodes) {
    const nodeRoot = find(node);
    const neighborRoots = [...new Set(
      (graph.get(node) ?? [])
        .filter((neighbor) => nodeSet.has(neighbor))
        .map((neighbor) => find(neighbor))
        .filter((neighborRoot) => neighborRoot !== nodeRoot),
    )];
    contractedGraph.set(nodeRoot, [...new Set([...(contractedGraph.get(nodeRoot) ?? []), ...neighborRoots])]);
  }
  return { nodes: [...new Set(nodes.map(find))], graph: contractedGraph };
}

export function pruneSegments(segments: Segment[]): Segment[] {
  let current = segments;
  while (true) {
    const degree = new Map<number, number>();
    for (const segment of current) {
      degree.set(segment.start, (degree.get(segment.start) ?? 0) + 1);
      degree.set(segment.end, (degree.get(segment.end) ?? 0) + 1);
    }
    const next = current.filter((segment) => {
      // Tiny loops around contracted pixel junctions are pruned along with spurs.
      if (segment.start === segment.end) return segment.length >= 7;
      if (segment.length >= 7) return true;
      const startDegree = degree.get(segment.start) ?? 0;
      const endDegree = degree.get(segment.end) ?? 0;
      return !((startDegree > 2 && endDegree <= 1) || (endDegree > 2 && startDegree <= 1));
    });
    if (next.length === current.length) return current;
    current = next;
  }
}

export function edgeDirection(points: Point[], reverse = false): Point {
  if (points.length < 2) return { x: 1, y: 0 };
  const start = points[reverse ? points.length - 1 : 0];
  let previous = start;
  let travelled = 0;
  let direction: Point | null = null;
  // A snapped junction's last pixel can point sideways despite a vertical stem.
  // Estimate the tangent over a short arc beyond the contracted pixel cluster.
  for (let index = 1; index < points.length; index++) {
    const point = points[reverse ? points.length - 1 - index : index];
    travelled += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    if (Math.hypot(dx, dy) > 1e-9) direction = { x: dx, y: dy };
    if (travelled >= 8 && direction) return direction;
  }
  return direction ?? { x: 1, y: 0 };
}

export function turnScore(previous: Point | null, next: Point): number {
  if (!previous) return 0;
  const dot = previous.x * next.x + previous.y * next.y;
  const length = (Math.hypot(previous.x, previous.y) || 1) * (Math.hypot(next.x, next.y) || 1);
  return Math.acos(Math.max(-1, Math.min(1, dot / length)));
}

export function chooseSegment(
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

export function decodeSegment(segment: Segment): DecodedSegment {
  return { ...segment, points: segment.points.map((node) => decode(node)) };
}

/**
 * Decompose one connected component's edge set into non-retracing pen trails that
 * together cover every segment exactly once.
 *
 * Each trail walks forward — preferring the smoothest tangent continuation at every
 * junction, via chooseSegment — consuming a segment at most once. When the current
 * node runs out of unused edges, that trail ends: this is a genuine pen lift, not a
 * dead end to recover from. The outer loop then starts a fresh trail from the next
 * remaining junction or endpoint, preferring odd-degree nodes, until nothing is
 * left unused. Smooth continuation takes priority over a globally minimal lift count.
 *
 * This intentionally never re-walks a segment to "return" to a junction. A component
 * whose graph has more than two odd-degree nodes (such as a T or X fork) is
 * therefore drawn as multiple separate strokes with real pen
 * lifts between them, the way a hand actually drafts a crossbar or a crossing stroke,
 * instead of one stroke that backtracks over ink it already laid down.
 */
export function decomposeIntoTrails(segments: DecodedSegment[]): Point[][] {
  const incident = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    incident.set(segment.start, [...(incident.get(segment.start) ?? []), index]);
    incident.set(segment.end, [...(incident.get(segment.end) ?? []), index]);
  });
  const used = new Set<number>();
  const trails: Point[][] = [];
  while (used.size < segments.length) {
    const remainingNodes = [...incident.keys()].filter((node) =>
      (incident.get(node) ?? []).some((index) => !used.has(index)));
    const odd = remainingNodes.filter((node) =>
      (incident.get(node) ?? []).filter((index) => !used.has(index)).length % 2 === 1);
    const start = (odd.length ? odd : remainingNodes).sort(nodeOrder)[0];
    const path: Point[] = [decode(start)];
    let current = start;
    let previous: Point | null = null;
    while (true) {
      const candidates = (incident.get(current) ?? [])
        .filter((index) => !used.has(index))
        .map((index) => {
          const segment = segments[index];
          return { index, reverse: segment.end === current, points: segment.points };
        });
      if (!candidates.length) break;
      const next = chooseSegment(previous, candidates);
      used.add(next.index);
      const points = next.reverse ? next.points.slice().reverse() : next.points;
      path.push(...points.slice(1));
      current = next.reverse ? segments[next.index].start : segments[next.index].end;
      const outgoing = edgeDirection(points, true);
      previous = { x: -outgoing.x, y: -outgoing.y };
    }
    trails.push(path);
  }
  return trails;
}
