import { lazy, Suspense, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useAdminApi, useAdminMutation } from './AdminApiContext';
import { AdminMutationFeedback, AdminPageHeader } from './AdminPageState';
import type { IncidentPosition } from './AdminIncidentPlacementMap';

const AdminIncidentPlacementMap = lazy(async () => {
  const module = await import('./AdminIncidentPlacementMap');
  return { default: module.AdminIncidentPlacementMap };
});

type PlacementMode = 'coordinates' | 'map';

function parsePosition(value: string): IncidentPosition | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parts = normalized.includes(';')
    ? normalized.split(';').map((part) => part.trim().replace(',', '.'))
    : normalized.match(/-?\d+(?:[.,]\d+)?/g)?.map((part) => part.replace(',', '.')) ?? [];
  if (parts.length !== 2) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function AdminNewIncidentPage() {
  const api = useAdminApi();
  const mutation = useAdminMutation();
  const [mode, setMode] = useState<PlacementMode>(() => new URLSearchParams(window.location.search).get('mode') === 'map' ? 'map' : 'coordinates');
  const [coordinateText, setCoordinateText] = useState('');
  const [mapPosition, setMapPosition] = useState<IncidentPosition | null>(null);
  const [territoryCode, setTerritoryCode] = useState('');
  const [name, setName] = useState('');
  const [createdFireId, setCreatedFireId] = useState<string | null>(null);
  const pastedPosition = useMemo(() => parsePosition(coordinateText), [coordinateText]);
  const position = mode === 'map' ? mapPosition : pastedPosition;
  const validTerritory = /^[0-9A-Z]{2,3}$/.test(territoryCode.trim().toUpperCase());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!position || !validTerritory) return;
    const normalizedTerritory = territoryCode.trim().toUpperCase();
    const normalizedName = name.trim();
    const result = await mutation.run(
      `${normalizedTerritory}:${position.latitude.toFixed(7)}:${position.longitude.toFixed(7)}:${normalizedName}`,
      (options) => api.createIncident({
        territory_code: normalizedTerritory,
        latitude: position.latitude,
        longitude: position.longitude,
        ...(normalizedName ? { canonical_name: normalizedName } : {}),
      }, options),
    );
    if (result) setCreatedFireId(result.fire_id);
  };

  return (
    <section aria-labelledby="admin-new-incident-title">
      <AdminPageHeader
        title="Créer une fiche incident"
        actions={<a className="button button--small" href="/admin/incidents">Retour aux incidents</a>}
      >
        <p>Indiquez une position connue. La fiche reste privée et sous surveillance jusqu’à validation humaine.</p>
      </AdminPageHeader>

      <form className="admin-form-card admin-form-card--narrow admin-new-incident" onSubmit={(event) => void submit(event)}>
        <div className="admin-placement-mode" role="group" aria-label="Comment indiquer le site">
          <button type="button" aria-pressed={mode === 'coordinates'} onClick={() => setMode('coordinates')}>Coller une position</button>
          <button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>Choisir sur la carte</button>
        </div>

        {mode === 'coordinates' ? (
          <label className="admin-field">
            <span>Position du feu</span>
            <input
              value={coordinateText}
              onChange={(event) => setCoordinateText(event.currentTarget.value)}
              placeholder="44.7532, 5.3701"
              aria-label="Position du feu"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={coordinateText.length > 0 && !pastedPosition}
            />
            <small>Copiez latitude et longitude dans un seul champ.</small>
          </label>
        ) : (
          <Suspense fallback={<p className="admin-page-state">Chargement de la carte…</p>}>
            <AdminIncidentPlacementMap value={mapPosition} onChange={setMapPosition} />
          </Suspense>
        )}

        <div className="admin-form-grid">
          <label className="admin-field">
            <span>Département ou territoire</span>
            <input value={territoryCode} onChange={(event) => setTerritoryCode(event.currentTarget.value.toUpperCase())} placeholder="26" maxLength={3} autoComplete="off" aria-label="Département ou territoire" />
          </label>
          <label className="admin-field">
            <span>Nom utile <small>facultatif</small></span>
            <input value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Ex. massif de Justin" maxLength={255} aria-label="Nom utile" />
          </label>
        </div>

        <div className="admin-form-actions">
          <button className="button button--primary" type="submit" disabled={!position || !validTerritory || mutation.state.pending}>
            {mutation.state.pending ? 'Création…' : 'Créer la fiche incident'}
          </button>
          <a className="button button--small" href="/admin/incidents">Annuler</a>
        </div>
        <AdminMutationFeedback error={mutation.state.error} succeeded={mutation.state.succeeded} success={createdFireId ? `Fiche ${createdFireId} créée sous surveillance.` : 'Fiche créée.'} />
        {createdFireId ? <a className="button button--primary" href={`/admin/incidents/${createdFireId}`}>Ouvrir {createdFireId}</a> : null}
      </form>
    </section>
  );
}
