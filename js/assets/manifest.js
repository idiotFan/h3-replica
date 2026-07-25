// ================= 美术资产清单（glTF 管线） =================
// 规范详见 /ART_SPEC.md
// path 指向 art/export/**.glb；加载失败自动回退 models.js 原语

// ---- singleMesh 说明 ----------------------------------------------------
// Meshy AI 生成的 glb 是「单 mesh + 单材质 + 4 张 2048² 贴图」的整体模型：
// glTF 里 node / mesh / material 的 name 全部为 null（已核实 12 个文件均如此），
// 且 animations 为空数组。因此下列两条旧管线对它们必然静默失效：
//   1) factory.applyTeamColor 靠 /teamcolor/i 匹配网格名分部位染色 → 匹配不到
//   2) finalize 靠 /wingl|wingr|^flag$/i 绑定翅膀/旗帜节点供待机动画 → 绑不到
// 打上 singleMesh: true 后，factory.js 改走「整体色调偏移 + 强化底座光环」的
// 兜底路径；翅膀/披风等分部位动画对这些资产不可用，由 battle.js / map.js 里
// 已有的 userData.fromGltf 整体呼吸起伏覆盖。
//
// 旧 Blender 模型（城堡 castle_*、矿场 mine_*）带完整 TeamColor / Flag /
// WingL / WingR 命名，不要打这个标记。
//
// ⚠ 2026-07-25 更新：精锐兵 pikeman2/archer2/griffin2/swordsman2/champion2
// 也已被 Meshy 重制版替换（已核实 5 个文件 node/mesh/material 名全为 null、
// animations 为空），因此同样打上 singleMesh: true。旧 Blender 原件保留在
// art/_src/blender_elite/（未进 git，见 .gitignore）。
// 即便这里的标记漏改，factory.js 的 detectSingleMesh 也会在运行时按「网格全无名」
// 自愈，不会静默退化成没有队伍色——标记只是让声明与事实一致。

/** @typedef {{ path?: string|null, scale?: number, rotY?: number, yOffset?: number, teamColorMeshes?: string[], anims?: string[], polyBudget?: number, fallback?: string, singleMesh?: boolean, teamTint?: number }} AssetDef */

const U = 'art/export/units';
const H = 'art/export/heroes';
const B = 'art/export/buildings';

/** 单位资产：key 必须与 config.js 的 UNITS key 一致
 *  yOffset 由 factory.js 中 Box3 自动计算（包围盒最低点对齐 y=0）
 *  rotY 用于朝向修正：项目默认前方 = -Y
 *  anims 只是意向声明，Meshy（singleMesh）资产实际不含任何 animation clip
 */
export const UNIT_ASSETS = {
  // ---- Meshy AI 重制（单 mesh / 无命名节点 / 无动画 clip）----
  pikeman:   { path: `${U}/pikeman.glb`,   scale: 1,    polyBudget: 1500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  archer:    { path: `${U}/archer.glb`,    scale: 1,    polyBudget: 1500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  griffin:   { path: `${U}/griffin.glb`,   scale: 1,    polyBudget: 3500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  swordsman: { path: `${U}/swordsman.glb`, scale: 1,    polyBudget: 2500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  champion:  { path: `${U}/champion.glb`,  scale: 1,    polyBudget: 4000, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  wolf:      { path: `${U}/wolf.glb`,      scale: 1,    polyBudget: 2000, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  skeleton:  { path: `${U}/skeleton.glb`,  scale: 1,    polyBudget: 1500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  orc:       { path: `${U}/orc.glb`,       scale: 1,    polyBudget: 2000, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  ghost:     { path: `${U}/ghost.glb`,     scale: 1,    polyBudget: 2500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  dragon:    { path: `${U}/dragon.glb`,    scale: 1.15, polyBudget: 6000, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  // ---- 精锐兵：同为 Meshy AI 重制（2026-07-25 替换，单 mesh / 无命名节点 / 无动画）----
  pikeman2:  { path: `${U}/pikeman2.glb`,  scale: 1.05, polyBudget: 1800, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  archer2:   { path: `${U}/archer2.glb`,   scale: 1.05, polyBudget: 1800, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  griffin2:  { path: `${U}/griffin2.glb`,  scale: 1.05, polyBudget: 3800, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  swordsman2:{ path: `${U}/swordsman2.glb`,scale: 1.05, polyBudget: 2800, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
  champion2: { path: `${U}/champion2.glb`, scale: 1.05, polyBudget: 4200, anims: ['idle', 'walk', 'attack', 'hit', 'death'], singleMesh: true, fallback: 'primitive' },
};

// 英雄两侧本来就是两个不同模型（外形/配色已区分），整体染色取小值免得糊掉贴图，
// 敌我辨识主要交给底座光环。
export const HERO_ASSETS = {
  player: { path: `${H}/hero_player.glb`, scale: 1, polyBudget: 4000, anims: ['idle', 'walk'], teamColorMeshes: ['TeamColor'], singleMesh: true, teamTint: 0.12, fallback: 'primitive' },
  enemy:  { path: `${H}/hero_enemy.glb`, scale: 1, polyBudget: 4000, anims: ['idle', 'walk'], teamColorMeshes: ['TeamColor'], singleMesh: true, teamTint: 0.12, fallback: 'primitive' },
};

export const BUILDING_ASSETS = {
  castle_player: { path: `${B}/castle_player.glb`, scale: 1, polyBudget: 6000, fallback: 'primitive' },
  castle_enemy:  { path: `${B}/castle_enemy.glb`, scale: 1, polyBudget: 6000, fallback: 'primitive' },
  mine_sawmill:  { path: `${B}/mine_sawmill.glb`, scale: 1, polyBudget: 2000, fallback: 'primitive' },
  mine_ore:      { path: `${B}/mine_ore.glb`, scale: 1, polyBudget: 2000, fallback: 'primitive' },
  mine_gold:     { path: `${B}/mine_gold.glb`, scale: 1, polyBudget: 2000, fallback: 'primitive' },
};

export const TEAM_COLORS = {
  player: 0x2c5fa8,
  enemy: 0x8a2a2a,
};

export const WORLD_SCALE = {
  mapTile: 2,
  unitHeight: 1.2,
  dragonHeight: 1.8,
  battleUnitY: 0.14,
};

/** singleMesh 资产整体色调偏移强度：0 = 不染色，1 = 纯队伍色。
 *  取小值以保留 Meshy 贴图细节（0.25 在俯视小尺寸下已足够区分敌我）。
 *  单个资产可用 AssetDef.teamTint 覆盖。 */
export const SINGLE_MESH_TINT = 0.25;

/** singleMesh 资产 emissive 上限（0 = 完全关闭）。
 *  Meshy 导出 emissiveFactor=[1,1,1] + emissiveTexture，与 main.js 的
 *  UnrealBloom threshold 0.85 冲突，会让整个模型泛光。压缩管线会删
 *  emissiveTexture，这里在运行时再兜一层。 */
export const SINGLE_MESH_EMISSIVE = 0;

export function hasGlb(def) {
  return !!(def && def.path);
}

/** 是否为 Meshy 单 mesh 资产（无命名节点 / 无动画 clip） */
export function isSingleMesh(def) {
  return !!(def && def.singleMesh);
}
