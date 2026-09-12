import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { NoColorSpace, LinearFilter } from 'three';
import { PaperSurface } from '../src/textures.ts';
import { PAGE } from '../src/types.ts';
import { INK_DRY_SECONDS, WET_INK_LIMIT, WET_INK_UPDATE_SECONDS, inkPooling, inkWetness } from '../src/wet-ink.ts';

const originalDocument = globalThis.document;
let download;
globalThis.document = {
  createElement(kind) {
    if (kind === 'canvas') return createCanvas(1, 1);
    if (kind === 'a') return { click() { download = { href: this.href, name: this.download }; } };
    throw new Error(`Unexpected element: ${kind}`);
  },
};
after(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

const COLOR = '#24384d';
const segment = (overrides = {}) => ({
  from: { x: 100, y: 150 }, to: { x: 160, y: 150 },
  fromWidth: 6, toWidth: 6, pressure: 0.85, speed: 100, ...overrides,
});
const pixels = (canvas, x = 0, y = 0, w = canvas.width, h = canvas.height) =>
  canvas.getContext('2d').getImageData(x, y, w, h).data;
const maskPixel = (paper, x = 130, y = 150) => [...pixels(paper.roughnessTexture.image, x, y, 1, 1)];
const inkPixel = (paper, x = 130, y = 150) => [...pixels(paper.canvas, x * 2, y * 2, 1, 1)];

function surface(t) {
  const paper = new PaperSurface();
  t.after(() => paper.dispose());
  return paper;
}

function assertWhite(paper) {
  assert.ok(pixels(paper.roughnessTexture.image).every(value => value === 255), 'every mask channel is exactly white');
  assert.equal(paper.diagnostics.maskIsWhite, true);
  assert.equal(paper.diagnostics.maskMinimum, 255);
  assert.equal(paper.diagnostics.maskBounds, null);
}

// Independent raster oracle for the pre-wet-ink tapered quad and terminal cap.
function legacyInk(canvas, segments, color, kind) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(2, 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = kind === 'cotton' ? 0.9 : 0.96;
  const absorption = kind === 'cotton' ? 1.08 : 1;
  for (const { from, to, fromWidth, toWidth } of segments) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const nx = length > 0 ? -(to.y - from.y) / length : 0;
    const ny = length > 0 ? (to.x - from.x) / length : 1;
    const w0 = Math.max(0.4, fromWidth) * absorption / 2;
    const w1 = Math.max(0.4, toWidth) * absorption / 2;
    ctx.beginPath();
    ctx.moveTo(from.x + nx * w0, from.y + ny * w0);
    ctx.lineTo(to.x + nx * w1, to.y + ny * w1);
    ctx.lineTo(to.x - nx * w1, to.y - ny * w1);
    ctx.lineTo(from.x - nx * w0, from.y - ny * w0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(to.x, to.y, w1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

test('wetness has exact dry endpoints and a bounded, monotone, non-periodic four-second decay', () => {
  assert.equal(INK_DRY_SECONDS, 4);
  assert.equal(inkWetness(0), 1);
  assert.equal(inkWetness(-1), 1);
  assert.equal(inkWetness(INK_DRY_SECONDS / 2), 0.5);
  for (const age of [INK_DRY_SECONDS, 10, 1000000, NaN, Infinity, -Infinity]) {
    assert.equal(inkWetness(age), 0);
  }
  let previous = 1;
  for (let tick = 0; tick <= 600; tick++) {
    const value = inkWetness(tick / 120);
    assert.ok(value >= 0 && value <= previous);
    previous = value;
  }
});

test('pooling needs moving, slow, loaded ink and missing metadata keeps the legacy density', () => {
  for (const speed of [undefined, 0, -1, NaN, Infinity, -Infinity, 180, 1000]) {
    assert.equal(inkPooling(segment({ speed })), 0);
  }
  for (const pressure of [-1, 0, 0.25, NaN, Infinity]) {
    assert.equal(inkPooling(segment({ pressure })), 0);
  }
  assert.equal(inkPooling(segment({ to: { x: 100, y: 150 } })), 0);
  assert.ok(inkPooling(segment({ speed: 30 })) > inkPooling(segment({ speed: 140 })));
  assert.ok(inkPooling(segment({ pressure: 1 })) > inkPooling(segment({ pressure: 0.5 })));
  assert.equal(inkPooling(segment({ speed: 1, pressure: 100 })), 1);
});

test('actual roughness pixels dry during pause/completion without touching color or height textures', t => {
  const paper = surface(t);
  assertWhite(paper);
  assert.equal(paper.roughnessTexture.colorSpace, NoColorSpace);
  assert.equal(paper.roughnessTexture.generateMipmaps, false);
  assert.equal(paper.roughnessTexture.minFilter, LinearFilter);
  assert.deepEqual([paper.diagnostics.maskWidth, paper.diagnostics.maskHeight], [PAGE.width, PAGE.height]);
  const heightVersion = paper.heightTexture.version;
  const height = pixels(paper.heightTexture.image, 90, 140, 90, 25);
  paper.draw([segment()], COLOR);
  paper.flush();
  const colorVersion = paper.texture.version;
  const permanent = pixels(paper.canvas, 180, 280, 180, 50);
  const fresh = maskPixel(paper);
  assert.ok(fresh[1] >= 112 && fresh[1] <= 133);
  assert.deepEqual(fresh, [fresh[1], fresh[1], fresh[1], 255]);
  assert.equal(paper.diagnostics.maskMinimum, fresh[1]);
  assert.deepEqual(maskPixel(paper, 130, 165), [255, 255, 255, 255]);
  let previous = fresh[1];
  for (let frame = 0; frame < 32; frame++) {
    paper.flush(0.125);
    const green = maskPixel(paper)[1];
    assert.ok(green >= previous, 'a paused/finished stroke only becomes more matte');
    previous = green;
    assert.equal(paper.texture.version, colorVersion, 'aging must not upload the full-resolution base color');
  }
  assertWhite(paper);
  assert.equal(paper.diagnostics.wetSegmentCount, 0);
  assert.deepEqual(pixels(paper.canvas, 180, 280, 180, 50), permanent);
  assert.equal(paper.heightTexture.version, heightVersion);
  assert.deepEqual(pixels(paper.heightTexture.image, 90, 140, 90, 25), height);
  const settled = paper.diagnostics;
  for (let frame = 0; frame < 120; frame++) paper.flush(1 / 60);
  assert.deepEqual(paper.diagnostics, settled, 'fully dry frames skip mask work and GPU uploads');
});

test('aging uploads are throttled and a long pause settles immediately rather than replaying frames', t => {
  const paper = surface(t);
  paper.draw([segment()], COLOR);
  paper.flush();
  const initialRevision = paper.diagnostics.maskRevision;
  for (let frame = 0; frame < 120; frame++) paper.flush(1 / 120);
  const updates = paper.diagnostics.maskRevision - initialRevision;
  assert.ok(updates >= 23 && updates <= 24, `${updates} uploads in one second`);
  assert.equal(paper.diagnostics.updateIntervalSeconds, WET_INK_UPDATE_SECONDS);
  const before = maskPixel(paper);
  for (const delta of [0, -1, NaN, Infinity, -Infinity]) paper.flush(delta);
  assert.deepEqual(maskPixel(paper), before);
  paper.flush(600);
  assertWhite(paper);
  assert.equal(paper.diagnostics.wetSegmentCount, 0);
});

test('missing speed preserves exact existing nib footprints, ink colors, order and paper grain', t => {
  const paper = surface(t);
  const paths = [
    segment({ speed: undefined, fromWidth: 0.2, toWidth: 4 }),
    segment({ speed: undefined, from: { x: 160, y: 150 }, to: { x: 180, y: 172 }, fromWidth: 4, toWidth: 0.6 }),
    segment({ speed: undefined, from: { x: 112, y: 169 }, to: { x: 143, y: 140 }, fromWidth: 1, toWidth: 8 }),
  ];
  for (const kind of ['smooth', 'parchment', 'cotton']) {
    paper.clear();
    paper.setPaper(kind);
    const expected = createCanvas(paper.canvas.width, paper.canvas.height);
    const blank = createCanvas(paper.canvas.width, paper.canvas.height);
    blank.getContext('2d').drawImage(paper.canvas, 0, 0);
    const layer = createCanvas(paper.canvas.width, paper.canvas.height);
    for (const color of [COLOR, '#76503b', '#793e4b', '#3f5947', '#48a59c']) {
      legacyInk(layer, paths, color, kind);
      expected.getContext('2d').drawImage(blank, 0, 0);
      expected.getContext('2d').drawImage(layer, 0, 0);
      paper.draw(paths, color);
      paper.flush();
      assert.equal(Buffer.compare(
        Buffer.from(pixels(paper.canvas, 180, 260, 200, 120)), Buffer.from(pixels(expected, 180, 260, 200, 120)),
      ), 0, `unchanged legacy pixels for ${kind} / ${color}`);
    }
    assert.ok(maskPixel(paper)[1] < 255, 'legacy callers still receive a non-pooling wet finish');
  }
});

test('slow loaded strokes pool slightly within the same permanent footprint, including reduced motion', t => {
  const paper = surface(t);
  paper.setReducedMotion(true);
  const clean = pixels(paper.canvas, 180, 280, 160, 40);
  paper.draw([segment({ speed: 250, pressure: 1 })], COLOR);
  paper.flush();
  const fast = pixels(paper.canvas, 180, 280, 160, 40);
  const fastCenter = inkPixel(paper);
  paper.clear();
  paper.draw([segment({ speed: 20, pressure: 1 })], COLOR);
  paper.flush();
  const slow = pixels(paper.canvas, 180, 280, 160, 40);
  const slowCenter = inkPixel(paper);
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(slowCenter[channel] < fastCenter[channel]);
    assert.ok(fastCenter[channel] - slowCenter[channel] <= 8, 'pooling remains a restrained density change');
  }
  for (let i = 0; i < clean.length; i += 4) {
    const untouched = clean.slice(i, i + 4).every((value, channel) => value === fast[i + channel]);
    if (untouched) assert.deepEqual(slow.slice(i, i + 4), clean.slice(i, i + 4), 'pooling cannot widen a nib');
  }
  const permanent = [...slowCenter];
  paper.flush(10);
  assert.deepEqual(inkPixel(paper), permanent);
  assertWhite(paper);
  assert.equal(paper.diagnostics.wetSegmentCount, 0);
});

test('crossings use the freshest bounded finish, not additive gloss, and old records expire independently', t => {
  const paper = surface(t);
  paper.draw(Array.from({ length: 80 }, () => segment({ speed: 200 })), COLOR);
  paper.flush();
  assert.equal(maskPixel(paper)[1], Math.round(255 * 0.52));
  paper.flush(2);
  const aged = maskPixel(paper)[1];
  paper.draw([segment({ from: { x: 130, y: 125 }, to: { x: 130, y: 175 }, speed: 200 })], COLOR);
  paper.flush(0.05);
  assert.ok(maskPixel(paper)[1] < aged);
  assert.ok(maskPixel(paper)[1] >= Math.round(255 * 0.52));
  paper.flush(2);
  assert.equal(paper.diagnostics.wetSegmentCount, 1);
  assert.deepEqual(maskPixel(paper, 110, 150), [255, 255, 255, 255]);
  assert.ok(maskPixel(paper)[1] < 255);
  paper.flush(2);
  assertWhite(paper);
});

test('roughness clips at every paper edge and never connects pen-lift gaps or pools a stopped tip', t => {
  const paper = surface(t);
  const at = (x, y, toX, toY) => segment({ from: { x, y }, to: { x: toX, y: toY }, fromWidth: 4, toWidth: 4 });
  paper.draw([
    at(-20, 200, 20, 200), at(PAGE.width - 20, 200, PAGE.width + 20, 200),
    at(300, -20, 300, 20), at(300, PAGE.height - 20, 300, PAGE.height + 20),
    at(100, 400, 120, 400), at(180, 400, 200, 400),
  ], COLOR);
  paper.flush();
  assert.equal(paper.diagnostics.wetSegmentCount, 6);
  for (const [x, y] of [[0, 200], [PAGE.width - 1, 200], [300, 0], [300, PAGE.height - 1]]) {
    assert.ok(maskPixel(paper, x, y)[1] < 255);
  }
  assert.deepEqual(maskPixel(paper, 150, 400), [255, 255, 255, 255]);
  const count = paper.diagnostics.wetSegmentCount;
  paper.draw([
    at(-50, -50, -20, -20),
    at(PAGE.width + 20, 200, PAGE.width + 50, 200),
    at(350, 350, 350, 350),
    segment({ speed: 0 }), segment({ speed: NaN }), segment({ speed: Infinity }),
  ], COLOR);
  paper.draw([], COLOR);
  paper.flush(0.05);
  assert.equal(paper.diagnostics.wetSegmentCount, count);
  assert.deepEqual(maskPixel(paper, 350, 350), [255, 255, 255, 255]);
  paper.flush(INK_DRY_SECONDS);
  assertWhite(paper);
});

test('recent records are copied and bounded; eviction removes only sheen, never older permanent ink', t => {
  const paper = surface(t);
  const original = segment();
  paper.draw([original], COLOR);
  original.to.x = 700;
  paper.flush();
  assert.deepEqual(maskPixel(paper, 400, 150), [255, 255, 255, 255]);
  const oldInk = inkPixel(paper);
  const texture = paper.roughnessTexture;
  const canvas = texture.image;
  const recent = segment({ from: { x: 300, y: 300 }, to: { x: 320, y: 300 } });
  for (let batch = 0; batch < 3; batch++) {
    paper.draw(Array.from({ length: WET_INK_LIMIT + 17 }, () => recent), COLOR);
    assert.equal(paper.diagnostics.wetSegmentCount, WET_INK_LIMIT);
    paper.flush(0.05);
    assert.equal(paper.roughnessTexture, texture);
    assert.equal(paper.roughnessTexture.image, canvas);
  }
  assert.equal(paper.diagnostics.maxWetSegments, 2048);
  assert.deepEqual(maskPixel(paper), [255, 255, 255, 255]);
  assert.deepEqual(inkPixel(paper), oldInk);
  paper.flush(INK_DRY_SECONDS);
  assertWhite(paper);
  assert.deepEqual(inkPixel(paper), oldInk);
});

test('reduced motion settles instantly, preserves permanent ink, and never resurrects old wet strokes', t => {
  const paper = surface(t);
  paper.draw([segment()], COLOR);
  paper.flush();
  const permanent = inkPixel(paper);
  const colorVersion = paper.texture.version;
  const wetVersion = paper.roughnessTexture.version;
  paper.setReducedMotion(true);
  assertWhite(paper);
  assert.equal(paper.diagnostics.wetSegmentCount, 0);
  assert.equal(paper.diagnostics.reducedMotion, true);
  assert.equal(paper.roughnessTexture.version, wetVersion + 1);
  assert.equal(paper.texture.version, colorVersion);
  assert.deepEqual(inkPixel(paper), permanent);
  paper.draw([segment({ from: { x: 100, y: 200 }, to: { x: 160, y: 200 } })], COLOR);
  paper.flush(1);
  assertWhite(paper);
  paper.setReducedMotion(false);
  paper.flush(1);
  assertWhite(paper);
  paper.draw([segment()], COLOR);
  paper.flush();
  assert.equal(paper.diagnostics.wetSegmentCount, 1);
  assert.ok(maskPixel(paper)[1] < 255);
});

test('clear, paper switches and disposal clear transient state without allocating replacement masks', t => {
  const paper = surface(t);
  const texture = paper.roughnessTexture;
  const canvas = texture.image;
  const blank = inkPixel(paper);
  for (const kind of ['parchment', 'cotton', 'smooth']) {
    paper.draw([segment()], COLOR);
    paper.flush();
    const ink = inkPixel(paper);
    paper.setPaper(kind);
    assertWhite(paper);
    assert.equal(paper.diagnostics.wetSegmentCount, 0);
    assert.ok(inkPixel(paper)[0] < 70, 'changing paper keeps the already written ink');
    assert.ok(Math.abs(inkPixel(paper)[0] - ink[0]) < 5);
    assert.equal(paper.roughnessTexture, texture);
    assert.equal(paper.roughnessTexture.image, canvas);
  }
  paper.draw([segment()], COLOR);
  paper.flush();
  paper.clear();
  assertWhite(paper);
  assert.equal(paper.diagnostics.wetSegmentCount, 0);
  assert.deepEqual(inkPixel(paper), blank);
  paper.draw([segment({ from: { x: 300, y: 300 }, to: { x: 320, y: 300 } })], COLOR);
  paper.flush();
  assert.deepEqual(maskPixel(paper), [255, 255, 255, 255]);
  const disposed = { color: 0, height: 0, roughness: 0 };
  paper.texture.addEventListener('dispose', () => disposed.color++);
  paper.heightTexture.addEventListener('dispose', () => disposed.height++);
  paper.roughnessTexture.addEventListener('dispose', () => disposed.roughness++);
  paper.dispose();
  assertWhite(paper);
  assert.equal(paper.diagnostics.wetSegmentCount, 0);
  assert.equal(paper.diagnostics.disposed, true);
  const diagnostics = paper.diagnostics;
  paper.dispose();
  paper.draw([segment()], COLOR);
  paper.flush(1);
  paper.clear();
  paper.setPaper('cotton');
  paper.setReducedMotion(true);
  assert.deepEqual(disposed, { color: 1, height: 1, roughness: 1 });
  assert.deepEqual(paper.diagnostics, diagnostics);
});

test('exported PNG includes permanent pooled ink and paper but never the transient sheen mask', async t => {
  const paper = surface(t);
  paper.draw([segment({ speed: 20, pressure: 1 })], COLOR);
  paper.exportPNG();
  assert.equal(download.name, 'ink-and-hour.png');
  assert.equal(download.href, paper.canvas.toDataURL('image/png'));
  const wetPNG = download.href;
  assert.ok(maskPixel(paper)[1] < 255);
  const image = await loadImage(wetPNG);
  const decoded = createCanvas(image.width, image.height);
  decoded.getContext('2d').drawImage(image, 0, 0);
  assert.deepEqual([...pixels(decoded, 260, 300, 1, 1)], inkPixel(paper));
  paper.flush(INK_DRY_SECONDS);
  paper.exportPNG();
  assert.equal(download.href, wetPNG);
  assertWhite(paper);
});
