import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraRelativePan, clampSpatialPan, SPATIAL_PAN_LIMIT } from '../src/spatial-audio.ts';

const origin = { x: 0, y: 0, z: 0 };
const right = { x: 1, y: 0, z: 0 };

test('camera-relative pan uses listener position and real right axes with gentle headphone bounds', () => {
  assert.equal(SPATIAL_PAN_LIMIT, 0.35);
  assert.equal(cameraRelativePan({ x: 2, y: 0, z: 0 }, origin, right), 0.35);
  assert.equal(cameraRelativePan({ x: -2, y: 0, z: 0 }, origin, right), -0.35);
  assert.equal(cameraRelativePan({ x: 0, y: 0, z: -4 }, origin, right), 0);
  assert.equal(cameraRelativePan({ x: 12, y: 3, z: 4 }, { x: 10, y: 3, z: 4 }, right), 0.35);
  assert.equal(cameraRelativePan({ x: 2, y: 0, z: 0 }, origin, { x: -1, y: 0, z: 0 }), -0.35);
  assert.equal(cameraRelativePan({ x: 0, y: 0, z: 2 }, origin, { x: 0, y: 0, z: 1 }), 0.35);
  assert.equal(cameraRelativePan({ x: 0, y: 3, z: 0 }, origin, { x: 0, y: -1, z: 0 }), -0.35);
});

test('source distance and non-unit camera axes do not change pan or introduce attenuation', () => {
  const source = { x: 1, y: 1, z: -2 };
  const expected = 0.35 / Math.sqrt(6);
  assert.ok(Math.abs(cameraRelativePan(source, origin, right) - expected) < 1e-12);
  assert.ok(Math.abs(cameraRelativePan({ x: 20, y: 20, z: -40 }, origin, { x: 7, y: 0, z: 0 }) - expected) < 1e-12);
  assert.ok(Math.abs(cameraRelativePan({ x: -1, y: 1, z: -2 }, origin, right) + expected) < 1e-12);
});

test('invalid or coincident geometry safely centers without nonfinite pan values', () => {
  assert.equal(cameraRelativePan(origin, origin, right), 0);
  assert.equal(cameraRelativePan({ x: 1e-10, y: 0, z: 0 }, origin, right), 0);
  assert.equal(cameraRelativePan(right, origin, origin), 0);
  assert.equal(cameraRelativePan({ x: Number.MAX_VALUE, y: 0, z: 0 }, { x: -Number.MAX_VALUE, y: 0, z: 0 }, right), 0);
  for (const value of [NaN, Infinity, -Infinity, undefined]) {
    for (const key of ['x', 'y', 'z']) {
      assert.equal(cameraRelativePan({ ...right, [key]: value }, origin, right), 0);
      assert.equal(cameraRelativePan(right, { ...origin, [key]: value }, right), 0);
      assert.equal(cameraRelativePan(right, origin, { ...right, [key]: value }), 0);
    }
  }
});

test('direct placements are finite and bounded, and continuous camera movement changes side smoothly', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined]) assert.equal(clampSpatialPan(value), 0);
  assert.equal(clampSpatialPan(2), 0.35);
  assert.equal(clampSpatialPan(-2), -0.35);
  assert.equal(clampSpatialPan(0.12), 0.12);
  let previous = null;
  for (let x = -20; x <= 20; x += 0.02) {
    const pan = cameraRelativePan({ x, y: 0, z: -5 }, origin, right);
    assert.ok(Number.isFinite(pan) && Math.abs(pan) <= 0.35);
    if (previous !== null) {
      assert.ok(pan >= previous);
      assert.ok(pan - previous < 0.002);
    }
    previous = pan;
  }
});
