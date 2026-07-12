import { useMemo, useState } from 'react';
import type { Episode, IncidentData, ModelVersion } from '../types';
import { formatDate, formatDateTime } from '../lib/format';
import { Icon } from './Icons';

interface HistoryViewProps {
  incident: IncidentData;
  operatorMode: boolean;
  onNotify: (message: string, tone?: 'success' | 'info' | 'warning') => void;
}

function episodeTone(episode: Episode): string {
  if (episode.status === 'active') return 'critical';
  if (episode.status === 'monitoring') return 'warning';
  return 'neutral';
}

export function HistoryView({ incident, operatorMode, onNotify }: HistoryViewProps) {
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(incident.episodeId);
  const [selectedVersion, setSelectedVersion] = useState(incident.asset.version);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);

  const selectedEpisode = incident.episodes.find((episode) => episode.id === selectedEpisodeId) ?? incident.episodes[0];
  const version = incident.versions.find((item) => item.version === selectedVersion) ?? incident.versions[0];

  const episodeEvents = useMemo(() => {
    if (selectedEpisodeId === incident.episodeId) return incident.audit;
    return incident.audit.filter((event) => event.title.toLowerCase().includes(selectedEpisodeId.toLowerCase()));
  }, [incident.audit, incident.episodeId, selectedEpisodeId]);

  const exportHistory = () => {
    const payload = {
      fire_id: incident.fireId,
      exported_at: new Date().toISOString(),
      episodes: incident.episodes,
      versions: incident.versions,
      events: incident.audit,
      notice: incident.publicNotice,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${incident.fireId}-historique.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onNotify('Historique exporté sans modifier la version publique.', 'success');
  };

  const preview = (model: ModelVersion) => {
    setSelectedVersion(model.version);
    setPreviewVersion(model.version === incident.asset.version ? null : model.version);
    onNotify(
      model.version === incident.asset.version
        ? 'Retour à la version courante.'
        : `Prévisualisation locale de la version v${model.version}.`,
      'info',
    );
  };

  return (
    <section
      id="panel-history"
      role="tabpanel"
      aria-labelledby="tab-history"
      className="workspace workspace--history"
      tabIndex={-1}
    >
      <aside className="episodes-card" aria-label="Épisodes de la série">
        <div className="section-kicker">Épisodes</div>
        <div className="episode-list">
          {incident.episodes.map((episode) => (
            <button
              key={episode.id}
              type="button"
              className={`episode-card ${selectedEpisodeId === episode.id ? 'is-selected' : ''}`}
              onClick={() => {
                setSelectedEpisodeId(episode.id);
                if (episode.id !== incident.episodeId) {
                  setPreviewVersion(null);
                }
              }}
            >
              <div className="episode-card__top">
                <strong>{episode.id}</strong>
                <time>{formatDate(episode.startedAt)}</time>
              </div>
              <span>{episode.title}</span>
              <small className={`episode-status episode-status--${episodeTone(episode)}`}>{episode.statusLabel}</small>
            </button>
          ))}
        </div>

        <div className="continuity-card">
          <div className="continuity-card__title">
            <Icon name="link" size={18} />
            Continuité du fire_id
          </div>
          <p>La page reste identique; chaque réactivation ajoute un épisode immuable et traçable.</p>
        </div>

        <button type="button" className="button button--secondary" onClick={exportHistory}>
          <Icon name="download" size={18} />
          Exporter l’historique
        </button>
      </aside>

      <div className="history-card">
        <header className="workspace-header workspace-header--history">
          <div>
            <div className="eyebrow">Série stable · épisodes immuables</div>
            <h2>Épisode {selectedEpisode.id} — chronologie et modèles</h2>
            <p>{selectedEpisode.note}</p>
          </div>
          <span className={`mode-chip ${operatorMode ? 'mode-chip--operator' : ''}`}>
            <Icon name={operatorMode ? 'user' : 'eye'} size={16} />
            {operatorMode ? 'Actions opérateur disponibles' : 'Consultation publique'}
          </span>
        </header>

        {previewVersion !== null ? (
          <div className="preview-banner" role="status">
            <Icon name="eye" size={19} />
            <div>
              <strong>Prévisualisation locale de v{previewVersion}</strong>
              <span>Le manifeste public reste sur v{incident.asset.version}. Aucun état n’est modifié.</span>
            </div>
            <button type="button" className="button button--small" onClick={() => preview(incident.versions[0])}>
              Revenir à v{incident.asset.version}
            </button>
          </div>
        ) : null}

        {selectedEpisodeId === incident.episodeId ? (
          <>
            <div className="version-grid" aria-label="Versions du modèle">
              {incident.versions.map((model) => (
                <article
                  key={model.version}
                  className={`version-card ${selectedVersion === model.version ? 'is-selected' : ''} ${model.status === 'current' ? 'is-current' : ''}`}
                >
                  <div className="version-card__top">
                    <strong>v{model.version}</strong>
                    <span className={`version-state version-state--${model.status}`}>{model.label}</span>
                  </div>
                  <time>{formatDateTime(model.publishedAt)}</time>
                  <span>sha256 {model.hash.slice(0, 8)}…</span>
                  <button type="button" className="button button--table" onClick={() => preview(model)}>
                    Voir
                  </button>
                </article>
              ))}
            </div>

            <div className="history-layout">
              <div className="timeline-card">
                <div className="section-kicker">Événements clés</div>
                <ol className="timeline">
                  {incident.audit.slice(0, 6).map((event) => (
                    <li key={event.id} className={`timeline__item timeline__item--${event.outcome}`}>
                      <time>{new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(event.at))}</time>
                      <div>
                        <strong>{event.title}</strong>
                        <span>{event.description}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <aside className="version-detail" aria-label={`Détail de la version v${version.version}`}>
                <div className="section-kicker">Détail version v{version.version}</div>
                <dl>
                  <div><dt>Emprise</dt><dd>{version.footprint}</dd></div>
                  <div><dt>Triangles</dt><dd>{version.triangles.toLocaleString('fr-FR')}</dd></div>
                  <div><dt>GLB</dt><dd>{version.sizeMb.toLocaleString('fr-FR')} Mo</dd></div>
                  <div><dt>Origine</dt><dd>{version.origin}</dd></div>
                  <div><dt>Altitude</dt><dd>{version.altitude}</dd></div>
                  <div><dt>Source relief</dt><dd>{version.source}</dd></div>
                  <div><dt>Contrôle</dt><dd>échelle 1 m = 1 unité</dd></div>
                  <div><dt>Publication</dt><dd>{version.validation}</dd></div>
                </dl>
                <p className="version-detail__note">{version.changeNote}</p>
                <button type="button" className="button button--primary" onClick={() => preview(version)}>
                  <Icon name="eye" size={18} />
                  {version.version === incident.asset.version ? 'Afficher la version courante' : 'Prévisualiser cette version'}
                </button>
                {operatorMode && version.version !== incident.asset.version ? (
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    onClick={() => onNotify('Workflow de rollback préparé; confirmation et motif requis.', 'warning')}
                  >
                    <Icon name="history" size={18} />
                    Préparer un rollback
                  </button>
                ) : null}
              </aside>
            </div>
          </>
        ) : (
          <div className="archived-episode-state">
            <span className="archived-episode-state__icon">
              <Icon name="history" size={34} />
            </span>
            <div>
              <div className="eyebrow">Épisode clôturé</div>
              <h3>{selectedEpisode.title}</h3>
              <p>
                Cet épisode est immuable. Sa chronologie reste consultable et une reprise crée un nouvel episode_id au lieu d’écraser le passé.
              </p>
            </div>
            <dl className="detail-grid detail-grid--compact">
              <div><dt>Début</dt><dd>{formatDateTime(selectedEpisode.startedAt)}</dd></div>
              <div><dt>Fin</dt><dd>{selectedEpisode.endedAt ? formatDateTime(selectedEpisode.endedAt) : 'Non renseignée'}</dd></div>
              <div><dt>État</dt><dd>{selectedEpisode.statusLabel}</dd></div>
              <div><dt>URL stable</dt><dd>/incident/{incident.fireId}</dd></div>
            </dl>
          </div>
        )}

        {selectedEpisodeId !== incident.episodeId && episodeEvents.length === 0 ? (
          <div className="history-note">
            <Icon name="info" size={18} />
            Les événements détaillés de cet épisode ne sont pas inclus dans le jeu de démonstration, mais le contrat UI est prêt à les afficher.
          </div>
        ) : null}
      </div>
    </section>
  );
}
