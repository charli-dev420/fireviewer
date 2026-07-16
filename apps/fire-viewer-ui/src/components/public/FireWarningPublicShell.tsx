import { useEffect, useState, type ReactNode } from 'react';
import { PublicIcon } from './PublicIcon';
import './firewarning-public.css';

export type PublicSection =
  | 'home' | 'incidents' | 'report' | 'account' | 'settings' | 'operation'
  | 'privacy' | 'accessibility' | 'legal' | 'about' | 'incident';

interface PublicSiteShellProps {
  readonly children: ReactNode;
  readonly section: PublicSection;
}

export function FireWarningBrand({
  inverse = false,
  href = '/',
  label = 'FireWarning, accueil',
}: {
  readonly inverse?: boolean;
  readonly href?: string;
  readonly label?: string;
}) {
  return (
    <a className={`fw-brand ${inverse ? 'fw-brand--inverse' : ''}`} href={href} aria-label={label}>
      <svg className="fw-brand__mark" viewBox="0 0 38 46" aria-hidden="true">
        <path d="M19 2.8 34 8v11.1c0 10.4-5.1 18.1-15 24.1C9.1 37.2 4 29.5 4 19.1V8Z" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
        <path d="M19.1 10.1c.8 4.5-2.8 5.5-2.8 9.1 0 1.7.9 3 2.4 3.8-.2-2.3 1.4-3.6 2.7-5.4.5 3 3.3 4.1 3.3 7.7 0 4.3-2.6 7.3-6 8.7-3.8-1.7-6.4-5-6.4-9 0-5.5 4.6-8.3 6.8-14.9Z" fill="currentColor" />
      </svg>
      <span className="fw-brand__wordmark"><strong>Fire</strong>Warning</span>
    </a>
  );
}

function PublicHeader({ section }: { readonly section: PublicSection }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const links = (
    <>
      <a href="/incendies" aria-current={section === 'incidents' ? 'page' : undefined}>Incendies en cours</a>
      <a href="/signaler" aria-current={section === 'report' ? 'page' : undefined}>Signaler un feu</a>
      <a href="/fonctionnement" aria-current={section === 'operation' ? 'page' : undefined}>Comment ça fonctionne&nbsp;?</a>
      <a href="/a-propos" aria-current={section === 'about' ? 'page' : undefined}>À propos <PublicIcon name="chevron-down" size={14} /></a>
    </>
  );

  const mobileLinks = (
    <>
      <a href="/" aria-current={section === 'home' ? 'page' : undefined}>Accueil <PublicIcon name="chevron-right" size={16} /></a>
      <a href="/incendies" aria-current={section === 'incidents' ? 'page' : undefined}>Incendies en cours <PublicIcon name="chevron-right" size={16} /></a>
      <a href="/signaler" aria-current={section === 'report' ? 'page' : undefined}>Signaler un feu <PublicIcon name="chevron-right" size={16} /></a>
      <a href="/fonctionnement" aria-current={section === 'operation' ? 'page' : undefined}>Comment ça fonctionne ? <PublicIcon name="chevron-right" size={16} /></a>
      <a href="/compte" aria-current={section === 'account' ? 'page' : undefined}>Compte <PublicIcon name="chevron-right" size={16} /></a>
      <a href="/reglages" aria-current={section === 'settings' ? 'page' : undefined}>Réglages <PublicIcon name="chevron-right" size={16} /></a>
      <a href="/accessibilite" aria-current={section === 'accessibility' ? 'page' : undefined}>Accessibilité <PublicIcon name="chevron-right" size={16} /></a>
      <a href="/confidentialite" aria-current={section === 'privacy' ? 'page' : undefined}>Confidentialité <PublicIcon name="chevron-right" size={16} /></a>
      <a href="/mentions-legales" aria-current={section === 'legal' ? 'page' : undefined}>Mentions légales <PublicIcon name="chevron-right" size={16} /></a>
    </>
  );

  return (
    <header className="fw-header">
      <div className="fw-header__inner">
        <FireWarningBrand />
        <nav className="fw-header__desktop-nav" aria-label="Navigation principale">
          {links}
          <span className="fw-header__divider" aria-hidden="true" />
          <a className="fw-header__language" href="/reglages"><PublicIcon name="globe" size={18} />FR <PublicIcon name="chevron-down" size={13} /></a>
          <a className="fw-button fw-button--outline" href="/compte?mode=connexion">Se connecter</a>
          <a className="fw-button fw-button--primary" href="/compte?mode=creation">Créer un compte</a>
        </nav>
        <button className="fw-header__menu-button" type="button" aria-expanded={open} aria-controls="fw-mobile-menu" aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'} onClick={() => setOpen((value) => !value)}>
          <PublicIcon name={open ? 'close' : 'menu'} size={27} />
        </button>
      </div>
      <div id="fw-mobile-menu" className={`fw-mobile-menu ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <nav aria-label="Navigation mobile" onClick={() => setOpen(false)}>{mobileLinks}</nav>
        <div className="fw-mobile-menu__actions">
          <a className="fw-button fw-button--outline" href="/compte?mode=connexion">Se connecter</a>
          <a className="fw-button fw-button--primary" href="/compte?mode=creation">Créer un compte</a>
          <a href="/reglages"><PublicIcon name="globe" size={18} /> Français (FR)</a>
        </div>
      </div>
    </header>
  );
}

function PublicFooter() {
  const [open, setOpen] = useState(false);
  return (
    <footer className={`fw-footer ${open ? 'is-open' : ''}`}>
      <div className="fw-footer__inner">
        <div className="fw-footer__brand-row">
          <FireWarningBrand inverse />
          <button type="button" aria-label="Afficher les liens du pied de page" aria-expanded={open} onClick={() => setOpen((value) => !value)}><PublicIcon name="chevron-down" size={21} /></button>
        </div>
        <p className="fw-footer__description">Un service public, libre et indépendant.<br />Informations communiquées à titre indicatif.</p>
        <nav className="fw-footer__links" aria-label="Liens de pied de page">
          <a href="/a-propos">À propos</a>
          <a href="/fonctionnement">Comment ça fonctionne&nbsp;?</a>
          <a href="/confidentialite">Confidentialité</a>
          <a href="/mentions-legales">Mentions légales</a>
          <a href="/accessibilite">Accessibilité</a>
          <a href="https://github.com/" rel="noreferrer">Code source <PublicIcon name="external" size={13} /></a>
        </nav>
        <p className="fw-footer__copyright">© 2026 FireWarning · Projet libre et communautaire</p>
      </div>
    </footer>
  );
}

export function PublicSiteShell({ children, section }: PublicSiteShellProps) {
  return (
    <div className="public-site fw-public">
      <a className="fw-skip-link" href="#public-main-content">Aller au contenu principal</a>
      <PublicHeader section={section} />
      <main id="public-main-content">{children}</main>
      <PublicFooter />
    </div>
  );
}
