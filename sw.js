// ═══════════════════════════════════
//  Cecilia Bakery — Service Worker
//  Network-first + Offline Fallback + Push Notifications
// ═══════════════════════════════════

const CACHE_VERSION = 'v30';                      // bump on each release
const CACHE_NAME = `cecilia-cache-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// ── INSTALL: pre-cache offline page + immediately activate ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// ── MESSAGE: allow banner button to trigger skipWaiting ──
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

// ── ACTIVATE: delete old caches + claim clients ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first with offline fallback ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Only serve offline page for navigation requests (HTML pages)
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
        })
      )
  );
});

// ── PUSH: receive background push notifications ──
self.addEventListener('push', (event) => {
  let data = { title: 'Cecilia Bakery', body: 'You have a new notification' };

  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body || '',
    icon: '/assets/logo.png',
    badge: '/assets/logo.png',
    tag: data.tag || 'cecilia-push-' + Date.now(),
    data: {
      url: data.url || '/',
      section: data.section || null
    },
    vibrate: [200, 100, 200],
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Cecilia Bakery', options)
  );
});

// ── NOTIFICATION CLICK: focus app window ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
