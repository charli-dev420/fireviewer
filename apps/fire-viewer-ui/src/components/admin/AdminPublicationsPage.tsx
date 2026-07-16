import { useCallback, useState } from 'react';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, formatAdminDate } from './AdminPageState';

export function AdminPublicationsPage() {
  const api = useAdminApi();
  const { state, reload } = useAdminQuery(useCallback((options: { signal?: AbortSignal }) => api.listPublications(options), [api]), [api]);
  const mutation = useAdminMutation(); const [reason, setReason] = useState<Record<string, string>>({});
  const change = async (publicationId: string, action: 'withdraw' | 'restore') => {
    const value = reason[publicationId]?.trim() ?? ''; if (value.length < 10) return;
    const result = await mutation.run(`${publicationId}:${action}:${value}`, (options) => api.changePublication(publicationId, action, { reason: value }, options));
    if (result !== null) { setReason((current) => ({ ...current, [publicationId]: '' })); reload(); }
  };
  if (state.kind === 'loading') return <AdminLoadingState label="Chargement des publications…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  return <section><AdminPageHeader title="Publications"><p>Registre des packages spatiaux publiés. Les liens incident ne sont affichés que lorsqu’ils sont explicitement persistés.</p></AdminPageHeader>{state.data.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Publication</th><th>Référence</th><th>État</th><th>Incidents</th><th>Contrôle</th></tr></thead><tbody>{state.data.map((item) => <tr key={item.publication_id}><th scope="row"><code>{item.publication_id}</code><small>Mis à jour {formatAdminDate(item.updated_at)}</small></th><td>{item.zone_id} / r{item.revision}<small><code>{item.package_id}</code></small></td><td>{item.state}{item.is_active ? ' · active' : ''}</td><td>{item.linked_fire_ids.length ? item.linked_fire_ids.map((fireId) => <a key={fireId} href={`/admin/incidents/${fireId}`}>{fireId}</a>) : 'Aucun lien explicite'}</td><td>{item.state === 'PUBLISHED' || item.state === 'WITHDRAWN' ? <><textarea rows={2} maxLength={500} value={reason[item.publication_id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [item.publication_id]: event.target.value }))} placeholder="Motif audité (10 caractères minimum)" /><button className="button button--small" type="button" disabled={mutation.state.pending || (reason[item.publication_id]?.trim().length ?? 0) < 10} onClick={() => void change(item.publication_id, item.state === 'PUBLISHED' ? 'withdraw' : 'restore')}>{item.state === 'PUBLISHED' ? 'Retirer' : 'Restaurer'}</button></> : 'Action indisponible'}</td></tr>)}</tbody></table></div> : <AdminEmptyState title="Aucune publication">Aucun package n’est actuellement enregistré.</AdminEmptyState>}</section>;
}
