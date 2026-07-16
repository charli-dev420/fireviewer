import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FireWarningHomePage } from './components/public/FireWarningHomePage';
import { FireWarningIncidentsPage } from './components/public/FireWarningIncidentsPage';
import {
  FireWarningAddEvidencePage,
  FireWarningContributionTrackingPage,
  FireWarningIncidentErrorPage,
  FireWarningReportPage,
} from './components/public/FireWarningContributionPages';
import { PublicIncidentRealPage } from './components/public/PublicIncidentRealPage';
import {
  AccessibilityPage,
  AccountPage,
  AboutPage,
  LegalPage,
  OperationPage,
  PrivacyPage,
  SettingsPage,
} from './components/public/FireWarningBasicPages';
import { PublicSiteShell } from './components/public/FireWarningPublicShell';
import { PublicIcon, type PublicIconName } from './components/public/PublicIcon';
import { getDataMode, isAbortError, loadViewerManifest } from './lib/manifestClient';
import { loadPublicIncidentView, type PublicIncidentView } from './lib/publicIncidentView';
import { VIEWER_MANIFEST_FIRE_ID_RE } from './lib/viewerManifest';
import { resolveAppRoute } from './routing';

const AdminApp = lazy(() => import('./components/admin/AdminApp'));

const LIVE_REFRESH_INTERVAL_MS = 300_000;
const E2E_REFRESH_INTERVAL_MS = 100;

export interface AppProps {
  /** Injectable uniquement par les tests ; la production reste à cinq minutes. */
  refreshIntervalMs?: number;
}

type ManifestLoadResult = Awaited<ReturnType<typeof loadViewerManifest>>;
type PublicDetailRequest = Promise<{ readonly view: PublicIncidentView | null; readonly error: unknown | null }>;

type LiveManifestState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      result: ManifestLoadResult;
      stale: boolean;
      refreshing: boolean;
      refreshError: unknown | null;
      detailRequest: PublicDetailRequest;
    }
  | { kind: 'error'; error: unknown };

interface SafeError {
  readonly title: string;
  readonly description: string;
  readonly traceId: string | null;
}

function isValidFireId(value: string): boolean {
  return VIEWER_MANIFEST_FIRE_ID_RE.test(value);
}

function errorProperty(error: unknown, key: 'status' | 'kind' | 'traceId'): unknown {
  if (!error || typeof error !== 'object') return undefined;
  return (error as Record<string, unknown>)[key];
}

function toSafeError(error: unknown): SafeError {
  const status = errorProperty(error, 'status');
  const kind = errorProperty(error, 'kind');
  const traceId = errorProperty(error, 'traceId');
  const safeTraceId = typeof traceId === 'string' && traceId.length > 0 ? traceId : null;

  if (status === 404) return { title: 'Incident introuvable', description: 'Aucune fiche publique ne correspond à cet identifiant.', traceId: safeTraceId };
  if (status === 410) return { title: 'Incident retiré', description: 'Cet incident n’est plus publié par le service.', traceId: safeTraceId };
  if (status === 503) return { title: 'Service temporairement indisponible', description: 'La fiche ne peut pas être revalidée pour le moment.', traceId: safeTraceId };
  if (kind === 'timeout') return { title: 'Délai d’attente dépassé', description: 'Le service n’a pas répondu dans le délai autorisé.', traceId: safeTraceId };
  if (kind === 'network') return { title: 'Service inaccessible', description: 'La connexion au service de consultation est indisponible.', traceId: safeTraceId };
  if (kind === 'parse') return { title: 'Réponse non conforme', description: 'La fiche reçue ne respecte pas le contrat public attendu.', traceId: safeTraceId };
  if (kind === 'configuration' || status === 400) return { title: 'Identifiant ou configuration invalide', description: 'Cette fiche publique ne peut pas être demandée.', traceId: safeTraceId };
  return { title: 'Impossible de charger la fiche', description: 'Une erreur non détaillée a interrompu la consultation publique.', traceId: safeTraceId };
}

function ManifestLoadingScreen() {
  return (
    <PublicStateScreen
      icon="flame"
      eyebrow="Fiche incendie"
      title="Chargement de l’incident"
      description="Les dernières informations publiques sont en cours de récupération."
      loading
    />
  );
}

function PublicStateScreen({ icon, eyebrow, title, description, action, traceId, loading = false }: {
  readonly icon: PublicIconName;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly action?: React.ReactNode;
  readonly traceId?: string | null;
  readonly loading?: boolean;
}) {
  return (
    <section className="fw-public-state" aria-labelledby="fw-public-state-title" role={loading ? 'status' : undefined} aria-live={loading ? 'polite' : undefined}>
      <div className="fw-page fw-public-state__inner">
        <span className="fw-public-state__icon"><PublicIcon name={icon} size={30} /></span>
        <p className="fw-public-state__eyebrow">{eyebrow}</p>
        <h1 id="fw-public-state-title">{title}</h1>
        <p className="fw-public-state__description">{description}</p>
        {traceId ? <p className="fw-public-state__trace">Code de suivi : <code>{traceId}</code></p> : null}
        {loading ? <span className="fw-public-state__progress" aria-hidden="true"><i /></span> : null}
        {action ? <div className="fw-public-state__action">{action}</div> : null}
      </div>
    </section>
  );
}

function ManifestErrorScreen({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const safeError = toSafeError(error);
  return (
    <PublicStateScreen
      icon="warning"
      eyebrow="Consultation interrompue"
      title={safeError.title}
      description={safeError.description}
      traceId={safeError.traceId}
      action={<button type="button" className="fw-button fw-button--primary" onClick={onRetry}>Réessayer <PublicIcon name="arrow" size={17} /></button>}
    />
  );
}

function PublicDataModeScreen({ dataMode }: { readonly dataMode: ReturnType<typeof getDataMode> }) {
  return (
    <PublicStateScreen
      icon="warning"
      eyebrow="Fiche publique indisponible"
      title="La consultation n’est pas configurée"
      description={dataMode === 'mock'
        ? 'Le mode démonstration ne diffuse aucune donnée fictive sur les pages publiques.'
        : 'Cette instance ne fournit pas encore l’origine de l’API nécessaire à cette fiche.'}
      action={<a className="fw-button fw-button--primary" href="/">Retourner à l’accueil <PublicIcon name="arrow" size={17} /></a>}
    />
  );
}

function PublicIncidentAddressRequiredScreen() {
  return (
    <PublicStateScreen
      icon="search"
      eyebrow="Recherche d’incident"
      title="Identifiant d’incident requis"
      description="Utilisez la recherche de l’accueil ou la liste des incendies en cours pour ouvrir une fiche."
      action={<a className="fw-button fw-button--primary" href="/incendies">Voir les incendies <PublicIcon name="arrow" size={17} /></a>}
    />
  );
}

function resolveRefreshInterval(explicitInterval?: number): number {
  if (typeof explicitInterval === 'number' && Number.isFinite(explicitInterval) && explicitInterval > 0) return explicitInterval;
  if (import.meta.env.DEV && import.meta.env.VITE_E2E_TEST_MODE === 'true') return E2E_REFRESH_INTERVAL_MS;
  return LIVE_REFRESH_INTERVAL_MS;
}

function LiveManifestApp({ fireId, refreshIntervalMs }: { readonly fireId: string; readonly refreshIntervalMs?: number }) {
  const refreshInterval = resolveRefreshInterval(refreshIntervalMs);
  const [state, setState] = useState<LiveManifestState>({ kind: 'loading' });
  const latestSuccessRef = useRef<ManifestLoadResult | null>(null);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!isValidFireId(fireId)) {
      setState({ kind: 'error', error: { status: 400, kind: 'configuration' } });
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const previousResult = latestSuccessRef.current;
    // Start the independent, richer projection at the same time as the lightweight manifest.
    // Its failure must never prevent the manifest fallback from rendering.
    const detailRequest: PublicDetailRequest = loadPublicIncidentView(fireId, controller.signal)
      .then((view) => ({ view, error: null }))
      .catch((error: unknown) => ({ view: null, error }));
    if (previousResult) {
      setState((current) => ({
        kind: 'ready',
        result: previousResult,
        stale: current.kind === 'ready' ? current.stale : false,
        refreshing: true,
        refreshError: current.kind === 'ready' ? current.refreshError : null,
        detailRequest,
      }));
    } else {
      setState({ kind: 'loading' });
    }
    try {
      const result = await loadViewerManifest(fireId, { signal: controller.signal });
      if (controller.signal.aborted || requestRef.current !== requestId) return;
      latestSuccessRef.current = result;
      document.title = `Fire-Viewer — ${result.summary.fireId}`;
      setState({ kind: 'ready', result, stale: false, refreshing: false, refreshError: null, detailRequest });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || requestRef.current !== requestId) return;
      if (previousResult) setState({ kind: 'ready', result: previousResult, stale: true, refreshing: false, refreshError: error, detailRequest });
      else setState({ kind: 'error', error });
    }
  }, [fireId]);

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

  if (state.kind === 'loading') return <PublicSiteShell section="incident"><ManifestLoadingScreen /></PublicSiteShell>;
  if (state.kind === 'error') return <PublicSiteShell section="incident"><ManifestErrorScreen error={state.error} onRetry={() => void refresh()} /></PublicSiteShell>;

  const safeRefreshError = state.refreshError ? toSafeError(state.refreshError) : null;
  return (
    <PublicSiteShell section="incident">
      <div className="fw-incident-runtime">
        <div className="fw-incident-runtime__notice"><PublicIcon name="shield" size={18} /><span>{state.result.summary.publicNotice}</span></div>
        {safeRefreshError ? (
          <div className="fw-incident-runtime__warning" role="status">
            <PublicIcon name="warning" size={18} />
            <span>{safeRefreshError.title}. Les données affichées sont le dernier manifeste validé.{safeRefreshError.traceId ? ` Code de suivi : ${safeRefreshError.traceId}.` : ''}</span>
          </div>
        ) : null}
        <PublicIncidentRealPage
          summary={state.result.summary}
          checkedAt={state.result.checkedAt}
          stale={state.stale}
          refreshing={state.refreshing}
          onRefresh={() => void refresh()}
          detailRequest={state.detailRequest}
        />
      </div>
    </PublicSiteShell>
  );
}

function PublicZoneRetiredScreen() {
  return (
    <PublicSiteShell section="home">
      <PublicStateScreen
        icon="map"
        eyebrow="Adresse retirée"
        title="Les zones techniques ne sont pas publiques"
        description="Chaque page publique correspond à un incendie unique. Les anciennes cartes par zone ne sont plus accessibles."
        action={<a className="fw-button fw-button--primary" href="/incendies">Voir les incendies <PublicIcon name="arrow" size={17} /></a>}
      />
    </PublicSiteShell>
  );
}

function PublicPage({ section }: { readonly section: Extract<ReturnType<typeof resolveAppRoute>, { kind: 'public-page' }>['section'] }) {
  const content = section === 'incidents' ? <FireWarningIncidentsPage />
    : section === 'report' ? <FireWarningReportPage />
      : section === 'account' ? <AccountPage />
        : section === 'settings' ? <SettingsPage />
          : section === 'operation' ? <OperationPage />
            : section === 'privacy' ? <PrivacyPage />
              : section === 'accessibility' ? <AccessibilityPage />
                : section === 'legal' ? <LegalPage /> : <AboutPage />;
  return <PublicSiteShell section={section}>{content}</PublicSiteShell>;
}

export default function App({ refreshIntervalMs }: AppProps) {
  const route = resolveAppRoute();
  if (route.kind === 'admin') {
    return <Suspense fallback={<div className="admin-route-loading" role="status">Chargement de l’administration…</div>}><AdminApp route={route.adminRoute} /></Suspense>;
  }
  if (route.kind === 'public-zone-retired') return <PublicZoneRetiredScreen />;
  if (route.kind === 'home') return <PublicSiteShell section="home"><FireWarningHomePage /></PublicSiteShell>;
  if (route.kind === 'public-page') return <PublicPage section={route.section} />;
  if (route.kind === 'public-add-evidence') return <PublicSiteShell section="report"><FireWarningAddEvidencePage fireId={route.fireId} /></PublicSiteShell>;
  if (route.kind === 'public-incident-report') return <PublicSiteShell section="incident"><FireWarningIncidentErrorPage fireId={route.fireId} /></PublicSiteShell>;
  if (route.kind === 'public-contribution') return <PublicSiteShell section="account"><FireWarningContributionTrackingPage contributionId={route.contributionId} /></PublicSiteShell>;
  if (route.kind === 'public-incident-address-required') return <PublicSiteShell section="incident"><PublicIncidentAddressRequiredScreen /></PublicSiteShell>;

  const dataMode = getDataMode();
  if (dataMode !== 'api') return <PublicSiteShell section="incident"><PublicDataModeScreen dataMode={dataMode} /></PublicSiteShell>;
  return <LiveManifestApp fireId={route.fireId} refreshIntervalMs={refreshIntervalMs} />;
}
