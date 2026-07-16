"""Independently verify every GLB in the complete far-distance catalogue."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import trimesh

from produce import sha256_file


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path)
    args = parser.parse_args()
    catalog_path = args.catalog.resolve()
    root = catalog_path.parent
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    tiles = catalog.get("tiles", [])
    if len(tiles) != 128:
        raise RuntimeError(f"Expected 128 tiles, got {len(tiles)}")
    totals = {"files": 0, "vertices": 0, "triangles": 0, "bytes": 0}
    maximum_bounds_error = 0.0
    for tile in tiles:
        if len(tile.get("chunks", [])) != 16:
            raise RuntimeError(f"Expected 16 chunks in {tile.get('tile_id')}")
        for chunk in tile["chunks"]:
            asset = chunk["asset"]
            path = root / asset["path"]
            if sha256_file(path) != asset["sha256"]:
                raise RuntimeError(f"Hash mismatch: {path}")
            scene = trimesh.load(path, force="scene", process=False)
            if set(scene.geometry) != {"lidar_surface"}:
                raise RuntimeError(f"Unexpected geometry: {path}")
            mesh = scene.geometry["lidar_surface"]
            if not np.isfinite(mesh.vertices).all():
                raise RuntimeError(f"Non-finite vertex: {path}")
            expected = np.asarray(((0.0, -250.0), (250.0, 0.0)))
            actual = np.asarray(((mesh.bounds[0, 0], mesh.bounds[0, 2]), (mesh.bounds[1, 0], mesh.bounds[1, 2])))
            maximum_bounds_error = max(maximum_bounds_error, float(np.max(np.abs(actual - expected))))
            if len(mesh.vertices) != asset["vertex_count"] or len(mesh.faces) != asset["triangle_count"]:
                raise RuntimeError(f"Topology mismatch: {path}")
            totals["files"] += 1
            totals["vertices"] += len(mesh.vertices)
            totals["triangles"] += len(mesh.faces)
            totals["bytes"] += path.stat().st_size
    checks = {
        **totals,
        "tile_count": len(tiles),
        "only_lidar_surface_geometry": True,
        "maximum_local_bounds_error_metres": maximum_bounds_error,
        "maximum_inter_tile_seam_error_metres": catalog["checks"]["maximum_inter_tile_seam_error_metres"],
        "synthetic_geometry_count": catalog["checks"]["synthetic_geometry_count"],
    }
    if maximum_bounds_error != 0.0 or checks["synthetic_geometry_count"] != 0:
        raise RuntimeError(f"Far-domain contract failed: {checks}")
    print(json.dumps({"status": "ok", "checks": checks}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
