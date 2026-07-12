from __future__ import annotations

from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from fire_viewer.core.config import Settings
from fire_viewer.core.time import as_utc
from fire_viewer.db.models import (
    Episode,
    IncidentSeries,
    ManifestRevision,
    ModelAsset,
    SpatialZoneRevision,
    ZoneArchiveSnapshot,
)
from fire_viewer.domain.enums import AssetState, IncidentStatus, PublicVisibility
from fire_viewer.domain.errors import DomainError, NotFoundError
from fire_viewer.domain.schemas import (
    EpisodeSummary,
    IncidentPublicResponse,
    ManifestAsset,
    ManifestFrame,
    ManifestFreshness,
    ManifestStatus,
    PointGeometryInput,
    ViewerManifest,
)
from fire_viewer.domain.spatial import SpatialProfileError, validate_raf20_derivation


def _load_incident(session: Session, fire_id: str) -> IncidentSeries:
    incident = session.execute(
        select(IncidentSeries)
        .where(IncidentSeries.fire_id == fire_id)
        .options(selectinload(IncidentSeries.episodes))
    ).scalar_one_or_none()
    if incident is None:
        raise NotFoundError("incident", fire_id)
    if incident.public_visibility == PublicVisibility.TOMBSTONED:
        raise DomainError(
            status_code=410,
            code="incident_gone",
            title="Incident no longer available",
            detail=f"Incident '{fire_id}' has been tombstoned.",
        )
    return incident


def _current_episode(incident: IncidentSeries) -> Episode:
    current = next((episode for episode in incident.episodes if episode.is_current), None)
    if current is None:
        raise DomainError(
            status_code=503,
            code="incident_inconsistent",
            title="Incident data unavailable",
            detail="The incident has no current episode.",
        )
    return current


def _public_location(incident: IncidentSeries, current: Episode) -> PointGeometryInput | None:
    if (
        incident.public_visibility != PublicVisibility.PUBLIC
        or current.status == IncidentStatus.SUSPENDED
    ):
        return None
    return PointGeometryInput(
        coordinates=(incident.reference_lon, incident.reference_lat),
        horizontal_uncertainty_m=incident.horizontal_uncertainty_m,
    )


def get_incident_public(session: Session, fire_id: str) -> IncidentPublicResponse:
    incident = _load_incident(session, fire_id)
    current = _current_episode(incident)
    return IncidentPublicResponse(
        fire_id=incident.fire_id,
        canonical_name=incident.canonical_name,
        visibility=incident.public_visibility,
        status=current.status,
        current_episode_id=current.episode_id,
        location=_public_location(incident, current),
        public_note=incident.public_note,
        last_observed_at=as_utc(current.last_observed_at),
        created_at=as_utc(incident.created_at),
        episodes=[
            EpisodeSummary(
                episode_id=episode.episode_id,
                ordinal=episode.ordinal,
                status=episode.status,
                review_required=episode.review_required,
                started_at=as_utc(episode.started_at),
                last_observed_at=as_utc(episode.last_observed_at),
                validated_at=as_utc(episode.validated_at) if episode.validated_at else None,
                ended_at=as_utc(episode.ended_at) if episode.ended_at else None,
                is_current=episode.is_current,
                version=episode.version,
            )
            for episode in sorted(incident.episodes, key=lambda item: item.ordinal, reverse=True)
        ],
    )


def get_viewer_manifest(
    session: Session,
    fire_id: str,
    settings: Settings,
) -> ViewerManifest:
    incident = _load_incident(session, fire_id)
    current = _current_episode(incident)
    location = _public_location(incident, current)
    withheld = location is None
    archived = False
    if current.status == IncidentStatus.CLOSED:
        archived = (
            session.execute(
                select(ZoneArchiveSnapshot.id)
                .join(
                    ManifestRevision,
                    ManifestRevision.id == ZoneArchiveSnapshot.manifest_revision_id,
                )
                .where(
                    ZoneArchiveSnapshot.incident_id == incident.id,
                    ManifestRevision.incident_id == incident.id,
                    ManifestRevision.episode_id == current.id,
                    ManifestRevision.is_current.is_(True),
                )
            ).scalar_one_or_none()
            is not None
        )

    revision_row = session.execute(
        select(ManifestRevision, ModelAsset, SpatialZoneRevision)
        .outerjoin(ModelAsset, ModelAsset.id == ManifestRevision.asset_id)
        .outerjoin(
            SpatialZoneRevision,
            SpatialZoneRevision.id == ManifestRevision.spatial_zone_revision_id,
        )
        .where(
            ManifestRevision.incident_id == incident.id,
            ManifestRevision.episode_id == current.id,
            ManifestRevision.is_current.is_(True),
        )
    ).one_or_none()

    asset_payload: ManifestAsset | None = None
    frame_payload: ManifestFrame | None = None
    terrain_source_year: int | None = None
    generated_at = None
    model_state: Literal["available", "not_available", "withheld"]

    if withheld:
        model_state = "withheld"
    elif archived:
        # The immutable archive retains a PNG internally.  It intentionally does not leak a
        # historic GLB, a viewer frame, or an archive URL through the public v2 manifest.
        model_state = "not_available"
    elif revision_row is None or revision_row[1] is None or revision_row[2] is None:
        model_state = "not_available"
    else:
        _revision, asset, spatial_zone_revision = revision_row
        if (
            asset.state != AssetState.PUBLISHED
            or asset.spatial_zone_revision_id != spatial_zone_revision.id
        ):
            model_state = "not_available"
        else:
            try:
                validate_raf20_derivation(
                    spatial_zone_revision.origin_lon,
                    spatial_zone_revision.origin_lat,
                    spatial_zone_revision.source_orthometric_height_m,
                    spatial_zone_revision.geoid_undulation_m,
                    spatial_zone_revision.origin_ellipsoid_height_m,
                )
            except SpatialProfileError:
                # A manually injected or corrupted revision is never projected publicly.
                model_state = "not_available"
            else:
                model_state = "available"
                asset_payload = ManifestAsset(
                    asset_id=asset.asset_id,
                    version=asset.version,
                    url=asset.glb_url,
                    sha256=asset.sha256,
                    size_bytes=asset.size_bytes,
                    lod=asset.lod,
                )
                frame_payload = ManifestFrame(
                    origin_wgs84=(
                        spatial_zone_revision.origin_lon,
                        spatial_zone_revision.origin_lat,
                        spatial_zone_revision.origin_ellipsoid_height_m,
                    ),
                    local_frame=spatial_zone_revision.local_frame,
                    meters_per_unit=spatial_zone_revision.meters_per_unit,
                    vertical_datum=spatial_zone_revision.vertical_datum,
                )
                terrain_source_year = asset.terrain_source_year
                generated_at = as_utc(asset.generated_at)

    notice = settings.public_notice
    if incident.public_note:
        notice = f"{notice} {incident.public_note}"
    if archived:
        notice = f"{notice} 3D viewer asset is no longer available for this archived incident."

    return ViewerManifest(
        schema_version="2.0",
        fire_id=incident.fire_id,
        episode_id=current.episode_id,
        status=ManifestStatus(
            code=current.status,
            validated_at=as_utc(current.validated_at) if current.validated_at else None,
            review_required=current.review_required,
        ),
        location=location,
        asset=asset_payload,
        frame=frame_payload,
        freshness=ManifestFreshness(
            incident_at=as_utc(current.last_observed_at),
            terrain_source_year=terrain_source_year,
            generated_at=generated_at,
        ),
        model_state=model_state,
        public_notice=notice,
    )
