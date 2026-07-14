import { describe, expect, it } from 'vitest';
import {
  PUBLIC_SPATIAL_ZONE_BOUNDS,
  PUBLIC_SPATIAL_ZONE_ID,
} from './spatialCatalog';
import { createSpatialOverviewCamera } from './spatialCamera';

describe('createSpatialOverviewCamera', () => {
  it('conserve la vue complète de la zone publique sans plafond local sur bureau et mobile', () => {
    const desktopCamera = createSpatialOverviewCamera(PUBLIC_SPATIAL_ZONE_BOUNDS, 420, 16 / 9);
    const mobileCamera = createSpatialOverviewCamera(PUBLIC_SPATIAL_ZONE_BOUNDS, 420, 9 / 16);

    expect(PUBLIC_SPATIAL_ZONE_ID).toBe('DIE-PONTAIX-08');
    expect(desktopCamera.spanMetres).toBe(16_000);
    expect(desktopCamera.overviewSpanMetres).toBe(16_000);
    expect(desktopCamera.target).toEqual([884_000, 6_408_000, 1_380]);
    expect(desktopCamera.position).toEqual([906_400, 6_383_200, 32_420]);
    expect(desktopCamera.maxDistanceMetres).toBeGreaterThan(60_000);
    expect(mobileCamera.spanMetres).toBe(16_000);
    expect(mobileCamera.overviewSpanMetres).toBeCloseTo(28_444.444, 3);
    expect(mobileCamera.maxDistanceMetres).toBeGreaterThan(desktopCamera.maxDistanceMetres);
  });
});
