import { getViewerManifestApiOrigin } from './manifestClient';
import { VIEWER_MANIFEST_FIRE_ID_RE } from './viewerManifest';

export type PublicIncidentView = {
  readonly schema_version: '1.0';
  readonly fire_id: string;
  readonly canonical_name: string | null;
  readonly public_note: string | null;
  readonly status: string;
  readonly verification: 'verified' | 'corroborated' | 'review_required';
  readonly freshness_at: string;
  readonly last_human_validation_at: string | null;
  readonly location: { readonly coordinates: readonly [number, number]; readonly horizontal_uncertainty_m: number } | null;
  readonly facts: readonly string[];
  readonly limitations: readonly string[];
  readonly episodes: readonly {
    readonly episode_id: string;
    readonly ordinal: number;
    readonly status: string;
    readonly verification_state: string;
    readonly corroborating_source_count: number;
    readonly evidence_basis_at: string | null;
    readonly estimated_area_ha: number | null;
    readonly evacuation_established: boolean;
    readonly model_generation_eligible: boolean;
    readonly review_required: boolean;
    readonly started_at: string;
    readonly last_observed_at: string;
    readonly validated_at: string | null;
    readonly ended_at: string | null;
    readonly is_current: boolean;
    readonly version: number;
  }[];
  readonly observations: readonly {
    readonly observation_id: string;
    readonly episode_id: string;
    readonly type: string;
    readonly observed_at: string;
    readonly received_at: string;
    readonly uncertainty_m: number;
    readonly area_label: string | null;
    readonly verification_state: 'CORROBORATED' | 'VERIFIED';
    readonly spatial_mode: 'GENERALIZED' | 'EXACT' | 'WITHHELD';
  }[];
  readonly evidence_projections: readonly {
    readonly projection_id: string;
    readonly episode_id: string;
    readonly kind: 'validated_marker' | 'generalized_area';
    readonly verification_state: 'CORROBORATED' | 'VERIFIED';
    readonly center: {
      readonly coordinates: readonly [number, number];
      readonly horizontal_uncertainty_m: number;
    };
    readonly radius_m: number;
    readonly label: string;
    readonly observed_at: string | null;
  }[];
  readonly active_fire_zone: {
    readonly zone_revision_id: string;
    readonly revision: number;
    readonly valid_at: string;
    readonly geometry_geojson: Readonly<Record<string, unknown>>;
  } | null;
  readonly map_gallery: readonly {
    readonly capture_id: string;
    readonly zone_revision_id: string;
    readonly local_date: string;
    readonly captured_at: string;
    readonly image_url: string;
    readonly width_px: number;
    readonly height_px: number;
  }[];
  readonly sources: readonly { readonly source_id: string; readonly type: string; readonly name: string | null; readonly trust: string; readonly license: string | null; readonly external_reference: string | null; readonly transformations: readonly string[]; readonly observation_count: number }[];
  readonly timeline: readonly { readonly occurred_at: string; readonly kind: 'incident' | 'episode' | 'observation' | 'model'; readonly label: string; readonly episode_id: string | null }[];
  readonly model: { readonly state: 'available' | 'not_available' | 'withheld'; readonly version: number | null; readonly sha256: string | null; readonly size_bytes: number | null; readonly lod: string | null; readonly terrain_source_year: number | null; readonly generated_at: string | null; readonly public_download_available: boolean; readonly limitations: readonly string[] };
  readonly downloads: readonly { readonly id: 'incident-json' | 'timeline-csv'; readonly label: string; readonly media_type: 'application/json' | 'text/csv'; readonly url: string }[];
};

export type PublicReportCategory = 'information_obsolete' | 'location' | 'source' | 'privacy' | 'accessibility';

export type PublicIncidentReportReceipt = {
  readonly receipt_id: string;
  readonly status: 'received';
  readonly submitted_at: string;
  readonly replayed: boolean;
};

export class PublicIncidentViewError extends Error {
  constructor(readonly status: number | null, message: string) { super(message); }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown, name: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.length === 0) throw new PublicIncidentViewError(null, `Champ ${name} invalide.`);
  return value;
}

function iso(value: unknown, name: string, nullable = false): string | null {
  const result = string(value, name, nullable);
  if (result !== null && !Number.isFinite(Date.parse(result))) throw new PublicIncidentViewError(null, `Champ ${name} invalide.`);
  return result;
}

function list(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new PublicIncidentViewError(null, `Champ ${name} invalide.`);
  return value;
}

function point(
  value: unknown,
  name: string,
): { readonly coordinates: readonly [number, number]; readonly horizontal_uncertainty_m: number } {
  const item = record(value);
  if (
    !item
    || !Array.isArray(item.coordinates)
    || item.coordinates.length !== 2
    || !item.coordinates.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    || typeof item.horizontal_uncertainty_m !== 'number'
    || !Number.isFinite(item.horizontal_uncertainty_m)
    || item.horizontal_uncertainty_m <= 0
  ) throw new PublicIncidentViewError(null, `Champ ${name} invalide.`);
  return {
    coordinates: [item.coordinates[0] as number, item.coordinates[1] as number],
    horizontal_uncertainty_m: item.horizontal_uncertainty_m,
  };
}

function activeFireZone(value: unknown): PublicIncidentView['active_fire_zone'] {
  if (value === null) return null;
  const item = record(value);
  const geometry = item ? record(item.geometry_geojson) : null;
  if (
    !item
    || typeof item.zone_revision_id !== 'string'
    || typeof item.revision !== 'number'
    || !Number.isInteger(item.revision)
    || item.revision < 1
    || !geometry
    || geometry.type !== 'MultiPolygon'
    || !Array.isArray(geometry.coordinates)
  ) throw new PublicIncidentViewError(null, 'Calque incendie public invalide.');
  return {
    zone_revision_id: item.zone_revision_id,
    revision: item.revision,
    valid_at: iso(item.valid_at, 'active_fire_zone.valid_at')!,
    geometry_geojson: geometry,
  };
}

function parseView(value: unknown): PublicIncidentView {
  const root = record(value);
  if (!root || root.schema_version !== '1.0' || typeof root.fire_id !== 'string' || !VIEWER_MANIFEST_FIRE_ID_RE.test(root.fire_id)) throw new PublicIncidentViewError(null, 'La fiche publique ne respecte pas le contrat attendu.');
  const location = root.location === null ? null : point(root.location, 'location');
  const episodes = list(root.episodes, 'episodes').map((item) => {
    const itemRecord = record(item);
    if (!itemRecord || typeof itemRecord.episode_id !== 'string' || typeof itemRecord.ordinal !== 'number' || typeof itemRecord.status !== 'string' || typeof itemRecord.review_required !== 'boolean' || typeof itemRecord.is_current !== 'boolean' || typeof itemRecord.version !== 'number') throw new PublicIncidentViewError(null, 'Épisode public invalide.');
    if (typeof itemRecord.corroborating_source_count !== 'number' || typeof itemRecord.evacuation_established !== 'boolean' || typeof itemRecord.model_generation_eligible !== 'boolean') throw new PublicIncidentViewError(null, 'Épisode public invalide.');
    return { episode_id: itemRecord.episode_id, ordinal: itemRecord.ordinal, status: itemRecord.status, verification_state: string(itemRecord.verification_state, 'verification_state')!, corroborating_source_count: itemRecord.corroborating_source_count, evidence_basis_at: iso(itemRecord.evidence_basis_at, 'evidence_basis_at', true), estimated_area_ha: itemRecord.estimated_area_ha === null ? null : typeof itemRecord.estimated_area_ha === 'number' ? itemRecord.estimated_area_ha : (() => { throw new PublicIncidentViewError(null, 'Surface publique invalide.'); })(), evacuation_established: itemRecord.evacuation_established, model_generation_eligible: itemRecord.model_generation_eligible, review_required: itemRecord.review_required, started_at: iso(itemRecord.started_at, 'started_at')!, last_observed_at: iso(itemRecord.last_observed_at, 'last_observed_at')!, validated_at: iso(itemRecord.validated_at, 'validated_at', true), ended_at: iso(itemRecord.ended_at, 'ended_at', true), is_current: itemRecord.is_current, version: itemRecord.version };
  });
  const observations = list(root.observations, 'observations').map((item) => {
    const itemRecord = record(item);
    if (!itemRecord || typeof itemRecord.observation_id !== 'string' || typeof itemRecord.episode_id !== 'string' || typeof itemRecord.type !== 'string' || typeof itemRecord.uncertainty_m !== 'number' || (itemRecord.verification_state !== 'VERIFIED' && itemRecord.verification_state !== 'CORROBORATED') || !['GENERALIZED', 'EXACT', 'WITHHELD'].includes(String(itemRecord.spatial_mode))) throw new PublicIncidentViewError(null, 'Observation publique invalide.');
    return { observation_id: itemRecord.observation_id, episode_id: itemRecord.episode_id, type: itemRecord.type, observed_at: iso(itemRecord.observed_at, 'observed_at')!, received_at: iso(itemRecord.received_at, 'received_at')!, uncertainty_m: itemRecord.uncertainty_m, area_label: string(itemRecord.area_label, 'area_label', true), verification_state: itemRecord.verification_state as 'CORROBORATED' | 'VERIFIED', spatial_mode: itemRecord.spatial_mode as 'GENERALIZED' | 'EXACT' | 'WITHHELD' };
  });
  const evidenceProjections: PublicIncidentView['evidence_projections'][number][] = list(root.evidence_projections, 'evidence_projections').map((item) => {
    const itemRecord = record(item);
    if (!itemRecord || typeof itemRecord.projection_id !== 'string' || typeof itemRecord.episode_id !== 'string' || (itemRecord.kind !== 'validated_marker' && itemRecord.kind !== 'generalized_area') || (itemRecord.verification_state !== 'VERIFIED' && itemRecord.verification_state !== 'CORROBORATED') || typeof itemRecord.radius_m !== 'number' || !Number.isFinite(itemRecord.radius_m) || itemRecord.radius_m <= 0) throw new PublicIncidentViewError(null, 'Projection de preuve invalide.');
    return { projection_id: itemRecord.projection_id, episode_id: itemRecord.episode_id, kind: itemRecord.kind, verification_state: itemRecord.verification_state, center: point(itemRecord.center, 'evidence.center'), radius_m: itemRecord.radius_m, label: string(itemRecord.label, 'evidence.label')!, observed_at: iso(itemRecord.observed_at, 'evidence.observed_at', true) };
  });
  const sources = list(root.sources, 'sources').map((item) => {
    const itemRecord = record(item);
    if (!itemRecord || typeof itemRecord.source_id !== 'string' || typeof itemRecord.type !== 'string' || typeof itemRecord.trust !== 'string' || typeof itemRecord.observation_count !== 'number') throw new PublicIncidentViewError(null, 'Source publique invalide.');
    return { source_id: itemRecord.source_id, type: itemRecord.type, name: string(itemRecord.name, 'name', true), trust: itemRecord.trust, license: string(itemRecord.license, 'license', true), external_reference: string(itemRecord.external_reference, 'external_reference', true), transformations: list(itemRecord.transformations, 'transformations').map((entry) => string(entry, 'transformation')!), observation_count: itemRecord.observation_count };
  });
  const mapGallery: PublicIncidentView['map_gallery'][number][] = list(root.map_gallery, 'map_gallery').map((item) => {
    const itemRecord = record(item);
    if (!itemRecord || typeof itemRecord.width_px !== 'number' || itemRecord.width_px < 640 || typeof itemRecord.height_px !== 'number' || itemRecord.height_px < 360) throw new PublicIncidentViewError(null, 'Capture cartographique publique invalide.');
    const localDate = string(itemRecord.local_date, 'map_gallery.local_date')!;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new PublicIncidentViewError(null, 'Date de capture cartographique invalide.');
    return { capture_id: string(itemRecord.capture_id, 'map_gallery.capture_id')!, zone_revision_id: string(itemRecord.zone_revision_id, 'map_gallery.zone_revision_id')!, local_date: localDate, captured_at: iso(itemRecord.captured_at, 'map_gallery.captured_at')!, image_url: string(itemRecord.image_url, 'map_gallery.image_url')!, width_px: itemRecord.width_px, height_px: itemRecord.height_px };
  });
  const timeline = list(root.timeline, 'timeline').map((item) => {
    const itemRecord = record(item);
    if (!itemRecord || !['incident', 'episode', 'observation', 'model'].includes(String(itemRecord.kind))) throw new PublicIncidentViewError(null, 'Événement public invalide.');
    return { occurred_at: iso(itemRecord.occurred_at, 'occurred_at')!, kind: itemRecord.kind as PublicIncidentView['timeline'][number]['kind'], label: string(itemRecord.label, 'label')!, episode_id: string(itemRecord.episode_id, 'episode_id', true) };
  });
  const model = record(root.model);
  if (!model || !['available', 'not_available', 'withheld'].includes(String(model.state)) || typeof model.public_download_available !== 'boolean') throw new PublicIncidentViewError(null, 'Métadonnées de modèle invalides.');
  const downloads: PublicIncidentView['downloads'][number][] = list(root.downloads, 'downloads').map((item) => {
    const itemRecord = record(item);
    if (!itemRecord || (itemRecord.id !== 'incident-json' && itemRecord.id !== 'timeline-csv') || (itemRecord.media_type !== 'application/json' && itemRecord.media_type !== 'text/csv')) throw new PublicIncidentViewError(null, 'Téléchargement public invalide.');
    return { id: itemRecord.id as 'incident-json' | 'timeline-csv', label: string(itemRecord.label, 'label')!, media_type: itemRecord.media_type as 'application/json' | 'text/csv', url: string(itemRecord.url, 'url')! };
  });
  return { schema_version: '1.0', fire_id: root.fire_id, canonical_name: string(root.canonical_name, 'canonical_name', true), public_note: string(root.public_note, 'public_note', true), status: string(root.status, 'status')!, verification: root.verification === 'verified' || root.verification === 'corroborated' || root.verification === 'review_required' ? root.verification : (() => { throw new PublicIncidentViewError(null, 'Vérification invalide.'); })(), freshness_at: iso(root.freshness_at, 'freshness_at')!, last_human_validation_at: iso(root.last_human_validation_at, 'last_human_validation_at', true), location, facts: list(root.facts, 'facts').map((entry) => string(entry, 'fact')!), limitations: list(root.limitations, 'limitations').map((entry) => string(entry, 'limitation')!), episodes, observations, evidence_projections: evidenceProjections, active_fire_zone: activeFireZone(root.active_fire_zone), map_gallery: mapGallery, sources, timeline, model: { state: model.state as PublicIncidentView['model']['state'], version: typeof model.version === 'number' ? model.version : null, sha256: string(model.sha256, 'sha256', true), size_bytes: typeof model.size_bytes === 'number' ? model.size_bytes : null, lod: string(model.lod, 'lod', true), terrain_source_year: typeof model.terrain_source_year === 'number' ? model.terrain_source_year : null, generated_at: iso(model.generated_at, 'generated_at', true), public_download_available: model.public_download_available, limitations: list(model.limitations, 'model.limitations').map((entry) => string(entry, 'model limitation')!) }, downloads };
}

function baseUrl(fireId: string): string {
  const origin = getViewerManifestApiOrigin();
  if (!origin || !VIEWER_MANIFEST_FIRE_ID_RE.test(fireId)) throw new PublicIncidentViewError(null, 'La fiche détaillée publique n’est pas configurée.');
  return `${origin}/api/v1/incident/${encodeURIComponent(fireId)}`;
}

export async function loadPublicIncidentView(fireId: string, signal?: AbortSignal): Promise<PublicIncidentView> {
  let response: Response;
  try { response = await fetch(`${baseUrl(fireId)}/public-view`, { cache: 'no-store', credentials: 'omit', signal }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new PublicIncidentViewError(null, 'La fiche détaillée est inaccessible.'); }
  if (!response.ok) throw new PublicIncidentViewError(response.status, 'La fiche détaillée est indisponible.');
  return parseView(await response.json());
}

export async function submitPublicIncidentReport(fireId: string, input: { readonly category: PublicReportCategory; readonly message: string }): Promise<PublicIncidentReportReceipt> {
  const response = await fetch(`${baseUrl(fireId)}/reports`, { method: 'POST', cache: 'no-store', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw new PublicIncidentViewError(response.status, 'Le signalement n’a pas pu être transmis.');
  const payload = await response.json() as Partial<PublicIncidentReportReceipt>;
  if (typeof payload.receipt_id !== 'string' || payload.status !== 'received' || typeof payload.submitted_at !== 'string') {
    throw new PublicIncidentViewError(null, 'Le reçu du signalement est invalide.');
  }
  return {
    receipt_id: payload.receipt_id,
    status: payload.status,
    submitted_at: payload.submitted_at,
    replayed: payload.replayed === true,
  };
}

export function publicIncidentDownloadUrl(fireId: string, relativeUrl: string): string {
  const origin = getViewerManifestApiOrigin();
  if (!origin || !relativeUrl.startsWith(`/api/v1/incident/${fireId}/`)) throw new PublicIncidentViewError(null, 'Lien de téléchargement invalide.');
  return `${origin}${relativeUrl}`;
}
