import { useEffect, useState, type ReactNode } from 'react';
import aboutHero from '../../assets/public/fire-hero-about.jpg';
import accessibilityHero from '../../assets/public/fire-hero-accessibility.jpg';
import accountHero from '../../assets/public/fire-hero-account.jpg';
import incidentsHero from '../../assets/public/fire-hero-incidents.jpg';
import operationHero from '../../assets/public/fire-hero-information.jpg';
import legalHero from '../../assets/public/fire-hero-legal.jpg';
import privacyHero from '../../assets/public/fire-hero-privacy.jpg';
import reportHero from '../../assets/public/fire-hero-report.jpg';
import settingsHero from '../../assets/public/fire-hero-settings.jpg';
import { PublicIcon, type PublicIconName } from './PublicIcon';
import './firewarning-pages.css';

export type PageVisual = 'account' | 'settings' | 'community' | 'privacy' | 'accessibility' | 'legal' | 'about' | 'incidents' | 'report';

const pageHeroByVisual: Readonly<Record<PageVisual, string>> = {
  accessibility: accessibilityHero,
  account: accountHero,
  about: aboutHero,
  community: operationHero,
  incidents: incidentsHero,
  legal: legalHero,
  privacy: privacyHero,
  report: reportHero,
  settings: settingsHero,
};

export function PageHero({ title, description, visual, children }: { readonly title: string; readonly description: string; readonly visual: PageVisual; readonly children?: ReactNode }) {
  return (
    <section className={`fw-page-hero fw-page-hero--${visual}`} style={{ '--fw-page-hero': `url(${pageHeroByVisual[visual]})` } as React.CSSProperties}>
      <div className="fw-page"><div className="fw-page-hero__copy">{children}<h1>{title}</h1><p>{description}</p></div></div>
    </section>
  );
}

function ActionCard({ icon, title, text, href, action, prominent = false }: { readonly icon: PublicIconName; readonly title: string; readonly text: string; readonly href: string; readonly action: string; readonly prominent?: boolean }) {
  return (
    <article className={`fw-action-card ${prominent ? 'fw-action-card--prominent' : ''}`}>
      <div className="fw-action-card__icon"><PublicIcon name={icon} size={29} /></div>
      <div><h2>{title}</h2><p>{text}</p><a className={prominent ? 'fw-button fw-button--primary' : ''} href={href}>{action}<PublicIcon name={prominent ? 'arrow' : 'chevron-right'} size={16} /></a></div>
      <PublicIcon className="fw-action-card__chevron" name="chevron-right" size={20} />
    </article>
  );
}

export function AccountPage() {
  return (
    <>
      <PageHero visual="account" title="Compte" description="Gérez vos informations, suivez vos contributions et configurez vos préférences. Un compte n’est pas nécessaire pour consulter les incidents en cours." />
      <div className="fw-page fw-standard-page">
        <section className="fw-account-grid" aria-label="Services du compte">
          <ActionCard prominent icon="user" title="Créer un compte" text="Créez un compte gratuit pour suivre vos signalements, gérer vos préférences et recevoir des notifications adaptées." href="/compte/creation" action="Créer un compte" />
          <ActionCard prominent icon="log-in" title="Se connecter" text="Déjà inscrit ? Connectez-vous pour accéder à votre espace personnel et à l’historique de vos activités." href="/compte/connexion" action="Se connecter" />
          <ActionCard icon="map" title="Mes signalements" text="Consultez l’historique de vos signalements, leur statut et les réponses de l’équipe de modération." href="/compte/signalements" action="Voir mes signalements" />
          <ActionCard icon="image" title="Mes images envoyées" text="Retrouvez les images que vous avez partagées et leur état de traitement." href="/compte/images" action="Voir mes images" />
          <ActionCard icon="bell" title="Préférences de notification" text="Choisissez comment et quand recevoir les alertes incendie et les mises à jour importantes." href="/reglages#notifications" action="Gérer mes préférences" />
          <ActionCard icon="shield" title="Consentements et données" text="Consultez et gérez vos consentements, vos données personnelles et vos droits." href="/confidentialite#droits" action="Gérer mes données" />
        </section>
        <aside className="fw-inline-notice"><PublicIcon name="info" size={23} /><p><strong>Un compte pour mieux contribuer, mais pas indispensable.</strong><span>Vous pouvez consulter les incidents en cours et les informations d’urgence sans créer de compte.</span></p></aside>
      </div>
    </>
  );
}

function Toggle({ checked, onChange, label }: { readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly label: string }) {
  return <button type="button" className={`fw-toggle ${checked ? 'is-on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}

function SettingRow({ icon, title, description, children, href }: { readonly icon: PublicIconName; readonly title: string; readonly description?: string; readonly children?: ReactNode; readonly href?: string }) {
  const content = <><PublicIcon name={icon} size={24} /><span><strong>{title}</strong>{description ? <small>{description}</small> : null}</span><span className="fw-setting-row__control">{children ?? <PublicIcon name="chevron-right" size={18} />}</span></>;
  return href ? <a className="fw-setting-row" href={href}>{content}</a> : <div className="fw-setting-row">{content}</div>;
}

export function SettingsPage() {
  const [alerts, setAlerts] = useState(true);
  const [email, setEmail] = useState(false);
  const [sms, setSms] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [textSize, setTextSize] = useState<'small' | 'medium' | 'large'>('medium');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('fw:settings');
      if (stored) {
        const value = JSON.parse(stored) as { alerts?: boolean; email?: boolean; sms?: boolean; saveData?: boolean; textSize?: 'small' | 'medium' | 'large' };
        setAlerts(value.alerts ?? true); setEmail(value.email ?? false); setSms(value.sms ?? false); setSaveData(value.saveData ?? false); setTextSize(value.textSize ?? 'medium');
      }
    } catch { /* Les réglages locaux restent optionnels. */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem('fw:settings', JSON.stringify({ alerts, email, sms, saveData, textSize })); } catch { /* Le navigateur peut refuser le stockage. */ }
    document.documentElement.dataset.fwTextSize = textSize;
  }, [alerts, email, saveData, sms, textSize]);

  return (
    <>
      <PageHero visual="settings" title="Réglages" description="Personnalisez votre expérience FireWarning selon vos préférences." />
      <div className="fw-page fw-standard-page">
        <aside className="fw-inline-notice fw-inline-notice--link"><PublicIcon name="info" size={22} /><p><span>Certains réglages sont enregistrés localement sur votre appareil.</span><span>Connectez-vous pour synchroniser vos préférences sur tous vos appareils.</span></p><a href="/compte?mode=connexion">Se connecter <PublicIcon name="chevron-right" size={17} /></a></aside>
        <div className="fw-settings-grid">
          <section className="fw-settings-panel"><h2>Préférences générales</h2>
            <SettingRow icon="globe" title="Langue" description="Choisissez votre langue"><select aria-label="Langue"><option>Français (FR)</option><option>English (EN)</option></select></SettingRow>
            <SettingRow icon="target" title="Thème" description="Clair ou sombre"><div className="fw-segmented"><button className="is-active" type="button">Clair</button><button type="button" disabled>Sombre</button></div></SettingRow>
            <SettingRow icon="database" title="Mode données réduites" description="Réduit l’utilisation des données"><Toggle label="Mode données réduites" checked={saveData} onChange={setSaveData} /></SettingRow>
            <SettingRow icon="accessibility" title="Taille du texte" description="Ajustez la taille du texte"><div className="fw-segmented fw-segmented--text"><button type="button" className={textSize === 'small' ? 'is-active' : ''} onClick={() => setTextSize('small')}>A</button><button type="button" className={textSize === 'medium' ? 'is-active' : ''} onClick={() => setTextSize('medium')}>Moyenne</button><button type="button" className={textSize === 'large' ? 'is-active' : ''} onClick={() => setTextSize('large')}>A</button></div></SettingRow>
          </section>
          <section id="notifications" className="fw-settings-panel"><h2>Notifications</h2>
            <SettingRow icon="bell" title="Notifications d’alertes" description="Recevoir des alertes sur les incidents critiques"><Toggle label="Notifications d’alertes" checked={alerts} onChange={setAlerts} /></SettingRow>
            <SettingRow icon="mail" title="Notifications par e-mail" description="Recevoir un résumé par e-mail"><Toggle label="Notifications par e-mail" checked={email} onChange={setEmail} /></SettingRow>
            <SettingRow icon="message" title="Notifications par SMS" description="Recevoir des alertes par SMS"><Toggle label="Notifications par SMS" checked={sms} onChange={setSms} /></SettingRow>
            <SettingRow icon="bell" title="Gérer mes canaux et préférences" href="/compte" />
          </section>
          <section className="fw-settings-panel"><h2>Contenu et données</h2><SettingRow icon="bookmark" title="Zones enregistrées" description="Gérez vos zones suivies et lieux favoris" href="/compte" /><SettingRow icon="cookie" title="Préférences de cookies" description="Gérez vos préférences de cookies" href="/confidentialite#cookies" /></section>
          <section className="fw-settings-panel"><h2>Compte et sécurité</h2><SettingRow icon="user" title="Informations du compte" description="Consulter et modifier vos informations" href="/compte" /><SettingRow icon="lock" title="Sécurité" description="Mot de passe, sessions et activité" href="/compte" /><SettingRow icon="trash" title="Supprimer mon compte" description="Suppression définitive du compte et des données" href="/confidentialite#droits" /></section>
        </div>
      </div>
    </>
  );
}

const howSteps: readonly { icon: PublicIconName; title: string; text: string }[] = [
  { icon: 'phone', title: 'Un témoin signale', text: 'Vous observez un feu ou de la fumée ? Signalez-le en quelques secondes.' },
  { icon: 'search', title: 'La communauté vérifie', text: 'D’autres membres consultent, partagent et confirment avant publication.' },
  { icon: 'map', title: 'Une page publique est créée', text: 'Chaque incendie confirmé obtient sa propre page publique avec une carte et ses mises à jour.' },
  { icon: 'shield', title: 'L’information est qualifiée', text: 'Le niveau de fiabilité évolue selon les preuves disponibles.' },
  { icon: 'bell', title: 'Tout le monde reste informé', text: 'Mises à jour, alertes et contexte pour vous aider à prendre les bonnes décisions.' },
];

function Checklist({ title, items, positive }: { readonly title: string; readonly items: readonly string[]; readonly positive: boolean }) {
  return <section className={`fw-checklist ${positive ? 'is-positive' : 'is-negative'}`}><h2><PublicIcon name={positive ? 'check-circle' : 'warning'} size={24} />{title}</h2><ul>{items.map((item) => <li key={item}><PublicIcon name={positive ? 'check-circle' : 'x-circle'} size={17} />{item}</li>)}</ul></section>;
}

export function OperationPage() {
  return (
    <>
      <PageHero visual="community" title="Comment fonctionne FireWarning ?" description="Une communauté, une information fiable, des décisions éclairées. Comprendre le rôle de chacun, de l’alerte à l’information publiée." />
      <div className="fw-page fw-standard-page fw-operation-page">
        <section><h2 className="fw-section-title">Comment ça marche ?</h2><div className="fw-process">{howSteps.map((step, index) => <article key={step.title}><span>{index + 1}</span><div><PublicIcon name={step.icon} size={31} /></div><h3>{step.title}</h3><p>{step.text}</p></article>)}</div></section>
        <div className="fw-operation-columns">
          <div className="fw-operation-lists"><Checklist positive title="Ce que fait FireWarning" items={['Centralise et vérifie les signalements de la communauté.', 'Publie une page publique unique par incendie confirmé.', 'Fournit des informations claires et mises à jour.', 'Aide chacun à rester informé.']} /><Checklist positive={false} title="Ce que FireWarning ne fait pas" items={['Ne remplace pas les services d’urgence.', 'N’éteint pas les feux.', 'Ne fournit pas d’instructions officielles d’évacuation.', 'Ne garantit pas l’exactitude absolue de chaque information.']} /></div>
          <aside className="fw-faq"><h2>Questions fréquentes</h2>{['Qui peut signaler un incendie ?', 'Comment les informations sont-elles vérifiées ?', 'Qu’est-ce qu’une page publique ?', 'Mes données personnelles sont-elles publiques ?', 'Comment puis-je aider ?'].map((question) => <details key={question}><summary>{question}<PublicIcon name="chevron-right" size={17} /></summary><p>Une réponse détaillée sera publiée dans la documentation communautaire.</p></details>)}<div id="urgence" className="fw-safety-card"><PublicIcon name="shield" size={23} /><strong>Votre sécurité avant tout</strong><p>En cas d’urgence, appelez le 18 ou le 112. FireWarning ne remplace pas les services d’urgence.</p></div></aside>
        </div>
        <aside className="fw-community-cta"><PublicIcon name="users" size={34} /><p><strong>Ensemble, nous rendons l’information plus rapide, plus fiable et plus utile pour tous.</strong><span>Votre vigilance fait la différence.</span></p><a className="fw-button fw-button--primary" href="/incendies">Voir les incendies en cours <PublicIcon name="arrow" size={16} /></a><a className="fw-button fw-button--outline" href="/signaler"><PublicIcon name="plus-circle" size={18} /> Signaler un feu</a></aside>
      </div>
    </>
  );
}

const privacySections: readonly { id: string; icon: PublicIconName; title: string; text: string; bullets?: readonly string[] }[] = [
  { id: 'collecte', icon: 'database', title: '1. Données collectées', text: 'Nous collectons uniquement les données nécessaires au fonctionnement du service.', bullets: ['Localisation approximative avec accord', 'Informations sur les incidents signalés', 'Informations de compte', 'Données techniques strictement nécessaires'] },
  { id: 'utilisation', icon: 'target', title: '2. Pourquoi nous les utilisons', text: 'Ces données servent à détecter et suivre les incidents, vous informer, sécuriser le service et répondre à vos demandes.' },
  { id: 'images', icon: 'image', title: '3. Images soumises et consentement explicite', text: 'Les images sont associées uniquement au signalement concerné et ne sont rendues publiques qu’avec votre consentement explicite.' },
  { id: 'conservation', icon: 'clock', title: '4. Conservation des données', text: 'Nous conservons les données uniquement pendant la durée nécessaire aux finalités annoncées.' },
  { id: 'droits', icon: 'user', title: '5. Vos droits', text: 'Vous pouvez demander l’accès, la rectification, la limitation, l’opposition ou la suppression de vos données et retirer votre consentement.' },
  { id: 'cookies', icon: 'cookie', title: '6. Cookies et stockage local', text: 'Le stockage local sert aux préférences essentielles. Les mesures d’audience optionnelles nécessitent votre choix.' },
];

export function PrivacyPage() {
  return (
    <>
      <PageHero visual="privacy" title="Confidentialité" description="Votre vie privée est essentielle. Cette politique explique les données collectées, leur utilisation et les droits dont vous disposez." />
      <div className="fw-page fw-standard-page fw-policy-layout">
        <div className="fw-policy-cards">{privacySections.map((item) => <section id={item.id} className="fw-policy-card" key={item.id}><PublicIcon name={item.icon} size={28} /><div><h2>{item.title}</h2><p>{item.text}</p>{item.bullets ? <ul>{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul> : null}<a href={`#${item.id}`}>En savoir plus <PublicIcon name="arrow" size={15} /></a></div></section>)}</div>
        <aside className="fw-policy-summary"><section><h2><PublicIcon name="shield" size={25} />En résumé</h2><ul>{['Nous collectons uniquement des données nécessaires et pertinentes.', 'Nous utilisons vos données pour la sécurité, les alertes et l’amélioration du service.', 'Vous gardez le contrôle sur vos données et vos consentements.', 'Nous ne vendons jamais vos données.'].map((item) => <li key={item}><PublicIcon name="check-circle" size={17} />{item}</li>)}</ul></section><a className="fw-document-link" href="/confidentialite#print"><PublicIcon name="calendar" size={25} /><span><strong>Version imprimable de la politique</strong>Utilisez la fonction d’impression de votre navigateur.</span><PublicIcon name="external" size={18} /></a></aside>
      </div>
    </>
  );
}

const accessibilityItems: readonly { icon: PublicIconName; title: string; text: string }[] = [
  { icon: 'accessibility', title: 'Options d’accessibilité', text: 'Des réglages pour adapter l’affichage et la lecture du contenu.' },
  { icon: 'monitor', title: 'Compatibilité', text: 'FireWarning fonctionne avec les principaux navigateurs et technologies d’assistance.' },
  { icon: 'keyboard', title: 'Navigation au clavier', text: 'Naviguez sur le site à l’aide du clavier, sans souris.' },
  { icon: 'accessibility', title: 'Contraste et taille du texte', text: 'Des contrastes élevés et des tailles de texte adaptables.' },
  { icon: 'target', title: 'Réduction des mouvements et des données', text: 'Réduisez les animations et limitez l’utilisation des données.' },
  { icon: 'message', title: 'Signaler un problème d’accessibilité', text: 'Partagez vos retours pour nous aider à améliorer l’accessibilité du site.' },
];

export function AccessibilityPage() {
  return (
    <>
      <PageHero visual="accessibility" title="Accessibilité" description="FireWarning s’engage à rendre ses informations accessibles à toutes et à tous."><p className="fw-breadcrumb">Accueil <PublicIcon name="chevron-right" size={13} /> Accessibilité</p></PageHero>
      <div className="fw-page fw-standard-page fw-accessibility-layout">
        <section className="fw-accessibility-summary"><h2><PublicIcon name="accessibility" size={29} />Résumé</h2><p>Nous cherchons à rendre FireWarning accessible au plus grand nombre et améliorons continuellement l’expérience selon les retours d’usage.</p><ul>{['Contenu clair et structuré', 'Compatible avec les technologies d’assistance', 'Navigation clavier prise en charge', 'Contrastes optimisés', 'Réduction des mouvements et des données proposée'].map((item) => <li key={item}><PublicIcon name="check-circle" size={16} />{item}</li>)}</ul></section>
        <div className="fw-accessibility-cards">{accessibilityItems.map((item) => <details key={item.title}><summary><PublicIcon name={item.icon} size={29} /><span>{item.title}</span><PublicIcon name="chevron-down" size={18} /></summary><p>{item.text}</p><a href="/reglages">En savoir plus <PublicIcon name="arrow" size={15} /></a></details>)}</div>
        <aside className="fw-accessibility-status"><PublicIcon name="shield" size={42} /><p><strong>État actuel de l’accessibilité</strong><span>Objectif : WCAG 2.2 niveau AA. Cette page sera mise à jour avec les résultats de l’audit.</span></p><a className="fw-button fw-button--outline" href="/accessibilite#etat">Voir l’état actuel <PublicIcon name="arrow" size={16} /></a></aside>
      </div>
    </>
  );
}

const legalItems: readonly { icon: PublicIconName; title: string; text: string }[] = [
  { icon: 'user', title: '01. Éditeur du site', text: 'Les informations d’identification de la structure éditrice seront renseignées et vérifiées avant toute mise en production.' },
  { icon: 'monitor', title: '02. Hébergement', text: 'L’hébergeur, son adresse et ses coordonnées seront publiés pour chaque déploiement officiel.' },
  { icon: 'shield', title: '03. Propriété intellectuelle', text: 'Le code et les contenus possèdent leurs propres licences. Les contributions et médias utilisateurs restent soumis aux droits accordés explicitement.' },
  { icon: 'calendar', title: '04. Conditions d’utilisation', text: 'L’utilisation du service implique l’acceptation de ses limites : FireWarning ne remplace ni les secours ni les consignes officielles.' },
  { icon: 'warning', title: '05. Responsabilité', text: 'Les informations sont indicatives, datées et susceptibles d’évoluer. Elles ne constituent pas une instruction opérationnelle.' },
  { icon: 'mail', title: '06. Contact', text: 'Une adresse de contact fonctionnelle sera indiquée avant la publication du service.' },
  { icon: 'calendar', title: '07. Publication', text: 'Version de travail mise à jour le 15 juillet 2026. Validation juridique requise avant publication.' },
];

export function LegalPage() {
  return (
    <>
      <PageHero visual="legal" title="Mentions légales" description="Informations légales et conditions d’utilisation du site FireWarning." />
      <div className="fw-page fw-standard-page fw-legal-layout">
        <aside className="fw-legal-summary"><h2>Sommaire</h2>{legalItems.map((item) => <a key={item.title} href={`#legal-${item.title.slice(0, 2)}`}><strong>{item.title.slice(0, 3)}</strong>{item.title.slice(4)}</a>)}<section><PublicIcon name="phone" size={28} /><strong>Une question ?<br />Besoin d’informations ?</strong><p>Utilisez la page de contact lorsqu’elle sera publiée.</p></section></aside>
        <div className="fw-legal-content">{legalItems.map((item) => <section id={`legal-${item.title.slice(0, 2)}`} key={item.title}><PublicIcon name={item.icon} size={28} /><div><h2>{item.title}</h2><p>{item.text}</p></div></section>)}</div>
      </div>
    </>
  );
}

export function AboutPage() {
  const commitments: readonly { icon: PublicIconName; title: string; text: string }[] = [
    { icon: 'flame', title: 'Une page par incendie', text: 'Chaque événement publié dispose d’une page permanente qui rassemble sa représentation 3D, ses zones et ses informations utiles.' },
    { icon: 'monitor', title: 'Pensé d’abord pour le mobile', text: 'Les informations essentielles restent lisibles rapidement, même lorsque la 3D est désactivée ou que la connexion est limitée.' },
    { icon: 'shield', title: 'Une publication contrôlée', text: 'Les contributions sont vérifiées avant publication. Les images utilisateurs ne sont affichées qu’avec un consentement explicite.' },
  ];

  return (
    <>
      <PageHero visual="about" title="À propos de FireWarning" description="Un outil libre et communautaire pour rendre l’information sur les incendies plus lisible, sans se substituer aux secours." />
      <div className="fw-page fw-standard-page fw-about-page">
        <div className="fw-about-grid">
          <Checklist positive title="Notre objectif" items={['Une page publique unique par incendie.', 'Une information claire sur mobile.', 'Des contributions modérées avant publication.', 'Une architecture ouverte et documentée.']} />
          <Checklist positive={false} title="Nos limites" items={['Aucune alerte directe aux secours.', 'Aucune consigne officielle produite par la plateforme.', 'Aucune publication automatique des médias utilisateurs.', 'Aucune garantie d’exhaustivité en temps réel.']} />
        </div>
        <section className="fw-about-commitments" aria-labelledby="fw-about-commitments-title">
          <div className="fw-about-commitments__heading">
            <span>Notre approche</span>
            <h2 id="fw-about-commitments-title">Trois engagements concrets</h2>
            <p>Une interface publique sobre, utile en mobilité et honnête sur les limites des informations disponibles.</p>
          </div>
          <div className="fw-about-commitments__grid">
            {commitments.map((commitment) => (
              <article key={commitment.title}>
                <div><PublicIcon name={commitment.icon} size={25} /></div>
                <h3>{commitment.title}</h3>
                <p>{commitment.text}</p>
              </article>
            ))}
          </div>
        </section>
        <aside className="fw-about-actions">
          <div><PublicIcon name="info" size={27} /><p><strong>Comprendre avant d’utiliser</strong><span>Découvrez le parcours d’une observation jusqu’à la page publique d’un incendie.</span></p></div>
          <a className="fw-button fw-button--outline" href="/comment-ca-fonctionne">Comment ça fonctionne ? <PublicIcon name="arrow" size={16} /></a>
          <a className="fw-button fw-button--primary" href="/incendies">Voir les incendies en cours <PublicIcon name="arrow" size={16} /></a>
        </aside>
      </div>
    </>
  );
}
