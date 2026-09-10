import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeskScene } from '../src/scene.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';

const sample = { x: 200, y: 160, contact: false, lift: 0, pressure: 0.7, speed: 0, angle: 0.4, status: 'idle', progress: 0 };

function penRig(t, nib = 'flex') {
  // Exercise the real geometry and pose methods without creating a WebGL renderer.
  const scene = Object.assign(Object.create(DeskScene.prototype), {
    settings: { ...DEFAULT_SETTINGS, pen: 'fountain', nib },
    pen: new THREE.Group(), nib: new THREE.Group(), cap: new THREE.Group(),
    penMaterial: new THREE.MeshStandardMaterial(), brassMaterial: new THREE.MeshStandardMaterial(),
    steelMaterial: new THREE.MeshStandardMaterial(), tableMaterial: new THREE.MeshStandardMaterial(),
    penOrientation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.51, 0.86, 0.31).normalize()),
    capped: true, capAmount: 1, reducedMotion: true, followNib: false,
  });
  scene.buildPen();
  t.after(() => {
    const materials = new Set([scene.penMaterial, scene.brassMaterial, scene.steelMaterial, scene.tableMaterial]);
    for (const root of [scene.pen, scene.cap]) root.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) materials.add(child.material);
    });
    for (const material of materials) material.dispose();
  });
  return scene;
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}

test('the capped mouth faces the barrel and every nib profile sits fully inside the cap', (t) => {
  for (const nib of ['fine', 'broad', 'flex']) {
    const scene = penRig(t, nib);
    for (const status of ['idle', 'paused', 'complete']) {
      scene.updatePen({ ...sample, status });
      scene.pen.updateMatrixWorld(true);
      scene.cap.updateMatrixWorld(true);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(scene.pen.quaternion);
      const capAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(scene.cap.quaternion);
      close(axis.dot(capAxis), -1);
      const tip = scene.cap.worldToLocal(scene.pen.getWorldPosition(new THREE.Vector3()));
      close(tip.x, 0);
      close(tip.y, 0.87);
      close(tip.z, 0);
      scene.nib.traverse((child) => {
        if (!child.geometry) return;
        const positions = child.geometry.getAttribute('position');
        for (let index = 0; index < positions.count; index++) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
          scene.cap.worldToLocal(point);
          assert.ok(point.y > 0.02 && point.y < 0.951, `${nib}: nib protrudes past a cap end`);
          assert.ok(Math.hypot(point.x, point.z) < 0.112, `${nib}: nib crosses the inner cap wall`);
        }
      });
    }
  }
});

test('the removed cap is genuinely hollow at the mouth and closed at its rounded crown', (t) => {
  const scene = penRig(t);
  scene.setCapped(false);
  scene.updatePen(sample);
  scene.cap.updateMatrixWorld(true);
  const origin = scene.cap.localToWorld(new THREE.Vector3(0.01, 0.15, 0.005));
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(scene.cap.quaternion);
  const ray = new THREE.Raycaster(origin, axis);
  const crown = ray.intersectObject(scene.cap, true);
  assert.ok(crown.length > 0, 'the cap needs a closed crown');
  const crownLocal = scene.cap.worldToLocal(crown[0].point.clone());
  assert.ok(crownLocal.y > 0.93 && crownLocal.y < 0.974);
  ray.set(origin, axis.negate());
  assert.equal(ray.intersectObject(scene.cap, true).length, 0, 'the mouth must not have a solid cylinder end');
  assert.ok(scene.cap.position.distanceTo(scene.pen.position) > 0.5);
});

test('capping a paused or finished pen keeps the crown above the paper and writing still meets the ink point', (t) => {
  const scene = penRig(t);
  for (const status of ['paused', 'complete']) {
    scene.updatePen({ ...sample, status });
    assert.ok(new THREE.Box3().setFromObject(scene.cap, true).min.y >= 0.064);
  }
  scene.setCapped(false);
  scene.updatePen({ ...sample, status: 'writing', contact: true });
  close(scene.pen.position.x, (sample.x / 780 - 0.5) * 3.8);
  close(scene.pen.position.z, (sample.y / 1040 - 0.5) * (3.8 * 1040 / 780));
  close(scene.pen.position.y, 0.068);
});

test('the metal mouth lip sits ahead of the shell rather than sharing a flickering end face', (t) => {
  const scene = penRig(t);
  scene.setCapped(false);
  scene.updatePen(sample);
  scene.cap.updateMatrixWorld(true);
  const origin = scene.cap.localToWorld(new THREE.Vector3(0.145, 0, 0));
  const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(scene.cap.quaternion);
  const hits = new THREE.Raycaster(origin, direction).intersectObject(scene.cap, true);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].object.material, scene.brassMaterial);
  close(scene.cap.worldToLocal(hits[0].point.clone()).y, 0.018);
});
