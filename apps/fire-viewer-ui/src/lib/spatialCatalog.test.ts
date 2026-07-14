import { describe, expect, it } from 'vitest';
import catalogFixture from '../../public/maps/fireviewer-die-pontaix-r1-v4/catalog.json';
import {
  parseSpatialCatalog,
  PUBLIC_SPATIAL_COVERAGE_PATCHES,
  PUBLIC_SPATIAL_ZONE_BOUNDS,
  PUBLIC_SPATIAL_ZONE_ID,
  PUBLIC_SPATIAL_ZONE_REVISION_ID,
  SpatialCatalogError,
} from './spatialCatalog';

function cloneCatalog(): Record<string, unknown> {
  return structuredClone(catalogFixture) as Record<string, unknown>;
}

describe('parseSpatialCatalog', () => {
  it('accepte le catalogue complet de la zone publique unique sans dépendance externe', () => {
    const catalog = parseSpatialCatalog(catalogFixture);

    expect(catalog.schemaVersion).toBe('1.1');
    expect(catalog.zones).toEqual([{
      zoneId: PUBLIC_SPATIAL_ZONE_ID,
      revisionId: PUBLIC_SPATIAL_ZONE_REVISION_ID,
      bounds: PUBLIC_SPATIAL_ZONE_BOUNDS,
      coveragePatches: PUBLIC_SPATIAL_COVERAGE_PATCHES,
    }]);
    expect(catalog.terrainTiles).toHaveLength(8);
    expect(catalog.featureTiles).toHaveLength(128);
    expect(catalog.featureTiles.reduce((total, tile) => total + tile.features.routeCount, 0)).toBe(5202);
    expect(catalog.featureTiles.reduce((total, tile) => total + tile.features.treeCount, 0)).toBe(48323);
    expect(catalog.featureTiles.every((tile) => tile.features.path.startsWith('vectors/'))).toBe(true);
    expect(catalog.terrainTiles.every((tile) => tile.elevation.path.startsWith('terrain/'))).toBe(true);
    expect(catalog.terrainTiles.every((tile) => tile.zoneId === PUBLIC_SPATIAL_ZONE_ID)).toBe(true);
    expect(catalog.featureTiles.every((tile) => tile.zoneId === PUBLIC_SPATIAL_ZONE_ID)).toBe(true);
  });

  it('refuse un terrain en dehors des deux couvertures techniques disponibles', () => {
    const invalid = cloneCatalog();
    const terrainTiles = invalid.terrain_tiles as Array<Record<string, unknown>>;
    terrainTiles[0].bounds_l93_metres = [884_000, 6_403_000, 885_000, 6_404_000];

    expect(() => parseSpatialCatalog(invalid)).toThrow('couvertures techniques');
  });

  it('refuse une URL ou une remontée de répertoire à la place d’un asset local', () => {
    const invalid = cloneCatalog();
    const terrainTiles = invalid.terrain_tiles as Array<Record<string, unknown>>;
    const elevation = terrainTiles[0].elevation as Record<string, unknown>;
    elevation.path = '../external/elevation.cog.tif';

    expect(() => parseSpatialCatalog(invalid)).toThrow(SpatialCatalogError);
    expect(() => parseSpatialCatalog(invalid)).toThrow('terrain/');
  });

  it('refuse une tuile détaillée rattachée à un terrain absent', () => {
    const invalid = cloneCatalog();
    const featureTiles = invalid.feature_tiles as Array<Record<string, unknown>>;
    featureTiles[0].terrain_tile_id = 'UNKNOWN-TERRAIN';

    expect(() => parseSpatialCatalog(invalid)).toThrow('ne référence aucun terrain');
  });

  it('refuse un pont d’axes différent de celui appliqué par Giro3D', () => {
    const invalid = cloneCatalog();
    const spatialContract = invalid.spatial_contract as Record<string, unknown>;
    spatialContract.gltf_to_giro3d = 'identity';

    expect(() => parseSpatialCatalog(invalid)).toThrow('pont Giro3D/glTF/Unity canoniques');
  });

  it('refuse une origine GLB qui ne correspond plus à la tuile Lambert-93', () => {
    const invalid = cloneCatalog();
    const featureTiles = invalid.feature_tiles as Array<Record<string, unknown>>;
    featureTiles[0].gltf_local_origin_l93_ngf_ign69 = [0, 0, 0];

    expect(() => parseSpatialCatalog(invalid)).toThrow('origine GLB incompatible');
  });

  it('refuse un runtime qui déclare Cesium ou une autre livraison externe', () => {
    const invalid = cloneCatalog();
    const runtime = invalid.runtime as Record<string, unknown>;
    runtime.external_map_or_cesium = true;

    expect(() => parseSpatialCatalog(invalid)).toThrow('sans Cesium');
  });
});
