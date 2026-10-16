// Service worker (Task 1.2): cache-first cho tài nguyên tĩnh của app shell.
// - config.js KHÔNG precache: luôn lấy bản mới nhất từ mạng (chứa địa chỉ API theo môi trường).
// - Không can thiệp request API (/api/...) hay request khác GET.
var CACHE_NAME = "sop-static-v2";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./dist/app.js",
  "./dist/api.js",
  "./dist/ui.js",
  "./dist/views/home.js",
  "./dist/views/users.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.indexOf("/api/") === 0) return; // không cache API
  if (url.pathname.endsWith("/config.js")) {
    // config.js: ưu tiên mạng, rớt mạng mới dùng cache.
    event.respondWith(
      fetch(event.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return res;
      }).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
