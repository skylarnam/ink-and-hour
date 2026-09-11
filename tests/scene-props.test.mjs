import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeskScene } from '../src/scene.ts';

function propRig(t) {
  const rig = Object.assign(Object.create(DeskScene.prototype), {
    scene: new THREE.Scene(), roll: new THREE.Group(),
    rollOpenGroup: new THREE.Group(), rollClosedGroup: new THREE.Group(),
    ...Object.fromEntries(['tableMaterial', 'leatherMaterial', 'brassMaterial', 'steelMaterial',
      'penMaterial', 'bookMaterial', 'ceramicMaterial', 'leafMaterial', 'pageEdgeMaterial'].map((key) => [key, new THREE.MeshStandardMaterial()])),
  });
  rig.buildRoll();
  rig.buildProps();
  t.after(() => {
    const materials = new Set();
    rig.scene.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) materials.add(object.material);
    });
    for (const material of materials) material.dispose();
  });
  return rig;
}

test('the coffee cup and saucer clear the case throughout opening and closing', (t) => {
  const rig = propRig(t);
  const cup = rig.scene.getObjectByName('coffee-cup');
  assert.ok(cup);
  const cupBounds = new THREE.Box3().setFromObject(cup, true);
  for (const amount of [0, 0.025, 0.25, 0.5, 0.75, 0.975, 1]) {
    rig.rollOpenGroup.scale.x = Math.max(0.01, amount);
    rig.rollClosedGroup.scale.setScalar(Math.max(0.01, 1 - amount));
    const rollBounds = new THREE.Box3().setFromObject(rig.roll, true);
    assert.equal(cupBounds.intersectsBox(rollBounds), false, `collision at opening ${amount}`);
    assert.ok(cupBounds.max.z + 0.5 < rollBounds.min.z, `insufficient space at opening ${amount}`);
  }
});

test('the relocated cup also clears the books, paper, and desk edges', (t) => {
  const rig = propRig(t);
  const cup = new THREE.Box3().setFromObject(rig.scene.getObjectByName('coffee-cup'), true);
  const books = new THREE.Box3().setFromObject(rig.scene.getObjectByName('desk-books'), true);
  assert.equal(cup.intersectsBox(books), false);
  assert.ok(books.max.x + 0.25 < cup.min.x);
  assert.ok(cup.max.z + 0.25 < -(3.8 * 1040 / 780) / 2, 'the cup should not touch the paper');
  assert.ok(cup.min.x > -6.8 && cup.max.x < 6.8);
  assert.ok(cup.min.z > -5.3 && cup.max.z < 4.7);
});

test('the handle has open ends attached to the cup wall instead of a separate circular ring', (t) => {
  const rig = propRig(t);
  const cup = rig.scene.getObjectByName('coffee-cup');
  const handle = cup.getObjectByName('cup-handle');
  assert.ok(handle.geometry instanceof THREE.TubeGeometry);
  assert.equal(handle.geometry.parameters.closed, false);
  const top = handle.geometry.parameters.path.getPoint(0);
  const bottom = handle.geometry.parameters.path.getPoint(1);
  assert.ok(Math.abs(top.x + 0.386) < 0.015 && top.y > 0.55);
  assert.ok(Math.abs(bottom.x + 0.323) < 0.015 && bottom.y < 0.23);
  assert.equal(cup.children.filter((object) => object.name === 'handle-attachment').length, 2);
  const midpoint = handle.geometry.parameters.path.getPoint(0.5);
  assert.ok(midpoint.x < -0.73);
});

test('the books turn counterclockwise away from the roll alignment', (t) => {
  const rig = propRig(t);
  const books = rig.scene.getObjectByName('desk-books');
  assert.ok(books.rotation.y > 0.15 && books.rotation.y < 0.35);
  assert.ok(books.rotation.y - rig.roll.rotation.y > 0.3);
});
