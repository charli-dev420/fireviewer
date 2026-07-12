import type { IncidentData, LayerVisibility, ViewerState } from '../types';
import { formatBytes, formatScore } from '../lib/format';
import { Icon } from './Icons';
import { Switch } from './Switch';

interface SynthesisPanelProps {
  incident: IncidentData;
  layers: LayerVisibility;
  viewerState: ViewerState;
  activeVersion: number;
  activeHash: string;
  onLayerChange: (key: keyof LayerVisibility, value: boolean) => void;
  onOpenSources: () => void;
}

const layerLabels: Array<{ key: keyof LayerVisibility; label: string; description: string }> = [
  { key: 'shadedTerrain', label: 'Terrain ombré', description: 'Relief de contexte' },
  { key: 'contourLines', label: 'Courbes de niveau', description: 'Lecture altimétrique' },
  { key: 'observations', label: 'Observations', description: 'Sources géolocalisées' },
  { key: 'uncertainty', label: 'Zone d’incertitude', description: 'Précision estimée' },
  {
    key: 'symbolicParticles',
    label: 'Particules symboliques',
    description: 'Aucune simulation physique',
  },
];

export function SynthesisPanel({
  incident,
  layers,
  viewerState,
  activeVersion,
  activeHash,
  onLayerChange,
  onOpenSources,
}: SynthesisPanelProps) {
  const filledSegments = Math.round(incident.confidence * 10);

  return (
    <aside className="side-panel synthesis-panel" aria-label="Synthèse et couches">
      <div className="side-panel__section">
        <div className="section-kicker">Synthèse</div>
        <button type="button" className="confidence-card" onClick={onOpenSources}>
          <span>Confiance de localisation</span>
          <div className="confidence-card__value-row">
            <strong>{incident.confidenceLabel}</strong>
            <b>{formatScore(incident.confidence)}</b>
          </div>
          <span className="confidence-segments" aria-label={`${Math.round(incident.confidence * 100)} pour cent`}>
            {Array.from({ length: 10 }, (_, index) => (
              <i key={index} className={index < filledSegments ? 'is-filled' : ''} />
            ))}
          </span>
          <small>Voir les facteurs et la provenance</small>
        </button>
      </div>

      <div className="side-panel__section">
        <div className="section-kicker">Alertes contextuelles</div>
        <ul className="alert-list">
          {incident.alerts.map((alert) => (
            <li key={alert.id}>
              <span className={`alert-list__dot alert-list__dot--${alert.tone}`} />
              <div>
                <strong>{alert.title}</strong>
                <span>{alert.detail}</span>
              </div>
              <time>{alert.at}</time>
            </li>
          ))}
        </ul>
      </div>

      <div className="side-panel__divider" />

      <div className="side-panel__section">
        <div className="section-kicker section-kicker--with-icon">
          <Icon name="layers" size={16} />
          Couches
        </div>
        <ul className="layer-list">
          {layerLabels.map((layer) => (
            <li key={layer.key}>
              <div>
                <strong>{layer.label}</strong>
                <span>{layer.description}</span>
              </div>
              <Switch
                checked={layers[layer.key]}
                onChange={(value) => onLayerChange(layer.key, value)}
                label={`${layers[layer.key] ? 'Masquer' : 'Afficher'} ${layer.label}`}
                disabled={viewerState === 'DEGRADED' && layer.key === 'symbolicParticles'}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="model-meta">
        <span>Modèle v{activeVersion}</span>
        <span>sha256 {activeHash.slice(0, 6)}…</span>
        <span>{formatBytes(incident.asset.sizeBytes)}</span>
      </div>
    </aside>
  );
}
