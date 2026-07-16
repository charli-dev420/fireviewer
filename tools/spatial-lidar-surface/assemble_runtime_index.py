"""Assemble the immutable far catalogue and mutable near-cache index."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from produce import sha256_file, write_json


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    far_path = workspace / "far-domain" / "catalog.json"
    cache_path = workspace / "near-cache" / "index.json"
    far = json.loads(far_path.read_text(encoding="utf-8"))
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.is_file() else {"entries": {}}
    entries = cache.get("entries", {})
    tiles = []
    for tile in far["tiles"]:
        stream_catalog = workspace / "stream-cache" / tile["tile_id"] / "catalog.json"
        tiles.append({
            "tile_id": tile["tile_id"],
            "bounds_l93_metres": tile["bounds_l93_metres"],
            "far_catalog_tile_id": tile["tile_id"],
            "near_cache_catalog": entries.get(tile["tile_id"], {}).get("catalog_path"),
            "near_stream_catalog": (
                stream_catalog.relative_to(workspace).as_posix() if stream_catalog.is_file() else None
            ),
            "near_cache_status": "ready" if tile["tile_id"] in entries else "generate_on_consultation",
        })
    document = {
        "schema_version": "1.0",
        "far_catalog": "far-domain/catalog.json",
        "far_catalog_sha256": sha256_file(far_path),
        "near_cache_index": "near-cache/index.json",
        "near_cache_index_sha256": sha256_file(cache_path) if cache_path.is_file() else None,
        "selection_policy": {
            "cache_miss": "display LOD3 immediately and generate LOD0-2 asynchronously",
            "cache_ready": "keep LOD3 until requested near assets are decoded, then cross-fade",
            "lod0_range_metres": [0, 200],
            "lod1_range_metres": [160, 450],
            "lod2_range_metres": [380, 950],
            "lod3_range_metres": [850, None],
            "hysteresis_metres": 25,
            "maximum_adjacent_lod_delta": 1,
            "cross_fade_milliseconds": 600,
            "geometric_morphing_far_to_near": False,
        },
        "checks": {
            "tile_count": len(tiles),
            "far_tiles_ready": len(far["tiles"]),
            "near_tiles_ready": sum(tile["near_cache_status"] == "ready" for tile in tiles),
            "near_stream_tiles_ready": sum(tile["near_stream_catalog"] is not None for tile in tiles),
            "near_tiles_on_demand": sum(tile["near_cache_status"] != "ready" for tile in tiles),
            "far_fallback_available_for_every_tile": all(tile["far_catalog_tile_id"] for tile in tiles),
        },
        "tiles": tiles,
    }
    output = workspace / "runtime-index.json"
    write_json(output, document)
    print(json.dumps({"output": str(output), "checks": document["checks"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
