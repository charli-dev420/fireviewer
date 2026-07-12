import { useMemo, useState } from 'react';
import type { EvidenceState, IncidentData, Observation } from '../types';
import { formatDateTime, formatScore } from '../lib/format';
import { AccessibleDialog } from './AccessibleDialog';
import { Icon } from './Icons';

interface SourcesViewProps {
  incident: IncidentData;
  operatorMode: boolean;
  onNotify: (message: string, tone?: 'success' | 'info' | 'warning') => void;
}

type FilterId = 'all' | EvidenceState;

const filterLabels: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'Toutes' },
  { id: 'verified', label: 'Vérifiées' },
  { id: 'review', label: 'À examiner' },
  { id: 'rejected', label: 'Rejetées' },
  { id: 'reference', label: 'Références' },
];

function EvidenceBadge({ state, label }: { state: EvidenceState; label: string }) {
  return <span className={`evidence-badge evidence-badge--${state}`}>{label}</span>;
}

export function SourcesView({ incident, operatorMode, onNotify }: SourcesViewProps) {
  const [filter, setFilter] = useState<FilterId>('all');
  const [selected, setSelected] = useState<Observation | null>(null);

  const publiclyVisible = useMemo(
    () => incident.observations.filter((observation) => observation.state === 'verified' || observation.state === 'reference'),
    [incident.observations],
  );

  const sourcePool = operatorMode ? incident.observations : publiclyVisible;
  const filtered = sourcePool.filter((observation) => filter === 'all' || observation.state === filter);

  const countFor = (id: FilterId) => {
    const pool = operatorMode ? incident.observations : publiclyVisible;
    if (id === 'all') return pool.length;
    return pool.filter((observation) => observation.state === id).length;
  };

  const exportEvidence = () => {
    const payload = {
      fire_id: incident.fireId,
      episode_id: incident.episodeId,
      exported_at: new Date().toISOString(),
      decision_score: incident.confidence,
      factors: incident.factors,
      observations: (operatorMode ? incident.observations : publiclyVisible).map((observation) => ({
        id: operatorMode ? observation.id : undefined,
        type: observation.type,
        observed_at: observation.observedAt,
        uncertainty: observation.uncertainty,
        verification_state: observation.state,
        provenance: operatorMode ? observation.provenance : 'Provenance agrégée dans la vue publique.',
      })),
      notice: incident.publicNotice,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${incident.fireId}-sources.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onNotify('Export JSON généré avec provenance et avertissement.', 'success');
  };

  return (
    <section
      id="panel-sources"
      role="tabpanel"
      aria-labelledby="tab-sources"
      className="workspace workspace--sources"
      tabIndex={-1}
    >
      <aside className="decision-card" aria-label="Qualité de la décision">
        <div className="section-kicker">Qualité de la décision</div>
        <div className="decision-score">
          <span>Rattachement au fire_id</span>
          <div>
            <strong>{formatScore(incident.confidence)}</strong>
            <span>Fort</span>
          </div>
        </div>

        <div className="factor-list">
          {incident.factors.map((factor) => (
            <div className="factor-item" key={factor.id}>
              <div className="factor-item__label">
                <span>{factor.label}</span>
                <b>{formatScore(factor.value)}</b>
              </div>
              <div className="factor-bar" aria-label={`${factor.label} ${Math.round(factor.value * 100)} pour cent`}>
                <i style={{ width: `${factor.value * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="rule-card">
          <div className="rule-card__title">
            <Icon name="shield" size={18} />
            Règle appliquée
          </div>
          <p>
            Auto-rattachement autorisé car score ≥ 0,90 et marge suffisante. La confirmation publique reste humaine.
          </p>
        </div>

        <div className="decision-card__actions">
          <button type="button" className="button button--secondary" onClick={exportEvidence}>
            <Icon name="download" size={18} />
            Exporter la preuve
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={!operatorMode}
            onClick={() => onNotify('Demande de revue enregistrée dans la démonstration.', 'success')}
          >
            <Icon name="shield" size={18} />
            Demander une revue
          </button>
        </div>

        <div className={`access-notice ${operatorMode ? 'access-notice--operator' : ''}`}>
          <Icon name={operatorMode ? 'user' : 'shield'} size={17} />
          <span>{operatorMode ? 'Données sensibles — accès opérateur' : 'Vue publique — données minimisées'}</span>
        </div>
      </aside>

      <div className="sources-card">
        <header className="workspace-header">
          <div>
            <div className="eyebrow">Décision explicable</div>
            <h2>Sources et observations</h2>
            <p>Chaque ligne conserve provenance, fraîcheur, incertitude et état de vérification.</p>
          </div>
          <span className={`mode-chip ${operatorMode ? 'mode-chip--operator' : ''}`}>
            <Icon name={operatorMode ? 'user' : 'eye'} size={16} />
            {operatorMode ? 'Vue opérateur' : 'Vue publique'}
          </span>
        </header>

        {!operatorMode ? (
          <div className="public-view-notice">
            <Icon name="shield" size={19} />
            <div>
              <strong>Les pièces non vérifiées sont masquées.</strong>
              <span>La vue publique ne montre ni identité de témoin, ni preuve brute, ni position sensible.</span>
            </div>
          </div>
        ) : null}

        <div className="filter-row" role="toolbar" aria-label="Filtrer les observations">
          {filterLabels.map((item) => {
            const count = countFor(item.id);
            const disabled = !operatorMode && (item.id === 'review' || item.id === 'rejected');
            return (
              <button
                key={item.id}
                type="button"
                className={`filter-chip ${filter === item.id ? 'is-active' : ''}`}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
                disabled={disabled}
              >
                {item.label} <span>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="evidence-table-wrap">
          <table className="evidence-table">
            <caption className="sr-only">Sources et observations de l’incident</caption>
            <thead>
              <tr>
                <th scope="col">Heure</th>
                <th scope="col">Type / source</th>
                <th scope="col">Localisation</th>
                <th scope="col">Incertitude</th>
                <th scope="col">État</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((observation) => (
                <tr key={observation.id}>
                  <td data-label="Heure"><strong>{observation.time}</strong></td>
                  <td data-label="Type / source">
                    <strong>
                      {observation.type}
                      {operatorMode ? ` · ${observation.source}` : ''}
                    </strong>
                    <span>{operatorMode ? observation.sourceDetail : 'source agrégée · provenance conservée'}</span>
                  </td>
                  <td data-label="Localisation">
                    <strong>
                      {!operatorMode && observation.state === 'reference'
                        ? 'zone vérifiée'
                        : observation.location}
                    </strong>
                  </td>
                  <td data-label="Incertitude"><strong>{observation.uncertainty}</strong></td>
                  <td data-label="État"><EvidenceBadge state={observation.state} label={observation.stateLabel} /></td>
                  <td data-label="Action">
                    <button type="button" className="button button--table" onClick={() => setSelected(observation)}>
                      Ouvrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <div className="empty-state">
              <Icon name="filter" size={26} />
              <strong>Aucune observation dans ce filtre.</strong>
              <span>La vue publique masque volontairement les données non vérifiées.</span>
            </div>
          ) : null}
        </div>

        <footer className="sources-footer">
          <Icon name="shield" size={17} />
          {operatorMode
            ? 'Toute action opérateur est authentifiée, motivée et inscrite au journal.'
            : 'Aucune pièce non vérifiée n’est affichée dans la vue publique.'}
        </footer>
      </div>

      <AccessibleDialog
        open={selected !== null}
        title={selected ? `${selected.type} ${operatorMode ? `· ${selected.id}` : ''}` : 'Observation'}
        eyebrow="Détail de la source"
        onClose={() => setSelected(null)}
        size="large"
      >
        {selected ? (
          <div className="observation-detail">
            <div className="observation-detail__summary">
              <EvidenceBadge state={selected.state} label={selected.stateLabel} />
              <p>{selected.summary}</p>
            </div>
            <dl className="detail-grid">
              <div><dt>Observée</dt><dd>{formatDateTime(selected.observedAt)}</dd></div>
              <div><dt>Reçue</dt><dd>{formatDateTime(selected.receivedAt)}</dd></div>
              <div><dt>Localisation</dt><dd>{operatorMode ? selected.location : 'Localisation minimisée'}</dd></div>
              <div><dt>Incertitude</dt><dd>{selected.uncertainty}</dd></div>
              <div><dt>Confiance source</dt><dd>{selected.confidence === null ? 'Non calculée' : formatScore(selected.confidence)}</dd></div>
              <div><dt>Provenance</dt><dd>{operatorMode ? selected.provenance : 'Provenance conservée côté serveur; détails masqués.'}</dd></div>
            </dl>
            <div className="dialog-notice">
              <Icon name="info" size={18} />
              <p>Cette observation est une pièce de mesure et non un ordre. Son statut public dépend d’une règle validée ou d’une décision humaine autorisée.</p>
            </div>
          </div>
        ) : null}
      </AccessibleDialog>
    </section>
  );
}
