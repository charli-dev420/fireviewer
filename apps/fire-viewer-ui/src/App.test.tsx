// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerManifestSummary } from './lib/viewerManifest';

const manifestClient = vi.hoisted(() => ({
  getDataMode: vi.fn(),
  isAbortError: vi.fn(() => false),
  loadViewerManifest: vi.fn(),
}));

vi.mock('./lib/manifestClient', () => manifestClient);

import App from './App';

function createSummary(overrides: Partial<ViewerManifestSummary> = {}): ViewerManifestSummary {
  return {
    schemaVersion: '2.0',
    fireId: 'FR-83-00042',
    episodeId: 'E03',
    statusCode: 'MONITORING',
    validatedAt: '2026-01-15T08:05:00Z',
    reviewRequired: false,
    location: {
      type: 'Point',
      coordinates: [2, 46],
      horizontal_uncertainty_m: 250,
      altitude_m: null,
      vertical_datum: null,
    },
    asset: null,
    frame: null,
    freshness: {
      incident_at: '2026-01-15T08:24:00Z',
      terrain_source_year: null,
      generated_at: null,
    },
    modelState: 'not_available',
    publicNotice: 'Jeu de données de démonstration entièrement fictif.',
    sources: [],
    history: [],
    journal: [],
    ...overrides,
  };
}

function createResult(summary = createSummary()) {
  return {
    summary,
    etag: '"manifest-v1"',
    checkedAt: '2026-01-15T08:30:00Z',
    revalidated: false,
    notModified: false,
  };
}

function setAdminSessionCookie(): void {
  document.cookie = 'fireviewer_csrf=admin-ui-test-csrf; Path=/; SameSite=Strict';
}

function clearAdminSessionCookie(): void {
  document.cookie = 'fireviewer_csrf=; Path=/; Max-Age=0';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function adminZone(zoneId = 'ALPES-TEST') {
  return {
    zone_id: zoneId,
    label: `Zone ${zoneId}`,
    description: 'Zone de test administrative locale.',
    visibility: 'DRAFT',
    bounds_l93_m: [876_000, 6_403_000, 877_000, 6_404_000],
    created_at: '2026-07-14T08:00:00Z',
    updated_at: '2026-07-14T08:00:00Z',
  };
}

function adminDetail(zoneId = 'ALPES-TEST') {
  return {
    zone: adminZone(zoneId),
    uploads: [],
    information: [{
      information_id: 'info-001',
      title: 'Information administrative',
      body: 'Information de test localisée.',
      category: 'access',
      position_l93: [876_500, 6_403_500],
      state: 'DRAFT',
      updated_at: '2026-07-14T08:00:00Z',
      review_note: null,
    }],
  };
}

const adminMapSummary = {
  total_incidents: 1,
  active_incidents: 1,
  monitoring_incidents: 0,
  incidents_requiring_review: 1,
  incidents_with_models: 1,
  model_updates_available: 0,
};

const adminSystemStatus = {
  checked_at: '2026-07-15T10:00:00Z',
  application: { name: 'Fire-Viewer', version: '1.0.0', environment: 'test', authentication_mode: 'cookie' },
  database: { dialect: 'sqlite', reachable: true },
  queues: { jobs_active: 0, jobs_quarantined: 0, outbox_pending: 0, outbox_with_error: 0, reports_pending: 0 },
  assets: { packages_draft: 0, packages_verified: 1, packages_previewable: 1, packages_published: 1, packages_withdrawn_or_revoked: 0 },
  audit_event_count: 2,
  worker_heartbeat: 'not_persisted',
};

function adminDashboard() {
  return {
    generated_at: '2026-07-15T10:00:00Z',
    queue: { total: 1, critical: 1, high: 0, medium: 0, observations_pending: 0, reports_pending: 1, incidents_requiring_review: 1, jobs_quarantined: 0, models_to_review: 0 },
    priorities: [{ kind: 'report', priority: 'critical', target_id: 'report-001', fire_id: 'FR-83-00042', title: 'Publication à valider', detail: 'Revue humaine requise', created_at: '2026-07-15T09:55:00Z' }],
    watchlist: [{ fire_id: 'FR-83-00042', canonical_name: 'Massif des Maures', status: 'ACTIVE_CONFIRMED', verification_state: 'VERIFIED', last_observed_at: '2026-07-15T09:58:00Z', review_required: true, pending_observation_count: 0, model_update_available: false }],
    recent_publications: [],
    map_summary: adminMapSummary,
    system: adminSystemStatus,
  };
}

function adminOperationalMap() {
  return {
    generated_at: '2026-07-15T10:00:00Z',
    coordinate_system: 'EPSG:4326',
    summary: adminMapSummary,
    incidents: [{
      fire_id: 'FR-83-00042', canonical_name: 'Massif des Maures', territory_code: '83', longitude: 6.31, latitude: 43.25,
      horizontal_uncertainty_m: 180, status: 'ACTIVE_CONFIRMED', verification_state: 'VERIFIED', visibility: 'PUBLIC',
      current_episode_id: 'E01', last_observed_at: '2026-07-15T09:58:00Z', review_required: true,
      pending_observation_count: 0, spatial_zone_id: 'MAURES-01', spatial_zone_revision: 1,
      current_package_id: 'pkg-maures', active_package_id: 'pkg-maures', model_update_available: false,
      models: [{ profile: 'local', source: 'spatial_package', state: 'PUBLISHED', version: 1, asset_id: null, package_id: 'pkg-maures', package_file_id: 1, sha256: 'c'.repeat(64), size_bytes: 2048, is_current: true, access_path: '/api/v2/admin/packages/pkg-maures/files/1' }],
    }],
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function adminFetchResponse(input: RequestInfo | URL): Response {
  const url = requestUrl(input);
  if (url.pathname === '/api/v1/admin/session') return jsonResponse({ authenticated: true });
  if (url.pathname === '/api/v1/admin/zones') return jsonResponse({ zones: [adminZone()] });
  if (url.pathname === '/api/v2/admin/dashboard') return jsonResponse(adminDashboard());
  if (url.pathname === '/api/v2/admin/operational-map') return jsonResponse(adminOperationalMap());
  if (url.pathname === '/api/v2/admin/incidents') return jsonResponse({ incidents: [] });
  if (url.pathname === '/api/v1/admin/incidents/FR-83-00042/observations') return jsonResponse({ fire_id: 'FR-83-00042', observations: [] });
  if (url.pathname === '/api/v1/admin/incidents/FR-83-00042/sources-media') return jsonResponse({ fire_id: 'FR-83-00042', sources: [], media_references: [] });
  if (url.pathname === '/api/v1/admin/incidents/FR-83-00042/models-pipeline') return jsonResponse({ fire_id: 'FR-83-00042', models: [], jobs: [] });
  if (url.pathname === '/api/v1/admin/zones/ALPES-TEST/revisions/2') {
    return jsonResponse({ revision: 2, spatial_profile_version: '2.0', origin_l93_ngf: [870000, 6410000, 190], horizontal_crs: 'EPSG:2154', vertical_crs: 'EPSG:5720', ground_model: 'MNT_LIDAR_HD', ground_resolution_m: 0.5, surface_height_reference: 'MNS_RELATIVE_TO_MNT', origin_wgs84: [5.1, 44.8, 240], local_frame: 'ENU', meters_per_unit: 1, vertical_datum: 'NGF-IGN69', bounds_m: { east: [-20, 20], north: [-20, 20], up: [0, 120] } });
  }
  if (url.pathname === '/api/v1/admin/zones/ALPES-TEST/revisions/2/preview') {
    return jsonResponse({ zone_id: 'ALPES-TEST', revision: 2, preview_scope: 'private-admin', package_id: null, package_state: null, publication_id: null, publication_state: null, publication_active: false, verification_report: {}, preview_package_ids: [], files: [] });
  }
  const detail = url.pathname.match(/^\/api\/v1\/admin\/zones\/([A-Z0-9-]+)$/);
  if (detail) return jsonResponse(adminDetail(detail[1]));
  return jsonResponse({ trace_id: 'test-admin-not-found' }, 404);
}

describe('App en mode manifeste API', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearAdminSessionCookie();
    window.history.replaceState({}, '', '/incident/FR-83-00042');
    manifestClient.getDataMode.mockReset().mockReturnValue('api');
    manifestClient.isAbortError.mockReset().mockReturnValue(false);
    manifestClient.loadViewerManifest.mockReset().mockResolvedValue(createResult());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('affiche un état public sûr sans charger de manifeste quand le mode de données est absent', () => {
    manifestClient.getDataMode.mockReturnValue('unconfigured');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'La consultation n’est pas configurée' })).toBeVisible();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });

  it('ne présente jamais le dashboard fictif sur une adresse publique', async () => {
    manifestClient.getDataMode.mockReturnValue('mock');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'La consultation n’est pas configurée' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Démonstration fictive');
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });

  it.skip('rend le seed API not_available avec localisation publique et sans surface mock', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'FR-83-00042' })).toBeVisible();
    expect(screen.getAllByText('Aucun modèle public disponible')[0]).toBeVisible();
    expect(screen.getByText('2.00000°')).toBeVisible();
    expect(screen.getByText('46.00000°')).toBeVisible();
    expect(screen.queryByText(/Mode hors ligne simulé/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('mock://');
    expect(manifestClient.loadViewerManifest).toHaveBeenCalledWith(
      'FR-83-00042',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('masque toute valeur spatiale lorsque le manifeste est withheld', async () => {
    manifestClient.loadViewerManifest.mockResolvedValue(
      createResult(
        createSummary({
          statusCode: 'UNDER_REVIEW',
          reviewRequired: true,
          location: null,
          asset: null,
          frame: null,
          modelState: 'withheld',
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Représentation 3D indisponible' })).toBeVisible();
    expect(screen.queryByText('Longitude')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('2.00000°');
    expect(document.body.textContent).not.toContain('46.00000°');
  });

  it.skip('affiche la prévisualisation complète d’un modèle available sans URL GLB', async () => {
    const assetUrl = 'https://assets.example.invalid/fire-viewer/FR-83-00042/E03/v1.glb';
    manifestClient.loadViewerManifest.mockResolvedValue(
      createResult(
        createSummary({
          modelState: 'available',
          asset: {
            asset_id: 'asset-fixture-0001',
            version: 1,
            url: assetUrl,
            sha256: 'a'.repeat(64),
            size_bytes: 123_456,
            lod: 'desktop',
          },
          frame: {
            origin_wgs84: [2, 46, 454.203998565679],
            local_frame: 'ENU',
            meters_per_unit: 0.01,
            vertical_datum: 'EPSG:4979',
          },
        }),
      ),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('tab', { name: 'Vue 3D' }));
    expect(await screen.findByText('Apercu public local : les contenus detailes sont fictifs et minimises.')).toBeVisible();
    expect(screen.getByRole('toolbar', { name: 'Contrôles de la visualisation' })).toBeVisible();
    expect(document.body.textContent).not.toContain(assetUrl);
    expect(document.body.textContent).not.toContain('.glb');
  });

  it.skip('garde les sections sans endpoint dans un état explicite et sans fixture', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'FR-83-00042' });

    for (const [tab, heading] of [
      ['Observations', 'Non incluses dans le manifeste public'],
      ['Sources', 'Non incluses dans le manifeste public'],
      ['Téléchargements', 'Aucun téléchargement public'],
      ['Signalement', 'Signalement non disponible'],
    ]) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getByRole('heading', { name: heading })).toBeVisible();
      expect(document.body.textContent).not.toContain('mock://');
      expect(document.body.textContent).not.toContain('Démonstration fictive');
    }
  });

  it.skip('conserve le dernier manifeste marqué obsolète après une erreur réseau', async () => {
    manifestClient.loadViewerManifest
      .mockResolvedValueOnce(createResult())
      .mockRejectedValueOnce({ kind: 'network', traceId: 'trace-ui-006' });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'FR-83-00042' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Actualiser le manifeste' }));

    await waitFor(() => {
      expect(screen.getByText('Dernier manifeste connu — revalidation échouée')).toBeVisible();
    });
    expect(document.body.textContent).toContain('trace-ui-006');
    expect(screen.getAllByText('Aucun modèle public disponible')[0]).toBeVisible();
  });


  it.each([
    [404, 'Incident introuvable'],
    [410, 'Incident retiré'],
    [503, 'Service temporairement indisponible'],
  ])('affiche une erreur HTTP %i sûre sans detail distant', async (status, title) => {
    manifestClient.loadViewerManifest.mockRejectedValue({
      kind: 'http',
      status,
      traceId: 'trace-status',
      detail: 'information interne à ne jamais afficher',
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: title })).toBeVisible();
    expect(screen.getByText('trace-status')).toBeVisible();
    expect(document.body.textContent).not.toContain('information interne à ne jamais afficher');
  });
});

describe('Routage administrateur privé', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearAdminSessionCookie();
    manifestClient.getDataMode.mockReset().mockReturnValue('api');
    manifestClient.isAbortError.mockReset().mockReturnValue(false);
    manifestClient.loadViewerManifest.mockReset().mockResolvedValue(createResult());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => Promise.resolve(adminFetchResponse(input))));
  });

  afterEach(() => {
    cleanup();
    clearAdminSessionCookie();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });


  it('ne construit aucune surface publique agrégée pour une adresse de zone invalide', () => {
    window.history.replaceState({}, '', '/zones/seconde-zone-rurale');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Les zones techniques ne sont pas publiques' })).toBeVisible();
    expect(screen.queryByText('Préparation de la carte 3D')).not.toBeInTheDocument();
    expect(manifestClient.getDataMode).not.toHaveBeenCalled();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });

  it('bloque la branche admin tant qu’aucune session locale n’est active', async () => {
    window.history.replaceState({}, '', '/admin/zones');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Connexion administrateur requise' })).toBeVisible();
    expect(screen.getByLabelText('Identifiant')).toBeVisible();
    expect(screen.getByLabelText('Mot de passe')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Fire-Viewer administration, tableau de bord' })).not.toBeInTheDocument();
    expect(manifestClient.getDataMode).not.toHaveBeenCalled();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });

  it('ne donne pas accès quand le serveur refuse les identifiants locaux', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'détail privé à ne jamais afficher' }), {
        status: 403,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    ));
    window.history.replaceState({}, '', '/admin/zones');

    render(<App />);

    await screen.findByRole('heading', { name: 'Connexion administrateur requise' });
    await user.type(screen.getByLabelText('Mot de passe'), 'mot-de-passe-refusé');
    await user.click(screen.getByRole('button', { name: 'Ouvrir l’administration' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants administrateur refusés.');
    expect(screen.queryByRole('link', { name: 'Fire-Viewer administration, tableau de bord' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('détail privé à ne jamais afficher');
  });

  it.each([
    ['/admin', 'Poste de veille'],
    ['/admin/carte-operationnelle', 'Carte opérationnelle nationale'],
    ['/admin/zones', 'Zones administrées'],
    ['/admin/zones/nouvelle', 'Créer une zone'],
    ['/admin/zones/ALPES-TEST', 'Zone ALPES-TEST'],
    ['/admin/zones/ALPES-TEST/revisions/nouvelle', 'Créer une révision spatiale'],
    ['/admin/zones/ALPES-TEST/revisions/2', 'Révision 2'],
    ['/admin/zones/ALPES-TEST/revisions/2/preview', 'Aperçu privé — Révision 2'],
    ['/admin/zones/ALPES-TEST/information/nouvelle', 'Ajouter une information — ALPES-TEST'],
    ['/admin/zones/ALPES-TEST/information/info-001', 'Modifier une information — ALPES-TEST'],
    ['/admin/incidents', 'Incidents'],
    ['/admin/incidents/FR-83-00042/observations', 'Observations'],
    ['/admin/incidents/FR-83-00042/sources-medias', 'Sources et médias'],
    ['/admin/incidents/FR-83-00042/modeles-pipeline', 'Modèles et pipeline'],
  ])('rend %s dans le shell admin sans charger les branches publiques', async (path, heading) => {
    setAdminSessionCookie();
    window.history.replaceState({}, '', path);

    render(<App />);

    expect(await screen.findByRole('link', { name: 'FireWarning, tableau de bord administrateur' })).toBeVisible();
    expect(screen.getByText('Session vérifiée')).toBeVisible();
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Modèles et zones' })).toHaveAttribute('href', '/admin/zones');
    expect(screen.getByRole('link', { name: 'Nouvelle zone' })).toHaveAttribute('href', '/admin/zones/nouvelle');
    expect(manifestClient.getDataMode).not.toHaveBeenCalled();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
    expect(screen.queryByText('Démonstration fictive')).not.toBeInTheDocument();
    expect(screen.queryByText('La carte ne consulte ni Cesium')).not.toBeInTheDocument();
  });

  it('ne conserve aucune route vers l’ancien téléversement d’archive', async () => {
    setAdminSessionCookie();
    window.history.replaceState({}, '', '/admin/zones/ALPES-TEST/uploads');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Page administrateur inconnue' })).toBeVisible();
    expect(screen.queryByText(/Téléverser une archive/i)).not.toBeInTheDocument();
  });

  it('priorise /admin/* avant les routes publiques de zone', async () => {
    setAdminSessionCookie();
    window.history.replaceState({}, '', '/admin/zones/DIE-PONTAIX-08');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Zone DIE-PONTAIX-08' })).toBeVisible();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });
});
