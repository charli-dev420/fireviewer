import { useCallback, useEffect, useState } from 'react';
import { PublicIcon } from '../public/PublicIcon';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import {
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  formatAdminDate,
} from './AdminPageState';

const incidentStatuses = [
  ['CANDIDATE', 'Signalé'],
  ['UNDER_REVIEW', 'À confirmer'],
  ['ACTIVE_CONFIRMED', 'Actif confirmé'],
  ['MONITORING', 'Sous surveillance'],
  ['EXTINGUISHED', 'Éteint'],
  ['CLOSED', 'Clos'],
  ['SUSPENDED', 'Suspendu'],
  ['REJECTED', 'Écarté'],
] as const;

const verificationLabels: Readonly<Record<string, string>> = {
  VERIFIED: 'Vérifié',
  CORROBORATED: 'Recoupé',
  PENDING_REVIEW: 'À vérifier',
  UNVERIFIED: 'Non vérifié',
};

function statusLabel(value: string): string {
  return incidentStatuses.find(([status]) => status === value)?.[1]
    ?? value.toLocaleLowerCase('fr-FR').replaceAll('_', ' ');
}

function verificationLabel(value: string): string {
  return verificationLabels[value]
    ?? value.toLocaleLowerCase('fr-FR').replaceAll('_', ' ');
}

export function AdminIncidentDetailPage({ fireId }: { readonly fireId: string }) {
  const api = useAdminApi();
  const load = useCallback(
    (options: { signal?: AbortSignal }) => api.getIncident(fireId, options),
    [api, fireId],
  );
  const { state, reload } = useAdminQuery(load, [load]);
  const mutation = useAdminMutation();
  const [status, setStatus] = useState('');
  const [publicNote, setPublicNote] = useState('');
  const [area, setArea] = useState('');
  const [evacuation, setEvacuation] = useState(false);
  const [evacuationBasis, setEvacuationBasis] = useState('');

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
  const activeSources = incident.sources.filter((source) => source.enabled);
  const sourcePreview = activeSources.slice(0, 3);
  const hasPendingObservations = incident.pending_observation_count > 0;
  const hasUrgentAction = incident.review_required || hasPendingObservations;

  const transition = async () => {
    if (!current || !status) return;
    const selectedStatusLabel = statusLabel(status);
    const reason = `Statut défini manuellement sur « ${selectedStatusLabel} » depuis la fiche incident.`;
    const result = await mutation.run(
      `transition:${status}:${current.version}:${publicNote}`,
      (options) => api.transitionIncident(
        incident.fire_id,
        {
          target_status: status,
          expected_version: current.version,
          reason,
          ...(publicNote.trim() ? { public_note: publicNote.trim() } : {}),
        },
        options,
      ),
    );
    if (result) {
      setPublicNote('');
      reload();
    }
  };

  const updateProfile = async () => {
    if (!current || (evacuation && evacuationBasis.trim().length === 0)) return;
    const parsedArea = area.trim() === '' ? null : Number(area);
    if (parsedArea !== null && (!Number.isFinite(parsedArea) || parsedArea < 0)) return;
    const result = await mutation.run(
      `profile:${current.version}:${parsedArea}:${evacuation}:${evacuationBasis}`,
      (options) => api.updateOperationalProfile(
        incident.fire_id,
        {
          expected_version: current.version,
          estimated_area_ha: parsedArea,
          evacuation_established: evacuation,
          ...(evacuation ? { evacuation_basis: evacuationBasis.trim() } : {}),
          reason: 'Informations opérationnelles mises à jour manuellement depuis la fiche incident.',
        },
        options,
      ),
    );
    if (result) reload();
  };

  return (
    <section className="admin-incident-page" aria-label="Dossier incident">
      <AdminPageHeader
        title={incident.canonical_name ?? `Incident ${incident.territory_code}`}
        actions={<a className="button button--secondary" href="/admin/incidents">Retour aux incidents</a>}
      >
        <p>
          Incident <code>{incident.fire_id}</code> · territoire {incident.territory_code} · dernière observation{' '}
          {formatAdminDate(incident.last_observed_at)}
        </p>
      </AdminPageHeader>

      <div className="admin-incident-cockpit">
        <section className="admin-incident-card" aria-labelledby="incident-situation-title">
          <header className="admin-incident-card__heading">
            <span className="admin-incident-card__icon"><PublicIcon name="flame" size={21} /></span>
            <div>
              <h3 id="incident-situation-title">Situation actuelle</h3>
              <p>Données opérationnelles connues à cet instant.</p>
            </div>
          </header>
          <div className="admin-incident-card__states">
            <span className="admin-state admin-state--neutral">{statusLabel(incident.status)}</span>
            <span className={`admin-state admin-state--${incident.verification_state === 'VERIFIED' ? 'success' : 'warning'}`}>
              {verificationLabel(incident.verification_state)}
            </span>
          </div>
          <dl className="admin-incident-card__facts">
            <div>
              <dt>Surface estimée</dt>
              <dd>{incident.estimated_area_ha === null ? 'Non renseignée' : `${incident.estimated_area_ha.toLocaleString('fr-FR')} ha`}</dd>
            </div>
            <div>
              <dt>Évacuation</dt>
              <dd>{incident.evacuation_established ? 'Établie' : 'Non établie'}</dd>
            </div>
            <div>
              <dt>Sources indépendantes</dt>
              <dd>{incident.corroborating_source_count}</dd>
            </div>
            <div>
              <dt>Dernière observation</dt>
              <dd>{formatAdminDate(incident.last_observed_at)}</dd>
            </div>
          </dl>
        </section>

        <section className="admin-incident-card" aria-labelledby="incident-map-title">
          <header className="admin-incident-card__heading">
            <span className="admin-incident-card__icon"><PublicIcon name="map" size={21} /></span>
            <div>
              <h3 id="incident-map-title">Carte</h3>
              <p>{hasSpatialMap ? 'Le fond 3D est lié à cet incident.' : 'Aucune carte 3D n’est encore liée à cet incident.'}</p>
            </div>
          </header>
          <div className={`admin-incident-card__availability ${hasSpatialMap ? 'is-ready' : 'is-missing'}`}>
            <PublicIcon name={hasSpatialMap ? 'check-circle' : 'info'} size={18} />
            <strong>{hasSpatialMap ? 'Carte disponible' : 'Carte à ajouter'}</strong>
          </div>
          <div className="admin-incident-card__actions">
            <a
              className="button button--primary"
              href={hasSpatialMap
                ? `/admin/incidents/${incident.fire_id}/revue-spatiale`
                : `/admin/incidents/${incident.fire_id}/carte/importer`}
            >
              {hasSpatialMap ? 'Ouvrir la carte' : 'Ajouter la carte 3D'}
            </a>
            {incident.visibility === 'PUBLIC' ? (
              <a className="button button--small" href={`/incendie/${encodeURIComponent(incident.fire_id)}`} target="_blank" rel="noreferrer">
                Voir la fiche publique
              </a>
            ) : null}
          </div>
        </section>

        <section className="admin-incident-card" aria-labelledby="incident-sources-title">
          <header className="admin-incident-card__heading">
            <span className="admin-incident-card__icon"><PublicIcon name="image" size={21} /></span>
            <div>
              <h3 id="incident-sources-title">Sources</h3>
              <p>{incident.sources.length} source{incident.sources.length !== 1 ? 's' : ''} liée{incident.sources.length !== 1 ? 's' : ''} · {incident.observations.length} observation{incident.observations.length !== 1 ? 's' : ''}.</p>
            </div>
          </header>
          {sourcePreview.length ? (
            <ul className="admin-incident-card__source-list">
              {sourcePreview.map((source) => (
                <li key={source.source_key}>
                  <PublicIcon name="check-circle" size={16} />
                  <span>{source.display_name ?? source.public_display_name ?? source.source_key}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-incident-card__empty">Aucune source active disponible.</p>
          )}
          <div className="admin-incident-card__actions">
            <a className="button button--secondary" href={`/admin/incidents/${incident.fire_id}/sources-medias`}>
              Consulter les sources
            </a>
          </div>
        </section>

        <section className={`admin-incident-card admin-incident-card--decision ${hasUrgentAction ? 'is-urgent' : 'is-steady'}`} aria-labelledby="incident-actions-title">
          <header className="admin-incident-card__heading">
            <span className="admin-incident-card__icon"><PublicIcon name={hasUrgentAction ? 'warning' : 'check-circle'} size={21} /></span>
            <div>
              <h3 id="incident-actions-title">Actions urgentes</h3>
              <p>
                {hasPendingObservations
                  ? `${incident.pending_observation_count} observation${incident.pending_observation_count > 1 ? 's attendent' : ' attend'} une décision humaine.`
                  : incident.review_required
                    ? 'La situation doit être vérifiée avant sa prochaine mise à jour.'
                    : 'Aucune action urgente n’est signalée.'}
              </p>
            </div>
          </header>
          {hasUrgentAction ? (
            <div className="admin-incident-card__actions">
              <a
                className="button button--primary"
                href={hasPendingObservations
                  ? `/admin/incidents/${incident.fire_id}/observations`
                  : `/admin/incidents/${incident.fire_id}/sources-medias`}
              >
                {hasPendingObservations ? 'Examiner les observations' : 'Vérifier les sources'}
              </a>
            </div>
          ) : (
            <div className="admin-incident-card__availability is-ready">
              <PublicIcon name="check-circle" size={18} />
              <strong>Suivi à jour</strong>
            </div>
          )}
        </section>
      </div>

      <details id="mettre-a-jour" className="admin-section admin-disclosure admin-incident-secondary">
        <summary>Mettre à jour la situation</summary>
        <div className="admin-detail-grid">
          <section className="admin-detail-card">
            <h3>Informations opérationnelles</h3>
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
              Une évacuation est confirmée
            </label>
            {evacuation ? (
              <label>
                Source ou consigne confirmant l’évacuation
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={evacuationBasis}
                  onChange={(event) => setEvacuationBasis(event.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="button button--secondary"
              disabled={mutation.state.pending || !current || (evacuation && !evacuationBasis.trim())}
              onClick={() => void updateProfile()}
            >
              Enregistrer la situation
            </button>
          </section>

          <section className="admin-detail-card">
            <h3>Changer le statut</h3>
            <label>
              Nouveau statut
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Choisir</option>
                {incidentStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Note publique facultative
              <textarea rows={2} value={publicNote} maxLength={500} onChange={(event) => setPublicNote(event.target.value)} />
            </label>
            <button
              type="button"
              className="button button--primary"
              disabled={mutation.state.pending || !current || !status}
              onClick={() => void transition()}
            >
              Changer le statut
            </button>
          </section>
        </div>
      </details>

      <details id="history" className="admin-section admin-disclosure admin-incident-secondary">
        <summary>Historique et détails techniques</summary>
        <div className="admin-detail-grid">
          <section className="admin-detail-card">
            <h3>Épisodes</h3>
            {incident.episodes.map((episode) => (
              <div key={episode.episode_id}>
                <strong>{episode.episode_id}</strong> · {episode.status} · {episode.verification_state} · {episode.is_current ? 'courant' : 'historique'}
                <small>
                  {episode.corroborating_source_count} preuve(s) · dernière observation : {formatAdminDate(episode.last_observed_at)} · v{episode.version}
                </small>
              </div>
            ))}
          </section>

          <section className="admin-detail-card">
            <h3>Observations</h3>
            {incident.observations.length ? incident.observations.map((item) => (
              <div key={item.observation_id}>
                <strong>{item.observation_id}</strong> · {item.verification_state} · source {item.source_key}
                <small>{item.attached_episode_id ? `Rattachée à ${item.attached_episode_id}` : 'Non rattachée'}</small>
              </div>
            )) : <p>Aucune observation attachée.</p>}
          </section>

          <section className="admin-detail-card">
            <h3>Modèles et révisions</h3>
            {incident.models.length ? incident.models.map((model) => (
              <div key={model.revision}>
                <strong>Manifest v{model.revision}</strong> · épisode <code>{model.episode_id}</code> · {model.asset_state ?? 'sans asset'}
                <small>Asset : {model.asset_id ?? 'non associé'}{model.asset_version ? ` · version ${model.asset_version}` : ''}</small>
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
                <small>{formatAdminDate(event.occurred_at)} · {event.target_type} {event.target_id} · {event.reason}</small>
              </div>
            )) : <p>Aucun événement d’audit lié.</p>}
          </section>
        </div>
      </details>

      {mutation.state.error ? <AdminErrorState error={mutation.state.error} /> : null}
    </section>
  );
}
