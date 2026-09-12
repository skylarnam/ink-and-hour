import test from 'node:test';
import assert from 'node:assert/strict';
import { HANDWRITING_IDS } from '../src/handwriting.ts';
import { MAX_CHARACTERS, MAX_PAGES, layoutText, layoutPages } from '../src/writing/index.ts';

const page = { width: 780, height: 1040, style: 'correspondence' };
const small = { width: 160, height: 100, style: 'pangolin' };
const normalized = (text) => text.replace(/\r\n?/g, '\n');

function assertComplete(source, result) {
  assert.equal(result.ok, true, result.error);
  const text = normalized(source);
  assert.equal(result.characterCount, text.length);
  assert.equal(result.pages.map((page) => page.text).join(''), text);
  for (const { text, layout } of result.pages) {
    assert.equal(layout.ok, true);
    assert.equal(layout.characterCount, text.length);
    assert.deepEqual(layout.characters.map(({ index }) => index),
      [...text].flatMap((character, index) => /[!-~]/.test(character) ? [index] : []));
    let end = 0;
    for (const character of layout.characters) {
      assert.equal(character.strokeStart, end);
      assert.ok(character.strokeEnd > character.strokeStart);
      end = character.strokeEnd;
    }
    assert.equal(end, layout.strokes.length);
  }
}

test('single-page layouts retain their exact geometry and the safety cap is independent of physical capacity', () => {
  assert.equal(MAX_CHARACTERS, 20_000);
  assert.equal(MAX_PAGES, 10);
  for (const text of ['Hello, ink!\n\nStay.\n', 'i'.repeat(500), '  Hello.  ']) {
    const result = layoutPages(text, page);
    assertComplete(text, result);
    assert.equal(result.pages.length, 1);
    assert.deepEqual(result.pages[0].layout, layoutText(text, page));
  }
  const two = layoutPages('A\nB', small);
  assert.equal(two.pages.length, 2);
  assert.equal(layoutText('A\nB', small).ok, false);
  assert.equal(layoutPages('A\nB', small, 1).ok, false);
});

test('one, two and exactly ten real pages fit; an eleventh page fails without partial geometry', () => {
  for (const count of [1, 2, 10]) {
    const text = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i)).join('\n');
    const result = layoutPages(text, small);
    assertComplete(text, result);
    assert.equal(result.pages.length, count);
  }
  for (const text of [Array(11).fill('A').join('\n'), `${Array(10).fill('A').join('\n')}\n`]) {
    const result = layoutPages(text, small);
    assert.equal(result.ok, false);
    assert.match(result.error, /10-page limit/);
    assert.deepEqual(result.pages, []);
  }
});

test('CRLF and bare carriage returns normalize once across physical page boundaries', () => {
  const source = 'A\r\n\r\nB\r C\r\n';
  const result = layoutPages(source, small);
  assertComplete(source, result);
  assert.deepEqual(result, layoutPages(normalized(source), small));
});

test('explicit blank pages, leading whitespace and a final empty page retain every line break', () => {
  for (const text of ['\n\nA\n\n', '  \n  A\n \n', 'A\n', `${' '.repeat(200)}A  `,
    `A${' '.repeat(200)}`, 'A\n\n\n\n\n\n\n\n\n']) {
    const result = layoutPages(text, small);
    assertComplete(text, result);
    assert.ok(result.pages.length <= MAX_PAGES);
  }
  assert.deepEqual(layoutPages('\n\nA\n\n', small).pages.map((page) => page.text),
    ['\n', '\n', 'A\n', '\n', '']);
  assert.deepEqual(layoutPages('A\n', small).pages.map((page) => page.layout.strokes.length > 0), [true, false]);
  for (const text of ['', '   ', '\n', '\r\n \r\n']) {
    const result = layoutPages(text, small);
    assert.equal(result.ok, false);
    assert.deepEqual(result.pages, []);
  }
});

test('fitting words stay together at a physical boundary and long words split without changing traversal', () => {
  const words = layoutPages('AAAA BBBB', small);
  assertComplete('AAAA BBBB', words);
  assert.deepEqual(words.pages.map((page) => page.text), ['AAAA ', 'BBBB']);
  assert.deepEqual(words.pages[1].layout.strokes, layoutText('BBBB', small).strokes);
  const source = 'W'.repeat(30);
  const long = layoutPages(source, small);
  assertComplete(source, long);
  assert.equal(long.pages.length, 6);
  for (const sheet of long.pages) {
    assert.equal(sheet.text, 'WWWWW');
    assert.deepEqual(sheet.layout.strokes, layoutText(sheet.text, small).strokes);
  }
});

test('punctuation and every printable glyph are retained exactly, with page-relative indexes', () => {
  const source = Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index)).join('');
  const result = layoutPages(source, { ...small, height: 200 });
  assertComplete(source, result);
  assert.ok(result.pages.length > 1);
  for (const sheet of result.pages) {
    for (const character of sheet.layout.characters) {
      const standalone = layoutText(sheet.text[character.index], { ...page, style: small.style });
      const strokes = sheet.layout.strokes.slice(character.strokeStart, character.strokeEnd);
      assert.equal(strokes.length, standalone.strokes.length);
      const shift = {
        x: strokes[0][0].x - standalone.strokes[0][0].x,
        y: strokes[0][0].y - standalone.strokes[0][0].y,
      };
      for (let s = 0; s < strokes.length; s++) {
        assert.equal(strokes[s].length, standalone.strokes[s].length);
        for (let p = 0; p < strokes[s].length; p++) {
          assert.ok(Math.abs(strokes[s][p].x - standalone.strokes[s][p].x - shift.x) < 1e-8);
          assert.ok(Math.abs(strokes[s][p].y - standalone.strokes[s][p].y - shift.y) < 1e-8);
        }
      }
    }
  }
});

test('all 34 hands paginate at both size/alignment extremes with finite centered ink on each page', () => {
  assert.equal(HANDWRITING_IDS.length, 34);
  const source = 'Ab, !\n\n'.repeat(7);
  for (const style of HANDWRITING_IDS) {
    for (const textScale of [0.75, 2]) {
      for (const textAlignment of ['left', 'center']) {
        const options = { ...page, style, textScale, textAlignment };
        const result = layoutPages(source, options);
        assertComplete(source, result);
        for (const sheet of result.pages) {
          const lines = new Map();
          for (const character of sheet.layout.characters) {
            const points = sheet.layout.strokes.slice(character.strokeStart, character.strokeEnd).flat();
            const line = lines.get(character.after.line) ?? [];
            line.push(...points);
            lines.set(character.after.line, line);
          }
          for (const points of lines.values()) {
            let minX = Infinity;
            let maxX = -Infinity;
            for (const point of points) {
              assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), style);
              assert.ok(point.x >= 75.5 - 1e-8 && point.x <= 704.5 + 1e-8, style);
              assert.ok(point.y >= 87.5 - 1e-8 && point.y <= 962.5 + 1e-8, style);
              minX = Math.min(minX, point.x);
              maxX = Math.max(maxX, point.x);
            }
            if (textAlignment === 'center') assert.ok(Math.abs((minX + maxX) / 2 - 390) < 1e-8, style);
          }
        }
      }
    }
  }
});

test('invalid geometry and text fail atomically; the safety cap is checked before layout', () => {
  const unreadOptions = new Proxy({}, { get() { throw new Error('Options must not be read over the safety cap'); } });
  assert.match(layoutPages('W'.repeat(MAX_CHARACTERS + 1), unreadOptions).error, /20000/);
  for (const text of ['hello\tink', 'hello🌱', 'a\u0000b', 'café']) {
    const result = layoutPages(text, page);
    assert.equal(result.ok, false);
    assert.match(result.error, /English ASCII/);
    assert.deepEqual(result.pages, []);
  }
  for (const options of [{ width: NaN }, { width: 2 }, { height: Infinity }, { height: 1 },
    { textScale: 2.1 }, { textAlignment: 'right' }, { style: 'unknown' }]) {
    const result = layoutPages('A\nB', { ...page, ...options });
    assert.equal(result.ok, false);
    assert.deepEqual(result.pages, []);
  }
  for (const count of [0, -1, 1.1, 11, Infinity, NaN]) {
    assert.equal(layoutPages('Hello', page, count).ok, false);
  }
  const overflow = layoutPages('W'.repeat(MAX_CHARACTERS), small);
  assert.equal(overflow.ok, false);
  assert.match(overflow.error, /10-page limit/);
  assert.deepEqual(overflow.pages, []);
});
