import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PublicEvidenceUploadError,
  parsePublicEvidenceArguments,
  submitPublicIncidentEvidence,
} from './upload-public-incident-evidence.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('envoie une image par le vrai contrat public puis masque le jeton du reçu', async () => {
  const calls = [];
  const uploads = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/v1/contributions/open')) {
      return jsonResponse(201, {
        contribution_id: 'PC-DIE-0001',
        state: 'OPEN',
        tracking_token: 'secret-tracking-token',
        upload: {
          package_id: 'SP-DIE-0001',
          pathname_prefix: 'firewarning/source-packages/public-die-0001',
          upload_grant: 'g'.repeat(128),
          maximum_file_size_bytes: 16_777_216,
          allowed_content_types: ['image/jpeg', 'image/png', 'image/webp'],
        },
        replayed: false,
      });
    }
    return jsonResponse(202, {
      contribution: {
        contribution_id: 'PC-DIE-0001',
        fire_id: 'FR-26-00001',
        state: 'PENDING',
        observed_at: '2026-07-10T09:00:00+02:00',
        media_count: 1,
      },
    });
  };
  const uploader = async (pathname, file, options) => {
    uploads.push({ pathname, file, options });
  };

  const receipt = await submitPublicIncidentEvidence({
    apiOrigin: 'https://fireviewer-api.vercel.app',
    fireId: 'FR-26-00001',
    location: 'Die, massif de Justin, Drôme',
    observationType: 'front de flammes',
    observedAt: '2026-07-10T09:00:00+02:00',
    mediaCapturedAt: null,
    direction: 'vers le nord-est',
    description: 'Un front de flammes est visible sur le versant au-dessus de Die.',
    directObservation: true,
    filename: 'preuve-die.jpg',
    content: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    contentType: 'image/jpeg',
    idempotencyKey: 'die-public-2026-07-10-0001',
  }, { fetchImpl, uploader });

  assert.equal(calls.length, 2);
  const opened = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://fireviewer-api.vercel.app/api/v1/contributions/open');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'die-public-2026-07-10-0001');
  assert.equal(opened.kind, 'incident_evidence');
  assert.equal(opened.observation.observed_at, '2026-07-10T09:00:00+02:00');
  assert.equal(opened.consents.private_analysis, true);
  assert.equal(opened.consents.retain_evidence, true);
  assert.equal(opened.consents.public_display, false);
  assert.equal(opened.consents.spatial_display, false);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].options.access, 'private');
  assert.equal(
    uploads[0].options.handleUploadUrl,
    'https://fireviewer-api.vercel.app/api/v1/contributions/blob-upload-token',
  );
  assert.equal(calls[1].options.headers.Authorization, 'Bearer secret-tracking-token');
  assert.equal(receipt.state, 'PENDING');
  assert.equal(receipt.public_display, false);
  assert.equal(receipt.spatial_display, false);
  assert.equal('tracking_token' in receipt, false);
  assert.doesNotMatch(JSON.stringify(receipt), /secret-tracking-token/u);
});

test('une relance idempotente lit le reçu existant sans transférer de nouveau le média', async () => {
  const calls = [];
  let uploadCount = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/v1/contributions/open')) {
      return jsonResponse(201, {
        contribution_id: 'PC-DIE-REPLAY',
        state: 'PENDING',
        tracking_token: 'replay-tracking-token',
        upload: null,
        replayed: true,
      });
    }
    return jsonResponse(200, {
      contribution: {
        contribution_id: 'PC-DIE-REPLAY',
        fire_id: 'FR-26-00001',
        state: 'PENDING',
        observed_at: '2026-07-10T09:00:00+02:00',
        media_count: 1,
      },
    });
  };

  const receipt = await submitPublicIncidentEvidence({
    apiOrigin: 'https://fireviewer-api.vercel.app',
    fireId: 'FR-26-00001',
    location: 'Die, massif de Justin, Drôme',
    observationType: 'front de flammes',
    observedAt: '2026-07-10T09:00:00+02:00',
    mediaCapturedAt: null,
    direction: null,
    description: 'Un front de flammes est visible sur le versant au-dessus de Die.',
    directObservation: true,
    filename: 'preuve-die.jpg',
    content: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    contentType: 'image/jpeg',
    idempotencyKey: 'die-public-2026-07-10-replay',
  }, { fetchImpl, uploader: async () => { uploadCount += 1; } });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(uploadCount, 0);
  assert.equal(receipt.media_count, 1);
  assert.equal(receipt.state, 'PENDING');
});

test('refuse une date sans fuseau avant toute lecture ou requête', () => {
  assert.throws(
    () => parsePublicEvidenceArguments([
      '--file', 'preuve.jpg',
      '--observed-at', '2026-07-10T09:00:00',
      '--description', 'Un front de flammes est visible au-dessus de la ville de Die.',
    ]),
    (error) => error instanceof PublicEvidenceUploadError && /fuseau horaire/u.test(error.message),
  );
});

test('refuse un endpoint qui ne correspond pas à une origine HTTPS', () => {
  assert.throws(
    () => parsePublicEvidenceArguments([
      '--api-origin', 'http://localhost:8000/api',
      '--file', 'preuve.jpg',
      '--observed-at', '2026-07-10T09:00:00+02:00',
      '--description', 'Un front de flammes est visible au-dessus de la ville de Die.',
    ]),
    (error) => error instanceof PublicEvidenceUploadError && /origine HTTPS/u.test(error.message),
  );
});
