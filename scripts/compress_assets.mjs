#!/usr/bin/env node
// ================= glb 资产压缩管线 =================
// 把 art/_src/ 下的原始 Meshy 模型压成可上线的 art/export/**.glb
//
// 用法：
//   npm run compress:assets -- --format webp             # 线上这批就是这么出的
//   npm run compress:assets:dry                          # 只算不写
//   node scripts/compress_assets.mjs --only pikeman,dragon
//   node scripts/compress_assets.mjs art/export/units/pikeman2.glb   # 单文件原地压
//
// 设计要点：
//  * 永远从 art/_src（原始副本）读，写到 art/export。压缩不可逆，所以重跑不会二次劣化；
//    art/_src 已进 .gitignore，是这批 Meshy 原件唯一的副本，别删。
//  * 只输出 three r160 GLTFLoader 无需额外解码器就能读的东西：
//    不用 Draco / meshopt（js/assets/loader.js 没有配 DRACOLoader / MeshoptDecoder），
//    不用 KHR_texture_basisu。默认 JPEG；--format webp 走 EXT_texture_webp（r160 原生支持，
//    已在真实浏览器里验证 12/12 加载通过）。
//  * emissiveTexture 一律删且 emissiveFactor 归零，否则会顶穿 Bloom threshold 0.85。
//  * metallicRoughness 按实测数据决定去留，不一刀切——理由见 normalizeMaterials 的注释。
//  * 面数预算直接读 js/assets/manifest.js 的 polyBudget，单一事实来源。

import { writeFileSync, mkdirSync, statSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, weld, simplify } from '@gltf-transform/functions';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------- CLI ----------------

const DEFAULTS = {
  src: 'art/_src',            // 原始模型备份目录（唯一真源）
  out: 'art/export',          // 输出目录
  in: null,                   // 指定输入文件/目录，覆盖 src
  format: 'jpeg',             // jpeg | webp
  quality: 80,                // baseColor 质量
  normalQuality: 85,          // 法线贴图质量（法线图对压缩噪声更敏感）
  textureSize: 512,           // 普通单位贴图边长
  heroTextureSize: 1024,      // 英雄 / 龙 贴图边长
  bigTextureAssets: 'hero_player,hero_enemy,dragon',
  mrSize: 256,                // metallicRoughness 是低频遮罩，256 足够
  mrQuality: 90,              // MR 是数据不是颜色，质量给高一点
  mrFlatThreshold: 0.05,      // 金属度/粗糙度通道标准差低于此值就退化成标量
  simplifyError: 0.05,        // meshopt 允许的最大几何误差（够大才能收敛到 ratio）
  defaultBudget: 2000,        // manifest 里查不到 polyBudget 时的兜底面数
  metallic: null,             // 退化成标量时的金属度；null = 用 MR 贴图实测均值
  roughness: null,
  keepEmissive: false,
  dropMetallicRoughness: false,
  keepNormal: true,
  only: null,                 // 逗号分隔的资产名白名单
  exclude: null,              // 逗号分隔的资产名/子目录名黑名单
  allowNewDirs: false,        // 允许在 --out 下新建目录（默认拒绝，防止写到游戏不引用的路径）
  dryRun: false,
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq === -1 ? a.slice(2) : a.slice(2, eq));
    let val = eq === -1 ? undefined : a.slice(eq + 1);
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const needsValue = !['dry-run', 'dryRun', 'keep-emissive', 'keepEmissive',
      'drop-metallic-roughness', 'dropMetallicRoughness', 'no-normal',
      'allow-new-dirs', 'allowNewDirs', 'help'].includes(key);
    if (needsValue && val === undefined) val = argv[++i];

    switch (camel) {
      case 'help': usage(); process.exit(0); break;
      case 'dryRun': opts.dryRun = true; break;
      case 'allowNewDirs': opts.allowNewDirs = true; break;
      case 'keepEmissive': opts.keepEmissive = true; break;
      case 'dropMetallicRoughness': opts.dropMetallicRoughness = true; break;
      case 'noNormal': opts.keepNormal = false; break;
      case 'quality': case 'normalQuality': case 'textureSize':
      case 'heroTextureSize': case 'defaultBudget':
      case 'mrSize': case 'mrQuality':
        opts[camel] = Number(val); break;
      case 'simplifyError': case 'metallic': case 'roughness': case 'mrFlatThreshold':
        opts[camel] = Number(val); break;
      case 'in':
        // 可重复：--in a --in b 会累加，不是后者覆盖前者
        opts.in = opts.in ? [].concat(opts.in, val) : val;
        break;
      default:
        if (!(camel in opts)) { console.error(`未知参数: --${key}`); usage(); process.exit(1); }
        opts[camel] = val;
    }
  }
  if (positional.length) opts.in = opts.in ? [].concat(opts.in, positional) : positional;
  if (!['jpeg', 'webp'].includes(opts.format)) {
    console.error(`--format 只支持 jpeg | webp，收到 ${opts.format}`); process.exit(1);
  }
  return opts;
}

function usage() {
  console.log(`
glb 压缩管线

  node scripts/compress_assets.mjs [选项] [输入文件或目录...]

选项
  --src <dir>               原始模型目录，默认 art/_src
  --out <dir>               输出目录，默认 art/export
  --in <path>               指定单个文件/目录（覆盖 --src）
  --only a,b,c              只处理这些资产名（不含扩展名）
  --exclude a,b             跳过这些资产名或子目录名
  --allow-new-dirs          允许在 --out 下新建目录（默认拒绝，防止写出游戏不引用的资产）
  --format jpeg|webp        贴图格式，默认 jpeg（webp 走 EXT_texture_webp，three r160 原生支持）
  --quality <n>             baseColor 质量，默认 80
  --normal-quality <n>      法线贴图质量，默认 85
  --texture-size <n>        普通单位贴图边长，默认 512
  --hero-texture-size <n>   大模型贴图边长，默认 1024
  --big-texture-assets a,b  用大贴图的资产名，默认 hero_player,hero_enemy,dragon
  --mr-size <n>             metallicRoughness 贴图边长，默认 256
  --mr-quality <n>          metallicRoughness 质量，默认 90
  --mr-flat-threshold <n>   MR 通道 sd 低于此值就退化成标量，默认 0.05
  --simplify-error <n>      meshopt 最大几何误差，默认 0.05
  --default-budget <n>      manifest 无 polyBudget 时的兜底面数，默认 2000
  --metallic <n>            强制金属度标量（默认用 MR 贴图实测均值）
  --roughness <n>           强制粗糙度标量（默认用 MR 贴图实测均值）
  --keep-emissive           保留 emissiveTexture（默认删，会误触 Bloom）
  --drop-metallic-roughness 无条件删掉 MR 贴图（默认只在通道近似常数时删）
  --no-normal               连法线贴图一起删
  --dry-run                 只统计不写盘
`.trim());
}

// ---------------- manifest 面数预算 ----------------

/** 从 js/assets/manifest.js 读 polyBudget，key 用 glb 文件名（不含扩展名） */
async function loadPolyBudgets() {
  const manifestPath = join(ROOT, 'js/assets/manifest.js');
  const budgets = new Map();
  try {
    const mod = await import(pathToFileURL(manifestPath).href);
    for (const group of [mod.UNIT_ASSETS, mod.HERO_ASSETS, mod.BUILDING_ASSETS]) {
      for (const def of Object.values(group || {})) {
        if (!def?.path) continue;
        budgets.set(basename(def.path, '.glb'), def.polyBudget);
      }
    }
  } catch (err) {
    console.warn(`[warn] 读不到 manifest.js（${err.message}），面数预算走 --default-budget`);
  }
  return budgets;
}

// ---------------- 收集输入 ----------------

/** 返回 [{ abs, rel }]，rel 是相对各自输入根的路径，用于在 --out 下镜像目录结构 */
function collectInputs(opts) {
  const roots = Array.isArray(opts.in) ? opts.in : [opts.in ?? opts.src];
  /** @type {{abs:string, rel:string}[]} */
  const entries = [];
  for (const r of roots) {
    const abs = resolve(ROOT, r);
    if (!existsSync(abs)) { console.error(`输入不存在: ${abs}`); process.exit(1); }
    if (statSync(abs).isDirectory()) {
      const found = [];
      walk(abs, found);
      for (const f of found) entries.push({ abs: f, rel: relative(abs, f) });
    } else {
      // 单文件的输出位置：
      //  1) 在 --src 里 -> 镜像到 --out 的同名相对路径
      //  2) 已经在 --out 里 -> 原地覆盖（压缩别人刚生成到 art/export 的模型时走这条）
      //  3) 其它 -> 落到 --out 根下
      const fromSrc = relative(resolve(ROOT, opts.src), abs);
      const fromOut = relative(resolve(ROOT, opts.out), abs);
      const rel = !fromSrc.startsWith('..') ? fromSrc
        : !fromOut.startsWith('..') ? fromOut
          : basename(abs);
      entries.push({ abs, rel });
    }
  }
  const list = (v) => new Set(String(v ?? '').split(',').map(s => s.trim()).filter(Boolean));
  const only = opts.only ? list(opts.only) : null;
  const exclude = list(opts.exclude);
  return entries
    .filter(e => extname(e.abs).toLowerCase() === '.glb')      // 不碰 .bak / .bak2
    .filter(e => !only || only.has(basename(e.abs, '.glb')))
    .filter(e => !e.rel.split(/[\\/]/).some(seg => exclude.has(seg.replace(/\.glb$/, ''))))
    .sort((a, b) => a.abs.localeCompare(b.abs));
}

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
}

// ---------------- 单个模型的处理 ----------------

function countTris(root) {
  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (idx) tris += idx.getCount() / 3;
      else if (pos) tris += pos.getCount() / 3;
    }
  }
  return Math.round(tris);
}

/** 取贴图各通道的归一化 mean/stdev（0..1） */
async function channelStats(tex) {
  const { channels } = await sharp(Buffer.from(tex.getImage())).stats();
  return channels.map(c => ({ mean: c.mean / 255, sd: c.stdev / 255 }));
}

/**
 * 删掉对本项目有害/无收益的贴图通道，改用标量。
 *
 * emissive 一律删：Meshy 给的是 emissiveFactor=[1,1,1] + emissiveTexture，
 * 配合 main.js 的 UnrealBloom threshold 0.85 会让整个模型糊成一团光
 * （js/assets/factory.js 的 normalizeSingleMeshMaterial 是运行时第二道保险）。
 *
 * metallicRoughness 看实测数据决定，不一刀切：这批模型是「单 mesh 单材质」，
 * MR 贴图的 B 通道就是唯一区分「盔甲 / 皮肤布料」的遮罩，而 main.js 专门建了
 * PMREM 环境贴图来让金属有反射。实测 pikeman 的金属度通道 sd=0.467、取值 0↔1
 * 双峰，拍任何单一标量都会把盔甲弄成塑料；wolf/dragon 则 sd≈0.001 确实是常数。
 * 所以：通道近似常数 -> 退化成标量并删图；否则保留但压到 --mr-size（约 15KB）。
 */
async function normalizeMaterials(root, opts) {
  const dropped = [];
  const notes = [];
  for (const mat of root.listMaterials()) {
    if (!opts.keepEmissive) {
      if (mat.getEmissiveTexture()) { mat.setEmissiveTexture(null); dropped.push('emissive'); }
      // 必须归零：留着 [1,1,1] 会让整个模型自发光全白
      mat.setEmissiveFactor([0, 0, 0]);
    }

    const mr = mat.getMetallicRoughnessTexture();
    if (mr) {
      // glTF 约定：G = roughness，B = metalness
      const st = await channelStats(mr);
      const rough = st[1] ?? { mean: mat.getRoughnessFactor(), sd: 0 };
      const metal = st[2] ?? { mean: mat.getMetallicFactor(), sd: 0 };
      const flat = rough.sd <= opts.mrFlatThreshold && metal.sd <= opts.mrFlatThreshold;
      if (opts.dropMetallicRoughness || flat) {
        mat.setMetallicRoughnessTexture(null);
        dropped.push('metallicRoughness');
        // 用实测均值当标量，保留原始的整体质感；--metallic/--roughness 可强制覆盖
        mat.setMetallicFactor(opts.metallic ?? +(metal.mean * mat.getMetallicFactor()).toFixed(3));
        mat.setRoughnessFactor(opts.roughness ?? +(rough.mean * mat.getRoughnessFactor()).toFixed(3));
        notes.push(`MR→标量(m=${mat.getMetallicFactor()},r=${mat.getRoughnessFactor()})`);
      } else {
        notes.push(`MR保留@${opts.mrSize}(metal sd=${metal.sd.toFixed(2)})`);
      }
    }

    if (!opts.keepNormal && mat.getNormalTexture()) {
      mat.setNormalTexture(null);
      dropped.push('normal');
    }
    if (mat.getOcclusionTexture()) { mat.setOcclusionTexture(null); dropped.push('occlusion'); }
  }
  return { dropped: [...new Set(dropped)], notes: [...new Set(notes)] };
}

/**
 * 贴图 resize + 重编码。三种槽位分别对待：
 *  baseColor —— 颜色，可以吃 4:2:0 色度下采样
 *  normal    —— 数据，禁用色度下采样，质量给高一点
 *  metallicRoughness —— 数据且是低频遮罩，尺寸压到 --mr-size 但质量给高
 */
async function recompressTextures(doc, size, opts) {
  const root = doc.getRoot();
  const roleOf = new Map();
  for (const mat of root.listMaterials()) {
    const n = mat.getNormalTexture(); if (n) roleOf.set(n, 'normal');
    const m = mat.getMetallicRoughnessTexture(); if (m) roleOf.set(m, 'metallicRoughness');
    const b = mat.getBaseColorTexture(); if (b && !roleOf.has(b)) roleOf.set(b, 'baseColor');
  }
  const stats = [];
  for (const tex of root.listTextures()) {
    const before = tex.getImage()?.byteLength ?? 0;
    if (!before) continue;
    const role = roleOf.get(tex) ?? 'baseColor';
    const isData = role !== 'baseColor';
    const target = role === 'metallicRoughness' ? Math.min(opts.mrSize, size) : size;
    const quality = role === 'metallicRoughness' ? opts.mrQuality
      : role === 'normal' ? opts.normalQuality
        : opts.quality;

    let pipe = sharp(Buffer.from(tex.getImage()))
      .resize(target, target, { fit: 'fill', kernel: 'lanczos3' });
    if (opts.format === 'webp') {
      pipe = pipe.webp({ quality, effort: 6, smartSubsample: isData });
    } else {
      pipe = pipe.jpeg({ quality, mozjpeg: true, chromaSubsampling: isData ? '4:4:4' : '4:2:0' });
    }
    const buf = await pipe.toBuffer();
    tex.setImage(new Uint8Array(buf));
    tex.setMimeType(opts.format === 'webp' ? 'image/webp' : 'image/jpeg');
    stats.push({ role, size: target, before, after: buf.byteLength });
  }
  if (opts.format === 'webp' && stats.length) {
    // 让 gltf-transform 写出 EXT_texture_webp（three r160 GLTFLoader 内置支持，无需额外解码器）
    doc.createExtension(EXTTextureWebP).setRequired(true);
  }
  return stats;
}

async function processFile(absIn, absOut, budgets, opts, io) {
  const name = basename(absIn, '.glb');
  const beforeBytes = statSync(absIn).size;
  const doc = await io.read(absIn);
  const root = doc.getRoot();

  const trisBefore = countTris(root);
  const texBefore = root.listTextures().length;

  const { dropped, notes } = await normalizeMaterials(root, opts);
  await doc.transform(prune(), dedup());

  // 几何简化：ratio 由 manifest 的 polyBudget 决定
  const budget = budgets.get(name) ?? opts.defaultBudget;
  const trisNow = countTris(root);
  if (trisNow > budget) {
    await doc.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: budget / trisNow, error: opts.simplifyError })
    );
  }

  const size = String(opts.bigTextureAssets).split(',').map(s => s.trim()).includes(name)
    ? opts.heroTextureSize
    : opts.textureSize;
  const texStats = await recompressTextures(doc, size, opts);

  await doc.transform(prune());

  const bin = await io.writeBinary(doc);
  if (!opts.dryRun) {
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, bin);
  }

  return {
    name,
    out: relative(ROOT, absOut),
    beforeBytes,
    afterBytes: bin.byteLength,
    trisBefore,
    trisAfter: countTris(root),
    budget,
    texBefore,
    texAfter: root.listTextures().length,
    texSize: size,
    dropped,
    notes,
    texStats,
  };
}

// ---------------- 报告 ----------------

const kb = (n) => (n / 1024).toFixed(0) + 'KB';
const mb = (n) => (n / 1048576).toFixed(2) + 'MB';

function printTable(results, opts) {
  const cols = [
    ['资产', r => r.name, 14],
    ['压缩前', r => mb(r.beforeBytes), 8],
    ['压缩后', r => kb(r.afterBytes), 8],
    ['降幅', r => (100 - r.afterBytes / r.beforeBytes * 100).toFixed(1) + '%', 7],
    ['面数', r => `${r.trisBefore}→${r.trisAfter}`, 14],
    ['预算', r => String(r.budget), 6],
    ['贴图', r => `${r.texBefore}→${r.texAfter} @${r.texSize}`, 13],
    ['材质处理', r => r.notes.join(' ') || '-', 34],
  ];
  const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
  console.log('\n' + cols.map(([h, , w]) => pad(h, w)).join(' '));
  console.log(cols.map(([, , w]) => '-'.repeat(w)).join(' '));
  for (const r of results) console.log(cols.map(([, f, w]) => pad(f(r), w)).join(' '));

  const before = results.reduce((a, r) => a + r.beforeBytes, 0);
  const after = results.reduce((a, r) => a + r.afterBytes, 0);
  console.log(cols.map(([, , w]) => '-'.repeat(w)).join(' '));
  console.log(`${pad('合计', 14)} ${pad(mb(before), 8)} ${pad(mb(after), 8)} ${pad((100 - after / before * 100).toFixed(1) + '%', 7)}`);

  const over = results.filter(r => r.afterBytes > 500 * 1024);
  if (over.length) console.log(`\n[warn] 超过 500KB: ${over.map(r => `${r.name} ${kb(r.afterBytes)}`).join(', ')}`);
  console.log(`\n格式=${opts.format} 质量=${opts.quality}/法线${opts.normalQuality} 简化误差=${opts.simplifyError}` +
    (opts.dryRun ? '  [dry-run，未写盘]' : ''));
}

/** 统计输出目录里真正会上线的 .glb 总量 */
function reportOutDir(outDir) {
  const abs = resolve(ROOT, outDir);
  if (!existsSync(abs)) return;
  const files = [];
  walk(abs, files);
  const glbs = files.filter(f => extname(f).toLowerCase() === '.glb');
  const total = glbs.reduce((a, f) => a + statSync(f).size, 0);
  const others = files.filter(f => /\.bak\d*$/.test(f));
  const otherTotal = others.reduce((a, f) => a + statSync(f).size, 0);
  console.log(`\n${outDir} 共 ${glbs.length} 个 .glb，合计 ${mb(total)}`);
  if (others.length) {
    console.log(`（另有 ${others.length} 个 .bak/.bak2 备份文件 ${mb(otherTotal)}，未计入，也未被本脚本改动）`);
  }
}

// ---------------- main ----------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await MeshoptSimplifier.ready;

  const budgets = await loadPolyBudgets();
  const inputs = collectInputs(opts);
  if (!inputs.length) { console.error('没有匹配到任何 .glb'); process.exit(1); }

  const outRoot = resolve(ROOT, opts.out);
  const io = new NodeIO().registerExtensions([EXTTextureWebP]);

  const results = [];
  const skipped = [];
  for (const { abs: absIn, rel } of inputs) {
    const absOut = join(outRoot, rel);

    // 安全闸：不在 --out 下凭空造新目录。备份目录的结构未必和 art/export 一一对应
    // （例如别的 agent 放进来的 art/_src/blender_elite/），误写会生成游戏根本不引用的资产。
    if (!opts.allowNewDirs && !existsSync(dirname(absOut))) {
      skipped.push({ rel, reason: `${relative(ROOT, dirname(absOut))} 不存在` });
      continue;
    }

    process.stdout.write(`  处理 ${rel} ... `);
    try {
      const r = await processFile(absIn, absOut, budgets, opts, io);
      results.push(r);
      console.log(`${mb(r.beforeBytes)} -> ${kb(r.afterBytes)}`);
    } catch (err) {
      console.log(`失败: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (skipped.length) {
    console.log('\n[skip] 输出目录不存在，已跳过（要写就加 --allow-new-dirs）:');
    for (const s of skipped) console.log(`  ${s.rel}  — ${s.reason}`);
  }
  if (!results.length) { console.error('\n没有任何文件被处理'); process.exit(1); }

  printTable(results, opts);
  if (!opts.dryRun) reportOutDir(opts.out);
}

main().catch((err) => { console.error(err); process.exit(1); });
