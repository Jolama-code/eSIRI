/* NURU service worker: caches the app shell and static assets. /api/* always goes to the network. */
const CACHE = 'nuru-shell-v1';
const SHELL = ['/hub', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/brand/nuru-logo-horizontal.svg', '/brand/nuru-logo-stacked.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

function isStatic(url) {
  return /^\/(assets|brand|fonts|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the API, server-sent events or Vite's development modules.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/@') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/')) return;

  if (req.mode === 'navigate') {
    // Network first for pages; the cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/hub', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/hub').then((r) => r || Response.error())),
    );
    return;
  }
  if (isStatic(url)) {
    // Cache first for fonts, logos, icons and hashed build assets.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
  }
});

/* Notifications shown from the page via registration.showNotification focus the app on click. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/hub');
    }),
  );
});
