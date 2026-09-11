import type { LayoutCharacter, LayoutCursor, LayoutOptions, LayoutResult, Point } from '../types.ts';
import { MIN_TEXT_SCALE, MAX_TEXT_SCALE } from '../types.ts';
import { isHandwritingId, type HandwritingId } from '../handwriting.ts';
import { handwritingFontData } from './font-data.ts';
import { parseStrokePath, smoothStroke } from './paths.ts';

export const MAX_CHARACTERS = 420;

export type LayoutStyle = HandwritingId;
export type LayoutTextOptions = LayoutOptions;

interface Glyph {
  strokes: Point[][];
  advance: number;
  minX: number;
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
    let minX = Infinity;
    let maxX = -Infinity;
    for (const point of paths.flat()) {
      font.minX = Math.min(font.minX, point.x);
      font.minY = Math.min(font.minY, point.y);
      font.maxY = Math.max(font.maxY, point.y);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
    }
    const advance = Math.max(character.o * 1.68, maxX + source.terminalPadding);
    font.glyphs.set(String.fromCharCode(index + 33), {
      strokes: paths.map((path) => smoothStroke(path, source.script)),
      advance,
      minX,
      maxX,
    });
  }
  fontCache.set(style, font);
  return font;
}

interface Continuation {
  index: number;
  cursor: LayoutCursor;
}

export function layoutText(input: string, options: LayoutTextOptions, continuation?: Continuation): LayoutResult {
  const text = input.replace(/\r\n?/g, '\n');
  const error = (message: string): LayoutResult => ({
    ok: false,
    error: message,
    strokes: [],
    lineCount: 0,
    characterCount: text.length,
    characters: [],
  });
  const style = String(options.style);
  if (!isHandwritingId(style)) {
    return error('Choose one of the bundled handwriting styles for this sheet.');
  }
  const textScale = options.textScale === undefined ? 1 : options.textScale;
  const textAlignment = options.textAlignment === undefined ? 'left' : options.textAlignment;
  if (!Number.isFinite(textScale) || textScale < MIN_TEXT_SCALE || textScale > MAX_TEXT_SCALE) {
    return error('Choose a lettering size between 75% and 200%.');
  }
  if (textAlignment !== 'left' && textAlignment !== 'center') {
    return error('Choose left or center alignment for the lettering.');
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
  if (continuation && (!Number.isInteger(continuation.index) || continuation.index < 0 || continuation.index > text.length
    || !Number.isFinite(continuation.cursor.x) || !Number.isFinite(continuation.cursor.y)
    || !Number.isInteger(continuation.cursor.line) || continuation.cursor.line < 1
    || !Number.isFinite(continuation.cursor.lineHeight) || continuation.cursor.lineHeight <= 0
    || !isHandwritingId(continuation.cursor.style)
    || continuation.cursor.textScale !== undefined && (!Number.isFinite(continuation.cursor.textScale)
      || continuation.cursor.textScale < MIN_TEXT_SCALE || continuation.cursor.textScale > MAX_TEXT_SCALE)
    || continuation.cursor.textAlignment !== undefined
      && continuation.cursor.textAlignment !== 'left' && continuation.cursor.textAlignment !== 'center')) {
    return error('The remaining handwriting needs a valid position on the sheet.');
  }

  const font = getFont(style);
  const scale = font.scale * textScale;
  const lineHeight = font.lineHeight * textScale;
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
  const fullMessage = continuation
    ? 'The selected handwriting needs more room than remains on this sheet.'
    : `This note reaches the end of the sheet (${maxLines} lines). `
      + 'Shorten it, reduce the lettering size or remove a few line breaks; nothing has been left out.';
  const strokes: Point[][] = [];
  const characters: LayoutCharacter[] = [];
  const lines = new Map<number, { start: number; end: number; min: number; max: number }>();
  let x = continuation?.cursor.x ?? originX;
  let lineCount = continuation?.cursor.line ?? 1;
  let lineTop = continuation?.cursor.y ?? top;
  let linePitch = Math.max(continuation?.cursor.lineHeight ?? lineHeight, lineHeight);
  let characterIndex = continuation?.index ?? 0;
  let protectPreviousInk = continuation !== undefined
    && (continuation.cursor.style !== style || (continuation.cursor.textScale ?? 1) !== textScale);
  if (lineTop < top || lineTop + fontHeight > bottom) return error(fullMessage);
  const newline = (): boolean => {
    x = originX;
    lineTop += linePitch;
    linePitch = lineHeight;
    protectPreviousInk = false;
    lineCount++;
    return lineTop + fontHeight <= bottom;
  };

  for (const token of text.slice(characterIndex).match(/\n| +|[^ \n]+/g) ?? []) {
    if (token === '\n') {
      if (!newline()) return error(fullMessage);
      characterIndex++;
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
      characterIndex += token.length;
      continue;
    }
    if (protectPreviousInk) {
      x -= Math.min(0, glyph(token[0]).minX) * scale;
      protectPreviousInk = false;
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
      const y = lineTop - font.minY * scale;
      const strokeStart = strokes.length;
      for (const path of letter.strokes) {
        const points = path.map((point) => ({ x: x + point.x * scale, y: y + point.y * scale }));
        const line = lines.get(lineCount) ?? { start: strokes.length, end: strokes.length, min: Infinity, max: -Infinity };
        for (const point of points) {
          line.min = Math.min(line.min, point.x);
          line.max = Math.max(line.max, point.x);
        }
        line.end = strokes.length + 1;
        lines.set(lineCount, line);
        strokes.push(points);
      }
      x += letter.advance * scale;
      characters.push({
        index: characterIndex++, strokeStart, strokeEnd: strokes.length,
        after: {
          x, y: lineTop, line: lineCount, lineHeight: linePitch, style, textScale,
          textAlignment: continuation?.cursor.line === lineCount
            ? continuation.cursor.textAlignment ?? 'left' : textAlignment,
        },
      });
    }
  }
  if (textAlignment === 'center') {
    for (const [number, line] of lines) {
      // A line that already has ink keeps its anchor; only untouched lines can be recentered.
      if (continuation?.cursor.line === number) continue;
      const offset = (left + right - line.min - line.max) / 2;
      for (let index = line.start; index < line.end; index++) {
        for (const point of strokes[index]) point.x += offset;
      }
      for (const character of characters) {
        if (character.after.line === number) character.after.x += offset;
      }
    }
  }
  return { ok: true, error: null, strokes, lineCount, characterCount: text.length, characters };
}

export function restyleRemainingText(
  input: string, previous: LayoutResult, options: LayoutTextOptions, startedStrokes: number,
): { layout: LayoutResult; fromStroke: number } {
  const text = input.replace(/\r\n?/g, '\n');
  if (!previous.ok || !Number.isInteger(startedStrokes) || startedStrokes < 0 || startedStrokes > previous.strokes.length) {
    throw new Error('Only an existing sheet with a valid writing position can change handwriting.');
  }
  const retained = previous.characters.filter((character) => character.strokeStart < startedStrokes);
  const last = retained.at(-1);
  const fromStroke = last?.strokeEnd ?? 0;
  const index = last ? last.index + 1 : 0;
  if (!/[!-~]/.test(text.slice(index))) return { layout: previous, fromStroke: previous.strokes.length };
  // Anchor to the retained letter, never to a future wrap from an earlier preview.
  const tail = layoutText(text, options, last ? { index, cursor: last.after } : undefined);
  if (!tail.ok) return { layout: tail, fromStroke };
  return {
    fromStroke,
    layout: {
      ...tail,
      strokes: [...previous.strokes.slice(0, fromStroke), ...tail.strokes],
      characters: [...retained, ...tail.characters.map((character) => ({
        ...character, strokeStart: character.strokeStart + fromStroke, strokeEnd: character.strokeEnd + fromStroke,
      }))],
    },
  };
}
