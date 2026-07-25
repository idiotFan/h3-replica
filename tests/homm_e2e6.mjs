// 第 6 轮：难度机制测试 —— 野怪警戒圈拦截 / 野怪成长 / 严格禁穿墙角
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9339;
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

// 冷启动要预加载全部 glTF（实测约 9s），固定 sleep 不可靠，轮询等地图就绪
async function waitMapReady(timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await evl(`!!(window.__game && __game.world && __game.world.built && __game.state.mode === 'map')`)) return true; } catch (e) {}
    await sleep(300);
  }
  return false;
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
    if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8000/?smoke=map' });
  check('地图就绪', await waitMapReady());
  await sleep(500);

  console.log('== 1. 警戒圈数据 ==');
  check('存在野怪', await evl(`[...__game.world.objects.values()].some(o => o.kind === 'monster')`));
  check('guardAt 覆盖相邻格', await evl(`(() => {
    const w = __game.world;
    const m = [...w.objects.values()].find(o => o.kind === 'monster');
    return !!(w.guardAt(m.x + 1, m.y) && w.guardAt(m.x - 1, m.y - 1) && !w.guardAt(m.x + 3, m.y + 3));
  })()`));
  check('大股野怪已拆多队列', await evl(`(() => {
    const ms = [...__game.world.objects.values()].filter(o => o.kind === 'monster' && !o.data.boss);
    return ms.some(m => m.data.stacks.length >= 2);
  })()`));

  console.log('== 2. 警戒圈拦截 ==');
  // 把英雄传送到某野怪 2 格外的可通行格，然后点击其相邻格 → 应触发战斗
  const setup = await evl(`(() => {
    const w = __game.world;
    const m = [...w.objects.values()].find(o => o.kind === 'monster' && !o.data.boss);
    if (!m) return null;
    let from = null, into = null;
    for (let dx = -2; dx <= 2 && !from; dx++) for (let dy = -2; dy <= 2 && !from; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      const x = m.x + dx, y = m.y + dy;
      if (w.passable(x, y) && !w.guardAt(x, y)) from = { x, y };
    }
    for (let dx = -1; dx <= 1 && !into; dx++) for (let dy = -1; dy <= 1 && !into; dy++) {
      if (!dx && !dy) continue;
      const x = m.x + dx, y = m.y + dy;
      if (w.passable(x, y) && from && Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) <= 1) into = { x, y };
    }
    if (!from || !into) return null;
    w.hero.x = from.x; w.hero.y = from.y; w.hero.movePoints = 15;
    const p = w.tileWorld(from.x, from.y);
    w.heroMesh.position.set(p.x, p.y, p.z);
    w.clickTile(into.x, into.y);
    return { monster: m.data.stacks[0].type };
  })()`);
  if (!setup) { check('拦截场景可构造', false, '(地形不满足，跳过)'); }
  else {
    await sleep(2500);
    check('踏入警戒圈触发战斗', await evl(`__game.state.mode === 'battle'`));
    // 秒杀敌军结束战斗，验证战后拾取逻辑不报错
    for (let i = 0; i < 30; i++) {
      const done = await evl(`__game.state.mode === 'map'`);
      if (done) break;
      await evl(`(() => { const b = __game.getBattle(); if (b && !b.over && b.aliveStacks(1).length) { b.applyDamage(b.aliveStacks(1)[0], 99999); b.checkEnd(); } })()`);
      await sleep(600);
    }
    await sleep(1500);
    check('战后返回地图', await evl(`__game.state.mode === 'map'`));
  }

  console.log('== 3. 野怪成长 ==');
  const grown = await evl(`(() => {
    const w = __game.world;
    const ms = [...w.objects.values()].filter(o => o.kind === 'monster');
    if (!ms.length) return null;
    const before = ms.map(m => m.data.stacks.reduce((s, st) => s + st.count, 0));
    w.growMonsters(1.1);
    const after = ms.map(m => m.data.stacks.reduce((s, st) => s + st.count, 0));
    return after.every((a, i) => a > before[i] || before[i] === 0) && ms.every(m => !!m.label);
  })()`);
  check('growMonsters 增长且标签重建', grown === true);

  console.log('== 4. 严格禁穿墙角 ==');
  const corner = await evl(`(() => {
    const w = __game.world;
    // 找一个「对角可走但一侧被山/水挡」的角
    for (let x = 2; x < 38; x++) for (let y = 2; y < 38; y++) {
      const aOk = w.passable(x, y), bOk = w.passable(x + 1, y + 1);
      const s1 = w.passable(x + 1, y), s2 = w.passable(x, y + 1);
      if (aOk && bOk && s1 !== s2) { // 恰好一侧被挡
        const p = w.findPath(x, y, x + 1, y + 1);
        if (!p) return { found: true, ok: true };            // 需绕远到不可达也算禁止成功
        return { found: true, ok: p.total > 1.5 + 0.001 };   // 不允许 1.5 成本直接斜穿
      }
    }
    return { found: false, ok: true };
  })()`);
  check('单侧受阻时禁止斜穿' + (corner.found ? '' : '（本图无此地形，跳过）'), corner.ok);

  console.log('\n== 运行时错误 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${errors.length} 个运行时错误`);
  if (fail || errors.length) process.exitCode = 1;
  ws.close();
}
main().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
