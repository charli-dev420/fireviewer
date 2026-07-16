import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

const currentDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repositoryRoot = resolve(currentDirectory, '..', '..', '..');
const seedFireId = 'FR-83-00042';
const unknownFireId = 'FR-83-99999';
const uiOrigin = 'http://localhost:5173';
const apiOrigin = 'http://localhost:8000/api/v1';
const manifestPath = `/incident/${seedFireId}/manifest`;
const manifestUrl = `${apiOrigin}${manifestPath}`;
const publicViewUrl = `${apiOrigin}/incident/${seedFireId}/public-view`;
const referenceCaptureDirectory = resolve(repositoryRoot, 'docs', 'ui-references');

const availableManifest = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'contracts', 'viewer-manifest', 'v2', 'examples', 'available.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const availablePublicView = {
  schema_version: '1.0', fire_id: seedFireId, canonical_name: 'Massif de démonstration', public_note: null,
  status: 'MONITORING', verification: 'verified', freshness_at: '2026-07-12T08:24:00Z', last_human_validation_at: '2026-07-12T08:05:00Z', location: null,
  facts: ['Incident de démonstration.'], limitations: ['Aucune donnée opérationnelle.'], episodes: [], observations: [], sources: [], timeline: [],
  model: { state: 'available', version: 1, sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', size_bytes: 123456, lod: 'desktop', terrain_source_year: 2024, generated_at: '2026-07-12T08:20:00Z', public_download_available: false, limitations: [] },
  downloads: [],
};

const tacticalModelDocument = {
  asset: { version: '2.0', generator: 'fire-viewer-e2e' },
  buffers: [{ uri: 'data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAAAgQQAAAAAAAAAAAAAAAAAAIEEAAAAAAAABAAIA', byteLength: 42 }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
    { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [10, 10, 0] },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  nodes: [{ mesh: 0 }],
  scenes: [{ nodes: [0] }],
  scene: 0,
};

function isManifestResponse(url: string): boolean {
  return url === manifestUrl;
}

async function openIncidentSection(page: Page, label: string): Promise<void> {
  const desktopTab = page.getByRole('tab', { name: label });
  if (await desktopTab.count()) {
    await desktopTab.click();
    return;
  }
  await page.getByRole('button', { name: /Sommaire de la fiche/ }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
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
    page.on('request', (request) => {
      if (isManifestResponse(request.url())) {
        manifestRequests.push(request.headers()['if-none-match'] ?? '');
      }
      if (/\.glb(?:$|[?#])/i.test(request.url())) glbRequests.push(request.url());
    });
    page.on('response', (response) => {
      if (isManifestResponse(response.url())) manifestResponses.push(response.status());
    });

    await page.goto(`/incident/${seedFireId}`);
    await expect(page.getByText('Projection publique').first()).toBeVisible();
    await expect(page.locator('.manifest-freshness').getByText('Manifeste revalidé')).toBeVisible();

    const revalidated = page.waitForResponse(
      (response) => isManifestResponse(response.url()) && response.status() === 304,
    );
    await page.getByRole('button', { name: 'Revalider' }).click();
    await revalidated;

    expect(manifestResponses).toContain(200);
    expect(manifestResponses).toContain(304);
    expect(manifestRequests.some(Boolean)).toBe(true);
    expect(glbRequests).toEqual([]);
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
    await expect(page.getByText('Projection publique').first()).toBeVisible();
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

  test('keeps the tactical viewer informative when WebGL is unavailable and never fetches its GLB', async ({ page }) => {
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
    await page.route(publicViewUrl, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(availablePublicView) }));
    page.on('request', (request) => {
      if (/\.glb(?:$|[?#])/i.test(request.url())) glbRequests.push(request.url());
    });

    await page.goto(`/incident/${seedFireId}`);
    await openIncidentSection(page, 'Vue 3D');
    await expect(page.getByText('Le modèle ne peut pas être affiché sur cet appareil.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mesurer' })).toBeVisible();
    expect(glbRequests).toEqual([]);
  });

  test('captures the editorial public dossier at the reference desktop and mobile widths', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-chromium';
    await page.setViewportSize({ width: isMobile ? 393 : 1440, height: isMobile ? 852 : 980 });
    await page.goto(`/incident/${seedFireId}`);
    await expect(page.getByText('Projection publique').first()).toBeVisible();
    mkdirSync(referenceCaptureDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(referenceCaptureDirectory, `public-incident-${isMobile ? 'mobile-393' : 'desktop-1440'}.png`),
      fullPage: true,
    });
  });

  test('loads and renders the tactical GLB after the 3D view is explicitly selected', async ({ page }) => {
    const glbRequests: string[] = [];
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
    await page.route(publicViewUrl, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(availablePublicView) }));
    await page.route('**/*.glb', (route) => route.fulfill({ status: 200, contentType: 'model/gltf+json', body: JSON.stringify(tacticalModelDocument) }));
    page.on('request', (request) => {
      if (/\.glb(?:$|[?#])/i.test(request.url())) glbRequests.push(request.url());
    });

    await page.goto(`/incident/${seedFireId}`);
    const requested = page.waitForRequest((request) => /\.glb(?:$|[?#])/i.test(request.url()));
    await openIncidentSection(page, 'Vue 3D');
    await requested;
    expect(glbRequests).toHaveLength(1);
    expect(glbRequests[0]).toContain('.glb');
    await expect(page.getByText('Prêt')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mesurer' })).toBeEnabled();
  });
});
