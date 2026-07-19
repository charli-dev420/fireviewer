import { useCallback, useEffect, useId, useState } from 'react';
import type { AdminAgentOperationType } from '../../lib/adminApi';
import { uploadIncidentSourcePackage } from '../../lib/sourcePackageUpload';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminMutationFeedback,
  AdminPageHeader,
  AdminStateLabel,
  formatAdminDate,
} from './AdminPageState';
import { AdminIncidentWorkspaceNav } from './AdminIncidentWorkspaceNav';

const ANALYSIS_LABELS: Record<AdminAgentOperationType, { title: string; detail: string }> = {
  user_media: {
    title: 'Analyser les fichiers reçus',
    detail: 'Photos, vidéos, audios et textes privés reçus pour cette journée.',
  },
  source_research: {
    title: 'Rechercher et analyser les sources publiques',
    detail: 'Recherche réelle sur les sites autorisés, avec sources et date de publication.',
  },
  satellite_media: {
    title: 'Analyser les images satellites',
    detail: 'Produits satellite et thermiques déjà disponibles pour cette journée.',
  },
};

function todayLocal(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function elapsedLabel(value: string | null, now: number): string {
  if (!value) return 'Jamais lancé';
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1_000));
  if (elapsedSeconds < 60) return `Il y a ${elapsedSeconds} s`;
  if (elapsedSeconds < 3_600) return `Il y a ${Math.floor(elapsedSeconds / 60)} min`;
  if (elapsedSeconds < 86_400) return `Il y a ${Math.floor(elapsedSeconds / 3_600)} h`;
  return `Il y a ${Math.floor(elapsedSeconds / 86_400)} j`;
}

function blockedLabel(reason: string | null): string {
  if (reason === 'dispatch_disabled') return 'Pod non connecté';
  if (reason === 'research_disabled') return 'Recherche non configurée';
  if (reason === 'already_running') return 'Déjà en cours';
  return 'Rien à traiter';
}

/** Espace quotidien unique : réception, recherche, analyse et provenance privée. */
export function AdminIncidentSourcesMediaPage({ fireId }: { readonly fireId: string }) {
  const api = useAdminApi();
  const fileInputId = useId();
  const [localDate, setLocalDate] = useState(todayLocal);
  const [locationHint, setLocationHint] = useState('');
  const [files, setFiles] = useState<readonly File[]>([]);
  const [analysisAuthorized, setAnalysisAuthorized] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [launched, setLaunched] = useState<{ type: AdminAgentOperationType; files: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(
    (options: { signal?: AbortSignal }) => api.getIncidentSourcesMedia(fireId, options),
    [api, fireId],
  );
  const loadOperations = useCallback(
    (options: { signal?: AbortSignal }) => api.getIncidentAgentOperations(fireId, localDate, options),
    [api, fireId, localDate],
  );
  const { state, reload } = useAdminQuery(load, [load]);
  const { state: operations, reload: reloadOperations } = useAdminQuery(loadOperations, [loadOperations]);
  const analysisMutation = useAdminMutation();
  const uploadMutation = useAdminMutation();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const runAnalysis = async (type: AdminAgentOperationType) => {
    const result = await analysisMutation.run(
      `analysis:${fireId}:${localDate}:${type}`,
      (options) => api.runIncidentAgentOperation(
        fireId,
        type,
        { local_date: localDate, location_hint: locationHint.trim() || null },
        options,
      ),
    );
    if (result !== null) {
      setLaunched({ type, files: result.queued_files });
      reloadOperations();
    }
  };

  const sendFiles = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!analysisAuthorized || !files.length) return;
    setUploadProgress('Préparation de l’envoi…');
    setUploadResult(null);
    const result = await uploadMutation.run(
      `source-package:${fireId}:${localDate}:${files.map((file) => `${file.name}:${file.size}`).join('|')}`,
      (options) => uploadIncidentSourcePackage(api, {
        fireId,
        files,
        localDate,
        locationHint: locationHint.trim() || null,
        idempotencyKey: options.idempotencyKey!,
        onProgress: (completed, total) => setUploadProgress(`${completed}/${total} fichier${total > 1 ? 's' : ''} envoyé${completed > 1 ? 's' : ''}`),
      }),
    );
    if (result !== null) {
      setUploadResult(`${result.item_count} fichier${result.item_count > 1 ? 's' : ''} prêt${result.item_count > 1 ? 's' : ''} pour l’analyse.`);
      setUploadProgress(null);
      setFiles([]);
      setAnalysisAuthorized(false);
      reloadOperations();
    }
  };

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement des sources et médias…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  return (
    <section aria-labelledby="admin-incident-sources-title">
      <AdminPageHeader title="Sources et médias">
        <p>Une journée à la fois. Les résultats restent privés jusqu’à leur validation humaine.</p>
      </AdminPageHeader>
      <AdminIncidentWorkspaceNav fireId={fireId} active="sources-media" />

      <section className="admin-section" aria-labelledby="admin-analysis-day-title">
        <div className="admin-section__heading">
          <div><h3 id="admin-analysis-day-title">Journée traitée</h3><p>Cette date s’applique aux fichiers, à la recherche publique et au satellite.</p></div>
        </div>
        <div className="admin-form-grid admin-form-grid--compact">
          <label className="admin-field"><span>Date</span><input type="date" value={localDate} onChange={(event) => setLocalDate(event.currentTarget.value)} /></label>
          <label className="admin-field"><span>Lieu ou repère <small>(facultatif)</small></span><input value={locationHint} maxLength={500} onChange={(event) => setLocationHint(event.currentTarget.value)} placeholder="Ex. Die, massif de Justin" /></label>
        </div>
      </section>

      <section className="admin-section" aria-labelledby="admin-source-upload-title">
        <div className="admin-section__heading"><div><h3 id="admin-source-upload-title">Ajouter les fichiers reçus</h3><p>Les empreintes, tailles, types et métadonnées sont calculés automatiquement.</p></div></div>
        <form onSubmit={(event) => void sendFiles(event)}>
          <label className="admin-field" htmlFor={fileInputId}><span>Photos, vidéos, audios ou textes</span><input id={fileInputId} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.tif,.tiff,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg,.txt,.md,.html,.htm" onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))} /></label>
          <p>{files.length ? `${files.length} fichier${files.length > 1 ? 's' : ''} sélectionné${files.length > 1 ? 's' : ''}.` : 'Aucun fichier sélectionné.'}</p>
          <label className="admin-source-editor__enabled"><input type="checkbox" checked={analysisAuthorized} onChange={(event) => setAnalysisAuthorized(event.currentTarget.checked)} /> J’autorise l’analyse privée de ces fichiers.</label>
          <div className="admin-actions"><button type="submit" className="button button--primary" disabled={uploadMutation.state.pending || !files.length || !analysisAuthorized}>{uploadMutation.state.pending ? uploadProgress ?? 'Envoi…' : 'Envoyer les fichiers'}</button></div>
        </form>
        <AdminMutationFeedback error={uploadMutation.state.error} succeeded={uploadMutation.state.succeeded} success={uploadResult ?? 'Fichiers reçus et prêts pour analyse.'} />
      </section>

      <section className="admin-section" aria-labelledby="admin-agent-operations-title">
        <div className="admin-section__heading"><div><h3 id="admin-agent-operations-title">Lancer une analyse</h3><p>Le pod traite une seule action à la fois. Aucun résultat n’est publié automatiquement.</p></div></div>
        {operations.kind === 'loading' ? <AdminLoadingState label="Lecture des analyses disponibles…" /> : null}
        {operations.kind === 'error' ? <AdminErrorState error={operations.error} onRetry={reloadOperations} /> : null}
        {operations.kind === 'ready' ? <div className="admin-analysis-actions">{operations.data.actions.map((action) => {
          const label = ANALYSIS_LABELS[action.operation_type];
          return <article className="admin-analysis-action" key={action.operation_type}>
            <div><h4>{label.title}</h4><p>{label.detail}</p></div>
            <dl>
              <div><dt>Éléments en attente</dt><dd>{action.pending_files || action.pending_analyses}</dd></div>
              <div><dt>En cours</dt><dd>{action.running_analyses}</dd></div>
            </dl>
            <div className="admin-analysis-action__footer">
              <span>{elapsedLabel(action.last_run_at, now)}</span>
              <button type="button" className="button button--primary" disabled={analysisMutation.state.pending || !action.can_run} onClick={() => void runAnalysis(action.operation_type)}>{action.can_run ? label.title : blockedLabel(action.blocked_reason)}</button>
            </div>
          </article>;
        })}</div> : null}
        <AdminMutationFeedback error={analysisMutation.state.error} succeeded={analysisMutation.state.succeeded} success={launched ? `Action lancée : ${ANALYSIS_LABELS[launched.type].title}.` : 'Analyse lancée.'} />
      </section>

      <section className="admin-section" aria-labelledby="admin-incident-sources-title">
        <div className="admin-section__heading"><div><h3 id="admin-incident-sources-title">Sources liées</h3><p>Provenance disponible pour la vérification humaine.</p></div></div>
        {state.data.sources.length ? <div className="admin-source-list">{state.data.sources.map((source) => <article className="admin-source-record" key={source.source_key}><header><div><h3>{source.display_name ?? source.source_key}</h3><p>{source.observation_count} observation{source.observation_count > 1 ? 's' : ''}</p></div><AdminStateLabel value={source.enabled ? 'ENABLED' : 'DISABLED'} /></header></article>)}</div> : <AdminEmptyState title="Aucune source liée">Aucune source n’est encore liée à cet incident.</AdminEmptyState>}
      </section>

      <section className="admin-section" aria-labelledby="admin-incident-media-title"><div className="admin-section__heading"><div><h3 id="admin-incident-media-title">Références de preuve</h3><p>Références nécessaires à la validation, sans exposer les fichiers privés.</p></div></div>{state.data.media_references.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Observation</th><th>Source</th><th>État</th><th>Preuve</th></tr></thead><tbody>{state.data.media_references.map((media) => <tr key={media.observation_id}><th scope="row"><code>{media.observation_id}</code><small>{formatAdminDate(media.observed_at)}</small></th><td>{media.source_key}</td><td><AdminStateLabel value={media.verification_state} /></td><td><code>{media.evidence_hash}</code><small>{media.evidence_license}</small></td></tr>)}</tbody></table></div> : <AdminEmptyState title="Aucune référence de preuve">Aucune preuve n’est encore liée à cet incident.</AdminEmptyState>}</section>
    </section>
  );
}
