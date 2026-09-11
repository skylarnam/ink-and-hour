import test from 'node:test';
import assert from 'node:assert/strict';
import { frictionParameters, weatherGain, RitualAudio } from '../src/audio.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';

test('friction is silent on every pen-up or stationary frame', () => {
  for (const speed of [0, 10, 100, 400]) {
    assert.equal(frictionParameters({ contact: false, speed, pressure: 1 }, DEFAULT_SETTINGS).gain, 0);
  }
  assert.equal(frictionParameters({ contact: true, speed: 0, pressure: 1 }, DEFAULT_SETTINGS).gain, 0);
});

test('speed, paper, pressure, nib and holder affect friction, with a bounded ceiling', () => {
  const sample = { contact: true, speed: 110, pressure: 0.6 };
  const normal = frictionParameters(sample, DEFAULT_SETTINGS);
  for (const change of [{ paper: 'cotton' }, { nib: 'broad' }, { pen: 'dip' }]) {
    assert.notEqual(frictionParameters(sample, { ...DEFAULT_SETTINGS, ...change }).gain, normal.gain);
  }
  assert.ok(frictionParameters({ ...sample, speed: 30 }, DEFAULT_SETTINGS).gain < normal.gain);
  assert.ok(frictionParameters({ ...sample, pressure: 0.1 }, DEFAULT_SETTINGS).gain < normal.gain);
  for (const speed of [NaN, Infinity, -1, 1e6]) {
    const params = frictionParameters({ ...sample, speed }, { ...DEFAULT_SETTINGS, paper: 'cotton', nib: 'broad' });
    assert.ok(Number.isFinite(params.gain) && params.gain >= 0 && params.gain <= 0.32);
  }
});

test('the original friction filter profile is restored without pitched-grain playback', () => {
  const sample = { contact: true, speed: 100, pressure: 0.6 };
  const parameters = frictionParameters(sample, DEFAULT_SETTINGS);
  assert.equal(parameters.frequency, 1100 + 0.5 * 1500 + 0.22 * 1600);
  assert.equal(parameters.lowpass, 3200 + 0.22 * 3100 + 0.5 * 700);
  assert.equal('playbackRate' in parameters, false);
});

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
      assert.equal(ctx.gains[5].gain.value, previousGain * 0.75);
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
  connect(destination) { return destination; }
  disconnect() { this.connected = false; }
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

class FakeContext {
  static instances = [];
  state = 'suspended';
  currentTime = 1;
  sampleRate = 8000;
  destination = new FakeNode();
  gains = [];
  sources = [];
  mediaSources = [];
  resumeGate = null;
  failResume = false;
  constructor() { FakeContext.instances.push(this); }
  createGain() {
    const gain = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(gain);
    return gain;
  }
  createBiquadFilter() { return Object.assign(new FakeNode(), { frequency: new FakeParam(), Q: new FakeParam() }); }
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
    if (this.resumeGate) await this.resumeGate;
    if (this.failResume) throw new Error('Audio device unavailable');
    if (this.state !== 'closed') this.state = 'running';
  }
  async suspend() { if (this.state !== 'closed') this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
  advance(seconds) {
    this.currentTime += seconds;
    for (const source of this.sources) {
      if (source.stopTime <= this.currentTime) { source.onended?.(); source.onended = null; }
    }
  }
}

async function withAudio(run) {
  const priorWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeContext };
  FakeContext.instances.length = 0;
  const errors = [];
  const audio = new RitualAudio((message) => errors.push(message));
  try {
    await run(audio, errors);
  } finally {
    audio.dispose();
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

test('pen lift reaches scheduled exact zero without repeated frames postponing silence', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    audio.updateContact({ contact: true, speed: 132, pressure: 0.8 });
    assert.ok(audio.diagnostics.writingGain > 0);
    const ctx = FakeContext.instances[0];
    const friction = ctx.gains[4].gain;
    audio.updateContact({ contact: false, speed: 0, pressure: 0 });
    assert.equal(audio.diagnostics.writingGain, 0);
    const events = friction.events.length;
    for (let i = 0; i < 60; i++) audio.updateContact({ contact: false, speed: 0, pressure: 0 });
    assert.equal(friction.events.length, events);
    const zero = friction.events.at(-1);
    assert.equal(zero[0], 'set');
    assert.equal(zero[1], 0);
    assert.ok(zero[2] - ctx.currentTime <= 0.025);
  });
});

test('pen-only idle has no looping sources and lifts stop the actual contact source', async () => {
  await withAudio(async (audio) => {
    audio.configure({ ...DEFAULT_SETTINGS, masterVolume: 0.41, writingVolume: 1, ambienceVolume: 0, musicVolume: 0 });
    await audio.enable();
    const ctx = FakeContext.instances[0];
    assert.equal(audio.diagnostics.continuousSources, 0);
    assert.equal(audio.diagnostics.contactSources, 0);
    assert.equal(audio.diagnostics.weatherSources, 0);
    audio.updateContact({ contact: true, speed: 140, pressure: 0.7 });
    assert.equal(audio.diagnostics.contactSources, 1);
    const source = audio.contactVoice.source;
    assert.equal(source.buffer, audio.noise);
    assert.equal(source.playbackRate.value, 1);
    assert.equal(source.buffer.duration, 9);
    let seed = 91721;
    let pink = 0;
    const original = new Float32Array(128);
    for (let i = 0; i < original.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = seed / 2147483648 - 1;
      pink = pink * 0.96 + white * 0.04;
      original[i] = white * 0.68 + pink * 2.6;
    }
    assert.deepEqual(source.buffer.getChannelData(0).slice(0, 128), original);
    for (let i = 0; i < 12; i++) audio.updateContact({ contact: true, speed: 140 + i, pressure: 0.7 });
    assert.equal(audio.contactVoice.source, source);
    audio.updateContact({ contact: false, speed: 0, pressure: 0 });
    assert.equal(audio.diagnostics.contactSources, 0);
    assert.ok(source.stopTime - ctx.currentTime <= 0.013);
    ctx.advance(0.02);
    assert.equal(audio.diagnostics.continuousSources, 0);
    assert.equal(source.connected, false);
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
      const source = audio.contactVoice.source;
      audio.updateContact(sample);
      assert.equal(audio.diagnostics.contact, false);
      assert.equal(audio.diagnostics.writingGain, 0);
      assert.ok(source.stopTime - ctx.currentTime <= 0.013);
      ctx.advance(0.02);
      assert.equal(source.connected, false);
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
      assert.equal(audio.diagnostics.contactSources, 1);
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
    assert.equal(audio.diagnostics.contactSources, 1, 'lifecycle silence must not disable later writing');
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

test('live holder changes reshape the original friction without pitch changes or source restarts', async () => {
  await withAudio(async (audio) => {
    await audio.enable();
    const ctx = FakeContext.instances[0];
    const sample = { contact: true, speed: 150, pressure: 0.65 };
    audio.updateContact(sample);
    const source = audio.contactVoice.source;
    const gain = audio.diagnostics.writingGain;
    audio.configure({ ...DEFAULT_SETTINGS, pen: 'dip' });
    audio.updateContact(sample);
    assert.equal(audio.contactVoice.source, source);
    assert.equal(source.playbackRate.value, 1);
    assert.notEqual(audio.diagnostics.writingGain, gain);
    assert.equal(audio.diagnostics.contactSources, 1);
    for (let i = 0; i < 50; i++) {
      audio.configure({ ...DEFAULT_SETTINGS, ambienceVolume: i % 2 ? 0 : 0.48, pen: i % 2 ? 'dip' : 'fountain' });
      audio.updateContact({ ...sample, contact: i % 3 !== 0 });
      assert.ok(audio.diagnostics.continuousSources <= 4);
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
