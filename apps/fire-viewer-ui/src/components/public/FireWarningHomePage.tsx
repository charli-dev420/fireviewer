import { useId, useState } from 'react';
import heroImage from '../../assets/public/fire-hero-home.jpg';
import { PublicIcon, type PublicIconName } from './PublicIcon';

const features: readonly { icon: PublicIconName; title: string; description: string; action: string; href: string }[] = [
  { icon: 'map', title: 'Incendies en cours', description: 'Accédez à la liste des événements actifs et à leur modèle 3D.', action: 'Consulter', href: '/incendies' },
  { icon: 'plus-circle', title: 'Signaler un feu', description: 'Transmettez une observation utile à la communauté.', action: 'Signaler', href: '/signaler' },
  { icon: 'bell', title: 'Restez informé', description: 'Suivez les mises à jour et activez les alertes sur vos zones.', action: 'En savoir plus', href: '/reglages' },
  { icon: 'shield', title: 'Données fiables', description: 'Des informations vérifiées, traitées avec transparence.', action: 'Comprendre', href: '/fonctionnement' },
];

const processSteps = [
  'Un incendie est identifié par la communauté.',
  'Une page publique unique est créée et mise à jour.',
  'Chacun peut consulter, comprendre et agir en toute sécurité.',
] as const;

export function FireWarningHomePage() {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const inputId = useId();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    window.location.assign(value ? `/incendies?q=${encodeURIComponent(value)}` : '/incendies');
  }

  function usePosition() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      window.location.assign(`/incendies?latitude=${coords.latitude.toFixed(5)}&longitude=${coords.longitude.toFixed(5)}`);
    });
  }

  return (
    <>
      <section className="fw-home-hero" style={{ '--fw-hero-image': `url(${heroImage})` } as React.CSSProperties}>
        <div className="fw-home-hero__inner fw-page">
          <h1>Suivre les incendies<span>en temps réel</span></h1>
          <p>Des informations claires, des données fiables,<br /> pour prendre les bonnes décisions.</p>
          <div className="fw-home-hero__actions">
            <a className="fw-hero-button fw-hero-button--primary" href="/incendies"><PublicIcon name="map" size={30} /><span>Voir les incendies en cours</span><PublicIcon name="chevron-right" size={18} /></a>
            <a className="fw-hero-button fw-hero-button--secondary" href="/signaler"><PublicIcon name="plus-circle" size={28} /><span>Signaler un feu</span><PublicIcon name="chevron-right" size={18} /></a>
          </div>
        </div>
      </section>

      <div className="fw-home-content fw-page">
        <form className="fw-search" role="search" onSubmit={submit}>
          <label className="sr-only" htmlFor={inputId}>Rechercher un lieu, une commune ou un incident</label>
          <PublicIcon name="search" size={21} />
          <input id={inputId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un lieu, une commune ou un incident" />
          <button type="button" aria-label="Utiliser ma position" onClick={usePosition}><PublicIcon name="crosshair" size={21} /></button>
        </form>

        <aside className="fw-emergency" aria-label="Urgence">
          <div className="fw-emergency__icon"><PublicIcon name="phone" size={24} /></div>
          <div className="fw-emergency__copy"><strong>En cas de danger immédiat</strong><span><b>Appelez le 18 ou le 112.</b> FireWarning ne remplace pas les services d’urgence.</span></div>
          <a className="fw-button fw-button--outline" href="/fonctionnement#urgence"><span>En savoir plus</span><PublicIcon name="chevron-right" size={16} /></a>
        </aside>

        <section className="fw-feature-grid" aria-label="Accès principaux">
          {features.map((feature) => (
            <article className="fw-feature" key={feature.title}>
              <div className="fw-feature__icon"><PublicIcon name={feature.icon} size={34} /></div>
              <div className="fw-feature__content"><h2>{feature.title}</h2><p>{feature.description}</p><a href={feature.href}>{feature.action}<PublicIcon name="arrow" size={15} /></a></div>
              <PublicIcon className="fw-feature__mobile-chevron" name="chevron-right" size={20} />
            </article>
          ))}
        </section>

        <section className={`fw-how-strip ${expanded ? 'is-open' : ''}`}>
          <button className="fw-how-strip__toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>Comment fonctionne FireWarning&nbsp;?<PublicIcon name="chevron-down" size={20} /></button>
          <div className="fw-how-strip__title">Comment<br />fonctionne FireWarning&nbsp;?</div>
          <div className="fw-how-strip__steps">{processSteps.map((step, index) => <div className="fw-how-step" key={step}><span>{index + 1}</span><p>{step}</p></div>)}</div>
          <a className="fw-button fw-button--outline" href="/fonctionnement">En savoir plus <PublicIcon name="external" size={15} /></a>
        </section>
      </div>
    </>
  );
}
