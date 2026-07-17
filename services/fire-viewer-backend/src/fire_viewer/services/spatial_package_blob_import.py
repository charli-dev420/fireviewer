"""Finalize a locally prepared package after direct browser upload to private Blob storage."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from fire_viewer.core.config import Settings
from fire_viewer.core.security import Actor
from fire_viewer.db.models import (
    SpatialPackage,
    SpatialPackageFile,
    SpatialZone,
    SpatialZoneRevision,
)
from fire_viewer.db.transactions import begin_write_transaction
from fire_viewer.domain.enums import SpatialPackageFileKind, SpatialPackageState
from fire_viewer.domain.errors import BadRequestError, ConflictError, NotFoundError
from fire_viewer.domain.hashing import sha256_hex
from fire_viewer.domain.schemas import (
    AdminBlobObjectReference,
    AdminSpatialPackageFromBlobRequest,
    AdminSpatialPackageImportEnvelope,
    AdminSpatialPackageImportResponse,
)
from fire_viewer.services.common import record_operator_audit
from fire_viewer.services.idempotency import find_replay, store_response
from fire_viewer.storage import ObjectMetadata, ObjectStore, build_object_store
from fire_viewer.storage.object_store import ObjectStorageError

_PACKAGE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,95}$")
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_REQUIRED_PATHS = frozenset({"package-manifest.json", "catalog.json"})
_ASSET_PREFIXES = ("assets/", "terrain/", "vectors/")
_CONTENT_TYPES = {
    ".json": "application/json",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".glb": "model/gltf-binary",
    ".fwtile": "application/vnd.fireviewer.tile",
    ".fwterrain": "application/vnd.fireviewer.terrain",
}


@dataclass(frozen=True, slots=True)
class ValidatedBlobPackage:
    upload_id: str
    package_id: str
    storage_key: str
    manifest_sha256: str
    manifest_size_bytes: int
    catalog_sha256: str
    catalog_size_bytes: int
    asset_catalog: list[dict[str, Any]]
    object_count: int
    total_size_bytes: int


@dataclass(frozen=True, slots=True)
class BlobSpatialImportOutcome:
    response: AdminSpatialPackageImportEnvelope
    replayed: bool


def _safe_path(value: str, *, asset: bool = False) -> str:
    if (
        not value
        or "\\" in value
        or "\x00" in value
        or value.startswith(("/", "\\"))
        or any(character in value for character in ("?", "#", ":"))
    ):
        raise BadRequestError("unsafe_package_path", "The package contains an unsafe path.")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise BadRequestError("unsafe_package_path", "The package contains an unsafe path.")
    normalized = path.as_posix()
    if asset and not normalized.startswith(_ASSET_PREFIXES):
        raise BadRequestError(
            "unsupported_package_path",
            "Catalog assets must use assets/, terrain/ or vectors/.",
        )
    return normalized


def _positive_int(value: object, *, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise BadRequestError("invalid_package_catalog", f"{label} must be a positive integer.")
    return value


def _sha256(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not _SHA256_RE.fullmatch(value):
        raise BadRequestError("invalid_package_catalog", f"{label} must be a SHA-256 digest.")
    return value


def _json_document(raw: bytes, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BadRequestError("invalid_package_json", f"{label} must be valid JSON.") from exc
    if not isinstance(value, dict):
        raise BadRequestError("invalid_package_json", f"{label} must be a JSON object.")
    return value


def _catalog_entries(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []

    def visit(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return
        path = node.get("path")
        if isinstance(path, str) and path.startswith(_ASSET_PREFIXES):
            entries.append(
                {
                    "path": _safe_path(path, asset=True),
                    "sha256": _sha256(node.get("sha256"), label="catalog asset"),
                    "size_bytes": _positive_int(
                        node.get("byte_count", node.get("size_bytes")),
                        label="catalog asset size",
                    ),
                }
            )
        for child in node.values():
            visit(child)

    visit(catalog)
    if not entries:
        raise BadRequestError(
            "empty_package_catalog",
            "catalog.json must declare at least one supported spatial asset.",
        )
    return entries


def _content_type(path: str) -> str:
    result = _CONTENT_TYPES.get(PurePosixPath(path).suffix.casefold())
    if result is None:
        raise BadRequestError(
            "unsupported_package_file_type",
            "The package contains a file type that is not supported.",
        )
    return result


def _list_objects(
    store: ObjectStore,
    storage_key: str,
    *,
    limit: int,
) -> dict[str, ObjectMetadata]:
    try:
        prefix = f"{store.pathname_for(storage_key).rstrip('/')}/"
        result: dict[str, ObjectMetadata] = {}
        for item in store.list_prefix(storage_key, limit=limit):
            if not item.pathname.startswith(prefix):
                raise ObjectStorageError("Object inventory escaped the package prefix.")
            path = item.pathname.removeprefix(prefix)
            if not path or path in result:
                raise ObjectStorageError("Object inventory contains an invalid pathname.")
            result[path] = item
        return result
    except ObjectStorageError as exc:
        raise BadRequestError(
            "missing_blob_object",
            "The declared Blob object inventory is missing or inaccessible.",
        ) from exc


def validate_blob_package(
    *,
    zone_id: str,
    revision: int,
    payload: AdminSpatialPackageFromBlobRequest,
    settings: Settings,
    store: ObjectStore | None = None,
) -> ValidatedBlobPackage:
    object_store = store or build_object_store(settings)
    if len(payload.objects) > settings.zone_upload_max_files:
        raise BadRequestError("too_many_package_files", "The package declares too many files.")
    storage_key = f"packages/{payload.upload_id}"
    expected_prefix = object_store.pathname_for(storage_key)
    by_path: dict[str, AdminBlobObjectReference] = {}
    total_size_bytes = 0
    for item in payload.objects:
        path = _safe_path(item.path)
        if path in by_path:
            raise BadRequestError(
                "duplicate_package_path", "The package declares a duplicate path."
            )
        if item.pathname != f"{expected_prefix}/{path}":
            raise BadRequestError(
                "unexpected_blob_pathname",
                "A Blob object is outside the immutable package prefix.",
            )
        if item.content_type != _content_type(path):
            raise BadRequestError(
                "unexpected_blob_content_type",
                "A Blob object has an unexpected content type.",
            )
        total_size_bytes += item.size_bytes
        if total_size_bytes > settings.zone_upload_max_unpacked_bytes:
            raise BadRequestError("package_too_large", "The package exceeds the configured limit.")
        by_path[path] = item
    if not _REQUIRED_PATHS.issubset(by_path):
        raise BadRequestError(
            "missing_package_metadata",
            "package-manifest.json and catalog.json are required.",
        )

    metadata = _list_objects(
        object_store,
        storage_key,
        limit=settings.zone_upload_max_files + 1,
    )
    if len(metadata) > settings.zone_upload_max_files:
        raise BadRequestError("too_many_package_files", "The package contains too many files.")
    if set(metadata) != set(by_path):
        raise BadRequestError(
            "missing_blob_object",
            "The declared Blob objects do not match the stored package inventory.",
        )

    # Vercel Blob exposes pathname and size in one paginated inventory request, but not the
    # stored content type. Only the two small metadata documents need authoritative HEAD calls;
    # every declared asset type is already constrained by its safe suffix and upload token.
    for path in _REQUIRED_PATHS:
        try:
            metadata[path] = object_store.head(object_store.uri_for(f"{storage_key}/{path}"))
        except ObjectStorageError as exc:
            raise BadRequestError(
                "missing_blob_object",
                "The package metadata objects are missing or inaccessible.",
            ) from exc
    for path, item in by_path.items():
        actual = metadata[path]
        if (
            actual.pathname != item.pathname
            or actual.size_bytes != item.size_bytes
            or (actual.content_type is not None and actual.content_type != item.content_type)
        ):
            raise BadRequestError(
                "blob_metadata_mismatch",
                "A Blob object does not match its declared size, pathname or content type.",
            )

    for path in _REQUIRED_PATHS:
        if by_path[path].size_bytes > settings.zone_upload_max_manifest_bytes:
            raise BadRequestError(
                "package_metadata_too_large", f"{path} exceeds the configured limit."
            )
    manifest_raw = object_store.read_bytes(
        object_store.uri_for(f"{storage_key}/package-manifest.json")
    )
    catalog_raw = object_store.read_bytes(object_store.uri_for(f"{storage_key}/catalog.json"))
    if len(manifest_raw) != by_path["package-manifest.json"].size_bytes:
        raise BadRequestError("blob_metadata_mismatch", "package-manifest.json size changed.")
    if len(catalog_raw) != by_path["catalog.json"].size_bytes:
        raise BadRequestError("blob_metadata_mismatch", "catalog.json size changed.")
    manifest = _json_document(manifest_raw, label="package-manifest.json")
    catalog = _json_document(catalog_raw, label="catalog.json")

    package_id = manifest.get("package_id")
    if not isinstance(package_id, str) or not _PACKAGE_ID_RE.fullmatch(package_id):
        raise BadRequestError(
            "invalid_package_id", "package-manifest.json has an invalid package_id."
        )
    if package_id != payload.package_id:
        raise BadRequestError(
            "package_id_mismatch", "The requested package_id does not match the manifest."
        )
    catalog_reference = manifest.get("catalog")
    if not isinstance(catalog_reference, dict) or catalog_reference.get("path") != "catalog.json":
        raise BadRequestError(
            "invalid_package_manifest", "The manifest must reference catalog.json."
        )
    catalog_sha256 = hashlib.sha256(catalog_raw).hexdigest()
    if _sha256(catalog_reference.get("sha256"), label="catalog reference") != catalog_sha256:
        raise BadRequestError(
            "catalog_digest_mismatch", "catalog.json does not match the manifest."
        )
    if _positive_int(catalog_reference.get("byte_count"), label="catalog reference size") != len(
        catalog_raw
    ):
        raise BadRequestError("catalog_size_mismatch", "catalog.json does not match the manifest.")
    zones = manifest.get("zones")
    declared_zone = (
        next(
            (item for item in zones if isinstance(item, dict) and item.get("zone_id") == zone_id),
            None,
        )
        if isinstance(zones, list)
        else None
    )
    if declared_zone is None or declared_zone.get("revision_id") != f"R{revision}":
        raise BadRequestError(
            "package_revision_mismatch",
            "The manifest does not declare the requested zone revision.",
        )

    entries = _catalog_entries(catalog)
    catalog_by_path: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if entry["path"] in catalog_by_path:
            raise BadRequestError(
                "duplicate_catalog_path", "catalog.json declares a duplicate path."
            )
        _content_type(entry["path"])
        catalog_by_path[entry["path"]] = entry
    if set(by_path) != _REQUIRED_PATHS.union(catalog_by_path):
        raise BadRequestError(
            "package_inventory_mismatch",
            "The uploaded files and catalog.json inventory do not match exactly.",
        )
    for path, entry in catalog_by_path.items():
        if by_path[path].size_bytes != entry["size_bytes"]:
            raise BadRequestError(
                "package_asset_size_mismatch", "A catalog asset has an unexpected size."
            )

    return ValidatedBlobPackage(
        upload_id=payload.upload_id,
        package_id=package_id,
        storage_key=storage_key,
        manifest_sha256=hashlib.sha256(manifest_raw).hexdigest(),
        manifest_size_bytes=len(manifest_raw),
        catalog_sha256=catalog_sha256,
        catalog_size_bytes=len(catalog_raw),
        asset_catalog=[catalog_by_path[path] for path in sorted(catalog_by_path)],
        object_count=len(by_path),
        total_size_bytes=total_size_bytes,
    )


def recover_blob_package_request(
    *,
    upload_id: str,
    package_id: str,
    reason: str,
    settings: Settings,
    store: ObjectStore | None = None,
) -> AdminSpatialPackageFromBlobRequest:
    """Rebuild the client inventory for an interrupted, fully stored upload."""

    object_store = store or build_object_store(settings)
    storage_key = f"packages/{upload_id}"
    metadata = _list_objects(
        object_store,
        storage_key,
        limit=settings.zone_upload_max_files + 1,
    )
    if len(metadata) > settings.zone_upload_max_files:
        raise BadRequestError("too_many_package_files", "The package contains too many files.")
    return AdminSpatialPackageFromBlobRequest(
        upload_id=upload_id,
        package_id=package_id,
        reason=reason,
        objects=[
            AdminBlobObjectReference(
                path=path,
                pathname=item.pathname,
                size_bytes=item.size_bytes,
                content_type=_content_type(path),
            )
            for path, item in sorted(metadata.items())
        ],
    )


def _kind_and_media_type(path: str) -> tuple[SpatialPackageFileKind, str]:
    suffix = PurePosixPath(path).suffix.casefold()
    if suffix in {".jpg", ".jpeg"}:
        return SpatialPackageFileKind.JPEG, "image/jpeg"
    if suffix == ".png":
        return SpatialPackageFileKind.PNG, "image/png"
    if suffix == ".glb":
        return SpatialPackageFileKind.GLB, "model/gltf-binary"
    if suffix in {".tif", ".tiff"}:
        return SpatialPackageFileKind.COG, "image/tiff"
    if suffix == ".fwtile":
        return SpatialPackageFileKind.FWTILE, "application/vnd.fireviewer.tile"
    if suffix == ".fwterrain":
        return SpatialPackageFileKind.FWTERRAIN, "application/vnd.fireviewer.terrain"
    raise BadRequestError("unsupported_package_file_type", "The package asset type is unsupported.")


def import_blob_package(
    session: Session,
    *,
    zone_id: str,
    revision: int,
    payload: AdminSpatialPackageFromBlobRequest,
    validated: ValidatedBlobPackage,
    idempotency_key: str,
    actor: Actor,
    trace_id: str,
    settings: Settings,
) -> BlobSpatialImportOutcome:
    endpoint = f"POST /api/v1/admin/zones/{zone_id}/revisions/{revision}/packages/from-blob"
    request_hash = sha256_hex(
        {"actor_id": actor.actor_id, "payload": payload.model_dump(mode="json")}
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
        return BlobSpatialImportOutcome(
            AdminSpatialPackageImportEnvelope.model_validate(replay.response_body),
            True,
        )
    revision_row = session.execute(
        select(SpatialZoneRevision)
        .join(SpatialZone)
        .where(SpatialZone.zone_id == zone_id, SpatialZoneRevision.revision == revision)
        .with_for_update()
    ).scalar_one_or_none()
    if revision_row is None:
        raise NotFoundError("spatial_zone_revision", f"{zone_id}/revisions/{revision}")
    if (
        session.execute(
            select(SpatialPackage.id).where(SpatialPackage.package_id == validated.package_id)
        ).scalar_one_or_none()
        is not None
    ):
        raise ConflictError(
            "spatial_package_already_exists",
            "The package identifier is already registered.",
        )

    store = build_object_store(settings)
    package = SpatialPackage(
        package_id=validated.package_id,
        manifest_uri=store.uri_for(f"{validated.storage_key}/package-manifest.json"),
        manifest_sha256=validated.manifest_sha256,
        manifest_size_bytes=validated.manifest_size_bytes,
        storage_uri=store.uri_for(validated.storage_key),
        state=SpatialPackageState.DRAFT,
        provenance={
            "upload_id": validated.upload_id,
            "zone_id": zone_id,
            "revision": revision,
            "catalog_sha256": validated.catalog_sha256,
            "catalog_size_bytes": validated.catalog_size_bytes,
        },
        verification_report={
            "status": "finalized_from_blob",
            "summary": (
                "Stored Blob pathnames and sizes match the package catalog; declared content "
                "types match supported file extensions."
            ),
            "object_count": validated.object_count,
        },
        created_by=actor.actor_id,
    )
    session.add(package)
    session.flush()
    files: list[SpatialPackageFile] = []
    for entry in validated.asset_catalog:
        kind, media_type = _kind_and_media_type(entry["path"])
        files.append(
            SpatialPackageFile(
                spatial_package_id=package.id,
                kind=kind,
                uri=store.uri_for(f"{validated.storage_key}/{entry['path']}"),
                sha256=entry["sha256"],
                size_bytes=entry["size_bytes"],
                media_type=media_type,
                provenance={"catalog_path": entry["path"], "upload_id": validated.upload_id},
            )
        )
    session.add_all(files)
    session.flush()
    response = AdminSpatialPackageImportEnvelope(
        package=AdminSpatialPackageImportResponse(
            package_id=package.package_id,
            state=package.state,
            upload_id=validated.upload_id,
            object_count=validated.object_count,
            total_size_bytes=validated.total_size_bytes,
            asset_count=len(files),
            validation_summary="Stored Blob inventory and package metadata were verified.",
        ),
        trace_id=trace_id,
    )
    record_operator_audit(
        session,
        actor=actor,
        action="spatial_package.finalized_from_blob",
        target_type="spatial_package",
        target_id=package.package_id,
        reason=payload.reason,
        trace_id=trace_id,
        after=response.package.model_dump(mode="json"),
        payload={"zone_id": zone_id, "revision": revision},
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
    return BlobSpatialImportOutcome(response, False)
