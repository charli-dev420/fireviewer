"""Export a faithful near-view GLB for Microsoft 3D Viewer validation."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import laspy
import numpy as np
import trimesh

from produce import SOURCE_SPACING_METRES, exact_grid, find_tile_bounds, source_records
from produce_point_splats import ORTHOPHOTO_PIXEL_METRES, orthophoto_rgb


VISIBLE_POINT_CLASSES = (3, 4, 5, 6)
VEGETATION_CLASSES = (3, 4, 5)


def parse_bounds(value: str) -> tuple[float, float, float, float]:
    values = tuple(float(item) for item in value.split(","))
    if len(values) != 4:
        raise argparse.ArgumentTypeError("Bounds must be xmin,ymin,xmax,ymax")
    if values[2] <= values[0] or values[3] <= values[1]:
        raise argparse.ArgumentTypeError("Bounds must have positive width and height")
    return values


def mesh_faces(rows: int, columns: int) -> np.ndarray:
    grid = np.arange(rows * columns, dtype=np.uint32).reshape(rows, columns)
    lower_left = grid[:-1, :-1].ravel()
    lower_right = grid[:-1, 1:].ravel()
    upper_left = grid[1:, :-1].ravel()
    upper_right = grid[1:, 1:].ravel()
    return np.column_stack((
        np.column_stack((lower_left, upper_left, lower_right)),
        np.column_stack((lower_right, upper_left, upper_right)),
    )).reshape(-1, 3)


def rgba(rgb: np.ndarray) -> np.ndarray:
    alpha = np.full((*rgb.shape[:-1], 1), 255, dtype=np.uint8)
    return np.concatenate((rgb.astype(np.uint8, copy=False), alpha), axis=-1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-project", required=True, type=Path)
    parser.add_argument("--tile-id", required=True)
    parser.add_argument("--copc", required=True, type=Path)
    parser.add_argument("--orthophoto", required=True, type=Path)
    parser.add_argument("--bounds", required=True, type=parse_bounds)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    source_project = args.source_project.resolve()
    tile_bounds = find_tile_bounds(source_project, args.tile_id)
    xmin, ymin, xmax, ymax = args.bounds
    if xmin < tile_bounds[0] or ymin < tile_bounds[1] or xmax > tile_bounds[2] or ymax > tile_bounds[3]:
        raise ValueError("Validation bounds must stay inside the source tile")
    mns_paths, _ = source_records(source_project, "mns", tile_bounds)
    mns = exact_grid(mns_paths, tile_bounds)
    colours = orthophoto_rgb(args.orthophoto.resolve(), tile_bounds)
    row0 = int(round((ymin - tile_bounds[1]) / SOURCE_SPACING_METRES))
    row1 = int(round((ymax - tile_bounds[1]) / SOURCE_SPACING_METRES))
    column0 = int(round((xmin - tile_bounds[0]) / SOURCE_SPACING_METRES))
    column1 = int(round((xmax - tile_bounds[0]) / SOURCE_SPACING_METRES))
    heights = mns[row0 : row1 + 1, column0 : column1 + 1].astype(np.float64)
    vertical_origin = float(math.floor(float(heights.min())))
    east = np.linspace(0.0, xmax - xmin, heights.shape[1], dtype=np.float64)
    north = np.linspace(0.0, ymax - ymin, heights.shape[0], dtype=np.float64)
    east_grid, north_grid = np.meshgrid(east, north)
    vertices = np.column_stack((east_grid.ravel(), (heights - vertical_origin).ravel(), north_grid.ravel()))
    ortho_factor = SOURCE_SPACING_METRES / ORTHOPHOTO_PIXEL_METRES
    colour_row0 = int(round(row0 * ortho_factor))
    colour_column0 = int(round(column0 * ortho_factor))
    colour_rows = colour_row0 + np.arange(heights.shape[0]) * int(round(ortho_factor))
    colour_columns = colour_column0 + np.arange(heights.shape[1]) * int(round(ortho_factor))
    mesh_colours = colours[np.ix_(colour_rows, colour_columns)]
    surface = trimesh.Trimesh(
        vertices=vertices,
        faces=mesh_faces(*heights.shape),
        vertex_colors=rgba(mesh_colours).reshape(-1, 4),
        process=False,
        validate=False,
    )
    surface.metadata.update({
        "name": "MNS LiDAR HD 0.50 m + orthophoto IGN",
        "crs": "EPSG:2154",
        "vertical_datum": "NGF-IGN69",
        "vertical_origin_metres": vertical_origin,
    })

    tile_x_raw = int(round(tile_bounds[0] / 0.01))
    tile_ymax_raw = int(round(tile_bounds[3] / 0.01))
    crop_xmin_raw = int(round(xmin / 0.01))
    crop_ymin_raw = int(round(ymin / 0.01))
    crop_xmax_raw = int(round(xmax / 0.01))
    crop_ymax_raw = int(round(ymax / 0.01))
    pixel_raw = int(round(ORTHOPHOTO_PIXEL_METRES / 0.01))
    points_by_layer: dict[str, list[np.ndarray]] = {"vegetation": [], "buildings": []}
    colours_by_layer: dict[str, list[np.ndarray]] = {"vegetation": [], "buildings": []}
    class_counts: dict[int, int] = {value: 0 for value in VISIBLE_POINT_CLASSES}
    with laspy.open(args.copc.resolve()) as reader:
        for points in reader.chunk_iterator(1_000_000):
            x_raw = np.asarray(points.X, dtype=np.int64)
            y_raw = np.asarray(points.Y, dtype=np.int64)
            z_raw = np.asarray(points.Z, dtype=np.int64)
            classification = np.asarray(points.classification, dtype=np.uint8)
            inside = (
                (x_raw >= crop_xmin_raw) & (x_raw <= crop_xmax_raw)
                & (y_raw >= crop_ymin_raw) & (y_raw <= crop_ymax_raw)
                & np.isin(classification, VISIBLE_POINT_CLASSES)
            )
            if not np.any(inside):
                continue
            x_raw = x_raw[inside]
            y_raw = y_raw[inside]
            z_raw = z_raw[inside]
            classification = classification[inside]
            colour_columns = np.clip((x_raw - tile_x_raw) // pixel_raw, 0, colours.shape[1] - 1)
            colour_rows = np.clip((tile_ymax_raw - y_raw) // pixel_raw, 0, colours.shape[0] - 1)
            sampled_colours = colours[colour_rows, colour_columns]
            local = np.column_stack((
                x_raw * 0.01 - xmin,
                z_raw * 0.01 - vertical_origin,
                y_raw * 0.01 - ymin,
            )).astype(np.float32)
            for value in VISIBLE_POINT_CLASSES:
                class_counts[value] += int(np.count_nonzero(classification == value))
            vegetation = np.isin(classification, VEGETATION_CLASSES)
            if np.any(vegetation):
                points_by_layer["vegetation"].append(local[vegetation])
                colours_by_layer["vegetation"].append(sampled_colours[vegetation])
            buildings = classification == 6
            if np.any(buildings):
                points_by_layer["buildings"].append(local[buildings])
                colours_by_layer["buildings"].append(sampled_colours[buildings])

    scene = trimesh.Scene(base_frame="Die_g08_validation")
    scene.add_geometry(surface, geom_name="MNS exact", node_name="Terrain, routes et toitures — MNS exact")
    point_counts: dict[str, int] = {}
    for layer, label in (("vegetation", "Retours LiDAR vegetation classes 3-5"), ("buildings", "Retours LiDAR batiments classe 6")):
        layer_points = np.concatenate(points_by_layer[layer]) if points_by_layer[layer] else np.empty((0, 3), dtype=np.float32)
        layer_colours = np.concatenate(colours_by_layer[layer]) if colours_by_layer[layer] else np.empty((0, 3), dtype=np.uint8)
        point_counts[layer] = len(layer_points)
        if len(layer_points):
            cloud = trimesh.points.PointCloud(vertices=layer_points, colors=rgba(layer_colours))
            scene.add_geometry(cloud, geom_name=label, node_name=label)
    scene.metadata.update({
        "source": "IGN LiDAR HD classified COPC + MNS 0.50 m + IGN orthophoto",
        "bounds_l93_metres": list(args.bounds),
        "vertical_origin_ngf_ign69_metres": vertical_origin,
        "point_fidelity": "all source returns in classes 3, 4, 5 and 6 inside the validation bounds",
        "synthetic_geometry_added": False,
    })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(scene.export(file_type="glb"))
    result = {
        "status": "ok",
        "output": str(args.output.resolve()),
        "byte_count": args.output.stat().st_size,
        "bounds_l93_metres": list(args.bounds),
        "surface_vertices": int(len(surface.vertices)),
        "surface_triangles": int(len(surface.faces)),
        "point_counts": point_counts,
        "class_counts": class_counts,
        "vertical_origin_ngf_ign69_metres": vertical_origin,
        "synthetic_geometry_added": False,
    }
    args.output.with_suffix(".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
