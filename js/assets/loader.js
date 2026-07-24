// ================= glTF 资源加载与缓存 =================
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { UNIT_ASSETS, HERO_ASSETS, BUILDING_ASSETS, hasGlb } from './manifest.js';

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
        const cloneMat = (m) => { if (m.map) m.map.userData.shared = true; return m.clone(); };
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
 * 预加载 manifest 中所有已配置 path 的资源
 * @param {(ratio:number, label:string)=>void} [onProgress]
 */
export async function preloadAllAssets(onProgress) {
  const paths = new Set();
  for (const def of Object.values(UNIT_ASSETS)) if (hasGlb(def)) paths.add(def.path);
  for (const def of Object.values(HERO_ASSETS)) if (hasGlb(def)) paths.add(def.path);
  for (const def of Object.values(BUILDING_ASSETS)) if (hasGlb(def)) paths.add(def.path);
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

export function getCached(path) {
  return cache.get(path) || null;
}
