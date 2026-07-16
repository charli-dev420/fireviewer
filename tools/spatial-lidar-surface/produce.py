"""Export a native-resolution 3D surface directly from the IGN LiDAR MNS.

No semantic or procedural geometry is added. Every exported vertex altitude is
an original MNS sample. Lower LODs are strict subsets of the 0.50 m grid.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.fill import fillnodata
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
import trimesh
from trimesh.visual import ColorVisuals


PIPELINE_VERSION = "3.0.0-rc.1"
CHUNK_METRES = 250.0
SOURCE_SPACING_METRES = 0.5
LOD_SPECS = (
    (0, "mns", 1),
    (1, "mns", 2),
    (2, "mns", 4),
    (3, "mnt", 20),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-project", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--tile-id", default="DIE-08-T00-V33")
    parser.add_argument("--orthophoto", type=Path)
    parser.add_argument(
        "--lods",
        default="0,1,2,3",
        help="Comma-separated LOD levels to produce (default: 0,1,2,3).",
    )
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def find_tile_bounds(source_project: Path, tile_id: str) -> tuple[float, float, float, float]:
    manifest = read_json(
        source_project / "Assets" / "Generated" / "DiePontaix" / "die_pontaix_manifest.json"
    )
    for terrain in manifest.get("tiles", []):
        for vector in terrain.get("vector_tiles", []):
            if vector.get("tile_id") == tile_id:
                values = vector.get("bounds_l93_metres")
                if isinstance(values, list) and len(values) == 4:
                    return tuple(float(value) for value in values)
    raise KeyError(f"Unknown source tile: {tile_id}")


def source_records(
    source_project: Path,
    kind: str,
    bounds: tuple[float, float, float, float],
) -> tuple[list[Path], list[dict[str, Any]]]:
    source_root = source_project / "SourceData" / "IGN"
    manifest = read_json(source_root / "manifests" / "ign_sources.v1.json")
    records = manifest.get("rasters", {}).get(kind, {})
    if not isinstance(records, dict):
        raise ValueError(f"Missing {kind} records in source manifest")
    selected: list[dict[str, Any]] = []
    paths: list[Path] = []
    xmin, ymin, xmax, ymax = bounds
    for record in records.values():
        record_bounds = record.get("bounds_l93_metres")
        if not isinstance(record_bounds, list) or len(record_bounds) != 4:
            continue
        left, bottom, right, top = (float(value) for value in record_bounds)
        if right < xmin or left > xmax or top < ymin or bottom > ymax:
            continue
        path = source_root / str(record["local_path"])
        if not path.is_file():
            raise FileNotFoundError(path)
        selected.append(record)
        paths.append(path)
    if not paths:
        raise FileNotFoundError(f"No {kind} raster intersects {bounds}")
    return paths, selected


def exact_grid(
    paths: list[Path],
    bounds: tuple[float, float, float, float],
    *,
    fill_source_nodata: bool = False,
    repair_report: dict[str, Any] | None = None,
) -> np.ndarray:
    datasets = [rasterio.open(path) for path in paths]
    try:
        for dataset in datasets:
            projection = dataset.crs.to_dict() if dataset.crs is not None else {}
            is_lambert_93 = (
                projection.get("proj") == "lcc"
                and math.isclose(float(projection.get("lat_0", 0.0)), 46.5)
                and math.isclose(float(projection.get("lon_0", 0.0)), 3.0)
                and math.isclose(float(projection.get("x_0", 0.0)), 700000.0)
                and math.isclose(float(projection.get("y_0", 0.0)), 6600000.0)
            )
            if not is_lambert_93:
                raise ValueError(f"Unexpected CRS: {dataset.name}")
            if not math.isclose(dataset.transform.a, SOURCE_SPACING_METRES, abs_tol=1e-9):
                raise ValueError(f"Unexpected source resolution: {dataset.name}")
        mosaic, transform = merge(datasets, nodata=-9999.0)
    finally:
        for dataset in datasets:
            dataset.close()
    surface = np.asarray(mosaic[0], dtype=np.float32)
    xmin, ymin, xmax, ymax = bounds
    xs = np.arange(xmin, xmax + SOURCE_SPACING_METRES * 0.5, SOURCE_SPACING_METRES)
    ys = np.arange(ymin, ymax + SOURCE_SPACING_METRES * 0.5, SOURCE_SPACING_METRES)
    centre_x = transform.c + transform.a * 0.5
    centre_y = transform.f + transform.e * 0.5
    columns = np.rint((xs - centre_x) / transform.a).astype(np.int64)
    rows = np.rint((ys - centre_y) / transform.e).astype(np.int64)
    outside = (
        columns.min() < 0 or columns.max() >= surface.shape[1]
        or rows.min() < 0 or rows.max() >= surface.shape[0]
    )
    if outside and not fill_source_nodata:
        raise ValueError("The source mosaic does not contain every exact boundary sample")
    if outside:
        result = np.full((len(rows), len(columns)), -9999.0, dtype=np.float32)
        valid_rows = (rows >= 0) & (rows < surface.shape[0])
        valid_columns = (columns >= 0) & (columns < surface.shape[1])
        result[np.ix_(valid_rows, valid_columns)] = surface[
            np.ix_(rows[valid_rows], columns[valid_columns])
        ]
    else:
        result = surface[np.ix_(rows, columns)]
    if result.shape != (2001, 2001):
        raise ValueError(f"Expected a 2001 x 2001 native grid, got {result.shape}")
    valid = np.isfinite(result) & (result > -9990.0)
    repaired_count = int(result.size - np.count_nonzero(valid))
    if repaired_count:
        if not fill_source_nodata:
            raise ValueError("The native LiDAR grid contains missing or invalid samples")
        result = fillnodata(
            np.where(valid, result, 0.0).astype(np.float32),
            mask=valid.astype(np.uint8),
            max_search_distance=2001,
            smoothing_iterations=0,
        )
        if not np.isfinite(result).all() or np.any(result <= -9990.0):
            raise ValueError("The native LiDAR grid contains unrepairable NoData samples")
    if repair_report is not None:
        repair_report["repaired_sample_count"] = repaired_count
        repair_report["repair_method"] = (
            "rasterio inverse-distance fill from adjacent MNT samples"
            if repaired_count else "none"
        )
    return result


def grid_faces(size: int) -> np.ndarray:
    rows, columns = np.meshgrid(
        np.arange(size - 1, dtype=np.uint32),
        np.arange(size - 1, dtype=np.uint32),
        indexing="ij",
    )
    a = (rows * size + columns).ravel()
    b = a + 1
    c = a + size
    d = c + 1
    return np.column_stack((np.column_stack((a, b, d)), np.column_stack((a, d, c)))).reshape(-1, 3)


def orthophoto_grid(
    path: Path,
    bounds: tuple[float, float, float, float],
) -> np.ndarray:
    size = int(round((bounds[2] - bounds[0]) / SOURCE_SPACING_METRES)) + 1
    destination = np.zeros((3, size, size), dtype=np.uint8)
    destination_transform = from_origin(
        bounds[0] - SOURCE_SPACING_METRES * 0.5,
        bounds[3] + SOURCE_SPACING_METRES * 0.5,
        SOURCE_SPACING_METRES,
        SOURCE_SPACING_METRES,
    )
    with rasterio.open(path) as source:
        if source.count < 3 or source.crs is None:
            raise ValueError(f"Orthophoto must contain georeferenced RGB bands: {path}")
        for band in range(3):
            reproject(
                source=source.read(band + 1),
                destination=destination[band],
                src_transform=source.transform,
                src_crs=source.crs,
                dst_transform=destination_transform,
                dst_crs="EPSG:2154",
                resampling=Resampling.bilinear,
            )
    rgb = np.flip(destination, axis=1).transpose(1, 2, 0)
    if np.count_nonzero(rgb) < rgb.size * 0.75:
        raise RuntimeError(f"Orthophoto does not cover the requested LiDAR tile: {path}")
    return rgb


def surface_colours(heights: np.ndarray, spacing: float) -> np.ndarray:
    gradient_y, gradient_x = np.gradient(heights, spacing)
    slope = np.clip(np.hypot(gradient_x, gradient_y) / 2.5, 0.0, 1.0)
    normalized = (heights - np.percentile(heights, 2)) / max(
        float(np.percentile(heights, 98) - np.percentile(heights, 2)), 1.0
    )
    normalized = np.clip(normalized, 0.0, 1.0)
    shade = np.clip(0.48 + normalized * 0.32 - slope * 0.20, 0.22, 0.86)
    colours = np.stack((shade * 0.88, shade * 0.94, shade, np.ones_like(shade)), axis=-1)
    return np.asarray(np.rint(colours * 255.0), dtype=np.uint8)


def export_chunk(
    output: Path,
    heights: np.ndarray,
    chunk_bounds: tuple[float, float, float, float],
    height_origin: float,
    step: int,
    source_kind: str,
    colours: np.ndarray | None,
    native_spacing_metres: float = SOURCE_SPACING_METRES,
) -> dict[str, Any]:
    sampled = heights[::step, ::step]
    spacing = native_spacing_metres * step
    size = sampled.shape[0]
    extent = chunk_bounds[2] - chunk_bounds[0]
    expected = int(round(extent / spacing)) + 1
    if sampled.shape != (expected, expected):
        raise ValueError(f"Unexpected LOD grid {sampled.shape}, expected {(expected, expected)}")
    xs = np.linspace(0.0, extent, size, dtype=np.float32)
    northings = np.linspace(0.0, extent, size, dtype=np.float32)
    xx, nn = np.meshgrid(xs, northings)
    vertices = np.column_stack((xx.ravel(), (sampled - height_origin).ravel(), -nn.ravel()))
    mesh = trimesh.Trimesh(vertices=vertices, faces=grid_faces(size), process=False, validate=False)
    if colours is None:
        vertex_colours = surface_colours(sampled, spacing)
    else:
        sampled_colours = colours[::step, ::step]
        alpha = np.full((*sampled_colours.shape[:2], 1), 255, dtype=np.uint8)
        vertex_colours = np.concatenate((sampled_colours, alpha), axis=2)
    mesh.visual = ColorVisuals(mesh=mesh, vertex_colors=vertex_colours.reshape(-1, 4))
    scene = trimesh.Scene()
    scene.add_geometry(mesh, node_name="lidar_surface", geom_name="lidar_surface")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(trimesh.exchange.gltf.export_glb(scene, include_normals=True))
    reloaded = trimesh.load(output, force="scene", process=False)
    exported = reloaded.geometry.get("lidar_surface")
    if exported is None:
        raise RuntimeError(f"Missing lidar_surface in {output}")
    recovered = np.asarray(exported.vertices)[:, 1] + height_origin
    maximum_error = float(np.max(np.abs(recovered - sampled.ravel())))
    if maximum_error > 1e-4:
        raise RuntimeError(f"Altitude round-trip error {maximum_error} m in {output}")
    return {
        "path": output.name,
        "geometry_source": source_kind,
        "spacing_metres": spacing,
        "vertex_count": int(len(mesh.vertices)),
        "triangle_count": int(len(mesh.faces)),
        "byte_count": output.stat().st_size,
        "sha256": sha256_file(output),
        "maximum_altitude_roundtrip_error_metres": maximum_error,
    }


def main() -> int:
    args = parse_args()
    try:
        requested_lods = sorted({int(value.strip()) for value in args.lods.split(",") if value.strip()})
    except ValueError as error:
        raise ValueError(f"Invalid --lods value: {args.lods!r}") from error
    available_lods = {lod for lod, _source, _step in LOD_SPECS}
    if not requested_lods or not set(requested_lods).issubset(available_lods):
        raise ValueError(f"--lods must select one or more of {sorted(available_lods)}")
    selected_specs = [spec for spec in LOD_SPECS if spec[0] in requested_lods]
    source_project = args.source_project.resolve()
    workspace = args.workspace.resolve()
    output = workspace / args.tile_id
    if output.exists():
        if not args.force:
            raise FileExistsError(f"Refusing to replace {output} without --force")
        shutil.rmtree(output)
    bounds = find_tile_bounds(source_project, args.tile_id)
    mns_paths, mns_records = source_records(source_project, "mns", bounds)
    mnt_paths, mnt_records = source_records(source_project, "mnt", bounds)
    for path, record in (*zip(mns_paths, mns_records), *zip(mnt_paths, mnt_records)):
        actual_hash = sha256_file(path)
        if actual_hash != record.get("sha256"):
            raise RuntimeError(f"Source hash mismatch: {path}")
    mns = exact_grid(mns_paths, bounds)
    mnt = exact_grid(mnt_paths, bounds)
    photo = orthophoto_grid(args.orthophoto.resolve(), bounds) if args.orthophoto else None
    height_origin = float(math.floor(float(np.min(mns))))
    chunks: list[dict[str, Any]] = []
    native_chunks: dict[tuple[int, int], np.ndarray] = {}
    samples_per_chunk = int(round(CHUNK_METRES / SOURCE_SPACING_METRES))
    for row in range(4):
        for column in range(4):
            start_row = row * samples_per_chunk
            start_column = column * samples_per_chunk
            native = mns[
                start_row : start_row + samples_per_chunk + 1,
                start_column : start_column + samples_per_chunk + 1,
            ]
            native_chunks[(row, column)] = native
            chunk_id = f"{args.tile_id}-C{row}{column}"
            chunk_root = output / "chunks" / chunk_id
            xmin = bounds[0] + column * CHUNK_METRES
            ymin = bounds[1] + row * CHUNK_METRES
            chunk_bounds = (xmin, ymin, xmin + CHUNK_METRES, ymin + CHUNK_METRES)
            native_mnt = mnt[
                start_row : start_row + samples_per_chunk + 1,
                start_column : start_column + samples_per_chunk + 1,
            ]
            native_photo = photo[
                start_row : start_row + samples_per_chunk + 1,
                start_column : start_column + samples_per_chunk + 1,
            ] if photo is not None else None
            lods = [
                export_chunk(
                    chunk_root / f"lod{lod}.glb",
                    native if source_kind == "mns" else native_mnt,
                    chunk_bounds,
                    height_origin,
                    step,
                    source_kind,
                    native_photo,
                )
                for lod, source_kind, step in selected_specs
            ]
            for record, (lod, _source_kind, _step) in zip(lods, selected_specs):
                record["lod_level"] = lod
            chunks.append({"chunk_id": chunk_id, "bounds_l93_metres": list(chunk_bounds), "lods": lods})
            print(f"[{len(chunks)}/16] {chunk_id}", flush=True)

    seam_error = 0.0
    for row in range(4):
        for column in range(3):
            seam_error = max(
                seam_error,
                float(np.max(np.abs(
                    native_chunks[(row, column)][:, -1]
                    - native_chunks[(row, column + 1)][:, 0]
                ))),
            )
    for row in range(3):
        for column in range(4):
            seam_error = max(
                seam_error,
                float(np.max(np.abs(
                    native_chunks[(row, column)][-1, :]
                    - native_chunks[(row + 1, column)][0, :]
                ))),
            )
    report = {
        "status": "ok",
        "pipeline_version": PIPELINE_VERSION,
        "tile_id": args.tile_id,
        "contract": {
            "geometry_source": "IGN LiDAR HD MNS native samples only",
            "synthetic_geometry_added": False,
            "grid_crs": "EPSG:2154",
            "vertical_datum": "NGF-IGN69",
            "source_spacing_metres": SOURCE_SPACING_METRES,
            "lod_policy": {
                "near": "MNS 0.50 m — every source sample",
                "medium": "MNS exact subsets at 1 m and 2 m",
                "far": "MNT 10 m ground surface for stable distant flats",
                "recommended_ranges_metres": {
                    "lod0": [0, 200],
                    "lod1": [160, 450],
                    "lod2": [380, 950],
                    "lod3": [850, None],
                },
                "transition": "cross-fade in overlap; 25 m hysteresis; adjacent chunks differ by at most one LOD",
            },
            "produced_lods": requested_lods,
            "mesh_axes": "local glTF (E, U, -N) metres",
            "height_origin_ngf_ign69_metres": height_origin,
        },
        "source": {
            "mns_files": [str(path) for path in mns_paths],
            "mnt_files": [str(path) for path in mnt_paths],
            "mns_manifest_sha256": sorted(record["sha256"] for record in mns_records),
            "mnt_manifest_sha256": sorted(record["sha256"] for record in mnt_records),
            "orthophoto": ({
                "path": str(args.orthophoto.resolve()),
                "sha256": sha256_file(args.orthophoto.resolve()),
                "service": "IGN Géoplateforme WMS-R",
                "layer": "ORTHOIMAGERY.ORTHOPHOTOS",
            } if args.orthophoto else None),
        },
        "checks": {
            "native_grid_shape": list(mns.shape),
            "native_sample_count": int(mns.size),
            "all_native_samples_finite": bool(np.isfinite(mns).all()),
            "chunk_count": len(chunks),
            "lod_count": sum(len(chunk["lods"]) for chunk in chunks),
            "maximum_internal_seam_error_metres": seam_error,
            "maximum_glb_altitude_roundtrip_error_metres": max(
                lod["maximum_altitude_roundtrip_error_metres"]
                for chunk in chunks for lod in chunk["lods"]
            ),
            "mns_height_range_ngf_ign69_metres": [float(np.min(mns)), float(np.max(mns))],
            "mns_minus_mnt_range_metres": [float(np.min(mns - mnt)), float(np.max(mns - mnt))],
            "synthetic_geometry_count": 0,
            "orthophoto_applied_as_colour_only": photo is not None,
        },
        "chunks": chunks,
    }
    write_json(output / "catalog.json", report)
    write_json(output / "quality-report.json", {"status": "ok", "checks": report["checks"]})
    print(json.dumps({"output": str(output), "checks": report["checks"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
