// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import catalogFixture from '../../public/maps/fireviewer-die-pontaix-r1-v4/catalog.json';
import SpatialMapApp, { SpatialMapRenderBoundary } from './SpatialMapApp';
import { loadSpatialCatalog, parseSpatialCatalog } from '../lib/spatialCatalog';

const giro3dProbe = vi.hoisted(() => ({ focusRequests: [] as number[] }));

vi.mock('./Giro3DMap', () => ({
  default: ({ focusRequest }: { focusRequest: number }) => {
    giro3dProbe.focusRequests.push(focusRequest);
    return null;
  },
}));

vi.mock('../lib/spatialCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/spatialCatalog')>();
  return {
    ...actual,
    loadSpatialCatalog: vi.fn(),
  };
});

const mockedLoadSpatialCatalog = vi.mocked(loadSpatialCatalog);
let getContextSpy: ReturnType<typeof vi.spyOn>;

describe('SpatialMapApp', () => {
  beforeEach(() => {
    mockedLoadSpatialCatalog.mockResolvedValue(parseSpatialCatalog(catalogFixture));
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    giro3dProbe.focusRequests.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('conserve un résumé DOM honnête quand WebGL est indisponible', async () => {
    render(<SpatialMapApp />);

    expect(await screen.findByRole('heading', { name: 'Rendu 3D indisponible' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Zone Die–Pontaix' })).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText(/48\s*323/)).toBeInTheDocument();
    expect(screen.getByText(/ne consulte ni Cesium/i)).toBeInTheDocument();
    expect(document.title).toBe('Fire-Viewer — Carte 3D Zone Die–Pontaix');
  });

  it('présente une seule zone publique et transmet chaque recentrage au moteur 3D', async () => {
    getContextSpy.mockReturnValue({} as RenderingContext);
    render(<SpatialMapApp />);

    const recenter = await screen.findByRole('button', { name: 'Recentrer la zone' });
    expect(screen.getAllByText('Zone Die–Pontaix')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Die' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pontaix' })).not.toBeInTheDocument();
    await waitFor(() => expect(giro3dProbe.focusRequests.at(-1)).toBe(0));

    fireEvent.click(recenter);
    await waitFor(() => expect(giro3dProbe.focusRequests.at(-1)).toBe(1));
  });

  it('conserve le résumé DOM si le chunk 3D échoue à se charger', () => {
    const catalog = parseSpatialCatalog(catalogFixture);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const BrokenMap = () => {
      throw new Error('chunk Giro3D inaccessible');
    };

    render(
      <SpatialMapRenderBoundary catalog={catalog}>
        <BrokenMap />
      </SpatialMapRenderBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Rendu 3D indisponible' })).toBeInTheDocument();
    expect(screen.getByText(/moteur 3D local n’a pas pu être chargé/i)).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
  });
});
