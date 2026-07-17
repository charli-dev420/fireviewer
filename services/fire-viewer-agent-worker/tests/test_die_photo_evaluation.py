from __future__ import annotations

import base64
import gzip
import json

import pytest
from PIL import Image
from training.die_photo_evaluation import (
    PAIR_SPECS,
    PHOTO_CORPUS_ID,
    PhotoCorpusError,
    build,
)

from firewarning_worker.contracts import WorkerInput


def _source_images(tmp_path, *, duplicate: bool = False):
    source = tmp_path / "source"
    source.mkdir()
    names = [name for spec in PAIR_SPECS for name in (spec.photo_name, spec.provenance_name)]
    for index, name in enumerate(names):
        color_index = 0 if duplicate else index
        width = 96 if duplicate else 96 + index
        height = 64 if duplicate else 64 + index
        image = Image.new(
            "RGB",
            (width, height),
            color=((color_index * 23) % 255, (color_index * 41) % 255, 40 + color_index),
        )
        pixel_index = 0 if duplicate else index
        image.putpixel((pixel_index % image.width, pixel_index % image.height), (255, 255, 255))
        image.save(source / name, format="JPEG", quality=92)
    return source


def test_photo_corpus_emits_five_complete_pairs_and_validation_bundle(tmp_path) -> None:
    source = _source_images(tmp_path)
    dataset = tmp_path / "dataset"

    report = build(dataset, source)
    root = dataset / "corpus" / PHOTO_CORPUS_ID
    rows = [json.loads(line) for line in (root / "manifest.jsonl").read_text().splitlines()]
    payload = json.loads((root / "worker-payload.json").read_text())

    assert report["pipeline_evaluation_only"] is True
    assert report["training_membership"] is False
    assert report["pair_count"] == 5
    assert report["asset_count"] == 10
    assert len({row["sha256"] for row in rows}) == 10
    assert {row["pair_role"] for row in rows} == {"photo", "provenance"}
    assert all(row["excluded_from_training"] is True for row in rows)
    assert all(row["source_assets_publishable"] is False for row in [report])
    assert len(payload["items"]) == 10
    assert all(
        item["working_file_url"].startswith("https://validation-assets.internal/")
        for item in payload["items"]
    )
    WorkerInput.model_validate(payload)

    encoded = (root / "pod-assets.gzip.base64").read_text().strip()
    bundle = json.loads(gzip.decompress(base64.b64decode(encoded)))
    assert bundle["schema_version"] == 1
    assert len(bundle["assets"]) == 10


def test_exact_duplicates_are_rejected(tmp_path) -> None:
    source = _source_images(tmp_path, duplicate=True)

    with pytest.raises(PhotoCorpusError, match="exact duplicate"):
        build(tmp_path / "dataset", source)
