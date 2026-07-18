import { Box3, Ray, Vector3 } from 'three';

export const NEAR_DETAIL_DISTANCE_MULTIPLIER = 1.3;

export function tileIsWithinNearDetailDistance(
  camera: Vector3,
  volume: Box3,
  publishDistance: number,
): boolean {
  return volume.distanceToPoint(camera) <= publishDistance * NEAR_DETAIL_DISTANCE_MULTIPLIER;
}

export function terrainOcclusionProbeDistance(camera: Vector3, target: Vector3, volume: Box3, tolerance = 2): number {
  if (volume.containsPoint(camera)) return 0;
  const direction = target.clone().sub(camera);
  const distance = direction.length();
  if (distance <= tolerance) return 0;
  const entry = new Ray(camera, direction.normalize()).intersectBox(volume, new Vector3());
  return Math.max(0, (entry ? camera.distanceTo(entry) : distance) - tolerance);
}
