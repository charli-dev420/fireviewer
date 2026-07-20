import { useEffect, useMemo, useState } from 'react';
import incidentsHero from '../../assets/public/fire-hero-incidents.jpg';
import { loadRecentPublicIncidents, publicDiscoveryOrigin, searchPublicIncidents, type PublicIncidentIndexItem } from '../../lib/publicDiscovery';
import { PublicIcon } from './PublicIcon';

type ListState = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly items: readonly PublicIncidentIndexItem[] } | { readonly kind: 'error'; readonly message: string; readonly cached: readonly PublicIncidentIndexItem[] };

function initialParams() { return new URL(window.location.href).searchParams; }
function initialCoordinates(params: URLSearchParams): { latitude: number; longitude: number } | undefined {
  const latitudeValue = params.get('latitude');
  const longitudeValue = params.get('longitude');
  if (latitudeValue === null || latitudeValue.trim() === '' || longitudeValue === null || longitudeValue.trim() === '') return undefined;

  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
}
function isClosed(status: string): boolean { return /closed|clôtur|éteint|extinguished|archiv/i.test(status); }
function humanDate(value: string | null): string { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(value)) : 'Non communiquée'; }
function age(value: string | null): string { if (!value || !Number.isFinite(Date.parse(value))) return 'Fraîcheur inconnue'; const minutes = Math.max(1, Math.round((Date.now() - Date.parse(value)) / 60_000)); return minutes < 60 ? `Il y a ${minutes} min` : minutes < 1_440 ? `Il y a ${Math.round(minutes / 60)} h` : `Il y a ${Math.round(minutes / 1_440)} j`; }

export function FireWarningIncidentsPage() {
  const params = useMemo(initialParams, []);
  const firstQuery = params.get('q')?.trim() ?? '';
  const [query, setQuery] = useState(firstQuery);
  const [tab, setTab] = useState<'active' | 'archive'>(params.get('vue') === 'archives' ? 'archive' : 'active');
  const [statusFilter, setStatusFilter] = useState('all');
  const [freshnessFilter, setFreshnessFilter] = useState('all');
  const [lowData, setLowData] = useState(() => localStorage.getItem('firewarning-low-data') === 'true');
  const [state, setState] = useState<ListState>({ kind: 'loading' });

  async function load(value = query, coordinates?: { latitude: number; longitude: number }) {
    const previous = state.kind === 'ready' ? state.items : state.kind === 'error' ? state.cached : [];
    setState({ kind: 'loading' });
    try {
      const result = coordinates
        ? await searchPublicIncidents({ ...coordinates, radiusKm: 50 })
        : value.trim() ? await searchPublicIncidents({ q: value.trim() }) : await loadRecentPublicIncidents();
      setState({ kind: 'ready', items: result.incidents });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'La liste publique est indisponible.', cached: previous });
    }
  }

  useEffect(() => {
    if (!publicDiscoveryOrigin()) { setState({ kind: 'error', message: 'La connexion à l’API publique n’est pas configurée.', cached: [] }); return; }
    void load(firstQuery, initialCoordinates(params));
  // Les paramètres initiaux ne changent pas sans navigation complète.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sourceItems = state.kind === 'ready' ? state.items : state.kind === 'error' ? state.cached : [];
  const items = sourceItems.filter((item) => {
    if (tab === 'archive' ? !isClosed(item.status) : isClosed(item.status)) return false;
    if (statusFilter !== 'all' && !item.status.toLowerCase().includes(statusFilter)) return false;
    if (freshnessFilter !== 'all') {
      if (!item.last_observed_at) return false;
      const hours = (Date.now() - Date.parse(item.last_observed_at)) / 3_600_000;
      if (hours > Number(freshnessFilter)) return false;
    }
    return true;
  });
  const latest = sourceItems.map((item) => item.last_observed_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  const useLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => void load('', { latitude: coords.latitude, longitude: coords.longitude }),
      () => setState((current) => ({ kind: 'error', message: 'La localisation a été refusée ou n’est pas disponible.', cached: current.kind === 'ready' ? current.items : [] })),
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 300_000 },
    );
  };

  return <>
    <section className="fw-page-hero fw-page-hero--incidents" style={{ '--fw-page-hero': `url(${incidentsHero})` } as React.CSSProperties}><div className="fw-page"><div className="fw-page-hero__copy"><h1>{tab === 'archive' ? 'Incendies archivés' : 'Incendies en cours'}</h1><p>{tab === 'archive' ? 'Retrouvez les événements clos sans les mélanger aux incendies actuellement suivis.' : 'Trouvez rapidement un incendie suivi et accédez à sa page publique permanente.'}</p></div></div></section>
    <div className={`fw-page fw-standard-page fw-incidents-page ${lowData ? 'is-low-data' : ''}`}>
      <div className="fw-incidents-meta"><span>Dernière actualisation générale : <strong>{humanDate(latest)}</strong></span><button type="button" onClick={() => setLowData((value) => { localStorage.setItem('firewarning-low-data', String(!value)); return !value; })}><PublicIcon name="data" size={17} />{lowData ? 'Mode standard' : 'Mode faible connexion'}</button></div>
      <p className="fw-incidents-warning"><PublicIcon name="warning" size={19} />L’absence d’incendie publié ne garantit pas l’absence de danger. En cas d’urgence, appelez le 18 ou le 112.</p>

      <div className="fw-tabs" role="tablist" aria-label="État des incendies"><button type="button" role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')}>En cours</button><button type="button" role="tab" aria-selected={tab === 'archive'} onClick={() => setTab('archive')}>Archives</button></div>
      <form className="fw-search" role="search" onSubmit={(event) => { event.preventDefault(); void load(query); }}><PublicIcon name="search" size={21} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Rechercher un incendie" placeholder={tab === 'archive' ? 'Lieu, année ou identifiant' : 'Commune, massif, département ou identifiant'} />{query ? <button type="button" onClick={() => { setQuery(''); void load(''); }} aria-label="Effacer la recherche"><PublicIcon name="close" size={18} /></button> : null}<button type="submit" aria-label="Lancer la recherche"><PublicIcon name="arrow" size={19} /></button></form>
      <div className="fw-incidents-tools"><button type="button" onClick={useLocation}><PublicIcon name="crosshair" size={18} />Utiliser ma position</button><label>État<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Tous</option><option value="active">Actif</option><option value="monitor">Sous surveillance</option><option value="closed">Clos</option></select></label><label>Fraîcheur<select value={freshnessFilter} onChange={(event) => setFreshnessFilter(event.target.value)}><option value="all">Toutes</option><option value="1">Moins d’une heure</option><option value="24">Moins de 24 heures</option><option value="168">Moins de 7 jours</option></select></label></div>

      {state.kind === 'loading' ? <div className="fw-list-state" role="status">Chargement des incendies publiés…</div> : null}
      {state.kind === 'error' ? <div className="fw-list-state" role="alert"><PublicIcon name="info" size={22} /><span><strong>Liste temporairement indisponible</strong>{state.message}{state.cached.length ? ' Les dernières données chargées restent affichées.' : ''}</span><button type="button" onClick={() => void load()}>Réessayer</button></div> : null}
      {state.kind !== 'loading' && items.length === 0 ? <div className="fw-list-state fw-list-state--empty" role="status"><PublicIcon name="info" size={22} /><span><strong>Aucun incendie publié ne correspond à cette recherche.</strong>Modifiez la recherche, consultez l’autre rubrique ou transmettez un nouveau signalement.</span><a href="/signaler">Signaler un départ de feu</a></div> : null}
      {items.length ? <ul className="fw-incident-cards">{items.map((item) => <li key={item.fire_id}><article><div className="fw-incident-card-status"><span>{item.status}</span><small>{item.verification === 'verified' ? 'Information validée' : 'Information corroborée'}</small></div><div><small>{item.fire_id}</small><h2>{item.canonical_name}</h2><p>{tab === 'archive' ? `Dernière activité : ${humanDate(item.last_observed_at)}` : `Dernière évolution publiée · ${age(item.last_observed_at)}`}</p></div><div className="fw-incident-card-actions"><span><PublicIcon name="clock" size={16} />{humanDate(item.last_observed_at)}</span><a href={`/incendie/${item.fire_id}`}>{tab === 'archive' ? 'Consulter l’archive' : 'Voir la page de l’incendie'}<PublicIcon name="arrow" size={16} /></a></div></article></li>)}</ul> : null}
    </div>
  </>;
}
