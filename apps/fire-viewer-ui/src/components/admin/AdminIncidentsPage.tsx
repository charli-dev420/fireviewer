import { useCallback, useState } from 'react';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminStateLabel, formatAdminDate } from './AdminPageState';

export function AdminIncidentsPage() {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.listIncidents(options), [api]);
  const { state, reload } = useAdminQuery(load, [load]);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [status, setStatus] = useState('');

  const incidents = state.kind === 'ready'
    ? state.data.filter((incident) => {
      const haystack = `${incident.fire_id} ${incident.canonical_name ?? ''} ${incident.territory_code}`.toLocaleLowerCase('fr-FR');
      return haystack.includes(search.trim().toLocaleLowerCase('fr-FR')) && (!status || incident.status === status);
    })
    : [];

  return (
    <section aria-labelledby="admin-incidents-title">
      <AdminPageHeader
        title="Incidents"
        actions={<a className="button button--small" href="/admin/carte-operationnelle">Ouvrir la carte opérationnelle</a>}
      >
        <p>Retrouvez un incendie puis gérez toutes ses données depuis sa fiche unique.</p>
      </AdminPageHeader>

      <div className="admin-filter-row" role="search" aria-label="Filtrer les incidents">
        <label>
          Rechercher
          <input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Nom, département ou fire_id" />
        </label>
        <label>
          Statut
          <select value={status} onChange={(event) => setStatus(event.currentTarget.value)}>
            <option value="">Tous</option>
            <option value="ACTIVE_CONFIRMED">Actif confirmé</option>
            <option value="MONITORING">Sous surveillance</option>
            <option value="EXTINGUISHED">Éteint</option>
            <option value="CLOSED">Clos</option>
          </select>
        </label>
      </div>

      {state.kind === 'loading' ? <AdminLoadingState label="Chargement des incidents…" /> : null}
      {state.kind === 'error' ? <AdminErrorState error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' && incidents.length === 0 ? (
        <AdminEmptyState title={state.data.length ? 'Aucun résultat' : 'Aucun incident'}>
          {state.data.length ? 'Modifiez la recherche ou le filtre.' : 'Aucun incident ne correspond aux données privées actuelles.'}
        </AdminEmptyState>
      ) : null}
      {state.kind === 'ready' && incidents.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Incident</th><th>Statut</th><th>À valider</th><th>Dernière activité</th><th><span className="sr-only">Ouvrir</span></th></tr></thead>
            <tbody>{incidents.map((incident) => (
              <tr key={incident.fire_id}>
                <th scope="row"><a href={`/admin/incidents/${incident.fire_id}`}><code>{incident.fire_id}</code></a><small>{incident.canonical_name ?? 'Nom non défini'} · {incident.territory_code}</small></th>
                <td><AdminStateLabel value={incident.status} /></td>
                <td>{incident.review_required ? 'Revue requise' : `${incident.pending_observation_count} repère(s)`}</td>
                <td className="admin-table__muted">{formatAdminDate(incident.last_observed_at)}</td>
                <td><a className="button button--small" href={`/admin/incidents/${incident.fire_id}`}>Ouvrir</a></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
