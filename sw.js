// I-PASSBOOK service worker.
// Strategy:
//  - Apps Script backend (live data): ALWAYS network, NEVER cached — otherwise
//    the IR list / passbook would freeze at the first response and never update.
//  - Navigations: network-first, fall back to cached index.html when offline.
//  - Same-origin static shell (HTML/CSS/JS/assets): stale-while-revalidate — serve
//    the cached copy instantly, refresh it in the background.
//  - The worker's OWN script: never intercepted (see 3a below). The app asks for
//    it to answer "is a newer build deployed?", and answering that from a cache
//    would be the one answer that must never be cached.
//  - Other cross-origin (fonts, etc.): default network handling.
//
// WHY THE VERSION NUMBERS MATTER
// Bumping CACHE_NAME below is what makes a returning user actually run the new
// build: a fresh cache name is filled at install and the old one is deleted, so
// the stale-while-revalidate lag is paid once, at the handover, instead of
// silently. `tools/deploy-ghpages.mjs` refuses to be quiet when it is unchanged,
// and it must move in step with APP_VERSION in app.js — see the note at the
// install handler about `cache: 'reload'`, which is what stops a BRAND NEW cache
// name from being filled with bodies the browser's HTTP cache had already gone
// stale on. That combination — a new name AND fresh bodies inside it — is what
// makes the app's "update available" check honest.
const CACHE_NAME = 'ipassbook-v62';
const SHELL = [
  './',
  './index.html',
  // Design system, in cascade order (see index.html).
  './tokens.css',
  './palette.css',   // re-points the accent role; must load right after tokens.css
  './theme.css',     // the light/cream/dark MODE layer; token-only
  './base.css',
  './components.css',
  './views.css',
  './desk.css',      // the ERPNext Desk prototype; must load LAST
  './vendor/pdf-lib.min.js',
  './dataflash.js',   // the flight-log reader; load order must match index.html
  './i18n.js',        // the English language layer; must be in place before app.js
  './app.js',
  './manifest.json',
  // The FAQ is in the SHELL because it is linked from the sign-in screen, so it is
  // part of the app's own surface — and because it is the page someone opens when
  // something is already wrong, which is exactly when the signal is bad. The other
  // static pages (plan.html, inspector.html) are review pages, not app screens, and
  // deliberately stay OUT of the shell: they would be paid for on every device's
  // first visit and read by almost nobody.
  './faq.html',
  './assets/icon-192.png',
  './assets/icon-mark.png',   // the borderless mark the app itself shows
];
const isBackend = url => url.indexOf('https://script.google.com/') === 0;
// `url` and `self.location.href` both carry no query in practice, but stripping
// one on each side makes the comparison exact rather than lucky.
const isOwnScript = url => url.split('?')[0] === self.location.href.split('?')[0];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // `cache: 'reload'` fetches each shell file PAST the browser's HTTP cache
      // and refreshes that entry on the way through. Without it this is a plain
      // fetch, and GitHub Pages serves everything with a ~10-minute HTTP cache —
      // so a brand new CACHE_NAME could be populated with the PREVIOUS build's
      // app.js and the version number would move while the code did not. That is
      // the exact failure this whole mechanism exists to prevent, and it is
      // invisible: the cache name says v55 and the code inside is v54.
      .then(cache => cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))
        .catch(() => {})) // tolerate any missing asset
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
  //    `cache: 'no-cache'` revalidates instead of trusting the HTTP cache: a
  //    navigation fetch otherwise honours GitHub Pages' ~10-minute max-age and
  //    can hand back yesterday's index.html. It is still a conditional request,
  //    so a 304 reuses the stored body and the HTTP entry stays warm — which is
  //    why this is 'no-cache' and not 'no-store' (that would re-download the
  //    whole document on every open and throw away the entry the offline
  //    fallback below depends on). Offline is unaffected: the revalidation fails,
  //    fetch rejects, and the catch serves the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 3a. The worker's own script: NEVER intercepted. app.js probes `./sw.js` to
  //     answer "is a newer build deployed?" by reading CACHE_NAME out of it.
  //     That probe is same-origin and not a navigation, so without this guard it
  //     would land in branch 3 below — and the Cache API's match() ignores a
  //     request's `cache` mode entirely (it is not an HTTP cache), so the
  //     background `cache.put` on the first probe would store sw.js and every
  //     later probe would be answered from it. The check would be right once and
  //     then quietly lie for the rest of that cache's life. A unique `?t=`
  //     cache-buster would also work but leaves a junk entry per probe, so the
  //     URL check is the honest fix. This is not dead code.
  if (isOwnScript(url)) return;

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

// NOTE on skipWaiting(): it is kept deliberately, and it is the reason a plain
// refresh (rather than a close-and-reopen) delivers a new build. The classic
// alternative — park the new worker in `waiting` and activate it when the user
// asks — would mean a refresh keeps serving the OLD worker, which is precisely
// the symptom that sent us here: the owner refreshes, and the app does not move.
// Waiting workers are the right default for an app that lazily loads chunks
// against a live server; this app precaches its entire shell above, never caches
// the backend, and its only lazily-fetched same-origin asset is the intro video,
// so the window where old and new code can disagree is small.
//
// What skipWaiting() does NOT do is reload the open page: the running app.js was
// parsed long ago and stays parsed. That is app.js's job on the user's tap —
// hence the "update available" banner rather than an automatic reload.
