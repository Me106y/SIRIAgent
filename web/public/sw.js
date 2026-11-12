// SIRIAgent 静态资源离线缓存。
// VERSION 在构建时由 vite 插件（stampServiceWorker）替换成构建时间戳，
// 因此每次发版 SW 字节都会变：浏览器必然重新 install/activate，
// activate 里再清掉所有旧缓存 —— 用户不用手动清缓存。
const VERSION = "__SW_VERSION__";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// 带内容哈希的产物：URL 变了内容才会变，可以放心 cache-first。
function isHashed(pathname) {
  return /^\/assets\/.+-[A-Za-z0-9_-]{8}\.(js|css|woff2?|png|svg|jpg|webp)$/.test(pathname);
}

// 不带哈希的资源（Cesium、logo）：可能原地更新，必须走 stale-while-revalidate。
function isUnversioned(pathname) {
  return pathname.startsWith("/cesium/") || pathname.startsWith("/logo-");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API 有自己的 Cache-Control，交给浏览器处理。
  if (url.pathname.startsWith("/api/")) return;
  // SW 自身绝不能被缓存，否则永远拿不到新版本。
  if (url.pathname === "/sw" || url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isHashed(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isUnversioned(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // 只缓存自己的应用壳；Access 登录页是跨域重定向，不能当壳缓存。
    if (response.ok && response.type === "basic" && !response.redirected) {
      await cache.put("/", response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match("/");
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  // 有缓存先用，同时后台更新；没缓存就等网络。
  return cached || (await network) || Response.error();
}
