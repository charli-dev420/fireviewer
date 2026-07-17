"""Build the private photo/provenance corpus used by the Die pipeline deployment test.

This module never prepares training data.  It pairs each clean photo with the user-provided
capture that exposes its source context, removes exact duplicates, and emits a ten-image worker
payload whose URLs are resolved only by the authenticated pod-validation runtime.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import os
import re
import shutil
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from firewarning_worker.contracts import WorkerInput

PHOTO_CORPUS_ID = "die-pontaix-ground-photo-pipeline-evaluation-v0.1.0"
VALIDATION_ASSET_HOST = "validation-assets.internal"
MAX_SOURCE_IMAGE_BYTES = 16 * 1024 * 1024
MAX_BUNDLE_ASSETS = 20
MAX_BUNDLE_RAW_BYTES = 16 * 1024 * 1024
VALIDATION_IMAGE_MAX_EDGE = 1024
VALIDATION_JPEG_QUALITY = 84
_SAFE_ASSET_NAME = re.compile(r"[a-z0-9][a-z0-9._-]{0,127}")


class PhotoCorpusError(RuntimeError):
    """Raised when a photo/provenance input cannot satisfy the test contract."""


@dataclass(frozen=True, slots=True)
class PairSpec:
    pair_id: str
    photo_name: str
    provenance_name: str
    source_name: str
    creator: str
    source_date_literal: str | None
    source_url: str | None
    date_basis: str
    association_note: str


PAIR_SPECS = (
    PairSpec(
        pair_id="alain-baule-facebook",
        photo_name="01-alain-baule-photo.jpg",
        provenance_name="01-alain-baule-provenance.jpg",
        source_name="Facebook public post supplied by the user",
        creator="Alain Baule (account shown in provenance capture)",
        source_date_literal=None,
        source_url=None,
        date_basis="unresolved; relative age in screenshot is not converted to a calendar date",
        association_note="photo and capture paired explicitly by the user",
    ),
    PairSpec(
        pair_id="thomas-pietrucci-facebook",
        photo_name="02-thomas-pietrucci-photo.jpg",
        provenance_name="02-thomas-pietrucci-provenance.jpg",
        source_name="Facebook public post supplied by the user",
        creator="Thomas Pietrucci (visible account and watermark)",
        source_date_literal=None,
        source_url=None,
        date_basis="unresolved; relative age in screenshot is not converted to a calendar date",
        association_note="photo and capture paired explicitly by the user",
    ),
    PairSpec(
        pair_id="mediapart-2026-07-10",
        photo_name="03-mediapart-photo.jpg",
        provenance_name="03-mediapart-provenance.jpg",
        source_name="Mediapart article shared in a public post",
        creator="not established by the supplied capture",
        source_date_literal="2026-07-10",
        source_url=(
            "https://www.mediapart.fr/journal/ecologie/100726/"
            "incendie-de-die-des-evacuations-chaotiques-et-une-communication-verrouillee"
        ),
        date_basis="publisher URL/publication date; not asserted as camera capture time",
        association_note="clean visual and source capture paired explicitly by the user",
    ),
    PairSpec(
        pair_id="journal-diois-barsac-2026-07-09",
        photo_name="04-journal-diois-photo.jpg",
        provenance_name="04-journal-diois-provenance.jpg",
        source_name="Journal du Diois et de la Drôme public post",
        creator="not established by the supplied capture",
        source_date_literal="2026-07-09",
        source_url=None,
        date_basis="literal date visible in the provenance capture",
        association_note="photo and dated capture paired explicitly by the user",
    ),
    PairSpec(
        pair_id="ville-die-point-feu-2026-07-09",
        photo_name="05-ville-die-photo.jpg",
        provenance_name="05-ville-die-provenance.jpg",
        source_name="Ville de Die public point-feu visual",
        creator="not established by the supplied capture",
        source_date_literal="2026-07-09 07:30 Europe/Paris",
        source_url=None,
        date_basis="literal point-feu timestamp visible in the official capture",
        association_note="clean visual and official context capture paired explicitly by the user",
    ),
)


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    os.replace(partial, path)


def _write_jsonl(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".partial.jsonl")
    with partial.open("w", encoding="utf-8", newline="\n") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(partial, path)


def _normalize_image(source: Path, destination: Path) -> dict[str, Any]:
    if not source.is_file():
        raise PhotoCorpusError(f"missing required photo input: {source.name}")
    if source.stat().st_size > MAX_SOURCE_IMAGE_BYTES:
        raise PhotoCorpusError(f"photo input exceeds size cap: {source.name}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(".partial.jpg")
    partial.unlink(missing_ok=True)
    try:
        with Image.open(source) as raw:
            raw.verify()
        with Image.open(source) as raw:
            normalized = ImageOps.exif_transpose(raw).convert("RGB")
            normalized.thumbnail(
                (VALIDATION_IMAGE_MAX_EDGE, VALIDATION_IMAGE_MAX_EDGE),
                Image.Resampling.LANCZOS,
            )
            normalized.save(
                partial,
                format="JPEG",
                quality=VALIDATION_JPEG_QUALITY,
                optimize=True,
                progressive=True,
            )
            width, height = normalized.size
        os.replace(partial, destination)
    finally:
        partial.unlink(missing_ok=True)
    return {
        "local_path": destination.as_posix(),
        "sha256": _sha256_file(destination),
        "byte_count": destination.stat().st_size,
        "width": width,
        "height": height,
        "image_format": "JPEG",
    }


def _asset_row(
    *,
    spec: PairSpec,
    role: str,
    path: Path,
    corpus_root: Path,
    index: int,
) -> dict[str, Any]:
    with Image.open(path) as image:
        width, height = image.size
        image.verify()
    asset_name = path.name
    return {
        "schema_version": 1,
        "corpus_id": PHOTO_CORPUS_ID,
        "asset_index": index,
        "asset_id": f"{spec.pair_id}-{role}",
        "pair_id": spec.pair_id,
        "pair_role": role,
        "media_type": "image",
        "local_path": path.relative_to(corpus_root).as_posix(),
        "validation_asset_name": asset_name,
        "working_file_url": f"https://{VALIDATION_ASSET_HOST}/{asset_name}",
        "sha256": _sha256_file(path),
        "byte_count": path.stat().st_size,
        "width": width,
        "height": height,
        "image_format": "JPEG",
        "source_name": spec.source_name,
        "source_url": spec.source_url,
        "creator": spec.creator,
        "source_date_literal": spec.source_date_literal,
        "date_basis": spec.date_basis,
        "association_note": spec.association_note,
        "access_basis": "user supplied for private pipeline evaluation",
        "redistribution_status": "not_cleared_do_not_publish_source_asset",
        "training_membership": False,
        "excluded_from_training": True,
        "human_validation_required": True,
        "validation_status": "awaiting_human_validation",
        "evaluation_result_publication_status": "not_published_awaiting_human_validation",
    }


def build_worker_payload(rows: list[Mapping[str, Any]]) -> dict[str, Any]:
    if len(rows) != 10:
        raise PhotoCorpusError("photo pipeline payload requires exactly five two-image pairs")
    pair_roles: dict[str, set[str]] = {}
    items: list[dict[str, Any]] = []
    for row in rows:
        pair_id = str(row["pair_id"])
        role = str(row["pair_role"])
        pair_roles.setdefault(pair_id, set()).add(role)
        context = (
            f"Private FireWarning deployment-test asset. Pair id: {pair_id}. "
            f"Pair role: {role}. Source: {row['source_name']}. Creator: {row['creator']}. "
            f"Source date literal: {row.get('source_date_literal') or 'unresolved'}. "
            f"Date basis: {row['date_basis']}. Do not infer a camera position or an absent date."
        )
        items.append(
            {
                "input_id": row["asset_id"],
                "media_type": "image",
                "working_file_url": row["working_file_url"],
                "metadata": {},
                "article_text": context,
            }
        )
    if len(pair_roles) != 5 or any(
        roles != {"photo", "provenance"} for roles in pair_roles.values()
    ):
        raise PhotoCorpusError("each pair must contain one photo and one provenance capture")
    payload = {
        "schema_version": "1.0",
        "batch_id": "die-pontaix-ground-photo-provenance-evaluation",
        "batch_type": "external_media",
        "priority": "scheduled",
        "items": items,
    }
    return WorkerInput.model_validate(payload).model_dump(mode="json", exclude_none=True)


def encode_payload(payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return base64.b64encode(gzip.compress(raw, compresslevel=9, mtime=0)).decode("ascii")


def encode_asset_bundle(rows: list[Mapping[str, Any]], corpus_root: Path) -> str:
    if not 1 <= len(rows) <= MAX_BUNDLE_ASSETS:
        raise PhotoCorpusError("asset bundle count is outside the validation limit")
    assets: dict[str, dict[str, str]] = {}
    raw_bytes = 0
    for row in rows:
        name = str(row["validation_asset_name"])
        if not _SAFE_ASSET_NAME.fullmatch(name) or name in assets:
            raise PhotoCorpusError(f"unsafe or duplicate validation asset name: {name}")
        value = (corpus_root / str(row["local_path"])).read_bytes()
        raw_bytes += len(value)
        if raw_bytes > MAX_BUNDLE_RAW_BYTES:
            raise PhotoCorpusError("validation asset bundle exceeds the raw byte cap")
        digest = _sha256_bytes(value)
        if digest != row["sha256"]:
            raise PhotoCorpusError(f"asset digest changed after manifest creation: {name}")
        assets[name] = {"sha256": digest, "data_b64": base64.b64encode(value).decode("ascii")}
    raw = json.dumps(
        {"schema_version": 1, "assets": assets},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return base64.b64encode(gzip.compress(raw, compresslevel=9, mtime=0)).decode("ascii")


def build(dataset_root: Path, source_root: Path, *, replace: bool = False) -> dict[str, Any]:
    dataset_root = dataset_root.resolve()
    source_root = source_root.resolve()
    corpus_root = dataset_root / "corpus" / PHOTO_CORPUS_ID
    if corpus_root.exists() and not replace:
        report_path = corpus_root / "build-report.json"
        if report_path.is_file():
            report = json.loads(report_path.read_text(encoding="utf-8"))
            if report.get("build_complete") is True:
                return report
        raise PhotoCorpusError(f"existing photo corpus must be reviewed: {corpus_root}")

    staging = corpus_root.with_name(f".{PHOTO_CORPUS_ID}.staging")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    try:
        rows: list[dict[str, Any]] = []
        index = 0
        for spec in PAIR_SPECS:
            pair_root = staging / "pairs" / spec.pair_id
            for role, filename in (
                ("photo", spec.photo_name),
                ("provenance", spec.provenance_name),
            ):
                index += 1
                destination = pair_root / f"{index:02d}-{role}.jpg"
                _normalize_image(source_root / filename, destination)
                rows.append(
                    _asset_row(
                        spec=spec,
                        role=role,
                        path=destination,
                        corpus_root=staging,
                        index=index,
                    )
                )
        digests = [row["sha256"] for row in rows]
        if len(digests) != len(set(digests)):
            raise PhotoCorpusError("exact duplicate remained in the selected photo test assets")

        payload = build_worker_payload(rows)
        _write_jsonl(staging / "manifest.jsonl", rows)
        _write_json(staging / "worker-payload.json", payload)
        bundle = encode_asset_bundle(rows, staging)
        payload_encoded = encode_payload(payload)
        (staging / "pod-assets.gzip.base64").write_text(bundle + "\n", encoding="ascii")
        (staging / "pod-payload.gzip.base64").write_text(payload_encoded + "\n", encoding="ascii")
        report = {
            "schema_version": 1,
            "corpus_id": PHOTO_CORPUS_ID,
            "build_complete": True,
            "pair_count": len(PAIR_SPECS),
            "asset_count": len(rows),
            "photo_count": sum(row["pair_role"] == "photo" for row in rows),
            "provenance_capture_count": sum(row["pair_role"] == "provenance" for row in rows),
            "exact_duplicate_count": 0,
            "worker_payload_items": len(payload["items"]),
            "payload_sha256": _sha256_bytes(
                json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
            ),
            "asset_bundle_encoded_bytes": len(bundle.encode("ascii")),
            "training_membership": False,
            "excluded_from_training": True,
            "pipeline_evaluation_only": True,
            "human_validation_required": True,
            "source_assets_publishable": False,
            "evaluation_results_publishable_after_human_validation": True,
            "current_publication_status": "not_published_awaiting_human_validation",
            "docker_image_contains_assets": False,
            "github_contains_assets": False,
        }
        _write_json(staging / "build-report.json", report)
        corpus_root.parent.mkdir(parents=True, exist_ok=True)
        if replace and corpus_root.exists():
            previous = corpus_root.with_name(f".{PHOTO_CORPUS_ID}.previous")
            if previous.exists():
                raise PhotoCorpusError(f"previous photo corpus backup must be reviewed: {previous}")
            os.replace(corpus_root, previous)
            try:
                os.replace(staging, corpus_root)
            except Exception:
                os.replace(previous, corpus_root)
                raise
            shutil.rmtree(previous)
        else:
            os.replace(staging, corpus_root)
        return report
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--replace", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    report = build(args.dataset_root, args.source_root, replace=args.replace)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
