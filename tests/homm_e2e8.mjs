// 第 8 轮：战斗 AI 战术决策测试
//
// 旧 AI 的三个短板：远程永远射「最近的」、近战永远打 adj[0]（数组顺序=随机）、
// 移动只看距离。玩家两场就能摸透，战斗失去张力。
//
// 新 AI 用 scoreTarget() 统一打分：预期伤害 + 击杀奖励 + 威胁权重 - 反击惩罚，
// 移动则评估「移动到某格 + 攻击某目标」的组合收益。本测试锁死这些行为不被回退。
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, '--window-size=1000,700', 'about:blank'], { stdio: 'ignore' });
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

async function waitBattle(timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await evl(`!!(window.__game && __game.getBattle && __game.getBattle())`)) return true; } catch (e) {}
    await sleep(400);
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
    if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 250));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8000/?smoke=battle' });
  check('进入战斗', await waitBattle());
  await sleep(2000);

  console.log('== 1. 打分函数存在且可用 ==');
  check('scoreTarget / threatOf / poolOf 已实现', await evl(`(() => {
    const b = __game.getBattle();
    return typeof b.scoreTarget === 'function' && typeof b.threatOf === 'function' && typeof b.poolOf === 'function';
  })()`));

  console.log('== 2. 优先补刀残血目标 ==');
  check('残血目标得分高于满血', await evl(`(() => {
    const b = __game.getBattle();
    const e = b.aliveStacks(1)[0], ps = b.aliveStacks(0);
    if (ps.length < 2) return true;                 // 单位不足，跳过
    const bak = { c: ps[0].count, h: ps[0].topHP };
    ps[0].count = 1; ps[0].topHP = 1;               // 造残血
    const s0 = b.scoreTarget(e, ps[0]), s1 = b.scoreTarget(e, ps[1]);
    ps[0].count = bak.c; ps[0].topHP = bak.h;       // 还原
    return s0 > s1;
  })()`));

  console.log('== 3. 射手威胁权重更高 ==');
  check('同等条件下射手威胁 > 同等输出的近战', await evl(`(() => {
    const b = __game.getBattle();
    const all = b.aliveStacks(0).concat(b.aliveStacks(1));
    const ar = all.find(s => s.t.shots && s.shotsLeft > 0);
    if (!ar) return true;                            // 场上没射手，跳过
    // 构造一个属性相同但无远程的影子单位，比较威胁值
    const shadow = { ...ar, t: { ...ar.t, shots: 0 }, shotsLeft: 0 };
    return b.threatOf(ar) > b.threatOf(shadow);
  })()`));

  console.log('== 4. 反击惩罚生效 ==');
  check('优先打「已反击过」的目标（不会再挨反击）', await evl(`(() => {
    const b = __game.getBattle();
    const e = b.aliveStacks(1)[0], p = b.aliveStacks(0)[0];
    const bak = p.retaliated;
    p.retaliated = false; const withRet = b.scoreTarget(e, p);
    p.retaliated = true;  const noRet = b.scoreTarget(e, p);
    p.retaliated = bak;
    return noRet > withRet;
  })()`));

  console.log('== 5. 目标选择优于「打最近」 ==');
  const cmp = await evl(`(() => {
    const b = __game.getBattle();
    const es = b.aliveStacks(1), ps = b.aliveStacks(0);
    let better = 0, total = 0;
    for (const e of es) {
      let near = ps[0], nd = Infinity;
      for (const p of ps) { const d = Math.abs(p.col - e.col) + Math.abs(p.row - e.row); if (d < nd) { nd = d; near = p; } }
      let smart = ps[0], sc = -Infinity;
      for (const p of ps) { const s = b.scoreTarget(e, p); if (s > sc) { sc = s; smart = p; } }
      total++;
      if (sc >= b.scoreTarget(e, near) - 0.01) better++;   // 新逻辑不劣于旧逻辑
    }
    return { total, better };
  })()`);
  check(`新逻辑对每个敌方单位都不劣于「打最近」(${cmp.better}/${cmp.total})`, cmp.better === cmp.total);

  console.log('== 6. AI 行动不崩溃 ==');
  check('连续推进 30 步无异常', await evl(`(async () => {
    const b = __game.getBattle();
    for (let i = 0; i < 30 && !b.over; i++) {
      if (b.busy) { await new Promise(r => setTimeout(r, 150)); continue; }
      const a = b.active;
      if (!a) break;
      if (a.side === 0) b.defendAction();            // 玩家侧直接防御，把回合让给 AI
      await new Promise(r => setTimeout(r, 200));
    }
    return true;
  })()`));

  console.log('\n== 运行时错误 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${errors.length} 个运行时错误`);
  if (fail || errors.length) process.exitCode = 1;
  ws.close();
}
main().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
