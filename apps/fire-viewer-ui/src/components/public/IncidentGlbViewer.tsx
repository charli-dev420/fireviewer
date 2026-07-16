import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  AxesHelper,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Line,
  LineBasicMaterial,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Icon } from '../Icons';
import type { PublicIncidentView } from '../../lib/publicIncidentView';
import type { ViewerManifestFrame } from '../../lib/viewerManifest';

type ViewerLoadState = 'loading' | 'ready' | 'error';
type CameraPreset = 'oblique' | 'top' | 'north';

interface TacticalLayers {
  readonly model: boolean;
  readonly referenceGrid: boolean;
  readonly axes: boolean;
  readonly measurements: boolean;
}

interface TacticalRuntime {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  root: Object3D | null;
  grid: GridHelper | null;
  axes: AxesHelper | null;
  measurementLine: Line | null;
  center: Vector3;
  radius: number;
}

interface LocalMeasurement {
  readonly start: Vector3;
  readonly end: Vector3;
  readonly meters: number;
}

const DEFAULT_LAYERS: TacticalLayers = {
  model: true,
  referenceGrid: true,
  axes: false,
  measurements: true,
};

function disposeObject(object: Object3D): void {
  object.traverse((entry) => {
    const mesh = entry as Mesh & {
      material?: { dispose?: () => void; wireframe?: boolean } | { dispose?: () => void; wireframe?: boolean }[];
    };
    mesh.geometry?.dispose();
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) material?.dispose?.();
  });
}

function disposeLine(line: Line): void {
  line.geometry.dispose();
  for (const material of (Array.isArray(line.material) ? line.material : [line.material])) material.dispose();
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km`;
  return `${meters.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} m`;
}

function focus(runtime: TacticalRuntime, preset: CameraPreset, preserveOffset?: Vector3): void {
  const distance = Math.max(runtime.radius * 2.25, 25);
  const target = runtime.center;
  if (preserveOffset && preserveOffset.lengthSq() > 0) {
    runtime.camera.position.copy(target).add(preserveOffset);
  } else if (preset === 'top') {
    runtime.camera.position.copy(target).add(new Vector3(0, distance * 1.25, 0.01));
  } else if (preset === 'north') {
    runtime.camera.position.copy(target).add(new Vector3(0, distance * 0.68, distance));
  } else {
    runtime.camera.position.copy(target).add(new Vector3(distance, distance * 0.7, distance * 0.82));
  }
  runtime.controls.target.copy(target);
  runtime.controls.update();
}

function setWireframe(root: Object3D | null, enabled: boolean): void {
  root?.traverse((entry) => {
    const mesh = entry as Mesh & { material?: { wireframe?: boolean } | { wireframe?: boolean }[] };
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      if (material && 'wireframe' in material) material.wireframe = enabled;
    }
  });
}

function renderMeasurement(runtime: TacticalRuntime, measurement: LocalMeasurement | null, visible: boolean): void {
  if (runtime.measurementLine) {
    runtime.scene.remove(runtime.measurementLine);
    disposeLine(runtime.measurementLine);
    runtime.measurementLine = null;
  }
  if (!measurement || !visible) return;
  const line = new Line(
    new BufferGeometry().setFromPoints([measurement.start, measurement.end]),
    new LineBasicMaterial({ color: '#ff9b52', linewidth: 2 }),
  );
  runtime.scene.add(line);
  runtime.measurementLine = line;
}

function layerLabel(name: keyof TacticalLayers): string {
  return {
    model: 'Relief publié',
    referenceGrid: 'Grille de repère',
    axes: 'Repères de référentiel',
    measurements: 'Trace de mesure',
  }[name];
}

export function IncidentGlbViewer({
  assetUrl,
  version,
  sha256,
  frame,
  terrainSourceYear,
  observations,
}: {
  readonly assetUrl: string;
  readonly version: number;
  readonly sha256: string;
  readonly frame: ViewerManifestFrame | null;
  readonly terrainSourceYear: number | null;
  readonly observations: PublicIncidentView['observations'];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const runtimeRef = useRef<TacticalRuntime | null>(null);
  const layersRef = useRef<TacticalLayers>(DEFAULT_LAYERS);
  const wireframeRef = useRef(false);
  const measurementRef = useRef<LocalMeasurement | null>(null);
  const measureModeRef = useRef(false);
  const measureStartRef = useRef<Vector3 | null>(null);
  const [state, setState] = useState<ViewerLoadState>('loading');
  const [layers, setLayers] = useState<TacticalLayers>(DEFAULT_LAYERS);
  const [wireframe, setWireframeState] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurementPending, setMeasurementPending] = useState(false);
  const [measurement, setMeasurement] = useState<LocalMeasurement | null>(null);
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof WebGLRenderingContext === 'undefined') {
      setState('error');
      return undefined;
    }
    let disposed = false;
    let frameId = 0;
    let observer: ResizeObserver | null = null;
    try {
      const scene = new Scene();
      scene.background = new Color('#102b31');
      const camera = new PerspectiveCamera(42, 1, 0.1, 100_000);
      const renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      host.replaceChildren(renderer.domElement);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.screenSpacePanning = true;
      controls.minDistance = 1;
      scene.add(new AmbientLight('#dff4ed', 1.75));
      const sun = new DirectionalLight('#fff2d4', 2.35);
      sun.position.set(450, 800, 520);
      scene.add(sun);
      const fill = new DirectionalLight('#74b8d6', 0.65);
      fill.position.set(-300, 220, -420);
      scene.add(fill);
      const runtime: TacticalRuntime = {
        scene,
        camera,
        renderer,
        controls,
        root: null,
        grid: null,
        axes: null,
        measurementLine: null,
        center: new Vector3(),
        radius: 50,
      };
      runtimeRef.current = runtime;
      const resize = () => {
        const width = Math.max(host.clientWidth, 1);
        const height = Math.max(host.clientHeight, 1);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      };
      observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      const render = () => {
        if (disposed) return;
        controls.update();
        renderer.render(scene, camera);
        frameId = window.requestAnimationFrame(render);
      };
      render();
    } catch {
      setState('error');
    }
    return () => {
      disposed = true;
      observer?.disconnect();
      window.cancelAnimationFrame(frameId);
      const runtime = runtimeRef.current;
      if (runtime) {
        if (runtime.root) disposeObject(runtime.root);
        if (runtime.measurementLine) disposeLine(runtime.measurementLine);
        runtime.controls.dispose();
        runtime.renderer.dispose();
      }
      runtimeRef.current = null;
      host.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return undefined;
    let cancelled = false;
    const loader = new GLTFLoader();
    setState('loading');
    loader.load(
      assetUrl,
      (gltf) => {
        if (cancelled) {
          disposeObject(gltf.scene);
          return;
        }
        const nextRoot = gltf.scene;
        const nextBox = new Box3().setFromObject(nextRoot);
        const nextCenter = nextBox.getCenter(new Vector3());
        const nextRadius = Math.max(nextBox.getSize(new Vector3()).length() / 2, 1);
        const oldRoot = runtime.root;
        const cameraOffset = oldRoot ? runtime.camera.position.clone().sub(runtime.controls.target) : null;
        runtime.scene.add(nextRoot);
        runtime.root = nextRoot;
        runtime.center.copy(nextCenter);
        runtime.radius = nextRadius;
        if (oldRoot) {
          runtime.scene.remove(oldRoot);
          disposeObject(oldRoot);
        }
        if (runtime.grid) runtime.scene.remove(runtime.grid);
        if (runtime.axes) runtime.scene.remove(runtime.axes);
        const gridSize = Math.max(nextRadius * 4, 20);
        runtime.grid = new GridHelper(gridSize, 16, '#508581', '#244e4d');
        runtime.grid.position.set(nextCenter.x, nextBox.min.y, nextCenter.z);
        runtime.axes = new AxesHelper(Math.max(nextRadius * 0.35, 5));
        runtime.axes.position.copy(nextCenter);
        runtime.scene.add(runtime.grid, runtime.axes);
        runtime.grid.visible = layersRef.current.referenceGrid;
        runtime.axes.visible = layersRef.current.axes;
        nextRoot.visible = layersRef.current.model;
        setWireframe(nextRoot, wireframeRef.current);
        renderMeasurement(runtime, measurementRef.current, layersRef.current.measurements);
        focus(runtime, 'oblique', cameraOffset ?? undefined);
        setLoadedVersion(version);
        setState('ready');
      },
      undefined,
      () => {
        if (!cancelled) setState('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [assetUrl, version]);

  useEffect(() => {
    layersRef.current = layers;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.root) runtime.root.visible = layers.model;
    if (runtime.grid) runtime.grid.visible = layers.referenceGrid;
    if (runtime.axes) runtime.axes.visible = layers.axes;
    renderMeasurement(runtime, measurement, layers.measurements);
  }, [layers, measurement]);

  useEffect(() => {
    wireframeRef.current = wireframe;
    setWireframe(runtimeRef.current?.root ?? null, wireframe);
  }, [wireframe]);

  useEffect(() => {
    measurementRef.current = measurement;
  }, [measurement]);

  useEffect(() => {
    measureModeRef.current = measureMode;
    if (!measureMode) {
      measureStartRef.current = null;
      setMeasurementPending(false);
    }
  }, [measureMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return undefined;
    const canvas = runtime.renderer.domElement;
    let down: Vector2 | null = null;
    const onPointerDown = (event: PointerEvent) => { down = new Vector2(event.clientX, event.clientY); };
    const onPointerUp = (event: PointerEvent) => {
      if (!measureModeRef.current || !down || down.distanceTo(new Vector2(event.clientX, event.clientY)) > 5 || !runtime.root) return;
      const box = canvas.getBoundingClientRect();
      const pointer = new Vector2(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
      const raycaster = new Raycaster();
      raycaster.setFromCamera(pointer, runtime.camera);
      const hit = raycaster.intersectObject(runtime.root, true)[0];
      if (!hit) return;
      const start = measureStartRef.current;
      if (!start) {
        measureStartRef.current = hit.point.clone();
        setMeasurement(null);
        setMeasurementPending(true);
        return;
      }
      const metersPerUnit = frame?.meters_per_unit ?? 1;
      setMeasurement({ start, end: hit.point.clone(), meters: start.distanceTo(hit.point) * metersPerUnit });
      measureStartRef.current = null;
      setMeasurementPending(false);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [frame]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const changeLayer = (name: keyof TacticalLayers) => setLayers((current) => ({ ...current, [name]: !current[name] }));
  const setPreset = (preset: CameraPreset) => runtimeRef.current && focus(runtimeRef.current, preset);
  const reset = () => {
    setMeasurement(null);
    measureStartRef.current = null;
    setMeasureMode(false);
    setMeasurementPending(false);
    setPreset('oblique');
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch {
      setFullscreen(false);
    }
  };
  const frameLabel = frame ? `${frame.local_frame} · ${frame.meters_per_unit} m / unité` : 'Référentiel local non publié';
  const viewerInteractive = state === 'ready' || loadedVersion !== null;

  return <section ref={shellRef} className="tactical-glb-viewer" aria-label={`Viewer tactique du modèle ${version}`}>
    <header className="tactical-glb-viewer__header">
      <div><strong>Terrain 3D publié</strong><span>Version {loadedVersion ?? version} · {frameLabel}</span></div>
      <span className={`tactical-glb-viewer__state tactical-glb-viewer__state--${state}`}>{state === 'ready' ? 'Prêt' : state === 'loading' ? 'Chargement' : 'Indisponible'}</span>
    </header>
    <div className="tactical-glb-viewer__stage">
      <div ref={hostRef} className="tactical-glb-viewer__canvas" aria-label={`Modèle 3D v${version}, rotation et zoom disponibles`} />
      <div className="tactical-glb-viewer__toolbar" role="toolbar" aria-label="Outils de caméra">
        <button className="viewer-button" type="button" onClick={reset} disabled={!viewerInteractive}><Icon name="refresh" size={17} />Recentrer</button>
        <button className="viewer-button" type="button" onClick={() => setPreset('north')} disabled={!viewerInteractive || !frame}><Icon name="north" size={17} />Nord</button>
        <button className="viewer-button" type="button" onClick={() => setPreset('top')} disabled={!viewerInteractive}><Icon name="compass" size={17} />Dessus</button>
        <button className={`viewer-button ${measureMode ? 'is-active' : ''}`} type="button" aria-pressed={measureMode} onClick={() => setMeasureMode((value) => !value)} disabled={!viewerInteractive}><Icon name="measure" size={17} />Mesurer</button>
        <button className={`viewer-button ${wireframe ? 'is-active' : ''}`} type="button" aria-pressed={wireframe} onClick={() => setWireframeState((value) => !value)} disabled={!viewerInteractive}><Icon name="layers" size={17} />Fil de fer</button>
        <button className="viewer-button" type="button" aria-pressed={fullscreen} onClick={() => void toggleFullscreen()} disabled={!viewerInteractive}><Icon name="eye" size={17} />{fullscreen ? 'Réduire' : 'Plein écran'}</button>
      </div>
      <div className="tactical-glb-viewer__north" aria-label={frame ? 'Orientation nord disponible dans le référentiel local' : 'Orientation nord non publiée'}><span>N</span><Icon name="compass" size={34} /></div>
      <div className="tactical-glb-viewer__watermark">{sha256.slice(0, 12)} · v{version}</div>
      {state === 'loading' ? <div className="tactical-glb-viewer__loading" role="status"><Icon name="layers" size={24} /><div><strong>{loadedVersion ? `Préparation de la version ${version}` : 'Chargement du modèle 3D'}</strong><span>{loadedVersion ? 'La version précédente reste visible jusqu’au remplacement.' : 'La fiche et ses données textuelles restent accessibles.'}</span></div></div> : null}
      {state === 'error' ? <div className="tactical-glb-viewer__error" role="status"><Icon name="warning" size={22} /><div><strong>Le modèle ne peut pas être affiché sur cet appareil.</strong><span>Les données publiées restent disponibles dans les autres onglets.</span></div></div> : null}
    </div>
    <div className="tactical-glb-viewer__inspector">
      <section><h4>Couches publiées</h4><div className="tactical-glb-viewer__layers">{(Object.keys(layers) as Array<keyof TacticalLayers>).map((name) => <label key={name}><input type="checkbox" checked={layers[name]} onChange={() => changeLayer(name)} disabled={!viewerInteractive} />{layerLabel(name)}</label>)}</div></section>
      <section><h4>Mesure locale</h4>{measurement ? <><strong>{formatDistance(measurement.meters)}</strong><p>Distance entre deux points du modèle. Elle dépend du référentiel et de la version affichés.</p><button className="button button--small" type="button" onClick={() => setMeasurement(null)}>Effacer la mesure</button></> : <>{measureMode ? <p>{measurementPending ? 'Choisissez le second point ou annulez la mesure.' : 'Choisissez le premier point sur le modèle.'}</p> : <p>Activez Mesurer pour calculer une distance entre deux points.</p>}{measurementPending ? <button className="button button--small" type="button" onClick={() => { measureStartRef.current = null; setMeasurementPending(false); }}>Annuler la mesure</button> : null}</>}</section>
      <section><h4>Observations</h4><strong>{observations.length} publiée{observations.length > 1 ? 's' : ''}</strong><p>Leurs positions précises ne sont pas projetées lorsque seules des zones généralisées sont publiées.</p></section>
      <section><h4>Limites</h4><p>{terrainSourceYear ? `Terrain source : ${terrainSourceYear}. ` : ''}Ce viewer ne prédit pas la propagation et ne remplace pas les consignes officielles.</p></section>
    </div>
  </section>;
}
