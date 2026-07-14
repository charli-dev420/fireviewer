interface AdminZoneDetailPageProps {
  zoneId: string;
}

export function AdminZoneDetailPage({ zoneId }: AdminZoneDetailPageProps) {
  return (
    <section aria-labelledby="admin-zone-detail-title">
      <span className="eyebrow">Zone privée</span>
      <h2 id="admin-zone-detail-title">Zone {zoneId}</h2>
      <p>Placeholder MVP pour consulter les métadonnées, révisions, contrôles et incidents liés.</p>
    </section>
  );
}
