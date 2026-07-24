# -*- coding: utf-8 -*-
"""
render_previews.py — 批量为 art/export/**/*.glb 渲染基线预览图。

用法:
    /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/render_previews.py

环境变量:
    PREVIEW_OUT   输出子目录名, 默认 "before" -> art/preview/<PREVIEW_OUT>/<资产名>.png

特性:
    - 逐个导入 glb, 每次导入前重置为空场景, 互不污染
    - 三点布光 (key/fill/rim, Sun 光, 与模型尺度无关) + 中性灰世界环境
    - 相机按世界空间包围盒自动取景, 前方 45 度俯视视角
    - Cycles CPU 渲染 640x640, 低采样 + 降噪, 作为快速基线
"""

import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Vector

# ---------------------------------------------------------------- 路径配置
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
EXPORT_DIR = os.path.join(PROJECT_ROOT, "art", "export")
OUT_SUBDIR = os.environ.get("PREVIEW_OUT", "before")
PREVIEW_DIR = os.path.join(PROJECT_ROOT, "art", "preview", OUT_SUBDIR)

RESOLUTION = 640
SAMPLES = 32
MARGIN = 1.12          # 取景边距, >1 表示相机再往后退一点
ELEV_DEG = 45.0        # 俯视角
WORLD_GREY = 0.35      # 中性灰环境亮度 (linear)


def reset_scene():
    """恢复出厂空场景, 清掉上一个模型的一切数据."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # 清理残留孤儿数据块
    for _ in range(3):
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)


def setup_render(scene, out_path):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = out_path


def setup_world(scene):
    """中性灰环境."""
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (WORLD_GREY, WORLD_GREY, WORLD_GREY, 1.0)
        bg.inputs["Strength"].default_value = 1.0
    scene.world = world


def scene_bounds():
    """所有几何体对象的世界空间包围盒. 返回 (min, max) 或 None."""
    geo_types = {"MESH", "CURVE", "SURFACE", "META", "FONT"}
    mins = Vector((math.inf,) * 3)
    maxs = Vector((-math.inf,) * 3)
    found = False
    for obj in bpy.context.scene.objects:
        if obj.type not in geo_types:
            continue
        for corner in obj.bound_box:
            wc = obj.matrix_world @ Vector(corner)
            mins.x, mins.y, mins.z = (min(mins.x, wc.x), min(mins.y, wc.y), min(mins.z, wc.z))
            maxs.x, maxs.y, maxs.z = (max(maxs.x, wc.x), max(maxs.y, wc.y), max(maxs.z, wc.z))
            found = True
    return (mins, maxs) if found else None


def add_sun(name, azimuth_deg, elevation_deg, energy, angle_deg=12.0):
    """按方位角/仰角放一盏太阳光 (与模型尺度无关, 适合自动化)."""
    light_data = bpy.data.lights.new(name, type="SUN")
    light_data.energy = energy
    light_data.angle = math.radians(angle_deg)  # 软化阴影
    light_obj = bpy.data.objects.new(name, light_data)
    bpy.context.scene.collection.objects.link(light_obj)
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    # 光源朝向: 从 (az, el) 方向照向原点
    direction = -Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    light_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return light_obj


def setup_lights():
    """三点布光: 主光(左前上) + 辅光(右前, 弱) + 轮廓光(后上)."""
    add_sun("KeyLight", azimuth_deg=-35, elevation_deg=50, energy=4.0, angle_deg=15)
    add_sun("FillLight", azimuth_deg=45, elevation_deg=20, energy=1.5, angle_deg=30)
    add_sun("RimLight", azimuth_deg=180, elevation_deg=55, energy=3.0, angle_deg=10)


def setup_camera(bounds):
    """前 45 度俯视, 按包围盒自动取景."""
    mins, maxs = bounds
    center = (mins + maxs) * 0.5
    radius = max((maxs - mins).length * 0.5, 1e-4)

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 50.0
    cam_data.clip_start = max(radius * 0.01, 0.001)
    cam_data.clip_end = radius * 200.0
    cam_obj = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # 前方(-Y) 45 度俯视方向
    el = math.radians(ELEV_DEG)
    view_dir = Vector((0.0, -math.cos(el), math.sin(el)))  # 相机相对中心的方位
    cam_obj.rotation_euler = (-view_dir).to_track_quat("-Z", "Y").to_euler()
    cam_obj.location = center + view_dir * radius * 3.0  # 初始位置, 随后精确取景

    # 用 Blender 自带 fit 精确框住所有包围盒角点
    corners = []
    for x in (mins.x, maxs.x):
        for y in (mins.y, maxs.y):
            for z in (mins.z, maxs.z):
                corners.extend((x, y, z))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    fit_loc, _scale = cam_obj.camera_fit_coords(depsgraph, corners)
    cam_obj.location = center + (fit_loc - center) * MARGIN


def render_one(glb_path, out_path):
    reset_scene()
    scene = bpy.context.scene
    setup_render(scene, out_path)
    setup_world(scene)

    bpy.ops.import_scene.gltf(filepath=glb_path)

    bounds = scene_bounds()
    if bounds is None:
        raise RuntimeError("导入后场景中没有几何体对象")

    setup_lights()
    setup_camera(bounds)
    bpy.ops.render.render(write_still=True)


def main():
    glbs = []
    for root, _dirs, files in os.walk(EXPORT_DIR):
        for f in sorted(files):
            if f.lower().endswith(".glb"):
                glbs.append(os.path.join(root, f))
    glbs.sort()

    os.makedirs(PREVIEW_DIR, exist_ok=True)
    images, issues = [], []

    print(f"[render_previews] {len(glbs)} 个 glb -> {PREVIEW_DIR}", flush=True)
    for i, glb in enumerate(glbs, 1):
        name = os.path.splitext(os.path.basename(glb))[0]
        out_path = os.path.join(PREVIEW_DIR, name + ".png")
        print(f"[render_previews] ({i}/{len(glbs)}) {name} ...", flush=True)
        try:
            render_one(glb, out_path)
            images.append(out_path)
        except Exception as exc:  # noqa: BLE001 - 单个失败不阻断批量
            traceback.print_exc()
            issues.append(f"{name}: {exc}")

    result = {"images": images, "issues": issues}
    print("RESULT_JSON=" + json.dumps(result, ensure_ascii=False), flush=True)
    # 写一份结果文件, 方便外部脚本读取
    with open(os.path.join(PREVIEW_DIR, "_render_result.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
