// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminShell } from './AdminShell';
import { ADMIN_OPERATIONS } from './operations/adminOperations';

describe('AdminShell', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('expose seulement les surfaces opérationnelles raccordées et les outils techniques', () => {
    window.history.replaceState({}, '', '/admin/zones/nouvelle');
    render(<AdminShell><p>Contenu de test</p></AdminShell>);

    expect(ADMIN_OPERATIONS).toHaveLength(11);
    for (const operation of ADMIN_OPERATIONS) {
      expect(screen.getByRole('link', { name: operation.label })).toHaveAttribute('href', operation.href);
    }
    expect(screen.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Carte opérationnelle' })).toHaveAttribute('href', '/admin/carte-operationnelle');
    expect(screen.getByRole('link', { name: 'Modèles et zones' })).toHaveAttribute('href', '/admin/zones');
    expect(screen.getByRole('link', { name: 'Nouvelle zone' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Modèles et zones' })).not.toHaveAttribute('aria-current');
  });

  it('n expose pas de surface placeholder', () => {
    expect(ADMIN_OPERATIONS.some(({ availability }) => availability === 'not_available')).toBe(false);
  });

  it('navigue entre les pages admin sans recharger le document', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/admin');
    const navigation = vi.fn();
    window.addEventListener('popstate', navigation, { once: true });
    render(<AdminShell><p>Contenu de test</p></AdminShell>);

    await user.click(screen.getByRole('link', { name: 'Modèles et zones' }));

    expect(window.location.pathname).toBe('/admin/zones');
    expect(navigation).toHaveBeenCalledOnce();
    expect(screen.getByText('Contenu de test')).toBeVisible();
  });
});
