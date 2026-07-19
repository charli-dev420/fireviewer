import { upload } from '@vercel/blob/client';
import type { AdminApiClient, AdminSourcePackageResult } from './adminApi';

type UploadOptions = Parameters<typeof upload>[2];
type SourceUploader = (pathname: string, file: File, options: UploadOptions) => Promise<unknown>;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
};

function extension(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function safeFilename(name: string, index: number): string {
  const normalized = name.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  return `${String(index + 1).padStart(4, '0')}-${normalized || `source-${index + 1}`}`;
}

function sourceContentType(file: File): string {
  const expected = CONTENT_TYPES[extension(file.name)];
  if (!expected) throw new Error(`Type de fichier non pris en charge : ${file.name}`);
  return expected;
}

export async function uploadIncidentSourcePackage(
  api: AdminApiClient,
  input: {
    readonly fireId: string;
    readonly files: readonly File[];
    readonly localDate: string;
    readonly locationHint: string | null;
    readonly idempotencyKey: string;
    readonly onProgress?: (completed: number, total: number) => void;
    readonly uploader?: SourceUploader;
  },
): Promise<AdminSourcePackageResult> {
  if (!input.files.length) throw new Error('Sélectionnez au moins un fichier.');
  const totalSize = input.files.reduce((total, file) => total + file.size, 0);
  const contentTypes = input.files.map(sourceContentType);
  const grant = await api.openIncidentSourcePackage(
    input.fireId,
    {
      file_count: input.files.length,
      total_size_bytes: totalSize,
      known_start_date: input.localDate,
      location_hint: input.locationHint,
      authorize_private_analysis: true,
    },
    { idempotencyKey: input.idempotencyKey },
  );
  const allowed = new Set(grant.allowed_content_types);
  input.files.forEach((file, index) => {
    if (file.size > grant.maximum_file_size_bytes) {
      throw new Error(`Fichier trop volumineux : ${file.name}`);
    }
    if (!allowed.has(contentTypes[index]!)) {
      throw new Error(`Type refusé par le stockage privé : ${file.name}`);
    }
  });
  const uploader = input.uploader ?? upload;
  let nextIndex = 0;
  let completed = 0;
  const worker = async () => {
    while (nextIndex < input.files.length) {
      const index = nextIndex;
      nextIndex += 1;
      const file = input.files[index]!;
      await uploader(`${grant.pathname_prefix}/${safeFilename(file.name, index)}`, file, {
        access: 'private',
        handleUploadUrl: api.getBlobUploadTokenUrl(),
        headers: { 'X-Blob-Upload-Grant': grant.upload_grant },
        clientPayload: grant.package_id,
        contentType: contentTypes[index],
        multipart: true,
      });
      completed += 1;
      input.onProgress?.(completed, input.files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, input.files.length) }, worker));
  return api.finalizeIncidentSourcePackage(grant.package_id, {
    idempotencyKey: `${input.idempotencyKey}:finalize`,
  });
}
