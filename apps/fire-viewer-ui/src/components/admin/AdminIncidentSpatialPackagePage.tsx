import { type ChangeEvent, type FormEvent, useCallback, useState } from 'react';
import { createAdminIdempotencyKey } from '../../lib/adminApi';
import {
  prepareSpatialPackage,
  uploadPreparedIncidentSpatialPackage,
  type PreparedSpatialPackage,
  type SpatialPackageUploadProgress,
} from '../../lib/spatialPackageUpload';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminErrorState, AdminLoadingState, AdminPageHeader } from './AdminPageState';

function formatBytes(value: number): string {
  if (value < 1_048_576) return `${(value / 1_024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
  return `${(value / 1_073_741_824).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Go`;
}

export function AdminIncidentSpatialPackagePage({ fireId }: { readonly fireId: string }) {
  const api = useAdminApi();
  const load = useCallback(
    (options: { signal?: AbortSignal }) => api.getIncident(fireId, options),
    [api, fireId],
  );
  const { state, reload } = useAdminQuery(load, [load]);
  const [prepared, setPrepared] = useState<PreparedSpatialPackage | null>(null);
  const [progress, setProgress] = useState<SpatialPackageUploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [completed, setCompleted] = useState(false);

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement du projet incendie…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  const incident = state.data;
  const hasMap = incident.models.some((model) => model.spatial_zone_id || model.asset_spatial_zone_id);

  async function choosePackage(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    setPrepared(null);
    setProgress(null);
    setCompleted(false);
    setError(null);
    try {
      if (input.files?.length) setPrepared(await prepareSpatialPackage(input.files));
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Le dossier sélectionné est invalide.');
    } finally {
      input.value = '';
    }
  }

  async function importPackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prepared) return;
    setImporting(true);
    setError(null);
    setProgress(null);
    try {
      await uploadPreparedIncidentSpatialPackage(
        api,
        incident.fire_id,
        incident.version,
        prepared,
        `Import du fond 3D depuis le projet incendie ${incident.fire_id}.`,
        createAdminIdempotencyKey(),
        setProgress,
      );
      setPrepared(null);
      setCompleted(true);
      reload();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'L’import de la carte 3D a échoué.');
    } finally {
      setImporting(false);
    }
  }

  return <section aria-labelledby="incident-map-import-title">
    <AdminPageHeader
      title="Importer le fond 3D"
      actions={<a className="button button--small" href={`/admin/incidents/${encodeURIComponent(fireId)}`}>Retour au projet</a>}
    >
      <p><strong>{incident.canonical_name ?? incident.fire_id}</strong> · la carte sera rattachée automatiquement à ce projet.</p>
    </AdminPageHeader>

    {completed || hasMap ? <section className="admin-section admin-form-card--narrow">
      <h3>{completed ? 'Fond 3D importé' : 'Le projet possède déjà son fond 3D'}</h3>
      <p>Le fond reste fixe. Les contours et points d’incendie se gèrent ensuite comme des calques modifiables.</p>
      <a className="button button--primary" href={`/admin/incidents/${encodeURIComponent(fireId)}/revue-spatiale`}>Ouvrir la carte et les calques</a>
    </section> : <section className="admin-section">
      <h3 id="incident-map-import-title">Ajouter la carte du projet</h3>
      <p>Sélectionnez le dossier exporté. Ses références techniques sont contrôlées automatiquement ; aucun rattachement manuel ne sera demandé.</p>
      <form className="admin-form-card admin-form-card--narrow" onSubmit={(event) => void importPackage(event)}>
        <label className="admin-file-field" htmlFor="incident-map-folder">
          <span>Choisir le dossier du fond 3D</span>
          <input
            id="incident-map-folder"
            type="file"
            multiple
            ref={(node) => { if (node) node.setAttribute('webkitdirectory', ''); }}
            onChange={(event) => void choosePackage(event)}
            disabled={importing}
          />
          <small>Le manifeste, le catalogue et tous les assets doivent être présents.</small>
        </label>
        {prepared ? <dl className="admin-package-summary">
          <div><dt>Package</dt><dd><code>{prepared.packageId}</code></dd></div>
          <div><dt>Carte détectée</dt><dd>{prepared.zoneId}</dd></div>
          <div><dt>Fichiers</dt><dd>{prepared.files.length.toLocaleString('fr-FR')}</dd></div>
          <div><dt>Poids</dt><dd>{formatBytes(prepared.totalSizeBytes)}</dd></div>
        </dl> : null}
        {progress ? <div className="admin-upload-progress" aria-live="polite">
          <div><strong>{progress.phase === 'finalizing' ? 'Finalisation dans le projet' : `Envoi ${progress.fileIndex}/${progress.fileCount}`}</strong><span>{progress.currentPath ?? 'Contrôle et rattachement automatique'}</span></div>
          <progress max={100} value={progress.percentage}>{progress.percentage}%</progress>
          <small>{formatBytes(progress.uploadedBytes)} / {formatBytes(progress.totalSizeBytes)} · {progress.percentage}%</small>
        </div> : null}
        {error ? <div className="admin-feedback admin-feedback--error" role="alert">{error}</div> : null}
        <button className="button button--primary" type="submit" disabled={!prepared || importing}>{importing ? 'Import en cours…' : 'Importer dans ce projet'}</button>
      </form>
    </section>}
  </section>;
}
