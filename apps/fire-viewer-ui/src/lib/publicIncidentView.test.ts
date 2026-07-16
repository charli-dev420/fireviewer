import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./manifestClient', () => ({
  getViewerManifestApiOrigin: () => 'https://api.firewarning.test',
}));

import { PublicIncidentViewError, submitPublicIncidentReport } from './publicIncidentView';

describe('submitPublicIncidentReport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retourne le reçu structuré fourni par l’API publique', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      receipt_id: 'REPORT-0001',
      status: 'received',
      submitted_at: '2026-07-15T14:22:00Z',
      replayed: false,
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitPublicIncidentReport('FR-83-00042', {
      category: 'location',
      message: 'Le marqueur doit être vérifié sur le versant est.',
    })).resolves.toEqual({
      receipt_id: 'REPORT-0001',
      status: 'received',
      submitted_at: '2026-07-15T14:22:00Z',
      replayed: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firewarning.test/api/v1/incident/FR-83-00042/reports',
      expect.objectContaining({ method: 'POST', credentials: 'omit' }),
    );
  });

  it('refuse un reçu non conforme au lieu d’inventer un identifiant de suivi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'received' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(submitPublicIncidentReport('FR-83-00042', {
      category: 'location',
      message: 'Le marqueur doit être vérifié sur le versant est.',
    })).rejects.toBeInstanceOf(PublicIncidentViewError);
  });
});
