import type { IncidentData, ViewerState } from '../types';
import { formatCompactTime, formatDateTime } from '../lib/format';
import { Icon } from './Icons';
import { StatusPill } from './StatusPill';

interface SituationPanelProps {
  incident: IncidentData;
  viewerState: ViewerState;
  offline: boolean;
  onCopyLink: () => void;
  onOpenTextView: () => void;
}

export function SituationPanel({
  incident,
  viewerState,
  offline,
  onCopyLink,
  onOpenTextView,
}: SituationPanelProps) {
  return (
    <aside className="side-panel situation-panel" aria-label="Résumé de la situation">
      <div className="side-panel__section">
        <div className="section-kicker">Situation</div>
        <StatusPill code={incident.status.code} label={incident.status.label} />

        <dl className="summary-list summary-list--stacked">
          <div>
            <dt>Dernière mise à jour</dt>
            <dd>{formatDateTime(incident.freshness.incidentAt)}</dd>
          </div>
          <div>
            <dt>Localisation de référence</dt>
            <dd className="location-line">
              <Icon name="location" size={20} />
              <span>{incident.locationLabel}</span>
            </dd>
            <span className="summary-list__hint">
              Incertitude spatiale : ± {incident.frame.horizontalUncertaintyM} m
            </span>
          </div>
        </dl>
      </div>

      <div className="side-panel__divider" />

      <div className="side-panel__section">
        <div className="section-kicker">État des données</div>
        <ul className="data-status-list">
          <li>
            <span className="data-status-list__dot data-status-list__dot--success" />
            <div>
              <strong>Position</strong>
              <span>vérifiée</span>
            </div>
            <time dateTime={incident.freshness.positionAt}>
              {formatCompactTime(incident.freshness.positionAt)}
            </time>
          </li>
          <li>
            <span className="data-status-list__dot data-status-list__dot--info" />
            <div>
              <strong>Terrain 3D</strong>
              <span>{viewerState === 'DEGRADED' ? 'indisponible · vue texte active' : 'daté IGN'}</span>
            </div>
            <span>{incident.freshness.terrainSourceYear}</span>
          </li>
          <li>
            <span className="data-status-list__dot data-status-list__dot--warning" />
            <div>
              <strong>Périmètre feu</strong>
              <span>estimé</span>
            </div>
            <time dateTime={incident.freshness.perimeterAt}>
              {formatCompactTime(incident.freshness.perimeterAt)}
            </time>
          </li>
          <li>
            <span className="data-status-list__dot data-status-list__dot--neutral" />
            <div>
              <strong>Vent</strong>
              <span>non intégré</span>
            </div>
            <span>—</span>
          </li>
        </ul>
      </div>

      <div className={`emergency-card ${offline ? 'emergency-card--offline' : ''}`}>
        <div className="emergency-card__title">
          <Icon name={offline ? 'offline' : 'alert'} size={18} />
          <strong>{offline ? 'Hors ligne' : 'Urgence'}</strong>
        </div>
        <p>
          {offline
            ? `Dernière synchronisation : ${formatDateTime(incident.freshness.lastSyncAt)}. Le statut peut être obsolète.`
            : 'Ne pas utiliser cette page pour retarder un appel aux secours : 18 ou 112.'}
        </p>
      </div>

      <div className="side-panel__actions">
        <button type="button" className="button button--secondary" onClick={onCopyLink}>
          <Icon name="copy" size={18} />
          Copier le lien
        </button>
        <button type="button" className="button button--secondary" onClick={onOpenTextView}>
          <Icon name="text" size={18} />
          Vue texte
        </button>
      </div>
    </aside>
  );
}
