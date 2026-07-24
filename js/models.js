// ================= 低多边形模型工厂（原语拼装 · 升级版） =================
import * as THREE from 'three';
import { UPGRADE_BASE } from './config.js';

const M = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

// 几何体缓存（同规格共享，标记 shared 避免被 dispose）
const GEO_CACHE = new Map();
function cachedGeo(key, make) {
  if (!GEO_CACHE.has(key)) {
    const g = make();
    g.userData.shared = true;
    GEO_CACHE.set(key, g);
  }
  return GEO_CACHE.get(key);
}
const boxGeo = (w, h, d) => cachedGeo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cylGeo = (rt, rb, h, s) => cachedGeo(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const coneGeo = (r, h, s) => cachedGeo(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const sphGeo = r => cachedGeo(`s${r}`, () => new THREE.SphereGeometry(r, 10, 8));

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
const box = (w, h, d, c, x, y, z, o) => mesh(boxGeo(w, h, d), M(c, o), x, y, z);
const cyl = (rt, rb, h, c, x, y, z, seg = 8, o) => mesh(cylGeo(rt, rb, h, seg), M(c, o), x, y, z);
const cone = (r, h, c, x, y, z, seg = 8, o) => mesh(coneGeo(r, h, seg), M(c, o), x, y, z);
const sph = (r, c, x, y, z, o) => mesh(sphGeo(r), M(c, o), x, y, z);

const SKIN = 0xe8c39e;
const TEAM = [0x2c5fa8, 0x8a2a2a]; // 队伍色布料（蓝/红）

// ---------- 马（英雄/骑士共用） ----------
function makeHorsebody(coat, dark) {
  const g = new THREE.Group();
  const body = sph(0.32, coat, 0, 0.56, 0);
  body.scale.set(1, 0.85, 1.6);
  g.add(body);
  const chest = sph(0.24, coat, 0, 0.58, 0.42);
  chest.scale.set(0.9, 0.95, 1);
  g.add(chest);
  const neck = cyl(0.09, 0.14, 0.45, coat, 0, 0.82, 0.5);
  neck.rotation.x = 0.55;
  g.add(neck);
  const head = box(0.15, 0.17, 0.34, coat, 0, 1.0, 0.62);
  head.rotation.x = 0.35;
  g.add(head);
  g.add(cone(0.04, 0.1, dark, -0.06, 1.12, 0.52));
  g.add(cone(0.04, 0.1, dark, 0.06, 1.12, 0.52));
  // 鬃毛
  g.add(box(0.06, 0.3, 0.22, dark, 0, 0.95, 0.38));
  // 尾巴
  const tail = cone(0.07, 0.45, dark, 0, 0.55, -0.55);
  tail.rotation.x = -2.2;
  g.add(tail);
  // 腿（用于行走摆动动画）
  const legs = [];
  [[-0.16, 0.32], [0.16, 0.32], [-0.16, -0.32], [0.16, -0.32]].forEach(([x, z]) => {
    const leg = new THREE.Group();
    leg.position.set(x, 0.42, z);
    const upper = cyl(0.055, 0.04, 0.42, coat, 0, -0.21, 0);
    leg.add(upper);
    leg.add(sph(0.05, dark, 0, -0.42, 0));
    g.add(leg);
    legs.push(leg);
  });
  return { group: g, legs, head };
}

// ---------- 战场/野怪单位 ----------
export function makeUnit(type, side) {
  const upgraded = !!UPGRADE_BASE[type];
  const baseType = UPGRADE_BASE[type] || type;
  const g = new THREE.Group();
  const anim = {};
  const ringC = upgraded ? 0xd4af37 : (side === 0 ? 0x3b82f6 : 0xef4444);
  const ring = mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 24), M(ringC), 0, 0.04, 0);
  ring.rotation.x = -Math.PI / 2;
  ring.castShadow = false;
  g.add(ring);
  g.userData.ring = ring;
  const teamC = TEAM[side];

  // 人形单位通用件：队伍色披风
  const addCape = (y = 0.62, w = 0.3, h = 0.42) => {
    const cape = mesh(new THREE.PlaneGeometry(w, h), M(teamC, { side: THREE.DoubleSide }), 0, y, -0.17);
    cape.rotation.x = 0.22;
    g.add(cape);
    anim.cape = cape;
  };

  switch (baseType) {
    case 'pikeman': {
      g.add(cyl(0.16, 0.21, 0.5, 0x7f96b8, 0, 0.5, 0));
      g.add(box(0.2, 0.3, 0.05, teamC, 0, 0.48, 0.19)); // 队色胸甲
      g.add(sph(0.14, SKIN, 0, 0.88, 0));
      g.add(cone(0.16, 0.22, 0x5a6b80, 0, 1.02, 0));
      const spear = cyl(0.022, 0.022, 1.15, 0x8a6b3d, 0.24, 0.62, 0);
      spear.rotation.z = -0.12; g.add(spear);
      g.add(cone(0.045, 0.16, 0xcfd6dd, 0.31, 1.22, 0));
      addCape();
      break;
    }
    case 'archer': {
      g.add(cyl(0.15, 0.2, 0.48, 0x3f8f4f, 0, 0.49, 0));
      g.add(sph(0.13, SKIN, 0, 0.86, 0));
      g.add(cone(0.16, 0.24, 0x2c6b38, 0, 0.98, 0));
      const bow = mesh(new THREE.TorusGeometry(0.2, 0.022, 6, 16, Math.PI * 1.4), M(0x8a6b3d), 0.24, 0.6, 0);
      bow.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.7); g.add(bow);
      g.add(box(0.1, 0.26, 0.12, 0x6b4f2a, -0.14, 0.62, -0.12));
      addCape(0.58, 0.26, 0.36);
      break;
    }
    case 'griffin': {
      const body = sph(0.3, 0xc9963c, 0, 0.44, 0); body.scale.set(1, 0.75, 1.35); g.add(body);
      g.add(sph(0.16, 0xf0e6d0, 0, 0.62, 0.38));           // 鹰头
      const beak = cone(0.07, 0.16, 0xe0a92e, 0, 0.58, 0.55);
      beak.rotation.x = Math.PI / 2; g.add(beak);
      g.add(sph(0.03, 0x222222, -0.07, 0.66, 0.48));       // 眼
      g.add(sph(0.03, 0x222222, 0.07, 0.66, 0.48));
      // 三层羽翼
      const mkWing = s => {
        const wing = new THREE.Group();
        wing.position.set(0.18 * s, 0.56, -0.02);
        for (let i = 0; i < 3; i++) {
          const f = box(0.42 - i * 0.09, 0.035, 0.24 - i * 0.04, i ? 0xe8dcc0 : 0xf0e6d0, (0.24 - i * 0.02) * s, i * 0.05, -i * 0.05);
          wing.add(f);
        }
        wing.rotation.z = -0.45 * s;
        g.add(wing);
        return wing;
      };
      anim.wings = [mkWing(-1), mkWing(1)];
      anim.wingBase = 0.45;
      const tail = cyl(0.03, 0.05, 0.4, 0xc9963c, 0, 0.42, -0.48); tail.rotation.x = 1.2; g.add(tail);
      break;
    }
    case 'swordsman': {
      g.add(cyl(0.19, 0.24, 0.55, 0x8d99ae, 0, 0.52, 0));
      g.add(box(0.22, 0.4, 0.06, teamC, 0, 0.5, 0.2));
      g.add(sph(0.14, SKIN, 0, 0.9, 0));
      g.add(sph(0.155, 0x6b7686, 0, 0.94, 0));
      g.add(box(0.05, 0.52, 0.1, 0xcfd6dd, 0.28, 0.62, 0.05));
      const shield = box(0.06, 0.38, 0.3, teamC, -0.28, 0.55, 0.05);
      g.add(shield);
      g.add(box(0.07, 0.12, 0.32, 0xd4af37, -0.28, 0.55, 0.05));
      addCape(0.66, 0.34, 0.46);
      break;
    }
    case 'champion': {
      const armor = side === 0 ? 0x33518f : 0x6a2a2a;
      const h = makeHorsebody(0x6b4f2a, 0x3a2c1a);
      g.add(h.group);
      anim.legs = h.legs;
      // 马甲（队色）
      const capa = box(0.5, 0.22, 0.72, armor, 0, 0.52, 0);
      g.add(capa);
      g.add(box(0.52, 0.05, 0.74, 0xd4af37, 0, 0.62, 0));
      // 骑手
      g.add(cyl(0.13, 0.16, 0.4, armor, 0, 0.95, -0.02));
      g.add(sph(0.12, SKIN, 0, 1.23, -0.02));
      g.add(cone(0.13, 0.2, 0xcfd6dd, 0, 1.37, -0.02));
      g.add(cone(0.05, 0.16, teamC, 0, 1.5, -0.02));
      const lance = cyl(0.025, 0.025, 1.25, 0x8a6b3d, 0.2, 1.05, 0.25); lance.rotation.x = 1.1; g.add(lance);
      g.add(cone(0.06, 0.14, 0xd4af37, 0.2, 1.36, 0.78));
      const cape = mesh(new THREE.PlaneGeometry(0.3, 0.44), M(teamC, { side: THREE.DoubleSide }), 0, 0.95, -0.3);
      cape.rotation.x = 0.25;
      g.add(cape);
      anim.cape = cape;
      break;
    }
    case 'wolf': {
      const body = sph(0.24, 0x5b5b66, 0, 0.34, 0); body.scale.set(1, 0.8, 1.7); g.add(body);
      g.add(box(0.18, 0.17, 0.2, 0x5b5b66, 0, 0.48, 0.38));
      g.add(box(0.09, 0.09, 0.16, 0x4a4a52, 0, 0.44, 0.54));
      g.add(cone(0.05, 0.12, 0x4a4a52, -0.07, 0.6, 0.34));
      g.add(cone(0.05, 0.12, 0x4a4a52, 0.07, 0.6, 0.34));
      g.add(sph(0.028, 0xffd76b, -0.06, 0.5, 0.5));        // 眼
      g.add(sph(0.028, 0xffd76b, 0.06, 0.5, 0.5));
      const tail = cone(0.06, 0.35, 0x5b5b66, 0, 0.42, -0.42); tail.rotation.x = -1.8; g.add(tail);
      [[-0.14, 0.2], [0.14, 0.2], [-0.14, -0.22], [0.14, -0.22]].forEach(([x, z]) =>
        g.add(cyl(0.035, 0.03, 0.26, 0x4a4a52, x, 0.13, z)));
      break;
    }
    case 'skeleton': {
      g.add(cyl(0.1, 0.13, 0.5, 0xd8d8c8, 0, 0.5, 0));
      // 肋骨
      for (let i = 0; i < 3; i++) g.add(box(0.22 - i * 0.03, 0.03, 0.14, 0xc8c8b8, 0, 0.42 + i * 0.1, 0.02));
      g.add(sph(0.13, 0xe8e8d8, 0, 0.88, 0));
      g.add(box(0.05, 0.05, 0.02, 0x222222, -0.05, 0.9, 0.12));
      g.add(box(0.05, 0.05, 0.02, 0x222222, 0.05, 0.9, 0.12));
      const arm = cyl(0.03, 0.03, 0.4, 0xd8d8c8, 0.2, 0.6, 0); arm.rotation.z = 0.6; g.add(arm);
      g.add(box(0.04, 0.44, 0.08, 0x9aa0a8, 0.34, 0.6, 0.05));
      g.add(box(0.05, 0.3, 0.22, 0x6a5a3a, -0.2, 0.55, 0.08)); // 破盾
      break;
    }
    case 'orc': {
      g.add(cyl(0.2, 0.25, 0.52, 0x5f7d3a, 0, 0.5, 0));
      g.add(sph(0.15, 0x4a6329, 0, 0.9, 0));
      g.add(box(0.2, 0.08, 0.1, 0x3a4d20, 0, 0.82, 0.08));
      g.add(cone(0.03, 0.08, 0xe8e8d8, -0.06, 0.84, 0.13)); // 獠牙
      g.add(cone(0.03, 0.08, 0xe8e8d8, 0.06, 0.84, 0.13));
      g.add(sph(0.09, 0x4a4a52, -0.2, 0.72, 0));            // 肩甲
      g.add(sph(0.09, 0x4a4a52, 0.2, 0.72, 0));
      const club = cyl(0.04, 0.07, 0.5, 0x6b4f2a, 0.3, 0.62, 0); club.rotation.z = -0.5; g.add(club);
      g.add(sph(0.09, 0x6b4f2a, 0.42, 0.85, 0));
      break;
    }
    case 'ghost': {
      const gm = { transparent: true, opacity: 0.6, emissive: 0x334455 };
      anim.ghostMats = [];
      const bodyC = cone(0.26, 0.8, 0xafc3de, 0, 0.55, 0, 10, gm);
      g.add(bodyC); anim.ghostMats.push(bodyC.material);
      const wisp1 = cone(0.16, 0.4, 0xafc3de, -0.1, 0.22, 0.05, 8, gm);
      wisp1.rotation.z = 0.5; g.add(wisp1); anim.ghostMats.push(wisp1.material);
      const wisp2 = cone(0.14, 0.35, 0xafc3de, 0.12, 0.22, -0.05, 8, gm);
      wisp2.rotation.z = -0.4; g.add(wisp2); anim.ghostMats.push(wisp2.material);
      const headG = sph(0.16, 0xc8d8ea, 0, 1.0, 0, gm);
      g.add(headG); anim.ghostMats.push(headG.material);
      // 发光眼
      g.add(sph(0.035, 0x7df0ff, -0.06, 1.02, 0.13, { emissive: 0x4ac8df, emissiveIntensity: 1 }));
      g.add(sph(0.035, 0x7df0ff, 0.06, 1.02, 0.13, { emissive: 0x4ac8df, emissiveIntensity: 1 }));
      const a1 = cone(0.06, 0.3, 0xafc3de, -0.24, 0.72, 0.08, 6, gm); a1.rotation.z = 0.9; g.add(a1);
      const a2 = cone(0.06, 0.3, 0xafc3de, 0.24, 0.72, 0.08, 6, gm); a2.rotation.z = -0.9; g.add(a2);
      break;
    }
    case 'dragon': {
      // 身躯 + 浅腹
      const body = sph(0.42, 0x7a1f1f, 0, 0.55, 0); body.scale.set(1, 0.75, 1.4); g.add(body);
      const belly = sph(0.34, 0xa8503a, 0, 0.45, 0.1); belly.scale.set(0.85, 0.6, 1.25); g.add(belly);
      // 三段颈 + 头
      g.add(sph(0.17, 0x7a1f1f, 0, 0.78, 0.5));
      g.add(sph(0.14, 0x7a1f1f, 0, 0.95, 0.62));
      const headD = box(0.26, 0.2, 0.38, 0x8a2828, 0, 1.08, 0.78);
      g.add(headD);
      g.add(box(0.2, 0.08, 0.3, 0x6a1818, 0, 0.99, 0.82)); // 下颌
      g.add(sph(0.045, 0xffd76b, -0.09, 1.14, 0.9, { emissive: 0xaa7700, emissiveIntensity: 0.8 }));
      g.add(sph(0.045, 0xffd76b, 0.09, 1.14, 0.9, { emissive: 0xaa7700, emissiveIntensity: 0.8 }));
      const horn1 = cone(0.05, 0.22, 0xe8dcc0, -0.09, 1.24, 0.64); horn1.rotation.x = -0.7; g.add(horn1);
      const horn2 = cone(0.05, 0.22, 0xe8dcc0, 0.09, 1.24, 0.64); horn2.rotation.x = -0.7; g.add(horn2);
      // 翼膜（自定义三角面）+ 翼骨
      const mkWing = s => {
        const wing = new THREE.Group();
        wing.position.set(0.28 * s, 0.72, -0.05);
        const bone = cyl(0.03, 0.03, 0.85, 0x5a1515, 0, 0.3, 0);
        bone.rotation.z = s * 1.1;
        wing.add(bone);
        const memGeo = new THREE.BufferGeometry();
        const v = new Float32Array([
          0, 0, 0, s * 0.85, 0.55, -0.15, s * 0.55, 0.05, -0.55,
          0, 0, 0, s * 0.55, 0.05, -0.55, s * 0.2, -0.02, -0.5,
        ]);
        memGeo.setAttribute('position', new THREE.BufferAttribute(v, 3));
        memGeo.computeVertexNormals();
        const mem = mesh(memGeo, M(0x4a1010, { side: THREE.DoubleSide }), 0, 0, 0);
        wing.add(mem);
        wing.rotation.z = -0.35 * s;
        g.add(wing);
        return wing;
      };
      anim.wings = [mkWing(-1), mkWing(1)];
      anim.wingBase = 0.35;
      // 尾刺
      const tail1 = cone(0.11, 0.7, 0x7a1f1f, 0, 0.5, -0.7); tail1.rotation.x = -1.9; g.add(tail1);
      const tail2 = cone(0.06, 0.4, 0x6a1818, 0, 0.42, -1.15); tail2.rotation.x = -2.1; g.add(tail2);
      const spike = cone(0.08, 0.2, 0xe8dcc0, 0, 0.5, -1.35); spike.rotation.x = -2.4; g.add(spike);
      [[-0.25, 0.25], [0.25, 0.25], [-0.25, -0.3], [0.25, -0.3]].forEach(([x, z]) =>
        g.add(cyl(0.07, 0.06, 0.35, 0x5a1515, x, 0.18, z)));
      g.scale.setScalar(1.3);
      break;
    }
  }
  // 精锐形态：金色肩饰 + 微放大
  if (upgraded) {
    const gold = { emissive: 0x443300 };
    g.add(sph(0.09, 0xd4af37, -0.16, baseType === 'champion' ? 1.15 : 0.95, 0, gold));
    g.add(sph(0.09, 0xd4af37, 0.16, baseType === 'champion' ? 1.15 : 0.95, 0, gold));
    g.scale.multiplyScalar(1.07);
  }
  g.userData.type = type;
  g.userData.side = side;
  g.userData.anim = anim;
  return g;
}

// ---------- 英雄（骑马骑士） ----------
export function makeHero(faction = 'player') {
  const enemy = faction === 'enemy';
  const main = enemy ? 0x8a2a2a : 0x2c5fa8;
  const g = new THREE.Group();
  const h = makeHorsebody(enemy ? 0x2a2226 : 0x4a3820, enemy ? 0x0f0c0e : 0x2a1f12);
  g.add(h.group);
  // 骑手
  g.add(cyl(0.15, 0.19, 0.45, main, 0, 1.02, -0.02));
  g.add(box(0.2, 0.12, 0.06, 0xd4af37, 0, 1.16, 0.12));   // 金胸饰
  g.add(sph(0.13, SKIN, 0, 1.34, -0.02));
  g.add(cone(0.14, 0.22, 0xcfd6dd, 0, 1.49, -0.02));
  g.add(cone(0.05, 0.18, main, 0, 1.62, -0.02));
  const cape = mesh(new THREE.PlaneGeometry(0.36, 0.52), M(main, { side: THREE.DoubleSide }), 0, 1.02, -0.32);
  cape.rotation.x = 0.25;
  g.add(cape);
  const lance = cyl(0.025, 0.025, 1.3, 0x8a6b3d, 0.24, 1.05, 0.3); lance.rotation.x = 1.05; g.add(lance);
  g.add(cone(0.06, 0.16, 0xd4af37, 0.24, 1.42, 0.82));
  // 旗帜
  g.add(cyl(0.02, 0.02, 1.1, 0x8a6b3d, -0.2, 1.3, -0.35));
  const flag = mesh(new THREE.PlaneGeometry(0.42, 0.26), M(main, { side: THREE.DoubleSide }), 0.03, 1.72, -0.35);
  g.add(flag);
  g.userData.anim = { legs: h.legs, cape, flag };
  return g;
}

// ---------- 城堡 ----------
export function makeCastle(faction = 'player') {
  const enemy = faction === 'enemy';
  const roof = enemy ? 0x8a2a2a : 0x3f6fb5;
  const wall = enemy ? 0x8a8078 : 0xb8b0a0;
  const g = new THREE.Group();
  g.add(box(2.6, 1.1, 2.6, wall, 0, 0.55, 0));
  // 城垛
  for (let i = -1; i <= 1; i++) {
    g.add(box(0.3, 0.25, 0.15, wall, i * 0.8, 1.22, 1.28));
    g.add(box(0.3, 0.25, 0.15, wall, i * 0.8, 1.22, -1.28));
    g.add(box(0.15, 0.25, 0.3, wall, 1.28, 1.22, i * 0.8));
    g.add(box(0.15, 0.25, 0.3, wall, -1.28, 1.22, i * 0.8));
  }
  g.add(box(1.3, 1.7, 1.3, wall, 0, 1.4, 0));
  g.add(cone(1.05, 0.8, roof, 0, 2.65, 0, 4));
  [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]].forEach(([x, z]) => {
    g.add(cyl(0.34, 0.38, 1.9, wall, x, 0.95, z, 10));
    g.add(cone(0.45, 0.6, roof, x, 2.2, z, 10));
  });
  g.add(box(0.6, 0.7, 0.15, 0x4a3820, 0, 0.35, 1.32));
  // 发光窗（夜间更亮）
  const win1 = box(0.18, 0.24, 0.05, 0xffd76b, -0.3, 1.5, 0.66, { emissive: 0x664400, emissiveIntensity: 0.5 });
  const win2 = box(0.18, 0.24, 0.05, 0xffd76b, 0.3, 1.5, 0.66, { emissive: 0x664400, emissiveIntensity: 0.5 });
  win1.userData.lamp = win2.userData.lamp = true;
  g.add(win1, win2);
  g.add(cyl(0.02, 0.02, 1.0, 0x8a6b3d, 0, 3.4, 0));
  const flag = mesh(new THREE.PlaneGeometry(0.5, 0.3), M(roof, { side: THREE.DoubleSide }), 0.27, 3.7, 0);
  g.add(flag);
  g.userData.flag = flag;
  return g;
}

// ---------- 矿场 ----------
export function makeMine(kind) {
  const g = new THREE.Group();
  if (kind === 'sawmill') {
    g.add(box(1.1, 0.7, 0.9, 0x8a6b3d, 0, 0.35, 0));
    const roof = box(1.3, 0.08, 1.1, 0x6b4f2a, 0, 0.78, 0); roof.rotation.z = 0.12; g.add(roof);
    g.add(cyl(0.12, 0.12, 0.9, 0x9a7b4d, -0.8, 0.12, 0.3));
    g.add(cyl(0.12, 0.12, 0.9, 0x8a6b3d, -0.8, 0.36, 0.3));
    const wheel = mesh(new THREE.TorusGeometry(0.3, 0.06, 8, 14), M(0x7a5b30), 0.62, 0.35, 0);
    wheel.rotation.y = Math.PI / 2; g.add(wheel);
    g.userData.wheel = wheel;
  } else {
    const rockC = kind === 'gold' ? 0x8a7a4a : 0x6a6d71;
    g.add(box(1.2, 0.9, 1.0, 0x5a5d61, 0, 0.45, -0.2));
    g.add(box(0.6, 0.6, 0.2, 0x1a1a1a, 0, 0.3, 0.32));
    g.add(box(0.1, 0.7, 0.1, 0x8a6b3d, -0.35, 0.35, 0.35));
    g.add(box(0.1, 0.7, 0.1, 0x8a6b3d, 0.35, 0.35, 0.35));
    g.add(box(0.8, 0.1, 0.1, 0x8a6b3d, 0, 0.72, 0.35));
    const ore = mesh(new THREE.DodecahedronGeometry(0.22), M(kind === 'gold' ? 0xd4af37 : rockC,
      kind === 'gold' ? { emissive: 0x554400 } : {}), 0.55, 0.2, 0.5);
    g.add(ore);
    g.add(mesh(new THREE.DodecahedronGeometry(0.16), M(rockC), 0.85, 0.14, 0.35));
  }
  return g;
}

// ---------- 资源拾取物 ----------
export function makePickup(kind) {
  const g = new THREE.Group();
  if (kind === 'gold') {
    g.add(cyl(0.28, 0.3, 0.08, 0xd4af37, 0, 0.05, 0, 12, { emissive: 0x443300 }));
    g.add(cyl(0.22, 0.24, 0.08, 0xe0bf47, 0.05, 0.13, 0.03, 12, { emissive: 0x443300 }));
    g.add(cyl(0.16, 0.18, 0.08, 0xd4af37, -0.03, 0.21, -0.02, 12, { emissive: 0x443300 }));
  } else if (kind === 'wood') {
    const l1 = cyl(0.11, 0.11, 0.8, 0x8a6b3d, 0, 0.11, 0); l1.rotation.z = Math.PI / 2; g.add(l1);
    const l2 = cyl(0.11, 0.11, 0.8, 0x9a7b4d, 0, 0.11, 0.22); l2.rotation.z = Math.PI / 2; g.add(l2);
    const l3 = cyl(0.11, 0.11, 0.8, 0x8a6b3d, 0, 0.32, 0.11); l3.rotation.z = Math.PI / 2; g.add(l3);
  } else if (kind === 'ore') {
    g.add(mesh(new THREE.DodecahedronGeometry(0.26), M(0x7a7d81), 0, 0.2, 0));
    g.add(mesh(new THREE.DodecahedronGeometry(0.18), M(0x8a8d91), 0.3, 0.13, 0.15));
    g.add(mesh(new THREE.DodecahedronGeometry(0.14), M(0x6a6d71), -0.25, 0.1, 0.2));
  } else {
    g.add(box(0.55, 0.3, 0.38, 0x6b4f2a, 0, 0.15, 0));
    const lid = box(0.55, 0.14, 0.38, 0x8a6b3d, 0, 0.36, -0.06); lid.rotation.x = -0.5; g.add(lid);
    g.add(box(0.58, 0.06, 0.4, 0xd4af37, 0, 0.28, 0));
  }
  return g;
}

// ---------- 宝物 ----------
export function makeArtifact(color) {
  const g = new THREE.Group();
  const gem = mesh(new THREE.OctahedronGeometry(0.28), M(color, { emissive: color, emissiveIntensity: 0.45 }), 0, 0.7, 0);
  g.add(gem);
  const ring = mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 24), M(color, { emissive: color, emissiveIntensity: 0.3 }), 0, 0.7, 0);
  g.add(ring);
  g.userData.gem = gem;
  g.userData.spinRing = ring;
  return g;
}

// ---------- 战场障碍物 ----------
export function makeObstacle() {
  const g = new THREE.Group();
  if (Math.random() < 0.5) {
    g.add(mesh(new THREE.DodecahedronGeometry(0.4), M(0x6a6d71), 0, 0.3, 0));
    g.add(mesh(new THREE.DodecahedronGeometry(0.25), M(0x7a7d81), 0.35, 0.18, 0.2));
  } else {
    g.add(cyl(0.14, 0.2, 0.5, 0x6b4f2a, 0, 0.25, 0));
    g.add(sph(0.3, 0x3d6b35, 0, 0.62, 0));
  }
  return g;
}

// ---------- 装饰树 ----------
export function makeTree() {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.1, 0.5, 0x6b4f2a, 0, 0.25, 0));
  g.add(cone(0.4, 1.0, 0x3d6b35, 0, 0.95, 0));
  g.add(cone(0.28, 0.7, 0x5a9a4a, 0, 1.45, 0));
  return g;
}
