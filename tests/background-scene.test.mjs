import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeskScene } from '../src/scene.ts';

test('background simulation keeps weather and delayed thunder alive without rendering WebGL frames', () => {
  const calls = { render: 0, outdoors: 0, thunder: 0, controls: 0 };
  const rig = Object.assign(Object.create(DeskScene.prototype), {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    renderer: { render: () => calls.render++ },
    controls: { update: () => calls.controls++ },
    outdoors: { update: () => calls.outdoors++ },
    settings: { weather: 'storm' }, reducedMotion: false, movingCamera: false,
    rollAmount: 0, rollOpen: false, capAmount: 0, capped: true,
    rollOpenGroup: new THREE.Group(), rollClosedGroup: new THREE.Group(),
    nextLightning: 0, lightningRemaining: 0, thunderAt: null,
    flashLight: { intensity: 0 }, dust: new THREE.Group(),
    onThunder: () => calls.thunder++,
  });
  rig.update(1 / 30, 1, false);
  assert.ok(rig.thunderAt > 1);
  rig.update(1 / 30, rig.thunderAt, false);
  assert.equal(calls.thunder, 1);
  assert.equal(calls.outdoors, 2);
  assert.equal(calls.controls, 2);
  assert.equal(calls.render, 0);
  rig.update(1 / 60, 5);
  assert.equal(calls.render, 1, 'foreground rendering remains the default');
  rig.settings.weather = 'clear';
  rig.thunderAt = 6;
  rig.update(1 / 30, 6, false);
  assert.equal(calls.thunder, 1, 'clear weather must not emit a pending thunder cue');
  assert.equal(calls.render, 1);
});
