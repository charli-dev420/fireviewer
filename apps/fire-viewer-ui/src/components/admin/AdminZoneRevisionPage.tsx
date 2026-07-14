interface AdminZoneRevisionPageProps {
  zoneId: string;
  revision: string;
}

export function AdminZoneRevisionPage({ zoneId, revision }: AdminZoneRevisionPageProps) {
  return (
    <section aria-labelledby="admin-zone-revision-title">
      <span className="eyebrow">Révision privée</span>
      <h2 id="admin-zone-revision-title">Zone {zoneId} — révision {revision}</h2>
      <p>Placeholder MVP pour vérifier hashes, chemins, provenance, prévisualisation privée et publication explicite.</p>
    </section>
  );
}
