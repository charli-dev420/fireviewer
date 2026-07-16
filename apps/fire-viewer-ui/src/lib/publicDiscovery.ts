import { getViewerManifestApiOrigin } from './manifestClient';
import { VIEWER_MANIFEST_FIRE_ID_RE } from './viewerManifest';

export const PUBLIC_DISCOVERY_SCHEMA_VERSION = '1.0' as const;
export const PUBLIC_DISCOVERY_RESULT_LIMIT = 20;

export interface PublicIncidentIndexItem {
  readonly fire_id: string;
  readonly canonical_name: string;
  readonly status: string;
  readonly verification: 'verified' | 'corroborated';
  readonly last_observed_at: string | null;
}

export interface PublicIncidentIndex {
  readonly schema_version: typeof PUBLIC_DISCOVERY_SCHEMA_VERSION;
  readonly incidents: readonly PublicIncidentIndexItem[];
}

export class PublicDiscoveryError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'PublicDiscoveryError';
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validDateOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new PublicDiscoveryError('La date publique reçue est invalide.');
  return value;
}

function parseItem(value: unknown): PublicIncidentIndexItem {
  const record = asRecord(value);
  if (!record || Object.keys(record).length !== 5) throw new PublicDiscoveryError('Un résultat public ne respecte pas le contrat attendu.');
  const fireId = record.fire_id;
  const canonicalName = record.canonical_name;
  const status = record.status;
  const verification = record.verification;
  if (typeof fireId !== 'string' || !VIEWER_MANIFEST_FIRE_ID_RE.test(fireId)) throw new PublicDiscoveryError('Un identifiant public est invalide.');
  if (typeof canonicalName !== 'string' || canonicalName.trim().length === 0) throw new PublicDiscoveryError('Un nom public est invalide.');
  if (typeof status !== 'string' || status.trim().length === 0) throw new PublicDiscoveryError('Un état public est invalide.');
  if (verification !== 'verified' && verification !== 'corroborated') throw new PublicDiscoveryError('Le niveau de vérification public est invalide.');
  return {
    fire_id: fireId,
    canonical_name: canonicalName,
    status,
    verification,
    last_observed_at: validDateOrNull(record.last_observed_at),
  };
}

export function parsePublicIncidentIndex(value: unknown): PublicIncidentIndex {
  const record = asRecord(value);
  if (!record || Object.keys(record).length !== 2 || record.schema_version !== PUBLIC_DISCOVERY_SCHEMA_VERSION || !Array.isArray(record.incidents)) {
    throw new PublicDiscoveryError('La liste publique reçue ne respecte pas le contrat attendu.');
  }
  if (record.incidents.length > PUBLIC_DISCOVERY_RESULT_LIMIT) throw new PublicDiscoveryError('La liste publique dépasse la limite autorisée.');
  return {
    schema_version: PUBLIC_DISCOVERY_SCHEMA_VERSION,
    incidents: record.incidents.map(parseItem),
  };
}

export function publicDiscoveryOrigin(): string | null {
  return getViewerManifestApiOrigin();
}

function discoveryUrl(path: string, query: URLSearchParams): string {
  const origin = publicDiscoveryOrigin();
  if (!origin) throw new PublicDiscoveryError('La consultation publique n’est pas configurée sur cette instance.');
  return `${origin}${path}?${query.toString()}`;
}

async function loadIndex(url: string, signal?: AbortSignal): Promise<PublicIncidentIndex> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit', signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new PublicDiscoveryError('Le service de découverte publique est inaccessible.');
  }
  if (!response.ok) {
    if (response.status === 404) throw new PublicDiscoveryError('Aucun incident public ne correspond à cette recherche.', 404);
    throw new PublicDiscoveryError('La recherche publique est temporairement indisponible.', response.status);
  }
  try {
    return parsePublicIncidentIndex(await response.json());
  } catch (error) {
    if (error instanceof PublicDiscoveryError) throw error;
    throw new PublicDiscoveryError('La réponse de découverte publique est invalide.');
  }
}

export function loadRecentPublicIncidents(signal?: AbortSignal): Promise<PublicIncidentIndex> {
  return loadIndex(discoveryUrl('/api/v1/incidents/recent', new URLSearchParams()), signal);
}

export function searchPublicIncidents(
  input: { readonly q?: string; readonly longitude?: number; readonly latitude?: number; readonly radiusKm?: number },
  signal?: AbortSignal,
): Promise<PublicIncidentIndex> {
  const query = new URLSearchParams();
  if (input.q && input.q.trim()) query.set('q', input.q.trim());
  if (typeof input.longitude === 'number' && typeof input.latitude === 'number') {
    query.set('longitude', String(input.longitude));
    query.set('latitude', String(input.latitude));
    query.set('radius_km', String(input.radiusKm ?? 10));
  }
  if ([...query.keys()].length === 0) return Promise.resolve({ schema_version: PUBLIC_DISCOVERY_SCHEMA_VERSION, incidents: [] });
  return loadIndex(discoveryUrl('/api/v1/incidents/search', query), signal);
}
