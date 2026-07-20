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
  assert.match(daily.materials[1].content.toString('utf8'), /Résumé géométrique déterministe/u);
});

test('borne une géométrie officielle détaillée sans perdre son emprise ni son comptage', async () => {
  const { root, rows } = await fixture();
  const coordinates = Array.from({ length: 20_000 }, (_, index) => [
    5.25 + index / 1_000_000,
    44.62 + index / 1_000_000,
  ]);
  coordinates.push(coordinates[0]);
  const geometry = gzipSync(Buffer.from(JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { area: 1188.4, event_type: 'Wildfire' },
      geometry: { type: 'Polygon', coordinates: [coordinates] },
    }],
  })));
  await writeFile(join(root, 'days', '2026-07-05', 'geometry.geojson.gz'), geometry);
  rows[1].byte_count = geometry.length;
  rows[1].sha256 = digest(geometry);
  await writeFile(join(root, 'manifest.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const daily = await buildDailySourcePackage(root, '2026-07-05');
  const document = daily.materials[1].content.toString('utf8');
  assert.ok(daily.materials[1].content.length < 100_000);
  assert.match(document, /"coordinate_points": 20001/u);
  assert.match(document, /"area": 1188\.4/u);
  assert.match(document, /"bbox": \[/u);
  assert.doesNotMatch(document, /5\.250001,44\.620001/u);
});

test('vérifie mais exclut la vérité de référence du lot envoyé au modèle', async () => {
  const { root, rows } = await fixture();
  rows[1].pipeline_input = false;
  rows[1].evaluation_reference = true;
  await writeFile(join(root, 'manifest.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const daily = await buildDailySourcePackage(root, '2026-07-05');
  assert.equal(daily.materials.length, 1);
  assert.equal(daily.materials[0].manifest.element_id, 'satellite');
  assert.deepEqual(daily.evaluationReferences, [{
    element_id: 'geometry',
    kind: 'event_geometry',
    media_type: 'geojson_gzip',
    sha256: rows[1].sha256,
    source_id: null,
    source_url: null,
    captured_at: '2026-07-05T12:00:00Z',
    published_at: null,
  }]);
});

test('sépare une contribution publique du package administrateur sans changer ses octets', async () => {
  const { root, rows } = await fixture();
  Object.assign(rows[0], {
    ingestion_route: 'public_contribution',
    pipeline_input: true,
    evaluation_reference: false,
    observed_at: '2026-07-05T08:30:00+02:00',
    media_captured_at: '2026-07-05T08:25:00+02:00',
    location_label: 'Die, massif de Justin, Drôme',
    observation_type: 'activité du feu visible',
    description: 'Une ligne de feu est visible sur le versant depuis la vallée de Die.',
    direct_observation: true,
    media_direction: 'vers le sud-ouest',
  });
  await writeFile(join(root, 'manifest.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const daily = await buildDailySourcePackage(root, '2026-07-05');
  assert.equal(daily.publicContributions.length, 1);
  assert.equal(daily.publicContributions[0].manifest.element_id, 'satellite');
  assert.equal(daily.publicContributions[0].contentType, 'image/jpeg');
  assert.equal(daily.materials.length, 1);
  assert.equal(daily.materials[0].manifest.element_id, 'geometry');
  assert.equal(daily.publicContributionSizeBytes, 4);
});

test('vérifie une référence de recherche mais ne l’envoie dans aucun upload', async () => {
  const { root, rows } = await fixture();
  Object.assign(rows[1], {
    ingestion_route: 'source_research_reference',
    pipeline_input: false,
    evaluation_reference: false,
    source_url: 'https://www.mairie-die.fr/actualite/point-feu',
    published_at: '2026-07-05T09:00:00+02:00',
  });
  await writeFile(join(root, 'manifest.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const daily = await buildDailySourcePackage(root, '2026-07-05');
  assert.equal(daily.materials.length, 1);
  assert.equal(daily.publicContributions.length, 0);
  assert.deepEqual(daily.researchReferences, [{
    element_id: 'geometry',
    kind: 'event_geometry',
    media_type: 'geojson_gzip',
    sha256: rows[1].sha256,
    source_id: null,
    source_url: 'https://www.mairie-die.fr/actualite/point-feu',
    captured_at: '2026-07-05T12:00:00Z',
    published_at: '2026-07-05T09:00:00+02:00',
  }]);
});

test('refuse une route publique sans déclaration humaine complète', async () => {
  const { root, rows } = await fixture();
  Object.assign(rows[0], {
    ingestion_route: 'public_contribution',
    pipeline_input: true,
    evaluation_reference: false,
  });
  await writeFile(join(root, 'manifest.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  await assert.rejects(
    () => loadOperationalManifest(root),
    (error) => error instanceof IncidentSourceCorpusError && /direct_observation invalide/u.test(error.message),
  );
});

test('refuse de marquer comme évaluation une entrée destinée à un upload', async () => {
  const { root, rows } = await fixture();
  Object.assign(rows[0], {
    ingestion_route: 'admin_source_package',
    pipeline_input: true,
    evaluation_reference: true,
  });
  await writeFile(join(root, 'manifest.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  await assert.rejects(
    () => loadOperationalManifest(root),
    (error) => error instanceof IncidentSourceCorpusError && /Rôle de pipeline incohérent/u.test(error.message),
  );
});

test('refuse un rôle de pipeline non booléen', async () => {
  const { root, rows } = await fixture();
  rows[0].pipeline_input = 'false';
  await writeFile(join(root, 'manifest.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  await assert.rejects(
    () => loadOperationalManifest(root),
    (error) => error instanceof IncidentSourceCorpusError && /pipeline_input invalide/u.test(error.message),
  );
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
