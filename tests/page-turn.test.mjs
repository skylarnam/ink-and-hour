import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pageTurnPose } from '../src/page-turn.ts';
import { DeskScene, writingPenOrientation } from '../src/scene.ts';

test('a sheet slides gently out, swaps only while invisible, and arrives at its original pose', () => {
  const rest = { lift: 0, slide: 0, rotation: 0, opacity: 1 };
  assert.deepEqual(pageTurnPose(null), rest);
  assert.deepEqual(pageTurnPose(0), rest);
  assert.equal(pageTurnPose(0.5).opacity, 0);
  const end = pageTurnPose(1);
  for (const key of Object.keys(rest)) assert.ok(Math.abs(end[key] - rest[key]) < 1e-10);
  for (let index = 0; index <= 1000; index++) {
    const pose = pageTurnPose(index / 1000);
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(pose.opacity >= 0 && pose.opacity <= 1);
    assert.ok(pose.lift >= -1e-10 && pose.lift <= 0.05);
    assert.ok(Math.abs(pose.slide) <= 0.6 && Math.abs(pose.rotation) <= 0.035);
    assert.deepEqual(pageTurnPose(index / 1000, true), rest);
  }
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => pageTurnPose(bad), RangeError);
    assert.throws(() => pageTurnPose(bad, true), RangeError);
  }
});

function rig(t) {
  const material = new THREE.MeshStandardMaterial();
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8 * 1040 / 780), material);
  const scene = Object.assign(Object.create(DeskScene.prototype), {
    pageSurface: paper, paperMaterial: material, reducedMotion: false,
    pageTurnProgress: null, pagePenStart: null,
    pen: new THREE.Group(), nib: new THREE.Group(), cap: new THREE.Group(),
    penOrientation: writingPenOrientation(), settings: { nib: 'flex' },
    capped: false, capAmount: 0, followNib: false, movingCamera: false, penReturn: null,
  });
  t.after(() => { material.dispose(); paper.geometry.dispose(); });
  return scene;
}

test('the real paper mesh restores opacity/depth behavior after both animated and reduced-motion turns', (t) => {
  const scene = rig(t);
  for (const reduced of [false, true]) {
    scene.reducedMotion = reduced;
    scene.setPageTurn(0.25);
    assert.equal(scene.paperMaterial.transparent, !reduced);
    assert.equal(scene.paperMaterial.depthWrite, reduced);
    assert.ok(scene.paperMaterial.opacity >= 0 && scene.paperMaterial.opacity <= 1);
    scene.setPageTurn(null);
    assert.equal(scene.paperMaterial.transparent, false);
    assert.equal(scene.paperMaterial.depthWrite, true);
    assert.equal(scene.paperMaterial.opacity, 1);
    assert.deepEqual(scene.pageSurface.position.toArray(), [0, 0.064, 0]);
    assert.equal(scene.pageSurface.rotation.z, 0);
  }
});

test('the pen lifts and travels continuously through the swap rather than jumping to the next page', (t) => {
  const scene = rig(t);
  const outgoing = { x: 640, y: 890, status: 'writing', contact: false, pressure: 0, lift: 0.7, speed: 0, angle: 0, progress: 1 };
  const incoming = { ...outgoing, x: 90, y: 110, progress: 0 };
  let previous;
  for (let index = 0; index <= 1000; index++) {
    const progress = index / 1000;
    scene.setPageTurn(progress);
    scene.updatePen(progress < 0.5 ? outgoing : incoming, 1 / 60);
    assert.ok(scene.pen.position.y >= 0.064 + 0.018 - 1e-10);
    if (previous) assert.ok(scene.pen.position.distanceTo(previous) < 0.03, 'discontinuous pen travel');
    previous = scene.pen.position.clone();
  }
  assert.ok(Math.abs(scene.pen.position.x - (incoming.x / 780 - 0.5) * 3.8) < 1e-10);
  scene.setPageTurn(null);
  assert.equal(scene.pagePenStart, null);
});
