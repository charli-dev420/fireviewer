import { expect, test, type Page, type Route } from '@playwright/test';

const UI_ORIGIN = 'http://localhost:5173';
const ADMIN_API_ORIGIN = 'http://localhost:8000';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'e2e-admin-password';
const ADMIN_CSRF = 'e2e-admin-csrf-token';
const ZONE_ID = 'SECONDE-ZONE-99';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': UI_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, X-CSRF-Token',
};

interface MockZone {
  readonly zone_id: string;
  readonly label: string;
  readonly description: string;
  readonly visibility: 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';
  readonly bounds_l93_m: readonly [number, number, number, number];
  readonly created_at: string;
  readonly updated_at: string;
}

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly csrfToken: string | undefined;
  readonly idempotencyKey: string | undefined;
}

function isUnexpectedHost(url: URL): boolean {
  return (url.protocol === 'http:' || url.protocol === 'https:')
    && url.origin !== UI_ORIGIN
    && url.origin !== ADMIN_API_ORIGIN;
}

function requestJson<T extends Record<string, unknown>>(route: Route): T {
  const raw = route.request().postData();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

function problem(status: number, traceId: string): Record<string, unknown> {
  return {
    type: 'https://fire-viewer.invalid/problems/admin-e2e',
    title: 'Administration E2E',
    status,
    detail: 'Détail interne de test qui ne doit jamais être affiché par le navigateur.',
    trace_id: traceId,
  };
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS_HEADERS,
    body: JSON.stringify(payload),
  });
}

/**
 * Le backend est déjà démarré par globalSetup. Ce double de contrat isole le
 * parcours React : les réponses strictes servent à détecter toute divergence
 * du DTO admin sans dépendre du seed E2E ni des données locales.
 */
async function installAdminApiContract(page: Page): Promise<{ readonly requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  let zone: MockZone | null = null;
  let uploads: Array<Record<string, unknown>> = [];
  let information: Array<Record<string, unknown>> = [];
  let authenticated = false;
  await page.route(`${ADMIN_API_ORIGIN}/api/v1/admin/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const headers = request.headers();
    requests.push({
      url: request.url(),
      method,
      csrfToken: headers['x-csrf-token'],
      idempotencyKey: headers['idempotency-key'],
    });

    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    if (path === '/api/v1/admin/auth/login' && method === 'POST') {
      const payload = requestJson<{ username: string; password: string }>(route);
      if (payload.username !== ADMIN_USERNAME || payload.password !== ADMIN_PASSWORD) {
        await fulfillJson(route, problem(401, 'trace-admin-e2e-login-refused'), 401);
        return;
      }
      authenticated = true;
      await fulfillJson(route, { csrf_token: ADMIN_CSRF });
      return;
    }
    if (path === '/api/v1/admin/session' && method === 'GET') {
      if (!authenticated) {
        await fulfillJson(route, problem(401, 'trace-admin-e2e-session-required'), 401);
        return;
      }
      await fulfillJson(route, { authenticated: true, csrf_token: ADMIN_CSRF });
      return;
    }
    if (!authenticated) {
      await fulfillJson(route, problem(401, 'trace-admin-e2e-unauthorized'), 401);
      return;
    }
    if (!['GET', 'HEAD'].includes(method) && headers['x-csrf-token'] !== ADMIN_CSRF) {
      await fulfillJson(route, problem(403, 'trace-admin-e2e-csrf'), 403);
      return;
    }
    if (path === '/api/v1/admin/zones' && method === 'GET') {
      await fulfillJson(route, { zones: zone ? [zone] : [] });
      return;
    }
    if (path === '/api/v1/admin/zones' && method === 'POST') {
      const payload = requestJson<{
        zone_id: string;
        label: string;
        description: string;
        bounds_l93_m: readonly [number, number, number, number];
      }>(route);
      zone = {
        zone_id: payload.zone_id,
        label: payload.label,
        description: payload.description,
        visibility: 'DRAFT',
        bounds_l93_m: payload.bounds_l93_m,
        created_at: '2026-07-14T10:00:00Z',
        updated_at: '2026-07-14T10:00:00Z',
      };
      await fulfillJson(route, { zone, trace_id: 'trace-admin-e2e-create-zone' }, 201);
      return;
    }
    if (path === `/api/v1/admin/zones/${ZONE_ID}` && method === 'GET') {
      if (!zone) {
        await fulfillJson(route, problem(404, 'trace-admin-e2e-zone-not-found'), 404);
        return;
      }
      await fulfillJson(route, { zone, uploads, information });
      return;
    }
    if (path === `/api/v1/admin/zones/${ZONE_ID}` && method === 'PATCH') {
      if (!zone) {
        await fulfillJson(route, problem(404, 'trace-admin-e2e-zone-not-found'), 404);
        return;
      }
      const payload = requestJson<{
        label: string;
        description: string;
        bounds_l93_m: readonly [number, number, number, number];
      }>(route);
      zone = {
        ...zone,
        label: payload.label,
        description: payload.description,
        bounds_l93_m: payload.bounds_l93_m,
        updated_at: '2026-07-14T10:05:00Z',
      };
      await fulfillJson(route, { zone, trace_id: 'trace-admin-e2e-update-zone' });
      return;
    }
    if (path === `/api/v1/admin/zones/${ZONE_ID}/uploads` && method === 'POST') {
      const upload = {
        upload_id: 'upload-e2e-01',
        file_name: 'seconde-zone-r1.tar.gz',
        archive_sha256: 'a'.repeat(64),
        size_bytes: 24,
        state: 'VALIDATED',
        created_at: '2026-07-14T10:06:00Z',
        validation_summary: 'Archive de test validée par le contrat serveur.',
      };
      uploads = [upload];
      await fulfillJson(route, { upload, trace_id: 'trace-admin-e2e-upload' }, 201);
      return;
    }
    if (path === `/api/v1/admin/zones/${ZONE_ID}/visibility` && method === 'POST') {
      if (!zone) {
        await fulfillJson(route, problem(404, 'trace-admin-e2e-zone-not-found'), 404);
        return;
      }
      const payload = requestJson<{ visibility: 'PUBLISHED' | 'HIDDEN' }>(route);
      zone = {
        ...zone,
        visibility: payload.visibility,
        updated_at: '2026-07-14T10:07:00Z',
      };
      await fulfillJson(route, { zone, trace_id: 'trace-admin-e2e-visibility' });
      return;
    }
    if (path === `/api/v1/admin/zones/${ZONE_ID}/information` && method === 'POST') {
      const payload = requestJson<{
        title: string;
        body: string;
        category: string;
        position_l93: readonly [number, number];
      }>(route);
      const item = {
        information_id: 'information-e2e-01',
        title: payload.title,
        body: payload.body,
        category: payload.category,
        position_l93: payload.position_l93,
        state: 'DRAFT',
        updated_at: '2026-07-14T10:08:00Z',
        review_note: null,
      };
      information = [item];
      await fulfillJson(route, { information: item, trace_id: 'trace-admin-e2e-information-create' }, 201);
      return;
    }
    if (path === `/api/v1/admin/zones/${ZONE_ID}/information/information-e2e-01` && method === 'PATCH') {
      const payload = requestJson<{
        title: string;
        body: string;
        category: string;
        position_l93: readonly [number, number];
        state: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'HIDDEN' | 'REJECTED';
      }>(route);
      const item = {
        information_id: 'information-e2e-01',
        title: payload.title,
        body: payload.body,
        category: payload.category,
        position_l93: payload.position_l93,
        state: payload.state,
        updated_at: '2026-07-14T10:09:00Z',
        review_note: 'Revue e2e.',
      };
      information = [item];
      await fulfillJson(route, { information: item, trace_id: 'trace-admin-e2e-information-update' });
      return;
    }
    await fulfillJson(route, problem(404, 'trace-admin-e2e-unhandled'), 404);
  });

  return { requests };
}

test.describe('Administration privée des zones', () => {
  test('authentifie, crée, modifie, positionne et revoit sans charger de carte binaire', async ({ page }) => {
    const contract = await installAdminApiContract(page);
    const forbiddenRequests: string[] = [];
    const failedRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      const parsed = new URL(url);
      if (
        /\/api\/v1\/incident\//.test(url)
        || /\/maps\//.test(url)
        || /\.(?:glb|cog\.tif)(?:$|[?#])/i.test(url)
        || (request.method() !== 'POST' && /\.tar\.gz(?:$|[?#])/i.test(url))
        || isUnexpectedHost(parsed)
      ) {
        forbiddenRequests.push(url);
      }
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown failure'}`);
    });

    await test.step('connexion et création de la zone autonome', async () => {
      await page.goto('/admin/zones');
      await expect(page.getByRole('heading', { name: 'Connexion administrateur requise' })).toBeVisible();
      await page.getByLabel('Identifiant').fill(ADMIN_USERNAME);
      await page.getByLabel('Mot de passe').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Ouvrir l’administration' }).click();
      await expect(page.getByRole('heading', { name: 'Cartes 3D' })).toBeVisible();
      await expect(page.getByText('Aucune carte 3D')).toBeVisible();

      await page.getByRole('link', { name: 'Ajouter une carte', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Préparer une carte 3D' })).toBeVisible();
      await page.getByLabel('Identifiant stable').fill(ZONE_ID);
      await page.getByLabel('Nom public').fill('Seconde zone rurale');
      await page.getByLabel('Description').fill('Zone rurale synthétique et indépendante.');
      await page.getByLabel('X minimum').fill('876000');
      await page.getByLabel('Y minimum').fill('6403000');
      await page.getByLabel('X maximum').fill('892000');
      await page.getByLabel('Y maximum').fill('6413000');
      await page.getByLabel('Motif administratif').fill('Création de la seconde zone de test.');
      await page.getByRole('button', { name: 'Créer la carte' }).click();
      await expect(page.getByRole('heading', { name: 'Carte créée' })).toBeVisible();
      await page.getByRole('link', { name: 'Continuer' }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/zones/${ZONE_ID}$`));
      await expect(page.getByRole('heading', { name: 'Seconde zone rurale' })).toBeVisible();
    });

    await test.step('modification technique sans faux contrôle de publication', async () => {
      await page.getByText('Paramètres techniques de la zone').click();
      await page.getByLabel('Nom public').fill('Seconde zone rurale vérifiée');
      await page.getByLabel('Motif administratif').fill('Correction éditoriale après contrôle humain.');
      await page.getByRole('button', { name: 'Enregistrer les paramètres' }).click();
      await expect(page.getByText('La définition de la zone a été mise à jour.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Seconde zone rurale vérifiée' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Publier la zone' })).toHaveCount(0);
      await expect(page.getByText(/unique parcours de publication de la carte/i)).toBeVisible();
    });

    await test.step('création puis revue d’une information dans l’emprise locale', async () => {
      await page.getByRole('link', { name: 'Ajouter une information' }).first().click();
      await expect(page.getByRole('heading', { name: `Ajouter une information — ${ZONE_ID}` })).toBeVisible();
      await page.getByLabel('Titre').fill('Point d’observation local');
      await page.getByLabel('Catégorie').fill('accès');
      await page.getByLabel('Contenu').fill('Information synthétique localisée dans la seconde zone.');
      await page.getByLabel('Est / X').fill('880000');
      await page.getByLabel('Nord / Y').fill('6408000');
      await page.getByLabel('Motif administratif').fill('Ajout contrôlé.');
      await page.getByRole('button', { name: 'Ajouter l’information' }).click();
      await expect(page.getByRole('heading', { name: 'Information enregistrée' })).toBeVisible();
      await page.getByRole('link', { name: 'Revenir à la zone' }).click();
      await page.getByRole('link', { name: 'Modifier' }).click();
      await expect(page.getByRole('heading', { name: `Modifier une information — ${ZONE_ID}` })).toBeVisible();
      await page.getByLabel('État de revue').selectOption('PUBLISHED');
      await page.getByLabel('Motif administratif').fill('Revue humaine terminée.');
      await page.getByRole('button', { name: 'Enregistrer la revue' }).click();
      await expect(page.getByText('Information mise à jour.')).toBeVisible();
    });

    const protectedRequests = contract.requests.filter((request) => !request.url.endsWith('/auth/login') && !request.url.endsWith('/session') && request.method !== 'OPTIONS');
    const mutationRequests = protectedRequests.filter((request) => ['POST', 'PATCH'].includes(request.method));
    expect(protectedRequests.length).toBeGreaterThan(6);
    expect(protectedRequests.every((request) => request.url.startsWith(`${ADMIN_API_ORIGIN}/api/v1/admin/`))).toBe(true);
    expect(mutationRequests.length).toBeGreaterThanOrEqual(4);
    expect(mutationRequests.every((request) => Boolean(request.idempotencyKey))).toBe(true);
    expect(mutationRequests.every((request) => request.csrfToken === ADMIN_CSRF)).toBe(true);
    // Les liens `<a>` rechargent la page : la validation de session initiée
    // au montage peut donc être annulée pendant cette navigation normale.
    expect(failedRequests.filter((request) => !request.startsWith(`GET ${ADMIN_API_ORIGIN}/api/v1/admin/session net::ERR_ABORTED`))).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
  });

  test('ne monte jamais l’administration lorsque l’API refuse le mot de passe', async ({ page }) => {
    await page.route(`${ADMIN_API_ORIGIN}/api/v1/admin/**`, async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      await fulfillJson(route, problem(401, 'trace-admin-e2e-rejected'), 401);
    });

    await page.goto('/admin/zones');
    await page.getByLabel('Identifiant').fill(ADMIN_USERNAME);
    await page.getByLabel('Mot de passe').fill('mot-de-passe-refuse');
    await page.getByRole('button', { name: 'Ouvrir l’administration' }).click();

    await expect(page.getByRole('alert')).toHaveText('Identifiants administrateur refusés.');
    await expect(page.getByRole('heading', { name: 'Fire-Viewer Admin' })).not.toBeVisible();
    await expect(page.locator('body')).not.toContainText('Détail interne de test qui ne doit jamais être affiché par le navigateur.');
    await expect
      .poll(() => page.evaluate(() => window.sessionStorage.getItem('fire-viewer:admin-session:v1')))
      .toBeNull();
  });
});

test.describe('Rapprochement spatial administrateur', () => {
  test('rattache une observation motivée sans fusion implicite', async ({ page }) => {
    let resolved = false;
    let authenticated = false;
    let resolveRequest: { readonly body: Record<string, unknown>; readonly idempotencyKey: string | undefined } | null = null;

    await page.route(`${ADMIN_API_ORIGIN}/api/v1/admin/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      if (path === '/api/v1/admin/auth/login' && route.request().method() === 'POST') {
        const payload = requestJson<{ username: string; password: string }>(route);
        authenticated = payload.username === ADMIN_USERNAME && payload.password === ADMIN_PASSWORD;
        await fulfillJson(route, authenticated ? { csrf_token: ADMIN_CSRF } : problem(401, 'trace-spatial-login-refused'), authenticated ? 200 : 401);
        return;
      }
      if (path === '/api/v1/admin/session') {
        await fulfillJson(route, authenticated ? { authenticated: true, csrf_token: ADMIN_CSRF } : problem(401, 'trace-spatial-session-required'), authenticated ? 200 : 401);
        return;
      }
      await fulfillJson(route, problem(404, 'trace-spatial-admin-not-found'), 404);
    });
    await page.route(`${ADMIN_API_ORIGIN}/api/v2/admin/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      if (!authenticated) {
        await fulfillJson(route, problem(401, 'trace-spatial-unauthorized'), 401);
        return;
      }
      if (path === '/api/v2/admin/work-queue') {
        await fulfillJson(route, {
          observations: resolved ? [] : [{
            observation_id: 'OBS-SPATIAL-E2E', source_key: 'capteur-e2e', observed_at: '2026-07-15T10:00:00Z',
            longitude: 6.02, latitude: 43.29, horizontal_uncertainty_m: 240, verification_state: 'PENDING_REVIEW',
            proposed_fire_id: 'FR-83-00042', proposed_episode_id: 'E01', proposed_episode_status: 'UNDER_REVIEW',
            match_score: 0.82, review_reasons: ['distance cohérente', 'source récente'], version: 1,
          }],
          reports: [], incidents: [],
        });
        return;
      }
      await fulfillJson(route, problem(404, 'trace-spatial-v2-not-found'), 404);
    });
    await page.route(`${ADMIN_API_ORIGIN}/api/v1/operator/**`, async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      if (!authenticated || route.request().headers()['x-csrf-token'] !== ADMIN_CSRF) {
        await fulfillJson(route, problem(401, 'trace-spatial-operator-unauthorized'), 401);
        return;
      }
      if (new URL(route.request().url()).pathname === '/api/v1/operator/observations/OBS-SPATIAL-E2E/resolve' && route.request().method() === 'POST') {
        resolveRequest = {
          body: requestJson<Record<string, unknown>>(route),
          idempotencyKey: route.request().headers()['idempotency-key'],
        };
        resolved = true;
        await fulfillJson(route, { observation_id: 'OBS-SPATIAL-E2E', action: 'attach', verification_state: 'VERIFIED', fire_id: 'FR-83-00042', episode_id: 'E01', version: 2, trace_id: 'trace-spatial-resolve' });
        return;
      }
      await fulfillJson(route, problem(404, 'trace-spatial-operator-not-found'), 404);
    });

    await page.goto('/admin/rapprochement-spatial');
    await page.getByLabel('Identifiant').fill(ADMIN_USERNAME);
    await page.getByLabel('Mot de passe').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Ouvrir l’administration' }).click();
    await expect(page.getByRole('heading', { name: 'Observations à rattacher' })).toBeVisible();
    await expect(page.getByText('distance cohérente')).toBeVisible();
    await page.getByLabel('Motif de décision audité').fill('Rattachement validé après revue des éléments disponibles.');
    await page.getByRole('button', { name: 'Rattacher au feu' }).click();

    await expect(page.getByText(/Décision enregistrée pour OBS-SPATIAL-E2E/)).toBeVisible();
    expect(resolveRequest).toEqual(expect.objectContaining({
      body: expect.objectContaining({ action: 'attach', expected_version: 1, target_fire_id: 'FR-83-00042' }),
      idempotencyKey: expect.stringMatching(/^admin-ui-/),
    }));
    await expect(page.getByText('Aucun rapprochement dans cette vue')).toBeVisible();
  });
});
