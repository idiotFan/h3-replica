// ================= 冒险大地图 =================
import * as THREE from 'three';
import { UNITS, MAP, MINES, ARTIFACTS } from './config.js';
import { DIFF } from './difficulty.js';
import { makeNoise, fbm, rand, randInt, choice, clamp, Tweens, easeLinear, makeTextSprite, sfx, MinHeap, disposeObject3D, tiltNode } from './utils.js';
import { createHero, createCastle, createMine, createUnit, makePickup, makeArtifact } from './assets/factory.js';
import { makeDetailTexture, makeWaterTexture, makeCloudSprite, makeGlowSprite, makeMoonSprite, makeSkyMaterial } from './textures.js';

// 日夜循环（秒/周期）与关键帧
const DAY_LEN = 240;
const SKY_KEYS = [
  { t: 0.0,  top: 0x0a0e2a, hor: 0x182040, sunI: 0.15, hemiI: 0.32, fog: 0x0a0e2a, sunC: 0x8ab0ff, star: 1,   cloud: 0.25 },
  { t: 0.22, top: 0x5a7ab8, hor: 0xf0b08a, sunI: 0.85, hemiI: 0.65, fog: 0xc8a88a, sunC: 0xffd0a0, star: 0,   cloud: 0.75 },
  { t: 0.35, top: 0x4a8fd8, hor: 0x9fc8e8, sunI: 1.5,  hemiI: 0.95, fog: 0x87b5e0, sunC: 0xfff2d8, star: 0,   cloud: 0.95 },
  { t: 0.68, top: 0x4a8fd8, hor: 0x9fc8e8, sunI: 1.5,  hemiI: 0.95, fog: 0x87b5e0, sunC: 0xfff2d8, star: 0,   cloud: 0.95 },
  { t: 0.8,  top: 0x4a3a6a, hor: 0xf08a5a, sunI: 0.9,  hemiI: 0.55, fog: 0xd89a7a, sunC: 0xff9a50, star: 0,   cloud: 0.65 },
  { t: 0.92, top: 0x0a0e2a, hor: 0x182040, sunI: 0.15, hemiI: 0.32, fog: 0x0a0e2a, sunC: 0x8ab0ff, star: 1,   cloud: 0.25 },
  { t: 1.0,  top: 0x0a0e2a, hor: 0x182040, sunI: 0.15, hemiI: 0.32, fog: 0x0a0e2a, sunC: 0x8ab0ff, star: 1,   cloud: 0.25 },
];

const { W: MW, H: MH, TILE } = MAP;
const key = (x, y) => x + ',' + y;

export class WorldMap {
  /**
   * @param {THREE.Scene} scene
   * @param {object} events { onPickup, onMine, onCastle, onArtifact, onEncounter, onArrive, toast }
   */
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.type = [];          // 地块类型 water/grass/forest/mountain
    this.tileH = [];         // 地块高度
    this.objects = new Map(); // key -> { kind, x, y, mesh, label, data }
    this.pathTiles = new Set();
    this.moving = false;
    this.pending = null;      // 移动结束后的待触发对象
    this._undoState = null;   // 撤销快照 { x, y, movePoints, explored:Uint8Array, pending:[] }
    this.hero = { x: 4, y: MH - 6, movePoints: DIFF.moveMax, moveMax: DIFF.moveMax };
    this.time = 0;
    this.animated = [];       // 需要待机动画的网格
    this.enemyHeroes = [];    // 敌方英雄列表
    this.enemyTurn = false;   // 敌方行动阶段（锁定玩家输入）
    this.battlePending = null;
    this.day = 1;
    this.clouds = [];
    this.spawnCount = 0;
    this.lampMats = [];   // 夜间发光材质
    this.explored = null; // 战争迷雾：已探索标记 2D
    this.visible = null;  // 当前可见标记 2D
    this.fogMesh = null;  // 迷雾遮罩平面（CanvasTexture）
    this.bookmarks = new Set();      // 地图书签 "x,y" 集合
    this.bookmarkMeshes = new Map(); // 书签 3D 标记 "x,y" -> Mesh
    this._bookmarkGeo = null;        // 书签标记共享几何体（所有书签共用）
    this._bookmarkMat = null;        // 书签标记共享材质（所有书签共用）
  }
  // 视野半径（受移动力影响，骑靴/后勤学也间接提升探索）
  get sightRadius() { return Math.max(4, Math.round(DIFF.moveMax / 3) + 2); }

  // ---------- 坐标 ----------
  tileWorld(x, y) {
    return {
      x: (x - MW / 2 + 0.5) * TILE,
      z: (y - MH / 2 + 0.5) * TILE,
      y: this.tileH[x][y],
    };
  }
  worldToTile(px, pz) {
    return { x: Math.floor(px / TILE + MW / 2), y: Math.floor(pz / TILE + MH / 2) };
  }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < MW && y < MH; }

  // ---------- 生成 ----------
  build(saved = null) {
    const s = this.scene;
    s.background = new THREE.Color(0x87b5e0);
    s.fog = new THREE.Fog(0x87b5e0, 70, 180);

    // 光照
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3d5a3a, 0.95);
    s.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
    sun.position.set(50, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 65, bottom: -65, far: 220 });
    sun.shadow.bias = -0.0006;
    s.add(sun);
    this.sun = sun;
    this.dayTime = DAY_LEN * 0.36; // 从上午开始
    this.buildSky(s);

    if (saved) this.loadTerrain(saved);
    else this.genTerrainTypes();
    this.buildTerrainMesh();
    this.buildWater();
    this.buildVegetation();
    this.buildAtmosphere();
    if (saved) {
      for (const o of saved.objects) {
        if (o.kind === 'enemyHero') this.addEnemyHero(o.x, o.y, o.data.stacks, o.data.name);
        else this.addObject(o.kind, o.x, o.y, o.data);
      }
      this.hero.x = saved.hero.x; this.hero.y = saved.hero.y;
      this.hero.movePoints = saved.hero.movePoints;
      this.hero.moveMax = saved.hero.moveMax;
    } else {
      // 重置英雄到出生点 + 刷新移动力（确保新难度生效）
      this.hero.x = this.startPos.x;
      this.hero.y = this.startPos.y;
      this.hero.movePoints = DIFF.moveMax;
      this.hero.moveMax = DIFF.moveMax;
      this.placeObjects();
    }
    this.buildHero();
    this.buildHover();
    this.buildFog();
    // 恢复存档中的书签标记
    if (this._pendingBookmarks) {
      for (const bk of this._pendingBookmarks) {
        const [bx, by] = bk.split(',').map(Number);
        if (this.inBounds(bx, by)) {
          this.bookmarks.add(bk);
          this.addBookmarkMesh(bx, by);
        }
      }
      this._pendingBookmarks = null;
    }
    this.built = true;
  }

  // ---------- 天空穹顶 / 星月 ----------
  buildSky(s) {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(230, 24, 12), makeSkyMaterial());
    this.sky.frustumCulled = false;
    s.add(this.sky);
    // 星星
    const starPos = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.48;
      starPos[i * 3] = Math.cos(a) * Math.cos(e) * 200;
      starPos[i * 3 + 1] = Math.sin(e) * 200 + 4;
      starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 200;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false,
    }));
    this.stars.frustumCulled = false;
    s.add(this.stars);
    // 太阳与月亮
    this.sunSprite = makeGlowSprite('rgba(255,244,214,1)', 'rgba(255,190,80,0)');
    this.sunSprite.scale.setScalar(42);
    s.add(this.sunSprite);
    this.moonSprite = makeMoonSprite();
    this.moonSprite.scale.setScalar(34);
    s.add(this.moonSprite);
  }

  // 日夜循环更新（节流到 ~12Hz，避免每帧 GC 压力）
  _dnT = 0;
  _cA = new THREE.Color(); _cB = new THREE.Color(); _cTmp = new THREE.Color();
  updateDayNight() {
    this._dnT += 1; // 由 update 调用，约 60 次/秒
    if (this._dnT % 5 !== 0) return; // 每 5 帧更新一次视觉
    const t = (this.dayTime / DAY_LEN) % 1;
    // 关键帧插值
    let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      if (t >= SKY_KEYS[i].t && t <= SKY_KEYS[i + 1].t) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
    }
    const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    const cA = this._cA.set(a.top), cB = this._cB.set(b.top);
    this.sky.material.uniforms.topColor.value.copy(cA).lerp(cB, k);
    cA.set(a.hor); cB.set(b.hor);
    this.sky.material.uniforms.horizonColor.value.copy(cA).lerp(cB, k);
    cA.set(a.fog); cB.set(b.fog);
    this.scene.fog.color.copy(cA).lerp(cB, k);
    this.scene.background.copy(cA).lerp(cB, k);
    this.sun.intensity = a.sunI + (b.sunI - a.sunI) * k;
    cA.set(a.sunC); cB.set(b.sunC);
    this.sun.color.copy(cA).lerp(cB, k);
    this.hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * k;
    // 太阳/月亮位置
    const ang = (t - 0.25) * Math.PI * 2;
    const sy = Math.sin(ang);
    this.sun.position.set(Math.cos(ang) * 70, sy * 70, 0.35 * 70);
    this.sunSprite.position.set(Math.cos(ang) * 195, sy * 195, 0.35 * 195);
    const starK = a.star + (b.star - a.star) * k;
    this.sunSprite.material.opacity = clamp(1 - starK * 1.5, 0, 1) * clamp(sy * 3 + 0.4, 0, 1);
    this.moonSprite.position.set(-Math.cos(ang) * 195, -sy * 195, -0.35 * 195);
    this.moonSprite.material.opacity = starK * 0.95;
    this.stars.material.opacity = starK;
    const cloudOp = a.cloud + (b.cloud - a.cloud) * k;
    for (const c of this.clouds) c.material.opacity = cloudOp;
    // 夜间灯火
    const lampI = 0.25 + starK * 1.5;
    for (const m of this.lampMats) m.emissiveIntensity = lampI;
  }

  // ---------- 存档序列化 ----------
  loadTerrain(saved) {
    const ch = { w: 'water', g: 'grass', f: 'forest', m: 'mountain' };
    this.type = [];
    for (let x = 0; x < MW; x++) {
      this.type[x] = [];
      for (let y = 0; y < MH; y++) this.type[x][y] = ch[saved.types[y][x]] || 'grass';
    }
    this.startPos = saved.startPos;
    this.castlePos = saved.castlePos;
    this.bossPos = saved.bossPos;
    this.pathTiles = new Set(saved.paths || []);
    this._pendingExplored = saved.explored || null; // buildFog 会读取
    this._pendingBookmarks = saved.bookmarks || null; // build() 中恢复
  }
  serialize() {
    const ch = { water: 'w', grass: 'g', forest: 'f', mountain: 'm' };
    const types = [];
    for (let y = 0; y < MH; y++) {
      let row = '';
      for (let x = 0; x < MW; x++) row += ch[this.type[x][y]];
      types.push(row);
    }
    return {
      types,
      paths: [...this.pathTiles],
      objects: [...this.objects.values()].map(o => ({ kind: o.kind, x: o.x, y: o.y, data: o.data })),
      hero: { x: this.hero.x, y: this.hero.y, movePoints: this.hero.movePoints, moveMax: this.hero.moveMax },
      startPos: this.startPos, castlePos: this.castlePos, bossPos: this.bossPos,
      explored: this.explored ? this.explored.map(col => col.map(v => v ? 1 : 0).join('')) : null,
      bookmarks: [...this.bookmarks],
    };
  }

  genTerrainTypes() {
    const n1 = makeNoise(randInt(1, 999)), n2 = makeNoise(randInt(1, 999));
    const nC = makeNoise(randInt(1, 999)); // 大陆遮罩噪声
    this.type = [];
    const cx = MW / 2 - 0.5, cy = MH / 2 - 0.5;
    const maxR = Math.min(MW, MH) / 2 - 1.5;
    const BORDER = 2; // 外圈强制海水，保证四周环海
    for (let x = 0; x < MW; x++) {
      this.type[x] = [];
      for (let y = 0; y < MH; y++) {
        let t = 'grass';
        // 地图最外圈强制为海
        if (x < BORDER || y < BORDER || x >= MW - BORDER || y >= MH - BORDER) {
          t = 'water';
        } else {
          // 异形大陆：椭圆距离 + 多频噪声撕出港湾/半岛
          const dx = (x - cx) / maxR, dy = (y - cy) / maxR;
          const dist = Math.sqrt(dx * dx * 0.92 + dy * dy * 1.08); // 略扁
          const nA = fbm(nC, x * 0.08, y * 0.08, 4);
          const nB = fbm(nC, x * 0.15 + 40, y * 0.15 + 40, 3);
          const edge = dist + (nA - 0.5) * 0.38 + (nB - 0.5) * 0.18;
          if (edge > 0.78) t = 'water';
          else {
            const h = fbm(n1, x * 0.09, y * 0.09, 4);
            const f = fbm(n2, x * 0.12 + 50, y * 0.12 + 50, 3);
            if (h > 0.62 && edge < 0.55) t = 'mountain';
            else if (f > 0.55) t = 'forest';
            else t = 'grass';
          }
        }
        this.type[x][y] = t;
      }
    }
    // 出生点 / 城堡 / Boss 区域清空
    const clear = (cx, cy, r) => {
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++)
        if (this.inBounds(x, y)) this.type[x][y] = 'grass';
    };
    this.startPos = { x: 4, y: MH - 6 };
    this.castlePos = { x: 8, y: MH - 6 };
    this.bossPos = { x: MW - 6, y: 5 };
    this.enemyCastlePos = { x: Math.floor(MW / 2), y: 4 };
    clear(this.startPos.x, this.startPos.y, 2);
    clear(this.castlePos.x, this.castlePos.y, 2);
    clear(this.bossPos.x, this.bossPos.y, 2);
    clear(this.enemyCastlePos.x, this.enemyCastlePos.y, 2);
    // 随机漫步开辟主路，保证连通
    this.carvePath(this.startPos.x, this.startPos.y, this.bossPos.x, this.bossPos.y);
    this.carvePath(this.startPos.x, this.startPos.y, this.castlePos.x, this.castlePos.y);
    this.carvePath(this.castlePos.x, this.castlePos.y, this.enemyCastlePos.x, this.enemyCastlePos.y);
  }

  carvePath(x0, y0, x1, y1) {
    let x = x0, y = y0, guard = 0;
    while ((x !== x1 || y !== y1) && guard++ < 2000) {
      if (this.inBounds(x, y)) { this.type[x][y] = 'grass'; this.pathTiles.add(key(x, y)); }
      if (Math.random() < 0.5) {
        const sx = x + randInt(-1, 1), sy = y + randInt(-1, 1);
        if (this.inBounds(sx, sy)) this.type[sx][sy] = 'grass';
      }
      const dx = Math.sign(x1 - x), dy = Math.sign(y1 - y);
      if (x !== x1 && (Math.random() < 0.6 || y === y1)) x += dx;
      else if (y !== y1) y += dy;
      x = clamp(x, 1, MW - 2); y = clamp(y, 1, MH - 2);
    }
  }

  baseHeight(t, x, y) {
    const j = makeNoise(7)(x * 0.5, y * 0.5);
    switch (t) {
      case 'water': return -1.5;
      case 'forest': return 0.35 + j * 0.2;
      case 'mountain': return 2.1 + j * 1.1;
      default: return 0.08 + j * 0.18;
    }
  }

  buildTerrainMesh() {
    // 顶点高度 = 相邻地块均值（平滑）
    const vh = [];
    for (let gx = 0; gx <= MW; gx++) {
      vh[gx] = [];
      for (let gz = 0; gz <= MH; gz++) {
        let sum = 0, n = 0;
        for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const tx = gx + dx, tz = gz + dz;
          if (this.inBounds(tx, tz)) { sum += this.baseHeight(this.type[tx][tz], tx, tz); n++; }
        }
        vh[gx][gz] = n ? sum / n : 0;
      }
    }
    this.vh = vh;
    // 地块高度 = 四角均值
    this.tileH = [];
    for (let x = 0; x < MW; x++) {
      this.tileH[x] = [];
      for (let y = 0; y < MH; y++)
        this.tileH[x][y] = (vh[x][y] + vh[x + 1][y] + vh[x][y + 1] + vh[x + 1][y + 1]) / 4;
    }

    const geo = new THREE.PlaneGeometry(MW * TILE, MH * TILE, MW, MH);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x5da24a), cGrass2 = new THREE.Color(0x4f9140);
    const cSand = new THREE.Color(0xb3a06b), cRock = new THREE.Color(0x8a8d91), cSnow = new THREE.Color(0xe8ecef);
    const cDeep = new THREE.Color(0x51683f);
    const cDirt = new THREE.Color(0x9a7d55);
    const cFoam = new THREE.Color(0xd8e8e0);
    const tmp = new THREE.Color();
    const vertAt = {}; // "gx,gz" -> 顶点索引
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), pz = pos.getZ(i);
      const gx = clamp(Math.round(px / TILE + MW / 2), 0, MW);
      const gz = clamp(Math.round(pz / TILE + MH / 2), 0, MH);
      vertAt[gx + ',' + gz] = i;
      const h = vh[gx][gz];
      pos.setY(i, h);
      if (h < -0.55) { tmp.copy(cSand); if (h > -0.78) tmp.lerp(cFoam, 0.45); } // 近岸泡沫
      else if (h < 0.5) tmp.copy(cGrass).lerp(cGrass2, Math.random());
      else if (h < 1.1) tmp.copy(cDeep).lerp(cGrass2, Math.random() * 0.5);
      else if (h < 2.6) tmp.copy(cRock);
      else tmp.copy(cSnow);
      tmp.offsetHSL(0, 0, (Math.random() - 0.5) * 0.03);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    // 主路染成土路（颜色 + 微降高度）
    for (const pk of this.pathTiles) {
      const [px, py] = pk.split(',').map(Number);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const vi = vertAt[(px + dx) + ',' + (py + dy)];
        if (vi === undefined) continue;
        tmp.setRGB(colors[vi * 3], colors[vi * 3 + 1], colors[vi * 3 + 2]);
        tmp.lerp(cDirt, 0.62);
        colors[vi * 3] = tmp.r; colors[vi * 3 + 1] = tmp.g; colors[vi * 3 + 2] = tmp.b;
        if (pos.getY(vi) > 0.1) pos.setY(vi, pos.getY(vi) - 0.05);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeDetailTexture(48) });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  buildWater() {
    // 外海平面：与地形内水域同色同纹，高度对齐，消除视觉断层
    const ws = MW * TILE * 2.2, hs = MH * TILE * 2.2;
    const geo = new THREE.PlaneGeometry(ws, hs);
    geo.rotateX(-Math.PI / 2);
    this.waterTex = makeWaterTexture();
    // repeat 按平面大小设置，让内外水域纹理密度一致
    this.waterTex.repeat.set(22, 22);
    // 外海用纯色+纹理，不透明（避免半透明露出黑色背景）
    this.water = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      map: this.waterTex, transparent: true, opacity: 0.92,
    }));
    this.water.position.y = -0.55;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  // 云朵 / 草簇 / 野花
  buildAtmosphere() {
    for (let i = 0; i < 10; i++) {
      const cloud = makeCloudSprite();
      const sc = rand(9, 18);
      cloud.scale.set(sc, sc * 0.5, 1);
      cloud.position.set(rand(-70, 70), rand(16, 26), rand(-70, 70));
      cloud.userData.speed = rand(0.4, 1.0);
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
    // 草簇（实例化小锥体）
    const grassSpots = [];
    const flowerSpots = [];
    for (let x = 0; x < MW; x++) for (let y = 0; y < MH; y++) {
      if (this.type[x][y] === 'grass') {
        if (Math.random() < 0.42) grassSpots.push([x, y]);
        if (Math.random() < 0.08) flowerSpots.push([x, y]);
      }
    }
    const dummy = new THREE.Object3D();
    const tuft = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.09, 0.32, 5),
      new THREE.MeshLambertMaterial({ color: 0x6fbf5f }), grassSpots.length * 2);
    let i = 0;
    const tuftColor = new THREE.Color();
    for (const [x, y] of grassSpots) {
      const w = this.tileWorld(x, y);
      for (let k = 0; k < 2; k++) {
        dummy.position.set(w.x + rand(-0.8, 0.8), w.y + 0.14, w.z + rand(-0.8, 0.8));
        dummy.scale.setScalar(rand(0.7, 1.4));
        dummy.rotation.set(rand(-0.15, 0.15), rand(0, Math.PI * 2), rand(-0.15, 0.15));
        dummy.updateMatrix();
        tuft.setMatrixAt(i, dummy.matrix);
        tuft.setColorAt(i, tuftColor.setHSL(0.29 + Math.random() * 0.06, 0.5, 0.32 + Math.random() * 0.15));
        i++;
      }
    }
    tuft.instanceColor.needsUpdate = true;
    this.scene.add(tuft);
    // 野花
    const flower = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.07, 6, 5),
      new THREE.MeshLambertMaterial({ color: 0xffffff }), flowerSpots.length);
    const fColor = new THREE.Color();
    const palette = [0xffe9f0, 0xffd76b, 0xc58aff, 0xff9a8a, 0xffffff];
    flowerSpots.forEach(([x, y], idx) => {
      const w = this.tileWorld(x, y);
      dummy.position.set(w.x + rand(-0.8, 0.8), w.y + 0.12, w.z + rand(-0.8, 0.8));
      dummy.scale.setScalar(rand(0.8, 1.3));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      flower.setMatrixAt(idx, dummy.matrix);
      flower.setColorAt(idx, fColor.set(choice(palette)));
    });
    flower.instanceColor.needsUpdate = true;
    this.scene.add(flower);
    // 蝴蝶（草地飞舞）
    this.butterflies = [];
    const bColors = [0xffe9f0, 0xffd76b, 0xc58aff, 0x9fd8ff];
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: choice(bColors), side: THREE.DoubleSide });
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.1), mat);
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.1), mat);
      w1.position.x = -0.06; w2.position.x = 0.06;
      g.add(w1, w2);
      // 随机选一块草地做活动中心
      let bx = 0, bz = 0;
      for (let tries = 0; tries < 40; tries++) {
        const x = randInt(2, MW - 3), y = randInt(2, MH - 3);
        if (this.type[x][y] === 'grass') { const w = this.tileWorld(x, y); bx = w.x; bz = w.z; break; }
      }
      g.userData = { w1, w2, cx: bx, cz: bz, r: rand(2, 5), ph: rand(0, Math.PI * 2), sp: rand(0.35, 0.7), h: rand(1, 2.2) };
      this.scene.add(g);
      this.butterflies.push(g);
    }
    // 英雄扬尘（对象池）
    this.dustPool = [];
    for (let i = 0; i < 14; i++) {
      const d = makeGlowSprite('rgba(216,208,192,0.55)', 'rgba(216,208,192,0)', 64);
      d.visible = false;
      this.scene.add(d);
      this.dustPool.push({ sp: d, life: 0 });
    }
    this.dustCursor = 0;
  }

  spawnDust(pos) {
    const d = this.dustPool[this.dustCursor++ % this.dustPool.length];
    d.sp.position.set(pos.x + rand(-0.2, 0.2), pos.y + 0.1, pos.z + rand(-0.2, 0.2));
    d.sp.scale.setScalar(0.5);
    d.sp.visible = true;
    d.life = 0.55;
  }

  buildVegetation() {
    // 树（实例化）
    const treeTiles = [];
    const rockTiles = [];
    for (let x = 0; x < MW; x++) for (let y = 0; y < MH; y++) {
      if (this.type[x][y] === 'forest') treeTiles.push([x, y]);
      if (this.type[x][y] === 'mountain') rockTiles.push([x, y]);
    }
    const dummy = new THREE.Object3D();
    let count = 0;
    for (const [x, y] of treeTiles) count += randInt(1, 3);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 0.55, 6), new THREE.MeshLambertMaterial({ color: 0x6b4f2a }), count);
    const leaf = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 1.1, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), count);
    trunk.castShadow = leaf.castShadow = true;
    let i = 0;
    const leafColor = new THREE.Color();
    // 记录每个实例属于哪一格 + 原始矩阵，供迷雾按格隐藏（见 _updateVegetationFog）
    const treeTileOf = new Int32Array(count * 2);
    for (const [x, y] of treeTiles) {
      const n = randInt(1, 3);
      const w = this.tileWorld(x, y);
      for (let k = 0; k < n; k++) {
        const sc = rand(0.8, 1.4);
        dummy.position.set(w.x + rand(-0.7, 0.7), w.y + 0.27 * sc, w.z + rand(-0.7, 0.7));
        dummy.scale.setScalar(sc);
        dummy.rotation.y = rand(0, Math.PI * 2);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
        dummy.position.y = w.y + (0.55 + 0.5) * sc;
        dummy.updateMatrix();
        leaf.setMatrixAt(i, dummy.matrix);
        leaf.setColorAt(i, leafColor.setHSL(0.3 + Math.random() * 0.05, 0.45, 0.22 + Math.random() * 0.12));
        treeTileOf[i * 2] = x; treeTileOf[i * 2 + 1] = y;
        i++;
      }
    }
    leaf.instanceColor.needsUpdate = true;
    this.scene.add(trunk, leaf);
    this._veg = this._veg || [];
    this._veg.push({ meshes: [trunk, leaf], tileOf: treeTileOf,
                     base: [trunk.instanceMatrix.array.slice(), leaf.instanceMatrix.array.slice()] });
    // 山地岩石
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.45), new THREE.MeshLambertMaterial({ color: 0x7a7d81 }), rockTiles.length);
    rocks.castShadow = true;
    const rockTileOf = new Int32Array(rockTiles.length * 2);
    rockTiles.forEach(([x, y], idx) => {
      const w = this.tileWorld(x, y);
      dummy.position.set(w.x + rand(-0.4, 0.4), w.y + 0.15, w.z + rand(-0.4, 0.4));
      dummy.scale.setScalar(rand(0.6, 1.5));
      dummy.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      dummy.updateMatrix();
      rocks.setMatrixAt(idx, dummy.matrix);
      rockTileOf[idx * 2] = x; rockTileOf[idx * 2 + 1] = y;
    });
    this.scene.add(rocks);
    this._veg = this._veg || [];
    this._veg.push({ meshes: [rocks], tileOf: rockTileOf, base: [rocks.instanceMatrix.array.slice()] });
  }

  // ---------- 对象放置 ----------
  reachableSet() {
    // 从起点 BFS（忽略对象，只看地形）
    const seen = new Set([key(this.startPos.x, this.startPos.y)]);
    const q = [[this.startPos.x, this.startPos.y]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (!this.inBounds(nx, ny) || seen.has(k)) continue;
        const t = this.type[nx][ny];
        if (t === 'water' || t === 'mountain') continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return seen;
  }

  placeObjects() {
    const reach = this.reachableSet();
    const used = new Set();
    const distStart = (x, y) => Math.max(Math.abs(x - this.startPos.x), Math.abs(y - this.startPos.y));
    const freeTile = (minDist = 5, avoidPath = true) => {
      for (let tries = 0; tries < 400; tries++) {
        const x = randInt(2, MW - 3), y = randInt(2, MH - 3), k = key(x, y);
        if (this.type[x][y] !== 'grass' || !reach.has(k) || used.has(k)) continue;
        if (avoidPath && this.pathTiles.has(k)) continue;
        if (distStart(x, y) < minDist) continue;
        let ok = true;
        for (let dx = -1; dx <= 1 && ok; dx++) for (let dy = -1; dy <= 1 && ok; dy++)
          if (used.has(key(x + dx, y + dy))) ok = false;
        if (!ok) continue;
        used.add(k);
        return { x, y };
      }
      return null;
    };

    // 城堡
    this.addObject('castle', this.castlePos.x, this.castlePos.y, {});
    used.add(key(this.castlePos.x, this.castlePos.y));

    // 矿场 + 守卫
    for (const mk of ['sawmill', 'ore', 'gold']) {
      const p = freeTile(6); if (!p) continue;
      this.addObject('mine', p.x, p.y, { mine: mk, owned: false });
      const g = this.freeNeighbor(p.x, p.y, used, reach);
      if (g) { this.addMonster(g.x, g.y, mk === 'gold' ? 'ghost' : 'skeleton', 1.0); used.add(key(g.x, g.y)); }
    }

    // 宝物 + 守卫
    for (const ak of Object.keys(ARTIFACTS)) {
      const p = freeTile(8); if (!p) continue;
      this.addObject('artifact', p.x, p.y, { art: ak });
      const g = this.freeNeighbor(p.x, p.y, used, reach);
      if (g) { this.addMonster(g.x, g.y, choice(['orc', 'ghost', 'skeleton']), 1.3); used.add(key(g.x, g.y)); }
    }

    // 普通野怪
    const monsterTypes = ['wolf', 'wolf', 'skeleton', 'skeleton', 'orc', 'orc', 'ghost', 'wolf', 'orc', 'ghost'];
    for (const mt of monsterTypes) {
      const p = freeTile(6); if (!p) continue;
      this.addMonster(p.x, p.y, mt, 1.0);
    }

    // 资源拾取
    const pickups = ['gold', 'gold', 'gold', 'gold', 'chest', 'chest', 'wood', 'wood', 'wood', 'ore', 'ore', 'ore', 'gold', 'chest'];
    for (const pk of pickups) {
      const p = freeTile(3, false); if (!p) continue;
      const amount = pk === 'gold' ? randInt(3, 8) * 100 : pk === 'chest' ? randInt(8, 16) * 100 : randInt(4, 8);
      this.addObject('pickup', p.x, p.y, { res: pk, amount });
    }

    // 决胜战兵力随难度缩放（difficulty.js 的 bossScale：0.7 / 1.0 / 1.4）。
    // Math.max(1, …) 不可省略：简单档 dragon 2*0.7=1.4 尚可，但任何 count 为 1 的
    // 兵种乘 0.7 后会被 round 成 0，整队消失。
    const bs = n => Math.max(1, Math.round(n * DIFF.bossScale));

    // Boss 黑龙巢穴
    this.addObject('monster', this.bossPos.x, this.bossPos.y, {
      stacks: [{ type: 'dragon', count: bs(2) }, { type: 'ghost', count: bs(10) }, { type: 'orc', count: bs(15) }],
      reward: 5000, boss: true, name: '黑龙巢穴',
    });

    // 敌方城堡（定期派出敌方英雄）
    this.addObject('enemyCastle', this.enemyCastlePos.x, this.enemyCastlePos.y, {
      stacks: [{ type: 'orc', count: bs(12) }, { type: 'skeleton', count: bs(18) }, { type: 'wolf', count: bs(10) }, { type: 'ghost', count: bs(6) }],
      reward: 3000, name: '敌方城堡',
    });
    used.add(key(this.enemyCastlePos.x, this.enemyCastlePos.y));
    // 初始敌方英雄
    const ep = this.freeNeighbor(this.enemyCastlePos.x, this.enemyCastlePos.y, used, reach);
    if (ep) this.spawnEnemyHero(ep.x, ep.y);
  }

  // 敌方英雄军队（随天数增强，系数受难度控制）
  enemyArmyComp(day) {
    const r = DIFF.enemyArmyDayRate;
    const army = [
      { type: 'skeleton', count: 8 + Math.floor(day * r.skeleton) },
      { type: 'orc', count: 5 + Math.floor(day * r.orc) },
      { type: 'wolf', count: 6 + Math.floor(day * r.wolf) },
    ];
    if (day >= DIFF.enemyGhostDay) army.push({ type: 'ghost', count: 3 + Math.floor(day / 5) });
    if (day >= DIFF.enemyDragonDay) army.push({ type: 'dragon', count: 1 });
    return army;
  }
  spawnEnemyHero(x, y) {
    const names = ['黑暗骑士', '亡灵巫师', '野蛮人王', '暗影领主'];
    return this.addEnemyHero(x, y, this.enemyArmyComp(this.day), names[this.spawnCount++ % names.length]);
  }

  freeNeighbor(x, y, used, reach) {
    const cands = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (this.inBounds(nx, ny) && this.type[nx][ny] === 'grass' && !used.has(k) && reach.has(k) && !this.objects.has(k))
        cands.push({ x: nx, y: ny });
    }
    return cands.length ? choice(cands) : null;
  }

  addMonster(x, y, type, scale) {
    const d = Math.max(Math.abs(x - this.startPos.x), Math.abs(y - this.startPos.y));
    const base = { wolf: [10, 18], skeleton: [12, 20], orc: [8, 14], ghost: [6, 10] }[type];
    const count = Math.round(randInt(base[0], base[1]) * (1 + d / DIFF.monsterDistFactor) * scale * DIFF.monsterScale);
    // 兵力多时拆成多队列，战斗更难缠
    const parts = count >= 24 ? 3 : count >= 10 ? 2 : 1;
    const stacks = [];
    for (let i = 0; i < parts; i++) stacks.push({ type, count: Math.ceil(count / parts) });
    const total = stacks.reduce((s, st) => s + st.count, 0);
    const hpSum = UNITS[type].hp * total;
    this.addObject('monster', x, y, {
      stacks,
      reward: Math.round(hpSum * 2.5 * DIFF.monsterRewardRate) + 100,
      baseCounts: stacks.map(s => s.count), // 记录基础兵力，供线性成长用
      growCount: 0,
    });
  }

  addObject(kind, x, y, data) {
    let mesh, labelText = '', labelY = 2.2;
    if (kind === 'castle') { mesh = createCastle('player'); labelText = '城堡'; labelY = 4.2; }
    else if (kind === 'enemyCastle') { mesh = createCastle('enemy'); labelText = data.name || '敌方城堡'; labelY = 4.2; }
    else if (kind === 'mine') { mesh = createMine(data.mine); labelText = MINES[data.mine].name; }
    else if (kind === 'pickup') {
      mesh = makePickup(data.res);
      labelText = { gold: '金币', wood: '木材', ore: '矿石', chest: '宝箱' }[data.res];
      labelY = 1.6;
    }
    else if (kind === 'artifact') { mesh = makeArtifact(ARTIFACTS[data.art].color); labelText = ARTIFACTS[data.art].name; labelY = 1.9; }
    else if (kind === 'monster') {
      const mainType = data.stacks[0].type;
      mesh = createUnit(mainType, 1);
      // scale 必须作用到 factory.finalize 返回的 wrapper：wrapper 内 root.position.y = -minY
      // 是自动落地补偿量，只缩放 root 会让补偿量不跟着放大，模型底部沉进地面（boss 龙尤其明显）。
      // 缩放 wrapper 则补偿量一起缩放，底部始终贴合 y=0。与 refreshObjectMeshes 保持一致。
      mesh.scale.multiplyScalar(data.boss ? 1.5 : 1.15);
      const total = data.stacks.reduce((s, st) => s + st.count, 0);
      labelText = data.name || `${UNITS[mainType].name} x${total}`;
      labelY = data.boss ? 3.2 : 2.0;
    }
    const w = this.tileWorld(x, y);
    mesh.position.set(w.x, w.y, w.z);
    mesh.userData.tile = { x, y };
    this.scene.add(mesh);
    const label = makeTextSprite(labelText, { scale: 0.85, color: kind === 'monster' ? '#ff9a8a' : '#ffe9b0' });
    label.position.set(w.x, w.y + labelY, w.z);
    this.scene.add(label);
    const obj = { kind, x, y, mesh, label, data, baseY: w.y };
    this.objects.set(key(x, y), obj);
    // 登记夜间发光材质
    mesh.traverse(o => { if (o.userData.lamp && o.material) this.lampMats.push(o.material); });
    if (kind === 'artifact' || kind === 'pickup' || kind === 'monster' ||
        kind === 'castle' || kind === 'enemyCastle') this.animated.push(obj);
    return obj;
  }

  // ---------- 敌方英雄 ----------
  addEnemyHero(x, y, army, name) {
    const mesh = createHero('enemy');
    const w = this.tileWorld(x, y);
    mesh.position.set(w.x, w.y, w.z);
    mesh.userData.tile = { x, y };
    this.scene.add(mesh);
    const total = army.reduce((s, a) => s + a.count, 0);
    const label = makeTextSprite(`${name}\n兵力 ${total}`, { scale: 0.8, color: '#ff8a7a' });
    label.position.set(w.x, w.y + 2.5, w.z);
    this.scene.add(label);
    const eh = {
      kind: 'enemyHero', x, y, mesh, label, baseY: w.y,
      data: { stacks: army.map(a => ({ ...a })), name, reward: 600 + total * 15 },
    };
    this.objects.set(key(x, y), eh);
    this.enemyHeroes.push(eh);
    this.animated.push(eh);
    return eh;
  }

  // 后台资产加载完成后，把仍用原语回退的对象模型替换为 glb（仅替换有 glb 缓存的）
  refreshObjectMeshes() {
    if (!this.built) return;
    for (const obj of this.objects.values()) {
      const old = obj.mesh;
      if (!old || old.userData.fromGltf) continue; // 已是 glb 或无 mesh
      let neu = null;
      try {
        if (obj.kind === 'castle') neu = createCastle('player');
        else if (obj.kind === 'enemyCastle') neu = createCastle('enemy');
        else if (obj.kind === 'mine') neu = createMine(obj.data.mine);
        else if (obj.kind === 'monster') {
          neu = createUnit(obj.data.stacks[0].type, 1);
          // 与 addObject 一致：缩放 wrapper（自动落地补偿量随之缩放，不会沉地）
          neu.scale.multiplyScalar(obj.data.boss ? 1.5 : 1.15);
        }
      } catch (e) { continue; }
      if (!neu || !neu.userData.fromGltf) continue; // 仍是原语，跳过
      // 保留变换
      neu.position.copy(old.position);
      neu.userData.tile = old.userData.tile;
      // 替换场景节点
      this.scene.remove(old);
      disposeObject3D(old);
      this.scene.add(neu);
      obj.mesh = neu;
      // 登记夜间发光材质
      neu.traverse(o => { if (o.userData.lamp && o.material) this.lampMats.push(o.material); });
    }
    // 敌方英雄
    for (const eh of this.enemyHeroes) {
      const old = eh.mesh;
      if (!old || old.userData.fromGltf) continue;
      const neu = createHero('enemy');
      if (!neu || !neu.userData.fromGltf) continue;
      neu.position.copy(old.position);
      neu.userData.tile = old.userData.tile;
      this.scene.remove(old);
      disposeObject3D(old);
      this.scene.add(neu);
      eh.mesh = neu;
    }
    // 玩家英雄
    if (this.heroMesh && !this.heroMesh.userData.fromGltf) {
      const old = this.heroMesh;
      const neu = createHero('player');
      if (neu && neu.userData.fromGltf) {
        neu.position.copy(old.position);
        // 名字标签转移到新 mesh
        const tag = old.children.find(c => c.isSprite);
        if (tag) { old.remove(tag); neu.add(tag); }
        this.scene.remove(old);
        disposeObject3D(old);
        this.scene.add(neu);
        this.heroMesh = neu;
      }
    }
    // 新建的 mesh 默认 visible=true，会把雾下的野怪/敌堡/敌方英雄一起点亮
    // （实测后台资产加载完成时 41 个雾下对象有 20 个被点亮）。必须重放一次迷雾。
    this.updateFog();
  }

  // 重建对象头顶标签（兵力变化后调用）
  refreshLabel(obj) {
    if (!obj.label) return;
    this.scene.remove(obj.label);
    disposeObject3D(obj.label);
    const total = obj.data.stacks.reduce((s, st) => s + st.count, 0);
    const text = obj.data.name || `${UNITS[obj.data.stacks[0].type].name} x${total}`;
    const label = makeTextSprite(text, { scale: 0.85, color: '#ff9a8a' });
    const w = this.tileWorld(obj.x, obj.y);
    label.position.set(w.x, w.y + (obj.data.boss ? 3.2 : 2.0), w.z);
    this.scene.add(label);
    obj.label = label;
  }

  // 野怪随时间增长（线性增量，有上限，避免复利爆炸）
  growMonsters() {
    for (const o of this.objects.values()) {
      if (o.kind !== 'monster') continue;
      if (!o.data.baseCounts) {
        o.data.baseCounts = o.data.stacks.map(s => s.count);
        o.data.growCount = 0;
      }
      o.data.growCount++;
      const mult = 1 + Math.min(DIFF.monsterGrowMax, DIFF.monsterGrowRate * o.data.growCount);
      o.data.stacks.forEach((s, i) => s.count = Math.ceil(o.data.baseCounts[i] * mult));
      o.data.reward = Math.round(o.data.reward * 1.02);
      this.refreshLabel(o);
    }
  }

  removeObject(obj) {
    this.objects.delete(key(obj.x, obj.y));
    this.scene.remove(obj.mesh);
    disposeObject3D(obj.mesh);
    if (obj.label) { this.scene.remove(obj.label); disposeObject3D(obj.label); }
    const i = this.animated.indexOf(obj);
    if (i >= 0) this.animated.splice(i, 1);
    const j = this.enemyHeroes.indexOf(obj);
    if (j >= 0) this.enemyHeroes.splice(j, 1);
  }

  // 敌方英雄通行规则：避开水/山/对象/玩家
  enemyPassable(eh, x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.type[x][y];
    if (t === 'water' || t === 'mountain') return false;
    if (x === this.hero.x && y === this.hero.y) return false;
    const o = this.objects.get(key(x, y));
    return !o || o === eh;
  }

  moveEnemyHero(eh) {
    return new Promise(resolve => {
      const hx = this.hero.x, hy = this.hero.y;
      const dist = Math.max(Math.abs(eh.x - hx), Math.abs(eh.y - hy));
      let target = null;
      if (dist <= DIFF.enemyChaseRange) {
        target = { x: hx, y: hy }; // 追击玩家
      } else {
        for (let i = 0; i < 12; i++) { // 游荡
          const tx = clamp(eh.x + randInt(-8, 8), 1, MW - 2), ty = clamp(eh.y + randInt(-8, 8), 1, MH - 2);
          if (this.enemyPassable(eh, tx, ty)) { target = { x: tx, y: ty }; break; }
        }
      }
      if (!target) { resolve(); return; }
      const path = this.findPath(eh.x, eh.y, target.x, target.y);
      if (!path || !path.steps.length) { resolve(); return; }
      const steps = path.steps.slice(0, DIFF.enemyStepsPerDay);
      let i = 0;
      const finish = () => {
        const adj = Math.max(Math.abs(eh.x - hx), Math.abs(eh.y - hy)) <= 1;
        if (adj) this.battlePending = eh;
        resolve();
      };
      const step = () => {
        if (i >= steps.length) { finish(); return; }
        const st = steps[i];
        if (st.x === hx && st.y === hy) { finish(); return; } // 不进入玩家格，相邻即交战
        if (!this.enemyPassable(eh, st.x, st.y)) { finish(); return; }
        const from = eh.mesh.position.clone();
        const w = this.tileWorld(st.x, st.y);
        eh.mesh.lookAt(w.x, from.y, w.z);
        Tweens.add({
          dur: 0.16, ease: easeLinear,
          onUpdate: k => {
            eh.mesh.position.lerpVectors(from, new THREE.Vector3(w.x, w.y, w.z), k);
            eh.mesh.position.y = w.y + Math.abs(Math.sin(k * Math.PI)) * 0.15;
            // 单 mesh glb 模型：整体前后倾斜模拟马蹄节奏
            if (eh.mesh.userData.fromGltf) {
              const t = tiltNode(eh.mesh);
              t.rotation.x = Math.sin(k * Math.PI * 4) * 0.08;
              t.rotation.z = Math.sin(k * Math.PI * 2) * 0.04;
            }
          },
          onDone: () => {
            if (eh.mesh.userData.fromGltf) {
              const t = tiltNode(eh.mesh);
              t.rotation.x = 0;
              t.rotation.z = 0;
            }
            this.objects.delete(key(eh.x, eh.y));
            eh.x = st.x; eh.y = st.y;
            eh.baseY = w.y; // 关键：待机动画以 baseY 为基准，不更新会把敌方英雄拉回出生点地形高度
            eh.mesh.userData.tile = { x: st.x, y: st.y };
            eh.label.position.set(w.x, w.y + 2.5, w.z);
            this.objects.set(key(st.x, st.y), eh);
            i++; step();
          },
        });
      };
      step();
    });
  }

  async runEnemyTurn() {
    this.enemyTurn = true;
    for (const eh of [...this.enemyHeroes]) {
      if (this.battlePending) break;
      await this.moveEnemyHero(eh);
    }
    this.enemyTurn = false;
  }

  // ---------- 场景销毁（开新游戏时重建） ----------
  dispose() {
    if (this._fogTex) { this._fogTex.dispose(); this._fogTex = null; }
    this._fogCanvas = null; this._fogCtx = null;
    this.fogMesh = null;
    this.explored = null; this.visible = null;
    this._pendingExplored = null;
    this._pendingBookmarks = null;
    this.bookmarks.clear();
    this.bookmarkMeshes.clear();
    this._bookmarkGeo = null;
    this._bookmarkMat = null;
    disposeObject3D(this.scene);
    this.scene.clear();
    this.objects.clear();
    this.enemyHeroes = [];
    this.animated = [];
    this.clouds = [];
    this.lampMats = [];
    this.pathTiles.clear();
    this.built = false;
    this.enemyTurn = false;
    this.battlePending = null;
    this.moving = false;
    this.pending = null;
    this._undoState = null;
  }

  // ---------- 英雄 ----------
  buildHero() {
    this.heroMesh = createHero('player');
    const w = this.tileWorld(this.hero.x, this.hero.y);
    this.heroMesh.position.set(w.x, w.y, w.z);
    this.scene.add(this.heroMesh);
    // 名字标签（跟随英雄）
    const nameTag = makeTextSprite('我方英雄', { scale: 0.62, color: '#9fc8f8' });
    nameTag.position.set(0, 2.5, 0);
    this.heroMesh.add(nameTag);
  }

  buildHover() {
    this.hoverRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.06, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.9 })
    );
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
    // 路径预览点（对象池）
    this.pathDots = [];
    const dotGeo = new THREE.SphereGeometry(0.13, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffd76b });
    for (let i = 0; i < 30; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.visible = false;
      this.scene.add(d);
      this.pathDots.push(d);
    }
  }
  hidePath() { if (this.pathDots) for (const d of this.pathDots) d.visible = false; }

  // ---------- 地图书签 ----------
  // 确保书签标记的共享几何体/材质已创建（懒加载，所有书签共用一份以节省显存）
  _ensureBookmarkAssets() {
    if (!this._bookmarkGeo) {
      this._bookmarkGeo = new THREE.TorusGeometry(0.45, 0.07, 8, 20);
      this._bookmarkMat = new THREE.MeshBasicMaterial({
        color: 0xffd76b, transparent: true, opacity: 0.95,
        depthTest: false, depthWrite: false, // 始终可见，方便回头寻找
      });
    }
  }
  // 在地块上方添加书签标记（发光圆环，y=2.0）
  addBookmarkMesh(x, y) {
    this._ensureBookmarkAssets();
    const k = key(x, y);
    if (this.bookmarkMeshes.has(k)) return;
    const w = this.tileWorld(x, y);
    const ring = new THREE.Mesh(this._bookmarkGeo, this._bookmarkMat);
    ring.position.set(w.x, w.y + 2.0, w.z);
    ring.renderOrder = 1000; // 绘制在迷雾之上
    this.scene.add(ring);
    this.bookmarkMeshes.set(k, ring);
  }
  // 移除书签标记
  removeBookmarkMesh(x, y) {
    const k = key(x, y);
    const ring = this.bookmarkMeshes.get(k);
    if (ring) { this.scene.remove(ring); this.bookmarkMeshes.delete(k); }
  }
  // 切换书签状态：有则移除，无则添加
  toggleBookmark(x, y) {
    if (!this.inBounds(x, y)) return;
    const k = key(x, y);
    if (this.bookmarks.has(k)) {
      this.bookmarks.delete(k);
      this.removeBookmarkMesh(x, y);
      sfx('select');
      this.events.toast('已取消标记', '');
    } else {
      this.bookmarks.add(k);
      this.addBookmarkMesh(x, y);
      sfx('select');
      this.events.toast('已标记地点', 'good');
    }
  }

  // ---------- 战争迷雾 ----------
  // 单张 CanvasTexture 覆盖全图，双线性过滤 + 径向渐变实现平滑视野边缘
  buildFog() {
    this.explored = [];
    this.visible = [];
    for (let x = 0; x < MW; x++) {
      this.explored[x] = new Array(MH).fill(false);
      this.visible[x] = new Array(MH).fill(false);
    }
    // 恢复存档的已探索区域
    if (this._pendingExplored) {
      for (let x = 0; x < MW; x++) {
        const col = this._pendingExplored[x];
        if (!col) continue;
        for (let y = 0; y < MH; y++) this.explored[x][y] = col[y] === '1';
      }
      this._pendingExplored = null;
    }
    // 高超采样画布：每格 16 像素 + Mipmap 双线性过滤，消除方块感
    const SS = 16;
    const cv = document.createElement('canvas');
    cv.width = MW * SS; cv.height = MH * SS;
    this._fogCanvas = cv;
    this._fogCtx = cv.getContext('2d');
    this._fogSS = SS;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.flipY = true; // canvas 顶行 ↔ tile y=0（与 PlaneGeometry 默认 UV 对齐）
    this._fogTex = tex;
    // 覆盖全图的平面 —— 必须与地形【同尺寸、同细分、同起伏】。
    //
    // 曾经是一张压在 y=0.12 的纯平面。配 depthTest=false 时它糊住城堡（见下方材质注释）；
    // 只把 depthTest 改成 true 又会露馅：地形有起伏，凡是高于 0.12 的地方地形赢了深度
    // 测试，未探索区反而显出来。所以平面必须贴着地形走 —— 复用 this.vh 的逐顶点高度，
    // 抬高一个固定薄层。这样雾既能被更近的高物体正确遮挡，又能严丝合缝盖住地面。
    const geo = new THREE.PlaneGeometry(MW * TILE, MH * TILE, MW, MH);
    geo.rotateX(-Math.PI / 2);
    {
      const pos = geo.attributes.position;
      const LIFT = 0.12;                       // 贴地薄层，避免与地形 z-fighting
      for (let i = 0; i < pos.count; i++) {
        const gx = clamp(Math.round(pos.getX(i) / TILE + MW / 2), 0, MW);
        const gz = clamp(Math.round(pos.getZ(i) / TILE + MH / 2), 0, MH);
        pos.setY(i, (this.vh[gx] && this.vh[gx][gz] !== undefined ? this.vh[gx][gz] : 0) + LIFT);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }
    // ⚠ depthTest 必须为 true。
    //
    // 曾经设成 false（想让未探索区的树/建筑被雾完全盖住），但那会让这张位于
    // y=0.12 的平面**无视深度、画在所有物体之上**：从低角度看时，远处未探索格
    // 的近黑色雾会糊在投影到同一屏幕位置的近处高物体上。城堡是场上最高的物体，
    // 受害最严重——实测城堡区域纯黑像素占比 25.9%，看起来就是「一个大黑块」，
    // 开启 depthTest 后降到 12.3%（剩下的才是城堡背后真正该黑的背景）。
    //
    // 未探索区的遮挡改由两条各司其职的机制保证：
    //   1. 对象（城堡/矿场/野怪）—— updateFog 里 `o.mesh.visible = expl`，本就已隐藏
    //   2. 植被（树/岩石，InstancedMesh 无法按格 visible）—— _updateVegetationFog()
    //      把未探索格的实例缩放归零
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: true,
      color: 0xffffff,
    });
    this.fogMesh = new THREE.Mesh(geo, mat);
    this.fogMesh.renderOrder = 999; // 透明队列中最后绘制，覆盖所有物体
    // position.y 保持 0：高度已烘进顶点（见上方），再整体抬高会破坏贴合
    this.scene.add(this.fogMesh);
    this.updateFog(true);
  }
  // 标记英雄周围视野为可见+已探索
  revealAround(cx, cy) {
    const r = this.sightRadius;
    const r2 = r * r;
    for (let x = Math.max(0, cx - r); x <= Math.min(MW - 1, cx + r); x++) {
      for (let y = Math.max(0, cy - r); y <= Math.min(MH - 1, cy + r); y++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          this.explored[x][y] = true;
          this.visible[x][y] = true;
        }
      }
    }
  }
  // 重算可见区域并重绘迷雾纹理 + 刷新对象可见性
  updateFog(initial = false) {
    if (!this.fogMesh) return;
    for (let x = 0; x < MW; x++) for (let y = 0; y < MH; y++) this.visible[x][y] = false;
    this.revealAround(this.hero.x, this.hero.y);
    // 城堡提供少量常驻视野
    const castle = [...this.objects.values()].find(o => o.kind === 'castle');
    if (castle) {
      const r = 3, r2 = r * r;
      for (let x = Math.max(0, castle.x - r); x <= Math.min(MW - 1, castle.x + r); x++)
        for (let y = Math.max(0, castle.y - r); y <= Math.min(MH - 1, castle.y + r); y++)
          if ((x - castle.x) ** 2 + (y - castle.y) ** 2 <= r2) this.explored[x][y] = true;
    }
    this._drawFogTexture();
    this._updateVegetationFog();
    // 对象可见性：敌方英雄仅当前可见显示，其余已探索即显示
    for (const o of this.objects.values()) {
      if (!o.mesh) continue;
      const vis = this.visible[o.x] && this.visible[o.x][o.y];
      const expl = this.explored[o.x] && this.explored[o.x][o.y];
      o.mesh.visible = o.kind === 'enemyHero' ? vis : expl;
      if (o.label) o.label.visible = o.mesh.visible;
    }
  }
  // 按已探索状态隐藏植被实例。
  // InstancedMesh 是单次 draw call，没法像普通对象那样按格 .visible=false，
  // 所以改写实例矩阵：未探索格的实例缩放归零（等于不可见），已探索恢复原矩阵。
  // 只在状态真正变化时写回 GPU，避免每次移动都全量上传。
  _updateVegetationFog() {
    if (!this._veg || !this.explored) return;
    for (const grp of this._veg) {
      const { meshes, tileOf, base } = grp;
      const n = tileOf.length / 2;
      let dirty = false;
      grp.hidden = grp.hidden || new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const x = tileOf[i * 2], y = tileOf[i * 2 + 1];
        const expl = this.explored[x] && this.explored[x][y];
        const want = expl ? 0 : 1;
        if (grp.hidden[i] === want) continue;
        grp.hidden[i] = want;
        dirty = true;
        for (let m = 0; m < meshes.length; m++) {
          const arr = meshes[m].instanceMatrix.array, src = base[m], o = i * 16;
          if (want) { for (let k = 0; k < 16; k++) arr[o + k] = 0; }   // 全零矩阵 = 退化不可见
          else { for (let k = 0; k < 16; k++) arr[o + k] = src[o + k]; }
        }
      }
      if (dirty) for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    }
  }

  // 将 explored/visible 状态绘制到迷雾画布
  _drawFogTexture() {
    const ctx = this._fogCtx, SS = this._fogSS;
    const W = MW * SS, H = MH * SS;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    // 1) 基底：未探索=近不透明黑，已探索=半透明灰（让树冠/建筑穿透可见）
    for (let x = 0; x < MW; x++) for (let y = 0; y < MH; y++) {
      ctx.fillStyle = this.explored[x][y] ? 'rgba(10,14,28,0.52)' : 'rgba(6,9,18,0.97)';
      ctx.fillRect(x * SS, y * SS, SS, SS);
    }
    // 2) 可见格：径向渐变擦出软边圆形视野（destination-out 减小已有 alpha）
    //    R 略大于 1 格 → 相邻可见格的渐变重叠融合，形成平滑圆形边缘
    ctx.globalCompositeOperation = 'destination-out';
    const R = SS * 1.35;
    for (let x = 0; x < MW; x++) for (let y = 0; y < MH; y++) {
      if (!this.visible[x][y]) continue;
      const cx = (x + 0.5) * SS, cy = (y + 0.5) * SS;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, 'rgba(0,0,0,1)');    // 中心完全擦除（完全可见）
      g.addColorStop(0.55, 'rgba(0,0,0,0.92)');
      g.addColorStop(1, 'rgba(0,0,0,0)');    // 边缘不擦除（过渡到已探索灰）
      ctx.fillStyle = g;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    }
    // 3) 重绘未探索格，盖住径向渐变溢出到未探索区域的擦除
    ctx.globalCompositeOperation = 'source-over';
    for (let x = 0; x < MW; x++) for (let y = 0; y < MH; y++) {
      if (!this.explored[x][y]) {
        ctx.fillStyle = 'rgba(6,9,18,0.97)';
        ctx.fillRect(x * SS, y * SS, SS, SS);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    this._fogTex.needsUpdate = true;
  }

  // ---------- 通行与寻路 ----------
  blockingAt(x, y) {
    const o = this.objects.get(key(x, y));
    return o && (o.kind === 'monster' || o.kind === 'castle' || o.kind === 'enemyHero' || o.kind === 'enemyCastle');
  }
  // 野怪警戒圈：该格是否处于某野怪相邻 8 格内（踏入即遭拦截）
  guardAt(x, y) {
    for (const o of this.objects.values()) {
      if (o.kind !== 'monster') continue;
      if (Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= 1) return o;
    }
    return null;
  }
  passable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.type[x][y];
    return t !== 'water' && t !== 'mountain' && !this.blockingAt(x, y);
  }
  tileCost(x, y) { return this.type[x][y] === 'forest' ? 2 : 1; }

  findPath(sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return { steps: [], total: 0 };
    const open = new MinHeap();
    const gScore = new Map([[key(sx, sy), 0]]);
    const came = new Map();
    open.push({ x: sx, y: sy }, 0);
    const H = (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty));
    let found = false;
    while (open.size) {
      const cur = open.pop();
      const ck = key(cur.x, cur.y);
      const cg = gScore.get(ck);
      if (cur.x === tx && cur.y === ty) { found = true; break; }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!this.passable(nx, ny)) continue;
        const diag = dx !== 0 && dy !== 0;
        // 禁止穿墙角（两侧都必须可通行，不能贴障碍角斜滑）
        if (diag && (!this.passable(cur.x + dx, cur.y) || !this.passable(cur.x, cur.y + dy))) continue;
        const cost = cg + (diag ? 1.5 : 1) * this.tileCost(nx, ny);
        const nk = key(nx, ny);
        if (cost < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, cost);
          came.set(nk, { x: cur.x, y: cur.y, cost: cost - cg });
          open.push({ x: nx, y: ny }, cost + H(nx, ny));
        }
      }
    }
    if (!found) return null;
    // 回溯
    const steps = [];
    let ck = key(tx, ty), cx = tx, cy = ty;
    while (came.has(ck)) {
      const p = came.get(ck);
      steps.unshift({ x: cx, y: cy, cost: p.cost });
      cx = p.x; cy = p.y; ck = key(cx, cy);
    }
    return { steps, total: gScore.get(key(tx, ty)) };
  }

  bestAdjacentTile(obj) {
    let best = null, bestPath = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = obj.x + dx, ny = obj.y + dy;
      if (!this.passable(nx, ny)) continue;
      if (nx === this.hero.x && ny === this.hero.y) return { x: nx, y: ny, path: { steps: [], total: 0 } };
      const p = this.findPath(this.hero.x, this.hero.y, nx, ny);
      if (p && (!bestPath || p.total < bestPath.total)) { best = { x: nx, y: ny }; bestPath = p; }
    }
    return best ? { ...best, path: bestPath } : null;
  }

  adjacentTo(obj) {
    return Math.max(Math.abs(obj.x - this.hero.x), Math.abs(obj.y - this.hero.y)) <= 1;
  }

  // ---------- 点击交互 ----------
  clickTile(x, y) {
    if (this.moving || this.enemyTurn) return;
    const obj = this.objects.get(key(x, y));
    if (obj && (obj.kind === 'monster' || obj.kind === 'enemyHero' || obj.kind === 'enemyCastle')) {
      if (this.adjacentTo(obj)) { this.clearUndo(); this.events.onEncounter(obj); return; }
      const t = this.bestAdjacentTile(obj);
      if (!t) { this.events.toast('无法接近目标', 'warn'); return; }
      this.pending = obj;
      this.walk(t.path);
      return;
    }
    if (obj && obj.kind === 'castle') {
      if (this.adjacentTo(obj)) { this.events.onCastle(); return; }
      const t = this.bestAdjacentTile(obj);
      if (!t) { this.events.toast('无法接近城堡', 'warn'); return; }
      this.pending = obj;
      this.walk(t.path);
      return;
    }
    if (!this.passable(x, y)) { this.events.toast('此处无法通行', 'warn'); return; }
    const p = this.findPath(this.hero.x, this.hero.y, x, y);
    if (p) this.walk(p);
  }

  walk(path) {
    if (!path || !path.steps.length) { this.arrive(); return; }
    // 按剩余移动力截断
    const steps = [];
    let rest = this.hero.movePoints;
    for (const st of path.steps) {
      if (st.cost > rest + 0.001) break;
      rest -= st.cost;
      steps.push(st);
    }
    if (!steps.length) { this.events.toast('移动力不足，请结束回合', 'warn'); this.pending = null; return; }
    // 移动开始前记录完整撤销快照（位置 + 移动力 + 迷雾位图），路上 collectAt 触发的
    // 每一项世界变更再记入 pending，供 undoMove 逆序回滚（否则撤销只退人不退资源＝无限刷）
    this._undoState = {
      x: this.hero.x, y: this.hero.y, movePoints: this.hero.movePoints,
      explored: this._snapshotExplored(),
      pending: [],
    };
    this.moving = true;
    this.hidePath();
    this.hoverRing.visible = false;
    let i = 0;
    const step = () => {
      if (i >= steps.length) { this.moving = false; this.arrive(); return; }
      const st = steps[i];
      const from = this.heroMesh.position.clone();
      const w = this.tileWorld(st.x, st.y);
      this.heroMesh.lookAt(w.x, from.y, w.z);
      Tweens.add({
        dur: 0.2 * (st.cost > 1.4 ? 1.35 : 1), ease: easeLinear,
        onUpdate: k => {
          this.heroMesh.position.lerpVectors(from, new THREE.Vector3(w.x, w.y, w.z), k);
          this.heroMesh.position.y = w.y + Math.abs(Math.sin(k * Math.PI)) * 0.18;
          // 单 mesh 模型：整体前后倾斜模拟马蹄节奏（无骨骼也能有动感）
          if (this.heroMesh.userData.fromGltf) {
            const t = tiltNode(this.heroMesh);                        // 写子节点，勿写被 lookAt 控制的本体
            t.rotation.x = Math.sin(k * Math.PI * 4) * 0.08;          // 前后颠簸
            t.rotation.z = Math.sin(k * Math.PI * 2) * 0.04;          // 左右轻晃
          }
          // 原语模型：马腿摆动
          const legs = this.heroMesh.userData.anim && this.heroMesh.userData.anim.legs;
          if (legs) for (let li = 0; li < legs.length; li++) legs[li].rotation.x = Math.sin(k * Math.PI * 2) * 0.5 * (li % 2 ? 1 : -1);
        },
        onDone: () => {
          const legs = this.heroMesh.userData.anim && this.heroMesh.userData.anim.legs;
          if (legs) for (const leg of legs) leg.rotation.x = 0;
          if (this.heroMesh.userData.fromGltf) {
            const t = tiltNode(this.heroMesh);
            t.rotation.x = 0;
            t.rotation.z = 0;
          }
          this.hero.x = st.x; this.hero.y = st.y;
          this.hero.movePoints = Math.max(0, this.hero.movePoints - st.cost);
          this.updateFog();
          sfx('move');
          if (this.dustPool) { this.spawnDust(this.heroMesh.position); this.spawnDust(this.heroMesh.position); }
          // 野怪警戒圈拦截：踏入相邻格立即遭遇战，打赢后再拾取（见 onBattleEnd）
          const guard = this.guardAt(st.x, st.y);
          if (guard) {
            this.moving = false;
            this.pending = null;
            this.clearUndo(); // 战斗会改变世界状态，被拦截后不允许撤销
            this.hidePath();
            const gName = guard.data.name || UNITS[guard.data.stacks[0].type].name;
            this.events.toast(`${gName} 拦截了你的去路！`, 'warn');
            this.events.onEncounter(guard);
            return;
          }
          this.collectAt(st.x, st.y);
          this.events.onArrive();
          i++; step();
        },
      });
    };
    step();
  }

  collectAt(x, y) {
    const obj = this.objects.get(key(x, y));
    if (!obj) return;
    const undo = this._undoState;
    if (obj.kind === 'pickup') {
      if (undo) undo.pending.push({ kind: 'pickup', x: obj.x, y: obj.y, data: obj.data });
      this.removeObject(obj);
      this.events.onPickup(obj);
    }
    else if (obj.kind === 'mine' && !obj.data.owned) {
      obj.data.owned = true;
      // 占领后插上蓝色旗帜（打上 mineFlag 标记，撤销时按标记摘除）
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), new THREE.MeshLambertMaterial({ color: 0x8a6b3d }));
      pole.position.set(0.6, 1.2, 0.4);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.22), new THREE.MeshLambertMaterial({ color: 0x3b82f6, side: THREE.DoubleSide }));
      flag.position.set(0.78, 1.52, 0.4);
      pole.userData.mineFlag = true;
      flag.userData.mineFlag = true;
      obj.mesh.add(pole, flag);
      obj.mesh.userData.flag = flag;
      if (undo) undo.pending.push({ kind: 'mine', x: obj.x, y: obj.y, data: obj.data, obj });
      this.events.onMine(obj);
    }
    else if (obj.kind === 'artifact') {
      if (undo) undo.pending.push({ kind: 'artifact', x: obj.x, y: obj.y, data: obj.data });
      this.removeObject(obj);
      this.events.onArtifact(obj);
    }
  }

  arrive() {
    const p = this.pending;
    this.pending = null;
    if (p && (p.kind === 'monster' || p.kind === 'enemyHero' || p.kind === 'enemyCastle') &&
        this.objects.has(key(p.x, p.y)) && this.adjacentTo(p)) {
      this.clearUndo(); // 进入战斗后不允许撤销
      this.events.onEncounter(p);
      return;
    }
    if (p && p.kind === 'castle' && this.adjacentTo(p)) {
      this.events.onCastle();
      return;
    }
    this.events.onArrive();
  }

  // ---------- 撤销 ----------
  // 清除撤销快照（战斗 / 结束回合等不可逆事件后调用）
  clearUndo() { this._undoState = null; }

  // 迷雾 explored 位图快照 / 还原（撤销后不能白送已探索区域）
  _snapshotExplored() {
    if (!this.explored) return null;
    const snap = new Uint8Array(MW * MH);
    for (let x = 0; x < MW; x++) {
      const col = this.explored[x];
      if (!col) continue;
      for (let y = 0; y < MH; y++) if (col[y]) snap[x * MH + y] = 1;
    }
    return snap;
  }
  _restoreExplored(snap) {
    if (!snap || !this.explored) return;
    for (let x = 0; x < MW; x++) {
      const col = this.explored[x];
      if (!col) continue;
      for (let y = 0; y < MH; y++) col[y] = snap[x * MH + y] === 1;
    }
  }
  // 摘掉矿场占领旗（按 userData.mineFlag 标记查找，mesh 被 refreshObjectMeshes 换过也不会误删）
  _removeMineFlag(obj) {
    const m = obj && obj.mesh;
    if (!m || typeof m.remove !== 'function' || !Array.isArray(m.children)) return;
    for (const c of m.children.filter(c => c.userData && c.userData.mineFlag)) {
      m.remove(c);
      disposeObject3D(c);
    }
    if (m.userData) m.userData.flag = null;
  }

  // 撤销上一次移动：回到移动前位置、恢复移动力，并逆序回滚路上拿到的一切（仅一次）
  undoMove() {
    if (!this._undoState || this.moving) return false;
    const snap = this._undoState;
    this._undoState = null; // 先清空：回滚过程中的 addObject 不应再记账，且只能撤销一次
    // 1) 逆序回滚 collectAt 造成的世界变更
    const pending = snap.pending || [];
    for (let i = pending.length - 1; i >= 0; i--) {
      const rec = pending[i];
      // 1a) 场景回滚（重建网格 / 摘旗）——独立 try：这里失败只是画面残留
      try {
        if (rec.kind === 'pickup' || rec.kind === 'artifact') {
          // 重新放回被删除的资源堆 / 宝物（复用原 data 对象，数量与种类不变）
          if (!this.objects.has(key(rec.x, rec.y))) this.addObject(rec.kind, rec.x, rec.y, rec.data);
        } else if (rec.kind === 'mine') {
          rec.data.owned = false; // 先退状态再摘旗，摘旗抛错也不会留下"已占领"
          this._removeMineFlag(rec.obj || this.objects.get(key(rec.x, rec.y)));
        }
      } catch (e) {
        console.warn('[undoMove] 场景回滚失败（继续回滚数值）', rec, e);
      }
      // 1b) 数值回滚（资源数量 / 矿场计数 / 宝物属性加成）——必须独立 try，
      //     否则上面任何一处抛错都会吞掉这一步，退了人却没退资源＝刷资源漏洞复活
      try {
        if (typeof this.events.onUndoPickup === 'function') this.events.onUndoPickup(rec.kind, rec.data);
      } catch (e) {
        console.warn('[undoMove] 数值回滚失败', rec, e);
      }
    }
    // 2) 回滚英雄位置与移动力
    this.hero.x = snap.x;
    this.hero.y = snap.y;
    this.hero.movePoints = snap.movePoints;
    const w = this.tileWorld(this.hero.x, this.hero.y);
    this.heroMesh.position.set(w.x, w.y, w.z);
    // 3) 回滚迷雾（explored 只增不减，不还原就等于白送视野）
    this._restoreExplored(snap.explored);
    this.updateFog();
    this.hidePath();
    return true;
  }

  // ---------- 悬停 ----------
  hoverTile(x, y) {
    this.hidePath();
    if (!this.inBounds(x, y) || this.type[x][y] === 'water' || this.type[x][y] === 'mountain') {
      this.hoverRing.visible = false;
      return null;
    }
    // 战争迷雾也要挡逻辑：未探索格不暴露格上对象（否则光标形状/环色能摸出黑雾下的怪物与宝物）
    if (this.explored && this.explored[x] && !this.explored[x][y]) {
      this.hoverRing.visible = false;
      return null;
    }
    const w = this.tileWorld(x, y);
    this.hoverRing.position.set(w.x, w.y + 0.12, w.z);
    this.hoverRing.visible = true;
    const obj = this.objects.get(key(x, y));
    // 敌方英雄仅在当前视野内才暴露（与 updateFog 的可见性规则一致）
    const hidden = obj && obj.kind === 'enemyHero' && !(this.visible && this.visible[x] && this.visible[x][y]);
    if (hidden) {
      this.hoverRing.material.color.set(0xffe9b0);
      return null;
    }
    this.hoverRing.material.color.set(obj ? (obj.kind === 'monster' ? 0xff6b5a : 0xffd76b) : 0xffe9b0);
    // 路径预览（可达且移动力足够时）
    if (!obj && !this.moving && this.passable(x, y) && !(x === this.hero.x && y === this.hero.y)) {
      const p = this.findPath(this.hero.x, this.hero.y, x, y);
      if (p && p.steps.length && p.total <= this.hero.movePoints + 0.001) {
        p.steps.slice(0, this.pathDots.length).forEach((st, i) => {
          const sw = this.tileWorld(st.x, st.y);
          this.pathDots[i].position.set(sw.x, sw.y + 0.25, sw.z);
          this.pathDots[i].visible = true;
        });
      }
    }
    return obj;
  }

  // ---------- 帧更新 ----------
  update(dt) {
    this.time += dt;
    this.dayTime += dt;
    this.updateDayNight();
    this.water.position.y = -0.55 + Math.sin(this.time * 0.8) * 0.05;
    if (this.waterTex) {
      this.waterTex.offset.x += dt * 0.015;
      this.waterTex.offset.y += dt * 0.009;
    }
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 80) c.position.x = -80;
    }
    // 蝴蝶
    if (this.butterflies) {
      for (const b of this.butterflies) {
        const u = b.userData;
        const a = this.time * u.sp + u.ph;
        b.position.set(u.cx + Math.cos(a) * u.r, u.h + Math.sin(this.time * 2 + u.ph) * 0.35, u.cz + Math.sin(a) * u.r);
        b.rotation.y = -a + Math.PI / 2;
        const flap = Math.sin(this.time * 16 + u.ph) * 0.7;
        u.w1.rotation.y = 0.5 + flap;
        u.w2.rotation.y = -0.5 - flap;
      }
    }
    // 扬尘
    if (this.dustPool) {
      for (const d of this.dustPool) {
        if (!d.sp.visible) continue;
        d.life -= dt;
        if (d.life <= 0) { d.sp.visible = false; continue; }
        d.sp.position.y += dt * 0.5;
        d.sp.scale.setScalar(d.sp.scale.x + dt * 1.2);
        d.sp.material.opacity = d.life * 0.9;
      }
    }
    for (const o of this.animated) {
      if (o.kind === 'artifact') {
        o.mesh.position.y = o.baseY + 0.15 + Math.sin(this.time * 2 + o.x) * 0.12;
        o.mesh.rotation.y += dt * 1.5;
      } else if (o.kind === 'monster') {
        o.mesh.position.y = o.baseY + Math.abs(Math.sin(this.time * 2.2 + o.x * 1.3)) * 0.08;
        // 单 mesh glb 模型待机：轻微呼吸式起伏
        if (o.mesh.userData.fromGltf) {
          tiltNode(o.mesh).rotation.x = Math.sin(this.time * 1.5 + o.x) * 0.015;
        }
        // 野怪待机动画：振翅 / 幽灵波动
        const anim = o.mesh.userData.anim;
        if (anim && anim.wings) {
          const w = Math.sin(this.time * 5 + o.x) * 0.3;
          anim.wings[0].rotation.z = anim.wingBase + w;
          anim.wings[1].rotation.z = -anim.wingBase - w;
        }
        if (anim && anim.ghostMats) {
          const op = 0.5 + Math.sin(this.time * 2.5 + o.x) * 0.14;
          for (const m of anim.ghostMats) m.opacity = op;
        }
      } else if (o.kind === 'pickup') {
        o.mesh.rotation.y += dt * 0.8;
      } else if (o.kind === 'enemyHero') {
        // 敌方英雄待机：轻微呼吸式起伏 + 旗帜/披风动画
        if (!this.enemyTurn) {
          o.mesh.position.y = o.baseY + Math.sin(this.time * 2.5 + o.x) * 0.03;
          if (o.mesh.userData.fromGltf) {
            tiltNode(o.mesh).rotation.x = Math.sin(this.time * 1.5 + o.x) * 0.015;
          }
        }
        const eAnim = o.mesh.userData.anim;
        if (eAnim) {
          if (eAnim.flag) eAnim.flag.rotation.y = Math.sin(this.time * 3 + o.x) * 0.25;
          if (eAnim.cape) eAnim.cape.rotation.x = 0.25 + Math.sin(this.time * 2.2 + o.x) * 0.07;
        }
      } else if (o.kind === 'castle' || o.kind === 'enemyCastle') {
        const f = o.mesh.userData.flag;
        if (f) f.rotation.y = Math.sin(this.time * 3 + o.x) * 0.3;
      }
    }
    // 书签标记旋转动画（圆环绕法线自转，吸引视线）
    for (const ring of this.bookmarkMeshes.values()) {
      ring.rotation.z += dt * 1.5;
    }
    if (!this.moving) {
      this.heroMesh.position.y = this.tileH[this.hero.x][this.hero.y] + Math.sin(this.time * 2.5) * 0.03;
      // 单 mesh 模型待机：轻微呼吸式起伏（模拟马匹站立时的轻微摆动）
      if (this.heroMesh.userData.fromGltf) {
        tiltNode(this.heroMesh).rotation.x = Math.sin(this.time * 1.5) * 0.015;
      }
    }
    const hAnim = this.heroMesh.userData.anim;
    if (hAnim) {
      if (hAnim.flag) hAnim.flag.rotation.y = Math.sin(this.time * 3) * 0.25;
      if (hAnim.cape) hAnim.cape.rotation.x = 0.25 + Math.sin(this.time * 2.2) * 0.07;
    }
  }
}
