// 第 7 轮：模型朝向回归测试
//
// 背景：曾有一个隐蔽 bug —— lookAt() 之后，颠簸/摇晃动画直接给
// mesh.rotation.x / .z 单独赋值。three.js 对含 -Z 分量（朝北）的朝向，
// 欧拉 XYZ 分解是 (±180°, 180°−θ, ±180°) 这种退化表示，单独赋值会丢掉
// 那对 ±180°，导致朝向绕世界 X 轴镜像：
//     正北 180° 误差（倒着走）、东北/西北 90°（横着走）、东西南正常。
// 正因为东西向正常，只测两三个方向根本发现不了 —— 必须八方向全测。
//
// 修法：倾斜写到 factory.js finalize() 保证存在的子节点 userData.animNode，
//       与 lookAt 控制的本体解耦（utils.js 的 tiltNode()）。
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9340;
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

async function waitMapReady(timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await evl(`!!(window.__game && __game.world && __game.world.built && __game.state.mode === 'map')`)) return true; } catch (e) {}
    await sleep(300);
  }
  return false;
}

// 对某个 mesh 做八方向朝向检测：lookAt 后写入倾斜，再量世界前向量与目标方向夹角
const FACING_PROBE = (meshExpr) => `(() => {
  const m = ${meshExpr};
  if (!m) return null;
  const V = m.position.constructor, Q = m.quaternion.constructor;
  const dirs = { E:[1,0], W:[-1,0], S:[0,1], N:[0,-1], NE:[1,-1], NW:[-1,-1], SE:[1,1], SW:[-1,1] };
  const res = {};
  for (const [name, d] of Object.entries(dirs)) {
    const p = m.position;
    m.lookAt(p.x + d[0] * 5, p.y, p.z + d[1] * 5);
    // 复现待机/行走动画对倾斜节点的写入（这正是曾经破坏朝向的操作）
    const t = (m.userData && m.userData.animNode) || m;
    t.rotation.x = 0.015; t.rotation.z = 0.01;
    m.updateMatrixWorld(true);
    const fwd = new V(0, 0, 1).applyQuaternion(m.getWorldQuaternion(new Q()));
    const f2 = new V(fwd.x, 0, fwd.z).normalize();
    const want = new V(d[0], 0, d[1]).normalize();
    res[name] = +(Math.acos(Math.max(-1, Math.min(1, f2.dot(want)))) * 180 / Math.PI).toFixed(1);
  }
  return res;
})()`;

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
  await sleep(1500);

  console.log('== 1. 结构：glb 模型必须有独立的倾斜动画节点 ==');
  check('英雄有 animNode 且不是本体', await evl(`(() => {
    const m = __game.world.heroMesh;
    return !!(m.userData.fromGltf && m.userData.animNode && m.userData.animNode !== m);
  })()`));
  check('野怪有 animNode 且不是本体', await evl(`(() => {
    const o = [...__game.world.objects.values()].find(x => x.kind === 'monster' && x.mesh.userData.fromGltf);
    return !o || !!(o.mesh.userData.animNode && o.mesh.userData.animNode !== o.mesh);
  })()`));

  console.log('== 2. 玩家英雄八方向朝向 ==');
  const hero = await evl(FACING_PROBE('__game.world.heroMesh'));
  for (const [dir, err] of Object.entries(hero || {})) {
    check(`英雄朝 ${dir} 误差 ${err}°`, err < 1, `(期望 <1°)`);
  }

  console.log('== 3. 战场单位八方向朝向 ==');
  await evl(`(() => {
    const obj = [...__game.world.objects.values()].find(o => o.kind === 'monster' && !o.data.boss);
    __game.startBattle(obj); return true;
  })()`);
  for (let i = 0; i < 40; i++) { if (await evl(`!!__game.getBattle()`)) break; await sleep(500); }
  await sleep(2000);
  const unit = await evl(FACING_PROBE('(__game.getBattle() && __game.getBattle().stacks.find(s => s.alive && s.mesh.userData.fromGltf) || {}).mesh'));
  if (!unit) check('战场单位可测', false, '(没有 glb 单位)');
  else for (const [dir, err] of Object.entries(unit)) {
    check(`战场单位朝 ${dir} 误差 ${err}°`, err < 1, `(期望 <1°)`);
  }

  console.log('\n== 运行时错误 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${errors.length} 个运行时错误`);
  if (fail || errors.length) process.exitCode = 1;
  ws.close();
}
main().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
