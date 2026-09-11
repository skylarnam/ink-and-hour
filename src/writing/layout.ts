import type { LayoutOptions, LayoutResult, Point } from '../types.ts';
import { isHandwritingId, type HandwritingId } from '../handwriting.ts';
import { handwritingFontData } from './font-data.ts';
import { parseStrokePath, smoothStroke } from './paths.ts';

export const MAX_CHARACTERS = 420;

export type LayoutStyle = HandwritingId;
export type LayoutTextOptions = LayoutOptions;

interface Glyph {
  strokes: Point[][];
  advance: number;
  maxX: number;
}

interface Font {
  glyphs: Map<string, Glyph>;
  minX: number;
  minY: number;
  maxY: number;
  space: number;
  scale: number;
  lineHeight: number;
}

const fontCache = new Map<HandwritingId, Font>();

function getFont(style: HandwritingId): Font {
  const cached = fontCache.get(style);
  if (cached) return cached;
  const source = handwritingFontData(style);
  const font: Font = {
    glyphs: new Map(),
    minX: 0,
    minY: Infinity,
    maxY: -Infinity,
    space: source.space,
    scale: source.scale,
    lineHeight: source.lineHeight,
  };
  for (let index = 0; index < 94; index++) {
    const character = source.chars[index];
    const paths = parseStrokePath(character.d);
    let maxX = -Infinity;
    for (const point of paths.flat()) {
      font.minX = Math.min(font.minX, point.x);
      font.minY = Math.min(font.minY, point.y);
      font.maxY = Math.max(font.maxY, point.y);
      maxX = Math.max(maxX, point.x);
    }
    const advance = Math.max(character.o * 1.68, maxX + source.terminalPadding);
    font.glyphs.set(String.fromCharCode(index + 33), {
      strokes: paths.map((path) => smoothStroke(path, source.script)),
      advance,
      maxX,
    });
  }
  fontCache.set(style, font);
  return font;
}

export function layoutText(input: string, options: LayoutTextOptions): LayoutResult {
  const text = input.replace(/\r\n?/g, '\n');
  const error = (message: string): LayoutResult => ({
    ok: false,
    error: message,
    strokes: [],
    lineCount: 0,
    characterCount: text.length,
  });
  const style = String(options.style);
  if (!isHandwritingId(style)) {
    return error('Choose one of the bundled handwriting styles for this sheet.');
  }
  if (!Number.isFinite(options.width) || !Number.isFinite(options.height)
    || options.width <= 0 || options.height <= 0) {
    return error('The sheet must have a finite, positive width and height.');
  }
  const unsupported = [...text].find((character) => character !== '\n'
    && (character.codePointAt(0)! < 32 || character.codePointAt(0)! > 126));
  if (unsupported) {
    const code = unsupported.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    return error(`English ASCII letters, numbers, punctuation, spaces and line breaks only. `
      + `Please replace ${JSON.stringify(unsupported)} (U+${code}).`);
  }
  if (text.length > MAX_CHARACTERS) {
    return error(`This sheet accepts up to ${MAX_CHARACTERS} characters. Your note has ${text.length}.`);
  }
  if (!/[!-~]/.test(text)) return error('A word, a thought, a little hello. Add something to write.');

  const font = getFont(style);
  const scale = font.scale;
  const lineHeight = font.lineHeight;
  const inkInset = 3.5;
  const left = Math.min(72, options.width * 0.095) + inkInset;
  const right = options.width - Math.min(72, options.width * 0.095) - inkInset;
  const top = Math.min(84, options.height * 0.085) + inkInset;
  const bottom = options.height - Math.min(74, options.height * 0.075) - inkInset;
  const originX = left - font.minX * scale;
  const fontHeight = (font.maxY - font.minY) * scale;
  const maxLines = Math.floor((bottom - top - fontHeight) / lineHeight) + 1;
  if (right <= originX || maxLines < 1) return error('This sheet is too small for legible handwriting.');

  const glyph = (character: string): Glyph => {
    const result = font.glyphs.get(character);
    if (!result) throw new Error(`Missing ASCII centerline glyph: ${character}`);
    return result;
  };
  const wordRight = (word: string, start: number): number => {
    let cursor = start;
    let extent = start;
    for (const character of word) {
      const letter = glyph(character);
      extent = Math.max(extent, cursor + letter.maxX * scale);
      cursor += letter.advance * scale;
    }
    return extent;
  };
  const fullMessage = `This note reaches the end of the sheet (${maxLines} lines). `
    + 'Shorten it or remove a few line breaks; nothing has been left out.';
  const strokes: Point[][] = [];
  let x = originX;
  let lineCount = 1;
  const newline = (): boolean => {
    x = originX;
    lineCount++;
    return lineCount <= maxLines;
  };

  for (const token of text.match(/\n| +|[^ \n]+/g) ?? []) {
    if (token === '\n') {
      if (!newline()) return error(fullMessage);
      continue;
    }
    if (token[0] === ' ') {
      for (let index = 0; index < token.length; index++) {
        if (x + font.space * scale > right) {
          if (!newline()) return error(fullMessage);
        } else {
          x += font.space * scale;
        }
      }
      continue;
    }
    if (x > originX && wordRight(token, x) > right && wordRight(token, originX) <= right) {
      if (!newline()) return error(fullMessage);
    }
    for (const character of token) {
      const letter = glyph(character);
      if (x + letter.maxX * scale > right) {
        if (x === originX) return error('This sheet is too narrow for the selected handwriting.');
        if (!newline()) return error(fullMessage);
        if (x + letter.maxX * scale > right) return error('This sheet is too narrow for the selected handwriting.');
      }
      const y = top - font.minY * scale + (lineCount - 1) * lineHeight;
      for (const path of letter.strokes) {
        strokes.push(path.map((point) => ({ x: x + point.x * scale, y: y + point.y * scale })));
      }
      x += letter.advance * scale;
    }
  }
  return { ok: true, error: null, strokes, lineCount, characterCount: text.length };
}
