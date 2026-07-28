// ================= 六边形战场回合制战斗 =================
import * as THREE from 'three';
import { UNITS, BATTLE, SPELLS } from './config.js';
import { DIFF, damageCoef } from './difficulty.js';
import { hexToWorld, hexNeighbors, hexDistance, Tweens, easeLinear, easeOut, rand, randInt, clamp, sfx, disposeObject3D, tiltNode } from './utils.js';
import { createUnit, makeObstacle, makeTree } from './assets/factory.js';
import { makeDetailTexture, makeSkyMaterial, makeCloudSprite } from './textures.js';

const { COLS: BC, ROWS: BR } = BATTLE;
const UNIT_Y = 0.15; // 单位站立高度 = 倒角六边形顶面

// 地貌主题（按战斗发生地）
const THEMES = {
  grass:  { ground: 0x3a5c33, hexA: 0x4c7a45, hexB: 0x568a4d, fog: 0x8fb8d8, skyTop: 0x4a8fd8, skyHor: 0xb8d8f0, trees: 16 },
  forest: { ground: 0x2a4426, hexA: 0x3a6134, hexB: 0x446e3c, fog: 0x7aa88a, skyTop: 0x3a7ab8, skyHor: 0x9fc0b8, trees: 26 },
  waste:  { ground: 0x5c4a33, hexA: 0x8a7a55, hexB: 0x97865f, fog: 0xc8b090, skyTop: 0x6a9ac8, skyHor: 0xe0cba0, trees: 6 },
};
const key = (c, r) => c + ',' + r;
const OX = (BC - 1) * 1.5 / 2;          // 战场居中偏移
const OZ = ((BR - 1) + 0.5) * Math.sqrt(3) / 2;

const PLAYER_SLOTS = [[0, 4], [0, 2], [0, 6], [1, 3], [1, 5], [0, 1], [0, 7]];
const ENEMY_SLOTS = [[12, 4], [12, 2], [12, 6], [11, 3], [11, 5], [12, 1], [12, 7]];

let STACK_ID = 1;

export class Battle {
  /**
   * @param {object} o { scene, playerArmy, enemyArmy, hero, ui, onEnd }
   * hero: { atk, def, mp, level }
   */
  constructor(o) {
    this.scene = o.scene;
    this.ui = o.ui;
    this.onEnd = o.onEnd;
    this.hero = o.hero;
    this.heroMp = o.hero.mp;
    this.enemyHero = o.enemyHero || { atk: 0, def: 0 }; // 敌方英雄属性加成
    this.playerArmySrc = o.playerArmy;
    this.enemyArmySrc = o.enemyArmy;
    this.theme = THEMES[o.theme] || THEMES.grass;
    this.shadows = o.shadows !== false;

    this.stacks = [];
    this.queue = [];
    this.round = 1;
    this.active = null;
    this.moved = false;
    this.busy = false;
    this.over = false;
    this.activeSpell = null;  // 正在瞄准的法术 key
    this.spellRound = 0;      // 本回合是否已施法
    this.reach = new Map();
    this.attackable = new Set();
    this.obstacles = new Set();
    this.time = 0;
    this.kills = 0;           // 本场击杀的敌方单位数（结算统计用）
    this.timeScale = 1;       // 时间缩放（结算慢镜头用）
    this.cinematic = false;   // 结算动画进行中（锁定输入、隐藏标记）

    this.buildField();
    this.deploy();
    this.startRound(true);
  }

  // ---------- 场景搭建 ----------
  hexWorld(col, row) {
    const p = hexToWorld(col, row);
    return { x: p.x - OX, z: p.z - OZ };
  }

  buildField() {
    // 根节点（震屏时整体偏移）
    this.root = new THREE.Group();
    this.scene.add(this.root);
    const s = this.root;
    this.shakeAmt = 0;
    this.particles = new Particles(s);
    // 背景/雾/灯光挂 scene（不随震屏偏移）
    const sc = this.scene;
    const th = this.theme;
    sc.background = new THREE.Color(th.fog);
    sc.fog = new THREE.Fog(th.fog, 40, 110);
    // 天空穹顶 + 云
    const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 20, 10), makeSkyMaterial(th.skyTop, th.skyHor));
    sky.frustumCulled = false;
    sc.add(sky);
    // 云必须放在相机活动球【之外】：相机绕 (0,0,0.5) 公转、距离上限 32
    // （见 main.js setCameraBattle）。原先撒在 x/z∈[-35,35]、y∈[10,16] 的方盒里，
    // 与相机活动范围完全重叠——实测近半数云在某些机位会挡在镜头与战场之间。
    // 改成环形分布：水平半径 45~70（远超 maxDistance 32）、高度 22~34。
    for (let i = 0; i < 5; i++) {
      const cloud = makeCloudSprite();
      const s2 = rand(9, 15);                       // 放远了，等比放大保持观感
      cloud.scale.set(s2, s2 * 0.5, 1);
      const ang = (i / 5) * Math.PI * 2 + rand(-0.4, 0.4);
      const rad = rand(45, 70);
      cloud.position.set(Math.cos(ang) * rad, rand(22, 34), Math.sin(ang) * rad);
      cloud.renderOrder = -1;                       // 双保险：永远先于战场内容绘制
      if (cloud.material) cloud.material.depthWrite = false;
      sc.add(cloud);
    }
    sc.add(new THREE.HemisphereLight(0xd8ecff, 0x2f4a2a, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(18, 30, 12);
    sun.castShadow = this.shadows;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, far: 80 });
    sun.shadow.bias = -0.0005;
    sc.add(sun);

    // 地面（提高细分，细节纹理更清晰）
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(34, 24, 48, 32),
      new THREE.MeshStandardMaterial({
        color: th.ground, map: makeDetailTexture(18),
        roughness: 0.92, metalness: 0.0,
      }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    s.add(ground);

    // 六边形棋盘：倒角挤出体 + InstancedMesh（精度↑、无闪烁）
    const HEX_Y = 0.0;
    const hexShape = new THREE.Shape();
    const HEX_R = 0.94;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i; // pointy-top 对齐现有布局
      const px = Math.cos(a) * HEX_R, py = Math.sin(a) * HEX_R;
      if (i === 0) hexShape.moveTo(px, py); else hexShape.lineTo(px, py);
    }
    hexShape.closePath();
    const hexGeo = new THREE.ExtrudeGeometry(hexShape, {
      depth: 0.11,
      bevelEnabled: true,
      bevelThickness: 0.028,
      bevelSize: 0.032,
      bevelSegments: 3,
      curveSegments: 1,
    });
    hexGeo.rotateX(-Math.PI / 2);
    hexGeo.translate(0, 0.02, 0); // 顶面略抬高
    hexGeo.computeVertexNormals();

    const cA = new THREE.Color(th.hexA), cB = new THREE.Color(th.hexB);
    this.hexBC = BR;
    this.hexInst = new THREE.InstancedMesh(hexGeo,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }), BC * BR);
    this.hexInst.receiveShadow = true;
    this.hexInst.castShadow = false;
    this.hexBaseColor = [];
    const _dummy = new THREE.Object3D();
    // 顶面描边（略高于倒角面）
    const edgeY = 0.14;
    const edgePos = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      edgePos.push(Math.cos(a) * 0.9, edgeY, Math.sin(a) * 0.9);
    }
    const allEdge = [];
    for (let c = 0; c < BC; c++) {
      for (let r = 0; r < BR; r++) {
        const id = c * BR + r;
        const w = this.hexWorld(c, r);
        _dummy.position.set(w.x, HEX_Y, w.z);
        _dummy.updateMatrix();
        this.hexInst.setMatrixAt(id, _dummy.matrix);
        const base = (c + r) % 2 ? cA : cB;
        this.hexBaseColor[id] = base.clone();
        this.hexInst.setColorAt(id, base);
        for (let i = 0; i < 6; i++) {
          const j = (i + 1) % 6;
          allEdge.push(edgePos[i * 3] + w.x, edgePos[i * 3 + 1], edgePos[i * 3 + 2] + w.z);
          allEdge.push(edgePos[j * 3] + w.x, edgePos[j * 3 + 1], edgePos[j * 3 + 2] + w.z);
        }
      }
    }
    this.hexInst.instanceMatrix.needsUpdate = true;
    this.hexInst.instanceColor.needsUpdate = true;
    this.hexInst.userData.hexField = true;
    s.add(this.hexInst);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(allEdge, 3));
    const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: 0x142414, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    s.add(edges);

    // 围栏 + 角落火盆
    this.buildArenaDeco(s);

    // 障碍物
    let placed = 0, guard = 0;
    while (placed < 6 && guard++ < 200) {
      const c = randInt(4, 8), r = randInt(0, BR - 1), k = key(c, r);
      if (this.obstacles.has(k)) continue;
      this.obstacles.add(k);
      const ob = makeObstacle();
      const w = this.hexWorld(c, r);
      ob.position.set(w.x, UNIT_Y, w.z);
      s.add(ob);
      placed++;
    }

    // 四周装饰树（数量随主题）
    for (let i = 0; i < th.trees; i++) {
      const t = makeTree();
      const ang = (i / th.trees) * Math.PI * 2;
      const rx = Math.cos(ang) * (13 + Math.random() * 3);
      const rz = Math.sin(ang) * (9 + Math.random() * 2.5);
      t.position.set(rx, 0, rz);
      t.scale.setScalar(1 + Math.random() * 0.8);
      s.add(t);
    }

    // 主动单位标记
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0xffd76b }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    s.add(this.marker);
  }

  // 战场边缘装饰：石栏 + 火盆
  buildArenaDeco(s) {
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x6a6558 });
    const FW = OX + 1.6, FD = OZ + 1.6;
    const mkWall = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), wallMat);
      m.position.set(x, 0.16, z);
      m.castShadow = m.receiveShadow = true;
      s.add(m);
    };
    mkWall(FW * 2 + 1, 0.4, 0, -FD);
    mkWall(FW * 2 + 1, 0.4, 0, FD);
    mkWall(0.4, FD * 2, -FW, 0);
    mkWall(0.4, FD * 2, FW, 0);
    // 火盆
    const fireBalls = [];
    for (const [x, z] of [[-FW, -FD], [FW, -FD], [-FW, FD], [FW, FD]]) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.18, 0.5, 8), wallMat);
      bowl.position.set(x, 0.6, z);
      bowl.castShadow = true;
      s.add(bowl);
      const fire = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
      fire.position.set(x, 0.95, z);
      s.add(fire);
      fireBalls.push(fire);
    }
    this.fireBalls = fireBalls;
  }

  deploy() {
    const mk = (src, side, slot) => {
      const t = UNITS[src.type];
      const st = {
        id: STACK_ID++, side, type: src.type, t,
        count: src.count, topHP: t.hp, maxCount: src.count,
        col: slot[0], row: slot[1],
        shotsLeft: t.shots || 0, spdBonus: 0,
        slowRounds: 0, blessRounds: 0,
        defending: false, retaliated: false, alive: true,
        moraleTriggered: false,
        mesh: null, label: null,
      };
      const mesh = createUnit(src.type, side);
      const w = this.hexWorld(st.col, st.row);
      mesh.position.set(w.x, UNIT_Y, w.z);
      mesh.rotation.y = side === 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh.userData.stack = st;
      this.root.add(mesh);
      st.mesh = mesh;
      st.label = this.ui.makeStackLabel(st);
      this.stacks.push(st);
      return st;
    };
    this.playerArmySrc.slice(0, 7).forEach((src, i) => mk(src, 0, PLAYER_SLOTS[i]));
    this.enemyArmySrc.slice(0, 7).forEach((src, i) => mk(src, 1, ENEMY_SLOTS[i]));
  }

  // ---------- 回合队列 ----------
  aliveStacks(side) { return this.stacks.filter(s => s.alive && (side === undefined || s.side === side)); }
  // 有效速度（含加速/减速）
  effSpd(st) { return Math.max(1, Math.floor((st.t.spd + st.spdBonus) * (st.slowRounds > 0 ? 0.5 : 1))); }

  startRound(first = false) {
    if (!first) {
      this.round++;
      this.ui.toast(`第 ${this.round} 回合`, 'round');
      this.ui.battleLog(`—— 第 ${this.round} 回合 ——`, 'round');
      this.ui.turnBanner(`第 ${this.round} 回合`, 'round');
      sfx('turn');                      // 新回合提示音
    } else {
      this.ui.turnBanner('战斗开始！', 'start');
    }
    for (const st of this.aliveStacks()) {
      st.retaliated = false; st.defending = false;
      if (st.slowRounds > 0) st.slowRounds--;
      if (st.blessRounds > 0) st.blessRounds--;
    }
    this.queue = this.aliveStacks().sort((a, b) => this.effSpd(b) - this.effSpd(a) || a.side - b.side);
    this.nextTurn();
  }

  nextTurn() {
    if (this.over) return;
    if (!this.queue.length) { this.startRound(); return; }
    const st = this.queue.shift();
    if (!st.alive) { this.nextTurn(); return; }
    this.active = st;
    st.defending = false;
    st.moraleTriggered = false;
    this.moved = false;
    this.activeSpell = null;
    this.refreshUI();
    if (st.side === 1) {
      this.busy = true;
      Tweens.delay(0.65, () => this.aiAct(st));
    }
  }

  endTurn(acted = true) {
    if (this.over) return;
    this.clearHighlight();
    this.marker.visible = false;
    this.busy = false;
    // 士气高涨：行动后概率再动一次（玩家与敌方均可，受难度控制）
    const st = this.active;
    const moraleChance = (st && st.side === 0 ? DIFF.morale.player : DIFF.morale.enemy) + (st && st.side === 0 ? 0.05 * this.skill('leadership') : 0);
    if (acted && st && st.alive && !st.moraleTriggered && Math.random() < moraleChance) {
      st.moraleTriggered = true;
      st.defending = false;
      this.moved = false;
      this.ui.floaterAt(st, '士气高涨', 'buff');
      this.ui.battleLog(`${st.t.name} 士气高涨，再次行动！`, 'morale');
      sfx('level');
      this.refreshUI();
      if (st.side === 1) { this.busy = true; Tweens.delay(0.65, () => this.aiAct(st)); }
      return;
    }
    this.checkEnd() || this.nextTurn();
  }

  checkEnd() {
    const p = this.aliveStacks(0).length, e = this.aliveStacks(1).length;
    if (p && e) return false;
    this.over = true;
    this.clearHighlight();
    this.marker.visible = false;
    const win = e === 0;
    // 略作停顿让最后一击动画播完，再进入慢镜头结算（不直接 onEnd）
    Tweens.delay(0.4, () => this.playEndCinematic(win));
    return true;
  }

  // ---------- 战斗结算动画（慢镜头 + 粒子 + 音效） ----------
  // 胜利：金色粒子上飘 + 凯旋音效；失败：红色粒子下沉 + 低沉音效
  playEndCinematic(win) {
    this.cinematic = true;             // 锁定输入（over 已为 true，此处冗余保护）
    this.timeScale = 0.3;              // 慢镜头
    sfx(win ? 'win' : 'lose');         // 凯旋 / 低沉音效
    this.spawnEndParticles(win);       // 金色上飘 / 红色下沉
    // 1.5 秒慢镜头后恢复常速并回调结算，总时长约 1.9 秒
    Tweens.delay(1.5, () => {
      this.timeScale = 1;
      this.cinematic = false;
      const surviving = this.aliveStacks(0).map(s => ({ type: s.type, count: s.count }));
      this.onEnd(win, surviving, this.kills);
    });
  }

  // 结算粒子：50 个粒子从战场中心散开，胜利向上飘、失败向下沉，整体渐隐
  // 使用独立 THREE.Points + Tweens 驱动，不受 timeScale 影响
  spawnEndParticles(win) {
    const N = 50;
    const pos = new Float32Array(N * 3);
    const vel = [];
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = rand(-0.8, 0.8);          // 战场中心附近随机起点
      pos[i * 3 + 1] = 0.5 + rand(-0.2, 0.2);
      pos[i * 3 + 2] = rand(-0.8, 0.8);
      const a = Math.random() * Math.PI * 2;
      const r = rand(0.4, 1.2);
      vel.push({
        x: Math.cos(a) * r,
        y: win ? rand(2.0, 3.5) : rand(-2.6, -1.2),  // 胜利上飘 / 失败下沉
        z: Math.sin(a) * r,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: win ? 0xffd76b : 0xff4444,
      size: 0.28, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.root.add(points);
    const D = 1.5;                     // 粒子动画时长（真实秒）
    let prevK = 0;
    Tweens.add({
      dur: D, ease: easeLinear,
      onUpdate: k => {
        const dt = (k - prevK) * D;    // 由进度差换算真实时间步长
        prevK = k;
        for (let i = 0; i < N; i++) {
          pos[i * 3]     += vel[i].x * dt;
          pos[i * 3 + 1] += vel[i].y * dt;
          pos[i * 3 + 2] += vel[i].z * dt;
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = 1 - k;           // 渐隐
      },
      onDone: () => {
        this.root.remove(points);
        geo.dispose(); mat.dispose();
      },
    });
  }

  // ---------- 范围计算 ----------
  stackAt(col, row) {
    return this.stacks.find(s => s.alive && s.col === col && s.row === row) || null;
  }
  adjacentEnemies(st) {
    return hexNeighbors(st.col, st.row)
      .map(([c, r]) => this.stackAt(c, r))
      .filter(s => s && s.side !== st.side);
  }
  canShoot(st) {
    return st.t.shots && st.shotsLeft > 0 && this.adjacentEnemies(st).length === 0;
  }

  computeReach(st) {
    const res = new Map();
    const start = { c: st.col, r: st.row, d: 0, prev: null, noLand: false };
    res.set(key(start.c, start.r), start);
    const q = [start];
    const maxD = this.effSpd(st);
    while (q.length) {
      const cur = q.shift();
      if (cur.d >= maxD) continue;
      for (const [nc, nr] of hexNeighbors(cur.c, cur.r)) {
        if (nc < 0 || nr < 0 || nc >= BC || nr >= BR) continue;
        const k = key(nc, nr);
        if (res.has(k)) continue;
        const occ = this.stackAt(nc, nr), blocked = this.obstacles.has(k);
        if (occ || blocked) {
          if (st.t.fly) { // 飞行单位可越过但不能停留
            const node = { c: nc, r: nr, d: cur.d + 1, prev: cur, noLand: true };
            res.set(k, node); q.push(node);
          }
          continue;
        }
        const node = { c: nc, r: nr, d: cur.d + 1, prev: cur, noLand: false };
        res.set(k, node); q.push(node);
      }
    }
    res.delete(key(st.col, st.row));
    return res;
  }

  // ---------- 高亮（InstancedMesh instanceColor） ----------
  hexId(c, r) { return c * this.hexBC + r; }
  setHex(c, r, hex) { this.hexInst.setColorAt(this.hexId(c, r), hex); }
  clearHighlight() {
    for (let id = 0; id < BC * BR; id++) this.hexInst.setColorAt(id, this.hexBaseColor[id]);
    this.hexInst.instanceColor.needsUpdate = true;
    this.reach.clear();
    this.attackable.clear();
  }

  highlight() {
    this.clearHighlight();
    const st = this.active;
    if (!st || st.side !== 0) { this.hexInst.instanceColor.needsUpdate = true; return; }
    // 主动格（亮金）
    this.setHex(st.col, st.row, new THREE.Color(0x8a7322));
    // 可移动格
    if (!this.moved) {
      this.reach = this.computeReach(st);
      const moveC = new THREE.Color(0x3f6f9e);
      for (const node of this.reach.values()) {
        if (node.noLand) continue;
        this.setHex(node.c, node.r, moveC);
      }
    }
    // 可攻击敌人
    if (this.canShoot(st)) {
      for (const e of this.aliveStacks(1)) this.attackable.add(e.id);
    } else {
      for (const e of this.adjacentEnemies(st)) this.attackable.add(e.id);
      if (!this.moved) {
        for (const node of this.reach.values()) {
          if (node.noLand) continue;
          for (const [c, r] of hexNeighbors(node.c, node.r)) {
            const e = this.stackAt(c, r);
            if (e && e.side === 1) this.attackable.add(e.id);
          }
        }
      }
    }
    const atkC = new THREE.Color(0xa5443a);
    for (const e of this.aliveStacks(1)) {
      if (this.attackable.has(e.id)) this.setHex(e.col, e.row, atkC);
    }
    this.hexInst.instanceColor.needsUpdate = true; // 批量更新一次
  }

  refreshUI() {
    this.highlight();
    this.ui.closeSpellMenu();
    const st = this.active;
    this.ui.updateQueue(this.queue, st, this.round);
    this.ui.updateActivePanel(st, this.heroMp);
    const minCost = Math.min(...Object.values(SPELLS).map(s => s.cost));
    this.ui.setBattleButtons({
      wait: st.side === 0 && !this.moved,
      defend: st.side === 0,
      spell: st.side === 0 && this.heroMp >= minCost && this.spellRound < this.round,
      spellText: `魔法书(S) MP:${this.heroMp}`,
    });
    if (st.side === 0) {
      const sp = this.activeSpell ? SPELLS[this.activeSpell] : null;
      this.ui.setHint(sp ? `点击${sp.target === 'ally' ? '友军' : '敌方'}单位施放【${sp.name}】（右键取消）` :
        this.moved ? '点击红色格敌人攻击，或按「防御」结束行动' :
        '点击蓝色格移动，点击敌人移动并攻击');
    } else {
      this.ui.setHint('敌方行动中…');
    }
  }

  // ---------- 输入 ----------
  onHexClick(col, row) {
    if (this.busy || this.over || !this.active || this.active.side !== 0) return;
    if (this.activeSpell) { this.cancelSpell(); return; }
    this.ui.closeSpellMenu();
    if (this.moved) return;
    const node = this.reach.get(key(col, row));
    if (!node || node.noLand) return;
    sfx('click');
    this.moveActive(node, null);
  }

  onStackClick(target) {
    if (this.busy || this.over || !this.active || this.active.side !== 0) return;
    if (this.activeSpell) {
      const sp = SPELLS[this.activeSpell];
      const ok = sp.target === 'ally' ? target.side === 0 : target.side === 1;
      if (ok) this.castSpell(this.activeSpell, target);
      else this.ui.toast(sp.target === 'ally' ? '请选择友军单位' : '请选择敌方单位', 'warn');
      return;
    }
    if (target.side !== 1 || !this.attackable.has(target.id)) return;
    const st = this.active;
    // 远程直射
    if (this.canShoot(st)) { this.attack(st, target, { shoot: true }); return; }
    // 近战：相邻直接打，否则走过去打
    if (hexDistance(st.col, st.row, target.col, target.row) === 1) {
      this.attack(st, target, {});
      return;
    }
    if (this.moved) return;
    // 找目标相邻的最佳落点
    let best = null;
    for (const [c, r] of hexNeighbors(target.col, target.row)) {
      const node = this.reach.get(key(c, r));
      if (node && !node.noLand && (!best || node.d < best.d)) best = node;
    }
    if (!best) { this.ui.toast('无法接近该敌人', 'warn'); return; }
    this.moveActive(best, () => this.attack(st, target, {}));
  }

  // ---------- 移动 ----------
  moveActive(node, then) {
    const st = this.active;
    this.busy = true;
    this.clearHighlight();
    // 还原路径
    const waypoints = [];
    let n = node;
    while (n && n.prev) { waypoints.unshift(n); n = n.prev; }
    let i = 0;
    const step = () => {
      if (i >= waypoints.length) {
        st.col = node.c; st.row = node.r;
        this.moved = true;
        this.busy = false;
        if (then) { then(); return; }
        this.refreshUI();
        return;
      }
      const wp = waypoints[i];
      const from = st.mesh.position.clone();
      const w = this.hexWorld(wp.c, wp.r);
      st.mesh.lookAt(w.x, from.y, w.z);
      Tweens.add({
        dur: 0.14, ease: easeLinear,
        onUpdate: k => {
          st.mesh.position.lerpVectors(from, new THREE.Vector3(w.x, UNIT_Y, w.z), k);
          st.mesh.position.y = UNIT_Y + Math.abs(Math.sin(k * Math.PI)) * (st.t.fly ? 0.5 : 0.15);
          const legs = st.mesh.userData.anim && st.mesh.userData.anim.legs;
          if (legs) for (let li = 0; li < legs.length; li++) legs[li].rotation.x = Math.sin(k * Math.PI * 2) * 0.5 * (li % 2 ? 1 : -1);
          // 单 mesh glb 模型：整体前后倾斜模拟步态（无骨骼也能有动感）
          if (st.mesh.userData.fromGltf && !legs) {
            const t = tiltNode(st.mesh);                             // 写子节点，勿写被 lookAt 控制的本体
            t.rotation.x = Math.sin(k * Math.PI * 4) * 0.08;         // 前后颠簸
            t.rotation.z = Math.sin(k * Math.PI * 2) * 0.04;         // 左右轻晃
          }
        },
        onDone: () => {
          const legs = st.mesh.userData.anim && st.mesh.userData.anim.legs;
          if (legs) for (const leg of legs) leg.rotation.x = 0;
          if (st.mesh.userData.fromGltf && !legs) {
            const t = tiltNode(st.mesh);
            t.rotation.x = 0;
            t.rotation.z = 0;
          }
          i++; step();
        },
      });
    };
    step();
  }

  // ---------- 伤害 ----------
  skill(key) { return (this.hero.skills && this.hero.skills[key]) || 0; }

  calcDamage(att, def, { shoot = false } = {}) {
    const heroA = att.side === 0 ? this.hero.atk : this.enemyHero.atk;
    const heroD = def.side === 0 ? this.hero.def : this.enemyHero.def;
    const A = att.t.atk + heroA;
    let D = def.t.def + heroD;
    if (def.defending) D = Math.round(D * DIFF.defendBonus);
    // 祝福：造成最大伤害加成
    const base = (att.blessRounds > 0
      ? Math.round(att.t.dmg[1] * DIFF.blessBonus)
      : randInt(att.t.dmg[0], att.t.dmg[1])) * att.count;
    // 倍率系数按「攻击方阵营」取组：玩家组与敌方组随难度反向变化
    // （单组时困难档会把敌方输出一起削弱，方向反了）
    const C = damageCoef(att.side);
    let mult = A >= D
      ? 1 + C.atkFactor * Math.min(A - D, C.atkCap)
      : Math.max(C.minMult, 1 - C.defFactor * Math.min(D - A, C.defCap));
    if (!shoot && att.t.shots) mult *= DIFF.shooterMeleeMult; // 射手近战减伤
    if (att.side === 0 && !shoot) mult *= 1 + 0.1 * this.skill('offense');   // 进攻术
    if (def.side === 0) mult *= 1 - 0.07 * this.skill('armorer');            // 防御术
    // 幸运一击
    let luck = false;
    if (att.side === 0 && this.skill('luck') > 0 && Math.random() < DIFF.luckChance * this.skill('luck')) {
      mult *= 2; luck = true;
    }
    return { dmg: Math.max(1, Math.round(base * mult)), luck };
  }

  applyDamage(def, dmg) {
    if (def.side === 0) sfx('hurt');    // 我方挨打：额外的闷响，强化「被打疼了」的反馈
    const pool = (def.count - 1) * def.t.hp + def.topHP - dmg;
    const oldCount = def.count;
    if (pool <= 0) {
      def.count = 0; def.alive = false;
    } else {
      def.count = Math.ceil(pool / def.t.hp);
      def.topHP = pool - (def.count - 1) * def.t.hp;
    }
    const kills = oldCount - def.count;
    if (kills > 0 && def.side === 1) this.kills += kills;
    this.ui.floaterAt(def, `-${dmg}`, 'dmg');
    if (kills > 0) this.ui.floaterAt(def, `${kills} 阵亡`, 'kill', 0.35);
    this.ui.updateStackLabel(def);
    this.flashHit(def);
    this.shake(Math.min(0.3, 0.08 + dmg / 400));
    this.particles.burst(def.mesh.position.x, 0.8, def.mesh.position.z,
      { color: 0xffb060, n: Math.min(18, 6 + Math.floor(dmg / 12)), speed: 2.2, life: 0.5 });
    if (!def.alive) this.killStack(def);
    return kills;
  }

  // 受击红闪
  flashHit(st) {
    const mats = [];
    st.mesh.traverse(o => { if (o.material && o.material.emissive) mats.push(o.material); });
    const orig = mats.map(m => m.emissive.getHex());
    for (const m of mats) m.emissive.setRGB(0.85, 0.2, 0.1);
    Tweens.add({
      dur: 0.28, ease: easeLinear,
      onUpdate: k => { const v = 1 - k; for (const m of mats) m.emissive.setRGB(0.85 * v, 0.2 * v, 0.1 * v); },
      onDone: () => mats.forEach((m, i) => m.emissive.setHex(orig[i])),
    });
  }

  // 震屏
  shake(amt) { this.shakeAmt = Math.max(this.shakeAmt, amt); }

  killStack(st) {
    const mesh = st.mesh;
    sfx('death');                       // 阵亡：低沉下坠音
    this.ui.removeStackLabel(st);
    this.particles.burst(mesh.position.x, 1.0, mesh.position.z,
      { color: 0x9a9a9a, n: 16, speed: 1.2, up: 2.6, life: 1.0 });
    // 倒地 + 下沉
    const fallDir = st.side === 0 ? 1 : -1;
    Tweens.add({
      dur: 0.5, ease: easeOut,
      onUpdate: k => {
        mesh.rotation.z = fallDir * k * 1.35;
        mesh.position.y = UNIT_Y - k * 0.18;
      },
    });
    Tweens.add({
      dur: 0.35, ease: easeLinear, onUpdate: () => {},
      onDone: () => {
        Tweens.add({
          dur: 0.5,
          onUpdate: k => { mesh.position.y = UNIT_Y - 0.18 - k * 0.5; mesh.scale.setScalar(1 - k * 0.6); },
          onDone: () => { this.root.remove(mesh); disposeObject3D(mesh); },
        });
      },
    });
  }

  // ---------- 攻击 ----------
  attack(att, def, { shoot = false, retaliation = false } = {}) {
    this.busy = true;
    this.clearHighlight();
    const dw = this.hexWorld(def.col, def.row);
    att.mesh.lookAt(dw.x, att.mesh.position.y, dw.z);
    def.mesh.lookAt(att.mesh.position.x, def.mesh.position.y, att.mesh.position.z);

    const doDamage = () => {
      const { dmg, luck } = this.calcDamage(att, def, { shoot });
      const kills = this.applyDamage(def, dmg);
      if (luck) this.ui.floaterAt(def, '幸运一击！', 'buff', 0.1);
      this.ui.battleLog(
        `${retaliation ? '【反击】' : ''}${att.t.name}${shoot ? '射击' : '攻击'}${def.t.name}，造成 ${dmg} 伤害${luck ? '（幸运一击）' : ''}${kills ? `，击杀 ${kills}` : ''}`,
        att.side === 0 ? 'ally' : 'enemy');
      sfx(shoot ? 'shoot' : 'hit');
      // 反击
      if (!shoot && !retaliation && def.alive && !def.retaliated &&
          hexDistance(att.col, att.row, def.col, def.row) === 1) {
        def.retaliated = true;
        Tweens.delay(0.4, () => {
          if (def.alive && att.alive) this.attack(def, att, { retaliation: true });
          else this.finishAction();
        });
      } else {
        Tweens.delay(0.25, () => this.finishAction());
      }
    };

    if (shoot) {
      att.shotsLeft--;
      sfx('arrow');                     // 箭矢破空
      // 箭矢
      const aw = this.hexWorld(att.col, att.row);
      const arrow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
      arrow.position.set(aw.x, 0.9, aw.z);
      this.root.add(arrow);
      const from = arrow.position.clone();
      const to = new THREE.Vector3(dw.x, 0.7, dw.z);
      Tweens.add({
        dur: 0.28, ease: easeLinear,
        onUpdate: k => {
          arrow.position.lerpVectors(from, to, k);
          arrow.position.y += Math.sin(k * Math.PI) * 1.2;
        },
      onDone: () => { disposeObject3D(arrow); this.root.remove(arrow); doDamage(); },
      });
    } else {
      // 近战突进
      const from = att.mesh.position.clone();
      const lunge = new THREE.Vector3(dw.x, UNIT_Y, dw.z).sub(from).multiplyScalar(0.45).add(from);
      Tweens.add({
        dur: 0.13, ease: easeOut,
        onUpdate: k => att.mesh.position.lerpVectors(from, lunge, k),
        onDone: () => {
          doDamage();
          Tweens.add({
            dur: 0.16,
            onUpdate: k => att.mesh.position.lerpVectors(lunge, from, k),
          });
        },
      });
    }
  }

  finishAction() {
    if (this.over) return;
    this.endTurn();
  }

  // ---------- 等待 / 防御 / 魔法 ----------
  waitAction() {
    if (this.busy || !this.active || this.active.side !== 0 || this.moved) return;
    sfx('click');
    this.ui.battleLog(`${this.active.t.name} 等待`, 'round');
    this.queue.push(this.active); // 排到队尾
    this.endTurn(false);
  }

  defendAction() {
    if (this.busy || !this.active || this.active.side !== 0) return;
    this.active.defending = true;
    sfx('block');                       // 举盾格挡
    this.ui.floaterAt(this.active, '防御', 'buff');
    this.ui.battleLog(`${this.active.t.name} 防御（防御力 +20%）`, 'round');
    sfx('click');
    this.endTurn();
  }

  spellAction() {
    if (this.busy || !this.active || this.active.side !== 0) return;
    if (this.spellRound >= this.round) { this.ui.toast('本回合已施放魔法', 'warn'); return; }
    if (this.ui.isSpellMenuOpen()) { this.ui.closeSpellMenu(); return; }
    sfx('click');
    this.ui.toggleSpellMenu(this.heroMp);
  }
  selectSpell(key) {
    const sp = SPELLS[key];
    if (!sp || this.heroMp < sp.cost) return;
    this.activeSpell = key;
    this.ui.closeSpellMenu();
    sfx('click');
    this.refreshUI();
  }
  cancelSpell() {
    this.activeSpell = null;
    this.ui.closeSpellMenu();
    this.refreshUI();
  }

  beamEffect(target, color) {
    const w = this.hexWorld(target.col, target.row);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.3, 9, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
    );
    beam.position.set(w.x, 4.5, w.z);
    this.root.add(beam);
    Tweens.add({
      dur: 0.45, ease: easeLinear,
      onUpdate: k => { beam.material.opacity = 0.9 * (1 - k); beam.scale.x = beam.scale.z = 1 + k * 1.5; },
      onDone: () => { disposeObject3D(beam); this.root.remove(beam); },
    });
  }
  explodeEffect(target) {
    sfx('fireball');                    // 火球轰鸣
    const w = this.hexWorld(target.col, target.row);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.85 })
    );
    ball.position.set(w.x, 0.6, w.z);
    this.root.add(ball);
    Tweens.add({
      dur: 0.4, ease: easeOut,
      onUpdate: k => { ball.scale.setScalar(1 + k * 4); ball.material.opacity = 0.85 * (1 - k); },
      onDone: () => { disposeObject3D(ball); this.root.remove(ball); },
    });
    this.particles.burst(w.x, 0.8, w.z, { color: 0xff7a2a, n: 26, speed: 3.2, life: 0.7 });
    this.shake(0.3);
  }
  // 折线闪电
  lightning(from, to, color = 0x9fd8ff) {
    const pts = [];
    const segs = 9;
    for (let i = 0; i <= segs; i++) {
      const p = from.clone().lerp(to, i / segs);
      if (i > 0 && i < segs) { p.x += rand(-0.35, 0.35); p.z += rand(-0.35, 0.35); }
      pts.push(p);
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const line = new THREE.Line(g, m);
    this.root.add(line);
    Tweens.add({
      dur: 0.32, ease: easeLinear,
      onUpdate: k => { m.opacity = 1 - k; },
      onDone: () => { this.root.remove(line); g.dispose(); m.dispose(); },
    });
  }

  castSpell(key, target) {
    const sp = SPELLS[key];
    this.activeSpell = null;
    this.heroMp -= sp.cost;
    this.spellRound = this.round;
    this.busy = true;
    sfx('magic');
    const lvl = this.hero.level;
    const sorc = 1 + 0.15 * this.skill('sorcery'); // 魔力加成
    const done = () => { this.busy = false; this.checkEnd() || this.refreshUI(); };
    if (key === 'arrow') {
      const dmg = Math.round((50 + 15 * (lvl - 1)) * sorc);
      // 天降闪电
      const w = this.hexWorld(target.col, target.row);
      this.lightning(new THREE.Vector3(w.x + rand(-1, 1), 9, w.z + rand(-1, 1)), new THREE.Vector3(w.x, 0.6, w.z), 0x9fd8ff);
      this.lightning(new THREE.Vector3(w.x + rand(-1, 1), 9, w.z + rand(-1, 1)), new THREE.Vector3(w.x, 0.6, w.z), 0xc8e8ff);
      this.shake(0.18);
      Tweens.delay(0.15, () => {
        const kills = this.applyDamage(target, dmg);
        this.ui.battleLog(`英雄施放【魔法神箭】，${target.t.name} 受到 ${dmg} 伤害${kills ? `，击杀 ${kills}` : ''}`, 'spell');
        done();
      });
    } else if (key === 'heal') {
      const amount = Math.round((40 + 20 * (lvl - 1)) * sorc);
      this.beamEffect(target, 0x7dff6a);
      const w = this.hexWorld(target.col, target.row);
      this.particles.burst(w.x, 0.7, w.z, { color: 0x7dff6a, n: 16, speed: 0.9, up: 2.4, life: 0.9 });
      Tweens.delay(0.15, () => {
        const before = target.count;
        const pool = Math.min(target.maxCount * target.t.hp, (target.count - 1) * target.t.hp + target.topHP + amount);
        target.count = Math.ceil(pool / target.t.hp);
        target.topHP = pool - (target.count - 1) * target.t.hp;
        this.ui.updateStackLabel(target);
        this.ui.floaterAt(target, `+${amount}`, 'heal');
        const revived = target.count - before;
        this.ui.battleLog(`英雄施放【治疗术】，${target.t.name} 恢复 ${amount} 生命${revived ? `，复活 ${revived}` : ''}`, 'spell');
        done();
      });
    } else if (key === 'fireball') {
      const dmg = Math.round((40 + 15 * (lvl - 1)) * sorc);
      this.explodeEffect(target);
      Tweens.delay(0.2, () => {
        const victims = [target];
        for (const [c, r] of hexNeighbors(target.col, target.row)) {
          const v = this.stackAt(c, r);
          if (v) victims.push(v);
        }
        for (const v of victims) this.applyDamage(v, dmg);
        this.ui.battleLog(`英雄施放【烈火火球】，${victims.length} 支部队各受到 ${dmg} 伤害`, 'spell');
        done();
      });
    } else if (key === 'haste') {
      target.spdBonus += 3;
      target.slowRounds = 0;
      const w = this.hexWorld(target.col, target.row);
      this.particles.burst(w.x, 0.5, w.z, { color: 0x7db3ff, n: 12, speed: 1.2, up: 1.8, life: 0.6 });
      this.ui.floaterAt(target, '速度+3', 'buff');
      this.ui.battleLog(`英雄施放【攻击加速】，${target.t.name} 速度 +3`, 'spell');
      done();
    } else if (key === 'slow') {
      target.slowRounds = 3; // 持续 2 个敌方回合（含本回合）
      target.spdBonus = 0;
      this.beamEffect(target, 0x8a9fd8);
      const w = this.hexWorld(target.col, target.row);
      this.particles.burst(w.x, 0.6, w.z, { color: 0x8a9fd8, n: 12, speed: 0.8, up: 1.2, life: 0.8 });
      this.ui.floaterAt(target, '减速', 'buff');
      this.ui.battleLog(`英雄施放【减速】，${target.t.name} 速度减半`, 'spell');
      Tweens.delay(0.15, done);
    } else if (key === 'bless') {
      target.blessRounds = 4; // 持续 3 个己方回合（含本回合）
      this.beamEffect(target, 0xffd76b);
      const w = this.hexWorld(target.col, target.row);
      this.particles.burst(w.x, 0.7, w.z, { color: 0xffd76b, n: 16, speed: 1.0, up: 2.2, life: 0.8 });
      this.ui.floaterAt(target, '祝福', 'buff');
      this.ui.battleLog(`英雄施放【祝福】，${target.t.name} 将造成最大伤害`, 'spell');
      Tweens.delay(0.15, done);
    } else if (key === 'chain') {
      // 连环闪电：目标 + 最近的至多 2 个其他敌人
      const targets = [target];
      const others = this.aliveStacks(1).filter(s => s !== target)
        .sort((a, b) => hexDistance(target.col, target.row, a.col, a.row) - hexDistance(target.col, target.row, b.col, b.row));
      targets.push(...others.slice(0, 2));
      const dmgs = [60 + 10 * (lvl - 1), 45 + 7 * (lvl - 1), 30 + 5 * (lvl - 1)].map(d => Math.round(d * sorc));
      let i = 0;
      let prevPos = null;
      const strike = () => {
        if (i >= targets.length) { done(); return; }
        const t = targets[i];
        if (t.alive) {
          const w = this.hexWorld(t.col, t.row);
          const toPos = new THREE.Vector3(w.x, 0.7, w.z);
          // 从天而降 + 链到上一个目标
          this.lightning(new THREE.Vector3(w.x + rand(-0.8, 0.8), 8.5, w.z + rand(-0.8, 0.8)), toPos, 0xc8e8ff);
          if (prevPos) this.lightning(prevPos, toPos, 0x9fd8ff);
          prevPos = toPos;
          this.shake(0.14);
          const kills = this.applyDamage(t, dmgs[i]);
          this.ui.battleLog(`【连环闪电】第${i + 1}击命中 ${t.t.name}，${dmgs[i]} 伤害${kills ? `，击杀 ${kills}` : ''}`, 'spell');
        }
        i++;
        Tweens.delay(0.3, strike);
      };
      strike();
    }
  }

  // ---------- 撤退 ----------
  retreat() {
    if (this.busy || this.over || !this.active || this.active.side !== 0) return;
    this.over = true;
    this.clearHighlight();
    this.marker.visible = false;
    const surviving = [];
    for (const st of this.aliveStacks(0)) {
      st.count -= Math.floor(st.count * 0.25);
      if (st.count > 0) surviving.push({ type: st.type, count: st.count });
    }
    this.ui.battleLog('英雄下令撤退！损失 25% 兵力', 'round');
    sfx('lose');
    Tweens.delay(0.5, () => this.onEnd('retreat', surviving, this.kills));
  }

  // ---------- 伤害预估 ----------
  previewDamage(att, def) {
    const shoot = this.canShoot(att);
    const heroA = att.side === 0 ? this.hero.atk : this.enemyHero.atk;
    const heroD = def.side === 0 ? this.hero.def : this.enemyHero.def;
    const A = att.t.atk + heroA;
    let D = def.t.def + heroD;
    if (def.defending) D = Math.round(D * DIFF.defendBonus);
    // 与 calcDamage 保持同一套分阵营系数，否则预估与实伤会对不上
    const C = damageCoef(att.side);
    let mult = A >= D
      ? 1 + C.atkFactor * Math.min(A - D, C.atkCap)
      : Math.max(C.minMult, 1 - C.defFactor * Math.min(D - A, C.defCap));
    if (!shoot && att.t.shots) mult *= DIFF.shooterMeleeMult;
    if (att.side === 0 && !shoot) mult *= 1 + 0.1 * this.skill('offense');
    if (def.side === 0) mult *= 1 - 0.07 * this.skill('armorer');
    const baseMax = att.blessRounds > 0 ? Math.round(att.t.dmg[1] * DIFF.blessBonus) : att.t.dmg[1];
    const min = Math.max(1, Math.round(att.t.dmg[0] * att.count * mult));
    const max = Math.max(1, Math.round(baseMax * att.count * mult));
    const pool = (def.count - 1) * def.t.hp + def.topHP;
    const killsOf = dmg => {
      const rest = pool - dmg;
      return rest <= 0 ? def.count : def.count - Math.ceil(rest / def.t.hp);
    };
    return { min, max, killsMin: killsOf(min), killsMax: killsOf(max), shoot };
  }

  // ---------- AI ----------
  // ---------- AI 辅助：目标价值评估 ----------
  /** 一支部队的「威胁值」：输出能力 x 存活量。用来判断谁最该被优先干掉。 */
  threatOf(st) {
    const t = st.t;
    const dmg = (t.dmg[0] + t.dmg[1]) / 2 * st.count;
    const rangedBonus = t.shots && st.shotsLeft > 0 ? 1.35 : 1;   // 射手不用近身，威胁更持久
    const flyBonus = t.fly ? 1.15 : 1;                             // 飞行机动性强
    return dmg * rangedBonus * flyBonus;
  }

  /** 一支部队剩余总血量（用于判断能否一击打死）。 */
  poolOf(st) { return (st.count - 1) * st.t.hp + st.topHP; }

  /**
   * 攻击目标打分：预期伤害 + 击杀奖励 + 威胁权重 - 反击惩罚。
   * 这是 AI 从「打最近的」升级为「打最该打的」的核心。
   */
  scoreTarget(att, def, { shoot = false } = {}) {
    const p = this.previewDamage(att, def);
    const avg = (p.min + p.max) / 2;
    const pool = this.poolOf(def);
    let score = avg;
    // 能一击打死：巨大加成（少一支部队 = 永久少一份输出）
    if (avg >= pool) score += this.threatOf(def) * 2.2;
    else {
      // 打不死也按「削掉对方多少威胁」计价
      score += this.threatOf(def) * (avg / Math.max(pool, 1)) * 1.1;
      // 残血目标优先（补刀价值高）
      const hpRatio = pool / Math.max(this.poolOf({ ...def, count: def.maxCount, topHP: def.t.hp }), 1);
      if (hpRatio < 0.34) score *= 1.25;
    }
    // 近战会吃反击：按对方反打的期望伤害折价（已反击过的不算）
    if (!shoot && def.alive && !def.retaliated) {
      const back = this.previewDamage(def, att);
      score -= (back.min + back.max) / 2 * 0.6;
    }
    return score;
  }

  aiAct(st) {
    if (this.over || !st.alive) { this.endTurn(); return; }
    const targets = this.aliveStacks(0);
    if (!targets.length) { this.endTurn(); return; }

    // —— 远程：不再「射最近的」，改为射收益最高的（优先秒杀 / 优先干掉射手）——
    if (this.canShoot(st)) {
      let best = targets[0], bestScore = -Infinity;
      for (const t of targets) {
        const sc = this.scoreTarget(st, t, { shoot: true });
        if (sc > bestScore) { bestScore = sc; best = t; }
      }
      this.attack(st, best, { shoot: true });
      return;
    }

    // —— 近战且已贴身：在相邻目标里挑收益最高的（原来是取 adj[0]，等于随机）——
    const adj = this.adjacentEnemies(st);
    if (adj.length) {
      let best = adj[0], bestScore = -Infinity;
      for (const t of adj) {
        const sc = this.scoreTarget(st, t);
        if (sc > bestScore) { bestScore = sc; best = t; }
      }
      this.attack(st, best, {});
      return;
    }

    // —— 需要移动：评估「移动到某格 + 攻击某目标」的组合收益 ——
    const reach = this.computeReach(st);
    const spd = this.effSpd(st);
    let bestPlan = null, bestScore = -Infinity;
    for (const node of reach.values()) {
      if (node.noLand) continue;
      // 该格相邻有哪些敌人？
      let hitBest = null, hitScore = -Infinity;
      for (const [c, r] of hexNeighbors(node.c, node.r)) {
        const e = this.stackAt(c, r);
        if (!e || e.side !== 0) continue;
        const sc = this.scoreTarget(st, e);
        if (sc > hitScore) { hitScore = sc; hitBest = e; }
      }
      let score;
      if (hitBest) {
        // 本回合就能打到：收益 = 攻击得分，早到一步略微加分
        score = hitScore + (spd - node.d) * 0.5;
      } else {
        // 打不到：按「离最有价值目标更近」计分，负值确保永远劣于能打到的方案
        let nearest = Infinity, nearestT = null;
        for (const t of targets) {
          const d = hexDistance(node.c, node.r, t.col, t.row);
          const w = d - this.threatOf(t) / 400;     // 威胁高的目标更值得靠近
          if (w < nearest) { nearest = w; nearestT = t; }
        }
        score = -1000 - nearest * 10;
        // 射手被逼近战会被减半伤害，所以让己方射手尽量别主动贴脸（保持距离找机会）
        if (st.t.shots && st.shotsLeft > 0) score -= 300;
      }
      if (score > bestScore) { bestScore = score; bestPlan = { node, target: hitBest }; }
    }

    if (!bestPlan) { st.defending = true; this.endTurn(); return; }
    this.active = st;
    this.moveActive(bestPlan.node, () => {
      // 移动后重新确认目标仍可打（期间可能已阵亡）
      const adj2 = this.adjacentEnemies(st);
      if (!adj2.length) { this.endTurn(); return; }
      let best = adj2[0], sc0 = -Infinity;
      for (const t of adj2) {
        const sc = this.scoreTarget(st, t);
        if (sc > sc0) { sc0 = sc; best = t; }
      }
      this.attack(st, best, {});
    });
  }

  // ---------- 帧更新 ----------
  update(dt, camera) {
    dt *= this.timeScale;  // 结算慢镜头缩放（影响场景动画，不影响 Tweens 计时）
    this.time += dt;
    // 震屏衰减
    if (this.shakeAmt > 0.005) {
      this.root.position.set(
        (Math.random() - 0.5) * 2 * this.shakeAmt,
        (Math.random() - 0.5) * 1 * this.shakeAmt,
        (Math.random() - 0.5) * 2 * this.shakeAmt);
      this.shakeAmt *= Math.pow(0.02, dt); // 快速衰减
    } else if (this.shakeAmt !== 0) {
      this.shakeAmt = 0;
      this.root.position.set(0, 0, 0);
    }
    this.particles.update(dt);
    // 火盆火焰跳动
    if (this.fireBalls) {
      for (let i = 0; i < this.fireBalls.length; i++) {
        const f = this.fireBalls[i];
        const s = 1 + Math.sin(this.time * 9 + i * 1.7) * 0.18;
        f.scale.set(s, s * (1 + Math.sin(this.time * 13 + i) * 0.12), s);
      }
    }
    // 主动单位标记（结算动画期间隐藏）
    if (this.active && this.active.alive && !this.cinematic) {
      const st = this.active;
      this.marker.visible = true;
      this.marker.position.set(st.mesh.position.x, 1.7 + Math.sin(this.time * 4) * 0.12, st.mesh.position.z);
      this.marker.rotation.y += dt * 2;
    } else {
      this.marker.visible = false;
    }
    // 待机动画 + 标签位置
    for (const st of this.stacks) {
      if (!st.alive) continue;
      if (!this.busy) {
        st.mesh.position.y = UNIT_Y + Math.sin(this.time * 2.5 + st.id) * 0.02;
        // 单 mesh glb 模型待机：轻微呼吸式起伏
        if (st.mesh.userData.fromGltf) {
          const anim = st.mesh.userData.anim;
          if (!anim || !anim.legs) tiltNode(st.mesh).rotation.x = Math.sin(this.time * 1.5 + st.id) * 0.015;
        }
      }
      const anim = st.mesh.userData.anim;
      if (anim) {
        if (anim.wings) {
          const w = Math.sin(this.time * 6 + st.id) * 0.32;
          anim.wings[0].rotation.z = anim.wingBase + w;
          anim.wings[1].rotation.z = -anim.wingBase - w;
        }
        if (anim.ghostMats) {
          const op = 0.5 + Math.sin(this.time * 2.5 + st.id) * 0.14;
          for (const m of anim.ghostMats) m.opacity = op;
        }
        if (anim.cape) anim.cape.rotation.x = 0.22 + Math.sin(this.time * 2.2 + st.id) * 0.08;
      }
      this.ui.positionStackLabel(st, camera);
    }
  }

  dispose() {
    for (const st of this.stacks) this.ui.removeStackLabel(st);
    disposeObject3D(this.scene);
  }
}

// ================= 粒子系统（加法混合光点池） =================
class Particles {
  constructor(root) {
    this.N = 600;
    this.pos = new Float32Array(this.N * 3);
    this.col = new Float32Array(this.N * 3);
    this.vel = new Float32Array(this.N * 3);
    this.life = new Float32Array(this.N);
    this.pos.fill(-999);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
      size: 0.13, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    root.add(this.points);
    this.cursor = 0;
    this.tmp = new THREE.Color();
  }
  burst(x, y, z, { color = 0xffd76b, n = 12, speed = 1.6, up = 2.0, life = 0.6 } = {}) {
    this.tmp.set(color);
    for (let i = 0; i < n; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.N;
      this.pos[idx * 3] = x; this.pos[idx * 3 + 1] = y; this.pos[idx * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.vel[idx * 3] = Math.cos(a) * Math.cos(e) * sp;
      this.vel[idx * 3 + 1] = Math.abs(Math.sin(e)) * sp * 0.5 + up * (0.5 + Math.random() * 0.5);
      this.vel[idx * 3 + 2] = Math.sin(a) * Math.cos(e) * sp;
      this.life[idx] = life * (0.6 + Math.random() * 0.7);
      const vary = 0.7 + Math.random() * 0.5;
      this.col[idx * 3] = Math.min(1, this.tmp.r * vary);
      this.col[idx * 3 + 1] = Math.min(1, this.tmp.g * vary);
      this.col[idx * 3 + 2] = Math.min(1, this.tmp.b * vary);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 5.5 * dt; // 重力
    }
    if (any) this.geo.attributes.position.needsUpdate = true;
  }
}
