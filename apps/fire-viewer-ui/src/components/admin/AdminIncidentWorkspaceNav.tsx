interface AdminIncidentWorkspaceNavProps {
  readonly fireId: string;
  readonly active: 'dossier' | 'observations' | 'sources-media' | 'models-pipeline' | 'spatial-review';
}

const SECTIONS = [
  { key: 'dossier', active: 'dossier', label: 'Résumé', suffix: '' },
  { key: 'map', active: 'spatial-review', label: '3D & Carte', suffix: '/revue-spatiale' },
  { key: 'markers', active: null, label: 'Repères', suffix: '/revue-spatiale#markers' },
  { key: 'active-zone', active: null, label: 'Zone active', suffix: '/revue-spatiale#active-zone' },
  { key: 'media', active: 'sources-media', label: 'Médias', suffix: '/sources-medias' },
  { key: 'stats', active: 'dossier', label: 'Infos & stats', suffix: '#infos-stats' },
  { key: 'history', active: 'models-pipeline', label: 'Historique', suffix: '#history' },
  { key: 'publication', active: 'dossier', label: 'Publication', suffix: '#publication' },
] as const;

/** Une seule fiche incident riche : les fonctions restent accessibles sans multiplier le menu global. */
export function AdminIncidentWorkspaceNav({ fireId, active }: AdminIncidentWorkspaceNavProps) {
  const base = `/admin/incidents/${encodeURIComponent(fireId)}`;
  return (
    <nav className="admin-incident-workspace-nav" aria-label={`Gestion de l’incident ${fireId}`}>
      {SECTIONS.map((section) => (
        <a
          key={section.key}
          href={`${base}${section.suffix}`}
          aria-current={section.active !== null && active === section.active && !section.suffix.includes('#') ? 'page' : undefined}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
