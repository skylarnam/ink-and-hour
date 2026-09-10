import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeNibTexture } from '../src/nib-sound.ts';

function statistics(samples) {
  let energy = 0;
  let difference = 0;
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    assert.ok(Number.isFinite(value));
    energy += value * value;
    sum += value;
    peak = Math.max(peak, Math.abs(value));
    if (i) difference += (value - samples[i - 1]) ** 2;
  }
  return { rms: Math.sqrt(energy / samples.length), peak, mean: sum / samples.length, brightness: difference / energy };
}

test('original contact textures are deterministic, bounded, and suitable for supported audio rates', () => {
  for (const sampleRate of [8000, 44100, 48000]) {
    for (const pen of ['fountain', 'dip']) {
      const samples = synthesizeNibTexture(sampleRate, pen);
      assert.equal(samples.length, Math.round(sampleRate * 4.3));
      const signal = statistics(samples);
      assert.ok(signal.peak < 1);
      assert.ok(signal.rms > 0.18 && signal.rms < 0.28);
      assert.ok(Math.abs(signal.mean) < 0.025);
    }
  }
  assert.deepEqual(synthesizeNibTexture(8000, 'fountain'), synthesizeNibTexture(8000, 'fountain'));
  for (const rate of [0, NaN, Infinity, 1e9]) assert.throws(() => synthesizeNibTexture(rate, 'fountain'), RangeError);
});

test('dip contact is brighter than the rounded fountain texture, not the same noise with a different gain', () => {
  const fountain = synthesizeNibTexture(48000, 'fountain');
  const dip = synthesizeNibTexture(48000, 'dip');
  assert.notDeepEqual(fountain, dip);
  assert.ok(statistics(dip).brightness > statistics(fountain).brightness * 1.5);
});

test('contact energy has short, uneven fiber transients rather than a steady white-noise bed', () => {
  const samples = synthesizeNibTexture(48000, 'fountain');
  const levels = [];
  for (let i = 0; i < samples.length - 240; i += 240) {
    let energy = 0;
    for (let j = i; j < i + 240; j++) energy += samples[j] ** 2;
    levels.push(Math.sqrt(energy / 240));
  }
  const average = levels.reduce((sum, value) => sum + value, 0) / levels.length;
  const spread = Math.sqrt(levels.reduce((sum, value) => sum + (value - average) ** 2, 0) / levels.length);
  assert.ok(spread / average > 0.3);
  assert.ok(statistics(samples).brightness < 0.2);
});
