import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import {
  SPATIAL_PACKAGE_EXPECTATION,
  SpatialPackageVerificationError,
  validateSpatialCatalog,
  validateSpatialPackageManifest,
} from './spatial-package-verifier.mjs';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(currentDirectory, '../public/maps/fireviewer-die-pontaix-r1-v4/catalog.json');
const packageManifestPath = resolve(currentDirectory, '../public/maps/fireviewer-die-pontaix-r1-v4/package-manifest.json');
const catalogBuffer = await readFile(catalogPath);
const catalog = JSON.parse(catalogBuffer.toString('utf8'));
const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8'));

function cloneCatalog() {
  return structuredClone(catalog);
}

test('accepte le catalogue canonique et compte tous les assets publiés', () => {
  const result = validateSpatialCatalog(catalog);

  assert.deepEqual(result.counts, {
    zones: SPATIAL_PACKAGE_EXPECTATION.zoneCount,
    terrainTiles: SPATIAL_PACKAGE_EXPECTATION.terrainTileCount,
    featureTiles: SPATIAL_PACKAGE_EXPECTATION.featureTileCount,
    elevationAssets: SPATIAL_PACKAGE_EXPECTATION.elevationAssetCount,
    colourAssets: SPATIAL_PACKAGE_EXPECTATION.colourAssetCount,
    featureAssets: SPATIAL_PACKAGE_EXPECTATION.featureAssetCount,
    assets:
      SPATIAL_PACKAGE_EXPECTATION.elevationAssetCount +
      SPATIAL_PACKAGE_EXPECTATION.colourAssetCount +
      SPATIAL_PACKAGE_EXPECTATION.featureAssetCount,
  });
  assert.deepEqual(catalog.zones, [
    {
      zone_id: 'DIE-PONTAIX-08',
      revision_id: 'R1',
      bounds_l93_metres: [876000, 6403000, 892000, 6413000],
      coverage_patches_l93_metres: [
        [876000, 6403000, 884000, 6411000],
        [884000, 6405000, 892000, 6413000],
      ],
    },
  ]);
  assert.ok(catalog.terrain_tiles.every((tile) => tile.zone_id === 'DIE-PONTAIX-08'));
  assert.ok(catalog.feature_tiles.every((tile) => tile.zone_id === 'DIE-PONTAIX-08'));
});

test('refuse un terrain placé dans le rectangle global mais hors des deux couvertures techniques', () => {
  const invalid = cloneCatalog();
  invalid.terrain_tiles[0].bounds_l93_metres = [880000, 6411500, 881000, 6412500];

  assert.throws(
    () => validateSpatialCatalog(invalid),
    (error) => error instanceof SpatialPackageVerificationError && /emprise autorisée/.test(error.message),
  );
});

test('refuse un identifiant de zone historique dans une tuile', () => {
  const invalid = cloneCatalog();
  invalid.terrain_tiles[0].zone_id = 'DIE-08';

  assert.throws(
    () => validateSpatialCatalog(invalid),
    (error) => error instanceof SpatialPackageVerificationError && /zone absente/.test(error.message),
  );
});

test('refuse une provenance top-level divergente du manifeste IGN versionné', () => {
  const invalid = cloneCatalog();
  invalid.source_manifest_sha256 = '0'.repeat(64);

  assert.throws(
    () => validateSpatialCatalog(invalid),
    (error) => error instanceof SpatialPackageVerificationError && /source_manifest_sha256/.test(error.message),
  );
});

test('refuse une URL externe dans un asset référencé', () => {
  const invalid = cloneCatalog();
  invalid.terrain_tiles[0].elevation.path = 'https://example.test/elevation.cog.tif';

  assert.throws(
    () => validateSpatialCatalog(invalid),
    (error) => error instanceof SpatialPackageVerificationError && /same-origin/.test(error.message),
  );
});

test('refuse une origine GLB incompatible avec son repère L93/NGF-IGN69', () => {
  const invalid = cloneCatalog();
  invalid.feature_tiles[0].gltf_local_origin_l93_ngf_ign69[0] += 1;

  assert.throws(
    () => validateSpatialCatalog(invalid),
    (error) => error instanceof SpatialPackageVerificationError && /origine GLB/.test(error.message),
  );
});

test('scelle le manifeste de paquet sur le hash et le poids exacts du catalogue', () => {
  const catalogHash = createHash('sha256').update(catalogBuffer).digest('hex');
  assert.doesNotThrow(() => validateSpatialPackageManifest(packageManifest, catalogHash, catalogBuffer.byteLength, catalog));

  const invalid = structuredClone(packageManifest);
  invalid.catalog.sha256 = '0'.repeat(64);
  assert.throws(
    () => validateSpatialPackageManifest(invalid, catalogHash, catalogBuffer.byteLength, catalog),
    (error) => error instanceof SpatialPackageVerificationError && /ne correspond pas au catalogue/.test(error.message),
  );

  const divergentProvenance = structuredClone(packageManifest);
  divergentProvenance.provenance.source_manifest.sha256 = '0'.repeat(64);
  assert.throws(
    () => validateSpatialPackageManifest(divergentProvenance, catalogHash, catalogBuffer.byteLength, catalog),
    (error) => error instanceof SpatialPackageVerificationError && /manifeste IGN versionné/.test(error.message),
  );
});
