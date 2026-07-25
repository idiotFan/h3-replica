// ================= glTF 资源加载与缓存 =================
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { UNIT_ASSETS, HERO_ASSETS, BUILDING_ASSETS, hasGlb } from './manifest.js';
import { TEXTURE_SLOTS } from '../utils.js';

const loader = new GLTFLoader();
/** @type {Map<string, object>} path -> gltf */
const cache = new Map();
/** @type {Map<string, Promise<object>>} */
const inflight = new Map();

/**
 * 加载单个 glb（带缓存）
 * @param {string} path
 * @returns {Promise<object|null>}
 */
export function loadGlb(path) {
  if (!path) return Promise.resolve(null);
  if (cache.has(path)) return Promise.resolve(cache.get(path));
  if (inflight.has(path)) return inflight.get(path);
  const p = new Promise((resolve) => {
    loader.load(
      path,
      (gltf) => {
        cache.set(path, gltf);
        inflight.delete(path);
        resolve(gltf);
      },
      undefined,
      (err) => {
        console.warn('[assets] 加载失败，将回退原语:', path, err?.message || err);
        inflight.delete(path);
        resolve(null);
      }
    );
  });
  inflight.set(path, p);
  return p;
}

/** 标记材质上所有贴图为 shared（与缓存原件共用，禁止 dispose）。
 *  material.clone() 是浅拷贝，贴图对象仍与缓存原件共享，任何一个实例被
 *  dispose 掉都会让其余实例的贴图失效并触发反复重传。压缩后的 Meshy 模型
 *  每个仍带 3 张贴图（baseColor / metalRough / normal），只保护 .map
 *  远远不够，所以整槽位打 shared 标记。
 *  槽位清单与 utils.js 的 disposeObject3D 共用同一份 TEXTURE_SLOTS。 */
function markTexturesShared(m) {
  if (!m) return;
  for (const slot of TEXTURE_SLOTS) {
    const t = m[slot];
    if (t && t.userData) t.userData.shared = true;
  }
}

/** 克隆已加载场景（每次实例独立） */
export function cloneGltfScene(gltf) {
  if (!gltf?.scene) return null;
  const root = gltf.scene.clone(true);
  // 克隆骨骼绑定
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      // 几何体与缓存原件共享，标记 shared 防止 dispose 误销毁
      if (o.geometry) o.geometry.userData.shared = true;
      if (o.material) {
        const cloneMat = (m) => { markTexturesShared(m); return m.clone(); };
        if (Array.isArray(o.material)) o.material = o.material.map(cloneMat);
        else o.material = cloneMat(o.material);
      }
    }
  });
  // 动画
  const clips = gltf.animations ? gltf.animations.slice() : [];
  root.userData.gltfClips = clips;
  root.userData.fromGltf = true;
  return root;
}

/**
 * 预加载指定资源定义列表（按需加载）
 * @param {Array<{path:string}>} defs 资产定义数组
 * @param {(ratio:number, label:string)=>void} [onProgress]
 */
export async function preloadAssets(defs, onProgress) {
  const paths = new Set();
  for (const def of defs) if (def && hasGlb(def)) paths.add(def.path);
  const list = [...paths];
  if (!list.length) {
    onProgress?.(1, '使用程序化模型');
    return { total: 0, ok: 0 };
  }
  let ok = 0, done = 0;
  onProgress?.(0.04, `加载模型 0/${list.length}`);
  await Promise.all(list.map(path => loadGlb(path).then(g => {
    if (g) ok++;
    done++;
    onProgress?.(done / list.length, `加载模型 ${done}/${list.length}`);
  })));
  return { total: list.length, ok };
}

/**
 * 预加载 manifest 中所有已配置 path 的资源
 * @param {(ratio:number, label:string)=>void} [onProgress]
 */
export async function preloadAllAssets(onProgress) {
  const defs = [
    ...Object.values(UNIT_ASSETS),
    ...Object.values(HERO_ASSETS),
    ...Object.values(BUILDING_ASSETS),
  ];
  return preloadAssets(defs, onProgress);
}

/**
 * 预加载一组单位类型对应的资产（用于按需加载）
 * @param {string[]} unitTypes UNITS key 列表
 */
export async function preloadUnits(unitTypes) {
  const defs = unitTypes.map(t => UNIT_ASSETS[t]).filter(Boolean);
  return preloadAssets(defs);
}

/** 启动时必需的核心资产（玩家英雄+城堡+初始兵种+矿场） */
export function getBootAssets() {
  return {
    units: ['pikeman', 'archer', 'griffin', 'swordsman'],
    heroes: ['player'],
    buildings: ['castle_player', 'mine_sawmill', 'mine_ore', 'mine_gold'],
  };
}

/** 后台预加载剩余资产（野怪+敌方+精锐兵种） */
export function getBackgroundAssets() {
  return {
    units: ['champion', 'pikeman2', 'archer2', 'griffin2', 'swordsman2', 'champion2',
            'wolf', 'skeleton', 'orc', 'ghost', 'dragon'],
    heroes: ['enemy'],
    buildings: ['castle_enemy'],
  };
}

/**
 * 按分组预加载资产
 * @param {{units?:string[], heroes?:string[], buildings?:string[]}} groups
 * @param {(ratio:number, label:string)=>void} [onProgress]
 */
export async function preloadGroup(groups, onProgress) {
  const defs = [];
  if (groups.units) for (const t of groups.units) if (UNIT_ASSETS[t]) defs.push(UNIT_ASSETS[t]);
  if (groups.heroes) for (const h of groups.heroes) if (HERO_ASSETS[h]) defs.push(HERO_ASSETS[h]);
  if (groups.buildings) for (const b of groups.buildings) if (BUILDING_ASSETS[b]) defs.push(BUILDING_ASSETS[b]);
  return preloadAssets(defs, onProgress);
}

export function getCached(path) {
  return cache.get(path) || null;
}
