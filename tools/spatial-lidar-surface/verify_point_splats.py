"""Independently verify lossless LiDAR splat sectors against their COPC source."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from typing import Any

import brotli
import laspy
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject


MASK64 = np.uint64(0xFFFFFFFFFFFFFFFF)
VEGETATION_CLASSES = (3, 4, 5)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def mix64(value: np.ndarray) -> np.ndarray:
    result = value.astype(np.uint64, copy=False)
    result = (result ^ (result >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
    result &= MASK64
    result = (result ^ (result >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
    result &= MASK64
    return result ^ (result >> np.uint64(31))


def fingerprint(x: np.ndarray, y: np.ndarray, z: np.ndarray, classification: np.ndarray) -> tuple[int, int, int]:
    value = (
        x.astype(np.uint64) * np.uint64(0x9E3779B185EBCA87)
        ^ y.astype(np.uint64) * np.uint64(0xC2B2AE3D27D4EB4F)
        ^ z.astype(np.uint64) * np.uint64(0x165667B19E3779F9)
        ^ classification.astype(np.uint64) * np.uint64(0x85EBCA77C2B2AE63)
    )
    first = mix64(value)
    second = mix64(value ^ np.uint64(0xD6E8FEB86659FD93))
    return int(first.sum(dtype=np.uint64)), int(np.bitwise_xor.reduce(first, initial=np.uint64(0))), int(second.sum(dtype=np.uint64))


def combine(left: tuple[int, int, int], right: tuple[int, int, int]) -> tuple[int, int, int]:
    modulus = 1 << 64
    return ((left[0] + right[0]) % modulus, left[1] ^ right[1], (left[2] + right[2]) % modulus)


def orthophoto_rgb(path: Path, bounds: list[float], pixel_metres: float) -> np.ndarray:
    xmin, ymin, xmax, ymax = bounds
    width = int(round((xmax - xmin) / pixel_metres))
    height = int(round((ymax - ymin) / pixel_metres))
    target = np.empty((3, height, width), dtype=np.uint8)
    transform = from_origin(xmin, ymax, pixel_metres, pixel_metres)
    with rasterio.open(path) as source:
        for band in range(3):
            reproject(
                source=rasterio.band(source, band + 1),
                destination=target[band],
                src_transform=source.transform,
                src_crs=source.crs,
                dst_transform=transform,
                dst_crs="EPSG:2154",
                resampling=Resampling.bilinear,
            )
    return np.moveaxis(target, 0, 2)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path)
    args = parser.parse_args()
    catalog_path = args.catalog.resolve()
    root = catalog_path.parent
    catalog: dict[str, Any] = json.loads(catalog_path.read_text(encoding="utf-8"))
    contract = catalog["contract"]
    if contract["synthetic_geometry_added"] is not False:
        raise ValueError("Synthetic geometry is forbidden")
    if tuple(contract["selected_las_classes"]) != VEGETATION_CLASSES:
        raise ValueError("Unexpected vegetation class selection")
    scale = float(contract["position_quantization_metres"])
    z_origin = int(round(float(contract["position_origin_ngf_ign69_metres"]) / scale))
    bounds = [float(value) for value in catalog["bounds_l93_metres"]]
    x_origin = int(round(bounds[0] / scale))
    y_origin = int(round(bounds[1] / scale))
    ymax_raw = int(round(bounds[3] / scale))
    pixel_metres = float(contract["orthophoto_pixel_metres"])
    pixel_raw = int(round(pixel_metres / scale))
    orthophoto_path = Path(catalog["source"]["orthophoto_path"])
    if sha256(orthophoto_path) != catalog["source"]["orthophoto_sha256"]:
        raise ValueError("Orthophoto hash mismatch")
    rgb = orthophoto_rgb(orthophoto_path, bounds, pixel_metres)

    artifact_count = 0
    artifact_classes: Counter[int] = Counter()
    artifact_fingerprint = (0, 0, 0)
    total_compressed = 0
    maximum_colour_error = 0
    for sector in catalog["sectors"]:
        records = {}
        for key in ("position", "colour", "classification"):
            descriptor = sector[key]
            path = (root / descriptor["path"]).resolve()
            if root not in path.parents or sha256(path) != descriptor["sha256"]:
                raise ValueError(f"Invalid {key} asset: {path}")
            encoded = path.read_bytes()
            raw = brotli.decompress(encoded)
            if len(raw) != descriptor["decoded_byte_count"]:
                raise ValueError(f"Decoded length mismatch: {path}")
            records[key] = raw
            total_compressed += len(encoded)
        count = int(sector["point_count"])
        positions = np.frombuffer(records["position"], dtype="<u2").reshape(count, 3)
        colours = np.frombuffer(records["colour"], dtype=np.uint8).reshape(count, 3)
        classes = np.frombuffer(records["classification"], dtype=np.uint8)
        if not np.all(np.isin(classes, VEGETATION_CLASSES)):
            raise ValueError(f"Non-vegetation class in {sector['sector_id']}")
        sector_bounds = sector["bounds_l93_metres"]
        sector_x = int(round(float(sector_bounds[0]) / scale))
        sector_y = int(round(float(sector_bounds[1]) / scale))
        x = positions[:, 0].astype(np.int64) + sector_x
        y = positions[:, 1].astype(np.int64) + sector_y
        z = positions[:, 2].astype(np.int64) + z_origin
        columns = np.clip((x - x_origin) // pixel_raw, 0, rgb.shape[1] - 1)
        rows = np.clip((ymax_raw - y) // pixel_raw, 0, rgb.shape[0] - 1)
        expected_colours = rgb[rows, columns]
        if len(colours):
            maximum_colour_error = max(
                maximum_colour_error,
                int(np.max(np.abs(colours.astype(np.int16) - expected_colours.astype(np.int16)))),
            )
        artifact_count += count
        keys, counts = np.unique(classes, return_counts=True)
        artifact_classes.update(dict(zip(map(int, keys), map(int, counts))))
        artifact_fingerprint = combine(artifact_fingerprint, fingerprint(x, y, z, classes))

    copc_path = Path(catalog["source"]["copc_path"])
    if sha256(copc_path) != catalog["source"]["copc_sha256"]:
        raise ValueError("COPC hash mismatch")
    source_count = 0
    source_classes: Counter[int] = Counter()
    source_fingerprint = (0, 0, 0)
    with laspy.open(copc_path) as reader:
        for points in reader.chunk_iterator(1_000_000):
            classes = np.asarray(points.classification, dtype=np.uint8)
            selected = np.isin(classes, VEGETATION_CLASSES)
            if not np.any(selected):
                continue
            selected_classes = classes[selected]
            x = np.asarray(points.X, dtype=np.int64)[selected]
            y = np.asarray(points.Y, dtype=np.int64)[selected]
            z = np.asarray(points.Z, dtype=np.int64)[selected]
            source_count += len(x)
            keys, counts = np.unique(selected_classes, return_counts=True)
            source_classes.update(dict(zip(map(int, keys), map(int, counts))))
            source_fingerprint = combine(source_fingerprint, fingerprint(x, y, z, selected_classes))

    if artifact_count != source_count or artifact_fingerprint != source_fingerprint:
        raise ValueError("Artifact point multiset does not match the source COPC selection")
    if artifact_classes != source_classes:
        raise ValueError("Artifact class counts do not match the source")
    if maximum_colour_error != 0:
        raise ValueError(f"Orthophoto colour round trip is not exact: {maximum_colour_error}")
    if total_compressed != catalog["checks"]["compressed_byte_count"]:
        raise ValueError("Compressed byte count mismatch")
    result = {
        "status": "ok",
        "sector_count": len(catalog["sectors"]),
        "point_count": artifact_count,
        "class_counts": dict(sorted(artifact_classes.items())),
        "source_artifact_fingerprint_match": True,
        "position_round_trip_error_metres": 0.0,
        "maximum_colour_channel_error": maximum_colour_error,
        "compressed_byte_count": total_compressed,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
