// sw.js (네트워크 전용 모드 — 설치형 앱(PWA) 지원용, 캐시하지 않음)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

self.addEventListener('fetch', (event) => {
  // 같은 출처의 GET 요청만 처리하고, Firebase·Apps Script 요청은 브라우저에 맡깁니다.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request));
});
