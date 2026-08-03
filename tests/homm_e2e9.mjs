// 第 9 轮：战争迷雾遮挡正确性
//
// 修的 bug：用户报告「城堡是个大黑块」。
// 根因不是城堡模型/材质（实测贴图、法线、颜色全正常），而是迷雾平面的两个属性叠加：
//   1. depthTest: false  → 平面无视深度，永远画在所有物体之上
//   2. 平面压在固定的 y=0.12 → 与地形起伏无关
// 后果：从低角度看，远处未探索格的近黑色雾会糊在投影到同一屏幕位置的近处高物体上。
// 城堡是场上最高的物体，整个上半截被抹黑 —— 实测城堡区域纯黑像素占比 30%。
//
// 修法（两条缺一不可）：
//   A. depthTest 改 true，让更近的物体正确遮挡雾
//   B. 迷雾平面改为贴合地形起伏（复用 this.vh 逐顶点高度）
//      —— 只做 A 不做 B 的话，地形高于 0.12 的地方会赢深度测试，未探索区反而露出来
//   C. 未探索区的植被（InstancedMesh 无法按格 visible）改由 _updateVegetationFog()
//      把实例矩阵清零来隐藏；对象本就有 o.mesh.visible = expl，无需额外处理
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9342;
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
  await send('Page.navigate', { url: 'http://localhost:8000/?smoke=map' });
  let ready = false;
  for (let i = 0; i < 60; i++) { if (await evl(`!!(window.__game && __game.state.mode === 'map')`)) { ready = true; break; } await sleep(500); }
  check('地图就绪', ready);
  await sleep(3000);

  console.log('== 1. 迷雾平面配置 ==');
  const cfg = await evl(`(() => {
    const f = __game.world.fogMesh, pos = f.geometry.attributes.position;
    let minY = 1e9, maxY = -1e9;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { depthTest: f.material.depthTest, count: pos.count, spread: +(maxY - minY).toFixed(2) };
  })()`);
  check('depthTest 已开启（关掉会糊住城堡）', cfg.depthTest === true, `实际 ${cfg.depthTest}`);
  check('迷雾平面有细分（非单片平面）', cfg.count > 100, `顶点数 ${cfg.count}`);
  check('迷雾贴合地形起伏', cfg.spread > 0.5, `高度跨度 ${cfg.spread}`);

  console.log('== 2. 未探索区植被逐实例隐藏 ==');
  const veg = await evl(`(() => {
    const w = __game.world;
    if (!w._veg) return { err: '_veg 未初始化' };
    let tot = 0, should = 0, mis = 0;
    for (const g of w._veg) {
      const n = g.tileOf.length / 2; tot += n;
      for (let i = 0; i < n; i++) {
        const x = g.tileOf[i * 2], y = g.tileOf[i * 2 + 1];
        const expl = !!(w.explored[x] && w.explored[x][y]);
        if (!expl) should++;
        const hidden = !!(g.hidden && g.hidden[i] === 1);
        if (hidden !== !expl) mis++;
      }
    }
    return { tot, should, mis };
  })()`);
  check('植被实例已建立地块映射', !veg.err, veg.err || '');
  check(`每个实例的隐藏状态都与探索状态一致 (${veg.tot} 个)`, veg.mis === 0, `不一致 ${veg.mis}`);

  console.log('== 3. 城堡不再被迷雾抹黑（离屏渲染实测像素）==');
  const px = await evl(`(async () => {
    const THREE = await import('three');
    const w = __game.world, scene = w.scene;
    const c = [...w.objects.values()].find(o => o.kind === 'castle');
    if (!c) return { err: '没找到城堡' };
    const p = c.mesh.position, W = 400, H = 300;
    const rr = new THREE.WebGLRenderer({ antialias: false });
    rr.setSize(W, H); rr.outputColorSpace = THREE.SRGBColorSpace;
    rr.toneMapping = THREE.ACESFilmicToneMapping; rr.toneMappingExposure = 1.15;
    // 低角度、城堡背后正对未探索区 —— 正是暴露该 bug 的机位
    const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
    cam.position.set(p.x + 2, p.y + 3.2, p.z + 11);
    cam.lookAt(p.x, p.y + 1.3, p.z);
    const meas = (dt) => {
      w.fogMesh.material.depthTest = dt; w.fogMesh.material.needsUpdate = true;
      const rt = new THREE.WebGLRenderTarget(W, H);
      rr.setRenderTarget(rt); rr.render(scene, cam); rr.setRenderTarget(null);
      const b = new Uint8Array(W * H * 4);
      rr.readRenderTargetPixels(rt, 0, 0, W, H, b);
      let blk = 0, n = 0;
      for (let y = Math.floor(H * 0.30); y < H * 0.72; y++)
        for (let x = Math.floor(W * 0.30); x < W * 0.70; x++) {
          const i = (y * W + x) * 4; n++;
          if (b[i] < 25 && b[i + 1] < 25 && b[i + 2] < 25) blk++;
        }
      rt.dispose();
      return +(blk / n * 100).toFixed(1);
    };
    const bad = meas(false), good = meas(true);
    w.fogMesh.material.depthTest = true; w.fogMesh.material.needsUpdate = true;   // 还原
    rr.dispose();
    return { bad, good };
  })()`);
  check('能取到城堡像素', !px.err, px.err || '');
  // ⚠ 用相对判据而非固定百分点差：地图是程序化随机生成的，城堡与未探索区的
  // 相对位置每局都不同，实测差值在 4.5～14.5 个百分点间浮动，写死 5 会偶发误报。
  check(`城堡区域黑色占比显著低于 depthTest=false 时 (${px.good}% vs ${px.bad}%)`,
        px.good <= px.bad * 0.9, `期望至少相对降低 10%`);
  check(`城堡区域黑色占比 < 25%`, px.good < 25, `实际 ${px.good}%`);

  console.log('\n== 运行时错误 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${errors.length} 个运行时错误`);
  if (fail || errors.length) process.exitCode = 1;
  ws.close();
}
main().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
