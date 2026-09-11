import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { createHash } from 'node:crypto';
import fonts from '../src/writing/fonts.json' with { type: 'json' };
import { HANDWRITING_FONT_DATA, handwritingFontData } from '../src/writing/font-data.ts';
import { layoutText, parseStrokePath } from '../src/writing/index.ts';
import { HANDWRITING_IDS, HANDWRITING_STYLES, handwritingStyle } from '../src/handwriting.ts';

const page = { width: 780, height: 1040 };
const printableAscii = Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33)).join('');
const sourceFont = (style) => {
  const path = new URL(`../public${style.publicFontPath}`, import.meta.url);
  const bytes = readFileSync(path);
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

test('registry exports 22 distinct handwriting choices with stable lookups', () => {
  assert.equal(HANDWRITING_STYLES.length, 22);
  assert.deepEqual(HANDWRITING_IDS, HANDWRITING_STYLES.map((style) => style.id));
  assert.equal(new Set(HANDWRITING_IDS).size, 22);
  for (const style of HANDWRITING_STYLES) {
    assert.equal(handwritingStyle(style.id), style);
    assert.ok(style.label.length > 0);
    assert.ok(style.family.length > 0);
    assert.ok(Number.isFinite(style.editorSize) && style.editorSize > 0);
    assert.equal(typeof style.script, 'boolean');
    assert.match(style.source, /^https:\/\/(raw\.githubusercontent\.com|github\.com)\//);
    assert.ok(style.publicLicensePath.startsWith('/'));
  }
});

test('every metadata record points at a real local source font and its matching license text', () => {
  for (const style of HANDWRITING_STYLES) {
    if (style.id === 'correspondence' || style.id === 'print') {
      assert.equal(existsSync(new URL(`../public${style.publicFontPath}`, import.meta.url)), true);
      assert.equal(existsSync(new URL('../public/data/HERSHEY-ATTRIBUTION.txt', import.meta.url)), true);
      continue;
    }
    const fontPath = new URL(`../public${style.publicFontPath}`, import.meta.url);
    const licensePath = new URL(`../public${style.publicLicensePath}`, import.meta.url);
    assert.equal(existsSync(fontPath), true, style.id);
    assert.equal(existsSync(licensePath), true, style.id);
    const license = readFileSync(licensePath, 'utf8');
    if (style.license === 'OFL-1.1') {
      assert.match(license, /Open Font License|SIL OPEN FONT LICENSE/i, style.id);
    } else {
      assert.match(license, /Apache License/i, style.id);
      assert.match(license, /Version 2\.0/i, style.id);
    }
    const face = sourceFont(style);
    assert.equal(face.names.fontFamily.en, style.family, style.id);
    for (let code = 32; code <= 126; code++) {
      assert.notEqual(face.charToGlyphIndex(String.fromCharCode(code)), 0, `${style.id}: ${code}`);
    }
  }
});

test('generated centerline data covers 20 additional families while legacy paths stay exact', () => {
  assert.equal(Object.keys(HANDWRITING_FONT_DATA).length, 22);
  assert.equal(handwritingFontData('correspondence').exactOriginal, true);
  assert.equal(handwritingFontData('print').exactOriginal, true);
  assert.deepEqual(handwritingFontData('correspondence').chars, fonts.correspondence.chars);
  assert.deepEqual(handwritingFontData('print').chars, fonts.print.chars);
  for (const id of HANDWRITING_IDS) {
    const font = handwritingFontData(id);
    assert.equal(font.id, id);
    assert.equal(font.chars.length, 94, id);
    assert.ok(Number.isFinite(font.space) && font.space > 0, id);
    assert.ok(Number.isFinite(font.scale) && font.scale > 0, id);
    assert.ok(Number.isFinite(font.lineHeight) && font.lineHeight > 0, id);
    for (const glyph of font.chars) {
      assert.ok(Number.isFinite(glyph.o) && glyph.o > 0, `${id} advance`);
      const strokes = parseStrokePath(glyph.d);
      assert.ok(strokes.length > 0, `${id} stroke`);
      for (const stroke of strokes) {
        assert.ok(stroke.length >= 2, `${id} segment`);
        for (const point of stroke) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${id} finite`);
        }
      }
    }
  }
});

test('all handwriting styles can lay out full ASCII content within finite page bounds', () => {
  for (const id of HANDWRITING_IDS) {
    const result = layoutText(printableAscii, { ...page, style: id });
    assert.equal(result.ok, true, `${id}: ${result.error}`);
    assert.equal(result.characterCount, printableAscii.length);
    assert.ok(result.strokes.length > 0, id);
    assert.ok(result.lineCount >= 1, id);
    for (const point of result.strokes.flat()) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${id} finite point`);
      assert.ok(point.x >= 3.5 && point.x <= page.width - 3.5, `${id} x bound`);
      assert.ok(point.y >= 3.5 && point.y <= page.height - 3.5, `${id} y bound`);
    }
  }
});

test('representative multiword samples wrap and stay drawable for every source family', () => {
  const sample = 'Pack my box with five dozen liquor jugs. 1234567890';
  for (const style of HANDWRITING_STYLES) {
    const result = layoutText(sample, { ...page, style: style.id });
    assert.equal(result.ok, true, `${style.id}: ${result.error}`);
    assert.ok(result.strokes.length > 0);
    const narrow = layoutText(sample, { width: 320, height: page.height, style: style.id });
    assert.equal(narrow.ok, true, `${style.id}: ${narrow.error}`);
    assert.ok(narrow.lineCount >= result.lineCount);
  }
});

test('a simple inferred stem finishes at its endpoint instead of retracing the whole stroke', () => {
  const glyph = handwritingFontData('patrick-hand').chars['l'.charCodeAt(0) - 33];
  const strokes = parseStrokePath(glyph.d);
  assert.equal(strokes.length, 1);
  const points = strokes[0];
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const length = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
  assert.ok(distance(points[0], points.at(-1)) > length * 0.8);
});

test('added font derivations have distinct study names and exact source/license checksums', () => {
  const provenance = JSON.parse(readFileSync(new URL('../public/data/HANDWRITING-ATTRIBUTION.json', import.meta.url), 'utf8'));
  assert.equal(provenance.fonts.length, 20);
  assert.deepEqual(provenance.tinyPunctuationFallbacks, ['coming-soon:.', 'coming-soon::', 'schoolbell:.']);
  for (const record of provenance.fonts) {
    assert.match(record.strokeStudy, /^Ink Stroke Study \d{2}$/);
    assert.equal(record.strokeStudy, handwritingFontData(record.id).name);
    for (const [file, expected] of [[record.font, record.fontSha256], [record.licenseFile, record.licenseSha256]]) {
      const bytes = readFileSync(new URL(`../public${file}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
    }
  }
});
