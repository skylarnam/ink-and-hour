import type { Recording } from './recorded-music.ts';

const license = 'https://creativecommons.org/publicdomain/zero/1.0/';

export const LOFI_TRACKS = [
  {
    id: 'first-snow',
    title: 'First Snow',
    artist: 'HoliznaCC0',
    file: '/audio/lofi/first-snow.mp3',
    source: 'https://opengameart.org/content/lo-fi-and-chill-collection',
    license,
  },
  {
    id: 'chill-lofi-inspired',
    title: 'Chill lofi inspired',
    artist: 'omfgdude',
    file: '/audio/lofi/chill-lofi-inspired.mp3',
    source: 'https://opengameart.org/content/chill-lofi-inspired',
    license,
  },
  {
    id: 'happy-lofi-day',
    title: 'happy lofi day',
    artist: 'Tarush Singhal',
    file: '/audio/lofi/happy-lofi-day.mp3',
    source: 'https://opengameart.org/content/happy-lofi-day',
    license,
  },
] as const satisfies readonly Recording[];

export type LofiTrackId = typeof LOFI_TRACKS[number]['id'];
export const LOFI_TRACK_IDS = LOFI_TRACKS.map((track) => track.id);
