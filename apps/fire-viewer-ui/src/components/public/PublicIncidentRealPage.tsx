import { useEffect, useState, type ReactNode } from 'react';
import { loadPublicIncidentView, type PublicIncidentView } from '../../lib/publicIncidentView';
import type { ViewerManifestStatusCode, ViewerManifestSummary } from '../../lib/viewerManifest';
import { IncidentGlbViewer } from './IncidentGlbViewer';
import { PublicIcon, type PublicIconName } from './PublicIcon';
import './public-incident.css';

type MainView = 'three-d' | 'information' | 'safety' | 'statistics';
type SidePanel = 'media' | 'comments' | 'episodes' | null;

const statusLabels: Record<ViewerManifestStatusCode, string> = {
  CANDIDATE: 'En cours de vérification',
  UNDER_REVIEW: 'En cours de vérification',
  ACTIVE_CONFIRMED: 'Actif',
  MONITORING: 'Sous surveillance',
  EXTINGUISHED: 'Éteint',
  CLOSED: 'Incident clos',
  SUSPENDED: 'Indisponible',
  REJECTED: 'Retiré',
};

const mainViews: readonly { id: MainView; label: string; icon: PublicIconName }[] = [
  { id: 'three-d', label: '3D', icon: 'map' },
  { id: 'information', label: 'Informations', icon: 'info' },
  { id: 'safety', label: 'Gestes à adopter', icon: 'shield' },
  { id: 'statistics', label: 'Statistiques', icon: 'chart' },
];

function formatDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Non disponible';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(value));
}

function freshness(value: string | null): { label: string; stale: boolean } {
  if (!value || !Number.isFinite(Date.parse(value))) return { label: 'Actualisation inconnue', stale: true };
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 60) return { label: `Mise à jour il y a ${minutes || 1} min`, stale: false };
  if (minutes < 1_440) return { label: `Mise à jour il y a ${Math.round(minutes / 60)} h`, stale: minutes >= 360 };
  return { label: `Mise à jour il y a ${Math.round(minutes / 1_440)} j`, stale: true };
}

function PanelCard({ title, icon, children }: { readonly title: string; readonly icon: PublicIconName; readonly children: ReactNode }) {
  return <section className="fw-incident-card"><header><PublicIcon name={icon} size={24} /><h2>{title}</h2></header>{children}</section>;
}

function InformationView({ view }: { readonly view: PublicIncidentView | null }) {
  return <div className="fw-incident-card-grid">
    <PanelCard title="Situation actuelle" icon="info">
      <p>{view?.public_note ?? view?.facts[0] ?? 'Aucune évolution détaillée n’est publiée pour le moment.'}</p>
      <dl className="fw-incident-data">
        <div><dt>État</dt><dd>{view?.status ?? 'Non communiqué'}</dd></div>
        <div><dt>Première détection</dt><dd>{formatDate(view?.episodes.at(-1)?.started_at ?? null)}</dd></div>
        <div><dt>Dernière mise à jour</dt><dd>{formatDate(view?.freshness_at ?? null)}</dd></div>
      </dl>
    </PanelCard>
    <PanelCard title="Secteurs et accès" icon="map">
      {view?.observations.length ? <ul>{view.observations.slice(0, 5).map((item) => <li key={item.observation_id}>{item.area_label ?? 'Zone approximative'} · précision ± {Math.round(item.uncertainty_m)} m</li>)}</ul> : <p>Aucun secteur détaillé n’est actuellement publié.</p>}
    </PanelCard>
    <PanelCard title="Limites des informations" icon="warning">
      {view?.limitations.length ? <ul>{view.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Les positions et surfaces peuvent être estimées.</p>}
    </PanelCard>
  </div>;
}

const safetyGroups = [
  { title: 'Je vois un départ de feu', icon: 'flame' as const, items: ['Éloignez-vous sans vous mettre en danger pour prendre une image.', 'Appelez le 18 ou le 112 et indiquez précisément le lieu.', 'Ne bloquez pas les voies d’accès.'] },
  { title: 'Je suis à proximité', icon: 'location' as const, items: ['Suivez les consignes officielles.', 'Préparez les éléments essentiels et gardez les accès libres.', 'Limitez l’exposition aux fumées et ne vous rendez pas sur place.'] },
  { title: 'Une évacuation est demandée', icon: 'warning' as const, items: ['Suivez uniquement les consignes des autorités.', 'N’empruntez pas une route signalée inaccessible.', 'Ne retournez pas dans la zone sans autorisation.'] },
];

function SafetyView() {
  return <div className="fw-incident-safety">
    <aside><PublicIcon name="phone" size={25} /><div><strong>Danger immédiat</strong><span>Appelez le 18 ou le 112. FireWarning ne remplace pas les secours.</span></div><a href="tel:112">Appeler le 112</a></aside>
    <div className="fw-incident-card-grid">{safetyGroups.map((group) => <PanelCard key={group.title} title={group.title} icon={group.icon}><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></PanelCard>)}</div>
  </div>;
}

function Metric({ label, value, quality }: { readonly label: string; readonly value: string; readonly quality: 'Observée' | 'Estimée' | 'Non disponible' }) {
  return <article className="fw-incident-metric"><span>{label}</span><strong>{value}</strong><small>{quality}</small></article>;
}

function StatisticsView({ view }: { readonly view: PublicIncidentView | null }) {
  const current = view?.episodes.find((episode) => episode.is_current) ?? view?.episodes[0];
  const duration = current && Number.isFinite(Date.parse(current.started_at))
    ? `${Math.max(1, Math.round((Date.now() - Date.parse(current.started_at)) / 3_600_000))} h`
    : '—';
  return <div className="fw-incident-metrics">
    <Metric label="Durée de l’épisode" value={duration} quality={current ? 'Observée' : 'Non disponible'} />
    <Metric label="Nombre d’épisodes" value={view ? String(view.episodes.length) : '—'} quality={view ? 'Observée' : 'Non disponible'} />
    <Metric label="Surface" value={current?.estimated_area_ha !== null && current?.estimated_area_ha !== undefined ? `${current.estimated_area_ha.toLocaleString('fr-FR')} ha` : '—'} quality={current?.estimated_area_ha !== null && current?.estimated_area_ha !== undefined ? 'Estimée' : 'Non disponible'} />
    <Metric label="Zones marquées" value={view ? String(view.evidence_projections.length) : '—'} quality={view ? 'Observée' : 'Non disponible'} />
    <Metric label="Images validées" value="—" quality="Non disponible" />
    <Metric label="Mises à jour publiques" value={view ? String(view.timeline.length) : '—'} quality={view ? 'Observée' : 'Non disponible'} />
    <Metric label="Version de la représentation" value={view?.model.version ? `v${view.model.version}` : '—'} quality={view?.model.version ? 'Observée' : 'Non disponible'} />
    <Metric label="Dernier changement" value={formatDate(view?.freshness_at ?? null)} quality={view ? 'Observée' : 'Non disponible'} />
  </div>;
}

function ViewerView({ view, summary, lowData }: { readonly view: PublicIncidentView | null; readonly summary: ViewerManifestSummary; readonly lowData: boolean }) {
  if (lowData) return <section className="fw-viewer-fallback"><PublicIcon name="data" size={32} /><h2>Mode faible connexion actif</h2><p>La 3D n’est pas chargée automatiquement. Les informations, gestes et statistiques restent accessibles.</p></section>;
  if (summary.modelState !== 'available' || !summary.asset) return <section className="fw-viewer-fallback"><PublicIcon name="map" size={32} /><h2>Représentation 3D indisponible</h2><p>La fiche reste utilisable sans le modèle. Dernière information disponible : {formatDate(view?.freshness_at ?? summary.freshness.incident_at)}.</p></section>;
  return <div className="fw-incident-viewer">
    <div className="fw-viewer-distance" aria-label="Distance de la représentation"><button type="button" className="is-active">Zone proche</button><button type="button">Secteur local</button><button type="button">Vue étendue</button></div>
    <IncidentGlbViewer assetUrl={summary.asset.url} version={summary.asset.version} sha256={summary.asset.sha256} frame={summary.frame} terrainSourceYear={summary.freshness.terrain_source_year} observations={view?.observations ?? []} />
    <footer><span>Représentation : {formatDate(summary.freshness.generated_at)}</span><span>Nord et échelle visibles dans le viewer</span></footer>
  </div>;
}

function SidePanelView({ panel, view, onClose }: { readonly panel: Exclude<SidePanel, null>; readonly view: PublicIncidentView | null; readonly onClose: () => void }) {
  const titles = { media: 'Images géolocalisées', comments: 'Commentaires de la communauté', episodes: 'Épisodes de l’incident' };
  return <aside className="fw-incident-side-panel" aria-label={titles[panel]}><header><h2>{titles[panel]}</h2><button type="button" onClick={onClose} aria-label="Fermer le panneau"><PublicIcon name="close" size={21} /></button></header>
    {panel === 'media' ? <><p>Seuls les marqueurs visibles et validés dans la zone affichée sont listés. Il ne s’agit pas d’une galerie.</p>{view?.evidence_projections.length ? <ul>{view.evidence_projections.map((item) => <li key={item.projection_id}><strong>{item.label}</strong><span>{formatDate(item.observed_at)} · position {item.kind === 'validated_marker' ? 'validée' : 'généralisée'}</span></li>)}</ul> : <p>Aucune image utilisateur autorisée à la publication dans cette vue.</p>}</> : null}
    {panel === 'comments' ? <><p>Les commentaires sont secondaires, modérés et ne modifient jamais les informations publiées.</p><div className="fw-panel-empty">Aucun commentaire public n’est disponible pour cet incident.</div></> : null}
    {panel === 'episodes' ? view?.episodes.length ? <ol>{view.episodes.map((item) => <li key={item.episode_id}><strong>Épisode {item.ordinal} · {item.status}</strong><span>{formatDate(item.started_at)} à {formatDate(item.ended_at)}</span></li>)}</ol> : <p>Aucun épisode détaillé n’est publié.</p> : null}
  </aside>;
}

export function PublicIncidentRealPage({ summary, checkedAt, stale, refreshing, onRefresh, detailRequest }: {
  readonly summary: ViewerManifestSummary;
  readonly checkedAt: string;
  readonly stale: boolean;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly detailRequest?: Promise<{ readonly view: PublicIncidentView | null; readonly error: unknown | null }>;
}) {
  const [active, setActive] = useState<MainView>('three-d');
  const [panel, setPanel] = useState<SidePanel>(null);
  const [view, setView] = useState<PublicIncidentView | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [lowData, setLowData] = useState(() => localStorage.getItem('firewarning-low-data') === 'true');
  const [shared, setShared] = useState(false);

  useEffect(() => {
    let alive = true;
    const request = detailRequest ?? loadPublicIncidentView(summary.fireId).then((loaded) => ({ view: loaded, error: null })).catch((error: unknown) => ({ view: null, error }));
    void request.then((result) => { if (!alive) return; setView(result.view); setDetailError(Boolean(result.error)); });
    return () => { alive = false; };
  }, [detailRequest, summary.fireId]);

  const currentFreshness = freshness(view?.freshness_at ?? summary.freshness.incident_at);
  const closed = summary.statusCode === 'CLOSED' || summary.statusCode === 'EXTINGUISHED';
  const title = view?.canonical_name ?? `Incendie ${summary.fireId}`;
  const toggleLowData = () => setLowData((value) => { localStorage.setItem('firewarning-low-data', String(!value)); return !value; });
  const share = async () => {
    const canonical = `${window.location.origin}/incendie/${summary.fireId}`;
    try { await navigator.clipboard.writeText(canonical); setShared(true); window.setTimeout(() => setShared(false), 2_000); } catch { window.location.hash = 'partage-indisponible'; }
  };

  return <article className={`fw-incident-page ${lowData ? 'is-low-data' : ''}`}>
    <header className="fw-incident-heading">
      <div className="fw-page"><a href="/incendies" className="fw-incident-back"><PublicIcon name="arrow-left" size={18} /> Incendies</a><div className="fw-incident-title-row"><div><span className={`fw-incident-status ${closed ? 'is-closed' : ''}`}>{statusLabels[summary.statusCode]}</span><h1>{title}</h1><p>{summary.fireId}{view?.location ? ` · ${view.location.coordinates[1].toFixed(2)}°, ${view.location.coordinates[0].toFixed(2)}°` : ''}</p></div><div className="fw-incident-heading-actions"><button type="button" onClick={() => void share()}><PublicIcon name="share" size={18} />{shared ? 'Lien copié' : 'Partager'}</button><button type="button" onClick={toggleLowData}><PublicIcon name="data" size={18} />{lowData ? 'Activer la 3D' : 'Faible connexion'}</button></div></div></div>
    </header>

    <div className="fw-page fw-incident-summary">
      <div><span>Dernière évolution publiée</span><strong>{view?.public_note ?? view?.facts[0] ?? statusLabels[summary.statusCode]}</strong></div>
      <div className={currentFreshness.stale || stale ? 'is-stale' : ''}><PublicIcon name="clock" size={20} /><span>{currentFreshness.label}<small>Vérifié le {formatDate(checkedAt)}</small></span></div>
      {(currentFreshness.stale || stale) ? <p role="alert"><PublicIcon name="warning" size={19} />Ces données sont anciennes et doivent être interprétées avec prudence.</p> : null}
      {detailError ? <p role="alert"><PublicIcon name="info" size={19} />Certaines informations détaillées sont indisponibles. <button type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Actualisation…' : 'Réessayer'}</button></p> : null}
    </div>

    <nav className="fw-page fw-incident-tabs" aria-label="Vues de la fiche incident">{mainViews.map((item) => <button key={item.id} type="button" className={active === item.id ? 'is-active' : ''} aria-current={active === item.id ? 'page' : undefined} onClick={() => setActive(item.id)}><PublicIcon name={item.icon} size={19} />{item.label}</button>)}</nav>

    <main className="fw-page fw-incident-main">
      {active === 'three-d' ? <ViewerView view={view} summary={summary} lowData={lowData} /> : null}
      {active === 'information' ? <InformationView view={view} /> : null}
      {active === 'safety' ? <SafetyView /> : null}
      {active === 'statistics' ? <StatisticsView view={view} /> : null}
    </main>

    <section className="fw-page fw-incident-secondary" aria-label="Accès complémentaires">
      <button type="button" onClick={() => setPanel('media')}><PublicIcon name="image" size={20} />Images géolocalisées</button>
      <button type="button" onClick={() => setPanel('comments')}><PublicIcon name="message" size={20} />Commentaires</button>
      <button type="button" onClick={() => setPanel('episodes')}><PublicIcon name="calendar" size={20} />Épisodes</button>
      <a href={`/incendie/${summary.fireId}/ajouter-preuve`}><PublicIcon name="plus" size={20} />Ajouter une preuve</a>
      <a href={`/incendie/${summary.fireId}/signaler-erreur`}><PublicIcon name="warning" size={20} />Signaler une erreur</a>
    </section>

    {panel ? <SidePanelView panel={panel} view={view} onClose={() => setPanel(null)} /> : null}
  </article>;
}
