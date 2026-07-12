import type {
  ViewerManifestModelState,
  ViewerManifestStatusCode,
  ViewerManifestSummary,
} from '../lib/viewerManifest';
import { Icon } from './Icons';

interface ManifestWorkspaceProps {
  summary: ViewerManifestSummary;
  checkedAt: string;
  stale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

export interface ManifestEmptyPanelProps {
  view: 'sources' | 'history' | 'journal';
}

const statusLabels: Record<ViewerManifestStatusCode, string> = {
  CANDIDATE: 'Candidat',
  UNDER_REVIEW: 'En cours de revue',
  ACTIVE_CONFIRMED: 'Incident confirmé',
  MONITORING: 'Sous surveillance',
  EXTINGUISHED: 'Éteint',
  CLOSED: 'Clôturé',
  SUSPENDED: 'Suspendu',
  REJECTED: 'Rejeté',
};

const modelLabels: Record<ViewerManifestModelState, string> = {
  available: 'Métadonnées du modèle disponibles',
  not_available: 'Aucun modèle public disponible',
  withheld: 'Informations spatiales masquées',
};

const emptyPanelLabels: Record<ManifestEmptyPanelProps['view'], string> = {
  sources: 'Sources et confiance',
  history: 'Historique',
  journal: 'Journal',
};

function formatDate(value: string | null): string {
  if (!value) return 'Non communiqué';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date non disponible';

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes.toLocaleString('fr-FR')} o`;
  return `${(bytes / 1_048_576).toLocaleString('fr-FR', {
    maximumFractionDigits: 1,
  })} Mo`;
}

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function PublicLocation({ summary }: Pick<ManifestWorkspaceProps, 'summary'>) {
  const { location } = summary;
  if (!location) return null;

  const [longitude, latitude] = location.coordinates;
  return (
    <section className="manifest-card manifest-card--location" aria-labelledby="manifest-location-title">
      <div className="manifest-card__heading">
        <Icon name="location" size={20} />
        <div>
          <p className="section-kicker">Position publique</p>
          <h3 id="manifest-location-title">Localisation déclarée</h3>
        </div>
      </div>
      <dl className="manifest-data-list">
        <div>
          <dt>Longitude</dt>
          <dd>{longitude.toFixed(5)}°</dd>
        </div>
        <div>
          <dt>Latitude</dt>
          <dd>{latitude.toFixed(5)}°</dd>
        </div>
        <div>
          <dt>Incertitude horizontale</dt>
          <dd>± {location.horizontal_uncertainty_m.toLocaleString('fr-FR')} m</dd>
        </div>
        {location.altitude_m !== null ? (
          <div>
            <dt>Altitude</dt>
            <dd>
              {location.altitude_m.toLocaleString('fr-FR')} m
              {location.vertical_datum ? ` · ${location.vertical_datum}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function ModelAvailability({ summary }: Pick<ManifestWorkspaceProps, 'summary'>) {
  const webGlAvailable = summary.modelState === 'available' ? supportsWebGl() : false;

  if (summary.modelState === 'withheld') {
    return (
      <section className="manifest-card manifest-card--withheld" aria-labelledby="manifest-model-title">
        <div className="manifest-card__heading">
          <Icon name="shield" size={20} />
          <div>
            <p className="section-kicker">Publication restreinte</p>
            <h3 id="manifest-model-title">Informations spatiales masquées</h3>
          </div>
        </div>
        <p>
          La localisation, le repère spatial et les métadonnées de modèle ne sont pas inclus dans le manifeste public.
        </p>
      </section>
    );
  }

  if (summary.modelState === 'not_available') {
    return (
      <section className="manifest-card manifest-card--empty" aria-labelledby="manifest-model-title">
        <div className="manifest-card__heading">
          <Icon name="layers" size={20} />
          <div>
            <p className="section-kicker">Modèle 3D</p>
            <h3 id="manifest-model-title">Aucun modèle public disponible</h3>
          </div>
        </div>
        <p>
          {summary.statusCode === 'CLOSED'
            ? 'Cet incident est clôturé. Aucun viewer ni archive de zone ne sont exposés par le manifeste public.'
            : 'Le manifeste ne publie aucun asset 3D pour cet épisode.'}
        </p>
      </section>
    );
  }

  const asset = summary.asset;
  if (!asset) {
    return null;
  }

  return (
    <section className="manifest-card manifest-card--available" aria-labelledby="manifest-model-title">
      <div className="manifest-card__heading">
        <Icon name="layers" size={20} />
        <div>
          <p className="section-kicker">Modèle 3D</p>
          <h3 id="manifest-model-title">Métadonnées publiques du modèle</h3>
        </div>
      </div>
      <dl className="manifest-data-list">
        <div>
          <dt>Version</dt>
          <dd>v{asset.version}</dd>
        </div>
        <div>
          <dt>Empreinte SHA‑256</dt>
          <dd className="manifest-data-list__hash">{asset.sha256}</dd>
        </div>
        <div>
          <dt>Taille</dt>
          <dd>{formatBytes(asset.size_bytes)}</dd>
        </div>
        <div>
          <dt>Niveau de détail</dt>
          <dd>{asset.lod === 'mobile' ? 'Mobile' : 'Bureau'}</dd>
        </div>
      </dl>
      <p className="manifest-card__notice" role="status">
        {webGlAvailable
          ? 'WebGL est détecté. Le chargement GLB et Unity est volontairement reporté aux passes FV‑008/FV‑009.'
          : 'WebGL est indisponible. La consultation reste textuelle et aucun asset 3D n’est chargé.'}
      </p>
    </section>
  );
}

export function ManifestWorkspace({
  summary,
  checkedAt,
  stale,
  refreshing,
  onRefresh,
}: ManifestWorkspaceProps) {
  return (
    <section
      id="panel-viewer"
      role="tabpanel"
      aria-labelledby="tab-viewer"
      className="manifest-workspace"
      tabIndex={-1}
    >
      <header className="manifest-workspace__header">
        <div>
          <p className="section-kicker">Manifeste public · schéma {summary.schemaVersion}</p>
          <h2>Épisode {summary.episodeId}</h2>
          <p>
            Statut : <strong>{statusLabels[summary.statusCode]}</strong>
            {summary.reviewRequired ? ' · revue requise' : ''}
          </p>
        </div>
        <button
          type="button"
          className="button button--secondary"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Actualiser le manifeste"
        >
          <Icon name="refresh" size={17} />
          {refreshing ? 'Actualisation…' : 'Actualiser le manifeste'}
        </button>
      </header>

      <div className="manifest-freshness" role="status" aria-live="polite">
        <Icon name={stale ? 'warning' : 'check'} size={18} />
        <div>
          <strong>{stale ? 'Dernier manifeste connu — revalidation échouée' : 'Manifeste revalidé'}</strong>
          <span>Dernière revalidation : {formatDate(checkedAt)}</span>
        </div>
      </div>

      <div className="manifest-workspace__content">
        <section className="manifest-card manifest-card--summary" aria-labelledby="manifest-summary-title">
          <div className="manifest-card__heading">
            <Icon name="file-text" size={20} />
            <div>
              <p className="section-kicker">État public</p>
              <h3 id="manifest-summary-title">{modelLabels[summary.modelState]}</h3>
            </div>
          </div>
          <dl className="manifest-data-list">
            <div>
              <dt>Incident</dt>
              <dd>{summary.fireId}</dd>
            </div>
            <div>
              <dt>Épisode</dt>
              <dd>{summary.episodeId}</dd>
            </div>
            <div>
              <dt>Information incident</dt>
              <dd>{formatDate(summary.freshness.incident_at)}</dd>
            </div>
            <div>
              <dt>Statut validé</dt>
              <dd>{formatDate(summary.validatedAt)}</dd>
            </div>
          </dl>
          <p className="manifest-card__notice">{summary.publicNotice}</p>
        </section>
        <PublicLocation summary={summary} />
        <ModelAvailability summary={summary} />
      </div>
    </section>
  );
}

export function ManifestEmptyPanel({ view }: ManifestEmptyPanelProps) {
  const label = emptyPanelLabels[view];
  return (
    <section
      id={`panel-${view}`}
      role="tabpanel"
      aria-labelledby={`tab-${view}`}
      className="manifest-empty-panel"
      tabIndex={-1}
    >
      <Icon name={view === 'sources' ? 'table' : view === 'history' ? 'history' : 'file-text'} size={28} />
      <p className="section-kicker">{label}</p>
      <h2>Non inclus dans le manifeste public</h2>
      <p>
        Les {view === 'sources' ? 'sources' : view === 'history' ? 'données historiques' : 'entrées de journal'}
        {' '}ne sont pas publiées par ce contrat. Aucun contenu de démonstration n’est utilisé dans cette vue.
      </p>
    </section>
  );
}

export function getManifestStatusLabel(status: ViewerManifestStatusCode): string {
  return statusLabels[status];
}
