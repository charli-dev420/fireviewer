export type BoundsL93 = readonly [number, number, number, number];

export const SPATIAL_CATALOG_SCHEMA_VERSION = '1.1';
export const SPATIAL_MAP_ROOT = '/maps/fireviewer-die-pontaix-r1-v4/';

export const PUBLIC_SPATIAL_ZONE_ID = 'DIE-PONTAIX-08';
export const PUBLIC_SPATIAL_ZONE_REVISION_ID = 'R1';
export const PUBLIC_SPATIAL_ZONE_BOUNDS: BoundsL93 = [876_000, 6_403_000, 892_000, 6_413_000];
export const PUBLIC_SPATIAL_COVERAGE_PATCHES: readonly BoundsL93[] = [
  [876_000, 6_403_000, 884_000, 6_411_000],
  [884_000, 6_405_000, 892_000, 6_413_000],
];

const SPATIAL_CONTRACT = {
  gridCrs: 'EPSG:2154',
  horizontalDatum: 'RGF93',
  verticalDatum: 'NGF-IGN69',
  giro3dAxes: 'EPSG:2154 (E, N, U) metres',
  gltfAxes: 'local glTF (E, U, -N) metres',
  gltfToGiro3d: 'rotate local GLB +90 degrees around X, then place at its L93/NGF origin',
  unityBridge: 'Unity (100E, 100U, 100N) = glTF (E, U, -N) * (100, 100, -100)',
} as const;

const SPATIAL_RUNTIME = {
  renderer: 'Giro3D',
  delivery: 'same-origin static files only',
} as const;

const EPSILON = 1e-7;

export interface SpatialAsset {
  path: string;
  sha256: string;
  byteCount: number;
}

export interface SpatialZone {
  zoneId: string;
  revisionId: string;
  bounds: BoundsL93;
  coveragePatches: readonly BoundsL93[];
}

export interface SpatialTerrainTile {
  terrainTileId: string;
  zoneId: string;
  bounds: BoundsL93;
  sampleSpacingMetres: number;
  elevation: SpatialAsset;
  colour: SpatialAsset;
}

export interface SpatialFeatureTile {
  tileId: string;
  terrainTileId: string;
  zoneId: string;
  bounds: BoundsL93;
  gltfLocalOrigin: readonly [number, number, number];
  features: SpatialAsset & {
    geometryCount: number;
    triangleCount: number;
    vertexCount: number;
    routeCount: number;
    treeCount: number;
  };
}

export interface SpatialCatalog {
  schemaVersion: typeof SPATIAL_CATALOG_SCHEMA_VERSION;
  bounds: BoundsL93;
  heightOriginNgfIgn69Metres: number;
  heightMaximumNgfIgn69Metres: number;
  zones: readonly SpatialZone[];
  terrainTiles: readonly SpatialTerrainTile[];
  featureTiles: readonly SpatialFeatureTile[];
}

export class SpatialCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpatialCatalogError';
  }
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SpatialCatalogError(`${label} doit être un objet.`);
  }
  return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SpatialCatalogError(`${label} doit être un tableau.`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SpatialCatalogError(`${label} doit être un nombre fini.`);
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SpatialCatalogError(`${label} doit être une chaîne non vide.`);
  }
  return value;
}

function bounds(value: unknown, label: string): BoundsL93 {
  const values = asArray(value, label);
  if (values.length !== 4) {
    throw new SpatialCatalogError(`${label} doit contenir quatre coordonnées.`);
  }
  const [xmin, ymin, xmax, ymax] = values.map((item, index) => finiteNumber(item, `${label}[${index}]`));
  if (xmin >= xmax || ymin >= ymax) {
    throw new SpatialCatalogError(`${label} doit être une emprise croissante.`);
  }
  return [xmin, ymin, xmax, ymax];
}

function contains(container: BoundsL93, item: BoundsL93): boolean {
  return (
    item[0] >= container[0] - EPSILON
    && item[1] >= container[1] - EPSILON
    && item[2] <= container[2] + EPSILON
    && item[3] <= container[3] + EPSILON
  );
}

function sameBounds(left: BoundsL93, right: BoundsL93): boolean {
  return left.every((coordinate, index) => Math.abs(coordinate - right[index]) <= EPSILON);
}

function triple(value: unknown, label: string): readonly [number, number, number] {
  const values = asArray(value, label);
  if (values.length !== 3) {
    throw new SpatialCatalogError(`${label} doit contenir trois coordonnées.`);
  }
  return [
    finiteNumber(values[0], `${label}[0]`),
    finiteNumber(values[1], `${label}[1]`),
    finiteNumber(values[2], `${label}[2]`),
  ];
}

function pair(value: unknown, label: string): readonly [number, number] {
  const values = asArray(value, label);
  if (values.length !== 2) {
    throw new SpatialCatalogError(`${label} doit contenir deux coordonnées.`);
  }
  return [
    finiteNumber(values[0], `${label}[0]`),
    finiteNumber(values[1], `${label}[1]`),
  ];
}

function safeRelativePath(value: unknown, label: string, expectedPrefix: string, expectedSuffix: string): string {
  const path = nonEmptyString(value, label);
  if (
    path.startsWith('/')
    || path.startsWith('\\')
    || path.includes('\\')
    || path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    || !path.startsWith(expectedPrefix)
    || !path.endsWith(expectedSuffix)
  ) {
    throw new SpatialCatalogError(`${label} doit désigner un fichier local ${expectedPrefix}…${expectedSuffix}.`);
  }
  return path;
}

function asset(value: unknown, label: string, expectedPrefix: string, expectedSuffix: string): SpatialAsset {
  const source = asObject(value, label);
  const sha256 = nonEmptyString(source.sha256, `${label}.sha256`);
  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new SpatialCatalogError(`${label}.sha256 doit être une empreinte SHA-256.`);
  }
  const byteCount = finiteNumber(source.byte_count, `${label}.byte_count`);
  if (!Number.isInteger(byteCount) || byteCount <= 0) {
    throw new SpatialCatalogError(`${label}.byte_count doit être un entier positif.`);
  }
  return {
    path: safeRelativePath(source.path, `${label}.path`, expectedPrefix, expectedSuffix),
    sha256: sha256.toLowerCase(),
    byteCount,
  };
}

function terrainTile(value: unknown, index: number): SpatialTerrainTile {
  const source = asObject(value, `terrain_tiles[${index}]`);
  return {
    terrainTileId: nonEmptyString(source.terrain_tile_id, `terrain_tiles[${index}].terrain_tile_id`),
    zoneId: nonEmptyString(source.zone_id, `terrain_tiles[${index}].zone_id`),
    bounds: bounds(source.bounds_l93_metres, `terrain_tiles[${index}].bounds_l93_metres`),
    sampleSpacingMetres: finiteNumber(source.sample_spacing_metres, `terrain_tiles[${index}].sample_spacing_metres`),
    elevation: asset(source.elevation, `terrain_tiles[${index}].elevation`, 'terrain/', '.cog.tif'),
    colour: asset(source.colour, `terrain_tiles[${index}].colour`, 'terrain/', '.png'),
  };
}

function featureTile(value: unknown, index: number): SpatialFeatureTile {
  const source = asObject(value, `feature_tiles[${index}]`);
  const featureAsset = asset(source.features, `feature_tiles[${index}].features`, 'vectors/', '.glb');
  const featureSource = asObject(source.features, `feature_tiles[${index}].features`);
  const integer = (key: string) => {
    const result = finiteNumber(featureSource[key], `feature_tiles[${index}].features.${key}`);
    if (!Number.isInteger(result) || result < 0) {
      throw new SpatialCatalogError(`feature_tiles[${index}].features.${key} doit être un entier positif ou nul.`);
    }
    return result;
  };
  return {
    tileId: nonEmptyString(source.tile_id, `feature_tiles[${index}].tile_id`),
    terrainTileId: nonEmptyString(source.terrain_tile_id, `feature_tiles[${index}].terrain_tile_id`),
    zoneId: nonEmptyString(source.zone_id, `feature_tiles[${index}].zone_id`),
    bounds: bounds(source.bounds_l93_metres, `feature_tiles[${index}].bounds_l93_metres`),
    gltfLocalOrigin: triple(source.gltf_local_origin_l93_ngf_ign69, `feature_tiles[${index}].gltf_local_origin_l93_ngf_ign69`),
    features: {
      ...featureAsset,
      geometryCount: integer('geometry_count'),
      triangleCount: integer('triangle_count'),
      vertexCount: integer('vertex_count'),
      routeCount: integer('route_count'),
      treeCount: integer('tree_count'),
    },
  };
}

export function parseSpatialCatalog(value: unknown): SpatialCatalog {
  const source = asObject(value, 'catalogue spatial');
  if (source.schema_version !== SPATIAL_CATALOG_SCHEMA_VERSION) {
    throw new SpatialCatalogError(`schema_version doit être ${SPATIAL_CATALOG_SCHEMA_VERSION}.`);
  }
  const spatialContract = asObject(source.spatial_contract, 'spatial_contract');
  if (
    spatialContract.grid_crs !== SPATIAL_CONTRACT.gridCrs
    || spatialContract.horizontal_datum !== SPATIAL_CONTRACT.horizontalDatum
    || spatialContract.vertical_datum !== SPATIAL_CONTRACT.verticalDatum
    || spatialContract.giro3d_axes !== SPATIAL_CONTRACT.giro3dAxes
    || spatialContract.gltf_axes !== SPATIAL_CONTRACT.gltfAxes
    || spatialContract.gltf_to_giro3d !== SPATIAL_CONTRACT.gltfToGiro3d
    || spatialContract.unity_bridge !== SPATIAL_CONTRACT.unityBridge
  ) {
    throw new SpatialCatalogError('Le catalogue doit conserver le profil spatial et le pont Giro3D/glTF/Unity canoniques.');
  }
  pair(spatialContract.common_anchor_l93_metres, 'spatial_contract.common_anchor_l93_metres');
  const heightOriginNgfIgn69Metres = finiteNumber(
    spatialContract.height_origin_ngf_ign69_m,
    'spatial_contract.height_origin_ngf_ign69_m',
  );
  const heightMaximumNgfIgn69Metres = finiteNumber(
    spatialContract.height_maximum_ngf_ign69_m,
    'spatial_contract.height_maximum_ngf_ign69_m',
  );
  if (heightMaximumNgfIgn69Metres <= heightOriginNgfIgn69Metres) {
    throw new SpatialCatalogError('La plage d’altitude NGF-IGN69 doit être croissante.');
  }
  const runtime = asObject(source.runtime, 'runtime');
  if (
    runtime.renderer !== SPATIAL_RUNTIME.renderer
    || runtime.delivery !== SPATIAL_RUNTIME.delivery
    || runtime.external_map_or_cesium !== false
  ) {
    throw new SpatialCatalogError('Le catalogue doit rester rendu par Giro3D depuis des fichiers same-origin sans Cesium.');
  }
  const catalogBounds = bounds(source.bounds_l93_metres, 'bounds_l93_metres');
  const zones = asArray(source.zones, 'zones').map((entry, index) => {
    const zone = asObject(entry, `zones[${index}]`);
    const parsed = {
      zoneId: nonEmptyString(zone.zone_id, `zones[${index}].zone_id`),
      revisionId: nonEmptyString(zone.revision_id, `zones[${index}].revision_id`),
      bounds: bounds(zone.bounds_l93_metres, `zones[${index}].bounds_l93_metres`),
      coveragePatches: asArray(zone.coverage_patches_l93_metres, `zones[${index}].coverage_patches_l93_metres`)
        .map((patch, patchIndex) => bounds(patch, `zones[${index}].coverage_patches_l93_metres[${patchIndex}]`)),
    };
    if (!contains(catalogBounds, parsed.bounds)) {
      throw new SpatialCatalogError(`zones[${index}] sort de l’emprise Lambert-93 du catalogue.`);
    }
    if (parsed.coveragePatches.length === 0 || parsed.coveragePatches.some((patch) => !contains(parsed.bounds, patch))) {
      throw new SpatialCatalogError(`zones[${index}] doit déclarer des emprises techniques dans sa zone publique.`);
    }
    return parsed;
  });
  const terrainTiles = asArray(source.terrain_tiles, 'terrain_tiles').map(terrainTile);
  const featureTiles = asArray(source.feature_tiles, 'feature_tiles').map(featureTile);
  if (zones.length === 0 || terrainTiles.length === 0 || featureTiles.length === 0) {
    throw new SpatialCatalogError('Le catalogue doit contenir des zones, terrains et couches détaillées.');
  }
  if (
    zones.length !== 1
    || zones[0].zoneId !== PUBLIC_SPATIAL_ZONE_ID
    || zones[0].revisionId !== PUBLIC_SPATIAL_ZONE_REVISION_ID
    || !sameBounds(zones[0].bounds, PUBLIC_SPATIAL_ZONE_BOUNDS)
    || zones[0].coveragePatches.length !== PUBLIC_SPATIAL_COVERAGE_PATCHES.length
    || zones[0].coveragePatches.some((patch, index) => !sameBounds(patch, PUBLIC_SPATIAL_COVERAGE_PATCHES[index]))
  ) {
    throw new SpatialCatalogError('Le catalogue 1.1 doit exposer uniquement la zone DIE-PONTAIX-08 en révision R1 et ses deux couvertures techniques canoniques.');
  }
  if (!sameBounds(catalogBounds, PUBLIC_SPATIAL_ZONE_BOUNDS)) {
    throw new SpatialCatalogError('L’emprise globale doit correspondre à la zone publique DIE-PONTAIX-08.');
  }
  const zonesById = new Map<string, SpatialZone>();
  for (const zone of zones) {
    if (zonesById.has(zone.zoneId)) {
      throw new SpatialCatalogError(`zone_id dupliqué : ${zone.zoneId}.`);
    }
    zonesById.set(zone.zoneId, zone);
  }
  const terrainById = new Map<string, SpatialTerrainTile>();
  for (const tile of terrainTiles) {
    if (terrainById.has(tile.terrainTileId)) {
      throw new SpatialCatalogError(`terrain_tile_id dupliqué : ${tile.terrainTileId}.`);
    }
    const zone = zonesById.get(tile.zoneId);
    if (!zone || !contains(zone.bounds, tile.bounds) || !contains(catalogBounds, tile.bounds)) {
      throw new SpatialCatalogError(`Le terrain ${tile.terrainTileId} sort de sa zone déclarée.`);
    }
    if (!zone.coveragePatches.some((coveragePatch) => contains(coveragePatch, tile.bounds))) {
      throw new SpatialCatalogError(`Le terrain ${tile.terrainTileId} sort des couvertures techniques disponibles.`);
    }
    terrainById.set(tile.terrainTileId, tile);
  }
  for (const coveragePatch of zones[0].coveragePatches) {
    if (!terrainTiles.some((tile) => contains(coveragePatch, tile.bounds))) {
      throw new SpatialCatalogError('Chaque emprise technique publiée doit contenir au moins un terrain.');
    }
  }
  const featureIds = new Set<string>();
  for (const tile of featureTiles) {
    if (featureIds.has(tile.tileId)) {
      throw new SpatialCatalogError(`tile_id dupliqué : ${tile.tileId}.`);
    }
    featureIds.add(tile.tileId);
    const terrain = terrainById.get(tile.terrainTileId);
    if (!terrain) {
      throw new SpatialCatalogError(`La couche détaillée ${tile.tileId} ne référence aucun terrain exporté.`);
    }
    if (tile.zoneId !== terrain.zoneId || !contains(terrain.bounds, tile.bounds)) {
      throw new SpatialCatalogError(`La couche détaillée ${tile.tileId} sort de son terrain déclaré.`);
    }
    if (
      Math.abs(tile.gltfLocalOrigin[0] - tile.bounds[0]) > EPSILON
      || Math.abs(tile.gltfLocalOrigin[1] - tile.bounds[1]) > EPSILON
      || tile.gltfLocalOrigin[2] < heightOriginNgfIgn69Metres - EPSILON
      || tile.gltfLocalOrigin[2] > heightMaximumNgfIgn69Metres + EPSILON
    ) {
      throw new SpatialCatalogError(`La couche détaillée ${tile.tileId} a une origine GLB incompatible avec le profil spatial.`);
    }
  }
  return {
    schemaVersion: SPATIAL_CATALOG_SCHEMA_VERSION,
    bounds: catalogBounds,
    heightOriginNgfIgn69Metres,
    heightMaximumNgfIgn69Metres,
    zones,
    terrainTiles,
    featureTiles,
  };
}

export async function loadSpatialCatalog(signal?: AbortSignal): Promise<SpatialCatalog> {
  let response: Response;
  try {
    response = await fetch(`${SPATIAL_MAP_ROOT}catalog.json`, {
      cache: 'no-store',
      credentials: 'omit',
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new SpatialCatalogError('Le catalogue spatial local est inaccessible.');
  }
  if (!response.ok) {
    throw new SpatialCatalogError(`Le catalogue spatial local est indisponible (${response.status}).`);
  }
  try {
    return parseSpatialCatalog(await response.json());
  } catch (error) {
    if (error instanceof SpatialCatalogError) throw error;
    throw new SpatialCatalogError('Le catalogue spatial local ne contient pas un JSON valide.');
  }
}

export function spatialAssetUrl(path: string): string {
  const terrainAsset = path.startsWith('terrain/');
  const expectedPrefix = terrainAsset ? 'terrain/' : 'vectors/';
  const expectedSuffix = terrainAsset && path.endsWith('.png') ? '.png' : terrainAsset ? '.cog.tif' : '.glb';
  const normalized = safeRelativePath(path, 'asset.path', expectedPrefix, expectedSuffix);
  return new URL(`${SPATIAL_MAP_ROOT}${normalized}`, window.location.origin).toString();
}

export function boundsCenter(value: BoundsL93): readonly [number, number] {
  return [(value[0] + value[2]) / 2, (value[1] + value[3]) / 2];
}
