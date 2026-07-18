import { useCallback } from 'react';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminStateLabel, formatAdminDate } from './AdminPageState';

export function AdminWorkQueuePage() {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getWorkQueue(options), [api]);
  const { state, reload } = useAdminQuery(load, [load]);

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement de la file de traitement…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  const queue = state.data;

  return <section aria-labelledby="admin-work-queue-title">
    <AdminPageHeader title="Validation"><p>Les éléments à contrôler sont regroupés ici. Chaque décision se prend ensuite dans l’écran adapté, sans formulaire dupliqué.</p></AdminPageHeader>

    <section className="admin-section">
      <div className="admin-section__heading"><div><h3 id="admin-work-queue-title">Observations à qualifier</h3><p>{queue.observations.length} observation(s) attendent un rattachement ou un rejet.</p></div>{queue.observations.length ? <a className="button button--primary" href="/admin/rapprochement-spatial">Examiner les observations</a> : null}</div>
      {queue.observations.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Observation</th><th>Source</th><th>Candidat proposé</th><th>Reçue</th></tr></thead><tbody>{queue.observations.map((item) => <tr key={item.observation_id}><th scope="row"><code>{item.observation_id}</code></th><td>{item.source_key}</td><td>{item.proposed_fire_id ? <a href={`/admin/incidents/${item.proposed_fire_id}`}>{item.proposed_fire_id}</a> : 'Aucun candidat'}</td><td>{formatAdminDate(item.observed_at)}</td></tr>)}</tbody></table></div> : <AdminEmptyState title="Aucune observation à qualifier">Aucune observation non résolue n’est actuellement disponible.</AdminEmptyState>}
    </section>

    <section className="admin-section">
      <h3>Incidents demandant une revue</h3>
      {queue.incidents.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Incident</th><th>Statut</th><th>Dernière activité</th><th><span className="sr-only">Ouvrir</span></th></tr></thead><tbody>{queue.incidents.map((item) => <tr key={item.fire_id}><th scope="row"><a href={`/admin/incidents/${item.fire_id}`}>{item.fire_id}</a></th><td><AdminStateLabel value={item.status} /></td><td>{formatAdminDate(item.last_observed_at)}</td><td><a className="button button--small" href={`/admin/incidents/${item.fire_id}`}>Ouvrir</a></td></tr>)}</tbody></table></div> : <AdminEmptyState title="Aucun incident à revoir">Les épisodes courants ne demandent aucune validation.</AdminEmptyState>}
    </section>

    <section className="admin-section">
      <div className="admin-section__heading"><div><h3>Signalements publics ouverts</h3><p>{queue.reports.length} signalement(s) attendent une décision.</p></div>{queue.reports.length ? <a className="button button--primary" href="/admin/signalements">Examiner les signalements</a> : null}</div>
      {!queue.reports.length ? <AdminEmptyState title="Aucun signalement ouvert">Aucun signalement public ne demande de revue.</AdminEmptyState> : null}
    </section>
  </section>;
}
