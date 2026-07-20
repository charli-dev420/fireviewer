#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { upload } from '@vercel/blob/client';

const IMAGE_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

export class PublicEvidenceUploadError extends Error {}

function usage() {
  return [
    'Usage : node tools/upload-public-incident-evidence.mjs --file <image> --observed-at <ISO-8601> --description <texte> [options]',
    '',
    'Options :',
    '  --api-origin <https-url>       Origine API (défaut : https://fireviewer-api.vercel.app).',
    '  --fire-id <id>                 Incident cible (défaut : FR-26-00001).',
    '  --location <texte>             Lieu déclaré (défaut : Die, massif de Justin, Drôme).',
    '  --observation-type <texte>     Type déclaré (défaut : activité du feu visible).',
    '  --media-captured-at <ISO-8601> Heure propre au média si elle diffère de l’observation.',
    '  --direction <texte>            Direction de prise de vue déclarée.',
    '  --idempotency-key <clé>        Clé stable ; sinon elle est dérivée du contenu.',
    '  --indirect                     La description ne provient pas d’une observation directe.',
    '  --dry-run                      Vérifie le fichier et affiche le reçu prévu sans envoi.',
    '',
    'Le média reste privé : analyse et conservation autorisées, republication et affichage spatial refusés.',
  ].join('\n');
}

function requiredValue(argumentsList, index) {
  if (index + 1 >= argumentsList.length) throw new PublicEvidenceUploadError(usage());
  return argumentsList[index + 1];
}

export function parsePublicEvidenceArguments(argumentsList) {
  const options = {
    apiOrigin: 'https://fireviewer-api.vercel.app',
    fireId: 'FR-26-00001',
    location: 'Die, massif de Justin, Drôme',
    observationType: 'activité du feu visible',
    directObservation: true,
    dryRun: false,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--indirect') {
      options.directObservation = false;
      continue;
    }
    const value = requiredValue(argumentsList, index);
    index += 1;
    if (argument === '--api-origin') options.apiOrigin = value;
    else if (argument === '--fire-id') options.fireId = value;
    else if (argument === '--location') options.location = value;
    else if (argument === '--observation-type') options.observationType = value;
    else if (argument === '--observed-at') options.observedAt = value;
    else if (argument === '--media-captured-at') options.mediaCapturedAt = value;
    else if (argument === '--direction') options.direction = value;
    else if (argument === '--description') options.description = value;
    else if (argument === '--idempotency-key') options.idempotencyKey = value;
    else if (argument === '--file') options.file = resolve(value);
    else throw new PublicEvidenceUploadError(usage());
  }
  if (!options.file || !options.observedAt || !options.description) {
    throw new PublicEvidenceUploadError(usage());
  }
  if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/u.test(options.fireId)) {
    throw new PublicEvidenceUploadError('--fire-id est invalide.');
  }
  const origin = new URL(options.apiOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
    throw new PublicEvidenceUploadError('--api-origin doit être une origine HTTPS sans chemin ni identifiants.');
  }
  options.apiOrigin = origin.origin;
  for (const [label, value] of [
    ['--observed-at', options.observedAt],
    ['--media-captured-at', options.mediaCapturedAt],
  ]) {
    if (value !== undefined && (!Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value))) {
      throw new PublicEvidenceUploadError(`${label} doit inclure un fuseau horaire.`);
    }
  }
  if (options.location.trim().length < 2) throw new PublicEvidenceUploadError('--location est trop court.');
  if (options.observationType.trim().length < 2) {
    throw new PublicEvidenceUploadError('--observation-type est trop court.');
  }
  if (options.description.trim().length < 20 || options.description.length > 4_000) {
    throw new PublicEvidenceUploadError('--description doit contenir entre 20 et 4000 caractères.');
  }
  return options;
}

function contentType(filename, content) {
  const type = IMAGE_TYPES.get(extname(filename).toLowerCase());
  const valid = (
    (type === 'image/jpeg' && content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    || (type === 'image/png' && content.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary')))
    || (type === 'image/webp' && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP')
  );
  if (!type || !valid) {
    throw new PublicEvidenceUploadError('Le fichier public doit être une image JPG, PNG ou WebP valide.');
  }
  return type;
}

function safeFilename(filename) {
  const normalized = filename.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^\.+/u, '');
  return `0001-${normalized || 'preuve'}`;
}

async function responseJson(response, action) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new PublicEvidenceUploadError(`${action} a retourné une réponse illisible (${response.status}).`);
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && typeof payload.detail === 'string'
      ? payload.detail
      : `HTTP ${response.status}`;
    throw new PublicEvidenceUploadError(`${action} refusé : ${detail}`);
  }
  return payload;
}

function safeReceipt(status, digest, idempotencyKey) {
  return {
    contribution_id: status.contribution_id,
    fire_id: status.fire_id,
    state: status.state,
    observed_at: status.observed_at,
    media_count: status.media_count,
    sha256: digest,
    idempotency_key: idempotencyKey,
    private_analysis: true,
    retained_privately: true,
    public_display: false,
    spatial_display: false,
  };
}

export async function submitPublicIncidentEvidence(input, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const uploader = dependencies.uploader ?? upload;
  const digest = createHash('sha256').update(input.content).digest('hex');
  const idempotencyKey = input.idempotencyKey
    ?? `public:${input.fireId}:${input.observedAt}:${digest.slice(0, 24)}:v1`;
  const request = {
    kind: 'incident_evidence',
    fire_id: input.fireId,
    location: {
      mode: 'place',
      label: input.location,
      latitude: null,
      longitude: null,
      uncertainty_m: null,
    },
    observation: {
      observation_type: input.observationType,
      observed_at: input.observedAt,
      direct_observation: input.directObservation,
      description: input.description,
    },
    media: {
      filename: input.filename,
      content_type: input.contentType,
      size_bytes: input.content.length,
      captured_at: input.mediaCapturedAt ?? null,
      direction: input.direction ?? null,
    },
    consents: {
      private_analysis: true,
      retain_evidence: true,
      public_display: false,
      spatial_display: false,
    },
    contact_email: null,
  };
  const openedResponse = await fetchImpl(`${input.apiOrigin}/api/v1/contributions/open`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(request),
  });
  const opened = await responseJson(openedResponse, 'Ouverture de la contribution publique');
  if (typeof opened.contribution_id !== 'string' || typeof opened.tracking_token !== 'string') {
    throw new PublicEvidenceUploadError('Le reçu d’ouverture public est incomplet.');
  }
  if (opened.state !== 'OPEN') {
    const statusResponse = await fetchImpl(
      `${input.apiOrigin}/api/v1/contributions/${encodeURIComponent(opened.contribution_id)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${opened.tracking_token}`,
        },
      },
    );
    const statusEnvelope = await responseJson(statusResponse, 'Lecture de la contribution publique rejouée');
    if (!statusEnvelope.contribution || typeof statusEnvelope.contribution !== 'object') {
      throw new PublicEvidenceUploadError('Le reçu public rejoué est incomplet.');
    }
    return safeReceipt(statusEnvelope.contribution, digest, idempotencyKey);
  }
  if (opened.state === 'OPEN') {
    if (!opened.upload || typeof opened.upload.upload_grant !== 'string') {
      throw new PublicEvidenceUploadError('Le transfert public ouvert ne contient pas de droit d’envoi.');
    }
    if (!opened.upload.allowed_content_types?.includes(input.contentType)) {
      throw new PublicEvidenceUploadError(`Le stockage public refuse ${input.contentType}.`);
    }
    if (input.content.length > opened.upload.maximum_file_size_bytes) {
      throw new PublicEvidenceUploadError('L’image dépasse la limite du stockage public.');
    }
    const file = new File([input.content], input.filename, { type: input.contentType });
    await uploader(`${opened.upload.pathname_prefix}/${safeFilename(input.filename)}`, file, {
      access: 'private',
      handleUploadUrl: `${input.apiOrigin}/api/v1/contributions/blob-upload-token`,
      headers: { 'X-Blob-Upload-Grant': opened.upload.upload_grant },
      clientPayload: opened.upload.package_id,
      contentType: input.contentType,
      multipart: true,
    });
  }
  const finalizedResponse = await fetchImpl(
    `${input.apiOrigin}/api/v1/contributions/${encodeURIComponent(opened.contribution_id)}/finalize`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opened.tracking_token}`,
      },
    },
  );
  const finalized = await responseJson(finalizedResponse, 'Finalisation de la contribution publique');
  if (!finalized.contribution || typeof finalized.contribution !== 'object') {
    throw new PublicEvidenceUploadError('Le reçu final public est incomplet.');
  }
  return safeReceipt(finalized.contribution, digest, idempotencyKey);
}

export async function loadPublicEvidenceInput(options) {
  const content = await readFile(options.file);
  const filename = basename(options.file);
  return {
    apiOrigin: options.apiOrigin,
    fireId: options.fireId,
    location: options.location.trim(),
    observationType: options.observationType.trim(),
    observedAt: options.observedAt,
    mediaCapturedAt: options.mediaCapturedAt,
    direction: options.direction?.trim() || undefined,
    description: options.description.trim(),
    directObservation: options.directObservation,
    filename,
    content,
    contentType: contentType(filename, content),
    idempotencyKey: options.idempotencyKey,
  };
}

async function main() {
  const options = parsePublicEvidenceArguments(process.argv.slice(2));
  const input = await loadPublicEvidenceInput(options);
  if (options.dryRun) {
    const digest = createHash('sha256').update(input.content).digest('hex');
    process.stdout.write(`${JSON.stringify({
      route: 'public_contribution',
      fire_id: input.fireId,
      observed_at: input.observedAt,
      filename: input.filename,
      content_type: input.contentType,
      size_bytes: input.content.length,
      sha256: digest,
      private_analysis: true,
      public_display: false,
      spatial_display: false,
    }, null, 2)}\n`);
    return;
  }
  const receipt = await submitPublicIncidentEvidence(input);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Contribution publique refusée : ${message}\n`);
    process.exitCode = 1;
  });
}
