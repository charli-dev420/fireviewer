import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DIRECT_MEDIA_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
]);

export class IncidentSourceCorpusError extends Error {}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IncidentSourceCorpusError(`${label} est absent du manifeste.`);
  }
  return value;
}

function resolveInside(root, relativePath) {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, relativePath);
  const prefix = absoluteRoot.endsWith(sep) ? absoluteRoot : `${absoluteRoot}${sep}`;
  if (candidate !== absoluteRoot && !candidate.startsWith(prefix)) {
    throw new IncidentSourceCorpusError(`Chemin hors corpus refusé : ${relativePath}`);
  }
  return candidate;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function parseManifestLine(line, lineNumber) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    throw new IncidentSourceCorpusError(`JSON invalide à la ligne ${lineNumber} du manifeste.`);
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new IncidentSourceCorpusError(`Entrée invalide à la ligne ${lineNumber} du manifeste.`);
  }
  const groupDate = assertString(row.group_date, `group_date ligne ${lineNumber}`);
  if (!DATE_PATTERN.test(groupDate)) {
    throw new IncidentSourceCorpusError(`group_date invalide à la ligne ${lineNumber}.`);
  }
  const groupIndex = row.group_index;
  if (!Number.isSafeInteger(groupIndex) || groupIndex < 1) {
    throw new IncidentSourceCorpusError(`group_index invalide à la ligne ${lineNumber}.`);
  }
  const digest = assertString(row.sha256, `sha256 ligne ${lineNumber}`).toLowerCase();
  if (!SHA256_PATTERN.test(digest)) {
    throw new IncidentSourceCorpusError(`sha256 invalide à la ligne ${lineNumber}.`);
  }
  return {
    ...row,
    element_id: assertString(row.element_id, `element_id ligne ${lineNumber}`),
    group_date: groupDate,
    group_index: groupIndex,
    kind: assertString(row.kind, `kind ligne ${lineNumber}`),
    local_path: assertString(row.local_path, `local_path ligne ${lineNumber}`),
    media_type: assertString(row.media_type, `media_type ligne ${lineNumber}`),
    sha256: digest,
  };
}

export async function loadOperationalManifest(corpusRoot) {
  const manifestPath = resolveInside(corpusRoot, 'manifest.jsonl');
  const text = await readFile(manifestPath, 'utf8');
  const rows = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseManifestLine(line, index + 1));
  if (!rows.length) throw new IncidentSourceCorpusError('Le manifeste du corpus est vide.');
  return rows;
}

export function listCorpusDays(rows) {
  return [...new Set(rows.map((row) => row.group_date))].sort();
}

async function verifiedSourceContent(corpusRoot, row) {
  const sourcePath = resolveInside(corpusRoot, row.local_path);
  let content;
  try {
    content = await readFile(sourcePath);
  } catch (error) {
    throw new IncidentSourceCorpusError(
      `Fichier source introuvable pour ${row.element_id} : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const actualDigest = sha256(content);
  if (actualDigest !== row.sha256) {
    throw new IncidentSourceCorpusError(
      `Empreinte divergente pour ${row.element_id} : ${actualDigest}.`,
    );
  }
  if (Number.isSafeInteger(row.byte_count) && row.byte_count !== content.length) {
    throw new IncidentSourceCorpusError(`Taille divergente pour ${row.element_id}.`);
  }
  return { content, sourcePath };
}

function contextualDocument(row, sourceContent) {
  const sections = [
    '# Source FireWarning fournie pour analyse privée',
    '',
    `Élément : ${row.element_id}`,
    `Date du groupe : ${row.group_date}`,
    `Date portée par la source : ${row.captured_at ?? 'non précisée'}`,
    `Type déclaré par le manifeste : ${row.media_type}`,
    `Nature : ${row.kind}`,
    `Source : ${row.source_id ?? 'non précisée'}`,
    `URL source : ${row.source_url ?? 'non précisée'}`,
    `Attribution : ${row.attribution ?? 'non précisée'}`,
    '',
    '## Métadonnées exactes du manifeste',
    '```json',
    JSON.stringify(row, null, 2),
    '```',
  ];

  if (row.kind === 'event_geometry') {
    let decoded;
    try {
      decoded = gunzipSync(sourceContent).toString('utf8');
    } catch {
      throw new IncidentSourceCorpusError(`Géométrie gzip invalide pour ${row.element_id}.`);
    }
    sections.push('', '## Géométrie officielle fournie', '```json', decoded, '```');
  } else if (['product_metadata', 'signed_spatial_reference'].includes(row.kind)) {
    sections.push('', '## Contenu source fourni', '```json', sourceContent.toString('utf8'), '```');
  } else if (row.kind === 'map_pdf') {
    sections.push(
      '',
      'La page cartographique rendue correspondante est fournie comme image dans le même lot quotidien.',
    );
  }

  const content = Buffer.from(`${sections.join('\n')}\n`, 'utf8');
  if (content.length > 100_000) {
    throw new IncidentSourceCorpusError(`Document contextuel trop volumineux pour ${row.element_id}.`);
  }
  return content;
}

function outputName(row, extension) {
  const safeId = row.element_id.replace(/[^A-Za-z0-9._-]+/gu, '_');
  return `${String(row.group_index).padStart(2, '0')}-${safeId}${extension}`;
}

export async function buildDailySourcePackage(corpusRoot, requestedDay) {
  const rows = await loadOperationalManifest(corpusRoot);
  const availableDays = listCorpusDays(rows);
  const day = requestedDay ?? availableDays[0];
  if (!DATE_PATTERN.test(day) || !availableDays.includes(day)) {
    throw new IncidentSourceCorpusError(
      `Journée absente du manifeste : ${day}. Disponibles : ${availableDays.join(', ')}.`,
    );
  }
  const dailyRows = rows
    .filter((row) => row.group_date === day)
    .sort((left, right) => left.group_index - right.group_index);
  if (new Set(dailyRows.map((row) => row.group_index)).size !== dailyRows.length) {
    throw new IncidentSourceCorpusError(`group_index dupliqué pour ${day}.`);
  }

  const materials = [];
  for (const row of dailyRows) {
    const { content, sourcePath } = await verifiedSourceContent(corpusRoot, row);
    const extension = extname(sourcePath).toLowerCase();
    const contentType = DIRECT_MEDIA_TYPES.get(extension);
    if (contentType && row.kind !== 'map_pdf') {
      materials.push({
        name: outputName(row, extension),
        content,
        contentType,
        manifest: row,
        transformed: false,
      });
      continue;
    }
    materials.push({
      name: outputName(row, '.md'),
      content: contextualDocument(row, content),
      contentType: 'text/markdown',
      manifest: row,
      transformed: true,
    });
  }

  return {
    day,
    availableDays,
    corpusId: dailyRows[0]?.corpus_id ?? null,
    materials,
    totalSizeBytes: materials.reduce((total, material) => total + material.content.length, 0),
  };
}
