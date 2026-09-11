import type { AudioContact, Settings } from './types.ts';

export interface ContactTextureParameters {
  gain: number;
  bodyMix: number;
  grainMix: number;
  bodyLowpass: number;
  grainLowpass: number;
}

export interface ContactTextures {
  body: Float32Array;
  grain: Float32Array;
}

// Experimental voicing, not measured or universal material/holder properties. Cutoffs are Hz.
const PAPER_TEXTURE = {
  smooth: { grain: 0.11, bodyLowpass: 1600, grainLowpass: 3500 },
  parchment: { grain: 0.32, bodyLowpass: 2100, grainLowpass: 4800 },
  cotton: { grain: 0.50, bodyLowpass: 1300, grainLowpass: 5800 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function contactTextureParameters(sample: AudioContact, settings: Settings): ContactTextureParameters {
  const speed = Number.isFinite(sample.speed) ? clamp(sample.speed, 0, 280) : 0;
  const motion = speed / 280;
  const pressure = Number.isFinite(sample.pressure) ? clamp(sample.pressure, 0, 1) : 0;
  const angle = sample.angle !== undefined && Number.isFinite(sample.angle) ? sample.angle : 0;
  const paper = PAPER_TEXTURE[settings.paper];
  const holder = settings.pen === 'dip' ? 1 : -1;

  let contactLoad = 0.48 + 0.35 * pressure;
  let detail = 0.02 + 0.045 * pressure;
  let bodyOpening = 140 * pressure;
  let grainOpening = 250 * pressure;

  if (settings.nib === 'broad') {
    const edge = Math.abs(Math.sin(angle - Math.PI / 4));
    contactLoad = 0.65 + 0.14 * pressure + 0.15 * edge;
    detail = -0.04 + 0.07 * edge + 0.035 * pressure;
    bodyOpening = 100 + 350 * edge + 90 * pressure;
    grainOpening = 400 * edge + 150 * pressure;
  } else if (settings.nib === 'flex') {
    const flexLoad = pressure ** 1.4;
    contactLoad = 0.30 + 0.70 * flexLoad;
    detail = 0.025 + 0.16 * flexLoad;
    bodyOpening = 450 * flexLoad;
    grainOpening = 800 * flexLoad;
  }

  // Equal-power layers: holder changes their balance/openness, never the contact gain.
  const grainPower = clamp(paper.grain + 0.09 * motion + detail - 0.035 * holder, 0.04, 0.78);
  return {
    gain: sample.contact && speed > 0 ? 0.30 * Math.sqrt(motion) * contactLoad : 0,
    bodyMix: Math.sqrt(1 - grainPower),
    grainMix: Math.sqrt(grainPower),
    bodyLowpass: paper.bodyLowpass + 280 * motion + bodyOpening - 70 * holder,
    grainLowpass: paper.grainLowpass + 800 * motion + grainOpening + 150 * holder,
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lowpassStep(hz: number, sampleRate: number): number {
  return 1 - Math.exp(-2 * Math.PI * Math.min(hz, sampleRate * 0.38) / sampleRate);
}

// Random-duration, eased targets; time ranges are seconds, with no periodic modulation.
function drift(
  random: () => number,
  sampleRate: number,
  minTime: number,
  maxTime: number,
  minValue: number,
  maxValue: number,
): () => number {
  const nextValue = () => minValue + (maxValue - minValue) * random();
  const nextLength = () => Math.max(2, Math.round(sampleRate * (minTime + (maxTime - minTime) * random())));
  let start = nextValue();
  let target = nextValue();
  let length = nextLength();
  let position = 0;
  return () => {
    if (position >= length) {
      start = target;
      target = nextValue();
      length = nextLength();
      position = 0;
    }
    const blend = smoothstep(position++ / length);
    return start + (target - start) * blend;
  };
}

function loopWindow(index: number, length: number, fadeLength: number): number {
  return smoothstep(Math.min(1, index / fadeLength, (length - 1 - index) / fadeLength));
}

function finishTexture(data: Float32Array, sampleRate: number): Float32Array {
  let sum = 0;
  let squares = 0;
  for (const value of data) {
    sum += value;
    squares += value * value;
  }
  const mean = sum / data.length;
  const rms = Math.sqrt(Math.max(0, squares / data.length - mean * mean));
  if (!Number.isFinite(rms) || rms <= 0) throw new Error('Contact texture generation produced no usable signal.');

  // Smooth saturation controls crest factor, not hard clipping. Both layers target 0.22 RMS.
  const drive = 0.27 / (0.86 * rms);
  const fadeLength = Math.round(sampleRate * 0.020);
  let windowSum = 0;
  sum = 0;
  for (let i = 0; i < data.length; i++) {
    const window = loopWindow(i, data.length, fadeLength);
    data[i] = 0.86 * Math.tanh((data[i] - mean) * drive) * window;
    sum += data[i];
    windowSum += window;
  }

  // Window the DC correction too, so removing DC cannot reopen the faded seam.
  const correction = sum / windowSum;
  let peak = 0;
  squares = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] -= correction * loopWindow(i, data.length, fadeLength);
    peak = Math.max(peak, Math.abs(data[i]));
    squares += data[i] * data[i];
  }
  const level = Math.min(0.22 / Math.sqrt(squares / data.length), 0.94 / peak);
  for (let i = 0; i < data.length; i++) data[i] *= level;
  return data;
}

function bodyTexture(sampleRate: number): Float32Array {
  const data = new Float32Array(sampleRate * 11);
  const noise = seededRandom(0x681bc3a7);
  const structure = seededRandom(0x2d4f906b);
  const surface = drift(structure, sampleRate, 0.16, 0.73, 0.58, 1.28);
  const rubbing = drift(structure, sampleRate, 0.025, 0.11, 0.82, 1.12);
  const lowStep = lowpassStep(2300, sampleRate);
  const highStep = lowpassStep(105, sampleRate);
  let low = 0;
  let softened = 0;
  let floor = 0;
  for (let i = 0; i < data.length; i++) {
    low += lowStep * (noise() * 2 - 1 - low);
    softened += lowStep * (low - softened);
    floor += highStep * (softened - floor);
    data[i] = (softened - floor) * surface() * rubbing();
  }
  return finishTexture(data, sampleRate);
}

function grainTexture(sampleRate: number): Float32Array {
  const data = new Float32Array(sampleRate * 13);
  const noise = seededRandom(0xc0a4f39d);
  const structure = seededRandom(0x9752de13);
  const fibers = drift(structure, sampleRate, 0.12, 0.48, 0.45, 1.15);
  const lowStep = lowpassStep(6200, sampleRate);
  const highStep = lowpassStep(650, sampleRate);
  let low = 0;
  let softened = 0;
  let floor = 0;
  let gap = Math.round(sampleRate * 0.013);
  let position = 0;
  let length = 0;
  let strength = 0;

  // At most one smoothly enveloped noise patch is active: no impulse bank or pitched grains.
  for (let i = 0; i < data.length; i++) {
    low += lowStep * (noise() * 2 - 1 - low);
    softened += lowStep * (low - softened);
    floor += highStep * (softened - floor);
    const field = fibers();
    if (gap > 0) {
      gap--;
      continue;
    }
    if (position >= length) {
      length = Math.max(2, Math.round(sampleRate * (0.014 + 0.048 * structure())));
      strength = 0.40 + 0.70 * structure();
      position = 0;
    }
    const phase = position / (length - 1);
    const hump = 4 * phase * (1 - phase);
    data[i] = (softened - floor) * hump * hump * strength * field;
    if (++position >= length) {
      gap = Math.round(sampleRate * (0.003 + 0.052 * structure() ** 2));
    }
  }
  return finishTexture(data, sampleRate);
}

/** Original mono synthesis for unity-rate playback; callers own lazy generation and caching. */
export function createContactTextures(sampleRate: number): ContactTextures {
  // At most 4,608,000 samples; supported rates retain their 11/13-second durations.
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError('Contact textures require an integer sample rate between 8000 and 192000 Hz.');
  }
  return { body: bodyTexture(sampleRate), grain: grainTexture(sampleRate) };
}
