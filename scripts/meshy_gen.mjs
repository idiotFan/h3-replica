// ================= Meshy AI 3D 模型生成脚本 =================
// 用法: MESHY_API_KEY=msy_xxx node scripts/meshy_gen.mjs "<prompt>" "<输出glb路径>" [texture_prompt]
// 文档: https://docs.meshy.ai/api-text-to-3d-beta
import { writeFile } from 'node:fs/promises';

const [prompt, outPath, texturePrompt] = process.argv.slice(2);
const API_KEY = process.env.MESHY_API_KEY;
const BASE = 'https://api.meshy.ai/openapi/v2/text-to-3d';

if (!API_KEY) { console.error('错误：未设置 MESHY_API_KEY 环境变量'); process.exit(1); }
if (!prompt || !outPath) { console.error('用法: node meshy_gen.mjs "<prompt>" "<输出glb路径>" [texture_prompt]'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const headers = { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

async function post(body) {
  const r = await fetch(BASE, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`POST 失败 ${r.status}: ${t}`); }
  return r.json();
}

async function get(id) {
  const r = await fetch(`${BASE}/${id}`, { headers });
  if (!r.ok) { const t = await r.text(); throw new Error(`GET 失败 ${r.status}: ${t}`); }
  return r.json();
}

async function poll(id, phase) {
  for (let i = 0; i < 120; i++) {            // 最多等 10 分钟
    const t = await get(id);
    process.stdout.write(`\r[${phase}] 进度 ${t.progress}% 状态 ${t.status}    `);
    if (t.status === 'SUCCEEDED') { console.log(''); return t; }
    if (t.status === 'FAILED') { throw new Error(`${phase} 失败: ${t.task_error?.message || '未知'}`); }
    await sleep(5000);
  }
  throw new Error(`${phase} 超时`);
}

async function download(url, path) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`下载失败 ${r.status}`);
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  await writeFile(path, buf);
  console.log(`已下载 ${(buf.length / 1024).toFixed(1)} KB → ${path}`);
}

async function main() {
  console.log(`=== Meshy 3D 生成 ===`);
  console.log(`Prompt: ${prompt}`);
  console.log(`输出: ${outPath}`);
  console.log();

  // 第 1 步：preview（lowpoly 保持本项目风格统一）
  console.log('[1/4] 创建 preview 任务（lowpoly 模式）...');
  const previewBody = {
    mode: 'preview',
    prompt,
    model_type: 'lowpoly',          // 本项目固定 lowpoly
    target_formats: ['glb'],
    pose_mode: '',
  };
  const { result: previewId } = await post(previewBody);
  console.log(`preview_task_id: ${previewId}`);

  // 第 2 步：轮询 preview
  console.log('[2/4] 等待 preview 完成...');
  await poll(previewId, 'preview');

  // 第 3 步：refine（添加 PBR 贴图）
  console.log('[3/4] 创建 refine 任务（PBR 贴图）...');
  const refineBody = {
    mode: 'refine',
    preview_task_id: previewId,
    enable_pbr: true,
    target_formats: ['glb'],
    remove_lighting: true,          // 移除烘焙光照，游戏引擎自定义光照
  };
  if (texturePrompt) refineBody.texture_prompt = texturePrompt;
  const { result: refineId } = await post(refineBody);
  console.log(`refine_task_id: ${refineId}`);

  // 第 4 步：轮询 refine + 下载
  console.log('[4/4] 等待 refine 完成...');
  const refined = await poll(refineId, 'refine');
  if (!refined.model_urls?.glb) throw new Error('响应缺少 model_urls.glb');
  await download(refined.model_urls.glb, outPath);
  console.log();
  console.log('=== 完成 ===');
  console.log(`消耗 credits: preview ${refined.consumed_credits || '?'} + refine (见账户）`);
}

main().catch(e => { console.error('\n错误:', e.message); process.exit(1); });
