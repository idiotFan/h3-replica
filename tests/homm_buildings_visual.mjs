// 建筑 glb 视觉回归：确认 fromGltf + 截图 + 材质不过黑
// 用法: node tests/homm_buildings_visual.mjs [baseUrl]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8000';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9355;
const OUT = join(process.cwd(), 'art', 'preview', 'buildings_test');
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let idSeq = 1;
const pending = new Map();
let ws;
const send = (m, p = {}) => new Promise(res => {
  const id = idSeq++;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method: m, params: p }));
});

async function main() {
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = list.find(t => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* retry */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error('Chrome CDP 未就绪');

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `${BASE}/?smoke=map&t=${Date.now()}` });
  await sleep(10000);

  const info = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const g = window.__game;
      if (!g?.world?.objects) return { err: 'no world' };
      const w = g.world;
      if (w.fogMesh) w.fogMesh.visible = false;
      const list = [];
      for (const o of w.objects.values()) {
        if (!['castle','enemyCastle','mine'].includes(o.kind)) continue;
        let mesh = null, mat = null;
        o.mesh?.traverse(c => {
          if (c.isMesh && c.material?.map && !mesh) { mesh = c; mat = c.material; }
        });
        let min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
        o.mesh?.traverse(c => {
          if (!c.isMesh || !c.geometry) return;
          c.geometry.computeBoundingBox();
          const b = c.geometry.boundingBox.clone();
          b.applyMatrix4(c.matrixWorld);
          min = [Math.min(min[0],b.min.x), Math.min(min[1],b.min.y), Math.min(min[2],b.min.z)];
          max = [Math.max(max[0],b.max.x), Math.max(max[1],b.max.y), Math.max(max[2],b.max.z)];
        });
        const size = max.map((v,i) => +(v - min[i]).toFixed(2));
        list.push({
          kind: o.kind,
          mine: o.data?.mine || null,
          fromGltf: !!o.mesh?.userData?.fromGltf,
          visible: !!o.mesh?.visible,
          pos: o.mesh?.position?.toArray?.()?.map(n => +n.toFixed(2)),
          size,
          height: size[1],
          metal: mat?.metalness,
          rough: mat?.roughness,
          hasMap: !!mat?.map,
          color: mat?.color?.getHexString?.(),
        });
      }
      return { count: list.length, list };
    })()`,
  });

  const data = info.result?.result?.value;
  if (!data || data.err) throw new Error('inspect failed: ' + JSON.stringify(data));

  const fails = [];
  for (const b of data.list) {
    if (!b.fromGltf) fails.push(`${b.kind}/${b.mine}: not fromGltf (fallback primitive)`);
    if (!b.hasMap) fails.push(`${b.kind}/${b.mine}: no baseColor map`);
    if (typeof b.metal === 'number' && b.metal > 0.4) fails.push(`${b.kind}/${b.mine}: metalness too high ${b.metal}`);
    if (b.kind.includes('castle') && b.height < 2.0) fails.push(`${b.kind}: height ${b.height} too small`);
    if (b.kind === 'mine' && b.height < 1.0) fails.push(`${b.kind}/${b.mine}: height ${b.height} too small`);
  }
  if (data.count < 5) fails.push(`building count ${data.count} < 5`);

  console.log('BUILDINGS:', JSON.stringify(data.list, null, 2));

  // screenshot each building
  for (const b of data.list) {
    const tag = b.mine ? `mine_${b.mine}` : b.kind;
    await send('Runtime.evaluate', {
      expression: `(() => {
        const g = window.__game, w = g.world;
        const cam = g.getCamPos(), tgt = g.getCamTarget();
        const o = [...w.objects.values()].find(x =>
          x.kind === ${JSON.stringify(b.kind)} &&
          ${b.mine ? `x.data?.mine === ${JSON.stringify(b.mine)}` : 'true'}
        );
        if (!o?.mesh) return;
        o.mesh.visible = true;
        const p = o.mesh.position;
        tgt.set(p.x, 1.2, p.z);
        cam.set(p.x + 6, 7, p.z + 9);
      })()`,
    });
    await sleep(600);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `${tag}.png`);
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('SHOT', file);
  }

  if (fails.length) {
    console.error('FAIL:\\n' + fails.map(f => ' - ' + f).join('\\n'));
    process.exitCode = 1;
  } else {
    console.log('OK: all', data.count, 'buildings fromGltf, sized, materials ok');
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(process.exitCode || 0), 400); });
