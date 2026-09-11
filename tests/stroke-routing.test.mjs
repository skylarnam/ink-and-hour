import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraph, connectedComponents, contractMicroJunctions, decodeSegment,
  decomposeIntoTrails, extractSegments, key, pruneSegments,
} from '../scripts/stroke-routing.ts';

// A tiny drawing surface for synthetic single-pixel-wide ink, so each topology (a
// straight stroke, a fork, a closed loop, ...) can be built from explicit coordinates
// instead of hand-counted ASCII art. Every shape below is drawn with at least a
// 1-pixel empty border, since buildGraph/connectedComponents only scan interior
// pixels (matching how the real skeletonizer's output is consumed).
function canvas(width, height) {
  const bitmap = new Uint8Array(width * height);
  const set = (x, y) => { bitmap[y * width + x] = 1; };
  // Orthogonal/diagonal stepper: enough for the straight, right-angle and diagonal
  // arms these fixtures need; not a general Bresenham line.
  const line = (x0, y0, x1, y1) => {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    set(x, y);
    while (x !== x1 || y !== y1) {
      if (x !== x1) x += dx;
      if (y !== y1) y += dy;
      set(x, y);
    }
  };
  return { bitmap, width, height, set, line };
}

// connectedComponents returns raw bitmap array indices (y*width+x); every other
// export here (buildGraph, contractMicroJunctions, extractSegments, ...) is keyed by
// the encoded key(x, y) node id. scripts/generate-handwriting-data.ts's extractTrails
// does this same conversion before using a component's pixels as graph nodes.
function toNodeIds(component, width) {
  return component.map((index) => key(index % width, Math.floor(index / width)));
}

// Runs the exact same stages extractTrails runs per component in
// scripts/generate-handwriting-data.ts: contract raster micro-junctions, extract
// edge-disjoint segments, prune spur/self-loop noise, then decompose into pen
// trails. Asserts the fixture is a single connected component first, since these
// synthetic shapes are only meaningful as one skeleton.
function runPipeline({ bitmap, width, height }) {
  const graph = buildGraph(bitmap, width, height);
  const components = connectedComponents(bitmap, width, height);
  assert.equal(components.length, 1, 'fixture must be a single connected component');
  const { nodes, graph: contractedGraph } = contractMicroJunctions(toNodeIds(components[0], width), graph);
  const segments = pruneSegments(extractSegments(nodes, contractedGraph)).map(decodeSegment);
  const trails = decomposeIntoTrails(segments);
  return { segments, trails };
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const trailLength = (points) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
const totalSegmentLength = (segments) => segments.reduce((sum, segment) => sum + segment.length, 0);
const totalTrailLength = (trails) => trails.reduce((sum, trail) => sum + trailLength(trail), 0);

// A trail must never immediately reverse over the pixel it just came from: that is
// exactly the pre-fix `path.push(...points.slice(0, -1).reverse())` retrace pattern,
// which always shows up as some point equalling the point two steps before it.
function hasImmediateReversal(points) {
  return points.some((point, index) => index >= 2
    && point.x === points[index - 2].x && point.y === points[index - 2].y);
}

// No accidental "teleport" line: every hop between consecutive points in a produced
// trail must be close to a real single-pixel raster step, never a straight line
// jumping across unrelated ink. contractMicroJunctions only ever contracts a group
// of directly-adjacent junction pixels to a single stand-in point after confirming
// every member of that group is itself within one raster step (sqrt(2)) of the
// stand-in, so by the triangle inequality no resulting hop -- from that stand-in
// to whatever real neighbor a group member used to reach, itself at most one real
// step away -- can ever exceed two raster steps (2 * sqrt(2)) *from that one side*.
// A single junction cluster can still legitimately split into more than one such
// group (a longer "staircase" thinning artifact can't always collapse to one
// stand-in), and when the real graph edge crossing between two such groups has
// *both* of its endpoints independently contracted, the worst case adds one more
// raster step: 3 * sqrt(2). A genuine teleport (an unrelated segment cutting across
// empty space, as previously found in real committed font data at magnitudes of
// several *raster units*, not a small fixed number of them) blows past this bound
// by roughly double or more, so this stays a tight, meaningful check.
const MAX_SAFE_HOP = 3 * Math.SQRT2 + 1e-9;
function maxHop(points) {
  return points.slice(1).reduce((max, point, index) => Math.max(max, distance(points[index], point)), 0);
}

test('a straight stroke is a single trail with no retrace and no dropped ink', () => {
  const surface = canvas(28, 6);
  surface.line(2, 3, 24, 3);
  const { segments, trails } = runPipeline(surface);

  assert.equal(segments.length, 1);
  assert.equal(trails.length, 1);
  assert.equal(hasImmediateReversal(trails[0]), false);
  assert.ok(maxHop(trails[0]) <= MAX_SAFE_HOP);
  assert.equal(totalTrailLength(trails), totalSegmentLength(segments));
});

test('a T fork is drawn as separate pen-down strokes, not one stroke retracing the stem', () => {
  const surface = canvas(28, 28);
  const joint = { x: 14, y: 14 };
  surface.line(joint.x, 2, joint.x, joint.y); // top arm
  surface.line(joint.x, joint.y, joint.x, 25); // bottom arm
  surface.line(2, joint.y, joint.x, joint.y); // left arm
  const { segments, trails } = runPipeline(surface);

  assert.equal(segments.length, 3, 'three arms meeting at one junction should yield three edges');
  // 3 odd-degree nodes (the junction) + 3 leaves = the graph-theoretic minimum is 2 trails.
  assert.equal(trails.length, 2);
  const usedSegmentLength = totalSegmentLength(segments);
  assert.equal(totalTrailLength(trails), usedSegmentLength, 'no segment should be walked more than once');
  for (const trail of trails) {
    assert.equal(hasImmediateReversal(trail), false);
    assert.ok(maxHop(trail) <= MAX_SAFE_HOP);
  }
});

test('a one-pixel junction kink does not divert a long stem into its crossbar', () => {
  const top = [
    ...Array.from({ length: 11 }, (_, i) => ({ x: 14, y: i + 2 })),
    { x: 13, y: 13 }, { x: 13, y: 14 }, { x: 14, y: 14 },
  ];
  const down = Array.from({ length: 12 }, (_, i) => ({ x: 14, y: i + 14 }));
  const bar = Array.from({ length: 12 }, (_, i) => ({ x: i + 14, y: 14 }));
  const segments = [top, down, bar].map((points) => ({
    start: key(points[0].x, points[0].y),
    end: key(points.at(-1).x, points.at(-1).y),
    points, length: trailLength(points),
  }));
  const trails = decomposeIntoTrails(segments);
  assert.equal(trails.length, 2);
  assert.deepEqual(trails[0][0], { x: 14, y: 2 });
  assert.deepEqual(trails[0].at(-1), { x: 14, y: 25 }, 'finish the stem before lifting for the crossbar');
  assert.equal(totalTrailLength(trails), totalSegmentLength(segments));
});

test('an X fork/crossing is covered by two straight-through strokes with no diagonal teleport', () => {
  const surface = canvas(30, 30);
  const center = { x: 15, y: 15 };
  surface.line(center.x, 2, center.x, center.y); // up
  surface.line(center.x, center.y, center.x, 27); // down
  surface.line(2, center.y, center.x, center.y); // left
  surface.line(center.x, center.y, 27, center.y); // right
  const { segments, trails } = runPipeline(surface);

  assert.equal(segments.length, 4, 'four arms meeting at one crossing should yield four edges');
  // All 4 odd-degree nodes are leaves (the crossing itself has even degree 4), so the
  // graph-theoretic minimum is 2 trails, each ideally a straight pass through the center.
  assert.equal(trails.length, 2);
  assert.equal(totalTrailLength(trails), totalSegmentLength(segments));
  for (const trail of trails) {
    assert.equal(hasImmediateReversal(trail), false);
    assert.ok(maxHop(trail) <= MAX_SAFE_HOP);
  }
  // Neither trail should introduce a straight line connecting two arm tips through
  // empty space instead of following the actual crossing pixel.
  const passesThroughCenter = (trail) => trail.some((point) => point.x === center.x && point.y === center.y);
  assert.ok(trails.every(passesThroughCenter));
});

test('a closed loop is a single trail that returns to its own start without collapsing', () => {
  const surface = canvas(24, 20);
  // A rectangle ring is one topological cycle, but each of its right-angle corners
  // has the same 8-connectivity quirk exercised by the T/X-fork tests above (the
  // corner's own two neighbor pixels touch each other diagonally, briefly looking
  // like a junction). contractMicroJunctions safely resolves each corner back down
  // to a single point, so the ring can legitimately surface as a handful of
  // edge-disjoint segments (one per corner-to-corner run) rather than literally
  // one segment -- what actually matters is that they still compose into exactly
  // one continuous, closed pen trail with no retrace and no accidental jump.
  surface.line(4, 4, 18, 4);
  surface.line(18, 4, 18, 14);
  surface.line(18, 14, 4, 14);
  surface.line(4, 14, 4, 4);
  const { segments, trails } = runPipeline(surface);

  assert.equal(trails.length, 1);
  const [loopTrail] = trails;
  assert.ok(loopTrail.length > 2, 'a real loop must not collapse to a degenerate point/segment');
  assert.equal(loopTrail[0].x, loopTrail.at(-1).x);
  assert.equal(loopTrail[0].y, loopTrail.at(-1).y);
  assert.equal(hasImmediateReversal(loopTrail), false);
  assert.ok(maxHop(loopTrail) <= MAX_SAFE_HOP);
  assert.equal(totalTrailLength(trails), totalSegmentLength(segments));
});

test('branching topology (two forks) covers every edge exactly once with no duplicate undirected segments', () => {
  const surface = canvas(34, 34);
  const jointA = { x: 10, y: 17 };
  const jointB = { x: 24, y: 17 };
  surface.line(jointA.x, 3, jointA.x, jointA.y); // top arm into joint A
  surface.line(2, jointA.y, jointA.x, jointA.y); // left arm into joint A
  surface.line(jointA.x, jointA.y, jointB.x, jointA.y); // spine between joint A and joint B
  surface.line(jointB.x, jointB.y, jointB.x, 31); // bottom arm out of joint B
  surface.line(jointB.x, jointB.y, 31, 10); // diagonal arm out of joint B
  const { segments, trails } = runPipeline(surface);

  assert.equal(segments.length, 5);
  // No duplicate undirected segment: every (start,end) node-id pair, regardless of
  // direction, is distinct across the whole decomposition. (segment.start/end are
  // raw encoded node ids per DecodedSegment, not decoded Points -- only `points` is
  // decoded -- so they can be compared directly without decoding.)
  const undirectedKeys = segments.map((segment) => [segment.start, segment.end].sort((a, b) => a - b).join('|'));
  assert.equal(new Set(undirectedKeys).size, undirectedKeys.length);

  // 4 leaves (odd) + 2 junctions of degree 3 (odd) = 6 odd-degree nodes -> 3 trails minimum.
  assert.equal(trails.length, 3);
  assert.equal(totalTrailLength(trails), totalSegmentLength(segments), 'every segment should be drawn exactly once in total');
  for (const trail of trails) {
    assert.equal(hasImmediateReversal(trail), false);
    assert.ok(maxHop(trail) <= MAX_SAFE_HOP);
  }
});

test('a long comb of closely-spaced teeth (one junction cluster too wide for a single stand-in) stays within the proven hop bound', () => {
  // A moderately thick diagonal stroke can thin to a "staircase" several raster
  // steps long, not just one tight corner: a run of directly-adjacent pixels that
  // are each their own junction (here, 9 in a row along a spine, each with a real
  // perpendicular tooth). No single point is within one raster step of all 9, so
  // contractMicroJunctions must split this one cluster into several safe
  // sub-groups instead of leaving all 9 unmerged (which would fragment one visual
  // joint into many extra pen lifts) or forcing one unsafe stand-in across the
  // whole run (a real teleport). This is the shape that actually dominates the
  // large-hop count measured across the 33 committed inferred fonts.
  const surface = canvas(24, 34);
  surface.line(2, 17, 18, 17); // spine, long enough to give real leaf arms on both ends
  // Teeth alternate above/below the spine so adjacent teeth never touch each other
  // directly (which would otherwise wire in extra, unintended parallel raster paths
  // between them and no longer test just the spine's own junction-cluster splitting).
  for (let x = 6; x <= 14; x++) {
    if ((x - 6) % 2 === 0) surface.line(x, 17, x, 9); // tooth above, length 8
    else surface.line(x, 17, x, 25); // tooth below, length 8
  }
  const graph = buildGraph(surface.bitmap, surface.width, surface.height);
  const [component] = connectedComponents(surface.bitmap, surface.width, surface.height);
  const { nodes, graph: contractedGraph } = contractMicroJunctions(toNodeIds(component, surface.width), graph);
  const segments = pruneSegments(extractSegments(nodes, contractedGraph)).map(decodeSegment);

  const undirectedKeys = segments.map((segment) => [segment.start, segment.end].sort((a, b) => a - b).join('|'));
  assert.equal(new Set(undirectedKeys).size, undirectedKeys.length, 'no duplicate undirected segment');

  const trails = decomposeIntoTrails(segments);
  assert.ok(Math.abs(totalTrailLength(trails) - totalSegmentLength(segments)) < 1e-9,
    'every segment drawn exactly once, no retrace');
  for (const trail of trails) {
    assert.equal(hasImmediateReversal(trail), false);
    assert.ok(maxHop(trail) <= MAX_SAFE_HOP, `hop ${maxHop(trail)} exceeds the proven bound ${MAX_SAFE_HOP}`);
  }
});

test('pruneSegments drops short leaf spurs but keeps real branches at the same junction', () => {
  const surface = canvas(30, 30);
  const joint = { x: 15, y: 15 };
  surface.line(joint.x, 3, joint.x, joint.y); // long top arm (real branch, ~12px)
  surface.line(joint.x, joint.y, joint.x, 27); // long bottom arm (real branch, ~12px)
  surface.line(joint.x, joint.y, joint.x - 3, joint.y - 3); // short diagonal spur (~3px, noise)
  const graph = buildGraph(surface.bitmap, surface.width, surface.height);
  const [component] = connectedComponents(surface.bitmap, surface.width, surface.height);
  const { nodes, graph: contractedGraph } = contractMicroJunctions(toNodeIds(component, surface.width), graph);
  const rawSegments = extractSegments(nodes, contractedGraph);
  const prunedSegments = pruneSegments(rawSegments);

  assert.equal(rawSegments.length, 3, 'the raw skeleton has a real junction with a short spur attached');
  assert.equal(prunedSegments.length, 2, 'the short spur should be dropped, the two long real arms kept');
  assert.ok(prunedSegments.every((segment) => segment.length >= 7));
});

test('a micro-junction pair with an alternate short diamond path contracts without leaving a degenerate self-loop', () => {
  // Reproduces the dancing-script:? crash at a small synthetic scale: two directly
  // adjacent branch pixels (both degree > 2 in the raw skeleton) that are *also*
  // connected by a short alternate path through intermediate degree-2 pixels. Merging
  // them (contractMicroJunctions) turns that alternate path into a spurious closed
  // self-loop that pruneSegments must drop, or normalizeStroke would later collapse it
  // to a single point (start === end by construction).
  const surface = canvas(30, 30);
  const a = { x: 14, y: 15 };
  const b = { x: 15, y: 15 };
  surface.set(a.x, a.y);
  surface.set(b.x, b.y); // a and b are directly adjacent
  surface.line(a.x, a.y, a.x, a.y - 3); // gives a a real branch (up), so degree(a) > 2
  surface.line(b.x, b.y, b.x + 3, b.y); // gives b a real branch (right), so degree(b) > 2
  // Alternate short diamond path from a to b via two intermediate degree-2 pixels below.
  surface.set(a.x, a.y + 1);
  surface.set(b.x, b.y + 1);
  surface.line(a.x, a.y, a.x, a.y + 1);
  surface.line(a.x, a.y + 1, b.x, b.y + 1);
  surface.line(b.x, b.y + 1, b.x, b.y);

  const graph = buildGraph(surface.bitmap, surface.width, surface.height);
  const [component] = connectedComponents(surface.bitmap, surface.width, surface.height);
  const { nodes, graph: contractedGraph } = contractMicroJunctions(toNodeIds(component, surface.width), graph);
  const segments = pruneSegments(extractSegments(nodes, contractedGraph)).map(decodeSegment);

  assert.ok(segments.every((segment) => !(segment.start.x === segment.end.x
    && segment.start.y === segment.end.y && segment.length < 7)),
  'no tiny closed self-loop from the contraction should survive pruning');

  const trails = decomposeIntoTrails(segments);
  for (const trail of trails) assert.ok(trail.length >= 2, 'no trail should collapse to a degenerate point');
});
