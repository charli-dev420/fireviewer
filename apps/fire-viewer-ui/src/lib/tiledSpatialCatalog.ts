export type TiledSpatialBounds = readonly [number, number, number, number];

export interface TiledSpatialTerrainTile {
  readonly bounds: TiledSpatialBounds;
  readonly colourPath: string;
  readonly elevationPath: string;
}

export interface TiledSpatialFeatureTile {
  readonly id: string;
  readonly bounds: TiledSpatialBounds;
  readonly path: string;
  readonly origin: readonly [number, number, number];
}

export interface TiledSpatialCatalog {
  readonly bounds: TiledSpatialBounds;
  readonly heightOrigin: number;
  readonly heightMaximum: number;
  readonly terrain: readonly TiledSpatialTerrainTile[];
  readonly features: readonly TiledSpatialFeatureTile[];
}

function finiteTuple(value: unknown, length: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== length || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`${label} est invalide.`);
  }
  return value as number[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} est invalide.`);
  return value as Record<string, unknown>;
}

function controlledPath(value: unknown, files: Readonly<Record<string, string>>, label: string): string {
  if (typeof value !== 'string' || !value || !files[value]) throw new Error(`${label} est absent du package publié.`);
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} contient un chemin non sûr.`);
  }
  return value;
}

export function parseTiledSpatialCatalog(
  value: unknown,
  files: Readonly<Record<string, string>>,
): TiledSpatialCatalog {
  const root = object(value, 'Le catalogue spatial');
  if (root.schema_version !== '1.1') throw new Error('Le catalogue spatial doit utiliser le schéma 1.1.');
  const contract = object(root.spatial_contract, 'Le repère spatial');
  if (
    contract.grid_crs !== 'EPSG:2154'
    || contract.horizontal_datum !== 'RGF93'
    || contract.vertical_datum !== 'NGF-IGN69'
    || contract.gltf_axes !== 'local glTF (E, U, -N) metres'
  ) throw new Error('Le repère Lambert-93 / NGF-IGN69 / glTF du catalogue est incompatible.');
  finiteTuple(contract.common_anchor_l93_metres, 2, 'L’ancre Lambert-93');
  const bounds = finiteTuple(root.bounds_l93_metres, 4, 'L’emprise Lambert-93') as unknown as TiledSpatialBounds;
  const heightOrigin = contract.height_origin_ngf_ign69_m;
  const heightMaximum = contract.height_maximum_ngf_ign69_m;
  if (typeof heightOrigin !== 'number' || typeof heightMaximum !== 'number' || heightMaximum <= heightOrigin) {
    throw new Error('La plage altimétrique NGF-IGN69 est invalide.');
  }
  const terrain = Array.isArray(root.terrain_tiles) ? root.terrain_tiles.map((raw, index) => {
    const tile = object(raw, `terrain_tiles[${index}]`);
    const colour = object(tile.colour, `terrain_tiles[${index}].colour`);
    const elevation = object(tile.elevation, `terrain_tiles[${index}].elevation`);
    return {
      bounds: finiteTuple(tile.bounds_l93_metres, 4, `terrain_tiles[${index}].bounds`) as unknown as TiledSpatialBounds,
      colourPath: controlledPath(colour.path, files, `terrain_tiles[${index}].colour.path`),
      elevationPath: controlledPath(elevation.path, files, `terrain_tiles[${index}].elevation.path`),
    };
  }) : [];
  const features = Array.isArray(root.feature_tiles) ? root.feature_tiles.map((raw, index) => {
    const tile = object(raw, `feature_tiles[${index}]`);
    const asset = object(tile.features, `feature_tiles[${index}].features`);
    const id = tile.tile_id;
    if (typeof id !== 'string' || !id) throw new Error(`feature_tiles[${index}].tile_id est invalide.`);
    return {
      id,
      bounds: finiteTuple(tile.bounds_l93_metres, 4, `feature_tiles[${index}].bounds`) as unknown as TiledSpatialBounds,
      path: controlledPath(asset.path, files, `feature_tiles[${index}].features.path`),
      origin: finiteTuple(tile.gltf_local_origin_l93_ngf_ign69, 3, `feature_tiles[${index}].origin`) as unknown as readonly [number, number, number],
    };
  }) : [];
  if (!terrain.length || !features.length) throw new Error('Le package ne contient pas de relief et de tuiles 3D exploitables.');
  return { bounds, heightOrigin, heightMaximum, terrain, features };
}
