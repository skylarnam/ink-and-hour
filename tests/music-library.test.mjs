import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LOFI_TRACK_IDS, LOFI_TRACKS } from '../src/music-library.ts';
import { HANDWRITING_IDS } from '../src/handwriting.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings.ts';

test('three local recordings are complete, credited CC0 assets with exact source checksums', () => {
  const credits = readFileSync(new URL('../public/audio/lofi/CREDITS.txt', import.meta.url), 'utf8');
  assert.equal(new Set(LOFI_TRACK_IDS).size, 3);
  for (const track of LOFI_TRACKS) {
    const bytes = readFileSync(new URL(`../public${track.file}`, import.meta.url));
    assert.ok(bytes.length > 1_000_000);
    assert.ok(bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 0xff);
    assert.ok(credits.includes(createHash('sha256').update(bytes).digest('hex')));
    assert.ok(credits.includes(track.artist));
    assert.ok(credits.includes(track.source));
    assert.equal(track.license, 'https://creativecommons.org/publicdomain/zero/1.0/');
  }
});

test('all handwriting and recording choices persist without persisting playback intent', () => {
  for (const style of HANDWRITING_IDS) {
    for (const lofiTrack of LOFI_TRACK_IDS) {
      const settings = { ...DEFAULT_SETTINGS, style, lofiTrack, musicTrack: 'lofi' };
      assert.deepEqual(sanitizeSettings(JSON.parse(JSON.stringify(settings))), settings);
    }
  }
  const clean = sanitizeSettings({ ...DEFAULT_SETTINGS, lofiTrack: 'unknown', requested: true });
  assert.equal(clean.lofiTrack, DEFAULT_SETTINGS.lofiTrack);
  assert.equal('requested' in clean, false);
});
