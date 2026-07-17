from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from training.corpus_pipeline import CLASS_NAMES, sha256_bytes, validate_manifest

BASE_MODEL = "PekingU/rtdetr_v2_r18vd"
BASE_MODEL_REVISION = "5650961749fa93567c0d46fc7f43ea4f9e914107"
DETECTOR_ROLES = {"detector_training", "detector_critical_test"}
TRAINING_PROFILES = {
    "media_filter_v1": {0: CLASS_NAMES[0], 1: CLASS_NAMES[1]},
    "operational_four_class_v1": dict(CLASS_NAMES),
}


@dataclass(frozen=True)
class LoadedRecord:
    record: dict[str, Any]
    corpus_root: Path


def _read_manifest(path: Path, *, verify_files: bool) -> list[LoadedRecord]:
    validate_manifest(path, output_dir=path.parent, verify_files=verify_files)
    loaded: list[LoadedRecord] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"Manifest {path} line {line_number} is not an object")
            loaded.append(LoadedRecord(value, path.parent.resolve()))
    return loaded


def load_records(manifests: list[Path], *, verify_files: bool) -> list[LoadedRecord]:
    if not manifests:
        raise ValueError("At least one --manifest is required")
    records: list[LoadedRecord] = []
    seen_digests: dict[str, Path] = {}
    for manifest in manifests:
        for loaded in _read_manifest(manifest.resolve(), verify_files=verify_files):
            digest = str(loaded.record["sha256"])
            if digest in seen_digests:
                raise ValueError(
                    f"Duplicate image digest across manifests: {digest} "
                    f"({seen_digests[digest]} and {manifest})"
                )
            seen_digests[digest] = manifest
            records.append(loaded)
    return records


def build_preflight_report(
    records: list[LoadedRecord], *, profile: str = "operational_four_class_v1"
) -> dict[str, Any]:
    if profile not in TRAINING_PROFILES:
        raise ValueError(f"Unknown training profile: {profile}")
    role_counts: Counter[str] = Counter()
    split_counts: Counter[str] = Counter()
    negative_counts: Counter[str] = Counter()
    class_counts: dict[str, Counter[str]] = defaultdict(Counter)
    group_splits: dict[str, set[str]] = defaultdict(set)
    consent_kinds: Counter[str] = Counter()
    detector_records: list[dict[str, Any]] = []
    critical_records: list[dict[str, Any]] = []
    digest_splits: dict[str, str] = {}
    near_duplicate_links: list[tuple[str, str]] = []
    training_errors: list[str] = []
    deployment_errors: list[str] = []

    for loaded in records:
        record = loaded.record
        role = str(record.get("corpus_role", "missing"))
        role_counts[role] += 1
        consent = record.get("consent_basis", {})
        consent_kinds[str(consent.get("kind", "missing"))] += 1
        if role not in DETECTOR_ROLES:
            continue
        detector_records.append(record)
        split = str(record["split"])
        digest_splits[str(record["sha256"])] = split
        near_duplicate = record.get("near_duplicate_of")
        if near_duplicate:
            near_duplicate_links.append((str(near_duplicate), split))
        split_counts[split] += 1
        group_splits[str(record["split_group"])].add(split)
        annotations = record["annotations"]
        if not annotations:
            negative_counts[split] += 1
        for annotation in annotations:
            class_counts[split][str(annotation["class_name"])] += 1
        if role == "detector_critical_test":
            critical_records.append(record)

    leaking_groups = sorted(group for group, splits in group_splits.items() if len(splits) > 1)
    if leaking_groups:
        training_errors.append(f"split_group_leakage:{len(leaking_groups)}")
    missing_near_duplicate_references = sum(
        reference not in digest_splits for reference, _split in near_duplicate_links
    )
    cross_split_near_duplicates = sum(
        reference in digest_splits and digest_splits[reference] != split
        for reference, split in near_duplicate_links
    )
    if missing_near_duplicate_references:
        training_errors.append(
            f"near_duplicate_reference_missing:{missing_near_duplicate_references}"
        )
    if cross_split_near_duplicates:
        training_errors.append(f"cross_split_near_duplicates:{cross_split_near_duplicates}")

    required_classes = set(TRAINING_PROFILES[profile].values())
    for split in ("train", "validation"):
        if split_counts[split] == 0:
            training_errors.append(f"missing_split:{split}")
        missing = sorted(required_classes - set(class_counts[split]))
        if missing:
            training_errors.append(f"missing_classes:{split}:{','.join(missing)}")
        if negative_counts[split] == 0:
            training_errors.append(f"missing_negative_rows:{split}")

    if split_counts["test"] == 0:
        deployment_errors.append("missing_split:test")
    if not critical_records:
        deployment_errors.append("missing_detector_critical_test")
    else:
        critical_classes = {
            str(annotation["class_name"])
            for record in critical_records
            for annotation in record["annotations"]
        }
        missing_critical = sorted(required_classes - critical_classes)
        if missing_critical:
            deployment_errors.append(f"missing_classes:critical_test:{','.join(missing_critical)}")
        if not any(not record["annotations"] for record in critical_records):
            deployment_errors.append("missing_negative_rows:critical_test")
        invalid_critical_samples = sum(
            str(record.get("sample_validation_status", "candidate_unreviewed"))
            != "double_validated"
            for record in critical_records
        )
        invalid_critical_annotations = sum(
            str(annotation.get("validation_status", "")) != "double_validated"
            for record in critical_records
            for annotation in record["annotations"]
        )
        if invalid_critical_samples:
            deployment_errors.append(
                f"critical_samples_not_double_validated:{invalid_critical_samples}"
            )
        if invalid_critical_annotations:
            deployment_errors.append(
                f"critical_annotations_not_double_validated:{invalid_critical_annotations}"
            )

    invalid_training_samples = sum(
        str(record.get("sample_validation_status", "candidate_unreviewed"))
        not in {"source_provided", "double_validated"}
        for record in detector_records
        if record["corpus_role"] == "detector_training"
    )
    if invalid_training_samples:
        training_errors.append(f"training_samples_not_approved:{invalid_training_samples}")

    errors = [*training_errors, *deployment_errors]

    return {
        "schema_version": 1,
        "base_model": BASE_MODEL,
        "base_model_revision": BASE_MODEL_REVISION,
        "training_profile": profile,
        "required_classes": sorted(required_classes),
        "input_rows": len(records),
        "detector_rows": len(detector_records),
        "role_counts": dict(sorted(role_counts.items())),
        "split_counts": dict(sorted(split_counts.items())),
        "negative_counts": dict(sorted(negative_counts.items())),
        "class_counts": {
            split: dict(sorted(counts.items())) for split, counts in sorted(class_counts.items())
        },
        "consent_kinds": dict(sorted(consent_kinds.items())),
        "split_leakage_groups": len(leaking_groups),
        "cross_split_near_duplicates": cross_split_near_duplicates,
        "missing_near_duplicate_references": missing_near_duplicate_references,
        "critical_test_rows": len(critical_records),
        "errors": errors,
        "training_errors": training_errors,
        "deployment_errors": deployment_errors,
        "training_ready": not training_errors,
        "deployment_ready": not errors,
    }


def _dataset_rows(
    records: list[LoadedRecord], *, allowed_class_ids: frozenset[int]
) -> dict[str, list[dict[str, Any]]]:
    rows_by_split: dict[str, list[dict[str, Any]]] = defaultdict(list)
    counters: Counter[str] = Counter()
    for loaded in records:
        record = loaded.record
        role = str(record["corpus_role"])
        if role not in DETECTOR_ROLES:
            continue
        split = "critical_test" if role == "detector_critical_test" else str(record["split"])
        image_id = counters[split]
        counters[split] += 1
        annotations = [
            annotation
            for annotation in record["annotations"]
            if int(annotation["class_id"]) in allowed_class_ids
        ]
        rows_by_split[split].append(
            {
                "image": str((loaded.corpus_root / str(record["image_relpath"])).resolve()),
                "image_id": image_id,
                "objects": {
                    "id": list(range(len(annotations))),
                    "area": [
                        float(annotation["bbox_xywh"][2]) * float(annotation["bbox_xywh"][3])
                        for annotation in annotations
                    ],
                    "bbox": [
                        [float(value) for value in annotation["bbox_xywh"]]
                        for annotation in annotations
                    ],
                    "category": [int(annotation["class_id"]) for annotation in annotations],
                },
            }
        )
    return rows_by_split


def _format_coco(
    image_id: int,
    categories: list[int],
    areas: list[float],
    boxes: list[list[float]],
) -> dict[str, Any]:
    return {
        "image_id": image_id,
        "annotations": [
            {
                "image_id": image_id,
                "category_id": category,
                "iscrowd": 0,
                "area": area,
                "bbox": box,
            }
            for category, area, box in zip(categories, areas, boxes, strict=True)
        ],
    }


def _transform_batch(
    examples: dict[str, Any],
    *,
    transform: Any,
    image_processor: Any,
) -> Any:
    import numpy as np

    images: list[Any] = []
    annotations: list[dict[str, Any]] = []
    for image_id, image, objects in zip(
        examples["image_id"], examples["image"], examples["objects"], strict=True
    ):
        transformed = transform(
            image=np.asarray(image.convert("RGB")),
            bboxes=list(objects["bbox"]),
            category=list(objects["category"]),
        )
        boxes = [[float(value) for value in box] for box in transformed["bboxes"]]
        categories = [int(value) for value in transformed["category"]]
        areas = [box[2] * box[3] for box in boxes]
        images.append(transformed["image"])
        annotations.append(_format_coco(int(image_id), categories, areas, boxes))
    result = image_processor(images=images, annotations=annotations, return_tensors="pt")
    result.pop("pixel_mask", None)
    return result


def _collate(batch: list[dict[str, Any]]) -> dict[str, Any]:
    import torch

    return {
        "pixel_values": torch.stack([item["pixel_values"] for item in batch]),
        "labels": [item["labels"] for item in batch],
    }


def _center_to_corners(boxes: Any, image_size: Any) -> Any:
    import torch
    from transformers.image_transforms import center_to_corners_format

    corners = center_to_corners_format(boxes)
    height, width = [int(value) for value in image_size]
    return corners * torch.tensor([[width, height, width, height]])


def _compute_metrics(evaluation: Any, *, image_processor: Any) -> dict[str, float]:
    import torch
    from torchmetrics.detection.mean_ap import MeanAveragePrecision

    predictions, targets = evaluation.predictions, evaluation.label_ids
    image_sizes: list[Any] = []
    metric_targets: list[dict[str, Any]] = []
    metric_predictions: list[dict[str, Any]] = []
    for batch in targets:
        image_sizes.append(torch.tensor([target["orig_size"] for target in batch]))
        for target in batch:
            metric_targets.append(
                {
                    "boxes": _center_to_corners(torch.tensor(target["boxes"]), target["orig_size"]),
                    "labels": torch.tensor(target["class_labels"]),
                }
            )
    for batch, target_sizes in zip(predictions, image_sizes, strict=True):
        if len(batch) == 3:
            logits, boxes = batch[1], batch[2]
        elif len(batch) == 2:
            logits, boxes = batch
        else:
            raise ValueError(f"Unexpected RT-DETR prediction tuple length: {len(batch)}")
        output = SimpleNamespace(logits=torch.tensor(logits), pred_boxes=torch.tensor(boxes))
        metric_predictions.extend(
            image_processor.post_process_object_detection(
                output, threshold=0.0, target_sizes=target_sizes
            )
        )
    metric = MeanAveragePrecision(box_format="xyxy", class_metrics=True)
    metric.update(metric_predictions, metric_targets)
    raw = metric.compute()
    classes = raw.pop("classes")
    per_class_map = raw.pop("map_per_class")
    per_class_mar = raw.pop("mar_100_per_class")
    if classes.ndim == 0:
        classes = classes.unsqueeze(0)
        per_class_map = per_class_map.unsqueeze(0)
        per_class_mar = per_class_mar.unsqueeze(0)
    for class_id, class_map, class_mar in zip(classes, per_class_map, per_class_mar, strict=True):
        class_name = CLASS_NAMES[int(class_id.item())]
        raw[f"map_{class_name}"] = class_map
        raw[f"mar_100_{class_name}"] = class_mar
    return {key: round(float(value.item()), 4) for key, value in raw.items()}


def _checkpoint_digest(output_dir: Path) -> str:
    weights = output_dir / "model.safetensors"
    if not weights.is_file():
        raise FileNotFoundError("Training output does not contain model.safetensors")
    digest = hashlib.sha256()
    with weights.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    value = digest.hexdigest()
    (output_dir / "model.safetensors.sha256").write_text(
        f"{value}  model.safetensors\n", encoding="ascii"
    )
    return value


def run_training(
    records: list[LoadedRecord],
    manifests: list[Path],
    output_dir: Path,
    args: argparse.Namespace,
    class_names: dict[int, str],
) -> None:
    import albumentations as A
    import torch
    from datasets import Dataset, DatasetDict, Image
    from transformers import (
        AutoImageProcessor,
        AutoModelForObjectDetection,
        Trainer,
        TrainingArguments,
        set_seed,
    )

    if not torch.cuda.is_available():
        raise RuntimeError("RT-DETR training requires a CUDA GPU")
    set_seed(args.seed)
    torch.backends.cuda.matmul.allow_tf32 = True
    precision_bf16 = torch.cuda.is_bf16_supported()

    rows_by_split = _dataset_rows(records, allowed_class_ids=frozenset(class_names))
    datasets: dict[str, Any] = {}
    for split, rows in rows_by_split.items():
        dataset = Dataset.from_list(rows).cast_column("image", Image())
        datasets[split] = dataset
    dataset_dict = DatasetDict(datasets)

    id2label = dict(class_names)
    label2id = {name: identifier for identifier, name in id2label.items()}
    pretrained = {
        "revision": BASE_MODEL_REVISION,
        "trust_remote_code": False,
        "cache_dir": str(args.cache_dir),
    }
    image_processor = AutoImageProcessor.from_pretrained(
        BASE_MODEL,
        do_resize=True,
        size={"max_height": args.image_size, "max_width": args.image_size},
        do_pad=True,
        pad_size={"height": args.image_size, "width": args.image_size},
        use_fast=True,
        **pretrained,
    )
    model = AutoModelForObjectDetection.from_pretrained(
        BASE_MODEL,
        id2label=id2label,
        label2id=label2id,
        ignore_mismatched_sizes=True,
        **pretrained,
    )

    bbox_parameters = A.BboxParams(format="coco", label_fields=["category"], clip=True, min_area=4)
    train_transform = A.Compose(
        [
            A.HorizontalFlip(p=0.5),
            A.RandomBrightnessContrast(p=0.35),
            A.OneOf(
                [A.MotionBlur(blur_limit=5, p=1.0), A.GaussianBlur(blur_limit=5, p=1.0)],
                p=0.08,
            ),
            A.HueSaturationValue(p=0.08),
        ],
        bbox_params=bbox_parameters,
    )
    eval_transform = A.Compose([A.NoOp()], bbox_params=bbox_parameters)
    dataset_dict["train"] = dataset_dict["train"].with_transform(
        partial(_transform_batch, transform=train_transform, image_processor=image_processor)
    )
    for split in ("validation", "test", "critical_test"):
        if split in dataset_dict:
            dataset_dict[split] = dataset_dict[split].with_transform(
                partial(_transform_batch, transform=eval_transform, image_processor=image_processor)
            )

    output_dir.mkdir(parents=True, exist_ok=True)
    provenance = {
        "schema_version": 1,
        "base_model": BASE_MODEL,
        "base_model_revision": BASE_MODEL_REVISION,
        "manifest_sha256": {
            str(path.resolve()): sha256_bytes(path.resolve().read_bytes()) for path in manifests
        },
        "class_names": class_names,
        "training_profile": args.profile,
        "cuda_device": torch.cuda.get_device_name(0),
        "cuda_total_vram_bytes": torch.cuda.get_device_properties(0).total_memory,
        "precision": "bf16" if precision_bf16 else "fp16",
        "image_size": args.image_size,
        "batch_size": args.batch_size,
        "gradient_accumulation_steps": args.gradient_accumulation_steps,
        "seed": args.seed,
    }
    (output_dir / "training-provenance.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    training_arguments = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        learning_rate=args.learning_rate,
        weight_decay=1e-4,
        warmup_ratio=0.05,
        lr_scheduler_type="cosine",
        max_grad_norm=0.1,
        bf16=precision_bf16,
        fp16=not precision_bf16,
        tf32=True,
        gradient_checkpointing=args.gradient_checkpointing,
        optim="adamw_torch_fused",
        eval_strategy="epoch",
        save_strategy="epoch",
        logging_strategy="steps",
        logging_steps=25,
        load_best_model_at_end=True,
        metric_for_best_model="eval_map",
        greater_is_better=True,
        save_total_limit=2,
        remove_unused_columns=False,
        eval_do_concat_batches=False,
        dataloader_num_workers=args.workers,
        dataloader_persistent_workers=args.workers > 0,
        report_to="none",
        push_to_hub=False,
        seed=args.seed,
        data_seed=args.seed,
    )
    trainer = Trainer(
        model=model,
        args=training_arguments,
        train_dataset=dataset_dict["train"],
        eval_dataset=dataset_dict["validation"],
        processing_class=image_processor,
        data_collator=_collate,
        compute_metrics=partial(_compute_metrics, image_processor=image_processor),
    )
    train_result = trainer.train(resume_from_checkpoint=args.resume_from_checkpoint)
    trainer.save_model(str(output_dir))
    image_processor.save_pretrained(str(output_dir))
    trainer.save_metrics("train", train_result.metrics)
    trainer.save_state()
    for split in ("test", "critical_test"):
        if split in dataset_dict:
            metrics = trainer.evaluate(eval_dataset=dataset_dict[split], metric_key_prefix=split)
            trainer.save_metrics(split, metrics)
    digest = _checkpoint_digest(output_dir)
    print(f"FW_RTDETR_CHECKPOINT_PATH={output_dir.resolve()}")
    print(f"FW_RTDETR_CHECKPOINT_SHA256=sha256:{digest}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Preflight and train FireWarning RT-DETRv2-R18")
    parser.add_argument("command", choices=("preflight", "train"))
    parser.add_argument("--profile", choices=tuple(TRAINING_PROFILES), default="media_filter_v1")
    parser.add_argument("--require-deployment-ready", action="store_true")
    parser.add_argument("--manifest", action="append", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("data/training/rtdetr-v2-r18"))
    parser.add_argument("--cache-dir", type=Path, default=Path("data/huggingface-cache"))
    parser.add_argument("--verify-files", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--eval-batch-size", type=int, default=2)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=8)
    parser.add_argument(
        "--gradient-checkpointing", action=argparse.BooleanOptionalAction, default=True
    )
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--resume-from-checkpoint", default=None)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    records = load_records(args.manifest, verify_files=args.verify_files)
    report = build_preflight_report(records, profile=args.profile)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if args.command == "preflight":
        gate = "deployment_ready" if args.require_deployment_ready else "training_ready"
        if not report[gate]:
            raise SystemExit(2)
        return
    if not report["training_ready"]:
        raise RuntimeError("Training gate failed; resolve every preflight error before training")
    run_training(records, args.manifest, args.output, args, TRAINING_PROFILES[args.profile])


if __name__ == "__main__":
    main()
