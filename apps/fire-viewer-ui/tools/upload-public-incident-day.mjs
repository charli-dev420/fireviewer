#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  IncidentSourceCorpusError,
  buildDailySourcePackage,
} from './incident-source-corpus.mjs';
import { submitPublicIncidentEvidence } from './upload-public-incident-evidence.mjs';

function usage() {
  return [
    'Usage : node tools/upload-public-incident-day.mjs --corpus-root <dossier> [options]',
    '',
    'Options :',
    '  --api-origin <https-url>  Origine API (défaut : https://fireviewer-api.vercel.app).',
    '  --fire-id <id>            Incident cible (défaut : FR-26-00001).',
    '  --day <YYYY-MM-DD>         Journée du manifeste (défaut : première journée).',
    '  --dry-run                  Vérifie et décrit les contributions sans envoi.',
    '',
    'Seules les entrées ingestion_route=public_contribution sont envoyées.',
    'Chaque image traverse le contrat public normal et reste privée.',
  ].join('\n');
}

export function parsePublicDayArguments(argumentsList) {
  const options = {
    apiOrigin: 'https://fireviewer-api.vercel.app',
    fireId: 'FR-26-00001',
    dryRun: false,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!['--api-origin', '--fire-id', '--day', '--corpus-root'].includes(argument) || index + 1 >= argumentsList.length) {
      throw new IncidentSourceCorpusError(usage());
    }
    const value = argumentsList[(index += 1)];
    if (argument === '--api-origin') options.apiOrigin = value;
    if (argument === '--fire-id') options.fireId = value;
    if (argument === '--day') options.day = value;
    if (argument === '--corpus-root') options.corpusRoot = resolve(value);
  }
  if (!options.corpusRoot) throw new IncidentSourceCorpusError(usage());
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

function idempotencyKey(dailyPackage, fireId, contribution) {
  const identity = [
    dailyPackage.corpusId ?? 'corpus',
    fireId,
    dailyPackage.day,
    contribution.manifest.element_id,
    contribution.manifest.sha256,
  ].join('|');
  return `corpus-public-${createHash('sha256').update(identity).digest('hex')}`;
}

export function safePublicDayReport(dailyPackage) {
  return {
    corpus_id: dailyPackage.corpusId,
    day: dailyPackage.day,
    available_days: dailyPackage.availableDays,
    public_contribution_count: dailyPackage.publicContributions.length,
    public_contribution_size_bytes: dailyPackage.publicContributionSizeBytes,
    admin_source_package_file_count: dailyPackage.materials.length,
    source_research_reference_count: dailyPackage.researchReferences.length,
    evaluation_reference_count: dailyPackage.evaluationReferences.length,
    public_contributions: dailyPackage.publicContributions.map((contribution) => ({
      group_index: contribution.manifest.group_index,
      element_id: contribution.manifest.element_id,
      observed_at: contribution.manifest.observed_at,
      media_captured_at: contribution.manifest.media_captured_at,
      filename: contribution.name,
      content_type: contribution.contentType,
      size_bytes: contribution.content.length,
      private_analysis: true,
      public_display: false,
      spatial_display: false,
    })),
  };
}

export async function uploadPublicDay(options, dailyPackage, dependencies = {}) {
  if (!dailyPackage.publicContributions.length) {
    throw new IncidentSourceCorpusError(
      `La journée ${dailyPackage.day} ne contient aucune contribution publique.`,
    );
  }
  const submitEvidence = dependencies.submitEvidence ?? submitPublicIncidentEvidence;
  const receipts = [];
  for (const [index, contribution] of dailyPackage.publicContributions.entries()) {
    const row = contribution.manifest;
    const receipt = await submitEvidence({
      apiOrigin: options.apiOrigin,
      fireId: options.fireId,
      location: row.location_label,
      observationType: row.observation_type,
      observedAt: row.observed_at,
      mediaCapturedAt: row.media_captured_at,
      direction: row.media_direction ?? undefined,
      description: row.description,
      directObservation: row.direct_observation,
      filename: contribution.name,
      content: contribution.content,
      contentType: contribution.contentType,
      idempotencyKey: idempotencyKey(dailyPackage, options.fireId, contribution),
    });
    receipts.push(receipt);
    process.stderr.write(
      `Contribution publique ${index + 1}/${dailyPackage.publicContributions.length} : ${row.element_id}\n`,
    );
  }
  return {
    corpus_id: dailyPackage.corpusId,
    day: dailyPackage.day,
    contribution_count: receipts.length,
    receipts,
  };
}

async function main() {
  const options = parsePublicDayArguments(process.argv.slice(2));
  const dailyPackage = await buildDailySourcePackage(options.corpusRoot, options.day);
  const result = options.dryRun
    ? safePublicDayReport(dailyPackage)
    : await uploadPublicDay(options, dailyPackage);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Journée publique refusée : ${message}\n`);
    process.exitCode = 1;
  });
}
