import { useCallback } from 'react';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import {
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
} from './AdminPageState';

interface AdminZoneDetailPageProps {
  readonly zoneId: string;
}

export function AdminZoneDetailPage({ zoneId }: AdminZoneDetailPageProps) {
  const api = useAdminApi();
  const load = useCallback(async (options: { signal?: AbortSignal }) => {
    const [detail, operationalMap] = await Promise.all([
      api.getZone(zoneId, options),
      api.getOperationalMap(options),
    ]);
    return {
      ...detail,
      linkedIncidents: operationalMap.incidents.filter((incident) => incident.spatial_zone_id === zoneId),
    };
  }, [api, zoneId]);
  const { state, reload } = useAdminQuery(load, [load]);

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement de la zone privée…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;

  const { zone, linkedIncidents } = state.data;
  const linkedIncident = linkedIncidents[0] ?? null;
  const incidentMapHref = linkedIncident
    ? `/admin/incidents/${encodeURIComponent(linkedIncident.fire_id)}/revue-spatiale`
    : null;
  const privateMapHref = linkedIncident?.spatial_zone_revision
    ? `/admin/zones/${encodeURIComponent(zone.zone_id)}/revisions/${linkedIncident.spatial_zone_revision}/preview`
    : null;

  return (
    <section aria-labelledby="admin-zone-detail-title">
      <AdminPageHeader
        title={zone.label}
        actions={<a className="button button--small" href="/admin/zones">Toutes les zones</a>}
      >
        <p><code>{zone.zone_id}</code> · fond cartographique 3D permanent</p>
      </AdminPageHeader>

      <div className="admin-zone-layout">
        <section className="admin-action-card admin-action-card--wide">
          <h3>Carte 3D et périmètre incendie</h3>
          {linkedIncident && incidentMapHref ? <>
            <p>
              La carte 3D reste inchangée. Ajoutez ou modifiez directement le calque du périmètre de{' '}
              <strong>{linkedIncident.canonical_name ?? linkedIncident.fire_id}</strong>.
            </p>
            <div className="admin-form-actions">
              <a className="button button--primary" href={incidentMapHref}>Ouvrir la carte et éditer le périmètre</a>
              {privateMapHref ? <a className="button button--small" href={privateMapHref}>Contrôler le fond 3D</a> : null}
            </div>
          </> : <>
            <p>Ce fond 3D n’est encore rattaché à aucun incident. Rattachez-le une seule fois, puis les mises à jour se feront sous forme de calques.</p>
            <a className="button button--primary" href="/admin/incidents">Choisir un incident</a>
          </>}
        </section>
      </div>
    </section>
  );
}
