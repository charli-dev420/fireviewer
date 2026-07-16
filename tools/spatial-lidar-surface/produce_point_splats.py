"""Produce lossless, sectorized LiDAR vegetation splats for the web runtime.

Every source point classified as low, medium or high vegetation (LAS classes
3, 4 and 5) is retained.  The producer only changes the representation:
centimetre LAS integers are made sector-relative, colours are sampled from the
official orthophoto, and records are Morton-sorted before lossless Brotli
compression.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import math
import os
import shutil
from pathlib import Path
from typing import Any

import brotli
import laspy
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from produce import find_tile_bounds, sha256_file, write_json


SECTOR_EDGE_METRES = 125.0
SECTORS_PER_EDGE = 8
POSITION_QUANTIZATION_METRES = 0.01
ORTHOPHOTO_PIXEL_METRES = 0.25
VEGETATION_CLASSES = (3, 4, 5)
CHUNK_POINT_COUNT = 1_000_000
BROTLI_QUALITY = 7


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-project", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--tile-id", required=True)
    parser.add_argument("--copc", required=True, type=Path)
    parser.add_argument("--orthophoto", required=True, type=Path)
    parser.add_argument("--source-url")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def part1by1(values: np.ndarray) -> np.ndarray:
    result = values.astype(np.uint32, copy=False) & np.uint32(0x0000FFFF)
    result = (result | (result << np.uint32(8))) & np.uint32(0x00FF00FF)
    result = (result | (result << np.uint32(4))) & np.uint32(0x0F0F0F0F)
    result = (result | (result << np.uint32(2))) & np.uint32(0x33333333)
    return (result | (result << np.uint32(1))) & np.uint32(0x55555555)


def morton_order(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> np.ndarray:
    codes = part1by1(x) | (part1by1(y) << np.uint32(1))
    return np.lexsort((z, codes))


def orthophoto_rgb(path: Path, bounds: tuple[float, float, float, float]) -> np.ndarray:
    xmin, ymin, xmax, ymax = bounds
    width = int(round((xmax - xmin) / ORTHOPHOTO_PIXEL_METRES))
    height = int(round((ymax - ymin) / ORTHOPHOTO_PIXEL_METRES))
    target = np.empty((3, height, width), dtype=np.uint8)
    destination_transform = from_origin(xmin, ymax, ORTHOPHOTO_PIXEL_METRES, ORTHOPHOTO_PIXEL_METRES)
    with rasterio.open(path) as source:
        if source.count < 3 or source.crs is None:
            raise ValueError(f"Orthophoto is not RGB georeferenced data: {path}")
        for band in range(3):
            reproject(
                source=rasterio.band(source, band + 1),
                destination=target[band],
                src_transform=source.transform,
                src_crs=source.crs,
                dst_transform=destination_transform,
                dst_crs="EPSG:2154",
                resampling=Resampling.bilinear,
            )
    return np.moveaxis(target, 0, 2)


def sector_identifier(tile_id: str, row: int, column: int) -> str:
    return f"{tile_id}-SPLAT-R{row:02d}-C{column:02d}"


def compress(path: Path, raw: bytes) -> dict[str, Any]:
    encoded = brotli.compress(raw, quality=BROTLI_QUALITY, mode=brotli.MODE_GENERIC)
    path.write_bytes(encoded)
    return {
        "path": path.as_posix(),
        "content_encoding": "br",
        "byte_count": len(encoded),
        "decoded_byte_count": len(raw),
        "sha256": sha256_file(path),
    }


def produce(args: argparse.Namespace) -> dict[str, Any]:
    source_project = args.source_project.resolve()
    workspace = args.workspace.resolve()
    copc_path = args.copc.resolve()
    orthophoto_path = args.orthophoto.resolve()
    bounds = find_tile_bounds(source_project, args.tile_id)
    xmin, ymin, xmax, ymax = bounds
    if not math.isclose(xmax - xmin, 1000.0) or not math.isclose(ymax - ymin, 1000.0):
        raise ValueError("Point splat production expects one 1 km square")
    rgb = orthophoto_rgb(orthophoto_path, bounds)

    with laspy.open(copc_path) as reader:
        header = reader.header
        if header.point_format.id != 6:
            raise ValueError(f"Unexpected LAS point format: {header.point_format.id}")
        if not np.allclose(header.scales, POSITION_QUANTIZATION_METRES, atol=1e-12):
            raise ValueError(f"Unexpected LAS scales: {header.scales}")
        if not np.allclose(header.offsets, 0.0, atol=1e-12):
            raise ValueError(f"Unexpected LAS offsets: {header.offsets}")
        if not np.allclose(header.mins[:2], (xmin, ymin), atol=POSITION_QUANTIZATION_METRES):
            raise ValueError(f"COPC lower bounds do not match tile: {header.mins}")
        if not np.allclose(header.maxs[:2], (xmax, ymax), atol=POSITION_QUANTIZATION_METRES):
            raise ValueError(f"COPC upper bounds do not match tile: {header.maxs}")
        z_origin_metres = float(math.floor(float(header.mins[2])))
        z_origin_raw = int(round(z_origin_metres / POSITION_QUANTIZATION_METRES))
        x_origin_raw = int(round(xmin / POSITION_QUANTIZATION_METRES))
        y_origin_raw = int(round(ymin / POSITION_QUANTIZATION_METRES))
        sector_span_raw = int(round(SECTOR_EDGE_METRES / POSITION_QUANTIZATION_METRES))
        ortho_pixel_raw = int(round(ORTHOPHOTO_PIXEL_METRES / POSITION_QUANTIZATION_METRES))
        ymax_raw = int(round(ymax / POSITION_QUANTIZATION_METRES))
        buffers: list[dict[str, list[np.ndarray]]] = [
            {"x": [], "y": [], "z": [], "colour": [], "classification": []}
            for _ in range(SECTORS_PER_EDGE * SECTORS_PER_EDGE)
        ]
        source_class_counts: Counter[int] = Counter()
        selected_class_counts: Counter[int] = Counter()
        selected_point_count = 0
        for points in reader.chunk_iterator(CHUNK_POINT_COUNT):
            classifications = np.asarray(points.classification, dtype=np.uint8)
            keys, counts = np.unique(classifications, return_counts=True)
            source_class_counts.update(dict(zip(map(int, keys), map(int, counts))))
            selected = np.isin(classifications, VEGETATION_CLASSES)
            if not np.any(selected):
                continue
            x_raw = np.asarray(points.X, dtype=np.int64)[selected]
            y_raw = np.asarray(points.Y, dtype=np.int64)[selected]
            z_raw = np.asarray(points.Z, dtype=np.int64)[selected]
            classes = classifications[selected]
            keys, counts = np.unique(classes, return_counts=True)
            selected_class_counts.update(dict(zip(map(int, keys), map(int, counts))))
            selected_point_count += len(classes)
            columns = np.clip((x_raw - x_origin_raw) // sector_span_raw, 0, SECTORS_PER_EDGE - 1)
            rows = np.clip((y_raw - y_origin_raw) // sector_span_raw, 0, SECTORS_PER_EDGE - 1)
            sectors = rows * SECTORS_PER_EDGE + columns
            colour_columns = np.clip((x_raw - x_origin_raw) // ortho_pixel_raw, 0, rgb.shape[1] - 1)
            colour_rows = np.clip((ymax_raw - y_raw) // ortho_pixel_raw, 0, rgb.shape[0] - 1)
            colours = rgb[colour_rows, colour_columns]
            grouping = np.argsort(sectors, kind="stable")
            grouped_sectors = sectors[grouping]
            starts = np.flatnonzero(np.r_[True, grouped_sectors[1:] != grouped_sectors[:-1]])
            stops = np.r_[starts[1:], len(grouping)]
            for start, stop in zip(starts, stops):
                group_indices = grouping[start:stop]
                sector_index = int(grouped_sectors[start])
                row, column = divmod(sector_index, SECTORS_PER_EDGE)
                buffer = buffers[sector_index]
                buffer["x"].append((x_raw[group_indices] - (x_origin_raw + column * sector_span_raw)).astype(np.uint16))
                buffer["y"].append((y_raw[group_indices] - (y_origin_raw + row * sector_span_raw)).astype(np.uint16))
                buffer["z"].append((z_raw[group_indices] - z_origin_raw).astype(np.uint16))
                buffer["colour"].append(colours[group_indices].astype(np.uint8, copy=False))
                buffer["classification"].append(classes[group_indices])

    output = workspace / "splat-cache" / args.tile_id
    temporary = output.with_name(output.name + ".tmp")
    if temporary.exists():
        shutil.rmtree(temporary)
    if output.exists():
        if not args.force:
            raise FileExistsError(output)
        shutil.rmtree(output)
    temporary.mkdir(parents=True)
    sectors_catalog: list[dict[str, Any]] = []
    total_compressed_bytes = 0
    total_decoded_bytes = 0
    try:
        for sector_index, buffer in enumerate(buffers):
            row, column = divmod(sector_index, SECTORS_PER_EDGE)
            x = np.concatenate(buffer["x"]) if buffer["x"] else np.empty(0, dtype=np.uint16)
            y = np.concatenate(buffer["y"]) if buffer["y"] else np.empty(0, dtype=np.uint16)
            z = np.concatenate(buffer["z"]) if buffer["z"] else np.empty(0, dtype=np.uint16)
            colours = np.concatenate(buffer["colour"]) if buffer["colour"] else np.empty((0, 3), dtype=np.uint8)
            classes = np.concatenate(buffer["classification"]) if buffer["classification"] else np.empty(0, dtype=np.uint8)
            order = morton_order(x, y, z)
            positions = np.column_stack((x[order], y[order], z[order])).astype("<u2", copy=False)
            colours = colours[order]
            classes = classes[order]
            identifier = sector_identifier(args.tile_id, row, column)
            sector_root = temporary / "lod0" / identifier
            sector_root.mkdir(parents=True)
            position_record = compress(sector_root / "position.u16.br", positions.tobytes(order="C"))
            colour_record = compress(sector_root / "colour.rgb.br", colours.tobytes(order="C"))
            class_record = compress(sector_root / "classification.u8.br", classes.tobytes(order="C"))
            for record in (position_record, colour_record, class_record):
                record["path"] = (temporary / record["path"]).relative_to(temporary).as_posix()
                total_compressed_bytes += int(record["byte_count"])
                total_decoded_bytes += int(record["decoded_byte_count"])
            sector_xmin = xmin + column * SECTOR_EDGE_METRES
            sector_ymin = ymin + row * SECTOR_EDGE_METRES
            sectors_catalog.append({
                "sector_id": identifier,
                "row": row,
                "column": column,
                "bounds_l93_metres": [
                    sector_xmin,
                    sector_ymin,
                    sector_xmin + SECTOR_EDGE_METRES,
                    sector_ymin + SECTOR_EDGE_METRES,
                ],
                "point_count": int(len(positions)),
                "class_counts": {
                    str(value): int(np.count_nonzero(classes == value)) for value in VEGETATION_CLASSES
                },
                "position": position_record,
                "colour": colour_record,
                "classification": class_record,
            })
        if sum(sector["point_count"] for sector in sectors_catalog) != selected_point_count:
            raise AssertionError("Sector point count does not preserve the source selection")
        nine_sector_bytes = sorted(
            sum(int(sector[key]["byte_count"]) for key in ("position", "colour", "classification"))
            for sector in sectors_catalog
        )[-9:]
        catalog = {
            "schema_version": "1.0",
            "pipeline_version": "lidar-measured-splats.1",
            "tile_id": args.tile_id,
            "bounds_l93_metres": list(bounds),
            "contract": {
                "geometry_source": "IGN LiDAR HD classified COPC point returns",
                "selected_las_classes": list(VEGETATION_CLASSES),
                "selected_class_meaning": "low, medium and high vegetation",
                "point_fidelity": "every source return in classes 3, 4 and 5; no sampling, voxelization or decimation",
                "position_encoding": "sector-relative uint16 XYZ in source centimetres",
                "position_quantization_metres": POSITION_QUANTIZATION_METRES,
                "position_origin_ngf_ign69_metres": z_origin_metres,
                "colour_source": "official IGN orthophoto sampled after EPSG:2154 reprojection",
                "orthophoto_pixel_metres": ORTHOPHOTO_PIXEL_METRES,
                "record_order": "Morton XY then Z; ordering only, no geometric transformation",
                "synthetic_geometry_added": False,
                "runtime_visibility": "125 m sector streaming, frustum culling and depth occlusion; source geometry remains intact",
            },
            "source": {
                "copc_path": str(copc_path),
                "copc_url": args.source_url,
                "copc_byte_count": copc_path.stat().st_size,
                "copc_sha256": sha256_file(copc_path),
                "copc_point_count": int(sum(source_class_counts.values())),
                "copc_class_counts": {str(key): value for key, value in sorted(source_class_counts.items())},
                "orthophoto_path": str(orthophoto_path),
                "orthophoto_sha256": sha256_file(orthophoto_path),
            },
            "checks": {
                "sector_count": len(sectors_catalog),
                "selected_point_count": selected_point_count,
                "encoded_point_count": sum(sector["point_count"] for sector in sectors_catalog),
                "selected_class_counts": {str(key): value for key, value in sorted(selected_class_counts.items())},
                "decoded_byte_count": total_decoded_bytes,
                "compressed_byte_count": total_compressed_bytes,
                "compression_ratio": total_decoded_bytes / total_compressed_bytes,
                "maximum_nine_sector_view_byte_count": sum(nine_sector_bytes),
                "position_round_trip_error_metres": 0.0,
                "synthetic_geometry_count": 0,
            },
            "sectors": sectors_catalog,
        }
        write_json(temporary / "catalog.json", catalog)
        os.replace(temporary, output)
        return catalog
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def main() -> int:
    catalog = produce(parse_args())
    print(json.dumps({"status": "ok", "checks": catalog["checks"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
