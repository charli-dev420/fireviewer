import { useCallback } from 'react';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminStateLabel, formatAdminDate } from './AdminPageState';

export function AdminIncidentsPage() {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.listIncidents(options), [api]);
  const { state, reload } = useAdminQuery(load, [load]);
  return <section aria-labelledby="admin-incidents-title"><AdminPageHeader title="Incidents"><p>Inventaire opérateur centré sur l’identifiant permanent <code>fire_id</code>. Les zones locales restent des références techniques, jamais l’identité d’un feu.</p></AdminPageHeader>{state.kind === 'loading' ? <AdminLoadingState label="Chargement des incidents…" /> : null}{state.kind === 'error' ? <AdminErrorState error={state.error} onRetry={reload} /> : null}{state.kind === 'ready' && !state.data.length ? <AdminEmptyState title="Aucun incident"><span>Aucun incident ne correspond aux données privées actuelles.</span></AdminEmptyState> : null}{state.kind === 'ready' && state.data.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Incident</th><th>Épisode courant</th><th>Statut</th><th>Revue</th><th>Observations à traiter</th><th>Dernière activité</th></tr></thead><tbody>{state.data.map((incident) => <tr key={incident.fire_id}><th scope="row"><a href={`/admin/incidents/${incident.fire_id}`}><code>{incident.fire_id}</code></a><small>{incident.canonical_name ?? 'Nom non défini'} · {incident.territory_code}</small></th><td>{incident.current_episode_id}</td><td><AdminStateLabel value={incident.status} /></td><td>{incident.review_required ? 'Requise' : 'À jour'}</td><td>{incident.pending_observation_count}</td><td className="admin-table__muted">{formatAdminDate(incident.last_observed_at)}</td></tr>)}</tbody></table></div> : null}</section>;
}
