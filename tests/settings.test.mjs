import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, STORAGE_KEY, loadSettings, sanitizeSettings, saveSettings } from '../src/settings.ts';

test('fresh preferences use the 70/30/20/20 mix with lo-fi selected', () => {
  assert.equal(DEFAULT_SETTINGS.masterVolume, 0.7);
  assert.equal(DEFAULT_SETTINGS.writingVolume, 0.3);
  assert.equal(DEFAULT_SETTINGS.ambienceVolume, 0.2);
  assert.equal(DEFAULT_SETTINGS.musicVolume, 0.2);
  assert.equal(DEFAULT_SETTINGS.musicTrack, 'lofi');
  assert.equal(DEFAULT_SETTINGS.lofiTrack, 'first-snow');
  assert.equal(DEFAULT_SETTINGS.writingSound, 'dry-fibers');
  withStorage({ getItem: () => null }, () => {
    assert.deepEqual(loadSettings(assert.fail), DEFAULT_SETTINGS);
  });
});

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
    nib: 'broad', style: 'caveat', musicTrack: 'glass', time: 99, speed: -4,
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

test('lettering defaults are left aligned at 100% and invalid preferences are sanitized', () => {
  assert.equal(DEFAULT_SETTINGS.textScale, 1);
  assert.equal(DEFAULT_SETTINGS.textAlignment, 'left');
  for (const textScale of [NaN, Infinity, null, '2']) {
    assert.equal(sanitizeSettings({ textScale }).textScale, 1);
  }
  assert.equal(sanitizeSettings({ textScale: 9 }).textScale, 2);
  assert.equal(sanitizeSettings({ textScale: -1 }).textScale, 0.75);
  assert.equal(sanitizeSettings({ textAlignment: 'right' }).textAlignment, 'left');
  assert.equal(sanitizeSettings({ textAlignment: 'center', textScale: 1.35 }).textAlignment, 'center');
  assert.equal(sanitizeSettings({ textScale: 1.35 }).textScale, 1.35);
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
    const desired = {
      ...DEFAULT_SETTINGS, mood: 'atelier', nib: 'fine', musicTrack: 'glass',
      textScale: 1.35, textAlignment: 'center',
    };
    saveSettings({ ...desired, enabled: true, message: 'Private note' }, (message) => errors.push(message));
    assert.deepEqual(loadSettings((message) => errors.push(message)), desired);
    const saved = JSON.parse(values.get(STORAGE_KEY));
    assert.equal('enabled' in saved, false);
    assert.equal('message' in saved, false);
    assert.deepEqual(errors, []);
  });
});

test('new audio defaults do not overwrite saved levels or Music Off', () => {
  const saved = {
    ...DEFAULT_SETTINGS, masterVolume: 0.43, writingVolume: 0.61,
    ambienceVolume: 0.09, musicVolume: 0, musicTrack: 'off',
  };
  withStorage({ getItem: () => JSON.stringify(saved) }, () => {
    assert.deepEqual(loadSettings(assert.fail), saved);
  });
});

test('Dry fibers is the default without overwriting legacy mixer or music choices', () => {
  assert.equal(DEFAULT_SETTINGS.writingSound, 'dry-fibers');
  const { writingSound: _previouslyAbsent, ...legacy } = {
    ...DEFAULT_SETTINGS, writingVolume: 0.47, ambienceVolume: 0, musicTrack: 'off',
  };
  withStorage({ getItem: () => JSON.stringify(legacy) }, () => {
    assert.deepEqual(loadSettings(assert.fail), { ...legacy, writingSound: 'dry-fibers' });
  });
  for (const writingSound of ['unknown', '', null, 1, true]) {
    assert.equal(sanitizeSettings({ writingSound }).writingSound, 'dry-fibers');
  }
});

test('retired saved sound selections migrate to Dry fibers without resetting other preferences', () => {
  for (const writingSound of ['original', 'warm-paper', 'crisp-nib']) {
    const saved = {
      ...DEFAULT_SETTINGS, writingSound, style: 'kalam', ink: 'burgundy',
      masterVolume: 0.43, writingVolume: 0.61, ambienceVolume: 0.09, musicVolume: 0, musicTrack: 'off',
    };
    withStorage({ getItem: () => JSON.stringify(saved) }, () => {
      assert.deepEqual(loadSettings(assert.fail), { ...saved, writingSound: 'dry-fibers' });
    });
  }
});

test('all four retained writing sounds persist without changing saved mixer or music choices', () => {
  const stored = new Map();
  withStorage({
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  }, () => {
    for (const writingSound of ['textured', 'soft-glide', 'fine-feedback', 'dry-fibers']) {
      const settings = { ...DEFAULT_SETTINGS, writingSound, musicTrack: 'off', musicVolume: 0 };
      saveSettings(settings, assert.fail);
      assert.deepEqual(loadSettings(assert.fail), settings);
    }
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
