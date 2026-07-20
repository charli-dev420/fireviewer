// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readPublicContributionAccess,
  submitPublicContribution,
  withdrawPublicContribution,
} from './publicContributionUpload';

const API_ORIGIN = 'https://api.fireviewer.test';
const status = {
  contribution_id: 'PC-20260720-0001',
  kind: 'new_fire',
  fire_id: null,
  state: 'PENDING',
  received_at: '2026-07-20T13:00:00Z',
  reviewed_at: null,
  review_reason: null,
  purge_after: '2026-08-19T13:00:00Z',
  media_count: 0,
  location_label: 'Massif de Justin',
  observation_type: 'Fumée',
  observed_at: '2026-07-20T12:55:00Z',
  version: 1,
} as const;

function input(media: File | null = null) {
  return {
    kind: 'new_fire' as const,
    fireId: null,
    location: { mode: 'place' as const, label: 'Massif de Justin', latitude: null, longitude: null, uncertaintyM: null },
    observation: { type: 'Fumée', observedAt: '2026-07-20T12:55:00Z', direct: true, description: 'Une colonne de fumée sombre est visible depuis la route.' },
    media,
    mediaCapturedAt: null,
    mediaDirection: null,
    consents: { retainEvidence: false, publicDisplay: false, spatialDisplay: false },
    contactEmail: null,
  };
}

describe('contrat public de contribution', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('ouvre, mémorise le jeton privé puis relit une contribution sans image', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        contribution_id: status.contribution_id,
        state: 'PENDING',
        tracking_token: 'tracking-secret',
        upload: null,
        purge_after: status.purge_after,
        replayed: false,
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ contribution: status, trace_id: 'tr-test' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitPublicContribution(input(), 'public-idempotency-0001');

    expect(result.state).toBe('PENDING');
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_ORIGIN}/api/v1/contributions/open`, expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': 'public-idempotency-0001' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_ORIGIN}/api/v1/contributions/${status.contribution_id}`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tracking-secret' }),
    }));
    expect(readPublicContributionAccess(status.contribution_id)?.trackingToken).toBe('tracking-secret');
  });

  it('envoie une image directement dans le préfixe privé puis finalise', async () => {
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'preuve.png', { type: 'image/png' });
    const uploader = vi.fn().mockResolvedValue({});
    const imageStatus = { ...status, media_count: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        contribution_id: status.contribution_id,
        state: 'OPEN',
        tracking_token: 'tracking-secret',
        upload: {
          package_id: 'SP-0001',
          pathname_prefix: 'firewarning/source-packages/upload-1',
          upload_grant: 'g'.repeat(128),
          maximum_file_size_bytes: 15_728_640,
          allowed_content_types: ['image/jpeg', 'image/png', 'image/webp'],
        },
        purge_after: status.purge_after,
        replayed: false,
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ contribution: imageStatus, trace_id: 'tr-test' }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitPublicContribution(input(image), 'public-idempotency-0002', uploader);

    expect(result.media_count).toBe(1);
    expect(uploader).toHaveBeenCalledWith(
      'firewarning/source-packages/upload-1/0001-preuve.png',
      image,
      expect.objectContaining({
        access: 'private',
        handleUploadUrl: `${API_ORIGIN}/api/v1/contributions/blob-upload-token`,
        clientPayload: 'SP-0001',
        contentType: 'image/png',
        headers: { 'X-Blob-Upload-Grant': 'g'.repeat(128) },
        multipart: true,
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_ORIGIN}/api/v1/contributions/${status.contribution_id}/finalize`, expect.objectContaining({ method: 'POST' }));
  });

  it('retire le consentement côté serveur puis efface le jeton local', async () => {
    localStorage.setItem('fw:contribution-access:v1', JSON.stringify([{
      contributionId: status.contribution_id,
      trackingToken: 'tracking-secret',
      fireId: null,
      storedAt: '2026-07-20T13:00:00Z',
    }]));
    const withdrawn = { ...status, state: 'WITHDRAWN' as const };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ contribution: withdrawn, trace_id: 'tr-test' }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    expect((await withdrawPublicContribution(status.contribution_id, 'tracking-secret')).state).toBe('WITHDRAWN');
    expect(readPublicContributionAccess(status.contribution_id)).toBeNull();
  });
});
