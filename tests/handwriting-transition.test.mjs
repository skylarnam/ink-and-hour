import test from 'node:test';
import assert from 'node:assert/strict';
import { HANDWRITING_IDS } from '../src/handwriting.ts';
import { layoutText, restyleRemainingText, WritingEngine } from '../src/writing/index.ts';

const page = { width: 780, height: 1040, style: 'correspondence' };
const tool = { pen: 'fountain', nib: 'flex', speed: 1 };
const text = 'A little ink, then a different hand.\nThe page remembers.';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

function pausedSheet(source = text, options = page, time = 0.23) {
  const layout = layoutText(source, options);
  assert.equal(layout.ok, true, layout.error);
  const engine = new WritingEngine(layout, tool);
  engine.start();
  engine.tick(time);
  engine.pause();
  return { layout, engine };
}

test('layout tracks complete character boundaries, including spaces and normalized newlines', () => {
  const result = layoutText('Hi\r\n ink!', page);
  assert.deepEqual(result.characters.map(({ index }) => index), [0, 1, 4, 5, 6, 7]);
  assert.equal(result.characters[0].strokeStart, 0);
  assert.equal(result.characters.at(-1).strokeEnd, result.strokes.length);
  for (let i = 0; i < result.characters.length; i++) {
    const character = result.characters[i];
    assert.ok(character.strokeEnd > character.strokeStart);
    assert.equal(character.after.style, page.style);
    if (i) assert.equal(character.strokeStart, result.characters[i - 1].strokeEnd);
  }
});

test('every available style can replace the unwritten text without changing inked letters or the paused pen', () => {
  for (const style of HANDWRITING_IDS) {
    const { layout, engine } = pausedSheet();
    const before = engine.peek();
    const updated = restyleRemainingText(text, layout, { ...page, style }, engine.startedStrokeCount);
    assert.equal(updated.layout.ok, true, `${style}: ${updated.layout.error}`);
    assert.equal(updated.fromStroke, layout.characters[0].strokeEnd);
    assert.deepEqual(updated.layout.strokes.slice(0, updated.fromStroke), layout.strokes.slice(0, updated.fromStroke));
    engine.replaceUnwrittenStrokes(updated.fromStroke, updated.layout.strokes.slice(updated.fromStroke));
    assert.deepEqual(engine.peek(), before);
    assert.deepEqual(engine.tick(10).segments, []);
    assert.deepEqual(engine.peek(), before);
    for (const point of updated.layout.strokes.flat()) {
      assert.ok(point.x >= 3.5 && point.x <= page.width - 3.5, style);
      assert.ok(point.y >= 3.5 && point.y <= page.height - 3.5, style);
    }
  }
});

test('changing one preview repeatedly does not move the anchor or accumulate extra wrapping', () => {
  const { layout, engine } = pausedSheet();
  let preview = layout;
  for (const style of ['homemade-apple', 'pangolin', 'la-belle-aurore', 'caveat', 'correspondence']) {
    const changed = restyleRemainingText(text, preview, { ...page, style }, engine.startedStrokeCount);
    const direct = restyleRemainingText(text, layout, { ...page, style }, engine.startedStrokeCount);
    assert.deepEqual(changed, direct);
    preview = changed.layout;
  }
  assert.equal(preview.strokes.length, layout.strokes.length);
  for (let i = 0; i < layout.strokes.length; i++) {
    for (let p = 0; p < layout.strokes[i].length; p++) {
      close(preview.strokes[i][p].x, layout.strokes[i][p].x);
      close(preview.strokes[i][p].y, layout.strokes[i][p].y);
    }
  }
});

test('a new style preserves progress, lifts during travel, follows its ink and completes exactly', () => {
  const { layout, engine } = pausedSheet('Hi there.', { ...page, style: 'pangolin' }, 0.3);
  const changed = restyleRemainingText('Hi there.', layout, { ...page, style: 'caveat' }, engine.startedStrokeCount);
  engine.replaceUnwrittenStrokes(changed.fromStroke, changed.layout.strokes.slice(changed.fromStroke));
  let progress = engine.progress;
  engine.resume();
  let contact = false;
  let lifted = false;
  for (let count = 0; engine.status !== 'complete' && count < 10000; count++) {
    const frame = engine.tick(1 / 60);
    assert.ok(frame.pen.progress >= progress);
    progress = frame.pen.progress;
    if (frame.pen.contact) {
      contact = true;
      assert.deepEqual(frame.segments.at(-1).to, { x: frame.pen.x, y: frame.pen.y });
    } else {
      lifted = true;
      assert.equal(frame.pen.speed, 0);
    }
  }
  assert.ok(contact && lifted);
  assert.equal(engine.status, 'complete');
  assert.equal(engine.progress, 1);
  assert.deepEqual({ x: engine.peek().x, y: engine.peek().y }, changed.layout.strokes.at(-1).at(-1));
});

test('a paused pen that has not touched the sheet can change the entire layout without teleporting', () => {
  const { layout, engine } = pausedSheet('Hi.', page, 0.08);
  const before = engine.peek();
  assert.equal(engine.startedStrokeCount, 0);
  const changed = restyleRemainingText('Hi.', layout, { ...page, style: 'pangolin' }, 0);
  assert.equal(changed.fromStroke, 0);
  assert.deepEqual(changed.layout, layoutText('Hi.', { ...page, style: 'pangolin' }));
  engine.replaceUnwrittenStrokes(0, changed.layout.strokes);
  assert.deepEqual(engine.peek(), before);
  engine.resume();
  assert.equal(engine.tick(0.08).pen.contact, false);
  assert.equal(engine.tick(0.1).segments.length, 0);
});

test('an already started last letter is retained in full rather than overwritten or discarded', () => {
  const { layout, engine } = pausedSheet('A');
  const changed = restyleRemainingText('A', layout, { ...page, style: 'pangolin' }, engine.startedStrokeCount);
  assert.equal(changed.fromStroke, layout.strokes.length);
  assert.equal(changed.layout, layout);
});

test('capacity failures are atomic and illegal replacements cannot erase an active stroke', () => {
  const { layout, engine } = pausedSheet();
  const before = engine.peek();
  const changed = restyleRemainingText(text, layout, { ...page, style: 'homemade-apple', height: 110 }, engine.startedStrokeCount);
  assert.equal(changed.layout.ok, false);
  assert.deepEqual(changed.layout.strokes, []);
  assert.deepEqual(engine.peek(), before);
  assert.throws(() => engine.replaceUnwrittenStrokes(0, layout.strokes), /unwritten strokes/);
  assert.throws(() => engine.replaceUnwrittenStrokes(layout.strokes.length + 1, layout.strokes), /unwritten strokes/);
  engine.resume();
  assert.throws(() => engine.replaceUnwrittenStrokes(layout.strokes.length, layout.strokes), /Pause the pen/);
});

test('mixed-style whitespace and explicit line breaks remain bounded without losing text indexes', () => {
  const source = 'Hi\r\n\r\n  New words, gently.';
  const { layout, engine } = pausedSheet(source, { ...page, style: 'pangolin' }, 0.5);
  const changed = restyleRemainingText(source, layout, { ...page, style: 'correspondence' }, engine.startedStrokeCount);
  assert.equal(changed.layout.ok, true, changed.layout.error);
  const normalized = source.replace(/\r\n/g, '\n');
  assert.deepEqual(changed.layout.characters.map(({ index }) => index),
    [...normalized].flatMap((character, index) => /[!-~]/.test(character) ? [index] : []));
  assert.equal(changed.layout.characterCount, normalized.length);
  assert.ok(changed.layout.lineCount >= 3);
});
