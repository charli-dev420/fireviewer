import type { ReactNode } from 'react';

interface AdminShellProps {
  children: ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-main-content">Aller au contenu administrateur</a>
      <header className="admin-shell__header">
        <div>
          <span className="eyebrow">Administration privée</span>
          <h1>Fire-Viewer Admin</h1>
          <p>Gestion MVP des zones, révisions et publications.</p>
        </div>
        <nav className="admin-shell__nav" aria-label="Navigation administrateur">
          <a href="/admin/zones">Zones</a>
          <a href="/admin/zones/nouvelle">Nouvelle zone</a>
          <a href="/admin/publications">Publications</a>
        </nav>
      </header>
      <main id="admin-main-content" className="admin-shell__content">
        {children}
      </main>
    </div>
  );
}
