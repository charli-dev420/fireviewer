import { upload } from '@vercel/blob/client';
import type { AdminApiClient, AdminIncidentMapCapture } from './adminApi';

type UploadOptions = Parameters<typeof upload>[2];
type CaptureUploader = (
  pathname: string,
  file: File,
  options: UploadOptions,
) => Promise<{ readonly pathname: string; readonly contentType?: string }>;

export async function uploadIncidentMapCapture(
  api: AdminApiClient,
  input: {
    readonly fireId: string;
    readonly zoneRevisionId: string;
    readonly image: Blob;
    readonly uploader?: CaptureUploader;
  },
): Promise<AdminIncidentMapCapture> {
  if (input.image.type !== 'image/jpeg') {
    throw new Error('La capture du viewer doit être une image JPEG.');
  }
  const file = new File([input.image], 'capture.jpg', { type: 'image/jpeg' });
  const grant = await api.createIncidentMapCaptureUploadGrant(input.fireId, {
    zone_revision_id: input.zoneRevisionId,
    size_bytes: file.size,
    media_type: 'image/jpeg',
  });
  if (!grant.allowed_content_types.includes(file.type) || file.size > grant.maximum_file_size_bytes) {
    throw new Error('La capture dépasse le contrat du stockage privé.');
  }
  const pathname = `${grant.pathname_prefix}/capture.jpg`;
  const result = await (input.uploader ?? upload)(pathname, file, {
    access: 'private',
    handleUploadUrl: api.getBlobUploadTokenUrl(),
    headers: { 'X-Blob-Upload-Grant': grant.upload_grant },
    clientPayload: input.zoneRevisionId,
    contentType: 'image/jpeg',
    multipart: true,
  });
  if (result.pathname !== pathname || (result.contentType && result.contentType !== file.type)) {
    throw new Error('Le stockage a retourné une capture différente de celle autorisée.');
  }
  return api.finalizeIncidentMapCaptureFromBlob(input.fireId, {
    upload_id: grant.upload_id,
    zone_revision_id: input.zoneRevisionId,
    object: {
      path: 'capture.jpg',
      pathname: result.pathname,
      size_bytes: file.size,
      content_type: 'image/jpeg',
    },
  });
}
