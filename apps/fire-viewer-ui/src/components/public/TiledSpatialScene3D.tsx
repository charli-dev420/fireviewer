import { useEffect, useRef, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Line as ThreeLine,
  LineBasicMaterial,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
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
  type UnityMeshData,
  type UnityOrigin,
  type UnitySpatialCatalog,
  type UnityTileGeometry,
} from '../../lib/unitySpatialTile';

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
}

const LAMBERT93_WKT = `
PROJCS["RGF93 v1 / Lambert-93",GEOGCS["RGF93 v1",DATUM["Reseau_Geodesique_Francais_1993_v1",
SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],
PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["latitude_of_origin",46.5],PARAMETER["central_meridian",3],
PARAMETER["standard_parallel_1",49],PARAMETER["standard_parallel_2",44],PARAMETER["false_easting",700000],
PARAMETER["false_northing",6600000],UNIT["metre",1],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","2154"]]`;
const WORLD_UP = new Vector3(0, 0, 1);
const TREE_PALETTE = ['#274c2d', '#315c31', '#386534', '#1d442e', '#245037', '#2b5939'];
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

function geometry(data: UnityMeshData): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute('position', new BufferAttribute(data.positions, 3));
  if (data.uv) result.setAttribute('uv', new BufferAttribute(data.uv, 2));
  result.setIndex(new BufferAttribute(data.indices, 1));
  result.computeBoundingSphere();
  return result;
}

function materialForSection(section: 'building' | 'road' | 'water', name: string): MeshBasicMaterial {
  let color = '#9d8f79';
  if (section === 'road') color = name.includes('marking') ? '#c2b891' : name.includes('shoulder') ? '#615b51' : '#4d4f4d';
  if (section === 'water') color = name.includes('surface') ? '#194d66' : '#1f5a73';
  return new MeshBasicMaterial({ color, side: DoubleSide });
}

function meshSection(root: Group, data: readonly UnityMeshData[], section: 'building' | 'road' | 'water'): void {
  for (const item of data) {
    const mesh = new Mesh(geometry(item), materialForSection(section, item.name));
    mesh.name = `${section}-${item.name}`;
    root.add(mesh);
  }
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
  const crowns = new InstancedMesh(crownGeometry, new MeshBasicMaterial({ color: '#ffffff' }), count);
  const trunks = new InstancedMesh(trunkGeometry, new MeshBasicMaterial({ color: '#38291b' }), count);
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
): Promise<{ root: Group; terrain: Mesh }> {
  const [buffer, image] = await Promise.all([
    fetchAsset(resolveAsset(source, payload), payload, source.credentials ?? 'omit', signal),
    texture(resolveAsset(source, imagery), source.credentials ?? 'omit', signal),
  ]);
  const decoded = await decodeUnityTile(buffer, origin, far ? 5 : 1);
  const root = new Group(); root.name = far ? 'Unity FAR terrain' : `Unity detail ${decoded.tileId}`;
  root.position.set(origin[0], origin[1], origin[2]);
  const terrain = new Mesh(geometry(decoded.terrain), new MeshBasicMaterial({ map: image, side: DoubleSide }));
  terrain.name = far ? 'far-terrain' : `terrain-${decoded.tileId}`;
  root.add(terrain);
  if (!far) {
    meshSection(root, decoded.buildings, 'building');
    meshSection(root, decoded.roads, 'road');
    meshSection(root, decoded.water, 'water');
    root.add(treeMeshes(decoded.trees));
  }
  return { root, terrain };
}

function distanceToBounds(bounds: UnityBounds, east: number, north: number): number {
  const dx = east < bounds[0] ? bounds[0] - east : east > bounds[2] ? east - bounds[2] : 0;
  const dy = north < bounds[1] ? bounds[1] - north : north > bounds[3] ? north - bounds[3] : 0;
  return Math.hypot(dx, dy);
}

function overlayWorld(origin: UnityOrigin, point: readonly [number, number, number], lift = 2): Vector3 {
  return new Vector3(origin[0] + point[0], origin[1] + point[2], origin[2] + point[1] + lift);
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
  const centre: readonly [number, number] = focus ?? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const span = Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  const distance = preset === 'near' ? 680 : preset === 'local' ? 2_650 : Math.max(12_000, span * 0.9);
  const targetZ = runtime.origin[2] + 250;
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
  const propsRef = useRef({ overlayPoints, overlayLines, onPick, drawMode, cameraMode, viewPreset });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [detailState, setDetailState] = useState({ active: 0, expected: 0, failures: 0 });
  propsRef.current = { overlayPoints, overlayLines, onPick, drawMode, cameraMode, viewPreset };

  useEffect(() => { const runtime = runtimeRef.current; if (runtime) redrawOverlays(runtime, overlayPoints, overlayLines); }, [overlayPoints, overlayLines]);
  useEffect(() => { const runtime = runtimeRef.current; if (runtime) frameCamera(runtime, viewPreset); }, [viewPreset]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof WebGLRenderingContext === 'undefined') { setStatus('error'); return undefined; }
    const abortController = new AbortController(); let disposed = false; let animationFrame = 0; let refreshTimer: number | null = null;
    let instance: Instance | null = null; let controls: MapControls | null = null; let farRoot: Group | null = null; let catalog: UnitySpatialCatalog | null = null;
    const details = new Map<string, Group>(); const pending = new Map<string, Promise<void>>(); const failed = new Set<string>();
    const terrainMeshes: Mesh[] = []; let desiredIds = new Set<string>(); const pressed = new Set<string>();
    let mode: 'orbit' | 'fps' = 'orbit'; let yaw = 0; let pitch = -0.15; let previousFrame = performance.now(); let pointerDown: readonly [number, number] | null = null;

    const updateState = () => setDetailState({ active: [...desiredIds].filter((id) => details.get(id)?.visible).length, expected: desiredIds.size, failures: failed.size });
    const publish = () => {
      if (!farRoot) return;
      const complete = desiredIds.size > 0 && [...desiredIds].every((id) => details.has(id));
      farRoot.visible = !complete;
      for (const [id, root] of details) root.visible = complete && desiredIds.has(id);
      updateState(); instance?.notifyChange(instance.view.camera);
    };
    const selectDetails = (east: number, north: number) => {
      if (!catalog || !instance || !controls || disposed) return;
      const distance = instance.view.camera.position.distanceTo(controls.target);
      const wanted = distance > 3_000 ? [] : catalog.tiles
        .map((tile) => ({ tile, distance: distanceToBounds(tile.bounds_l93_m, east, north) }))
        .filter((entry) => entry.distance <= catalog!.lod_policy.detail.preload_radius_m)
        .sort((left, right) => left.distance - right.distance || left.tile.id.localeCompare(right.tile.id))
        .slice(0, catalog.lod_policy.detail.maximum_resident_tile_count)
        .map((entry) => entry.tile);
      desiredIds = new Set(wanted.map((tile) => tile.id)); publish();
      for (const [id, root] of details) if (!desiredIds.has(id)) { instance.remove(root); disposeObject(root); details.delete(id); }
      let capacity = 2 - pending.size;
      for (const tile of wanted) {
        if (capacity <= 0) break;
        if (details.has(tile.id) || pending.has(tile.id) || failed.has(tile.id)) continue;
        capacity -= 1;
        const loading = buildTile(source, tile.payload, tile.imagery, catalog.origin_l93_m, abortController.signal).then(async ({ root, terrain }) => {
          if (disposed || !desiredIds.has(tile.id) || !instance) { disposeObject(root); return; }
          root.visible = false; await instance.add(root); details.set(tile.id, root); terrainMeshes.push(terrain); publish();
        }).catch((error: unknown) => { if (!disposed && !abortController.signal.aborted) { console.error(error); failed.add(tile.id); } }).finally(() => {
          pending.delete(tile.id); if (!disposed) { updateState(); window.setTimeout(() => selectDetails(east, north), 0); }
        });
        pending.set(tile.id, loading);
      }
      updateState();
    };
    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null; if (!instance || !controls) return;
        const focus = mode === 'fps' ? instance.view.camera.position : controls.target; selectDetails(focus.x, focus.y);
      }, 120);
    };
    const orientFps = () => {
      if (!instance) return;
      const direction = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch));
      instance.view.camera.up.copy(WORLD_UP); instance.view.camera.lookAt(instance.view.camera.position.clone().add(direction));
    };
    const animate = (now = performance.now()) => {
      const delta = Math.min((now - previousFrame) / 1_000, 0.05); previousFrame = now;
      const requested = propsRef.current.cameraMode;
      if (requested !== mode) {
        mode = requested;
        if (mode === 'fps' && instance) { const direction = instance.view.camera.getWorldDirection(new Vector3()); yaw = Math.atan2(direction.x, direction.y); pitch = Math.asin(direction.z); }
        else if (document.pointerLockElement) document.exitPointerLock();
      }
      if (controls) controls.enabled = mode === 'orbit';
      if (instance && mode === 'fps') {
        const speed = (pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 1_100 : 380) * delta;
        if (pressed.has('ArrowLeft')) yaw += 1.2 * delta; if (pressed.has('ArrowRight')) yaw -= 1.2 * delta;
        if (pressed.has('ArrowUp')) pitch = Math.min(1.45, pitch + 0.9 * delta); if (pressed.has('ArrowDown')) pitch = Math.max(-1.45, pitch - 0.9 * delta);
        const forward = new Vector3(Math.sin(yaw), Math.cos(yaw), 0); const right = new Vector3(Math.cos(yaw), -Math.sin(yaw), 0);
        if (pressed.has('KeyW') || pressed.has('KeyZ')) instance.view.camera.position.addScaledVector(forward, speed);
        if (pressed.has('KeyS')) instance.view.camera.position.addScaledVector(forward, -speed);
        if (pressed.has('KeyA') || pressed.has('KeyQ')) instance.view.camera.position.addScaledVector(right, -speed);
        if (pressed.has('KeyD')) instance.view.camera.position.addScaledVector(right, speed);
        if (pressed.has('KeyE') || pressed.has('PageUp')) instance.view.camera.position.z += speed;
        if (pressed.has('KeyC') || pressed.has('PageDown')) instance.view.camera.position.z -= speed;
        orientFps(); instance.notifyChange(instance.view.camera); scheduleRefresh();
      }
      animationFrame = requestAnimationFrame(animate);
    };
    const keyDown = (event: KeyboardEvent) => { if (propsRef.current.cameraMode === 'fps') { pressed.add(event.code); if (event.code.startsWith('Arrow') || event.code.startsWith('Page')) event.preventDefault(); } };
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
    host.addEventListener('keydown', keyDown); host.addEventListener('keyup', keyUp); document.addEventListener('mousemove', mouseMove); animate();

    const mount = async () => {
      try {
        const response = await fetch(source.catalogUrl, { cache: 'no-store', credentials: source.credentials ?? 'omit', signal: abortController.signal });
        if (!response.ok) throw new Error(`Catalogue Unity inaccessible (${response.status}).`);
        catalog = parseUnitySpatialCatalog(await response.json());
        instance = new Instance({ target: host, crs: coordinateSystem(), backgroundColor: '#102429' });
        instance.view.camera.up.copy(WORLD_UP);
        controls = new MapControls(instance.view.camera, instance.domElement); controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = false; controls.minDistance = 40;
        instance.view.setControls(controls); controls.addEventListener('change', scheduleRefresh);
        instance.domElement.addEventListener('pointerdown', pointerDownHandler); instance.domElement.addEventListener('pointerup', pointerUpHandler);
        const far = await buildTile(source, catalog.lod_policy.far.terrain, catalog.lod_policy.far.imagery, catalog.origin_l93_m, abortController.signal, true);
        if (disposed) { disposeObject(far.root); return; }
        farRoot = far.root; terrainMeshes.push(far.terrain); await instance.add(farRoot);
        const overlays = new Group(); overlays.name = 'admin-spatial-overlays'; await instance.add(overlays);
        const runtime: Runtime = { instance, controls, overlays, origin: catalog.origin_l93_m, catalog };
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
      host.removeEventListener('keydown', keyDown); host.removeEventListener('keyup', keyUp); document.removeEventListener('mousemove', mouseMove);
      if (controls) controls.removeEventListener('change', scheduleRefresh);
      if (instance) { instance.domElement.removeEventListener('pointerdown', pointerDownHandler); instance.domElement.removeEventListener('pointerup', pointerUpHandler); }
      controls?.dispose(); for (const root of details.values()) disposeObject(root); if (farRoot) disposeObject(farRoot); instance?.dispose();
    };
  }, [source.catalogUrl, source.credentials, source.files, overlayOriginWgs84]);

  const statusText = status === 'error' ? 'Scène Unity indisponible' : status === 'loading' ? 'Chargement de la scène Unity…' : `Scène Unity prête · ${detailState.active}/${detailState.expected} tuiles détaillées${detailState.failures ? ` · ${detailState.failures} échec(s)` : ''}`;
  return <div className={`incident-tiled-scene ${drawMode ? 'is-drawing' : ''}`}>
    <div ref={hostRef} className="incident-tiled-scene__canvas" tabIndex={0} aria-label={cameraMode === 'fps' ? 'Scène Unity en vue FPS. Cliquez pour activer la souris. ZQSD ou WASD pour se déplacer, E et C pour monter ou descendre.' : 'Scène 3D Unity FireViewer en vue orbitale.'} />
    <span className={`incident-tiled-scene__status is-${status}`} role="status">{statusText}</span>
  </div>;
}
