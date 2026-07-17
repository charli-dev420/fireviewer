"""Freeze official CEMS and IGN sources for the Fontainebleau 2026 map."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from zipfile import ZipFile

import requests
from pyproj import Transformer
from shapely import wkt
from shapely.geometry import mapping
from shapely.ops import transform


CEMS_API = (
    "https://rapidmapping.emergency.copernicus.eu/backend/"
    "dashboard-api/public-activations/"
)
IGN_WFS = "https://data.geopf.fr/wfs/ows"
ACTIVATION_CODE = "EMSR894"
AOI_NUMBER = 1
BUFFER_M = 1_500.0
PAGE_SIZE = 5_000
LAYERS = {
    "buildings.l93.geojson": "BDTOPO_V3:batiment",
    "vegetation.l93.geojson": "BDTOPO_V3:zone_de_vegetation",
    "roads.l93.geojson": "BDTOPO_V3:troncon_de_route",
    "water-courses.l93.geojson": "BDTOPO_V3:cours_d_eau",
    "water-segments.l93.geojson": "BDTOPO_V3:troncon_hydrographique",
    "water-surfaces.l93.geojson": "BDTOPO_V3:surface_hydrographique",
}


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def feature_collection(geometry: object, properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "name": properties["role"],
        "crs": {"type": "name", "properties": {"name": "EPSG:2154"}},
        "features": [
            {
                "type": "Feature",
                "properties": properties,
                "geometry": mapping(geometry),
            }
        ],
    }


def get_json(session: requests.Session, url: str, **params: object) -> dict[str, Any]:
    response = session.get(url, params=params, timeout=(15, 180))
    response.raise_for_status()
    value = response.json()
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON object expected from {response.url}")
    return value


def select_activation(document: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    activations = document.get("results")
    if not isinstance(activations, list) or len(activations) != 1:
        raise RuntimeError("CEMS activation lookup is not unique")
    activation = activations[0]
    if not isinstance(activation, dict) or activation.get("code") != ACTIVATION_CODE:
        raise RuntimeError("CEMS activation code does not match")
    aoi = next(
        (
            item
            for item in activation.get("aois", [])
            if isinstance(item, dict) and item.get("number") == AOI_NUMBER
        ),
        None,
    )
    if aoi is None:
        raise RuntimeError("CEMS AOI01 is absent")
    return activation, aoi


def select_latest_finished_del(aoi: dict[str, Any]) -> dict[str, Any]:
    products = [
        product
        for product in aoi.get("products", [])
        if isinstance(product, dict)
        and product.get("type") == "DEL"
        and product.get("version", {}).get("statusCode") == "F"
        and product.get("downloadPath")
    ]
    if not products:
        raise RuntimeError("no finished CEMS DEL product is available")
    return max(
        products,
        key=lambda product: str(product.get("version", {}).get("deliveryTime", "")),
    )


def fetch_wfs_layer(
    session: requests.Session,
    *,
    type_name: str,
    bounds: tuple[float, float, float, float],
) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    identifiers: set[str] = set()
    expected_total: int | None = None
    start = 0
    while expected_total is None or start < expected_total:
        page = get_json(
            session,
            IGN_WFS,
            SERVICE="WFS",
            VERSION="2.0.0",
            REQUEST="GetFeature",
            TYPENAMES=type_name,
            OUTPUTFORMAT="application/json",
            SRSNAME="EPSG:2154",
            BBOX=",".join(str(value) for value in (*bounds, "EPSG:2154")),
            COUNT=PAGE_SIZE,
            STARTINDEX=start,
            SORTBY="cleabs",
        )
        matched = page.get("numberMatched", page.get("totalFeatures"))
        if not isinstance(matched, int):
            raise RuntimeError(f"WFS {type_name} did not report numberMatched")
        if expected_total is None:
            expected_total = matched
        elif expected_total != matched:
            raise RuntimeError(f"WFS {type_name} changed during pagination")
        page_features = page.get("features")
        if not isinstance(page_features, list):
            raise RuntimeError(f"WFS {type_name} page is not a FeatureCollection")
        for feature in page_features:
            if not isinstance(feature, dict):
                raise RuntimeError(f"WFS {type_name} returned an invalid feature")
            identifier = str(feature.get("id", ""))
            if not identifier or identifier in identifiers:
                raise RuntimeError(f"WFS {type_name} returned a duplicate feature")
            identifiers.add(identifier)
            features.append(feature)
        if not page_features:
            break
        start += len(page_features)
    if expected_total != len(features):
        raise RuntimeError(
            f"WFS {type_name} is incomplete: {len(features)}/{expected_total}"
        )
    return {
        "type": "FeatureCollection",
        "name": type_name,
        "crs": {"type": "name", "properties": {"name": "EPSG:2154"}},
        "features": features,
    }


def download_product(session: requests.Session, url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with session.get(url, stream=True, timeout=(15, 300)) as response:
        response.raise_for_status()
        with target.open("wb") as stream:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    stream.write(chunk)
    if target.stat().st_size <= 0:
        raise RuntimeError("CEMS DEL archive is empty")


def safe_zip_inventory(path: Path) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    with ZipFile(path) as archive:
        bad_member = archive.testzip()
        if bad_member is not None:
            raise RuntimeError(f"CEMS DEL archive has a corrupt member: {bad_member}")
        for item in archive.infolist():
            relative = PurePosixPath(item.filename.replace("\\", "/"))
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError(f"unsafe CEMS DEL archive member: {item.filename}")
            result.append(
                {
                    "path": relative.as_posix(),
                    "byte_count": item.file_size,
                    "crc32": f"{item.CRC:08x}",
                }
            )
    return result


def prepare(output_root: Path) -> dict[str, Any]:
    if output_root.exists() and any(output_root.iterdir()):
        raise RuntimeError(
            f"source freeze already exists; use a new root instead of overwriting {output_root}"
        )
    output_root.mkdir(parents=True, exist_ok=True)
    fetched_at = utc_now()
    with requests.Session() as session:
        session.headers["User-Agent"] = "FireViewer-Fontainebleau-source-freeze/1.0"
        cems = get_json(session, CEMS_API, code=ACTIVATION_CODE)
        activation, aoi = select_activation(cems)
        product = select_latest_finished_del(aoi)
        write_json(output_root / "incident/cems-emsr894-api.json", cems)

        geometry_wgs84 = wkt.loads(str(aoi["extent"]))
        project = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
        geometry_l93 = transform(project.transform, geometry_wgs84)
        map_aoi_l93 = geometry_l93.buffer(BUFFER_M)
        write_json(
            output_root / "aoi.l93.geojson",
            feature_collection(
                map_aoi_l93,
                {
                    "role": "map-aoi-buffered-1500m",
                    "source": ACTIVATION_CODE,
                    "buffer_m": BUFFER_M,
                },
            ),
        )
        write_json(
            output_root / "production-envelope.l93.geojson",
            feature_collection(
                geometry_l93,
                {
                    "role": "cems-activation-aoi-not-burn-perimeter",
                    "source": ACTIVATION_CODE,
                    "aoi_number": AOI_NUMBER,
                },
            ),
        )

        bounds = tuple(float(value) for value in map_aoi_l93.bounds)
        source_records: list[dict[str, Any]] = []
        for filename, type_name in LAYERS.items():
            document = fetch_wfs_layer(session, type_name=type_name, bounds=bounds)
            target = output_root / filename
            write_json(target, document)
            source_records.append(
                {
                    "path": filename,
                    "type_name": type_name,
                    "feature_count": len(document["features"]),
                    "byte_count": target.stat().st_size,
                    "sha256": sha256_file(target),
                }
            )

        archive_path = output_root / "incident/EMSR894_AOI01_DEL_MONIT01_v1.zip"
        download_product(session, str(product["downloadPath"]), archive_path)
        archive_inventory = safe_zip_inventory(archive_path)

    provenance = {
        "schema": "fireviewer.fontainebleau-source-freeze.v1",
        "fetched_at_utc": fetched_at,
        "activation": {
            "code": activation["code"],
            "name": activation["name"],
            "closed": activation["closed"],
            "event_time": activation["eventTime"],
            "activation_time": activation["activationTime"],
            "api_url": f"{CEMS_API}?code={ACTIVATION_CODE}",
            "aoi_number": AOI_NUMBER,
            "aoi_wkt_wgs84": aoi["extent"],
            "aoi_bounds_l93_m": [float(value) for value in geometry_l93.bounds],
            "map_aoi_buffer_m": BUFFER_M,
            "map_aoi_bounds_l93_m": [float(value) for value in map_aoi_l93.bounds],
        },
        "incident_product": {
            "type": product["type"],
            "monitoring_number": product["monitoringNumber"],
            "delivery_time": product["version"]["deliveryTime"],
            "status_code": product["version"]["statusCode"],
            "download_url": product["downloadPath"],
            "archive_path": archive_path.relative_to(output_root).as_posix(),
            "archive_byte_count": archive_path.stat().st_size,
            "archive_sha256": sha256_file(archive_path),
            "archive_member_count": len(archive_inventory),
            "archive_inventory": archive_inventory,
            "terrain_usage": "audit-only-not-baked-into-unity-terrain",
        },
        "ign_wfs": {
            "endpoint": IGN_WFS,
            "crs": "EPSG:2154",
            "bbox_l93_m": list(bounds),
            "layers": source_records,
        },
    }
    provenance_path = output_root / "source-provenance.json"
    write_json(provenance_path, provenance)
    return {
        "status": "frozen",
        "output_root": str(output_root.resolve()),
        "source_count": len(source_records),
        "feature_count": sum(item["feature_count"] for item in source_records),
        "incident_archive_sha256": provenance["incident_product"]["archive_sha256"],
        "provenance": str(provenance_path.resolve()),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print(json.dumps(prepare(args.output_root.resolve()), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
