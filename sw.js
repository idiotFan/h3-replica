// ================= Service Worker（PWA 离线） =================
// 策略：
// - 本地静态资源（HTML/CSS/JS/JSON）：cache-first，回退网络
// - CDN 模块（three.js）：stale-while-revalidate，离线时用缓存
// - glb 模型/图片：cache-first，大文件缓存后离线可用
// - 其他请求：直接网络

const CACHE = 'homm3d-v1';
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

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 并行缓存外壳，个别失败不阻塞安装
    await Promise.allSettled(SHELL.map(u => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 清理旧缓存
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
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

  const isCDN = CDN_HOSTS.includes(url.host);
  const isLocal = url.origin === self.location.origin;

  // CDN 资源：stale-while-revalidate
  if (isCDN) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      const fetchPromise = fetch(req).then(res => {
        if (res && res.ok) {
          const cache = caches.open(CACHE);
          cache.then(c => c.put(req, res.clone()));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })());
    return;
  }

  // 本地资源：cache-first，回退网络
  if (isLocal) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok && (req.url.includes('/js/') || req.url.includes('/css/') ||
            req.url.includes('/art/') || req.url.includes('.json'))) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        // 离线且无缓存：导航请求返回 index.html 作为兜底
        if (req.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        throw err;
      }
    })());
    return;
  }

  // 其他请求：直接网络（不缓存）
});

// 接收来自页面的消息（可用于触发更新）
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
