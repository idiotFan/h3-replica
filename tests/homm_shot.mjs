// 截图工具: node homm_shot.mjs <url> <等待秒> <输出png> [前置JS]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [url, waitSec, out, preJs] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,800', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
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
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(parseFloat(waitSec) * 1000);
  if (preJs) { await send('Runtime.evaluate', { expression: preJs, awaitPromise: true }); await sleep(2500); }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
