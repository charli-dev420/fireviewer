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

function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

function storeAdminSession(payload: Record<string, unknown> = {}): void {
  window.sessionStorage.setItem(
    'fire-viewer:admin-session:v1',
    JSON.stringify({
      token: createJwt({ sub: 'admin-ui-test', roles: ['administrator'], exp: 4_102_444_800, ...payload }),
    }),
  );
}

describe('App en mode manifeste API', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
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

  it('affiche N/A sans charger de manifeste quand le mode de données est absent', () => {
    manifestClient.getDataMode.mockReturnValue('unconfigured');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'N/A — mode de données non configuré' })).toBeVisible();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });

  it('conserve le dashboard fictif dans sa branche lazy dédiée', async () => {
    manifestClient.getDataMode.mockReturnValue('mock');

    render(<App />);

    expect(await screen.findByText('Démonstration fictive')).toBeVisible();
    expect(await screen.findByText('Terrain daté, périmètre estimé', { exact: false })).toBeVisible();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });

  it('rend le seed API not_available avec localisation publique et sans surface mock', async () => {
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

    expect((await screen.findAllByText('Informations spatiales masquées'))[0]).toBeVisible();
    expect(screen.queryByText('Longitude')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('2.00000°');
    expect(document.body.textContent).not.toContain('46.00000°');
  });

  it('affiche seulement les métadonnées d’un modèle available, sans URL GLB', async () => {
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

    render(<App />);

    expect(await screen.findByText('Métadonnées publiques du modèle')).toBeVisible();
    expect(screen.getByText('v1')).toBeVisible();
    expect(screen.getByText('Bureau')).toBeVisible();
    expect(document.body.textContent).not.toContain(assetUrl);
    expect(document.body.textContent).not.toContain('.glb');
  });

  it('garde Sources, Historique et Journal explicitement vides en API', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'FR-83-00042' });

    for (const tab of ['Sources', 'Historique', 'Journal']) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getByRole('heading', { name: 'Non inclus dans le manifeste public' })).toBeVisible();
      expect(document.body.textContent).not.toContain('mock://');
      expect(document.body.textContent).not.toContain('Démonstration fictive');
    }
  });

  it('conserve le dernier manifeste marqué obsolète après une erreur réseau', async () => {
    manifestClient.loadViewerManifest
      .mockResolvedValueOnce(createResult())
      .mockRejectedValueOnce({ kind: 'network', traceId: 'trace-ui-006' });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'FR-83-00042' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Actualiser le manifeste' }));

    await waitFor(() => {
      expect(screen.getByText('Dernier manifeste connu')).toBeVisible();
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


  it('garde /zones/die-pontaix hors catalogue public tant qu’aucune publication admin ne l’expose', () => {
    window.history.replaceState({}, '', '/zones/die-pontaix');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Catalogue public des zones non publié' })).toBeVisible();
    expect(screen.getByText('/demo/zones/die-pontaix')).toBeVisible();
    expect(screen.queryByText('Préparation de la carte 3D')).not.toBeInTheDocument();
    expect(manifestClient.getDataMode).not.toHaveBeenCalled();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });

  it('bloque la branche admin tant qu’aucun bearer administrator n’est stocké', () => {
    window.history.replaceState({}, '', '/admin/zones');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Connexion administrateur requise' })).toBeVisible();
    expect(screen.getByLabelText('Bearer JWT administrateur')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Fire-Viewer Admin' })).not.toBeInTheDocument();
    expect(manifestClient.getDataMode).not.toHaveBeenCalled();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });

  it('refuse un JWT sans rôle administrator sur l’écran de connexion', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/admin/zones');

    render(<App />);

    await user.type(
      screen.getByLabelText('Bearer JWT administrateur'),
      createJwt({ sub: 'viewer', roles: ['viewer'], exp: 4_102_444_800 }),
    );
    await user.click(screen.getByRole('button', { name: 'Ouvrir l’administration' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Le jeton ne contient pas le rôle administrator.');
    expect(screen.queryByRole('heading', { name: 'Fire-Viewer Admin' })).not.toBeInTheDocument();
  });

  it.each([
    ['/admin/zones', 'Administration des zones'],
    ['/admin/zones/nouvelle', 'Nouvelle zone'],
    ['/admin/zones/alpes-test', 'Zone alpes-test'],
    ['/admin/zones/alpes-test/revisions/r2', 'Zone alpes-test — révision r2'],
    ['/admin/zones/alpes-test/revisions/r2/preview', 'Prévisualisation privée — alpes-test révision r2'],
    ['/admin/publications', 'Publications'],
  ])('rend %s dans le shell admin sans charger les branches publiques', (path, heading) => {
    storeAdminSession();
    window.history.replaceState({}, '', path);

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Fire-Viewer Admin' })).toBeVisible();
    expect(screen.getByText('Session administrateur active')).toBeVisible();
    expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Zones' })).toHaveAttribute('href', '/admin/zones');
    expect(screen.getByRole('link', { name: 'Nouvelle zone' })).toHaveAttribute('href', '/admin/zones/nouvelle');
    expect(screen.getByRole('link', { name: 'Publications' })).toHaveAttribute('href', '/admin/publications');
    expect(manifestClient.getDataMode).not.toHaveBeenCalled();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
    expect(screen.queryByText('Démonstration fictive')).not.toBeInTheDocument();
    expect(screen.queryByText('La carte ne consulte ni Cesium')).not.toBeInTheDocument();
  });

  it('priorise /admin/* avant les routes publiques de zone', () => {
    storeAdminSession();
    window.history.replaceState({}, '', '/admin/zones/die-pontaix');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Zone die-pontaix' })).toBeVisible();
    expect(manifestClient.loadViewerManifest).not.toHaveBeenCalled();
  });
});
