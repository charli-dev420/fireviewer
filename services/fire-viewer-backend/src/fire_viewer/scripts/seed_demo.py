from __future__ import annotations

import os
from datetime import UTC, datetime

from sqlalchemy import select

from fire_viewer.core.config import get_settings
from fire_viewer.core.ids import new_asset_id
from fire_viewer.db.engine import create_db_engine, create_session_factory
from fire_viewer.db.models import (
    Episode,
    FireIdCounter,
    IncidentSeries,
    ManifestRevision,
    ModelAsset,
    Source,
    SpatialZone,
    SpatialZoneRevision,
)
from fire_viewer.domain.enums import (
    AssetLod,
    AssetState,
    IncidentStatus,
    PublicVisibility,
    SourceTrust,
    SourceType,
)
from fire_viewer.domain.geospatial import bbox_for_point
from fire_viewer.domain.spatial import derive_raf20_origin


def main() -> None:
    settings = get_settings()
    engine = create_db_engine(settings)
    factory = create_session_factory(engine)
    with factory() as session:
        existing = session.execute(
            select(IncidentSeries).where(IncidentSeries.fire_id == "FR-83-00042")
        ).scalar_one_or_none()
        if existing:
            print("FR-83-00042 already exists")
            return

        source = session.execute(
            select(Source).where(Source.source_key == "demo-operator")
        ).scalar_one_or_none()
        if source is None:
            source = Source(
                source_key="demo-operator",
                source_type=SourceType.OPERATOR,
                trust=SourceTrust.OPERATOR,
                display_name="Demo operator",
                enabled=True,
            )
            session.add(source)

        counter = session.get(FireIdCounter, "83")
        if counter is None:
            session.add(FireIdCounter(territory_code="83", next_sequence=43))
        else:
            counter.next_sequence = max(counter.next_sequence, 43)

        lon, lat, uncertainty = 6.0214, 43.2897, 220.0
        bbox = bbox_for_point(lon, lat, uncertainty)
        incident = IncidentSeries(
            fire_id="FR-83-00042",
            territory_code="83",
            sequence=42,
            canonical_name="Massif des Maures — secteur Nord",
            reference_lon=lon,
            reference_lat=lat,
            horizontal_uncertainty_m=uncertainty,
            bbox_min_lon=bbox.min_lon,
            bbox_max_lon=bbox.max_lon,
            bbox_min_lat=bbox.min_lat,
            bbox_max_lat=bbox.max_lat,
            public_visibility=PublicVisibility.PUBLIC,
            version=1,
        )
        session.add(incident)
        session.flush()

        episodes = [
            Episode(
                incident_id=incident.id,
                episode_id="E01",
                ordinal=1,
                status=IncidentStatus.CLOSED,
                review_required=False,
                is_current=False,
                confidence_policy=settings.matching_policy_id,
                started_at=datetime(2024, 7, 19, 8, 0, tzinfo=UTC),
                last_observed_at=datetime(2024, 7, 19, 18, 0, tzinfo=UTC),
                ended_at=datetime(2024, 7, 20, 8, 0, tzinfo=UTC),
                version=2,
            ),
            Episode(
                incident_id=incident.id,
                episode_id="E02",
                ordinal=2,
                status=IncidentStatus.CLOSED,
                review_required=False,
                is_current=False,
                confidence_policy=settings.matching_policy_id,
                started_at=datetime(2025, 8, 4, 9, 0, tzinfo=UTC),
                last_observed_at=datetime(2025, 8, 4, 16, 0, tzinfo=UTC),
                ended_at=datetime(2025, 8, 5, 8, 0, tzinfo=UTC),
                version=2,
            ),
            Episode(
                incident_id=incident.id,
                episode_id="E03",
                ordinal=3,
                status=IncidentStatus.MONITORING,
                review_required=False,
                is_current=True,
                confidence_policy=settings.matching_policy_id,
                started_at=datetime(2026, 7, 12, 8, 5, tzinfo=UTC),
                last_observed_at=datetime(2026, 7, 12, 8, 24, tzinfo=UTC),
                validated_at=datetime(2026, 7, 12, 8, 5, tzinfo=UTC),
                version=4,
            ),
        ]
        session.add_all(episodes)
        session.flush()

        asset_url = os.getenv("FV_DEMO_ASSET_URL")
        asset_sha256 = os.getenv("FV_DEMO_ASSET_SHA256")
        if asset_url and asset_sha256 and len(asset_sha256) == 64:
            derived_origin = derive_raf20_origin(lon, lat, 412.7)
            spatial_zone = SpatialZone(
                zone_id="zone-demo-massif-des-maures",
                label="Demo local rural zone",
            )
            session.add(spatial_zone)
            session.flush()
            spatial_zone_revision = SpatialZoneRevision(
                spatial_zone_id=spatial_zone.id,
                revision=1,
                origin_lon=lon,
                origin_lat=lat,
                source_orthometric_height_m=derived_origin.source_orthometric_height_m,
                geoid_undulation_m=derived_origin.geoid_undulation_m,
                origin_ellipsoid_height_m=derived_origin.ellipsoid_height_m,
                min_east_m=-2_500.0,
                max_east_m=2_500.0,
                min_north_m=-2_500.0,
                max_north_m=2_500.0,
                min_up_m=-500.0,
                max_up_m=2_000.0,
            )
            session.add(spatial_zone_revision)
            session.flush()
            asset = ModelAsset(
                asset_id=new_asset_id(),
                spatial_zone_revision_id=spatial_zone_revision.id,
                version=4,
                lod=AssetLod.MOBILE,
                state=AssetState.PUBLISHED,
                glb_url=asset_url,
                sha256=asset_sha256,
                size_bytes=int(os.getenv("FV_DEMO_ASSET_SIZE_BYTES", "19503562")),
                terrain_source_year=2024,
                generated_at=datetime(2026, 7, 12, 8, 20, tzinfo=UTC),
                published_at=datetime(2026, 7, 12, 8, 20, tzinfo=UTC),
            )
            session.add(asset)
            session.flush()
            session.add(
                ManifestRevision(
                    incident_id=incident.id,
                    episode_id=episodes[-1].id,
                    asset_id=asset.id,
                    spatial_zone_revision_id=spatial_zone_revision.id,
                    revision=1,
                    is_current=True,
                    reason="Demo seed",
                    actor_id="seed-demo",
                )
            )

        session.commit()
        print("Seeded FR-83-00042")
    engine.dispose()


if __name__ == "__main__":
    main()
