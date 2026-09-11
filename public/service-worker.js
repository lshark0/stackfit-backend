const CACHE_NAME = 'kimfree-shell-v9';
// manifest.json은 캐시하지 않습니다. 낡은 앱 이름/아이콘 정보가 남아
// 브라우저가 예전 앱으로 잘못 인식하는 것을 막기 위함입니다.
const SHELL_FILES = ['/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

// 앱이 "새 버전으로 바로 바꿔줘"라고 보내는 신호를 받으면 즉시 교체합니다.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
  // 서비스워커 자신은 절대 캐시하지 않습니다.
  // (캐시하면 낡은 버전이 스스로를 계속 되살려서 새 기능이 영영 적용되지 않습니다)
  if (url.pathname === '/service-worker.js') return;
  // 앱 정보(manifest)도 항상 최신을 받아야 이름·아이콘 변경이 제대로 반영됩니다.
  if (url.pathname === '/manifest.json') return;
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

// ── 웹 푸시 알림 ─────────────────────────────────
// 앱을 보고 있지 않을 때(브라우저를 닫아둔 상태 포함) 서버가 보낸 알림을 받아
// 휴대폰 알림창에 띄웁니다.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: '김프리', body: event.data ? event.data.text() : '' };
  }
  // 내용이 비어 있어도 최소한 무슨 앱의 알림인지는 보이도록 기본값을 채웁니다.
  if (!data.title && !data.body) {
    data = { title: '김프리', body: '새로운 소식이 있어요. 앱에서 확인해보세요.' };
  }

  // 알림창에서 어떤 종류의 소식인지 한눈에 알 수 있도록 제목 앞에 표시를 붙입니다.
  const kindLabel = {
    chat: '💬 새 메시지',
    proposal: '📨 포지션 제안',
    applicant: '🙋 새 지원자',
    result: '📢 지원 결과',
    test: '🔔 알림 테스트',
  };
  const kind = data.kind || 'chat';
  const heading = data.title || kindLabel[kind] || '김프리';

  const options = {
    // 본문에는 실제 내용을, 그 아래엔 앱 이름을 표시해 출처를 분명히 합니다.
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // 같은 대화의 알림은 하나로 덮어써서 알림창이 도배되지 않게 합니다.
    tag: data.tag || 'stackfit',
    renotify: true,
    requireInteraction: false,
    vibrate: [120, 60, 120],
    // 알림을 눌렀을 때 이동할 화면 (예: 'chatRoom:12')
    data: { url: data.url || '/', link: data.link || null },
  };
  event.waitUntil(self.registration.showNotification(heading, options));
});

// 알림을 탭하면 관련 화면으로 바로 이동합니다.
// - 앱이 이미 열려 있으면: 그 창을 앞으로 가져온 뒤 해당 화면으로 이동하라고 알려줍니다.
// - 앱이 닫혀 있으면: 이동할 화면 정보가 담긴 주소(/?go=화면&p=번호)로 새로 엽니다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || '/';
  const link = data.link || null;

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = clientList.find((c) => 'focus' in c);
    if (client) {
      try { await client.focus(); } catch (e) {}
      if (link) client.postMessage({ type: 'OPEN_LINK', link });
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
