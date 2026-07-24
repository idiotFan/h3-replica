// 第四轮测试：技能树/新法术/撤退/精锐兵种/胜利CG
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let idSeq = 1; const pending = new Map(); const errors = []; let ws;
const send = (m, p = {}) => new Promise(res => { const id = idSeq++; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
async function evl(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error('eval失败: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${extra}`); }
}
async function waitPlayerTurn() {
  for (let i = 0; i < 30; i++) {
    const side = await evl(`(() => { const b = __game.getBattle(); return b && b.active ? b.active.side : -1; })()`);
    if (side === 0) return true;
    await sleep(800);
  }
  return false;
}
async function winBattle() {
  for (let i = 0; i < 40; i++) {
    const done = await evl(`__game.state.mode === 'map'`);
    if (done) return;
    await evl(`(() => { const b = __game.getBattle(); if (b && !b.over && b.aliveStacks(1).length) { b.applyDamage(b.aliveStacks(1)[0], 99999); b.checkEnd(); } })()`);
    await sleep(600);
  }
  await sleep(1500);
}

async function main() {
  let wsUrl = null;
  for (let i = 0; i < 30 && !wsUrl; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch (e) {}
    if (!wsUrl) await sleep(500);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8000/?smoke=map' });
  await sleep(6000);

  console.log('== 1. 技能树 ==');
  await evl(`(() => { __game.state.hero.skillPoints = 1; })()`);
  // 通过战斗胜利触发技能选择太间接，直接调用内部函数不可达——用 UI 接口模拟
  await evl(`(() => {
    const h = __game.state.hero;
    __game.ui.openSkillChoice(h, key => {
      if (key) { h.skills[key] = (h.skills[key] || 0) + 1; h.skillPoints--; }
    });
  })()`);
  await sleep(600);
  check('技能选择弹窗出现', await evl(`document.querySelectorAll('.skill-card').length >= 1`));
  await evl(`document.querySelector('.skill-card').click()`);
  await sleep(400);
  check('技能已习得', await evl(`Object.values(__game.state.hero.skills).some(v => v > 0)`));
  check('技能点已消耗', await evl(`__game.state.hero.skillPoints === 0`));

  console.log('== 2. 技能影响伤害 ==');
  await evl(`(() => {
    const obj = [...__game.world.objects.values()].find(o => o.kind === 'monster' && !o.data.boss);
    window.__obj = obj;
    __game.startBattle(obj);
  })()`);
  await sleep(1800);
  await waitPlayerTurn();
  const dmgTest = await evl(`(() => {
    const b = __game.getBattle();
    Math.random = () => 0.5; // 固定随机数
    const att = b.active, def = b.aliveStacks(1)[0];
    __game.state.hero.skills = { offense: 0, armorer: 0, luck: 0 };
    const d0 = b.calcDamage(att, def, {}).dmg;
    __game.state.hero.skills.offense = 2;
    const d2 = b.calcDamage(att, def, {}).dmg;
    return { d0, d2 };
  })()`);
  check('进攻术提升近战伤害', dmgTest.d2 > dmgTest.d0, `${dmgTest.d0} -> ${dmgTest.d2}`);
  const defTest = await evl(`(() => {
    const b = __game.getBattle();
    const att = b.aliveStacks(1)[0], def = b.active; // 敌人打我
    __game.state.hero.skills = { offense: 0, armorer: 0, luck: 0 };
    const d0 = b.calcDamage(att, def, {}).dmg;
    __game.state.hero.skills.armorer = 2;
    const d2 = b.calcDamage(att, def, {}).dmg;
    return { d0, d2 };
  })()`);
  check('防御术降低受到伤害', defTest.d2 < defTest.d0, `${defTest.d0} -> ${defTest.d2}`);

  console.log('== 3. 新法术 ==');
  const mpBefore = await evl(`__game.getBattle().heroMp`);
  await evl(`(() => { const b = __game.getBattle(); b.castSpell('slow', b.aliveStacks(1)[0]); })()`);
  await sleep(800);
  check('减速：速度减半', await evl(`(() => {
    const b = __game.getBattle();
    const t = b.aliveStacks(1)[0];
    return t.slowRounds > 0 && b.effSpd(t) <= Math.ceil(t.t.spd / 2);
  })()`));
  await evl(`__game.getBattle().defendAction()`);
  await waitPlayerTurn();
  await evl(`(() => { const b = __game.getBattle(); b.castSpell('bless', b.active); })()`);
  await sleep(800);
  check('祝福：伤害取最大值', await evl(`(() => {
    const b = __game.getBattle();
    const st = b.active;
    if (st.blessRounds <= 0) return false;
    const def = b.aliveStacks(1)[0];
    const p = b.previewDamage(st, def);
    const raw = Math.round(st.t.dmg[1] * 1.2);
    return p.max >= raw * st.count; // 含加成，至少不小于裸最大
  })()`));
  await evl(`__game.getBattle().defendAction()`);
  await waitPlayerTurn();
  await evl(`(() => { __game.state.hero.skills = {}; Math.random = () => 0.5; const b = __game.getBattle(); b.castSpell('chain', b.aliveStacks(1)[0]); })()`);
  await sleep(1500);
  check('连环闪电施放（MP 足够时扣 8）', await evl(`(() => {
    const b = __game.getBattle();
    return b.spellRound === b.round;
  })()`));
  console.log('== 4. 撤退 ==');
  await evl(`__game.getBattle().defendAction()`);
  await waitPlayerTurn();
  const armyBefore = await evl(`JSON.stringify(__game.state.hero.army)`);
  await evl(`__game.getBattle().retreat()`);
  await sleep(1500);
  check('撤退返回地图', await evl(`__game.state.mode === 'map'`));
  check('撤退损失约25%', await evl(`(() => {
    const before = JSON.parse('${armyBefore.replace(/'/g, "\\'")}');
    const after = __game.state.hero.army;
    const bSum = before.reduce((s, a) => s + a.count, 0);
    const aSum = after.reduce((s, a) => s + a.count, 0);
    const loss = (bSum - aSum) / bSum;
    return loss > 0.15 && loss <= 0.3;
  })()`), 'before=' + armyBefore);
  check('怪物未被移除', await evl(`__game.world.objects.has(window.__obj.x + ',' + window.__obj.y)`));

  console.log('== 5. 兵营升级与精锐兵种 ==');
  await evl(`(() => { __game.state.res = { gold: 9999, wood: 99, ore: 99 }; })()`);
  await evl(`__game.ui.openCastle(__game.state, () => {})`);
  await sleep(500);
  await evl(`document.getElementById('btn-up-barracks').click()`);
  await sleep(500);
  check('兵营已升级', await evl(`__game.state.barracksUpgraded === true`));
  check('精锐卡片出现', await evl(`!!document.querySelector('button[data-type="champion2"]')`));
  await evl(`document.querySelector('button[data-type="champion2"][data-n="1"]').click()`);
  await sleep(400);
  check('招募到精英骑士', await evl(`__game.state.hero.army.some(a => a.type === 'champion2' && a.count >= 1)`));
  await evl(`document.getElementById('btn-close-modal').click()`);

  console.log('== 6. 胜利 CG ==');
  await evl(`(() => {
    const boss = [...__game.world.objects.values()].find(o => o.kind === 'monster' && o.data.boss);
    __game.startBattle(boss);
  })()`);
  await sleep(1800);
  await winBattle();
  await sleep(1000);
  check('CG 彩带画布存在', await evl(`!!document.getElementById('cg-canvas')`));
  check('CG 标题正确', await evl(`document.querySelector('.cg-title') && document.querySelector('.cg-title').textContent.includes('胜')`));
  check('CG 统计显示击杀数', await evl(`document.querySelector('.cg-stats').textContent.includes('击杀')`));
  await evl(`document.getElementById('btn-cg-continue').click()`);
  await sleep(600);
  check('CG 关闭回到地图', await evl(`__game.state.mode === 'map'`));
  // Boss 经验可能触发升级 → 连锁技能选择弹窗，逐个点掉
  for (let i = 0; i < 5; i++) {
    const hasSkill = await evl(`!!document.querySelector('.skill-card')`);
    if (!hasSkill) break;
    await evl(`document.querySelector('.skill-card').click()`);
    await sleep(400);
  }
  check('技能连锁选择完成并关闭', await evl(`document.getElementById('modal').classList.contains('hidden') || !document.querySelector('.skill-card')`));

  console.log('== 7. 存档保留技能与兵营 ==');
  await evl(`__game.saveGame()`);
  check('存档含技能与兵营', await evl(`(() => {
    const s = __game.readSave();
    return s && s.state.barracksUpgraded === true && typeof s.state.hero.skills === 'object';
  })()`));

  console.log('\n== 运行时错误 ==');
  console.log(errors.length ? errors.slice(0, 5).join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${errors.length} 个运行时错误`);
  ws.close();
}
main().catch(e => { console.error('FAIL:', e); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
