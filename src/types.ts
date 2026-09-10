export type Mood = 'study' | 'atelier' | 'storybook';
export type Weather = 'clear' | 'rain' | 'storm';
export type PenKind = 'fountain' | 'dip';
export type NibKind = 'fine' | 'broad' | 'flex';
export type PaperKind = 'smooth' | 'parchment' | 'cotton';
export type InkId = 'midnight' | 'sepia' | 'burgundy' | 'forest';
export type WritingStyle = 'correspondence' | 'print';
export type MusicTrack = 'off' | 'felt' | 'glass';
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
  style: WritingStyle;
  speed: number;
  masterVolume: number;
  writingVolume: number;
  ambienceVolume: number;
  musicVolume: number;
  musicTrack: MusicTrack;
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

export const INKS: Record<InkId, { label: string; color: string }> = {
  midnight: { label: 'Midnight blue', color: '#24384d' },
  sepia: { label: 'Warm sepia', color: '#76503b' },
  burgundy: { label: 'Oxblood', color: '#793e4b' },
  forest: { label: 'Deep moss', color: '#3f5947' },
};

export const PAPER_COLORS: Record<PaperKind, string> = {
  smooth: '#f9f3e5',
  parchment: '#e9d5ac',
  cotton: '#f0eadb',
};
