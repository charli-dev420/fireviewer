from __future__ import annotations

from hashlib import sha256

import pytest

from firewarning_worker.model_registry import (
    RTDETR_BASELINE,
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


def test_public_detector_baseline_is_explicitly_toggleable(monkeypatch) -> None:
    monkeypatch.delenv("FW_RTDETR_CHECKPOINT_PATH", raising=False)
    monkeypatch.delenv("FW_RTDETR_CHECKPOINT_SHA256", raising=False)
    monkeypatch.setenv("FW_ENABLE_RTDETR_BASELINE", "false")

    assert "fire_detection" not in build_registry()

    monkeypatch.setenv("FW_ENABLE_RTDETR_BASELINE", "true")
    detector = build_registry()["fire_detection"]
    assert detector == RTDETR_BASELINE
    assert detector.model_id == "PekingU/rtdetr_v2_r18vd"
    assert detector.revision == "5650961749fa93567c0d46fc7f43ea4f9e914107"


def test_private_detector_overrides_enabled_public_baseline(monkeypatch, tmp_path) -> None:
    checkpoint = tmp_path / "rtdetr-private"
    checkpoint.mkdir()
    weights = checkpoint / "model.safetensors"
    weights.write_bytes(b"private FireWarning checkpoint")
    digest = sha256(weights.read_bytes()).hexdigest()
    monkeypatch.setenv("FW_ENABLE_RTDETR_BASELINE", "true")
    monkeypatch.setenv("FW_RTDETR_CHECKPOINT_PATH", str(checkpoint))
    monkeypatch.setenv("FW_RTDETR_CHECKPOINT_SHA256", digest)

    detector = build_registry()["fire_detection"]

    assert detector.source == "local"
    assert detector.revision == f"sha256:{digest}"
