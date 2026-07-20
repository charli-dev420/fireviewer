// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const incidentApi = vi.hoisted(() => ({
  submitPublicIncidentReport: vi.fn(),
}));
const contributionApi = vi.hoisted(() => ({
  createPublicContributionIdempotencyKey: vi.fn(() => 'public-test-idempotency'),
  submitPublicContribution: vi.fn(),
  readPublicContributionAccess: vi.fn(),
  loadPublicContribution: vi.fn(),
  withdrawPublicContribution: vi.fn(),
}));

vi.mock('../../lib/publicIncidentView', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/publicIncidentView')>();
  return { ...original, submitPublicIncidentReport: incidentApi.submitPublicIncidentReport };
});
vi.mock('../../lib/publicContributionUpload', () => contributionApi);

import {
  FireWarningContributionTrackingPage,
  FireWarningIncidentErrorPage,
  FireWarningReportPage,
} from './FireWarningContributionPages';

describe('parcours publics de contribution', () => {
  beforeEach(() => {
    localStorage.clear();
    incidentApi.submitPublicIncidentReport.mockReset();
    contributionApi.submitPublicContribution.mockReset();
    contributionApi.readPublicContributionAccess.mockReset();
    contributionApi.loadPublicContribution.mockReset();
    contributionApi.withdrawPublicContribution.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('impose la barrière d’urgence puis transmet la contribution privée avec consentement explicite', async () => {
    contributionApi.submitPublicContribution.mockResolvedValue({
      contribution_id: 'PC-20260720-0001',
      kind: 'new_fire',
      fire_id: null,
      state: 'PENDING',
      received_at: '2026-07-20T13:00:00Z',
      reviewed_at: null,
      review_reason: null,
      purge_after: '2026-08-19T13:00:00Z',
      media_count: 0,
      location_label: 'Massif de Justin',
      observation_type: 'Fumée',
      observed_at: '2026-07-20T12:55:00Z',
      version: 1,
    });
    const user = userEvent.setup();
    render(<FireWarningReportPage />);

    expect(screen.getByRole('heading', { name: 'Danger immédiat ou personnes menacées ?' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Appeler le 112/ })).toHaveAttribute('href', 'tel:112');

    await user.click(screen.getByRole('button', { name: /Je suis en sécurité, continuer/ }));
    await user.type(screen.getByLabelText('Commune, lieu-dit ou repère'), 'Massif de Justin');
    await user.click(screen.getByRole('button', { name: /Continuer/ }));

    await user.selectOptions(screen.getByLabelText('Type d’observation'), 'Fumée');
    await user.click(screen.getByRole('button', { name: /Continuer/ }));
    await user.click(screen.getByRole('button', { name: /Continuer/ }));

    await user.type(screen.getByRole('textbox', { name: /Description factuelle/ }), 'Une colonne de fumée sombre est visible depuis la route.');
    await user.click(screen.getByRole('button', { name: /Continuer/ }));

    const consents = screen.getAllByRole('checkbox');
    expect(consents).toHaveLength(4);
    for (const consent of consents) expect(consent).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /Analyser cette contribution/ }));
    await user.click(screen.getByRole('button', { name: /Continuer/ }));
    await user.click(screen.getByRole('button', { name: /Envoyer la contribution/ }));

    expect(await screen.findByRole('heading', { name: 'Transmise pour vérification humaine' })).toBeVisible();
    expect(contributionApi.submitPublicContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'new_fire',
        fireId: null,
        location: expect.objectContaining({ label: 'Massif de Justin' }),
        observation: expect.objectContaining({ type: 'Fumée' }),
      }),
      'public-test-idempotency',
    );
  });

  it('charge le statut persistant avec le jeton privé de cet appareil', async () => {
    contributionApi.readPublicContributionAccess.mockReturnValue({
      contributionId: 'PC-20260720-0002',
      trackingToken: 'tracking-token',
      fireId: 'FR-83-00042',
      storedAt: '2026-07-20T13:00:00Z',
    });
    contributionApi.loadPublicContribution.mockResolvedValue({
      contribution_id: 'PC-20260720-0002', kind: 'incident_evidence', fire_id: 'FR-83-00042',
      state: 'PENDING', received_at: '2026-07-20T13:00:00Z', reviewed_at: null,
      review_reason: null, purge_after: '2026-08-19T13:00:00Z', media_count: 1,
      location_label: 'Versant est', observation_type: 'Fumée',
      observed_at: '2026-07-20T12:00:00Z', version: 2,
    });

    render(<FireWarningContributionTrackingPage contributionId="PC-20260720-0002" />);

    expect(await screen.findByText('En attente de vérification')).toBeVisible();
    expect(screen.getByText('Versant est')).toBeVisible();
    expect(contributionApi.loadPublicContribution).toHaveBeenCalledWith('PC-20260720-0002', 'tracking-token', expect.any(AbortSignal));
    expect(screen.queryByText('Acceptée pour publication')).not.toBeInTheDocument();
  });

  it('transmet réellement un signalement d’erreur et affiche le reçu serveur', async () => {
    incidentApi.submitPublicIncidentReport.mockResolvedValue({
      receipt_id: 'REPORT-20260715-0001',
      status: 'received',
      submitted_at: '2026-07-15T14:22:00Z',
      replayed: false,
    });
    const user = userEvent.setup();
    render(<FireWarningIncidentErrorPage fireId="FR-83-00042" />);

    await user.click(screen.getByRole('radio', { name: 'Position sur le modèle' }));
    await user.type(screen.getByLabelText('Description du problème'), 'Le marqueur est placé sur le mauvais versant.');
    await user.click(screen.getByRole('checkbox', { name: /Autoriser le traitement/ }));
    await user.click(screen.getByRole('button', { name: /Transmettre le signalement/ }));

    expect(incidentApi.submitPublicIncidentReport).toHaveBeenCalledWith('FR-83-00042', expect.objectContaining({
      category: 'location',
      message: expect.stringContaining('mauvais versant'),
    }));
    expect(await screen.findByText('REPORT-20260715-0001')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'La page reste inchangée pendant la vérification' })).toBeVisible();
  });
});
