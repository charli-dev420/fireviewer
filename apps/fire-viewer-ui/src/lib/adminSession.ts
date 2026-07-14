const ADMIN_SESSION_STORAGE_KEY = 'fire-viewer:admin-session:v1';
const ADMIN_ROLE = 'administrator';

export interface AdminSession {
  readonly token: string;
  readonly subject: string;
  readonly roles: string[];
  readonly expiresAt: string | null;
}

export type AdminSessionValidation =
  | { ok: true; session: AdminSession }
  | { ok: false; reason: string };

interface JwtPayload {
  readonly sub?: unknown;
  readonly name?: unknown;
  readonly preferred_username?: unknown;
  readonly email?: unknown;
  readonly role?: unknown;
  readonly roles?: unknown;
  readonly scope?: unknown;
  readonly exp?: unknown;
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return atob(padded);
}

function parseJwtPayload(token: string): JwtPayload | null {
  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(payload));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as JwtPayload;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function extractRoles(payload: JwtPayload): string[] {
  const roles = [
    ...stringArray(payload.roles),
    ...stringArray(payload.role),
    ...(typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : []),
  ];
  return Array.from(new Set(roles));
}

function extractSubject(payload: JwtPayload): string {
  for (const candidate of [payload.name, payload.preferred_username, payload.email, payload.sub]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return 'Administrateur authentifié';
}

function expiresAt(payload: JwtPayload): string | null {
  return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
    ? new Date(payload.exp * 1000).toISOString()
    : null;
}

export function validateAdminToken(token: string, now = new Date()): AdminSessionValidation {
  const normalizedToken = token.trim();
  if (!normalizedToken) return { ok: false, reason: 'Jeton bearer requis.' };

  const payload = parseJwtPayload(normalizedToken);
  if (!payload) return { ok: false, reason: 'Jeton JWT illisible.' };

  if (typeof payload.exp === 'number' && Number.isFinite(payload.exp) && payload.exp * 1000 <= now.getTime()) {
    return { ok: false, reason: 'Session expirée. Fournissez un nouveau jeton administrateur.' };
  }

  const roles = extractRoles(payload);
  if (!roles.includes(ADMIN_ROLE)) {
    return { ok: false, reason: 'Le jeton ne contient pas le rôle administrator.' };
  }

  return {
    ok: true,
    session: {
      token: normalizedToken,
      subject: extractSubject(payload),
      roles,
      expiresAt: expiresAt(payload),
    },
  };
}

export function loadAdminSession(storage = safeSessionStorage()): AdminSession | null {
  const serialized = storage?.getItem(ADMIN_SESSION_STORAGE_KEY);
  if (!serialized) return null;

  try {
    const candidate: unknown = JSON.parse(serialized);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const token = (candidate as { token?: unknown }).token;
    if (typeof token !== 'string') return null;
    const validation = validateAdminToken(token);
    return validation.ok ? validation.session : null;
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession, storage = safeSessionStorage()): void {
  storage?.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify({ token: session.token }));
}

export function clearAdminSession(storage = safeSessionStorage()): void {
  storage?.removeItem(ADMIN_SESSION_STORAGE_KEY);
}

export function buildAdminAuthorizationHeader(session: AdminSession): string {
  return `Bearer ${session.token}`;
}
