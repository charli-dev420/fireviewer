"""Independently verify compact LiDAR height tiles against the native MNS."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import brotli
import numpy as np

from produce import SOURCE_SPACING_METRES, exact_grid, find_tile_bounds, source_records


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("--source-project", required=True, type=Path)
    args = parser.parse_args()
    catalog_path = args.catalog.resolve()
    root = catalog_path.parent
    catalog: dict[str, Any] = json.loads(catalog_path.read_text(encoding="utf-8"))
    contract = catalog["contract"]
    if contract["synthetic_geometry_added"] is not False:
        raise ValueError("Synthetic geometry is forbidden")
    if contract["shared_grid_size"] != 251:
        raise ValueError("Unexpected shared grid size")
    origin = float(contract["height_origin_ngf_ign69_metres"])
    scale = float(contract["height_quantization_metres"])
    tile_id = catalog["tile_id"]
    bounds = find_tile_bounds(args.source_project.resolve(), tile_id)
    paths, _ = source_records(args.source_project.resolve(), "mns", bounds)
    mns = exact_grid(paths, bounds)

    decoded: dict[tuple[int, int, int], np.ndarray] = {}
    maximum_error = 0.0
    maximum_seam = 0.0
    total_bytes = 0
    for sector in catalog["sectors"]:
        height_path = (root / sector["height"]["path"]).resolve()
        colour_path = (root / sector["colour"]["path"]).resolve()
        if height_path.parent.parent.parent != root:
            raise ValueError(f"Unsafe sector path: {height_path}")
        if not colour_path.is_file() or sha256(colour_path) != sector["colour"]["sha256"]:
            raise ValueError(f"Invalid colour asset: {colour_path}")
        if sha256(height_path) != sector["height"]["sha256"]:
            raise ValueError(f"Invalid height asset: {height_path}")
        raw = brotli.decompress(height_path.read_bytes())
        if len(raw) != sector["height"]["decoded_byte_count"]:
            raise ValueError(f"Invalid decoded height size: {height_path}")
        values = np.frombuffer(raw, dtype="<u2").reshape((251, 251))
        heights = values.astype(np.float64) * scale + origin
        lod = int(sector["lod_level"])
        spacing = float(sector["spacing_metres"])
        edge = sector["bounds_l93_metres"][2] - sector["bounds_l93_metres"][0]
        row = round((sector["bounds_l93_metres"][1] - bounds[1]) / edge)
        column = round((sector["bounds_l93_metres"][0] - bounds[0]) / edge)
        native_step = round(spacing / SOURCE_SPACING_METRES)
        native_span = round(edge / SOURCE_SPACING_METRES)
        expected = mns[
            row * native_span : (row + 1) * native_span + 1 : native_step,
            column * native_span : (column + 1) * native_span + 1 : native_step,
        ]
        error = float(np.max(np.abs(heights - expected.astype(np.float64))))
        maximum_error = max(maximum_error, error)
        decoded[(lod, row, column)] = heights
        total_bytes += height_path.stat().st_size + colour_path.stat().st_size

    for (lod, row, column), heights in decoded.items():
        right = decoded.get((lod, row, column + 1))
        above = decoded.get((lod, row + 1, column))
        if right is not None:
            maximum_seam = max(maximum_seam, float(np.max(np.abs(heights[:, -1] - right[:, 0]))))
        if above is not None:
            maximum_seam = max(maximum_seam, float(np.max(np.abs(heights[-1, :] - above[0, :]))))

    if maximum_error > scale / 2 + 1e-6:
        raise ValueError(f"Height error exceeds quantization contract: {maximum_error}")
    if maximum_seam != 0.0:
        raise ValueError(f"Compact tile seams are not exact: {maximum_seam}")
    if total_bytes != catalog["checks"]["total_stream_byte_count"]:
        raise ValueError("Compact stream byte count mismatch")
    result = {
        "status": "ok",
        "sector_count": len(decoded),
        "total_stream_byte_count": total_bytes,
        "maximum_altitude_error_metres": maximum_error,
        "maximum_seam_error_metres": maximum_seam,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
