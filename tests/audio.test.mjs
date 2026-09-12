import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherGain, RitualAudio } from '../src/audio.ts';
import { contactTextureParameters } from '../src/contact-texture.ts';
import { DEFAULT_SETTINGS as APP_DEFAULTS } from '../src/settings.ts';
import { layoutText, WritingEngine } from '../src/writing/index.ts';
import { PAGE } from '../src/types.ts';
import { WRITING_SOUND_IDS } from '../src/writing-sounds.ts';
import { createSoundStartup } from '../src/sound-startup.ts';
import { RecordedMusic } from '../src/recorded-music.ts';

const DEFAULT_SETTINGS = APP_DEFAULTS;
const TEXTURED_SETTINGS = { ...APP_DEFAULTS, writingSound: 'textured', ambienceVolume: 0, musicVolume: 0, musicTrack: 'off' };

test('clear weather really has no rain signal', () => {
  assert.equal(weatherGain({ ...DEFAULT_SETTINGS, weather: 'clear' }), 0);
  assert.ok(weatherGain({ ...DEFAULT_SETTINGS, weather: 'storm' }) > weatherGain(DEFAULT_SETTINGS));
});

test('both rain beds are 25 percent quieter without changing the independent mixer levels', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    for (const [weather, previousGain] of [['rain', 0.095], ['storm', 0.145]]) {
      const settings = { ...DEFAULT_SETTINGS, weather, writingVolume: 0.83, ambienceVolume: 0.41, musicVolume: 0.37 };
      audio.configure(settings);
      assert.equal(weatherGain(settings), previousGain * 0.75);
      assert.equal(audio.rain.gain.value, previousGain * 0.75);
      assert.equal(ctx.gains[1].gain.value, settings.writingVolume);
      assert.equal(ctx.gains[2].gain.value, settings.ambienceVolume);
      assert.equal(ctx.gains[3].gain.value, settings.musicVolume);
      assert.equal(ctx.gains[0].gain.value, settings.masterVolume);
    }
  });
});

test('sound defaults on without creating a context before a gesture; unavailable audio reports errors', async () => {
  const errors = [];
  const audio = new RitualAudio((message) => errors.push(message));
  audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'felt' });
  assert.equal(audio.enabled, true);
  assert.equal(audio.diagnostics.contextState, 'not-created');
  assert.equal(audio.diagnostics.activeMusicVoices, 0);
  assert.equal(audio.diagnostics.musicTimerActive, false);
  assert.equal(await audio.enable(), false);
  assert.equal(errors.length, 1);
  audio.dispose();
});

class FakeParam {
  value = 1;
  events = [];
  cancelScheduledValues(time) { this.events.push(['cancel', time]); return this; }
  cancelAndHoldAtTime(time) { this.events.push(['hold', time]); return this; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); return this; }
  setTargetAtTime(value, time, duration) { this.value = value; this.events.push(['target', value, time, duration]); return this; }
  linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); return this; }
  exponentialRampToValueAtTime(value, time) { this.events.push(['exponential', value, time]); return this; }
}

class FakeNode {
  connected = true;
  connections = new Set();
  connect(destination) { this.connected = true; this.connections.add(destination); return destination; }
  disconnect(destination) {
    if (destination) {
      assert.ok(this.connections.has(destination), 'disconnect only edges which actually connected');
      this.connections.delete(destination);
    }
    else { this.connected = false; this.connections.clear(); }
  }
}

class FakeSource extends FakeNode {
  constructor(context) {
    super();
    this.context = context;
    this.frequency = new FakeParam();
    this.playbackRate = new FakeParam();
  }
  started = false;
  onended = null;
  stopTime = Infinity;
  start() { this.started = true; }
  stop(time = this.context.currentTime) {
    assert.ok(this.started, 'sources must start before stopping');
    this.stopTime = time;
    if (time <= this.context.currentTime) this.onended?.();
  }
}

class FakeContext extends EventTarget {
  static instances = [];
  static onCreate = null;
  state = 'suspended';
  currentTime = 1;
  sampleRate = 8000;
  destination = new FakeNode();
  gains = [];
  sources = [];
  mediaSources = [];
  panners = [];
  filters = [];
  resumeGate = null;
  failResume = false;
  resumeError = null;
  resumeCalls = 0;
  suspendCalls = 0;
  stateListeners = new Set();
  constructor() { super(); FakeContext.instances.push(this); FakeContext.onCreate?.(this); }
  addEventListener(type, listener, options) {
    if (type === 'statechange') this.stateListeners.add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    if (type === 'statechange') this.stateListeners.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
  createGain() {
    const gain = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(gain);
    return gain;
  }
  createBiquadFilter() {
    const filter = Object.assign(new FakeNode(), { frequency: new FakeParam(), Q: new FakeParam() });
    this.filters.push(filter);
    return filter;
  }
  createStereoPanner() {
    const panner = Object.assign(new FakeNode(), { pan: Object.assign(new FakeParam(), { value: 0 }) });
    this.panners.push(panner);
    return panner;
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map((key) => [key, new FakeParam()])));
  }
  createBuffer(channels, length, sampleRate = this.sampleRate) {
    const samples = new Float32Array(length);
    return { getChannelData: () => samples, numberOfChannels: channels, duration: length / sampleRate };
  }
  createBufferSource() { const source = new FakeSource(this); this.sources.push(source); return source; }
  createOscillator() { return this.createBufferSource(); }
  createMediaElementSource(mediaElement) {
    const source = Object.assign(new FakeNode(), { mediaElement });
    this.mediaSources.push(source);
    return source;
  }
  async resume() {
    this.resumeCalls++;
    if (this.resumeGate) await this.resumeGate;
    if (this.resumeError) throw this.resumeError;
    if (this.failResume) throw new Error('Audio device unavailable');
    if (this.state !== 'closed') this.setState('running');
  }
  async suspend() { this.suspendCalls++; if (this.state !== 'closed') this.setState('suspended'); }
  async close() { this.setState('closed'); }
  advance(seconds) {
    this.currentTime += seconds;
    for (const source of this.sources) {
      if (source.stopTime <= this.currentTime) { source.onended?.(); source.onended = null; }
    }
  }
}

async function withAudio(run, settings = DEFAULT_SETTINGS, onStateChange = () => {}) {
  const priorWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeContext };
  FakeContext.instances.length = 0;
  FakeContext.onCreate = null;
  const errors = [];
  const audio = new RitualAudio((message) => errors.push(message), onStateChange);
  try {
    audio.configure(settings);
    await run(audio, errors);
  } finally {
    audio.dispose();
    FakeContext.onCreate = null;
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
}

test('a gesture creates one reusable graph across concurrent enable and repeated toggles', async () => {
  await withAudio(async (audio, errors) => {
    const enabled = await Promise.all([audio.enable(), audio.enable()]);
    assert.deepEqual(enabled, [true, true]);
    assert.equal(FakeContext.instances.length, 1);
    assert.equal(audio.diagnostics.continuousSources, 1);
    await audio.disable();
    assert.equal(audio.diagnostics.contextState, 'suspended');
    assert.equal(audio.enabled, false);
    assert.equal(await audio.enable(), true);
    assert.equal(FakeContext.instances.length, 1);
    assert.equal(audio.diagnostics.continuousSources, 1);
    assert.deepEqual(errors, []);
  });
});

test('rain and material cues retain their shared nine-second noise buffer', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const source = audio.rainVoice.source;
    assert.equal(source.buffer, audio.noise);
    assert.equal(source.playbackRate.value, 1);
    assert.equal(source.buffer.duration, 9);
    let seed = 91721;
    let pink = 0;
    const expected = new Float32Array(128);
    for (let i = 0; i < expected.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = seed / 2147483648 - 1;
      pink = pink * 0.96 + white * 0.04;
      expected[i] = white * 0.68 + pink * 2.6;
    }
    assert.deepEqual(source.buffer.getChannelData(0).slice(0, 128), expected);
    for (const cue of ['paper', 'cap', 'leather', 'ink']) {
      const before = audio.voices.size;
      audio.cue(cue);
      const added = [...audio.voices].slice(before);
      assert.equal(added.length, cue === 'paper' ? 1 : 2);
      assert.ok(added.every((voice) => voice.kind === 'interaction'));
      assert.equal(added.filter((voice) => voice.source.buffer === audio.noise).length, 1);
    }
  });
});

test('pen lift reaches scheduled exact zero without repeated frames postponing silence', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    audio.updateContact({ contact: true, speed: 132, pressure: 0.8 });
    assert.ok(audio.diagnostics.writingGain > 0);
    const ctx = FakeContext.instances[0];
    const parameters = Object.values(audio.texturedLayers).map((layer) => layer.gain.gain);
    audio.updateContact({ contact: false, speed: 0, pressure: 0 });
    assert.equal(audio.diagnostics.writingGain, 0);
    const eventCounts = parameters.map((parameter) => parameter.events.length);
    for (let i = 0; i < 60; i++) audio.updateContact({ contact: false, speed: 0, pressure: 0 });
    for (const [index, parameter] of parameters.entries()) {
      assert.equal(parameter.events.length, eventCounts[index]);
      const zero = parameter.events.at(-1);
      assert.equal(zero[0], 'set');
      assert.equal(zero[1], 0);
      assert.ok(zero[2] - ctx.currentTime <= 0.0071);
    }
  });
});

test('pen-only idle has no looping sources and lifts stop both actual contact sources', async () => {
  await withAudio(async (audio) => {
    audio.configure({ ...DEFAULT_SETTINGS, masterVolume: 0.41, writingVolume: 1, ambienceVolume: 0, musicVolume: 0 });
    await audio.enable();
    const ctx = FakeContext.instances[0];
    assert.equal(audio.diagnostics.continuousSources, 0);
    assert.equal(audio.diagnostics.contactSources, 0);
    assert.equal(audio.diagnostics.weatherSources, 0);
    audio.updateContact({ contact: true, speed: 140, pressure: 0.7 });
    assert.equal(audio.diagnostics.contactSources, 2);
    assert.equal(audio.diagnostics.preparedContactSound, 'textured');
    const sources = Object.values(audio.texturedLayers).map((layer) => layer.voice.source);
    for (const [index, source] of sources.entries()) {
      assert.notEqual(source.buffer, audio.noise);
      assert.equal(source.playbackRate.value, 1);
      assert.equal(source.buffer.duration, index === 0 ? 11 : 13);
    }
    for (let i = 0; i < 12; i++) audio.updateContact({ contact: true, speed: 140 + i, pressure: 0.7 });
    assert.deepEqual(Object.values(audio.texturedLayers).map((layer) => layer.voice.source), sources);
    audio.updateContact({ contact: false, speed: 0, pressure: 0 });
    assert.equal(audio.diagnostics.contactSources, 0);
    for (const source of sources) assert.ok(source.stopTime - ctx.currentTime <= 0.013);
    ctx.advance(0.02);
    assert.equal(audio.diagnostics.continuousSources, 0);
    for (const source of sources) assert.equal(source.connected, false);
  });
});

test('stationary, invalid-speed and lifted contact release sources without muting material cues', async () => {
  await withAudio(async (audio) => {
    audio.configure({ ...DEFAULT_SETTINGS, masterVolume: 0.41, writingVolume: 1, ambienceVolume: 0, musicVolume: 0 });
    await audio.enable();
    const ctx = FakeContext.instances[0];
    audio.cue('paper');
    for (const sample of [
      { contact: true, speed: 0, pressure: 1 },
      { contact: true, speed: NaN, pressure: 1 },
      { contact: true, speed: Infinity, pressure: 1 },
      { contact: false, speed: 150, pressure: 1 },
    ]) {
      audio.updateContact({ contact: true, speed: 140, pressure: 0.7 });
      const sources = Object.values(audio.texturedLayers).map((layer) => layer.voice.source);
      audio.updateContact(sample);
      assert.equal(audio.diagnostics.contact, false);
      assert.equal(audio.diagnostics.writingGain, 0);
      for (const source of sources) assert.ok(source.stopTime - ctx.currentTime <= 0.013);
      ctx.advance(0.02);
      for (const source of sources) assert.equal(source.connected, false);
      assert.equal(audio.diagnostics.continuousSources, 0);
      assert.equal(audio.diagnostics.activeCues, 1, 'the independent paper cue must remain audible');
    }
  });
});

test('every zero mixer bus schedules bounded exact silence, never an asymptotic target', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    const rainSource = audio.rainVoice.source;
    const offsets = ctx.gains.slice(0, 4).map((gain) => gain.gain.events.length);
    audio.configure({ ...DEFAULT_SETTINGS, masterVolume: 0, writingVolume: 0, ambienceVolume: 0, musicVolume: 0 });
    for (const [index, gain] of ctx.gains.slice(0, 4).entries()) {
      const events = gain.gain.events.slice(offsets[index]);
      const ramp = events.find((event) => event[0] === 'linear' && event[1] === 0);
      const end = events.at(-1);
      assert.ok(ramp, `mixer bus ${index} must have a finite zero ramp`);
      assert.deepEqual(end.slice(0, 2), ['set', 0]);
      assert.ok(end[2] > ctx.currentTime && end[2] - ctx.currentTime <= 0.022);
      assert.ok(!events.some((event) => event[0] === 'target' && event[1] === 0));
    }
    assert.ok(rainSource.stopTime - ctx.currentTime <= 0.013);
    ctx.advance(0.03);
    assert.equal(rainSource.connected, false);
    assert.equal(audio.diagnostics.continuousSources, 0);
  });
});

test('saved zero-volume mixes do not start inaudible loops or music on the first gesture', async () => {
  for (const settings of [
    { ...DEFAULT_SETTINGS, masterVolume: 0, musicTrack: 'felt' },
    { ...DEFAULT_SETTINGS, writingVolume: 0, ambienceVolume: 0, musicVolume: 0, musicTrack: 'glass' },
    { ...DEFAULT_SETTINGS, masterVolume: 0.41, writingVolume: 1, ambienceVolume: 0, musicVolume: 0, musicTrack: 'off' },
  ]) {
    await withAudio(async (audio) => {
      audio.configure(settings);
      assert.equal(FakeContext.instances.length, 0);
      await audio.enable();
      assert.equal(FakeContext.instances[0].sources.length, 0);
      assert.equal(audio.diagnostics.continuousSources, 0);
      assert.equal(audio.diagnostics.allocatedVoices, 0);
      assert.equal(audio.diagnostics.musicTimerActive, false);
      assert.deepEqual(audio.settings, settings, 'activation must not rewrite saved volume choices');
    });
  }
});

test('the reported pen-only mix stays silent across mute and hidden lifecycle until contact resumes', async () => {
  await withAudio(async (audio) => {
    const settings = { ...DEFAULT_SETTINGS, masterVolume: 0.41, writingVolume: 1, ambienceVolume: 0, musicVolume: 0, musicTrack: 'off' };
    audio.configure(settings);
    await audio.enable();
    const sample = { contact: true, speed: 140, pressure: 0.7 };
    for (const hide of [false, true]) {
      audio.updateContact(sample);
      audio.cue('ink');
      assert.equal(audio.diagnostics.contactSources, 2);
      if (hide) await audio.setHidden(true);
      else await audio.disable();
      assert.equal(audio.diagnostics.contextState, 'suspended');
      assert.equal(audio.diagnostics.continuousSources, 0);
      assert.equal(audio.diagnostics.allocatedVoices, 0);
      if (hide) await audio.setHidden(false);
      else {
        await audio.setHidden(true);
        await audio.setHidden(false);
        assert.equal(audio.diagnostics.contextState, 'suspended', 'visibility must not override user mute');
        await audio.enable();
      }
      assert.equal(audio.diagnostics.contextState, 'running');
      assert.equal(audio.diagnostics.continuousSources, 0);
      assert.equal(audio.diagnostics.writingGain, 0);
      assert.deepEqual(audio.settings, settings);
    }
    assert.equal(FakeContext.instances.length, 1);
    audio.updateContact(sample);
    assert.equal(audio.diagnostics.contactSources, 2, 'lifecycle silence must not disable later writing');
    assert.ok(audio.diagnostics.writingGain > 0);
  });
});

test('muted weather is disconnected and cannot reappear when unrelated settings change', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    assert.equal(audio.diagnostics.weatherSources, 1);
    for (const nib of ['fine', 'broad', 'flex']) {
      audio.configure({ ...DEFAULT_SETTINGS, nib, ambienceVolume: 0 });
      ctx.advance(0.03);
      assert.equal(audio.diagnostics.weatherSources, 0);
      assert.equal(audio.diagnostics.continuousSources, 0);
      assert.equal(audio.diagnostics.rainGain, 0);
      assert.equal(ctx.gains[2].gain.value, 0);
    }
    audio.configure(DEFAULT_SETTINGS);
    assert.equal(audio.diagnostics.weatherSources, 1);
  });
});

test('live holder changes reshape contact balance without pitch changes or source restarts', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    const sample = { contact: true, speed: 150, pressure: 0.65 };
    audio.updateContact(sample);
    const layers = audio.texturedLayers;
    const sources = Object.values(layers).map((layer) => layer.voice.source);
    const gain = audio.diagnostics.writingGain;
    const bodyMix = layers.body.gain.gain.value;
    const grainMix = layers.grain.gain.gain.value;
    audio.configure({ ...DEFAULT_SETTINGS, pen: 'dip' });
    audio.updateContact(sample);
    assert.deepEqual(Object.values(layers).map((layer) => layer.voice.source), sources);
    for (const source of sources) assert.equal(source.playbackRate.value, 1);
    assert.equal(audio.diagnostics.writingGain, gain);
    assert.notEqual(layers.body.gain.gain.value, bodyMix);
    assert.notEqual(layers.grain.gain.gain.value, grainMix);
    assert.equal(audio.diagnostics.contactSources, 2);
    for (let i = 0; i < 50; i++) {
      audio.configure({ ...DEFAULT_SETTINGS, ambienceVolume: i % 2 ? 0 : 0.48, pen: i % 2 ? 'dip' : 'fountain' });
      audio.updateContact({ ...sample, contact: i % 3 !== 0 });
      assert.ok(audio.diagnostics.continuousSources <= 6);
    }
    audio.configure({ ...DEFAULT_SETTINGS, writingVolume: 0, ambienceVolume: 0 });
    ctx.advance(0.02);
    assert.equal(audio.diagnostics.writingGain, 0);
    assert.equal(audio.diagnostics.continuousSources, 0);
  });
});

test('zero music or master volume stops the music timer and restores it only when audible again', async () => {
  await withAudio(async (audio) => {
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'felt', musicVolume: 0 });
    await audio.enable();
    assert.equal(audio.diagnostics.musicTimerActive, false);
    assert.equal(audio.diagnostics.activeMusicVoices, 0);
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'felt', musicVolume: 0.2 });
    assert.equal(audio.diagnostics.musicTimerActive, true);
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'felt', masterVolume: 0 });
    assert.equal(audio.diagnostics.musicTimerActive, false);
    assert.equal(audio.diagnostics.activeMusicVoices, 0);
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'felt' });
    assert.equal(audio.diagnostics.musicTimerActive, true);
  });
});

test('music Off releases voices, cancels the timer, and keeps allocated voices bounded', async () => {
  await withAudio(async (audio) => {
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'felt' });
    assert.equal(audio.diagnostics.musicTimerActive, false);
    await audio.enable();
    assert.equal(audio.diagnostics.musicTimerActive, true);
    assert.ok(audio.diagnostics.activeMusicVoices > 0);
    const ctx = FakeContext.instances[0];
    for (let i = 0; i < 60; i++) {
      audio.configure({ ...DEFAULT_SETTINGS, musicTrack: i % 2 === 0 ? 'glass' : 'felt' });
      assert.ok(audio.diagnostics.allocatedVoices <= 24);
      ctx.advance(0.2);
    }
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'off' });
    assert.equal(audio.diagnostics.activeMusicVoices, 0);
    assert.equal(audio.diagnostics.musicTimerActive, false);
    ctx.advance(0.2);
    assert.equal(audio.diagnostics.allocatedVoices, 0);
  });
});

test('hidden tabs suspend and clean voices, and returning respects the chosen mute state', async () => {
  await withAudio(async (audio) => {
    await audio.setHidden(true);
    await audio.setHidden(false);
    assert.equal(FakeContext.instances.length, 0);
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'glass' });
    await audio.enable();
    audio.cue('leather');
    audio.updateContact({ contact: true, speed: 132, pressure: 0.8 });
    await audio.setHidden(true);
    assert.equal(audio.enabled, true);
    assert.equal(audio.diagnostics.contextState, 'suspended');
    assert.equal(audio.diagnostics.writingGain, 0);
    assert.equal(audio.diagnostics.allocatedVoices, 0);
    assert.equal(audio.diagnostics.musicTimerActive, false);
    await audio.setHidden(false);
    assert.equal(audio.diagnostics.contextState, 'running');
    assert.equal(audio.diagnostics.contact, false);
    assert.equal(audio.diagnostics.musicTimerActive, true);
    await audio.disable();
    await audio.setHidden(true);
    await audio.setHidden(false);
    assert.equal(audio.diagnostics.contextState, 'suspended');
  });
});

test('muting before the first interaction creates no audio graph and survives later configuration', async () => {
  await withAudio(async (audio) => {
    assert.equal(audio.enabled, true);
    assert.equal(FakeContext.instances.length, 0);
    await audio.disable();
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'felt' });
    await audio.setHidden(true);
    await audio.setHidden(false);
    assert.equal(audio.enabled, false);
    assert.equal(FakeContext.instances.length, 0);
    assert.equal(audio.diagnostics.musicTimerActive, false);
    await audio.enable();
    assert.equal(FakeContext.instances.length, 1);
  });
});

test('a delayed resume cannot override a later disable or visibility change', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    await audio.disable();
    const ctx = FakeContext.instances[0];
    let release;
    ctx.resumeGate = new Promise((resolve) => { release = resolve; });
    const enabling = audio.enable();
    await Promise.resolve();
    const disabling = audio.disable();
    release();
    assert.equal(await enabling, false);
    await disabling;
    assert.equal(ctx.state, 'suspended');
    assert.equal(audio.enabled, false);
    ctx.resumeGate = null;
    const reenable = audio.enable();
    const hiding = audio.setHidden(true);
    await Promise.all([reenable, hiding]);
    assert.equal(audio.enabled, true);
    assert.equal(ctx.state, 'suspended');
    assert.equal(audio.diagnostics.musicTimerActive, false);
  });
});

test('Textured allocates two fixed-rate contact layers lazily, never an idle sound bed', async () => {
  await withAudio(async (audio) => {
    assert.equal(audio.diagnostics.writingSound, 'textured');
    assert.equal(audio.texturedLayers, null);
    assert.equal(audio.diagnostics.contextState, 'not-created');
    await audio.enable();
    const ctx = FakeContext.instances[0];
    assert.equal(ctx.sources.length, 0);
    assert.equal(audio.texturedLayers, null);
    const sample = { contact: true, speed: 132, pressure: 0.6, angle: Math.PI / 2 };
    audio.updateContact(sample);
    assert.equal(audio.diagnostics.contactSources, 2);
    assert.equal(audio.diagnostics.texturedContactSources, 2);
    assert.equal(ctx.sources.length, 2);
    const layers = audio.texturedLayers;
    for (const [kind, layer] of Object.entries(layers)) {
      assert.equal(layer.voice.source.playbackRate.value, 1);
      assert.notEqual(layer.buffer, audio.noise);
      assert.equal(layer.input.type, 'highpass');
      assert.equal(layer.lowpass.type, 'lowpass');
      assert.ok(layer.input.Q.value <= 0.55 && layer.lowpass.Q.value <= 0.55);
      assert.equal(layer.buffer.duration, kind === 'body' ? 11 : 13);
    }
    const sources = [layers.body.voice.source, layers.grain.voice.source];
    for (const paper of ['smooth', 'parchment', 'cotton']) {
      for (const pen of ['fountain', 'dip']) {
        for (const nib of ['fine', 'broad', 'flex']) {
          const settings = { ...TEXTURED_SETTINGS, paper, pen, nib };
          audio.configure(settings);
          for (const angle of [-Math.PI, 0, Math.PI / 4, Math.PI / 2, Math.PI]) {
            const contact = { ...sample, angle };
            audio.updateContact(contact);
            const parameters = contactTextureParameters(contact, settings, settings.writingSound);
            assert.equal(audio.diagnostics.writingGain, parameters.gain);
            assert.equal(layers.body.gain.gain.value, parameters.gain * parameters.bodyMix);
            assert.equal(layers.grain.gain.gain.value, parameters.gain * parameters.grainMix);
            assert.equal(layers.body.lowpass.frequency.value, Math.min(ctx.sampleRate * 0.45, parameters.bodyLowpass));
            assert.equal(layers.grain.lowpass.frequency.value, Math.min(ctx.sampleRate * 0.45, parameters.grainLowpass));
          }
        }
      }
    }
    assert.equal(audio.texturedLayers, layers);
    assert.deepEqual([layers.body.voice.source, layers.grain.voice.source], sources);
    assert.equal(ctx.sources.length, 2, 'material and direction changes must not restart contact layers');
    audio.updateContact({ contact: false, speed: 0, pressure: 0 });
    assert.equal(audio.diagnostics.contactSources, 0);
    for (const layer of Object.values(layers)) {
      const events = layer.gain.gain.events.length;
      const zero = layer.gain.gain.events.at(-1);
      assert.deepEqual(zero.slice(0, 2), ['set', 0]);
      assert.ok(zero[2] - ctx.currentTime <= 0.0071);
      for (let frame = 0; frame < 60; frame++) audio.updateContact({ contact: false, speed: 0, pressure: 0 });
      assert.equal(layer.gain.gain.events.length, events);
    }
    ctx.advance(0.02);
    assert.equal(audio.diagnostics.continuousSources, 0);
    for (const source of sources) assert.equal(source.connected, false);
  }, TEXTURED_SETTINGS);
});

test('live sound comparison switches textures and restores cached buffers without touching other buses', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    const sample = { contact: true, speed: 132, pressure: 0.7, angle: 0.9 };
    audio.updateContact(sample);
    audio.cue('paper');
    const layers = audio.texturedLayers;
    const texturedSources = [layers.body.voice.source, layers.grain.voice.source];
    const texturedBuffers = [layers.body.buffer, layers.grain.buffer];
    const mixer = audio.diagnostics.mixer;
    audio.configure({ ...TEXTURED_SETTINGS, writingSound: 'dry-fibers' });
    assert.equal(audio.diagnostics.contactSources, 0, 'profile changes must not replay a cached contact');
    assert.equal(audio.diagnostics.writingGain, 0);
    audio.updateContact(sample);
    assert.equal(audio.diagnostics.contactSources, 2);
    assert.equal(audio.diagnostics.preparedContactSound, 'dry-fibers');
    const parameters = contactTextureParameters(sample, TEXTURED_SETTINGS, 'dry-fibers');
    assert.equal(layers.body.gain.gain.value, parameters.gain * parameters.bodyMix);
    assert.equal(layers.grain.gain.gain.value, parameters.gain * parameters.grainMix);
    for (const [index, layer] of Object.values(layers).entries()) {
      assert.notEqual(layer.buffer, texturedBuffers[index]);
      assert.equal(layer.voice.source.playbackRate.value, 1);
    }
    assert.deepEqual(audio.diagnostics.mixer, mixer);
    assert.equal(audio.diagnostics.activeCues, 1);
    assert.equal(audio.diagnostics.weatherSources, 0);
    assert.equal(audio.diagnostics.musicTrack, 'off');
    ctx.advance(0.02);
    for (const source of texturedSources) assert.equal(source.connected, false);
    assert.equal(audio.diagnostics.continuousSources, 2);
    const drySources = [layers.body.voice.source, layers.grain.voice.source];
    audio.configure(TEXTURED_SETTINGS);
    assert.equal(audio.diagnostics.contactSources, 0);
    audio.updateContact(sample);
    assert.equal(audio.diagnostics.contactSources, 2);
    assert.equal(audio.texturedLayers, layers, 'comparison must reuse the generated textures');
    assert.deepEqual([layers.body.buffer, layers.grain.buffer], texturedBuffers);
    ctx.advance(0.02);
    for (const source of drySources) assert.equal(source.connected, false);
    assert.equal(audio.diagnostics.continuousSources, 2);
    assert.equal(FakeContext.instances.length, 1);
  }, TEXTURED_SETTINGS);
});

test('all four sound palettes use their own contact model and reuse a bounded three-palette cache', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const sample = { contact: true, speed: 132, pressure: 0.65, angle: Math.PI / 3 };
    const sounds = WRITING_SOUND_IDS;
    for (const writingSound of sounds) audio.configure({ ...TEXTURED_SETTINGS, writingSound });
    assert.equal(audio.diagnostics.contactBufferPairs, 0, 'choosing a sound at rest should not generate contact audio');
    let graph;
    const bodyBuffers = new Set();
    for (const writingSound of sounds) {
      const settings = { ...TEXTURED_SETTINGS, writingSound };
      audio.configure(settings);
      assert.equal(audio.diagnostics.contactSources, 0);
      audio.updateContact(sample);
      const parameters = contactTextureParameters(sample, settings, writingSound);
      assert.equal(audio.diagnostics.writingGain, parameters.gain);
      assert.equal(audio.diagnostics.contactSources, 2);
      assert.ok(audio.diagnostics.contactBufferPairs <= 3);
      graph ??= audio.texturedLayers;
      assert.equal(audio.texturedLayers, graph, 'changing palettes must reuse the two-layer graph');
      assert.equal(audio.diagnostics.preparedContactSound, writingSound);
      assert.equal(graph.body.gain.gain.value, parameters.gain * parameters.bodyMix);
      assert.equal(graph.grain.gain.gain.value, parameters.gain * parameters.grainMix);
      assert.equal(graph.body.voice.source.buffer, graph.body.buffer);
      assert.equal(graph.grain.voice.source.buffer, graph.grain.buffer);
      bodyBuffers.add(graph.body.buffer);
    }
    assert.equal(bodyBuffers.size, 4, 'the four contact palettes must not share one placeholder buffer');
    const cached = audio.texturedLayers.body.buffer;
    audio.configure({ ...TEXTURED_SETTINGS, writingSound: 'fine-feedback' });
    audio.updateContact(sample);
    audio.configure({ ...TEXTURED_SETTINGS, writingSound: 'dry-fibers' });
    audio.updateContact(sample);
    assert.equal(audio.texturedLayers.body.buffer, cached);
    audio.dispose();
    assert.equal(audio.diagnostics.contactBufferPairs, 0);
    assert.equal(audio.diagnostics.contactSources, 0);
  }, TEXTURED_SETTINGS);
});

test('rapid four-way comparison and pen lifts keep active and retiring sources bounded', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    for (let step = 0; step < 160; step++) {
      const writingSound = WRITING_SOUND_IDS[step % WRITING_SOUND_IDS.length];
      audio.configure({ ...TEXTURED_SETTINGS, writingSound });
      audio.updateContact({ contact: step % 3 !== 0, speed: 132, pressure: 0.7, angle: step * 0.2 });
      assert.ok(audio.diagnostics.contactSources <= 2);
      assert.ok(audio.diagnostics.continuousSources <= 4);
      assert.ok(audio.diagnostics.contactBufferPairs <= 3);
    }
    audio.updateContact({ contact: false, speed: 0, pressure: 0 });
    ctx.advance(0.02);
    assert.equal(audio.diagnostics.continuousSources, 0);
    assert.equal(audio.diagnostics.allocatedVoices, 0);
    assert.ok(ctx.sources.every((source) => !source.connected));
  }, TEXTURED_SETTINGS);
});

test('a profile change waits for a fresh contact instead of replaying the last moving sample', async () => {
  for (const [index, writingSound] of WRITING_SOUND_IDS.entries()) {
    await withAudio(async (audio) => {
      await audio.enable();
      audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
      audio.configure({ ...TEXTURED_SETTINGS, writingSound: WRITING_SOUND_IDS[(index + 1) % WRITING_SOUND_IDS.length] });
      assert.equal(audio.diagnostics.writingGain, 0);
      assert.equal(audio.diagnostics.contactSources, 0);
      audio.updateContact({ contact: false, speed: 132, pressure: 0.7 });
      FakeContext.instances[0].advance(0.02);
      assert.equal(audio.diagnostics.continuousSources, 0);
      assert.equal(audio.diagnostics.contact, false);
    }, { ...TEXTURED_SETTINGS, writingSound });
  }
});

test('sound comparison preserves music playback, pause intent and the connected recording bus', async () => {
  await withAudio(async (audio) => {
    const settings = { ...APP_DEFAULTS, musicTrack: 'felt', ambienceVolume: 0 };
    audio.configure(settings);
    await audio.enable();
    const media = {};
    audio.connectRecording(media);
    const recording = audio.recordingSource;
    const timer = audio.musicTimer;
    const voices = audio.diagnostics.activeMusicVoices;
    audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
    for (const writingSound of WRITING_SOUND_IDS) {
      audio.configure({ ...settings, writingSound });
      assert.equal(audio.musicTimer, timer);
      assert.equal(audio.diagnostics.activeMusicVoices, voices);
      assert.equal(audio.recordingSource, recording);
      assert.equal(recording.mediaElement, media);
      assert.equal(audio.recordingGain.gain.value, 0.18);
    }
    audio.pauseMusic();
    for (const writingSound of WRITING_SOUND_IDS) {
      audio.configure({ ...settings, writingSound });
      assert.equal(audio.diagnostics.musicPaused, true);
      assert.equal(audio.diagnostics.musicTimerActive, false);
      assert.equal(audio.diagnostics.activeMusicVoices, 0);
      assert.equal(audio.recordingSource, recording);
    }
  }, TEXTURED_SETTINGS);
});

test('profile changes cannot resurrect stale contact after mute, hidden state or a zero pen mixer', async () => {
  for (const action of ['mute', 'hide', 'zero']) {
    await withAudio(async (audio) => {
      await audio.enable();
      const ctx = FakeContext.instances[0];
      audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
      if (action === 'mute') await audio.disable();
      else if (action === 'hide') await audio.setHidden(true);
      else audio.configure({ ...TEXTURED_SETTINGS, writingVolume: 0 });
      audio.configure({ ...TEXTURED_SETTINGS, writingSound: 'dry-fibers', writingVolume: action === 'zero' ? 0 : 0.3 });
      ctx.advance(0.02);
      assert.equal(audio.diagnostics.contactSources, 0);
      assert.equal(audio.diagnostics.continuousSources, 0);
      if (action === 'mute') await audio.enable();
      else if (action === 'hide') await audio.setHidden(false);
      else audio.configure({ ...TEXTURED_SETTINGS, writingSound: 'dry-fibers' });
      audio.configure(TEXTURED_SETTINGS);
      assert.equal(audio.diagnostics.writingGain, 0);
      assert.equal(audio.diagnostics.continuousSources, 0);
      audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
      assert.equal(audio.diagnostics.texturedContactSources, 2);
    }, TEXTURED_SETTINGS);
  }
});

test('all four sounds follow actual engine lifts, pause, resume, completion and reset', async () => {
  for (const writingSound of WRITING_SOUND_IDS) {
    const settings = { ...TEXTURED_SETTINGS, writingSound };
    await withAudio(async (audio) => {
      await audio.enable();
      const ctx = FakeContext.instances[0];
      const layout = layoutText('Ink.', { ...PAGE, style: 'correspondence' });
      assert.equal(layout.ok, true);
      const engine = new WritingEngine(layout, settings);
      engine.start();
      let sawContact = false;
      let sawLift = false;
      let paused = false;
      for (let frame = 0; frame < 1800 && engine.status !== 'complete'; frame++) {
        const sample = engine.tick(1 / 60).pen;
        ctx.advance(1 / 60);
        audio.updateContact(sample);
        if (sample.contact && sample.speed > 0) {
          sawContact = true;
          assert.ok(audio.diagnostics.writingGain > 0);
          if (!paused) {
            engine.pause();
            audio.updateContact(engine.peek());
            assert.equal(audio.diagnostics.writingGain, 0);
            assert.equal(audio.diagnostics.contactSources, 0);
            ctx.advance(0.02);
            assert.equal(audio.diagnostics.continuousSources, 0);
            engine.resume();
            paused = true;
          }
        } else {
          if (sample.status === 'writing') sawLift = true;
          assert.equal(audio.diagnostics.writingGain, 0);
          assert.equal(audio.diagnostics.contactSources, 0);
        }
      }
      assert.ok(sawContact && sawLift && paused);
      assert.equal(engine.status, 'complete');
      assert.equal(audio.diagnostics.writingGain, 0);
      ctx.advance(0.02);
      assert.equal(audio.diagnostics.continuousSources, 0);
      engine.reset();
      audio.updateContact(engine.peek());
      assert.equal(audio.diagnostics.writingGain, 0);
      assert.equal(audio.diagnostics.contactSources, 0);
    }, settings);
  }
});

test('weather clearing fades rain to zero and releases thunder, not unrelated cues', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    audio.configure({ ...DEFAULT_SETTINGS, weather: 'storm' });
    audio.thunder();
    audio.cue('paper');
    assert.equal(audio.diagnostics.activeCues, 2);
    audio.configure({ ...DEFAULT_SETTINGS, weather: 'clear' });
    assert.equal(audio.diagnostics.rainGain, 0);
    assert.equal(audio.diagnostics.activeCues, 1);
    const ctx = FakeContext.instances[0];
    ctx.advance(1);
    assert.equal(audio.diagnostics.allocatedVoices, 0);
  });
});

test('resume errors are surfaced, silence the master, and allow a later retry', async () => {
  await withAudio(async (audio, errors) => {
    await audio.enable();
    await audio.disable();
    const ctx = FakeContext.instances[0];
    ctx.failResume = true;
    assert.equal(await audio.enable(), false);
    assert.match(errors[0], /Audio device unavailable/);
    assert.equal(audio.enabled, false);
    assert.equal(ctx.gains[0].gain.value, 0);
    ctx.failResume = false;
    assert.equal(await audio.enable(), true);
    assert.equal(FakeContext.instances.length, 1);
  });
});

test('disposal while resume is pending cannot restart the graph or music', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    await audio.disable();
    const ctx = FakeContext.instances[0];
    let release;
    ctx.resumeGate = new Promise((resolve) => { release = resolve; });
    const enabling = audio.enable();
    await Promise.resolve();
    audio.dispose();
    release();
    assert.equal(await enabling, false);
    assert.equal(ctx.state, 'closed');
    assert.equal(audio.diagnostics.continuousSources, 0);
    assert.equal(audio.diagnostics.musicTimerActive, false);
    audio.dispose();
  });
});

test('recordings connect once to the quiet music bus without creating synthesized music', async () => {
  await withAudio(async (audio) => {
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'lofi' });
    const media = {};
    assert.throws(() => audio.connectRecording(media), /Enable sound/);
    await audio.enable();
    const ctx = FakeContext.instances[0];
    audio.connectRecording(media);
    audio.connectRecording(media);
    assert.equal(ctx.mediaSources.length, 1);
    assert.equal(audio.recordingGain.gain.value, 0.18);
    assert.equal(audio.diagnostics.musicTimerActive, false);
    assert.equal(audio.diagnostics.activeMusicVoices, 0);
    await audio.disable();
    await audio.enable();
    audio.connectRecording(media);
    assert.equal(ctx.mediaSources.length, 1);
    assert.equal(ctx.mediaSources[0].connected, true);
    assert.throws(() => audio.connectRecording({}), /already has a music player/);
    audio.dispose();
    assert.equal(ctx.mediaSources[0].connected, false);
  });
});

test('the original soundscapes can pause and resume without restarting on unrelated settings changes', async () => {
  await withAudio(async (audio) => {
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'felt' });
    await audio.enable();
    audio.pauseMusic();
    assert.equal(audio.diagnostics.musicTimerActive, false);
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'felt', ink: 'forest' });
    assert.equal(audio.diagnostics.musicTimerActive, false);
    audio.resumeMusic();
    assert.equal(audio.diagnostics.musicTimerActive, true);
    audio.configure({ ...DEFAULT_SETTINGS, musicTrack: 'lofi' });
    assert.equal(audio.diagnostics.activeMusicVoices, 0);
    assert.equal(audio.diagnostics.musicTimerActive, false);
  });
});

test('spatial off retains unity unpanned routing without panners, source allocation or early startup', async () => {
  await withAudio(async (audio) => {
    audio.updateSpatial({ pen: 0.35, window: -0.35 });
    assert.equal(FakeContext.instances.length, 0);
    await audio.enable();
    const ctx = FakeContext.instances[0];
    assert.equal(ctx.panners.length, 0);
    assert.equal(ctx.sources.length, 0);
    for (const [key, bus] of [['pen', audio.writing], ['window', audio.ambience]]) {
      const route = audio.spatial[key];
      assert.deepEqual([...bus.connections], [route.dry]);
      assert.deepEqual([...route.dry.connections], [audio.master]);
      assert.equal(route.dry.gain.value, 1, 'off must not pass mono audio through a center panner');
      assert.equal(route.panner, null);
    }
    for (let frame = 0; frame < 120; frame++) audio.updateSpatial({ pen: frame, window: -frame });
    assert.equal(ctx.panners.length, 0);
    assert.equal(ctx.sources.length, 0);
    assert.deepEqual([...audio.music.connections], [audio.master]);
    assert.deepEqual(audio.diagnostics.mixer, { master: 0.7, pen: 0.3, ambience: 0, music: 0 });
  }, { ...TEXTURED_SETTINGS, spatialSound: 'off' });
});

function assertSpatialFade(audio, enabled, now) {
  for (const route of Object.values(audio.spatial)) {
    for (const [parameter, value] of [[route.dry.gain, enabled ? 0 : 1], [route.wet.gain, enabled ? Math.SQRT2 : 0]]) {
      assert.deepEqual(parameter.events.at(-2), ['hold', now]);
      assert.deepEqual(parameter.events.at(-1), ['linear', value, now + 0.06]);
    }
  }
}

test('gentle routing places every pen palette and page cue together, weather at the window, and no music', async () => {
  const settings = { ...DEFAULT_SETTINGS, spatialSound: 'gentle', weather: 'storm', musicTrack: 'felt' };
  await withAudio(async (audio, errors) => {
    audio.updateSpatial({ pen: 0.23, window: -0.31 });
    await audio.enable();
    const ctx = FakeContext.instances[0];
    assert.equal(ctx.panners.length, 2);
    assert.equal(audio.diagnostics.spatialActive, true);
    assert.deepEqual(audio.diagnostics.spatialPan, { pen: 0.23, window: -0.31 });
    assertSpatialFade(audio, true, ctx.currentTime);
    for (const route of Object.values(audio.spatial)) {
      assert.deepEqual([...route.input.connections], [route.dry, route.panner]);
      assert.deepEqual([...route.panner.connections], [route.wet]);
      assert.deepEqual([...route.wet.connections], [audio.master]);
      assert.equal(route.panner.channelCount, 1);
      assert.equal(route.panner.channelCountMode, 'explicit');
      const left = Math.SQRT2 * Math.cos((route.pan + 1) * Math.PI / 4);
      const right = Math.SQRT2 * Math.sin((route.pan + 1) * Math.PI / 4);
      assert.ok(Math.abs(left * left + right * right - 2) < 1e-12, 'gentle placement retains original total mono power');
    }
    assert.deepEqual(audio.diagnostics.mixer, { master: 0.7, pen: 0.3, ambience: 0.2, music: 0.2 });
    for (const writingSound of WRITING_SOUND_IDS) {
      audio.configure({ ...settings, writingSound });
      audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
      for (const layer of Object.values(audio.texturedLayers)) {
        assert.deepEqual([...layer.gain.connections], [audio.writing]);
        assert.equal(layer.voice.source.playbackRate.value, 1);
      }
    }
    for (const kind of ['paper', 'ink', 'cap', 'leather']) audio.cue(kind);
    audio.thunder();
    for (const voice of audio.voices) {
      const expected = voice.kind === 'music' ? audio.music : voice.kind === 'thunder' ? audio.ambience : audio.writing;
      assert.deepEqual([...voice.gain.connections], [expected]);
    }
    assert.deepEqual([...audio.rain.connections], [audio.ambience]);
    const musicTimer = audio.musicTimer;
    const musicVoices = [...audio.voices].filter((voice) => voice.kind === 'music');
    audio.connectRecording({});
    assert.deepEqual([...audio.recordingSource.connections], [audio.recordingGain]);
    assert.deepEqual([...audio.recordingGain.connections], [audio.music]);
    assert.deepEqual([...audio.music.connections], [audio.master]);
    for (const spatialSound of ['off', 'gentle', 'off']) audio.configure({ ...settings, spatialSound });
    assert.equal(audio.musicTimer, musicTimer);
    assert.deepEqual([...audio.voices].filter((voice) => voice.kind === 'music'), musicVoices);
    assert.equal(audio.recordingGain.gain.value, 0.18);
    assert.deepEqual([...audio.music.connections], [audio.master]);
    assert.deepEqual(errors, []);
  }, settings);
});

test('spatial switching crossfades finite endpoints and reuses two routes without restarting contact or weather', async () => {
  const settings = { ...DEFAULT_SETTINGS, spatialSound: 'off' };
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
    audio.cue('paper');
    const sources = [...ctx.sources];
    const filters = [...ctx.filters];
    const mixer = audio.diagnostics.mixer;
    audio.configure({ ...settings, spatialSound: 'gentle' });
    const gains = [...ctx.gains];
    const panners = [...ctx.panners];
    for (let step = 0; step < 80; step++) {
      const enabled = step % 2 === 1;
      ctx.advance(0.001);
      audio.configure({ ...settings, spatialSound: enabled ? 'gentle' : 'off' });
      assertSpatialFade(audio, enabled, ctx.currentTime);
      assert.deepEqual(audio.diagnostics.mixer, mixer);
      assert.equal(audio.diagnostics.contactSources, 2);
      assert.equal(audio.diagnostics.weatherSources, 1);
      assert.equal(audio.diagnostics.activeCues, 1);
    }
    assert.deepEqual(ctx.panners, panners);
    assert.deepEqual(ctx.gains, gains);
    assert.deepEqual(ctx.sources, sources);
    assert.deepEqual(ctx.filters, filters);
    for (const spatialSound of ['off', 'gentle']) {
      audio.configure({ ...settings, spatialSound });
      const counts = Object.values(audio.spatial).map((route) => [route.dry.gain.events.length, route.wet.gain.events.length]);
      for (let frame = 0; frame < 100; frame++) {
        audio.updateSpatial({ pen: 0.21, window: -0.3 });
        audio.configure({ ...settings, spatialSound });
      }
      assert.deepEqual(Object.values(audio.spatial).map((route) => [route.dry.gain.events.length, route.wet.gain.events.length]), counts,
        'repeated frames and unchanged settings must not postpone crossfades');
    }
  }, settings);
});

test('moving spatial placement changes only bounded pan parameters, with smoothing and no redundant stationary events', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
    const sources = [...ctx.sources];
    const filters = ctx.filters.map((filter) => [filter.frequency.value, filter.frequency.events.length, filter.Q.value]);
    const gains = ctx.gains.map((gain) => gain.gain.events.length);
    for (const [placement, expected] of [
      [{ pen: 40, window: -20 }, { pen: 0.35, window: -0.35 }],
      [{ pen: -0.2, window: 0.27 }, { pen: -0.2, window: 0.27 }],
      [{ pen: NaN, window: Infinity }, { pen: 0, window: 0 }],
      [{ pen: -Infinity, window: undefined }, { pen: 0, window: 0 }],
    ]) {
      audio.updateSpatial(placement);
      assert.deepEqual(audio.diagnostics.spatialPan, expected);
    }
    for (const panner of ctx.panners) {
      assert.ok(panner.pan.events.some((event) => event[0] === 'hold'));
      assert.ok(panner.pan.events.some((event) => event[0] === 'target' && event[3] === 0.045));
      for (const event of panner.pan.events) {
        assert.ok(event.slice(1).every(Number.isFinite));
        if (['target', 'linear', 'set'].includes(event[0])) assert.ok(Math.abs(event[1]) <= 0.35);
      }
    }
    const panEvents = ctx.panners.map((panner) => panner.pan.events.length);
    for (let frame = 0; frame < 120; frame++) audio.updateSpatial({ pen: 0, window: 0 });
    assert.deepEqual(ctx.panners.map((panner) => panner.pan.events.length), panEvents);
    assert.deepEqual(ctx.sources, sources);
    assert.deepEqual(ctx.filters.map((filter) => [filter.frequency.value, filter.frequency.events.length, filter.Q.value]), filters);
    assert.deepEqual(ctx.gains.map((gain) => gain.gain.events.length), gains);
    for (const source of ctx.sources) {
      assert.equal(source.playbackRate.value, 1);
      assert.equal(source.playbackRate.events.length, 0);
    }
  }, { ...TEXTURED_SETTINGS, spatialSound: 'gentle' });
});

test('spatial routing preserves the seven millisecond contact zero and twelve millisecond source stop for all palettes', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    for (const writingSound of WRITING_SOUND_IDS) {
      audio.configure({ ...TEXTURED_SETTINGS, writingSound, spatialSound: 'gentle' });
      audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
      const sources = Object.values(audio.texturedLayers).map((layer) => layer.voice.source);
      audio.updateContact({ contact: false, speed: 0, pressure: 0 });
      for (const layer of Object.values(audio.texturedLayers)) {
        assert.deepEqual(layer.gain.gain.events.at(-1).slice(0, 2), ['set', 0]);
        assert.ok(layer.gain.gain.events.at(-1)[2] - ctx.currentTime <= 0.0071);
      }
      for (const source of sources) assert.ok(Math.abs(source.stopTime - ctx.currentTime - 0.012) < 1e-12);
      const count = ctx.sources.length;
      for (let frame = 0; frame < 90; frame++) audio.updateSpatial({ pen: frame / 100, window: -frame / 100 });
      assert.equal(ctx.sources.length, count);
      ctx.advance(0.02);
      assert.ok(sources.every((source) => !source.connected));
      assert.equal(audio.diagnostics.continuousSources, 0);
      assert.ok(audio.diagnostics.contactBufferPairs <= 3);
    }
  }, { ...TEXTURED_SETTINGS, spatialSound: 'gentle' });
});

test('spatial toggles cannot resurrect sources while muted, hidden, master-zero or all source buses are zero', async () => {
  for (const action of ['mute', 'hidden', 'master-zero', 'buses-zero']) {
    await withAudio(async (audio) => {
      await audio.enable();
      const ctx = FakeContext.instances[0];
      audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
      audio.thunder();
      let settings = { ...DEFAULT_SETTINGS, weather: 'storm', spatialSound: 'gentle' };
      if (action === 'mute') await audio.disable();
      else if (action === 'hidden') await audio.setHidden(true);
      else {
        settings = { ...settings, ...(action === 'master-zero' ? { masterVolume: 0 } : { writingVolume: 0, ambienceVolume: 0, musicVolume: 0 }) };
        audio.configure(settings);
      }
      ctx.advance(6);
      const sourceCount = ctx.sources.length;
      for (let step = 0; step < 60; step++) {
        audio.configure({ ...settings, spatialSound: step % 2 ? 'gentle' : 'off' });
        audio.updateSpatial({ pen: step, window: -step });
      }
      assert.equal(ctx.sources.length, sourceCount);
      assert.equal(audio.diagnostics.contactSources, 0);
      assert.equal(audio.diagnostics.weatherSources, 0);
      assert.equal(audio.diagnostics.continuousSources, 0);
      assert.equal(audio.diagnostics.allocatedVoices, 0);
    }, { ...DEFAULT_SETTINGS, weather: 'storm', spatialSound: 'gentle' });
  }
});

test('spatial preferences and frame updates respect delayed resume, later mute and fresh-contact startup', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    await audio.disable();
    const ctx = FakeContext.instances[0];
    let release;
    ctx.resumeGate = new Promise((resolve) => { release = resolve; });
    audio.configure({ ...TEXTURED_SETTINGS, spatialSound: 'gentle' });
    const enabling = audio.enable();
    await Promise.resolve();
    audio.updateSpatial({ pen: 0.3, window: -0.3 });
    const disabling = audio.disable();
    release();
    assert.equal(await enabling, false);
    await disabling;
    assert.equal(ctx.state, 'suspended');
    assert.equal(ctx.panners.length, 0, 'pending resume and later mute should not even allocate spatial paths');
    assert.equal(ctx.sources.length, 0);
    ctx.resumeGate = null;
    assert.equal(await audio.enable(), true);
    assert.equal(ctx.panners.length, 2);
    assert.equal(ctx.sources.length, 0);
    assert.deepEqual(audio.diagnostics.spatialPan, { pen: 0.3, window: -0.3 });
    audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
    assert.equal(audio.diagnostics.contactSources, 2);
  }, { ...TEXTURED_SETTINGS, spatialSound: 'off' });
});

test('missing or failing StereoPannerNode support explicitly reports once and preserves existing sound and dry routing', async () => {
  for (const failure of ['missing', 'first', 'second', 'first-output', 'second-input', 'second-output']) {
    await withAudio(async (audio, errors) => {
      await audio.enable();
      const ctx = FakeContext.instances[0];
      const createPanner = ctx.createStereoPanner.bind(ctx);
      let attempts = 0;
      ctx.createStereoPanner = failure === 'missing' ? undefined : () => {
        if (++attempts === (failure === 'second' ? 2 : 1)) throw new Error('Panner creation failed');
        return createPanner();
      };
      if (failure.endsWith('output') || failure === 'second-input') {
        ctx.createStereoPanner = () => {
          const panner = createPanner();
          const index = ++attempts;
          if (failure === `${index === 1 ? 'first' : 'second'}-output`) {
            panner.connect = () => { throw new Error('Panner output connection failed'); };
          }
          return panner;
        };
        if (failure === 'second-input') {
          const input = audio.spatial.window.input;
          const connect = input.connect.bind(input);
          input.connect = (destination) => {
            if (ctx.panners.includes(destination)) throw new Error('Panner input connection failed');
            return connect(destination);
          };
        }
      }
      for (let step = 0; step < 30; step++) {
        audio.configure({ ...TEXTURED_SETTINGS, spatialSound: step % 2 ? 'off' : 'gentle' });
        audio.updateSpatial({ pen: 0.3, window: -0.3 });
      }
      assert.equal(errors.length, 1);
      assert.match(errors[0], /Spatial sound is unavailable; your sounds will play without spatial placement/);
      assert.equal(audio.enabled, true);
      assert.equal(audio.diagnostics.spatialUnavailable, true);
      assert.equal(audio.diagnostics.spatialActive, false);
      for (const route of Object.values(audio.spatial)) {
        assert.deepEqual([...route.input.connections], [route.dry]);
        assert.equal(route.dry.gain.value, 1);
        assert.equal(route.wet, null);
        assert.equal(route.panner, null);
      }
      assert.ok(ctx.panners.every((panner) => !panner.connected), 'partial spatial construction must disconnect unused nodes');
      audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
      assert.equal(audio.diagnostics.contactSources, 2);
      assert.ok(audio.diagnostics.writingGain > 0);
      assert.equal(FakeContext.instances.length, 1);
    }, { ...TEXTURED_SETTINGS, spatialSound: 'off' });
  }
});

test('spatial fades work without cancelAndHoldAtTime and disposal disconnects their bounded graph', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    const routes = Object.values(audio.spatial);
    for (const route of routes) {
      route.dry.gain.cancelAndHoldAtTime = undefined;
      route.wet.gain.cancelAndHoldAtTime = undefined;
      route.panner.pan.cancelAndHoldAtTime = undefined;
    }
    audio.updateSpatial({ pen: 0.3, window: -0.3 });
    audio.configure({ ...TEXTURED_SETTINGS, spatialSound: 'off' });
    for (const route of routes) {
      for (const parameter of [route.dry.gain, route.wet.gain, route.panner.pan]) {
        const events = parameter.events.slice(-3);
        assert.equal(events[0][0], 'cancel');
        assert.equal(events[1][0], 'set');
        assert.equal(events[0][1], ctx.currentTime);
        assert.ok(events.flatMap((event) => event.slice(1)).every(Number.isFinite));
      }
    }
    audio.dispose();
    const gainCounts = ctx.gains.map((gain) => gain.gain.events.length);
    const panCounts = ctx.panners.map((panner) => panner.pan.events.length);
    audio.updateSpatial({ pen: -0.3, window: 0.3 });
    audio.configure({ ...TEXTURED_SETTINGS, spatialSound: 'gentle' });
    assert.equal(ctx.state, 'closed');
    assert.equal(audio.diagnostics.spatialActive, false);
    assert.equal(ctx.panners.length, 2);
    assert.deepEqual(ctx.panners.map((panner) => panner.pan.events.length), panCounts);
    assert.ok(routes.every((route) => [route.dry, route.wet, route.panner, route.input].every((node) => !node.connected)));
    for (const route of routes) {
      assert.equal(route.dry.gain.events.length, gainCounts[ctx.gains.indexOf(route.dry)]);
      assert.equal(route.wet.gain.events.length, gainCounts[ctx.gains.indexOf(route.wet)]);
    }
  }, { ...TEXTURED_SETTINGS, spatialSound: 'gentle' });
});

const flushAudio = () => new Promise((resolve) => setImmediate(resolve));

test('autoplay immediately creates one real graph and starts allowed ambience and synth without a gesture', async () => {
  await withAudio(async (audio, errors) => {
    assert.equal(FakeContext.instances.length, 0);
    const starting = audio.tryAutoplay();
    const ctx = FakeContext.instances[0];
    assert.ok(ctx, 'the initial attempt must not wait for an interaction');
    assert.equal(ctx.resumeCalls, 1, 'native resume must run in the calling turn');
    assert.equal(await starting, true);
    assert.equal(audio.diagnostics.weatherSources, 1);
    assert.equal(audio.diagnostics.musicTimerActive, true);
    assert.equal(audio.diagnostics.contactSources, 0);
    assert.equal(audio.diagnostics.browserBlocked, false);
    assert.equal(audio.diagnostics.activationPending, false);
    assert.equal(await audio.tryAutoplay(), true);
    assert.equal(ctx.resumeCalls, 1);
    assert.deepEqual(errors, []);
  }, { ...DEFAULT_SETTINGS, musicTrack: 'felt' });
});

test('a context which is already running at creation starts its mixer without unnecessary native retries', async () => {
  await withAudio(async (audio) => {
    FakeContext.onCreate = (ctx) => { ctx.state = 'running'; };
    assert.equal(await audio.tryAutoplay(), true);
    const ctx = FakeContext.instances[0];
    assert.equal(ctx.resumeCalls, 0);
    assert.equal(audio.diagnostics.weatherSources, 1);
    assert.equal(audio.master.gain.value, DEFAULT_SETTINGS.masterVolume);
  });
});

test('NotAllowedError is browser-gated sound intent, not mute or a reported device failure', async () => {
  await withAudio(async (audio, errors) => {
    FakeContext.onCreate = (ctx) => { ctx.resumeError = new DOMException('User activation required', 'NotAllowedError'); };
    assert.equal(await audio.tryAutoplay(), false);
    const ctx = FakeContext.instances[0];
    assert.equal(audio.enabled, true);
    assert.equal(audio.diagnostics.browserBlocked, true);
    assert.equal(audio.diagnostics.activationPending, false);
    assert.equal(audio.master.gain.value, 0);
    assert.equal(ctx.sources.length, 0);
    for (let step = 0; step < 20; step++) await audio.tryAutoplay();
    assert.equal(ctx.resumeCalls, 1, 'blocked autoplay is not a retry loop');
    await audio.tryAutoplay(true);
    assert.equal(ctx.resumeCalls, 2, 'an explicit autoplay retry may request once more');
    ctx.resumeError = null;
    const enabling = audio.enable();
    assert.equal(ctx.resumeCalls, 3, 'trusted enable must call native resume before yielding');
    assert.equal(await enabling, true);
    assert.equal(audio.diagnostics.browserBlocked, false);
    assert.deepEqual(errors, []);
  });
});

test('a never-settling autoplay request has bounded UI pending state and cannot occupy a later trusted retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withAudio(async (audio, errors) => {
    let release;
    FakeContext.onCreate = (ctx) => { ctx.resumeGate = new Promise((resolve) => { release = resolve; }); };
    const autoplay = audio.tryAutoplay();
    const ctx = FakeContext.instances[0];
    assert.equal(audio.diagnostics.activationPending, true);
    t.mock.timers.tick(800);
    assert.equal(await autoplay, false);
    assert.equal(audio.enabled, true);
    assert.equal(audio.diagnostics.browserBlocked, true);
    assert.equal(audio.diagnostics.activationPending, false);
    ctx.resumeGate = null;
    const trusted = audio.enable();
    assert.equal(ctx.resumeCalls, 2);
    assert.equal(await trusted, true);
    release();
    await flushAudio();
    assert.equal(FakeContext.instances.length, 1);
    assert.equal(audio.diagnostics.weatherSources, 1);
    assert.deepEqual(errors, []);
  });
});

test('a trusted resume which remains pending also settles false without discarding enabled intent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withAudio(async (audio) => {
    FakeContext.onCreate = (ctx) => { ctx.resumeGate = new Promise(() => {}); };
    const first = audio.enable();
    t.mock.timers.tick(800);
    assert.equal(await first, false);
    assert.equal(audio.enabled, true);
    assert.equal(audio.diagnostics.activationPending, false);
    const ctx = FakeContext.instances[0];
    ctx.resumeGate = null;
    const retry = audio.enable();
    assert.equal(ctx.resumeCalls, 2);
    assert.equal(await retry, true);
  }, TEXTURED_SETTINGS);
});

test('mute and disposal immediately settle pending startup and cannot be undone by its late native resume', async () => {
  for (const action of ['mute', 'dispose']) {
    let notifications = 0;
    await withAudio(async (audio, errors) => {
      let release;
      FakeContext.onCreate = (ctx) => { ctx.resumeGate = new Promise((resolve) => { release = resolve; }); };
      const autoplay = audio.tryAutoplay();
      const ctx = FakeContext.instances[0];
      if (action === 'mute') await audio.disable();
      else audio.dispose();
      const count = notifications;
      assert.equal(await autoplay, false);
      assert.equal(audio.diagnostics.activationPending, false);
      release();
      await flushAudio();
      assert.equal(audio.enabled, false);
      assert.equal(ctx.state, action === 'mute' ? 'suspended' : 'closed');
      assert.equal(ctx.sources.length, 0);
      assert.equal(audio.master.gain.value, 0);
      if (action === 'dispose') {
        assert.equal(ctx.stateListeners.size, 0);
        assert.equal(notifications, count, 'disposed native promises cannot update the UI');
      }
      assert.deepEqual(errors, []);
    }, DEFAULT_SETTINGS, () => notifications++);
  }
});

test('a trusted activation does not wait behind pending autoplay, and its success survives an obsolete rejection', async () => {
  await withAudio(async (audio, errors) => {
    let reject;
    FakeContext.onCreate = (ctx) => { ctx.resumeGate = new Promise((_, failure) => { reject = failure; }); };
    const first = audio.tryAutoplay();
    const ctx = FakeContext.instances[0];
    ctx.resumeGate = null;
    const retry = audio.enable();
    assert.equal(ctx.resumeCalls, 2, 'the second native resume happens before the first promise settles');
    assert.equal(await retry, true);
    reject(new Error('Obsolete attempt failed'));
    await first;
    await flushAudio();
    assert.equal(audio.enabled, true);
    assert.equal(ctx.state, 'running');
    assert.deepEqual(errors, []);
  });
});

test('native state changes notify availability, clear stalled contact, and resume only intended ambient music', async () => {
  const states = [];
  let instance;
  await withAudio(async (audio) => {
    instance = audio;
    await audio.tryAutoplay();
    const ctx = FakeContext.instances[0];
    assert.equal(ctx.stateListeners.size, 1);
    audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
    ctx.setState('suspended');
    assert.equal(audio.enabled, true);
    assert.equal(audio.diagnostics.contactSources, 0);
    assert.equal(audio.diagnostics.continuousSources, 0);
    ctx.setState('running');
    assert.equal(audio.diagnostics.weatherSources, 1);
    assert.equal(audio.diagnostics.musicTimerActive, true);
    assert.equal(audio.diagnostics.contactSources, 0, 'native resume must not replay old contact');
    assert.ok(states.includes('suspended') && states.includes('running'));
    await audio.disable();
    ctx.setState('running');
    assert.equal(ctx.state, 'suspended');
    assert.equal(audio.diagnostics.continuousSources, 0);
    audio.dispose();
    const notifications = states.length;
    ctx.dispatchEvent(new Event('statechange'));
    assert.equal(states.length, notifications);
    assert.equal(ctx.stateListeners.size, 0);
  }, { ...DEFAULT_SETTINGS, musicTrack: 'felt' }, () => { if (instance) states.push(instance.diagnostics.contextState); });
});

test('native running state can settle a resume whose promise is still pending, without retrying it', async () => {
  await withAudio(async (audio) => {
    FakeContext.onCreate = (ctx) => { ctx.resumeGate = new Promise(() => {}); };
    const pending = audio.tryAutoplay();
    const ctx = FakeContext.instances[0];
    ctx.setState('running');
    assert.equal(await pending, true);
    assert.equal(audio.diagnostics.activationPending, false);
    assert.equal(ctx.resumeCalls, 1);
    assert.equal(audio.diagnostics.weatherSources, 1);
  });
});

test('autoplay respects explicit mute, paused music and every saved zero bus', async () => {
  await withAudio(async (audio) => {
    await audio.disable();
    assert.equal(await audio.tryAutoplay(), false);
    assert.equal(await audio.tryAutoplay(true), false);
    assert.equal(FakeContext.instances.length, 0);
  });
  for (const settings of [
    { ...DEFAULT_SETTINGS, masterVolume: 0, musicTrack: 'felt' },
    { ...DEFAULT_SETTINGS, writingVolume: 0, ambienceVolume: 0, musicVolume: 0, musicTrack: 'glass' },
  ]) {
    await withAudio(async (audio) => {
      await audio.tryAutoplay();
      assert.equal(FakeContext.instances[0].sources.length, 0);
      assert.equal(audio.diagnostics.musicTimerActive, false);
    }, settings);
  }
  await withAudio(async (audio) => {
    audio.pauseMusic();
    await audio.tryAutoplay();
    assert.equal(audio.diagnostics.musicPaused, true);
    assert.equal(audio.diagnostics.musicTimerActive, false);
  }, { ...DEFAULT_SETTINGS, musicTrack: 'felt' });
});

test('real automatic startup errors remain explicit and can be retried after device recovery', async () => {
  await withAudio(async (audio, errors) => {
    FakeContext.onCreate = (ctx) => { ctx.failResume = true; };
    assert.equal(await audio.tryAutoplay(), false);
    assert.match(errors[0], /Audio device unavailable/);
    assert.equal(audio.enabled, false);
    FakeContext.instances[0].failResume = false;
    assert.equal(await audio.enable(), true);
    assert.equal(FakeContext.instances.length, 1);
  });
});

test('background contact uses renewable native gate deadlines without changing timbres or churning sources', async () => {
  for (const writingSound of WRITING_SOUND_IDS) {
    await withAudio(async (audio) => {
      await audio.enable();
      const ctx = FakeContext.instances[0];
      const sample = { contact: true, speed: 132, pressure: 0.7 };
      audio.updateContact(sample);
      const voices = Object.values(audio.texturedLayers).map((layer) => layer.voice);
      const sources = voices.map((voice) => voice.source);
      const foregroundGates = voices.map((voice) => voice.gate.gain.events.length);
      for (let frame = 0; frame < 10; frame++) audio.updateContact(sample);
      assert.deepEqual(voices.map((voice) => voice.gate.gain.events.length), foregroundGates, 'foreground gates are untouched');
      const layerGains = Object.values(audio.texturedLayers).map((layer) => layer.gain.gain.value);
      audio.setBackground(true);
      for (let frame = 0; frame < 20; frame++) {
        ctx.advance(1 / 30);
        audio.updateContact(sample);
        const deadline = ctx.currentTime + 0.3;
        assert.equal(audio.diagnostics.contactDeadline, deadline);
        for (const voice of voices) {
          const events = voice.gate.gain.events;
          assert.deepEqual(events.at(-3), ['set', 1, ctx.currentTime + 0.28]);
          assert.deepEqual(events.at(-2), ['linear', 0, deadline]);
          assert.deepEqual(events.at(-1), ['set', 0, deadline]);
          assert.equal(voice.source.stopTime, Infinity, 'the watchdog fades native gain, not per-frame source restarts');
          assert.equal(voice.source.playbackRate.value, 1);
        }
      }
      assert.deepEqual(Object.values(audio.texturedLayers).map((layer) => layer.voice.source), sources);
      assert.deepEqual(Object.values(audio.texturedLayers).map((layer) => layer.gain.gain.value), layerGains);
      const eventsBeforeStall = voices.map((voice) => voice.gate.gain.events.length);
      ctx.advance(0.31);
      assert.equal(audio.diagnostics.writingGain, 0);
      assert.equal(audio.diagnostics.contact, false);
      assert.deepEqual(voices.map((voice) => voice.gate.gain.events.length), eventsBeforeStall, 'expiry requires no JS callback');
      audio.setBackground(false);
      audio.setBackground(true);
      audio.setBackground(false);
      assert.deepEqual(voices.map((voice) => voice.gate.gain.events.length), eventsBeforeStall, 'visibility alone cannot reopen an expired gate');
      audio.updateContact(sample);
      assert.equal(audio.diagnostics.contactDeadline, null);
      assert.ok(audio.diagnostics.writingGain > 0);
      for (const voice of voices) {
        assert.equal(voice.contactDeadline, undefined);
        assert.deepEqual(voice.gate.gain.events.at(-1), ['linear', 1, ctx.currentTime + 0.004]);
      }
      assert.equal(ctx.sources.length, 2);
    }, { ...TEXTURED_SETTINGS, writingSound, spatialSound: 'gentle' });
  }
});

test('background lifts retain seven millisecond silence and twelve millisecond source stops', async () => {
  await withAudio(async (audio) => {
    audio.setBackground(true);
    await audio.enable();
    const ctx = FakeContext.instances[0];
    audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
    const voices = Object.values(audio.texturedLayers).map((layer) => layer.voice);
    audio.updateContact({ contact: false, speed: 0, pressure: 0 });
    for (const voice of voices) {
      assert.deepEqual(voice.gate.gain.events.at(-1).slice(0, 2), ['set', 0]);
      assert.ok(voice.gate.gain.events.at(-1)[2] - ctx.currentTime <= 0.0071);
      assert.ok(Math.abs(voice.source.stopTime - ctx.currentTime - 0.012) < 1e-12);
    }
    assert.equal(audio.diagnostics.contactDeadline, null);
    ctx.advance(0.03);
    assert.equal(audio.diagnostics.continuousSources, 0);
  }, TEXTURED_SETTINGS);
});

test('background policy keeps weather, music and material cues alive without arming their gains', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    const rain = audio.rainVoice;
    const rainEvents = rain.gate.gain.events.length;
    const musicTimer = audio.musicTimer;
    audio.setBackground(true);
    audio.cue('paper');
    audio.thunder();
    assert.equal(audio.diagnostics.activeCues, 2);
    assert.equal(audio.diagnostics.musicTimerActive, true);
    assert.equal(audio.musicTimer, musicTimer);
    assert.equal(audio.rainVoice, rain);
    assert.equal(rain.contactDeadline, undefined);
    assert.equal(rain.gate.gain.events.length, rainEvents);
    assert.equal(audio.diagnostics.contactDeadline, null);
    assert.equal(ctx.suspendCalls, 0);
    assert.equal(ctx.state, 'running');
  }, { ...DEFAULT_SETTINGS, weather: 'storm', musicTrack: 'felt' });
});

test('background watchdogs cannot resurrect muted, paused, zero-bus or disposed contact', async () => {
  for (const action of ['mute', 'lift', 'master-zero', 'writing-zero', 'dispose']) {
    await withAudio(async (audio) => {
      await audio.enable();
      const ctx = FakeContext.instances[0];
      audio.setBackground(true);
      audio.updateContact({ contact: true, speed: 132, pressure: 0.7 });
      if (action === 'mute') await audio.disable();
      else if (action === 'lift') audio.updateContact({ contact: false, speed: 0, pressure: 0 });
      else if (action === 'dispose') audio.dispose();
      else audio.configure({ ...TEXTURED_SETTINGS, [action === 'master-zero' ? 'masterVolume' : 'writingVolume']: 0 });
      ctx.advance(1);
      const count = ctx.sources.length;
      audio.setBackground(false);
      audio.setBackground(true);
      audio.updateContact(action === 'lift' ? { contact: false, speed: 0, pressure: 0 } : { contact: true, speed: 132, pressure: 0.7 });
      assert.equal(audio.diagnostics.writingGain, 0);
      assert.equal(audio.diagnostics.contactDeadline, null);
      assert.equal(audio.diagnostics.continuousSources, 0);
      assert.equal(ctx.sources.length, count);
    }, TEXTURED_SETTINGS);
  }
});

test('pending autoplay does not occupy the first trusted desk release or lose its material cue', async () => {
  await withAudio(async (audio) => {
    let release;
    FakeContext.onCreate = (ctx) => { ctx.resumeGate = new Promise((resolve) => { release = resolve; }); };
    const autoplay = audio.tryAutoplay();
    const ctx = FakeContext.instances[0];
    const previousElement = globalThis.Element;
    class DeskElement {
      closest(selector) { return selector === '#desk-canvas' ? this : null; }
    }
    globalThis.Element = DeskElement;
    const listeners = new Map();
    const document = { hidden: false,
      addEventListener: (type, callback) => listeners.set(type, callback),
      removeEventListener: (type) => listeners.delete(type) };
    const startup = createSoundStartup(document, {
      enabled: () => audio.enabled, running: () => ctx.state === 'running', musicRequested: () => false,
      enable: () => audio.enable(), onSettled: () => {},
    });
    try {
      ctx.resumeGate = null;
      listeners.get('pointerup')({ type: 'pointerup', target: new DeskElement(), isTrusted: true });
      assert.equal(ctx.resumeCalls, 2);
      startup.afterActivation(() => audio.cue('paper'));
      await flushAudio();
      assert.equal(audio.diagnostics.activeCues, 1);
      release();
      await autoplay;
      assert.equal(audio.diagnostics.activeCues, 1, 'the older autoplay completion cannot repeat the cue');
    } finally {
      startup.dispose();
      assert.equal(listeners.size, 0);
      if (previousElement === undefined) delete globalThis.Element;
      else globalThis.Element = previousElement;
    }
  }, TEXTURED_SETTINGS);
});

test('media-only autoplay blocking leaves room audio running and retries through an ordinary trusted gesture', async () => {
  let player;
  let instance;
  await withAudio(async (audio, errors) => {
    instance = audio;
    let permitted = false;
    let plays = 0;
    const media = Object.assign(new EventTarget(), {
      currentTime: 0, paused: true,
      load() {},
      removeAttribute() {},
      pause() { this.paused = true; },
      play() {
        plays++;
        this.paused = !permitted;
        return permitted ? Promise.resolve() : Promise.reject(new DOMException('Media needs its own gesture', 'NotAllowedError'));
      },
    });
    player = new RecordedMusic([{ id: 'one', title: 'One', artist: 'Test', file: '/one.mp3', source: '', license: '' }], 'one', {
      connect: (element) => audio.connectRecording(element), createMedia: () => media,
      onChange: () => {}, onEnded: () => {}, onError: (error) => errors.push(error),
    });
    const previousElement = globalThis.Element;
    class RoomElement { closest() { return null; } }
    globalThis.Element = RoomElement;
    const listeners = new Map();
    const document = { hidden: false,
      addEventListener: (type, callback) => listeners.set(type, callback),
      removeEventListener: (type) => listeners.delete(type) };
    const startup = createSoundStartup(document, {
      enabled: () => audio.enabled, running: () => audio.diagnostics.contextState === 'running',
      musicRequested: () => player.state.requested, enable: () => audio.enable(), onSettled: () => {},
      onGesture: () => player.retryBlocked(),
    });
    try {
      player.play();
      assert.equal(await audio.tryAutoplay(), true);
      await flushAudio();
      assert.equal(audio.enabled, true);
      assert.equal(audio.diagnostics.browserBlocked, false);
      assert.equal(audio.diagnostics.weatherSources, 1);
      assert.equal(player.state.blocked, true);
      assert.equal(player.state.requested, true);
      assert.equal(plays, 1);
      permitted = true;
      listeners.get('click')({ type: 'click', isTrusted: true, target: new RoomElement() });
      assert.equal(plays, 2, 'retry must happen before the trusted handler returns');
      await flushAudio();
      assert.equal(player.state.playing, true);
      assert.equal(player.state.blocked, false);
      assert.equal(FakeContext.instances[0].resumeCalls, 1, 'media blocking must not restart the running AudioContext');
      assert.deepEqual(errors, []);
    } finally {
      startup.dispose();
      player.dispose();
      if (previousElement === undefined) delete globalThis.Element;
      else globalThis.Element = previousElement;
    }
  }, DEFAULT_SETTINGS, () => player?.setAvailable(Boolean(instance?.enabled && instance.diagnostics.contextState === 'running')));
});
