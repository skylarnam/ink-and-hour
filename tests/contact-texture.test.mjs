import test from 'node:test';
import assert from 'node:assert/strict';
import { contactTextureParameters, createContactTextures } from '../src/contact-texture.ts';
import { DEFAULT_WRITING_SOUND, WRITING_SOUND_IDS } from '../src/writing-sounds.ts';

const SETTINGS = { paper: 'smooth', nib: 'fine', pen: 'fountain' };
const SAMPLE = { contact: true, speed: 140, pressure: 0.6, angle: 0.4 };
const SAMPLE_RATES = [8000, 44100, 48000, 96000];
const CONTACT_PROFILES = WRITING_SOUND_IDS;
const cache = new Map();

function textures(sampleRate, profile = 'textured') {
  const key = `${sampleRate}:${profile}`;
  if (!cache.has(key)) cache.set(key, createContactTextures(sampleRate, profile));
  return cache.get(key);
}

function statistics(data) {
  let sum = 0;
  let squares = 0;
  let peak = 0;
  let differences = 0;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    assert.ok(Number.isFinite(value), `nonfinite sample at ${i}`);
    sum += value;
    squares += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (i > 0) differences += (value - data[i - 1]) ** 2;
  }
  return {
    mean: sum / data.length,
    rms: Math.sqrt(squares / data.length),
    peak,
    roughness: differences / squares,
  };
}

function windowRms(data, size) {
  const result = [];
  // Omit the deliberately faded loop edges.
  for (let start = size; start + size < data.length - size; start += size) {
    let energy = 0;
    for (let i = start; i < start + size; i++) energy += data[i] ** 2;
    result.push(Math.sqrt(energy / size));
  }
  return result;
}

function variation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) / mean;
}

function correlation(first, second, lag = 0) {
  const length = Math.min(first.length, second.length - lag);
  let firstMean = 0;
  let secondMean = 0;
  for (let i = 0; i < length; i++) {
    firstMean += first[i];
    secondMean += second[i + lag];
  }
  firstMean /= length;
  secondMean /= length;
  let product = 0;
  let firstEnergy = 0;
  let secondEnergy = 0;
  for (let i = 0; i < length; i++) {
    const a = first[i] - firstMean;
    const b = second[i + lag] - secondMean;
    product += a * b;
    firstEnergy += a * a;
    secondEnergy += b * b;
  }
  return product / Math.sqrt(firstEnergy * secondEnergy);
}

function assertParameters(params, grainCeiling = 8500) {
  assert.deepEqual(Object.keys(params).sort(), ['bodyLowpass', 'bodyMix', 'gain', 'grainLowpass', 'grainMix']);
  for (const value of Object.values(params)) assert.ok(Number.isFinite(value));
  assert.ok(params.gain >= 0 && params.gain <= 0.32);
  assert.ok(params.bodyMix >= 0 && params.bodyMix <= 1);
  assert.ok(params.grainMix >= 0 && params.grainMix <= 1);
  assert.ok(Math.abs(params.bodyMix ** 2 + params.grainMix ** 2 - 1) < 1e-12);
  assert.ok(params.bodyMix + params.grainMix <= Math.SQRT2 + 1e-12);
  assert.ok(params.bodyLowpass >= 1000 && params.bodyLowpass <= 4000);
  assert.ok(params.grainLowpass > params.bodyLowpass && params.grainLowpass <= grainCeiling);
}

test('up, stopped, backwards and invalid speed contacts have exactly zero gain', () => {
  for (const speed of [0, -0, -0.01, -100, NaN, Infinity, -Infinity]) {
    for (const nib of ['fine', 'broad', 'flex']) {
      const params = contactTextureParameters({ ...SAMPLE, speed }, { ...SETTINGS, nib });
      assert.equal(params.gain, 0);
      assertParameters(params);
    }
  }
  for (const speed of [0, 1, 150, 280, Number.MAX_VALUE, NaN, Infinity]) {
    assert.equal(contactTextureParameters({ ...SAMPLE, contact: false, speed }, SETTINGS).gain, 0);
  }
});

test('the parameter matrix remains finite, bounded and power balanced', () => {
  for (const paper of ['smooth', 'parchment', 'cotton']) {
    for (const nib of ['fine', 'broad', 'flex']) {
      for (const pen of ['fountain', 'dip']) {
        for (const speed of [0, 1e-10, 30, 100, 250, 280, Number.MAX_VALUE, NaN, Infinity]) {
          for (const pressure of [-10, 0, 0.08, 0.5, 1, 10, NaN, Infinity, -Infinity]) {
            for (const angle of [undefined, 0, -Math.PI, Math.PI, 1e300, NaN, Infinity]) {
              assertParameters(contactTextureParameters(
                { contact: true, speed, pressure, angle },
                { paper, nib, pen },
              ));
            }
          }
        }
      }
    }
  }
});

test('pressure clamps and invalid angles/pressures use finite light-contact fallbacks', () => {
  for (const nib of ['fine', 'broad', 'flex']) {
    const settings = { ...SETTINGS, nib };
    const light = contactTextureParameters({ ...SAMPLE, pressure: 0 }, settings);
    const loaded = contactTextureParameters({ ...SAMPLE, pressure: 1 }, settings);
    assert.ok(light.gain > 0, 'moving light-contact hairlines must not be gated by pressure');
    for (const pressure of [-1e300, NaN, Infinity, -Infinity]) {
      assert.deepEqual(contactTextureParameters({ ...SAMPLE, pressure }, settings), light);
    }
    assert.deepEqual(contactTextureParameters({ ...SAMPLE, pressure: 1e300 }, settings), loaded);
    const zeroAngle = contactTextureParameters({ ...SAMPLE, angle: 0 }, settings);
    for (const angle of [undefined, NaN, Infinity, -Infinity]) {
      assert.deepEqual(contactTextureParameters({ ...SAMPLE, angle }, settings), zeroAngle);
    }
  }
});

test('speed changes energy and openness continuously, then clamps without playback pitch controls', () => {
  let previous;
  for (const speed of [0, 1e-12, 10, 50, 100, 150, 250, 280]) {
    const params = contactTextureParameters({ ...SAMPLE, speed }, SETTINGS);
    if (previous) {
      assert.ok(params.gain > previous.gain);
      assert.ok(params.bodyLowpass >= previous.bodyLowpass);
      assert.ok(params.grainLowpass >= previous.grainLowpass);
    }
    assert.equal('playbackRate' in params, false);
    assert.equal('frequency' in params, false);
    previous = params;
  }
  assert.ok(contactTextureParameters({ ...SAMPLE, speed: 1e-12 }, SETTINGS).gain < 1e-6);
  assert.deepEqual(contactTextureParameters({ ...SAMPLE, speed: 1e300 }, SETTINGS), previous);
});

test('pointed flex follows actual load more strongly than broad-edge pressure', () => {
  const changes = {};
  for (const nib of ['fine', 'broad', 'flex']) {
    const settings = { ...SETTINGS, nib };
    const light = contactTextureParameters({ ...SAMPLE, pressure: 0.05 }, settings);
    const loaded = contactTextureParameters({ ...SAMPLE, pressure: 0.95 }, settings);
    assert.ok(loaded.gain > light.gain);
    assert.ok(loaded.grainLowpass > light.grainLowpass);
    changes[nib] = loaded.gain / light.gain;
  }
  assert.ok(changes.flex > changes.broad * 1.8);
  assert.ok(changes.flex > changes.fine * 1.3);
  for (const nib of ['fine', 'flex']) {
    assert.deepEqual(
      contactTextureParameters({ ...SAMPLE, angle: 0 }, { ...SETTINGS, nib }),
      contactTextureParameters({ ...SAMPLE, angle: Math.PI / 2 }, { ...SETTINGS, nib }),
      'stroke direction cannot stand in for pressure',
    );
  }
});

test('broad contact uses the engine edge convention and is continuous through angle wrap', () => {
  const settings = { ...SETTINGS, nib: 'broad' };
  const edgeAngle = Math.PI / 4;
  const narrow = contactTextureParameters({ ...SAMPLE, angle: edgeAngle }, settings);
  const wide = contactTextureParameters({ ...SAMPLE, angle: edgeAngle + Math.PI / 2 }, settings);
  assert.ok(wide.gain > narrow.gain * 1.1);
  assert.ok(wide.grainMix > narrow.grainMix);
  assert.ok(wide.bodyLowpass > narrow.bodyLowpass);
  for (const offset of [0.05, Math.PI / 8]) {
    const left = contactTextureParameters({ ...SAMPLE, angle: edgeAngle - offset }, settings);
    const right = contactTextureParameters({ ...SAMPLE, angle: edgeAngle + offset }, settings);
    assert.ok(left.gain > narrow.gain && right.gain > narrow.gain);
    for (const key of Object.keys(left)) {
      assert.ok(Math.abs(left[key] - right[key]) < 1e-9, 'broad response must be symmetric around 45 degrees');
    }
  }
  for (const angle of [-Math.PI, -2, 0, edgeAngle, 2, Math.PI]) {
    const first = contactTextureParameters({ ...SAMPLE, angle }, settings);
    for (const offset of [Math.PI, Math.PI * 2]) {
      const wrapped = contactTextureParameters({ ...SAMPLE, angle: angle + offset }, settings);
      for (const key of Object.keys(first)) assert.ok(Math.abs(first[key] - wrapped[key]) < 1e-9);
    }
  }
  const before = contactTextureParameters({ ...SAMPLE, angle: Math.PI - 1e-8 }, settings);
  const after = contactTextureParameters({ ...SAMPLE, angle: -Math.PI + 1e-8 }, settings);
  for (const key of Object.keys(before)) assert.ok(Math.abs(before[key] - after[key]) < 1e-4);
});

test('papers change layer balance and spectral shape, not just overall volume', () => {
  const [smooth, parchment, cotton] = ['smooth', 'parchment', 'cotton']
    .map((paper) => contactTextureParameters(SAMPLE, { ...SETTINGS, paper }));
  assert.equal(smooth.gain, parchment.gain);
  assert.equal(smooth.gain, cotton.gain);
  assert.ok(parchment.grainMix - smooth.grainMix > 0.1);
  assert.ok(cotton.grainMix - parchment.grainMix > 0.1);
  assert.ok(smooth.bodyMix > parchment.bodyMix && parchment.bodyMix > cotton.bodyMix);
  assert.ok(smooth.bodyLowpass < parchment.bodyLowpass);
  assert.ok(cotton.bodyLowpass < smooth.bodyLowpass, 'Cotton keeps a darker body beneath open fiber detail');
  assert.ok(smooth.grainLowpass < parchment.grainLowpass && parchment.grainLowpass < cotton.grainLowpass);
});

test('holder voicings trade texture balance rather than assigning dip a louder gain', () => {
  for (const paper of ['smooth', 'parchment', 'cotton']) {
    for (const nib of ['fine', 'broad', 'flex']) {
      const fountain = contactTextureParameters(SAMPLE, { ...SETTINGS, paper, nib, pen: 'fountain' });
      const dip = contactTextureParameters(SAMPLE, { ...SETTINGS, paper, nib, pen: 'dip' });
      assert.equal(fountain.gain, dip.gain);
      assert.ok(Math.abs(fountain.grainMix - dip.grainMix) > 0.02);
      assert.ok(dip.bodyMix > fountain.bodyMix);
      assert.ok(dip.bodyLowpass < fountain.bodyLowpass);
      assert.ok(dip.grainLowpass > fountain.grainLowpass);
    }
  }
});

test('profile selection, ink hue, rendering weight and mixer settings are not model inputs', () => {
  const expected = contactTextureParameters(SAMPLE, SETTINGS);
  for (const changes of [
    { writingSound: 'fine-feedback' },
    { writingSound: 'textured' },
    { ink: 'burgundy', customInk: '#ffffff' },
    { masterVolume: 0, writingVolume: 0, ambienceVolume: 1, musicVolume: 1 },
    { masterVolume: NaN, writingVolume: Infinity },
    { style: 'different-font', textScale: 2, speed: 5, weight: 900 },
  ]) {
    assert.deepEqual(contactTextureParameters(SAMPLE, { ...SETTINGS, ...changes }), expected);
  }
});

test('the generator is deterministic with independent allocations and no shared random state', () => {
  const first = textures(8000);
  textures(44100);
  const second = createContactTextures(8000, 'textured');
  assert.notEqual(first.body, first.grain);
  assert.notEqual(first.body.buffer, first.grain.buffer);
  assert.notEqual(first.body, second.body);
  assert.notEqual(first.grain, second.grain);
  assert.deepEqual(first.body, second.body);
  assert.deepEqual(first.grain, second.grain);
  const original = first.body[100];
  second.body[100] = original + 1;
  assert.equal(first.body[100], original);
});

test('all target sample rates retain mono duration, headroom, low DC and useful raw RMS', () => {
  for (const rate of SAMPLE_RATES) {
    const { body, grain } = textures(rate);
    assert.ok(body instanceof Float32Array && grain instanceof Float32Array);
    assert.equal(body.length, rate * 11);
    assert.equal(grain.length, rate * 13);
    assert.ok(body.length + grain.length <= 2_304_000);
    for (const [name, data] of Object.entries({ body, grain })) {
      const stats = statistics(data);
      assert.ok(Math.abs(stats.mean) < 1e-7, `${rate} Hz ${name} DC: ${stats.mean}`);
      assert.ok(stats.peak <= 0.95, `${rate} Hz ${name} peak: ${stats.peak}`);
      assert.ok(stats.rms >= 0.18 && stats.rms <= 0.28, `${rate} Hz ${name} RMS: ${stats.rms}`);
      assert.ok(stats.peak / stats.rms >= 2 && stats.peak / stats.rms <= 5.3);
    }
  }
});

test('grain is intermittent and irregular while the independent body is softer and gently evolving', () => {
  for (const rate of SAMPLE_RATES) {
    const { body, grain } = textures(rate);
    const bodyEnergy = windowRms(body, Math.round(rate * 0.020));
    const grainEnergy = windowRms(grain, Math.round(rate * 0.020));
    const bodyVariation = variation(bodyEnergy);
    const grainVariation = variation(grainEnergy);
    assert.ok(bodyVariation > 0.10 && bodyVariation < 0.45, `${rate} Hz body variation: ${bodyVariation}`);
    assert.ok(grainVariation > 0.45, `${rate} Hz grain variation: ${grainVariation}`);
    assert.ok(grainVariation > bodyVariation * 1.8);
    const quietGrainWindows = grainEnergy.filter((energy) => energy < 0.025).length;
    assert.ok(quietGrainWindows > grainEnergy.length * 0.08, 'detail includes genuine spaces between patches');
    assert.ok(quietGrainWindows < grainEnergy.length * 0.55, 'detail must not reduce to isolated rare clicks');
    assert.ok(Math.abs(correlation(body, grain)) < 0.035);
    assert.ok(statistics(grain).roughness > statistics(body).roughness * 1.4);
    // Check irregular timing against several fixed repeats, not a claim about perceived realism.
    for (const seconds of [0.10, 0.20, 0.40, 0.80, 1.20]) {
      const lag = Math.round(seconds / 0.020);
      assert.ok(Math.abs(correlation(grainEnergy, grainEnergy, lag)) < 0.4);
    }
  }
});

test('loop seams have zero endpoints and smoothly faded neighboring energy at every rate', () => {
  for (const rate of SAMPLE_RATES) {
    for (const data of Object.values(textures(rate))) {
      assert.equal(Math.abs(data[0]), 0);
      assert.equal(Math.abs(data[data.length - 1]), 0);
      assert.ok(Math.abs(data[1]) < 0.0002);
      assert.ok(Math.abs(data[data.length - 2]) < 0.0002);
      const edgeLength = Math.round(rate * 0.001);
      for (const edge of [data.subarray(0, edgeLength), data.subarray(data.length - edgeLength)]) {
        assert.ok(statistics(edge).rms < 0.003, 'the seam must not introduce an amplitude step');
      }
    }
  }
});

test('invalid or unbounded sample rates reject before allocating buffers', () => {
  for (const rate of [0, -1, 7999, 48000.5, 192001, 1e100, NaN, Infinity, -Infinity]) {
    assert.throws(() => createContactTextures(rate), RangeError);
  }
  for (const profile of CONTACT_PROFILES) {
    for (const rate of [0, -1, 7999, 192001, NaN]) assert.throws(() => createContactTextures(rate, profile), RangeError);
  }
});

test('the synthesis API defaults to Dry fibers and includes only the four retained palettes', () => {
  assert.equal(DEFAULT_WRITING_SOUND, 'dry-fibers');
  assert.deepEqual(createContactTextures(44100), createContactTextures(44100, 'dry-fibers'));
  assert.deepEqual(contactTextureParameters(SAMPLE, SETTINGS), contactTextureParameters(SAMPLE, SETTINGS, 'dry-fibers'));
  assert.equal(CONTACT_PROFILES.length, 4);
  assert.deepEqual(CONTACT_PROFILES, ['textured', 'soft-glide', 'fine-feedback', 'dry-fibers']);
});

// Generic invariants for any profile: finite, bounded gain, power-balanced mixes and a positive,
// ordered lowpass pair. The audio graph clamps each profile's cutoffs to native Nyquist.
function assertGenericParameters(params) {
  assert.deepEqual(Object.keys(params).sort(), ['bodyLowpass', 'bodyMix', 'gain', 'grainLowpass', 'grainMix']);
  for (const value of Object.values(params)) assert.ok(Number.isFinite(value));
  assert.ok(params.gain >= 0 && params.gain <= 0.32);
  assert.ok(params.bodyMix >= 0 && params.bodyMix <= 1);
  assert.ok(params.grainMix >= 0 && params.grainMix <= 1);
  assert.ok(Math.abs(params.bodyMix ** 2 + params.grainMix ** 2 - 1) < 1e-12);
  assert.ok(params.bodyLowpass > 0 && params.bodyLowpass < 20000);
  assert.ok(params.grainLowpass > params.bodyLowpass && params.grainLowpass < 20000);
}

test('every contact profile stays finite, bounded and power balanced across the full parameter matrix', () => {
  for (const profile of CONTACT_PROFILES) {
    for (const paper of ['smooth', 'parchment', 'cotton']) {
      for (const nib of ['fine', 'broad', 'flex']) {
        for (const pen of ['fountain', 'dip']) {
          for (const speed of [0, 30, 150, 280, NaN, Infinity]) {
            for (const pressure of [0, 0.5, 1, NaN, Infinity]) {
              for (const angle of [undefined, 0, Math.PI / 4, Math.PI, -Math.PI, NaN]) {
                const params = contactTextureParameters({ contact: true, speed, pressure, angle }, { paper, nib, pen }, profile);
                if (profile === 'textured') assertParameters(params, 8000);
                else if (profile === 'dry-fibers') assertParameters(params);
                else assertGenericParameters(params);
              }
            }
          }
        }
      }
    }
  }
});

test('every contact profile is exactly silent on lifts, stops and invalid or backwards speed', () => {
  for (const profile of CONTACT_PROFILES) {
    for (const speed of [0, -0, -0.01, -100, NaN, Infinity, -Infinity]) {
      assert.equal(contactTextureParameters({ ...SAMPLE, speed }, SETTINGS, profile).gain, 0);
    }
    assert.equal(contactTextureParameters({ ...SAMPLE, contact: false }, SETTINGS, profile).gain, 0);
  }
});

test('every contact profile keeps the same pressure, direction, paper and holder response as textured', () => {
  for (const profile of CONTACT_PROFILES) {
    const settings = SETTINGS;
    const light = contactTextureParameters({ ...SAMPLE, pressure: 0.05 }, settings, profile);
    const loaded = contactTextureParameters({ ...SAMPLE, pressure: 0.95 }, settings, profile);
    assert.ok(loaded.gain > light.gain, `${profile}: pressure must still increase gain`);
    assert.ok(loaded.grainLowpass > light.grainLowpass, `${profile}: pressure must still open the detail band`);

    const broad = { ...settings, nib: 'broad' };
    const edgeAngle = Math.PI / 4;
    const narrow = contactTextureParameters({ ...SAMPLE, angle: edgeAngle }, broad, profile);
    const wide = contactTextureParameters({ ...SAMPLE, angle: edgeAngle + Math.PI / 2 }, broad, profile);
    assert.ok(wide.gain > narrow.gain * 1.1, `${profile}: broad edge must still depend on angle`);
    const left = contactTextureParameters({ ...SAMPLE, angle: edgeAngle - 0.1 }, broad, profile);
    const right = contactTextureParameters({ ...SAMPLE, angle: edgeAngle + 0.1 }, broad, profile);
    for (const key of Object.keys(left)) {
      assert.ok(Math.abs(left[key] - right[key]) < 1e-9, `${profile}: broad response must stay symmetric around 45 degrees`);
    }

    const [smooth, parchment, cotton] = ['smooth', 'parchment', 'cotton']
      .map((paper) => contactTextureParameters(SAMPLE, { ...settings, paper }, profile));
    assert.equal(smooth.gain, parchment.gain, `${profile}: paper must not change gain`);
    assert.equal(smooth.gain, cotton.gain, `${profile}: paper must not change gain`);
    assert.ok(smooth.grainMix < parchment.grainMix && parchment.grainMix < cotton.grainMix,
      `${profile}: rougher paper must still open more grain`);

    const fountain = contactTextureParameters(SAMPLE, { ...settings, pen: 'fountain' }, profile);
    const dip = contactTextureParameters(SAMPLE, { ...settings, pen: 'dip' }, profile);
    assert.equal(fountain.gain, dip.gain, `${profile}: holder must not change gain`);
    assert.ok(dip.bodyMix > fountain.bodyMix, `${profile}: dip must still trade toward body`);
  }
});

test('the four retained palettes differ in mix balance and spectral targeting', () => {
  const params = Object.fromEntries(
    CONTACT_PROFILES.map((profile) => [profile, contactTextureParameters(SAMPLE, SETTINGS, profile)]),
  );
  // Restrained fibers: soft-glide keeps noticeably less grain than textured.
  assert.ok(params['soft-glide'].grainMix < params.textured.grainMix - 0.05);
  // Soft glide is the darkest and most body-dominant of the retained sounds.
  for (const profile of CONTACT_PROFILES) {
    if (profile === 'soft-glide') continue;
    assert.ok(params['soft-glide'].bodyLowpass < params[profile].bodyLowpass);
    assert.ok(params['soft-glide'].grainLowpass < params[profile].grainLowpass);
    assert.ok(params['soft-glide'].grainMix < params[profile].grainMix);
  }
  // No two profiles are simple volume rescales of each other: mixes and cutoffs are distinct.
  for (let i = 0; i < CONTACT_PROFILES.length; i++) {
    for (let j = i + 1; j < CONTACT_PROFILES.length; j++) {
      const a = params[CONTACT_PROFILES[i]];
      const b = params[CONTACT_PROFILES[j]];
      assert.equal(a.gain, b.gain, 'gain must stay driven only by pressure/speed, never by palette choice');
      assert.notEqual(a.bodyLowpass, b.bodyLowpass);
      assert.notEqual(a.grainLowpass, b.grainLowpass);
      assert.notEqual(a.grainMix, b.grainMix);
    }
  }
});

test('every contact profile generates finite, low-DC, comparably leveled and independently allocated buffers', () => {
  for (const profile of CONTACT_PROFILES) {
    const { body, grain } = textures(44100, profile);
    assert.ok(body instanceof Float32Array && grain instanceof Float32Array);
    assert.equal(body.length, 44100 * 11);
    assert.equal(grain.length, 44100 * 13);
    for (const [name, data] of Object.entries({ body, grain })) {
      const stats = statistics(data);
      assert.ok(Math.abs(stats.mean) < 1e-7, `${profile} ${name} DC: ${stats.mean}`);
      assert.ok(stats.peak > 0 && stats.peak <= 0.95, `${profile} ${name} peak: ${stats.peak}`);
      // Comparable typical level across every palette, so louder is never the only difference.
      assert.ok(stats.rms >= 0.18 && stats.rms <= 0.28, `${profile} ${name} RMS: ${stats.rms}`);
      assert.ok(stats.peak / stats.rms >= 2 && stats.peak / stats.rms <= 5.3, `${profile} ${name} crest factor`);
    }
    assert.ok(Math.abs(correlation(body, grain)) < 0.05, `${profile}: body and grain must stay independent`);
  }
  const textured = textures(44100, 'textured');
  for (const profile of CONTACT_PROFILES) {
    if (profile === 'textured') continue;
    const other = textures(44100, profile);
    assert.notDeepEqual(other.body, textured.body, `${profile} body must not equal textured`);
    assert.notDeepEqual(other.grain, textured.grain, `${profile} grain must not equal textured`);
    for (const rival of CONTACT_PROFILES) {
      if (rival === profile) continue;
      assert.notDeepEqual(other.body, textures(44100, rival).body, `${profile} and ${rival} must not share a body buffer`);
      assert.notDeepEqual(other.grain, textures(44100, rival).grain, `${profile} and ${rival} must not share a grain buffer`);
    }
  }
});

test('every contact profile keeps zero, smoothly faded loop seams at the default rate', () => {
  for (const profile of CONTACT_PROFILES) {
    for (const data of Object.values(textures(44100, profile))) {
      assert.equal(Math.abs(data[0]), 0);
      assert.equal(Math.abs(data[data.length - 1]), 0);
      const edgeLength = Math.round(44100 * 0.001);
      for (const edge of [data.subarray(0, edgeLength), data.subarray(data.length - edgeLength)]) {
        assert.ok(statistics(edge).rms < 0.003, `${profile}: the seam must not introduce an amplitude step`);
      }
    }
  }
});

test('the four retained palettes have distinct envelope granularity and intermittency', () => {
  const rate = 44100;
  const windowSize = Math.round(rate * 0.020);
  const summaries = {};
  for (const profile of CONTACT_PROFILES) {
    const { body, grain } = textures(rate, profile);
    const bodyEnergy = windowRms(body, windowSize);
    const grainEnergy = windowRms(grain, windowSize);
    summaries[profile] = {
      bodyVariation: variation(bodyEnergy),
      grainVariation: variation(grainEnergy),
      quietGrainFraction: grainEnergy.filter((energy) => energy < 0.025).length / grainEnergy.length,
      bodyRoughness: statistics(body).roughness,
      grainRoughness: statistics(grain).roughness,
    };
    // Grain must remain noticeably more irregular than its own body layer for every palette.
    assert.ok(summaries[profile].grainVariation > summaries[profile].bodyVariation * 1.5, profile);
    assert.ok(summaries[profile].grainRoughness > summaries[profile].bodyRoughness * 1.4, profile);
  }
  // Restrained, softer glide: noticeably more silence between fiber patches than textured.
  assert.ok(summaries['soft-glide'].quietGrainFraction > summaries.textured.quietGrainFraction + 0.08);
  // Finer, denser pencil-like feedback: noticeably less silence than textured.
  assert.ok(summaries['fine-feedback'].quietGrainFraction < summaries.textured.quietGrainFraction - 0.08);
  // Coarser, clearly separated drag: the most silence between grain patches.
  for (const profile of CONTACT_PROFILES) {
    if (profile !== 'dry-fibers') assert.ok(summaries['dry-fibers'].quietGrainFraction >= summaries[profile].quietGrainFraction);
  }
  // No two palettes share the same envelope statistics.
  for (let i = 0; i < CONTACT_PROFILES.length; i++) {
    for (let j = i + 1; j < CONTACT_PROFILES.length; j++) {
      const a = summaries[CONTACT_PROFILES[i]];
      const b = summaries[CONTACT_PROFILES[j]];
      assert.notEqual(a.quietGrainFraction, b.quietGrainFraction, `${CONTACT_PROFILES[i]} vs ${CONTACT_PROFILES[j]}`);
    }
  }
});
