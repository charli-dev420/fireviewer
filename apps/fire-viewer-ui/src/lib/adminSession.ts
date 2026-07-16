export interface AdminSession { readonly csrfToken?: string; readonly token?: string; }
export type AdminSessionValidation = { ok: true; session: AdminSession } | { ok: false; reason: string };
export interface AdminSessionEnvironment { readonly VITE_API_BASE_URL?: unknown; }
export interface AdminSessionValidationOptions { readonly environment?: AdminSessionEnvironment; readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal; }

function environment(environment?: AdminSessionEnvironment): AdminSessionEnvironment { return environment ?? import.meta.env as AdminSessionEnvironment; }
function isLoopback(host: string): boolean { return host === 'localhost' || host === '127.0.0.1' || host === '::1'; }
export function getAdminApiOrigin(value?: AdminSessionEnvironment): string | null {
  const raw = environment(value).VITE_API_BASE_URL;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try { const url = new URL(raw); return (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname))) && !url.username && !url.password && url.pathname === '/' ? url.origin : null; } catch { return null; }
}
export function buildAdminSessionUrl(apiOrigin: string): string { return `${apiOrigin}/api/v1/admin/session`; }
export function normalizeAdminBearer(value: string): string | null { const token = value.replace(/^Bearer(?:\s+|$)/i, '').trim(); return token && !/\s/.test(token) ? token : null; }
/** Deprecated compatibility exports. Local-admin sessions are cookies, never browser storage. */
export function loadAdminSession(_storage?: Storage | null): AdminSession | null { return null; }
export function saveAdminSession(_session: AdminSession, _storage?: Storage | null): void { /* no browser persistence */ }
export function clearAdminSession(_storage?: Storage | null): void { /* no browser persistence */ }
export function buildAdminAuthorizationHeader(session: AdminSession): string { return session.token ? `Bearer ${session.token}` : ''; }
export async function validateAdminSession(options: AdminSessionValidationOptions = {}): Promise<AdminSessionValidation> {
  const apiOrigin = getAdminApiOrigin(options.environment);
  if (!apiOrigin) return { ok: false, reason: 'Connexion administrateur requise.' };
  try {
    const response = await (options.fetchImpl ?? fetch)(buildAdminSessionUrl(apiOrigin), { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'include', cache: 'no-store', signal: options.signal });
    if (response.status !== 200) return { ok: false, reason: 'La session administrateur a expiré.' };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'La réponse de session n’est pas conforme.' };
    const record = payload as { authenticated?: unknown; csrf_token?: unknown };
    const keys = Object.keys(record);
    if (
      record.authenticated !== true
      || keys.some((key) => key !== 'authenticated' && key !== 'csrf_token')
      || (record.csrf_token !== undefined && record.csrf_token !== null && typeof record.csrf_token !== 'string')
    ) return { ok: false, reason: 'La réponse de session n’est pas conforme.' };
    const csrfToken = typeof record.csrf_token === 'string' && record.csrf_token ? record.csrf_token : undefined;
    return { ok: true, session: csrfToken ? { csrfToken } : {} };
  } catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; return { ok: false, reason: 'Le service d’administration est inaccessible.' }; }
}
export async function loginAdmin(username: string, password: string, options: AdminSessionValidationOptions = {}): Promise<AdminSessionValidation> {
  const apiOrigin = getAdminApiOrigin(options.environment);
  if (!apiOrigin) return { ok: false, reason: 'Administration non configurée.' };
  try {
    const response = await (options.fetchImpl ?? fetch)(`${apiOrigin}/api/v1/admin/auth/login`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, password }), signal: options.signal });
    if (!response.ok) return { ok: false, reason: 'Identifiants administrateur refusés.' };
    return validateAdminSession(options);
  } catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; return { ok: false, reason: 'Le service d’administration est inaccessible.' }; }
}
export async function logoutAdmin(session: AdminSession, options: AdminSessionValidationOptions = {}): Promise<void> {
  const apiOrigin = getAdminApiOrigin(options.environment);
  if (!apiOrigin) return;
  await fetch(`${apiOrigin}/api/v1/admin/auth/logout`, { method: 'POST', credentials: 'include', headers: session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {} });
}
