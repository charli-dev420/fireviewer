// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiProvider } from './AdminApiContext';
import { AdminInformationEditorPage } from './AdminInformationEditorPage';
import { AdminIncidentObservationsPage } from './AdminIncidentObservationsPage';
import { AdminNewZonePage } from './AdminNewZonePage';
import { AdminSpatialMatchingPage } from './AdminSpatialMatchingPage';
import { AdminZonePrivatePreviewPage } from './AdminZonePrivatePreviewPage';

vi.mock('../public/TiledSpatialScene3D', () => ({
  TiledSpatialScene3D: ({ cameraMode, source }: { readonly cameraMode: string; readonly source: { readonly credentials?: string } }) => (
    <div>Scène Unity {cameraMode} · accès {source.credentials}</div>
  ),
}));

const API_ORIGIN = 'http://localhost:8000';
const SESSION = { token: 'admin-ui-test-token' };

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function zone(overrides: Record<string, unknown> = {}) {
  return {
    zone_id: 'TEST-ZONE-01',
    label: 'Zone de test',
    description: 'Zone de test isolée.',
    visibility: 'DRAFT',
    bounds_l93_m: [0, 0, 100, 100],
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:00Z',
    ...overrides,
  };
}

function information() {
  return {
    information_id: 'info-ui-1',
    title: 'Point local',
    body: 'Information synthétique.',
    category: 'accès',
    position_l93: [50, 75],
    state: 'DRAFT',
    updated_at: '2026-07-14T10:02:00Z',
    review_note: null,
  };
}

function renderAdmin(node: React.ReactNode) {
  return render(
    <AdminApiProvider session={SESSION} onUnauthorized={vi.fn()}>
      {node}
    </AdminApiProvider>,
  );
}

describe('pages de workflow administrateur', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('crée une zone depuis le formulaire réel avec une clé d’idempotence', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ zone: zone(), trace_id: 'trace-create-zone' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminNewZonePage />);

    await user.type(screen.getByLabelText('Identifiant stable'), 'TEST-ZONE-01');
    await user.type(screen.getByLabelText('Nom public'), 'Zone de test');
    await user.type(screen.getByLabelText('Description'), 'Zone de test isolée.');
    await user.type(screen.getByLabelText('X minimum'), '0');
    await user.type(screen.getByLabelText('Y minimum'), '0');
    await user.type(screen.getByLabelText('X maximum'), '100');
    await user.type(screen.getByLabelText('Y maximum'), '100');
    await user.type(screen.getByLabelText('Motif administratif'), 'Création de test.');
    await user.click(screen.getByRole('button', { name: 'Créer la carte' }));

    expect(await screen.findByRole('heading', { name: 'Carte créée' })).toBeVisible();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^admin-ui-/) }));
    expect(JSON.parse(String(init.body))).toMatchObject({ zone_id: 'TEST-ZONE-01' });
  });

  it('place puis crée une information dans le repère local de sa zone', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ zone: zone(), uploads: [], information: [] }))
      .mockResolvedValueOnce(response({ information: information(), trace_id: 'trace-information' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminInformationEditorPage zoneId="TEST-ZONE-01" />);

    await screen.findByRole('heading', { name: 'Ajouter une information — TEST-ZONE-01' });
    const placement = screen.getByRole('img', { name: /Emprise locale de la zone/i });
    vi.spyOn(placement, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100, toJSON: () => ({}),
    });
    fireEvent.pointerDown(placement, { clientX: 50, clientY: 25 });
    expect(screen.getByLabelText('Est / X')).toHaveValue(50);
    expect(screen.getByLabelText('Nord / Y')).toHaveValue(75);
    await user.type(screen.getByLabelText('Titre'), 'Point local');
    await user.type(screen.getByLabelText('Catégorie'), 'accès');
    await user.type(screen.getByLabelText('Contenu'), 'Information synthétique.');
    await user.type(screen.getByLabelText('Motif administratif'), 'Ajout de test.');
    await user.click(screen.getByRole('button', { name: 'Ajouter l’information' }));

    expect(await screen.findByRole('heading', { name: 'Information enregistrée' })).toBeVisible();
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ position_l93: [50, 75] });
  });

  it('résout un rapprochement spatial motivé avec le contrat opérateur existant', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const queue = {
      observations: [{
        observation_id: 'OBS-REVIEW-01', source_key: 'source-test', observed_at: '2026-07-15T10:00:00Z',
        longitude: 6.02, latitude: 43.29, horizontal_uncertainty_m: 240, verification_state: 'PENDING_REVIEW',
        proposed_fire_id: 'FR-83-00042', proposed_episode_id: 'E01', proposed_episode_status: 'UNDER_REVIEW',
        match_score: 0.82, review_reasons: ['distance cohérente', 'source récente'], version: 1,
      }], reports: [], incidents: [],
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(queue))
      .mockResolvedValueOnce(response({ observation_id: 'OBS-REVIEW-01', action: 'attach', verification_state: 'VERIFIED', fire_id: 'FR-83-00042', episode_id: 'E01', version: 2, trace_id: 'trace-spatial-review' }))
      .mockResolvedValueOnce(response({ observations: [], reports: [], incidents: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminSpatialMatchingPage />);

    await screen.findByRole('heading', { name: 'Observations à rattacher' });
    expect(screen.getByText('distance cohérente')).toBeVisible();
    await user.type(screen.getByLabelText('Motif de décision audité'), 'Rattachement confirmé après revue des motifs.');
    await user.click(screen.getByRole('button', { name: 'Rattacher au feu' }));

    expect(await screen.findByText(/Décision enregistrée pour OBS-REVIEW-01/)).toBeVisible();
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ action: 'attach', expected_version: 1, target_fire_id: 'FR-83-00042' });
    expect(init?.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^admin-ui-/) }));
  });

  it('ne publie un repère exact qu’après consentement explicite dans le dossier incident', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const workspace = {
      fire_id: 'FR-83-00042',
      observations: [{
        observation_id: 'OBS-EXACT-01', source_key: 'source-test', source_type: 'image',
        observed_at: '2026-07-15T10:00:00Z', received_at: '2026-07-15T10:01:00Z',
        longitude: 6.02, latitude: 43.29, horizontal_uncertainty_m: 240,
        verification_state: 'PENDING_REVIEW', match_decision: 'review', attached_episode_id: null,
        proposed_fire_id: 'FR-83-00042', proposed_episode_id: 'E01', match_score: 0.82,
        margin_to_second_candidate: 0.18, review_reasons: ['distance cohérente'],
        external_reference: null, evidence_license: 'CC-BY-4.0', version: 1,
      }],
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(workspace))
      .mockResolvedValueOnce(response({
        observation_id: 'OBS-EXACT-01', action: 'attach', verification_state: 'VERIFIED',
        fire_id: 'FR-83-00042', episode_id: 'E01', version: 2, trace_id: 'trace-exact-review',
      }))
      .mockResolvedValueOnce(response({ fire_id: 'FR-83-00042', observations: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminIncidentObservationsPage fireId="FR-83-00042" />);

    await screen.findByRole('heading', { name: 'Registre de revue' });
    const exactPosition = screen.getByRole('checkbox', { name: /Autoriser le repère exact/i });
    expect(exactPosition).not.toBeChecked();
    await user.type(screen.getByLabelText('Motif de décision audité'), 'Validation humaine et diffusion exacte autorisée.');
    await user.click(exactPosition);
    await user.click(screen.getByRole('button', { name: 'Rattacher à cet incident' }));

    expect(await screen.findByText(/Décision enregistrée pour OBS-EXACT-01/)).toBeVisible();
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      action: 'attach',
      expected_version: 1,
      target_fire_id: 'FR-83-00042',
      publish_spatial_evidence: true,
    });
  });

  it('publie depuis l’aperçu avec la session administrateur active', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const preview = {
      zone_id: 'TEST-ZONE-01',
      revision: 2,
      preview_scope: 'private-admin',
      package_id: 'pkg-zone-r2',
      package_state: 'PREVIEWABLE',
      publication_id: 'publication-001',
      publication_state: 'PREVIEWABLE',
      publication_active: false,
      linked_fire_ids: ['FR-26-00001'],
      verification_report: { status: 'verified' },
      preview_package_ids: ['pkg-zone-r2'],
      scene: null,
      files: [{ file_id: 1, path: 'assets/preview.png', kind: 'PNG', sha256: 'a'.repeat(64), size_bytes: 128, media_type: 'image/png' }],
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/publications') && init?.method === 'POST') {
        return response({
          publication: {
            zone_id: 'TEST-ZONE-01', revision: 2, package_id: 'pkg-zone-r2',
            package_state: 'PUBLISHED', publication_id: 'publication-001',
            publication_state: 'PUBLISHED', is_active: true,
          },
          trace_id: 'trace-publication-ui',
        });
      }
      if (url.endsWith('/png')) {
        return new Response(new Blob(['png']), { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      return response(preview);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminZonePrivatePreviewPage zoneId="TEST-ZONE-01" revision={2} />);

    await screen.findByRole('heading', { name: 'Publier sur l’incident' });
    expect(screen.queryByLabelText('Mot de passe administrateur')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Motif de l’action'), 'Publication après validation visuelle privée.');
    await user.click(screen.getByRole('button', { name: 'Publier sur l’incident' }));

    expect(await screen.findByText('Publication publication-001 activée.')).toBeVisible();
    const publicationCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/v1/admin/publications'));
    expect(publicationCall).toBeDefined();
    expect(JSON.parse(String(publicationCall?.[1]?.body))).toMatchObject({
      zone_id: 'TEST-ZONE-01',
      revision: 2,
      package_id: 'pkg-zone-r2',
      reason: 'Publication après validation visuelle privée.',
    });
  });

  it('rattache et publie une carte en une seule action utilisateur', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const preview = {
      zone_id: 'DIE-PONTAIX-08', revision: 1, preview_scope: 'private-admin',
      package_id: 'pkg-die-r1', package_state: 'PREVIEWABLE', publication_id: 'publication-die-r1',
      publication_state: 'PREVIEWABLE', publication_active: false, linked_fire_ids: [],
      verification_report: { status: 'verified' }, preview_package_ids: ['pkg-die-r1'], scene: null, files: [],
    };
    const incident = {
      fire_id: 'FR-26-00001', canonical_name: 'Incendie de Die', territory_code: '26', visibility: 'PUBLIC',
      current_episode_id: 'E01', status: 'ACTIVE_CONFIRMED', verification_state: 'VERIFIED',
      corroborating_source_count: 3, estimated_area_ha: 1200, evacuation_established: false,
      model_generation_eligible: true, review_required: false, last_observed_at: '2026-07-18T00:00:00Z',
      pending_observation_count: 0, version: 7, episodes: [], observations: [], sources: [], models: [], audit: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/incidents/FR-26-00001') && init?.method === 'GET') return response(incident);
      if (url.endsWith('/incidents/FR-26-00001/representations') && init?.method === 'POST') {
        return response({ fire_id: 'FR-26-00001', episode_id: 'E01', package_id: 'pkg-die-r1', manifest_revision: 2, primary_asset_id: null, model_asset_ids: [], incident_version: 8, trace_id: 'trace-attach' });
      }
      if (url.endsWith('/publications') && init?.method === 'POST') {
        return response({ publication: { zone_id: 'DIE-PONTAIX-08', revision: 1, package_id: 'pkg-die-r1', package_state: 'PUBLISHED', publication_id: 'publication-die-r1', publication_state: 'PUBLISHED', is_active: true }, trace_id: 'trace-publish' });
      }
      if (url.endsWith('/png')) return new Response(new Blob(['png']), { status: 200, headers: { 'Content-Type': 'image/png' } });
      return response(preview);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminZonePrivatePreviewPage zoneId="DIE-PONTAIX-08" revision={1} />);

    await user.type(await screen.findByLabelText('Incident qui affichera la carte'), 'FR-26-00001');
    await user.type(screen.getByLabelText('Motif de l’action'), 'Publication de la carte validée sur l’incident de Die.');
    await user.click(screen.getByRole('button', { name: 'Publier sur l’incident' }));

    expect(await screen.findByText('Publication publication-die-r1 activée.')).toBeVisible();
    const mutations = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url));
    expect(mutations).toEqual([
      `${API_ORIGIN}/api/v2/admin/incidents/FR-26-00001/representations`,
      `${API_ORIGIN}/api/v1/admin/publications`,
    ]);
  });

  it('retire une carte publiée sans supprimer son historique', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const preview = {
      zone_id: 'TEST-ZONE-01', revision: 2, preview_scope: 'private-admin',
      package_id: 'pkg-zone-r2', package_state: 'PUBLISHED',
      publication_id: 'publication-001', publication_state: 'PUBLISHED', publication_active: true,
      linked_fire_ids: ['FR-26-00001'],
      verification_report: { status: 'verified' }, preview_package_ids: ['pkg-zone-r2'], scene: null, files: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (String(input).endsWith('/publications/publication-001/withdraw') && init?.method === 'POST') {
        return response({ publication: { ...preview, state: 'WITHDRAWN', is_active: false }, trace_id: 'trace-withdraw' });
      }
      if (String(input).endsWith('/png')) return new Response(new Blob(['png']), { status: 200, headers: { 'Content-Type': 'image/png' } });
      return response(preview);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminZonePrivatePreviewPage zoneId="TEST-ZONE-01" revision={2} />);

    await screen.findByRole('heading', { name: 'Retirer du public' });
    await user.type(screen.getByLabelText('Motif de l’action'), 'Retrait demandé après contrôle administratif.');
    await user.click(screen.getByRole('button', { name: 'Retirer du public' }));

    expect(await screen.findByText('La carte a été retirée du site public.')).toBeVisible();
    const withdrawCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/publications/publication-001/withdraw'));
    expect(JSON.parse(String(withdrawCall?.[1]?.body))).toEqual({
      reason: 'Retrait demandé après contrôle administratif.',
      confirm_publication_id: 'publication-001',
    });
  });

  it('affiche le vrai loader Unity privé et ses contrôles de caméra', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response({
      zone_id: 'TEST-ZONE-01', revision: 2, preview_scope: 'private-admin',
      package_id: 'pkg-unity-r2', package_state: 'PREVIEWABLE',
      publication_id: 'publication-unity', publication_state: 'PREVIEWABLE', publication_active: false,
      linked_fire_ids: [],
      verification_report: { status: 'passed', scene_kind: 'remote_tiles' },
      preview_package_ids: ['pkg-unity-r2'],
      scene: {
        catalog_url: '/api/v1/admin/zones/TEST-ZONE-01/revisions/2/preview/packages/pkg-unity-r2/catalog',
        files: { 'assets/far/global.fwterrain': '/api/v2/admin/packages/pkg-unity-r2/files/1' },
      },
      files: [{ file_id: 1, path: 'assets/far/global.fwterrain', kind: 'FWTERRAIN', sha256: 'a'.repeat(64), size_bytes: 128, media_type: 'application/vnd.fireviewer.terrain' }],
    })));
    const user = userEvent.setup();
    renderAdmin(<AdminZonePrivatePreviewPage zoneId="TEST-ZONE-01" revision={2} />);

    expect(await screen.findByText('Scène Unity orbit · accès include')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publier sur l’incident' })).toBeDisabled();
    expect(screen.getByLabelText('Incident qui affichera la carte')).toHaveAttribute('placeholder', 'FR-26-00001');
    expect(screen.queryByRole('button', { name: 'Associer cette carte' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vue FPS' }));
    expect(await screen.findByText('Scène Unity fps · accès include')).toBeVisible();
  });

});
