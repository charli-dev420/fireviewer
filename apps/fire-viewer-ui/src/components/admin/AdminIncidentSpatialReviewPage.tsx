import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { AdminActiveFireZoneRevision, AdminGltfPoint } from '../../lib/adminApi';
import { getViewerManifestApiOrigin } from '../../lib/manifestClient';
import { useAdminApi, useAdminQuery } from './AdminApiContext';
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminStateLabel, formatAdminDate } from './AdminPageState';
import { AdminIncidentSpatialEditor3D } from './AdminIncidentSpatialEditor3D';
import './AdminIncidentSpatialReviewPage.css';

const TiledSpatialScene3D = lazy(async () => {
  const module = await import('../public/TiledSpatialScene3D');
  return { default: module.TiledSpatialScene3D };
});

interface DraftPoint { readonly gltf: AdminGltfPoint; readonly wgs84: readonly [number, number, number]; }

function key(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function outerCoordinates(revision: AdminActiveFireZoneRevision): readonly unknown[] | null {
  const coordinates = revision.geometry_geojson.coordinates;
  if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0]) || !Array.isArray(coordinates[0][0])) return null;
  return coordinates[0][0];
}

export function AdminIncidentSpatialReviewPage({ fireId }: { readonly fireId: string }) {
  const api = useAdminApi();
  const load = useCallback((options: { signal?: AbortSignal }) => api.getIncidentSpatialReview(fireId, options), [api, fireId]);
  const { state, reload } = useAdminQuery(load, [load]);
  const [drawMode, setDrawMode] = useState(false);
  const [draft, setDraft] = useState<readonly DraftPoint[]>([]);
  const [supportingMarkers, setSupportingMarkers] = useState<readonly string[]>([]);
  const [mergeIds, setMergeIds] = useState<readonly string[]>([]);
  const [reason, setReason] = useState('Contour édité et contrôlé directement dans la scène 3D privée.');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sceneReset, setSceneReset] = useState(0);
  const [movingDraftIndex, setMovingDraftIndex] = useState<number | null>(null);

  const changeMapPublication = async () => {
    if (state.kind !== 'ready' || !state.data.scene) return;
    const scene = state.data.scene;
    setBusy(true); setMessage(null);
    try {
      if (scene.package_state === 'PREVIEWABLE' && scene.package_id && scene.zone_id && scene.zone_revision) {
        await api.publishSpatialPackage(scene.zone_id, scene.zone_revision, {
          package_id: scene.package_id,
          reason: 'Carte 3D contrôlée depuis le projet incendie avant sa mise en ligne publique.',
        }, { idempotencyKey: key('project-map-publish') });
        setMessage('Carte publiée sur le site public.');
      } else if (scene.publication_id && scene.publication_active) {
        await api.changePublication(scene.publication_id, 'withdraw', {
          reason: 'Carte retirée du site public depuis le projet incendie.',
        }, { idempotencyKey: key('project-map-withdraw') });
        setMessage('Carte retirée du site public.');
      } else if (scene.publication_id && scene.publication_state === 'WITHDRAWN') {
        await api.changePublication(scene.publication_id, 'restore', {
          reason: 'Carte remise en ligne depuis le projet incendie après contrôle humain.',
        }, { idempotencyKey: key('project-map-restore') });
        setMessage('Carte remise en ligne sur le site public.');
      }
      reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Publication de la carte impossible.'); }
    finally { setBusy(false); }
  };

  const latestRevision = state.kind === 'ready' ? Math.max(0, ...state.data.zone_revisions.map((item) => item.revision)) : 0;
  const validatedMarkerIds = useMemo(() => state.kind === 'ready' ? state.data.markers.filter((item) => item.review_state === 'VALIDATED').map((item) => item.marker_id) : [], [state]);
  const tiledSource = useMemo(() => {
    if (state.kind !== 'ready' || !state.data.scene?.catalog_url) return null;
    const apiOrigin = getViewerManifestApiOrigin() ?? window.location.origin;
    return {
      catalogUrl: new URL(state.data.scene.catalog_url, apiOrigin).toString(),
      files: Object.fromEntries(Object.entries(state.data.scene.files).map(([path, url]) => [path, new URL(url, apiOrigin).toString()])),
    };
  }, [state]);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage(null);
    try { await operation(); setMessage(success); reload(); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Action impossible.'); return false; }
    finally { setBusy(false); }
  };

  if (state.kind === 'loading') return <AdminLoadingState label="Chargement de la revue spatiale 3D…" />;
  if (state.kind === 'error') return <AdminErrorState error={state.error} onRetry={reload} />;
  const workspace = state.data;
  const currentLayer = [...workspace.zone_revisions]
    .filter((item) => item.review_state !== 'REJECTED')
    .sort((left, right) => right.revision - left.revision)[0] ?? null;
  const overlayPoints = workspace.markers.filter((item) => item.gltf_position && item.review_state !== 'REJECTED').map((item) => ({ position: item.gltf_position!, color: item.review_state === 'VALIDATED' ? '#4ee19a' : '#ffc857' }));
  const overlayLines = [
    ...workspace.zone_revisions.filter((item) => item.review_state !== 'REJECTED').flatMap((item) => item.gltf_polygons.flatMap((polygon) => polygon.map((points) => ({ points, color: item.review_state === 'READY_FOR_PUBLICATION' ? '#ff5b43' : '#60a5fa' })))),
    ...(draft.length > 1 ? [{ points: [...draft.map((item) => item.gltf), ...(draft.length > 2 ? [draft[0]!.gltf] : [])], color: '#f8e16c' }] : []),
  ];
  const mapPublicationAction = workspace.scene?.package_state === 'PREVIEWABLE'
    ? 'Publier la carte'
    : workspace.scene?.publication_active
      ? 'Retirer du public'
      : workspace.scene?.publication_state === 'WITHDRAWN'
        ? 'Remettre en ligne'
        : null;

  const addTerrainPoint = async (gltf: AdminGltfPoint) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const projected = await api.projectIncidentGltfPick(fireId, gltf);
      const point = { gltf, wgs84: [projected.longitude, projected.latitude, projected.altitude_m] } as const;
      setDraft((current) => movingDraftIndex === null
        ? [...current, point]
        : current.map((item, index) => index === movingDraftIndex ? point : item));
      setMovingDraftIndex(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Projection impossible.'); }
    finally { setBusy(false); }
  };

  const resumeRevision = (revision: AdminActiveFireZoneRevision) => {
    const coordinates = outerCoordinates(revision);
    const gltf = revision.gltf_polygons[0]?.[0];
    if (!coordinates || !gltf || coordinates.length !== gltf.length) { setMessage('Cette géométrie ne peut pas être reprise dans l’éditeur simplifié.'); return; }
    const length = coordinates.length > 1 ? coordinates.length - 1 : coordinates.length;
    const points: DraftPoint[] = [];
    for (let index = 0; index < length; index += 1) {
      const coordinate = coordinates[index];
      if (!Array.isArray(coordinate) || coordinate.length < 2 || typeof coordinate[0] !== 'number' || typeof coordinate[1] !== 'number') continue;
      points.push({ gltf: gltf[index], wgs84: [coordinate[0], coordinate[1], typeof coordinate[2] === 'number' ? coordinate[2] : workspace.scene?.origin_wgs84[2] ?? 0] });
    }
    setDraft(points); setMovingDraftIndex(null); setSupportingMarkers(revision.supporting_marker_ids); setDrawMode(true); setMessage('Calque chargé dans l’éditeur. Modifiez ses sommets directement sur le terrain.');
  };

  const saveDraft = () => {
    if (draft.length < 3 || reason.trim().length < 10) { setMessage('Au moins trois sommets et un motif explicite sont requis.'); return; }
    const ring = draft.map((point) => [point.wgs84[0], point.wgs84[1]]);
    ring.push([...ring[0]]);
    void mutate(() => api.createActiveFireZoneRevision(fireId, { expected_latest_revision: latestRevision, valid_at: new Date().toISOString(), geometry_geojson: { type: 'Polygon', coordinates: [ring] }, supporting_marker_ids: supportingMarkers, reason }, { idempotencyKey: key('active-zone') }), 'Calque enregistré. Il reste privé jusqu’à sa validation.').then((saved) => { if (saved) { setDraft([]); setMovingDraftIndex(null); setDrawMode(false); } });
  };

  return <section aria-labelledby="admin-spatial-review-title">
    <AdminPageHeader
      title="Carte 3D et périmètre"
      actions={<div className="admin-form-actions"><a className="button button--small" href={`/admin/incidents/${encodeURIComponent(fireId)}`}>Retour au projet</a>{mapPublicationAction ? <button type="button" className={workspace.scene?.publication_active ? 'button button--small' : 'button button--primary button--small'} disabled={busy} onClick={() => void changeMapPublication()}>{mapPublicationAction}</button> : null}<a className="button button--small" href={`/incendie/${encodeURIComponent(fireId)}`} target="_blank" rel="noreferrer">Voir le site public</a></div>}
    ><p><code>{fireId}</code> · le fond 3D reste fixe ; seul le calque incendie est modifié.</p></AdminPageHeader>
    {message ? <p className="admin-spatial-message" role="status">{message}</p> : null}
    {!workspace.scene ? <AdminEmptyState title="Aucun fond 3D dans ce projet"><p>Importez d’abord la carte du projet ; elle sera liée automatiquement à l’épisode {workspace.episode_id}.</p><a className="button button--primary" href={`/admin/incidents/${encodeURIComponent(fireId)}/carte/importer`}>Importer le fond 3D</a></AdminEmptyState> : <div className="admin-spatial-layout">
      <div className="admin-spatial-scene-column">
        <div className="admin-spatial-camera-controls" role="group" aria-label="Contrôles de caméra 3D">
          <button type="button" onClick={() => setSceneReset((value) => value + 1)}>Recentrer</button>
          <span>Souris : rotation, déplacement et zoom</span>
        </div>
        {tiledSource ? <Suspense fallback={<AdminLoadingState label="Initialisation du moteur cartographique 3D…" />}><TiledSpatialScene3D key={sceneReset} source={tiledSource} overlayOriginWgs84={workspace.scene.origin_wgs84} cameraMode="orbit" drawMode={drawMode} overlayPoints={overlayPoints} overlayLines={overlayLines} onPick={(point) => void addTerrainPoint(point)} /></Suspense> : workspace.scene.asset_url ? <AdminIncidentSpatialEditor3D assetUrl={workspace.scene.asset_url} cameraMode="orbit" markers={workspace.markers} revisions={workspace.zone_revisions} draftPoints={draft.map((point) => point.gltf)} drawMode={drawMode} onTerrainPick={(point) => void addTerrainPoint(point)} /> : <AdminEmptyState title="Scène 3D incomplète">Aucun fichier de scène exploitable n’est associé à cette carte.</AdminEmptyState>}
      </div>
      <aside id="active-zone" className="admin-spatial-tools" aria-label="Outils d’édition du périmètre incendie">
        <h3>Périmètre de l’incendie</h3>
        <p>{draft.length ? `${draft.length} sommet${draft.length > 1 ? 's' : ''} en cours d’édition.` : currentLayer ? 'Un périmètre est enregistré. Vous pouvez le modifier ou tracer un nouveau contour.' : 'Aucun périmètre enregistré. Dessinez-le directement sur le terrain.'}{movingDraftIndex !== null ? ` Cliquez sur le relief pour déplacer le sommet ${movingDraftIndex + 1}.` : ''}</p>
        {currentLayer && draft.length === 0 ? <button type="button" className="button button--primary" onClick={() => resumeRevision(currentLayer)} disabled={busy}>Modifier le périmètre actuel</button> : null}
        <div className="admin-spatial-actions"><button type="button" className="button" onClick={() => { setDrawMode((value) => !value); setMovingDraftIndex(null); }} disabled={busy}>{drawMode ? 'Arrêter le dessin' : currentLayer ? 'Tracer un nouveau contour' : 'Dessiner le périmètre'}</button><button type="button" className="button button--small" onClick={() => { setDraft((current) => current.slice(0, -1)); setMovingDraftIndex(null); }} disabled={!draft.length || busy}>Annuler le dernier point</button><button type="button" className="button button--small" onClick={() => { setDraft([]); setMovingDraftIndex(null); }} disabled={!draft.length || busy}>Vider</button></div>
        {draft.length ? <ol className="admin-spatial-vertices" aria-label="Sommets du contour en cours">{draft.map((point, index) => <li key={`${point.gltf.join(':')}-${index}`} className={movingDraftIndex === index ? 'is-moving' : ''}><span>Sommet {index + 1}<small>{point.wgs84[1].toFixed(5)}, {point.wgs84[0].toFixed(5)}</small></span><div><button type="button" className="button button--small" disabled={busy} aria-pressed={movingDraftIndex === index} onClick={() => { setDrawMode(true); setMovingDraftIndex((current) => current === index ? null : index); }}>{movingDraftIndex === index ? 'Annuler déplacement' : 'Déplacer'}</button><button type="button" className="button button--small" disabled={busy} onClick={() => { setDraft((current) => current.filter((_, pointIndex) => pointIndex !== index)); setMovingDraftIndex(null); }}>Retirer</button></div></li>)}</ol> : null}
        <details className="admin-disclosure"><summary>Justificatifs et note interne</summary><label>Note de modification<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} /></label><fieldset><legend>Repères justificatifs validés</legend>{validatedMarkerIds.length ? validatedMarkerIds.map((markerId) => <label key={markerId}><input type="checkbox" checked={supportingMarkers.includes(markerId)} onChange={() => setSupportingMarkers((current) => current.includes(markerId) ? current.filter((id) => id !== markerId) : [...current, markerId])} />{markerId}</label>) : <p>Aucun repère validé.</p>}</fieldset></details>
        <button type="button" className="button button--primary" onClick={saveDraft} disabled={draft.length < 3 || busy}>Enregistrer le calque</button>
      </aside>
    </div>}

    <details className="admin-section admin-disclosure admin-spatial-secondary"><summary>Détails, calques enregistrés et historique</summary><div className="admin-spatial-secondary__content">
    <section id="markers" className="admin-section"><div className="admin-section__heading"><div><h3>Points et marqueurs importés</h3><p>Ils servent de références dans la scène. Leur permission d’affichage public reste distincte.</p></div></div><div className="admin-spatial-records">{workspace.markers.map((marker) => <article key={marker.marker_id}><header><code>{marker.marker_id}</code><AdminStateLabel value={marker.review_state} /></header><p>{marker.marker_type} · {marker.geometry_origin} · ±{Math.round(marker.horizontal_accuracy_m ?? 0)} m</p>{marker.source_kind === 'agent_media' && marker.review_state === 'PENDING' ? <div className="admin-spatial-actions"><button type="button" className="button button--small" disabled={busy} onClick={() => void mutate(() => api.reviewIncidentSpatialMarker(fireId, marker.marker_id, { action: 'validate', expected_version: marker.version, reason: 'Coordonnées et origine contrôlées dans la scène 3D et la preuve source.' }, { idempotencyKey: key('marker-valid') }), 'Marqueur validé.')}>Valider</button><button type="button" className="button button--small" disabled={busy} onClick={() => void mutate(() => api.reviewIncidentSpatialMarker(fireId, marker.marker_id, { action: 'reject', expected_version: marker.version, reason: 'Coordonnées incompatibles avec la preuve ou le référentiel de scène.' }, { idempotencyKey: key('marker-reject') }), 'Marqueur rejeté.')}>Rejeter</button></div> : null}</article>)}</div></section>

    <section className="admin-section"><div className="admin-section__heading"><div><h3>Calques enregistrés</h3><p>Modifiez, fusionnez ou retirez les contours sans toucher au fond 3D. L’historique technique reste conservé automatiquement.</p></div></div><div className="admin-spatial-records">{workspace.zone_revisions.length ? workspace.zone_revisions.map((revision) => <article key={revision.zone_revision_id}><header><label><input type="checkbox" checked={mergeIds.includes(revision.zone_revision_id)} disabled={revision.review_state === 'REJECTED'} onChange={() => setMergeIds((current) => current.includes(revision.zone_revision_id) ? current.filter((id) => id !== revision.zone_revision_id) : [...current, revision.zone_revision_id])} /><strong>{revision.revision === latestRevision ? 'Calque actuel' : `Calque du ${formatAdminDate(revision.valid_at)}`}</strong></label><AdminStateLabel value={revision.review_state} /></header><p>{formatAdminDate(revision.valid_at)}</p><p>{revision.reason}</p><div className="admin-spatial-actions">{revision.review_state !== 'REJECTED' ? <button type="button" className="button button--small" onClick={() => resumeRevision(revision)} disabled={busy}>Modifier</button> : null}{revision.review_state === 'DRAFT' ? <button type="button" className="button button--small" disabled={busy} onClick={() => void mutate(() => api.reviewActiveFireZoneRevision(fireId, revision.zone_revision_id, { action: 'approve', expected_state: 'DRAFT', reason: 'Géométrie, repère 3D et justificatifs contrôlés par un opérateur humain.' }, { idempotencyKey: key('zone-approve') }), 'Calque validé. Il est prêt pour la publication.')}>Valider le calque</button> : null}{revision.review_state !== 'REJECTED' ? <button type="button" className="button button--small" disabled={busy} onClick={() => void mutate(() => api.reviewActiveFireZoneRevision(fireId, revision.zone_revision_id, { action: 'reject', expected_state: revision.review_state, reason: 'Calque retiré de la scène par un opérateur ; la trace reste conservée dans l’audit.' }, { idempotencyKey: key('zone-retract') }), 'Calque retiré de la carte et conservé dans l’historique.')}>Supprimer de la carte</button> : null}</div></article>) : <AdminEmptyState title="Aucun périmètre">Dessinez le contour directement sur le terrain.</AdminEmptyState>}</div>{mergeIds.length >= 2 ? <div className="admin-spatial-merge"><button type="button" className="button button--primary" disabled={busy} onClick={() => void mutate(() => api.mergeActiveFireZoneRevisions(fireId, { expected_latest_revision: latestRevision, source_revision_ids: mergeIds, valid_at: new Date().toISOString(), supporting_marker_ids: supportingMarkers, reason: 'Fusion topologique contrôlée depuis l’espace de revue 3D administrateur.' }, { idempotencyKey: key('zone-merge') }), 'Calques fusionnés dans un nouveau brouillon privé.').then((saved) => { if (saved) setMergeIds([]); })}>Fusionner les calques sélectionnés</button></div> : null}</section>

    <section className="admin-section"><div className="admin-section__heading"><div><h3>Résultats agentiques complets</h3><p>Une sortie partielle ne peut pas être approuvée. L’approbation ne modifie aucune donnée publique.</p></div></div><div className="admin-spatial-records">{workspace.agent_reviews.length ? workspace.agent_reviews.map((review) => <article key={review.review_id}><header><code>{review.batch_id}</code><AdminStateLabel value={review.state} /></header><p>{review.reason_codes.join(' · ')}</p><details><summary>Voir le paquet de résultat privé</summary><pre>{JSON.stringify(review.result, null, 2)}</pre></details>{review.state === 'PENDING' || review.state === 'IN_REVIEW' ? <div className="admin-spatial-actions"><button type="button" className="button button--small" disabled={busy || review.result?.status !== 'succeeded'} onClick={() => void mutate(() => api.resolveIncidentAgentReview(fireId, review.review_id, { action: 'approve', expected_state: review.state as 'PENDING' | 'IN_REVIEW', reason: 'Paquet complet contrôlé humainement dans le dossier et la scène 3D.' }, { idempotencyKey: key('agent-approve') }), 'Résultat agentique approuvé, sans publication automatique.')}>Approuver le paquet complet</button><button type="button" className="button button--small" disabled={busy} onClick={() => void mutate(() => api.resolveIncidentAgentReview(fireId, review.review_id, { action: 'reject', expected_state: review.state as 'PENDING' | 'IN_REVIEW', reason: 'Paquet incomplet ou incohérent avec les preuves disponibles.' }, { idempotencyKey: key('agent-reject') }), 'Résultat agentique rejeté.')}>Rejeter</button></div> : null}</article>) : <AdminEmptyState title="Aucun résultat agentique">Aucun lot lié à cet épisode n’attend de validation.</AdminEmptyState>}</div></section>
    </div></details>
  </section>;
}
