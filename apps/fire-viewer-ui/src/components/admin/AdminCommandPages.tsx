import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import heroDashboard from '../../assets/public/fire-hero-home.jpg';
import heroMap from '../../assets/public/fire-hero-incidents.jpg';
import type { AdminOperationalMapIncident } from '../../lib/adminApi';
import { PublicIcon, type PublicIconName } from '../public/PublicIcon';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminErrorState, AdminLoadingState, formatAdminDate } from './AdminPageState';
import './AdminCommandPages.css';

function AdminCommandHero({
  title,
  subtitle,
  generatedAt,
  status,
  image,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly generatedAt?: string;
  readonly status?: string;
  readonly image: string;
}) {
  return (
    <header className="admin-command-hero" style={{ '--admin-command-hero': `url(${image})` } as CSSProperties}>
      <div className="admin-command-hero__copy">
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {generatedAt ? <span><PublicIcon name="clock" size={17} />{formatAdminDate(generatedAt)}</span> : null}
      </div>
      {status ? <div className="admin-command-hero__status"><PublicIcon name="check-circle" size={17} />{status}</div> : null}
    </header>
  );
}

function elapsedLabel(value: string): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (elapsedMinutes < 1) return "à l'instant";
  if (elapsedMinutes < 60) return `il y a ${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  return `il y a ${hours} h ${elapsedMinutes % 60 ? String(elapsedMinutes % 60).padStart(2, '0') : ''}`.trim();
}

function priorityIcon(priority: 'critical' | 'high' | 'medium'): PublicIconName {
  return priority === 'critical' ? 'shield' : priority === 'high' ? 'warning' : 'info';
}

function priorityHref(kind: string, fireId: string | null): string {
  if (kind === 'report') return '/admin/signalements';
  if (kind === 'observation') return '/admin/rapprochement-spatial';
  if (kind === 'model_package' || kind === 'job') return fireId ? `/admin/incidents/${fireId}/modeles-pipeline` : '/admin/zones';
  return fireId ? `/admin/incidents/${fireId}` : '/admin/file-de-traitement';
}

function Panel({ title, icon, action, children, className = '' }: {
  readonly title: string;
  readonly icon?: PublicIconName;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={`admin-command-panel ${className}`}>
      <header><h2>{icon ? <PublicIcon name={icon} size={20} /> : null}{title}</h2>{action}</header>
      {children}
    </section>
  );
}

export function AdminDashboardPage() {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getDashboard(options), [api]);
  const { state, reload } = useAdminQuery(load, [load]);
  const dashboard = state.kind === 'ready' ? state.data : null;

  return (
    <div className="admin-dashboard-page">
      <AdminCommandHero
        title="Poste de veille"
        subtitle="Ce qui demande une décision maintenant"
        generatedAt={dashboard?.generated_at}
        status={dashboard ? 'API disponible · données privées synchronisées' : undefined}
        image={heroDashboard}
      />
      <div className="admin-dashboard-page__content">
        {state.kind === 'loading' ? <AdminLoadingState label="Chargement du poste de veille…" /> : null}
        {state.kind === 'error' ? <AdminErrorState error={state.error} onRetry={reload} /> : null}
        {dashboard ? (
          <>
            <div className="admin-dashboard-page__summary">
              <a className="admin-command-button admin-command-button--primary" href="/admin/file-de-traitement">
                <PublicIcon name="data" size={18} />Ouvrir la file de traitement <span>{dashboard.queue.total}</span>
              </a>
              <dl>
                <div><dt>Critiques</dt><dd>{dashboard.queue.critical}</dd></div>
                <div><dt>Priorité haute</dt><dd>{dashboard.queue.high}</dd></div>
                <div><dt>Modèles à revoir</dt><dd>{dashboard.queue.models_to_review}</dd></div>
              </dl>
            </div>

            <div className="admin-dashboard-page__grid">
              <div className="admin-dashboard-page__main">
                <Panel title="À prendre en charge" action={<a href="/admin/file-de-traitement">Voir toute la file</a>}>
                  {dashboard.priorities.length ? (
                    <ul className="admin-priority-list">
                      {dashboard.priorities.slice(0, 6).map((item) => (
                        <li key={`${item.kind}-${item.target_id}`}>
                          <span className={`admin-priority-list__icon is-${item.priority}`}><PublicIcon name={priorityIcon(item.priority)} size={23} /></span>
                          <span className="admin-priority-list__copy"><strong>{item.priority === 'critical' ? 'Critique' : item.priority === 'high' ? 'Haute' : 'Moyenne'}</strong><small>{item.title}</small></span>
                          <span className="admin-priority-list__target"><strong>{item.fire_id ?? item.target_id}</strong><small>{item.detail}</small></span>
                          <time dateTime={item.created_at}>{elapsedLabel(item.created_at)}</time>
                          <a href={priorityHref(item.kind, item.fire_id)}>Examiner <PublicIcon name="chevron-right" size={16} /></a>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="admin-command-panel__empty">Aucune décision urgente dans la file persistée.</p>}
                </Panel>

                <Panel title="Publications récentes" icon="share" action={<a href="/admin/publications">Voir toutes</a>}>
                  {dashboard.recent_publications.length ? (
                    <ul className="admin-publication-list">
                      {dashboard.recent_publications.map((publication) => (
                        <li key={publication.publication_id}>
                          <PublicIcon name="share" size={17} />
                          <span><strong>{publication.state.replaceAll('_', ' ')}</strong><small>{publication.linked_fire_ids.join(', ') || publication.zone_id}</small></span>
                          <span>{publication.actor_id}</span>
                          <time dateTime={publication.updated_at}>{elapsedLabel(publication.updated_at)}</time>
                          <a href="/admin/publications" aria-label={`Ouvrir la publication ${publication.publication_id}`}><PublicIcon name="chevron-right" size={16} /></a>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="admin-command-panel__empty">Aucune publication récente.</p>}
                </Panel>
              </div>

              <aside className="admin-dashboard-page__aside">
                <Panel title="Veille active" icon="shield" action={<a href="/admin/incidents">Voir tout</a>}>
                  {dashboard.watchlist.length ? (
                    <ul className="admin-watch-list">
                      {dashboard.watchlist.slice(0, 5).map((incident) => (
                        <li key={incident.fire_id}>
                          <span className={`admin-watch-list__dot is-${incident.status === 'ACTIVE_CONFIRMED' ? 'active' : 'monitoring'}`} />
                          <span><strong>{incident.fire_id} · {incident.canonical_name ?? 'Incident sans nom'}</strong><small>{incident.model_update_available ? 'Mise à jour du modèle disponible' : incident.review_required ? 'Revue humaine requise' : `${incident.pending_observation_count} observation(s) à traiter`}</small></span>
                          <a href={`/admin/incidents/${incident.fire_id}`}>Ouvrir</a>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="admin-command-panel__empty">Aucun incident actif à surveiller.</p>}
                </Panel>

                <Panel title="Système" icon="monitor">
                  <ul className="admin-system-list">
                    <li><span className="is-ok" /><strong>API</strong><small>Opérationnelle</small></li>
                    <li><span className={dashboard.system.database.reachable ? 'is-ok' : 'is-error'} /><strong>Base</strong><small>{dashboard.system.database.reachable ? 'Opérationnelle' : 'Indisponible'}</small></li>
                    <li><span className={dashboard.system.queues.jobs_quarantined ? 'is-warning' : 'is-ok'} /><strong>File de jobs</strong><small>{dashboard.system.queues.jobs_quarantined ? `${dashboard.system.queues.jobs_quarantined} en quarantaine` : `${dashboard.system.queues.jobs_active} actif(s)`}</small></li>
                    <li><span className="is-neutral" /><strong>Worker</strong><small>{dashboard.system.worker_heartbeat.replaceAll('_', ' ')}</small></li>
                  </ul>
                </Panel>

                <a className="admin-map-summary" href="/admin/carte-operationnelle">
                  <PublicIcon name="map" size={25} />
                  <span><strong>{dashboard.map_summary.total_incidents} incidents cartographiés</strong><small>{dashboard.map_summary.incidents_with_models} avec représentation 3D</small></span>
                  <PublicIcon name="arrow" size={18} />
                </a>
              </aside>
            </div>
            <p className="admin-dashboard-page__safety"><PublicIcon name="info" size={18} />Aucune sortie automatisée n’est publiée sans validation humaine.</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

const MAP_ZOOM = 6;
const MAP_X_MIN = 30;
const MAP_X_MAX = 34;
const MAP_Y_MIN = 21;
const MAP_Y_MAX = 24;

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

function mapMarkerVisible(incident: AdminOperationalMapIncident, layers: MapLayers): boolean {
  if (incident.status === 'ACTIVE_CONFIRMED' && !layers.active) return false;
  if (incident.status === 'MONITORING' && !layers.monitoring) return false;
  return true;
}

interface MapLayers { readonly active: boolean; readonly monitoring: boolean; readonly models: boolean; readonly updates: boolean; readonly review: boolean; }
type IncidentTab = 'situation' | 'models' | 'zones' | 'actions';

function IncidentMapPanel({ incident, tab, setTab, onClose }: { readonly incident: AdminOperationalMapIncident; readonly tab: IncidentTab; readonly setTab: (tab: IncidentTab) => void; readonly onClose: () => void }) {
  return (
    <section className="admin-incident-map-panel" aria-label={`Incident ${incident.fire_id}`}>
      <header><PublicIcon name="flame" size={21} /><h2>{incident.fire_id} · {incident.canonical_name ?? incident.territory_code}</h2><button type="button" onClick={onClose} aria-label="Fermer la fiche"><PublicIcon name="close" size={20} /></button></header>
      <div className="admin-incident-map-panel__tabs" role="tablist" aria-label="Données de l’incident">
        {([['situation', 'Situation'], ['models', 'Modèles 3D'], ['zones', 'Zones et marqueurs'], ['actions', 'Actions']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}
      </div>
      <div className="admin-incident-map-panel__body">
        {tab === 'situation' ? (
          <dl className="admin-incident-map-panel__facts">
            <div><dt>État</dt><dd>{incident.status.replaceAll('_', ' ')}</dd></div>
            <div><dt>Vérification</dt><dd>{incident.verification_state.replaceAll('_', ' ')}</dd></div>
            <div><dt>Observations à traiter</dt><dd>{incident.pending_observation_count}</dd></div>
            <div><dt>Incertitude</dt><dd>± {Math.round(incident.horizontal_uncertainty_m)} m</dd></div>
          </dl>
        ) : null}
        {tab === 'models' ? (
          incident.models.length ? <ul className="admin-map-model-list">{incident.models.map((model, index) => (
            <li key={`${model.source}-${model.asset_id ?? model.package_file_id ?? index}`}>
              <PublicIcon name="database" size={18} />
              <span><strong>{model.profile === 'close' ? 'Rapproché' : model.profile === 'local' ? 'Local' : model.profile === 'extended' ? 'Étendu' : model.profile}</strong><small>{model.version ? `v${model.version}` : 'Package'} · {model.state.replaceAll('_', ' ')}</small></span>
              <span className={model.is_current ? 'is-current' : ''}>{model.is_current ? 'À jour' : 'Disponible'}</span>
              <a href={`/admin/incidents/${incident.fire_id}/modeles-pipeline`}>Ouvrir le modèle</a>
            </li>
          ))}</ul> : <p className="admin-command-panel__empty">Aucune représentation 3D liée à cet incident.</p>
        ) : null}
        {tab === 'zones' ? (
          <dl className="admin-incident-map-panel__facts">
            <div><dt>Zone technique</dt><dd>{incident.spatial_zone_id ?? 'Non liée'}</dd></div>
            <div><dt>Révision</dt><dd>{incident.spatial_zone_revision ?? '—'}</dd></div>
            <div><dt>Package courant</dt><dd>{incident.current_package_id ?? '—'}</dd></div>
            <div><dt>Package publié</dt><dd>{incident.active_package_id ?? '—'}</dd></div>
          </dl>
        ) : null}
        {tab === 'actions' ? <div className="admin-incident-map-panel__actions"><a href={`/admin/incidents/${incident.fire_id}`}>Ouvrir l’incident</a><a href={`/admin/incidents/${incident.fire_id}/observations`}>Vérifier les observations</a><a href={`/admin/incidents/${incident.fire_id}/modeles-pipeline`}>Gérer les modèles</a></div> : null}
      </div>
      <footer><PublicIcon name="clock" size={15} />Dernière synchronisation : {elapsedLabel(incident.last_observed_at)}<span>Origine EPSG:4326</span></footer>
    </section>
  );
}

export function AdminOperationalMapPage() {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getOperationalMap(options), [api]);
  const { state, reload } = useAdminQuery(load, [load]);
  const data = state.kind === 'ready' ? state.data : null;
  const [selectedFireId, setSelectedFireId] = useState<string | null>(null);
  const [tab, setTab] = useState<IncidentTab>('models');
  const [scale, setScale] = useState(1);
  const [layers, setLayers] = useState<MapLayers>({ active: true, monitoring: true, models: true, updates: true, review: true });
  const selected = data?.incidents.find((incident) => incident.fire_id === selectedFireId) ?? null;
  const visibleIncidents = data?.incidents.filter((incident) => mapMarkerVisible(incident, layers)) ?? [];
  const tiles = Array.from({ length: MAP_Y_MAX - MAP_Y_MIN + 1 }, (_, row) => Array.from({ length: MAP_X_MAX - MAP_X_MIN + 1 }, (_, column) => ({ x: MAP_X_MIN + column, y: MAP_Y_MIN + row }))).flat();

  const toggleLayer = (layer: keyof MapLayers) => setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  const selectIncident = (fireId: string) => { setSelectedFireId(fireId); setTab('models'); };

  return (
    <div className="admin-map-page">
      <AdminCommandHero title="Carte opérationnelle nationale" subtitle="Incidents, modèles et couches administratives" generatedAt={data?.generated_at} image={heroMap} />
      <div className="admin-map-page__workspace">
        {state.kind === 'loading' ? <div className="admin-map-page__state"><AdminLoadingState label="Chargement de la carte nationale…" /></div> : null}
        {state.kind === 'error' ? <div className="admin-map-page__state"><AdminErrorState error={state.error} onRetry={reload} /></div> : null}
        {data ? (
          <>
            <div className="admin-map-page__canvas" aria-label="Carte interne des incidents en France">
              <div className="admin-map-page__geography" style={{ transform: `scale(${scale})` }}>
                <div className="admin-map-page__tiles" aria-hidden="true">
                  {tiles.map((tile) => <img key={`${tile.x}-${tile.y}`} src={`https://tile.opentopomap.org/${MAP_ZOOM}/${tile.x}/${tile.y}.png`} alt="" loading="eager" />)}
                </div>
                {visibleIncidents.map((incident) => {
                  const position = mercatorPosition(incident.longitude, incident.latitude);
                  return (
                    <button
                      className={`admin-map-marker ${incident.status === 'ACTIVE_CONFIRMED' ? 'is-active' : 'is-monitoring'} ${selectedFireId === incident.fire_id ? 'is-selected' : ''}`}
                      style={{ left: `${position.left}%`, top: `${position.top}%` }}
                      type="button"
                      key={incident.fire_id}
                      onClick={() => selectIncident(incident.fire_id)}
                      aria-label={`${incident.fire_id}, ${incident.canonical_name ?? incident.territory_code}`}
                    >
                      <span><PublicIcon name={incident.status === 'ACTIVE_CONFIRMED' ? 'flame' : 'target'} size={19} /></span>
                      {layers.models && incident.models.length ? <i className="admin-map-marker__badge is-model" title="Modèle 3D disponible"><PublicIcon name="database" size={12} /></i> : null}
                      {layers.updates && incident.model_update_available ? <i className="admin-map-marker__badge is-update" title="Mise à jour de modèle disponible"><PublicIcon name="warning" size={12} /></i> : null}
                      {layers.review && incident.review_required ? <i className="admin-map-marker__badge is-review" title="Revue humaine requise"><PublicIcon name="shield" size={12} /></i> : null}
                      <strong>{incident.fire_id}<small>{incident.canonical_name ?? incident.territory_code}</small></strong>
                    </button>
                  );
                })}
              </div>
              <p className="admin-map-page__attribution">Fond cartographique © OpenStreetMap · SRTM · OpenTopoMap (CC-BY-SA)</p>
            </div>

            <div className="admin-map-controls" aria-label="Contrôles de la carte">
              <button type="button" onClick={() => setScale((value) => Math.min(1.35, value + 0.1))} aria-label="Zoom avant"><PublicIcon name="plus" size={22} /></button>
              <button type="button" onClick={() => setScale((value) => Math.max(1, value - 0.1))} aria-label="Zoom arrière">−</button>
              <button type="button" onClick={() => setScale(1)} aria-label="Recentrer la carte"><PublicIcon name="crosshair" size={20} /></button>
              <button type="button" onClick={reload} aria-label="Actualiser la carte"><PublicIcon name="arrow" size={20} /></button>
            </div>

            <section className="admin-map-layers" aria-labelledby="admin-map-layers-title">
              <header><PublicIcon name="data" size={20} /><h2 id="admin-map-layers-title">Couches</h2></header>
              {([['active', 'Incidents actifs', 'flame'], ['monitoring', 'Sous surveillance', 'target'], ['models', 'Modèles disponibles', 'database'], ['updates', 'Mises à jour modèles', 'warning'], ['review', 'Revue requise', 'shield']] as const).map(([key, label, icon]) => (
                <label key={key}><input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} /><PublicIcon name={icon} size={18} />{label}</label>
              ))}
              <button type="button" onClick={reload}>Actualiser toutes les couches <PublicIcon name="arrow" size={17} /></button>
            </section>

            {selected ? <IncidentMapPanel incident={selected} tab={tab} setTab={setTab} onClose={() => setSelectedFireId(null)} /> : null}

            <div className="admin-map-page__queue">
              <PublicIcon name="data" size={23} />
              <strong>{data.summary.incidents_requiring_review} incident(s) à revoir</strong>
              <span>{data.summary.model_updates_available} mise(s) à jour de modèle</span>
              <span>{data.summary.incidents_with_models} incident(s) avec 3D</span>
              <a href="/admin/file-de-traitement">Ouvrir la file <PublicIcon name="arrow" size={18} /></a>
            </div>

            <section className="admin-map-page__mobile-list" aria-label="Incidents visibles">
              <h2>Incidents sur la carte</h2>
              {visibleIncidents.map((incident) => <button type="button" key={incident.fire_id} onClick={() => selectIncident(incident.fire_id)}><PublicIcon name={incident.status === 'ACTIVE_CONFIRMED' ? 'flame' : 'target'} size={19} /><span><strong>{incident.fire_id}</strong><small>{incident.canonical_name ?? incident.territory_code}</small></span><PublicIcon name="chevron-right" size={17} /></button>)}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
