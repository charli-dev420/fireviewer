import { useCallback } from 'react';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  formatAdminDate,
} from './AdminPageState';

export function AdminZonesPage() {
  const api = useAdminApi();
  const loadZones = useCallback((options: { signal?: AbortSignal }) => api.listZones(options), [api]);
  const { state, reload } = useAdminQuery(loadZones, [loadZones]);

  return (
    <section aria-labelledby="admin-zones-title">
      <AdminPageHeader
        title="Cartes 3D"
        actions={<a className="button button--primary" href="/admin/zones/nouvelle">Ajouter une carte</a>}
      >
        <p>Importez, vérifiez et publiez chaque carte depuis un parcours unique.</p>
      </AdminPageHeader>

      {state.kind === 'loading' ? <AdminLoadingState label="Chargement des zones administrées…" /> : null}
      {state.kind === 'error' ? <AdminErrorState error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' && state.data.length === 0 ? (
        <AdminEmptyState
          title="Aucune carte 3D"
          action={<a className="button button--primary" href="/admin/zones/nouvelle">Ajouter la première carte</a>}
        >
          Créez une zone logique, puis une révision et importez le dossier du package produit localement.
        </AdminEmptyState>
      ) : null}
      {state.kind === 'ready' && state.data.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Carte</th>
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
                  <td className="admin-table__muted">{formatAdminDate(zone.updated_at)}</td>
                  <td><a className="button button--small" href={`/admin/zones/${encodeURIComponent(zone.zone_id)}`}>Ouvrir</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
