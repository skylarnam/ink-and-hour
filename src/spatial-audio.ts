export const SPATIAL_PAN_LIMIT = 0.35;

interface SpatialPoint { x: number; y: number; z: number }

export function clampSpatialPan(pan: number): number {
  return Number.isFinite(pan) ? Math.max(-SPATIAL_PAN_LIMIT, Math.min(SPATIAL_PAN_LIMIT, pan)) : 0;
}

export function cameraRelativePan(source: SpatialPoint, listener: SpatialPoint, right: SpatialPoint): number {
  const offset = { x: source.x - listener.x, y: source.y - listener.y, z: source.z - listener.z };
  const distance = Math.hypot(offset.x, offset.y, offset.z);
  const rightLength = Math.hypot(right.x, right.y, right.z);
  if (!Number.isFinite(distance) || !Number.isFinite(rightLength) || distance < 1e-6 || rightLength < 1e-6) return 0;
  const projection = (offset.x / distance) * (right.x / rightLength)
    + (offset.y / distance) * (right.y / rightLength)
    + (offset.z / distance) * (right.z / rightLength);
  return clampSpatialPan(projection * SPATIAL_PAN_LIMIT);
}
