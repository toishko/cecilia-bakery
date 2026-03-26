// ═══════════════════════════════════
//  Cecilia Bakery — Service Worker
//  Network-first: always fresh, cache for offline
// ═══════════════════════════════════

const CACHE_NAME = 'cecilia-cache';

// ── INSTALL: immediately activate ──
self.addEventListener('install', () => self.skipWaiting());

// ── ACTIVATE: clean old caches + claim clients ──
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── FETCH: always network-first ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET, chrome-extension, etc.
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache the fresh response for offline use
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline: serve from cache
        return caches.match(event.request);
      })
  );
});

// ── NOTIFICATION CLICK: focus app window ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
