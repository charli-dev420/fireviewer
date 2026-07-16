import { describe, expect, it } from 'vitest';
import { resolveAdminRoute, resolveAppRoute } from './routing';

describe('resolveAppRoute', () => {
  it('résout toutes les pages publiques validées sans retomber sur l’ancienne interface', () => {
    expect(resolveAppRoute('/')).toEqual({ kind: 'home' });
    expect(resolveAppRoute('/incendies')).toEqual({ kind: 'public-page', section: 'incidents' });
    expect(resolveAppRoute('/incendie/FR-83-00042')).toEqual({ kind: 'public-incident', fireId: 'FR-83-00042' });
    expect(resolveAppRoute('/incendie/FR-83-00042/ajouter-preuve')).toEqual({ kind: 'public-add-evidence', fireId: 'FR-83-00042' });
    expect(resolveAppRoute('/incendie/FR-83-00042/signaler-erreur')).toEqual({ kind: 'public-incident-report', fireId: 'FR-83-00042' });
    expect(resolveAppRoute('/contribution/local-123')).toEqual({ kind: 'public-contribution', contributionId: 'local-123' });
    expect(resolveAppRoute('/signaler')).toEqual({ kind: 'public-page', section: 'report' });
    expect(resolveAppRoute('/compte')).toEqual({ kind: 'public-page', section: 'account' });
    expect(resolveAppRoute('/reglages')).toEqual({ kind: 'public-page', section: 'settings' });
    expect(resolveAppRoute('/fonctionnement')).toEqual({ kind: 'public-page', section: 'operation' });
    expect(resolveAppRoute('/confidentialite')).toEqual({ kind: 'public-page', section: 'privacy' });
    expect(resolveAppRoute('/accessibilite')).toEqual({ kind: 'public-page', section: 'accessibility' });
    expect(resolveAppRoute('/mentions-legales')).toEqual({ kind: 'public-page', section: 'legal' });
    expect(resolveAppRoute('/a-propos')).toEqual({ kind: 'public-page', section: 'about' });
  });

  it('retire toutes les surfaces publiques par zone technique', () => {
    expect(resolveAppRoute('/zones')).toEqual({ kind: 'public-zone-retired' });
    expect(resolveAppRoute('/zones/die-pontaix')).toEqual({ kind: 'public-zone-retired' });
    expect(resolveAppRoute('/zones/DIE-PONTAIX-08/')).toEqual({ kind: 'public-zone-retired' });
  });

  it('renvoie une route administrateur inconnue plutôt que de planter sur un encodage invalide', () => {
    expect(resolveAppRoute('/admin/zones/%E0%A4%A')).toEqual({
      kind: 'admin',
      adminRoute: { kind: 'not-found' },
    });
  });

  it('aligne les identifiants et révisions administratifs avec le contrat API', () => {
    expect(resolveAdminRoute('/admin')).toEqual({ kind: 'dashboard' });
    expect(resolveAdminRoute('/admin/carte-operationnelle')).toEqual({ kind: 'operational-map' });
    expect(resolveAdminRoute('/admin/file-de-traitement')).toEqual({ kind: 'work-queue' });
    expect(resolveAdminRoute('/admin/rapprochement-spatial')).toEqual({ kind: 'spatial-matching' });
    expect(resolveAdminRoute('/admin/incidents/FR-83-00042/observations')).toEqual({ kind: 'incident-observations', fireId: 'FR-83-00042' });
    expect(resolveAdminRoute('/admin/incidents/FR-83-00042/sources-medias')).toEqual({ kind: 'incident-sources-media', fireId: 'FR-83-00042' });
    expect(resolveAdminRoute('/admin/incidents/FR-83-00042/modeles-pipeline')).toEqual({ kind: 'incident-models-pipeline', fireId: 'FR-83-00042' });
    expect(resolveAdminRoute('/admin/zones/DIE-PONTAIX-08')).toEqual({
      kind: 'zone-detail',
      zoneId: 'DIE-PONTAIX-08',
    });
    expect(resolveAdminRoute('/admin/zones/DIE-PONTAIX-08/revisions/1')).toEqual({
      kind: 'zone-revision',
      zoneId: 'DIE-PONTAIX-08',
      revision: '1',
    });
    expect(resolveAdminRoute('/admin/zones/DIE-PONTAIX-08/revisions/nouvelle')).toEqual({
      kind: 'new-zone-revision',
      zoneId: 'DIE-PONTAIX-08',
    });
    expect(resolveAdminRoute('/admin/zones/die-pontaix/revisions/r1')).toEqual({ kind: 'not-found' });
  });

  it('retire l’ancien envoi d’archive et résout les parcours d’information', () => {
    expect(resolveAdminRoute('/admin/zones/DIE-PONTAIX-08/uploads')).toEqual({ kind: 'not-found' });
    expect(resolveAdminRoute('/admin/zones/DIE-PONTAIX-08/information/nouvelle')).toEqual({
      kind: 'new-zone-information',
      zoneId: 'DIE-PONTAIX-08',
    });
    expect(resolveAdminRoute('/admin/zones/DIE-PONTAIX-08/information/info-001')).toEqual({
      kind: 'zone-information',
      zoneId: 'DIE-PONTAIX-08',
      informationId: 'info-001',
    });
    expect(resolveAdminRoute('/admin/zones/die-pontaix-08/uploads')).toEqual({ kind: 'not-found' });
    expect(resolveAdminRoute('/admin/contributions')).toEqual({ kind: 'not-found' });
  });
});
