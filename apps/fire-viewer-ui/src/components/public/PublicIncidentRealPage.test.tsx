// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PublicIncidentRealPage } from './PublicIncidentRealPage';
import type { PublicIncidentView } from '../../lib/publicIncidentView';
import type { ViewerManifestSummary } from '../../lib/viewerManifest';

const summary: ViewerManifestSummary = { schemaVersion: '2.0', fireId: 'FR-83-00042', episodeId: 'E01', statusCode: 'MONITORING', validatedAt: null, reviewRequired: false, location: null, asset: null, frame: null, freshness: { incident_at: '2026-07-15T10:00:00Z', terrain_source_year: null, generated_at: null }, modelState: 'not_available', publicNotice: 'Notice publique.', sources: [], history: [], journal: [] };
const view: PublicIncidentView = { schema_version: '1.0', fire_id: 'FR-83-00042', canonical_name: 'Massif test', public_note: null, status: 'MONITORING', verification: 'verified', freshness_at: '2026-07-15T10:00:00Z', last_human_validation_at: null, location: null, facts: ['Observation validée.'], limitations: ['Donnée datée.'], episodes: [{ episode_id: 'E01', ordinal: 1, status: 'MONITORING', verification_state: 'VERIFIED', corroborating_source_count: 1, evidence_basis_at: '2026-07-15T10:00:00Z', estimated_area_ha: 12, evacuation_established: false, model_generation_eligible: true, review_required: false, started_at: '2026-07-15T09:00:00Z', last_observed_at: '2026-07-15T10:00:00Z', validated_at: '2026-07-15T10:02:00Z', ended_at: null, is_current: true, version: 1 }], observations: [{ observation_id: 'O-1', episode_id: 'E01', type: 'institutional', observed_at: '2026-07-15T10:00:00Z', received_at: '2026-07-15T10:01:00Z', uncertainty_m: 250, area_label: 'Massif test', verification_state: 'VERIFIED', spatial_mode: 'WITHHELD' }], evidence_projections: [{ projection_id: 'P-1', episode_id: 'E01', kind: 'validated_marker', verification_state: 'VERIFIED', center: { coordinates: [6.1, 43.2], horizontal_uncertainty_m: 25 }, radius_m: 25, label: 'Image utilisateur validée', observed_at: '2026-07-15T10:00:00Z' }], sources: [], timeline: [], model: { state: 'not_available', version: null, sha256: null, size_bytes: null, lod: null, terrain_source_year: null, generated_at: null, public_download_available: false, limitations: [] }, downloads: [] };

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <PublicIncidentRealPage
      summary={summary}
      checkedAt="2026-07-15T10:00:00Z"
      stale={false}
      refreshing={false}
      onRefresh={vi.fn()}
      detailRequest={Promise.resolve({ view, error: null })}
    />,
  );
}

it('affiche une page unique avec les quatre vues publiques validées', async () => {
  const user = userEvent.setup();
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Massif test', level: 1 })).toBeVisible();
  expect(screen.getByRole('button', { name: '3D' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Informations' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Gestes à adopter' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Statistiques' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Sources' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Téléchargements' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Informations' }));
  expect(screen.getByRole('heading', { name: 'Situation actuelle' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Gestes à adopter' }));
  expect(screen.getAllByText(/Appelez le 18 ou le 112/)).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Statistiques' }));
  expect(screen.getByText('Nombre d’épisodes')).toBeVisible();
});

it('ouvre les images depuis leur contexte sans créer de galerie publique', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('heading', { name: 'Massif test', level: 1 });

  await user.click(screen.getByRole('button', { name: 'Images géolocalisées' }));
  expect(screen.getByRole('complementary', { name: 'Images géolocalisées' })).toHaveTextContent('Il ne s’agit pas d’une galerie');
  expect(screen.getByText('Image utilisateur validée')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Fermer le panneau' }));
  await user.click(screen.getByRole('button', { name: 'Épisodes' }));
  expect(screen.getByRole('complementary', { name: 'Épisodes de l’incident' })).toHaveTextContent('Épisode 1');
});

it('désactive explicitement la 3D en mode faible connexion', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('heading', { name: 'Massif test', level: 1 });
  await user.click(screen.getByRole('button', { name: 'Faible connexion' }));
  expect(screen.getByRole('heading', { name: 'Mode faible connexion actif' })).toBeVisible();
  expect(localStorage.getItem('firewarning-low-data')).toBe('true');
});
