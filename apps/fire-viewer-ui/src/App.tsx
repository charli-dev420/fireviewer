import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { HistoryView } from './components/HistoryView';
import { Icon } from './components/Icons';
import { JournalView } from './components/JournalView';
import { PrimaryNav } from './components/PrimaryNav';
import { SourcesView } from './components/SourcesView';
import { StatusPill } from './components/StatusPill';
import { TextViewDialog } from './components/TextViewDialog';
import { Toast } from './components/Toast';
import { ViewerWorkspace } from './components/ViewerWorkspace';
import { defaultLayers } from './data/demoIncident';
import { IncidentApiError, isValidFireId, loadIncident } from './lib/api';
import type { IncidentData, LayerVisibility, ViewId, ViewerState } from './types';

const DEFAULT_FIRE_ID = 'FR-83-00042';
const validViews: ViewId[] = ['viewer', 'sources', 'history', 'journal'];

interface ToastState {
  message: string;
  tone: 'success' | 'info' | 'warning';
}

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

export default function App() {
  const route = useRef(resolveRoute()).current;
  const [incident, setIncident] = useState<IncidentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<IncidentApiError | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(route.view);
  const [viewerState, setViewerState] = useState<ViewerState>('INITIALIZING');
  const [layers, setLayers] = useState<LayerVisibility>({ ...defaultLayers });
  const [offline, setOffline] = useState(false);
  const [operatorMode, setOperatorMode] = useState(false);
  const [textViewOpen, setTextViewOpen] = useState(false);
  const [activeVersion, setActiveVersion] = useState(4);
  const [activeHash, setActiveHash] = useState('9ad3d8f2c41e');
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const updateTimerRef = useRef<number | null>(null);

  const notify = useCallback((message: string, tone: ToastState['tone'] = 'info') => {
    setToast({ message, tone });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const controller = new AbortController();

    async function bootstrap() {
      setLoading(true);
      setError(null);
      setViewerState('INITIALIZING');

      if (!isValidFireId(route.fireId)) {
        setError(new IncidentApiError('Identifiant incident invalide. Utilisez le format FR-83-00042.', 400));
        setLoading(false);
        return;
      }

      try {
        const data = await loadIncident(route.fireId, controller.signal);
        if (controller.signal.aborted) return;
        setIncident(data);
        setActiveVersion(data.asset.version);
        setActiveHash(data.asset.hash);
        setViewerState('METADATA_READY');
        document.title = `Fire-Viewer — ${data.fireId}`;

        window.setTimeout(() => {
          if (!controller.signal.aborted) setViewerState('MODEL_LOADING');
        }, 300);
        window.setTimeout(() => {
          if (!controller.signal.aborted) setViewerState('READY');
        }, 1_250);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof IncidentApiError
            ? loadError
            : new IncidentApiError('Erreur inattendue lors du chargement.'),
        );
        setViewerState('ERROR');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void bootstrap();
    return () => controller.abort();
  }, [route.fireId]);

  useEffect(() => {
    return () => {
      if (updateTimerRef.current !== null) window.clearInterval(updateTimerRef.current);
    };
  }, []);

  const changeView = (view: ViewId) => {
    setActiveView(view);
    const url = new URL(window.location.href);
    if (view === 'viewer') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    window.requestAnimationFrame(() => {
      document.getElementById(`panel-${view}`)?.focus({ preventScroll: true });
    });
  };

  const changeLayer = (key: keyof LayerVisibility, value: boolean) => {
    setLayers((current) => ({ ...current, [key]: value }));
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify('Lien canonique copié.', 'success');
    } catch {
      notify('La copie automatique est indisponible; utilisez la barre d’adresse.', 'warning');
    }
  };

  const toggleOffline = () => {
    setOffline((current) => {
      const next = !current;
      notify(
        next
          ? 'Mode hors ligne simulé : la fraîcheur est maintenant explicitement signalée.'
          : 'Réseau rétabli : le manifeste peut être revalidé.',
        next ? 'warning' : 'success',
      );
      return next;
    });
  };

  const toggleDegraded = () => {
    setViewerState((current) => {
      const next: ViewerState = current === 'DEGRADED' ? 'READY' : 'DEGRADED';
      notify(
        next === 'DEGRADED'
          ? 'Panne 3D simulée : la vue texte et les métadonnées restent actives.'
          : 'Rendu 3D réactivé.',
        next === 'DEGRADED' ? 'warning' : 'success',
      );
      return next;
    });
  };

  const simulateUpdate = () => {
    if (offline) {
      notify('La mise à jour ne peut pas démarrer en mode hors ligne.', 'warning');
      return;
    }
    if (updateTimerRef.current !== null || viewerState === 'MODEL_LOADING') return;

    setUpdateProgress(4);
    setViewerState('MODEL_LOADING');
    let progress = 4;
    updateTimerRef.current = window.setInterval(() => {
      progress = Math.min(100, progress + Math.max(4, Math.round((100 - progress) / 7)));
      setUpdateProgress(progress);
      if (progress >= 100) {
        if (updateTimerRef.current !== null) window.clearInterval(updateTimerRef.current);
        updateTimerRef.current = null;
        window.setTimeout(() => {
          setActiveVersion(5);
          setActiveHash('c51f7b19e43d');
          setUpdateProgress(null);
          setViewerState('READY');
          notify('Version v5 activée après validation; les marqueurs sont restés ancrés géographiquement.', 'success');
        }, 420);
      }
    }, 180);
  };

  const resetApp = () => {
    if (updateTimerRef.current !== null) window.clearInterval(updateTimerRef.current);
    updateTimerRef.current = null;
    setLayers({ ...defaultLayers });
    setOffline(false);
    setOperatorMode(false);
    setTextViewOpen(false);
    setActiveVersion(incident?.asset.version ?? 4);
    setActiveHash(incident?.asset.hash ?? '9ad3d8f2c41e');
    setUpdateProgress(null);
    setViewerState('READY');
    changeView('viewer');
    notify('Interface réinitialisée.', 'success');
  };

  if (loading) {
    return (
      <div className="loading-screen" role="status" aria-live="polite">
        <span className="loading-screen__logo"><Icon name="flame" size={40} /></span>
        <div>
          <strong>Fire-Viewer</strong>
          <span>Validation de l’identifiant et chargement des métadonnées…</span>
        </div>
        <i />
      </div>
    );
  }

  if (error || !incident) {
    return (
      <main className="error-screen">
        <div className="error-screen__card">
          <span className="error-screen__icon"><Icon name="warning" size={34} /></span>
          <div className="eyebrow">Chargement interrompu</div>
          <h1>{error?.status === 404 ? 'Incident introuvable' : 'Impossible d’ouvrir cette page'}</h1>
          <p>{error?.message ?? 'Aucune donnée disponible.'}</p>
          <a className="button button--primary" href={`/incident/${DEFAULT_FIRE_ID}`}>
            Ouvrir l’incident de démonstration
          </a>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <AppHeader
        incident={incident}
        viewerState={viewerState}
        offline={offline}
        operatorMode={operatorMode}
        onToggleOffline={toggleOffline}
        onToggleOperatorMode={() => {
          setOperatorMode((current) => !current);
          notify(operatorMode ? 'Vue publique activée.' : 'Vue opérateur de démonstration activée.', 'info');
        }}
        onToggleDegraded={toggleDegraded}
        onSimulateUpdate={simulateUpdate}
        onReset={resetApp}
      />
      <PrimaryNav
        activeView={activeView}
        onChange={changeView}
        viewerState={viewerState}
        offline={offline}
        observationCount={operatorMode ? incident.observations.length : 3}
      />

      <div className="mobile-status-strip" aria-label="Statut de l’incident">
        <StatusPill code={incident.status.code} label={incident.status.label} compact />
        <span>position ± {incident.frame.horizontalUncertaintyM} m</span>
      </div>

      {offline ? (
        <div className="offline-banner" role="status">
          <Icon name="offline" size={19} />
          <div>
            <strong>Mode hors ligne — dernière synchronisation conservée</strong>
            <span>Le statut n’est pas présenté comme actuel tant que le manifeste n’a pas été revalidé.</span>
          </div>
        </div>
      ) : null}

      <div className="safety-strip">
        <Icon name="shield" size={17} />
        <span>
          Démonstration fictive. Terrain daté, périmètre estimé, aucune prévision de propagation. En urgence : 18 ou 112.
        </span>
      </div>

      <main id="main-content" className="main-content">
        {activeView === 'viewer' ? (
          <ViewerWorkspace
            incident={incident}
            layers={layers}
            viewerState={viewerState}
            activeVersion={activeVersion}
            activeHash={activeHash}
            offline={offline}
            updateProgress={updateProgress}
            onLayerChange={changeLayer}
            onNavigate={changeView}
            onCopyLink={copyLink}
            onOpenTextView={() => setTextViewOpen(true)}
            onNotify={notify}
          />
        ) : null}
        {activeView === 'sources' ? (
          <SourcesView incident={incident} operatorMode={operatorMode} onNotify={notify} />
        ) : null}
        {activeView === 'history' ? (
          <HistoryView incident={incident} operatorMode={operatorMode} onNotify={notify} />
        ) : null}
        {activeView === 'journal' ? (
          <JournalView incident={incident} operatorMode={operatorMode} onNotify={notify} />
        ) : null}
      </main>

      <footer className="app-footer">
        <span>FIRE-VIEWER · shell accessible et moteur-agnostique</span>
        <span>Incident fictif {incident.fireId} · manifeste 2.0 · modèle v{activeVersion}</span>
      </footer>

      <TextViewDialog
        open={textViewOpen}
        incident={incident}
        activeVersion={activeVersion}
        activeHash={activeHash}
        offline={offline}
        onClose={() => setTextViewOpen(false)}
      />
      <Toast
        message={toast?.message ?? null}
        tone={toast?.tone}
        onDismiss={dismissToast}
      />
    </div>
  );
}
