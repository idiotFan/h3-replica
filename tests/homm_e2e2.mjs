// 新功能测试：小地图/路径预览/魔法书/伤害预估/士气/战斗日志/存读档
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9338;
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
async function connect() {
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
}
async function waitPlayerTurn() {
  for (let i = 0; i < 60; i++) {
    const side = await evl(`(() => { const b = __game.getBattle(); return b && b.active ? b.active.side : -1; })()`);
    if (side === 0) return true;
    await sleep(800);
  }
  return false;
}

// 冷启动要预加载全部 glTF，固定 sleep 不可靠，轮询等地图就绪
async function waitMapReady(timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await evl(`!!(window.__game && __game.state.mode === 'map' && document.querySelector('#minimap canvas'))`)) return true; } catch (e) {}
    await sleep(300);
  }
  return false;
}

async function main() {
  await connect();
  await send('Page.navigate', { url: 'http://localhost:8000/?smoke=map' });
  await waitMapReady();
  await sleep(500);

  console.log('== 1. 小地图与路径预览 ==');
  check('小地图 canvas 存在', await evl(`!!document.querySelector('#minimap canvas')`));
  check('小地图已绘制(多色)', await evl(`(() => {
    const cv = document.querySelector('#minimap canvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 40) colors.add((d[i]>>5)+','+(d[i+1]>>5)+','+(d[i+2]>>5));
    return colors.size > 4;
  })()`));
  check('路径预览点显示', await evl(`(() => {
    const w = __game.world;
    w.hoverTile(w.hero.x + 2, w.hero.y);
    return w.pathDots.some(d => d.visible);
  })()`));

  console.log('== 2. 进入战斗，测试伤害预估 ==');
  await evl(`(() => {
    const obj = [...__game.world.objects.values()].find(o => o.kind === 'monster' && !o.data.boss);
    __game.startBattle(obj);
  })()`);
  await sleep(2000);
  check('轮到玩家', await waitPlayerTurn());
  check('伤害预估合理', await evl(`(() => {
    const b = __game.getBattle();
    const p = b.previewDamage(b.active, b.aliveStacks(1)[0]);
    return p.min <= p.max && p.killsMin <= p.killsMax && p.min >= 1;
  })()`));

  console.log('== 3. 魔法书 ==');
  const mp0 = await evl(`__game.getBattle().heroMp`);
  await evl(`(() => { const b = __game.getBattle(); b.selectSpell('haste'); b.castSpell('haste', b.active); })()`);
  await sleep(800);
  check('加速术：速度+3且扣MP', await evl(`(() => {
    const b = __game.getBattle();
    return b.active.spdBonus === 3 && b.heroMp === ${mp0} - 3;
  })()`));
  check('本回合不能再施法', await evl(`(() => { const b = __game.getBattle(); b.spellAction(); return !__game.ui.isSpellMenuOpen(); })()`));

  // 等下一个玩家回合，测试治疗
  await evl(`__game.getBattle().defendAction()`);
  await waitPlayerTurn();
  await evl(`(() => { const b = __game.getBattle(); b.selectSpell('heal'); b.castSpell('heal', b.active); })()`);
  await sleep(800);
  check('治疗术施放成功', await evl(`(() => { const b = __game.getBattle(); return b.spellRound === b.round; })()`));

  // 等下一个玩家回合，测试火球
  await evl(`__game.getBattle().defendAction()`);
  await waitPlayerTurn();
  const enemyCountBefore = await evl(`__game.getBattle().aliveStacks(1).reduce((s, e) => s + e.count, 0)`);
  await evl(`(() => { const b = __game.getBattle(); b.selectSpell('fireball'); b.castSpell('fireball', b.aliveStacks(1)[0]); })()`);
  await sleep(1000);
  const enemyCountAfter = await evl(`__game.getBattle().aliveStacks(1).reduce((s, e) => s + e.count, 0)`);
  check('火球造成伤害', enemyCountAfter < enemyCountBefore, `${enemyCountBefore} -> ${enemyCountAfter}`);

  console.log('== 4. 士气系统 ==');
  await evl(`__game.getBattle().defendAction()`);
  await waitPlayerTurn();
  const activeId = await evl(`(() => { Math.random = () => 0.01; const b = __game.getBattle(); return b.active.id; })()`);
  await evl(`__game.getBattle().defendAction()`);
  await sleep(600);
  check('士气高涨再行动', await evl(`(() => { const b = __game.getBattle(); return b.active.id === ${activeId} && b.active.moraleTriggered; })()`));
  await evl(`(() => { Math.random = () => 0.99; __game.getBattle().defendAction(); })()`);

  console.log('== 5. 战斗日志 ==');
  check('日志有内容', await evl(`document.getElementById('battle-log').children.length > 3`));

  console.log('== 6. 结束战斗并存档 ==');
  for (let i = 0; i < 40; i++) {
    const done = await evl(`__game.state.mode === 'map'`);
    if (done) break;
    await evl(`(() => { const b = __game.getBattle(); if (b && !b.over && b.aliveStacks(1).length) { b.applyDamage(b.aliveStacks(1)[0], 99999); b.checkEnd(); } })()`);
    await sleep(600);
  }
  await sleep(2000);
  check('返回地图', await evl(`__game.state.mode === 'map'`));
  const savedDay = await evl(`(() => { __game.endTurn(); return __game.state.day; })()`);
  await sleep(5000); // 敌方行动结束后才会写入存档
  check('自动存档写入', await evl(`(() => { const s = __game.readSave(); return s && s.state.day === ${savedDay} && s.world.objects.length > 10; })()`));

  console.log('== 7. 读档 ==');
  await send('Page.navigate', { url: 'http://localhost:8000/' });
  await sleep(4000);
  check('继续按钮出现', await evl(`!document.getElementById('btn-continue-save').classList.contains('hidden')`));
  await evl(`document.getElementById('btn-continue-save').click()`);
  await sleep(4000);
  check('读档后天数正确', await evl(`__game.state.day === ${savedDay}`), 'day=' + await evl(`__game.state.day`));
  check('读档后英雄位置正确', await evl(`(() => { const s = __game.readSave(); return __game.world.hero.x === s.world.hero.x && __game.world.hero.y === s.world.hero.y; })()`));
  check('读档后对象数量一致', await evl(`(() => { const s = __game.readSave(); return __game.world.objects.size === s.world.objects.length; })()`), 'actual=' + await evl(`__game.world.objects.size`));
  check('读档后军队正确', await evl(`(() => { const s = __game.readSave(); return JSON.stringify(__game.state.hero.army) === JSON.stringify(s.state.hero.army); })()`));

  console.log('\n== 运行时错误 ==');
  console.log(errors.length ? errors.slice(0, 5).join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${errors.length} 个运行时错误`);
  ws.close();
}
main().catch(e => { console.error('FAIL:', e); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
