import { useCallback, useState } from 'react';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminStateLabel, formatAdminDate } from './AdminPageState';
import type { AdminPublicReportState } from '../../lib/adminApi';

const filters: readonly { value: AdminPublicReportState | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Tous' }, { value: 'PENDING', label: 'À examiner' }, { value: 'CORRECTED', label: 'Corrigés' }, { value: 'REJECTED', label: 'Rejetés' },
];

export function AdminReportsPage() {
  const api = useAdminApi();
  const [filter, setFilter] = useState<AdminPublicReportState | 'ALL'>('PENDING');
  const [reason, setReason] = useState<Record<string, string>>({});
  const load = useCallback((options: { signal?: AbortSignal }) => api.listPublicReports(filter === 'ALL' ? undefined : filter, options), [api, filter]);
  const { state, reload } = useAdminQuery(load, [load]);
  const mutation = useAdminMutation();
  const review = async (reportId: string, next: 'CORRECTED' | 'REJECTED', version: number) => {
    const note = reason[reportId]?.trim() ?? '';
    if (note.length < 10) return;
    const result = await mutation.run(`${reportId}:${next}:${version}:${note}`, (options) => api.reviewPublicReport(reportId, { state: next, reason: note, expected_version: version }, options));
    if (result) reload();
  };
  return <section aria-labelledby="admin-reports-title"><AdminPageHeader title="Signalements publics"><p>Contributions anonymes à examiner. Le tableau ne contient aucune empreinte d’origine ni donnée technique de suivi.</p></AdminPageHeader><div className="admin-filter-row" role="toolbar" aria-label="Filtrer les signalements">{filters.map((item) => <button key={item.value} type="button" className={`filter-chip ${filter === item.value ? 'is-active' : ''}`} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>{state.kind === 'loading' ? <AdminLoadingState label="Chargement des signalements…" /> : null}{state.kind === 'error' ? <AdminErrorState error={state.error} onRetry={reload} /> : null}{state.kind === 'ready' && !state.data.length ? <AdminEmptyState title="Aucun signalement"><span>Aucun signalement ne correspond au filtre courant.</span></AdminEmptyState> : null}{state.kind === 'ready' && state.data.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Incident</th><th>Catégorie</th><th>Reçu</th><th>État</th><th>Message</th><th>Décision</th></tr></thead><tbody>{state.data.map((report) => <tr key={report.report_id}><th scope="row"><code>{report.fire_id}</code><small>{report.report_id}</small></th><td>{report.category}</td><td className="admin-table__muted">{formatAdminDate(report.submitted_at)}</td><td><AdminStateLabel value={report.state} /></td><td>{report.message}</td><td>{report.state === 'PENDING' ? <div className="admin-report-actions"><label className="sr-only" htmlFor={`reason-${report.report_id}`}>Motif de clôture</label><textarea id={`reason-${report.report_id}`} rows={3} maxLength={500} value={reason[report.report_id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [report.report_id]: event.target.value }))} placeholder="Motif audité, 10 caractères minimum" /><div><button type="button" className="button button--small" disabled={mutation.state.pending || (reason[report.report_id]?.trim().length ?? 0) < 10} onClick={() => void review(report.report_id, 'CORRECTED', report.version)}>Corrigé</button><button type="button" className="button button--small" disabled={mutation.state.pending || (reason[report.report_id]?.trim().length ?? 0) < 10} onClick={() => void review(report.report_id, 'REJECTED', report.version)}>Rejeté</button></div></div> : <span>{report.closure_reason ?? 'Motif non disponible'}</span>}</td></tr>)}</tbody></table></div> : null}{mutation.state.error ? <AdminErrorState error={mutation.state.error} /> : null}</section>;
}
