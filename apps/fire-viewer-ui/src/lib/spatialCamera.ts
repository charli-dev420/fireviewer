import { boundsCenter, type BoundsL93 } from './spatialCatalog';

export interface SpatialCameraLayout {
  target: readonly [number, number, number];
  position: readonly [number, number, number];
  spanMetres: number;
  overviewSpanMetres: number;
  maxDistanceMetres: number;
}

/**
 * The overview camera is derived from the published zone bounds.  In
 * particular, no fixed maximum span is applied: the complete public zone is
 * visible before its detailed GLB tiles become eligible for loading.
 */
export function createSpatialOverviewCamera(
  bounds: BoundsL93,
  heightOriginNgfIgn69Metres: number,
  cameraAspect: number,
): SpatialCameraLayout {
  const [easting, northing] = boundsCenter(bounds);
  const spanMetres = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  // On a portrait viewport, the narrow horizontal FOV is the limiting axis.
  // Expand the oblique overview before first render instead of cropping the
  // public zone or using a second, lower-quality distant representation.
  const usableAspect = Number.isFinite(cameraAspect) && cameraAspect > 0
    ? Math.max(cameraAspect, 0.25)
    : 1;
  const overviewSpanMetres = spanMetres * Math.max(1, 1 / usableAspect);
  const target: SpatialCameraLayout['target'] = [
    easting,
    northing,
    heightOriginNgfIgn69Metres + overviewSpanMetres * 0.06,
  ];
  const position: SpatialCameraLayout['position'] = [
    easting + overviewSpanMetres * 1.4,
    northing - overviewSpanMetres * 1.55,
    heightOriginNgfIgn69Metres + overviewSpanMetres * 2,
  ];
  const cameraDistanceMetres = Math.hypot(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2],
  );

  return {
    target,
    position,
    spanMetres,
    overviewSpanMetres,
    // The control range grows with the actual zone. This retains the complete
    // Die–Pontaix overview instead of reducing it to a fixed local window.
    maxDistanceMetres: cameraDistanceMetres * 1.5,
  };
}
