import { MOUSE, TOUCH, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type CameraDragMode = 'orbit' | 'pan';
export const CAMERA_PAN_RADIUS = 1.5;

export function createCameraControls(camera: PerspectiveCamera, element: HTMLElement | null): OrbitControls {
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.panSpeed = 0.65;
  // Pan along the desk, not vertically through its surface.
  controls.screenSpacePanning = false;
  controls.maxTargetRadius = CAMERA_PAN_RADIUS;
  controls.minDistance = 4;
  controls.maxDistance = 16;
  controls.minPolarAngle = 0.075;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minAzimuthAngle = -Math.PI * 0.48;
  controls.maxAzimuthAngle = Math.PI * 0.48;
  configureCameraDrag(controls, 'orbit');
  return controls;
}

export function configureCameraDrag(controls: OrbitControls, mode: CameraDragMode, modified = false): void {
  // OrbitControls swaps rotate/pan on modified drags; keep Shift-drag a pan in either mode.
  controls.mouseButtons.LEFT = mode === 'pan' && !modified ? MOUSE.PAN : MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = modified ? MOUSE.ROTATE : MOUSE.PAN;
  controls.touches.ONE = mode === 'pan' ? TOUCH.PAN : TOUCH.ROTATE;
  controls.touches.TWO = TOUCH.DOLLY_PAN;
}

export function panCameraWithKey(camera: PerspectiveCamera, controls: OrbitControls, key: string): boolean {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return false;
  camera.updateMatrix();
  const direction = new Vector3().setFromMatrixColumn(camera.matrix, 0);
  if (key === 'ArrowUp' || key === 'ArrowDown') direction.crossVectors(camera.up, direction);
  const sign = key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 1;
  direction.multiplyScalar(camera.position.distanceTo(controls.target) * 0.018 * sign);
  camera.position.add(direction);
  controls.target.add(direction);
  controls.update();
  return true;
}
