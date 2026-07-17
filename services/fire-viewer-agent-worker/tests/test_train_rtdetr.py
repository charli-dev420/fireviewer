from __future__ import annotations

import hashlib
from pathlib import Path

from training.corpus_pipeline import CLASS_NAMES
from training.train_rtdetr import LoadedRecord, build_preflight_report


def _record(
    *,
    identifier: str,
    split: str,
    role: str,
    class_id: int | None,
    validation: str = "source_provided",
) -> LoadedRecord:
    annotations = []
    if class_id is not None:
        annotations.append(
            {
                "class_id": class_id,
                "class_name": CLASS_NAMES[class_id],
                "validation_status": validation,
            }
        )
    return LoadedRecord(
        record={
            "sha256": hashlib.sha256(identifier.encode()).hexdigest(),
            "near_duplicate_of": None,
            "corpus_role": role,
            "split": split,
            "split_group": f"group:{identifier}",
            "annotations": annotations,
            "sample_validation_status": validation,
            "consent_basis": {"kind": "source_license", "reference": "test"},
        },
        corpus_root=Path("."),
    )


def _ready_records() -> list[LoadedRecord]:
    records: list[LoadedRecord] = []
    for split in ("train", "validation", "test"):
        for class_id in CLASS_NAMES:
            records.append(
                _record(
                    identifier=f"{split}:{class_id}",
                    split=split,
                    role="detector_training",
                    class_id=class_id,
                )
            )
    records.extend(
        [
            _record(
                identifier="train:negative",
                split="train",
                role="detector_training",
                class_id=None,
            ),
            _record(
                identifier="validation:negative",
                split="validation",
                role="detector_training",
                class_id=None,
            ),
        ]
    )
    for class_id in CLASS_NAMES:
        records.append(
            _record(
                identifier=f"critical:{class_id}",
                split="critical_test",
                role="detector_critical_test",
                class_id=class_id,
                validation="double_validated",
            )
        )
    records.append(
        _record(
            identifier="critical:negative",
            split="critical_test",
            role="detector_critical_test",
            class_id=None,
            validation="double_validated",
        )
    )
    return records


def test_preflight_accepts_complete_grouped_double_validated_corpus() -> None:
    report = build_preflight_report(_ready_records())

    assert report["training_ready"] is True
    assert report["deployment_ready"] is True
    assert report["training_profile"] == "operational_four_class_v1"
    assert report["errors"] == []
    assert report["critical_test_rows"] == 5


def test_preflight_rejects_missing_classes_and_unreviewed_critical_samples() -> None:
    records = _ready_records()
    records = [
        loaded
        for loaded in records
        if not (
            loaded.record["split"] == "validation"
            and loaded.record["annotations"]
            and loaded.record["annotations"][0]["class_id"] == 3
        )
    ]
    records[-1].record["sample_validation_status"] = "candidate_unreviewed"

    report = build_preflight_report(records)

    assert report["training_ready"] is False
    assert report["deployment_ready"] is False
    assert "missing_classes:validation:fire_response_vehicle_visible" in report["errors"]
    assert "critical_samples_not_double_validated:1" in report["errors"]


def test_preflight_rejects_cross_split_near_duplicates() -> None:
    records = _ready_records()
    reference = records[0].record["sha256"]
    validation_record = next(loaded for loaded in records if loaded.record["split"] == "validation")
    validation_record.record["near_duplicate_of"] = reference

    report = build_preflight_report(records)

    assert report["training_ready"] is False
    assert "cross_split_near_duplicates:1" in report["errors"]


def test_media_filter_can_train_before_critical_deployment_gate() -> None:
    records = [
        loaded
        for loaded in _ready_records()
        if loaded.record["corpus_role"] != "detector_critical_test"
        and (
            not loaded.record["annotations"]
            or loaded.record["annotations"][0]["class_id"] in {0, 1}
        )
    ]

    report = build_preflight_report(records, profile="media_filter_v1")

    assert report["required_classes"] == ["flame_visible", "smoke_visible"]
    assert report["training_ready"] is True
    assert report["deployment_ready"] is False
    assert report["training_errors"] == []
    assert report["deployment_errors"] == ["missing_detector_critical_test"]
