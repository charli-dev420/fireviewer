interface AdminZonePrivatePreviewPageProps {
  zoneId: string;
  revision: string;
}

export function AdminZonePrivatePreviewPage({ zoneId, revision }: AdminZonePrivatePreviewPageProps) {
  return (
    <section aria-labelledby="admin-zone-private-preview-title">
      <span className="eyebrow">Prévisualisation privée</span>
      <h2 id="admin-zone-private-preview-title">Prévisualisation privée — {zoneId} révision {revision}</h2>
      <p>
        Placeholder MVP isolé du viewer public : aucun composant <code>SpatialMapApp</code>, aucune URL GLB
        anonyme et aucune requête publique ne sont montés pour cette prévisualisation administrateur.
      </p>
    </section>
  );
}
