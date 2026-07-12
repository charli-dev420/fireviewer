import { useEffect, useRef, useState } from 'react';
import type { IncidentData, ViewerState } from '../types';
import { formatCompactTime } from '../lib/format';
import { Icon } from './Icons';
import { StatusPill } from './StatusPill';

interface AppHeaderProps {
  incident: IncidentData;
  viewerState: ViewerState;
  offline: boolean;
  operatorMode: boolean;
  onToggleOffline: () => void;
  onToggleOperatorMode: () => void;
  onToggleDegraded: () => void;
  onSimulateUpdate: () => void;
  onReset: () => void;
}

const viewerLabels: Record<ViewerState, string> = {
  INITIALIZING: 'Initialisation',
  METADATA_READY: 'Métadonnées prêtes',
  MODEL_LOADING: 'Terrain en chargement',
  READY: '3D prête',
  DEGRADED: 'Mode dégradé',
  ERROR: 'Erreur de rendu',
};

export function AppHeader({
  incident,
  viewerState,
  offline,
  operatorMode,
  onToggleOffline,
  onToggleOperatorMode,
  onToggleDegraded,
  onSimulateUpdate,
  onReset,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="brand-lockup" aria-label="Fire-Viewer">
          <span className="brand-lockup__mark">
            <Icon name="flame" size={28} />
          </span>
          <span className="brand-lockup__copy">
            <strong>FIRE-VIEWER</strong>
            <small>outil incident-centrique</small>
          </span>
        </div>

        <div className="incident-heading">
          <div className="incident-heading__topline">
            <h1>
              {incident.canonicalName} <span aria-hidden="true">—</span> {incident.sector}
            </h1>
            <span className="demo-badge">Démonstration fictive</span>
          </div>
          <div className="incident-heading__meta">
            <span>Incident {incident.fireId}</span>
            <span aria-hidden="true">·</span>
            <span>Épisode {incident.episodeId}</span>
            <span aria-hidden="true">·</span>
            <span>mis à jour {formatCompactTime(incident.freshness.incidentAt)}</span>
          </div>
        </div>

        <div className="app-header__actions">
          <div className={`viewer-health viewer-health--${viewerState.toLowerCase()}`}>
            <span className="viewer-health__dot" />
            <span>{offline ? 'Hors ligne' : viewerLabels[viewerState]}</span>
          </div>
          <StatusPill code={incident.status.code} label={incident.status.label} compact />
          <div className="menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="icon-button icon-button--header"
              aria-label="Ouvrir le menu"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((current) => !current)}
            >
              <Icon name="menu" />
            </button>
            {menuOpen ? (
              <div className="app-menu" role="menu">
                <div className="app-menu__header">
                  <strong>Mode de démonstration</strong>
                  <span>{operatorMode ? 'Vue opérateur' : 'Vue publique'}</span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onToggleOperatorMode();
                    setMenuOpen(false);
                  }}
                >
                  <Icon name="user" size={18} />
                  <span>{operatorMode ? 'Passer en vue publique' : 'Passer en vue opérateur'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onToggleOffline();
                    setMenuOpen(false);
                  }}
                >
                  <Icon name={offline ? 'refresh' : 'offline'} size={18} />
                  <span>{offline ? 'Rétablir le réseau' : 'Simuler le hors ligne'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onToggleDegraded();
                    setMenuOpen(false);
                  }}
                >
                  <Icon name="text" size={18} />
                  <span>{viewerState === 'DEGRADED' ? 'Réactiver la 3D' : 'Simuler une panne 3D'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSimulateUpdate();
                    setMenuOpen(false);
                  }}
                  disabled={offline || viewerState === 'MODEL_LOADING'}
                >
                  <Icon name="sparkles" size={18} />
                  <span>Simuler la version v5</span>
                </button>
                <div className="app-menu__separator" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onReset();
                    setMenuOpen(false);
                  }}
                >
                  <Icon name="refresh" size={18} />
                  <span>Réinitialiser l’interface</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
