import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';
import { layoutText } from '../src/writing/layout.ts';

const OUTPUT_DIR = process.argv[2];
if (!OUTPUT_DIR) throw new Error('Pass an output directory for the handwriting comparison images.');
const SAMPLE = 'Sphinx. 123';
const columns = 2;
const rows = 6;
const pageStyles = [
  HANDWRITING_STYLES.slice(0, 12),
  HANDWRITING_STYLES.slice(12),
];

function registerStyleFonts(): void {
  for (const style of HANDWRITING_STYLES) {
    GlobalFonts.registerFromPath(new URL(`../public${style.publicFontPath}`, import.meta.url).pathname, style.family);
  }
}

function drawStroke(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, strokes: Array<Array<{ x: number; y: number }>>, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#23384d';
  ctx.lineWidth = 1.45;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let index = 1; index < stroke.length; index++) ctx.lineTo(stroke[index].x, stroke[index].y);
    ctx.stroke();
  }
  ctx.restore();
}

registerStyleFonts();
mkdirSync(OUTPUT_DIR, { recursive: true });

pageStyles.forEach((styles, pageIndex) => {
  const cellWidth = 600;
  const cellHeight = 260;
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f5f1e8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'top';
  styles.forEach((style, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    ctx.fillStyle = '#fcfbf8';
    ctx.strokeStyle = '#d7cfbf';
    ctx.lineWidth = 1;
    ctx.fillRect(left + 14, top + 14, cellWidth - 28, cellHeight - 28);
    ctx.strokeRect(left + 14, top + 14, cellWidth - 28, cellHeight - 28);
    ctx.fillStyle = '#22313f';
    ctx.font = '600 18px system-ui';
    ctx.fillText(style.label, left + 28, top + 24);
    ctx.fillStyle = '#7b6d59';
    ctx.font = '12px system-ui';
    ctx.fillText(style.notes, left + 28, top + 48, cellWidth - 56);
    ctx.fillStyle = '#1d2328';
    ctx.font = `400 ${Math.round(style.editorSize * 2.2)}px "${style.family}"`;
    ctx.fillText(SAMPLE, left + 28, top + 76, cellWidth - 56);
    const layout = layoutText(SAMPLE, { style: style.id, width: cellWidth - 56, height: 150 });
    if (!layout.ok) throw new Error(`${style.id}: ${layout.error}`);
    drawStroke(ctx, layout.strokes, left + 10, top + 132);
  });
  const output = `${OUTPUT_DIR}/handwriting-contact-sheet-${pageIndex + 1}.png`;
  writeFileSync(output, canvas.toBuffer('image/png'));
  console.log(`Wrote ${output}`);
});
