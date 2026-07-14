import { useEffect, useRef } from 'react';
import { Material, Mesh, MeshBasicMaterial, Texture, type Object3D } from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import CoordinateSystem from '@giro3d/giro3d/core/geographic/CoordinateSystem.js';
import Extent from '@giro3d/giro3d/core/geographic/Extent.js';
import Instance from '@giro3d/giro3d/core/Instance.js';
import ColorLayer from '@giro3d/giro3d/core/layer/ColorLayer.js';
import ElevationLayer from '@giro3d/giro3d/core/layer/ElevationLayer.js';
import GiroMap from '@giro3d/giro3d/entities/Map.js';
import AggregateImageSource from '@giro3d/giro3d/sources/AggregateImageSource.js';
import GeoTIFFSource from '@giro3d/giro3d/sources/GeoTIFFSource.js';
import StaticImageSource from '@giro3d/giro3d/sources/StaticImageSource.js';
import {
  boundsCenter,
  spatialAssetUrl,
  type BoundsL93,
  type SpatialCatalog,
} from '../lib/spatialCatalog';
import { createSpatialOverviewCamera } from '../lib/spatialCamera';

const LAMBERT93_WKT = `
PROJCS["RGF93 v1 / Lambert-93",
    GEOGCS["RGF93 v1",
        DATUM["Reseau_Geodesique_Francais_1993_v1",
            SPHEROID["GRS 1980",6378137,298.257222101],
            TOWGS84[0,0,0,0,0,0,0]],
        PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],
        UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],
        AUTHORITY["EPSG","4171"]],
    PROJECTION["Lambert_Conformal_Conic_2SP"],
    PARAMETER["latitude_of_origin",46.5],
    PARAMETER["central_meridian",3],
    PARAMETER["standard_parallel_1",49],
    PARAMETER["standard_parallel_2",44],
    PARAMETER["false_easting",700000],
    PARAMETER["false_northing",6600000],
    UNIT["metre",1,AUTHORITY["EPSG","9001"]],
    AXIS["Easting",EAST],
    AXIS["Northing",NORTH],
    AUTHORITY["EPSG","2154"]]
`;
const DETAIL_RADIUS_METRES = 2_500;
const DETAIL_MAX_CAMERA_DISTANCE_METRES = 6_000;

let lambert93: CoordinateSystem | null = null;

function getLambert93(): CoordinateSystem {
  if (!lambert93) {
    lambert93 = CoordinateSystem.register('EPSG:2154', LAMBERT93_WKT, {
      throwIfFailedToRegisterWithProj: true,
    });
  }
  return lambert93;
}

function createExtent(crs: CoordinateSystem, value: BoundsL93): Extent {
  return new Extent(crs, value[0], value[2], value[1], value[3]);
}

function disposeObject(object: Object3D): void {
  object.traverse((candidate) => {
    if (!(candidate instanceof Mesh)) return;
    candidate.geometry.dispose();
    const materials = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose();
      }
      (material as Material).dispose();
    }
  });
}

function useUnlitVertexMaterials(object: Object3D): void {
  object.traverse((candidate) => {
    if (!(candidate instanceof Mesh)) return;
    const current = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
    const replacements = current.map((material) => {
      const replacement = new MeshBasicMaterial({
        color: material.color,
        vertexColors: Boolean(candidate.geometry.getAttribute('color')),
        transparent: material.transparent,
        opacity: material.opacity,
        side: material.side,
      });
      material.dispose();
      return replacement;
    });
    candidate.material = Array.isArray(candidate.material) ? replacements : replacements[0];
  });
}

function tileWithinRadius(bounds: BoundsL93, easting: number, northing: number): boolean {
  const [x, y] = boundsCenter(bounds);
  return Math.hypot(x - easting, y - northing) <= DETAIL_RADIUS_METRES;
}

export interface DetailLoadState {
  active: number;
  expected: number;
  failures: number;
}

interface Giro3DMapProps {
  catalog: SpatialCatalog;
  focusRequest: number;
  onReady: () => void;
  onError: (message: string) => void;
  onDetailState: (state: DetailLoadState) => void;
}

/**
 * Runtime cartographique exclusif à la route statique des zones. Il ne lit pas
 * ViewerManifest, afin de ne jamais associer implicitement une carte publique
 * à un incident dont le contrat ne publie pas encore de bundle spatial.
 */
export default function Giro3DMap({
  catalog,
  focusRequest,
  onReady,
  onError,
  onDetailState,
}: Giro3DMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onReady, onError, onDetailState });
  callbacksRef.current = { onReady, onError, onDetailState };

  useEffect(() => {
    focusRef.current?.();
  }, [focusRequest]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let disposed = false;
    let detailRefreshTimer: number | null = null;
    let instance: Instance | null = null;
    let controls: MapControls | null = null;
    const detailObjects = new globalThis.Map<string, Object3D>();
    const pendingDetails = new globalThis.Map<string, Promise<void>>();
    const failedDetails = new Set<string>();
    let desiredDetailIds = new Set<string>();

    const updateDetailState = () => {
      callbacksRef.current.onDetailState({
        active: detailObjects.size,
        expected: desiredDetailIds.size,
        failures: failedDetails.size,
      });
    };

    const removeInactiveDetails = () => {
      if (!instance) return;
      for (const [tileId, object] of detailObjects) {
        if (desiredDetailIds.has(tileId)) continue;
        instance.remove(object);
        disposeObject(object);
        detailObjects.delete(tileId);
      }
    };

    const loadDetailsAround = (easting: number, northing: number) => {
      if (!instance || disposed) return;
      if (instance.view.camera.position.distanceTo(controls?.target ?? instance.view.camera.position) > DETAIL_MAX_CAMERA_DISTANCE_METRES) {
        desiredDetailIds = new Set();
        removeInactiveDetails();
        updateDetailState();
        return;
      }
      const wanted = catalog.featureTiles.filter((tile) => tileWithinRadius(tile.bounds, easting, northing));
      desiredDetailIds = new Set(wanted.map((tile) => tile.tileId));
      for (const tileId of failedDetails) {
        if (!desiredDetailIds.has(tileId)) failedDetails.delete(tileId);
      }
      removeInactiveDetails();
      updateDetailState();

      for (const tile of wanted) {
        if (detailObjects.has(tile.tileId) || pendingDetails.has(tile.tileId) || failedDetails.has(tile.tileId)) {
          continue;
        }
        const currentInstance = instance;
        const loading = new GLTFLoader()
          .loadAsync(spatialAssetUrl(tile.features.path))
          .then(async (gltf) => {
            if (disposed || !desiredDetailIds.has(tile.tileId)) {
              disposeObject(gltf.scene);
              return;
            }
            gltf.scene.name = `detail-${tile.tileId}`;
            // Source GLB: (E, U, -N). Giro3D projected scene: (E, N, U).
            gltf.scene.rotation.x = Math.PI / 2;
            gltf.scene.position.set(
              tile.gltfLocalOrigin[0],
              tile.gltfLocalOrigin[1],
              tile.gltfLocalOrigin[2],
            );
            useUnlitVertexMaterials(gltf.scene);
            await currentInstance.add(gltf.scene);
            if (disposed || !desiredDetailIds.has(tile.tileId)) {
              currentInstance.remove(gltf.scene);
              disposeObject(gltf.scene);
              return;
            }
            detailObjects.set(tile.tileId, gltf.scene);
            currentInstance.notifyChange(gltf.scene);
          })
          .catch(() => {
            if (!disposed) failedDetails.add(tile.tileId);
          })
          .finally(() => {
            pendingDetails.delete(tile.tileId);
            if (!disposed) updateDetailState();
          });
        pendingDetails.set(tile.tileId, loading);
      }
    };

    const requestDetailRefresh = () => {
      if (!controls) return;
      if (detailRefreshTimer !== null) window.clearTimeout(detailRefreshTimer);
      detailRefreshTimer = window.setTimeout(() => {
        detailRefreshTimer = null;
        if (controls) loadDetailsAround(controls.target.x, controls.target.y);
      }, 160);
    };

    const focusBounds = (value: BoundsL93) => {
      if (!instance || !controls) return;
      const camera = createSpatialOverviewCamera(
        value,
        catalog.heightOriginNgfIgn69Metres,
        instance.domElement.clientHeight > 0
          ? instance.domElement.clientWidth / instance.domElement.clientHeight
          : 1,
      );
      controls.target.set(...camera.target);
      instance.view.camera.position.set(...camera.position);
      controls.maxDistance = camera.maxDistanceMetres;
      controls.update();
      instance.notifyChange(instance.view.camera);
      loadDetailsAround(camera.target[0], camera.target[1]);
    };

    const mount = async () => {
      try {
        const crs = getLambert93();
        instance = new Instance({ target: host, crs, backgroundColor: '#18221e' });
        controls = new MapControls(instance.view.camera, instance.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.12;
        controls.screenSpacePanning = false;
        controls.minDistance = 260;
        controls.maxDistance = Number.POSITIVE_INFINITY;
        instance.view.setControls(controls);
        controls.addEventListener('change', requestDetailRefresh);

        const extent = createExtent(crs, catalog.bounds);
        const map = new GiroMap({
          extent,
          // The source LiDAR is sub-metre.  Giro3D's full default hillshade
          // over-accentuates tiny changes into nearly black bands at close range.
          // Keep relief legible while preserving the colour and geometry layers.
          lighting: {
            enabled: true,
            hillshadeIntensity: 0.55,
            zFactor: 0.65,
          },
          discardNoData: true,
          terrain: { stitching: true },
        });
        await instance.add(map);
        if (disposed) return;

        await map.addLayer(new ElevationLayer({
          name: 'LiDAR elevation',
          extent,
          minmax: {
            min: catalog.heightOriginNgfIgn69Metres,
            max: catalog.heightMaximumNgfIgn69Metres,
          },
          preloadImages: false,
          source: new AggregateImageSource({
            sources: catalog.terrainTiles.map((terrain) => new GeoTIFFSource({
              url: spatialAssetUrl(terrain.elevation.path),
              crs,
              cacheOptions: { cacheSize: 32, blockSize: 262_144 },
              workerConcurrency: 2,
            })),
          }),
        }));
        if (disposed) return;
        await map.addLayer(new ColorLayer({
          name: 'Aperçu couleur',
          extent,
          source: new AggregateImageSource({
            sources: catalog.terrainTiles.map((terrain) => {
              const terrainExtent = createExtent(crs, terrain.bounds);
              return new StaticImageSource({
                source: spatialAssetUrl(terrain.colour.path),
                extent: terrainExtent,
              });
            }),
          }),
        }));

        if (disposed || !instance) return;
        focusRef.current = () => {
          const zone = catalog.zones[0];
          // Une action explicite de centrage est aussi une tentative sûre de
          // reprise après un échec réseau transitoire d'une tuile détaillée.
          failedDetails.clear();
          focusBounds(zone.bounds);
        };
        focusRef.current();
        callbacksRef.current.onReady();
      } catch (error) {
        if (!disposed) {
          callbacksRef.current.onError(
            error instanceof Error ? error.message : 'Le rendu cartographique n’a pas pu être initialisé.',
          );
        }
      }
    };

    void mount();
    return () => {
      disposed = true;
      focusRef.current = null;
      if (detailRefreshTimer !== null) window.clearTimeout(detailRefreshTimer);
      controls?.removeEventListener('change', requestDetailRefresh);
      controls?.dispose();
      for (const object of detailObjects.values()) disposeObject(object);
      detailObjects.clear();
      instance?.dispose();
    };
  }, [catalog]);

  return <div ref={hostRef} className="spatial-map-canvas" aria-label="Carte 3D de la zone Die–Pontaix" />;
}
