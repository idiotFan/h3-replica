// 第三轮测试：敌方阵营 / 启动流程 / 美术元素
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

// 等待 boot 完成（难度按钮解禁）。boot 是异步预加载 glTF，冷启动可能要 10s 以上。
async function waitStartReady(timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evl(`(() => { const b = document.querySelector('button[data-diff="normal"]'); return !!(window.__game && b && !b.disabled); })()`)) return true;
    } catch (e) {}
    await sleep(300);
  }
  return false;
}
// 点难度按钮开局（旧版是 #btn-start，改版后是 3 档难度按钮）
async function clickStart(diff = 'normal') {
  await waitStartReady();
  await evl(`document.querySelector('button[data-diff="${diff}"]').click()`);
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (await evl(`__game.state.mode === 'map'`)) return true;
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
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  };
  await send('Runtime.enable');
  await send('Page.enable');

  console.log('== 1. 启动画面（无存档） ==');
  await send('Page.navigate', { url: 'http://localhost:8000/' });
  await sleep(3000);
  await evl(`localStorage.clear()`);
  await send('Page.navigate', { url: 'http://localhost:8000/' });
  await waitStartReady();
  check('开始画面显示', await evl(`__game.state.mode === 'start' && !document.getElementById('start-screen').classList.contains('hidden')`));
  check('世界已构建作背景', await evl(`__game.world.built === true`));
  check('继续按钮隐藏', await evl(`document.getElementById('btn-continue-save').classList.contains('hidden')`));
  check('点击开始进入地图', await clickStart('normal'));

  console.log('== 2. 敌方阵营存在性 ==');
  check('敌方城堡已生成', await evl(`[...__game.world.objects.values()].some(o => o.kind === 'enemyCastle')`));
  check('初始敌方英雄已生成', await evl(`__game.world.enemyHeroes.length >= 1`));
  check('云朵已生成', await evl(`__game.world.clouds.length === 10`));
  check('水面纹理已生成', await evl(`!!__game.world.waterTex`));

  console.log('== 3. 敌方英雄追击并发起战斗 ==');
  // 把玩家传送到敌方英雄附近
  await evl(`(() => {
    const w = __game.world;
    const eh = w.enemyHeroes[0];
    window.__eh = eh;
    // 找敌方英雄附近可站地块
    outer: for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
      const x = eh.x + dx, y = eh.y + dy;
      if (w.inBounds(x, y) && w.passable(x, y) && (Math.abs(dx) + Math.abs(dy)) >= 2) {
        w.hero.x = x; w.hero.y = y;
        const tw = w.tileWorld(x, y);
        w.heroMesh.position.set(tw.x, tw.y, tw.z);
        break outer;
      }
    }
  })()`);
  await evl(`__game.endTurn()`);
  // 敌方行动是异步的，等待战斗触发
  let battleStarted = false;
  for (let i = 0; i < 25; i++) {
    await sleep(800);
    if (await evl(`__game.state.mode === 'battle'`)) { battleStarted = true; break; }
  }
  check('敌方英雄主动发起战斗', battleStarted);
  check('敌军带属性加成', await evl(`(() => { const b = __game.getBattle(); return b && b.enemyHero.atk >= 1; })()`));
  check('回合指示显示', await evl(`document.getElementById('round-ind').textContent.includes('回合')`));
  check('战场火盆存在', await evl(`(() => { const b = __game.getBattle(); return b && b.fireBalls && b.fireBalls.length === 4; })()`));
  // 打赢这场战斗
  for (let i = 0; i < 40; i++) {
    const done = await evl(`__game.state.mode === 'map'`);
    if (done) break;
    await evl(`(() => { const b = __game.getBattle(); if (b && !b.over && b.aliveStacks(1).length) { b.applyDamage(b.aliveStacks(1)[0], 99999); b.checkEnd(); } })()`);
    await sleep(600);
  }
  await sleep(1500);
  check('获胜后敌方英雄被移除', await evl(`!__game.world.enemyHeroes.includes(window.__eh)`));

  console.log('== 4. 敌方城堡增援与摧毁 ==');
  await evl(`(() => { __game.state.day = 5; __game.world.day = 5; __game.maybeSpawnEnemy(); })()`);
  check('第5天增援出现', await evl(`__game.world.enemyHeroes.length >= 1`));
  // 攻打城堡
  await evl(`(() => {
    const c = [...__game.world.objects.values()].find(o => o.kind === 'enemyCastle');
    __game.startBattle(c);
  })()`);
  await sleep(1500);
  check('城堡守卫战开始', await evl(`(() => { const b = __game.getBattle(); return b && b.enemyHero.atk === 3; })()`));
  for (let i = 0; i < 40; i++) {
    const done = await evl(`__game.state.mode === 'map'`);
    if (done) break;
    await evl(`(() => { const b = __game.getBattle(); if (b && !b.over && b.aliveStacks(1).length) { b.applyDamage(b.aliveStacks(1)[0], 99999); b.checkEnd(); } })()`);
    await sleep(600);
  }
  await sleep(1500);
  check('城堡被摧毁', await evl(`![...__game.world.objects.values()].some(o => o.kind === 'enemyCastle')`));
  const heroesBefore = await evl(`__game.world.enemyHeroes.length`);
  await evl(`(() => { __game.state.day = 10; __game.maybeSpawnEnemy(); })()`);
  check('城堡摧毁后不再增援', await evl(`__game.world.enemyHeroes.length`) === heroesBefore);

  console.log('== 5. 存档含敌方阵营并读档 ==');
  await evl(`__game.saveGame()`);
  const savedHeroes = await evl(`__game.readSave().world.objects.filter(o => o.kind === 'enemyHero').length`);
  check('存档包含敌方英雄', savedHeroes === heroesBefore, `${savedHeroes} vs ${heroesBefore}`);
  await send('Page.navigate', { url: 'http://localhost:8000/' });
  await sleep(5000);
  check('读档后继续按钮出现', await evl(`!document.getElementById('btn-continue-save').classList.contains('hidden')`));
  await evl(`document.getElementById('btn-continue-save').click()`);
  await sleep(2000);
  check('读档恢复敌方英雄', await evl(`__game.world.enemyHeroes.length`) === heroesBefore);
  check('城堡仍是摧毁状态', await evl(`![...__game.world.objects.values()].some(o => o.kind === 'enemyCastle')`));

  console.log('== 6. 新游戏重建 ==');
  // 回开始画面只能通过刷新，模拟：刷新后点开始
  await send('Page.navigate', { url: 'http://localhost:8000/' });
  await clickStart('normal');
  await sleep(1500);
  check('新游戏世界重建', await evl(`__game.state.mode === 'map' && __game.state.day === 1 && __game.world.fromSave === false`));
  check('新游戏城堡恢复', await evl(`[...__game.world.objects.values()].some(o => o.kind === 'enemyCastle')`));

  console.log('\n== 运行时错误 ==');
  console.log(errors.length ? errors.slice(0, 5).join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${errors.length} 个运行时错误`);
  ws.close();
}
main().catch(e => { console.error('FAIL:', e); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
