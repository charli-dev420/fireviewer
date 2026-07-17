import { buildAdminAuthorizationHeader, getAdminApiOrigin, type AdminSession } from './adminSession';

const SHA256_RE = /^[a-f0-9]{64}$/i;
const ZONE_ID_RE = /^[A-Z][A-Z0-9-]{2,63}$/;

export const ADMIN_ZONE_VISIBILITIES = ['DRAFT', 'PUBLISHED', 'HIDDEN', 'ARCHIVED'] as const;
export type AdminZoneVisibility = (typeof ADMIN_ZONE_VISIBILITIES)[number];

export const ADMIN_INFORMATION_STATES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'HIDDEN', 'REJECTED'] as const;
export type AdminInformationState = (typeof ADMIN_INFORMATION_STATES)[number];

export const ADMIN_INFORMATION_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type AdminInformationDecision = (typeof ADMIN_INFORMATION_DECISIONS)[number];
export const ADMIN_PUBLIC_REPORT_STATES = ['PENDING', 'CORRECTED', 'REJECTED'] as const;
export type AdminPublicReportState = (typeof ADMIN_PUBLIC_REPORT_STATES)[number];

export interface AdminPublicReport {
  readonly report_id: string;
  readonly fire_id: string;
  readonly category: string;
  readonly message: string;
  readonly state: AdminPublicReportState;
  readonly submitted_at: string;
  readonly reviewed_at: string | null;
  readonly closure_reason: string | null;
  readonly version: number;
}
export interface AdminPublication { readonly publication_id: string; readonly zone_id: string; readonly revision: number; readonly package_id: string; readonly state: string; readonly is_active: boolean; readonly updated_at: string; readonly linked_fire_ids: readonly string[]; }

export interface AdminIncidentSummary {
  readonly fire_id: string;
  readonly canonical_name: string | null;
  readonly territory_code: string;
  readonly visibility: string;
  readonly current_episode_id: string;
  readonly status: string;
  readonly verification_state: string;
  readonly corroborating_source_count: number;
  readonly estimated_area_ha: number | null;
  readonly evacuation_established: boolean;
  readonly model_generation_eligible: boolean;
  readonly review_required: boolean;
  readonly last_observed_at: string;
  readonly pending_observation_count: number;
  readonly version: number;
}

export interface AdminIncidentDetail extends AdminIncidentSummary {
  readonly episodes: readonly { episode_id: string; ordinal: number; status: string; verification_state: string; corroborating_source_count: number; evidence_basis_at: string | null; estimated_area_ha: number | null; evacuation_established: boolean; model_generation_eligible: boolean; review_required: boolean; started_at: string; last_observed_at: string; is_current: boolean; version: number }[];
  readonly observations: readonly { observation_id: string; source_key: string; observed_at: string; verification_state: string; attached_episode_id: string | null; proposed_fire_id: string | null; proposed_episode_id: string | null; match_score: number | null; review_reasons: readonly string[]; version: number }[];
  readonly sources: readonly { source_key: string; type: string; trust: string; enabled: boolean; display_name: string | null; public_display_name: string | null }[];
  readonly models: readonly { revision: number; episode_id: string; is_current: boolean; asset_id: string | null; asset_state: string | null; asset_version: number | null; lod: string | null; size_bytes: number | null; generated_at: string | null; spatial_zone_id: string | null; spatial_zone_revision: number | null; asset_spatial_zone_id: string | null; asset_spatial_zone_revision: number | null }[];
  readonly audit: readonly { event_id: string; occurred_at: string; action: string; target_type: string; target_id: string; actor_type: string; actor_id: string; reason: string }[];
}

export interface AdminIncidentObservationsWorkspace {
  readonly fire_id: string;
  readonly observations: readonly {
    observation_id: string; source_key: string; source_type: string; observed_at: string; received_at: string;
    longitude: number; latitude: number; horizontal_uncertainty_m: number; verification_state: string;
    match_decision: string; attached_episode_id: string | null; proposed_fire_id: string | null;
    proposed_episode_id: string | null; match_score: number | null; margin_to_second_candidate: number | null;
    review_reasons: readonly string[]; external_reference: string | null; evidence_license: string; version: number;
  }[];
}

export interface AdminIncidentSourcesMediaWorkspace {
  readonly fire_id: string;
  readonly sources: readonly {
    source_key: string; type: string; trust: string; enabled: boolean; display_name: string | null;
    public_display_name: string | null; public_license: string | null; public_reference_url: string | null;
    public_transformations: readonly string[]; observation_count: number;
  }[];
  readonly media_references: readonly {
    observation_id: string; source_key: string; source_type: string; observed_at: string; received_at: string;
    verification_state: string; evidence_hash: string; evidence_license: string; external_reference: string | null;
  }[];
}

export interface AdminIncidentModelsPipelineWorkspace {
  readonly fire_id: string;
  readonly models: readonly {
    revision: number; episode_id: string; is_current: boolean; created_at: string; reason: string;
    asset_id: string | null; asset_state: string | null; asset_version: number | null; lod: string | null;
    sha256: string | null; size_bytes: number | null; terrain_source_year: number | null;
    generated_at: string | null; published_at: string | null; superseded_at: string | null;
    spatial_zone_id: string | null; spatial_zone_revision: number | null;
    asset_spatial_zone_id: string | null; asset_spatial_zone_revision: number | null;
  }[];
  readonly jobs: readonly {
    job_id: string; kind: string; state: string; episode_id: string; attempt: number; max_attempts: number;
    next_attempt_at: string | null; last_error: string | null; created_at: string; updated_at: string;
  }[];
}

export type AdminGltfPoint = readonly [number, number, number];
export interface AdminIncidentSpatialMarker {
  readonly marker_id: string; readonly source_kind: 'observation' | 'agent_media'; readonly marker_type: string;
  readonly longitude: number; readonly latitude: number; readonly altitude_m: number | null;
  readonly horizontal_accuracy_m: number | null; readonly geometry_origin: string; readonly review_state: string;
  readonly observed_at: string | null; readonly spatial_display_allowed: boolean;
  readonly gltf_position: AdminGltfPoint | null; readonly version: number;
}
export interface AdminActiveFireZoneRevision {
  readonly zone_revision_id: string; readonly revision: number; readonly valid_at: string;
  readonly geometry_geojson: Readonly<Record<string, unknown>>;
  readonly gltf_polygons: readonly (readonly (readonly AdminGltfPoint[])[])[];
  readonly geometry_origin: string; readonly supporting_marker_ids: readonly string[];
  readonly source_revision_ids: readonly string[]; readonly review_state: 'DRAFT' | 'READY_FOR_PUBLICATION' | 'REJECTED';
  readonly supersedes_zone_revision_id: string | null; readonly reason: string; readonly created_by: string;
  readonly reviewed_by: string | null; readonly reviewed_at: string | null; readonly review_reason: string | null;
  readonly created_at: string;
}
export interface AdminIncidentSpatialReviewWorkspace {
  readonly fire_id: string; readonly episode_id: string;
  readonly scene: { readonly asset_url: string | null; readonly asset_version: number | null; readonly sha256: string | null; readonly package_id: string | null; readonly catalog_url: string | null; readonly files: Readonly<Record<string, string>>; readonly origin_wgs84: readonly [number, number, number]; readonly local_frame: 'ENU'; readonly gltf_profile: 'gltf-eun-negz-metric-v1' } | null;
  readonly markers: readonly AdminIncidentSpatialMarker[];
  readonly zone_revisions: readonly AdminActiveFireZoneRevision[];
  readonly agent_reviews: readonly { readonly review_id: string; readonly batch_id: string; readonly state: string; readonly reason_codes: readonly string[]; readonly completed_at: string | null; readonly result: Readonly<Record<string, unknown>> | null }[];
}

export interface AdminSourceUpdateInput {
  readonly type: string;
  readonly trust: string;
  readonly display_name: string | null;
  readonly public_display_name: string | null;
  readonly public_license: string | null;
  readonly public_reference_url: string | null;
  readonly public_transformations: readonly string[];
  readonly enabled: boolean;
  readonly reason: string;
}

export interface AdminWorkQueue {
  readonly observations: readonly { observation_id: string; source_key: string; observed_at: string; longitude: number; latitude: number; horizontal_uncertainty_m: number; verification_state: string; proposed_fire_id: string | null; proposed_episode_id: string | null; proposed_episode_status: string | null; match_score: number | null; review_reasons: readonly string[]; version: number }[];
  readonly reports: readonly AdminPublicReport[];
  readonly incidents: readonly { fire_id: string; episode_id: string; status: string; verification_state: string; last_observed_at: string; version: number }[];
}

export interface AdminOperationalProfile {
  readonly fire_id: string;
  readonly episode_id: string;
  readonly version: number;
  readonly estimated_area_ha: number | null;
  readonly evacuation_established: boolean;
  readonly model_generation_eligible: boolean;
  readonly eligibility_reasons: readonly ('area_threshold' | 'established_evacuation')[];
  readonly terrain_bake_request_id: string | null;
}

export interface AdminGlobalAuditEvent { readonly event_id: string; readonly occurred_at: string; readonly action: string; readonly target_type: string; readonly target_id: string; readonly actor_type: string; readonly actor_id: string; readonly reason: string; readonly trace_id: string; }
export interface AdminRoles { readonly actor_id: string; readonly actor_type: string; readonly assigned_roles: readonly string[]; readonly identity_management: string; readonly catalog: readonly { role: string; description: string; capabilities: readonly string[] }[]; }
export interface AdminSystemStatus { readonly checked_at: string; readonly application: { name: string; version: string; environment: string; authentication_mode: string }; readonly database: { dialect: string; reachable: boolean }; readonly queues: { jobs_active: number; jobs_quarantined: number; outbox_pending: number; outbox_with_error: number; reports_pending: number }; readonly assets: { packages_draft: number; packages_verified: number; packages_previewable: number; packages_published: number; packages_withdrawn_or_revoked: number }; readonly audit_event_count: number; readonly worker_heartbeat: string; }
export interface AdminConfiguration { readonly environment: string; readonly authentication_mode: string; readonly identity_management: string; readonly matching: { policy_id: string; create_below: number; auto_attach_above: number; min_margin: number; max_candidate_distance_m: number; max_incident_uncertainty_m: number; max_candidates: number }; readonly public: { report_rate_limit_per_day: number; idempotency_retention_hours: number; public_notice: string }; readonly storage: { archive_max_bytes: number; unpacked_max_bytes: number; archive_max_files: number; manifest_max_bytes: number }; }

export interface AdminOperationalMapModel {
  readonly profile: 'close' | 'local' | 'extended' | 'mobile' | 'desktop' | 'unspecified';
  readonly source: 'model_asset' | 'spatial_package';
  readonly state: string;
  readonly version: number | null;
  readonly asset_id: string | null;
  readonly package_id: string | null;
  readonly package_file_id: number | null;
  readonly sha256: string;
  readonly size_bytes: number;
  readonly is_current: boolean;
  readonly access_path: string | null;
}

export interface AdminOperationalMapIncident {
  readonly fire_id: string;
  readonly canonical_name: string | null;
  readonly territory_code: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly horizontal_uncertainty_m: number;
  readonly status: string;
  readonly verification_state: string;
  readonly visibility: string;
  readonly current_episode_id: string;
  readonly last_observed_at: string;
  readonly review_required: boolean;
  readonly pending_observation_count: number;
  readonly spatial_zone_id: string | null;
  readonly spatial_zone_revision: number | null;
  readonly current_package_id: string | null;
  readonly active_package_id: string | null;
  readonly models: readonly AdminOperationalMapModel[];
  readonly model_update_available: boolean;
}

export interface AdminOperationalMapSummary {
  readonly total_incidents: number;
  readonly active_incidents: number;
  readonly monitoring_incidents: number;
  readonly incidents_requiring_review: number;
  readonly incidents_with_models: number;
  readonly model_updates_available: number;
}

export interface AdminOperationalMapResponse {
  readonly generated_at: string;
  readonly coordinate_system: 'EPSG:4326';
  readonly summary: AdminOperationalMapSummary;
  readonly incidents: readonly AdminOperationalMapIncident[];
}

export interface AdminDashboardResponse {
  readonly generated_at: string;
  readonly queue: {
    readonly total: number;
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly observations_pending: number;
    readonly reports_pending: number;
    readonly incidents_requiring_review: number;
    readonly jobs_quarantined: number;
    readonly models_to_review: number;
  };
  readonly priorities: readonly {
    readonly kind: 'observation' | 'report' | 'incident' | 'job' | 'model_package';
    readonly priority: 'critical' | 'high' | 'medium';
    readonly target_id: string;
    readonly fire_id: string | null;
    readonly title: string;
    readonly detail: string;
    readonly created_at: string;
  }[];
  readonly watchlist: readonly {
    readonly fire_id: string;
    readonly canonical_name: string | null;
    readonly status: string;
    readonly verification_state: string;
    readonly last_observed_at: string;
    readonly review_required: boolean;
    readonly pending_observation_count: number;
    readonly model_update_available: boolean;
  }[];
  readonly recent_publications: readonly {
    readonly publication_id: string;
    readonly zone_id: string;
    readonly package_id: string;
    readonly state: string;
    readonly is_active: boolean;
    readonly updated_at: string;
    readonly actor_id: string;
    readonly linked_fire_ids: readonly string[];
  }[];
  readonly map_summary: AdminOperationalMapSummary;
  readonly system: AdminSystemStatus;
}

export interface AdminZone {
  readonly zone_id: string;
  readonly label: string;
  readonly description: string;
  readonly visibility: AdminZoneVisibility;
  readonly bounds_l93_m: readonly [number, number, number, number];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminZoneUpload {
  readonly upload_id: string;
  readonly file_name: string;
  readonly archive_sha256: string;
  readonly size_bytes: number;
  readonly state: 'RECEIVED' | 'VALIDATING' | 'VALIDATED' | 'REJECTED';
  readonly created_at: string;
  readonly validation_summary: string;
}

export interface AdminZoneInformation {
  readonly information_id: string;
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly position_l93: readonly [number, number];
  readonly state: AdminInformationState;
  readonly updated_at: string;
  readonly review_note: string | null;
}

export interface AdminZoneDetail {
  readonly zone: AdminZone;
  readonly uploads: readonly AdminZoneUpload[];
  readonly information: readonly AdminZoneInformation[];
}

export interface AdminZoneRevision {
  readonly revision: number;
  readonly spatial_profile_version: string;
  readonly origin_l93_ngf: readonly [number, number, number] | null;
  readonly horizontal_crs: string | null;
  readonly vertical_crs: string | null;
  readonly ground_model: string | null;
  readonly ground_resolution_m: number | null;
  readonly surface_height_reference: string | null;
  readonly origin_wgs84: readonly [number, number, number];
  readonly local_frame: 'ENU';
  readonly meters_per_unit: number;
  readonly vertical_datum: string;
  readonly bounds_m: Readonly<Record<'east' | 'north' | 'up', readonly [number, number]>>;
}

export interface AdminZonePrivatePreview {
  readonly zone_id: string;
  readonly revision: number;
  readonly preview_scope: 'private-admin';
  readonly package_id: string | null;
  readonly package_state: string | null;
  readonly publication_id: string | null;
  readonly publication_state: string | null;
  readonly publication_active: boolean;
  readonly verification_report: Readonly<Record<string, unknown>>;
  readonly preview_package_ids: readonly string[];
  readonly files: readonly { readonly kind: string; readonly sha256: string; readonly size_bytes: number; readonly media_type: string }[];
}

export interface AdminSpatialPackageImport {
  readonly package_id: string;
  readonly state: 'DRAFT';
  readonly upload_id: string;
  readonly object_count: number;
  readonly total_size_bytes: number;
  readonly asset_count: number;
  readonly validation_summary: string;
  readonly trace_id: string;
}

export interface AdminBlobUploadGrant {
  readonly upload_id: string;
  readonly pathname_prefix: string;
  readonly upload_grant: string;
  readonly expires_at: string;
  readonly maximum_file_size_bytes: number;
  readonly allowed_content_types: readonly string[];
}

export interface AdminBlobObjectReference {
  readonly path: string;
  readonly pathname: string;
  readonly size_bytes: number;
  readonly content_type: string;
}

export interface AdminSpatialPackagePublication {
  readonly zone_id: string;
  readonly revision: number;
  readonly package_id: string;
  readonly package_state: string;
  readonly publication_id: string;
  readonly publication_state: string;
  readonly is_active: boolean;
  readonly trace_id: string;
}

export interface CreateAdminZoneInput {
  readonly zone_id: string;
  readonly label: string;
  readonly description: string;
  readonly bounds_l93_m: readonly [number, number, number, number];
  readonly reason: string;
}

export interface UpdateAdminZoneInput {
  readonly label: string;
  readonly description: string;
  readonly bounds_l93_m: readonly [number, number, number, number];
  readonly reason: string;
}

export interface CreateAdminZoneRevisionInput {
  readonly origin_lon: number;
  readonly origin_lat: number;
  readonly source_orthometric_height_m: number;
  readonly geoid_undulation_m: number;
  readonly bounds_m: readonly [number, number, number, number, number, number];
  readonly reason: string;
}

export interface CreateAdminInformationInput {
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly position_l93: readonly [number, number];
  readonly reason: string;
}

export interface UpdateAdminInformationInput extends CreateAdminInformationInput {
  readonly state: AdminInformationState;
}

export type AdminApiErrorKind = 'configuration' | 'network' | 'parse' | 'http' | 'unauthorized';

export class AdminApiError extends Error {
  readonly kind: AdminApiErrorKind;
  readonly status?: number;
  readonly traceId?: string;

  constructor(kind: AdminApiErrorKind, message: string, options: { status?: number; traceId?: string } = {}) {
    super(message);
    this.name = 'AdminApiError';
    this.kind = kind;
    this.status = options.status;
    this.traceId = options.traceId;
  }
}

export interface AdminApiClientOptions {
  readonly session: AdminSession;
  readonly fetchImpl?: typeof fetch;
  readonly onUnauthorized?: () => void;
}

export interface AdminRequestOptions {
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function readString(value: unknown, field: string, options: { nullable?: boolean; max?: number } = {}): string | null {
  if (value === null && options.nullable) return null;
  if (typeof value !== 'string' || value.length === 0 || (options.max !== undefined && value.length > options.max)) {
    throw new Error(`Champ ${field} invalide.`);
  }
  return value;
}

function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Champ ${field} invalide.`);
  return value;
}

function readPositiveInteger(value: unknown, field: string): number {
  const number = readFiniteNumber(value, field);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Champ ${field} invalide.`);
  return number;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  const parsed = readFiniteNumber(value, field);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Champ ${field} invalide.`);
  return parsed;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Champ ${field} invalide.`);
  return value;
}

function readIsoDate(value: unknown, field: string): string {
  const date = readString(value, field);
  if (date === null || !Number.isFinite(Date.parse(date))) throw new Error(`Champ ${field} invalide.`);
  return date;
}

function readEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Champ ${field} invalide.`);
  return value as T;
}

function readTuple(value: unknown, field: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`Champ ${field} invalide.`);
  return value.map((item, index) => readFiniteNumber(item, `${field}[${index}]`));
}

function readBounds(value: unknown, field: string): readonly [number, number, number, number] {
  const numbers = readTuple(value, field, 4);
  if (numbers[0]! >= numbers[2]! || numbers[1]! >= numbers[3]!) throw new Error(`Champ ${field} invalide.`);
  return [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!];
}

function parseZone(value: unknown): AdminZone {
  if (!isRecord(value) || !hasExactKeys(value, [
    'zone_id', 'label', 'description', 'visibility', 'bounds_l93_m', 'created_at', 'updated_at',
  ])) {
    throw new Error('Zone invalide.');
  }
  const zoneId = readString(value.zone_id, 'zone_id', { max: 64 });
  if (zoneId === null || !ZONE_ID_RE.test(zoneId)) throw new Error('Zone invalide.');
  return {
    zone_id: zoneId,
    label: readString(value.label, 'label', { max: 255 })!,
    description: readString(value.description, 'description', { max: 4_000 })!,
    visibility: readEnum(value.visibility, 'visibility', ADMIN_ZONE_VISIBILITIES),
    bounds_l93_m: readBounds(value.bounds_l93_m, 'bounds_l93_m'),
    created_at: readIsoDate(value.created_at, 'created_at'),
    updated_at: readIsoDate(value.updated_at, 'updated_at'),
  };
}

function parseUpload(value: unknown): AdminZoneUpload {
  if (!isRecord(value) || !hasExactKeys(value, [
    'upload_id', 'file_name', 'archive_sha256', 'size_bytes', 'state', 'created_at', 'validation_summary',
  ])) {
    throw new Error('Téléversement invalide.');
  }
  const sha256 = readString(value.archive_sha256, 'archive_sha256', { max: 64 });
  if (sha256 === null || !SHA256_RE.test(sha256)) throw new Error('Téléversement invalide.');
  return {
    upload_id: readString(value.upload_id, 'upload_id', { max: 96 })!,
    file_name: readString(value.file_name, 'file_name', { max: 255 })!,
    archive_sha256: sha256,
    size_bytes: readPositiveInteger(value.size_bytes, 'size_bytes'),
    state: readEnum(value.state, 'state', ['RECEIVED', 'VALIDATING', 'VALIDATED', 'REJECTED']),
    created_at: readIsoDate(value.created_at, 'created_at'),
    validation_summary: readString(value.validation_summary, 'validation_summary', { max: 1_000 })!,
  };
}

function parseInformation(value: unknown): AdminZoneInformation {
  if (!isRecord(value) || !hasExactKeys(value, [
    'information_id', 'title', 'body', 'category', 'position_l93', 'state', 'updated_at', 'review_note',
  ])) {
    throw new Error('Information de zone invalide.');
  }
  const reviewNote = readString(value.review_note, 'review_note', { nullable: true, max: 1_000 });
  return {
    information_id: readString(value.information_id, 'information_id', { max: 96 })!,
    title: readString(value.title, 'title', { max: 255 })!,
    body: readString(value.body, 'body', { max: 8_000 })!,
    category: readString(value.category, 'category', { max: 64 })!,
    position_l93: readTuple(value.position_l93, 'position_l93', 2) as [number, number],
    state: readEnum(value.state, 'state', ADMIN_INFORMATION_STATES),
    updated_at: readIsoDate(value.updated_at, 'updated_at'),
    review_note: reviewNote,
  };
}

function parseRange(value: unknown, field: string): readonly [number, number] {
  const values = readTuple(value, field, 2);
  if (values[0]! > values[1]!) throw new Error(`Champ ${field} invalide.`);
  return [values[0]!, values[1]!];
}

function parseZoneRevision(value: unknown): AdminZoneRevision {
  if (!isRecord(value) || !hasExactKeys(value, ['revision', 'spatial_profile_version', 'origin_l93_ngf', 'horizontal_crs', 'vertical_crs', 'ground_model', 'ground_resolution_m', 'surface_height_reference', 'origin_wgs84', 'local_frame', 'meters_per_unit', 'vertical_datum', 'bounds_m']) || !isRecord(value.bounds_m)) throw new Error('Révision spatiale invalide.');
  if (!hasExactKeys(value.bounds_m, ['east', 'north', 'up'])) throw new Error('Bornes spatiales invalides.');
  const origin = readTuple(value.origin_wgs84, 'origin_wgs84', 3);
  const productionOrigin = value.origin_l93_ngf === null ? null : readTuple(value.origin_l93_ngf, 'origin_l93_ngf', 3);
  const groundResolution = value.ground_resolution_m === null ? null : readFiniteNumber(value.ground_resolution_m, 'ground_resolution_m');
  if (groundResolution !== null && groundResolution <= 0) throw new Error('Résolution de terrain invalide.');
  return { revision: readPositiveInteger(value.revision, 'revision'), spatial_profile_version: readString(value.spatial_profile_version, 'spatial_profile_version', { max: 16 })!, origin_l93_ngf: productionOrigin ? [productionOrigin[0]!, productionOrigin[1]!, productionOrigin[2]!] : null, horizontal_crs: readString(value.horizontal_crs, 'horizontal_crs', { nullable: true, max: 32 }), vertical_crs: readString(value.vertical_crs, 'vertical_crs', { nullable: true, max: 32 }), ground_model: readString(value.ground_model, 'ground_model', { nullable: true, max: 64 }), ground_resolution_m: groundResolution, surface_height_reference: readString(value.surface_height_reference, 'surface_height_reference', { nullable: true, max: 64 }), origin_wgs84: [origin[0]!, origin[1]!, origin[2]!], local_frame: readEnum(value.local_frame, 'local_frame', ['ENU']), meters_per_unit: readFiniteNumber(value.meters_per_unit, 'meters_per_unit'), vertical_datum: readString(value.vertical_datum, 'vertical_datum', { max: 128 })!, bounds_m: { east: parseRange(value.bounds_m.east, 'bounds_m.east'), north: parseRange(value.bounds_m.north, 'bounds_m.north'), up: parseRange(value.bounds_m.up, 'bounds_m.up') } };
}

function parseZoneRevisionEnvelope(value: unknown): { revision: AdminZoneRevision; trace_id: string } {
  if (!isRecord(value) || !hasExactKeys(value, ['revision', 'trace_id'])) throw new Error('Création de révision invalide.');
  return { revision: parseZoneRevision(value.revision), trace_id: parseTraceId(value.trace_id) };
}

function parseSpatialPackageImport(value: unknown): AdminSpatialPackageImport {
  if (!isRecord(value) || !hasExactKeys(value, ['package', 'trace_id']) || !isRecord(value.package)) throw new Error('Import spatial invalide.');
  const item = value.package;
  if (!hasExactKeys(item, ['package_id', 'state', 'upload_id', 'object_count', 'total_size_bytes', 'asset_count', 'validation_summary'])) throw new Error('Import spatial invalide.');
  return {
    package_id: readString(item.package_id, 'package_id', { max: 96 })!,
    state: readEnum(item.state, 'state', ['DRAFT']),
    upload_id: readString(item.upload_id, 'upload_id', { max: 32 })!,
    object_count: readPositiveInteger(item.object_count, 'object_count'),
    total_size_bytes: readPositiveInteger(item.total_size_bytes, 'total_size_bytes'),
    asset_count: readPositiveInteger(item.asset_count, 'asset_count'),
    validation_summary: readString(item.validation_summary, 'validation_summary', { max: 1_000 })!,
    trace_id: parseTraceId(value.trace_id),
  };
}

function parseBlobUploadGrant(value: unknown): AdminBlobUploadGrant {
  if (!isRecord(value) || !hasExactKeys(value, ['upload_id', 'pathname_prefix', 'upload_grant', 'expires_at', 'maximum_file_size_bytes', 'allowed_content_types']) || !Array.isArray(value.allowed_content_types)) {
    throw new Error('Autorisation d’envoi Blob invalide.');
  }
  const uploadId = readString(value.upload_id, 'upload_id', { max: 32 });
  if (!uploadId || !/^[a-f0-9]{32}$/.test(uploadId)) throw new Error('Autorisation d’envoi Blob invalide.');
  return {
    upload_id: uploadId,
    pathname_prefix: readString(value.pathname_prefix, 'pathname_prefix', { max: 2_048 })!,
    upload_grant: readString(value.upload_grant, 'upload_grant', { max: 4_096 })!,
    expires_at: readIsoDate(value.expires_at, 'expires_at'),
    maximum_file_size_bytes: readPositiveInteger(value.maximum_file_size_bytes, 'maximum_file_size_bytes'),
    allowed_content_types: value.allowed_content_types.map((item) => readString(item, 'allowed_content_type', { max: 128 })!),
  };
}

function parseZonePrivatePreview(value: unknown): AdminZonePrivatePreview {
  if (!isRecord(value) || !hasExactKeys(value, ['zone_id', 'revision', 'preview_scope', 'package_id', 'package_state', 'publication_id', 'publication_state', 'publication_active', 'verification_report', 'preview_package_ids', 'files']) || !isRecord(value.verification_report) || !Array.isArray(value.preview_package_ids) || !Array.isArray(value.files) || typeof value.publication_active !== 'boolean') throw new Error('Aperçu privé invalide.');
  const previewPackageIds = value.preview_package_ids.map((item) => readString(item, 'preview_package_ids', { max: 96 })!);
  if (new Set(previewPackageIds).size !== previewPackageIds.length) throw new Error('Aperçu privé invalide.');
  return { zone_id: readString(value.zone_id, 'zone_id', { max: 64 })!, revision: readPositiveInteger(value.revision, 'revision'), preview_scope: readEnum(value.preview_scope, 'preview_scope', ['private-admin']), package_id: readString(value.package_id, 'package_id', { nullable: true, max: 128 }), package_state: readString(value.package_state, 'package_state', { nullable: true, max: 64 }), publication_id: readString(value.publication_id, 'publication_id', { nullable: true, max: 128 }), publication_state: readString(value.publication_state, 'publication_state', { nullable: true, max: 64 }), publication_active: value.publication_active, verification_report: value.verification_report, preview_package_ids: previewPackageIds, files: value.files.map((file) => { if (!isRecord(file) || !hasExactKeys(file, ['kind', 'sha256', 'size_bytes', 'media_type'])) throw new Error('Fichier preview invalide.'); return { kind: readString(file.kind, 'kind', { max: 64 })!, sha256: readString(file.sha256, 'sha256', { max: 64 })!, size_bytes: readPositiveInteger(file.size_bytes, 'size_bytes'), media_type: readString(file.media_type, 'media_type', { max: 128 })! }; }) };
}

function parseSpatialPackagePublication(value: unknown): AdminSpatialPackagePublication {
  if (!isRecord(value) || !hasExactKeys(value, ['publication', 'trace_id']) || !isRecord(value.publication)) throw new Error('Publication spatiale invalide.');
  const publication = value.publication;
  if (!hasExactKeys(publication, ['zone_id', 'revision', 'package_id', 'package_state', 'publication_id', 'publication_state', 'is_active']) || typeof publication.is_active !== 'boolean') throw new Error('Publication spatiale invalide.');
  return { zone_id: readString(publication.zone_id, 'zone_id', { max: 64 })!, revision: readPositiveInteger(publication.revision, 'revision'), package_id: readString(publication.package_id, 'package_id', { max: 96 })!, package_state: readString(publication.package_state, 'package_state', { max: 64 })!, publication_id: readString(publication.publication_id, 'publication_id', { max: 96 })!, publication_state: readString(publication.publication_state, 'publication_state', { max: 64 })!, is_active: publication.is_active, trace_id: parseTraceId(value.trace_id) };
}

function parsePublicReport(value: unknown): AdminPublicReport {
  if (!isRecord(value) || !hasExactKeys(value, ['report_id', 'fire_id', 'category', 'message', 'state', 'submitted_at', 'reviewed_at', 'closure_reason', 'version'])) {
    throw new Error('Signalement invalide.');
  }
  return {
    report_id: readString(value.report_id, 'report_id', { max: 96 })!,
    fire_id: readString(value.fire_id, 'fire_id', { max: 32 })!,
    category: readString(value.category, 'category', { max: 64 })!,
    message: readString(value.message, 'message', { max: 2_000 })!,
    state: readEnum(value.state, 'state', ADMIN_PUBLIC_REPORT_STATES),
    submitted_at: readIsoDate(value.submitted_at, 'submitted_at'),
    reviewed_at: readString(value.reviewed_at, 'reviewed_at', { nullable: true }) === null ? null : readIsoDate(value.reviewed_at, 'reviewed_at'),
    closure_reason: readString(value.closure_reason, 'closure_reason', { nullable: true, max: 500 }),
    version: readPositiveInteger(value.version, 'version'),
  };
}

function parseIncidentSummary(value: unknown): AdminIncidentSummary {
  if (!isRecord(value)) throw new Error('Incident invalide.');
  return {
    fire_id: readString(value.fire_id, 'fire_id', { max: 32 })!, canonical_name: readString(value.canonical_name, 'canonical_name', { nullable: true, max: 255 }), territory_code: readString(value.territory_code, 'territory_code', { max: 3 })!, visibility: readString(value.visibility, 'visibility', { max: 32 })!, current_episode_id: readString(value.current_episode_id, 'current_episode_id', { max: 16 })!, status: readString(value.status, 'status', { max: 32 })!, verification_state: readString(value.verification_state, 'verification_state', { max: 32 })!, corroborating_source_count: readFiniteNumber(value.corroborating_source_count, 'corroborating_source_count'), estimated_area_ha: value.estimated_area_ha === null ? null : readFiniteNumber(value.estimated_area_ha, 'estimated_area_ha'), evacuation_established: Boolean(value.evacuation_established), model_generation_eligible: Boolean(value.model_generation_eligible), review_required: Boolean(value.review_required), last_observed_at: readIsoDate(value.last_observed_at, 'last_observed_at'), pending_observation_count: readFiniteNumber(value.pending_observation_count, 'pending_observation_count'), version: readPositiveInteger(value.version, 'version'),
  };
}

function parseIncidentDetail(value: unknown): AdminIncidentDetail {
  if (!isRecord(value) || !Array.isArray(value.episodes) || !Array.isArray(value.observations) || !Array.isArray(value.sources) || !Array.isArray(value.models) || !Array.isArray(value.audit)) throw new Error('Détail incident invalide.');
  const summary = parseIncidentSummary(value);
  return {
    ...summary,
    episodes: value.episodes.map((item) => { if (!isRecord(item)) throw new Error(); return { episode_id: readString(item.episode_id, 'episode_id')!, ordinal: readPositiveInteger(item.ordinal, 'ordinal'), status: readString(item.status, 'status')!, verification_state: readString(item.verification_state, 'verification_state')!, corroborating_source_count: readFiniteNumber(item.corroborating_source_count, 'corroborating_source_count'), evidence_basis_at: item.evidence_basis_at === null ? null : readIsoDate(item.evidence_basis_at, 'evidence_basis_at'), estimated_area_ha: item.estimated_area_ha === null ? null : readFiniteNumber(item.estimated_area_ha, 'estimated_area_ha'), evacuation_established: Boolean(item.evacuation_established), model_generation_eligible: Boolean(item.model_generation_eligible), review_required: Boolean(item.review_required), started_at: readIsoDate(item.started_at, 'started_at'), last_observed_at: readIsoDate(item.last_observed_at, 'last_observed_at'), is_current: Boolean(item.is_current), version: readPositiveInteger(item.version, 'version') }; }),
    observations: value.observations.map((item) => { if (!isRecord(item) || !Array.isArray(item.review_reasons)) throw new Error(); return { observation_id: readString(item.observation_id, 'observation_id')!, source_key: readString(item.source_key, 'source_key')!, observed_at: readIsoDate(item.observed_at, 'observed_at'), verification_state: readString(item.verification_state, 'verification_state')!, attached_episode_id: readString(item.attached_episode_id, 'attached_episode_id', { nullable: true }), proposed_fire_id: readString(item.proposed_fire_id, 'proposed_fire_id', { nullable: true }), proposed_episode_id: readString(item.proposed_episode_id, 'proposed_episode_id', { nullable: true }), match_score: item.match_score === null ? null : readFiniteNumber(item.match_score, 'match_score'), review_reasons: item.review_reasons.map((reason) => readString(reason, 'review_reason')!), version: readPositiveInteger(item.version, 'version') }; }),
    sources: value.sources.map((item) => { if (!isRecord(item)) throw new Error(); return { source_key: readString(item.source_key, 'source_key')!, type: readString(item.type, 'type')!, trust: readString(item.trust, 'trust')!, enabled: Boolean(item.enabled), display_name: readString(item.display_name, 'display_name', { nullable: true }), public_display_name: readString(item.public_display_name, 'public_display_name', { nullable: true }) }; }),
    models: value.models.map((item) => { if (!isRecord(item)) throw new Error(); return { revision: readPositiveInteger(item.revision, 'revision'), episode_id: readString(item.episode_id, 'episode_id')!, is_current: Boolean(item.is_current), asset_id: readString(item.asset_id, 'asset_id', { nullable: true }), asset_state: readString(item.asset_state, 'asset_state', { nullable: true }), asset_version: item.asset_version === null ? null : readPositiveInteger(item.asset_version, 'asset_version'), lod: readString(item.lod, 'lod', { nullable: true }), size_bytes: item.size_bytes === null ? null : readPositiveInteger(item.size_bytes, 'size_bytes'), generated_at: item.generated_at === null ? null : readIsoDate(item.generated_at, 'generated_at'), spatial_zone_id: readString(item.spatial_zone_id, 'spatial_zone_id', { nullable: true }), spatial_zone_revision: item.spatial_zone_revision === null ? null : readPositiveInteger(item.spatial_zone_revision, 'spatial_zone_revision'), asset_spatial_zone_id: readString(item.asset_spatial_zone_id, 'asset_spatial_zone_id', { nullable: true }), asset_spatial_zone_revision: item.asset_spatial_zone_revision === null ? null : readPositiveInteger(item.asset_spatial_zone_revision, 'asset_spatial_zone_revision') }; }),
    audit: value.audit.map((item) => { if (!isRecord(item)) throw new Error(); return { event_id: readString(item.event_id, 'event_id')!, occurred_at: readIsoDate(item.occurred_at, 'occurred_at'), action: readString(item.action, 'action')!, target_type: readString(item.target_type, 'target_type')!, target_id: readString(item.target_id, 'target_id')!, actor_type: readString(item.actor_type, 'actor_type')!, actor_id: readString(item.actor_id, 'actor_id')!, reason: readString(item.reason, 'reason')! }; }),
  };
}

function parseIncidentObservationsWorkspace(value: unknown): AdminIncidentObservationsWorkspace {
  if (!isRecord(value) || !Array.isArray(value.observations)) throw new Error('Observations incident invalides.');
  return {
    fire_id: readString(value.fire_id, 'fire_id', { max: 32 })!,
    observations: value.observations.map((item) => {
      if (!isRecord(item) || !Array.isArray(item.review_reasons)) throw new Error('Observation incident invalide.');
      return {
        observation_id: readString(item.observation_id, 'observation_id', { max: 64 })!,
        source_key: readString(item.source_key, 'source_key', { max: 128 })!,
        source_type: readString(item.source_type, 'source_type', { max: 64 })!,
        observed_at: readIsoDate(item.observed_at, 'observed_at'),
        received_at: readIsoDate(item.received_at, 'received_at'),
        longitude: readFiniteNumber(item.longitude, 'longitude'),
        latitude: readFiniteNumber(item.latitude, 'latitude'),
        horizontal_uncertainty_m: readFiniteNumber(item.horizontal_uncertainty_m, 'horizontal_uncertainty_m'),
        verification_state: readString(item.verification_state, 'verification_state', { max: 64 })!,
        match_decision: readString(item.match_decision, 'match_decision', { max: 64 })!,
        attached_episode_id: readString(item.attached_episode_id, 'attached_episode_id', { nullable: true, max: 16 }),
        proposed_fire_id: readString(item.proposed_fire_id, 'proposed_fire_id', { nullable: true, max: 32 }),
        proposed_episode_id: readString(item.proposed_episode_id, 'proposed_episode_id', { nullable: true, max: 16 }),
        match_score: item.match_score === null ? null : readFiniteNumber(item.match_score, 'match_score'),
        margin_to_second_candidate: item.margin_to_second_candidate === null ? null : readFiniteNumber(item.margin_to_second_candidate, 'margin_to_second_candidate'),
        review_reasons: item.review_reasons.map((reason) => readString(reason, 'review_reason', { max: 500 })!),
        external_reference: readString(item.external_reference, 'external_reference', { nullable: true, max: 512 }),
        evidence_license: readString(item.evidence_license, 'evidence_license', { max: 255 })!,
        version: readPositiveInteger(item.version, 'version'),
      };
    }),
  };
}

function parseIncidentSourcesMediaWorkspace(value: unknown): AdminIncidentSourcesMediaWorkspace {
  if (!isRecord(value) || !Array.isArray(value.sources) || !Array.isArray(value.media_references)) throw new Error('Sources incident invalides.');
  return {
    fire_id: readString(value.fire_id, 'fire_id', { max: 32 })!,
    sources: value.sources.map((item) => {
      if (!isRecord(item) || !Array.isArray(item.public_transformations) || typeof item.enabled !== 'boolean') throw new Error('Source incident invalide.');
      return {
        source_key: readString(item.source_key, 'source_key', { max: 128 })!,
        type: readString(item.type, 'type', { max: 64 })!,
        trust: readString(item.trust, 'trust', { max: 64 })!,
        enabled: item.enabled,
        display_name: readString(item.display_name, 'display_name', { nullable: true, max: 255 }),
        public_display_name: readString(item.public_display_name, 'public_display_name', { nullable: true, max: 255 }),
        public_license: readString(item.public_license, 'public_license', { nullable: true, max: 255 }),
        public_reference_url: readString(item.public_reference_url, 'public_reference_url', { nullable: true, max: 2048 }),
        public_transformations: item.public_transformations.map((entry) => readString(entry, 'public_transformation', { max: 255 })!),
        observation_count: readPositiveInteger(item.observation_count, 'observation_count'),
      };
    }),
    media_references: value.media_references.map((item) => {
      if (!isRecord(item)) throw new Error('Référence média invalide.');
      return {
        observation_id: readString(item.observation_id, 'observation_id', { max: 64 })!,
        source_key: readString(item.source_key, 'source_key', { max: 128 })!,
        source_type: readString(item.source_type, 'source_type', { max: 64 })!,
        observed_at: readIsoDate(item.observed_at, 'observed_at'),
        received_at: readIsoDate(item.received_at, 'received_at'),
        verification_state: readString(item.verification_state, 'verification_state', { max: 64 })!,
        evidence_hash: readString(item.evidence_hash, 'evidence_hash', { max: 80 })!,
        evidence_license: readString(item.evidence_license, 'evidence_license', { max: 255 })!,
        external_reference: readString(item.external_reference, 'external_reference', { nullable: true, max: 512 }),
      };
    }),
  };
}

function parseIncidentModelsPipelineWorkspace(value: unknown): AdminIncidentModelsPipelineWorkspace {
  if (!isRecord(value) || !Array.isArray(value.models) || !Array.isArray(value.jobs)) throw new Error('Modèles incident invalides.');
  return {
    fire_id: readString(value.fire_id, 'fire_id', { max: 32 })!,
    models: value.models.map((item) => {
      if (!isRecord(item) || typeof item.is_current !== 'boolean') throw new Error('Modèle incident invalide.');
      return {
        revision: readPositiveInteger(item.revision, 'revision'),
        episode_id: readString(item.episode_id, 'episode_id', { max: 16 })!,
        is_current: item.is_current,
        created_at: readIsoDate(item.created_at, 'created_at'),
        reason: readString(item.reason, 'reason', { max: 500 })!,
        asset_id: readString(item.asset_id, 'asset_id', { nullable: true, max: 64 }),
        asset_state: readString(item.asset_state, 'asset_state', { nullable: true, max: 64 }),
        asset_version: item.asset_version === null ? null : readPositiveInteger(item.asset_version, 'asset_version'),
        lod: readString(item.lod, 'lod', { nullable: true, max: 64 }),
        sha256: readString(item.sha256, 'sha256', { nullable: true, max: 64 }),
        size_bytes: item.size_bytes === null ? null : readPositiveInteger(item.size_bytes, 'size_bytes'),
        terrain_source_year: item.terrain_source_year === null ? null : readPositiveInteger(item.terrain_source_year, 'terrain_source_year'),
        generated_at: readString(item.generated_at, 'generated_at', { nullable: true }) === null ? null : readIsoDate(item.generated_at, 'generated_at'),
        published_at: readString(item.published_at, 'published_at', { nullable: true }) === null ? null : readIsoDate(item.published_at, 'published_at'),
        superseded_at: readString(item.superseded_at, 'superseded_at', { nullable: true }) === null ? null : readIsoDate(item.superseded_at, 'superseded_at'),
        spatial_zone_id: readString(item.spatial_zone_id, 'spatial_zone_id', { nullable: true, max: 64 }),
        spatial_zone_revision: item.spatial_zone_revision === null ? null : readPositiveInteger(item.spatial_zone_revision, 'spatial_zone_revision'),
        asset_spatial_zone_id: readString(item.asset_spatial_zone_id, 'asset_spatial_zone_id', { nullable: true, max: 64 }),
        asset_spatial_zone_revision: item.asset_spatial_zone_revision === null ? null : readPositiveInteger(item.asset_spatial_zone_revision, 'asset_spatial_zone_revision'),
      };
    }),
    jobs: value.jobs.map((item) => {
      if (!isRecord(item)) throw new Error('Job pipeline invalide.');
      return {
        job_id: readString(item.job_id, 'job_id', { max: 64 })!,
        kind: readString(item.kind, 'kind', { max: 64 })!,
        state: readString(item.state, 'state', { max: 64 })!,
        episode_id: readString(item.episode_id, 'episode_id', { max: 16 })!,
        attempt: readNonNegativeInteger(item.attempt, 'attempt'),
        max_attempts: readPositiveInteger(item.max_attempts, 'max_attempts'),
        next_attempt_at: readString(item.next_attempt_at, 'next_attempt_at', { nullable: true }) === null ? null : readIsoDate(item.next_attempt_at, 'next_attempt_at'),
        last_error: readString(item.last_error, 'last_error', { nullable: true, max: 10_000 }),
        created_at: readIsoDate(item.created_at, 'created_at'),
        updated_at: readIsoDate(item.updated_at, 'updated_at'),
      };
    }),
  };
}

function parseGltfPoint(value: unknown, field: string): AdminGltfPoint {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`Point ${field} invalide.`);
  return [readFiniteNumber(value[0], `${field}.x`), readFiniteNumber(value[1], `${field}.y`), readFiniteNumber(value[2], `${field}.z`)];
}

function parseActiveFireZoneRevision(value: unknown): AdminActiveFireZoneRevision {
  if (!isRecord(value) || !isRecord(value.geometry_geojson) || !Array.isArray(value.gltf_polygons) || !Array.isArray(value.supporting_marker_ids) || !Array.isArray(value.source_revision_ids)) throw new Error('Révision de zone active invalide.');
  return {
    zone_revision_id: readString(value.zone_revision_id, 'zone_revision_id', { max: 128 })!, revision: readPositiveInteger(value.revision, 'revision'), valid_at: readIsoDate(value.valid_at, 'valid_at'), geometry_geojson: value.geometry_geojson,
    gltf_polygons: value.gltf_polygons.map((polygon, polygonIndex) => { if (!Array.isArray(polygon)) throw new Error('Polygone glTF invalide.'); return polygon.map((ring, ringIndex) => { if (!Array.isArray(ring)) throw new Error('Anneau glTF invalide.'); return ring.map((point, pointIndex) => parseGltfPoint(point, `gltf_polygons.${polygonIndex}.${ringIndex}.${pointIndex}`)); }); }),
    geometry_origin: readString(value.geometry_origin, 'geometry_origin', { max: 64 })!, supporting_marker_ids: value.supporting_marker_ids.map((item) => readString(item, 'supporting_marker_id', { max: 128 })!), source_revision_ids: value.source_revision_ids.map((item) => readString(item, 'source_revision_id', { max: 128 })!), review_state: readEnum(value.review_state, 'review_state', ['DRAFT', 'READY_FOR_PUBLICATION', 'REJECTED'] as const),
    supersedes_zone_revision_id: readString(value.supersedes_zone_revision_id, 'supersedes_zone_revision_id', { nullable: true, max: 128 }), reason: readString(value.reason, 'reason', { max: 500 })!, created_by: readString(value.created_by, 'created_by', { max: 255 })!, reviewed_by: readString(value.reviewed_by, 'reviewed_by', { nullable: true, max: 255 }), reviewed_at: value.reviewed_at === null ? null : readIsoDate(value.reviewed_at, 'reviewed_at'), review_reason: readString(value.review_reason, 'review_reason', { nullable: true, max: 500 }), created_at: readIsoDate(value.created_at, 'created_at'),
  };
}

function parseIncidentSpatialReviewWorkspace(value: unknown): AdminIncidentSpatialReviewWorkspace {
  if (!isRecord(value) || !Array.isArray(value.markers) || !Array.isArray(value.zone_revisions) || !Array.isArray(value.agent_reviews)) throw new Error('Espace de revue spatiale invalide.');
  let scene: AdminIncidentSpatialReviewWorkspace['scene'] = null;
  if (value.scene !== null) {
    if (!isRecord(value.scene) || (value.scene.files !== undefined && !isRecord(value.scene.files)) || !Array.isArray(value.scene.origin_wgs84) || value.scene.origin_wgs84.length !== 3) throw new Error('Scène 3D invalide.');
    const sceneFiles = isRecord(value.scene.files) ? value.scene.files : {};
    scene = { asset_url: value.scene.asset_url === undefined ? null : readString(value.scene.asset_url, 'asset_url', { nullable: true, max: 2_048 }), asset_version: value.scene.asset_version === undefined || value.scene.asset_version === null ? null : readPositiveInteger(value.scene.asset_version, 'asset_version'), sha256: value.scene.sha256 === undefined ? null : readString(value.scene.sha256, 'sha256', { nullable: true, max: 64 }), package_id: value.scene.package_id === undefined ? null : readString(value.scene.package_id, 'package_id', { nullable: true, max: 96 }), catalog_url: value.scene.catalog_url === undefined ? null : readString(value.scene.catalog_url, 'catalog_url', { nullable: true, max: 2_048 }), files: Object.fromEntries(Object.entries(sceneFiles).map(([path, url]) => [path, readString(url, `files.${path}`, { max: 2_048 })!])), origin_wgs84: [readFiniteNumber(value.scene.origin_wgs84[0], 'origin.lon'), readFiniteNumber(value.scene.origin_wgs84[1], 'origin.lat'), readFiniteNumber(value.scene.origin_wgs84[2], 'origin.alt')], local_frame: readEnum(value.scene.local_frame, 'local_frame', ['ENU'] as const), gltf_profile: readEnum(value.scene.gltf_profile, 'gltf_profile', ['gltf-eun-negz-metric-v1'] as const) };
  }
  return {
    fire_id: readString(value.fire_id, 'fire_id', { max: 32 })!, episode_id: readString(value.episode_id, 'episode_id', { max: 16 })!, scene,
    markers: value.markers.map((item) => { if (!isRecord(item) || typeof item.spatial_display_allowed !== 'boolean') throw new Error('Marqueur spatial invalide.'); return { marker_id: readString(item.marker_id, 'marker_id', { max: 128 })!, source_kind: readEnum(item.source_kind, 'source_kind', ['observation', 'agent_media'] as const), marker_type: readString(item.marker_type, 'marker_type', { max: 64 })!, longitude: readFiniteNumber(item.longitude, 'longitude'), latitude: readFiniteNumber(item.latitude, 'latitude'), altitude_m: item.altitude_m === null ? null : readFiniteNumber(item.altitude_m, 'altitude_m'), horizontal_accuracy_m: item.horizontal_accuracy_m === null ? null : readFiniteNumber(item.horizontal_accuracy_m, 'horizontal_accuracy_m'), geometry_origin: readString(item.geometry_origin, 'geometry_origin', { max: 64 })!, review_state: readString(item.review_state, 'review_state', { max: 64 })!, observed_at: item.observed_at === null ? null : readIsoDate(item.observed_at, 'observed_at'), spatial_display_allowed: item.spatial_display_allowed, gltf_position: item.gltf_position === null ? null : parseGltfPoint(item.gltf_position, 'gltf_position'), version: readPositiveInteger(item.version, 'version') }; }),
    zone_revisions: value.zone_revisions.map(parseActiveFireZoneRevision),
    agent_reviews: value.agent_reviews.map((item) => { if (!isRecord(item) || !Array.isArray(item.reason_codes) || (item.result !== null && !isRecord(item.result))) throw new Error('Revue agentique invalide.'); return { review_id: readString(item.review_id, 'review_id', { max: 128 })!, batch_id: readString(item.batch_id, 'batch_id', { max: 128 })!, state: readString(item.state, 'state', { max: 64 })!, reason_codes: item.reason_codes.map((reason) => readString(reason, 'reason_code', { max: 128 })!), completed_at: item.completed_at === null ? null : readIsoDate(item.completed_at, 'completed_at'), result: item.result }; }),
  };
}

function parseWorkQueue(value: unknown): AdminWorkQueue {
  if (!isRecord(value) || !Array.isArray(value.observations) || !Array.isArray(value.reports) || !Array.isArray(value.incidents)) throw new Error('File de traitement invalide.');
  return {
    observations: value.observations.map((item) => { if (!isRecord(item) || !Array.isArray(item.review_reasons)) throw new Error(); return { observation_id: readString(item.observation_id, 'observation_id')!, source_key: readString(item.source_key, 'source_key')!, observed_at: readIsoDate(item.observed_at, 'observed_at'), longitude: readFiniteNumber(item.longitude, 'longitude'), latitude: readFiniteNumber(item.latitude, 'latitude'), horizontal_uncertainty_m: readFiniteNumber(item.horizontal_uncertainty_m, 'horizontal_uncertainty_m'), verification_state: readString(item.verification_state, 'verification_state')!, proposed_fire_id: readString(item.proposed_fire_id, 'proposed_fire_id', { nullable: true }), proposed_episode_id: readString(item.proposed_episode_id, 'proposed_episode_id', { nullable: true }), proposed_episode_status: readString(item.proposed_episode_status, 'proposed_episode_status', { nullable: true }), match_score: item.match_score === null ? null : readFiniteNumber(item.match_score, 'match_score'), review_reasons: item.review_reasons.map((reason) => readString(reason, 'review_reason')!), version: readPositiveInteger(item.version, 'version') }; }),
    reports: value.reports.map(parsePublicReport),
    incidents: value.incidents.map((item) => { if (!isRecord(item)) throw new Error(); return { fire_id: readString(item.fire_id, 'fire_id')!, episode_id: readString(item.episode_id, 'episode_id')!, status: readString(item.status, 'status')!, verification_state: readString(item.verification_state, 'verification_state')!, last_observed_at: readIsoDate(item.last_observed_at, 'last_observed_at'), version: readPositiveInteger(item.version, 'version') }; }),
  };
}

function parseAuditEvent(value: unknown): AdminGlobalAuditEvent { if (!isRecord(value)) throw new Error('Audit invalide.'); return { event_id: readString(value.event_id, 'event_id')!, occurred_at: readIsoDate(value.occurred_at, 'occurred_at'), action: readString(value.action, 'action')!, target_type: readString(value.target_type, 'target_type')!, target_id: readString(value.target_id, 'target_id')!, actor_type: readString(value.actor_type, 'actor_type')!, actor_id: readString(value.actor_id, 'actor_id')!, reason: readString(value.reason, 'reason')!, trace_id: readString(value.trace_id, 'trace_id')! }; }
function parseRoles(value: unknown): AdminRoles { if (!isRecord(value) || !Array.isArray(value.assigned_roles) || !Array.isArray(value.catalog)) throw new Error('Rôles invalides.'); return { actor_id: readString(value.actor_id, 'actor_id')!, actor_type: readString(value.actor_type, 'actor_type')!, assigned_roles: value.assigned_roles.map((entry) => readString(entry, 'assigned_role')!), identity_management: readString(value.identity_management, 'identity_management')!, catalog: value.catalog.map((item) => { if (!isRecord(item) || !Array.isArray(item.capabilities)) throw new Error(); return { role: readString(item.role, 'role')!, description: readString(item.description, 'description')!, capabilities: item.capabilities.map((entry) => readString(entry, 'capability')!) }; }) }; }
function readCounter(value: unknown, field: string): number { const result = readFiniteNumber(value, field); if (!Number.isInteger(result) || result < 0) throw new Error(`Champ ${field} invalide.`); return result; }
function parseSystem(value: unknown): AdminSystemStatus { if (!isRecord(value) || !isRecord(value.application) || !isRecord(value.database) || !isRecord(value.queues) || !isRecord(value.assets) || typeof value.database.reachable !== 'boolean') throw new Error('État système invalide.'); return { checked_at: readIsoDate(value.checked_at, 'checked_at'), application: { name: readString(value.application.name, 'application.name')!, version: readString(value.application.version, 'application.version')!, environment: readString(value.application.environment, 'application.environment')!, authentication_mode: readString(value.application.authentication_mode, 'application.authentication_mode')! }, database: { dialect: readString(value.database.dialect, 'database.dialect')!, reachable: value.database.reachable }, queues: { jobs_active: readCounter(value.queues.jobs_active, 'jobs_active'), jobs_quarantined: readCounter(value.queues.jobs_quarantined, 'jobs_quarantined'), outbox_pending: readCounter(value.queues.outbox_pending, 'outbox_pending'), outbox_with_error: readCounter(value.queues.outbox_with_error, 'outbox_with_error'), reports_pending: readCounter(value.queues.reports_pending, 'reports_pending') }, assets: { packages_draft: readCounter(value.assets.packages_draft, 'packages_draft'), packages_verified: readCounter(value.assets.packages_verified, 'packages_verified'), packages_previewable: readCounter(value.assets.packages_previewable, 'packages_previewable'), packages_published: readCounter(value.assets.packages_published, 'packages_published'), packages_withdrawn_or_revoked: readCounter(value.assets.packages_withdrawn_or_revoked, 'packages_withdrawn_or_revoked') }, audit_event_count: readCounter(value.audit_event_count, 'audit_event_count'), worker_heartbeat: readString(value.worker_heartbeat, 'worker_heartbeat')! }; }
function parseConfiguration(value: unknown): AdminConfiguration { if (!isRecord(value) || !isRecord(value.matching) || !isRecord(value.public) || !isRecord(value.storage)) throw new Error('Configuration invalide.'); return { environment: readString(value.environment, 'environment')!, authentication_mode: readString(value.authentication_mode, 'authentication_mode')!, identity_management: readString(value.identity_management, 'identity_management')!, matching: { policy_id: readString(value.matching.policy_id, 'policy_id')!, create_below: readFiniteNumber(value.matching.create_below, 'create_below'), auto_attach_above: readFiniteNumber(value.matching.auto_attach_above, 'auto_attach_above'), min_margin: readFiniteNumber(value.matching.min_margin, 'min_margin'), max_candidate_distance_m: readFiniteNumber(value.matching.max_candidate_distance_m, 'max_candidate_distance_m'), max_incident_uncertainty_m: readFiniteNumber(value.matching.max_incident_uncertainty_m, 'max_incident_uncertainty_m'), max_candidates: readPositiveInteger(value.matching.max_candidates, 'max_candidates') }, public: { report_rate_limit_per_day: readPositiveInteger(value.public.report_rate_limit_per_day, 'report_rate_limit_per_day'), idempotency_retention_hours: readPositiveInteger(value.public.idempotency_retention_hours, 'idempotency_retention_hours'), public_notice: readString(value.public.public_notice, 'public_notice')! }, storage: { archive_max_bytes: readPositiveInteger(value.storage.archive_max_bytes, 'archive_max_bytes'), unpacked_max_bytes: readPositiveInteger(value.storage.unpacked_max_bytes, 'unpacked_max_bytes'), archive_max_files: readPositiveInteger(value.storage.archive_max_files, 'archive_max_files'), manifest_max_bytes: readPositiveInteger(value.storage.manifest_max_bytes, 'manifest_max_bytes') } }; }

function parseOperationalMapSummary(value: unknown): AdminOperationalMapSummary {
  if (!isRecord(value)) throw new Error('Résumé de carte invalide.');
  return {
    total_incidents: readNonNegativeInteger(value.total_incidents, 'total_incidents'),
    active_incidents: readNonNegativeInteger(value.active_incidents, 'active_incidents'),
    monitoring_incidents: readNonNegativeInteger(value.monitoring_incidents, 'monitoring_incidents'),
    incidents_requiring_review: readNonNegativeInteger(value.incidents_requiring_review, 'incidents_requiring_review'),
    incidents_with_models: readNonNegativeInteger(value.incidents_with_models, 'incidents_with_models'),
    model_updates_available: readNonNegativeInteger(value.model_updates_available, 'model_updates_available'),
  };
}

function parseOperationalMapModel(value: unknown): AdminOperationalMapModel {
  if (!isRecord(value)) throw new Error('Modèle cartographique invalide.');
  const sha256 = readString(value.sha256, 'sha256', { max: 64 })!;
  if (!SHA256_RE.test(sha256)) throw new Error('Checksum modèle invalide.');
  return {
    profile: readEnum(value.profile, 'profile', ['close', 'local', 'extended', 'mobile', 'desktop', 'unspecified'] as const),
    source: readEnum(value.source, 'source', ['model_asset', 'spatial_package'] as const),
    state: readString(value.state, 'state', { max: 64 })!,
    version: value.version === null ? null : readPositiveInteger(value.version, 'version'),
    asset_id: readString(value.asset_id, 'asset_id', { nullable: true, max: 64 }),
    package_id: readString(value.package_id, 'package_id', { nullable: true, max: 96 }),
    package_file_id: value.package_file_id === null ? null : readPositiveInteger(value.package_file_id, 'package_file_id'),
    sha256,
    size_bytes: readPositiveInteger(value.size_bytes, 'size_bytes'),
    is_current: readBoolean(value.is_current, 'is_current'),
    access_path: readString(value.access_path, 'access_path', { nullable: true, max: 2_048 }),
  };
}

function parseOperationalMapIncident(value: unknown): AdminOperationalMapIncident {
  if (!isRecord(value) || !Array.isArray(value.models)) throw new Error('Incident cartographique invalide.');
  const longitude = readFiniteNumber(value.longitude, 'longitude');
  const latitude = readFiniteNumber(value.latitude, 'latitude');
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error('Coordonnées cartographiques invalides.');
  return {
    fire_id: readString(value.fire_id, 'fire_id', { max: 32 })!,
    canonical_name: readString(value.canonical_name, 'canonical_name', { nullable: true, max: 255 }),
    territory_code: readString(value.territory_code, 'territory_code', { max: 3 })!,
    longitude,
    latitude,
    horizontal_uncertainty_m: readFiniteNumber(value.horizontal_uncertainty_m, 'horizontal_uncertainty_m'),
    status: readString(value.status, 'status', { max: 32 })!,
    verification_state: readString(value.verification_state, 'verification_state', { max: 32 })!,
    visibility: readString(value.visibility, 'visibility', { max: 32 })!,
    current_episode_id: readString(value.current_episode_id, 'current_episode_id', { max: 32 })!,
    last_observed_at: readIsoDate(value.last_observed_at, 'last_observed_at'),
    review_required: readBoolean(value.review_required, 'review_required'),
    pending_observation_count: readNonNegativeInteger(value.pending_observation_count, 'pending_observation_count'),
    spatial_zone_id: readString(value.spatial_zone_id, 'spatial_zone_id', { nullable: true, max: 64 }),
    spatial_zone_revision: value.spatial_zone_revision === null ? null : readPositiveInteger(value.spatial_zone_revision, 'spatial_zone_revision'),
    current_package_id: readString(value.current_package_id, 'current_package_id', { nullable: true, max: 96 }),
    active_package_id: readString(value.active_package_id, 'active_package_id', { nullable: true, max: 96 }),
    models: value.models.map(parseOperationalMapModel),
    model_update_available: readBoolean(value.model_update_available, 'model_update_available'),
  };
}

function parseOperationalMap(value: unknown): AdminOperationalMapResponse {
  if (!isRecord(value) || !Array.isArray(value.incidents)) throw new Error('Carte opérationnelle invalide.');
  return {
    generated_at: readIsoDate(value.generated_at, 'generated_at'),
    coordinate_system: readEnum(value.coordinate_system, 'coordinate_system', ['EPSG:4326'] as const),
    summary: parseOperationalMapSummary(value.summary),
    incidents: value.incidents.map(parseOperationalMapIncident),
  };
}

function parseDashboard(value: unknown): AdminDashboardResponse {
  if (!isRecord(value) || !isRecord(value.queue) || !Array.isArray(value.priorities) || !Array.isArray(value.watchlist) || !Array.isArray(value.recent_publications)) {
    throw new Error('Tableau de bord invalide.');
  }
  return {
    generated_at: readIsoDate(value.generated_at, 'generated_at'),
    queue: {
      total: readNonNegativeInteger(value.queue.total, 'queue.total'),
      critical: readNonNegativeInteger(value.queue.critical, 'queue.critical'),
      high: readNonNegativeInteger(value.queue.high, 'queue.high'),
      medium: readNonNegativeInteger(value.queue.medium, 'queue.medium'),
      observations_pending: readNonNegativeInteger(value.queue.observations_pending, 'queue.observations_pending'),
      reports_pending: readNonNegativeInteger(value.queue.reports_pending, 'queue.reports_pending'),
      incidents_requiring_review: readNonNegativeInteger(value.queue.incidents_requiring_review, 'queue.incidents_requiring_review'),
      jobs_quarantined: readNonNegativeInteger(value.queue.jobs_quarantined, 'queue.jobs_quarantined'),
      models_to_review: readNonNegativeInteger(value.queue.models_to_review, 'queue.models_to_review'),
    },
    priorities: value.priorities.map((item) => {
      if (!isRecord(item)) throw new Error('Priorité invalide.');
      return {
        kind: readEnum(item.kind, 'priority.kind', ['observation', 'report', 'incident', 'job', 'model_package'] as const),
        priority: readEnum(item.priority, 'priority.priority', ['critical', 'high', 'medium'] as const),
        target_id: readString(item.target_id, 'priority.target_id', { max: 96 })!,
        fire_id: readString(item.fire_id, 'priority.fire_id', { nullable: true, max: 32 }),
        title: readString(item.title, 'priority.title', { max: 255 })!,
        detail: readString(item.detail, 'priority.detail', { max: 500 })!,
        created_at: readIsoDate(item.created_at, 'priority.created_at'),
      };
    }),
    watchlist: value.watchlist.map((item) => {
      if (!isRecord(item)) throw new Error('Incident surveillé invalide.');
      return {
        fire_id: readString(item.fire_id, 'watchlist.fire_id', { max: 32 })!,
        canonical_name: readString(item.canonical_name, 'watchlist.canonical_name', { nullable: true, max: 255 }),
        status: readString(item.status, 'watchlist.status', { max: 32 })!,
        verification_state: readString(item.verification_state, 'watchlist.verification_state', { max: 32 })!,
        last_observed_at: readIsoDate(item.last_observed_at, 'watchlist.last_observed_at'),
        review_required: readBoolean(item.review_required, 'watchlist.review_required'),
        pending_observation_count: readNonNegativeInteger(item.pending_observation_count, 'watchlist.pending_observation_count'),
        model_update_available: readBoolean(item.model_update_available, 'watchlist.model_update_available'),
      };
    }),
    recent_publications: value.recent_publications.map((item) => {
      if (!isRecord(item) || !Array.isArray(item.linked_fire_ids)) throw new Error('Publication récente invalide.');
      return {
        publication_id: readString(item.publication_id, 'publication_id', { max: 96 })!,
        zone_id: readString(item.zone_id, 'zone_id', { max: 64 })!,
        package_id: readString(item.package_id, 'package_id', { max: 96 })!,
        state: readString(item.state, 'state', { max: 64 })!,
        is_active: readBoolean(item.is_active, 'is_active'),
        updated_at: readIsoDate(item.updated_at, 'updated_at'),
        actor_id: readString(item.actor_id, 'actor_id', { max: 128 })!,
        linked_fire_ids: item.linked_fire_ids.map((fireId) => readString(fireId, 'linked_fire_id', { max: 32 })!),
      };
    }),
    map_summary: parseOperationalMapSummary(value.map_summary),
    system: parseSystem(value.system),
  };
}

function parseTraceId(value: unknown): string {
  return readString(value, 'trace_id', { max: 128 })!;
}

function parseZoneEnvelope(value: unknown): { zone: AdminZone; trace_id: string } {
  if (!isRecord(value) || !hasExactKeys(value, ['zone', 'trace_id'])) throw new Error('Réponse zone invalide.');
  return { zone: parseZone(value.zone), trace_id: parseTraceId(value.trace_id) };
}

function parseInformationEnvelope(value: unknown): { information: AdminZoneInformation; trace_id: string } {
  if (!isRecord(value) || !hasExactKeys(value, ['information', 'trace_id'])) {
    throw new Error('Réponse information invalide.');
  }
  return { information: parseInformation(value.information), trace_id: parseTraceId(value.trace_id) };
}

function readProblemTraceId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.trace_id !== 'string' || value.trace_id.length === 0 || value.trace_id.length > 128) {
    return undefined;
  }
  return value.trace_id;
}

function safeErrorMessage(status: number): string {
  if (status === 400 || status === 422) return 'Les données saisies ne sont pas acceptées par le service.';
  if (status === 404) return 'La ressource administrée demandée est introuvable.';
  if (status === 409) return 'Cette action est en conflit avec l’état actuel de la zone.';
  if (status >= 500) return 'Le service d’administration est momentanément indisponible.';
  return 'La demande d’administration a été refusée.';
}

function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => {
    throw new AdminApiError('parse', 'La réponse du service d’administration est invalide.');
  });
}

function apiOriginOrThrow(): string {
  const origin = getAdminApiOrigin();
  if (!origin) {
    throw new AdminApiError('configuration', 'L’origine de l’API administrateur n’est pas configurée de façon sûre.');
  }
  return origin;
}

function endpoint(origin: string, path: string): string {
  return `${origin}/api/v1/admin${path}`;
}

function endpointV2(origin: string, path: string): string {
  return `${origin}/api/v2/admin${path}`;
}

function operatorEndpoint(origin: string, path: string): string { return `${origin}/api/v1/operator${path}`; }

function normalizeZoneId(zoneId: string): string {
  const normalized = zoneId.trim().toUpperCase();
  if (!ZONE_ID_RE.test(normalized)) {
    throw new AdminApiError('configuration', 'L’identifiant de zone est invalide.');
  }
  return normalized;
}

function uuidFallback(): string {
  const random = Math.random().toString(36).slice(2);
  return `admin-ui-${Date.now().toString(36)}-${random}`;
}

/** Crée une clé par intention utilisateur, à conserver lors d’une relance manuelle. */
export function createAdminIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `admin-ui-${crypto.randomUUID()}`;
  }
  return uuidFallback();
}

export class AdminApiClient {
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly authorization: string;
  private readonly csrfToken: string;
  private readonly onUnauthorized?: () => void;

  constructor(options: AdminApiClientOptions) {
    this.origin = apiOriginOrThrow();
    // `this.fetchImpl(...)` would bind a native browser fetch to this client
    // instance. Chromium rejects that receiver before any HTTP request is
    // emitted. Keep the injected implementation unbound behind an arrow.
    const requestFetch = options.fetchImpl ?? globalThis.fetch;
    this.fetchImpl = (input, init) => requestFetch(input, init);
    this.authorization = buildAdminAuthorizationHeader(options.session);
    this.csrfToken = options.session.csrfToken ?? '';
    this.onUnauthorized = options.onUnauthorized;
  }

  private async requestAt(
    url: string,
    init: RequestInit,
    options: AdminRequestOptions = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        cache: 'no-store',
        credentials: 'include',
        signal: options.signal,
        headers: {
          Accept: 'application/json',
          ...(this.authorization ? { Authorization: this.authorization } : {}),
          'X-CSRF-Token': this.csrfToken,
          ...init.headers,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new AdminApiError('network', 'Le service d’administration est inaccessible.');
    }

    if (response.status === 401 || response.status === 403) {
      this.onUnauthorized?.();
      throw new AdminApiError('unauthorized', 'La session administrateur n’est plus autorisée.', { status: response.status });
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new AdminApiError('http', safeErrorMessage(response.status), {
        status: response.status,
        traceId: readProblemTraceId(body),
      });
    }
    return readJson(response);
  }

  private request(
    path: string,
    init: RequestInit,
    options: AdminRequestOptions = {},
  ): Promise<unknown> {
    return this.requestAt(endpoint(this.origin, path), init, options);
  }

  private requestV2(
    path: string,
    init: RequestInit,
    options: AdminRequestOptions = {},
  ): Promise<unknown> {
    return this.requestAt(endpointV2(this.origin, path), init, options);
  }

  private async requestBlob(
    path: string,
    init: RequestInit,
    options: AdminRequestOptions = {},
  ): Promise<Blob> {
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint(this.origin, path), {
        ...init,
        cache: 'no-store',
        credentials: 'include',
        signal: options.signal,
        headers: {
          Accept: 'image/png',
          ...(this.authorization ? { Authorization: this.authorization } : {}),
          'X-CSRF-Token': this.csrfToken,
          ...init.headers,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new AdminApiError('network', 'L’aperçu binaire privé est inaccessible.');
    }
    if (response.status === 401 || response.status === 403) {
      this.onUnauthorized?.();
      throw new AdminApiError('unauthorized', 'La session administrateur n’est plus autorisée.', { status: response.status });
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new AdminApiError('http', safeErrorMessage(response.status), {
        status: response.status,
        traceId: readProblemTraceId(body),
      });
    }
    if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('image/png')) {
      throw new AdminApiError('parse', 'L’aperçu binaire reçu n’est pas une image PNG.');
    }
    return response.blob();
  }

  private postJson(path: string, payload: object, options: AdminRequestOptions): Promise<unknown> {
    if (!options.idempotencyKey || options.idempotencyKey.length > 128) {
      throw new AdminApiError('configuration', 'Une clé d’idempotence est requise pour cette action.');
    }
    return this.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': options.idempotencyKey,
      },
      body: JSON.stringify(payload),
    }, options);
  }

  private async operatorPost(path: string, payload: object, options: AdminRequestOptions): Promise<unknown> {
    if (!options.idempotencyKey || options.idempotencyKey.length > 128) throw new AdminApiError('configuration', 'Une clé d’idempotence est requise pour cette action.');
    let response: Response;
    try { response = await this.fetchImpl(operatorEndpoint(this.origin, path), { method: 'POST', cache: 'no-store', credentials: 'include', signal: options.signal, headers: { Accept: 'application/json', ...(this.authorization ? { Authorization: this.authorization } : {}), 'X-CSRF-Token': this.csrfToken, 'Content-Type': 'application/json', 'Idempotency-Key': options.idempotencyKey }, body: JSON.stringify(payload) }); }
    catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; throw new AdminApiError('network', 'Le service opérateur est inaccessible.'); }
    if (response.status === 401 || response.status === 403) { this.onUnauthorized?.(); throw new AdminApiError('unauthorized', 'Cette session ne possède pas le rôle requis pour cette action.', { status: response.status }); }
    if (!response.ok) { const body = await response.json().catch(() => null); throw new AdminApiError('http', safeErrorMessage(response.status), { status: response.status, traceId: readProblemTraceId(body) }); }
    return readJson(response);
  }

  private async operatorPut(path: string, payload: object, options: AdminRequestOptions): Promise<unknown> {
    let response: Response;
    try { response = await this.fetchImpl(operatorEndpoint(this.origin, path), { method: 'PUT', cache: 'no-store', credentials: 'include', signal: options.signal, headers: { Accept: 'application/json', ...(this.authorization ? { Authorization: this.authorization } : {}), 'X-CSRF-Token': this.csrfToken, 'Content-Type': 'application/json', ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}) }, body: JSON.stringify(payload) }); }
    catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; throw new AdminApiError('network', 'Le service opérateur est inaccessible.'); }
    if (response.status === 401 || response.status === 403) { this.onUnauthorized?.(); throw new AdminApiError('unauthorized', 'Cette session ne possède pas le rôle requis pour cette action.', { status: response.status }); }
    if (!response.ok) { const body = await response.json().catch(() => null); throw new AdminApiError('http', safeErrorMessage(response.status), { status: response.status, traceId: readProblemTraceId(body) }); }
    return readJson(response);
  }

  async listZones(options: AdminRequestOptions = {}): Promise<readonly AdminZone[]> {
    const payload = await this.request('/zones', { method: 'GET' }, options);
    if (!isRecord(payload) || !hasExactKeys(payload, ['zones']) || !Array.isArray(payload.zones)) {
      throw new AdminApiError('parse', 'La liste des zones est invalide.');
    }
    try {
      return payload.zones.map(parseZone);
    } catch {
      throw new AdminApiError('parse', 'La liste des zones est invalide.');
    }
  }

  async createZone(input: CreateAdminZoneInput, options: AdminRequestOptions): Promise<{ zone: AdminZone; trace_id: string }> {
    const zoneId = normalizeZoneId(input.zone_id);
    const payload = await this.postJson('/zones', {
      ...input,
      zone_id: zoneId,
    }, options);
    try {
      return parseZoneEnvelope(payload);
    } catch {
      throw new AdminApiError('parse', 'La réponse de création de zone est invalide.');
    }
  }

  async getZone(zoneId: string, options: AdminRequestOptions = {}): Promise<AdminZoneDetail> {
    const normalized = normalizeZoneId(zoneId);
    const payload = await this.request(`/zones/${encodeURIComponent(normalized)}`, { method: 'GET' }, options);
    if (!isRecord(payload) || !hasExactKeys(payload, ['zone', 'uploads', 'information'])
      || !Array.isArray(payload.uploads) || !Array.isArray(payload.information)) {
      throw new AdminApiError('parse', 'Le détail de la zone est invalide.');
    }
    try {
      return {
        zone: parseZone(payload.zone),
        uploads: payload.uploads.map(parseUpload),
        information: payload.information.map(parseInformation),
      };
    } catch {
      throw new AdminApiError('parse', 'Le détail de la zone est invalide.');
    }
  }

  async getZoneRevision(zoneId: string, revision: number, options: AdminRequestOptions = {}): Promise<AdminZoneRevision> {
    const normalized = normalizeZoneId(zoneId);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new AdminApiError('configuration', 'Numéro de révision invalide.');
    const payload = await this.request(`/zones/${encodeURIComponent(normalized)}/revisions/${revision}`, { method: 'GET' }, options);
    try { return parseZoneRevision(payload); }
    catch { throw new AdminApiError('parse', 'La révision spatiale est invalide.'); }
  }

  async createZoneRevision(
    zoneId: string,
    input: CreateAdminZoneRevisionInput,
    options: AdminRequestOptions,
  ): Promise<{ revision: AdminZoneRevision; trace_id: string }> {
    const normalized = normalizeZoneId(zoneId);
    const bounds = input.bounds_m;
    if (!Number.isSafeInteger(bounds.length) || bounds.length !== 6 || !bounds.every(Number.isFinite)
      || bounds[0] >= bounds[1] || bounds[2] >= bounds[3] || bounds[4] >= bounds[5]
      || input.reason.trim().length < 10) {
      throw new AdminApiError('configuration', 'La création de révision spatiale est invalide.');
    }
    const payload = await this.postJson(`/zones/${encodeURIComponent(normalized)}/revisions`, input, options);
    try { return parseZoneRevisionEnvelope(payload); }
    catch { throw new AdminApiError('parse', 'La réponse de création de révision est invalide.'); }
  }

  async getZonePrivatePreview(zoneId: string, revision: number, options: AdminRequestOptions = {}): Promise<AdminZonePrivatePreview> {
    const normalized = normalizeZoneId(zoneId);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new AdminApiError('configuration', 'Numéro de révision invalide.');
    const payload = await this.request(`/zones/${encodeURIComponent(normalized)}/revisions/${revision}/preview`, { method: 'GET' }, options);
    try { return parseZonePrivatePreview(payload); }
    catch { throw new AdminApiError('parse', 'L’aperçu privé est invalide.'); }
  }

  async getZonePrivatePreviewPng(
    zoneId: string,
    revision: number,
    packageId: string,
    options: AdminRequestOptions = {},
  ): Promise<Blob> {
    const normalized = normalizeZoneId(zoneId);
    if (!Number.isSafeInteger(revision) || revision < 1 || packageId.trim().length < 3 || packageId.length > 96) {
      throw new AdminApiError('configuration', 'La demande d’aperçu binaire est invalide.');
    }
    return this.requestBlob(
      `/zones/${encodeURIComponent(normalized)}/revisions/${revision}/preview/packages/${encodeURIComponent(packageId)}/png`,
      { method: 'GET' },
      options,
    );
  }

  getBlobUploadTokenUrl(): string {
    return endpoint(this.origin, '/blob-upload-token');
  }

  async refreshAdminSession(options: AdminRequestOptions = {}): Promise<void> {
    const payload = await this.request('/session', { method: 'GET' }, options);
    if (
      !isRecord(payload)
      || payload.authenticated !== true
      || Object.keys(payload).some((key) => key !== 'authenticated' && key !== 'csrf_token')
      || (
        payload.csrf_token !== undefined
        && payload.csrf_token !== null
        && typeof payload.csrf_token !== 'string'
      )
    ) {
      throw new AdminApiError('parse', 'La confirmation de session administrateur est invalide.');
    }
  }

  async createSpatialPackageUploadGrant(
    zoneId: string,
    revision: number,
    input: { readonly package_id: string; readonly file_count: number; readonly total_size_bytes: number },
    options: AdminRequestOptions = {},
  ): Promise<AdminBlobUploadGrant> {
    const normalized = normalizeZoneId(zoneId);
    if (!Number.isSafeInteger(revision) || revision < 1 || input.package_id.trim().length < 3 || !Number.isSafeInteger(input.file_count) || input.file_count < 3 || !Number.isSafeInteger(input.total_size_bytes) || input.total_size_bytes < 1) {
      throw new AdminApiError('configuration', 'La demande d’envoi du package spatial est invalide.');
    }
    const payload = await this.request(`/zones/${encodeURIComponent(normalized)}/revisions/${revision}/packages/upload-grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }, options);
    try { return parseBlobUploadGrant(payload); }
    catch { throw new AdminApiError('parse', 'L’autorisation d’envoi du package spatial est invalide.'); }
  }

  async finalizeSpatialPackageFromBlob(
    zoneId: string,
    revision: number,
    input: { readonly upload_id: string; readonly package_id: string; readonly reason: string; readonly objects: readonly AdminBlobObjectReference[] },
    options: AdminRequestOptions,
  ): Promise<AdminSpatialPackageImport> {
    const normalized = normalizeZoneId(zoneId);
    if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{32}$/.test(input.upload_id) || input.package_id.trim().length < 3 || input.reason.trim().length < 10 || input.objects.length < 3) {
      throw new AdminApiError('configuration', 'La finalisation du package spatial est invalide.');
    }
    const payload = await this.postJson(
      `/zones/${encodeURIComponent(normalized)}/revisions/${revision}/packages/from-blob`,
      input,
      options,
    );
    try { return parseSpatialPackageImport(payload); }
    catch { throw new AdminApiError('parse', 'La réponse de finalisation du package spatial est invalide.'); }
  }

  async recoverSpatialPackageFromBlob(
    zoneId: string,
    revision: number,
    input: { readonly upload_id: string; readonly package_id: string; readonly reason: string },
    options: AdminRequestOptions,
  ): Promise<AdminSpatialPackageImport> {
    const normalized = normalizeZoneId(zoneId);
    if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{32}$/.test(input.upload_id) || input.package_id.trim().length < 3 || input.reason.trim().length < 10) {
      throw new AdminApiError('configuration', 'La reprise du package spatial est invalide.');
    }
    const payload = await this.postJson(
      `/zones/${encodeURIComponent(normalized)}/revisions/${revision}/packages/recover-from-blob`,
      input,
      options,
    );
    try { return parseSpatialPackageImport(payload); }
    catch { throw new AdminApiError('parse', 'La réponse de reprise du package spatial est invalide.'); }
  }

  async validateSpatialPackage(zoneId: string, revision: number, input: { readonly package_id: string; readonly reason: string }, options: AdminRequestOptions): Promise<AdminSpatialPackagePublication> {
    const normalized = normalizeZoneId(zoneId);
    if (!Number.isSafeInteger(revision) || revision < 1 || input.package_id.trim().length < 3 || input.reason.trim().length < 10) throw new AdminApiError('configuration', 'La validation du package est invalide.');
    const payload = await this.postJson(`/zones/${encodeURIComponent(normalized)}/revisions/${revision}/validations`, input, options);
    try { return parseSpatialPackagePublication(payload); }
    catch { throw new AdminApiError('parse', 'La réponse de validation du package est invalide.'); }
  }

  async enableSpatialPackagePreview(zoneId: string, revision: number, input: { readonly package_id: string; readonly reason: string }, options: AdminRequestOptions): Promise<AdminSpatialPackagePublication> {
    const normalized = normalizeZoneId(zoneId);
    if (!Number.isSafeInteger(revision) || revision < 1 || input.package_id.trim().length < 3 || input.reason.trim().length < 10) throw new AdminApiError('configuration', 'La prévisualisation du package est invalide.');
    const payload = await this.postJson(`/zones/${encodeURIComponent(normalized)}/revisions/${revision}/preview`, input, options);
    try { return parseSpatialPackagePublication(payload); }
    catch { throw new AdminApiError('parse', 'La réponse de prévisualisation est invalide.'); }
  }

  async publishSpatialPackage(zoneId: string, revision: number, input: { readonly package_id: string; readonly reason: string; readonly admin_password?: string }, options: AdminRequestOptions): Promise<AdminSpatialPackagePublication> {
    const normalized = normalizeZoneId(zoneId);
    if (!Number.isSafeInteger(revision) || revision < 1 || input.package_id.trim().length < 3 || input.reason.trim().length < 10 || (input.admin_password !== undefined && input.admin_password.length === 0)) throw new AdminApiError('configuration', 'La publication du package est invalide.');
    const payload = await this.postJson('/publications', { zone_id: normalized, revision, ...input }, options);
    try { return parseSpatialPackagePublication(payload); }
    catch { throw new AdminApiError('parse', 'La réponse de publication est invalide.'); }
  }

  async updateZone(
    zoneId: string,
    input: UpdateAdminZoneInput,
    options: AdminRequestOptions,
  ): Promise<{ zone: AdminZone; trace_id: string }> {
    const normalized = normalizeZoneId(zoneId);
    if (!options.idempotencyKey || options.idempotencyKey.length > 128) {
      throw new AdminApiError('configuration', 'Une clé d’idempotence est requise pour cette action.');
    }
    const payload = await this.request(`/zones/${encodeURIComponent(normalized)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': options.idempotencyKey,
      },
      body: JSON.stringify(input),
    }, options);
    try {
      return parseZoneEnvelope(payload);
    } catch {
      throw new AdminApiError('parse', 'La réponse de mise à jour de zone est invalide.');
    }
  }

  async createInformation(
    zoneId: string,
    input: CreateAdminInformationInput,
    options: AdminRequestOptions,
  ): Promise<{ information: AdminZoneInformation; trace_id: string }> {
    const normalized = normalizeZoneId(zoneId);
    const payload = await this.postJson(`/zones/${encodeURIComponent(normalized)}/information`, input, options);
    try {
      return parseInformationEnvelope(payload);
    } catch {
      throw new AdminApiError('parse', 'La réponse de création d’information est invalide.');
    }
  }

  async updateInformation(
    zoneId: string,
    informationId: string,
    input: UpdateAdminInformationInput,
    options: AdminRequestOptions,
  ): Promise<{ information: AdminZoneInformation; trace_id: string }> {
    const normalized = normalizeZoneId(zoneId);
    if (!informationId || informationId.length > 96 || !options.idempotencyKey || options.idempotencyKey.length > 128) {
      throw new AdminApiError('configuration', 'La mise à jour d’information est invalide.');
    }
    const payload = await this.request(
      `/zones/${encodeURIComponent(normalized)}/information/${encodeURIComponent(informationId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': options.idempotencyKey,
        },
        body: JSON.stringify(input),
      },
      options,
    );
    try {
      return parseInformationEnvelope(payload);
    } catch {
      throw new AdminApiError('parse', 'La réponse de mise à jour d’information est invalide.');
    }
  }

  async setZoneVisibility(
    zoneId: string,
    visibility: Extract<AdminZoneVisibility, 'PUBLISHED' | 'HIDDEN'>,
    reason: string,
    options: AdminRequestOptions,
  ): Promise<{ zone: AdminZone; trace_id: string }> {
    const normalized = normalizeZoneId(zoneId);
    const payload = await this.postJson(`/zones/${encodeURIComponent(normalized)}/visibility`, { visibility, reason }, options);
    try {
      return parseZoneEnvelope(payload);
    } catch {
      throw new AdminApiError('parse', 'La réponse de visibilité est invalide.');
    }
  }

  async listPublicReports(state?: AdminPublicReportState, options: AdminRequestOptions = {}): Promise<readonly AdminPublicReport[]> {
    const query = state ? `?state=${encodeURIComponent(state)}` : '';
    const payload = await this.request(`/reports${query}`, { method: 'GET' }, options);
    if (!isRecord(payload) || !hasExactKeys(payload, ['reports']) || !Array.isArray(payload.reports)) {
      throw new AdminApiError('parse', 'La liste des signalements est invalide.');
    }
    try { return payload.reports.map(parsePublicReport); }
    catch { throw new AdminApiError('parse', 'La liste des signalements est invalide.'); }
  }

  async listIncidents(options: AdminRequestOptions = {}): Promise<readonly AdminIncidentSummary[]> {
    const payload = await this.requestV2('/incidents', { method: 'GET' }, options);
    if (!isRecord(payload) || !Array.isArray(payload.incidents)) throw new AdminApiError('parse', 'La liste des incidents est invalide.');
    try { return payload.incidents.map(parseIncidentSummary); }
    catch { throw new AdminApiError('parse', 'La liste des incidents est invalide.'); }
  }

  async getWorkQueue(options: AdminRequestOptions = {}): Promise<AdminWorkQueue> {
    const payload = await this.requestV2('/work-queue', { method: 'GET' }, options);
    try { return parseWorkQueue(payload); }
    catch { throw new AdminApiError('parse', 'La file de traitement est invalide.'); }
  }

  async getDashboard(options: AdminRequestOptions = {}): Promise<AdminDashboardResponse> {
    const payload = await this.requestV2('/dashboard', { method: 'GET' }, options);
    try { return parseDashboard(payload); }
    catch { throw new AdminApiError('parse', 'Le tableau de bord administrateur est invalide.'); }
  }

  async getOperationalMap(options: AdminRequestOptions = {}): Promise<AdminOperationalMapResponse> {
    const payload = await this.requestV2('/operational-map', { method: 'GET' }, options);
    try { return parseOperationalMap(payload); }
    catch { throw new AdminApiError('parse', 'La carte opérationnelle est invalide.'); }
  }

  async listGlobalAudit(filters: { readonly action?: string; readonly targetId?: string } = {}, options: AdminRequestOptions = {}): Promise<readonly AdminGlobalAuditEvent[]> {
    const search = new URLSearchParams(); if (filters.action?.trim()) search.set('action', filters.action.trim()); if (filters.targetId?.trim()) search.set('target_id', filters.targetId.trim());
    const payload = await this.request(`/audit${search.size ? `?${search}` : ''}`, { method: 'GET' }, options);
    if (!isRecord(payload) || !Array.isArray(payload.events)) throw new AdminApiError('parse', 'La liste d’audit est invalide.');
    try { return payload.events.map(parseAuditEvent); } catch { throw new AdminApiError('parse', 'La liste d’audit est invalide.'); }
  }

  async getRoles(options: AdminRequestOptions = {}): Promise<AdminRoles> { const payload = await this.request('/roles', { method: 'GET' }, options); try { return parseRoles(payload); } catch { throw new AdminApiError('parse', 'Les rôles sont invalides.'); } }
  async getSystemStatus(options: AdminRequestOptions = {}): Promise<AdminSystemStatus> { const payload = await this.request('/system', { method: 'GET' }, options); try { return parseSystem(payload); } catch { throw new AdminApiError('parse', 'L’état système est invalide.'); } }
  async getConfiguration(options: AdminRequestOptions = {}): Promise<AdminConfiguration> { const payload = await this.request('/configuration', { method: 'GET' }, options); try { return parseConfiguration(payload); } catch { throw new AdminApiError('parse', 'La configuration est invalide.'); } }

  async listPublications(options: AdminRequestOptions = {}): Promise<readonly AdminPublication[]> {
    const payload = await this.request('/publications', { method: 'GET' }, options);
    if (!isRecord(payload) || !Array.isArray(payload.publications)) throw new AdminApiError('parse', 'La liste des publications est invalide.');
    return payload.publications.map((value) => {
      if (!isRecord(value) || !Array.isArray(value.linked_fire_ids)) throw new AdminApiError('parse', 'Une publication est invalide.');
      return { publication_id: readString(value.publication_id, 'publication_id')!, zone_id: readString(value.zone_id, 'zone_id')!, revision: readPositiveInteger(value.revision, 'revision'), package_id: readString(value.package_id, 'package_id')!, state: readString(value.state, 'state')!, is_active: value.is_active === true, updated_at: readIsoDate(value.updated_at, 'updated_at'), linked_fire_ids: value.linked_fire_ids.map((item) => readString(item, 'linked_fire_id')!) };
    });
  }

  async changePublication(publicationId: string, action: 'withdraw' | 'restore', input: { readonly reason: string }, options: AdminRequestOptions): Promise<void> {
    if (!publicationId || input.reason.trim().length < 10) throw new AdminApiError('configuration', 'La transition de publication est invalide.');
    await this.postJson(`/publications/${encodeURIComponent(publicationId)}/${action}`, { reason: input.reason.trim(), confirm_publication_id: publicationId }, options);
  }

  async getIncident(fireId: string, options: AdminRequestOptions = {}): Promise<AdminIncidentDetail> {
    if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(fireId)) throw new AdminApiError('configuration', 'Identifiant fire_id invalide.');
    const payload = await this.request(`/incidents/${encodeURIComponent(fireId)}`, { method: 'GET' }, options);
    try { return parseIncidentDetail(payload); }
    catch { throw new AdminApiError('parse', 'Le détail de l’incident est invalide.'); }
  }

  async getIncidentObservations(fireId: string, options: AdminRequestOptions = {}): Promise<AdminIncidentObservationsWorkspace> {
    if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(fireId)) throw new AdminApiError('configuration', 'Identifiant fire_id invalide.');
    const payload = await this.request(`/incidents/${encodeURIComponent(fireId)}/observations`, { method: 'GET' }, options);
    try { return parseIncidentObservationsWorkspace(payload); }
    catch { throw new AdminApiError('parse', 'Les observations de l’incident sont invalides.'); }
  }

  async getIncidentSourcesMedia(fireId: string, options: AdminRequestOptions = {}): Promise<AdminIncidentSourcesMediaWorkspace> {
    if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(fireId)) throw new AdminApiError('configuration', 'Identifiant fire_id invalide.');
    const payload = await this.request(`/incidents/${encodeURIComponent(fireId)}/sources-media`, { method: 'GET' }, options);
    try { return parseIncidentSourcesMediaWorkspace(payload); }
    catch { throw new AdminApiError('parse', 'Les sources et médias de l’incident sont invalides.'); }
  }

  async getIncidentModelsPipeline(fireId: string, options: AdminRequestOptions = {}): Promise<AdminIncidentModelsPipelineWorkspace> {
    if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(fireId)) throw new AdminApiError('configuration', 'Identifiant fire_id invalide.');
    const payload = await this.request(`/incidents/${encodeURIComponent(fireId)}/models-pipeline`, { method: 'GET' }, options);
    try { return parseIncidentModelsPipelineWorkspace(payload); }
    catch { throw new AdminApiError('parse', 'Les modèles et jobs de l’incident sont invalides.'); }
  }

  async getIncidentSpatialReview(fireId: string, options: AdminRequestOptions = {}): Promise<AdminIncidentSpatialReviewWorkspace> {
    if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(fireId)) throw new AdminApiError('configuration', 'Identifiant fire_id invalide.');
    const payload = await this.request(`/incidents/${encodeURIComponent(fireId)}/spatial-review`, { method: 'GET' }, options);
    try { return parseIncidentSpatialReviewWorkspace(payload); }
    catch { throw new AdminApiError('parse', 'L’espace de revue spatiale est invalide.'); }
  }

  async projectIncidentGltfPick(fireId: string, point: AdminGltfPoint, options: AdminRequestOptions = {}): Promise<{ longitude: number; latitude: number; altitude_m: number }> {
    const payload = await this.request(`/incidents/${encodeURIComponent(fireId)}/spatial-review/project-pick`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gltf_position: point }) }, options);
    if (!isRecord(payload)) throw new AdminApiError('parse', 'La projection du point 3D est invalide.');
    return { longitude: readFiniteNumber(payload.longitude, 'longitude'), latitude: readFiniteNumber(payload.latitude, 'latitude'), altitude_m: readFiniteNumber(payload.altitude_m, 'altitude_m') };
  }

  async reviewIncidentSpatialMarker(fireId: string, markerId: string, input: { action: 'validate' | 'reject'; expected_version: number; reason: string }, options: AdminRequestOptions): Promise<void> {
    if (input.reason.trim().length < 10) throw new AdminApiError('configuration', 'Le motif de revue est trop court.');
    const payload = await this.postJson(`/incidents/${encodeURIComponent(fireId)}/spatial-markers/${encodeURIComponent(markerId)}/review`, input, options);
    if (!isRecord(payload) || payload.marker_id !== markerId) throw new AdminApiError('parse', 'La réponse de revue du marqueur est invalide.');
  }

  async createActiveFireZoneRevision(fireId: string, input: { expected_latest_revision: number; valid_at: string; geometry_geojson: Readonly<Record<string, unknown>>; supporting_marker_ids: readonly string[]; geometry_origin?: 'HUMAN_AUTHORED' | 'SATELLITE_PRODUCT'; reason: string }, options: AdminRequestOptions): Promise<AdminActiveFireZoneRevision> {
    const payload = await this.postJson(`/incidents/${encodeURIComponent(fireId)}/active-zone-revisions`, input, options);
    try { return parseActiveFireZoneRevision(payload); }
    catch { throw new AdminApiError('parse', 'La révision de zone active retournée est invalide.'); }
  }

  async mergeActiveFireZoneRevisions(fireId: string, input: { expected_latest_revision: number; source_revision_ids: readonly string[]; valid_at: string; supporting_marker_ids: readonly string[]; reason: string }, options: AdminRequestOptions): Promise<AdminActiveFireZoneRevision> {
    const payload = await this.postJson(`/incidents/${encodeURIComponent(fireId)}/active-zone-revisions/merge`, input, options);
    try { return parseActiveFireZoneRevision(payload); }
    catch { throw new AdminApiError('parse', 'La fusion de zones retournée est invalide.'); }
  }

  async reviewActiveFireZoneRevision(fireId: string, revisionId: string, input: { action: 'approve' | 'reject'; expected_state: AdminActiveFireZoneRevision['review_state']; reason: string }, options: AdminRequestOptions): Promise<AdminActiveFireZoneRevision> {
    const payload = await this.postJson(`/incidents/${encodeURIComponent(fireId)}/active-zone-revisions/${encodeURIComponent(revisionId)}/review`, input, options);
    try { return parseActiveFireZoneRevision(payload); }
    catch { throw new AdminApiError('parse', 'La validation de zone retournée est invalide.'); }
  }

  async resolveIncidentAgentReview(fireId: string, reviewId: string, input: { action: 'approve' | 'reject'; expected_state: 'PENDING' | 'IN_REVIEW'; reason: string }, options: AdminRequestOptions): Promise<void> {
    const payload = await this.postJson(`/incidents/${encodeURIComponent(fireId)}/agent-reviews/${encodeURIComponent(reviewId)}/resolve`, input, options);
    if (!isRecord(payload) || payload.review_id !== reviewId) throw new AdminApiError('parse', 'La résolution de revue agentique est invalide.');
  }

  async updateSource(sourceKey: string, input: AdminSourceUpdateInput, options: AdminRequestOptions): Promise<void> {
    if (!sourceKey || sourceKey.length > 128 || input.reason.trim().length < 10 || input.public_transformations.length > 20) {
      throw new AdminApiError('configuration', 'La mise à jour de la source est invalide.');
    }
    const payload = await this.operatorPut(`/sources/${encodeURIComponent(sourceKey)}`, input, options);
    if (!isRecord(payload) || readString(payload.id, 'source.id', { max: 128 }) !== sourceKey) {
      throw new AdminApiError('parse', 'La réponse de mise à jour de la source est invalide.');
    }
  }

  async resolveObservation(observationId: string, input: { readonly action: 'attach' | 'create' | 'reject'; readonly expected_version: number; readonly reason: string; readonly target_fire_id?: string; readonly publish_spatial_evidence?: boolean }, options: AdminRequestOptions): Promise<{ observation_id: string; fire_id: string | null; episode_id: string | null; version: number }> {
    if (!observationId || observationId.length > 64 || input.reason.trim().length < 10) throw new AdminApiError('configuration', 'La résolution de l’observation est invalide.');
    const payload = await this.operatorPost(`/observations/${encodeURIComponent(observationId)}/resolve`, input, options);
    if (!isRecord(payload)) throw new AdminApiError('parse', 'La résolution de l’observation est invalide.');
    try { return { observation_id: readString(payload.observation_id, 'observation_id')!, fire_id: readString(payload.fire_id, 'fire_id', { nullable: true }), episode_id: readString(payload.episode_id, 'episode_id', { nullable: true }), version: readPositiveInteger(payload.version, 'version') }; }
    catch { throw new AdminApiError('parse', 'La résolution de l’observation est invalide.'); }
  }

  async transitionIncident(fireId: string, input: { readonly target_status: string; readonly expected_version: number; readonly reason: string; readonly public_note?: string; readonly validation_basis?: string }, options: AdminRequestOptions): Promise<{ episode_id: string; status: string; version: number }> {
    if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(fireId) || input.reason.trim().length < 10) throw new AdminApiError('configuration', 'La transition est invalide.');
    const payload = await this.operatorPost(`/incidents/${encodeURIComponent(fireId)}/transitions`, input, options);
    if (!isRecord(payload)) throw new AdminApiError('parse', 'La transition est invalide.');
    try { return { episode_id: readString(payload.episode_id, 'episode_id')!, status: readString(payload.status, 'status')!, version: readPositiveInteger(payload.version, 'version') }; }
    catch { throw new AdminApiError('parse', 'La transition est invalide.'); }
  }

  async updateOperationalProfile(fireId: string, input: { readonly expected_version: number; readonly estimated_area_ha: number | null; readonly evacuation_established: boolean; readonly evacuation_basis?: string; readonly reason: string }, options: AdminRequestOptions): Promise<AdminOperationalProfile> {
    if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(fireId) || input.reason.trim().length < 10 || (input.evacuation_established && !input.evacuation_basis?.trim())) throw new AdminApiError('configuration', 'Le profil opérationnel est invalide.');
    const payload = await this.operatorPost(`/incidents/${encodeURIComponent(fireId)}/operational-profile`, input, options);
    if (!isRecord(payload) || !Array.isArray(payload.eligibility_reasons)) throw new AdminApiError('parse', 'Le profil opérationnel retourné est invalide.');
    try {
      const reasons = payload.eligibility_reasons.map((reason) => readEnum(reason, 'eligibility_reason', ['area_threshold', 'established_evacuation'] as const));
      return { fire_id: readString(payload.fire_id, 'fire_id')!, episode_id: readString(payload.episode_id, 'episode_id')!, version: readPositiveInteger(payload.version, 'version'), estimated_area_ha: payload.estimated_area_ha === null ? null : readFiniteNumber(payload.estimated_area_ha, 'estimated_area_ha'), evacuation_established: Boolean(payload.evacuation_established), model_generation_eligible: Boolean(payload.model_generation_eligible), eligibility_reasons: reasons, terrain_bake_request_id: readString(payload.terrain_bake_request_id, 'terrain_bake_request_id', { nullable: true }) };
    } catch { throw new AdminApiError('parse', 'Le profil opérationnel retourné est invalide.'); }
  }

  async reviewPublicReport(
    reportId: string,
    input: { readonly state: Extract<AdminPublicReportState, 'CORRECTED' | 'REJECTED'>; readonly reason: string; readonly expected_version: number },
    options: AdminRequestOptions,
  ): Promise<{ report: AdminPublicReport; trace_id: string }> {
    if (!reportId || reportId.length > 96) throw new AdminApiError('configuration', 'Identifiant de signalement invalide.');
    const payload = await this.postJson(`/reports/${encodeURIComponent(reportId)}/review`, input, options);
    if (!isRecord(payload) || !hasExactKeys(payload, ['report', 'trace_id'])) throw new AdminApiError('parse', 'La réponse de revue est invalide.');
    try { return { report: parsePublicReport(payload.report), trace_id: parseTraceId(payload.trace_id) }; }
    catch { throw new AdminApiError('parse', 'La réponse de revue est invalide.'); }
  }
}
