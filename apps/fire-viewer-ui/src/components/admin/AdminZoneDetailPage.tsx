import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminMutationFeedback,
  AdminPageHeader,
  AdminStateLabel,
  formatAdminDate,
} from './AdminPageState';
import { AdminZoneFormFields, emptyAdminZoneForm, parseAdminZoneForm, type AdminZoneFormValue } from './AdminZoneFormFields';

interface AdminZoneDetailPageProps {
  readonly zoneId: string;
}

function zoneToForm(zone: {
  readonly zone_id: string;
  readonly label: string;
  readonly description: string;
  readonly bounds_l93_m: readonly [number, number, number, number];
}): AdminZoneFormValue {
  return {
    zoneId: zone.zone_id,
    label: zone.label,
    description: zone.description,
    minX: String(zone.bounds_l93_m[0]),
    minY: String(zone.bounds_l93_m[1]),
    maxX: String(zone.bounds_l93_m[2]),
    maxY: String(zone.bounds_l93_m[3]),
    reason: '',
  };
}

function coordinates(position: readonly [number, number]): string {
  return `${position[0].toLocaleString('fr-FR')} / ${position[1].toLocaleString('fr-FR')}`;
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
  const [form, setForm] = useState(emptyAdminZoneForm);
  const [formError, setFormError] = useState<string | null>(null);
  const updateMutation = useAdminMutation();

  useEffect(() => {
    if (state.kind === 'ready') {
      setForm(zoneToForm(state.data.zone));
      setFormError(null);
    }
  }, [state]);

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseAdminZoneForm(form);
    if (!parsed) {
      setFormError('Complétez une description, une emprise locale valide et un motif avant l’enregistrement.');
      return;
    }
    setFormError(null);
    const input = {
      label: parsed.label,
      description: parsed.description,
      bounds_l93_m: parsed.bounds_l93_m,
      reason: parsed.reason,
    };
    const result = await updateMutation.run(JSON.stringify(input), (options) => api.updateZone(zoneId, input, options));
    if (result) reload();
  };

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement de la zone privée…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;

  const { zone, information, linkedIncidents } = state.data;
  const newInformationHref = `/admin/zones/${encodeURIComponent(zone.zone_id)}/information/nouvelle`;
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
        <section className="admin-action-card">
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
        <section className="admin-action-card">
          <h3>Repères complémentaires</h3>
          <p>Ajoutez seulement les informations ponctuelles utiles. Le contour de l’incendie se modifie dans la carte 3D.</p>
          <a className="button button--small" href={newInformationHref}>Ajouter une information</a>
        </section>
      </div>

      <details className="admin-section admin-disclosure">
        <summary>Paramètres techniques de la zone</summary>
        <form className="admin-form-card admin-form-card--embedded" onSubmit={(event) => void submitEdit(event)}>
          <p>Ces paramètres définissent l’emprise locale. Ils ne publient ni la carte ni le package Unity.</p>
          <AdminZoneFormFields
            value={form}
            onChange={(next) => { setForm(next); setFormError(null); }}
            includeZoneId={false}
            idPrefix={`zone-${zone.zone_id}`}
            disabled={updateMutation.state.pending}
          />
          {formError ? <div className="admin-feedback admin-feedback--error" role="alert">{formError}</div> : null}
          <div className="admin-form-actions">
            <button className="button button--primary" type="submit" disabled={updateMutation.state.pending}>
              {updateMutation.state.pending ? 'Enregistrement…' : 'Enregistrer les paramètres'}
            </button>
          </div>
        </form>
      </details>
      <AdminMutationFeedback
        error={updateMutation.state.error}
        succeeded={updateMutation.state.succeeded}
        success="La définition de la zone a été mise à jour."
      />

      <section className="admin-section" aria-labelledby="admin-zone-information-title">
        <div className="admin-section__heading">
          <div><h3 id="admin-zone-information-title">Informations positionnées</h3><p>Les modifications sont revues avant exposition publique.</p></div>
          <a className="button button--small" href={newInformationHref}>Ajouter</a>
        </div>
        {information.length === 0 ? <AdminEmptyState title="Aucune information locale">Ajoutez une information positionnée pour cette zone technique.</AdminEmptyState> : (
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Information</th><th scope="col">Position L93</th><th scope="col">État</th><th scope="col">Mise à jour</th><th scope="col"><span className="sr-only">Modifier</span></th></tr></thead><tbody>{information.map((item) => (
            <tr key={item.information_id}><th scope="row">{item.title}<small>{item.category}</small></th><td className="admin-table__muted">{coordinates(item.position_l93)}</td><td><AdminStateLabel value={item.state} /></td><td className="admin-table__muted">{formatAdminDate(item.updated_at)}</td><td><a className="button button--small" href={`/admin/zones/${encodeURIComponent(zone.zone_id)}/information/${encodeURIComponent(item.information_id)}`}>Modifier</a></td></tr>
          ))}</tbody></table></div>
        )}
      </section>
    </section>
  );
}
