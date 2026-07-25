// ================= 工具库 =================
import * as THREE from 'three';

export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const choice = arr => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 值噪声（地形生成用） ----------
export function makeNoise(seed = 1) {
  const hash = (x, y) => {
    let h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const smooth = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; // [0,1]
  };
}
export function fbm(noise, x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * noise(x * f, y * f); amp *= 0.5; f *= 2; }
  return v; // ~[0,1]
}

// ---------- 缓动 ----------
export const easeLinear = k => k;
export const easeInOut = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
export const easeOut = k => 1 - Math.pow(1 - k, 3);

// ---------- 补间动画管理器 ----------
const tweenList = [];
export const Tweens = {
  add({ dur = 0.5, ease = easeInOut, onUpdate, onDone }) {
    const t = { t: 0, dur, ease, onUpdate, onDone, dead: false };
    tweenList.push(t);
    return t;
  },
  delay(sec, fn) { return this.add({ dur: sec, ease: easeLinear, onUpdate: () => {}, onDone: fn }); },
  update(dt) {
    for (const t of tweenList) {
      if (t.dead) continue;
      t.t += dt;
      const k = clamp(t.t / t.dur, 0, 1);
      t.onUpdate && t.onUpdate(t.ease(k));
      if (k >= 1) { t.dead = true; t.onDone && t.onDone(); }
    }
    for (let i = tweenList.length - 1; i >= 0; i--) if (tweenList[i].dead) tweenList.splice(i, 1);
  }
};

// ---------- 六边形网格（odd-q 偏移，平顶六边形） ----------
export const HEX_S = 1;
const SQRT3 = Math.sqrt(3);
export function hexToWorld(col, row) {
  return { x: col * 1.5 * HEX_S, z: (row + 0.5 * (col & 1)) * SQRT3 * HEX_S };
}
export function hexNeighbors(col, row) {
  const odd = col & 1;
  const d = odd
    ? [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1]]
    : [[1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [0, -1]];
  return d.map(([dc, dr]) => [col + dc, row + dr]);
}
export function hexDistance(c1, r1, c2, r2) {
  const toCube = (col, row) => { const x = col, z = row - ((col - (col & 1)) / 2); return [x, -x - z, z]; };
  const [x1, y1, z1] = toCube(c1, r1), [x2, y2, z2] = toCube(c2, r2);
  return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
}

// ---------- 文字精灵（地图标签） ----------
export function makeTextSprite(text, { size = 44, color = '#fff', bg = 'rgba(18,14,8,0.78)', pad = 16, scale = 1 } = {}) {
  const lines = text.split('\n');
  const cv = document.createElement('canvas');
  let ctx = cv.getContext('2d');
  const font = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.font = font;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width));
  cv.width = Math.ceil(w + pad * 2);
  cv.height = Math.ceil(size * 1.3 * lines.length + pad * 2);
  ctx = cv.getContext('2d');
  // 圆角底
  ctx.fillStyle = bg;
  const r = 14;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.arcTo(cv.width, 0, cv.width, cv.height, r); ctx.arcTo(cv.width, cv.height, 0, cv.height, r);
  ctx.arcTo(0, cv.height, 0, 0, r); ctx.arcTo(0, 0, cv.width, 0, r); ctx.closePath(); ctx.fill();
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, cv.width / 2, pad + size * 0.65 + i * size * 1.3));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(cv.width / 110 * scale, cv.height / 110 * scale, 1);
  return sp;
}

// ---------- 资源释放（跳过共享缓存几何体 / 贴图） ----------
/** 所有可能持有贴图的材质槽位。
 *  这里是唯一真源：js/assets/loader.js 的 markTexturesShared 用同一份清单给
 *  克隆材质的贴图打 userData.shared，本文件的 disposeObject3D 用同一份清单
 *  决定该不该 dispose。两处必须一致——只覆盖 .map 的老写法有两个后果：
 *    1) 程序化材质（models.js / textures.js）的 normalMap / roughnessMap 等
 *       永远不会被释放，反复进出战斗会持续泄漏显存；
 *    2) 万一将来有槽位没被 loader 标记 shared，也不会被误删（有 shared 判断兜底）。
 */
export const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap',
  'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap', 'envMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
  'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap',
  'specularColorMap', 'specularIntensityMap', 'anisotropyMap',
];

export function disposeObject3D(obj) {
  obj.traverse(o => {
    if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        for (const slot of TEXTURE_SLOTS) {
          const t = m[slot];
          // 共享贴图（与 loader 缓存原件共用）必须跳过，否则一个实例销毁会让
          // 其余实例贴图变黑并触发反复重传。
          if (t && t.dispose && !(t.userData && t.userData.shared)) t.dispose();
        }
        m.dispose();
      }
    }
  });
}

// ---------- 3D → 屏幕坐标 ----------
const _pv = new THREE.Vector3();
export function projectToScreen(v3, camera, out = {}) {
  _pv.copy(v3).project(camera);
  out.x = (_pv.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (-_pv.y * 0.5 + 0.5) * window.innerHeight;
  out.behind = _pv.z > 1;
  return out;
}

// ---------- 简易合成音效 ----------
let AC = null;
let MUTED = false;
export function setMuted(m) { MUTED = m; }
export function isMuted() { return MUTED; }
export function initAudio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 无音频环境 */ } }
  if (AC && AC.state === 'suspended') AC.resume();
}
function tone(f0, f1, dur, type = 'square', vol = 0.15, delay = 0) {
  if (!AC) return;
  const t = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f0), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(AC.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
function noiseBurst(dur, vol = 0.15, delay = 0, { type = 'lowpass', freq = 0, freq2 = 0, q = 1 } = {}) {
  if (!AC) return;
  const t = AC.currentTime + delay;
  const sr = AC.sampleRate;
  const buf = AC.createBuffer(1, Math.max(1, Math.floor(sr * dur)), sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = AC.createBufferSource();
  src.buffer = buf;
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  let last = src;
  if (freq > 0) {
    const f = AC.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(1, freq), t);
    if (freq2 > 0) f.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t + dur);
    src.connect(f); last = f;
  }
  last.connect(g); g.connect(AC.destination);
  src.start(t); src.stop(t + dur + 0.05);
}
export function sfx(kind) {
  if (!AC || MUTED) return;
  switch (kind) {
    case 'hit':    tone(220, 60, 0.15, 'square', 0.2); break;
    case 'shoot':  tone(900, 300, 0.12, 'sawtooth', 0.12); break;
    case 'magic':  tone(300, 1200, 0.35, 'sine', 0.2); tone(600, 1800, 0.3, 'sine', 0.1, 0.05); break;
    case 'pickup': tone(660, 660, 0.08, 'sine', 0.15); tone(990, 990, 0.12, 'sine', 0.15, 0.09); break;
    case 'move':     noiseBurst(0.08, 0.1, 0, { type: 'lowpass', freq: 500 }); noiseBurst(0.08, 0.1, 0.1, { type: 'lowpass', freq: 500 }); break;
    case 'attack':   tone(800, 400, 0.12, 'square', 0.15); noiseBurst(0.1, 0.08, 0, { type: 'bandpass', freq: 2000, q: 2 }); break;
    case 'hurt':     tone(200, 80, 0.18, 'triangle', 0.18); noiseBurst(0.18, 0.1, 0, { type: 'lowpass', freq: 800 }); break;
    case 'spell':    tone(400, 1200, 0.4, 'sine', 0.15); tone(800, 2400, 0.35, 'sine', 0.07, 0.05); tone(1200, 3600, 0.3, 'sine', 0.04, 0.1); break;
    case 'death':    tone(300, 50, 0.5, 'triangle', 0.2); break;
    case 'block':    tone(1500, 1200, 0.06, 'square', 0.12); noiseBurst(0.06, 0.05, 0, { type: 'highpass', freq: 2000 }); break;
    case 'turn':     tone(660, 660, 0.15, 'sine', 0.12); break;
    case 'select':   tone(880, 880, 0.05, 'sine', 0.1); break;
    case 'arrow':    noiseBurst(0.2, 0.1, 0, { type: 'bandpass', freq: 3000, freq2: 800, q: 1 }); tone(1500, 800, 0.08, 'square', 0.06, 0.02); break;
    case 'fireball': noiseBurst(0.35, 0.12, 0, { type: 'lowpass', freq: 600 }); tone(300, 100, 0.35, 'sawtooth', 0.12); break;
    case 'level':  [523, 659, 784].forEach((f, i) => tone(f, f, 0.12, 'sine', 0.15, i * 0.1)); break;
    case 'win':    [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.18, i * 0.12)); break;
    case 'lose':   [400, 300, 200, 120].forEach((f, i) => tone(f, f, 0.25, 'sawtooth', 0.12, i * 0.18)); break;
    case 'click':  tone(500, 400, 0.05, 'square', 0.06); break;
  }
}

// ---------- 背景音乐（MusicGen 生成的 mp3 循环播放） ----------
let bgmAudio = null, bgmPlaying = false, bgmFadeRaf = null;
// bgmGen：每次 startBgm/stopBgm 递增的世代号。淡入/淡出回调里比对世代号，
// 不一致说明期间已被后续的 start/stop 取代，直接放弃——否则 400ms 内快速切两次静音，
// 上一次的淡出回调会把刚启动的 BGM 直接 pause 掉。
let bgmGen = 0;
let bgmGestureHooked = false;         // 是否已挂上"下次用户手势重试播放"的一次性监听
const BGM_SRC = 'art/audio/bgm_map.mp3';
const BGM_VOL = 0.35; // 背景音乐音量（较低，不抢游戏音效）

// 自动播放被浏览器拦截时：解锁 bgmPlaying，并在下一次用户手势时重试一次
function hookBgmGestureRetry() {
  if (bgmGestureHooked) return;
  bgmGestureHooked = true;
  const opts = { capture: true, once: true };
  const retry = () => {
    window.removeEventListener('pointerdown', retry, true);
    window.removeEventListener('keydown', retry, true);
    window.removeEventListener('touchend', retry, true);
    bgmGestureHooked = false;
    if (!MUTED && !bgmPlaying) { initAudio(); startBgm(); }
  };
  window.addEventListener('pointerdown', retry, opts);
  window.addEventListener('keydown', retry, opts);
  window.addEventListener('touchend', retry, opts);
}

export function startBgm() {
  if (MUTED || bgmPlaying) return;
  // 首次播放需用户手势已激活 AudioContext（initAudio 已处理），HTMLAudio 同样受自动播放策略约束
  if (!bgmAudio) {
    bgmAudio = new Audio(BGM_SRC);
    bgmAudio.loop = true;
    bgmAudio.preload = 'auto';
  }
  const gen = ++bgmGen;
  bgmPlaying = true;
  if (bgmFadeRaf) { cancelAnimationFrame(bgmFadeRaf); bgmFadeRaf = null; } // 抢占进行中的淡出
  const audio = bgmAudio;
  audio.volume = 0;                    // 从 0 淡入，避免突兀
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      if (gen !== bgmGen) return;      // 已被后续 start/stop 取代，不动状态
      // 自动播放被拦截：把 bgmPlaying 置回 false（否则永久锁死，再也不会尝试），
      // 并注册一次性手势监听，在下次真实用户手势时重试
      bgmPlaying = false;
      if (bgmFadeRaf) { cancelAnimationFrame(bgmFadeRaf); bgmFadeRaf = null; }
      hookBgmGestureRetry();
    });
  }
  // 简易线性淡入（约 1.5s）
  const fadeStart = performance.now();
  const fadeDur = 1500;
  const fadeStep = () => {
    if (gen !== bgmGen || !bgmPlaying || bgmAudio !== audio) return;
    const k = Math.min(1, (performance.now() - fadeStart) / fadeDur);
    audio.volume = BGM_VOL * k;
    if (k < 1) bgmFadeRaf = requestAnimationFrame(fadeStep);
    else bgmFadeRaf = null;
  };
  fadeStep();
}
export function stopBgm() {
  bgmPlaying = false;
  const gen = ++bgmGen;
  if (bgmFadeRaf) { cancelAnimationFrame(bgmFadeRaf); bgmFadeRaf = null; }
  if (bgmAudio) {
    // 快速淡出后暂停（0.4s），避免咔哒声
    const audio = bgmAudio;
    const v0 = audio.volume;
    const t0 = performance.now();
    const out = () => {
      if (gen !== bgmGen || bgmAudio !== audio) return; // 期间又 start 了：放弃这次淡出，绝不 pause
      const k = Math.min(1, (performance.now() - t0) / 400);
      audio.volume = v0 * (1 - k);
      if (k < 1) { bgmFadeRaf = requestAnimationFrame(out); }
      else { audio.pause(); bgmFadeRaf = null; }
    };
    out();
  }
}

// ---------- 二叉堆（A* 用） ----------
export class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item, pri) {
    const a = this.a; a.push({ item, pri });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].pri <= a[i].pri) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].pri < a[m].pri) m = l;
        if (r < a.length && a[r].pri < a[m].pri) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top.item;
  }
}
