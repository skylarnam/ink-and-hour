import { randomSource } from './textures.ts';
import type { PenKind } from './types.ts';

export function synthesizeNibTexture(sampleRate: number, pen: PenKind): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    throw new RangeError('Nib synthesis needs a supported audio sample rate.');
  }
  const samples = new Float32Array(Math.round(sampleRate * 4.3));
  const random = randomSource(pen === 'fountain' ? 85231 : 29173);
  const dry = pen === 'dip';
  let cursor = 0;
  while (cursor < samples.length) {
    const duration = (dry ? 0.0015 : 0.0028) + random() * (dry ? 0.0033 : 0.0052);
    const length = Math.ceil(duration * sampleRate);
    const frequency = Math.min(sampleRate * 0.13, (dry ? 1150 : 630) + random() * (dry ? 1750 : 1250));
    const resonance = Math.min(sampleRate * 0.37, dry ? 3250 : 1720);
    const polarity = random() > 0.5 ? 1 : -1;
    const cluster = 0.62 + Math.sin(cursor / sampleRate * 19.7) * 0.18 + random() * 0.2;
    const amplitude = (0.23 + random() * 0.67) * cluster * polarity;
    let abrasion = 0;
    for (let i = 0; i < length; i++) {
      const time = i / sampleRate;
      const attack = Math.min(1, time / (dry ? 0.00012 : 0.0003));
      const envelope = attack * Math.exp(-time / (duration * 0.23));
      abrasion = abrasion * (dry ? 0.34 : 0.59) + (random() * 2 - 1) * (dry ? 0.66 : 0.41);
      const fiber = Math.sin(time * Math.PI * 2 * frequency)
        + 0.19 * Math.sin(time * Math.PI * 2 * frequency * 2.73);
      const tine = Math.sin(time * Math.PI * 2 * resonance) * Math.exp(-time / 0.00085);
      // Uneven, damped fiber contacts: the nib excites short grains, not a permanent noise bed.
      samples[(cursor + i) % samples.length] += (fiber * 0.5 + abrasion * 0.55 + tine * (dry ? 0.16 : 0.055))
        * envelope * amplitude;
    }
    cursor += Math.max(1, Math.round(sampleRate * ((dry ? 0.0022 : 0.0031) + random() * (dry ? 0.0054 : 0.0075))));
  }
  let sum = 0;
  for (const sample of samples) sum += sample;
  const mean = sum / samples.length;
  let energy = 0;
  for (const sample of samples) energy += (sample - mean) ** 2;
  if (energy === 0) throw new Error('Nib synthesis produced no contact signal.');
  const gain = 0.27 / Math.sqrt(energy / samples.length);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh((samples[i] - mean) * gain);
  return samples;
}
