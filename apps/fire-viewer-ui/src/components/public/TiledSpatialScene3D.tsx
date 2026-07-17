import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DirectionalLight,
  Frustum,
  Group,
  InstancedMesh,
  Line as ThreeLine,
  LineBasicMaterial,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Raycaster,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import CoordinateSystem from '@giro3d/giro3d/core/geographic/CoordinateSystem.js';
import Instance from '@giro3d/giro3d/core/Instance.js';
import proj4 from 'proj4';
import {
  assetPath,
  decodeUnityTile,
  parseUnitySpatialCatalog,
  type UnityAssetReference,
  type UnityBounds,
  type UnityCatalogTile,
  type UnityMeshData,
  type UnityOrigin,
  type UnitySpatialCatalog,
  type UnityTileGeometry,
} from '../../lib/unitySpatialTile';
import { terrainOcclusionProbeDistance } from '../../lib/spatialVisibility';

export interface TiledSceneSource {
  readonly catalogUrl: string;
  readonly files: Readonly<Record<string, string>>;
  readonly credentials?: RequestCredentials;
}

export interface TiledScenePoint { readonly position: readonly [number, number, number]; readonly color: string; }
export interface TiledSceneLine { readonly points: readonly (readonly [number, number, number])[]; readonly color: string; }
export type TiledSceneViewPreset = 'near' | 'local' | 'extended';

interface Runtime {
  readonly instance: Instance;
  readonly controls: MapControls;
  readonly overlays: Group;
  readonly origin: UnityOrigin;
  readonly catalog: UnitySpatialCatalog;
  readonly refreshDetails: () => void;
}

const LAMBERT93_WKT = `
PROJCS["RGF93 v1 / Lambert-93",GEOGCS["RGF93 v1",DATUM["Reseau_Geodesique_Francais_1993_v1",
SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],
PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["latitude_of_origin",46.5],PARAMETER["central_meridian",3],
PARAMETER["standard_parallel_1",49],PARAMETER["standard_parallel_2",44],PARAMETER["false_easting",700000],
PARAMETER["false_northing",6600000],UNIT["metre",1],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","2154"]]`;
const WORLD_UP = new Vector3(0, 0, 1);
const TREE_PALETTE = ['#274c2d', '#315c31', '#386534', '#1d442e', '#245037', '#2b5939'];
const NEAR_DETAIL_DISTANCE_MULTIPLIER = 1.3;
const DETAIL_LOAD_CONCURRENCY = 4;
const DETAIL_CACHE_LIMIT = 64;
const LOD_REFRESH_INTERVAL_MS = 80;
const CAMERA_TERRAIN_CLAMP_INTERVAL_MS = 80;
let lambert93: CoordinateSystem | null = null;

function coordinateSystem(): CoordinateSystem {
  if (!lambert93) {
    proj4.defs('EPSG:2154', LAMBERT93_WKT);
    lambert93 = CoordinateSystem.register('EPSG:2154', LAMBERT93_WKT, { throwIfFailedToRegisterWithProj: true });
  }
  return lambert93;
}

function disposeObject(root: Object3D): void {
  root.traverse((candidate) => {
    const mesh = candidate as Mesh;
    if (!mesh.geometry || !mesh.material) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
      (material as Material).dispose();
    }
  });
}

function geometry(data: UnityMeshData, withNormals = false): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute('position', new BufferAttribute(data.positions, 3));
  if (data.uv) result.setAttribute('uv', new BufferAttribute(data.uv, 2));
  result.setIndex(new BufferAttribute(data.indices, 1));
  if (withNormals) result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

function materialForSection(section: 'building' | 'road' | 'water', name: string): MeshLambertMaterial {
  let color = '#746b5c';
  if (section === 'road') color = name.includes('marking') ? '#c2b891' : name.includes('shoulder') ? '#615b51' : '#4d4f4d';
  if (section === 'water') color = name.includes('surface') ? '#194d66' : '#1f5a73';
  return new MeshLambertMaterial({ color, side: DoubleSide });
}

function meshSection(root: Group, data: readonly UnityMeshData[], section: 'building' | 'road' | 'water'): Mesh[] {
  const meshes: Mesh[] = [];
  for (const item of data) {
    const mesh = new Mesh(geometry(item, true), materialForSection(section, item.name));
    mesh.name = `${section}-${item.name}`;
    root.add(mesh); meshes.push(mesh);
  }
  return meshes;
}

function treeMeshes(data: UnityTileGeometry['trees']): Group {
  const root = new Group();
  root.name = 'Trees — detected crowns, operational LOD';
  const count = data.heights.length;
  if (!count) return root;
  const crownGeometry = new ConeGeometry(0.5, 1, 7, 2);
  crownGeometry.rotateX(Math.PI / 2);
  const trunkGeometry = new CylinderGeometry(0.06, 0.09, 0.56, 6);
  trunkGeometry.rotateX(Math.PI / 2);
  const crowns = new InstancedMesh(crownGeometry, new MeshLambertMaterial({ color: '#ffffff' }), count);
  const trunks = new InstancedMesh(trunkGeometry, new MeshLambertMaterial({ color: '#38291b' }), count);
  const matrix = new Matrix4(); const rotation = new Quaternion(); const position = new Vector3(); const scale = new Vector3();
  for (let index = 0; index < count; index += 1) {
    const x = data.positions[index * 3]!; const y = data.positions[index * 3 + 1]!; const z = data.positions[index * 3 + 2]!;
    const height = data.heights[index]!; const crown = Math.max(0.25, data.crowns[index]!);
    rotation.setFromAxisAngle(WORLD_UP, data.rotations[index]! * Math.PI / 180);
    position.set(x, y, z + height * 0.68); scale.set(crown, crown, height * 0.68);
    matrix.compose(position, rotation, scale); crowns.setMatrixAt(index, matrix);
    crowns.setColorAt(index, new Color(TREE_PALETTE[data.variants[index]! % TREE_PALETTE.length]));
    position.set(x, y, z + height * 0.28); scale.set(crown, crown, height);
    matrix.compose(position, rotation, scale); trunks.setMatrixAt(index, matrix);
  }
  crowns.instanceMatrix.needsUpdate = true; trunks.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  root.add(trunks, crowns);
  return root;
}

async function texture(url: string, credentials: RequestCredentials, signal: AbortSignal): Promise<Texture> {
  let source = url;
  let objectUrl: string | null = null;
  if (credentials !== 'omit') {
    const response = await fetch(url, { cache: 'force-cache', credentials, signal });
    if (!response.ok) throw new Error(`Texture Unity inaccessible (${response.status}).`);
    objectUrl = URL.createObjectURL(await response.blob());
    source = objectUrl;
  }
  let result: Texture;
  try {
    result = await new TextureLoader().loadAsync(source);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
  result.colorSpace = SRGBColorSpace;
  return result;
}

async function fetchAsset(url: string, reference: UnityAssetReference, credentials: RequestCredentials, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: 'force-cache', credentials, signal });
  if (!response.ok) throw new Error(`Asset Unity inaccessible (${response.status}).`);
  const result = await response.arrayBuffer();
  if (result.byteLength !== reference.byte_count) throw new Error(`Taille incohérente pour ${assetPath(reference)}.`);
  return result;
}

function resolveAsset(source: TiledSceneSource, reference: UnityAssetReference): string {
  const path = assetPath(reference);
  const explicit = source.files[path];
  if (!explicit) throw new Error(`Le manifeste public ne fournit pas ${path}.`);
  return explicit;
}

async function buildTile(
  source: TiledSceneSource,
  payload: UnityAssetReference,
  imagery: UnityAssetReference,
  origin: UnityOrigin,
  signal: AbortSignal,
  far = false,
): Promise<{ root: Group; terrain: Mesh; roads: readonly Mesh[] }> {
  const [buffer, image] = await Promise.all([
    fetchAsset(resolveAsset(source, payload), payload, source.credentials ?? 'omit', signal),
    texture(resolveAsset(source, imagery), source.credentials ?? 'omit', signal),
  ]);
  const decoded = await decodeUnityTile(buffer, origin, far ? 5 : 1);
  const root = new Group(); root.name = far ? 'Unity FAR terrain' : `Unity detail ${decoded.tileId}`;
  const terrain = new Mesh(geometry(decoded.terrain), new MeshBasicMaterial({
    map: image,
    side: DoubleSide,
    polygonOffset: !far,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }));
  terrain.name = far ? 'far-terrain' : `terrain-${decoded.tileId}`;
  root.add(terrain);
  let roads: readonly Mesh[] = [];
  if (!far) {
    meshSection(root, decoded.buildings, 'building');
    roads = meshSection(root, decoded.roads, 'road');
    meshSection(root, decoded.water, 'water');
    root.add(treeMeshes(decoded.trees));
  }
  return { root, terrain, roads };
}

function distanceToBounds(bounds: UnityBounds, east: number, north: number): number {
  const dx = east < bounds[0] ? bounds[0] - east : east > bounds[2] ? east - bounds[2] : 0;
  const dy = north < bounds[1] ? bounds[1] - north : north > bounds[3] ? north - bounds[3] : 0;
  return Math.hypot(dx, dy);
}

function cameraFrustum(camera: Instance['view']['camera']): Frustum {
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

function tileIntersectsCamera(
  frustum: Frustum,
  tile: UnityCatalogTile,
  origin: UnityOrigin,
  elevationRange: readonly [number, number],
): boolean {
  return frustum.intersectsBox(tileVolume(tile, origin, elevationRange));
}

function tileVolume(tile: UnityCatalogTile, origin: UnityOrigin, elevationRange: readonly [number, number]): Box3 {
  return new Box3(
    new Vector3(tile.bounds_l93_m[0] - origin[0], tile.bounds_l93_m[1] - origin[1], elevationRange[0]),
    new Vector3(tile.bounds_l93_m[2] - origin[0], tile.bounds_l93_m[3] - origin[1], elevationRange[1] + 80),
  );
}

interface RoadSnap { readonly point: Vector3; readonly direction: Vector3; }

function roadDirection(mesh: Mesh, indexes: readonly number[]): Vector3 {
  const positions = mesh.geometry.getAttribute('position') as BufferAttribute;
  let best = new Vector3(0, 1, 0); let bestSquared = 0;
  for (let left = 0; left < indexes.length; left += 1) for (let right = left + 1; right < indexes.length; right += 1) {
    const dx = positions.getX(indexes[right]!) - positions.getX(indexes[left]!);
    const dy = positions.getY(indexes[right]!) - positions.getY(indexes[left]!);
    const squared = dx * dx + dy * dy;
    if (squared > bestSquared) { bestSquared = squared; best = new Vector3(dx, dy, 0).normalize(); }
  }
  return best;
}

function nearestRoadPoint(target: Vector3, roads: readonly Mesh[], maximumDistance = Number.POSITIVE_INFINITY): RoadSnap | null {
  const visibleRoads = roads.filter((mesh) => mesh.parent?.visible);
  if (!visibleRoads.length) return null;
  const ray = new Raycaster(new Vector3(target.x, target.y, target.z + 10_000), new Vector3(0, 0, -1));
  const direct = ray.intersectObjects(visibleRoads, false)[0];
  if (direct) {
    const mesh = direct.object as Mesh; const face = direct.face;
    return { point: direct.point, direction: face ? roadDirection(mesh, [face.a, face.b, face.c]) : new Vector3(0, 1, 0) };
  }
  let bestSquared = maximumDistance * maximumDistance;
  let best: { point: Vector3; mesh: Mesh; vertex: number } | null = null;
  for (const mesh of visibleRoads) {
    const positions = mesh.geometry.getAttribute('position') as BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const dx = positions.getX(index) - target.x; const dy = positions.getY(index) - target.y;
      const squared = dx * dx + dy * dy;
      if (squared < bestSquared) { bestSquared = squared; best = { point: new Vector3(positions.getX(index), positions.getY(index), positions.getZ(index)), mesh, vertex: index }; }
    }
  }
  if (!best) return null;
  const index = best.mesh.geometry.index;
  if (!index) return { point: best.point, direction: new Vector3(0, 1, 0) };
  for (let offset = 0; offset < index.count; offset += 3) {
    const triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    if (triangle.includes(best.vertex)) return { point: best.point, direction: roadDirection(best.mesh, triangle) };
  }
  return { point: best.point, direction: new Vector3(0, 1, 0) };
}

function terrainPointAt(target: Vector3, terrains: readonly Mesh[]): Vector3 | null {
  const ray = new Raycaster(new Vector3(target.x, target.y, target.z + 10_000), new Vector3(0, 0, -1));
  return ray.intersectObjects(terrains.filter((mesh) => mesh.parent?.visible), false)[0]?.point ?? null;
}

function overlayWorld(origin: UnityOrigin, point: readonly [number, number, number], lift = 2): Vector3 {
  void origin;
  return new Vector3(point[0], point[2], point[1] + lift);
}

function redrawOverlays(runtime: Runtime, points: readonly TiledScenePoint[], lines: readonly TiledSceneLine[]): void {
  disposeObject(runtime.overlays); runtime.overlays.clear();
  for (const item of points) {
    const marker = new Mesh(new SphereGeometry(10, 14, 10), new MeshBasicMaterial({ color: item.color, depthTest: false }));
    marker.position.copy(overlayWorld(runtime.origin, item.position, 8)); marker.renderOrder = 20; runtime.overlays.add(marker);
  }
  for (const item of lines) {
    if (item.points.length < 2) continue;
    const line = new ThreeLine(
      new BufferGeometry().setFromPoints(item.points.map((point) => overlayWorld(runtime.origin, point, 5))),
      new LineBasicMaterial({ color: item.color, depthTest: false, transparent: true, opacity: 0.96 }),
    );
    line.renderOrder = 19; runtime.overlays.add(line);
  }
  runtime.instance.notifyChange(runtime.overlays);
}

function frameCamera(runtime: Runtime, preset: TiledSceneViewPreset, focus?: readonly [number, number]): void {
  const bounds = runtime.catalog.lod_policy.far.bounds_l93_m;
  const absoluteCentre: readonly [number, number] = focus ?? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const centre: readonly [number, number] = [absoluteCentre[0] - runtime.origin[0], absoluteCentre[1] - runtime.origin[1]];
  const span = Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  const distance = preset === 'near' ? 680 : preset === 'local' ? 2_650 : Math.max(12_000, span * 0.9);
  const targetZ = 250;
  runtime.controls.target.set(centre[0], centre[1], targetZ);
  runtime.instance.view.camera.up.copy(WORLD_UP);
  runtime.instance.view.camera.position.set(centre[0] + distance * 0.62, centre[1] - distance * 0.72, targetZ + distance * 0.62);
  runtime.controls.maxDistance = span * 2.5; runtime.controls.update();
  runtime.instance.notifyChange(runtime.instance.view.camera);
}

export function TiledSpatialScene3D({
  source,
  overlayOriginWgs84,
  onPick,
  drawMode = false,
  cameraMode = 'orbit',
  viewPreset = 'near',
  overlayPoints = [],
  overlayLines = [],
}: {
  readonly source: TiledSceneSource;
  readonly overlayOriginWgs84?: readonly [number, number, number];
  readonly onPick?: (point: readonly [number, number, number]) => void;
  readonly drawMode?: boolean;
  readonly cameraMode?: 'orbit' | 'fps';
  readonly viewPreset?: TiledSceneViewPreset;
  readonly overlayPoints?: readonly TiledScenePoint[];
  readonly overlayLines?: readonly TiledSceneLine[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [detailLodEnabled, setDetailLodEnabled] = useState(true);
  const propsRef = useRef({ overlayPoints, overlayLines, onPick, drawMode, cameraMode, detailLodEnabled, viewPreset });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [detailState, setDetailState] = useState({ active: 0, expected: 0, failures: 0 });
  propsRef.current = { overlayPoints, overlayLines, onPick, drawMode, cameraMode, detailLodEnabled, viewPreset };

  useEffect(() => { const runtime = runtimeRef.current; if (runtime) redrawOverlays(runtime, overlayPoints, overlayLines); }, [overlayPoints, overlayLines]);
  useEffect(() => { const runtime = runtimeRef.current; if (runtime) frameCamera(runtime, viewPreset); }, [viewPreset]);
  useEffect(() => { runtimeRef.current?.refreshDetails(); }, [detailLodEnabled]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof WebGLRenderingContext === 'undefined') { setStatus('error'); return undefined; }
    const abortController = new AbortController(); let disposed = false; let animationFrame = 0; let refreshTimer: number | null = null;
    let instance: Instance | null = null; let controls: MapControls | null = null; let farRoot: Group | null = null; let farTerrain: Mesh | null = null; let catalog: UnitySpatialCatalog | null = null;
    const details = new Map<string, Group>(); const pending = new Map<string, Promise<void>>(); const failed = new Set<string>();
    const terrainMeshes: Mesh[] = []; const roadMeshes: Mesh[] = []; let terrainElevationRange: readonly [number, number] = [-1_000, 5_000];
    const tileSightPoints = new Map<string, readonly Vector3[]>();
    let desiredIds = new Set<string>(); let desiredTiles: readonly UnityCatalogTile[] = []; const pressed = new Set<string>();
    let mode: 'orbit' | 'fps' = 'orbit'; let fpsAnchoredToRoad = false; let yaw = 0; let pitch = -0.15; let previousFrame = performance.now(); let previousTerrainClamp = 0; let pointerDown: readonly [number, number] | null = null;

    const updateState = () => setDetailState({ active: [...desiredIds].filter((id) => details.get(id)?.visible).length, expected: desiredIds.size, failures: failed.size });
    const sightPointsFor = (tile: UnityCatalogTile): readonly Vector3[] => {
      const cached = tileSightPoints.get(tile.id);
      if (cached) return cached;
      if (!farTerrain || !catalog) return [];
      farTerrain.updateWorldMatrix(true, false);
      const [west, south, east, north] = tile.bounds_l93_m;
      const inset = Math.min(5, (east - west) * 0.02, (north - south) * 0.02);
      const samples = [
        [(west + east) / 2, (south + north) / 2],
        [west + inset, south + inset], [west + inset, north - inset],
        [east - inset, south + inset], [east - inset, north - inset],
      ] as const;
      const points = samples.flatMap(([sampleEast, sampleNorth]) => {
        const ray = new Raycaster(
          new Vector3(sampleEast - catalog!.origin_l93_m[0], sampleNorth - catalog!.origin_l93_m[1], terrainElevationRange[1] + 2_000),
          new Vector3(0, 0, -1),
        );
        const ground = ray.intersectObject(farTerrain!, false)[0]?.point;
        return ground ? [ground.clone().addScaledVector(WORLD_UP, 8)] : [];
      });
      tileSightPoints.set(tile.id, points); return points;
    };
    const tileHasTerrainLineOfSight = (tile: UnityCatalogTile): boolean => {
      if (!farTerrain || !instance) return true;
      const points = sightPointsFor(tile);
      if (!points.length) return true;
      return points.some((point) => {
        const direction = point.clone().sub(instance!.view.camera.position);
        const probeDistance = terrainOcclusionProbeDistance(
          instance!.view.camera.position,
          point,
          tileVolume(tile, catalog!.origin_l93_m, terrainElevationRange),
        );
        if (probeDistance <= 0.5) return true;
        const ray = new Raycaster(instance!.view.camera.position, direction.normalize(), 0.5, probeDistance);
        return ray.intersectObject(farTerrain!, false).length === 0;
      });
    };
    const publish = () => {
      if (!farRoot) return;
      farRoot.visible = true;
      for (const [id, root] of details) root.visible = desiredIds.has(id);
      updateState(); instance?.notifyChange(instance.view.camera);
    };
    const fillDetailCapacity = () => {
      if (!catalog || !instance || !controls || disposed) return;
      let capacity = DETAIL_LOAD_CONCURRENCY - pending.size;
      for (const tile of desiredTiles) {
        if (capacity <= 0) break;
        if (details.has(tile.id) || pending.has(tile.id) || failed.has(tile.id)) continue;
        capacity -= 1;
        const loading = buildTile(source, tile.payload, tile.imagery, catalog.origin_l93_m, abortController.signal).then(async ({ root, terrain, roads }) => {
          if (disposed || !instance) { disposeObject(root); return; }
          root.visible = false; await instance.add(root); details.set(tile.id, root); terrainMeshes.push(terrain); roadMeshes.push(...roads); publish();
        }).catch((error: unknown) => { if (!disposed && !abortController.signal.aborted) { console.error(error); failed.add(tile.id); } }).finally(() => {
          pending.delete(tile.id); if (!disposed) { updateState(); window.setTimeout(fillDetailCapacity, 0); }
        });
        pending.set(tile.id, loading);
      }
      updateState();
    };
    const selectDetails = (east: number, north: number) => {
      if (!catalog || !instance || !controls || disposed) return;
      const absoluteEast = east + catalog.origin_l93_m[0];
      const absoluteNorth = north + catalog.origin_l93_m[1];
      const frustum = cameraFrustum(instance.view.camera);
      const nearDetailDistance = catalog.lod_policy.detail.publish_distance_m * NEAR_DETAIL_DISTANCE_MULTIPLIER;
      desiredTiles = propsRef.current.detailLodEnabled ? catalog.tiles
        .filter((tile) => tileIntersectsCamera(frustum, tile, catalog!.origin_l93_m, terrainElevationRange))
        .map((tile) => ({ tile, distance: tileVolume(tile, catalog!.origin_l93_m, terrainElevationRange).distanceToPoint(instance!.view.camera.position) }))
        .filter((entry) => entry.distance <= nearDetailDistance)
        .filter((entry) => tileHasTerrainLineOfSight(entry.tile))
        .sort((left, right) => left.distance - right.distance || left.tile.id.localeCompare(right.tile.id))
        .map((entry) => entry.tile) : [];
      desiredIds = new Set(desiredTiles.map((tile) => tile.id)); publish();
      const cachedOutsideView = [...details.entries()]
        .filter(([id]) => !desiredIds.has(id))
        .map(([id, root]) => {
          const tile = catalog?.tiles.find((candidate) => candidate.id === id);
          return { id, root, distance: tile ? distanceToBounds(tile.bounds_l93_m, absoluteEast, absoluteNorth) : Number.POSITIVE_INFINITY };
        })
        .sort((left, right) => right.distance - left.distance);
      for (const { id, root } of cachedOutsideView.slice(0, Math.max(0, details.size - DETAIL_CACHE_LIMIT))) {
        root.traverse((candidate) => {
          const index = terrainMeshes.indexOf(candidate as Mesh);
          if (index >= 0) terrainMeshes.splice(index, 1);
          const roadIndex = roadMeshes.indexOf(candidate as Mesh);
          if (roadIndex >= 0) roadMeshes.splice(roadIndex, 1);
        });
        instance.remove(root); disposeObject(root); details.delete(id);
      }
      fillDetailCapacity();
    };
    const scheduleRefresh = () => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null; if (!instance || !controls) return;
        const focus = mode === 'fps' ? instance.view.camera.position : controls.target; selectDetails(focus.x, focus.y);
      }, LOD_REFRESH_INTERVAL_MS);
    };
    const orientFps = () => {
      if (!instance) return;
      const direction = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch));
      instance.view.camera.up.copy(WORLD_UP); instance.view.camera.lookAt(instance.view.camera.position.clone().add(direction));
    };
    const placeFpsOnRoad = (target: Vector3) => {
      if (!instance) return false;
      const road = nearestRoadPoint(target, roadMeshes);
      if (!road) return false;
      const ground = terrainPointAt(road.point, terrainMeshes) ?? road.point;
      instance.view.camera.position.set(road.point.x, road.point.y, ground.z + 1.7);
      yaw = Math.atan2(road.direction.x, road.direction.y); fpsAnchoredToRoad = true; orientFps(); scheduleRefresh();
      return true;
    };
    const keepCameraAboveTerrain = (now: number) => {
      if (!instance || now - previousTerrainClamp < CAMERA_TERRAIN_CLAMP_INTERVAL_MS) return false;
      previousTerrainClamp = now;
      const camera = instance.view.camera;
      const ray = new Raycaster(
        new Vector3(camera.position.x, camera.position.y, terrainElevationRange[1] + 2_000),
        new Vector3(0, 0, -1),
      );
      const ground = ray.intersectObjects(terrainMeshes.filter((mesh) => mesh.parent?.visible), false)[0]?.point;
      if (!ground) return false;
      const clearance = mode === 'fps' ? 1.7 : 2;
      if (camera.position.z >= ground.z + clearance) return false;
      camera.position.z = ground.z + clearance; instance.notifyChange(camera); return true;
    };
    const animate = (now = performance.now()) => {
      const delta = Math.min((now - previousFrame) / 1_000, 0.05); previousFrame = now;
      const requested = propsRef.current.cameraMode;
      if (requested !== mode) {
        mode = requested;
        if (mode === 'fps' && instance && controls) {
          host.focus({ preventScroll: true });
          const forward = instance.view.camera.getWorldDirection(new Vector3());
          forward.z = 0;
          if (forward.lengthSq() < 0.001) forward.set(0, 1, 0);
          forward.normalize();
          yaw = Math.atan2(forward.x, forward.y); pitch = 0; fpsAnchoredToRoad = false;
          placeFpsOnRoad(controls.target);
        } else {
          fpsAnchoredToRoad = false;
          if (document.pointerLockElement) document.exitPointerLock();
        }
      }
      if (controls) controls.enabled = mode === 'orbit';
      if (instance && mode === 'fps') {
        if (!fpsAnchoredToRoad && controls) placeFpsOnRoad(controls.target);
        const speed = (pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 14 : 6) * delta;
        if (pressed.has('ArrowLeft')) yaw += 1.2 * delta; if (pressed.has('ArrowRight')) yaw -= 1.2 * delta;
        if (pressed.has('ArrowUp')) pitch = Math.min(1.45, pitch + 0.9 * delta); if (pressed.has('ArrowDown')) pitch = Math.max(-1.45, pitch - 0.9 * delta);
        const forward = new Vector3(Math.sin(yaw), Math.cos(yaw), 0); const right = new Vector3(Math.cos(yaw), -Math.sin(yaw), 0);
        const movement = new Vector3();
        if (pressed.has('KeyW') || pressed.has('KeyZ')) movement.addScaledVector(forward, speed);
        if (pressed.has('KeyS')) movement.addScaledVector(forward, -speed);
        if (pressed.has('KeyA') || pressed.has('KeyQ')) movement.addScaledVector(right, -speed);
        if (pressed.has('KeyD')) movement.addScaledVector(right, speed);
        if (movement.lengthSq() > 0 && fpsAnchoredToRoad) {
          const road = nearestRoadPoint(instance.view.camera.position.clone().add(movement), roadMeshes, 35);
          if (road) {
            const ground = terrainPointAt(road.point, terrainMeshes) ?? road.point;
            instance.view.camera.position.set(road.point.x, road.point.y, ground.z + 1.7);
          }
        }
        orientFps(); instance.notifyChange(instance.view.camera); scheduleRefresh();
      }
      if (keepCameraAboveTerrain(now) && mode === 'fps') orientFps();
      animationFrame = requestAnimationFrame(animate);
    };
    const keyDown = (event: KeyboardEvent) => { if (propsRef.current.cameraMode === 'fps') { pressed.add(event.code); if (event.code.startsWith('Arrow')) event.preventDefault(); } };
    const keyUp = (event: KeyboardEvent) => pressed.delete(event.code);
    const mouseMove = (event: MouseEvent) => {
      if (propsRef.current.cameraMode !== 'fps' || document.pointerLockElement !== instance?.domElement) return;
      yaw -= event.movementX * 0.0022; pitch = Math.max(-1.45, Math.min(1.45, pitch - event.movementY * 0.0022));
    };
    const pointerDownHandler = (event: PointerEvent) => { host.focus(); pointerDown = [event.clientX, event.clientY]; };
    const pointerUpHandler = (event: PointerEvent) => {
      if (!instance || !catalog || !pointerDown) return;
      const movement = Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]); pointerDown = null;
      if (propsRef.current.drawMode && propsRef.current.onPick && movement <= 5) {
        const bounds = instance.domElement.getBoundingClientRect(); const pointer = new Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
        const ray = new Raycaster(); ray.setFromCamera(pointer, instance.view.camera);
        const hit = ray.intersectObjects(terrainMeshes.filter((mesh) => mesh.parent?.visible), false)[0];
        if (hit) propsRef.current.onPick([hit.point.x - catalog.origin_l93_m[0], hit.point.z - catalog.origin_l93_m[2], hit.point.y - catalog.origin_l93_m[1]]);
      } else if (propsRef.current.cameraMode === 'fps' && movement <= 5) void instance.domElement.requestPointerLock();
    };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); document.addEventListener('mousemove', mouseMove); animate();

    const mount = async () => {
      try {
        const response = await fetch(source.catalogUrl, { cache: 'no-store', credentials: source.credentials ?? 'omit', signal: abortController.signal });
        if (!response.ok) throw new Error(`Catalogue Unity inaccessible (${response.status}).`);
        catalog = parseUnitySpatialCatalog(await response.json());
        instance = new Instance({ target: host, crs: coordinateSystem(), backgroundColor: '#102429' });
        instance.renderer.toneMapping = ACESFilmicToneMapping;
        instance.renderer.toneMappingExposure = 0.82;
        instance.view.camera.up.copy(WORLD_UP);
        controls = new MapControls(instance.view.camera, instance.domElement); controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = false; controls.minDistance = 5; controls.zoomSpeed = 1.35;
        instance.view.setControls(controls); controls.addEventListener('change', scheduleRefresh);
        instance.domElement.addEventListener('pointerdown', pointerDownHandler); instance.domElement.addEventListener('pointerup', pointerUpHandler);
        const lighting = new Group(); lighting.name = 'Unity directional lighting';
        lighting.add(new AmbientLight('#dce5e1', 1.15));
        const sun = new DirectionalLight('#fff0d5', 1.8); sun.position.set(3_500, -2_500, 8_000); lighting.add(sun);
        await instance.add(lighting);
        const far = await buildTile(source, catalog.lod_policy.far.terrain, catalog.lod_policy.far.imagery, catalog.origin_l93_m, abortController.signal, true);
        if (disposed) { disposeObject(far.root); return; }
        const farBounds = far.terrain.geometry.boundingBox;
        if (farBounds) terrainElevationRange = [farBounds.min.z, farBounds.max.z];
        farRoot = far.root; farRoot.position.z = -3; farTerrain = far.terrain; terrainMeshes.push(far.terrain); await instance.add(farRoot);
        const overlays = new Group(); overlays.name = 'admin-spatial-overlays'; await instance.add(overlays);
        const runtime: Runtime = { instance, controls, overlays, origin: catalog.origin_l93_m, catalog, refreshDetails: scheduleRefresh };
        runtimeRef.current = runtime; redrawOverlays(runtime, propsRef.current.overlayPoints, propsRef.current.overlayLines);
        let focus: readonly [number, number] | undefined;
        if (overlayOriginWgs84) focus = proj4('EPSG:4326', 'EPSG:2154', [overlayOriginWgs84[0], overlayOriginWgs84[1]]) as [number, number];
        frameCamera(runtime, propsRef.current.viewPreset, focus); scheduleRefresh(); setStatus('ready');
      } catch (error) {
        if (!disposed && !abortController.signal.aborted) { console.error(error); setStatus('error'); }
      }
    };
    void mount();
    return () => {
      disposed = true; abortController.abort(); runtimeRef.current = null; cancelAnimationFrame(animationFrame); if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      if (document.pointerLockElement === instance?.domElement) document.exitPointerLock();
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); document.removeEventListener('mousemove', mouseMove);
      if (controls) controls.removeEventListener('change', scheduleRefresh);
      if (instance) { instance.domElement.removeEventListener('pointerdown', pointerDownHandler); instance.domElement.removeEventListener('pointerup', pointerUpHandler); }
      controls?.dispose(); for (const root of details.values()) disposeObject(root); if (farRoot) disposeObject(farRoot); instance?.dispose();
    };
  }, [source.catalogUrl, source.credentials, source.files, overlayOriginWgs84]);

  const statusText = status === 'error' ? 'Scène Unity indisponible' : status === 'loading' ? 'Chargement de la scène Unity…' : !detailLodEnabled ? 'Scène Unity prête · FAR seul · LOD détaillé désactivé' : `Scène Unity prête · ${detailState.active}/${detailState.expected} tuiles détaillées${detailState.failures ? ` · ${detailState.failures} échec(s)` : ''}`;
  return <div className={`incident-tiled-scene ${drawMode ? 'is-drawing' : ''}`}>
    <div ref={hostRef} className="incident-tiled-scene__canvas" tabIndex={0} aria-label={cameraMode === 'fps' ? 'Scène Unity en vue FPS piétonne contrainte aux routes et chemins. Cliquez pour activer la souris et utilisez ZQSD ou WASD.' : 'Scène 3D Unity FireViewer en vue orbitale.'} />
    <button type="button" className="incident-tiled-scene__lod-toggle" aria-pressed={detailLodEnabled} onClick={() => setDetailLodEnabled((enabled) => !enabled)}>{detailLodEnabled ? 'Désactiver le LOD' : 'Activer le LOD'}</button>
    <span className={`incident-tiled-scene__status is-${status}`} role="status">{statusText}</span>
  </div>;
}
