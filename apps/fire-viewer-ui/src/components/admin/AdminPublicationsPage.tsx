import { useCallback, useState } from 'react';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, formatAdminDate } from './AdminPageState';

function publicStatus(item: { readonly is_active: boolean; readonly linked_fire_ids: readonly string[]; readonly state: string }): string {
  if (item.is_active && item.linked_fire_ids.length) return 'Visible publiquement';
  if (item.is_active) return 'Incident manquant — non visible';
  if (item.state === 'WITHDRAWN') return 'Retirée du public';
  return item.state.replaceAll('_', ' ');
}

export function AdminPublicationsPage() {
  const api = useAdminApi();
  const { state, reload } = useAdminQuery(
    useCallback((options: { signal?: AbortSignal }) => api.listPublications(options), [api]),
    [api],
  );
  const mutation = useAdminMutation();
  const [reason, setReason] = useState<Record<string, string>>({});

  const change = async (publicationId: string, action: 'withdraw' | 'restore') => {
    const value = reason[publicationId]?.trim() ?? '';
    if (value.length < 10) return;
    const result = await mutation.run(
      `${publicationId}:${action}:${value}`,
      (options) => api.changePublication(publicationId, action, { reason: value }, options),
    );
    if (result !== null) {
      setReason((current) => ({ ...current, [publicationId]: '' }));
      reload();
    }
  };

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement des publications…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;

  return (
    <section>
      <AdminPageHeader title="Cartes publiées">
        <p>Une carte n’est visible sur le site que si elle est publiée et associée à un incident.</p>
      </AdminPageHeader>
      {state.data.length ? (
        <div className="admin-publication-cards">
          {state.data.map((item) => {
            const previewHref = `/admin/zones/${encodeURIComponent(item.zone_id)}/revisions/${item.revision}/preview`;
            const action = item.state === 'PUBLISHED' ? 'withdraw' : 'restore';
            return (
              <article className="admin-publication-card" key={item.publication_id}>
                <header>
                  <div>
                    <h2>{item.zone_id} · révision {item.revision}</h2>
                    <p>Mis à jour {formatAdminDate(item.updated_at)}</p>
                  </div>
                  <strong className={item.is_active && item.linked_fire_ids.length ? 'is-public' : 'is-private'}>
                    {publicStatus(item)}
                  </strong>
                </header>
                <div className="admin-publication-card__body">
                  <div>
                    <span>Incident</span>
                    {item.linked_fire_ids.length
                      ? item.linked_fire_ids.map((fireId) => (
                        <a key={fireId} href={`/admin/incidents/${encodeURIComponent(fireId)}`}>{fireId}</a>
                      ))
                      : <strong>Aucun incident associé</strong>}
                  </div>
                  <a className="button button--primary" href={previewHref}>
                    {item.linked_fire_ids.length ? 'Ouvrir la carte' : 'Associer à un incident'}
                  </a>
                </div>
                {item.state === 'PUBLISHED' || item.state === 'WITHDRAWN' ? (
                  <details className="admin-publication-card__control">
                    <summary>{item.state === 'PUBLISHED' ? 'Retirer cette carte du public' : 'Restaurer cette carte'}</summary>
                    <label>
                      Motif de l’action
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={reason[item.publication_id] ?? ''}
                        onChange={(event) => setReason((current) => ({ ...current, [item.publication_id]: event.target.value }))}
                      />
                    </label>
                    <button
                      className="button button--small"
                      type="button"
                      disabled={mutation.state.pending || (reason[item.publication_id]?.trim().length ?? 0) < 10}
                      onClick={() => void change(item.publication_id, action)}
                    >
                      {item.state === 'PUBLISHED' ? 'Confirmer le retrait' : 'Confirmer la restauration'}
                    </button>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <AdminEmptyState title="Aucune carte publiée">Les cartes validées apparaîtront ici après leur publication.</AdminEmptyState>
      )}
    </section>
  );
}
