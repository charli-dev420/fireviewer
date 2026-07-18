import { useCallback, useState } from 'react';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminMutationFeedback, AdminPageHeader, AdminStateLabel, formatAdminDate } from './AdminPageState';
import { AdminIncidentWorkspaceNav } from './AdminIncidentWorkspaceNav';

const FIRE_ID_PATTERN = /^FR-[0-9A-Z]{2,3}-[0-9]{5}$/;

function coordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/** Résolution d'observations proposée ou déjà rattachée à un fire_id précis. */
export function AdminIncidentObservationsPage({ fireId }: { readonly fireId: string }) {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getIncidentObservations(fireId, options), [api, fireId]);
  const { state, reload } = useAdminQuery(load, [load]);
  const mutation = useAdminMutation();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [publishExactLocations, setPublishExactLocations] = useState<Record<string, boolean>>({});
  const [resolved, setResolved] = useState<string | null>(null);

  const resolve = async (observationId: string, action: 'attach' | 'reject', version: number) => {
    const note = notes[observationId]?.trim() ?? '';
    const reason = action === 'attach'
      ? `Observation rattachée manuellement à ${fireId} depuis sa fiche.${note ? ` Note : ${note}` : ''}`
      : `Observation rejetée manuellement depuis la fiche de ${fireId}.${note ? ` Note : ${note}` : ''}`;
    const publishSpatialEvidence = action === 'attach' && Boolean(publishExactLocations[observationId]);
    const result = await mutation.run(
      `${observationId}:${action}:${version}:${fireId}:${publishSpatialEvidence}:${reason}`,
      (options) => api.resolveObservation(observationId, {
        action,
        expected_version: version,
        reason,
        publish_spatial_evidence: publishSpatialEvidence,
        ...(action === 'attach' ? { target_fire_id: fireId } : {}),
      }, options),
    );
    if (result) {
      setResolved(result.observation_id);
      reload();
    }
  };

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement des observations de l’incident…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;

  return (
    <section aria-labelledby="admin-incident-observations-title">
      <AdminPageHeader title="Observations" actions={<a className="button button--secondary" href="/admin/rapprochement-spatial">Rapprochement spatial global</a>}>
        <p>Revue privée des observations déjà rattachées ou proposées pour <code>{fireId}</code>. Les coordonnées et motifs restent internes ; chaque décision est appliquée et auditée par le serveur.</p>
      </AdminPageHeader>
      <AdminIncidentWorkspaceNav fireId={fireId} active="observations" />

      <section className="admin-section" aria-labelledby="admin-incident-observations-title">
        <div className="admin-section__heading"><div><h3 id="admin-incident-observations-title">Registre de revue</h3><p>Les observations validées sont conservées comme contexte. Seules celles en revue offrent une décision ici.</p></div></div>
        {state.data.observations.length === 0 ? (
          <AdminEmptyState title="Aucune observation liée">Aucune observation n’est rattachée ou proposée pour cet incident.</AdminEmptyState>
        ) : (
          <div className="admin-observation-list">
            {state.data.observations.map((item) => {
              const pending = item.verification_state === 'PENDING_REVIEW';
              const note = notes[item.observation_id] ?? '';
              const canResolve = pending && FIRE_ID_PATTERN.test(fireId);
              return (
                <article className="admin-observation-record" key={item.observation_id}>
                  <header>
                    <div>
                      <p className="eyebrow">{item.source_type} · v{item.version}</p>
                      <h3><code>{item.observation_id}</code></h3>
                      <p>{item.source_key} · observée {formatAdminDate(item.observed_at)} · <AdminStateLabel value={item.verification_state} /></p>
                    </div>
                    <AdminStateLabel value={item.match_decision} />
                  </header>
                  <dl className="admin-observation-record__facts">
                    <div><dt>Position interne</dt><dd><code>{coordinates(item.latitude, item.longitude)}</code> ± {item.horizontal_uncertainty_m.toLocaleString('fr-FR')} m</dd></div>
                    <div><dt>Rattachement</dt><dd>{item.attached_episode_id ? `${fireId} / ${item.attached_episode_id}` : 'Non rattachée'}</dd></div>
                    <div><dt>Candidat</dt><dd>{item.proposed_fire_id ? `${item.proposed_fire_id} / ${item.proposed_episode_id ?? 'non déterminé'}` : 'Aucun'}</dd></div>
                    <div><dt>Score / marge</dt><dd>{item.match_score === null ? 'Non calculé' : item.match_score.toFixed(2)}{item.margin_to_second_candidate === null ? '' : ` / ${item.margin_to_second_candidate.toFixed(2)}`}</dd></div>
                    <div><dt>Reçue</dt><dd>{formatAdminDate(item.received_at)}</dd></div>
                    <div><dt>Licence de preuve</dt><dd>{item.evidence_license}</dd></div>
                    <div className="admin-observation-record__reasons"><dt>Motifs</dt><dd>{item.review_reasons.length ? item.review_reasons.join(' · ') : 'Aucun motif enregistré.'}</dd></div>
                  </dl>
                  {pending ? (
                    <div className="admin-observation-record__decision">
                      <label className="admin-check" htmlFor={`observation-public-position-${item.observation_id}`}>
                        <input
                          id={`observation-public-position-${item.observation_id}`}
                          type="checkbox"
                          checked={Boolean(publishExactLocations[item.observation_id])}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setPublishExactLocations((current) => ({ ...current, [item.observation_id]: checked }));
                          }}
                        />
                        <span>
                          <strong>Autoriser le repère exact sur la fiche publique</strong>
                          <small>Option indépendante de la validation. Sans cette autorisation, aucune position exacte issue de cette preuve n’est publiée.</small>
                        </span>
                      </label>
                      <details className="admin-disclosure">
                        <summary>Ajouter une note (facultatif)</summary>
                        <label className="admin-field" htmlFor={`observation-note-${item.observation_id}`}>
                          <span>Note interne</span>
                          <textarea
                            id={`observation-note-${item.observation_id}`}
                            rows={2}
                            maxLength={380}
                            value={note}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setNotes((current) => ({ ...current, [item.observation_id]: value }));
                            }}
                            placeholder="Précision utile à l’équipe"
                          />
                        </label>
                      </details>
                      <div className="admin-form-actions">
                        <button className="button button--primary" type="button" disabled={mutation.state.pending || !canResolve} onClick={() => void resolve(item.observation_id, 'attach', item.version)}>Rattacher à cet incident</button>
                        <button className="button button--small" type="button" disabled={mutation.state.pending || !canResolve} onClick={() => void resolve(item.observation_id, 'reject', item.version)}>Rejeter</button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
      <AdminMutationFeedback error={mutation.state.error} succeeded={mutation.state.succeeded} success={resolved ? `Décision enregistrée pour ${resolved}.` : 'Décision enregistrée.'} />
    </section>
  );
}
