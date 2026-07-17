import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { parseTiledSpatialCatalog } from '../../lib/tiledSpatialCatalog';
import { terrainOcclusionProbeDistance } from '../../lib/spatialVisibility';

const files = {
  'terrain/T00/colour.png': '/api/colour',
  'terrain/T00/elevation.cog.tif': '/api/elevation',
  'vectors/T00/features.glb': '/api/features',
};

const catalog = {
  schema_version: '1.1',
  bounds_l93_metres: [876_000, 6_403_000, 880_000, 6_407_000],
  spatial_contract: {
    grid_crs: 'EPSG:2154',
    horizontal_datum: 'RGF93',
    vertical_datum: 'NGF-IGN69',
    gltf_axes: 'local glTF (E, U, -N) metres',
    common_anchor_l93_metres: [878_000, 6_405_000],
    height_origin_ngf_ign69_m: 291,
    height_maximum_ngf_ign69_m: 1_850,
  },
  terrain_tiles: [{
    bounds_l93_metres: [876_000, 6_403_000, 880_000, 6_407_000],
    colour: { path: 'terrain/T00/colour.png' },
    elevation: { path: 'terrain/T00/elevation.cog.tif' },
  }],
  feature_tiles: [{
    tile_id: 'T00-V00',
    bounds_l93_metres: [876_000, 6_403_000, 877_000, 6_404_000],
    gltf_local_origin_l93_ngf_ign69: [876_000, 6_403_000, 291],
    features: { path: 'vectors/T00/features.glb' },
  }],
};

describe('parseTiledSpatialCatalog', () => {
  it('conserve les sources COG, orthophoto et GLB contrôlées par le manifeste', () => {
    const parsed = parseTiledSpatialCatalog(catalog, files);
    expect(parsed.terrain[0]).toEqual({
      bounds: [876_000, 6_403_000, 880_000, 6_407_000],
      colourPath: 'terrain/T00/colour.png',
      elevationPath: 'terrain/T00/elevation.cog.tif',
    });
    expect(parsed.features[0]?.path).toBe('vectors/T00/features.glb');
  });

  it('rejette une ressource qui ne passe pas par les URLs publiées', () => {
    expect(() => parseTiledSpatialCatalog(catalog, {
      ...files,
      'terrain/T00/elevation.cog.tif': '',
    })).toThrow('absent du package publié');
  });
});

describe('terrainOcclusionProbeDistance', () => {
  it('arrête le contrôle avant l’entrée dans la tuile pour ne pas auto-masquer son relief', () => {
    const camera = new Vector3(0, 0, 100);
    const target = new Vector3(100, 0, 0);
    const volume = new Box3(new Vector3(90, -10, -20), new Vector3(110, 10, 80));

    const probeDistance = terrainOcclusionProbeDistance(camera, target, volume);
    const tileEntryDistance = camera.distanceTo(new Vector3(90, 0, 10));

    expect(probeDistance).toBeCloseTo(tileEntryDistance - 2, 5);
    expect(probeDistance).toBeLessThan(camera.distanceTo(target));
  });

  it('conserve la distance complète lorsqu’aucun volume cible n’est traversé', () => {
    const camera = new Vector3(0, 0, 100);
    const target = new Vector3(100, 0, 0);
    const volume = new Box3(new Vector3(-110, -10, -20), new Vector3(-90, 10, 80));

    expect(terrainOcclusionProbeDistance(camera, target, volume)).toBeCloseTo(camera.distanceTo(target) - 2, 5);
  });

  it('ne masque jamais la tuile qui contient déjà la caméra', () => {
    const volume = new Box3(new Vector3(-10, -10, -20), new Vector3(110, 10, 120));
    expect(terrainOcclusionProbeDistance(new Vector3(0, 0, 100), new Vector3(100, 0, 0), volume)).toBe(0);
  });
});
