/**
 * Service Worker for Odds ao Vivo PWA
 *
 * IMPORTANTE: nunca cache-first em JS/CSS do Next (_next/static).
 * Em dev os paths são estáveis (ex: app/finalizacao/page.js) e o cache
 * antigo mantinha colunas Bet365/Betsson e odds de mercado errado.
 *
 * - API: network-only
 * - /_next/* e .js/.css: network-first (atualiza, fallback cache)
 * - imagens/fontes: cache-first
 */

const CACHE_NAME = 'odds-aovivo-v4-4houses';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(() => self.skipWaiting()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

function isNextOrScript(url, request) {
  if (url.pathname.startsWith('/_next/')) return true;
  if (url.pathname === '/sw.js') return true;
  return /\.(js|css|map)(\?|$)/i.test(url.pathname) ||
    /\.(js|css)(\?|$)/i.test(request.url);
}

function isStaticAsset(url) {
  return /\.(png|jpe?g|svg|ico|woff2?|webp|gif)(\?|$)/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // API: sempre rede
  if (isApi(url)) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    return;
  }

  // Next chunks / JS / CSS: network-first (evita UI fantasma com casas antigas)
  if (isNextOrScript(url, request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || new Response('Offline', { status: 503 }))),
    );
    return;
  }

  // Imagens/fontes: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        });
      }),
    );
    return;
  }

  // Documentos HTML: network-first
  if (request.destination === 'document' || request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match('/') || new Response('Offline', { status: 503 })),
    );
    return;
  }

  // Demais: tenta rede, fallback cache
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((c) => c || new Response('Offline', { status: 503 }))),
  );
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'Odds ao Vivo', body: 'Novas odds disponíveis!' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: data.url || '/',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data || '/'));
});
