import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ADMIN_INFORMATION_STATES,
  type AdminInformationState,
  type CreateAdminInformationInput,
  type UpdateAdminInformationInput,
} from '../../lib/adminApi';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import { AdminLocalPlacementPanel } from './AdminLocalPlacementPanel';
import { AdminErrorState, AdminLoadingState, AdminMutationFeedback, AdminPageHeader, AdminStateLabel } from './AdminPageState';

interface AdminInformationEditorPageProps {
  readonly zoneId: string;
  readonly informationId?: string;
}

interface InformationFormValue {
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly easting: string;
  readonly northing: string;
  readonly state: AdminInformationState;
  readonly reason: string;
}

function emptyForm(): InformationFormValue {
  return { title: '', body: '', category: '', easting: '', northing: '', state: 'DRAFT', reason: '' };
}

function parseForm(value: InformationFormValue, bounds: readonly [number, number, number, number]): CreateAdminInformationInput | null {
  const easting = Number(value.easting);
  const northing = Number(value.northing);
  if (
    value.title.trim().length === 0
    || value.body.trim().length === 0
    || value.category.trim().length === 0
    || value.reason.trim().length === 0
    || value.easting.trim().length === 0
    || value.northing.trim().length === 0
    || !Number.isFinite(easting)
    || !Number.isFinite(northing)
    || easting < bounds[0]
    || easting > bounds[2]
    || northing < bounds[1]
    || northing > bounds[3]
  ) {
    return null;
  }
  return {
    title: value.title.trim(),
    body: value.body.trim(),
    category: value.category.trim(),
    position_l93: [easting, northing],
    reason: value.reason.trim(),
  };
}

export function AdminInformationEditorPage({ zoneId, informationId }: AdminInformationEditorPageProps) {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getZone(zoneId, options), [api, zoneId]);
  const { state: query, reload } = useAdminQuery(load, [load]);
  const [form, setForm] = useState(emptyForm);
  const [localError, setLocalError] = useState<string | null>(null);
  const [savedInformationId, setSavedInformationId] = useState<string | null>(null);
  const mutation = useAdminMutation();
  const editing = Boolean(informationId);

  const currentInformation = query.kind === 'ready' && informationId
    ? query.data.information.find((item) => item.information_id === informationId) ?? null
    : null;

  useEffect(() => {
    if (!currentInformation) return;
    setForm({
      title: currentInformation.title,
      body: currentInformation.body,
      category: currentInformation.category,
      easting: String(currentInformation.position_l93[0]),
      northing: String(currentInformation.position_l93[1]),
      state: currentInformation.state,
      reason: '',
    });
  }, [currentInformation]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (query.kind !== 'ready') return;
    const input = parseForm(form, query.data.zone.bounds_l93_m);
    if (!input) {
      setLocalError('Les coordonnées doivent être finies et situées dans l’emprise locale de la zone.');
      return;
    }
    setLocalError(null);
    const fingerprint = JSON.stringify({ ...input, state: form.state, informationId });
    const result = editing && informationId
      ? await mutation.run(fingerprint, (options) => api.updateInformation(zoneId, informationId, { ...input, state: form.state } satisfies UpdateAdminInformationInput, options))
      : await mutation.run(fingerprint, (options) => api.createInformation(zoneId, input, options));
    if (result) setSavedInformationId(result.information.information_id);
  };

  if (query.kind === 'loading') return <AdminLoadingState label="Chargement du repère local de la zone…" />;
  if (query.kind === 'error') return <AdminErrorState error={query.error} onRetry={reload} />;
  if (editing && !currentInformation) {
    return <AdminErrorState error={new Error('Cette information n’existe pas dans la zone demandée.')} />;
  }

  const bounds = query.data.zone.bounds_l93_m;
  const position = Number.isFinite(Number(form.easting)) && Number.isFinite(Number(form.northing))
    ? [Number(form.easting), Number(form.northing)] as const
    : null;
  const set = <K extends keyof InformationFormValue>(key: K, value: InformationFormValue[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setLocalError(null);
  };

  return (
    <section aria-labelledby="admin-information-title">
      <AdminPageHeader
        title={editing ? `Modifier une information — ${zoneId}` : `Ajouter une information — ${zoneId}`}
        actions={<a className="button button--small" href={`/admin/zones/${encodeURIComponent(zoneId)}`}>Retour à la zone</a>}
      >
        <p>L’information est placée exclusivement dans le repère Lambert-93 de cette zone locale.</p>
      </AdminPageHeader>
      <form className="admin-form-card" onSubmit={(event) => void submit(event)}>
        <div className="admin-form-grid">
          <label className="admin-field" htmlFor="admin-information-title-field"><span>Titre</span><input id="admin-information-title-field" value={form.title} onChange={(event) => set('title', event.currentTarget.value)} maxLength={255} required disabled={mutation.state.pending} /></label>
          <label className="admin-field" htmlFor="admin-information-category"><span>Catégorie</span><input id="admin-information-category" value={form.category} onChange={(event) => set('category', event.currentTarget.value)} maxLength={64} required disabled={mutation.state.pending} /></label>
          <label className="admin-field admin-field--wide" htmlFor="admin-information-body"><span>Contenu</span><textarea id="admin-information-body" value={form.body} onChange={(event) => set('body', event.currentTarget.value)} rows={5} maxLength={8_000} required disabled={mutation.state.pending} /></label>
          <fieldset className="admin-fieldset admin-fieldset--wide">
            <legend>Position Lambert-93 (mètres)</legend>
            <div className="admin-coordinate-grid">
              <label htmlFor="admin-information-easting"><span>Est / X</span><input id="admin-information-easting" type="number" step="any" value={form.easting} onChange={(event) => set('easting', event.currentTarget.value)} required disabled={mutation.state.pending} /></label>
              <label htmlFor="admin-information-northing"><span>Nord / Y</span><input id="admin-information-northing" type="number" step="any" value={form.northing} onChange={(event) => set('northing', event.currentTarget.value)} required disabled={mutation.state.pending} /></label>
            </div>
          </fieldset>
          <div className="admin-field--wide">
            <AdminLocalPlacementPanel
              bounds={bounds}
              position={position}
              disabled={mutation.state.pending}
              onChange={(next) => {
                setForm((current) => ({ ...current, easting: String(next[0]), northing: String(next[1]) }));
                setLocalError(null);
              }}
            />
          </div>
          {editing ? (
            <label className="admin-field" htmlFor="admin-information-state">
              <span>État de revue</span>
              <select id="admin-information-state" value={form.state} onChange={(event) => set('state', event.currentTarget.value as AdminInformationState)} disabled={mutation.state.pending}>
                {ADMIN_INFORMATION_STATES.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
              </select>
              <small>État actuel : {currentInformation ? <AdminStateLabel value={currentInformation.state} /> : null}</small>
            </label>
          ) : null}
          <label className="admin-field admin-field--wide" htmlFor="admin-information-reason"><span>Motif administratif</span><textarea id="admin-information-reason" value={form.reason} onChange={(event) => set('reason', event.currentTarget.value)} rows={2} maxLength={500} required disabled={mutation.state.pending} /></label>
        </div>
        {localError ? <div className="admin-feedback admin-feedback--error" role="alert">{localError}</div> : null}
        <AdminMutationFeedback error={mutation.state.error} succeeded={mutation.state.succeeded} success={editing ? 'Information mise à jour.' : 'Information créée.'} />
        <div className="admin-form-actions"><a className="button button--small" href={`/admin/zones/${encodeURIComponent(zoneId)}`}>Annuler</a><button className="button button--primary" type="submit" disabled={mutation.state.pending}>{mutation.state.pending ? 'Enregistrement…' : editing ? 'Enregistrer la revue' : 'Ajouter l’information'}</button></div>
      </form>
      {savedInformationId ? (
        <section className="admin-result-card" aria-labelledby="admin-information-saved-title">
          <h3 id="admin-information-saved-title">Information enregistrée</h3>
          <p>L’identifiant privé <code>{savedInformationId}</code> a été enregistré. Sa visibilité dépend de son état de revue.</p>
          <a className="button button--primary" href={`/admin/zones/${encodeURIComponent(zoneId)}`}>Revenir à la zone</a>
        </section>
      ) : null}
    </section>
  );
}
