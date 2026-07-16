from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from fire_viewer.core.config import Settings
from fire_viewer.db.engine import normalize_database_url
from fire_viewer.storage.object_store import (
    LocalObjectStore,
    ObjectStorageError,
    VercelBlobObjectStore,
    build_object_store,
)


def test_neon_database_urls_select_psycopg3() -> None:
    assert (
        normalize_database_url("postgres://user:secret@db.example/firewarning?sslmode=require")
        == "postgresql+psycopg://user:secret@db.example/firewarning?sslmode=require"
    )
    assert (
        normalize_database_url("postgresql://user:secret@db.example/firewarning")
        == "postgresql+psycopg://user:secret@db.example/firewarning"
    )
    assert normalize_database_url("sqlite:///./local.db") == "sqlite:///./local.db"


def test_hosted_runtime_rejects_sqlite_and_production_local_storage() -> None:
    common = {
        "_env_file": None,
        "auth_mode": "jwt",
        "oidc_jwks_url": "https://identity.example/.well-known/jwks.json",
        "oidc_issuer": "https://identity.example/",
        "oidc_audience": "firewarning",
        "public_report_hash_secret": "a" * 32,
        "trusted_hosts": ["firewarning.example"],
    }

    with pytest.raises(ValidationError, match="PostgreSQL is required"):
        Settings(environment="staging", database_url="sqlite:///./data.db", **common)

    with pytest.raises(ValidationError, match="Vercel Blob private storage is required"):
        Settings(
            environment="production",
            database_url="postgresql://user:secret@db.example/firewarning",
            object_storage_backend="local",
            **common,
        )


def test_blob_token_accepts_vercel_marketplace_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "vercel-marketplace-token")
    settings = Settings(_env_file=None)
    assert settings.blob_read_write_token is not None
    assert settings.blob_read_write_token.get_secret_value() == "vercel-marketplace-token"


def test_local_object_store_round_trip_is_immutable(tmp_path: Path) -> None:
    store = LocalObjectStore(tmp_path / "objects")
    staged = tmp_path / "staged"
    staged.mkdir()
    (staged / "manifest.json").write_text('{"version": 1}', encoding="utf-8")

    store.finalize_tree(staged, "zones/Z-001/revision-1")
    uri = store.uri_for("zones/Z-001/revision-1/manifest.json")

    assert not staged.exists()
    assert store.read_bytes(uri) == b'{"version": 1}'

    duplicate = tmp_path / "duplicate"
    duplicate.mkdir()
    (duplicate / "manifest.json").write_text("duplicate", encoding="utf-8")
    with pytest.raises(ObjectStorageError, match="already exists"):
        store.finalize_tree(duplicate, "zones/Z-001/revision-1")


@pytest.mark.parametrize(
    "key",
    [
        "../escape",
        "/absolute",
        "zones\\windows",
        "zones/./revision",
        "zones/../escape",
        "zones//revision",
    ],
)
def test_object_store_rejects_unsafe_keys(tmp_path: Path, key: str) -> None:
    store = LocalObjectStore(tmp_path / "objects")
    with pytest.raises(ObjectStorageError):
        store.uri_for(key)


def test_vercel_blob_store_uses_private_immutable_objects(tmp_path: Path) -> None:
    calls: list[tuple[Path, str, dict[str, object]]] = []
    deleted: list[list[str]] = []
    objects: dict[str, bytes] = {}

    class FakeBlobClient:
        def upload_file(self, source: Path, object_key: str, **kwargs: object):
            calls.append((source, object_key, kwargs))
            objects[object_key] = source.read_bytes()
            return SimpleNamespace(pathname=object_key, url=f"https://blob.example/{object_key}")

        def delete(self, urls: list[str]) -> None:
            deleted.append(urls)

        def iter_objects(self, *, prefix: str):
            return iter([])

        def get(self, pathname: str, **kwargs: object):
            assert kwargs == {"access": "private", "use_cache": False}
            return SimpleNamespace(status_code=200, content=objects[pathname])

    store = VercelBlobObjectStore(prefix="firewarning", token="secret")
    store.client = FakeBlobClient()  # type: ignore[assignment]
    staged = tmp_path / "staged"
    staged.mkdir()
    (staged / "scene.glb").write_bytes(b"glb")

    store.finalize_tree(staged, "zones/Z-001/revision-1")
    uri = store.uri_for("zones/Z-001/revision-1/scene.glb")

    assert uri == "vercel-blob://firewarning/zones/Z-001/revision-1/scene.glb"
    assert store.read_bytes(uri) == b"glb"
    assert deleted == []
    assert len(calls) == 1
    assert calls[0][1] == "firewarning/zones/Z-001/revision-1/scene.glb"
    assert calls[0][2]["access"] == "private"
    assert calls[0][2]["overwrite"] is False
    assert calls[0][2]["add_random_suffix"] is False


def test_object_store_factory_uses_configured_backend(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        zone_upload_storage_dir=tmp_path / "objects",
        object_storage_backend="local",
    )
    assert isinstance(build_object_store(settings), LocalObjectStore)


def test_readiness_requires_current_schema_and_spatial_runtime(client, session) -> None:
    ready = client.get("/readyz")
    assert ready.status_code == 200
    assert ready.json() == {
        "status": "ready",
        "database": "ok",
        "schema_revision": "e6f3a1b8c420",
        "spatial_index": "ok",
    }

    session.execute(text("UPDATE alembic_version SET version_num = '000000000000'"))
    session.commit()

    stale = client.get("/readyz")
    assert stale.status_code == 503
    assert stale.json()["type"] == "urn:fire-viewer:error:not_ready"
