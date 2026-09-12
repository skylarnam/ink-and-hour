import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackClock, BACKGROUND_FRAME_MS, BACKGROUND_STALL_MS } from '../src/playback-clock.ts';

function setup(t, background = false) {
  const document = new EventTarget();
  document.hidden = background;
  let time = 0;
  let id = 0;
  const frames = new Map();
  const timers = new Map();
  const calls = [];
  const errors = [];
  const clock = createPlaybackClock({
    document, now: () => time,
    requestFrame: (callback) => { frames.set(++id, callback); return id; },
    cancelFrame: (key) => frames.delete(key),
    setTimer: (callback, delay) => { timers.set(++id, { callback, delay }); return id; },
    clearTimer: (key) => timers.delete(key),
    onFrame: (timestamp, state) => calls.push({ timestamp, ...state }),
    onError: (error) => errors.push(error),
  });
  t.after(() => clock.dispose());
  const step = (delta) => {
    time += delta;
    const entry = frames.entries().next().value;
    if (entry) { frames.delete(entry[0]); entry[1](time); }
    else {
      const timer = timers.entries().next().value;
      if (timer) { timers.delete(timer[0]); timer[1].callback(); }
    }
  };
  const visibility = (hidden, elapsed = 0) => {
    time += elapsed;
    document.hidden = hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  return { clock, document, frames, timers, calls, errors, step, visibility };
}

test('visible playback uses one animation frame, not a background timer', (t) => {
  const { clock, frames, timers, calls, step } = setup(t);
  clock.start();
  clock.start();
  assert.equal(frames.size, 1);
  assert.equal(timers.size, 0);
  step(16);
  assert.deepEqual(calls, [{ timestamp: 16, background: false, stalled: false }]);
  assert.equal(frames.size, 1);
});

test('changing tabs switches clocks immediately without pausing playback or duplicating callbacks', (t) => {
  const { clock, frames, timers, calls, step, visibility } = setup(t);
  clock.start();
  step(16);
  visibility(true, 4);
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, BACKGROUND_FRAME_MS);
  assert.deepEqual(calls.at(-1), { timestamp: 20, background: true, stalled: false });
  for (let frame = 0; frame < 20; frame++) step(BACKGROUND_FRAME_MS);
  assert.equal(calls.length, 22);
  assert.ok(calls.every((call) => !call.stalled));
  visibility(false, 4);
  assert.equal(frames.size, 1);
  assert.equal(timers.size, 0);
  assert.equal(calls.at(-1).background, false);
});

test('a background-opened page starts on a bounded timer', (t) => {
  const { clock, frames, timers, calls, step } = setup(t, true);
  clock.start();
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 1);
  step(BACKGROUND_FRAME_MS);
  assert.equal(calls[0].background, true);
  assert.equal(calls[0].stalled, false);
});

test('real background throttling is reported, including a frozen tab returning to the foreground', (t) => {
  const { clock, calls, step, visibility } = setup(t);
  clock.start();
  step(16);
  step(1000);
  assert.equal(calls.at(-1).stalled, false, 'ordinary foreground delay is not background suspension');
  visibility(true);
  step(BACKGROUND_STALL_MS + 1);
  assert.equal(calls.at(-1).stalled, true);
  step(BACKGROUND_FRAME_MS);
  assert.equal(calls.at(-1).stalled, false);
  visibility(false, 5000);
  assert.equal(calls.at(-1).stalled, true);
  assert.equal(calls.at(-1).background, false);
});

test('rapid focus changes still leave exactly one callback and disposal stops all clocks', (t) => {
  const { clock, frames, timers, calls, visibility, step } = setup(t);
  clock.start();
  for (let index = 0; index < 30; index++) {
    visibility(index % 2 === 0, 1);
    assert.equal(frames.size + timers.size, 1);
  }
  clock.dispose();
  const count = calls.length;
  visibility(true, 1);
  step(10000);
  clock.start();
  assert.equal(calls.length, count);
  assert.equal(frames.size + timers.size, 0);
  assert.equal(clock.running, false);
});

test('frame failures stop the clock and are surfaced once rather than retried in a loop', () => {
  let callback;
  const failure = new Error('frame failure');
  const errors = [];
  const document = new EventTarget();
  document.hidden = false;
  const clock = createPlaybackClock({
    document, requestFrame: (next) => { callback = next; return 1; }, cancelFrame() {},
    onFrame: () => { throw failure; }, onError: (error) => errors.push(error),
  });
  clock.start();
  callback(16);
  assert.equal(clock.running, false);
  assert.deepEqual(errors, [failure]);
  document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(errors, [failure]);
  clock.dispose();
});
