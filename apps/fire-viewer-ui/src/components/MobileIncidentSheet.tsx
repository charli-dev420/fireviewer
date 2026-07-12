import { useState } from 'react';
import type { IncidentData, LayerVisibility, ViewId } from '../types';
import { formatCompactTime } from '../lib/format';
import { Icon } from './Icons';
import { Switch } from './Switch';

interface MobileIncidentSheetProps {
  incident: IncidentData;
  activeVersion: number;
  layers: LayerVisibility;
  offline: boolean;
  onLayerChange: (key: keyof LayerVisibility, value: boolean) => void;
  onNavigate: (view: ViewId) => void;
  onOpenTextView: () => void;
}

export function MobileIncidentSheet({
  incident,
  activeVersion,
  layers,
  offline,
  onLayerChange,
  onNavigate,
  onOpenTextView,
}: MobileIncidentSheetProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className={`mobile-sheet ${expanded ? 'is-expanded' : ''}`} aria-label="Résumé mobile de l’incident">
      <button
        type="button"
        className="mobile-sheet__handle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span />
        <span className="sr-only">{expanded ? 'Réduire' : 'Développer'} le panneau de situation</span>
      </button>

      <div className="mobile-sheet__heading">
        <div>
          <strong>Situation</strong>
          <span>Modèle v{activeVersion}</span>
        </div>
        <button type="button" className="text-link" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Réduire' : 'Détails'}
          <Icon name="chevron-down" size={17} />
        </button>
      </div>

      <div className="mobile-data-grid">
        <div>
          <span className="mobile-data-grid__dot mobile-data-grid__dot--success" />
          <strong>Position</strong>
          <small>vérifiée · {formatCompactTime(incident.freshness.positionAt)}</small>
        </div>
        <div>
          <span className="mobile-data-grid__dot mobile-data-grid__dot--info" />
          <strong>Terrain</strong>
          <small>IGN · {incident.freshness.terrainSourceYear}</small>
        </div>
        <div>
          <span className="mobile-data-grid__dot mobile-data-grid__dot--warning" />
          <strong>Périmètre</strong>
          <small>estimé · {formatCompactTime(incident.freshness.perimeterAt)}</small>
        </div>
      </div>

      <div className={`mobile-emergency ${offline ? 'mobile-emergency--offline' : ''}`}>
        <Icon name={offline ? 'offline' : 'alert'} size={18} />
        <div>
          <strong>{offline ? 'Hors ligne' : 'Urgence : 18 ou 112'}</strong>
          <span>
            {offline
              ? 'Le statut peut être obsolète jusqu’à la prochaine synchronisation.'
              : 'Cette page ne remplace pas les consignes des secours.'}
          </span>
        </div>
      </div>

      <div className="mobile-view-actions">
        <button type="button" onClick={() => onNavigate('sources')}>
          <Icon name="table" size={18} />
          Sources
        </button>
        <button type="button" onClick={() => onNavigate('history')}>
          <Icon name="history" size={18} />
          Historique
        </button>
        <button type="button" onClick={onOpenTextView}>
          <Icon name="text" size={18} />
          Vue texte
        </button>
      </div>

      {expanded ? (
        <div className="mobile-sheet__expanded">
          <div className="section-kicker">Couches visibles</div>
          <ul className="mobile-layer-list">
            <li>
              <span>Courbes de niveau</span>
              <Switch checked={layers.contourLines} onChange={(value) => onLayerChange('contourLines', value)} label="Courbes de niveau" />
            </li>
            <li>
              <span>Observations</span>
              <Switch checked={layers.observations} onChange={(value) => onLayerChange('observations', value)} label="Observations" />
            </li>
            <li>
              <span>Zone d’incertitude</span>
              <Switch checked={layers.uncertainty} onChange={(value) => onLayerChange('uncertainty', value)} label="Zone d’incertitude" />
            </li>
          </ul>
          <div className="mobile-latest-event">
            <span>Dernier événement</span>
            <strong>{incident.alerts[0]?.at} · {incident.alerts[0]?.title}</strong>
          </div>
          <p className="mobile-sheet__safety">Les fonctions critiques restent lisibles sans interaction 3D.</p>
        </div>
      ) : null}
    </aside>
  );
}
