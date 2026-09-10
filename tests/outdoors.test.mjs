import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OutdoorView, forestLayout, terrainHeight, rainPositions, RAIN_COUNT } from '../src/outdoors.ts';

test('the forest has deterministic, irregular trees across three real depth layers', () => {
  const trees = forestLayout();
  assert.deepEqual(trees, forestLayout());
  assert.equal(trees.length, 62);
  assert.equal(new Set(trees.map((tree) => tree.z)).size, trees.length);
  assert.ok(Math.max(...trees.map((tree) => tree.z)) - Math.min(...trees.map((tree) => tree.z)) > 4.7);
  assert.ok(Math.max(...trees.map((tree) => tree.height)) - Math.min(...trees.map((tree) => tree.height)) > 0.6);
  for (const tree of trees) {
    assert.equal(tree.y, terrainHeight(tree.x, tree.z));
    assert.ok(tree.z < -6.6);
    assert.ok(tree.height > 0.8);
  }
});

test('actual terrain, branching trunks, and foliage remain outside the window with three draw batches', (t) => {
  const view = Object.assign(Object.create(OutdoorView.prototype), {
    root: new THREE.Group(),
    groundMaterial: new THREE.MeshStandardMaterial(),
    foliageMaterial: new THREE.MeshStandardMaterial(),
    barkMaterial: new THREE.MeshStandardMaterial(),
  });
  t.after(() => view.root.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  }));
  view.buildLandscape();
  assert.equal(view.root.children.length, 3);
  const instances = view.root.children.filter((object) => object instanceof THREE.InstancedMesh);
  assert.equal(instances.length, 2);
  assert.deepEqual(instances.map((object) => object.count), [62 * 5, 62 * 80]);
  const bounds = new THREE.Box3().setFromObject(view.root, true);
  assert.ok(bounds.max.z < -5.66, `landscape entered the window: ${bounds.max.z}`);
  assert.ok(bounds.max.z - bounds.min.z > 8);
  assert.ok(bounds.max.y - bounds.min.y > 2);
});

test('rain has independent depths, widths, lengths, and velocities rather than coplanar identical streaks', () => {
  const start = new Float32Array(RAIN_COUNT * 12);
  const next = new Float32Array(start.length);
  rainPositions(0, 'rain', start);
  rainPositions(0.01, 'rain', next);
  const depths = new Set();
  const widths = new Set();
  const lengths = new Set();
  const speeds = new Set();
  for (let i = 0; i < RAIN_COUNT; i++) {
    const offset = i * 12;
    depths.add(start[offset + 2].toFixed(3));
    widths.add((start[offset + 3] - start[offset]).toFixed(4));
    lengths.add((start[offset + 7] - start[offset + 1]).toFixed(3));
    speeds.add((next[offset + 1] - start[offset + 1]).toFixed(4));
  }
  assert.ok(depths.size > 350);
  assert.ok(widths.size > 80);
  assert.ok(lengths.size > 120);
  assert.ok(speeds.size > 200);
});

test('rain stays beyond the wall at every time and storm increases its fall speed', () => {
  const buffer = new Float32Array(RAIN_COUNT * 12);
  for (const weather of ['rain', 'storm']) {
    for (const elapsed of [0, 0.016, 18, 77.4, 3600]) {
      rainPositions(elapsed, weather, buffer);
      assert.ok(buffer.every(Number.isFinite));
      for (let i = 0; i < buffer.length; i += 3) {
        assert.ok(buffer[i + 2] <= -6.19);
        assert.ok(buffer[i + 1] >= -1 && buffer[i + 1] < 8.3);
      }
    }
  }
  const initial = new Float32Array(buffer.length);
  const rain = new Float32Array(buffer.length);
  const storm = new Float32Array(buffer.length);
  rainPositions(0, 'rain', initial);
  rainPositions(0.001, 'rain', rain);
  rainPositions(0.001, 'storm', storm);
  assert.ok(initial[1] - storm[1] > initial[1] - rain[1]);
  assert.throws(() => rainPositions(0, 'rain', new Float32Array(3)), RangeError);
});
