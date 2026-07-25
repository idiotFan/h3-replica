// ================= 主控制器 =================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MAP, UNITS, MINES, ARTIFACTS, SKILLS } from './config.js';
import { DIFF, setDifficulty, getDifficultyKey } from './difficulty.js';
import { Tweens, initAudio, sfx, clamp, setMuted, startBgm, stopBgm } from './utils.js';
import { WorldMap } from './map.js';
import { Battle } from './battle.js';
import { UI } from './ui.js';
import { Minimap } from './minimap.js';
import { preloadAllAssets, preloadGroup, getBootAssets, getBackgroundAssets } from './assets/loader.js';

// ---------- 冒烟测试参数（?smoke=map|battle） ----------
const SMOKE = new URLSearchParams(location.search).get('smoke');

// ---------- 设备与画质（须在渲染器之前） ----------
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (('ontouchstart' in window) && Math.min(window.innerWidth, window.innerHeight) < 820);
const savedQuality = localStorage.getItem('homm_quality');
const savedMute = localStorage.getItem('homm_mute');
setMuted(savedMute === '1');

// ---------- 渲染器 ----------
const container = document.getElementById('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (e) {
  document.body.innerHTML = '<div style="color:#fff;padding:40px;font-size:20px">当前环境不支持 WebGL，无法运行游戏。</div>';
  throw e;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

// ---------- 游戏状态 ----------
const state = {
  quality: savedQuality || (IS_MOBILE ? 'low' : 'high'),
  muted: savedMute === '1',
  mode: 'start', // start | map | battle
  day: 1,
  res: { gold: 3000, wood: 15, ore: 15 },
  mines: { sawmill: 0, ore: 0, gold: 0 },
  hero: {
    level: 1, xp: 0, atk: 1, def: 1, mp: 10, mpMax: 10,
    skills: {}, skillPoints: 0,
    army: [
      { type: 'pikeman', count: 25 },
      { type: 'archer', count: 12 },
      { type: 'griffin', count: 4 },
      { type: 'swordsman', count: 6 },
    ],
    // x, y, movePoints, moveMax 由 world.hero 持有，这里镜像
  },
  battlesWon: 0,
  totalKills: 0,
  barracksUpgraded: false,
  won: false,
  over: false,
};

// ---------- 场景 ----------
const mapScene = new THREE.Scene();
let battleScene = null;
let battle = null;

// ---------- PMREM 环境贴图（让金属/盔甲有真实反射，告别塑料感）----------
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
// 用程序化天空+半球光生成环境贴图，无需加载 HDR 文件
const _envScene = new THREE.Scene();
_envScene.background = new THREE.Color(0x87b5e0);
_envScene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3d5a3a, 1.0));
const envMap = pmrem.fromScene(_envScene, 0.04).texture;
pmrem.dispose();
mapScene.environment = envMap;

// ---------- 后期处理（Bloom：让发光眼/窗口/法术更亮更酷）----------
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(mapScene, camera);
composer.addPass(renderPass);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5,   // strength：发光强度
  0.4,   // radius：扩散半径
  0.85,  // threshold：只让亮度>0.85 的部分发光（emissive 元素）
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
let bloomEnabled = true; // 按画质动态开关

// ---------- 启动就绪门禁 ----------
// boot() 是异步的（预加载 glTF 后才建世界），但 loop() 会在首帧后立刻移除 #loading，
// 于是在 boot 完成前难度按钮就可点 → 世界被构建两次。这里在 boot 完成前禁用开始按钮，
// 并让 onStart / onContinueSave 显式 await bootPromise，双保险。
let bootDone = false;
let bootPromise = null;   // 在文件末尾赋值
let startPending = false; // 防止连点导致重复开局
function setStartButtonsEnabled(on) {
  const hint = on ? '' : '资源加载中，稍候…';
  document.querySelectorAll('button[data-diff]').forEach(b => { b.disabled = !on; b.title = hint; });
  const c = document.getElementById('btn-continue-save');
  if (c) { c.disabled = !on; c.title = hint; }
}
setStartButtonsEnabled(false);
async function beginGame(fn) {
  if (startPending || state.mode !== 'start') return;
  startPending = true;
  try {
    if (!bootDone && bootPromise) await bootPromise;
  } catch (e) { /* boot 失败也允许开局（会走原语回退） */ }
  try {
    if (state.mode !== 'start') return; // await 期间已经开局了
    fn();
  } finally { startPending = false; }
}

// ---------- UI ----------
const ui = new UI({
  onStart: (diff) => beginGame(() => { initAudio(); sfx('win'); setDifficulty(diff); startNewGame(); }),
  onContinueSave: () => beginGame(() => { initAudio(); continueGame(); }),
  onEndTurn: () => endTurn(),
  onWait: () => battle && battle.waitAction(),
  onDefend: () => battle && battle.defendAction(),
  onSpell: () => battle && battle.spellAction(),
  onRetreat: () => battle && ui.confirmRetreat(() => battle.retreat()),
  onSettings: () => openSettings(),
  onSelectSpell: key => battle && battle.selectSpell(key),
  onUndo: () => undoMove(),
  getCamera: () => camera,
});

// ---------- 拾取账本（供 undoMove 回滚 main.js 侧的资源 / 宝物属性） ----------
// map.js 的 undoMove 会对每一件本次移动中拾取的东西回调 events.onUndoPickup(kind, data)。
// 账本保证幂等：一次发放只能被回滚一次，重复调用（或对没发放过的东西调用）静默忽略。
const GRANT_LOG_MAX = 32;
const grantLog = []; // { kind, data }
function logGrant(kind, data) {
  grantLog.push({ kind, data });
  if (grantLog.length > GRANT_LOG_MAX) grantLog.splice(0, grantLog.length - GRANT_LOG_MAX);
}
function sameGrantData(kind, a, b) {
  if (a === b) return true;                       // map.js 直接回传 obj.data 引用时命中
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (kind === 'pickup') return a.res === b.res && a.amount === b.amount;
  if (kind === 'mine') return a.mine === b.mine;
  if (kind === 'artifact') return a.art === b.art;
  return false;
}
function takeGrant(kind, data) {
  // 两趟：先按对象引用精确匹配（map.js 复用原 data 对象，正常都命中），
  // 再退化到按字段匹配（存档往返 / 深拷贝场景）。都从最新一条往回找。
  for (let pass = 0; pass < 2; pass++) {
    for (let i = grantLog.length - 1; i >= 0; i--) {
      const g = grantLog[i];
      if (g.kind !== kind) continue;
      const hit = pass === 0 ? g.data === data : sameGrantData(kind, g.data, data);
      if (!hit) continue;
      grantLog.splice(i, 1);
      return g.data;   // 以发放时记录的 data 为准，避免调用方传残缺对象
    }
  }
  return null;
}
function clearGrantLog() { grantLog.length = 0; }

// 回滚一件宝物的属性加成（导出给 map.js / 调试用；幂等由 takeGrant 保证）
function revertArtifact(art) {
  const h = state.hero;
  if (art === 'sword') h.atk = Math.max(1, h.atk - 1);
  else if (art === 'shield') h.def = Math.max(1, h.def - 1);
  else if (art === 'boots') {
    world.hero.moveMax = Math.max(1, world.hero.moveMax - 3);
    // 不直接减 movePoints：undoMove 已从快照恢复它，这里只做上限收敛
    world.hero.movePoints = Math.min(world.hero.movePoints, world.hero.moveMax);
  } else if (art === 'book') {
    h.mpMax = Math.max(1, h.mpMax - 4);
    h.mp = Math.min(h.mp, h.mpMax);
  }
}

// ---------- 地图事件 ----------
const world = new WorldMap(mapScene, {
  toast: (m, c) => ui.toast(m, c),
  // undoMove 回滚钩子：kind ∈ 'pickup' | 'mine' | 'artifact'，data 为对应 obj.data
  onUndoPickup(kind, data) {
    const d = takeGrant(kind, data);
    if (!d) return false; // 没发放过 / 已回滚过 —— 幂等空转
    if (kind === 'pickup') {
      const amt = Number(d.amount) || 0;
      if (d.res === 'gold' || d.res === 'chest') state.res.gold = Math.max(0, state.res.gold - amt);
      else if (d.res === 'wood') state.res.wood = Math.max(0, state.res.wood - amt);
      else state.res.ore = Math.max(0, state.res.ore - amt);
    } else if (kind === 'mine') {
      if (state.mines[d.mine] > 0) state.mines[d.mine]--;
    } else if (kind === 'artifact') {
      revertArtifact(d.art);
    }
    refreshUI();
    return true;
  },
  onPickup(obj) {
    const d = obj.data;
    if (d.res === 'gold' || d.res === 'chest') { state.res.gold += d.amount; ui.toast(`获得金币 +${d.amount}`, 'good'); }
    else if (d.res === 'wood') { state.res.wood += d.amount; ui.toast(`获得木材 +${d.amount}`, 'good'); }
    else { state.res.ore += d.amount; ui.toast(`获得矿石 +${d.amount}`, 'good'); }
    logGrant('pickup', d);
    sfx('pickup');
    refreshUI();
  },
  onMine(obj) {
    const m = MINES[obj.data.mine];
    state.mines[obj.data.mine]++;
    logGrant('mine', obj.data);
    const inc = Object.entries(m.income).map(([k, v]) => `${{ gold: '金币', wood: '木材', ore: '矿石' }[k]}+${v}/天`).join(' ');
    ui.toast(`占领了${m.name}（${inc}）`, 'good');
    sfx('pickup');
  },
  onCastle() {
    sfx('click');
    ui.openCastle(state, refreshUI);
    if (guideFlag('castle')) ui.guide('招募部队扩充军力 · 金币不足时可结束回合积累收入 · 兵营可升级招募精锐');
  },
  onArtifact(obj) {
    const a = ARTIFACTS[obj.data.art];
    const h = state.hero;
    if (obj.data.art === 'sword') h.atk++;
    else if (obj.data.art === 'shield') h.def++;
    else if (obj.data.art === 'boots') { world.hero.moveMax += 3; world.hero.movePoints += 3; }
    else if (obj.data.art === 'book') { h.mpMax += 4; h.mp += 4; }
    logGrant('artifact', obj.data);
    ui.toast(`拾取宝物【${a.name}】：${a.desc}`, 'good');
    sfx('level');
    refreshUI();
  },
  onEncounter(obj) {
    startBattle(obj);
  },
  onArrive() { refreshUI(); if (world._undoState) ui.setUndoAvailable(true); },
});
// 英雄移动力镜像到 state.hero 方便 UI
Object.defineProperty(state.hero, 'movePoints', { get: () => world.hero.movePoints });
Object.defineProperty(state.hero, 'moveMax', { get: () => world.hero.moveMax });

// ---------- 存档 ----------
const SAVE_KEY = 'homm3d_save';
function readSave() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}
function saveGame() {
  if (state.mode !== 'map' || state.over) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1,
      diff: getDifficultyKey(),
      world: world.serialize(),
      state: {
        day: state.day, res: state.res, mines: state.mines,
        hero: { level: state.hero.level, xp: state.hero.xp, atk: state.hero.atk, def: state.hero.def,
                mp: state.hero.mp, mpMax: state.hero.mpMax, army: state.hero.army,
                skills: state.hero.skills, skillPoints: state.hero.skillPoints },
        battlesWon: state.battlesWon, totalKills: state.totalKills,
        barracksUpgraded: state.barracksUpgraded, won: state.won,
      },
    }));
  } catch (e) { /* 存储不可用时忽略 */ }
}
// 存档结构校验：返回 null 表示合法，否则返回中文原因（用于 toast）
// 只放行真正能被 applySavedState + world.build 消费的结构，避免导入畸形数据后
// 静默启动失败并顺带把原存档冲掉。
function validateSave(data) {
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(data)) return '顶层不是存档对象';
  const st = data.state, w = data.world;
  if (!isObj(st)) return '缺少 state 字段';
  if (!isObj(w)) return '缺少 world 字段';
  // --- state ---
  if (!Number.isFinite(st.day) || st.day < 1) return 'state.day 非法';
  if (!isObj(st.res) || ['gold', 'wood', 'ore'].some(k => !Number.isFinite(st.res[k]))) return 'state.res 非法';
  if (!isObj(st.mines) || ['sawmill', 'ore', 'gold'].some(k => !Number.isFinite(st.mines[k]))) return 'state.mines 非法';
  if (!isObj(st.hero)) return '缺少 state.hero';
  const h = st.hero;
  if (['level', 'xp', 'atk', 'def', 'mp', 'mpMax'].some(k => !Number.isFinite(h[k]))) return 'state.hero 属性非法';
  if (!Array.isArray(h.army)) return 'state.hero.army 不是数组';
  if (h.army.some(a => !isObj(a) || typeof a.type !== 'string' || !UNITS[a.type] || !Number.isFinite(a.count)))
    return 'state.hero.army 含非法部队';
  // --- world ---
  if (!Array.isArray(w.types) || w.types.length !== MAP.H) return `world.types 必须是 ${MAP.H} 行`;
  if (w.types.some(r => typeof r !== 'string' || r.length !== MAP.W)) return `world.types 每行须为 ${MAP.W} 字符`;
  if (!Array.isArray(w.objects)) return 'world.objects 不是数组';
  if (w.objects.some(o => !isObj(o) || typeof o.kind !== 'string' ||
      !Number.isFinite(o.x) || !Number.isFinite(o.y) || !isObj(o.data)))
    return 'world.objects 含非法对象';
  if (!isObj(w.hero) || !Number.isFinite(w.hero.x) || !Number.isFinite(w.hero.y) ||
      !Number.isFinite(w.hero.movePoints) || !Number.isFinite(w.hero.moveMax))
    return 'world.hero 非法';
  if (w.hero.x < 0 || w.hero.x >= MAP.W || w.hero.y < 0 || w.hero.y >= MAP.H) return 'world.hero 坐标越界';
  for (const k of ['startPos', 'castlePos', 'bossPos']) {
    if (!isObj(w[k]) || !Number.isFinite(w[k].x) || !Number.isFinite(w[k].y)) return `world.${k} 非法`;
  }
  if (w.paths != null && !Array.isArray(w.paths)) return 'world.paths 非法';
  if (w.bookmarks != null && !Array.isArray(w.bookmarks)) return 'world.bookmarks 非法';
  if (w.explored != null && (!Array.isArray(w.explored) || w.explored.length !== MAP.W)) return 'world.explored 非法';
  return null;
}

function applySavedState(s) {
  if (s.diff) setDifficulty(s.diff);
  state.day = s.day; state.res = s.res; state.mines = s.mines;
  Object.assign(state.hero, s.hero);
  state.hero.skills = s.hero.skills || {};
  state.hero.skillPoints = s.hero.skillPoints || 0;
  state.battlesWon = s.battlesWon || 0; state.won = s.won;
  state.totalKills = s.totalKills || 0;
  state.barracksUpgraded = !!s.barracksUpgraded;
}
window.addEventListener('beforeunload', () => saveGame());

// ---------- 相机模式 ----------
function setCameraMap(snap = false) {
  controls.minDistance = 8; controls.maxDistance = 45;
  controls.minPolarAngle = 0.3; controls.maxPolarAngle = 1.25;
  const hp = world.heroMesh.position;
  if (snap) {
    controls.target.copy(hp);
    camera.position.set(hp.x, hp.y + 17, hp.z + 13);
  }
}
function setCameraBattle() {
  controls.minDistance = 9; controls.maxDistance = 32;
  controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.2;
  controls.target.set(0, 0, 0.5);
  camera.position.set(0, 16, 13.5);
}

// ---------- 游戏流程 ----------
let minimap = null;
let cameraFree = false;
const camFreeGoal = new THREE.Vector3();
const _camBefore = new THREE.Vector3();
const _camDelta = new THREE.Vector3();
const keys = {};
const _panDir = new THREE.Vector3();
const _panDelta = new THREE.Vector3();

function resetState() {
  state.day = 1;
  state.res = { ...DIFF.startRes };
  state.mines = { sawmill: 0, ore: 0, gold: 0 };
  state.hero.level = 1; state.hero.xp = 0;
  state.hero.atk = DIFF.heroStart.atk; state.hero.def = DIFF.heroStart.def;
  state.hero.mp = DIFF.heroStart.mp; state.hero.mpMax = DIFF.heroStart.mpMax;
  state.hero.skills = {}; state.hero.skillPoints = 0;
  state.hero.army = [
    { type: 'pikeman', count: 25 }, { type: 'archer', count: 12 },
    { type: 'griffin', count: 4 }, { type: 'swordsman', count: 6 },
  ];
  state.battlesWon = 0; state.totalKills = 0; state.barracksUpgraded = false;
  state.won = false; state.over = false;
  clearGrantLog();
}

function enterMap() {
  document.getElementById('minimap').innerHTML = '';
  minimap = new Minimap(world, document.getElementById('minimap'), (tx, ty) => {
    // 点击小地图：移动视角（自由观察），点击大地图后恢复跟随
    const w = world.tileWorld(tx, ty);
    camFreeGoal.set(w.x, 0, w.z);
    cameraFree = true;
  }, () => world.worldToTile(controls.target.x, controls.target.z));
  ui.hideStart();
  state.mode = 'map';
  ui.setMode('map');
  controls.enabled = true;
  setCameraMap(true);
  refreshUI();
  // 确保画布可聚焦，WASD 才能稳定收到按键
  renderer.domElement.tabIndex = 0;
  renderer.domElement.style.outline = 'none';
  renderer.domElement.focus({ preventScroll: true });
  startBgm();
  guideStep();
}

// 新手引导：按里程碑推进（localStorage 记录进度，仅首次出现）
const GUIDE_KEY = 'homm3d_guide';
function guideFlag(step) {
  const done = JSON.parse(localStorage.getItem(GUIDE_KEY) || '{}');
  if (done[step]) return false;
  done[step] = true;
  localStorage.setItem(GUIDE_KEY, JSON.stringify(done));
  return true;
}
function guideStep() {
  if (guideFlag('enter')) ui.guide('点击地块移动英雄 · 滚轮缩放 · 右键拖拽旋转视角');
}

function startNewGame() {
  // 始终重建世界：setDifficulty 已在 onStart 回调中先于本函数调用，
  // 重建确保新世界正确烘焙当前难度（野怪初始兵力/移动力/收入等）。
  // boot() 里的预构建用的是默认 normal 难度，必须在此覆盖。
  world.dispose();
  resetState();
  world.build(null);
  world.fromSave = false;
  enterMap();
  ui.toast('点击地块移动，探索地图吧', 'good');
}
function continueGame() {
  enterMap();
  ui.toast('存档已读取，继续你的征程', 'good');
}

function endTurn() {
  if (state.mode !== 'map' || world.moving || world.enemyTurn || state.over) return;
  state.day++;
  world.day = state.day;
  world.hero.movePoints = world.hero.moveMax;
  // 结束回合后清除撤销状态
  world._undoState = null;
  clearGrantLog();
  ui.setUndoAvailable(false);
  // 收入
  let gold = DIFF.castleIncome + state.mines.gold * MINES.gold.income.gold + (state.hero.skills.estates || 0) * 250;
  let wood = state.mines.sawmill * MINES.sawmill.income.wood;
  let ore = state.mines.ore * MINES.ore.income.ore;
  state.res.gold += gold; state.res.wood += wood; state.res.ore += ore;
  state.hero.mp = state.hero.mpMax;
  sfx('click');
  ui.toast(`第 ${state.day} 天：金币+${gold} 木材+${wood} 矿石+${ore}`, 'good');
  refreshUI();
  // 野怪每 3 天增长兵力（线性增量，有上限，系数受难度控制）
  if (state.day % 3 === 0) {
    world.growMonsters();
    ui.toast('野外的怪物势力壮大了…', 'warn');
  }
  // 敌方城堡增援
  maybeSpawnEnemy();
  // 敌方行动阶段
  world.battlePending = null;
  if (world.enemyHeroes.length) {
    world.runEnemyTurn().then(() => {
      world.updateFog(); // 敌方移动后刷新迷雾（敌方英雄进入视野时显示）
      refreshUI();
      if (world.battlePending) {
        const eh = world.battlePending;
        world.battlePending = null;
        ui.toast(`${eh.data.name} 向你发起了进攻！`, 'warn');
        startBattle(eh);
      } else saveGame();
    });
  } else saveGame();
}

// 撤销上一次移动
function undoMove() {
  if (state.mode !== 'map' || world.moving) return;
  const ok = world.undoMove();
  if (ok) {
    // map.js 已通过 onUndoPickup 回滚本次移动的资源 / 宝物；清空账本，避免跨次误回滚
    clearGrantLog();
    sfx('click');
    refreshUI();
    ui.toast('已撤销移动', 'good');
    ui.setUndoAvailable(false);
  }
}

// ---------- 设置（静音 / 画质） ----------
function applyQuality() {
  const q = state.quality;
  const low = q === 'low';
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
  renderer.shadowMap.enabled = !low;
  // 阴影贴图按画质分级：low 关闭 / medium 1024 / high 2048
  const shadowSize = low ? 0 : (q === 'medium' ? 1024 : 2048);
  // Bloom 后期处理：low 关闭省 GPU / medium+ 开启
  bloomEnabled = !low;
  for (const sc of [mapScene, battleScene]) {
    if (!sc) continue;
    sc.traverse(o => {
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      if (o.isDirectionalLight) {
        o.castShadow = !low;
        if (!low && o.shadow && o.shadow.mapSize) {
          const need = o.shadow.mapSize.width !== shadowSize;
          if (need) {
            o.shadow.mapSize.set(shadowSize, shadowSize);
            o.shadow.map?.dispose();
            o.shadow.map = null;
          }
        }
      }
    });
  }
}
function openSettings() {
  ui.openSettings({
    muted: state.muted,
    quality: state.quality,
    onMute: m => {
      state.muted = m;
      setMuted(m);
      localStorage.setItem('homm_mute', m ? '1' : '0');
      if (m) stopBgm(); else if (state.mode === 'map') startBgm();
    },
    onQuality: q => {
      state.quality = q;
      localStorage.setItem('homm_quality', q);
      applyQuality();
    },
    onExport: () => {
      // 导出前先落盘当前进度，避免导出的是上一次自动存档的旧快照
      saveGame();
      const s = localStorage.getItem(SAVE_KEY);
      return s || null;
    },
    onImport: (text) => {
      // 导入存档：结构校验通过才写入 localStorage，刷新生效
      let data;
      try { data = JSON.parse(text); } catch (e) {
        ui.toast('导入失败：不是合法的 JSON 存档', 'warn');
        return false;
      }
      const bad = validateSave(data);
      if (bad) {
        ui.toast(`导入失败：${bad}`, 'warn');
        return false;
      }
      localStorage.setItem(SAVE_KEY, text);
      return true;
    },
  });
}

function maybeSpawnEnemy() {
  const castle = [...world.objects.values()].find(o => o.kind === 'enemyCastle');
  if (!castle || state.day % DIFF.enemyReinforceInterval !== 0 || world.enemyHeroes.length >= DIFF.enemyMaxHeroes) return;
  // 在城堡附近找空地
  for (let i = 0; i < 20; i++) {
    const x = castle.x + Math.floor(Math.random() * 5) - 2;
    const y = castle.y + Math.floor(Math.random() * 5) - 2;
    if (world.inBounds(x, y) && (world.type[x][y] === 'grass' || world.type[x][y] === 'forest') &&
        !world.objects.has(x + ',' + y) && !(x === world.hero.x && y === world.hero.y)) {
      const eh = world.spawnEnemyHero(x, y);
      ui.toast(`敌方城堡派出了【${eh.data.name}】！`, 'warn');
      sfx('lose');
      return;
    }
  }
}

function startBattle(encounterObj) {
  state.mode = 'battle';
  world.pending = null;
  // 进入战斗后清除撤销状态（战斗会改变世界状态，不允许撤销）
  world._undoState = null;
  clearGrantLog();
  ui.setUndoAvailable(false);
  battleScene = new THREE.Scene();
  battleScene.environment = envMap; // 战场也用环境贴图，金属反射一致
  const enemyArmy = encounterObj.data.stacks.map(s => ({ ...s }));
  // 敌方英雄/城堡给予敌军属性加成
  let enemyHero = { atk: 0, def: 0 };
  if (encounterObj.kind === 'enemyHero')
    enemyHero = { atk: 1 + Math.floor(state.day / DIFF.enemyHeroAtkRate), def: 1 + Math.floor(state.day / DIFF.enemyHeroDefRate) };
  else if (encounterObj.kind === 'enemyCastle')
    enemyHero = { atk: 3, def: 3 };
  ui.setMode('battle');
  setCameraBattle();
  sfx('hit');
  // 按所在地形选择战场主题
  const tileT = world.type[world.hero.x][world.hero.y];
  const theme = tileT === 'forest' ? 'forest' : (Math.random() < 0.2 ? 'waste' : 'grass');
  battle = new Battle({
    scene: battleScene,
    playerArmy: state.hero.army.map(a => ({ ...a })),
    enemyArmy,
    hero: state.hero,
    enemyHero,
    theme,
    shadows: state.quality !== 'low',
    ui,
    onEnd: (win, surviving, kills) => onBattleEnd(win, surviving, encounterObj, kills || 0),
  });
  const title = encounterObj.kind === 'enemyHero' ? `${encounterObj.data.name} 杀到阵前！` :
    encounterObj.kind === 'enemyCastle' ? '攻打敌方城堡！' : '遭遇敌人，战斗开始！';
  ui.toast(title, 'warn');
}

// 升级后弹出技能选择（可连续多点）
function offerSkillChoices() {
  const h = state.hero;
  if (h.skillPoints <= 0) return;
  ui.openSkillChoice(h, key => {
    if (key) {
      h.skills[key] = (h.skills[key] || 0) + 1;
      h.skillPoints--;
      // 立即生效类技能
      if (key === 'logistics') { world.hero.moveMax += 2; world.hero.movePoints += 2; }
      if (key === 'wisdom') { h.mpMax += 4; h.mp += 4; }
      ui.toast(`习得【${SKILLS[key].name}】${h.skills[key]} 级`, 'good');
      sfx('level');
      refreshUI();
      saveGame();
      offerSkillChoices(); // 还有技能点继续选
    }
  });
}

function onBattleEnd(result, surviving, encounterObj, kills) {
  const h = state.hero;
  h.mp = battle.heroMp;
  state.totalKills += kills;
  battle.dispose();
  battle = null;

  // 撤退：损失 25% 兵力逃回地图
  if (result === 'retreat') {
    if (!surviving.length) { // 无处可逃
      state.over = true;
      ui.setMode('map');
      ui.showEnd(false, `撤退失败，军队全军覆没…<br>坚持 ${state.day} 天 · 获胜 ${state.battlesWon} 场 · 英雄 Lv.${h.level}`,
        () => location.reload(), null);
      return;
    }
    h.army = surviving;
    h.mp = 0; // 撤退惩罚：魔法值清零，当日无法再施法
    state.mode = 'map';
    ui.setMode('map');
    setCameraMap();
    refreshUI();
    saveGame();
    ui.toast('撤退成功，损失 25% 兵力，魔法值耗尽', 'warn');
    return;
  }

  const win = result === true;
  if (win) {
    state.battlesWon++;
    h.army = surviving;
    const reward = encounterObj.data.reward || 0;
    state.res.gold += reward;
    // 经验
    const xpGain = Math.round(encounterObj.data.stacks.reduce((s, st) => s + UNITS[st.type].hp * st.count, 0) / 8);
    h.xp += xpGain;
    let levelText = '';
    while (h.xp >= h.level * DIFF.xpThreshold) {
      h.xp -= h.level * DIFF.xpThreshold;
      h.level++;
      if (h.level % 2) h.atk++; else h.def++;
      h.mpMax += 2; h.mp = h.mpMax;
      h.skillPoints++;
      levelText = ` · 升到 Lv.${h.level}，获得技能点！`;
    }
    // 胜利音效已在战斗结算动画（Battle.playEndCinematic）中播放，此处不再重复
    world.removeObject(encounterObj);
    // 警戒圈拦截战获胜后，拾取英雄脚下被守护的资源/宝物/矿场
    world.collectAt(world.hero.x, world.hero.y);
    if (encounterObj.kind === 'enemyHero')
      ui.toast(`击退了${encounterObj.data.name}！`, 'good');
    else if (encounterObj.kind === 'enemyCastle')
      ui.toast('摧毁了敌方城堡！敌军不会再增援了。', 'good');
    saveGame();
    if (encounterObj.data.boss) {
      state.won = true;
      state.mode = 'map';
      ui.setMode('map');
      setCameraMap();
      refreshUI();
      const armyLeft = h.army.reduce((s, a) => s + a.count, 0);
      const skillText = Object.entries(h.skills).filter(([, v]) => v > 0)
        .map(([k, v]) => `${SKILLS[k].name}${v}`).join(' · ') || '无';
      saveRecord('win');
      const best = bestRecord();
      const bestText = best ? `<br><span class="cg-best">最佳：${best.day} 天通关（${{ easy: '简单', normal: '普通', hard: '困难' }[best.diff]}）</span>` : '';
      ui.showVictoryCG(
        `用时 <b>${state.day}</b> 天 · 获胜 <b>${state.battlesWon}</b> 场 · 累计击杀 <b>${state.totalKills}</b><br>` +
        `英雄 Lv.${h.level}（攻${h.atk} 防${h.def}） · 剩余兵力 ${armyLeft}<br>` +
        `<span class="cg-skills">${skillText}</span>${bestText}`,
        () => location.reload(),
        () => { refreshUI(); offerSkillChoices(); });
      return;
    }
    ui.toast(`战斗胜利！金币+${reward} 经验+${xpGain}${levelText}`, 'good');
    if (guideFlag('firstWin')) ui.guide('回城堡可招募部队 · 占领矿场增加每日收入 · 探索东北角寻找黑龙巢穴');
    state.mode = 'map';
    ui.setMode('map');
    setCameraMap();
    refreshUI();
    offerSkillChoices();
  } else {
    state.over = true;
    // 失败音效已在战斗结算动画（Battle.playEndCinematic）中播放，此处不再重复
    saveRecord('lose');
    state.mode = 'map';
    ui.setMode('map');
    setCameraMap();
    ui.showEnd(false,
      `你的军队全军覆没…<br>坚持 ${state.day} 天 · 获胜 ${state.battlesWon} 场 · 累计击杀 ${state.totalKills} · 英雄 Lv.${h.level}`,
      () => location.reload(), null);
  }
}

// ---------- 战绩存档 ----------
const RECORD_KEY = 'homm3d_records';
function loadRecords() { try { return JSON.parse(localStorage.getItem(RECORD_KEY) || '[]'); } catch (e) { return []; } }
function saveRecord(result) {
  // 「最近 10 局」：新记录插到最前，超出裁掉最旧的。
  // （旧实现按 胜利优先+天数升序 排序后 slice(0,10)，攒够 10 胜后新记录会被直接丢弃。）
  const recs = loadRecords();
  recs.unshift({
    result, diff: getDifficultyKey(), day: state.day, battlesWon: state.battlesWon,
    kills: state.totalKills, level: state.hero.level, atk: state.hero.atk, def: state.hero.def,
    date: new Date().toLocaleDateString('zh-CN'),
    ts: Date.now(),
  });
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(recs.slice(0, 10))); } catch (e) { /* 存储不可用时忽略 */ }
}
// 最近 10 局里通关天数最少的一局（列表不再预排序，这里显式求最优）
function bestRecord() {
  return loadRecords()
    .filter(r => r && r.result === 'win' && Number.isFinite(r.day))
    .sort((a, b) => a.day - b.day)[0] || null;
}

function refreshUI() {
  ui.updateTopbar(state);
  ui.updateHeroBar(state.hero);
}

// ---------- 输入 ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
let lastMoveTs = 0;
let longPressTimer = null;   // 长按书签定时器
let longPressFired = false;  // 长按是否已触发（避免 pointerup 再执行点击移动）
let activePointerId = null;  // 只跟踪主指针，第二根手指（捏合/旋转）不参与点击/长按判定

function setPointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

// three r160 的 Raycaster 不检查 object.visible，雾下对象照样能被命中。
// 所有对地图对象的射线检测都必须先按可见性过滤。
function visibleObjMeshes() {
  return [...world.objects.values()].map(o => o.mesh).filter(m => m && m.visible);
}

// 取消当前指针交互（多指、pointercancel、失焦时调用）
function cancelPointerTracking() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  longPressFired = false;
  downPos = null;
  activePointerId = null;
}

renderer.domElement.addEventListener('pointerdown', e => {
  // 关键：无条件先清掉上一个未完成的长按定时器，否则多指按下会泄漏定时器，
  // 捏合缩放时凭空生成书签。
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  // 第二根手指按下：进入多指手势，整段交互都不算点击
  if (activePointerId !== null && activePointerId !== e.pointerId) {
    downPos = null;
    longPressFired = false;
    return;
  }
  if (e.isPrimary === false) { downPos = null; return; }
  activePointerId = e.pointerId;
  downPos = { x: e.clientX, y: e.clientY, b: e.button };
  if (e.button === 2 && state.mode === 'map') cameraFree = true; // 右键拖拽进入自由观察
  // 点击画布抢回焦点，保证 WASD 可用
  if (document.activeElement !== renderer.domElement) {
    renderer.domElement.focus({ preventScroll: true });
  }
  // 长按地块标记/取消书签（仅大地图左键）
  if (e.button === 0 && state.mode === 'map' && world && world.built) {
    longPressFired = false;
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    let tile = null;
    const objMeshes = visibleObjMeshes();
    let hits = raycaster.intersectObjects(objMeshes, true);
    if (hits.length) {
      let g = hits[0].object;
      while (g && !g.userData.tile) g = g.parent;
      if (g) tile = g.userData.tile;
    }
    if (!tile) {
      hits = raycaster.intersectObject(world.terrain);
      if (hits.length) tile = world.worldToTile(hits[0].point.x, hits[0].point.z);
    }
    if (tile) {
      const bt = tile;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (world && world.built && !world.moving && !world.enemyTurn && !state.over) {
          longPressFired = true;
          world.toggleBookmark(bt.x, bt.y);
        }
      }, 500);
    }
  }
});
renderer.domElement.addEventListener('pointerup', e => {
  // 非主指针抬起（捏合的第二根手指）：只清理定时器，不改 longPressFired、不判定点击。
  // 旧实现在这里把 longPressFired 清成 false，导致主指针那次抬手被误判为普通点击。
  if (activePointerId !== null && e.pointerId !== activePointerId) {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    return;
  }
  activePointerId = null;
  // 取消长按定时器；若长按已触发书签则跳过点击移动
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  const wasLongPress = longPressFired;
  longPressFired = false;
  if (wasLongPress) { downPos = null; return; }
  if (!downPos || downPos.b !== 0) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > (IS_MOBILE ? 14 : 6)) return; // 拖拽视角不算点击
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  if (state.mode === 'map' && !world.moving && !world.enemyTurn && !state.over) {
    cameraFree = false; // 点击大地图恢复跟随英雄
    // 先测对象（过滤雾下不可见对象），再测地形
    const objMeshes = visibleObjMeshes();
    let hits = raycaster.intersectObjects(objMeshes, true);
    if (hits.length) {
      let g = hits[0].object;
      while (g && !g.userData.tile) g = g.parent;
      if (g) { world.clickTile(g.userData.tile.x, g.userData.tile.y); return; }
    }
    hits = raycaster.intersectObject(world.terrain);
    if (hits.length) {
      const t = world.worldToTile(hits[0].point.x, hits[0].point.z);
      world.clickTile(t.x, t.y);
    }
  } else if (state.mode === 'battle' && battle) {
    // 先测单位，再测格子
    const unitMeshes = battle.stacks.filter(s => s.alive).map(s => s.mesh);
    let hits = raycaster.intersectObjects(unitMeshes, true);
    if (hits.length) {
      let g = hits[0].object;
      while (g && !g.userData.stack) g = g.parent;
      if (g) { battle.onStackClick(g.userData.stack); return; }
    }
    hits = raycaster.intersectObject(battle.hexInst);
    if (hits.length && hits[0].instanceId !== undefined) {
      const id = hits[0].instanceId;
      const col = Math.floor(id / battle.hexBC), row = id % battle.hexBC;
      // 点到单位所在格 = 点到该单位（放宽点选判定，不必精确命中模型）
      const occ = battle.stackAt(col, row);
      if (occ) { battle.onStackClick(occ); return; }
      battle.onHexClick(col, row);
    }
  }
});

renderer.domElement.addEventListener('pointermove', e => {
  // 长按过程中移动超过 5px 则取消书签触发
  if (longPressTimer && downPos) {
    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }
  setPointer(e);
  const now = performance.now();
  if (now - lastMoveTs < 55) return; // 节流 ~18Hz，减少移动端开销
  lastMoveTs = now;
  if (state.mode === 'map' && !world.moving) {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(world.terrain);
    if (hits.length) {
      const t = world.worldToTile(hits[0].point.x, hits[0].point.z);
      const obj = world.hoverTile(t.x, t.y);
      renderer.domElement.style.cursor = obj ? 'pointer' : 'default';
    } else {
      world.hoverRing.visible = false;
      world.hidePath();
    }
  } else if (state.mode === 'battle' && battle) {
    // 伤害预估提示（与点选同口径：命中模型或其所在格都算）
    const st = battle.active;
    let shown = false;
    if (st && st.side === 0 && !battle.busy && !battle.activeSpell) {
      raycaster.setFromCamera(pointer, camera);
      let target = null;
      const unitMeshes = battle.stacks.filter(s => s.alive && s.side === 1).map(s => s.mesh);
      const hits = raycaster.intersectObjects(unitMeshes, true);
      if (hits.length) {
        let g = hits[0].object;
        while (g && !g.userData.stack) g = g.parent;
        target = (g && g.userData.stack) || null;
      } else {
        const hHits = raycaster.intersectObject(battle.hexInst);
        if (hHits.length && hHits[0].instanceId !== undefined) {
          const id = hHits[0].instanceId;
          const occ = battle.stackAt(Math.floor(id / battle.hexBC), id % battle.hexBC);
          if (occ && occ.side === 1) target = occ;
        }
      }
      if (target && battle.attackable.has(target.id)) {
        const p = battle.previewDamage(st, target);
        ui.showTooltip(e.clientX, e.clientY,
          `<b>${p.shoot ? '射击' : '攻击'} ${target.t.name}</b><br>伤害 ${p.min} ~ ${p.max}<br>击杀 ${p.killsMin} ~ ${p.killsMax}`);
        shown = true;
      }
    }
    renderer.domElement.style.cursor = battle.activeSpell ? 'crosshair' : (shown ? 'pointer' : 'default');
    if (!shown) ui.hideTooltip();
  }
});

// 指针被系统取消（多指手势接管、滚动接管、触摸中断）：必须清定时器，
// 否则 500ms 后会在一个用户早已放弃的地块上凭空标出书签。
// 注意：不监听 lostpointercapture —— OrbitControls 每次正常抬手都会释放指针捕获，
// 那会在我们的 pointerup 之前把 downPos 清掉，导致所有点击失效。
renderer.domElement.addEventListener('pointercancel', cancelPointerTracking);

renderer.domElement.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (battle && battle.activeSpell) battle.cancelSpell();
});

function mapKey(e) {
  const c = e.code, k = (e.key || '').toLowerCase();
  if (c === 'KeyW' || c === 'ArrowUp' || k === 'w') return 'KeyW';
  if (c === 'KeyA' || c === 'ArrowLeft' || k === 'a') return 'KeyA';
  if (c === 'KeyS' || c === 'ArrowDown' || k === 's') return 'KeyS';
  if (c === 'KeyD' || c === 'ArrowRight' || k === 'd') return 'KeyD';
  return null;
}
// capture 阶段监听，避免被其它元素抢走
document.addEventListener('keydown', e => {
  if (e.repeat) {
    // 允许长按持续平移，但空格/战斗键不重复触发
    if (state.mode === 'map' && mapKey(e)) { e.preventDefault(); return; }
  }
  if (e.code === 'Space' && state.mode === 'map') { e.preventDefault(); endTurn(); return; }
  if (state.mode === 'map') {
    const mk = mapKey(e);
    if (mk) {
      e.preventDefault();
      keys[mk] = true;
      cameraFree = true;
    }
    return;
  }
  if (state.mode === 'battle' && battle) {
    if (e.code === 'KeyW') battle.waitAction();
    if (e.code === 'KeyD') battle.defendAction();
    if (e.code === 'KeyS') battle.spellAction();
    if (e.code === 'KeyR') ui.confirmRetreat(() => battle.retreat());
  }
}, true);
document.addEventListener('keyup', e => {
  const mk = mapKey(e);
  if (mk) keys[mk] = false;
}, true);
window.addEventListener('blur', () => {
  keys.KeyW = keys.KeyA = keys.KeyS = keys.KeyD = false;
  cancelPointerTracking(); // 失焦时不会再收到 pointerup，必须主动清掉长按定时器
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let smokeFrames = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = clamp(clock.getDelta(), 0, 0.05);
  Tweens.update(dt);
  if (state.mode === 'start') {
    // 开始画面：世界缓慢旋转展示
    if (world.built) {
      world.update(dt);
      const t = performance.now() * 0.00004;
      camera.position.set(Math.cos(t) * 58, 36, Math.sin(t) * 58);
      camera.lookAt(0, 0, 0);
    }
    if (bloomEnabled) composer.render(); else renderer.render(mapScene, camera);
  } else if (state.mode === 'map') {
    world.update(dt);
    // WASD / 方向键平移：target 与 camera 同步平移，避免 OrbitControls 抵消
    let panX = 0, panZ = 0;
    if (keys.KeyW) panZ -= 1;
    if (keys.KeyS) panZ += 1;
    if (keys.KeyA) panX -= 1;
    if (keys.KeyD) panX += 1;
    const panning = panX !== 0 || panZ !== 0;
    if (panning) {
      const speed = 18 * dt; // 适中速度
      camera.getWorldDirection(_panDir);
      _panDir.y = 0;
      if (_panDir.lengthSq() < 1e-6) _panDir.set(0, 0, -1);
      else _panDir.normalize();
      // 右 = forward × up；WASD 方向按手感校正
      _panDelta.set(_panDir.z, 0, -_panDir.x).multiplyScalar(-panX * speed);
      _panDir.multiplyScalar(-panZ * speed);
      _panDelta.add(_panDir);
      controls.target.add(_panDelta);
      camera.position.add(_panDelta);
      cameraFree = true;
      camFreeGoal.copy(controls.target);
    } else if (!cameraFree) {
      // 仅非自由观察时跟随英雄
      const goal = world.heroMesh.position;
      _camBefore.copy(controls.target);
      controls.target.lerp(goal, 1 - Math.pow(0.001, dt));
      camera.position.add(_camDelta.copy(controls.target).sub(_camBefore));
    } else {
      // 自由观察静止时保持 target，防止阻尼把视角拽走
      camFreeGoal.copy(controls.target);
    }
    if (minimap) minimap.update(dt);
    controls.update();
    renderPass.scene = mapScene; // 确保后期处理在大地图场景
    if (bloomEnabled) composer.render(); else renderer.render(mapScene, camera);
  } else if (state.mode === 'battle' && battle) {
    battle.update(dt, camera);
    controls.update();
    renderPass.scene = battleScene; // 切换后期处理到战场场景
    if (bloomEnabled) composer.render(); else renderer.render(battleScene, camera);
  }
  if (SMOKE && ++smokeFrames === 45) {
    const d = document.getElementById('smoke');
    if (d && !d.textContent) d.textContent = 'OK';
  }
  // 首帧渲染后隐藏加载画面
  if (!loop.firstFrameDone) {
    loop.firstFrameDone = true;
    const l = document.getElementById('loading');
    if (l) { l.classList.add('fade'); setTimeout(() => l.remove(), 700); }
  }
}
loop();

// ---------- 调试句柄 ----------
window.__game = { state, world, ui, getBattle: () => battle, startBattle, endTurn, saveGame, readSave, maybeSpawnEnemy,
  getCamTarget: () => controls.target, getCamPos: () => camera.position,
  // 联调/回归用
  validateSave, revertArtifact, loadRecords, bestRecord,
  isBootDone: () => bootDone, whenBootReady: () => bootPromise };

// ---------- 启动：预加载 glTF → 构建世界 ----------
controls.enabled = false;

async function boot() {
  const tip = document.querySelector('#loading .load-tip');
  const fill = document.querySelector('#loading .load-fill');
  try {
    // 分阶段加载：先加载启动必需的核心资产（玩家英雄+城堡+初始兵种+矿场），
    // 进入游戏后后台加载剩余资产（野怪+敌方+精锐兵种），大幅缩短首屏等待。
    const bootAssets = getBootAssets();
    const res = await preloadGroup(bootAssets, (ratio, label) => {
      if (tip) tip.textContent = label || '加载资源…';
      if (fill) {
        fill.style.animation = 'none';
        fill.style.marginLeft = '0';
        fill.style.width = `${Math.max(8, Math.round(ratio * 100))}%`;
      }
    });
    if (tip) tip.textContent = res.total ? `模型 ${res.ok}/${res.total}` : '程序化模型就绪';
  } catch (e) {
    console.warn('[boot] 资源预加载异常，使用原语回退', e);
    if (tip) tip.textContent = '使用程序化模型';
  }
  // 后台预加载剩余资产（不阻塞启动；加载完成后刷新地图上仍用原语的对象模型为 glb）
  preloadGroup(getBackgroundAssets()).then(() => {
    if (world && world.built) {
      try { world.refreshObjectMeshes(); } catch (e) { console.warn('[boot] 刷新对象模型异常', e); }
    }
  }).catch(e => console.warn('[boot] 后台资产加载异常', e));

  const bootSave = SMOKE ? null : readSave();
  // 【难度恢复】saveGame 把 diff 写在存档顶层，而 applySavedState 读的是 s.diff（state 内层，
  // 恒 undefined）。必须在 applySavedState / world.build 之前把难度设回去，否则读档后
  // 整局都跑在 normal 数值上，且世界会按 normal 烘焙。无 diff 的旧存档回落 normal。
  if (bootSave) setDifficulty(bootSave.diff || (bootSave.state && bootSave.state.diff) || 'normal');

  // 建世界互斥：boot 是异步的，理论上世界可能已被 startNewGame 建好，重复 build 会造成
  // 对象翻倍（实测 79 vs 基线 42）。
  if (!world.built) {
    if (bootSave) {
      applySavedState(bootSave.state);
      world.build(bootSave.world);
      world.fromSave = true;
    } else {
      world.build(null);
      world.fromSave = false;
    }
  }
  if (bootSave && state.mode === 'start') {
    const bc = document.getElementById('btn-continue-save');
    if (bc) bc.classList.remove('hidden');
  }
  applyQuality();

  // 世界就绪：放开开始按钮
  bootDone = true;
  setStartButtonsEnabled(true);

  // 冒烟测试钩子
  if (SMOKE) {
    const d = document.createElement('div');
    d.id = 'smoke';
    d.style.display = 'none';
    document.body.appendChild(d);
    window.addEventListener('error', e => { d.textContent = 'ERR:' + e.message; });
    enterMap();
    if (SMOKE === 'battle') {
      const obj = [...world.objects.values()].find(o => o.kind === 'monster' && !o.data.boss);
      if (obj) startBattle(obj);
    }
  }
}

bootPromise = boot().catch((e) => {
  console.error(e);
  const tip = document.querySelector('#loading .load-tip');
  if (tip) tip.textContent = '启动失败，请刷新重试';
  // 即使 boot 出错也要放开按钮，否则开始界面彻底卡死
  bootDone = true;
  setStartButtonsEnabled(true);
});
