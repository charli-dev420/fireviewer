"""Verify placement and quantify the far-MNT to near-MNS transition."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import trimesh


def mesh_grid(path: Path, origin: float) -> np.ndarray:
    scene = trimesh.load(path, force="scene", process=False)
    mesh = scene.geometry["lidar_surface"]
    side = int(round(np.sqrt(len(mesh.vertices))))
    return np.asarray(mesh.vertices)[:, 1].reshape(side, side) + origin


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--far-catalog", required=True, type=Path)
    parser.add_argument("--near-catalog", required=True, type=Path)
    args = parser.parse_args()
    far_path = args.far_catalog.resolve()
    near_path = args.near_catalog.resolve()
    far = json.loads(far_path.read_text(encoding="utf-8"))
    near = json.loads(near_path.read_text(encoding="utf-8"))
    tile_id = near["tile_id"]
    far_tile = next(tile for tile in far["tiles"] if tile["tile_id"] == tile_id)
    far_chunks = {chunk["chunk_id"]: chunk for chunk in far_tile["chunks"]}
    near_chunks = {chunk["chunk_id"]: chunk for chunk in near["chunks"]}
    if set(far_chunks) != set(near_chunks):
        raise RuntimeError("Far and near catalogues do not contain the same chunk identifiers")
    near_origin = float(near["contract"]["height_origin_ngf_ign69_metres"])
    far_origin = float(far_tile["height_origin_ngf_ign69_metres"])
    deltas: list[np.ndarray] = []
    maximum_bounds_error = 0.0
    for chunk_id in sorted(far_chunks):
        far_chunk = far_chunks[chunk_id]
        near_chunk = near_chunks[chunk_id]
        maximum_bounds_error = max(
            maximum_bounds_error,
            float(np.max(np.abs(
                np.asarray(far_chunk["bounds_l93_metres"])
                - np.asarray(near_chunk["bounds_l93_metres"])
            ))),
        )
        near_lod2 = next(lod for lod in near_chunk["lods"] if lod["lod_level"] == 2)
        far_grid = mesh_grid(far_path.parent / far_chunk["asset"]["path"], far_origin)
        near_grid = mesh_grid(
            near_path.parent / "chunks" / chunk_id / near_lod2["path"], near_origin
        )
        if near_grid[::5, ::5].shape != far_grid.shape:
            raise RuntimeError(f"Incompatible transition grids in {chunk_id}")
        deltas.append(np.abs(near_grid[::5, ::5] - far_grid))
    values = np.concatenate([value.ravel() for value in deltas])
    checks = {
        "tile_id": tile_id,
        "chunk_count": len(far_chunks),
        "maximum_horizontal_bounds_error_metres": maximum_bounds_error,
        "absolute_vertical_delta_metres": {
            "median": float(np.percentile(values, 50)),
            "p95": float(np.percentile(values, 95)),
            "p99": float(np.percentile(values, 99)),
            "maximum": float(np.max(values)),
        },
        "transition_requirement": "cross-fade; keep far mesh visible until near mesh is fully loaded",
    }
    if maximum_bounds_error != 0.0:
        raise RuntimeError(f"Far/near placement mismatch: {checks}")
    print(json.dumps({"status": "ok", "checks": checks}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
