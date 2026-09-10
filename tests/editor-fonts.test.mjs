import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';

function font(name) {
  const bytes = readFileSync(new URL(`../public/fonts/${name}.otf`, import.meta.url));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

test('both local editor fonts cover every supported printable English character', () => {
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

test('correspondence and print use different glyph outlines, not a CSS italic substitution', () => {
  const script = font('ink-correspondence');
  const print = font('ink-everyday');
  for (const character of ['A', 'a', 'g', 'm', 'W']) {
    assert.notDeepEqual(script.charToGlyph(character).path.commands, print.charToGlyph(character).path.commands);
  }
});
