"""Provision and validate the pinned AerialExtreMatch-RoMa registration path.

There is intentionally no training command.  The official checkpoint must first pass the held-out
cross-view benchmark and the future double-validated critical lot.  Qwen training remains a
separate, locked fire-pointing concern.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from firewarning_worker.roma_registration import (
    ROMA_ASSETS,
    ROMA_LICENSE,
    ROMA_SOURCE_REVISION,
    RomaAssetError,
    load_roma_model,
    match_pair,
    provision_roma_assets,
    verify_roma_assets,
)

CORPUS_RELATIVE = Path("corpus/cross-view-registration-v0.1.0")
MANIFEST_NAME = "manifest.jsonl"
REPORT_NAME = "build-report.json"
OUTPUT_RELATIVE = Path("evaluation/aerialextrematch-roma-v1")
DENIED_TOKENS = ("fireviewer-die-pontaix", "die-pontaix-08", "die-pontaix-r1")
VRAM_LIMIT_BYTES = 14 * 1024**3
RAM_LIMIT_BYTES = 10 * 1024**3
EXPECTED_SOURCE_IDS = {
    "aerialextrematch_localization",
    "odm_sance_mountain",
    "odm_seneca_rural",
}
EXPECTED_AEM_DSM_SHA256 = "319aa4bac96171693763e6b45d1074812b0020bc96c13eed9a0b99d653e5e74a"


class RegistrationSetupError(RuntimeError):
    """Raised when the registration benchmark cannot safely run."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RegistrationSetupError(f"invalid JSON report: {path}") from exc
    if not isinstance(value, dict):
        raise RegistrationSetupError(f"JSON report is not an object: {path}")
    return value


def _iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    try:
        source = path.open(encoding="utf-8")
    except OSError as exc:
        raise RegistrationSetupError(f"missing registration manifest: {path}") from exc
    with source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise RegistrationSetupError(
                    f"invalid registration row at {path}:{line_number}"
                ) from exc
            if not isinstance(value, dict):
                raise RegistrationSetupError(
                    f"registration row is not an object at {path}:{line_number}"
                )
            yield value


def _resolve_media(dataset_root: Path, relpath: str, expected_sha256: str) -> Path:
    root = dataset_root.resolve()
    candidate = (root / Path(relpath)).resolve()
    if candidate != root and root not in candidate.parents:
        raise RegistrationSetupError(f"media path escapes dataset root: {relpath}")
    if any(token in str(candidate).lower() for token in DENIED_TOKENS):
        raise RegistrationSetupError(f"operational incident media denied: {candidate}")
    if not candidate.is_file():
        raise RegistrationSetupError(f"missing registration media: {candidate}")
    if _sha256_file(candidate) != expected_sha256:
        raise RegistrationSetupError(f"registration media SHA-256 mismatch: {candidate}")
    return candidate


def preflight(
    dataset_root: Path,
    *,
    roma_root: Path | None = None,
    require_assets: bool = False,
) -> dict[str, Any]:
    dataset_root = dataset_root.resolve()
    corpus_root = dataset_root / CORPUS_RELATIVE
    report = _read_json(corpus_root / REPORT_NAME)
    manifest_path = corpus_root / MANIFEST_NAME
    expected_manifest_sha256 = str(report.get("manifest_sha256", ""))
    if len(expected_manifest_sha256) != 64:
        raise RegistrationSetupError("registration report has no pinned manifest SHA-256")
    if _sha256_file(manifest_path) != expected_manifest_sha256:
        raise RegistrationSetupError("registration manifest SHA-256 differs from build report")
    gates = report.get("gates", {})
    if not isinstance(gates, dict) or gates.get("training_ready") is not True:
        raise RegistrationSetupError("cross-view bootstrap training gate is false")
    if gates.get("deployment_ready") is True:
        raise RegistrationSetupError("unexpected deployment-ready claim before critical validation")
    rows = list(_iter_jsonl(manifest_path))
    if len(rows) != report.get("rows"):
        raise RegistrationSetupError("registration row count differs from build report")
    source_ids = {str(row.get("source_id")) for row in rows}
    if not EXPECTED_SOURCE_IDS.issubset(source_ids):
        raise RegistrationSetupError("rural and mountain cross-view domains are incomplete")
    split_groups: dict[str, set[str]] = {}
    for row in rows:
        if row.get("operational_incident") is not False:
            raise RegistrationSetupError(
                f"operational registration row denied: {row.get('sample_id')}"
            )
        combined = json.dumps(row, ensure_ascii=False).lower()
        if any(token in combined for token in DENIED_TOKENS):
            raise RegistrationSetupError(
                f"operational incident token denied: {row.get('sample_id')}"
            )
        split_groups.setdefault(str(row["split_group"]), set()).add(str(row["split"]))
    if any(len(splits) != 1 for splits in split_groups.values()):
        raise RegistrationSetupError("registration split-group leak")
    assets_verified = False
    if require_assets:
        if roma_root is None:
            raise RegistrationSetupError("--roma-root is required with --require-assets")
        try:
            verify_roma_assets(roma_root)
        except RomaAssetError as exc:
            raise RegistrationSetupError(str(exc)) from exc
        assets_verified = True
    return {
        "assets_verified": assets_verified,
        "corpus_manifest_sha256": expected_manifest_sha256,
        "critical_lot_included": False,
        "deployment_ready": False,
        "model": "AerialExtreMatch-RoMa",
        "model_license": ROMA_LICENSE,
        "rows": len(rows),
        "source_ids": sorted(source_ids),
        "source_revision": ROMA_SOURCE_REVISION,
        "split_counts": report.get("split_counts", {}),
        "split_group_leaks": 0,
        "training_command_available": False,
    }


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(partial, path)


def provision(dataset_root: Path, roma_root: Path) -> dict[str, Any]:
    preflight(dataset_root)
    try:
        manifest = provision_roma_assets(roma_root)
    except RomaAssetError as exc:
        raise RegistrationSetupError(str(exc)) from exc
    report = {
        **manifest,
        "asset_root": str(roma_root.resolve()),
        "dataset_in_model_volume": False,
    }
    _write_json(dataset_root.resolve() / OUTPUT_RELATIVE / "provision-report.json", report)
    return report


def _select_probe_row(dataset_root: Path) -> dict[str, Any]:
    manifest = dataset_root.resolve() / CORPUS_RELATIVE / MANIFEST_NAME
    candidates = [
        row
        for row in _iter_jsonl(manifest)
        if row.get("split") == "validation"
        and row.get("source_id") == "aerialextrematch_localization"
        and row.get("validation_status") == "source_pose_provided"
    ]
    if not candidates:
        raise RegistrationSetupError("no held-out pose-provided AerialExtreMatch row")
    return min(candidates, key=lambda row: str(row["sample_id"]))


def _quaternion_rotation(quaternion: tuple[float, float, float, float]) -> list[list[float]]:
    w, x, y, z = quaternion
    return [
        [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z, 2 * z * x + 2 * w * y],
        [2 * x * y + 2 * w * z, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x],
        [2 * z * x - 2 * w * y, 2 * y * z + 2 * w * x, 1 - 2 * x * x - 2 * y * y],
    ]


def _prior_yaw_degrees(dataset_root: Path, row: dict[str, Any]) -> float:
    source_path = Path(str(row["source_view"]["image_relpath"]))
    pose_path = dataset_root / source_path.parents[1] / "pose.txt"
    image_name = source_path.name
    for line in pose_path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if parts and parts[0] == image_name:
            quaternion = tuple(float(value) for value in parts[1:5])
            rotation_world_to_camera = _quaternion_rotation(quaternion)  # type: ignore[arg-type]
            rotation_camera_to_world = [
                [rotation_world_to_camera[column][row_index] for column in range(3)]
                for row_index in range(3)
            ]
            return math.degrees(
                math.atan2(rotation_camera_to_world[1][0], rotation_camera_to_world[0][0])
            )
    raise RegistrationSetupError(f"missing prior pose for {image_name}")


def _rotate_query(source_path: Path, angle_degrees: float) -> tuple[Any, Any]:
    try:
        import cv2
        import numpy as np
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - explicit setup failure
        raise RegistrationSetupError(
            "install OpenCV, numpy and Pillow for yaw normalization"
        ) from exc
    with Image.open(source_path) as image:
        rgb = np.asarray(image.convert("RGB"))
    height, width = rgb.shape[:2]
    center = (width // 2, height // 2)
    radians = math.radians(angle_degrees)
    new_width = int(height * abs(math.sin(radians)) + width * abs(math.cos(radians)))
    new_height = int(width * abs(math.sin(radians)) + height * abs(math.cos(radians)))
    transform = cv2.getRotationMatrix2D(center, angle_degrees, scale=1.0)
    transform[0, 2] += (new_width - width) // 2
    transform[1, 2] += (new_height - height) // 2
    rotated = cv2.warpAffine(
        rgb,
        transform,
        (new_width, new_height),
        borderValue=(255, 255, 255),
    )
    homogeneous = np.vstack((transform, np.asarray([0.0, 0.0, 1.0])))
    return Image.fromarray(rotated), homogeneous


def _unrotate_points(points: Any, transform: Any) -> Any:
    import numpy as np

    homogeneous = np.column_stack((points, np.ones(len(points))))
    original = np.linalg.inv(transform) @ homogeneous.T
    return (original[:2] / original[2:]).T


def _terrain_correspondences(
    dataset_root: Path,
    row: dict[str, Any],
    source_pixels: Any,
    map_pixels: Any,
    certainties: Any,
) -> tuple[Any, Any]:
    try:
        import numpy as np
        import rasterio
    except ImportError as exc:  # pragma: no cover - explicit setup failure
        raise RegistrationSetupError("install rasterio and numpy for terrain PnP") from exc
    map_view = row["map_view"]
    confident = certainties >= 0.05
    if int(confident.sum()) < 64:
        keep = min(1_000, len(certainties))
        indexes = np.argsort(certainties)[-keep:]
        source_pixels = source_pixels[indexes]
        map_pixels = map_pixels[indexes]
    else:
        source_pixels = source_pixels[confident]
        map_pixels = map_pixels[confident]
    dom_path = (dataset_root / str(map_view["reference_dom_relpath"])).resolve()
    dsm_path = dom_path.with_name("DSM.tif")
    if _sha256_file(dom_path) != str(map_view["reference_dom_sha256"]):
        raise RegistrationSetupError("reference DOM SHA-256 mismatch")
    if _sha256_file(dsm_path) != EXPECTED_AEM_DSM_SHA256:
        raise RegistrationSetupError("reference DSM SHA-256 mismatch")
    camera_x, camera_y, _camera_z = row["ground_truth"]["camera_center_xyz"]
    window_pixels = float(map_view["source_window_pixels"])
    scale_x = window_pixels / float(map_view["width"])
    scale_y = window_pixels / float(map_view["height"])
    with rasterio.open(dom_path) as dom, rasterio.open(dsm_path) as dsm:
        if dom.crs != dsm.crs or dom.transform != dsm.transform:
            raise RegistrationSetupError("DOM and DSM grids differ")
        center_row, center_col = dom.index(float(camera_x), float(camera_y))
        reference_cols = center_col - window_pixels / 2 + map_pixels[:, 0] * scale_x
        reference_rows = center_row - window_pixels / 2 + map_pixels[:, 1] * scale_y
        inside = (
            (reference_cols >= 0)
            & (reference_cols < dom.width - 1)
            & (reference_rows >= 0)
            & (reference_rows < dom.height - 1)
        )
        reference_cols = reference_cols[inside]
        reference_rows = reference_rows[inside]
        query_pixels = source_pixels[inside]
        xs, ys = rasterio.transform.xy(
            dom.transform,
            reference_rows,
            reference_cols,
            offset="center",
        )
        coordinates = list(zip(xs, ys, strict=True))
        elevations = np.asarray([value[0] for value in dsm.sample(coordinates)])
        valid = np.isfinite(elevations)
        if dsm.nodata is not None:
            valid &= elevations != dsm.nodata
        world_points = np.column_stack((np.asarray(xs), np.asarray(ys), elevations))[valid]
        return query_pixels[valid].astype(np.float64), world_points.astype(np.float64)


def _estimate_camera_center(
    source_pixels: Any,
    world_points: Any,
    intrinsics: dict[str, Any],
) -> tuple[Any, int, float]:
    try:
        import cv2
        import numpy as np
    except ImportError as exc:  # pragma: no cover - explicit setup failure
        raise RegistrationSetupError("install OpenCV and numpy for terrain PnP") from exc
    if len(source_pixels) < 8:
        raise RegistrationSetupError("not enough terrain correspondences for PnP")
    camera_matrix = np.asarray(
        [
            [intrinsics["fx"], 0.0, intrinsics["cx"]],
            [0.0, intrinsics["fy"], intrinsics["cy"]],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    origin = np.median(world_points, axis=0)
    local_world = world_points - origin
    success, rotation_vector, translation_vector, inliers = cv2.solvePnPRansac(
        local_world,
        source_pixels,
        camera_matrix,
        None,
        iterationsCount=10_000,
        reprojectionError=8.0,
        confidence=0.999,
        flags=cv2.SOLVEPNP_EPNP,
    )
    if not success or inliers is None or len(inliers) < 8:
        raise RegistrationSetupError("terrain PnP did not find a stable pose")
    inlier_indexes = inliers.ravel()
    rotation_vector, translation_vector = cv2.solvePnPRefineLM(
        local_world[inlier_indexes],
        source_pixels[inlier_indexes],
        camera_matrix,
        None,
        rotation_vector,
        translation_vector,
    )
    rotation, _ = cv2.Rodrigues(rotation_vector)
    camera_center = (-rotation.T @ translation_vector).ravel() + origin
    return camera_center, len(inlier_indexes), len(inlier_indexes) / len(source_pixels)


def probe(dataset_root: Path, roma_root: Path) -> dict[str, Any]:
    preflight(dataset_root, roma_root=roma_root, require_assets=True)
    row = _select_probe_row(dataset_root)
    source = row["source_view"]
    map_view = row["map_view"]
    source_path = _resolve_media(
        dataset_root,
        str(source["image_relpath"]),
        str(source["sha256"]),
    )
    map_path = _resolve_media(
        dataset_root,
        str(map_view["image_relpath"]),
        str(map_view["sha256"]),
    )
    try:
        import psutil
        import torch
    except ImportError as exc:  # pragma: no cover - explicit setup failure
        raise RegistrationSetupError("install RoMa probe dependencies") from exc
    if not torch.cuda.is_available():
        raise RegistrationSetupError("CUDA is required for the real RoMa probe")
    process = psutil.Process()
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    model = None
    try:
        model = load_roma_model(roma_root, device="cuda")
        prior_yaw_degrees = _prior_yaw_degrees(dataset_root, row)
        rotated_source, rotation_transform = _rotate_query(source_path, prior_yaw_degrees)
        matches = match_pair(model, rotated_source, map_path)
        query_source_pixels = _unrotate_points(matches.source_pixels, rotation_transform)
        torch.cuda.synchronize()
        peak_vram = int(torch.cuda.max_memory_allocated())
        process_rss = int(process.memory_info().rss)
    finally:
        del model
        gc.collect()
        torch.cuda.empty_cache()
    source_pixels, world_points = _terrain_correspondences(
        dataset_root,
        row,
        query_source_pixels,
        matches.map_pixels,
        matches.certainties,
    )
    predicted_camera, pnp_inliers, pnp_inlier_ratio = _estimate_camera_center(
        source_pixels,
        world_points,
        source["intrinsics"],
    )
    expected_camera = row["ground_truth"]["camera_center_xyz"]
    camera_position_error_m = math.dist(predicted_camera.tolist(), expected_camera)
    resource_gate = peak_vram <= VRAM_LIMIT_BYTES and process_rss <= RAM_LIMIT_BYTES
    inference_gate = len(matches.source_pixels) >= 8 and pnp_inliers >= 8
    quality_gate = camera_position_error_m <= 75.0
    report = {
        "expected_camera_center_xyz": expected_camera,
        "inference_gate": inference_gate,
        "model": "AerialExtreMatch-RoMa",
        "model_assets": [spec.sha256 for spec in ROMA_ASSETS],
        "observed": {
            "camera_position_error_m": camera_position_error_m,
            "match_count": len(matches.source_pixels),
            "median_certainty": float(__import__("numpy").median(matches.certainties)),
            "peak_vram_bytes": peak_vram,
            "pnp_inlier_count": pnp_inliers,
            "pnp_inlier_ratio": pnp_inlier_ratio,
            "predicted_camera_center_xyz": predicted_camera.tolist(),
            "prior_yaw_degrees": prior_yaw_degrees,
            "process_rss_bytes": process_rss,
        },
        "probe_succeeded": inference_gate and resource_gate,
        "quality_gate": quality_gate,
        "quality_claim": (
            "single_sample_smoke_pass_not_deployment_validation"
            if quality_gate
            else "single_sample_quality_failed_not_deployment_ready"
        ),
        "resource_gate": resource_gate,
        "sample_id": row["sample_id"],
        "training_started": False,
    }
    _write_json(dataset_root.resolve() / OUTPUT_RELATIVE / "probe-report.json", report)
    if not report["probe_succeeded"]:
        raise RegistrationSetupError("real RoMa probe failed an inference or resource gate")
    return report


def launch_plan(dataset_root: Path, roma_root: Path) -> dict[str, Any]:
    preflight(dataset_root, roma_root=roma_root, require_assets=True)
    report = {
        "decision": "benchmark_official_checkpoint_before_any_fine_tuning",
        "evaluation_sets": {
            "bootstrap_validation": 57,
            "held_out_test": 45,
            "production_critical": "blocked_until_double_validation",
        },
        "fine_tuning_allowed": False,
        "model": "AerialExtreMatch-RoMa",
        "qwen_registration_training": False,
        "resource_limits": {
            "host_ram_bytes": RAM_LIMIT_BYTES,
            "vram_bytes": VRAM_LIMIT_BYTES,
        },
        "training_started": False,
    }
    _write_json(dataset_root.resolve() / OUTPUT_RELATIVE / "launch-plan.json", report)
    return report


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("preflight", "provision", "probe", "launch-plan"):
        command = commands.add_parser(name)
        command.add_argument("--dataset-root", type=Path, required=True)
        if name != "preflight":
            command.add_argument("--roma-root", type=Path, required=True)
    preflight_parser = commands.choices["preflight"]
    preflight_parser.add_argument("--roma-root", type=Path)
    preflight_parser.add_argument("--require-assets", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    if args.command == "preflight":
        report = preflight(
            args.dataset_root,
            roma_root=args.roma_root,
            require_assets=args.require_assets,
        )
    elif args.command == "provision":
        report = provision(args.dataset_root, args.roma_root)
    elif args.command == "probe":
        report = probe(args.dataset_root, args.roma_root)
    elif args.command == "launch-plan":
        report = launch_plan(args.dataset_root, args.roma_root)
    else:  # pragma: no cover - argparse rejects unknown commands
        raise AssertionError(args.command)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
