import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TIMEZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/u;
const MAX_CONTEXT_DOCUMENT_BYTES = 100_000;
const MAX_CONTEXT_FEATURE_DETAILS = 512;
const INGESTION_ROUTES = new Set([
  'public_contribution',
  'admin_source_package',
  'source_research_reference',
  'evaluation_reference',
]);
const PUBLIC_IMAGE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
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

function assertTimestamp(value, label, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new IncidentSourceCorpusError(`${label} est absent du manifeste.`);
    return null;
  }
  if (typeof value !== 'string' || !TIMEZONE_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new IncidentSourceCorpusError(`${label} doit être une date ISO-8601 avec fuseau horaire.`);
  }
  return value;
}

function assertBoundedString(value, label, minimum, maximum, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new IncidentSourceCorpusError(`${label} est absent du manifeste.`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length < minimum || value.trim().length > maximum) {
    throw new IncidentSourceCorpusError(`${label} doit contenir entre ${minimum} et ${maximum} caractères.`);
  }
  return value.trim();
}

function validateRouteMetadata(row, lineNumber, ingestionRoute) {
  const suffix = `ligne ${lineNumber}`;
  if (ingestionRoute === 'public_contribution') {
    if (typeof row.direct_observation !== 'boolean') {
      throw new IncidentSourceCorpusError(`direct_observation invalide à la ${suffix}.`);
    }
    return {
      observed_at: assertTimestamp(row.observed_at, `observed_at ${suffix}`, { required: true }),
      media_captured_at: assertTimestamp(row.media_captured_at, `media_captured_at ${suffix}`),
      location_label: assertBoundedString(row.location_label, `location_label ${suffix}`, 2, 240),
      observation_type: assertBoundedString(row.observation_type, `observation_type ${suffix}`, 2, 128),
      description: assertBoundedString(row.description, `description ${suffix}`, 20, 4_000),
      media_direction: assertBoundedString(
        row.media_direction,
        `media_direction ${suffix}`,
        2,
        128,
        { required: false },
      ),
      direct_observation: row.direct_observation,
    };
  }
  if (ingestionRoute === 'source_research_reference') {
    const sourceUrl = assertBoundedString(row.source_url, `source_url ${suffix}`, 8, 2_048);
    let parsed;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new IncidentSourceCorpusError(`source_url invalide à la ${suffix}.`);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new IncidentSourceCorpusError(`source_url doit être une URL HTTPS publique à la ${suffix}.`);
    }
    return {
      source_url: parsed.href,
      published_at: assertTimestamp(row.published_at, `published_at ${suffix}`),
    };
  }
  return {};
}

function validPublicImage(contentType, content) {
  if (!PUBLIC_IMAGE_CONTENT_TYPES.has(contentType)) return false;
  if (contentType === 'image/jpeg') {
    return content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  }
  if (contentType === 'image/png') {
    return content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return content.subarray(0, 4).toString('ascii') === 'RIFF'
    && content.subarray(8, 12).toString('ascii') === 'WEBP';
}

function coordinateSummary(value, summary) {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2
    && typeof value[0] === 'number'
    && Number.isFinite(value[0])
    && typeof value[1] === 'number'
    && Number.isFinite(value[1])
  ) {
    const [x, y] = value;
    summary.coordinate_points += 1;
    summary.bbox[0] = Math.min(summary.bbox[0], x);
    summary.bbox[1] = Math.min(summary.bbox[1], y);
    summary.bbox[2] = Math.max(summary.bbox[2], x);
    summary.bbox[3] = Math.max(summary.bbox[3], y);
    return;
  }
  for (const child of value) coordinateSummary(child, summary);
}

function boundedProperties(properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => {
    if (value === null || ['boolean', 'number'].includes(typeof value)) return [key, value];
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return [key, serialized.length <= 512 ? serialized : `${serialized.slice(0, 509)}...`];
  }));
}

function summarizeGeometry(row, decoded) {
  let source;
  try {
    source = JSON.parse(decoded);
  } catch {
    throw new IncidentSourceCorpusError(`GeoJSON invalide pour ${row.element_id}.`);
  }
  if (
    !source
    || typeof source !== 'object'
    || source.type !== 'FeatureCollection'
    || !Array.isArray(source.features)
  ) {
    throw new IncidentSourceCorpusError(`FeatureCollection attendue pour ${row.element_id}.`);
  }

  const global = { coordinate_points: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity] };
  const features = source.features.map((feature, index) => {
    const featureSummary = { coordinate_points: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity] };
    coordinateSummary(feature?.geometry?.coordinates, featureSummary);
    coordinateSummary(feature?.geometry?.coordinates, global);
    return {
      index,
      geometry_type: feature?.geometry?.type ?? null,
      coordinate_points: featureSummary.coordinate_points,
      bbox: featureSummary.coordinate_points ? featureSummary.bbox : null,
      properties: boundedProperties(feature?.properties),
    };
  });
  const retainedFeatures = features.slice(0, MAX_CONTEXT_FEATURE_DETAILS);
  return {
    source_type: source.type,
    feature_count: features.length,
    retained_feature_details: retainedFeatures.length,
    omitted_feature_details: features.length - retainedFeatures.length,
    coordinate_points: global.coordinate_points,
    bbox: global.coordinate_points ? global.bbox : null,
    geometry_types: [...new Set(features.map((feature) => feature.geometry_type).filter(Boolean))].sort(),
    features: retainedFeatures,
  };
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
  if (row.pipeline_input !== undefined && typeof row.pipeline_input !== 'boolean') {
    throw new IncidentSourceCorpusError(`pipeline_input invalide à la ligne ${lineNumber}.`);
  }
  if (row.evaluation_reference !== undefined && typeof row.evaluation_reference !== 'boolean') {
    throw new IncidentSourceCorpusError(`evaluation_reference invalide à la ligne ${lineNumber}.`);
  }
  const pipelineInput = row.pipeline_input !== false;
  const evaluationReference = row.evaluation_reference === true;
  const ingestionRoute = row.ingestion_route
    ?? (evaluationReference || !pipelineInput ? 'evaluation_reference' : 'admin_source_package');
  if (!INGESTION_ROUTES.has(ingestionRoute)) {
    throw new IncidentSourceCorpusError(`ingestion_route invalide à la ligne ${lineNumber}.`);
  }
  const directPipelineInput = ['public_contribution', 'admin_source_package'].includes(ingestionRoute);
  if (pipelineInput !== directPipelineInput || evaluationReference !== (ingestionRoute === 'evaluation_reference')) {
    throw new IncidentSourceCorpusError(`Rôle de pipeline incohérent à la ligne ${lineNumber}.`);
  }
  const routeMetadata = validateRouteMetadata(row, lineNumber, ingestionRoute);
  return {
    ...row,
    ...routeMetadata,
    element_id: assertString(row.element_id, `element_id ligne ${lineNumber}`),
    group_date: groupDate,
    group_index: groupIndex,
    kind: assertString(row.kind, `kind ligne ${lineNumber}`),
    local_path: assertString(row.local_path, `local_path ligne ${lineNumber}`),
    media_type: assertString(row.media_type, `media_type ligne ${lineNumber}`),
    pipeline_input: pipelineInput,
    evaluation_reference: evaluationReference,
    ingestion_route: ingestionRoute,
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
    const geometrySummary = summarizeGeometry(row, decoded);
    sections.push(
      '',
      '## Résumé géométrique déterministe de la source officielle',
      '',
      'Le GeoJSON brut a été vérifié avec l’empreinte du manifeste. Pour borner le contexte du modèle,',
      'ce document conserve les propriétés, emprises et nombres de sommets, sans recopier les coordonnées brutes.',
      '```json',
      JSON.stringify(geometrySummary, null, 2),
      '```',
    );
  } else if (['product_metadata', 'signed_spatial_reference'].includes(row.kind)) {
    sections.push('', '## Contenu source fourni', '```json', sourceContent.toString('utf8'), '```');
  } else if (row.kind === 'map_pdf') {
    sections.push(
      '',
      'La page cartographique rendue correspondante est fournie comme image dans le même lot quotidien.',
    );
  }

  const content = Buffer.from(`${sections.join('\n')}\n`, 'utf8');
  if (content.length > MAX_CONTEXT_DOCUMENT_BYTES) {
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
  const publicContributions = [];
  const researchReferences = [];
  const evaluationReferences = [];
  for (const row of dailyRows) {
    const { content, sourcePath } = await verifiedSourceContent(corpusRoot, row);
    const reference = {
      element_id: row.element_id,
      kind: row.kind,
      media_type: row.media_type,
      sha256: row.sha256,
      source_id: row.source_id ?? null,
      source_url: row.source_url ?? null,
      captured_at: row.captured_at ?? null,
      published_at: row.published_at ?? null,
    };
    if (row.ingestion_route === 'evaluation_reference') {
      evaluationReferences.push(reference);
      continue;
    }
    if (row.ingestion_route === 'source_research_reference') {
      researchReferences.push(reference);
      continue;
    }
    const extension = extname(sourcePath).toLowerCase();
    const contentType = DIRECT_MEDIA_TYPES.get(extension);
    if (row.ingestion_route === 'public_contribution') {
      if (!contentType || !validPublicImage(contentType, content)) {
        throw new IncidentSourceCorpusError(
          `La contribution publique ${row.element_id} doit être une image JPG, PNG ou WebP valide.`,
        );
      }
      publicContributions.push({
        name: outputName(row, extension),
        content,
        contentType,
        manifest: row,
        transformed: false,
      });
      continue;
    }
    if (row.ingestion_route !== 'admin_source_package') {
      throw new IncidentSourceCorpusError(`Route non gérée pour ${row.element_id}.`);
    }
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
    evaluationReferences,
    materials,
    publicContributions,
    publicContributionSizeBytes: publicContributions.reduce(
      (total, contribution) => total + contribution.content.length,
      0,
    ),
    researchReferences,
    totalSizeBytes: materials.reduce((total, material) => total + material.content.length, 0),
  };
}
