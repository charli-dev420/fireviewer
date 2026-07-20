// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FireWarningIncidentsPage } from './FireWarningIncidentsPage';

const API_ORIGIN = 'https://api.fireviewer.test';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('FireWarningIncidentsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/incendies');
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('charge les incidents récents quand aucune coordonnée n’est fournie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      schema_version: '1.0',
      incidents: [{
        fire_id: 'FR-26-00001',
        canonical_name: 'Incendie de Die - massif de Justin',
        status: 'ACTIVE_CONFIRMED',
        verification: 'verified',
        last_observed_at: '2026-07-19T01:10:51Z',
      }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<FireWarningIncidentsPage />);

    const incidentHeading = await screen.findByRole('heading', { name: 'Incendie de Die - massif de Justin' });
    const incidentLink = screen.getByRole('link', { name: 'Ouvrir la fiche Incendie de Die - massif de Justin' });
    expect(incidentHeading).toBeVisible();
    expect(incidentLink).toHaveAttribute('href', '/incendie/FR-26-00001');
    expect(within(incidentLink).getByRole('heading', { name: 'Incendie de Die - massif de Justin' })).toBe(incidentHeading);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_ORIGIN}/api/v1/incidents/recent?`);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('longitude=0');
  });

  it('conserve la recherche géographique lorsque les deux coordonnées sont explicites', async () => {
    window.history.replaceState({}, '', '/incendies?latitude=48.39&longitude=2.59');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ schema_version: '1.0', incidents: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<FireWarningIncidentsPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_ORIGIN}/api/v1/incidents/search?longitude=2.59&latitude=48.39&radius_km=50`);
  });
});
