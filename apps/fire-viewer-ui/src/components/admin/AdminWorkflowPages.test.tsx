// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiProvider } from './AdminApiContext';
import { AdminInformationEditorPage } from './AdminInformationEditorPage';
import { AdminIncidentObservationsPage } from './AdminIncidentObservationsPage';
import { AdminIncidentSourcesMediaPage } from './AdminIncidentSourcesMediaPage';
import { AdminNewZonePage } from './AdminNewZonePage';
import { AdminNewIncidentPage } from './AdminNewIncidentPage';
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

  it('commence l’ajout d’une carte depuis un incident sans demander de données techniques', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ incidents: [{
      fire_id: 'FR-26-00001', canonical_name: 'Incendie de Die', territory_code: '26',
      visibility: 'PRIVATE', current_episode_id: 'E01', status: 'ACTIVE_CONFIRMED',
      verification_state: 'VERIFIED', corroborating_source_count: 2, estimated_area_ha: 1200,
      evacuation_established: false, model_generation_eligible: true, review_required: false,
      last_observed_at: '2026-07-18T10:00:00Z', pending_observation_count: 0, version: 3,
    }] }));
    vi.stubGlobal('fetch', fetchMock);
    renderAdmin(<AdminNewZonePage />);

    expect(await screen.findByRole('heading', { name: /Dans quel projet ajouter la carte/ })).toBeVisible();
    expect(screen.queryByLabelText(/identifiant|longitude|x minimum|motif administratif/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choisir ce projet' })).toHaveAttribute('href', '/admin/incidents/FR-26-00001/carte/importer');
  });

  it('crée une fiche incident avec une seule position copiée et sans formulaire technique', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      fire_id: 'FR-26-00001', episode_id: 'E01', canonical_name: 'Massif de Justin', territory_code: '26',
      longitude: 5.3701, latitude: 44.7532, status: 'MONITORING', verification_state: 'UNVERIFIED',
      visibility: 'LIMITED', created_at: '2026-07-18T21:00:00Z',
    }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminNewIncidentPage />);

    await user.type(screen.getByLabelText('Position du feu'), '44.7532, 5.3701');
    await user.type(screen.getByLabelText('Département ou territoire'), '26');
    await user.type(screen.getByLabelText(/Nom utile/), 'Massif de Justin');
    await user.click(screen.getByRole('button', { name: 'Créer la fiche incident' }));

    expect(await screen.findByRole('link', { name: 'Ouvrir FR-26-00001' })).toHaveAttribute('href', '/admin/incidents/FR-26-00001');
    expect(fetchMock).toHaveBeenCalledWith(`${API_ORIGIN}/api/v2/admin/incidents`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ territory_code: '26', latitude: 44.7532, longitude: 5.3701, canonical_name: 'Massif de Justin' }),
    }));
    expect(screen.queryByLabelText(/incertitude|motif|^longitude$|^latitude$/i)).not.toBeInTheDocument();
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
    const placement = screen.getByRole('img', { name: /Zone de placement/i });
    vi.spyOn(placement, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100, toJSON: () => ({}),
    });
    fireEvent.pointerDown(placement, { clientX: 50, clientY: 25 });
    expect(screen.getByText('Position choisie')).toBeVisible();
    expect(screen.queryByLabelText('Est / X')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nord / Y')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Titre'), 'Point local');
    await user.selectOptions(screen.getByLabelText('Type de repère'), 'access');
    await user.type(screen.getByLabelText('Description'), 'Information synthétique.');
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
    const incidentSummary = {
      fire_id: 'FR-83-00042', canonical_name: 'Feu de test', territory_code: '83', visibility: 'PRIVATE',
      current_episode_id: 'E01', status: 'UNDER_REVIEW', verification_state: 'PENDING_REVIEW',
      corroborating_source_count: 1, estimated_area_ha: null, evacuation_established: false,
      model_generation_eligible: false, review_required: true, last_observed_at: '2026-07-15T10:00:00Z',
      pending_observation_count: 1, version: 1,
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/api/v2/admin/incidents') return response({ incidents: [incidentSummary] });
      if (pathname === '/api/v2/admin/work-queue') return response(queue);
      if (init?.method === 'POST') return response({ observation_id: 'OBS-REVIEW-01', action: 'attach', verification_state: 'VERIFIED', fire_id: 'FR-83-00042', episode_id: 'E01', version: 2, trace_id: 'trace-spatial-review' });
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminSpatialMatchingPage />);

    await screen.findByRole('heading', { name: 'Observations à rattacher' });
    expect(screen.getByText('distance cohérente')).toBeVisible();
    expect(screen.getByLabelText('Incident cible')).toHaveValue('FR-83-00042');
    expect(screen.queryByLabelText(/motif de décision/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rattacher au feu' }));

    expect(await screen.findByText(/Décision enregistrée pour OBS-REVIEW-01/)).toBeVisible();
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const init = postCall?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({ action: 'attach', expected_version: 1, target_fire_id: 'FR-83-00042', reason: expect.stringContaining('rattachée manuellement') });
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

  it('présente seulement le package quotidien et les trois analyses validées', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const workspace = {
      fire_id: 'FR-26-00001',
      sources: [{
        source_key: 'presse-locale', type: 'image', trust: 'partner', enabled: true,
        display_name: 'Presse locale', public_display_name: null, public_license: 'CC-BY-4.0',
        public_reference_url: 'https://example.test/source', public_transformations: ['recadrage'],
        observation_count: 2,
      }],
      media_references: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (String(input).includes('/api/v2/admin/agent-batches/')) return response({
        fire_id: 'FR-26-00001', episode_id: 'E01', local_date: '2026-07-09', actions: [
          { operation_type: 'user_media', pending_files: 2, pending_analyses: 1, running_analyses: 0, last_run_at: null, can_run: true, blocked_reason: null },
          { operation_type: 'source_research', pending_files: 0, pending_analyses: 1, running_analyses: 0, last_run_at: '2026-07-18T10:00:00Z', can_run: true, blocked_reason: null },
          { operation_type: 'satellite_media', pending_files: 0, pending_analyses: 0, running_analyses: 0, last_run_at: null, can_run: false, blocked_reason: 'nothing_to_process' },
        ],
      });
      if (init?.method === 'POST') return response({ fire_id: 'FR-26-00001', episode_id: 'E01', operation_type: 'source_research', operation_ids: ['research-1'], queued_files: 0 });
      return response(workspace);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAdmin(<AdminIncidentSourcesMediaPage fireId="FR-26-00001" />);

    await screen.findByRole('heading', { name: 'Sources liées' });
    expect(screen.getByLabelText('Date')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ajouter les fichiers reçus' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Envoyer les fichiers' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Analyser les fichiers reçus' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rechercher et analyser les sources publiques' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rien à traiter' })).toBeDisabled();
    expect(screen.queryByText('Modifier l’affichage de cette source')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rechercher et analyser les sources publiques' }));
    const researchCall = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/operations/source_research/run') && init?.method === 'POST');
    expect(JSON.parse(String(researchCall?.[1]?.body))).toMatchObject({ location_hint: null });
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
    expect(screen.queryByLabelText('Motif de l’action')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publier sur l’incident' }));

    expect(await screen.findByText('Publication publication-001 activée.')).toBeVisible();
    const publicationCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/v1/admin/publications'));
    expect(publicationCall).toBeDefined();
    expect(JSON.parse(String(publicationCall?.[1]?.body))).toMatchObject({
      zone_id: 'TEST-ZONE-01',
      revision: 2,
      package_id: 'pkg-zone-r2',
      reason: 'Carte publiée manuellement après contrôle de l’aperçu privé.',
    });
  });

  it('renvoie une carte non rattachée vers le choix du projet sans demander de fire_id', async () => {
    vi.stubEnv('VITE_API_BASE_URL', API_ORIGIN);
    const preview = {
      zone_id: 'DIE-PONTAIX-08', revision: 1, preview_scope: 'private-admin',
      package_id: 'pkg-die-r1', package_state: 'PREVIEWABLE', publication_id: 'publication-die-r1',
      publication_state: 'PREVIEWABLE', publication_active: false, linked_fire_ids: [],
      verification_report: { status: 'verified' }, preview_package_ids: ['pkg-die-r1'], scene: null, files: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      expect(init?.method).not.toBe('POST');
      if (url.endsWith('/png')) return new Response(new Blob(['png']), { status: 200, headers: { 'Content-Type': 'image/png' } });
      return response(preview);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAdmin(<AdminZonePrivatePreviewPage zoneId="DIE-PONTAIX-08" revision={1} />);

    expect(await screen.findByRole('link', { name: 'Choisir le projet incendie' })).toHaveAttribute('href', '/admin/incidents');
    expect(screen.queryByLabelText(/identifiant de l’incident|incident qui affichera/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publier sur l’incident' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
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
    await user.click(screen.getByRole('button', { name: 'Retirer du public' }));

    expect(await screen.findByText('La carte a été retirée du site public.')).toBeVisible();
    const withdrawCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/publications/publication-001/withdraw'));
    expect(JSON.parse(String(withdrawCall?.[1]?.body))).toEqual({
      reason: 'Carte retirée manuellement du site public depuis son aperçu privé.',
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
    expect(screen.queryByRole('button', { name: 'Publier sur l’incident' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choisir le projet incendie' })).toHaveAttribute('href', '/admin/incidents');
    expect(screen.queryByLabelText('Incident qui affichera la carte')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vue FPS' }));
    expect(await screen.findByText('Scène Unity fps · accès include')).toBeVisible();
  });

});
