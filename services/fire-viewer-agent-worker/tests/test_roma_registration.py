from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import pytest
from training.spatial_register_roma import RegistrationSetupError, preflight

from firewarning_worker.roma_registration import (
    AssetSpec,
    RomaAssetError,
    _download_asset,
    verify_asset,
)


def test_asset_download_is_atomic_and_digest_verified(tmp_path: Path) -> None:
    payload = b"pinned model bytes"
    spec = AssetSpec(
        filename="model.pth",
        url="https://models.invalid/model.pth",
        size=len(payload),
        sha256=hashlib.sha256(payload).hexdigest(),
        license="MIT",
    )

    path = _download_asset(tmp_path, spec, opener=lambda *_args, **_kwargs: io.BytesIO(payload))

    assert path.read_bytes() == payload
    assert not path.with_suffix(".pth.partial").exists()
    verify_asset(path, spec)


def test_altered_asset_is_rejected_and_partial_is_removed(tmp_path: Path) -> None:
    spec = AssetSpec(
        filename="model.pth",
        url="https://models.invalid/model.pth",
        size=8,
        sha256="0" * 64,
        license="MIT",
    )

    with pytest.raises(RomaAssetError, match="SHA-256 mismatch"):
        _download_asset(tmp_path, spec, opener=lambda *_args, **_kwargs: io.BytesIO(b"altered!"))

    assert not (tmp_path / "weights/model.pth").exists()
    assert not (tmp_path / "weights/model.pth.partial").exists()


def _write_corpus(tmp_path: Path, *, operational: bool = False) -> None:
    corpus = tmp_path / "corpus/cross-view-registration-v0.1.0"
    corpus.mkdir(parents=True)
    rows = []
    for index, source_id in enumerate(
        ("aerialextrematch_localization", "odm_sance_mountain", "odm_seneca_rural")
    ):
        rows.append(
            {
                "operational_incident": operational,
                "sample_id": f"sample-{index}",
                "source_id": source_id,
                "split": "validation" if index == 0 else "train",
                "split_group": f"group-{index}",
            }
        )
    manifest = corpus / "manifest.jsonl"
    manifest.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    report = {
        "gates": {"deployment_ready": False, "training_ready": True},
        "manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
        "rows": len(rows),
        "split_counts": {"train": 2, "validation": 1},
    }
    (corpus / "build-report.json").write_text(json.dumps(report), encoding="utf-8")


def test_cross_view_preflight_keeps_training_disabled(tmp_path: Path) -> None:
    _write_corpus(tmp_path)

    report = preflight(tmp_path)

    assert report["rows"] == 3
    assert report["deployment_ready"] is False
    assert report["training_command_available"] is False
    assert report["critical_lot_included"] is False


def test_cross_view_preflight_rejects_operational_media(tmp_path: Path) -> None:
    _write_corpus(tmp_path, operational=True)

    with pytest.raises(RegistrationSetupError, match="operational registration row denied"):
        preflight(tmp_path)
