import { type ChangeEvent, type FormEvent, useCallback, useState } from 'react';
import { createAdminIdempotencyKey } from '../../lib/adminApi';
import {
  prepareSpatialPackage,
  uploadPreparedSpatialPackage,
  type PreparedSpatialPackage,
  type SpatialPackageUploadProgress,
} from '../../lib/spatialPackageUpload';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminErrorState, AdminLoadingState, AdminPageHeader } from './AdminPageState';

function formatBytes(value: number): string {
  if (value < 1_024) return `${value.toLocaleString('fr-FR')} octets`;
  if (value < 1_048_576) return `${(value / 1_024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
  return `${(value / 1_073_741_824).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Go`;
}

export function AdminZoneRevisionPage({
  zoneId,
  revision,
}: {
  readonly zoneId: string;
  readonly revision: number;
}) {
  const api = useAdminApi();
  const load = useCallback(
    (options: { signal?: AbortSignal }) => api.getZoneRevision(zoneId, revision, options),
    [api, revision, zoneId],
  );
  const { state, reload } = useAdminQuery(load, [load]);
  const [packageId, setPackageId] = useState('');
  const [reason, setReason] = useState('');
  const [prepared, setPrepared] = useState<PreparedSpatialPackage | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [importReason, setImportReason] = useState('');
  const [progress, setProgress] = useState<SpatialPackageUploadProgress | null>(null);
  const [importing, setImporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (state.kind === 'loading') {
    return <AdminLoadingState label="Chargement de la révision spatiale…" />;
  }
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  const item = state.data;
  const range = (value: readonly [number, number]) => (
    `${value[0].toLocaleString('fr-FR')} à ${value[1].toLocaleString('fr-FR')} m`
  );

  async function choosePackage(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = input.files;
    setPrepared(null);
    setProgress(null);
    setMessage(null);
    setSelectionError(null);
    if (!files?.length) return;
    try {
      setPrepared(await prepareSpatialPackage(files, zoneId, revision));
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'Le dossier sélectionné est invalide.');
    } finally {
      input.value = '';
    }
  }

  async function validatePackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await api.validateSpatialPackage(
        zoneId,
        revision,
        { package_id: packageId, reason },
        { idempotencyKey: createAdminIdempotencyKey() },
      );
      setMessage(`Package ${result.package_id} validé. Ouvrez l’aperçu privé pour poursuivre le cycle.`);
      setPackageId('');
      setReason('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'La validation du package a échoué.');
    } finally {
      setSubmitting(false);
    }
  }

  async function importPackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prepared) {
      setSelectionError('Choisissez le dossier complet produit par le pipeline local.');
      return;
    }
    setMessage(null);
    setSelectionError(null);
    setImporting(true);
    setProgress(null);
    try {
      const result = await uploadPreparedSpatialPackage(
        api,
        zoneId,
        revision,
        prepared,
        importReason.trim(),
        createAdminIdempotencyKey(),
        setProgress,
      );
      setPackageId(result.package_id);
      setPrepared(null);
      setImportReason('');
      setMessage(
        `Package ${result.package_id} finalisé en brouillon : ${result.object_count} objets et ${result.asset_count} assets contrôlés.`,
      );
      reload();
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'L’envoi du package spatial a échoué.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <section aria-labelledby="admin-zone-revision-title">
      <AdminPageHeader
        title={`Révision ${item.revision}`}
        actions={(
          <a
            className="button button--small"
            href={`/admin/zones/${encodeURIComponent(zoneId)}/revisions/${item.revision}/preview`}
          >
            Aperçu privé
          </a>
        )}
      >
        <p><code>{zoneId}</code> · référence spatiale technique, hors publication publique directe.</p>
      </AdminPageHeader>

      <section className="admin-section">
        <h3 id="admin-zone-revision-title">Profil spatial {item.spatial_profile_version}</h3>
        <dl className="manifest-data-list">
          <div><dt>Production horizontale</dt><dd>{item.horizontal_crs ?? 'Profil historique non renseigné'}</dd></div>
          <div><dt>Production verticale</dt><dd>{item.vertical_crs ?? 'Profil historique non renseigné'}</dd></div>
          <div><dt>Origine Lambert-93 / NGF</dt><dd>{item.origin_l93_ngf ? item.origin_l93_ngf.map((value) => value.toFixed(3)).join(', ') : 'Non disponible sur cette révision historique'}</dd></div>
          <div><dt>Terrain de référence</dt><dd>{item.ground_model ? `${item.ground_model} · ${item.ground_resolution_m ?? '—'} m` : 'Non renseigné'}</dd></div>
          <div><dt>Référence des hauteurs de surface</dt><dd>{item.surface_height_reference ?? 'Non renseignée'}</dd></div>
          <div><dt>Origine d’échange WGS84</dt><dd>{item.origin_wgs84.map((value) => value.toFixed(6)).join(', ')}</dd></div>
          <div><dt>Cadre d’affichage</dt><dd>{item.local_frame} · {item.meters_per_unit} m / unité · {item.vertical_datum}</dd></div>
          <div><dt>Est local</dt><dd>{range(item.bounds_m.east)}</dd></div>
          <div><dt>Nord local</dt><dd>{range(item.bounds_m.north)}</dd></div>
          <div><dt>Vertical local</dt><dd>{range(item.bounds_m.up)}</dd></div>
        </dl>
      </section>

      <section className="admin-section">
        <h3>Importer le package correspondant</h3>
        <p>
          Choisissez directement le dossier produit localement. Le navigateur vérifie le manifeste,
          le catalogue, les chemins et les tailles avant d’envoyer les fichiers dans le stockage Blob privé.
        </p>
        <form className="admin-form-card admin-form-card--narrow" onSubmit={(event) => void importPackage(event)}>
          <label className="admin-file-field" htmlFor="admin-package-folder">
            <span>Choisir le dossier du package</span>
            <input
              id="admin-package-folder"
              aria-label="Choisir le dossier du package"
              type="file"
              multiple
              ref={(node) => {
                if (node) node.setAttribute('webkitdirectory', '');
              }}
              onChange={(event) => void choosePackage(event)}
              disabled={importing}
            />
            <small>Chrome et Edge conservent les chemins du dossier. Les fichiers ne transitent pas par l’API.</small>
          </label>
          <label className="admin-file-field" htmlFor="admin-package-files">
            <span>Sélection multiple de repli</span>
            <input
              id="admin-package-files"
              aria-label="Sélectionner tous les fichiers du package"
              type="file"
              accept=".json,.png,.tif,.tiff,.glb,application/json,image/png,image/tiff,model/gltf-binary"
              multiple
              onChange={(event) => void choosePackage(event)}
              disabled={importing}
            />
            <small>Utilisez ce choix seulement si le navigateur ne propose pas la sélection de dossier.</small>
          </label>

          {prepared ? (
            <dl className="admin-package-summary">
              <div><dt>Package</dt><dd><code>{prepared.packageId}</code></dd></div>
              <div><dt>Fichiers</dt><dd>{prepared.files.length.toLocaleString('fr-FR')}</dd></div>
              <div><dt>Assets</dt><dd>{prepared.assetCount.toLocaleString('fr-FR')}</dd></div>
              <div><dt>Poids total</dt><dd>{formatBytes(prepared.totalSizeBytes)}</dd></div>
            </dl>
          ) : null}

          <label>
            Motif d’import
            <textarea
              value={importReason}
              onChange={(event) => setImportReason(event.target.value)}
              required
              minLength={10}
              maxLength={500}
              disabled={importing}
            />
          </label>

          {progress ? (
            <div className="admin-upload-progress" aria-live="polite">
              <div>
                <strong>{progress.phase === 'finalizing' ? 'Finalisation du registre' : `Envoi ${progress.fileIndex}/${progress.fileCount}`}</strong>
                <span>{progress.currentPath ?? 'Contrôle des objets reçus'}</span>
              </div>
              <progress max={100} value={progress.percentage}>{progress.percentage}%</progress>
              <small>{formatBytes(progress.uploadedBytes)} / {formatBytes(progress.totalSizeBytes)} · {progress.percentage}%</small>
            </div>
          ) : null}
          {selectionError ? <div className="admin-feedback admin-feedback--error" role="alert">{selectionError}</div> : null}
          <div className="admin-form-actions">
            <button className="button button--primary" type="submit" disabled={importing || !prepared}>
              {importing ? 'Envoi en cours…' : 'Envoyer et finaliser'}
            </button>
          </div>
        </form>
      </section>

      <section className="admin-section">
        <h3>Valider un package importé</h3>
        <p>Cette étape contrôle les métadonnées enregistrées puis rattache définitivement le package à cette révision.</p>
        <form className="admin-form-card admin-form-card--narrow" onSubmit={(event) => void validatePackage(event)}>
          <label>
            Identifiant du package
            <input value={packageId} onChange={(event) => setPackageId(event.target.value)} required minLength={3} maxLength={96} />
          </label>
          <label>
            Motif de validation
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={10} maxLength={500} />
          </label>
          <div className="admin-form-actions">
            <button className="button button--primary" type="submit" disabled={submitting}>
              {submitting ? 'Validation…' : 'Valider le package'}
            </button>
          </div>
        </form>
        {message ? <p role="status">{message}</p> : null}
      </section>
    </section>
  );
}
