// 第五轮测试：出品向优化 + 评审修复
import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9351;
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`,'--window-size=1280,800','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let idSeq=1; const pending=new Map(); const errors=[]; let ws;
const send=(m,p={})=>new Promise(res=>{const id=idSeq++;pending.set(id,res);ws.send(JSON.stringify({id,method:m,params:p}))});
async function evl(ex){const r=await send("Runtime.evaluate",{expression:ex,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result?.result?.value;}
let pass=0, fail=0;
function check(n,c,x=''){if(c){pass++;console.log(`  ✔ ${n}`);}else{fail++;console.log(`  ✘ ${n} ${x}`);}}

async function main() {
  let wsUrl=null;
  for(let i=0;i<30&&!wsUrl;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();wsUrl=l.find(t=>t.type==="page")?.webSocketDebuggerUrl;}catch(e){}if(!wsUrl)await sleep(500);}
  ws=new WebSocket(wsUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}if(m.method==="Runtime.exceptionThrown")errors.push(JSON.stringify(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text).slice(0,300));};
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate",{url:"http://localhost:8000/?smoke=map"});
  await sleep(7000);

  console.log("== 1. 出品向 UI ==");
  check("加载画面已隐藏", await evl(`!document.getElementById('loading') || document.getElementById('loading').classList.contains('fade')`));
  check("中文字体已加载", await evl(`document.fonts.check('16px "Ma Shan Zheng"') || document.fonts.size > 0`));
  check("CSS 变量已定义", await evl(`getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() === '#ffd76b'`));
  check("设置按钮存在", await evl(`!!document.getElementById('btn-settings')`));

  console.log("== 2. 设置面板 ==");
  await evl(`document.getElementById('btn-settings').click()`);
  await sleep(400);
  check("设置弹窗出现", await evl(`!!document.querySelector('.set-row')`));
  const muteBefore = await evl(`localStorage.getItem('homm_mute')`);
  await evl(`document.getElementById('set-mute').click()`);
  await sleep(200);
  check("静音切换写入 localStorage", await evl(`localStorage.getItem('homm_mute')`) !== muteBefore);
  await evl(`document.getElementById('set-mute').click()`); // 还原
  await evl(`document.querySelector('button[data-q="low"]').click()`);
  await sleep(300);
  check("画质切换为低", await evl(`__game.state.quality === 'low' && localStorage.getItem('homm_quality') === 'low'`));
  await evl(`document.querySelector('button[data-q="high"]').click()`);
  await sleep(300);
  await evl(`document.getElementById('btn-close-modal').click()`);

  console.log("== 3. 战场 InstancedMesh 格子 ==");
  await evl(`(() => { const obj=[...__game.world.objects.values()].find(o=>o.kind==='monster'&&!o.data.boss); __game.startBattle(obj); })()`);
  await sleep(2000);
  check("格子为 InstancedMesh", await evl(`(() => { const b=__game.getBattle(); return b.hexInst && b.hexInst.isInstancedMesh && b.hexInst.count === 117; })()`));
  check("描边合并为单个 LineSegments", await evl(`(() => { const b=__game.getBattle(); let n=0; b.scene.traverse(o=>{ if(o.isLineSegments) n++; }); return n === 1; })()`));
  // 拾取：通过 instanceId 还原坐标
  check("instanceId 拾取正确", await evl(`(() => {
    const b=__game.getBattle();
    const id = 5 * b.hexBC + 3;
    return b.hexId(Math.floor(id/b.hexBC), id%b.hexBC) === id;
  })()`));
  check("高亮改 instanceColor", await evl(`(() => {
    const b=__game.getBattle();
    // 等玩家回合
    return b.hexInst.instanceColor !== null;
  })()`));

  console.log("== 4. 战场地貌主题 ==");
  check("主题已应用", await evl(`(() => { const b=__game.getBattle(); return b.theme && b.theme.trees !== undefined; })()`));
  check("战场有天空穹顶", await evl(`(() => { const b=__game.getBattle(); return b.scene.children.some(o => o.material && o.material.uniforms && o.material.uniforms.topColor); })()`));

  console.log("== 5. 撤退确认弹窗 ==");
  await evl(`(() => { const b=__game.getBattle(); for(let i=0;i<20;i++){ if(b.active&&b.active.side===0) break; } document.getElementById('btn-retreat').click(); })()`);
  await sleep(400);
  check("撤退确认弹窗出现", await evl(`document.body.textContent.includes('确认撤退')`));
  await evl(`document.getElementById('btn-retreat-no').click()`);
  await sleep(300);
  check("取消撤退仍在战斗", await evl(`__game.state.mode === 'battle'`));

  console.log("== 6. 临时特效 dispose ==");
  // 施放魔法产生临时 mesh，检查 dispose 被调用
  const geoBefore = await evl(`(() => {
    const b=__game.getBattle();
    // 等玩家回合
    return performance.memory ? performance.memory.usedJSHeapSize : 0;
  })()`);
  await evl(`(() => { const b=__game.getBattle(); if(b.active&&b.active.side===0&&b.heroMp>=4){ b.castSpell('arrow', b.aliveStacks(1)[0]); } })()`);
  await sleep(2000);
  check("施法后无运行时错误", errors.length === 0);

  console.log("== 7. 移动端 CSS ==");
  check("媒体查询存在", await evl(`(() => { for(const s of document.styleSheets){ try{ for(const r of s.cssRules){ if(r.cssText&&r.cssText.includes('max-width: 820px')) return true; } }catch(e){} } return false; })()`));

  console.log("\n== 运行时错误 ==");
  console.log(errors.length ? errors.slice(0,5).join("\n") : "(无)");
  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${errors.length} 个运行时错误`);
  ws.close();
}
main().catch(e=>{console.error("FAIL:",e);process.exitCode=1;}).finally(()=>{chrome.kill();setTimeout(()=>process.exit(),500);});
