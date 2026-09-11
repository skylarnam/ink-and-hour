import test from 'node:test';
import assert from 'node:assert/strict';
import { WRITING_SOUNDS, WRITING_SOUND_IDS, isWritingSoundId, writingSoundDescriptor } from '../src/writing-sounds.ts';

test('the registry has exactly seven entries in the required order with the exact ids and labels', () => {
  assert.equal(WRITING_SOUNDS.length, 7);
  assert.deepEqual(WRITING_SOUNDS.map((sound) => sound.id), [
    'textured', 'original', 'soft-glide', 'fine-feedback', 'dry-fibers', 'warm-paper', 'crisp-nib',
  ]);
  const expectedLabels = {
    textured: 'Textured',
    original: 'Original',
    'soft-glide': 'Soft glide',
    'fine-feedback': 'Fine feedback',
    'dry-fibers': 'Dry fibers',
    'warm-paper': 'Warm paper',
    'crisp-nib': 'Crisp nib',
  };
  for (const sound of WRITING_SOUNDS) assert.equal(sound.label, expectedLabels[sound.id]);
});

test('every descriptor has a non-empty, distinct, human-readable description', () => {
  const descriptions = new Set();
  for (const sound of WRITING_SOUNDS) {
    assert.equal(typeof sound.description, 'string');
    assert.ok(sound.description.length > 10);
    assert.equal(descriptions.has(sound.description), false, `duplicate description for ${sound.id}`);
    descriptions.add(sound.description);
  }
});

test('WRITING_SOUND_IDS mirrors the registry order exactly', () => {
  assert.deepEqual(WRITING_SOUND_IDS, WRITING_SOUNDS.map((sound) => sound.id));
});

test('isWritingSoundId accepts every registered id and rejects unknown or malformed values', () => {
  for (const id of WRITING_SOUND_IDS) assert.equal(isWritingSoundId(id), true);
  for (const value of ['', 'Original', 'unknown', 'soft_glide', 'Soft glide', ' textured', 'textured ']) {
    assert.equal(isWritingSoundId(value), false);
  }
});

test('writingSoundDescriptor returns the matching entry and throws for unknown ids', () => {
  for (const sound of WRITING_SOUNDS) assert.deepEqual(writingSoundDescriptor(sound.id), sound);
  assert.throws(() => writingSoundDescriptor('unknown'), /Unknown writing sound/);
});

test('the registry is read-only at the type level and safe to iterate independently', () => {
  const copy = [...WRITING_SOUNDS];
  assert.notEqual(copy, WRITING_SOUNDS);
  assert.deepEqual(copy, WRITING_SOUNDS);
  // Every id/label pair is unique.
  assert.equal(new Set(WRITING_SOUND_IDS).size, WRITING_SOUND_IDS.length);
  assert.equal(new Set(WRITING_SOUNDS.map((sound) => sound.label)).size, WRITING_SOUNDS.length);
});
