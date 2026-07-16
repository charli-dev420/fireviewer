"""Generate and index a close-range MNS cache entry for one consulted tile."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from produce import write_json


def directory_bytes(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-project", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--tile-id", required=True)
    parser.add_argument("--max-cache-gb", type=float, default=12.0)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    source_project = args.source_project.resolve()
    workspace = args.workspace.resolve()
    cache_root = workspace / "near-cache"
    orthophoto_root = workspace / "orthophoto-cache"
    tile_root = cache_root / args.tile_id
    orthophoto = orthophoto_root / f"{args.tile_id}.tif"
    tools_root = Path(__file__).resolve().parent
    if not orthophoto.is_file() or args.refresh:
        subprocess.run([
            sys.executable, str(tools_root / "fetch_orthophoto.py"),
            "--source-project", str(source_project),
            "--tile-id", args.tile_id,
            "--output", str(orthophoto),
        ], check=True)
    if not tile_root.is_dir() or args.refresh:
        command = [
            sys.executable, str(tools_root / "produce.py"),
            "--source-project", str(source_project),
            "--workspace", str(cache_root),
            "--tile-id", args.tile_id,
            "--orthophoto", str(orthophoto),
            "--lods", "0,1,2",
        ]
        if tile_root.exists() or args.refresh:
            command.append("--force")
        subprocess.run(command, check=True)
        subprocess.run([
            sys.executable, str(tools_root / "verify.py"), str(tile_root / "catalog.json")
        ], check=True)

    now = datetime.now(timezone.utc).isoformat()
    index_path = cache_root / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.is_file() else {
        "schema_version": "1.0",
        "max_cache_bytes": int(args.max_cache_gb * 1024**3),
        "entries": {},
    }
    entries = index.setdefault("entries", {})
    previous = entries.get(args.tile_id, {})
    orthophoto_metadata = orthophoto.with_suffix(".source.json")
    orthophoto_bytes = orthophoto.stat().st_size + (
        orthophoto_metadata.stat().st_size if orthophoto_metadata.is_file() else 0
    )
    entries[args.tile_id] = {
        "tile_id": args.tile_id,
        "catalog_path": str((tile_root / "catalog.json").relative_to(workspace)).replace("\\", "/"),
        "orthophoto_path": str(orthophoto.relative_to(workspace)).replace("\\", "/"),
        "byte_count": directory_bytes(tile_root) + orthophoto_bytes,
        "geometry_byte_count": directory_bytes(tile_root),
        "orthophoto_byte_count": orthophoto_bytes,
        "created_utc": previous.get("created_utc", now),
        "last_accessed_utc": now,
        "lods": [0, 1, 2],
    }
    index["max_cache_bytes"] = int(args.max_cache_gb * 1024**3)
    evicted: list[str] = []
    while sum(entry["byte_count"] for entry in entries.values()) > index["max_cache_bytes"]:
        candidates = [entry for key, entry in entries.items() if key != args.tile_id]
        if not candidates:
            break
        oldest = min(candidates, key=lambda entry: entry["last_accessed_utc"])
        target = cache_root / oldest["tile_id"]
        if target.resolve().parent != cache_root.resolve():
            raise RuntimeError(f"Unsafe cache eviction target: {target}")
        shutil.rmtree(target)
        evicted_orthophoto = orthophoto_root / f"{oldest['tile_id']}.tif"
        evicted_metadata = evicted_orthophoto.with_suffix(".source.json")
        if evicted_orthophoto.resolve().parent != orthophoto_root.resolve():
            raise RuntimeError(f"Unsafe orthophoto eviction target: {evicted_orthophoto}")
        if evicted_orthophoto.is_file():
            evicted_orthophoto.unlink()
        if evicted_metadata.is_file():
            evicted_metadata.unlink()
        evicted.append(oldest["tile_id"])
        del entries[oldest["tile_id"]]
    index["total_cache_bytes"] = sum(entry["byte_count"] for entry in entries.values())
    write_json(index_path, index)
    print(json.dumps({
        "status": "ok",
        "entry": entries[args.tile_id],
        "total_cache_bytes": index["total_cache_bytes"],
        "evicted": evicted,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
