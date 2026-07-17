import { lazy, Suspense, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createAdminIdempotencyKey } from '../../lib/adminApi';
import { getAdminApiOrigin } from '../../lib/adminSession';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminStateLabel } from './AdminPageState';
import '../public/public-incident.css';

const TiledSpatialScene3D = lazy(async () => {
  const module = await import('../public/TiledSpatialScene3D');
  return { default: module.TiledSpatialScene3D };
});

interface PreviewImageState {
  readonly packageId: string;
  readonly url: string | null;
  readonly error: string | null;
}

export function AdminZonePrivatePreviewPage({ zoneId, revision }: { readonly zoneId: string; readonly revision: number }) {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getZonePrivatePreview(zoneId, revision, options), [api, revision, zoneId]);
  const { state, reload } = useAdminQuery(load, [load]);
  const [reason, setReason] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [comparisonPackageId, setComparisonPackageId] = useState('');
  const [images, setImages] = useState<readonly PreviewImageState[]>([]);
  const [cameraMode, setCameraMode] = useState<'orbit' | 'fps'>('orbit');

  const previewData = state.kind === 'ready' ? state.data : null;
  const selectedPackageId = previewData?.package_id && previewData.preview_package_ids.includes(previewData.package_id) ? previewData.package_id : null;
  const comparablePackageIds = selectedPackageId ? previewData?.preview_package_ids.filter((packageId) => packageId !== selectedPackageId) ?? [] : [];
  const tiledSource = useMemo(() => {
    if (!previewData?.scene) return null;
    const apiOrigin = getAdminApiOrigin() ?? window.location.origin;
    return {
      catalogUrl: new URL(previewData.scene.catalog_url, apiOrigin).toString(),
      files: Object.fromEntries(Object.entries(previewData.scene.files).map(([path, url]) => [path, new URL(url, apiOrigin).toString()])),
      credentials: 'include' as const,
    };
  }, [previewData?.scene]);

  useEffect(() => {
    if (!previewData || !selectedPackageId) {
      setImages([]);
      return undefined;
    }
    const packageIds = [selectedPackageId, comparisonPackageId]
      .filter((packageId, index, list): packageId is string => Boolean(packageId) && list.indexOf(packageId) === index);
    const controller = new AbortController();
    let active = true;
    const objectUrls: string[] = [];
    void Promise.all(packageIds.map(async (packageId): Promise<PreviewImageState> => {
      try {
        const blob = await api.getZonePrivatePreviewPng(zoneId, revision, packageId, { signal: controller.signal });
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return { packageId, url, error: null };
      } catch (error) {
        if (controller.signal.aborted) return { packageId, url: null, error: null };
        return { packageId, url: null, error: error instanceof Error ? error.message : 'Aperçu binaire indisponible.' };
      }
    })).then((result) => {
      if (active) setImages(result);
    });
    return () => {
      active = false;
      controller.abort();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [api, comparisonPackageId, previewData, revision, selectedPackageId, zoneId]);

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement de l’aperçu privé…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  const preview = state.data;
  const action = preview.package_state === 'VERIFIED' ? 'preview' : preview.package_state === 'PREVIEWABLE' ? 'publish' : null;

  async function advancePackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview.package_id || !action) return;
    setMessage(null);
    setSubmitting(true);
    try {
      const result = action === 'preview'
        ? await api.enableSpatialPackagePreview(zoneId, revision, { package_id: preview.package_id, reason }, { idempotencyKey: createAdminIdempotencyKey() })
        : await api.publishSpatialPackage(zoneId, revision, { package_id: preview.package_id, reason, admin_password: adminPassword }, { idempotencyKey: createAdminIdempotencyKey() });
      setMessage(action === 'preview' ? `Package ${result.package_id} rendu prévisualisable.` : `Publication ${result.publication_id} activée.`);
      setReason('');
      setAdminPassword('');
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'La transition du package a échoué.');
    } finally {
      if (action === 'publish') setAdminPassword('');
      setSubmitting(false);
    }
  }

  const actionLabel = action === 'preview' ? 'Autoriser l’aperçu privé' : action === 'publish' ? 'Publier ce package' : null;
  const imageFor = (packageId: string) => images.find((image) => image.packageId === packageId);
  return <section aria-labelledby="admin-zone-preview-title"><AdminPageHeader title={`Aperçu privé — Révision ${preview.revision}`} actions={<a className="button button--small" href={`/admin/zones/${encodeURIComponent(zoneId)}/revisions/${preview.revision}`}>Révision</a>}><p><code>{preview.zone_id}</code> · périmètre {preview.preview_scope}. Les fichiers sont lus via une requête authentifiée et ne révèlent aucune URL de stockage.</p></AdminPageHeader><section className="admin-section"><h3 id="admin-zone-preview-title">Package et cycle de publication</h3><dl className="manifest-data-list"><div><dt>Package</dt><dd>{preview.package_id ?? 'Aucun package disponible'}</dd></div><div><dt>État package</dt><dd>{preview.package_state ? <AdminStateLabel value={preview.package_state} /> : 'Non disponible'}</dd></div><div><dt>Publication</dt><dd>{preview.publication_id ?? 'Aucune'}</dd></div><div><dt>État publication</dt><dd>{preview.publication_state ? <AdminStateLabel value={preview.publication_state} /> : 'Non disponible'}</dd></div><div><dt>Active</dt><dd>{preview.publication_active ? 'Oui' : 'Non'}</dd></div></dl><pre className="admin-preview-report">{JSON.stringify(preview.verification_report, null, 2)}</pre></section>{selectedPackageId ? tiledSource ? <section className="admin-section"><div className="admin-section__heading"><div><h3>Aperçu 3D Unity réel</h3><p>Le catalogue, le terrain FAR, les orthophotos et les tuiles détaillées sont lus depuis le package privé.</p><p>{cameraMode === 'fps' ? 'Mode FPS actif · cliquez la scène puis utilisez ZQSD/WASD, E/C et Maj.' : 'Mode orbital actif · souris pour tourner, déplacer et zoomer.'}</p></div><div role="group" aria-label="Contrôles de caméra 3D"><button type="button" className={`button button--small ${cameraMode === 'orbit' ? 'button--primary' : ''}`} aria-pressed={cameraMode === 'orbit'} onClick={() => setCameraMode('orbit')}>Vue orbitale</button><button type="button" className={`button button--small ${cameraMode === 'fps' ? 'button--primary' : ''}`} aria-pressed={cameraMode === 'fps'} onClick={() => setCameraMode('fps')}>Vue FPS</button></div></div><Suspense fallback={<AdminLoadingState label="Initialisation du moteur cartographique 3D…" />}><TiledSpatialScene3D source={tiledSource} cameraMode={cameraMode} /></Suspense></section> : <section className="admin-section"><div className="admin-section__heading"><div><h3>Aperçu binaire et comparaison</h3><p>Comparez uniquement des packages validés et prévisualisables de cette même révision avant publication.</p></div>{comparablePackageIds.length ? <label className="admin-inline-select">Comparer avec<select value={comparisonPackageId} onChange={(event) => setComparisonPackageId(event.currentTarget.value)}><option value="">Aucun package</option>{comparablePackageIds.map((packageId) => <option key={packageId} value={packageId}>{packageId}</option>)}</select></label> : null}</div><div className="admin-preview-images"><PreviewImage title="Package à publier" image={imageFor(selectedPackageId)} packageId={selectedPackageId} />{comparisonPackageId ? <PreviewImage title="Package de comparaison" image={imageFor(comparisonPackageId)} packageId={comparisonPackageId} /> : <p className="admin-preview-images__empty">Aucun autre package prévisualisable n’est rattaché à cette révision. La comparaison sera proposée dès qu’une version antérieure aura été validée.</p>}</div></section> : <section className="admin-section"><AdminEmptyState title="Aperçu non autorisé">Validez le package puis autorisez son aperçu privé. Aucun binaire n’est demandé avant cette transition.</AdminEmptyState></section>}{actionLabel ? <section className="admin-section"><h3>{actionLabel}</h3><p>{action === 'preview' ? 'L’aperçu reste restreint aux administrateurs et n’expose aucune URL de fichier.' : 'Vérifiez l’aperçu binaire et la comparaison disponible avant de publier. Cette action remplace l’éventuelle publication active de cette référence spatiale.'}</p><form className="admin-form-card admin-form-card--narrow" onSubmit={advancePackage}><label>Motif<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={10} maxLength={500} /></label>{action === 'publish' ? <label>Mot de passe administrateur<input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.currentTarget.value)} required autoComplete="current-password" /></label> : null}<div className="admin-form-actions"><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Traitement…' : actionLabel}</button></div></form>{message ? <p role="status">{message}</p> : null}</section> : message ? <p role="status">{message}</p> : null}<section className="admin-section"><h3>Fichiers déclarés</h3>{preview.files.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Chemin</th><th>Type</th><th>Média</th><th>Taille</th><th>Empreinte</th></tr></thead><tbody>{preview.files.map((file) => <tr key={file.file_id}><td><code>{file.path ?? 'non déclaré'}</code></td><th scope="row">{file.kind}</th><td>{file.media_type}</td><td>{file.size_bytes.toLocaleString('fr-FR')} o</td><td><code>{file.sha256}</code></td></tr>)}</tbody></table></div> : <AdminEmptyState title="Aucun fichier de preview">La réponse confirme qu’aucun fichier de package n’est actuellement visible.</AdminEmptyState>}</section></section>;
}

function PreviewImage({ title, packageId, image }: { readonly title: string; readonly packageId: string; readonly image: PreviewImageState | undefined }) {
  return <figure className="admin-preview-image"><figcaption><strong>{title}</strong><code>{packageId}</code></figcaption>{image?.url ? <img src={image.url} alt={`Aperçu privé du package ${packageId}`} /> : image?.error ? <p role="alert">{image.error}</p> : <p role="status">Chargement de l’aperçu binaire…</p>}</figure>;
}
