import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SURFACE_CATALOG = '/.artifacts/spatial-lidar-surface/stream-cache/DIE-08-T01-V30/catalog.json';
const SPLAT_CATALOG = '/.artifacts/spatial-lidar-surface/splat-cache/DIE-08-T01-V30/catalog.json';
const statusNode = document.querySelector('#status');
const host = document.querySelector('#viewer');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
host.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaabcc5);
scene.fog = new THREE.FogExp2(0xaabcc5, 0.00055);
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.25, 5000);
camera.up.set(0, 1, 0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 2400;
controls.maxPolarAngle = Math.PI * 0.495;

const surfaceGroup = new THREE.Group();
const splatGroup = new THREE.Group();
scene.add(surfaceGroup, splatGroup);

let surfaceCatalog;
let splatCatalog;
let tileOriginX = 0;
let tileOriginY = 0;
let verticalOrigin = 0;
let surfaceReady = 0;
let loadedPointCount = 0;
let loadingPointCount = 0;
let lastStreamingTarget = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
const loadedSplats = new Map();
const pendingSplats = new Map();

function resolveAsset(catalogUrl, assetPath) {
  return new URL(assetPath, new URL(catalogUrl, window.location.href)).href;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.arrayBuffer();
}

function buildSharedGrid() {
  const size = 251;
  const spacing = 0.5;
  const positions = new Float32Array(size * size * 3);
  const uvs = new Float32Array(size * size * 2);
  let cursor = 0;
  let uvCursor = 0;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      positions[cursor++] = column * spacing;
      positions[cursor++] = 0;
      positions[cursor++] = row * spacing;
      uvs[uvCursor++] = column / (size - 1);
      uvs[uvCursor++] = row / (size - 1);
    }
  }
  const indices = new Uint32Array((size - 1) * (size - 1) * 6);
  cursor = 0;
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const a = row * size + column;
      const b = a + 1;
      const c = a + size;
      const d = c + 1;
      indices[cursor++] = a; indices[cursor++] = c; indices[cursor++] = b;
      indices[cursor++] = b; indices[cursor++] = c; indices[cursor++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

const sharedGrid = buildSharedGrid();

function makeSurfaceMaterial(heightTexture, colourTexture, heightScale, heightBias) {
  return new THREE.ShaderMaterial({
    uniforms: {
      heightMap: { value: heightTexture },
      colourMap: { value: colourTexture },
      heightScale: { value: heightScale },
      heightBias: { value: heightBias },
      texel: { value: new THREE.Vector2(1 / 250, 1 / 250) },
      spacing: { value: 0.5 },
      sunDirection: { value: new THREE.Vector3(-0.42, 0.78, -0.46).normalize() },
    },
    vertexShader: `
      uniform sampler2D heightMap;
      uniform float heightScale;
      uniform float heightBias;
      uniform vec2 texel;
      uniform float spacing;
      varying vec2 vUv;
      varying vec3 vNormalLocal;
      float altitude(vec2 coordinate) {
        return texture2D(heightMap, clamp(coordinate, 0.0, 1.0)).r * heightScale + heightBias;
      }
      void main() {
        vUv = uv;
        float centre = altitude(uv);
        float left = altitude(uv - vec2(texel.x, 0.0));
        float right = altitude(uv + vec2(texel.x, 0.0));
        float down = altitude(uv - vec2(0.0, texel.y));
        float up = altitude(uv + vec2(0.0, texel.y));
        vNormalLocal = normalize(vec3(left - right, 2.0 * spacing, down - up));
        vec3 displaced = vec3(position.x, centre, position.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D colourMap;
      uniform vec3 sunDirection;
      varying vec2 vUv;
      varying vec3 vNormalLocal;
      void main() {
        vec3 source = texture2D(colourMap, vUv).rgb;
        vec3 linearColour = pow(source, vec3(2.2));
        float diffuse = max(dot(normalize(vNormalLocal), sunDirection), 0.0);
        float illumination = 0.61 + 0.52 * diffuse;
        vec3 shaded = pow(linearColour * illumination, vec3(1.0 / 2.2));
        gl_FragColor = vec4(shaded, 1.0);
      }
    `,
  });
}

async function loadSurfaceSector(sector) {
  const [heightBuffer, colourTexture] = await Promise.all([
    fetchBytes(resolveAsset(SURFACE_CATALOG, sector.height.path)),
    new THREE.TextureLoader().loadAsync(resolveAsset(SURFACE_CATALOG, sector.colour.path)),
  ]);
  const heights = new Uint16Array(heightBuffer);
  if (heights.length !== 251 * 251) throw new Error(`Hauteurs invalides: ${sector.sector_id}`);
  const heightTexture = new THREE.DataTexture(heights, 251, 251, THREE.RedFormat, THREE.UnsignedShortType);
  heightTexture.needsUpdate = true;
  heightTexture.flipY = false;
  heightTexture.minFilter = THREE.NearestFilter;
  heightTexture.magFilter = THREE.NearestFilter;
  colourTexture.colorSpace = THREE.SRGBColorSpace;
  colourTexture.flipY = false;
  colourTexture.minFilter = THREE.LinearMipmapLinearFilter;
  colourTexture.magFilter = THREE.LinearFilter;
  colourTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const heightScale = surfaceCatalog.contract.height_quantization_metres * 65535;
  const heightBias = surfaceCatalog.contract.height_origin_ngf_ign69_metres - verticalOrigin;
  const material = makeSurfaceMaterial(heightTexture, colourTexture, heightScale, heightBias);
  const mesh = new THREE.Mesh(sharedGrid, material);
  mesh.name = sector.sector_id;
  mesh.position.set(
    sector.bounds_l93_metres[0] - tileOriginX,
    0,
    sector.bounds_l93_metres[1] - tileOriginY,
  );
  mesh.frustumCulled = false;
  surfaceGroup.add(mesh);
  surfaceReady += 1;
}

function makeSplatMaterial() {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      pointScale: { value: renderer.getPixelRatio() * 530 },
    },
    vertexShader: `
      attribute float classification;
      varying vec3 vColour;
      varying float vClass;
      uniform float pointScale;
      void main() {
        vColour = color;
        vClass = classification;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float classScale = classification < 3.5 ? 0.78 : (classification < 4.5 ? 0.9 : 1.0);
        gl_PointSize = clamp(classScale * pointScale / max(1.0, -viewPosition.z), 1.25, 7.5);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColour;
      varying float vClass;
      void main() {
        vec2 centred = gl_PointCoord * 2.0 - 1.0;
        float radiusSquared = dot(centred, centred);
        if (radiusSquared > 1.0) discard;
        float dome = sqrt(max(0.0, 1.0 - radiusSquared));
        vec3 linearColour = pow(vColour, vec3(2.2));
        float classShade = vClass < 3.5 ? 0.88 : (vClass < 4.5 ? 0.96 : 1.0);
        float illumination = classShade * (0.68 + 0.42 * dome);
        gl_FragColor = vec4(pow(linearColour * illumination, vec3(1.0 / 2.2)), 1.0);
      }
    `,
    depthTest: true,
    depthWrite: true,
    transparent: false,
  });
}

async function loadSplatSector(sector) {
  const [positionBuffer, colourBuffer, classBuffer] = await Promise.all([
    fetchBytes(resolveAsset(SPLAT_CATALOG, sector.position.path)),
    fetchBytes(resolveAsset(SPLAT_CATALOG, sector.colour.path)),
    fetchBytes(resolveAsset(SPLAT_CATALOG, sector.classification.path)),
  ]);
  const encoded = new Uint16Array(positionBuffer);
  const colours = new Uint8Array(colourBuffer);
  const classifications = new Uint8Array(classBuffer);
  const pointCount = sector.point_count;
  if (encoded.length !== pointCount * 3 || colours.length !== pointCount * 3 || classifications.length !== pointCount) {
    throw new Error(`Secteur splat invalide: ${sector.sector_id}`);
  }
  const positions = new Float32Array(pointCount * 3);
  const scale = splatCatalog.contract.position_quantization_metres;
  const baseX = sector.bounds_l93_metres[0] - tileOriginX;
  const baseZ = sector.bounds_l93_metres[1] - tileOriginY;
  const baseY = splatCatalog.contract.position_origin_ngf_ign69_metres - verticalOrigin;
  for (let index = 0; index < pointCount; index += 1) {
    const source = index * 3;
    positions[source] = baseX + encoded[source] * scale;
    positions[source + 1] = baseY + encoded[source + 2] * scale;
    positions[source + 2] = baseZ + encoded[source + 1] * scale;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(colours, 3, true));
  geometry.setAttribute('classification', new THREE.Uint8BufferAttribute(classifications, 1, false));
  geometry.computeBoundingSphere();
  const points = new THREE.Points(geometry, makeSplatMaterial());
  points.name = sector.sector_id;
  points.userData.pointCount = pointCount;
  splatGroup.add(points);
  loadedSplats.set(sector.sector_id, points);
  loadedPointCount += pointCount;
}

function distanceToSector(sector, x, z) {
  const left = sector.bounds_l93_metres[0] - tileOriginX;
  const bottom = sector.bounds_l93_metres[1] - tileOriginY;
  const right = sector.bounds_l93_metres[2] - tileOriginX;
  const top = sector.bounds_l93_metres[3] - tileOriginY;
  const dx = x < left ? left - x : (x > right ? x - right : 0);
  const dz = z < bottom ? bottom - z : (z > top ? z - top : 0);
  return Math.hypot(dx, dz);
}

function disposeSplat(points) {
  points.geometry.dispose();
  points.material.dispose();
  splatGroup.remove(points);
  loadedPointCount -= points.userData.pointCount;
}

async function refreshSplatStreaming(force = false) {
  if (!splatCatalog) return;
  const target = controls.target;
  if (!force && lastStreamingTarget.distanceToSquared(target) < 42 * 42) return;
  lastStreamingTarget.copy(target);
  const cameraDistance = camera.position.distanceTo(target);
  const radius = cameraDistance < 220 ? 245 : (cameraDistance < 520 ? 330 : 410);
  const candidates = splatCatalog.sectors
    .map((sector) => ({ sector, distance: distanceToSector(sector, target.x, target.z) }))
    .filter(({ distance }) => distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
  const desired = new Set(candidates.map(({ sector }) => sector.sector_id));
  for (const [id, points] of loadedSplats) {
    if (!desired.has(id)) {
      disposeSplat(points);
      loadedSplats.delete(id);
    }
  }
  const queue = candidates.filter(({ sector }) => !loadedSplats.has(sector.sector_id) && !pendingSplats.has(sector.sector_id));
  for (let index = 0; index < queue.length; index += 4) {
    const batch = queue.slice(index, index + 4);
    await Promise.all(batch.map(async ({ sector }) => {
      loadingPointCount += sector.point_count;
      const promise = loadSplatSector(sector).finally(() => {
        loadingPointCount -= sector.point_count;
        pendingSplats.delete(sector.sector_id);
      });
      pendingSplats.set(sector.sector_id, promise);
      await promise;
    }));
  }
}

function updateStatus() {
  if (!surfaceCatalog || !splatCatalog) return;
  const millions = (loadedPointCount / 1_000_000).toFixed(2);
  const pending = loadingPointCount > 0 ? ` · ${(loadingPointCount / 1_000_000).toFixed(2)} M en chargement` : '';
  statusNode.textContent = `${surfaceReady}/64 secteurs de surface · ${millions} M points visibles${pending}`;
}

function setView(kind) {
  if (kind === 'closeup') {
    controls.target.set(560, 58, 505);
    camera.position.set(690, 178, 340);
  } else {
    controls.target.set(500, 52, 500);
    camera.position.set(790, 475, -120);
  }
  controls.update();
  lastStreamingTarget.setScalar(Number.POSITIVE_INFINITY);
  void refreshSplatStreaming(true);
}

async function start() {
  [surfaceCatalog, splatCatalog] = await Promise.all([fetchJson(SURFACE_CATALOG), fetchJson(SPLAT_CATALOG)]);
  tileOriginX = surfaceCatalog.bounds_l93_metres[0];
  tileOriginY = surfaceCatalog.bounds_l93_metres[1];
  verticalOrigin = splatCatalog.contract.position_origin_ngf_ign69_metres;
  setView('overview');
  statusNode.textContent = 'Chargement des 64 secteurs MNS texturés…';
  const lod0 = surfaceCatalog.sectors.filter((sector) => sector.lod_level === 0);
  for (let index = 0; index < lod0.length; index += 8) {
    await Promise.all(lod0.slice(index, index + 8).map(loadSurfaceSector));
    updateStatus();
  }
  await refreshSplatStreaming(true);
  updateStatus();
}

document.querySelector('#overview').addEventListener('click', () => setView('overview'));
document.querySelector('#closeup').addEventListener('click', () => setView('closeup'));
for (const [selector, group] of [['#surface-toggle', surfaceGroup], ['#splat-toggle', splatGroup]]) {
  document.querySelector(selector).addEventListener('click', (event) => {
    group.visible = !group.visible;
    event.currentTarget.setAttribute('aria-pressed', String(group.visible));
  });
}
controls.addEventListener('end', () => void refreshSplatStreaming());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  updateStatus();
  renderer.render(scene, camera);
});

start().catch((error) => {
  statusNode.classList.add('error');
  statusNode.textContent = `Erreur: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
