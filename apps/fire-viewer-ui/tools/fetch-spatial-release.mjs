#!/usr/bin/env node

import { resolve } from 'node:path';
import { SPATIAL_RELEASE_DEFAULTS, SpatialReleaseError, fetchSpatialRelease } from './spatial-release.mjs';

function usage() {
  return [
    'Usage : node tools/fetch-spatial-release.mjs [options]',
    '',
    'Options :',
    '  --root <dossier>   Racine du paquet spatial qui contient catalogue et manifeste.',
    '  --lock <fichier>   Verrou de release versionné.',
    '  --archive <fichier> Archive locale à vérifier (aucun téléchargement).',
    '  --url <https-url>   URL HTTPS alternative, toujours vérifiée par le verrou.',
  ].join('\n');
}

function parseArguments(argumentsList) {
  const options = {
    packageRoot: SPATIAL_RELEASE_DEFAULTS.packageRoot,
    releaseLockPath: SPATIAL_RELEASE_DEFAULTS.releaseLockPath,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!['--root', '--lock', '--archive', '--url'].includes(argument) || index + 1 >= argumentsList.length) {
      throw new SpatialReleaseError(usage());
    }
    const value = argumentsList[(index += 1)];
    if (argument === '--root') options.packageRoot = resolve(value);
    if (argument === '--lock') options.releaseLockPath = resolve(value);
    if (argument === '--archive') options.archivePath = resolve(value);
    if (argument === '--url') options.archiveUrl = value;
  }
  if (options.archivePath && options.archiveUrl) throw new SpatialReleaseError('Choisir --archive ou --url, pas les deux.');
  return options;
}

try {
  const report = await fetchSpatialRelease(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Récupération de la release spatiale refusée : ${message}\n`);
  process.exitCode = 1;
}
