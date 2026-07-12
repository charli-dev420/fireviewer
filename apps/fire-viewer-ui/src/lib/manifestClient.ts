import {
  parseViewerManifest,
  toViewerManifestSummary,
  VIEWER_MANIFEST_FIRE_ID_RE,
  VIEWER_MANIFEST_SCHEMA_VERSION,
  type ViewerManifest,
  type ViewerManifestSummary,
} from './viewerManifest';

/** Le délai de production est volontairement fixe ; il ne vient pas de Vite. */
export const VIEWER_MANIFEST_REQUEST_TIMEOUT_MS = 8_000;

const CACHE_PREFIX = 'fire-viewer:viewer-manifest';

export type ViewerDataMode = 'mock' | 'api' | 'unconfigured';

/** Sous-ensemble injectable de l'environnement Vite, utile uniquement pour les tests. */
export interface ViewerManifestEnvironment {
  readonly VITE_USE_MOCKS?: unknown;
  readonly VITE_API_BASE_URL?: unknown;
}

export type ViewerManifestClientErrorKind =
  | 'http'
  | 'timeout'
  | 'network'
  | 'parse'
  | 'configuration';

export interface ViewerManifestProblemDetails {
  /** Le statut HTTP est toujours la source d'autorité, jamais le corps distant. */
  readonly status: number;
  readonly title: string;
  readonly traceId?: string;
}

interface ViewerManifestClientErrorOptions {
  readonly status?: number;
  readonly title?: string;
  readonly traceId?: string;
}

/**
 * Erreur sûre pour l'UI. Le champ distant `detail` n'est jamais conservé ni
 * rendu : seule une information de diagnostic bornée est exposée.
 */
export class ViewerManifestClientError extends Error {
  readonly kind: ViewerManifestClientErrorKind;
  readonly status?: number;
  readonly title?: string;
  readonly traceId?: string;

  constructor(
    kind: ViewerManifestClientErrorKind,
    message: string,
    options: ViewerManifestClientErrorOptions = {},
  ) {
    super(message);
    this.name = 'ViewerManifestClientError';
    this.kind = kind;
    this.status = options.status;
    this.title = options.title;
    this.traceId = options.traceId;
  }
}

export interface ViewerManifestLoadOptions {
  /** Annulation pilotée par React lors d'un démontage ou d'un nouveau chargement. */
  readonly signal?: AbortSignal;
  /** Points d'injection réservés aux tests unitaires. */
  readonly environment?: ViewerManifestEnvironment;
  readonly fetchImpl?: typeof fetch;
  readonly storage?: Storage | null;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

export interface ViewerManifestLoadResult {
  readonly summary: ViewerManifestSummary;
  readonly etag: string;
  /** Instant client de la dernière réponse 200 ou validation 304. */
  readonly checkedAt: string;
  /** Vrai seulement lorsqu'un 304 a confirmé un manifeste déjà validé. */
  readonly revalidated: boolean;
  /** Alias explicite de `revalidated` pour les consommateurs qui affichent le cache. */
  readonly notModified: boolean;
}

interface ViewerManifestCacheEntry {
  readonly manifest: ViewerManifest;
  readonly etag: string;
  readonly checkedAt: string;
}

interface ManifestRequestResult {
  readonly response: Response;
  readonly didSendEtag: boolean;
}

const memoryCache = new Map<string, ViewerManifestCacheEntry>();

function runtimeEnvironment(): ViewerManifestEnvironment {
  return import.meta.env as ViewerManifestEnvironment;
}

function resolveEnvironment(environment?: ViewerManifestEnvironment): ViewerManifestEnvironment {
  return environment ?? runtimeEnvironment();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Vite fournit des chaînes : seules les valeurs exactes `true` et `false` sont admises. */
export function getDataMode(environment?: ViewerManifestEnvironment): ViewerDataMode {
  const resolved = resolveEnvironment(environment);
  if (resolved.VITE_USE_MOCKS === 'true') return 'mock';
  if (resolved.VITE_USE_MOCKS === 'false' && getViewerManifestApiOrigin(resolved)) return 'api';
  return 'unconfigured';
}

/**
 * Valide une origine HTTP(S) pure. Un chemin, une query, un fragment ou des
 * identifiants rendraient le préfixe API ambigu et sont donc refusés.
 */
export function getViewerManifestApiOrigin(
  environment?: ViewerManifestEnvironment,
): string | null {
  const raw = resolveEnvironment(environment).VITE_API_BASE_URL;
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim()) return null;

  try {
    const url = new URL(raw);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.origin === 'null'
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isViewerManifestFireId(value: string): boolean {
  return VIEWER_MANIFEST_FIRE_ID_RE.test(value);
}

export function buildViewerManifestUrl(apiOrigin: string, fireId: string): string {
  return `${apiOrigin}/api/v1/incident/${encodeURIComponent(fireId)}/manifest`;
}

export function viewerManifestCacheKey(apiOrigin: string, fireId: string): string {
  return [
    CACHE_PREFIX,
    VIEWER_MANIFEST_SCHEMA_VERSION,
    encodeURIComponent(apiOrigin),
    encodeURIComponent(fireId),
  ].join(':');
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function resolveStorage(options: ViewerManifestLoadOptions): Storage | null {
  return options.storage === undefined ? safeSessionStorage() : options.storage;
}

function normalizeEtag(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseCachedEntry(
  value: unknown,
  expectedFireId: string,
): ViewerManifestCacheEntry | null {
  const record = asRecord(value);
  if (!record || Object.keys(record).length !== 3) return null;
  if (!Object.hasOwn(record, 'manifest') || !Object.hasOwn(record, 'etag') || !Object.hasOwn(record, 'checkedAt')) {
    return null;
  }

  const etag = normalizeEtag(typeof record.etag === 'string' ? record.etag : null);
  const checkedAt = record.checkedAt;
  if (!etag || !isNonEmptyString(checkedAt) || !Number.isFinite(Date.parse(checkedAt))) {
    return null;
  }

  try {
    const manifest = parseViewerManifest(record.manifest);
    if (
      manifest.fire_id !== expectedFireId ||
      manifest.schema_version !== VIEWER_MANIFEST_SCHEMA_VERSION
    ) {
      return null;
    }
    return { manifest, etag, checkedAt };
  } catch {
    return null;
  }
}

function removeStorageEntry(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Le cache mémoire reste la solution de repli quand le navigateur interdit le stockage.
  }
}

function purgeCache(storage: Storage | null, key: string): void {
  memoryCache.delete(key);
  removeStorageEntry(storage, key);
}

function readCache(
  storage: Storage | null,
  key: string,
  expectedFireId: string,
): ViewerManifestCacheEntry | null {
  const inMemory = memoryCache.get(key);
  if (inMemory) {
    const parsed = parseCachedEntry(inMemory, expectedFireId);
    if (parsed) return parsed;
    memoryCache.delete(key);
  }

  let raw: string | null;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed = parseCachedEntry(JSON.parse(raw), expectedFireId);
    if (!parsed) {
      removeStorageEntry(storage, key);
      return null;
    }
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    removeStorageEntry(storage, key);
    return null;
  }
}

function cloneManifest(manifest: ViewerManifest): ViewerManifest {
  return structuredClone(manifest);
}

function writeCache(
  storage: Storage | null,
  key: string,
  entry: ViewerManifestCacheEntry,
): void {
  const safeEntry: ViewerManifestCacheEntry = {
    manifest: cloneManifest(entry.manifest),
    etag: entry.etag,
    checkedAt: entry.checkedAt,
  };
  memoryCache.set(key, safeEntry);
  try {
    storage?.setItem(key, JSON.stringify(safeEntry));
  } catch {
    // La copie mémoire validée suffit lorsque sessionStorage est indisponible ou saturé.
  }
}

/** Efface uniquement les entrées Fire Viewer, jamais le reste de sessionStorage. */
export function clearViewerManifestCache(storage: Storage | null = safeSessionStorage()): void {
  memoryCache.clear();
  if (!storage) return;

  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${CACHE_PREFIX}:`)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Même comportement de repli : l'absence de sessionStorage n'empêche pas le chargement.
  }
}

function abortError(): DOMException {
  return new DOMException('Le chargement du manifeste a été annulé.', 'AbortError');
}

/** Les annulations externes ne sont pas des erreurs réseau affichables. */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === 'AbortError'
      : asRecord(error)?.name === 'AbortError'
  );
}

function safeHttpTitle(status: number): string {
  switch (status) {
    case 400:
      return 'Requête de manifeste invalide.';
    case 404:
      return 'Incident introuvable.';
    case 410:
      return 'Incident retiré de la consultation publique.';
    case 503:
      return 'Service temporairement indisponible.';
    default:
      return 'Le service de manifeste a retourné une erreur.';
  }
}

async function readProblemDetails(response: Response): Promise<ViewerManifestProblemDetails> {
  let title = safeHttpTitle(response.status);
  let traceId = normalizeEtag(response.headers.get('X-Trace-Id')) ?? undefined;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('application/problem+json')) {
    try {
      const payload = asRecord(await response.json());
      if (payload && isNonEmptyString(payload.title)) title = payload.title;
      if (payload && isNonEmptyString(payload.trace_id)) traceId = payload.trace_id;
      // `detail` est volontairement ignoré, y compris lorsqu'il est présent.
    } catch {
      // Le statut HTTP garde une représentation sûre même si le corps est invalide.
    }
  }

  return { status: response.status, title, ...(traceId ? { traceId } : {}) };
}

function timeoutFor(options: ViewerManifestLoadOptions): number {
  // L'injection ne sert qu'aux tests. Toute valeur non positive ou non finie retombe sur 8 s.
  return typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : VIEWER_MANIFEST_REQUEST_TIMEOUT_MS;
}

async function requestManifest(
  url: string,
  etag: string | null,
  options: ViewerManifestLoadOptions,
): Promise<ManifestRequestResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ViewerManifestClientError(
      'configuration',
      'Le navigateur ne fournit pas de client HTTP pour charger le manifeste.',
    );
  }
  if (options.signal?.aborted) throw abortError();

  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutFor(options));

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (etag) headers['If-None-Match'] = etag;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (options.signal?.aborted) throw abortError();
    return { response, didSendEtag: Boolean(etag) };
  } catch (error) {
    if (options.signal?.aborted && !timedOut) throw abortError();
    if (timedOut) {
      throw new ViewerManifestClientError(
        'timeout',
        'Le chargement du manifeste a dépassé le délai de 8 secondes.',
      );
    }
    if (isAbortError(error)) throw error;
    if (error instanceof ViewerManifestClientError) throw error;
    throw new ViewerManifestClientError(
      'network',
      'Impossible de joindre le service de manifeste.',
    );
  } finally {
    globalThis.clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function resultFromEntry(
  entry: ViewerManifestCacheEntry,
  revalidated: boolean,
): ViewerManifestLoadResult {
  return {
    summary: toViewerManifestSummary(cloneManifest(entry.manifest)),
    etag: entry.etag,
    checkedAt: entry.checkedAt,
    revalidated,
    notModified: revalidated,
  };
}

async function resultFrom200(
  response: Response,
  expectedFireId: string,
  storage: Storage | null,
  cacheKey: string,
  now: () => Date,
): Promise<ViewerManifestLoadResult> {
  const etag = normalizeEtag(response.headers.get('ETag'));
  if (!etag) {
    purgeCache(storage, cacheKey);
    throw new ViewerManifestClientError(
      'parse',
      'La réponse du manifeste ne contient pas d’ETag exploitable.',
    );
  }

  let manifest: ViewerManifest;
  try {
    manifest = parseViewerManifest(await response.json());
  } catch {
    purgeCache(storage, cacheKey);
    throw new ViewerManifestClientError(
      'parse',
      'La réponse du manifeste ne respecte pas le contrat public attendu.',
    );
  }

  if (manifest.fire_id !== expectedFireId) {
    purgeCache(storage, cacheKey);
    throw new ViewerManifestClientError(
      'parse',
      'La réponse du manifeste ne correspond pas à l’incident demandé.',
    );
  }

  const entry: ViewerManifestCacheEntry = {
    manifest,
    etag,
    checkedAt: now().toISOString(),
  };
  writeCache(storage, cacheKey, entry);
  return resultFromEntry(entry, false);
}

async function resultFromResponse(
  request: ManifestRequestResult,
  expectedFireId: string,
  storage: Storage | null,
  cacheKey: string,
  cached: ViewerManifestCacheEntry | null,
  now: () => Date,
): Promise<ViewerManifestLoadResult | 'retry-without-etag'> {
  const { response } = request;
  if (response.status === 304) {
    const responseEtag = normalizeEtag(response.headers.get('ETag'));
    if (cached && request.didSendEtag && responseEtag === cached.etag) {
      const refreshed: ViewerManifestCacheEntry = {
        ...cached,
        checkedAt: now().toISOString(),
      };
      writeCache(storage, cacheKey, refreshed);
      return resultFromEntry(refreshed, true);
    }
    purgeCache(storage, cacheKey);
    return 'retry-without-etag';
  }

  if (!response.ok) {
    const problem = await readProblemDetails(response);
    throw new ViewerManifestClientError('http', problem.title, problem);
  }

  return resultFrom200(response, expectedFireId, storage, cacheKey, now);
}

/**
 * Charge exclusivement le contrat public v2. Le mode mock est volontairement
 * refusé ici : l'orchestrateur UI choisit explicitement `loadMockIncident`.
 */
export async function loadViewerManifest(
  fireId: string,
  options: ViewerManifestLoadOptions = {},
): Promise<ViewerManifestLoadResult> {
  if (!isViewerManifestFireId(fireId)) {
    throw new ViewerManifestClientError(
      'configuration',
      'Identifiant incident invalide. Utilisez le format FR-83-00042.',
      { status: 400 },
    );
  }

  const environment = resolveEnvironment(options.environment);
  if (getDataMode(environment) !== 'api') {
    throw new ViewerManifestClientError(
      'configuration',
      'Le mode de données API n’est pas configuré.',
    );
  }
  const apiOrigin = getViewerManifestApiOrigin(environment);
  if (!apiOrigin) {
    throw new ViewerManifestClientError(
      'configuration',
      'VITE_API_BASE_URL doit être une origine HTTP(S) sans préfixe API.',
    );
  }

  const storage = resolveStorage(options);
  const cacheKey = viewerManifestCacheKey(apiOrigin, fireId);
  const cached = readCache(storage, cacheKey, fireId);
  const url = buildViewerManifestUrl(apiOrigin, fireId);
  const now = options.now ?? (() => new Date());
  const first = await requestManifest(url, cached?.etag ?? null, options);
  const firstResult = await resultFromResponse(
    first,
    fireId,
    storage,
    cacheKey,
    cached,
    now,
  );
  if (firstResult !== 'retry-without-etag') return firstResult;

  // Un seul retry inconditionnel empêche de boucler sur un proxy 304 mal configuré.
  const retry = await requestManifest(url, null, options);
  const retryResult = await resultFromResponse(retry, fireId, storage, cacheKey, null, now);
  if (retryResult !== 'retry-without-etag') return retryResult;

  throw new ViewerManifestClientError(
    'parse',
    'Le service a confirmé un manifeste non disponible dans le cache local.',
  );
}
