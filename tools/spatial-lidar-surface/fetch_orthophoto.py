"""Fetch an official IGN orthophoto for one controlled LiDAR tile."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import rasterio
from rasterio.warp import transform_bounds

from produce import find_tile_bounds, sha256_file, write_json


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-project", required=True, type=Path)
    parser.add_argument("--tile-id", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--pixels", type=int, default=4000)
    args = parser.parse_args()
    if not 512 <= args.pixels <= 5010:
        raise ValueError("IGN WMS-R supports at most 5010 pixels per side")
    bounds_l93 = find_tile_bounds(args.source_project.resolve(), args.tile_id)
    bounds_3857 = transform_bounds("EPSG:2154", "EPSG:3857", *bounds_l93, densify_pts=21)
    parameters = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": "ORTHOIMAGERY.ORTHOPHOTOS",
        "STYLES": "",
        "CRS": "EPSG:3857",
        "BBOX": ",".join(f"{value:.9f}" for value in bounds_3857),
        "WIDTH": str(args.pixels),
        "HEIGHT": str(args.pixels),
        "FORMAT": "image/geotiff",
    }
    url = "https://data.geopf.fr/wms-r/wms?" + urlencode(parameters)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(url, timeout=180) as response, args.output.open("wb") as destination:
        while block := response.read(1024 * 1024):
            destination.write(block)
    with rasterio.open(args.output) as dataset:
        if dataset.count < 3 or dataset.width != args.pixels or dataset.height != args.pixels:
            raise RuntimeError("The IGN response is not the expected RGB orthophoto")
    record = {
        "tile_id": args.tile_id,
        "provider": "IGN Géoplateforme WMS-R",
        "layer": "ORTHOIMAGERY.ORTHOPHOTOS",
        "request_url": url,
        "bounds_l93_metres": list(bounds_l93),
        "bounds_epsg3857_metres": list(bounds_3857),
        "pixels": args.pixels,
        "path": str(args.output.resolve()),
        "sha256": sha256_file(args.output),
    }
    write_json(args.output.with_suffix(".source.json"), record)
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
