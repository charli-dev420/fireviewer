"""Atomic project-scoped import of one private 3D base map."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from fire_viewer.core.config import Settings
from fire_viewer.core.security import Actor
from fire_viewer.db.models import IncidentSeries, SpatialZone, SpatialZoneRevision
from fire_viewer.db.transactions import begin_write_transaction
from fire_viewer.domain.errors import NotFoundError
from fire_viewer.domain.hashing import sha256_hex
from fire_viewer.domain.schemas import (
    AdminIncidentRepresentationAttachRequest,
    AdminIncidentSpatialPackageFromBlobRequest,
    AdminIncidentSpatialPackageImportResponse,
)
from fire_viewer.services.admin_representations import (
    attach_incident_package_in_transaction,
)
from fire_viewer.services.idempotency import find_replay, store_response
from fire_viewer.services.spatial_package_blob_import import (
    ValidatedBlobPackage,
    persist_validated_blob_package,
)
from fire_viewer.services.spatial_package_publication import (
    make_spatial_package_previewable,
)


@dataclass(frozen=True, slots=True)
class IncidentSpatialPackageImportOutcome:
    response: AdminIncidentSpatialPackageImportResponse
    replayed: bool


def import_incident_spatial_package(
    session: Session,
    *,
    fire_id: str,
    payload: AdminIncidentSpatialPackageFromBlobRequest,
    validated: ValidatedBlobPackage,
    idempotency_key: str,
    actor: Actor,
    trace_id: str,
    settings: Settings,
) -> IncidentSpatialPackageImportOutcome:
    """Register, validate, preview and attach the map in one database transaction."""

    endpoint = f"POST /api/v2/admin/incidents/{fire_id}/spatial-package/from-blob"
    request_hash = sha256_hex(
        {
            "actor_id": actor.actor_id,
            "fire_id": fire_id,
            "payload": payload.model_dump(mode="json"),
        }
    )
    begin_write_transaction(session)
    replay = find_replay(
        session,
        endpoint=endpoint,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if replay:
        session.rollback()
        return IncidentSpatialPackageImportOutcome(
            AdminIncidentSpatialPackageImportResponse.model_validate(replay.response_body),
            True,
        )

    incident = session.execute(
        select(IncidentSeries)
        .where(IncidentSeries.fire_id == fire_id)
        .options(selectinload(IncidentSeries.episodes))
        .with_for_update()
    ).scalar_one_or_none()
    if incident is None:
        raise NotFoundError("incident", fire_id)
    revision = session.execute(
        select(SpatialZoneRevision)
        .join(SpatialZone)
        .where(
            SpatialZone.zone_id == payload.zone_id,
            SpatialZoneRevision.revision == payload.revision,
        )
        .options(selectinload(SpatialZoneRevision.zone))
        .with_for_update()
    ).scalar_one_or_none()
    if revision is None:
        raise NotFoundError(
            "spatial_zone_revision",
            f"{payload.zone_id}/revisions/{payload.revision}",
        )

    package = persist_validated_blob_package(
        session,
        zone_id=payload.zone_id,
        revision=payload.revision,
        validated=validated,
        actor=actor,
        settings=settings,
    )
    make_spatial_package_previewable(
        session,
        revision=revision,
        package=package,
        reason=payload.reason,
        actor=actor,
        trace_id=trace_id,
    )
    attachment = attach_incident_package_in_transaction(
        session,
        incident=incident,
        package=package,
        payload=AdminIncidentRepresentationAttachRequest(
            package_id=package.package_id,
            expected_incident_version=payload.expected_incident_version,
            primary_profile=payload.primary_profile,
            reason=payload.reason,
        ),
        actor=actor,
        trace_id=trace_id,
        settings=settings,
    )
    response = AdminIncidentSpatialPackageImportResponse(
        fire_id=attachment.fire_id,
        episode_id=attachment.episode_id,
        package_id=package.package_id,
        package_state=package.state,
        zone_id=payload.zone_id,
        revision=payload.revision,
        manifest_revision=attachment.manifest_revision,
        incident_version=attachment.incident_version,
        object_count=validated.object_count,
        total_size_bytes=validated.total_size_bytes,
        asset_count=len(package.files),
        trace_id=trace_id,
    )
    store_response(
        session,
        endpoint=endpoint,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        response_status=201,
        response_body=response.model_dump(mode="json"),
        trace_id=trace_id,
        settings=settings,
    )
    session.commit()
    return IncidentSpatialPackageImportOutcome(response, False)
