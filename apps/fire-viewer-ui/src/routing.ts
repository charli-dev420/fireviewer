export type AdminRoute =
  | { kind: 'dashboard' }
  | { kind: 'operational-map' }
  | { kind: 'zones' }
  | { kind: 'new-zone' }
  | { kind: 'zone-detail'; zoneId: string }
  | { kind: 'new-zone-revision'; zoneId: string }
  | { kind: 'new-zone-information'; zoneId: string }
  | { kind: 'zone-information'; zoneId: string; informationId: string }
  | { kind: 'zone-revision'; zoneId: string; revision: string }
  | { kind: 'zone-private-preview'; zoneId: string; revision: string }
  | { kind: 'reports' }
  | { kind: 'work-queue' }
  | { kind: 'spatial-matching' }
  | { kind: 'incidents' }
  | { kind: 'new-incident' }
  | { kind: 'incident-detail'; fireId: string }
  | { kind: 'incident-observations'; fireId: string }
  | { kind: 'incident-sources-media'; fireId: string }
  | { kind: 'incident-models-pipeline'; fireId: string }
  | { kind: 'incident-spatial-review'; fireId: string }
  | { kind: 'incident-spatial-package'; fireId: string }
  | { kind: 'audit' }
  | { kind: 'roles' }
  | { kind: 'system' }
  | { kind: 'configuration' }
  | { kind: 'publications' }
  | { kind: 'not-found' };

export type AppRoute =
  | { kind: 'admin'; adminRoute: AdminRoute }
  | { kind: 'public-zone-retired' }
  | { kind: 'home' }
  | { kind: 'public-page'; section: 'incidents' | 'report' | 'account' | 'settings' | 'operation' | 'privacy' | 'accessibility' | 'legal' | 'about' }
  | { kind: 'public-add-evidence'; fireId: string }
  | { kind: 'public-incident-report'; fireId: string }
  | { kind: 'public-contribution'; contributionId: string }
  | { kind: 'public-incident'; fireId: string }
  | { kind: 'public-incident-address-required' };

/** Les identifiants de zone restent des références techniques administratives. */
const ADMIN_ZONE_ID_PATTERN = /^[A-Z][A-Z0-9-]{2,63}$/;
const ADMIN_REVISION_PATTERN = /^[1-9][0-9]*$/;
const ADMIN_INFORMATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

function trimSlashes(pathname: string): string[] {
  try {
    return pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    return [];
  }
}

export function resolveAdminRoute(pathname: string): AdminRoute {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/admin') return { kind: 'dashboard' };
  if (normalizedPath === '/admin/carte-operationnelle') return { kind: 'operational-map' };
  if (normalizedPath === '/admin/signalements') return { kind: 'reports' };
  if (normalizedPath === '/admin/validation' || normalizedPath === '/admin/file-de-traitement') return { kind: 'work-queue' };
  if (normalizedPath === '/admin/rapprochement-spatial') return { kind: 'spatial-matching' };
  if (normalizedPath === '/admin/audit') return { kind: 'audit' };
  if (normalizedPath === '/admin/roles') return { kind: 'roles' };
  if (normalizedPath === '/admin/systeme') return { kind: 'system' };
  if (normalizedPath === '/admin/configuration') return { kind: 'configuration' };
  if (normalizedPath === '/admin/publications') return { kind: 'publications' };
  if (normalizedPath === '/admin/incidents') return { kind: 'incidents' };
  if (normalizedPath === '/admin/incidents/nouveau') return { kind: 'new-incident' };
  const segments = trimSlashes(normalizedPath);
  if (segments.length === 4 && segments[0] === 'admin' && segments[1] === 'incidents' && /^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(segments[2])) {
    if (segments[3] === 'observations') return { kind: 'incident-observations', fireId: segments[2] };
    if (segments[3] === 'sources-medias') return { kind: 'incident-sources-media', fireId: segments[2] };
    if (segments[3] === 'modeles-pipeline') return { kind: 'incident-models-pipeline', fireId: segments[2] };
    if (segments[3] === 'revue-spatiale') return { kind: 'incident-spatial-review', fireId: segments[2] };
  }
  if (segments.length === 5 && segments[0] === 'admin' && segments[1] === 'incidents' && /^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(segments[2]) && segments[3] === 'carte' && segments[4] === 'importer') {
    return { kind: 'incident-spatial-package', fireId: segments[2] };
  }
  if (segments.length === 3 && segments[0] === 'admin' && segments[1] === 'incidents' && /^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(segments[2])) return { kind: 'incident-detail', fireId: segments[2] };

  if (segments.length === 2 && segments[0] === 'admin' && segments[1] === 'zones') return { kind: 'zones' };
  if (segments.length === 3 && segments[0] === 'admin' && segments[1] === 'zones' && segments[2] === 'nouvelle') {
    return { kind: 'new-zone' };
  }
  if (
    segments.length === 5
    && segments[0] === 'admin'
    && segments[1] === 'zones'
    && segments[3] === 'revisions'
    && segments[4] === 'nouvelle'
    && ADMIN_ZONE_ID_PATTERN.test(segments[2])
  ) {
    return { kind: 'new-zone-revision', zoneId: segments[2] };
  }
  if (
    segments.length === 5
    && segments[0] === 'admin'
    && segments[1] === 'zones'
    && segments[3] === 'information'
    && segments[4] === 'nouvelle'
    && ADMIN_ZONE_ID_PATTERN.test(segments[2])
  ) {
    return { kind: 'new-zone-information', zoneId: segments[2] };
  }
  if (
    segments.length === 5
    && segments[0] === 'admin'
    && segments[1] === 'zones'
    && segments[3] === 'information'
    && ADMIN_ZONE_ID_PATTERN.test(segments[2])
    && ADMIN_INFORMATION_ID_PATTERN.test(segments[4])
  ) {
    return { kind: 'zone-information', zoneId: segments[2], informationId: segments[4] };
  }
  if (
    segments.length === 3
    && segments[0] === 'admin'
    && segments[1] === 'zones'
    && ADMIN_ZONE_ID_PATTERN.test(segments[2])
  ) {
    return { kind: 'zone-detail', zoneId: segments[2] };
  }
  if (
    segments.length === 6
    && segments[0] === 'admin'
    && segments[1] === 'zones'
    && segments[3] === 'revisions'
    && segments[5] === 'preview'
    && ADMIN_ZONE_ID_PATTERN.test(segments[2])
    && ADMIN_REVISION_PATTERN.test(segments[4])
  ) {
    return { kind: 'zone-private-preview', zoneId: segments[2], revision: segments[4] };
  }
  if (
    segments.length === 5
    && segments[0] === 'admin'
    && segments[1] === 'zones'
    && segments[3] === 'revisions'
    && ADMIN_ZONE_ID_PATTERN.test(segments[2])
    && ADMIN_REVISION_PATTERN.test(segments[4])
  ) {
    return { kind: 'zone-revision', zoneId: segments[2], revision: segments[4] };
  }
  return { kind: 'not-found' };
}

export function resolveAppRoute(pathname = window.location.pathname): AppRoute {
  if (/^\/admin(?:\/|$)/.test(pathname)) return { kind: 'admin', adminRoute: resolveAdminRoute(pathname) };
  if (/^\/zones(?:\/|$)/.test(pathname)) return { kind: 'public-zone-retired' };
  if (pathname === '/' || pathname === '') return { kind: 'home' };
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/incendies' || normalizedPath === '/incidents') return { kind: 'public-page', section: 'incidents' };
  if (normalizedPath === '/signaler') return { kind: 'public-page', section: 'report' };
  if (/^\/compte(?:\/|$)/.test(normalizedPath)) return { kind: 'public-page', section: 'account' };
  if (normalizedPath === '/reglages') return { kind: 'public-page', section: 'settings' };
  if (normalizedPath === '/fonctionnement' || normalizedPath === '/documentation' || normalizedPath === '/limites') return { kind: 'public-page', section: 'operation' };
  if (normalizedPath === '/confidentialite') return { kind: 'public-page', section: 'privacy' };
  if (normalizedPath === '/accessibilite') return { kind: 'public-page', section: 'accessibility' };
  if (normalizedPath === '/mentions-legales') return { kind: 'public-page', section: 'legal' };
  if (normalizedPath === '/a-propos' || normalizedPath === '/statut') return { kind: 'public-page', section: 'about' };
  const incidentSegments = trimSlashes(pathname);
  if (incidentSegments.length === 3 && (incidentSegments[0] === 'incendie' || incidentSegments[0] === 'incident') && incidentSegments[2] === 'ajouter-preuve') {
    return { kind: 'public-add-evidence', fireId: incidentSegments[1].toUpperCase() };
  }
  if (incidentSegments.length === 3 && (incidentSegments[0] === 'incendie' || incidentSegments[0] === 'incident') && incidentSegments[2] === 'signaler-erreur') {
    return { kind: 'public-incident-report', fireId: incidentSegments[1].toUpperCase() };
  }
  if (incidentSegments.length === 2 && incidentSegments[0] === 'contribution') {
    return { kind: 'public-contribution', contributionId: incidentSegments[1] };
  }
  if (incidentSegments.length === 2 && (incidentSegments[0] === 'incendie' || incidentSegments[0] === 'incident')) return { kind: 'public-incident', fireId: incidentSegments[1].toUpperCase() };
  if (incidentSegments.length === 1 && (incidentSegments[0] === 'incendie' || incidentSegments[0] === 'incident')) return { kind: 'public-incident-address-required' };
  return { kind: 'home' };
}
