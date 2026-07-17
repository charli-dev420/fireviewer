// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiProvider } from './AdminApiContext';
import {
  AdminAuditPage,
  AdminConfigurationPage,
  AdminRolesPage,
  AdminSystemPage,
} from './AdminGovernancePages';

const API_ORIGIN = 'http://localhost:8000';
const SESSION = { token: 'administrator-test-token' };

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderAdmin(node: ReactNode) {
  return render(
    <AdminApiProvider session={SESSION} onUnauthorized={vi.fn()}>
      {node}
    </AdminApiProvider>,
  );
}

function governancePayload(pathname: string): Response {
  if (pathname === '/api/v1/admin/audit') return response({ events: [{ event_id: 'evt-001', occurred_at: '2026-07-15T10:00:00Z', action: 'incident.transition', target_type: 'incident', target_id: 'FR-83-00042', actor_type: 'operator', actor_id: 'operator-1', reason: 'Base de validation disponible.', trace_id: 'trace-001' }] });
  if (pathname === '/api/v1/admin/roles') return response({ actor_id: 'administrator-test', actor_type: 'operator', assigned_roles: ['administrator'], identity_management: 'OIDC/JWT', catalog: [{ role: 'administrator', description: 'Accès administrateur.', capabilities: ['consulter l audit global'] }] });
  if (pathname === '/api/v1/admin/system') return response({ checked_at: '2026-07-15T10:00:00Z', application: { name: 'Fire-Viewer', version: '1.0.0', environment: 'test', authentication_mode: 'jwt' }, database: { dialect: 'sqlite', reachable: true }, queues: { jobs_active: 1, jobs_quarantined: 0, outbox_pending: 2, outbox_with_error: 0, reports_pending: 3 }, assets: { packages_draft: 1, packages_verified: 2, packages_previewable: 3, packages_published: 4, packages_withdrawn_or_revoked: 5 }, audit_event_count: 9, worker_heartbeat: 'not_persisted' });
  return response({ environment: 'test', authentication_mode: 'jwt', identity_management: 'OIDC/JWT', matching: { policy_id: 'g1-default-v1', create_below: 0.4, auto_attach_above: 0.8, min_margin: 0.1, max_candidate_distance_m: 5000, max_incident_uncertainty_m: 2500, max_candidates: 5 }, public: { report_rate_limit_per_day: 3, idempotency_retention_hours: 24, public_notice: 'Ne remplace pas les secours.' }, storage: { archive_max_bytes: 1000, unpacked_max_bytes: 2000, archive_max_files: 10, manifest_max_bytes: 500 } });
}

describe('surfaces de gouvernance administrateur', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('affiche les quatre lectures réelles sans exposer de secrets', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      return Promise.resolve(governancePayload(url.pathname));
    }));

    const pages = [
      [<AdminAuditPage />, 'Audit global', 'incident.transition'],
      [<AdminRolesPage />, 'Accès administrateur', 'administrator-test'],
      [<AdminSystemPage />, 'État système', 'Heartbeat : not_persisted'],
      [<AdminConfigurationPage />, 'Configuration', 'g1-default-v1'],
    ] as const;

    for (const [page, heading, evidence] of pages) {
      const view = renderAdmin(page);
      expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
      expect(screen.getByText(new RegExp(evidence))).toBeVisible();
      expect(document.body.textContent).not.toContain('public_report_hash_secret');
      view.unmount();
    }
  });
});
