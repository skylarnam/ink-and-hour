import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordedMusic } from '../src/recorded-music.ts';

const tracks = ['first', 'second', 'third'].map((id) => ({
  id, title: id, artist: 'Test artist', file: `/audio/${id}.mp3`,
  source: 'https://example.com/music', license: 'https://creativecommons.org/publicdomain/zero/1.0/',
}));
const flush = () => new Promise((resolve) => setImmediate(resolve));

class Media extends EventTarget {
  listeners = new Map();
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  error = null;
  loads = 0;
  plays = 0;
  deferred = [];
  deferPlay = false;
  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  load() { this.loads++; this.currentTime = 0; this.error = null; this.ended = false; }
  play() {
    this.plays++;
    this.paused = false;
    return this.deferPlay
      ? new Promise((resolve, reject) => this.deferred.push({ resolve, reject }))
      : Promise.resolve();
  }
  pause() { this.paused = true; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}

function playerRig(t) {
  const media = new Media();
  const errors = [];
  let connections = 0;
  const player = new RecordedMusic(tracks, 'first', {
    connect: (element) => { assert.equal(element, media); connections++; },
    createMedia: () => media,
    onChange: () => {},
    onEnded: () => player.select(player.adjacent(1).id),
    onError: (error) => errors.push(error),
  });
  t.after(() => player.dispose());
  return { player, media, errors, connections: () => connections };
}

test('the playlist is lazy and stays silent until both play intent and the sound gate allow it', async (t) => {
  const { player, media, connections } = playerRig(t);
  assert.equal(media.src, '');
  assert.equal(media.plays, 0);
  player.setAvailable(true);
  assert.equal(media.plays, 0);
  player.setAvailable(false);
  player.play();
  assert.equal(media.plays, 0);
  player.setAvailable(true);
  await flush();
  assert.equal(player.state.playing, true);
  assert.equal(media.src, tracks[0].file);
  assert.equal(connections(), 1);
  assert.equal(media.preload, 'none');
});

test('queued default music can be paused before the first interaction without loading audio', async (t) => {
  const { player, media, connections } = playerRig(t);
  player.play();
  assert.equal(player.state.requested, true);
  assert.equal(player.state.playing, false);
  assert.equal(connections(), 0);
  assert.equal(media.loads, 0);
  player.pause();
  player.setAvailable(true);
  await flush();
  assert.equal(player.state.requested, false);
  assert.equal(media.plays, 0);
  assert.equal(connections(), 0);
});

test('previous and next wrap around, and changing a paused record does not start or load it', (t) => {
  const { player, media, connections } = playerRig(t);
  assert.equal(player.adjacent(-1).id, 'third');
  player.select('third');
  assert.equal(player.adjacent(1).id, 'first');
  player.select('second');
  assert.equal(media.loads, 0);
  assert.equal(connections(), 0);
  assert.throws(() => player.select('unknown'), /Unknown recording/);
});

test('pause and explicit sound availability gates preserve position and reuse the same media connection', async (t) => {
  const { player, media, connections } = playerRig(t);
  player.setAvailable(true);
  player.play();
  await flush();
  media.currentTime = 12.4;
  player.pause();
  assert.equal(media.paused, true);
  player.play();
  await flush();
  assert.equal(media.currentTime, 12.4);
  player.setAvailable(false);
  assert.equal(media.paused, true);
  assert.equal(player.state.requested, true);
  player.setAvailable(true);
  await flush();
  assert.equal(player.state.playing, true);
  assert.equal(media.currentTime, 12.4);
  assert.equal(connections(), 1);
  assert.equal(media.loads, 1);
});

test('a delayed play promise cannot revive a later pause or mute', async (t) => {
  const { player, media, errors } = playerRig(t);
  media.deferPlay = true;
  player.setAvailable(true);
  player.play();
  player.pause();
  media.paused = false;
  media.deferred.shift().resolve();
  await flush();
  assert.equal(media.paused, true);
  assert.equal(player.state.playing, false);
  player.play();
  player.setAvailable(false);
  media.deferred.shift().reject(new DOMException('The play request was interrupted.', 'AbortError'));
  await flush();
  assert.equal(player.state.requested, true);
  assert.equal(player.state.playing, false);
  assert.deepEqual(errors, []);
});

test('rapid skips invalidate old play results without pausing or failing the newest recording', async (t) => {
  const { player, media, errors, connections } = playerRig(t);
  media.deferPlay = true;
  player.setAvailable(true);
  player.play();
  player.select('second');
  player.select('third');
  media.deferred[2].resolve();
  await flush();
  media.deferred[0].resolve();
  media.deferred[1].reject(new DOMException('Replaced by another recording.', 'AbortError'));
  await flush();
  assert.equal(player.track.id, 'third');
  assert.equal(player.state.playing, true);
  assert.equal(media.paused, false);
  assert.equal(connections(), 1);
  assert.deepEqual(errors, []);
});

test('real playback failures are surfaced and a retry reloads the same recording', async (t) => {
  const { player, media, errors } = playerRig(t);
  media.deferPlay = true;
  player.setAvailable(true);
  player.play();
  media.deferred.shift().reject(new Error('The recording is unavailable.'));
  await flush();
  assert.equal(player.state.requested, false);
  assert.equal(player.state.loading, false);
  assert.match(errors[0], /recording is unavailable/);
  media.deferPlay = false;
  player.play();
  await flush();
  assert.equal(media.loads, 2);
  assert.equal(player.state.playing, true);
});

test('natural completion advances the playlist and disposal cancels all later events and pending play', async (t) => {
  const { player, media, errors } = playerRig(t);
  player.setAvailable(true);
  player.play();
  await flush();
  media.ended = true;
  media.dispatchEvent(new Event('ended'));
  await flush();
  assert.equal(player.track.id, 'second');
  media.deferPlay = true;
  player.select('third');
  player.dispose();
  media.paused = false;
  media.deferred.shift().resolve();
  await flush();
  assert.equal(media.paused, true);
  assert.equal(media.src, '');
  media.error = { message: 'Already disposed.', code: 1 };
  media.dispatchEvent(new Event('error'));
  assert.deepEqual(errors, []);
  assert.equal(player.state.playing, false);
  assert.ok([...media.listeners.values()].every((listeners) => listeners.size === 0));
});

test('automatic media NotAllowedError retains intent, clears its spinner and timeout, and reports honest blocking', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { player, media, errors } = playerRig(t);
  media.deferPlay = true;
  player.play();
  player.setAvailable(true);
  assert.equal(player.state.loading, true);
  media.deferred.shift().reject(new DOMException('A gesture is needed for this media element', 'NotAllowedError'));
  await flush();
  assert.equal(player.state.blocked, true);
  assert.equal(player.state.requested, true);
  assert.equal(player.state.playing, false);
  assert.equal(player.state.loading, false);
  assert.equal(player.state.error, null);
  assert.equal(player.loadTimer, null);
  assert.equal(media.paused, true);
  t.mock.timers.tick(25000);
  assert.equal(player.state.requested, true);
  assert.equal(media.plays, 1);
  assert.deepEqual(errors, []);
});

test('blocked media retries synchronously only on an eligible request, without reloading or resetting position', async (t) => {
  const { player, media, errors, connections } = playerRig(t);
  media.deferPlay = true;
  player.setAvailable(true);
  player.play();
  media.currentTime = 12.4;
  media.deferred.shift().reject(new DOMException('Blocked', 'NotAllowedError'));
  await flush();
  player.setAvailable(false);
  player.retryBlocked();
  assert.equal(media.plays, 1);
  player.setAvailable(true);
  assert.equal(media.plays, 1, 'availability changes alone must not retry browser-gated media');
  media.deferPlay = false;
  player.retryBlocked();
  assert.equal(media.plays, 2, 'play() must be invoked in the trusted calling turn');
  player.retryBlocked();
  await flush();
  assert.equal(media.plays, 2);
  assert.equal(player.state.blocked, false);
  assert.equal(player.state.playing, true);
  assert.equal(player.state.requested, true);
  assert.equal(media.currentTime, 12.4);
  assert.equal(media.loads, 1);
  assert.equal(connections(), 1);
  assert.deepEqual(errors, []);
});

test('explicit pause or Music Off cancels blocked intent and prevents later gesture retries', async (t) => {
  const { player, media } = playerRig(t);
  media.deferPlay = true;
  player.setAvailable(true);
  player.play();
  media.deferred.shift().reject(new DOMException('Blocked', 'NotAllowedError'));
  await flush();
  player.pause();
  assert.equal(player.state.blocked, false);
  assert.equal(player.state.requested, false);
  player.setAvailable(false);
  player.setAvailable(true);
  player.retryBlocked();
  assert.equal(media.plays, 1);
  player.select('second');
  player.retryBlocked();
  assert.equal(media.plays, 1);
});

test('stale media rejection cannot block a newer playing track, pause, or disposed player', async (t) => {
  const { player, media, errors } = playerRig(t);
  media.deferPlay = true;
  player.setAvailable(true);
  player.play();
  player.select('second');
  media.deferred[1].resolve();
  await flush();
  media.deferred[0].reject(new DOMException('Old track was blocked', 'NotAllowedError'));
  await flush();
  assert.equal(player.state.playing, true);
  assert.equal(player.state.blocked, false);
  player.select('third');
  player.pause();
  media.deferred[2].reject(new DOMException('Paused track was blocked', 'NotAllowedError'));
  await flush();
  assert.equal(player.state.blocked, false);
  assert.equal(player.state.requested, false);
  player.play();
  player.dispose();
  media.deferred[3].reject(new DOMException('Disposed track was blocked', 'NotAllowedError'));
  await flush();
  player.retryBlocked();
  assert.equal(player.state.blocked, false);
  assert.deepEqual(errors, []);
});

test('blocked media ignores stale playback and buffering events but still surfaces genuine media errors', async (t) => {
  const { player, media, errors } = playerRig(t);
  media.deferPlay = true;
  player.setAvailable(true);
  player.play();
  media.deferred.shift().reject(new DOMException('Blocked', 'NotAllowedError'));
  await flush();
  media.paused = false;
  media.dispatchEvent(new Event('playing'));
  media.dispatchEvent(new Event('waiting'));
  media.ended = true;
  media.dispatchEvent(new Event('ended'));
  assert.equal(media.paused, true);
  assert.equal(player.state.playing, false);
  assert.equal(player.state.loading, false);
  assert.equal(player.loadTimer, null);
  assert.equal(player.track.id, 'first');
  media.error = { message: 'Recording could not be decoded', code: 3 };
  media.dispatchEvent(new Event('error'));
  assert.equal(player.state.requested, false);
  assert.equal(player.state.blocked, false);
  assert.match(errors[0], /could not be decoded/);
});

test('an explicit Play action can retry a blocked recording without changing requested intent', async (t) => {
  const { player, media } = playerRig(t);
  media.play = () => { media.plays++; throw new DOMException('Blocked synchronously', 'NotAllowedError'); };
  player.setAvailable(true);
  player.play();
  assert.equal(player.state.blocked, true);
  assert.equal(player.state.loading, false);
  media.play = Media.prototype.play.bind(media);
  player.play();
  assert.equal(media.plays, 2);
  await flush();
  assert.equal(player.state.playing, true);
  assert.equal(player.state.blocked, false);
});
