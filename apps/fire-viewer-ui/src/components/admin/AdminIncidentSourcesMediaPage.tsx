import { useCallback, useState } from 'react';
import type { AdminIncidentSourcesMediaWorkspace } from '../../lib/adminApi';
import { useAdminApi, useAdminMutation, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminMutationFeedback, AdminPageHeader, AdminStateLabel, formatAdminDate } from './AdminPageState';
import { AdminIncidentWorkspaceNav } from './AdminIncidentWorkspaceNav';

function externalHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function SourceEditor({ source, onSave, pending }: {
  readonly source: AdminIncidentSourcesMediaWorkspace['sources'][number];
  readonly onSave: (sourceKey: string, input: { type: string; trust: string; display_name: string | null; public_display_name: string | null; public_license: string | null; public_reference_url: string | null; public_transformations: readonly string[]; enabled: boolean; reason: string }) => void;
  readonly pending: boolean;
}) {
  const [displayName, setDisplayName] = useState(source.display_name ?? '');
  const [publicName, setPublicName] = useState(source.public_display_name ?? '');
  const [license, setLicense] = useState(source.public_license ?? '');
  const [reference, setReference] = useState(source.public_reference_url ?? '');
  const [transformations, setTransformations] = useState(source.public_transformations.join(', '));
  const [reason, setReason] = useState('');
  const [type, setType] = useState(source.type);
  const [trust, setTrust] = useState(source.trust);
  const [enabled, setEnabled] = useState(source.enabled);
  const canSave = reason.trim().length >= 10;
  return (
    <details className="admin-source-editor">
      <summary>Modifier la diffusion et le registre</summary>
      <div className="admin-source-editor__grid">
        <label className="admin-field"><span>Type</span><select value={type} onChange={(event) => setType(event.currentTarget.value)}><option value="text">Texte</option><option value="image">Image</option><option value="video">Vidéo</option><option value="sensor">Capteur</option><option value="operator">Opérateur</option><option value="institutional">Institutionnel</option></select></label>
        <label className="admin-field"><span>Confiance</span><select value={trust} onChange={(event) => setTrust(event.currentTarget.value)}><option value="unverified">Non vérifiée</option><option value="partner">Partenaire</option><option value="institutional">Institutionnelle</option><option value="operator">Opérateur</option></select></label>
        <label className="admin-field"><span>Nom interne</span><input value={displayName} maxLength={255} onChange={(event) => setDisplayName(event.currentTarget.value)} /></label>
        <label className="admin-field"><span>Nom publiable</span><input value={publicName} maxLength={255} onChange={(event) => setPublicName(event.currentTarget.value)} /></label>
        <label className="admin-field"><span>Licence publiable</span><input value={license} maxLength={255} onChange={(event) => setLicense(event.currentTarget.value)} /></label>
        <label className="admin-field"><span>Référence externe publiable</span><input value={reference} maxLength={2048} inputMode="url" onChange={(event) => setReference(event.currentTarget.value)} /></label>
        <label className="admin-field admin-field--wide"><span>Transformations déclarées, séparées par des virgules</span><input value={transformations} maxLength={1024} onChange={(event) => setTransformations(event.currentTarget.value)} /></label>
        <label className="admin-source-editor__enabled"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} /> Source activée</label>
        <label className="admin-field admin-field--wide"><span>Motif audité</span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="Expliquez cette modification (10 caractères minimum)." /></label>
      </div>
      <button type="button" className="button button--primary" disabled={pending || !canSave} onClick={() => onSave(source.source_key, { type, trust, display_name: displayName.trim() || null, public_display_name: publicName.trim() || null, public_license: license.trim() || null, public_reference_url: reference.trim() || null, public_transformations: transformations.split(',').map((item) => item.trim()).filter(Boolean), enabled, reason: reason.trim() })}>Enregistrer la source</button>
    </details>
  );
}

/** Sources réellement liées au dossier et métadonnées de preuve, sans média binaire. */
export function AdminIncidentSourcesMediaPage({ fireId }: { readonly fireId: string }) {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getIncidentSourcesMedia(fireId, options), [api, fireId]);
  const { state, reload } = useAdminQuery(load, [load]);
  const mutation = useAdminMutation();
  const [updated, setUpdated] = useState<string | null>(null);
  const updateSource = async (sourceKey: string, input: Parameters<typeof api.updateSource>[1]) => {
    const result = await mutation.run(`source:${sourceKey}:${JSON.stringify(input)}`, (options) => api.updateSource(sourceKey, input, options));
    if (result !== null) { setUpdated(sourceKey); reload(); }
  };

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement des sources et médias…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  return (
    <section aria-labelledby="admin-incident-sources-title">
      <AdminPageHeader title="Sources et médias"><p>Registre des sources utilisées par <code>{fireId}</code> et inventaire de preuves. Aucun média brut, contributeur, trace ou fichier privé n’est rendu dans cette surface.</p></AdminPageHeader>
      <AdminIncidentWorkspaceNav fireId={fireId} active="sources-media" />
      <section className="admin-section" aria-labelledby="admin-incident-sources-title">
        <div className="admin-section__heading"><div><h3 id="admin-incident-sources-title">Sources liées</h3><p>Les modifications concernent le registre global de la source et produisent un audit. Les secrets d’ingestion ne sont jamais affichés ni modifiables ici.</p></div></div>
        {state.data.sources.length ? <div className="admin-source-list">{state.data.sources.map((source) => <article className="admin-source-record" key={source.source_key}><header><div><h3>{source.display_name ?? source.source_key}</h3><p><code>{source.source_key}</code> · {source.type} · {source.trust} · {source.observation_count} observation{source.observation_count > 1 ? 's' : ''}</p></div><AdminStateLabel value={source.enabled ? 'ENABLED' : 'DISABLED'} /></header><dl><div><dt>Nom public</dt><dd>{source.public_display_name ?? 'Non publié'}</dd></div><div><dt>Licence publique</dt><dd>{source.public_license ?? 'Non déclarée'}</dd></div><div><dt>Référence publique</dt><dd>{externalHref(source.public_reference_url) ? <a href={externalHref(source.public_reference_url)!} target="_blank" rel="noreferrer">Ouvrir la référence</a> : 'Non déclarée ou URL non exploitable'}</dd></div><div><dt>Transformations</dt><dd>{source.public_transformations.length ? source.public_transformations.join(' · ') : 'Aucune déclarée'}</dd></div></dl><SourceEditor source={source} pending={mutation.state.pending} onSave={(sourceKey, input) => void updateSource(sourceKey, input)} /></article>)}</div> : <AdminEmptyState title="Aucune source liée">Aucune observation ne relie actuellement une source à cet incident.</AdminEmptyState>}
      </section>
      <section className="admin-section" aria-labelledby="admin-incident-media-title"><div className="admin-section__heading"><div><h3 id="admin-incident-media-title">Références de preuve</h3><p>Inventaire métadonné, sans aperçu binaire ni données de contributeur.</p></div></div>{state.data.media_references.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Observation</th><th>Source / type</th><th>État</th><th>Preuve</th><th>Référence</th></tr></thead><tbody>{state.data.media_references.map((media) => <tr key={media.observation_id}><th scope="row"><code>{media.observation_id}</code><small>{formatAdminDate(media.observed_at)} · reçue {formatAdminDate(media.received_at)}</small></th><td>{media.source_key}<small>{media.source_type}</small></td><td><AdminStateLabel value={media.verification_state} /></td><td><code>{media.evidence_hash}</code><small>{media.evidence_license}</small></td><td>{externalHref(media.external_reference) ? <a href={externalHref(media.external_reference)!} target="_blank" rel="noreferrer">Référence externe</a> : 'Aucune référence ouvrable'}</td></tr>)}</tbody></table></div> : <AdminEmptyState title="Aucune référence de preuve">Aucune métadonnée de preuve n’est liée à cet incident.</AdminEmptyState>}</section>
      <AdminMutationFeedback error={mutation.state.error} succeeded={mutation.state.succeeded} success={updated ? `Registre de source mis à jour : ${updated}.` : 'Registre de source mis à jour.'} />
    </section>
  );
}
