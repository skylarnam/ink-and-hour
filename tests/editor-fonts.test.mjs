import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';

function font(name) {
  const bytes = readFileSync(new URL(`../public/fonts/${name}.otf`, import.meta.url));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

test('both original Hershey editor assets remain intact for the persistent font review', () => {
  for (const [filename, family] of [['ink-correspondence', 'Ink Correspondence'], ['ink-everyday', 'Ink Everyday']]) {
    const face = font(filename);
    assert.equal(face.names.fontFamily.en, family);
    for (let code = 32; code <= 126; code++) {
      const character = String.fromCharCode(code);
      assert.notEqual(face.charToGlyphIndex(character), 0, `${family}: ${character}`);
      const glyph = face.charToGlyph(character);
      assert.ok(glyph.advanceWidth > 0);
      if (code !== 32) assert.ok(glyph.path.commands.length > 0);
    }
    assert.match(face.names.license.en, /Public domain/);
  }
});

test('the original Correspondence and archived print assets have distinct glyph outlines', () => {
  const script = font('ink-correspondence');
  const print = font('ink-everyday');
  for (const character of ['A', 'a', 'g', 'm', 'W']) {
    assert.notDeepEqual(script.charToGlyph(character).path.commands, print.charToGlyph(character).path.commands);
  }
});

test('the live editor stylesheet exposes only the 34 approved original font families', () => {
  const css = readFileSync(new URL('../src/fonts.css', import.meta.url), 'utf8');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, body]) => body);
  assert.equal(faces.length, 34);
  const families = faces.map((face) => face.match(/font-family:\s*"([^"]+)"/)[1]);
  assert.deepEqual(families, HANDWRITING_STYLES.map(({ family }) => family));
  assert.equal(families.includes('Ink Everyday'), false);
  for (const style of HANDWRITING_STYLES) {
    const face = faces.find((body) => body.includes(`font-family: "${style.family}"`));
    assert.ok(face.includes(`url("${style.publicFontPath}")`), style.id);
    assert.match(face, /font-display:\s*swap/);
  }
});

test('Italianno excludes only its blank underscore so the editor can show its serif fallback', () => {
  const css = readFileSync(new URL('../src/fonts.css', import.meta.url), 'utf8');
  const face = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].find(([, body]) => body.includes('font-family: "Italianno"'))[1];
  const ranges = [...face.matchAll(/U\+([0-9A-F]+)-([0-9A-F]+)/g)].map(([, start, end]) => [parseInt(start, 16), parseInt(end, 16)]);
  assert.equal(ranges.length, 2);
  for (let code = 32; code <= 126; code++) {
    assert.equal(ranges.some(([start, end]) => code >= start && code <= end), code !== 95);
  }
  const style = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(style, /#message\s*\{[^}]+var\(--editor-font,[^}]+var\(--serif\)/);
});
