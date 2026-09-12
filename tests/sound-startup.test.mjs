import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoundStartup, soundPresentation } from '../src/sound-startup.ts';

class FakeElement {
  constructor(id = '') { this.id = id; }
  closest(selector) { return selector.split(',').some((part) => part.trim() === `#${this.id}`) ? this : null; }
}

function setup(t, overrides = {}) {
  const previous = globalThis.Element;
  globalThis.Element = FakeElement;
  const listeners = new Map();
  const document = {
    hidden: false,
    addEventListener(type, handler, options) {
      assert.equal(options.capture, true);
      listeners.set(type, handler);
    },
    removeEventListener(type) { listeners.delete(type); },
    send(type, event = {}) {
      listeners.get(type)?.({ type, isTrusted: true, target: new FakeElement(), ...event });
    },
  };
  const state = { enabled: true, running: false, requested: true, starts: 0, settled: 0 };
  const startup = createSoundStartup(document, {
    enabled: () => state.enabled,
    running: () => state.running,
    musicRequested: () => state.requested,
    enable: async () => { state.starts++; state.running = true; return true; },
    onSettled: () => { state.settled++; },
    ...overrides,
  });
  t.after(() => {
    startup.dispose();
    if (previous === undefined) delete globalThis.Element;
    else globalThis.Element = previous;
  });
  return { document, state, dispose: startup.dispose, afterActivation: startup.afterActivation, listeners };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('ready, running and muted are distinct; ready never falsely claims sound is on', () => {
  assert.equal(soundPresentation(true, false).label, 'Sound ready');
  assert.match(soundPresentation(true, false).note, /first click, tap, or keypress/);
  assert.match(soundPresentation(true, false).action, /muted before it starts/);
  assert.equal(soundPresentation(true, true).label, 'Sound is on');
  assert.equal(soundPresentation(false, true).label, 'Enable sound');
  assert.equal(soundPresentation(false, false).state, 'muted');
});

test('a normal trusted Room click starts audio without visiting the Sound tab', async (t) => {
  const { document, state } = setup(t);
  document.send('pointerdown', { target: new FakeElement('tab-room'), pointerType: 'touch' });
  assert.equal(state.starts, 0, 'do not strand touch activation on an ineligible pointerdown');
  document.send('click', { target: new FakeElement('tab-room'), pointerType: 'touch' });
  await settle();
  assert.equal(state.starts, 1);
  assert.equal(state.settled, 1);
  document.send('click', { target: new FakeElement('tab-sound') });
  assert.equal(state.starts, 1);
});

test('scripted clicks and modifier keys do not start audio, but a real typing key does', async (t) => {
  const { document, state } = setup(t);
  document.send('click', { isTrusted: false });
  for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'Escape']) document.send('keydown', { key });
  assert.equal(state.starts, 0);
  document.send('keydown', { key: 'a', target: new FakeElement('message') });
  await settle();
  assert.equal(state.starts, 1);
});

test('the first desk pointer release unlocks before its material cue, without starting on unrelated pointer releases', async (t) => {
  let finish;
  let starts = 0;
  let cues = 0;
  const { document, state, afterActivation } = setup(t, {
    enable: () => { starts++; return new Promise((resolve) => { finish = resolve; }); },
  });
  document.send('pointerup', { target: new FakeElement('message') });
  afterActivation(() => cues++);
  assert.equal(starts, 0);
  assert.equal(cues, 0, 'an unactivated page cannot create a material sound');
  document.send('pointerup', { target: new FakeElement('desk-canvas'), pointerType: 'touch' });
  afterActivation(() => cues++);
  assert.equal(starts, 1);
  assert.equal(cues, 0, 'the material cue must wait for the actual context to be ready');
  document.send('click', { target: new FakeElement('desk-canvas') });
  assert.equal(starts, 1);
  state.running = true;
  finish(true);
  await settle();
  assert.equal(cues, 1);
  afterActivation(() => cues++);
  assert.equal(cues, 2, 'later material interactions play immediately');
});

test('a material cue waiting for startup cannot outlive a mute, hidden page, or disposal', async (t) => {
  for (const action of ['mute', 'hide', 'dispose']) {
    await t.test(action, async (t) => {
      let finish;
      let cues = 0;
      const { document, state, afterActivation, dispose } = setup(t, {
        enable: () => new Promise((resolve) => { finish = resolve; }),
      });
      document.send('pointerup', { target: new FakeElement('desk-canvas') });
      afterActivation(() => cues++);
      if (action === 'mute') state.enabled = false;
      else if (action === 'hide') document.hidden = true;
      else dispose();
      state.running = true;
      finish(true);
      await settle();
      assert.equal(cues, 0);
    });
  }
});

test('mute-before-start and music-pause gestures do not accidentally unlock the default sound', (t) => {
  const { document, state } = setup(t);
  for (const id of ['enable-sound', 'panel-enable-sound', 'quiet-sound', 'music-play']) {
    document.send('click', { target: new FakeElement(id) });
    document.send('keydown', { key: ' ', target: new FakeElement(id) });
  }
  assert.equal(state.starts, 0);
  state.enabled = false;
  document.send('click');
  assert.equal(state.starts, 0);
});

test('hidden pages, in-flight starts and disposed listeners cannot duplicate an activation', async (t) => {
  let finish;
  let starts = 0;
  const { document, state, dispose, listeners } = setup(t, {
    enable: () => { starts++; return new Promise((resolve) => { finish = resolve; }); },
  });
  document.hidden = true;
  document.send('click');
  assert.equal(starts, 0);
  document.hidden = false;
  document.send('click');
  document.send('keydown', { key: 'a' });
  assert.equal(starts, 1);
  dispose();
  finish(true);
  await settle();
  assert.equal(state.settled, 0);
  assert.equal(listeners.size, 0);
});

test('a failed start settles its status and permits an explicit retry', async (t) => {
  let starts = 0;
  const { document, state } = setup(t, { enable: async () => { starts++; return false; } });
  document.send('click');
  await settle();
  document.send('click');
  await settle();
  assert.equal(starts, 2);
  assert.equal(state.settled, 2);
});
