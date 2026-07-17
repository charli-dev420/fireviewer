export type UnityBounds = readonly [number, number, number, number];
export type UnityOrigin = readonly [number, number, number];

export interface UnityAssetReference {
  readonly path?: string;
  readonly url?: string;
  readonly sha256: string;
  readonly byte_count: number;
}

export interface UnityCatalogTile {
  readonly id: string;
  readonly bounds_l93_m: UnityBounds;
  readonly payload: UnityAssetReference;
  readonly imagery: UnityAssetReference;
  readonly sections: readonly string[];
}

export interface UnitySpatialCatalog {
  readonly schema: 'fireviewer.remote-tile-catalog.v1';
  readonly catalog_version: 1;
  readonly crs: 'EPSG:2154';
  readonly linear_unit: 'metre';
  readonly origin_l93_m: UnityOrigin;
  readonly exported_detail_tile_count: number;
  readonly lod_policy: {
    readonly far: {
      readonly bounds_l93_m: UnityBounds;
      readonly terrain: UnityAssetReference;
      readonly imagery: UnityAssetReference;
    };
    readonly detail: {
      readonly publish_distance_m: number;
      readonly preload_radius_m: number;
      readonly maximum_resident_tile_count: number;
    };
  };
  readonly tiles: readonly UnityCatalogTile[];
}

interface Quantization {
  readonly minimum_m?: number;
  readonly step_m?: number;
  readonly east_minimum_m?: number;
  readonly east_step_m?: number;
  readonly north_minimum_m?: number;
  readonly north_step_m?: number;
  readonly up_minimum_m?: number;
  readonly up_step_m?: number;
}

interface MeshDescriptor {
  readonly name: string;
  readonly vertex_count: number;
  readonly triangle_count: number;
  readonly vertex_offset_bytes: number;
  readonly index_offset_bytes: number;
  readonly end_offset_bytes: number;
  readonly index_stride_bytes: 2 | 4;
}

interface SectionMetadata {
  readonly encoding: string;
  readonly rows?: number;
  readonly columns?: number;
  readonly sample_spacing_m?: readonly [number, number];
  readonly geometric_bounds_l93_m?: UnityBounds;
  readonly outer_bounds_l93_m?: UnityBounds;
  readonly elevation_bytes?: number;
  readonly validity_mask_offset_bytes?: number;
  readonly validity_mask_bytes?: number;
  readonly valid_sample_count?: number;
  readonly elevation_quantization?: Quantization;
  readonly record_stride_bytes?: number;
  readonly count?: number;
  readonly position_origin_l93_m?: UnityOrigin;
  readonly vertex_stride_bytes?: number;
  readonly mesh_count?: number;
  readonly meshes?: readonly MeshDescriptor[];
  readonly position_quantization?: Quantization;
}

interface SectionHeader {
  readonly name: string;
  readonly codec: string;
  readonly offset_bytes: number;
  readonly stored_bytes: number;
  readonly raw_bytes: number;
  readonly stored_sha256: string;
  readonly raw_sha256: string;
  readonly metadata: SectionMetadata;
}

interface ContainerHeader {
  readonly schema: string;
  readonly kind: string;
  readonly tile_id: string;
  readonly crs: string;
  readonly bounds_l93_m: UnityBounds;
  readonly origin_l93_m: UnityOrigin;
  readonly sections: readonly SectionHeader[];
}

export interface UnityMeshData {
  readonly name: string;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly uv?: Float32Array;
}

export interface UnityTreeData {
  readonly positions: Float32Array;
  readonly heights: Float32Array;
  readonly crowns: Float32Array;
  readonly variants: Uint8Array;
  readonly rotations: Float32Array;
}

export interface UnityTileGeometry {
  readonly tileId: string;
  readonly terrain: UnityMeshData;
  readonly trees: UnityTreeData;
  readonly buildings: readonly UnityMeshData[];
  readonly roads: readonly UnityMeshData[];
  readonly water: readonly UnityMeshData[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} invalide.`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} invalide.`);
  return value;
}

function tuple(value: unknown, size: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== size) throw new Error(`${label} invalide.`);
  return value.map((item, index) => finite(item, `${label}[${index}]`));
}

function asset(value: unknown, label: string): UnityAssetReference {
  const item = record(value, label);
  const path = typeof item.path === 'string' ? item.path : undefined;
  const url = typeof item.url === 'string' ? item.url : undefined;
  const location = path ?? url;
  if (!location || location.startsWith('/') || location.includes('..') || /^[a-z]+:/i.test(location)) {
    throw new Error(`${label} sort du package.`);
  }
  if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256)) throw new Error(`${label} sans SHA-256.`);
  return { path, url, sha256: item.sha256.toLowerCase(), byte_count: finite(item.byte_count, `${label}.byte_count`) };
}

export function parseUnitySpatialCatalog(value: unknown): UnitySpatialCatalog {
  const source = record(value, 'catalogue Unity');
  if (source.schema !== 'fireviewer.remote-tile-catalog.v1') throw new Error('Le package actif n’est pas un export Unity FireViewer V1.');
  if (source.catalog_version !== 1 || source.crs !== 'EPSG:2154' || source.linear_unit !== 'metre') {
    throw new Error('Le référentiel du catalogue Unity est incompatible.');
  }
  const origin = tuple(source.origin_l93_m, 3, 'origin_l93_m') as unknown as UnityOrigin;
  const policy = record(source.lod_policy, 'lod_policy');
  const far = record(policy.far, 'lod_policy.far');
  const detail = record(policy.detail, 'lod_policy.detail');
  const maximum = finite(detail.maximum_resident_tile_count, 'maximum_resident_tile_count');
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 16) throw new Error('Le budget Unity doit être compris entre 1 et 16 tuiles.');
  const rows = source.tiles;
  if (!Array.isArray(rows)) throw new Error('La liste des tuiles Unity est absente.');
  const tiles = rows.map((raw, index): UnityCatalogTile => {
    const item = record(raw, `tiles[${index}]`);
    if (typeof item.id !== 'string' || !item.id) throw new Error(`tiles[${index}].id invalide.`);
    const sections = Array.isArray(item.sections) ? item.sections.filter((entry): entry is string => typeof entry === 'string') : [];
    for (const required of ['terrain', 'trees', 'buildings', 'roads', 'water']) {
      if (!sections.includes(required)) throw new Error(`La tuile ${item.id} ne contient pas ${required}.`);
    }
    return {
      id: item.id,
      bounds_l93_m: tuple(item.bounds_l93_m, 4, `${item.id}.bounds_l93_m`) as unknown as UnityBounds,
      payload: asset(item.payload, `${item.id}.payload`),
      imagery: asset(item.imagery, `${item.id}.imagery`),
      sections,
    };
  });
  const expected = finite(source.exported_detail_tile_count, 'exported_detail_tile_count');
  if (tiles.length !== expected) throw new Error('Le catalogue Unity est incomplet.');
  return {
    schema: 'fireviewer.remote-tile-catalog.v1', catalog_version: 1, crs: 'EPSG:2154', linear_unit: 'metre',
    origin_l93_m: origin, exported_detail_tile_count: expected,
    lod_policy: {
      far: {
        bounds_l93_m: tuple(far.bounds_l93_m, 4, 'far.bounds_l93_m') as unknown as UnityBounds,
        terrain: asset(far.terrain, 'far.terrain'), imagery: asset(far.imagery, 'far.imagery'),
      },
      detail: {
        publish_distance_m: finite(detail.publish_distance_m, 'publish_distance_m'),
        preload_radius_m: finite(detail.preload_radius_m, 'preload_radius_m'),
        maximum_resident_tile_count: maximum,
      },
    },
    tiles,
  };
}

export function assetPath(reference: UnityAssetReference): string {
  const result = reference.path ?? reference.url;
  if (!result) throw new Error('Référence Unity sans chemin.');
  return result;
}

async function inflate(bytes: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne sait pas décoder les tuiles Unity zlib.');
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate'));
  const result = new Uint8Array(await new Response(stream).arrayBuffer());
  if (result.byteLength !== expected) throw new Error('Une section Unity décompressée a une taille incohérente.');
  return result;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function u16(view: DataView, offset: number): number { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number): number { return view.getUint32(offset, true); }
function i32(view: DataView, offset: number): number { return view.getInt32(offset, true); }

async function decodeContainer(buffer: ArrayBuffer): Promise<{ header: ContainerHeader; sections: Map<string, Uint8Array> }> {
  const view = new DataView(buffer);
  if (buffer.byteLength < 16) throw new Error('Conteneur Unity tronqué.');
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
  if (magic !== 'FWTILE1\0' || u16(view, 8) !== 1) throw new Error('Version de conteneur Unity incompatible.');
  const headerLength = u32(view, 12);
  if (headerLength <= 0 || 16 + headerLength > buffer.byteLength) throw new Error('En-tête Unity invalide.');
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 16, headerLength))) as ContainerHeader;
  if (header.crs !== 'EPSG:2154' || !Array.isArray(header.sections)) throw new Error('En-tête spatial Unity invalide.');
  const bodyOffset = 16 + headerLength;
  const sections = new Map<string, Uint8Array>();
  for (const section of header.sections) {
    if (section.codec !== 'zlib' || sections.has(section.name)) throw new Error(`Section Unity ${section.name} invalide.`);
    const end = bodyOffset + section.offset_bytes + section.stored_bytes;
    if (section.offset_bytes < 0 || section.stored_bytes <= 0 || end > buffer.byteLength) throw new Error(`Section Unity ${section.name} tronquée.`);
    const stored = new Uint8Array(buffer, bodyOffset + section.offset_bytes, section.stored_bytes);
    if (await sha256(stored) !== section.stored_sha256) throw new Error(`SHA-256 stocké invalide pour ${section.name}.`);
    const raw = await inflate(stored, section.raw_bytes);
    if (await sha256(raw) !== section.raw_sha256) throw new Error(`SHA-256 brut invalide pour ${section.name}.`);
    sections.set(section.name, raw);
  }
  return { header, sections };
}

function quantized(value: number, source: Quantization | undefined): number {
  if (!source || source.minimum_m === undefined || source.step_m === undefined) throw new Error('Quantification Unity absente.');
  return source.minimum_m + value * source.step_m;
}

function gridIndices(rows: number, columns: number, valid?: Uint8Array): Uint32Array {
  const output: number[] = [];
  const usable = (index: number) => !valid || valid[index] === 1;
  for (let row = 0; row < rows - 1; row += 1) for (let column = 0; column < columns - 1; column += 1) {
    const nw = row * columns + column; const ne = nw + 1; const sw = nw + columns; const se = sw + 1;
    if (usable(nw) && usable(ne) && usable(se)) output.push(nw, ne, se);
    if (usable(nw) && usable(se) && usable(sw)) output.push(nw, se, sw);
  }
  return Uint32Array.from(output);
}

function decodeTerrain(raw: Uint8Array, metadata: SectionMetadata, origin: UnityOrigin, requestedStride = 1): UnityMeshData {
  const rows = metadata.rows ?? 0; const columns = metadata.columns ?? 0;
  if (rows < 2 || columns < 2 || !metadata.elevation_quantization) throw new Error('Terrain Unity incomplet.');
  const count = rows * columns; const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const stride = Math.max(1, Math.floor(requestedStride));
  let valid: Uint8Array | undefined;
  const detail = metadata.encoding === 'regular-grid-z-u16.v1';
  if (!detail && metadata.encoding !== 'masked-regular-grid-z-u16.v1') throw new Error(`Encodage terrain Unity inconnu: ${metadata.encoding}`);
  const bounds = detail ? metadata.geometric_bounds_l93_m : metadata.outer_bounds_l93_m;
  const spacing = metadata.sample_spacing_m;
  if (!bounds || !spacing || raw.byteLength < count * 2) throw new Error('Dimensions du terrain Unity incohérentes.');
  if (!detail) {
    const maskOffset = metadata.validity_mask_offset_bytes ?? 0;
    valid = new Uint8Array(count);
    let actual = 0;
    for (let index = 0; index < count; index += 1) {
      valid[index] = (raw[maskOffset + Math.floor(index / 8)]! & (1 << (index % 8))) !== 0 ? 1 : 0;
      actual += valid[index]!;
    }
    if (actual !== metadata.valid_sample_count) throw new Error('Masque du terrain FAR incohérent.');
  }
  const selectedRows = Array.from({ length: Math.ceil((rows - 1) / stride) + 1 }, (_, index) => Math.min(rows - 1, index * stride));
  const selectedColumns = Array.from({ length: Math.ceil((columns - 1) / stride) + 1 }, (_, index) => Math.min(columns - 1, index * stride));
  const sampledCount = selectedRows.length * selectedColumns.length;
  const positions = new Float32Array(sampledCount * 3); const uv = new Float32Array(sampledCount * 2);
  const sampledValid = valid ? new Uint8Array(sampledCount) : undefined;
  for (let sampledRow = 0; sampledRow < selectedRows.length; sampledRow += 1) for (let sampledColumn = 0; sampledColumn < selectedColumns.length; sampledColumn += 1) {
    const row = selectedRows[sampledRow]!; const column = selectedColumns[sampledColumn]!;
    const index = row * columns + column; const sampledIndex = sampledRow * selectedColumns.length + sampledColumn;
    const east = detail ? bounds[0] + column * spacing[0] : bounds[0] + (column + 0.5) * spacing[0];
    const north = detail ? bounds[3] - row * spacing[1] : bounds[3] - (row + 0.5) * spacing[1];
    positions[sampledIndex * 3] = east - origin[0];
    positions[sampledIndex * 3 + 1] = north - origin[1];
    positions[sampledIndex * 3 + 2] = quantized(u16(view, index * 2), metadata.elevation_quantization);
    uv[sampledIndex * 2] = detail ? column / (columns - 1) : (column + 0.5) / columns;
    uv[sampledIndex * 2 + 1] = detail ? 1 - row / (rows - 1) : 1 - (row + 0.5) / rows;
    if (sampledValid && valid) sampledValid[sampledIndex] = valid[index]!;
  }
  return { name: detail ? 'terrain' : 'far-terrain', positions, indices: gridIndices(selectedRows.length, selectedColumns.length, sampledValid), uv };
}

function decodeTrees(raw: Uint8Array, metadata: SectionMetadata, origin: UnityOrigin): UnityTreeData {
  const count = metadata.count ?? 0; const stride = metadata.record_stride_bytes ?? 0;
  if (stride !== 19 || raw.byteLength !== count * stride || !metadata.position_origin_l93_m) throw new Error('Instances d’arbres Unity incohérentes.');
  const dimensionScale = metadata.encoding === 'tree-instance-mm.v1' ? 0.001 : metadata.encoding === 'tree-instance-position-mm-dimension-cm.v2' ? 0.01 : 0;
  if (!dimensionScale) throw new Error(`Encodage arbres Unity inconnu: ${metadata.encoding}`);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const positions = new Float32Array(count * 3); const heights = new Float32Array(count); const crowns = new Float32Array(count);
  const variants = new Uint8Array(count); const rotations = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * stride;
    positions[index * 3] = metadata.position_origin_l93_m[0] + u32(view, offset) / 1000 - origin[0];
    positions[index * 3 + 1] = metadata.position_origin_l93_m[1] + u32(view, offset + 4) / 1000 - origin[1];
    positions[index * 3 + 2] = i32(view, offset + 8) / 1000;
    heights[index] = u16(view, offset + 12) * dimensionScale; crowns[index] = u16(view, offset + 14) * dimensionScale;
    variants[index] = raw[offset + 16]!; rotations[index] = u16(view, offset + 17) / 100;
  }
  return { positions, heights, crowns, variants, rotations };
}

function decodeMeshes(raw: Uint8Array, metadata: SectionMetadata, origin: UnityOrigin): UnityMeshData[] {
  if (metadata.encoding !== 'mesh-position-u16-quantized-index-adaptive.v1' || metadata.vertex_stride_bytes !== 6 || !metadata.position_quantization || !metadata.meshes) {
    throw new Error('Maillage vectoriel Unity incompatible.');
  }
  const q = metadata.position_quantization; const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return metadata.meshes.map((mesh) => {
    const positions = new Float32Array(mesh.vertex_count * 3);
    for (let index = 0; index < mesh.vertex_count; index += 1) {
      const offset = mesh.vertex_offset_bytes + index * 6;
      positions[index * 3] = (q.east_minimum_m ?? 0) + u16(view, offset) * (q.east_step_m ?? 0) - origin[0];
      positions[index * 3 + 1] = (q.north_minimum_m ?? 0) + u16(view, offset + 2) * (q.north_step_m ?? 0) - origin[1];
      positions[index * 3 + 2] = (q.up_minimum_m ?? 0) + u16(view, offset + 4) * (q.up_step_m ?? 0);
    }
    const indices = new Uint32Array(mesh.triangle_count * 3);
    for (let index = 0; index < indices.length; index += 1) {
      const offset = mesh.index_offset_bytes + index * mesh.index_stride_bytes;
      indices[index] = mesh.index_stride_bytes === 2 ? u16(view, offset) : u32(view, offset);
    }
    return { name: mesh.name, positions, indices };
  });
}

export async function decodeUnityTile(buffer: ArrayBuffer, sharedOrigin: UnityOrigin, terrainStride = 1): Promise<UnityTileGeometry> {
  const { header, sections } = await decodeContainer(buffer);
  const section = (name: string) => {
    const raw = sections.get(name); const metadata = header.sections.find((item) => item.name === name)?.metadata;
    if (!raw || !metadata) throw new Error(`Section Unity ${name} absente.`);
    return { raw, metadata };
  };
  const terrain = section('terrain');
  const trees = sections.has('trees') ? section('trees') : undefined;
  const meshes = (name: string) => sections.has(name) ? decodeMeshes(section(name).raw, section(name).metadata, sharedOrigin) : [];
  return {
    tileId: header.tile_id,
    terrain: decodeTerrain(terrain.raw, terrain.metadata, sharedOrigin, terrainStride),
    trees: trees ? decodeTrees(trees.raw, trees.metadata, sharedOrigin) : {
      positions: new Float32Array(), heights: new Float32Array(), crowns: new Float32Array(), variants: new Uint8Array(), rotations: new Float32Array(),
    },
    buildings: meshes('buildings'), roads: meshes('roads'), water: meshes('water'),
  };
}
