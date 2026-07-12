from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from fire_viewer.db.models import ManifestRevision, ModelAsset, SpatialZone, SpatialZoneRevision
from fire_viewer.domain.enums import AssetLod, AssetState, IncidentStatus, PublicVisibility
from fire_viewer.domain.public_visibility import (
    CANONICAL_VISIBILITY_BY_STATUS,
    canonical_public_visibility,
    permits_public_location,
    permits_public_viewer_asset,
)
from fire_viewer.domain.schemas import ViewerManifest
from fire_viewer.domain.spatial import derive_raf20_origin


@pytest.mark.parametrize(
    ("status", "visibility", "location_allowed", "asset_allowed"),
    [
        (IncidentStatus.CANDIDATE, PublicVisibility.LIMITED, False, False),
        (IncidentStatus.UNDER_REVIEW, PublicVisibility.LIMITED, False, False),
        (IncidentStatus.REJECTED, PublicVisibility.LIMITED, False, False),
        (IncidentStatus.SUSPENDED, PublicVisibility.SUSPENDED, False, False),
        (IncidentStatus.ACTIVE_CONFIRMED, PublicVisibility.PUBLIC, True, True),
        (IncidentStatus.MONITORING, PublicVisibility.PUBLIC, True, True),
        (IncidentStatus.EXTINGUISHED, PublicVisibility.PUBLIC, True, True),
        (IncidentStatus.CLOSED, PublicVisibility.PUBLIC, True, False),
    ],
)
def test_canonical_visibility_mapping_covers_every_lifecycle_status(
    status: IncidentStatus,
    visibility: PublicVisibility,
    location_allowed: bool,
    asset_allowed: bool,
) -> None:
    assert set(CANONICAL_VISIBILITY_BY_STATUS) == set(IncidentStatus)
    assert canonical_public_visibility(status) == visibility
    assert permits_public_location(status, visibility) is location_allowed
    assert permits_public_viewer_asset(status, visibility) is asset_allowed


def _create_incident(client, payload_factory, key: str, longitude: float) -> str:
    response = client.post(
        "/api/v1/incident/detect",
        headers={"Idempotency-Key": key},
        json=payload_factory(
            content_char=key[-1],
            lon=longitude,
            canonical_name=f"Fictitious visibility policy location {longitude}",
        ),
    )
    assert response.status_code == 201
    return response.json()["fire_id"]


def _transition(
    client,
    *,
    fire_id: str,
    target: IncidentStatus,
    version: int,
    suffix: str,
) -> int:
    payload = {
        "target_status": target.value,
        "expected_version": version,
        "reason": "Exercise the canonical public visibility lifecycle policy.",
    }
    if target == IncidentStatus.ACTIVE_CONFIRMED:
        payload["validation_basis"] = "Authorized fictional validation basis for this test."
    response = client.post(
        f"/api/v1/operator/incidents/{fire_id}/transitions",
        headers={"Idempotency-Key": f"visibility-policy-{suffix}"},
        json=payload,
    )
    assert response.status_code == 200
    assert response.json()["status"] == target.value
    return response.json()["version"]


def _assert_public_state(client, fire_id: str, status: IncidentStatus) -> None:
    response = client.get(f"/api/v1/incident/{fire_id}")

    assert response.status_code == 200
    payload = response.json()
    expected_visibility = canonical_public_visibility(status)
    assert payload["status"] == status.value
    assert payload["visibility"] == expected_visibility.value
    assert (payload["location"] is not None) is permits_public_location(status, expected_visibility)


def test_operator_transitions_apply_the_canonical_visibility_policy(
    client, payload_factory
) -> None:
    rejected_id = _create_incident(client, payload_factory, "visibility-policy-rejected-0001", 6.0)
    _assert_public_state(client, rejected_id, IncidentStatus.CANDIDATE)
    version = _transition(
        client,
        fire_id=rejected_id,
        target=IncidentStatus.UNDER_REVIEW,
        version=1,
        suffix="review-0001",
    )
    _assert_public_state(client, rejected_id, IncidentStatus.UNDER_REVIEW)
    _transition(
        client,
        fire_id=rejected_id,
        target=IncidentStatus.REJECTED,
        version=version,
        suffix="rejected-0001",
    )
    _assert_public_state(client, rejected_id, IncidentStatus.REJECTED)

    suspended_id = _create_incident(
        client, payload_factory, "visibility-policy-suspended-0001", 6.2
    )
    _transition(
        client,
        fire_id=suspended_id,
        target=IncidentStatus.SUSPENDED,
        version=1,
        suffix="suspend-0001",
    )
    _assert_public_state(client, suspended_id, IncidentStatus.SUSPENDED)

    public_id = _create_incident(client, payload_factory, "visibility-policy-public-0001", 6.4)
    version = _transition(
        client,
        fire_id=public_id,
        target=IncidentStatus.ACTIVE_CONFIRMED,
        version=1,
        suffix="confirm-0001",
    )
    _assert_public_state(client, public_id, IncidentStatus.ACTIVE_CONFIRMED)
    version = _transition(
        client,
        fire_id=public_id,
        target=IncidentStatus.MONITORING,
        version=version,
        suffix="monitoring-0001",
    )
    _assert_public_state(client, public_id, IncidentStatus.MONITORING)
    version = _transition(
        client,
        fire_id=public_id,
        target=IncidentStatus.EXTINGUISHED,
        version=version,
        suffix="extinguished-0001",
    )
    _assert_public_state(client, public_id, IncidentStatus.EXTINGUISHED)
    _transition(
        client,
        fire_id=public_id,
        target=IncidentStatus.CLOSED,
        version=version,
        suffix="closed-0001",
    )
    _assert_public_state(client, public_id, IncidentStatus.CLOSED)


def _publish_valid_asset(session, incident, episode) -> None:
    origin = derive_raf20_origin(6.0214, 43.2897, 412.7)
    zone = SpatialZone(
        zone_id="zone-visibility-policy-fixture-0001",
        label="Fictitious public-visibility policy zone",
    )
    session.add(zone)
    session.flush()
    zone_revision = SpatialZoneRevision(
        spatial_zone_id=zone.id,
        revision=1,
        origin_lon=6.0214,
        origin_lat=43.2897,
        source_orthometric_height_m=origin.source_orthometric_height_m,
        geoid_undulation_m=origin.geoid_undulation_m,
        origin_ellipsoid_height_m=origin.ellipsoid_height_m,
        min_east_m=-2_500.0,
        max_east_m=2_500.0,
        min_north_m=-2_500.0,
        max_north_m=2_500.0,
        min_up_m=-500.0,
        max_up_m=2_000.0,
    )
    session.add(zone_revision)
    session.flush()
    generated_at = datetime(2026, 7, 12, 8, 20, tzinfo=UTC)
    asset = ModelAsset(
        asset_id="asset-visibility-policy-fixture-0001",
        spatial_zone_revision_id=zone_revision.id,
        version=1,
        lod=AssetLod.DESKTOP,
        state=AssetState.PUBLISHED,
        glb_url="https://assets.example.invalid/fire-viewer/visibility-policy/v1.glb",
        sha256="d" * 64,
        size_bytes=123_456,
        terrain_source_year=2024,
        generated_at=generated_at,
        published_at=generated_at,
    )
    session.add(asset)
    session.flush()
    session.add(
        ManifestRevision(
            incident_id=incident.id,
            episode_id=episode.id,
            asset_id=asset.id,
            spatial_zone_revision_id=zone_revision.id,
            revision=1,
            is_current=True,
            reason="Fictitious published asset used to test fail-closed visibility.",
            actor_id="visibility-policy-test",
        )
    )
    session.commit()


def test_manifest_fails_closed_for_an_incoherent_persisted_visibility_pair(
    client, session, seed_incident
) -> None:
    incident, episode = seed_incident(
        fire_id="FR-83-00090",
        sequence=90,
        lon=6.0214,
        lat=43.2897,
        status=IncidentStatus.MONITORING,
    )
    _publish_valid_asset(session, incident, episode)

    before_corruption = client.get(f"/api/v1/incident/{incident.fire_id}/manifest")
    assert before_corruption.status_code == 200
    assert before_corruption.json()["model_state"] == "available"
    assert before_corruption.json()["location"] is not None
    assert before_corruption.json()["asset"] is not None
    assert before_corruption.json()["frame"] is not None

    incident.public_visibility = PublicVisibility.LIMITED
    session.commit()

    manifest = client.get(f"/api/v1/incident/{incident.fire_id}/manifest")
    public_incident = client.get(f"/api/v1/incident/{incident.fire_id}")

    for response in (manifest, public_incident):
        assert response.status_code == 503
        assert response.headers["content-type"].startswith("application/problem+json")
        payload = response.json()
        assert payload["type"].endswith("incident_inconsistent")
        assert payload["trace_id"] == response.headers["X-Trace-Id"]
        assert {"location", "asset", "frame"}.isdisjoint(payload)


def test_closed_manifest_never_exposes_a_published_asset_or_frame(
    client, session, seed_incident
) -> None:
    incident, episode = seed_incident(
        fire_id="FR-83-00092",
        sequence=92,
        lon=6.0214,
        lat=43.2897,
        status=IncidentStatus.CLOSED,
    )
    _publish_valid_asset(session, incident, episode)

    manifest = client.get(f"/api/v1/incident/{incident.fire_id}/manifest")

    assert manifest.status_code == 200
    assert manifest.json()["model_state"] == "not_available"
    assert manifest.json()["location"] is not None
    assert manifest.json()["asset"] is None
    assert manifest.json()["frame"] is None


def test_viewer_manifest_rejects_lifecycle_states_that_cannot_publish_a_model(
    client, session, seed_incident
) -> None:
    incident, episode = seed_incident(
        fire_id="FR-83-00091",
        sequence=91,
        lon=6.0214,
        lat=43.2897,
        status=IncidentStatus.MONITORING,
    )
    _publish_valid_asset(session, incident, episode)
    available = client.get(f"/api/v1/incident/{incident.fire_id}/manifest").json()

    invalid_available = dict(available)
    invalid_available["status"] = dict(available["status"], code=IncidentStatus.UNDER_REVIEW)
    with pytest.raises(ValidationError, match="active public lifecycle"):
        ViewerManifest.model_validate(invalid_available)

    invalid_not_available = dict(available)
    invalid_not_available["status"] = dict(available["status"], code=IncidentStatus.REJECTED)
    invalid_not_available["asset"] = None
    invalid_not_available["frame"] = None
    invalid_not_available["model_state"] = "not_available"
    with pytest.raises(ValidationError, match="public lifecycle"):
        ViewerManifest.model_validate(invalid_not_available)

    invalid_withheld = dict(available)
    invalid_withheld["location"] = None
    invalid_withheld["asset"] = None
    invalid_withheld["frame"] = None
    invalid_withheld["model_state"] = "withheld"
    with pytest.raises(ValidationError, match="non-public lifecycle"):
        ViewerManifest.model_validate(invalid_withheld)
