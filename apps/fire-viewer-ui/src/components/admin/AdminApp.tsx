import type { AdminRoute } from '../../routing';
import { AdminApiProvider } from './AdminApiContext';
import { AdminAuthGate } from './AdminAuthGate';
import { AdminDashboardPage, AdminOperationalMapPage } from './AdminCommandPages';
import { AdminAuditPage, AdminConfigurationPage, AdminRolesPage, AdminSystemPage } from './AdminGovernancePages';
import { AdminIncidentDetailPage } from './AdminIncidentDetailPage';
import { AdminIncidentModelsPipelinePage } from './AdminIncidentModelsPipelinePage';
import { AdminIncidentObservationsPage } from './AdminIncidentObservationsPage';
import { AdminIncidentSourcesMediaPage } from './AdminIncidentSourcesMediaPage';
import { AdminIncidentSpatialReviewPage } from './AdminIncidentSpatialReviewPage';
import { AdminIncidentsPage } from './AdminIncidentsPage';
import { AdminInformationEditorPage } from './AdminInformationEditorPage';
import { AdminNewZonePage } from './AdminNewZonePage';
import { AdminPublicationsPage } from './AdminPublicationsPage';
import { AdminReportsPage } from './AdminReportsPage';
import { AdminShell } from './AdminShell';
import { AdminSpatialMatchingPage } from './AdminSpatialMatchingPage';
import { AdminWorkQueuePage } from './AdminWorkQueuePage';
import { AdminZoneDetailPage } from './AdminZoneDetailPage';
import { AdminZonePrivatePreviewPage } from './AdminZonePrivatePreviewPage';
import { AdminZoneRevisionPage } from './AdminZoneRevisionPage';
import { AdminZonesPage } from './AdminZonesPage';

function AdminNotFoundPage() {
  return (
    <section aria-labelledby="admin-not-found-title">
      <span className="eyebrow">Route administrateur</span>
      <h2 id="admin-not-found-title">Page administrateur inconnue</h2>
      <p>Cette route privée n’est pas prévue par l’espace opérateur.</p>
    </section>
  );
}

export interface AdminAppProps {
  readonly route: AdminRoute;
}

export default function AdminApp({ route }: AdminAppProps) {
  let page;
  if (route.kind === 'dashboard') page = <AdminDashboardPage />;
  else if (route.kind === 'operational-map') page = <AdminOperationalMapPage />;
  else if (route.kind === 'zones') page = <AdminZonesPage />;
  else if (route.kind === 'new-zone') page = <AdminNewZonePage />;
  else if (route.kind === 'zone-detail') page = <AdminZoneDetailPage zoneId={route.zoneId} />;
  else if (route.kind === 'new-zone-revision') page = <AdminZoneDetailPage zoneId={route.zoneId} />;
  else if (route.kind === 'new-zone-information') page = <AdminInformationEditorPage zoneId={route.zoneId} />;
  else if (route.kind === 'zone-information') page = <AdminInformationEditorPage zoneId={route.zoneId} informationId={route.informationId} />;
  else if (route.kind === 'zone-revision') page = <AdminZoneRevisionPage zoneId={route.zoneId} revision={Number(route.revision)} />;
  else if (route.kind === 'zone-private-preview') page = <AdminZonePrivatePreviewPage zoneId={route.zoneId} revision={Number(route.revision)} />;
  else if (route.kind === 'reports') page = <AdminReportsPage />;
  else if (route.kind === 'work-queue') page = <AdminWorkQueuePage />;
  else if (route.kind === 'spatial-matching') page = <AdminSpatialMatchingPage />;
  else if (route.kind === 'incidents') page = <AdminIncidentsPage />;
  else if (route.kind === 'incident-detail') page = <AdminIncidentDetailPage fireId={route.fireId} />;
  else if (route.kind === 'incident-observations') page = <AdminIncidentObservationsPage fireId={route.fireId} />;
  else if (route.kind === 'incident-sources-media') page = <AdminIncidentSourcesMediaPage fireId={route.fireId} />;
  else if (route.kind === 'incident-models-pipeline') page = <AdminIncidentModelsPipelinePage fireId={route.fireId} />;
  else if (route.kind === 'incident-spatial-review') page = <AdminIncidentSpatialReviewPage fireId={route.fireId} />;
  else if (route.kind === 'audit') page = <AdminAuditPage />;
  else if (route.kind === 'roles') page = <AdminRolesPage />;
  else if (route.kind === 'system') page = <AdminSystemPage />;
  else if (route.kind === 'configuration') page = <AdminConfigurationPage />;
  else if (route.kind === 'publications') page = <AdminPublicationsPage />;
  else page = <AdminNotFoundPage />;

  return (
    <AdminAuthGate>
      {(session, onSignOut) => (
        <AdminApiProvider session={session} onUnauthorized={onSignOut}>
          <AdminShell onSignOut={onSignOut}>{page}</AdminShell>
        </AdminApiProvider>
      )}
    </AdminAuthGate>
  );
}
