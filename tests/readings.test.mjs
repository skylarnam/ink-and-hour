import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as readings from '../src/readings.ts';
import { createContinuousBook } from '../src/writing/index.ts';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';
import { PAGE } from '../src/types.ts';

const { READINGS } = readings;
const expected = [
  ['shakespeare-sonnet-18', 'William Shakespeare', 1609, 1616, 14, 1,
    "Shall I compare thee to a summer's day?", 'So long lives this and this gives life to thee.'],
  ['shakespeare-sonnet-29', 'William Shakespeare', 1609, 1616, 14, 1,
    "When, in disgrace with fortune and men's eyes,", 'That then I scorn to change my state with kings.'],
  ['shakespeare-sonnet-116', 'William Shakespeare', 1609, 1616, 14, 1,
    'Let me not to the marriage of true minds', "I never writ, nor no man ever lov'd."],
  ['blake-the-lamb', 'William Blake', 1789, 1827, 20, 2,
    'Little Lamb who made thee', 'Little Lamb God bless thee.'],
  ['blake-the-tyger', 'William Blake', 1794, 1827, 24, 6,
    'Tyger Tyger, burning bright,', 'Dare frame thy fearful symmetry?'],
  ['blake-a-poison-tree', 'William Blake', 1794, 1827, 16, 4,
    'I was angry with my Friend:', 'My foe outstretchd beneath the tree.'],
  ['wordsworth-i-wandered-lonely-as-a-cloud', 'William Wordsworth', 1807, 1850, 24, 4,
    'I wandered lonely as a Cloud', 'And dances with the Daffodils.'],
  ['wordsworth-my-heart-leaps-up', 'William Wordsworth', 1807, 1850, 9, 1,
    'My heart leaps up when I behold', 'Bound each to each by natural piety.'],
  ['keats-on-first-looking-into-chapmans-homer', 'John Keats', 1816, 1821, 14, 1,
    "Much have I travell'd in the realms of gold,", 'Silent, upon a peak in Darien.'],
  ['keats-to-autumn', 'John Keats', 1820, 1821, 33, 3,
    'Season of mists and mellow fruitfulness!', 'And gathering swallows twitter in the skies.'],
  ['shelley-ozymandias', 'Percy Bysshe Shelley', 1818, 1822, 14, 1,
    'I met a Traveller from an antique land,', 'The lone and level sands stretch far away.'],
  ['shelley-music-when-soft-voices-die', 'Percy Bysshe Shelley', 1824, 1822, 8, 2,
    'Music, when soft voices die,', 'Love itself shall slumber on.'],
];

test('readings exports exactly twelve distinct local works through the frozen contract', () => {
  assert.deepEqual(Object.keys(readings), ['READINGS']);
  assert.equal(READINGS.length, 12);
  assert.equal(new Set(READINGS.map(({ id }) => id)).size, 12);
  assert.equal(new Set(READINGS.map(({ text }) => text)).size, 12);
  assert.equal(new Set(READINGS.map(({ author }) => author)).size, 5);
  assert.deepEqual(READINGS.map(({ id }) => id).sort(), expected.map(([id]) => id).sort());

  for (const reading of READINGS) {
    assert.deepEqual(Object.keys(reading).sort(),
      ['id', 'title', 'author', 'year', 'authorDied', 'source', 'text'].sort());
    assert.match(reading.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for (const field of ['title', 'author']) {
      assert.equal(typeof reading[field], 'string', `${reading.id}: ${field}`);
      assert.match(reading[field], /^[\x20-\x7e]+$/, `${reading.id}: ${field}`);
      assert.equal(reading[field], reading[field].trim());
      assert.ok(reading[field].length > 0 && reading[field].length < 100);
    }
    assert.equal(typeof reading.source, 'string');
    const source = new URL(reading.source);
    assert.equal(source.protocol, 'https:');
    assert.equal(source.hostname, 'en.wikisource.org');
    assert.ok(source.pathname.startsWith('/wiki/'));
    assert.equal(source.username, '');
    assert.equal(source.password, '');
    assert.ok(Number.isInteger(reading.year) && reading.year >= 1500 && reading.year < 1900);
    assert.ok(Number.isInteger(reading.authorDied) && reading.authorDied >= 1500 && reading.authorDied < 1900);
    // First publication can be posthumous; it is not the edition/transcription date.
    assert.ok(reading.year >= reading.authorDied - 100 && reading.year <= reading.authorDied + 100);
  }
});

test('all poem bodies are bounded printable ASCII with clean verse line breaks', () => {
  for (const { id, title, author, text } of READINGS) {
    assert.equal(typeof text, 'string', id);
    assert.match(text, /^[\x20-\x7e\n]+$/, id);
    assert.ok(text.length >= 100 && text.length < 4000, `${id}: body length`);
    assert.equal(text, text.trim(), id);
    assert.ok(text.includes('\n'), id);
    assert.ok(!text.includes('\n\n\n'), `${id}: excess blank lines`);
    const lines = text.split('\n');
    assert.ok(lines.length >= 8 && lines.length <= 64, `${id}: line count`);
    for (const line of lines) {
      assert.equal(line, line.trim(), `${id}: line whitespace`);
      assert.ok(line.length < 120, `${id}: unbounded line`);
    }
    assert.ok(!lines.includes(title), `${id}: repeated title`);
    assert.ok(!lines.includes(author), `${id}: repeated author`);
    assert.doesNotMatch(text, /https?:\/\/|<\/?[a-z]|Wikisource|Public domain/, id);
  }
});

test('the actual collection starts safely in every approved handwriting at both size extremes', () => {
  for (const { id: style } of HANDWRITING_STYLES) {
    for (const textScale of [0.75, 2]) {
      const errors = [];
      const book = createContinuousBook(READINGS, { ...PAGE, style, textScale },
        { pen: 'fountain', nib: 'flex', speed: 1 }, (message) => errors.push(message), () => 0.5);
      assert.equal(book.sourceReadCount, 0);
      book.start();
      assert.deepEqual(errors, []);
      assert.equal(book.status, 'writing', `${style} at ${textScale}`);
      assert.ok(book.activePage.text.length > 0);
      assert.ok(book.activePage.layout.strokes.length > 0);
      assert.equal(book.bufferedPageCount, 1);
      assert.ok(book.bufferedCharacterCount <= 20_000);
      book.pause();
    }
  }
});

test('known publication dates, complete line counts, and opening/closing lines match the editions', () => {
  for (const [id, author, year, authorDied, lineCount, stanzaCount, opening, closing] of expected) {
    const reading = READINGS.find((entry) => entry.id === id);
    assert.ok(reading, id);
    assert.deepEqual([reading.author, reading.year, reading.authorDied], [author, year, authorDied], id);
    const lines = reading.text.split('\n').filter(Boolean);
    assert.equal(lines.length, lineCount, id);
    assert.equal(reading.text.split('\n\n').length, stanzaCount, id);
    assert.equal(lines[0], opening, id);
    assert.equal(lines.at(-1), closing, id);
  }
});

test('edition-specific wording and documented ASCII punctuation are not silently modernized', () => {
  const text = (id) => READINGS.find((reading) => reading.id === id).text;
  assert.ok(text('shakespeare-sonnet-29').includes('Yet in these thoughts my self almost despising,'));
  assert.ok(text('shakespeare-sonnet-116').includes("Whose worth 's unknown, although his height be taken."));
  assert.ok(text('blake-the-tyger').includes('What the hand dare sieze the fire?'));
  assert.ok(text('blake-a-poison-tree').includes('And I waterd it in fears,\nNight & morning with my tears:'));
  assert.ok(text('wordsworth-i-wandered-lonely-as-a-cloud').includes('What wealth the shew to me had brought:'));
  assert.ok(text('keats-on-first-looking-into-chapmans-homer').includes('He stared at the Pacific--and all his men'));
  assert.ok(text('shelley-ozymandias').includes('Stand in the desart. Near them, on the sand,'));
  assert.ok(text('shelley-ozymandias').includes('No thing beside remains. Round the decay'));
  assert.ok(text('shelley-music-when-soft-voices-die').includes('Vibrates in the memory--'));
});

test('every bundled work has local source, edition, and public-domain attribution', () => {
  const credits = readFileSync(new URL('../public/texts/CREDITS.md', import.meta.url), 'utf8');
  for (const reading of READINGS) {
    const section = credits.split(`### ${reading.id}\n`)[1]?.split('\n### ')[0];
    assert.ok(section, `${reading.id}: missing credit section`);
    for (const value of [reading.title, reading.author, reading.year, reading.authorDied, reading.source]) {
      assert.ok(section.includes(String(value)), `${reading.id}: missing credit for ${value}`);
    }
    assert.ok(section.includes('Edition:'), `${reading.id}: missing edition`);
  }
  assert.ok(credits.includes('https://en.wikisource.org/wiki/Wikisource:Reusing_Wikisource_content'));
  assert.ok(credits.includes('ASCII'));
  assert.ok(credits.includes('public domain'));
});
