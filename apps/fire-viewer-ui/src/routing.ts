export type AdminRoute =
  | { kind: 'zones' }
  | { kind: 'new-zone' }
  | { kind: 'zone-detail'; zoneId: string }
  | { kind: 'zone-revision'; zoneId: string; revision: string }
  | { kind: 'zone-private-preview'; zoneId: string; revision: string }
  | { kind: 'publications' }
  | { kind: 'not-found' };

export type AppRoute =
  | { kind: 'admin'; adminRoute: AdminRoute }
  | { kind: 'spatial-demo' }
  | { kind: 'public-zones-pending' }
  | { kind: 'public-incident' };

function trimSlashes(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
}

export function resolveAdminRoute(pathname: string): AdminRoute {
  const segments = trimSlashes(pathname);

  if (segments.length === 2 && segments[0] === 'admin' && segments[1] === 'zones') return { kind: 'zones' };
  if (segments.length === 3 && segments[0] === 'admin' && segments[1] === 'zones' && segments[2] === 'nouvelle') {
    return { kind: 'new-zone' };
  }
  if (segments.length === 3 && segments[0] === 'admin' && segments[1] === 'zones') {
    return { kind: 'zone-detail', zoneId: segments[2] };
  }
  if (
    segments.length === 6
    && segments[0] === 'admin'
    && segments[1] === 'zones'
    && segments[3] === 'revisions'
    && segments[5] === 'preview'
  ) {
    return { kind: 'zone-private-preview', zoneId: segments[2], revision: segments[4] };
  }
  if (
    segments.length === 5
    && segments[0] === 'admin'
    && segments[1] === 'zones'
    && segments[3] === 'revisions'
  ) {
    return { kind: 'zone-revision', zoneId: segments[2], revision: segments[4] };
  }
  if (segments.length === 2 && segments[0] === 'admin' && segments[1] === 'publications') return { kind: 'publications' };
  return { kind: 'not-found' };
}

export function resolveAppRoute(pathname = window.location.pathname): AppRoute {
  if (/^\/admin(?:\/|$)/.test(pathname)) return { kind: 'admin', adminRoute: resolveAdminRoute(pathname) };
  if (/^\/demo\/zones\/die-pontaix\/?$/.test(pathname)) return { kind: 'spatial-demo' };
  if (/^\/zones(?:\/|$)/.test(pathname)) return { kind: 'public-zones-pending' };
  return { kind: 'public-incident' };
}
