import { INKS } from './types.ts';
import type { Settings } from './types.ts';

export function isInkColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function inkColor(settings: Pick<Settings, 'ink' | 'customInk'>): string {
  return settings.ink === 'custom' ? settings.customInk : INKS[settings.ink].color;
}

export function inkLabel(settings: Pick<Settings, 'ink' | 'customInk'>): string {
  return settings.ink === 'custom' ? `Custom ${settings.customInk.toUpperCase()}` : INKS[settings.ink].label;
}
