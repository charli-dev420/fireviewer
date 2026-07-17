import { upload } from '@vercel/blob/client';
import type {
  AdminApiClient,
  AdminBlobObjectReference,
  AdminBlobUploadGrant,
  AdminSpatialPackageImport,
} from './adminApi';

const PACKAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,95}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ASSET_PREFIXES = ['assets/', 'terrain/', 'vectors/'] as const;
const REQUIRED_PATHS = ['package-manifest.json', 'catalog.json'] as const;
const DEFAULT_UPLOAD_CONCURRENCY = 6;
const DEFAULT_UPLOAD_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 400;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.glb': 'model/gltf-binary',
  '.fwtile': 'application/vnd.fireviewer.tile',
  '.fwterrain': 'application/vnd.fireviewer.terrain',
};

interface CatalogAsset {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface PreparedPackageFile {
  readonly path: string;
  readonly file: File;
  readonly contentType: string;
}

export interface PreparedSpatialPackage {
  readonly packageId: string;
  readonly files: readonly PreparedPackageFile[];
  readonly totalSizeBytes: number;
  readonly assetCount: number;
}

export interface SpatialPackageUploadProgress {
  readonly phase: 'uploading' | 'finalizing';
  readonly fileIndex: number;
  readonly fileCount: number;
  readonly currentPath: string | null;
  readonly uploadedBytes: number;
  readonly totalSizeBytes: number;
  readonly percentage: number;
}

interface BlobUploadOptions {
  readonly access: 'private';
  readonly handleUploadUrl: string;
  readonly headers: Record<string, string>;
  readonly clientPayload: string;
  readonly contentType: string;
  readonly multipart: true;
  readonly abortSignal?: AbortSignal;
  readonly onUploadProgress: (event: { loaded: number; total: number; percentage: number }) => void;
}

export type BlobUploader = (
  pathname: string,
  file: File,
  options: BlobUploadOptions,
) => Promise<{ readonly pathname: string; readonly contentType: string }>;

function extension(path: string): string {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index).toLowerCase();
}

function contentType(path: string): string {
  const result = CONTENT_TYPES[extension(path)];
  if (!result) throw new Error(`Type de fichier non pris en charge : ${path}`);
  return result;
}

function safePath(value: string): string {
  const normalized = value.replace(/^\.\//, '');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.includes('\\')
    || normalized.includes('\0')
    || normalized.includes('?')
    || normalized.includes('#')
    || normalized.includes(':')
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Chemin de package interdit : ${value || '(vide)'}`);
  }
  return normalized;
}

function selectedPath(file: File): string {
  const relative = file.webkitRelativePath || file.name;
  return safePath(relative);
}

function commonRoot(paths: readonly string[]): string | null {
  if (paths.length === 0 || paths.some((path) => !path.includes('/'))) return null;
  const root = paths[0]!.split('/')[0]!;
  return paths.every((path) => path.startsWith(`${root}/`)) ? root : null;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} doit contenir un objet JSON.`);
  }
  return value as Record<string, unknown>;
}

async function readJson(file: File, label: string): Promise<Record<string, unknown>> {
  try {
    return asRecord(JSON.parse(await file.text()), label);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} n’est pas un JSON valide.`);
    throw error;
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value <= 0) {
    throw new Error(`${label} doit être un entier positif.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new Error(`${label} ne contient pas une empreinte SHA-256 valide.`);
  }
  return value;
}

function collectCatalogAssets(catalog: Record<string, unknown>): CatalogAsset[] {
  const entries: CatalogAsset[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const pathValue = record.path;
    if (typeof pathValue === 'string' && ASSET_PREFIXES.some((prefix) => pathValue.startsWith(prefix))) {
      const path = safePath(pathValue);
      contentType(path);
      entries.push({
        path,
        sha256: digest(record.sha256, `Empreinte de ${path}`),
        sizeBytes: positiveInteger(record.byte_count ?? record.size_bytes, `Taille de ${path}`),
      });
    }
    Object.values(record).forEach(visit);
  };
  visit(catalog);
  if (entries.length === 0) throw new Error('catalog.json ne déclare aucun asset spatial pris en charge.');
  const paths = entries.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error('catalog.json déclare un chemin plusieurs fois.');
  return entries;
}

async function sha256Hex(file: File): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function mapSelectedFiles(files: readonly File[], expectedPaths: readonly string[]): Map<string, File> {
  const selected = files.map((file) => ({ file, path: selectedPath(file) }));
  const root = commonRoot(selected.map((item) => item.path));
  const expectedByBasename = new Map<string, string[]>();
  for (const path of expectedPaths) {
    const basename = path.split('/').at(-1)!;
    expectedByBasename.set(basename, [...(expectedByBasename.get(basename) ?? []), path]);
  }
  const mapped = new Map<string, File>();
  for (const item of selected) {
    let path = root ? item.path.slice(root.length + 1) : item.path;
    if (!path.includes('/')) {
      const matches = expectedByBasename.get(path) ?? [];
      if (matches.length === 1) path = matches[0]!;
    }
    path = safePath(path);
    if (!expectedPaths.includes(path)) throw new Error(`Fichier supplémentaire non déclaré : ${path}`);
    if (mapped.has(path)) throw new Error(`Fichier sélectionné plusieurs fois : ${path}`);
    mapped.set(path, item.file);
  }
  return mapped;
}

export async function prepareSpatialPackage(
  selectedFiles: FileList | readonly File[],
  expectedZoneId: string,
  expectedRevision: number,
): Promise<PreparedSpatialPackage> {
  const files = Array.from(selectedFiles);
  if (files.length < 3) throw new Error('Le dossier doit contenir le manifeste, le catalogue et au moins un asset.');

  const initiallySelected = files.map((file) => ({ file, path: selectedPath(file) }));
  const root = commonRoot(initiallySelected.map((item) => item.path));
  const metadataByName = new Map<string, File>();
  for (const item of initiallySelected) {
    const path = root ? item.path.slice(root.length + 1) : item.path;
    if (REQUIRED_PATHS.includes(path as (typeof REQUIRED_PATHS)[number])) metadataByName.set(path, item.file);
    else if (!path.includes('/') && REQUIRED_PATHS.includes(item.file.name as (typeof REQUIRED_PATHS)[number])) metadataByName.set(item.file.name, item.file);
  }
  const manifestFile = metadataByName.get('package-manifest.json');
  const catalogFile = metadataByName.get('catalog.json');
  if (!manifestFile || !catalogFile) {
    throw new Error('Le dossier doit contenir package-manifest.json et catalog.json à sa racine.');
  }

  const [manifest, catalog] = await Promise.all([
    readJson(manifestFile, 'package-manifest.json'),
    readJson(catalogFile, 'catalog.json'),
  ]);
  const packageId = manifest.package_id;
  if (typeof packageId !== 'string' || !PACKAGE_ID_RE.test(packageId)) {
    throw new Error('package-manifest.json contient un package_id invalide.');
  }
  const catalogReference = asRecord(manifest.catalog, 'Référence catalog.json');
  if (catalogReference.path !== 'catalog.json') {
    throw new Error('package-manifest.json doit référencer catalog.json.');
  }
  if (positiveInteger(catalogReference.byte_count, 'Taille de catalog.json') !== catalogFile.size) {
    throw new Error('La taille de catalog.json diffère du manifeste.');
  }
  if (digest(catalogReference.sha256, 'Empreinte de catalog.json') !== await sha256Hex(catalogFile)) {
    throw new Error('L’empreinte de catalog.json diffère du manifeste.');
  }
  if (!Array.isArray(manifest.zones) || !manifest.zones.some((zone) => {
    if (!zone || typeof zone !== 'object') return false;
    const record = zone as Record<string, unknown>;
    return record.zone_id === expectedZoneId && record.revision_id === `R${expectedRevision}`;
  })) {
    throw new Error('Le manifeste ne cible pas cette zone et cette révision.');
  }

  const assets = collectCatalogAssets(catalog);
  const expectedPaths = [...REQUIRED_PATHS, ...assets.map((asset) => asset.path)];
  const mapped = mapSelectedFiles(files, expectedPaths);
  const missing = expectedPaths.filter((path) => !mapped.has(path));
  if (missing.length) throw new Error(`Fichier déclaré absent : ${missing[0]}`);
  for (const asset of assets) {
    if (mapped.get(asset.path)!.size !== asset.sizeBytes) {
      throw new Error(`La taille de ${asset.path} diffère de catalog.json.`);
    }
  }
  const preparedFiles = expectedPaths.map((path) => ({
    path,
    file: mapped.get(path)!,
    contentType: contentType(path),
  }));
  return {
    packageId,
    files: preparedFiles,
    totalSizeBytes: preparedFiles.reduce((total, item) => total + item.file.size, 0),
    assetCount: assets.length,
  };
}

function defaultUploader(pathname: string, file: File, options: BlobUploadOptions) {
  return upload(pathname, file, options);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'erreur réseau inconnue';
}

async function retryDelay(delayMs: number, attempt: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, delayMs * attempt);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Upload annulé.', 'AbortError'));
    }, { once: true });
  });
}

export async function uploadPreparedSpatialPackage(
  api: AdminApiClient,
  zoneId: string,
  revision: number,
  prepared: PreparedSpatialPackage,
  reason: string,
  idempotencyKey: string,
  onProgress: (progress: SpatialPackageUploadProgress) => void,
  options: {
    readonly signal?: AbortSignal;
    readonly uploader?: BlobUploader;
    readonly concurrency?: number;
    readonly uploadAttempts?: number;
    readonly retryDelayMs?: number;
  } = {},
): Promise<AdminSpatialPackageImport> {
  const grant: AdminBlobUploadGrant = await api.createSpatialPackageUploadGrant(
    zoneId,
    revision,
    {
      package_id: prepared.packageId,
      file_count: prepared.files.length,
      total_size_bytes: prepared.totalSizeBytes,
    },
    { signal: options.signal },
  );
  const uploader = options.uploader ?? defaultUploader;
  const concurrency = Math.max(1, Math.min(8, Math.trunc(options.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY)));
  const uploadAttempts = Math.max(1, Math.min(5, Math.trunc(options.uploadAttempts ?? DEFAULT_UPLOAD_ATTEMPTS)));
  const retryDelayMs = Math.max(0, Math.trunc(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
  const uploaded = new Array<AdminBlobObjectReference | undefined>(prepared.files.length);
  const inFlightBytes = new Array<number>(prepared.files.length).fill(0);
  let uploadedBytes = 0;
  let completedCount = 0;
  let nextIndex = 0;
  let terminalError: unknown = null;

  const emitProgress = (index: number, path: string): void => {
    const boundedBytes = Math.min(prepared.totalSizeBytes, uploadedBytes);
    onProgress({
      phase: 'uploading',
      fileIndex: completedCount,
      fileCount: prepared.files.length,
      currentPath: path,
      uploadedBytes: boundedBytes,
      totalSizeBytes: prepared.totalSizeBytes,
      percentage: Math.round((boundedBytes / prepared.totalSizeBytes) * 100),
    });
  };

  const uploadOne = async (index: number): Promise<void> => {
    const item = prepared.files[index]!;
    const pathname = `${grant.pathname_prefix}/${item.path}`;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= uploadAttempts; attempt += 1) {
      if (options.signal?.aborted) throw new DOMException('Upload annulé.', 'AbortError');
      if (inFlightBytes[index]) {
        uploadedBytes -= inFlightBytes[index]!;
        inFlightBytes[index] = 0;
        emitProgress(index, item.path);
      }
      try {
        const result = await uploader(pathname, item.file, {
          access: 'private',
          handleUploadUrl: api.getBlobUploadTokenUrl(),
          headers: { 'X-Blob-Upload-Grant': grant.upload_grant },
          clientPayload: prepared.packageId,
          contentType: item.contentType,
          multipart: true,
          abortSignal: options.signal,
          onUploadProgress: ({ loaded }) => {
            const boundedLoaded = Math.max(0, Math.min(item.file.size, loaded));
            uploadedBytes += boundedLoaded - inFlightBytes[index]!;
            inFlightBytes[index] = boundedLoaded;
            emitProgress(index, item.path);
          },
        });
        if (result.pathname !== pathname || result.contentType !== item.contentType) {
          throw new Error(`Vercel Blob a retourné des métadonnées inattendues pour ${item.path}.`);
        }
        uploadedBytes += item.file.size - inFlightBytes[index]!;
        inFlightBytes[index] = item.file.size;
        uploaded[index] = {
          path: item.path,
          pathname: result.pathname,
          size_bytes: item.file.size,
          content_type: item.contentType,
        };
        completedCount += 1;
        emitProgress(index, item.path);
        return;
      } catch (error) {
        lastError = error;
        if (isAbortError(error) || attempt === uploadAttempts) break;
        await retryDelay(retryDelayMs, attempt, options.signal);
      }
    }
    if (isAbortError(lastError)) throw lastError;
    throw new Error(
      `Échec de l’envoi de ${item.path} après ${uploadAttempts} tentatives : ${errorMessage(lastError)}.`,
      { cause: lastError },
    );
  };

  const worker = async (): Promise<void> => {
    while (terminalError === null) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= prepared.files.length) return;
      try {
        await uploadOne(index);
      } catch (error) {
        terminalError = error;
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(concurrency, prepared.files.length) },
    () => worker(),
  ));
  if (terminalError !== null) throw terminalError;
  const finalizedObjects = uploaded.map((item, index) => {
    if (!item) throw new Error(`Objet uploadé manquant : ${prepared.files[index]!.path}.`);
    return item;
  });
  onProgress({
    phase: 'finalizing',
    fileIndex: prepared.files.length,
    fileCount: prepared.files.length,
    currentPath: null,
    uploadedBytes: prepared.totalSizeBytes,
    totalSizeBytes: prepared.totalSizeBytes,
    percentage: 100,
  });
  return api.finalizeSpatialPackageFromBlob(
    zoneId,
    revision,
    {
      upload_id: grant.upload_id,
      package_id: prepared.packageId,
      reason,
      objects: finalizedObjects,
    },
    { idempotencyKey, signal: options.signal },
  );
}
