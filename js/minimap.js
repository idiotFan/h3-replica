// ================= 小地图 =================
import { MAP } from './config.js';

const TERRAIN_COLORS = { water: '#2e6f9e', grass: '#4f9140', forest: '#2f6b2a', mountain: '#8a8d91' };
const SIZE = 168;

export class Minimap {
  constructor(world, container, onClickTile, getViewTile) {
    this.world = world;
    this.cv = document.createElement('canvas');
    this.cv.width = SIZE; this.cv.height = SIZE;
    container.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d');
    // 地形静态缓存
    this.terrainCache = document.createElement('canvas');
    this.terrainCache.width = SIZE; this.terrainCache.height = SIZE;
    this.renderTerrain();
    this.t = 1;
    this.getViewTile = getViewTile || null;
    this.cv.addEventListener('click', e => {
      const r = this.cv.getBoundingClientRect();
      const tx = Math.floor((e.clientX - r.left) / r.width * MAP.W);
      const ty = Math.floor((e.clientY - r.top) / r.height * MAP.H);
      onClickTile(tx, ty);
    });
  }

  renderTerrain() {
    const c = this.terrainCache.getContext('2d');
    const s = SIZE / MAP.W;
    for (let x = 0; x < MAP.W; x++) for (let y = 0; y < MAP.H; y++) {
      const col = this.world.type[x];
      c.fillStyle = (col && TERRAIN_COLORS[col[y]]) || '#000';
      c.fillRect(Math.floor(x * s), Math.floor(y * s), Math.ceil(s), Math.ceil(s));
    }
  }

  update(dt) {
    this.t += dt;
    if (this.t < 0.25) return; // 4Hz 刷新
    this.t = 0;
    const c = this.ctx, s = SIZE / MAP.W;
    c.drawImage(this.terrainCache, 0, 0);
    // 战争迷雾：未探索区域涂黑
    const exp = this.world.explored;
    if (exp) {
      c.fillStyle = '#0a0e1a';
      for (let x = 0; x < MAP.W; x++) for (let y = 0; y < MAP.H; y++)
        if (!exp[x][y]) c.fillRect(Math.floor(x * s), Math.floor(y * s), Math.ceil(s), Math.ceil(s));
    }
    const vis = this.world.visible;
    for (const o of this.world.objects.values()) {
      const expl = exp && exp[o.x] && exp[o.x][o.y];
      if (expl === false) continue; // 未探索不显示
      // 敌方英雄仅当前可见时显示
      if (o.kind === 'enemyHero' && vis && !(vis[o.x] && vis[o.x][o.y])) continue;
      if (o.kind === 'monster') c.fillStyle = o.data.boss ? '#ff2222' : '#e05545';
      else if (o.kind === 'enemyHero') c.fillStyle = '#ff5a4a';
      else if (o.kind === 'enemyCastle') c.fillStyle = '#c0392b';
      else if (o.kind === 'castle') c.fillStyle = '#4f9fff';
      else if (o.kind === 'mine') c.fillStyle = o.data.owned ? '#7db3ff' : '#c8963c';
      else if (o.kind === 'artifact') c.fillStyle = '#c26bff';
      else c.fillStyle = '#ffe9b0';
      const sz = o.kind === 'castle' || o.kind === 'enemyCastle' || o.data.boss ? 5 : 3;
      c.fillRect((o.x + 0.5) * s - sz / 2, (o.y + 0.5) * s - sz / 2, sz, sz);
    }
    // 英雄（闪烁圆点）
    const h = this.world.hero;
    c.fillStyle = Math.floor(performance.now() / 400) % 2 ? '#ffffff' : '#3b82f6';
    c.beginPath();
    c.arc((h.x + 0.5) * s, (h.y + 0.5) * s, 3.5, 0, Math.PI * 2);
    c.fill();
    // 当前视野框
    if (this.getViewTile) {
      const v = this.getViewTile();
      c.strokeStyle = 'rgba(255,255,255,.75)';
      c.lineWidth = 1;
      c.strokeRect((v.x - 4) * s, (v.y - 3) * s, 8 * s, 6 * s);
    }
  }
}
