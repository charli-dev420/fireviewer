import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePublicDayArguments,
  safePublicDayReport,
  uploadPublicDay,
} from './upload-public-incident-day.mjs';

function dailyPackage() {
  return {
    corpusId: 'die-production-campaign-v1',
    day: '2026-07-10',
    availableDays: ['2026-07-10'],
    materials: [{ name: 'official.md' }],
    researchReferences: [{ element_id: 'mairie' }],
    evaluationReferences: [{ element_id: 'effis-truth' }],
    publicContributionSizeBytes: 4,
    publicContributions: [{
      name: '01-user-view.jpg',
      content: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: 'image/jpeg',
      manifest: {
        element_id: 'user-view',
        group_index: 1,
        sha256: 'a'.repeat(64),
        observed_at: '2026-07-10T09:00:00+02:00',
        media_captured_at: '2026-07-10T09:00:00+02:00',
        location_label: 'Die, massif de Justin, Drôme',
        observation_type: 'activité du feu visible',
        description: 'Une ligne active et plusieurs panaches sont visibles depuis la vallée.',
        direct_observation: true,
        media_direction: 'vers le massif de Justin',
      },
    }],
  };
}

test('décrit séparément les deux uploads et les références non injectées', () => {
  const report = safePublicDayReport(dailyPackage());
  assert.equal(report.public_contribution_count, 1);
  assert.equal(report.admin_source_package_file_count, 1);
  assert.equal(report.source_research_reference_count, 1);
  assert.equal(report.evaluation_reference_count, 1);
  assert.equal(report.public_contributions[0].public_display, false);
});

test('envoie seulement les contributions publiques avec une clé stable', async () => {
  const calls = [];
  const result = await uploadPublicDay({
    apiOrigin: 'https://fireviewer-api.vercel.app',
    fireId: 'FR-26-00001',
  }, dailyPackage(), {
    submitEvidence: async (input) => {
      calls.push(input);
      return { contribution_id: 'PC-0001', state: 'PENDING' };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].location, 'Die, massif de Justin, Drôme');
  assert.equal(calls[0].directObservation, true);
  assert.match(calls[0].idempotencyKey, /^corpus-public-[a-f0-9]{64}$/u);
  assert.equal(result.contribution_count, 1);
});

test('refuse une origine non HTTPS avant le chargement du corpus', () => {
  assert.throws(
    () => parsePublicDayArguments(['--corpus-root', '.', '--api-origin', 'http://localhost:8000']),
    /origine HTTPS/u,
  );
});
