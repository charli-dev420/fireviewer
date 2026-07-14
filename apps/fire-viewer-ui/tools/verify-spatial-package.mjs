#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SpatialPackageVerificationError } from './spatial-package-verifier.mjs';
import { SpatialReleaseError, verifySpatialReleaseContract } from './spatial-release.mjs';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(currentDirectory, '../public/maps/fireviewer-die-pontaix-r1-v4');
const defaultLock = resolve(currentDirectory, '../../../contracts/spatial/releases/fireviewer-die-pontaix-r1-v4.release-lock.json');

function packageRootFromArguments(argumentsList) {
  const options = { packageRoot: defaultRoot, releaseLockPath: defaultLock };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!['--root', '--lock'].includes(argument) || index + 1 >= argumentsList.length) {
      throw new SpatialPackageVerificationError('Usage : node tools/verify-spatial-package.mjs [--root <dossier>] [--lock <fichier>].');
    }
    const value = argumentsList[(index += 1)];
    if (argument === '--root') options.packageRoot = resolve(value);
    if (argument === '--lock') options.releaseLockPath = resolve(value);
  }
  return options;
}

try {
  const report = await verifySpatialReleaseContract(packageRootFromArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ status: 'ok', ...report }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Vérification du paquet spatial refusée : ${message}\n`);
  process.exitCode = 1;
}
