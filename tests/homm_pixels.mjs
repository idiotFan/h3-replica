// 渲染像素分析：验证画面不是黑屏/单色，且色彩分布合理
import { spawn } from 'node:child_process';
const [url, waitSec] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9336;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let idSeq = 1; const pending = new Map(); let ws;
const send = (m, p = {}) => new Promise(res => { const id = idSeq++; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
async function main() {
  let wsUrl = null;
  for (let i = 0; i < 30 && !wsUrl; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch (e) {}
    if (!wsUrl) await sleep(500);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(parseFloat(waitSec) * 1000);
  const r = await send('Runtime.evaluate', { expression: `(() => {
    const c = document.querySelector('#game canvas');
    if (!c) return { err: 'no canvas' };
    const t = document.createElement('canvas');
    t.width = 160; t.height = 100;
    const ctx = t.getContext('2d');
    ctx.drawImage(c, 0, 0, 160, 100);
    const d = ctx.getImageData(0, 0, 160, 100).data;
    const colors = new Set(); let bright = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      colors.add((d[i] >> 4) + ',' + (d[i+1] >> 4) + ',' + (d[i+2] >> 4));
      bright += (d[i] + d[i+1] + d[i+2]) / 3; n++;
    }
    return { w: c.width, h: c.height, uniqColors: colors.size, avgBright: Math.round(bright / n) };
  })()`, returnByValue: true });
  console.log('PIXELS:', JSON.stringify(r.result?.result?.value));
  ws.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
