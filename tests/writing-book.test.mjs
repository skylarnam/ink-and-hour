import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WritingBook, WritingEngine, PAGE_TURN_SECONDS, layoutPages, layoutText,
} from '../src/writing/index.ts';
import { restyleRemainingPages } from '../src/writing/layout.ts';
import { HANDWRITING_IDS } from '../src/handwriting.ts';

const page = { width: 780, height: 1040, style: 'correspondence' };
const small = { width: 160, height: 100, style: 'pangolin' };
const tool = { pen: 'fountain', nib: 'flex', speed: 1 };
const point = ({ x, y }) => ({ x, y });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

function bookFor(text, options = small, engineOptions = tool) {
  const result = layoutPages(text, options);
  assert.equal(result.ok, true, result.error);
  return new WritingBook(result, engineOptions);
}

function until(book, predicate) {
  for (let i = 0; i < 100_000 && !predicate(); i++) book.tick(0.001);
  assert.ok(predicate(), 'Writing should reach the requested position');
}

function pauseAfterContact(book) {
  book.start();
  until(book, () => book.startedStrokeCount > 0);
  book.pause();
}

function run(book, delta = 10_000) {
  const pages = Array.from({ length: book.pageCount }, () => []);
  const changes = [];
  book.start();
  for (let i = 0; i < 100_000 && book.status !== 'complete'; i++) {
    const before = book.activePageIndex;
    const frame = book.tick(delta);
    pages[before].push(...frame.segments);
    if (frame.pageChanged) {
      changes.push([frame.previousPageIndex, book.activePageIndex]);
      assert.equal(frame.previousPageIndex, before);
      assert.equal(book.activePageIndex, before + 1);
      assert.deepEqual(frame.segments, []);
    }
    if (before < book.pageCount - 1) assert.notEqual(frame.pen.status, 'complete');
    if (!frame.pen.contact) assert.equal(frame.pen.speed, 0);
    for (const segment of frame.segments) assert.ok(Number.isFinite(segment.speed) && segment.speed > 0);
  }
  assert.equal(book.status, 'complete');
  return { pages, changes };
}

test('book emits final old-page segments before the contact-free midpoint swap and starts after the turn', () => {
  const book = bookFor('Hi\nInk');
  assert.equal(book.status, 'idle');
  assert.equal(book.pageCount, 2);
  assert.equal(book.turnProgress, null);
  book.start();
  const last = book.pages[0].layout.strokes.at(-1).at(-1);
  const finish = book.tick(1000);
  assert.ok(finish.segments.length);
  assert.deepEqual(finish.segments.at(-1).to, last);
  assert.deepEqual(point(finish.pen), last);
  assert.equal(finish.pen.status, 'writing');
  assert.equal(finish.pen.contact, false);
  assert.equal(finish.pageChanged, false);
  assert.equal(book.turnProgress, 0);
  assert.equal(book.activePageIndex, 0);

  assert.equal(book.tick(PAGE_TURN_SECONDS * 0.49).pageChanged, false);
  assert.equal(book.activePageIndex, 0);
  const swap = book.tick(PAGE_TURN_SECONDS * 0.02);
  assert.equal(swap.pageChanged, true);
  assert.equal(swap.previousPageIndex, 0);
  assert.equal(book.activePageIndex, 1);
  assert.equal(book.startedStrokeCount, 0);
  assert.deepEqual(swap.segments, []);
  assert.equal(swap.pen.contact, false);
  const incoming = book.pages[1].layout.strokes[0][0];
  assert.notDeepEqual(last, incoming);
  assert.deepEqual(point(swap.pen), incoming);
  assert.deepEqual(point(book.peek()), incoming);
  const settle = book.tick(PAGE_TURN_SECONDS);
  assert.equal(book.turnProgress, null);
  assert.equal(settle.pageChanged, false);
  assert.deepEqual(settle.segments, []);
  assert.deepEqual(point(settle.pen), incoming);
  assert.equal(book.startedStrokeCount, 0);
  const final = book.tick(1000);
  assert.equal(final.pen.status, 'complete');
  assert.deepEqual(final.segments.at(-1).to, book.pages[1].layout.strokes.at(-1).at(-1));
  assert.deepEqual(book.tick(1000).segments, []);
});

test('ten pages preserve deterministic stroke order with no missing, doubled or bridging ink', () => {
  const book = bookFor(Array.from({ length: 10 }, (_, i) => `${String.fromCharCode(65 + i)}!`).join('\n'));
  const expected = book.pages.map(({ layout }) => {
    const engine = new WritingEngine(layout, tool);
    engine.start();
    return engine.tick(10_000).segments;
  });
  const result = run(book);
  assert.deepEqual(result.pages, expected);
  assert.deepEqual(result.changes, Array.from({ length: 9 }, (_, i) => [i, i + 1]));
  assert.equal(book.progress, 1);
  assert.equal(book.peek().contact, false);
  assert.equal(book.turnProgress, null);
  assert.deepEqual(run(book), { pages: Array.from({ length: 10 }, () => []), changes: [] });
});

test('blank pages play without constructing invalid engines and even huge ticks switch at most once', () => {
  const book = bookFor('\n\nA\n\n');
  const result = run(book);
  assert.deepEqual(result.pages.map((segments) => !!segments.length), [false, false, true, false, false]);
  assert.deepEqual(result.changes, [[0, 1], [1, 2], [2, 3], [3, 4]]);
  assert.throws(() => new WritingBook(layoutPages('\n\n', small), tool), /Add something/);
  assert.throws(() => new WritingEngine(book.pages[0].layout, tool), /no handwriting/);
});

test('blank incoming sheets park at a meaningful page start rather than the outgoing final stroke', () => {
  const book = bookFor('Ink\n\nB\n');
  book.start();
  const outgoing = point(book.tick(1000).pen);
  const swap = book.tick(PAGE_TURN_SECONDS * 0.6);
  const nextStart = book.pages[2].layout.strokes[0][0];
  assert.equal(swap.pageChanged, true);
  assert.deepEqual(point(swap.pen), nextStart);
  assert.notDeepEqual(point(swap.pen), outgoing);
  assert.equal(swap.pen.contact, false);
  assert.equal(swap.pen.speed, 0);
  assert.deepEqual(swap.segments, []);
  book.pause();
  const paused = book.peek();
  assert.deepEqual(book.tick(100).pen, paused);
  book.resume();
  assert.deepEqual(point(book.tick(100).pen), nextStart);
  run(book);
});

test('pause during writing freezes pose, strokes and progress and rejects all invalid time', () => {
  const book = bookFor('A word\nMore');
  pauseAfterContact(book);
  const before = book.peek();
  const count = book.startedStrokeCount;
  for (const delta of [100, 0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(book.tick(delta), { pen: before, segments: [], pageChanged: false, previousPageIndex: null });
  }
  assert.equal(book.startedStrokeCount, count);
  book.resume();
  const resumed = book.peek();
  for (const delta of [0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(book.tick(delta).pen, resumed);
  }
  assert.equal(book.tick(0.08).pen.contact, false);
  book.tick(0.5);
  assert.ok(book.progress > before.progress);
});

test('turn pauses before and after its midpoint preserve exact transition position', () => {
  for (const fraction of [0.2, 0.7]) {
    const book = bookFor('A\nB');
    book.start();
    book.tick(1000);
    book.tick(PAGE_TURN_SECONDS * fraction);
    book.pause();
    const pen = book.peek();
    const progress = book.turnProgress;
    const index = book.activePageIndex;
    for (const delta of [100, NaN, Infinity]) {
      assert.deepEqual(book.tick(delta).pen, pen);
      assert.equal(book.turnProgress, progress);
      assert.equal(book.activePageIndex, index);
    }
    book.resume();
    for (const delta of [0, -1, NaN, Infinity]) {
      assert.equal(book.tick(delta).pageChanged, false);
      assert.equal(book.turnProgress, progress);
    }
    book.tick(PAGE_TURN_SECONDS * 0.1);
    close(book.turnProgress, progress + 0.1);
    run(book);
  }
});

test('reduced motion still separates final ink, one orderly swap, and first new ink', () => {
  const book = bookFor('A\nB\nC');
  book.setReducedMotion(true);
  book.start();
  assert.ok(book.tick(1000).segments.length);
  assert.equal(book.activePageIndex, 0);
  const swap = book.tick(0.001);
  assert.equal(swap.pageChanged, true);
  assert.equal(book.activePageIndex, 1);
  assert.equal(book.turnProgress, null);
  assert.deepEqual(swap.segments, []);
  assert.ok(book.tick(1000).segments.length);
  assert.equal(book.activePageIndex, 1);
  assert.equal(book.status, 'writing');
  assert.equal(book.tick(0.001).pageChanged, true);
  assert.equal(book.activePageIndex, 2);
  assert.equal(book.tick(1000).pen.status, 'complete');
});

test('reset during writing, a turn, and completion reproduces a fresh traversal', () => {
  const book = bookFor('A\nB');
  const expected = run(bookFor('A\nB'));
  for (const time of [0.2, 1000, Infinity]) {
    book.reset();
    book.start();
    if (time === Infinity) run(book);
    else book.tick(time);
    book.reset();
    assert.equal(book.status, 'idle');
    assert.equal(book.activePageIndex, 0);
    assert.equal(book.turnProgress, null);
    assert.equal(book.progress, 0);
    assert.deepEqual(run(book), expected);
  }
});

test('live nib, holder and speed settings preserve paused pose and apply on every future sheet', () => {
  const book = bookFor('A\nB');
  pauseAfterContact(book);
  const before = book.peek();
  const fast = { pen: 'dip', nib: 'broad', speed: 2 };
  book.updateOptions(fast);
  assert.deepEqual(book.peek(), before);
  book.resume();
  const first = book.tick(1000);
  assert.ok(first.segments.length);
  assert.ok(first.segments.every(({ speed }) => speed > 100));
  book.tick(1000);
  const next = book.tick(1000);
  const expected = new WritingEngine(book.pages[1].layout, fast);
  expected.start();
  assert.deepEqual(next.segments, expected.tick(1000).segments);
  book.reset();
  const fresh = bookFor('A\nB', small, fast);
  assert.deepEqual(run(book), run(fresh));
});

test('paused reflow retains the complete started character and repeated previews keep the same anchor', () => {
  const text = 'A little thought.\nAnother page.\nAnd some more words.';
  const options = { ...page, height: 240 };
  const book = bookFor(text, options);
  pauseAfterContact(book);
  const before = book.peek();
  const initial = book.pages[0].layout;
  const frozen = structuredClone(book.pages);
  const from = initial.characters[0].strokeEnd;
  for (const style of HANDWRITING_IDS) {
    const changed = book.reflow({ ...options, style, textScale: 0.9, textAlignment: 'center' });
    assert.equal(changed.ok, true, `${style}: ${changed.error}`);
    assert.deepEqual(book.peek(), before);
    assert.equal(book.pages.map((page) => page.text).join(''), text);
    assert.deepEqual(book.pages[0].layout.strokes.slice(0, from), initial.strokes.slice(0, from));
    assert.deepEqual(book.pages[0].layout.characters[0], initial.characters[0]);
    const direct = restyleRemainingPages(text, initial,
      { ...options, style, textScale: 0.9, textAlignment: 'center' }, book.startedStrokeCount);
    assert.deepEqual(changed.pages, direct.pages);
  }
  assert.deepEqual(initial, frozen[0].layout);
  book.resume();
  run(book, 0.1);
});

test('prior pages stay byte-for-byte unchanged when typography reflows the active and future pages', () => {
  const text = 'A\nB\nC\nD\nE';
  const book = bookFor(text);
  book.start();
  book.tick(1000);
  book.tick(1000);
  until(book, () => book.startedStrokeCount > 0);
  book.pause();
  assert.equal(book.activePageIndex, 1);
  const prior = book.pages[0];
  const before = book.peek();
  const changed = book.reflow({ ...small, style: 'homemade-apple' });
  assert.equal(changed.ok, true, changed.error);
  assert.equal(book.pages[0], prior);
  assert.deepEqual(book.peek(), before);
  assert.equal(book.pages.map((page) => page.text).join(''), text);
  book.resume();
  run(book);
});

test('reflow beyond ten pages fails atomically, including engine traversal and caller-owned geometry', () => {
  const text = Array(110).fill('A').join('\n');
  const layout = layoutPages(text, page);
  const snapshot = structuredClone(layout);
  const book = new WritingBook(layout, tool);
  const control = new WritingBook(layout, tool);
  pauseAfterContact(book);
  pauseAfterContact(control);
  const pen = book.peek();
  const pages = book.pages;
  const rejected = book.reflow({ ...page, textScale: 2 });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /10-page limit/);
  assert.deepEqual(rejected.pages, []);
  assert.equal(book.pages, pages);
  assert.deepEqual(layout, snapshot);
  assert.deepEqual(book.peek(), pen);
  book.resume();
  control.resume();
  for (let i = 0; i < 100; i++) assert.deepEqual(book.tick(0.1), control.tick(0.1));
});

test('partially started last letters keep every remaining stroke when all future text moves to another page', () => {
  const book = bookFor('A WW');
  pauseAfterContact(book);
  const before = book.peek();
  const first = book.pages[0].layout;
  const originalStrokes = first.strokes.slice(0, first.characters[0].strokeEnd);
  const result = book.reflow({ ...small, style: 'correspondence' });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(book.pages.map((page) => page.text), ['A ', 'WW']);
  assert.deepEqual(book.pages[0].layout.strokes, originalStrokes);
  assert.deepEqual(book.peek(), before);
  book.resume();
  const remaining = book.tick(1000);
  assert.ok(remaining.segments.length);
  assert.deepEqual(remaining.segments.at(-1).to, originalStrokes.at(-1).at(-1));
  assert.equal(remaining.pageChanged, false);
  assert.equal(book.turnProgress, 0);
  assert.equal(book.status, 'writing');
  assert.equal(book.tick(1000).pageChanged, true);
  assert.equal(book.tick(1000).pen.status, 'complete');
});

test('a fully drawn retained letter can become a paused boundary without a throw, pose jump or automatic advance', () => {
  const book = bookFor('A WW');
  const layout = book.pages[0].layout;
  const first = layout.characters[0];
  book.start();
  until(book, () => book.startedStrokeCount === first.strokeEnd && !book.peek().contact);
  book.pause();
  const before = book.peek();
  const result = book.reflow({ ...small, style: 'correspondence' });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(book.pages.map((page) => page.text), ['A ', 'WW']);
  assert.deepEqual(book.peek(), before);
  assert.deepEqual(book.tick(1000).pen, before);
  assert.equal(book.turnProgress, null);
  assert.equal(book.activePageIndex, 0);
  book.resume();
  const finish = book.tick(0.001);
  assert.deepEqual(finish.segments, []);
  assert.deepEqual(point(finish.pen), point(before));
  assert.equal(finish.pageChanged, false);
  assert.equal(book.turnProgress, 0);
  assert.equal(book.status, 'writing');
  assert.equal(book.tick(1000).pageChanged, true);
  assert.equal(book.tick(1000).pen.status, 'complete');

  const engine = new WritingEngine(layout, tool);
  engine.start();
  for (let i = 0; i < 100_000 && !(engine.startedStrokeCount === first.strokeEnd && !engine.peek().contact); i++) {
    engine.tick(0.001);
  }
  engine.pause();
  assert.throws(() => engine.replaceUnwrittenStrokes(first.strokeEnd, []), /remaining stroke/);
});

test('a boundary preview can be reversed while paused and the original future letters are not lost', () => {
  const book = bookFor('A WW');
  const first = book.pages[0].layout.characters[0];
  book.start();
  until(book, () => book.startedStrokeCount === first.strokeEnd && !book.peek().contact);
  book.pause();
  const before = book.peek();
  const ink = book.pages[0].layout.strokes.slice(0, first.strokeEnd);
  for (let i = 0; i < 3; i++) {
    assert.equal(book.reflow({ ...small, style: 'correspondence' }).ok, true);
    assert.equal(book.status, 'paused');
    assert.equal(book.startedStrokeCount, first.strokeEnd);
    assert.deepEqual(book.pages[0].layout.strokes, ink);
    assert.deepEqual(book.peek(), before);
    assert.deepEqual(book.tick(1000).segments, []);
  }
  const boundaryPages = book.pages;
  assert.equal(book.reflow({ ...small, height: 1 }).ok, false);
  assert.equal(book.pages, boundaryPages);
  assert.deepEqual(book.peek(), before);
  assert.equal(book.reflow(small).ok, true);
  assert.equal(book.pageCount, 1);
  assert.equal(book.pages[0].text, 'A WW');
  assert.deepEqual(book.peek(), before);
  book.resume();
  const frame = book.tick(1000);
  assert.equal(frame.pen.status, 'complete');
  const tail = book.pages[0].layout.strokes.slice(first.strokeEnd);
  const remainingLength = tail.reduce((sum, stroke) => sum + stroke.slice(1).reduce((length, point, i) =>
    length + Math.hypot(point.x - stroke[i].x, point.y - stroke[i].y), 0), 0);
  const emittedLength = frame.segments.reduce((sum, segment) =>
    sum + Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y), 0);
  close(emittedLength, remainingLength);
  assert.deepEqual(frame.segments[0].from, tail[0][0]);
});

test('an explicitly completed boundary engine can reopen only its tail, atomically and without replaying ink', () => {
  const layout = layoutText('A WW', small);
  const engine = new WritingEngine(layout, tool);
  const first = layout.characters[0];
  engine.start();
  for (let i = 0; i < 100_000 && !(engine.startedStrokeCount === first.strokeEnd && !engine.peek().contact); i++) {
    engine.tick(0.001);
  }
  engine.pause();
  engine.replaceUnwrittenStrokes(first.strokeEnd, [], true);
  engine.resume();
  assert.deepEqual(engine.tick(0.001).segments, []);
  assert.equal(engine.status, 'complete');
  const completed = engine.peek();
  assert.throws(() => engine.replaceUnwrittenStrokes(first.strokeEnd, []), /Pause/);
  assert.throws(() => engine.replaceUnwrittenStrokes(first.strokeEnd,
    [[{ x: NaN, y: 0 }, { x: 1, y: 1 }]], true), /finite/);
  assert.deepEqual(engine.peek(), completed);
  for (let i = 0; i < 3; i++) {
    engine.replaceUnwrittenStrokes(first.strokeEnd, [], true);
    assert.equal(engine.status, 'paused');
    assert.equal(engine.startedStrokeCount, first.strokeEnd);
    assert.deepEqual(engine.peek(), { ...completed, status: 'paused' });
  }
  engine.replaceUnwrittenStrokes(first.strokeEnd, layout.strokes.slice(first.strokeEnd), true);
  assert.deepEqual(engine.peek(), { ...completed, status: 'paused' });
  engine.resume();
  const result = engine.tick(1000);
  assert.equal(result.pen.status, 'complete');
  assert.deepEqual(result.segments[0].from, layout.strokes[first.strokeEnd][0]);
  assert.deepEqual(result.segments.at(-1).to, layout.strokes.at(-1).at(-1));
});

test('a paused book with an already completed boundary engine reuses its traversal instead of recompiling old ink', () => {
  const book = bookFor('A WW');
  const first = book.pages[0].layout.characters[0];
  book.start();
  until(book, () => book.startedStrokeCount === first.strokeEnd && !book.peek().contact);
  book.pause();
  assert.equal(book.reflow({ ...small, style: 'correspondence' }).ok, true);
  // Exercise a completed inner engine independently of the book's pending-boundary safeguard.
  const active = book.engine;
  active.resume();
  active.tick(0.001);
  assert.equal(active.status, 'complete');
  assert.equal(book.status, 'paused');
  const before = book.peek();
  for (const options of [{ ...small, style: 'correspondence' }, small]) {
    assert.equal(book.reflow(options).ok, true);
    assert.equal(book.engine, active);
    assert.equal(book.startedStrokeCount, first.strokeEnd);
    assert.deepEqual(book.peek(), before);
  }
  assert.equal(book.pageCount, 1);
  const retainedEnd = book.pages[0].layout.strokes[first.strokeEnd - 1].at(-1);
  assert.deepEqual(point(book.peek()), retainedEnd);
  book.resume();
  const frame = book.tick(1000);
  assert.equal(frame.pen.status, 'complete');
  assert.deepEqual(frame.segments[0].from, book.pages[0].layout.strokes[first.strokeEnd][0]);
});

test('tenth-page reflow errors and thrown validation leave all ink, engine pose, progress and pages untouched', () => {
  const book = bookFor(`${'A\n'.repeat(9)}A WW`);
  const control = bookFor(`${'A\n'.repeat(9)}A WW`);
  for (const current of [book, control]) {
    current.start();
    for (let i = 0; i < 9; i++) {
      current.tick(1000);
      assert.equal(current.tick(1000).pageChanged, true);
    }
    pauseAfterContact(current);
    assert.equal(current.activePageIndex, 9);
  }
  const before = book.peek();
  const pages = book.pages;
  const snapshot = structuredClone(pages);
  const failed = book.reflow({ ...small, style: 'correspondence' });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /10-page limit/);
  assert.deepEqual(failed.pages, []);
  const throwingOptions = new Proxy(small, { get() { throw new Error('Invalid layout options'); } });
  assert.throws(() => book.reflow(throwingOptions), /Invalid layout options/);
  assert.equal(book.pages, pages);
  assert.deepEqual(book.pages, snapshot);
  assert.deepEqual(book.peek(), before);
  book.resume();
  control.resume();
  assert.deepEqual(book.tick(1000), control.tick(1000));
  assert.equal(book.status, 'complete');
});

test('a taller new font after a retained bottom-line glyph consumes explicit breaks without inventing blank pages', () => {
  const options = { ...page, height: 110, style: 'pangolin' };
  for (const breaks of ['\n', '\n\n', '  \n']) {
    const text = `A\nB${breaks}C`;
    const book = bookFor(text, options);
    book.start();
    const last = book.pages[0].layout.characters.at(-1);
    until(book, () => book.startedStrokeCount > last.strokeStart);
    book.pause();
    const before = book.peek();
    const changed = book.reflow({ ...options, style: 'correspondence' });
    assert.equal(changed.ok, true, changed.error);
    assert.deepEqual(book.pages.map((page) => page.text),
      breaks === '\n\n' ? ['A\nB\n', '\n', 'C'] : [`A\nB${breaks}`, 'C']);
    assert.equal(book.pages.at(-1).layout.characters[0].after.line, 1);
    assert.deepEqual(book.peek(), before);
    book.resume();
    run(book);
  }
});

test('an unstarted page may become blank on reflow while keeping the paused pen and resetting safely', () => {
  const options = { ...small, height: 160 };
  const book = bookFor('\nA', options);
  book.start();
  book.tick(0.08);
  book.pause();
  const before = book.peek();
  assert.equal(book.reflow({ ...options, style: 'correspondence' }).ok, true);
  assert.deepEqual(book.pages.map((page) => page.text), ['\n', 'A']);
  assert.deepEqual(book.pages[0].layout.strokes, []);
  assert.deepEqual(book.peek(), before);
  book.resume();
  assert.deepEqual(book.tick(0.1).segments, []);
  assert.equal(book.turnProgress, 0);
  assert.equal(book.tick(1000).pageChanged, true);
  assert.equal(book.tick(1000).pen.status, 'complete');
  book.reset();
  assert.equal(book.startedStrokeCount, 0);
  run(book);
});

test('turn-time reflow freezes the outgoing page and may reflow an unstarted incoming page', () => {
  for (const fraction of [0.2, 0.7]) {
    const book = bookFor('A\nB\nC\nD');
    const original = book.pages[0];
    book.start();
    book.tick(1000);
    book.tick(PAGE_TURN_SECONDS * fraction);
    book.pause();
    const before = book.peek();
    const turn = book.turnProgress;
    const result = book.reflow({ ...small, height: 200 });
    assert.equal(result.ok, true, result.error);
    assert.equal(book.pages[0], original);
    if (fraction < 0.5) assert.deepEqual(book.peek(), before);
    else {
      assert.deepEqual(point(book.peek()), book.pages[book.activePageIndex].layout.strokes[0][0]);
      assert.equal(book.peek().contact, false);
      assert.equal(book.peek().speed, 0);
    }
    assert.equal(book.turnProgress, turn);
    assert.equal(book.pages.map((page) => page.text).join(''), 'A\nB\nC\nD');
    book.resume();
    run(book);
  }
});

test('reflow before first contact is a full fresh layout and a started final glyph remains unchanged', () => {
  const book = bookFor('A little note.\nMore.', { ...page, height: 240 });
  book.start();
  book.tick(0.08);
  book.pause();
  const before = book.peek();
  const options = { ...page, textScale: 1.4, textAlignment: 'center' };
  const result = book.reflow(options);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(book.pages, layoutPages('A little note.\nMore.', options).pages);
  assert.deepEqual(book.peek(), before);
  const single = bookFor('A');
  pauseAfterContact(single);
  const pages = single.pages;
  assert.equal(single.reflow({ ...small, textScale: 2 }).ok, true);
  assert.equal(single.pages[0].layout, pages[0].layout);
  single.resume();
  run(single);
  assert.equal(bookFor('A').reflow(page).ok, false);
});
