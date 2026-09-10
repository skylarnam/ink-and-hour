import { DEFAULT_SETTINGS, sanitizeSettings } from './settings.ts';
import { synthesizeNibTexture } from './nib-sound.ts';
import type { AudioContact, InteractionCue, PenKind, Settings } from './types.ts';

const clamp = (value: number, max = 1): number => Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;

export function frictionParameters(sample: AudioContact, settings: Settings): {
  gain: number; frequency: number; lowpass: number; playbackRate: number;
} {
  const roughness = { smooth: 0.22, parchment: 0.57, cotton: 0.92 }[settings.paper];
  const nib = { fine: 0.84, broad: 1.08, flex: 0.98 }[settings.nib];
  const speed = clamp(sample.speed / 200, 2);
  const pressure = clamp(sample.pressure);
  return {
    gain: !sample.contact || speed <= 0 ? 0
      : Math.min(0.32, (0.18 + roughness * 0.075) * Math.sqrt(speed) * (0.6 + pressure * 0.7)
        * nib * (settings.pen === 'dip' ? 1.12 : 1)),
    frequency: 700 + speed * 550 + roughness * 550 + (settings.nib === 'fine' ? 300 : 0)
      + (settings.pen === 'dip' ? 250 : 0),
    lowpass: 2700 + roughness * 1900 + speed * 550 + (settings.pen === 'dip' ? 350 : 0),
    playbackRate: 0.65 + speed * 0.45 + roughness * 0.1,
  };
}

export function weatherGain(settings: Settings): number {
  return settings.weather === 'clear' ? 0 : (settings.weather === 'rain' ? 0.095 : 0.145) * 0.75;
}

function target(parameter: AudioParam, value: number, now: number, duration = 0.04): void {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
  else {
    const current = parameter.value;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(current, now);
  }
  if (value === 0) {
    const end = now + Math.min(duration * 2, 0.02);
    parameter.linearRampToValueAtTime(0, end);
    parameter.setValueAtTime(0, end + 0.001);
  } else parameter.setTargetAtTime(value, now, duration);
}

interface Voice {
  source: AudioScheduledSourceNode;
  gain: GainNode;
  filter?: BiquadFilterNode;
  kind: 'music' | 'interaction' | 'thunder';
  releasing: boolean;
}

interface LoopVoice {
  source: AudioBufferSourceNode;
  gate: GainNode;
  kind: 'contact' | 'rain';
  releasing: boolean;
}

export class RitualAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private writing: GainNode | null = null;
  private ambience: GainNode | null = null;
  private music: GainNode | null = null;
  private friction: GainNode | null = null;
  private frictionBand: BiquadFilterNode | null = null;
  private frictionLowpass: BiquadFilterNode | null = null;
  private rain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly nibTextures = new Map<PenKind, AudioBuffer>();
  private readonly loops = new Set<LoopVoice>();
  private contactVoice: LoopVoice | null = null;
  private rainVoice: LoopVoice | null = null;
  private rainTarget = 0;
  private readonly voices = new Set<Voice>();
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private userEnabled = true;
  private hidden = false;
  private contact = false;
  private writingTarget = 0;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private lifecycle: Promise<void> = Promise.resolve();
  private revision = 0;
  private disposed = false;
  private readonly onError: (message: string) => void;

  constructor(onError: (message: string) => void) { this.onError = onError; }
  get enabled(): boolean { return this.userEnabled; }

  async enable(): Promise<boolean> {
    if (this.disposed) {
      this.onError('This sound session has closed. Reload the page to start a new one.');
      return false;
    }
    try {
      this.userEnabled = true;
      this.revision++;
      if (!this.context) this.createGraph();
      await this.queueLifecycle();
      return this.userEnabled && !this.disposed;
    } catch (error) {
      if (!this.disposed) this.fail('Sound could not start. Try Enable sound again.', error);
      return false;
    }
  }

  async disable(): Promise<void> {
    this.userEnabled = false;
    this.revision++;
    this.silence();
    try {
      await this.queueLifecycle();
    } catch (error) {
      if (!this.disposed) this.fail('Sound could not be suspended.', error);
    }
  }

  async setHidden(hidden: boolean): Promise<void> {
    this.hidden = hidden;
    this.revision++;
    if (hidden) this.silence();
    try {
      await this.queueLifecycle();
    } catch (error) {
      if (!this.disposed) this.fail('Sound needs another click to resume.', error);
    }
  }

  private queueLifecycle(): Promise<void> {
    // Serialize browser promises, then recheck intent after each await so a late resume cannot undo mute.
    const operation = this.lifecycle.then(() => this.reconcileContext(), () => this.reconcileContext());
    this.lifecycle = operation;
    return operation;
  }

  private async reconcileContext(): Promise<void> {
    const ctx = this.context;
    if (!ctx || this.disposed) return;
    let version: number;
    do {
      version = this.revision;
      if (this.userEnabled && !this.hidden) {
        if (ctx.state !== 'running') await ctx.resume();
      } else if (ctx.state === 'running') await ctx.suspend();
      if (this.disposed) return;
    } while (version !== this.revision);
    if (this.ready()) {
      this.applyMixer();
      this.startMusic();
    }
  }

  private fail(message: string, error: unknown): void {
    this.userEnabled = false;
    this.revision++;
    this.silence();
    this.onError(`${message} ${error instanceof Error ? error.message : ''}`.trim());
  }

  private createGraph(): void {
    if (typeof window === 'undefined') throw new Error('Web Audio needs a browser.');
    const browser = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Context = window.AudioContext ?? browser.webkitAudioContext;
    if (!Context) throw new Error('This browser does not support Web Audio.');
    const ctx = new Context({ latencyHint: 'interactive' });
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.writing = ctx.createGain();
    this.ambience = ctx.createGain();
    this.music = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 12;
    limiter.ratio.value = 3;
    limiter.attack.value = 0.006;
    limiter.release.value = 0.2;
    this.master.connect(limiter).connect(ctx.destination);
    this.writing.connect(this.master);
    this.ambience.connect(this.master);
    this.music.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 9, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    let seed = 91721;
    let pink = 0;
    for (let i = 0; i < samples.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = seed / 2147483648 - 1;
      pink = pink * 0.96 + white * 0.04;
      samples[i] = white * 0.68 + pink * 2.6;
    }
    for (const pen of ['fountain', 'dip'] as const) {
      const data = synthesizeNibTexture(ctx.sampleRate, pen);
      const texture = ctx.createBuffer(1, data.length, ctx.sampleRate);
      texture.getChannelData(0).set(data);
      this.nibTextures.set(pen, texture);
    }
    this.frictionBand = ctx.createBiquadFilter();
    this.frictionBand.type = 'bandpass';
    this.frictionBand.Q.value = 0.65;
    this.frictionLowpass = ctx.createBiquadFilter();
    this.frictionLowpass.type = 'lowpass';
    this.friction = ctx.createGain();
    this.friction.gain.value = 0;
    this.frictionBand.connect(this.frictionLowpass).connect(this.friction).connect(this.writing);
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'lowpass';
    this.rainFilter.frequency.value = 3200;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    this.rainFilter.connect(this.rain).connect(this.ambience);
  }

  private startLoop(kind: LoopVoice['kind'], buffer: AudioBuffer, destination: AudioNode): LoopVoice {
    const ctx = this.context;
    if (!ctx) throw new Error('Audio graph is not initialized.');
    const retiring = [...this.loops].filter((voice) => voice.kind === kind && voice.releasing);
    for (const voice of retiring.slice(0, -1)) this.stopLoop(voice, true);
    const source = ctx.createBufferSource();
    const gate = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gate.gain.setValueAtTime(0, ctx.currentTime);
    gate.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.004);
    source.connect(gate).connect(destination);
    const voice: LoopVoice = { source, gate, kind, releasing: false };
    this.loops.add(voice);
    source.onended = () => this.releaseLoop(voice);
    source.start(ctx.currentTime, (ctx.currentTime * 0.83) % buffer.duration);
    return voice;
  }

  private stopLoop(voice: LoopVoice, immediate = false): void {
    const now = this.context?.currentTime ?? 0;
    if (immediate) {
      voice.gate.gain.cancelScheduledValues(now);
      voice.gate.gain.setValueAtTime(0, now);
      voice.source.stop(now);
      this.releaseLoop(voice);
    } else if (!voice.releasing) {
      voice.releasing = true;
      target(voice.gate.gain, 0, now, 0.003);
      voice.source.stop(now + 0.012);
    }
  }

  private releaseLoop(voice: LoopVoice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gate.disconnect();
    this.loops.delete(voice);
    if (this.contactVoice === voice) this.contactVoice = null;
    if (this.rainVoice === voice) this.rainVoice = null;
  }

  configure(settings: Settings): void {
    const previous = this.settings;
    this.settings = sanitizeSettings(settings);
    this.applyMixer();
    if (previous.weather !== this.settings.weather && this.settings.weather !== 'storm') this.stopVoices('thunder');
    if (previous.musicTrack !== this.settings.musicTrack) {
      this.stopMusic();
    }
    if (this.settings.musicVolume === 0 || this.settings.masterVolume === 0) this.stopMusic();
    else this.startMusic();
  }

  private applyMixer(): void {
    const ctx = this.context;
    if (!ctx || !this.master || !this.writing || !this.ambience || !this.music || !this.rain || !this.rainFilter) return;
    const now = ctx.currentTime;
    const settings = this.settings;
    target(this.master.gain, this.ready() ? settings.masterVolume : 0, now);
    target(this.writing.gain, settings.writingVolume, now);
    target(this.ambience.gain, settings.ambienceVolume, now);
    target(this.music.gain, settings.musicVolume, now);
    this.rainTarget = this.ready() && settings.ambienceVolume > 0 && settings.masterVolume > 0 ? weatherGain(settings) : 0;
    target(this.rain.gain, this.rainTarget, now, this.rainTarget === 0 ? 0.008 : 0.7);
    target(this.rainFilter.frequency, settings.weather === 'storm' ? 2100 : 3400, now, 0.4);
    if (this.rainTarget > 0 && !this.rainVoice && this.noise) {
      this.rainVoice = this.startLoop('rain', this.noise, this.rainFilter);
    } else if (this.rainTarget === 0 && this.rainVoice) {
      this.stopLoop(this.rainVoice);
      this.rainVoice = null;
    }
    if (settings.writingVolume === 0 || settings.masterVolume === 0) {
      this.updateContact({ contact: false, speed: 0, pressure: 0 });
    }
  }

  updateContact(sample: AudioContact): void {
    const audible = this.ready() && this.settings.writingVolume > 0 && this.settings.masterVolume > 0;
    const parameters = frictionParameters(audible ? sample : { contact: false, speed: 0, pressure: 0 }, this.settings);
    const previousGain = this.writingTarget;
    this.contact = parameters.gain > 0;
    this.writingTarget = parameters.gain;
    const ctx = this.context;
    if (!ctx || !this.friction || !this.frictionBand || !this.frictionLowpass || (previousGain === 0 && parameters.gain === 0)) return;
    target(this.friction.gain, parameters.gain, ctx.currentTime, parameters.gain === 0 ? 0.003 : 0.012);
    if (parameters.gain === 0) {
      if (this.contactVoice) this.stopLoop(this.contactVoice);
      this.contactVoice = null;
      return;
    }
    const texture = this.nibTextures.get(this.settings.pen);
    if (!texture) throw new Error('The selected nib sound is not initialized.');
    if (this.contactVoice && this.contactVoice.source.buffer !== texture) {
      this.stopLoop(this.contactVoice);
      this.contactVoice = null;
    }
    if (!this.contactVoice) this.contactVoice = this.startLoop('contact', texture, this.frictionBand);
    target(this.contactVoice.source.playbackRate, parameters.playbackRate, ctx.currentTime, 0.018);
    target(this.frictionBand.frequency, parameters.frequency, ctx.currentTime, 0.018);
    target(this.frictionLowpass.frequency, parameters.lowpass, ctx.currentTime, 0.018);
  }

  private silence(): void {
    this.contact = false;
    this.writingTarget = 0;
    this.rainTarget = 0;
    const now = this.context?.currentTime ?? 0;
    for (const gain of [this.master, this.friction, this.rain]) {
      if (gain) {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
      }
    }
    for (const voice of this.loops) this.stopLoop(voice, true);
    this.stopMusic(true);
    this.stopVoices(undefined, true);
  }

  cue(kind: InteractionCue): void {
    if (!this.ready() || !this.writing) return;
    const configuration = {
      cap: { duration: 0.12, frequency: 1600, gain: 0.1 },
      leather: { duration: 0.9, frequency: 650, gain: 0.17 },
      paper: { duration: 0.68, frequency: 3300, gain: 0.12 },
      ink: { duration: 0.25, frequency: 950, gain: 0.065 },
    }[kind];
    this.noiseCue(configuration.duration, configuration.frequency, configuration.gain, this.writing, 'interaction');
    if (kind === 'cap') this.tone(510, 0.1, 0.018, this.writing, false);
    if (kind === 'leather') this.tone(185, 0.58, 0.023, this.writing, false);
    if (kind === 'ink') this.tone(760, 0.18, 0.021, this.writing, false);
  }

  thunder(): void {
    if (this.ready() && this.settings.weather === 'storm' && this.ambience) {
      this.noiseCue(5, 170, 0.34, this.ambience, 'thunder');
    }
  }

  private noiseCue(duration: number, frequency: number, volume: number, bus: AudioNode, kind: Voice['kind']): void {
    const ctx = this.context;
    if (!ctx || !this.noise || this.voices.size >= 24) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = kind === 'thunder' ? 'lowpass' : 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + Math.min(duration * 0.14, 0.45));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(bus);
    this.trackVoice({ source, gain, filter, kind, releasing: false });
    source.start(now, (now * 0.37) % 3);
    source.stop(now + duration + 0.02);
  }

  private tone(frequency: number, duration: number, volume: number, bus: AudioNode, musical: boolean): void {
    const ctx = this.context;
    if (!ctx || this.voices.size >= 24) return;
    const source = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    source.type = musical && this.settings.musicTrack === 'felt' ? 'triangle' : 'sine';
    source.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + Math.min(0.48, duration * 0.18));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(gain).connect(bus);
    this.trackVoice({ source, gain, kind: musical ? 'music' : 'interaction', releasing: false });
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  private trackVoice(voice: Voice): void {
    this.voices.add(voice);
    voice.source.onended = () => this.releaseVoice(voice);
  }

  private releaseVoice(voice: Voice): void {
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.filter?.disconnect();
    this.voices.delete(voice);
  }

  private startMusic(): void {
    if (!this.ready() || this.settings.musicTrack === 'off' || this.settings.musicVolume === 0
      || this.settings.masterVolume === 0 || this.musicTimer !== null || !this.music) return;
    const play = (): void => {
      if (!this.ready() || !this.music || this.settings.musicTrack === 'off') return;
      const felt = this.settings.musicTrack === 'felt';
      const notes = felt ? [130.81, 164.81, 196, 146.83, 174.61, 220, 164.81, 146.83]
        : [261.63, 329.63, 392, 293.66, 349.23, 440, 329.63, 293.66];
      const note = notes[this.musicStep++ % notes.length];
      this.tone(note, felt ? 4.8 : 5.6, felt ? 0.032 : 0.036, this.music, true);
      if (this.musicStep % 3 === 1) this.tone(note / 2, 6.4, 0.024, this.music, true);
    };
    play();
    this.musicTimer = setInterval(play, 2600);
  }

  private stopMusic(immediate = false): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.stopVoices('music', immediate);
  }

  private stopVoices(kind?: Voice['kind'], immediate = false): void {
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.voices) {
      if (kind && voice.kind !== kind) continue;
      if (immediate) {
        voice.source.stop(now);
        this.releaseVoice(voice);
      } else if (!voice.releasing) {
        voice.releasing = true;
        target(voice.gain.gain, 0, now, 0.02);
        voice.source.stop(now + 0.15);
      }
    }
  }

  private ready(): boolean {
    return this.userEnabled && !this.hidden && !this.disposed && this.context?.state === 'running';
  }

  get diagnostics(): Record<string, unknown> {
    return {
      contextState: this.context?.state ?? 'not-created', enabled: this.userEnabled,
      contact: this.contact, writingGain: this.writingTarget, weather: this.settings.weather,
      rainGain: this.rainTarget, musicTrack: this.settings.musicTrack,
      activeMusicVoices: [...this.voices].filter((voice) => voice.kind === 'music' && !voice.releasing).length,
      musicTimerActive: this.musicTimer !== null, continuousSources: this.loops.size,
      contactSources: [...this.loops].filter((voice) => voice.kind === 'contact' && !voice.releasing).length,
      weatherSources: [...this.loops].filter((voice) => voice.kind === 'rain' && !voice.releasing).length,
      mixer: { master: this.master?.gain.value ?? 0, pen: this.writing?.gain.value ?? 0,
        ambience: this.ambience?.gain.value ?? 0, music: this.music?.gain.value ?? 0 },
      activeCues: [...this.voices].filter((voice) => voice.kind !== 'music' && !voice.releasing).length,
      allocatedVoices: this.voices.size, hidden: this.hidden,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.userEnabled = false;
    this.revision++;
    this.silence();
    this.nibTextures.clear();
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch((error: unknown) => {
        this.onError(`Audio could not close. ${error instanceof Error ? error.message : ''}`);
      });
    }
  }
}
