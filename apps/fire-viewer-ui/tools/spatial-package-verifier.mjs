import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const SPATIAL_PACKAGE_EXPECTATION = Object.freeze({
  schemaVersion: '1.1',
  zoneCount: 1,
  terrainTileCount: 8,
  featureTileCount: 128,
  elevationAssetCount: 8,
  colourAssetCount: 8,
  featureAssetCount: 128,
});

const SPATIAL_CONTRACT = Object.freeze({
  gridCrs: 'EPSG:2154',
  horizontalDatum: 'RGF93',
  verticalDatum: 'NGF-IGN69',
  giro3dAxes: 'EPSG:2154 (E, N, U) metres',
  gltfAxes: 'local glTF (E, U, -N) metres',
  gltfToGiro3d: 'rotate local GLB +90 degrees around X, then place at its L93/NGF origin',
  unityBridge: 'Unity (100E, 100U, 100N) = glTF (E, U, -N) * (100, 100, -100)',
});

const SOURCE_MANIFEST = Object.freeze({
  identifier: 'ign_sources.v1',
  path: 'contracts/spatial/releases/ign_sources.v1.json',
  sha256: 'cff6e9ffa71ce38397defe490bf54f6ba361cc9e5ed8621f22719e5e86d20fe5',
  byteCount: 265766,
});

const PUBLIC_ZONE = Object.freeze({
  id: 'DIE-PONTAIX-08',
  revision: 'R1',
  bounds: [876000, 6403000, 892000, 6413000],
  coveragePatches: [
    [876000, 6403000, 884000, 6411000],
    [884000, 6405000, 892000, 6413000],
  ],
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const EPSILON = 1e-7;

export class SpatialPackageVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpatialPackageVerificationError';
  }
}

function fail(message) {
  throw new SpatialPackageVerificationError(message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} doit être un objet.`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} doit être un tableau.`);
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} doit être une chaîne non vide.`);
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} doit être un nombre fini.`);
  return value;
}

function integer(value, label, minimum = 0) {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < minimum) fail(`${label} doit être un entier supérieur ou égal à ${minimum}.`);
  return number;
}

function requiredString(source, key, expected, label) {
  if (source[key] !== expected) fail(`${label}.${key} doit être ${JSON.stringify(expected)}.`);
}

function sha256(value, label) {
  const hash = string(value, label).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(`${label} doit être une empreinte SHA-256 hexadécimale.`);
  return hash;
}

function bounds(value, label) {
  const coordinates = array(value, label);
  if (coordinates.length !== 4) fail(`${label} doit avoir exactement quatre coordonnées.`);
  const result = coordinates.map((coordinate, index) => finiteNumber(coordinate, `${label}[${index}]`));
  if (result[0] >= result[2] || result[1] >= result[3]) fail(`${label} doit être une emprise strictement croissante.`);
  return result;
}

function pair(value, label) {
  const coordinates = array(value, label);
  if (coordinates.length !== 2) fail(`${label} doit avoir exactement deux coordonnées.`);
  return coordinates.map((coordinate, index) => finiteNumber(coordinate, `${label}[${index}]`));
}

function origin(value, label) {
  const coordinates = array(value, label);
  if (coordinates.length !== 3) fail(`${label} doit avoir exactement trois coordonnées.`);
  return coordinates.map((coordinate, index) => finiteNumber(coordinate, `${label}[${index}]`));
}

function contains(container, item) {
  return (
    item[0] >= container[0] - EPSILON &&
    item[1] >= container[1] - EPSILON &&
    item[2] <= container[2] + EPSILON &&
    item[3] <= container[3] + EPSILON
  );
}

function sameBounds(left, right) {
  return left.every((coordinate, index) => Math.abs(coordinate - right[index]) <= EPSILON);
}

function verifySourceManifestReference(value, label) {
  const sourceManifest = object(value, label);
  requiredString(sourceManifest, 'identifier', SOURCE_MANIFEST.identifier, label);
  requiredString(sourceManifest, 'path', SOURCE_MANIFEST.path, label);
  if (sha256(sourceManifest.sha256, `${label}.sha256`) !== SOURCE_MANIFEST.sha256) {
    fail(`${label}.sha256 ne correspond pas au manifeste IGN versionné.`);
  }
  if (integer(sourceManifest.byte_count, `${label}.byte_count`, 1) !== SOURCE_MANIFEST.byteCount) {
    fail(`${label}.byte_count ne correspond pas au manifeste IGN versionné.`);
  }
  return SOURCE_MANIFEST;
}

function localAssetPath(value, label, prefix, extension) {
  const assetPath = string(value, label);
  const segments = assetPath.split('/');
  if (
    assetPath.startsWith('/') ||
    assetPath.startsWith('\\') ||
    assetPath.includes('\\') ||
    assetPath.includes('?') ||
    assetPath.includes('#') ||
    /^[a-z][a-z0-9+.-]*:/i.test(assetPath) ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    !assetPath.startsWith(prefix) ||
    !assetPath.endsWith(extension)
  ) {
    fail(`${label} doit être un chemin relatif same-origin ${prefix}…${extension}.`);
  }
  return assetPath;
}

function asset(value, label, prefix, extension) {
  const source = object(value, label);
  return {
    path: localAssetPath(source.path, `${label}.path`, prefix, extension),
    sha256: sha256(source.sha256, `${label}.sha256`),
    byteCount: integer(source.byte_count, `${label}.byte_count`, 1),
  };
}

function verifySpatialContract(value) {
  const contract = object(value, 'spatial_contract');
  requiredString(contract, 'grid_crs', SPATIAL_CONTRACT.gridCrs, 'spatial_contract');
  requiredString(contract, 'horizontal_datum', SPATIAL_CONTRACT.horizontalDatum, 'spatial_contract');
  requiredString(contract, 'vertical_datum', SPATIAL_CONTRACT.verticalDatum, 'spatial_contract');
  requiredString(contract, 'giro3d_axes', SPATIAL_CONTRACT.giro3dAxes, 'spatial_contract');
  requiredString(contract, 'gltf_axes', SPATIAL_CONTRACT.gltfAxes, 'spatial_contract');
  requiredString(contract, 'gltf_to_giro3d', SPATIAL_CONTRACT.gltfToGiro3d, 'spatial_contract');
  requiredString(contract, 'unity_bridge', SPATIAL_CONTRACT.unityBridge, 'spatial_contract');
  pair(contract.common_anchor_l93_metres, 'spatial_contract.common_anchor_l93_metres');
  const heightOrigin = finiteNumber(contract.height_origin_ngf_ign69_m, 'spatial_contract.height_origin_ngf_ign69_m');
  const heightMaximum = finiteNumber(contract.height_maximum_ngf_ign69_m, 'spatial_contract.height_maximum_ngf_ign69_m');
  if (heightMaximum <= heightOrigin) fail('spatial_contract doit avoir une plage d’altitude NGF-IGN69 croissante.');
  return { heightOrigin, heightMaximum };
}

function verifyRuntime(value) {
  const runtime = object(value, 'runtime');
  requiredString(runtime, 'delivery', 'same-origin static files only', 'runtime');
  requiredString(runtime, 'renderer', 'Giro3D', 'runtime');
  if (runtime.external_map_or_cesium !== false) fail('runtime.external_map_or_cesium doit être false.');
}

function verifyExpectedCounts(zones, terrainTiles, featureTiles) {
  const expected = SPATIAL_PACKAGE_EXPECTATION;
  if (zones.length !== expected.zoneCount) fail(`Le paquet doit contenir ${expected.zoneCount} zones.`);
  if (terrainTiles.length !== expected.terrainTileCount) fail(`Le paquet doit contenir ${expected.terrainTileCount} tuiles de terrain.`);
  if (featureTiles.length !== expected.featureTileCount) fail(`Le paquet doit contenir ${expected.featureTileCount} tuiles GLB.`);
}

export function validateSpatialCatalog(value) {
  const catalog = object(value, 'catalogue');
  if (catalog.schema_version !== SPATIAL_PACKAGE_EXPECTATION.schemaVersion) {
    fail(`schema_version doit être ${SPATIAL_PACKAGE_EXPECTATION.schemaVersion}.`);
  }
  const catalogBounds = bounds(catalog.bounds_l93_metres, 'bounds_l93_metres');
  const spatial = verifySpatialContract(catalog.spatial_contract);
  verifyRuntime(catalog.runtime);

  const provenance = object(catalog.provenance, 'provenance');
  verifySourceManifestReference(provenance.source_manifest, 'provenance.source_manifest');
  if (sha256(catalog.source_manifest_sha256, 'source_manifest_sha256') !== SOURCE_MANIFEST.sha256) {
    fail('source_manifest_sha256 ne correspond pas au manifeste IGN versionné.');
  }

  const zones = array(catalog.zones, 'zones').map((value, index) => {
    const zone = object(value, `zones[${index}]`);
    const zoneId = string(zone.zone_id, `zones[${index}].zone_id`);
    const revisionId = string(zone.revision_id, `zones[${index}].revision_id`);
    const zoneBounds = bounds(zone.bounds_l93_metres, `zones[${index}].bounds_l93_metres`);
    if (!contains(catalogBounds, zoneBounds)) fail(`zones[${index}] sort de bounds_l93_metres.`);
    const coveragePatches = array(zone.coverage_patches_l93_metres, `zones[${index}].coverage_patches_l93_metres`).map(
      (patch, patchIndex) => {
        const patchBounds = bounds(patch, `zones[${index}].coverage_patches_l93_metres[${patchIndex}]`);
        if (!contains(zoneBounds, patchBounds)) {
          fail(`zones[${index}].coverage_patches_l93_metres[${patchIndex}] sort de la zone.`);
        }
        return patchBounds;
      },
    );
    if (zoneId !== PUBLIC_ZONE.id || revisionId !== PUBLIC_ZONE.revision || !sameBounds(zoneBounds, PUBLIC_ZONE.bounds)) {
      fail(`La zone publique doit être ${PUBLIC_ZONE.id}@${PUBLIC_ZONE.revision} avec son emprise G1 figée.`);
    }
    if (coveragePatches.length !== PUBLIC_ZONE.coveragePatches.length || coveragePatches.some((patch, patchIndex) => !sameBounds(patch, PUBLIC_ZONE.coveragePatches[patchIndex]))) {
      fail('La zone publique doit conserver ses deux emprises de couverture techniques G1.');
    }
    return { zoneId, revisionId, bounds: zoneBounds, coveragePatches };
  });
  const zoneById = new Map();
  for (const zone of zones) {
    if (zoneById.has(zone.zoneId)) fail(`zone_id dupliqué : ${zone.zoneId}.`);
    zoneById.set(zone.zoneId, zone);
  }

  const terrainTiles = array(catalog.terrain_tiles, 'terrain_tiles').map((value, index) => {
    const tile = object(value, `terrain_tiles[${index}]`);
    const terrainTileId = string(tile.terrain_tile_id, `terrain_tiles[${index}].terrain_tile_id`);
    const zoneId = string(tile.zone_id, `terrain_tiles[${index}].zone_id`);
    const tileBounds = bounds(tile.bounds_l93_metres, `terrain_tiles[${index}].bounds_l93_metres`);
    const zone = zoneById.get(zoneId);
    if (!zone) fail(`terrain_tiles[${index}] référence une zone absente : ${zoneId}.`);
    if (
      !contains(zone.bounds, tileBounds)
      || !zone.coveragePatches.some((coveragePatch) => contains(coveragePatch, tileBounds))
      || !contains(catalogBounds, tileBounds)
    ) {
      fail(`terrain_tiles[${index}] sort de son emprise autorisée.`);
    }
    if (finiteNumber(tile.sample_spacing_metres, `terrain_tiles[${index}].sample_spacing_metres`) !== 0.9765625) {
      fail(`terrain_tiles[${index}].sample_spacing_metres doit être 0.9765625.`);
    }
    if (integer(tile.height_sample_count, `terrain_tiles[${index}].height_sample_count`, 2) !== 4097) {
      fail(`terrain_tiles[${index}].height_sample_count doit être 4097.`);
    }
    return {
      terrainTileId,
      zoneId,
      bounds: tileBounds,
      elevation: asset(tile.elevation, `terrain_tiles[${index}].elevation`, 'terrain/', '.cog.tif'),
      colour: asset(tile.colour, `terrain_tiles[${index}].colour`, 'terrain/', '.png'),
    };
  });
  const terrainById = new Map();
  for (const terrain of terrainTiles) {
    if (terrainById.has(terrain.terrainTileId)) fail(`terrain_tile_id dupliqué : ${terrain.terrainTileId}.`);
    terrainById.set(terrain.terrainTileId, terrain);
  }

  const featureTiles = array(catalog.feature_tiles, 'feature_tiles').map((value, index) => {
    const tile = object(value, `feature_tiles[${index}]`);
    const tileId = string(tile.tile_id, `feature_tiles[${index}].tile_id`);
    const terrainTileId = string(tile.terrain_tile_id, `feature_tiles[${index}].terrain_tile_id`);
    const terrain = terrainById.get(terrainTileId);
    if (!terrain) fail(`feature_tiles[${index}] référence un terrain absent : ${terrainTileId}.`);
    if (string(tile.zone_id, `feature_tiles[${index}].zone_id`) !== terrain.zoneId) {
      fail(`feature_tiles[${index}] ne partage pas la zone de son terrain.`);
    }
    const tileBounds = bounds(tile.bounds_l93_metres, `feature_tiles[${index}].bounds_l93_metres`);
    if (!contains(terrain.bounds, tileBounds)) fail(`feature_tiles[${index}] sort de son terrain.`);
    const localOrigin = origin(tile.gltf_local_origin_l93_ngf_ign69, `feature_tiles[${index}].gltf_local_origin_l93_ngf_ign69`);
    if (Math.abs(localOrigin[0] - tileBounds[0]) > EPSILON || Math.abs(localOrigin[1] - tileBounds[1]) > EPSILON) {
      fail(`feature_tiles[${index}] doit avoir une origine GLB au coin sud-ouest de sa tuile.`);
    }
    if (localOrigin[2] < spatial.heightOrigin - EPSILON || localOrigin[2] > spatial.heightMaximum + EPSILON) {
      fail(`feature_tiles[${index}] a une origine GLB hors de la plage NGF-IGN69.`);
    }
    const feature = object(tile.features, `feature_tiles[${index}].features`);
    for (const key of ['geometry_count', 'triangle_count', 'vertex_count', 'route_count', 'tree_count']) {
      integer(feature[key], `feature_tiles[${index}].features.${key}`);
    }
    return {
      tileId,
      terrainTileId,
      bounds: tileBounds,
      features: asset(feature, `feature_tiles[${index}].features`, 'vectors/', '.glb'),
    };
  });
  const featureIds = new Set();
  for (const feature of featureTiles) {
    if (featureIds.has(feature.tileId)) fail(`tile_id dupliqué : ${feature.tileId}.`);
    featureIds.add(feature.tileId);
  }

  verifyExpectedCounts(zones, terrainTiles, featureTiles);
  const assets = [...terrainTiles.flatMap((tile) => [tile.elevation, tile.colour]), ...featureTiles.map((tile) => tile.features)];
  const assetPaths = new Set();
  for (const item of assets) {
    if (assetPaths.has(item.path)) fail(`asset dupliqué : ${item.path}.`);
    assetPaths.add(item.path);
  }
  const expectedAssetCount =
    SPATIAL_PACKAGE_EXPECTATION.elevationAssetCount +
    SPATIAL_PACKAGE_EXPECTATION.colourAssetCount +
    SPATIAL_PACKAGE_EXPECTATION.featureAssetCount;
  if (assets.length !== expectedAssetCount) fail(`Le paquet doit référencer ${expectedAssetCount} assets.`);

  return {
    assets,
    counts: {
      zones: zones.length,
      terrainTiles: terrainTiles.length,
      featureTiles: featureTiles.length,
      elevationAssets: terrainTiles.length,
      colourAssets: terrainTiles.length,
      featureAssets: featureTiles.length,
      assets: assets.length,
    },
  };
}

export function validateSpatialPackageManifest(value, catalogHash, catalogByteCount, catalog) {
  const manifest = object(value, 'package-manifest');
  if (manifest.schema_version !== SPATIAL_PACKAGE_EXPECTATION.schemaVersion) fail('package-manifest.schema_version est invalide.');
  requiredString(manifest, 'package_id', 'fireviewer-die-pontaix-r1-v4', 'package-manifest');
  const catalogEntry = object(manifest.catalog, 'package-manifest.catalog');
  if (catalogEntry.path !== 'catalog.json') fail('package-manifest.catalog.path doit être catalog.json.');
  if (sha256(catalogEntry.sha256, 'package-manifest.catalog.sha256') !== catalogHash) {
    fail('package-manifest.catalog.sha256 ne correspond pas au catalogue.');
  }
  if (integer(catalogEntry.byte_count, 'package-manifest.catalog.byte_count', 1) !== catalogByteCount) {
    fail('package-manifest.catalog.byte_count ne correspond pas au catalogue.');
  }
  const profile = object(manifest.spatial_profile, 'package-manifest.spatial_profile');
  requiredString(profile, 'grid_crs', SPATIAL_CONTRACT.gridCrs, 'package-manifest.spatial_profile');
  requiredString(profile, 'vertical_datum', SPATIAL_CONTRACT.verticalDatum, 'package-manifest.spatial_profile');
  const runtime = object(manifest.runtime, 'package-manifest.runtime');
  requiredString(runtime, 'renderer', 'Giro3D', 'package-manifest.runtime');
  requiredString(runtime, 'delivery', 'same-origin static files only', 'package-manifest.runtime');
  if (runtime.external_map_or_cesium !== false) fail('package-manifest.runtime.external_map_or_cesium doit être false.');
  const packageZones = array(manifest.zones, 'package-manifest.zones');
  const expectedZones = new Set([`${PUBLIC_ZONE.id}@${PUBLIC_ZONE.revision}`]);
  if (packageZones.length !== expectedZones.size) fail('package-manifest.zones ne contient pas la révision publique attendue.');
  for (const zone of packageZones) {
    const entry = object(zone, 'package-manifest.zones[]');
    const key = `${string(entry.zone_id, 'package-manifest.zones[].zone_id')}@${string(entry.revision_id, 'package-manifest.zones[].revision_id')}`;
    if (!expectedZones.delete(key)) fail(`Révision de zone inattendue ou dupliquée : ${key}.`);
  }
  if (expectedZones.size !== 0) fail('package-manifest.zones ne contient pas la révision publique attendue.');
  const provenance = object(manifest.provenance, 'package-manifest.provenance');
  requiredString(provenance, 'license', 'Licence Ouverte / Open Licence 2.0', 'package-manifest.provenance');
  const datasets = array(provenance.datasets, 'package-manifest.provenance.datasets').map((entry, index) => string(entry, `package-manifest.provenance.datasets[${index}]`));
  if (!datasets.includes('IGN LiDAR-HD') || !datasets.includes('IGN BD TOPO')) {
    fail('package-manifest.provenance.datasets doit citer IGN LiDAR-HD et IGN BD TOPO.');
  }
  verifySourceManifestReference(provenance.source_manifest, 'package-manifest.provenance.source_manifest');
  verifySourceManifestReference(
    object(catalog.provenance, 'provenance').source_manifest,
    'provenance.source_manifest',
  );
  const catalogZones = new Set(array(catalog.zones, 'zones').map((entry) => string(object(entry, 'zones[]').zone_id, 'zones[].zone_id')));
  for (const zoneKey of [PUBLIC_ZONE.id]) {
    if (!catalogZones.has(zoneKey)) fail(`Le catalogue ne contient pas ${zoneKey}.`);
  }
}

function resolvedAssetPath(root, assetPath) {
  const result = resolve(root, assetPath);
  const fromRoot = relative(root, result);
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) fail(`Chemin d’asset hors du paquet : ${assetPath}.`);
  return result;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const input = createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.once('error', reject);
    input.once('end', resolvePromise);
  });
  return hash.digest('hex');
}

async function listPackageFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPackageFiles(root, fullPath)));
    } else if (entry.isFile()) {
      files.push(relative(root, fullPath).replaceAll('\\', '/'));
    } else {
      fail(`Le paquet contient une entrée non régulière : ${relative(root, fullPath)}.`);
    }
  }
  return files.sort();
}

export async function verifySpatialPackage(root) {
  const packageRoot = resolve(root);
  const catalogPath = resolve(packageRoot, 'catalog.json');
  const manifestPath = resolve(packageRoot, 'package-manifest.json');
  let catalogBuffer;
  let manifestBuffer;
  try {
    if (!(await lstat(catalogPath)).isFile() || !(await lstat(manifestPath)).isFile()) {
      fail('catalog.json et package-manifest.json doivent être des fichiers réguliers.');
    }
    [catalogBuffer, manifestBuffer] = await Promise.all([readFile(catalogPath), readFile(manifestPath)]);
  } catch (error) {
    if (error instanceof SpatialPackageVerificationError) throw error;
    fail(`Le paquet est incomplet : ${error instanceof Error ? error.message : String(error)}.`);
  }
  let catalog;
  let packageManifest;
  try {
    catalog = JSON.parse(catalogBuffer.toString('utf8'));
    packageManifest = JSON.parse(manifestBuffer.toString('utf8'));
  } catch {
    fail('catalog.json et package-manifest.json doivent être des JSON valides.');
  }
  const catalogHash = createHash('sha256').update(catalogBuffer).digest('hex');
  const validated = validateSpatialCatalog(catalog);
  validateSpatialPackageManifest(packageManifest, catalogHash, catalogBuffer.byteLength, catalog);
  const expectedFiles = new Set(['catalog.json', 'package-manifest.json', ...validated.assets.map((entry) => entry.path)]);
  const actualFiles = await listPackageFiles(packageRoot);
  if (actualFiles.length !== expectedFiles.size) fail(`Le paquet contient ${actualFiles.length} fichiers au lieu des ${expectedFiles.size} attendus.`);
  for (const filePath of actualFiles) {
    if (!expectedFiles.has(filePath)) fail(`Fichier non référencé dans le paquet : ${filePath}.`);
  }

  let assetByteCount = 0;
  for (const entry of [...validated.assets].sort((left, right) => left.path.localeCompare(right.path))) {
    const filePath = resolvedAssetPath(packageRoot, entry.path);
    let fileInfo;
    try {
      fileInfo = await lstat(filePath);
    } catch (error) {
      fail(`Asset introuvable : ${entry.path} (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (!fileInfo.isFile()) fail(`Asset non régulier : ${entry.path}.`);
    if (fileInfo.size !== entry.byteCount) fail(`Taille incohérente pour ${entry.path} : ${fileInfo.size} au lieu de ${entry.byteCount}.`);
    if ((await sha256File(filePath)) !== entry.sha256) fail(`SHA-256 incohérent pour ${entry.path}.`);
    assetByteCount += fileInfo.size;
  }

  return {
    catalogSha256: catalogHash,
    catalogByteCount: catalogBuffer.byteLength,
    counts: { ...validated.counts, files: actualFiles.length },
    assetByteCount,
    packageByteCount: assetByteCount + catalogBuffer.byteLength + manifestBuffer.byteLength,
  };
}
