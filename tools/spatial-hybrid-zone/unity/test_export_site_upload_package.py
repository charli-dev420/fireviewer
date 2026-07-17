from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys


MODULE_DIRECTORY = Path(__file__).resolve().parent
if str(MODULE_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(MODULE_DIRECTORY))

from export_site_upload_package import build_site_package, validate_site_package  # noqa: E402


def _asset(root: Path, relative: str, payload: bytes) -> dict[str, object]:
    path = root / Path(relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return {
        "url": relative,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "byte_count": len(payload),
    }


def test_builds_exact_hardlinked_site_upload_inventory(tmp_path: Path) -> None:
    source = tmp_path / "remote"
    source.mkdir()
    catalog = {
        "schema": "fireviewer.remote-tile-catalog.v1",
        "crs": "EPSG:2154",
        "linear_unit": "metre",
        "origin_l93_m": [885_173.0, 6_404_926.0, 320.0],
        "exported_detail_tile_count": 1,
        "lod_policy": {
            "far": {
                "imagery": _asset(source, "far/global.jpg", b"far-image"),
                "terrain": _asset(source, "far/global.fwterrain", b"far-terrain"),
            }
        },
        "tiles": [
            {
                "id": "x0_y0_s500",
                "imagery": _asset(source, "imagery/tile.jpg", b"tile-image"),
                "payload": _asset(source, "detail/tile/tile.fwtile", b"tile-payload"),
            }
        ],
    }
    (source / "catalog.json").write_text(
        json.dumps(catalog, separators=(",", ":")), encoding="utf-8"
    )
    output = tmp_path / "upload" / "pkg-die-r1-v1"

    report = build_site_package(
        source_root=source,
        output_root=output,
        package_id="pkg-die-r1-v1",
        zone_id="DIE-PONTAIX-08",
        revision=1,
    )

    assert report["status"] == "valid"
    assert report["asset_count"] == 4
    assert report["file_count"] == 6
    assert validate_site_package(output)["status"] == "valid"
    packaged_catalog = json.loads((output / "catalog.json").read_text(encoding="utf-8"))
    assert packaged_catalog["tiles"][0]["payload"]["url"].startswith("assets/detail/")
    assert packaged_catalog["tiles"][0]["payload"]["path"].startswith("assets/detail/")
    source_stat = os.stat(source / "detail/tile/tile.fwtile")
    target_stat = os.stat(output / "assets/detail/tile/tile.fwtile")
    assert source_stat.st_ino == target_stat.st_ino
