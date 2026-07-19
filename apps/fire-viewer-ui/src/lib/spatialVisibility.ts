import { Box3, Ray, Vector3 } from 'three';

export function terrainOcclusionProbeDistance(camera: Vector3, target: Vector3, volume: Box3, tolerance = 2): number {
  if (volume.containsPoint(camera)) return 0;
  const direction = target.clone().sub(camera);
  const distance = direction.length();
  if (distance <= tolerance) return 0;
  const entry = new Ray(camera, direction.normalize()).intersectBox(volume, new Vector3());
  return Math.max(0, (entry ? camera.distanceTo(entry) : distance) - tolerance);
}
