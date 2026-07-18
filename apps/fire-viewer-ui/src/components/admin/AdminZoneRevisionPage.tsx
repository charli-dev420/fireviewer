import { useCallback } from 'react';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminErrorState, AdminLoadingState, AdminPageHeader } from './AdminPageState';

export function AdminZoneRevisionPage({
  zoneId,
  revision,
}: {
  readonly zoneId: string;
  readonly revision: number;
}) {
  const api = useAdminApi();
  const load = useCallback(
    (options: { signal?: AbortSignal }) => api.getZoneRevision(zoneId, revision, options),
    [api, revision, zoneId],
  );
  const { state, reload } = useAdminQuery(load, [load]);

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement de la carte 3D…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  const item = state.data;

  return (
    <section aria-labelledby="admin-zone-revision-title">
      <AdminPageHeader
        title={`Carte 3D — version ${item.revision}`}
        actions={<a className="button button--small" href={`/admin/zones/${encodeURIComponent(zoneId)}`}>Retour à la carte</a>}
      >
        <p><code>{zoneId}</code> · les paramètres techniques sont lus automatiquement depuis le package.</p>
      </AdminPageHeader>

      <section className="admin-section admin-action-card" aria-labelledby="admin-zone-revision-title">
        <h3 id="admin-zone-revision-title">Contrôler le fond 3D</h3>
        <p>L’import et le rattachement se font depuis le projet incendie. Aucun identifiant d’upload, identifiant de package ou repère spatial n’est à saisir ici.</p>
        <div className="admin-form-actions">
          <a className="button button--primary" href={`/admin/zones/${encodeURIComponent(zoneId)}/revisions/${item.revision}/preview`}>Ouvrir l’aperçu 3D</a>
          <a className="button button--small" href="/admin/incidents">Choisir un incident</a>
        </div>
      </section>

      <details className="admin-section admin-disclosure">
        <summary>Détails techniques lus dans le package</summary>
        <dl className="manifest-data-list">
          <div><dt>Profil spatial</dt><dd>{item.spatial_profile_version}</dd></div>
          <div><dt>Référence horizontale</dt><dd>{item.horizontal_crs ?? 'Non renseignée'}</dd></div>
          <div><dt>Référence verticale</dt><dd>{item.vertical_crs ?? 'Non renseignée'}</dd></div>
          <div><dt>Terrain de référence</dt><dd>{item.ground_model ? `${item.ground_model} · ${item.ground_resolution_m ?? '—'} m` : 'Non renseigné'}</dd></div>
          <div><dt>Référence des hauteurs</dt><dd>{item.surface_height_reference ?? 'Non renseignée'}</dd></div>
        </dl>
      </details>
    </section>
  );
}
