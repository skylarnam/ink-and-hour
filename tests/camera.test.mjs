import test from 'node:test';
import assert from 'node:assert/strict';
import { MOUSE, TOUCH, PerspectiveCamera, Vector3 } from 'three';
import {
  CAMERA_PAN_RADIUS, configureCameraDrag, createCameraControls, panCameraWithKey,
} from '../src/camera-controls.ts';

function cameraRig(target = new Vector3(-0.15, 0.65, -0.45), offset = new Vector3(4.25, 8.55, 9.85)) {
  const camera = new PerspectiveCamera(39, 1.5, 0.05, 80);
  camera.position.copy(target).add(offset);
  const controls = createCameraControls(camera, null);
  controls.target.copy(target);
  controls.cursor.copy(target);
  controls.update();
  return { camera, controls };
}

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('orbit remains the default while mouse and touch panning are enabled and bounded', () => {
  const { controls } = cameraRig();
  assert.equal(controls.enablePan, true);
  assert.equal(controls.screenSpacePanning, false);
  assert.equal(controls.maxTargetRadius, CAMERA_PAN_RADIUS);
  assert.equal(controls.mouseButtons.LEFT, MOUSE.ROTATE);
  assert.equal(controls.mouseButtons.RIGHT, MOUSE.PAN);
  assert.equal(controls.touches.ONE, TOUCH.ROTATE);
  assert.equal(controls.touches.TWO, TOUCH.DOLLY_PAN);
  assert.equal(controls.minDistance, 4);
  assert.equal(controls.maxDistance, 16);
});

test('Move switches a plain drag to pan and can return to orbit without changing the view', () => {
  const { camera, controls } = cameraRig();
  const position = camera.position.clone();
  const target = controls.target.clone();
  configureCameraDrag(controls, 'pan');
  assert.equal(controls.mouseButtons.LEFT, MOUSE.PAN);
  assert.equal(controls.touches.ONE, TOUCH.PAN);
  configureCameraDrag(controls, 'orbit');
  assert.equal(controls.mouseButtons.LEFT, MOUSE.ROTATE);
  assert.equal(controls.touches.ONE, TOUCH.ROTATE);
  assert.ok(camera.position.equals(position));
  assert.ok(controls.target.equals(target));
});

test('modified drags use the OrbitControls pan branch in either drag mode', () => {
  const { controls } = cameraRig();
  for (const mode of ['orbit', 'pan']) {
    configureCameraDrag(controls, mode, true);
    assert.equal(controls.mouseButtons.LEFT, MOUSE.ROTATE);
    assert.equal(controls.mouseButtons.RIGHT, MOUSE.ROTATE);
    configureCameraDrag(controls, mode, false);
    assert.equal(controls.mouseButtons.RIGHT, MOUSE.PAN);
  }
});

test('keyboard panning translates the camera and target together without rotating or zooming', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    const { camera, controls } = cameraRig();
    const beforeCamera = camera.position.clone();
    const beforeTarget = controls.target.clone();
    const direction = camera.getWorldDirection(new Vector3());
    const distance = camera.position.distanceTo(controls.target);
    assert.equal(panCameraWithKey(camera, controls, key), true);
    const movedCamera = camera.position.clone().sub(beforeCamera);
    const movedTarget = controls.target.clone().sub(beforeTarget);
    assert.ok(movedTarget.length() > 0);
    close(movedCamera.distanceTo(movedTarget), 0);
    close(controls.target.y, beforeTarget.y);
    close(camera.position.distanceTo(controls.target), distance);
    close(camera.getWorldDirection(new Vector3()).distanceTo(direction), 0);
  }
});

test('repeated panning stays within the preset radius and can move back from its edge', () => {
  const { camera, controls } = cameraRig();
  const height = camera.position.y;
  for (let i = 0; i < 400; i++) {
    panCameraWithKey(camera, controls, 'ArrowRight');
    assert.ok(controls.target.distanceTo(controls.cursor) <= CAMERA_PAN_RADIUS + 1e-8);
    close(camera.position.y, height);
  }
  close(controls.target.distanceTo(controls.cursor), CAMERA_PAN_RADIUS);
  panCameraWithKey(camera, controls, 'ArrowLeft');
  assert.ok(controls.target.distanceTo(controls.cursor) < CAMERA_PAN_RADIUS);
});

test('overhead and nib-height panning remain on their desk plane at the closest zoom', () => {
  for (const target of [new Vector3(0, 0, 0), new Vector3(-1.3, 0.4, -1.8)]) {
    const { camera, controls } = cameraRig(target, new Vector3(0, 4, 0.31));
    for (let i = 0; i < 200; i++) {
      panCameraWithKey(camera, controls, 'ArrowDown');
      close(controls.target.y, target.y);
      assert.ok(camera.position.y > 0);
      assert.ok(controls.target.distanceTo(controls.cursor) <= CAMERA_PAN_RADIUS + 1e-8);
    }
  }
});

test('non-pan keys do not alter the camera or its target', () => {
  const { camera, controls } = cameraRig();
  const position = camera.position.clone();
  const target = controls.target.clone();
  for (const key of ['+', '-', 'Home', 'a']) assert.equal(panCameraWithKey(camera, controls, key), false);
  assert.ok(camera.position.equals(position));
  assert.ok(controls.target.equals(target));
});
