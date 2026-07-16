import { FormEvent, useState, type ReactNode } from 'react';
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

const GROUP_LABELS: Readonly<Record<AdminOperationDefinition['group'], string>> = {
  pilotage: 'Pilotage',
  operations: 'Opérations',
  production: 'Production 3D',
  governance: 'Gouvernance',
};

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
  const activePath = resolveActiveAdminPath(currentPath);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const operations = [...ADMIN_OPERATIONS, ...ADMIN_ZONE_TOOLS];

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = search.trim().toUpperCase();
    if (!value) return;
    const destination = /^FR-[0-9A-Z]{2,3}-[0-9]{5}$/.test(value)
      ? `/admin/incidents/${encodeURIComponent(value)}`
      : `/admin/incidents?q=${encodeURIComponent(search.trim())}`;
    window.location.assign(destination);
  };

  return (
    <div className={`admin-operation-shell ${activePath === '/admin/carte-operationnelle' ? 'admin-operation-shell--map' : ''}`}>
      <a className="skip-link" href="#admin-main-content">Aller au contenu administrateur</a>
      <header className="admin-operation-shell__topbar">
        <button className="admin-operation-shell__menu" type="button" aria-label="Ouvrir la navigation administrateur" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <PublicIcon name={menuOpen ? 'close' : 'menu'} size={25} />
        </button>
        <FireWarningBrand href="/admin" label="FireWarning, tableau de bord administrateur" />
        <form className="admin-operation-shell__search" role="search" onSubmit={submitSearch}>
          <PublicIcon name="search" size={19} />
          <label className="sr-only" htmlFor="admin-global-search">Rechercher dans l’administration</label>
          <input id="admin-global-search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Rechercher un incident, une contribution ou un identifiant" />
          <button type="submit">Rechercher</button>
        </form>
        <nav className="admin-operation-shell__account" aria-label="Session administrateur">
          <a className="admin-operation-shell__notification" href="/admin/file-de-traitement" aria-label="Ouvrir la file de traitement">
            <PublicIcon name="bell" size={23} />
          </a>
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
            {(['pilotage', 'operations', 'production', 'governance'] as const).map((group) => {
              const items = operations.filter((item) => item.group === group);
              if (!items.length) return null;
              return (
                <section className="admin-operation-shell__nav-group" key={group} aria-labelledby={`admin-nav-${group}`}>
                  <h2 id={`admin-nav-${group}`}>{GROUP_LABELS[group]}</h2>
                  <div className="admin-operation-shell__nav-list">
                    {items.map((item) => <AdminNavigationLink key={item.id} item={item} active={activePath === item.href} />)}
                  </div>
                </section>
              );
            })}
          </nav>
          <div className="admin-operation-shell__admin-mark"><PublicIcon name="shield" size={21} /><strong>ADMIN</strong></div>
          <p className="admin-operation-shell__audit-note">Vue interne · non publique<br />Toute action sensible est auditée.</p>
        </aside>

        <main id="admin-main-content" className="admin-operation-shell__content">{children}</main>
      </div>
      {menuOpen ? <button className="admin-operation-shell__backdrop" type="button" aria-label="Fermer la navigation" onClick={() => setMenuOpen(false)} /> : null}
    </div>
  );
}
