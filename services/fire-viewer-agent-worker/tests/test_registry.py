from __future__ import annotations

from hashlib import sha256

import pytest

from firewarning_worker.model_registry import (
    ModelSpec,
    RegistryError,
    build_registry,
    resolve_cached_snapshot,
)


def test_floating_hugging_face_revision_is_forbidden() -> None:
    with pytest.raises(RegistryError, match="immutable"):
        ModelSpec(role="asr", model_id="org/model", revision="main").validate()


def test_cache_resolution_requires_the_exact_commit(tmp_path) -> None:
    spec = ModelSpec(role="asr", model_id="org/model", revision="a" * 40)
    snapshot = tmp_path / "models--org--model" / "snapshots" / ("a" * 40)
    snapshot.mkdir(parents=True)
    assert resolve_cached_snapshot(spec, tmp_path) == snapshot
    with pytest.raises(RegistryError, match="absent"):
        resolve_cached_snapshot(
            ModelSpec(role="asr", model_id="org/model", revision="b" * 40), tmp_path
        )


def test_private_detector_digest_is_recalculated(monkeypatch, tmp_path) -> None:
    checkpoint = tmp_path / "rtdetr"
    checkpoint.mkdir()
    weights = checkpoint / "model.safetensors"
    weights.write_bytes(b"verified checkpoint")
    digest = sha256(weights.read_bytes()).hexdigest()
    monkeypatch.setenv("FW_RTDETR_CHECKPOINT_PATH", str(checkpoint))
    monkeypatch.setenv("FW_RTDETR_CHECKPOINT_SHA256", digest)
    assert build_registry()["fire_detection"].revision == f"sha256:{digest}"
    monkeypatch.setenv("FW_RTDETR_CHECKPOINT_SHA256", "0" * 64)
    with pytest.raises(RegistryError, match="does not match"):
        build_registry()
