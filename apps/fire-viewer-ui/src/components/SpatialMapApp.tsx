import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icons';
import { loadSpatialCatalog, type SpatialCatalog } from '../lib/spatialCatalog';
import type { DetailLoadState } from './Giro3DMap';

const Giro3DMap = lazy(() => import('./Giro3DMap'));

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function LoadingState() {
  return (
    <main className="spatial-map-state" role="status" aria-live="polite">
      <Icon name="layers" size={32} />
      <h1>Préparation de la carte 3D</h1>
      <p>Lecture du catalogue local des terrains et couches détaillées…</p>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="spatial-map-state spatial-map-state--error" role="alert">
      <Icon name="warning" size={32} />
      <h1>Carte 3D indisponible</h1>
      <p>{message}</p>
    </main>
  );
}

function MapMetrics({ catalog }: { catalog: SpatialCatalog }) {
  const totalRoutes = useMemo(
    () => catalog.featureTiles.reduce((total, tile) => total + tile.features.routeCount, 0),
    [catalog],
  );
  const totalTrees = useMemo(
    () => catalog.featureTiles.reduce((total, tile) => total + tile.features.treeCount, 0),
    [catalog],
  );

  return (
    <dl className="spatial-map-metrics" aria-label="Contenu de la carte">
      <div><dt>Terrains</dt><dd>{catalog.terrainTiles.length}</dd></div>
      <div><dt>Tuiles détaillées</dt><dd>{catalog.featureTiles.length}</dd></div>
      <div><dt>Routes et chemins</dt><dd>{totalRoutes.toLocaleString('fr-FR')}</dd></div>
      <div><dt>Arbres</dt><dd>{totalTrees.toLocaleString('fr-FR')}</dd></div>
    </dl>
  );
}

function MapFallback({ catalog, message }: { catalog: SpatialCatalog; message: string }) {
  return (
    <main className="spatial-map-page" id="main-content">
      <section className="spatial-map-intro" aria-labelledby="spatial-map-title">
        <div>
          <p className="section-kicker">Démonstration technique 3D locale</p>
          <h1 id="spatial-map-title">Zone Die–Pontaix</h1>
          <p>
            Le catalogue local reste disponible, mais cette vue ne peut pas initialiser le rendu 3D dans ce navigateur.
          </p>
        </div>
        <MapMetrics catalog={catalog} />
      </section>
      <section className="spatial-map-fallback" aria-labelledby="spatial-map-fallback-title">
        <Icon name="warning" size={28} />
        <div>
          <h2 id="spatial-map-fallback-title">Rendu 3D indisponible</h2>
          <p>{message}</p>
          <p>
            La carte ne consulte ni Cesium, ni fond cartographique externe, ni données d’incident. La zone de démonstration
            Die–Pontaix et ses deux couvertures techniques restent des fichiers statiques du même domaine.
          </p>
        </div>
      </section>
    </main>
  );
}

interface SpatialMapRenderBoundaryProps {
  catalog: SpatialCatalog;
  children: ReactNode;
}

interface SpatialMapRenderBoundaryState {
  failed: boolean;
}

/**
 * Un échec de chargement du chunk lazy ne traverse pas `Giro3DMap` et ne peut
 * donc pas appeler son callback `onError`. Cette frontière garantit le même
 * parcours DOM sûr dans ce cas, sans afficher le détail de l'erreur réseau.
 */
export class SpatialMapRenderBoundary extends Component<
  SpatialMapRenderBoundaryProps,
  SpatialMapRenderBoundaryState
> {
  state: SpatialMapRenderBoundaryState = { failed: false };

  static getDerivedStateFromError(): SpatialMapRenderBoundaryState {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <MapFallback
          catalog={this.props.catalog}
          message="Le moteur 3D local n’a pas pu être chargé. Réessayez après avoir rechargé la page."
        />
      );
    }
    return this.props.children;
  }
}

function MapWorkspace({ catalog }: { catalog: SpatialCatalog }) {
  const [focusRequest, setFocusRequest] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<DetailLoadState>({ active: 0, expected: 0, failures: 0 });
  const webGlAvailable = useMemo(supportsWebGl, []);

  if (!webGlAvailable) {
    return <MapFallback catalog={catalog} message="WebGL est nécessaire pour afficher le relief et les couches 3D locales dans ce navigateur." />;
  }
  if (renderError) return <MapFallback catalog={catalog} message={renderError} />;

  return (
    <main className="spatial-map-page" id="main-content">
      <section className="spatial-map-intro" aria-labelledby="spatial-map-title">
        <div>
          <p className="section-kicker">Démonstration technique 3D locale</p>
          <h1 id="spatial-map-title">Zone Die–Pontaix</h1>
          <p>
            Relief LiDAR, bâtiments, routes, chemins, lisières végétales et arbres sont lus depuis le même domaine,
            sans Cesium ni fond cartographique externe. Ce parcours /demo ne constitue pas le catalogue public multi-zones.
          </p>
        </div>
        <MapMetrics catalog={catalog} />
      </section>

      <section className="spatial-map-viewer" aria-label="Vue cartographique 3D">
        <div className="spatial-map-toolbar">
          <div className="spatial-map-zones" role="group" aria-label="Zone de démonstration et recentrage de la carte">
            <span className="spatial-map-zone-name">Zone Die–Pontaix</span>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setFocusRequest((current) => current + 1)}
            >
              Recentrer la zone
            </button>
          </div>
          <p className="spatial-map-load-state" role="status" aria-live="polite">
            {sceneReady
              ? detailState.expected > 0
                ? `${detailState.active} / ${detailState.expected} tuiles détaillées actives autour de la caméra`
                : 'Vue lointaine : relief et aperçu couleur uniquement'
              : 'Initialisation du relief…'}
            {detailState.failures > 0 ? ` · ${detailState.failures} couche(s) détaillée(s) indisponible(s)` : ''}
          </p>
        </div>
        <SpatialMapRenderBoundary catalog={catalog}>
          <Suspense fallback={<div className="spatial-map-canvas spatial-map-canvas--loading" role="status">Chargement du moteur 3D…</div>}>
            <Giro3DMap
              catalog={catalog}
              focusRequest={focusRequest}
              onReady={() => setSceneReady(true)}
              onError={setRenderError}
              onDetailState={setDetailState}
            />
          </Suspense>
        </SpatialMapRenderBoundary>
        <p className="spatial-map-caption">
          À distance, les COG utilisent leurs aperçus internes. En approchant, les tuiles GLB chargent la géométrie
          complète sans simplification supplémentaire.
        </p>
      </section>
    </main>
  );
}

export default function SpatialMapApp() {
  const [catalog, setCatalog] = useState<SpatialCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Fire-Viewer — Carte 3D Zone Die–Pontaix';
    const controller = new AbortController();
    void loadSpatialCatalog(controller.signal)
      .then((result) => setCatalog(result))
      .catch((cause) => {
        if (controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause.message : 'Le catalogue spatial ne peut pas être chargé.');
      });
    return () => controller.abort();
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!catalog) return <LoadingState />;
  return <MapWorkspace catalog={catalog} />;
}
