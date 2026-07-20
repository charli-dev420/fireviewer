import { upload } from '@vercel/blob/client';
import { getViewerManifestApiOrigin } from './manifestClient';

export type PublicContributionKind = 'new_fire' | 'incident_evidence';
export type PublicContributionState = 'OPEN' | 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

export interface PublicContributionAccess {
  readonly contributionId: string;
  readonly trackingToken: string;
  readonly fireId: string | null;
  readonly storedAt: string;
}

export interface PublicContributionStatus {
  readonly contribution_id: string;
  readonly kind: PublicContributionKind;
  readonly fire_id: string | null;
  readonly state: PublicContributionState;
  readonly received_at: string | null;
  readonly reviewed_at: string | null;
  readonly review_reason: string | null;
  readonly purge_after: string;
  readonly media_count: number;
  readonly location_label: string | null;
  readonly observation_type: string;
  readonly observed_at: string;
  readonly version: number;
}

export interface PublicContributionInput {
  readonly kind: PublicContributionKind;
  readonly fireId: string | null;
  readonly location: {
    readonly mode: 'place' | 'device' | 'manual';
    readonly label: string | null;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly uncertaintyM: number | null;
  };
  readonly observation: {
    readonly type: string;
    readonly observedAt: string;
    readonly direct: boolean;
    readonly description: string;
  };
  readonly media: File | null;
  readonly mediaCapturedAt: string | null;
  readonly mediaDirection: string | null;
  readonly consents: {
    readonly retainEvidence: boolean;
    readonly publicDisplay: boolean;
    readonly spatialDisplay: boolean;
  };
  readonly contactEmail: string | null;
}

interface OpenResponse {
  readonly contribution_id: string;
  readonly state: PublicContributionState;
  readonly tracking_token: string;
  readonly upload: {
    readonly package_id: string;
    readonly pathname_prefix: string;
    readonly upload_grant: string;
    readonly maximum_file_size_bytes: number;
    readonly allowed_content_types: readonly string[];
  } | null;
  readonly replayed: boolean;
}

interface ContributionEnvelope {
  readonly contribution: PublicContributionStatus;
}

type UploadOptions = Parameters<typeof upload>[2];
type PublicUploader = (pathname: string, file: File, options: UploadOptions) => Promise<unknown>;

const ACCESS_STORAGE_KEY = 'fw:contribution-access:v1';
const IMAGE_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

export class PublicContributionApiError extends Error {
  constructor(readonly status: number | null, message: string) {
    super(message);
    this.name = 'PublicContributionApiError';
  }
}

function apiOrigin(): string {
  const origin = getViewerManifestApiOrigin();
  if (!origin) throw new PublicContributionApiError(null, 'Le service de contribution n’est pas configuré.');
  return origin;
}

function extension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index).toLowerCase() : '';
}

function contentType(file: File): string {
  const expected = IMAGE_TYPES.get(extension(file.name));
  if (!expected || (file.type && file.type !== expected)) {
    throw new PublicContributionApiError(null, 'Cette image doit être un fichier JPG, PNG ou WebP valide.');
  }
  return expected;
}

function safeFilename(filename: string): string {
  const normalized = filename.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  return `0001-${normalized || `preuve${extension(filename)}`}`;
}

function parseStatus(value: unknown): PublicContributionStatus {
  if (!value || typeof value !== 'object') throw new PublicContributionApiError(null, 'Le reçu de contribution est invalide.');
  const status = value as Partial<PublicContributionStatus>;
  if (
    typeof status.contribution_id !== 'string'
    || !['new_fire', 'incident_evidence'].includes(String(status.kind))
    || !['OPEN', 'PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(String(status.state))
    || typeof status.observation_type !== 'string'
    || typeof status.observed_at !== 'string'
    || typeof status.purge_after !== 'string'
  ) {
    throw new PublicContributionApiError(null, 'Le reçu de contribution est invalide.');
  }
  return status as PublicContributionStatus;
}

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let detail = fallback;
    try {
      const payload = await response.json() as { detail?: unknown };
      if (typeof payload.detail === 'string') detail = payload.detail;
    } catch {
      // The stable fallback remains actionable when the server did not return JSON.
    }
    throw new PublicContributionApiError(response.status, detail);
  }
  return response.json() as Promise<T>;
}

function readAccessList(): PublicContributionAccess[] {
  try {
    const stored = JSON.parse(localStorage.getItem(ACCESS_STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.filter((entry): entry is PublicContributionAccess => {
      if (!entry || typeof entry !== 'object') return false;
      const record = entry as Partial<PublicContributionAccess>;
      return typeof record.contributionId === 'string' && typeof record.trackingToken === 'string';
    });
  } catch {
    return [];
  }
}

export function readPublicContributionAccess(contributionId: string): PublicContributionAccess | null {
  return readAccessList().find((entry) => entry.contributionId === contributionId) ?? null;
}

function storeAccess(access: PublicContributionAccess): void {
  const previous = readAccessList().filter((entry) => entry.contributionId !== access.contributionId);
  localStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify([access, ...previous].slice(0, 20)));
}

function deleteAccess(contributionId: string): void {
  localStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify(readAccessList().filter((entry) => entry.contributionId !== contributionId)));
}

export function createPublicContributionIdempotencyKey(): string {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `public-${random}`;
}

async function finalize(opened: OpenResponse): Promise<PublicContributionStatus> {
  const response = await fetch(`${apiOrigin()}/api/v1/contributions/${encodeURIComponent(opened.contribution_id)}/finalize`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: { Authorization: `Bearer ${opened.tracking_token}`, Accept: 'application/json' },
  });
  const envelope = await responseJson<ContributionEnvelope>(response, 'La contribution n’a pas pu être finalisée.');
  return parseStatus(envelope.contribution);
}

export async function submitPublicContribution(
  input: PublicContributionInput,
  idempotencyKey: string,
  uploader: PublicUploader = upload,
): Promise<PublicContributionStatus> {
  const declaredType = input.media ? contentType(input.media) : null;
  const response = await fetch(`${apiOrigin()}/api/v1/contributions/open`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      kind: input.kind,
      fire_id: input.fireId,
      location: {
        mode: input.location.mode,
        label: input.location.label,
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        uncertainty_m: input.location.uncertaintyM,
      },
      observation: {
        observation_type: input.observation.type,
        observed_at: input.observation.observedAt,
        direct_observation: input.observation.direct,
        description: input.observation.description,
      },
      media: input.media ? {
        filename: input.media.name,
        content_type: declaredType,
        size_bytes: input.media.size,
        captured_at: input.mediaCapturedAt,
        direction: input.mediaDirection,
      } : null,
      consents: {
        private_analysis: true,
        retain_evidence: input.consents.retainEvidence,
        public_display: input.consents.publicDisplay,
        spatial_display: input.consents.spatialDisplay,
      },
      contact_email: input.contactEmail,
    }),
  });
  const opened = await responseJson<OpenResponse>(response, 'La contribution n’a pas pu être ouverte.');
  if (typeof opened.contribution_id !== 'string' || typeof opened.tracking_token !== 'string') {
    throw new PublicContributionApiError(null, 'Le reçu d’ouverture est invalide.');
  }
  storeAccess({
    contributionId: opened.contribution_id,
    trackingToken: opened.tracking_token,
    fireId: input.fireId,
    storedAt: new Date().toISOString(),
  });
  if (!input.media || !opened.upload) {
    return loadPublicContribution(opened.contribution_id, opened.tracking_token);
  }
  if (opened.replayed) {
    try {
      return await finalize(opened);
    } catch (error) {
      if (!(error instanceof PublicContributionApiError) || error.status !== 409) throw error;
    }
  }
  if (input.media.size > opened.upload.maximum_file_size_bytes || !opened.upload.allowed_content_types.includes(declaredType!)) {
    throw new PublicContributionApiError(null, 'Cette image est refusée par le stockage privé.');
  }
  await uploader(`${opened.upload.pathname_prefix}/${safeFilename(input.media.name)}`, input.media, {
    access: 'private',
    handleUploadUrl: `${apiOrigin()}/api/v1/contributions/blob-upload-token`,
    headers: { 'X-Blob-Upload-Grant': opened.upload.upload_grant },
    clientPayload: opened.upload.package_id,
    contentType: declaredType!,
    multipart: true,
  });
  return finalize(opened);
}

export async function loadPublicContribution(
  contributionId: string,
  trackingToken: string,
  signal?: AbortSignal,
): Promise<PublicContributionStatus> {
  const response = await fetch(`${apiOrigin()}/api/v1/contributions/${encodeURIComponent(contributionId)}`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    headers: { Authorization: `Bearer ${trackingToken}`, Accept: 'application/json' },
    signal,
  });
  const envelope = await responseJson<ContributionEnvelope>(response, 'Le suivi de contribution est indisponible.');
  return parseStatus(envelope.contribution);
}

export async function withdrawPublicContribution(
  contributionId: string,
  trackingToken: string,
): Promise<PublicContributionStatus> {
  const response = await fetch(`${apiOrigin()}/api/v1/contributions/${encodeURIComponent(contributionId)}/withdraw`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: { Authorization: `Bearer ${trackingToken}`, Accept: 'application/json' },
  });
  const envelope = await responseJson<ContributionEnvelope>(response, 'Le retrait de la contribution a échoué.');
  const status = parseStatus(envelope.contribution);
  if (status.state === 'WITHDRAWN') deleteAccess(contributionId);
  return status;
}
