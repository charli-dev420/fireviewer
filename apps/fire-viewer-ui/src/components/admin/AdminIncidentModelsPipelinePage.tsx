import { useCallback } from 'react';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminStateLabel, formatAdminDate } from './AdminPageState';
import { AdminIncidentWorkspaceNav } from './AdminIncidentWorkspaceNav';

function technicalRevisionHref(model: { spatial_zone_id: string | null; spatial_zone_revision: number | null; asset_spatial_zone_id: string | null; asset_spatial_zone_revision: number | null }): string | null {
  const zoneId = model.spatial_zone_id ?? model.asset_spatial_zone_id;
  const revision = model.spatial_zone_revision ?? model.asset_spatial_zone_revision;
  return zoneId && revision ? `/admin/zones/${encodeURIComponent(zoneId)}/revisions/${revision}` : null;
}

/** Lecture privée des liens manifest/asset/zone et de l’activité persistée des jobs. */
export function AdminIncidentModelsPipelinePage({ fireId }: { readonly fireId: string }) {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getIncidentModelsPipeline(fireId, options), [api, fireId]);
  const { state, reload } = useAdminQuery(load, [load]);
  if (state.kind === 'loading') return <AdminLoadingState label="Chargement des modèles et du pipeline…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  return (
    <section aria-labelledby="admin-incident-models-title">
      <AdminPageHeader title="Modèles et pipeline"><p>Chaîne persistée <code>{fireId}</code> → épisode → révision de manifeste → asset → révision spatiale. Les URLs GLB, charges de job et commandes de worker restent hors de cette surface.</p></AdminPageHeader>
      <AdminIncidentWorkspaceNav fireId={fireId} active="models-pipeline" />
      <section className="admin-section" aria-labelledby="admin-incident-models-title"><div className="admin-section__heading"><div><h3 id="admin-incident-models-title">Révisions de manifeste et assets</h3><p>Chaque lien spatial est affiché seulement lorsqu’il est explicitement persisté par le modèle.</p></div></div>{state.data.models.length ? <div className="admin-model-list">{state.data.models.map((model) => { const href = technicalRevisionHref(model); return <article className="admin-model-record" key={model.revision}><header><div><p className="eyebrow">Manifest r{model.revision} · épisode {model.episode_id}</p><h3>{model.asset_id ?? 'Aucun asset lié'}</h3><p>Créée {formatAdminDate(model.created_at)} · {model.is_current ? 'révision courante' : 'historique'}</p></div><AdminStateLabel value={model.asset_state ?? 'NO_ASSET'} /></header><dl><div><dt>Version / LOD</dt><dd>{model.asset_version ?? '—'} / {model.lod ?? '—'}</dd></div><div><dt>Taille</dt><dd>{model.size_bytes ? `${model.size_bytes.toLocaleString('fr-FR')} octets` : '—'}</dd></div><div><dt>Généré</dt><dd>{model.generated_at ? formatAdminDate(model.generated_at) : '—'}</dd></div><div><dt>Publié / remplacé</dt><dd>{model.published_at ? formatAdminDate(model.published_at) : 'Non publié'}{model.superseded_at ? ` · remplacé ${formatAdminDate(model.superseded_at)}` : ''}</dd></div><div><dt>Terrain</dt><dd>{model.terrain_source_year ?? 'Non déclaré'}</dd></div><div><dt>Intégrité</dt><dd>{model.sha256 ? <code>{model.sha256}</code> : 'Empreinte non disponible'}</dd></div><div className="admin-model-record__wide"><dt>Motif de révision</dt><dd>{model.reason}</dd></div><div className="admin-model-record__wide"><dt>Référence spatiale technique</dt><dd>{href ? <a href={href}>Ouvrir {model.spatial_zone_id ?? model.asset_spatial_zone_id} / révision {model.spatial_zone_revision ?? model.asset_spatial_zone_revision}</a> : 'Aucune référence spatiale explicitement liée.'}</dd></div></dl></article>; })}</div> : <AdminEmptyState title="Aucune révision de manifeste">Aucun modèle n’est encore lié à cet incident.</AdminEmptyState>}</section>
      <section className="admin-section" aria-labelledby="admin-incident-jobs-title"><div className="admin-section__heading"><div><h3 id="admin-incident-jobs-title">Jobs du pipeline</h3><p>État observé uniquement. La relance, le contrôle du worker et la publication restent des opérations distinctes tant que leurs commandes ne sont pas disponibles.</p></div></div>{state.data.jobs.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Job</th><th>Épisode</th><th>État</th><th>Tentatives</th><th>Planification</th><th>Erreur</th></tr></thead><tbody>{state.data.jobs.map((job) => <tr key={job.job_id}><th scope="row"><code>{job.job_id}</code><small>{job.kind} · créé {formatAdminDate(job.created_at)}</small></th><td>{job.episode_id}</td><td><AdminStateLabel value={job.state} /></td><td>{job.attempt} / {job.max_attempts}</td><td>{job.next_attempt_at ? formatAdminDate(job.next_attempt_at) : `Mis à jour ${formatAdminDate(job.updated_at)}`}</td><td className="admin-table__muted">{job.last_error ?? 'Aucune erreur persistée'}</td></tr>)}</tbody></table></div> : <AdminEmptyState title="Aucun job lié">Aucun job de génération ou de publication n’est persisté pour cet incident.</AdminEmptyState>}</section>
    </section>
  );
}
