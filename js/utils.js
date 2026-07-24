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

// ---------- 资源释放（跳过共享缓存几何体） ----------
export function disposeObject3D(obj) {
  obj.traverse(o => {
    if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map && !m.map.userData.shared) m.map.dispose();
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

// ---------- 背景音乐（程序化循环，轻量氛围垫底） ----------
let bgmGain = null, bgmTimer = null, bgmPlaying = false;
// 简易五声音阶序列，低频长音 + 偶尔高音点缀，营造探索氛围
const BGM_SCALE = [220, 247, 277, 330, 370, 440, 494];
export function startBgm() {
  if (!AC || MUTED || bgmPlaying) return;
  bgmPlaying = true;
  bgmGain = AC.createGain();
  bgmGain.gain.value = 0;
  bgmGain.connect(AC.destination);
  bgmGain.gain.setTargetAtTime(0.05, AC.currentTime, 1.5); // 淡入
  const playNote = () => {
    if (!bgmPlaying || !AC) return;
    const t = AC.currentTime;
    const f = BGM_SCALE[Math.floor(Math.random() * BGM_SCALE.length)];
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.4);
    g.gain.linearRampToValueAtTime(0, t + 2.2);
    o.connect(g); g.connect(bgmGain);
    o.start(t); o.stop(t + 2.4);
    // 低音铺垫
    if (Math.random() < 0.5) {
      const o2 = AC.createOscillator(), g2 = AC.createGain();
      o2.type = 'triangle'; o2.frequency.value = f / 2;
      g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.35, t + 0.6); g2.gain.linearRampToValueAtTime(0, t + 2.6);
      o2.connect(g2); g2.connect(bgmGain); o2.start(t); o2.stop(t + 2.8);
    }
    bgmTimer = setTimeout(playNote, 1800 + Math.random() * 1200);
  };
  playNote();
}
export function stopBgm() {
  bgmPlaying = false;
  if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; }
  if (bgmGain && AC) { bgmGain.gain.setTargetAtTime(0, AC.currentTime, 0.6); }
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
