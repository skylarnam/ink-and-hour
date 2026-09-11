import type { AudioContact, Settings } from './types.ts';
import { DEFAULT_WRITING_SOUND, type WritingSoundId } from './writing-sounds.ts';

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

// Per-palette spectral/balance bias layered on the same pressure/speed/paper/nib/holder model.
interface ProfileVoicing {
  readonly grainBias: number;
  readonly bodyBrightness: number;
  readonly grainBrightness: number;
}

const PROFILE_VOICING: Record<WritingSoundId, ProfileVoicing> = {
  textured: { grainBias: 0, bodyBrightness: 1, grainBrightness: 1 },
  'soft-glide': { grainBias: -0.10, bodyBrightness: 0.86, grainBrightness: 0.82 },
  'fine-feedback': { grainBias: 0.05, bodyBrightness: 0.96, grainBrightness: 1.16 },
  'dry-fibers': { grainBias: 0.09, bodyBrightness: 0.92, grainBrightness: 1.06 },
};

export function contactTextureParameters(
  sample: AudioContact,
  settings: Settings,
  profile: WritingSoundId = DEFAULT_WRITING_SOUND,
): ContactTextureParameters {
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
  const voicing = PROFILE_VOICING[profile];
  const grainPower = clamp(paper.grain + 0.09 * motion + detail - 0.035 * holder + voicing.grainBias, 0.04, 0.78);
  return {
    gain: sample.contact && speed > 0 ? 0.30 * Math.sqrt(motion) * contactLoad : 0,
    bodyMix: Math.sqrt(1 - grainPower),
    grainMix: Math.sqrt(grainPower),
    bodyLowpass: (paper.bodyLowpass + 280 * motion + bodyOpening - 70 * holder) * voicing.bodyBrightness,
    grainLowpass: (paper.grainLowpass + 800 * motion + grainOpening + 150 * holder) * voicing.grainBrightness,
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

// Body configuration: a slow-drifting bandpassed noise "rubbing" layer. lowHz/highHz set the
// spectral band (see lowpassStep); the surface/rubbing drifts set envelope smoothness and range.
// 'textured' matches the previously published constants exactly.
interface BodyConfig {
  readonly noiseSeed: number;
  readonly structureSeed: number;
  readonly lowHz: number;
  readonly highHz: number;
  readonly surfaceTime: readonly [number, number];
  readonly surfaceValue: readonly [number, number];
  readonly rubbingTime: readonly [number, number];
  readonly rubbingValue: readonly [number, number];
}

const BODY_CONFIG: Record<WritingSoundId, BodyConfig> = {
  textured: {
    noiseSeed: 0x681bc3a7, structureSeed: 0x2d4f906b, lowHz: 2300, highHz: 105,
    surfaceTime: [0.16, 0.73], surfaceValue: [0.58, 1.28], rubbingTime: [0.025, 0.11], rubbingValue: [0.82, 1.12],
  },
  // Smoother glide: slower, narrower-range drifts and a darker band than Textured.
  'soft-glide': {
    noiseSeed: 0x4a17e6c9, structureSeed: 0x7fce2d51, lowHz: 1450, highHz: 85,
    surfaceTime: [0.35, 1.10], surfaceValue: [0.75, 1.15], rubbingTime: [0.05, 0.22], rubbingValue: [0.90, 1.05],
  },
  // Finer pencil-like feedback: brighter band, faster micro-variation beneath the grain.
  'fine-feedback': {
    noiseSeed: 0x9e3d0b6f, structureSeed: 0x1a6c4f83, lowHz: 2900, highHz: 140,
    surfaceTime: [0.08, 0.35], surfaceValue: [0.55, 1.35], rubbingTime: [0.012, 0.05], rubbingValue: [0.75, 1.20],
  },
  // Coarser, separated drag: slower and wider swings than Textured, moderate band.
  'dry-fibers': {
    noiseSeed: 0x2c85f471, structureSeed: 0x6b3ea90d, lowHz: 1900, highHz: 95,
    surfaceTime: [0.22, 0.95], surfaceValue: [0.50, 1.35], rubbingTime: [0.03, 0.15], rubbingValue: [0.70, 1.25],
  },
};

// Grain configuration: at most one smoothly enveloped noise patch is active at a time (see the
// loop below), separated by irregular gaps. patchLength/strength/gap* set granularity and
// intermittency; lowHz/highHz set the spectral band. 'textured' matches published constants.
interface GrainConfig {
  readonly noiseSeed: number;
  readonly structureSeed: number;
  readonly lowHz: number;
  readonly highHz: number;
  readonly fibersTime: readonly [number, number];
  readonly fibersValue: readonly [number, number];
  readonly initialGap: number;
  readonly patchLength: readonly [number, number];
  readonly strength: readonly [number, number];
  readonly gapBase: number;
  readonly gapScale: number;
  readonly gapPower: number;
}

const GRAIN_CONFIG: Record<WritingSoundId, GrainConfig> = {
  textured: {
    noiseSeed: 0xc0a4f39d, structureSeed: 0x9752de13, lowHz: 6200, highHz: 650,
    fibersTime: [0.12, 0.48], fibersValue: [0.45, 1.15], initialGap: 0.013,
    patchLength: [0.014, 0.062], strength: [0.40, 1.10], gapBase: 0.003, gapScale: 0.052, gapPower: 2,
  },
  // Restrained fibers: fewer, softer patches with longer gaps and a darker band.
  'soft-glide': {
    noiseSeed: 0x18cf6a52, structureSeed: 0x83b4d907, lowHz: 4200, highHz: 500,
    fibersTime: [0.20, 0.70], fibersValue: [0.35, 0.95], initialGap: 0.022,
    patchLength: [0.020, 0.075], strength: [0.25, 0.75], gapBase: 0.010, gapScale: 0.075, gapPower: 2,
  },
  // Finer pencil-like feedback: short, frequent, brighter patches.
  'fine-feedback': {
    noiseSeed: 0x7d29e6a3, structureSeed: 0xf13c58b6, lowHz: 7400, highHz: 900,
    fibersTime: [0.08, 0.30], fibersValue: [0.50, 1.20], initialGap: 0.006,
    patchLength: [0.006, 0.022], strength: [0.35, 0.95], gapBase: 0.002, gapScale: 0.020, gapPower: 1.6,
  },
  // Coarser, clearly separated drag: longer patches with much longer gaps between them.
  'dry-fibers': {
    noiseSeed: 0x3ae07c95, structureSeed: 0xb6428f10, lowHz: 6800, highHz: 750,
    fibersTime: [0.18, 0.60], fibersValue: [0.40, 1.30], initialGap: 0.030,
    patchLength: [0.030, 0.110], strength: [0.45, 1.20], gapBase: 0.020, gapScale: 0.120, gapPower: 2,
  },
};

function bodyTexture(sampleRate: number, config: BodyConfig): Float32Array {
  const data = new Float32Array(sampleRate * 11);
  const noise = seededRandom(config.noiseSeed);
  const structure = seededRandom(config.structureSeed);
  const surface = drift(structure, sampleRate, config.surfaceTime[0], config.surfaceTime[1], config.surfaceValue[0], config.surfaceValue[1]);
  const rubbing = drift(structure, sampleRate, config.rubbingTime[0], config.rubbingTime[1], config.rubbingValue[0], config.rubbingValue[1]);
  const lowStep = lowpassStep(config.lowHz, sampleRate);
  const highStep = lowpassStep(config.highHz, sampleRate);
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

function grainTexture(sampleRate: number, config: GrainConfig): Float32Array {
  const data = new Float32Array(sampleRate * 13);
  const noise = seededRandom(config.noiseSeed);
  const structure = seededRandom(config.structureSeed);
  const fibers = drift(structure, sampleRate, config.fibersTime[0], config.fibersTime[1], config.fibersValue[0], config.fibersValue[1]);
  const lowStep = lowpassStep(config.lowHz, sampleRate);
  const highStep = lowpassStep(config.highHz, sampleRate);
  let low = 0;
  let softened = 0;
  let floor = 0;
  let gap = Math.round(sampleRate * config.initialGap);
  let position = 0;
  let length = 0;
  let strength = 0;
  const [patchMin, patchRange] = [config.patchLength[0], config.patchLength[1] - config.patchLength[0]];
  const [strengthMin, strengthRange] = [config.strength[0], config.strength[1] - config.strength[0]];

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
      length = Math.max(2, Math.round(sampleRate * (patchMin + patchRange * structure())));
      strength = strengthMin + strengthRange * structure();
      position = 0;
    }
    const phase = position / (length - 1);
    const hump = 4 * phase * (1 - phase);
    data[i] = (softened - floor) * hump * hump * strength * field;
    if (++position >= length) {
      gap = Math.round(sampleRate * (config.gapBase + config.gapScale * structure() ** config.gapPower));
    }
  }
  return finishTexture(data, sampleRate);
}

/** Mono synthesis for unity-rate playback; callers own lazy generation and caching. */
export function createContactTextures(sampleRate: number, profile: WritingSoundId = DEFAULT_WRITING_SOUND): ContactTextures {
  // At most 4,608,000 samples; supported rates retain their 11/13-second durations.
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError('Contact textures require an integer sample rate between 8000 and 192000 Hz.');
  }
  return { body: bodyTexture(sampleRate, BODY_CONFIG[profile]), grain: grainTexture(sampleRate, GRAIN_CONFIG[profile]) };
}
