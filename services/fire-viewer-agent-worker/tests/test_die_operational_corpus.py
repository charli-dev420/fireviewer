from __future__ import annotations

import gzip
import io
import json
import zipfile
from datetime import date

import pytest
from training.die_operational_corpus import (
    CORPUS_ID,
    EXPECTED_DAYS,
    NASA_IMAGES_PER_DAY,
    NASA_LAYER_PROFILES,
    CorpusBuildError,
    _extract_selected_product,
    _image_is_informative,
    _products_by_acquisition_day,
    _select_product_members,
    build_worker_payload,
)


def _activation() -> dict[str, object]:
    products = []
    for index, day in enumerate(EXPECTED_DAYS):
        products.append(
            {
                "feasible": True,
                "type": "DEL",
                "monitoringNumber": index,
                "downloadPath": f"https://example.test/{day}.zip",
                "images": [
                    {
                        "acquisitionTime": f"{day.isoformat()}T10:00:00Z",
                        "sensorName": "test",
                    }
                ],
            }
        )
    return {"aois": [{"products": products}]}


def test_operational_plan_has_six_days_and_five_nasa_views() -> None:
    products = _products_by_acquisition_day(_activation())

    assert tuple(products) == EXPECTED_DAYS
    assert NASA_IMAGES_PER_DAY == 5
    assert len(NASA_LAYER_PROFILES) > NASA_IMAGES_PER_DAY
    assert CORPUS_ID.startswith("die-pontaix-operational-evaluation-")


def test_duplicate_acquisition_day_is_rejected() -> None:
    activation = _activation()
    activation["aois"][0]["products"].append(activation["aois"][0]["products"][0])

    with pytest.raises(CorpusBuildError, match="multiple products"):
        _products_by_acquisition_day(activation)


def test_zip_selection_keeps_only_map_and_event_area() -> None:
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("Maps/EMSR890_map_v1.pdf", b"pdf")
        archive.writestr(
            "EMSR890_observedEventA_v1.json", json.dumps({"type": "FeatureCollection"})
        )
        archive.writestr("EMSR890_observedEventP_v1.json", "{}")
        archive.writestr("EMSR890_v1.gpkg", b"unused")
    payload.seek(0)

    with zipfile.ZipFile(payload) as archive:
        map_member, geometry_member = _select_product_members(archive)

    assert map_member.filename.endswith(".pdf")
    assert geometry_member.filename.endswith("_observedEventA_v1.json")


def test_zip_selection_rejects_path_traversal() -> None:
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("../escape.pdf", b"bad")
        archive.writestr("Maps/map.pdf", b"pdf")
        archive.writestr("event_observedEventA_v1.json", "{}")
    payload.seek(0)

    with zipfile.ZipFile(payload) as archive, pytest.raises(CorpusBuildError, match="unsafe path"):
        _select_product_members(archive)


def test_selected_geometry_is_stored_as_deterministic_gzip(tmp_path) -> None:
    archive_path = tmp_path / "product.zip"
    geometry = json.dumps({"type": "FeatureCollection", "features": []}).encode()
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("Maps/map.pdf", b"pdf")
        archive.writestr("event_observedEventA_v1.json", geometry)

    _, geometry_path = _extract_selected_product(archive_path, tmp_path / "day")

    assert geometry_path.name == "observed-event.geojson.gz"
    assert gzip.decompress(geometry_path.read_bytes()) == geometry


def test_worker_payload_keeps_ten_items_and_only_nasa_urls() -> None:
    day = date(2026, 7, 8)
    rows = []
    for index in range(1, 11):
        nasa = index <= 5
        rows.append(
            {
                "element_id": f"item-{index}",
                "kind": "satellite_image" if nasa else "product_metadata",
                "source_id": "nasa" if nasa else "EMSR890",
                "source_url": (
                    f"https://wvs.earthdata.nasa.gov/api/v1/snapshot?item={index}"
                    if nasa
                    else "https://example.test/product.zip"
                ),
                "captured_at": "2026-07-08T00:00:00Z",
                "local_path": f"items/{index}",
            }
        )

    payload = build_worker_payload(day, rows)

    assert payload["batch_type"] == "satellite_media"
    assert len(payload["items"]) == 10
    assert sum("working_file_url" in item for item in payload["items"]) == 5
    assert sum("article_text" in item for item in payload["items"]) == 5


def test_empty_nasa_snapshot_is_rejected(tmp_path) -> None:
    empty = tmp_path / "empty.jpg"
    useful = tmp_path / "useful.jpg"
    from PIL import Image

    Image.new("RGB", (64, 64), color=(0, 0, 0)).save(empty)
    image = Image.new("RGB", (64, 64), color=(20, 20, 20))
    for coordinate in range(16, 48):
        image.putpixel((coordinate, coordinate), (220, 220, 220))
    image.save(useful)

    assert _image_is_informative(empty) is False
    assert _image_is_informative(useful) is True
