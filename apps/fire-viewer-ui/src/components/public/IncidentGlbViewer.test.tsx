// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IncidentGlbViewer } from './IncidentGlbViewer';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('conserve les outils tactiques et explique le repli lorsque WebGL est indisponible', async () => {
  vi.stubGlobal('WebGLRenderingContext', undefined);

  render(
    <IncidentGlbViewer
      assetUrl="https://assets.example.test/FR-83-00042/v4/model.glb"
      version={4}
      sha256="0123456789abcdef0123456789abcdef"
      frame={{ origin_wgs84: [6.1, 43.2, 100], local_frame: 'ENU', meters_per_unit: 0.01, vertical_datum: 'EPSG:4979' }}
      terrainSourceYear={2024}
      observations={[]}
    />,
  );

  expect(await screen.findByText('Le modèle ne peut pas être affiché sur cet appareil.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Recentrer' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Mesurer' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Relief publié' })).toBeDisabled();
  expect(screen.getByText('Leurs positions précises ne sont pas projetées lorsque seules des zones généralisées sont publiées.')).toBeVisible();
});
