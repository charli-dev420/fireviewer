import { useMemo, useState } from 'react';
import type { AuditEvent, IncidentData } from '../types';
import { formatDateTime } from '../lib/format';
import { Icon, type IconName } from './Icons';

interface JournalViewProps {
  incident: IncidentData;
  operatorMode: boolean;
  onNotify: (message: string, tone?: 'success' | 'info' | 'warning') => void;
}

type CategoryFilter = 'all' | AuditEvent['category'];

const categoryLabels: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'Tout le journal' },
  { id: 'observation', label: 'Observations' },
  { id: 'status', label: 'Statuts' },
  { id: 'asset', label: 'Assets' },
  { id: 'security', label: 'Sécurité' },
  { id: 'system', label: 'Système' },
];

const categoryIcons: Record<AuditEvent['category'], IconName> = {
  observation: 'location',
  status: 'check',
  asset: 'layers',
  security: 'shield',
  system: 'refresh',
};

export function JournalView({ incident, operatorMode, onNotify }: JournalViewProps) {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr-FR');
    return incident.audit.filter((event) => {
      const categoryMatches = category === 'all' || event.category === category;
      const textMatches =
        normalized.length === 0 ||
        `${event.title} ${event.description} ${event.actor} ${event.traceId}`.toLocaleLowerCase('fr-FR').includes(normalized);
      return categoryMatches && textMatches;
    });
  }, [category, incident.audit, query]);

  const copyTrace = async (traceId: string) => {
    try {
      await navigator.clipboard.writeText(traceId);
      onNotify('Trace ID copié.', 'success');
    } catch {
      onNotify('Copie impossible dans ce navigateur.', 'warning');
    }
  };

  const exportJournal = () => {
    const events = operatorMode
      ? incident.audit
      : incident.audit.map(({ actor: _actor, traceId: _traceId, ...event }) => event);
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              fire_id: incident.fireId,
              episode_id: incident.episodeId,
              exported_at: new Date().toISOString(),
              mode: operatorMode ? 'operator' : 'public',
              events,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${incident.fireId}-journal.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onNotify('Journal exporté.', 'success');
  };

  const successful = incident.audit.filter((event) => event.outcome === 'success').length;
  const blocked = incident.audit.filter((event) => event.outcome === 'blocked').length;
  const warnings = incident.audit.filter((event) => event.outcome === 'warning').length;

  return (
    <section
      id="panel-journal"
      role="tabpanel"
      aria-labelledby="tab-journal"
      className="workspace workspace--journal"
      tabIndex={-1}
    >
      <aside className="journal-filters-card">
        <div className="section-kicker">Journal append-only</div>
        <h2>Filtres</h2>
        <label className="search-field">
          <span className="sr-only">Rechercher dans le journal</span>
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Titre, acteur, trace…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="journal-filter-list" role="radiogroup" aria-label="Catégorie du journal">
          {categoryLabels.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={category === item.id}
              className={category === item.id ? 'is-active' : ''}
              onClick={() => setCategory(item.id)}
            >
              <span>{item.label}</span>
              <b>
                {item.id === 'all'
                  ? incident.audit.length
                  : incident.audit.filter((event) => event.category === item.id).length}
              </b>
            </button>
          ))}
        </div>
        <button type="button" className="button button--secondary" onClick={exportJournal}>
          <Icon name="download" size={18} />
          Exporter le journal
        </button>
        <div className="access-notice">
          <Icon name="shield" size={17} />
          <span>
            {operatorMode
              ? 'Acteurs et trace_id visibles en mode opérateur.'
              : 'Acteurs et identifiants techniques minimisés en vue publique.'}
          </span>
        </div>
      </aside>

      <div className="journal-card">
        <header className="workspace-header">
          <div>
            <div className="eyebrow">Audit traçable</div>
            <h2>Journal de l’incident</h2>
            <p>Les événements conservent l’avant/après, l’auteur technique, la raison et la chaîne de causalité.</p>
          </div>
          <span className={`mode-chip ${operatorMode ? 'mode-chip--operator' : ''}`}>
            <Icon name={operatorMode ? 'user' : 'eye'} size={16} />
            {operatorMode ? 'Vue opérateur' : 'Vue publique'}
          </span>
        </header>

        <div className="journal-metrics" aria-label="Résumé du journal">
          <div><span>Événements</span><strong>{incident.audit.length}</strong></div>
          <div><span>Succès</span><strong>{successful}</strong></div>
          <div><span>À vérifier</span><strong>{warnings}</strong></div>
          <div><span>Bloqués</span><strong>{blocked}</strong></div>
        </div>

        <div className="journal-list" aria-live="polite">
          {filtered.map((event) => (
            <article key={event.id} className={`journal-event journal-event--${event.outcome}`}>
              <span className="journal-event__icon">
                <Icon name={categoryIcons[event.category]} size={20} />
              </span>
              <div className="journal-event__content">
                <div className="journal-event__top">
                  <div>
                    <span className="journal-event__category">{event.category}</span>
                    <h3>{event.title}</h3>
                  </div>
                  <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                </div>
                <p>{event.description}</p>
                <div className="journal-event__meta">
                  <span>
                    <Icon name="user" size={15} />
                    {operatorMode ? event.actor : 'Acteur authentifié'}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyTrace(event.traceId)}
                    disabled={!operatorMode}
                    title={operatorMode ? 'Copier le trace ID' : 'Trace ID masqué en vue publique'}
                  >
                    <Icon name="link" size={15} />
                    {operatorMode ? event.traceId : 'trace masquée'}
                  </button>
                </div>
              </div>
            </article>
          ))}

          {filtered.length === 0 ? (
            <div className="empty-state empty-state--journal">
              <Icon name="search" size={28} />
              <strong>Aucun événement ne correspond.</strong>
              <span>Modifiez le filtre ou la recherche.</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
