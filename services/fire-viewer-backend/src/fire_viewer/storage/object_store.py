from __future__ import annotations

import mimetypes
import os
import shutil
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Protocol

from vercel.blob import BlobClient

from fire_viewer.core.config import Settings


class ObjectStorageError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ObjectMetadata:
    pathname: str
    size_bytes: int
    content_type: str


def _safe_key(key: str) -> str:
    if "\\" in key:
        raise ObjectStorageError("Object keys must use POSIX separators.")
    raw_parts = key.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise ObjectStorageError("Invalid object key.")
    path = PurePosixPath(key)
    if path.is_absolute() or not path.parts:
        raise ObjectStorageError("Invalid object key.")
    return path.as_posix()


class ObjectStore(Protocol):
    def pathname_for(self, key: str) -> str: ...

    def uri_for(self, key: str) -> str: ...

    def finalize_tree(self, source_dir: Path, key: str) -> None: ...

    def delete_tree(self, key: str) -> None: ...

    def read_bytes(self, uri: str) -> bytes: ...

    def head(self, uri: str) -> ObjectMetadata: ...


class LocalObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path_for(self, key: str) -> Path:
        candidate = (self.root / _safe_key(key)).resolve()
        if not candidate.is_relative_to(self.root):
            raise ObjectStorageError("Object key escapes the local storage root.")
        return candidate

    def pathname_for(self, key: str) -> str:
        return _safe_key(key)

    def uri_for(self, key: str) -> str:
        return f"local://{_safe_key(key)}"

    def finalize_tree(self, source_dir: Path, key: str) -> None:
        destination = self._path_for(key)
        if destination.exists():
            raise ObjectStorageError("The immutable object key already exists.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source_dir, destination)

    def delete_tree(self, key: str) -> None:
        candidate = self._path_for(key)
        shutil.rmtree(candidate, ignore_errors=True)

    def read_bytes(self, uri: str) -> bytes:
        if not uri.startswith("local://"):
            raise ObjectStorageError("Unsupported local object URI.")
        path = self._path_for(uri.removeprefix("local://"))
        if not path.is_file():
            raise ObjectStorageError("Object not found.")
        return path.read_bytes()

    def head(self, uri: str) -> ObjectMetadata:
        if not uri.startswith("local://"):
            raise ObjectStorageError("Unsupported local object URI.")
        pathname = _safe_key(uri.removeprefix("local://"))
        path = self._path_for(pathname)
        if not path.is_file():
            raise ObjectStorageError("Object not found.")
        content_type = (
            "model/gltf-binary"
            if path.suffix.casefold() == ".glb"
            else mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        )
        return ObjectMetadata(
            pathname=pathname,
            size_bytes=path.stat().st_size,
            content_type=content_type,
        )


class VercelBlobObjectStore:
    def __init__(self, *, prefix: str, token: str | None) -> None:
        self.prefix = _safe_key(prefix).rstrip("/")
        self.client = BlobClient(token=token)

    def _blob_key(self, key: str) -> str:
        return f"{self.prefix}/{_safe_key(key)}"

    def pathname_for(self, key: str) -> str:
        return self._blob_key(key)

    def uri_for(self, key: str) -> str:
        return f"vercel-blob://{self._blob_key(key)}"

    def finalize_tree(self, source_dir: Path, key: str) -> None:
        base_key = self._blob_key(key)
        uploaded: list[str] = []
        try:
            for source in sorted(path for path in source_dir.rglob("*") if path.is_file()):
                relative = source.relative_to(source_dir).as_posix()
                object_key = f"{base_key}/{relative}"
                content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
                result = self.client.upload_file(
                    source,
                    object_key,
                    access="private",
                    content_type=content_type,
                    add_random_suffix=False,
                    overwrite=False,
                    cache_control_max_age=31_536_000,
                    multipart=source.stat().st_size >= 8 * 1_024 * 1_024,
                )
                if result.pathname != object_key:
                    raise ObjectStorageError("Vercel Blob returned an unexpected pathname.")
                uploaded.append(result.url)
        except BaseException as exc:
            if uploaded:
                self.client.delete(uploaded)
            if isinstance(exc, ObjectStorageError):
                raise
            raise ObjectStorageError("Vercel Blob upload failed.") from exc
        else:
            shutil.rmtree(source_dir, ignore_errors=True)

    def delete_tree(self, key: str) -> None:
        prefix = self._blob_key(key)
        urls = [item.url for item in self.client.iter_objects(prefix=prefix)]
        if urls:
            self.client.delete(urls)

    def read_bytes(self, uri: str) -> bytes:
        if not uri.startswith("vercel-blob://"):
            raise ObjectStorageError("Unsupported Vercel Blob URI.")
        pathname = _safe_key(uri.removeprefix("vercel-blob://"))
        result = self.client.get(pathname, access="private", use_cache=False)
        if result.status_code != 200:
            raise ObjectStorageError("Object not found.")
        return result.content

    def head(self, uri: str) -> ObjectMetadata:
        if not uri.startswith("vercel-blob://"):
            raise ObjectStorageError("Unsupported Vercel Blob URI.")
        pathname = _safe_key(uri.removeprefix("vercel-blob://"))
        if not pathname.startswith(f"{self.prefix}/"):
            raise ObjectStorageError("Object is outside the configured Blob prefix.")
        try:
            result = self.client.head(pathname)
        except BaseException as exc:
            raise ObjectStorageError("Object not found.") from exc
        return ObjectMetadata(
            pathname=result.pathname,
            size_bytes=result.size,
            content_type=result.content_type,
        )


def build_object_store(settings: Settings) -> ObjectStore:
    if settings.object_storage_backend == "vercel_blob":
        token = (
            settings.blob_read_write_token.get_secret_value()
            if settings.blob_read_write_token
            else None
        )
        return VercelBlobObjectStore(prefix=settings.object_storage_prefix, token=token)
    return LocalObjectStore(settings.zone_upload_storage_dir)
