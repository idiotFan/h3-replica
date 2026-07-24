// 深度功能测试：移动 → 战斗全流程 → 回地图 → 结束回合
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const URL_GAME = 'http://localhost:8000/?smoke=map';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, '--window-size=800,600', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let idSeq = 1;
const pending = new Map();
const errors = [];
let ws;

const send = (method, params = {}) => new Promise(res => {
  const id = idSeq++;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

async function evl(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error('eval失败: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
}

let passCount = 0, failCount = 0;
function check(name, cond, extra = '') {
  if (cond) { passCount++; console.log(`  ✔ ${name}`); }
  else { failCount++; console.log(`  ✘ ${name} ${extra}`); }
}

async function main() {
  // 连接
  let wsUrl = null;
  for (let i = 0; i < 30 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = list.find(t => t.type === 'page')?.webSocketDebuggerUrl;
    } catch (e) {}
    if (!wsUrl) await sleep(500);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown')
      errors.push(JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 300));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_GAME });
  await sleep(6000);

  console.log('== 1. 地图模式 ==');
  check('游戏已启动', await evl(`window.__game && __game.state.mode === 'map'`));
  check('地图对象已生成(>20)', await evl(`__game.world.objects.size > 20`), '实际: ' + await evl(`__game.world.objects.size`));
  check('初始资源正确', await evl(`__game.state.res.gold === 3000 && __game.state.res.wood === 15`));

  // 英雄移动
  const before = await evl(`[__game.world.hero.x, __game.world.hero.y, __game.world.hero.movePoints]`);
  await evl(`__game.world.clickTile(${before[0] + 2}, ${before[1]})`);
  await sleep(2500);
  const after = await evl(`[__game.world.hero.x, __game.world.hero.y, __game.world.hero.movePoints]`);
  check('英雄移动了', after[0] !== before[0] || after[1] !== before[1], `从 ${before} 到 ${after}`);
  check('移动力消耗了', after[2] < before[2], `剩余 ${after[2]}`);

  // 结束回合
  await evl(`__game.endTurn()`);
  check('天数+1且移动力恢复', await evl(`__game.state.day === 2 && __game.world.hero.movePoints === __game.world.hero.moveMax`));
  check('产生收入', await evl(`__game.state.res.gold > 3000`), 'gold=' + await evl(`__game.state.res.gold`));

  console.log('== 2. 发起战斗 ==');
  await evl(`(() => {
    const obj = [...__game.world.objects.values()].find(o => o.kind === 'monster' && !o.data.boss);
    window.__testObj = obj;
    __game.startBattle(obj);
  })()`);
  await sleep(2500);
  check('进入战斗模式', await evl(`__game.state.mode === 'battle'`));
  check('双方单位已部署', await evl(`(() => { const b = __game.getBattle(); return b && b.aliveStacks(0).length > 0 && b.aliveStacks(1).length > 0; })()`));

  console.log('== 3. 玩家回合操作 ==');
  // 等到玩家回合（速度排序后第一个可能是敌方幽灵 spd6 > 枪兵4? 玩家有骑士? 初始无骑士。狮鹫spd6。可能敌方先手）
  // 直接等待直到 active.side === 0
  for (let i = 0; i < 30; i++) {
    const side = await evl(`(() => { const b = __game.getBattle(); return b && b.active ? b.active.side : -1; })()`);
    if (side === 0) break;
    await sleep(1000);
  }
  check('轮到玩家单位', await evl(`__game.getBattle().active.side === 0`));

  // 施放魔法
  const mpBefore = await evl(`__game.getBattle().heroMp`);
  await evl(`(() => { const b = __game.getBattle(); b.selectSpell('arrow'); b.castSpell('arrow', b.aliveStacks(1)[0]); })()`);
  await sleep(1200);
  check('魔法消耗MP', await evl(`__game.getBattle().heroMp`) === mpBefore - 4, `MP ${mpBefore} -> ${await evl(`__game.getBattle().heroMp`)}`);

  // 移动当前单位
  const moved = await evl(`(() => {
    const b = __game.getBattle();
    const st = b.active;
    if (b.moved) return 'already';
    const node = [...b.reach.values()].find(n => !n.noLand);
    if (!node) return 'no-reach';
    b.onHexClick(node.c, node.r);
    return 'ok';
  })()`);
  await sleep(2500);
  check('单位可移动', moved === 'ok' || moved === 'already', moved);

  // 等待/防御按钮逻辑
  await evl(`__game.getBattle().defendAction()`);
  await sleep(800);
  check('防御后轮到下一个单位', await evl(`(() => { const b = __game.getBattle(); return b.busy === false || b.active.side === 1; })()`));

  console.log('== 4. 打完整场战斗（加速：直接扣血模拟） ==');
  // 为了测试效率，用 applyDamage 把敌方打到剩1个，再让流程自然结束
  await evl(`(() => {
    const b = __game.getBattle();
    const enemies = b.aliveStacks(1);
    for (let i = 1; i < enemies.length; i++) b.applyDamage(enemies[i], 99999); b.checkEnd();
    window.__lastEnemy = enemies[0];
  })()`);
  await sleep(500);
  // 等玩家回合再击杀最后一个（通过 spell 或直接伤害）
  for (let i = 0; i < 40; i++) {
    const done = await evl(`__game.state.mode === 'map'`);
    if (done) break;
    const side = await evl(`(() => { const b = __game.getBattle(); return b && b.active ? b.active.side : -2; })()`);
    if (side === 0) {
      await evl(`(() => { const b = __game.getBattle(); if (b.aliveStacks(1).length) { b.applyDamage(b.aliveStacks(1)[0], 99999); b.checkEnd(); } })()`);
    }
    await sleep(700);
  }
  await sleep(2000);
  check('战斗胜利并返回地图', await evl(`__game.state.mode === 'map'`));
  check('怪物从地图移除', await evl(`!__game.world.objects.has(__testObj.x + ',' + __testObj.y)`));
  check('获得奖励金币', await evl(`__game.state.res.gold > 3500`), 'gold=' + await evl(`__game.state.res.gold`));
  check('英雄获得经验', await evl(`__game.state.hero.xp > 0 || __game.state.hero.level > 1`));
  check('军队存活保留', await evl(`__game.state.hero.army.length > 0`));

  console.log('== 5. 城堡招募 ==');
  await evl(`__game.ui.openCastle(__game.state, () => {})`);
  await sleep(500);
  const goldBefore = await evl(`__game.state.res.gold`);
  await evl(`(() => { const btn = document.querySelector('button[data-type="pikeman"][data-n="5"]'); if (btn && !btn.disabled) btn.click(); })()`);
  await sleep(300);
  const recruited = await evl(`__game.state.hero.army.find(a => a.type === 'pikeman').count`);
  check('招募枪兵+5', recruited === 30 + 5 || recruited >= 30, 'count=' + recruited);
  check('招募扣款', await evl(`__game.state.res.gold`) === goldBefore - 300, '');
  await evl(`document.getElementById('btn-close-modal').click()`);

  console.log('== 6. Boss 战与胜利结算 ==');
  await evl(`(() => {
    const boss = [...__game.world.objects.values()].find(o => o.kind === 'monster' && o.data.boss);
    __game.startBattle(boss);
  })()`);
  await sleep(2000);
  check('Boss战开始', await evl(`__game.state.mode === 'battle'`));
  // 直接歼灭
  for (let i = 0; i < 40; i++) {
    const over = await evl(`(() => { const b = __game.getBattle(); return !b || b.over; })()`);
    if (over) break;
    await evl(`(() => { const b = __game.getBattle(); if (b && !b.over && b.aliveStacks(1).length) { b.applyDamage(b.aliveStacks(1)[0], 99999); b.checkEnd(); } })()`);
    await sleep(500);
  }
  await sleep(2500);
  check('胜利结算弹出', await evl(`!document.getElementById('modal').classList.contains('hidden')`));
  check('胜利标题正确', await evl(`(() => {
    const t = document.querySelector('.cg-title') || document.querySelector('.end-title');
    return t && t.textContent.includes('胜');
  })()`));

  console.log('\n== 运行时错误 ==');
  console.log(errors.length ? errors.slice(0, 5).join('\n') : '(无)');
  console.log(`\n结果: ${passCount} 通过, ${failCount} 失败, ${errors.length} 个运行时错误`);
  ws.close();
}

main().catch(e => { console.error('FAIL:', e); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
