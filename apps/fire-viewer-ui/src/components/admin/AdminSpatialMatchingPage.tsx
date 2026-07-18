import { useCallback, useState } from 'react';
import type { AdminWorkQueue } from '../../lib/adminApi';
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

type PendingObservation = AdminWorkQueue['observations'][number];
type ResolutionAction = 'attach' | 'create' | 'reject';

const FIRE_ID_PATTERN = /^FR-[0-9A-Z]{2,3}-[0-9]{5}$/;

function formatCoordinates(observation: PendingObservation): string {
  return `${observation.latitude.toFixed(5)}, ${observation.longitude.toFixed(5)}`;
}

function candidateLabel(observation: PendingObservation): string {
  if (!observation.proposed_fire_id) return 'Aucun incident proposé';
  return `${observation.proposed_fire_id} / ${observation.proposed_episode_id ?? 'épisode non déterminé'}`;
}

/**
 * Revue explicable des rapprochements. Cette surface ne calcule ni ne force
 * une fusion : le serveur conserve la décision, les règles et l'audit.
 */
export function AdminSpatialMatchingPage() {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getWorkQueue(options), [api]);
  const { state, reload } = useAdminQuery(load, [load]);
  const mutation = useAdminMutation();
  const [filter, setFilter] = useState<'all' | 'candidate' | 'unmatched'>('all');
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<{ observationId: string; fireId: string | null; episodeId: string | null } | null>(null);

  const resolve = async (observation: PendingObservation, action: ResolutionAction) => {
    const reason = reasons[observation.observation_id]?.trim() ?? '';
    const targetFireId = (targets[observation.observation_id] ?? observation.proposed_fire_id ?? '').trim().toUpperCase();
    if (reason.length < 10 || (action === 'attach' && !FIRE_ID_PATTERN.test(targetFireId))) return;

    const result = await mutation.run(
      `${observation.observation_id}:${action}:${observation.version}:${targetFireId}:${reason}`,
      (options) => api.resolveObservation(
        observation.observation_id,
        {
          action,
          expected_version: observation.version,
          reason,
          ...(action === 'attach' ? { target_fire_id: targetFireId } : {}),
        },
        options,
      ),
    );
    if (result) {
      setResolved({ observationId: result.observation_id, fireId: result.fire_id, episodeId: result.episode_id });
      reload();
    }
  };

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement des rapprochements spatiaux…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;

  const observations = state.data.observations.filter((observation) => {
    if (filter === 'candidate') return observation.proposed_fire_id !== null;
    if (filter === 'unmatched') return observation.proposed_fire_id === null;
    return true;
  });

  return (
    <section aria-labelledby="admin-spatial-matching-title">
      <AdminPageHeader title="Rapprochement spatial" actions={<a className="button button--secondary" href="/admin/validation">Retour à la validation</a>}>
        <p>Examinez chaque observation non résolue à partir de ses coordonnées, de son incertitude et des motifs proposés. La distance seule ne suffit jamais et aucune fusion n’est automatique.</p>
      </AdminPageHeader>

      <section className="admin-section" aria-labelledby="admin-spatial-matching-title">
        <div className="admin-section__heading">
          <div>
            <h3 id="admin-spatial-matching-title">Observations à rattacher</h3>
            <p>Une résolution crée un événement audité. Le serveur peut ouvrir un nouvel épisode uniquement lorsque ses règles de réactivation le permettent.</p>
          </div>
          <label className="admin-field admin-field--compact" htmlFor="spatial-matching-filter">
            <span>Afficher</span>
            <select id="spatial-matching-filter" value={filter} onChange={(event) => {
              const value = event.currentTarget.value as typeof filter;
              setFilter(value);
            }}>
              <option value="all">Toutes les observations</option>
              <option value="candidate">Avec candidat</option>
              <option value="unmatched">Sans candidat</option>
            </select>
          </label>
        </div>

        {observations.length === 0 ? (
          <AdminEmptyState title="Aucun rapprochement dans cette vue">Aucune observation non résolue ne correspond au filtre choisi.</AdminEmptyState>
        ) : (
          <div className="admin-spatial-review-list">
            {observations.map((observation) => {
              const target = targets[observation.observation_id] ?? observation.proposed_fire_id ?? '';
              const reason = reasons[observation.observation_id] ?? '';
              const canAttach = FIRE_ID_PATTERN.test(target.trim().toUpperCase()) && reason.trim().length >= 10;
              const canResolveWithoutTarget = reason.trim().length >= 10;
              return (
                <article className="admin-spatial-review" key={observation.observation_id}>
                  <header>
                    <div>
                      <p className="eyebrow">Observation non résolue · v{observation.version}</p>
                      <h4><code>{observation.observation_id}</code></h4>
                      <p>{observation.source_key} · observée {formatAdminDate(observation.observed_at)} · <AdminStateLabel value={observation.verification_state} /></p>
                    </div>
                    {observation.proposed_fire_id ? <a className="button button--small" href={`/admin/incidents/${observation.proposed_fire_id}`}>Ouvrir le dossier candidat</a> : null}
                  </header>

                  <dl className="admin-spatial-review__facts">
                    <div><dt>Position observée</dt><dd><code>{formatCoordinates(observation)}</code></dd></div>
                    <div><dt>Incertitude horizontale</dt><dd>{observation.horizontal_uncertainty_m.toLocaleString('fr-FR')} m</dd></div>
                    <div><dt>Candidat proposé</dt><dd>{observation.proposed_fire_id ? <a href={`/admin/incidents/${observation.proposed_fire_id}`}><code>{candidateLabel(observation)}</code></a> : candidateLabel(observation)}</dd></div>
                    <div><dt>Score explicatif</dt><dd>{observation.match_score === null ? 'Non calculé' : observation.match_score.toFixed(2)}</dd></div>
                    <div className="admin-spatial-review__reasons"><dt>Motifs de rapprochement</dt><dd>{observation.review_reasons.length ? <ul>{observation.review_reasons.map((entry) => <li key={entry}>{entry}</li>)}</ul> : 'Aucun motif disponible : créez ou rejetez après revue.'}</dd></div>
                  </dl>

                  <div className="admin-spatial-review__decision">
                    <label className="admin-field" htmlFor={`spatial-target-${observation.observation_id}`}>
                      <span><code>fire_id</code> cible pour le rattachement</span>
                      <input id={`spatial-target-${observation.observation_id}`} value={target} onChange={(event) => {
                        const value = event.currentTarget.value;
                        setTargets((current) => ({ ...current, [observation.observation_id]: value }));
                      }} placeholder="FR-83-00042" autoCapitalize="characters" />
                    </label>
                    <label className="admin-field" htmlFor={`spatial-reason-${observation.observation_id}`}>
                      <span>Motif de décision audité</span>
                      <textarea id={`spatial-reason-${observation.observation_id}`} rows={3} maxLength={500} value={reason} onChange={(event) => {
                        const value = event.currentTarget.value;
                        setReasons((current) => ({ ...current, [observation.observation_id]: value }));
                      }} placeholder="Expliquez les éléments qui justifient la décision (10 caractères minimum)." />
                    </label>
                    <div className="admin-form-actions">
                      <button className="button button--primary" type="button" disabled={mutation.state.pending || !canAttach} onClick={() => void resolve(observation, 'attach')}>Rattacher au feu</button>
                      <button className="button button--small" type="button" disabled={mutation.state.pending || !canResolveWithoutTarget} onClick={() => void resolve(observation, 'create')}>Créer un incident</button>
                      <button className="button button--small" type="button" disabled={mutation.state.pending || !canResolveWithoutTarget} onClick={() => void resolve(observation, 'reject')}>Rejeter l’observation</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <AdminMutationFeedback
        error={mutation.state.error}
        succeeded={mutation.state.succeeded}
        success={resolved ? `Décision enregistrée pour ${resolved.observationId}${resolved.fireId ? ` · ${resolved.fireId}${resolved.episodeId ? ` / ${resolved.episodeId}` : ''}` : ''}.` : 'Décision enregistrée.'}
      />
    </section>
  );
}
