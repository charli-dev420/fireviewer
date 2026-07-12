/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import notAvailableFixture from '../../../../contracts/viewer-manifest/v2/examples/not_available.json';
import {
  buildViewerManifestUrl,
  clearViewerManifestCache,
  getDataMode,
  getViewerManifestApiOrigin,
  isAbortError,
  loadViewerManifest,
  VIEWER_MANIFEST_REQUEST_TIMEOUT_MS,
  viewerManifestCacheKey,
  ViewerManifestClientError,
  type ViewerManifestEnvironment,
} from './manifestClient';

const API_ORIGIN = 'http://localhost:8000';
const API_ENV: ViewerManifestEnvironment = {
  VITE_USE_MOCKS: 'false',
  VITE_API_BASE_URL: API_ORIGIN,
};
const FIRE_ID = 'FR-83-00042';

function clonedFixture(): Record<string, unknown> {
  return structuredClone(notAvailableFixture) as Record<string, unknown>;
}

function manifestResponse(
  body: unknown = notAvailableFixture,
  etag = '"manifest-v1"',
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ETag: etag,
    },
  });
}

function response304(etag = '"manifest-v1"'): Response {
  return new Response(null, { status: 304, headers: { ETag: etag } });
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch;
}

function fetchOptions(mock: ReturnType<typeof vi.fn>, index = 0): RequestInit {
  return mock.mock.calls[index]?.[1] as RequestInit;
}

beforeEach(() => {
  clearViewerManifestCache(sessionStorage);
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearViewerManifestCache(sessionStorage);
  sessionStorage.clear();
});

describe('configuration du client ViewerManifest', () => {
  it('n’accepte que les valeurs Vite exactes et une origine HTTP(S) pure', () => {
    expect(getDataMode({ VITE_USE_MOCKS: 'true' })).toBe('mock');
    expect(getDataMode(API_ENV)).toBe('api');
    expect(getDataMode({ VITE_USE_MOCKS: 'false' })).toBe('unconfigured');
    expect(getDataMode({ VITE_USE_MOCKS: 'TRUE' })).toBe('unconfigured');
    expect(
      getDataMode({
        VITE_USE_MOCKS: 'false',
        VITE_API_BASE_URL: `${API_ORIGIN}/api/v1`,
      }),
    ).toBe('unconfigured');
    expect(getViewerManifestApiOrigin({ VITE_API_BASE_URL: `${API_ORIGIN}/` })).toBe(API_ORIGIN);
    expect(getViewerManifestApiOrigin({ VITE_API_BASE_URL: 'ftp://example.test' })).toBeNull();
  });

  it('construit uniquement la route publique canonique avec les options fetch sûres', async () => {
    const fetchMock = vi.fn().mockResolvedValue(manifestResponse());

    await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
      storage: null,
      now: () => new Date('2026-07-13T08:00:00.000Z'),
    });

    expect(buildViewerManifestUrl(API_ORIGIN, FIRE_ID)).toBe(
      `${API_ORIGIN}/api/v1/incident/${FIRE_ID}/manifest`,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${API_ORIGIN}/api/v1/incident/${FIRE_ID}/manifest`,
    );
    expect(fetchOptions(fetchMock)).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
  });

  it('refuse le mode N/A avant toute requête', async () => {
    const fetchMock = vi.fn();

    await expect(
      loadViewerManifest(FIRE_ID, {
        environment: { VITE_USE_MOCKS: 'false', VITE_API_BASE_URL: `${API_ORIGIN}/api` },
        fetchImpl: asFetch(fetchMock),
      }),
    ).rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('loadViewerManifest', () => {
  it('parse strictement une réponse 200 et cache le résultat avec son ETag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(manifestResponse());
    const checkedAt = '2026-07-13T08:00:00.000Z';

    const result = await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
      now: () => new Date(checkedAt),
    });

    expect(result).toMatchObject({
      etag: '"manifest-v1"',
      checkedAt,
      revalidated: false,
      notModified: false,
      summary: {
        fireId: FIRE_ID,
        modelState: 'not_available',
        asset: null,
        frame: null,
      },
    });
    expect(sessionStorage.getItem(viewerManifestCacheKey(API_ORIGIN, FIRE_ID))).toContain('manifest-v1');
  });

  it('réutilise uniquement un cache validé après un 304 dont l’ETag est identique', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(response304());
    const firstCheckedAt = '2026-07-13T08:00:00.000Z';
    const secondCheckedAt = '2026-07-13T08:05:00.000Z';

    await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
      now: () => new Date(firstCheckedAt),
    });
    const result = await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
      now: () => new Date(secondCheckedAt),
    });

    expect(fetchOptions(fetchMock, 1).headers).toMatchObject({
      Accept: 'application/json',
      'If-None-Match': '"manifest-v1"',
    });
    expect(result).toMatchObject({
      checkedAt: secondCheckedAt,
      revalidated: true,
      notModified: true,
      summary: { fireId: FIRE_ID },
    });
  });

  it('purge un cache corrompu puis charge un 200 inconditionnel', async () => {
    const key = viewerManifestCacheKey(API_ORIGIN, FIRE_ID);
    sessionStorage.setItem(key, '{not-json');
    const fetchMock = vi.fn().mockResolvedValue(manifestResponse());

    await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
    });

    expect(fetchOptions(fetchMock).headers).not.toHaveProperty('If-None-Match');
    expect(sessionStorage.getItem(key)).toContain('manifest-v1');
  });

  it('retente une seule fois sans condition si un 304 arrive sans cache local', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response304())
      .mockResolvedValueOnce(manifestResponse());

    const result = await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchOptions(fetchMock, 0).headers).not.toHaveProperty('If-None-Match');
    expect(fetchOptions(fetchMock, 1).headers).not.toHaveProperty('If-None-Match');
    expect(result.revalidated).toBe(false);
  });

  it('purge puis retente sans condition lorsqu’un 304 porte un ETag incohérent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(response304('"other"'))
      .mockResolvedValueOnce(manifestResponse(notAvailableFixture, '"manifest-v2"'));

    await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
    });
    const result = await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchOptions(fetchMock, 1).headers).toMatchObject({ 'If-None-Match': '"manifest-v1"' });
    expect(fetchOptions(fetchMock, 2).headers).not.toHaveProperty('If-None-Match');
    expect(result.etag).toBe('"manifest-v2"');
  });

  it('utilise le cache mémoire lorsque sessionStorage est indisponible', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(response304());

    await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
      storage: null,
    });
    const result = await loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(fetchMock),
      storage: null,
    });

    expect(result.revalidated).toBe(true);
    expect(fetchOptions(fetchMock, 1).headers).toMatchObject({ 'If-None-Match': '"manifest-v1"' });
  });

  it('refuse une réponse sans ETag et ne la laisse pas dans le cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(notAvailableFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      loadViewerManifest(FIRE_ID, { environment: API_ENV, fetchImpl: asFetch(fetchMock) }),
    ).rejects.toMatchObject({ kind: 'parse' });
    expect(sessionStorage.getItem(viewerManifestCacheKey(API_ORIGIN, FIRE_ID))).toBeNull();
  });

  it('refuse strictement le DTO invalide et le fire_id qui ne correspond pas à la requête', async () => {
    const invalidSchema = clonedFixture();
    invalidSchema.schema_version = '2.1';
    const wrongIncident = clonedFixture();
    wrongIncident.fire_id = 'FR-83-00043';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(manifestResponse(invalidSchema))
      .mockResolvedValueOnce(manifestResponse(wrongIncident));

    await expect(
      loadViewerManifest(FIRE_ID, { environment: API_ENV, fetchImpl: asFetch(fetchMock) }),
    ).rejects.toMatchObject({ kind: 'parse' });
    await expect(
      loadViewerManifest(FIRE_ID, { environment: API_ENV, fetchImpl: asFetch(fetchMock) }),
    ).rejects.toMatchObject({ kind: 'parse' });
  });

  it('convertit Problem Details en erreur typée sans conserver detail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          title: 'Service temporairement indisponible',
          status: 503,
          detail: 'secret opérationnel à ne jamais rendre',
          trace_id: 'trace-fv006-001',
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );

    try {
      await loadViewerManifest(FIRE_ID, { environment: API_ENV, fetchImpl: asFetch(fetchMock) });
      throw new Error('La requête devait échouer.');
    } catch (error) {
      expect(error).toBeInstanceOf(ViewerManifestClientError);
      const clientError = error as ViewerManifestClientError;
      expect(clientError).toMatchObject({
        kind: 'http',
        status: 503,
        title: 'Service temporairement indisponible',
        traceId: 'trace-fv006-001',
      });
      expect(clientError.message).not.toContain('secret opérationnel');
      expect(Object.hasOwn(clientError, 'detail')).toBe(false);
    }
  });

  it('distingue le timeout de 8 secondes de l’annulation externe silencieuse', async () => {
    vi.useFakeTimers();
    const hangingFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('interrompu', 'AbortError')),
          { once: true },
        );
      }),
    );

    const timedOut = loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(hangingFetch),
      storage: null,
      timeoutMs: 10,
    });
    const timeoutExpectation = expect(timedOut).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(10);
    await timeoutExpectation;
    expect(VIEWER_MANIFEST_REQUEST_TIMEOUT_MS).toBe(8_000);

    const controller = new AbortController();
    const cancelled = loadViewerManifest(FIRE_ID, {
      environment: API_ENV,
      fetchImpl: asFetch(hangingFetch),
      storage: null,
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    const cancellationExpectation = expect(cancelled).rejects.toSatisfy(isAbortError);
    controller.abort();
    await cancellationExpectation;
  });
});
