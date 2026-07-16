"""Preproduce the complete stable MNT 10 m far-distance domain."""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
from pathlib import Path
from typing import Any

import numpy as np

from produce import (
    CHUNK_METRES,
    PIPELINE_VERSION,
    exact_grid,
    export_chunk,
    read_json,
    sha256_file,
    source_records,
    write_json,
)


FAR_LOD = 3
FAR_SPACING_METRES = 10.0
FAR_SOURCE_STEP = 20


def vector_tiles(source_project: Path) -> list[dict[str, Any]]:
    manifest = read_json(
        source_project / "Assets" / "Generated" / "DiePontaix" / "die_pontaix_manifest.json"
    )
    result: list[dict[str, Any]] = []
    for terrain in manifest.get("tiles", []):
        for vector in terrain.get("vector_tiles", []):
            tile_id = vector.get("tile_id")
            bounds = vector.get("bounds_l93_metres")
            if isinstance(tile_id, str) and isinstance(bounds, list) and len(bounds) == 4:
                result.append({
                    "tile_id": tile_id,
                    "zone_id": terrain.get("zone_id"),
                    "terrain_tile_id": terrain.get("tile_id"),
                    "bounds_l93_metres": [float(value) for value in bounds],
                })
    result.sort(key=lambda item: item["tile_id"])
    if len(result) != 128 or len({item["tile_id"] for item in result}) != 128:
        raise RuntimeError(f"Expected 128 unique vector tiles, got {len(result)}")
    return result


def seam_error(states: dict[tuple[float, float], dict[str, Any]]) -> float:
    result = 0.0
    for (xmin, ymin), state in states.items():
        grid = state["grid"]
        east = states.get((xmin + 1000.0, ymin))
        north = states.get((xmin, ymin + 1000.0))
        if east is not None:
            result = max(result, float(np.max(np.abs(grid[:, -1] - east["grid"][:, 0]))))
        if north is not None:
            result = max(result, float(np.max(np.abs(grid[-1, :] - north["grid"][0, :]))))
    return result


def harmonize_boundaries(states: dict[tuple[float, float], dict[str, Any]]) -> None:
    for (xmin, ymin), state in states.items():
        east = states.get((xmin + 1000.0, ymin))
        if east is not None:
            shared = (state["grid"][:, -1] + east["grid"][:, 0]) * 0.5
            state["grid"][:, -1] = shared
            east["grid"][:, 0] = shared
    for (xmin, ymin), state in states.items():
        north = states.get((xmin, ymin + 1000.0))
        if north is not None:
            shared = (state["grid"][-1, :] + north["grid"][0, :]) * 0.5
            state["grid"][-1, :] = shared
            north["grid"][0, :] = shared
    corners: dict[tuple[float, float], list[tuple[np.ndarray, int, int]]] = {}
    for (xmin, ymin), state in states.items():
        grid = state["grid"]
        for easting, northing, row, column in (
            (xmin, ymin, 0, 0),
            (xmin + 1000.0, ymin, 0, -1),
            (xmin, ymin + 1000.0, -1, 0),
            (xmin + 1000.0, ymin + 1000.0, -1, -1),
        ):
            corners.setdefault((easting, northing), []).append((grid, row, column))
    for references in corners.values():
        shared = float(np.mean([grid[row, column] for grid, row, column in references]))
        for grid, row, column in references:
            grid[row, column] = shared


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-project", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    source_project = args.source_project.resolve()
    workspace = args.workspace.resolve()
    output = workspace / "far-domain"
    temporary = workspace / f".far-domain.tmp-{os.getpid()}"
    if output.exists():
        if not args.force:
            raise FileExistsError(f"Refusing to replace {output} without --force")
        shutil.rmtree(output)
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(parents=True)

    tiles = vector_tiles(source_project)
    validated_sources: dict[str, str] = {}
    states: dict[tuple[float, float], dict[str, Any]] = {}
    try:
        for tile_index, tile in enumerate(tiles, start=1):
            bounds = tuple(tile["bounds_l93_metres"])
            paths, records = source_records(source_project, "mnt", bounds)
            for path, record in zip(paths, records):
                key = str(path.resolve())
                if key not in validated_sources:
                    actual = sha256_file(path)
                    if actual != record.get("sha256"):
                        raise RuntimeError(f"Source hash mismatch: {path}")
                    validated_sources[key] = actual
            repair: dict[str, Any] = {}
            mnt = exact_grid(paths, bounds, fill_source_nodata=True, repair_report=repair)
            grid = mnt[::FAR_SOURCE_STEP, ::FAR_SOURCE_STEP].copy()
            states[(bounds[0], bounds[1])] = {
                "tile": tile,
                "records": records,
                "repair": repair,
                "grid": grid,
                "original_grid": grid.copy(),
            }
            print(f"[source {tile_index}/128] {tile['tile_id']}", flush=True)

        raw_seam_error = seam_error(states)
        harmonize_boundaries(states)
        final_seam_error = seam_error(states)
        maximum_adjustment = max(
            float(np.max(np.abs(state["grid"] - state["original_grid"])))
            for state in states.values()
        )
        tile_records: list[dict[str, Any]] = []
        all_bounds = [math.inf, math.inf, -math.inf, -math.inf]
        totals = {"tile_count": 0, "chunk_count": 0, "vertex_count": 0, "triangle_count": 0, "byte_count": 0}
        samples_per_chunk = int(round(CHUNK_METRES / FAR_SPACING_METRES))
        for tile_index, tile in enumerate(tiles, start=1):
            tile_id = tile["tile_id"]
            bounds = tuple(tile["bounds_l93_metres"])
            state = states[(bounds[0], bounds[1])]
            grid = state["grid"]
            height_origin = float(math.floor(float(np.min(grid))))
            chunks: list[dict[str, Any]] = []
            for row in range(4):
                for column in range(4):
                    start_row = row * samples_per_chunk
                    start_column = column * samples_per_chunk
                    native = grid[
                        start_row : start_row + samples_per_chunk + 1,
                        start_column : start_column + samples_per_chunk + 1,
                    ]
                    neutral_colours = np.empty((*native.shape, 3), dtype=np.uint8)
                    neutral_colours[:] = (154, 162, 154)
                    chunk_id = f"{tile_id}-C{row}{column}"
                    xmin = bounds[0] + column * CHUNK_METRES
                    ymin = bounds[1] + row * CHUNK_METRES
                    chunk_bounds = (xmin, ymin, xmin + CHUNK_METRES, ymin + CHUNK_METRES)
                    asset_path = temporary / "tiles" / tile_id / "chunks" / chunk_id / "lod3.glb"
                    asset = export_chunk(
                        asset_path,
                        native,
                        chunk_bounds,
                        height_origin,
                        1,
                        "mnt",
                        neutral_colours,
                        FAR_SPACING_METRES,
                    )
                    asset["lod_level"] = FAR_LOD
                    asset["path"] = asset_path.relative_to(temporary).as_posix()
                    chunks.append({"chunk_id": chunk_id, "bounds_l93_metres": list(chunk_bounds), "asset": asset})
                    totals["chunk_count"] += 1
                    totals["vertex_count"] += asset["vertex_count"]
                    totals["triangle_count"] += asset["triangle_count"]
                    totals["byte_count"] += asset["byte_count"]
            tile_records.append({
                **tile,
                "height_origin_ngf_ign69_metres": height_origin,
                "source_mnt_sha256": sorted({record["sha256"] for record in state["records"]}),
                "source_nodata_repair": state["repair"],
                "chunks": chunks,
            })
            totals["tile_count"] += 1
            all_bounds[0] = min(all_bounds[0], bounds[0])
            all_bounds[1] = min(all_bounds[1], bounds[1])
            all_bounds[2] = max(all_bounds[2], bounds[2])
            all_bounds[3] = max(all_bounds[3], bounds[3])
            print(f"[export {tile_index}/128] {tile_id}", flush=True)

        catalog = {
            "schema_version": "1.0",
            "generator": f"spatial-lidar-surface/{PIPELINE_VERSION}",
            "scope": "complete far-distance domain",
            "bounds_l93_metres": all_bounds,
            "contract": {
                "geometry_source": "IGN LiDAR HD MNT 10 m subset",
                "source_nodata_policy": "inverse-distance fill from adjacent MNT samples, explicitly counted",
                "seam_policy": "shared 10 m boundary samples averaged between adjacent MNT tiles",
                "synthetic_geometry_added": False,
                "grid_crs": "EPSG:2154",
                "vertical_datum": "NGF-IGN69",
                "mesh_axes": "local glTF (E, U, -N) metres",
                "lod_level": FAR_LOD,
                "spacing_metres": FAR_SPACING_METRES,
                "recommended_minimum_distance_metres": 850,
                "colour_policy": "neutral analytical colour; runtime orthophoto may be draped without changing geometry",
            },
            "checks": {
                **totals,
                "source_file_count": len(validated_sources),
                "repaired_mnt_sample_count": sum(state["repair"]["repaired_sample_count"] for state in states.values()),
                "maximum_raw_inter_tile_seam_error_metres": raw_seam_error,
                "maximum_seam_harmonization_adjustment_metres": maximum_adjustment,
                "maximum_inter_tile_seam_error_metres": final_seam_error,
                "maximum_glb_altitude_roundtrip_error_metres": max(
                    chunk["asset"]["maximum_altitude_roundtrip_error_metres"]
                    for tile in tile_records for chunk in tile["chunks"]
                ),
                "synthetic_geometry_count": 0,
            },
            "tiles": tile_records,
        }
        write_json(temporary / "catalog.json", catalog)
        write_json(temporary / "quality-report.json", {"status": "ok", "checks": catalog["checks"]})
        os.replace(temporary, output)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    print(json.dumps({"output": str(output), "checks": catalog["checks"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
