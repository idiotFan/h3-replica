/**
 * 生成中等精度低多边形 glb（无需 Blender）
 * 用法：node scripts/gen_glb.mjs
 * 面数目标：步兵 ~1200，骑乘 ~3500，龙 ~5000（符合 ART_SPEC）
 */
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() { this.result = null; this.onload = null; this.onerror = null; this.onloadend = null; }
    readAsArrayBuffer(blob) {
      Promise.resolve(blob.arrayBuffer ? blob.arrayBuffer() : blob).then((buf) => {
        this.result = buf;
        const ev = { target: this };
        this.onload?.(ev); this.onloadend?.(ev);
      }).catch((e) => this.onerror?.(e));
    }
    readAsDataURL(blob) {
      Promise.resolve(blob.arrayBuffer ? blob.arrayBuffer() : blob).then((buf) => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
        const ev = { target: this };
        this.onload?.(ev); this.onloadend?.(ev);
      }).catch((e) => this.onerror?.(e));
    }
  };
}
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'art', 'export');

const SKIN = 0xe8c39e;
const TEAM_P = 0x2c5fa8;
const TEAM_E = 0x8a2a2a;
// 提高分段：圆柱/球更圆润
const SEG = 16;
const SEG_HI = 20;

function M(c, o = {}) {
  return new THREE.MeshStandardMaterial({
    color: c, roughness: o.roughness ?? 0.72, metalness: o.metalness ?? 0,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 0,
    transparent: !!o.transparent, opacity: o.opacity ?? 1, name: o.name || '',
    side: o.side ?? THREE.FrontSide, flatShading: !!o.flat,
  });
}
function add(parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function limb(parent, mat, x, y, z, h = 0.28, r = 0.045) {
  return add(parent, new THREE.CylinderGeometry(r * 0.85, r, h, 10), mat, x, y, z);
}

// ---------- 人形骨架 ----------
function buildHumanoid(opts) {
  const {
    team = TEAM_P, bodyC = 0x7f96b8, armorMetal = 0.35,
    helm = true, helmC = 0x5a6b80, name = 'unit',
    elite = false,
  } = opts;
  const g = new THREE.Group();
  g.name = name;
  const bodyMat = M(bodyC, { metalness: armorMetal, roughness: 0.45 });
  const skinMat = M(SKIN, { roughness: 0.65 });
  const teamMat = M(elite ? 0xd4af37 : team, { name: 'TeamColor', roughness: 0.7, metalness: elite ? 0.45 : 0.1 });

  // 躯干（略有腰线）
  add(g, new THREE.CylinderGeometry(0.15, 0.19, 0.38, SEG), bodyMat, 0, 0.55, 0);
  add(g, new THREE.CylinderGeometry(0.17, 0.15, 0.18, SEG), bodyMat, 0, 0.78, 0); // 胸
  // 队色战袍
  const tab = add(g, new THREE.BoxGeometry(0.24, 0.36, 0.07), teamMat, 0, 0.58, 0.145);
  tab.name = 'TeamColor';
  // 头
  add(g, new THREE.SphereGeometry(0.125, SEG_HI, SEG), skinMat, 0, 0.98, 0);
  if (helm) {
    add(g, new THREE.SphereGeometry(0.135, SEG, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      M(helmC, { metalness: 0.55, roughness: 0.35 }), 0, 1.02, 0);
    add(g, new THREE.ConeGeometry(0.14, 0.18, SEG), M(helmC, { metalness: 0.5, roughness: 0.4 }), 0, 1.14, 0);
  }
  // 四肢
  limb(g, bodyMat, -0.2, 0.62, 0, 0.32, 0.05); // 左臂
  limb(g, bodyMat, 0.2, 0.62, 0, 0.32, 0.05);
  limb(g, M(0x4a4038, { roughness: 0.9 }), -0.09, 0.2, 0, 0.36, 0.055); // 腿
  limb(g, M(0x4a4038, { roughness: 0.9 }), 0.09, 0.2, 0, 0.36, 0.055);
  // 披风
  const cape = add(g, new THREE.PlaneGeometry(0.36, 0.5, 4, 6), teamMat, 0, 0.58, -0.17);
  cape.name = 'TeamColor';
  cape.rotation.x = 0.22;
  if (elite) {
    add(g, new THREE.SphereGeometry(0.04, 8, 8), M(0xd4af37, { metalness: 0.8, roughness: 0.3, emissive: 0x443300, emissiveIntensity: 0.2 }), -0.16, 0.88, 0.08);
    add(g, new THREE.SphereGeometry(0.04, 8, 8), M(0xd4af37, { metalness: 0.8, roughness: 0.3, emissive: 0x443300, emissiveIntensity: 0.2 }), 0.16, 0.88, 0.08);
  }
  return g;
}

function buildPikeman(team = TEAM_P, elite = false) {
  const g = buildHumanoid({ team, bodyC: 0x7f96b8, name: 'pikeman', elite });
  add(g, new THREE.CylinderGeometry(0.018, 0.018, 1.25, 8), M(0x8a6b3d, { roughness: 0.9 }), 0.28, 0.7, 0.05);
  add(g, new THREE.ConeGeometry(0.045, 0.16, 8), M(0xcfd6dd, { metalness: 0.75, roughness: 0.28 }), 0.28, 1.35, 0.05);
  return g;
}

function buildArcher(team = TEAM_P, elite = false) {
  const g = buildHumanoid({ team, bodyC: 0x3f8f4f, helmC: 0x2c6b38, armorMetal: 0.1, name: 'archer', elite });
  const bow = add(g, new THREE.TorusGeometry(0.22, 0.018, 8, 24, Math.PI * 1.35), M(0x8a6b3d, { roughness: 0.9 }), 0.24, 0.6, 0.02);
  bow.rotation.set(0, Math.PI / 2, 0.85);
  add(g, new THREE.BoxGeometry(0.1, 0.28, 0.1), M(0x6b4f2a), -0.16, 0.6, -0.1); // 箭袋
  return g;
}

function buildSwordsman(team = TEAM_P, elite = false) {
  const g = buildHumanoid({ team, bodyC: 0x8d99ae, helmC: 0x6b7686, armorMetal: 0.45, name: 'swordsman', elite });
  add(g, new THREE.BoxGeometry(0.04, 0.52, 0.1), M(0xcfd6dd, { metalness: 0.75, roughness: 0.28 }), 0.28, 0.62, 0.06);
  add(g, new THREE.BoxGeometry(0.06, 0.38, 0.3), M(team, { name: 'TeamColor', metalness: 0.2 }), -0.26, 0.55, 0.06).name = 'TeamColor';
  add(g, new THREE.BoxGeometry(0.07, 0.12, 0.32), M(0xd4af37, { metalness: 0.7, roughness: 0.35 }), -0.26, 0.55, 0.06);
  return g;
}

function buildHorse(coat = 0x4a3820) {
  const g = new THREE.Group();
  const mat = M(coat, { roughness: 0.82 });
  const dark = M(0x2a1f12, { roughness: 0.9 });
  add(g, new THREE.SphereGeometry(0.3, SEG_HI, SEG), mat, 0, 0.52, 0, 1.05, 0.82, 1.55);
  add(g, new THREE.SphereGeometry(0.2, SEG, 12), mat, 0, 0.58, 0.42, 0.9, 0.95, 1.05);
  add(g, new THREE.CylinderGeometry(0.09, 0.12, 0.38, 12), mat, 0, 0.78, 0.48).rotation.x = 0.5;
  add(g, new THREE.BoxGeometry(0.15, 0.15, 0.3), mat, 0, 0.98, 0.62);
  add(g, new THREE.BoxGeometry(0.08, 0.28, 0.2), dark, 0, 0.95, 0.38); // 鬃
  const tail = add(g, new THREE.ConeGeometry(0.07, 0.42, 8), dark, 0, 0.52, -0.55);
  tail.rotation.x = -2.15;
  [[-0.14, 0.28], [0.14, 0.28], [-0.14, -0.28], [0.14, -0.28]].forEach(([x, z]) => {
    add(g, new THREE.CylinderGeometry(0.048, 0.04, 0.48, 10), dark, x, 0.24, z);
    add(g, new THREE.SphereGeometry(0.045, 8, 6), dark, x, 0.02, z);
  });
  return g;
}

function buildHero(team = TEAM_P, elite = false) {
  const g = new THREE.Group();
  g.name = 'hero';
  g.add(buildHorse(elite ? 0x3a2c1a : 0x4a3820));
  const teamMat = M(elite ? 0xd4af37 : team, { name: 'TeamColor', roughness: 0.65, metalness: elite ? 0.4 : 0.15 });
  // 鞍 + 骑手
  add(g, new THREE.BoxGeometry(0.42, 0.1, 0.55), teamMat, 0, 0.72, -0.02).name = 'TeamColor';
  add(g, new THREE.CylinderGeometry(0.12, 0.15, 0.4, SEG), teamMat, 0, 1.02, -0.02).name = 'TeamColor';
  add(g, new THREE.SphereGeometry(0.115, SEG_HI, SEG), M(SKIN), 0, 1.32, -0.02);
  add(g, new THREE.SphereGeometry(0.12, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    M(0xcfd6dd, { metalness: 0.55, roughness: 0.32 }), 0, 1.36, -0.02);
  add(g, new THREE.ConeGeometry(0.05, 0.14, 8), teamMat, 0, 1.55, -0.02).name = 'TeamColor';
  const cape = add(g, new THREE.PlaneGeometry(0.36, 0.52, 4, 6), teamMat, 0, 1.02, -0.3);
  cape.name = 'TeamColor';
  cape.rotation.x = 0.28;
  const lance = add(g, new THREE.CylinderGeometry(0.02, 0.02, 1.3, 8), M(0x8a6b3d, { roughness: 0.9 }), 0.24, 1.08, 0.28);
  lance.rotation.x = 1.05;
  add(g, new THREE.ConeGeometry(0.05, 0.14, 8), M(0xd4af37, { metalness: 0.85, roughness: 0.25 }), 0.24, 1.42, 0.82);
  add(g, new THREE.CylinderGeometry(0.014, 0.014, 1.05, 6), M(0x8a6b3d), -0.18, 1.38, -0.3);
  const flag = add(g, new THREE.PlaneGeometry(0.42, 0.26, 2, 2), teamMat, 0.05, 1.78, -0.3);
  flag.name = 'Flag';
  return g;
}

function buildGriffin() {
  const g = new THREE.Group();
  g.name = 'griffin';
  const fur = M(0xc9963c, { roughness: 0.7 });
  const cream = M(0xf0e6d0, { roughness: 0.75 });
  add(g, new THREE.SphereGeometry(0.28, SEG_HI, SEG), fur, 0, 0.44, 0, 1, 0.78, 1.35);
  add(g, new THREE.SphereGeometry(0.15, SEG, 12), cream, 0, 0.62, 0.38);
  add(g, new THREE.ConeGeometry(0.055, 0.14, 8), M(0xe0a92e, { roughness: 0.5 }), 0, 0.56, 0.54).rotation.x = Math.PI / 2;
  add(g, new THREE.SphereGeometry(0.025, 8, 6), M(0x222222), -0.06, 0.66, 0.48);
  add(g, new THREE.SphereGeometry(0.025, 8, 6), M(0x222222), 0.06, 0.66, 0.48);
  // 多层羽翼
  for (let layer = 0; layer < 3; layer++) {
    const wL = add(g, new THREE.BoxGeometry(0.48 - layer * 0.08, 0.035, 0.26 - layer * 0.04), cream,
      -0.28 - layer * 0.04, 0.58 + layer * 0.04, -0.04 - layer * 0.03);
    wL.rotation.z = 0.4 + layer * 0.08;
    if (layer === 0) wL.name = 'WingL';
    const wR = add(g, new THREE.BoxGeometry(0.48 - layer * 0.08, 0.035, 0.26 - layer * 0.04), cream,
      0.28 + layer * 0.04, 0.58 + layer * 0.04, -0.04 - layer * 0.03);
    wR.rotation.z = -0.4 - layer * 0.08;
    if (layer === 0) wR.name = 'WingR';
  }
  const tail = add(g, new THREE.ConeGeometry(0.05, 0.4, 8), fur, 0, 0.4, -0.48);
  tail.rotation.x = 1.15;
  limb(g, fur, -0.12, 0.18, 0.15, 0.28, 0.04);
  limb(g, fur, 0.12, 0.18, 0.15, 0.28, 0.04);
  return g;
}

function buildDragon() {
  const g = new THREE.Group();
  g.name = 'dragon';
  const red = M(0x7a1f1f, { roughness: 0.55, metalness: 0.15 });
  const belly = M(0xa8503a, { roughness: 0.65 });
  const dark = M(0x4a1010, { roughness: 0.7, side: THREE.DoubleSide });
  add(g, new THREE.SphereGeometry(0.4, SEG_HI, SEG), red, 0, 0.55, 0, 1, 0.72, 1.45);
  add(g, new THREE.SphereGeometry(0.3, SEG, 14), belly, 0, 0.42, 0.1, 0.88, 0.55, 1.2);
  // 颈段
  add(g, new THREE.SphereGeometry(0.15, 12, 10), red, 0, 0.78, 0.48);
  add(g, new THREE.SphereGeometry(0.12, 12, 10), red, 0, 0.95, 0.62);
  add(g, new THREE.BoxGeometry(0.24, 0.18, 0.36), M(0x8a2828, { roughness: 0.5 }), 0, 1.08, 0.78);
  add(g, new THREE.SphereGeometry(0.035, 8, 6), M(0xffd76b, { emissive: 0xaa7700, emissiveIntensity: 1 }), -0.08, 1.14, 0.92);
  add(g, new THREE.SphereGeometry(0.035, 8, 6), M(0xffd76b, { emissive: 0xaa7700, emissiveIntensity: 1 }), 0.08, 1.14, 0.92);
  const hornL = add(g, new THREE.ConeGeometry(0.04, 0.2, 8), M(0xe8dcc0, { roughness: 0.4 }), -0.08, 1.24, 0.64);
  hornL.rotation.x = -0.65;
  const hornR = add(g, new THREE.ConeGeometry(0.04, 0.2, 8), M(0xe8dcc0, { roughness: 0.4 }), 0.08, 1.24, 0.64);
  hornR.rotation.x = -0.65;
  // 翼膜
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 0.9, 0.55, -0.12, 0.55, 0.08, -0.55,
    0, 0, 0, 0.55, 0.08, -0.55, 0.12, -0.02, -0.48,
    0, 0, 0, 0.9, 0.55, -0.12, 0.75, 0.35, 0.15,
  ]), 3));
  wingGeo.computeVertexNormals();
  const wL = new THREE.Mesh(wingGeo, dark);
  wL.position.set(-0.3, 0.75, -0.05);
  wL.rotation.z = 0.35;
  wL.name = 'WingL';
  wL.castShadow = true;
  g.add(wL);
  const wR = wL.clone();
  wR.position.x = 0.3;
  wR.rotation.z = -0.35;
  wR.scale.x = -1;
  wR.name = 'WingR';
  g.add(wR);
  // 翼骨
  add(g, new THREE.CylinderGeometry(0.025, 0.02, 0.9, 8), M(0x5a1515), -0.55, 0.95, -0.15).rotation.z = 0.9;
  add(g, new THREE.CylinderGeometry(0.025, 0.02, 0.9, 8), M(0x5a1515), 0.55, 0.95, -0.15).rotation.z = -0.9;
  const tail = add(g, new THREE.ConeGeometry(0.11, 0.9, 10), red, 0, 0.48, -0.8);
  tail.rotation.x = -1.9;
  const spike = add(g, new THREE.ConeGeometry(0.07, 0.22, 6), M(0xe8dcc0), 0, 0.48, -1.35);
  spike.rotation.x = -2.3;
  [[-0.22, 0.22], [0.22, 0.22], [-0.22, -0.28], [0.22, -0.28]].forEach(([x, z]) => {
    add(g, new THREE.CylinderGeometry(0.06, 0.05, 0.38, 8), M(0x5a1515), x, 0.2, z);
  });
  g.scale.setScalar(1.15);
  return g;
}

function buildWolf() {
  const g = new THREE.Group();
  const fur = M(0x5b5b66, { roughness: 0.88 });
  add(g, new THREE.SphereGeometry(0.22, SEG, 14), fur, 0, 0.34, 0, 1, 0.78, 1.7);
  add(g, new THREE.BoxGeometry(0.17, 0.15, 0.2), fur, 0, 0.46, 0.4);
  add(g, new THREE.BoxGeometry(0.08, 0.08, 0.14), M(0x4a4a52), 0, 0.42, 0.55);
  add(g, new THREE.ConeGeometry(0.04, 0.1, 6), M(0x4a4a52), -0.06, 0.58, 0.36);
  add(g, new THREE.ConeGeometry(0.04, 0.1, 6), M(0x4a4a52), 0.06, 0.58, 0.36);
  add(g, new THREE.SphereGeometry(0.022, 6, 6), M(0xffd76b, { emissive: 0xaa8800, emissiveIntensity: 0.4 }), -0.05, 0.48, 0.5);
  add(g, new THREE.SphereGeometry(0.022, 6, 6), M(0xffd76b, { emissive: 0xaa8800, emissiveIntensity: 0.4 }), 0.05, 0.48, 0.5);
  const tail = add(g, new THREE.ConeGeometry(0.055, 0.32, 8), fur, 0, 0.4, -0.42);
  tail.rotation.x = -1.7;
  [[-0.12, 0.18], [0.12, 0.18], [-0.12, -0.2], [0.12, -0.2]].forEach(([x, z]) => {
    limb(g, fur, x, 0.16, z, 0.26, 0.035);
  });
  return g;
}

function buildSkeleton() {
  const g = new THREE.Group();
  const bone = M(0xd8d8c8, { roughness: 0.8 });
  add(g, new THREE.CylinderGeometry(0.08, 0.11, 0.42, 10), bone, 0, 0.52, 0);
  for (let i = 0; i < 4; i++) add(g, new THREE.BoxGeometry(0.2 - i * 0.02, 0.025, 0.12), bone, 0, 0.4 + i * 0.08, 0.04);
  add(g, new THREE.SphereGeometry(0.12, SEG, 12), M(0xe8e8d8, { roughness: 0.75 }), 0, 0.9, 0);
  add(g, new THREE.BoxGeometry(0.04, 0.04, 0.02), M(0x111111), -0.04, 0.92, 0.1);
  add(g, new THREE.BoxGeometry(0.04, 0.04, 0.02), M(0x111111), 0.04, 0.92, 0.1);
  limb(g, bone, 0.18, 0.58, 0, 0.35, 0.03);
  add(g, new THREE.BoxGeometry(0.035, 0.44, 0.07), M(0x9aa0a8, { metalness: 0.5, roughness: 0.4 }), 0.32, 0.58, 0.04);
  limb(g, bone, -0.08, 0.2, 0, 0.32, 0.035);
  limb(g, bone, 0.08, 0.2, 0, 0.32, 0.035);
  return g;
}

function buildOrc() {
  const g = new THREE.Group();
  const skin = M(0x5f7d3a, { roughness: 0.75 });
  add(g, new THREE.CylinderGeometry(0.18, 0.23, 0.48, SEG), skin, 0, 0.5, 0);
  add(g, new THREE.SphereGeometry(0.14, SEG, 12), M(0x4a6329, { roughness: 0.7 }), 0, 0.9, 0);
  add(g, new THREE.ConeGeometry(0.025, 0.08, 5), M(0xe8e8d8), -0.05, 0.84, 0.12);
  add(g, new THREE.ConeGeometry(0.025, 0.08, 5), M(0xe8e8d8), 0.05, 0.84, 0.12);
  add(g, new THREE.SphereGeometry(0.08, 10, 8), M(0x4a4a52, { metalness: 0.4 }), -0.2, 0.72, 0);
  add(g, new THREE.SphereGeometry(0.08, 10, 8), M(0x4a4a52, { metalness: 0.4 }), 0.2, 0.72, 0);
  const club = add(g, new THREE.CylinderGeometry(0.035, 0.065, 0.5, 8), M(0x6b4f2a, { roughness: 0.9 }), 0.3, 0.6, 0);
  club.rotation.z = -0.45;
  add(g, new THREE.SphereGeometry(0.09, 10, 8), M(0x6b4f2a), 0.42, 0.85, 0);
  limb(g, skin, -0.1, 0.2, 0, 0.35, 0.055);
  limb(g, skin, 0.1, 0.2, 0, 0.35, 0.055);
  return g;
}

function buildGhost() {
  const g = new THREE.Group();
  const mat = M(0xafc3de, { transparent: true, opacity: 0.6, emissive: 0x223344, emissiveIntensity: 0.4, roughness: 0.35 });
  add(g, new THREE.ConeGeometry(0.24, 0.85, 14), mat, 0, 0.52, 0);
  add(g, new THREE.SphereGeometry(0.15, SEG, 12), mat, 0, 0.98, 0);
  add(g, new THREE.ConeGeometry(0.14, 0.35, 10), mat, -0.1, 0.2, 0.04).rotation.z = 0.45;
  add(g, new THREE.ConeGeometry(0.12, 0.3, 10), mat, 0.12, 0.18, -0.03).rotation.z = -0.4;
  add(g, new THREE.SphereGeometry(0.03, 8, 6), M(0x7df0ff, { emissive: 0x4ac8df, emissiveIntensity: 1.2 }), -0.05, 1.0, 0.12);
  add(g, new THREE.SphereGeometry(0.03, 8, 6), M(0x7df0ff, { emissive: 0x4ac8df, emissiveIntensity: 1.2 }), 0.05, 1.0, 0.12);
  return g;
}

function buildCastle(team = TEAM_P) {
  const g = new THREE.Group();
  g.name = 'castle';
  const wall = M(0xb8b0a0, { roughness: 0.92, metalness: 0.05 });
  const roof = M(team, { name: 'TeamColor', roughness: 0.65, metalness: 0.1 });
  add(g, new THREE.BoxGeometry(2.55, 1.15, 2.55), wall, 0, 0.57, 0);
  // 城垛
  for (let i = -1; i <= 1; i++) {
    add(g, new THREE.BoxGeometry(0.28, 0.22, 0.14), wall, i * 0.75, 1.25, 1.28);
    add(g, new THREE.BoxGeometry(0.28, 0.22, 0.14), wall, i * 0.75, 1.25, -1.28);
    add(g, new THREE.BoxGeometry(0.14, 0.22, 0.28), wall, 1.28, 1.25, i * 0.75);
    add(g, new THREE.BoxGeometry(0.14, 0.22, 0.28), wall, -1.28, 1.25, i * 0.75);
  }
  add(g, new THREE.BoxGeometry(1.3, 1.7, 1.3), wall, 0, 1.4, 0);
  add(g, new THREE.ConeGeometry(1.02, 0.78, 4), roof, 0, 2.6, 0).name = 'TeamColor';
  [[-1.12, -1.12], [1.12, -1.12], [-1.12, 1.12], [1.12, 1.12]].forEach(([x, z]) => {
    add(g, new THREE.CylinderGeometry(0.32, 0.36, 1.9, SEG), wall, x, 0.95, z);
    add(g, new THREE.ConeGeometry(0.42, 0.58, SEG), roof, x, 2.15, z).name = 'TeamColor';
  });
  add(g, new THREE.BoxGeometry(0.55, 0.68, 0.14), M(0x4a3820, { roughness: 0.95 }), 0, 0.34, 1.3);
  const winM = M(0xffd76b, { emissive: 0x664400, emissiveIntensity: 0.6, roughness: 0.4 });
  add(g, new THREE.BoxGeometry(0.16, 0.22, 0.05), winM, -0.28, 1.48, 0.66);
  add(g, new THREE.BoxGeometry(0.16, 0.22, 0.05), winM, 0.28, 1.48, 0.66);
  add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.95, 8), M(0x8a6b3d), 0, 3.35, 0);
  const flag = add(g, new THREE.PlaneGeometry(0.48, 0.28, 2, 2), roof, 0.26, 3.65, 0);
  flag.name = 'Flag';
  return g;
}

function buildMine(kind) {
  const g = new THREE.Group();
  if (kind === 'sawmill') {
    add(g, new THREE.BoxGeometry(1.15, 0.72, 0.95), M(0x8a6b3d, { roughness: 0.95 }), 0, 0.36, 0);
    add(g, new THREE.BoxGeometry(1.3, 0.1, 1.1), M(0x6b4f2a, { roughness: 0.9 }), 0, 0.78, 0);
    add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.85, 10), M(0x9a7b4d), -0.75, 0.12, 0.28).rotation.z = Math.PI / 2;
    add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.85, 10), M(0x8a6b3d), -0.75, 0.32, 0.28).rotation.z = Math.PI / 2;
    const wheel = add(g, new THREE.TorusGeometry(0.28, 0.05, 8, 18), M(0x7a5b30, { roughness: 0.85 }), 0.6, 0.35, 0);
    wheel.rotation.y = Math.PI / 2;
  } else {
    add(g, new THREE.BoxGeometry(1.2, 0.9, 1.05), M(0x5a5d61, { roughness: 0.95 }), 0, 0.45, -0.12);
    add(g, new THREE.BoxGeometry(0.55, 0.55, 0.18), M(0x1a1a1a), 0, 0.28, 0.38);
    add(g, new THREE.BoxGeometry(0.09, 0.7, 0.09), M(0x8a6b3d), -0.32, 0.35, 0.4);
    add(g, new THREE.BoxGeometry(0.09, 0.7, 0.09), M(0x8a6b3d), 0.32, 0.35, 0.4);
    add(g, new THREE.BoxGeometry(0.75, 0.09, 0.09), M(0x8a6b3d), 0, 0.72, 0.4);
    const oreC = kind === 'gold' ? 0xd4af37 : 0x7a7d81;
    add(g, new THREE.DodecahedronGeometry(0.2, 0), M(oreC, kind === 'gold' ? { metalness: 0.65, roughness: 0.35, emissive: 0x554400, emissiveIntensity: 0.35 } : { roughness: 0.9 }), 0.52, 0.18, 0.48);
    add(g, new THREE.DodecahedronGeometry(0.14, 0), M(oreC, { roughness: 0.85 }), 0.78, 0.12, 0.32);
  }
  return g;
}

function exportGLB(object, outPath) {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(object, (result) => {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, Buffer.from(result));
      console.log('✓', outPath.replace(ROOT + '/', ''), `(${(result.byteLength / 1024).toFixed(1)} KB)`);
      resolve();
    }, reject, { binary: true, onlyVisible: true });
  });
}

const jobs = [
  ['units/pikeman.glb', () => buildPikeman(TEAM_P)],
  ['units/pikeman2.glb', () => buildPikeman(TEAM_P, true)],
  ['units/archer.glb', () => buildArcher(TEAM_P)],
  ['units/archer2.glb', () => buildArcher(TEAM_P, true)],
  ['units/griffin.glb', buildGriffin],
  ['units/griffin2.glb', buildGriffin],
  ['units/swordsman.glb', () => buildSwordsman(TEAM_P)],
  ['units/swordsman2.glb', () => buildSwordsman(TEAM_P, true)],
  ['units/champion.glb', () => buildHero(TEAM_P)],
  ['units/champion2.glb', () => buildHero(TEAM_P, true)],
  ['units/wolf.glb', buildWolf],
  ['units/skeleton.glb', buildSkeleton],
  ['units/orc.glb', buildOrc],
  ['units/ghost.glb', buildGhost],
  ['units/dragon.glb', buildDragon],
  ['heroes/hero_player.glb', () => buildHero(TEAM_P)],
  ['heroes/hero_enemy.glb', () => buildHero(TEAM_E)],
  ['buildings/castle_player.glb', () => buildCastle(TEAM_P)],
  ['buildings/castle_enemy.glb', () => buildCastle(TEAM_E)],
  ['buildings/mine_sawmill.glb', () => buildMine('sawmill')],
  ['buildings/mine_ore.glb', () => buildMine('ore')],
  ['buildings/mine_gold.glb', () => buildMine('gold')],
];

let n = 0;
for (const [rel, fn] of jobs) {
  await exportGLB(fn(), join(OUT, rel));
  n++;
}
console.log(`\n完成 ${n} 个 glb → art/export/`);
