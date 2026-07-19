// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiProvider } from './AdminApiContext';
import { AdminIncidentDetailPage } from './AdminIncidentDetailPage';

const API_ORIGIN = 'http://localhost:8000';
const SESSION = { token: 'admin-incident-test-token' };

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function incident(overrides: Record<string, unknown> = {}) {
  return {
    fire_id: 'FR-26-00001',
    canonical_name: 'Incendie de Die',
    territory_code: '26',
    visibility: 'PUBLIC',
    current_episode_id: 'E01',
    status: 'ACTIVE_CONFIRMED',
    verification_state: 'VERIFIED',
    corroborating_source_count: 3,
    estimated_area_ha: 1_240,
    evacuation_established: false,
    model_generation_eligible: true,
    review_required: true,
    last_observed_at: '2026-07-18T10:00:00Z',
    pending_observation_count: 2,
    version: 4,
    episodes: [{
      episode_id: 'E01', ordinal: 1, status: 'ACTIVE_CONFIRMED', verification_state: 'VERIFIED',
      corroborating_source_count: 3, evidence_basis_at: '2026-07-18T10:00:00Z', estimated_area_ha: 1_240,
      evacuation_established: false, model_generation_eligible: true, review_required: true,
      started_at: '2026-07-08T08:00:00Z', last_observed_at: '2026-07-18T10:00:00Z', is_current: true, version: 4,
    }],
    observations: [{
      observation_id: 'OBS-001', source_key: 'presse-locale', observed_at: '2026-07-18T10:00:00Z',
      verification_state: 'PENDING_REVIEW', attached_episode_id: null, proposed_fire_id: 'FR-26-00001',
      proposed_episode_id: 'E01', match_score: 0.92, review_reasons: ['validation humaine'], version: 1,
    }],
    sources: [
      { source_key: 'presse-locale', type: 'image', trust: 'partner', enabled: true, display_name: 'Presse locale', public_display_name: 'Journal local' },
      { source_key: 'satellite', type: 'satellite', trust: 'institutional', enabled: true, display_name: 'Copernicus', public_display_name: 'Copernicus' },
    ],
    models: [{
      revision: 1, episode_id: 'E01', is_current: true, asset_id: 'asset-die', asset_state: 'PUBLISHED',
      asset_version: 1, lod: 'near', size_bytes: 1024, generated_at: '2026-07-18T09:00:00Z',
      spatial_zone_id: 'DIE-PONTAIX-08', spatial_zone_revision: 1,
      asset_spatial_zone_id: 'DIE-PONTAIX-08', asset_spatial_zone_revision: 1,
    }],
    audit: [{
      event_id: 'evt-001', occurred_at: '2026-07-18T10:01:00Z', action: 'incident.review',
      target_type: 'incident', target_id: 'FR-26-00001', actor_type: 'operator', actor_id: 'operator-1',
      reason: 'Observation à vérifier.',
    }],
    ...overrides,
  };
}

function renderPage(payload: unknown) {
  vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response(payload)));
  return render(
    <AdminApiProvider session={SESSION} onUnauthorized={vi.fn()}>
      <AdminIncidentDetailPage fireId="FR-26-00001" />
    </AdminApiProvider>,
  );
}

describe('fiche incident principale', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('affiche immédiatement les quatre blocs opérationnels et les actions réelles', async () => {
    renderPage(incident());

    expect(await screen.findByRole('heading', { name: 'Situation actuelle' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Carte' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Actions urgentes' })).toBeVisible();
    expect(screen.getByText('Presse locale')).toBeVisible();
    expect(screen.getByText('Copernicus')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ouvrir la carte' })).toHaveAttribute('href', '/admin/incidents/FR-26-00001/revue-spatiale');
    expect(screen.getByRole('link', { name: 'Examiner les observations' })).toHaveAttribute('href', '/admin/incidents/FR-26-00001/observations');
    expect(screen.queryByText('Cycle de vie')).not.toBeInTheDocument();
    expect(screen.queryByText('Version incident')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Gestion de l’incident/ })).not.toBeInTheDocument();
    expect(screen.getByText('Épisodes')).not.toBeVisible();
  });

  it('n’invente aucune urgence et propose seulement d’ajouter la carte absente', async () => {
    renderPage(incident({
      visibility: 'PRIVATE',
      review_required: false,
      pending_observation_count: 0,
      models: [],
      observations: [],
    }));

    expect(await screen.findByText('Aucune action urgente n’est signalée.')).toBeVisible();
    expect(screen.getByText('Suivi à jour')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Examiner les observations' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ajouter la carte 3D' })).toHaveAttribute('href', '/admin/incidents/FR-26-00001/carte/importer');
    expect(screen.queryByRole('link', { name: 'Voir la fiche publique' })).not.toBeInTheDocument();
  });

  it('laisse les champs de mise à jour repliés tant que l’opérateur ne les demande pas', async () => {
    const user = userEvent.setup();
    renderPage(incident());

    await screen.findByRole('heading', { name: 'Situation actuelle' });
    expect(screen.getByLabelText('Surface estimée (ha)')).not.toBeVisible();
    await user.click(screen.getByText('Mettre à jour la situation'));
    expect(screen.getByLabelText('Surface estimée (ha)')).toBeVisible();
    expect(screen.getByLabelText('Nouveau statut')).toBeVisible();
    expect(screen.queryByText(/seuil de surface|machine d’état|éligible/i)).not.toBeInTheDocument();
  });

  it('enregistre un statut autorisé puis affiche la valeur relue depuis l’API', async () => {
    const user = userEvent.setup();
    const monitored = incident({
      status: 'MONITORING',
      version: 4,
      episodes: [{
        episode_id: 'E01', ordinal: 1, status: 'MONITORING', verification_state: 'VERIFIED',
        corroborating_source_count: 3, evidence_basis_at: '2026-07-18T10:00:00Z', estimated_area_ha: 1_240,
        evacuation_established: false, model_generation_eligible: true, review_required: false,
        started_at: '2026-07-08T08:00:00Z', last_observed_at: '2026-07-18T10:00:00Z', is_current: true, version: 4,
      }],
    });
    const confirmed = incident({
      status: 'ACTIVE_CONFIRMED',
      version: 5,
      episodes: [{
        episode_id: 'E01', ordinal: 1, status: 'ACTIVE_CONFIRMED', verification_state: 'VERIFIED',
        corroborating_source_count: 3, evidence_basis_at: '2026-07-18T10:00:00Z', estimated_area_ha: 1_240,
        evacuation_established: false, model_generation_eligible: true, review_required: false,
        started_at: '2026-07-08T08:00:00Z', last_observed_at: '2026-07-18T10:00:00Z', is_current: true, version: 5,
      }],
    });
    let incidentReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/operator/incidents/FR-26-00001/transitions')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          target_status: 'ACTIVE_CONFIRMED',
          expected_version: 4,
          validation_basis: expect.stringContaining('Confirmation explicite par l’opérateur'),
        });
        return response({ episode_id: 'E01', status: 'ACTIVE_CONFIRMED', version: 5 });
      }
      incidentReads += 1;
      return response(incidentReads === 1 ? monitored : confirmed);
    });
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AdminApiProvider session={SESSION} onUnauthorized={vi.fn()}>
        <AdminIncidentDetailPage fireId="FR-26-00001" />
      </AdminApiProvider>,
    );

    await screen.findByText('Sous surveillance');
    await user.click(screen.getByText('Mettre à jour la situation'));
    expect(screen.queryByRole('option', { name: 'Clos' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Nouveau statut'), 'ACTIVE_CONFIRMED');
    await user.click(screen.getByRole('button', { name: 'Changer le statut' }));

    expect(await screen.findByText('Actif confirmé', { selector: '.admin-state' })).toBeVisible();
    expect(incidentReads).toBe(2);
  });
});
