import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutText, restyleRemainingText, WritingEngine } from '../src/writing/index.ts';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { PAGE } from '../src/types.ts';

const options = { ...PAGE, style: 'correspondence' };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function bounds(strokes) {
  const points = strokes.flat();
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function lineBounds(layout) {
  const lines = new Map();
  for (const character of layout.characters) {
    const strokes = lines.get(character.after.line) ?? [];
    strokes.push(...layout.strokes.slice(character.strokeStart, character.strokeEnd));
    lines.set(character.after.line, strokes);
  }
  return new Map([...lines].map(([line, strokes]) => [line, bounds(strokes)]));
}

function pausedEngine(layout) {
  const engine = new WritingEngine(layout, DEFAULT_SETTINGS);
  engine.start();
  for (let step = 0; step < 1000 && engine.startedStrokeCount === 0; step++) engine.tick(0.01);
  assert.ok(engine.startedStrokeCount > 0);
  engine.pause();
  return engine;
}

test('omitted typography preserves default left-aligned geometry', () => {
  const note = 'Let the world wait.\nStay a little while.';
  assert.deepEqual(layoutText(note, options), layoutText(note, {
    ...options, textScale: 1, textAlignment: 'left',
  }));
  assert.ok(bounds(layoutText('Hello', options).strokes).maxX < PAGE.width / 2);
});

test('lettering scale changes actual glyph geometry, advances and line spacing', () => {
  const normal = layoutText('Ab\nCd', options);
  assert.equal(normal.ok, true);
  for (const textScale of [0.75, 1.3, 2]) {
    const resized = layoutText('Ab\nCd', { ...options, textScale });
    assert.equal(resized.ok, true, resized.error);
    const first = resized.characters[0];
    const original = normal.characters[0];
    const before = bounds(normal.strokes.slice(original.strokeStart, original.strokeEnd));
    const after = bounds(resized.strokes.slice(first.strokeStart, first.strokeEnd));
    close(after.width, before.width * textScale);
    close(after.height, before.height * textScale);
    close(resized.characters[1].after.x - first.after.x,
      (normal.characters[1].after.x - original.after.x) * textScale);
    close(resized.characters[2].after.y - first.after.y,
      (normal.characters[2].after.y - original.after.y) * textScale);
    assert.equal(first.after.textScale, textScale);
  }
});

test('center alignment centers each ink line, including after explicit and blank lines', () => {
  const note = '\nHello\n\nA quiet line\nHi';
  const left = layoutText(note, options);
  const centered = layoutText(note, { ...options, textAlignment: 'center', textScale: 1 });
  assert.equal(centered.ok, true);
  assert.equal(centered.lineCount, 5);
  assert.deepEqual([...lineBounds(centered).keys()], [2, 4, 5]);
  for (const [line, extent] of lineBounds(centered)) {
    close((extent.minX + extent.maxX) / 2, PAGE.width / 2);
    close(extent.width, lineBounds(left).get(line).width);
  }
  for (let index = 0; index < left.characters.length; index++) {
    const character = centered.characters[index];
    const shift = centered.strokes[character.strokeStart][0].x - left.strokes[character.strokeStart][0].x;
    close(character.after.x - left.characters[index].after.x, shift);
    assert.equal(character.after.y, left.characters[index].after.y);
    assert.equal(character.after.textAlignment, 'center');
  }
});

test('all selected faces wrap and center inside the real page at every supported size extreme', () => {
  for (const style of HANDWRITING_STYLES) {
    for (const textScale of [0.75, 1, 2]) {
      const layout = layoutText(textScale === 1 ? 'The quick brown fox jumps over the lazy dog.' : 'Abc', {
        ...PAGE, style: style.id, textScale, textAlignment: 'center',
      });
      assert.equal(layout.ok, true, `${style.id} at ${textScale}: ${layout.error}`);
      for (const extent of lineBounds(layout).values()) {
        close((extent.minX + extent.maxX) / 2, PAGE.width / 2);
        assert.ok(extent.minX >= 75.5 - 1e-8, `${style.id}: left edge`);
        assert.ok(extent.maxX <= PAGE.width - 75.5 + 1e-8, `${style.id}: right edge`);
        assert.ok(extent.minY >= 87.5 - 1e-8, `${style.id}: top edge`);
        assert.ok(extent.maxY <= PAGE.height - 77.5 + 1e-8, `${style.id}: bottom edge`);
      }
      const longer = layoutText('The quick brown fox jumps over the lazy dog.', {
        ...PAGE, style: style.id, textScale, textAlignment: 'center',
      });
      if (!longer.ok) {
        assert.equal(textScale, 2, `${style.id} should fit the pangram at its normal size`);
        assert.match(longer.error, /end of the sheet/);
        assert.deepEqual(longer.strokes, []);
      }
    }
  }
});

test('long words wrap without losing glyphs and bigger lettering reduces page capacity', () => {
  const note = 'Ab'.repeat(45);
  const left = layoutText(note, { ...options, textScale: 1.5 });
  const centered = layoutText(note, { ...options, textScale: 1.5, textAlignment: 'center' });
  assert.equal(centered.ok, true, centered.error);
  assert.ok(centered.lineCount > 1);
  assert.equal(centered.characters.length, note.length);
  assert.equal(centered.strokes.length, left.strokes.length);
  assert.deepEqual(centered.characters.map((character) => character.index), Array.from({ length: note.length }, (_, i) => i));
  const capacity = Array.from({ length: 18 }, (_, i) => 'A\n'.repeat(i + 1) + 'A')
    .find((text) => layoutText(text, options).ok && !layoutText(text, { ...options, textScale: 2 }).ok);
  assert.ok(capacity, 'doubling size must not leave page capacity unchanged');
  assert.match(layoutText(capacity, { ...options, textScale: 2 }).error, /end of the sheet/);
});

test('paused resizing and alignment preserve started letters, live position, and progress', () => {
  const note = 'A little room.\nAnother quiet line.';
  const previous = layoutText(note, options);
  const engine = pausedEngine(previous);
  const before = engine.peek();
  const revised = restyleRemainingText(note, previous, {
    ...options, textScale: 1.35, textAlignment: 'center',
  }, engine.startedStrokeCount);
  assert.equal(revised.layout.ok, true, revised.layout.error);
  assert.equal(revised.fromStroke, previous.characters[0].strokeEnd);
  assert.deepEqual(revised.layout.strokes.slice(0, revised.fromStroke), previous.strokes.slice(0, revised.fromStroke));
  assert.deepEqual(revised.layout.characters[0], previous.characters[0]);
  assert.equal(revised.layout.characters[1].after.textScale, 1.35);
  assert.equal(revised.layout.characters[1].after.textAlignment, 'left');
  for (const [line, extent] of lineBounds(revised.layout)) {
    if (line > 1) close((extent.minX + extent.maxX) / 2, PAGE.width / 2);
  }
  engine.replaceUnwrittenStrokes(revised.fromStroke, revised.layout.strokes.slice(revised.fromStroke));
  assert.deepEqual(engine.peek(), before);
  const repeated = restyleRemainingText(note, revised.layout, {
    ...options, textScale: 1.35, textAlignment: 'center',
  }, engine.startedStrokeCount);
  assert.deepEqual(repeated, revised);
  engine.resume();
  let contacts = 0;
  for (let step = 0; step < 20000 && engine.status !== 'complete'; step++) {
    const frame = engine.tick(0.04);
    if (frame.pen.contact && frame.segments.length) {
      contacts++;
      const last = frame.segments.at(-1).to;
      close(frame.pen.x, last.x);
      close(frame.pen.y, last.y);
    }
  }
  assert.equal(engine.status, 'complete');
  assert.ok(contacts > 20);
});

test('a centered retained line keeps its exact cursor when typography changes again', () => {
  const note = 'A little room.\nAnother quiet line.';
  const centered = layoutText(note, { ...options, textAlignment: 'center' });
  const started = centered.characters[0].strokeStart + 1;
  const revised = restyleRemainingText(note, centered, {
    ...options, textAlignment: 'left', textScale: 0.9,
  }, started);
  assert.equal(revised.layout.ok, true, revised.layout.error);
  assert.deepEqual(revised.layout.characters[0], centered.characters[0]);
  const newLetter = revised.layout.characters[1];
  assert.equal(newLetter.after.textAlignment, 'center');
  assert.ok(bounds(revised.layout.strokes.slice(newLetter.strokeStart, newLetter.strokeEnd)).minX
    >= centered.characters[0].after.x - 1e-8);
  const nextLine = revised.layout.characters.find((character) => character.after.line === 2);
  assert.equal(nextLine.after.textAlignment, 'left');
});

test('overflow during paused resizing is atomic and resizing before contact affects the whole note', () => {
  const note = Array.from({ length: 18 }, (_, i) => 'A\n'.repeat(i + 1) + 'A')
    .find((text) => layoutText(text, options).ok && !layoutText(text, { ...options, textScale: 2 }).ok);
  assert.ok(note);
  const previous = layoutText(note, options);
  const snapshot = structuredClone(previous);
  const engine = pausedEngine(previous);
  const before = engine.peek();
  const rejected = restyleRemainingText(note, previous, { ...options, textScale: 2 }, engine.startedStrokeCount);
  assert.equal(rejected.layout.ok, false);
  assert.deepEqual(previous, snapshot);
  assert.deepEqual(engine.peek(), before);
  const initial = restyleRemainingText('Hello', layoutText('Hello', options), {
    ...options, textScale: 1.5, textAlignment: 'center',
  }, 0);
  assert.equal(initial.fromStroke, 0);
  assert.deepEqual(initial.layout, layoutText('Hello', { ...options, textScale: 1.5, textAlignment: 'center' }));
});

test('invalid typography is rejected explicitly instead of clipping or producing nonfinite paths', () => {
  for (const textScale of [NaN, Infinity, null, 0, -1, 0.5, 2.1, '1']) {
    const result = layoutText('Hello', { ...options, textScale });
    assert.equal(result.ok, false);
    assert.deepEqual(result.strokes, []);
    assert.match(result.error, /size/);
  }
  assert.match(layoutText('Hello', { ...options, textAlignment: 'right' }).error, /alignment/);
  assert.match(layoutText('Hello', { ...options, textAlignment: null }).error, /alignment/);
  const previous = layoutText('Hello', options);
  const cursor = previous.characters[0].after;
  for (const invalid of [{ textScale: NaN }, { textScale: 0 }, { textAlignment: 'right' }]) {
    const result = layoutText('Hello', options, { index: 1, cursor: { ...cursor, ...invalid } });
    assert.equal(result.ok, false);
    assert.match(result.error, /valid position/);
  }
});
