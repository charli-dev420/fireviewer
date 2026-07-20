import { useCallback, useState } from 'react';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminStateLabel, formatAdminDate } from './AdminPageState';

type QueueFilter = 'PENDING' | 'ALL';

const filters: readonly { value: QueueFilter; label: string }[] = [
  { value: 'PENDING', label: 'À examiner' },
  { value: 'ALL', label: 'Historique' },
];

export function AdminReportsPage() {
  const api = useAdminApi();
  const [filter, setFilter] = useState<QueueFilter>('PENDING');
  const load = useCallback(async (options: { signal?: AbortSignal }) => {
    const [contributions, reports] = await Promise.all([
      api.listPublicContributions(filter === 'PENDING' ? 'PENDING' : undefined, options),
      api.listPublicReports(filter === 'PENDING' ? 'PENDING' : undefined, options),
    ]);
    return { contributions, reports };
  }, [api, filter]);
  const { state, reload } = useAdminQuery(load, [load]);
  const mutation = useAdminMutation();

  const reviewContribution = async (contributionId: string, next: 'ACCEPTED' | 'REJECTED', version: number) => {
    const reason = next === 'ACCEPTED'
      ? 'Contribution acceptée pour l’analyse privée après vérification humaine.'
      : 'Contribution rejetée après vérification humaine par un administrateur.';
    const result = await mutation.run(`${contributionId}:${next}:${version}`, (options) => api.reviewPublicContribution(
      contributionId,
      { state: next, reason, expected_version: version },
      options,
    ));
    if (result) reload();
  };

  const reviewReport = async (reportId: string, next: 'CORRECTED' | 'REJECTED', version: number) => {
    const reason = next === 'CORRECTED'
      ? 'Signalement marqué comme corrigé manuellement depuis la file de validation.'
      : 'Signalement rejeté manuellement depuis la file de validation.';
    const result = await mutation.run(`${reportId}:${next}:${version}`, (options) => api.reviewPublicReport(
      reportId,
      { state: next, reason, expected_version: version },
      options,
    ));
    if (result) reload();
  };

  const empty = state.kind === 'ready' && !state.data.contributions.length && !state.data.reports.length;
  return <section aria-labelledby="admin-reports-title">
    <AdminPageHeader title="Contributions publiques"><p>Examinez les observations et images privées. Accepter une contribution autorise son analyse, jamais sa publication automatique.</p></AdminPageHeader>
    <div className="admin-filter-row" role="toolbar" aria-label="Filtrer les contributions">{filters.map((item) => <button key={item.value} type="button" className={`filter-chip ${filter === item.value ? 'is-active' : ''}`} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
    {state.kind === 'loading' ? <AdminLoadingState label="Chargement des contributions…" /> : null}
    {state.kind === 'error' ? <AdminErrorState error={state.error} onRetry={reload} /> : null}
    {empty ? <AdminEmptyState title="Rien à examiner"><span>Aucune contribution ne correspond au filtre courant.</span></AdminEmptyState> : null}
    {state.kind === 'ready' && state.data.contributions.length ? <section className="admin-section" aria-labelledby="evidence-queue-title"><header><div><p className="admin-section__eyebrow">Observations et preuves</p><h2 id="evidence-queue-title">Contributions à qualifier</h2></div></header><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Contribution</th><th>Observation</th><th>Lieu</th><th>Image privée</th><th>État</th><th>Décision</th></tr></thead><tbody>{state.data.contributions.map((contribution) => <tr key={contribution.contribution_id}><th scope="row">{contribution.fire_id ? <a href={`/admin/incidents/${contribution.fire_id}`}>{contribution.fire_id}</a> : 'Nouveau feu'}<small>{contribution.contribution_id}</small></th><td><strong>{contribution.observation_type}</strong><small>{formatAdminDate(contribution.observed_at)} · {contribution.direct_observation ? 'vue directement' : 'information rapportée'}</small><small>{contribution.description}</small></td><td>{contribution.location_label || 'Coordonnées transmises'}</td><td>{contribution.private_media_urls.length ? <a href={contribution.private_media_urls[0]} target="_blank" rel="noreferrer"><img className="admin-contribution-thumbnail" src={contribution.private_media_urls[0]} alt="Preuve privée à examiner" /></a> : 'Aucune'}</td><td><AdminStateLabel value={contribution.state} /></td><td>{contribution.state === 'PENDING' ? <div className="admin-report-actions"><button type="button" className="button button--small" disabled={mutation.state.pending} onClick={() => void reviewContribution(contribution.contribution_id, 'ACCEPTED', contribution.version)}>Accepter pour analyse</button><button type="button" className="button button--small" disabled={mutation.state.pending} onClick={() => void reviewContribution(contribution.contribution_id, 'REJECTED', contribution.version)}>Rejeter</button></div> : <span>{contribution.review_reason || 'Décision enregistrée'}</span>}</td></tr>)}</tbody></table></div></section> : null}
    {state.kind === 'ready' && state.data.reports.length ? <section className="admin-section" aria-labelledby="correction-queue-title"><header><div><p className="admin-section__eyebrow">Corrections de fiche</p><h2 id="correction-queue-title">Erreurs signalées</h2></div></header><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Incident</th><th>Catégorie</th><th>Reçu</th><th>État</th><th>Message</th><th>Décision</th></tr></thead><tbody>{state.data.reports.map((report) => <tr key={report.report_id}><th scope="row"><code>{report.fire_id}</code><small>{report.report_id}</small></th><td>{report.category}</td><td className="admin-table__muted">{formatAdminDate(report.submitted_at)}</td><td><AdminStateLabel value={report.state} /></td><td>{report.message}</td><td>{report.state === 'PENDING' ? <div className="admin-report-actions"><button type="button" className="button button--small" disabled={mutation.state.pending} onClick={() => void reviewReport(report.report_id, 'CORRECTED', report.version)}>Corrigé</button><button type="button" className="button button--small" disabled={mutation.state.pending} onClick={() => void reviewReport(report.report_id, 'REJECTED', report.version)}>Rejeter</button></div> : <span>{report.closure_reason ?? 'Décision enregistrée'}</span>}</td></tr>)}</tbody></table></div></section> : null}
    {mutation.state.error ? <AdminErrorState error={mutation.state.error} /> : null}
  </section>;
}
