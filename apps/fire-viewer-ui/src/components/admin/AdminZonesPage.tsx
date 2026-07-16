import { useCallback } from 'react';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStateLabel,
  formatAdminDate,
} from './AdminPageState';

function formatBounds(bounds: readonly [number, number, number, number]): string {
  return `${bounds[0].toLocaleString('fr-FR')} / ${bounds[1].toLocaleString('fr-FR')} — ${bounds[2].toLocaleString('fr-FR')} / ${bounds[3].toLocaleString('fr-FR')}`;
}

export function AdminZonesPage() {
  const api = useAdminApi();
  const loadZones = useCallback((options: { signal?: AbortSignal }) => api.listZones(options), [api]);
  const { state, reload } = useAdminQuery(loadZones, [loadZones]);

  return (
    <section aria-labelledby="admin-zones-title">
      <AdminPageHeader
        title="Zones administrées"
        actions={<a className="button button--primary" href="/admin/zones/nouvelle">Créer une zone</a>}
      >
        <p>Chaque zone est autonome et reste limitée à son emprise locale déclarée.</p>
      </AdminPageHeader>

      {state.kind === 'loading' ? <AdminLoadingState label="Chargement des zones administrées…" /> : null}
      {state.kind === 'error' ? <AdminErrorState error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' && state.data.length === 0 ? (
        <AdminEmptyState
          title="Aucune zone administrée"
          action={<a className="button button--primary" href="/admin/zones/nouvelle">Créer la première zone</a>}
        >
          Créez une zone logique, puis téléversez son archive contrôlée et ajoutez les informations localisées.
        </AdminEmptyState>
      ) : null}
      {state.kind === 'ready' && state.data.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Zone</th>
                <th scope="col">Visibilité</th>
                <th scope="col">Emprise Lambert-93</th>
                <th scope="col">Mise à jour</th>
                <th scope="col"><span className="sr-only">Ouvrir</span></th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((zone) => (
                <tr key={zone.zone_id}>
                  <th scope="row">
                    <a href={`/admin/zones/${encodeURIComponent(zone.zone_id)}`}>{zone.label}</a>
                    <small>{zone.zone_id}</small>
                  </th>
                  <td><AdminStateLabel value={zone.visibility} /></td>
                  <td className="admin-table__muted">{formatBounds(zone.bounds_l93_m)}</td>
                  <td className="admin-table__muted">{formatAdminDate(zone.updated_at)}</td>
                  <td><a className="button button--small" href={`/admin/zones/${encodeURIComponent(zone.zone_id)}`}>Gérer</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
