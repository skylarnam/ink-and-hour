import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { parseStrokePath, smoothStroke } from '../src/writing/paths.ts';

const source = JSON.parse(readFileSync(new URL('../src/writing/fonts.json', import.meta.url), 'utf8'));
const directory = new URL('../public/fonts/', import.meta.url);
const unit = 40;
mkdirSync(directory, { recursive: true });

function outlineStroke(path, sourcePoints, script) {
  const points = smoothStroke(sourcePoints, script);
  if (points.length < 2) return;
  const offsets = points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const width = script ? 0.58 + Math.max(0, dy / length) * 0.96 : 0.94;
    return { x: -dy / length * width / 2, y: dx / length * width / 2 };
  });
  const add = (point, move = false) => {
    const x = point.x * unit;
    const y = (22 - point.y) * unit;
    if (move) path.moveTo(x, y);
    else path.lineTo(x, y);
  };
  for (let index = 0; index < points.length; index++) {
    add({ x: points[index].x + offsets[index].x, y: points[index].y + offsets[index].y }, index === 0);
  }
  const roundCap = (index, reverse) => {
    const point = points[index];
    const offset = offsets[index];
    const radius = Math.hypot(offset.x, offset.y);
    const angle = Math.atan2(offset.y, offset.x) + (reverse ? Math.PI : 0);
    for (let step = 1; step <= 8; step++) {
      const a = angle - Math.PI * step / 8;
      add({ x: point.x + Math.cos(a) * radius, y: point.y + Math.sin(a) * radius });
    }
  };
  roundCap(points.length - 1, false);
  for (let index = points.length - 1; index >= 0; index--) {
    add({ x: points[index].x - offsets[index].x, y: points[index].y - offsets[index].y });
  }
  roundCap(0, true);
  path.close();
}

for (const [style, filename, family] of [
  ['correspondence', 'ink-correspondence.otf', 'Ink Correspondence'],
  ['print', 'ink-everyday.otf', 'Ink Everyday'],
]) {
  const missing = new opentype.Path();
  missing.moveTo(90, 0); missing.lineTo(90, 700); missing.lineTo(450, 700); missing.lineTo(450, 0); missing.close();
  missing.moveTo(135, 50); missing.lineTo(405, 50); missing.lineTo(405, 650); missing.lineTo(135, 650); missing.close();
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', advanceWidth: 540, path: missing }),
    new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 10 * unit, path: new opentype.Path() }),
  ];
  source[style].chars.forEach((character, index) => {
    const strokes = parseStrokePath(character.d);
    const maxX = Math.max(...strokes.flat().map((point) => point.x));
    const path = new opentype.Path();
    for (const stroke of strokes) outlineStroke(path, stroke, style === 'correspondence');
    glyphs.push(new opentype.Glyph({
      name: `uni${(index + 33).toString(16).toUpperCase().padStart(4, '0')}`,
      unicode: index + 33,
      advanceWidth: Math.ceil(Math.max(character.o * 1.68 + (style === 'print' ? 0.8 : 0),
        maxX + (style === 'print' ? 1.2 : 0.18)) * unit),
      path,
    }));
  });
  const font = new opentype.Font({
    familyName: family, styleName: 'Regular', unitsPerEm: 1000,
    ascender: 1000, descender: -500, glyphs,
    copyright: 'Editor outlines derived from the public-domain original Hershey scripts/futural centerlines.',
    license: 'Public domain. See THIRD_PARTY_NOTICES.md and public/data/HERSHEY-ATTRIBUTION.txt.',
    licenseURL: 'https://github.com/techninja/hersheytextjs/blob/master/README.md',
  });
  const output = new URL(filename, directory);
  writeFileSync(output, Buffer.from(font.toArrayBuffer()));
  console.log(`${fileURLToPath(output)} (${glyphs.length} glyphs)`);
}
