interface AdminIncidentWorkspaceNavProps {
  readonly fireId: string;
  readonly active: 'dossier' | 'observations' | 'sources-media' | 'models-pipeline' | 'spatial-review';
}

const SECTIONS = [
  { key: 'dossier', label: 'Dossier', suffix: '' },
  { key: 'observations', label: 'Observations', suffix: '/observations' },
  { key: 'sources-media', label: 'Sources et médias', suffix: '/sources-medias' },
  { key: 'models-pipeline', label: 'Modèles et pipeline', suffix: '/modeles-pipeline' },
  { key: 'spatial-review', label: 'Revue 3D', suffix: '/revue-spatiale' },
] as const;

/** Navigation locale : les surfaces restent toujours rattachées au même fire_id. */
export function AdminIncidentWorkspaceNav({ fireId, active }: AdminIncidentWorkspaceNavProps) {
  const base = `/admin/incidents/${encodeURIComponent(fireId)}`;
  return (
    <nav className="admin-incident-workspace-nav" aria-label={`Surfaces de l'incident ${fireId}`}>
      {SECTIONS.map((section) => (
        <a
          key={section.key}
          href={`${base}${section.suffix}`}
          aria-current={active === section.key ? 'page' : undefined}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
