// I-PASSBOOK service worker.
// Strategy:
//  - Apps Script backend (live data): ALWAYS network, NEVER cached — otherwise
//    the IR list / passbook would freeze at the first response and never update.
//  - Navigations: network-first, fall back to cached index.html when offline.
//  - Same-origin static shell (HTML/CSS/JS/assets): stale-while-revalidate — serve
//    the cached copy instantly, refresh it in the background. That means a code
//    change reaches a returning user on their SECOND load, not their first: the
//    first load is served the stale `app.js` while the new one is fetched. Bumping
//    CACHE_NAME below is what removes that one-load lag, which is why
//    `tools/deploy-ghpages.mjs` refuses to be quiet about it.
//  - Other cross-origin (fonts, etc.): default network handling.
const CACHE_NAME = 'ipassbook-v47';
const SHELL = [
  './',
  './index.html',
  // Design system, in cascade order (see index.html).
  './tokens.css',
  './palette.css',   // re-points the accent role; must load right after tokens.css
  './base.css',
  './components.css',
  './views.css',
  './vendor/pdf-lib.min.js',
  './app.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-mark.png',   // the borderless mark the app itself shows
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