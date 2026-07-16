/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAdminSessionUrl,
  clearAdminSession,
  getAdminApiOrigin,
  loadAdminSession,
  normalizeAdminBearer,
  saveAdminSession,
  validateAdminSession,
  type AdminSessionEnvironment,
} from './adminSession';

const LOCAL_API_ORIGIN = 'http://localhost:8000';
const HTTPS_API_ORIGIN = 'https://api.fireviewer.example';
const LOCAL_ENV: AdminSessionEnvironment = { VITE_API_BASE_URL: LOCAL_API_ORIGIN };

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch;
}

function fetchOptions(mock: ReturnType<typeof vi.fn>): RequestInit {
  return mock.mock.calls[0]?.[1] as RequestInit;
}

function sessionResponse(
  body: unknown = { authenticated: true, csrf_token: 'csrf-test' },
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  clearAdminSession(sessionStorage);
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('configuration et stockage de session administrateur', () => {
  it('n’utilise que HTTPS ou une origine locale de développement', () => {
    expect(getAdminApiOrigin(LOCAL_ENV)).toBe(LOCAL_API_ORIGIN);
    expect(getAdminApiOrigin({ VITE_API_BASE_URL: HTTPS_API_ORIGIN })).toBe(HTTPS_API_ORIGIN);
    expect(getAdminApiOrigin({ VITE_API_BASE_URL: 'http://api.fireviewer.example' })).toBeNull();
    expect(getAdminApiOrigin({ VITE_API_BASE_URL: 'https://api.fireviewer.example/api/v1' })).toBeNull();
    expect(getAdminApiOrigin({ VITE_API_BASE_URL: 'https://user:pass@api.fireviewer.example' })).toBeNull();
  });

  it('ne persiste aucune session dans le navigateur', () => {
    const unsignedJwt = 'eyJhbGciOiJub25lIn0.eyJyb2xlcyI6WyJhZG1pbmlzdHJhdG9yIl19.'; // gitleaks:allow -- fixture JWT non signée.

    expect(normalizeAdminBearer(`Bearer ${unsignedJwt}`)).toBe(unsignedJwt);
    expect(normalizeAdminBearer(unsignedJwt)).toBe(unsignedJwt);
    expect(normalizeAdminBearer('Bearer')).toBeNull();
    expect(normalizeAdminBearer('Bearer token with-space')).toBeNull();

    saveAdminSession({ token: `Bearer ${unsignedJwt}` }, sessionStorage);
    expect(loadAdminSession(sessionStorage)).toBeNull();
    expect(sessionStorage).toHaveLength(0);
  });
});

describe('validateAdminSession', () => {
  it('monte une session uniquement après le DTO minimal validé par le serveur', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());
    const result = await validateAdminSession({
      environment: LOCAL_ENV,
      fetchImpl: asFetch(fetchMock),
    });

    expect(result).toEqual({ ok: true, session: { csrfToken: 'csrf-test' } });
    expect(buildAdminSessionUrl(LOCAL_API_ORIGIN)).toBe(`${LOCAL_API_ORIGIN}/api/v1/admin/session`);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${LOCAL_API_ORIGIN}/api/v1/admin/session`);
    expect(fetchOptions(fetchMock)).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });
  });

  it.each([401, 403])('refuse une session expirée ou interdite après une réponse serveur %i', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ detail: 'information serveur confidentielle à ne jamais montrer' }),
        { status, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    );

    const result = await validateAdminSession({
      environment: LOCAL_ENV,
      fetchImpl: asFetch(fetchMock),
    });

    expect(result).toEqual({ ok: false, reason: 'La session administrateur a expiré.' });
    expect(JSON.stringify(result)).not.toContain('information serveur confidentielle');
  });

  it('refuse une configuration, un statut non-200 ou une réponse non conforme sans donner accès', async () => {
    const absentConfigFetch = vi.fn();
    const absentConfig = await validateAdminSession({
      environment: { VITE_API_BASE_URL: 'http://api.fireviewer.example' },
      fetchImpl: asFetch(absentConfigFetch),
    });
    expect(absentConfig).toMatchObject({ ok: false });
    expect(absentConfigFetch).not.toHaveBeenCalled();

    const invalidDtoFetch = vi.fn().mockResolvedValue(sessionResponse({ authenticated: true, role: 'administrator' }));
    const invalidDto = await validateAdminSession({
      environment: LOCAL_ENV,
      fetchImpl: asFetch(invalidDtoFetch),
    });
    expect(invalidDto).toEqual({ ok: false, reason: 'La réponse de session n’est pas conforme.' });

    const acceptedButUnexpectedFetch = vi.fn().mockResolvedValue(sessionResponse({ authenticated: true }, 202));
    const acceptedButUnexpected = await validateAdminSession({
      environment: LOCAL_ENV,
      fetchImpl: asFetch(acceptedButUnexpectedFetch),
    });
    expect(acceptedButUnexpected).toEqual({ ok: false, reason: 'La session administrateur a expiré.' });
  });

  it('obtient le jeton CSRF auprès du serveur sans cookie lisible par JavaScript', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());

    const result = await validateAdminSession({
      environment: LOCAL_ENV,
      fetchImpl: asFetch(fetchMock),
    });

    expect(result).toEqual({ ok: true, session: { csrfToken: 'csrf-test' } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
