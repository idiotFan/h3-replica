// 通过 CDP 驱动 headless Chrome 做运行时冒烟测试
// 用法: node /tmp/homm_smoke.mjs <url> <等待秒数>
import { spawn } from 'node:child_process';

const url = process.argv[2];
const waitSec = parseFloat(process.argv[3] || '20');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, '--window-size=800,600', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(500);
  }
  throw new Error('无法连接 Chrome 调试端口');
}

const logs = [];
let idSeq = 1;
const pending = new Map();

async function main() {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown')
      logs.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 600));
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
      logs.push(msg.params.type.toUpperCase() + ': ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  };
  const send = (method, params = {}) => new Promise(res => {
    const id = idSeq++;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });

  const deadline = Date.now() + waitSec * 1000;
  let result = '';
  while (Date.now() < deadline) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', {
      expression: `document.getElementById('smoke') ? document.getElementById('smoke').textContent : '(no smoke div)'`,
      returnByValue: true,
    });
    result = r.result?.result?.value ?? '(eval fail)';
    if (result && result !== '(no smoke div)' && result !== '') break;
  }
  console.log('SMOKE_RESULT:', result || '(空)');
  console.log('LOGS:', logs.length ? '\n' + logs.join('\n') : '(无)');
  ws.close();
}

main().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => process.exit(), 500); });
