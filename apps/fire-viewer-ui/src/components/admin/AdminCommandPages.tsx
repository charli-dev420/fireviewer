import { useCallback, useState, type CSSProperties } from 'react';
import type { AdminOperationalMapIncident, AdminOperationalMapResponse } from '../../lib/adminApi';
import { PublicIcon } from '../public/PublicIcon';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminErrorState, AdminLoadingState, formatAdminDate } from './AdminPageState';
import './AdminCommandPages.css';

const MAP_ZOOM = 6;
const MAP_X_MIN = 30;
const MAP_X_MAX = 34;
const MAP_Y_MIN = 21;
const MAP_Y_MAX = 24;

type MapFilter = 'active' | 'review' | 'monitoring';

interface MapView {
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
}

interface PositionedIncident {
  readonly incident: AdminOperationalMapIncident;
  readonly left: number;
  readonly top: number;
}

interface IncidentCluster {
  readonly key: string;
  readonly incidents: readonly AdminOperationalMapIncident[];
  readonly left: number;
  readonly top: number;
}

const NATIONAL_VIEW: MapView = { scale: 1, translateX: 0, translateY: 0 };

function elapsedLabel(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'heure inconnue';
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - parsed) / 60_000));
  if (elapsedMinutes < 1) return "à l'instant";
  if (elapsedMinutes < 60) return `il y a ${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `il y a ${hours} h${elapsedMinutes % 60 ? ` ${elapsedMinutes % 60} min` : ''}`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

function readableState(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toLocaleUpperCase('fr-FR'));
}

function incidentName(incident: AdminOperationalMapIncident): string {
  return incident.canonical_name ?? `Incident ${incident.territory_code}`;
}

function mercatorPosition(longitude: number, latitude: number): { left: number; top: number } {
  const worldSize = 2 ** MAP_ZOOM;
  const worldX = ((longitude + 180) / 360) * worldSize;
  const latitudeRadians = (Math.min(85, Math.max(-85, latitude)) * Math.PI) / 180;
  const worldY = (1 - Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI) / 2 * worldSize;
  return {
    left: ((worldX - MAP_X_MIN) / (MAP_X_MAX - MAP_X_MIN + 1)) * 100,
    top: ((worldY - MAP_Y_MIN) / (MAP_Y_MAX - MAP_Y_MIN + 1)) * 100,
  };
}

function visibleForFilter(incident: AdminOperationalMapIncident, filter: MapFilter): boolean {
  if (filter === 'review') return incident.review_required;
  if (filter === 'monitoring') return incident.status === 'MONITORING';
  return incident.status === 'ACTIVE_CONFIRMED' || incident.status === 'MONITORING';
}

function clusterIncidents(incidents: readonly AdminOperationalMapIncident[], scale: number): readonly IncidentCluster[] {
  const positioned: PositionedIncident[] = incidents.map((incident) => ({ incident, ...mercatorPosition(incident.longitude, incident.latitude) }));
  const clusters: { incidents: AdminOperationalMapIncident[]; left: number; top: number }[] = [];
  const threshold = 4.2 / scale;

  for (const item of positioned) {
    const existing = clusters.find((cluster) => Math.hypot(cluster.left - item.left, cluster.top - item.top) <= threshold);
    if (!existing) {
      clusters.push({ incidents: [item.incident], left: item.left, top: item.top });
      continue;
    }
    existing.incidents.push(item.incident);
    const positions = existing.incidents.map((incident) => mercatorPosition(incident.longitude, incident.latitude));
    existing.left = positions.reduce((sum, position) => sum + position.left, 0) / positions.length;
    existing.top = positions.reduce((sum, position) => sum + position.top, 0) / positions.length;
  }

  return clusters.map((cluster) => ({
    ...cluster,
    key: cluster.incidents.map((incident) => incident.fire_id).sort().join('|'),
  }));
}

function filterCount(data: AdminOperationalMapResponse, filter: MapFilter): number {
  if (filter === 'review') return data.summary.incidents_requiring_review;
  if (filter === 'monitoring') return data.summary.monitoring_incidents;
  return data.summary.active_incidents + data.summary.monitoring_incidents;
}

function NationalStatusLegend({ data, selected }: { readonly data: AdminOperationalMapResponse; readonly selected: AdminOperationalMapIncident | null }) {
  return (
    <section className="admin-national-map__freshness" aria-label="État des données">
      <strong>État des données</strong>
      <span><i className="is-live" />Carte nationale <small>{elapsedLabel(data.generated_at)}</small></span>
      <span><i className={selected?.pending_observation_count ? 'is-attention' : 'is-live'} />Observations <small>{selected ? `${selected.pending_observation_count} à traiter` : 'sélectionnez un incident'}</small></span>
      <span><i className={selected?.models.length ? 'is-live' : 'is-muted'} />Carte 3D <small>{selected?.models.length ? `${selected.models.length} disponible(s)` : 'non disponible'}</small></span>
      <span><i className={data.summary.incidents_requiring_review ? 'is-attention' : 'is-live'} />Décisions <small>{data.summary.incidents_requiring_review} en attente</small></span>
    </section>
  );
}

function IncidentDecisionDrawer({
  incident,
  onClose,
  onFocus,
  onNationalView,
}: {
  readonly incident: AdminOperationalMapIncident;
  readonly onClose: () => void;
  readonly onFocus: () => void;
  readonly onNationalView: () => void;
}) {
  const [activityOpen, setActivityOpen] = useState(false);
  const reviewCopy = incident.pending_observation_count > 0
    ? `${incident.pending_observation_count} observation(s) attendent une décision humaine.`
    : 'La situation doit être confirmée avant toute publication.';

  return (
    <aside className="admin-incident-drawer" aria-label={`Incident ${incident.fire_id}`}>
      <header>
        <div>
          <span className={`admin-incident-drawer__status is-${incident.status === 'MONITORING' ? 'monitoring' : 'active'}`}>
            {incident.status === 'MONITORING' ? 'Surveillance' : 'Actif'}
          </span>
          <h1>{incidentName(incident)}</h1>
          <p>{incident.fire_id} · Territoire {incident.territory_code}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer la fiche incident"><PublicIcon name="close" size={20} /></button>
      </header>

      {incident.review_required ? (
        <section className="admin-incident-drawer__alert">
          <PublicIcon name="warning" size={21} />
          <div><strong>Action requise</strong><p>{reviewCopy}</p></div>
        </section>
      ) : (
        <section className="admin-incident-drawer__steady">
          <PublicIcon name="check-circle" size={21} />
          <div><strong>Situation suivie</strong><p>Aucune décision urgente n’est signalée.</p></div>
        </section>
      )}

      <section className="admin-incident-drawer__section">
        <div className="admin-incident-drawer__section-title"><h2>Situation</h2><time dateTime={incident.last_observed_at}>{elapsedLabel(incident.last_observed_at)}</time></div>
        <dl className="admin-incident-drawer__facts">
          <div><dt>État</dt><dd>{readableState(incident.status)}</dd></div>
          <div><dt>Vérification</dt><dd>{readableState(incident.verification_state)}</dd></div>
          <div><dt>Observations à traiter</dt><dd>{incident.pending_observation_count}</dd></div>
          <div><dt>Précision de localisation</dt><dd>± {Math.round(incident.horizontal_uncertainty_m)} m</dd></div>
        </dl>
      </section>

      <section className="admin-incident-drawer__section">
        <div className="admin-incident-drawer__section-title"><h2>Données disponibles</h2></div>
        <div className="admin-incident-drawer__data-grid">
          <div><PublicIcon name="image" size={21} /><span><strong>Observations</strong><small>{incident.pending_observation_count} à examiner</small></span></div>
          <div><PublicIcon name="database" size={21} /><span><strong>Carte 3D</strong><small>{incident.models.length ? `${incident.models.length} disponible(s)` : 'Non disponible'}</small></span></div>
          <div><PublicIcon name="globe" size={21} /><span><strong>Visibilité</strong><small>{readableState(incident.visibility)}</small></span></div>
        </div>
      </section>

      <section className={`admin-incident-drawer__decision ${incident.review_required ? 'is-required' : ''}`}>
        <div><PublicIcon name={incident.review_required ? 'shield' : 'check-circle'} size={22} /><span><strong>{incident.review_required ? 'Décision humaine requise' : 'Aucune action urgente'}</strong><small>{incident.review_required ? 'Vérifiez les sources avant de mettre à jour la fiche publique.' : 'Le suivi continue automatiquement.'}</small></span></div>
        <a className="admin-incident-drawer__primary" href={`/admin/incidents/${incident.fire_id}`}>Ouvrir l’incident <PublicIcon name="arrow" size={17} /></a>
        <a className="admin-incident-drawer__secondary" href={`/admin/incidents/${incident.fire_id}/sources-medias`}>Voir les sources</a>
      </section>

      <div className="admin-incident-drawer__map-actions">
        <button type="button" onClick={onFocus}><PublicIcon name="crosshair" size={17} />Recentrer sur l’incident</button>
        <button type="button" onClick={onNationalView}><PublicIcon name="globe" size={17} />Revenir à la vue nationale</button>
      </div>

      <section className="admin-incident-drawer__activity">
        <button type="button" aria-expanded={activityOpen} onClick={() => setActivityOpen((open) => !open)}>
          <span><PublicIcon name="clock" size={18} />Activité récente</span><PublicIcon name={activityOpen ? 'chevron-down' : 'chevron-right'} size={17} />
        </button>
        {activityOpen ? (
          <ul>
            <li>Dernière observation {elapsedLabel(incident.last_observed_at)}.</li>
            <li>{incident.review_required ? 'Validation humaine demandée.' : 'Aucune validation en attente.'}</li>
            {incident.model_update_available ? <li>Une mise à jour de la carte 3D est disponible.</li> : null}
          </ul>
        ) : null}
      </section>
    </aside>
  );
}

function AdminNationalOperationsPage() {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getOperationalMap(options), [api]);
  const { state, reload } = useAdminQuery(load, [load]);
  const data = state.kind === 'ready' ? state.data : null;
  const [filter, setFilter] = useState<MapFilter>('active');
  const [selectedFireId, setSelectedFireId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [view, setView] = useState<MapView>(NATIONAL_VIEW);

  const defaultIncident = data?.incidents.find((incident) => incident.review_required) ?? data?.incidents[0] ?? null;
  const selected = drawerOpen
    ? data?.incidents.find((incident) => incident.fire_id === selectedFireId) ?? defaultIncident
    : null;
  const visibleIncidents = data?.incidents.filter((incident) => visibleForFilter(incident, filter)) ?? [];
  const clusters = clusterIncidents(visibleIncidents, view.scale);
  const tiles = Array.from(
    { length: MAP_Y_MAX - MAP_Y_MIN + 1 },
    (_, row) => Array.from({ length: MAP_X_MAX - MAP_X_MIN + 1 }, (_, column) => ({ x: MAP_X_MIN + column, y: MAP_Y_MIN + row })),
  ).flat();

  const selectIncident = (incident: AdminOperationalMapIncident) => {
    setSelectedFireId(incident.fire_id);
    setDrawerOpen(true);
  };

  const focusPosition = (left: number, top: number, scale = 1.65) => {
    setView({ scale, translateX: 50 - left, translateY: 50 - top });
  };

  const focusIncident = (incident: AdminOperationalMapIncident) => {
    const position = mercatorPosition(incident.longitude, incident.latitude);
    focusPosition(position.left, position.top, 1.75);
  };

  const activateFilter = (nextFilter: MapFilter) => {
    setFilter(nextFilter);
    setView(NATIONAL_VIEW);
  };

  return (
    <div className="admin-national-map">
      {state.kind === 'loading' ? <div className="admin-national-map__state"><AdminLoadingState label="Chargement du centre opérationnel…" /></div> : null}
      {state.kind === 'error' ? <div className="admin-national-map__state"><AdminErrorState error={state.error} onRetry={reload} /></div> : null}
      {data ? (
        <div className={`admin-national-map__workspace ${selected ? 'has-drawer' : ''}`}>
          <main className="admin-national-map__canvas" aria-label="Carte nationale des incidents en France">
            <div
              className="admin-national-map__geography"
              style={{ '--map-scale': view.scale, '--map-x': `${view.translateX}%`, '--map-y': `${view.translateY}%` } as CSSProperties}
            >
              <div className="admin-national-map__tiles" aria-hidden="true">
                {tiles.map((tile) => <img key={`${tile.x}-${tile.y}`} src={`https://tile.opentopomap.org/${MAP_ZOOM}/${tile.x}/${tile.y}.png`} alt="" loading="eager" />)}
              </div>
              {clusters.map((cluster) => {
                if (cluster.incidents.length > 1) {
                  return (
                    <button
                      className="admin-national-map__cluster"
                      type="button"
                      key={cluster.key}
                      style={{ left: `${cluster.left}%`, top: `${cluster.top}%` }}
                      onClick={() => {
                        selectIncident(cluster.incidents[0]);
                        focusPosition(cluster.left, cluster.top, Math.max(1.45, view.scale + 0.35));
                      }}
                      aria-label={`${cluster.incidents.length} incidents proches`}
                    >
                      <span>{cluster.incidents.length}</span><small>incidents</small>
                    </button>
                  );
                }
                const incident = cluster.incidents[0];
                const isSelected = selected?.fire_id === incident.fire_id;
                return (
                  <button
                    className={`admin-national-map__marker is-${incident.status === 'MONITORING' ? 'monitoring' : 'active'} ${incident.review_required ? 'needs-review' : ''} ${isSelected ? 'is-selected' : ''}`}
                    style={{ left: `${cluster.left}%`, top: `${cluster.top}%` }}
                    type="button"
                    key={incident.fire_id}
                    onClick={() => selectIncident(incident)}
                    aria-label={`${incident.fire_id}, ${incidentName(incident)}`}
                  >
                    <span><PublicIcon name={incident.status === 'MONITORING' ? 'target' : 'flame'} size={18} /></span>
                    <strong>{incidentName(incident)}<small>{incident.review_required ? 'Décision requise' : readableState(incident.status)}</small></strong>
                  </button>
                );
              })}
            </div>

            <header className="admin-national-map__heading">
              <div><span>Centre opérationnel</span><h1>Vue nationale — France métropolitaine</h1><p>{data.summary.total_incidents} incident(s) suivi(s) · mise à jour {elapsedLabel(data.generated_at)}</p></div>
              <button type="button" onClick={reload} aria-label="Actualiser les incidents"><PublicIcon name="arrow" size={18} />Actualiser</button>
            </header>

            <nav className="admin-national-map__filters" aria-label="Filtrer les incidents">
              {([['active', 'Actifs'], ['review', 'À valider'], ['monitoring', 'Surveillance']] as const).map(([value, label]) => (
                <button type="button" key={value} aria-pressed={filter === value} onClick={() => activateFilter(value)}>
                  <span className={`is-${value}`} />{label}<strong>{filterCount(data, value)}</strong>
                </button>
              ))}
            </nav>

            <div className="admin-national-map__controls" aria-label="Contrôles de la carte">
              <button type="button" onClick={() => setView((current) => ({ ...current, scale: Math.min(2.4, current.scale + 0.2) }))} aria-label="Zoom avant"><PublicIcon name="plus" size={20} /></button>
              <button type="button" onClick={() => setView((current) => ({ ...current, scale: Math.max(1, current.scale - 0.2) }))} aria-label="Zoom arrière">−</button>
              <button type="button" onClick={() => setView(NATIONAL_VIEW)} aria-label="Revenir à la vue nationale"><PublicIcon name="globe" size={18} /></button>
            </div>

            <NationalStatusLegend data={data} selected={selected} />
            <p className="admin-national-map__attribution">Fond cartographique © OpenStreetMap · SRTM · OpenTopoMap (CC-BY-SA)</p>
          </main>

          {selected ? (
            <IncidentDecisionDrawer
              incident={selected}
              onClose={() => setDrawerOpen(false)}
              onFocus={() => focusIncident(selected)}
              onNationalView={() => setView(NATIONAL_VIEW)}
            />
          ) : null}

          <footer className="admin-national-map__statusbar">
            <span><i className="is-live" />{visibleIncidents.length} incident(s) affiché(s)</span>
            <span><PublicIcon name="shield" size={15} />{data.summary.incidents_requiring_review} décision(s) en attente</span>
            <span><PublicIcon name="clock" size={15} />Synchronisé le {formatAdminDate(data.generated_at)}</span>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

export function AdminDashboardPage() {
  return <AdminNationalOperationsPage />;
}

export function AdminOperationalMapPage() {
  return <AdminNationalOperationsPage />;
}
