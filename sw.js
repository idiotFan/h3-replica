// ================= Service Worker（PWA 离线） =================
// 策略：
// - 代码类本地资源（HTML/CSS/JS/JSON/manifest）：network-first，网络失败才回退缓存
//   → 发新版时用户刷新即可拿到新代码，不会被旧缓存钉死
// - 静态美术资源（art/ 下的 glb/图片/音频/字体）：cache-first，大文件缓存后离线可用
// - CDN 模块（three.js）：stale-while-revalidate，离线时用缓存
// - 其他请求：直接网络
//
// 【版本号】__BUILD_VERSION__ 由 scripts/deploy.sh 在发布时用 sed 注入（时间戳+源码哈希）。
// 每次发布 sw.js 的字节都会变化 → 浏览器检测到新 SW → install 重新预缓存 →
// activate 删除所有旧版本 cache。本地开发时占位符保持原样，缓存键固定为 homm3d-__BUILD_VERSION__。
const VERSION = '__BUILD_VERSION__';
const CACHE = 'homm3d-' + VERSION;
const CACHE_PREFIX = 'homm3d-';
const CDN_TIMEOUT_MS = 8000;   // 无缓存时等待 CDN 的上限，超时后兜底避免请求永久挂起
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.loli.net', 'gstatic.loli.net'];

// 预缓存的应用外壳（启动必需的本地文件）
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/config.js',
  './js/difficulty.js',
  './js/utils.js',
  './js/map.js',
  './js/battle.js',
  './js/ui.js',
  './js/minimap.js',
  './js/textures.js',
  './js/models.js',
  './js/assets/manifest.js',
  './js/assets/loader.js',
  './js/assets/factory.js',
];

// art/ 下的静态美术资源走 cache-first（内容变了必然改文件名或走新版本 cache）
const ASSET_RE = /\.(glb|gltf|bin|ktx2|png|jpe?g|webp|avif|gif|svg|mp3|ogg|wav|m4a|woff2?|ttf|otf)$/i;
function isStaticAsset(url) {
  return url.pathname.includes('/art/') || ASSET_RE.test(url.pathname);
}

// cache.put 可能因存储配额溢出抛错，统一吞掉，绝不影响正常响应
async function safePut(req, res) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(req, res);
  } catch (err) {
    // QuotaExceededError 等：放弃缓存即可
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 并行缓存外壳，个别失败不阻塞安装
    // cache: 'reload' 绕过 HTTP 缓存，确保预缓存到的是服务器上的最新字节
    await Promise.allSettled(SHELL.map(u =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => cache.add(u).catch(() => {}))
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 清理本项目的所有旧版本缓存（版本号变了 CACHE 就变，这里才真正生效）
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 只处理 GET 请求
  if (req.method !== 'GET') return;

  // 跳过非 http(s) 协议（如 chrome-extension）
  if (!url.protocol.startsWith('http')) return;

  // sw.js 自身永远直连网络，绝不缓存
  if (url.origin === self.location.origin && url.pathname.endsWith('/sw.js')) return;

  const isCDN = CDN_HOSTS.includes(url.host);
  const isLocal = url.origin === self.location.origin;

  // CDN 资源：stale-while-revalidate
  //
  // ⚠ 两个必须防的坑（旧实现都中招）：
  //  1. cached 为空时返回 fetchPromise，而它的 .catch(() => cached) 在 cached
  //     是 undefined 时会 resolve 成 undefined —— respondWith(undefined) 会让
  //     整个请求失败（three.js / 字体拉不到，页面直接废）。必须回退成真实 Response。
  //  2. 网络既不 resolve 也不 reject（弱网、CDN 黑洞）时 respondWith 永远挂起，
  //     页面一直转圈。必须有超时兜底。
  if (isCDN) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      const net = fetch(req).then(res => {
        if (res && res.ok) e.waitUntil(safePut(req, res.clone()));
        return res;
      });
      if (cached) {
        // 有缓存：立刻返回，后台静默刷新（失败也无所谓）
        e.waitUntil(net.catch(() => {}));
        return cached;
      }
      // 无缓存：必须等网络，但加超时兜底，且保证任何分支都返回真实 Response
      try {
        const res = await Promise.race([
          net,
          new Promise((_, rej) => setTimeout(() => rej(new Error('CDN timeout')), CDN_TIMEOUT_MS)),
        ]);
        if (res) return res;
        throw new Error('empty response');
      } catch (err) {
        // 超时后再给网络一次机会（说不定只是慢），仍失败才返回 504
        try {
          const late = await net;
          if (late) return late;
        } catch (e2) { /* 落到下面的 504 */ }
        return new Response('', { status: 504, statusText: 'CDN unavailable' });
      }
    })());
    return;
  }

  if (!isLocal) return; // 其他跨域请求：直接网络（不缓存）

  // 本地静态美术资源：cache-first
  if (isStaticAsset(url)) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && res.ok) e.waitUntil(safePut(req, res.clone()));
      return res;
    })());
    return;
  }

  // 本地代码类资源（html/js/css/json）：network-first
  e.respondWith((async () => {
    try {
      // 非导航请求（js/css/json）用 cache:'no-cache' 强制走条件请求
      // （带 If-None-Match / If-Modified-Since），避免服务端的强缓存头让老用户
      // 即使联网也拿到旧代码；内容没变时服务端回 304，开销极小。
      // 导航请求保持原样 fetch(req)：从 mode:'navigate' 的 Request 没法安全地重建，
      // 且若服务端 30x，用重定向后的响应回应导航请求会直接抛错。
      const res = req.mode === 'navigate'
        ? await fetch(req)
        : await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res && res.ok) e.waitUntil(safePut(req, res.clone()));
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      // 离线且无缓存：导航请求返回 index.html 作为兜底
      if (req.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});

// 接收来自页面的消息：index.html 检测到新 SW 装好后会发 SKIP_WAITING，
// 让新 SW 立刻接管（配合页面的 controllerchange 自动刷新）
self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'skipWaiting' || (d && d.type === 'SKIP_WAITING')) { self.skipWaiting(); return; }
  // 自检用：页面/运维可以问当前接管的 SW 是哪个构建版本
  if (d && d.type === 'GET_VERSION') {
    const reply = { type: 'VERSION', version: VERSION, cache: CACHE };
    if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
    else if (e.source) e.source.postMessage(reply);
  }
});
