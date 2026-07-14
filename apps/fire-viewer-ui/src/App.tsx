import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './components/Icons';
import {
  getManifestStatusLabel,
  ManifestEmptyPanel,
  ManifestWorkspace,
} from './components/ManifestWorkspace';
import { getDataMode, isAbortError, loadViewerManifest } from './lib/manifestClient';
import { VIEWER_MANIFEST_FIRE_ID_RE } from './lib/viewerManifest';
import SpatialMapApp from './components/SpatialMapApp';
import type { ViewId } from './types';

/**
 * Le dashboard riche est un artefact de démonstration distinct du manifeste
 * public. Cette condition est pliée par Vite lors d'un build de production :
 * un build API (ou non configuré) ne référence donc même pas le module mock.
 * Vitest utilise MODE=test afin de pouvoir vérifier isolément le parcours mock
 * sans modifier le contrat de configuration de la production.
 */
const MockApp = (
  import.meta.env.VITE_USE_MOCKS === 'true' || import.meta.env.MODE === 'test'
)
  ? lazy(() => import('./MockApp'))
  : null;
const DEFAULT_FIRE_ID = 'FR-83-00042';
const validViews: ViewId[] = ['viewer', 'sources', 'history', 'journal'];
const LIVE_REFRESH_INTERVAL_MS = 300_000;
const E2E_REFRESH_INTERVAL_MS = 100;

function resolveRoute(): { fireId: string; view: ViewId } {
  const url = new URL(window.location.href);
  const queryFireId = url.searchParams.get('fire_id');
  const pathMatch = url.pathname.match(/^\/incident\/([^/]+)\/?$/);

  let fireId = pathMatch?.[1] ?? queryFireId ?? DEFAULT_FIRE_ID;
  fireId = decodeURIComponent(fireId).toUpperCase();

  if (!pathMatch && isValidFireId(fireId) && (url.protocol === 'http:' || url.protocol === 'https:')) {
    url.pathname = `/incident/${encodeURIComponent(fireId)}`;
    url.searchParams.delete('fire_id');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  const requestedView = url.searchParams.get('view') as ViewId | null;
  return {
    fireId,
    view: requestedView && validViews.includes(requestedView) ? requestedView : 'viewer',
  };
}

function isValidFireId(value: string): boolean {
  return VIEWER_MANIFEST_FIRE_ID_RE.test(value);
}

function isSpatialMapRoute(): boolean {
  return /^\/zones\/die-pontaix\/?$/.test(window.location.pathname);
}

export interface AppProps {
  /** Injectable uniquement par les tests ; la production reste à cinq minutes. */
  refreshIntervalMs?: number;
}

type ManifestLoadResult = Awaited<ReturnType<typeof loadViewerManifest>>;

type LiveManifestState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      result: ManifestLoadResult;
      stale: boolean;
      refreshing: boolean;
      refreshError: unknown | null;
    }
  | { kind: 'error'; error: unknown };

interface SafeError {
  title: string;
  description: string;
  traceId: string | null;
}

const liveTabs: Array<{ id: ViewId; label: string; icon: 'layers' | 'table' | 'history' | 'file-text' }> = [
  { id: 'viewer', label: 'Manifeste', icon: 'layers' },
  { id: 'sources', label: 'Sources', icon: 'table' },
  { id: 'history', label: 'Historique', icon: 'history' },
  { id: 'journal', label: 'Journal', icon: 'file-text' },
];

function errorProperty(error: unknown, key: 'status' | 'kind' | 'traceId'): unknown {
  if (!error || typeof error !== 'object') return undefined;
  return (error as Record<string, unknown>)[key];
}

function toSafeError(error: unknown): SafeError {
  const status = errorProperty(error, 'status');
  const kind = errorProperty(error, 'kind');
  const traceId = errorProperty(error, 'traceId');
  const safeTraceId = typeof traceId === 'string' && traceId.length > 0 ? traceId : null;

  if (status === 404) {
    return { title: 'Incident introuvable', description: 'Aucun manifeste public ne correspond à cet identifiant.', traceId: safeTraceId };
  }
  if (status === 410) {
    return { title: 'Incident retiré', description: 'Cet incident n’est plus publié par le service.', traceId: safeTraceId };
  }
  if (status === 503) {
    return { title: 'Service temporairement indisponible', description: 'Le manifeste ne peut pas être revalidé pour le moment.', traceId: safeTraceId };
  }
  if (kind === 'timeout') {
    return { title: 'Délai d’attente dépassé', description: 'Le service n’a pas répondu dans le délai autorisé.', traceId: safeTraceId };
  }
  if (kind === 'network') {
    return { title: 'Service inaccessible', description: 'La connexion au service de manifeste est indisponible.', traceId: safeTraceId };
  }
  if (kind === 'parse') {
    return { title: 'Réponse non conforme', description: 'Le manifeste reçu ne respecte pas le contrat public attendu.', traceId: safeTraceId };
  }
  if (kind === 'configuration' || status === 400) {
    return { title: 'Configuration ou identifiant invalide', description: 'La page ne peut pas demander ce manifeste public.', traceId: safeTraceId };
  }
  return {
    title: 'Impossible de charger le manifeste',
    description: 'Une erreur non détaillée a interrompu la consultation publique.',
    traceId: safeTraceId,
  };
}

function updateRouteView(view: ViewId): void {
  const url = new URL(window.location.href);
  if (view === 'viewer') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  window.requestAnimationFrame(() => {
    document.getElementById(`panel-${view}`)?.focus({ preventScroll: true });
  });
}

function ManifestNavigation({
  activeView,
  stale,
  onChange,
}: {
  activeView: ViewId;
  stale: boolean;
  onChange: (view: ViewId) => void;
}) {
  return (
    <nav className="manifest-nav" aria-label="Vues du manifeste">
      <div className="manifest-nav__inner" role="tablist" aria-label="Contenu public de l’incident">
        <div className="manifest-nav__tabs">
          {liveTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeView === tab.id}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              tabIndex={activeView === tab.id ? 0 : -1}
              className={`manifest-nav__tab ${activeView === tab.id ? 'is-active' : ''}`}
              onClick={() => onChange(tab.id)}
            >
              <Icon name={tab.icon} size={17} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <span className={`manifest-nav__state ${stale ? 'is-stale' : ''}`} aria-live="polite">
          {stale ? 'Dernier manifeste connu' : 'Manifeste revalidé'}
        </span>
      </div>
    </nav>
  );
}

function ConfigurationScreen() {
  return (
    <main className="error-screen" aria-labelledby="configuration-title">
      <div className="error-screen__card">
        <span className="error-screen__icon"><Icon name="warning" size={34} /></span>
        <div className="eyebrow">Configuration requise</div>
        <h1 id="configuration-title">N/A — mode de données non configuré</h1>
        <p>
          Définissez explicitement <code>VITE_USE_MOCKS=true</code> pour la démonstration ou
          <code> VITE_USE_MOCKS=false</code> avec une origine API HTTP(S) valide.
        </p>
      </div>
    </main>
  );
}

function ManifestLoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <span className="loading-screen__logo"><Icon name="flame" size={40} /></span>
      <div>
        <strong>Fire-Viewer</strong>
        <span>Chargement du manifeste public…</span>
      </div>
      <i />
    </div>
  );
}

function ManifestErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const safeError = toSafeError(error);
  return (
    <main className="error-screen" aria-labelledby="manifest-error-title">
      <div className="error-screen__card">
        <span className="error-screen__icon"><Icon name="warning" size={34} /></span>
        <div className="eyebrow">Chargement interrompu</div>
        <h1 id="manifest-error-title">{safeError.title}</h1>
        <p>{safeError.description}</p>
        {safeError.traceId ? <p>Code de suivi : <code>{safeError.traceId}</code></p> : null}
        <button type="button" className="button button--primary" onClick={onRetry}>
          <Icon name="refresh" size={17} />
          Réessayer
        </button>
      </div>
    </main>
  );
}

function resolveRefreshInterval(explicitInterval?: number): number {
  if (typeof explicitInterval === 'number' && Number.isFinite(explicitInterval) && explicitInterval > 0) {
    return explicitInterval;
  }
  if (import.meta.env.DEV && import.meta.env.VITE_E2E_TEST_MODE === 'true') {
    return E2E_REFRESH_INTERVAL_MS;
  }
  return LIVE_REFRESH_INTERVAL_MS;
}

function LiveManifestApp({ refreshIntervalMs }: AppProps) {
  const route = useRef(resolveRoute()).current;
  const refreshInterval = resolveRefreshInterval(refreshIntervalMs);
  const [activeView, setActiveView] = useState<ViewId>(route.view);
  const [state, setState] = useState<LiveManifestState>({ kind: 'loading' });
  const latestSuccessRef = useRef<ManifestLoadResult | null>(null);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!isValidFireId(route.fireId)) {
      setState({ kind: 'error', error: { status: 400, kind: 'configuration' } });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const previousResult = latestSuccessRef.current;

    if (previousResult) {
      setState((current) => ({
        kind: 'ready',
        result: previousResult,
        // Un cache déjà obsolète ne redevient actuel qu'après 200/304 valide.
        stale: current.kind === 'ready' ? current.stale : false,
        refreshing: true,
        refreshError: current.kind === 'ready' ? current.refreshError : null,
      }));
    } else {
      setState({ kind: 'loading' });
    }

    try {
      const result = await loadViewerManifest(route.fireId, { signal: controller.signal });
      if (controller.signal.aborted || requestRef.current !== requestId) return;
      latestSuccessRef.current = result;
      document.title = `Fire-Viewer — ${result.summary.fireId}`;
      setState({ kind: 'ready', result, stale: false, refreshing: false, refreshError: null });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || requestRef.current !== requestId) return;
      if (previousResult) {
        setState({ kind: 'ready', result: previousResult, stale: true, refreshing: false, refreshError: error });
      } else {
        setState({ kind: 'error', error });
      }
    }
  }, [route.fireId]);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);

  useEffect(() => {
    const revalidateWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const interval = window.setInterval(revalidateWhenVisible, refreshInterval);
    document.addEventListener('visibilitychange', revalidateWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', revalidateWhenVisible);
    };
  }, [refresh, refreshInterval]);

  const changeView = useCallback((view: ViewId) => {
    setActiveView(view);
    updateRouteView(view);
  }, []);

  if (state.kind === 'loading') return <ManifestLoadingScreen />;
  if (state.kind === 'error') return <ManifestErrorScreen error={state.error} onRetry={() => void refresh()} />;

  const { summary } = state.result;
  const safeRefreshError = state.refreshError ? toSafeError(state.refreshError) : null;
  return (
    <div className="app-shell manifest-app-shell">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <header className="manifest-app-header">
        <div className="manifest-app-header__inner">
          <div className="manifest-brand" aria-label="Fire-Viewer manifeste public">
            <Icon name="flame" size={28} />
            <span>FIRE-VIEWER</span>
          </div>
          <div className="manifest-heading">
            <h1>{summary.fireId}</h1>
            <span>{getManifestStatusLabel(summary.statusCode)} · manifeste public</span>
            <span>Épisode {summary.episodeId}</span>
          </div>
        </div>
      </header>
      <ManifestNavigation activeView={activeView} stale={state.stale} onChange={changeView} />
      <div className="manifest-safety-strip">
        <Icon name="shield" size={18} />
        <span>{summary.publicNotice}</span>
      </div>
      {safeRefreshError ? (
        <div className="manifest-refresh-error" role="status">
          <Icon name="warning" size={18} />
          <span>
            {safeRefreshError.title}. Les données affichées sont le dernier manifeste validé.
            {safeRefreshError.traceId ? ` Code de suivi : ${safeRefreshError.traceId}.` : ''}
          </span>
        </div>
      ) : null}
      <main id="main-content" className="manifest-main-content">
        {activeView === 'viewer' ? (
          <ManifestWorkspace
            summary={summary}
            checkedAt={state.result.checkedAt}
            stale={state.stale}
            refreshing={state.refreshing}
            onRefresh={() => void refresh()}
          />
        ) : null}
        {activeView === 'sources' ? <ManifestEmptyPanel view="sources" /> : null}
        {activeView === 'history' ? <ManifestEmptyPanel view="history" /> : null}
        {activeView === 'journal' ? <ManifestEmptyPanel view="journal" /> : null}
      </main>
      <footer className="manifest-app-footer">
        <span>FIRE-VIEWER · manifeste public minimal</span>
        <span>Schéma {summary.schemaVersion} · aucune vue 3D chargée</span>
      </footer>
    </div>
  );
}

export default function App({ refreshIntervalMs }: AppProps) {
  if (isSpatialMapRoute()) return <SpatialMapApp />;
  const dataMode = getDataMode();
  if (dataMode === 'unconfigured') return <ConfigurationScreen />;
  if (dataMode === 'mock') {
    if (!MockApp) return <ConfigurationScreen />;
    return (
      <Suspense fallback={<ManifestLoadingScreen />}>
        <MockApp />
      </Suspense>
    );
  }
  return <LiveManifestApp refreshIntervalMs={refreshIntervalMs} />;
}
