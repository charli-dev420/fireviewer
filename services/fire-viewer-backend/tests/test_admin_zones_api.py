from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from fire_viewer.db.models import (
    SpatialPackage,
    SpatialPackageFile,
    SpatialZone,
    SpatialZoneRevision,
)
from fire_viewer.domain.enums import SpatialPackageFileKind, SpatialPackageState
from fire_viewer.domain.spatial import RAF20_GRID_SHA256


def seed_zone(session: Session) -> None:
    zone = SpatialZone(zone_id="die-pontaix", label="Die-Pontaix")
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
    session.add(
        SpatialPackage(
            package_id="pkg-die-pontaix-private-preview",
            manifest_uri="s3://private-admin/pkg-die-pontaix/manifest.json",
            manifest_sha256="a" * 64,
            manifest_size_bytes=512,
            storage_uri="s3://private-admin/pkg-die-pontaix/",
            state=SpatialPackageState.VERIFIED,
            provenance={"pipeline": "unity-export"},
            verification_report={"status": "passed"},
            created_by="admin-ui-test",
            verified_at=datetime.now(UTC),
            spatial_zone_revision_id=revision.id,
            files=[
                SpatialPackageFile(
                    kind=SpatialPackageFileKind.GLB,
                    uri="s3://private-admin/pkg-die-pontaix/model.glb",
                    sha256="b" * 64,
                    size_bytes=1024,
                    media_type="model/gltf-binary",
                    provenance={},
                )
            ],
        )
    )
    session.commit()


def test_admin_zones_list_and_detail_are_available_to_administrators(client, session) -> None:
    seed_zone(session)

    listing = client.get("/api/v1/admin/zones")

    assert listing.status_code == 200
    assert listing.json() == {
        "zones": [
            {
                "zone_id": "die-pontaix",
                "label": "Die-Pontaix",
                "revisions": [
                    {
                        "revision": 1,
                        "origin_wgs84": [5.2601, 44.7555, 460.0],
                        "local_frame": "ENU",
                        "meters_per_unit": 0.01,
                        "vertical_datum": "EPSG:4979",
                        "bounds_m": {
                            "east": [-100.0, 100.0],
                            "north": [-120.0, 120.0],
                            "up": [-10.0, 50.0],
                        },
                    }
                ],
            }
        ]
    }

    detail = client.get("/api/v1/admin/zones/die-pontaix")
    assert detail.status_code == 200
    assert detail.json()["zone_id"] == "die-pontaix"

    revision = client.get("/api/v1/admin/zones/die-pontaix/revisions/1")
    assert revision.status_code == 200
    assert revision.json()["revision"] == 1


def test_admin_private_preview_exposes_metadata_without_private_file_locations(
    client, session
) -> None:
    seed_zone(session)

    response = client.get("/api/v1/admin/zones/die-pontaix/revisions/1/preview")

    assert response.status_code == 200
    payload = response.json()
    assert payload["preview_scope"] == "private-admin"
    assert payload["package_id"] == "pkg-die-pontaix-private-preview"
    assert payload["files"] == [
        {
            "kind": "GLB",
            "sha256": "b" * 64,
            "size_bytes": 1024,
            "media_type": "model/gltf-binary",
        }
    ]
    assert "s3://private-admin" not in response.text
    assert "model.glb" not in response.text


def test_admin_zone_missing_resources_return_problem_details(client) -> None:
    response = client.get("/api/v1/admin/zones/unknown-zone")

    assert response.status_code == 404
    assert response.json()["type"].endswith("not_found")


def test_admin_mutation_workflow_endpoints_are_reserved_and_role_guarded(client) -> None:
    endpoints = [
        ("post", "/api/v1/admin/zones"),
        ("post", "/api/v1/admin/zones/die-pontaix/revisions"),
        ("post", "/api/v1/admin/zones/die-pontaix/revisions/1/packages"),
        ("post", "/api/v1/admin/zones/die-pontaix/revisions/1/validations"),
        ("post", "/api/v1/admin/zones/die-pontaix/revisions/1/preview"),
        ("get", "/api/v1/admin/publications"),
        ("post", "/api/v1/admin/publications"),
    ]

    for method, path in endpoints:
        response = getattr(client, method)(path)
        assert response.status_code == 501
        assert response.json()["type"].endswith("admin_endpoint_not_implemented")
