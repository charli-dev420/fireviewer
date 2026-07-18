import { Box3, Ray, Vector3 } from 'three';

export const NEAR_DETAIL_DISTANCE_MULTIPLIER = 1.3;

export function tileIsWithinNearDetailDistance(
  focusEast: number,
  focusNorth: number,
  bounds: readonly [number, number, number, number],
  publishDistance: number,
): boolean {
  const eastDistance = focusEast < bounds[0] ? bounds[0] - focusEast : focusEast > bounds[2] ? focusEast - bounds[2] : 0;
  const northDistance = focusNorth < bounds[1] ? bounds[1] - focusNorth : focusNorth > bounds[3] ? focusNorth - bounds[3] : 0;
  return Math.hypot(eastDistance, northDistance) <= publishDistance * NEAR_DETAIL_DISTANCE_MULTIPLIER;
}

export function terrainOcclusionProbeDistance(camera: Vector3, target: Vector3, volume: Box3, tolerance = 2): number {
  if (volume.containsPoint(camera)) return 0;
  const direction = target.clone().sub(camera);
  const distance = direction.length();
  if (distance <= tolerance) return 0;
  const entry = new Ray(camera, direction.normalize()).intersectBox(volume, new Vector3());
  return Math.max(0, (entry ? camera.distanceTo(entry) : distance) - tolerance);
}
