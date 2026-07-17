from __future__ import annotations

import json
from contextlib import nullcontext
from pathlib import Path

import pytest

from firewarning_worker import bootstrap
from firewarning_worker import model_provisioning as provisioning
from firewarning_worker.model_provisioning import CacheStatus


def test_auto_prefetch_disabled_fails_before_starting_worker(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("FW_HF_CACHE_ROOT", str(tmp_path / "cache" / "hub"))
    monkeypatch.setenv("FW_ROMA_ROOT", str(tmp_path / "roma"))
    monkeypatch.setenv("FW_AUTO_PREFETCH_MODELS", "false")

    with pytest.raises(RuntimeError, match="auto-prefetch is disabled"):
        bootstrap.ensure_model_cache()


def test_missing_cache_is_provisioned_once_and_returns_offline(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    statuses = iter(
        (
            CacheStatus(("asr",)),
            CacheStatus(("asr",)),
            CacheStatus(()),
        )
    )
    provisioned: list[tuple[Path, Path]] = []
    monkeypatch.setenv("FW_HF_CACHE_ROOT", str(tmp_path / "cache" / "hub"))
    monkeypatch.setenv("FW_ROMA_ROOT", str(tmp_path / "roma"))
    monkeypatch.setenv("FW_AUTO_PREFETCH_MODELS", "true")
    monkeypatch.setattr(bootstrap, "cache_status", lambda *_args, **_kwargs: next(statuses))
    monkeypatch.setattr(bootstrap, "_volume_lock", lambda _path: nullcontext())
    monkeypatch.setattr(
        bootstrap,
        "provision_model_cache",
        lambda cache, roma: provisioned.append((cache, roma)),
    )

    bootstrap.ensure_model_cache()

    assert len(provisioned) == 1
    assert provisioned[0][0] == (tmp_path / "cache" / "hub").resolve()
    assert provisioned[0][1] == (tmp_path / "roma").resolve()
    assert bootstrap.os.environ["HF_HUB_OFFLINE"] == "1"
    assert bootstrap.os.environ["TRANSFORMERS_OFFLINE"] == "1"


def test_ready_cache_skips_lock_and_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bootstrap, "cache_status", lambda *_args, **_kwargs: CacheStatus(()))
    monkeypatch.setattr(
        bootstrap,
        "_volume_lock",
        lambda _path: pytest.fail("ready cache must not acquire the provisioning lock"),
    )
    monkeypatch.setattr(
        bootstrap,
        "provision_model_cache",
        lambda *_args, **_kwargs: pytest.fail("ready cache must not download models"),
    )

    bootstrap.ensure_model_cache()


def test_runtime_mode_selects_only_fixed_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FW_RUN_MODE", "pod_validation")
    assert bootstrap._runtime_module() == "firewarning_worker.pod_validation"

    monkeypatch.setenv("FW_RUN_MODE", "arbitrary.module")
    with pytest.raises(RuntimeError, match="unsupported FW_RUN_MODE"):
        bootstrap._runtime_module()


def test_provisioner_reuses_only_marked_complete_snapshots(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    cache_root = tmp_path / "cache" / "hub"
    roma_root = tmp_path / "roma"
    cache_root.mkdir(parents=True)
    first, *missing = provisioning.PUBLIC_MODELS
    first_snapshot = provisioning._snapshot_path(cache_root, first)
    first_snapshot.mkdir(parents=True)
    (first_snapshot / "config.json").write_text("{}", encoding="utf-8")
    marker = provisioning._manifest_path(cache_root)
    marker.write_text(
        json.dumps(
            {
                "models": [
                    {"model_id": first.model_id, "revision": first.revision, "role": first.role}
                ]
            }
        ),
        encoding="utf-8",
    )
    downloaded: list[str] = []

    def fake_snapshot_download(*, repo_id: str, revision: str, **_kwargs: object) -> str:
        spec = next(model for model in missing if model.model_id == repo_id)
        assert spec.revision == revision
        snapshot = provisioning._snapshot_path(cache_root, spec)
        snapshot.mkdir(parents=True)
        (snapshot / "config.json").write_text("{}", encoding="utf-8")
        downloaded.append(repo_id)
        return str(snapshot)

    monkeypatch.setattr("huggingface_hub.snapshot_download", fake_snapshot_download)
    monkeypatch.setattr(
        provisioning,
        "provision_roma_assets",
        lambda _root: {"source_revision": "pinned-test-revision"},
    )

    manifest = provisioning.provision_model_cache(cache_root, roma_root)

    assert downloaded == [spec.model_id for spec in missing]
    assert manifest["models"][0]["model_id"] == first.model_id
