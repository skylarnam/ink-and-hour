import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, STORAGE_KEY, loadSettings, sanitizeSettings, saveSettings } from '../src/settings.ts';

test('preferences restore safe defaults from invalid shapes', () => {
  for (const value of [null, undefined, [], true, 5, 'study']) {
    assert.deepEqual(sanitizeSettings(value), DEFAULT_SETTINGS);
  }
});

test('preferences reject unknown choices and nonfinite numbers', () => {
  const result = sanitizeSettings({ mood: 'bad', nib: 'gold', weather: 'snow', time: NaN, speed: Infinity, masterVolume: '1' });
  assert.deepEqual(result, DEFAULT_SETTINGS);
});

test('preferences preserve real choices and clamp every numeric control', () => {
  const result = sanitizeSettings({
    mood: 'storybook', weather: 'clear', paper: 'cotton', ink: 'forest', pen: 'dip',
    nib: 'broad', style: 'print', musicTrack: 'glass', time: 99, speed: -4,
    masterVolume: 4, writingVolume: -2, ambienceVolume: 0.36, musicVolume: 0,
  });
  assert.equal(result.mood, 'storybook');
  assert.equal(result.pen, 'dip');
  assert.equal(result.nib, 'broad');
  assert.equal(result.time, 24);
  assert.equal(result.speed, 0.5);
  assert.equal(result.masterVolume, 1);
  assert.equal(result.writingVolume, 0);
  assert.equal(result.ambienceVolume, 0.36);
  assert.equal(result.musicVolume, 0);
  assert.equal('enabled' in result, false);
});

function withStorage(storage, run) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try { run(); } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

test('saved preferences round-trip without persisting text or sound consent', () => {
  const values = new Map();
  const errors = [];
  withStorage({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }, () => {
    const desired = { ...DEFAULT_SETTINGS, mood: 'atelier', nib: 'fine', musicTrack: 'glass' };
    saveSettings({ ...desired, enabled: true, message: 'Private note' }, (message) => errors.push(message));
    assert.deepEqual(loadSettings((message) => errors.push(message)), desired);
    const saved = JSON.parse(values.get(STORAGE_KEY));
    assert.equal('enabled' in saved, false);
    assert.equal('message' in saved, false);
    assert.deepEqual(errors, []);
  });
});

test('corrupt saved JSON produces an explicit notice and a safe room', () => {
  const errors = [];
  withStorage({ getItem: () => '{invalid json' }, () => {
    assert.deepEqual(loadSettings((message) => errors.push(message)), DEFAULT_SETTINGS);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /saved preferences could not be read/i);
  });
});

test('denied local storage is surfaced for both restore and save', () => {
  const errors = [];
  withStorage({
    getItem: () => { throw new Error('storage blocked'); },
    setItem: () => { throw new Error('storage blocked'); },
  }, () => {
    assert.deepEqual(loadSettings((message) => errors.push(message)), DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS, (message) => errors.push(message));
    assert.equal(errors.length, 2);
    assert.match(errors[0], /storage is unavailable/i);
    assert.match(errors[1], /could not save/i);
  });
});
