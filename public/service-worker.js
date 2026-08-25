const CACHE_NAME = 'stackfit-shell-v2';
const SHELL_FILES = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  if (event.request.method !== 'GET') return;

  // 앱의 HTML 화면(들어가는 첫 페이지)은 항상 네트워크를 먼저 시도합니다.
  // 배포할 때마다 화면이 바뀌는 서비스라서, 오래된 캐시가 새 화면을 가리는 걸 막기 위함입니다.
  // 오프라인일 때만 예전에 저장해둔 캐시로 대체합니다.
  const isAppShell = event.request.mode === 'navigate' || url.pathname === '/';
  if (isAppShell) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 아이콘 등 잘 안 바뀌는 정적 파일은 캐시 우선 + 백그라운드 갱신으로 빠르게 서빙합니다.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
