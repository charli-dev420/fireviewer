import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SpatialPackageVerificationError,
  validateSpatialCatalog,
  verifySpatialPackage,
} from './spatial-package-verifier.mjs';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const TAR_BLOCK_SIZE = 512;
const TAR_TRAILER_SIZE = TAR_BLOCK_SIZE * 2;
const RELEASE_LOCK_SCHEMA_VERSION = '1.0';
const DEFAULT_PACKAGE_ROOT = resolve(currentDirectory, '../public/maps/fireviewer-die-pontaix-r1-v4');
const DEFAULT_RELEASE_LOCK = resolve(
  currentDirectory,
  '../../../contracts/spatial/releases/fireviewer-die-pontaix-r1-v4.release-lock.json',
);
const DEFAULT_IGN_ATTRIBUTION = resolve(
  currentDirectory,
  '../../../contracts/spatial/releases/ATTRIBUTION-IGN.txt',
);

export const SPATIAL_RELEASE_DEFAULTS = Object.freeze({
  packageRoot: DEFAULT_PACKAGE_ROOT,
  releaseLockPath: DEFAULT_RELEASE_LOCK,
  outputDirectory: resolve(process.env.TEMP || process.env.TMP || '.', 'fireviewer-spatial-release'),
});

export class SpatialReleaseError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'SpatialReleaseError';
  }
}

function fail(message, options) {
  throw new SpatialReleaseError(message, options);
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} doit être un objet.`);
  return value;
}

function asString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} doit être une chaîne non vide.`);
  return value;
}

function asInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`${label} doit être un entier supérieur ou égal à ${minimum}.`);
  return value;
}

function asSha256(value, label) {
  const hash = asString(value, label).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(`${label} doit être une empreinte SHA-256 hexadécimale.`);
  return hash;
}

function safeRelativePath(value, label) {
  const path = asString(value, label);
  const segments = path.split('/');
  if (
    path.startsWith('/') ||
    path.startsWith('\\') ||
    path.includes('\\') ||
    path.includes('\0') ||
    /^[a-z]:/i.test(path) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !/^[A-Za-z0-9._/-]+$/.test(path)
  ) {
    fail(`${label} doit être un chemin relatif POSIX sûr.`);
  }
  return path;
}

function isWithin(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot !== '' && !fromRoot.startsWith('..') && !isAbsolute(fromRoot);
}

function resolveInside(root, relativePath, label) {
  const safePath = safeRelativePath(relativePath, label);
  const candidate = resolve(root, ...safePath.split('/'));
  if (!isWithin(root, candidate)) fail(`${label} sort du dossier autorisé.`);
  return candidate;
}

async function regularFile(filePath, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    fail(`${label} est introuvable : ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (!info.isFile() || info.isSymbolicLink()) fail(`${label} doit être un fichier régulier.`);
  return info;
}

async function directoryOrAbsent(directoryPath, label) {
  try {
    const info = await lstat(directoryPath);
    if (!info.isDirectory() || info.isSymbolicLink()) fail(`${label} doit être un dossier réel.`);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function tarPadding(byteCount) {
  return (TAR_BLOCK_SIZE - (byteCount % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
}

function writeTarNumber(buffer, offset, length, value, label) {
  const integer = asInteger(value, label, 0);
  const encoded = integer.toString(8);
  if (encoded.length > length - 1) fail(`${label} ne tient pas dans l’en-tête TAR.`);
  buffer.fill(0, offset, offset + length);
  buffer.write(encoded.padStart(length - 1, '0'), offset, length - 1, 'ascii');
}

function writeAscii(buffer, offset, length, value, label) {
  if (!/^[\x20-\x7e]*$/.test(value)) fail(`${label} doit être ASCII imprimable.`);
  const encoded = Buffer.from(value, 'ascii');
  if (encoded.length > length) fail(`${label} est trop long pour l’en-tête TAR.`);
  encoded.copy(buffer, offset);
}

function splitTarPath(path) {
  const safePath = safeRelativePath(path, 'chemin TAR');
  if (Buffer.byteLength(safePath, 'ascii') <= 100) return { name: safePath, prefix: '' };
  const segments = safePath.split('/');
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const prefix = segments.slice(0, index).join('/');
    const name = segments.slice(index).join('/');
    if (Buffer.byteLength(prefix, 'ascii') <= 155 && Buffer.byteLength(name, 'ascii') <= 100) {
      return { name, prefix };
    }
  }
  fail(`Le chemin TAR est trop long : ${safePath}.`);
}

export function createTarHeader(path, byteCount) {
  const { name, prefix } = splitTarPath(path);
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  writeAscii(header, 0, 100, name, 'nom TAR');
  writeTarNumber(header, 100, 8, 0o644, 'mode TAR');
  writeTarNumber(header, 108, 8, 0, 'uid TAR');
  writeTarNumber(header, 116, 8, 0, 'gid TAR');
  writeTarNumber(header, 124, 12, byteCount, 'taille TAR');
  writeTarNumber(header, 136, 12, 0, 'mtime TAR');
  header.fill(0x20, 148, 156);
  header[156] = 0;
  header.write('ustar\0', 257, 6, 'ascii');
  writeAscii(header, 263, 2, '00', 'version TAR');
  writeAscii(header, 345, 155, prefix, 'préfixe TAR');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const encoded = checksum.toString(8).padStart(6, '0');
  header.write(encoded, 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function verifyTarChecksum(header) {
  const storedText = header.subarray(148, 154).toString('ascii').replace(/\0.*$/u, '').trim();
  if (!/^[0-7]+$/u.test(storedText)) fail('En-tête TAR sans checksum octal valide.');
  const stored = Number.parseInt(storedText, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (stored !== actual) fail('Checksum TAR incohérent.');
}

function readNullTerminatedAscii(buffer, start, length, label) {
  const value = buffer.subarray(start, start + length);
  const terminator = value.indexOf(0);
  const trimmed = value.subarray(0, terminator === -1 ? value.length : terminator);
  if (trimmed.some((byte) => byte < 0x20 || byte > 0x7e)) fail(`${label} contient des octets non ASCII.`);
  return trimmed.toString('ascii');
}

function readTarNumber(header, offset, length, label) {
  const field = header.subarray(offset, offset + length);
  if (field[0] & 0x80) fail(`${label} utilise un encodage TAR binaire non autorisé.`);
  const text = field.toString('ascii').replace(/\0.*$/u, '').trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/u.test(text)) fail(`${label} doit être un entier octal.`);
  const value = Number.parseInt(text, 8);
  return asInteger(value, label, 0);
}

function parseTarHeader(header) {
  verifyTarChecksum(header);
  const magic = header.subarray(257, 263).toString('ascii');
  const version = header.subarray(263, 265).toString('ascii');
  if (magic !== 'ustar\0' || version !== '00') fail('Le format TAR doit être USTAR version 00.');
  const type = header[156];
  if (type !== 0 && type !== 0x30) fail(`Type TAR refusé : ${type}. Les liens et entrées spéciales sont interdits.`);
  const name = readNullTerminatedAscii(header, 0, 100, 'nom TAR');
  const prefix = readNullTerminatedAscii(header, 345, 155, 'préfixe TAR');
  if (name === '') fail('Entrée TAR sans nom.');
  const path = prefix === '' ? name : `${prefix}/${name}`;
  return {
    path: safeRelativePath(path, 'chemin TAR'),
    byteCount: readTarNumber(header, 124, 12, 'taille TAR'),
  };
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await new Promise((resolvePromise, reject) => {
    const onDrain = () => {
      stream.off('error', onError);
      resolvePromise();
    };
    const onError = (error) => {
      stream.off('drain', onDrain);
      reject(error);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function closeWritable(stream) {
  stream.end();
  await finished(stream);
}

function expectedTarByteCount(entries) {
  return (
    TAR_TRAILER_SIZE +
    entries.reduce((total, entry) => total + TAR_BLOCK_SIZE + entry.byteCount + tarPadding(entry.byteCount), 0)
  );
}

function normaliseEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) fail('L’archive doit contenir au moins un asset.');
  const seen = new Set();
  return entries
    .map((entry, index) => {
      const source = asObject(entry, `entries[${index}]`);
      const path = safeRelativePath(source.path, `entries[${index}].path`);
      if (!path.startsWith('terrain/') && !path.startsWith('vectors/')) {
        fail(`entries[${index}].path doit appartenir à terrain/ ou vectors/.`);
      }
      if (seen.has(path)) fail(`Entrée TAR dupliquée : ${path}.`);
      seen.add(path);
      return {
        path,
        absolutePath: asString(source.absolutePath, `entries[${index}].absolutePath`),
        byteCount: asInteger(source.byteCount, `entries[${index}].byteCount`, 1),
        sha256: asSha256(source.sha256, `entries[${index}].sha256`),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function atomicWriteFile(filePath, contents) {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${randomBytes(12).toString('hex')}.partial`);
  try {
    await writeFile(temporaryPath, contents, { flag: 'wx' });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Creates a deterministic USTAR + gzip archive.  It deliberately contains only
 * assets, never the mutable catalogue/manifest files that describe them.
 */
export async function createDeterministicTarGz({ entries, archivePath, overwrite = false }) {
  const normalised = normaliseEntries(entries);
  const destination = resolve(archivePath);
  const destinationDirectory = dirname(destination);
  await mkdir(destinationDirectory, { recursive: true });
  if (!overwrite) {
    try {
      await lstat(destination);
      fail(`L’archive existe déjà : ${destination}. Utiliser --overwrite pour la remplacer.`);
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error;
    }
  }

  for (const entry of normalised) {
    const info = await regularFile(entry.absolutePath, `Asset source ${entry.path}`);
    if (info.size !== entry.byteCount) fail(`Taille source incohérente pour ${entry.path}.`);
    const hash = await hashFile(entry.absolutePath);
    if (hash !== entry.sha256) fail(`SHA-256 source incohérent pour ${entry.path}.`);
  }

  const temporaryPath = join(destinationDirectory, `.${randomBytes(12).toString('hex')}.partial.tar.gz`);
  const gzip = createGzip({ level: 9, mtime: 0 });
  const output = createWriteStream(temporaryPath, { flags: 'wx', mode: 0o644 });
  const outputFinished = finished(output);
  gzip.pipe(output);
  let failed = false;
  try {
    for (const entry of normalised) {
      await writeChunk(gzip, createTarHeader(entry.path, entry.byteCount));
      for await (const chunk of createReadStream(entry.absolutePath)) await writeChunk(gzip, chunk);
      const padding = tarPadding(entry.byteCount);
      if (padding > 0) await writeChunk(gzip, Buffer.alloc(padding));
    }
    await writeChunk(gzip, Buffer.alloc(TAR_TRAILER_SIZE));
    gzip.end();
    await outputFinished;
  } catch (error) {
    failed = true;
    gzip.destroy(error instanceof Error ? error : undefined);
    output.destroy(error instanceof Error ? error : undefined);
    await outputFinished.catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    if (!failed) gzip.unpipe(output);
  }

  try {
    if (overwrite) await rm(destination, { force: true });
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  const info = await regularFile(destination, 'Archive produite');
  return {
    archivePath: destination,
    sha256: await hashFile(destination),
    byteCount: info.size,
    tarByteCount: expectedTarByteCount(normalised),
    entries: normalised.map(({ absolutePath, ...entry }) => entry),
  };
}

async function readJsonFile(filePath, label) {
  await regularFile(filePath, label);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    fail(`${label} doit être un JSON valide : ${error instanceof Error ? error.message : String(error)}.`);
  }
}

async function packageDescriptor(packageRoot) {
  const root = resolve(packageRoot);
  const catalogPath = resolveInside(root, 'catalog.json', 'catalogue');
  const manifestPath = resolveInside(root, 'package-manifest.json', 'package-manifest');
  const [catalogBuffer, catalog, packageManifest] = await Promise.all([
    readFile(catalogPath),
    readJsonFile(catalogPath, 'catalogue'),
    readJsonFile(manifestPath, 'package-manifest'),
  ]);
  let validated;
  try {
    validated = validateSpatialCatalog(catalog);
  } catch (error) {
    if (error instanceof SpatialPackageVerificationError) fail(`Catalogue spatial invalide : ${error.message}.`, { cause: error });
    throw error;
  }
  const packageId = asString(packageManifest.package_id, 'package-manifest.package_id');
  const entries = [];
  for (const asset of validated.assets) {
    const path = safeRelativePath(asset.path, 'asset.path');
    const absolutePath = resolveInside(root, path, `asset ${path}`);
    entries.push({
      path,
      absolutePath,
      byteCount: asInteger(asset.byteCount, `asset ${path}.byte_count`, 1),
      sha256: asSha256(asset.sha256, `asset ${path}.sha256`),
    });
  }
  return {
    root,
    packageId,
    catalogPath,
    manifestPath,
    catalogBuffer,
    catalogSha256: createHash('sha256').update(catalogBuffer).digest('hex'),
    catalogByteCount: catalogBuffer.byteLength,
    packageManifest,
    entries: normaliseEntries(entries),
  };
}

async function provenanceDescriptor(lock, lockPath) {
  const provenance = asObject(lock.provenance, 'release-lock.provenance');
  const relativePath = safeRelativePath(provenance.path, 'release-lock.provenance.path');
  const projectRoot = resolve(dirname(lockPath), '../../..');
  const provenancePath = resolve(projectRoot, ...relativePath.split('/'));
  if (!isWithin(projectRoot, provenancePath)) fail('release-lock.provenance.path sort du projet.');
  const info = await regularFile(provenancePath, 'Manifeste de provenance IGN');
  return {
    path: relativePath,
    absolutePath: provenancePath,
    sha256: await hashFile(provenancePath),
    byteCount: info.size,
  };
}

function validateReleaseUrl(value) {
  const url = new URL(asString(value, 'release-lock.release.url'));
  if (url.protocol !== 'https:') fail('release-lock.release.url doit utiliser HTTPS.');
  return url.toString();
}

function releaseAssetName(value) {
  const assetName = safeRelativePath(value, 'release-lock.release.asset_name');
  if (assetName.includes('/') || !assetName.endsWith('.tar.gz')) {
    fail('release-lock.release.asset_name doit être un unique fichier .tar.gz.');
  }
  return assetName;
}

function parseReleaseLock(value) {
  const lock = asObject(value, 'release-lock');
  if (lock.schema_version !== RELEASE_LOCK_SCHEMA_VERSION) {
    fail(`release-lock.schema_version doit être ${RELEASE_LOCK_SCHEMA_VERSION}.`);
  }
  const release = asObject(lock.release, 'release-lock.release');
  const zone = asObject(lock.zone, 'release-lock.zone');
  return {
    raw: lock,
    packageId: asString(lock.package_id, 'release-lock.package_id'),
    publicRoot: asString(lock.public_root, 'release-lock.public_root'),
    zone: {
      zoneId: asString(zone.zone_id, 'release-lock.zone.zone_id'),
      revisionId: asString(zone.revision_id, 'release-lock.zone.revision_id'),
    },
    catalog: {
      path: safeRelativePath(asObject(lock.catalog, 'release-lock.catalog').path, 'release-lock.catalog.path'),
      sha256: asSha256(asObject(lock.catalog, 'release-lock.catalog').sha256, 'release-lock.catalog.sha256'),
      byteCount: asInteger(asObject(lock.catalog, 'release-lock.catalog').byte_count, 'release-lock.catalog.byte_count', 1),
    },
    provenance: {
      path: safeRelativePath(asObject(lock.provenance, 'release-lock.provenance').path, 'release-lock.provenance.path'),
      sha256: asSha256(asObject(lock.provenance, 'release-lock.provenance').sha256, 'release-lock.provenance.sha256'),
      byteCount: asInteger(asObject(lock.provenance, 'release-lock.provenance').byte_count, 'release-lock.provenance.byte_count', 1),
    },
    release: {
      repository: asString(release.repository, 'release-lock.release.repository'),
      tag: asString(release.tag, 'release-lock.release.tag'),
      assetName: releaseAssetName(release.asset_name),
      url: validateReleaseUrl(release.url),
      sha256: asSha256(release.sha256, 'release-lock.release.sha256'),
      byteCount: asInteger(release.byte_count, 'release-lock.release.byte_count', 1),
      tarByteCount: asInteger(release.tar_byte_count, 'release-lock.release.tar_byte_count', 1),
      assetCount: asInteger(release.asset_count, 'release-lock.release.asset_count', 1),
      assetByteCount: asInteger(release.asset_byte_count, 'release-lock.release.asset_byte_count', 1),
    },
  };
}

export async function readReleaseLock(releaseLockPath) {
  const lockPath = resolve(releaseLockPath);
  return { path: lockPath, ...parseReleaseLock(await readJsonFile(lockPath, 'Verrou de release')) };
}

async function validateReleaseLockForPackage(lock, descriptor) {
  if (lock.packageId !== descriptor.packageId) {
    fail(`Le verrou vise ${lock.packageId} au lieu du paquet ${descriptor.packageId}.`);
  }
  if (lock.publicRoot !== `/maps/${basename(descriptor.root)}/`) {
    fail(`Le verrou ne cible pas la racine publique du paquet : /maps/${basename(descriptor.root)}/.`);
  }
  if (lock.catalog.path !== 'catalog.json') fail('release-lock.catalog.path doit être catalog.json.');
  if (lock.catalog.sha256 !== descriptor.catalogSha256 || lock.catalog.byteCount !== descriptor.catalogByteCount) {
    fail('Le verrou de release ne correspond pas au catalogue versionné.');
  }
  const entryByteCount = descriptor.entries.reduce((total, entry) => total + entry.byteCount, 0);
  if (lock.release.assetCount !== descriptor.entries.length || lock.release.assetByteCount !== entryByteCount) {
    fail('Le verrou de release ne correspond pas aux assets déclarés.');
  }
  const expectedTarSize = expectedTarByteCount(descriptor.entries);
  if (lock.release.tarByteCount !== expectedTarSize) {
    fail('release-lock.release.tar_byte_count ne correspond pas au TAR canonique.');
  }
  const provenance = await provenanceDescriptor(lock.raw, lock.path);
  if (provenance.sha256 !== lock.provenance.sha256 || provenance.byteCount !== lock.provenance.byteCount) {
    fail('Le verrou de release ne correspond pas au manifeste IGN versionné.');
  }
  return { entryByteCount, expectedTarSize, provenance };
}

function releaseArtifactNames(assetName) {
  return {
    archive: assetName,
    checksums: 'SHA256SUMS',
    attribution: 'ATTRIBUTION-IGN.txt',
  };
}

function sha256Sums({ archive, entries }) {
  const lines = [`${archive.sha256}  ${archive.assetName}`];
  for (const entry of entries) lines.push(`${entry.sha256}  ${entry.path}`);
  return `${lines.join('\n')}\n`;
}

function archiveReport(archive, descriptor) {
  const assetByteCount = descriptor.entries.reduce((total, entry) => total + entry.byteCount, 0);
  return {
    asset_name: archive.assetName,
    sha256: archive.sha256,
    byte_count: archive.byteCount,
    tar_byte_count: archive.tarByteCount,
    asset_count: descriptor.entries.length,
    asset_byte_count: assetByteCount,
  };
}

/**
 * Verifies the package currently installed on disk and every versioned binding
 * that makes its GitHub Release reproducible.  It intentionally does not
 * download nor require the release archive, so a clean checkout can run this
 * after `fetch:spatial` has installed the already hash-checked assets.
 */
export async function verifySpatialReleaseContract({
  packageRoot = DEFAULT_PACKAGE_ROOT,
  releaseLockPath = DEFAULT_RELEASE_LOCK,
  dependencies = {},
} = {}) {
  const verifyPackage = dependencies.verifyPackage || verifySpatialPackage;
  const loadPackage = dependencies.loadPackage || packageDescriptor;
  const descriptor = await loadPackage(packageRoot);
  let verification;
  try {
    verification = await verifyPackage(descriptor.root);
  } catch (error) {
    fail(`Le paquet installé ne valide pas : ${error instanceof Error ? error.message : String(error)}.`, { cause: error });
  }
  const lock = await readReleaseLock(releaseLockPath);
  const bindings = await validateReleaseLockForPackage(lock, descriptor);
  return {
    status: 'ok',
    package_root: descriptor.root,
    release_lock: lock.path,
    catalog: {
      sha256: descriptor.catalogSha256,
      byte_count: descriptor.catalogByteCount,
    },
    provenance: {
      path: bindings.provenance.path,
      sha256: bindings.provenance.sha256,
      byte_count: bindings.provenance.byteCount,
    },
    release: {
      repository: lock.release.repository,
      tag: lock.release.tag,
      asset_name: lock.release.assetName,
      url: lock.release.url,
      sha256: lock.release.sha256,
      byte_count: lock.release.byteCount,
      tar_byte_count: lock.release.tarByteCount,
      asset_count: lock.release.assetCount,
      asset_byte_count: lock.release.assetByteCount,
    },
    verification,
  };
}

/**
 * Packs the already verified spatial package.  `releaseLockPath` is optional
 * while bootstrapping a release; when supplied every immutable lock field is
 * verified against the generated archive.
 */
export async function packSpatialRelease({
  packageRoot = DEFAULT_PACKAGE_ROOT,
  outputDirectory = SPATIAL_RELEASE_DEFAULTS.outputDirectory,
  releaseLockPath,
  overwrite = false,
  dependencies = {},
} = {}) {
  const verifyPackage = dependencies.verifyPackage || verifySpatialPackage;
  const loadPackage = dependencies.loadPackage || packageDescriptor;
  const descriptor = await loadPackage(packageRoot);
  try {
    await verifyPackage(descriptor.root);
  } catch (error) {
    fail(`Le paquet source doit être vérifié avant archivage : ${error instanceof Error ? error.message : String(error)}.`, {
      cause: error,
    });
  }
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  let lock;
  let lockValidation;
  if (releaseLockPath) {
    lock = await readReleaseLock(releaseLockPath);
    lockValidation = await validateReleaseLockForPackage(lock, descriptor);
  }
  const assetName = lock?.release.assetName || `${descriptor.packageId}.tar.gz`;
  const archivePath = resolve(output, assetName);
  if (!isWithin(output, archivePath)) fail('Le nom de l’archive sort du dossier de sortie.');
  const packed = await createDeterministicTarGz({ entries: descriptor.entries, archivePath, overwrite });
  const archive = { assetName, ...packed };
  const report = archiveReport(archive, descriptor);
  if (lock) {
    if (
      lock.release.sha256 !== report.sha256 ||
      lock.release.byteCount !== report.byte_count ||
      lock.release.tarByteCount !== report.tar_byte_count
    ) {
      fail('L’archive produite ne correspond pas au verrou de release.');
    }
    if (lockValidation.entryByteCount !== report.asset_byte_count) fail('Incohérence de poids des assets dans le verrou.');
  }
  const artifactNames = releaseArtifactNames(assetName);
  const provenance = lock ? lockValidation.provenance : undefined;
  const checksumsPath = resolve(output, artifactNames.checksums);
  await atomicWriteFile(checksumsPath, sha256Sums({ archive, entries: descriptor.entries }));
  let attributionPath;
  if (lock && provenance) {
    await regularFile(DEFAULT_IGN_ATTRIBUTION, 'Attribution IGN versionnée');
    attributionPath = resolve(output, artifactNames.attribution);
    await copyFile(DEFAULT_IGN_ATTRIBUTION, attributionPath);
  }
  return {
    status: 'ok',
    package_root: descriptor.root,
    output_directory: output,
    release: report,
    files: {
      archive: archivePath,
      sha256sums: checksumsPath,
      ...(attributionPath ? { attribution_ign: attributionPath } : {}),
    },
    ...(lock ? { release_lock: lock.path } : {}),
  };
}

async function copyPackageMetadataToStaging(descriptor, stagingRoot) {
  await mkdir(stagingRoot, { recursive: true });
  await Promise.all([
    copyFile(descriptor.catalogPath, resolveInside(stagingRoot, 'catalog.json', 'catalogue de staging')),
    copyFile(descriptor.manifestPath, resolveInside(stagingRoot, 'package-manifest.json', 'manifeste de staging')),
  ]);
}

async function ensureOutputParent(root, path) {
  const outputPath = resolveInside(root, path, 'chemin d’extraction');
  const parent = dirname(outputPath);
  const relativeParent = relative(root, parent);
  let cursor = root;
  for (const segment of relativeParent.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) fail(`Parent d’extraction non sûr : ${path}.`);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        await mkdir(cursor);
      } else {
        throw error;
      }
    }
  }
  return outputPath;
}

async function finishOutput(output) {
  output.end();
  await finished(output);
}

function allZero(buffer) {
  for (const byte of buffer) if (byte !== 0) return false;
  return true;
}

/**
 * Extracts only the exact expected regular TAR entries.  Symlinks, hardlinks,
 * traversal, duplicate names and unexpected data all fail before installation.
 */
export async function extractVerifiedTarGz({
  archivePath,
  expectedEntries,
  destinationRoot,
  maxTarByteCount,
  allowedExistingFiles = [],
}) {
  const expected = new Map(normaliseEntries(expectedEntries).map((entry) => [entry.path, entry]));
  const destination = resolve(destinationRoot);
  await mkdir(destination, { recursive: true });
  const destinationFiles = await readdir(destination);
  const allowed = new Set(allowedExistingFiles.map((path) => safeRelativePath(path, 'fichier de staging autorisé')));
  if (destinationFiles.length !== allowed.size || destinationFiles.some((name) => !allowed.has(name))) {
    fail('Le dossier de staging contient des fichiers non autorisés avant extraction.');
  }
  for (const name of destinationFiles) await regularFile(resolveInside(destination, name, 'fichier de staging autorisé'), `Fichier de staging ${name}`);
  const maxBytes = asInteger(maxTarByteCount, 'taille TAR maximale', TAR_TRAILER_SIZE);
  let uncompressedByteCount = 0;
  let pending = Buffer.alloc(0);
  let state = 'header';
  let current;
  let remaining = 0;
  let padding = 0;
  let zeroBlocks = 0;
  let endOfArchive = false;
  const seen = new Set();
  const gunzip = createGunzip();

  const closeCurrent = async () => {
    if (!current) return;
    await finishOutput(current.output);
    const actualHash = current.hash.digest('hex');
    if (actualHash !== current.expected.sha256) fail(`SHA-256 TAR incohérent pour ${current.expected.path}.`);
    current = undefined;
  };

  const processPending = async (atEnd = false) => {
    while (pending.length > 0) {
      if (endOfArchive) {
        if (!allZero(pending)) fail('Données non nulles après la fin TAR.');
        pending = Buffer.alloc(0);
        return;
      }
      if (state === 'header') {
        if (pending.length < TAR_BLOCK_SIZE) break;
        const header = pending.subarray(0, TAR_BLOCK_SIZE);
        pending = pending.subarray(TAR_BLOCK_SIZE);
        if (allZero(header)) {
          zeroBlocks += 1;
          if (zeroBlocks >= 2) endOfArchive = true;
          continue;
        }
        if (zeroBlocks > 0) fail('En-tête TAR après un bloc de fin.');
        const parsed = parseTarHeader(header);
        const expectedEntry = expected.get(parsed.path);
        if (!expectedEntry) fail(`Entrée TAR inattendue : ${parsed.path}.`);
        if (seen.has(parsed.path)) fail(`Entrée TAR dupliquée : ${parsed.path}.`);
        if (parsed.byteCount !== expectedEntry.byteCount) fail(`Taille TAR incohérente pour ${parsed.path}.`);
        const outputPath = await ensureOutputParent(destination, parsed.path);
        current = {
          expected: expectedEntry,
          output: createWriteStream(outputPath, { flags: 'wx', mode: 0o644 }),
          hash: createHash('sha256'),
        };
        current.output.once('error', (error) => gunzip.destroy(error));
        seen.add(parsed.path);
        remaining = parsed.byteCount;
        padding = tarPadding(parsed.byteCount);
        state = 'body';
        continue;
      }
      if (state === 'body') {
        if (remaining === 0) {
          await closeCurrent();
          state = 'padding';
          continue;
        }
        if (pending.length === 0) break;
        const size = Math.min(remaining, pending.length);
        const piece = pending.subarray(0, size);
        pending = pending.subarray(size);
        current.hash.update(piece);
        await writeChunk(current.output, piece);
        remaining -= size;
        continue;
      }
      if (state === 'padding') {
        if (pending.length < padding) break;
        const filler = pending.subarray(0, padding);
        pending = pending.subarray(padding);
        if (!allZero(filler)) fail('Padding TAR non nul.');
        state = 'header';
        continue;
      }
      fail(`État d’extraction inconnu : ${state}.`);
    }
    if (atEnd) {
      if (current || remaining !== 0 || state === 'body') fail('Archive TAR tronquée au milieu d’un asset.');
      if (state === 'padding' && padding !== 0) fail('Archive TAR tronquée dans son padding.');
      if (pending.length !== 0) fail('Archive TAR tronquée dans son en-tête.');
      if (!endOfArchive || zeroBlocks < 2) fail('Archive TAR sans les deux blocs de fin requis.');
      if (seen.size !== expected.size) fail('Archive TAR incomplète.');
    }
  };

  try {
    const source = createReadStream(archivePath);
    source.pipe(gunzip);
    for await (const chunk of gunzip) {
      uncompressedByteCount += chunk.length;
      if (uncompressedByteCount > maxBytes) fail('Archive TAR décompressée au-delà de la taille autorisée.');
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      await processPending(false);
    }
    await processPending(true);
  } catch (error) {
    gunzip.destroy();
    await closeCurrent().catch(() => {});
    throw error;
  }
  if (uncompressedByteCount !== maxBytes) {
    fail(`Taille TAR décompressée incohérente : ${uncompressedByteCount} au lieu de ${maxBytes}.`);
  }
  return { entryCount: seen.size, tarByteCount: uncompressedByteCount };
}

export async function verifyArchiveFile({ archivePath, sha256, byteCount }) {
  const absolutePath = resolve(archivePath);
  const info = await regularFile(absolutePath, 'Archive de release');
  const expectedByteCount = asInteger(byteCount, 'Taille d’archive attendue', 1);
  if (info.size !== expectedByteCount) fail(`Taille d’archive incohérente : ${info.size} au lieu de ${expectedByteCount}.`);
  const actualHash = await hashFile(absolutePath);
  if (actualHash !== asSha256(sha256, 'SHA-256 d’archive attendu')) fail('SHA-256 de l’archive incohérent.');
  return { archivePath: absolutePath, sha256: actualHash, byteCount: info.size };
}

async function downloadReleaseArchive(url, expectedByteCount) {
  const targetUrl = new URL(url);
  if (targetUrl.protocol !== 'https:') fail('La récupération distante exige une URL HTTPS.');
  await mkdir(SPATIAL_RELEASE_DEFAULTS.outputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(SPATIAL_RELEASE_DEFAULTS.outputDirectory, '.download-'));
  const destination = join(temporaryDirectory, 'release.tar.gz');
  try {
    const response = await fetch(targetUrl, { redirect: 'follow' });
    if (!response.ok || !response.body) fail(`Téléchargement de release refusé : HTTP ${response.status}.`);
    if (new URL(response.url).protocol !== 'https:') fail('La redirection de release a quitté HTTPS.');
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) !== expectedByteCount) fail('Content-Length de release incohérent.');
    const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    const done = finished(output);
    try {
      for await (const chunk of Readable.fromWeb(response.body)) {
        await writeChunk(output, chunk);
      }
      output.end();
      await done;
    } catch (error) {
      output.destroy(error instanceof Error ? error : undefined);
      await done.catch(() => {});
      throw error;
    }
    return { archivePath: destination, cleanupDirectory: temporaryDirectory };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function moveDirectory(from, to, label) {
  await directoryOrAbsent(from, `${label} source`).then((exists) => {
    if (!exists) fail(`${label} source est absent.`);
  });
  try {
    await lstat(to);
    fail(`${label} destination existe déjà.`);
  } catch (error) {
    if (error instanceof SpatialReleaseError) throw error;
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error;
  }
  await rename(from, to);
}

async function transactionalInstall({ packageRoot, stagingRoot, verifyPackage }) {
  const root = resolve(packageRoot);
  const parent = dirname(root);
  const stagedTerrain = resolveInside(stagingRoot, 'terrain', 'terrain de staging');
  const stagedVectors = resolveInside(stagingRoot, 'vectors', 'vectors de staging');
  await directoryOrAbsent(stagedTerrain, 'terrain de staging').then((exists) => {
    if (!exists) fail('terrain de staging est absent.');
  });
  await directoryOrAbsent(stagedVectors, 'vectors de staging').then((exists) => {
    if (!exists) fail('vectors de staging est absent.');
  });
  const targetTerrain = resolveInside(root, 'terrain', 'terrain cible');
  const targetVectors = resolveInside(root, 'vectors', 'vectors cible');
  const backupRoot = await mkdtemp(join(parent, '.fireviewer-spatial-backup-'));
  const backupTerrain = join(backupRoot, 'terrain');
  const backupVectors = join(backupRoot, 'vectors');
  let terrainBackedUp = false;
  let vectorsBackedUp = false;
  let terrainInstalled = false;
  let vectorsInstalled = false;

  const rollback = async () => {
    if (terrainInstalled) await rm(targetTerrain, { recursive: true, force: true }).catch(() => {});
    if (vectorsInstalled) await rm(targetVectors, { recursive: true, force: true }).catch(() => {});
    if (terrainBackedUp) await rename(backupTerrain, targetTerrain).catch(() => {});
    if (vectorsBackedUp) await rename(backupVectors, targetVectors).catch(() => {});
  };

  try {
    if (await directoryOrAbsent(targetTerrain, 'terrain existant')) {
      await moveDirectory(targetTerrain, backupTerrain, 'terrain existant');
      terrainBackedUp = true;
    }
    if (await directoryOrAbsent(targetVectors, 'vectors existant')) {
      await moveDirectory(targetVectors, backupVectors, 'vectors existant');
      vectorsBackedUp = true;
    }
    await moveDirectory(stagedTerrain, targetTerrain, 'terrain');
    terrainInstalled = true;
    await moveDirectory(stagedVectors, targetVectors, 'vectors');
    vectorsInstalled = true;
    const report = await verifyPackage(root);
    await rm(backupRoot, { recursive: true, force: true });
    return report;
  } catch (error) {
    await rollback();
    throw error;
  } finally {
    await rm(backupRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Retrieves a release archive, proves its compressed hash and TAR shape, then
 * installs its two asset directories only after the complete package verifies.
 */
export async function fetchSpatialRelease({
  packageRoot = DEFAULT_PACKAGE_ROOT,
  releaseLockPath = DEFAULT_RELEASE_LOCK,
  archivePath,
  archiveUrl,
  dependencies = {},
} = {}) {
  const verifyPackage = dependencies.verifyPackage || verifySpatialPackage;
  const loadPackage = dependencies.loadPackage || packageDescriptor;
  const descriptor = await loadPackage(packageRoot);
  const lock = await readReleaseLock(releaseLockPath);
  const lockValidation = await validateReleaseLockForPackage(lock, descriptor);
  if (archiveUrl) validateReleaseUrl(archiveUrl);
  let acquired;
  if (archivePath) {
    acquired = { archivePath: resolve(archivePath) };
  } else {
    acquired = await downloadReleaseArchive(archiveUrl || lock.release.url, lock.release.byteCount);
  }
  let stagingParent;
  try {
    await verifyArchiveFile({
      archivePath: acquired.archivePath,
      sha256: lock.release.sha256,
      byteCount: lock.release.byteCount,
    });
    stagingParent = await mkdtemp(join(dirname(descriptor.root), '.fireviewer-spatial-stage-'));
    const stagingRoot = join(stagingParent, 'package');
    await copyPackageMetadataToStaging(descriptor, stagingRoot);
    await extractVerifiedTarGz({
      archivePath: acquired.archivePath,
      expectedEntries: descriptor.entries,
      destinationRoot: stagingRoot,
      maxTarByteCount: lock.release.tarByteCount,
      allowedExistingFiles: ['catalog.json', 'package-manifest.json'],
    });
    try {
      await verifyPackage(stagingRoot);
    } catch (error) {
      fail(`Le paquet extrait ne valide pas avant installation : ${error instanceof Error ? error.message : String(error)}.`, {
        cause: error,
      });
    }
    const installed = await transactionalInstall({
      packageRoot: descriptor.root,
      stagingRoot,
      verifyPackage,
    });
    return {
      status: 'ok',
      package_root: descriptor.root,
      release_lock: lock.path,
      release: {
        asset_name: lock.release.assetName,
        sha256: lock.release.sha256,
        byte_count: lock.release.byteCount,
        tar_byte_count: lock.release.tarByteCount,
      },
      extracted: {
        asset_count: descriptor.entries.length,
        asset_byte_count: lockValidation.entryByteCount,
      },
      verification: installed,
    };
  } finally {
    if (stagingParent) await rm(stagingParent, { recursive: true, force: true }).catch(() => {});
    if (acquired?.cleanupDirectory) await rm(acquired.cleanupDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

export function releaseLockPatch({ packageId, publicRoot, zone, catalog, provenance, release }) {
  return {
    schema_version: RELEASE_LOCK_SCHEMA_VERSION,
    package_id: asString(packageId, 'package_id'),
    public_root: asString(publicRoot, 'public_root'),
    zone: {
      zone_id: asString(zone?.zoneId, 'zone.zoneId'),
      revision_id: asString(zone?.revisionId, 'zone.revisionId'),
    },
    catalog: {
      path: safeRelativePath(catalog?.path, 'catalog.path'),
      sha256: asSha256(catalog?.sha256, 'catalog.sha256'),
      byte_count: asInteger(catalog?.byteCount, 'catalog.byteCount', 1),
    },
    provenance: {
      path: safeRelativePath(provenance?.path, 'provenance.path'),
      sha256: asSha256(provenance?.sha256, 'provenance.sha256'),
      byte_count: asInteger(provenance?.byteCount, 'provenance.byteCount', 1),
    },
    release: {
      repository: asString(release?.repository, 'release.repository'),
      tag: asString(release?.tag, 'release.tag'),
      asset_name: releaseAssetName(release?.assetName),
      url: validateReleaseUrl(release?.url),
      sha256: asSha256(release?.sha256, 'release.sha256'),
      byte_count: asInteger(release?.byteCount, 'release.byteCount', 1),
      tar_byte_count: asInteger(release?.tarByteCount, 'release.tarByteCount', 1),
      asset_count: asInteger(release?.assetCount, 'release.assetCount', 1),
      asset_byte_count: asInteger(release?.assetByteCount, 'release.assetByteCount', 1),
    },
  };
}
