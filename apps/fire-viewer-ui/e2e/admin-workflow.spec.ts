import { expect, test } from '@playwright/test';

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function adminJwt(): string {
  return `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({
    sub: 'admin-e2e',
    roles: ['administrator'],
    exp: 4_102_444_800,
  })}.`;
}

test.describe('Parcours administrateur MVP-4 zones', () => {
  test('définit le chemin zone complète → révision → paquet vérifié → preview privée → publication', async ({ page }) => {
    const publicRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/\/api\/v1\/incident\//.test(url) || /\/maps\/fireviewer-die-pontaix-r1-v4\//.test(url)) {
        publicRequests.push(url);
      }
    });

    await test.step('connexion administrateur', async () => {
      await page.goto('/admin/zones');
      await expect(page.getByRole('heading', { name: 'Connexion administrateur requise' })).toBeVisible();
      await page.getByLabel('Bearer JWT administrateur').fill(adminJwt());
      await page.getByRole('button', { name: 'Ouvrir l’administration' }).click();
      await expect(page.getByText('Session administrateur active')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Administration des zones' })).toBeVisible();
    });

    await test.step('création de zone rurale', async () => {
      await page.getByRole('link', { name: 'Nouvelle zone' }).click();
      await expect(page.getByRole('heading', { name: 'Nouvelle zone' })).toBeVisible();
      await expect(page.getByText('définir identité, emprise, description et statut')).toBeVisible();
    });

    await test.step('consultation de la zone et de sa révision', async () => {
      await page.goto('/admin/zones/seconde-zone-rurale');
      await expect(page.getByRole('heading', { name: 'Zone seconde-zone-rurale' })).toBeVisible();
      await page.goto('/admin/zones/seconde-zone-rurale/revisions/r1');
      await expect(page.getByRole('heading', { name: 'Zone seconde-zone-rurale — révision r1' })).toBeVisible();
      await expect(page.getByText('vérifier hashes, chemins, provenance')).toBeVisible();
    });

    await test.step('prévisualisation privée isolée du public', async () => {
      await page.goto('/admin/zones/seconde-zone-rurale/revisions/r1/preview');
      await expect(page.getByRole('heading', { name: 'Prévisualisation privée — seconde-zone-rurale révision r1' })).toBeVisible();
      await expect(page.getByText('aucune URL GLB')).toBeVisible();
      await expect(page.getByText('aucune requête publique')).toBeVisible();
    });

    await test.step('publication administrée explicite', async () => {
      await page.getByRole('link', { name: 'Publications' }).click();
      await expect(page.getByRole('heading', { name: 'Publications' })).toBeVisible();
      await expect(page.getByText('publier, retirer ou republier explicitement')).toBeVisible();
    });

    expect(publicRequests).toEqual([]);
  });
});
