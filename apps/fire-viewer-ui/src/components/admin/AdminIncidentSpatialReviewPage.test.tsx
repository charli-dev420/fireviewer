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
}));

vi.mock('./AdminApiContext', () => ({
  useAdminApi: () => ({
    projectIncidentGltfPick: mocks.project,
    reviewActiveFireZoneRevision: mocks.review,
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
          catalog_url: '/api/v1/incident/FR-26-00001/spatial-scene/catalog',
          files: {
            'terrain/T00/elevation.cog.tif': '/api/elevation',
            'terrain/T00/colour.png': '/api/colour',
            'vectors/T00/features.glb': '/api/features',
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
  TiledSpatialScene3D: ({ onPick, cameraMode }: { onPick: (point: readonly [number, number, number]) => void; cameraMode: string }) => <div><span>Moteur {cameraMode}</span><button type="button" onClick={() => onPick([25, 2, -40])}>Cliquer le relief</button></div>,
}));

describe('outils de revue spatiale 3D', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('active la vue FPS et permet de déplacer ou retirer un sommet du brouillon', async () => {
    const user = userEvent.setup();
    render(<AdminIncidentSpatialReviewPage fireId="FR-26-00001" />);

    await user.click(screen.getByRole('button', { name: 'Vue FPS' }));
    expect(await screen.findByText('Moteur fps')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Dessiner sur le terrain' }));
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
    await user.click(screen.getByRole('button', { name: 'Retirer le calque' }));
    expect(mocks.review).toHaveBeenCalledWith(
      'FR-26-00001',
      'AZR-01',
      expect.objectContaining({ action: 'reject', expected_state: 'DRAFT' }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^zone-retract-/) }),
    );
  });
});
