// ================= 统一模型工厂（glTF 优先，原语回退） =================
import * as THREE from 'three';
import {
  makeUnit as makeUnitPrim,
  makeHero as makeHeroPrim,
  makeCastle as makeCastlePrim,
  makeMine as makeMinePrim,
  makePickup,
  makeArtifact,
  makeObstacle,
  makeTree,
} from '../models.js';
import {
  UNIT_ASSETS, HERO_ASSETS, BUILDING_ASSETS, TEAM_COLORS,
  SINGLE_MESH_TINT, SINGLE_MESH_EMISSIVE, hasGlb, isSingleMesh,
} from './manifest.js';
import { getCached, cloneGltfScene } from './loader.js';

/** 材质取数组化（glTF 材质可能是数组） */
function matsOf(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/**
 * 运行时判定「Meshy 单 mesh 模型」：所有网格节点都没有名字。
 * 不能只信 manifest 的 singleMesh 标记——资产管线随时可能把某个 key 底下的
 * glb 换成 Meshy 重制版（已实测发生：pikeman2 被换成无名 9MB 模型），
 * 标记来不及跟着改就会静默退化成「没有队伍色」。名字探测让它自愈。
 * 旧 Blender 模型的网格都有名字（TeamColor / WingL / Flag …），不会误判。
 * @param {THREE.Object3D} root
 */
function detectSingleMesh(root) {
  let meshes = 0, named = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.name) named++;
  });
  return meshes > 0 && named === 0;
}

/**
 * Meshy 单 mesh 资产的材质规整：关掉 emissive。
 * Meshy 导出 emissiveFactor=[1,1,1] + emissiveTexture，配合 main.js 的
 * UnrealBloom threshold 0.85 会让整个模型糊成一团光。压缩管线会删
 * emissiveTexture，这里是运行时的第二道保险（两边都改才稳）。
 * @param {THREE.Object3D} root
 */
function normalizeSingleMeshMaterial(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of matsOf(o)) {
      if (!m || !m.emissive) continue;
      if (SINGLE_MESH_EMISSIVE <= 0) {
        m.emissive.setRGB(0, 0, 0);
        // emissive 为黑时 emissiveMap 无意义，摘掉省一次 2048² 采样
        if (m.emissiveMap) { m.emissiveMap = null; m.needsUpdate = true; }
      } else {
        m.emissive.multiplyScalar(SINGLE_MESH_EMISSIVE);
      }
    }
  });
}

/**
 * 整体色调偏移：把材质 color 往队伍色 lerp 一个小比例。
 * 用于 node/material 名全为 null 的 Meshy 模型——它们没法分部位染色，
 * 只能整体偏色，比例取小以保留贴图细节。
 * @param {THREE.Object3D} root
 * @param {THREE.Color} color
 * @param {number} amount 0..1
 * @returns {number} 被染色的材质数
 */
function applyGlobalTint(root, color, amount) {
  if (!(amount > 0)) return 0;
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of matsOf(o)) {
      if (!m || !m.color) continue;
      // 幂等：同一材质重复调用不会越染越深
      if (m.userData && m.userData.teamTinted) continue;
      m.color.lerp(color, amount);
      if (m.userData) m.userData.teamTinted = true;
      n++;
    }
  });
  return n;
}

/**
 * 给 glTF 模型上队伍色。
 * 旧 Blender 模型走「网格/材质名含 TeamColor」的分部位染色；
 * Meshy 单 mesh 模型（名字全 null，匹配必然落空）走整体色调偏移兜底。
 * @param {THREE.Object3D} root
 * @param {0|1} side
 * @param {import('./manifest.js').AssetDef} [def]
 * @param {boolean} [single] 已判定的 singleMesh 结果（省一次重复探测）
 */
function applyTeamColor(root, side, def, single = isSingleMesh(def)) {
  const color = new THREE.Color(side === 0 ? TEAM_COLORS.player : TEAM_COLORS.enemy);
  let tinted = 0;
  if (!single) {
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const matNames = matsOf(o).map((m) => (m && m.name) || '').join('|');
      const name = (o.name || '') + '|' + matNames;
      if (!/teamcolor/i.test(name)) return;
      for (const m of matsOf(o)) {
        if (m && m.color) { m.color.copy(color); tinted++; }
      }
    });
  }
  // singleMesh，或者模型压根没有 TeamColor 命名（重导出后丢名字也能自愈）
  if (tinted === 0) {
    const amount = typeof def?.teamTint === 'number' ? def.teamTint : SINGLE_MESH_TINT;
    return applyGlobalTint(root, color, amount);
  }
  return tinted;
}

/**
 * 底座阵营光环：整体染色比例很低，俯视小尺寸下敌我主要靠这个环区分，
 * 所以做得比原来明显——加粗 + 自发光 + 外圈柔光盘，敌方额外加脉冲。
 * @param {THREE.Object3D} root
 * @param {0|1} side
 */
function addFactionRing(root, side) {
  if (root.userData.ring) return root.userData.ring;
  const isEnemy = side === 1;
  const ringC = isEnemy ? 0xef4444 : 0x3b82f6;

  const group = new THREE.Group();
  group.name = 'FactionRing';

  // 实心环：自发光，暗处/阴影里也看得见
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.07, 8, 28),
    new THREE.MeshLambertMaterial({
      color: ringC,
      emissive: ringC,
      emissiveIntensity: isEnemy ? 0.75 : 0.8,
    })
  );
  torus.rotation.x = -Math.PI / 2;
  torus.position.y = 0.05;

  // 外圈柔光盘：俯视时扩大可辨识面积
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.8, 28),
    new THREE.MeshBasicMaterial({
      color: ringC,
      transparent: true,
      opacity: isEnemy ? 0.3 : 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.03;

  for (const m of [torus, halo]) {
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
  }

  // 脉冲：敌方明显（速度快/幅度大，峰值越过 bloom threshold 会轻微泛光），
  // 我方只做很慢的微弱呼吸。用 onBeforeRender 自驱，不依赖 battle.js /
  // map.js 的逐帧循环（那两个文件不归本 agent 所有）；取值只依赖绝对时间，
  // 因此同一帧被多个渲染 pass 重复调用也是幂等的。
  const speed = isEnemy ? 3.2 : 1.6;
  const amp = isEnemy ? 0.4 : 0.12;
  const phase = Math.random() * Math.PI * 2;
  const baseEmissive = torus.material.emissiveIntensity;
  const baseOpacity = halo.material.opacity;
  torus.onBeforeRender = () => {
    const s = Math.sin(performance.now() * 0.001 * speed + phase);
    torus.material.emissiveIntensity = baseEmissive * (1 + amp * s);
    halo.material.opacity = baseOpacity * (1 + amp * 1.2 * s);
    const k = 1 + (isEnemy ? 0.06 : 0.02) * s;
    halo.scale.set(k, k, 1);
  };

  root.add(group);
  root.userData.ring = group;
  return group;
}

function finalize(root, def, side) {
  if (!root) return null;
  // manifest 标记优先，名字探测兜底（资产被换成 Meshy 重制版时自愈）
  const single = isSingleMesh(def) || detectSingleMesh(root);
  // 目标高度归一化：AI 生成的模型（Meshy）不论体型都被归一化到最长轴 ≈1.9，
  // 直接用固定 scale 会让相对体型全乱（实测黑龙 1.45 反而矮于枪兵 1.90）。
  // 改为按 manifest 的 targetH 把渲染高度对齐到设计值，换任何模型都自愈。
  // 必须放在下面 Box3 落地计算之前，否则抬升量会按旧尺寸算。
  if (def?.targetH) {
    root.updateMatrixWorld(true);
    const b0 = new THREE.Box3().setFromObject(root);
    const h0 = b0.max.y - b0.min.y;
    if (isFinite(h0) && h0 > 1e-4) root.scale.multiplyScalar(def.targetH / h0);
  } else if (def?.scale && def.scale !== 1) {
    root.scale.multiplyScalar(def.scale);   // 无 targetH 的资产（建筑）沿用固定倍率
  }
  if (def?.rotY) root.rotation.y += def.rotY;   // 朝向修正（glb 默认朝向 → 项目 -Y 前方）
  if (single) normalizeSingleMeshMaterial(root);
  if (side !== undefined) {
    applyTeamColor(root, side, def, single);
  }
  // 兼容旧动画系统
  if (!root.userData.anim) root.userData.anim = {};
  root.userData.singleMesh = single;
  // 尝试绑定翅膀/旗帜节点供待机动画。
  // singleMesh 资产的 node 名全是 null，这里必然一个都匹配不到，直接跳过；
  // 它们的待机由 battle.js / map.js 中 userData.fromGltf 的整体呼吸起伏覆盖。
  if (!single) {
    root.traverse((o) => {
      const n = o.name || '';
      if (/wingl/i.test(n)) {
        root.userData.anim.wings = root.userData.anim.wings || [];
        root.userData.anim.wings[0] = o;
        root.userData.anim.wingBase = o.rotation.z;
      }
      if (/wingr/i.test(n)) {
        root.userData.anim.wings = root.userData.anim.wings || [];
        root.userData.anim.wings[1] = o;
        root.userData.anim.wingBase = root.userData.anim.wingBase ?? Math.abs(o.rotation.z);
      }
      if (/^flag$/i.test(n)) {
        root.userData.flag = o;
        root.userData.anim.flag = o;
      }
      if (/cape|teamcolor/i.test(n) && o.isMesh) root.userData.anim.cape = root.userData.anim.cape || o;
    });
    // wings 必须成对，只绑到一侧会让 battle.js 的 anim.wings[1] 取到 undefined 报错
    const w = root.userData.anim.wings;
    if (w && (!w[0] || !w[1])) delete root.userData.anim.wings;
  }
  root.userData.side = side;

  // 自动计算 yOffset：用包围盒最低点对齐到 y=0（地面）
  // 替代手动 yOffset，消除 Blender 测量与 Three.js 坐标系的偏差
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const minY = box.min.y;
  const needsLift = !isFinite(minY) ? false : minY < -0.01 || minY > 0.01;

  // ★ 永远套一层 wrapper（即使不需要抬升）。原因有二：
  //   1. 抬升：root.position.y = -minY 让模型最低点贴合 y=0
  //   2. **朝向解耦**：外部对 wrapper 调 lookAt()，颠簸/摇晃动画写在内层 root 上。
  //      若两者写在同一个对象上，three.js 对含 -Z 分量（朝北）的朝向会用
  //      (±180°, 180°−θ, ±180°) 这种退化欧拉表示，单独给 .x/.z 赋值会静默丢掉
  //      那对 ±180°，朝向被绕世界 X 轴镜像——实测正北误差 180°（倒着走）、
  //      东北/西北 90°（横着走）。结构统一后此类 bug 从根上不可能发生。
  const wrapper = new THREE.Object3D();
  wrapper.add(root);
  if (needsLift) root.position.y = -minY;
  // 先透传 userData（动画/队伍色等），再加光环。
  // 顺序反了的话，整体赋值会把 addFactionRing 刚写进 wrapper.userData 的
  // ring 引用冲掉，同时让 addFactionRing 的去重守卫失效。
  wrapper.userData = root.userData;
  root.userData.wrapper = wrapper;
  root.userData.root = root;
  // 倾斜动画节点：所有 rotation.x/.z 的颠簸摇晃都必须写这里，不要写 wrapper
  root.userData.animNode = root;
  // 队伍色环加在 wrapper（地面层）：不随模型抬高，也不跟着颠簸倾斜
  if (side !== undefined) addFactionRing(wrapper, side);
  return wrapper;
}

/**
 * 创建单位
 * @param {string} type UNITS key
 * @param {0|1} side
 */
export function createUnit(type, side) {
  const def = UNIT_ASSETS[type];
  if (def && hasGlb(def)) {
    const gltf = getCached(def.path);
    if (gltf) {
      const root = cloneGltfScene(gltf);
      if (root) {
        root.userData.type = type;
        return finalize(root, def, side);
      }
    }
  }
  return makeUnitPrim(type, side);
}

/**
 * 创建英雄
 * @param {'player'|'enemy'} faction
 */
export function createHero(faction = 'player') {
  const key = faction === 'enemy' ? 'enemy' : 'player';
  const def = HERO_ASSETS[key];
  const side = faction === 'enemy' ? 1 : 0;
  if (def && hasGlb(def)) {
    const gltf = getCached(def.path);
    if (gltf) {
      const root = cloneGltfScene(gltf);
      if (root) return finalize(root, def, side);
    }
  }
  return makeHeroPrim(faction);
}

/**
 * 创建城堡
 * @param {'player'|'enemy'} faction
 */
export function createCastle(faction = 'player') {
  const key = faction === 'enemy' ? 'castle_enemy' : 'castle_player';
  const def = BUILDING_ASSETS[key];
  if (def && hasGlb(def)) {
    const gltf = getCached(def.path);
    if (gltf) {
      const root = cloneGltfScene(gltf);
      if (root) {
        // 兼容旗帜动画
        root.traverse((o) => {
          if (/flag/i.test(o.name || '')) root.userData.flag = o;
        });
        return finalize(root, def, faction === 'enemy' ? 1 : 0);
      }
    }
  }
  return makeCastlePrim(faction);
}

/**
 * 创建矿场
 * @param {'sawmill'|'ore'|'gold'} kind
 */
export function createMine(kind) {
  const map = { sawmill: 'mine_sawmill', ore: 'mine_ore', gold: 'mine_gold' };
  const def = BUILDING_ASSETS[map[kind]];
  if (def && hasGlb(def)) {
    const gltf = getCached(def.path);
    if (gltf) {
      const root = cloneGltfScene(gltf);
      if (root) return finalize(root, def);
    }
  }
  return makeMinePrim(kind);
}

export { makePickup, makeArtifact, makeObstacle, makeTree };
