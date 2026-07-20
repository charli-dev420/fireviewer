import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  IncidentSourceCorpusError,
  buildDailySourcePackage,
  listCorpusDays,
  loadOperationalManifest,
} from './incident-source-corpus.mjs';

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fireviewer-source-corpus-'));
  await mkdir(join(root, 'days', '2026-07-05'), { recursive: true });
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const geometry = gzipSync(Buffer.from('{"type":"FeatureCollection","features":[]}'));
  await writeFile(join(root, 'days', '2026-07-05', 'satellite.jpg'), image);
  await writeFile(join(root, 'days', '2026-07-05', 'geometry.geojson.gz'), geometry);
  const rows = [
    {
      corpus_id: 'fixture-v1', element_id: 'satellite', group_date: '2026-07-05', group_index: 1,
      captured_at: '2026-07-05T00:00:00Z', kind: 'satellite_image', media_type: 'satellite_image',
      local_path: 'days/2026-07-05/satellite.jpg', byte_count: image.length, sha256: digest(image),
    },
    {
      corpus_id: 'fixture-v1', element_id: 'geometry', group_date: '2026-07-05', group_index: 2,
      captured_at: '2026-07-05T12:00:00Z', kind: 'event_geometry', media_type: 'geojson_gzip',
      local_path: 'days/2026-07-05/geometry.geojson.gz', byte_count: geometry.length, sha256: digest(geometry),
    },
  ];
  await writeFile(join(root, 'manifest.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return { root, rows };
}

test('compose la première journée à partir de la classification du manifeste', async () => {
  const { root } = await fixture();
  const rows = await loadOperationalManifest(root);
  assert.deepEqual(listCorpusDays(rows), ['2026-07-05']);
  const daily = await buildDailySourcePackage(root);
  assert.equal(daily.day, '2026-07-05');
  assert.equal(daily.materials.length, 2);
  assert.equal(daily.materials[0].contentType, 'image/jpeg');
  assert.equal(daily.materials[0].transformed, false);
  assert.equal(daily.materials[1].contentType, 'text/markdown');
  assert.equal(daily.materials[1].transformed, true);
  assert.match(daily.materials[1].content.toString('utf8'), /FeatureCollection/u);
  assert.match(daily.materials[1].content.toString('utf8'), /2026-07-05T12:00:00Z/u);
});

test('refuse un fichier dont les octets ne correspondent plus au manifeste', async () => {
  const { root } = await fixture();
  await writeFile(join(root, 'days', '2026-07-05', 'satellite.jpg'), Buffer.from('changed'));
  await assert.rejects(
    () => buildDailySourcePackage(root, '2026-07-05'),
    (error) => error instanceof IncidentSourceCorpusError && /Empreinte divergente/u.test(error.message),
  );
});

test('refuse de sélectionner une date absente', async () => {
  const { root } = await fixture();
  await assert.rejects(
    () => buildDailySourcePackage(root, '2026-07-06'),
    (error) => error instanceof IncidentSourceCorpusError && /Journée absente/u.test(error.message),
  );
});
