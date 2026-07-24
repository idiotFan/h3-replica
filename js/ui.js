// ================= DOM UI 管理 =================
import * as THREE from 'three';
import { UNITS, RECRUITABLE, RECRUITABLE2, UPGRADE_BASE, BARRACKS_COST, SPELLS, SKILLS, MINES } from './config.js';
import { DIFFICULTIES, DIFF } from './difficulty.js';
import { projectToScreen } from './utils.js';

const $ = id => document.getElementById(id);
const RES_NAME = { gold: '金币', wood: '木材', ore: '矿石' };

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.els = {
      topbar: $('topbar'), day: $('day'),
      rGold: $('r-gold'), rWood: $('r-wood'), rOre: $('r-ore'),
      herobar: $('herobar'), heroInfo: $('hero-info'), army: $('army'),
      mpFill: $('mp-fill'), mpText: $('mp-text'),
      battlebar: $('battlebar'), queue: $('queue'), activeInfo: $('active-info'),
      btnWait: $('btn-wait'), btnDefend: $('btn-defend'), btnSpell: $('btn-spell'),
      battleHint: $('battle-hint'),
      toasts: $('toasts'), floaters: $('floaters'), labels: $('labels'),
      modal: $('modal'), modalBox: $('modal-box'),
      startScreen: $('start-screen'), hint: $('hint'),
    };
    // 按钮
    $('btn-endturn').onclick = () => handlers.onEndTurn();
    this.els.btnWait.onclick = () => handlers.onWait();
    this.els.btnDefend.onclick = () => handlers.onDefend();
    this.els.btnSpell.onclick = () => handlers.onSpell();
    // 撤销移动按钮
    const btnUndo = $('btn-undo');
    if (btnUndo) btnUndo.onclick = () => handlers.onUndo && handlers.onUndo();
    // 难度选择按钮（3 档），点击即以该难度开始新游戏
    document.querySelectorAll('button[data-diff]').forEach(btn => {
      btn.onclick = () => handlers.onStart(btn.dataset.diff);
    });
    $('btn-continue-save').onclick = () => handlers.onContinueSave();
    $('btn-retreat').onclick = () => handlers.onRetreat();
    $('btn-settings').onclick = () => handlers.onSettings();
  }

  // ---------- 顶部资源栏 ----------
  updateTopbar(state) {
    this.els.day.textContent = `第 ${state.day} 天`;
    const incG = DIFF.castleIncome + state.mines.gold * MINES.gold.income.gold + ((state.hero.skills || {}).estates || 0) * 250;
    const incW = state.mines.sawmill * MINES.sawmill.income.wood;
    const incO = state.mines.ore * MINES.ore.income.ore;
    this.els.rGold.innerHTML = `${state.res.gold}<small class="inc">+${incG}</small>`;
    this.els.rWood.innerHTML = `${state.res.wood}<small class="inc">+${incW}</small>`;
    this.els.rOre.innerHTML = `${state.res.ore}<small class="inc">+${incO}</small>`;
  }

  // ---------- 英雄栏 ----------
  updateHeroBar(hero) {
    const xpNeed = hero.level * DIFF.xpThreshold;
    const xpPct = Math.min(100, (hero.xp / xpNeed) * 100).toFixed(1);
    const skillText = Object.entries(hero.skills || {}).filter(([, v]) => v > 0)
      .map(([k, v]) => `${SKILLS[k].name}${v}`).join(' ');
    this.els.heroInfo.innerHTML =
      `<div class="hero-name">英雄 Lv.${hero.level}${hero.skillPoints ? ' <small class="sp-tip">有技能点！</small>' : ''}</div>` +
      `<div class="hero-stats">攻${hero.atk} 防${hero.def} · 魔法 ${hero.mp}/${hero.mpMax}${skillText ? ' · ' + skillText : ''}</div>` +
      `<div class="xp-bar"><div class="xp-fill" style="width:${xpPct}%"></div><span>${hero.xp}/${xpNeed}</span></div>`;
    this.els.army.innerHTML = hero.army.length
      ? hero.army.map(a => {
          const t = UNITS[a.type];
          return `<div class="chip army-chip" style="border-color:#3b82f6">
            <span class="dot" style="background:#${t.color.toString(16).padStart(6, '0')}"></span>
            ${t.name} <b>${a.count}</b></div>`;
        }).join('')
      : '<div class="chip">没有部队</div>';
    const ratio = Math.max(0, hero.movePoints / hero.moveMax);
    this.els.mpFill.style.width = (ratio * 100).toFixed(1) + '%';
    this.els.mpText.textContent = `移动力 ${Math.floor(hero.movePoints)}/${hero.moveMax}`;
  }

  // ---------- 模式切换 ----------
  setMode(mode) {
    this.els.topbar.classList.toggle('hidden', mode === 'start');
    this.els.herobar.classList.toggle('hidden', mode !== 'map');
    this.els.battlebar.classList.toggle('hidden', mode !== 'battle');
    this.els.hint.classList.toggle('hidden', mode !== 'map');
    const mm = document.getElementById('minimap');
    if (mm) mm.classList.toggle('hidden', mode !== 'map');
    const log = document.getElementById('battle-log');
    if (log) {
      log.classList.add('hidden'); // 出现首条日志时再显示，避免空描金框
      log.classList.remove('mobile-show');
      if (mode === 'battle') log.innerHTML = '';
    }
    if (mode !== 'battle') { this.els.labels.innerHTML = ''; this.closeSpellMenu(); this.hideTooltip(); }
  }

  // 控制撤销移动按钮显隐
  setUndoAvailable(available) {
    const btn = $('btn-undo');
    if (btn) btn.classList.toggle('hidden', !available);
  }

  // ---------- 提示 ----------
  toast(msg, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.textContent = msg;
    this.els.toasts.appendChild(d);
    while (this.els.toasts.children.length > 4) this.els.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 2600);
  }
  // 新手引导：更长停留 + 可点击关闭
  guide(msg) {
    const d = document.createElement('div');
    d.className = 'toast guide';
    d.innerHTML = `<span>${msg}</span><b>✕</b>`;
    d.querySelector('b').onclick = () => d.remove();
    this.els.toasts.appendChild(d);
    while (this.els.toasts.children.length > 4) this.els.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 7000);
  }
  setHint(text) { this.els.battleHint.textContent = text; }

  // ---------- 战场 UI ----------
  updateQueue(queue, active, round) {
    const items = [];
    if (active) items.push(this.queueChip(active, true));
    for (const st of queue.slice(0, 9)) if (st.alive) items.push(this.queueChip(st, false));
    this.els.queue.innerHTML = items.join('');
    const ri = document.getElementById('round-ind');
    if (ri) ri.textContent = `第 ${round} 回合`;
  }
  queueChip(st, isActive) {
    const dot = `<span class="dot" style="background:#${st.t.color.toString(16).padStart(6, '0')}"></span>`;
    return `<div class="chip q-chip ${isActive ? 'q-active' : ''}" style="border-color:${st.side === 0 ? '#3b82f6' : '#ef4444'}">
      ${dot}${st.t.name}<b>${st.count}</b></div>`;
  }
  updateActivePanel(st, heroMp) {
    if (!st) { this.els.activeInfo.innerHTML = ''; return; }
    const t = st.t;
    const sideName = st.side === 0 ? '我方' : '敌方';
    const buffs = (st.slowRounds > 0 ? ' · 减速中' : '') + (st.blessRounds > 0 ? ' · 祝福中' : '');
    this.els.activeInfo.innerHTML =
      `<b style="color:${st.side === 0 ? '#7db3ff' : '#ff9a8a'}">${sideName} · ${t.name}</b> x${st.count}` +
      `<span class="ai-line">生命 ${st.topHP}/${t.hp} · 攻${t.atk} 防${t.def} · 伤害 ${t.dmg[0]}-${t.dmg[1]} · 速度 ${t.spd + (st.spdBonus || 0)}` +
      (t.shots ? ` · 弹药 ${st.shotsLeft}` : '') + (st.defending ? ' · 防御中' : '') + buffs + `</span>`;
  }
  setBattleButtons({ wait, defend, spell, spellText }) {
    this.els.btnWait.disabled = !wait;
    this.els.btnDefend.disabled = !defend;
    this.els.btnSpell.disabled = !spell;
    this.els.btnSpell.textContent = spellText || '魔法书';
  }

  // ---------- 魔法书菜单 ----------
  isSpellMenuOpen() { return !!document.getElementById('spell-menu'); }
  closeSpellMenu() { document.getElementById('spell-menu')?.remove(); }
  toggleSpellMenu(heroMp) {
    this.closeSpellMenu();
    const m = document.createElement('div');
    m.id = 'spell-menu';
    m.className = 'ornate';
    m.innerHTML = `<div class="spell-title">魔法书 · MP ${heroMp}</div>` +
      Object.entries(SPELLS).map(([k, sp]) =>
        `<div class="spell-item ${heroMp < sp.cost ? 'disabled' : ''}" data-spell="${k}">
           <div class="sp-head"><b>${sp.name}</b><span class="sp-cost">${sp.cost} MP</span></div>
           <div class="sp-desc">${sp.desc}</div>
         </div>`).join('');
    document.body.appendChild(m);
    m.querySelectorAll('.spell-item').forEach(el => {
      el.onclick = () => { if (!el.classList.contains('disabled')) this.h.onSelectSpell(el.dataset.spell); };
    });
  }

  // ---------- 战斗日志 ----------
  battleLog(msg, cls = '') {
    const log = document.getElementById('battle-log');
    if (!log) return;
    log.classList.remove('hidden');
    // 移动端默认隐藏日志，有内容时切换为紧凑横条
    if (window.matchMedia('(max-width: 820px)').matches) log.classList.add('mobile-show');
    const d = document.createElement('div');
    d.className = 'log-line ' + cls;
    d.textContent = msg;
    log.appendChild(d);
    while (log.children.length > 50) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  // ---------- 回合横幅 ----------
  turnBanner(text, cls = '') {
    let b = document.getElementById('turn-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'turn-banner';
      document.body.appendChild(b);
    }
    b.textContent = text;
    b.className = 'tb-anim ' + cls;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.remove('tb-anim'), 1500);
  }

  // ---------- 伤害预估提示 ----------
  showTooltip(x, y, html) {
    let t = document.getElementById('tooltip');
    t.innerHTML = html;
    t.classList.remove('hidden');
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }
  hideTooltip() { document.getElementById('tooltip').classList.add('hidden'); }

  // ---------- 战场单位标签 ----------
  makeStackLabel(st) {
    const d = document.createElement('div');
    d.className = 'stk-label ' + (st.side === 0 ? 'ally' : 'enemy');
    d.textContent = st.count;
    this.els.labels.appendChild(d);
    return d;
  }
  updateStackLabel(st) { if (st.label) st.label.textContent = Math.max(0, st.count); }
  removeStackLabel(st) { if (st.label) { st.label.remove(); st.label = null; } }
  _lblV = new THREE.Vector3();
  _lblP = {};
  positionStackLabel(st, camera) {
    if (!st.label) return;
    this._lblV.copy(st.mesh.position);
    this._lblV.y += st.type === 'dragon' ? 2.1 : 1.45;
    const p = projectToScreen(this._lblV, camera, this._lblP);
    st.label.style.display = p.behind ? 'none' : 'block';
    st.label.style.transform = `translate(-50%,-100%) translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
  }

  // ---------- 飘字 ----------
  floaterAt(st, text, cls = '', delay = 0) {
    const v = st.mesh.position.clone();
    v.y += 1.3;
    this.floater3D(v, text, cls, delay);
  }
  floater3D(v3, text, cls = '', delay = 0) {
    setTimeout(() => {
      const cam = this.h.getCamera();
      if (!cam) return;
      const p = projectToScreen(v3, cam, {});
      if (p.behind) return;
      const d = document.createElement('div');
      d.className = 'floater ' + cls;
      d.textContent = text;
      d.style.left = p.x + 'px';
      d.style.top = p.y + 'px';
      this.els.floaters.appendChild(d);
      d.addEventListener('animationend', () => d.remove());
    }, delay * 1000);
  }

  // ---------- 模态框 ----------
  openModal(html) {
    this.els.modalBox.innerHTML = html;
    this.els.modal.classList.remove('hidden');
  }
  closeModal() { this.els.modal.classList.add('hidden'); }

  // ---------- 城堡招募 ----------
  openCastle(state, onChange) {
    const render = () => {
      const hero = state.hero;
      const unitCard = type => {
        const t = UNITS[type];
        const costText = Object.entries(t.cost).map(([k, v]) => `${RES_NAME[k]}${v}`).join(' ');
        const afford = this.maxAffordable(state, t);
        const owned = hero.army.find(a => a.type === type);
        const full = !owned && hero.army.length >= 7;
        const dis = afford <= 0 || full;
        const upgraded = !!UPGRADE_BASE[type];
        return `<div class="card ${upgraded ? 'card-up' : ''}">
          <div class="card-title"><span class="dot" style="background:#${t.color.toString(16).padStart(6, '0')}"></span>${t.name}${owned ? ` <small>已有${owned.count}</small>` : ''}</div>
          <div class="card-stats">攻${t.atk} 防${t.def} · 伤害${t.dmg[0]}-${t.dmg[1]}<br>生命${t.hp} 速度${t.spd}${t.shots ? ' · 远程' : ''}${t.fly ? ' · 飞行' : ''}</div>
          <div class="card-cost">${costText}</div>
          <div class="card-btns">
            ${[1, 5, 10].map(n => `<button data-type="${type}" data-n="${n}" ${dis || afford < n ? 'disabled' : ''}>+${n}</button>`).join('')}
            <button data-type="${type}" data-n="max" ${dis ? 'disabled' : ''}>最大(${Math.max(0, afford)})</button>
          </div>
        </div>`;
      };
      // 兵营升级区
      let barracksHtml;
      if (state.barracksUpgraded) {
        barracksHtml = `<div class="barracks done">兵营已升级 · 可招募精锐部队</div>
          <div class="cards">${RECRUITABLE2.map(unitCard).join('')}</div>
          <div class="sec-title">基础部队</div>`;
      } else {
        const costText = Object.entries(BARRACKS_COST).map(([k, v]) => `${RES_NAME[k]}${v}`).join(' ');
        const can = Object.entries(BARRACKS_COST).every(([k, v]) => state.res[k] >= v);
        barracksHtml = `<div class="barracks">
            <span>升级兵营解锁精锐部队（${costText}）</span>
            <button id="btn-up-barracks" class="btn-gold" ${can ? '' : 'disabled'}>升级兵营</button>
          </div>`;
      }
      const armyText = hero.army.length
        ? hero.army.map(a => `${UNITS[a.type].name}x${a.count}`).join(' · ') : '无';
      this.openModal(
        `<div class="modal-title">城堡 · 招募部队</div>
         <div class="modal-res">金币 ${state.res.gold} · 木材 ${state.res.wood} · 矿石 ${state.res.ore}</div>
         <div class="modal-army">当前军队：${armyText}</div>
         ${barracksHtml}
         <div class="cards">${RECRUITABLE.map(unitCard).join('')}</div>
         <div class="modal-btns"><button id="btn-close-modal" class="btn-gold">离开城堡</button></div>`
      );
      $('btn-close-modal').onclick = () => { this.closeModal(); onChange(); };
      const upBtn = $('btn-up-barracks');
      if (upBtn) upBtn.onclick = () => {
        for (const [k, v] of Object.entries(BARRACKS_COST)) state.res[k] -= v;
        state.barracksUpgraded = true;
        this.toast('兵营升级完成！精锐部队开放招募', 'good');
        onChange();
        render();
      };
      this.els.modalBox.querySelectorAll('button[data-type]').forEach(btn => {
        btn.onclick = () => {
          const type = btn.dataset.type;
          const t = UNITS[type];
          let n = btn.dataset.n === 'max' ? this.maxAffordable(state, t) : parseInt(btn.dataset.n);
          n = Math.min(n, this.maxAffordable(state, t));
          if (n <= 0) return;
          for (const [k, v] of Object.entries(t.cost)) state.res[k] -= v * n;
          const owned = hero.army.find(a => a.type === type);
          if (owned) owned.count += n;
          else hero.army.push({ type, count: n });
          this.toast(`招募了 ${t.name} x${n}`, 'good');
          onChange();
          render();
        };
      });
    };
    render();
  }
  maxAffordable(state, t) {
    let m = Infinity;
    for (const [k, v] of Object.entries(t.cost)) m = Math.min(m, Math.floor(state.res[k] / v));
    return m === Infinity ? 0 : m;
  }

  // ---------- 技能选择（升级） ----------
  openSkillChoice(hero, onPick) {
    const available = Object.entries(SKILLS).filter(([k, s]) => (hero.skills[k] || 0) < s.max);
    if (!available.length) { onPick(null); return; }
    // 随机二选一（不足则全展示）
    const shuffled = available.sort(() => Math.random() - 0.5).slice(0, 2);
    const cards = shuffled.map(([k, s]) => {
      const cur = hero.skills[k] || 0;
      return `<div class="skill-card" data-skill="${k}">
        <div class="skill-name">${s.name} Lv.${cur + 1}<small>（${cur}/${s.max}）</small></div>
        <div class="skill-desc">${s.desc}</div>
      </div>`;
    }).join('');
    this.openModal(
      `<div class="modal-title">英雄升级 · 选择技能</div>
       <div class="skill-cards">${cards}</div>`
    );
    this.els.modalBox.querySelectorAll('.skill-card').forEach(el => {
      el.onclick = () => { this.closeModal(); onPick(el.dataset.skill); };
    });
  }

  // ---------- 设置 ----------
  openSettings({ muted, quality, onMute, onQuality, onExport, onImport }) {
    this.openModal(
      `<div class="modal-title">设置</div>
       <div class="set-row">
         <span>音效</span>
         <button id="set-mute" class="btn-gold">${muted ? '已静音' : '开启中'}</button>
       </div>
       <div class="set-row">
         <span>画质</span>
         <div class="set-q">
           <button data-q="high" class="btn-gold ${quality === 'high' ? 'q-on' : ''}">高（阴影+高清）</button>
           <button data-q="low" class="btn-gold ${quality === 'low' ? 'q-on' : ''}">低（流畅省电）</button>
         </div>
       </div>
       <div class="set-row">
         <span>存档</span>
         <div class="set-q">
           <button id="set-export" class="btn-gold">导出存档</button>
           <button id="set-import" class="btn-gold">导入存档</button>
         </div>
         <input type="file" id="set-import-file" accept="application/json,.json" hidden>
       </div>
       <div class="modal-btns"><button id="btn-close-modal" class="btn-gold">关闭</button></div>`
    );
    let m = muted;
    $('set-mute').onclick = () => {
      m = !m;
      onMute(m);
      $('set-mute').textContent = m ? '已静音' : '开启中';
    };
    this.els.modalBox.querySelectorAll('button[data-q]').forEach(btn => {
      btn.onclick = () => {
        onQuality(btn.dataset.q);
        this.els.modalBox.querySelectorAll('button[data-q]').forEach(b => b.classList.toggle('q-on', b === btn));
      };
    });
    // 导出存档：下载 JSON 文件
    $('set-export').onclick = () => {
      if (onExport) {
        const json = onExport();
        if (json) {
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `homm3d_save_${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
          this.toast('存档已导出', 'good');
        } else {
          this.toast('暂无可导出的存档', 'warn');
        }
      }
    };
    // 导入存档：选择文件后读取 JSON
    $('set-import').onclick = () => $('set-import-file').click();
    $('set-import-file').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (onImport) {
          const ok = onImport(reader.result);
          this.toast(ok ? '存档已导入，刷新生效' : '导入失败：文件格式错误', ok ? 'good' : 'warn');
          if (ok) setTimeout(() => this.closeModal(), 800);
        }
      };
      reader.readAsText(file);
    };
    $('btn-close-modal').onclick = () => this.closeModal();
  }

  // ---------- 撤退确认 ----------
  confirmRetreat(onYes) {
    this.openModal(
      `<div class="modal-title">确认撤退？</div>
       <div class="end-stats">撤退将损失各部队 <b>25%</b> 兵力并结束战斗。</div>
       <div class="modal-btns">
         <button id="btn-retreat-yes" class="btn-gold btn-danger">确认撤退</button>
         <button id="btn-retreat-no" class="btn-gold">继续战斗</button>
       </div>`
    );
    $('btn-retreat-yes').onclick = () => { this.closeModal(); onYes(); };
    $('btn-retreat-no').onclick = () => this.closeModal();
  }

  // ---------- 胜利 CG ----------
  showVictoryCG(stats, onRestart, onContinue) {
    this.openModal(
      `<canvas id="cg-canvas"></canvas>
       <div class="cg-content">
         <div class="cg-title">胜 利</div>
         <div class="cg-sub">黑龙巢穴已被摧毁，大陆重归和平！</div>
         <div class="cg-stats">${stats}</div>
         <div class="modal-btns">
           <button id="btn-cg-continue" class="btn-gold">继续漫游</button>
           <button id="btn-cg-restart" class="btn-gold">重新开始</button>
         </div>
       </div>`
    );
    $('btn-cg-restart').onclick = onRestart;
    $('btn-cg-continue').onclick = () => { this.stopConfetti(); this.closeModal(); onContinue(); };
    this.runConfetti();
  }
  runConfetti() {
    const cv = document.getElementById('cg-canvas');
    if (!cv) return;
    const box = this.els.modalBox;
    cv.width = box.clientWidth; cv.height = box.clientHeight;
    const ctx = cv.getContext('2d');
    const colors = ['#ffd76b', '#ff8a5a', '#c26bff', '#7db3ff', '#7dff6a', '#ffe9b0'];
    const parts = [];
    const spawn = () => {
      for (let i = 0; i < 4; i++) {
        parts.push({
          x: Math.random() * cv.width, y: -10,
          vx: (Math.random() - 0.5) * 1.6, vy: 1 + Math.random() * 2.2,
          s: 3 + Math.random() * 4, c: colors[Math.floor(Math.random() * colors.length)],
          r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2,
        });
      }
    };
    let frames = 0;
    const tick = () => {
      if (!document.getElementById('cg-canvas')) return; // 模态已关闭
      if (frames++ < 240) spawn();
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (p.y > cv.height + 12) { parts.splice(i, 1); continue; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      this.confettiTimer = requestAnimationFrame(tick);
    };
    tick();
  }
  stopConfetti() { if (this.confettiTimer) cancelAnimationFrame(this.confettiTimer); }

  // ---------- 结算画面 ----------
  showEnd(win, stats, onRestart, onContinue) {
    const title = win ? '胜 利' : '战 败';
    this.openModal(
      `<div class="modal-title end-title ${win ? 'win' : 'lose'}">${title}</div>
       <div class="end-stats">${stats}</div>
       <div class="modal-btns">
         ${win && onContinue ? '<button id="btn-continue" class="btn-gold">继续漫游</button>' : ''}
         <button id="btn-restart" class="btn-gold">重新开始</button>
       </div>`
    );
    $('btn-restart').onclick = onRestart;
    if (win && onContinue) $('btn-continue').onclick = () => { this.closeModal(); onContinue(); };
  }

  hideStart() { this.els.startScreen.classList.add('hidden'); }
}
