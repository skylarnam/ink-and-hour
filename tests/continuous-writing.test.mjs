import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumePage, createContinuousBook, formatReading, layoutPages, MAX_CHARACTERS, MAX_READINGS_PER_FILL,
  PAGE_TURN_SECONDS, ReadingDeck, WritingBook, WritingEngine,
} from '../src/writing/index.ts';
import { HANDWRITING_IDS } from '../src/handwriting.ts';

const options = { width: 780, height: 1040, style: 'pangolin' };
const tool = { pen: 'fountain', nib: 'flex', speed: 1 };
const small = { ...options, width: 240, height: 240 };
const reading = (id, text = `A line for ${id}.\nAnother quiet line.`) => ({
  id, title: `Title ${id}`, author: `Author ${id}`, year: 1800, authorDied: 1850,
  source: 'https://example.org/source', text,
});
const catalog = Array.from({ length: 12 }, (_, i) => reading(String.fromCharCode(65 + i)));
const seed = (value = 123) => () => ((value = Math.imul(value, 1664525) + 1013904223 >>> 0) / 2 ** 32);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const segmentLength = (segments) => segments.reduce((sum, { from, to }) =>
  sum + Math.hypot(to.x - from.x, to.y - from.y), 0);
const pathLength = (strokes) => strokes.reduce((sum, stroke) => sum + stroke.slice(1).reduce((length, point, i) =>
  length + Math.hypot(point.x - stroke[i].x, point.y - stroke[i].y), 0), 0);
const point = ({ x, y }) => ({ x, y });

function create(readings = catalog, layout = options, random = seed()) {
  const errors = [];
  const book = createContinuousBook(readings, layout, tool, (message) => errors.push(message), random);
  return { book, errors };
}

function collect(book, count, verifyInk = false) {
  const completed = [];
  let actual = [];
  const start = book.activePageIndex;
  for (let i = 0; i < count * 4 + 10 && completed.length < count; i++) {
    const before = book.activePage;
    const index = book.activePageIndex;
    const frame = book.tick(10_000);
    actual.push(...frame.segments);
    assert.equal(book.status, 'writing');
    if (frame.pageChanged) {
      assert.equal(frame.previousPageIndex, index);
      assert.equal(book.activePageIndex, index + 1);
      assert.deepEqual(frame.segments, []);
      assert.equal(frame.pen.contact, false);
      assert.equal(frame.pen.speed, 0);
      assert.equal(book.startedStrokeCount, 0);
      if (verifyInk && before.layout.strokes.length) {
        const engine = new WritingEngine(before.layout, tool);
        engine.start();
        assert.deepEqual(actual, engine.tick(10_000).segments);
      } else if (verifyInk) assert.deepEqual(actual, []);
      actual = [];
      completed.push(before);
    }
    assert.equal(book.pages.length, 1);
    assert.equal(book.bufferedPageCount, 1);
    assert.equal(book.activePage, book.pages[0]);
    assert.ok(book.bufferedCharacterCount <= MAX_CHARACTERS);
  }
  assert.equal(completed.length, count);
  assert.equal(book.activePageIndex, start + count);
  return completed;
}

function pauseWithInk(book) {
  book.start();
  const segments = [];
  for (let i = 0; i < 10_000 && book.startedStrokeCount === 0; i++) {
    segments.push(...book.tick(0.001).segments);
  }
  assert.ok(book.startedStrokeCount > 0);
  book.pause();
  return segments;
}

test('ReadingDeck shuffles deterministically, covers every work per cycle, and never repeats across refills', () => {
  const a = new ReadingDeck(catalog, seed());
  const b = new ReadingDeck(catalog, seed());
  let last = null;
  for (let cycle = 0; cycle < 50; cycle++) {
    const actual = Array.from({ length: 12 }, () => a.next().id);
    assert.deepEqual(actual, Array.from({ length: 12 }, () => b.next().id));
    assert.deepEqual([...actual].sort(), catalog.map(({ id }) => id));
    assert.notEqual(actual[0], last);
    last = actual.at(-1);
  }
  assert.equal(a.drawCount, 600);
  a.reset();
  assert.equal(a.drawCount, 0);
  assert.deepEqual(Array.from({ length: 12 }, () => a.next().id).sort(), catalog.map(({ id }) => id));
  const single = new ReadingDeck([catalog[0]]);
  assert.equal(single.next(), single.next());
});

test('formatting includes ASCII title, author and body without dropping body whitespace or line breaks', () => {
  const work = reading('A', 'First\r\n\r\n  Last. \r');
  assert.equal(formatReading(work), 'Title A\nby Author A\n\nFirst\n\n  Last. \n\n\n');
  for (const invalid of [{ title: 'Title\nextra' }, { author: 'Frédéric' }, { text: ' ' },
    { text: '“Hello”' }, { text: 'tabs\t' }]) {
    assert.throws(() => formatReading({ ...work, ...invalid }), /ASCII/);
  }
  const bad = reading('bad', 'bad\tbody');
  const deck = new ReadingDeck([bad]);
  assert.throws(() => deck.nextText(), /ASCII/);
  assert.equal(deck.drawCount, 0);
  bad.text = 'Fixed.';
  assert.equal(deck.nextText(), formatReading(bad));
  assert.equal(deck.drawCount, 1);
});

test('consumePage shares exact manual geometry and retains all whitespace, long-word and newline boundaries', () => {
  for (const text of ['A\r\n\r\nB\n\n', 'AAAA BBBB', 'W'.repeat(100), `  A${' '.repeat(80)}\n`,
    'A quiet line.\n'.repeat(20)]) {
    const original = layoutPages(text, small);
    assert.equal(original.ok, true, original.error);
    let remaining = text;
    const pages = [];
    for (let i = 0; i < 11; i++) {
      const consumed = consumePage(remaining, small);
      assert.equal(consumed.ok, true, consumed.error);
      assert.equal(consumed.page.text + consumed.remainder, remaining.replace(/\r\n?/g, '\n'));
      pages.push(consumed.page);
      remaining = consumed.remainder;
      if (!consumed.full) break;
    }
    assert.deepEqual(pages, original.pages);
  }
  assert.equal(consumePage('', options).full, false);
  assert.equal(consumePage('\n\n', options).ok, true);
  assert.equal(layoutPages('\n\n', options).ok, false);
});

test('consumePage takes one page of a work exceeding ten pages without shaping the overflow', () => {
  const text = 'W'.repeat(3900);
  const large = { ...options, textScale: 2, textAlignment: 'center' };
  assert.equal(layoutPages(text, large).ok, false);
  const consumed = consumePage(text, large);
  assert.equal(consumed.ok, true, consumed.error);
  assert.equal(consumed.full, true);
  assert.ok(consumed.page.text.length < 200);
  assert.equal(consumed.page.text + consumed.remainder, text);
  const unread = new Proxy({}, { get() { throw new Error('Cap must be checked first'); } });
  const excessive = consumePage('A'.repeat(MAX_CHARACTERS + 1), unread);
  assert.equal(excessive.ok, false);
  assert.equal(excessive.page, null);
  assert.equal(excessive.remainder.length, MAX_CHARACTERS + 1);
});

test('all hands consume a bounded first page at both size extremes without clipping', () => {
  const text = 'A few words, and a blank line.\n\n'.repeat(100);
  for (const style of HANDWRITING_IDS) {
    for (const textScale of [0.75, 2]) {
      const result = consumePage(text, { ...options, style, textScale, textAlignment: 'center' });
      assert.equal(result.ok, true, `${style}: ${result.error}`);
      assert.equal(result.full, true);
      assert.equal(result.page.text + result.remainder, text);
      for (const point of result.page.layout.strokes.flat()) {
        assert.ok(point.x >= 75.5 - 1e-8 && point.x <= 704.5 + 1e-8, style);
        assert.ok(point.y >= 87.5 - 1e-8 && point.y <= 962.5 + 1e-8, style);
      }
    }
  }
});

test('continuous construction is lazy and multiple works fill the same current physical page', () => {
  const works = [reading('A', 'One.'), reading('B', 'Two.')];
  const { book, errors } = create(works, options, () => 0.99);
  assert.ok(book instanceof WritingBook);
  assert.equal(book.continuous, true);
  assert.equal(book.activePage.text, '');
  assert.equal(book.sourceReadCount, 0);
  assert.equal(book.status, 'idle');
  book.start();
  assert.equal(book.status, 'writing');
  assert.ok(book.activePage.text.startsWith(formatReading(works[0]) + formatReading(works[1])));
  assert.ok(book.sourceReadCount >= 2);
  assert.deepEqual(errors, []);
});

test('forty physical pages preserve exact FIFO text, deterministic ink and absolute page numbers', () => {
  const { book, errors } = create(catalog, small);
  const expected = new ReadingDeck(catalog, seed());
  book.start();
  const completed = collect(book, 40, true);
  const pulled = Array.from({ length: book.sourceReadCount }, () => expected.nextText()).join('');
  const written = completed.map((page) => page.text).join('') + book.activePage.text;
  assert.equal(pulled.slice(0, written.length), written);
  assert.equal(pulled.length - written.length, book.pendingCharacterCount);
  assert.equal(book.pageCount, 41);
  assert.deepEqual(errors, []);
});

test('hundreds of pages retain only one layout, one active engine and a bounded pending string', () => {
  const { book, errors } = create(catalog, small);
  book.setReducedMotion(true);
  book.start();
  const completed = collect(book, 250);
  assert.equal(book.activePageIndex, 250);
  assert.equal(book.pageCount, 251);
  assert.equal(book.pages.includes(completed[0]), false);
  assert.ok(book.pendingCharacterCount <= MAX_CHARACTERS);
  assert.equal(book.bufferedCharacterCount, book.activePage.text.length + book.pendingCharacterCount);
  assert.deepEqual(errors, []);
});

test('paused writing, paused turns and invalid deltas cannot pull readings or move the page', () => {
  for (const phase of ['writing', 'outgoing', 'incoming']) {
    const { book } = create(catalog, small);
    book.start();
    if (phase !== 'writing') {
      book.tick(10_000);
      book.tick(PAGE_TURN_SECONDS * (phase === 'outgoing' ? 0.25 : 0.75));
    } else book.tick(0.2);
    book.pause();
    const before = book.peek();
    const turn = book.turnProgress;
    const count = book.sourceReadCount;
    const index = book.activePageIndex;
    for (const delta of [10_000, 0, -1, NaN, Infinity]) {
      assert.deepEqual(book.tick(delta).pen, before);
      assert.equal(book.sourceReadCount, count);
      assert.equal(book.activePageIndex, index);
      assert.equal(book.turnProgress, turn);
    }
    book.resume();
    const resumed = book.peek();
    for (const delta of [0, -1, NaN, Infinity]) {
      assert.deepEqual(book.tick(delta).pen, resumed);
      assert.equal(book.sourceReadCount, count);
    }
  }
});

test('reset cancels pending text and turns without fetching, and the next start begins a fresh bounded stream', () => {
  const { book, errors } = create(catalog, small);
  book.start();
  collect(book, 4);
  book.tick(10_000);
  book.tick(PAGE_TURN_SECONDS * 0.25);
  book.reset();
  assert.equal(book.status, 'idle');
  assert.equal(book.activePageIndex, 0);
  assert.equal(book.activePage.text, '');
  assert.equal(book.bufferedCharacterCount, 0);
  assert.equal(book.sourceReadCount, 0);
  assert.equal(book.turnProgress, null);
  book.tick(10_000);
  assert.equal(book.sourceReadCount, 0);
  book.start();
  assert.ok(book.activePage.text.startsWith('Title '));
  assert.equal(book.startedStrokeCount, 0);
  collect(book, 2, true);
  assert.deepEqual(errors, []);
});

test('continuous swaps keep final ink separate and report the incoming target through reduced or animated turns', () => {
  for (const reduced of [false, true]) {
    const { book } = create(catalog, small);
    book.setReducedMotion(reduced);
    book.start();
    const final = book.tick(10_000);
    assert.ok(final.segments.length);
    assert.equal(final.pageChanged, false);
    assert.equal(book.turnProgress, 0);
    assert.equal(final.pen.status, 'writing');
    const swap = book.tick(reduced ? 0.001 : PAGE_TURN_SECONDS * 0.6);
    assert.equal(swap.pageChanged, true);
    assert.equal(swap.previousPageIndex, 0);
    assert.deepEqual(swap.segments, []);
    if (book.activePage.layout.strokes.length) {
      assert.deepEqual(point(swap.pen), book.activePage.layout.strokes[0][0]);
    }
    assert.equal(swap.pen.contact, false);
    assert.equal(book.startedStrokeCount, 0);
  }
});

test('explicit blank stream pages preserve all newlines and a contact-free page-start target', () => {
  const work = reading('A', `${'\n'.repeat(30)}One final line.`);
  const { book, errors } = create([work], { ...small, textScale: 2, height: 400 });
  book.start();
  const firstStart = book.activePage.layout.strokes[0][0];
  const pages = collect(book, 20, true);
  assert.ok(pages.some((page) => page.layout.strokes.length === 0));
  const actual = pages.map((page) => page.text).join('') + book.activePage.text;
  assert.equal(actual, formatReading(work).repeat(book.sourceReadCount).slice(0, actual.length));
  assert.equal(book.peek().contact, false);
  assert.ok(firstStart.x > 0 && firstStart.y > 0);
  assert.ok(book.peek().x > 0 && book.peek().y > 0);
  assert.deepEqual(errors, []);
});

test('paused continuous reflow preserves complete started glyphs and never fetches while paused', () => {
  const long = reading('Long', 'W'.repeat(3900));
  const { book, errors } = create([long], options);
  const beforeInk = pauseWithInk(book);
  const before = book.peek();
  const original = book.activePage.layout;
  const first = original.characters[0];
  const count = book.sourceReadCount;
  const buffered = book.bufferedCharacterCount;
  for (const textScale of [2, 0.75, 2, 0.75, 2]) {
    const changed = book.reflow({ ...options, style: 'correspondence', textScale, textAlignment: 'center' });
    assert.equal(changed.ok, true, changed.error);
    assert.equal(book.sourceReadCount, count);
    assert.equal(book.bufferedCharacterCount, buffered);
    assert.deepEqual(book.peek(), before);
    assert.deepEqual(book.activePage.layout.characters[0], first);
    assert.deepEqual(book.activePage.layout.strokes.slice(0, first.strokeEnd), original.strokes.slice(0, first.strokeEnd));
    assert.equal(book.pages.length, 1);
  }
  const expectedRemainingInk = pathLength(book.activePage.layout.strokes) - segmentLength(beforeInk);
  book.resume();
  const drawn = book.tick(10_000);
  close(segmentLength(drawn.segments), expectedRemainingInk);
  assert.equal(drawn.pageChanged, false);
  const completed = [book.activePage];
  assert.equal(book.tick(10_000).pageChanged, true);
  completed.push(...collect(book, 40));
  const written = completed.map((page) => page.text).join('') + book.activePage.text;
  const source = formatReading(long).repeat(book.sourceReadCount);
  assert.equal(source.slice(0, written.length), written);
  assert.equal(source.length - written.length, book.pendingCharacterCount);
  assert.deepEqual(errors, []);
});

test('shrinking the final buffered words fetches only on resume, fills the same page and does not skip text', () => {
  const works = [reading('A', 'One.'), reading('B', 'Two.')];
  const layout = { ...options, textScale: 2 };
  const { book } = create(works, layout, () => 0.99);
  pauseWithInk(book);
  const before = book.peek();
  const pulls = book.sourceReadCount;
  assert.equal(book.reflow({ ...options, textScale: 0.75 }).ok, true);
  assert.equal(book.sourceReadCount, pulls);
  assert.deepEqual(book.peek(), before);
  const index = book.activePageIndex;
  book.resume();
  assert.equal(book.activePageIndex, index);
  assert.ok(book.sourceReadCount > pulls);
  assert.equal(book.turnProgress, null);
  assert.ok(book.activePage.text.startsWith(formatReading(works[0])));
});

test('continuous completed-letter boundary previews can reopen the same page without replay or reordered suffixes', () => {
  const work = { ...reading('A', 'C'), title: 'A WW', author: 'B' };
  const layout = { ...options, width: 160, height: 100 };
  const { book } = create([work], layout);
  book.start();
  const initial = book.activePage;
  const first = initial.layout.characters[0];
  for (let i = 0; i < 100_000 && !(book.startedStrokeCount === first.strokeEnd && !book.peek().contact); i++) {
    book.tick(0.001);
  }
  book.pause();
  const before = book.peek();
  const count = book.sourceReadCount;
  const buffered = book.bufferedCharacterCount;
  for (let i = 0; i < 3; i++) {
    assert.equal(book.reflow({ ...layout, style: 'correspondence' }).ok, true);
    assert.equal(book.activePage.text, 'A ');
    assert.deepEqual(book.activePage.layout.strokes, initial.layout.strokes.slice(0, first.strokeEnd));
    assert.deepEqual(book.peek(), before);
    assert.equal(book.sourceReadCount, count);
    assert.equal(book.bufferedCharacterCount, buffered);
    assert.equal(book.turnProgress, null);
  }
  assert.equal(book.reflow(layout).ok, true);
  assert.deepEqual(book.peek(), before);
  assert.equal(book.activePage.text, initial.text);
  book.resume();
  const frame = book.tick(10_000);
  assert.deepEqual(frame.segments[0].from, initial.layout.strokes[first.strokeEnd][0]);
  close(segmentLength(frame.segments), pathLength(initial.layout.strokes.slice(first.strokeEnd)));
  assert.equal(frame.pageChanged, false);
  assert.equal(book.status, 'writing');
  assert.equal(book.tick(10_000).pageChanged, true);
});

test('reflow errors are atomic after many pages and earlier page objects remain immutable', () => {
  const { book } = create(catalog, small);
  book.start();
  const prior = collect(book, 35);
  const old = structuredClone(prior[0]);
  pauseWithInk(book);
  const before = book.peek();
  const pages = book.pages;
  const sourceCount = book.sourceReadCount;
  const buffered = book.bufferedCharacterCount;
  for (const invalid of [{ height: 1 }, { textScale: NaN }, { textAlignment: 'invalid' }]) {
    const failed = book.reflow({ ...small, ...invalid });
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.pages, []);
    assert.equal(book.pages, pages);
    assert.deepEqual(book.peek(), before);
    assert.equal(book.bufferedCharacterCount, buffered);
    assert.equal(book.sourceReadCount, sourceCount);
  }
  assert.deepEqual(prior[0], old);
  assert.equal(book.activePageIndex, 35);
});

test('outgoing-turn reflow changes only future typography and preserves the unconsumed suffix', () => {
  const { book } = create(catalog, options);
  book.start();
  book.tick(10_000);
  book.tick(PAGE_TURN_SECONDS * 0.2);
  book.pause();
  const outgoing = book.activePage;
  const before = book.peek();
  const buffered = book.bufferedCharacterCount;
  const pulls = book.sourceReadCount;
  for (const textScale of [2, 0.75, 2]) {
    assert.equal(book.reflow({ ...options, textScale }).ok, true);
    assert.equal(book.activePage, outgoing);
    assert.deepEqual(book.peek(), before);
    assert.equal(book.sourceReadCount, pulls);
    assert.equal(book.bufferedCharacterCount, buffered);
  }
  book.resume();
  assert.equal(book.tick(PAGE_TURN_SECONDS).pageChanged, true);
  assert.ok(book.activePage.layout.characters.every(({ after }) => after.textScale === 2));
});

test('repeated incoming-turn typography changes preserve turn position and fetch nothing until writing resumes', () => {
  const { book } = create(catalog, options);
  book.start();
  book.tick(10_000);
  book.tick(PAGE_TURN_SECONDS * 0.7);
  book.pause();
  const turn = book.turnProgress;
  const index = book.activePageIndex;
  const count = book.sourceReadCount;
  const buffered = book.bufferedCharacterCount;
  for (const textScale of [0.75, 2, 0.75]) {
    assert.equal(book.reflow({ ...options, textScale, textAlignment: 'center' }).ok, true);
    assert.equal(book.turnProgress, turn);
    assert.equal(book.activePageIndex, index);
    assert.equal(book.sourceReadCount, count);
    assert.equal(book.bufferedCharacterCount, buffered);
    assert.equal(book.startedStrokeCount, 0);
    assert.equal(book.peek().contact, false);
    if (book.activePage.layout.strokes.length) {
      assert.deepEqual(point(book.peek()), book.activePage.layout.strokes[0][0]);
    }
  }
  book.resume();
  assert.deepEqual(book.tick(PAGE_TURN_SECONDS).segments, []);
  collect(book, 3);
});

test('source failures pause once per attempt and recover without losing successfully staged readings', () => {
  const good = reading('A', 'First.');
  const bad = reading('B', 'bad\tbody');
  const { book, errors } = create([good, bad], options, () => 0.99);
  book.start();
  assert.equal(book.status, 'paused');
  assert.equal(errors.length, 1);
  assert.equal(book.sourceReadCount, 1);
  assert.equal(book.pendingCharacterCount, formatReading(good).length);
  assert.equal(book.activePage.text, '');
  for (let i = 0; i < 100; i++) book.tick(10_000);
  assert.equal(errors.length, 1);
  assert.equal(book.sourceReadCount, 1);
  book.resume();
  assert.equal(errors.length, 2);
  bad.text = 'Repaired.';
  book.resume();
  assert.equal(book.status, 'writing');
  assert.ok(book.activePage.text.startsWith(formatReading(good) + formatReading(bad)));
  assert.equal(errors.length, 2);
  collect(book, 3);
});

test('a source failure at midpoint does not swap, complete, retry, or lose the old page', () => {
  const good = reading('A', 'W'.repeat(140));
  const bad = reading('B', '\t');
  const { book, errors } = create([good, bad], small, () => 0.99);
  book.start();
  let before;
  for (let i = 0; i < 100 && book.status === 'writing'; i++) {
    before = { page: book.activePage, index: book.activePageIndex };
    const frame = book.tick(10_000);
    if (book.status === 'paused') assert.equal(frame.pageChanged, false);
  }
  assert.equal(book.status, 'paused');
  assert.equal(errors.length, 1);
  assert.equal(book.activePageIndex, before.index);
  assert.equal(book.activePage, before.page);
  assert.equal(book.turnProgress, 0.5);
  const pen = book.peek();
  for (let i = 0; i < 10; i++) assert.deepEqual(book.tick(10_000).pen, pen);
  assert.equal(errors.length, 1);
  bad.text = 'Now available.';
  book.resume();
  const swap = book.tick(10_000);
  assert.equal(swap.pageChanged, true);
  assert.equal(swap.previousPageIndex, before.index);
  assert.deepEqual(swap.segments, []);
  assert.equal(book.status, 'writing');
});

test('empty catalogs, invalid randomness, callback exceptions and enormous sheets fail without busy loops', (t) => {
  const notices = [];
  t.mock.method(console, 'error', (...message) => notices.push(message));
  for (const [readings, random] of [[[], seed()], [catalog, () => NaN]]) {
    let errors = 0;
    const book = createContinuousBook(readings, options, tool, () => { errors++; throw new Error('UI failure'); }, random);
    assert.doesNotThrow(() => book.start());
    assert.equal(book.status, 'paused');
    for (let i = 0; i < 100; i++) book.tick(10_000);
    assert.equal(errors, 1);
    assert.equal(book.sourceReadCount, 0);
    book.reset();
    assert.equal(book.bufferedCharacterCount, 0);
  }
  const { book, errors } = create([reading('A', 'One.')], { ...options, width: 1e8, height: 1e8 });
  book.start();
  assert.equal(book.status, 'paused');
  assert.equal(book.sourceReadCount, MAX_READINGS_PER_FILL);
  assert.ok(book.bufferedCharacterCount <= MAX_CHARACTERS);
  assert.equal(errors.length, 1);
  book.tick(10_000);
  assert.equal(book.sourceReadCount, MAX_READINGS_PER_FILL);
  assert.equal(notices.length, 2, 'failed notifications must be logged rather than swallowed');
});

test('continuous nib/speed changes persist across pages while manual ten-page APIs remain unchanged', () => {
  const { book } = create(catalog, small);
  pauseWithInk(book);
  const before = book.peek();
  const changed = { pen: 'dip', nib: 'broad', speed: 2 };
  book.updateOptions(changed);
  assert.deepEqual(book.peek(), before);
  book.resume();
  book.tick(10_000);
  book.tick(10_000);
  const engine = new WritingEngine(book.activePage.layout, changed);
  engine.start();
  assert.deepEqual(book.tick(10_000).segments, engine.tick(10_000).segments);
  const oneLine = { ...small, width: 160, height: 100 };
  const ten = layoutPages(Array(10).fill('A').join('\n'), oneLine);
  const manual = new WritingBook(ten, tool);
  assert.equal(manual.continuous, false);
  assert.equal(manual.activePage, manual.pages[0]);
  assert.equal(manual.pageCount, 10);
  const eleven = layoutPages(Array(11).fill('A').join('\n'), oneLine);
  assert.equal(eleven.ok, false);
  assert.deepEqual(eleven.pages, []);
});
