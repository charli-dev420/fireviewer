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

/**
 * L'ajout d'une carte commence toujours depuis un incident existant.
 * Les identifiants, coordonnées et emprises sont lus dans le package importé ;
 * ils ne sont jamais demandés à l'opérateur.
 */
export function AdminNewZonePage() {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.listIncidents(options), [api]);
  const { state, reload } = useAdminQuery(load, [load]);

  return (
    <section aria-labelledby="admin-new-zone-title">
      <AdminPageHeader
        title="Ajouter une carte 3D"
        actions={<a className="button button--small" href="/admin/zones">Voir les cartes existantes</a>}
      >
        <p>Choisissez l’incident concerné. La carte sera importée directement dans ce projet, sans identifiant ni coordonnées à saisir.</p>
      </AdminPageHeader>

      <section className="admin-section" aria-labelledby="admin-new-zone-title">
        <div className="admin-section__heading">
          <div>
            <h3 id="admin-new-zone-title">Dans quel projet ajouter la carte&nbsp;?</h3>
            <p>Le manifeste du dossier fournit automatiquement la zone, l’emprise, les altitudes et la version.</p>
          </div>
        </div>

        {state.kind === 'loading' ? <AdminLoadingState label="Chargement des incidents…" /> : null}
        {state.kind === 'error' ? <AdminErrorState error={state.error} onRetry={reload} /> : null}
        {state.kind === 'ready' && state.data.length === 0 ? (
          <AdminEmptyState title="Aucun incident disponible">
            Une carte 3D doit être ajoutée depuis un incident réel déjà présent dans le système.
          </AdminEmptyState>
        ) : null}
        {state.kind === 'ready' && state.data.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Incident</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Dernière activité</th>
                  <th scope="col"><span className="sr-only">Continuer</span></th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((incident) => (
                  <tr key={incident.fire_id}>
                    <th scope="row">
                      {incident.canonical_name ?? `Incident ${incident.territory_code}`}
                      <small>{incident.fire_id} · territoire {incident.territory_code}</small>
                    </th>
                    <td><AdminStateLabel value={incident.status} /></td>
                    <td className="admin-table__muted">{formatAdminDate(incident.last_observed_at)}</td>
                    <td>
                      <a
                        className="button button--primary button--small"
                        href={`/admin/incidents/${encodeURIComponent(incident.fire_id)}/carte/importer`}
                      >
                        Choisir ce projet
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  );
}
