import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import opentype from 'opentype.js';
import generated from '../src/writing/handwriting-fonts.json' with { type: 'json' };
import { parseStrokePath } from '../src/writing/paths.ts';
import { handwritingStyle } from '../src/handwriting.ts';
import { connectedComponents, key } from '../scripts/stroke-routing.ts';
import {
  hasCursiveProfile, repairDiagonalPockets, removeRedundantCycles, sourceCounters,
  repeatedChordLength, reweaveCursiveTrails, planCursiveStrokes,
} from '../scripts/cursive-inference.ts';

const ids = ['meddon', 'italianno'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const length = points => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
const paths = (id, ch) => parseStrokePath(generated[id].chars[ch.charCodeAt(0) - 33].d);
const surface = (width = 24, height = 24) => ({
  width, height, bitmap: new Uint8Array(width * height),
});
const fill = (s, x0, y0, x1, y1, value = 1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s.bitmap[y * s.width + x] = value;
};
const segment = points => ({
  start: key(points[0].x, points[0].y), end: key(points.at(-1).x, points.at(-1).y),
  points: points.map(p => key(p.x, p.y)), length: length(points),
});
const p = (x, y) => ({ x, y });

test('only the two approved source faces opt into the profile; other data bytes and target metrics stay exact', () => {
  assert.equal(hasCursiveProfile('meddon'), true);
  assert.equal(hasCursiveProfile('italianno'), true);
  assert.equal(hasCursiveProfile('correspondence'), false);
  assert.equal(hasCursiveProfile('kalam'), false);
  assert.equal(digest(Object.entries(generated).filter(([id]) => !ids.includes(id))),
    '3a4fb98548872e64ac98fc74d3f279addb0c56c35444a9a01bcbbb7bbc025d9e');
  const expected = {
    meddon: { name: 'Ink Stroke Study 31', sourceFamily: 'Meddon', space: 7.12, scale: 1.2123,
      lineHeight: 66, terminalPadding: .2, advanceHash: '078931829797988b8507fca0c7d079cd85b7e0e72d96e1a529d815486c5a7574' },
    italianno: { name: 'Ink Stroke Study 29', sourceFamily: 'Italianno', space: 6.55, scale: 1.5338,
      lineHeight: 66, terminalPadding: .2, advanceHash: '0e99eb1f3e57acf8fa27d74ceda4a6c1196235b7fb62ead5c6f6ea7818139510' },
  };
  for (const id of ids) {
    const { chars, ...metrics } = generated[id], { advanceHash, ...wanted } = expected[id];
    assert.deepEqual(metrics, wanted);
    assert.equal(digest(chars.map(g => g.o)), advanceHash);
    assert.equal(chars.length, 94);
  }
});

test('diagonal raster pockets are repaired, but genuine tiny counters, open notches and large pockets survive', () => {
  const s = surface();
  fill(s, 4, 4, 19, 19);
  fill(s, 4, 4, 4, 4, 0);
  fill(s, 5, 5, 5, 5, 0); // A one-pixel pocket diagonally open to the exterior.
  fill(s, 10, 10, 10, 10, 0); // A true isolated counter, even though also only one pixel.
  fill(s, 4, 16, 8, 17, 0); // A legitimate open notch, not a pocket.
  fill(s, 14, 5, 16, 7, 0); // A larger closed counter.
  const original = s.bitmap.slice();
  const result = repairDiagonalPockets(s.bitmap, s.width, s.height, 144);
  assert.deepEqual(s.bitmap, original, 'never mutate the source raster');
  assert.deepEqual(result.repairs, [{ pixels: [5 * s.width + 5] }]);
  assert.equal(result.bitmap[10 * s.width + 10], 0, 'a genuine tiny counter must not be filled');
  assert.equal(result.bitmap[17 * s.width + 8], 0, 'an open notch must not be shaved off');
  assert.equal(sourceCounters(result.bitmap, s.width, s.height).length, 2);
  assert.equal(connectedComponents(result.bitmap, s.width, s.height).length,
    connectedComponents(original, s.width, s.height).length);
});

test('filling must not split a real counter joined through a diagonal pocket', () => {
  const s = surface();
  fill(s, 3, 3, 20, 20);
  fill(s, 5, 5, 8, 8, 0);
  fill(s, 10, 10, 13, 13, 0);
  fill(s, 9, 9, 9, 9, 0);
  assert.equal(sourceCounters(s.bitmap, s.width, s.height).length, 1);
  const result = repairDiagonalPockets(s.bitmap, s.width, s.height, 144);
  assert.deepEqual(result.bitmap, s.bitmap);
  assert.deepEqual(result.repairs, []);
});

test('a source-filled multi-edge triangle is redundant, but a true counter and a long loop are not', () => {
  const s = surface();
  fill(s, 2, 2, 21, 21);
  const edges = [
    segment([p(10, 6), p(10, 10)]),
    segment([p(10, 10), p(12, 10)]),
    segment([p(12, 10), p(12, 12)]),
    segment([p(12, 12), p(10, 10)]),
    segment([p(12, 12), p(12, 18)]),
  ];
  const clean = removeRedundantCycles(edges, s.bitmap, s.width, 144);
  assert.equal(clean.length, 4);
  assert.ok(clean.includes(edges[0]) && clean.includes(edges[4]), 'real arms retained');
  assert.ok(clean.every(s => edges.includes(s)), 'no new edges or moved nodes');
  const counter = surface();
  fill(counter, 2, 2, 21, 21);
  fill(counter, 11, 11, 11, 11, 0);
  const ring = [
    segment([p(10, 10), p(12, 10)]), segment([p(12, 10), p(12, 12)]),
    segment([p(12, 12), p(10, 12)]), segment([p(10, 12), p(10, 10)]),
  ];
  assert.deepEqual(removeRedundantCycles(ring, counter.bitmap, counter.width, 144), ring);
  const longLoop = segment([p(3, 3), p(20, 3), p(20, 20), p(3, 20), p(3, 3)]);
  assert.deepEqual(removeRedundantCycles([longLoop], s.bitmap, s.width, 144), [longLoop]);
});

test('the exact Meddon b parallel paths cannot collapse to repeated simplified chords', () => {
  const bad = [[p(5.565, 9.231), p(5.054, 9.742)], [p(5.565, 9.231), p(5.419, 9.377)]];
  assert.ok(Math.abs(repeatedChordLength(bad) - Math.hypot(.146, .146)) < 1e-9);
  assert.equal(repeatedChordLength([[p(0, 0), p(1, 1), p(2, 2)]]), 0, 'shared endpoints are not repeats');
  assert.equal(repeatedChordLength([[p(0, 0), p(2, 2)], [p(0, 2), p(2, 0)]]), 0, 'crossings are not repeats');
  assert.equal(repeatedChordLength([[p(0, 0), p(3, 0), p(3, 2), p(0, 2), p(0, 0)]]), 0);
  for (const id of ids) for (let code = 33; code <= 126; code++) {
    assert.equal(repeatedChordLength(paths(id, String.fromCharCode(code))), 0, `${id}:${code}`);
  }
});

test('t junction planning repartitions real shared nodes without adding, losing, or repeating raw edges', () => {
  const source = [
    [p(6, 2), p(4, 2), p(3, 4), p(3, 8)],
    [p(4, 1), p(6, 0), p(4, 2)],
    [p(1, 3), p(2, 3)],
    [p(3, 5), p(0, 6)],
  ];
  const edgeKeys = ss => ss.flatMap(s => s.slice(1).map((b, i) =>
    [JSON.stringify(s[i]), JSON.stringify(b)].sort().join('|'))).sort();
  const planned = reweaveCursiveTrails(source, 'meddon', 't', p => p);
  assert.deepEqual(edgeKeys(planned), edgeKeys(source));
  assert.deepEqual(reweaveCursiveTrails(source, 'kalam', 't', p => p), source);
  assert.throws(() => planCursiveStrokes(source, 'meddon', 'm'), /Reinspect/);
});

test('source-identified cursive sequences complete bodies in reading order and dots last', () => {
  const m = paths('meddon', 'm');
  assert.equal(m.length, 3);
  assert.ok(m[0][0].x < 0 && m.at(-1).at(-1).x > 26);
  assert.ok(m[1][0].x < m[1].at(-1).x && m[2][0].x < m[2].at(-1).x);
  assert.ok(Math.max(...m[0].map(p => p.x)) < 7);
  assert.ok(Math.max(...m[1].map(p => p.x)) < 15);
  const im = paths('italianno', 'm');
  assert.equal(im.length, 4);
  assert.ok(im[0][0].x < 1.5);
  assert.ok(im[2][0].x < im[2].at(-1).x && im[3][0].x < im[3].at(-1).x);
  assert.ok(Math.max(...im[2].map(p => p.x)) < 12, 'middle shoulder before right shoulder');
  assert.ok(im[3].at(-1).x > 20);
  for (const id of ids) {
    const n = paths(id, 'n');
    assert.ok(n.at(-1)[0].x < n.at(-1).at(-1).x, `${id} n right shoulder goes forward`);
    for (const ch of ['l', 't']) {
      const strokes = paths(id, ch);
      const body = strokes.find(s => Math.min(...s.map(p => p.y)) < 0 && Math.max(...s.map(p => p.y)) > 14);
      assert.ok(body, `${id}:${ch} ascender must connect to lower stem without a late return`);
      assert.ok(body.findIndex(p => p.y < 0) < body.findIndex(p => p.y > 14));
      assert.ok(body.at(-1).x > body.at(-2).x && body.at(-1).y < body.at(-2).y,
        'body finishes with a rising rightward exit, independently of ascender slant');
    }
    for (const ch of ['i', 'j']) {
      const strokes = paths(id, ch), dot = strokes.at(-1), body = strokes.slice(0, -1);
      assert.ok(Math.max(...dot.map(p => p.y)) < Math.min(...body.flat().map(p => p.y)) - 1);
      assert.ok(body.some(s => Math.max(...s.map(p => p.y)) > 15));
      assert.ok(length(dot) > 0, 'the source dot remains an actual stroke');
    }
    const o = paths(id, 'o'), right = Math.max(...o.flat().map(p => p.x));
    assert.ok(Math.abs(o.at(-1).at(-1).x - right) < .01, `${id} o finishes at its exit, not before its bowl`);
    for (const ch of ['a', 'd']) {
      const ss = paths(id, ch), bowlIndex = id === 'meddon' ? 1 : 0;
      assert.ok(Math.min(...ss[bowlIndex].map(p => p.x)) < 5);
      assert.ok(Math.max(...ss[bowlIndex].map(p => p.y)) > 15);
      assert.ok(ss.at(-1).at(-1).x > 13, `${id}:${ch} bowl precedes final stem/exit`);
    }
  }
  const h = paths('meddon', 'h');
  assert.ok(h[0][0].x < .1 && Math.min(...h[1].map(p => p.y)) < 0, 'h entry precedes its ascender/body');
  const r = paths('italianno', 'r');
  assert.ok(r.some(s => s[0].y < 7 && s.at(-1).y > 15), 'slanted r stem is not reversed into an upstroke');
});

test('reported junction triangles are gone without treating all short strokes as noise', () => {
  const budgets = { meddon: { m: 3, n: 2, q: 3, k: 4, b: 4, l: 2, t: 4 },
    italianno: { m: 4, n: 3, q: 3, k: 4, b: 2, l: 2, t: 4 } };
  for (const [id, chars] of Object.entries(budgets)) for (const [ch, count] of Object.entries(chars)) {
    const ss = paths(id, ch);
    assert.equal(ss.length, count, `${id}:${ch}`);
    assert.ok(!ss.some(s => distance(s[0], s.at(-1)) < .01 && length(s) < 1), `${id}:${ch} tiny triangle`);
  }
  assert.ok(length(paths('italianno', 'i').at(-1)) < 1, 'a real tiny dot is preserved');
  assert.ok(paths('meddon', 'b').some(s => length(s) < 1), 'the source terminal detail is not blanket-pruned');
});

const sourceAudits = new Map();
function audit(id) {
  if (!sourceAudits.has(id)) sourceAudits.set(id, execFileSync(process.execPath, [
    '--experimental-strip-types', 'scripts/generate-handwriting-data.ts', '--audit-inference', id,
  ], { cwd: new URL('../', import.meta.url), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').map(JSON.parse));
  return sourceAudits.get(id);
}
function samples(strokes, step = .2) {
  return strokes.flatMap(s => s.slice(1).flatMap((b, index) => {
    const a = s[index], n = Math.ceil(distance(a, b) / step);
    return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }));
  }));
}
function nearest(point, strokes) {
  let nearest = Infinity;
  for (const s of strokes) for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return nearest;
}

test('all 188 saved glyphs match fresh source inference, retain advances and genuine source counters', () => {
  for (const id of ids) {
    assert.equal(audit(id).length, 94);
    for (const row of audit(id)) {
      assert.deepEqual(row.after.strokes, paths(id, row.character), `${id}:${row.character} stale saved paths`);
      assert.equal(row.after.advance, row.before.advance);
      for (const stage of row.audit) {
        assert.equal(stage.referencePixels, 144, 'the fix must not hide the problem by lowering resolution');
        assert.equal(stage.sourceCounters.length, stage.retainedCounters.length, `${id}:${row.character} counter count`);
        const before = stage.sourceCounters.toSorted((a, b) => b - a), after = stage.retainedCounters.toSorted((a, b) => b - a);
        for (let i = 0; i < before.length; i++) {
          assert.ok(after[i] <= before[i] && after[i] >= before[i] - stage.changes.filter(c => c.kind === 'pocket')
            .reduce((n, c) => n + c.points.length, 0));
        }
      }
    }
    for (const ch of id === 'meddon' ? 'hlebfj' : 'elobq') {
      assert.ok(audit(id).find(r => r.character === ch).audit[0].retainedCounters.some(size => size > 100),
        `${id}:${ch} real bowl/ascender/descender counter`);
    }
  }
});

test('geometry is preserved bidirectionally, with tighter bounds outside source-supported junction regions', () => {
  for (const id of ids) for (const row of audit(id)) {
    const extents = strokes => {
      const points = strokes.flat();
      return [Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y)),
        Math.max(...points.map(p => p.x)), Math.max(...points.map(p => p.y))];
    };
    const before = extents(row.before.strokes), after = extents(row.after.strokes);
    assert.ok(before.every((value, index) => Math.abs(value - after[index]) <= .25),
      `${id}:${row.character} lost an extremum/terminal flourish`);
    // A 1.5-unit neighborhood covers the medial junction bubble around a raster
    // slit (largest case: Meddon V). Outside it, only local simplification can move.
    const regions = row.audit.flatMap(s => s.changes).map(c => ({
      minX: Math.min(...c.points.map(p => p.x)) - 1.5, maxX: Math.max(...c.points.map(p => p.x)) + 1.5,
      minY: Math.min(...c.points.map(p => p.y)) - 1.5, maxY: Math.max(...c.points.map(p => p.y)) + 1.5,
    }));
    for (const [from, to] of [[row.before.strokes, row.after.strokes], [row.after.strokes, row.before.strokes]]) {
      for (const point of samples(from)) {
        const d = nearest(point, to);
        // Distance to a polyline is 1-Lipschitz; 0.2 sampling leaves <=0.1 between samples.
        assert.ok(d + .1 <= .9, `${id}:${row.character} global geometry ${d}`);
        if (!regions.some(b => point.x >= b.minX && point.x <= b.maxX && point.y >= b.minY && point.y <= b.maxY)) {
          assert.ok(d + .1 <= .25, `${id}:${row.character} changed outside its source junction: ${d}`);
        }
      }
    }
  }
});

test('all target paths stay in the original source corridor and cover every original filled component', () => {
  for (const id of ids) {
    const bytes = readFileSync(new URL(`../public${handwritingStyle(id).publicFontPath}`, import.meta.url));
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const metrics = font.charToGlyph('x').getMetrics(), reference = metrics.yMax - metrics.yMin;
    const scale = 144 / reference;
    for (let code = 33; code <= 126; code++) {
      const ch = String.fromCharCode(code), glyph = font.charToGlyph(ch);
      if (id === 'italianno' && ch === '_') continue; // Existing source-post-table reconstruction, tested separately.
      const { xMin, xMax, yMin, yMax } = glyph.getMetrics();
      const padding = Math.max(18, Math.ceil(Math.max(xMax - xMin, yMax - yMin) * scale * .1));
      const width = Math.max(8, Math.ceil((xMax - xMin) * scale + padding * 2));
      const height = Math.max(8, Math.ceil((yMax - yMin) * scale + padding * 2));
      const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
      const xOffset = padding - xMin * scale, yOffset = padding + yMax * scale;
      glyph.getPath(xOffset, yOffset, font.unitsPerEm * scale).draw(ctx);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const bitmap = Uint8Array.from({ length: width * height }, (_, i) => pixels[i * 4 + 3] > 128 ? 1 : 0);
      const components = connectedComponents(bitmap, width, height), labels = new Int32Array(bitmap.length).fill(-1);
      components.forEach((g, i) => g.forEach(pixel => { labels[pixel] = i; }));
      const repaired = repairDiagonalPockets(bitmap, width, height, 144);
      assert.equal(connectedComponents(repaired.bitmap, width, height).length, components.length, `${id}:${ch} source components`);
      const covered = new Set();
      for (const point of samples(paths(id, ch))) {
        const px = point.x * 144 / 10.5 + xOffset - .5;
        const py = yOffset - (16.5 - point.y) * 144 / 10.5 - .5;
        let min = Infinity, component = -1;
        for (let y = Math.floor(py) - 3; y <= Math.ceil(py) + 3; y++) for (let x = Math.floor(px) - 3; x <= Math.ceil(px) + 3; x++) {
          if (x < 0 || y < 0 || x >= width || y >= height || !bitmap[y * width + x]) continue;
          const d = Math.hypot(px - x, py - y);
          if (d < min) { min = d; component = labels[y * width + x]; }
        }
        assert.ok(min <= 3, `${id}:${ch} leaves its original source corridor: ${min} raster pixels`);
        covered.add(component);
      }
      assert.equal(covered.size, components.length, `${id}:${ch} lost an original dot/mark/component`);
    }
  }
});
