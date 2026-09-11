import generated from './handwriting-fonts.json' with { type: 'json' };
import legacy from './fonts.json' with { type: 'json' };
import { HANDWRITING_IDS, type HandwritingId, handwritingStyle } from '../handwriting.ts';

export interface StrokeGlyphRecord {
  d: string;
  o: number;
}

export interface HandwritingFontRecord {
  id: HandwritingId;
  name: string;
  sourceFamily: string;
  space: number;
  scale: number;
  lineHeight: number;
  terminalPadding: number;
  chars: readonly StrokeGlyphRecord[];
  script: boolean;
  exactOriginal: boolean;
}

const correspondence: HandwritingFontRecord = {
  id: 'correspondence',
  name: legacy.correspondence.name,
  sourceFamily: handwritingStyle('correspondence').family,
  space: 10,
  scale: 1.72,
  lineHeight: 68,
  terminalPadding: 0.18,
  chars: legacy.correspondence.chars,
  script: true,
  exactOriginal: true,
};

type GeneratedFontJson = Record<Exclude<HandwritingId, 'correspondence'>, {
  name: string;
  sourceFamily: string;
  space: number;
  scale: number;
  lineHeight: number;
  terminalPadding: number;
  chars: StrokeGlyphRecord[];
}>;

const generatedRecords: GeneratedFontJson = generated;

export const HANDWRITING_FONT_DATA: Record<HandwritingId, HandwritingFontRecord> = Object.fromEntries(
  HANDWRITING_IDS.map((id) => {
    if (id === 'correspondence') return [id, correspondence];
    const style = handwritingStyle(id);
    const font = generatedRecords[id];
    if (!font) throw new Error(`Missing generated handwriting data for ${id}.`);
    return [id, {
      id,
      name: font.name,
      sourceFamily: font.sourceFamily,
      space: font.space,
      scale: font.scale,
      lineHeight: font.lineHeight,
      terminalPadding: font.terminalPadding,
      chars: font.chars,
      script: style.script,
      exactOriginal: false,
    } satisfies HandwritingFontRecord];
  }),
) as Record<HandwritingId, HandwritingFontRecord>;

export function handwritingFontData(id: HandwritingId): HandwritingFontRecord {
  return HANDWRITING_FONT_DATA[id];
}
