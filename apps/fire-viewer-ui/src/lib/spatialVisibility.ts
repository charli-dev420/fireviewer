import { Box3, Ray, Vector3 } from 'three';

export function tileIsWithinDetailDistance(
  cameraEast: number,
  cameraNorth: number,
  bounds: readonly [number, number, number, number],
  maximumDistance: number,
): boolean {
  const eastDistance = cameraEast < bounds[0] ? bounds[0] - cameraEast : cameraEast > bounds[2] ? cameraEast - bounds[2] : 0;
  const northDistance = cameraNorth < bounds[1] ? bounds[1] - cameraNorth : cameraNorth > bounds[3] ? cameraNorth - bounds[3] : 0;
  return Math.hypot(eastDistance, northDistance) <= maximumDistance;
}

export function terrainOcclusionProbeDistance(camera: Vector3, target: Vector3, volume: Box3, tolerance = 2): number {
  if (volume.containsPoint(camera)) return 0;
  const direction = target.clone().sub(camera);
  const distance = direction.length();
  if (distance <= tolerance) return 0;
  const entry = new Ray(camera, direction.normalize()).intersectBox(volume, new Vector3());
  return Math.max(0, (entry ? camera.distanceTo(entry) : distance) - tolerance);
}
