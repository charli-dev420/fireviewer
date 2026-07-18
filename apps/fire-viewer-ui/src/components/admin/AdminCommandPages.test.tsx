// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApiProvider } from './AdminApiContext';
import { AdminDashboardPage, AdminOperationalMapPage } from './AdminCommandPages';

const API_ORIGIN = 'http://localhost:8000';

const summary = {
  total_incidents: 2,
  active_incidents: 1,
  monitoring_incidents: 1,
  incidents_requiring_review: 1,
  incidents_with_models: 1,
  model_updates_available: 1,
};

const system = {
  checked_at: '2026-07-15T10:00:00Z',
  application: { name: 'Fire-Viewer', version: '1.0.0', environment: 'test', authentication_mode: 'cookie' },
  database: { dialect: 'sqlite', reachable: true },
  queues: { jobs_active: 0, jobs_quarantined: 0, outbox_pending: 0, outbox_with_error: 0, reports_pending: 1 },
  assets: { packages_draft: 0, packages_verified: 1, packages_previewable: 1, packages_published: 1, packages_withdrawn_or_revoked: 0 },
  audit_event_count: 2,
  worker_heartbeat: 'not_persisted',
};

const incident = {
  fire_id: 'FR-83-00042', canonical_name: 'Massif des Maures', territory_code: '83', longitude: 6.31, latitude: 43.25,
  horizontal_uncertainty_m: 180, status: 'ACTIVE_CONFIRMED', verification_state: 'VERIFIED', visibility: 'PUBLIC',
  current_episode_id: 'E01', last_observed_at: '2026-07-15T09:58:00Z', review_required: true,
  pending_observation_count: 1, spatial_zone_id: 'MAURES-01', spatial_zone_revision: 2,
  current_package_id: 'pkg-maures-v2', active_package_id: 'pkg-maures-v1', model_update_available: true,
  models: [{ profile: 'local', source: 'spatial_package', state: 'PUBLISHED', version: 2, asset_id: null, package_id: 'pkg-maures-v2', package_file_id: 3, sha256: 'c'.repeat(64), size_bytes: 2048, is_current: true, access_path: '/api/v2/admin/packages/pkg-maures-v2/files/3' }],
};

const monitoringIncident = {
  ...incident,
  fire_id: 'FR-26-00001', canonical_name: 'Die–Pontaix', territory_code: '26', longitude: 5.37, latitude: 44.75,
  status: 'MONITORING', verification_state: 'PENDING_REVIEW', visibility: 'ADMIN_ONLY',
  current_episode_id: 'E02', last_observed_at: '2026-07-15T09:40:00Z', review_required: false,
  pending_observation_count: 0, spatial_zone_id: 'DIE-PONTAIX-08', spatial_zone_revision: 1,
  current_package_id: null, active_package_id: null, model_update_available: false, models: [],
};

const dashboard = {
  generated_at: '2026-07-15T10:00:00Z',
  queue: { total: 2, critical: 1, high: 1, medium: 0, observations_pending: 1, reports_pending: 1, incidents_requiring_review: 1, jobs_quarantined: 0, models_to_review: 1 },
  priorities: [{ kind: 'report', priority: 'critical', target_id: 'report-001', fire_id: 'FR-83-00042', title: 'Publication à valider', detail: 'Revue humaine requise', created_at: '2026-07-15T09:55:00Z' }],
  watchlist: [{ fire_id: incident.fire_id, canonical_name: incident.canonical_name, status: incident.status, verification_state: incident.verification_state, last_observed_at: incident.last_observed_at, review_required: true, pending_observation_count: 1, model_update_available: true }],
  recent_publications: [],
  map_summary: summary,
  system,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function renderWithApi(page: ReactNode) {
  return render(
    <AdminApiProvider session={{ token: 'admin-test-token' }} onUnauthorized={vi.fn()}>
      {page}
    </AdminApiProvider>,
  );
}

describe('surfaces de commandement administrateur', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rend la vue nationale avec tous les incidents réellement fournis par le backend', async () => {
    const mapPayload = { generated_at: '2026-07-15T10:00:00Z', coordinate_system: 'EPSG:4326', summary, incidents: [incident, monitoringIncident] };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(mapPayload));
    vi.stubGlobal('fetch', fetchMock);

    renderWithApi(<AdminDashboardPage />);

    expect(await screen.findByRole('heading', { name: 'Vue nationale — France métropolitaine' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'FR-83-00042, Massif des Maures' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'FR-26-00001, Die–Pontaix' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Massif des Maures' })).toBeVisible();
    expect(screen.getByText('1 observation(s) attendent une décision humaine.')).toBeVisible();
    expect(screen.getByRole('link', { name: /Ouvrir l’incident/ })).toHaveAttribute('href', '/admin/incidents/FR-83-00042');
    expect(fetchMock).toHaveBeenCalledWith(`${API_ORIGIN}/api/v2/admin/operational-map`, expect.objectContaining({ method: 'GET' }));
    expect(document.body.textContent).not.toContain('1 240');
    expect(document.body.textContent).not.toContain('sapeur');
  });

  it('filtre la surveillance, ouvre un incident et revient à la vue nationale', async () => {
    const mapPayload = { generated_at: '2026-07-15T10:00:00Z', coordinate_system: 'EPSG:4326', summary, incidents: [incident, monitoringIncident] };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(jsonResponse(mapPayload)));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithApi(<AdminOperationalMapPage />);

    await screen.findByRole('button', { name: 'FR-83-00042, Massif des Maures' });
    await user.click(screen.getByRole('button', { name: /Surveillance\s*1/ }));
    expect(screen.queryByRole('button', { name: 'FR-83-00042, Massif des Maures' })).not.toBeInTheDocument();
    const monitoringMarker = screen.getByRole('button', { name: 'FR-26-00001, Die–Pontaix' });
    await user.click(monitoringMarker);
    expect(screen.getByRole('heading', { name: 'Die–Pontaix' })).toBeVisible();
    expect(screen.getByText('Aucune décision urgente n’est signalée.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Recentrer sur l’incident' }));
    await user.click(screen.getAllByRole('button', { name: 'Revenir à la vue nationale' })[1]);
    await user.click(screen.getByRole('button', { name: /Actualiser les incidents/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(`${API_ORIGIN}/api/v2/admin/operational-map`, expect.objectContaining({ method: 'GET' }));
  });
});
