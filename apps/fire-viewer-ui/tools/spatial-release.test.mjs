import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  SpatialReleaseError,
  createDeterministicTarGz,
  createTarHeader,
  extractVerifiedTarGz,
  fetchSpatialRelease,
  releaseLockPatch,
  verifySpatialReleaseContract,
  verifyArchiveFile,
} from './spatial-release.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function temporaryDirectory(prefix, callback) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeAsset(root, relativePath, contents) {
  const path = resolve(root, ...relativePath.split('/'));
  const directory = dirname(path);
  await (await import('node:fs/promises')).mkdir(directory, { recursive: true });
  await writeFile(path, contents);
  return {
    path: relativePath,
    absolutePath: path,
    byteCount: Buffer.byteLength(contents),
    sha256: sha256(contents),
  };
}

function rawTarHeader({ path, byteCount, type = 0 }) {
  const header = Buffer.alloc(512, 0);
  header.write(path, 0, 'ascii');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write(byteCount.toString(8).padStart(11, '0'), 124, 'ascii');
  header[135] = 0;
  header.write('00000000000', 136, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = type;
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0'), 148, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

async function rawArchive(path, entry) {
  const body = Buffer.from(entry.contents || 'x');
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  const tar = Buffer.concat([rawTarHeader({ path: entry.path, byteCount: body.length, type: entry.type }), body, padding, Buffer.alloc(1024)]);
  await writeFile(path, gzipSync(tar, { mtime: 0 }));
}

test('archive TAR.GZ déterministe : seulement les binaires, mêmes octets et mêmes checksums', async () => {
  await temporaryDirectory('fireviewer-spatial-release-', async (directory) => {
    const source = join(directory, 'source');
    const entries = [
      await writeAsset(source, 'terrain/a.cog.tif', 'elevation-fixture'),
      await writeAsset(source, 'vectors/b.glb', 'glb-fixture'),
    ];
    const first = await createDeterministicTarGz({ entries, archivePath: join(directory, 'first.tar.gz') });
    const second = await createDeterministicTarGz({ entries, archivePath: join(directory, 'second.tar.gz') });

    assert.equal(first.sha256, second.sha256);
    assert.equal(first.byteCount, second.byteCount);
    await assert.doesNotReject(() => verifyArchiveFile(first));
    await writeFile(first.archivePath, Buffer.concat([await readFile(first.archivePath), Buffer.from('tamper')]));
    await assert.rejects(() => verifyArchiveFile(first), /Taille d’archive incohérente/);
    await rm(first.archivePath);
    await createDeterministicTarGz({ entries, archivePath: first.archivePath });

    const staging = join(directory, 'staging');
    const extracted = await extractVerifiedTarGz({
      archivePath: first.archivePath,
      expectedEntries: entries,
      destinationRoot: staging,
      maxTarByteCount: first.tarByteCount,
    });
    assert.equal(extracted.entryCount, 2);
    assert.equal(await readFile(join(staging, 'terrain', 'a.cog.tif'), 'utf8'), 'elevation-fixture');
    assert.equal(await readFile(join(staging, 'vectors', 'b.glb'), 'utf8'), 'glb-fixture');
  });
});

test('refuse les chemins hostiles et les liens TAR avant toute installation', async () => {
  await temporaryDirectory('fireviewer-spatial-release-', async (directory) => {
    const expected = [
      {
        path: 'terrain/a.cog.tif',
        absolutePath: join(directory, 'unused'),
        byteCount: 1,
        sha256: sha256('x'),
      },
    ];
    for (const entry of [
      { label: 'traversal', path: '../outside', type: 0 },
      { label: 'symlink', path: 'terrain/a.cog.tif', type: 2 },
    ]) {
      const archivePath = join(directory, `${entry.label}.tar.gz`);
      await rawArchive(archivePath, entry);
      const staging = join(directory, `${entry.label}-staging`);
      await assert.rejects(
        () => extractVerifiedTarGz({ archivePath, expectedEntries: expected, destinationRoot: staging, maxTarByteCount: 1536 }),
        (error) => error instanceof SpatialReleaseError,
      );
    }
  });
});

test('fetch installe les deux dossiers seulement après vérification complète et conserve un root propre sur échec', async () => {
  await temporaryDirectory('fireviewer-spatial-release-', async (directory) => {
    const project = join(directory, 'project');
    const packageRoot = join(project, 'apps', 'fire-viewer-ui', 'public', 'maps', 'fixture');
    const source = join(directory, 'source');
    const entries = [
      await writeAsset(source, 'terrain/a.cog.tif', 'elevation-fixture'),
      await writeAsset(source, 'vectors/b.glb', 'glb-fixture'),
    ];
    await (await import('node:fs/promises')).mkdir(packageRoot, { recursive: true });
    const catalogContents = '{"fixture":true}\n';
    const manifestContents = '{"package_id":"fixture-package"}\n';
    await writeFile(join(packageRoot, 'catalog.json'), catalogContents);
    await writeFile(join(packageRoot, 'package-manifest.json'), manifestContents);
    const archive = await createDeterministicTarGz({ entries, archivePath: join(directory, 'fixture.tar.gz') });
    const provenanceDirectory = join(project, 'contracts', 'spatial', 'releases');
    await (await import('node:fs/promises')).mkdir(provenanceDirectory, { recursive: true });
    const provenancePath = join(provenanceDirectory, 'ign_sources.v1.json');
    await writeFile(provenancePath, '{"fixture":true}\n');
    const provenanceContents = await readFile(provenancePath);
    const catalogBuffer = Buffer.from(catalogContents);
    const lock = releaseLockPatch({
      packageId: 'fixture-package',
      publicRoot: '/maps/fixture/',
      zone: { zoneId: 'DIE-PONTAIX-08', revisionId: 'R1' },
      catalog: { path: 'catalog.json', sha256: sha256(catalogBuffer), byteCount: catalogBuffer.byteLength },
      provenance: { path: 'contracts/spatial/releases/ign_sources.v1.json', sha256: sha256(provenanceContents), byteCount: provenanceContents.byteLength },
      release: {
        repository: 'charli-dev420/fireviewer',
        tag: 'fixture',
        assetName: 'fixture.tar.gz',
        url: 'https://example.test/fixture.tar.gz',
        sha256: archive.sha256,
        byteCount: archive.byteCount,
        tarByteCount: archive.tarByteCount,
        assetCount: entries.length,
        assetByteCount: entries.reduce((total, entry) => total + entry.byteCount, 0),
      },
    });
    const lockPath = join(provenanceDirectory, 'fixture.release-lock.json');
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const loadPackage = async () => ({
      root: packageRoot,
      packageId: 'fixture-package',
      catalogPath: join(packageRoot, 'catalog.json'),
      manifestPath: join(packageRoot, 'package-manifest.json'),
      catalogBuffer,
      catalogSha256: sha256(catalogBuffer),
      catalogByteCount: catalogBuffer.byteLength,
      packageManifest: { package_id: 'fixture-package' },
      entries,
    });
    const verifyPackage = async (root) => {
      assert.equal(await readFile(join(root, 'catalog.json'), 'utf8'), catalogContents);
      assert.equal(await readFile(join(root, 'package-manifest.json'), 'utf8'), manifestContents);
      for (const entry of entries) {
        assert.equal(await readFile(resolve(root, ...entry.path.split('/')), 'utf8'), await readFile(entry.absolutePath, 'utf8'));
      }
      return { verified_root: root };
    };

    const result = await fetchSpatialRelease({
      packageRoot,
      releaseLockPath: lockPath,
      archivePath: archive.archivePath,
      dependencies: { loadPackage, verifyPackage },
    });
    assert.equal(result.status, 'ok');
    assert.equal(await readFile(join(packageRoot, 'terrain', 'a.cog.tif'), 'utf8'), 'elevation-fixture');
    assert.equal(await readFile(join(packageRoot, 'vectors', 'b.glb'), 'utf8'), 'glb-fixture');
    const contract = await verifySpatialReleaseContract({
      packageRoot,
      releaseLockPath: lockPath,
      dependencies: { loadPackage, verifyPackage },
    });
    assert.equal(contract.status, 'ok');

    await rm(join(packageRoot, 'terrain'), { recursive: true, force: true });
    await rm(join(packageRoot, 'vectors'), { recursive: true, force: true });
    await assert.rejects(
      () =>
        fetchSpatialRelease({
          packageRoot,
          releaseLockPath: lockPath,
          archivePath: archive.archivePath,
          dependencies: {
            loadPackage,
            verifyPackage: async () => {
              throw new Error('vérification synthétique refusée');
            },
          },
        }),
      /ne valide pas avant installation/,
    );
    await assert.rejects(() => readFile(join(packageRoot, 'terrain', 'a.cog.tif')));
    await assert.rejects(() => readFile(join(packageRoot, 'vectors', 'b.glb')));

    let verificationCallCount = 0;
    await assert.rejects(
      () =>
        fetchSpatialRelease({
          packageRoot,
          releaseLockPath: lockPath,
          archivePath: archive.archivePath,
          dependencies: {
            loadPackage,
            verifyPackage: async (root) => {
              verificationCallCount += 1;
              await verifyPackage(root);
              if (verificationCallCount === 2) throw new Error('vérification après installation refusée');
              return { verified_root: root };
            },
          },
        }),
      /vérification après installation refusée/,
    );
    await assert.rejects(() => readFile(join(packageRoot, 'terrain', 'a.cog.tif')));
    await assert.rejects(() => readFile(join(packageRoot, 'vectors', 'b.glb')));
  });
});

test('le verrou exige HTTPS et les tailles/hashs exacts', async () => {
  assert.throws(
    () =>
      releaseLockPatch({
        packageId: 'fixture-package',
        publicRoot: '/maps/fixture/',
        zone: { zoneId: 'DIE-PONTAIX-08', revisionId: 'R1' },
        catalog: { path: 'catalog.json', sha256: '0'.repeat(64), byteCount: 1 },
        provenance: { path: 'contracts/spatial/releases/ign_sources.v1.json', sha256: '0'.repeat(64), byteCount: 1 },
        release: {
          repository: 'charli-dev420/fireviewer',
          tag: 'fixture',
          assetName: 'fixture.tar.gz',
          url: 'http://example.test/fixture.tar.gz',
          sha256: '0'.repeat(64),
          byteCount: 1,
          tarByteCount: 1,
          assetCount: 1,
          assetByteCount: 1,
        },
      }),
    (error) => error instanceof SpatialReleaseError && /HTTPS/.test(error.message),
  );
});
