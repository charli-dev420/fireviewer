import { useCallback, useEffect, useState } from 'react';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import { AdminIncidentWorkspaceNav } from './AdminIncidentWorkspaceNav';
import {
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStateLabel,
  formatAdminDate,
} from './AdminPageState';

const incidentStatuses = [
  'CANDIDATE',
  'UNDER_REVIEW',
  'ACTIVE_CONFIRMED',
  'MONITORING',
  'EXTINGUISHED',
  'CLOSED',
  'SUSPENDED',
  'REJECTED',
] as const;

export function AdminIncidentDetailPage({ fireId }: { readonly fireId: string }) {
  const api = useAdminApi();
  const load = useCallback(
    (options: { signal?: AbortSignal }) => api.getIncident(fireId, options),
    [api, fireId],
  );
  const { state, reload } = useAdminQuery(load, [load]);
  const mutation = useAdminMutation();
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [publicNote, setPublicNote] = useState('');
  const [basis, setBasis] = useState('');
  const [area, setArea] = useState('');
  const [evacuation, setEvacuation] = useState(false);
  const [evacuationBasis, setEvacuationBasis] = useState('');
  const [profileReason, setProfileReason] = useState('');

  const readyIncident = state.kind === 'ready' ? state.data : null;
  const readyCurrent = readyIncident?.episodes.find((episode) => episode.is_current);
  useEffect(() => {
    setArea(
      readyCurrent?.estimated_area_ha === null
      || readyCurrent?.estimated_area_ha === undefined
        ? ''
        : String(readyCurrent.estimated_area_ha),
    );
    setEvacuation(readyCurrent?.evacuation_established ?? false);
    if (!readyCurrent?.evacuation_established) setEvacuationBasis('');
  }, [
    readyCurrent?.episode_id,
    readyCurrent?.estimated_area_ha,
    readyCurrent?.evacuation_established,
  ]);

  if (state.kind === 'loading') {
    return <AdminLoadingState label="Chargement du dossier incident…" />;
  }
  if (state.kind === 'error') {
    return <AdminErrorState error={state.error} onRetry={reload} />;
  }

  const incident = state.data;
  const current = incident.episodes.find((episode) => episode.is_current);
  const hasSpatialMap = incident.models.some((model) => (
    (model.spatial_zone_id && model.spatial_zone_revision)
    || (model.asset_spatial_zone_id && model.asset_spatial_zone_revision)
  ));

  const transition = async () => {
    if (!current || reason.trim().length < 10 || !status) return;
    const result = await mutation.run(
      `transition:${status}:${current.version}:${reason}:${publicNote}:${basis}`,
      (options) => api.transitionIncident(
        incident.fire_id,
        {
          target_status: status,
          expected_version: current.version,
          reason: reason.trim(),
          ...(publicNote.trim() ? { public_note: publicNote.trim() } : {}),
          ...(basis.trim() ? { validation_basis: basis.trim() } : {}),
        },
        options,
      ),
    );
    if (result) {
      setReason('');
      setPublicNote('');
      setBasis('');
      reload();
    }
  };

  const updateProfile = async () => {
    if (
      !current
      || profileReason.trim().length < 10
      || (evacuation && evacuationBasis.trim().length === 0)
    ) return;
    const parsedArea = area.trim() === '' ? null : Number(area);
    if (parsedArea !== null && (!Number.isFinite(parsedArea) || parsedArea < 0)) return;
    const result = await mutation.run(
      `profile:${current.version}:${parsedArea}:${evacuation}:${evacuationBasis}:${profileReason}`,
      (options) => api.updateOperationalProfile(
        incident.fire_id,
        {
          expected_version: current.version,
          estimated_area_ha: parsedArea,
          evacuation_established: evacuation,
          ...(evacuation ? { evacuation_basis: evacuationBasis.trim() } : {}),
          reason: profileReason.trim(),
        },
        options,
      ),
    );
    if (result) {
      setProfileReason('');
      reload();
    }
  };

  return (
    <section aria-labelledby="admin-incident-title">
      <AdminPageHeader
        title={incident.canonical_name ?? incident.fire_id}
        actions={<a className="button button--secondary" href="/admin/incidents">Retour aux incidents</a>}
      >
        <p>
          <code>{incident.fire_id}</code> · épisode courant{' '}
          <code>{incident.current_episode_id}</code> · visibilité {incident.visibility}
        </p>
      </AdminPageHeader>
      <AdminIncidentWorkspaceNav fireId={incident.fire_id} active="dossier" />

      <div className="admin-detail-grid">
        <section className="admin-detail-card admin-detail-advanced">
          <h3>Cycle de vie</h3>
          <dl>
            <div><dt>Statut</dt><dd><AdminStateLabel value={incident.status} /></dd></div>
            <div><dt>Vérification</dt><dd><AdminStateLabel value={incident.verification_state} /></dd></div>
            <div><dt>Preuves indépendantes</dt><dd>{incident.corroborating_source_count}</dd></div>
            <div><dt>Revue</dt><dd>{incident.review_required ? 'Requise' : 'À jour'}</dd></div>
            <div><dt>Version incident</dt><dd>{incident.version}</dd></div>
          </dl>
          <div className="admin-form-actions">
            <a className="button button--small" href={`/admin/incidents/${incident.fire_id}/observations`}>Valider les preuves</a>
          </div>
        </section>

        <section id="publication" className="admin-detail-card admin-detail-advanced">
          <h3>Publication</h3>
          <p>{hasSpatialMap ? 'Le fond 3D est lié à ce projet. Gérez ici le périmètre et son rendu public.' : 'Commencez par ajouter le fond 3D directement dans ce projet.'}</p>
          <div className="admin-form-actions">
            {hasSpatialMap ? (
              <a className="button button--primary" href={`/admin/incidents/${incident.fire_id}/revue-spatiale`}>Carte & périmètre</a>
            ) : (
              <a className="button button--primary" href={`/admin/incidents/${incident.fire_id}/carte/importer`}>Importer le fond 3D</a>
            )}
            <a className="button button--small" href={`/incendie/${encodeURIComponent(incident.fire_id)}`} target="_blank" rel="noreferrer">Voir la fiche publique</a>
          </div>
        </section>

        <details id="infos-stats" className="admin-section admin-disclosure admin-detail-advanced">
          <summary>Modifier l’incident</summary>
          <div className="admin-detail-grid">
        <section className="admin-detail-card">
          <h3>Profil opérationnel</h3>
          <p>
            La fiche publique reste disponible sous 500 ha. Ces champs calculent
            seulement l’éligibilité à une production externe ; aucun modèle n’est
            généré ou chargé ici.
          </p>
          <label>
            Surface estimée (ha)
            <input
              type="number"
              min="0"
              step="0.1"
              value={area}
              onChange={(event) => setArea(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={evacuation}
              onChange={(event) => setEvacuation(event.target.checked)}
            />{' '}
            Évacuation établie
          </label>
          {evacuation ? (
            <label>
              Base de l’évacuation
              <textarea
                rows={2}
                maxLength={1000}
                value={evacuationBasis}
                onChange={(event) => setEvacuationBasis(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            Motif audité
            <textarea
              rows={2}
              maxLength={500}
              value={profileReason}
              onChange={(event) => setProfileReason(event.target.value)}
            />
          </label>
          <p>
            <strong>{incident.model_generation_eligible ? 'Éligible' : 'Non éligible'}</strong>
            {' '}· seuil de surface 500 ha ou évacuation établie.
          </p>
          <button
            type="button"
            className="button button--secondary"
            disabled={
              mutation.state.pending
              || !current
              || profileReason.trim().length < 10
              || (evacuation && !evacuationBasis.trim())
            }
            onClick={() => void updateProfile()}
          >
            Enregistrer le profil
          </button>
        </section>

        <section className="admin-detail-card">
          <h3>Transition contrôlée</h3>
          <p>La machine d’état et les rôles serveur restent l’autorité de décision.</p>
          <label>
            Statut cible
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Choisir</option>
              {incidentStatuses.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            Motif audité
            <textarea rows={3} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label>
            Note publique facultative
            <textarea rows={2} value={publicNote} maxLength={500} onChange={(event) => setPublicNote(event.target.value)} />
          </label>
          <label>
            Base de validation
            <textarea rows={2} value={basis} maxLength={1000} onChange={(event) => setBasis(event.target.value)} />
          </label>
          <button
            type="button"
            className="button button--primary"
            disabled={mutation.state.pending || !current || reason.trim().length < 10 || !status}
            onClick={() => void transition()}
          >
            Appliquer la transition
          </button>
        </section>
          </div>
        </details>

        <details id="history" className="admin-section admin-disclosure admin-detail-advanced">
          <summary>Historique, sources et détails techniques</summary>
          <div className="admin-detail-grid">
          <section className="admin-detail-card">
            <h3>Épisodes</h3>
          {incident.episodes.map((episode) => (
            <div key={episode.episode_id}>
              <strong>{episode.episode_id}</strong> · {episode.status} ·{' '}
              {episode.verification_state} · {episode.is_current ? 'courant' : 'historique'}
              <small>
                {episode.corroborating_source_count} preuve(s) · dernière observation :{' '}
                {formatAdminDate(episode.last_observed_at)} · v{episode.version}
              </small>
            </div>
          ))}
          </section>

          <section className="admin-detail-card">
          <h3>Observations et rattachement</h3>
          {incident.observations.length ? incident.observations.map((item) => (
            <div key={item.observation_id}>
              <strong>{item.observation_id}</strong> · {item.verification_state} · source {item.source_key}
              <small>
                {item.attached_episode_id ? `Rattachée à ${item.attached_episode_id}` : 'Non rattachée'}
                {item.proposed_fire_id ? ` · candidat ${item.proposed_fire_id}/${item.proposed_episode_id ?? '?'}` : ''}
                {item.match_score !== null ? ` · score ${item.match_score.toFixed(2)}` : ''}
                {item.review_reasons.length ? ` · ${item.review_reasons.join(', ')}` : ''}
              </small>
            </div>
          )) : <p>Aucune observation attachée.</p>}
          <a className="button button--small" href={`/admin/incidents/${incident.fire_id}/observations`}>
            Ouvrir les observations
          </a>
          </section>

          <section className="admin-detail-card">
          <h3>Sources</h3>
          {incident.sources.length ? incident.sources.map((source) => (
            <div key={source.source_key}>
              <strong>{source.display_name ?? source.source_key}</strong> · {source.type} · {source.trust}
              <small>
                {source.enabled ? 'Active' : 'Désactivée'} · diffusion{' '}
                {source.public_display_name ?? 'non déclarée'}
              </small>
            </div>
          )) : <p>Aucune source attachée.</p>}
          <a className="button button--small" href={`/admin/incidents/${incident.fire_id}/sources-medias`}>
            Ouvrir sources et médias
          </a>
          </section>

          <section className="admin-detail-card">
          <h3>Modèles et révisions</h3>
          {incident.models.length ? incident.models.map((model) => (
              <div key={model.revision}>
                <strong>Manifest v{model.revision}</strong> · épisode{' '}
                <code>{model.episode_id}</code> · {model.asset_state ?? 'sans asset'}
                <small>
                  Asset : {model.asset_id ?? 'non associé'}
                  {model.asset_version ? ` · version ${model.asset_version}` : ''}
                  {model.size_bytes ? ` · ${model.size_bytes.toLocaleString('fr-FR')} octets` : ''}
                </small>
                <small>
                  {(model.spatial_zone_id ?? model.asset_spatial_zone_id)
                    ? `Référence technique : ${model.spatial_zone_id ?? model.asset_spatial_zone_id} r${model.spatial_zone_revision ?? model.asset_spatial_zone_revision}`
                    : 'Aucune référence spatiale technique persistée.'}
                </small>
              </div>
          )) : <p>Aucune révision de modèle.</p>}
          <a className="button button--small" href={`/admin/incidents/${incident.fire_id}/modeles-pipeline`}>
            Ouvrir modèles et pipeline
          </a>
          </section>

          <section className="admin-detail-card">
          <h3>Audit</h3>
          {incident.audit.length ? incident.audit.map((event) => (
            <div key={event.event_id}>
              <strong>{event.action}</strong> · {event.actor_type}/{event.actor_id}
              <small>
                {formatAdminDate(event.occurred_at)} · {event.target_type} {event.target_id} · {event.reason}
              </small>
            </div>
          )) : <p>Aucun événement d’audit lié.</p>}
          </section>
          </div>
        </details>
      </div>

      {mutation.state.error ? <AdminErrorState error={mutation.state.error} /> : null}
    </section>
  );
}
