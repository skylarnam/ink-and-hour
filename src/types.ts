export type Mood = 'study' | 'atelier' | 'storybook';
export type Weather = 'clear' | 'rain' | 'storm';
export type PenKind = 'fountain' | 'dip';
export type NibKind = 'fine' | 'broad' | 'flex';
export type PaperKind = 'smooth' | 'parchment' | 'cotton';
export type PresetInkId = 'midnight' | 'sepia' | 'burgundy' | 'forest';
export type InkId = PresetInkId | 'custom';
export type WritingStyle = HandwritingId;
export type MusicTrack = 'off' | 'felt' | 'glass' | 'lofi';
export type CameraPreset = 'desk' | 'detail' | 'overhead';
export type WritingStatus = 'idle' | 'writing' | 'paused' | 'complete';

export interface Settings {
  mood: Mood;
  weather: Weather;
  time: number;
  pen: PenKind;
  nib: NibKind;
  paper: PaperKind;
  ink: InkId;
  customInk: string;
  style: WritingStyle;
  speed: number;
  masterVolume: number;
  writingVolume: number;
  ambienceVolume: number;
  musicVolume: number;
  musicTrack: MusicTrack;
  lofiTrack: LofiTrackId;
}

export interface Point {
  x: number;
  y: number;
}

export interface InkSegment {
  from: Point;
  to: Point;
  fromWidth: number;
  toWidth: number;
  pressure: number;
}

export interface PenSample extends Point {
  contact: boolean;
  lift: number;
  pressure: number;
  speed: number;
  angle: number;
  progress: number;
  status: WritingStatus;
}

export interface WritingFrame {
  pen: PenSample;
  segments: InkSegment[];
}

export interface LayoutOptions {
  style: WritingStyle;
  width: number;
  height: number;
}

export interface LayoutResult {
  ok: boolean;
  error: string | null;
  strokes: Point[][];
  lineCount: number;
  characterCount: number;
}

export interface EngineOptions {
  nib: NibKind;
  pen: PenKind;
  speed: number;
}

export interface AudioContact {
  contact: boolean;
  speed: number;
  pressure: number;
}

export type InteractionCue = 'cap' | 'leather' | 'paper' | 'ink';

export const PAGE = { width: 780, height: 1040 } as const;

export const INKS: Record<PresetInkId, { label: string; color: string }> = {
  midnight: { label: 'Midnight blue', color: '#24384d' },
  sepia: { label: 'Warm sepia', color: '#76503b' },
  burgundy: { label: 'Oxblood', color: '#793e4b' },
  forest: { label: 'Deep moss', color: '#3f5947' },
};

export const PAPER_COLORS: Record<PaperKind, string> = {
  smooth: '#f9f3e5',
  parchment: '#e9d5ac',
  cotton: '#e5decd',
};

export const PAPER_FINISH: Record<PaperKind, { roughness: number; bumpScale: number }> = {
  smooth: { roughness: 0.76, bumpScale: 0.003 },
  parchment: { roughness: 0.94, bumpScale: 0.012 },
  cotton: { roughness: 0.99, bumpScale: 0.032 },
};
import type { LofiTrackId } from './music-library.ts';
import type { HandwritingId } from './handwriting.ts';
