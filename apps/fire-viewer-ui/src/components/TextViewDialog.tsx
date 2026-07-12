import type { IncidentData } from '../types';
import { formatDateTime } from '../lib/format';
import { AccessibleDialog } from './AccessibleDialog';
import { Icon } from './Icons';
import { StatusPill } from './StatusPill';

interface TextViewDialogProps {
  open: boolean;
  incident: IncidentData;
  activeVersion: number;
  activeHash: string;
  offline: boolean;
  onClose: () => void;
}

export function TextViewDialog({
  open,
  incident,
  activeVersion,
  activeHash,
  offline,
  onClose,
}: TextViewDialogProps) {
  return (
    <AccessibleDialog
      open={open}
      title={`Vue texte — ${incident.fireId}`}
      eyebrow="Alternative complète au canvas"
      onClose={onClose}
      size="large"
    >
      <div className="text-view">
        <div className="text-view__headline">
          <div>
            <h3>{incident.canonicalName} — {incident.sector}</h3>
            <p>Épisode {incident.episodeId} · page stable /incident/{incident.fireId}</p>
          </div>
          <StatusPill code={incident.status.code} label={incident.status.label} />
        </div>

        {offline ? (
          <div className="offline-banner offline-banner--dialog">
            <Icon name="offline" size={19} />
            <div>
              <strong>Données potentiellement obsolètes</strong>
              <span>Dernière synchronisation : {formatDateTime(incident.freshness.lastSyncAt)}</span>
            </div>
          </div>
        ) : null}

        <section className="text-section">
          <h4>État vérifié</h4>
          <dl className="detail-grid">
            <div><dt>Statut</dt><dd>{incident.status.label}</dd></div>
            <div><dt>Validé le</dt><dd>{formatDateTime(incident.status.validatedAt)}</dd></div>
            <div><dt>Localisation</dt><dd>{incident.locationLabel}</dd></div>
            <div><dt>Incertitude</dt><dd>± {incident.frame.horizontalUncertaintyM} m</dd></div>
            <div><dt>Dernière mise à jour</dt><dd>{formatDateTime(incident.freshness.incidentAt)}</dd></div>
            <div><dt>Confiance expliquée</dt><dd>{Math.round(incident.confidence * 100)} % — {incident.confidenceLabel}</dd></div>
          </dl>
        </section>

        <section className="text-section">
          <h4>Terrain et modèle</h4>
          <dl className="detail-grid">
            <div><dt>Version courante affichée</dt><dd>v{activeVersion}</dd></div>
            <div><dt>Hash</dt><dd>sha256 {activeHash}</dd></div>
            <div><dt>Source</dt><dd>{incident.asset.source} · {incident.asset.sourceYear}</dd></div>
            <div><dt>Repère</dt><dd>{incident.frame.localFrame} · 1 m = 1 unité</dd></div>
            <div><dt>Emprise</dt><dd>{incident.asset.footprint}</dd></div>
            <div><dt>Limite</dt><dd>Le relief est daté; il ne représente pas l’état temps réel du feu.</dd></div>
          </dl>
        </section>

        <section className="text-section">
          <h4>Sources vérifiées visibles</h4>
          <ol className="text-source-list">
            {incident.observations
              .filter((observation) => observation.state === 'verified' || observation.state === 'reference')
              .map((observation) => (
                <li key={observation.id}>
                  <div>
                    <strong>{observation.type}</strong>
                    <span>{observation.summary}</span>
                  </div>
                  <dl>
                    <div><dt>Heure</dt><dd>{observation.time}</dd></div>
                    <div><dt>Incertitude</dt><dd>{observation.uncertainty}</dd></div>
                    <div><dt>État</dt><dd>{observation.stateLabel}</dd></div>
                  </dl>
                </li>
              ))}
          </ol>
        </section>

        <section className="text-section">
          <h4>Derniers événements</h4>
          <ol className="text-event-list">
            {incident.audit.slice(0, 5).map((event) => (
              <li key={event.id}>
                <time>{formatDateTime(event.at)}</time>
                <div><strong>{event.title}</strong><span>{event.description}</span></div>
              </li>
            ))}
          </ol>
        </section>

        <div className="dialog-notice dialog-notice--critical">
          <Icon name="alert" size={20} />
          <p>{incident.publicNotice} En France, appeler le 18 ou le 112 en cas d’urgence.</p>
        </div>
      </div>
    </AccessibleDialog>
  );
}
