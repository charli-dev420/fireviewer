"""Independently verify a spatial-lidar-surface production catalogue."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import trimesh


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path)
    args = parser.parse_args()
    catalog_path = args.catalog.resolve()
    root = catalog_path.parent
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    chunks = catalog.get("chunks", [])
    if len(chunks) != 16:
        raise RuntimeError(f"Expected 16 chunks, got {len(chunks)}")
    totals = {"files": 0, "vertices": 0, "triangles": 0, "bytes": 0}
    maximum_subset_error = 0.0
    unique_colours: set[tuple[int, int, int, int]] = set()
    for chunk in chunks:
        lods = chunk.get("lods", [])
        expected_lods = catalog["contract"].get("produced_lods", [0, 1, 2, 3])
        if [lod.get("lod_level", index) for index, lod in enumerate(lods)] != expected_lods:
            raise RuntimeError(f"Unexpected LOD set in {chunk['chunk_id']}")
        height_grids: dict[int, np.ndarray] = {}
        for index, lod in enumerate(lods):
            path = root / "chunks" / chunk["chunk_id"] / lod["path"]
            if sha256_file(path) != lod["sha256"]:
                raise RuntimeError(f"Hash mismatch: {path}")
            scene = trimesh.load(path, force="scene", process=False)
            if set(scene.geometry) != {"lidar_surface"}:
                raise RuntimeError(f"Unexpected geometry in {path}: {sorted(scene.geometry)}")
            mesh = scene.geometry["lidar_surface"]
            if not np.isfinite(mesh.vertices).all():
                raise RuntimeError(f"Non-finite vertex in {path}")
            if len(mesh.vertices) != lod["vertex_count"] or len(mesh.faces) != lod["triangle_count"]:
                raise RuntimeError(f"Topology mismatch: {path}")
            side = int(round(math.sqrt(len(mesh.vertices))))
            if side * side != len(mesh.vertices):
                raise RuntimeError(f"LOD is not a square grid: {path}")
            level = int(lod.get("lod_level", index))
            height_grids[level] = np.asarray(mesh.vertices)[:, 1].reshape(side, side)
            unique_colours.update(map(tuple, np.asarray(mesh.visual.vertex_colors)[:: max(1, len(mesh.vertices) // 5000)]))
            totals["files"] += 1
            totals["vertices"] += len(mesh.vertices)
            totals["triangles"] += len(mesh.faces)
            totals["bytes"] += path.stat().st_size
        if 0 in height_grids and 1 in height_grids:
            maximum_subset_error = max(
                maximum_subset_error,
                float(np.max(np.abs(height_grids[1] - height_grids[0][::2, ::2]))),
            )
        if 0 in height_grids and 2 in height_grids:
            maximum_subset_error = max(
                maximum_subset_error,
                float(np.max(np.abs(height_grids[2] - height_grids[0][::4, ::4]))),
            )
    checks = {
        **totals,
        "chunk_count": len(chunks),
        "only_lidar_surface_geometry": True,
        "maximum_mns_lod_subset_error_metres": maximum_subset_error,
        "sampled_unique_vertex_colours": len(unique_colours),
        "synthetic_geometry_count": catalog["checks"]["synthetic_geometry_count"],
        "orthophoto_applied_as_colour_only": catalog["checks"]["orthophoto_applied_as_colour_only"],
    }
    if maximum_subset_error != 0.0 or checks["synthetic_geometry_count"] != 0:
        raise RuntimeError(f"LiDAR direct contract failed: {checks}")
    print(json.dumps({"status": "ok", "checks": checks}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
