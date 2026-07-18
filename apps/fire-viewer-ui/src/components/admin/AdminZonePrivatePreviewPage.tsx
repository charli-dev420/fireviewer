import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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

type PackageAction = 'preview' | 'publish' | 'withdraw' | 'restore';

const ACTION_LABELS: Readonly<Record<PackageAction, string>> = {
  preview: 'Autoriser l’aperçu privé',
  publish: 'Publier sur l’incident',
  withdraw: 'Retirer du public',
  restore: 'Restaurer la publication',
};

const ACTION_DESCRIPTIONS: Readonly<Record<PackageAction, string>> = {
  preview: 'Autorise uniquement les administrateurs à vérifier les fichiers du package.',
  publish: 'Associe la carte à l’incident si nécessaire, puis la rend visible sur le site public en une seule action.',
  withdraw: 'Masque immédiatement la carte du site public. Le package et son historique d’audit sont conservés.',
  restore: 'Remet cette publication en ligne après son retrait.',
};

export function AdminZonePrivatePreviewPage({ zoneId, revision }: { readonly zoneId: string; readonly revision: number }) {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getZonePrivatePreview(zoneId, revision, options), [api, revision, zoneId]);
  const { state, reload } = useAdminQuery(load, [load]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [comparisonPackageId, setComparisonPackageId] = useState('');
  const [images, setImages] = useState<readonly PreviewImageState[]>([]);
  const [cameraMode, setCameraMode] = useState<'orbit' | 'fps'>('orbit');
  const [filesOpen, setFilesOpen] = useState(false);

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
    if (!previewData || !selectedPackageId || tiledSource) {
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
  }, [api, comparisonPackageId, previewData, revision, selectedPackageId, tiledSource, zoneId]);

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement de la carte 3D privée…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;

  const preview = state.data;
  const action: PackageAction | null = preview.package_state === 'VERIFIED'
    ? 'preview'
    : preview.package_state === 'PREVIEWABLE'
      ? 'publish'
      : preview.package_state === 'PUBLISHED' && preview.publication_active
        ? 'withdraw'
        : preview.package_state === 'WITHDRAWN' && preview.publication_id
          ? 'restore'
          : null;

  async function advancePackage() {
    if (!preview.package_id || !action) return;
    const reason = action === 'preview'
      ? 'Aperçu privé activé manuellement après contrôle du package.'
      : action === 'publish'
        ? 'Carte publiée manuellement après contrôle de l’aperçu privé.'
        : action === 'withdraw'
          ? 'Carte retirée manuellement du site public depuis son aperçu privé.'
          : 'Carte restaurée manuellement sur le site public depuis son aperçu privé.';
    setMessage(null);
    setSubmitting(true);
    try {
      if (action === 'preview') {
        const result = await api.enableSpatialPackagePreview(zoneId, revision, { package_id: preview.package_id, reason }, { idempotencyKey: createAdminIdempotencyKey() });
        setMessage(`Package ${result.package_id} prêt à être vérifié.`);
      } else if (action === 'publish') {
        if (preview.linked_fire_ids.length === 0) throw new Error('Choisissez d’abord le projet incendie qui utilisera cette carte.');
        const result = await api.publishSpatialPackage(zoneId, revision, { package_id: preview.package_id, reason }, { idempotencyKey: createAdminIdempotencyKey() });
        setMessage(`Publication ${result.publication_id} activée.`);
      } else {
        if (!preview.publication_id) throw new Error('Aucune publication n’est associée à ce package.');
        await api.changePublication(preview.publication_id, action, { reason }, { idempotencyKey: createAdminIdempotencyKey() });
        setMessage(action === 'withdraw' ? 'La carte a été retirée du site public.' : 'La publication a été restaurée.');
      }
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'La transition du package a échoué.');
    } finally {
      setSubmitting(false);
    }
  }

  const imageFor = (packageId: string) => images.find((image) => image.packageId === packageId);
  const publicStatus = preview.publication_active && preview.linked_fire_ids.length
    ? 'Publiée sur le site'
    : preview.publication_active
      ? 'Publiée sans incident — non visible'
      : 'Privée';
  const needsIncident = preview.linked_fire_ids.length === 0;

  return (
    <section aria-labelledby="admin-zone-preview-title">
      <AdminPageHeader
        title={`Carte 3D — Révision ${preview.revision}`}
        actions={<a className="button button--small" href={`/admin/zones/${encodeURIComponent(zoneId)}/revisions/${preview.revision}`}>Retour à l’import</a>}
      >
        <p><code>{preview.zone_id}</code> · <strong>{publicStatus}</strong></p>
      </AdminPageHeader>

      {preview.package_id ? (
        <section className="admin-section admin-publication-workflow" aria-labelledby="incident-link-title">
          <div className="admin-section__heading">
            <div>
              <h3 id="incident-link-title">Incident affichant cette carte</h3>
              <p>La carte apparaît dans les viewers admin et public uniquement après ce rattachement explicite.</p>
            </div>
          </div>
          {preview.linked_fire_ids.length ? (
            <p className="admin-publication-workflow__status">Associée à {preview.linked_fire_ids.map((fireId) => <a key={fireId} href={`/admin/incidents/${encodeURIComponent(fireId)}/revue-spatiale`}>{fireId}</a>)}</p>
          ) : (
            <p className="admin-feedback admin-feedback--error" role="alert">Aucun incident associé : la carte ne peut pas être visible sur le site.</p>
          )}
          {needsIncident ? <div className="admin-form-actions"><a className="button button--primary" href="/admin/incidents">Choisir le projet incendie</a></div> : null}
        </section>
      ) : null}

      <section className="admin-section admin-publication-workflow" aria-labelledby="admin-zone-preview-title">
        <div className="admin-section__heading">
          <div>
            <h3 id="admin-zone-preview-title">Publication de la carte</h3>
            <p>{preview.package_id ? <>Package <code>{preview.package_id}</code></> : 'Aucun package disponible.'}</p>
          </div>
          {preview.package_state ? <AdminStateLabel value={preview.package_state} /> : null}
        </div>
        {action && !(action === 'publish' && needsIncident) ? (
          <div className="admin-form-card admin-form-card--embedded">
            <h4>{ACTION_LABELS[action]}</h4>
            <p>{ACTION_DESCRIPTIONS[action]}</p>
            <div className="admin-form-actions">
              <button
                className={`button ${action === 'withdraw' ? 'button--small' : 'button--primary'}`}
                type="button"
                disabled={submitting}
                onClick={() => void advancePackage()}
              >
                {submitting ? 'Traitement…' : ACTION_LABELS[action]}
              </button>
            </div>
          </div>
        ) : action === 'publish' && needsIncident ? (
          <p className="admin-publication-workflow__status">Choisissez d’abord le projet incendie ci-dessus. La publication sera ensuite disponible en un clic.</p>
        ) : (
          <p className="admin-publication-workflow__status">Aucune transition n’est requise pour ce package.</p>
        )}
        {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      </section>

      {selectedPackageId ? tiledSource ? (
        <section className="admin-section">
          <div className="admin-section__heading">
            <div>
              <h3>Aperçu 3D Unity réel</h3>
              <p>Le terrain FAR, les orthophotos et les tuiles détaillées sont lus depuis le package privé.</p>
              <p>{cameraMode === 'fps' ? 'Mode FPS piéton actif · ZQSD/WASD, Maj accélère.' : 'Mode orbital actif · souris pour tourner, déplacer et zoomer.'}</p>
            </div>
            <div role="group" aria-label="Contrôles de caméra 3D">
              <button type="button" className={`button button--small ${cameraMode === 'orbit' ? 'button--primary' : ''}`} aria-pressed={cameraMode === 'orbit'} onClick={() => setCameraMode('orbit')}>Vue orbitale</button>
              <button type="button" className={`button button--small ${cameraMode === 'fps' ? 'button--primary' : ''}`} aria-pressed={cameraMode === 'fps'} onClick={() => setCameraMode('fps')}>Vue FPS</button>
            </div>
          </div>
          <Suspense fallback={<AdminLoadingState label="Initialisation du moteur cartographique 3D…" />}>
            <TiledSpatialScene3D source={tiledSource} cameraMode={cameraMode} />
          </Suspense>
        </section>
      ) : (
        <section className="admin-section">
          <div className="admin-section__heading">
            <div><h3>Aperçu et comparaison</h3><p>Comparez les packages validés de cette révision avant publication.</p></div>
            {comparablePackageIds.length ? (
              <label className="admin-inline-select">Comparer avec
                <select value={comparisonPackageId} onChange={(event) => setComparisonPackageId(event.currentTarget.value)}>
                  <option value="">Aucun package</option>
                  {comparablePackageIds.map((packageId) => <option key={packageId} value={packageId}>{packageId}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <div className="admin-preview-images">
            <PreviewImage title="Package à publier" image={imageFor(selectedPackageId)} packageId={selectedPackageId} />
            {comparisonPackageId
              ? <PreviewImage title="Package de comparaison" image={imageFor(comparisonPackageId)} packageId={comparisonPackageId} />
              : <p className="admin-preview-images__empty">Aucun autre package comparable pour cette révision.</p>}
          </div>
        </section>
      ) : (
        <section className="admin-section">
          <AdminEmptyState title="Aperçu non autorisé">Validez le package puis autorisez son aperçu privé.</AdminEmptyState>
        </section>
      )}

      <details className="admin-section admin-disclosure">
        <summary>Rapport de validation</summary>
        <pre className="admin-preview-report">{JSON.stringify(preview.verification_report, null, 2)}</pre>
      </details>

      <details className="admin-section admin-disclosure" onToggle={(event) => setFilesOpen(event.currentTarget.open)}>
        <summary>Détails techniques du package ({preview.files.length.toLocaleString('fr-FR')} fichiers)</summary>
        {filesOpen ? preview.files.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Chemin</th><th>Type</th><th>Média</th><th>Taille</th><th>Empreinte</th></tr></thead>
              <tbody>{preview.files.map((file) => (
                <tr key={file.file_id}>
                  <td><code>{file.path ?? 'non déclaré'}</code></td>
                  <th scope="row">{file.kind}</th>
                  <td>{file.media_type}</td>
                  <td>{file.size_bytes.toLocaleString('fr-FR')} o</td>
                  <td><code>{file.sha256}</code></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <AdminEmptyState title="Aucun fichier">Aucun fichier n’est déclaré dans ce package.</AdminEmptyState> : null}
      </details>
    </section>
  );
}

function PreviewImage({ title, packageId, image }: { readonly title: string; readonly packageId: string; readonly image: PreviewImageState | undefined }) {
  return (
    <figure className="admin-preview-image">
      <figcaption><strong>{title}</strong><code>{packageId}</code></figcaption>
      {image?.url
        ? <img src={image.url} alt={`Aperçu privé du package ${packageId}`} />
        : image?.error
          ? <p role="alert">{image.error}</p>
          : <p role="status">Chargement de l’aperçu binaire…</p>}
    </figure>
  );
}
