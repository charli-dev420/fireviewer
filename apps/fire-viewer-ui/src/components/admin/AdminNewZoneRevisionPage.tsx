import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useAdminApi, useAdminMutation } from './AdminApiContext';
import { AdminMutationFeedback, AdminPageHeader } from './AdminPageState';

interface RevisionForm {
  originLon: string;
  originLat: string;
  orthometricHeight: string;
  geoidUndulation: string;
  eastMin: string;
  eastMax: string;
  northMin: string;
  northMax: string;
  upMin: string;
  upMax: string;
  reason: string;
}

const emptyRevisionForm: RevisionForm = {
  originLon: '', originLat: '', orthometricHeight: '', geoidUndulation: '',
  eastMin: '', eastMax: '', northMin: '', northMax: '', upMin: '', upMax: '', reason: '',
};

function finite(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function AdminNewZoneRevisionPage({ zoneId }: { readonly zoneId: string }) {
  const api = useAdminApi();
  const mutation = useAdminMutation();
  const [form, setForm] = useState<RevisionForm>(emptyRevisionForm);
  const [error, setError] = useState<string | null>(null);
  const [createdRevision, setCreatedRevision] = useState<number | null>(null);
  const set = (field: keyof RevisionForm) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((current) => ({ ...current, [field]: event.currentTarget.value }));
    setError(null);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = [form.eastMin, form.eastMax, form.northMin, form.northMax, form.upMin, form.upMax].map(finite);
    const originLon = finite(form.originLon);
    const originLat = finite(form.originLat);
    const orthometricHeight = finite(form.orthometricHeight);
    const geoidUndulation = finite(form.geoidUndulation);
    if (originLon === null || originLat === null || orthometricHeight === null || geoidUndulation === null || values.some((value) => value === null)
      || values[0]! >= values[1]! || values[2]! >= values[3]! || values[4]! >= values[5]!
      || !(values[0]! <= 0 && values[1]! >= 0 && values[2]! <= 0 && values[3]! >= 0 && values[4]! <= 0 && values[5]! >= 0)
      || form.reason.trim().length < 10) {
      setError('Renseignez une origine, des bornes finies incluant 0 et un motif de dix caractères au minimum.');
      return;
    }
    const result = await mutation.run(JSON.stringify(form), (options) => api.createZoneRevision(zoneId, {
      origin_lon: originLon,
      origin_lat: originLat,
      source_orthometric_height_m: orthometricHeight,
      geoid_undulation_m: geoidUndulation,
      bounds_m: values as [number, number, number, number, number, number],
      reason: form.reason.trim(),
    }, options));
    if (result) setCreatedRevision(result.revision.revision);
  }

  return <section aria-labelledby="admin-new-zone-revision-title">
    <AdminPageHeader title="Créer une révision spatiale" actions={<a className="button button--small" href={`/admin/zones/${encodeURIComponent(zoneId)}`}>Référence technique</a>}>
      <p><code>{zoneId}</code> · le serveur convertit l’origine d’échange WGS84 en origine de production Lambert-93 / NGF et fige l’emprise locale avant tout import.</p>
    </AdminPageHeader>
    <form className="admin-form-card" onSubmit={(event) => void submit(event)}>
      <h3 id="admin-new-zone-revision-title">Référentiel géométrique immuable</h3>
      <p>Profil créé : EPSG:2154 horizontal, EPSG:5720 vertical, MNT de référence à 0,5 m et hauteurs de surface relatives au MNT.</p>
      <div className="admin-form-grid">
        <label>Longitude WGS84<input inputMode="decimal" value={form.originLon} onChange={set('originLon')} disabled={mutation.state.pending} required /></label>
        <label>Latitude WGS84<input inputMode="decimal" value={form.originLat} onChange={set('originLat')} disabled={mutation.state.pending} required /></label>
        <label>Hauteur orthométrique (m)<input inputMode="decimal" value={form.orthometricHeight} onChange={set('orthometricHeight')} disabled={mutation.state.pending} required /></label>
        <label>Ondulation du géoïde (m)<input inputMode="decimal" value={form.geoidUndulation} onChange={set('geoidUndulation')} disabled={mutation.state.pending} required /></label>
        <label>Est minimum (m)<input inputMode="decimal" value={form.eastMin} onChange={set('eastMin')} disabled={mutation.state.pending} required /></label>
        <label>Est maximum (m)<input inputMode="decimal" value={form.eastMax} onChange={set('eastMax')} disabled={mutation.state.pending} required /></label>
        <label>Nord minimum (m)<input inputMode="decimal" value={form.northMin} onChange={set('northMin')} disabled={mutation.state.pending} required /></label>
        <label>Nord maximum (m)<input inputMode="decimal" value={form.northMax} onChange={set('northMax')} disabled={mutation.state.pending} required /></label>
        <label>Altitude minimum (m)<input inputMode="decimal" value={form.upMin} onChange={set('upMin')} disabled={mutation.state.pending} required /></label>
        <label>Altitude maximum (m)<input inputMode="decimal" value={form.upMax} onChange={set('upMax')} disabled={mutation.state.pending} required /></label>
      </div>
      <label>Motif de création<textarea value={form.reason} onChange={set('reason')} minLength={10} maxLength={500} disabled={mutation.state.pending} required /></label>
      {error ? <div className="admin-feedback admin-feedback--error" role="alert">{error}</div> : null}
      <AdminMutationFeedback error={mutation.state.error} succeeded={mutation.state.succeeded} success="Révision spatiale créée." />
      <div className="admin-form-actions"><button className="button button--primary" type="submit" disabled={mutation.state.pending}>{mutation.state.pending ? 'Création…' : 'Créer la révision'}</button></div>
    </form>
    {createdRevision ? <section className="admin-result-card"><h3>Révision créée</h3><p>Elle est immuable. Importez maintenant le package correspondant à cette révision.</p><a className="button button--primary" href={`/admin/zones/${encodeURIComponent(zoneId)}/revisions/${createdRevision}`}>Ouvrir la révision {createdRevision}</a></section> : null}
  </section>;
}
