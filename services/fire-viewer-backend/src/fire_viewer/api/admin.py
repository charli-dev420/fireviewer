from __future__ import annotations

from typing import Annotated, Literal, NoReturn

from fastapi import APIRouter, Path
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from fire_viewer.api.dependencies import ActorDep, SessionDep
from fire_viewer.core.security import Actor, require_role
from fire_viewer.db.models import SpatialPackage, SpatialZone, SpatialZoneRevision
from fire_viewer.domain.errors import DomainError, NotFoundError
from fire_viewer.domain.schemas import StrictModel

router = APIRouter(prefix="/admin", tags=["admin"])

ZoneIdPath = Annotated[str, Path(min_length=3, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")]
RevisionPath = Annotated[int, Path(ge=1)]


class AdminZoneRevisionSummary(StrictModel):
    revision: int
    origin_wgs84: tuple[float, float, float]
    local_frame: Literal["ENU"]
    meters_per_unit: float
    vertical_datum: str
    bounds_m: dict[str, tuple[float, float]]


class AdminZoneSummary(StrictModel):
    zone_id: str
    label: str | None
    revisions: list[AdminZoneRevisionSummary] = Field(default_factory=list)


class AdminZoneListResponse(StrictModel):
    zones: list[AdminZoneSummary]


class AdminEndpointStatus(StrictModel):
    status: Literal["not_implemented"]
    detail: str


class AdminPrivatePreviewFile(StrictModel):
    kind: str
    sha256: str
    size_bytes: int
    media_type: str


class AdminPrivatePreviewResponse(StrictModel):
    zone_id: str
    revision: int
    preview_scope: Literal["private-admin"]
    package_id: str | None
    package_state: str | None
    verification_report: dict[str, object]
    files: list[AdminPrivatePreviewFile] = Field(default_factory=list)


def _require_admin(actor: Actor) -> None:
    require_role(actor, "administrator")


def _revision_summary(revision: SpatialZoneRevision) -> AdminZoneRevisionSummary:
    return AdminZoneRevisionSummary(
        revision=revision.revision,
        origin_wgs84=(
            revision.origin_lon,
            revision.origin_lat,
            revision.origin_ellipsoid_height_m,
        ),
        local_frame="ENU",
        meters_per_unit=revision.meters_per_unit,
        vertical_datum=revision.vertical_datum,
        bounds_m={
            "east": (revision.min_east_m, revision.max_east_m),
            "north": (revision.min_north_m, revision.max_north_m),
            "up": (revision.min_up_m, revision.max_up_m),
        },
    )


def _zone_summary(zone: SpatialZone) -> AdminZoneSummary:
    return AdminZoneSummary(
        zone_id=zone.zone_id,
        label=zone.label,
        revisions=[_revision_summary(revision) for revision in zone.revisions],
    )


def _not_implemented(feature: str) -> NoReturn:
    raise DomainError(
        status_code=501,
        code="admin_endpoint_not_implemented",
        title="Administration endpoint not implemented",
        detail=f"The admin endpoint for {feature} is reserved for the MVP administration workflow.",
    )


@router.get("/zones", response_model=AdminZoneListResponse)
def list_zones(actor: ActorDep, session: SessionDep) -> AdminZoneListResponse:
    _require_admin(actor)
    zones = session.execute(
        select(SpatialZone)
        .options(selectinload(SpatialZone.revisions))
        .order_by(SpatialZone.zone_id)
    ).scalars().all()
    return AdminZoneListResponse(zones=[_zone_summary(zone) for zone in zones])


@router.post("/zones", response_model=AdminEndpointStatus, status_code=501)
def create_zone(actor: ActorDep) -> AdminEndpointStatus:
    _require_admin(actor)
    _not_implemented("zone creation")


@router.get("/zones/{zone_id}", response_model=AdminZoneSummary)
def get_zone(zone_id: ZoneIdPath, actor: ActorDep, session: SessionDep) -> AdminZoneSummary:
    _require_admin(actor)
    zone = session.execute(
        select(SpatialZone)
        .where(SpatialZone.zone_id == zone_id)
        .options(selectinload(SpatialZone.revisions))
    ).scalar_one_or_none()
    if zone is None:
        raise NotFoundError("spatial_zone", zone_id)
    return _zone_summary(zone)


@router.post("/zones/{zone_id}/revisions", response_model=AdminEndpointStatus, status_code=501)
def create_zone_revision(zone_id: ZoneIdPath, actor: ActorDep) -> AdminEndpointStatus:
    _require_admin(actor)
    _not_implemented(f"revision creation for zone {zone_id}")


@router.get("/zones/{zone_id}/revisions/{revision}", response_model=AdminZoneRevisionSummary)
def get_zone_revision(
    zone_id: ZoneIdPath,
    revision: RevisionPath,
    actor: ActorDep,
    session: SessionDep,
) -> AdminZoneRevisionSummary:
    _require_admin(actor)
    row = session.execute(
        select(SpatialZoneRevision)
        .join(SpatialZone)
        .where(SpatialZone.zone_id == zone_id, SpatialZoneRevision.revision == revision)
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("spatial_zone_revision", f"{zone_id}/revisions/{revision}")
    return _revision_summary(row)


@router.post(
    "/zones/{zone_id}/revisions/{revision}/packages",
    response_model=AdminEndpointStatus,
    status_code=501,
)
def submit_zone_package(
    zone_id: ZoneIdPath,
    revision: RevisionPath,
    actor: ActorDep,
) -> AdminEndpointStatus:
    _require_admin(actor)
    _not_implemented(f"package submission for zone {zone_id} revision {revision}")


@router.post(
    "/zones/{zone_id}/revisions/{revision}/validations",
    response_model=AdminEndpointStatus,
    status_code=501,
)
def validate_zone_revision(
    zone_id: ZoneIdPath,
    revision: RevisionPath,
    actor: ActorDep,
) -> AdminEndpointStatus:
    _require_admin(actor)
    _not_implemented(f"validation for zone {zone_id} revision {revision}")




@router.get(
    "/zones/{zone_id}/revisions/{revision}/preview",
    response_model=AdminPrivatePreviewResponse,
)
def get_private_preview(
    zone_id: ZoneIdPath,
    revision: RevisionPath,
    actor: ActorDep,
    session: SessionDep,
) -> AdminPrivatePreviewResponse:
    _require_admin(actor)
    revision_row = session.execute(
        select(SpatialZoneRevision)
        .join(SpatialZone)
        .where(SpatialZone.zone_id == zone_id, SpatialZoneRevision.revision == revision)
    ).scalar_one_or_none()
    if revision_row is None:
        raise NotFoundError("spatial_zone_revision", f"{zone_id}/revisions/{revision}")

    package = session.execute(
        select(SpatialPackage)
        .where(SpatialPackage.spatial_zone_revision_id == revision_row.id)
        .options(selectinload(SpatialPackage.files))
        .order_by(SpatialPackage.created_at.desc(), SpatialPackage.id.desc())
        .limit(1)
    ).scalar_one_or_none()

    return AdminPrivatePreviewResponse(
        zone_id=zone_id,
        revision=revision,
        preview_scope="private-admin",
        package_id=package.package_id if package else None,
        package_state=str(package.state) if package else None,
        verification_report=package.verification_report if package else {},
        files=[
            AdminPrivatePreviewFile(
                kind=str(file.kind),
                sha256=file.sha256,
                size_bytes=file.size_bytes,
                media_type=file.media_type,
            )
            for file in (package.files if package else [])
        ],
    )


@router.post(
    "/zones/{zone_id}/revisions/{revision}/preview",
    response_model=AdminEndpointStatus,
    status_code=501,
)
def create_zone_preview(
    zone_id: ZoneIdPath,
    revision: RevisionPath,
    actor: ActorDep,
) -> AdminEndpointStatus:
    _require_admin(actor)
    _not_implemented(f"private preview for zone {zone_id} revision {revision}")


@router.get("/publications", response_model=AdminEndpointStatus, status_code=501)
def list_publications(actor: ActorDep) -> AdminEndpointStatus:
    _require_admin(actor)
    _not_implemented("publication listing")


@router.post("/publications", response_model=AdminEndpointStatus, status_code=501)
def publish_revision(actor: ActorDep) -> AdminEndpointStatus:
    _require_admin(actor)
    _not_implemented("explicit publication")
