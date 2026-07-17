"""Build the publishable Die-Pontaix operational evaluation corpus.

The incident is an inference/evaluation source only.  Every emitted record is excluded from
training and every model result remains private until a human validation has completed.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import zipfile
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlencode

import httpx
from PIL import Image, ImageStat

CORPUS_ID = "die-pontaix-operational-evaluation-v0.1.0"
ACTIVATION_CODE = "EMSR890"
ACTIVATION_API = (
    "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/"
    "public-activations/?code=EMSR890"
)
ACTIVATION_PAGE = "https://mapping.emergency.copernicus.eu/activations/EMSR890/"
NASA_SNAPSHOT_API = "https://wvs.earthdata.nasa.gov/api/v1/snapshot"
NASA_BBOX = "5.25,44.62,5.44,44.79"
NASA_LAYER_PROFILES = (
    ("viirs-snpp-true-color", "VIIRS_SNPP_CorrectedReflectance_TrueColor"),
    ("viirs-noaa20-true-color", "VIIRS_NOAA20_CorrectedReflectance_TrueColor"),
    ("viirs-noaa21-true-color", "VIIRS_NOAA21_CorrectedReflectance_TrueColor"),
    ("modis-aqua-true-color", "MODIS_Aqua_CorrectedReflectance_TrueColor"),
    ("modis-terra-true-color", "MODIS_Terra_CorrectedReflectance_TrueColor"),
    (
        "viirs-noaa20-true-color-with-fire",
        "VIIRS_NOAA20_CorrectedReflectance_TrueColor,VIIRS_NOAA20_Thermal_Anomalies_375m_Day",
    ),
    (
        "viirs-noaa21-true-color-with-fire",
        "VIIRS_NOAA21_CorrectedReflectance_TrueColor,VIIRS_NOAA21_Thermal_Anomalies_375m_Day",
    ),
)
NASA_IMAGES_PER_DAY = 5
EXPECTED_DAYS = (
    date(2026, 7, 5),
    date(2026, 7, 7),
    date(2026, 7, 8),
    date(2026, 7, 9),
    date(2026, 7, 10),
    date(2026, 7, 11),
)
SPATIAL_PACKAGE = {
    "package_id": "fireviewer-die-pontaix-r1-v4",
    "zone_id": "DIE-PONTAIX-08",
    "revision_id": "R1",
    "url": (
        "https://github.com/charli-dev420/fireviewer/releases/download/"
        "spatial-die-pontaix-r1-v4/fireviewer-die-pontaix-r1-v4.tar.gz"
    ),
    "sha256": "238c97a5e285fefa02a59c7ae4b8783921c5db13815b9a18eb4edae8adbc1a3f",
    "byte_count": 401_437_902,
    "downloaded_into_corpus": False,
    "reuse": "signed_reference_only",
}
NASA_TERMS_URL = (
    "https://www.earthdata.nasa.gov/engage/open-data-services-and-software/data-use-policy"
)
CEMS_TERMS_URL = "https://mapping.emergency.copernicus.eu/terms-and-conditions/"
CEMS_CITATION_URL = "https://mapping.emergency.copernicus.eu/about/citation-guidelines/"
MAX_PRODUCT_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_NASA_IMAGE_BYTES = 12 * 1024 * 1024
MAX_TOTAL_ARCHIVE_BYTES = 96 * 1024 * 1024


class CorpusBuildError(RuntimeError):
    """Raised when a source or corpus invariant is not satisfied."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    os.replace(partial, path)


def _write_jsonl(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".partial.jsonl")
    with partial.open("w", encoding="utf-8", newline="\n") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(partial, path)


def _parse_instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _fetch_activation(client: httpx.Client) -> dict[str, Any]:
    response = client.get(ACTIVATION_API)
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list) or len(results) != 1:
        raise CorpusBuildError("Copernicus EMSR890 activation response is not unique")
    activation = results[0]
    if not isinstance(activation, dict) or activation.get("code") != ACTIVATION_CODE:
        raise CorpusBuildError("unexpected Copernicus activation code")
    if activation.get("sensitive") is not False:
        raise CorpusBuildError("Copernicus activation is sensitive or sensitivity is unknown")
    aois = activation.get("aois")
    if not isinstance(aois, list) or len(aois) != 1 or aois[0].get("name") != "Die":
        raise CorpusBuildError("expected one Copernicus AOI named Die")
    return activation


def _products_by_acquisition_day(activation: Mapping[str, Any]) -> dict[date, dict[str, Any]]:
    products = activation["aois"][0]["products"]
    selected: dict[date, dict[str, Any]] = {}
    for product in products:
        if product.get("feasible") is not True:
            continue
        images = product.get("images")
        if not isinstance(images, list) or len(images) != 1:
            raise CorpusBuildError("each selected Copernicus product must name one source image")
        acquisition_day = _parse_instant(str(images[0]["acquisitionTime"])).date()
        if acquisition_day not in EXPECTED_DAYS:
            continue
        if acquisition_day in selected:
            raise CorpusBuildError(f"multiple products found for {acquisition_day.isoformat()}")
        selected[acquisition_day] = dict(product)
    missing = sorted(set(EXPECTED_DAYS) - set(selected))
    if missing:
        raise CorpusBuildError(f"missing Copernicus products for {missing}")
    return selected


def _remote_size(client: httpx.Client, url: str) -> int:
    with client.stream("GET", url, headers={"Range": "bytes=0-0"}) as response:
        response.raise_for_status()
        content_range = response.headers.get("content-range", "")
        match = re.fullmatch(r"bytes 0-0/(\d+)", content_range)
        if response.status_code != 206 or not match:
            raise CorpusBuildError(f"source does not support a bounded size probe: {url}")
        return int(match.group(1))


def _download(
    client: httpx.Client,
    url: str,
    destination: Path,
    *,
    max_bytes: int,
    expected_content_type: str | None = None,
) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    partial.unlink(missing_ok=True)
    written = 0
    try:
        with client.stream("GET", url) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").split(";", 1)[0]
            if expected_content_type and content_type != expected_content_type:
                raise CorpusBuildError(
                    f"unexpected content type {content_type!r} for {destination.name}"
                )
            with partial.open("wb") as output:
                for chunk in response.iter_bytes():
                    written += len(chunk)
                    if written > max_bytes:
                        raise CorpusBuildError(f"download exceeds size cap: {destination.name}")
                    output.write(chunk)
        os.replace(partial, destination)
        return written
    finally:
        partial.unlink(missing_ok=True)


def _safe_member_name(name: str) -> bool:
    pure = PurePosixPath(name)
    return not pure.is_absolute() and ".." not in pure.parts


def _select_product_members(archive: zipfile.ZipFile) -> tuple[zipfile.ZipInfo, zipfile.ZipInfo]:
    files = [member for member in archive.infolist() if not member.is_dir()]
    if any(not _safe_member_name(member.filename) for member in files):
        raise CorpusBuildError("unsafe path in Copernicus archive")
    maps = [
        member
        for member in files
        if PurePosixPath(member.filename).parent == PurePosixPath("Maps")
        and member.filename.lower().endswith(".pdf")
    ]
    geometries = [member for member in files if member.filename.endswith("_observedEventA_v1.json")]
    if len(maps) != 1 or len(geometries) != 1:
        raise CorpusBuildError("Copernicus archive lacks one map PDF or event-area GeoJSON")
    return maps[0], geometries[0]


def _extract_selected_product(archive_path: Path, day_root: Path) -> tuple[Path, Path]:
    with zipfile.ZipFile(archive_path) as archive:
        map_member, geometry_member = _select_product_members(archive)
        if map_member.file_size > 50 * 1024 * 1024:
            raise CorpusBuildError("Copernicus map PDF exceeds extraction cap")
        if geometry_member.file_size > 128 * 1024 * 1024:
            raise CorpusBuildError("Copernicus event geometry exceeds extraction cap")
        map_path = day_root / "copernicus" / "map.pdf"
        geometry_path = day_root / "copernicus" / "observed-event.geojson.gz"
        map_path.parent.mkdir(parents=True, exist_ok=True)
        map_path.write_bytes(archive.read(map_member))
        geometry_bytes = archive.read(geometry_member)
        json.loads(geometry_bytes)
        geometry_path.write_bytes(gzip.compress(geometry_bytes, compresslevel=9, mtime=0))
    return map_path, geometry_path


def _render_pdf(pdf_path: Path) -> Path:
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise CorpusBuildError("pdftoppm is required to render Copernicus maps")
    renderer_path = Path(renderer)
    if os.name == "nt" and renderer_path.suffix.lower() in {".cmd", ".bat"}:
        for parent in renderer_path.parents:
            bundled_executable = parent / "native" / "poppler" / "Library" / "bin" / "pdftoppm.exe"
            if bundled_executable.is_file():
                renderer = str(bundled_executable)
                break
    output_prefix = pdf_path.with_name("map")
    arguments = [
        renderer,
        "-f",
        "1",
        "-l",
        "1",
        "-singlefile",
        "-png",
        "-r",
        "150",
        str(pdf_path),
        str(output_prefix),
    ]
    try:
        subprocess.run(arguments, check=True, capture_output=True, text=True)  # noqa: S603
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or str(exc)).strip()
        raise CorpusBuildError(f"Copernicus map render failed: {message}") from exc
    rendered = output_prefix.with_suffix(".png")
    if not rendered.is_file():
        raise CorpusBuildError(f"missing rendered map for {pdf_path}")
    with Image.open(rendered) as image:
        image.verify()
    return rendered


def _nasa_url(day: date, layer: str) -> str:
    query = urlencode(
        {
            "REQUEST": "GetSnapshot",
            "TIME": f"{day.isoformat()}T00:00:00Z",
            "BBOX": NASA_BBOX,
            "CRS": "EPSG:4326",
            "LAYERS": layer,
            "FORMAT": "image/jpeg",
            "WIDTH": "1200",
            "HEIGHT": "1200",
        }
    )
    return f"{NASA_SNAPSHOT_API}?{query}"


def _common_row(day: date, *, element_id: str, group_index: int) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "corpus_id": CORPUS_ID,
        "element_id": element_id,
        "group_date": day.isoformat(),
        "group_index": group_index,
        "evaluation_role": "operational_model_evaluation",
        "training_membership": False,
        "excluded_from_training": True,
        "human_validation_required": True,
        "validation_status": "awaiting_human_validation",
        "evaluation_result_publication_status": "not_published_awaiting_human_validation",
    }


def _file_metadata(path: Path, corpus_root: Path) -> dict[str, Any]:
    return {
        "local_path": path.relative_to(corpus_root).as_posix(),
        "sha256": _sha256_file(path),
        "byte_count": path.stat().st_size,
    }


def _image_metadata(path: Path, corpus_root: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        width, height = image.size
        image_format = image.format
        image.verify()
    return {
        **_file_metadata(path, corpus_root),
        "width": width,
        "height": height,
        "image_format": image_format,
    }


def _image_is_informative(path: Path) -> bool:
    with Image.open(path) as image:
        grayscale = image.convert("L").resize((64, 64))
        low, high = grayscale.getextrema()
        standard_deviation = ImageStat.Stat(grayscale).stddev[0]
    return high >= 16 and high - low >= 8 and standard_deviation >= 2


def _build_day_rows(
    *,
    day: date,
    day_root: Path,
    corpus_root: Path,
    product: Mapping[str, Any],
    nasa_assets: list[tuple[str, str, str, Path]],
    map_pdf: Path,
    map_png: Path,
    geometry_path: Path,
    metadata_path: Path,
    spatial_reference_path: Path,
) -> list[dict[str, Any]]:
    acquisition_time = str(product["images"][0]["acquisitionTime"])
    rows: list[dict[str, Any]] = []
    for index, (profile, layer, url, path) in enumerate(nasa_assets, start=1):
        rows.append(
            {
                **_common_row(
                    day,
                    element_id=f"{day.isoformat()}-nasa-{index:02d}",
                    group_index=index,
                ),
                "kind": "satellite_image",
                "media_type": "satellite_image",
                "captured_at": f"{day.isoformat()}T00:00:00Z",
                "source_id": "nasa-worldview-snapshots",
                "source_profile": profile,
                "source_layer": layer,
                "source_url": url,
                "source_asset_publication_status": "publishable_with_attribution",
                "license_basis": "NASA full and open data sharing policy",
                "license_url": NASA_TERMS_URL,
                "attribution": "NASA Worldview Snapshots",
                **_image_metadata(path, corpus_root),
            }
        )
    copernicus_common = {
        "captured_at": acquisition_time,
        "source_id": ACTIVATION_CODE,
        "activation_url": ACTIVATION_PAGE,
        "product_type": product["type"],
        "monitoring_number": product["monitoringNumber"],
        "source_asset_publication_status": "publishable_with_attribution",
        "license_basis": "CEMS On-Demand Mapping free full and open access",
        "license_url": CEMS_TERMS_URL,
        "citation_url": CEMS_CITATION_URL,
        "attribution": (
            f"European Union, Copernicus Emergency Management Service, {ACTIVATION_CODE}"
        ),
    }
    rows.extend(
        [
            {
                **_common_row(
                    day,
                    element_id=f"{day.isoformat()}-copernicus-map-pdf",
                    group_index=6,
                ),
                "kind": "map_pdf",
                "media_type": "document",
                "source_url": product["downloadPath"],
                **copernicus_common,
                **_file_metadata(map_pdf, corpus_root),
            },
            {
                **_common_row(
                    day,
                    element_id=f"{day.isoformat()}-copernicus-map-image",
                    group_index=7,
                ),
                "kind": "map_image",
                "media_type": "satellite_image",
                "source_url": product["downloadPath"],
                "derived_from": map_pdf.relative_to(corpus_root).as_posix(),
                "derivation": "first PDF page rendered at 150 DPI with pdftoppm",
                **copernicus_common,
                **_image_metadata(map_png, corpus_root),
            },
            {
                **_common_row(
                    day,
                    element_id=f"{day.isoformat()}-copernicus-event-geometry",
                    group_index=8,
                ),
                "kind": "event_geometry",
                "media_type": "geojson_gzip",
                "source_url": product["downloadPath"],
                "storage_encoding": "gzip",
                "content_type": "application/geo+json",
                **copernicus_common,
                **_file_metadata(geometry_path, corpus_root),
            },
            {
                **_common_row(
                    day,
                    element_id=f"{day.isoformat()}-copernicus-product-metadata",
                    group_index=9,
                ),
                "kind": "product_metadata",
                "media_type": "json",
                "source_url": ACTIVATION_API,
                **copernicus_common,
                **_file_metadata(metadata_path, corpus_root),
            },
            {
                **_common_row(
                    day,
                    element_id=f"{day.isoformat()}-fireviewer-spatial-reference",
                    group_index=10,
                ),
                "kind": "signed_spatial_reference",
                "media_type": "spatial_package_reference",
                "source_id": SPATIAL_PACKAGE["package_id"],
                "source_url": SPATIAL_PACKAGE["url"],
                "source_asset_publication_status": "public_release_reference",
                "license_basis": "signed package provenance and attribution",
                "attribution": "IGN sources - see the signed FireViewer package provenance",
                **_file_metadata(spatial_reference_path, corpus_root),
                "referenced_asset_sha256": SPATIAL_PACKAGE["sha256"],
                "referenced_asset_byte_count": SPATIAL_PACKAGE["byte_count"],
                "referenced_asset_downloaded": False,
            },
        ]
    )
    if len(rows) != 10 or [row["group_index"] for row in rows] != list(range(1, 11)):
        raise CorpusBuildError(f"daily group invariant failed for {day.isoformat()}")
    if sum(row["kind"] in {"satellite_image", "map_image"} for row in rows) != 6:
        raise CorpusBuildError(f"image-count invariant failed for {day.isoformat()}")
    if day_root != map_pdf.parents[1]:
        raise CorpusBuildError("day-root invariant failed")
    return rows


def _article_item(input_id: str, captured_at: str, text: str) -> dict[str, Any]:
    return {
        "input_id": input_id,
        "media_type": "article",
        "metadata": {"captured_at": captured_at},
        "article_text": text,
    }


def build_worker_payload(day: date, rows: list[Mapping[str, Any]]) -> dict[str, Any]:
    if len(rows) != 10:
        raise CorpusBuildError("worker payload requires one complete ten-element group")
    items: list[dict[str, Any]] = []
    for row in rows:
        captured_at = str(row.get("captured_at", f"{day.isoformat()}T00:00:00Z"))
        if row["kind"] == "satellite_image":
            items.append(
                {
                    "input_id": row["element_id"],
                    "media_type": "satellite_image",
                    "working_file_url": row["source_url"],
                    "metadata": {
                        "captured_at": captured_at,
                        "latitude": 44.7019978646399,
                        "longitude": 5.338182141082767,
                        "gps_accuracy_m": 15_000,
                        "location_origin": "EXPLICIT_SOURCE_GEOMETRY",
                    },
                }
            )
            continue
        summary = (
            f"FireWarning operational evaluation element {row['element_id']}. "
            f"Kind: {row['kind']}. Source: {row['source_id']}. "
            f"Local artifact: {row.get('local_path', 'reference only')}. "
            "This incident is excluded from training and every result requires human review."
        )
        items.append(_article_item(str(row["element_id"]), captured_at, summary))
    return {
        "schema_version": "1.0",
        "batch_id": f"die-pontaix-{day.isoformat()}-evaluation",
        "batch_type": "satellite_media",
        "priority": "scheduled",
        "items": items,
    }


def _plan_from_sources(
    client: httpx.Client,
    activation: Mapping[str, Any],
) -> dict[str, Any]:
    products = _products_by_acquisition_day(activation)
    rows = []
    total = 0
    for day in EXPECTED_DAYS:
        product = products[day]
        size = _remote_size(client, str(product["downloadPath"]))
        if size > MAX_PRODUCT_ARCHIVE_BYTES:
            raise CorpusBuildError(f"Copernicus archive is too large for {day.isoformat()}")
        total += size
        rows.append(
            {
                "date": day.isoformat(),
                "product_type": product["type"],
                "monitoring_number": product["monitoringNumber"],
                "source_sensor": product["images"][0]["sensorName"],
                "acquisition_time": product["images"][0]["acquisitionTime"],
                "archive_url": product["downloadPath"],
                "archive_bytes": size,
            }
        )
    if total > MAX_TOTAL_ARCHIVE_BYTES:
        raise CorpusBuildError("selected Copernicus archives exceed the total size cap")
    return {
        "schema_version": 1,
        "corpus_id": CORPUS_ID,
        "activation_code": ACTIVATION_CODE,
        "activation_sensitive": activation["sensitive"],
        "grouping_basis": "source image acquisition date",
        "groups": rows,
        "group_count": len(rows),
        "elements_per_group": 10,
        "images_per_group": 6,
        "nasa_images_per_group": NASA_IMAGES_PER_DAY,
        "copernicus_archives_total_bytes": total,
        "full_products_archive_downloaded": False,
        "spatial_package_downloaded": False,
        "training_membership": False,
    }


def _corpus_readme() -> str:
    return f"""# {CORPUS_ID}

Corpus local d'evaluation operationnelle de l'incendie Die-Pontaix 2026.

- six groupes classes par date d'acquisition source ;
- dix elements distincts par groupe, dont cinq vues NASA et une carte Copernicus rendue en PNG ;
- produits CEMS {ACTIVATION_CODE} publics avec attribution ;
- package 3D FireViewer reference par URL, taille et SHA-256, sans copie de ses 401 Mo ;
- aucune archive ZIP conservee ;
- `training_membership=false` sans exception ;
- resultats non publies avant validation humaine.

Les payloads RunPod contiennent cinq images NASA publiques et cinq contextes textuels. La carte
Copernicus PNG locale devra etre envoyee au stockage media prive du backend pour devenir une entree
visuelle du worker ; elle n'est jamais embarquee dans Docker ou GitHub.
"""


def build(dataset_root: Path, *, replace: bool = False) -> dict[str, Any]:
    dataset_root = dataset_root.resolve()
    corpus_root = dataset_root / "corpus" / CORPUS_ID
    complete_report = corpus_root / "build-report.json"
    if complete_report.is_file() and not replace:
        report = json.loads(complete_report.read_text(encoding="utf-8"))
        if report.get("build_complete") is True:
            return report
        raise CorpusBuildError(f"incomplete existing corpus must be reviewed: {corpus_root}")
    if corpus_root.exists() and not replace:
        raise CorpusBuildError(f"existing corpus directory must be reviewed: {corpus_root}")

    staging = corpus_root.with_name(f".{CORPUS_ID}.staging")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    archives_root = staging / ".archives"
    all_rows: list[dict[str, Any]] = []
    try:
        with httpx.Client(follow_redirects=True, timeout=90) as client:
            activation = _fetch_activation(client)
            plan = _plan_from_sources(client, activation)
            products = _products_by_acquisition_day(activation)
            _write_json(staging / "acquisition-plan.json", plan)
            spatial_reference = staging / "spatial-reference.json"
            _write_json(spatial_reference, SPATIAL_PACKAGE)
            for day in EXPECTED_DAYS:
                product = products[day]
                day_root = staging / "days" / day.isoformat()
                archive = archives_root / f"{day.isoformat()}-copernicus.zip"
                expected_size = next(
                    row["archive_bytes"] for row in plan["groups"] if row["date"] == day.isoformat()
                )
                downloaded = _download(
                    client,
                    str(product["downloadPath"]),
                    archive,
                    max_bytes=MAX_PRODUCT_ARCHIVE_BYTES,
                    expected_content_type="application/zip",
                )
                if downloaded != expected_size:
                    raise CorpusBuildError(f"Copernicus archive size changed for {day.isoformat()}")
                map_pdf, geometry_path = _extract_selected_product(archive, day_root)
                archive.unlink()
                map_png = _render_pdf(map_pdf)
                metadata_path = day_root / "copernicus" / "product-metadata.json"
                _write_json(
                    metadata_path,
                    {
                        "activation_code": ACTIVATION_CODE,
                        "aoi": activation["aois"][0]["name"],
                        "activation_sensitive": activation["sensitive"],
                        "activation_closed": activation["closed"],
                        "centroid": activation["centroid"],
                        "extent": product["extent"],
                        "product": product,
                    },
                )
                nasa_assets: list[tuple[str, str, str, Path]] = []
                rejected_nasa_profiles: list[str] = []
                for profile, layer in NASA_LAYER_PROFILES:
                    if len(nasa_assets) == NASA_IMAGES_PER_DAY:
                        break
                    url = _nasa_url(day, layer)
                    slot = len(nasa_assets) + 1
                    image_path = day_root / "nasa" / f"{slot:02d}-{profile}.jpg"
                    _download(
                        client,
                        url,
                        image_path,
                        max_bytes=MAX_NASA_IMAGE_BYTES,
                        expected_content_type="image/jpeg",
                    )
                    with Image.open(image_path) as image:
                        if image.size != (1200, 1200):
                            raise CorpusBuildError(f"unexpected NASA dimensions for {image_path}")
                        image.verify()
                    if not _image_is_informative(image_path):
                        image_path.unlink()
                        rejected_nasa_profiles.append(profile)
                        continue
                    nasa_assets.append((profile, layer, url, image_path))
                if len(nasa_assets) != NASA_IMAGES_PER_DAY:
                    raise CorpusBuildError(
                        f"only {len(nasa_assets)} informative NASA images for {day.isoformat()}"
                    )
                _write_json(
                    day_root / "nasa" / "selection-report.json",
                    {
                        "selected_profiles": [asset[0] for asset in nasa_assets],
                        "rejected_empty_profiles": rejected_nasa_profiles,
                    },
                )
                all_rows.extend(
                    _build_day_rows(
                        day=day,
                        day_root=day_root,
                        corpus_root=staging,
                        product=product,
                        nasa_assets=nasa_assets,
                        map_pdf=map_pdf,
                        map_png=map_png,
                        geometry_path=geometry_path,
                        metadata_path=metadata_path,
                        spatial_reference_path=spatial_reference,
                    )
                )
        archives_root.rmdir()
        _write_jsonl(staging / "manifest.jsonl", all_rows)
        for day in EXPECTED_DAYS:
            day_rows = [row for row in all_rows if row["group_date"] == day.isoformat()]
            _write_json(
                staging / "worker-payloads" / f"{day.isoformat()}.json",
                build_worker_payload(day, day_rows),
            )
        (staging / "README.md").write_text(_corpus_readme(), encoding="utf-8", newline="\n")
        total_bytes = sum(path.stat().st_size for path in staging.rglob("*") if path.is_file())
        report = {
            "schema_version": 1,
            "corpus_id": CORPUS_ID,
            "build_complete": True,
            "dataset_root": str(dataset_root),
            "manifest_relpath": "manifest.jsonl",
            "manifest_rows": len(all_rows),
            "manifest_sha256": _sha256_file(staging / "manifest.jsonl"),
            "group_count": len(EXPECTED_DAYS),
            "group_dates": [day.isoformat() for day in EXPECTED_DAYS],
            "elements_per_group": 10,
            "images_per_group": 6,
            "nasa_images_per_group": 5,
            "copernicus_map_images_per_group": 1,
            "ground_level_open_licensed_images": 0,
            "ground_level_image_gap": (
                "No Die 2026 ground photo with verified production/open redistribution terms "
                "was found; press and unlicensed web photos were not downloaded."
            ),
            "training_membership": False,
            "excluded_from_training": True,
            "human_validation_required": True,
            "double_validation_complete": False,
            "deployment_ready": False,
            "evaluation_results_publishable_after_human_validation": True,
            "current_publication_status": "not_published_awaiting_human_validation",
            "source_assets_redistributable_with_attribution": True,
            "archives_deleted": True,
            "full_copernicus_products_archive_downloaded": False,
            "spatial_package_downloaded": False,
            "spatial_package_reuse": "signed_reference_only",
            "worker_payload_count": len(EXPECTED_DAYS),
            "worker_payload_visual_items_per_day": 5,
            "worker_payload_context_items_per_day": 5,
            "artifact_bytes_excluding_build_report": total_bytes,
            "rejected_ground_sources": [
                "commercial press photo libraries",
                "news galleries without an open redistribution licence",
                "community photo pages without a verified production licence",
            ],
        }
        _write_json(staging / "build-report.json", report)
        corpus_root.parent.mkdir(parents=True, exist_ok=True)
        if replace and corpus_root.exists():
            previous = corpus_root.with_name(f".{CORPUS_ID}.previous")
            if previous.exists():
                raise CorpusBuildError(f"previous corpus backup must be reviewed: {previous}")
            os.replace(corpus_root, previous)
            try:
                os.replace(staging, corpus_root)
            except Exception:
                os.replace(previous, corpus_root)
                raise
            shutil.rmtree(previous)
        else:
            os.replace(staging, corpus_root)
        return report
    except Exception:
        if archives_root.exists():
            for archive in archives_root.glob("*.zip*"):
                archive.unlink(missing_ok=True)
        raise


def plan() -> dict[str, Any]:
    with httpx.Client(follow_redirects=True, timeout=60) as client:
        activation = _fetch_activation(client)
        return _plan_from_sources(client, activation)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("plan")
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--dataset-root", type=Path, required=True)
    build_parser.add_argument("--replace", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    report = plan() if args.command == "plan" else build(args.dataset_root, replace=args.replace)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
