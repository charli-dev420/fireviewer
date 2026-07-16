"""Produce compact, streamable LiDAR height tiles for the web runtime.

The native MNS samples are kept at LOD0.  The regular grid topology is not
duplicated in every asset: the browser creates it once and each tile only
contains centimetre-quantized heights plus a WebP colour texture.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
from pathlib import Path
from typing import Any

import brotli
import numpy as np
from PIL import Image

from produce import (
    PIPELINE_VERSION,
    SOURCE_SPACING_METRES,
    exact_grid,
    find_tile_bounds,
    orthophoto_grid,
    sha256_file,
    source_records,
    write_json,
)


GRID_SIZE = 251
QUANTIZATION_METRES = 0.01
WEBP_LOSSLESS = True
# Références d'observation, jamais des motifs de dégradation ou de rejet.
REFERENCE_CACHE_BYTES_PER_SQUARE_KILOMETRE = 50 * 1024**2
REFERENCE_VIEW_TRANSFER_BYTES = 16 * 1024**2
LOD_LAYOUT = (
    # lod, sector edge, exact native-grid step, sectors per 1 km edge
    (0, 125.0, 1, 8),
    (1, 250.0, 2, 4),
    (2, 500.0, 4, 2),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-project", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--tile-id", required=True)
    parser.add_argument("--orthophoto", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def colour_psnr(source: np.ndarray, decoded: np.ndarray) -> float:
    difference = source.astype(np.float32) - decoded.astype(np.float32)
    mse = float(np.mean(difference * difference))
    return math.inf if mse == 0.0 else 10.0 * math.log10(255.0**2 / mse)


def quantize(heights: np.ndarray, origin_metres: float) -> tuple[np.ndarray, float]:
    source = heights.astype(np.float64)
    values = np.rint((source - origin_metres) / QUANTIZATION_METRES)
    if float(values.min()) < 0.0 or float(values.max()) > np.iinfo(np.uint16).max:
        raise ValueError("The MNS height range does not fit in centimetre uint16 quantization")
    encoded = values.astype("<u2")
    recovered = encoded.astype(np.float64) * QUANTIZATION_METRES + origin_metres
    error = float(np.max(np.abs(recovered - source)))
    return encoded, error


def sector_id(tile_id: str, lod: int, row: int, column: int) -> str:
    return f"{tile_id}-L{lod}-R{row:02d}-C{column:02d}"


def produce(args: argparse.Namespace) -> dict[str, Any]:
    source_project = args.source_project.resolve()
    workspace = args.workspace.resolve()
    orthophoto = args.orthophoto.resolve()
    bounds = find_tile_bounds(source_project, args.tile_id)
    mns_paths, mns_records = source_records(source_project, "mns", bounds)
    mns = exact_grid(mns_paths, bounds)
    colours = orthophoto_grid(orthophoto, bounds)
    if colours.shape != (*mns.shape, 3):
        raise ValueError(f"Unexpected orthophoto grid {colours.shape}, expected {(*mns.shape, 3)}")

    height_origin = float(math.floor(float(np.min(mns))))
    output = workspace / "stream-cache" / args.tile_id
    temporary = output.with_name(f"{output.name}.tmp")
    if temporary.exists():
        shutil.rmtree(temporary)
    if output.exists():
        if not args.force:
            raise FileExistsError(f"Output already exists: {output}")
        shutil.rmtree(output)
    temporary.mkdir(parents=True)

    sectors: list[dict[str, Any]] = []
    maximum_height_error = 0.0
    minimum_colour_psnr = math.inf
    maximum_colour_channel_error = 0
    total_height_bytes = 0
    total_colour_bytes = 0
    decoded_height_bytes = 0
    try:
        for lod, edge_metres, native_step, edge_count in LOD_LAYOUT:
            native_span = int(round(edge_metres / SOURCE_SPACING_METRES))
            expected_grid = native_span // native_step + 1
            if expected_grid != GRID_SIZE:
                raise AssertionError(f"LOD{lod} does not produce the shared {GRID_SIZE} grid")
            for row in range(edge_count):
                for column in range(edge_count):
                    start_row = row * native_span
                    start_column = column * native_span
                    heights = mns[
                        start_row : start_row + native_span + 1 : native_step,
                        start_column : start_column + native_span + 1 : native_step,
                    ]
                    rgb = colours[
                        start_row : start_row + native_span + 1 : native_step,
                        start_column : start_column + native_span + 1 : native_step,
                    ]
                    if heights.shape != (GRID_SIZE, GRID_SIZE) or rgb.shape != (GRID_SIZE, GRID_SIZE, 3):
                        raise ValueError(f"Unexpected LOD{lod} sector shape: {heights.shape}, {rgb.shape}")

                    identifier = sector_id(args.tile_id, lod, row, column)
                    sector_root = temporary / f"lod{lod}" / identifier
                    sector_root.mkdir(parents=True)
                    quantized, height_error = quantize(heights, height_origin)
                    maximum_height_error = max(maximum_height_error, height_error)
                    raw_height = quantized.tobytes(order="C")
                    compressed_height = brotli.compress(raw_height, quality=9, mode=brotli.MODE_GENERIC)
                    height_path = sector_root / "height.u16.br"
                    height_path.write_bytes(compressed_height)

                    colour_path = sector_root / "colour.webp"
                    Image.fromarray(rgb, mode="RGB").save(
                        colour_path,
                        format="WEBP",
                        lossless=WEBP_LOSSLESS,
                        method=6,
                    )
                    with Image.open(colour_path) as image:
                        decoded_colour = np.asarray(image.convert("RGB"))
                    psnr = colour_psnr(rgb, decoded_colour)
                    minimum_colour_psnr = min(minimum_colour_psnr, psnr)
                    maximum_colour_channel_error = max(
                        maximum_colour_channel_error,
                        int(np.max(np.abs(rgb.astype(np.int16) - decoded_colour.astype(np.int16)))),
                    )

                    xmin = bounds[0] + column * edge_metres
                    ymin = bounds[1] + row * edge_metres
                    height_relative = height_path.relative_to(temporary).as_posix()
                    colour_relative = colour_path.relative_to(temporary).as_posix()
                    total_height_bytes += height_path.stat().st_size
                    total_colour_bytes += colour_path.stat().st_size
                    decoded_height_bytes += len(raw_height)
                    sectors.append({
                        "sector_id": identifier,
                        "lod_level": lod,
                        "bounds_l93_metres": [xmin, ymin, xmin + edge_metres, ymin + edge_metres],
                        "spacing_metres": SOURCE_SPACING_METRES * native_step,
                        "grid_size": GRID_SIZE,
                        "height_range_ngf_ign69_metres": [float(np.min(heights)), float(np.max(heights))],
                        "height": {
                            "path": height_relative,
                            "content_encoding": "br",
                            "component_type": "uint16-le",
                            "byte_count": height_path.stat().st_size,
                            "decoded_byte_count": len(raw_height),
                            "sha256": sha256_file(height_path),
                        },
                        "colour": {
                            "path": colour_relative,
                            "format": "image/webp",
                            "compression": "lossless",
                            "byte_count": colour_path.stat().st_size,
                            "sha256": sha256_file(colour_path),
                            "psnr_decibels": None if math.isinf(psnr) else psnr,
                            "lossless_match": bool(np.array_equal(rgb, decoded_colour)),
                        },
                        "maximum_altitude_error_metres": height_error,
                    })

        total_bytes = total_height_bytes + total_colour_bytes
        lod0_transfer_sizes = sorted(
            (
                sector["height"]["byte_count"] + sector["colour"]["byte_count"]
                for sector in sectors if sector["lod_level"] == 0
            ),
            reverse=True,
        )
        maximum_nine_sector_view_bytes = sum(lod0_transfer_sizes[:9])
        catalog = {
            "schema_version": "1.0",
            "pipeline_version": f"{PIPELINE_VERSION}+stream-grid.1",
            "tile_id": args.tile_id,
            "bounds_l93_metres": list(bounds),
            "contract": {
                "geometry_source": "IGN LiDAR HD MNS native samples and exact subsets",
                "synthetic_geometry_added": False,
                "grid_crs": "EPSG:2154",
                "vertical_datum": "NGF-IGN69",
                "runtime_axes": "Giro3D projected (E, N, U) metres",
                "shared_grid_size": GRID_SIZE,
                "height_origin_ngf_ign69_metres": height_origin,
                "height_quantization_metres": QUANTIZATION_METRES,
                "topology": "one shared indexed grid generated once by the browser",
                "lod0_fidelity": "every native 0.50 m MNS sample; no decimation or smoothing",
                "normals": "reconstructed from adjacent height samples in the GPU shader",
                "visibility": "quadtree sectors outside the camera selection are not transferred or decoded",
            },
            "source": {
                "mns_sha256": sorted(record["sha256"] for record in mns_records),
                "orthophoto_sha256": sha256_file(orthophoto),
            },
            "checks": {
                "sector_count": len(sectors),
                "lod0_sector_count": sum(sector["lod_level"] == 0 for sector in sectors),
                "lod1_sector_count": sum(sector["lod_level"] == 1 for sector in sectors),
                "lod2_sector_count": sum(sector["lod_level"] == 2 for sector in sectors),
                "compressed_height_byte_count": total_height_bytes,
                "webp_colour_byte_count": total_colour_bytes,
                "total_stream_byte_count": total_bytes,
                "decoded_height_byte_count": decoded_height_bytes,
                "maximum_nine_sector_view_byte_count": maximum_nine_sector_view_bytes,
                "reference_cache_byte_count": REFERENCE_CACHE_BYTES_PER_SQUARE_KILOMETRE,
                "reference_view_transfer_byte_count": REFERENCE_VIEW_TRANSFER_BYTES,
                "reference_cache_respected": total_bytes <= REFERENCE_CACHE_BYTES_PER_SQUARE_KILOMETRE,
                "reference_view_transfer_respected": maximum_nine_sector_view_bytes <= REFERENCE_VIEW_TRANSFER_BYTES,
                "maximum_altitude_error_metres": maximum_height_error,
                "minimum_colour_psnr_decibels": (
                    None if math.isinf(minimum_colour_psnr) else minimum_colour_psnr
                ),
                "maximum_colour_channel_error": maximum_colour_channel_error,
                "stored_position_byte_count": 0,
                "stored_normal_byte_count": 0,
                "stored_index_byte_count": 0,
                "synthetic_geometry_count": 0,
            },
            "sectors": sectors,
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
