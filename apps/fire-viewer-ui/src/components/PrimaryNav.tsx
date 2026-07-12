import type { ViewId, ViewerState } from '../types';
import { Icon, type IconName } from './Icons';

interface PrimaryNavProps {
  activeView: ViewId;
  onChange: (view: ViewId) => void;
  viewerState: ViewerState;
  offline: boolean;
  observationCount: number;
}

const tabs: Array<{ id: ViewId; label: string; icon: IconName }> = [
  { id: 'viewer', label: 'Vue 3D', icon: 'layers' },
  { id: 'sources', label: 'Sources & confiance', icon: 'table' },
  { id: 'history', label: 'Historique', icon: 'history' },
  { id: 'journal', label: 'Journal', icon: 'file-text' },
];

export function PrimaryNav({
  activeView,
  onChange,
  viewerState,
  offline,
  observationCount,
}: PrimaryNavProps) {
  return (
    <nav className="primary-nav" aria-label="Vues de l’incident">
      <div className="primary-nav__inner" role="tablist" aria-label="Contenu de l’incident">
        <div className="primary-nav__tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeView === tab.id}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              tabIndex={activeView === tab.id ? 0 : -1}
              className={`primary-nav__tab ${activeView === tab.id ? 'is-active' : ''}`}
              onClick={() => onChange(tab.id)}
            >
              <Icon name={tab.icon} size={18} />
              <span>{tab.label}</span>
              {tab.id === 'sources' ? <span className="tab-count">{observationCount}</span> : null}
            </button>
          ))}
        </div>
        <div className="primary-nav__state" aria-live="polite">
          <span
            className={`primary-nav__state-dot ${offline ? 'is-offline' : viewerState === 'READY' ? 'is-ready' : ''}`}
          />
          <span>
            {offline
              ? 'Dernières données synchronisées'
              : viewerState === 'READY'
                ? 'Manifeste vérifié · modèle courant'
                : viewerState === 'DEGRADED'
                  ? 'Informations textuelles disponibles'
                  : 'Chargement sécurisé'}
          </span>
        </div>
      </div>
    </nav>
  );
}
