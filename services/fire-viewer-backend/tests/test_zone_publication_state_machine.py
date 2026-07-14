from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from fire_viewer.db.models import (
    SpatialPackage,
    SpatialZone,
    SpatialZoneRevision,
    ZonePublication,
    ZonePublicationEvent,
)
from fire_viewer.domain.enums import SpatialPackageState, ZonePublicationState
from fire_viewer.domain.errors import ConflictError
from fire_viewer.domain.spatial import RAF20_GRID_SHA256
from fire_viewer.domain.zone_publication import assert_zone_publication_transition


def seed_publication_dependencies(
    session: Session,
    *,
    suffix: str = "1",
) -> tuple[SpatialZone, SpatialZoneRevision, SpatialPackage]:
    zone = SpatialZone(zone_id=f"publication-zone-{suffix}", label="Publication zone")
    session.add(zone)
    session.flush()
    revision = SpatialZoneRevision(
        spatial_zone_id=zone.id,
        revision=1,
        origin_lon=5.2601,
        origin_lat=44.7555,
        source_orthometric_height_m=410.0,
        geoid_undulation_m=50.0,
        origin_ellipsoid_height_m=460.0,
        vertical_grid_sha256=RAF20_GRID_SHA256,
        min_east_m=-100.0,
        max_east_m=100.0,
        min_north_m=-120.0,
        max_north_m=120.0,
        min_up_m=-10.0,
        max_up_m=50.0,
    )
    session.add(revision)
    session.flush()
    package = SpatialPackage(
        package_id=f"pkg-publication-{suffix}",
        manifest_uri=f"s3://fire-viewer-admin/packages/pkg-publication-{suffix}/manifest.json",
        manifest_sha256="a" * 64,
        manifest_size_bytes=512,
        storage_uri=f"s3://fire-viewer-admin/packages/pkg-publication-{suffix}/",
        state=SpatialPackageState.VERIFIED,
        provenance={},
        verification_report={"status": "passed"},
        created_by="admin-ui-test",
        verified_at=datetime.now(UTC),
        spatial_zone_revision_id=revision.id,
    )
    session.add(package)
    session.flush()
    return zone, revision, package


def test_zone_publication_state_machine_allows_documented_path_and_blocks_skips() -> None:
    assert_zone_publication_transition(ZonePublicationState.DRAFT, ZonePublicationState.VERIFIED)
    assert_zone_publication_transition(
        ZonePublicationState.VERIFIED,
        ZonePublicationState.PREVIEWABLE,
    )
    assert_zone_publication_transition(
        ZonePublicationState.PREVIEWABLE,
        ZonePublicationState.PUBLISHED,
    )
    assert_zone_publication_transition(
        ZonePublicationState.PUBLISHED,
        ZonePublicationState.WITHDRAWN,
    )

    with pytest.raises(ConflictError):
        assert_zone_publication_transition(
            ZonePublicationState.DRAFT,
            ZonePublicationState.PUBLISHED,
        )


def test_zone_publication_published_state_is_the_single_active_revision(session: Session) -> None:
    zone, revision, package = seed_publication_dependencies(session)
    publication = ZonePublication(
        publication_id="pub-zone-1-r1",
        spatial_zone_id=zone.id,
        spatial_zone_revision_id=revision.id,
        spatial_package_id=package.id,
        state=ZonePublicationState.PUBLISHED,
        is_active=True,
        reason="Initial explicit publication.",
        actor_id="admin-ui-test",
        events=[
            ZonePublicationEvent(
                event_id="pub-zone-1-r1-created",
                from_state=None,
                to_state=ZonePublicationState.PUBLISHED,
                action="publish",
                reason="Initial explicit publication.",
                actor_id="admin-ui-test",
                event_metadata={"source": "admin"},
            )
        ],
    )
    session.add(publication)
    session.commit()

    duplicate = ZonePublication(
        publication_id="pub-zone-1-r1-duplicate",
        spatial_zone_id=zone.id,
        spatial_zone_revision_id=revision.id,
        spatial_package_id=package.id,
        state=ZonePublicationState.PUBLISHED,
        is_active=True,
        reason="Should fail because active revision is explicit and unique.",
        actor_id="admin-ui-test",
    )
    session.add(duplicate)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_zone_publication_events_are_append_only_in_sqlite(session: Session) -> None:
    zone, revision, package = seed_publication_dependencies(session, suffix="events")
    publication = ZonePublication(
        publication_id="pub-zone-events-r1",
        spatial_zone_id=zone.id,
        spatial_zone_revision_id=revision.id,
        spatial_package_id=package.id,
        state=ZonePublicationState.VERIFIED,
        is_active=False,
        reason="Verified package.",
        actor_id="admin-ui-test",
        events=[
            ZonePublicationEvent(
                event_id="pub-zone-events-verified",
                from_state=ZonePublicationState.DRAFT,
                to_state=ZonePublicationState.VERIFIED,
                action="verify",
                reason="Verification report passed.",
                actor_id="admin-ui-test",
                event_metadata={"report": "passed"},
            )
        ],
    )
    session.add(publication)
    session.commit()

    publication.events[0].reason = "tamper"
    with pytest.raises(DBAPIError):
        session.commit()
