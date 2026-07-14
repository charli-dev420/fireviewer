#!/usr/bin/env node

import { resolve } from 'node:path';
import { SPATIAL_RELEASE_DEFAULTS, SpatialReleaseError, packSpatialRelease } from './spatial-release.mjs';

function usage() {
  return [
    'Usage : node tools/pack-spatial-release.mjs [options]',
    '',
    'Options :',
    '  --root <dossier>    Racine du paquet spatial.',
    '  --output <dossier>  Dossier de sortie local (hors Git recommandé).',
    '  --lock <fichier>    Verrou de release à contrôler après production.',
    '  --overwrite          Remplace les artefacts homonymes de sortie.',
  ].join('\n');
}

function parseArguments(argumentsList) {
  const options = {
    packageRoot: SPATIAL_RELEASE_DEFAULTS.packageRoot,
    outputDirectory: SPATIAL_RELEASE_DEFAULTS.outputDirectory,
    releaseLockPath: SPATIAL_RELEASE_DEFAULTS.releaseLockPath,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--overwrite') {
      options.overwrite = true;
      continue;
    }
    if (!['--root', '--output', '--lock'].includes(argument) || index + 1 >= argumentsList.length) {
      throw new SpatialReleaseError(usage());
    }
    const value = argumentsList[(index += 1)];
    if (argument === '--root') options.packageRoot = resolve(value);
    if (argument === '--output') options.outputDirectory = resolve(value);
    if (argument === '--lock') options.releaseLockPath = resolve(value);
  }
  return options;
}

try {
  const report = await packSpatialRelease(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Préparation de la release spatiale refusée : ${message}\n`);
  process.exitCode = 1;
}
