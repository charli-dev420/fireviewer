import { expect, test } from '@playwright/test';

const mapRoute = '/demo/zones/die-pontaix';
const mapOrigin = 'http://localhost:5173';

function isMapAsset(url: string, suffix: string): boolean {
  const parsed = new URL(url);
  return parsed.origin === mapOrigin && parsed.pathname.endsWith(suffix);
}

test.describe('Démonstration technique spatiale Die–Pontaix', () => {
  test('affiche une zone unique, reste same-origin à distance et ne charge aucun GLB', async ({ page }) => {
    const requests: string[] = [];
    const glbRequests: string[] = [];
    const externalRequests: string[] = [];
    const forbiddenMapRequests: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      requests.push(url);
      if (/\.glb(?:$|[?#])/i.test(url)) glbRequests.push(url);
      if (/^https?:/i.test(url) && new URL(url).origin !== mapOrigin) externalRequests.push(url);
      if (/(?:cesium|mapbox|openstreetmap|openlayers\.org|geoportail)/i.test(url)) {
        forbiddenMapRequests.push(url);
      }
    });

    await page.goto(mapRoute);
    await expect(page).toHaveTitle('Fire-Viewer — Carte 3D Zone Die–Pontaix');
    await expect(page.getByRole('heading', { name: 'Zone Die–Pontaix' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recentrer la zone' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Die', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pontaix', exact: true })).toHaveCount(0);
    await expect(page.locator('.spatial-map-canvas')).toBeVisible();
    await expect.poll(() => requests.some((url) => isMapAsset(url, '/catalog.json'))).toBe(true);
    await expect.poll(() => requests.some((url) => /\.(?:png|cog\.tif)(?:$|[?#])/i.test(url))).toBe(true);

    await page.getByRole('button', { name: 'Recentrer la zone' }).click();
    await expect(page.getByText(/Vue lointaine|relief et aperçu couleur/i)).toBeVisible();
    await page.waitForTimeout(350);

    expect(glbRequests).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(forbiddenMapRequests).toEqual([]);
  });

  test('conserve un fallback DOM sans WebGL, Cesium ni GLB', async ({ page }) => {
    const glbRequests: string[] = [];
    const forbiddenMapRequests: string[] = [];
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    page.on('request', (request) => {
      const url = request.url();
      if (/\.glb(?:$|[?#])/i.test(url)) glbRequests.push(url);
      if (/(?:cesium|mapbox|openstreetmap|openlayers\.org|geoportail)/i.test(url)) {
        forbiddenMapRequests.push(url);
      }
    });

    await page.goto(mapRoute);
    await expect(page.getByRole('heading', { name: 'Zone Die–Pontaix' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rendu 3D indisponible' })).toBeVisible();
    await expect(page.getByText(/même domaine/i)).toBeVisible();

    expect(glbRequests).toEqual([]);
    expect(forbiddenMapRequests).toEqual([]);
  });
});
