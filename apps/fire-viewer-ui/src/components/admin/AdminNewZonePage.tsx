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
      <AdminPageHeader title="Préparer une carte 3D">
        <p>Définissez la zone couverte. L’import du package, sa vérification et sa publication se feront ensuite dans la même fiche.</p>
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
          success="Carte créée. Vous pouvez maintenant importer son package 3D."
        />
        <div className="admin-form-actions">
          <a className="button button--small" href="/admin/zones">Annuler</a>
          <button className="button button--primary" type="submit" disabled={mutation.state.pending}>
            {mutation.state.pending ? 'Création…' : 'Créer la carte'}
          </button>
        </div>
      </form>
      {createdZoneId ? (
        <section className="admin-result-card" aria-labelledby="admin-zone-created-title">
          <h3 id="admin-zone-created-title">Carte créée</h3>
          <p>Créez sa première révision, importez le package, contrôlez l’aperçu puis publiez-le sur un incident.</p>
          <a className="button button--primary" href={`/admin/zones/${encodeURIComponent(createdZoneId)}`}>Continuer</a>
        </section>
      ) : null}
    </section>
  );
}
