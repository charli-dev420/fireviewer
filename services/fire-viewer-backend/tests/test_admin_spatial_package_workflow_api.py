from __future__ import annotations

from fire_viewer.db.models import (
    SpatialPackage,
    SpatialPackageFile,
    SpatialZone,
    SpatialZoneRevision,
)
from fire_viewer.domain.enums import SpatialPackageFileKind, SpatialPackageState
from fire_viewer.domain.spatial import RAF20_GRID_SHA256


def _seed_draft_package(
    session,
    *,
    package_id: str = "pkg-workflow-01",
    include_png: bool = True,
) -> None:
    zone = SpatialZone(zone_id="PACKAGE-WORKFLOW-01", label="Package workflow")
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
    session.add(
        SpatialPackage(
            package_id=package_id,
            manifest_uri=f"s3://private/{package_id}/manifest.json",
            manifest_sha256="a" * 64,
            manifest_size_bytes=512,
            storage_uri=f"s3://private/{package_id}/",
            state=SpatialPackageState.DRAFT,
            provenance={"pipeline": "test"},
            verification_report={},
            created_by="test",
            files=(
                [
                    SpatialPackageFile(
                        kind=SpatialPackageFileKind.PNG,
                        uri=f"s3://private/{package_id}/preview.png",
                        sha256="b" * 64,
                        size_bytes=1024,
                        media_type="image/png",
                        provenance={},
                    ),
                ]
                if include_png
                else []
            ) + [
                SpatialPackageFile(
                    kind=SpatialPackageFileKind.GLB,
                    uri=f"s3://private/{package_id}/model.glb",
                    sha256="c" * 64,
                    size_bytes=2048,
                    media_type="model/gltf-binary",
                    provenance={},
                ),
            ],
        )
    )
    session.commit()


def _headers(key: str) -> dict[str, str]:
    return {"Idempotency-Key": key}


def test_admin_can_validate_preview_and_publish_registered_spatial_package(client, session) -> None:
    _seed_draft_package(session)
    base = "/api/v1/admin/zones/PACKAGE-WORKFLOW-01/revisions/1"
    validation = client.post(
        f"{base}/validations",
        json={"package_id": "pkg-workflow-01", "reason": "Validation du package spatial de test."},
        headers=_headers("package-workflow-validation-0001"),
    )
    assert validation.status_code == 200
    assert validation.json()["publication"].get("package_state") == "VERIFIED"
    assert validation.json()["publication"].get("publication_state") == "VERIFIED"

    replay = client.post(
        f"{base}/validations",
        json={"package_id": "pkg-workflow-01", "reason": "Validation du package spatial de test."},
        headers=_headers("package-workflow-validation-0001"),
    )
    assert replay.status_code == 200
    assert replay.headers["Idempotent-Replay"] == "true"
    assert replay.json() == validation.json()

    preview = client.post(
        f"{base}/preview",
        json={"package_id": "pkg-workflow-01", "reason": "Aperçu privé validé par l'operateur."},
        headers=_headers("package-workflow-preview-0001"),
    )
    assert preview.status_code == 200
    assert preview.json()["publication"]["package_state"] == "PREVIEWABLE"
    assert preview.json()["publication"]["publication_state"] == "PREVIEWABLE"

    publication = client.post(
        "/api/v1/admin/publications",
        json={
            "zone_id": "PACKAGE-WORKFLOW-01",
            "revision": 1,
            "package_id": "pkg-workflow-01",
            "reason": "Publication explicite après revue privée.",
        },
        headers=_headers("package-workflow-publication-0001"),
    )
    assert publication.status_code == 200
    assert publication.json()["publication"]["package_state"] == "PUBLISHED"
    assert publication.json()["publication"]["publication_state"] == "PUBLISHED"
    assert publication.json()["publication"]["is_active"] is True

    descriptor = client.get(f"{base}/preview")
    assert descriptor.status_code == 200
    assert descriptor.json()["package_state"] == "PUBLISHED"
    assert descriptor.json()["publication_state"] == "PUBLISHED"
    assert descriptor.json()["publication_active"] is True
    assert "s3://" not in str(descriptor.json())


def test_admin_rejects_preview_when_the_registered_package_has_no_png(client, session) -> None:
    _seed_draft_package(session, package_id="pkg-without-preview", include_png=False)

    response = client.post(
        "/api/v1/admin/zones/PACKAGE-WORKFLOW-01/revisions/1/validations",
        json={"package_id": "pkg-without-preview", "reason": "Tentative sans aperçu PNG déclaré."},
        headers=_headers("package-workflow-missing-preview-0001"),
    )
    assert response.status_code == 409
    assert response.json()["type"] == "urn:fire-viewer:error:spatial_package_missing_preview_assets"
