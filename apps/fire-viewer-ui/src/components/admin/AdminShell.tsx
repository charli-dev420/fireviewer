import { FormEvent, MouseEvent, useState, type ReactNode } from 'react';
import { FireWarningBrand } from '../public/FireWarningPublicShell';
import { PublicIcon } from '../public/PublicIcon';
import {
  ADMIN_OPERATIONS,
  ADMIN_ZONE_TOOLS,
  resolveActiveAdminPath,
  type AdminOperationDefinition,
} from './operations/adminOperations';
import './AdminShell.css';

interface AdminShellProps {
  readonly children: ReactNode;
  readonly onSignOut?: () => void;
}

const PRIMARY_OPERATION_IDS = ['dashboard', 'incidents', 'work-queue', 'system'] as const;

function primaryActivePath(pathname: string, resolvedPath: string | null): string | null {
  if (/^\/admin\/(?:zones|publications|rapprochement-spatial|signalements)(?:\/|$)/.test(pathname)) return '/admin/validation';
  if (/^\/admin\/(?:audit|roles|configuration)(?:\/|$)/.test(pathname)) return '/admin/systeme';
  if (pathname === '/admin/carte-operationnelle') return '/admin/incidents';
  return resolvedPath;
}

function navigateWithinAdmin(destination: string): void {
  const url = new URL(destination, window.location.href);
  window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function AdminNavigationLink({ item, active }: { readonly item: AdminOperationDefinition; readonly active: boolean }) {
  return (
    <a className="admin-operation-shell__nav-link" href={item.href} aria-current={active ? 'page' : undefined}>
      <PublicIcon name={item.icon} size={20} />
      <span>{item.label}</span>
    </a>
  );
}

export function AdminShell({ children, onSignOut }: AdminShellProps) {
  const currentPath = typeof window === 'undefined' ? '' : window.location.pathname;
  const activePath = primaryActivePath(currentPath, resolveActiveAdminPath(currentPath));
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const operations = [...ADMIN_OPERATIONS, ...ADMIN_ZONE_TOOLS];
  const primaryOperations = PRIMARY_OPERATION_IDS.map((id) => operations.find((item) => item.id === id)).filter((item): item is AdminOperationDefinition => Boolean(item));

  const followAdminLink = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || !(event.target instanceof Element)
    ) return;
    const anchor = event.target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !/^\/admin(?:\/|$)/.test(url.pathname)) return;
    if (
      url.pathname === window.location.pathname
      && url.search === window.location.search
      && url.hash
    ) return;
    event.preventDefault();
    navigateWithinAdmin(url.href);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = search.trim().toUpperCase();
    if (!value) return;
    const destination = /^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(value)
      ? `/admin/incidents/${encodeURIComponent(value)}`
      : `/admin/incidents?q=${encodeURIComponent(search.trim())}`;
    navigateWithinAdmin(destination);
  };

  return (
    <div
      className={`admin-operation-shell ${activePath === '/admin/carte-operationnelle' ? 'admin-operation-shell--map' : ''}`}
      onClick={followAdminLink}
    >
      <a className="skip-link" href="#admin-main-content">Aller au contenu administrateur</a>
      <header className="admin-operation-shell__topbar">
        <button className="admin-operation-shell__menu" type="button" aria-label="Ouvrir la navigation administrateur" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <PublicIcon name={menuOpen ? 'close' : 'menu'} size={25} />
        </button>
        <FireWarningBrand href="/admin" label="FireWarning, tableau de bord administrateur" />
        <form className="admin-operation-shell__search" role="search" onSubmit={submitSearch}>
          <PublicIcon name="search" size={19} />
          <label className="sr-only" htmlFor="admin-global-search">Rechercher dans l’administration</label>
          <input id="admin-global-search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Rechercher un incident" />
          <button type="submit">Rechercher</button>
        </form>
        <nav className="admin-operation-shell__account" aria-label="Session administrateur">
          <div className="admin-operation-shell__profile">
            <PublicIcon name="user" size={20} />
            <span><strong>Administration locale</strong><small>Session vérifiée</small></span>
          </div>
          {onSignOut ? <button className="admin-operation-shell__signout" type="button" onClick={onSignOut}>Se déconnecter</button> : null}
          <a className="admin-operation-shell__public-link" href="/" target="_blank" rel="noreferrer">Voir le site public <PublicIcon name="external" size={15} /></a>
        </nav>
      </header>

      <div className="admin-operation-shell__body">
        <aside className={`admin-operation-shell__sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Navigation des opérations">
          <nav onClick={() => setMenuOpen(false)}>
            <section className="admin-operation-shell__nav-group" aria-labelledby="admin-nav-essential">
              <h2 id="admin-nav-essential">Navigation</h2>
              <div className="admin-operation-shell__nav-list">
                {primaryOperations.map((item) => <AdminNavigationLink key={item.id} item={item} active={activePath === item.href} />)}
              </div>
            </section>
          </nav>
          <div className="admin-operation-shell__admin-mark"><PublicIcon name="shield" size={21} /><strong>ADMIN</strong></div>
          <p className="admin-operation-shell__audit-note">Les actions sensibles sont enregistrées automatiquement.</p>
        </aside>

        <main id="admin-main-content" className="admin-operation-shell__content">{children}</main>
      </div>
      {menuOpen ? <button className="admin-operation-shell__backdrop" type="button" aria-label="Fermer la navigation" onClick={() => setMenuOpen(false)} /> : null}
    </div>
  );
}
