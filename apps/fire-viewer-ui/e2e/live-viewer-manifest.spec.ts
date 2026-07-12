import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const currentDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repositoryRoot = resolve(currentDirectory, '..', '..', '..');
const seedFireId = 'FR-83-00042';
const unknownFireId = 'FR-83-99999';
const uiOrigin = 'http://localhost:5173';
const apiOrigin = 'http://localhost:8000/api/v1';
const manifestPath = `/incident/${seedFireId}/manifest`;
const manifestUrl = `${apiOrigin}${manifestPath}`;

const availableManifest = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'contracts', 'viewer-manifest', 'v2', 'examples', 'available.json'),
    'utf8',
  ),
) as Record<string, unknown>;

function isManifestResponse(url: string): boolean {
  return url === manifestUrl;
}

test.describe('ViewerManifest live integration', () => {
  test('migrates and seeds a real SQLite database, then exposes the canonical CORS contract', async ({ request }) => {
    const current = await request.get(manifestUrl, {
      headers: { Origin: uiOrigin },
    });

    expect(current.status()).toBe(200);
    expect(current.headers()['access-control-allow-origin']).toBe(uiOrigin);
    expect(current.headers()['etag']).toBeTruthy();
    expect(current.headers()['cache-control']).toContain('must-revalidate');
    const payload = await current.json();
    expect(payload).toMatchObject({
      fire_id: seedFireId,
      episode_id: 'E03',
      model_state: 'not_available',
      asset: null,
      frame: null,
    });

    const preflight = await request.fetch(manifestUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: uiOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'if-none-match',
      },
    });
    expect(preflight.status()).toBe(200);
    expect(preflight.headers()['access-control-allow-origin']).toBe(uiOrigin);
    expect(preflight.headers()['access-control-allow-headers'].toLowerCase()).toContain(
      'if-none-match',
    );

    const untrustedOrigin = await request.get(manifestUrl, {
      headers: { Origin: 'https://untrusted.example.invalid' },
    });
    expect(untrustedOrigin.headers()['access-control-allow-origin']).toBeUndefined();
  });

  test('returns 304 with the seed ETag when the manifest is revalidated', async ({ request }) => {
    const first = await request.get(manifestUrl);
    expect(first.status()).toBe(200);
    const etag = first.headers()['etag'];
    expect(etag).toBeTruthy();

    const unchanged = await request.get(manifestUrl, {
      headers: { 'If-None-Match': etag },
    });
    expect(unchanged.status()).toBe(304);
    expect(unchanged.headers()['etag']).toBe(etag);
    expect(unchanged.headers()['cache-control']).toBe(first.headers()['cache-control']);
    expect(await unchanged.body()).toHaveLength(0);
  });

  test('renders the seeded no-asset manifest and revalidates it in the browser', async ({ page }) => {
    const manifestRequests: string[] = [];
    const manifestResponses: number[] = [];
    const glbRequests: string[] = [];
    const mockModuleRequests: string[] = [];
    page.on('request', (request) => {
      if (isManifestResponse(request.url())) {
        manifestRequests.push(request.headers()['if-none-match'] ?? '');
      }
      if (/\.glb(?:$|[?#])/i.test(request.url())) glbRequests.push(request.url());
      if (/(?:\/MockApp(?:-[^/]+)?\.js|\/MockApp\.tsx|\/demoIncident\.ts)(?:$|[?#])/i.test(request.url())) {
        mockModuleRequests.push(request.url());
      }
    });
    page.on('response', (response) => {
      if (isManifestResponse(response.url())) manifestResponses.push(response.status());
    });

    await page.goto(`/incident/${seedFireId}`);
    await expect(page.getByRole('heading', { name: 'Aucun modèle public disponible' }).first()).toBeVisible();
    await expect(page.getByText('Manifeste revalidé').first()).toBeVisible();

    const revalidated = page.waitForResponse(
      (response) => isManifestResponse(response.url()) && response.status() === 304,
    );
    await page.getByRole('button', { name: 'Actualiser le manifeste' }).click();
    await revalidated;

    expect(manifestResponses).toContain(200);
    expect(manifestResponses).toContain(304);
    expect(manifestRequests.some(Boolean)).toBe(true);
    expect(glbRequests).toEqual([]);
    expect(mockModuleRequests).toEqual([]);
  });

  test('uses the DEV-only accelerated polling harness to revalidate the cached manifest', async ({ page }) => {
    const manifestRequests: string[] = [];
    const manifestResponses: number[] = [];
    page.on('request', (request) => {
      if (isManifestResponse(request.url())) {
        manifestRequests.push(request.headers()['if-none-match'] ?? '');
      }
    });
    page.on('response', (response) => {
      if (isManifestResponse(response.url())) manifestResponses.push(response.status());
    });

    await page.goto(`/incident/${seedFireId}`);
    await expect(page.getByRole('heading', { name: 'Aucun modèle public disponible' }).first()).toBeVisible();
    await expect.poll(() => manifestResponses.includes(304), { timeout: 2_000 }).toBe(true);

    expect(manifestResponses).toContain(200);
    expect(manifestRequests.some(Boolean)).toBe(true);
  });

  test('shows the API 404 state for an unknown incident', async ({ page }) => {
    const response = page.waitForResponse(
      (candidate) => candidate.url() === `${apiOrigin}/incident/${unknownFireId}/manifest`,
    );
    await page.goto(`/incident/${unknownFireId}`);
    expect((await response).status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Incident introuvable' })).toBeVisible();
  });

  test('takes the true AbortController timeout path when the manifest remains pending', async ({ page }) => {
    test.setTimeout(20_000);
    await page.addInitScript(() => {
      // This single scenario needs one request to live for the fixed production
      // 8-second timeout. The separate polling scenario remains visible and covers
      // the accelerated E2E interval.
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
    });
    await page.route(`**${manifestPath}`, async (route) => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 8_500));
      await route.abort('timedout').catch(() => undefined);
    });

    await page.goto(`/incident/${seedFireId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Le service n’a pas répondu dans le délai autorisé.')).toBeVisible({
      timeout: 12_000,
    });
  });

  test('keeps the available mock response textual when WebGL is unavailable and never fetches its GLB', async ({ page }) => {
    const glbRequests: string[] = [];
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await page.route(`**${manifestPath}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': uiOrigin,
          'Access-Control-Expose-Headers': 'ETag',
          'Cache-Control': 'public, max-age=30, must-revalidate',
          ETag: '"e2e-available"',
        },
        body: JSON.stringify(availableManifest),
      }),
    );
    page.on('request', (request) => {
      if (/\.glb(?:$|[?#])/i.test(request.url())) glbRequests.push(request.url());
    });

    await page.goto(`/incident/${seedFireId}`);
    await expect(page.getByText('WebGL est indisponible. La consultation reste textuelle et aucun asset 3D n’est chargé.')).toBeVisible();
    expect(glbRequests).toEqual([]);
  });

  test('reports WebGL availability for the available mock response without loading its GLB', async ({ page }) => {
    const glbRequests: string[] = [];
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(contextId, ...argumentsList) {
        if (contextId === 'webgl' || contextId === 'experimental-webgl') return {} as WebGLRenderingContext;
        return originalGetContext.call(this, contextId, ...argumentsList);
      };
    });
    await page.route(`**${manifestPath}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': uiOrigin,
          'Access-Control-Expose-Headers': 'ETag',
          'Cache-Control': 'public, max-age=30, must-revalidate',
          ETag: '"e2e-available"',
        },
        body: JSON.stringify(availableManifest),
      }),
    );
    page.on('request', (request) => {
      if (/\.glb(?:$|[?#])/i.test(request.url())) glbRequests.push(request.url());
    });

    await page.goto(`/incident/${seedFireId}`);
    await expect(page.getByText('WebGL est détecté. Le chargement GLB et Unity est volontairement reporté aux passes FV‑008/FV‑009.')).toBeVisible();
    expect(glbRequests).toEqual([]);
  });
});
