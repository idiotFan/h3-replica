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
import { UNIT_ASSETS, HERO_ASSETS, BUILDING_ASSETS, TEAM_COLORS, hasGlb } from './manifest.js';
import { getCached, cloneGltfScene } from './loader.js';

/**
 * 给 glTF 模型上队伍色（网格/材质名含 TeamColor）
 * @param {THREE.Object3D} root
 * @param {0|1} side
 */
function applyTeamColor(root, side) {
  const color = new THREE.Color(side === 0 ? TEAM_COLORS.player : TEAM_COLORS.enemy);
  root.traverse((o) => {
    const name = (o.name || '') + (o.material?.name || '');
    if (!/teamcolor/i.test(name)) return;
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.color) m.color.copy(color);
        if (m.emissive && m.emissiveIntensity > 0) { /* keep */ }
      }
    }
  });
}

function addFactionRing(root, side) {
  if (root.userData.ring) return;
  const ringC = side === 0 ? 0x3b82f6 : 0xef4444;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.05, 8, 24),
    new THREE.MeshLambertMaterial({ color: ringC })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.castShadow = false;
  root.add(ring);
  root.userData.ring = ring;
}

function finalize(root, def, side) {
  if (!root) return null;
  if (def?.scale && def.scale !== 1) root.scale.multiplyScalar(def.scale);
  if (def?.yOffset) root.position.y += def.yOffset;
  if (side !== undefined) {
    applyTeamColor(root, side);
    addFactionRing(root, side);
  }
  // 兼容旧动画系统
  if (!root.userData.anim) root.userData.anim = {};
  // 尝试绑定翅膀/旗帜节点供待机动画
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
  root.userData.side = side;
  return root;
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
