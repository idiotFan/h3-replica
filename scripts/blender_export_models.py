"""
Blender 无界面批处理：生成风格化低多边形中世纪资产并导出 glb
用法：
  blender --background --python scripts/blender_export_models.py
"""
import bpy
import bmesh
import math
import os
from mathutils import Vector, Euler, Matrix

# ---------- 路径 ----------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
OUT = os.path.join(ROOT, "art", "export")

# ---------- 颜色 ----------
SKIN = (0.91, 0.76, 0.62, 1)
TEAM_P = (0.17, 0.37, 0.66, 1)
TEAM_E = (0.54, 0.16, 0.16, 1)
GOLD = (0.83, 0.69, 0.22, 1)
STEEL = (0.50, 0.59, 0.72, 1)
STEEL_D = (0.35, 0.42, 0.53, 1)
GREEN = (0.25, 0.56, 0.31, 1)
GREEN_D = (0.17, 0.42, 0.22, 1)
WOOD = (0.54, 0.42, 0.24, 1)
WOOD_D = (0.42, 0.31, 0.16, 1)
STONE = (0.72, 0.69, 0.63, 1)
FUR = (0.79, 0.59, 0.24, 1)
CREAM = (0.94, 0.90, 0.82, 1)
GRAY = (0.36, 0.36, 0.40, 1)
BONE = (0.85, 0.85, 0.78, 1)
ORC = (0.37, 0.49, 0.23, 1)
ORC_D = (0.29, 0.39, 0.16, 1)
DRAGON = (0.48, 0.12, 0.12, 1)
DRAGON_B = (0.66, 0.31, 0.23, 1)
GHOST = (0.69, 0.76, 0.87, 1)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # 清孤儿数据
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.armatures):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def mat(name, color, rough=0.7, metal=0.0, emit=0.0, alpha=1.0, team=False):
    m = bpy.data.materials.new(name=("TeamColor" if team else name))
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        # Blender 4.x / 5.x 节点名兼容
        for key, val in (
            ("Roughness", rough),
            ("Metallic", metal),
            ("Emission Strength", emit),
            ("Alpha", alpha),
        ):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = val
        if emit > 0 and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = color
    if alpha < 1.0:
        m.blend_method = "BLEND"
    return m


def link(obj, collection=None):
    if collection is None:
        collection = bpy.context.scene.collection
    collection.objects.link(obj)
    return obj


def mesh_obj(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    return link(obj)


def add_cube(name, loc, scale, material, parent=None):
    mesh = bpy.data.meshes.new(name + "_m")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    obj = mesh_obj(name, mesh)
    obj.location = loc
    obj.scale = scale
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def add_cylinder(name, loc, radius=0.1, depth=0.5, segs=16, material=None, parent=None, rot=None):
    mesh = bpy.data.meshes.new(name + "_m")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=radius, radius2=radius, depth=depth)
    bm.to_mesh(mesh)
    bm.free()
    obj = mesh_obj(name, mesh)
    obj.location = loc
    if rot:
        obj.rotation_euler = Euler(rot, "XYZ")
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def add_cone(name, loc, radius=0.1, depth=0.3, segs=12, material=None, parent=None, rot=None):
    mesh = bpy.data.meshes.new(name + "_m")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=radius, radius2=0.001, depth=depth)
    bm.to_mesh(mesh)
    bm.free()
    obj = mesh_obj(name, mesh)
    obj.location = loc
    if rot:
        obj.rotation_euler = Euler(rot, "XYZ")
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def add_uv_sphere(name, loc, radius=0.1, segs=16, rings=12, material=None, parent=None, scale=None):
    mesh = bpy.data.meshes.new(name + "_m")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    obj = mesh_obj(name, mesh)
    obj.location = loc
    if scale:
        obj.scale = scale
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def add_plane(name, loc, size=(0.3, 0.4), material=None, parent=None, rot=None, name_override=None):
    mesh = bpy.data.meshes.new(name + "_m")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=3, y_segments=4, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    obj = mesh_obj(name_override or name, mesh)
    obj.location = loc
    obj.scale = (size[0], size[1], 1)
    if rot:
        obj.rotation_euler = Euler(rot, "XYZ")
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def bevel_object(obj, width=0.01, segments=2):
    """给物体加倒角修改器并应用，提升轮廓精致度"""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(30)
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception:
        pass
    obj.select_set(False)


def join_children(root_name="Root"):
    """把场景中所有 mesh 收进一个空物体下，方便导出"""
    root = bpy.data.objects.new(root_name, None)
    link(root)
    for obj in list(bpy.context.scene.objects):
        if obj != root and obj.type == "MESH" and obj.parent is None:
            obj.parent = root
    return root


def shade_smooth_all():
    # Blender 5.x 已移除 use_auto_smooth：必须用按角度平滑，否则薄板顶面法线被侧面
    # 平均拉歪 → 背光渲染成纯黑（盾面/翼膜黑条的根因）
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            try:
                bpy.ops.object.shade_auto_smooth(angle=math.radians(40))      # 4.2+/5.x
            except Exception:
                try:
                    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))  # 4.1
                except Exception:
                    try:
                        bpy.ops.object.shade_smooth()                          # 兜底
                        if hasattr(obj.data, "use_auto_smooth"):               # ≤4.0
                            obj.data.use_auto_smooth = True
                            obj.data.auto_smooth_angle = math.radians(40)
                    except Exception:
                        pass
            obj.select_set(False)


def export_glb(relpath):
    out = os.path.join(OUT, relpath)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    # 选中全部
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_yup=True,
    )
    size = os.path.getsize(out) / 1024
    print(f"✓ {relpath} ({size:.1f} KB)")


# ================= 角色构建 =================

def build_humanoid(team=TEAM_P, body=STEEL, helm=STEEL_D, elite=False):
    """自下而上骨架式装配：靴→小腿→大腿→骨盆→躯干→肩→上臂→前臂→手→颈→头→盔。
    相邻部件轴向重叠 0.02-0.03u 消除悬空缝隙；总高≈1.2u、头径0.31u（约1:3.8头身）、
    肩宽≈0.42u；原点在脚底中心，面朝 -Y（脸/战袍在 -Y，披风在 +Y）。
    elite=True 只加金边/装饰件，队伍色永不整体替换；平直着色（不调用 shade_smooth）。"""
    clear_scene()
    GOLD_TRIM = (0.784, 0.663, 0.318, 1)      # #c8a951
    m_metal = mat("Armor", body, rough=0.45, metal=0.8)
    m_skin = mat("Skin", SKIN, rough=0.8)
    m_team = mat("TeamColor", team, rough=0.8, metal=0.0, team=True)
    m_pants = mat("Pants", WOOD_D, rough=0.85)
    m_belt = mat("Belt", (0.29, 0.21, 0.13, 1), rough=0.85)   # #4a3620
    m_boot = mat("Boot", (0.24, 0.17, 0.10, 1), rough=0.9)
    m_helm = mat("Helm", helm, rough=0.45, metal=0.8) if helm else None

    def _seg(name, a, b, radius, material, segs=8):
        """在两点之间放一根圆柱（四肢分段用）"""
        a, b = Vector(a), Vector(b)
        d = b - a
        obj = add_cylinder(name, (a + b) / 2, radius, d.length, segs, material)
        obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        return obj

    # —— 下半身 ——
    for sx, side in ((-1, "L"), (1, "R")):
        add_cube("Boot" + side, (sx * 0.11, -0.02, 0.05), (0.10, 0.15, 0.09), m_boot)
        add_cube("Toe" + side, (sx * 0.11, -0.115, 0.035), (0.09, 0.07, 0.055), m_boot)
        add_cylinder("LegLower" + side, (sx * 0.11, 0, 0.195), 0.048, 0.26, 8, m_pants)
        add_cylinder("LegUpper" + side, (sx * 0.105, 0, 0.41), 0.058, 0.25, 8, m_pants)
    add_cube("Pelvis", (0, 0, 0.545), (0.30, 0.19, 0.17), m_pants)
    # —— 躯干 ——
    add_cylinder("Torso", (0, 0, 0.73), 0.15, 0.28, 14, m_metal)
    add_cylinder("Chest", (0, 0, 0.815), 0.168, 0.17, 14, m_metal)
    add_cube("Belt", (0, 0, 0.635), (0.32, 0.22, 0.06), m_belt)
    add_cube("Tabard_TeamColor", (0, -0.15, 0.62), (0.22, 0.05, 0.34), m_team)
    # —— 肩与双臂（中立垂放，手停在髋前，便于武器函数按名重摆）——
    for sx, side in ((-1, "L"), (1, "R")):
        add_uv_sphere("Shoulder" + side, (sx * 0.155, 0, 0.86), 0.065, 8, 5, m_metal)
        _seg("ArmUpper" + side, (sx * 0.165, 0, 0.85), (sx * 0.185, -0.02, 0.66), 0.048, m_metal)
        _seg("ArmLower" + side, (sx * 0.185, -0.02, 0.66), (sx * 0.195, -0.09, 0.50), 0.042, m_metal)
        add_cube("Hand" + side, (sx * 0.195, -0.10, 0.485), (0.07, 0.08, 0.07), m_boot)
    # —— 颈与头 ——
    add_cylinder("Neck", (0, 0, 0.90), 0.055, 0.10, 8, m_skin)
    add_uv_sphere("Head", (0, 0, 1.04), 0.155, 12, 8, m_skin)
    if helm:
        # 矮圆顶+盔沿：盔沿下露出脸部条带，前方加深色眼缝
        add_uv_sphere("Helm", (0, 0, 1.09), 0.17, 10, 6, m_helm, scale=(1, 1, 0.72))
        add_cylinder("HelmBrim", (0, 0, 1.065), 0.185, 0.04, 12, m_helm)
        add_cone("HelmSpike", (0, 0, 1.24), 0.045, 0.10, 8, m_helm)
        add_cube("EyeSlit", (0, -0.148, 1.005), (0.13, 0.025, 0.022),
                 mat("Slit", (0.05, 0.05, 0.05, 1), rough=0.6))
    # —— 肩后小披风：宽≈肩宽×1.25，长至膝后，纵向3段逐级外摆做垂坠 ——
    for i, (w, y, z, ang) in enumerate(((0.46, 0.175, 0.80, 10),
                                        (0.50, 0.215, 0.62, 18),
                                        (0.54, 0.262, 0.44, 26))):
        c = add_cube("Cape%d_TeamColor" % i, (0, y, z), (w, 0.028, 0.21), m_team)
        c.rotation_euler = Euler((math.radians(ang), 0, 0), "XYZ")
    # —— 精锐：金边+装饰件，剪影与队伍色不变 ——
    if elite:
        m_gold = mat("Gold", GOLD_TRIM, rough=0.35, metal=0.9)
        hem = add_cube("CapeHem", (0, 0.308, 0.346), (0.55, 0.03, 0.06), m_gold)
        hem.rotation_euler = Euler((math.radians(26), 0, 0), "XYZ")
        add_uv_sphere("ButtonL", (-0.155, -0.045, 0.905), 0.03, 6, 4, m_gold)
        add_uv_sphere("ButtonR", (0.155, -0.045, 0.905), 0.03, 6, 4, m_gold)
        if helm:
            add_cylinder("HelmBand", (0, 0, 1.065), 0.19, 0.018, 12, m_gold)
    # 只给大块甲片倒角，其余保持利落硬边（配合平直着色的低多边形风格）
    for nm in ("Torso", "Chest", "Pelvis", "Belt", "HelmBrim"):
        o = bpy.data.objects.get(nm)
        if o:
            bevel_object(o, 0.006, 1)


def build_pikeman(team=TEAM_P, elite=False):
    """枪兵：右臂屈肘身前实握长枪（杆长1.7u+枪头全长≈1.5倍身高，前倾8°，
    四棱锥枪头为全剪影最高点，枪尾抬至踝上不蹭靴面）。
    精锐：金色套箍 + 枪头下小三角旗(Flag)；披风金边/肩扣由 build_humanoid(elite) 提供。"""
    clear_scene()
    build_humanoid(team, STEEL, STEEL_D, elite)
    m_wood = mat("Wood", WOOD, rough=0.9)
    m_steel = mat("ArmSteel", STEEL, rough=0.45, metal=0.8)
    m_tip = mat("Tip", (0.81, 0.84, 0.87, 1), rough=0.35, metal=0.85)
    m_glove = mat("Glove", (0.24, 0.17, 0.10, 1), rough=0.9)
    m_gold = mat("Gold", (0.784, 0.663, 0.318, 1), rough=0.35, metal=0.9)

    def _seg(name, a, b, radius, material, segs=8):
        a, b = Vector(a), Vector(b)
        d = b - a
        obj = add_cylinder(name, (a + b) / 2, radius, d.length, segs, material)
        obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        return obj

    # 重摆右臂：上臂+前臂两段弯至身前，手握杆身约52%高度处
    for nm in ("ArmUpperR", "ArmLowerR", "HandR"):
        o = bpy.data.objects.get(nm)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    S, E, H = (0.165, 0.0, 0.85), (0.205, -0.13, 0.76), (0.165, -0.20, 0.95)
    _seg("ArmUpperR", S, E, 0.048, m_steel)
    _seg("ArmLowerR", E, H, 0.042, m_steel)
    add_cube("HandR", H, (0.075, 0.085, 0.09), m_glove)

    # 长枪：杆长1.7u、前倾8°、穿过手心；杆下端抬至 B+d*0.10（踝上），不再与右靴重叠
    d = Vector((0, -math.sin(math.radians(8)), math.cos(math.radians(8))))
    e = d.to_track_quat("Z", "Y").to_euler()
    B = Vector(H) - d * 0.94              # 枪尾基准点
    shaft = add_cylinder("Spear", B + d * 0.95, 0.02, 1.7, 8, m_wood)
    shaft.rotation_euler = e
    collar = add_cylinder("SpearCollar", B + d * 1.77, 0.032, 0.06, 8,
                          m_gold if elite else m_tip)   # 锥底金属套箍，精锐镀金
    collar.rotation_euler = e
    tip = add_cone("SpearTip", B + d * 1.89, 0.05, 0.18, 4, m_tip)   # 四棱锥枪头
    tip.rotation_euler = e
    if elite:
        # 枪头下 0.15u 小三角旗（命名 Flag 供运行时动画/换色）
        fp = B + d * 1.62
        m_flag = mat("TeamColor", team, rough=0.75, team=True)
        add_plane("Flag", (fp.x, fp.y + 0.10, fp.z), (0.055, 0.10), m_flag,
                  rot=(0, math.radians(90), 0))
    join_children("Unit")


def build_archer(team=TEAM_P, elite=False):
    """弓箭手：皮甲+队伍色布兜帽（无金属盔，露下半脸；帽体收小贴头保持头身比）；
    右臂前伸持弓（弓高≈0.62u，整弓绕Z偏25°并随手前移，弓臂/弓弦与前臂剪影分离），
    背后斜挂箭袋+3支箭。
    精锐：兜帽金边、金黄箭羽、弓梢金属包头、胸前斜挎带金扣。"""
    clear_scene()
    build_humanoid(team, WOOD_D, None, elite)
    m_leather = mat("Leather", (0.42, 0.31, 0.16, 1), rough=0.85)    # #6b4f2a 皮甲
    m_lining = mat("Lining", (0.54, 0.42, 0.24, 1), rough=0.85)      # #8a6b3d 下摆内衬
    m_team = mat("TeamColor", team, rough=0.8, team=True)
    m_glove = mat("Glove", (0.24, 0.17, 0.10, 1), rough=0.9)
    m_wood = mat("Bow", WOOD, rough=0.85)
    m_gold = mat("Gold", (0.784, 0.663, 0.318, 1), rough=0.35, metal=0.9)
    m_qv = mat("Quiver", (0.29, 0.21, 0.13, 1), rough=0.9)
    m_eye = mat("Eye", (0.05, 0.05, 0.05, 1), rough=0.5)

    def _seg(name, a, b, radius, material, segs=8):
        a, b = Vector(a), Vector(b)
        d = b - a
        obj = add_cylinder(name, (a + b) / 2, radius, d.length, segs, material)
        obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        return obj

    # 金属观感 → 皮甲（弓手不穿板甲）
    for nm in ("Torso", "Chest", "ArmUpperL", "ArmLowerL", "ShoulderL", "ShoulderR"):
        o = bpy.data.objects.get(nm)
        if o:
            o.data.materials.clear()
            o.data.materials.append(m_leather)
    o = bpy.data.objects.get("Pelvis")
    if o:
        o.data.materials.clear()
        o.data.materials.append(m_lining)
    if elite:   # 皮甲弓手不留金属肩扣，贵气走帽边/挎带
        for nm in ("ButtonL", "ButtonR"):
            o = bpy.data.objects.get(nm)
            if o:
                bpy.data.objects.remove(o, do_unlink=True)

    # 队伍色布兜帽（帽体收小贴头修头身比，覆头顶+前缘外翻环，帽口露脸）+ 眼睛
    add_uv_sphere("Hood_TeamColor", (0, 0.03, 1.06), 0.162, 10, 7, m_team,
                  scale=(1, 1.06, 0.96))
    add_cylinder("HoodRim_TeamColor", (0, -0.115, 1.028), 0.148, 0.05, 12, m_team,
                 rot=(math.radians(90), 0, 0))
    add_cube("EyeL", (-0.05, -0.148, 1.02), (0.028, 0.02, 0.024), m_eye)
    add_cube("EyeR", (0.05, -0.148, 1.02), (0.028, 0.02, 0.024), m_eye)

    # 重摆右臂：前伸持弓（手比原先更靠前，给弓弦让出前臂空间）
    for nm in ("ArmUpperR", "ArmLowerR", "HandR"):
        o = bpy.data.objects.get(nm)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    S, E, H = (0.165, 0.0, 0.85), (0.205, -0.17, 0.79), (0.21, -0.36, 0.75)
    _seg("ArmUpperR", S, E, 0.048, m_leather)
    _seg("ArmLowerR", E, H, 0.040, m_leather)
    add_cube("HandR", H, (0.07, 0.09, 0.08), m_glove)

    # 弓：半径0.36圆弧 ±60°共8段，弓腹过手心；整弓绕Z偏25°，
    # 弓梢/弓弦横向让开前臂 0.07+，弦不再从小臂前穿过
    R = 0.36
    ca, sa = math.cos(math.radians(25)), math.sin(math.radians(25))
    pts = []
    for i in range(9):
        th = math.radians(-60 + 15 * i)
        rel_y = R * (1 - math.cos(th))
        pts.append(Vector((H[0] - rel_y * sa, H[1] + rel_y * ca, H[2] + R * math.sin(th))))
    for i in range(8):
        _seg("BowLimb%d" % i, pts[i], pts[i + 1], 0.014, m_wood, segs=5)
    _seg("BowGrip", pts[3], pts[5], 0.021, m_leather, segs=6)
    _seg("BowString", pts[0], pts[8], 0.005,
         mat("String", (0.85, 0.82, 0.72, 1), rough=0.6), segs=4)
    m_cap = m_gold if elite else m_wood      # 精锐弓梢金属包头
    add_cube("BowTipT", pts[8], (0.03, 0.03, 0.035), m_cap)
    add_cube("BowTipB", pts[0], (0.03, 0.03, 0.035), m_cap)

    # 背后箭袋（斜15°挂右肩后）+ 顶口3支箭
    add_cylinder("Quiver", (-0.14, 0.17, 0.75), 0.06, 0.36, 8, m_qv,
                 rot=(math.radians(-12), 0, math.radians(15)))
    m_shaft = mat("Arrow", (0.6, 0.48, 0.3, 1), rough=0.8)
    m_fl = mat("Fletch", (1.0, 0.84, 0.42, 1) if elite else (0.92, 0.92, 0.88, 1), rough=0.7)
    for ax, ay in ((-0.17, 0.19), (-0.11, 0.21), (-0.14, 0.15)):
        add_cylinder("ArrowShaft", (ax, ay, 0.97), 0.008, 0.18, 5, m_shaft,
                     rot=(math.radians(-12), 0, math.radians(15)))
        add_cube("Fletch", (ax + 0.02, ay + 0.022, 1.06), (0.03, 0.03, 0.05), m_fl)

    if elite:
        add_cylinder("HoodTrim", (0, -0.118, 1.028), 0.155, 0.018, 12, m_gold,
                     rot=(math.radians(90), 0, 0))
        strap = add_cube("Strap", (0, -0.185, 0.73), (0.045, 0.022, 0.42), m_qv)
        strap.rotation_euler = Euler((0, math.radians(35), 0), "XYZ")
        add_cube("Buckle", (0, -0.198, 0.76), (0.05, 0.02, 0.06), m_gold)
    join_children("Unit")


def build_swordsman(team=TEAM_P, elite=False):
    """剑士（精英近战）：右手持剑尖朝下45°垂于体侧偏外，左臂屈肘收进鸢形盾后实握
    （整面 TeamColor）+ 金色纹章；大肩甲/裙甲三片/护胫堆出与枪兵的档次差。
    基础版无披风；精锐=披风(含金边)+盔顶红鬃冠+描金+鹰形纹章。
    注：盾尖/纹章各部件在 y 向错开≥0.0025，避免与盾面共面导致 Cycles 阴影渗漏渲成纯黑。"""
    clear_scene()
    STEEL_P = (0.54, 0.55, 0.57, 1)   # #8a8d91
    build_humanoid(team, STEEL_P, STEEL_D, elite)
    m_steel = mat("Plate", STEEL_P, rough=0.45, metal=0.8)
    m_blade = mat("Blade", (0.81, 0.84, 0.87, 1), rough=0.3, metal=0.9)
    m_grip = mat("Grip", (0.24, 0.17, 0.10, 1), rough=0.9)
    m_gold = mat("Gold", (0.784, 0.663, 0.318, 1), rough=0.35, metal=0.9)
    m_team = mat("TeamColor", team, rough=0.7, metal=0.05, team=True)

    def _seg(name, a, b, radius, material, segs=8):
        a, b = Vector(a), Vector(b)
        d = b - a
        obj = add_cylinder(name, (a + b) / 2, radius, d.length, segs, material)
        obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        return obj

    # 基础版无披风（披风留给精锐当档次差异；队伍色仍有战袍+盾面）
    if not elite:
        for i in range(3):
            o = bpy.data.objects.get("Cape%d_TeamColor" % i)
            if o:
                bpy.data.objects.remove(o, do_unlink=True)
    # 肩球/肩扣 → 大肩甲（压扁半球盖住肩臂衔接）
    for nm in ("ShoulderL", "ShoulderR", "ButtonL", "ButtonR"):
        o = bpy.data.objects.get(nm)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    for sx, side in ((-1, "L"), (1, "R")):
        add_uv_sphere("Pauldron" + side, (sx * 0.175, 0, 0.875), 0.10, 8, 5, m_steel,
                      scale=(1, 1, 0.75))
    # 裙甲三片 + 小腿护胫
    for tx, ty, rz in ((0, -0.105, 0), (-0.125, -0.05, 28), (0.125, -0.05, -28)):
        t = add_cube("Tasset", (tx, ty, 0.47), (0.11, 0.03, 0.13), m_steel)
        t.rotation_euler = Euler((0, 0, math.radians(rz)), "XYZ")
    for sx in (-1, 1):
        add_cylinder("Greave", (sx * 0.11, -0.012, 0.20), 0.054, 0.20, 8, m_steel)

    # 右手持剑：剑尖朝下45°垂于体侧偏外，成为右侧剪影突破点
    H = Vector((0.195, -0.10, 0.485))
    d = Vector((0.55, -0.18, -0.70)).normalized()
    e = d.to_track_quat("Z", "Y").to_euler()
    g = add_cylinder("SwordGrip", H, 0.018, 0.13, 6, m_grip)
    g.rotation_euler = e
    for k in (-0.03, 0.03):   # 缠绳环纹
        r = add_cylinder("GripWrap", H + d * k, 0.023, 0.014, 6, m_grip)
        r.rotation_euler = e
    add_uv_sphere("Pommel", H - d * 0.085, 0.03, 6, 4, m_gold)
    gd = add_cube("Guard", H + d * 0.075, (0.16, 0.035, 0.035), m_gold)   # 十字护手
    gd.rotation_euler = e
    bl = add_cube("Blade", H + d * 0.28, (0.07, 0.016, 0.38), m_blade)    # 扁棱剑刃
    bl.rotation_euler = e
    tp = add_cone("BladeTip", H + d * 0.53, 0.035, 0.12, 4, m_blade)      # 收锥剑尖
    tp.rotation_euler = e

    # 重摆左臂：屈肘收到盾后，手实握盾背中心（不再从盾面前方穿出、不伸出盾下缘）
    for nm in ("ArmUpperL", "ArmLowerL", "HandL"):
        o = bpy.data.objects.get(nm)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    SL, EL, HL = (-0.165, 0.0, 0.85), (-0.21, -0.02, 0.71), (-0.245, -0.032, 0.62)
    _seg("ArmUpperL", SL, EL, 0.048, m_steel)
    _seg("ArmLowerL", EL, HL, 0.042, m_steel)
    add_cube("HandL", HL, (0.07, 0.08, 0.07), m_grip)

    # 左臂鸢形盾：上盒 + 45°菱形收尖 + 纵向凸脊，盾面整块 TeamColor
    # 盾尖 y 厚 0.030（薄于盾体 0.035），前后面各内缩 0.0025 消共面
    sh = add_cube("Shield_TeamColor", (-0.25, -0.07, 0.62), (0.30, 0.035, 0.32), m_team)
    dm = add_cube("ShieldTip_TeamColor", (-0.25, -0.07, 0.47), (0.21, 0.030, 0.21), m_team)
    dm.rotation_euler = Euler((0, math.radians(45), 0), "XYZ")
    add_cube("ShieldRidge", (-0.25, -0.093, 0.56), (0.028, 0.02, 0.40), m_steel)
    if elite:   # 鹰形金色纹章（身体菱形+双翼+头，y 逐件错开消共面）
        eb = add_cube("EmblemBody", (-0.25, -0.103, 0.62), (0.07, 0.018, 0.07), m_gold)
        eb.rotation_euler = Euler((0, math.radians(45), 0), "XYZ")
        el = add_cube("EmblemL", (-0.325, -0.100, 0.655), (0.10, 0.018, 0.04), m_gold)
        el.rotation_euler = Euler((0, math.radians(-25), 0), "XYZ")
        er = add_cube("EmblemR", (-0.175, -0.100, 0.655), (0.10, 0.018, 0.04), m_gold)
        er.rotation_euler = Euler((0, math.radians(25), 0), "XYZ")
        add_cube("EmblemHead", (-0.25, -0.106, 0.685), (0.03, 0.018, 0.035), m_gold)
    else:       # 金色十字纹章（横条 y 前移 0.003 消与竖条的共面）
        add_cube("EmblemV", (-0.25, -0.103, 0.60), (0.05, 0.018, 0.22), m_gold)
        add_cube("EmblemH", (-0.25, -0.100, 0.655), (0.16, 0.018, 0.05), m_gold)
    if elite:   # 盔顶尖钉换红色马鬃冠
        o = bpy.data.objects.get("HelmSpike")
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
        m_red = mat("Crest", (0.54, 0.16, 0.16, 1), rough=0.8)
        add_cube("Crest", (0, 0.0, 1.26), (0.035, 0.26, 0.09), m_red)
        add_cone("CrestTail", (0, 0.17, 1.19), 0.03, 0.12, 6, m_red,
                 rot=(math.radians(-130), 0, 0))
    bevel_object(sh, 0.008, 1)
    join_children("Unit")


def build_horse(coat=(0.29, 0.22, 0.13, 1)):
    """马基座（面朝 -Y，脚底 z=0，背高≈0.91，体长明显大于体高）：
    长盒躯干（前收胸/后收臀）+ 32°斜盒颈（较立、略加长，高俯角下头颈更可读）+
    低头 18°盒头/口鼻（头较旧版放大约12%）+ 双眼 + 四棱锥双耳 +
    颈脊三段深色鬃 + 额发 + 四柱腿深蹄（腿+蹄≈0.54，占站高≈45%）+ 后下垂尾。
    只建几何不 bevel/smooth/join，由上层（build_hero）统一后处理。返回 m_coat。"""
    m_coat = mat("Coat", coat, rough=0.85)
    m_dark = mat("Dark", (0.13, 0.11, 0.10, 1), rough=0.9)
    m_eye = mat("HorseEye", (0.05, 0.05, 0.05, 1), rough=0.4)

    # 躯干：水平长盒（宽0.40 长1.05 高0.38），前半收窄做胸、尾端面收臀
    body = add_cube("Body", (0, 0.02, 0.72), (0.40, 1.05, 0.38), m_coat)
    for v in body.data.vertices:
        if v.co.y < 0:          # -Y 为前：胸部收窄
            v.co.x *= 0.85
            v.co.z *= 0.94
        elif v.co.y > 0.49:     # 尾端面：收臀
            v.co.x *= 0.92
            v.co.z *= 0.96
    body.data.update()

    # 颈：斜盒（截面0.16×0.20，长0.52），向前上倾 32°（较竖立，把头位抬高抬离躯干）
    neck = add_cube("Neck", (0, -0.488, 1.04), (0.16, 0.20, 0.52), m_coat)
    neck.rotation_euler = Euler((math.radians(32), 0, 0), "XYZ")

    # 头 + 略窄口鼻（微低头 18°）
    head = add_cube("Head", (0, -0.672, 1.21), (0.18, 0.33, 0.20), m_coat)
    head.rotation_euler = Euler((math.radians(18), 0, 0), "XYZ")
    muzzle = add_cube("Muzzle", (0, -0.876, 1.144), (0.13, 0.17, 0.14), m_coat)
    muzzle.rotation_euler = Euler((math.radians(18), 0, 0), "XYZ")

    # 双眼（深色小方块，贴头两侧）+ 四棱锥双耳
    for sx in (-1, 1):
        side = "L" if sx < 0 else "R"
        eye = add_cube("Eye" + side, (sx * 0.092, -0.722, 1.243), (0.02, 0.045, 0.036), m_eye)
        eye.rotation_euler = Euler((math.radians(18), 0, 0), "XYZ")
        ear = add_cone("Ear" + side, (sx * 0.06, -0.595, 1.375), 0.034, 0.10, 4, m_dark)
        ear.rotation_euler = Euler((math.radians(-12), 0, 0), "XYZ")

    # 鬃毛：颈脊 3 片深色薄板（沿 32° 颈脊重排）+ 额发
    for i, (my, mz) in enumerate(((-0.297, 0.970), (-0.382, 1.106), (-0.467, 1.242))):
        mane = add_cube("Mane%d" % i, (0, my, mz), (0.055, 0.15, 0.20), m_dark)
        mane.rotation_euler = Euler((math.radians(32), 0, 0), "XYZ")
    forelock = add_cube("Forelock", (0, -0.687, 1.345), (0.10, 0.17, 0.055), m_dark)
    forelock.rotation_euler = Euler((math.radians(18), 0, 0), "XYZ")

    # 四腿（八段圆柱 r0.055）+ 深色蹄（r0.062）
    for x, y in ((-0.16, -0.38), (0.16, -0.38), (-0.16, 0.38), (0.16, 0.38)):
        add_cylinder("Leg", (x, y, 0.30), 0.055, 0.48, 8, m_coat)
        add_cylinder("Hoof", (x, y, 0.045), 0.062, 0.09, 8, m_dark)

    # 尾：向后下弯锥（长0.42）
    tail = add_cone("Tail", (0, 0.65, 0.68), 0.07, 0.42, 8, m_dark)
    tail.rotation_euler = Euler((math.radians(-140), 0, 0), "XYZ")
    return m_coat


def build_hero(team=TEAM_P, elite=False):
    """骑乘英雄/冠军骑兵：重甲骑士 + 鞍裙（唯一大面积 TeamColor）+ 前后鞍桥 + 缰辔 +
    马面甲 chamfron + 夹持长枪(couched，杆轴穿右手心、尾端收于腋下) + 队伍色盾/金徽 +
    披风 + 鞍后战旗(Flag)。
    敌方(TEAM_E)参数化差异：深灰偏暖马、盔后掠双角、披风锯齿下摆、燕尾旗、暗金饰、
    红镶边、鞍裙下缘深色过渡边（软化红铠与裸露马体的交界）；玩家：灰白马、金冠环、
    蓝内衬。elite：鞍裙金边 + 盔顶三金羽 + 金面甲/金枪尖 + 枪杆队伍色小三角旗
    （剪影与队伍色不变，绝不整体换色）。"""
    clear_scene()
    is_enemy = (tuple(team) == tuple(TEAM_E))
    # 马体：玩家灰白 #d9cfc0 / 敌方深灰偏暖（微带红调，与红铠更协调）
    coat = (0.19, 0.16, 0.17, 1) if is_enemy else (0.851, 0.812, 0.753, 1)
    build_horse(coat)

    m_team = mat("TeamColor", team, rough=0.8, metal=0.0, team=True)
    m_skin = mat("Skin", SKIN, rough=0.65)
    m_steel = mat("Steel", (0.30, 0.31, 0.35, 1) if is_enemy else (0.541, 0.553, 0.569, 1),
                  rough=0.45, metal=0.8)
    m_gold = mat("Gold", (0.784, 0.663, 0.318, 1) if is_enemy else (1.0, 0.843, 0.42, 1),
                 rough=0.35, metal=0.9)   # 敌方暗金 #c8a951 / 玩家亮金 #ffd76b
    m_trim = mat("Trim", (0.937, 0.267, 0.267, 1) if is_enemy else (0.231, 0.510, 0.965, 1),
                 rough=0.7)               # 披风内衬：敌 #ef4444 / 我 #3b82f6
    m_wood = mat("Wood", WOOD_D, rough=0.9)
    m_tack = mat("Tack", (0.24, 0.17, 0.10, 1), rough=0.9)   # 深皮革马具
    m_visor = mat("Visor", (0.05, 0.05, 0.06, 1), rough=0.5)
    m_hem = mat("SkirtHem", (0.30, 0.14, 0.15, 1), rough=0.85)  # 暗酒红过渡边（敌方用）
    m_armor = m_gold if elite else m_steel  # 马具装饰件

    def _seg(name, a, b, radius, material, segs=6):
        """两点之间放一根圆柱（缰绳等细件用）"""
        a, b = Vector(a), Vector(b)
        d = b - a
        obj = add_cylinder(name, (a + b) / 2, radius, d.length, segs, material)
        obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        return obj

    # ---- 鞍具：鞍裙（唯一大面积队伍色，两侧下垂过马腹到 z≈0.41）+ 前后鞍桥 ----
    add_cube("TeamColorSaddleTop", (0, 0.06, 0.925), (0.45, 0.68, 0.05), m_team)
    for sx in (-1, 1):
        skirt = add_cube("TeamColorSaddle", (sx * 0.235, 0.06, 0.66), (0.035, 0.64, 0.50), m_team)
        skirt.rotation_euler = Euler((0, math.radians(sx * 4), 0), "XYZ")
        if elite:   # 精锐：鞍裙下缘金边条
            trim = add_cube("TrimGold", (sx * 0.247, 0.06, 0.425), (0.045, 0.65, 0.05), m_gold)
            trim.rotation_euler = Euler((0, math.radians(sx * 4), 0), "XYZ")
        elif is_enemy:  # 敌方：鞍裙下缘暗酒红过渡边，衔接红铠与裸露马体
            hem = add_cube("SkirtHem", (sx * 0.247, 0.06, 0.425), (0.045, 0.65, 0.05), m_hem)
            hem.rotation_euler = Euler((0, math.radians(sx * 4), 0), "XYZ")
    add_cube("Pommel", (0, -0.21, 0.965), (0.16, 0.07, 0.09), m_tack)    # 前鞍桥
    add_cube("Cantle", (0, 0.315, 0.975), (0.22, 0.08, 0.12), m_tack)    # 后鞍桥
    add_cube("Peytral", (0, -0.505, 0.76), (0.37, 0.06, 0.09), m_gold)   # 胸带

    # ---- 缰辔：鼻羁/头羁束带 + 双缰自口鼻回到前鞍桥（随新头位上移）----
    nb = add_cube("Noseband", (0, -0.871, 1.15), (0.14, 0.04, 0.155), m_tack)
    nb.rotation_euler = Euler((math.radians(18), 0, 0), "XYZ")
    hs = add_cube("Headstall", (0, -0.612, 1.243), (0.19, 0.04, 0.22), m_tack)
    hs.rotation_euler = Euler((math.radians(18), 0, 0), "XYZ")
    for sx in (-1, 1):
        _seg("Rein" + ("L" if sx < 0 else "R"),
             (sx * 0.105, -0.836, 1.164), (sx * 0.145, -0.26, 0.99), 0.008, m_tack, 5)

    # ---- 马面甲 chamfron（贴脸楔形面甲，精锐镀金）+ 额饰锥 ----
    chamfron = add_cube("Chamfron", (0, -0.859, 1.157), (0.16, 0.045, 0.28), m_armor)
    chamfron.rotation_euler = Euler((math.radians(18), 0, 0), "XYZ")
    spike = add_cone("ChamfronSpike", (0, -0.882, 1.28), 0.02, 0.10, 6, m_armor)
    spike.rotation_euler = Euler((math.radians(30), 0, 0), "XYZ")

    # ---- 骑手：骨盆→躯干→头，微前倾 6° ----
    add_cube("TeamColorHips", (0, 0.05, 0.99), (0.26, 0.22, 0.12), m_team)
    torso = add_cube("Torso", (0, 0.03, 1.15), (0.27, 0.19, 0.28), m_steel)
    torso.rotation_euler = Euler((math.radians(6), 0, 0), "XYZ")
    tabard = add_cube("TeamColorTabard", (0, -0.072, 1.14), (0.19, 0.035, 0.24), m_team)
    tabard.rotation_euler = Euler((math.radians(6), 0, 0), "XYZ")
    add_cube("Belt", (0, 0.03, 1.025), (0.29, 0.21, 0.04), m_gold)
    add_uv_sphere("PauldronL", (-0.155, 0.03, 1.28), 0.06, 8, 5, m_steel)
    add_uv_sphere("PauldronR", (0.155, 0.03, 1.28), 0.06, 8, 5, m_steel)
    add_cylinder("RiderNeck", (0, 0.02, 1.31), 0.05, 0.08, 8, m_skin)
    rhead = add_uv_sphere("RiderHead", (0, 0.01, 1.40), 0.11, 12, 7, m_skin)
    # 头盔：穹顶+面甲均为头的子节点（锥底贴头顶，零悬浮）
    add_uv_sphere("Helm", (0, 0.005, 0.03), 0.12, 12, 7, m_steel, parent=rhead)
    add_cube("Visor", (0, -0.108, 0.012), (0.10, 0.025, 0.035), m_visor, parent=rhead)
    if is_enemy:
        # 反派剪影：盔侧后掠双角（纯剪影即可与玩家冠环区分）
        for sx in (-1, 1):
            horn = add_cone("Horn", (sx * 0.08, 0.075, 0.05), 0.04, 0.24, 6, m_steel, parent=rhead)
            horn.rotation_euler = Euler((math.radians(-60), 0, math.radians(-sx * 25)), "XYZ")
    else:
        # 玩家英雄：金冠环（torus 套头顶，头的子节点）
        bpy.ops.mesh.primitive_torus_add(major_radius=0.095, minor_radius=0.016,
                                         major_segments=12, minor_segments=5,
                                         location=(0, 0, 0))
        crown = bpy.context.active_object
        crown.name = "Crown"
        crown.data.materials.append(m_gold)
        crown.parent = rhead
        crown.location = (0, 0.005, 0.085)
    if elite:
        # 精锐：盔顶三片金羽（不改剪影主体）
        for fy, fz, fr in ((-0.045, 0.145, 20), (0.005, 0.16, 0), (0.055, 0.145, -20)):
            f = add_cube("PlumeGold", (0, fy, fz), (0.02, 0.09, 0.15), m_gold, parent=rhead)
            f.rotation_euler = Euler((math.radians(fr), 0, 0), "XYZ")

    # ---- 骑手双腿（跨骑在鞍裙外侧）----
    for sx in (-1, 1):
        thigh = add_cylinder("Thigh", (sx * 0.197, -0.038, 0.887), 0.048, 0.24, 8, m_steel)
        thigh.rotation_euler = Euler((math.radians(135), math.radians(-sx * 20), 0), "XYZ")
        calf = add_cylinder("Calf", (sx * 0.235, -0.125, 0.725), 0.04, 0.20, 8, m_steel)
        calf.rotation_euler = Euler((math.radians(-8), 0, 0), "XYZ")
        add_cube("Boot", (sx * 0.24, -0.165, 0.615), (0.075, 0.17, 0.09), m_steel)

    # ---- 右臂 + 夹持长枪（couched：杆轴精确穿过右手心、尾端收于腋下侧腰，
    #      杆长 0.90（较旧版 1.15 适度缩短），沿 -Y 俯角约 7°）----
    armR1 = add_cylinder("ArmR1", (0.172, -0.015, 1.22), 0.038, 0.17, 8, m_steel)
    armR1.rotation_euler = Euler((math.radians(144), math.radians(-16), 0), "XYZ")
    armR2 = add_cylinder("ArmR2", (0.175, -0.09, 1.14), 0.035, 0.15, 8, m_steel)
    armR2.rotation_euler = Euler((math.radians(125), math.radians(10), 0), "XYZ")
    add_uv_sphere("HandR", (0.16, -0.13, 1.11), 0.045, 8, 5, m_steel)
    # 杆长 0.70（再缩 22%，握点锚定手心不变），沿 -Y 俯角约 7°
    lance = add_cylinder("Lance", (0.16, -0.20, 1.101), 0.022, 0.70, 8, m_wood)
    lance.rotation_euler = Euler((math.radians(97), 0, 0), "XYZ")
    tip = add_cone("LanceTip", (0.16, -0.62, 1.050), 0.05, 0.16, 4, m_gold if elite else m_steel)
    tip.rotation_euler = Euler((math.radians(97), 0, 0), "XYZ")
    if elite:
        # 精锐：枪杆近尖端队伍色小三角旗
        add_plane("TeamColorPennant", (0.16, -0.42, 1.075), (0.045, 0.08), m_team,
                  rot=(0, math.radians(90), 0))

    # ---- 左臂 + 圆角盾（队伍色盾面 + 金徽记圆片）----
    armL1 = add_cylinder("ArmL1", (-0.175, -0.01, 1.21), 0.038, 0.17, 8, m_steel)
    armL1.rotation_euler = Euler((math.radians(150), math.radians(14), 0), "XYZ")
    armL2 = add_cylinder("ArmL2", (-0.20, -0.045, 1.135), 0.035, 0.15, 8, m_steel)
    armL2.rotation_euler = Euler((math.radians(140), math.radians(18), 0), "XYZ")
    add_uv_sphere("HandL", (-0.215, -0.08, 1.10), 0.045, 8, 5, m_steel)
    shield = add_cube("TeamColorShield", (-0.265, -0.04, 1.10), (0.05, 0.26, 0.34), m_team)
    shield.rotation_euler = Euler((0, math.radians(-6), 0), "XYZ")
    boss = add_cylinder("ShieldBoss", (-0.29, -0.04, 1.10), 0.06, 0.035, 10, m_gold)
    boss.rotation_euler = Euler((0, math.radians(90), 0), "XYZ")

    # ---- 披风：双肩后下垂到马臀，内衬亮色；敌方下摆 3 锯齿撕裂 ----
    cape = add_cube("TeamColorCape", (0, 0.21, 1.07), (0.34, 0.035, 0.50), m_team)
    cape.rotation_euler = Euler((math.radians(28), 0, 0), "XYZ")
    lining = add_cube("CapeLining", (0, 0.194, 1.062), (0.30, 0.02, 0.44), m_trim)
    lining.rotation_euler = Euler((math.radians(28), 0, 0), "XYZ")
    if is_enemy:
        for tx in (-0.11, 0.0, 0.11):
            ctip = add_cone("TeamColorCapeTip", (tx, 0.345, 0.80), 0.05, 0.14, 4, m_team)
            ctip.rotation_euler = Euler((math.radians(-155), 0, 0), "XYZ")

    # ---- 鞍后战旗：竖杆 + 金顶饰 + 旗面（0.34×0.22，敌方燕尾）----
    # 杆长 1.0→0.62（底端锚定鞍后不变）：评审"长枪约骑手2倍"实为此旗杆在俯视角的观感
    pole = add_cylinder("Pole", (-0.09, 0.343, 1.227), 0.018, 0.62, 8, m_wood)
    pole.rotation_euler = Euler((math.radians(-8), 0, 0), "XYZ")
    finial = add_cone("PoleFinial", (-0.09, 0.39, 1.57), 0.03, 0.08, 6, m_gold)
    finial.rotation_euler = Euler((math.radians(-8), 0, 0), "XYZ")
    flag = add_plane("Flag", (-0.09, 0.55, 1.42), (0.17, 0.11), m_team,
                     rot=(math.radians(90), 0, math.radians(90)))
    flag.name = "Flag"
    if is_enemy:
        # 燕尾旗：尾端中部顶点内收成三角缺口
        xs = max(v.co.x for v in flag.data.vertices)
        ymax = max(abs(v.co.y) for v in flag.data.vertices)
        for v in flag.data.vertices:
            if abs(v.co.x - xs) < 1e-5 and abs(v.co.y) < 0.55 * ymax:
                v.co.x *= 0.45
        flag.data.update()

    # ---- 后处理：曲面/圆柱/圆锥/细件不倒角（30°阈值会全倒角爆面数），只倒角盒体 ----
    no_bevel = ("RiderHead", "Helm", "Pauldron", "Crown", "Hand", "Flag", "Horn",
                "Leg", "Hoof", "Thigh", "Calf", "Arm", "Lance", "Pole", "Tail",
                "Ear", "Eye", "Rein", "Pennant", "ShieldBoss", "Spike",
                "RiderNeck", "CapeTip")
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and not any(k in o.name for k in no_bevel):
            bevel_object(o, 0.005, 1)
    shade_smooth_all()
    join_children("Hero")


def build_griffin(elite=False):
    """狮鹫：前鹰后狮双体块（面朝 -Y）。楔喙+耳羽+黑眼；后掠翼板+后缘羽尖锯齿，
    WingL/WingR=肩臼球旋转根；鹰前爪三趾/狮后腿两段+尾三节尾球；颈圈 TeamColor。
    elite=True（精锐 griffin2）：金冠羽x3+胸口金菱（嵌进胸羽）+翼根金箍+羽色提亮，
    同剪影 0.5s 可辨。"""
    clear_scene()
    m_cream = mat("Feather", (0.99, 0.98, 0.95, 1) if elite else (0.96, 0.95, 0.91, 1), rough=0.75)
    m_lion = mat("Lion", (0.73, 0.54, 0.31, 1), rough=0.8)          # 狮棕 #b98a4e
    m_beak = mat("Beak", (0.91, 0.64, 0.23, 1), rough=0.45)          # #e8a33a
    m_gold = mat("Gold", (0.784, 0.663, 0.318, 1), rough=0.35, metal=0.9)   # #c8a951
    m_eye = mat("Eye", (0.08, 0.08, 0.08, 1), rough=0.3)
    m_team = mat("TeamColor", TEAM_P, rough=0.65, team=True)

    # —— 双体块躯干：前羽后狮，色彩分区 ——
    add_uv_sphere("Chest", (0, -0.10, 0.48), 0.24, 16, 12, m_cream, scale=(1, 1.15, 1))
    add_uv_sphere("Hind", (0, 0.22, 0.44), 0.22, 14, 11, m_lion, scale=(1, 1.25, 0.9))
    add_cylinder("Neck", (0, -0.27, 0.62), 0.10, 0.30, 12, m_cream, rot=(math.radians(20), 0, 0))
    # —— 头：球颅+楔形下勾喙+双耳羽+黑眼 ——
    add_uv_sphere("Head", (0, -0.36, 0.78), 0.135, 14, 11, m_cream)
    add_cone("Beak", (0, -0.50, 0.75), 0.05, 0.17, 6, m_beak, rot=(math.radians(100), 0, 0))
    add_uv_sphere("EyeL", (-0.062, -0.44, 0.81), 0.026, 8, 6, m_eye)
    add_uv_sphere("EyeR", (0.062, -0.44, 0.81), 0.026, 8, 6, m_eye)
    add_cone("EarL", (-0.06, -0.31, 0.90), 0.03, 0.09, 6, m_cream, rot=(math.radians(-15), 0, 0))
    add_cone("EarR", (0.06, -0.31, 0.90), 0.03, 0.09, 6, m_cream, rot=(math.radians(-15), 0, 0))
    # 颈圈：队伍色关节件盖住头颈接缝
    add_cylinder("TeamColor", (0, -0.30, 0.675), 0.115, 0.07, 12, m_team,
                 rot=(math.radians(20), 0, 0))

    # —— 翼：肩臼球即 WingL/WingR 旋转根；后掠翼板+5 片后缘羽尖锯齿挂子级 ——
    for sx, wing in ((-1, "WingL"), (1, "WingR")):
        root = add_uv_sphere(wing, (sx * 0.15, 0.0, 0.63), 0.065, 10, 8, m_cream)
        ry, rz = math.radians(-12 * sx), math.radians(20 * sx)   # 前缘上反12°+后掠20°
        p = add_cube("Plate", (sx * 0.42, 0.10, 0.12), (0.72, 0.28, 0.028), m_cream, parent=root)
        p.rotation_euler = Euler((0, ry, rz), "XYZ")
        for i, ln in enumerate((0.20, 0.26, 0.22, 0.28, 0.18)):
            f = add_cube("Feather%d" % i,
                         (sx * (0.18 + i * 0.13), 0.15 + i * 0.055 + ln * 0.35, 0.09 + i * 0.033),
                         (0.06, ln, 0.02), m_cream, parent=root)
            f.rotation_euler = Euler((0, ry, rz), "XYZ")
        if elite:   # 翼根金箍：收窄半径埋进肩臼球，贴体不悬空（子级坐标，随翼旋转）
            add_cylinder("WingRing", (sx * 0.025, 0, 0), 0.058, 0.06, 10, m_gold,
                         parent=root, rot=(0, math.radians(90), 0))

    # —— 鹰前腿+三趾爪 / 狮后腿两段+掌 ——
    for sx in (-1, 1):
        add_cylinder("FrontLeg", (sx * 0.11, -0.16, 0.16), 0.042, 0.28, 10, m_cream)
        add_cube("Talon", (sx * 0.11, -0.19, 0.035), (0.075, 0.10, 0.05), m_beak)
        for j in (-1, 0, 1):
            add_cone("Toe", (sx * 0.11 + j * 0.035, -0.26, 0.03), 0.018, 0.08, 6, m_beak,
                     rot=(math.radians(95), 0, 0))
        add_uv_sphere("Thigh", (sx * 0.14, 0.25, 0.30), 0.095, 10, 8, m_lion, scale=(0.75, 1, 1.25))
        add_cylinder("Shin", (sx * 0.14, 0.27, 0.12), 0.04, 0.22, 10, m_lion)
        add_cube("Paw", (sx * 0.14, 0.23, 0.035), (0.07, 0.11, 0.05), m_lion)
    # —— 狮尾三节+尾球 ——
    add_cylinder("Tail1", (0, 0.42, 0.40), 0.028, 0.16, 8, m_lion, rot=(math.radians(-125), 0, 0))
    add_cylinder("Tail2", (0, 0.505, 0.315), 0.024, 0.15, 8, m_lion, rot=(math.radians(-110), 0, 0))
    add_cylinder("Tail3", (0, 0.575, 0.245), 0.020, 0.13, 8, m_lion, rot=(math.radians(-95), 0, 0))
    add_cone("TailTuft", (0, 0.635, 0.20), 0.042, 0.11, 8, m_lion, rot=(math.radians(-170), 0, 0))

    # —— 精锐差异件：金冠羽x3（后掠）+ 胸口金菱（后半嵌入胸羽，不再浮空）——
    if elite:
        for i in range(3):
            add_cone("Crest%d" % i, (0, -0.37 + i * 0.045, 0.905 - i * 0.012), 0.022, 0.10, 6,
                     m_gold, rot=(math.radians(-35), 0, 0))
        em = add_cube("Emblem", (0, -0.345, 0.54), (0.09, 0.06, 0.09), m_gold)
        em.rotation_euler = Euler((0, math.radians(45), 0), "XYZ")

    # 只倒角盒体（球/柱/锥在 30° 角限下会全倒角爆面数）
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.startswith(("Plate", "Feather", "Talon", "Paw", "Emblem")):
            bevel_object(o, 0.004, 1)
    shade_smooth_all()
    join_children("Griffin")


def build_dragon():
    """Boss 黑龙（面朝 -Y，总高≈1.75）：宽胸窄臀+5 块横向腹甲；三段锥化颈接楔形头
    （眉骨盒+吻+微张下颚+暗红口腔+双后掠角x2）；背棘 5；尾四节锥化+菱形尾刺；
    四条两段式腿（后腿粗 30%）三趾爪；WingL/WingR=肩臼旋转根，两段翼骨+肘球+
    三翼指锥全部收进蒙皮板内（蒙皮与翼骨焊合无缝）；胸前队伍色鳞甲片贴腹。"""
    clear_scene()
    m_red = mat("Scale", DRAGON, rough=0.55, metal=0.1)              # #7a1f1f
    m_belly = mat("Belly", DRAGON_B, rough=0.65)                     # #a8503a
    m_mem = mat("Membrane", (0.34, 0.10, 0.10, 1), rough=0.7)  # 提亮防止背光面读成纯黑
    m_horn = mat("Horn", (0.85, 0.79, 0.64, 1), rough=0.45)          # #d9c9a3
    m_mouth = mat("Mouth", (0.16, 0.035, 0.035, 1), rough=0.85)      # 口腔 #3a0d0d
    m_eye = mat("Eye", (1, 0.42, 0.05, 1), rough=0.25, emit=0.8)     # #ff6a00
    m_team = mat("TeamColor", TEAM_P, rough=0.6, team=True)

    # —— 躯干：宽胸+窄臀，腹部横向甲板 ——
    add_uv_sphere("Chest", (0, -0.12, 0.72), 0.38, 18, 14, m_red, scale=(1.05, 1.1, 0.95))
    add_uv_sphere("Hips", (0, 0.30, 0.62), 0.32, 16, 12, m_red, scale=(1, 1.2, 0.9))
    for i in range(5):
        w = 0.34 - abs(i - 2) * 0.04
        add_cube("BellyPlate%d" % i, (0, -0.34 + i * 0.17, 0.40 + abs(i - 2) * 0.012),
                 (w, 0.11, 0.06), m_belly)
    # —— 三段锥化颈（每段递减~18%）——
    add_uv_sphere("Neck1", (0, -0.42, 0.95), 0.17, 12, 10, m_red)
    add_uv_sphere("Neck2", (0, -0.55, 1.15), 0.14, 12, 10, m_red)
    add_uv_sphere("Neck3", (0, -0.65, 1.32), 0.115, 12, 10, m_red)
    # —— 头：眉骨盒+楔形吻+微张下颚+口腔内壁+发光眼+双后掠角x2 ——
    add_cube("Brow", (0, -0.74, 1.46), (0.24, 0.20, 0.13), m_red)
    add_cube("Snout", (0, -0.92, 1.44), (0.17, 0.26, 0.09), m_red)
    jaw = add_cube("Jaw", (0, -0.90, 1.345), (0.15, 0.24, 0.045), m_red)
    jaw.rotation_euler.x = math.radians(8)
    add_cube("MouthIn", (0, -0.90, 1.39), (0.13, 0.20, 0.02), m_mouth)
    add_uv_sphere("EyeL", (-0.095, -0.83, 1.50), 0.035, 8, 6, m_eye)
    add_uv_sphere("EyeR", (0.095, -0.83, 1.50), 0.035, 8, 6, m_eye)
    for sx in (-1, 1):
        add_cone("Horn", (sx * 0.09, -0.62, 1.60), 0.045, 0.38, 8, m_horn,
                 rot=(math.radians(-40), 0, 0))
        add_cone("Horn2", (sx * 0.145, -0.68, 1.50), 0.028, 0.20, 6, m_horn,
                 rot=(math.radians(-55), 0, 0))
    # —— 背棘 5 枚（沿脊线递降）——
    for i in range(5):
        add_cone("BackSpike%d" % i, (0, -0.18 + i * 0.20, 1.04 - i * 0.065), 0.05, 0.16, 6,
                 m_horn, rot=(math.radians(-18), 0, 0))
    # —— 尾：四节锥化+菱形尾刺（4 棱锥）——
    for i in range(4):
        add_uv_sphere("Tail%d" % i, (0, 0.58 + i * 0.24, 0.55 - i * 0.10), 0.15 - i * 0.028,
                      12, 10, m_red, scale=(1, 1.5, 1))
    add_cone("TailSpike", (0, 1.52, 0.22), 0.07, 0.30, 4, m_horn, rot=(math.radians(-115), 0, 0))
    # —— 四条两段式腿（前腿 k=0.75 细于后腿），三趾爪 ——
    for x, y, k in ((-0.26, 0.38, 1.0), (0.26, 0.38, 1.0), (-0.27, -0.20, 0.75), (0.27, -0.20, 0.75)):
        add_uv_sphere("Thigh", (x, y, 0.42), 0.13 * k, 10, 8, m_red, scale=(0.85, 1, 1.35))
        add_cylinder("Shin", (x, y + 0.02, 0.18), 0.058 * k, 0.32, 8, m_red)
        add_cube("Foot", (x, y - 0.06, 0.035), (0.11 * k, 0.15, 0.055), m_red)
        for j in (-1, 0, 1):
            add_cone("Claw", (x + j * 0.05 * k, y - 0.15, 0.035), 0.022 * k, 0.10, 6, m_horn,
                     rot=(math.radians(95), 0, 0))
    # —— 翼：WingL/WingR=肩臼旋转根；两段翼骨+肘球+三翼指+蒙皮板全部挂子级 ——
    for sx, wing in ((-1, "WingL"), (1, "WingR")):
        root = add_uv_sphere(wing, (sx * 0.28, -0.02, 1.00), 0.09, 10, 8, m_red)
        add_cylinder("Humerus", (sx * 0.23, 0, 0.10), 0.045, 0.50, 8, m_red, parent=root,
                     rot=(0, math.radians(65 * sx), 0))
        add_uv_sphere("Elbow", (sx * 0.45, 0, 0.21), 0.055, 8, 6, m_red, parent=root)
        add_cylinder("Forearm", (sx * 0.73, 0, 0.195), 0.035, 0.55, 8, m_red, parent=root,
                     rot=(0, math.radians(93 * sx), 0))
        # 三翼指缩短收进蒙皮范围内（不再有细刺穿出翼膜）
        for ang, ln in ((26, 0.40), (0, 0.44), (-25, 0.42)):
            a = math.radians(ang)
            dx, dy = sx * math.cos(a), -math.sin(a)
            add_cone("Finger", (sx * 1.0 + dx * ln / 2, dy * ln / 2, 0.18), 0.028, ln, 6, m_red,
                     parent=root, rot=(0, math.radians(90 * sx), math.radians(-ang * sx)))
        # 单层连续蒙皮：扇板+根板同一平面零倾角衔接。多层叠板+倾角会让侧视角
        # 看进板间夹缝（无光→纯黑楔形），单层共面从物理上消除该缝隙
        add_cube("Mem", (sx * 1.02, 0.0, 0.172), (0.55, 0.26, 0.014), m_mem, parent=root)
        add_cube("MemRoot", (sx * 0.62, 0.10, 0.167), (0.70, 0.26, 0.014), m_mem, parent=root)
        # 板面抬到翼骨圆柱(底 0.160)之上使其嵌入板内，消除圆柱悬于板面一线的切线黑缝
    # —— 胸前队伍色鳞甲片：随腹面倾斜贴合（顶端埋入胸、下端如鳞片微翘）——
    scale_plate = add_cube("TeamColor", (0, -0.495, 0.585), (0.13, 0.022, 0.20), m_team)
    scale_plate.rotation_euler.x = math.radians(15)

    # 只倒角头部/脚/腹甲盒体，蒙皮薄板与曲面件不倒角（控制在龙 6000 面预算内）
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.startswith(("Brow", "Snout", "Jaw", "Foot", "BellyPlate", "TeamColor")):
            bevel_object(o, 0.006, 1)
    shade_smooth_all()
    join_children("Dragon")


def build_wolf():
    """狼（面朝 -Y）：胸大臀小双体块+腰桥=弓背剪影；楔形长吻下倾+吻桥过渡块融合
    头吻接缝+黑鼻+浅色下颌；宽底三角耳（耳根沉入头顶+底座鼓包加宽衔接）；
    背 #6e6e72 / 腹吻下 #c9c9cc / 四肢下段 #4a4a4e 三分区；
    肩胛/大腿肌肉块+两段式腿+前伸脚掌；尾根上翘后自然下垂；队伍色项圈。"""
    clear_scene()
    m_back = mat("FurBack", (0.43, 0.43, 0.45, 1), rough=0.88)
    m_light = mat("FurLight", (0.79, 0.79, 0.80, 1), rough=0.85)
    m_dark = mat("FurDark", (0.29, 0.29, 0.31, 1), rough=0.9)
    m_nose = mat("Nose", (0.10, 0.10, 0.10, 1), rough=0.5)
    m_eye = mat("Eye", (0.91, 0.70, 0.23, 1), rough=0.3, emit=0.6)   # #e8b33a
    m_team = mat("TeamColor", TEAM_P, rough=0.7, team=True)

    # —— 弓背双体块 + 腰桥 + 浅色腹 ——
    add_uv_sphere("Chest", (0, -0.12, 0.37), 0.185, 14, 10, m_back, scale=(1, 1.3, 1.05))
    add_uv_sphere("Hips", (0, 0.21, 0.345), 0.145, 12, 10, m_back, scale=(1, 1.25, 1))
    add_cylinder("Waist", (0, 0.05, 0.355), 0.125, 0.22, 10, m_back, rot=(math.radians(86), 0, 0))
    add_uv_sphere("Belly", (0, -0.08, 0.30), 0.15, 12, 8, m_light, scale=(0.9, 1.25, 0.8))
    # —— 头 + 楔形长吻（下倾 5°）+ 吻桥过渡块（骑跨头/吻消除接缝）+ 黑鼻 + 浅色下颌 + 发光眼 ——
    add_cube("Head", (0, -0.375, 0.50), (0.15, 0.16, 0.13), m_back)
    snout = add_cube("Snout", (0, -0.50, 0.475), (0.078, 0.15, 0.062), m_back)
    snout.rotation_euler.x = math.radians(5)
    bridge = add_cube("SnoutBridge", (0, -0.445, 0.487), (0.112, 0.10, 0.095), m_back)
    bridge.rotation_euler.x = math.radians(5)
    add_cube("JawFur", (0, -0.485, 0.435), (0.06, 0.11, 0.03), m_light)
    add_cube("NoseTip", (0, -0.575, 0.49), (0.038, 0.03, 0.032), m_nose)
    add_uv_sphere("EyeL", (-0.055, -0.445, 0.535), 0.02, 8, 6, m_eye)
    add_uv_sphere("EyeR", (0.055, -0.445, 0.535), 0.02, 8, 6, m_eye)
    for sx in (-1, 1):   # 宽底三角耳：底座鼓包加宽衔接 + 耳根沉入头顶，后倾 20°
        add_uv_sphere("EarBase", (sx * 0.06, -0.335, 0.578), 0.045, 8, 6, m_dark,
                      scale=(1.35, 0.85, 0.6))
        ear = add_cone("Ear", (sx * 0.06, -0.335, 0.615), 0.052, 0.115, 4, m_dark,
                       rot=(math.radians(-20), 0, 0))
        ear.scale = (1.1, 0.5, 1)
    # 队伍色项圈：盖住头颈接缝的关节件
    add_cylinder("TeamColor", (0, -0.28, 0.455), 0.105, 0.06, 12, m_team,
                 rot=(math.radians(65), 0, 0))
    # —— 肩胛/大腿肌肉块 + 两段式腿（下段深色）+ 前伸脚掌 ——
    for sx in (-1, 1):
        add_uv_sphere("Shoulder", (sx * 0.105, -0.14, 0.40), 0.07, 8, 6, m_back, scale=(0.75, 1, 1.3))
        add_uv_sphere("Thigh", (sx * 0.10, 0.21, 0.36), 0.085, 8, 6, m_back, scale=(0.7, 1, 1.25))
        for yy in (-0.14, 0.22):
            add_cylinder("LegUp", (sx * 0.10, yy, 0.22), 0.036, 0.16, 8, m_back)
            add_cylinder("LegLow", (sx * 0.10, yy, 0.09), 0.028, 0.13, 8, m_dark)
            add_cube("Paw", (sx * 0.10, yy - 0.05, 0.022), (0.052, 0.085, 0.035), m_dark)
    # —— 尾：根部上翘后自然下垂（不插地）——
    add_cylinder("Tail1", (0, 0.42, 0.40), 0.032, 0.15, 8, m_back, rot=(math.radians(-115), 0, 0))
    add_cone("Tail2", (0, 0.52, 0.30), 0.03, 0.20, 8, m_dark, rot=(math.radians(-150), 0, 0))

    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.startswith(("Head", "Snout", "JawFur", "NoseTip", "Paw")):
            bevel_object(o, 0.004, 1)
    shade_smooth_all()
    join_children("Wolf")


def build_skeleton():
    """骷髅兵（头身比≈1:4）：脊柱+骨盆+5 根前后压扁的环状镂空肋（肋间透背景）；
    颅盒+颧收+独立下颌，方形黑眼窝+绿色点睛；锁骨+球关节两段式四肢零悬浮；
    右手方块手掌实握剑柄（刃/格/柄三材质），左臂八边圆盾（木面+铁边+中心凸球）；
    深色皮带箍骨盆+缩小的残破队伍色布条；腿骨加长（上身整体抬高 0.05）。"""
    clear_scene()
    m_bone = mat("Bone", (0.85, 0.81, 0.75, 1), rough=0.85)          # 陈旧象牙 #d8cfc0
    m_dark = mat("Socket", (0.06, 0.06, 0.06, 1), rough=0.6)
    m_glow = mat("EyeGlow", (0.22, 0.85, 0.54, 1), rough=0.3, emit=0.6)   # #39d98a
    m_blade = mat("Blade", (0.60, 0.64, 0.67, 1), rough=0.4, metal=0.8)   # #9aa2ab
    m_wood = mat("Wood", (0.42, 0.31, 0.16, 1), rough=0.9)           # #6b4f2a
    m_iron = mat("Iron", (0.54, 0.55, 0.57, 1), rough=0.5, metal=0.7)
    m_belt = mat("Belt", (0.23, 0.19, 0.14, 1), rough=0.9)           # 深色皮革 #3b3024
    m_team = mat("TeamColor", TEAM_P, rough=0.8, team=True)

    # —— 脊柱 + 骨盆 + 镂空环肋（前后压扁 62%）——
    add_cylinder("Spine", (0, 0, 0.60), 0.028, 0.34, 8, m_bone)
    add_cylinder("NeckBone", (0, 0, 0.81), 0.022, 0.10, 6, m_bone)
    add_cube("Pelvis", (0, 0, 0.45), (0.17, 0.10, 0.09), m_bone)
    for i, r in enumerate((0.125, 0.15, 0.16, 0.145, 0.125)):
        bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.015,
                                         major_segments=10, minor_segments=4,
                                         location=(0, 0, 0.52 + i * 0.055))
        rib = bpy.context.active_object
        rib.name = "Rib%d" % i
        rib.scale = (1, 0.62, 1)
        rib.rotation_euler.x = math.radians(6)
        rib.data.materials.append(m_bone)
    # —— 头骨：颅盒 + 颧骨内收 + 独立下颌；方形黑眼窝 + 绿点睛 + 倒三角鼻凹 ——
    add_cube("Skull", (0, -0.005, 0.975), (0.145, 0.155, 0.115), m_bone)
    add_cube("Cheek", (0, -0.02, 0.895), (0.105, 0.125, 0.05), m_bone)
    add_cube("JawBone", (0, -0.035, 0.845), (0.095, 0.105, 0.038), m_bone)
    add_cube("SocketL", (-0.042, -0.078, 0.975), (0.045, 0.012, 0.05), m_dark)
    add_cube("SocketR", (0.042, -0.078, 0.975), (0.045, 0.012, 0.05), m_dark)
    add_uv_sphere("PupilL", (-0.042, -0.083, 0.975), 0.012, 6, 4, m_glow)
    add_uv_sphere("PupilR", (0.042, -0.083, 0.975), 0.012, 6, 4, m_glow)
    add_cone("NoseHole", (0, -0.082, 0.928), 0.018, 0.02, 3, m_dark, rot=(math.radians(90), 0, 0))
    # —— 锁骨 + 球关节两段式四肢（肩/肘/髋/膝小球盖接缝；腿骨加长，脚位不变）——
    add_cube("Clavicle", (0, 0, 0.77), (0.24, 0.05, 0.035), m_bone)
    for sx in (-1, 1):
        add_uv_sphere("Shoulder", (sx * 0.13, 0, 0.76), 0.034, 6, 4, m_bone)
        add_cylinder("UpperArm", (sx * 0.155, -0.01, 0.675), 0.021, 0.15, 6, m_bone,
                     rot=(0, math.radians(14 * sx), 0))
        add_uv_sphere("Elbow", (sx * 0.175, -0.02, 0.60), 0.028, 6, 4, m_bone)
        add_uv_sphere("HipBall", (sx * 0.065, 0, 0.425), 0.032, 6, 4, m_bone)
        add_cylinder("Femur", (sx * 0.07, 0, 0.325), 0.022, 0.185, 6, m_bone)
        add_uv_sphere("Knee", (sx * 0.07, 0, 0.225), 0.026, 6, 4, m_bone)
        add_cylinder("Tibia", (sx * 0.07, 0, 0.135), 0.019, 0.18, 6, m_bone)
        add_cube("Foot", (sx * 0.07, -0.035, 0.025), (0.05, 0.11, 0.035), m_bone)
    # —— 右前臂接放大方块手掌（包住剑柄，衔接厚实）：刃/格/柄三材质 ——
    add_cylinder("ForearmR", (0.175, -0.077, 0.543), 0.019, 0.16, 6, m_bone,
                 rot=(math.radians(135), 0, 0))
    add_cube("HandR", (0.175, -0.135, 0.485), (0.07, 0.062, 0.062), m_bone)
    add_cylinder("Grip", (0.175, -0.135, 0.485), 0.016, 0.14, 8, m_wood, rot=(math.radians(90), 0, 0))
    add_uv_sphere("Pommel", (0.175, -0.055, 0.485), 0.022, 6, 4, m_iron)
    add_cube("Guard", (0.175, -0.20, 0.485), (0.09, 0.022, 0.035), m_iron)
    add_cube("Blade", (0.175, -0.40, 0.485), (0.05, 0.38, 0.016), m_blade)
    add_cone("BladeTip", (0.175, -0.615, 0.485), 0.035, 0.07, 4, m_blade, rot=(math.radians(90), 0, 0))
    # —— 左臂八边圆盾：木面 + 铁边 + 中心凸球 ——
    add_cylinder("ForearmL", (-0.175, -0.083, 0.57), 0.019, 0.14, 6, m_bone,
                 rot=(math.radians(115), 0, 0))
    add_cylinder("ShieldRim", (-0.185, -0.14, 0.57), 0.15, 0.024, 8, m_iron, rot=(math.radians(90), 0, 0))
    add_cylinder("Shield", (-0.185, -0.135, 0.57), 0.132, 0.03, 8, m_wood, rot=(math.radians(90), 0, 0))
    add_uv_sphere("Boss", (-0.185, -0.155, 0.57), 0.035, 6, 4, m_iron)
    # —— 深色皮带箍住骨盆造型 + 缩小的残破队伍色布条（不再是大蓝方块）——
    add_cube("Belt", (0, 0, 0.47), (0.19, 0.115, 0.04), m_belt)
    add_cube("TeamColor", (0, -0.055, 0.35), (0.085, 0.015, 0.13), m_team)

    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.startswith(
                ("Skull", "Cheek", "JawBone", "Pelvis", "Clavicle", "Foot",
                 "Guard", "Blade", "HandR", "Belt", "TeamColor")):
            bevel_object(o, 0.003, 1)
    shade_smooth_all()
    join_children("Skeleton")


def build_orc():
    """兽人（面朝 -Y）：倒三角躯干（宽胸收腹+浅腹分区 #8aa668）；球颅+前凸下颌盒+
    上翘白獠牙（根部埋入下颌、向外分开）+眉骨横楔+大红眼（半凸出眉下，清晰可读）+
    后掠尖耳；短粗腿+扁盒脚+一圈皮裙甲（正面队伍色垂布）；
    哑光铁半球肩甲+铆钉+加厚斜挎胸带贴紧躯干；两段式臂右举狼牙棒（拳头实握柄），
    棒头放射锥钉。肤色 #6f8f4e。"""
    clear_scene()
    m_skin = mat("Skin", (0.44, 0.56, 0.31, 1), rough=0.8)           # #6f8f4e
    m_belly = mat("Belly", (0.54, 0.65, 0.41, 1), rough=0.8)         # #8aa668
    m_iron = mat("Iron", (0.54, 0.55, 0.57, 1), rough=0.5, metal=0.7)    # #8a8d91
    m_leather = mat("Leather", (0.42, 0.31, 0.16, 1), rough=0.9)     # #6b4f2a
    m_strap = mat("Strap", (0.29, 0.21, 0.13, 1), rough=0.9)         # #4a3520
    m_tusk = mat("Tusk", (0.93, 0.92, 0.86, 1), rough=0.5)
    m_dark = mat("IronDark", (0.37, 0.39, 0.40, 1), rough=0.55, metal=0.6)   # #5f6266
    m_eye = mat("Eye", (0.94, 0.27, 0.27, 1), rough=0.3, emit=0.7)   # #ef4444
    m_team = mat("TeamColor", TEAM_P, rough=0.75, team=True)

    # —— 倒三角躯干：宽胸 + 收腹 + 腹色分区 ——
    add_uv_sphere("Chest", (0, 0, 0.66), 0.205, 12, 9, m_skin, scale=(1.3, 0.95, 1))
    add_cylinder("Waist", (0, 0, 0.46), 0.145, 0.22, 10, m_skin)
    add_uv_sphere("BellyPad", (0, -0.065, 0.52), 0.13, 10, 7, m_belly, scale=(1, 0.55, 1.1))
    # —— 头：球颅 + 前凸下颌盒 + 獠牙根部埋入下颌向外上翘 + 眉骨横楔 + 大红眼 + 后掠尖耳 ——
    add_uv_sphere("Head", (0, 0, 0.97), 0.125, 12, 8, m_skin)
    add_cube("JawBox", (0, -0.075, 0.905), (0.10, 0.095, 0.065), m_skin)
    add_cone("TuskL", (-0.058, -0.115, 0.925), 0.024, 0.10, 5, m_tusk,
             rot=(math.radians(12), math.radians(-8), 0))
    add_cone("TuskR", (0.058, -0.115, 0.925), 0.024, 0.10, 5, m_tusk,
             rot=(math.radians(12), math.radians(8), 0))
    add_cube("Brow", (0, -0.10, 1.015), (0.135, 0.05, 0.032), m_skin)
    add_uv_sphere("EyeL", (-0.048, -0.118, 0.985), 0.024, 6, 4, m_eye)
    add_uv_sphere("EyeR", (0.048, -0.118, 0.985), 0.024, 6, 4, m_eye)
    for sx in (-1, 1):
        ear = add_cone("Ear", (sx * 0.135, 0.02, 1.0), 0.035, 0.11, 4, m_skin,
                       rot=(math.radians(-25), math.radians(70 * sx), 0))
        ear.scale = (1, 0.4, 1)
    # —— 短粗腿 + 扁盒脚 + 一圈皮裙甲（正面开口给队伍色垂布）——
    for sx in (-1, 1):
        add_cylinder("Leg", (sx * 0.09, 0, 0.17), 0.06, 0.26, 8, m_skin)
        add_cube("Foot", (sx * 0.09, -0.045, 0.035), (0.10, 0.15, 0.06), m_leather)
    for i in range(6):
        a = math.radians(-150 + i * 60)
        p = add_cube("Skirt%d" % i, (math.sin(a) * 0.15, -math.cos(a) * 0.15, 0.335),
                     (0.095, 0.02, 0.15), m_leather)
        p.rotation_euler.z = a
    add_cube("TeamColor", (0, -0.155, 0.32), (0.11, 0.02, 0.17), m_team)
    # —— 哑光铁半球肩甲 + 铆钉x2 + 斜挎胸带（缩短加厚、收进躯干，紧贴不悬空）——
    for sx in (-1, 1):
        add_uv_sphere("Pauldron", (sx * 0.235, 0, 0.80), 0.10, 8, 5, m_iron, scale=(1, 1, 0.62))
        add_uv_sphere("Rivet", (sx * 0.235, -0.075, 0.84), 0.014, 5, 3, m_dark)
        add_uv_sphere("Rivet2", (sx * 0.235, 0.075, 0.84), 0.014, 5, 3, m_dark)
    st = add_cube("ChestStrap", (-0.02, -0.175, 0.62), (0.055, 0.045, 0.36), m_strap)
    st.rotation_euler.y = math.radians(-28)
    # —— 两段式臂：右臂举棒（肘球盖接缝、拳头实握柄），左臂下垂 ——
    add_cylinder("UpArmR", (0.28, 0, 0.72), 0.052, 0.18, 6, m_skin, rot=(0, math.radians(150), 0))
    add_uv_sphere("ElbowR", (0.325, 0, 0.645), 0.05, 6, 4, m_skin)
    add_cylinder("ForearmR", (0.325, -0.03, 0.73), 0.046, 0.18, 6, m_skin, rot=(math.radians(20), 0, 0))
    add_uv_sphere("FistR", (0.325, -0.062, 0.81), 0.058, 6, 5, m_skin)
    add_cylinder("UpArmL", (-0.28, 0, 0.72), 0.052, 0.18, 6, m_skin, rot=(0, math.radians(-150), 0))
    add_uv_sphere("ElbowL", (-0.325, 0, 0.645), 0.05, 6, 4, m_skin)
    add_cylinder("ForearmL", (-0.33, -0.01, 0.55), 0.045, 0.18, 6, m_skin, rot=(math.radians(6), 0, 0))
    add_uv_sphere("FistL", (-0.33, -0.02, 0.46), 0.055, 6, 5, m_skin)
    # —— 狼牙棒：皮柄穿拳 + 铁头 + 放射锥钉 x7 ——
    add_cylinder("Mace", (0.325, -0.075, 0.90), 0.026, 0.42, 6, m_leather, rot=(math.radians(4), 0, 0))
    add_uv_sphere("MaceHead", (0.325, -0.09, 1.13), 0.095, 8, 5, m_dark)
    for dx, dy, dz, rot in (
        (0, 0, 1, (0, 0, 0)), (1, 0, 0, (0, math.radians(90), 0)), (-1, 0, 0, (0, math.radians(-90), 0)),
        (0, -1, 0, (math.radians(90), 0, 0)), (0, 1, 0, (math.radians(-90), 0, 0)),
        (0.7, 0, 0.7, (0, math.radians(45), 0)), (-0.7, 0, 0.7, (0, math.radians(-45), 0)),
    ):
        add_cone("MaceSpike", (0.325 + dx * 0.105, -0.09 + dy * 0.105, 1.13 + dz * 0.105),
                 0.02, 0.09, 6, m_dark, rot=rot)

    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.startswith(
                ("JawBox", "Brow", "Foot", "Skirt", "TeamColor", "ChestStrap")):
            bevel_object(o, 0.005, 1)
    shade_smooth_all()
    join_children("Orc")


def build_ghost():
    """幽灵：主裹布前倾 7° 破对称+底缘悬空≈0.13；肩部球体放样消除缩颈；
    外层放大淡青半透明外壳做边缘光；裙摆 8 片高低错落尖瓣向后拖尾；
    袖状臂一抬一垂+末端开衩（衩瓣根部焊进袖尖）；内凹椭圆眼窝 emissive #4ac8df；
    胸前三环锁链+队伍色菱形坠饰。唯一半透明单位（规范 4.2），不 bevel。"""
    clear_scene()
    m = mat("Ghost", (0.69, 0.76, 0.87, 1), rough=0.3, emit=0.2, alpha=0.75)    # #afc3de
    m_shell = mat("Aura", (0.55, 0.85, 0.95, 1), rough=0.2, emit=0.6, alpha=0.15)
    m_eye = mat("EyeGlow", (0.29, 0.78, 0.87, 1), rough=0.2, emit=1.0)          # #4ac8df
    m_chain = mat("Chain", (0.54, 0.55, 0.57, 1), rough=0.45, metal=0.7)        # #8a8d91
    m_team = mat("TeamColor", TEAM_P, rough=0.5, emit=0.3, team=True)

    # —— 主裹布：前倾破对称 + 离地悬浮；肩部球体放样消除缩颈（颈宽≥头径0.9）——
    body = add_cone("Body", (0, 0.02, 0.62), 0.26, 0.78, 14, m)
    body.rotation_euler.x = math.radians(7)
    add_uv_sphere("Shoulders", (0, 0, 0.90), 0.185, 12, 9, m, scale=(1, 0.9, 0.75))
    head = add_uv_sphere("Head", (0, -0.015, 1.04), 0.155, 14, 10, m)
    head.rotation_euler.x = math.radians(-5)          # 头微后仰
    # 外壳边缘光：放大 ~8% 的淡青半透明罩
    shell = add_cone("Aura", (0, 0.02, 0.62), 0.275, 0.82, 14, m_shell)
    shell.rotation_euler.x = math.radians(7)
    add_uv_sphere("AuraHead", (0, -0.015, 1.04), 0.168, 12, 9, m_shell)
    # —— 裙摆：8 片高低错落尖瓣（相邻高差 0.05~0.1），底缘悬空、整体向 +Y 拖尾 ——
    for i in range(8):
        a = math.radians(i * 45 + 22)
        dp = 0.16 + (i % 2) * 0.08 + (i % 3) * 0.02
        add_cone("Hem%d" % i, (math.cos(a) * 0.185, math.sin(a) * 0.185 + 0.045, 0.27),
                 0.068, dp, 6, m, rot=(math.radians(180), 0, 0))
    # —— 袖状臂：一抬一垂打破对称；开衩小瓣根部压在袖锥末端轴线上（消除悬空碎片）——
    add_cone("ArmR", (0.31, -0.06, 0.93), 0.075, 0.34, 8, m,
             rot=(math.radians(15), math.radians(65), 0))
    add_cone("ArmL", (-0.31, -0.03, 0.78), 0.07, 0.32, 8, m,
             rot=(math.radians(10), math.radians(-115), 0))
    add_cone("CuffR", (0.415, -0.10, 0.925), 0.03, 0.11, 5, m, rot=(math.radians(170), 0, 0))
    add_cone("CuffL1", (-0.417, -0.056, 0.67), 0.032, 0.12, 5, m, rot=(math.radians(175), 0, 0))
    add_cone("CuffL2", (-0.364, -0.033, 0.705), 0.026, 0.10, 5, m, rot=(math.radians(-172), 0, 0))
    # —— 眼：椭圆眼窝满强度冷青辉光（压扁球嵌入面部）——
    add_uv_sphere("EyeL", (-0.058, -0.145, 1.07), 0.034, 8, 6, m_eye, scale=(1, 0.5, 1.3))
    add_uv_sphere("EyeR", (0.058, -0.145, 1.07), 0.034, 8, 6, m_eye, scale=(1, 0.5, 1.3))
    # —— 胸前三环锁链 + 队伍色菱形坠饰 ——
    for i in range(3):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.032, minor_radius=0.009,
                                         major_segments=10, minor_segments=4,
                                         location=(0, -0.145 - i * 0.008, 0.80 - i * 0.055))
        ln = bpy.context.active_object
        ln.name = "Chain%d" % i
        if i % 2 == 0:
            ln.rotation_euler.x = math.radians(90)
        else:
            ln.rotation_euler.y = math.radians(90)
        ln.data.materials.append(m_chain)
    # 坠饰：45° 立起的菱形小牌，顶角穿进末环（不再是占位方块）
    pend = add_cube("TeamColor", (0, -0.163, 0.645), (0.05, 0.014, 0.05), m_team)
    pend.rotation_euler.y = math.radians(45)

    shade_smooth_all()
    join_children("Ghost")


def build_castle(team=TEAM_P):
    clear_scene()
    is_enemy = team[0] > team[2]

    def _hx(h, mul=1.0):
        """sRGB hex -> linear RGBA，mul 为标量或三元组乘数（linear 空间）"""
        h = h.lstrip("#")
        if isinstance(mul, (int, float)):
            mul = (mul, mul, mul)
        out = []
        for i, m in zip((0, 2, 4), mul):
            c = int(h[i:i + 2], 16) / 255.0
            c = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
            out.append(c * m)
        return (out[0], out[1], out[2], 1.0)

    # ---- 调色板（规范色；主体乘 0.92 压掉石膏白；敌方墙体叠 8% 冷灰 #e0e0e8）----
    wall_mul = (0.808, 0.808, 0.837) if is_enemy else (0.92, 0.92, 0.92)
    trim_mul = tuple(m * 0.82 for m in wall_mul)
    m_wall = mat("Wall", _hx("#9a9689", wall_mul), rough=0.9)
    m_trim = mat("WallTrim", _hx("#9a9689", trim_mul), rough=0.92)
    m_roof = mat("TeamColor", _hx("#8a2a2a" if is_enemy else "#2c5fa8"), rough=0.7, metal=0.0, team=True)
    m_flag = mat("TeamColor", _hx("#ef4444" if is_enemy else "#3b82f6"), rough=0.7, team=True)
    m_wood = mat("Wood", _hx("#6b4f2a"), rough=0.85)
    m_frame = mat("Frame", _hx("#7a7d81"), rough=0.9)
    m_iron = mat("Iron", _hx("#4a4a4f"), rough=0.5, metal=0.6)
    m_gold = mat("GoldTrim", _hx("#c8a951"), rough=0.35, metal=0.8)
    m_win = mat("Window", _hx("#ffd76b"), rough=0.4, emit=0.6)
    m_windark = mat("WinDark", _hx("#2a2c30"), rough=0.9)
    m_spike = mat("SpikeIron", _hx("#3a3a40"), rough=0.6)

    # ---- 第一层级：基座 + 城墙 + 檐口 ----
    add_cube("Plinth", (0, 0, 0.09), (2.75, 2.75, 0.18), m_trim)
    add_cube("WallMain", (0, 0, 0.60), (2.55, 2.55, 1.20), m_wall)
    add_cube("CorniceWall", (0, 0, 1.24), (2.70, 2.70, 0.09), m_trim)

    # 城齿：一齿一空；敌方间距收窄 20%（更森严）
    step = 0.288 if is_enemy else 0.36
    n = 6 if is_enemy else 5
    xs = [(-(n - 1) / 2 + k) * step for k in range(n)]
    for k, v in enumerate(xs):
        add_cube("MerlonWF%d" % k, (v, 1.28, 1.36), (0.18, 0.10, 0.14), m_wall)
        add_cube("MerlonWB%d" % k, (v, -1.28, 1.36), (0.18, 0.10, 0.14), m_wall)
        add_cube("MerlonWL%d" % k, (-1.28, v, 1.36), (0.10, 0.18, 0.14), m_wall)
        add_cube("MerlonWR%d" % k, (1.28, v, 1.36), (0.10, 0.18, 0.14), m_wall)

    # ---- 第二层级：主堡（角塔 x1.26 制高点）+ 檐口 + 金字塔顶（出挑 12%，高:底≈0.76）----
    add_cube("Keep", (0, 0, 1.20), (1.35, 1.35, 2.40), m_wall)
    add_cube("CorniceKeep", (0, 0, 2.46), (1.52, 1.52, 0.12), m_trim)
    add_cone("KeepRoof", (0, 0, 3.095), 1.07, 1.15, 4, m_roof, rot=(0, 0, math.radians(45)))

    # ---- 四角塔：基座圈 + 塔身 + 出檐圈 + 顶部城齿 + 锥顶（敌方 8 面硬棱 + 尖刺）----
    for ti, (x, y) in enumerate(((-1.12, -1.12), (1.12, -1.12), (-1.12, 1.12), (1.12, 1.12))):
        add_cylinder("RingB%d" % ti, (x, y, 0.12), 0.42, 0.24, 12, m_trim)
        add_cylinder("Tower%d" % ti, (x, y, 0.95), 0.36, 1.90, 14, m_wall)
        add_cylinder("RingT%d" % ti, (x, y, 1.96), 0.44, 0.12, 12, m_trim)
        mcount = 10 if is_enemy else 8
        for k in range(mcount):
            a = k * 2 * math.pi / mcount
            mo = add_cube("MerlonT%d_%d" % (ti, k),
                          (x + 0.40 * math.cos(a), y + 0.40 * math.sin(a), 2.10),
                          (0.07, 0.11, 0.14), m_wall)
            mo.rotation_euler.z = a
        add_cone("TowerRoof%d" % ti, (x, y, 2.52), 0.45, 0.72, 8 if is_enemy else 12, m_roof)
        if is_enemy:
            for k in range(4):
                a = math.radians(45 + 90 * k)
                add_cone("SpikeT%d_%d" % (ti, k),
                         (x + 0.24 * math.cos(a), y + 0.24 * math.sin(a), 2.60),
                         0.035, 0.26, 4, m_spike)
        # 塔身细长窗（朝外）
        ux = math.copysign(0.7071, x)
        uy = math.copysign(0.7071, y)
        w = add_cube("WinTower%d" % ti, (x + 0.36 * ux, y + 0.36 * uy, 1.45), (0.05, 0.09, 0.24), m_windark)
        w.rotation_euler.z = math.atan2(uy, ux)

    # ---- 第三层级：大门（+Y 正面，拱门 + 木门 + 铁箍）----
    add_cube("StepGate", (0, 1.42, 0.045), (0.72, 0.28, 0.09), m_trim)
    add_cube("GatePostL", (-0.35, 1.30, 0.50), (0.10, 0.09, 0.72), m_frame)
    add_cube("GatePostR", (0.35, 1.30, 0.50), (0.10, 0.09, 0.72), m_frame)
    add_cylinder("ArchGate", (0, 1.30, 0.88), 0.37, 0.10, 16, m_frame, rot=(math.radians(90), 0, 0))
    add_cube("GateDoor", (0, 1.35, 0.53), (0.56, 0.06, 0.70), m_wood)
    add_cylinder("ArchDoor", (0, 1.35, 0.88), 0.28, 0.06, 12, m_wood, rot=(math.radians(90), 0, 0))
    add_cube("BandGate1", (0, 1.385, 0.35), (0.58, 0.025, 0.06), m_iron)
    add_cube("BandGate2", (0, 1.385, 0.65), (0.58, 0.025, 0.06), m_iron)
    add_cube("WinGateL", (-0.75, 1.29, 0.75), (0.10, 0.04, 0.30), m_win)
    add_cube("WinGateR", (0.75, 1.29, 0.75), (0.10, 0.04, 0.30), m_win)

    # 主堡窗：暖光窗 + 圆花窗 + 侧面暗窗
    add_cube("WinKeepL", (-0.30, 0.685, 1.70), (0.16, 0.05, 0.34), m_win)
    add_cube("WinKeepR", (0.30, 0.685, 1.70), (0.16, 0.05, 0.34), m_win)
    add_cylinder("WinRose", (0, 0.685, 2.15), 0.10, 0.05, 12, m_win, rot=(math.radians(90), 0, 0))
    add_cube("WinSideL", (-0.68, 0, 1.85), (0.05, 0.18, 0.34), m_windark)
    add_cube("WinSideR", (0.68, 0, 1.85), (0.05, 0.18, 0.34), m_windark)

    # ---- 旗杆 + 竖直悬挂燕尾旗（杆高=主堡高x0.45，顶端金球）----
    add_cylinder("Pole", (0, 0, 4.14), 0.02, 1.08, 8, m_wood)
    add_uv_sphere("PoleTip", (0, 0, 4.70), 0.05, 10, 8, m_gold)
    add_cylinder("CrossBar", (0.17, 0, 4.56), 0.013, 0.36, 8, m_wood, rot=(0, math.radians(90), 0))
    # 旗面：4 段 sin 摆动 + 底端 30% 燕尾 V 口
    fh, fw = 0.38, 0.27
    wave = (0.0, 0.032, -0.022, -0.04, 0.024)
    fmesh = bpy.data.meshes.new("Flag_m")
    fbm = bmesh.new()
    grid = []
    for r in range(5):
        z = -fh * r / 4
        row = []
        for c in range(5):
            zz = z
            if r == 4:
                zz += 0.30 * fh * (1 - abs(c - 2) / 2)
            row.append(fbm.verts.new((fw * c / 4, wave[r], zz)))
        grid.append(row)
    for r in range(4):
        for c in range(4):
            fbm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
    fbm.to_mesh(fmesh)
    fbm.free()
    flag = mesh_obj("Flag", fmesh)
    flag.location = (0.045, 0, 4.54)
    flag.data.materials.append(m_flag)
    # 旗面纹章：玩家圆形 / 敌方尖角菱形
    if is_enemy:
        em = add_cube("EmblemE", (0.18, 0.052, 4.35), (0.085, 0.02, 0.12), m_gold)
        em.rotation_euler.y = math.radians(45)
    else:
        add_cylinder("EmblemP", (0.18, 0.052, 4.35), 0.055, 0.02, 12, m_gold, rot=(math.radians(90), 0, 0))

    # 只给大体块倒角（小件不倒角，控制面数）
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.startswith(("Plinth", "Wall", "Cornice", "Keep", "Tower", "Gate")):
            bevel_object(o, 0.012, 2)
    shade_smooth_all()
    join_children("Castle")


def build_mine(kind):
    clear_scene()

    def _hx(h, mul=1.0):
        h = h.lstrip("#")
        if isinstance(mul, (int, float)):
            mul = (mul, mul, mul)
        out = []
        for i, m in zip((0, 2, 4), mul):
            c = int(h[i:i + 2], 16) / 255.0
            c = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
            out.append(c * m)
        return (out[0], out[1], out[2], 1.0)

    def _custom(name, bmi, loc, mtl, rot=None, scale=None):
        mesh = bpy.data.meshes.new(name + "_m")
        bmi.to_mesh(mesh)
        bmi.free()
        o = mesh_obj(name, mesh)
        o.location = loc
        if scale:
            o.scale = scale
        if rot:
            o.rotation_euler = Euler(rot, "XYZ")
        o.data.materials.append(mtl)
        return o

    def _ico(name, loc, r, mtl, scale=None, rot=None):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=loc)
        o = bpy.context.active_object
        o.name = name
        if scale:
            o.scale = scale
        if rot:
            o.rotation_euler = Euler(rot, "XYZ")
        o.data.materials.append(mtl)
        return o

    if kind == "sawmill":
        m_wall = mat("WallWood", _hx("#8a6b3d", 0.92), rough=0.85)
        m_roof = mat("RoofWood", _hx("#6b4f2a", 0.92), rough=0.9)
        m_beam = mat("Beam", _hx("#5a4632"), rough=0.95)
        m_light = mat("CutWood", _hx("#c8a570"), rough=0.8)
        m_ring = mat("RingWood", _hx("#8a6b3d", 0.8), rough=0.85)
        m_log = mat("Bark", _hx("#7a5a33"), rough=0.95)
        m_blade = mat("Blade", _hx("#9aa0a6"), rough=0.3, metal=0.75)
        m_iron = mat("IronDark", _hx("#4a4a4f"), rough=0.55, metal=0.3)
        m_win = mat("Window", _hx("#ffd76b"), rough=0.4, emit=0.6)

        # 主体：木屋 + 35° 双坡顶（山墙三角 + 出挑 10% 坡板 + 屋脊）
        add_cube("House", (0, 0, 0.31), (1.20, 0.90, 0.62), m_wall)
        # 山墙三角 = 3 段棱柱；bmesh 圆首顶点在 +Y，Euler(90,0,90) 把顶点转到 +Z、轴转到 X
        gable = add_cylinder("Gable", (0, 0, 0.73), 1.0, 1.0, 3, m_wall,
                             rot=(math.radians(90), 0, math.radians(90)))
        gable.scale = (0.54, 0.22, 1.22)
        rs = add_cube("RoofS", (0, -0.235, 0.785), (1.32, 0.68, 0.05), m_roof)
        rs.rotation_euler.x = math.radians(35)
        rn = add_cube("RoofN", (0, 0.235, 0.785), (1.32, 0.68, 0.05), m_roof)
        rn.rotation_euler.x = math.radians(-35)
        add_cube("Ridge", (0, 0, 0.965), (1.34, 0.08, 0.06), m_beam)
        # 山墙半木梁条（两端各 3 根）
        for si, sx in enumerate((-0.615, 0.615)):
            add_cube("BeamG%d_0" % si, (sx, 0, 0.77), (0.05, 0.05, 0.28), m_beam)
            add_cube("BeamG%d_1" % si, (sx, -0.24, 0.685), (0.05, 0.05, 0.13), m_beam)
            add_cube("BeamG%d_2" % si, (sx, 0.24, 0.685), (0.05, 0.05, 0.13), m_beam)
        # 门 / 暖窗 / 烟囱
        add_cube("DoorSaw", (0.30, 0.465, 0.23), (0.26, 0.05, 0.42), m_beam)
        add_cube("WinSaw", (-0.26, 0.465, 0.40), (0.16, 0.04, 0.16), m_win)
        add_cube("Chimney", (-0.32, -0.20, 0.94), (0.09, 0.09, 0.30), m_beam)
        add_cube("ChimneyCap", (-0.32, -0.20, 1.11), (0.12, 0.12, 0.05), m_iron)

        # 辨识符号一：外挂大圆锯片（锯台半嵌 + 12 齿 + 轴）
        add_cube("Table", (0.86, 0.02, 0.15), (0.34, 0.55, 0.30), m_beam)
        add_cylinder("Blade", (0.86, 0.02, 0.38), 0.30, 0.03, 16, m_blade, rot=(0, math.radians(90), 0))
        add_cylinder("Axle", (0.88, 0.02, 0.38), 0.035, 0.10, 8, m_iron, rot=(0, math.radians(90), 0))
        for k in range(12):
            t = k * math.pi / 6
            add_cone("Tooth%d" % k,
                     (0.86, 0.02 + 0.315 * math.cos(t), 0.38 + 0.315 * math.sin(t)),
                     0.032, 0.085, 4, m_blade, rot=(t - math.pi / 2, 0, 0))

        # 进料原木（加长 30%，端面年轮，下垫双三角支架）
        add_cylinder("LogFeed", (-0.80, 0.30, 0.30), 0.10, 1.10, 12, m_log, rot=(0, math.radians(90), 0))
        add_cylinder("DiscFeed", (-1.358, 0.30, 0.30), 0.082, 0.02, 10, m_light, rot=(0, math.radians(90), 0))
        add_cylinder("DotFeed", (-1.372, 0.30, 0.30), 0.032, 0.016, 6, m_ring, rot=(0, math.radians(90), 0))
        for tx_i, tx in enumerate((-0.72, -1.15)):
            for s in (1, -1):
                leg = add_cube("Trestle%d_%d" % (tx_i, (s + 1) // 2), (tx, 0.30, 0.15), (0.05, 0.05, 0.36), m_beam)
                leg.rotation_euler.x = math.radians(22 * s)
        # 成品木板斜靠西墙（各随机 ≤5° 转角）
        for i, (py, rz) in enumerate(((-0.02, 4), (-0.18, -3), (-0.34, 5))):
            p = add_cube("Plank%d" % i, (-0.70, py, 0.27), (0.14, 0.025, 0.55), m_light)
            p.rotation_euler = Euler((0, math.radians(14), math.radians(rz)), "XYZ")

        # 辨识符号二：门口原木堆（3+2 交错两层 + 1 根散落，端面年轮）
        pile = ((0.25, -0.60, 0.09), (0.25, -0.76, 0.09), (0.25, -0.92, 0.09),
                (0.25, -0.68, 0.225), (0.25, -0.84, 0.225), (-0.30, -0.66, 0.08))
        for i, (px, py, pz) in enumerate(pile):
            add_cylinder("LogP%d" % i, (px, py, pz), 0.08, 0.62, 10, m_log, rot=(0, math.radians(90), 0))
            add_cylinder("DiscP%d" % i, (px + 0.318, py, pz), 0.066, 0.018, 8, m_light, rot=(0, math.radians(90), 0))
            add_cylinder("DotP%d" % i, (px + 0.330, py, pz), 0.026, 0.014, 6, m_ring, rot=(0, math.radians(90), 0))
    else:
        gold = kind == "gold"
        m_rock = mat("Rock", _hx("#97907f" if gold else "#8a8d91", 0.92), rough=0.95)
        m_dark = mat("MouthDark", _hx("#17181a"), rough=1.0)
        m_wood = mat("WoodFrame", _hx("#6b4f2a"), rough=0.9)
        m_iron = mat("IronDark", _hx("#4a4a4f"), rough=0.55, metal=0.3)
        m_tie = mat("Tie", _hx("#5a4632"), rough=0.95)
        m_ore = mat("OreIron", _hx("#5f6670"), rough=0.9)
        m_rust = mat("Rust", _hx("#a8503a"), rough=0.95)
        m_gold_c = mat("GoldOre", _hx("#ffd76b"), rough=0.35, metal=0.8, emit=0.15)
        m_gold_i = mat("GoldIngot", _hx("#ffd76b"), rough=0.25, metal=0.9)
        m_light = mat("CutWood", _hx("#c8a570"), rough=0.8)

        # 主体：7 边不规则矮山包（顶面 0.5x，顶点抖动 ±8%）
        hbm = bmesh.new()
        bmesh.ops.create_cone(hbm, cap_ends=True, cap_tris=False, segments=7,
                              radius1=0.92, radius2=0.46, depth=0.92)
        jit = (1.06, 0.93, 1.04, 0.95, 1.07, 0.92, 1.03)
        for i, v in enumerate(hbm.verts):
            v.co.x *= jit[i % 7]
            v.co.y *= jit[(i + 3) % 7]
            if v.co.z > 0:
                v.co.z *= jit[(i + 5) % 7]
        _custom("Hill", hbm, (0, -0.12, 0.46), m_rock)

        # 矿洞：拱形洞口（纯暗）+ 前倾 3° 木门框（金矿双层粗框）
        add_cube("Entrance", (0, 0.66, 0.20), (0.46, 0.36, 0.40), m_dark)
        add_cylinder("ArchMouth", (0, 0.66, 0.40), 0.23, 0.36, 12, m_dark, rot=(math.radians(90), 0, 0))
        tilt = math.radians(-3)
        pw = 0.11 if gold else 0.08
        for s in (-1, 1):
            p = add_cube("Post%d" % ((s + 1) // 2), (s * 0.27, 0.86, 0.31), (pw, pw, 0.64), m_wood)
            p.rotation_euler.x = tilt
        lin = add_cube("Lintel", (0, 0.87, 0.655), (0.76, 0.10, 0.10), m_wood)
        lin.rotation_euler.x = tilt
        if gold:
            for s in (-1, 1):
                p = add_cube("Post2_%d" % ((s + 1) // 2), (s * 0.38, 0.92, 0.30), (0.09, 0.09, 0.60), m_wood)
                p.rotation_euler.x = tilt
            l2 = add_cube("Lintel2", (0, 0.93, 0.72), (0.92, 0.11, 0.11), m_wood)
            l2.rotation_euler.x = tilt

        # 矿车轨道：双轨 + 5 根枕木
        add_cube("RailL", (-0.10, 1.24, 0.05), (0.05, 0.85, 0.035), m_iron)
        add_cube("RailR", (0.10, 1.24, 0.05), (0.05, 0.85, 0.035), m_iron)
        for k in range(5):
            add_cube("Sleeper%d" % k, (0, 0.90 + 0.18 * k, 0.018), (0.34, 0.08, 0.035), m_tie)

        # 矿车：上宽下窄斗 + 4 轮
        cbm = bmesh.new()
        bmesh.ops.create_cube(cbm, size=1.0)
        for v in cbm.verts:
            if v.co.z < 0:
                v.co.x *= 0.68
                v.co.y *= 0.68
        _custom("Cart", cbm, (0, 1.50, 0.21), m_iron, scale=(0.28, 0.22, 0.19))
        for wi, wy in enumerate((1.42, 1.59)):
            for s in (-1, 1):
                add_cylinder("WheelC%d_%d" % (wi, (s + 1) // 2), (s * 0.10, wy, 0.115),
                             0.05, 0.035, 8, m_dark, rot=(0, math.radians(90), 0))

        # 车斗内容 + 散布矿物
        if gold:
            # 金锭 x3（上窄下宽梯形）
            for i, (ox, oy, rz) in enumerate(((-0.05, 1.44, 15), (0.06, 1.49, -25), (-0.01, 1.55, 60))):
                ibm = bmesh.new()
                bmesh.ops.create_cube(ibm, size=1.0)
                for v in ibm.verts:
                    if v.co.z > 0:
                        v.co.x *= 0.7
                        v.co.y *= 0.7
                _custom("Ingot%d" % i, ibm, (ox, oy, 0.30 + i * 0.012),
                        m_gold_i, rot=(0, 0, math.radians(rz)), scale=(0.11, 0.055, 0.035))

            # 核心差异：洞口两侧 + 山顶金水晶簇（六棱柱削尖，倾斜 ≤20°，低强度自发光）
            def _crystal(name, loc, r, h, rot):
                kbm = bmesh.new()
                bmesh.ops.create_cone(kbm, cap_ends=True, cap_tris=False, segments=6,
                                      radius1=r, radius2=r * 0.3, depth=h)
                _custom(name, kbm, loc, m_gold_c, rot=rot)

            _crystal("Crystal1", (0.50, 0.62, 0.13), 0.075, 0.34, (math.radians(12), math.radians(6), 0))
            _crystal("Crystal2", (0.64, 0.46, 0.09), 0.055, 0.22, (math.radians(-8), math.radians(18), 0))
            _crystal("Crystal3", (-0.52, 0.60, 0.15), 0.08, 0.38, (math.radians(10), math.radians(-14), 0))
            _crystal("Crystal4", (-0.67, 0.42, 0.10), 0.06, 0.24, (math.radians(-16), math.radians(-6), 0))
            _crystal("Crystal5", (0.10, -0.25, 0.97), 0.07, 0.26, (math.radians(6), math.radians(10), 0))
            _crystal("Crystal6", (0.24, -0.14, 0.93), 0.05, 0.17, (math.radians(-14), math.radians(20), 0))
            _ico("Rock1", (0.85, -0.05, 0.07), 0.08, m_rock, scale=(1, 0.88, 0.75))
            _ico("Rock2", (-0.88, 0.10, 0.06), 0.07, m_rock, scale=(1, 0.85, 0.7), rot=(0, 0, math.radians(40)))
            # 保险差异：小木牌 + 金块图标（照顾色弱/远景）
            add_cylinder("SignPost", (0.60, 0.90, 0.20), 0.022, 0.40, 8, m_wood)
            add_cube("SignBoard", (0.60, 0.92, 0.40), (0.24, 0.035, 0.15), m_light)
            _ico("Nugget", (0.60, 0.92, 0.55), 0.06, m_gold_c)
        else:
            _ico("OreC1", (-0.05, 1.46, 0.30), 0.065, m_ore)
            _ico("OreC2", (0.06, 1.53, 0.30), 0.055, m_ore, scale=(1, 0.85, 0.8))
            _ico("OreC3", (0.0, 1.49, 0.34), 0.05, m_rust)
            # 铁矿散布：深铁灰为主，掺 2 处锈橙
            rocks = ((0.70, 0.48, 0.07, 0.085, m_ore, 0),
                     (-0.66, 0.55, 0.06, 0.07, m_rust, 25),
                     (-0.92, -0.10, 0.08, 0.09, m_ore, 70),
                     (0.90, -0.30, 0.06, 0.07, m_ore, 130),
                     (0.10, -0.30, 0.90, 0.09, m_ore, 200),
                     (-0.25, 0.02, 0.90, 0.065, m_rust, 300))
            for i, (rx, ry, rz, rr, mm, ang) in enumerate(rocks):
                _ico("Rock%d" % i, (rx, ry, rz), rr, mm, scale=(1, 0.88, 0.75), rot=(0, 0, math.radians(ang)))

    # 只给大体块倒角，小件保持低面数
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.startswith(("House", "Gable", "Roof", "Table", "Hill", "Cart", "Entrance")):
            bevel_object(o, 0.01, 2)
    shade_smooth_all()
    join_children("Mine")


# ================= 批处理 =================

JOBS = [
    ("units/pikeman.glb", lambda: build_pikeman(TEAM_P, False)),
    ("units/pikeman2.glb", lambda: build_pikeman(TEAM_P, True)),
    ("units/archer.glb", lambda: build_archer(TEAM_P, False)),
    ("units/archer2.glb", lambda: build_archer(TEAM_P, True)),
    ("units/swordsman.glb", lambda: build_swordsman(TEAM_P, False)),
    ("units/swordsman2.glb", lambda: build_swordsman(TEAM_P, True)),
    ("units/champion.glb", lambda: build_hero(TEAM_P, False)),
    ("units/champion2.glb", lambda: build_hero(TEAM_P, True)),
    ("units/griffin.glb", build_griffin),
    ("units/griffin2.glb", lambda: build_griffin(True)),
    ("units/wolf.glb", build_wolf),
    ("units/skeleton.glb", build_skeleton),
    ("units/orc.glb", build_orc),
    ("units/ghost.glb", build_ghost),
    ("units/dragon.glb", build_dragon),
    ("heroes/hero_player.glb", lambda: build_hero(TEAM_P, False)),
    ("heroes/hero_enemy.glb", lambda: build_hero(TEAM_E, False)),
    ("buildings/castle_player.glb", lambda: build_castle(TEAM_P)),
    ("buildings/castle_enemy.glb", lambda: build_castle(TEAM_E)),
    ("buildings/mine_sawmill.glb", lambda: build_mine("sawmill")),
    ("buildings/mine_ore.glb", lambda: build_mine("ore")),
    ("buildings/mine_gold.glb", lambda: build_mine("gold")),
]


def main():
    print("Blender version:", bpy.app.version_string)
    os.makedirs(OUT, exist_ok=True)
    # 渲染引擎无关，仅导出
    for rel, fn in JOBS:
        clear_scene()
        fn()
        export_glb(rel)
    print(f"\n完成 {len(JOBS)} 个 glb → {OUT}")


if __name__ == "__main__":
    main()
