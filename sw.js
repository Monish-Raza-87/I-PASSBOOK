// I-PASSBOOK service worker.
// Strategy:
//  - Apps Script backend (live data): ALWAYS network, NEVER cached — otherwise
//    the IR list / passbook would freeze at the first response and never update.
//  - Navigations: network-first, fall back to cached index.html when offline.
//  - Same-origin static shell (HTML/CSS/JS/assets): cache-first, populate cache
//    from the network on first use.
//  - Other cross-origin (fonts, etc.): default network handling.
const CACHE_NAME = 'ipassbook-v16';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/logo.png',
];
const isBackend = url => url.indexOf('https://script.google.com/') === 0;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL).catch(() => {})) // tolerate any missing asset
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // 1. Backend = always live. Do not intercept (let the browser fetch normally).
  if (isBackend(url)) return;

  // 2. Navigations: network-first with offline fallback to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 3. Same-origin static assets: stale-while-revalidate — serve cached
  //    instantly (fast + offline) and refresh the cache in the background so
  //    code changes propagate on the next load without manual cache-version bumps.
  if (url.indexOf(self.location.origin) === 0) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(req).then(cached => {
          const network = fetch(req).then(resp => {
            if (resp && resp.status === 200) {
              const copy = resp.clone();
              cache.put(req, copy).catch(() => {});
            }
            return resp;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // 4. Everything else (cross-origin, non-backend): default browser handling.
});