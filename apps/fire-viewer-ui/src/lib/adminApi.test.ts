// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdminApiClient,
  AdminApiError,
  createAdminIdempotencyKey,
} from './adminApi';

const API_ORIGIN = 'http://localhost:8000';
const SESSION = { token: 'admin-opaque-token' };

function zone(overrides: Record<string, unknown> = {}) {
  return {
    zone_id: 'TEST-ZONE-01',
    label: 'Zone de test',
    description: 'Zone synthétique pour les tests.',
    visibility: 'DRAFT',
    bounds_l93_m: [876000, 6403000, 892000, 6413000],
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:00Z',
    ...overrides,
  };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('client API d’administration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('charge les zones en transmettant le bearer uniquement à l’origine API contrôlée', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ zones: [zone()] }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await expect(client.listZones()).resolves.toMatchObject([{ zone_id: 'TEST-ZONE-01' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_ORIGIN}/api/v1/admin/zones`,
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
        headers: expect.objectContaining({ Authorization: 'Bearer admin-opaque-token' }),
      }),
    );
  });

  it('crée une zone avec une clé idempotente et normalise son identifiant', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ zone: zone(), trace_id: 'trace-zone-create' }, 201));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await client.createZone({
      zone_id: 'test-zone-01',
      label: 'Zone de test',
      description: 'Zone synthétique pour les tests.',
      bounds_l93_m: [876000, 6403000, 892000, 6413000],
      reason: 'Création de test.',
    }, { idempotencyKey: 'create-zone-0001' });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': 'create-zone-0001' }));
    expect(JSON.parse(String(request.body))).toMatchObject({ zone_id: 'TEST-ZONE-01' });
  });

  it('obtient une autorisation Blob privée limitée au package demandé', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      upload_id: 'a'.repeat(32),
      pathname_prefix: `packages/${'a'.repeat(32)}`,
      upload_grant: 'grant-signe',
      expires_at: '2026-07-14T10:10:00Z',
      maximum_file_size_bytes: 5_000_000_000,
      allowed_content_types: ['application/json', 'image/png', 'image/tiff', 'model/gltf-binary'],
    }, 201));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await expect(client.createSpatialPackageUploadGrant('TEST-ZONE-01', 2, {
      package_id: 'pkg-zone-r2',
      file_count: 3,
      total_size_bytes: 456,
    })).resolves.toMatchObject({
      upload_id: 'a'.repeat(32),
      pathname_prefix: `packages/${'a'.repeat(32)}`,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${API_ORIGIN}/api/v1/admin/zones/TEST-ZONE-01/revisions/2/packages/upload-grant`);
    expect(init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect(JSON.parse(String(init?.body))).toEqual({ package_id: 'pkg-zone-r2', file_count: 3, total_size_bytes: 456 });
    expect(client.getBlobUploadTokenUrl()).toBe(`${API_ORIGIN}/api/v1/admin/blob-upload-token`);
  });

  it('rafraîchit explicitement la session pendant un envoi Blob long', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      authenticated: true,
      csrf_token: 'csrf-session-active',
    }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await expect(client.refreshAdminSession()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_ORIGIN}/api/v1/admin/session`,
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
      }),
    );
  });

  it('finalise uniquement des références Blob JSON, sans corps binaire', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      package: {
        package_id: 'pkg-zone-r2',
        state: 'DRAFT',
        upload_id: 'a'.repeat(32),
        object_count: 3,
        total_size_bytes: 456,
        asset_count: 1,
        validation_summary: 'Objets Blob contrôlés.',
      },
      trace_id: 'trace-package-finalize',
    }, 201));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });
    const objects = [
      { path: 'package-manifest.json', pathname: `packages/${'a'.repeat(32)}/package-manifest.json`, size_bytes: 100, content_type: 'application/json' },
      { path: 'catalog.json', pathname: `packages/${'a'.repeat(32)}/catalog.json`, size_bytes: 156, content_type: 'application/json' },
      { path: 'assets/model.glb', pathname: `packages/${'a'.repeat(32)}/assets/model.glb`, size_bytes: 200, content_type: 'model/gltf-binary' },
    ];

    await expect(client.finalizeSpatialPackageFromBlob('TEST-ZONE-01', 2, {
      upload_id: 'a'.repeat(32),
      package_id: 'pkg-zone-r2',
      reason: 'Finalisation contrôlée du package spatial.',
      objects,
    }, { idempotencyKey: 'package-finalize-0001' })).resolves.toMatchObject({
      package_id: 'pkg-zone-r2',
      state: 'DRAFT',
      object_count: 3,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${API_ORIGIN}/api/v1/admin/zones/TEST-ZONE-01/revisions/2/packages/from-blob`);
    expect(init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('package-finalize-0001');
    expect(init?.body).not.toBeInstanceOf(FormData);
    expect(JSON.parse(String(init?.body))).toMatchObject({ upload_id: 'a'.repeat(32), objects });
  });

  it('transmet le mot de passe uniquement dans la requête de publication', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      publication: {
        zone_id: 'TEST-ZONE-01',
        revision: 2,
        package_id: 'pkg-zone-r2',
        package_state: 'PUBLISHED',
        publication_id: 'publication-001',
        publication_state: 'PUBLISHED',
        is_active: true,
      },
      trace_id: 'trace-publication',
    }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await client.publishSpatialPackage('TEST-ZONE-01', 2, {
      package_id: 'pkg-zone-r2',
      reason: 'Publication après contrôle de l’aperçu privé.',
      admin_password: 'correct horse battery staple',
    }, { idempotencyKey: 'publication-0001' });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${API_ORIGIN}/api/v1/admin/publications`);
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('publication-0001');
    expect(JSON.parse(String(init?.body))).toEqual({
      zone_id: 'TEST-ZONE-01',
      revision: 2,
      package_id: 'pkg-zone-r2',
      reason: 'Publication après contrôle de l’aperçu privé.',
      admin_password: 'correct horse battery staple',
    });
  });

  it('charge un aperçu PNG privé avec bearer sans accepter un autre type de contenu', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Blob(['png']), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await expect(client.getZonePrivatePreviewPng('TEST-ZONE-01', 2, 'pkg-zone-r2')).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_ORIGIN}/api/v1/admin/zones/TEST-ZONE-01/revisions/2/preview/packages/pkg-zone-r2/png`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer admin-opaque-token', Accept: 'image/png' }) }),
    );
  });

  it('produit une clé idempotente non vide par intention', () => {
    expect(createAdminIdempotencyKey()).toMatch(/^admin-ui-/);
  });

  it('charge une file strictement structurée sans accepter de données enrichies', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      observations: [{ observation_id: 'OBS-001', source_key: 'source-1', observed_at: '2026-07-15T10:00:00Z', longitude: 6.02, latitude: 43.29, horizontal_uncertainty_m: 240, verification_state: 'PENDING_REVIEW', proposed_fire_id: 'FR-83-00042', proposed_episode_id: 'E01', proposed_episode_status: 'UNDER_REVIEW', match_score: 0.82, review_reasons: ['distance'], version: 1 }],
      reports: [],
      incidents: [{ fire_id: 'FR-83-00042', episode_id: 'E01', status: 'UNDER_REVIEW', verification_state: 'UNVERIFIED', last_observed_at: '2026-07-15T10:00:00Z', version: 2 }],
    }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });
    await expect(client.getWorkQueue()).resolves.toMatchObject({ observations: [{ observation_id: 'OBS-001' }], incidents: [{ fire_id: 'FR-83-00042' }] });
    expect(fetchMock).toHaveBeenCalledWith(`${API_ORIGIN}/api/v2/admin/work-queue`, expect.objectContaining({ method: 'GET' }));
  });

  it('charge le poste de veille et la carte nationale depuis les contrats admin v2', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const system = { checked_at: '2026-07-15T10:00:00Z', application: { name: 'Fire-Viewer', version: '1.0.0', environment: 'test', authentication_mode: 'cookie' }, database: { dialect: 'sqlite', reachable: true }, queues: { jobs_active: 1, jobs_quarantined: 0, outbox_pending: 0, outbox_with_error: 0, reports_pending: 1 }, assets: { packages_draft: 0, packages_verified: 1, packages_previewable: 1, packages_published: 1, packages_withdrawn_or_revoked: 0 }, audit_event_count: 2, worker_heartbeat: 'not_persisted' };
    const summary = { total_incidents: 1, active_incidents: 1, monitoring_incidents: 0, incidents_requiring_review: 1, incidents_with_models: 1, model_updates_available: 0 };
    const mapIncident = { fire_id: 'FR-83-00042', canonical_name: 'Massif des Maures', territory_code: '83', longitude: 6.31, latitude: 43.25, horizontal_uncertainty_m: 180, status: 'ACTIVE_CONFIRMED', verification_state: 'VERIFIED', visibility: 'PUBLIC', current_episode_id: 'E01', last_observed_at: '2026-07-15T09:58:00Z', review_required: true, pending_observation_count: 1, spatial_zone_id: 'MAURES-01', spatial_zone_revision: 1, current_package_id: 'pkg-maures', active_package_id: 'pkg-maures', model_update_available: false, models: [{ profile: 'local', source: 'spatial_package', state: 'PUBLISHED', version: 1, asset_id: null, package_id: 'pkg-maures', package_file_id: 1, sha256: 'c'.repeat(64), size_bytes: 2048, is_current: true, access_path: '/api/v2/admin/packages/pkg-maures/files/1' }] };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ generated_at: '2026-07-15T10:00:00Z', queue: { total: 2, critical: 1, high: 1, medium: 0, observations_pending: 1, reports_pending: 1, incidents_requiring_review: 1, jobs_quarantined: 0, models_to_review: 0 }, priorities: [{ kind: 'report', priority: 'critical', target_id: 'report-1', fire_id: 'FR-83-00042', title: 'Donnée personnelle visible', detail: 'Revue immédiate requise', created_at: '2026-07-15T09:55:00Z' }], watchlist: [{ fire_id: 'FR-83-00042', canonical_name: 'Massif des Maures', status: 'ACTIVE_CONFIRMED', verification_state: 'VERIFIED', last_observed_at: '2026-07-15T09:58:00Z', review_required: true, pending_observation_count: 1, model_update_available: false }], recent_publications: [], map_summary: summary, system }))
      .mockResolvedValueOnce(response({ generated_at: '2026-07-15T10:00:00Z', coordinate_system: 'EPSG:4326', summary, incidents: [mapIncident] }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await expect(client.getDashboard()).resolves.toMatchObject({ queue: { critical: 1 }, watchlist: [{ fire_id: 'FR-83-00042' }] });
    await expect(client.getOperationalMap()).resolves.toMatchObject({ coordinate_system: 'EPSG:4326', incidents: [{ models: [{ profile: 'local' }] }] });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${API_ORIGIN}/api/v2/admin/dashboard`,
      `${API_ORIGIN}/api/v2/admin/operational-map`,
    ]);
  });

  it('charge les trois projections spécialisées d’un fire_id et met à jour une source via l’API opérateur', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ fire_id: 'FR-83-00042', observations: [{ observation_id: 'OBS-001', source_key: 'source-1', source_type: 'image', observed_at: '2026-07-15T10:00:00Z', received_at: '2026-07-15T10:01:00Z', longitude: 6.02, latitude: 43.29, horizontal_uncertainty_m: 240, verification_state: 'PENDING_REVIEW', match_decision: 'review', attached_episode_id: null, proposed_fire_id: 'FR-83-00042', proposed_episode_id: 'E01', match_score: 0.82, margin_to_second_candidate: 0.18, review_reasons: ['distance'], external_reference: null, evidence_license: 'CC-BY-4.0', version: 1 }] }))
      .mockResolvedValueOnce(response({ fire_id: 'FR-83-00042', sources: [{ source_key: 'source-1', type: 'image', trust: 'partner', enabled: true, display_name: 'Source 1', public_display_name: 'Source publique', public_license: 'CC-BY-4.0', public_reference_url: 'https://example.invalid/source', public_transformations: ['métadonnées retirées'], observation_count: 1 }], media_references: [{ observation_id: 'OBS-001', source_key: 'source-1', source_type: 'image', observed_at: '2026-07-15T10:00:00Z', received_at: '2026-07-15T10:01:00Z', verification_state: 'PENDING_REVIEW', evidence_hash: `sha256:${'a'.repeat(64)}`, evidence_license: 'CC-BY-4.0', external_reference: null }] }))
      .mockResolvedValueOnce(response({ fire_id: 'FR-83-00042', models: [{ revision: 1, episode_id: 'E01', is_current: true, created_at: '2026-07-15T10:00:00Z', reason: 'Révision validée.', asset_id: 'asset-1', asset_state: 'PUBLISHED', asset_version: 1, lod: 'desktop', sha256: 'b'.repeat(64), size_bytes: 1200, terrain_source_year: 2024, generated_at: '2026-07-15T09:00:00Z', published_at: '2026-07-15T10:00:00Z', superseded_at: null, spatial_zone_id: 'TEST-ZONE-01', spatial_zone_revision: 1, asset_spatial_zone_id: 'TEST-ZONE-01', asset_spatial_zone_revision: 1 }], jobs: [{ job_id: 'job-1', kind: 'TERRAIN_BAKE', state: 'SUCCEEDED', episode_id: 'E01', attempt: 1, max_attempts: 5, next_attempt_at: null, last_error: null, created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T10:00:00Z' }] }))
      .mockResolvedValueOnce(response({ id: 'source-1', type: 'image', trust: 'partner', display_name: 'Source 1', public_display_name: 'Source publique', public_license: 'CC-BY-4.0', public_reference_url: 'https://example.invalid/source', public_transformations: ['métadonnées retirées'], enabled: true, credential_configured: true, created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T10:00:00Z' }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await expect(client.getIncidentObservations('FR-83-00042')).resolves.toMatchObject({ observations: [{ observation_id: 'OBS-001' }] });
    await expect(client.getIncidentSourcesMedia('FR-83-00042')).resolves.toMatchObject({ sources: [{ source_key: 'source-1' }] });
    await expect(client.getIncidentModelsPipeline('FR-83-00042')).resolves.toMatchObject({ jobs: [{ job_id: 'job-1' }] });
    await expect(client.updateSource('source-1', { type: 'image', trust: 'partner', display_name: 'Source 1', public_display_name: 'Source publique', public_license: 'CC-BY-4.0', public_reference_url: 'https://example.invalid/source', public_transformations: ['métadonnées retirées'], enabled: true, reason: 'Mise à jour auditée de la source.' }, { idempotencyKey: 'source-update-001' })).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${API_ORIGIN}/api/v1/admin/incidents/FR-83-00042/observations`,
      `${API_ORIGIN}/api/v1/admin/incidents/FR-83-00042/sources-media`,
      `${API_ORIGIN}/api/v1/admin/incidents/FR-83-00042/models-pipeline`,
      `${API_ORIGIN}/api/v1/operator/sources/source-1`,
    ]);
    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({ method: 'PUT', headers: expect.objectContaining({ Authorization: 'Bearer admin-opaque-token' }) }));
  });

  it('résout une observation via le contrat opérateur avec idempotence', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ observation_id: 'OBS-001', action: 'attach', verification_state: 'VERIFIED', fire_id: 'FR-83-00042', episode_id: 'E01', version: 2, trace_id: 'trace-review' }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });
    await expect(client.resolveObservation('OBS-001', { action: 'attach', expected_version: 1, reason: 'Rattachement humain justifié.', target_fire_id: 'FR-83-00042' }, { idempotencyKey: 'resolve-001' })).resolves.toMatchObject({ fire_id: 'FR-83-00042', version: 2 });
    expect(fetchMock).toHaveBeenCalledWith(`${API_ORIGIN}/api/v1/operator/observations/OBS-001/resolve`, expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': 'resolve-001' }) }));
  });

  it('charge la scène privée et conserve les projections glTF exactes de la revue spatiale', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      fire_id: 'FR-83-00042', episode_id: 'E01',
      scene: { asset_url: 'https://private.invalid/model.glb', asset_version: 2, sha256: 'a'.repeat(64), origin_wgs84: [6.02, 43.29, 420], local_frame: 'ENU', gltf_profile: 'gltf-eun-negz-metric-v1' },
      markers: [{ marker_id: 'IM-1', source_kind: 'agent_media', marker_type: 'media_capture', longitude: 6.021, latitude: 43.291, altitude_m: null, horizontal_accuracy_m: 12, geometry_origin: 'METADATA', review_state: 'PENDING', observed_at: null, spatial_display_allowed: false, gltf_position: [12, 0, -8], version: 1 }],
      zone_revisions: [{ zone_revision_id: 'azr-1', revision: 1, valid_at: '2026-07-16T10:00:00Z', geometry_geojson: { type: 'MultiPolygon', coordinates: [] }, gltf_polygons: [[[[0, 0, 0], [10, 0, 0], [0, 0, -10], [0, 0, 0]]]], geometry_origin: 'HUMAN_AUTHORED', supporting_marker_ids: ['IM-1'], source_revision_ids: [], review_state: 'DRAFT', supersedes_zone_revision_id: null, reason: 'Contour de test suffisamment explicite.', created_by: 'admin', reviewed_by: null, reviewed_at: null, review_reason: null, created_at: '2026-07-16T10:00:00Z' }],
      agent_reviews: [],
    }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await expect(client.getIncidentSpatialReview('FR-83-00042')).resolves.toMatchObject({ markers: [{ gltf_position: [12, 0, -8] }], zone_revisions: [{ review_state: 'DRAFT' }] });
    expect(fetchMock).toHaveBeenCalledWith(`${API_ORIGIN}/api/v1/admin/incidents/FR-83-00042/spatial-review`, expect.objectContaining({ method: 'GET' }));
  });

  it('reprojette un clic de la carte 3D côté serveur avant de créer le contour WGS84', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ longitude: 6.0214, latitude: 43.2897, altitude_m: 420 }));
    const client = new AdminApiClient({ session: SESSION, fetchImpl: fetchMock });

    await expect(client.projectIncidentGltfPick('FR-83-00042', [15, 2, -8])).resolves.toEqual({ longitude: 6.0214, latitude: 43.2897, altitude_m: 420 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_ORIGIN}/api/v1/admin/incidents/FR-83-00042/spatial-review/project-pick`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ gltf_position: [15, 2, -8] }) }),
    );
  });
});
