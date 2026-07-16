"""Discover and download one official IGN LiDAR HD COPC tile."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


WFS_URL = "https://data.geopf.fr/wfs/ows"
TYPENAME = "IGNF_NUAGES-DE-POINTS-LIDAR-HD:dalle"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--north-west", required=True, help="IGN kilometre index, for example 0888_6409")
    parser.add_argument("--bbox-wgs84", required=True, help="west,south,east,north discovery bounds")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    west, south, east, north = (float(value) for value in args.bbox_wgs84.split(","))
    expected_name = f"LHD_FXX_{args.north_west}_PTS_O_LAMB93_IGN69"
    query = urlencode({
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": TYPENAME,
        "OUTPUTFORMAT": "application/json",
        "SRSNAME": "EPSG:4326",
        "BBOX": f"{west},{south},{east},{north},EPSG:4326",
        "COUNT": "200",
    })
    discovery_url = f"{WFS_URL}?{query}"
    with urlopen(discovery_url, timeout=90) as response:
        collection = json.load(response)
    matches = [
        feature for feature in collection.get("features", [])
        if feature.get("properties", {}).get("name") == expected_name
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one {expected_name} WFS feature, received {len(matches)}")
    properties = matches[0]["properties"]
    source_url = str(properties["url"])
    metadata = json.loads(properties.get("metadata") or "{}")

    head = Request(source_url, method="HEAD")
    with urlopen(head, timeout=90) as response:
        expected_bytes = int(response.headers["Content-Length"])
        accept_ranges = response.headers.get("Accept-Ranges")
    if args.output.exists() and not args.force:
        if args.output.stat().st_size != expected_bytes:
            raise FileExistsError(f"Existing COPC has the wrong size: {args.output}")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".part")
        temporary.unlink(missing_ok=True)
        try:
            with urlopen(source_url, timeout=900) as response, temporary.open("wb") as destination:
                while block := response.read(4 * 1024 * 1024):
                    destination.write(block)
            if temporary.stat().st_size != expected_bytes:
                raise IOError(f"Incomplete COPC: {temporary.stat().st_size} of {expected_bytes} bytes")
            temporary.replace(args.output)
        finally:
            temporary.unlink(missing_ok=True)

    record = {
        "provider": "IGN Géoplateforme",
        "product": "Nuages de points LiDAR HD classés",
        "license": "Licence Ouverte / Open Licence 2.0",
        "north_west_index": args.north_west,
        "name": properties["name"],
        "download_name": properties.get("name_download"),
        "projection": properties.get("projection"),
        "vertical_datum": "NGF-IGN69",
        "format": properties.get("format"),
        "source_timestamp": properties.get("timestamp"),
        "metadata": metadata,
        "discovery_url": discovery_url,
        "source_url": source_url,
        "accept_ranges": accept_ranges,
        "byte_count": args.output.stat().st_size,
        "sha256": sha256_file(args.output),
        "path": str(args.output.resolve()),
    }
    write_json(args.output.with_suffix(args.output.suffix + ".source.json"), record)
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
