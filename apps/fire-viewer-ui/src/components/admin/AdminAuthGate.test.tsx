/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthGate } from './AdminAuthGate';

const API_ORIGIN = 'http://localhost:8000';

function successResponse(): Response {
  return new Response(JSON.stringify({ authenticated: true, csrf_token: 'admin-gate-test-csrf' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderGate() {
  return render(
    <AdminAuthGate>{() => <p>Contenu privé administrateur</p>}</AdminAuthGate>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AdminAuthGate', () => {
  it('attend la validation serveur du cookie de session avant de monter le contenu privé', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderGate();

    expect(screen.getByText('Validation de la session administrateur…')).toBeVisible();
    expect(screen.queryByText('Contenu privé administrateur')).not.toBeInTheDocument();

    resolveResponse?.(successResponse());

    expect(await screen.findByText('Contenu privé administrateur')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_ORIGIN}/api/v1/admin/session`,
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }),
    );
  });

  it('refuse les identifiants sans exposer le détail renvoyé par l’API', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ detail: 'information interne à ne jamais afficher' }),
        { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderGate();

    await screen.findByRole('heading', { name: 'Connexion administrateur requise' });
    await user.type(screen.getByLabelText('Mot de passe'), 'mot-de-passe-refusé');
    await user.click(screen.getByRole('button', { name: 'Ouvrir l’administration' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants administrateur refusés.');
    expect(screen.queryByText('Contenu privé administrateur')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('information interne à ne jamais afficher');
    expect(sessionStorage.length).toBe(0);
  });

  it('ouvre une session locale sans persister le mot de passe dans le navigateur', async () => {
    const user = userEvent.setup();
    let authenticated = false;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/v1/admin/auth/login')) {
        authenticated = true;
        return Promise.resolve(successResponse());
      }
      return Promise.resolve(authenticated ? successResponse() : new Response(null, { status: 401 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderGate();

    await screen.findByRole('heading', { name: 'Connexion administrateur requise' });
    await user.type(screen.getByLabelText('Mot de passe'), 'mot-de-passe-test');
    await user.click(screen.getByRole('button', { name: 'Ouvrir l’administration' }));

    expect(await screen.findByText('Contenu privé administrateur')).toBeVisible();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${API_ORIGIN}/api/v1/admin/auth/login`,
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${API_ORIGIN}/api/v1/admin/session`,
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
    expect(sessionStorage.length).toBe(0);
  });
});
