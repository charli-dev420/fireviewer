// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminApiProvider } from './AdminApiContext';
import { AdminZoneDetailPage } from './AdminZoneDetailPage';

const API_ORIGIN = 'http://localhost:8000';

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('ouvre directement l’éditeur de périmètre de l’incident lié sans proposer une nouvelle carte', async () => {
  vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname === '/api/v1/admin/zones/DIE-PONTAIX-08') {
      return response({
        zone: {
          zone_id: 'DIE-PONTAIX-08', label: 'Die – Pontaix', description: 'Fond 3D de Die.',
          visibility: 'PUBLISHED', bounds_l93_m: [870000, 6400000, 900000, 6440000],
          created_at: '2026-07-14T10:00:00Z', updated_at: '2026-07-18T10:00:00Z',
        },
        uploads: [], information: [],
      });
    }
    if (pathname === '/api/v2/admin/operational-map') {
      return response({
        generated_at: '2026-07-18T10:00:00Z', coordinate_system: 'EPSG:4326',
        summary: { total_incidents: 1, active_incidents: 1, monitoring_incidents: 0, incidents_requiring_review: 0, incidents_with_models: 1, model_updates_available: 0 },
        incidents: [{
          fire_id: 'FR-26-00001', canonical_name: 'Incendie de Die', territory_code: '26',
          longitude: 5.37, latitude: 44.75, horizontal_uncertainty_m: 100,
          status: 'ACTIVE_CONFIRMED', verification_state: 'VERIFIED', visibility: 'PUBLIC',
          current_episode_id: 'E01', last_observed_at: '2026-07-18T09:00:00Z', review_required: false,
          pending_observation_count: 0, spatial_zone_id: 'DIE-PONTAIX-08', spatial_zone_revision: 1,
          current_package_id: 'pkg-die', active_package_id: 'pkg-die', models: [], model_update_available: false,
        }],
      });
    }
    return response({});
  }));

  render(
    <AdminApiProvider session={{ token: 'admin-test' }} onUnauthorized={vi.fn()}>
      <AdminZoneDetailPage zoneId="DIE-PONTAIX-08" />
    </AdminApiProvider>,
  );

  expect(await screen.findByRole('heading', { name: 'Carte 3D et périmètre incendie' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Ouvrir la carte et éditer le périmètre' })).toHaveAttribute(
    'href',
    '/admin/incidents/FR-26-00001/revue-spatiale',
  );
  expect(screen.getByRole('link', { name: 'Contrôler le fond 3D' })).toHaveAttribute(
    'href',
    '/admin/zones/DIE-PONTAIX-08/revisions/1/preview',
  );
  expect(screen.queryByText(/créer une révision/i)).not.toBeInTheDocument();
});
