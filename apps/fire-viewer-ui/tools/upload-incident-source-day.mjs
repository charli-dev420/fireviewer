#!/usr/bin/env node

import { resolve } from 'node:path';
import { upload } from '@vercel/blob/client';
import { adminPost, authenticateAdmin } from './admin-api-session.mjs';
import {
  IncidentSourceCorpusError,
  buildDailySourcePackage,
} from './incident-source-corpus.mjs';

function usage() {
  return [
    'Usage : node tools/upload-incident-source-day.mjs --corpus-root <dossier> --credentials-file <fichier> [options]',
    '',
    'Options :',
    '  --api-origin <https-url>  Origine API (défaut : https://fireviewer-api.vercel.app).',
    '  --fire-id <id>            Incident cible (défaut : FR-26-00001).',
    '  --day <YYYY-MM-DD>         Journée du manifeste (défaut : première journée).',
    '  --location <texte>         Indication géographique privée.',
    '  --dry-run                  Vérifie et décrit le lot sans connexion ni envoi.',
  ].join('\n');
}

function parseArguments(argumentsList) {
  const options = {
    apiOrigin: 'https://fireviewer-api.vercel.app',
    fireId: 'FR-26-00001',
    location: 'Die, massif de Justin, Drôme',
    dryRun: false,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!['--api-origin', '--fire-id', '--day', '--location', '--corpus-root', '--credentials-file'].includes(argument) || index + 1 >= argumentsList.length) {
      throw new IncidentSourceCorpusError(usage());
    }
    const value = argumentsList[(index += 1)];
    if (argument === '--api-origin') options.apiOrigin = value;
    if (argument === '--fire-id') options.fireId = value;
    if (argument === '--day') options.day = value;
    if (argument === '--location') options.location = value;
    if (argument === '--corpus-root') options.corpusRoot = resolve(value);
    if (argument === '--credentials-file') options.credentialsFile = resolve(value);
  }
  if (!options.corpusRoot) throw new IncidentSourceCorpusError(usage());
  if (!options.dryRun && !options.credentialsFile) throw new IncidentSourceCorpusError(usage());
  const origin = new URL(options.apiOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
    throw new IncidentSourceCorpusError('--api-origin doit être une origine HTTPS sans chemin ni identifiants.');
  }
  options.apiOrigin = origin.origin;
  if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/u.test(options.fireId)) {
    throw new IncidentSourceCorpusError('--fire-id est invalide.');
  }
  return options;
}

function safeReport(dailyPackage) {
  return {
    corpus_id: dailyPackage.corpusId,
    day: dailyPackage.day,
    available_days: dailyPackage.availableDays,
    file_count: dailyPackage.materials.length,
    total_size_bytes: dailyPackage.totalSizeBytes,
    files: dailyPackage.materials.map((material) => ({
      group_index: material.manifest.group_index,
      element_id: material.manifest.element_id,
      captured_at: material.manifest.captured_at ?? null,
      declared_media_type: material.manifest.media_type,
      upload_name: material.name,
      upload_content_type: material.contentType,
      transformed_to_context_document: material.transformed,
      size_bytes: material.content.length,
    })),
  };
}

async function uploadPackage(options, dailyPackage) {
  const session = await authenticateAdmin(options.apiOrigin, options.credentialsFile);
  const idempotencyBase = `corpus:${dailyPackage.corpusId}:${options.fireId}:${dailyPackage.day}:v1`;
  const opened = await adminPost(
    options.apiOrigin,
    session,
    `/api/v2/admin/agent-batches/incidents/${encodeURIComponent(options.fireId)}/source-packages/open`,
    {
      file_count: dailyPackage.materials.length,
      total_size_bytes: dailyPackage.totalSizeBytes,
      known_start_date: dailyPackage.day,
      known_end_date: dailyPackage.day,
      location_hint: options.location,
      authorize_private_analysis: true,
    },
    `${idempotencyBase}:open`,
  );
  if (!opened || typeof opened !== 'object' || typeof opened.package_id !== 'string' || typeof opened.pathname_prefix !== 'string' || typeof opened.upload_grant !== 'string') {
    throw new IncidentSourceCorpusError('Le contrat d’ouverture du transfert est invalide.');
  }
  const allowed = new Set(opened.allowed_content_types ?? []);
  for (const material of dailyPackage.materials) {
    if (!allowed.has(material.contentType)) {
      throw new IncidentSourceCorpusError(`Type refusé par le transfert privé : ${material.contentType}.`);
    }
    if (material.content.length > opened.maximum_file_size_bytes) {
      throw new IncidentSourceCorpusError(`Fichier trop volumineux : ${material.name}.`);
    }
  }

  let completed = 0;
  for (const material of dailyPackage.materials) {
    const file = new File([material.content], material.name, { type: material.contentType });
    await upload(`${opened.pathname_prefix}/${material.name}`, file, {
      access: 'private',
      handleUploadUrl: `${options.apiOrigin}/api/v1/admin/blob-upload-token`,
      headers: { 'X-Blob-Upload-Grant': opened.upload_grant },
      clientPayload: opened.package_id,
      contentType: material.contentType,
      multipart: true,
    });
    completed += 1;
    process.stderr.write(`Transfert privé ${completed}/${dailyPackage.materials.length} : ${material.name}\n`);
  }

  const finalized = await adminPost(
    options.apiOrigin,
    session,
    `/api/v2/admin/agent-batches/source-packages/${encodeURIComponent(opened.package_id)}/finalize`,
    {},
    `${idempotencyBase}:finalize`,
  );
  return {
    package_id: finalized.package_id,
    state: finalized.state,
    known_start_date: finalized.known_start_date,
    known_end_date: finalized.known_end_date,
    item_count: finalized.items?.length ?? null,
    batch_ids: finalized.batch_ids ?? [],
    analysis_authorized: finalized.analysis_authorized,
    publication_authorized: finalized.publication_authorized,
  };
}

try {
  const options = parseArguments(process.argv.slice(2));
  const dailyPackage = await buildDailySourcePackage(options.corpusRoot, options.day);
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(safeReport(dailyPackage), null, 2)}\n`);
  } else {
    const result = await uploadPackage(options, dailyPackage);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Lot de sources refusé : ${message}\n`);
  process.exitCode = 1;
}
