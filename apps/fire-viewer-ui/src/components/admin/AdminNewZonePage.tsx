import { useState, type FormEvent } from 'react';
import { useAdminApi, useAdminMutation } from './AdminApiContext';
import { AdminMutationFeedback, AdminPageHeader } from './AdminPageState';
import { AdminZoneFormFields, emptyAdminZoneForm, parseAdminZoneForm } from './AdminZoneFormFields';

export function AdminNewZonePage() {
  const api = useAdminApi();
  const [form, setForm] = useState(emptyAdminZoneForm);
  const [localError, setLocalError] = useState<string | null>(null);
  const [createdZoneId, setCreatedZoneId] = useState<string | null>(null);
  const mutation = useAdminMutation();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = parseAdminZoneForm(form);
    if (!input) {
      setLocalError('Complétez une identité, une description, une emprise locale valide et un motif.');
      return;
    }
    setLocalError(null);
    const result = await mutation.run(JSON.stringify(input), (options) => api.createZone(input, options));
    if (result) setCreatedZoneId(result.zone.zone_id);
  };

  return (
    <section aria-labelledby="admin-new-zone-title">
      <AdminPageHeader title="Créer une zone">
        <p>La zone créée reste en brouillon. Elle ne devient visible qu’après un contrôle explicite puis une publication.</p>
      </AdminPageHeader>
      <form className="admin-form-card" onSubmit={(event) => void submit(event)}>
        <AdminZoneFormFields
          value={form}
          onChange={(next) => { setForm(next); setLocalError(null); }}
          includeZoneId
          idPrefix="new-zone"
          disabled={mutation.state.pending}
        />
        {localError ? <div className="admin-feedback admin-feedback--error" role="alert">{localError}</div> : null}
        <AdminMutationFeedback
          error={mutation.state.error}
          succeeded={mutation.state.succeeded}
          success="Zone créée. Ouverture de son espace privé…"
        />
        <div className="admin-form-actions">
          <a className="button button--small" href="/admin/zones">Annuler</a>
          <button className="button button--primary" type="submit" disabled={mutation.state.pending}>
            {mutation.state.pending ? 'Création…' : 'Créer la zone'}
          </button>
        </div>
      </form>
      {createdZoneId ? (
        <section className="admin-result-card" aria-labelledby="admin-zone-created-title">
          <h3 id="admin-zone-created-title">Zone créée</h3>
          <p>La zone reste en brouillon tant qu’une publication explicite n’a pas été demandée depuis son espace privé.</p>
          <a className="button button--primary" href={`/admin/zones/${encodeURIComponent(createdZoneId)}`}>Ouvrir la zone</a>
        </section>
      ) : null}
    </section>
  );
}
