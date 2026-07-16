"""Build and verify the complete FireViewer global LOD Blender scene.

Run inside Blender's Python runtime. The scene indexes every ready 500 m tile,
materializes only the bounded near working set around Montmaur, and records the
exclusive global-2 m / detailed-0.5 m terrain contract.
"""

from __future__ import annotations

import importlib
import json
import math
import os
from pathlib import Path
import sys

import bpy


REPOSITORY = Path("D:/Dev/project/fireviewer")
MODULE_DIRECTORY = REPOSITORY / "tools/spatial-hybrid-zone/blender"
ARTIFACT_DIRECTORY = (
    REPOSITORY
    / ".artifacts/spatial-lidar-surface/justin-fire-2026-v1"
)
BASE_PACKAGE = (
    ARTIFACT_DIRECTORY / "blender/justin-global-control-v5-vector-lod.json.gz"
)
GLOBAL_ORTHOPHOTO = (
    ARTIFACT_DIRECTORY / "blender/justin-ign-orthophoto-2m-display-v2.source.json"
)
TILE_MANIFEST = ARTIFACT_DIRECTORY / "global-05m/production-manifest.json"
OUTPUT_BLEND = (
    ARTIFACT_DIRECTORY
    / "blender/justin-global-05m-lod-v2-vector-surface-complete.blend"
)
MONTMAUR_FOCUS_L93_M = (888_250.0, 6_400_250.0)
NEAR_VIEW_DISTANCE_M = 600.0
DETAIL_RADIUS_M = 750.0
MAXIMUM_RESIDENT_TILE_COUNT = 16
PERSISTENT_ADDON_MODULE = "fireviewer_spatial_lod_addon"
PERSISTENT_ADDON_ARCHIVE = (
    ARTIFACT_DIRECTORY / "blender/fireviewer-spatial-lod-addon-v1.zip"
)


def _reload_modules() -> tuple[object, object, object]:
    module_path = str(MODULE_DIRECTORY)
    if module_path not in sys.path:
        sys.path.insert(0, module_path)
    existing_runtime = sys.modules.get("blender_tile_streaming_runtime")
    if existing_runtime is not None:
        try:
            existing_runtime.unregister(bpy)
        except Exception:
            pass
    modules = {}
    for name in (
        "tiled_scene",
        "terrain_texture",
        "tree_instances",
        "detail_vector_lod",
        "global_terrain_context",
        "global_vector_context",
        "tile_streaming",
        "blender_tile_streaming_runtime",
        "final_scene_bootstrap",
        "build_control_scene",
    ):
        modules[name] = (
            importlib.reload(sys.modules[name])
            if name in sys.modules
            else importlib.import_module(name)
        )
    return (
        modules["tiled_scene"],
        modules["build_control_scene"],
        modules["final_scene_bootstrap"],
    )


def _terrain_edge_profile(
    terrain: object,
    *,
    axis: str,
    boundary_m: float,
) -> list[tuple[float, float]]:
    axis_index = 0 if axis == "x" else 1
    cross_index = 1 - axis_index
    return sorted(
        (
            round(float(vertex.co[cross_index]), 4),
            round(float(vertex.co.z), 4),
        )
        for vertex in terrain.data.vertices
        if math.isclose(
            float(vertex.co[axis_index]), boundary_m, abs_tol=1e-4
        )
    )


def _verify_loaded_detail_seams(
    manifest: dict[str, object],
    requested_tile_ids: list[str],
    origin: tuple[float, float, float],
) -> int:
    """Verify every resident neighbour pair uses one coincident XYZ edge."""

    selected = {
        str(tile["id"]): tile
        for tile in manifest["tiles"]
        if str(tile["id"]) in requested_tile_ids
    }
    by_minimum = {
        (float(tile["bounds_l93_m"][0]), float(tile["bounds_l93_m"][1])): tile_id
        for tile_id, tile in selected.items()
    }
    verified = 0
    for tile_id, tile in selected.items():
        min_x, min_y, max_x, max_y = (
            float(value) for value in tile["bounds_l93_m"]
        )
        terrain = bpy.data.objects[f"TerrainTile_{tile_id}"]
        for neighbour_key, axis, boundary in (
            ((max_x, min_y), "x", max_x - origin[0]),
            ((min_x, max_y), "y", max_y - origin[1]),
        ):
            neighbour_id = by_minimum.get(neighbour_key)
            if neighbour_id is None:
                continue
            neighbour = bpy.data.objects[f"TerrainTile_{neighbour_id}"]
            left = _terrain_edge_profile(
                terrain, axis=axis, boundary_m=boundary
            )
            right = _terrain_edge_profile(
                neighbour, axis=axis, boundary_m=boundary
            )
            if not left or left != right:
                raise AssertionError(
                    f"Detailed terrain seam mismatch: {tile_id} / {neighbour_id}"
                )
            verified += 1
    if verified == 0:
        raise AssertionError("No adjacent resident detail seam was verified")
    return verified


def build() -> Path:
    tiled_scene, build_control_scene, final_scene_bootstrap = _reload_modules()
    for path in (BASE_PACKAGE, GLOBAL_ORTHOPHOTO, TILE_MANIFEST):
        if not path.is_file():
            raise FileNotFoundError(path)

    manifest = tiled_scene.load_global_05m_manifest(TILE_MANIFEST)
    ready = tiled_scene.ready_tiles(manifest)
    if manifest.get("status") != "ready" or len(ready) != 475:
        raise AssertionError("The global production manifest is not 475/475 ready")
    requested_tile_ids = [
        str(tile["id"])
        for tile in ready
        if tiled_scene.tile_distance_to_point_m(
            tile["bounds_l93_m"], MONTMAUR_FOCUS_L93_M
        )
        <= DETAIL_RADIUS_M
    ]
    if not 1 <= len(requested_tile_ids) <= MAXIMUM_RESIDENT_TILE_COUNT:
        raise AssertionError(
            f"Montmaur working set has {len(requested_tile_ids)} detail tiles"
        )

    scene = build_control_scene.build_from_package(
        BASE_PACKAGE,
        None,
        orthophoto_source_path=GLOBAL_ORTHOPHOTO,
        tile_index_path=TILE_MANIFEST,
        tile_load_mode="visible",
        tile_focus_l93_m=MONTMAUR_FOCUS_L93_M,
        tile_visible_radius_m=DETAIL_RADIUS_M,
        scene_lod_view_distance_m=NEAR_VIEW_DISTANCE_M,
        scene_lod_near_max_m=1_500.0,
        scene_lod_far_min_m=6_000.0,
        scene_lod_detail_radius_m=DETAIL_RADIUS_M,
        maximum_resident_tile_count=MAXIMUM_RESIDENT_TILE_COUNT,
    )

    metadata = json.loads(scene["source_manifest_json"])
    building_statistics = metadata["buildings"]["extrusion"]
    if building_statistics["extruded_prism_count"] != 5_640:
        raise AssertionError("The complete building set was not generated")
    if building_statistics["not_extruded_no_positive_height_count"] != 0:
        raise AssertionError("Buildings are still missing from the global model")
    if building_statistics["raised_roof_prism_count"] != 673:
        raise AssertionError("The complete 2.70 m building correction is missing")
    if building_statistics["foundation_grounding"] != (
        "rendered_terrain_preview_per_boundary_vertex"
    ):
        raise AssertionError("Building foundations are not using the final MNT contract")
    if not math.isclose(
        building_statistics["minimum_visible_wall_height_m"], 2.70
    ):
        raise AssertionError("Building minimum visible wall contract is missing")
    building_surface_drape = building_statistics["active_render_surface_drape"]
    if building_surface_drape["maximum_boundary_segment_length_m"] > 5.001:
        raise AssertionError("Global building foundations are not sufficiently dense")
    if building_surface_drape["terrain_surface_sampling"] != (
        "fixed_nw_se_triangle_planes"
    ):
        raise AssertionError("Buildings are not grounded on the rendered triangles")

    if scene["global_05m_planned_tile_count"] != 475:
        raise AssertionError("The scene does not index the complete map")
    if scene["global_05m_ready_tile_count"] != 475:
        raise AssertionError("The scene does not expose every ready tile")
    if scene["global_05m_loaded_tile_count"] != len(requested_tile_ids):
        raise AssertionError("The bounded Montmaur working set was not loaded")
    if scene["global_05m_visible_tile_count"] != len(requested_tile_ids):
        raise AssertionError("Near LOD detail visibility is inconsistent")
    if scene["global_05m_maximum_resident_tile_count"] != 16:
        raise AssertionError("The resident detail budget is not recorded")
    if scene["scene_distance_lod_band"] != "near":
        raise AssertionError("The initial Blender view must use near LOD")
    if scene["scene_distance_lod_terrain_mode"] != (
        "detail_0m50_tiles_with_global_context"
    ):
        raise AssertionError("The initial Blender view must use detailed terrain")
    if scene["scene_distance_lod_global_terrain_visible"]:
        raise AssertionError("The monolithic global terrain overlaps detail")
    if not scene["scene_distance_lod_global_context_visible"]:
        raise AssertionError("The lightweight global context is absent near detail")
    if not scene["scene_distance_lod_global_context_coverage_complete"]:
        raise AssertionError("The lightweight global context cannot replace detail cells")
    if scene["scene_distance_lod_terrain_overlap_active"]:
        raise AssertionError("Two terrain surfaces are simultaneously active")
    if not scene["scene_distance_lod_detail_vector_coverage_complete"]:
        raise AssertionError("Near LOD vector coverage is incomplete")
    if not scene["scene_distance_lod_global_vector_context_coverage_complete"]:
        raise AssertionError("The global vector context cannot replace detail cells")
    if not scene["scene_distance_lod_global_vector_models_visible"]:
        raise AssertionError("Simple vector context is absent around near detail")
    if scene["scene_distance_lod_legacy_global_vector_models_visible"]:
        raise AssertionError("Legacy monolithic vectors overlap near detail")
    if not scene["scene_distance_lod_global_vector_context_visible"]:
        raise AssertionError("The partitioned vector context is hidden")
    if not scene["scene_distance_lod_detail_vector_models_visible"]:
        raise AssertionError("Near detail vector models are not visible")
    if scene["scene_distance_lod_vector_model_overlap_active"]:
        raise AssertionError("Two vector LODs are simultaneously active")
    if not scene["global_context_continuous_around_detail_tiles"]:
        raise AssertionError("The map is not continuous around the near working set")
    if not math.isclose(
        scene["scene_distance_lod_detail_required_coverage_radius_m"],
        720.0,
    ):
        raise AssertionError("The conservative near-view footprint is not recorded")
    if not math.isclose(scene["scene_distance_lod_near_max_m"], 1_500.0):
        raise AssertionError("Near LOD boundary mismatch")
    if not math.isclose(scene["scene_distance_lod_far_min_m"], 6_000.0):
        raise AssertionError("Far LOD boundary mismatch")
    if not math.isclose(scene["scene_distance_lod_detail_radius_m"], 750.0):
        raise AssertionError("Detail tile radius mismatch")

    tile_parent = bpy.data.collections["GlobalTiles"]
    tile_roots = [
        collection
        for collection in tile_parent.children
        if collection.get("fireviewer_tile_id")
    ]
    loaded_roots = [
        collection
        for collection in tile_roots
        if collection.get("fireviewer_tile_loaded", False)
    ]
    visible_roots = [
        collection
        for collection in tile_roots
        if not collection.hide_viewport and not collection.hide_render
    ]
    if len(tile_roots) != 475:
        raise AssertionError("The Blender tile index is incomplete")
    if sorted(collection["fireviewer_tile_id"] for collection in loaded_roots) != (
        sorted(requested_tile_ids)
    ):
        raise AssertionError("Unexpected resident detail tiles")
    if sorted(collection["fireviewer_tile_id"] for collection in visible_roots) != (
        sorted(requested_tile_ids)
    ):
        raise AssertionError("Unexpected visible detail tiles")

    global_context = bpy.data.collections.get("GlobalTerrainContext")
    if global_context is None:
        raise AssertionError("The partitioned global terrain context is absent")
    context_objects = {
        str(item.get("fireviewer_tile_id")): item
        for item in global_context.objects
        if item.get("fireviewer_tile_id")
    }
    if len(context_objects) != 475:
        raise AssertionError("The global context does not contain all 475 cells")
    hidden_context_ids = sorted(
        tile_id
        for tile_id, item in context_objects.items()
        if item.hide_viewport or item.hide_render
    )
    if hidden_context_ids != sorted(requested_tile_ids):
        raise AssertionError("Global context replacement differs from resident detail")
    visible_context_ids = sorted(set(context_objects) - set(hidden_context_ids))
    if len(visible_context_ids) != 475 - len(requested_tile_ids):
        raise AssertionError("The map outside Montmaur is not fully visible")
    if global_context.hide_viewport or global_context.hide_render:
        raise AssertionError("The global terrain context collection is hidden")
    if scene["global_terrain_context_populated_tile_count"] != 475:
        raise AssertionError("The global terrain partition contains empty cells")
    if not math.isclose(
        scene["global_terrain_context_area_error_m2"], 0.0, abs_tol=1e-6
    ):
        raise AssertionError("The global terrain partition loses or duplicates area")
    vector_context = bpy.data.collections.get("GlobalVectorContext")
    if vector_context is None:
        raise AssertionError("The partitioned global vector context is absent")
    vector_chunks = {
        str(collection.get("fireviewer_tile_id")): collection
        for collection in vector_context.children
        if collection.get("fireviewer_tile_id")
    }
    if len(vector_chunks) != 475:
        raise AssertionError("The global vector context does not index all 475 cells")
    hidden_vector_context_ids = sorted(
        tile_id
        for tile_id, collection in vector_chunks.items()
        if collection.hide_viewport or collection.hide_render
    )
    if hidden_vector_context_ids != sorted(requested_tile_ids):
        raise AssertionError("Simple vector replacement differs from HD residency")
    if vector_context.hide_viewport or vector_context.hide_render:
        raise AssertionError("The global vector context collection is hidden")
    if scene["global_vector_context_manifest_tile_count"] != 475:
        raise AssertionError("The global vector partition is incomplete")
    for collection in loaded_roots:
        tile_id = str(collection["fireviewer_tile_id"])
        if not collection.get("detail_vector_lod_complete", False):
            raise AssertionError(f"Incomplete tile-local vector LOD {tile_id}")
        vectors = bpy.data.collections.get(f"Vectors_{tile_id}")
        if vectors is None:
            raise AssertionError(f"Missing tile-local vector collection {tile_id}")

    for collection_name in ("Buildings", "Roads", "Water"):
        collection = bpy.data.collections[collection_name]
        if not collection.hide_viewport or not collection.hide_render:
            raise AssertionError(
                f"Global {collection_name} collection remains visible in near LOD"
            )
    vector_objects = [
        item
        for collection in vector_context.children
        for item in collection.objects
    ]
    vector_layers = {
        str(item.get("fireviewer_global_vector_layer", ""))
        for item in vector_objects
    }
    if "water_courses" in vector_layers:
        raise AssertionError("Duplicated named water-course geometry is present")
    if "water_segments" not in vector_layers:
        raise AssertionError("The partitioned hydrographic segment network is absent")
    if "buildings" not in vector_layers:
        raise AssertionError("The partitioned grounded building set is absent")
    if bpy.data.objects.get("TerrainMidMontmaur") is not None:
        raise AssertionError("The obsolete Montmaur-only terrain bypass is present")
    if bpy.data.objects.get("VegetationMontmaur0m50") is not None:
        raise AssertionError("The obsolete Montmaur-only vegetation bypass is present")

    terrain = bpy.data.objects.get("TerrainPreview")
    if terrain is None or terrain.get("texture_role") != "ign_bd_ortho_global":
        raise AssertionError("The textured continuous MNT terrain is absent")
    if terrain.get("render_surface_triangulation") != "fixed_nw_se_diagonal":
        raise AssertionError("Global terrain triangulation is not deterministic")
    terrain_material = terrain.data.materials[0]
    terrain_image = terrain_material.node_tree.nodes["Orthophoto Image"].image
    if terrain_image is None or terrain_image.packed_file is None:
        raise AssertionError("The global orthophoto is not packed in the scene")

    for tile_id in requested_tile_ids:
        detail_terrain = bpy.data.objects.get(f"TerrainTile_{tile_id}")
        tree_system = bpy.data.objects.get(f"VegetationTile_{tile_id}_0m50")
        if detail_terrain is None or tree_system is None:
            raise AssertionError(f"Incomplete detailed tile {tile_id}")
        if not math.isclose(detail_terrain.location.z, 0.0, abs_tol=1e-6):
            raise AssertionError(f"Tile {tile_id} render offset mismatch")
        if detail_terrain.get("render_surface_triangulation") != (
            "fixed_nw_se_diagonal"
        ):
            raise AssertionError(f"Tile {tile_id} terrain triangulation mismatch")
        if tree_system.get("instances_realized") is not False:
            raise AssertionError(f"Tile {tile_id} trees were realized")
        for modifier in tree_system.modifiers:
            if modifier.node_group is None:
                continue
            if any(
                node.bl_idname == "GeometryNodeRealizeInstances"
                for node in modifier.node_group.nodes
            ):
                raise AssertionError(f"Tile {tile_id} realizes tree instances")

    verified_detail_seam_count = _verify_loaded_detail_seams(
        manifest,
        requested_tile_ids,
        tuple(float(value) for value in manifest["origin_l93_m"]),
    )

    if scene.display_settings.display_device != "sRGB":
        raise AssertionError("Unexpected display color space")
    if scene.view_settings.view_transform != "AgX":
        raise AssertionError("Unexpected Blender view transform")
    ambient = scene.world.node_tree.nodes["FireViewerAmbient"]
    if not math.isclose(
        ambient.inputs["Strength"].default_value, 0.38, abs_tol=1e-6
    ):
        raise AssertionError("Ambient lighting mismatch")
    sun = bpy.data.objects["FireViewerSun"]
    if not math.isclose(sun.data.energy, 1.6, abs_tol=1e-6):
        raise AssertionError("Sun energy mismatch")

    local_focus = (
        MONTMAUR_FOCUS_L93_M[0] - float(scene["origin_l93_x_m"]),
        MONTMAUR_FOCUS_L93_M[1] - float(scene["origin_l93_y_m"]),
        360.0,
    )
    configured_viewport_count = final_scene_bootstrap.restore_material_viewport(
        bpy,
        local_focus=local_focus,
        view_distance_m=NEAR_VIEW_DISTANCE_M,
    )
    if getattr(bpy.context, "screen", None) is not None and configured_viewport_count < 1:
        raise AssertionError("The interactive Blender build has no saved 3D viewport")

    focus = bpy.data.objects.get("FireViewerFocus")
    if focus is None:
        focus = bpy.data.objects.new("FireViewerFocus", None)
        scene.collection.objects.link(focus)
    focus.empty_display_type = "SPHERE"
    focus.empty_display_size = 20.0
    focus.location = (
        MONTMAUR_FOCUS_L93_M[0] - float(scene["origin_l93_x_m"]),
        MONTMAUR_FOCUS_L93_M[1] - float(scene["origin_l93_y_m"]),
        0.0,
    )

    def portable_path(path: Path) -> str:
        return Path(os.path.relpath(path, OUTPUT_BLEND.parent)).as_posix()

    manifest_relative = portable_path(TILE_MANIFEST)
    scene["fireviewer_runtime_tile_manifest_path"] = manifest_relative
    scene["fireviewer_runtime_global_package_path"] = portable_path(BASE_PACKAGE)
    scene["fireviewer_runtime_module_directory_relative"] = portable_path(
        MODULE_DIRECTORY
    )
    scene["fireviewer_runtime_view_distance_m"] = NEAR_VIEW_DISTANCE_M
    scene["fireviewer_tile_streaming_config_json"] = json.dumps(
        {
            "schema": "fireviewer.blender-tile-streaming.v1",
            "manifest_path": manifest_relative,
            "global_package_path": portable_path(BASE_PACKAGE),
            "detail_radius_m": DETAIL_RADIUS_M,
            "detail_view_distance_max_m": NEAR_VIEW_DISTANCE_M,
            "detail_view_footprint_factor": 1.2,
            "maximum_resident_tile_count": MAXIMUM_RESIDENT_TILE_COUNT,
            "debounce_ticks": 2,
            "timer_interval_s": 0.25,
            "focus_object_name": "FireViewerFocus",
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    bootstrap = bpy.data.texts.get("FireViewerTileStreamingBootstrap.py")
    if bootstrap is None:
        bootstrap = bpy.data.texts.new("FireViewerTileStreamingBootstrap.py")
    bootstrap.clear()
    bootstrap.write(
        "import importlib, sys\n"
        "from pathlib import Path\n"
        "import bpy\n"
        "scene = bpy.context.scene\n"
        "module_dir = (Path(bpy.data.filepath).parent / "
        "scene['fireviewer_runtime_module_directory_relative']).resolve()\n"
        "if str(module_dir) not in sys.path: sys.path.insert(0, str(module_dir))\n"
        "runtime = importlib.import_module('blender_tile_streaming_runtime')\n"
        "runtime.register(bpy)\n"
    )
    bootstrap.use_module = True
    scene["fireviewer_tile_streaming_bootstrap_text"] = bootstrap.name
    scene["fireviewer_tile_streaming_text_bootstrap_configured"] = True
    scene["fireviewer_tile_streaming_bootstrap_registered"] = False
    scene["fireviewer_tile_streaming_runtime_status"] = "configured"
    scene["fireviewer_saved_viewport_area_type"] = "VIEW_3D"
    scene["fireviewer_saved_viewport_count"] = configured_viewport_count
    addon_archive = final_scene_bootstrap.package_persistent_addon(
        source_directory=MODULE_DIRECTORY / PERSISTENT_ADDON_MODULE,
        destination_zip=PERSISTENT_ADDON_ARCHIVE,
    )
    scene["fireviewer_tile_streaming_addon_archive"] = portable_path(
        addon_archive
    )
    scene["fireviewer_tile_streaming_restart_contract"] = (
        "enabled_user_addon_or_one_time_install_of_packaged_archive"
    )

    # The detailed Montmaur working set above is a build-time proof only.  The
    # distributable control file is saved in its lightweight fallback state;
    # the runtime then materializes at most one required tile per timer tick.
    verified_resident_tile_ids = sorted(requested_tile_ids)
    build_control_scene.activate_global_fallback(bpy)
    evicted_tile_ids = build_control_scene.evict_global_tiles(
        bpy, verified_resident_tile_ids
    )
    if evicted_tile_ids != verified_resident_tile_ids:
        raise AssertionError("The verified detail working set was not fully evicted")
    remaining_resident_tile_ids = sorted(
        str(collection.get("fireviewer_tile_id"))
        for collection in tile_roots
        if collection.get("fireviewer_tile_loaded", False)
    )
    if remaining_resident_tile_ids:
        raise AssertionError("The distributable .blend still embeds HD residents")

    scene["fireviewer_final_build_verified"] = True
    scene["fireviewer_final_build_schema"] = "fireviewer.global-lod-blend.v5"
    scene["fireviewer_final_focus_name"] = "Montmaur"
    scene["fireviewer_verified_detail_tile_ids_json"] = json.dumps(
        verified_resident_tile_ids, separators=(",", ":")
    )
    scene["fireviewer_final_resident_tile_ids_json"] = "[]"
    scene["fireviewer_saved_as_lightweight_global_fallback"] = True
    scene["fireviewer_verified_detail_seam_count"] = verified_detail_seam_count
    scene["fireviewer_viewport_contract"] = (
        "material_scene_world_scene_lights_clip_100km"
    )
    OUTPUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    save_result = bpy.ops.wm.save_as_mainfile(
        filepath=str(OUTPUT_BLEND), check_existing=False
    )
    if "FINISHED" not in save_result or not OUTPUT_BLEND.is_file():
        raise RuntimeError("Blender did not save the verified global LOD scene")
    scene["fireviewer_tile_streaming_addon_module"] = PERSISTENT_ADDON_MODULE
    # The persistent add-on is packaged with the deliverable, but installation
    # changes the user's global Blender preferences and must remain an explicit
    # user action.  The current session is registered below so the control file
    # is immediately usable without silently mutating those preferences.
    scene["fireviewer_tile_streaming_addon_enabled"] = False
    scene["fireviewer_tile_streaming_addon_install_required"] = True
    scene["fireviewer_tile_streaming_restart_ready"] = False
    runtime = importlib.import_module("blender_tile_streaming_runtime")
    runtime.register(bpy)
    scene["fireviewer_tile_streaming_runtime_status"] = "registered"
    scene["fireviewer_tile_streaming_bootstrap_registered"] = True
    save_result = bpy.ops.wm.save_as_mainfile(
        filepath=str(OUTPUT_BLEND), check_existing=False
    )
    if "FINISHED" not in save_result:
        raise RuntimeError("Blender did not persist the registered LOD runtime")
    print(
        "FIREVIEWER_GLOBAL_LOD_BUILD_OK",
        {
            "blend": str(OUTPUT_BLEND),
            "planned": 475,
            "ready": 475,
            "verified_detail_tiles": len(verified_resident_tile_ids),
            "saved_resident_tiles": 0,
            "placeholders": 475,
            "buildings": 5_640,
            "saved_lod": "global_fallback",
        },
    )
    return OUTPUT_BLEND


if __name__ == "__main__":
    build()
