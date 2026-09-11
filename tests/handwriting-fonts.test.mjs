import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fonts from '../src/writing/fonts.json' with { type: 'json' };
import generated from '../src/writing/handwriting-fonts.json' with { type: 'json' };
import applied from '../font-review/applied-selection.json' with { type: 'json' };
import { HANDWRITING_FONT_DATA, handwritingFontData } from '../src/writing/font-data.ts';
import { layoutText, parseStrokePath } from '../src/writing/index.ts';
import { HANDWRITING_IDS, HANDWRITING_STYLES, handwritingStyle, isHandwritingId } from '../src/handwriting.ts';

const page = { width: 780, height: 1040 };
const printableAscii = Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33)).join('');
const sourceFont = (style) => {
  const path = new URL(`../public${style.publicFontPath}`, import.meta.url);
  const bytes = readFileSync(path);
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

test('the opt-in source fetcher uses upstream filenames rather than normalized review filenames', () => {
  const root = new URL('../', import.meta.url);
  const output = execFileSync(process.execPath, [
    '--experimental-strip-types', 'scripts/fetch-handwriting-fonts.ts', '--dry-run',
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n');
  const catalog = JSON.parse(readFileSync(new URL('../font-review/catalog.json', import.meta.url), 'utf8'));
  const expected = HANDWRITING_STYLES.filter(({ id }) => id !== 'correspondence').flatMap((style) => {
    const candidate = catalog.candidates.find(({ id }) => id === style.id);
    const base = style.source.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/tree/', '/');
    return [
      candidate.fontUrl ?? `${base}/${style.publicFontPath.split('/').at(-1)}`,
      candidate.licenseUrl ?? `${base}/${style.publicLicensePath.split('/').at(-1)}`,
    ];
  });
  assert.deepEqual(output, expected);
  assert.ok(output.some((url) => url.endsWith('/alexbrush/AlexBrush-Regular.ttf')));
  assert.ok(output.some((url) => url.endsWith('/caveat/Caveat[wght].ttf')));
});

test('registry exports exactly the 34 approved choices, independently of live review checkboxes', () => {
  assert.equal(applied.sourceRevision, 34);
  assert.equal(applied.sourceSha256, 'e85ec45ab27add6229642bf8a50fa1219be25c0f464b498339e55e6f1ca15658');
  assert.deepEqual(HANDWRITING_IDS, applied.selected);
  assert.equal(HANDWRITING_STYLES.length, 34);
  assert.deepEqual(HANDWRITING_IDS, HANDWRITING_STYLES.map((style) => style.id));
  assert.equal(new Set(HANDWRITING_IDS).size, 34);
  assert.equal(HANDWRITING_IDS[0], 'correspondence');
  assert.equal(applied.default, 'correspondence');
  assert.equal(isHandwritingId('print'), false);
  assert.equal(handwritingFontData('print'), undefined);
  assert.equal(applied.retained.length, 10);
  assert.equal(applied.added.length, 24);
  for (const style of HANDWRITING_STYLES) {
    assert.equal(handwritingStyle(style.id), style);
    assert.ok(style.label.length > 0);
    assert.ok(style.family.length > 0);
    assert.ok(Number.isFinite(style.editorSize) && style.editorSize >= 16 && style.editorSize <= 26);
    assert.equal(typeof style.script, 'boolean');
    assert.match(style.source, /^https:\/\/(raw\.githubusercontent\.com|github\.com)\//);
    assert.ok(style.publicLicensePath.startsWith('/'));
  }
});

test('retained editor sizes and the selected hand-print classifications are deliberate', () => {
  const retainedSizes = {
    correspondence: 18, caveat: 19, kalam: 18, 'nothing-you-could-do': 19,
    'reenie-beanie': 22, 'homemade-apple': 18, 'la-belle-aurore': 20,
    'cedarville-cursive': 20, 'dawning-of-a-new-day': 21, 'give-you-glory': 20,
  };
  for (const [id, size] of Object.entries(retainedSizes)) assert.equal(handwritingStyle(id).editorSize, size, id);
  const handPrint = ['delius-unicase', 'gochi-hand', 'nanum-pen-script', 'pangolin', 'rock-salt', 'walter-turncoat'];
  for (const id of applied.added) {
    const style = handwritingStyle(id);
    assert.equal(style.script, !handPrint.includes(id), id);
    const measured = applied.fonts.find((font) => font.id === id);
    assert.equal(style.editorSize, Math.min(26, Math.max(16, Math.round(9 / measured.sourceXHeight))), id);
  }
});

test('every metadata record points at a real local source font and its matching license text', () => {
  for (const style of HANDWRITING_STYLES) {
    if (style.id === 'correspondence') {
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
    const approved = applied.fonts.find((record) => record.id === style.id);
    for (const [path, checksum] of [[fontPath, approved.fontSha256], [licensePath, approved.licenseSha256]]) {
      assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), checksum, style.id);
    }
    for (let code = 32; code <= 126; code++) {
      assert.notEqual(face.charToGlyphIndex(String.fromCharCode(code)), 0, `${style.id}: ${code}`);
      if (code > 32 && !face.charToGlyph(String.fromCharCode(code)).path.commands.length) {
        assert.equal(`${style.id}:${String.fromCharCode(code)}`, 'italianno:_');
      }
    }
  }
});

test('33 inferred families cover full ASCII while all retained centerlines stay exact', () => {
  assert.equal(Object.keys(HANDWRITING_FONT_DATA).length, 34);
  assert.deepEqual(Object.keys(generated), HANDWRITING_IDS.filter((id) => id !== 'correspondence'));
  assert.equal(handwritingFontData('correspondence').exactOriginal, true);
  assert.deepEqual(handwritingFontData('correspondence').chars, fonts.correspondence.chars);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../src/writing/fonts.json', import.meta.url))).digest('hex'), applied.legacySourceSha256);
  assert.equal(applied.preservedCenterlines.length, 9);
  for (const { id, sha256 } of applied.preservedCenterlines) {
    assert.equal(createHash('sha256').update(JSON.stringify(generated[id])).digest('hex'), sha256, id);
  }
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
        assert.ok(stroke.some((point) => point.x !== stroke[0].x || point.y !== stroke[0].y), `${id} nonzero centerline`);
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

test('new calligraphic swashes leave at least eight canvas units between lines', () => {
  for (const id of applied.added) {
    const font = handwritingFontData(id);
    const points = font.chars.flatMap((glyph) => parseStrokePath(glyph.d).flat());
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    assert.ok((maxY - minY) * font.scale <= font.lineHeight - 8, id);
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
  const glyph = handwritingFontData('pangolin').chars['l'.charCodeAt(0) - 33];
  const strokes = parseStrokePath(glyph.d);
  assert.equal(strokes.length, 1);
  const points = strokes[0];
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const length = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
  assert.ok(distance(points[0], points.at(-1)) > length * 0.8);
});

test('added font derivations have distinct study names and exact source/license checksums', () => {
  const provenance = JSON.parse(readFileSync(new URL('../public/data/HANDWRITING-ATTRIBUTION.json', import.meta.url), 'utf8'));
  assert.equal(provenance.fonts.length, 33);
  assert.equal(provenance.originals.length, 1);
  assert.deepEqual(provenance.tinyPunctuationFallbacks, []);
  assert.equal(provenance.generation.arbitraryMissingGlyphFallbacks, false);
  assert.match(provenance.modified, /heuristic/);
  assert.equal(new Set(provenance.fonts.map(({ strokeStudy }) => strokeStudy)).size, 33);
  for (const record of [...provenance.originals, ...provenance.fonts]) {
    if (record.id !== 'correspondence') {
      assert.match(record.strokeStudy, /^Ink Stroke Study \d{2}$/);
      assert.equal(record.strokeStudy, handwritingFontData(record.id).name);
      assert.notEqual(record.strokeStudy, handwritingStyle(record.id).family);
      assert.equal(record.heuristicStrokeOrder, true);
      assert.equal(createHash('sha256').update(JSON.stringify(generated[record.id])).digest('hex'), record.centerlineSha256);
    }
    for (const [file, expected] of [[record.font, record.fontSha256], [record.licenseFile, record.licenseSha256]]) {
      const bytes = readFileSync(new URL(`../public${file}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
    }
  }
});

test('every compact mark and the blank source underscore have explicit source-grounded attribution', () => {
  const provenance = JSON.parse(readFileSync(new URL('../public/data/HANDWRITING-ATTRIBUTION.json', import.meta.url), 'utf8'));
  const methods = new Set(['preserved-v1-raster-singleton', 'compact-source-principal-axis', 'source-underline-metrics']);
  const sources = new Map();
  assert.ok(provenance.approximations.length > 0);
  for (const record of provenance.approximations) {
    assert.ok(HANDWRITING_IDS.includes(record.id));
    assert.ok(methods.has(record.method));
    assert.ok(record.reason.length > 0);
    const glyph = handwritingFontData(record.id).chars[record.character.charCodeAt(0) - 33];
    assert.ok(glyph.d.includes(record.stroke), `${record.id}:${record.character}`);
    const bounds = record.sourceBounds;
    assert.ok(Object.values(bounds).every(Number.isFinite));
    assert.ok(bounds.xMax > bounds.xMin && bounds.yMax > bounds.yMin);
    assert.ok(parseStrokePath(record.stroke).every((stroke) => stroke.length >= 2));
    if (!sources.has(record.id)) sources.set(record.id, sourceFont(handwritingStyle(record.id)));
    const face = sources.get(record.id);
    const { yMin, yMax } = face.charToGlyph('x').getMetrics();
    const referenceHeight = yMax - yMin;
    const sourceUnits = referenceHeight / 10.5;
    const rounding = sourceUnits * 0.011 + (record.rasterXHeight ? referenceHeight / record.rasterXHeight : 0);
    for (const point of parseStrokePath(record.stroke).flat()) {
      const x = point.x * sourceUnits;
      const y = (16.5 - point.y) * sourceUnits;
      assert.ok(x >= bounds.xMin - rounding && x <= bounds.xMax + rounding, `${record.id}:${record.character} source x`);
      assert.ok(y >= bounds.yMin - rounding && y <= bounds.yMax + rounding, `${record.id}:${record.character} source y`);
    }
    if (record.method === 'compact-source-principal-axis') {
      assert.ok(Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin) <= referenceHeight * 0.4 + rounding);
    }
  }
  const metricReconstructions = provenance.approximations.filter(({ method }) => method === 'source-underline-metrics');
  assert.equal(metricReconstructions.length, 1);
  const record = metricReconstructions[0];
  assert.equal(`${record.id}:${record.character}`, 'italianno:_');
  const source = sourceFont(handwritingStyle('italianno'));
  assert.deepEqual(source.charToGlyph('_').path.commands, []);
  assert.deepEqual(record.sourceMetrics, {
    underlinePosition: source.tables.post.underlinePosition,
    underlineThickness: source.tables.post.underlineThickness,
    advanceWidth: source.charToGlyph('_').advanceWidth,
  });
});
