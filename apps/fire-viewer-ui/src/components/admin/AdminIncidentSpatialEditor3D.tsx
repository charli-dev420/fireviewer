import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Line as ThreeLine,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AdminActiveFireZoneRevision, AdminGltfPoint, AdminIncidentSpatialMarker } from '../../lib/adminApi';

interface Runtime {
  scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer; controls: OrbitControls;
  terrain: Object3D | null; overlays: Group; maxY: number;
}

function dispose(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
    if (object instanceof ThreeLine) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function snapped(runtime: Runtime, point: AdminGltfPoint): Vector3 {
  const projected = new Vector3(...point);
  if (!runtime.terrain) return projected;
  const ray = new Raycaster(new Vector3(projected.x, runtime.maxY + 1_000, projected.z), new Vector3(0, -1, 0));
  const hit = ray.intersectObject(runtime.terrain, true)[0];
  return hit ? hit.point.add(new Vector3(0, 0.8, 0)) : projected;
}

function markerColor(state: string): string {
  if (state === 'VALIDATED') return '#4ee19a';
  if (state === 'REJECTED') return '#9aa5a8';
  return '#ffc857';
}

export function AdminIncidentSpatialEditor3D({
  assetUrl, cameraMode, markers, revisions, draftPoints, drawMode, onTerrainPick,
}: {
  readonly assetUrl: string;
  readonly cameraMode: 'orbit' | 'fps';
  readonly markers: readonly AdminIncidentSpatialMarker[];
  readonly revisions: readonly AdminActiveFireZoneRevision[];
  readonly draftPoints: readonly AdminGltfPoint[];
  readonly drawMode: boolean;
  readonly onTerrainPick: (point: AdminGltfPoint) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const pickRef = useRef(onTerrainPick);
  const drawModeRef = useRef(drawMode);
  const cameraModeRef = useRef(cameraMode);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [terrainVersion, setTerrainVersion] = useState(0);
  pickRef.current = onTerrainPick;
  drawModeRef.current = drawMode;
  cameraModeRef.current = cameraMode;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof WebGLRenderingContext === 'undefined') { setState('error'); return undefined; }
    const scene = new Scene();
    scene.background = new Color('#0b2026');
    const camera = new PerspectiveCamera(44, 1, 0.1, 100_000);
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.replaceChildren(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new AmbientLight('#d7f4ec', 1.7));
    const light = new DirectionalLight('#fff0d2', 2.2);
    light.position.set(500, 900, 400);
    scene.add(light);
    const overlays = new Group();
    scene.add(overlays);
    const runtime: Runtime = { scene, camera, renderer, controls, terrain: null, overlays, maxY: 1_000 };
    runtimeRef.current = runtime;
    let frame = 0;
    let previousFrame = performance.now();
    let mode: 'orbit' | 'fps' = 'orbit';
    let yaw = 0;
    let pitch = -0.15;
    const pressed = new Set<string>();
    const resize = () => { const width = Math.max(host.clientWidth, 1); const height = Math.max(host.clientHeight, 1); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const setFpsOrientation = () => {
      const direction = new Vector3(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(camera.position.clone().add(direction));
    };
    const render = (now = performance.now()) => {
      const delta = Math.min((now - previousFrame) / 1_000, 0.05);
      previousFrame = now;
      if (mode !== cameraModeRef.current) {
        mode = cameraModeRef.current;
        if (mode === 'fps') {
          const direction = camera.getWorldDirection(new Vector3());
          yaw = Math.atan2(direction.x, -direction.z);
          pitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));
          setFpsOrientation();
        } else if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      }
      controls.enabled = mode === 'orbit';
      if (mode === 'orbit') controls.update();
      else {
        const speed = (pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 750 : 260) * delta;
        if (pressed.has('ArrowLeft')) yaw += 1.2 * delta;
        if (pressed.has('ArrowRight')) yaw -= 1.2 * delta;
        if (pressed.has('ArrowUp')) pitch = Math.min(1.45, pitch + 0.9 * delta);
        if (pressed.has('ArrowDown')) pitch = Math.max(-1.45, pitch - 0.9 * delta);
        const forward = new Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
        if (pressed.has('KeyW') || pressed.has('KeyZ')) camera.position.addScaledVector(forward, speed);
        if (pressed.has('KeyS')) camera.position.addScaledVector(forward, -speed);
        if (pressed.has('KeyA') || pressed.has('KeyQ')) camera.position.addScaledVector(right, -speed);
        if (pressed.has('KeyD')) camera.position.addScaledVector(right, speed);
        if (pressed.has('KeyE') || pressed.has('PageUp')) camera.position.y += speed;
        if (pressed.has('KeyC') || pressed.has('PageDown')) camera.position.y -= speed;
        setFpsOrientation();
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    let down: Vector2 | null = null;
    const onDown = (event: PointerEvent) => { host.focus(); down = new Vector2(event.clientX, event.clientY); };
    const onUp = (event: PointerEvent) => {
      if (!down || down.distanceTo(new Vector2(event.clientX, event.clientY)) > 5) return;
      if (!drawModeRef.current && cameraModeRef.current === 'fps') {
        void renderer.domElement.requestPointerLock();
        return;
      }
      if (!drawModeRef.current || !runtime.terrain) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const pointer = new Vector2(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      const ray = new Raycaster();
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObject(runtime.terrain, true)[0];
      if (hit) pickRef.current([hit.point.x, hit.point.y, hit.point.z]);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (cameraModeRef.current !== 'fps') return;
      if (event.code.startsWith('Arrow') || event.code === 'PageUp' || event.code === 'PageDown') event.preventDefault();
      pressed.add(event.code);
    };
    const keyUp = (event: KeyboardEvent) => pressed.delete(event.code);
    const mouseMove = (event: MouseEvent) => {
      if (cameraModeRef.current !== 'fps' || document.pointerLockElement !== renderer.domElement) return;
      yaw -= event.movementX * 0.0022;
      pitch = Math.max(-1.45, Math.min(1.45, pitch - event.movementY * 0.0022));
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    host.addEventListener('keydown', keyDown);
    host.addEventListener('keyup', keyUp);
    document.addEventListener('mousemove', mouseMove);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      host.removeEventListener('keydown', keyDown);
      host.removeEventListener('keyup', keyUp);
      document.removeEventListener('mousemove', mouseMove);
      if (runtime.terrain) dispose(runtime.terrain);
      dispose(overlays); controls.dispose(); renderer.dispose(); host.replaceChildren(); runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return undefined;
    setState('loading');
    let cancelled = false;
    new GLTFLoader().load(assetUrl, (gltf) => {
      if (cancelled) { dispose(gltf.scene); return; }
      if (runtime.terrain) { runtime.scene.remove(runtime.terrain); dispose(runtime.terrain); }
      runtime.terrain = gltf.scene;
      runtime.scene.add(gltf.scene);
      const box = new Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new Vector3());
      const radius = Math.max(box.getSize(new Vector3()).length() / 2, 10);
      runtime.maxY = box.max.y;
      runtime.controls.target.copy(center);
      runtime.camera.position.set(center.x + radius * 0.8, center.y + radius * 0.75, center.z + radius * 0.8);
      runtime.camera.near = Math.max(radius / 10_000, 0.1);
      runtime.camera.far = Math.max(radius * 20, 10_000);
      runtime.camera.updateProjectionMatrix();
      runtime.controls.update();
      setTerrainVersion((value) => value + 1);
      setState('ready');
    }, undefined, () => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [assetUrl]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.scene.remove(runtime.overlays);
    dispose(runtime.overlays);
    runtime.overlays = new Group();
    runtime.scene.add(runtime.overlays);
    for (const marker of markers) {
      if (!marker.gltf_position || marker.review_state === 'REJECTED') continue;
      const mesh = new Mesh(new SphereGeometry(3.2, 16, 12), new MeshBasicMaterial({ color: markerColor(marker.review_state), depthTest: false }));
      mesh.position.copy(snapped(runtime, marker.gltf_position));
      mesh.renderOrder = 5;
      runtime.overlays.add(mesh);
    }
    for (const revision of revisions) {
      if (revision.review_state === 'REJECTED') continue;
      const color = revision.review_state === 'READY_FOR_PUBLICATION' ? '#ff5b43' : '#60a5fa';
      for (const polygon of revision.gltf_polygons) for (const ring of polygon) {
        const points = ring.map((point) => snapped(runtime, point));
        const line = new ThreeLine(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.82 }));
        line.renderOrder = 4;
        runtime.overlays.add(line);
      }
    }
    if (draftPoints.length) {
      const points = draftPoints.map((point) => snapped(runtime, point));
      if (points.length > 2) points.push(points[0].clone());
      const draft = new ThreeLine(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: '#f8e16c', depthTest: false }));
      draft.renderOrder = 6;
      runtime.overlays.add(draft);
    }
  }, [markers, revisions, draftPoints, terrainVersion]);

  return <div className={`admin-spatial-3d ${drawMode ? 'is-drawing' : ''}`}>
    <div ref={hostRef} className="admin-spatial-3d__canvas" tabIndex={0} aria-label={cameraMode === 'fps' ? 'Scène 3D privée en vue FPS. Cliquez pour activer le regard souris et utilisez ZQSD ou WASD.' : 'Scène 3D privée éditable de la zone incendie en vue orbitale.'} />
    <span className={`admin-spatial-3d__state is-${state}`}>{state === 'ready' ? (drawMode ? 'Cliquez sur le terrain' : 'Scène prête') : state === 'loading' ? 'Chargement 3D…' : 'Scène indisponible'}</span>
  </div>;
}
