// ================= 美术资产清单（glTF 管线） =================
// 规范详见 /ART_SPEC.md
// path 指向 art/export/**.glb；加载失败自动回退 models.js 原语

/** @typedef {{ path?: string|null, scale?: number, yOffset?: number, teamColorMeshes?: string[], anims?: string[], polyBudget?: number, fallback?: string }} AssetDef */

const U = 'art/export/units';
const H = 'art/export/heroes';
const B = 'art/export/buildings';

/** 单位资产：key 必须与 config.js 的 UNITS key 一致 */
export const UNIT_ASSETS = {
  pikeman:   { path: `${U}/pikeman.glb`, scale: 1, polyBudget: 1500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  archer:    { path: `${U}/archer.glb`, scale: 1, polyBudget: 1500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  griffin:   { path: `${U}/griffin.glb`, scale: 1, polyBudget: 3500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  swordsman: { path: `${U}/swordsman.glb`, scale: 1, polyBudget: 2500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  champion:  { path: `${U}/champion.glb`, scale: 1, polyBudget: 4000, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  pikeman2:  { path: `${U}/pikeman2.glb`, scale: 1.05, polyBudget: 1800, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  archer2:   { path: `${U}/archer2.glb`, scale: 1.05, polyBudget: 1800, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  griffin2:  { path: `${U}/griffin2.glb`, scale: 1.05, polyBudget: 3800, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  swordsman2:{ path: `${U}/swordsman2.glb`, scale: 1.05, polyBudget: 2800, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  champion2: { path: `${U}/champion2.glb`, scale: 1.05, polyBudget: 4200, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  wolf:      { path: `${U}/wolf.glb`, scale: 1, polyBudget: 2000, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  skeleton:  { path: `${U}/skeleton.glb`, scale: 1, polyBudget: 1500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  orc:       { path: `${U}/orc.glb`, scale: 1, polyBudget: 2000, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  ghost:     { path: `${U}/ghost.glb`, scale: 1, polyBudget: 2500, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
  dragon:    { path: `${U}/dragon.glb`, scale: 1.15, polyBudget: 6000, anims: ['idle', 'walk', 'attack', 'hit', 'death'], fallback: 'primitive' },
};

export const HERO_ASSETS = {
  player: { path: `${H}/hero_player.glb`, scale: 1, polyBudget: 4000, anims: ['idle', 'walk'], teamColorMeshes: ['TeamColor'], fallback: 'primitive' },
  enemy:  { path: `${H}/hero_enemy.glb`, scale: 1, polyBudget: 4000, anims: ['idle', 'walk'], teamColorMeshes: ['TeamColor'], fallback: 'primitive' },
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

export function hasGlb(def) {
  return !!(def && def.path);
}
