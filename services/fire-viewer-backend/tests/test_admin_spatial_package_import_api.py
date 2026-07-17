from __future__ import annotations

import base64
import hashlib
import hmac
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from fire_viewer.db.models import AuditEvent, SpatialPackage, SpatialPackageFile
from fire_viewer.domain.enums import SpatialPackageFileKind
from fire_viewer.domain.schemas import AdminSpatialPackageFromBlobRequest
from fire_viewer.services.spatial_package_blob_import import validate_blob_package
from fire_viewer.storage import ObjectMetadata

_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDAT\x08\xd7c\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)
_GLB = b"glTF\x02\x00\x00\x00\x0c\x00\x00\x00"
_UPLOAD_ID = "1" * 32


def _headers(key: str) -> dict[str, str]:
    return {"Idempotency-Key": key}


def _create_zone_and_revision(client) -> None:
    created = client.post(
        "/api/v1/admin/zones",
        json={
            "zone_id": "IMPORT-TEST-01",
            "label": "Import test zone",
            "description": "Référence technique utilisée pour les essais d'import contrôlé.",
            "bounds_l93_m": [900_000.0, 6_400_000.0, 901_000.0, 6_401_000.0],
            "reason": "Création de la référence technique pour les essais d'import.",
        },
        headers=_headers("spatial-import-zone-0001"),
    )
    assert created.status_code == 201
    revision = client.post(
        "/api/v1/admin/zones/IMPORT-TEST-01/revisions",
        json={
            "origin_lon": 5.2601,
            "origin_lat": 44.7555,
            "source_orthometric_height_m": 410.0,
            "geoid_undulation_m": 50.0,
            "bounds_m": [-100.0, 100.0, -120.0, 120.0, -10.0, 50.0],
            "reason": "Création de la première révision spatiale de test.",
        },
        headers=_headers("spatial-import-revision-0001"),
    )
    assert revision.status_code == 201
    assert revision.json()["revision"]["revision"] == 1


def _package_documents(*, package_id: str, revision: int = 1) -> dict[str, bytes]:
    assets = {
        "assets/preview.png": _PNG,
        "assets/model.glb": _GLB,
    }
    catalog = {
        "assets": [
            {
                "path": path,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "byte_count": len(payload),
            }
            for path, payload in assets.items()
        ]
    }
    catalog_raw = json.dumps(catalog, separators=(",", ":")).encode()
    manifest = {
        "package_id": package_id,
        "catalog": {
            "path": "catalog.json",
            "sha256": hashlib.sha256(catalog_raw).hexdigest(),
            "byte_count": len(catalog_raw),
        },
        "zones": [{"zone_id": "IMPORT-TEST-01", "revision_id": f"R{revision}"}],
    }
    return {
        "package-manifest.json": json.dumps(manifest, separators=(",", ":")).encode(),
        "catalog.json": catalog_raw,
        **assets,
    }


def _content_type(path: str) -> str:
    return {
        ".json": "application/json",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".glb": "model/gltf-binary",
        ".fwtile": "application/vnd.fireviewer.tile",
        ".fwterrain": "application/vnd.fireviewer.terrain",
    }[Path(path).suffix]


def _stage_blob_objects(
    settings,
    *,
    package_id: str,
    revision: int = 1,
    upload_id: str = _UPLOAD_ID,
) -> tuple[dict[str, bytes], list[dict[str, Any]]]:
    documents = _package_documents(package_id=package_id, revision=revision)
    root = settings.zone_upload_storage_dir / "packages" / upload_id
    objects: list[dict[str, Any]] = []
    for path, payload in documents.items():
        target = root / Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        objects.append(
            {
                "path": path,
                "pathname": f"packages/{upload_id}/{path}",
                "size_bytes": len(payload),
                "content_type": _content_type(path),
            }
        )
    return documents, objects


def _finalize(client, *, package_id: str, objects: list[dict[str, Any]], key: str):
    return client.post(
        "/api/v1/admin/zones/IMPORT-TEST-01/revisions/1/packages/from-blob",
        json={
            "upload_id": _UPLOAD_ID,
            "package_id": package_id,
            "reason": "Finalisation contrôlée du package spatial envoyé directement.",
            "objects": objects,
        },
        headers=_headers(key),
    )


def _recover(client, *, package_id: str, key: str):
    return client.post(
        "/api/v1/admin/zones/IMPORT-TEST-01/revisions/1/packages/recover-from-blob",
        json={
            "upload_id": _UPLOAD_ID,
            "package_id": package_id,
            "reason": "Reprise contrôlée de la finalisation du package déjà stocké.",
        },
        headers=_headers(key),
    )


def test_large_blob_inventory_uses_one_listing_and_two_metadata_heads(settings) -> None:
    package_id = "pkg-large-unity-r1"
    asset_count = 952
    asset_digest = hashlib.sha256(b"x").hexdigest()
    catalog = {
        "assets": [
            {
                "path": f"assets/detail/tile-{index:04d}.fwtile",
                "sha256": asset_digest,
                "byte_count": 1,
            }
            for index in range(asset_count)
        ]
    }
    catalog_raw = json.dumps(catalog, separators=(",", ":")).encode()
    manifest_raw = json.dumps(
        {
            "package_id": package_id,
            "catalog": {
                "path": "catalog.json",
                "sha256": hashlib.sha256(catalog_raw).hexdigest(),
                "byte_count": len(catalog_raw),
            },
            "zones": [{"zone_id": "IMPORT-TEST-01", "revision_id": "R1"}],
        },
        separators=(",", ":"),
    ).encode()
    documents = {
        "package-manifest.json": manifest_raw,
        "catalog.json": catalog_raw,
        **{f"assets/detail/tile-{index:04d}.fwtile": b"x" for index in range(asset_count)},
    }
    storage_key = f"packages/{_UPLOAD_ID}"
    content_types = {path: _content_type(path) for path in documents}
    objects = [
        {
            "path": path,
            "pathname": f"{storage_key}/{path}",
            "size_bytes": len(content),
            "content_type": content_types[path],
        }
        for path, content in documents.items()
    ]

    class RecordingStore:
        def __init__(self) -> None:
            self.list_calls = 0
            self.head_calls: list[str] = []
            self.read_calls: list[str] = []

        def pathname_for(self, key: str) -> str:
            return key

        def uri_for(self, key: str) -> str:
            return f"local://{key}"

        def list_prefix(self, key: str, *, limit: int) -> list[ObjectMetadata]:
            self.list_calls += 1
            assert key == storage_key
            assert limit == 2_001
            return [
                ObjectMetadata(
                    pathname=f"{storage_key}/{path}",
                    size_bytes=len(content),
                    content_type=None,
                )
                for path, content in documents.items()
            ][:limit]

        def head(self, uri: str) -> ObjectMetadata:
            self.head_calls.append(uri)
            path = uri.removeprefix(f"local://{storage_key}/")
            return ObjectMetadata(
                pathname=f"{storage_key}/{path}",
                size_bytes=len(documents[path]),
                content_type=content_types[path],
            )

        def read_bytes(self, uri: str) -> bytes:
            self.read_calls.append(uri)
            return documents[uri.removeprefix(f"local://{storage_key}/")]

    store = RecordingStore()
    validated = validate_blob_package(
        zone_id="IMPORT-TEST-01",
        revision=1,
        payload=AdminSpatialPackageFromBlobRequest.model_validate(
            {
                "upload_id": _UPLOAD_ID,
                "package_id": package_id,
                "reason": "Finalisation contrôlée du grand package spatial Unity.",
                "objects": objects,
            }
        ),
        settings=settings.model_copy(update={"zone_upload_max_files": 2_000}),
        store=store,  # type: ignore[arg-type]
    )

    assert validated.object_count == 954
    assert len(validated.asset_catalog) == asset_count
    assert store.list_calls == 1
    assert set(store.head_calls) == {
        f"local://{storage_key}/package-manifest.json",
        f"local://{storage_key}/catalog.json",
    }
    assert set(store.read_calls) == set(store.head_calls)


def test_admin_finalizes_exact_blob_inventory_then_previews_and_publishes(
    client, settings, session
) -> None:
    _create_zone_and_revision(client)
    documents, objects = _stage_blob_objects(settings, package_id="pkg-import-test-r1")

    response = _finalize(
        client,
        package_id="pkg-import-test-r1",
        objects=objects,
        key="spatial-import-package-0001",
    )

    assert response.status_code == 201
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["package"] == {
        "package_id": "pkg-import-test-r1",
        "state": "DRAFT",
        "upload_id": _UPLOAD_ID,
        "object_count": 4,
        "total_size_bytes": sum(map(len, documents.values())),
        "asset_count": 2,
        "validation_summary": "Stored Blob inventory and package metadata were verified.",
    }

    replay = _finalize(
        client,
        package_id="pkg-import-test-r1",
        objects=objects,
        key="spatial-import-package-0001",
    )
    assert replay.status_code == 201
    assert replay.headers["Idempotent-Replay"] == "true"
    assert replay.json() == response.json()

    package = session.scalar(
        select(SpatialPackage).where(SpatialPackage.package_id == "pkg-import-test-r1")
    )
    assert package is not None
    stored_files = list(
        session.scalars(
            select(SpatialPackageFile).where(SpatialPackageFile.spatial_package_id == package.id)
        )
    )
    assert {item.uri for item in stored_files} == {
        f"local://packages/{_UPLOAD_ID}/assets/model.glb",
        f"local://packages/{_UPLOAD_ID}/assets/preview.png",
    }
    assert session.scalar(
        select(AuditEvent).where(AuditEvent.action == "spatial_package.finalized_from_blob")
    )

    base = "/api/v1/admin/zones/IMPORT-TEST-01/revisions/1"
    validated = client.post(
        f"{base}/validations",
        json={
            "package_id": "pkg-import-test-r1",
            "reason": "Validation des contrôles spatiaux et des hashes.",
        },
        headers=_headers("spatial-import-validation-0001"),
    )
    assert validated.status_code == 200
    preview = client.post(
        f"{base}/preview",
        json={
            "package_id": "pkg-import-test-r1",
            "reason": "Activation de l'aperçu privé après validation.",
        },
        headers=_headers("spatial-import-preview-0001"),
    )
    assert preview.status_code == 200
    image = client.get(f"{base}/preview/packages/pkg-import-test-r1/png")
    assert image.status_code == 200
    assert image.headers["Cache-Control"] == "no-store"
    assert image.content == _PNG
    published = client.post(
        "/api/v1/admin/publications",
        json={
            "zone_id": "IMPORT-TEST-01",
            "revision": 1,
            "package_id": "pkg-import-test-r1",
            "reason": "Publication après comparaison et revue privée.",
        },
        headers=_headers("spatial-import-publish-0001"),
    )
    assert published.status_code == 200
    assert published.json()["publication"]["package_state"] == "PUBLISHED"


def test_admin_recovers_a_complete_stored_upload_without_reupload(
    client, settings, session
) -> None:
    _create_zone_and_revision(client)
    documents, _objects = _stage_blob_objects(settings, package_id="pkg-recovered-r1")

    response = _recover(
        client,
        package_id="pkg-recovered-r1",
        key="spatial-import-recovery-0001",
    )

    assert response.status_code == 201, response.text
    assert response.json()["package"] == {
        "package_id": "pkg-recovered-r1",
        "state": "DRAFT",
        "upload_id": _UPLOAD_ID,
        "object_count": 4,
        "total_size_bytes": sum(map(len, documents.values())),
        "asset_count": 2,
        "validation_summary": "Stored Blob inventory and package metadata were verified.",
    }
    package = session.scalar(
        select(SpatialPackage).where(SpatialPackage.package_id == "pkg-recovered-r1")
    )
    assert package is not None
    assert package.provenance["upload_id"] == _UPLOAD_ID


def test_admin_finalizes_unity_remote_tile_inventory(client, settings, session) -> None:
    _create_zone_and_revision(client)
    package_id = "pkg-unity-remote-r1"
    assets = {
        "assets/validation/unity-preview.png": _PNG,
        "assets/far/global.jpg": b"far-imagery",
        "assets/far/global.fwterrain": b"far-terrain",
        "assets/imagery/tile.jpg": b"tile-imagery",
        "assets/detail/tile/tile.fwtile": b"tile-payload",
    }
    catalog = {
        "schema": "fireviewer.remote-tile-catalog.v1",
        "assets": [
            {
                "path": path,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "byte_count": len(payload),
            }
            for path, payload in assets.items()
        ],
    }
    catalog_raw = json.dumps(catalog, separators=(",", ":")).encode()
    manifest = {
        "package_id": package_id,
        "catalog": {
            "path": "catalog.json",
            "sha256": hashlib.sha256(catalog_raw).hexdigest(),
            "byte_count": len(catalog_raw),
        },
        "zones": [{"zone_id": "IMPORT-TEST-01", "revision_id": "R1"}],
    }
    documents = {
        "package-manifest.json": json.dumps(manifest, separators=(",", ":")).encode(),
        "catalog.json": catalog_raw,
        **assets,
    }
    root = settings.zone_upload_storage_dir / "packages" / _UPLOAD_ID
    objects: list[dict[str, Any]] = []
    for path, payload in documents.items():
        target = root / Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        objects.append(
            {
                "path": path,
                "pathname": f"packages/{_UPLOAD_ID}/{path}",
                "size_bytes": len(payload),
                "content_type": _content_type(path),
            }
        )

    response = _finalize(
        client,
        package_id=package_id,
        objects=objects,
        key="spatial-import-unity-remote-0001",
    )

    assert response.status_code == 201
    package = session.scalar(select(SpatialPackage).where(SpatialPackage.package_id == package_id))
    assert package is not None
    kinds = set(
        session.scalars(
            select(SpatialPackageFile.kind).where(
                SpatialPackageFile.spatial_package_id == package.id
            )
        )
    )
    assert kinds == {
        SpatialPackageFileKind.PNG,
        SpatialPackageFileKind.JPEG,
        SpatialPackageFileKind.FWTILE,
        SpatialPackageFileKind.FWTERRAIN,
    }
    base = "/api/v1/admin/zones/IMPORT-TEST-01/revisions/1"
    validated = client.post(
        f"{base}/validations",
        json={"package_id": package_id, "reason": "Validation du package Unity distant."},
        headers=_headers("spatial-import-unity-remote-validation-0001"),
    )
    assert validated.status_code == 200, validated.text
    preview = client.post(
        f"{base}/preview",
        json={"package_id": package_id, "reason": "Aperçu privé du package Unity distant."},
        headers=_headers("spatial-import-unity-remote-preview-0001"),
    )
    assert preview.status_code == 200, preview.text


@pytest.mark.parametrize(
    ("mutation", "expected_error"),
    [
        ("missing", "missing_blob_object"),
        ("extra", "package_inventory_mismatch"),
        ("size", "blob_metadata_mismatch"),
        ("revision", "package_revision_mismatch"),
    ],
)
def test_finalization_rejects_incomplete_or_inconsistent_blob_packages(
    client, settings, session, mutation: str, expected_error: str
) -> None:
    _create_zone_and_revision(client)
    revision = 2 if mutation == "revision" else 1
    _, objects = _stage_blob_objects(
        settings,
        package_id=f"pkg-invalid-{mutation}",
        revision=revision,
    )
    if mutation == "missing":
        (settings.zone_upload_storage_dir / objects[-1]["pathname"]).unlink()
    elif mutation == "extra":
        extra = settings.zone_upload_storage_dir / "packages" / _UPLOAD_ID / "assets/extra.png"
        extra.write_bytes(_PNG)
        objects.append(
            {
                "path": "assets/extra.png",
                "pathname": f"packages/{_UPLOAD_ID}/assets/extra.png",
                "size_bytes": len(_PNG),
                "content_type": "image/png",
            }
        )
    elif mutation == "size":
        objects[-1]["size_bytes"] += 1

    response = _finalize(
        client,
        package_id=f"pkg-invalid-{mutation}",
        objects=objects,
        key=f"spatial-import-invalid-{mutation}-0001",
    )

    assert response.status_code == 400
    assert response.json()["type"].endswith(expected_error)
    assert (
        session.scalar(
            select(SpatialPackage).where(SpatialPackage.package_id == f"pkg-invalid-{mutation}")
        )
        is None
    )


def test_finalization_rejects_unsafe_and_unknown_object_paths(client, settings) -> None:
    _create_zone_and_revision(client)
    _, objects = _stage_blob_objects(settings, package_id="pkg-unsafe-path")
    objects[-1]["path"] = "../model.glb"
    response = _finalize(
        client,
        package_id="pkg-unsafe-path",
        objects=objects,
        key="spatial-import-unsafe-path-0001",
    )
    assert response.status_code == 400
    assert response.json()["type"].endswith("unsafe_package_path")

    _, objects = _stage_blob_objects(settings, package_id="pkg-unknown-type")
    objects[-1]["path"] = "assets/model.exe"
    objects[-1]["pathname"] = f"packages/{_UPLOAD_ID}/assets/model.exe"
    objects[-1]["content_type"] = "application/octet-stream"
    response = _finalize(
        client,
        package_id="pkg-unknown-type",
        objects=objects,
        key="spatial-import-unknown-type-0001",
    )
    assert response.status_code == 400
    assert response.json()["type"].endswith("unsupported_package_file_type")


def test_admin_grant_issues_a_prefix_limited_vercel_blob_client_token(client, settings) -> None:
    _create_zone_and_revision(client)
    settings.object_storage_backend = "vercel_blob"
    settings.blob_read_write_token = SecretStr("vercel_blob_rw_teststore_testsecret")
    settings.object_storage_prefix = "fire-viewer"

    grant_response = client.post(
        "/api/v1/admin/zones/IMPORT-TEST-01/revisions/1/packages/upload-grant",
        json={
            "package_id": "pkg-granted-upload",
            "file_count": 4,
            "total_size_bytes": 1024,
        },
    )
    assert grant_response.status_code == 201
    grant = grant_response.json()
    assert grant["pathname_prefix"].startswith("fire-viewer/packages/")

    token_response = client.post(
        "/api/v1/admin/blob-upload-token",
        json={
            "type": "blob.generate-client-token",
            "payload": {
                "pathname": f"{grant['pathname_prefix']}/assets/model.glb",
                "multipart": True,
                "clientPayload": "pkg-granted-upload",
            },
        },
        headers={"X-Blob-Upload-Grant": grant["upload_grant"]},
    )
    assert token_response.status_code == 200
    client_token = token_response.json()["clientToken"]
    token_prefix = "vercel_blob_client_teststore_"
    assert client_token.startswith(token_prefix)

    secured = base64.b64decode(client_token.removeprefix(token_prefix)).decode("ascii")
    signature, encoded_payload = secured.split(".", maxsplit=1)
    expected_signature = hmac.new(
        b"vercel_blob_rw_teststore_testsecret",
        encoded_payload.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    assert hmac.compare_digest(signature, expected_signature)

    token_payload = json.loads(base64.b64decode(encoded_payload))
    assert token_payload["pathname"] == (f"{grant['pathname_prefix']}/assets/model.glb")
    assert token_payload["allowedContentTypes"] == [
        "application/json",
        "application/vnd.fireviewer.terrain",
        "application/vnd.fireviewer.tile",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/geotiff",
        "model/gltf-binary",
    ]
    assert token_payload["addRandomSuffix"] is False
    assert token_payload["allowOverwrite"] is False
    assert token_payload["maximumSizeInBytes"] == settings.zone_upload_max_bytes
    assert token_payload["validUntil"] > 0

    denied = client.post(
        "/api/v1/admin/blob-upload-token",
        json={
            "type": "blob.generate-client-token",
            "payload": {
                "pathname": "fire-viewer/packages/another-upload/assets/model.glb",
                "multipart": True,
                "clientPayload": "pkg-granted-upload",
            },
        },
        headers={"X-Blob-Upload-Grant": grant["upload_grant"]},
    )
    assert denied.status_code == 403
