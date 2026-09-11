import type { Settings } from './types.ts';
import { MIN_TEXT_SCALE, MAX_TEXT_SCALE } from './types.ts';
import { isInkColor } from './ink.ts';
import { LOFI_TRACK_IDS } from './music-library.ts';
import { HANDWRITING_IDS } from './handwriting.ts';
import { WRITING_SOUND_IDS } from './writing-sounds.ts';

export const STORAGE_KEY = 'ink-and-hour:preferences:v1';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  mood: 'study',
  weather: 'rain',
  time: 17,
  pen: 'fountain',
  nib: 'flex',
  paper: 'smooth',
  ink: 'midnight',
  customInk: '#6752a0',
  style: 'correspondence',
  textScale: 1,
  textAlignment: 'left',
  speed: 1,
  masterVolume: 0.7,
  writingVolume: 0.3,
  writingSound: 'textured',
  ambienceVolume: 0.2,
  musicVolume: 0.2,
  musicTrack: 'lofi',
  lofiTrack: 'first-snow',
};

function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

function number(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function sanitizeSettings(value: unknown): Settings {
  const data: Record<string, unknown> = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    mood: choice(data.mood, ['study', 'atelier', 'storybook'], DEFAULT_SETTINGS.mood),
    weather: choice(data.weather, ['clear', 'rain', 'storm'], DEFAULT_SETTINGS.weather),
    time: number(data.time, 0, 24, DEFAULT_SETTINGS.time),
    pen: choice(data.pen, ['fountain', 'dip'], DEFAULT_SETTINGS.pen),
    nib: choice(data.nib, ['fine', 'broad', 'flex'], DEFAULT_SETTINGS.nib),
    paper: choice(data.paper, ['smooth', 'parchment', 'cotton'], DEFAULT_SETTINGS.paper),
    ink: choice(data.ink, ['midnight', 'sepia', 'burgundy', 'forest', 'custom'], DEFAULT_SETTINGS.ink),
    customInk: isInkColor(data.customInk) ? data.customInk.toLowerCase() : DEFAULT_SETTINGS.customInk,
    style: choice(data.style, HANDWRITING_IDS, DEFAULT_SETTINGS.style),
    textScale: number(data.textScale, MIN_TEXT_SCALE, MAX_TEXT_SCALE, DEFAULT_SETTINGS.textScale),
    textAlignment: choice(data.textAlignment, ['left', 'center'], DEFAULT_SETTINGS.textAlignment),
    speed: number(data.speed, 0.5, 2, DEFAULT_SETTINGS.speed),
    masterVolume: number(data.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume),
    writingVolume: number(data.writingVolume, 0, 1, DEFAULT_SETTINGS.writingVolume),
    writingSound: choice(data.writingSound, WRITING_SOUND_IDS, DEFAULT_SETTINGS.writingSound),
    ambienceVolume: number(data.ambienceVolume, 0, 1, DEFAULT_SETTINGS.ambienceVolume),
    musicVolume: number(data.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume),
    musicTrack: choice(data.musicTrack, ['off', 'felt', 'glass', 'lofi'], DEFAULT_SETTINGS.musicTrack),
    lofiTrack: choice(data.lofiTrack, LOFI_TRACK_IDS, DEFAULT_SETTINGS.lofiTrack),
  };
}

export function loadSettings(onError: (message: string) => void): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? { ...DEFAULT_SETTINGS } : sanitizeSettings(JSON.parse(stored));
  } catch (error) {
    onError(error instanceof SyntaxError
      ? 'Your saved preferences could not be read. A fresh room is ready.'
      : 'Local storage is unavailable. Your room will work, but preferences cannot be saved.');
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, onError: (message: string) => void): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
  } catch {
    onError('Your browser could not save preferences. This session still works normally.');
  }
}
