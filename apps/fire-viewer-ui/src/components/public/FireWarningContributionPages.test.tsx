// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const incidentApi = vi.hoisted(() => ({
  submitPublicIncidentReport: vi.fn(),
}));

vi.mock('../../lib/publicIncidentView', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/publicIncidentView')>();
  return { ...original, submitPublicIncidentReport: incidentApi.submitPublicIncidentReport };
});

import {
  FireWarningContributionTrackingPage,
  FireWarningIncidentErrorPage,
  FireWarningReportPage,
} from './FireWarningContributionPages';

describe('parcours publics de contribution', () => {
  beforeEach(() => {
    localStorage.clear();
    incidentApi.submitPublicIncidentReport.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('impose la barrière d’urgence puis enregistre uniquement un brouillon local avec consentements explicites', async () => {
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
    await user.click(screen.getByRole('button', { name: /Enregistrer le brouillon/ }));

    expect(screen.getByRole('heading', { name: 'Aucune donnée n’a été transmise' })).toBeVisible();
    const stored = localStorage.getItem('fw:contribution-drafts:v1');
    expect(stored).toContain('Massif de Justin');
    expect(stored).toContain('"status":"local-draft"');
    expect(incidentApi.submitPublicIncidentReport).not.toHaveBeenCalled();
  });

  it('affiche un brouillon local sans inventer un statut serveur', () => {
    localStorage.setItem('fw:contribution-drafts:v1', JSON.stringify([{
      id: 'LOCAL-20260715-TEST0001',
      kind: 'evidence',
      fireId: 'FR-83-00042',
      createdAt: '2026-07-15T10:00:00Z',
      updatedAt: '2026-07-15T10:00:00Z',
      status: 'local-draft',
      location: { mode: 'place', label: 'Versant est', latitude: '', longitude: '', uncertainty: '' },
      observation: { type: 'Fumée', date: '2026-07-15', time: '12:00', direct: true, description: 'Fumée observée depuis un point sûr.' },
      media: null,
      consent: { processing: true, retention: false, publicDisplay: false, modelDisplay: false },
      contactEmail: '',
    }]));

    render(<FireWarningContributionTrackingPage contributionId="LOCAL-20260715-TEST0001" />);

    expect(screen.getByText('Brouillon local · non transmis')).toBeVisible();
    expect(screen.getByText('Versant est')).toBeVisible();
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
