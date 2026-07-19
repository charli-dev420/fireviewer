// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminIncidentSpatialReviewPage } from './AdminIncidentSpatialReviewPage';

const mocks = vi.hoisted(() => ({
  reload: vi.fn(),
  project: vi.fn(async (_fireId: string, point: readonly [number, number, number]) => ({
    longitude: 5.37 + point[0] / 100_000,
    latitude: 44.75 - point[2] / 100_000,
    altitude_m: 320 + point[1],
  })),
  review: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({})),
  changePublication: vi.fn(async () => ({})),
}));

vi.mock('./AdminApiContext', () => ({
  useAdminApi: () => ({
    projectIncidentGltfPick: mocks.project,
    reviewActiveFireZoneRevision: mocks.review,
    publishSpatialPackage: mocks.publish,
    changePublication: mocks.changePublication,
  }),
  useAdminQuery: () => ({
    state: {
      kind: 'ready',
      data: {
        fire_id: 'FR-26-00001',
        episode_id: 'E01',
        scene: {
          asset_url: null,
          asset_version: null,
          sha256: null,
          package_id: 'fireviewer-die-pontaix-r1-v4',
          zone_id: 'DIE-PONTAIX-08',
          zone_revision: 1,
          package_state: 'PREVIEWABLE',
          publication_id: 'ZP-DIE-01',
          publication_state: 'PREVIEWABLE',
          publication_active: false,
          catalog_url: '/api/v1/admin/zones/DIE-PONTAIX-08/revisions/1/preview/packages/fireviewer-die-pontaix-r1-v4/catalog',
          files: {
            'terrain/T00/elevation.cog.tif': '/api/v2/admin/packages/fireviewer-die-pontaix-r1-v4/files/1',
            'terrain/T00/colour.png': '/api/v2/admin/packages/fireviewer-die-pontaix-r1-v4/files/2',
            'vectors/T00/features.glb': '/api/v2/admin/packages/fireviewer-die-pontaix-r1-v4/files/3',
          },
          origin_wgs84: [5.37, 44.75, 350],
        },
        markers: [],
        zone_revisions: [{
          zone_revision_id: 'AZR-01', revision: 1, review_state: 'DRAFT',
          geometry_origin: 'HUMAN_CONFIRMED', valid_at: '2026-07-17T10:00:00Z',
          reason: 'Premier contour contrôlé.', supporting_marker_ids: [],
          geometry_geojson: { type: 'MultiPolygon', coordinates: [[[[5.37, 44.75], [5.38, 44.75], [5.38, 44.76], [5.37, 44.75]]]] },
          gltf_polygons: [[[[0, 0, 0], [100, 0, 0], [100, 0, -100], [0, 0, 0]]]],
        }],
        agent_reviews: [],
      },
    },
    reload: mocks.reload,
  }),
}));

vi.mock('../public/TiledSpatialScene3D', () => ({
  TiledSpatialScene3D: ({ onPick, cameraMode, source }: { onPick: (point: readonly [number, number, number]) => void; cameraMode: string; source: { readonly credentials?: RequestCredentials; readonly catalogUrl: string } }) => <div><span>Moteur {cameraMode} {source.credentials}</span><span>{source.catalogUrl}</span><button type="button" onClick={() => onPick([25, 2, -40])}>Cliquer le relief</button></div>,
}));

describe('outils de revue spatiale 3D', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('reste en vue orbitale et permet de déplacer ou retirer un sommet du brouillon', async () => {
    const user = userEvent.setup();
    render(<AdminIncidentSpatialReviewPage fireId="FR-26-00001" />);

    expect(await screen.findByText('Moteur orbit include')).toBeVisible();
    expect(screen.getByText(/\/api\/v1\/admin\/zones\/DIE-PONTAIX-08\/revisions\/1\/preview\/packages\/fireviewer-die-pontaix-r1-v4\/catalog$/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Vue FPS' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tracer un nouveau contour' }));
    await user.click(screen.getByRole('button', { name: 'Cliquer le relief' }));
    expect(await screen.findByText('Sommet 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Déplacer' }));
    expect(screen.getByText(/Cliquez sur le relief pour déplacer le sommet 1/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retirer' }));
    expect(screen.queryByText('Sommet 1')).not.toBeInTheDocument();
  });

  it('retire logiquement un calque sans effacer son historique', async () => {
    const user = userEvent.setup();
    render(<AdminIncidentSpatialReviewPage fireId="FR-26-00001" />);
    await user.click(screen.getByRole('button', { name: 'Supprimer de la carte' }));
    expect(mocks.review).toHaveBeenCalledWith(
      'FR-26-00001',
      'AZR-01',
      expect.objectContaining({ action: 'reject', expected_state: 'DRAFT' }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^zone-retract-/) }),
    );
  });

  it('publie la carte depuis le projet sans demander de zone ni de révision à l’opérateur', async () => {
    const user = userEvent.setup();
    render(<AdminIncidentSpatialReviewPage fireId="FR-26-00001" />);

    await user.click(screen.getByRole('button', { name: 'Publier la carte' }));

    expect(mocks.publish).toHaveBeenCalledWith(
      'DIE-PONTAIX-08',
      1,
      expect.objectContaining({ package_id: 'fireviewer-die-pontaix-r1-v4' }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^project-map-publish-/) }),
    );
    expect(await screen.findByText('Carte publiée sur le site public.')).toBeVisible();
  });
});
