import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, Image } from '@napi-rs/canvas';
import { PaperSurface } from '../src/textures.ts';

const original = globalThis.document;
let deferDecode = null;
globalThis.document = {
  createElement(kind) {
    if (kind === 'canvas') return createCanvas(1, 1);
    if (kind === 'img') {
      const image = new Image();
      if (deferDecode) {
        const decode = image.decode.bind(image);
        const gate = deferDecode;
        image.decode = async () => { await gate; await decode(); };
      }
      return image;
    }
    throw new Error(`Unexpected ${kind}`);
  },
};
after(() => {
  if (original === undefined) delete globalThis.document;
  else globalThis.document = original;
});
const stroke = [{ from: { x: 100, y: 140 }, to: { x: 180, y: 150 }, fromWidth: 2, toWidth: 4, pressure: 0.7, speed: 95 }];
const pixels = (paper) => Buffer.from(paper.canvas.getContext('2d').getImageData(180, 250, 220, 80).data);

test('page snapshots restore ink, its original paper, and exact pixels without reviving wet ink', async (t) => {
  const paper = new PaperSurface();
  t.after(() => paper.dispose());
  paper.setPaper('cotton');
  paper.draw(stroke, '#24384d');
  paper.flush();
  const before = pixels(paper);
  const snapshot = paper.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.match(snapshot.ink, /^data:image\/png;base64,/);
  paper.clear();
  paper.setPaper('smooth');
  assert.equal(await paper.restore(snapshot), true);
  assert.equal(paper.kind, 'cotton');
  assert.deepEqual(pixels(paper), before);
  assert.equal(paper.diagnostics.maskIsWhite, true);
  assert.equal(paper.diagnostics.wetSegmentCount, 0);
});

test('a reset, new stroke, paper change or disposal cancels stale asynchronous restores', async (t) => {
  for (const change of ['clear', 'draw', 'paper', 'dispose']) {
    const paper = new PaperSurface();
    paper.draw(stroke, '#24384d');
    const snapshot = paper.snapshot();
    let release;
    deferDecode = new Promise((resolve) => { release = resolve; });
    const restoring = paper.restore(snapshot);
    if (change === 'clear') paper.clear();
    else if (change === 'draw') paper.draw(stroke, '#793e4b');
    else if (change === 'paper') paper.setPaper('parchment');
    else paper.dispose();
    release();
    assert.equal(await restoring, false, change);
    deferDecode = null;
    paper.dispose();
  }
});

test('invalid or wrong-size snapshots fail without erasing the current page', async (t) => {
  const paper = new PaperSurface();
  t.after(() => paper.dispose());
  paper.draw(stroke, '#24384d');
  paper.flush();
  const before = pixels(paper);
  for (const snapshot of [
    { paper: 'smooth', ink: 'https://example.invalid/paper.png' },
    { paper: 'unknown', ink: paper.snapshot().ink },
    { paper: 'smooth', ink: createCanvas(1, 1).toDataURL('image/png') },
  ]) {
    await assert.rejects(paper.restore(snapshot));
    assert.deepEqual(pixels(paper), before);
  }
});
