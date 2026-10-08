/* ============================================================
   I-PASSBOOK — app.js
   Single Page App routing, auth, form rendering & API calls
   ============================================================ */

// ─── VERSION ─────────────────────────────────────────────────────────────────
// The one place the shipped version is written, and it is SHOWN to every user —
// on the sign-in card and in the app footer — so the first question in any report
// ("are you on the latest?") can be answered by looking instead of guessing.
//
// It must equal the number in `sw.js`'s CACHE_NAME, because that is the number
// that decides whether a returning user is actually running this build: the app
// shell is served stale-while-revalidate, so a device can be a full load behind
// whatever gh-pages holds. A mismatch is the exact situation this display exists
// to expose, so `smoke-shell.mjs` fails when the two disagree.
//
// It carries a second job now: `checkForUpdate()` reads the DEPLOYED sw.js out of
// the network and compares its number against this one to decide whether to raise
// the "update available" notice. That comparison is only meaningful because the
// two numbers are pinned together — which is why the pin is load-bearing and not
// just a tidy convention.
const APP_VERSION = 'v78';

// Fill every version slot on the page. One writer, so there is one place to look
// when the number is wrong — the slots themselves are static markup, present on
// the sign-in card AND in the signed-in footer, so the answer is on screen before
// anyone has managed to sign in and report that they cannot.
function paintVersion() {
  document.querySelectorAll('.app-version').forEach(el => { el.textContent = APP_VERSION; });
}
// app.js is the second-to-last script in the body, so the slots below it in
// index.html already exist. No DOMContentLoaded wait, no boot order to get wrong.
paintVersion();

// ─── THE LANGUAGE LAYER ──────────────────────────────────────────────────────
// i18n.js, loaded just before this file, owns the English strings; these are only
// the local handles on it.
//
// The fallbacks are what make a missing i18n.js survivable rather than fatal: t()
// then returns the KEY, which is visibly wrong rather than an empty control that
// nobody can account for. That path is for the flaky-network case only — a missing
// or orphaned string is a failing test in smoke-i18n.mjs, not something a user
// should ever meet.
//
// Only English and Hindi ship today, so every one of these returns exactly the words
// that were here before for an English reader. The point is that the third language is
// a data file and nothing else.
const t          = (key, vars) => (window.I18N ? window.I18N.t(key, vars) : key);
const tStatus    = v => (window.I18N ? window.I18N.status(v) : v);
const tPriority  = v => (window.I18N ? window.I18N.priority(v) : v);

// `t`, for a label app.js WRITES ITSELF rather than one index.html already carries.
//
// The distinction is load-bearing and it is the whole reason this is a second helper
// instead of a re-use of the first. t() returns the KEY when i18n.js failed to load,
// which is the loud, correct failure for a string that has no other copy — but wrong
// for a button whose English is already sitting in the markup. A key on a button is
// worse than an untranslated word, so the English is passed in here as the floor.
//
// ⚠ DO NOT MERGE THESE TWO INTO ONE ONE-LINER. They look like the same function and
// they are not: this one degrades to English, t() degrades to a visible key, and
// smoke-i18n.mjs asserts BOTH behaviours. A reader who "tidies" them together has to
// delete a passing test to do it, which is the point.
const tFloor = (key, english) => {
  const s = window.I18N ? window.I18N.t(key) : '';
  return (s && s !== key) ? s : english;
};

// The word to PRINT for a stored status, for every renderer that shows one.
//
// One helper rather than a spelling at each site, because there WERE two. The
// ticket header printed `tStatus(ir.status)` and the list card printed `ir.status`
// raw, so a ticket still holding a retired word read two ways at once: the card
// said 'QC Investigation' while the header said 'Investigation' — and the store
// WILL hold retired words for a while, because re-aligning old entries is a job the
// desk does gradually (see STATUS_LEGACY). tStatus() is what folds them (i18n.js's
// STATUS_KEYS carries the same fold, keyed for translation), and the `|| 'Open'`
// covers the empty case, where the store holds nothing for a ticket nobody has
// opened. Nothing else may print `ir.status` directly.
function statusLabel(status) {
  return tStatus(status) || 'Open';
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// IMPORTANT: Replace these with your actual values before deploying.
const CONFIG = {
  // Google Apps Script Web App URL (v3 — Drive-JSON store, new project under
  // monish.raza@indrones.com). The v2 URL it replaced stays alive and untouched as
  // the rollback: reverting this one line and pushing gh-pages returns the app to
  // the old backend, with no data lost.
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzwiZyj_eO2P-5lddbUhs-ZJBSSwt6qLa8RKCOPkyysR4d35_ahtPXfijfyejQXatfT/exec',

  // Allowed domain — only @indrones.com (plus explicitly-allowlisted) accounts
  ALLOWED_DOMAIN: 'indrones.com',

  // Google sign-in — the SECOND deployment of the same backend script, set to
  // Execute as: Me + Who has access: Anyone within indrones.com. Only a deployment
  // with that access level lets Session.getActiveUser() report the CALLER, which is
  // the entire mechanism; there is no OAuth Client ID and no UrlFetchApp anywhere.
  //
  // It is a second deployment, NOT a change to the one above, because flipping the
  // primary to domain-only would have Google refuse the request before our code
  // runs — and that would kill the password door too, for exactly the people who
  // need it: a shared machine with no Google session, and the external address in
  // the backend's CONFIG.EXTERNAL_EMAILS.
  //
  // THIS URL IS OPENED, NEVER FETCHED. It is the one thing about this feature that
  // is easy to get wrong, and the first version of it did: fetching this URL from
  // the app gets **401** from Google before any of our code runs, because the
  // caller's Google session is not attached to a cross-site background request.
  // Opening the same URL as a navigation reports the caller perfectly. Everything
  // about the door follows from that one measurement — see the GOOGLE SIGN-IN block
  // further down, and docs/10.
  //
  // EMPTY IS A VALID, WORKING STATE. With this blank the sign-in screen shows the
  // password form and no Google button, and nothing else about the app changes.
  // Deleting the second deployment in Apps Script reverts the feature with no code
  // change at all. See docs/05 for the deploy steps.
  //
  // Set 2026-09-20, live: the domain-scoped URL Google hands back for a
  // "Anyone within indrones.com" deployment — note the `/a/macros/indrones.com/`
  // segment, which is what distinguishes it from GAS_URL above.
  SSO_URL: 'https://script.google.com/a/macros/indrones.com/s/AKfycbybK8zQxCvU8-BZIMMAgzI_71sZZhYHE9vh0We5nDtTydOSny_zZ_yQfIi0z22D7uKj/exec',

  // Local development helper. Use http://localhost:PORT/?dev=1 to inspect the app
  // without Google auth while this prototype is still being built.
  ENABLE_DEV_AUTH_BYPASS: true,

  // The desk's WhatsApp chat, for the corner button on the landing page.
  //
  // THIS IS EMPTY ON PURPOSE AND THE BUTTON IS HIDDEN WHILE IT IS. There is no
  // Indrones after-sales WhatsApp link anywhere in this repository, I have no way to
  // verify one, and inventing a number would send a customer to a stranger. So the
  // corner ships wired and dormant: paste the invite URL (the `https://wa.me/<number>`
  // or `https://chat.whatsapp.com/<code>` form) here and the button appears on the next
  // deploy, with no other change. An `href` of '#' that opens a blank tab is worse than
  // no button at all, which is why the fallback is "no button".
  WHATSAPP_URL: '',

  // ── NO SHEET ADDRESSES LIVE HERE ANY MORE (2026-10-03) ───────────────────────
  // The IR Repository and the legacy workbook used to be named in this file. Both
  // were read from the BROWSER, one of them (the IR Repository) over a URL that
  // needed no login at all. That made their addresses part of a public repository,
  // which is a standing hazard: change a sharing setting by accident and the data
  // is readable by anyone who has read the repo, with no deploy and no sign on
  // screen. Both reads now go through the token-gated backend, which knows the
  // addresses because it runs as the file's owner — so the frontend no longer
  // needs them, and they are gone. do not add them back.
  //
  // The column meanings are not here either: INTAKE_FIELDS below matches headers by
  // substring, and mapSheetRows() is the one place a sheet grid becomes records.
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentUser = null;

// ─── EMAIL + PASSWORD AUTH (admin-provisioned, no self-signup) ────────────────
// The admin creates every account and hands over a temporary password. On first
// sign-in the user is forced to set their own password before a session is minted.
// Sign-in exchanges email + password + an emailed code for a revocable server
// SESSION TOKEN, which the frontend holds in localStorage and attaches to every
// backend call.
//
// localStorage, NOT sessionStorage, and no idle timeout: reopening the app resumes
// the session rather than demanding a fresh sign-in. But the token is good for ONE
// WORKING DAY (8h30m) and its expiry is ABSOLUTE — it is not slid forward on use,
// so a session does not outlive the shift that started it. The daily sign-in is
// what the emailed code protects; a session that renewed itself on every request
// would never expire for the people who use the app most, which is the opposite of
// what it is for.
//
// The trade-off (a shared/handed-off device keeps the session until it expires) is
// the owner's explicit call; the Sign Out button and the server-side revoke are
// the answer to it. See [[auth-token-gate]].

// Persist/restore the session token. localStorage so reopening the app resumes
// the session instead of demanding a fresh sign-in.
const SESSION_KEY = 'ipb_session';
const USER_KEY    = 'ipb_user';
function persistSession(token) {
  try { if (token) localStorage.setItem(SESSION_KEY, token); else localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}
function loadSession() {
  try { return localStorage.getItem(SESSION_KEY) || null; } catch { return null; }
}

// True when this device holds BOTH halves of a stored sign-in — exactly the
// condition enterApp() below uses to go straight into the app, so the splash skip
// and the boot path cannot disagree. index.html's pre-paint script asks the same
// question with the same two key names, because it runs before this file is
// parsed; smoke-shell.mjs pins the two together. If they ever drift, a signed-in
// user is shown a nine-second video in front of a session that was going to
// resume anyway.
function hasStoredSession() {
  try { return !!(localStorage.getItem(USER_KEY) && localStorage.getItem(SESSION_KEY)); }
  catch { return false; }
}

// The ONE place local auth state is torn down, so it can never be half-cleared.
// A stale profile with no token (or a token with no profile) is itself a cause of
// spurious "please sign in again" screens at boot — every clear site used to
// remember a different subset of keys. Also stops the comment poll, which would
// otherwise keep firing an unauthorized request every 90s and re-trigger the
// ejection path for as long as the login screen is up.
function clearLocalAuth() {
  try {
    // The IR list copy goes WITH the profile it is named after, and it must be dropped
    // BEFORE the profile, because the key is derived from the profile's email. Signing
    // out is the one gesture that means "I am done on this machine", and it would be a
    // strange reading of that to leave a full copy of the repository behind it — this
    // function is the ONE place local auth state is torn down, and the list is not a
    // lesser secret than the token. The cost is one refresh at the next sign-in, on the
    // sign-out path only; a device that is simply left signed in keeps its warm copy.
    const listKey = irListCacheKey();
    if (listKey) localStorage.removeItem(listKey);
    // And the pre-scoping key, from builds before the copy carried an identity. It is
    // never read again — readIRListCache() only asks for a scoped key — so this is
    // cleanup of dead bytes rather than a security step.
    localStorage.removeItem(IR_LIST_CACHE_KEY);
    // The roster copy (ipb_access_cache) goes too. It is not the same class of secret as
    // the IR list — it can only be PAINTED inside the admin-gated modal, so no ordinary
    // or customer account is ever shown it by accident — but it is a list of who has
    // which rights at Indrones, it is on disk, and sign-out is where this function's
    // whole job is "leave nothing of the last person behind". It needs no key of its own
    // on the way out for the opposite reason to the IR list's: there is no scoped read
    // to protect, because the modal it feeds refuses to open for a non-admin.
    localStorage.removeItem(ACCESS_CACHE_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('ipb_user');   // legacy key from the sessionStorage build
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* non-fatal */ }
  try { if (typeof stopNudgePolling === 'function') stopNudgePolling(); } catch { /* non-fatal */ }
}

// NOTE — there is deliberately no `forceReauth()` here. An earlier build had one
// that revoked the server session, cleared local state and showed the login
// screen; nothing ever called it, and its comment claimed two call sites that did
// not exist. Do not reintroduce it: the only path that would want it is rule 4 of
// the interceptor below, and by then `confirmSessionAlive()` has already proved
// the token is dead, so the revoke is a wasted round trip. Sign Out (`signOut()`)
// is the one place a live token is deliberately revoked.

// Ask the backend whether our token is still alive. This is the ONLY thing allowed
// to conclude that a session has died.
//
// It resolves TRUE on a network failure, and that default is the whole point: the
// bug this replaces ejected people on a flaky connection, on a CORS hiccup, and on
// any HTML error page. "I could not reach the server" is not "you are signed out",
// and treating it as one is what produced the repeated sign-in prompts.
function confirmSessionAlive() {
  const st = currentUser && currentUser.sessionToken;
  if (!st) return Promise.resolve(false);
  const url = CONFIG.GAS_URL + (CONFIG.GAS_URL.indexOf('?') >= 0 ? '&' : '?')
    + 'action=sessionCheck&sessionToken=' + encodeURIComponent(st);
  return _origFetch(url)
    .then(r => r.text().then(t => {
      try {
        const d = JSON.parse(t);
        return !!(d && d.status === 'ok' && d.alive);
      } catch { return true; }        // unparseable → assume alive, do not eject
    }))
    .catch(() => true);               // unreachable → assume alive, do not eject
}

// ─── WAKING THE BACKEND BEFORE IT IS NEEDED ──────────────────────────────────
//
// Apps Script spins the script down when nobody is using it, and the next caller
// pays the whole wake-up before a single line of our code runs. Measured against
// the live deployment on 2026-09-21 with the trivially cheap `ping`: 31.6s on the
// first call, then 3.7s and 1.5s warm. That is half a minute of a person staring
// at a sign-in screen wondering whether the app has hung — and the Google door
// pays it TWICE, because the door and the app are two deployments and waking one
// does not wake the other.
//
// Nothing here can make Apps Script start faster. What it can do is stop paying
// the wake-up at the worst possible moment. The sign-in screen is the one place in
// this app where a person is guaranteed to spend seconds doing nothing but typing,
// and it arrives behind a nine-second intro — so a `ping` fired as soon as we know
// that screen is coming gives the wake-up that head start instead of charging it to
// the submit that follows.
//
// WHAT IS MEASURED, AND WHAT IS NOT. A lone call to the live deployment answers in
// 1.5–3.7s warm against 31.6s cold, so a wake-up that finishes before the form is
// submitted saves the person most of half a minute. What is NOT established is that
// the overlap itself is free: three pings fired at once were measured at 9.0s, 9.5s
// and 10.5s each, where a lone one is under four — Apps Script does not serve
// concurrent calls to this script for nothing, so a submit that catches the wake-up
// still in flight may queue behind it. That is expected to be no WORSE than the cold
// start the submit would have paid by itself, but it has not been proven, and the
// outcome to watch is the one thing this cannot measure from here: whether the first
// sign-in of the day is really shorter. Do not describe this as a fix for the wait.
//
// This is an improvement, NOT a guarantee, and nothing may be built on it: a
// container that has gone cold again still has to wake, which is why the wait note
// in armSsoSlowNote() stays exactly where it is. Three properties are load-bearing:
//
//   • `_origFetch`, never the intercepted fetch. There is no session to carry on
//     the way to a sign-in screen, and a warm-up must not be able to touch the
//     session gate or be answered as an expiry.
//   • the response is never read and every failure is swallowed, including a
//     rejection. A warm-up that can throw, toast or log is worse than a cold start,
//     and smoke-boot's clean-console assertion is what holds that line.
//   • coalesced. Boot reaches the sign-in screen through showAuth(), which is also
//     reached by a sign-out, an expiry and a refused Google handoff — none of which
//     needs a second request, because one ping is what wakes a container.
const WARM_MIN_GAP_MS = 15000;
let _lastWarmAt = 0;

function warmBackend(opts) {
  try {
    if (shouldUseDevAuthBypass()) return;      // localhost dev has no backend to wake
    if (Date.now() - _lastWarmAt < WARM_MIN_GAP_MS) return;
    _lastWarmAt = Date.now();
    // The cache-buster is not decoration: a warm-up served from the browser cache
    // reaches nothing and wakes nothing, and would report success while doing it.
    const url = CONFIG.GAS_URL + (CONFIG.GAS_URL.indexOf('?') >= 0 ? '&' : '?')
      + 'action=ping&_=' + Date.now();
    const init = { cache: 'no-store' };
    // The one caller that navigates away in its very next statement — the Google
    // door. Without keepalive the browser is free to cancel the request as the page
    // unloads, which is precisely the request whose whole job is to still be in
    // flight while the person is over at Google picking an account.
    if (opts && opts.keepalive) init.keepalive = true;
    const p = _origFetch(url, init);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* a warm-up must never be able to break the screen it serves */ }
}

// ─── IS A NEWER BUILD DEPLOYED? ──────────────────────────────────────────────
// The owner refreshed and stayed on the old build. The reasons live in sw.js (a
// navigation served through the browser's HTTP cache, and a brand-new cache
// filled with bodies that cache had already gone stale on). What is left for the
// app is to NOTICE, and to make applying an update one deliberate tap — never an
// automatic reload, which would land mid-sentence on whoever is typing.
//
// The signal is gh-pages' own version number, read out of the DEPLOYED sw.js:
// CACHE_NAME is `ipassbook-vNN`, and APP_VERSION must equal it in the build that
// is running (`smoke-shell.mjs` fails when they disagree). So "the number in the
// served sw.js is higher than mine" is exactly "a newer build is deployed" — a
// statement about the shell, and not a guess about a worker's lifecycle. That
// distinction is the whole point: the service-worker events alone cannot answer
// this question. A browser that never re-checks `sw.js` files no `updatefound`
// at all, and the shell is stale-while-revalidate, so a device can be running
// week-old code with no event fired anywhere.
//
// The probe must reach the NETWORK. It is same-origin and not a navigation —
// exactly the shape sw.js's stale-while-revalidate branch serves out of cache —
// and the Cache API ignores a request's `cache:` mode, so `cache: 'no-store'`
// here is NOT sufficient on its own. sw.js excludes its own URL from that branch
// for this reason. The two halves are one mechanism; neither works alone.
const UPDATE_PROBE_MIN_GAP_MS  = 5 * 60 * 1000;
const UPDATE_INSTALL_SETTLE_MS = 5000;
const UPDATE_READY_MSG = 'A new version of I-PASSBOOK is ready';

const updateBannerWs   = document.getElementById('update-banner-ws');
const updateBannerAuth = document.getElementById('update-banner-auth');

// The newer version the last probe found, e.g. 'v55'. Null means "nothing newer
// found" — which is also the state before the first probe, so an offline device
// simply never sees a banner and nothing has to special-case it.
let _updateTarget = null;
// The version whose ✕ was tapped, for THIS page session only. Deliberately not
// localStorage: a stored dismissal would keep suppressing a real notice if the ✕
// happened to be tapped while a CDN edge was briefly serving a mixed build. A
// fresh open asks again, which is the behaviour asked for — a notice, not a nag.
let _updateDismissedFor = null;
let _updateTapped = false;
let _updateReloaded = false;
let _lastProbeAt = 0;
let _probing = false;

// `v55` → 55. Anything else → null, so a malformed or missing number reads as
// "no idea" and can never be mistaken for "newer".
function versionNumber(v) {
  const m = /^v(\d+)$/.exec(String(v == null ? '' : v).trim());
  return m ? parseInt(m[1], 10) : null;
}

// One writer for both slots, matching paintVersion() above. `onclick` attributes
// rather than bound listeners because the two slots would otherwise need two
// copies of the same two handlers — and because they are re-written on every
// paint, which would leak a listener each time. Top-level function declarations
// are window properties in a classic script, so the attributes resolve.
function paintUpdateBanner() {
  const show = !!_updateTarget && _updateTarget !== _updateDismissedFor;
  [updateBannerWs, updateBannerAuth].forEach(el => {
    if (!el) return;
    if (!show) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.innerHTML =
      `<span class="update-banner-text">${escHtml(UPDATE_READY_MSG)}` +
        ` <strong>${escHtml(_updateTarget)}</strong> — the app will restart.</span>` +
      `<button type="button" class="btn btn-sm update-banner-btn" onclick="applyUpdate()">Update now</button>` +
      `<button type="button" class="update-banner-x" onclick="dismissUpdateBanner()"` +
        ` title="Not now" aria-label="Not now">&times;</button>`;
    el.style.display = 'flex';
  });
}

function dismissUpdateBanner() {
  _updateDismissedFor = _updateTarget;
  paintUpdateBanner();
}

// Returns a promise for testability; every failure is silent, because a probe
// that cannot reach the network (offline, a captive portal, a slow backend) must
// look exactly like "no update" and never surface as an error on the screen.
function checkForUpdate(force) {
  if (_probing) return Promise.resolve(false);
  const now = Date.now();
  if (!force && now - _lastProbeAt < UPDATE_PROBE_MIN_GAP_MS) return Promise.resolve(false);
  _lastProbeAt = now;
  _probing = true;
  return fetch('./sw.js', { cache: 'no-store' })
    .then(r => (r && r.ok ? r.text() : ''))
    .then(text => {
      _probing = false;
      const m = /CACHE_NAME\s*=\s*['"]ipassbook-(v\d+)['"]/.exec(text || '');
      const served = m ? versionNumber(m[1]) : null;
      const mine = versionNumber(APP_VERSION);
      // STRICTLY newer, not merely different: gh-pages publishes every file in one
      // commit, but a CDN edge can serve a mixed set for a short window, and on
      // `!==` a device whose app.js was already ahead of the edge's sw.js would be
      // told to "update" to an older build.
      if (served == null || mine == null || served <= mine) return false;
      _updateTarget = 'v' + served;
      paintUpdateBanner();
      // The probe is the signal; this is what actually installs the new worker.
      // Asking now means the tap below is a reload rather than a wait.
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration()
          .then(reg => { if (reg) reg.update(); })
          .catch(() => {});
      }
      return true;
    })
    .catch(() => { _probing = false; return false; });
}

// A reload issued while a new worker is still installing is served by the worker
// being REPLACED — i.e. it lands straight back on the version being left behind,
// and the notice reappears, which reads as a broken button. So wait for the
// handover to settle first, but never longer than someone will accept after
// pressing Update.
function waitForInstallToSettle(reg) {
  return new Promise(resolve => {
    const deadline = setTimeout(resolve, UPDATE_INSTALL_SETTLE_MS);
    const settle = () => {
      if (reg.installing || reg.waiting) return;
      clearTimeout(deadline);
      resolve();
    };
    [reg.installing, reg.waiting].forEach(w => {
      if (w && typeof w.addEventListener === 'function') w.addEventListener('statechange', settle);
    });
    settle();
  });
}

function reloadOnce() {
  if (_updateReloaded) return;
  _updateReloaded = true;
  try { location.reload(); } catch (e) { /* nothing left to try */ }
}

function applyUpdate() {
  // The tap is consent to restart the APP. It is not consent to lose a save that
  // is still in flight.
  if (_savesInFlight.size > 0) { showToast('Still saving — try again in a moment.'); return; }
  // The admin modal keeps its pending department ticks in the DOM and nowhere else
  // — savePeopleMatrix() reads them back out of the table — so a reload discards
  // them silently. A section draft is the opposite case (localStorage, restored by
  // restoreDrafts()), but it still gets a prompt: "your entries are safe" is not
  // something anyone should have to find out afterwards.
  if (document.getElementById('access-modal') &&
      !confirm('Discard the unsaved changes in User Access and update now?')) return;
  if (hasAnyDraft() &&
      !confirm('Your unsaved entries are kept and restored after the restart. Update now?')) return;

  _updateTapped = true;
  const ready = (navigator.serviceWorker && navigator.serviceWorker.getRegistration)
    ? navigator.serviceWorker.getRegistration()
    : Promise.resolve(undefined);
  Promise.resolve(ready)
    .then(reg => {
      if (!reg) return null;
      return waitForInstallToSettle(reg).then(() => reg.update());
    })
    .catch(() => {})
    .then(() => reloadOnce());
}

// A belt for the case where the handover lands just after the settle deadline
// above expired. It can NOT be the trigger: sw.js calls skipWaiting(), so this
// fires the moment a new worker installs — usually long before anyone asked for
// anything — and reloading on it unconditionally would reload a page nobody
// clicked (and would break the intro timing smoke-boot.mjs pins). The flag is the
// whole guard.
if (navigator.serviceWorker && typeof navigator.serviceWorker.addEventListener === 'function') {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (_updateTapped) reloadOnce(); });
}

function startUpdateWatch() {
  checkForUpdate();
  // A phone RESUMES an installed app far more often than it navigates it, and iOS
  // does not guarantee visibilitychange on a restored standalone page, so all
  // three signals are wired. The throttle inside checkForUpdate makes the
  // redundancy free: three prompts to look again still cost at most one request.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('pageshow', e => { if (e && e.persisted) checkForUpdate(); });
  window.addEventListener('focus', () => checkForUpdate());
}

// Exchange email + password for a server session token + access payload.
// Stores the session, clears any stale sessionError, and returns the backend's
// parsed {status,...} so the caller can surface the real rejection reason.
// Uses _origFetch (not the intercepted fetch) so the login call isn't subject to
// the session gate, and so a bad password can't trigger the auto-logout path.
//
// TWO-STAGE. Without `code`, a correct password does NOT buy a session: the
// backend answers {status:'ok', otpRequired:true} and emails a 6-digit code. The
// caller then calls again with the same password AND the code. The password is
// re-sent rather than a half-open server-side conversation being kept, so a
// signed-in session only ever exists at the end of a fully-verified exchange.
//
// A successful login on a temporary password returns mustChangePassword with NO
// token — the caller must route to the password-change screen, not into the app.
// A short description of this browser, for the sign-in audit (`reportRecentSignins`
// in the backend prints it). The point is to make "this account signed in from two
// places" visible, so it only has to be recognisable to a human — it is what the
// browser CLAIMS, which makes it a clue and not proof. Kept coarse on purpose: an
// exact version string is noise in a log, and 'Android · Chrome' vs 'Windows · Edge'
// is the distinction that actually gets looked for.
function deviceLabel() {
  const ua = navigator.userAgent || '';
  const os =
    /Android/i.test(ua) ? 'Android' :
    /iPhone|iPad|iPod/i.test(ua) ? 'iOS' :
    /Windows/i.test(ua) ? 'Windows' :
    /Mac OS X/i.test(ua) ? 'Mac' :
    /Linux/i.test(ua) ? 'Linux' : 'unknown OS';
  // Order matters: Edge's UA carries Chrome and Safari, Chrome's carries Safari, and
  // an iOS Chrome carries Safari too — so the most specific test has to come first.
  const br =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\/|Opera/.test(ua) ? 'Opera' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' : 'unknown browser';
  const installed = window.matchMedia?.('(display-mode: standalone)').matches ? ' · home-screen app' : '';
  return os + ' · ' + br + installed;
}

function loginBackend(email, password, code) {
  // The password may legitimately be EMPTY — that is the passwordless door, where
  // stage 1 (no code) asks for a code and stage 2 (code) redeems it. Only the
  // email is mandatory everywhere.
  if (!email) return Promise.resolve({ status: 'error', message: 'Enter your email.' });
  const fd = new FormData();
  fd.append('action', 'login');
  fd.append('email', email);
  fd.append('password', password);
  if (code) fd.append('code', String(code).trim());
  // Sent on both steps; the backend only records it on the one that mints the
  // session. An older cached app.js sends nothing, and the audit line says
  // "device not reported" rather than failing.
  fd.append('device', deviceLabel());
  // The build this device is RUNNING, so the admin's Versions list can answer
  // "who is still on the old one?" without anyone being asked. It rides a request
  // that is already being made and a user record that is already being rewritten
  // on every sign-in, so it costs nothing. The backend validates the shape and
  // keeps the last known value when this is absent — a device whose cached app.js
  // cannot report a version is exactly the device worth seeing in that list, so
  // "unknown" must not overwrite a real answer.
  fd.append('version', APP_VERSION);
  const doFetch = postJson(_origFetch, fd)
    .then(data => {
      if (data && data.status === 'ok' && data.sessionToken) {
        currentUser.sessionToken = data.sessionToken;
        // backend nests the access payload under data.access (the getMyAccess
        // return). Without this, currentUser.access would be all-undefined.
        const a = (data && data.access) || {};
        currentUser.access = { role: a.role, permissions: a.permissions, departments: a.departments || [], triage: a.triage === true };
        currentUser.sessionError = null;   // clear any stale reason on a real mint
        persistSession(data.sessionToken);
        return data;
      }
      // Step 1 done: the password was right and a code is on its way. This has to
      // pass through BEFORE the error branch below, like mustChangePassword —
      // swallowing it there would report "Login failed." for a correct password.
      if (data && data.status === 'ok' && data.otpRequired) return data;
      // A temporary password is CORRECT but is not yet a session: the backend
      // answers {status:'ok', mustChangePassword:true} with NO token, and the
      // caller routes to the password-change screen. This has to pass through
      // BEFORE the error branch below — swallowing it there is what made every
      // first sign-in on a temp password report "Login failed." with the right
      // password in the box.
      if (data && data.status === 'ok' && data.mustChangePassword) return data;
      // Pass the backend's own error message through (e.g. "Wrong password.").
      currentUser.sessionError = (data && data.message) ? data.message : 'Login failed.';
      return data && data.message
        ? { status: 'error', message: data.message }
        : { status: 'error', message: 'Login failed.' };
    })
    .catch(err => ({ status: 'error', message: 'Network error: ' + (err && err.message ? err.message : 'unable to reach backend') }));
  // Hard backstop, so a hung fetch can never leave the caller waiting forever.
  //
  // 45s, and NOT the 15s it used to be. Apps Script is the slowest thing in this
  // stack and sign-in is its slowest call: the container cold-starts on the first
  // request after every backend deploy (measured 2026-09-17 — a 40s+ round trip
  // for the trivially cheap `ping`, 3-5s warm, ~7s for a login POST that does no
  // work at all), and the code step then sends mail synchronously on top. At 15s a
  // cold sign-in was reported as "Login timed out — check your connection" while
  // the backend was working fine — which reads as a broken app and sends the user
  // off to check a connection that was never the problem. Waiting longer is the
  // cheaper failure: the button is disabled and says "Signing in…" meanwhile.
  return Promise.race([
    doFetch,
    new Promise(r => setTimeout(() => r({ status: 'error', message: 'Login timed out — check your connection' }), 45000)),
  ]);
}

// ─── ONE PLACE THAT READS A BACKEND REPLY ─────────────────────────────────────
// Every self-authenticating POST in this file lands here, because they share one
// failure that is NOT the backend's fault. Apps Script answers a /exec call with a
// 302 to script.googleusercontent.com, and that second hop intermittently comes
// back 404 carrying a Google HTML page — "Sorry, unable to open the file at
// present" — which has nothing to do with this app and no JSON in it.
//
// It is intermittent, not a deployment fault, and the honest evidence is the same
// call behaving differently on two devices minutes apart: on 2026-09-30 the owner
// signed in from a phone, while the identical request from a laptop — same shell,
// same URL, verified byte-for-byte against what gh-pages serves — came back as
// that HTML page and surfaced as "Bad response from server." The old code turned
// every such reply into one opaque sentence and gave up.
//
// So a reply that will not parse is retried ONCE, as a fresh request (following
// the dead redirect again would only 404 again). A JSON reply is never retried,
// including the backend's own errors: JSON proves the script ran, and re-sending
// a redeemed code or a rejected password would be worse than reporting it.
//
// The HTTP status is carried into the message. "Bad response from server" told
// nobody which hop failed; "(HTTP 404)" says the edge, not the script, and turns
// the next report into something answerable.
//
// `retries` is NOT always 1 — see CREDENTIAL_SPENDING_ACTIONS below. Retrying is
// only safe for a call whose credential survives a second attempt.
function postJson(fetchFn, fd, retries) {
  const attempt = (left) => fetchFn(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.text().then(t => {
      // Apps Script returns JSON after a redirect; parse what came back.
      try { return JSON.parse(t); }
      catch (e) {
        if (left > 0) return attempt(left - 1);
        const http = (r && typeof r.status === 'number') ? ' (HTTP ' + r.status + ')' : '';
        return { status: 'error', message: 'The server sent an unexpected reply' + http + '. Please try again.' };
      }
    }))
    .catch(err => ({ status: 'error', message: 'Network error: ' + (err && err.message ? err.message : 'unable to reach backend') }));
  return attempt(retries === undefined ? 1 : retries);
}

// Actions whose credential the FIRST attempt spends. A retry on one of these cannot
// recover a lost reply — it can only destroy an attempt that already worked.
//
// This is not theoretical. The retry shipped on 2026-09-30 without this list and
// broke the Google door the same evening: attempt one redeemed the handoff code and
// minted the session, the reply was lost to the same edge hop the retry exists for,
// and attempt two came back "That Google sign-in link is no longer valid" — for a
// code it had just burned itself, while a perfectly good session was discarded with
// it. The emailed-code door looked fine throughout, because ITS code is reusable.
//
// The distinction is the code's, not the call's, so it is stated once here and read
// off the backend's own rules (backend.gs, CODES):
//   'login'  — 8h30m, REUSABLE inside the window, so a second attempt re-redeems the
//              same code and cannot burn it. Deliberately NOT in this list.
//   'reset'  — single use. IN this list.
//   'google' — one-time, burned on the FIRST look whatever the outcome. IN this list.
// A device token is not consumed, so deviceUnlock and the register/revoke pair are
// safe to retry. changePassword has no code at all.
const CREDENTIAL_SPENDING_ACTIONS = {
  googleExchange: true,
  resetPassword:  true,
  // A retry here would issue a SECOND code and retire the first, so the mail the
  // person is about to read could be the one that no longer works.
  forgotPassword: true,
};

// POST helper for every self-authenticating auth call (the password lifecycle).
// Goes through _origFetch so it carries no session token and can never trip the
// session gate — a wrong reset code must not look like an expired session.
function postAuth(action, fields) {
  const fd = new FormData();
  fd.append('action', action);
  Object.keys(fields).forEach(k => fd.append(k, fields[k]));
  return postJson(_origFetch, fd, CREDENTIAL_SPENDING_ACTIONS[action] ? 0 : 1);
}

// Set a new password. Used both for the forced first-login change (currentPassword
// is the admin's temporary password) and for a password the user chose to change.
// Returns a session token on success — the only path that mints one for an account
// still flagged Must Change Password.
function changePasswordBackend(email, currentPassword, newPassword) {
  if (!email || !currentPassword || !newPassword) {
    return Promise.resolve({ status: 'error', message: 'Enter your current and new password.' });
  }
  if (newPassword.length < 8) {
    return Promise.resolve({ status: 'error', message: 'New password must be at least 8 characters.' });
  }
  return postAuth('changePassword', { email, currentPassword, newPassword });
}

function forgotPasswordBackend(email) {
  if (!email) return Promise.resolve({ status: 'error', message: 'Enter your email.' });
  return postAuth('forgotPassword', { email });
}

function resetPasswordBackend(email, code, newPassword) {
  if (!email || !code || !newPassword) {
    return Promise.resolve({ status: 'error', message: 'Enter the code and your new password.' });
  }
  if (newPassword.length < 8) {
    return Promise.resolve({ status: 'error', message: 'New password must be at least 8 characters.' });
  }
  return postAuth('resetPassword', { email, code, newPassword });
}

// ─── GOOGLE SIGN-IN — the same backend, reached by NAVIGATION ─────────────────
//
// See CONFIG.SSO_URL for why this is a second deployment. The part worth knowing
// here is why this door is a NAVIGATION and not a fetch, because the first version
// of it was a fetch and could never have worked: a page on gh-pages calling the
// domain-restricted deployment gets **401** from Google before our code runs, since
// the caller's Google session is not attached to a cross-site background request.
// The same URL opened as a navigation reports the caller perfectly. So:
//
//   click → the page goes to the door → the door sends it straight back to
//   CONFIG.APP_URL with a one-time code in the FRAGMENT (`#sso=…`) →
//   googleExchangeBackend swaps that code for a session, on the MAIN deployment,
//   which is "Anyone" and therefore reachable from here.
//
// The fragment, not a query string, on purpose: fragments are never sent to a
// server, so the code cannot land in a log or a Referer header. It is single-use
// and dies after two minutes. We strip it from the address bar immediately.

// Where the click goes. No parameters: the return address is a server-side
// constant, so there is no client-supplied URL for anyone to redirect.
//
// It goes to GOOGLE'S OWN ACCOUNT PICKER first, with the door as the address to
// come back to — not straight to the door. The reason is a phone with more than one
// Google account signed in: Apps Script web apps are served the browser's DEFAULT
// account and there is no way to ask it for another one, so a personal account
// being the default does not merely sign the wrong person in — Google refuses the
// request to the domain-restricted door before any of our code runs, and the person
// is left on a Google error page with nothing they can do about it. Letting them
// choose first is the only place that can be fixed from. It costs one tap, and the
// door still names the account afterwards, so the tap confirms rather than guesses.
//
// The picked account has to survive the hop to the door; that is Google's side of
// this, and it is the one thing not verifiable from here. If it does not, the door
// says so on its own page rather than signing the wrong person in.
function googleStartUrl() {
  const door = CONFIG.SSO_URL + '?action=googleStart';
  return 'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(door);
}

// Swap the handoff code for a session. A POST to the MAIN backend via postAuth,
// which uses _origFetch — so no session token is ever attached. That matters on a
// shared machine: the credential here is the handoff code, and riding the previous
// person's I-PASSBOOK token along would be the exact hole this door must not have.
function googleExchangeBackend(code) {
  if (!code) return Promise.resolve({ status: 'error', message: 'Google sign-in did not return a code.' });
  return postAuth('googleExchange', { code, device: deviceLabel(), version: APP_VERSION });
}

// What the door sent back, read ONCE at boot and then wiped from the address bar.
//
// Read synchronously at parse time, before anything can navigate or re-route: the
// app routes by hash, so `#sso=…` and `#ssoerr=…` are transient values that share a
// namespace with `#/tickets` and must not survive into a route.
//
// replaceState rather than assigning location.hash, because assigning would push a
// history entry: the back button would then return to a URL whose code is already
// spent, which reads as "that link is no longer valid" on a sign-in that worked.
function checkHandoff() {
  const h = location.hash || '';
  let out = null;

  // 1. Try to get from URL hash
  if (h.indexOf('#sso=') === 0) {
    out = { code: decodeURIComponent(h.slice(5)) };
  } else if (h.indexOf('#ssoerr=') === 0) {
    out = { error: decodeURIComponent(h.slice(8)) || 'Google sign-in failed.' };
  }

  // 2. Fallback to sessionStorage if no hash is present
  if (!out) {
    try {
      const storedCode = sessionStorage.getItem('pending_sso_code');
      if (storedCode) {
        out = { code: storedCode };
      }
    } catch (e) { /* storage blocked */ }
  }

  if (!out) return null;

  // 3. If we found a code, persist it immediately to survive reloads
  if (out.code) {
    try { sessionStorage.setItem('pending_sso_code', out.code); } catch (e) { /* storage blocked */ }
  }

  // 4. Clean up the URL bar immediately to avoid replay/history issues
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) { /* ignore */ }

  return out;
}

function isHandoffReturn() {
  return !!checkHandoff();
}


// Refresh the caller's role/permissions from the backend (boot + after department
// changes). Best-effort — a failure leaves the previous access in place, and the
// gating fallback is view-only, so a failed refresh can never grant edit.
function refreshMyAccess() {
  if (!currentUser || !currentUser.sessionToken) return Promise.resolve(null);
  const url = CONFIG.GAS_URL + (CONFIG.GAS_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=getMyAccess';
  return fetch(url).then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.status === 'ok') {
        currentUser.access = {
          role: data.role,
          permissions: data.permissions,
          departments: data.departments || [],
          // Absent on an older backend means no Triage — the fail-closed default,
          // which is the right direction for a permission.
          triage: data.triage === true,
        };
        return data;
      }
      return null;
    })
    .catch(() => null);
}

const _origFetch = window.fetch.bind(window);
let _authToastShown = false;       // one "session expired" hint per page session
let _authSuspect = false;          // latched — at most one liveness probe per suspicion

// Attaches the session token + email to every backend call, and decides what a
// rejection MEANS. Four rules, and the first three exist to make the fourth rare:
//
//   1. Any good response clears suspicion.
//   2. Only a PARSEABLE JSON `unauthorized`, on a call that actually carried a
//      token, may even start an ejection. An HTTP error, an HTML error page
//      (which is what a GAS failure returns) or a CORS failure never can.
//   3. On suspicion, touch NOTHING locally — ask the server via
//      confirmSessionAlive(), which answers "alive" when it cannot reach it.
//   4. Only then eject: an inline retry inside the admin modal (where a full
//      sign-out would lose the admin's unsaved work), a re-login elsewhere.
//
// What this replaces: a single unauthorized anywhere wiped storage and showed the
// login screen, while the 90-second comment poll kept firing into a dead session
// and re-arming it. That loop — not the token's lifetime — is why the User Access
// page kept demanding a sign-in.
window.fetch = function (input, init) {
  return (async () => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isGAS = url.indexOf(CONFIG.GAS_URL) === 0;
    if (!isGAS) return _origFetch(input, init);

    // Dev bypass (localhost + ?dev=1): no real account, so backend calls aren't
    // authorized and fall back to demo data. MUST stay before the token logic —
    // there is no session to attach and nothing to eject. smoke-boot.mjs depends
    // on this ordering.
    if (shouldUseDevAuthBypass()) return _origFetch(input, init);

    // The auth calls authenticate themselves (credentials in the body) and must
    // never be subject to the session gate below.
    //
    // googleExchange is listed for the same reason as login: its credential is the
    // one-time handoff code minted by the Google door, and there is no I-PASSBOOK
    // token to check yet. Without this, the exchange would ride whatever token was
    // left on the machine — and on a shared laptop that is the previous person's
    // session, which is the exact hole this door must not have. It also keeps a
    // spent handoff code from being answered as "your session expired".
    const isAuthCall = /[?&]action=(login|changePassword|forgotPassword|resetPassword|logout|sessionCheck|ping|googleExchange|deviceUnlock)\b/.test(url);

    const sessionToken = (currentUser && currentUser.sessionToken) || null;
    const email = (currentUser && currentUser.email) || '';
    const isFormData = init && init.body && init.body instanceof FormData;
    const origBody = isFormData ? init.body : null;

    const appendAuth = (fd) => {
      if (sessionToken) fd.append('sessionToken', sessionToken);
      if (email) fd.append('userEmail', email);
    };

    let resp;
    if (isAuthCall) {
      resp = await _origFetch(input, init);
    } else if (isFormData) {
      // FormData() only accepts an HTMLFormElement, so copy entries by hand.
      const fd = new FormData();
      for (const [k, v] of origBody.entries()) fd.append(k, v);
      appendAuth(fd);
      resp = await _origFetch(url, Object.assign({}, init, { body: fd }));
    } else {
      const sep = url.indexOf('?') >= 0 ? '&' : '?';
      let q = '';
      if (sessionToken) q += (q ? '&' : '') + 'sessionToken=' + encodeURIComponent(sessionToken);
      if (email) q += (q ? '&' : '') + 'userEmail=' + encodeURIComponent(email);
      resp = await _origFetch(url + (q ? sep + q : ''), init);
    }

    // Rule 2 — nothing below may run unless a token was actually presented.
    if (!resp || !resp.ok || isAuthCall || !sessionToken) return resp;

    let data = null;
    try { data = await resp.clone().json(); }
    catch { _authSuspect = false; return resp; }        // HTML/opaque body → never eject

    const isUnauthorized = data && data.status === 'error'
      && String(data.message || '').toLowerCase().indexOf('unauthorized') === 0;
    if (!isUnauthorized) { _authSuspect = false; return resp; }   // rule 1

    // Rule 3 — ask the server, having changed nothing locally.
    if (_authSuspect) return resp;                       // a probe is already in flight
    _authSuspect = true;
    const alive = await confirmSessionAlive();
    _authSuspect = false;
    if (alive) return resp;                              // a false alarm — carry on

    // Rule 4 — confirmed dead.
    if (!_authToastShown) {
      _authToastShown = true;
      showToast('Session expired — please sign in again');
    }
    // Inside the admin modal, a full sign-out would throw away unsaved edits and
    // is what made this page feel like it was nagging. Offer a retry instead.
    if (document.getElementById('access-modal')) {
      renderAccessReconnect(String(data.message || ''));
      return resp;
    }
    clearLocalAuth();
    currentUser = null;
    if (typeof showAuth === 'function') showAuth();
    return resp;
  })();
};
let allIRs      = [];          // master list fetched from GAS
let currentIR   = null;        // the IR open in detail view
let currentSectionData = {};   // cached data for open passbook
let legacyMap   = {};          // irNumber -> { label, gid, openUrl } for legacy IRs (≤~IR441)

// ─── ADMIN (config editors + access managers) ─────────────────────────────────
// Admins bypass every permission check and are the only accounts that can
// provision people or set department grants. Must match backend
// CONFIG.ADMIN_EMAILS.
const ADMIN_EMAILS = [
  'monish.raza@indrones.com',
];
function isAdmin() {
  const email = currentUser?.email?.toLowerCase().trim();
  if (!email) return false;
  if (ADMIN_EMAILS.includes(email)) return true;
  // The local dev user (?dev=1) needs admin UI to test the access modal. The guard
  // must match the bypass's own conditions EXACTLY — it used to be just the email,
  // so a tampered `ipb_user` in localStorage made isAdmin() true on the live site
  // even though shouldUseDevAuthBypass() was false. That only showed admin chrome
  // (every backend call still returned Unauthorized, since the backend knows one
  // admin) but two definitions of "admin" that disagree is a trap for later.
  if (email === `dev@${CONFIG.ALLOWED_DOMAIN}` && shouldUseDevAuthBypass()) return true;
  return false;
}
// Kept as an alias so existing Section B code reads naturally.
const isInwardAdmin = isAdmin;

// ─── ACCESS CONTROL (view + comment for everyone; edit from departments) ──────
// `currentUser.access` is populated by loginBackend / refreshMyAccess:
//   { role: 'admin'|'user', permissions: { 'sec-b':'edit', … }, departments: [], triage: bool }
//
// `triage` is a SEPARATE axis, not a seventh permission key: a department can hold
// it without editing any section (CR and Management do). `permissions[OVERVIEW_KEY]`
// still exists so the Overview's inputs gate through the ordinary canEdit() seam.
//
// The fallback below must fail CLOSED on writes and OPEN on reads: view+comment
// everywhere, edit nowhere. If access hasn't arrived yet (first paint, a
// transient getMyAccess failure) the worst case is a disabled Save button the
// user retries — never an unauthorised write, and never a locked-out screen.
// The backend enforces independently, so a wrong guess here costs a button.
// The six LIVE sections, letters B–G. There is no Section A: its content moved to
// the Overview panel, whose data still lives under the `sec-a` key in APP_DATA
// (see OVERVIEW_KEY below). `sec-h` and `sec-i` no longer exist either — they were
// merged into `sec-f` (Quality Test Report) and `sec-g` (PDI Report/Dispatch
// Record), and backend.gs migrated their rows.
const SECTION_IDS = ['sec-b','sec-c','sec-d','sec-e','sec-f','sec-g'];
// The Overview panel is not a section — it has no tab, no letter and no
// completion state — but it is still a record in APP_DATA, still gated, and
// still resolved by field prefix. Keeping the original `sec-a` id means existing
// rows, drafts and AUDIT_LOG history all keep working untouched.
const OVERVIEW_KEY = 'sec-a';
function myAccess() {
  if (currentUser && currentUser.access) return currentUser.access;
  const viewOnly = {};
  SECTION_IDS.forEach(s => { viewOnly[s] = 'view'; });
  viewOnly[OVERVIEW_KEY] = 'view';
  // `triage: false` is spelled out rather than left undefined so the
  // fail-closed intent is visible at the call site: this profile is what the app
  // uses before real access arrives, and it must never confer Triage.
  return { role: isAdmin() ? 'admin' : 'user', permissions: viewOnly, departments: [], triage: false, __fallback: true };
}
function canViewSection(secId)    { const a = myAccess(); if (a.role === 'admin') return true; const v = a.permissions && a.permissions[secId]; return v === 'view' || v === 'comment' || v === 'edit'; }
// Comment comes WITH view — every signed-in user can comment on every section.
function canCommentSection(secId) { const a = myAccess(); if (a.role === 'admin') return true; const v = a.permissions && a.permissions[secId]; return v === 'view' || v === 'comment' || v === 'edit'; }
function canEditSection(secId)    { const a = myAccess(); if (a.role === 'admin') return true; return !!(a.permissions && a.permissions[secId] === 'edit'); }
// Triage is a SEPARATE axis from section edit rights, not a seventh "section".
// It governs the IR header — status, assignee, priority, category — and the two
// Overview fields. A department can hold it without editing any section, which
// is exactly what CR and Management do. Admin always has it.
function canTriage()              { const a = myAccess(); if (a.role === 'admin') return true; return a.triage === true; }

// ─── SENTINEL STORES ─────────────────────────────────────────────────────────
// App-owned records that live outside the 9 workflow sections. They are saved
// under an `irNumber` beginning with `__`, which backend.gs exempts from ALL
// per-section ACL checks — so a brand-new store works against the deployed
// backend with no redeploy, exactly as __CONFIG__ and __NUDGES__ already do.
// `sectionId` becomes each record's own key:
//
//   __CONFIG__ / team-directory    → { entries: [{name,email}] }
//   __CONFIG__ / inward-options    → { options: {…} }
//   __CONFIG__ / iqc-config        → { zones, resultOptions }
//   __CONFIG__ / canned-responses  → { items: [{id,label,body}] }   (Stage 6)
//   __CONFIG__ / sla               → { targets, pausedStatuses }    (Stage 4)
//   __IRS__    / <irNumber>        → app-owned workflow state       (Stage 1)
//   __KB__     / <articleId>       → { title, body, … }             (Stage 7)
//   __NUDGES__ / all               → { items: [comment, …] }
//
// getPassbook returns EVERY row matching one irNumber, keyed by sectionId, so a
// single request reads a whole store. That is why per-IR workflow state is one
// row per IR rather than one map record: each record gets its own ~50,000-char
// cell (no ceiling), and two people editing two different IRs never clobber
// each other.
//
// Caveat worth knowing before adding more: a sentinel-irNumber row is readable
// and writable by ANY signed-in user. Treat these as shared scratch space, not
// as access-controlled storage.

// Read one record. Resolves to the parsed fields object, or null when the
// record does not exist or the backend is unreachable.
function loadSentinel(irNumber, sectionId) {
  return fetch(`${CONFIG.GAS_URL}?action=getPassbook&irNumber=${encodeURIComponent(irNumber)}`)
    .then(r => r.json())
    .then(data => (data && data.status === 'ok' && data.sections) ? (data.sections[sectionId] || null) : null)
    .catch(() => null);
}

// Read every row of a store in one request, keyed by sectionId. Resolves to
// `null` when the read FAILED and `{}` when it succeeded but the store is empty
// — callers must tell those apart before treating a store as authoritative.
function loadSentinelAll(irNumber) {
  return fetch(`${CONFIG.GAS_URL}?action=getPassbook&irNumber=${encodeURIComponent(irNumber)}`)
    .then(r => r.json())
    .then(data => (data && data.status === 'ok' && data.sections) ? data.sections : null)
    .catch(() => null);
}

// Upsert one record. Never rejects — resolves to {ok:false} on a dead backend so
// an optimistic local write is not rolled back by an unrelated network blip.
function saveSentinel(irNumber, sectionId, fields) {
  const fd = new FormData();
  fd.append('action', 'saveSection');
  fd.append('irNumber', irNumber);
  fd.append('sectionId', sectionId);
  fd.append('savedBy', myEmail() || 'unknown');
  fd.append('fields', JSON.stringify(fields));
  fd.append('files', JSON.stringify([]));
  return fetch(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.json())
    .catch(() => ({ status: 'error' }));
}

// ─── __IRS__ — APP-OWNED WORKFLOW STATE ──────────────────────────────────────
// The Sheet is the immutable client intake (what the customer wrote); the app
// owns everything mutable — status, assignee, priority, category, which sections
// are done, CSAT. One row per IR, keyed by irNumber.
//
// OWNERSHIP OF THE STATUS IS TOTAL, AND EVERY TICKET BEGINS AT OPEN. The Sheet is the
// client's intake record — what the customer wrote, and nothing else. Its Col D is not
// read as a stage at all any more: it rides along as `initialStatus`, the customer's own
// words, and no ticket's workflow ever starts from it. That is what "the bridge between
// status updating via sheet has to stop" means in code, taken to its end.
//
// A ticket the app holds no row for reads 'Open' (applyIRStateToAllIRs). That 'Open' is
// DERIVED, not stored — which is why nothing seeds a ticket on first sight any more. A
// row exists only once a human has allotted a stage through Allot CAPS or a section's
// move-on offer, so every status in the store is one a person chose. CR allots every
// ticket by hand; the app's job is to remember what they said, not to guess it.
const IR_STATE_IR = '__IRS__';
let irState = {};             // irNumber -> { status, statusOwned, statusAt, statusBy,
                              //              assignee, priority, category, subCategory, done[], … }
let irStateSyncedAt = null;   // Date of the last successful __IRS__ read
// True while `allIRs` holds the demo sample because BOTH the Sheet and the backend
// refused to sync. Only the Insights page reads it: a fabricated card in the IR list
// is self-evidently a placeholder, but "CRASH: 2" on a dashboard is a number
// somebody could quote.
let _dataIsDemo = false;

// The row for one IR, but only if a human has actually edited it. A row that
// holds nothing but the first-sight seed is a marker, not an edit.
function appState(irNumber) {
  const s = irState[irNumber];
  if (!s || !s.updatedBy) return null;
  return s;
}

// The stage the app holds for this ticket, or '' when it holds none — which means
// the ticket has never been opened here and the merge will give it the Sheet's
// starting stage instead. Deliberately separate from appState(): saving Section B
// is a real edit but not triage, and it must not be mistaken for one.
//
// It reads `status`, not a `statusOwned` flag. The flag belonged to the era when
// the app only owned a status a human had chosen here; now that the app owns every
// ticket it has seen, the flag would be true everywhere and mean nothing. Rows in
// the store still carry it and are left alone — a stored key is data.
function ownedStatus(irNumber) {
  const s = irState[irNumber];
  return (s && s.status) ? s.status : '';
}

// There is deliberately NO first-sight writer here. Until 2026-10-03 a ticket was
// SEEDED the first time the app opened it: the Sheet's Col D was read, folded into the
// ten, and stored as the app's own starting stage (`seedIRState`, rows still carrying
// `seededFrom: 'sheet'`). That made an untriaged ticket's stage depend on a column the
// desk had stopped maintaining, and it made "the app owns this" true of a stage nobody
// here had ever chosen.
//
// It is gone. A ticket with no row reads 'Open' by derivation, and the first stage a
// ticket ever holds is the one a person gives it. No migration was run against the rows
// already seeded — CR is reviewing and re-allotting every ticket by hand, so those rows
// are corrected by the people who own them rather than by a script.

// Read the whole store once at boot. On failure the existing `irState` is kept
// rather than wiped — an empty store and an unreachable backend look identical
// from here, and treating a failed read as "no app state" is exactly how an
// app-owned status gets silently re-seeded from the Sheet.
async function loadIRState() {
  const sections = await loadSentinelAll(IR_STATE_IR);
  if (sections === null) return;
  irState = {};
  Object.keys(sections).forEach(ir => {
    const row = sections[ir];
    if (row && typeof row === 'object' && !Array.isArray(row)) irState[ir] = row;
  });
  irStateSyncedAt = new Date();
  applyIRStateToAllIRs();
  if (currentView === 'detail' && currentIR) {
    renderBannerMeta();
    // `done` lives in this store, and it arrives on its own slower read — so a
    // section can already be on screen (built by buildSectionForms) before the
    // closed state is known. Painting here too is what stops a closed section
    // from looking open on a cold open.
    paintClosedSections(currentIR.irNumber);
  }
  // Re-render only once the list has actually arrived. This runs alongside the
  // first fetchIRs(), and rendering an empty list here would replace the boot
  // skeletons with "0 total" for a frame.
  if (allIRs.length) applyListFilters();
  // The overlay carries `category`, which is a dashboard dimension, and it lands
  // AFTER the list — so the dashboard has to be repainted here too or it would
  // count a list whose categories have not arrived yet.
  renderInsights();
}

// The single writer of `allIRs`. Every fetchIRs() path goes through it so
// app-owned state is merged exactly once, after the Sheet/demo data lands, and
// the three paths can never disagree about precedence.
function setAllIRs(records) {
  allIRs = Array.isArray(records) ? records : [];
  applyIRStateToAllIRs();
  // The dashboard counts these same rows, so every fetch path repaints it here —
  // the Sheet read, the GAS fallback, the demo fallback and an in-page re-login.
  // It is a no-op while the pane is not showing, and it re-emits the skeleton when
  // the list is empty, so a failed fetch cannot leave yesterday's numbers standing.
  renderInsights();
  return allIRs;
}

// Overlay app-owned state on the Sheet-derived records. Precedence: app > Sheet.
// This is what fixes the badge bug — the list badge used to read Col D while an
// in-app status edit wrote to a field the badge never looked at.
function applyIRStateToAllIRs() {
  allIRs.forEach(ir => {
    const owned = ownedStatus(ir.irNumber);
    // UNCONDITIONAL, so every record leaves here holding one of the ten. The app's own
    // stage wins whenever it holds one; with none the ticket is **Open**, because
    // nobody here has allotted it yet and Open is what "not yet allotted" means.
    //
    // `initialStatus` is deliberately NOT consulted. It used to be the fallback — the
    // Sheet's Col D folded into the ten — which meant a legacy ticket wore a stage the
    // desk had stopped maintaining, and could be moved by a Sheet edit the app never
    // saw. It is now carried and nothing else: it is read by no line of this file.
    ir.status = owned || 'Open';
    const s = appState(ir.irNumber);
    if (!s) return;
    ir.statusAt     = s.statusAt     || null;
    ir.assignee     = s.assignee     || '';
    ir.assigneeName = s.assigneeName || '';
    if (s.priority) ir.priority = s.priority;
    // Unconditional assignment, not `if (s.category)`: a cleared category must
    // land as '' here, or the previous value would stay on the in-memory row and
    // the list would keep showing a category the store no longer holds.
    ir.category      = s.category      || '';
    ir.subCategory   = s.subCategory   || '';
    ir.subCategoryNote = s.subCategoryNote || '';
    // Filter against the LIVE ids. The store still holds historical `sec-a`,
    // `sec-h` and `sec-i` entries until the migration remaps them, and a
    // completion marker for a section that no longer exists would render as a
    // progress row nobody can name.
    ir.done = Array.isArray(s.done) ? s.done.filter(id => SECTION_IDS.includes(id)) : [];
  });
}

// Merge a patch into one IR's row: update memory first so the UI is instant,
// then persist. Returns the merged row.
async function patchIRState(irNumber, patch) {
  const next = {
    ...(irState[irNumber] || {}),
    ...patch,
    updatedAt: Date.now(),
    updatedBy: myEmail() || 'unknown',
  };
  // Drop the seed marker's influence — this row is now a real edit.
  delete next.seededAt;
  delete next.seededFrom;
  delete next.seededBy;
  irState[irNumber] = next;
  applyIRStateToAllIRs();
  if (currentView === 'detail' && currentIR?.irNumber === irNumber) renderBannerMeta();
  // Same guard as loadIRState: an IR can be opened by deep link before the
  // list has loaded, and there is nothing to re-render until it does.
  if (allIRs.length) applyListFilters();
  const res = await saveSentinel(IR_STATE_IR, irNumber, next);
  if (res && res.status === 'ok') irStateSyncedAt = new Date();
  else showToast('Saved locally — backend unreachable, will not reach other users');
  return next;
}

// Add a section to this IR's completion set. Called from the section-save path,
// which is the only place that knows a section was actually saved.
function markSectionDone(irNumber, sectionId) {
  const row = irState[irNumber] || {};
  // Always filter against SECTION_IDS on the way OUT, in both directions. This
  // return value is what the caller writes back via patchIRState, so an unfiltered
  // list would let a retired id inherited from a stale or partially-migrated store
  // survive every subsequent save — the filter would only ever run for the one
  // retired id that happened to be passed in.
  const done = (Array.isArray(row.done) ? row.done : []).filter(id => SECTION_IDS.includes(id));
  // Only live sections are completable. The Overview is deliberately not one, and a
  // retired id must never be able to re-enter the list.
  if (SECTION_IDS.includes(sectionId) && !done.includes(sectionId)) done.push(sectionId);
  return done;
}

// The 11 particulars from the IDS master Inward Checklist.
// `options` (a key into INWARD_OPTIONS_DEFAULTS) marks particulars whose
// Model/Value cell is a dropdown; particulars without `options` are free text.
const INWARD_PARTICULARS = [
  { name: 'Air Vehicle',              options: 'airframe' },
  { name: 'Battery',                  options: 'battery'  },
  { name: 'Charger',                  options: 'charger'  },
  { name: 'Radio Controller',         options: 'rc'       },
  { name: 'Payload',                  options: 'payload'  },
  { name: 'Propeller',                options: 'airframe' },
  { name: 'Base',                     options: 'base'     },
  { name: 'Bag With Foam',            options: 'airframe' },
  { name: 'Tripod/Bipod',             options: null       },
  { name: 'Center Pole',              options: null       },
  { name: 'Toolkit-Box And Accessories', options: null    },
];

// Default dropdown options per option-group. Admin-editable at runtime
// (see Manage Inward Options); overrides persist via GAS __CONFIG__ + localStorage.
const INWARD_OPTIONS_DEFAULTS = {
  airframe: ['Sigma 25 Geo (S25G)', 'Sigma 25 Pro (S25P)', 'Sigma 75 (S75)', 'Sigma 100 (S100)', 'Fujin', 'Fighter', 'Talon', 'Striver', 'DID NOT COME'],
  battery:  ['4S3P', '6S3P', '6S2P', '4S4P', 'LiPo 22000 mAh', 'LiPo 16000 mAh', '6S4P', 'DID NOT COME'],
  charger:  ['D2', 'Ultra Power', 'Hota', 'Sky RC', 'ISDT K2', 'DID NOT COME'],
  rc:       ['Skydroid T12', 'Siyi MK15', 'Siyi MK32', 'DID NOT COME'],
  payload:  ['ADTI 24 mp', 'View Pro A609', 'Siyi A8 Mini', 'Share 5 Angle', 'Sony A6000', 'DID NOT COME'],
  base:     ['Emlid RS2', 'Spectra SP85', 'Spectra SP60', 'DID NOT COME'],
};

// The TEN workflow stages the app owns: nine name a step of the work, one
// (On Hold) suspends it, and Delivered ends it. This is now the only list a
// control OFFERS and the only vocabulary the filters, the board and the analytics
// speak — the customer Google Form's fourteen-value Col D vocabulary was retired
// in Release B, and the Sheet no longer writes a status at all.
const IR_STATUS_VALUES = ['Open','Inward','Inspection','Investigation','Production',
                          'Quality Test','PDI/Dispatch','Delivered','On Hold','Remote Support'];

// What the Sheet's Col D used to write — and what rows already in the store still
// hold — with the stage each one means today. This is a READING table and never a
// writing one: no control offers these words, nothing new is ever stored as one,
// and it exists so that an old ticket keeps its place. A ticket stored as 'QC
// Investigation' must still count as Investigation, still land in the Investigation
// column, and still read as a word on the card instead of vanishing from the totals.
//
// 'Other' is deliberately ABSENT. It was the escape hatch out of a closed list and
// it has no home among the ten; it stays readable on the tickets holding it
// (canonicalStage returns it unchanged) and nothing new can be set to it.
const STATUS_LEGACY = {
  'hold':              'On Hold',
  'visual inspection': 'Inspection',
  'qc investigation':  'Investigation',
  'qc':                'Quality Test',
  'flight test':       'Quality Test',
  'pdi':               'PDI/Dispatch',
  'approval':          'PDI/Dispatch',
  'close':             'Delivered',
};

// The stage a stored status means TODAY — the one place the old vocabulary is
// folded into the new. Every reader of a status goes through it: the merge, the
// board column, the filter bucket, the dropdown's selected option. A second folding
// table anywhere would be a second answer waiting to disagree.
//
//   ''            → 'Open'. Nothing has set this ticket, and Open is the app's own
//                   starting stage — not the Sheet's.
//   one of the ten→ itself.
//   a retired word→ the stage it means now.
//   anything else → ITSELF, unchanged. A hand-edited store row must keep saying
//                   what it says, and boardColumnOf/statusCategory still have to
//                   place it somewhere rather than inventing a stage it never had.
function canonicalStage(status) {
  const s = String(status == null ? '' : status).trim();
  if (!s) return 'Open';
  const cur = IR_STATUS_VALUES.find(v => v.toLowerCase() === s.toLowerCase());
  if (cur) return cur;
  return STATUS_LEGACY[s.toLowerCase()] || s;
}

// Triage Category, app-owned (the Form has no such column). This REPLACED an
// earlier `type` field whose values (Repair/Replacement/Warranty/AMC/Demo/
// Training/Other) described a commercial arrangement rather than the work, which
// is not what the desk sorts by. The old key is no longer read anywhere; it is
// dropped from an IR's row the next time CR saves that IR's Triage.
//
// CR (Customer Relations — the department holding the TR access axis) owns this
// field, exactly as it owns status, assignee and priority.
const IR_CATEGORIES = ['CRASH', 'GENERAL MAINTENANCE', 'REMOTE SUPPORT', 'REPAIR'];

// Sub-categories, only meaningful under REPAIR. OTHERS is the escape hatch: it
// carries a free-text note instead of pretending to be a tenth component.
const REPAIR_SUBCATEGORIES =
  ['GPS', 'TRIPOD/BIPOD', 'TOPSHELL', 'CAMERA/LENS', 'BATTERY', 'CHARGER', 'RC', 'AIRFRAME', 'OTHERS'];
const REPAIR_OTHERS = 'OTHERS';

// ─── One house style for the stored keys ─────────────────────────────────────
// The category and sub-category keys are ALL CAPS because they ARE keys: they are
// written by the customer Google Form and compared exactly, so the keys are data
// and are never renamed here. Only what a READER sees is decided in this block.
// The owner saw "All Categories" sitting directly beside "GENERAL MAINTENANCE" —
// two styles inside one row — so every label now comes from one place.
//
// The maps are explicit rather than a "lower-case it, then capitalise the first
// letter" rule, because that rule eats acronyms: GPS and RC are upper case on
// purpose. An unknown value — a legacy row, a hand-typed category — passes
// through untouched rather than being guessed at, and every FILTER still compares
// the raw key, so a label can never change what a tab finds.
const CATEGORY_LABELS = {
  'CRASH':               'Crash',
  'GENERAL MAINTENANCE': 'General maintenance',
  'REMOTE SUPPORT':      'Remote support',
  'REPAIR':              'Repair',
};
const SUBCATEGORY_LABELS = {
  'GPS': 'GPS', 'TRIPOD/BIPOD': 'Tripod/bipod', 'TOPSHELL': 'Topshell',
  'CAMERA/LENS': 'Camera/lens', 'BATTERY': 'Battery', 'CHARGER': 'Charger',
  'RC': 'RC', 'AIRFRAME': 'Airframe', 'OTHERS': 'Others',
};
// Case and inner whitespace are flattened before the lookup, so a legacy
// "general maintenance" or "General  Maintenance" still finds its label.
const labelFrom = (map, value) => {
  if (!value) return '';
  const key = String(value).toUpperCase().replace(/\s+/g, ' ').trim();
  return map[key] || String(value);
};
const categoryLabel    = v => labelFrom(CATEGORY_LABELS, v);
const subCategoryLabel = v => labelFrom(SUBCATEGORY_LABELS, v);

// Triage priorities. `priority` is read from the Sheet's "Priority" column when
// one exists (fetchIRsFromSheet) and from here when the app sets it.
const TICKET_PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

// Runtime option lists (defaults merged with any saved overrides).
let inwardOptions = JSON.parse(JSON.stringify(INWARD_OPTIONS_DEFAULTS));
// Image-evidence control state (used by Section D + E/F/G/H/I uploads):
// evidenceState[fieldId] = [{ caption, link, file, url, type, name }].
// `link` = Drive URL of an already-uploaded file ('' while pending upload); `file`/`url`
// hold the local File + object URL for files not yet uploaded to Drive. `type`
// is 'image' | 'pdf' (controls preview); `name` is the original filename.
let evidenceState = {};
// Dispatch-checklist state for the open IR: { [fieldId]: { [particular]: status } }.
// Section H verifies dispatched goods against the items received in Section B.
let dispatchChecklistState = {};

// ─── SECTION C — IQC VISUAL INSPECTION CONFIG ──────────────────────────────────
// Inspection zones from the IDS master Section C sheet. `header: true` rows are
// group banners (A/B/C/D/E). Rows with `editable: true` are blank placeholder
// lines the inspector fills in (extra payloads / accessories). Each non-header
// row has a PASS/FAIL/NA result dropdown and a per-row remark.
const IQC_RESULT_OPTIONS_DEFAULTS = ['PASS', 'FAIL', 'NA'];
const IQC_ZONES_DEFAULTS = [
  { id: 'A',      code: 'A',      name: 'Airframe',            header: true },
  { id: 'A1',     code: 'A.1.',  name: 'All Four Arms',       checks: 'Cracks, Bends, Deformations, Loose Arms and Damage To Holes' },
  { id: 'A2',     code: 'A.2.',  name: 'Air Vehicle Body',    checks: 'Damage, Crack, Scratch, Missing/Loose Screws, Loose Objects Inside' },
  { id: 'A3',     code: 'A.3.',  name: 'Landing Gears/Legs', checks: 'Damage' },
  { id: 'B',      code: 'B',      name: 'Propulsion',          header: true },
  { id: 'B1',     code: 'B.1.',  name: 'All The Propellers',  checks: 'Chipping, Damage, Self-Tightening Bolts Are Intact' },
  { id: 'B2',     code: 'B.2.',  name: 'All 4 Prop-Mounts',   checks: 'Bend, Bolts Are Tightened, Scratch' },
  { id: 'B3',     code: 'B.3.',  name: 'All Four Motors',     checks: 'Deposit Of Dirt, Debris, Sign Of Impact, Scratch, Free to Rotate' },
  { id: 'C',      code: 'C',      name: 'Battery And Charger', header: true },
  { id: 'C1',     code: 'C.1.',  name: 'All The Batteries',  checks: 'Case Damage, Scratch, Missing/Loose Bolt, Voltage Check (Balance/Imbalance)' },
  { id: 'C2',     code: 'C.2.',  name: 'Battery Bay',        checks: 'Damage, Looseness, Battery Connectors' },
  { id: 'C3',     code: 'C.3.',  name: 'Battery Charger',    checks: 'Power On Test, Damage, Scratch, Loose Objects Inside, Power Cable' },
  { id: 'D',      code: 'D',      name: 'Avionics And Sensors', header: true },
  { id: 'D1',     code: 'D.1.',  name: 'GPS',                checks: 'Damage, Scratch' },
  { id: 'D2',     code: 'D.2.',  name: 'Antennas',           checks: 'Missing, Damage, Scratch' },
  { id: 'D3',     code: 'D.3.',  name: 'Dampeners',          checks: 'Damage, Scratch' },
  { id: 'D4',     code: 'D.4.',  name: 'Radio Controller',   checks: 'Damage, Scratch, Charging Port, Loose Objects Inside, Power On Test and Screen Test' },
  { id: 'D5a',    code: 'D.5.',  name: 'ODS',                checks: 'Damage, Scratch' },
  { id: 'D5b',    code: 'D.5.',  name: 'Sensor/Payload',     checks: 'Damage, Scratch, Loose Objects Inside, SD Card Availability, Payload Cable And Connectors Are Intact' },
  { id: 'D5I',    code: 'D.5.I',  name: '', editable: true },
  { id: 'D5II',   code: 'D.5.II', name: '', editable: true },
  { id: 'D5III',  code: 'D.5.III', name: '', editable: true },
  { id: 'E',      code: 'E',      name: 'Accessories',        header: true },
  { id: 'E1',     code: 'E.1.',  name: 'Base With Bag',      checks: 'Damage, Scratch, Missing Part (Antenna, Charging Cable), Power On Test' },
  { id: 'E2',     code: 'E.2.',  name: 'Tripod/BiPod, Center Pole', checks: 'Damage, Missing Part' },
  { id: 'E3',     code: 'E.3.',  name: 'Drone Bag With Foam', checks: 'Damage' },
  { id: 'E4',     code: 'E.4',   name: '', editable: true },
  { id: 'E5',     code: 'E.5.',  name: '', editable: true },
];

// Runtime, admin-customizable copies (defaults merged with any saved overrides).
let iqcZones = JSON.parse(JSON.stringify(IQC_ZONES_DEFAULTS));
let iqcResultOptions = [...IQC_RESULT_OPTIONS_DEFAULTS];

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const splash      = document.getElementById('splash-screen');
const authCont    = document.getElementById('auth-container');
const appCont     = document.getElementById('app-container');
const sidebarEl   = document.getElementById('sidebar');
const indexView   = document.getElementById('index-view');
const detailView  = document.getElementById('detail-view');
const insightsView = document.getElementById('insights-view');
const logView     = document.getElementById('log-view');
const faqView     = document.getElementById('faq-view');
const irList      = document.getElementById('ir-list');
const searchInput = document.getElementById('search-input');
const backBtn     = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const userAvatar  = document.getElementById('user-avatar');
const syncStatus  = document.getElementById('sync-status');
const toast       = document.getElementById('toast');

// Tapping the toast dismisses it. The message covers the bottom of the form on a
// phone, so "wait it out" was the only option it left — and if a timer was ever
// lost, waiting was not going to end it either. Any pointer or key event closes it.
['click', 'pointerdown', 'keydown'].forEach(ev =>
  toast.addEventListener(ev, hideToast));

// ─── SHELL REFS ──────────────────────────────────────────────────────────────
// The Frappe-style shell (sidebar / list / split pane). These are only touched
// by the layout + router code below — nothing in the section rendering path
// reads them.
const navAccess     = document.getElementById('nav-access');
const navAdminLabel = document.getElementById('nav-admin-label');
const navCountEl    = document.getElementById('nav-count');
const listSegments  = document.getElementById('list-segments');
const listCategories = document.getElementById('list-categories');
const listCountEl   = document.getElementById('list-count');
const irBoard       = document.getElementById('ir-board');
const listViewSwitch = document.getElementById('list-view-switch');
const bannerPills   = document.getElementById('ir-banner-pills');
const railToggle    = document.getElementById('sidebar-toggle');
const listToggle    = document.getElementById('list-toggle');
const listRailEl    = document.getElementById('list-rail');
const listRailCountEl = document.getElementById('list-rail-count');
const listRailRestore = document.getElementById('list-rail-restore');
const sidebarResize = document.getElementById('sidebar-resize');
const listResize    = document.getElementById('list-resize');

// ─── VIEW / ROUTER STATE ─────────────────────────────────────────────────────
// currentView is the single source of truth for which screen is showing.
// renderLayout() translates it into the inline display of the three panes.
let currentView = 'index';     // 'index' | 'detail' | 'insights' | 'log'
let activeSegment = 'all';     // IR-list filter segment
let activeCategory = 'all';    // IR-list filter category (a SECOND, independent axis)
let listMode = 'list';         // 'list' | 'board' — the same filtered rows, two drawings
let _appBooted = false;        // showApp() guard — it re-binds listeners
let _irsReady = null;          // promise for the first IR-list load (deep links await it)
let _openSeq = 0;              // supersedes an in-flight openPassbook()
const mqDesktop = window.matchMedia('(min-width: 1024px)');

// ─── SPLASH → AUTH FLOW ──────────────────────────────────────────────────────
// The FULL intro plays on the FIRST arrival on this device, and again after an
// update — the app's opening, not a tax on every visit. Everything in between
// gets a brief splash that any tap clears.
//
// It used to play in full every time a device reached the sign-in screen, which
// is what the owner was shown and then asked to undo: a daily sign-in paid nine
// seconds of video for an intro it had already delivered. "After an update" is
// keyed on APP_VERSION — the same number the deploy bumps with CACHE_NAME — so
// shipping a new shell hands every device its intro once more, which is exactly
// the case where the intro is telling someone something new.
//
// The single exception is a device that is already signed in. Those people resume
// straight into the app, and nine seconds of video in front of a session that was
// going to resume anyway is a delay rather than a welcome. That case is decided
// before paint (index.html) and re-checked here via hasStoredSession(), so what
// the stylesheet hid and what this function does are the same decision.
//
// Note this is the BOOT path only — which is why signing out goes through it and
// gets the same brief splash as any other return, while an in-app session EXPIRY
// does not touch it at all (that path calls showAuth() in place, covering the
// screen would be actively worse, and the expiry toast is the thing the person
// needs to read).
//
// It is driven by the video's own `ended` event rather than a fixed wait, so
// re-exporting the intro at a different length needs no code change. The
// fallback timers below are backstops for the cases where `ended` never
// arrives — a decode failure, a browser that refuses to play, a 404 — because
// the user must reach sign-in no matter what the video does.
const INTRO_FALLBACK_MS = 9500;   // current video is 9.03s; a little margin over that
const SPLASH_FADE_MS    = 800;
// The brief splash a device that has already seen this version's intro gets
// instead: long enough to read as the app opening, short enough that nobody
// waits on it — and any tap, click or key clears it on the spot.
const INTRO_DONE_KEY    = 'ipb_intro_ver';
const INTRO_SHORT_MS    = 1400;

// Which intro this device owes. The stored value is the VERSION whose full intro
// was watched, compared against APP_VERSION — so bumping the version at deploy
// time IS the "play it again after an update" mechanism: no separate migration,
// and no second list that could drift out of step with the one on screen.
//
// Storage being blocked reads as "not seen", so the full intro plays — of the two
// ways to be wrong, showing the intro again beats an app that never shows its own
// opening.
function introDeliveredForThisVersion() {
  try { return localStorage.getItem(INTRO_DONE_KEY) === APP_VERSION; }
  catch (e) { return false; }
}
function markIntroDelivered() {
  try { localStorage.setItem(INTRO_DONE_KEY, APP_VERSION); } catch (e) { /* storage blocked */ }
}

window.addEventListener('load', () => {
  // The language layer paints the static chrome FIRST, above everything else in
  // this handler. It only ever rewrites text that is already correct, so the order
  // is not cosmetic: doing it here means no other code in this handler has to know
  // the layer exists, and a screen that is never re-rendered later is still right.
  //
  // `init()` is what reads the language this device last chose, and it MUST come
  // before applyStatic() — the other way round paints English and then paints the
  // chosen language over it, which is the same picture a frame later and a flicker
  // on the one screen everybody sees.
  if (window.I18N) window.I18N.init();
  if (window.I18N) window.I18N.applyStatic();

  // The landing page's own furniture: the two doors, the language picker, the corner
  // button, and the code step they lead to. Wired HERE and not inside showAuth(),
  // because they are properties of the screen rather than of any one sign-in — and
  // because a signed-in device that signs out must find them already alive.
  wireLanding();

  // The customer door's REPORT modal — a different thing from the door, and it needs
  // CUSTOMER_FORM_URL before it exists at all.
  wireCustomerDoor();

  // Check for local file protocol (login + backend calls won't work)
  if (window.location.protocol === 'file:') {
    alert('⚠️ You are running this app directly from a local file. Login and the backend will NOT work unless you serve the app via a local server (http://localhost) or deploy it to GitHub Pages.');
  }

  // Start the update watch FIRST, above every early return below. Three of the
  // paths out of this handler — an already-signed-in device, a Google return, and
  // the brief-splash device that has seen this version's intro — are exactly the
  // ones that must still be told a newer build exists, and all three leave before
  // reaching warmBackend(). The check is one small request and is throttled, so
  // starting it here costs the boot nothing measurable.
  startUpdateWatch();

  let entered = false;

  // Everything that used to run when the splash timer expired, unchanged.
  function enterApp() {
    if (entered) return;
    entered = true;
    splash.style.display = 'none';
    const stored = loadStoredUser();
    const storedSession = loadSession();
    if (stored && storedSession) {
      currentUser = stored;
      // Restore the server session token so backend calls are authorized with no
      // sign-in prompt. localStorage, so this survives a full app close.
      currentUser.sessionToken = storedSession;
      showApp();
      // Refresh role/permissions + departments (drives per-section save-button
      // gating). Best-effort; the gating fallback is view-only.
      // No mustChangePassword handling here: a stored session can only exist for
      // an account whose flag is already cleared — the backend mints no token
      // while it is set — so a stale stored session simply fails sessionCheck and
      // takes the ordinary expiry path.
      refreshMyAccess().then(() => {
        if (typeof applySectionAccessGating === 'function') applySectionAccessGating();
      });
    } else if (shouldUseDevAuthBypass()) {
      currentUser = createDevUser();
      persistUser(currentUser);
      showApp();
    } else {
      // Half-restored state (a profile with no token, or a token with no
      // profile) is a stale fragment. Clear BOTH and show the login screen.
      if (stored || storedSession) clearLocalAuth();
      showAuth();
    }
  }

  let dismissed = false;
  function dismissSplash(instant) {
    if (dismissed) return;
    dismissed = true;
    if (instant) { enterApp(); return; }
    splash.style.opacity = '0';
    splash.style.transform = 'scale(1.04)';
    setTimeout(enterApp, SPLASH_FADE_MS);
  }

  // A device that is already signed in: no fade, no video, no download.
  // base.css has already hidden the splash off the pre-paint attribute, so this
  // only makes it explicit and keeps the element's inline state truthful.
  //
  // A Google return skips it for the same reason: the sign-in has already started,
  // and nine seconds of intro in the middle of it is a delay standing between a
  // person and a session they have already earned. index.html's pre-paint script
  // makes the same call, so the splash never even paints — the two conditions are
  // pinned to each other by smoke-shell.mjs.
  if (hasStoredSession()) { dismissSplash(true); return; }

  const handoff = checkHandoff();
  if (handoff) { splash.style.display = 'none'; finishHandoff(handoff); return; }

  // Past both returns, this load is ending on the SIGN-IN screen — the one outcome
  // we can be certain of, and the reason the wake-up is started here rather than in
  // showAuth(), which does not run until the intro below has finished. Nine seconds
  // of video plus everything the person types is a nine-plus-second head start on
  // the backend's cold start, bought with time nobody was using. See warmBackend().
  warmBackend();

  const video = document.getElementById('splash-video');
  if (!video) { dismissSplash(false); return; }

  // A device that has already watched THIS version's intro gets the brief splash.
  // It clears itself in a moment, and a tap, click or key clears it at once — so
  // the wait is never something a person has to sit through to reach the form.
  //
  // Placed after warmBackend() on purpose: a returning device is still a person
  // about to sign in, and the cold start waiting behind the form is the same one.
  // It has to be BEFORE play() for the other half of the point — the video is
  // never fetched, so the ~9.7 MB is paid only by whoever is going to watch it.
  if (introDeliveredForThisVersion()) {
    const brief = setTimeout(() => dismissSplash(false), INTRO_SHORT_MS);
    const skipNow = () => { clearTimeout(brief); dismissSplash(false); };
    splash.addEventListener('pointerdown', skipNow, { once: true });
    splash.addEventListener('keydown', skipNow, { once: true });
    return;
  }

  // The loader bar under the intro is timed from the video itself rather than a
  // number in the stylesheet — it used to finish at 1.85s while nine seconds of
  // video were still playing, which read as a stuck progress bar. --intro-ms is
  // read by .splash-bar's animation-duration in base.css; the CSS default stands
  // if metadata never arrives.
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      document.documentElement.style.setProperty('--intro-ms', video.duration + 's');
    }
  }, { once: true });

  // The backstop, armed before play() so it covers every failure mode. `ended`
  // normally beats it; if the video is missing or unplayable, `error` does.
  const fallback = setTimeout(() => dismissSplash(false), INTRO_FALLBACK_MS);
  const finish = () => {
    clearTimeout(fallback);
    // Recorded HERE rather than when the full intro was chosen, so closing the tab
    // two seconds in does not cost the person the rest of it next time — the debt
    // is paid when the intro is actually delivered. Every way of finishing counts:
    // `ended`, a decode error, a refusal to play. A device whose video cannot play
    // would otherwise replay nine seconds of it on every single load, which is the
    // worse of the two failures.
    markIntroDelivered();
    dismissSplash(false);
  };
  video.addEventListener('ended', finish, { once: true });
  video.addEventListener('error', finish, { once: true });
  video.play().catch(finish);
});

// ─── OVERVIEW COLLAPSE ───────────────────────────────────────────────────────
// A ticket's Overview is the first and tallest block on the page, which pushes
// the section tabs — the thing a person opened the ticket for — off the screen.
// It folds away, and the choice is remembered per device.
//
// Bound once, at parse time: index.html is static, so these elements exist by
// the time this file evaluates (it is the last thing in <body>). The class goes
// on the panel, but views.css hides the panel's CHILDREN — renderOverview() owns
// the panel's own inline `display`, and this must never fight with it.
const OVERVIEW_OPEN_KEY = 'overviewOpen';

// Default CLOSED. The stored value is opt-IN to open, so a fresh device, a
// cleared cache, or storage being blocked all land on the tidy screen rather
// than the cluttered one.
function overviewStoredOpen() {
  try { return localStorage.getItem(OVERVIEW_OPEN_KEY) === '1'; } catch (e) { return false; }
}

function applyOverviewOpen(open) {
  const panel = document.getElementById('ir-overview');
  if (!panel) return;
  panel.classList.toggle('is-collapsed', !open);
  const btn = document.getElementById('overview-toggle');
  if (!btn) return;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  const label = btn.querySelector('.overview-toggle-text');
  if (label) label.textContent = open ? 'Hide' : 'Show';
}

(function initOverviewToggle() {
  const btn = document.getElementById('overview-toggle');
  if (!btn) return;
  applyOverviewOpen(overviewStoredOpen());
  btn.addEventListener('click', () => {
    // Read the CURRENT state off the DOM rather than tracking a parallel
    // variable, so this cannot drift from what is actually rendered.
    const panel = document.getElementById('ir-overview');
    const nextOpen = panel ? panel.classList.contains('is-collapsed') : false;
    applyOverviewOpen(nextOpen);
    try { localStorage.setItem(OVERVIEW_OPEN_KEY, nextOpen ? '1' : '0'); } catch (e) { /* storage blocked */ }
  });
})();

function shouldUseDevAuthBypass() {
  const params = new URLSearchParams(window.location.search);
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  return CONFIG.ENABLE_DEV_AUTH_BYPASS && isLocalHost && params.get('dev') === '1';
}

function createDevUser() {
  // The dev bypass must be as capable as a real admin, because that is the only
  // way to exercise the admin modal in a real browser (smoke-boot.mjs relies on
  // this path entirely). It carries a sessionToken so refreshMyAccess() actually
  // runs instead of returning early — that early return used to hide the fact
  // that a dev user had no token at all.
  const all = {};
  SECTION_IDS.forEach(s => { all[s] = 'edit'; });
  all[OVERVIEW_KEY] = 'edit';
  return {
    name: 'Dev Tester',
    email: `dev@${CONFIG.ALLOWED_DOMAIN}`,
    initial: 'D',
    token: 'local-dev',
    sessionToken: 'local-dev',
    access: { role: 'admin', permissions: all, departments: [], triage: true },
  };
}

// ─── LOCAL PROFILE (localStorage — survives an app close) ────────────────────
// The profile + session token live in localStorage so reopening the app resumes
// the session instead of demanding a sign-in. The server session token is the
// real credential and is revocable; this profile is just the display name/email.
// The raw password is NEVER stored.
function persistUser(user) {
  const safe = {
    name:    user.name,
    email:   user.email,
    picture: user.picture,
    initial: user.initial,
  };
  try { localStorage.setItem(USER_KEY, JSON.stringify(safe)); } catch { /* private mode */ }
}

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch { return null; }
}

// ─── EMAIL + PASSWORD AUTH UI ────────────────────────────────────────────────
// Four modes share one form: 'email' | 'login' | 'unlock' | 'pattern'. There is no
// sign-up mode — accounts are provisioned by the admin — so the things a person can do
// here are sign in with an address, sign in with the password an admin issued, and
// unlock a device they already registered. The emailed code used to be a mode of this
// form; it is a screen of its own now (`#code-view`), reached only by submitting this
// one — see openCodeView.
let _authFormWired = false;
let _authMode = 'email';     // 'email' | 'login' | 'unlock' | 'pattern'

// ─── THE CODE STEP'S STATE ────────────────────────────────────────────────────
// Which door asked for the code, the address it was sent to, and — on the password
// door — the password from stage 1, because the backend verifies it AGAIN on the
// second call rather than trusting a half-open conversation.
//
// `_codePassword` is in memory only, for the same reason `_pcTemp` is: a credential
// must not outlive the screen that asked for it. It is empty on the code door, where
// there was never a password to hold.
let _codeDoor = '';          // 'employee' | 'customer'
let _codeEmail = '';
let _codePassword = '';

// Establish a signed-in session from a backend payload. Shared by the login form
// and the forced password change, so both land in exactly the same state.
function finishAuth(email, d) {
  const fallbackName = (email.split('@')[0] || 'User');
  currentUser = currentUser || {};
  currentUser.name    = currentUser.name || fallbackName;
  currentUser.email   = email;
  currentUser.initial = String(currentUser.name).charAt(0).toUpperCase() || '?';
  delete currentUser.picture;
  currentUser.sessionToken = d.sessionToken;
  // The backend nests the access payload under data.access (getMyAccess).
  const a = (d && d.access) || {};
  currentUser.access = { role: a.role, permissions: a.permissions, departments: a.departments || [], triage: a.triage === true };
  currentUser.sessionError = null;
  persistSession(d.sessionToken);
  persistUser(currentUser);
  _authToastShown = false;   // fresh session — allow one expiry hint again
  showApp();
  maybePromptQuickUnlock(email);
  refreshMyAccess().then(() => { if (typeof applySectionAccessGating === 'function') applySectionAccessGating(); });
}

// ─── THE WORDMARK TYPES ITSELF ────────────────────────────────────────────────
//
// The owner, 2026-10-08: *"where it is written I-PASSBOOK in CAPS below logo, there is
// a in-loop animation going on of a curvy underline. Instead, can we have I-PASSBOOK
// itself in-loop animation where I-PASSBOOK appears as if being typed and then in
// below line … after I-PASSBOOK has being typed, INDRONES ORIGINATES FROM I, PRODUCT
// ORIGINATES FROM P …"*
//
// So the flourish is gone and the heading animates instead. Three things about how:
//
// 1. THE MARKUP IS THE REAL COPY AND THIS IS AN ENHANCEMENT. `index.html` ships
//    "I-PASSBOOK" as ordinary text. This function splits it into spans only when it
//    runs, so a reader with no JavaScript, a screen reader, and a reduced-motion
//    visitor all get the finished word — the last of those because the CSS in base.css
//    puts every span back on screen.
// 2. THE WORD GROWS BECAUSE THE CSS HIDES UNTYPED LETTERS WITH `display`, NOT
//    `opacity`. With `opacity` the whole word would reserve its space from the first
//    frame and the letters would blink on inside a box that never changed — a
//    different effect, and not the one he asked for.
//
//    Removing a letter from the box is necessary but NOT sufficient, and getting only
//    that far is a trap worth naming: a heading centred on whatever is on screen is
//    laid out afresh every keystroke, so every letter already typed SLIDES outward as
//    the next one arrives. Measured on the rendered page (2026-10-08): the finished
//    word is 158px wide, so the "I" travels 79px leftward over the first second of
//    every loop. That is an unfolding, not a typewriter. So reserveBrandBox() below
//    fixes the heading's width to the finished word up front and base.css left-aligns
//    the text inside it — each letter lands where it will stay, the word extends to
//    the right from a fixed origin, and the box stays centred under the mark.
// 3. THE CARET IS THE LAST CHILD, NOT A MEASURED POSITION. It follows the last shown
//    letter because inline layout puts it there, so there is nothing to recompute on
//    resize, on a font swap, or when the language layer rewrites the words.
//
// ⚠ THE LINE UNDER THE WORD IS NOT TYPED, AND THAT IS A CORRECTION OF MY OWN WORK.
// It used to spell the name out one `·`-separated term at a time, and because the terms
// differ in length the sentence re-wrapped as it filled — so the whole landing page grew
// and shrank underneath the doors on every pass of the loop. The owner, 2026-10-08:
// *"the whole page below it is increasing/decreasing its height … And line
// increasing/decreasing should not happen."* It is one static line now, and no code
// here touches it. (The comment in index.html above it is where that line is defined.)
//
// Timings live here rather than in CSS: the sequence is a chain, and half of a chain
// in each file is a chain nobody can change.
const BT_OPEN_MS   = 240;   // beat before the first keystroke
const BT_LETTER_MS = 105;   // per letter of I-PASSBOOK
const BT_HOLD_MS   = 3200;  // how long the finished word is left up
const BT_LETTER_OUT_MS = 45;
const BT_LOOP_MS   = 180;   // beat before it starts again

let _btRun = null;   // the live chain, or null. See stopBrandTyping().

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
}

// Splits the wordmark into animatable spans. Idempotent: `_btBuilt` is stamped on the
// element itself, so a re-entry cannot double the letters. The line BELOW the word is
// deliberately not touched — see the note above; it is static copy now.
function buildBrandTyping() {
  const brand = document.getElementById('landing-brand');
  if (!brand || brand.dataset.btBuilt === '1') return;

  const word = (brand.textContent || '').replace(/\s+/g, ' ').trim();
  if (!word) return;
  brand.dataset.btBuilt = '1';
  // The label carries the word for anyone who cannot see it: every letter span is
  // aria-hidden, so without this the h1 would read as an empty heading.
  brand.setAttribute('aria-label', word);
  brand.textContent = '';
  const frag = document.createDocumentFragment();
  const letters = [];
  for (const ch of word) {
    const s = document.createElement('span');
    s.className = 'bt-lt';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = ch;
    frag.appendChild(s);
    letters.push(s);
  }
  const caret = document.createElement('span');
  caret.className = 'bt-caret';
  caret.setAttribute('aria-hidden', 'true');
  frag.appendChild(caret);
  brand.appendChild(frag);
  brand._btLetters = letters;
  brand._btCaret = caret;
}

// Fixes the heading's width to the finished word, so the word types left to right into
// a box that never changes size. See point 2 above for why this is not decoration.
//
// It MEASURES rather than guessing, and it measures by lighting every letter for the
// length of one synchronous call: the letters are revealed by `display`, so there is no
// way to ask the browser for the width of a word that is not in the box. Nothing is
// painted in between — the restore happens before this returns — so the measurement
// cannot be seen, and a call that arrives mid-animation leaves the letters exactly as
// it found them.
//
// No `document.fonts.ready` re-measure is owed here: the wordmark is set in
// `--font-mono`, which tokens.css defines as a pure system stack. There is no webfont
// for this heading to swap in behind us.
function reserveBrandBox() {
  const brand = document.getElementById('landing-brand');
  const box   = brand && brand.parentElement;
  if (!brand || !box || !brand._btLetters || !brand._btLetters.length) return;
  const wasOn = brand._btLetters.filter(l => l.classList.contains('is-on'));
  brand._btLetters.forEach(l => l.classList.add('is-on'));
  // The caret is left out on purpose: measured without it, the box is the WORD's width,
  // so the finished word is exactly centred and the caret sits just past its last
  // letter, outside the reservation — which is where a text cursor belongs.
  const caretWasOn = !!(brand._btCaret && brand._btCaret.classList.contains('is-on'));
  if (brand._btCaret) brand._btCaret.classList.remove('is-on');
  const width = brand.getBoundingClientRect().width;
  if (caretWasOn && brand._btCaret) brand._btCaret.classList.add('is-on');
  brand._btLetters.forEach(l => { if (!wasOn.includes(l)) l.classList.remove('is-on'); });
  // A zero width means the sign-in screen is not laid out yet; stamping 0px would pin
  // the heading shut. Leave it alone and the next showAuth() measures it properly.
  if (width > 0) box.style.minWidth = Math.ceil(width) + 'px';
}

function startBrandTyping() {
  buildBrandTyping();
  const brand = document.getElementById('landing-brand');
  if (!brand || !brand._btLetters || !brand._btLetters.length) return;
  // Before the `_btRun` guard below, so a second sign-out/sign-in re-reserves too. It
  // is synchronous and restores the letters, so calling it mid-loop is invisible.
  reserveBrandBox();
  if (_btRun) return;                    // already looping; a second chain would race it
  // Reduced motion is not "no animation" here, it is "the words, finished" — and the
  // stylesheet already shows them, so the only right move is to not start.
  if (prefersReducedMotion()) return;

  const letters = brand._btLetters;
  const caret   = brand._btCaret;
  const run = _btRun = { stop: false, timer: null, release: null };
  const wait = (ms) => new Promise(res => {
    run.timer = setTimeout(() => { run.timer = null; run.release = null; res(); }, ms);
    run.release = res;
  });
  // Every await goes through `next`, which refuses to resolve into a stopped run.
  // That is what makes stopBrandTyping() safe to call at any instant — mid-letter,
  // mid-hold — without leaving a chain alive to re-type into a hidden screen.
  const next = async (ms) => { if (run.stop) return false; await wait(ms); return !run.stop; };

  (async () => {
    while (!run.stop) {
      letters.forEach(l => l.classList.remove('is-on'));
      if (caret) caret.classList.remove('is-on');
      if (!await next(BT_OPEN_MS)) return;
      if (caret) caret.classList.add('is-on');
      for (const l of letters) {
        l.classList.add('is-on');
        if (!await next(BT_LETTER_MS)) return;
      }
      if (!await next(BT_HOLD_MS)) return;
      // Unwritten in reverse, so the loop reads as the same word being typed a
      // second time rather than as the page having reloaded.
      for (let i = letters.length - 1; i >= 0; i--) {
        letters[i].classList.remove('is-on');
        if (!await next(BT_LETTER_OUT_MS)) return;
      }
      if (!await next(BT_LOOP_MS)) return;
    }
  })();
}

function stopBrandTyping() {
  const run = _btRun;
  _btRun = null;
  if (run) {
    run.stop = true;
    if (run.timer) { clearTimeout(run.timer); run.timer = null; }
    // Releasing the pending promise lets the chain fall out at its next check
    // instead of hanging on a timer that will never fire.
    if (run.release) { const release = run.release; run.release = null; release(); }
  }
  // The DOM is put back to "finished", which is what the signed-in app never shows
  // and what a later sign-out must find: the landing wordmark whole, not mid-type.
  const brand = document.getElementById('landing-brand');
  if (brand) {
    if (brand._btCaret) brand._btCaret.classList.remove('is-on');
    (brand._btLetters || []).forEach(l => l.classList.remove('is-on'));
  }
}

function showAuth() {
  endSsoWait();
  warmBackend();
  authCont.style.display = 'flex';
  appCont.style.display  = 'none';
  // The code step is a SCREEN OF ITS OWN, a sibling of this one, so every route back
  // to the landing has to take it down — and this is the one function every route
  // back goes through. See openCodeView/closeCodeView.
  closeCodeView(false);
  // The landing head types itself in the moment the sign-in screen is actually on
  // screen. That is here rather than in the boot handler because the intro covers the
  // screen until it finishes — see the note above warmBackend() — so a chain started
  // at parse time would be several seconds into its loop before anybody could see it.
  startBrandTyping();
  const pc = document.getElementById('password-change');
  if (pc) pc.style.display = 'none';
  document.body.classList.remove('view-detail');
  _codeEmail = '';
  _codePassword = '';

  // Which of the two doors is open. Painted HERE and not only at wiring time, because
  // a sign-out returns to this screen and must find the door this device left open.
  paintDoors();

  // Default mode: quick unlock where a registered device has one on file, and the
  // typed form for everyone else. There is no longer a code STEP to default to — the
  // code lives on its own screen now (openCodeView) and is only ever reached from a
  // form that was actually submitted, which is a stronger guarantee than the old
  // "never default to 'otp'" rule it replaces.
  const quick = loadUnlock();
  // A fingerprint record opens on the fingerprint door; a pattern-only record on
  // the pattern canvas. Both still offer the email door one tap away.
  let quickMode = 'email';
  if (quick && quick.deviceToken && quick.email) {
    quickMode = (quick.credentialId || quick.mode === 'fingerprint') ? 'unlock' : (quick.patternHash ? 'pattern' : 'email');
  }
  setAuthMode(quickMode);
  // A pattern device opens straight onto a drawable canvas, not a blank box that
  // draws only after the "Use pattern" tap.
  if (quickMode === 'pattern') patternForUnlock();

  const err = document.getElementById('auth-error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }

  // Persistent Identity: Pre-fill email if a stored user exists
  const storedUser = loadStoredUser();
  if (storedUser && storedUser.email) {
    const emailEl = document.getElementById('auth-email');
    if (emailEl) emailEl.value = storedUser.email;
  }

  // Change: Removed 'auth-email' from clearing list so pre-fill persists
  ['auth-password'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });

  wireAuthForm();
  // The customer card's own state, which is deliberately NOT part of _authMode: the
  // two doors are two independent sign-ins on one screen, and folding the customer's
  // stage into the staff mode machine would let one door's step leak into the other.
  paintCustomerDoor();
  wirePasswordToggles();
  maskAllPasswords();
}

// The Google door's click. Module scope, not wireAuthForm's, because it is the one
// thing on that screen that ignores everything typed into the form: it carries no
// email, no password and no code, and its whole result is a session or a refusal.
//
// There is no fetch here to await and no failure to show. The click LEAVES the
// page — that is the mechanism, not a side effect — and whatever comes of it
// arrives back through #sso= / #ssoerr= and is handled by finishHandoff(). The
// button is disabled first so a second click cannot start a second handoff while
// the browser is still on its way out.
function submitGoogleSignIn() {
  if (!CONFIG.SSO_URL) return Promise.resolve();
  const btn = document.getElementById('auth-google-btn');
  if (btn) btn.disabled = true;
  setAuthError('');
  const hint = document.getElementById('auth-hint-text');
  if (hint) hint.textContent  = 'Taking you to Google — choose your indrones.com account.';
  // The notice line is `display:none` until it has something to say; a message
  // nobody can see is not a message. It is put back to empty by setAuthMode.
  if (hint) hint.style.display = '';
  // Started here, and keepalive because the very next statement unloads the page.
  // Without it the browser is free to cancel this request as we leave — and it is
  // precisely the request whose whole job is to be still in flight while the person
  // is over at Google picking an account.
  warmBackend({ keepalive: true });
  // ⚠ A SAME-TAB NAVIGATION, and this is the owner's correction of my own work.
  // 2026-10-08: *"I can see in vercel.com/login that when I clicked continue with
  // google it did not opened me another tab to login but in the same tab took me to
  // next screen … opposite to ours where we have another tab open for us to select
  // email ID and wait a long time to get it, its sooooo piss-off signin method of
  // ours, we need to be like vercel."*
  //
  // The old code opened a SECOND TAB and was defended at length, on the theory that a
  // standalone PWA window has no cookie context for Google. That theory was wrong
  // about the mechanism, and the cost of being wrong was the thing he actually
  // reported: two tabs, two waits, and the app's own wait screen never seen because
  // the person was looking at the other tab. The door's own round trip is a
  // NAVIGATION either way (see the GOOGLE SIGN-IN block and docs/10), and a
  // navigation is not something a second window improves.
  //
  // This is a top-level navigation, so the wait screen index.html raises for a
  // `#sso=` return is the only screen the person sees until the exchange lands —
  // which is the shape he asked for.
  location.href = googleStartUrl();
  return Promise.resolve();
}

// ─── THE GOOGLE WAIT SCREEN ──────────────────────────────────────────────────
const SSO_SLOW_MS = 8000;
let _ssoSlowTimer = null;

// Raised by index.html BEFORE PAINT for a `#sso=` return, and taken down here. It
// exists because the exchange of that code is a round trip to Apps Script and the
// app used to spend it showing the sign-in form to someone who had just signed in.
//
// It is cleared from showAuth() and showApp() rather than from finishHandoff()'s
// two endings, so EVERY route to a real screen clears it and no path can leave a
// person staring at a sign-in that already finished. That is the whole reason it is
// not a plain class toggle in one function.
function endSsoWait() {
  document.documentElement.removeAttribute('data-sso');
  if (_ssoSlowTimer) { clearTimeout(_ssoSlowTimer); _ssoSlowTimer = null; }
}

// The honest version of a wait with nothing to report, which is the same thing the
// Legacy archive does: a wait whose length is not ours to control. Measured against
// a cold Apps Script start — a warm exchange lands under a second, and the ones that
// do not are usually the backend waking up — 8s is past where silence stops reading
// as "working" and starts reading as "stuck".
function armSsoSlowNote() {
  if (_ssoSlowTimer) clearTimeout(_ssoSlowTimer);
  _ssoSlowTimer = setTimeout(() => {
    _ssoSlowTimer = null;
    const note = document.getElementById('sso-wait-note');
    if (note) note.textContent = 'Still signing you in — the backend can take a moment to wake up.';
  }, SSO_SLOW_MS);
}

// Finish what the door started. Split out from boot because it is one flow with
// three endings — a session, the backend's own refusal, or the door's own refusal —
// and all three must land on the sign-in screen saying something a person can act
// on. The code is exchanged once; `_handoff` is already spent by the time this runs,
// so a reload cannot replay it.
function finishHandoff(h) {
  // The door refused before it ever reached the app: it can read the caller's
  // Workspace identity and the app cannot, so its words are the only truthful ones
  // available — "sign in with your @indrones.com account" is a real next step, and
  // a generic failure would throw that away.
  //
  // A refusal is NOT a wait, so index.html raises no wait screen for one: there is
  // no round trip to sit through, and the door's sentence is already the answer.
  if (h.error) {
    showAuth();
    setAuthError(h.error);
    return Promise.resolve();
  }
  // A code IS a wait, and the wait screen is already up — index.html raised it
  // before paint, so the form never flashed underneath. It stays up until one of
  // the two endings puts a real screen on: showAuth() for a refusal, or showApp()
  // from inside finishAuth() for a session. Both clear it.
  const btn = document.getElementById('auth-google-btn');
  if (btn) btn.disabled = true;
  armSsoSlowNote();
  return googleExchangeBackend(h.code).then(d => {
    // SUCCESS: Clear the pending code now that it's exchanged
    try { sessionStorage.removeItem('pending_sso_code'); } catch (e) { /* ignore */ }

    if (d && d.status === 'ok' && d.sessionToken) {
      finishAuth(d.email, d);        // showApp() takes the wait screen down
      return;
    }
    if (btn) btn.disabled = false;

    // Every refusal is actionable and says what to do instead — set your own
    // password first, ask an admin, use your email and password. showAuth() puts the
    // password form back and clears the wait screen with it, so the fallback is one
    // tap away.
    showAuth();
    setAuthError((d && d.message) || 'Google sign-in failed — use your email and password.');
  }).catch(() => {
    // The exchange is a POST whose failure postAuth() already turns into a payload,
    // so this is belt and braces — but it is load-bearing NOW, because without it a
    // rejection would leave the wait screen up forever and the only way out would be
    // a reload.
    if (btn) btn.disabled = false;
    showAuth();
    setAuthError('Could not reach the backend — use your email and password, or try again.');
  });
}

// ─── QUICK UNLOCK — fingerprint (WebAuthn) + pattern on a registered device ──
// A registered device may mint the working day's session with a LOCAL gesture:
// the platform's own biometric prompt (WebAuthn, userVerification: required) or
// a drawn 3×3 pattern. What the server holds is the per-device token — and that
// token is only ever offered from the sign-in screen in exchange for a gesture
// that happened on the same device. The stored email of the device's owner is in
// the record too, because the sign-in screen shows no email field in unlock mode.
//
// What this is NOT: a stronger remote door. The daily emailed code remains the
// security; quick unlock trades a little of it for the daily friction, on the
// device the owner already unlocked to get to this screen. A password change
// or an admin disable revokes the registration — see revokeDevicesForIn.
const UNLOCK_KEY = 'ipb_unlock';

function loadUnlock() {
  try { return JSON.parse(localStorage.getItem(UNLOCK_KEY) || 'null'); } catch (e) { return null; }
}
function saveUnlock(rec) {
  try { localStorage.setItem(UNLOCK_KEY, JSON.stringify(rec)); } catch (e) { /* storage blocked */ }
}
function clearUnlock() {
  try { localStorage.removeItem(UNLOCK_KEY); } catch (e) { /* storage blocked */ }
}

// The platform-authenticator gate, resolved lazily: fingerprint support is not
// synchronously knowable, so the check runs once when setup is first asked for.
async function quickUnlockBiometricAvailable() {
  try {
    if (!window.PublicKeyCredential || typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) { return false; }
}

// base64url for a credential id (client-side only state; the backend never
// sees it, so this is a convenience, not a wire format).
function bytesToB64url(bytes) {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesFromB64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s + '=='.slice((s.length + 2) % 4));
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}

// The unlock gesture. No rpId is given (it binds to this origin) and no
// allowCredentials (any resident credential on the device may answer); what the
// gesture must produce is the biometric's own accept. The signature the device
// returns is NOT verified server-side — Apps Script has no Web Crypto — so the
// honest label for this check is "the finger was read", nothing more.
async function unlockFingerprintGesture() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.get({
    publicKey: { challenge, userVerification: 'required', timeout: 60000 }
  });
  return !!cred;
}

// Enrollment. Two credentials are minted together: the server's device token
// (devices.json, via the AUTHED action) and the platform passkey. The local
// record keeps the email, the token and the credential id — the id exists only
// on this device, so a lost phone leaves a token the phone itself guards.
function deviceRegisterBackend() {
  const fd = new FormData();
  fd.append('action', 'deviceRegister');
  // Deliberately the NORMAL fetch, not _origFetch: this is an AUTHED call, and
  // the interceptor is what attaches the session token. postAuth would go out
  // naked and be refused. postJson takes the fetch to use for exactly this reason.
  return postJson(fetch, fd);
}

function deviceRevokeBackend(deviceToken) {
  const fd = new FormData();
  fd.append('action', 'deviceRevoke');
  fd.append('deviceToken', deviceToken);
  return postJson(fetch, fd);
}

// Unlocking = the gesture, then the token, in that order. Nothing reaches the
// backend unless the platform accepted the finger / the pattern matched — so a
// wrong gesture cannot even attempt a server guess on the token.
async function submitUnlock(method, patternSeq) {
  const rec = loadUnlock();
  if (method === 'pattern') {
    // An incomplete draw is not an attempt — the engine never calls back with
    // fewer than PATTERN_MIN_DOTS dots, so this is only the belt to that brace.
    if (!patternSeq) return;
    // A draw with nothing to check it against has to SAY so, and land on a door
    // that opens. This used to be `setAuthMode('email')` and nothing else: on a
    // fingerprint device whose record had no pattern yet (the state right after
    // enrolling), tapping "Use pattern", drawing any pattern, and being thrown to
    // the email/Google form with no fingerprint in sight and no reason given. The
    // owner reported it verbatim as landing "on a login page of either signin
    // with google or with code and not showing option to choose fingerprint".
    if (!rec || !rec.patternHash) {
      const hasFingerprint = !!(rec && rec.deviceToken && (rec.credentialId || rec.mode === 'fingerprint'));
      setAuthMode(hasFingerprint ? 'unlock' : 'email');
      setAuthError(hasFingerprint
        ? 'No pattern is set on this device yet — unlock with your fingerprint, then add one from your profile menu (top right).'
        : 'No quick unlock is set up on this device — sign in with your email and code.');
      return;
    }
    // ── THE LEAD TIME, AND WHERE IT ACTUALLY GOES ──────────────────────────────
    // The owner asked for this method to be quicker, and the honest answer is that
    // most of its time is not in the gesture. `patternHashOf` is one SHA-256, and the
    // draw itself is a finger on glass; the halt is the round trip to Apps Script,
    // which is cold after ~5 minutes and can spend seconds waking up. So the two things
    // that are actually ours to fix:
    //
    //   1. The ping goes out NOW, BEFORE the hash. It is the same warm-up the sign-in
    //      screen already sends, coalesced to one per 15s — so this only fires on a
    //      screen that has been open longer than that, which is exactly the screen where
    //      the container is most likely to have gone cold. It costs one request and it
    //      overlaps the hash and the draw instead of queueing behind them.
    //   2. The busy state goes up NOW, not after the await. It used to be set below,
    //      after `await patternHashOf(...)` — so the "Checking your pattern…" line
    //      arrived a tick late, and that gap is precisely the "long halt and meanwhile
    //      nothing shows on screen" the owner reported. See patternBusy().
    warmBackend();
    patternBusy(true);
    const drawn = await patternHashOf(patternSeq);
    if (drawn !== rec.patternHash) {
      setAuthError('Wrong pattern — try again.');
      resetPatternCanvas();
      return;
    }
  } else {
    if (!rec || !rec.deviceToken || !rec.email) { clearUnlock(); setAuthMode('email'); return; }
  }
  const btn = document.getElementById('auth-unlock-btn');
  if (method === 'fingerprint') {
    if (btn) { btn.disabled = true; btn.textContent = 'Unlocking…'; }
    setAuthError('');
    try {
      // allowCredentials from the stored id when there is one, so the prompt
      // names the exact key this device registered.
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const opts = { challenge, userVerification: 'required', timeout: 60000 };
      if (rec.credentialId) opts.allowCredentials = [{ id: bytesFromB64url(rec.credentialId), type: 'public-key' }];
      const cred = await navigator.credentials.get({ publicKey: opts });
      if (!cred) throw new Error('cancelled');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Unlock with fingerprint'; }
      setAuthError('The fingerprint prompt was cancelled — try again, or use your email code.');
      return;
    }
  }
  // A drawn pattern is a request, and it takes as long as the backend takes. From
  // here until the answer is in, the canvas refuses new strokes and the line under it
  // reads "Checking your pattern…" — see patternBusy() for why that pair is one fix
  // and not two. The matching `resetPatternCanvas()` below is the ONLY way back, and
  // it is on both exits. (A pattern's busy state went up above, next to the hash it
  // belongs with; nothing is left to set here.)
  const patternish = (method === 'pattern');

  postAuth('deviceUnlock', { deviceToken: rec.deviceToken, email: rec.email, method, device: deviceLabel(), version: APP_VERSION }).then(d => {
    if (btn) { btn.disabled = false; btn.textContent = 'Unlock with fingerprint'; }
    if (d && d.status === 'ok' && d.sessionToken) { finishAuth(rec.email, d); return; }
    setAuthError((d && d.message) || 'Unlock failed — sign in with your email and code.');
    // Idle title, NOT a verdict. The canvas goes back to asking for a pattern and the
    // error line above carries what happened — which is exactly how the wrong-draw
    // path already behaves a dozen lines up. Giving this one its own "that pattern did
    // not match" title was worse than redundant: the pattern is checked HERE, against
    // the stored hash, so a refusal from the backend is never a wrong pattern — it is a
    // device token the backend no longer accepts. The title would have blamed the
    // person's gesture for the server's answer, and disagreed with the line above it.
    if (patternish) resetPatternCanvas();
  }).catch(() => {
    if (btn) { btn.disabled = false; btn.textContent = 'Unlock with fingerprint'; }
    if (patternish) resetPatternCanvas();
    setAuthError('Could not reach the backend — use your email and code.');
  });
}

// ─── THE PATTERN ENGINE — one canvas, three uses (unlock, setup, re-setup) ───
// 3×3 dots on a square canvas; a sequence qualifies at 4 dots. Dots carry the
// neutral palette in both themes; the drawn line follows the same values. All
// geometry is derived from the canvas size, so a bigger canvas needs no new math.
const PATTERN_MIN_DOTS = 4;

// ─── THE PATTERN'S TWO STATES, AND WHY THEY ARE ONE BUG ──────────────────────
// The owner's report, verbatim: *"once we enter pattern it takes a long halt and
// meanwhile nothing shows on screen on what is happening and I can enter as many
// times pattern as I want over that."*
//
// Both halves of that are the same missing idea: the canvas did not know a
// verification was in flight. `canvas._busy` is that idea. While it is set,
// `attachPatternCanvas` ignores `pointerdown`, so a second pattern cannot be drawn
// over the first one's answer; and the line under the canvas stops being the
// instruction and becomes the status, so the halt is a sentence on screen instead of
// a freeze. Clearing it is `resetPatternCanvas()`, which every exit path calls —
// a match, a refusal, a request that never arrived.
//
// The one failure mode worth naming: a busy flag left set. The canvas would then
// swallow every future attempt in silence, which is the exact symptom being fixed,
// so `patternForUnlock()` clears it too rather than trusting the last request.
const PATTERN_IDLE = 'Draw your pattern to unlock.';
function patternBusy(on) {
  const canvas = document.getElementById('pattern-canvas');
  const title  = document.getElementById('pattern-title');
  if (canvas) { canvas._busy = !!on; canvas.classList.toggle('is-busy', !!on); }
  if (title && on) title.textContent = 'Checking your pattern…';
}

// ─── "THIS METHOD IS NOT ON THIS DEVICE YET" ─────────────────────────────────
// The two quick-unlock doors are drawn on every entry screen (setAuthMode), so on a
// device that has never enrolled either one a tap has nothing to open. That tap is not
// a failure and it is not silent: it says the owner's sentence and then gives the four
// steps that turn the method on.
//
// The steps name the REAL controls and nothing else. "Turn on Quick unlock" is the
// actual label of the actual row in the avatar menu — syncQuickUnlockMenu owns that
// wording and changes it with the device's state — and the avatar really is in the top
// right corner. Guidance that sends someone looking for a control that does not exist
// is worse than the silence it replaced.
//
// It is shown IN THE PAGE and not as a toast. It is four steps long, and a toast that
// has gone before it is read is the same as no explanation at all.
function showMethodInactiveNote() {
  const note = document.getElementById('auth-method-note');
  if (!note) return;
  note.style.display = '';
  // `role="status"` and a focused close control, so it is announced and can be put away
  // from a keyboard. Deliberately NOT a modal: nothing behind it is blocked, because the
  // person may well decide to type their email instead — which is the form directly
  // above, and the whole reason this note is a note.
  const close = document.getElementById('auth-method-note-close');
  if (close && typeof close.focus === 'function') { try { close.focus(); } catch (e) { /* fine */ } }
}

function hideMethodInactiveNote() {
  const note = document.getElementById('auth-method-note');
  if (note) note.style.display = 'none';
}

function patternHashOf(seq) {
  const bytes = new TextEncoder().encode(seq.join('-') + '|ipb-pattern');
  return crypto.subtle.digest('SHA-256', bytes).then(buf =>
    Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
}

// drawSequence paints dots+path from a sequence; blankCanvas clears.
// attachPatternCanvas wires pointer events once per canvas element, and calls
// back with the FINISHED sequence — the pattern logic lives above the canvas,
// so setup and unlock share the engine without sharing state.
function patternDots(canvas) {
  const m = canvas.width * 0.18, step = (canvas.width - 2 * m) / 2;
  return [0,1,2].flatMap(r => [0,1,2].map(c => ({ x: m + c * step, y: m + r * step, n: r * 3 + c + 1 })));
}
function paintPattern(canvas, seq, hover) {
  const ctx = canvas.getContext('2d');
  const dpi = (typeof isDarkTheme === 'function' && isDarkTheme());
  const bg   = dpi ? '#2a2a2e' : '#f2f2f5';
  const dim  = dpi ? '#4a4a52' : '#d1d5db';
  const live = dpi ? '#e8eaed' : '#4b5563';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const dots = patternDots(canvas);
  const picked = new Set(seq || []);
  ctx.strokeStyle = live + '88'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  if (seq && seq.length > 1) {
    ctx.beginPath();
    seq.forEach((n, i) => {
      const d = dots[n - 1];
      if (i === 0) ctx.moveTo(d.x, d.y); else ctx.lineTo(d.x, d.y);
    });
    if (hover) { const h = dots[hover - 1]; ctx.lineTo(h.x, h.y); }
    ctx.stroke();
  }
  dots.forEach(d => {
    ctx.beginPath();
    ctx.arc(d.x, d.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = picked.has(d.n) ? live : dim;
    ctx.fill();
  });
}
function resetPatternCanvas(message) {
  const c = document.getElementById('pattern-canvas');
  if (c) { c._busy = false; c.classList.remove('is-busy'); paintPattern(c, []); }
  const t = document.getElementById('pattern-title');
  // `message` is how a refusal is said where the finger already is. Omitted, the
  // line goes back to being the instruction — which is what every caller that is not
  // reporting a failure wants.
  if (t) t.textContent = message || PATTERN_IDLE;
}
function attachPatternCanvas(canvas, onPattern) {
  if (!canvas || canvas.dataset.pwired === '1') {
    return;
  }
  canvas.dataset.pwired = '1';
  let seq = [];
  const dotAt = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (canvas.width / r.width);
    const y = (ev.clientY - r.top)  * (canvas.height / r.height);
    const R = canvas.width * 0.10;
    const d = patternDots(canvas).find(dd => Math.hypot(dd.x - x, dd.y - y) <= R * 1.9);
    return d ? d.n : null;
  };
  paintPattern(canvas, []);
  canvas.addEventListener('pointerdown', ev => {
    // A pattern is being checked: this stroke is refused before it is captured, so
    // nothing is drawn and nothing is queued. Without this line a second pattern can
    // be drawn straight over the first one's — the owner could "enter as many times
    // pattern as I want over that".
    if (canvas._busy) return;
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    seq = []; paintPattern(canvas, seq, dotAt(ev));
    canvas._active = true;
  });
  canvas.addEventListener('pointermove', ev => {
    if (!canvas._active) return;
    const n = dotAt(ev);
    if (n && seq.indexOf(n) < 0) { seq.push(n); }
    paintPattern(canvas, seq, n);
  });
  const end = () => {
    if (!canvas._active) return;
    canvas._active = false;
    const out = seq.slice();
    seq = [];
    paintPattern(canvas, out);
    if (out.length >= PATTERN_MIN_DOTS) onPattern(out);
    else paintPattern(canvas, []);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', () => { canvas._active = false; seq = []; paintPattern(canvas, []); });
}

// The sign-in screen's pattern mode: draw = verify = attempt the server call.
async function patternForUnlock() {
  const canvas = document.getElementById('pattern-canvas');
  if (canvas && canvas.dataset.pwired !== '1') {
    attachPatternCanvas(canvas, seq => submitUnlock('pattern', seq));
  }
  // Not a bare repaint: this is also the one place the busy flag is guaranteed back
  // to false, so arriving here after a verification that never came back still leaves
  // a canvas that can be drawn on.
  resetPatternCanvas();
}

// ─── SETUP — offered from the user's own profile menu, never sprung on them ──
// Enrollment: server token first (it is authed), then the passkey, then the
// local record. If the platform refuses a passkey, the fall-back offer is the
// pattern — never a silent failure.
async function beginQuickUnlockSetup() {
  const st = loadUnlock();
  if (st) { if (!st.patternHash) openPatternSetup(); else return offerRemoveUnlock(); return; }
  const biometric = await quickUnlockBiometricAvailable();
  if (biometric) {
    const email = (currentUser && currentUser.email) || '';
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.create({ publicKey: {
        challenge,
        rp: { name: 'I-PASSBOOK' },
        user: { id: new TextEncoder().encode(email), name: email, displayName: (currentUser && currentUser.name) || email },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        attestation: 'none'
      }});
      const reg = await deviceRegisterBackend();
      if (!reg || reg.status !== 'ok' || !reg.deviceToken) {
        showToast((reg && reg.message) || 'Registering this device failed — try again.');
        return;
      }
      saveUnlock({ email, mode: 'fingerprint', deviceToken: reg.deviceToken,
                   credentialId: bytesToB64url(new Uint8Array(cred.rawId)) });
      syncQuickUnlockMenu();
      showToast('Fingerprint unlock is on for this device — a pattern can be added from this menu too.');
      return;
    } catch (e) { /* passkey refused — fall through to the pattern offer */ }
  }
  // No platform biometric (or the passkey was refused): the pattern is the
  // quick-unlock door. The device token exists before the overlay opens, so a
  // record is always complete by the time a first draw can be saved.
  const reg = await deviceRegisterBackend();
  if (!reg || reg.status !== 'ok' || !reg.deviceToken) {
    showToast((reg && reg.message) || 'Registering this device failed — try again.');
    return;
  }
  saveUnlock({ email: (currentUser && currentUser.email) || '', mode: 'pattern', deviceToken: reg.deviceToken });
  syncQuickUnlockMenu();
  openPatternSetup();
}
function offerRemoveUnlock() {
  const st = loadUnlock();
  if (!st) return;
  if (window.confirm('Remove Quick unlock from this device?')) {
    clearUnlock();
    if (st.deviceToken) deviceRevokeBackend(st.deviceToken);
    showToast('Quick unlock removed.');
  }
  syncQuickUnlockMenu();
}

// In-app pattern setup: a small overlay carrying the same canvas engine. Two
// draws — the second must match the first, or nothing is stored.
function openPatternSetup() {
  if (document.getElementById('pattern-setup-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'pattern-setup-overlay';
  // The CLASS is load-bearing, not decoration: the stylesheet styles
  // `.pattern-setup-overlay` — fixed, inset 0, a dimming ground. An unstyled <div>
  // appended to the end of <body> lands BELOW a full-height app layout, i.e.
  // off-screen, so the overlay was built correctly every time and never seen. The
  // owner met exactly that as "clicking add unlock pattern nothing happened".
  ov.className = 'pattern-setup-overlay';
  ov.innerHTML =
    '<div class="glass-card pattern-setup-card">' +
      '<div class="auth-head"><div class="auth-brand">Set your pattern</div>' +
      '<p class="auth-hint" id="pattern-setup-title">Draw a pattern to unlock — 4 dots or more.</p></div>' +
      '<canvas id="pattern-setup-canvas" width="240" height="240"></canvas>' +
      '<p id="pattern-setup-note" class="auth-hint"></p>' +
      '<button type="button" class="signout-btn" id="pattern-setup-cancel">Cancel</button>' +
    '</div>';
  document.body.appendChild(ov);
  ov.style.display = 'flex';
  let first = null;
  const title = ov.querySelector('#pattern-setup-title');
  const note  = ov.querySelector('#pattern-setup-note');
  attachPatternCanvas(ov.querySelector('#pattern-setup-canvas'), async (seq) => {
    if (!first) {
      first = await patternHashOf(seq);
      title.textContent = 'Draw it once more to confirm.';
      note.textContent = '';
    } else {
      const second = await patternHashOf(seq);
      if (second === first) {
        const rec = loadUnlock();
        if (rec) { rec.patternHash = first; rec.mode = rec.credentialId ? 'fingerprint' : 'pattern'; saveUnlock(rec); }
        ov.remove();
        syncQuickUnlockMenu();
        showToast('Pattern saved — quick unlock now uses it on the sign-in screen.');
      } else {
        first = null;
        title.textContent = 'Draw a pattern to unlock — 4 dots or more.';
        note.textContent = 'The two draws did not match — start again.';
      }
    }
  });
  ov.querySelector('#pattern-setup-cancel').addEventListener('click', () => ov.remove());
}

// The offer, once per device, after a real sign-in: a toast, a menu entry —
// never a screen that forces the question.
function maybePromptQuickUnlock(email) {
  try {
    if (loadUnlock()) return;
    if (!window.PublicKeyCredential) return;
    if (!window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem('ipb_unlock_offer') === email + ':seen') return;
    try { localStorage.setItem('ipb_unlock_offer', email + ':seen'); } catch (e) { /* toast anyway */ }
    showToast('Tip: fingerprint quick unlock can be turned on from your profile menu (top right).');
  } catch (e) { /* never gate a sign-in on the offer */ }
}

//
// Modes, and there are FOUR — one per door on the employee's list, plus the two
// quick-unlock screens. 'email' is the entry screen (address + Continue), which is
// also where the quick-unlock pair lives; 'login' is the password field, revealed in
// place for the ONE account state that has a password to type and no other way in; and
// 'unlock' / 'pattern' are the two local gestures on a registered device.
//
// THE THREE RECOVERY MODES ARE GONE. 'otp', 'forgot' and 'reset' all lived in this
// switch and none of them is a screen any more: the code step is now a SCREEN OF ITS
// OWN outside this form (`#code-view`, driven by openCodeView), and the password-reset
// flow behind "Forgot password?" was deleted with the control the owner removed —
// "there is no space for forgot password now because we are not having any password
// based login anyfurther." What survives of it is `showPasswordChange`, which is the
// forced first-login change and a different thing wearing similar clothes.
function setAuthMode(mode) {
  _authMode = mode;
  const set = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  // The "this method is not on this device yet" note belongs to the screen it was opened
  // on and to no other. Putting it away here rather than at each of the four places that
  // change mode means there is one place to look, and a note that cannot outlive its tap.
  hideMethodInactiveNote();

  // The password is the opt-in door — visible ONLY in 'login'. Everywhere else it
  // stays hidden with the wrap that pads it, by the same explicit set the rest of
  // the switches use, so there is exactly one place to look when a field shows.
  const pwMode = (mode === 'login');
  const pwWrap = document.querySelector('#auth-form .pw-wrap');
  set('auth-password', pwMode);
  if (pwWrap) pwWrap.style.display = pwMode ? '' : 'none';
  const pwIn = document.getElementById('auth-password');
  if (pwIn) pwIn.required = pwMode;

  // ── ONE EMPLOYEE SCREEN, NOT TWO ──────────────────────────────────────────────
  // The owner, 2026-10-08: "instead of having two screens, one for email based login
  // and another for other options such as finger print etc, can we not have one?"
  // So 'email' and 'unlock' are the SAME screen and render identically — the quick
  // unlock pair moved ON to the entry screen, and the screen that existed only to
  // hold it is gone. `entry` is that screen; `typed` is "a screen the email field and
  // the primary button belong to", which is the entry screen plus the password door.
  const entry = (mode === 'email' || mode === 'unlock');
  const typed = (entry || pwMode);

  set('auth-signin-btn',    typed);
  // The password door's own way in, on the entry screen and nowhere else: on the
  // password screen it would point at itself. Until this existed the door had NO
  // entry point at all — the only caller of `setAuthMode('login')` was the end of the
  // reset flow — so an account still on the password the admin issued had no way to
  // type it from this screen.
  //
  // ⚠ IT IS ALSO THE ONE THING THAT KEEPS A BRAND-NEW HIRE ABLE TO SIGN IN. The
  // backend REFUSES the emailed code to a temp-password account on purpose, and its
  // own refusal message points at the password door — so this faint last line is not
  // the general password login the owner removed, it is the only door that account
  // has. See the note at the markup, and the two honest fixes on his side.
  set('auth-pwd-link',      typed && !pwMode);
  // The quick-unlock pair is on the ENTRY screen now — that is the merge above — and
  // still on the pattern canvas, where the fingerprint button is the one-tap
  // alternative to drawing.
  //
  // BOTH BUTTONS ARE ALWAYS DRAWN on the entry screen, whether or not this device has
  // the method. That is the owner's call of 2026-10-08, and it reverses an earlier one
  // of mine (*"offering a door that opens onto nothing is worse than not offering it"*)
  // which was wrong for the same reason it was tidy: a person who has never heard of
  // the feature cannot miss it. What a tap does now depends on the record — see the
  // handlers in wireAuthForm — and the note beside them is the explanation.
  //
  // The record is read FRESH here rather than once at boot, because it changes while
  // the page stays open (the setup overlay writes it, and so does removal).
  const quickOn = (entry || mode === 'pattern');
  set('auth-quick',         quickOn);
  const quickNow = quickOn ? (loadUnlock() || {}) : {};
  if (quickOn) {
    // On the pattern canvas the two are drawn for their real state: drawing already IS
    // the pattern door, so a second "Continue with pattern" would be a control with
    // nothing to do.
    const fp  = !!(quickNow.credentialId || quickNow.mode === 'fingerprint');
    const pat = !!quickNow.patternHash;
    set('auth-unlock-btn',   mode === 'pattern' ? fp : true);
    set('auth-pattern-link', mode === 'pattern' ? pat : true);
  }
  set('auth-pattern',       mode === 'pattern');
  // "Back to sign in" undoes the last tap, so it belongs on every screen that IS one
  // tap away from the entry screen — and on none of the ones that are the entry
  // screen. 'unlock' used to show it; it is the entry screen now, so it cannot.
  //
  // The password door keeps it too, and used not to. That was right while the only
  // way in was the end of the reset flow, which had nowhere to go back to; now that
  // the door has its own line on the entry screen, a person who taps it and finds a
  // password box they cannot fill must be able to get out — and its own label says
  // what getting out means, because "Back to sign in" describes the screen they are
  // already looking at.
  set('auth-back-link',     !entry);
  const backOut = document.getElementById('auth-back-link');
  if (backOut) backOut.textContent = pwMode ? 'Use an email code instead' : 'Back to sign in';
  // The email field feeds every typed door. Only the pattern canvas has none: that
  // screen knows the email from the device's own record.
  set('auth-email',         mode !== 'pattern');
  // The Google door belongs to the typed screens and nowhere else. It is the one
  // control on this screen that ignores everything typed above it, so it must not sit
  // beside the pattern canvas, where there is no form for it to ignore.
  //
  // Visibility is now just "is a second deployment configured". It used to depend on
  // a silent probe's answer, which had to go: the probe was a background call, and
  // Google refuses those to this deployment (see the GOOGLE SIGN-IN block). So a
  // machine with no Google session shows the button too, and clicking it lands on
  // Google's own page — which offers to sign in, and refuses a personal account with
  // a sentence Google writes, before our code is reached. An absent button would
  // have been tidier and less honest: it would tell a person the feature does not
  // exist when the truth is that they are not signed in.
  const firstStep = typed;
  set('auth-google-btn',    firstStep && !!CONFIG.SSO_URL);
  // THE DIVIDER IS THE BLOCK'S, NOT GOOGLE'S. It used to be `!!CONFIG.SSO_URL` with
  // the Google button, which was right while the button was the only thing under it.
  // It now sits above three alternatives, and since 2026-10-08 two of them — the unlock
  // pair — are drawn on every entry screen whether or not this device can use them. So
  // "is there anything below me" and "is this the entry screen" are now the same
  // question, and keying the line on SSO_URL would drop it between "Continue" and a
  // pair that is still sitting right there. A lone "or" is the one thing this line must
  // never be, and it now can never be one: the pair is unconditional.
  set('auth-or',            firstStep && (!!CONFIG.SSO_URL || quickOn));
  // The notice line carries one transient sentence at a time ("Taking you to
  // Google…") and is EMPTY on every other screen — which is to say hidden, because a
  // line that reserves its own height is a gap that reads as something failing to
  // load. It is written by submitGoogleSignIn and put away by every mode change,
  // which is this line and only this line.
  const hint = document.getElementById('auth-hint-text');
  if (hint) { hint.textContent = ''; hint.style.display = 'none'; }
  const signBtn = document.getElementById('auth-signin-btn');
  if (signBtn) signBtn.textContent = pwMode ? tFloor('auth.signIn', 'Sign in') : tFloor('auth.continue', 'Continue');
  const err = document.getElementById('auth-error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
}

// ─── SHOW / HIDE A PASSWORD ──────────────────────────────────────────────────
// Every password box in the app gets a reveal toggle. Four fields, one rule: the
// button is a SIBLING of the input inside .pw-wrap, so the input is found by
// walking to the wrapper rather than by keeping a second id in sync.
//
// These are the only glyphs in the app not seeded by initIcons(). initIcons runs
// from showApp(), which is the SIGNED-IN screen — the auth card is up long before
// it, so a toggle seeded there would be blank exactly when it is first needed.
// maskAllPasswords() seeds them instead, from each screen's own show path.
let _pwTogglesWired = false;

function wirePasswordToggles() {
  if (_pwTogglesWired) return;
  _pwTogglesWired = true;
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.pw-wrap');
      const input = wrap && wrap.querySelector('input');
      if (!input) return;
      setPasswordRevealed(btn, input.type === 'password');
      // The caret would otherwise jump to the end, because changing `type`
      // re-creates the input's selection — which reads as the form losing your
      // place in the middle of typing.
      input.focus();
      const n = input.value.length;
      try { input.setSelectionRange(n, n); } catch { /* no selection on type=email */ }
    });
  });
}

// Show ↔ hide ONE field. The two glyph names are written as literals rather than
// picked by a ternary, because smoke-ui.mjs cross-checks every ICON_PATHS key
// against its references and a computed name would read as a dead entry.
function setPasswordRevealed(btn, reveal) {
  const wrap = btn.closest('.pw-wrap');
  const input = wrap && wrap.querySelector('input');
  if (input) input.type = reveal ? 'text' : 'password';
  btn.setAttribute('aria-pressed', reveal ? 'true' : 'false');
  btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  const icon = btn.querySelector('.pw-toggle-icon');
  if (!icon) return;
  if (reveal) icon.innerHTML = iconSvg('eye-off');
  else        icon.innerHTML = iconSvg('eye');
}

// Put every toggle back to masked, and seed their glyphs. Called when a password
// screen is SHOWN, not when it is left: a field left revealed must not come back
// revealed the next time that screen appears, which on a shared machine is the
// whole risk the mask is there for.
function maskAllPasswords() {
  document.querySelectorAll('.pw-toggle').forEach(btn => setPasswordRevealed(btn, false));
}

// The one error line on the sign-in screen. Named rather than inlined so a caller
// outside wireAuthForm's scope (the Google door) reports a refusal in exactly the
// same place, in the same style, as a wrong password does.
function setAuthError(message) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = message || '';
  el.style.display = message ? 'block' : 'none';
}

// ─── FORCED FIRST-LOGIN PASSWORD CHANGE ──────────────────────────────────────
// A full-screen sibling of #app-container: while it is up, nothing in the shell
// is reachable.
//
// It is presentation only. A temp-password sign-in returns NO session token (see
// backend doLoginPassword), so there is nothing to skip TO — removing this screen
// in devtools leaves you signed out with no way in. The temporary password is held
// in a module-local variable and never touches storage.
let _pcEmail = '';
let _pcTemp = null;
let _pcWired = false;

function showPasswordChange(email, forced, tempPassword) {
  _pcEmail = (email || '').toLowerCase().trim();
  if (forced) _pcTemp = tempPassword || _pcTemp;
  else _pcTemp = null;
  // The code step is a third full-screen sibling; all three are mutually exclusive, and
  // each one takes the other two down rather than trusting the route that reached it.
  closeCodeView(false);
  authCont.style.display = 'none';
  appCont.style.display  = 'none';
  document.body.classList.remove('view-detail');
  const pc = document.getElementById('password-change');
  if (!pc) { showAuth(); return; }
  pc.style.display = 'flex';
  const em = document.getElementById('pc-email');
  if (em) em.textContent = _pcEmail;
  const sub = document.getElementById('pc-sub');
  if (sub) {
    sub.textContent = forced
      ? 'Welcome. Set your own password to finish setting up your account — you only do this once.'
      : 'Choose a new password for your account.';
  }
  ['pc-new', 'pc-confirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const err = document.getElementById('pc-error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  wirePasswordChange();
  // Same rule as the auth card: this screen is shown fresh, so any field that was
  // left revealed last time comes back masked, and the toggles get their glyphs
  // (initIcons has not run for a first-login screen — there is no app yet).
  wirePasswordToggles();
  maskAllPasswords();
  const first = document.getElementById('pc-new');
  if (first) setTimeout(() => first.focus(), 60);
}

function wirePasswordChange() {
  if (_pcWired) return;
  _pcWired = true;
  const form   = document.getElementById('pc-form');
  const save   = document.getElementById('pc-save');
  const out    = document.getElementById('pc-signout');
  const errEl  = document.getElementById('pc-error');
  const showErr = m => { if (errEl) { errEl.textContent = m; errEl.style.display = m ? 'block' : 'none'; } };

  if (out) out.addEventListener('click', () => { _pcTemp = null; signOut(); });

  const submit = () => {
    const a = (document.getElementById('pc-new') || {}).value || '';
    const b = (document.getElementById('pc-confirm') || {}).value || '';
    if (a.length < 8) { showErr('Password must be at least 8 characters.'); return; }
    if (a !== b) { showErr('The two passwords do not match.'); return; }
    if (!_pcTemp) { showErr('Your sign-in expired — please sign in again.'); showAuth(); return; }
    if (save) { save.disabled = true; save.textContent = 'Setting…'; }
    showErr('');
    changePasswordBackend(_pcEmail, _pcTemp, a).then(d => {
      if (save) { save.disabled = false; save.textContent = 'Set password & continue'; }
      if (d && d.status === 'ok' && d.sessionToken) {
        _pcTemp = null;
        finishAuth(_pcEmail, d);
      } else {
        showErr((d && d.message) || 'Could not set the password.');
      }
    });
  };
  if (save) save.addEventListener('click', submit);
  if (form) form.addEventListener('submit', ev => { ev.preventDefault(); submit(); });
}

function wireAuthForm() {
  if (_authFormWired) return;
  const form = document.getElementById('auth-form');
  if (!form) return;
  _authFormWired = true;

  const emailIn    = document.getElementById('auth-email');
  const passIn     = document.getElementById('auth-password');
  const signInBtn  = document.getElementById('auth-signin-btn');
  // The same line the Google door writes to — one definition, so a refusal from
  // either door appears in one place and in one style.
  const showError  = setAuthError;
  const emailOf    = () => ((emailIn && emailIn.value) || '').trim().toLowerCase();

  // STAGE 1 of the daily door (mode 'email'): the email alone earns the code.
  // There is no password here and none is sent; the response is the backend's own
  // sentence — uniform in shape whether an account received a code or not, which is
  // what keeps this step from being an oracle — and the ONLY thing this function does
  // with `otpRequired` is move to the code screen. It does not repeat the message:
  // the code screen's own sub-line says what was sent and where, in the owner's words.
  const submitLogin = () => {
    const email = emailOf();
    if (!email) { showError('Enter your email.'); return; }
    setBusy(signInBtn, tFloor('auth.sending', 'Sending…'));
    showError('');
    currentUser = currentUser || {};
    currentUser.email = email;
    loginBackend(email, '').then(d => {
      setIdle(signInBtn, tFloor('auth.continue', 'Continue'));
      if (d && d.status === 'ok' && d.otpRequired) { openCodeView('employee', email, ''); return; }
      // A temp-password account gets `ok` here too, from the backend's own uniform
      // stage 1 — the refusal only lands on stage 2, and the code screen's error line
      // is where it is said. So the only thing reachable here is a real failure.
      showError((d && d.message) || 'Could not send a sign-in code.');
    });
  };

  // The password door (mode 'login'). A legacy shell's flow, and the ONLY door a
  // first-login temp-password account has: changePassword is paid with the
  // admin-issued password, so it can never go through here passwordless.
  const submitPwd = () => {
    const email = emailOf();
    const password = (passIn && passIn.value) || '';
    if (!email || !password) { showError('Enter your email and password.'); return; }
    setBusy(signInBtn, tFloor('auth.signingIn', 'Signing in…'));
    showError('');
    currentUser = currentUser || {};
    currentUser.email = email;
    loginBackend(email, password).then(d => {
      setIdle(signInBtn, tFloor('auth.signIn', 'Sign in'));
      // A temporary password is correct but not yet a session — the change is the
      // only way forward, and the password just typed is the credential for it.
      if (d && d.mustChangePassword) { showPasswordChange(email, true, password); return; }
      // Stage 1 of two: the password is right and a code is on its way. The password
      // rides along to the code screen, because the backend checks it again there.
      if (d && d.status === 'ok' && d.otpRequired) { openCodeView('employee', email, password); return; }
      if (d && d.status === 'ok' && d.sessionToken) finishAuth(email, d);
      else showError((d && d.message) || 'Sign in failed.');
    });
  };

  // The password door has its own submit call: same handler for a click and for
  // Enter, so the two doors cannot drift apart later.
  if (signInBtn) signInBtn.addEventListener('click', () => (_authMode === 'login' ? submitPwd() : submitLogin()));
  // The password door is a door INSIDE the one entry screen rather than a screen
  // of its own — one line at the foot of the card, and `setAuthMode('login')` reveals
  // the password box in place. It exists for the one account that has a password to
  // type and no other way in: a new hire still holding the password their admin
  // issued, who has not yet been through the change that replaces it.
  const pwdLink = document.getElementById('auth-pwd-link');
  if (pwdLink) pwdLink.addEventListener('click', () => setAuthMode('login'));
  // The back door exists in every sub-mode: unlock, pattern, and the password field.
  // 'email' is the screen every one of those is a variation of.
  const backLink = document.getElementById('auth-back-link');
  if (backLink) backLink.addEventListener('click', () => setAuthMode('email'));
  const googleBtn = document.getElementById('auth-google-btn');
  if (googleBtn) googleBtn.addEventListener('click', submitGoogleSignIn);

  // Quick unlock, on the sign-in screen. The two doors are ALWAYS drawn (see
  // setAuthMode), so a tap has two possible meanings and the record decides which: open
  // the door, or explain how to get one. Nothing here re-reads the record from a
  // closure captured at wiring time — `loadUnlock()` is the live value, and the setup
  // overlay writes it while this page is open.
  const methodReady = (which) => {
    const q = loadUnlock() || {};
    return which === 'fingerprint'
      ? !!(q.credentialId || q.mode === 'fingerprint')
      : !!q.patternHash;
  };
  const unlockBtn = document.getElementById('auth-unlock-btn');
  if (unlockBtn) unlockBtn.addEventListener('click', () => {
    if (!methodReady('fingerprint')) return showMethodInactiveNote();
    submitUnlock('fingerprint');
  });
  const patternLink = document.getElementById('auth-pattern-link');
  if (patternLink) patternLink.addEventListener('click', () => {
    if (!methodReady('pattern')) return showMethodInactiveNote();
    setAuthMode('pattern');
    patternForUnlock();
  });
  const noteClose = document.getElementById('auth-method-note-close');
  if (noteClose) noteClose.addEventListener('click', hideMethodInactiveNote);

  // Enter submits the CURRENT mode, not always login.
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    if (_authMode === 'login') submitPwd();
    else if (_authMode === 'unlock') submitUnlock('fingerprint');
    else submitLogin();
  });
}

// ─── THE CUSTOMER'S SIGN-IN, ON THE LANDING PAGE ─────────────────────────────
//
// The second door signs in HERE rather than on customer.html, because the owner
// asked for one page carrying both — and a door that hands you to another page to
// be opened is not one door.
//
// IT WRITES THE CUSTOMER'S KEYS AND NEVER THE STAFF'S. `ipbc_session` / `ipbc_user`,
// the exact strings customer.html reads, so this form and that page are one session
// and not two. The staff keys are `ipb_session` / `ipb_user` — one different letter,
// which is precisely the kind of thing that gets typed wrong, so the two names are
// written once here and once there and tools/smoke-portal.mjs reads BOTH files and
// fails if either copy moves.
//
// IT DOES NOT REUSE loginBackend(). That helper is not a request, it is the staff
// SIGN-IN: it stamps `currentUser`, calls persistSession and writes the staff keys
// as a side effect. Calling it from the customer's button would sign a customer into
// the staff shell on the way past. What is shared is the REQUEST — postAuth, the same
// action names, the same retry rules — and nothing above it.
//
// The flow is the backend's, not ours. A password is checked and then still needs the
// emailed code (second factor, backend.gs's doLoginPassword); no password at all IS
// the code door. So both routes end in the same place: a code box, then a session.

function customerAuth(action, fields) {
  return postAuth(action, Object.assign({ device: deviceLabel(), version: APP_VERSION }, fields));
}
// The customer's state is now ONE state. There used to be `_custStage` ('form' |
// 'code') and a code block inside this panel; the code lives on its own screen now
// (#code-view), shared with the employee's door, and this form's only job is to ask
// for an address and hand over to it. `_codeDoor` on that screen remembers which door
// asked, so the way back lands on the right one.
function wireCustomerForm() {
  const form    = document.getElementById('cust-form');
  if (!form || form.dataset.wired === '1') return;
  form.dataset.wired = '1';

  const emailIn = document.getElementById('cust-email');
  const signBtn = document.getElementById('cust-signin-btn');
  const errEl   = document.getElementById('cust-error');

  const showError = (m) => {
    if (!errEl) return;
    errEl.textContent = m || '';
    errEl.style.display = m ? '' : 'none';
  };
  const emailOf = () => ((emailIn && emailIn.value) || '').trim().toLowerCase();

  // THE CUSTOMER'S ONE AND ONLY DOOR: an email address, and a code we mail to it.
  //
  // There is no password field on this card by the owner's instruction — "for
  // customers as well, there is no password method like of employee's, it is only
  // email OTP based login" — so this button does what the customer can actually do.
  // `password: ''` is not an empty password: the backend reads the ABSENCE of a real
  // one as the passwordless door, which is why the key is present and empty rather
  // than missing (doLoginPassword's other branch would reject a blank string).
  const requestCustomerCode = () => {
    const email = emailOf();
    if (!email) { showError('Enter your email address.'); return; }
    showError('');
    // THROUGH THE ONE HELPER, not by hand. This button used to set `.disabled` and
    // `textContent` itself, which made it the one auth button on the page that went
    // busy without the `is-busy` class the spinner and the reduced-motion guard are
    // keyed on — and the customer's Continue is the button on this screen a person is
    // most likely to press twice, because the reply is a mail they cannot see.
    // The busy label goes through the table like the idle one. It used to be a literal
    // on BOTH doors, with a comment saying so rather than fixing it, and the comment was
    // right about why that was wrong: switching the picker to हिन्दी left the one word a
    // person sees WHILE THEY WAIT in the language they just chose to leave.
    setBusy(signBtn, tFloor('auth.sending', 'Sending…'));
    const idle = () => setIdle(signBtn, tFloor('cust.continue', 'Continue'));
    customerAuth('login', { email: email, password: '' }).then(d => {
      idle();
      // The address is the credential and the code is the proof. The screen that
      // takes the code is the SAME one the employee's email door leads to: an
      // employee at this step and a customer at this step are in one state.
      if (d && d.status === 'ok' && d.otpRequired) { openCodeView('customer', email, ''); return; }
      // A brand-new invitee is on a temporary password, and the backend will not mint
      // a login code for one. Saying "we emailed you a code" here would send them to
      // an inbox that is empty and keep them there — customer.html learned the same
      // lesson and says the same thing. The way out is the sentence already printed
      // under this button: contact the desk. That address is on the panel for exactly
      // this case as well as for someone who never onboarded at all.
      if (d && d.status === 'ok' && d.mustChangePassword) {
        showError(t('cust.tempPasswordNoCode'));
        return;
      }
      showError((d && d.message) || 'Could not send a sign-in code.');
    });
  };

  if (signBtn) signBtn.addEventListener('click', requestCustomerCode);
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    requestCustomerCode();
  });
}

// The session lands in localStorage and the customer is handed to the portal, which
// finds the token already there and boots straight into their own tickets instead of
// asking them to sign in a second time.
function finishCustomerAuth(email, d) {
  try {
    localStorage.setItem('ipbc_session', d.sessionToken);
    localStorage.setItem('ipbc_user', JSON.stringify({
      email: email,
      customerOf: (d && d.access && d.access.customerOf) || '',
    }));
  } catch (e) { /* private mode — the redirect will ask again, which is honest */ }
  location.href = 'customer.html';
}

// Which of the customer card's two faces is up: the form, or the way in for someone
// who is already signed in on this device. Read from the CUSTOMER's key, never the
// staff one — a staff session on this machine must not open the customer's door, and
// the customer's must not open the app's.
function paintCustomerDoor() {
  const form = document.getElementById('cust-form');
  const session = document.getElementById('cust-session');
  if (!form || !session) return;
  let has = false;
  try { has = !!localStorage.getItem('ipbc_session'); } catch (e) { has = false; }
  form.style.display = has ? 'none' : '';
  session.style.display = has ? '' : 'none';
  if (!has) wireCustomerForm();
}

// ════════════════════════════════════════════════════════════════════════════════
//   THE LANDING PAGE'S OWN FURNITURE — the two doors, the language picker, the
//   corner button. Wired once, from the load handler, because they are properties
//   of the SCREEN and not of any one sign-in flow.
// ════════════════════════════════════════════════════════════════════════════════

// ─── THE TWO DOORS ────────────────────────────────────────────────────────────
// The owner, 2026-10-08: *"First, let us have both employee login and customer login
// option arranged vertically aligned, one above another. each condensed, i.e.,
// collapsible, so whichever the person wants to access will click on/arrow and expand
// it."*
//
// EXCLUSIVE, LIKE A SET OF RADIOS. Opening one closes the other, and pressing the bar
// that is already open keeps it open rather than shutting it — so there is no "both
// shut" state for the page to fall into. That is not a limitation but the reason the
// shape works: two open panels put the employee's four mechanisms and the customer's
// three above each other, which is exactly the clutter he was describing, only taller.
//
// THE CHOICE IS REMEMBERED PER DEVICE. Somebody who opens this screen twice in a day is
// almost always the same kind of person twice, and a bar that reopens on the wrong door
// costs a click from every one of them.
const DOOR_KEY = 'ipb_door';
const DOORS = ['employee', 'customer'];

let _doorsWired = false;

function wireDoors() {
  if (_doorsWired) return;
  if (!document.getElementById('door-employee')) return;
  _doorsWired = true;
  DOORS.forEach(which => {
    const bar = document.getElementById('door-' + which + '-toggle');
    if (bar) bar.addEventListener('click', () => setDoor(which));
  });
}

// Opens `which` and closes the other. No argument closes nothing: it is not a toggle,
// it is a choice — see the note above.
function setDoor(which) {
  const want = DOORS.indexOf(which) >= 0 ? which : 'employee';
  DOORS.forEach(w => {
    const sec  = document.getElementById('door-' + w);
    const bar  = document.getElementById('door-' + w + '-toggle');
    const body = document.getElementById('door-' + w + '-body');
    if (!sec || !bar || !body) return;
    const on = (w === want);
    // `data-open` drives the chevron's rotation, `hidden` is what actually folds the
    // panel, and `aria-expanded` is what a screen reader is told. Three statements of
    // one fact, which is one more than is comfortable — but `hidden` alone leaves the
    // arrow pointing down inside a shut panel, and a class alone leaves a keyboard user
    // tabbing through fields they cannot see.
    sec.dataset.open = on ? '1' : '0';
    bar.setAttribute('aria-expanded', on ? 'true' : 'false');
    body.hidden = !on;
  });
  try { if (which) localStorage.setItem(DOOR_KEY, want); } catch (e) { /* storage blocked */ }
}

// Which door opens on arrival: the one this device used last, the Employee's by
// default. NEVER both shut — the line under the pair ("By continuing, you acknowledge…")
// would then be acknowledging a tap nobody was offered.
function paintDoors() {
  wireDoors();
  let want = '';
  try { want = localStorage.getItem(DOOR_KEY) || ''; } catch (e) { want = ''; }
  setDoor(DOORS.indexOf(want) >= 0 ? want : 'employee');
}

// ─── THE LANGUAGE PICKER ───────────────────────────────────────────────────────
// The owner asked for it "at bottom like in notion.app". The options are built from
// I18N.LANGS rather than written into index.html, so a language added to that list
// appears here with no second edit — and the label is each language's OWN name
// ("हिन्दी", not "Hindi"), which is the one word on the list a reader can recognise
// without already being able to read the rest of it.
//
// ⚠ TWO OPTIONS, AND BOTH OF THEM DO SOMETHING. English is the source table; हिन्दी has
// its own, so choosing it really does change the words. Urdu was a third entry until
// 2026-10-08, when the owner withdrew it — *"even in my previous command I said about
// urdu. Keep only hindi and english"* — and it was DELETED rather than left as an option
// that silently showed English. See the note on the language dimension in i18n.js, which
// also records how far the Hindi table reaches: the chrome, the statuses and the landing
// page, with the six section forms still English inside the Hindi frame.
function buildLangSelect() {
  const sel = document.getElementById('lang-select');
  if (!sel || !window.I18N || !window.I18N.LANGS) return;
  sel.textContent = '';
  window.I18N.LANGS.forEach(l => {
    const o = document.createElement('option');
    o.value = l.code;
    o.textContent = l.label;
    sel.appendChild(o);
  });
  sel.value = window.I18N.lang();
  sel.addEventListener('change', () => {
    if (!window.I18N.setLang(sel.value)) { sel.value = window.I18N.lang(); return; }
    // setLang() repaints every `data-i18n` element, and the door bars carry their role
    // word that way. The accordion's own state is an attribute pair, not text, so it is
    // untouched — but repainting it is one line and keeps this handler from having to
    // know which of the two facts changed.
    paintDoors();
  });
  // The label on a <select> is the page's own word for "Language", so it is repainted
  // by setLang's applyStatic pass like every other static string.
}

// ─── THE CORNER BUTTON ─────────────────────────────────────────────────────────
// Where every site in this shape puts "Sign Up", and this one cannot, because there is
// no sign-up: an admin provisions every account. So the corner holds the thing a person
// who cannot get in actually needs instead — the desk.
//
// HIDDEN WHILE CONFIG.WHATSAPP_URL IS EMPTY, and that is the honest state rather than an
// unfinished one. A button that opens an empty tab is worse than no button, and there is
// no Indrones after-sales WhatsApp link I can verify from here. See the note on that key
// in CONFIG: paste the URL and this appears, with no other change.
function wireWhatsApp() {
  const btn = document.getElementById('whatsapp-btn');
  if (!btn) return;
  const url = CONFIG.WHATSAPP_URL;
  if (!url) { btn.style.display = 'none'; return; }
  btn.href = url;
  btn.style.display = '';
}

function wireLanding() {
  buildLangSelect();
  wireWhatsApp();
  wireDoors();
  wireCodeView();
}

// ════════════════════════════════════════════════════════════════════════════════
//   THE CODE STEP — "Check your email", one box per digit
// ════════════════════════════════════════════════════════════════════════════════
//
// ONE SCREEN FOR BOTH DOORS. The owner, 2026-10-08: *"it lands in next screen totally
// blank and in center it says 'Check your email' in big heading and below it is 'If you
// have a indrones after sales account, we sent a code to <that email id>.' in normal
// text size. then equivant number of boxes below that line to fill the code. and a
// button below boxes saying 'Use a different account'. clicking this button will land
// back to initial login page."*
//
// An employee at this step and a customer at this step are in the SAME STATE — an
// address that has been mailed a 6-digit code — so there is one screen and not two, and
// `_codeDoor` is the only thing that differs. The two blocks this replaced
// (#auth-login-code-wrap inside the employee's form, #cust-code-wrap inside the
// customer's) were two copies of one idea, free to drift.
//
// ⚠ THE BOXES ARE SIX REAL INPUTS, NOT ONE FIELD WITH A SIX-CELL BACKGROUND. That is
// what opens the phone's numeric keypad on the first box and lets the OS offer the code
// straight from the mail. The cost is that app.js owns the caret, the paste and the
// submit — which is the rest of this block.

let _codeWired = false;

function codeBoxes() {
  const wrap = document.getElementById('code-boxes');
  return wrap ? Array.prototype.slice.call(wrap.querySelectorAll('.code-box')) : [];
}
function codeValue() {
  return codeBoxes().map(b => b.value.replace(/\D/g, '')).join('');
}
function setCodeError(message) {
  const el = document.getElementById('code-error');
  if (!el) return;
  el.textContent = message || '';
  el.style.display = message ? '' : 'none';
}

// Show the step. `door` is 'employee' | 'customer' (only for the way back and for which
// request to make); `password` is the stage-1 credential on the password door, and ''
// everywhere else.
function openCodeView(door, email, password) {
  _codeDoor = (door === 'customer') ? 'customer' : 'employee';
  _codeEmail = (email || '').trim().toLowerCase();
  _codePassword = password || '';
  const em = document.getElementById('code-email');
  if (em) em.textContent = _codeEmail;
  setCodeError('');
  codeBoxes().forEach(b => { b.value = ''; b.disabled = false; });
  const cv = document.getElementById('code-view');
  if (cv) { cv.dataset.open = '1'; cv.dataset.busy = '0'; cv.removeAttribute('aria-busy'); }
  // The landing page goes away ENTIRELY — head, both doors, the terms line, the
  // language picker — which is what makes this read as the blank centred page he asked
  // for. `stopBrandTyping()` is part of that and not an optimisation: the head's chain
  // would otherwise keep typing into a screen that is not on screen.
  authCont.style.display = 'none';
  appCont.style.display  = 'none';
  stopBrandTyping();
  const pc = document.getElementById('password-change');
  if (pc) pc.style.display = 'none';
  document.body.classList.remove('view-detail');
  const boxes = codeBoxes();
  // Focused on the next tick, not now: the screen has only just been shown and a
  // focus() on a node the browser has not laid out yet is silently dropped.
  if (boxes[0]) setTimeout(() => boxes[0].focus(), 60);
}

// "Use a different account" — and every other route off this screen — lands back on the
// landing page with the door that asked OPEN and the address still in the box. Not the
// employee's door by default: a customer who mistyped their address and is put back on
// the wrong panel has lost their place.
function closeCodeView(restore) {
  const cv = document.getElementById('code-view');
  if (cv) { cv.dataset.open = '0'; cv.dataset.busy = '0'; cv.removeAttribute('aria-busy'); }
  if (restore === false) return;
  showAuth();
  setDoor(_codeDoor === 'customer' ? 'customer' : 'employee');
  const field = document.getElementById(_codeDoor === 'customer' ? 'cust-email' : 'auth-email');
  if (field && _codeEmail) field.value = _codeEmail;
}

// Spread a run of digits across the boxes, starting at `from` — except a FULL code,
// which always starts at the first box however it arrived. That exception is the whole
// reason this exists as a function: the OS's one-time-code autofill can deliver all six
// digits into whichever box has focus, and filling them from that box would leave the
// first ones empty and submit a code assembled in the wrong order.
function distributeCode(digits, from) {
  const boxes = codeBoxes();
  if (!boxes.length) return;
  const start = (digits.length >= boxes.length) ? 0 : Math.max(0, Math.min(from, boxes.length - 1));
  for (let i = 0; i < boxes.length; i++) boxes[i].value = '';
  for (let i = 0; i < digits.length && start + i < boxes.length; i++) boxes[start + i].value = digits.charAt(i);
  const next = boxes[Math.min(start + digits.length, boxes.length - 1)];
  if (next) next.focus();
  if (codeValue().length === boxes.length) submitCode();
}

function wireCodeView() {
  if (_codeWired) return;
  const form = document.getElementById('code-form');
  if (!form) return;
  _codeWired = true;
  const boxes = codeBoxes();

  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      const digits = box.value.replace(/\D/g, '');
      // More than one digit arriving at once is a paste or the OS's autofill, never a
      // keystroke — `maxlength="1"` means a person cannot type two. Handing it to
      // distributeCode() is what makes autofill fill all six rather than keep the last.
      if (digits.length > 1) { distributeCode(digits, i); return; }
      box.value = digits;
      if (digits && i < boxes.length - 1) boxes[i + 1].focus();
      if (codeValue().length === boxes.length) submitCode();
    });
    box.addEventListener('keydown', ev => {
      // Backspace at an EMPTY box steps back a box, which is what a thumb expects and
      // what a single six-character field can never do. It is prevented because the
      // default on an empty box is nothing at all, and the point is that something
      // should happen.
      if (ev.key === 'Backspace' && !box.value && i > 0) {
        ev.preventDefault();
        boxes[i - 1].value = '';
        boxes[i - 1].focus();
        return;
      }
      if (ev.key === 'ArrowLeft' && i > 0) { ev.preventDefault(); boxes[i - 1].focus(); }
      if (ev.key === 'ArrowRight' && i < boxes.length - 1) { ev.preventDefault(); boxes[i + 1].focus(); }
    });
    // Select on focus, so typing over a box replaces its digit rather than being
    // swallowed by `maxlength`. Without this, correcting the second digit of a code
    // means backspace-then-type, which is two gestures to do one thing.
    box.addEventListener('focus', () => { try { box.select(); } catch (e) { /* fine */ } });
    box.addEventListener('paste', ev => {
      const clip = ev.clipboardData || window.clipboardData;
      const raw = clip ? (clip.getData('text') || '') : '';
      const digits = raw.replace(/\D/g, '');
      if (!digits) return;
      // The browser's own paste would put the whole string into one box whose
      // maxlength is 1 — which, by browser, either truncates it to the first digit or
      // does nothing. Neither is the code.
      ev.preventDefault();
      distributeCode(digits, i);
    });
  });

  form.addEventListener('submit', ev => { ev.preventDefault(); submitCode(); });
  const diff = document.getElementById('code-different');
  if (diff) diff.addEventListener('click', () => closeCodeView(true));
  if (boxes[0]) setTimeout(() => boxes[0].focus(), 60);
}

// Verify. WHICH REQUEST IS MADE IS THE ONLY THING THE DOOR CHANGES: a customer's code is
// checked by the same backend action the staff door uses (`login` with no password IS
// the OTP door), but a customer's session must be written under the CUSTOMER's keys and
// hand off to customer.html — which is finishCustomerAuth's job and not finishAuth's.
function submitCode() {
  const code = codeValue();
  if (!/^\d{6}$/.test(code)) { setCodeError('Enter the 6-digit code from your email.'); return; }
  const cv = document.getElementById('code-view');
  // Busy as an ATTRIBUTE rather than as disabled boxes: the boxes are what the answer's
  // arrival will focus, and disabling the field the person is looking at moves the
  // screen under them. `data-busy` dims the group and refuses further input in CSS, and
  // this guard is what stops a second submit from the form's own submit event.
  if (cv && cv.dataset.busy === '1') return;
  if (cv) { cv.dataset.busy = '1'; cv.setAttribute('aria-busy', 'true'); }
  setCodeError('');
  const idle = () => { if (cv) { cv.dataset.busy = '0'; cv.removeAttribute('aria-busy'); } };
  const done = (d) => {
    idle();
    if (d && d.status === 'ok' && d.sessionToken) {
      if (_codeDoor === 'customer') finishCustomerAuth(_codeEmail, d);
      else finishAuth(_codeEmail, d);
      return;
    }
    // A rejected code CLEARS the boxes, and that is not cosmetic — it is the only way
    // to retype one. Six boxes full IS the submit (see wireCodeView), so leaving the
    // refused code in place means the first correction the person makes fills the row
    // again and fires a submit of a HYBRID — half the old code, half the new — which is
    // rejected again, and again for every further digit. Measured in a real browser on
    // 2026-10-08: typing the right code over a wrong one submitted "420000" and never
    // reached the last box.
    //
    // Nothing is lost by clearing: the digits that were refused are named in the error
    // line below and are in the person's inbox, and the caret goes back to the first box
    // so the retype is the same gesture as the first attempt.
    codeBoxes().forEach(b => { b.value = ''; });
    setCodeError((d && d.message) || 'Could not verify the code.');
    const first = codeBoxes()[0];
    if (first) first.focus();
  };
  const req = (_codeDoor === 'customer')
    ? customerAuth('login', { email: _codeEmail, password: '', code: code })
    : loginBackend(_codeEmail, _codePassword, code);
  req.then(done);
}

// ─── THEME ───────────────────────────────────────────────────────────────────
// Preference is 'light' | 'dark' | 'system' under localStorage 'theme'.
// 'system' is the default and honours the OS setting live; the Appearance menu
// switches to an explicit light/cream/dark. The <head> script applies the stored
// value before first paint so there is no flash, and it carries the same three
// names — a value known to one and not the other is a bug, which is why
// smoke-theme.mjs asserts the two lists agree.
const THEME_KEY = 'theme';

// The three modes, in the order the Appearance menu shows them. `system` is
// deliberately NOT in this list: it is a rule, not a mode, and resolvedTheme()
// below is what turns it into one.
const THEME_VALUES = ['light', 'cream', 'dark'];

// DEFAULT LIGHT, on the owner's instruction of 2026-10-08: "Default theme is light
// and color is yellow." That is the whole rule — a device that has never chosen
// gets light, and a device that HAS chosen gets what it chose, because the value is
// stored per device.
//
// It was 'dark' for part of one day, on the reading that the Indrones Industrial
// look is a dark instrument panel. That reading was mine and it was wrong about
// which half the owner was asking for: industrial.css is theme-aware by design — it
// names no brand yellow and no fixed ink step — so the look is the SAME look in
// light, and the choice of default is a preference rather than a consequence of the
// skin.
//
// 'system' has NOT gone away — it is still one of THEME_CHOICES and still means
// "ask the OS". It is simply not what an unanswered question resolves to.
function storedTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
}
function prefersDark() { return window.matchMedia('(prefers-color-scheme: dark)').matches; }

// Resolves the stored PREFERENCE to the mode actually painted. 'system' is the
// only value that consults the OS, and it resolves to light or dark only: cream
// is taste, not an operating-system condition, so it is never chosen for you.
// An unknown or stale stored value falls back to the OS for the same reason.
function resolvedTheme() {
  const p = storedTheme();
  if (THEME_VALUES.indexOf(p) >= 0) return p;
  return prefersDark() ? 'dark' : 'light';
}
// Kept as a boolean for its one non-CSS caller — the canvas painter, which cannot
// read a CSS variable and so has to choose its own hex values.
function isDarkTheme() { return resolvedTheme() === 'dark'; }

const THEME_CHOICES = [
  { value: 'light',  label: 'Light' },
  { value: 'cream',  label: 'Cream' },
  { value: 'dark',   label: 'Dark' },
  { value: 'system', label: 'System' },
];

function setTheme(value) {
  try { localStorage.setItem(THEME_KEY, value); } catch { /* non-fatal */ }
  applyTheme(true);
  syncAppearanceMenu();
}

// The browser-chrome colour, matched to theme.css. Appended last so it outranks
// the two media-keyed metas in <head>; that is what lets an explicit cream or
// dark choice reach the browser chrome on a device whose OS is set the other way.
const THEME_CHROME = { light: '#fdfdfd', cream: '#fdf9ef', dark: '#1a1713' };

function applyTheme(animate) {
  const t = resolvedTheme();
  const root = document.documentElement;
  if (animate) {
    // Suppress transitions for the two frames around the swap, otherwise every
    // surface cross-fades at once and the switch reads as a flash.
    root.classList.add('no-transition');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-transition')));
  }
  // Light is the ABSENCE of the attribute, because :root IS the light palette.
  // Cream and dark are stamped. That is also why the pre-paint script mirrors
  // this rather than setting a value in every case.
  if (t === 'light') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  paintThemeChrome(t);
}
function paintThemeChrome(t) {
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', THEME_CHROME[t] || THEME_CHROME.light);
}

// ─── PALETTE ─────────────────────────────────────────────────────────────────
// Which colour family the accent role resolves to. Same shape as the theme: a
// bare localStorage key, applied as `data-palette` on <html>, and read by the
// same pre-paint script so there is no flash.
//
// palette.css owns the colours — this table owns only the names and the order
// they appear in the menu. `swatch` is a RAW token (not var(--accent)), which is
// the point: the chip has to show its own palette's colour while a different
// palette is active, and raw tokens are theme-aware so the chip is right in both
// light and dark.
const PALETTE_KEY = 'palette';
// Yellow is the brand accent and the one the app ships wearing — see the `yellow`
// preset in palette.css and the INDRONES block in base.css. It is the fallback for
// the same reason it is the default: a device with no stored choice should get the
// app Indrones actually looks like, not a generic blue.
const FALLBACK_PALETTE = 'yellow';
const PALETTES = [
  { value: 'yellow',   label: 'Yellow',   swatch: 'var(--ind-yellow)' },
  { value: 'blue',     label: 'Blue',     swatch: 'var(--surface-blue-9)' },
  { value: 'violet',   label: 'Violet',   swatch: 'var(--surface-violet-9)' },
  { value: 'teal',     label: 'Teal',     swatch: 'var(--surface-teal-9)' },
  { value: 'graphite', label: 'Graphite', swatch: 'var(--surface-gray-10)' },
];

// __CONFIG__/theme, written by an admin: { palettes: [...], default: 'blue' }.
// null means "not read yet", which is NOT the same as "empty" — until it lands,
// every preset is offered. A user who opens the menu before the read completes
// sees the full list rather than an empty one.
let paletteConfig = null;

function storedPalette() {
  try { return localStorage.getItem(PALETTE_KEY) || FALLBACK_PALETTE; } catch { return FALLBACK_PALETTE; }
}

// The presets an admin currently allows, in the menu's own order. Falls back to
// every preset rather than to none: a site-wide config that is missing, empty or
// entirely stale must not leave the user with nothing to pick.
function paletteChoices() {
  const allow = paletteConfig && Array.isArray(paletteConfig.palettes) ? paletteConfig.palettes : null;
  if (!allow || !allow.length) return PALETTES;
  const known = PALETTES.filter(p => allow.indexOf(p.value) >= 0);
  return known.length ? known : PALETTES;
}

// The stored choice, if it is still allowed; otherwise the admin's default, if
// that is allowed; otherwise the first allowed preset. Resolving — rather than
// just trusting localStorage — is what lets an admin retire a palette without
// stranding anyone who had already picked it.
function resolvePalette() {
  const choices = paletteChoices();
  const has = v => choices.some(p => p.value === v);
  const stored = storedPalette();
  if (has(stored)) return stored;
  const def = paletteConfig && paletteConfig.default;
  if (has(def)) return def;
  return choices[0].value;
}

function applyPalette() {
  document.documentElement.setAttribute('data-palette', resolvePalette());
}

function setPalette(value) {
  try { localStorage.setItem(PALETTE_KEY, value); } catch { /* non-fatal */ }
  applyPalette();
  syncAppearanceMenu();
}

// Read the site-wide allowlist. Read-only and best-effort: on a dead backend the
// stored preference stands, which is the same degradation every other sentinel
// read has. Called once per session, after sign-in.
//
// The theme record lives in the same store the boot read already fetched, so when
// that read has landed this is served from memory. It is asked for separately only
// when the boot read failed, or when sign-in beat it — a second request, but only on
// a path that was already going to make one.
function loadPaletteConfig() {
  const cached = sharedConfigRecord('theme');
  const config = cached !== undefined ? Promise.resolve(cached) : loadSentinel('__CONFIG__', 'theme');
  return config.then(cfg => {
    if (!cfg || typeof cfg !== 'object') return;
    paletteConfig = {
      palettes: Array.isArray(cfg.palettes) ? cfg.palettes : null,
      default: typeof cfg.default === 'string' ? cfg.default : null,
    };
    // A retired choice has to take effect now, not on the next reload. The menu
    // caches its DOM, so drop it — toggleUserMenu() rebuilds it from the new
    // allowlist on the next open.
    applyPalette();
    const menu = document.getElementById('user-menu');
    if (menu) menu.remove();
  });
}

// ─── APPEARANCE MENU ─────────────────────────────────────────────────────────
// The light/cream/dark and palette controls live in the user menu (top right). They
// used to be a single nav button at the bottom of the sidebar, which meant scrolling
// a whole column to reach a control that belongs to the account, not to the IR list.
//
// Rendered as two labelled groups of rows, never icon-only: a swatch plus a word
// for each palette, and a word for each theme. Selection is carried by
// aria-checked and a tick, so it is legible without relying on colour alone.
function syncAppearanceMenu() {
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  // A stored value that is neither one of the modes nor 'system' is stale. Showing
  // it as "System" is the honest reading, because falling back to the OS is exactly
  // what resolvedTheme() does with it — otherwise no row would be ticked at all.
  const raw = storedTheme();
  const theme = (THEME_VALUES.indexOf(raw) >= 0 || raw === 'system') ? raw : 'system';
  menu.querySelectorAll('.appearance-row').forEach(row => {
    const [group, value] = row.dataset.opt.split(':');
    const on = group === 'theme' ? value === theme : value === resolvePalette();
    row.setAttribute('aria-checked', on ? 'true' : 'false');
    row.classList.toggle('is-on', on);
  });
}

function buildAppearanceGroup() {
  const themeRows = THEME_CHOICES.map(c => `
    <button type="button" class="appearance-row" role="radio" data-opt="theme:${c.value}" aria-checked="false">
      <span class="appearance-check" aria-hidden="true"></span>
      <span class="appearance-label">${c.label}</span>
    </button>`).join('');

  const paletteRows = paletteChoices().map(p => `
    <button type="button" class="appearance-row" role="radio" data-opt="palette:${p.value}" aria-checked="false">
      <span class="appearance-swatch" style="background:${p.swatch}" aria-hidden="true"></span>
      <span class="appearance-label">${p.label}</span>
      <span class="appearance-check" aria-hidden="true"></span>
    </button>`).join('');

  return `
    <div class="appearance-group">
      <div class="appearance-head" role="radiogroup" aria-label="Theme">Theme</div>
      ${themeRows}
      <div class="appearance-head" role="radiogroup" aria-label="Accent colour">Accent colour</div>
      ${paletteRows}
    </div>`;
}

// Follow the OS while the preference is still 'system'.
(function watchSystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (storedTheme() === 'system') applyTheme(true); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
})();

// ─── REMEMBERED LAYOUT PREFERENCES ───────────────────────────────────────────
// Small on/off preferences that, like the theme, belong to the device rather than
// to one IR. Bare keys, matching THEME_KEY, and every access is wrapped, because a
// browser with storage blocked must still render a usable page.
const RAIL_KEY     = 'rail';       // sidebar folded to an icon rail
const LIST_KEY     = 'list';       // IR list folded away
const ACTIVITY_KEY = 'activity';   // activity log expanded

function storedFlag(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function setFlag(key, on) {
  try { on ? localStorage.setItem(key, '1') : localStorage.removeItem(key); } catch { /* non-fatal */ }
}

// ─── WIDTHS THE USER DRAGS ───────────────────────────────────────────────────
// The two columns on a desktop are the only fixed widths in the app a person has
// a real opinion about, so each gets a handle on its right edge. A drag does NOT
// write a width anywhere of its own: it sets `--sidebar-w` / `--list-w` as an
// inline custom property on <html>, which is the one thing that outranks the
// stylesheet — including the ≥1440px `--list-w` bump — so every existing rule
// that reads the token follows without being told, and clearing the property is
// the whole of the reset.
//
// Both numbers are clamped on READ as well as on drag, because the window can be
// narrower than it was when the width was saved, and a 680px list on a 1024px
// screen would starve the pane beside it.
const SIDEBAR_W_KEY = 'sidebar-w';
const LIST_W_KEY    = 'list-w';
const WIDTH_LIMITS  = { 'sidebar-w': [184, 360], 'list-w': [280, 680] };

// A column may never take more than half the window, whatever was saved. This is
// the guard that keeps a widened list from squeezing the open ticket to nothing.
function clampWidth(px, key) {
  const [min, max] = WIDTH_LIMITS[key] || [0, Infinity];
  const half = Math.round((window.innerWidth || 1024) / 2);
  return Math.max(min, Math.min(max, half, Math.round(px)));
}
function storedWidth(key) {
  let n = 0;
  try { n = parseInt(localStorage.getItem(key), 10); } catch { return 0; }
  return Number.isFinite(n) && n > 0 ? clampWidth(n, key) : 0;
}
function applyStoredWidths() {
  [[SIDEBAR_W_KEY, '--sidebar-w'], [LIST_W_KEY, '--list-w']].forEach(([key, cssVar]) => {
    const px = storedWidth(key);
    if (px) document.documentElement.style.setProperty(cssVar, px + 'px');
  });
}

// One wiring for both handles. Pointer events (not mouse events) so the drag works
// on a touchscreen laptop and on a stylus, and `setPointerCapture` so the drag
// keeps tracking after the pointer leaves the 7px strip — without it the column
// stops following the moment the pointer crosses onto the pane.
function wirePaneResize(handle, cssVar, key, pane) {
  if (!handle || !pane) return;
  let startX = 0, startW = 0, last = 0, dragging = false;

  const onPointerDown = e => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startW = last = clampWidth(pane.getBoundingClientRect().width, key);
    document.documentElement.classList.add('pane-resizing');
    // Capture is what keeps the drag alive once the pointer leaves the 7px strip,
    // and it is the one call here that can legitimately throw — a pointer that is
    // no longer active (a synthetic event, or a drag whose pointerdown was
    // cancelled) makes setPointerCapture raise InvalidStateError. A drag that
    // cannot capture is still a drag, so the class and the drag continue either way.
    if (handle.setPointerCapture) { try { handle.setPointerCapture(e.pointerId); } catch { /* not capturable */ } }
    e.preventDefault();
  };
  const onPointerMove = e => {
    if (!dragging) return;
    last = clampWidth(startW + (e.clientX - startX), key);
    document.documentElement.style.setProperty(cssVar, last + 'px');
  };
  const onPointerUp = e => {
    if (!dragging) return;
    dragging = false;
    document.documentElement.classList.remove('pane-resizing');
    if (handle.releasePointerCapture) { try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ } }
    try { localStorage.setItem(key, String(last)); } catch { /* non-fatal */ }
  };
  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerUp);
  // The way back to the built-in width, and the only undo the handle advertises.
  handle.addEventListener('dblclick', () => {
    document.documentElement.style.removeProperty(cssVar);
    try { localStorage.removeItem(key); } catch { /* non-fatal */ }
  });
}

// ─── COLLAPSIBLE CHROME ──────────────────────────────────────────────────────
// The sidebar fold is a class on <html> and the elements it targets are static, so
// there is nothing per-IR to re-apply — it is set once from showApp(). A reload
// cannot flash the expanded rail either, because #app-container is display:none
// until showApp() runs, long after this lands.
function applyChromeState() {
  const root = document.documentElement;
  const rail = storedFlag(RAIL_KEY);
  const list = storedFlag(LIST_KEY);
  root.classList.toggle('rail-collapsed', rail);
  if (railToggle) {
    railToggle.setAttribute('aria-expanded', String(!rail));
    railToggle.title = rail ? 'Show the sidebar' : 'Hide the sidebar';
  }
  if (listToggle) {
    listToggle.setAttribute('aria-expanded', String(!list));
    listToggle.title = list ? 'Show the IR list' : 'Hide the IR list';
  }
  renderLayout();   // the list fold IS a pane — renderLayout owns its display
}
function toggleRail() { setFlag(RAIL_KEY, !storedFlag(RAIL_KEY)); applyChromeState(); }
function toggleList() { setFlag(LIST_KEY, !storedFlag(LIST_KEY)); applyChromeState(); }

// ─── LAYOUT ──────────────────────────────────────────────────────────────────
// One function owns the panes' visibility. It must keep writing *inline*
// styles: applySectionAccessGating selects `.tab:not([style*="display: none"])`.
//
//   desktop (≥1024px) : list visible, detail/insights beside it when open
//   mobile            : the open pane is a full screen of its own
//
// The list fold is decided HERE rather than by a stylesheet rule, because an
// inline `display` beats any rule and this function is the one place allowed to
// write it. Folding the list must never strand the user on an empty index screen:
// on desktop the fold narrows the pane to a rail that still carries the count, and
// on a phone the fold only ever happens while a pane that OWNS the screen is open,
// so there is always something to go back to — see `full` and `listHidden` below.
//
// `detailView.style.display` is only ever WRITTEN here, never read back. The
// sibling-pane arrangement is still required, for a different reason: tools/
// smoke-ui.mjs and tools/smoke-boot.mjs pin #ir-activity inside #detail-view, so
// that pane's display is a truthful "an IR is open" flag and nothing else may
// live in it.
//
// It also marks which nav item is current, at the end. That is the same question
// ("what is on screen?") and every view function already routes through here, so
// it needs no second call site — which is what stopped the highlight drifting the
// moment a new entry point was added.
function renderLayout() {
  const desktop  = mqDesktop.matches;
  const detail   = currentView === 'detail';
  const insights = currentView === 'insights';
  const log      = currentView === 'log';
  const faq      = currentView === 'faq';
  // A pane that OWNS the screen on a phone. Below lg, #panes is a COLUMN, so the
  // list and the open pane are separate full screens and the open one hides the
  // list. On desktop they sit side by side, so the list hides only when the user
  // asked for the room.
  //
  // `insights` belongs in here, and leaving it out was a real bug: on a phone both
  // panes are flex:1 with a zero basis, so the IR list took the TOP HALF of the
  // screen — toolbar, search, both segment strips and #sync-status — with the
  // dashboard squeezed into the strip underneath it. "Keep the list beside the
  // dashboard" is true on a laptop and impossible in a column. `log` is the same
  // pane shape and is included from the start rather than inheriting the bug.
  //
  // Folding it is only safe because the SAME change gives Insights the back
  // button below: that is what stops the fold stranding anyone, which is the
  // worry the old comment here was trying to answer.
  const full       = detail || insights || log || faq;
  // The fold, and the two different things it means.
  //
  // DESKTOP: the list is a COLUMN beside the other panes, so folding it NARROWS
  // it to the rail rather than removing it. The count stays on screen, the width
  // goes to the board or the open ticket, and the index screen is never emptied —
  // which is the rule this fold has always been judged by. It is a class on <html>
  // (html.list-collapsed) and not an inline display, because a pane's inline
  // display has exactly ONE writer and that writer is this function.
  //
  // PHONE: the list IS a full screen, so an open pane has to replace it rather
  // than sit beside it. This is the only place the fold removes anything, and the
  // back button below is what stops it stranding anyone.
  const listHidden = full && !desktop;
  // The board owns the whole row, so there is nothing left to fold into a rail —
  // and folding it there WOULD strand the user, because the rail would replace the
  // board and the detail pane behind it has no ticket in it. So on the board the
  // fold is suppressed (and its control is hidden); the preference is untouched
  // and comes straight back when List is chosen again.
  const boardFull  = desktop && listMode === 'board';
  document.documentElement.classList.toggle('list-collapsed', desktop && !boardFull && storedFlag(LIST_KEY));
  indexView.style.display  = listHidden ? 'none' : 'flex';
  detailView.style.display = detail ? 'flex' : 'none';
  // The Insights dashboard is a SIBLING pane, not a panel inside the detail one:
  // that pane's display is the app's only "an IR is open" flag and nothing else
  // may live in it.
  if (insightsView) insightsView.style.display = insights ? 'flex' : 'none';
  if (logView) logView.style.display = log ? 'flex' : 'none';
  // The Help & FAQ is the same pane shape a third time, and it is folded rather
  // than opened in a tab from 2026-10-08 — see the markup comment in index.html.
  if (faqView) faqView.style.display = faq ? 'flex' : 'none';
  // The detail's back button goes to the list; the dashboard's does the same.
  // Both are phone-only — on desktop the list never leaves the screen.
  backBtn.style.display    = (!desktop && full) ? 'block' : 'none';
  document.body.classList.toggle('view-detail', detail);
  // Suppresses #detail-placeholder's "No IR selected" empty state, which shows
  // whenever body.view-detail is absent — including on the dashboard and the
  // analyser, where an "no IR selected" message is simply wrong.
  document.body.classList.toggle('view-insights', insights);
  document.body.classList.toggle('view-log', log);
  document.body.classList.toggle('view-faq', faq);

  // On desktop the list stays on screen, so mark which row is open.
  if (irList) {
    irList.querySelectorAll('.ir-card').forEach(card => {
      card.classList.toggle('is-selected', detail && card.dataset.id === currentIR?.irNumber);
    });
  }

  // Which section the user is in. A ticket belongs to the IRs item — it is a row
  // of that list, not a section of its own.
  markActiveNav(insights ? 'insights' : (log ? 'log' : (faq ? 'faq' : 'tickets')));
}

// The nav never showed which section you were in: `.nav-item.active` has a rule
// in base.css and NOTHING ever applied it, so tapping Insights produced no
// feedback anywhere on screen and read as a dead tap — which is half of "even
// after clicking on insight tile it is not opening". Four items now, the FAQ
// having become a routed pane on 2026-10-08; the other nav entry is not a section,
// because User Access opens a pane of its own rather than one of the six.
//
// `aria-current` rides along with the class: the highlight is colour, and colour
// alone is not an announcement.
function markActiveNav(name) {
  [['nav-tickets', 'tickets'], ['nav-insights', 'insights'], ['nav-log', 'log'], ['nav-faq', 'faq']].forEach(([id, route]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const on = route === name;
    el.classList.toggle('active', on);
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

(function watchDesktop() {
  const onChange = () => renderLayout();
  if (mqDesktop.addEventListener) mqDesktop.addEventListener('change', onChange);
  else if (mqDesktop.addListener) mqDesktop.addListener(onChange);
})();

// ─── ROUTER ──────────────────────────────────────────────────────────────────
// Hash routes, because GitHub Pages is static with no server rewrite:
//   #/tickets            → the list (desktop keeps whatever IR was open)
//   #/tickets/IR409      → that IR's passbook
//   #/insights           → the counts dashboard
//   #/log                → the flight-log analyser
//   #/faq                → Help & FAQ, rendered from faq-content.js
// showIndex()/openPassbook()/showInsights() stay the view functions; the router
// only decides when to call them, so nothing here re-implements rendering.
function currentRoute() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'tickets' && parts[1]) return { name: 'ticket', irNumber: decodeURIComponent(parts[1]) };
  if (parts[0] === 'insights') return { name: 'insights' };
  if (parts[0] === 'log') return { name: 'log' };
  if (parts[0] === 'faq') return { name: 'faq' };
  // The fallthrough. An unknown hash (a stale bookmark, a typo) lands on the list
  // rather than on a blank pane, which is why `insights` had to be matched above.
  return { name: 'tickets' };
}

function goIndex() {
  if (location.hash === '#/tickets' || !location.hash) { showIndex(); return; }
  location.hash = '#/tickets';
}

function goTicket(irNumber) {
  const hash = '#/tickets/' + encodeURIComponent(irNumber);
  if (location.hash === hash) { handleRoute(); return; }
  location.hash = hash;
}

function goInsights() {
  if (location.hash === '#/insights') { showInsights(); return; }
  location.hash = '#/insights';
}

function goLog() {
  if (location.hash === '#/log') { showLog(); return; }
  location.hash = '#/log';
}

function goFaq() {
  if (location.hash === '#/faq') { showFaq(); return; }
  location.hash = '#/faq';
}

async function handleRoute() {
  if (!currentUser) return;
  const r = currentRoute();

  if (r.name === 'ticket') {
    // Already showing this IR — don't rebuild every section form.
    if (currentView === 'detail' && currentIR?.irNumber === r.irNumber) return;
    // A deep link resolves before the IR list has loaded; wait so the banner
    // gets the drone serial and customer name.
    if (!allIRs.length && _irsReady) { try { await _irsReady; } catch { /* open anyway */ } }
    if (!currentUser) return;                   // signed out while waiting
    if (currentRoute().irNumber !== r.irNumber) return;   // superseded meanwhile
    openPassbook(r.irNumber);
    return;
  }

  if (r.name === 'insights') {
    if (currentView === 'insights') return;
    // The dashboard is counts over allIRs, so a cold #/insights deep link has
    // nothing to count until the fetch lands. Waiting here is what stops it
    // painting an empty dashboard for the length of an 8s abort.
    if (!allIRs.length && _irsReady) { try { await _irsReady; } catch { /* paint anyway */ } }
    if (!currentUser) return;                   // signed out while waiting
    // Re-read the route AFTER the await: the user may have navigated away while
    // the list was loading, and painting now would land on top of where they went.
    if (currentRoute().name !== 'insights') return;
    showInsights();
    return;
  }

  if (r.name === 'log') {
    if (currentView === 'log') return;
    // The analyser's IR picker lists allIRs, so the same cold-deep-link wait the
    // dashboard does applies here.
    if (!allIRs.length && _irsReady) { try { await _irsReady; } catch { /* paint anyway */ } }
    if (!currentUser) return;                   // signed out while waiting
    // Re-read the route AFTER the await, exactly as the insights branch above does.
    if (currentRoute().name !== 'log') return;
    showLog();
    return;
  }

  if (r.name === 'faq') {
    if (currentView === 'faq') return;
    // No wait for allIRs here, and that is the difference between this branch and
    // the two above it: the FAQ is static text and counts nothing, so it renders
    // straight away. Blocking it on a list fetch would make the one screen that has
    // to work when something is wrong downstream wait on the thing that is wrong.
    if (!currentUser) return;                   // signed out
    if (currentRoute().name !== 'faq') return;  // navigated away
    showFaq();
    return;
  }

  if (currentView === 'index') return;
  showIndex();
}

window.addEventListener('hashchange', () => { handleRoute(); });

// ─── APP BOOT ────────────────────────────────────────────────────────────────
// Everything the signed-in app loads, and the poll it starts. Split out of
// showApp() so the in-page re-login path can run it a second time: that path
// stops the nudge poll during teardown, and a signed-in user who never gets it
// back has a silently dead comment bell for the life of the page.
function startAppData() {
  // Fetch IRs. The promise is kept so a deep link (#/tickets/IR409) can wait
  // for the list before it opens the passbook.
  _irsReady = fetchIRs();
  // NOTE: the token-gated legacy archive (pre-app IRs ≤ IR441) is intentionally
  // NOT loaded — it relied on a silent Google One-Tap per call, which caused
  // repeated sign-in pop-ups. Previous IRs are left in the old I-PASSBOOK sheet.
  // Load admin-customizable inward dropdown options (best-effort)
  loadInwardOptions();
  // Load admin-customizable IQC inspection points + result options
  loadIqcConfig();
  // Load team directory (@-mention suggestions) + nudges, and start nudge polling
  loadTeamDirectory();
  // All three of those read their LOCAL copy above; this is the single network read
  // that refreshes them. One request, not three — see loadSharedConfig.
  loadSharedConfig();
  // Load app-owned workflow state (status / assignee / priority / category per IR).
  // Runs alongside the first fetchIRs(); setAllIRs merges whatever has arrived,
  // and loadIRState re-merges + re-renders when it lands, so either order is
  // correct.
  loadIRState();
  loadNudges();
  startNudgePolling();
}

function showApp() {
  // Before the temp-password guard below, not after: that guard DIVERTS to the
  // password-change screen, and a diverted sign-in still has to lose the wait
  // screen. Any route to a real screen clears it.
  endSsoWait();
  // The landing head is about to be hidden, so its loop is stopped where it stands
  // rather than left running against a screen nobody is looking at — a timer chain
  // that keeps mutating hidden DOM for the length of a session is a cost with no
  // payer. stopBrandTyping() also puts the words back to "finished", which is what a
  // later sign-out has to find.
  stopBrandTyping();
  // …and the code step goes with it. Every route into the shell — the emailed code, the
  // password door, a Google handoff — passes through here, so hiding it here is what
  // makes "signed in" and "still looking at a code box" impossible at the same time.
  closeCodeView(false);
  // Guard: an account still holding a temporary password must never reach the
  // shell. This is belt-and-braces — the backend mints no session in that state,
  // so finishAuth() cannot be reached with mustChangePassword set — but a guard
  // here means any future caller that gets it wrong diverts instead of showing a
  // half-usable app whose every save would be rejected.
  if (currentUser && currentUser.access && currentUser.access.mustChangePassword) {
    showPasswordChange(currentUser.email, true);
    return;
  }
  authCont.style.display = 'none';
  appCont.style.display  = 'flex';
  const pc = document.getElementById('password-change');
  if (pc) pc.style.display = 'none';

  // Idempotent: this function binds click listeners to the avatar, the bell and
  // the nav. A second call (re-login, router re-entry) would double-fire every
  // one of them, so bind once and only refresh the layout + the data.
  //
  // The data reload is not optional. A second call means an IN-PAGE re-login: the
  // interceptor's confirmed-expiry path calls showAuth() and the user signs in
  // again without the page ever reloading, so `_appBooted` is still true. The
  // teardown that got them there (clearLocalAuth) STOPS the nudge poll — so
  // returning here without restarting it left a freshly signed-in user with no
  // comment polling, no IR refresh and no app state, silently and permanently.
  if (_appBooted) { renderLayout(); syncNavAccess(); startAppData(); return; }
  _appBooted = true;

  // Enter the FIRST screen synchronously, before startAppData() assigns _irsReady
  // and before handleRoute() runs. Calling showIndex() unconditionally here would
  // paint the IR list on a cold #/insights and hold it there for the whole of the
  // first fetch — up to the 8s abort — because handleRoute() cannot do better than
  // "wait for the list" when it has nothing to count yet.
  //
  // A deep link to an IR deliberately keeps the old behaviour: a passbook cannot be
  // painted before its record arrives, so showIndex() paints the placeholder the
  // detail pane will replace. handleRoute() still owns the async path and no-ops
  // when we are already on the right screen.
  if (currentRoute().name === 'insights') showInsights(); else showIndex();
  applyTheme();          // sync <html> with the stored light/dark preference
  applyPalette();        // ...and with the stored accent, before anything paints
  initIcons();           // the inline-SVG family — every static glyph comes from ICON_PATHS
  applyChromeState();    // ...and the sidebar / IR-list folds
  applyActivityState(storedFlag(ACTIVITY_KEY));
  syncNavAccess();
  // The site-wide palette allowlist, once per session. Deliberately not awaited:
  // the stored preference is already applied, and this only narrows it.
  loadPaletteConfig();

  // Set up user avatar. Keyed on the ADDRESS rather than on the name, so the mark is
  // the person and not the spelling of their name — see the AVATARS block. The name is
  // only the fallback for the (impossible today, cheap to be wrong about) case of a
  // session with no address on it. The picture branch comes first and wins: an account
  // that really has a photograph is better served by it than by any mark we could draw.
  userAvatar.style.backgroundImage = '';
  userAvatar.innerHTML = avatarSvg(currentUser?.email || currentUser?.name || '');
  if (currentUser?.picture) {
    userAvatar.textContent = '';
    userAvatar.style.backgroundImage = `url(${currentUser.picture})`;
    userAvatar.style.backgroundSize  = 'cover';
  }

  // User menu toggle
  userAvatar.addEventListener('click', toggleUserMenu);
  if (navAccess) navAccess.addEventListener('click', openAccessModal);
  if (railToggle) railToggle.addEventListener('click', toggleRail);
  if (listToggle) listToggle.addEventListener('click', toggleList);
  // The rail's own way back. Wired to the same toggle rather than to setFlag, so
  // the two controls cannot disagree about whether the list is folded.
  if (listRailRestore) listRailRestore.addEventListener('click', toggleList);
  // The stored widths go on before the resize handles are wired: the handles read
  // the column's own measured width when a drag starts, so they must be looking at
  // the width the device actually remembered, not the stylesheet default.
  applyStoredWidths();
  wirePaneResize(sidebarResize, '--sidebar-w', SIDEBAR_W_KEY, sidebarEl);
  wirePaneResize(listResize, '--list-w', LIST_W_KEY, indexView);

  startAppData();

  // Bell toggle
  const bell = document.getElementById('nudge-bell');
  if (bell) bell.addEventListener('click', toggleNudgePanel);

  // Enter the route. A hash already in the URL (deep link / restored tab) wins;
  // otherwise start on the IR list without adding a history entry.
  if (!location.hash) history.replaceState(null, '', '#/tickets');
  handleRoute();
}

// Shows the Administration nav group only to admins.
function syncNavAccess() {
  const admin = isAdmin();
  if (navAdminLabel) navAdminLabel.style.display = admin ? '' : 'none';
  if (navAccess)     navAccess.style.display     = admin ? '' : 'none';
}

// ─── ACCESS GATING (retired) ─────────────────────────────────────────────────
// There is no boot-level gate any more. Every signed-in account gets view +
// comment on all nine sections the moment it exists, so the old
// "you don't have access — request it and wait for an admin" screen had nothing
// left to enforce and is gone, along with requestAccessAction().
//
// What remains is per-section EDIT gating inside an open passbook, which is
// applySectionAccessGating() below. Edit rights come from departments only, and
// the backend enforces them independently of anything rendered here.

// ─── ADMIN: User Access modal ────────────────────────────────────────────────
// Three tabs, one backend call. `listUsers` returns every account AND every
// department in a single response, so switching tabs never re-fetches and the
// People matrix can draw people × departments from one consistent snapshot.
const SECTION_LABELS = { 'sec-b':'B','sec-c':'C','sec-d':'D','sec-e':'E','sec-f':'F','sec-g':'G' };
// Human names for the tick grids. Kept as a literal rather than derived from
// SECTIONS (defined much further down, and lazily) so the admin UI never depends
// on the section-form builder having been evaluated.
const SECTION_SHORT = {
  'sec-b': 'Inward Checklist',
  'sec-c': 'IQC Visual Inspection',
  'sec-d': 'Investigation',
  'sec-e': 'Production (Rework)',
  'sec-f': 'Quality Test Report',
  'sec-g': 'PDI Report/Dispatch Record',
};
// Triage is kept as its OWN label pair rather than a seventh `sec-*` key, so no
// future `Object.keys(SECTION_SHORT)`/`SECTION_LABELS` walk can mistake it for a
// section. It shares the grant grid's rendering, not its identity.
const TRIAGE_LABEL = 'TR';
const TRIAGE_SHORT = 'Allot CAPS (header, status & Overview)';

let accessCache = { users: [], departments: [], apiVersion: 0 };
let accessTab = 'people';

// Every admin action is a POST carrying the session token, so it goes through the
// intercepted fetch (which appends the token) — never _origFetch.
function adminPost(action, fields) {
  const fd = new FormData();
  fd.append('action', action);
  Object.keys(fields || {}).forEach(k => fd.append(k, fields[k]));
  return fetch(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.json())
    .catch(() => ({ status: 'error', message: 'Could not reach the backend.' }));
}

function copyText(text) {
  const ok = () => showToast('Copied to clipboard');
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      ok();
    } catch { showToast('Copy failed — select the text and copy manually'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok).catch(fallback);
  } else fallback();
}

// The owner's handover document. One block per person, to be pasted into a txt
// and delivered individually. It contains the ONE moment the temporary password
// is visible — the backend stores only its hash, so if this is lost the admin
// issues a new one with Reset password.
function credentialsTxt(email, tempPassword, name) {
  const link = location.origin + location.pathname;
  return [
    'I-PASSBOOK — your sign-in details',
    '=================================',
    '',
    (name ? 'Name:  ' + name : ''),
    'Email: ' + email,
    'Temporary password: ' + tempPassword,
    '',
    'How to get in (first time only)',
    '-------------------------------',
    '1. Open: ' + link,
    '2. Sign in with the email and temporary password above.',
    '3. You will be asked to set your OWN password. Do that — the temporary',
    '   one stops working immediately afterwards.',
    '',
    'On a phone: open the link, then use your browser menu →',
    '"Add to Home screen" so it opens like an app.',
    '',
    'What you can do',
    '---------------',
    '• You can VIEW every IR and COMMENT on any section right away.',
    '• You can EDIT the sections your department owns. If you need edit',
    '  access somewhere else, ask the admin — it is a department setting.',
    '',
    'Forgot your password?',
    '---------------------',
    'On the sign-in screen click "Forgot password?", enter this email, and a',
    '6-digit code will arrive by email. Enter the code and choose a new one.',
    '',
    'Keep this safe and do not forward it.',
  ].filter(l => l !== '').join('\n');
}

function openAccessModal() {
  if (!isAdmin()) { showToast('Admins only'); return; }
  // A confirmation of an invitation sent ten minutes ago is stale news by the time the
  // page is reopened, and it would greet the admin ahead of whatever they came back for.
  custNotice = null;
  let modal = document.getElementById('access-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'access-modal';
  modal.innerHTML = `
    <div class="access-card">
      <div class="inward-options-head">
        <div class="inward-options-title">👥 User Access</div>
        <button type="button" class="inward-options-close" onclick="closeAccessModal()" title="Close">&times;</button>
      </div>
      <div class="access-status" id="access-status"></div>
      <div class="access-tabs">
        <button type="button" class="access-tab" data-tab="people">People &amp; departments</button>
        <button type="button" class="access-tab" data-tab="depts">Departments</button>
        <button type="button" class="access-tab" data-tab="create">Create people</button>
        <button type="button" class="access-tab" data-tab="customers">Customers</button>
        <button type="button" class="access-tab" data-tab="versions">Versions</button>
      </div>
      <div class="access-body" id="access-panels"><div class="access-loading">Loading…</div></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeAccessModal(); });
  modal.querySelectorAll('.access-tab').forEach(btn => {
    // renderAccessPanel() IS the tab switch. Without it the four tabs highlight and
    // the body never changes — the panel was only ever painted by the FIRST load and
    // by a refresh finishing, so every tab but the one you landed on looked broken.
    // Nothing in the suites could see it: a missing call is not a wrong value, and
    // no assertion had ever asked what a tap does.
    btn.addEventListener('click', () => {
      accessTab = btn.dataset.tab;
      renderAccessTabs();
      renderAccessPanel();
      // The backup line is a separate, admin-only request, so it is asked for the
      // first time the tab that shows it is actually opened — never on every open
      // of this modal for the three tabs that do not display it.
      if (accessTab === 'versions') loadBackupHealth();
    });
  });
  renderAccessTabs();
  // Paint the roster from this device's last copy FIRST — on the same frame as the
  // modal — then refresh behind it. The admin sees the page they came for instead of
  // "Loading…", and the round trip stops being something they wait on. See
  // readAccessCache() for why this is localStorage and not a server-side cache.
  const cached = readAccessCache();
  if (cached) {
    accessCache = {
      users: cached.users,
      departments: cached.departments || [],
      apiVersion: cached.apiVersion || 0,
    };
    renderAccessPanel();
    markAccessRefreshing();
  }
  // Reopening the modal on the Versions tab must re-ask, or the line would sit on
  // "Checking…" forever: the cached paint above renders it before any answer exists.
  if (accessTab === 'versions') loadBackupHealth();
  loadAccessData();
}
function closeAccessModal() { document.getElementById('access-modal')?.remove(); }

// ─── THE ACCESS PAGE'S LOCAL COPY ────────────────────────────────────────────
// `listUsers` is one round trip carrying every account, every department and the
// permission matrix, and reopening this page paid for all of it again — while seven
// boot calls were still in flight. The roster is exactly the shape
// stale-while-revalidate was invented for: paint what we had, then replace it.
//
// localStorage rather than a server-side CacheService, deliberately: `listUsers` is
// written by nine different actions, and ONE missed invalidation would show an admin
// the roster they had just changed as unchanged — worse than a slow page. A local
// copy needs no invalidation at all, because the refresh always overwrites it.
//
// It lives on the device, so it is also what makes the page survive a dead backend:
// the admin sees the roster they knew about and the error says what failed.
const ACCESS_CACHE_KEY = 'ipb_access_cache';

function readAccessCache() {
  try {
    const raw = localStorage.getItem(ACCESS_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    // Only a shape we can actually render counts as a cache hit.
    if (!c || !Array.isArray(c.users) || !c.users.length) return null;
    return c;
  } catch { return null; }
}

function writeAccessCache() {
  try {
    localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({
      users: accessCache.users || [],
      departments: accessCache.departments || [],
      apiVersion: accessCache.apiVersion || 0,
    }));
  } catch { /* non-fatal: the cache is a convenience, never a requirement */ }
}

// Say that what is on screen is a remembered copy, so an admin who has just changed
// something elsewhere is not misled by it. Cleared the moment the refresh lands.
function markAccessRefreshing() {
  const el = document.getElementById('access-status');
  if (!el) return;
  updateAccessStatus();
  el.innerHTML += ' · <span class="access-stale">showing the last saved copy — refreshing…</span>';
}

function renderAccessTabs() {
  const modal = document.getElementById('access-modal');
  if (!modal) return;
  modal.querySelectorAll('.access-tab').forEach(b => {
    b.classList.toggle('is-active', b.dataset.tab === accessTab);
  });
}

function updateAccessStatus() {
  const el = document.getElementById('access-status');
  if (!el) return;
  const hasSession = !!(currentUser && currentUser.sessionToken);
  const cred = hasSession ? 'session ✓' : 'no active session';
  const v = accessCache.apiVersion ? ' · API v' + accessCache.apiVersion : '';
  el.innerHTML = `Signed in as <strong>${escHtml(currentUser?.email || '—')}</strong> · ${cred}${v}`;
}

// The reconnect panel. Rendered INSIDE the modal, because a full sign-out here
// would throw away whatever the admin was mid-way through — and that ejector is
// what made this page feel like it was nagging for a sign-in. The button retries
// the load instead of signing out.
function accessReconnectHtml(reason) {
  const why = reason
    ? escHtml(String(reason))
    : 'Your sign-in session isn’t active, so the backend rejected this request.';
  return `<div class="access-error">
    <div>${why}</div>
    <button type="button" class="btn" id="access-reconnect-btn" style="margin-top:0.6rem;">Retry</button>
    <div class="access-hint" style="margin-top:0.5rem;">Nothing you have typed here has been lost. Retry to reload — sign out only if the retry keeps failing.</div>
  </div>`;
}
function renderAccessReconnect(reason) {
  const panels = document.getElementById('access-panels');
  if (!panels) return;
  panels.innerHTML = accessReconnectHtml(reason);
  const rb = document.getElementById('access-reconnect-btn');
  if (rb) rb.addEventListener('click', () => { panels.innerHTML = '<div class="access-loading">Loading…</div>'; loadAccessData(); });
}

function loadAccessData() {
  fetch(CONFIG.GAS_URL + (CONFIG.GAS_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=listUsers')
    .then(r => r.json())
    .then(data => {
      if (data && data.status === 'ok') {
        accessCache = { users: data.users || [], departments: data.departments || [], apiVersion: data.apiVersion || 0 };
        // The refresh overwrites the local copy — which is the whole reason this
        // cache needs no invalidation logic anywhere else in the app.
        writeAccessCache();
        updateAccessStatus();
        renderAccessPanel();
        return;
      }
      const unauthorized = data && String(data.message || '').toLowerCase().indexOf('unauthorized') === 0;
      // Surface the REAL backend rejection reason instead of a generic message.
      const reason = (currentUser && currentUser.sessionError) || (data && data.message) || '';
      if (unauthorized) { renderAccessReconnect(reason); return; }
      const panels = document.getElementById('access-panels');
      if (panels) panels.innerHTML = '<div class="access-error">Could not load — is the backend redeployed? ' + escHtml((data && data.message) || '') + '</div>';
    })
    .catch(() => {
      const panels = document.getElementById('access-panels');
      if (panels) panels.innerHTML = '<div class="access-error">Could not reach the backend. <button type="button" class="btn btn-sm" id="access-reconnect-btn" style="margin-left:0.5rem;">Retry</button></div>';
      const rb = document.getElementById('access-reconnect-btn');
      if (rb) rb.addEventListener('click', () => loadAccessData());
    });
}

function renderAccessPanel() {
  const panels = document.getElementById('access-panels');
  if (!panels) return;
  if (accessTab === 'depts')       renderDepartmentsTab();
  else if (accessTab === 'create') renderCreateTab();
  else if (accessTab === 'customers') renderCustomersTab();
  else if (accessTab === 'versions') renderVersionsTab();
  else                             renderPeopleTab();
}

// ─── BACKUP HEALTH ───────────────────────────────────────────────────────────
// The one line the whole Phase 1 safety net is judged by, on the screen an admin
// already opens. A backup nobody can see the state of is a backup nobody knows is
// broken, and the failure it prevents is silent by nature — the export simply stops
// appearing, and nothing anywhere says so.
//
// THREE STATES, AND THEY ARE NOT TWO. Healthy, failed, and "could not ask". The
// third is the dangerous one: a health line that renders "fine" when the request
// failed is worse than no line at all, because it converts an unknown into a
// reassurance. So an unreadable status wears the same red as a failure and says, in
// words, that it knows nothing.
let backupHealth = null;        // null = never asked; otherwise the backend's answer
let backupHealthPending = false;

function loadBackupHealth() {
  if (backupHealthPending) return;
  backupHealthPending = true;
  const url = CONFIG.GAS_URL + (CONFIG.GAS_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=getBackupHealth';
  const settle = (v) => {
    backupHealthPending = false;
    backupHealth = v;
    // Repaint only if the tab that shows it is still the one open — otherwise a
    // slow answer would overwrite whatever the admin has since moved to.
    if (accessTab === 'versions') renderAccessPanel();
  };
  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data && data.status === 'ok') settle(data);
      else settle({ status: 'error', message: (data && data.message) || 'The backend refused the request.' });
    })
    .catch(() => settle({ status: 'error', message: 'Could not reach the backend.' }));
}

function backupHealthHtml() {
  if (backupHealth === null || backupHealthPending) {
    return `<div class="access-section"><h3>Backups</h3>
      <p class="access-backup">Checking…</p></div>`;
  }
  if (backupHealth.status !== 'ok') {
    return `<div class="access-section"><h3>Backups</h3>
      <p class="access-backup access-backup-bad">⚠ Backup status unknown — ${escHtml(backupHealth.message || 'no answer')}</p>
      <p class="access-hint">This says nothing about the backups themselves, only that this device could not ask. Read it as unknown, not as fine.</p></div>`;
  }
  if (backupHealth.never) {
    return `<div class="access-section"><h3>Backups</h3>
      <p class="access-backup access-backup-bad">⚠ No backup has run yet</p>
      <p class="access-hint">The nightly export has never completed on this deployment. Run <strong>runNightlyBackup()</strong> once from the Apps Script editor to prove it works — until then there is no copy of the data to fall back on.</p></div>`;
  }
  const ok = backupHealth.ok !== false;
  const counts = `${backupHealth.irs || 0} IRs · ${backupHealth.users || 0} accounts`;
  const sheet = backupHealth.sheetUrl
    ? ` · <a href="${escHtml(backupHealth.sheetUrl)}" target="_blank" rel="noopener">open the backup sheet ↗</a>`
    : '';
  return `<div class="access-section"><h3>Backups</h3>
    <p class="access-backup ${ok ? 'access-backup-ok' : 'access-backup-bad'}">
      ${ok ? '✓' : '⚠'} Last backup: <span class="access-backup-when">${escHtml(backupHealth.at || '—')}</span>
      (${escHtml(backupHealth.ago || '')})</p>
    <p class="access-hint">${escHtml(counts)}${sheet}${backupHealth.message ? ' · ' + escHtml(backupHealth.message) : ''}</p>
    <p class="access-hint">Every night at about 23:40 IST, into <strong>I-PASSBOOK backups</strong> in Drive. 14 daily copies are kept, then one a week, one a month, and one a year forever.</p></div>`;
}

// ─── TAB 4: which build each account is running ──────────────────────────────
// The answer to "has everyone picked up the new version?" without asking anyone.
// It reads the SAME listUsers snapshot the other three tabs read — no extra
// request, no extra Drive read — and the number it shows is the version that
// account last SIGNED IN with, which is why each row carries its last-sign-in
// time beside it: "v54, three days ago" and "v54, ten minutes ago" are very
// different answers to the question this tab exists to ask.
//
// "Behind" is measured against the version of the app the ADMIN IS LOOKING AT,
// not against each other — a whole company on v54 is not "up to date" just
// because it agrees with itself, and this screen is read by whoever deploys.
function renderVersionsTab() {
  const panels = document.getElementById('access-panels');
  if (!panels) return;
  const users = accessCache.users || [];
  if (!users.length) {
    // The backup line is shown even with no roster: it is about the DEPLOYMENT, not
    // about the accounts, and on a fresh store "no backup has run yet" is exactly
    // the thing an admin needs to see.
    panels.innerHTML = backupHealthHtml() +
      '<div class="access-empty">No accounts yet — create one in the <strong>Create people</strong> tab.</div>';
    return;
  }

  const mine = versionNumber(APP_VERSION);
  const groups = {};
  users.forEach(u => {
    // `|| ''` covers a localStorage roster cached before the backend carried the
    // field: undefined must read as "not reported", never as a blank cell.
    const v = String(u.appVersion || '').trim() || 'not reported';
    (groups[v] = groups[v] || []).push(u);
  });
  // Newest build first, and the un-known group last — the eye should land on the
  // version most people are on, not on the bucket label.
  const label = Object.keys(groups).sort((a, b) => {
    const na = versionNumber(a), nb = versionNumber(b);
    if (na === null) return 1;
    if (nb === null) return -1;
    return nb - na;
  });

  const blocks = label.map(v => {
    const n = versionNumber(v);
    const stale = n !== null && mine !== null && n < mine;
    const rows = groups[v]
      .slice()
      .sort((a, b) => String(a.email).localeCompare(String(b.email)))
      .map(u => `<div class="acc-matrix-sub">${escHtml(u.email)}${u.name ? ' · ' + escHtml(u.name) : ''} · last signed in ${escHtml(u.lastLoginAt || 'never')}</div>`)
      .join('');
    return `
      <div class="access-section">
        <h3>${escHtml(v)} <span class="acc-badge${stale ? ' acc-badge-temp' : ''}">${groups[v].length}</span>${stale ? ' <span class="acc-badge acc-badge-temp">behind</span>' : ''}</h3>
        ${rows}
      </div>`;
  }).join('');

  panels.innerHTML = `
    ${backupHealthHtml()}
    <div class="access-section">
      <h3>Who is on which version</h3>
      <p class="access-hint">The build each account last signed in with. This app is
        <strong>${escHtml(APP_VERSION)}</strong> — anyone on an older number has not
        picked up the update yet, and they will be offered it on their next sign-in.
        A version is recorded at sign-in, so the time beside each person is how fresh
        that answer is.</p>
      ${blocks}
    </div>`;
}

// ─── TAB 1: people × departments matrix ──────────────────────────────────────
function renderPeopleTab() {
  const panels = document.getElementById('access-panels');
  if (!panels) return;
  const users = accessCache.users || [];
  const depts = accessCache.departments || [];
  if (!users.length) {
    panels.innerHTML = '<div class="access-empty">No accounts yet — create one in the <strong>Create people</strong> tab.</div>';
    return;
  }
  const head = depts.map(d => `<th title="${escHtml(d.name)}">${escHtml(d.name || d.key)}</th>`).join('');
  const rows = users.map(u => {
    const mine = u.departments || [];
    const cells = depts.map(d => `
      <td><input type="checkbox" class="acc-dept-tick" data-email="${escHtml(u.email)}" data-key="${escHtml(d.key)}"${mine.indexOf(d.key) >= 0 ? ' checked' : ''} /></td>`).join('');
    const badge = u.isAdmin
      ? '<span class="acc-badge acc-badge-admin">admin</span>'
      : (u.status === 'disabled' ? '<span class="acc-badge acc-badge-off">disabled</span>' : '');
    // A scoped account, said out loud. Without it a customer looks like a colleague whose
    // departments happen to be empty, and the natural next move — tick them some — is the
    // one thing that does nothing for them.
    const scope = u.customerOf
      ? '<span class="acc-badge acc-badge-cust">customer · ' + escHtml(u.customerOf) + '</span>' : '';
    const pending = u.mustChangePassword ? '<span class="acc-badge acc-badge-temp">temp password</span>' : '';
    return `<tr data-email="${escHtml(u.email)}">
      <td class="acc-matrix-name">
        <div class="access-email-line">${escHtml(u.email)}</div>
        <div class="acc-matrix-sub">${escHtml(u.name || '')}${u.name ? ' · ' : ''}${escHtml(u.lastLoginAt || 'never signed in')} ${badge}${scope}${pending}</div>
        <div class="acc-matrix-actions">
          <button type="button" class="btn btn-sm btn-secondary acc-reset" data-email="${escHtml(u.email)}">Reset password</button>
          ${u.isAdmin ? '' : `<button type="button" class="btn btn-sm btn-secondary acc-toggle" data-email="${escHtml(u.email)}" data-status="${u.status === 'disabled' ? 'active' : 'disabled'}">${u.status === 'disabled' ? 'Enable' : 'Disable'}</button>`}
        </div>
      </td>
      ${u.customerOf
        ? `<td class="acc-matrix-sub" colspan="${depts.length}">Scoped to <strong>${escHtml(u.customerOf)}</strong> — a customer sees that company's IRs and nothing else, so department access does not apply. Manage it in the <em>Customers</em> tab.</td>`
        : (depts.length ? cells : '<td class="acc-matrix-sub">Create a department first →</td>')}
    </tr>`;
  }).join('');

  panels.innerHTML = `
    <div class="access-section">
      <h3>Who is in which department</h3>
      <p class="access-hint">Tick the departments a person belongs to. <strong>Everyone</strong> signed in can view and comment on every section — a tick here only adds <strong>edit</strong> rights, on the sections that department owns (set in the <em>Departments</em> tab).</p>
      <div class="acc-matrix-wrap">
        <table class="acc-matrix">
          <thead><tr><th>Person</th>${head}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button type="button" class="btn" id="access-save-all" style="margin-top:0.75rem;">💾 Save all changes</button>
    </div>`;

  panels.querySelectorAll('.acc-reset').forEach(b => b.addEventListener('click', () => resetPasswordAction(b.dataset.email)));
  panels.querySelectorAll('.acc-toggle').forEach(b => b.addEventListener('click', () => setStatusAction(b.dataset.email, b.dataset.status)));
  const save = document.getElementById('access-save-all');
  if (save) save.addEventListener('click', savePeopleMatrix);
}

// One POST per CHANGED person. Unchanged rows are skipped, so a 19-person grid
// with one edit is one write, not nineteen.
function savePeopleMatrix() {
  const btn = document.getElementById('access-save-all');
  const ticks = document.querySelectorAll('.acc-dept-tick');
  const byEmail = {};
  ticks.forEach(t => {
    const e = t.dataset.email;
    if (!byEmail[e]) byEmail[e] = [];
    if (t.checked) byEmail[e].push(t.dataset.key);
  });
  const jobs = [];
  (accessCache.users || []).forEach(u => {
    // A customer is scoped by company, never by department, and their row has no ticks
    // in it — so an empty set here means "nothing to say", not "remove everything".
    // Writing it would be a silent change to an account this grid cannot manage.
    if (u.customerOf) return;
    const next = (byEmail[u.email] || []).slice().sort();
    const prev = (u.departments || []).slice().sort();
    if (next.join('|') === prev.join('|')) return;      // unchanged — don't write
    jobs.push(adminPost('setUserDepartments', { email: u.email, departments: JSON.stringify(next) }));
  });
  if (!jobs.length) { showToast('Nothing changed'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  Promise.all(jobs).then(results => {
    const failed = results.filter(d => !d || d.status !== 'ok').length;
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save all changes'; }
    showToast(failed ? `Saved ${results.length - failed}, ${failed} failed` : `Saved ${results.length} change${results.length === 1 ? '' : 's'}`);
    loadAccessData();
  });
}

function resetPasswordAction(email) {
  if (!confirm('Issue a NEW temporary password for ' + email + '?\n\nTheir current password stops working and their devices are signed out.')) return;
  adminPost('resetUserPassword', { email: email }).then(d => {
    if (d && d.status === 'ok') { showCredentials([{ email: d.email, tempPassword: d.tempPassword, name: '' }]); loadAccessData(); }
    else showToast((d && d.message) || 'Could not reset the password.');
  });
}

function setStatusAction(email, status) {
  if (status === 'disabled' && !confirm('Disable ' + email + '?\n\nThey are signed out immediately and cannot sign in again until re-enabled.')) return;
  adminPost('setUserStatus', { email: email, status: status }).then(d => {
    showToast((d && d.message) || (d && d.status === 'ok' ? 'Done' : 'Could not change the status.'));
    loadAccessData();
  });
}

// ─── TAB 2: department → section grants ──────────────────────────────────────
function renderDepartmentsTab() {
  const panels = document.getElementById('access-panels');
  if (!panels) return;
  const depts = accessCache.departments || [];
  const cards = depts.map(d => {
    const ticks = SECTION_IDS.map(s => `
      <label class="acc-sec" title="${escHtml(SECTION_SHORT[s])}">
        <input type="checkbox" class="acc-grant" data-key="${escHtml(d.key)}" data-sec="${s}"${d.grants && d.grants[s] ? ' checked' : ''} />
        <span>${SECTION_LABELS[s]}</span>
        <span class="acc-sec-name">${escHtml(SECTION_SHORT[s])}</span>
      </label>`).join('');
    return `<div class="access-user-card" data-key="${escHtml(d.key)}">
      <div class="access-user-top">
        <div>
          <div class="access-email-line">${escHtml(d.name || d.key)}</div>
          <div class="acc-matrix-sub">${d.members || 0} ${d.members === 1 ? 'person' : 'people'}${d.active ? '' : ' · inactive'}</div>
        </div>
        <div class="access-user-controls">
          <button type="button" class="btn btn-sm acc-save-dept" data-key="${escHtml(d.key)}">Save</button>
          <button type="button" class="btn btn-sm btn-danger acc-del-dept" data-key="${escHtml(d.key)}">Delete</button>
        </div>
      </div>
      <div class="access-perms-grid">${ticks}</div>
      <div class="access-perms-grid access-perms-triage">
        <label class="acc-sec" title="${escHtml(TRIAGE_SHORT)}">
          <input type="checkbox" class="acc-grant" data-key="${escHtml(d.key)}" data-sec="triage"${d.triage ? ' checked' : ''} />
          <span>${TRIAGE_LABEL}</span>
          <span class="acc-sec-name">${escHtml(TRIAGE_SHORT)}</span>
        </label>
      </div>
    </div>`;
  }).join('');

  panels.innerHTML = `
    <div class="access-section">
      <h3>What each department may edit</h3>
      <p class="access-hint">Tick the sections a department owns. People in that department get <strong>edit</strong> on exactly those sections, and view + comment everywhere else.</p>
      <div class="access-hint"><strong>TR</strong> is a separate switch, not a section: it lets a department change an IR's <em>status, assignee, priority and category</em> — and edit the Overview panel — without granting edit on any section. That is what Customer Relations and Management hold.</div>
      <div class="access-hint">Need one person to edit one section? Create a department with just that person in it.</div>
      <div id="access-dept-list">${cards || '<div class="access-empty">No departments yet.</div>'}</div>
      <div class="access-add-row" style="margin-top:0.75rem;">
        <input type="text" id="access-new-dept" class="form-input" placeholder="New department name" />
        <button type="button" class="btn" id="access-add-dept">+ Add department</button>
      </div>
    </div>`;

  panels.querySelectorAll('.acc-save-dept').forEach(b => b.addEventListener('click', () => saveDepartmentAction(b.dataset.key)));
  panels.querySelectorAll('.acc-del-dept').forEach(b => b.addEventListener('click', () => deleteDepartmentAction(b.dataset.key)));
  const add = document.getElementById('access-add-dept');
  if (add) add.addEventListener('click', () => {
    const inp = document.getElementById('access-new-dept');
    const name = (inp && inp.value || '').trim();
    if (!name) { showToast('Enter a department name'); return; }
    const existing = (accessCache.departments || []).find(d => (d.name || '').toLowerCase() === name.toLowerCase());
    if (existing) { showToast('That department already exists'); return; }
    adminPost('saveDepartment', { name: name, grants: '{}' }).then(d => {
      showToast((d && d.message) || 'Created');
      loadAccessData();
    });
  });
}

function readDeptGrants(key) {
  const grants = {};
  document.querySelectorAll(`.acc-grant[data-key="${key}"]`).forEach(t => { grants[t.dataset.sec] = t.checked ? 'edit' : ''; });
  return grants;
}
function saveDepartmentAction(key) {
  const d = (accessCache.departments || []).find(x => x.key === key);
  adminPost('saveDepartment', {
    key: key,
    name: (d && d.name) || key,
    active: (d && d.active === false) ? 'no' : 'yes',
    grants: JSON.stringify(readDeptGrants(key)),
  }).then(r => { showToast((r && r.message) || 'Saved'); loadAccessData(); });
}
function deleteDepartmentAction(key) {
  if (!confirm('Delete the department "' + key + '"?\n\nEveryone in it loses the edit rights it granted. This cannot be undone.')) return;
  adminPost('deleteDepartment', { key: key }).then(d => { showToast((d && d.message) || 'Deleted'); loadAccessData(); });
}

// ─── TAB 5: customers — the portal's accounts ─────────────────────────────────
//
// A customer account is a SCOPE ON ROWS, not a permission level. It is an ordinary
// account plus one line in access.json naming a company; the backend then narrows
// every read to that company's tickets, and getEffectiveAccess turns the scope into
// "view the overview, nothing else, no triage". So there is no customer permission to
// configure on this screen — the company name IS the whole setting, which is why the
// panel below is a text field and a button rather than a matrix.
//
// WHICH IS ALSO WHY THE PEOPLE TAB CANNOT MANAGE ONE. A department tick means "edit
// these sections", and a scoped account has no sections to edit. renderPeopleTab
// therefore shows a customer row as a statement with no ticks in it, and
// savePeopleMatrix() skips customers outright, so a stray membership can never be
// written behind this panel's back.
let custNotice = null;

// The portal sits beside this app, so the app's own directory is the answer — the same
// derivation the backend's customerPortalUrl() makes from CONFIG.APP_URL. Not a
// constant, because this page is served from GitHub Pages and from a local preview,
// and the link has to be the one that works from wherever it was copied.
function customerPortalLink() {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'customer.html';
}

// Every company an admin might be inviting into: the ones already on a ticket, plus the
// ones a customer is already scoped to — a second contact at a company whose tickets
// happen not to be in the loaded list is a normal thing to invite.
//
// THE COLUMN IS `companyName`, AND IT HAS TO BE. This list feeds the company an admin
// picks, and that string is what the backend matches rows against — customerIRS() reads
// the intake grid through companyColumnIndex(), whose needles are 'where do you work' /
// 'company name' / 'company' / … — i.e. Col R, the `companyName` mapping. This function
// used to read `customerName` instead, which is Col L "Who's Reporting", the REPORTING
// PERSON'S name with the phone split off it (splitNamePhone). The two columns hold
// different things, so the dropdown was offering names that could never match a row: the
// invitation mailed fine, the customer signed in, and the portal was empty — a working
// account scoped to nothing, with nothing on screen saying why. `companyName` is the
// only column here that agrees with what the backend decides access by.
//
// A ticket with no company named is skipped rather than offered: an empty option invites
// an admin to scope somebody to nothing.
function knownCompanies() {
  const seen = new Set();
  (accessCache.users || []).forEach(u => { if (u.customerOf) seen.add(String(u.customerOf).trim()); });
  (allIRs || []).forEach(ir => { if (ir && ir.companyName) seen.add(String(ir.companyName).trim()); });
  return [...seen].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

// The handover text, in the same shape as credentialsTxt() — a customer has no
// temporary password, so what they need instead is the link and the one button to
// press. This is what an admin sends when the invitation email could not go out, and
// it is offered on success too, because "we emailed them" is not the same as "they
// will find it".
function customerHandoverTxt(email, company) {
  const link = customerPortalLink();
  return [
    'I-PASSBOOK — your customer space',
    '================================',
    '',
    (company ? 'Company: ' + company : ''),
    'Sign in with: ' + email,
    '',
    'How to get in (first time only)',
    '-------------------------------',
    '1. Open: ' + link,
    '2. Press "First time here?" and enter the email address above.',
    '3. A code arrives by email. Enter it together with the password you want.',
    '   Nobody at Indrones sets that password, and nobody here can read it.',
    '',
    'After that you can sign in either way — with that password, or by asking',
    'for a code each morning and never having to remember one.',
    '',
    'What you can do',
    '---------------',
    '• Raise a request against any of your aircraft, and follow what we are',
    '  doing about it.',
    '• Read the service record of every aircraft we support for you.',
    '',
    'On a phone: open the link, then use your browser menu →',
    '"Add to Home screen" so it opens like an app.',
    '',
    'Keep this safe and do not forward it.',
  ].filter(l => l !== '').join('\n');
}

function renderCustomersTab() {
  const panels = document.getElementById('access-panels');
  if (!panels) return;
  const companies = knownCompanies();
  const customers = (accessCache.users || []).filter(u => u.customerOf);

  const options = companies.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  // "Other company" is ALWAYS offered, and is preselected when there is nothing to pick
  // from. A company with no ticket yet is the normal state on a first sale, and a
  // dropdown that cannot name it would make the first customer the one you cannot
  // onboard.
  const nothingToPick = companies.length === 0;

  const notice = custNotice ? `
    <div class="access-section acc-invite-${custNotice.mailed ? 'ok' : 'warn'}">
      <h3>${custNotice.mailed ? '✅ Invited' : '⚠️ Account created — the invitation email could NOT be sent'}</h3>
      <p class="access-hint">${escHtml(custNotice.message)}</p>
      <div class="access-add-row">
        <button type="button" class="btn btn-sm" id="access-cust-copy">📋 Copy what to send them</button>
        <button type="button" class="btn btn-sm btn-secondary" id="access-cust-copy-link">Copy the portal link</button>
      </div>
      <p class="access-hint" style="margin-top:0.5rem;"><code>${escHtml(customerPortalLink())}</code></p>
    </div>` : '';

  panels.innerHTML = `
    <div class="access-section">
      <h3>Invite a customer</h3>
      <p class="access-hint">Creates the account and emails the customer the portal address.
        Their <strong>company</strong> is the whole setting — it decides which IRs they
        can see, and nothing else. There is no temporary password to hand over: the customer
        sets their own, and nobody at Indrones ever sees it.</p>
      <div class="access-add-row">
        <input type="email" id="access-cust-email" class="form-input access-cust-field" placeholder="contact@customer.com" />
        <input type="text" id="access-cust-name" class="form-input access-cust-field" placeholder="Contact name (optional)" />
      </div>
      <div class="access-add-row" style="margin-top:0.5rem;">
        <select id="access-cust-company" class="form-input">
          ${options}
          <option value=""${nothingToPick ? ' selected' : ''}>Other company (type it)…</option>
        </select>
        <input type="text" id="access-cust-company-new" class="form-input" placeholder="Company name"
               value=""${nothingToPick ? '' : ' hidden'} />
        <button type="button" class="btn" id="access-cust-invite">Invite customer</button>
      </div>
      <p class="access-hint" style="margin-top:0.5rem;">The list is every company already named on an
        IR, plus every company a customer is already scoped to.</p>
      ${notice}
    </div>
    <div class="access-section">
      <h3>Customer accounts <span class="acc-badge acc-badge-cust">${customers.length}</span></h3>
      <p class="access-hint">Everyone scoped to a company. A scoped account sees only that
        company's IRs, and cannot change anything. Clearing the scope would give them
        <strong>every</strong> IR, so an account that should no longer have access is
        <em>disabled</em> in the People tab, never unscoped.</p>
      ${customers.length ? customers.map(u => `
        <div class="access-user-card">
          <div class="access-email-line">${escHtml(u.email)}</div>
          <div class="acc-matrix-sub">${escHtml(u.name || 'no name given')} · ${escHtml(u.lastLoginAt || 'never signed in')}${u.status === 'disabled' ? ' · <span class="acc-badge acc-badge-off">disabled</span>' : ''}</div>
          <div class="access-add-row" style="margin-top:0.4rem;">
            <input type="text" class="form-input acc-cust-company" data-email="${escHtml(u.email)}" value="${escHtml(u.customerOf)}" aria-label="Company for ${escHtml(u.email)}" />
            <button type="button" class="btn btn-sm btn-secondary acc-cust-save" data-email="${escHtml(u.email)}">Save company</button>
          </div>
        </div>`).join('') : '<div class="access-empty">No customer accounts yet. Invite the first one above.</div>'}
    </div>`;

  const sel = document.getElementById('access-cust-company');
  const neu = document.getElementById('access-cust-company-new');
  if (sel && neu) sel.addEventListener('change', () => {
    const other = !sel.value;
    neu.hidden = !other;
    if (other) neu.focus();
  });

  const invite = document.getElementById('access-cust-invite');
  if (invite) invite.addEventListener('click', () => {
    const emailEl = document.getElementById('access-cust-email');
    const nameEl  = document.getElementById('access-cust-name');
    const email   = (emailEl && emailEl.value || '').trim().toLowerCase();
    const name    = (nameEl && nameEl.value || '').trim();
    const company = (sel && sel.value) ? sel.value : ((neu && neu.value || '').trim());
    if (!email)   { showToast('Enter the customer\'s email address'); return; }
    if (!company) { showToast('Choose or type the company this customer belongs to'); return; }
    custNotice = null;
    invite.disabled = true; invite.textContent = 'Inviting…';
    adminPost('inviteCustomer', { email: email, name: name, company: company }).then(d => {
      invite.disabled = false; invite.textContent = 'Invite customer';
      if (!d || d.status !== 'ok') { showToast((d && d.message) || 'Could not invite the customer.'); return; }
      // THE ACCOUNT AND ITS SCOPE ARE REAL WHETHER OR NOT THE MAIL LEFT. A mail failure is
      // reported as a next step — with the text to send by hand — and never as a failed
      // onboarding, because the backend has already written both the scope and the
      // account by the time it tries to send. Re-rendering twice here is deliberate:
      // once now so the notice appears immediately, and once when the roster refresh
      // lands, which is what puts the new customer in the list underneath it.
      custNotice = { mailed: !!d.mailed, message: d.message || '', email: d.email, company: d.company };
      renderCustomersTab();
      loadAccessData();
    });
  });

  const copyAll = document.getElementById('access-cust-copy');
  if (copyAll) copyAll.addEventListener('click', () => copyText(customerHandoverTxt(custNotice.email, custNotice.company)));
  const copyLink = document.getElementById('access-cust-copy-link');
  if (copyLink) copyLink.addEventListener('click', () => copyText(customerPortalLink()));

  panels.querySelectorAll('.acc-cust-save').forEach(b => b.addEventListener('click', () => {
    const input = panels.querySelector('.acc-cust-company[data-email="' + b.dataset.email.replace(/"/g, '\\"') + '"]');
    const company = (input && input.value || '').trim();
    if (!company) { showToast('Type the company this customer should see, or disable the account instead'); return; }
    b.disabled = true; b.textContent = 'Saving…';
    adminPost('setCustomerCompany', { email: b.dataset.email, company: company }).then(d => {
      b.disabled = false; b.textContent = 'Save company';
      showToast((d && d.message) || (d && d.status === 'ok' ? 'Saved' : 'Could not save the company.'));
      if (d && d.status === 'ok') loadAccessData();
    });
  }));
}

// ─── TAB 3: create people (single + bulk) ────────────────────────────────────
function renderCreateTab() {
  const panels = document.getElementById('access-panels');
  if (!panels) return;
  panels.innerHTML = `
    <div class="access-section">
      <h3>One person</h3>
      <div class="access-add-row">
        <input type="email" id="access-new-email" class="form-input" placeholder="teammate@indrones.com" />
        <input type="text" id="access-new-name" class="form-input" placeholder="Full name (optional)" />
        <button type="button" class="btn" id="access-create-one">+ Create account</button>
      </div>
    </div>
    <div class="access-section">
      <h3>Several people</h3>
      <p class="access-hint">One email per line. Commas and semicolons work too. Duplicates and existing accounts are skipped and reported — one typo will not stop the rest.</p>
      <textarea id="access-bulk-emails" class="form-input" rows="6" placeholder="a@indrones.com&#10;b@indrones.com&#10;c@indrones.com"></textarea>
      <p class="access-hint" style="margin-top:0.5rem;">Optional: one <code>email, Full Name</code> per line, to set display names.</p>
      <textarea id="access-bulk-names" class="form-input" rows="3" placeholder="a@indrones.com, Asha Rao"></textarea>
      <button type="button" class="btn" id="access-bulk-create" style="margin-top:0.75rem;">Create accounts</button>
    </div>
    <div id="access-creds"></div>
    <div class="access-section acc-danger">
      <h3>Danger zone</h3>
      <p class="access-hint">Delete <strong>every</strong> account except the admins. Used once when the app was re-provisioned. It cannot be undone, so it happens in two steps: review the list, copy it, then confirm.</p>
      <div class="access-add-row">
        <input type="text" id="access-purge-confirm" class="form-input" placeholder="Type PURGE to confirm" />
        <button type="button" class="btn btn-danger" id="access-purge">Review what will be deleted</button>
      </div>
      <div id="access-purge-out"></div>
    </div>`;

  const one = document.getElementById('access-create-one');
  if (one) one.addEventListener('click', () => {
    const inp = document.getElementById('access-new-email');
    const nm  = document.getElementById('access-new-name');
    const email = (inp && inp.value || '').trim().toLowerCase();
    if (!email) { showToast('Enter an email address'); return; }
    one.disabled = true; one.textContent = 'Creating…';
    adminPost('createUser', { email: email, name: (nm && nm.value || '').trim() }).then(d => {
      one.disabled = false; one.textContent = '+ Create account';
      if (d && d.status === 'ok') {
        if (inp) inp.value = '';
        if (nm) nm.value = '';
        showCredentials([{ email: d.email, tempPassword: d.tempPassword, name: d.name }]);
        loadAccessData();
      } else showToast((d && d.message) || 'Could not create the account.');
    });
  });

  const bulk = document.getElementById('access-bulk-create');
  if (bulk) bulk.addEventListener('click', () => {
    const eInp = document.getElementById('access-bulk-emails');
    const nInp = document.getElementById('access-bulk-names');
    const emails = (eInp && eInp.value || '').trim();
    if (!emails) { showToast('Paste at least one email address'); return; }
    bulk.disabled = true; bulk.textContent = 'Creating…';
    adminPost('bulkCreateUsers', { emails: emails, names: (nInp && nInp.value) || '' }).then(d => {
      bulk.disabled = false; bulk.textContent = 'Create accounts';
      if (d && d.status === 'ok') {
        if (eInp) eInp.value = '';
        if (nInp) nInp.value = '';
        showCredentials(d.created || [], d.skipped || []);
        loadAccessData();
      } else showToast((d && d.message) || 'Could not create the accounts.');
    });
  });

  const purge = document.getElementById('access-purge');
  if (purge) purge.addEventListener('click', () => {
    const c = document.getElementById('access-purge-confirm');
    const out = document.getElementById('access-purge-out');
    const typed = (c && c.value || '').trim();
    if (typed !== 'PURGE') { showToast('Type PURGE exactly to confirm'); return; }
    purge.disabled = true; purge.textContent = 'Checking…';
    // Step 1 — PLAN ONLY. The backend writes nothing here, so this is safe to press
    // by accident and safe to close the page on. It used to delete first and hand
    // back a "backup" in the same response, which is not a backup: a dropped
    // connection took the only record of those accounts with them.
    adminPost('purgeUsers', { confirm: 'PURGE', dryRun: '1' }).then(d => {
      purge.disabled = false; purge.textContent = 'Review what will be deleted';
      if (!d || d.status !== 'ok') { showToast((d && d.message) || 'Purge refused.'); return; }
      const rows = d.removed || [];
      if (!out) return;
      if (!rows.length) {
        out.innerHTML = '<p class="access-hint" style="margin-top:0.6rem;">Nothing to delete — there are no non-admin accounts.</p>';
        return;
      }
      // Tab-separated so it pastes straight into a Sheet as columns.
      const backup = rows.map(r => [r.email, r.name, r.createdBy, r.createdAt].join('\t')).join('\n');
      out.innerHTML = `<p class="access-hint" style="margin-top:0.6rem;">Nothing has been deleted yet — copy this list first.</p>
        <textarea class="form-input" rows="6" readonly>${escHtml(backup)}</textarea>
        <div class="access-add-row" style="margin-top:0.5rem;">
          <button type="button" class="btn btn-sm btn-secondary" id="access-purge-copy">Copy backup</button>
          <button type="button" class="btn btn-sm btn-danger" id="access-purge-go">Delete these ${rows.length} account(s)</button>
        </div>`;
      const cp = document.getElementById('access-purge-copy');
      if (cp) cp.addEventListener('click', () => copyText(backup));
      const go = document.getElementById('access-purge-go');
      if (go) go.addEventListener('click', () => {
        if (!confirm(`Delete ${rows.length} account(s) permanently?`)) return;
        go.disabled = true; go.textContent = 'Deleting…';
        // `expect` pins the reviewed count. If an account was created or removed
        // between the two steps the backend refuses and nothing is deleted.
        adminPost('purgeUsers', { confirm: 'PURGE', expect: String(rows.length) }).then(res => {
          if (res && res.status === 'ok') {
            out.innerHTML = `<p class="access-hint" style="margin-top:0.6rem;">Deleted ${(res.removed || []).length} account(s).</p>`;
            if (c) c.value = '';
            showToast(res.message || 'Accounts removed.');
            loadAccessData();
          } else {
            go.disabled = false; go.textContent = `Delete these ${rows.length} account(s)`;
            showToast((res && res.message) || 'Purge refused.');
          }
        });
      });
    });
  });
}

// The credentials panel. This is the ONLY time a temporary password is visible —
// the sheet holds its hash — so it warns, and offers both a human block and a CSV.
function showCredentials(created, skipped) {
  const wrap = document.getElementById('access-creds');
  if (!wrap) return;
  if (!created || !created.length) {
    wrap.innerHTML = skipped && skipped.length
      ? `<div class="access-section"><h3>Nothing created</h3>${skippedHtml(skipped)}</div>`
      : '';
    return;
  }
  const blocks = created.map(c => credentialsTxt(c.email, c.tempPassword, c.name)).join('\n\n' + '-'.repeat(60) + '\n\n');
  const csv = created.map(c => c.email + ',' + c.tempPassword).join('\n');
  const cards = created.map(c => `
    <div class="cred-card">
      <div class="cred-email">${escHtml(c.email)}${c.name ? ' · ' + escHtml(c.name) : ''}</div>
      <div class="cred-pw"><code>${escHtml(c.tempPassword)}</code>
        <button type="button" class="btn btn-sm btn-secondary cred-copy-pw" data-pw="${escHtml(c.tempPassword)}">Copy password</button>
      </div>
    </div>`).join('');
  wrap.innerHTML = `
    <div class="access-section">
      <h3>${created.length} temporary password${created.length === 1 ? '' : 's'}</h3>
      <p class="access-hint">⚠️ <strong>Shown once.</strong> Only the hash is stored — if you lose these, use <em>Reset password</em> to issue new ones. Nothing here has been written to the sheet or to any file.</p>
      ${cards}
      <div class="access-add-row" style="margin-top:0.75rem;">
        <button type="button" class="btn" id="cred-copy-all">📋 Copy all handover texts</button>
        <button type="button" class="btn btn-secondary" id="cred-copy-csv">Copy as CSV (email,password)</button>
      </div>
      ${skipped && skipped.length ? skippedHtml(skipped) : ''}
    </div>`;
  const all = document.getElementById('cred-copy-all');
  if (all) all.addEventListener('click', () => copyText(blocks));
  const csvBtn = document.getElementById('cred-copy-csv');
  if (csvBtn) csvBtn.addEventListener('click', () => copyText(csv));
  wrap.querySelectorAll('.cred-copy-pw').forEach(b => b.addEventListener('click', () => copyText(b.dataset.pw)));
}
function skippedHtml(skipped) {
  return `<div class="access-hint" style="margin-top:0.6rem;"><strong>Skipped:</strong><ul>` +
    skipped.map(s => `<li>${escHtml(s.email)} — ${escHtml(s.reason || '')}</li>`).join('') + `</ul></div>`;
}

// ─── USER MENU ───────────────────────────────────────────────────────────────
function createUserMenu() {
  let menu = document.getElementById('user-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'user-menu';
    menu.innerHTML = `
      <div class="user-menu-name">${currentUser?.name || 'User'}</div>
      <div class="user-menu-email">${currentUser?.email || ''}</div>
      ${buildAppearanceGroup()}
      ${isAdmin() ? '<button class="signout-btn" id="access-admin-btn">👥 User Access</button>' : ''}
      <button class="signout-btn" id="quick-unlock-btn">Turn on Quick unlock</button>
      <button class="signout-btn" id="signout-btn">Sign Out</button>
    `;
    document.body.appendChild(menu);
    // Appearance rows. Delegated on the menu rather than bound per row, because
    // the menu is rebuilt by createUserMenu() whenever the allowlist changes.
    menu.addEventListener('click', (e) => {
      const row = e.target.closest('.appearance-row');
      if (!row) return;
      const [group, value] = row.dataset.opt.split(':');
      if (group === 'theme') setTheme(value); else setPalette(value);
    });
    syncAppearanceMenu();
    document.getElementById('signout-btn').addEventListener('click', signOut);
    // Quick unlock. What the row does depends on where the device already is:
    // nothing here → enroll; a token but no pattern → add the pattern; a full
    // record → offer removal. syncQuickUnlockMenu keeps the label right.
    document.getElementById('quick-unlock-btn').addEventListener('click', () => {
      menu.style.display = 'none';
      beginQuickUnlockSetup();
    });
    syncQuickUnlockMenu();
    const adminBtn = document.getElementById('access-admin-btn');
    if (adminBtn) adminBtn.addEventListener('click', () => { menu.style.display = 'none'; openAccessModal(); });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== userAvatar) menu.style.display = 'none';
    });
  }
  return menu;
}

// The menu row's label IS the state: nothing registered yet = the setup offer;
// a token but no pattern = the pattern is the missing half; a full record = the
// removal offer. Called on enrollment, on pattern saves and on removal, and
// from createUserMenu when the menu is first built.
function syncQuickUnlockMenu() {
  const btn = document.getElementById('quick-unlock-btn');
  if (!btn) return;
  const st = loadUnlock();
  if (!st) btn.textContent = 'Turn on Quick unlock';
  else if (!st.patternHash) btn.textContent = 'Add unlock pattern';
  else btn.textContent = 'Remove Quick unlock';
}

function toggleUserMenu() {
  const menu = createUserMenu();
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function signOut() {
  // Revoke the server session (best-effort), then clear local state.
  const st = currentUser && currentUser.sessionToken;
  if (st) {
    try {
      const fd = new FormData();
      fd.append('action', 'logout');
      fd.append('sessionToken', st);
      // _origFetch, not the intercepted one: the interceptor's rules are built
      // around keeping a live session, and this call is deliberately ending one.
      _origFetch(CONFIG.GAS_URL, { method: 'POST', body: fd }).catch(() => {});
    } catch { /* non-fatal */ }
  }
  clearLocalAuth();
  currentUser = null;
  location.reload();
}

// ─── (Reconnect to Google removed — auth is now email + password) ────────────

// ─── MASTER INDEX ────────────────────────────────────────────────────────────
function showIndex() {
  currentView = 'index';
  renderLayout();
  headerTitle.textContent = tFloor('app.name', 'I-PASSBOOK');
}

// ─── THE CUSTOMER DOOR ────────────────────────────────────────────────────────
// The app's SECOND open door, and the only one a customer ever needs.
//
// ── Paste the form's URL here ────────────────────────────────────────────────
// Empty, the entry on the sign-in screen does not render at all. That is the
// honest default: a button that opens nothing is worse than no button, and the
// app cannot know someone else's form URL.
//
// It is the SHARE link (`https://docs.google.com/forms/d/e/…/viewform`), not the
// editor link, which does not open for anyone but its owner.
//
// ── Why this is safe to put on an unauthenticated screen ─────────────────────
// A Google Form only ACCEPTS input. It reads nothing, it is hosted by Google, and
// it knows nothing about this app or its IRs — responses land wherever that form
// already puts them, which is where they landed before this existed. Every OTHER
// byte the app shows is behind a session token; this is a front door, not a hole.
//
// ── Why there is no iframe, and this is the whole design ─────────────────────
// The form records the sender's email address, so Google requires a sign-in
// before it renders. Inside an iframe that sign-in CANNOT be completed:
// accounts.google.com sends `X-Frame-Options: DENY`, so the "Sign in" button
// Google draws in the frame does nothing at all — measured, not assumed. A device
// already signed in to Google saw the form and everything looked fine; for
// everyone else the frame was a wall, and a cross-origin frame reports nothing
// back, so the app could not tell the two cases apart or say which one you were in.
//
// So the door links OUT. It explains, in the modal, that Google will ask for a
// sign-in, and hands over one button that opens the real form in a new tab, where
// the sign-in works because a tab is not a frame.
//
// The side effect is worth naming: no iframe exists anywhere in the app, so
// opening this door makes NO request to Google. The only request is the one the
// person makes by pressing the button. The privacy claim stops being "nothing
// until you open the dialog" and becomes "nothing at all, ever, unless you ask".
const CUSTOMER_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScKxygN_FWBo_pD-uc9g6y5fPx4Mc0BB7pyA8Vy2BPTXAkJlw/viewform';

function wireCustomerDoor() {
  const open  = document.getElementById('customer-door-open');
  const door  = document.getElementById('customer-door');
  const go    = document.getElementById('customer-door-go');
  const close = document.getElementById('customer-door-close');
  if (!open || !door || !go) return;

  // No URL configured: the entry does not exist, and neither does the modal. The
  // FAQ link beside it is markup and stays.
  if (!CUSTOMER_FORM_URL) return;

  // The href comes from the ONE constant, never a second copy in the markup. A
  // link is a NAVIGATION: it costs nothing until it is tapped, which is why it can
  // sit here unguarded where a frame could not.
  open.style.display = '';
  go.href = CUSTOMER_FORM_URL;

  let prevFocus = null;
  const show = () => {
    prevFocus = document.activeElement;
    door.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Focus moves into the dialog, or a keyboard user is still tabbing around the
    // sign-in form behind it. The button, not the close cross: the action is what
    // a person opened this for.
    go.focus();
  };
  const hide = () => {
    door.style.display = 'none';
    document.body.style.overflow = '';
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };

  open.addEventListener('click', show);
  if (close) close.addEventListener('click', hide);
  // A tap on the dimmed ground closes it; a tap INSIDE the card must not, which is
  // why this tests the target rather than listening on the card.
  door.addEventListener('click', e => { if (e.target === door) hide(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && door.style.display !== 'none') hide();
  });
}

// ─── A SITE, ON A MAP, WITHOUT A MAP ─────────────────────────────────────────
// The owner's decision on maps, in his words: "Text + a link out". So this builds
// a URL and stops. No tiles, no API key, no billing, no vendor SDK — and, the part
// that matters for a tool holding customer data, NOTHING about the site reaches
// Google until a person actually taps the link. The value is never fetched from
// here, only put into an href.
//
// Pure, and deliberately so: it reads a string, returns a URL, and touches no DOM,
// no clock and no network. That is what lets a render call it safely, and what lets
// the field it feeds stay live as someone types.
//
// ONE URL shape, because Google's Maps URLs API accepts both a place name and a
// "lat,lng" pair through the same `query=`: "12.9716,77.5946" is a place, and so is
// "Plot 4, Whitefield, Bengaluru". A blank value returns null rather than a link —
// an empty `q=` opens Maps on the whole world, which reads as "we know where this
// is" when we plainly do not.
function mapsLink(value) {
  const q = String(value == null ? '' : value).trim();
  if (!q) return null;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

// ─── INSIGHTS ────────────────────────────────────────────────────────────────
// Counts over the IR list, sliced by the variables the desk actually asks about.
// Everything here is client-side over `allIRs` + `irState`, both of which are
// already fully in memory (one list read, plus one `__IRS__` read), so this
// page adds NO endpoint, no cache and no second source of truth. If the two ever
// disagree it is because the list is stale, not because the dashboard is.
//
// Read-only and visible to every signed-in user: it reads the same rows the IR
// list already shows them, so there is nothing here to gate.

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                      'August', 'September', 'October', 'November', 'December'];

// "2025-09-28" → { y, m, d }, or null for anything else. `ir.dateRaisedISO` is the
// only clean sortable date on a record — `ir.dateRaised` is display-only and holds
// whatever the Sheet had, and there is no createdAt/timestamp anywhere. Returning
// null rather than NaN is load-bearing: an unparseable date must land in its own
// bucket, never in year 0 or in every year at once.
function parseISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso).trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

// A fiscal year is named by the calendar year it STARTS in (1 April – 31 March),
// so FY 2025-26 covers Apr–Dec 2025 and Jan–Mar 2026. Every helper here returns or
// takes that integer, never a formatted string, so a label change can never become
// a filtering bug.
function irFiscalYear(iso) {
  const d = parseISODate(iso);
  if (!d) return null;
  return d.m >= 4 ? d.y : d.y - 1;
}

function irMonthNumber(iso) {
  const d = parseISODate(iso);
  return d ? d.m : null;
}

function fyLabel(startYear) { return startYear + '-' + String((startYear + 1) % 100).padStart(2, '0'); }

// The dashboard's own filter state, separate from the IR list's strips.
// `month` is deliberately NOT derived from `fy`: Month was asked to filter
// independently, so `month` narrows across every year and `fy` narrows across every
// month. Both set is their intersection, not a contradiction.
const INSIGHTS_ALL = 'all';
let insightsFilters = { fy: INSIGHTS_ALL, month: INSIGHTS_ALL, status: INSIGHTS_ALL,
                        category: INSIGHTS_ALL, customer: INSIGHTS_ALL, drone: INSIGHTS_ALL };

// The dropdowns' option lists, computed over the WHOLE list and never over the
// filtered rows: a select built from filtered rows would drop every other option the
// moment one was chosen, leaving no way to change your mind. Same reasoning as
// segmentCounts() reading allIRs.
function insightsFacets(irs) {
  const rows = Array.isArray(irs) ? irs : [];
  const years = new Set(), months = new Set(), customers = new Set(), drones = new Set();
  let undated = 0;
  rows.forEach(ir => {
    const fy = irFiscalYear(ir.dateRaisedISO);
    if (fy === null) undated++;
    else { years.add(fy); months.add(irMonthNumber(ir.dateRaisedISO)); }
    if (ir.customerName) customers.add(String(ir.customerName));
    if (ir.droneId) drones.add(String(ir.droneId));
  });
  return {
    years: [...years].sort((a, b) => b - a),
    months: [...months].sort((a, b) => a - b),
    customers: [...customers].sort((a, b) => a.localeCompare(b)),
    drones: [...drones].sort((a, b) => a.localeCompare(b)),
    undated,
  };
}

// PURE. No fetch, no DOM, no clock — so a suite can drive it with fixtures, exactly
// like buildTimeline(). Returns counts only; the caller decides how to draw them.
function insightsSummary(irs, filters) {
  const all = Array.isArray(irs) ? irs : [];
  const f = filters || {};
  // Through the shared predicate, never a second copy of the six comparisons —
  // see insightsMatches for why the charts made that a correctness matter.
  const rows = all.filter(ir => insightsMatches(ir, f));

  const categories = {};
  IR_CATEGORIES.forEach(k => { categories[k] = 0; });
  const subcategories = {};
  REPAIR_SUBCATEGORIES.forEach(k => { subcategories[k] = 0; });
  const statuses = {};
  Object.keys(STATUS_CATEGORIES).forEach(k => { statuses[k] = 0; });

  let uncategorised = 0, repairUnset = 0, undated = 0;
  rows.forEach(ir => {
    // hasOwnProperty, not a truthiness test: an IR carrying a category that is no
    // longer on the list is uncategorised for every purpose the dashboard has.
    if (Object.prototype.hasOwnProperty.call(categories, ir.category)) categories[ir.category]++;
    else uncategorised++;
    if (ir.category === 'REPAIR') {
      if (Object.prototype.hasOwnProperty.call(subcategories, ir.subCategory)) subcategories[ir.subCategory]++;
      else repairUnset++;
    }
    statuses[statusCategory(ir.status)]++;
    if (irFiscalYear(ir.dateRaisedISO) === null) undated++;
  });

  return { total: all.length, matched: rows.length, undated,
           categories, uncategorised, subcategories, repairUnset, statuses };
}

// What the pane shows before the first fetch lands. A page of zeroes is not
// "loading" — it is an answer ("nothing was raised"), and it is the wrong one.
// Exported as a constant because it is ALSO the pane's static markup in
// index.html: the very first frame happens before fetchIRs() is even called, so the
// skeleton has to exist in the DOM before any script runs.
const INSIGHTS_SKELETON = `
  <div class="insights-skeleton"></div>
  <div class="insights-skeleton"></div>
  <div class="insights-skeleton"></div>`;

function insightsOpt(v, sel, label) {
  const value = String(v);
  return `<option value="${escHtml(value)}"${value === String(sel) ? ' selected' : ''}>${escHtml(label == null ? value : label)}</option>`;
}

// ─── THE ONE FILTER PREDICATE ────────────────────────────────────────────────
// Every number on the dashboard is counted from the rows this returns. It is a
// named function rather than a filter inline in insightsSummary() for one reason:
// the charts below were added later, and a second copy of these six comparisons
// is a second chance to get one of them wrong — at which point the bar chart
// disagrees with the total printed directly above it, and neither looks broken.
function insightsMatches(ir, filters) {
  const f = filters || {};
  if (!ir) return false;
  // String() on both sides: a select hands back a string, and a Set-derived
  // option list holds numbers. Comparing them raw would match nothing at all,
  // silently, for FY and Month only.
  if (f.fy !== INSIGHTS_ALL && String(irFiscalYear(ir.dateRaisedISO)) !== String(f.fy)) return false;
  if (f.month !== INSIGHTS_ALL && String(irMonthNumber(ir.dateRaisedISO)) !== String(f.month)) return false;
  if (f.status !== INSIGHTS_ALL && statusCategory(ir.status) !== f.status) return false;
  if (f.category !== INSIGHTS_ALL) {
    if (f.category === UNCATEGORISED) { if (ir.category) return false; }
    else if (ir.category !== f.category) return false;
  }
  if (f.customer !== INSIGHTS_ALL && String(ir.customerName || '') !== f.customer) return false;
  if (f.drone !== INSIGHTS_ALL && String(ir.droneId || '') !== f.drone) return false;
  return true;
}

// ─── WHAT THE CHARTS COUNT (Stage 3) ─────────────────────────────────────────

// PURE, and the same contract as insightsSummary(): rows in, counts out, no DOM,
// no clock, no fetch.
//
// `undated` is returned rather than folded into a month. A row whose date the app
// cannot read has to go SOMEWHERE or the bars quietly total less than the number
// printed above them; a thirteenth bucket that says so is the honest place, and
// the renderer always draws it.
function monthCounts(irs, filters) {
  const months = new Array(12).fill(0);
  let undated = 0;
  (Array.isArray(irs) ? irs : []).forEach(ir => {
    if (!insightsMatches(ir, filters)) return;
    const m = irMonthNumber(ir.dateRaisedISO);
    if (m === null) undated++; else months[m - 1]++;
  });
  return { months, undated, total: months.reduce((a, b) => a + b, 0) + undated };
}

// The point list for one SVG polyline over `values`, inside a w x h box. Pure
// geometry — no canvas, no DOM, no CSS variable read.
//
// The y axis is scaled to the LARGEST value in the series rather than to a fixed
// maximum: a series of 3s and 4s drawn against a notional 400 is a flat line on
// the floor, which is technically true and tells a reader nothing. Fewer than two
// points returns an empty string, because a "line" through one point is not a
// line and a polyline with no points draws nothing anyway.
function sparkPoints(values, w, h) {
  const v = (Array.isArray(values) ? values : []).map(n => (Number.isFinite(n) ? n : 0));
  if (v.length < 2) return '';
  const max = Math.max(1, ...v);
  const stepX = w / (v.length - 1);
  return v.map((n, i) =>
    (i * stepX).toFixed(2) + ',' + (h - (n / max) * h).toFixed(2)).join(' ');
}

// Who is holding work, and how much of it is late.
//
// TWO THINGS HERE ARE NOT OPTIONAL.
//
// First, it counts from the SAME filtered rows as everything else on the page, so
// the column of open counts can never sum to something other than the total above.
//
// Second, the Unassigned bucket is always present — the caller renders it whether
// or not it has rows, and the helper puts it in the list before it counts anything.
// A named person with no work is a fine row to omit, because the reader knows who
// they are and can see they hold nothing. The bucket that says "nobody owns these
// N" is not: it is the one line whose absence turns a gap in the data into a gap in
// the picture, and a reader who adds up the card gets a smaller number than the
// page prints and concludes the dashboard is broken.
const UNASSIGNED_KEY = '__unassigned__';

function assigneeCounts(irs, filters, now) {
  const map = new Map();
  (Array.isArray(irs) ? irs : []).forEach(ir => {
    if (!insightsMatches(ir, filters)) return;
    const name = String(ir.assigneeName || ir.assignee || '').trim();
    const key = name || UNASSIGNED_KEY;
    if (!map.has(key)) map.set(key, { key, name, total: 0, open: 0, late: 0 });
    const row = map.get(key);
    row.total++;
    const cat = statusCategory(ir.status);
    if (cat === 'open' || cat === 'paused') row.open++;
    if (irOverdue(ir, now)) row.late++;
  });
  // The Unassigned bucket is created HERE, before anything is counted, so it is
  // present with zero rows as well as with four hundred. Its absence is the one
  // that goes unnoticed: when every IR has a name the row would be empty anyway,
  // and when it is NOT empty its absence is a set of tickets that belong to
  // nobody and appear on no line of the card.
  if (!map.has(UNASSIGNED_KEY)) {
    map.set(UNASSIGNED_KEY, { key: UNASSIGNED_KEY, name: '', total: 0, open: 0, late: 0 });
  }
  const rows = [...map.values()].sort((a, b) =>
    (b.open - a.open) || (b.total - a.total) || a.name.localeCompare(b.name));
  // Pinned last, and that is a reading decision rather than a sorting one: a
  // bucket of names is a list of people, and a row that is not a person belongs at
  // the end of it rather than in the middle of the alphabet.
  const ui = rows.findIndex(r => r.key === UNASSIGNED_KEY);
  if (ui > -1) rows.push(rows.splice(ui, 1)[0]);
  return rows;
}

// Two letters for an avatar. Deliberately not a name-splitter: a single word
// gives its first two letters, and anything longer gives the first letter of the
// first and last words, which is what a two-initial avatar means everywhere else.
//
// A non-string returns nothing rather than `String(name)`. Everything that reaches
// here should already be text, but "should" is not a contract: `String(42)` is a
// perfectly good two-character string, and an avatar reading "42" is a bug that
// nobody would look for.
function initialsOf(name) {
  if (typeof name !== 'string') return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── AVATARS ────────────────────────────────────────────────────────────────
// The owner, 2026-10-08: *"In top right, in my login I can see it is written M, let us
// have something better, avatars without eyes, random avatars to each one of them can
// be given, gender neutral avatars so that you do not have to think about them if they
// are male of female."*
//
// Three decisions in that, and each one rules something out.
//
//   1. GEOMETRY, NOT A PICTURE. A head, a pair of shoulders, a cap — shapes, and no
//      face. A drawn person invites a judgement about who they are; a shape does not.
//      It is also what makes "gender neutral" a property of the drawing rather than a
//      promise about it: there is nothing in the mark to get wrong.
//   2. NOT AN INITIAL. The "M" he is looking at is Monish's, but it is also every other
//      Monish, every "M.", and every account whose name the app never learned — the
//      letter is a claim about a name that cannot always be made. `initialsOf` stays
//      where it is: the Overview's people list is a dense counts table and a two-letter
//      chip is the right size for it. This is the mark for a PERSON, not for a row.
//   3. DERIVED FROM THE ADDRESS, never from the row it is painted into. The same person
//      wears the same mark in the header and in a comment, and it does not shuffle when
//      a list re-sorts — an avatar that changed on every render reads as a different
//      person, which is worse than a letter.
//
// The fields are muted and mid-toned on purpose: the silhouette is white on the field,
// so contrast is a property of the mark itself and does not change with the theme. The
// avatar is the same in light, cream and dark, the way a photograph would be.
const AVATAR_FIELDS = [
  '#7a6a4f',  // olive
  '#5c6b73',  // slate
  '#6e5a7a',  // plum grey
  '#4f6e5a',  // moss
  '#8a5a44',  // terracotta
  '#50607a',  // denim slate
  '#7d6a3c',  // ochre
  '#5b5b5b',  // graphite
];

// FNV-1a, and `Math.imul` because the multiply has to stay in 32 bits. A plain
// `h * 16777619` overflows into a double and throws away the LOW bits — which are the
// bits the field index comes from, so the first few people would all land on one colour.
function avatarHash(seed) {
  const s = String(seed == null ? '' : seed).trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Three heads. Same silhouette, three proportions — none of them is a sex, an age or an
// ethnicity, which is the point.
const AVATAR_HEADS = [
  `<circle cx="16" cy="13.4" r="5.7"/>`,
  `<ellipse cx="16" cy="13.4" rx="4.9" ry="6.3"/>`,
  `<rect x="10.5" y="7.4" width="11" height="12" rx="4.6"/>`,
];
const AVATAR_SHOULDERS = [
  `<path d="M3.4 32c0-6.4 5.6-10.6 12.6-10.6S28.6 25.6 28.6 32z"/>`,
  `<path d="M5.2 32v-3.6c0-3.6 4.8-6.2 10.8-6.2s10.8 2.6 10.8 6.2V32z"/>`,
  `<path d="M7.4 32c0-5.8 3.8-9.4 8.6-9.4s8.6 3.6 8.6 9.4z"/>`,
];
// The cap is the SAME head shape again, larger and lifted, painted under the white one
// — so it is a rim on every head proportion rather than a hat that only fits one. Three
// sizes: none, a shallow rim, a taller one.
const AVATAR_CROWNS = [
  '',
  `<g transform="translate(0 -1.7) translate(16 13.4) scale(1.17) translate(-16 -13.4)">%S</g>`,
  `<g transform="translate(0 -2.8) translate(16 13.4) scale(1.24) translate(-16 -13.4)">%S</g>`,
];

// An inline SVG string, so a caller can drop it straight into a container's innerHTML.
// `seed` is the account's email wherever one is known — the address is the identity the
// whole app keys on — and falls back to a name only where there is no address.
function avatarSvg(seed) {
  const h     = avatarHash(seed);
  // One hash, four questions, each asked of DIFFERENT bits: independent enough for a
  // team of twenty, and there is no second hash to keep in step with the first.
  const field = AVATAR_FIELDS[h % AVATAR_FIELDS.length];
  const head  = AVATAR_HEADS[(h >>> 3) % AVATAR_HEADS.length];
  const sh    = AVATAR_SHOULDERS[(h >>> 7) % AVATAR_SHOULDERS.length];
  const crown = AVATAR_CROWNS[(h >>> 11) % AVATAR_CROWNS.length];
  const ink   = '#f7f4ee';
  const cap   = crown ? crown.replace('%S', `<g fill="${field}" opacity=".55">${head}</g>`) : '';
  return `<svg class="avatar-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">`
       + `<rect width="32" height="32" fill="${field}"/>`
       + cap
       + `<g fill="${ink}">${sh}${head}</g>`
       + `</svg>`;
}

// The month axis in three letters. MONTH_LABELS above is the long form the filter
// dropdown uses, where there is room for it; a chart column at 24px has room for
// three characters and no more.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// SYNCHRONOUS, IDEMPOTENT and safe with an empty list. Those three properties are
// what let four different callers use it with no sequence token: setAllIRs() (every
// fetch path, including the demo fallback and an in-page re-login), loadIRState()
// (the app-owned overlay, which lands after the list), refreshIRList() (the header
// Refresh) and showInsights() itself.
function renderInsights() {
  const body = document.getElementById('insights-body');
  if (!body) return;
  if (!allIRs.length) { body.innerHTML = INSIGHTS_SKELETON; return; }

  const fx = insightsFacets(allIRs);
  const f  = insightsFilters;

  // A filter whose value has left the data — a refetch without that customer, a
  // category CR has since cleared off every IR it applied to — is RESET rather than
  // kept. The select cannot show an option that no longer exists, so keeping the
  // value would leave the page reporting 0 matches with every dropdown reading
  // "All", which is the one failure a reader cannot diagnose from the screen.
  if (f.fy !== INSIGHTS_ALL && !fx.years.some(y => String(y) === String(f.fy))) f.fy = INSIGHTS_ALL;
  if (f.month !== INSIGHTS_ALL && !fx.months.some(m => String(m) === String(f.month))) f.month = INSIGHTS_ALL;
  if (f.customer !== INSIGHTS_ALL && !fx.customers.includes(f.customer)) f.customer = INSIGHTS_ALL;
  if (f.drone !== INSIGHTS_ALL && !fx.drones.includes(f.drone)) f.drone = INSIGHTS_ALL;

  const sum = insightsSummary(allIRs, f);
  const filtered = sum.matched !== sum.total;

  // Everything the charts draw comes from these, so they are computed ONCE per
  // render and shared. `now` is read once here rather than inside each helper,
  // because two calls a millisecond apart could otherwise disagree about whether
  // a ticket is on its limit — and a dashboard whose late count differs from its
  // own late row is a dashboard nobody trusts twice.
  const now      = Date.now();
  const mc       = monthCounts(allIRs, f);
  const people   = assigneeCounts(allIRs, f, now);
  const openNow  = people.reduce((a, r) => a + r.open, 0);
  const lateNow  = people.reduce((a, r) => a + r.late, 0);
  const maxMonth = Math.max(1, ...mc.months, mc.undated);
  const maxCat   = Math.max(1, ...IR_CATEGORIES.map(k => sum.categories[k]), sum.uncategorised);
  const mixTotal = SEGMENT_LABELS.filter(([k]) => k !== 'all')
    .reduce((a, [k]) => a + (sum.statuses[k] || 0), 0) || 1;

  const filterRow = (id, label, options) => `
    <label class="insights-filter"><span>${escHtml(label)}</span>
      <select class="form-input" id="${id}">${options}</select>
    </label>`;

  const statusOpts = SEGMENT_LABELS
    .map(([key, label]) => insightsOpt(key, f.status, key === 'all' ? 'All statuses' : label)).join('');

  body.innerHTML = `
    <div class="insights-filters">
      ${filterRow('ins-fy', 'Fiscal year',
        insightsOpt(INSIGHTS_ALL, f.fy, 'All years') +
        fx.years.map(y => insightsOpt(y, f.fy, 'FY ' + fyLabel(y))).join(''))}
      ${filterRow('ins-month', 'Month',
        insightsOpt(INSIGHTS_ALL, f.month, 'All months') +
        fx.months.map(m => insightsOpt(m, f.month, MONTH_LABELS[m - 1])).join(''))}
      ${filterRow('ins-status', 'Status', statusOpts)}
      ${filterRow('ins-category', 'Category',
        insightsOpt(INSIGHTS_ALL, f.category, 'All categories') +
        IR_CATEGORIES.map(k => insightsOpt(k, f.category, categoryLabel(k))).join('') +
        (sum.uncategorised || f.category === UNCATEGORISED
          ? insightsOpt(UNCATEGORISED, f.category, 'No category') : ''))}
      ${filterRow('ins-customer', 'Customer',
        insightsOpt(INSIGHTS_ALL, f.customer, 'All customers') +
        fx.customers.map(c => insightsOpt(c, f.customer)).join(''))}
      ${filterRow('ins-drone', 'Drone SN',
        insightsOpt(INSIGHTS_ALL, f.drone, 'All drones') +
        fx.drones.map(d => insightsOpt(d, f.drone)).join(''))}
      <button type="button" class="btn btn-sm btn-secondary" id="ins-clear"
              ${filtered ? '' : 'disabled'}>Clear filters</button>
    </div>

    <p class="insights-total">
      <strong>${sum.matched}</strong> of ${sum.total} IR${sum.total === 1 ? '' : 's'}
      ${filtered ? 'match these filters' : 'in the list'}.
      ${sum.undated ? `<span class="insights-note">${sum.undated} carry no readable date, so a year or month filter excludes them.</span>` : ''}
      ${_dataIsDemo ? `<span class="insights-note insights-demo">These numbers count the <strong>demo sample</strong>, not real IRs — the Sheet and the backend both refused to sync. Check the sync bar on the IR list before quoting any of this.</span>` : ''}
    </p>

    <!-- The stat row. Four tiles of the same size, and the last one is a
         SPARKLINE rather than a number, which is the one shape on this page that
         answers "which way is this going" instead of "how many".
         The polyline is a single inline SVG path computed by sparkPoints() — a
         real SVG element, not a canvas. That is not a preference: the app's one
         canvas painting hardcodes six hex values, because a canvas cannot read a
         CSS variable, so it is the one drawing surface in the app that would
         ignore all four palettes and both themes. -->
    <div class="insights-stats">
      <div class="insights-stat">
        <span class="insights-stat-n">${sum.matched}</span>
        <span class="insights-stat-label">${escHtml(t('insights.raised'))}</span>
      </div>
      <div class="insights-stat">
        <span class="insights-stat-n">${openNow}</span>
        <span class="insights-stat-label">${escHtml(t('insights.openNow'))}</span>
      </div>
      <div class="insights-stat${lateNow ? ' is-late' : ''}">
        <span class="insights-stat-n">${lateNow}</span>
        <span class="insights-stat-label">${escHtml(t('insights.lateNow'))}</span>
      </div>
      <div class="insights-stat insights-stat-spark">
        <svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none"
             role="img" aria-label="${escHtml(t('insights.perMonth'))}">
          <polyline points="${escHtml(sparkPoints(mc.months, 100, 28))}"
                    fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linejoin="round" stroke-linecap="round" />
        </svg>
        <span class="insights-stat-label">${escHtml(t('insights.perMonth'))}</span>
      </div>
    </div>

    <div class="insights-cards">
      ${IR_CATEGORIES.map(k => `
        <button type="button" class="insights-card${f.category === k ? ' active' : ''}" data-cat="${escHtml(k)}">
          <span class="insights-card-n">${sum.categories[k]}</span>
          <span class="insights-card-label">${escHtml(categoryLabel(k))}</span>
          <!-- The bar is scaled to the LARGEST category, not to the total: these
               four are alternatives, so the question a reader has is which of them
               dominates, and a share-of-total bar would leave all four short and
               hard to tell apart. It is decorative — the number beside it is the
               fact — so it is aria-hidden. -->
          <span class="insights-card-bar" aria-hidden="true">
            <span class="insights-card-bar-fill" style="width:${Math.round((sum.categories[k] / maxCat) * 100)}%"></span>
          </span>
        </button>`).join('')}
      ${sum.uncategorised ? `
        <button type="button" class="insights-card is-muted${f.category === UNCATEGORISED ? ' active' : ''}" data-cat="${escHtml(UNCATEGORISED)}">
          <span class="insights-card-n">${sum.uncategorised}</span>
          <span class="insights-card-label">${escHtml(t('insights.noCategory'))}</span>
          <span class="insights-card-bar" aria-hidden="true">
            <span class="insights-card-bar-fill" style="width:${Math.round((sum.uncategorised / maxCat) * 100)}%"></span>
          </span>
        </button>` : ''}
    </div>

    ${sum.categories.REPAIR ? `
      <div class="insights-block">
        <h3 class="insights-h">${escHtml(t('insights.repairBySub'))}</h3>
        <div class="insights-subcats">
          ${REPAIR_SUBCATEGORIES.map(k => `
            <span class="insights-subcat${k === REPAIR_OTHERS ? ' is-others' : ''}">
              ${escHtml(subCategoryLabel(k))}<span class="insights-subcat-n">${sum.subcategories[k]}</span>
            </span>`).join('')}
          ${sum.repairUnset ? `<span class="insights-subcat is-muted">Not set<span class="insights-subcat-n">${sum.repairUnset}</span></span>` : ''}
        </div>
        ${sum.subcategories[REPAIR_OTHERS] ? `
          <ul class="insights-others">
            ${allIRs.filter(ir => ir.category === 'REPAIR' && ir.subCategory === REPAIR_OTHERS)
              .slice(0, 12)
              .map(ir => `<li><strong>${escHtml(ir.irNumber)}</strong> — ${escHtml(ir.subCategoryNote || 'no note')}</li>`).join('')}
          </ul>` : ''}
      </div>` : ''}

    <div class="insights-block">
      <h3 class="insights-h">${escHtml(t('insights.raisedPerMonth'))}</h3>
      <!-- One column per calendar month, plus the undated bucket, which is drawn
           ALWAYS — even at zero, even when every row is dated. It is the one bar
           whose absence would make the chart silently disagree with the total
           printed at the top of the page, and a chart that does not add up is
           worse than a chart with an empty column in it. -->
      <div class="chart-bars">
        ${mc.months.map((n, i) => `
          <div class="chart-bar-col${n ? '' : ' is-zero'}" title="${escHtml(MONTH_LABELS[i] + ': ' + n)}">
            <span class="chart-bar-n">${n}</span>
            <span class="chart-bar-track"><span class="chart-bar" style="height:${Math.round((n / maxMonth) * 100)}%"></span></span>
            <span class="chart-bar-x">${escHtml(MONTH_ABBR[i])}</span>
          </div>`).join('')}
        <div class="chart-bar-col is-undated${mc.undated ? '' : ' is-zero'}" title="${escHtml(t('insights.undatedBucket') + ': ' + mc.undated)}">
          <span class="chart-bar-n">${mc.undated}</span>
          <span class="chart-bar-track"><span class="chart-bar" style="height:${Math.round((mc.undated / maxMonth) * 100)}%"></span></span>
          <!-- A dash, not the words. The axis is thirteen columns wide on a phone
               and the words "No date" do not fit one of them — but the column has
               to be HERE, in the axis, because that is what makes the bars add up
               to the total above them. The caption under the chart says what the
               dash means. -->
          <span class="chart-bar-x">—</span>
        </div>
      </div>
      <p class="chart-note">— = ${escHtml(t('insights.undatedBucket'))}</p>
    </div>

    <div class="insights-block">
      <h3 class="insights-h">${escHtml(t('insights.statusMix'))}</h3>
      <!-- One bar, four segments. The list of rows below it stays: the bar answers
           "what is the shape of this" and the rows answer "how many exactly", and
           a stacked bar alone makes a reader estimate a number the data knows. -->
      <div class="mix-bar" role="img"
           aria-label="${escHtml(SEGMENT_LABELS.filter(([k]) => k !== 'all')
             .map(([k, label]) => label + ' ' + (sum.statuses[k] || 0)).join(', '))}">
        ${SEGMENT_LABELS.filter(([k]) => k !== 'all' && sum.statuses[k]).map(([k, label]) => `
          <span class="mix-seg mix-${k}" style="width:${(sum.statuses[k] / mixTotal * 100).toFixed(2)}%"
                title="${escHtml(label + ': ' + sum.statuses[k])}"></span>`).join('')}
      </div>
      <div class="insights-mix">
        ${SEGMENT_LABELS.filter(([k]) => k !== 'all').map(([k, label]) => `
          <span class="insights-mix-row">
            <span class="${CATEGORY_BADGE[k]}">${escHtml(label)}</span>
            <span class="insights-mix-n">${sum.statuses[k] || 0}</span>
          </span>`).join('')}
      </div>
    </div>

    <div class="insights-block">
      <h3 class="insights-h">${escHtml(t('insights.people'))}</h3>
      <div class="people-head">
        <span class="people-head-name">${escHtml(t('insights.people'))}</span>
        <span class="people-head-n">${escHtml(t('insights.colOpen'))}</span>
        <span class="people-head-n">${escHtml(t('insights.colLate'))}</span>
      </div>
      <div class="people-list">
        ${people.map(p => `
          <div class="person-row${p.key === UNASSIGNED_KEY ? ' is-unassigned' : ''}">
            <span class="person-avatar" aria-hidden="true">${
              p.key === UNASSIGNED_KEY
                ? '?'
                : avatarSvg(p.key || p.name)
            }</span>
            <span class="person-name">${escHtml(p.name || t('insights.unassigned'))}</span>
            <span class="person-n">${p.open}</span>
            <span class="person-n${p.late ? ' is-late' : ''}">${p.late}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function showInsights() {
  currentView = 'insights';
  renderLayout();
  headerTitle.textContent = tFloor('nav.insights', 'Insights');
  // The pane renders from whatever is in memory; handleRoute() is what waits for
  // the list. Re-rendering here keeps a re-entry from showing a stale dashboard.
  renderInsights();
}

if (insightsView) {
  insightsView.addEventListener('change', e => {
    const id = e.target && e.target.id;
    const map = { 'ins-fy': 'fy', 'ins-month': 'month', 'ins-status': 'status',
                  'ins-category': 'category', 'ins-customer': 'customer', 'ins-drone': 'drone' };
    if (!map[id]) return;
    insightsFilters[map[id]] = e.target.value;
    renderInsights();
  });
  insightsView.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('.insights-card') : null;
    if (el) {
      // A card deep-links into the IR LIST, filtered to that category — the counts
      // are only useful if you can get from a number to the IRs behind it.
      setCategoryFilter(el.dataset.cat);
      goIndex();
      return;
    }
    if (e.target && e.target.id === 'ins-clear') {
      insightsFilters = { fy: INSIGHTS_ALL, month: INSIGHTS_ALL, status: INSIGHTS_ALL,
                          category: INSIGHTS_ALL, customer: INSIGHTS_ALL, drone: INSIGHTS_ALL };
      renderInsights();
    }
  });
}

// ─── LOG ANALYSER ─────────────────────────────────────────────────────────────
//
// ArduPilot DataFlash (.bin) flight logs, read by dataflash.js entirely in the
// browser. THE FILE IS NEVER UPLOADED. Only the derived report — a few KB — is
// kept, and only when the engineer pushes it into an IR. That is what makes a
// 100 MB log cost the Drive store nothing: its price is per OPERATION, and there
// is no operation.
//
// The markup is assembled from classes that already exist for other screens
// (.insights-card / .insights-h / .badge / .btn / .empty-state). That is
// deliberate, not laziness — the UI direction that wins the design review re-skins
// this screen along with everything else, instead of leaving a fourth thing to
// restyle. Nothing here invents a colour, a radius or a shadow.
const LOG_TARGET_KEY = 'ipassbook.log.target';

// One object, mutated in place, so the event handlers below and renderLog() can
// never disagree about what is on screen.
const logState = {
  target:    '',      // IR number the report will be pushed into
  model:     '',      // airframe the log is scored AS — see logRules()
  fileName:  '',
  fileSize:  0,
  progress:  0,
  busy:      false,
  report:    null,    // the DataFlash report, or null
  error:     '',
  openJump:  '',      // the parameter group a finding last jumped to
  pushed:    '',      // the IR the current report was last pushed into
};

// The target IR survives a reload — an engineer analysing three logs for the same
// ticket should not re-pick it three times. Wrapped because a private window
// throws on access rather than returning null.
try { logState.target = localStorage.getItem(LOG_TARGET_KEY) || ''; } catch (_) { /* private mode */ }
try { logState.model  = localStorage.getItem(LOG_MODEL_KEY)  || ''; } catch (_) { /* private mode */ }

// ── the limits a log is scored against ────────────────────────────────────────
//
// The analyser's numbers are Indrones' own operating data, so NONE of them is in
// dataflash.js — that file is served from the public site. They live in the
// private store at `__CONFIG__/analyser`: an admin edits them on the Log limits
// panel, and every signed-in user reads them to score a log.
//
// An EMPTY field is a decision, not a gap. The panel writes only the fields
// somebody actually filled in; a blank stays blank, so the built-in public figure
// applies where one exists (ArduPilot's vibration and HDop) and there is NO LIMIT
// where none does (current, motor spread, attitude). A blank must never quietly
// inherit a number nobody chose, and the safe reading of "we have not agreed a
// limit" is to show the log and not fail it — never to fail on an invented zero.
const ANALYSER_CONFIG_KEY = 'ipb_analyser_config';
const LOG_MODEL_KEY = 'ipassbook.log.model';

let analyserConfig = { profiles: {}, models: [] };
try {
  const raw = localStorage.getItem(ANALYSER_CONFIG_KEY);
  if (raw) analyserConfig = normaliseAnalyserConfig(JSON.parse(raw));
} catch (_) { /* private mode, or a value written by an older build */ }

// The store is a shared document that anyone could in principle have hand-edited,
// so every value that reaches the scorer is shape-checked here rather than trusted.
// A profile that fails the check is DROPPED, not repaired — a half-read limits table
// is worse than none, because it would score against numbers nobody typed.
function normaliseAnalyserConfig(saved) {
  const out = { profiles: {}, models: [] };
  if (!saved || typeof saved !== 'object') return out;
  const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;
  const KEY  = /^[A-Za-z0-9_]{1,40}$/;
  // `__default__` is the ONE reserved profile name — the layer every airframe
  // inherits from — and it is the reason this is a function rather than a bare
  // regex. It begins with an underscore, so the ordinary NAME test rejects it, and
  // using NAME alone would drop the shared default on every save while the scorer
  // and the panel both went on believing it was there. It is NOT a model, so it is
  // excluded from the picker below.
  const isName = n => n === '__default__' || NAME.test(n);
  const p = saved.profiles;
  if (p && typeof p === 'object') {
    Object.keys(p).forEach(name => {
      if (!isName(name)) return;
      const prof = p[name];
      if (!prof || typeof prof !== 'object') return;
      const clean = {};
      Object.keys(prof).forEach(k => {
        if (!KEY.test(k)) return;
        const v = prof[k];
        if (v === null || v === '') { clean[k] = null; return; }   // an explicit "no limit"
        if (typeof v === 'number' && isFinite(v)) clean[k] = v;
      });
      out.profiles[name] = clean;
    });
  }
  if (Array.isArray(saved.models)) {
    saved.models.forEach(m => { if (typeof m === 'string' && NAME.test(m)) out.models.push(m); });
  }
  // A profile that exists is a profile you can pick, whether or not the model list
  // remembers to mention it — the list is a convenience, the profiles are the truth.
  Object.keys(out.profiles).forEach(n => {
    if (n !== '__default__' && out.models.indexOf(n) < 0) out.models.push(n);
  });
  return out;
}

function applyAnalyserConfig(saved) {
  if (!saved || typeof saved !== 'object') return;
  analyserConfig = normaliseAnalyserConfig(saved);
  try { localStorage.setItem(ANALYSER_CONFIG_KEY, JSON.stringify(analyserConfig)); } catch (_) { /* private mode */ }
  renderLog();   // the pane names the profile it will score against
}

function saveAnalyserConfig() {
  if (!isAdmin()) { showToast('Only an admin can change the flight-log limits'); return; }
  try { localStorage.setItem(ANALYSER_CONFIG_KEY, JSON.stringify(analyserConfig)); } catch (_) { /* private mode */ }
  saveSentinel('__CONFIG__', 'analyser', analyserConfig)
    .then(r => showToast(r && r.status === 'ok'
      ? 'Flight-log limits saved'
      : 'Saved on this device only — the backend refused it. The latest backend has to be pasted for this to reach everyone.'));
}

// What the scorer should judge THIS log against. Undefined when the reader is
// missing or too old to know about profiles, which sends it to its own built-in
// defaults — never to a half-resolved table.
function logRules() {
  const DF = window.DataFlash;
  if (!DF || typeof DF.resolveRules !== 'function') return undefined;
  return DF.resolveRules(analyserConfig, logState.model || '');
}


// Verdict → the badge family the status pills already use. A PASS is not a status
// called "Open" — it only borrows the green, which is why the word is written out
// rather than being left to the colour.
const LOG_VERDICTS = {
  PASS:   { cls: 'badge-open',    word: 'Pass',   note: 'Nothing in the declared thresholds was crossed.' },
  REVIEW: { cls: 'badge-pending', word: 'Review', note: 'Something is worth a human looking at. This is not by itself proof of a fault.' },
  FAIL:   { cls: 'badge-danger',  word: 'Fail',   note: 'A physical or control limit was crossed.' },
};
const LOG_SEVERITIES = {
  fail:   { cls: 'badge-danger',  word: 'Fail' },
  review: { cls: 'badge-pending', word: 'Review' },
  info:   { cls: 'badge-open',    word: 'Info' },
};

const logVerdictInfo = v => LOG_VERDICTS[v] || LOG_VERDICTS.REVIEW;
const logSevInfo     = s => LOG_SEVERITIES[s] || LOG_SEVERITIES.info;

function logBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

// A flight log's clock. Minutes:seconds because a flight is minutes long, and the
// tenth is kept — a 500 ms saturation run is not findable at whole seconds.
function logClock(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
}

function logTodayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── the report, rendered ──────────────────────────────────────────────────────
//
// Shared by the analyser pane and the read-only field on a passbook, so the two
// can never drift into showing different things. `jump` is what separates them:
// only the pane gives the parameter groups element ids, because rendering those
// ids in the passbook too would put a second #log-group-RCOU in the same document.

function logFindingsHTML(report, jump) {
  const findings = report.findings || [];
  if (!findings.length) {
    return `<div class="insights-card"><div class="log-finding">
      <div class="log-finding-top"><span class="badge badge-open">No findings</span></div>
      <div class="log-finding-body">Nothing in the declared thresholds was crossed. That is the finding.</div>
    </div></div>`;
  }
  // Only a finding whose source message actually has a parameter group is
  // jumpable. A button that scrolls nowhere is worse than no button.
  const hasGroup = name => !!(name && (report.parameters || []).some(p => p.message === name));
  return findings.map(f => {
    const sev = logSevInfo(f.severity);
    const canJump = jump && hasGroup(f.message);
    const at = f.atSeconds == null ? '' :
      (canJump
        ? `<button type="button" class="log-at" data-jump="${escHtml(f.message)}" title="Show this message's numbers">${logClock(f.atSeconds)}</button>`
        : `<span class="log-at">${logClock(f.atSeconds)}</span>`);
    return `<div class="insights-card"><div class="log-finding">
      <div class="log-finding-top">
        <span class="badge ${sev.cls}">${sev.word}</span>
        <span class="log-finding-title">${escHtml(f.title)}</span>
        ${at}
      </div>
      <div class="log-finding-body">${escHtml(f.detail || '')}</div>
      ${f.message ? `<div class="log-note">Source: ${escHtml(f.message)}</div>` : ''}
    </div></div>`;
  }).join('');
}

function logParametersHTML(report, jump) {
  const params = report.parameters || [];
  if (!params.length) return '';
  const groups = new Map();
  params.forEach(p => {
    if (!groups.has(p.message)) groups.set(p.message, []);
    groups.get(p.message).push(p);
  });
  const rows = [...groups.entries()].map(([name, list]) => `
    <div class="log-group"${jump ? ` id="log-group-${escHtml(name)}"` : ''}>
      <h3 class="insights-h log-group-title">${escHtml(name)}</h3>
      <div class="log-scroll">
        <table class="log-table">
          <thead><tr><th>Column</th><th>Unit</th><th>N</th><th>Min</th><th>Max</th><th>Mean</th></tr></thead>
          <tbody>${list.map(p => `<tr>
            <td>${escHtml(p.column)}</td>
            <td>${escHtml(p.unit || '—')}</td>
            <td>${p.count}</td>
            <td>${p.min == null ? '—' : p.min}</td>
            <td>${p.max == null ? '—' : p.max}</td>
            <td>${p.mean == null ? '—' : p.mean}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`).join('');
  return `<div class="insights-block">
    <h3 class="insights-h">Every tracked parameter</h3>
    <div class="log-stack">${rows}</div>
  </div>`;
}

// ── the score ─────────────────────────────────────────────────────────────────
//
// The number this log scored, and the areas it was made from. Deliberately NOT a
// table — a phone table means sideways scrolling, which is the one thing this
// screen must not do — so each area is a row that wraps.
//
// The headline band is DERIVED from the areas, never from a threshold of its own:
// red if any area is red, amber if any is amber, green only when every area that
// was measured is green. That way the colour cannot disagree with the rows beneath
// it, and no pass/fail number has to be invented for a score that is a summary
// rather than a limit.
const LOG_BAND_CLS = { green: 'badge-open', amber: 'badge-pending', red: 'badge-danger' };

function logScoreHTML(report) {
  const s = report.score;
  if (!s || (s.total == null && !(s.parts || []).length)) return '';
  const parts = s.parts || [];
  const band = parts.some(p => p.band === 'red') ? 'red'
             : (parts.some(p => p.band === 'amber') ? 'amber' : 'green');
  const rows = parts.map(p => `
    <div class="log-score-row">
      <span class="badge ${LOG_BAND_CLS[p.band] || 'badge-open'}">${p.score}</span>
      <span class="log-score-label">${escHtml(p.label)}</span>
      <span class="log-score-detail">${escHtml(p.detail || '')}</span>
    </div>`).join('');

  const tick = (s.checklist || []).map(c => `
    <div class="log-score-row">
      <span class="badge badge-pending">Tick</span>
      <span class="log-score-label">${escHtml(c.label)}</span>
      <span class="log-score-detail">${escHtml(c.detail || '')}</span>
    </div>`).join('');

  const open = (s.open || []).map(o => `
    <div class="log-score-row">
      <span class="badge badge-open">Not scored</span>
      <span class="log-score-label">${escHtml(o.label)}</span>
      <span class="log-score-detail">${escHtml(o.detail || '')}</span>
    </div>`).join('');

  return `
    <div class="insights-block">
      <h3 class="insights-h">Score</h3>
      <div class="log-verdict">
        <span class="badge ${LOG_BAND_CLS[band]}">${s.total == null ? '—' : s.total}</span>
        <span class="log-verdict-n">${s.total == null ? 'Not scored' : s.total + ' / 100'}</span>
      </div>
      <p class="log-note">The plain average of the areas below that HAVE a limit — the same method the desktop analyser uses.${s.profile ? ` Judged against <b>${escHtml(s.profile)}</b>.` : ''}</p>
      <div class="log-stack">${rows}</div>
      ${tick ? `<h3 class="insights-h">Needs your tick</h3>${tick}` : ''}
      ${open ? `<h3 class="insights-h">Shown, not scored</h3>${open}` : ''}
    </div>`;
}

function logReportHTML(report, opts) {
  const jump = !!(opts && opts.jump);
  const v = logVerdictInfo(report.verdict);
  const m = report.meta || {};
  const duration = m.durationSeconds == null ? '—' : logClock(m.durationSeconds);
  return `
    <div class="insights-block">
      <div class="log-verdict">
        <span class="badge ${v.cls}">${v.word}</span>
        <span class="log-verdict-n">${v.word}</span>
        ${report.fileName ? `<span class="log-verdict-file">${escHtml(report.fileName)}${report.fileBytes ? ' · ' + logBytes(report.fileBytes) : ''}</span>` : ''}
      </div>
      <p class="log-note">${v.note}</p>
      <div class="log-meta">
        <span><b>Firmware</b> ${escHtml(m.firmware || 'not reported in this log')}</span>
        <span><b>Vehicle</b> ${escHtml(m.vehicle || '—')}</span>
        <span><b>Duration</b> ${duration}</span>
        <span><b>Frames</b> ${(m.frames || 0).toLocaleString()}</span>
        ${m.skippedBytes ? `<span><b>Unread bytes</b> ${m.skippedBytes}</span>` : ''}
        ${m.truncated ? '<span><b>Ends mid-frame</b> yes</span>' : ''}
      </div>
    </div>
    ${logScoreHTML(report)}
    <div class="insights-block">
      <h3 class="insights-h">Findings</h3>
      <div class="log-stack">${logFindingsHTML(report, jump)}</div>
    </div>
    ${logParametersHTML(report, jump)}`;
}

// ── what gets STORED ──────────────────────────────────────────────────────────
//
// The report above is the screen's shape; this is the passbook's. They differ on
// purpose: the passbook does not need every message's frame count, and trimming it
// here is what keeps the stored report at a few KB instead of growing with the log.

function logReportForStore(report, fileName, fileSize) {
  const m = report.meta || {};
  return {
    version: (window.DataFlash && window.DataFlash.VERSION) || '',
    pushedAt: new Date().toISOString(),
    file: fileName || '',
    fileBytes: fileSize || 0,
    verdict: report.verdict,
    // The score is the headline number, so it is stored with the report — a
    // passbook opened in a year should still say what this log scored and which
    // profile it was judged against, without re-reading the .bin.
    score: report.score || null,
    meta: {
      firmware: m.firmware || '',
      vehicle: m.vehicle || '',
      durationSeconds: m.durationSeconds == null ? null : m.durationSeconds,
      frames: m.frames || 0,
      skippedBytes: m.skippedBytes || 0,
      truncated: !!m.truncated,
      messages: (m.messages || []).slice(0, 12),
    },
    findings: (report.findings || []).map(f => ({
      severity: f.severity, title: f.title, atSeconds: f.atSeconds,
      detail: f.detail || '', message: f.message || null,
    })),
    parameters: report.parameters || [],
  };
}

// The prose half of the push. Short on purpose: the numbers are in the stored
// report, and this field is the engineer's own narrative — it is APPENDED to, never
// replaced, so a summary that restated every parameter would bury what they wrote.
function logSummaryText(report, fileName, fileSize, stamp) {
  const m = report.meta || {};
  const lines = [];
  lines.push('— Flight log analysis (' + stamp + ') —');
  lines.push('File: ' + (fileName || 'unnamed') + (fileSize ? ' (' + logBytes(fileSize) + ')' : '') +
             (m.firmware ? ' · ' + m.firmware : ''));
  lines.push('Verdict: ' + report.verdict);
  const findings = report.findings || [];
  if (!findings.length) {
    lines.push('No findings — nothing in the declared thresholds was crossed.');
  } else {
    findings.slice(0, 12).forEach(f => {
      lines.push('• [' + logSevInfo(f.severity).word + '] ' + f.title +
                 (f.atSeconds == null ? '' : ' at ' + logClock(f.atSeconds)));
    });
    if (findings.length > 12) lines.push('• …and ' + (findings.length - 12) + ' more, in the stored report above.');
  }
  lines.push('The stored report and the full parameter table are attached to this section as "Flight Log Analysis".');
  return lines.join('\n');
}

// ── the pane ──────────────────────────────────────────────────────────────────

// Which airframe this log is scored as. A .bin does not carry one, so it cannot be
// inferred — it has to be chosen, and choosing it is what turns the shared limits
// into THIS aircraft's limits. "Default" is the profile that applies when no model
// is picked, and it is always offered, because a log for an unnamed airframe still
// has to be scored against something.
function logModelSelectHTML() {
  const models = analyserConfig.models || [];
  const has = models.indexOf(logState.model) >= 0;
  const orphan = logState.model && !has
    ? `<option value="${escHtml(logState.model)}" selected>${escHtml(logState.model)} (no longer configured)</option>` : '';
  return `<select id="log-model" class="form-input" aria-label="Airframe this log is scored as">
      <option value=""${logState.model ? '' : ' selected'}>Default (all models)</option>
      ${orphan}
      ${models.map(m => `<option value="${escHtml(m)}"${m === logState.model ? ' selected' : ''}>${escHtml(m)}</option>`).join('')}
    </select>`;
}

// One line naming the profile, because a score with no profile beside it is a
// number nobody can check. Says which one, and says plainly when there is none.
function logProfileNoteHTML() {
  const r = logState.report;
  const p = r && r.score && r.score.profile ? r.score.profile : '';
  if (!p) return '';
  const airframe = r.score.airframe;
  return `<p class="log-note">Scored against <b>${escHtml(p)}</b>${airframe ? '' : ' — no airframe was chosen, so the shared profile applies'}.</p>`;
}

function logTargetSelectHTML() {
  const known = allIRs.some(ir => ir.irNumber === logState.target);
  // A remembered target that has since left the list still has to be SELECTABLE,
  // or the dropdown reads "Choose an IR…" while the push would use the remembered
  // one — the one failure the reader cannot diagnose from the screen.
  const orphan = logState.target && !known
    ? `<option value="${escHtml(logState.target)}" selected>${escHtml(logState.target)} (not in the list)</option>` : '';
  return `<select id="log-target" class="form-input" aria-label="IR to push the report into">
      <option value=""${logState.target ? '' : ' selected'}>Choose an IR…</option>
      ${orphan}
      ${allIRs.map(ir => `<option value="${escHtml(ir.irNumber)}"${ir.irNumber === logState.target ? ' selected' : ''}>${escHtml(ir.irNumber)} · ${escHtml(ir.droneId || 'no drone id')}</option>`).join('')}
    </select>`;
}

function renderLog() {
  const body = document.getElementById('log-body');
  if (!body) return;

  // The script tag is in index.html before app.js, so this only fires if THAT
  // failed to load — which is worth saying plainly rather than showing an empty
  // pane. Deliberately NO glyph: the emoji ledger in smoke-ui.mjs only goes down,
  // and a message this rare is not a reason to spend one.
  if (!window.DataFlash) {
    body.innerHTML = `<div class="empty-state">The flight-log reader did not load. Reload the app and try again.</div>`;
    return;
  }

  const r = logState.report;
  const parts = [];

  // 1 — the file. Picking one starts the read; there is no second "Analyse" tap.
  // The airframe sits ABOVE the file on purpose: the limits are applied during the
  // read, so a picker underneath the result would be a control that changes nothing
  // until the log is read a second time.
  parts.push(`<div class="insights-block">
    <h3 class="insights-h">Flight log (.bin)</h3>
    <div class="log-actions">
      <label class="log-note" for="log-model">Airframe</label>
      ${logModelSelectHTML()}
      ${isAdmin() ? `<button type="button" class="btn btn-ghost" id="log-limits">&#9881; Log limits</button>` : ''}
    </div>
    <div class="log-actions">
      <input type="file" id="log-file" accept=".bin,.BIN,application/octet-stream" />
      ${logState.fileName ? `<span class="log-verdict-file">${escHtml(logState.fileName)} · ${logBytes(logState.fileSize)}</span>` : ''}
      ${logState.fileName && !logState.busy ? `<button type="button" class="btn btn-ghost" id="log-clear">Clear</button>` : ''}
    </div>
    <p class="log-note">Read on this device. The .bin is never uploaded — only the report below is kept, and only if you push it into an IR.</p>
    <p class="log-note">A log does not say which aircraft it came from, so pick the airframe before reading it: that is what chooses the limits it is scored against.</p>
  </div>`);

  // 2 — progress. Only while reading, and only ever in place (see paintLogProgress).
  if (logState.busy) {
    parts.push(`<div class="insights-block">
      <div class="log-progress"><div style="width:${Math.round(logState.progress * 100)}%"></div></div>
      <p class="log-note">Reading… ${Math.round(logState.progress * 100)}%</p>
    </div>`);
  }

  // 3 — a rejection is a real answer, not a failure to hide.
  if (logState.error) {
    parts.push(`<div class="insights-block">
      <h3 class="insights-h">That file could not be read</h3>
      <p class="log-note">${escHtml(logState.error)}</p>
    </div>`);
  }

  // 4 — the report.
  if (r) {
    parts.push(logProfileNoteHTML());
    parts.push(logReportHTML(r, { jump: true }));
  }

  // 5 — the push. Beneath the verdict, because that is the decision it follows, and
  // it is the only thing here that WRITES.
  if (r && !logState.busy) {
    const canPush = canEditSection('sec-d');
    parts.push(`<div class="insights-block">
      <h3 class="insights-h">Push into an IR</h3>
      <div class="log-actions">
        ${logTargetSelectHTML()}
        <button type="button" class="btn" id="log-push"${canPush && logState.target ? '' : ' disabled'}>Push to IR</button>
      </div>
      <p class="log-note">${canPush
        ? 'Appends the summary to Section D → Description of Investigation (it never overwrites what is already written), stamps the Analysis Date if it is empty, and stores the full report on the section.'
        : 'You do not have edit rights on Section D, so the report cannot be pushed from this account.'}</p>
      ${logState.pushed ? `<p class="log-note">Pushed into <b>${escHtml(logState.pushed)}</b>. Open it to read the note that was written.</p>` : ''}
    </div>`);
  }

  body.innerHTML = `<div class="log-stack">${parts.join('')}</div>`;
}

// Progress repaints the BAR, not the pane. A re-render per chunk would rebuild the
// whole report markup — and, worse, throw away the file input's own state.
function paintLogProgress(p) {
  const bar = logView && logView.querySelector('.log-progress > div');
  if (bar) bar.style.width = Math.round(p * 100) + '%';
  const note = logView && logView.querySelector('.log-progress + .log-note');
  if (note) note.textContent = 'Reading… ' + Math.round(p * 100) + '%';
}

// The jump a finding's timestamp performs: to that message's own numbers, which is
// the next thing the reader wants and the only thing this screen can honestly
// offer. It flashes what it landed on and clears itself.
function jumpToLogGroup(name) {
  const el = document.getElementById('log-group-' + name);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('is-flash');
  void el.offsetWidth;               // restart the flash if it is already lit
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 1400);
}

async function analyseLogFile(file) {
  logState.fileName = file.name || '';
  logState.fileSize = file.size || 0;
  logState.busy = true;
  logState.progress = 0;
  logState.report = null;
  logState.error = '';
  logState.pushed = '';
  renderLog();

  try {
    // The airframe's limits are resolved ONCE, before the read, and handed to the
    // reader — so the numbers on screen were the ones in force when the log was
    // read, not whatever `logState.model` says by the time a re-render happens.
    const report = await window.DataFlash.analyseFile(file, p => {
      logState.progress = p;
      paintLogProgress(p);
    }, logRules());
    if (report && report.ok === false) {
      logState.error = report.error || 'The file could not be read.';
    } else {
      logState.report = report;
    }
  } catch (err) {
    logState.error = 'The log could not be read: ' + ((err && err.message) || String(err));
  }
  logState.busy = false;
  renderLog();
}

function resetLog() {
  logState.fileName = '';
  logState.fileSize = 0;
  logState.progress = 0;
  logState.busy = false;
  logState.report = null;
  logState.error = '';
  logState.pushed = '';
  const inp = document.getElementById('log-file');
  if (inp) inp.value = '';
  renderLog();
}

async function pushLogToIR() {
  const report = logState.report;
  const irNumber = logState.target;
  if (!report) { showToast('Analyse a log first.'); return; }
  if (!irNumber) { showToast('Choose the IR to push into.'); return; }
  if (!canEditSection('sec-d')) { showToast('You do not have edit rights on Section D.'); return; }
  if (logState.busy) return;

  logState.busy = true;
  renderLog();
  try {
    // Open the IR itself rather than writing behind the screen. The engineer sees
    // what landed in Section D, which is the only trustworthy confirmation of a
    // write. replaceState keeps the URL honest without firing a second hashchange
    // on top of the open done here.
    history.replaceState(null, '', '#/tickets/' + encodeURIComponent(irNumber));
    await openPassbook(irNumber);

    const stamp = logTodayISO();
    const ta = document.getElementById('d_investigation');
    if (ta) {
      const existing = (ta.value || '').replace(/\s+$/, '');
      const block = logSummaryText(report, logState.fileName, logState.fileSize, stamp);
      ta.value = existing ? existing + '\n\n' + block : block;
    }
    const dateEl = document.getElementById('d_analysisDate');
    if (dateEl && !dateEl.value) dateEl.value = stamp;

    // Hand the stored report to the section so collectSectionValues() carries it
    // through this save AND every later Section D save, instead of dropping it.
    currentSectionData['sec-d'] = currentSectionData['sec-d'] || {};
    currentSectionData['sec-d'].d_logAnalysis = logReportForStore(report, logState.fileName, logState.fileSize);

    await saveSection('sec-d', irNumber);
    logState.pushed = irNumber;
  } catch (err) {
    showToast('Could not push the report: ' + ((err && err.message) || String(err)));
  }
  logState.busy = false;
  renderLog();
}

// The read-only side: the report as it sits on a passbook. No ids, no jumps —
// see the note above logFindingsHTML.
function renderLogAnalysis(fieldId, value) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  if (!value || !value.verdict) {
    el.innerHTML = `<p class="log-note">No flight-log report has been pushed into this IR.</p>`;
    return;
  }
  const report = {
    verdict: value.verdict,
    meta: value.meta || {},
    findings: value.findings || [],
    parameters: value.parameters || [],
    fileName: value.file || '',
    fileBytes: value.fileBytes || 0,
  };
  const when = value.pushedAt ? String(value.pushedAt).slice(0, 10) : '';
  el.innerHTML = `${when ? `<p class="log-note">Pushed ${escHtml(when)}${value.version ? ' · reader v' + escHtml(value.version) : ''}</p>` : ''}
    ${logReportHTML(report, { jump: false })}`;
}

function showLog() {
  currentView = 'log';
  renderLayout();
  headerTitle.textContent = tFloor('nav.logAnalyser', 'Log Analyser');
  // Renders from whatever is in memory; handleRoute() is what waits for the IR
  // list. Re-rendering on every entry keeps a re-entry from showing a stale pane.
  renderLog();
}

// ─── HELP & FAQ (#/faq) ───────────────────────────────────────────────────────
// The answers live in faq-content.js and NOWHERE else. This function is one of the
// two renderers of that file; tools/build-faq.mjs is the other, and it regenerates
// the standalone faq.html that the sign-in screen still needs — a person who cannot
// get in must still be able to read why. Copying the text into either one is the
// failure this arrangement exists to prevent.
//
// It used to be a link out to faq.html in a new tab. The owner's words, 2026-10-08:
// "our FAQ page is opening in a new tab, that is not good for us. It has to be in our
// app, as per our UI and a part of our app."
//
// The question list is <details>, collapsed. Forty-six answers laid out flat is a
// scroll nobody finishes, and the first thing someone in trouble needs is to FIND
// their question, not to read past forty-five others. <details>/<summary> gives that
// for free: no script, keyboard-operable, and the browser's own find-in-page already
// opens a closed one.
// True once the pane has been filled from faq-content.js. The content cannot change
// while the page is open, so one build is the whole lifetime — see showFaq().
let faqBuilt = false;

function showFaq() {
  currentView = 'faq';
  renderLayout();
  headerTitle.textContent = tFloor('nav.help', 'Help & FAQ');
  // Built once and left standing. Unlike the dashboard and the analyser, nothing
  // here reads a store, an IR or the network, so there is no stale pane to refresh
  // and no reason to rebuild a document the user may have scrolled down — which
  // would also throw away which questions they had opened.
  if (!faqBuilt) renderFaq();
}

function renderFaq() {
  const body = document.getElementById('faq-body');
  if (!body) return;
  const C = window.FAQ_CONTENT;
  if (!C || !Array.isArray(C.sections) || !C.sections.length) {
    // Never a blank pane. If the content script failed to load, say which file is
    // missing and where it is meant to come from — the standalone page and this
    // view are fed by the same file, so the desk can check it in one place.
    body.innerHTML = `<div class="empty-state"><p class="empty-title">The Help &amp; FAQ content did not load.</p>
      <p class="empty-note">It is a single file, <code>faq-content.js</code>, loaded before the app. If you can read this, that file is missing from the deployment — it is built from this repository, not fetched.</p></div>`;
    return;
  }

  // The one link in the content that means something different in here. The footer's
  // "Back to I-PASSBOOK" is written as index.html because that is right on the
  // STANDALONE page — the one a signed-out person reads. Inside the app, index.html
  // would be a second copy of the app in another tab, which is the exact thing this
  // change removed, so it becomes the IR list by the router.
  //
  // Done as a STRING substitution on the way in, and not by fixing the attribute up
  // afterwards: the renderer has to be drivable without a live DOM, and post-hoc DOM
  // surgery is invisible to a test that reads the markup it produced.
  const faqInAppLinks = html => String(html).replace(/href="index\.html"/g, 'href="#/tickets"');

  // One block of an answer. `html` is authored in faq-content.js and carries only a
  // <strong> and one external link; callouts and lists are their own shapes.
  const blocksHTML = blocks => (blocks || []).map(b => {
    if (b.t === 'callout') {
      return `<aside class="faq-callout${b.ok ? ' is-ok' : ''}">
        ${b.ct ? `<span class="faq-callout-label">${escHtml(b.ct)}</span>` : ''}
        <p>${b.html}</p></aside>`;
    }
    if (b.t === 'ul') {
      return `<ul class="faq-list">${(b.items || []).map(li => `<li>${li}</li>`).join('')}</ul>`;
    }
    return `<p>${b.html}</p>`;
  }).join('');

  body.innerHTML = `
    <div class="faq-stack">
      <!-- A <div>, NOT a <header>, and that is not a style preference. base.css's
           topbar rule is "#workspace header" — a DESCENDANT selector, scoped that way
           after the landing page's own <header> silently became a white sticky 56px
           band. This pane lives inside #workspace, so a <header> here would inherit
           the same 56px band and the same clipped overflow. Measured, not guessed:
           the first build of this view rendered as exactly that. -->
      <div class="faq-head">
        <p class="faq-eyebrow">${escHtml(C.eyebrow || '')}</p>
        <h2 class="faq-title">${escHtml(C.title || 'Help & FAQ')}</h2>
        ${C.standfirst ? `<p class="faq-standfirst">${escHtml(C.standfirst)}</p>` : ''}
      </div>

      <nav class="faq-jump" aria-label="Jump to a section">
        ${(C.jump || []).map(j =>
          `<button type="button" class="faq-jump-item" data-faq-jump="${escHtml(j.id)}">${escHtml(j.title)}</button>`
        ).join('')}
      </nav>

      ${(C.sections || []).map(sec => `
        <section class="faq-section" id="faq-sec-${escHtml(sec.id)}">
          <h3 class="faq-section-title">${escHtml(sec.title)}</h3>
          ${(sec.items || []).map(item => `
            <details class="faq-q">
              <summary class="faq-q-label">${escHtml(item.q)}</summary>
              <div class="faq-a">${blocksHTML(item.blocks)}</div>
            </details>`).join('')}
        </section>`).join('')}

      ${(C.footer && C.footer.length) ? `<footer class="faq-foot">
        ${C.footer.map(p => `<p>${faqInAppLinks(p)}</p>`).join('')}
      </footer>` : ''}
    </div>`;

  faqBuilt = true;
}

if (faqView) {
  faqView.addEventListener('click', e => {
    const t = e.target;
    if (!t || !t.closest) return;
    const jump = t.closest('[data-faq-jump]');
    if (jump) jumpToFaqSection(jump.dataset.faqJump);
  });
}

function jumpToFaqSection(id) {
  const el = document.getElementById('faq-sec-' + id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('is-flash');
  void el.offsetWidth;               // restart the flash if it is already lit
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 1400);
}

if (logView) {
  logView.addEventListener('change', e => {
    const t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'log-target') {
      logState.target = t.value || '';
      try { localStorage.setItem(LOG_TARGET_KEY, logState.target); } catch (_) { /* private mode */ }
      renderLog();
      return;
    }
    if (t.id === 'log-model') {
      logState.model = t.value || '';
      try { localStorage.setItem(LOG_MODEL_KEY, logState.model); } catch (_) { /* private mode */ }
      // A report already on screen was scored against the OLD profile, so it is
      // discarded rather than left there wearing the new airframe's name. Saying
      // "read it again" is honest; re-scoring a stored report silently is not.
      if (logState.report) {
        resetLog();
        showToast('Airframe changed — pick the log again to score it against ' + (logState.model || 'the default profile'));
      } else {
        renderLog();
      }
      return;
    }
    if (t.id === 'log-file' && t.files && t.files[0]) analyseLogFile(t.files[0]);
  });
  logView.addEventListener('click', e => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#log-clear')) { resetLog(); return; }
    if (t.closest('#log-push')) { pushLogToIR(); return; }
    if (t.closest('#log-limits')) { openAnalyserLimitsModal(); return; }
    const at = t.closest('[data-jump]');
    if (at) jumpToLogGroup(at.dataset.jump);
  });
}

// ─── IR REPOSITORY ────────────────────────────────────────────────────────────
// The "Form Responses" tab is read through the BACKEND (action=listIRs), which
// returns it as a grid of displayed cell strings. It used to be read straight from
// Google Sheets as CSV over a URL that needed no login; that is gone, and the
// mapper below is what it fed, unchanged.
//
// See fetchIRsFromBackend() for why the read moved, and listIRs in backend.gs
// for why the wire carries a grid rather than finished records.

// 'DD MONTH YYYY' for display (full month name). Falls back to raw string.
function toDisplayDate(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val).trim();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// 'DD MONTH YYYY, HH:MM'. The Sheet's Timestamp carries the time the client
// raised the IR and the IR has never shown it — only the date. Falls back to
// the raw cell when unparseable, so nothing is ever rendered as NaN.
function toDisplayDateTime(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val).trim();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${toDisplayDate(val)}, ${hh}:${mm}`;
}

// Split "Who's Reporting?" (Col L) into a name and a phone number.
// Col L typically looks like "SREENIVAS PAI 7828148298" or "Monish Raza, 9424485787".
function splitNamePhone(text) {
  if (!text) return { name: '', phone: '' };
  const m = text.match(/(\+?\d[\d\s\-]{8,}\d)/);   // 10+ digit phone, optional +, spaces/dashes allowed
  if (m) {
    const phone = m[1].replace(/[\s\-]/g, '');
    const name = text.replace(m[1], '').replace(/[,&\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { name, phone };
  }
  return { name: text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(), phone: '' };
}

// ─── CLIENT INTAKE: the Sheet's columns ──────────────────────────────────────
// The client's Google Form is the front door and the Sheet it writes to is the
// immutable record of what they said. This table is the app's whole view of that
// record: one entry per column the Form is known to write, naming the IR record
// field it lands on and the header it is matched against. Headers are matched by
// SUBSTRING so a small rewording of a Form question does not break the map — and
// anything the Form writes that is NOT in this table is captured generically and
// surfaced on the intake view rather than silently dropped.
//
// `needle` omitted → the value is derived from another column, not read directly.
// Order here is the order the intake view renders, not the Sheet's column order.
const INTAKE_FIELDS = [
  { field: 'dateRaised',              needle: 'Timestamp',                    label: 'Raised on',                 kind: 'datetime' },
  { field: 'incidentDate',            needle: 'Date of Incident',             label: 'Date of incident',          kind: 'date' },
  { field: 'droneId',                 needle: 'Drone Serial No',              label: 'Drone serial no.',          kind: 'text' },
  { field: 'companyName',             needle: 'Where Do You Work',            label: 'Company',                   kind: 'text' },
  { field: 'customerName',            needle: "Who's Reporting",              label: 'Reported by',               kind: 'text' },
  { field: 'contactPhone',            derive: true,                           label: 'Contact phone',             kind: 'text' },
  { field: 'contactEmail',            needle: 'Email Address',                label: 'Email',                     kind: 'email' },
  { field: 'spoc',                    needle: 'SPOC',                         label: 'SPOC',                      kind: 'text' },
  { field: 'issueType',               needle: 'What Support',                 label: 'Support required',          kind: 'text' },
  { field: 'issueDesc',               needle: 'Please Describe',              label: 'Description',               kind: 'longtext' },
  { field: 'incidentLocationWeather', needle: 'Incident Location and Weather', label: 'Location and weather',     kind: 'longtext' },
  { field: 'evidenceFormN',           needle: 'Evidence: Attach Files From The Incident', label: 'Evidence — incident files', kind: 'links' },
  { field: 'evidenceFormQ',           needle: 'Evidence: Attach Screenshot of UAV Forecast', label: 'Evidence — UAV forecast',  kind: 'links' },
  { field: 'summaryLink',             needle: 'Summary',                      label: 'Summary document',          kind: 'raw' },
];

// Columns the app reads but does not list in the intake view: the IR number and
// the status are the IR's identity and its workflow, and priority is
// app-owned (Stage 1 triage) — the Form has no Priority question yet. Named here
// so the audit below does not report them as dropped.
const INTAKE_HIDDEN_NEEDLES = ['IR Number', 'Issue Status', 'Priority'];

// Header row → { field: columnIndex }, plus which columns the map consumed and
// which it did not. `unmapped` is the audit: backend.gs's column constants
// account for A–D, F–I, K–N and P–R, so a column at E, J or O — or anything the
// Form grows later — lands here instead of vanishing.
function buildIntakeMap(headers) {
  const idxOf = needle => headers.findIndex(h => h.includes(needle));
  const map = {};
  const consumed = new Set();
  INTAKE_FIELDS.forEach(f => {
    if (!f.needle) return;                 // derived — nothing to consume
    const i = idxOf(f.needle);
    map[f.field] = i;
    if (i >= 0) consumed.add(i);
  });
  INTAKE_HIDDEN_NEEDLES.forEach(n => {
    const i = idxOf(n);
    if (i >= 0) consumed.add(i);
  });
  const unmapped = [];
  headers.forEach((h, i) => { if (h && !consumed.has(i)) unmapped.push(h); });
  return { map, consumed, unmapped };
}

// The last header row read from the Sheet, so the intake view can name columns
// the Form writes that the app does not model. Refreshed on every sync.
let lastSheetAudit = { headers: [], unmapped: [], badIRRows: [] };

// A sheet grid (header row + data rows, as displayed) → IR records, latest first.
// Pure: no fetch and no DOM, so tools/smoke-intake.mjs can assert the whole
// mapping — including a reordered or extended header row — with neither.
//
// That purity is why the backend ships the raw grid rather than finished records:
// this function stays the ONE place that knows how a column becomes a field, so
// INTAKE_FIELDS below is not duplicated on the other side of the wire (see
// listIRs in backend.gs).
// The Sheet's IR Number column is free text a human types, so it is shape-checked
// before it becomes a card. Until 2026-10-06 there was NO check at all — only a
// blank test — and one row holding `IR0NA` rendered as a real ticket.
//
// The accepted shape is the crawler's (`eiIRs_` in email-index.gs), not the
// backend's stricter `/^IR\d+$/`. That is deliberate: a value like "IR 483" is a
// real ticket and must not vanish from the list, while the backend REFUSES TO
// WRITE it. Both facts get reported rather than one hiding behind the other.
//
// The value is never rewritten. It keys the store file (`seedIRState`), so
// normalising "IR 105" to "IR105" here would orphan every row already written
// under the old spelling — and the decision on this was explicit: CR walks the
// tickets by hand, nothing is migrated.
const IR_NUMBER_RE  = /^IR\s*-?\s*\d+$/i;   // what the crawler accepts
const IR_WRITABLE_RE = /^IR\d+$/;           // what the backend will write (assertRealIR)

// Rows the Sheet holds that never became a ticket, NAMED rather than dropped in
// silence: a ticket that disappears without a word is worse than one that looks
// odd, and the only fix is a human editing the Sheet.
function sheetGapNote() {
  const bad = lastSheetAudit.badIRRows || [];
  if (!bad.length) return '';
  const listed = bad.map(b => 'row ' + b.row + ' ("' + b.value + '")').join(', ');
  return `<p class="intake-audit">${bad.length} row${bad.length === 1 ? '' : 's'} in the Sheet ` +
    `could not be read as an IR number and ${bad.length === 1 ? 'is' : 'are'} not shown: ` +
    `${escHtml(listed)}.</p>`;
}

function mapSheetRows(rows) {
  const headers = (rows && rows[0] ? rows[0] : []).map(h => String(h).trim());
  const { map, consumed, unmapped } = buildIntakeMap(headers);
  lastSheetAudit = { headers, unmapped };

  const idxOf = needle => headers.findIndex(h => h.includes(needle));
  const iIrNo = idxOf('IR Number');
  const iStat = idxOf('Issue Status');
  // No `iPrio`: the Priority column is still ACCOUNTED FOR (INTAKE_HIDDEN_NEEDLES
  // consumes it so the audit stays quiet) but its value is deliberately not read.
  const cell = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');

  const records = [];
  const badIRRows = [];
  for (let r = 1; r < (rows ? rows.length : 0); r++) {
    const row = rows[r];
    if (!row) continue;
    const irNumber = cell(row, iIrNo);
    if (!irNumber) continue;
    if (!IR_NUMBER_RE.test(irNumber)) {
      badIRRows.push({ row: r + 1, value: irNumber, reason: 'not an IR number' });
      continue;                       // no card — but it is reported, not lost
    }
    if (!IR_WRITABLE_RE.test(irNumber)) {
      // Shown, because it is a real ticket; reported, because the app cannot save
      // to it until someone fixes the cell.
      badIRRows.push({ row: r + 1, value: irNumber, reason: 'not writable until the Sheet cell is fixed' });
    }

    const ts   = cell(row, map.dateRaised);
    const inc  = cell(row, map.incidentDate);
    const stat = cell(row, iStat) || 'Open';
    // Col L carries the name and the phone together ("SREENIVAS PAI 7828148298").
    const { name, phone } = splitNamePhone(cell(row, map.customerName));

    // The raw cell text for every ingested column, so the intake view shows
    // exactly what the Sheet holds — the typed fields below are the parsed
    // projection the rest of the app reads, and some of them (the Timestamp) are
    // lossy on purpose.
    const intake = {};
    INTAKE_FIELDS.forEach(f => { if (f.needle) intake[f.field] = cell(row, map[f.field]); });
    intake.customerName = name;     // the phone is split out of it…
    intake.contactPhone = phone;    // …onto its own row

    // Anything the Form writes that the table above does not model. Non-empty
    // values only: a column that exists but is blank for this IR would just
    // be noise on every card.
    const extra = [];
    headers.forEach((h, i) => {
      const v = cell(row, i);
      if (v && !consumed.has(i)) extra.push({ label: h, value: v });
    });

    records.push({
      irNumber,
      droneId:       cell(row, map.droneId),
      dateRaised:    toDisplayDate(ts),
      dateRaisedISO: toISODate(ts),
      // NO status off the Sheet — not even as a starting value. `status` is app-owned
      // and starts EMPTY here, and nothing fills it but the store, so a ticket nobody
      // has allotted reads Open (applyIRStateToAllIRs). The Sheet's Col D still travels,
      // one field over, as `initialStatus`: the customer's own report. It is CARRIED,
      // and that is all it does — nothing renders it today, and nothing branches on it
      // (this comment used to claim an "intake view" showed it; there is no such view).
      // Worth a small screen of its own later, so CR can read what the client wrote
      // without opening the Sheet; it is not one now.
      status:        '',
      summaryLink:   cell(row, map.summaryLink),
      customerName:  name,
      contactPhone:  phone,
      contactEmail:  cell(row, map.contactEmail),
      issueType:     cell(row, map.issueType),
      issueDesc:     cell(row, map.issueDesc),
      spoc:          cell(row, map.spoc),
      // NO priority off the Sheet either. The column is still consumed (see
      // INTAKE_HIDDEN_NEEDLES) so the intake audit does not report it as dropped,
      // but its value is not read: priority is app-owned, and it is set in Allot
      // CAPS. Leaving the Sheet as a second writer here while the status bridge was
      // cut would have been the same split-brain one field over.
      initialStatus: stat,
      incidentDate:  toISODate(inc),
      // Section A locked intake fields (sourced from the customer form, columns M/N/Q/R)
      incidentLocationWeather: cell(row, map.incidentLocationWeather),
      evidenceFormN:            cell(row, map.evidenceFormN),
      evidenceFormQ:            cell(row, map.evidenceFormQ),
      companyName:              cell(row, map.companyName),
      intake,
      extra,
    });
  }
  lastSheetAudit.badIRRows = badIRRows;
  return records.reverse();   // latest first
}

// The IR list, from the BACKEND. Token-gated, like every other read.
//
// This replaced an anonymous fetch of the sheet's own CSV (Google's gviz
// endpoint), and that is the whole point of the change. The gviz URL needed no
// login, so every row of the IR Repository — every customer's name, email, phone
// and problem description — was readable by anyone who could read app.js, which
// is any browser that opens the app. A client account could not have been safe
// while that door stood open, because hiding things on a screen hides nothing
// when the same data has a public URL.
//
// The wire carries the sheet's GRID, not finished records: mapSheetRows below
// stays the only thing that knows how a column becomes a field, so the
// header-substring table that makes the mapper robust to a reworded Form question
// is not duplicated on the backend. See listIRs in backend.gs.
async function fetchIRsFromBackend() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const res = await fetch(`${CONFIG.GAS_URL}?action=listIRs`, { signal: controller.signal });
  clearTimeout(timeout);
  const data = await res.json();
  if (!data || data.status !== 'ok') throw new Error((data && data.message) || 'listIRs failed');

  // TWO SHAPES ARE ACCEPTED, on purpose, for as long as it takes the new backend
  // to be pasted into BOTH deployments.
  //
  //   grid    — the sheet's own rows, mapped HERE by the one mapper. The new shape.
  //   records — the old, lossier record list: no `intake`, no `extra`, no
  //             `dateRaisedISO`, name and phone not split. Accepted deliberately,
  //             because this frontend ships BEFORE the backend is pasted, and
  //             without this branch that window would leave the live app showing an
  //             empty list. It is exactly what the app already showed as its
  //             outage fallback, so nothing gets worse than it already was.
  //
  // Delete the `records` branch once both deployments report the grid. `data.grid`
  // is tested for ARRAY-ness, not truthiness: an empty repository is a real answer
  // and must not fall through to the old branch.
  if (Array.isArray(data.grid))   return mapSheetRows(data.grid);
  if (Array.isArray(data.records)) return data.records;
  return [];
}

async function fetchIRs() {
  // Assumed live until a path proves otherwise. Set HERE, before any setAllIRs()
  // call, because setAllIRs() is what repaints the dashboard — a flag set after it
  // would arrive one render too late and leave the previous answer's warning up.
  // It is now also the first thing set, because the cache paint below calls
  // setAllIRs() before any network work has happened.
  _dataIsDemo = false;

  // 0. This device's last copy of the list, on screen before ANY network call. See
  //    readIRListCache(). The read below always replaces it, so it needs no
  //    invalidation anywhere — it can only ever be one round trip stale.
  const fromCache = paintCachedIRList();
  setSyncStatus(fromCache
    ? `⟳ Refreshing ${allIRs.length} IRs…`
    : '⟳ Syncing with the IR Repository…');

  // 1. The one list read there is.
  try {
    const records = await fetchIRsFromBackend();
    // An empty list is ACCEPTED, not treated as a failure. A repository with no
    // rows yet is a real state, and the old `records.length` guard turned it into
    // a silent fall-through to demo data — five invented tickets shown to someone
    // whose repository is genuinely empty.
    setAllIRs(records);
    writeIRListCache();
    _lastSyncAt = new Date();
    setSyncStatus(`✓ ${allIRs.length} IRs loaded`);
    renderIRList(allIRs);
    return;
  } catch (err) {
    // A REAL list is never replaced by fabricated cards. If a list is already on
    // screen — painted from this device's cache, or left by an earlier successful
    // sync — it stays, and the status line says exactly what happened. Showing five
    // sample IRs to someone who has four hundred real ones is not a placeholder,
    // it is misinformation, and they could act on it.
    if (fromCache || allIRs.length) {
      _dataIsDemo = false;
      setSyncStatus('⚠ Could not refresh — showing the last saved list');
      return;
    }
    setSyncStatus('⚠ Could not sync — showing demo data');
    // Demo mode: render sample cards so UI is visible. The flag exists for the
    // Insights page, which is the one screen where fabricated rows read as
    // statistics rather than as obviously-placeholder cards — a "CRASH: 2" built
    // from a sample is a number somebody could quote in a meeting. Reached only on
    // a COLD start with nothing real to show.
    _dataIsDemo = true;
    // The sample's STAGES go in the same place real ones live. They used to ride on
    // each record's own `status`, which no longer survives the merge — every sample
    // card would read Open and the board would show one column, which is how a demo
    // stops demonstrating anything. In memory only, never saved: nothing here is real.
    irState = getDemoIRState();
    setAllIRs(getDemoIRs());
    renderIRList(allIRs);
  }
}

// ─── THE IR LIST'S LOCAL COPY ────────────────────────────────────────────────
// The list is the first screen after sign-in and it used to be empty until the whole
// repository had come down — the wait the owner named directly. This device's last
// copy is painted instead, before any network call, and the refresh replaces it in
// the same round trip.
//
// It is ALSO what makes the failure path honest: see the catch in fetchIRs().
//
// The full record is stored, `intake` and `extra` included, because the cache is not
// only a list of cards — an IR opened while the backend is down is built from the
// cached record, and a trimmed copy would quietly empty its 📋 Report tab.
const IR_LIST_CACHE_KEY = 'ipb_ir_list';

// WHO the copy belongs to, appended to the key. Without this the copy was
// device-global, and that is not merely a staleness problem: this app has two kinds of
// account, and the backend narrows a customer's list to a single company. On a shared
// machine, a customer signing in after a staff member would be painted that staff
// member's whole repository — every company's IRs — for as long as the first round trip
// took, with the customer's own scoped answer only replacing it afterwards. Scoping the
// key costs nothing and makes that impossible rather than brief.
//
// The email is read from the stored profile, which is written at sign-in and is one of
// the two keys `hasStoredSession()` requires, so it is known before any network call and
// before the paint this key exists to serve. With no profile there is no identity, and
// no identity means no cache — a null key disables both the read and the write rather
// than falling back to a shared one.
function irListCacheKey() {
  const u = loadStoredUser();
  const who = u && u.email ? String(u.email).trim().toLowerCase() : '';
  return who ? IR_LIST_CACHE_KEY + ':' + who : null;
}

function readIRListCache() {
  try {
    const key = irListCacheKey();
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.records) || !c.records.length) return null;
    return c.records;
  } catch { return null; }
}

function writeIRListCache() {
  try {
    const key = irListCacheKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), records: allIRs }));
  } catch { /* non-fatal: a full quota must never break a sync that succeeded */ }
}

// Paint the last copy, but only when the screen has nothing yet — a manual refresh
// of a list already on screen must not flash stale cards over fresh ones.
// Returns true when a real list is showing, which is what the failure branch needs
// to know before it decides whether demo data would be a lie.
function paintCachedIRList() {
  if (allIRs.length) return false;
  const records = readIRListCache();
  if (!records) return false;
  setAllIRs(records);
  renderIRList(allIRs);
  return true;
}

// Manual re-read of the IR list + app-owned state. Staff should never have
// to wonder whether what they are looking at is stale — this is the answer.
let _refreshing = false;
async function refreshIRList() {
  if (_refreshing) return;
  _refreshing = true;
  try {
    await fetchIRs();
    await loadIRState();
    // A IR can be open while the list refreshes. Adopt the freshly-read
    // record so the banner and the client report stop showing stale Sheet data —
    // app-owned fields are already merged onto it by setAllIRs(). If the IR
    // is gone from the Sheet, the open record is kept rather than blanked.
    if (currentView === 'detail' && currentIR?.irNumber) {
      const fresh = allIRs.find(x => x.irNumber === currentIR.irNumber);
      if (fresh) {
        currentIR = fresh;
        renderBannerMeta();
        renderIntake();
      }
    }
  } finally {
    _refreshing = false;
  }
}

// The list's sync line: the last status message, when the data was actually
// fetched, and a manual refresh. Silent staleness is what drives people back to
// the Sheet, so this is deliberately always visible.
let _syncMsg = '';
let _lastSyncAt = null;
function setSyncStatus(msg) {
  _syncMsg = msg;
  renderSyncBar();
}
function renderSyncBar() {
  if (!syncStatus) return;
  const t = _lastSyncAt
    ? _lastSyncAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'not yet';
  syncStatus.innerHTML =
    `<span class="sync-msg">${escHtml(_syncMsg)}</span>` +
    `<span class="sync-meta">Synced ${escHtml(t)}</span>` +
    `<button type="button" class="sync-refresh" onclick="refreshIRList()" title="Re-read the IR list from the Sheet">↻ Refresh</button>`;
}

// ─── LEGACY I-PASSBOOK (pre-app records, ~IR310–IR441) ───────────────────────
// Loads the INDEX of legacy per-IR tabs (token-gated via the backend) so the master
// list can badge legacy IRs and the detail view can open a record read-only. The
// index is tab names only — a record's content is fetched one at a time, when it is
// actually opened (getLegacyIR). Best-effort: failures just skip legacy.
async function loadLegacyIndex() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${CONFIG.GAS_URL}?action=listLegacyIRs`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status === 'ok' && Array.isArray(data.records)) {
      legacyMap = {};
      data.records.forEach(r => { if (r.irNumber) legacyMap[r.irNumber] = r; });
      mergeLegacyOnlyIRs();
      renderIRList(allIRs);   // re-render to apply Legacy badges / appended cards
      if (Object.keys(legacyMap).length) {
        showToast(`🏛 Legacy archive linked — ${Object.keys(legacyMap).length} IRs`);
      }
    } else {
      // Surface the real reason. "Unauthorized" = the session expired; the user
      // should sign in again from the user menu. Anything else is a backend error
      // (e.g. the deployer can't open the legacy sheet) — show it verbatim.
      var msg = (data.message || 'unknown error').toLowerCase();
      if (msg.indexOf('unauthorized') === 0) {
        showToast('Legacy archive needs a sign-in — sign out and sign back in');
      } else {
        showToast('Legacy archive error: ' + (data.message || 'unknown'));
      }
    }
  } catch { /* legacy unavailable — non-fatal */ }
}

// Append legacy IRs that aren't already in the master list (very old IRs not in
// the Form Responses tab) so they're still reachable from the app.
function mergeLegacyOnlyIRs() {
  Object.values(legacyMap).forEach(l => {
    if (!allIRs.some(ir => ir.irNumber === l.irNumber)) {
      const drone = (l.label || '').split('|')[1]?.trim() || '';
      allIRs.push({ irNumber: l.irNumber, droneId: drone, dateRaised: '', status: 'Open', isLegacyOnly: true });
    }
  });
  // The stubs are pushed AFTER setAllIRs() has already merged app-owned state
  // into the records it was given, so without this a legacy IR that HAS been
  // triaged in the app renders as untouched: no assignee, no category, and —
  // with Stage 3's count on the card — "0/6" over a ticket with saved sections.
  // This is the same single merge, applied to the records it missed.
  applyIRStateToAllIRs();
  // keep latest-first ordering by IR number
  allIRs.sort((a, b) => parseInt((b.irNumber || '').replace(/\D/g, ''), 10) - parseInt((a.irNumber || '').replace(/\D/g, ''), 10));
}

function renderIRList(records) {
  renderSegments();
  renderCategorySegments();
  if (!records || records.length === 0) {
    irList.innerHTML = sheetGapNote() + (allIRs.length
      ? '<div class="empty-state"><span>🔍</span>' + escHtml(t('list.emptyFiltered')) + '</div>'
      : '<div class="empty-state"><span>📭</span>' + escHtml(t('list.emptyNone')) + '</div>');
    updateListCounts(0);
    return;
  }

  irList.innerHTML = sheetGapNote() + records.map(ir => {
    const owner = ir.assigneeName || ir.assignee || '';
    // Stage 3 and Stage 4, read off the merged record. Both are no-ops when the
    // data cannot support them — an IR with no saved sections and no clock
    // renders exactly the card it rendered before they existed.
    const prog = sectionProgress(ir.done);
    const age  = irAge(ir);
    const late = irOverdue(ir);
    const showProg = wantProgress(ir, prog);
    // Everything below is escaped, and that is load-bearing rather than tidy:
    // `droneId` is Form Responses column K, written by whoever submits the public
    // customer form, and `status`/`priority` can be rewritten by any signed-in user
    // through the `__IRS__` sentinel store. Before this, an unauthenticated
    // attacker could put an `onerror` payload in the serial field and steal the
    // admin's session token the moment the list rendered.
    const sumUrl = safeUrl(ir.summaryLink);
    const isLegacy = !!legacyMap[ir.irNumber];
    // Everything this row cannot hold, assembled ONCE for the hover line. The
    // owner's rule for this tile: "any additional info if coming in that tile
    // should either find its place adequately without disturbing other elements
    // and professional appearance or else show when hovered above it or both."
    // So the row shows what a list row is FOR, and this line shows the rest.
    // Built here rather than left to CSS so the two cannot disagree about what
    // exists — a chip removed from the row cannot silently vanish from the hover.
    const hoverBits = [
      owner ? `Assigned to ${escHtml(owner)}` : '',
      isLegacy ? 'Legacy record' : '',
      ir.priority ? escHtml(priorityLabel(ir.priority)) : '',
      ir.droneId ? escHtml(ir.droneId) : '',
      ir.category ? escHtml(categoryLabel(ir.category)) : '',
      ir.subCategory ? escHtml(subCategoryLabel(ir.subCategory)) : '',
      ir.dateRaised ? escHtml(ir.dateRaised) : '',
      age ? escHtml(ageLabel(age)) + (late ? ' · overdue' : '') : '',
    ].filter(Boolean).join(' · ');
    return `
    <div class="ir-card animate-slide-up${currentView === 'detail' && currentIR?.irNumber === ir.irNumber ? ' is-selected' : ''}" data-id="${escJsAttr(ir.irNumber)}" onclick="goTicket('${escJsAttr(ir.irNumber)}')">
      <div class="ir-card-main">
        <div class="ir-title-row">
          <span class="ir-title">${escHtml(ir.irNumber)}</span>
          ${owner ? `<span class="ir-assignee" title="Assigned to ${escHtml(owner)}">${escHtml(owner)}</span>` : ''}
        </div>
        <div class="ir-meta">
          <span class="ir-sn">${escHtml(ir.droneId || '')}</span>
          ${ir.category ? `<span class="ir-dot">·</span><span class="ir-cat">${escHtml(categoryLabel(ir.category))}</span>` : ''}
          ${ir.subCategory ? `<span class="ir-dot">·</span><span class="ir-cat">${escHtml(subCategoryLabel(ir.subCategory))}</span>` : ''}
          ${ir.dateRaised ? `<span class="ir-dot">·</span><span class="ir-date">${escHtml(ir.dateRaised)}</span>` : ''}
          ${age ? `<span class="ir-dot">·</span><span class="ir-age${late ? ' is-late' : ''}" title="${escHtml(ageTitle(ir, age))}">${escHtml(ageLabel(age))}</span>` : ''}
        </div>
        <div class="ir-card-hover">
          <span class="ir-hover-text">${hoverBits}</span>
          ${sumUrl ? `<a href="${escHtml(sumUrl)}" class="ir-summary-link" onclick="event.stopPropagation()" target="_blank" rel="noopener">View Summary ↗</a>` : ''}
        </div>
      </div>
      <div class="ir-card-side">
        ${ir.priority ? `<span class="prio prio-${escHtml(String(ir.priority).toLowerCase().replace(/[^a-z0-9_-]/g, ''))}">${escHtml(priorityLabel(ir.priority))}</span>` : ''}
        <span class="${getBadgeClass(ir.status)}">${escHtml(statusLabel(ir.status))}</span>
        ${late ? `<span class="badge badge-danger" title="${escHtml(overdueTitle(ir, late))}">Overdue</span>` : ''}
        ${showProg ? progressChip(prog) : ''}
      </div>
    </div>
  `;
  }).join('');
  updateListCounts(records.length);
}

// The completion chip, shared by the list card and the ticket header so the two
// cannot render it differently. The fill width is a CLASS, never an inline
// style: the list card is asserted to carry no attribute the renderer did not
// write (smoke-intake.mjs), and a `style=` on it would break that contract for
// a value that only ever has seven states.
function progressChip(prog) {
  const complete = prog.done >= prog.total;
  const title = complete
    ? `All ${prog.total} sections saved`
    : `${prog.done} of ${prog.total} sections saved`;
  return `<span class="ir-progress p${prog.done}${complete ? ' is-complete' : ''}" title="${escHtml(title)}">` +
         `<span class="ir-progress-bar"></span>` +
         `<span class="ir-progress-text">${prog.done}/${prog.total}</span>` +
         `</span>`;
}

// Whether this ticket gets a completion chip at all. A legacy-only record is a
// historic entry with no passbook of its own, so "0/6" over one would read as
// work outstanding on a ticket nobody is working — but if a legacy IR HAS saved
// sections (someone opened it and filled a form in), the count is real and is
// shown.
function wantProgress(ir, prog) {
  return !(ir && ir.isLegacyOnly && prog.done === 0);
}

// The banner's version of that count: ONE SEGMENT PER SECTION rather than a
// filled bar, because the question in this banner is not "how much" but "which" —
// the six segments are exactly the six tabs directly below, and a person reading
// this is deciding which one to open next.
//
// NEVER the word "complete", on the segments or in the tooltip. `done[]` means a
// section has been SAVED, not filled in, and it is monotonic — a section stays
// saved once saved, even if it is later emptied. Calling that "complete" would
// tell someone a job is finished on the strength of an empty form they once
// pressed Save on. The chip on the list row keeps its own shape; this is the
// banner's.
function progressSteps(ir, prog) {
  const doneIds = Array.isArray(ir && ir.done) ? ir.done : [];
  const label = t('overview.sectionsSaved', { n: prog.done, m: prog.total });
  return `<span class="progress-steps" title="${escHtml(label)}" role="img" aria-label="${escHtml(label)}">` +
    SECTION_IDS.map(id => `<span class="progress-step${doneIds.includes(id) ? ' is-done' : ''}"></span>`).join('') +
    `</span><span class="progress-steps-text">${escHtml(label)}</span>`;
}

// ─── THE IR BOARD ────────────────────────────────────────────────────────────
// The list's rows, drawn as columns. The board adds NO field and needs NO
// migration: an IR already carries a 14-value workflow `status`, written by Triage
// and by nothing else — which is exactly why the columns can be the app's own
// stages rather than a second vocabulary that would drift from the ticket.
//
// NINE columns, not six. The six section columns are the sections a person works
// in; the two at the start and the one at the end hold the statuses that name no
// section at all. Without them those IRs would be in no column — the one failure a
// reader could never see, because a card that is simply nowhere looks like a card
// that does not exist. The union of every `stages` array below is the TEN of
// IR_STATUS_VALUES, each value once, plus the retired 'Other' — which is not one of
// the ten and still has to sit somewhere, because old tickets hold it and a card in
// no column is invisible. `smoke-board.mjs` asserts both halves: every one of the
// ten is placed exactly once, and EVERY value the app can be handed — one of the
// ten or one of the eight retired words or 'Other' — lands in exactly one column.
//
// The headings are the app's OWN short names (SECTION_SHORT), so the column a card
// sits in and the tab it lives on say the same words.
const BOARD_COLUMNS = [
  { key: 'start', title: t('board.notStarted'),         stages: ['Open', 'Remote Support'] },
  { key: 'hold',  title: t('board.paused'),             stages: ['On Hold'] },
  { key: 'B', title: 'B · ' + SECTION_SHORT['sec-b'],   stages: ['Inward'] },
  { key: 'C', title: 'C · ' + SECTION_SHORT['sec-c'],   stages: ['Inspection'] },
  { key: 'D', title: 'D · ' + SECTION_SHORT['sec-d'],   stages: ['Investigation'] },
  { key: 'E', title: 'E · ' + SECTION_SHORT['sec-e'],   stages: ['Production'] },
  { key: 'F', title: 'F · ' + SECTION_SHORT['sec-f'],   stages: ['Quality Test'] },
  { key: 'G', title: 'G · ' + SECTION_SHORT['sec-g'],   stages: ['PDI/Dispatch'] },
  { key: 'done', title: t('board.finished'),            stages: ['Delivered', 'Other'], quiet: true },
];

// Which column a status belongs in. Pure: same input, same answer, no DOM, no
// clock. Canonicalised FIRST, so the eight retired words place a card by the stage
// they mean now — a ticket the Sheet called 'QC Investigation' belongs in D, not in
// a column of its own that no longer exists.
//
// An unrecognised value lands in 'start' rather than disappearing — the board may
// never lose an IR, not even one hand-edited in the store.
function boardColumnOf(status) {
  const s = canonicalStage(status).toLowerCase();
  const col = BOARD_COLUMNS.find(c => c.stages.some(v => v.toLowerCase() === s));
  return col ? col.key : 'start';
}

// A section column (B–G) owns exactly one app status, and that single fact is what
// the "move it on?" offer after a close compares against. Returns null for the two
// end-of-line columns, which own several statuses and so have no single next step.
function boardColumnOwns(key) {
  const col = BOARD_COLUMNS.find(c => c.key === key);
  return col && col.stages.length === 1 ? col.stages[0] : null;
}
// The section→letter map already exists as SECTION_LABELS, defined with the access
// grids. A second copy here would be a literal that smoke-preview.mjs's
// SECTION_SHORT scan picks up and mistakes for a section's display name.

// ─── MOVING A CARD ON, BY HAND ────────────────────────────────────────────────
// The board is read-only, and that is the whole design: a section save must never
// move the workflow clock (see syncIRStateAfterSectionSave — someone tried the
// automatic version and removed it). But when a section IS closed and the IR is
// still sitting on that section's status, the honest next step is one press away —
// and it is the PRESS, not the close, that stamps `statusAt`.
//
// The offer is made only where the answer is unambiguous, which is why it hangs off
// boardColumnOwns(). The two end columns own several statuses between them, so there
// is no single "next" there and none is offered; Triage still covers them, unchanged,
// and Triage covers everything else too — so an offer that never appears costs
// nothing. It is never the only way to move a card.
function boardNextColumn(key) {
  const i = BOARD_COLUMNS.findIndex(c => c.key === key);
  if (i < 0 || i >= BOARD_COLUMNS.length - 1) return null;
  const next = BOARD_COLUMNS[i + 1];
  // A section column is named by its letter, because that is how the tab is named.
  // The two end columns have no letter, so they are named by their heading.
  const isSection = SECTION_IDS.some(id => SECTION_LABELS[id] === next.key);
  return { label: isSection ? next.key : next.title, stage: next.stages[0] };
}

// Paint — or clear — the offer in every section's close row. It is rebuilt on each
// paint rather than toggled in place, because the target moves with the status:
// after one press this section's button goes and the next section's appears.
function paintBoardMoveOffer(irNumber) {
  const row     = irState[irNumber] || {};
  const colKey  = boardColumnOf(String(row.status || 'Open'));
  const done    = Array.isArray(row.done) ? row.done : [];
  // The section whose own stage the IR is sitting on. null for Not started, Paused
  // and Finished, which are not sections.
  const owner   = SECTION_IDS.find(id => SECTION_LABELS[id] === colKey) || null;
  const next    = owner ? boardNextColumn(colKey) : null;

  SECTION_IDS.forEach(secId => {
    const holder = document.querySelector('#' + secId + ' .sec-close-row');
    if (!holder) return;
    let btn = holder.querySelector('.btn-move-on');
    // Only the section that owns the current stage is offered, and only once its own
    // work is actually closed — an offer to move on from a section nobody finished
    // would be the app volunteering a claim about work that has not happened.
    if (secId !== owner || !next || !done.includes(secId)) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      // A ghost, deliberately: this is an offer, not the next step of the form, and
      // it must not compete with the Close button beside it.
      btn.className = 'btn btn-ghost btn-move-on';
      btn.dataset.section = secId;
      holder.appendChild(btn);
    }
    btn.innerHTML = escHtml(t('move.to', { column: next.label }));
    btn.title = t('move.hint', { stage: next.stage });
    btn.onclick = () => moveOnByHand(irNumber, next.stage);
  });
}

// The one place a section press writes the workflow status, and the only thing in
// this file outside Triage that stamps `statusAt` — which is what "in status 3d" and
// every overdue limit are measured from, so it is never done on the user's behalf.
//
// NO success toast on purpose. patchIRState already says so when the write did not
// reach the backend, and the toast contract is that one message REPLACES another —
// so a cheerful "Moved to E" here would wipe the one warning the user must not miss.
// The evidence is on screen anyway: the status pill changes as the patch lands, and
// the movement is on the timeline.
async function moveOnByHand(irNumber, stage) {
  // The ticket's stage, not its stored word: a ticket held as 'QC Investigation'
  // IS 'Investigation', and moving it on to Investigation is not a movement.
  const cur = canonicalStage((irState[irNumber] || {}).status);
  if (!stage || cur === stage) return;      // never re-stamp a clock for no movement
  await patchIRState(irNumber, {
    status: stage,
    statusOwned: true,
    statusAt: Date.now(),
    statusBy: myEmail() || 'unknown',
  });
  loadActivityLog(irNumber);
}

// How many cards a column draws before it stops and says how many it left behind.
// `Finished` holds most of the archive — every delivered IR ever — and drawing
// those as cards would make the board slower than the list it is a second view of.
// The header counts are the FULL counts, so the column itself never lies about
// what it is holding; only the drawing is capped.
const BOARD_CAP = 25;

function boardCard(ir) {
  const owner = ir.assigneeName || ir.assignee || '';
  const prog  = sectionProgress(ir.done);
  const age   = irAge(ir);
  const late  = irOverdue(ir);
  const showProg = wantProgress(ir, prog);
  // Same field discipline as the list row, and for the same reason: `droneId` is
  // written by the public customer form, so every value here is escaped.
  return `
    <div class="kb-card${late ? ' is-late' : ''}" data-id="${escJsAttr(ir.irNumber)}" onclick="goTicket('${escJsAttr(ir.irNumber)}')">
      <div class="kb-card-top">
        <span class="ir-title">${escHtml(ir.irNumber)}</span>
        ${age ? `<span class="ir-age${late ? ' is-late' : ''}" title="${escHtml(ageTitle(ir, age))}">${escHtml(ageLabel(age))}</span>` : ''}
      </div>
      <div class="ir-meta">
        <span class="ir-sn">${escHtml(ir.droneId || '')}</span>
        ${ir.category ? `<span class="ir-dot">·</span><span class="ir-cat">${escHtml(categoryLabel(ir.category))}</span>` : ''}
      </div>
      <div class="kb-card-foot">
        <span class="ir-assignee${owner ? '' : ' is-unassigned'}">${escHtml(owner || t('common.unassigned'))}</span>
        ${showProg ? progressChip(prog) : ''}
      </div>
    </div>`;
}

function renderBoard(records) {
  if (!irBoard) return;
  // The two filter strips are drawn here too, exactly as renderIRList draws them:
  // the switch changes the drawing of the rows, never the controls above them.
  renderSegments();
  renderCategorySegments();
  if (!records || records.length === 0) {
    // Deliberately no glyph and no emoji: the app has one icon source, and a
    // literal emoji here would be a second one nothing can restyle.
    irBoard.innerHTML = '<div class="empty-state">' +
      (allIRs.length ? t('list.emptyFiltered') : t('board.emptyNone')) +
      '</div>';
    updateListCounts(0);
    return;
  }
  const byCol = {};
  BOARD_COLUMNS.forEach(c => { byCol[c.key] = []; });
  records.forEach(ir => { byCol[boardColumnOf(ir.status)].push(ir); });

  irBoard.innerHTML = BOARD_COLUMNS.map(col => {
    const rows  = byCol[col.key];
    const shown = rows.slice(0, BOARD_CAP);
    const more  = rows.length - shown.length;
    return `
    <div class="kb-col${col.quiet ? ' kb-col-quiet' : ''}">
      <div class="kb-col-head">
        <span class="kb-col-title">${escHtml(col.title)}</span>
        <span class="kb-col-count">${rows.length}</span>
      </div>
      <div class="kb-col-sub">${escHtml(col.stages.join(' · '))}</div>
      <div class="kb-col-body">
        ${shown.map(boardCard).join('')}
        ${more > 0 ? `<button type="button" class="kb-more">${escHtml(t('board.more', { n: more }))}</button>` : ''}
      </div>
    </div>`;
  }).join('');
  updateListCounts(records.length);
}

// The switch's one setter, so the class on the pane, the buttons and the repaint
// can never disagree about which view is showing.
function setListView(mode) {
  listMode = mode === 'board' ? 'board' : 'list';
  const pane = document.getElementById('index-view');
  if (pane) pane.classList.toggle('is-board', listMode === 'board');
  // The board draws the same rows across nine columns and needs the width, so
  // choosing it gives it the workspace: `html.board-full` hides the sidebar and
  // the "No IR selected" placeholder and lets this pane take the whole row. The
  // class is inert below lg — every rule behind it is desktop-scoped — because on
  // a phone the board is already a full screen.
  document.documentElement.classList.toggle('board-full', listMode === 'board');
  if (listViewSwitch) {
    listViewSwitch.querySelectorAll('.view-switch-btn').forEach(b => {
      const on = b.dataset.view === listMode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
  }
  applyListFilters();
  renderLayout();   // the board's full-screen class is a side of the fold rule
}
if (listViewSwitch) {
  listViewSwitch.addEventListener('click', e => {
    const btn = e.target.closest('.view-switch-btn');
    if (btn) setListView(btn.dataset.view);
  });
}
if (irBoard) {
  // "+N more" is a way back to the list, not a dead end: the board caps a column's
  // drawing for speed, and the honest answer to "where is the rest?" is the list.
  irBoard.addEventListener('click', e => {
    if (e.target.closest('.kb-more')) setListView('list');
  });
}

// The `.assignee-avatar` circle was removed from the LIST ROW with the 2026-09-21
// fix, and it stays removed. It was a 26px chip in the row's side column, and on
// IR470 — the row carrying the most chips — it was the chip that tipped the column
// past the 400px list pane's budget, so the browser squeezed the column and sliced
// the `Open` pill off at its left edge. The owner's read of that was "AN …
// overlapping above 'open' status", and his fix was the right one: the initial is
// not worth a chip, and his full name belongs in the empty space to the right of
// the IR number. See `renderIRList` and `.ir-title-row`.
//
// The Insights People card draws initials again, and that is a different thing in
// a different place: it is a full-width card, one row per assignee, with no chips
// competing for the line and no 400px budget. `initialsOf()` exists for it alone —
// smoke-ui.mjs pins both halves, so the row cannot get its circle back and the
// helper cannot quietly spread onto a row.

function updateListCounts(shown) {
  if (navCountEl)  navCountEl.textContent = allIRs.length;
  if (listCountEl) {
    listCountEl.textContent = shown === allIRs.length
      ? `${allIRs.length} total`
      : `${shown} of ${allIRs.length}`;
  }
  // The rail's own count, and it deliberately reads differently from the header's:
  // in a 56px column "5 total" is three lines of noise, and when a filter is on,
  // "3/5" says both numbers at a glance. The rail is only on screen while the
  // filter strips are folded away, so this is the only count a folded list shows.
  if (listRailCountEl) {
    listRailCountEl.textContent = shown === allIRs.length ? String(shown) : `${shown}/${allIRs.length}`;
  }
}

// ─── STATUS CATEGORIES ───────────────────────────────────────────────────────
// Frappe groups workflow statuses into three categories — Open (clock running),
// Paused (clock suspended), Resolved (clock stopped) — and colours the pill by
// category rather than by status. There is a fourth, Closed, for the one value that
// is finished without being Resolved.
//
// This table holds the TEN, plus 'Other'. It does NOT need the eight retired words:
// statusCategory() canonicalises first, so 'QC Investigation' reaches the open bucket
// through 'Investigation' and 'Close' reaches resolved through 'Delivered'. A second
// copy of the fold table here would be a second answer waiting to disagree.
//
// 'Other' is the one exception and it is here on purpose. It is not one of the ten
// and canonicalStage leaves it as itself, so without an entry an old 'Other' ticket
// would fall to the `open` default and sit in the pipeline forever with a red clock
// on it — the exact "finished but looks open" bug the old getBadgeClass() had, one
// value over.
const STATUS_CATEGORIES = {
  open:     ['Open', 'Inward', 'Inspection', 'Investigation', 'Production',
             'Quality Test', 'PDI/Dispatch', 'Remote Support'],
  paused:   ['On Hold'],
  resolved: ['Delivered'],
  closed:   ['Other'],
};

const CATEGORY_BADGE = {
  open:     'badge badge-open',
  paused:   'badge badge-pending',
  resolved: 'badge badge-resolved',
  closed:   'badge badge-closed',
};

function statusCategory(status) {
  const s = canonicalStage(status).toLowerCase();
  for (const cat of Object.keys(STATUS_CATEGORIES)) {
    if (STATUS_CATEGORIES[cat].some(v => v.toLowerCase() === s)) return cat;
  }
  return 'open';   // an unrecognised stage is still in the pipeline, not finished
}

// Stays a function rather than becoming a constant lookup: these class names
// appear in no class="…" literal, so a grep-based dead-CSS sweep would wrongly
// delete their rules.
function getBadgeClass(status) {
  return CATEGORY_BADGE[statusCategory(status)];
}

// ─── COMPLETION AND AGEING (Stage 3 / Stage 4) ───────────────────────────────
// Both facts are read off the list card AND the ticket header, so they are
// computed here once and never inside a renderer — the card and the header
// cannot then tell different stories about the same ticket.
//
// The rule they both obey is the one the whole `__IRS__` store is built on:
// NEVER INVENT A TIMESTAMP. The app knows exactly when IT changed a status
// (`statusAt`, written only on a real change — see applyTriage), so that is a
// real clock. A status the customer's Sheet set has no timestamp anywhere, so
// ageing falls back to the raise date and SAYS SO (`basis`); a ticket with
// neither — every legacy-only record — has no clock at all, rather than being
// reported as zero days old.

const DAY_MS = 86400000;

// How much of the passbook is filled in. Counted by walking the six LIVE ids and
// asking whether each was saved, rather than by counting the entries in `done[]`
// — so a store row holding a duplicate (or twenty junk ids) cannot render "7/6"
// or a progress bar with no fill class to reach for.
function sectionProgress(done) {
  const ids = Array.isArray(done) ? SECTION_IDS.filter(id => done.includes(id)) : [];
  return { done: ids.length, total: SECTION_IDS.length };
}

// Whole days since a millisecond timestamp, floored, never negative: a clock
// that disagrees with this machine's (a status set a minute "in the future" on
// another laptop) reads as today, not as -1 days.
function daysSince(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return null;
  const d = Math.floor((now - ms) / DAY_MS);
  return d < 0 ? 0 : d;
}

// The clock a ticket is on, and what that clock actually measures:
//   { days, basis: 'status' } — N days in this status, app-recorded
//   { days, basis: 'raised' } — N days since the client raised it, from the
//                               Sheet's own date. The STATUS may have moved
//                               since, and this app cannot know when.
//   null                      — no clock. Nothing is guessed.
function irAge(ir, now = Date.now()) {
  if (!ir) return null;
  if (Number.isFinite(ir.statusAt)) return { days: daysSince(ir.statusAt, now), basis: 'status' };
  const iso = parseISODate(ir.dateRaisedISO);
  if (!iso) return null;
  return { days: daysSince(Date.UTC(iso.y, iso.m - 1, iso.d), now), basis: 'raised' };
}

// Overdue limits in days, by priority. The owner's decision, 2026-09-18, and
// the ONE place to change them. An unprioritised ticket gets the loosest limit
// on purpose: treating "nobody has prioritised this yet" as urgent would flag
// every freshly-raised ticket as overdue.
const IR_OVERDUE_DAYS = { Urgent: 1, High: 3, Medium: 7, Low: 14 };
const IR_OVERDUE_DEFAULT_DAYS = 14;

// The map key a stored priority belongs to, or '' when it belongs to none.
// `irOverdueLimit` deliberately answers with the loosest limit for anything
// unrecognised, because a clock has to pick SOME number; a LABEL cannot use
// that answer, or an unprioritised ticket would wear "0–14 days" as if someone
// had chosen it. So the lookup is shared and the two callers take what they
// each need — the number, or nothing at all.
function irOverdueKey(priority) {
  // Matched case-insensitively rather than by direct key lookup: a stored
  // 'high' would otherwise miss the map and silently take the loosest limit,
  // which is the one wrong answer that looks like it worked.
  const p = String(priority || '').trim().toLowerCase();
  for (const key of Object.keys(IR_OVERDUE_DAYS)) {
    if (key.toLowerCase() === p) return key;
  }
  return '';
}

function irOverdueLimit(priority) {
  const key = irOverdueKey(priority);
  return key ? IR_OVERDUE_DAYS[key] : IR_OVERDUE_DEFAULT_DAYS;
}

// The window a priority is answered within, spoken: "0–1 day", "0–3 days".
//
// Read from IR_OVERDUE_DAYS rather than written out again, so the words on the
// label and the clock that paints a ticket late are the SAME number — the map is
// already the one place to change them, and a second copy is a second answer
// waiting to disagree. Day 0 is included because that is what the clock means:
// `irOverdue` flags a ticket once its age REACHES the limit, so a High ticket is
// inside its window on days 0–3 and late on day 3's edge, not on day 4.
function priorityWindow(value) {
  const key = irOverdueKey(value);
  if (!key) return '';
  const days = IR_OVERDUE_DAYS[key];
  return `0–${days} ${days === 1 ? 'day' : 'days'}`;
}

// What every surface prints for a priority: the translated word, and — when the
// stored value is one of the four — the window it is measured against. One
// function, so the dropdown CR picks from and the pill the ticket wears cannot
// word the same priority differently.
const priorityLabel = v => {
  const word = tPriority(v);
  const win  = priorityWindow(v);
  return win ? `${word} (${win})` : word;
};

// Only a ticket still IN THE PIPELINE can be overdue: a paused or finished one
// is not running a clock, whatever its age. Returns null rather than false when
// it is simply not overdue, so no caller can confuse "no" with "no clock".
function irOverdue(ir, now = Date.now()) {
  if (!ir || statusCategory(ir.status) !== 'open') return null;
  const age = irAge(ir, now);
  if (!age) return null;
  const limit = irOverdueLimit(ir.priority);
  return age.days >= limit ? { days: age.days, limit, basis: age.basis } : null;
}

// The age as it is spoken. One function, so the card and the header cannot word
// the same fact differently. "In status" is only said when the app recorded the
// change itself; otherwise the label names what the number really measures.
function ageLabel(age) {
  if (!age) return '';
  return age.basis === 'status' ? `In status ${age.days}d` : `Raised ${age.days}d ago`;
}

function ageTitle(ir, age) {
  if (!age) return '';
  if (age.basis === 'status') {
    return `Status last changed ${toDisplayDate(ir.statusAt)} — recorded in the passbook`;
  }
  return `Raised ${toDisplayDate(ir.dateRaisedISO)}. This is the age of the IR, not of its status: the status was set in the client's Sheet, which carries no timestamp, and this app will not invent one`;
}

function overdueTitle(ir, late) {
  const clock = late.basis === 'status'
    ? `${late.days} days in this status`
    : `${late.days} days since it was raised`;
  const limit = ir.priority
    ? `the ${late.limit}-day limit for ${ir.priority} priority`
    : `the ${late.limit}-day limit for an unprioritised IR`;
  return `Overdue — ${clock}, past ${limit}`;
}

// ─── LIST FILTER SEGMENTS ────────────────────────────────────────────────────
const SEGMENT_LABELS = [['all', 'All'], ['open', 'Open'], ['paused', 'Paused'],
                        ['resolved', 'Resolved'], ['closed', 'Closed']];

function segmentCounts() {
  const c = { all: allIRs.length, open: 0, paused: 0, resolved: 0, closed: 0 };
  allIRs.forEach(ir => { c[statusCategory(ir.status)]++; });
  return c;
}

// Counts always come from allIRs, so they stay right while a filter is applied.
function renderSegments() {
  if (!listSegments) return;
  const c = segmentCounts();
  listSegments.innerHTML = SEGMENT_LABELS.map(([key, label]) => `
    <button type="button" class="segment${activeSegment === key ? ' active' : ''}"
            data-seg="${key}" role="tab" aria-selected="${activeSegment === key}">
      ${label}<span class="segment-count">${c[key] || 0}</span>
    </button>
  `).join('');
}

// ─── LIST FILTER: CATEGORY ───────────────────────────────────────────────────
// A second, INDEPENDENT filter axis beside the status strip. Deliberately not a
// third row of SEGMENT_LABELS: the status strip and this one combine (a CRASH that
// is Resolved is a real question), so they are two scalars read by the same
// applyListFilters(), not two states of one control.
const CATEGORY_ALL = 'all';
const UNCATEGORISED = '__none__';   // an IR CR has not triaged yet

function categoryCounts() {
  const c = { all: allIRs.length };
  IR_CATEGORIES.forEach(k => { c[k] = 0; });
  c[UNCATEGORISED] = 0;
  allIRs.forEach(ir => {
    const k = ir.category || UNCATEGORISED;
    // An unknown value (a category retired from the list, a hand-edited store row)
    // must not be silently added to `all` twice over — it falls into the
    // uncategorised bucket rather than inventing a twelfth segment.
    c[k] = (c[k] || 0) + 1;
  });
  return c;
}

// Uncategorised is shown only when there is something in it. On a store where every
// IR has been triaged the segment would read "0" forever, and CR would reasonably
// read that as a bug rather than as good news.
function renderCategorySegments() {
  if (!listCategories) return;
  const c = categoryCounts();
  const keys = [CATEGORY_ALL, ...IR_CATEGORIES];
  if (c[UNCATEGORISED]) keys.push(UNCATEGORISED);
  listCategories.innerHTML = keys.map(key => {
    const label = key === CATEGORY_ALL ? 'All categories'
                : key === UNCATEGORISED ? 'No category'
                : categoryLabel(key);
    return `
    <button type="button" class="segment${activeCategory === key ? ' active' : ''}"
            data-cat="${escHtml(key)}" role="tab" aria-selected="${activeCategory === key}">
      ${escHtml(label)}<span class="segment-count">${c[key] || 0}</span>
    </button>`;
  }).join('');
}

// The one place the search box and the segment strip combine into a filter.
function applyListFilters() {
  const q = (searchInput.value || '').toLowerCase().trim();
  let rows = allIRs;
  if (activeSegment !== 'all') rows = rows.filter(ir => statusCategory(ir.status) === activeSegment);
  if (activeCategory !== CATEGORY_ALL) {
    rows = rows.filter(ir => activeCategory === UNCATEGORISED
      ? !ir.category
      : ir.category === activeCategory);
  }
  if (q) {
    rows = rows.filter(ir =>
      ir.irNumber?.toLowerCase().includes(q) ||
      ir.droneId?.toLowerCase().includes(q)
    );
  }
  // One filter, two drawings. The board reads the SAME `rows` the list would, so
  // the switch can never show a different set of IRs from the one above it.
  if (listMode === 'board') renderBoard(rows);
  else renderIRList(rows);
}

// Search / segment filter
searchInput.addEventListener('input', applyListFilters);

if (listSegments) {
  listSegments.addEventListener('click', e => {
    const btn = e.target.closest('.segment');
    if (!btn) return;
    activeSegment = btn.dataset.seg;
    renderSegments();
    applyListFilters();
  });
}

if (listCategories) {
  listCategories.addEventListener('click', e => {
    const btn = e.target.closest('.segment');
    if (!btn) return;
    setCategoryFilter(btn.dataset.cat);
  });
}

// The single setter, so the Insights cards can deep-link into a filtered list
// without duplicating the repaint order.
function setCategoryFilter(key) {
  activeCategory = key || CATEGORY_ALL;
  renderCategorySegments();
  applyListFilters();
}

// ─── PASSBOOK DETAIL ─────────────────────────────────────────────────────────
async function openPassbook(irNumber) {
  // Sequence token: a fast second open (list clicks, a hash change) must not let
  // the slower first one finish and paint over it.
  const seq = ++_openSeq;

  currentIR = allIRs.find(ir => ir.irNumber === irNumber) || { irNumber };
  evidenceState = {};     // clear image-evidence state from any previously-open IR
  dispatchChecklistState = {}; // clear Section H dispatch checklist from previous IR

  document.getElementById('ir-banner-title').textContent = irNumber;
  // Drone + customer only — status moved into the pill strip beside it.
  document.getElementById('ir-banner-sub').textContent =
    [currentIR.droneId, currentIR.customerName].filter(Boolean).join(' · ') || '—';
  if (bannerPills) {
    // This IR may not be in allIRs yet (deep link into a list that has not
    // loaded), so apply its app-owned state directly instead of relying on the
    // merge in setAllIRs.
    const st = appState(irNumber);
    const owned = ownedStatus(irNumber);
    // Set UNCONDITIONALLY, and repeat the merge's own rule rather than trusting what
    // arrived: a stub `{ irNumber }` off a deep link carries no status at all, and the
    // 30 suites would not catch a blank pill because none of them renders this path
    // without a loaded list. Idempotent when the record HAS been merged — there,
    // `ir.status` is already `owned || 'Open'`.
    currentIR.status = owned || 'Open';
    if (st) {
      currentIR.assignee     = st.assignee     || '';
      currentIR.assigneeName = st.assigneeName || '';
      if (st.priority) currentIR.priority = st.priority;
      currentIR.category        = st.category        || '';
      currentIR.subCategory     = st.subCategory     || '';
      currentIR.subCategoryNote = st.subCategoryNote || '';
      currentIR.done = Array.isArray(st.done) ? st.done : [];
    }
    renderBannerMeta();
  }

  currentView = 'detail';
  renderLayout();
  headerTitle.textContent = irNumber;

  // Build all section forms
  buildSectionForms(irNumber);

  // The client's original report. Read-only and Sheet-only, so it needs no
  // reload after a section save — only after the IR itself changes.
  renderIntake();

  // Load saved data for this IR, then restore any unsaved drafts on top
  await loadSectionData(irNumber);
  if (seq !== _openSeq) return;   // superseded by a newer openPassbook()

  // Which sections have saved rows is exactly what getPassbook just told us, so
  // completion is recomputed on open with no extra read. Display only — the
  // persisted `done` list is updated by the save path (markSectionDone).
  const loadedSecs = Object.keys(currentSectionData || {}).filter(k => SECTIONS[k]);
  if (loadedSecs.length) {
    currentIR.done = Array.from(new Set([...(currentIR.done || []), ...loadedSecs]));
    const listed = allIRs.find(x => x.irNumber === irNumber);
    if (listed) listed.done = currentIR.done;
  }

  restoreDrafts();
  refreshDraftBanner();
  refreshCommentCounts();   // show comment counts on each section/field 💬 button
  renderDispatchChecklist('h_dispatchChecklist'); // pick up any Section B draft values
  // The pinned Overview needs the saved data (a_crmOwner/a_contactPhone, and the
  // legacy activity log), so it renders only after loadSectionData has landed.
  renderOverview();

  // Legacy record: show the "Legacy Record" button if this IR exists in the
  // legacy workbook, and auto-open that read-only view when there's no new-app
  // data yet (so old IRs immediately show their original record, not empty tabs).
  const legacy = legacyMap[irNumber];
  const legacyBtn = document.getElementById('ir-legacy-btn');
  if (legacy && legacyBtn) {
    legacyBtn.style.display = '';
    // A pre-app IR that has no data in the new app yet: show its original record
    // straight away rather than six empty tabs. The record is read from the backend
    // (getLegacyIR) — see openLegacyRecord — because the workbook itself is
    // restricted and the browser cannot open it.
    const hasNewData = currentSectionData && Object.keys(currentSectionData).length > 0;
    if (!hasNewData) openLegacyRecord(irNumber);
  } else if (legacyBtn) {
    legacyBtn.style.display = 'none';
  }
}

// ─── CLIENT INTAKE VIEW (the 📋 Report tab) ──────────────────────────────────
// Read-only by construction — nothing here writes anywhere. This is the client's
// own words, and the entire point of the tab is that nobody opens the Sheet to
// read them. So it lists every ingested column, including the ones no section
// ever displayed (the raised time, the email, the SPOC), and names any column
// the Form writes that the app does not model.
function intakeValueHtml(kind, raw) {
  const v = raw == null ? '' : String(raw).trim();
  if (!v) return '<span class="intake-empty">—</span>';
  if (kind === 'datetime') return escHtml(toDisplayDateTime(v) || v);
  if (kind === 'date')     return escHtml(toDisplayDate(v) || v);
  if (kind === 'email')    return `<a href="mailto:${escHtml(v)}" class="intake-link">${escHtml(v)}</a>`;
  if (kind === 'links') {
    // A Drive evidence cell can hold several URLs (and occasionally stray text),
    // so each token gets its own line rather than one unreadable blob. The
    // original URL is kept as the link's title — the label is a courtesy.
    const tokens = v.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return '<span class="intake-empty">—</span>';
    return tokens.map((t, i) => {
      const e = escHtml(t);
      return /^https?:\/\//i.test(t)
        ? `<div class="intake-ev"><span class="intake-ev-icon" aria-hidden="true">📎</span>` +
          `<a href="${e}" target="_blank" rel="noopener" class="intake-link" title="${e}">Evidence file ${i + 1} ↗</a></div>`
        : `<div class="intake-ev"><span class="intake-plain">${e}</span></div>`;
    }).join('');
  }
  return escHtml(v).replace(/\n/g, '<br/>');
}

function renderIntake() {
  const body = document.getElementById('sec-intake-body');
  if (!body) return;
  const ir = currentIR;
  if (!ir || !ir.irNumber) {
    body.innerHTML = '<p class="intake-audit">No IR selected.</p>';
    return;
  }

  // `intake` holds the raw cells for a Sheet-sourced IR. Legacy and demo
  // records have no Sheet row, so fall back to the parsed fields the record does
  // carry — the tab must be honest about what it has, not show blanks.
  const intake = ir.intake || {};
  const fallback = {
    dateRaised: ir.dateRaised, incidentDate: ir.incidentDate, droneId: ir.droneId,
    companyName: ir.companyName, customerName: ir.customerName, contactPhone: ir.contactPhone,
    contactEmail: ir.contactEmail, spoc: ir.spoc, issueType: ir.issueType,
    issueDesc: ir.issueDesc, incidentLocationWeather: ir.incidentLocationWeather,
    evidenceFormN: ir.evidenceFormN, evidenceFormQ: ir.evidenceFormQ, summaryLink: ir.summaryLink,
  };
  const valueOf = field => {
    const v = intake[field];
    return (v !== undefined && v !== null && v !== '') ? v : (fallback[field] || '');
  };

  const rows = INTAKE_FIELDS
    .filter(f => f.field !== 'summaryLink')     // rendered as the header link
    .map(f => {
      const wide = f.kind === 'longtext' || f.kind === 'links';
      return `<div class="intake-row${wide ? ' intake-row-wide' : ''}">` +
             `<div class="intake-label">${escHtml(f.label)}</div>` +
             `<div class="intake-value">${intakeValueHtml(f.kind, valueOf(f.field))}</div>` +
             `</div>`;
    }).join('');

  const report = String(valueOf('summaryLink') || '').trim();
  const openLink = report
    ? `<a href="${escHtml(report)}" target="_blank" rel="noopener" class="intake-open">Open original report ↗</a>`
    : '';

  const extras = Array.isArray(ir.extra) ? ir.extra : [];
  const extrasHtml = extras.length
    ? `<div class="intake-extras">
         <div class="intake-extras-head">Other columns from the Sheet</div>
         ${extras.map(x =>
            `<div class="intake-row"><div class="intake-label">${escHtml(x.label)}</div>` +
            `<div class="intake-value">${intakeValueHtml('text', x.value)}</div></div>`).join('')}
       </div>`
    : '';

  // Columns the Form writes that the app does not model AND that are blank on
  // this IR — named so the gap is visible rather than assumed away.
  const unmapped = (lastSheetAudit.unmapped || [])
    .filter(h => !extras.some(x => x.label === h));
  const auditNote = unmapped.length
    ? `<p class="intake-audit">The client's form also writes ${unmapped.map(escHtml).join(', ')} — empty on this IR.</p>`
    : '';
  const noSheetNote = ir.intake
    ? ''
    : `<p class="intake-audit">No Sheet row for this IR — showing only the fields the app holds. ` +
      `Records from before the app (🏛 Legacy) live in the old workbook.</p>`;

  body.innerHTML =
    `<div class="intake-head">
       <p class="intake-note">Read-only — exactly what the client submitted through the Google Form. The app never edits these values.</p>
       ${openLink}
     </div>` +
    noSheetNote + auditNote +
    `<div class="intake-list">${rows}</div>` +
    extrasHtml;
}

// ─── OVERVIEW PANEL ──────────────────────────────────────────────────────────
// What used to be Section A, in the form it should always have had. It is pinned
// above the section tabs and is not a section: no letter, no tab, no completion
// state, and it is never drafted (it sits outside #sections-wrapper).
//
// Its record still lives in APP_DATA under the id `sec-a` — OVERVIEW_KEY — so the
// existing row, the existing AUDIT_LOG history and the backend's locked-intake
// strip all keep working unchanged. Nothing user-visible says "A" any more.
//
// Layout, top to bottom:
//   facts     the intake values the customer's Google Form supplies, read-only
//   editable  the two fields CRM actually owns (a_crmOwner, a_contactPhone)
//   timeline  generated from what the app records — see buildTimeline
//   legacy    the hand-typed activity log, read-only and labelled Legacy

const OVERVIEW_FACTS = [
  { field: 'irNumber',    label: 'IR Number',        kind: 'text' },
  { field: 'droneId',     label: 'Drone Serial No.', kind: 'text' },
  { field: 'dateRaised',  label: 'Date Raised',      kind: 'date' },
  { field: 'companyName', label: 'Company',          kind: 'text' },
  { field: 'customerName',label: 'Respondent',       kind: 'text' },
  { field: 'issueType',   label: 'Support Required', kind: 'text' },
];

// Read one intake value, preferring the raw Sheet cell over the parsed record.
// Same precedence rule as renderIntake(): the Sheet is the client's own words.
function overviewFactValue(field) {
  const ir = currentIR || {};
  const raw = ir.intake && ir.intake[field];
  if (raw !== undefined && raw !== null && raw !== '') return raw;
  return ir[field] !== undefined && ir[field] !== null ? ir[field] : '';
}

function renderOverviewFacts() {
  const el = document.getElementById('ir-overview-facts');
  if (!el) return;
  const facts = OVERVIEW_FACTS.map(f => {
    const v = overviewFactValue(f.field);
    return `<div class="overview-fact"><span class="overview-fact-label">${escHtml(f.label)}</span>` +
           `<span class="overview-fact-value">${intakeValueHtml(f.kind, v)}</span></div>`;
  }).join('');
  el.innerHTML = `<div class="overview-facts">${facts}</div>` +
    `<button type="button" class="overview-report-link" id="overview-report-link">` +
    `Full report, issue description &amp; weather →</button>`;
  // The description and the incident/weather text are long and stay on the 📋
  // Report tab. Pinning all ten intake fields here would push the timeline a
  // screen down on a phone, and they are already one tap away.
  const link = document.getElementById('overview-report-link');
  if (link) link.onclick = () => {
    const tab = document.querySelector('.tab[data-section="sec-intake"]');
    if (tab) tab.click();
  };
}

function renderOverviewEditable() {
  const el = document.getElementById('ir-overview-editable');
  if (!el) return;
  const saved = (currentSectionData && currentSectionData[OVERVIEW_KEY]) || {};
  const canWrite = canTriage();
  const val = (key, fallback) => {
    const v = saved[key];
    return (v === undefined || v === null) ? (fallback || '') : v;
  };
  const ro = canWrite ? '' : ' disabled';
  // Same per-field 🕓 History button the lettered sections' fields carry. These two
  // are hand-rendered here rather than built by buildField, but they are stored IR
  // data like any other field and their history is worth exactly as much — these are
  // the two fields CR and Management own, so "who changed the CRM name, and to what"
  // is a real question about them.
  const hist = fid =>
    `<button type="button" class="field-hist-btn" data-field-id="${escJsAttr(fid)}" title="History of this field" onclick="openFieldHistory('${escJsAttr(fid)}')">${iconSvg('clock')}</button>`;
  el.innerHTML =
    `<div class="overview-edit-row">
       <label class="overview-edit-label" for="a_crmOwner">${escHtml(t('overview.crmOwner'))}${hist('a_crmOwner')}</label>
       <input class="form-input" type="text" id="a_crmOwner" placeholder="${escHtml(t('overview.crmOwnerHint'))}" value="${escHtml(val('a_crmOwner', currentIR?.spoc))}"${ro} />
     </div>
     <div class="overview-edit-row">
       <label class="overview-edit-label" for="a_contactPhone">${escHtml(t('overview.contactPhone'))}${hist('a_contactPhone')}</label>
       <input class="form-input" type="tel" id="a_contactPhone" placeholder="${escHtml(t('overview.phoneHint'))}" value="${escHtml(val('a_contactPhone', currentIR?.contactPhone))}"${ro} />
     </div>
     <div class="overview-edit-row">
       <label class="overview-edit-label" for="a_siteLocation">${escHtml(t('overview.siteLocation'))}${hist('a_siteLocation')}</label>
       <div class="overview-site-cell">
         <input class="form-input" type="text" id="a_siteLocation" placeholder="${escHtml(t('overview.siteHint'))}" value="${escHtml(val('a_siteLocation'))}"${ro} />
         <a class="overview-site-link" id="a_site-link" target="_blank" rel="noopener noreferrer" hidden>${escHtml(t('common.openInMaps'))}</a>
       </div>
     </div>` +
    (canWrite ? '' : `<p class="overview-note">${escHtml(t('overview.readOnlyNote'))}</p>`);

  // ── The Maps link, kept live ───────────────────────────────────────────────
  // Held in step with what is TYPED rather than with what is stored, because it is
  // the one readout on this panel that costs nothing to keep current — and a link
  // that lagged the text box by one save would point at the PREVIOUS site, which is
  // worse than showing no link at all: it looks right and takes you somewhere else.
  //
  // Nothing reaches Google until someone taps it. This builds a URL and puts it in
  // an href; it fetches nothing, and the stored value is never sent anywhere by the
  // app. A blank box clears the href as well as hiding the link, so a stale target
  // is not sitting there to be activated by a stray tap.
  const site     = document.getElementById('a_siteLocation');
  const siteLink = document.getElementById('a_site-link');
  const paintSiteLink = () => {
    if (!siteLink) return;
    const href = mapsLink(site && site.value);
    if (href) { siteLink.href = href; siteLink.hidden = false; }
    else { siteLink.removeAttribute('href'); siteLink.hidden = true; }
  };
  if (site) site.addEventListener('input', paintSiteLink);
  paintSiteLink();
}

// The hand-typed activity log, read-only. It is shown exactly as it was typed,
// with the four-column grid it was typed into — spans where the inputs were, so
// the layout needs no new CSS. Not merged into the timeline: the rows carry no
// per-row timestamp, so any date on them would be invented.
function renderLegacyLog() {
  const el = document.getElementById('ir-legacy-log');
  if (!el) return;
  const raw = (currentSectionData && currentSectionData[OVERVIEW_KEY] || {}).a_activityLog;
  let rows = [];
  if (Array.isArray(raw)) {
    rows = raw.filter(r => r && (r.activity || r.remark || r.date));
  } else if (typeof raw === 'string' && raw.trim()) {
    // Older records stored this field as one blob of text before it became a table.
    rows = [{ activity: raw }];
  }
  if (!rows.length) { el.innerHTML = ''; return; }
  el.innerHTML =
    `<div class="overview-sub-head">
       <span class="legacy-tag">Legacy</span>
       <span class="overview-sub-note">Hand-typed activity log from before this app recorded activity automatically. Kept for the record — the app no longer writes to it.</span>
     </div>
     <div class="activity-table-wrapper">
       <div class="activity-table-header">
         <span class="act-col-day">#</span>
         <span class="act-col-date">Date</span>
         <span class="act-col-activity">Activity Description</span>
         <span class="act-col-remark">Remark</span>
       </div>
       <div class="activity-table-body">${rows.map(buildLegacyActivityRow).join('')}</div>
     </div>`;
}

function applyOverviewGating() {
  const btn = document.getElementById('save-overview');
  if (!btn) return;
  const canWrite = canTriage();
  btn.disabled = !canWrite;
  btn.style.opacity = canWrite ? '' : '0.5';
  btn.style.cursor = canWrite ? '' : 'not-allowed';
  btn.title = canWrite ? '' : 'You need Allot CAPS access to edit the Overview';
}

// Cached audit rows for the open IR. Comments live in a different store that the
// bell already polls, so when they change the timeline can be re-rendered from
// this cache with no second fetch.
let activityLogCache = { irNumber: '', entries: [] };

// The in-page log shows the newest 40; the History modal shows 400. One builder,
// one renderer, two windows.
const ACTIVITY_LIMIT = 40;

async function loadActivityLog(irNumber) {
  const el = document.getElementById('ir-timeline');
  if (!el) return;
  const entries = await fetchAuditEntries(irNumber, 400, true);
  // A newer IR may have been opened while this was in flight.
  if (!currentIR || currentIR.irNumber !== irNumber) return;
  activityLogCache = { irNumber: irNumber, entries: entries };
  refreshActivityLog();
}

function refreshActivityLog() {
  const el = document.getElementById('ir-timeline');
  if (!el || !currentIR) return;
  // Nothing cached for THIS IR yet — the first fetch is still in flight, and
  // rendering another IR's activity would be worse than a moment of blank.
  if (activityLogCache.irNumber !== currentIR.irNumber) return;
  // Build the whole list and slice it here rather than passing the limit to
  // buildTimeline, so the header count can report the TRUE total: "40 of 128" is
  // honest, a bare "40" would not be.
  const all = buildTimeline(currentIR.irNumber, activityLogCache.entries, nudges, 0);
  renderTimelineInto(el, all.slice(-ACTIVITY_LIMIT), {
    emptyText: 'No activity recorded yet for this IR.',
  });
  renderActivityCount(all.length, Math.min(all.length, ACTIVITY_LIMIT));
}

// Refreshed on every activity refresh — including while the panel is COLLAPSED,
// which is why the render above is never gated on is-open. Gating it would leave
// a stale number sitting over a stale list.
function renderActivityCount(total, shown) {
  const el = document.getElementById('ir-activity-count');
  if (!el) return;
  el.textContent = !total ? '' : (shown < total ? shown + ' of ' + total : String(total));
}

function applyActivityState(open) {
  const panel = document.getElementById('ir-activity');
  if (panel) panel.classList.toggle('is-open', !!open);
  const btn = document.getElementById('ir-activity-toggle');
  if (btn) btn.setAttribute('aria-expanded', String(!!open));
}
function toggleActivity() {
  const open = !storedFlag(ACTIVITY_KEY);
  setFlag(ACTIVITY_KEY, open);
  applyActivityState(open);
}

function renderOverview() {
  const panel = document.getElementById('ir-overview');
  if (!panel) return;
  const activity = document.getElementById('ir-activity');
  if (!currentIR || !currentIR.irNumber) {
    panel.style.display = 'none';
    if (activity) activity.classList.add('is-hidden');
    return;
  }
  panel.style.display = '';
  if (activity) activity.classList.remove('is-hidden');
  renderOverviewFacts();
  renderOverviewEditable();
  renderLegacyLog();
  applyOverviewGating();
  loadActivityLog(currentIR.irNumber);
}

// Mirrors the section save path, minus files and drafts, and posts to the SAME
// `sec-a` record the Overview has always used. Deliberately reuses the existing
// saveSection action rather than adding one: the backend's locked-intake guard
// keeps stripping the ten customer-form keys from any `sec-a` payload, so the
// Overview can never write a second, divergent copy of the intake facts.
async function saveOverview() {
  const irNumber = currentIR?.irNumber;
  if (!irNumber) return;
  if (!canTriage()) { showToast('You need Allot CAPS access to edit the Overview'); return; }
  const btn = document.getElementById('save-overview');
  const label = btn ? btn.textContent : '';
  // Same double-post guard as saveSection, and for the same reason: the Overview
  // posts to the same backend action. Its key is OVERVIEW_KEY, so it never collides
  // with a section save that happens to be in flight.
  if (_savesInFlight.has(OVERVIEW_KEY)) return;
  _savesInFlight.add(OVERVIEW_KEY);
  if (btn) { btn.textContent = 'Saving…'; btn.className = 'btn saving'; btn.disabled = true; }

  // Through the shared reader, not a second literal of the same ids.
  //
  // The literal had a hole worth naming, because the Save button is a SIBLING of
  // the panel (index.html) and not inside it: if #ir-overview-editable ever failed
  // to render, renderOverviewEditable returned early, the button stayed live, and
  // the literal posted a_crmOwner: '' and a_contactPhone: '' — and the backend
  // MERGES the Overview, so pressing Save on a button that said "Saved!" would have
  // wiped both stored values. A reader that reports only the fields actually on
  // screen sends nothing in that case and the merge leaves the row alone.
  const fields = collectOverviewValues();

  const formData = new FormData();
  formData.append('action', 'saveSection');
  formData.append('irNumber', irNumber);
  formData.append('sectionId', OVERVIEW_KEY);
  formData.append('savedBy', currentUser?.email || 'unknown');
  formData.append('fields', JSON.stringify(fields));
  formData.append('files', JSON.stringify([]));

  try {
    const res  = await fetch(CONFIG.GAS_URL, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(data.message || 'Backend error');
    if (btn) { btn.textContent = '✓ Saved!'; btn.className = 'btn saved'; }
    // Cleaned before the toast, like a section save: the leave guard must read the
    // truth from the instant the save lands, not 3 s later when the button resets.
    _dirtySections.delete(OVERVIEW_KEY);
    updateDirtyIndicators();
    showToast('Overview saved');
    // Keep the in-memory record in step, or a re-render would revert to the old
    // values and look like the save was lost.
    currentSectionData[OVERVIEW_KEY] = Object.assign({}, currentSectionData[OVERVIEW_KEY] || {}, fields);
    loadActivityLog(irNumber);
  } catch (err) {
    if (btn) { btn.textContent = '⚠ Retry Save'; btn.className = 'btn error'; }
    showToast('❌ Save failed: ' + err.message);
  }

  setTimeout(() => {
    _savesInFlight.delete(OVERVIEW_KEY);
    if (btn) { btn.textContent = label || 'Save Overview'; btn.className = 'btn'; }
    // Re-enabled through the Overview's own access sweep, never a bare
    // `disabled = false` — same reason as a section save.
    if (typeof applyOverviewGating === 'function') applyOverviewGating();
    else if (btn) btn.disabled = false;
  }, 3000);
}

// The banner's triage line. Every value here is app-owned (`__IRS__`); the Sheet
// only supplies the status an IR starts life with.
function renderBannerMeta() {
  if (!bannerPills || !currentIR) return;
  const ir    = currentIR;
  const owner = ir.assigneeName || ir.assignee || '';
  // Named `showTriage`, NOT `canTriage` — a local of that name would shadow the
  // canTriage() function for the whole of this scope and throw a TypeError.
  // Only a real browser run catches that; the vm suites cannot see it.
  const showTriage = canTriage();
  // Stage 3 and Stage 4 say the same thing here as on the list card, from the
  // same helpers — the header is where there is room to word it in full.
  const prog = sectionProgress(ir.done);
  const age  = irAge(ir);
  const late = irOverdue(ir);
  bannerPills.innerHTML =
    `<span class="${getBadgeClass(ir.status)}">${escHtml(statusLabel(ir.status))}</span>` +
    (ir.priority ? `<span class="prio prio-${String(ir.priority).toLowerCase()}">${escHtml(priorityLabel(ir.priority))}</span>` : '') +
    (ir.category ? `<span class="meta-pill">${escHtml(categoryLabel(ir.category))}</span>` : '') +
    (ir.subCategory ? `<span class="meta-pill">${escHtml(subCategoryLabel(ir.subCategory))}</span>` : '') +
    (age ? `<span class="meta-pill${late ? ' meta-late' : ''}" title="${escHtml(ageTitle(ir, age))}">${escHtml(ageLabel(age))}</span>` : '') +
    (late ? `<span class="badge badge-danger" title="${escHtml(overdueTitle(ir, late))}">${escHtml(t('common.overdue'))}</span>` : '') +
    (wantProgress(ir, prog) ? progressSteps(ir, prog) : '') +
    (owner
      ? `<span class="meta-pill meta-owner" title="Assigned to ${escHtml(ir.assignee || owner)}">👤 ${escHtml(owner)}</span>`
      : `<span class="meta-pill meta-unassigned">${escHtml(t('common.unassigned'))}</span>`);
  const triageBtn = document.getElementById('ir-triage-btn');
  if (triageBtn) triageBtn.style.display = showTriage ? '' : 'none';
  // The move offer lives in a section's close row, not in this banner, but it is
  // built from the status this banner has just painted — so it is refreshed here.
  // patchIRState() re-renders the banner on every status write, which is what makes
  // the offer disappear the moment it has been taken.
  paintBoardMoveOffer(ir.irNumber);
}

// ─── ALLOT CAPS MODAL (status / assignee / priority / category) ──────────────
// The panel the owner renamed "Allot CAPS" — the word Triage was his least
// favourite in the app. It is a DISPLAY rename only: the permission key stays
// `triage` everywhere it is stored (see ACCESS_TRIAGE_KEY's neighbours in
// _store/access.json, the `triage` field on a profile, canTriage()), because a
// rename that reached the store would silently un-grant CR and Management.
//
// Writes to `__IRS__` — the app's own record — and never touches the client's
// Sheet, which keeps the customer's original report intact. Reuses the
// full-screen modal pattern of the team-directory editor so it works at phone
// width without a new layout.
function openTriageModal() {
  if (!currentIR) return;
  if (!canTriage()) { showToast('You do not have Allot CAPS access — ask an admin to grant it'); return; }
  if (document.getElementById('triage-modal')) return;
  const ir     = currentIR;
  // The label is a separate argument because the VALUE is a stored key and must
  // stay exactly as the Sheet wrote it — only the text between the tags is ours.
  const opt    = (v, sel, label) => `<option value="${escHtml(v)}"${v === sel ? ' selected' : ''}>${escHtml(label == null ? v : label)}</option>`;
  const modal  = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'triage-modal';
  modal.innerHTML = `
    <div class="inward-options-card">
      <div class="inward-options-head">
        <h3>Allot CAPS ${escHtml(ir.irNumber)}</h3>
        <button type="button" class="inward-options-close" onclick="closeTriageModal()">&times;</button>
      </div>
      <p class="inward-options-hint">Recorded here in the passbook, not in the client's Google Sheet — the Sheet keeps the customer's original report untouched. Assigning someone sends them a notification.</p>
      <div class="inward-options-body triage-body">
        <label class="triage-row"><span>Status</span>
          <!-- The TEN are what this offers and nothing else. An IR holding a
               retired word opens on the stage it now means (canonicalStage), so CR
               sees one honest answer rather than a blank box, and saving writes the
               stage — which is how an old IR is re-aligned, in the app. -->
          <select class="form-input" id="triage-status">${IR_STATUS_VALUES.map(v => opt(v, canonicalStage(ir.status))).join('')}</select>
        </label>
        <label class="triage-row"><span>Assigned to</span>
          <!-- A type-to-search picker rather than a <select>: the team directory is
               long enough that scrolling a native dropdown for one name is the
               friction the owner asked to remove, and a phone's native picker is
               worse still. The control's REAL value lives in the hidden input —
               the visible box holds a NAME, which is what a person reads and
               types, while the store must keep the EMAIL, which is the key every
               notification and permission lookup is done by. -->
          <div class="combo" id="triage-assignee-combo">
            <input type="text" class="form-input" id="triage-assignee" autocomplete="off"
                   spellcheck="false" role="combobox" aria-expanded="false"
                   aria-controls="triage-assignee-list" aria-label="Assigned to"
                   placeholder="Type a name to search…"
                   value="${escHtml(assigneeDisplayName(ir.assignee))}"
                   oninput="renderAssigneeOptions(this.value)"
                   onfocus="renderAssigneeOptions(this.value)"
                   onkeydown="onAssigneeKeydown(event)"
                   onblur="commitAssigneeInput()" />
            <input type="hidden" id="triage-assignee-email" value="${escHtml(ir.assignee || '')}" />
            <div class="combo-list" id="triage-assignee-list" role="listbox" aria-label="Team members"></div>
          </div>
        </label>
        <label class="triage-row"><span>Priority</span>
          <select class="form-input" id="triage-priority">
            <option value="">— None —</option>${TICKET_PRIORITIES.map(v => opt(v, ir.priority || '', priorityLabel(v))).join('')}
          </select>
        </label>
        <label class="triage-row"><span>Category</span>
          <select class="form-input" id="triage-category">
            <option value="">— Choose —</option>${IR_CATEGORIES.map(v => opt(v, ir.category || '', categoryLabel(v))).join('')}
          </select>
        </label>
        <!-- Sub-category exists ONLY under REPAIR. Both rows stay in the DOM and are
             shown/hidden, rather than being added and removed, so the two selects
             never lose the listener wired below by being replaced. -->
        <label class="triage-row" id="triage-subcat-row"${ir.category === 'REPAIR' ? '' : ' style="display:none"'}>
          <span>Sub-category</span>
          <select class="form-input" id="triage-subcategory">
            <option value="">— Choose —</option>${REPAIR_SUBCATEGORIES.map(v => opt(v, ir.subCategory || '', subCategoryLabel(v))).join('')}
          </select>
        </label>
        <label class="triage-row" id="triage-subcat-note-row"${ir.category === 'REPAIR' && ir.subCategory === REPAIR_OTHERS ? '' : ' style="display:none"'}>
          <span>Mention it</span>
          <input type="text" class="form-input" id="triage-subcat-note" maxlength="120"
                 placeholder="What was repaired?" value="${escHtml(ir.subCategoryNote || '')}" />
        </label>
      </div>
      <div class="inward-options-foot">
        <button type="button" class="btn" onclick="closeTriageModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="applyTriage()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  wireTriageCategoryRows();
}

// Keeps the two conditional rows honest as the CR changes their mind. The rule is
// one-directional on purpose: leaving REPAIR CLEARS the sub-category and its note,
// so a stale "BATTERY" can never ride along under CRASH — which is exactly the kind
// of value that would silently corrupt the Insights counts later.
function wireTriageCategoryRows() {
  const catRow  = document.getElementById('triage-category');
  const subRow  = document.getElementById('triage-subcat-row');
  const subSel  = document.getElementById('triage-subcategory');
  const noteRow = document.getElementById('triage-subcat-note-row');
  const noteIn  = document.getElementById('triage-subcat-note');
  if (!catRow || !subRow || !subSel) return;

  const sync = () => {
    const isRepair = catRow.value === 'REPAIR';
    subRow.style.display = isRepair ? '' : 'none';
    if (!isRepair) {
      subSel.value = '';
      if (noteIn) noteIn.value = '';
    }
    if (noteRow) {
      noteRow.style.display = (isRepair && subSel.value === REPAIR_OTHERS) ? '' : 'none';
      if (!isRepair || subSel.value !== REPAIR_OTHERS) { if (noteIn) noteIn.value = ''; }
    }
  };
  catRow.addEventListener('change', sync);
  subSel.addEventListener('change', sync);
  sync();
}

// ─── The "Assigned to" searchable picker ─────────────────────────────────────
// Three pure functions and three thin DOM handlers. The split is deliberate: the
// parts that decide anything — who matches a query, what the list reads, what a
// typed name resolves to — take their input as an ARGUMENT and touch no element,
// so a test can pin them without a browser. The handlers only move those answers
// in and out of the DOM.
//
// The team directory is stored with `email` as its key, so every comparison here
// is lower-cased and every value handed back is the email. Nothing else in the
// app may be given a name where an email belongs — the assignment notification
// and the permission lookup both key on it.

// Directory rows, name-sorted, the way the old <select> was ordered — the order
// people already have in their heads. Sorted on a COPY so the stored array is
// never re-ordered by a render.
function assigneeRows() {
  return teamDirectory.slice().sort((a, b) =>
    String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')));
}

// The rows a query matches. Empty (or a bare "@", left over from the mention
// habit) matches everyone, so focusing the box shows the whole team and typing
// only narrows it.
function assigneeMatches(query) {
  const q = String(query || '').replace(/^@/, '').trim().toLowerCase();
  const rows = assigneeRows();
  if (!q) return rows;
  return rows.filter(d =>
    String(d.name || '').toLowerCase().includes(q) ||
    String(d.email || '').toLowerCase().includes(q));
}

// The name to put IN the box for a stored email — '' for none, which is exactly
// the "Unassigned" state and what the placeholder then speaks for.
function assigneeDisplayName(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  const hit = teamDirectory.find(d => String(d.email || '').toLowerCase() === e);
  return hit ? (hit.name || hit.email) : email;
}

// The markup of the option list, as a STRING. Building it here rather than in the
// render handler is what lets a test assert the list's content — above all that
// the Unassigned row is ALWAYS present, because a picker you cannot type your way
// back to "nobody" in is a picker that can only ever add assignees.
function assigneeOptionHtml(query) {
  const rows = assigneeMatches(query);
  const row  = (email, name, sub) => `
    <button type="button" class="combo-item" role="option" data-email="${escJsAttr(email)}"
            onmousedown="event.preventDefault()"
            onclick="pickTriageAssignee('${escJsAttr(email)}')">
      <span class="combo-item-name">${escHtml(name)}</span>
      ${sub ? `<span class="combo-item-mail">${escHtml(sub)}</span>` : ''}
    </button>`;
  const unassigned = row('', t('common.unassigned'), '');
  if (!rows.length) {
    return unassigned + `<div class="combo-empty">No one matches “${escHtml(String(query || '').trim())}”.</div>`;
  }
  return unassigned + rows.map(d => row(d.email, d.name || d.email, d.name ? d.email : '')).join('');
}

// Index of the row the arrow keys are on, or -1. Module state rather than a
// data attribute, because the list is rebuilt on every keystroke and a index
// parked in the DOM would be wiped by the rebuild.
let assigneeSuggestIndex = -1;

function renderAssigneeOptions(query) {
  const list = document.getElementById('triage-assignee-list');
  const box  = document.getElementById('triage-assignee');
  if (!list) return;
  assigneeSuggestIndex = -1;
  list.innerHTML = assigneeOptionHtml(query);
  list.dataset.open = '1';
  list.style.display = 'block';
  if (box) box.setAttribute('aria-expanded', 'true');
}

function closeAssigneeOptions() {
  const list = document.getElementById('triage-assignee-list');
  const box  = document.getElementById('triage-assignee');
  assigneeSuggestIndex = -1;
  if (!list) return;
  list.dataset.open = '0';
  list.style.display = 'none';
  if (box) box.setAttribute('aria-expanded', 'false');
}

function assigneeOptionButtons() {
  const list = document.getElementById('triage-assignee-list');
  if (!list || typeof list.querySelectorAll !== 'function') return [];
  return Array.from(list.querySelectorAll('.combo-item'));
}

function highlightAssigneeOptions(items) {
  items.forEach((it, i) => it.classList.toggle('combo-item-active', i === assigneeSuggestIndex));
  const active = items[assigneeSuggestIndex];
  if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
}

// ↑/↓ move, Enter takes, Escape closes. Enter is only swallowed when a row is
// actually highlighted: otherwise the key must reach the form, where it is the
// ordinary "submit" a person expects from a text field.
function onAssigneeKeydown(e) {
  if (!e) return;
  const items = assigneeOptionButtons();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    const n = items.length;
    assigneeSuggestIndex = e.key === 'ArrowDown'
      ? (assigneeSuggestIndex + 1) % n
      : (assigneeSuggestIndex - 1 + n) % n;
    highlightAssigneeOptions(items);
  } else if (e.key === 'Enter') {
    if (assigneeSuggestIndex >= 0 && items[assigneeSuggestIndex]) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      pickTriageAssignee(items[assigneeSuggestIndex].dataset.email || '');
    }
  } else if (e.key === 'Escape') {
    closeAssigneeOptions();
  }
}

function pickTriageAssignee(email) {
  const e = String(email || '').trim();
  const hidden = document.getElementById('triage-assignee-email');
  const box    = document.getElementById('triage-assignee');
  if (hidden) hidden.value = e;
  if (box) box.value = e ? assigneeDisplayName(e) : '';
  closeAssigneeOptions();
}

// What a typed box resolves to, or null when it resolves to nothing. Null is the
// important half: it is what stops a half-typed name from saving as an
// assignment. A bare name that is not in the directory is NOT accepted — the
// assignment notification is addressed by email, and a name would be mailed
// nowhere while the ticket claimed an owner.
function resolveTriageAssignee(text) {
  const raw = String(text || '').trim();
  if (!raw) return { email: '', name: '' };
  const q = raw.toLowerCase();
  if (q === String(t('common.unassigned')).toLowerCase() || q === 'unassigned') return { email: '', name: '' };
  const hit = teamDirectory.find(d =>
    String(d.email || '').toLowerCase() === q ||
    String(d.name || '').toLowerCase() === q ||
    `${d.name || ''} <${d.email || ''}>`.toLowerCase() === q);
  return hit ? { email: hit.email, name: hit.name || hit.email } : null;
}

// Blur is the moment a typed box has to become honest again. Anything that
// resolves is committed; anything that does not is REVERTED to whatever the
// hidden input already holds, so the box can never display a name the save would
// not honour — the one failure that would look like it worked.
function commitAssigneeInput() {
  const box    = document.getElementById('triage-assignee');
  const hidden = document.getElementById('triage-assignee-email');
  if (!box) return;
  const r = resolveTriageAssignee(box.value);
  if (r) {
    if (hidden) hidden.value = r.email;
    box.value = r.email ? assigneeDisplayName(r.email) : '';
  } else {
    box.value = assigneeDisplayName(hidden ? hidden.value : '');
  }
  closeAssigneeOptions();
}

function closeTriageModal() { document.getElementById('triage-modal')?.remove(); }

async function applyTriage() {
  if (!currentIR) return;
  const irNumber = currentIR.irNumber;
  const status   = document.getElementById('triage-status')?.value     || '';
  // The assignee's key is the HIDDEN input, not the box a person types in: the
  // box holds a name to read and the store holds an email to mail and gate by,
  // and applyTriage must never be handed the former.
  const email    = document.getElementById('triage-assignee-email')?.value || '';
  const priority = document.getElementById('triage-priority')?.value   || '';
  const category = document.getElementById('triage-category')?.value   || '';
  const prev     = String(currentIR.assignee || '').toLowerCase();
  const member   = teamDirectory.find(d => String(d.email).toLowerCase() === email.toLowerCase());

  // Category is MANDATORY. It is the one triage field the list filter and the
  // Insights page count by, so a triaged IR without one would be invisible to both
  // — an "uncategorised" hole no report could explain. The sub-category is required
  // too, but only where it exists (REPAIR); the note only under OTHERS.
  if (!category) {
    showToast('Choose a Category before saving Allot CAPS');
    return;
  }
  const isRepair = category === 'REPAIR';
  const subCategory = isRepair ? (document.getElementById('triage-subcategory')?.value || '') : '';
  if (isRepair && !subCategory) {
    showToast('Choose a Sub-category for a REPAIR');
    return;
  }
  const subCategoryNote = (isRepair && subCategory === REPAIR_OTHERS)
    ? (document.getElementById('triage-subcat-note')?.value || '').trim()
    : '';
  // OTHERS is the escape hatch from the nine components: it exists so CR can name a
  // fault the list does not cover. Saving it empty turns the hatch into a blank, and
  // nine-of-nine becomes the same unexplained bucket the categories were introduced
  // to remove.
  if (isRepair && subCategory === REPAIR_OTHERS && !subCategoryNote) {
    showToast('Say what was repaired for an OTHERS sub-category');
    return;
  }

  const patch = { status, statusOwned: true, assignee: email, assigneeName: member ? (member.name || email) : '',
                  priority, category, subCategory, subCategoryNote };
  // `type` is the retired field. patchIRState spread-merges into the STORED row, so
  // simply not sending it would leave the stale key there forever. An explicit
  // undefined is what retires it, per-IR, as CR re-triages.
  patch.type = undefined;
  // Only a real status CHANGE moves the clock. Re-saving the same status must
  // not reset time-in-status, or every triage edit would fake a fresh IR.
  //
  // The comparison is against the ticket's stage, NOT against its stored word. A
  // ticket the Sheet called 'QC Investigation' shows 'Investigation' in the box,
  // and comparing the raw word would read that as a change on every single save —
  // stamping a fresh `statusAt` and wiping the real time-in-status of exactly the
  // old tickets the fold-in is meant to carry forward.
  if (status && status !== canonicalStage(currentIR.status)) {
    patch.statusAt = Date.now();
    patch.statusBy = myEmail() || 'unknown';
  }
  closeTriageModal();
  await patchIRState(irNumber, patch);
  // The category decides which sections apply, and Allot CAPS is where it is set —
  // so the tabs have to be re-decided here, not only when a ticket is opened.
  //
  // The FULL gate, not the applicability pass alone. A category can be changed BOTH
  // ways: re-triaging a REMOTE SUPPORT ticket to REPAIR takes the sections back ON,
  // and the applicability pass only ever writes a Close button as it switches a
  // section off — it has no way to put one back, because the access grant owns the
  // enabled state. Run alone, it would leave five sections visible and working but
  // with their Close buttons dead. The access pass first, the applicability pass
  // second: that order is what makes the pair correct, and it is why every caller
  // of applyCategoryApplicability() is one of these two.
  applySectionAccessGating();
  showToast('Allot CAPS saved');
  loadActivityLog(irNumber);

  // Assignment notifies through the comment machinery already in place — the
  // bell, the unread badge, the 90s poll and the email all work unchanged.
  // Known wart: the email's subject is hardcoded to comment wording in
  // backend.gs, so an assignment notification reads as a comment.
  if (email && email.toLowerCase() !== prev) {
    const n = {
      id: nudgeId(), irNumber, scope: 'ir',
      to: email,
      from: currentUser?.email || 'unknown',
      fromName: currentUser?.name || currentUser?.email || 'Someone',
      message: `You have been assigned ${irNumber}.`,
      mentions: [email], createdAt: Date.now(), readBy: [], status: 'open',
      resolvedAt: null, resolvedBy: null,
    };
    await addNudge(n);
    sendNudgeEmailBackend(n);
  }
}

// ─── LEGACY RECORD: READ-ONLY, FROM THE BACKEND ──────────────────────────────
// The legacy I-PASSBOOK workbook is restricted, so the browser cannot open it and
// the embed that used to live here is gone for good. The RECORDS are not gone:
// getLegacyIR hands back ONE tab as a grid of the cells it displays, read by the
// backend as the file's owner, and this renders it read-only. That is what lets the
// workbook stay restricted — the embed was the only reason it had to remain
// link-shared, and link-sharing is per FILE, not per tab, so one embedded tab kept
// every tab readable by anyone with the address.
//
// One tab per open, so the cost tracks what is actually being looked at: a
// several-hundred-tab workbook is never read to show one record.
//
// The grid becomes label/value rows and is NEVER a <table>. A legacy tab is wide,
// and a phone answers a table with sideways scrolling — the exact thing this app
// refuses to ask of someone reading. A row with one filled cell reads as a heading;
// a row with none is a spacer and is dropped.
let _legacyReq = 0;   // a sequence number, so a superseded fetch cannot paint last

function legacyGridHtml(grid) {
  const rows = Array.isArray(grid) ? grid : [];
  let out = '';
  (rows || []).forEach(row => {
    const filled = (row || []).map(c => String(c == null ? '' : c).trim()).filter(Boolean);
    if (!filled.length) return;                     // blank spacer row — say nothing
    if (filled.length === 1) {
      out += `<div class="legacy-row legacy-row-head"><span class="legacy-value">${escHtml(filled[0])}</span></div>`;
      return;
    }
    out += `<div class="legacy-row">` +
             `<span class="legacy-label">${escHtml(filled[0])}</span>` +
             `<span class="legacy-value">${escHtml(filled.slice(1).join(' · ')).replace(/\n/g, '<br/>')}</span>` +
           `</div>`;
  });
  // A tab that is genuinely empty (or all spacers) says so — an empty card would
  // read as a failed load rather than an empty record.
  return out || '<p class="legacy-empty">This record has no content in the workbook.</p>';
}

// Open one legacy record, read-only. The fetch is the same token-gated shape as
// every other read; the sequence number drops a slow answer that arrives after the
// user has already moved to a different record.
function openLegacyRecord(irNumber) {
  const rec = legacyMap[irNumber] || {};
  const label = rec.label || irNumber || 'Legacy record';
  const req = ++_legacyReq;

  const existing = document.getElementById('legacy-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'legacy-modal';
  modal.innerHTML = `
    <div class="legacy-card legacy-card-record">
      <div class="legacy-head">
        <div>
          <div class="legacy-title">🏛 Legacy I-PASSBOOK</div>
          <div class="legacy-sub">${escHtml(label)} · read-only</div>
        </div>
        <button type="button" class="inward-options-close" onclick="closeLegacyModal()" title="Close">&times;</button>
      </div>
      <div class="legacy-record" id="legacy-record-body">
        <div class="legacy-loading" role="status" aria-live="polite">
          <span class="legacy-spinner" aria-hidden="true"></span>
          <span class="legacy-loading-note">Loading the record…</span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeLegacyModal(); });

  const body = modal.querySelector('#legacy-record-body');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const openLink = url => url
    ? `<a href="${escHtml(url)}" target="_blank" rel="noopener" class="url-open-btn">Open in Google Sheets ↗</a>` : '';
  const openUrl = rec.openUrl || '';

  fetch(`${CONFIG.GAS_URL}?action=getLegacyIR&irNumber=${encodeURIComponent(irNumber)}`,
        { signal: controller.signal })
    .then(r => r.json())
    .then(data => {
      if (req !== _legacyReq) return;               // a newer record is on screen
      if (!data || data.status !== 'ok') throw new Error((data && data.message) || 'getLegacyIR failed');
      body.innerHTML = legacyGridHtml(data.grid) +
        `<p class="legacy-link-note">The original is in a restricted workbook; this copy is read-only. ` +
        openLink(data.openUrl || openUrl) + `</p>`;
    })
    .catch(err => {
      if (req !== _legacyReq) return;
      const timedOut = err && err.name === 'AbortError';
      body.innerHTML =
        `<div class="legacy-error">` +
          `<p>${timedOut ? 'The archive did not answer in time.' : 'Could not load this legacy record.'}</p>` +
          `<p class="legacy-sub">${escHtml((err && err.message) || 'Unavailable.')}</p>` +
          openLink(openUrl) +
        `</div>`;
    })
    .finally(() => clearTimeout(timer));
}

function closeLegacyModal() {
  _legacyReq++;   // a fetch in flight must not paint into a closed modal
  const m = document.getElementById('legacy-modal');
  if (m) m.remove();
}

// The home screen's 🏛 Legacy button: the INDEX of pre-app records (IR1–IR441).
//
// Back button (mobile only — the desktop split pane keeps the list on screen).
// Guarded: it and the title do the same thing, so they ask the same question. The
// guard lives HERE and on the title, never inside goIndex() — goIndex is also the
// programmatic route (an unknown hash, the legacy deep link), and a prompt in the
// middle of a redirect would be a bug, not a safeguard.
backBtn.addEventListener('click', () => { if (confirmLeaveIR()) goIndex(); });

// The product name is the way home from anywhere. It was a plain label; nothing
// about it said so. Same guard as the Back button.
bindHomeLink(headerTitle);

function bindHomeLink(el) {
  if (!el) return;
  el.addEventListener('click', () => { if (confirmLeaveIR()) goIndex(); });
  // role="button" alone is not enough — a div is not focusable and Enter/Space do
  // nothing on it. Space is prevented from scrolling the page, which is what a
  // native button does.
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    if (confirmLeaveIR()) goIndex();
  });
}

// Activity log toggle. Bound once: the panel is static markup that
// renderTimelineInto only ever fills, never replaces.
const activityToggle = document.getElementById('ir-activity-toggle');
if (activityToggle) activityToggle.addEventListener('click', toggleActivity);

// IR banner nudge / comments button
const irNudgeBtn = document.getElementById('ir-nudge-btn');
if (irNudgeBtn) irNudgeBtn.addEventListener('click', openNudgeModalForIR);
// IR banner audit-trail / history button
const irHistoryBtn = document.getElementById('ir-history-btn');
// Wrapped rather than passed directly: openHistoryModal() takes an optional options
// object, and handing it the click event it would otherwise receive is one property
// name away from being read as options.
if (irHistoryBtn) irHistoryBtn.addEventListener('click', () => openHistoryModal());
// IR banner legacy-record button
const irLegacyBtn = document.getElementById('ir-legacy-btn');
if (irLegacyBtn) irLegacyBtn.addEventListener('click', () => {
  if (legacyMap[currentIR?.irNumber]) openLegacyRecord(currentIR?.irNumber);
});
// The pre-app workbook index is GONE from the service desk (the owner, 2026-10-08:
// *"Remove the Legacy Records button from the service desk (since legacy is being
// infused into the app)"*). What stays is the per-IR read-only fallback below: an
// old ticket with nothing in the app yet has nothing else to show, and it goes when
// the infusion in `listLegacyIRs`/`getLegacyIR` lands, not before.

// ─── DRAFT AUTO-SAVE ──────────────────────────────────────────────────────────
// Any edit within a section is persisted as a draft (debounced), so unsaved
// progress survives navigation/reload/failed saves.
let draftTimer = null;
let dispatchRefreshTimer = null;
document.getElementById('sections-wrapper').addEventListener('input', e => {
  const sec = e.target.closest('.section-content');
  if (!sec) return;
  // Synchronous, BEFORE the draft debounce below: the leave guard reads this the
  // moment it is asked, and a 400 ms window of "no changes yet" would let a click
  // straight after a keystroke walk away without a prompt.
  markSectionDirty(sec.id);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft(sec.id), 400);
  // Editing Section B (Inward) changes which goods Section H must verify against —
  // debounce a refresh of the dispatch checklist so it stays in sync.
  if (sec.id === 'sec-b') {
    clearTimeout(dispatchRefreshTimer);
    dispatchRefreshTimer = setTimeout(() => renderDispatchChecklist('h_dispatchChecklist'), 350);
  }
});
document.getElementById('sections-wrapper').addEventListener('change', e => {
  const sec = e.target.closest('.section-content');
  if (sec) { markSectionDirty(sec.id); saveDraft(sec.id); }
});

// ─── FLUSH POINTS ─────────────────────────────────────────────────────────────
// The moments a change would otherwise be lost, and the reason auto-save is safe
// on a phone: leaving a field, the tab going to the background, and the page being
// hidden or closed all push immediately instead of waiting out the 1500 ms pause.
//
// `focusout` rather than `blur` because blur does not bubble out of the wrapper,
// and the listener is on the wrapper rather than on every field because the fields
// are rebuilt from scratch on every IR open.
//
// None of this is awaited or awaited-on-exit: a page being torn down cannot wait
// for a fetch. The localStorage draft is the guarantee that survives that; these
// are only about getting the entry to the server sooner.
document.getElementById('sections-wrapper').addEventListener('focusout', e => {
  const sec = e.target.closest('.section-content');
  if (sec && _dirtySections.has(sec.id)) {
    // Replace the pending pause with an immediate push. Clearing the timer first
    // would otherwise let it fire a second, identical save a second later — which
    // the snapshot check would skip, but only after a pointless DOM read.
    clearTimeout(_autosaveTimers[sec.id]);
    delete _autosaveTimers[sec.id];
    autoSaveUnit(sec.id);
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushDirtyUnits();
});
window.addEventListener('pagehide', flushDirtyUnits);

// The Overview is outside #sections-wrapper (index.html explains why), so it needs
// its own listeners. It has no draft by design, which is exactly why it must feed
// the dirty flag: otherwise its two editable fields are the one place a user can
// lose typing with no warning at all.
const irOverviewPanel = document.getElementById('ir-overview');
if (irOverviewPanel) {
  const noteOverviewEdit = e => {
    if (e.target.closest('#ir-overview-editable')) markSectionDirty(OVERVIEW_KEY);
  };
  irOverviewPanel.addEventListener('input', noteOverviewEdit);
  irOverviewPanel.addEventListener('change', noteOverviewEdit);
}

// ─── TAB NAVIGATION ──────────────────────────────────────────────────────────
// The ONE place a section is shown, so "which pane is open" has a single answer.
// Both the tab press and the category-applicability rule (below) come through here;
// two copies of these four lines is how a pane and its tab end up disagreeing.
function showSection(sectionId) {
  const tab = document.querySelector(`.tab[data-section="${sectionId}"]`);
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
  tab.classList.add('active');
  const pane = document.getElementById(sectionId);
  if (pane) pane.classList.add('active');
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // A tab this ticket's category switches off is not a tab. It stays in the row
    // so the reason can be read, and pressing it SAYS so: a control that greys out
    // and then does nothing at all is what sends someone to an admin about access
    // they already have.
    if (tab.classList.contains('tab-inapplicable')) {
      showToast('Not part of a Remote Support job');
      return;
    }
    showSection(tab.dataset.section);
  });
});

// ─── SECTION FORM BUILDER ────────────────────────────────────────────────────
// Six sections, letters B–G. Two of them are MERGES of what used to be separate
// sections, and the merged field ids were deliberately NOT renamed:
//
//   sec-f  holds  f_*  (ex-QC)        +  g_*  (ex-Flight Test)
//   sec-g  holds  h_*  (ex-PDI)       +  i_*  (ex-Dispatch)
//
// Renaming them would orphan every comment anchored to a field (a `__NUDGES__`
// item carries `fieldId`) and split each field's AUDIT_LOG history across two
// names. Keeping them is also what makes the row migration a one-column rewrite
// rather than a JSON-key rewrite. Field id → section id is resolved by
// FIELD_SECTION_INDEX below, never by guessing the prefix.
//
// There is no `sec-a` entry: Section A became the Overview panel, which is not a
// section and has no form.
const SECTIONS = {
  'sec-b': {
    title: 'Section B — Inward Checklist (Inventory)',
    fields: [
      { id: 'b_inwardDate', label: 'Inward Date',  type: 'date' },
      { id: 'b_inwardBy',   label: 'Inward By (Name)', type: 'text', placeholder: 'Person who performed the inward' },
      { id: 'b_stNo',       label: 'Stock Transfer (ST) No.', type: 'text', placeholder: 'ST number assigned by Inventory' },
      { id: 'b_inwardTable', label: 'Particulars Received', type: 'inwardTable' },
      { id: 'b_inwardPhotos', label: 'Inward Photos (Image or PDF)', type: 'imageEvidence' },
      { id: 'b_remarks',    label: 'Remarks', type: 'textarea', placeholder: 'Condition at receiving, missing items, observations, etc.' },
    ]
  },
  'sec-c': {
    title: 'Section C — IQC Visual Inspection',
    fields: [
      { id: 'c_iqcDate',      label: 'Inspection Date', type: 'date' },
      { id: 'c_iqcBy',        label: 'Inspected By',    type: 'text', placeholder: 'IQC inspector name' },
      { id: 'c_iqcTable',     label: 'Visual Inspection Checklist', type: 'iqcTable' },
      { id: 'c_iqcPhotos',    label: 'Inspection Photos (Image or PDF)', type: 'imageEvidence' },
      { id: 'c_remarks',      label: 'Remarks', type: 'textarea', placeholder: 'Overall inspection remarks, observations, summary...' },
    ]
  },
  // Section D — Investigation, in two parts:
  //  Part A. Investigation (Flight Data Analysis) — signed off by the QC Manager.
  //  Part B. Cost Analysis (Repair Estimate & Lead Time) — signed off by the Purchase Manager.
  // The damage-report sub-section is deferred (later development).
  'sec-d': {
    title: 'Section D — Investigation',
    fields: [
      // ── Part A — Investigation ──
      { id: 'd_partA',            label: 'Part A — Investigation',          type: 'divider' },
      { id: 'd_analysisBy',     label: 'Analysis Performed By', type: 'text', placeholder: 'Engineer / analyst name' },
      { id: 'd_analysisDate',   label: 'Analysis Date',         type: 'date' },
      // Written ONLY by the Log Analyser's "Push to IR" — there is no input for it,
      // so it is read back from the section's own data on load and carried through
      // every save (see collectSectionValues). It sits above the free-text fields
      // because it is the evidence those fields are about.
      { id: 'd_logAnalysis',    label: 'Flight Log Analysis',    type: 'logAnalysis' },
      { id: 'd_intro',          label: '',                       type: 'analysisNote' },
      { id: 'd_investigation',  label: 'Description of Investigation', type: 'textarea', placeholder: 'Summarise the investigation performed, logs/telemetry reviewed, tests done...' },
      { id: 'd_evidence',       label: 'Investigation Evidence (Images)', type: 'imageEvidence' },
      { id: 'd_rootCause',      label: 'Root Cause',             type: 'textarea', placeholder: 'The underlying cause identified...' },
      { id: 'd_correctiveAction',  label: 'Corrective Action',   type: 'textarea', placeholder: 'Action taken to correct the issue / fix this unit...' },
      { id: 'd_preventiveAction',  label: 'Preventive Action',   type: 'textarea', placeholder: 'Action to prevent recurrence across systems / process...' },

      // ── Part B — Cost Analysis (Repair Estimate & Lead Time) ──
      { id: 'd_partB',              label: 'Part B — Cost Analysis (Repair Estimate &amp; Lead Time)', type: 'divider' },
      { id: 'd_warrantyQualified',  label: 'Is This Repair Qualified For Cover Under Warranty? (Yes/No)', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'd_repairTable',        label: 'Particulars For Repair / Replace', type: 'costTable' },
      { id: 'd_leadTime',           label: 'Estimated Lead Time', type: 'text', placeholder: 'e.g. 7–10 working days' },
      { id: 'd_goAhead',            label: 'Received Go Ahead By The Customer?', type: 'select', options: ['', 'Yes', 'No'] },
    ]
  },
  'sec-e': {
    title: 'Section E — Production (Rework)',
    fields: [
      { id: 'e_prodDocs',     label: 'Route Card / Job Card (Image or PDF)', type: 'imageEvidence' },
      { id: 'e_prodRemarks',  label: 'Rework Details / Remarks',    type: 'textarea', placeholder: 'Describe the rework performed, observations, notes for QC...' },
    ]
  },
  // Quality Test Report — a merge of the old QC section and the old Flight Test
  // section. Both are QC tests, so they belong on one report. The field ids keep
  // their original `f_`/`g_` prefixes (see the note above SECTIONS).
  'sec-f': {
    title: 'Section F — Quality Test Report',
    fields: [
      { id: 'f_qcDocs',       label: 'QC Report (Image or PDF)', type: 'imageEvidence' },
      { id: 'f_qcRemarks',    label: 'QC Remarks',        type: 'textarea', placeholder: 'Additional observations...' },

      // ── Part B — Flight Test ──
      { id: 'f_partFlight',    label: 'Flight Test', type: 'divider' },
      // Basic + Mission are ONE field now. The id stays `g_basicReport` so the audit
      // history and every anchored comment on it survive; the saved contents of the
      // retired `g_missionReport` are folded in when this section is loaded, by the
      // imageEvidence branch of populateFieldValue().
      { id: 'g_basicReport',   label: 'Flight Test Report (Image or PDF)', type: 'imageEvidence' },
      { id: 'g_flightLogs',     label: 'Data Check — Flight Logs',     type: 'checkpointEvidence', tickLabel: 'Flight Logs data check performed & verified' },
      { id: 'g_postProcessing', label: 'Data Check — Post-Processing', type: 'checkpointEvidence', tickLabel: 'Post-processing data check performed & verified' },
      { id: 'g_dataCheckRemarks', label: 'Data Check Remarks', type: 'textarea', placeholder: 'Notes on flight logs / post-processing checks...' },
    ]
  },
  // PDI Report/Dispatch Record — a merge of the old PDI section and the old
  // Logistics & Dispatch section. Inspecting the packed goods and dispatching
  // them is one handover, recorded once.
  'sec-g': {
    title: 'Section G — PDI Report/Dispatch Record',
    fields: [
      { id: 'h_pdiDocs',     label: 'PDI Report (Image or PDF)', type: 'imageEvidence' },
      { id: 'h_pdiRemarks',  label: 'PDI Remarks',         type: 'textarea', placeholder: 'Packing instructions, special notes...' },
      { id: 'h_dispatchChecklist', label: 'Cross Check Particulars — received (Section B) vs packed for dispatch', type: 'dispatchChecklist' },
      { id: 'h_pdiResult',   label: 'PDI Result',          type: 'select', options: ['Pass – Ready to Dispatch','Fail – Return to QC'] },

      // ── Part B — Dispatch ──
      { id: 'g_partDispatch', label: 'Dispatch', type: 'divider' },
      { id: 'i_dispatchDate', label: 'Dispatch Date',      type: 'date' },
      { id: 'i_courier',      label: 'Courier / Transporter', type: 'courierName', default: 'Bluedart' },
      { id: 'i_courierTrackId', label: 'Courier Tracking ID', type: 'text', placeholder: 'AWB / docket / tracking number' },
      { id: 'i_clientReceivedDate', label: 'Client Received the Courier Date', type: 'date' },
      { id: 'i_dispatchPhotos', label: 'Attachments (Image or PDF)', type: 'imageEvidence' },
      { id: 'i_remarks',      label: 'Logistics Remarks',  type: 'textarea', placeholder: 'Special instructions, insurance, etc.' },
    ]
  },
};

// Field id → section id, built once from SECTIONS so a merged section resolves
// its inherited ids correctly. `g_missionReport` belongs to `sec-f` and
// `i_courier` to `sec-g`; the prefix says otherwise, which is exactly why this
// index exists. Used by sectionIdFromFieldId() and by the nudge/comment anchor
// resolution, which needs to know which section a field is rendered in.
const FIELD_SECTION_INDEX = (() => {
  const idx = {};
  Object.entries(SECTIONS).forEach(([sectionId, section]) => {
    section.fields.forEach(f => { idx[f.id] = sectionId; });
  });
  return idx;
})();

function buildSectionForms(irNumber) {
  // Fresh IR, fresh forms: nothing here is unsaved yet. restoreDrafts() runs after
  // this and re-marks the sections it puts text back into — those really ARE
  // unsaved, and the leave guard must treat them that way.
  _dirtySections.clear();
  updateDirtyIndicators();

  Object.entries(SECTIONS).forEach(([sectionId, section]) => {
    const container = document.getElementById(sectionId + '-form') || document.getElementById(sectionId).querySelector('div');
    if (!container) return;
    container.innerHTML = section.fields.map(f => buildField(f, irNumber, sectionId)).join('');
    // Wire up file inputs for live preview
    container.querySelectorAll('input[type=file]').forEach(inp => {
      inp.addEventListener('change', handleFilePreview);
    });
  });

  // Wire the one remaining button per section. There is no Save button any more:
  // the auto-save scheduler runs from markSectionDirty(), which the input listener
  // already calls on every keystroke, so nothing needs wiring for it.
  //
  // The Close button carries the section id as its ARGUMENT rather than reading it
  // back out of the DOM, because `close-sec-b` is the one place the id appears and
  // deriving it from the element id would silently break the day a section is
  // renamed.
  Object.keys(SECTIONS).forEach(secId => {
    const btn = document.getElementById('close-' + secId);
    if (btn) btn.onclick = () => closeSection(secId, irNumber);
    // A freshly built form holds exactly what is stored, so the honest starting
    // state of the indicator is "Saved" — and if this IR has already closed the
    // section, the button says so before any click in this session.
    setAutosaveNote(secId, 'saved');
    delete _autosaveSnapshots[secId];
    delete _autosaveFailed[secId];
  });
  paintClosedSections(irNumber);

  // Wire the per-section export buttons. Exporting is a READ, so these are wired
  // for every user and exempted from the view-only disable below.
  Object.keys(SECTIONS).forEach(secId => {
    const dl = document.getElementById('download-' + secId);
    if (dl) { dl.classList.add('sec-export-btn'); dl.onclick = () => exportSectionPdf(secId, { share: false }); }
    const sh = document.getElementById('share-' + secId);
    if (sh) { sh.classList.add('sec-export-btn'); sh.onclick = () => exportSectionPdf(secId, { share: true }); }
  });

  // Wire the pinned Overview's save button. Not part of the SECTIONS loop above:
  // the Overview is not a section, so it has no `save-sec-*` id to pick up.
  const btnOverview = document.getElementById('save-overview');
  if (btnOverview) btnOverview.onclick = () => saveOverview();

  // Inject a comment button after each section title (per-section tagging)
  Object.keys(SECTIONS).forEach(secId => {
    const sec = document.getElementById(secId);
    if (!sec || sec.querySelector('.sec-nudge-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sec-nudge-btn';
    btn.dataset.sectionId = secId;
    btn.innerHTML = iconSvg('comment') + '<span class="comment-count" style="display:none;">0</span>';
    btn.title = 'Comments on this section';
    btn.onclick = () => openNudgeModalForSection(secId);
    const h2 = sec.querySelector('.section-title');
    if (h2) h2.appendChild(btn);
  });

  // Initialize URL link buttons for any pre-populated URL fields
  document.querySelectorAll('.url-field-wrapper input[type="url"]').forEach(inp => {
    if (inp.value) updateUrlLink(inp.id);
  });

  // Apply per-section access gating (tab/pane visibility, Save/comment buttons,
  // input enabling). Runs after every build so it reflects current access.
  applySectionAccessGating();
}

// Gate the open passbook by the caller's per-section permissions.
//  - !canView   → hide the tab and its pane entirely.
//  - canView only → keep the pane visible but disable every input (no edits,
//                  no signature, no add-row) so a view-only user can't type
//                  unsavable values. Save buttons are disabled.
//  - !canComment → hide the 💬 section/field comment buttons.
function applySectionAccessGating() {
  SECTION_IDS.forEach(secId => {
    const tab = document.querySelector(`.tab[data-section="${secId}"]`);
    const pane = document.getElementById(secId);
    if (!pane) return;
    const view = canViewSection(secId);
    const edit = canEditSection(secId);
    const comment = canCommentSection(secId);

    // Tab + pane visibility
    if (tab) tab.style.display = view ? '' : 'none';
    // If the hidden pane is the currently-active tab, fall back to the first
    // visible one so the user never lands on a blank hidden section. The 📋
    // Report tab is excluded: it is never gated, so it would always win the
    // fallback and land a user on the client report instead of their first
    // permitted section.
    if (!view && tab && tab.classList.contains('active')) {
      tab.classList.remove('active');
      pane.classList.remove('active');
      const firstVisible = document.querySelector('.tab:not([style*="display: none"]):not([data-intake])');
      if (firstVisible) { firstVisible.classList.add('active'); const fp = document.getElementById(firstVisible.dataset.section); if (fp) fp.classList.add('active'); }
    }

    // The Close button is now the ONLY write control in a section, so it is what
    // the per-section edit grant has to gate. It used to be Save; the grant did not
    // change, the control that carries it did — and a view-only user must not be
    // able to close a section any more than they could save one.
    const closeBtn = document.getElementById('close-' + secId);
    if (closeBtn) {
      closeBtn.disabled = !edit;
      closeBtn.style.opacity = edit ? '' : '0.5';
      closeBtn.style.cursor = edit ? '' : 'not-allowed';
      closeBtn.title = edit ? '' : 'You have view-only access to this section';
    }

    // View-only → disable every editable control in the pane (locked intake
    // fields are already readonly; this catches the editable ones).
    if (view && !edit) {
      pane.querySelectorAll('input, textarea, select, button').forEach(el => {
        if (el.id === 'nudge-bell' || el.classList.contains('sec-nudge-btn')) return;
        // Exporting a section is a read: a view-only user may still download it or
        // share it. Only writing is gated.
        if (el.classList.contains('sec-export-btn')) return;
        if (el.type === 'file') { el.disabled = true; return; }
        // A comment button is about commenting, so it survives for anyone who can
        // comment — which, since comment comes WITH view, is everyone who can see
        // the section at all.
        //
        // The add-row and add-evidence buttons are WRITES and belong to the same
        // gate as Save. They used to share the comment button's exemption, and that
        // exemption is almost always satisfied, so they stayed LIVE on a view-only
        // screen. Clicking them ran `addEvidenceImage`, which clicks `-picker` — an
        // input disabled a few lines above — and a disabled control has no
        // activation behaviour, so the file dialog never opened. No error, no
        // message, no effect: a button that hovers like a live one and does nothing.
        // Reported from the field on a laptop and blamed on the browser, because an
        // admin never sees it (admins skip this whole block).
        if (el.classList.contains('btn-add-row') || el.classList.contains('btn-add-evidence')) {
          el.disabled = true; el.style.opacity = '0.5'; el.style.cursor = 'not-allowed';
          el.title = 'You have view-only access to this section';
          return;
        }
        if (el.classList.contains('field-nudge-btn')) {
          if (!comment) { el.disabled = true; el.style.opacity = '0.5'; el.style.cursor = 'not-allowed'; }
          return;
        }
        // A field's HISTORY button is a READ and survives for the same reason
        // exporting a section does: a view-only user may look at what changed and
        // who changed it. This is safe precisely because the button only opens a
        // read-only view — the restore it may offer is rendered inside the history
        // modal, which is mounted on document.body (outside every pane, so this
        // sweep never reaches it) and therefore checks canEditSection() itself. A
        // control mounted outside a pane cannot inherit the pane's gate; that is
        // exactly how the add-row/add-evidence buttons ended up live on a view-only
        // screen, and it is why the check is stated at the render site.
        if (el.classList.contains('field-hist-btn')) return;
        el.disabled = true;
      });
    }

    // Section 💬 comment button visibility
    const secNudge = pane.querySelector('.sec-nudge-btn');
    if (secNudge) secNudge.style.display = comment ? '' : 'none';
    // Field 💬 buttons
    pane.querySelectorAll('.field-nudge-btn').forEach(b => { b.style.display = comment ? '' : 'none'; });
  });
  // The Overview is not in SECTION_IDS — it has no tab to hide and no per-section
  // grant — so it is gated separately, on the Triage flag alone.
  applyOverviewGating();
  // Access is settled; now switch off the sections this ticket's CATEGORY makes
  // meaningless. A separate axis from access, and a separate pass, so neither can
  // be mistaken for the other: access says who may write, this says what applies.
  applyCategoryApplicability();
}

// ─── CATEGORY APPLICABILITY: "this step is not part of this job" ──────────────
// Before this, a section was only ever ACCESS-granted or not, and `done[]` means
// FINISHED rather than applicable — so nothing in the app could say that a step is
// not part of the job at all. A REMOTE SUPPORT ticket is exactly that: nothing is
// unloaded, nothing is inspected, nothing is reworked or dispatched. Its five work
// sections go OFF and Investigation stays open, because a remote job is diagnosed
// and then closed.
//
// OFF, NOT HIDDEN. A tab that vanishes reads as a permission problem and sends
// someone to an admin to ask for access they already have. A greyed tab that
// explains itself — and that answers a press with the reason — says what is true.
//
// The pane is switched off along with its tab, because the tab is not the only way
// into a section: a deep link, a back-navigation and a restored view all land on the
// pane directly. And the Close button is disabled with it, because Close is the only
// WRITE control a section has — the same reason it is what the edit grant gates.
const REMOTE_SUPPORT_KEEPS = ['sec-d'];   // Investigation — the one a remote job needs

function categoryInapplicableSections(ir) {
  if (!ir || ir.category !== 'REMOTE SUPPORT') return [];
  return SECTION_IDS.filter(id => !REMOTE_SUPPORT_KEEPS.includes(id));
}

// MUST run immediately AFTER the access pass, never on its own.
//
// It is one-directional by design: it turns sections off, and the only thing it ever
// writes to Close is "disabled, with the reason". Putting a section back is the
// ACCESS pass's job — it owns whether the caller may write there at all — so a pass
// that ran alone could switch a section back on and leave its Close button dead.
// Both callers (applySectionAccessGating, and Allot CAPS through it) get that order
// for free; nothing else may call this directly.
function applyCategoryApplicability() {
  const off = new Set(categoryInapplicableSections(currentIR));
  SECTION_IDS.forEach(secId => {
    const tab  = document.querySelector(`.tab[data-section="${secId}"]`);
    const pane = document.getElementById(secId);
    const isOff = off.has(secId);
    if (tab) {
      tab.classList.toggle('tab-inapplicable', isOff);
      tab.setAttribute('aria-disabled', isOff ? 'true' : 'false');
      tab.title = isOff ? 'Not part of a Remote Support job' : '';
    }
    if (pane) {
      pane.classList.toggle('is-inapplicable', isOff);
      const closeBtn = document.getElementById('close-' + secId);
      if (closeBtn && isOff) {
        closeBtn.disabled = true;
        closeBtn.style.opacity = '0.5';
        closeBtn.style.cursor = 'not-allowed';
        closeBtn.title = 'Not part of a Remote Support job';
      }
    }
  });
  // Never leave the user standing in a section that has just gone off — the category
  // can change under an open tab, because Allot CAPS writes it.
  const active = document.querySelector('.tab.active[data-section]');
  if (active && off.has(active.dataset.section)) showSection(REMOTE_SUPPORT_KEEPS[0]);
}

function buildField(field, irNumber, sectionId) {
  const id = field.id;
  let control = '';

  // The auto-fill map that used to live here populated the ten locked intake
  // fields of Section A. Those fields are not built any more — the Overview panel
  // renders them from currentIR directly, read-only — so there is nothing left to
  // pre-fill and no field here is intake-sourced.
  const val = '';
  // Escape for safe insertion into an HTML attribute or textarea content
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  if (field.type === 'divider') {
    // A sub-section heading band used to split a section into parts (Part A / Part B).
    // Returns early: no label row, no nudge button, no value to save.
    return `<div class="section-divider" id="${id}">${field.label || ''}</div>`;
  } else if (field.type === 'textarea') {
    control = `<textarea id="${id}" class="form-input" placeholder="${field.placeholder || ''}" ${field.readonly ? 'readonly' : ''}>${esc(val)}</textarea>`;
  } else if (field.type === 'select') {
    const opts = field.options.map(o => `<option value="${o}">${o}</option>`).join('');
    control = `<select id="${id}" class="form-input">${opts}</select>`;
  } else if (field.type === 'courierName') {
    // Courier selector with a preset list + "Other (type name)…" fallback.
    // Default courier (e.g. Bluedart) is pre-selected; choosing Other reveals a
    // free-text input so any non-standard transporter can be named.
    const presets = (field.options && field.options.length) ? field.options : ['Bluedart', 'DTDC', 'FedEx', 'DHL', 'India Post'];
    const def = field.default || presets[0] || 'Bluedart';
    const optHtml = presets.map(o => `<option value="${esc(o)}"${o === def ? ' selected' : ''}>${esc(o)}</option>`).join('')
      + `<option value="__other__">Other (type name)…</option>`;
    control = `
      <div class="courier-name-wrap" id="${id}-wrap">
        <select id="${id}" class="form-input" onchange="onCourierNameChange('${esc(id)}')">${optHtml}</select>
        <input type="text" id="${id}-other" class="form-input courier-other" placeholder="Type courier name" style="display:none;" />
      </div>`;
  } else if (field.type === 'file') {
    control = `
      <div class="file-upload-wrapper" onclick="document.getElementById('${escJsAttr(id)}').click()">
        <span style="font-size:1.5rem;">📎</span>
        <span style="font-size:0.85rem; margin-top:4px;">Tap to attach photo or file</span>
        <input type="file" id="${id}" class="file-upload-input" accept="image/*,application/pdf" ${field.multiple ? 'multiple' : ''} />
      </div>
      <div class="photo-previews" id="${id}-previews"></div>
    `;
  } else if (field.type === 'checklist') {
    const rows = field.items.map((item, i) => `
      <div class="checklist-row">
        <label class="checklist-label">${item}</label>
        <select class="checklist-select" id="${id}_${i}">
          <option value="">—</option>
          <option value="Received">✔ Received</option>
          <option value="Missing">✘ Missing</option>
          <option value="Damaged">⚠ Damaged</option>
          <option value="N/A">N/A</option>
        </select>
      </div>
    `).join('');
    control = `<div>${rows}</div>`;
  } else if (field.type === 'costTable') {
    // Repair/Replace estimate table mirroring the I-PASSBOOK sheet Section D Part B:
    // columns # | Item description | Qty | Unit cost | Total cost (auto = Qty ×
    // Unit cost) | Remark, with a Total row INSIDE the same grid, under the Total
    // cost column.
    //
    // The words are the owner's: he asked for "a simple table which had item
    // description-qty-unit cost-total cost columns for each row. At the end total
    // comes." The old headers said Particulars / Rate / Cost, and the second one
    // repeated this field's own label verbatim — the field name printed twice, plus
    // a header row that vanished entirely on a phone, leaving five unlabelled boxes
    // stacked with nothing saying which was which.
    const initialRows = 3;
    let rowsHtml = '';
    for (let i = 1; i <= initialRows; i++) rowsHtml += buildCostRow(i);
    control = `
      <div class="cost-table-wrapper" id="${id}">
        <div class="cost-table-header">
          <span class="cost-cell cost-cell-sn">#</span>
          <span class="cost-cell cost-cell-particular">Item description</span>
          <span class="cost-cell cost-cell-qty">Qty</span>
          <span class="cost-cell cost-cell-rate">Unit cost</span>
          <span class="cost-cell cost-cell-cost">Total cost</span>
          <span class="cost-cell cost-cell-remark">Remark</span>
          <span class="cost-cell cost-cell-del"></span>
        </div>
        <div class="cost-table-body" id="${id}-body">${rowsHtml}</div>
        <button type="button" class="btn-add-row" onclick="addCostRow('${escJsAttr(id)}')">+ Add Row</button>
        <div class="cost-total">
          <span class="cost-total-label">Total Repair Cost</span>
          <span class="cost-total-value">&#8377;<span id="${id}-total">0.00</span></span>
        </div>
      </div>
    `;
  } else if (field.type === 'inwardTable') {
    const rows = INWARD_PARTICULARS.map((p, i) => {
      const opts = p.options ? (inwardOptions[p.options] || []) : null;
      const modelControl = opts
        ? `<select class="form-input inward-model" data-particular="${esc(p.name)}"><option value=""></option>${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`
        : `<input type="text" class="form-input inward-model" data-particular="${esc(p.name)}" placeholder="Enter value" />`;
      return `
        <div class="inward-row">
          <span class="inward-sn">${i + 1}</span>
          <span class="inward-particular">${esc(p.name)}</span>
          ${modelControl}
          <input type="number" min="0" class="form-input inward-qty" data-particular="${esc(p.name)}" placeholder="Qty" />
          <input type="text" class="form-input inward-remark" data-particular="${esc(p.name)}" placeholder="Remark" />
        </div>`;
    }).join('');
    const adminBtn = isInwardAdmin()
      ? `<button type="button" class="btn-inward-options" onclick="openInwardOptionsModal()">&#9881; Manage Dropdown Options</button>`
      : '';
    control = `
      <div class="inward-table-wrapper" id="${id}">
        <div class="inward-table-header">
          <span class="inward-sn">#</span>
          <span class="inward-particular">Particulars</span>
          <span class="inward-model-h">Model / Value</span>
          <span class="inward-qty">Qty</span>
          <span class="inward-remark-h">Remark</span>
        </div>
        <div class="inward-table-body">${rows}</div>
        ${adminBtn}
      </div>
    `;
  } else if (field.type === 'iqcTable') {
    const adminBtn = isAdmin()
      ? `<button type="button" class="btn-inward-options" onclick="openIqcConfigModal()">&#9881; Manage Inspection Points &amp; Dropdowns</button>`
      : '';
    control = `
      <div class="iqc-table-wrapper" id="${id}">
        <div class="iqc-table-header">
          <span>Zone / Item</span>
          <span>Visual Checks To Perform</span>
          <span>Result</span>
          <span>Remark</span>
        </div>
        <div class="iqc-table-body">${buildIqcRowsHTML()}</div>
        ${adminBtn}
      </div>`;
  } else if (field.type === 'logAnalysis') {
    // Read-only, and machine-written: the Log Analyser's "Push to IR" is the only
    // thing that ever puts a value here. An empty container is built and
    // populateFieldValue() fills it from the loaded section data.
    control = `<div class="log-analysis" id="${id}"></div>`;
  } else if (field.type === 'analysisNote') {
    // Dynamic read-only intro line: "Dear customer, analysis of IRXXX for your
    // system with ID XXXXX has been completed. Its findings are as below."
    const irNum  = currentIR?.irNumber || 'IRXXX';
    const drone = currentIR?.droneId || 'XXXXX';
    control = `
      <div class="analysis-note" id="${id}">
        Dear customer, analysis of <strong>${escHtml(irNum)}</strong> for your system with ID <strong>${escHtml(drone)}</strong> has been completed. Its findings are as below.
      </div>`;
  } else if (field.type === 'imageEvidence') {
    control = `
      <div class="image-evidence" id="${id}-wrap" data-field="${id}">
        <div class="image-evidence-list" id="${id}-list"></div>
        <div class="evidence-actions">
          <button type="button" class="btn-add-evidence" onclick="addEvidenceImage('${escJsAttr(id)}')">+ Add image / PDF</button>
          <button type="button" class="btn-add-evidence" onclick="captureEvidenceImage('${escJsAttr(id)}')">📷 Capture photo</button>
        </div>
        <input type="file" id="${id}-picker" accept="image/*,application/pdf" multiple style="display:none;" onchange="onEvidencePicked('${id}', this)" />
        <input type="file" id="${id}-capture" accept="image/*" capture="environment" style="display:none;" onchange="onEvidencePicked('${id}', this)" />
      </div>`;
  } else if (field.type === 'checkpointEvidence') {
    // A data-check checkpoint: a tick the QC person marks "done" PLUS an
    // image/PDF attachment (with preview + capture), grouped as one block.
    // The attachment reuses the imageEvidence machinery under `<id>_attach`.
    const attachId = id + '_attach';
    control = `
      <div class="checkpoint-block" id="${id}">
        <label class="checkpoint-tick">
          <input type="checkbox" id="${id}_done" onchange="onCheckpointTick('${escHtml(id)}')" />
          <span class="checkpoint-tick-label">${escHtml(field.tickLabel || 'Data check performed &amp; verified')}</span>
        </label>
        <div class="image-evidence" id="${attachId}-wrap" data-field="${attachId}">
          <div class="image-evidence-list" id="${attachId}-list"></div>
          <div class="evidence-actions">
            <button type="button" class="btn-add-evidence" onclick="addEvidenceImage('${escJsAttr(attachId)}')">+ Add image / PDF</button>
            <button type="button" class="btn-add-evidence" onclick="captureEvidenceImage('${escJsAttr(attachId)}')">📷 Capture photo</button>
          </div>
          <input type="file" id="${attachId}-picker" accept="image/*,application/pdf" multiple style="display:none;" onchange="onEvidencePicked('${escHtml(attachId)}', this)" />
          <input type="file" id="${attachId}-capture" accept="image/*" capture="environment" style="display:none;" onchange="onEvidencePicked('${escHtml(attachId)}', this)" />
        </div>
      </div>`;
  } else if (field.type === 'dispatchChecklist') {
    // Dispatch-vs-received-goods checklist. Items are sourced dynamically from
    // Section B (Inward) at render time, so the operator verifies the exact same
    // goods go back out. Rendered empty here; filled by renderDispatchChecklist()
    // once Section B data is available (on load / when B is edited).
    control = `<div class="dispatch-checklist" id="${id}" data-field="${id}"></div>`;
  } else if (field.type === 'url') {
    control = `
      <div class="url-field-wrapper">
        <input type="url" id="${id}" class="form-input" placeholder="${field.placeholder || ''}" value="${esc(val)}" oninput="updateUrlLink('${id}')" />
        <a id="${id}-open" href="#" target="_blank" class="url-open-btn" style="display:none;">Open &#8599;</a>
      </div>
    `;
  } else if (field.type === 'readonlyLinks') {
    // Read-only display of one or more URLs / text lines (e.g. form evidence
    // uploads). Splits the value on whitespace/newlines/commas; anything that
    // looks like a URL becomes an openable link, everything else is plain text.
    const tokens = String(val || '').split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    const linkHtml = t => {
      const e = esc(t);
      return /^https?:\/\//i.test(t)
        ? `<a href="${e}" target="_blank" rel="noopener" class="readonly-link">${e}</a>`
        : `<span class="readonly-text">${e}</span>`;
    };
    control = `<div id="${id}" class="readonly-links-box">${tokens.length ? tokens.map(linkHtml).join('<br/>') : '<span class="readonly-text">&mdash;</span>'}</div>`;
  } else {
    // text, number, date, email, tel
    control = `<input type="${field.type}" id="${id}" class="form-input" placeholder="${field.placeholder || ''}" value="${esc(val)}" ${field.readonly ? 'readonly style="opacity:0.6"' : ''} />`;
  }

  // Locked intake fields are auto-populated from the customer form and editable
  // by NO ONE. They render read-only with a lock marker. (Per-section edit
  // gating is applied at the section level in buildSectionForms, not here.)
  const locked = !!field.locked;
  const lockIcon = locked ? ' <span class="field-lock-icon" title="Auto-filled from the customer IR form — not editable">&#128274;</span>' : '';
  // Per-field nudge / comment button. Hidden when the whole section isn't
  // commentable for this user (skipped for the two read-only types too — an
  // analysis note and a pushed flight-log report are not stored values anyone can
  // annotate, so a button there could only ever be noise).
  const noFieldBtns = field.type === 'analysisNote' || field.type === 'logAnalysis';
  const canFieldComment = sectionId ? canCommentSection(sectionId) : true;
  const fieldNudgeBtn = (field.type && !noFieldBtns && canFieldComment && !locked)
    ? `<button type="button" class="field-nudge-btn" data-field-id="${escJsAttr(id)}" title="Comments on this field" onclick="openNudgeModalForField('${escJsAttr(id)}')">${iconSvg('comment')}<span class="comment-count" style="display:none;">0</span></button>`
    : '';
  // Per-field HISTORY button — the field-level half of the same idea as the ticket's
  // own 🕓 History button, and it lives in the same slot as the 💬 button for the
  // same reason: it is about THIS field, and the field's label is the only place
  // that says which field a thing is about.
  //
  // Rendered ALWAYS (the audit is fetched on click, never pre-fetched for every
  // field of every open ticket), and skipped exactly where the 💬 button is: a
  // read-only analysis note is not a stored value, and a locked intake field is
  // auto-filled and editable by no one, so its history is permanently empty and a
  // button that can only ever say "nothing here" is noise.
  //
  // Viewing history is a READ, so this button deliberately survives the view-only
  // disable sweep — see applySectionAccessGating. The WRITE that history can offer
  // (putting an old value back) is gated separately, where it is rendered.
  const fieldHistBtn = (field.type && !noFieldBtns && !locked)
    ? `<button type="button" class="field-hist-btn" data-field-id="${escJsAttr(id)}" title="History of this field" onclick="openFieldHistory('${escJsAttr(id)}')">${iconSvg('clock')}</button>`
    : '';
  const fieldBtns = fieldNudgeBtn + fieldHistBtn;
  const labelHtml = field.label
    ? `<label class="form-label${locked ? ' field-locked-label' : ''}" for="${id}">${field.label}${lockIcon}${fieldBtns}</label>`
    : (fieldBtns ? `<div class="form-label">${fieldBtns}</div>` : '');

  return `
    <div class="form-group${locked ? ' field-locked' : ''}">
      ${labelHtml}
      ${control}
    </div>
  `;
}

// ─── ACTIVITY TABLE HELPERS ────────────────────────────────────────────────────

// Convert a backend date value to 'yyyy-MM-dd' for <input type="date">.
// Handles ISO dates, GAS 'dd-MMM-yyyy' (dateRaised), and Date.toString()
// output (incidentDate from a form date question). Returns '' if unparseable.
function toISODate(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                 // already ISO
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);     // dd-MMM-yyyy
  if (m) {
    const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                     Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
    const mon = months[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(s);                                       // Date.toString() etc.
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The hand-typed activity table is retired — the Overview panel's timeline is
// generated from what the app already records, so nobody fills this in any more.
// What was already typed is kept and shown READ-ONLY by the Overview: same
// four-column grid, spans instead of inputs, so the layout needs no new CSS.
function buildLegacyActivityRow(row) {
  const r = row || {};
  return `
    <div class="activity-table-row is-readonly">
      <span class="act-day">${escHtml(r.dayCount || r.day || '')}</span>
      <span class="act-date">${escHtml(r.date || '')}</span>
      <span class="act-activity">${escHtml(r.activity || '')}</span>
      <span class="act-remark">${escHtml(r.remark || '')}</span>
    </div>
  `;
}

// ─── COST TABLE (Section D Part B) ────────────────────────────────────────────
// Repair/Replace estimate rows: Item description | Qty | Unit cost | Total cost
// (auto = Qty × Unit cost) | Remark, with a Total row under the table.
//
// Every control is wrapped in a labelled cell. On desktop the label inside is
// hidden and the column header above does the naming, so the words appear exactly
// once; at phone width the header is gone and that same label comes out to the
// LEFT of its control. One markup, two widths — and the name of every field is
// always on screen in the place that width can actually show it.

function costCell(cls, label, inner) {
  return `<label class="cost-cell ${cls}">` +
         `<span class="cost-cell-label">${label}</span>${inner}</label>`;
}

function buildCostRow(sn) {
  const escSn = (sn == null ? '' : sn);
  return `
    <div class="cost-table-row">
      <label class="cost-cell cost-cell-sn">
        <span class="cost-cell-label">Row</span>
        <input type="number" class="form-input cost-sn" value="${escSn}" readonly aria-label="Row number" />
      </label>
      ${costCell('cost-cell-particular', 'Item description',
        '<input type="text" class="form-input cost-particular" placeholder="Item description..." />')}
      ${costCell('cost-cell-qty', 'Qty',
        '<input type="number" class="form-input cost-qty" placeholder="0" min="0" step="any" oninput="recalcCostRow(this)" />')}
      ${costCell('cost-cell-rate', 'Unit cost',
        '<input type="number" class="form-input cost-rate" placeholder="0.00" min="0" step="any" oninput="recalcCostRow(this)" />')}
      ${costCell('cost-cell-cost', 'Total cost',
        '<input type="text" class="form-input cost-cost" readonly aria-label="Total cost, calculated" />')}
      ${costCell('cost-cell-remark', 'Remark',
        '<input type="text" class="form-input cost-remark" placeholder="Remark..." />')}
      <div class="cost-cell cost-cell-del">
        <span class="cost-cell-label">Remove row</span>
        <button type="button" class="cost-del" onclick="removeCostRow(this)" title="Remove row" aria-label="Remove this row">&#10005;</button>
      </div>
    </div>
  `;
}
function addCostRow(fieldId) {
  const body = document.getElementById(fieldId + '-body');
  if (!body) return;
  const next = (body.querySelectorAll('.cost-table-row').length + 1);
  body.insertAdjacentHTML('beforeend', buildCostRow(next));
  const lastRow = body.lastElementChild;
  if (lastRow) lastRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function removeCostRow(btn) {
  const row = btn.closest('.cost-table-row');
  if (!row) return;
  const wrapper = row.closest('.cost-table-wrapper');
  row.remove();
  if (wrapper) { renumberCostRows(wrapper); recalcCostTotal(wrapper.id); }
}
function renumberCostRows(wrapper) {
  wrapper.querySelectorAll('.cost-table-row').forEach((row, i) => {
    const sn = row.querySelector('.cost-sn');
    if (sn) sn.value = String(i + 1);
  });
}
function recalcCostRow(input) {
  const row = input.closest('.cost-table-row');
  if (!row) return;
  const qty   = parseFloat(row.querySelector('.cost-qty').value) || 0;
  const rate  = parseFloat(row.querySelector('.cost-rate').value) || 0;
  const cost  = qty * rate;
  const costEl = row.querySelector('.cost-cost');
  costEl.value = (Math.round(cost * 100) / 100).toFixed(2);
  const wrapper = row.closest('.cost-table-wrapper');
  if (wrapper) recalcCostTotal(wrapper.id);
}
function recalcCostTotal(wrapperId) {
  const wrapper = document.getElementById(wrapperId);
  if (!wrapper) return;
  let total = 0;
  wrapper.querySelectorAll('.cost-table-row').forEach(row => {
    const qty  = parseFloat(row.querySelector('.cost-qty').value) || 0;
    const rate = parseFloat(row.querySelector('.cost-rate').value) || 0;
    total += qty * rate;
  });
  const totalEl = wrapper.querySelector(`#${wrapperId}-total`);
  if (totalEl) totalEl.textContent = (Math.round(total * 100) / 100).toFixed(2);
}

function updateUrlLink(fieldId) {
  const input = document.getElementById(fieldId);
  const link = document.getElementById(fieldId + '-open');
  if (!input || !link) return;
  if (input.value && input.value.trim()) {
    link.href = input.value.trim();
    link.style.display = 'inline-flex';
  } else {
    link.href = '#';
    link.style.display = 'none';
  }
}

// ─── HTML ESCAPING ─────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Escaper for a value interpolated into an INLINE HANDLER, e.g.
//   onclick="goTicket('${escJsAttr(ir.irNumber)}')"
// escHtml is NOT enough there: it does not touch `'`, and every handler in this
// file is a single-quoted JS string inside a double-quoted attribute — so a value
// containing a quote closes the JS string and the rest runs as code. That is a
// live hole, because these values come from the Sheet (a member of the public
// writes the customer Form) and from sentinel stores any signed-in user can write.
// Escaping order matters: entities first, then the backslash, then the quote that
// the backslash protects.
function escJsAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n');
}

// An href built from stored data must be a real http(s) URL — otherwise
// `javascript:` is a link the user clicks. Anything else becomes '' and the
// caller omits the anchor.
function safeUrl(u) {
  const s = String(u == null ? '' : u).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

// ─── INWARD DROPDOWN OPTIONS (admin-customizable) ──────────────────────────────
// Persisted to GAS under irNumber="__CONFIG__", sectionId="inward-options"
// (best-effort) and mirrored to localStorage so edits survive when GAS is
// unreachable. Falls back to INWARD_OPTIONS_DEFAULTS on load.

// ─── SHARED CONFIG (`__CONFIG__`) ────────────────────────────────────────────
// The inward dropdown options, the IQC inspection config, the team directory and the
// palette allowlist are FOUR records in ONE store, and each consumer used to fetch
// that store for itself: the same URL, the same payload, four round trips on the way
// to a screen the owner already reported as slow. Each loader below still paints from
// its own localStorage copy first (that is the instant, offline-safe half); this is
// the ONE network read that refreshes all of them.
//
// A failed read changes nothing — `null` means the local copies stand and any later
// consumer falls back to its own request, which is the branch each one took before.
let _configSections = null;

function loadSharedConfig() {
  loadSentinelAll('__CONFIG__').then(sections => {
    if (!sections) return;
    _configSections = sections;
    applyInwardOptions(sections['inward-options']);
    applyIqcConfig(sections['iqc-config']);
    applyTeamDirectory(sections['team-directory']);
    applyAnalyserConfig(sections['analyser']);
  });
}

// One record out of the boot read, when it has landed. `undefined` means "not read
// yet or the read failed" — deliberately NOT `null`, because an absent record in a
// successful read is a real, empty answer and must not be re-fetched forever.
function sharedConfigRecord(sectionId) {
  return _configSections ? _configSections[sectionId] : undefined;
}

function loadInwardOptions() {
  // localStorage override (per-device, always available). The shared copy lands
  // separately, via applyInwardOptions().
  try {
    const local = localStorage.getItem('ipb_inward_options');
    if (local) inwardOptions = Object.assign({}, INWARD_OPTIONS_DEFAULTS, JSON.parse(local));
  } catch {}
}

function applyInwardOptions(saved) {
  if (!saved || !saved.options || typeof saved.options !== 'object') return;
  inwardOptions = Object.assign({}, INWARD_OPTIONS_DEFAULTS, saved.options);
  try { localStorage.setItem('ipb_inward_options', JSON.stringify(saved.options)); } catch {}
  // Re-render any visible inward table, preserving already-entered values
  document.querySelectorAll('.inward-table-wrapper').forEach(w => {
    const tbody = w.querySelector('.inward-table-body');
    if (!tbody) return;
    const prior = {};
    tbody.querySelectorAll('.inward-row').forEach(row => {
      const m = row.querySelector('.inward-model');
      const q = row.querySelector('.inward-qty');
      if (m?.dataset.particular) prior[m.dataset.particular] = { model: m.value, qty: q?.value };
    });
    tbody.innerHTML = buildInwardRowsHTML();
    Object.entries(prior).forEach(([p, cell]) => {
      if (!cell) return;
      const m = tbody.querySelector(`.inward-model[data-particular="${p}"]`);
      const q = tbody.querySelector(`.inward-qty[data-particular="${p}"]`);
      if (m) m.value = cell.model || '';
      if (q) q.value = cell.qty || '';
    });
  });
}

function saveInwardOptions() {
  if (!isInwardAdmin()) { showToast('Not authorized'); return; }
  try { localStorage.setItem('ipb_inward_options', JSON.stringify(inwardOptions)); } catch {}
  saveSentinel('__CONFIG__', 'inward-options', { options: inwardOptions })
    .then(r => showToast(r && r.status === 'ok'
      ? 'Inward options saved'
      : 'Saved locally (backend unreachable)'));
}

function buildInwardRowsHTML() {
  return INWARD_PARTICULARS.map((p, i) => {
    const opts = p.options ? (inwardOptions[p.options] || []) : null;
    const modelControl = opts
      ? `<select class="form-input inward-model" data-particular="${escHtml(p.name)}"><option value=""></option>${opts.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('')}</select>`
      : `<input type="text" class="form-input inward-model" data-particular="${escHtml(p.name)}" placeholder="Enter value" />`;
    return `
      <div class="inward-row">
        <span class="inward-sn">${i + 1}</span>
        <span class="inward-particular">${escHtml(p.name)}</span>
        ${modelControl}
        <input type="number" min="0" class="form-input inward-qty" data-particular="${escHtml(p.name)}" placeholder="Qty" />
        <input type="text" class="form-input inward-remark" data-particular="${escHtml(p.name)}" placeholder="Remark" />
      </div>`;
  }).join('');
}

// Build the IQC visual-inspection rows from the (admin-customizable) iqcZones.
function buildIqcRowsHTML() {
  return iqcZones.map(z => {
    if (z.header) {
      return `<div class="iqc-zone-header"><span class="iqc-zone-code">${escHtml(z.code)}</span><span class="iqc-zone-name">${escHtml(z.name)}</span></div>`;
    }
    const resultOpts = iqcResultOptions.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');
    const zoneCell = z.editable
      ? `<div class="iqc-zone"><span class="iqc-zone-code">${escHtml(z.code)}</span><input type="text" class="form-input iqc-name" data-id="${escHtml(z.id)}" placeholder="Item name" /></div>`
      : `<div class="iqc-zone"><span class="iqc-zone-code">${escHtml(z.code)}</span><span class="iqc-zone-name">${escHtml(z.name)}</span></div>`;
    const checksCell = z.editable
      ? `<input type="text" class="form-input iqc-checks" data-id="${escHtml(z.id)}" placeholder="Checks to perform" />`
      : `<span class="iqc-checks-text">${escHtml(z.checks || '')}</span>`;
    return `
      <div class="iqc-row" data-id="${escHtml(z.id)}">
        ${zoneCell}
        <div class="iqc-checks-cell">${checksCell}</div>
        <select class="form-input iqc-result" data-id="${escHtml(z.id)}"><option value=""></option>${resultOpts}</select>
        <input type="text" class="form-input iqc-remark" data-id="${escHtml(z.id)}" placeholder="Remark" />
      </div>`;
  }).join('');
}

function openInwardOptionsModal() {
  if (!isInwardAdmin()) { showToast('Not authorized'); return; }
  const groups = Object.keys(INWARD_OPTIONS_DEFAULTS);
  const fields = groups.map(g => `
    <div class="opt-group">
      <label class="form-label">${escHtml(g)} — used by: ${INWARD_PARTICULARS.filter(p => p.options === g).map(p => escHtml(p.name)).join(', ') || '(none)'}</label>
      <textarea class="form-input opt-textarea" data-group="${escHtml(g)}" placeholder="One option per line">${escHtml((inwardOptions[g] || []).join('\n'))}</textarea>
    </div>`).join('');
  const modal = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'inward-options-modal';
  modal.innerHTML = `
    <div class="inward-options-card">
      <div class="inward-options-head">
        <h3>Manage Inward Dropdown Options</h3>
        <button type="button" class="inward-options-close" onclick="closeInwardOptionsModal()">&times;</button>
      </div>
      <p class="inward-options-hint">One option per line. Changes apply to every IR's inward table and persist for all users.</p>
      <div class="inward-options-body">${fields}</div>
      <div class="inward-options-foot">
        <button type="button" class="btn" onclick="closeInwardOptionsModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="applyInwardOptions()">Save Options</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function closeInwardOptionsModal() {
  const m = document.getElementById('inward-options-modal');
  if (m) m.remove();
}

function applyInwardOptions() {
  document.querySelectorAll('#inward-options-modal .opt-textarea').forEach(ta => {
    const g = ta.dataset.group;
    const list = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
    inwardOptions[g] = list;
  });
  closeInwardOptionsModal();
  // Re-render any visible inward table with the new option lists
  document.querySelectorAll('.inward-table-body').forEach(tb => { tb.innerHTML = buildInwardRowsHTML(); });
  saveInwardOptions();
}

// ─── IQC INSPECTION POINTS + RESULT DROPDOWN (admin-customizable) ─────────────
// Persisted to GAS under irNumber="__CONFIG__"/sectionId="iqc-config" (shared)
// and mirrored to localStorage. Falls back to IQC_ZONES_DEFAULTS /
// IQC_RESULT_OPTIONS_DEFAULTS on load.

function loadIqcConfig() {
  // Local copy first; the shared one arrives via applyIqcConfig().
  try {
    const local = localStorage.getItem('ipb_iqc_config');
    if (local) {
      const cfg = JSON.parse(local);
      if (Array.isArray(cfg.zones)) iqcZones = cfg.zones;
      if (Array.isArray(cfg.resultOptions)) iqcResultOptions = cfg.resultOptions;
    }
  } catch {}
}

function applyIqcConfig(saved) {
  if (!saved) return;
  if (Array.isArray(saved.zones)) iqcZones = saved.zones;
  if (Array.isArray(saved.resultOptions)) iqcResultOptions = saved.resultOptions;
  try { localStorage.setItem('ipb_iqc_config', JSON.stringify({ zones: iqcZones, resultOptions: iqcResultOptions })); } catch {}
  reRenderIqcTables();
}

function saveIqcConfig() {
  if (!isAdmin()) { showToast('Not authorized'); return; }
  try { localStorage.setItem('ipb_iqc_config', JSON.stringify({ zones: iqcZones, resultOptions: iqcResultOptions })); } catch {}
  saveSentinel('__CONFIG__', 'iqc-config', { zones: iqcZones, resultOptions: iqcResultOptions })
    .then(r => showToast(r && r.status === 'ok'
      ? 'Inspection config saved'
      : 'Saved locally (backend unreachable)'));
}

// Re-render every visible IQC table, preserving already-entered values.
function reRenderIqcTables() {
  document.querySelectorAll('.iqc-table-wrapper').forEach(w => {
    const body = w.querySelector('.iqc-table-body');
    if (!body) return;
    const prior = {};
    body.querySelectorAll('.iqc-row').forEach(row => {
      const id = row.dataset.id;
      if (!id) return;
      prior[id] = {
        result: row.querySelector('.iqc-result')?.value || '',
        remark: row.querySelector('.iqc-remark')?.value || '',
        name:   row.querySelector('.iqc-name')?.value || '',
        checks: row.querySelector('.iqc-checks')?.value || '',
      };
    });
    body.innerHTML = buildIqcRowsHTML();
    Object.entries(prior).forEach(([id, cell]) => {
      const row = body.querySelector(`.iqc-row[data-id="${id}"]`);
      if (!row) return;
      if (cell.result) row.querySelector('.iqc-result').value = cell.result;
      if (cell.remark) row.querySelector('.iqc-remark').value = cell.remark;
      const nameEl = row.querySelector('.iqc-name');   if (nameEl && cell.name)   nameEl.value = cell.name;
      const checksEl = row.querySelector('.iqc-checks'); if (checksEl && cell.checks) checksEl.value = cell.checks;
    });
  });
}

function iqcCfgType(z) { return z.header ? 'header' : (z.editable ? 'editable' : 'check'); }

function buildIqcCfgRowsHTML() {
  return iqcZones.map(z => {
    const t = iqcCfgType(z);
    const typeSel = `<select class="form-input iqc-cfg-type">
      <option value="header"${t === 'header' ? ' selected' : ''}>Header (group)</option>
      <option value="check"${t === 'check' ? ' selected' : ''}>Check row</option>
      <option value="editable"${t === 'editable' ? ' selected' : ''}>Editable (blank)</option>
    </select>`;
    return `
      <div class="iqc-cfg-row" data-id="${escHtml(z.id)}">
        ${typeSel}
        <input class="form-input iqc-cfg-code" value="${escHtml(z.code || '')}" placeholder="Code (e.g. A.1.)" />
        <input class="form-input iqc-cfg-name" value="${escHtml(z.name || '')}" placeholder="Item / group name" />
        <input class="form-input iqc-cfg-checks" value="${escHtml(z.checks || '')}" placeholder="Visual checks (check rows)" />
        <button type="button" class="iqc-cfg-del" onclick="this.closest('.iqc-cfg-row').remove()">&times;</button>
      </div>`;
  }).join('');
}

function openIqcConfigModal() {
  if (!isAdmin()) { showToast('Not authorized'); return; }
  const modal = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'iqc-config-modal';
  modal.innerHTML = `
    <div class="inward-options-card">
      <div class="inward-options-head">
        <h3>Manage Inspection Points &amp; Dropdowns</h3>
        <button type="button" class="inward-options-close" onclick="closeIqcConfigModal()">&times;</button>
      </div>
      <p class="inward-options-hint">Edit the Result dropdown options (one per line), then the inspection points. Changes apply to every IR's IQC table and persist for all users.</p>
      <div class="opt-group">
        <label class="form-label">Result dropdown options</label>
        <textarea class="form-input opt-textarea" id="iqc-cfg-results" placeholder="One option per line">${escHtml(iqcResultOptions.join('\n'))}</textarea>
      </div>
      <div class="iqc-cfg-rows-head">
        <span>Type</span><span>Code</span><span>Item / Group name</span><span>Visual checks</span><span></span>
      </div>
      <div id="iqc-cfg-rows">${buildIqcCfgRowsHTML()}</div>
      <button type="button" class="btn iqc-cfg-add" onclick="addIqcCfgRow()">+ Add row</button>
      <div class="inward-options-foot">
        <button type="button" class="btn" onclick="closeIqcConfigModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="applyIqcConfig()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function closeIqcConfigModal() {
  const m = document.getElementById('iqc-config-modal');
  if (m) m.remove();
}

function addIqcCfgRow() {
  const container = document.getElementById('iqc-cfg-rows');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'iqc-cfg-row';
  div.dataset.id = 'new_' + Date.now();
  div.innerHTML = `
    <select class="form-input iqc-cfg-type">
      <option value="header">Header (group)</option>
      <option value="check" selected>Check row</option>
      <option value="editable">Editable (blank)</option>
    </select>
    <input class="form-input iqc-cfg-code" placeholder="Code (e.g. A.1.)" />
    <input class="form-input iqc-cfg-name" placeholder="Item / group name" />
    <input class="form-input iqc-cfg-checks" placeholder="Visual checks (check rows)" />
    <button type="button" class="iqc-cfg-del" onclick="this.closest('.iqc-cfg-row').remove()">&times;</button>`;
  container.appendChild(div);
}

function applyIqcConfig() {
  const resultsText = document.getElementById('iqc-cfg-results')?.value || '';
  iqcResultOptions = resultsText.split('\n').map(s => s.trim()).filter(Boolean);
  if (!iqcResultOptions.length) iqcResultOptions = [...IQC_RESULT_OPTIONS_DEFAULTS];
  const rows = document.querySelectorAll('#iqc-config-modal .iqc-cfg-row');
  const newZones = [];
  rows.forEach((row, i) => {
    const type   = row.querySelector('.iqc-cfg-type')?.value || 'check';
    const code   = row.querySelector('.iqc-cfg-code')?.value || '';
    const name   = row.querySelector('.iqc-cfg-name')?.value || '';
    const checks = row.querySelector('.iqc-cfg-checks')?.value || '';
    const id = row.dataset.id || `z${i}`;
    const z = { id, code, name, checks };
    if (type === 'header') z.header = true;
    else if (type === 'editable') z.editable = true;
    newZones.push(z);
  });
  iqcZones = newZones;
  closeIqcConfigModal();
  reRenderIqcTables();
  saveIqcConfig();
}

function handleFilePreview(e) {
  const inp = e.target;
  const previewContainer = document.getElementById(inp.id + '-previews');
  if (!previewContainer) return;
  previewContainer.innerHTML = '';
  Array.from(inp.files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const img = document.createElement('img');
    img.className = 'photo-thumb';
    img.src = URL.createObjectURL(file);
    previewContainer.appendChild(img);
  });
}

// ─── LOAD / SAVE SECTION DATA ─────────────────────────────────────────────────
async function loadSectionData(irNumber) {
  try {
    const url = `${CONFIG.GAS_URL}?action=getPassbook&irNumber=${encodeURIComponent(irNumber)}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.status === 'ok' && data.sections) {
      currentSectionData = data.sections;
      // Populate form fields
      Object.entries(data.sections).forEach(([secId, fields]) => {
        Object.entries(fields).forEach(([fieldId, value]) => {
          populateFieldValue(secId, fieldId, value);
        });
      });
    }
  } catch {
    // Offline or error — just show empty forms
  }
}

// Resolve a saved imageEvidence field's entries: captions saved with an empty link
// (the upload was still pending at the last save) get their Drive URLs merged in
// from '<fieldId>_links'. That merge is SKIPPED for drafts — a draft's empty link
// means a not-yet-uploaded image, which must not pick up a Drive URL belonging to a
// different (saved) entry. Also seeds one entry per link for fields migrated from
// the old `file` type, which stored nothing but links.
function savedEvidenceEntries(sectionId, fieldId, value, isDraft) {
  let arr = (Array.isArray(value) ? value : []).map(e => ({
    caption: (e && e.caption) || '', link: (e && e.link) || '', type: (e && e.type) || '', name: (e && e.name) || '',
  }));
  if (isDraft) return arr;
  const linksRaw = currentSectionData?.[sectionId]?.[fieldId + '_links'];
  if (linksRaw) {
    const links = String(linksRaw).split(',').map(s => s.trim()).filter(Boolean);
    let li = 0;
    arr = arr.map(e => (e.link || li >= links.length) ? e : { caption: e.caption, link: links[li++], type: e.type, name: e.name });
  }
  if (!arr.length) {
    arr = String(linksRaw || '').split(',').map(s => s.trim()).filter(Boolean).map(l => ({ caption: '', link: l, type: '', name: '' }));
  }
  return arr;
}

// Fold the two Flight Test upload fields into one without losing the uploads that
// are already in the store. Deduped by link, else name, else caption — and an entry
// with none of those is always kept, because two blanks are not the same thing.
// Idempotent: the survivor absorbs the retired field's entries, and re-running it
// against the same saved data collapses to the same set. Nothing is written back,
// so no record is touched.
function mergeFlightReportEntries(base, extra) {
  const seen = new Set();
  const keyOf = e => {
    if (e.link) return 'l:' + e.link;
    if (e.name) return 'n:' + e.name;
    if (e.caption) return 'c:' + e.caption + '|' + (e.type || '');
    return '';
  };
  const out = [];
  [base, extra].forEach(list => (list || []).forEach(e => {
    const key = keyOf(e);
    if (key) { if (seen.has(key)) return; seen.add(key); }
    out.push(e);
  }));
  return out;
}

function populateFieldValue(sectionId, fieldId, value, isDraft = false) {
  const section = SECTIONS[sectionId];
  const field = section?.fields.find(f => f.id === fieldId);

  // analysisNote is a read-only display line built from currentIR — nothing to populate.
  if (field?.type === 'analysisNote') return;
  // logAnalysis is read-only too, but it DOES carry a value: the stored report.
  if (field?.type === 'logAnalysis') { renderLogAnalysis(fieldId, value); return; }
  // divider is a static sub-heading — no value to populate.
  if (field?.type === 'divider') return;

  // Handle imageEvidence type — value is [{caption, link, type, name}]
  if (field?.type === 'imageEvidence') {
    let arr = savedEvidenceEntries(sectionId, fieldId, value, isDraft);
    // The retired "Mission Flight Test Report" was merged into this field. Fold its
    // saved uploads in here, on load only, so they stay visible instead of sitting
    // in the store unseen. Deduped, so this cannot duplicate on a second load.
    if (!isDraft && fieldId === 'g_basicReport') {
      arr = mergeFlightReportEntries(
        arr,
        savedEvidenceEntries(sectionId, 'g_missionReport', currentSectionData?.[sectionId]?.g_missionReport, false)
      );
    }
    evidenceState[fieldId] = arr.map(e => ({ caption: e.caption || '', link: e.link || '', file: null, url: null, type: e.type || '', name: e.name || '' }));
    renderImageEvidence(fieldId);
    return;
  }

  // Handle dispatchChecklist type — value is { [particular]: status }
  if (field?.type === 'dispatchChecklist') {
    dispatchChecklistState[fieldId] = (value && typeof value === 'object') ? value : {};
    renderDispatchChecklist(fieldId);
    return;
  }

  // Handle courierName type — stored as a single string. If it matches a preset
  // option, select it; otherwise pick "Other" and drop the name into the text box.
  if (field?.type === 'courierName') {
    const sel = document.getElementById(fieldId);
    const other = document.getElementById(fieldId + '-other');
    if (!sel) return;
    const v = (value == null || typeof value === 'object') ? '' : String(value);
    const isPreset = Array.from(sel.options).some(o => o.value === v && o.value !== '__other__');
    if (isPreset) {
      sel.value = v;
      if (other) { other.value = ''; other.style.display = 'none'; }
    } else if (v) {
      sel.value = '__other__';
      if (other) { other.value = v; other.style.display = 'block'; }
    }
    return;
  }

  // Handle checkpointEvidence type — value is { done, attach: [{caption,link,type,name}] }
  if (field?.type === 'checkpointEvidence') {
    const v = (value && typeof value === 'object') ? value : {};
    const doneEl = document.getElementById(fieldId + '_done');
    if (doneEl) doneEl.checked = !!v.done;
    const attachId = fieldId + '_attach';
    let arr = Array.isArray(v.attach) ? v.attach : [];
    if (!isDraft) {
      const linksRaw = currentSectionData?.[sectionId]?.[attachId + '_links'];
      if (linksRaw) {
        const links = String(linksRaw).split(',').map(s => s.trim()).filter(Boolean);
        let li = 0;
        arr = arr.map(e => {
          if (!e.link && li < links.length) return { caption: e.caption || '', link: links[li++], type: e.type || '', name: e.name || '' };
          return { caption: e.caption || '', link: e.link || '', type: e.type || '', name: e.name || '' };
        });
      }
      if (!arr.length) {
        const links = String(currentSectionData?.[sectionId]?.[attachId + '_links'] || '').split(',').map(s => s.trim()).filter(Boolean);
        arr = links.map(l => ({ caption: '', link: l, type: '', name: '' }));
      }
    }
    evidenceState[attachId] = arr.map(e => ({ caption: e.caption || '', link: e.link || '', file: null, url: null, type: e.type || '', name: e.name || '' }));
    renderImageEvidence(attachId);
    return;
  }

  // Handle checklist type
  if (field?.type === 'checklist' && value && typeof value === 'object') {
    field.items.forEach((item, i) => {
      const el = document.getElementById(`${fieldId}_${i}`);
      if (el) el.value = value[item] || '';
    });
    return;
  }

  // Handle inwardTable type — value is { [particularName]: { model, qty, remark } }
  if (field?.type === 'inwardTable' && value && typeof value === 'object') {
    const wrapper = document.getElementById(fieldId);
    if (!wrapper) return;
    Object.entries(value).forEach(([particular, cell]) => {
      const modelEl  = wrapper.querySelector(`.inward-model[data-particular="${particular}"]`);
      const qtyEl    = wrapper.querySelector(`.inward-qty[data-particular="${particular}"]`);
      const remarkEl = wrapper.querySelector(`.inward-remark[data-particular="${particular}"]`);
      if (modelEl && cell)  modelEl.value  = cell.model || '';
      if (qtyEl && cell)    qtyEl.value    = cell.qty || '';
      if (remarkEl && cell) remarkEl.value = cell.remark || '';
    });
    return;
  }

  // Handle iqcTable type — value is { [zoneId]: { result, remark, name?, checks? } }
  if (field?.type === 'iqcTable' && value && typeof value === 'object') {
    const wrapper = document.getElementById(fieldId);
    if (!wrapper) return;
    Object.entries(value).forEach(([zoneId, cell]) => {
      if (!cell) return;
      const resultEl = wrapper.querySelector(`.iqc-result[data-id="${zoneId}"]`);
      const remarkEl = wrapper.querySelector(`.iqc-remark[data-id="${zoneId}"]`);
      const nameEl   = wrapper.querySelector(`.iqc-name[data-id="${zoneId}"]`);
      const checksEl = wrapper.querySelector(`.iqc-checks[data-id="${zoneId}"]`);
      if (resultEl) resultEl.value = cell.result || '';
      if (remarkEl) remarkEl.value = cell.remark || '';
      if (nameEl)   nameEl.value   = cell.name || '';
      if (checksEl) checksEl.value = cell.checks || '';
    });
    return;
  }

  // No activityTable branch: the type is retired. The legacy log it used to hold is
  // rendered read-only by the Overview, straight from currentSectionData, and no
  // SECTIONS entry declares the type any more.

  // Handle costTable type — value is [{particular, qty, rate, cost, remark}, ...]
  if (field?.type === 'costTable') {
    const body = document.getElementById(fieldId + '-body');
    if (!body) return;
    const rows = Array.isArray(value) ? value : [];
    body.innerHTML = '';
    if (rows.length === 0) {
      // Re-seed a few empty rows so the operator always has inputs ready.
      for (let i = 1; i <= 3; i++) body.insertAdjacentHTML('beforeend', buildCostRow(i));
    } else {
      rows.forEach((r, i) => {
        body.insertAdjacentHTML('beforeend', buildCostRow(i + 1));
        const lastRow = body.lastElementChild;
        if (lastRow) {
          lastRow.querySelector('.cost-particular').value = r.particular || '';
          lastRow.querySelector('.cost-qty').value       = r.qty || '';
          lastRow.querySelector('.cost-rate').value      = r.rate || '';
          lastRow.querySelector('.cost-remark').value   = r.remark || '';
          recalcCostRow(lastRow.querySelector('.cost-qty'));   // computes cost + updates total
        }
      });
    }
    return;
  }

  // Handle url type
  if (field?.type === 'url') {
    const el = document.getElementById(fieldId);
    if (el) {
      el.value = value || '';
      updateUrlLink(fieldId);
    }
    return;
  }

  const el = document.getElementById(fieldId);
  if (!el || value == null || typeof value === 'object') return;

  if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    el.value = value;
  }
}

// The Overview's stored values, read from its own panel.
//
// BY ID, NOT FROM A LIST. The panel is hand-rendered, so there is no field
// declaration to walk — and a hand-written list of ids is exactly what drifts. It
// already had to be written twice (once in the markup, once in the Save button's
// own payload), and a third field added to the markup but not to that literal would
// have looked completely normal on screen while never being saved.
//
// The backend MERGES the Overview rather than replacing it (backend.gs, saveSection:
// the Overview is the one section whose payload is a subset of its record), so what
// comes back from here is added over the stored row, never written in place of it.
// That is what keeps a_activityLog, which no panel field carries.
function collectOverviewValues() {
  const values = {};
  const root = document.getElementById('ir-overview-editable');
  if (!root) return values;
  root.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
    values[el.id] = el.value;
  });
  return values;
}

// Collect all field values for a section from the DOM + evidenceState.
// Shared by saveSection and the draft auto-persist. Returns { fieldValues, fileFields }.
function collectSectionValues(sectionId) {
  // The Overview is hand-rendered rather than built from a field list, so it has no
  // SECTIONS entry to walk — and it used to fall straight through this function
  // returning NOTHING, which is how the flush path above managed to post an empty
  // payload for a panel with two filled-in boxes on screen.
  if (sectionId === OVERVIEW_KEY) return { fieldValues: collectOverviewValues(), fileFields: [] };

  const section = SECTIONS[sectionId];
  const fieldValues = {};
  const fileFields = [];
  if (!section) return { fieldValues, fileFields };

  for (const field of section.fields) {
    if (field.type === 'analysisNote' || field.type === 'divider' || field.type === 'readonlyLinks') {
      continue; // read-only display / static heading, nothing to save
    } else if (field.type === 'imageEvidence') {
      const entries = evidenceState[field.id] || [];
      // Captions + type + already-uploaded Drive links are carried in the field
      // value; only the not-yet-uploaded files are sent as files.
      fieldValues[field.id] = entries.map(e => ({ caption: e.caption || '', link: e.link || '', type: e.type || '', name: e.name || '' }));
      const newFiles = entries.filter(e => e.file).map(e => e.file);
      if (newFiles.length) fileFields.push({ id: field.id, files: newFiles });
    } else if (field.type === 'checkpointEvidence') {
      // Tick state + attachment entries (attachment lives under <id>_attach).
      const doneEl = document.getElementById(field.id + '_done');
      const attachId = field.id + '_attach';
      const entries = evidenceState[attachId] || [];
      fieldValues[field.id] = {
        done: !!(doneEl?.checked),
        attach: entries.map(e => ({ caption: e.caption || '', link: e.link || '', type: e.type || '', name: e.name || '' })),
      };
      const newFiles = entries.filter(e => e.file).map(e => e.file);
      if (newFiles.length) fileFields.push({ id: attachId, files: newFiles });
    } else if (field.type === 'logAnalysis') {
      // Carried through, not collected. There is no input to read — the value lives
      // only in the section data the analyser wrote it to, and dropping it here
      // would mean a perfectly ordinary Section D save quietly deleted the report.
      const held = currentSectionData?.[sectionId]?.[field.id];
      if (held) fieldValues[field.id] = held;
    } else if (field.type === 'dispatchChecklist') {
      fieldValues[field.id] = collectDispatchChecklist(field.id);
    } else if (field.type === 'courierName') {
      const sel = document.getElementById(field.id);
      const other = document.getElementById(field.id + '-other');
      if (sel) fieldValues[field.id] = sel.value === '__other__' ? (other?.value?.trim() || '') : sel.value;
    } else if (field.type === 'file') {
      const inp = document.getElementById(field.id);
      if (inp?.files?.length > 0) fileFields.push({ id: field.id, files: inp.files });
    } else if (field.type === 'checklist') {
      const checkValues = {};
      field.items.forEach((_, i) => {
        const el = document.getElementById(field.id + '_' + i);
        if (el) checkValues[field.items[i]] = el.value;
      });
      fieldValues[field.id] = checkValues;
    } else if (field.type === 'costTable') {
      const body = document.getElementById(field.id + '-body');
      const rows = [];
      if (body) {
        body.querySelectorAll('.cost-table-row').forEach(row => {
          const particular = row.querySelector('.cost-particular')?.value || '';
          const qty   = row.querySelector('.cost-qty')?.value || '';
          const rate  = row.querySelector('.cost-rate')?.value || '';
          const cost  = row.querySelector('.cost-cost')?.value || '';
          const remark = row.querySelector('.cost-remark')?.value || '';
          // Drop completely blank rows so we don't store empty noise.
          if (particular || qty || rate || remark) {
            rows.push({ particular, qty, rate, cost, remark });
          }
        });
      }
      fieldValues[field.id] = rows;
    } else if (field.type === 'inwardTable') {
      const wrapper = document.getElementById(field.id);
      const tableData = {};
      if (wrapper) {
        wrapper.querySelectorAll('.inward-row').forEach(row => {
          const modelEl   = row.querySelector('.inward-model');
          const qtyEl     = row.querySelector('.inward-qty');
          const remarkEl  = row.querySelector('.inward-remark');
          const particular = modelEl?.dataset.particular;
          if (!particular) return;
          const model = modelEl?.value || '';
          const qty   = qtyEl?.value || '';
          const remark = remarkEl?.value || '';
          if (model || qty || remark) tableData[particular] = { model, qty, remark };
        });
      }
      fieldValues[field.id] = tableData;
    } else if (field.type === 'iqcTable') {
      const wrapper = document.getElementById(field.id);
      const tableData = {};
      if (wrapper) {
        wrapper.querySelectorAll('.iqc-row').forEach(row => {
          const zoneId = row.dataset.id;
          if (!zoneId) return;
          const result  = row.querySelector('.iqc-result')?.value || '';
          const remark  = row.querySelector('.iqc-remark')?.value || '';
          const nameEl  = row.querySelector('.iqc-name');
          const checksEl = row.querySelector('.iqc-checks');
          const cell = { result, remark };
          if (nameEl)  cell.name  = nameEl.value || '';
          if (checksEl) cell.checks = checksEl.value || '';
          if (result || remark || cell.name || cell.checks) tableData[zoneId] = cell;
        });
      }
      fieldValues[field.id] = tableData;
    } else {
      const el = document.getElementById(field.id);
      if (el) fieldValues[field.id] = el.value;
    }
  }
  return { fieldValues, fileFields };
}

// ─── DRAFT AUTO-PERSIST ────────────────────────────────────────────────────────
// Unsaved entries are written to localStorage per IR+section on every edit, so
// progress survives navigation, reloads, or a failed/unsaved Save. A draft is
// cleared only on a successful Save. On reopening an IR, drafts are restored on
// top of the saved data and a banner lets the user review / discard them.

function draftKey(sectionId) {
  return `ipb_draft_${currentIR?.irNumber || '_'}_${sectionId}`;
}
function sectionIdFromFieldId(fieldId) {
  if (!fieldId) return null;
  // The index is authoritative. The prefix guess below is WRONG for the merged
  // sections — `g_missionReport` lives in `sec-f`, `i_courier` in `sec-g` — so it
  // is only a fallback for ids that no form declares (an old field, a future one).
  const known = FIELD_SECTION_INDEX[fieldId];
  if (known) return known;
  const letter = String(fieldId).split('_')[0];     // 'a','b',...
  // `a_*` fields are the Overview's; they have no section tab but they do have a
  // home, so they resolve to OVERVIEW_KEY rather than to a non-existent `sec-a`
  // section entry.
  if (letter === 'a') return OVERVIEW_KEY;
  return letter ? `sec-${letter}` : null;
}
function saveDraft(sectionId) {
  if (!currentIR?.irNumber) return;
  // The 📋 Report tab is read-only and not in SECTIONS, so it has no draft. This
  // guard keeps the #sections-wrapper listener from writing empty junk for it.
  if (!SECTIONS[sectionId]) return;
  const { fieldValues } = collectSectionValues(sectionId);
  try {
    localStorage.setItem(draftKey(sectionId), JSON.stringify({ savedAt: Date.now(), values: fieldValues }));
  } catch {}
  refreshDraftBanner();
}
function loadDraft(sectionId) {
  try {
    const raw = localStorage.getItem(draftKey(sectionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.values || null;
  } catch { return null; }
}
function clearDraft(sectionId) {
  try { localStorage.removeItem(draftKey(sectionId)); } catch {}
}
function clearAllDrafts() {
  if (!currentIR?.irNumber) return;
  Object.keys(SECTIONS).forEach(clearDraft);
  _dirtySections.clear();
  updateDirtyIndicators();
  refreshDraftBanner();
}
function hasAnyDraft() {
  return Object.keys(SECTIONS).some(sec => loadDraft(sec) !== null);
}
function restoreDrafts() {
  let restored = [];
  Object.keys(SECTIONS).forEach(secId => {
    const draft = loadDraft(secId);
    if (!draft) return;
    restored.push(secId);
    // A restored draft IS an unsaved change. populateFieldValue writes `.value`
    // directly, which fires no `input` event, so without this the leave guard
    // would call a screen full of restored text "clean".
    markSectionDirty(secId);
    Object.entries(draft).forEach(([fieldId, value]) => {
      populateFieldValue(secId, fieldId, value, true);
    });
  });
  return restored;
}
function refreshDraftBanner() {
  const banner = document.getElementById('draft-banner');
  if (!banner) return;
  if (!currentIR?.irNumber || !hasAnyDraft()) { banner.style.display = 'none'; return; }
  const label = currentIR.irNumber;
  banner.style.display = 'flex';
  banner.innerHTML = `
    <span class="draft-banner-text">You have unsaved entries restored from a previous session for ${escHtml(label)}. Review each section and Save, or discard.</span>
    <button type="button" class="draft-banner-btn" onclick="discardAllDrafts()">Discard restored drafts</button>`;
}
function discardAllDrafts() {
  // Drop drafts, rebuild forms fresh (re-applies Section A auto-fill), then
  // re-apply the saved backend data so the UI reflects the last saved state.
  Object.keys(SECTIONS).forEach(clearDraft);
  buildSectionForms(currentIR.irNumber);
  _dirtySections.clear();
  updateDirtyIndicators();
  if (currentSectionData) {
    Object.entries(currentSectionData).forEach(([secId, fields]) => {
      Object.entries(fields).forEach(([fieldId, value]) => populateFieldValue(secId, fieldId, value));
    });
  }
  refreshDraftBanner();
  showToast('Drafts discarded — saved data restored');
}

// ─── AUTO-SAVE ────────────────────────────────────────────────────────────────
// The Save button is gone. Every change is recorded as it is made, and the only
// remaining button is the one that CLOSES a section.
//
// Two timers, deliberately different lengths, because the two writes cost
// different things:
//
//   400ms  → the localStorage draft (existing, unchanged). Free, local, and the
//            reason a locked phone or a killed tab cannot lose a sentence.
//   1500ms → a real backend save. Longer, because the Drive store costs per
//            OPERATION rather than per byte ([[store-round-trip-cost]]), and
//            short enough that the app is normally already saved by the time you
//            reach for the next field.
//
// The snapshot check is what keeps this cheap AND keeps the audit trail honest.
// A save that would write exactly what is already stored is not sent at all, so
// it produces no request and no audit row.
//
// WHAT AUTO-SAVE DELIBERATELY DOES NOT DO: mark the section done. `done[]` used to
// be appended by every save, which quietly made "done" mean "somebody touched
// this". It is now written only by closeSection, which is the one moment a section
// is actually finished — and that is what finally makes the 4/6 chip on the list
// card mean something.
const AUTOSAVE_PAUSE_MS = 1500;
const AUTOSAVE_RETRY_MS = 10000;   // after a failure, and it keeps retrying
const _autosaveTimers    = Object.create(null);
const _autosaveSnapshots = Object.create(null);   // sectionId → JSON of last saved fields
const _autosaveFailed    = Object.create(null);   // sectionId → true while unsaved

function scheduleAutoSave(unitId) {
  if (!isTrackedUnit(unitId) || !unitAutoSaves(unitId)) return;
  clearTimeout(_autosaveTimers[unitId]);
  _autosaveTimers[unitId] = setTimeout(() => {
    delete _autosaveTimers[unitId];
    autoSaveUnit(unitId);
  }, AUTOSAVE_PAUSE_MS);
}

// A flush happens at the moments a change would otherwise be lost: the field
// losing focus, the tab going to the background, and the page being hidden or
// closed. It is deliberately NOT awaited anywhere — the localStorage draft is the
// guarantee, and these are only about getting the entry to the server sooner.
//
// The filter is not a tidy-up. A flush must only send units that have something
// that can send them, because a flush that "succeeds" calls clearDraft() and
// deletes the dirty flag — so flushing a unit with no auto-save does not save it,
// it DISCARDS it while reporting success. See unitAutoSaves below for the one this
// used to happen to.
function flushDirtyUnits() {
  Object.keys(_autosaveTimers).forEach(id => {
    clearTimeout(_autosaveTimers[id]);
    delete _autosaveTimers[id];
  });
  Array.from(_dirtySections).filter(unitAutoSaves).forEach(id => autoSaveUnit(id));
}

// Which units the app auto-saves. The Overview keeps its own Save button in this
// pass: it is a ticket header rather than a section, it is gated on Triage rather
// than on a section grant, and converting it is a separate, smaller change.
//
// ONE function, read by BOTH ends, and that is the whole point. The timer and the
// flush used to answer this question separately and they disagreed: the timer
// refused the Overview while flushDirtyUnits auto-saved it anyway. collectSectionValues
// then knew no fields for the Overview, so such a flush posted an empty payload and,
// on its success, cleared the dirty flag and deleted the draft. Typing a CRM name
// and then switching apps sent nothing, showed the saved note anyway, and left the
// leave guard silent — the edit was gone with no warning at all.
function unitAutoSaves(unitId) {
  return unitId !== OVERVIEW_KEY;
}

async function autoSaveUnit(unitId) {
  const irNumber = currentIR?.irNumber;
  if (!irNumber) return;
  // The writer is the last word on this, not the callers: every path that reaches
  // here has already been filtered, and this is what makes that filter an
  // optimisation rather than the only thing standing between a unit and a wrong save.
  if (!unitAutoSaves(unitId)) return;
  // A save is already on its way. Anything typed AFTER that request was built is
  // not in it, so the timer is re-armed instead of dropped — returning outright
  // would leave the newest keystrokes unsent until the next one happened to come.
  if (_savesInFlight.has(unitId)) { scheduleAutoSave(unitId); return; }
  if (!_dirtySections.has(unitId)) return;   // nothing changed since it last saved

  // A keystroke that put the SAME value back is not a change. The dirty flag is set
  // by any input event, including one that modifies nothing, so without this check
  // every cursor visit to a field would post a body identical to what is already
  // stored — and the backend writes a "saved" marker row per human save, which
  // would turn the audit trail into a keystroke log.
  const collected = collectSectionValues(unitId);
  const snapshot  = JSON.stringify(collected.fieldValues);
  if (_autosaveSnapshots[unitId] === snapshot && !_autosaveFailed[unitId]) {
    clearDraft(unitId);
    refreshDraftBanner();
    _dirtySections.delete(unitId);
    updateDirtyIndicators();
    setAutosaveNote(unitId, 'saved');
    return;
  }

  setAutosaveNote(unitId, 'saving');
  _savesInFlight.add(unitId);
  try {
    const saved = await postSectionSave(unitId, irNumber, { withFiles: true, collected });
    _autosaveSnapshots[unitId] = JSON.stringify(saved || {});
    delete _autosaveFailed[unitId];
    clearDraft(unitId);
    refreshDraftBanner();
    _dirtySections.delete(unitId);
    updateDirtyIndicators();
    setAutosaveNote(unitId, 'saved');
    if (unitId === 'sec-b') renderDispatchChecklist('h_dispatchChecklist');
    refreshEvidenceLinksAfterSave(unitId, irNumber);
    loadActivityLog(irNumber);
  } catch (err) {
    // NOT silent, and NOT final. The entry is still in the draft and the section
    // is still marked dirty, so the retry below has something to send.
    _autosaveFailed[unitId] = true;
    setAutosaveNote(unitId, 'error');
    clearTimeout(_autosaveTimers[unitId]);
    _autosaveTimers[unitId] = setTimeout(() => {
      delete _autosaveTimers[unitId];
      autoSaveUnit(unitId);
    }, AUTOSAVE_RETRY_MS);
  } finally {
    _savesInFlight.delete(unitId);
  }
}

// The one place that decides whether the section's change has reached the server.
// It never says "Saved" when the last attempt failed — a false Saved loses work
// and destroys trust in every other indicator in the app.
//
// The glyph is the app's own inline SVG rather than a literal tick, for the same
// reason every other glyph in this app is: there is ONE icon source, and a literal
// emoji in a string is a second one that no theme can restyle. The wording carries
// the meaning on its own if the icon ever fails to load.
function setAutosaveNote(unitId, state) {
  const el = document.getElementById('autosave-' + unitId);
  if (!el) return;
  el.dataset.state = state;
  if (state === 'saved') {
    el.innerHTML = iconSvg('check-circle') + '<span>' + escHtml(t('common.saved')) + '</span>';
  } else if (state === 'saving') {
    el.textContent = t('common.saving');
  } else if (state === 'failed') {
    el.textContent = t('common.notSaved');
  } else {
    el.textContent = t('common.retrying');
  }
}

// ─── CLOSING A SECTION ────────────────────────────────────────────────────────
// The one remaining button, and the only thing in the app that appends to
// `done[]`. Closing is the gate the Inspector speaks at: it is the moment a
// section is declared finished, which is why it is the only moment worth
// auditing as an event and the only moment the trackers move.
async function closeSection(sectionId, irNumber) {
  const section = SECTIONS[sectionId];
  if (!section || !irNumber) return;
  // A close posted while the section's auto-save is still in flight would race it:
  // two writes, and the close's diff computed against whatever the first one had
  // already stored. The user is told rather than left wondering why the tap did
  // nothing.
  if (_savesInFlight.has(sectionId)) { showToast('Still saving — try again in a moment.'); return; }
  _savesInFlight.add(sectionId);

  setAutosaveNote(sectionId, 'saving');
  try {
    // ALWAYS posts, even when nothing is dirty. Closing is a deliberate act and it
    // is the only moment worth recording as an event, so the backend is asked to
    // write its marker row here — which is what puts "closed at 14:20 by X" on the
    // timeline. Skipping the post on a clean section would make the close
    // invisible, which is the opposite of the point.
    //
    // Sending the current values at the same time is not redundant: closing a
    // section that still holds unsent typing would otherwise record the close
    // against a stale body.
    const saved = await postSectionSave(sectionId, irNumber, { withFiles: true, mode: 'close' });
    _autosaveSnapshots[sectionId] = JSON.stringify(saved || {});
    delete _autosaveFailed[sectionId];
    clearDraft(sectionId);
    refreshDraftBanner();
    _dirtySections.delete(sectionId);
    updateDirtyIndicators();
    if (sectionId === 'sec-b') renderDispatchChecklist('h_dispatchChecklist');
    refreshEvidenceLinksAfterSave(sectionId, irNumber);
    setAutosaveNote(sectionId, 'saved');
    await syncIRStateAfterSectionSave(sectionId, irNumber);
    markSectionClosed(sectionId);
    loadActivityLog(irNumber);
    showToast(`Section ${sectionId.replace('sec-', '').toUpperCase()} closed.`);
  } catch (err) {
    // NOT 'error', which reads "retrying" — nothing retries a close, because closing
    // is a deliberate act and the app will not declare a section finished on the
    // user's behalf. So it says what actually happened and what to do about it.
    setAutosaveNote(sectionId, 'failed');
    showToast('Could not close the section: ' + err.message + ' — your entries are kept as a draft.');
  } finally {
    _savesInFlight.delete(sectionId);
  }
}

// Paint the closed state on the button and the tab, so a section that is finished
// looks finished everywhere it is visible.
function markSectionClosed(sectionId) {
  const btn = document.getElementById('close-' + sectionId);
  if (btn) { btn.classList.add('is-closed'); btn.innerHTML = iconSvg('check-circle') + '<span>' + escHtml(t('section.closed')) + '</span>'; }
  const tab = document.querySelector(`.tab[data-section="${sectionId}"]`);
  if (tab) tab.classList.add('is-closed');
}
function markSectionReopened(sectionId) {
  const btn = document.getElementById('close-' + sectionId);
  if (btn) { btn.classList.remove('is-closed'); btn.textContent = closeLabel(sectionId); }
  const tab = document.querySelector(`.tab[data-section="${sectionId}"]`);
  if (tab) tab.classList.remove('is-closed');
}
function closeLabel(sectionId) {
  return t('section.close', { letter: sectionId.replace('sec-', '').toUpperCase() });
}
// Which sections this IR has already closed, painted from app-owned state. Called
// wherever the IR's state is applied so the button is right on open, not only
// after a click in this session.
function paintClosedSections(irNumber) {
  const row = irState[irNumber] || {};
  const done = Array.isArray(row.done) ? row.done : [];
  SECTION_IDS.forEach(secId => { done.includes(secId) ? markSectionClosed(secId) : markSectionReopened(secId); });
  // The two answers are painted together because they read the same row and disagree
  // if they are ever painted apart: "this section is closed" and "the IR is standing
  // on this section's stage" are exactly the two facts the move offer is built from.
  paintBoardMoveOffer(irNumber);
}


// ─── UNSAVED-CHANGE TRACKING ─────────────────────────────────────────────────
// Which sections hold typing that has not been saved yet.
//
// Why this exists when drafts already persist the text: the guard on the way out
// (the title, the Back button) must answer "is anything unsaved?" the instant it is
// clicked, and for 400 ms after a keystroke the stored draft is still empty — so a
// click in that window would leave without asking. This Set is written on the same
// keystroke, synchronously, so the answer is never stale.
//
// It is the draft's sibling, not the same thing: a draft survives a reload, this
// does not. A reload is not a navigation this guard can intercept; the draft banner
// is what covers that case.
//
// The Overview is tracked under OVERVIEW_KEY even though it has no tab. It has no
// draft either (it sits outside #sections-wrapper on purpose — see index.html), so
// for the Overview this flag is the ONLY thing standing between a half-typed
// contact phone and a silent exit.
const _dirtySections = new Set();

function isTrackedUnit(unitId) {
  return unitId === OVERVIEW_KEY || !!SECTIONS[unitId];
}

function markSectionDirty(unitId) {
  if (!isTrackedUnit(unitId)) return;      // the read-only 📋 Report tab has no save
  // Scheduled BEFORE the early return below, and that placement is the point: the
  // return fires on every keystroke after the first, so a schedule placed after it
  // would never be pushed out by continued typing and the save would land in the
  // middle of a sentence.
  scheduleAutoSave(unitId);
  if (_dirtySections.has(unitId)) return;
  _dirtySections.add(unitId);
  updateDirtyIndicators();
}

function hasUnsavedChanges() {
  return _dirtySections.size > 0;
}

// Paint the "unsaved" dot on the tab strip. The Overview has no tab, so it simply
// matches nothing here — its warning arrives through the leave prompt, which names
// it by title.
function updateDirtyIndicators() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('has-unsaved', _dirtySections.has(tab.dataset.section));
  });
}

// Human names for the leave prompt, so it says WHICH sections are at risk instead
// of a bare "you have unsaved changes".
function dirtyUnitLabels() {
  return Array.from(_dirtySections).map(id => {
    if (id === OVERVIEW_KEY) return 'Overview';
    const t = document.querySelector(`.tab[data-section="${id}"]`);
    return t ? t.textContent.trim() : id;
  });
}

// The one guard shared by the title and the Back button — they do the same thing,
// so they must ask the same question. `confirm()` rather than a bespoke modal
// because this is the house idiom for a navigating confirm (see the restore and
// account prompts) and it cannot be missed or dismissed into a wrong answer.
function confirmLeaveIR() {
  if (!hasUnsavedChanges()) return true;
  const labels = dirtyUnitLabels();
  const what = labels.length === 1 ? labels[0] : labels.join(', ');
  return confirm(
    'You have unsaved changes in ' + what + '.\n\n' +
    'Nothing you typed is lost — it is kept as a draft on this device and put back ' +
    'when you open this IR again. It has not reached the server yet.\n\n' +
    'Leave anyway?'
  );
}

// Sections with a save in flight. A Set rather than a boolean so two sections can
// be saved at once — the guard is per-section, which is the unit the backend writes
// and the unit the button belongs to.
const _savesInFlight = new Set();

// The POST itself, with no user interface attached to it at all. Both the auto-save
// and the Close button go through here, which is why neither of them can drift from
// the other: there is one payload shape, one endpoint and one error path.
//
// It returns the values it sent, so the caller can remember exactly what the server
// now holds. That snapshot is what lets a later save be skipped as a no-op instead
// of posting an identical body and writing a pointless row into the audit trail.
async function postSectionSave(sectionId, irNumber, opts) {
  // `withFiles: false` is for a caller that knows it holds no new files. Every
  // current caller sends files — auto-save and Close both include whatever has
  // been picked but not yet uploaded, since a picked file IS an unsent change.
  const withFiles = !(opts && opts.withFiles === false);

  const formData = new FormData();
  formData.append('action', 'saveSection');
  formData.append('irNumber', irNumber);
  formData.append('sectionId', sectionId);
  formData.append('savedBy', currentUser?.email || 'unknown');

  // A caller that has already read the DOM to decide whether this save is even
  // worth making passes its result in, rather than making this function read the
  // whole section a second time — which on the tables is not free.
  const { fieldValues, fileFields } = (opts && opts.collected) || collectSectionValues(sectionId);
  formData.append('fields', JSON.stringify(fieldValues));
  // 'auto' or 'close'. The backend writes a "saved" marker row per human save, and
  // that marker is what the timeline shows as an event. An auto-save is not an
  // event — it is a keystroke landing — so it must not write one, or the trail
  // becomes a keystroke log and the closes are buried in it. The FIELD-level rows
  // still record every real edit; only the contentless marker is suppressed.
  formData.append('mode', (opts && opts.mode) || 'auto');

  const filePayload = [];
  if (withFiles) {
    await Promise.all(fileFields.map(async ff => {
      const files = Array.from(ff.files);
      const b64s = await Promise.all(files.map(f => fileToBase64(f)));
      b64s.forEach((b64, idx) => {
        filePayload.push({
          fieldId: ff.id,
          name: files[idx].name,
          mimeType: resolveFileMime(files[idx]),
          base64: b64,
        });
      });
    }));
  }
  formData.append('files', JSON.stringify(filePayload));

  const res  = await fetch(CONFIG.GAS_URL, { method: 'POST', body: formData });
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(data.message || 'Backend error');
  return fieldValues;
}

// The explicit save, kept for the one caller that is a deliberate act rather than a
// keystroke: pushing a Log Analyser report into Section D (see the analyser's
// "Push to IR"). It gives button feedback because that caller has a button in front
// of the user; it does NOT close the section, because writing a report into D is
// not the same statement as declaring D finished.
async function saveSection(sectionId, irNumber) {
  const btn = document.getElementById('save-' + sectionId);
  const section = SECTIONS[sectionId];
  if (!section) return;

  // A second click while the first request is in flight would post the same section
  // twice: two writes, two audit batches, and the second one's diff computed against
  // whatever the first had already stored.
  if (_savesInFlight.has(sectionId)) return;
  _savesInFlight.add(sectionId);

  const btnLabel = `Save Section ${sectionId.replace('sec-', '').toUpperCase()}`;
  if (btn) { btn.textContent = 'Saving…'; btn.className = 'btn saving'; btn.disabled = true; }
  setAutosaveNote(sectionId, 'saving');

  try {
    const saved = await postSectionSave(sectionId, irNumber, { withFiles: true });
    _autosaveSnapshots[sectionId] = JSON.stringify(saved || {});
    delete _autosaveFailed[sectionId];
    if (btn) { btn.textContent = '✓ Saved!'; btn.className = 'btn saved'; }
    setAutosaveNote(sectionId, 'saved');
    clearDraft(sectionId);
    refreshDraftBanner();
    // Marked clean BEFORE the toast, so the header-title guard reads the truth
    // from the moment the save lands — not 3 seconds later when the button
    // resets, which is when a click on the title would still see "unsaved".
    _dirtySections.delete(sectionId);
    updateDirtyIndicators();
    showToast('Section saved successfully!');
    // For sections with image evidence, pull the freshly-uploaded Drive URLs
    // back into the in-memory state so captions stay paired with images.
    refreshEvidenceLinksAfterSave(sectionId, irNumber);
    // Saving Section B changes the goods Section H verifies against — refresh
    // the dispatch checklist so it lists exactly what was received.
    if (sectionId === 'sec-b') renderDispatchChecklist('h_dispatchChecklist');
    loadActivityLog(irNumber);
  } catch (err) {
    if (btn) { btn.textContent = '⚠ Retry Save'; btn.className = 'btn error'; }
    setAutosaveNote(sectionId, 'error');
    showToast('❌ Save failed: ' + err.message + ' — your entries are kept as a draft.');
  }

  setTimeout(() => {
    _savesInFlight.delete(sectionId);
    if (btn) {
      btn.textContent = btnLabel;
      btn.className = 'btn';
    }
    // Re-enabled through the ACCESS sweep, never with a bare `disabled = false`.
    // A blind re-enable would hand Save back to a view-only user whose access
    // payload arrived while this request was in flight — which is precisely the
    // silent failure applySectionAccessGating exists to prevent, and it is the
    // reason smoke-access.mjs asserts that every write control agrees with the
    // Close button.
    if (typeof applySectionAccessGating === 'function') applySectionAccessGating();
    else if (btn) btn.disabled = false;
  }, 3000);
}

// CLOSING a section is the one place that knows an IR was actually finished, so it
// is where the app takes ownership of that IR's workflow state.
//
// This used to run on every save, which is exactly the bug the auto-save change
// fixes: `done[]` grew on any touch, so the 4/6 chip counted sections somebody had
// typed in rather than sections somebody had declared finished. It is now called
// from closeSection and from nowhere else.
function syncIRStateAfterSectionSave(sectionId, irNumber) {
  // Status is no longer mirrored from a section form. The IR Status dropdown lived
  // in Section A, which is gone; status is now written only by the Triage modal
  // (see applyTriage), which owns `status`/`statusOwned`/`statusAt` itself. A
  // section save that happens to post a status key must not be able to move the
  // workflow clock.
  return patchIRState(irNumber, { done: markSectionDone(irNumber, sectionId) });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
  });
}
// The MIME type of a picked file, taken from its NAME when the browser could not
// say. Android's picker and some camera apps hand over a file with an empty
// `File.type`, and passing that straight through is what made uploads vanish on
// those phones. Mirrors `mimeFromName`/`resolveMime` in backend.gs — the backend
// is the authority (it must be, since a client gate is not a gate), and this copy
// is only so the payload is honest about what it is sending.
function mimeFromFileName(name) {
  const ext = (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg',
    png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
    pdf: 'application/pdf',
  };
  return map[ext] || '';
}
function resolveFileMime(file) {
  const declared = String(file?.type || '');
  const generic = !declared || declared === 'application/octet-stream' || declared === 'binary/octet-stream';
  const byName = mimeFromFileName(file?.name);
  return (generic && byName) ? byName : (declared || byName || 'application/octet-stream');
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
  });
}

// ─── PER-SECTION PDF EXPORT ───────────────────────────────────────────────────
// Every section exports as a real PDF *file* — not a print dialog — so it can be
// attached to an email or handed to a phone's share sheet.
//
// Three layers, deliberately, so the parts that can be got wrong are testable
// without a browser and without the library:
//
//   sectionPdfModel()    pure. values → blocks. No DOM, no pdf-lib.
//   collectExportMedia() resolves bytes: normalises photos, reads attached PDFs.
//   drawSectionPdf()     the only pdf-lib code, and it takes the library by
//                        injection so the suites can drive it with a fake.
//
// `PDFLib` is referenced ONLY inside a function body (through pdfLib()). The
// suites evaluate this file under a stub DOM with no `PDFLib` in scope, so a
// module-level mention would take all of them down.

const EXPORT_IMAGE_LONG_EDGE = 1600;
const EXPORT_IMAGE_QUALITY = 0.82;

// A photo goes INTO the report and a PDF is appended to it — but only if its bytes
// can be had. A file attached in this sitting is in memory and always can be; one
// attached earlier is only a Drive URL, and whether that can be read back is up to
// Drive's CORS headers. Everything below treats "cannot read it back" as a thing to
// REPORT, never as a thing to silently drop.

// WinAnsi — the encoding of the standard PDF fonts — cannot represent most
// non-Latin-1 characters, and pdf-lib THROWS on one rather than dropping it, so a
// single emoji in a Remarks box would fail the whole export. Fold the common
// typographic characters down to ASCII and replace whatever is left.
//
// The table is written as code points, not as literals: the tick and the cross sit
// in the U+2600–27BF block, which tools/smoke-ui.mjs counts as emoji in app.js, and
// that count is a fixed ledger that may only go down.
const PDF_CHAR_MAP = (() => {
  const map = {};
  [
    [0x2013, '-'], [0x2014, '-'],           // en dash, em dash
    [0x2018, "'"], [0x2019, "'"],           // curly single quotes
    [0x201C, '"'], [0x201D, '"'],           // curly double quotes
    [0x2026, '...'], [0x2022, '-'],         // ellipsis, bullet
    [0x2713, 'v'], [0x2717, 'x'],           // tick, cross
    [0x2192, '->'], [0x20B9, 'Rs.'],        // arrow, rupee
  ].forEach(pair => { map[String.fromCharCode(pair[0])] = pair[1]; });
  return map;
})();

// Exactly what WinAnsi can carry: printable ASCII, plus Latin-1 from 0xA0 up. A
// replacement callback rather than a character class, so a character outside it is
// never handed to pdf-lib raw. Two details that are easy to get wrong:
//
//   - A control character is not drawable at all, and a newline that reaches here —
//     it should not, since the drawer wraps first — becomes a SPACE rather than the
//     "?" a reader would read as a typo.
//   - The `u` flag, so an emoji is one code point and becomes ONE "?", not the two
//     that its surrogate halves would each produce.
function pdfSafe(s) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff]/gu, c => (c in PDF_CHAR_MAP ? PDF_CHAR_MAP[c] : '?'));
}

// Scale a w×h box so its LONG edge is at most `max`. Never upscales: a small photo
// stays sharp rather than being blown up into a blurry one.
function fitLongEdge(w, h, max) {
  const width = Number(w) || 0, height = Number(h) || 0;
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0, scale: 1 };
  const longest = Math.max(width, height);
  const scale = longest > max ? max / longest : 1;
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}

// Greedy word wrap. Two things a naive split(' ') gets wrong and this does not: an
// explicit newline typed into a textarea is a break the author meant, and a single
// word wider than the column (a long URL) has to be hard-broken or it runs off the
// page. Pure — takes a pdf-lib font because that is what knows the widths.
//
// The fold to WinAnsi happens HERE, not at the draw call: `widthOfTextAtSize` encodes
// the string too, so measuring an emoji throws before anything is drawn. Folding per
// paragraph — after the split — is what keeps a typed blank line a blank line instead
// of letting pdfSafe turn its newline into a space.
function wrapText(text, font, size, maxWidth) {
  const raw = String(text == null ? '' : text);
  if (!raw) return [];
  const lines = [];
  raw.split('\n').forEach(paragraphRaw => {
    const paragraph = pdfSafe(paragraphRaw);
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); return; }
    let line = '';
    for (let word of words) {
      while (font.widthOfTextAtSize(word, size) > maxWidth && word.length > 1) {
        let cut = 1;
        while (cut < word.length && font.widthOfTextAtSize(word.slice(0, cut + 1), size) <= maxWidth) cut++;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      if (!word) continue;
      const candidate = line ? line + ' ' + word : word;
      if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  });
  return lines;
}

function analysisNoteText(ir) {
  const irNum = (ir && ir.irNumber) || 'IRXXX';
  const drone = (ir && ir.droneId) || 'XXXXX';
  return `Dear customer, analysis of ${irNum} for your system with ID ${drone} has been completed. Its findings are as below.`;
}

// The four table shapes the app stores, each with the columns it is shown under.
// Row builders are defensive: a half-filled row is a row, not a crash.
const EXPORT_TABLES = {
  inwardTable: {
    columns: ['Particulars', 'Model', 'Qty', 'Remark'],
    rows: v => Object.keys(v || {}).map(k => [k, (v[k] || {}).model || '', (v[k] || {}).qty || '', (v[k] || {}).remark || '']),
  },
  iqcTable: {
    columns: ['Zone / Item', 'Result', 'Remark'],
    rows: v => Object.keys(v || {}).map(k => [(v[k] || {}).name || k, (v[k] || {}).result || '', (v[k] || {}).remark || '']),
  },
  costTable: {
    columns: ['Item description', 'Qty', 'Unit cost', 'Total cost', 'Remark'],
    rows: v => (Array.isArray(v) ? v : []).map(r => [(r || {}).particular || '', (r || {}).qty || '', (r || {}).rate || '', (r || {}).cost || '', (r || {}).remark || '']),
  },
  dispatchChecklist: {
    columns: ['Particular', 'Status'],
    rows: v => Object.keys(v || {}).map(k => [k, v[k] || '']),
  },
};

// values → blocks. Driven entirely by SECTIONS, so a field added to a section later
// appears in its export without anyone touching this function.
function sectionPdfModel(sectionId, fieldValues, ir) {
  const section = SECTIONS[sectionId];
  if (!section) return { title: '', irNumber: '', droneId: '', blocks: [] };
  const values = fieldValues || {};
  const blocks = [];

  section.fields.forEach(field => {
    const value = values[field.id];

    if (field.type === 'divider') {
      if (field.label) blocks.push({ kind: 'divider', text: field.label });
      return;
    }
    if (field.type === 'analysisNote') {
      blocks.push({ kind: 'note', text: analysisNoteText(ir) });
      return;
    }
    if (field.type === 'checkpointEvidence') {
      blocks.push({
        kind: 'field',
        label: field.tickLabel || field.label || '',
        value: (value && value.done) ? 'Done' : 'Not done',
      });
      const items = (Array.isArray(value && value.attach) ? value.attach : []).map((e, i) => ({
        key: `${field.id}_attach#${i}`,
        caption: (e && e.caption) || '', name: (e && e.name) || '', type: (e && e.type) || '',
      }));
      if (items.length) blocks.push({ kind: 'images', label: field.label || '', items: items });
      return;
    }
    if (field.type === 'imageEvidence') {
      const items = (Array.isArray(value) ? value : []).map((e, i) => ({
        key: `${field.id}#${i}`,
        caption: (e && e.caption) || '', name: (e && e.name) || '', type: (e && e.type) || '',
      }));
      if (items.length) blocks.push({ kind: 'images', label: field.label || '', items: items });
      return;
    }
    const table = EXPORT_TABLES[field.type];
    if (table) {
      const rows = table.rows(value);
      if (rows.length) blocks.push({ kind: 'table', label: field.label || '', columns: table.columns, rows: rows });
      return;
    }
    // text, textarea, date, select, courierName, and anything added later.
    let out = value == null ? '' : String(value);
    if (field.type === 'date' && out) out = toDisplayDate(out);
    blocks.push({ kind: 'field', label: field.label || '', value: out });
  });

  return {
    title: section.title,
    irNumber: (ir && ir.irNumber) || '',
    droneId: (ir && ir.droneId) || '',
    blocks: blocks,
  };
}

function pdfLib() {
  return (typeof PDFLib !== 'undefined' && PDFLib) ? PDFLib : null;
}

// A saved attachment is only a Drive URL. Try the preview host first (the one the
// app already uses for thumbnails), then the stored link itself. Either can fail on
// CORS — that is a null, not an exception.
async function fetchEvidenceBlob(entry) {
  const id = driveFileId(entry && entry.link);
  const urls = [];
  if (id) urls.push(`https://lh3.googleusercontent.com/d/${id}`);
  if (safeUrl(entry && entry.link)) urls.push(entry.link);
  for (const url of urls) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) return await res.blob();
    } catch { /* try the next one */ }
  }
  return null;
}

// Browser-only: canvas → JPEG at the long-edge cap. Split from fitLongEdge so the
// arithmetic is testable without a canvas.
async function normalizeImage(blob) {
  const bitmap = await createImageBitmap(blob);
  const size = fitLongEdge(bitmap.width, bitmap.height, EXPORT_IMAGE_LONG_EDGE);
  if (!size.width || !size.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, size.width, size.height);
  if (bitmap.close) bitmap.close();
  const out = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', EXPORT_IMAGE_QUALITY));
  if (!out) return null;
  return new Uint8Array(await out.arrayBuffer());
}

// Resolve every attachment in a section into either embeddable bytes or a named
// record of what could not be read. `lib` is only used to ask "would pdf-lib accept
// this?", so a PDF that would fail mid-draw is known to be a leftover BEFORE the
// report is written and the user can be told.
async function collectExportMedia(sectionId, lib) {
  const section = SECTIONS[sectionId];
  const images = new Map();
  const attachments = [];
  if (!section) return { images: images, attachments: attachments };

  const keys = [];
  section.fields.forEach(field => {
    if (field.type === 'imageEvidence') keys.push(field.id);
    else if (field.type === 'checkpointEvidence') keys.push(field.id + '_attach');
  });

  for (const fieldId of keys) {
    const entries = evidenceState[fieldId] || [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const key = `${fieldId}#${i}`;
      const isPdf = guessEvidenceType(e) === 'pdf';

      if (isPdf) {
        let bytes = null;
        try {
          const blob = e.file || await fetchEvidenceBlob(e);
          if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
        } catch { bytes = null; }
        const record = {
          key: key,
          name: e.name || e.caption || `Attachment ${attachments.length + 1}.pdf`,
          bytes: bytes,
          mergeable: false,
        };
        if (bytes && lib && lib.PDFDocument) {
          try {
            await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
            record.mergeable = true;
          } catch { record.mergeable = false; }
        }
        attachments.push(record);
      } else {
        let jpeg = null;
        try {
          const blob = e.file || await fetchEvidenceBlob(e);
          if (blob) jpeg = await normalizeImage(blob);
        } catch { jpeg = null; }
        if (jpeg) images.set(key, jpeg);
      }
    }
  }
  return { images: images, attachments: attachments };
}

// The only function that touches pdf-lib. A4, 40pt margins, Helvetica.
async function drawSectionPdf(model, media, lib) {
  if (!lib || !lib.PDFDocument) throw new Error('PDF library not loaded');
  const { PDFDocument, StandardFonts, rgb } = lib;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595.28, PAGE_H = 841.89, M = 40;   // A4 in points
  const CONTENT_W = PAGE_W - M * 2;
  const INK = rgb(0.06, 0.09, 0.16);
  const MUTED = rgb(0.45, 0.50, 0.58);
  const RULE = rgb(0.85, 0.88, 0.92);
  const HEAD = rgb(0.10, 0.15, 0.25);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;
  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - M; };
  const room = h => { if (y - h < M) newPage(); };
  const gap = h => { y -= h; };

  // Draw one wrapped paragraph. `y` is the TOP of the line; the baseline sits one
  // font-size below it.
  const line = (text, opts) => {
    const o = opts || {};
    const f = o.bold ? bold : font;
    const size = o.size || 10;
    const x = o.x != null ? o.x : M;
    const lh = size * 1.35;
    wrapText(text, f, size, o.width || CONTENT_W).forEach(text => {
      room(lh);
      page.drawText(pdfSafe(text), { x: x, y: y - size, font: f, size: size, color: o.color || INK });
      y -= lh;
    });
  };
  const rule = () => {
    room(10);
    page.drawLine({ start: { x: M, y: y }, end: { x: PAGE_W - M, y: y }, thickness: 0.7, color: RULE });
    gap(10);
  };

  // ── Masthead ──
  line('INDRONES AFTER-SALES  ·  I-PASSBOOK', { size: 8, color: MUTED });
  gap(2);
  line(model.title, { size: 17, bold: true, color: HEAD });
  gap(2);
  const meta = [model.irNumber && `IR: ${model.irNumber}`, model.droneId && `System ID: ${model.droneId}`].filter(Boolean);
  if (meta.length) line(meta.join('     '), { size: 9.5, color: MUTED });
  gap(4);
  rule();

  // ── Body ──
  for (const block of model.blocks) {
    if (block.kind === 'divider') {
      gap(10);
      line(block.text, { size: 12, bold: true, color: HEAD });
      rule();
    } else if (block.kind === 'note') {
      gap(6);
      line(block.text, { size: 10, color: INK, x: M + 14, width: CONTENT_W - 14 });
      gap(6);
    } else if (block.kind === 'field') {
      gap(8);
      if (block.label) line(block.label, { size: 8.5, bold: true, color: MUTED });
      const filled = block.value != null && String(block.value).trim() !== '';
      line(filled ? block.value : '—', { size: 10.5, color: filled ? INK : MUTED });
    } else if (block.kind === 'images') {
      gap(10);
      if (block.label) line(block.label, { size: 8.5, bold: true, color: MUTED });
      for (const item of block.items) {
        if (item.type === 'pdf') continue;   // listed under Attached documents instead
        const jpeg = media.images.get(item.key);
        let embedded = null;
        if (jpeg) { try { embedded = await doc.embedJpg(jpeg); } catch { embedded = null; } }
        if (!embedded) {
          line(`${item.caption || item.name || 'Image'} — not included`, { size: 9, color: MUTED });
          continue;
        }
        // Fit the column, and never taller than a whole page.
        const scale = Math.min(CONTENT_W / embedded.width, (PAGE_H - M * 2) / embedded.height, 1);
        const w = embedded.width * scale, h = embedded.height * scale;
        room(h + 10);
        page.drawImage(embedded, { x: M + (CONTENT_W - w) / 2, y: y - h, width: w, height: h });
        gap(h + 5);
        if (item.caption) line(item.caption, { size: 8.5, color: MUTED });
        gap(10);
      }
    } else if (block.kind === 'table') {
      gap(10);
      if (block.label) line(block.label, { size: 8.5, bold: true, color: MUTED });
      // First column takes 30%; the rest share what is left.
      const widths = block.columns.length === 1
        ? [CONTENT_W]
        : [CONTENT_W * 0.30].concat(new Array(block.columns.length - 1).fill((CONTENT_W * 0.70) / (block.columns.length - 1)));
      const drawRow = (cells, size, f, color) => {
        const lh = size * 1.3;
        const wrapped = block.columns.map((_, i) => wrapText(cells[i] == null ? '' : String(cells[i]), f, size, widths[i] - 8));
        const rowH = Math.max(1, ...wrapped.map(w => w.length)) * lh + 6;
        room(rowH);
        let x = M;
        wrapped.forEach((columnLines, i) => {
          columnLines.forEach((text, k) => {
            page.drawText(pdfSafe(text), { x: x + 4, y: y - size - k * lh - 3, font: f, size: size, color: color });
          });
          x += widths[i];
        });
        y -= rowH;
        page.drawLine({ start: { x: M, y: y }, end: { x: PAGE_W - M, y: y }, thickness: 0.4, color: RULE });
      };
      drawRow(block.columns, 8.5, bold, MUTED);
      block.rows.forEach(row => drawRow(row, 9.5, font, INK));
    }
  }

  // ── Attached documents ──
  // Every attached PDF is named, whether or not it made it inside. A document that
  // silently loses an attachment is worse than one that admits it.
  if (media.attachments.length) {
    gap(16);
    line('Attached documents', { size: 12, bold: true, color: HEAD });
    rule();
    media.attachments.forEach(a => {
      line(a.mergeable ? `${a.name} — included below` : `${a.name} — not included (could not be read back)`,
           { size: 9.5, color: a.mergeable ? INK : MUTED });
      gap(2);
    });
  }

  // ── Append the attachments we could read ──
  for (const a of media.attachments) {
    if (!a.mergeable || !a.bytes) continue;
    const source = await PDFDocument.load(a.bytes, { ignoreEncryption: true });
    const pages = await doc.copyPages(source, source.getPageIndices());
    pages.forEach(p => doc.addPage(p));
  }

  return await doc.save();
}

// `IR409 - Section B.pdf`, with everything a filesystem would object to removed.
// The reserved characters are a list rather than a character class on purpose: this
// file's comment stripper reads a double quote inside a regex literal as the start
// of a string and then loses its place for the rest of the file.
function sanitizeFileName(s) {
  let out = String(s == null ? '' : s);
  ['\\', '/', ':', '*', '?', '"', '<', '>', '|'].forEach(ch => { out = out.split(ch).join('-'); });
  return out.replace(/[\x00-\x1f\x7f]/g, '-').replace(/\s+/g, ' ').trim() || 'export';
}
function exportFileName(irNumber, sectionId) {
  const letter = String(sectionId || '').replace(/^sec-/, '').toUpperCase();
  return sanitizeFileName(`${irNumber || 'IR'} - Section ${letter}`) + '.pdf';
}

// Hand the file(s) over. The share sheet takes them all at once; anything without
// one falls back to a download, which is the desktop case.
async function deliverExportFiles(files, share) {
  if (share && navigator.canShare && navigator.canShare({ files: files })) {
    try {
      await navigator.share({ files: files });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;   // the user backed out
    }
  }
  files.forEach(file => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}

function setExportBusy(btn, busy) {
  if (!btn) return () => {};
  const original = btn.textContent;
  btn.disabled = busy;
  btn.style.opacity = busy ? '0.6' : '';
  if (busy) btn.textContent = 'Preparing…';
  return () => { btn.disabled = false; btn.style.opacity = ''; btn.textContent = original; };
}

async function exportSectionPdf(sectionId, opts) {
  const share = !!(opts && opts.share);
  const lib = pdfLib();
  if (!lib) { showToast('The PDF library did not load — reload the page and try again'); return; }

  const btn = document.getElementById((share ? 'share-' : 'download-') + sectionId);
  const done = setExportBusy(btn, true);
  try {
    const media = await collectExportMedia(sectionId, lib);
    const { fieldValues } = collectSectionValues(sectionId);
    const model = sectionPdfModel(sectionId, fieldValues, currentIR);

    // Say what will be missing BEFORE the work, not after.
    const missing = media.attachments.filter(a => !a.mergeable);
    if (missing.length) {
      const verb = share ? 'shared' : 'downloaded';
      const msg = `${missing.length} attached PDF${missing.length > 1 ? 's' : ''} could not be read back from Drive, `
        + `so ${missing.length > 1 ? 'they are' : 'it is'} NOT inside this report:\n\n`
        + missing.map(a => `  • ${a.name}`).join('\n')
        + `\n\nThe report itself will be ${verb} normally, and will name `
        + `${missing.length > 1 ? 'them' : 'it'} at the end. Continue?`;
      if (!window.confirm(msg)) return;
    }

    const bytes = await drawSectionPdf(model, media, lib);
    const file = new File([bytes], exportFileName(currentIR && currentIR.irNumber, sectionId), { type: 'application/pdf' });
    await deliverExportFiles([file], share);
    if (missing.length) showToast(`Exported — ${missing.length} attachment${missing.length > 1 ? 's were' : ' was'} named, not included`);
  } catch (err) {
    showToast('Could not build the PDF — ' + ((err && err.message) || 'unknown error'));
  } finally {
    done();
  }
}

// ─── IMAGE EVIDENCE ───────────────────────────────────────────────────────────
// Per-image evidence with a name/context caption, used by every section that
// carries photos (B, C, D, F, G). New images are uploaded to Drive via the
// existing file mechanism (fieldId '_links'); captions + the already-uploaded
// Drive URLs live in the field value as [{caption, link}]. The backend overwrites
// '_links' with only the newly-uploaded URLs on each save, so already-uploaded
// links are carried in the field value and re-sent on every save; newly-uploaded
// links are merged back from '_links' after a save (and on load) so captions stay
// paired with their images.
// Extract a Google Drive file id from a Drive URL (for direct image preview).
function driveFileId(link) {
  if (!link) return '';
  const s = String(link);
  const m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || s.match(/^https:\/\/drive\.google\.com\/open\?id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : '';
}
// Direct-renderable URL for a saved evidence image (Drive → lh3 preview) or the
// local blob URL for a not-yet-uploaded file.
function evidencePreviewUrl(e) {
  if (e.url) return e.url;
  if (e.link) {
    const id = driveFileId(e.link);
    if (id) return `https://lh3.googleusercontent.com/d/${id}=w600`;
    return e.link;
  }
  return '';
}
function guessEvidenceType(e) {
  if (e.type) return e.type;
  const n = (e.name || e.link || e.caption || '').toLowerCase();
  if (n.includes('.pdf') || n.includes('application/pdf')) return 'pdf';
  return 'image';
}
function renderImageEvidence(fieldId) {
  const list = document.getElementById(fieldId + '-list');
  if (!list) return;
  const entries = evidenceState[fieldId] || [];
  evidenceState[fieldId] = entries;
  list.innerHTML = entries.map((e, i) => {
    const isPdf = guessEvidenceType(e) === 'pdf';
    const preview = isPdf
      ? (() => {
          const href = e.link || e.url || '';
          const name = e.name || (e.file ? e.file.name : 'PDF document');
          return href
            ? `<a class="evidence-pdf-link" href="${escHtml(href)}" target="_blank" rel="noopener">
                 <span class="evidence-pdf-icon">📄</span>
                 <span class="evidence-pdf-name">${escHtml(name)}</span>
                 <span class="evidence-pdf-open">Open ↗</span>
               </a>`
            : `<div class="evidence-pdf-link"><span class="evidence-pdf-icon">📄</span><span class="evidence-pdf-name">${escHtml(name)}</span></div>`;
        })()
      : (() => {
          const src = evidencePreviewUrl(e);
          return src
            ? `<img src="${escHtml(src)}" class="evidence-thumb" alt="evidence" loading="lazy" />`
            : `<div class="evidence-thumb-placeholder">No preview</div>`;
        })();
    return `
      <div class="evidence-item${isPdf ? ' evidence-item-pdf' : ''}">
        ${preview}
        <input type="text" class="form-input evidence-caption"
               data-field="${escHtml(fieldId)}" data-idx="${i}"
               placeholder="Name / context of this file"
               value="${escHtml(e.caption || '')}"
               oninput="updateEvidenceCaption('${escHtml(fieldId)}', ${i}, this.value)" />
        <button type="button" class="evidence-remove"
                onclick="removeEvidenceImage('${escJsAttr(fieldId)}', ${i})" title="Remove">&#10005;</button>
      </div>`;
  }).join('');
}
function addEvidenceImage(fieldId) {
  document.getElementById(fieldId + '-picker').click();
}
// Open the device camera (mobile `capture="environment"` → back camera) to take
// a photo straight into the evidence list.
function captureEvidenceImage(fieldId) {
  const cap = document.getElementById(fieldId + '-capture');
  if (cap) cap.click();
}
function onEvidencePicked(fieldId, input) {
  const files = Array.from(input.files || []);
  if (!evidenceState[fieldId]) evidenceState[fieldId] = [];
  files.forEach(f => {
    const mime = resolveFileMime(f);
    const type = mime === 'application/pdf' ? 'pdf' : (mime.startsWith('image/') ? 'image' : '');
    evidenceState[fieldId].push({ caption: '', link: '', file: f, url: URL.createObjectURL(f), type, name: f.name });
  });
  input.value = '';
  renderImageEvidence(fieldId);
  saveDraft(sectionIdFromFieldId(fieldId));
}
// Tick on a checkpointEvidence box — persists a draft so the tick survives reload.
function onCheckpointTick(fieldId) {
  const secId = sectionIdFromFieldId(fieldId);
  if (secId) saveDraft(secId);
}
function removeEvidenceImage(fieldId, idx) {
  const arr = evidenceState[fieldId] || [];
  const e = arr[idx];
  if (e?.url) URL.revokeObjectURL(e.url);
  arr.splice(idx, 1);
  renderImageEvidence(fieldId);
  saveDraft(sectionIdFromFieldId(fieldId));
}

// ─── SECTION H — DISPATCH CHECKLIST (verify against Section B goods received) ──
// Renders one row per good actually received in Section B (Inward), each with a
// dropdown to confirm the same item is being dispatched back. The goods list is
// read live from the Section B table (so unsaved B edits show) then from saved
// data. Re-rendered whenever Section B changes; prior dispatch selections are
// preserved across re-renders via dispatchChecklistState.
function renderDispatchChecklist(fieldId) {
  const wrap = document.getElementById(fieldId);
  if (!wrap) return;

  // Source goods from Section B — live DOM first, then saved data.
  let inward = null;
  const bWrap = document.getElementById('b_inwardTable');
  if (bWrap) {
    const live = {};
    bWrap.querySelectorAll('.inward-row').forEach(row => {
      const modelEl = row.querySelector('.inward-model');
      const qtyEl   = row.querySelector('.inward-qty');
      const particular = modelEl?.dataset.particular;
      if (!particular) return;
      const model = modelEl?.value || '';
      const qty   = qtyEl?.value || '';
      if (model || qty) live[particular] = { model, qty };
    });
    if (Object.keys(live).length) inward = live;
  }
  if (!inward) inward = (currentSectionData?.['sec-b']?.b_inwardTable) || {};

  const items = Object.entries(inward).filter(([, c]) => c && (c.model || c.qty));
  const saved = dispatchChecklistState[fieldId] || {};

  if (!items.length) {
    wrap.innerHTML = '<div class="dispatch-empty">No goods recorded in Section B (Inward) yet. Fill &amp; save Section B first — every received particular will then appear here for the cross-check (pack exactly the same, nothing less or more).</div>';
    return;
  }
  // Tabular failsafe: each received particular (with model + qty received) sits
  // beside a "packed for dispatch?" dropdown. The operator confirms each line so
  // the dispatch matches the inward — nothing less, nothing more.
  const rows = items.map(([particular, cell]) => {
    const model = cell.model || '';
    const qty   = cell.qty || '';
    const particularCell = `${escHtml(particular)}${model ? '<br><span class="cc-sub">' + escHtml(model) + '</span>' : ''}`;
    return `
      <tr class="cc-row" data-particular="${escHtml(particular)}">
        <td class="cc-particular">${particularCell}</td>
        <td class="cc-received">${qty ? escHtml(qty) : '—'}</td>
        <td class="cc-packed">
          <select class="dispatch-select form-input" data-particular="${escHtml(particular)}">
            <option value="">— Pending —</option>
            <option value="Dispatched">✔ Packed (same as received)</option>
            <option value="Short">⚠ Short (less than received)</option>
            <option value="Missing">✘ Missing</option>
            <option value="Extra">+ Extra (more than received)</option>
            <option value="N/A">N/A</option>
          </select>
        </td>
      </tr>`;
  }).join('');
  wrap.innerHTML = `
    <div class="cc-note">Pack exactly the goods received during Inward — nothing less, nothing more. Mark each particular below.</div>
    <table class="crosscheck-table">
      <thead><tr><th>Particular (as received — Section B)</th><th>Qty received</th><th>Packed for dispatch?</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="crosscheck-summary" id="${fieldId}-summary"></div>`;
  wrap.querySelectorAll('.dispatch-select').forEach(sel => {
    const v = saved[sel.dataset.particular];
    if (v) sel.value = v;
    sel.addEventListener('change', () => {
      dispatchChecklistState[fieldId] = dispatchChecklistState[fieldId] || {};
      dispatchChecklistState[fieldId][sel.dataset.particular] = sel.value;
      updateCrossCheckSummary(fieldId);
      saveDraft(sectionIdFromFieldId(fieldId));
    });
  });
  updateCrossCheckSummary(fieldId);
}
// One-line verdict under the cross-check table: green when every received
// particular is packed as-received, otherwise a count of what's still pending /
// flagged so the operator knows the cross-check isn't complete.
function updateCrossCheckSummary(fieldId) {
  const el = document.getElementById(fieldId + '-summary');
  if (!el) return;
  const sels = document.querySelectorAll(`#${fieldId} .dispatch-select`);
  let packed = 0, pending = 0, flagged = 0, total = 0;
  sels.forEach(s => {
    total++;
    if (!s.value) pending++;
    else if (s.value === 'Dispatched') packed++;
    else flagged++;
  });
  if (total === 0) { el.innerHTML = ''; return; }
  if (packed === total) el.innerHTML = `<span class="cc-ok">✓ All ${total} particulars packed as received — ready to dispatch.</span>`;
  else el.innerHTML = `<span class="cc-warn">${pending} pending · ${packed} packed · ${flagged} flagged — finish the cross-check before dispatch.</span>`;
}
function collectDispatchChecklist(fieldId) {
  const wrap = document.getElementById(fieldId);
  const out = {};
  if (wrap) {
    wrap.querySelectorAll('.dispatch-select').forEach(sel => {
      if (sel.value) out[sel.dataset.particular] = sel.value;
    });
  }
  return out;
}
// Show / hide the free-text courier input when the "Other (type name)…" option is
// chosen (or cleared). Draft auto-save is handled by the global change listener.
function onCourierNameChange(id) {
  const sel = document.getElementById(id);
  const other = document.getElementById(id + '-other');
  if (!sel || !other) return;
  if (sel.value === '__other__') { other.style.display = 'block'; other.focus(); }
  else { other.style.display = 'none'; other.value = ''; }
}
function updateEvidenceCaption(fieldId, idx, value) {
  const arr = evidenceState[fieldId];
  if (arr && arr[idx]) arr[idx].caption = value;
  // draft auto-save is handled by the global `input` listener on #sections-wrapper
}
// Fill any pending (link='') entries in evidenceState[fieldId] with the Drive
// URLs the backend stored in '<fieldId>_links' (in upload order). Used both on
// load and after a successful save so captions stay aligned to their images.
function mergeEvidenceLinks(fieldId, linksRaw) {
  const arr = evidenceState[fieldId];
  if (!arr || !arr.length) return;
  const links = String(linksRaw || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!links.length) return;
  let li = 0;
  arr.forEach(e => {
    if (!e.link && li < links.length) {
      e.link = links[li++];
      if (e.url) { URL.revokeObjectURL(e.url); e.url = null; }
      e.file = null;
    }
  });
  renderImageEvidence(fieldId);
}
// After a save that uploaded new evidence images, fetch the section's '_links'
// from the backend and merge them into evidenceState so a later caption-only
// re-save carries the Drive URLs in 'd_evidence' (the backend overwrites
// '_links' with only the newest uploads, so links must live in 'd_evidence').
async function refreshEvidenceLinksAfterSave(sectionId, irNumber) {
  const fields = SECTIONS[sectionId]?.fields || [];
  // Direct imageEvidence fields + checkpointEvidence attachments (live under
  // <fieldId>_attach) both need their freshly-uploaded Drive URLs merged back in.
  const evFields = fields
    .filter(f => f.type === 'imageEvidence')
    .map(f => ({ id: f.id, type: 'imageEvidence' }));
  const cpFields = fields
    .filter(f => f.type === 'checkpointEvidence')
    .map(f => ({ id: f.id + '_attach', type: 'checkpointEvidence' }));
  const allEvFields = evFields.concat(cpFields);
  if (!allEvFields.length) return;
  const hasPending = allEvFields.some(f => (evidenceState[f.id] || []).some(e => !e.link));
  if (!hasPending) return;
  try {
    const url = `${CONFIG.GAS_URL}?action=getPassbook&irNumber=${encodeURIComponent(irNumber)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 'ok' && data.sections) {
      currentSectionData = data.sections; // keep the saved-state cache in sync
      const secFields = data.sections[sectionId] || {};
      allEvFields.forEach(f => mergeEvidenceLinks(f.id, secFields[f.id + '_links']));
    }
  } catch {}
}

// ─── THE BUSY BUTTON ──────────────────────────────────────────────────────────
// ONE way to say "this button is working", so the app cannot grow a second.
//
// The ring itself is CSS (`.btn.is-busy::before`, components.css) and NOT an
// element inserted here. That matters more than it looks: an inserted spinner has
// to be removed on every restore path, including the failure and the throw, and a
// button restored by `textContent = 'Sign in'` would leave a stale ring behind
// while one restored by `innerHTML` would not. A ::before cannot be orphaned and
// cannot be doubled by two toggles racing a slow reply.
//
// The label is passed in rather than remembered, because every call site already
// knew its own idle wording — it wrote it by hand before this existed — and a
// helper that guessed would make the helper a second place the copy lives.
function setBusy(btn, label) {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('is-busy');
  if (label != null) btn.textContent = label;
}
function setIdle(btn, label) {
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove('is-busy');
  if (label != null) btn.textContent = label;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
// ONE message at a time, and it REPLACES rather than queues.
//
// It used to be a queue: 3 seconds per message plus 300ms between, and one save
// enqueues two (the success line, and "Saved locally — backend unreachable"
// whenever the sentinel write fails). So a save could hold the screen for over six
// seconds, and because the element sat bottom-centre with `pointer-events: none`
// there was nothing the user could do about it — the owner's "a tile kind of thing
// in the bottom center … remains there after that and hides the screen behind it".
//
// Three changes, and each fixes a different way it could stick:
//   · replace, don't queue — a newer message overwrites the old and restarts the
//     clock, so the worst case is one message for one interval, never a backlog;
//   · the timer handle is KEPT, so dismissing by hand cancels it rather than
//     leaving a second one to fire against whatever is on screen by then;
//   · `_toastBusy` is reset defensively, because it used to be cleared only by a
//     timer reaching the end of the queue — one throw in between and nothing could
//     ever show a toast again, and the last one would stay up for good.
const TOAST_MS = 2500;

let _toastTimer = null;

function hideToast() {
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
  toast.classList.remove('show');
}

function showToast(msg) {
  // Written INTO the span rather than over it. `toast.textContent = msg` would
  // replace #toast-text with a bare text node on the first message, which quietly
  // turns the `#toast-text { pointer-events: none }` rule in base.css into dead
  // code — the tap-to-dismiss then depends on a rule that no longer applies to
  // anything. The fallback keeps a stale cached index.html working.
  const slot = document.getElementById('toast-text');
  if (slot) slot.textContent = msg; else toast.textContent = msg;
  toast.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    _toastTimer = null;
    toast.classList.remove('show');
  }, TOAST_MS);
}

// ─── NUDGE / TAG / ALERT SYSTEM ───────────────────────────────────────────────
// Lets any user @-tag a teammate (by name, with autocomplete from the Indrones
// directory) at three levels — the whole IR, a section, or a single field. The
// tagged person sees a 🔔 notification in-app, and the sender can also fire off a
// pre-filled email (mailto). No backend redeploy needed: nudges are stored via
// the existing generic saveSection/getPassbook endpoints under a special
// irNumber '__NUDGES__' / sectionId 'all' (same mechanism as the admin config).

// ── Team directory (admin-editable; used for @-mention autocomplete) ──
// A seed only — the admin owns this list from the editor. `customer.relations@`
// was removed from the seed with the Sept 2026 rewrite: it is no longer an
// account (see ADMIN_EMAILS), and a directory entry that resolves to no mailbox
// turns an @-mention into a silent bounce.
const TEAM_DIRECTORY_DEFAULTS = [
  { name: 'Monish Raza',        email: 'monish.raza@indrones.com' },
  { name: 'Ravi Singh',         email: 'ravi@indrones.com' },
  { name: 'Adhik Nair',          email: 'adhik.nair@indrones.com' },
];
let teamDirectory = TEAM_DIRECTORY_DEFAULTS.map(d => ({ ...d }));

function loadTeamDirectory() {
  // Local copy first; the shared one arrives via applyTeamDirectory().
  try {
    const local = localStorage.getItem('ipb_team_directory');
    if (local) { const arr = JSON.parse(local); if (Array.isArray(arr) && arr.length) teamDirectory = arr; }
  } catch {}
}

function applyTeamDirectory(saved) {
  if (saved && Array.isArray(saved.entries) && saved.entries.length) {
    teamDirectory = saved.entries;
    try { localStorage.setItem('ipb_team_directory', JSON.stringify(saved.entries)); } catch {}
  }
}
function saveTeamDirectory() {
  if (!isAdmin()) { showToast('Not authorized'); return; }
  try { localStorage.setItem('ipb_team_directory', JSON.stringify(teamDirectory)); } catch {}
  saveSentinel('__CONFIG__', 'team-directory', { entries: teamDirectory })
    .then(r => showToast(r && r.status === 'ok'
      ? 'Team directory saved'
      : 'Saved locally (backend unreachable)'));
}
function openTeamDirectoryModal() {
  if (!isAdmin()) { showToast('Only admins can edit the team directory'); return; }
  if (document.getElementById('team-dir-modal')) return;
  const rows = teamDirectory.map((d, i) => `
    <div class="team-dir-row" data-i="${i}">
      <input class="form-input td-name" placeholder="Full name" value="${escHtml(d.name || '')}" />
      <input class="form-input td-email" placeholder="name@indrones.com" value="${escHtml(d.email || '')}" />
      <button type="button" class="team-dir-del" onclick="removeTeamDirRow(this)">&times;</button>
    </div>`).join('');
  const modal = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'team-dir-modal';
  modal.innerHTML = `
    <div class="inward-options-card">
      <div class="inward-options-head">
        <h3>Manage Team Directory</h3>
        <button type="button" class="inward-options-close" onclick="closeTeamDirectoryModal()">&times;</button>
      </div>
      <p class="inward-options-hint">People here appear in the @-mention suggestions across the app. Use @indrones.com emails.</p>
      <div class="inward-options-body"><div id="team-dir-rows">${rows}</div>
        <button type="button" class="btn-add-row" onclick="addTeamDirRow()">+ Add member</button>
      </div>
      <div class="inward-options-foot">
        <button type="button" class="btn" onclick="closeTeamDirectoryModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="applyTeamDirectory()">Save Directory</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}
function addTeamDirRow() {
  const wrap = document.getElementById('team-dir-rows');
  if (!wrap) return;
  const i = wrap.children.length;
  const div = document.createElement('div');
  div.className = 'team-dir-row';
  div.dataset.i = i;
  div.innerHTML = `<input class="form-input td-name" placeholder="Full name" />
      <input class="form-input td-email" placeholder="name@indrones.com" />
      <button type="button" class="team-dir-del" onclick="removeTeamDirRow(this)">&times;</button>`;
  wrap.appendChild(div);
}
function removeTeamDirRow(btn) {
  btn.closest('.team-dir-row')?.remove();
}
function closeTeamDirectoryModal() { document.getElementById('team-dir-modal')?.remove(); }

// ─── LOG LIMITS ───────────────────────────────────────────────────────────────
//
// The one place an Indrones flight-log number is ever typed. It writes to the
// PRIVATE store at `__CONFIG__/analyser`, never to a file — which is the whole
// reason it exists: dataflash.js is served from the public site, so a limit written
// there is a limit published, and these are operating data.
//
// One profile at a time, fields stacked. A grid of every model against every limit
// is the obvious design and the wrong one: it scrolls sideways on a phone, which is
// the one thing this app has been told not to do.
//
// VOLTAGE AND THE REST live at the bottom under "no rule yet". They are SAVED with
// everything else, so the numbers are not lost while the rule is being settled, but
// nothing scores on them — and the panel says so rather than letting a filled-in
// field imply a check that does not exist.
const ANALYSER_DEFERRED = [
  { group: 'Voltage — no rule yet, so recorded and NOT scored', key: 'voltCellReview', label: 'Per cell — watch below', unit: 'V' },
  { group: 'Voltage — no rule yet, so recorded and NOT scored', key: 'voltCellFail',   label: 'Per cell — fail below',  unit: 'V' },
  { group: 'Voltage — no rule yet, so recorded and NOT scored', key: 'voltHoldMs',    label: 'Only if held for',       unit: 'ms' },
];

let _alDraft = null;
let _alProfile = '';

function openAnalyserLimitsModal() {
  if (!isAdmin()) { showToast('Only an admin can change the flight-log limits'); return; }
  if (document.getElementById('analyser-limits-modal')) return;
  const DF = window.DataFlash;
  if (!DF || !Array.isArray(DF.TUNED)) {
    showToast('The flight-log reader did not load, so there is nothing to edit.');
    return;
  }
  // Edit a COPY. Cancel has to mean cancel, and a half-typed table must never
  // reach the scorer through a re-render.
  _alDraft = normaliseAnalyserConfig(analyserConfig);
  if (!_alDraft.models.length) _alDraft.models.push('S25');
  if (!_alDraft.profiles.__default__) _alDraft.profiles.__default__ = {};
  _alProfile = _alDraft.models[0];

  const modal = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'analyser-limits-modal';
  modal.innerHTML = `
    <div class="inward-options-card">
      <div class="inward-options-head">
        <h3>Log limits</h3>
        <button type="button" class="inward-options-close" onclick="closeAnalyserLimitsModal()">&times;</button>
      </div>
      <p class="inward-options-hint">The numbers a flight log is scored against, per airframe. They are stored privately and never appear in the app's published files.</p>
      <p class="inward-options-hint"><b>Default</b> applies to every airframe; a model's own chip overrides it, field by field. A field left <b>blank</b> means no number has been agreed yet — that area is shown on the report but left out of the score. It is never read as zero.</p>
      <div class="inward-options-body" id="al-body"></div>
      <div class="inward-options-foot">
        <button type="button" class="btn" onclick="closeAnalyserLimitsModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="saveAnalyserLimits()">Save limits</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  renderAnalyserLimitsBody();
}

function closeAnalyserLimitsModal() {
  document.getElementById('analyser-limits-modal')?.remove();
  _alDraft = null; _alProfile = '';
}

// Read whatever is in the form back into the draft. Called before ANY re-render,
// because switching profile is a re-render and an uncaptured edit would be lost.
//
// An EMPTY input is stored as NOTHING, not as zero. That is the rule the whole
// panel rests on: blank means "we have not agreed a number", and a zero written
// here would fail every aircraft on a limit nobody set.
function alCaptureFields() {
  if (!_alDraft) return;
  const prof = _alDraft.profiles[_alProfile] || (_alDraft.profiles[_alProfile] = {});
  document.querySelectorAll('#al-body .al-field input[data-key]').forEach(inp => {
    const k = inp.dataset.key;
    const raw = (inp.value || '').trim();
    if (raw === '') { delete prof[k]; return; }
    const n = Number(raw);
    if (isFinite(n)) prof[k] = n;
  });
}

function renderAnalyserLimitsBody() {
  const body = document.getElementById('al-body');
  if (!body || !_alDraft) return;
  const DF = window.DataFlash;
  const fields = DF.TUNED || [];
  const prof = _alDraft.profiles[_alProfile] || {};

  const chips = [{ name: '__default__', label: 'Default (all models)' }]
    .concat(_alDraft.models.map(m => ({ name: m, label: m })))
    .map(c => `<button type="button" class="al-chip${c.name === _alProfile ? ' is-on' : ''}" data-al-profile="${escHtml(c.name)}" onclick="alSetProfile(this)">${escHtml(c.label)}</button>`)
    .join('');

  // Grouped, in the order TUNED declares them, so the panel and the scorer cannot
  // disagree about which numbers exist.
  const groups = [];
  fields.concat(ANALYSER_DEFERRED).forEach(f => {
    let g = groups.find(x => x.name === f.group);
    if (!g) { g = { name: f.group, items: [] }; groups.push(g); }
    g.items.push(f);
  });

  // What this field will USE if it is left blank. Naming only the built-in number
  // was a small lie the moment the shared default existed: a model chip with an
  // empty current field read "no limit set" while the log would in fact be scored
  // against the shared 35 A — the blank field and the applied rule would disagree
  // on screen, which is exactly the confusion this panel exists to remove. So the
  // placeholder walks the same two layers the scorer does: this profile's own
  // shared default first, then the built-in public figure.
  const sharedProf = (_alProfile !== '__default__' && _alDraft.profiles.__default__) || null;
  const inherited = f => {
    // A `perAirframe` field describes one AIRCRAFT, not a limit everyone shares —
    // the pack's cell count is the case in point. There is deliberately nothing
    // above it to inherit from (the scorer refuses the shared default for these),
    // so offering "inherited: …" here would be a promise the reader does not keep,
    // and on the Default chip itself the honest answer is that it does not belong
    // there at all.
    if (f.perAirframe) {
      if (_alProfile === '__default__') return 'set this on each model';
      return f.none || 'not recorded';
    }
    if (sharedProf && typeof sharedProf[f.key] === 'number' && isFinite(sharedProf[f.key])) {
      return 'inherited: ' + sharedProf[f.key];
    }
    if (sharedProf && sharedProf[f.key] === null) return 'no limit set';
    return (f.pub != null) ? 'default ' + f.pub : 'no limit set';
  };

  const groupHTML = groups.map(g => `
    <div class="al-group">${escHtml(g.name)}</div>
    ${g.items.map(f => {
      const v = prof[f.key];
      const shown = (typeof v === 'number' && isFinite(v)) ? v : '';
      const ph = inherited(f);
      const min = (f.min != null) ? ` min="${f.min}"` : '';
      return `<div class="al-field">
        <label for="al-${escHtml(f.key)}">${escHtml(f.label)}</label>
        <input id="al-${escHtml(f.key)}" class="form-input al-field-in" type="number" step="any"${min}
               data-key="${escHtml(f.key)}" value="${shown}" placeholder="${escHtml(ph)}" />
        <span class="al-unit">${escHtml(f.unit || '')}</span>
      </div>`;
    }).join('')}`).join('');

  const removable = _alProfile !== '__default__';

  body.innerHTML = `
    <div class="al-chips">${chips}</div>
    <p class="log-note">Leave a field <b>empty</b> to mean "no limit agreed" — the log is shown and not failed on it. A field showing a grey <i>default</i> is ArduPilot's own published figure and applies while the field is empty.</p>
    <div class="log-actions">
      <input type="text" id="al-new-model" class="form-input" placeholder="New model name" style="width:11rem" />
      <button type="button" class="btn btn-ghost" onclick="alAddModel()">+ Add model</button>
      ${removable ? `<button type="button" class="btn btn-ghost" onclick="alRemoveModel()">Remove ${escHtml(_alProfile)}</button>` : ''}
    </div>
    ${groupHTML}
    <p class="al-pending"><b>The pack</b> is not a limit — nothing in it can fail a log. It is what lets the report turn a pack voltage into a <b>per-cell</b> one and mAh into a proportion of capacity, and it must be set on each <b>model</b>, not on Default: a cell count describes one aircraft, and a shared one would be used to read a different aircraft's battery wrongly.</p>
    <p class="al-pending">Voltage is still being settled, so those three fields are <b>recorded and not applied</b> — filling them in changes no score today. They are saved with the rest so the number is not lost while the rule is decided.</p>`;
}

// Switching profile. Deliberately an inline handler on the chip rather than a
// delegated listener on the modal: the body is replaced on every re-render, so a
// listener added here would be added again each time and fire once per past render.
function alSetProfile(btn) {
  if (!btn || !_alDraft) return;
  alCaptureFields();
  _alProfile = btn.dataset.alProfile;
  renderAnalyserLimitsBody();
}

function alAddModel() {
  const inp = document.getElementById('al-new-model');
  if (!inp || !_alDraft) return;
  const name = (inp.value || '').trim();
  if (!name) { showToast('Type a model name first'); return; }
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/.test(name)) {
    showToast('A model name can use letters, numbers, spaces, dots, dashes and underscores');
    return;
  }
  if (name === '__default__') { showToast('That name is reserved for the shared profile'); return; }
  alCaptureFields();
  if (_alDraft.models.indexOf(name) < 0) _alDraft.models.push(name);
  if (!_alDraft.profiles[name]) _alDraft.profiles[name] = {};
  _alProfile = name;
  renderAnalyserLimitsBody();
}

function alRemoveModel() {
  if (!_alDraft || _alProfile === '__default__') return;
  const name = _alProfile;
  // The limits go with it, so this is said out loud rather than done quietly —
  // a removed profile leaves every log for that model with NO limit, not with the
  // last number it had.
  if (!confirm('Remove ' + name + '? Its limits are deleted, and logs for it will have no limits until you set them again.')) return;
  delete _alDraft.profiles[name];
  _alDraft.models = _alDraft.models.filter(m => m !== name);
  _alProfile = _alDraft.models[0] || '__default__';
  renderAnalyserLimitsBody();
}

function saveAnalyserLimits() {
  if (!isAdmin()) { showToast('Only an admin can change the flight-log limits'); return; }
  if (!_alDraft) return;
  alCaptureFields();
  analyserConfig = normaliseAnalyserConfig(_alDraft);
  closeAnalyserLimitsModal();
  saveAnalyserConfig();
  renderLog();
}
function applyTeamDirectory() {
  const rows = document.querySelectorAll('#team-dir-rows .team-dir-row');
  const entries = [];
  rows.forEach(r => {
    const name  = r.querySelector('.td-name')?.value.trim() || '';
    const email = r.querySelector('.td-email')?.value.trim().toLowerCase() || '';
    if (name || email) entries.push({ name, email });
  });
  teamDirectory = entries.filter(e => e.email);
  closeTeamDirectoryModal();
  saveTeamDirectory();
}

// ── Nudge store ──
const NUDGE_IR  = '__NUDGES__';
const NUDGE_SEC = 'all';
let nudges = [];
let nudgePollTimer = null;
let nudgeModalCtx = null;       // { scope, irNumber, sectionId, fieldId, label }
let nudgeSelectedEmail = null;  // recipient chosen via autocomplete in the composer

function loadNudges() {
  fetch(`${CONFIG.GAS_URL}?action=getPassbook&irNumber=${NUDGE_IR}`)
    .then(r => r.json())
    .then(data => {
      // Only replace the local list on a successful read. On auth/error, keep
      // the existing (optimistic) comments so a transient backend failure or an
      // expired session doesn't wipe what the user just posted.
      if (data && data.status === 'ok') {
        const items = data?.sections?.[NUDGE_SEC]?.items;
        nudges = Array.isArray(items) ? items : [];
        refreshBell();
        refreshCommentCounts();
        if (document.getElementById('nudge-panel')?.style.display === 'block') renderNudgePanel();
        rerenderOpenNudgeModal();
        refreshActivityLog();
      }
    })
    .catch(() => { /* keep current list */ });
}
function startNudgePolling() {
  if (nudgePollTimer) clearInterval(nudgePollTimer);
  nudgePollTimer = setInterval(loadNudges, 90000);
}
function stopNudgePolling() { if (nudgePollTimer) { clearInterval(nudgePollTimer); nudgePollTimer = null; } }

function saveNudgesList(list) {
  const fd = new FormData();
  fd.append('action', 'saveSection');
  fd.append('irNumber', NUDGE_IR);
  fd.append('sectionId', NUDGE_SEC);
  fd.append('savedBy', currentUser?.email || 'unknown');
  fd.append('fields', JSON.stringify({ items: list }));
  fd.append('files', JSON.stringify([]));
  return fetch(CONFIG.GAS_URL, { method: 'POST', body: fd }).then(r => r.json());
}
// Append a nudge using a fresh fetch → append → save, to reduce lost writes when
// two people nudge at the same instant (last-write-wins is still possible).
async function addNudge(nudge) {
  try {
    const res  = await fetch(`${CONFIG.GAS_URL}?action=getPassbook&irNumber=${NUDGE_IR}`);
    const data = await res.json();
    const list = Array.isArray(data?.sections?.[NUDGE_SEC]?.items) ? data.sections[NUDGE_SEC].items : [];
    list.push(nudge);
    await saveNudgesList(list);
    nudges = list;
  } catch {
    // Backend unreachable — keep going locally so the UI still works.
    nudges.push(nudge);
  }
  refreshBell();
  refreshCommentCounts();
  rerenderOpenNudgeModal();
}
function markNudgeRead(id) {
  const me = (currentUser?.email || '').toLowerCase();
  const n = nudges.find(x => x.id === id);
  if (!n) return;
  n.readBy = Array.isArray(n.readBy) ? n.readBy : [];
  if (!n.readBy.map(s => String(s).toLowerCase()).includes(me)) n.readBy.push(me);
  saveNudgesList(nudges);
  refreshBell();
  refreshCommentCounts();
  if (document.getElementById('nudge-panel')?.style.display === 'block') renderNudgePanel();
  rerenderOpenNudgeModal();
}

// ── Comment editing ──
// A user can edit their own comments; an admin can edit anyone's. Editing is
// last-write-wins (same as posting): fetch the current list, update the one
// comment, save. Records editedAt/editedBy so the change is traceable.
let editingNudgeId = null;
function canEditNudge(n) {
  if (!n) return false;
  if (isAdmin()) return true;
  return (n.from || '').toLowerCase() === myEmail();
}
async function editNudge(id, newMessage) {
  const msg = (newMessage || '').trim();
  const n = nudges.find(x => x.id === id);
  if (!n) return;
  if (!msg) { showToast('Comment cannot be empty'); return; }
  n.message = msg;
  n.editedAt = Date.now();
  n.editedBy = currentUser?.email || 'unknown';
  editingNudgeId = null;
  try {
    const res  = await fetch(`${CONFIG.GAS_URL}?action=getPassbook&irNumber=${NUDGE_IR}`);
    const data = await res.json();
    const list = Array.isArray(data?.sections?.[NUDGE_SEC]?.items) ? data.sections[NUDGE_SEC].items : [];
    const idx = list.findIndex(x => x.id === id);
    if (idx >= 0) {
      list[idx] = Object.assign({}, list[idx], { message: msg, editedAt: n.editedAt, editedBy: n.editedBy });
      await saveNudgesList(list);
      nudges = list;
    } else {
      await saveNudgesList(nudges);
    }
  } catch {
    // Backend unreachable — keep the local edit.
  }
  refreshBell();
  refreshCommentCounts();
  rerenderOpenNudgeModal();
}
function startEditNudge(id) { editingNudgeId = id; renderNudgeThread(); }
function cancelEditNudge()  { editingNudgeId = null; renderNudgeThread(); }
// Toggle a comment between Open and Resolved (and back). Any signed-in
// collaborator can resolve/reopen — like a lightweight issue thread. Resolving
// records who + when so the history is traceable. Missing/legacy nudges (no
// status field) are treated as 'open'.
function toggleNudgeStatus(id) {
  const n = nudges.find(x => x.id === id);
  if (!n) return;
  if (n.status === 'resolved') {
    n.status = 'open';
    n.resolvedAt = null;
    n.resolvedBy = null;
  } else {
    n.status = 'resolved';
    n.resolvedAt = Date.now();
    n.resolvedBy = currentUser?.email || 'unknown';
  }
  saveNudgesList(nudges);
  refreshBell();
  refreshCommentCounts();
  rerenderOpenNudgeModal();
  if (document.getElementById('nudge-panel')?.style.display === 'block') renderNudgePanel();
}

// ── Helpers ──
function myEmail() { return (currentUser?.email || '').toLowerCase(); }
function isForMe(n) {
  const me = myEmail();
  if (!me) return false;
  if ((n.to || '').toLowerCase() === me) return true;
  return (n.mentions || []).some(m => String(m).toLowerCase() === me);
}
function unreadForMe() { return nudges.filter(n => isForMe(n) && !(n.readBy || []).map(s => String(s).toLowerCase()).includes(myEmail())); }
function relativeTime(ts) {
  const t = Number(ts); if (!t) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return toDisplayDate(new Date(t).toISOString());
}
function scopeContextText(n) {
  if (n.scope === 'field')  return `Field: ${n.fieldLabel || n.fieldId || ''}${n.sectionId ? ' · Section ' + n.sectionId : ''}`;
  if (n.scope === 'section') return `Section: ${n.sectionLabel || n.sectionId || ''}`;
  return 'IR-level';
}
function nudgeId() { return 'n_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36); }

// ── Bell ──
function refreshBell() {
  const badge = document.getElementById('nudge-badge');
  if (!badge) return;
  const c = unreadForMe().length;
  badge.textContent = c > 9 ? '9+' : String(c);
  badge.style.display = c > 0 ? 'flex' : 'none';
}

// ── Per-section / per-field comment badges ──
// Mirrors Google Workspace anchored comments: each section & field 💬 button
// shows a count of the comments sitting on it (red when one is unread & for me),
// so comments "reflect over that section" without opening the modal.
function commentsForCtx(scope, sectionId, fieldId) {
  const ir = currentIR?.irNumber || '';
  return nudges.filter(n => (n.irNumber || '') === ir && (n.scope || '') === scope &&
    (scope === 'field'  ? (n.fieldId  || '') === (fieldId  || '')
     : scope === 'section' ? (n.sectionId || '') === (sectionId || '')
     : true));
}
function readByMe(n) {
  const me = myEmail();
  return (n.readBy || []).map(s => String(s).toLowerCase()).includes(me);
}
function setCommentBadge(btn, count, unread) {
  if (!btn) return;
  const badge = btn.querySelector('.comment-count');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.display = 'inline-flex';
    badge.classList.toggle('unread', !!unread);
  } else {
    badge.style.display = 'none';
    badge.classList.remove('unread');
  }
}
function refreshCommentCounts() {
  if (!currentIR?.irNumber) return;
  // Badges count OPEN (unresolved) comments; the red dot only fires when one of
  // those open comments is still unread and directed at me. Resolved comments
  // no longer demand attention, so they don't keep a badge lit.
  const isOpen = n => (n.status || 'open') !== 'resolved';
  const hasAttention = list => list.filter(isOpen).some(n => isForMe(n) && !readByMe(n));
  document.querySelectorAll('.sec-nudge-btn').forEach(btn => {
    const list = commentsForCtx('section', btn.dataset.sectionId, null);
    setCommentBadge(btn, list.filter(isOpen).length, hasAttention(list));
  });
  document.querySelectorAll('.field-nudge-btn').forEach(btn => {
    const list = commentsForCtx('field', null, btn.dataset.fieldId);
    setCommentBadge(btn, list.filter(isOpen).length, hasAttention(list));
  });
  // IR-level hub button = open comments anywhere in this IR (ir + section + field)
  const irBtn = document.getElementById('ir-nudge-btn');
  if (irBtn) {
    const all = nudges.filter(n => (n.irNumber || '') === (currentIR.irNumber || ''));
    setCommentBadge(irBtn, all.filter(isOpen).length, hasAttention(all));
  }
}
function toggleNudgePanel() {
  let panel = document.getElementById('nudge-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'nudge-panel';
    panel.className = 'nudge-panel';
    document.body.appendChild(panel);
    document.addEventListener('click', e => {
      const bell = document.getElementById('nudge-bell');
      if (panel.style.display === 'block' && !panel.contains(e.target) && e.target !== bell && !bell?.contains(e.target)) panel.style.display = 'none';
    });
  }
  const open = panel.style.display === 'block';
  if (open) { panel.style.display = 'none'; return; }
  // mark my nudges as read on open
  let changed = false;
  nudges.forEach(n => { if (isForMe(n) && !(n.readBy || []).map(s => String(s).toLowerCase()).includes(myEmail())) { n.readBy = Array.isArray(n.readBy) ? n.readBy : []; n.readBy.push(myEmail()); changed = true; } });
  if (changed) saveNudgesList(nudges);
  renderNudgePanel();
  panel.style.display = 'block';
  refreshBell();
  refreshCommentCounts();
}
function renderNudgePanel() {
  const panel = document.getElementById('nudge-panel');
  if (!panel) return;
  const me = myEmail();
  const mine = nudges.filter(isForMe).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const dirBtn = isAdmin()
    ? `<button type="button" class="nudge-mini" title="Manage the @-mention directory" onclick="openTeamDirectoryModal()">⚙ Directory</button>`
    : '';
  if (!mine.length) {
    panel.innerHTML = `<div class="nudge-panel-head">
        <span>Notifications</span>
        <span style="display:flex; gap:6px; align-items:center;">${dirBtn}<button type="button" class="inward-options-close" onclick="toggleNudgePanel()">&times;</button></span>
      </div><div class="nudge-empty">No notifications yet.</div>`;
    return;
  }
  const items = mine.map(n => {
    const ir = allIRs.find(ir => ir.irNumber === n.irNumber);
    const canOpen = !!ir;
    const resolved = n.status === 'resolved';
    const statusChip = resolved
      ? `<span class="nudge-status resolved">✓ Resolved</span>`
      : `<span class="nudge-status open">● Open</span>`;
    const actionBtn = resolved
      ? `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escJsAttr(n.id)}')">↻ Reopen</button>`
      : `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escJsAttr(n.id)}')">✓ Resolve</button>`;
    return `<div class="nudge-item ${resolved ? 'resolved' : ''}">
      <div class="nudge-item-top">
        <span class="nudge-from">${escHtml(n.fromName || n.from || 'Someone')}</span>
        <span class="nudge-time">${escHtml(relativeTime(n.createdAt))}</span>
      </div>
      <div class="nudge-ctx">${iconSvg('bell')} ${escHtml(n.irNumber || '')} · ${escHtml(scopeContextText(n))}</div>
      <div class="nudge-msg">${escHtml(n.message || '')}</div>
      <div class="nudge-actions">
        ${statusChip}
        ${actionBtn}
        ${canOpen ? `<button type="button" class="nudge-mini" onclick="openIRFromNudge('${escJsAttr(n.irNumber)}')">Open IR</button>` : ''}
      </div>
    </div>`;
  }).join('');
  panel.innerHTML = `<div class="nudge-panel-head">
      <span>Notifications (${mine.length})</span>
      <span style="display:flex; gap:6px; align-items:center;">${dirBtn}<button type="button" class="inward-options-close" onclick="toggleNudgePanel()">&times;</button></span>
    </div><div class="nudge-list">${items}</div>`;
}
function openIRFromNudge(irNumber) {
  document.getElementById('nudge-panel').style.display = 'none';
  if (allIRs.find(ir => ir.irNumber === irNumber)) openPassbook(irNumber);
  else showToast('IR ' + irNumber + ' not in current list');
}

// ── Reusable Nudge modal (IR / section / field) ──
function openNudgeModal(scope, irNumber, sectionId, fieldId, label) {
  closeNudgeModal();
  nudgeModalCtx = { scope, irNumber, sectionId, fieldId, label: label || '' };
  nudgeSelectedEmail = null;
  const title = scope === 'field'  ? `Comments · ${label || fieldId}`
              : scope === 'section' ? `Comments · ${label || sectionId}`
              : `Comments · ${irNumber}`;
  const ctxLine = scope === 'field'  ? `IR ${irNumber} · Field “${label || fieldId}”`
                : scope === 'section' ? `IR ${irNumber} · Section ${label || sectionId}`
                : `All comments across IR ${irNumber} (IR-level + every section/field)`;
  const modal = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'nudge-modal';
  modal.innerHTML = `
    <div class="inward-options-card nudge-card">
      <div class="inward-options-head">
        <h3>${escHtml(title)}</h3>
        <button type="button" class="inward-options-close" onclick="closeNudgeModal()">&times;</button>
      </div>
      <div class="nudge-ctx-line">${escHtml(ctxLine)}</div>
      <div class="nudge-thread" id="nudge-thread"></div>
      <div class="nudge-composer">
        <label class="form-label">Tag someone (@)</label>
        <input type="text" id="nudge-recipient" class="form-input" placeholder="Type @ or a name / email…" autocomplete="off" oninput="onNudgeRecipientInput(this.value)" />
        <div class="nudge-suggest" id="nudge-suggest"></div>
        <label class="form-label" style="margin-top:0.6rem;">Message</label>
        <textarea id="nudge-message" class="form-input" rows="3" placeholder="What do you want to remind or assign?"></textarea>
        <div class="nudge-composer-actions">
          <button type="button" class="btn" onclick="sendComment()">${iconSvg('comment')} Comment</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  renderNudgeThread();
  // Keyboard navigation for the @-mention suggestion dropdown (↑/↓ + Enter + Esc).
  const recipientInput = document.getElementById('nudge-recipient');
  if (recipientInput) recipientInput.addEventListener('keydown', onNudgeRecipientKeydown);
  // Close on backdrop click
  modal.addEventListener('click', e => { if (e.target === modal) closeNudgeModal(); });
}
function closeNudgeModal() {
  document.getElementById('nudge-modal')?.remove();
  nudgeModalCtx = null;
  nudgeSelectedEmail = null;
}
function nudgeCtxMatch(n) {
  const c = nudgeModalCtx; if (!c) return false;
  if ((n.irNumber || '') !== (c.irNumber || '')) return false;
  if ((n.scope || '') !== (c.scope || '')) return false;
  if ((n.sectionId || '') !== (c.sectionId || '')) return false;
  if ((n.fieldId || '') !== (c.fieldId || '')) return false;
  return true;
}
function renderNudgeThread() {
  const el = document.getElementById('nudge-thread');
  if (!el) return;
  const ctx = nudgeModalCtx;
  // IR-level modal is the comment hub for the whole passbook: show EVERY comment
  // in this IR (ir + section + field scopes), each tagged with where it sits.
  // Section/field modals keep the exact-scope filter.
  const thread = (ctx && ctx.scope === 'ir')
    ? nudges.filter(n => (n.irNumber || '') === (ctx.irNumber || ''))
    : nudges.filter(nudgeCtxMatch);
  thread.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!thread.length) { el.innerHTML = '<div class="nudge-empty">No comments yet. Tag someone above to notify them about this.</div>'; return; }
  el.innerHTML = thread.map(n => {
    const mine = (n.from || '').toLowerCase() === myEmail();
    const resolved = n.status === 'resolved';
    const editing = editingNudgeId === n.id;
    const editable = canEditNudge(n);
    const loc = (ctx && ctx.scope === 'ir') ? `<div class="nudge-ctx">📍 ${escHtml(scopeContextText(n))}</div>` : '';
    const statusChip = resolved
      ? `<span class="nudge-status resolved" title="Resolved${n.resolvedBy ? ' by ' + n.resolvedBy : ''}${n.resolvedAt ? ' · ' + relativeTime(n.resolvedAt) : ''}">✓ Resolved</span>`
      : `<span class="nudge-status open">● Open</span>`;
    const actionBtn = resolved
      ? `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escJsAttr(n.id)}')">↻ Reopen</button>`
      : `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escJsAttr(n.id)}')">✓ Resolve</button>`;
    const editBtn = editable && !editing
      ? `<button type="button" class="nudge-mini" onclick="startEditNudge('${escJsAttr(n.id)}')" title="Edit comment">✏ Edit</button>`
      : '';
    const editedTag = n.editedAt
      ? `<span class="nudge-edited" title="Edited${n.editedBy ? ' by ' + n.editedBy : ''} · ${relativeTime(n.editedAt)}">(edited)</span>`
      : '';
    const msgOrEditor = editing
      ? `<div class="nudge-edit-wrap">
           <textarea class="nudge-edit-input" id="nudge-edit-${escHtml(n.id)}">${escHtml(n.message || '')}</textarea>
           <button type="button" class="nudge-mini primary" onclick="editNudge('${escJsAttr(n.id)}', document.getElementById('nudge-edit-${escJsAttr(n.id)}').value)">Save</button>
           <button type="button" class="nudge-mini" onclick="cancelEditNudge()">Cancel</button>
         </div>`
      : `<div class="nudge-msg">${escHtml(n.message || '')}${editedTag}</div>`;
    return `<div class="nudge-post ${mine ? 'mine' : ''} ${resolved ? 'resolved' : ''}">
      <div class="nudge-item-top">
        <span class="nudge-from">${escHtml(n.fromName || n.from || 'Someone')}</span>
        <span class="nudge-time">${escHtml(relativeTime(n.createdAt))}</span>
      </div>
      ${loc}
      <div class="nudge-to">→ ${escHtml(n.to || '')}</div>
      ${msgOrEditor}
      <div class="nudge-post-actions">${statusChip}${actionBtn}${editBtn}</div>
    </div>`;
  }).join('');
}
function rerenderOpenNudgeModal() {
  if (document.getElementById('nudge-modal')) renderNudgeThread();
}
function onNudgeRecipientInput(value) {
  nudgeSelectedEmail = null;
  nudgeSuggestIndex = -1;
  const suggest = document.getElementById('nudge-suggest');
  if (!suggest) return;
  const q = (value || '').replace(/^@/, '').trim().toLowerCase();
  if (!q) { suggest.innerHTML = ''; suggest.style.display = 'none'; return; }
  const matches = teamDirectory
    .filter(d => (d.name || '').toLowerCase().includes(q) || (d.email || '').toLowerCase().includes(q))
    .slice(0, 6);
  if (!matches.length) { suggest.innerHTML = '<div class="nudge-suggest-empty">No match — type a full email to tag anyway.</div>'; suggest.style.display = 'block'; return; }
  suggest.innerHTML = matches.map((d, i) =>
    `<button type="button" class="nudge-suggest-item" data-idx="${i}" data-email="${escJsAttr(d.email)}" data-name="${escJsAttr((d.name||'').replace(/"/g, '&quot;'))}" onclick="selectNudgeRecipient('${escJsAttr(d.email)}','${escJsAttr(d.name || '')}')">
      <span class="nudge-suggest-name">${escHtml(d.name || '')}</span>
      <span class="nudge-suggest-email">${escHtml(d.email || '')}</span>
    </button>`).join('');
  suggest.style.display = 'block';
}
// Keyboard navigation for the suggestion dropdown: ↑/↓ to move, Enter to
// select, Esc to close. Bound to the recipient input in openNudgeModal.
let nudgeSuggestIndex = -1;
function onNudgeRecipientKeydown(e) {
  const suggest = document.getElementById('nudge-suggest');
  if (!suggest || suggest.style.display !== 'block') return;
  const items = Array.from(suggest.querySelectorAll('.nudge-suggest-item'));
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    nudgeSuggestIndex = (nudgeSuggestIndex + 1) % items.length;
    highlightNudgeSuggest(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    nudgeSuggestIndex = (nudgeSuggestIndex - 1 + items.length) % items.length;
    highlightNudgeSuggest(items);
  } else if (e.key === 'Enter') {
    if (nudgeSuggestIndex >= 0 && items[nudgeSuggestIndex]) {
      e.preventDefault();
      const it = items[nudgeSuggestIndex];
      selectNudgeRecipient(it.dataset.email, it.dataset.name || '');
    }
  } else if (e.key === 'Escape') {
    suggest.innerHTML = ''; suggest.style.display = 'none';
    nudgeSuggestIndex = -1;
  }
}
function highlightNudgeSuggest(items) {
  items.forEach((it, i) => it.classList.toggle('nudge-suggest-active', i === nudgeSuggestIndex));
  const active = items[nudgeSuggestIndex];
  if (active) active.scrollIntoView({ block: 'nearest' });
}
function selectNudgeRecipient(email, name) {
  nudgeSelectedEmail = email;
  const inp = document.getElementById('nudge-recipient');
  if (inp) inp.value = `${name} <${email}>`;
  const suggest = document.getElementById('nudge-suggest');
  if (suggest) { suggest.innerHTML = ''; suggest.style.display = 'none'; }
  nudgeSuggestIndex = -1;
}
function resolveNudgeRecipient() {
  if (nudgeSelectedEmail) return nudgeSelectedEmail;
  const raw = (document.getElementById('nudge-recipient')?.value || '').trim();
  if (!raw) return '';
  const direct = teamDirectory.find(d =>
    d.email.toLowerCase() === raw.toLowerCase() ||
    `${d.name} <${d.email}>`.toLowerCase() === raw.toLowerCase());
  if (direct) return direct.email;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw;
  return '';
}
async function sendComment() {
  if (!nudgeModalCtx) return;
  const to = resolveNudgeRecipient();
  const message = (document.getElementById('nudge-message')?.value || '').trim();
  if (!to) { showToast('Pick or type a recipient first'); return; }
  if (!message) { showToast('Write a message first'); return; }
  const c = nudgeModalCtx;
  const nudge = {
    id: nudgeId(),
    irNumber: c.irNumber,
    scope: c.scope,
    sectionId: c.sectionId || null,
    fieldId: c.fieldId || null,
    sectionLabel: c.scope === 'section' ? c.label : null,
    fieldLabel: c.scope === 'field' ? c.label : null,
    to,
    from: currentUser?.email || 'unknown',
    fromName: currentUser?.name || currentUser?.email || 'Someone',
    message,
    mentions: [to],
    createdAt: Date.now(),
    readBy: [],
    status: 'open',          // 'open' | 'resolved' — any collaborator can resolve/reopen
    resolvedAt: null,
    resolvedBy: null,
  };
  await addNudge(nudge);
  // Fire the email notification in the background — it's a side-effect and
  // shouldn't make the user wait on the submit. Toasts its own outcome.
  sendNudgeEmailBackend(nudge);
  // clear composer
  nudgeSelectedEmail = null;
  nudgeSuggestIndex = -1;
  const r = document.getElementById('nudge-recipient'); if (r) r.value = '';
  const m = document.getElementById('nudge-message'); if (m) m.value = '';
  const suggest = document.getElementById('nudge-suggest'); if (suggest) { suggest.innerHTML = ''; suggest.style.display = 'none'; }
  renderNudgeThread();
}
// Send the comment email automatically via the Apps Script backend (MailApp).
// Google-Workspace style: the comment is already saved in-app (addNudge); this
// only relays the email notification. It NEVER opens a mail client — on failure
// it just toasts, so commenting is never blocked by an email popup. The email
// starts working automatically the moment the backend (sendNudgeEmail) is
// deployed + authorised.
async function sendNudgeEmailBackend(nudge) {
  try {
    const fd = new FormData();
    fd.append('action', 'sendNudgeEmail');
    fd.append('to',       nudge.to || '');
    fd.append('from',     nudge.from || '');
    fd.append('fromName', nudge.fromName || '');
    fd.append('irNumber', nudge.irNumber || '');
    fd.append('sectionId', nudge.sectionId || '');
    fd.append('context',  scopeContextText(nudge));
    fd.append('message',  nudge.message || '');
    const res  = await fetch(CONFIG.GAS_URL, { method: 'POST', body: fd });
    const data = await res.json();
    if (data.status === 'ok') { showToast('Comment posted · email sent to ' + nudge.to); return; }
    showToast('Comment saved · email pending: ' + (data.message || 'backend error'));
  } catch {
    showToast('Comment saved in app · email will send automatically once the backend is connected');
  }
}

// ── Trigger wrappers (resolve context from current state) ──
function openNudgeModalForIR() {
  if (!currentIR?.irNumber) { showToast('Open an IR first'); return; }
  openNudgeModal('ir', currentIR.irNumber, null, null, '');
}
function openNudgeModalForSection(sectionId) {
  if (!currentIR?.irNumber) return;
  const label = SECTIONS[sectionId]?.title?.replace(/^Section [A-Z] — /, '') || sectionId;
  openNudgeModal('section', currentIR.irNumber, sectionId, null, label);
}
function openNudgeModalForField(fieldId) {
  if (!currentIR?.irNumber) return;
  const sectionId = sectionIdFromFieldId(fieldId);
  const field = SECTIONS[sectionId]?.fields.find(f => f.id === fieldId);
  openNudgeModal('field', currentIR.irNumber, sectionId, fieldId, field?.label || fieldId);
}

// ─── ACTIVITY TIMELINE ───────────────────────────────────────────────────────
// ONE builder and ONE renderer, used twice: the Overview panel embeds the newest
// 40 entries, the 🕓 History modal shows the newest 400. Because both go through
// buildTimeline, an IR can never tell two different stories depending on where
// you look at it.
//
// Everything here is derived from something the app already records — nothing is
// synthesised:
//   section saves & field edits → AUDIT_LOG rows carrying a real section id
//   triage changes (status / assignee / priority / type) → AUDIT_LOG rows whose
//     column B is a `__` sentinel write; the real IR sits in the Section ID
//     column, which is why backend.gs getAuditLog matches both shapes
//   file uploads → the `uploaded` audit event added alongside this work
//   comments & @mentions → the __NUDGES__ store (which already carries its own
//     author and timestamp, better than an audit row would)
//
// The legacy hand-typed activity log is deliberately NOT folded in. It has no
// per-row timestamp, so merging it would mean inventing when things happened.
// The Overview shows it as its own labelled block instead.

// Deltas the timeline never shows. `done` is the section-completion array: every
// save rewrites it, and a 500-character JSON diff of it would drown the real
// edits. The completion itself is not lost — the save's own marker names the
// section. The backend skips it too; this is the belt to that pair of braces,
// because rows written before the backend changed are still in the log.
const SUPPRESSED_AUDIT_FIELDS = ['done'];

const AUDIT_MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

// 'dd-MMM-yyyy HH:mm:ss' → epoch ms.
// Date.parse() returns NaN for this shape in V8, and a NaN would not throw — it
// would silently sort the whole timeline by nothing. So the shape is parsed
// explicitly. Only ORDERING matters, and the backend stamps every row from one
// timezone, so the local-time construction below is sufficient.
function parseAuditTimestamp(v) {
  if (v == null || v === '') return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    const mon = AUDIT_MONTHS[m[2].toLowerCase()];
    if (mon !== undefined) {
      return new Date(+m[3], mon, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
  }
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : 0;
}

// The Overview fields the Triage panel hand-renders. They are real stored IR
// data — they live under the `sec-a` key like everything else the Overview writes —
// but they are NOT in SECTIONS, because that panel builds its own inputs rather
// than going through buildField. The lookup above therefore finds nothing for them,
// and without this table every reader of this helper shows the raw storage key:
// "a_crmOwner" on a history row is a leak of the schema into the UI.
const OVERVIEW_FIELD_LABELS = {
  a_crmOwner:      'Customer Relations Manager',
  a_contactPhone:  'Customer Phone',
  a_siteLocation:  'Site Location',
};

// Human name for a field id, from the forms. Falls back to the raw id for a field
// no current form declares — a retired one, or one that exists only in history.
function fieldLabelFor(fieldId) {
  if (!fieldId) return '';
  const secId = FIELD_SECTION_INDEX[fieldId];
  if (secId && SECTIONS[secId]) {
    const f = SECTIONS[secId].fields.find(x => x.id === fieldId);
    if (f && f.label) return f.label;
  }
  return OVERVIEW_FIELD_LABELS[fieldId] || fieldId;
}

// Which section a field id belongs to — the panel it is rendered in, which is also
// the section whose edit right gates the field's history and any restore of it.
// Prefers the real registry over the prefix, for the same reason FIELD_SECTION_INDEX
// exists: `g_missionReport` lives in sec-f and `i_courier` in sec-g, and their
// prefixes say otherwise. Returns '' for a field no form declares.
function fieldSectionFor(fieldId) {
  if (!fieldId) return '';
  if (FIELD_SECTION_INDEX[fieldId]) return FIELD_SECTION_INDEX[fieldId];
  // The Overview's hand-rendered fields are stored under OVERVIEW_KEY, and the
  // Overview's own gate is Triage — the same pairing the backend's canEdit() makes,
  // because getEffectiveAccess folds Triage into permissions[OVERVIEW_KEY]. Membership
  // of the label table IS the test, so a field added to that table needs no second
  // edit here — which is the whole reason the label table is what this reads.
  if (OVERVIEW_FIELD_LABELS[fieldId]) return OVERVIEW_KEY;
  return '';
}

// Sections that no longer exist. History predating the merge still names them, and
// relabelling that history with the surviving section would misattribute the work
// that was actually done under the old letter.
const HISTORICAL_SECTION_NAMES = {
  'sec-a': 'Overview (formerly Section A)',
  'sec-h': 'PDI (now part of G)',
  'sec-i': 'Dispatch (now part of G)',
};
function sectionDisplayName(sectionId) {
  if (!sectionId) return '';
  return SECTION_SHORT[sectionId] || HISTORICAL_SECTION_NAMES[sectionId] || sectionId;
}

// ─── ICON SET ────────────────────────────────────────────────────────────────
// The app's first and only SVG. Before this the whole UI was emoji, which render
// as a different picture on every OS and read as decoration rather than chrome.
//
// One family: a 24-unit grid, a single 1.75 stroke, round caps and joins, no fill
// — except the two deliberate dots, which fill with `currentColor`. Because the
// stroke is `currentColor` too, a glyph inherits the themed text colour it sits
// beside: no per-theme rule, no second asset, no sprite.
//
// INLINE, not file-based, and that is load-bearing. The app is an offline PWA and
// sw.js caches a fixed SHELL list, so a new .svg would need a SHELL entry AND a
// CACHE_NAME bump before an installed client could ever see it — and would still
// be blank on a first load with no network. Inline markup ships inside app.js and
// costs the cache nothing.
//
// DATA ONLY. `iconSvg` looks its argument up and never interpolates it, so a name
// that is not a key here can only ever render as '' — never as markup. That is
// what makes the unescaped ${iconSvg(...)} in renderTimelineInto safe.
const ICON_PATHS = {
  // timeline kinds
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.6l2.5 2.4 4.5-5"/>',
  plus:           '<path d="M12 5v14"/><path d="M5 12h14"/>',
  pencil:         '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 5.5l4 4"/>',
  minus:          '<path d="M5 12h14"/>',
  target:         '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  user:           '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  flag:           '<path d="M6 21V4"/><path d="M6 5h12l-2.5 4L18 13H6"/>',
  tag:            '<path d="M20 12.5L12.5 20a1.5 1.5 0 0 1-2.1 0L4 13.6V4h9.6l6.4 6.4a1.5 1.5 0 0 1 0 2.1z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  upload:         '<path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  // The Drive-archive move. A lid, a box, a handle — the conventional glyph, and
  // the only new one the archive feature adds. It is here because the two events it
  // serves are otherwise invisible: a ticket whose files silently left the working
  // folder is exactly the thing a reader needs told.
  archive:        '<rect x="3" y="4.5" width="18" height="4" rx="1"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5"/><path d="M10 12.5h4"/>',
  // Names are the FEATURE, not the picture: `comment` is what every call site asks
  // for, and smoke-ui.mjs cross-checks every referenced name against this map —
  // because a name that is not here renders '' and leaves a silent blank button.
  comment:        '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  dot:            '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  // chrome
  chevron:        '<path d="M9 5l7 7-7 7"/>',
  bell:           '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
  'panel-left':   '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  list:           '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
  ir:             '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5z"/><path d="M12 7v10" stroke-dasharray="2 2.5"/>',
  legacy:         '<path d="M3 9.5L12 4l9 5.5"/><path d="M5 10v9"/><path d="M9.5 10v9"/><path d="M14.5 10v9"/><path d="M19 10v9"/><path d="M3 19.5h18"/>',
  // Help. A question mark in a ring — the one glyph that reads as "an answer lives
  // here" with no label beside it, which is what a nav icon has to do.
  help:           '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.1-2.5 3.6"/><path d="M12 17.2h.01"/>',
  users:          '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><path d="M16.2 6.2a3.2 3.2 0 0 1 0 6.1"/><path d="M17.5 14.4A6 6 0 0 1 21 19.5"/>',
  moon:           '<path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8z"/>',
  // Password reveal. Two glyphs, not one: `eye` shows, `eye-off` hides, and the
  // slash is what tells a user the password is CURRENTLY visible — a single eye
  // that never changes leaves them unable to tell which state they are in.
  eye:            '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':      '<path d="M10.6 6.1A8.5 8.5 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.7"/><path d="M6.4 7.6A16.6 16.6 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 3.4-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3.5 3.5l17 17"/>',
  sun:            '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2"/><path d="M12 19.5v2"/><path d="M2.5 12h2"/><path d="M19.5 12h2"/><path d="M5.2 5.2l1.4 1.4"/><path d="M17.4 17.4l1.4 1.4"/><path d="M18.8 5.2l-1.4 1.4"/><path d="M6.6 17.4l-1.4 1.4"/>',
  clock:          '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  report:         '<path d="M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 16 20.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5z"/><path d="M9.5 3.5V2.5h5v1"/><path d="M9.5 9h5"/><path d="M9.5 13h5"/><path d="M9.5 17h3"/>',
  // The Insights dashboard's nav glyph. `report` was the obvious reuse and is
  // WRONG — it already means the client's Report tab — so the counts get their own
  // three columns, which is what the page is.
  chart:          '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.5" y="12" width="3" height="5"/><rect x="13" y="8" width="3" height="9"/><rect x="18" y="14" width="3" height="3"/>',
  // The Log Analyser's nav glyph. A telemetry trace, because that is what the
  // screen reads: a signal with a spike in it, which is the thing it is looking for.
  pulse:          '<path d="M3 12h3.5l2.5-6.5 3.5 13 2.5-6.5H21"/>',
};

// iconSvg(name, extraClass?) → inline SVG markup, or '' for a name that is not in
// the table. Never throws, never renders the literal string "undefined".
function iconSvg(name, extraClass) {
  const body = ICON_PATHS[name];
  if (!body) return '';
  return '<svg class="icon' + (extraClass ? ' ' + extraClass : '') + '"' +
    ' viewBox="0 0 24 24" aria-hidden="true" focusable="false"' +
    ' fill="none" stroke="currentColor" stroke-width="1.75"' +
    ' stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}

// Fills the STATIC chrome's glyphs from the one icon set. Called once from
// showApp(), never per IR: these elements live in index.html and are never
// re-created, so a second call would only rewrite identical markup.
//
// The elements keep their empty spans in index.html rather than literal <svg>
// there, so every glyph in the app has exactly one source — ICON_PATHS. The
// `!el.querySelector('svg')` guard makes a re-login (which re-runs showApp) a
// no-op instead of stacking a second icon into the same span.
function initIcons() {
  [
    ['#ir-activity-toggle .activity-caret',  'chevron'],
    ['#nudge-bell .nudge-bell-icon',         'bell'],
    ['#nav-tickets .nav-icon',               'ir'],
    ['#nav-insights .nav-icon',              'chart'],
    ['#nav-log .nav-icon',                   'pulse'],
    ['#nav-faq .nav-icon',                   'help'],
    ['#nav-access .nav-icon',                'users'],
    ['#sidebar-toggle .sidebar-toggle-icon', 'panel-left'],
    ['#list-toggle .list-toggle-icon',       'list'],
    // The same glyph the toolbar's own fold control wears, so the rail's button
    // reads as "that button, again" rather than as the sidebar's panel toggle.
    ['#list-rail-restore .list-rail-icon',   'list'],
    ['#detail-placeholder .ph-icon',         'ir'],
    ['#ir-triage-btn .btn-icon',             'target'],
    ['#ir-nudge-btn .btn-icon',              'comment'],
    ['#ir-history-btn .btn-icon',            'clock'],
    ['#ir-legacy-btn .btn-icon',             'legacy'],
    ['.tab-intake .tab-icon',                'report'],
  ].forEach(([sel, name]) => {
    const el = document.querySelector(sel);
    if (el && !el.querySelector('svg')) el.innerHTML = iconSvg(name);
  });

  // Nothing here owns the theme any more. The light/dark and accent controls are
  // text rows in the user menu (see buildAppearanceGroup), rebuilt with the menu
  // every time it opens, so there is no glyph to seed and no state to sync.
}

// One row per event the timeline can show. `icon` is a KEY into ICON_PATHS, not
// markup — this table stays data, so a suite can read, count and assert on it
// without parsing SVG.
//
// The labels deliberately reuse the Triage modal's own nouns ("Status", "Assigned
// to", "Priority", "Type") so the log and the modal that wrote the event speak one
// language, and `edit` uses the backend's own verb (`changed`) rather than
// inventing a second word for one event.
const TIMELINE_KINDS = {
  save:     { icon: 'check-circle', label: 'Section saved' },
  add:      { icon: 'plus',         label: 'Added' },
  edit:     { icon: 'pencil',       label: 'Changed' },
  remove:   { icon: 'minus',        label: 'Removed' },
  status:   { icon: 'target',       label: 'Status changed' },
  assign:   { icon: 'user',         label: 'Assigned to' },
  priority: { icon: 'flag',         label: 'Priority changed' },
  category:    { icon: 'tag',       label: 'Category changed' },
  subcategory: { icon: 'tag',       label: 'Sub-category changed' },
  subcatnote:  { icon: 'tag',       label: 'Repair note' },
  upload:   { icon: 'upload',       label: 'File uploaded' },
  comment:  { icon: 'comment',      label: 'Comment' },
  // An earlier value PUT BACK — the one event a reader must be able to pick out of
  // a busy list at a glance, because it is the only one that deliberately undoes
  // somebody else's work. It gets its own word rather than sharing `edit`: the
  // backend records it under its own event (`reverted`, never `restored` — see
  // restoreField), and sharing the glyph with the 🕓 History button ties the row to
  // the feature it came from.
  revert:   { icon: 'clock',        label: 'Put back' },
  // The Drive archive. Two labels on ONE glyph: both are the same event — the
  // ticket's folder moving between the working set and the archive — and a second
  // picture for the return trip would be two icons for one idea.
  archived: { icon: 'archive',      label: 'Folder archived' },
  restored: { icon: 'archive',      label: 'Folder restored' },
};

// PURE. No fetch, no DOM, no clock — so a suite can drive it with fixtures.
// Returns entries OLDEST FIRST, trimmed to the newest `limit` (0/absent = all).
// The renderer reverses for display; the builder needs ascending order to trim
// from the correct end.
function buildTimeline(irNumber, auditEntries, nudgeItems, limit) {
  const out = [];

  (Array.isArray(auditEntries) ? auditEntries : []).forEach(e => {
    if (!e) return;
    const fid = String(e.fieldId || '');
    if (SUPPRESSED_AUDIT_FIELDS.indexOf(fid) >= 0) return;
    const source = e.source === 'workflow' ? 'workflow' : 'section';
    const base = {
      at: parseAuditTimestamp(e.timestamp),
      timestamp: e.timestamp || '',
      by: e.savedBy || '',
      source,
      // A workflow row's Section ID column holds the IR, not a section, so it
      // must not be reported as one.
      sectionId: source === 'workflow' ? '' : (e.sectionId || ''),
      fieldId: source === 'workflow' ? '' : fid,
      oldValue: e.oldValue == null ? '' : String(e.oldValue),
      newValue: e.newValue == null ? '' : String(e.newValue),
      // Every entry carries the SAME shape whichever half it came from. A comment
      // row has no old/new value and an audit row has no mentions, and leaving
      // either out means the renderer — and any future consumer — reads `undefined`
      // off some rows and '' off others. That asymmetry is invisible until someone
      // renders it, and it renders as the literal string "undefined".
      message: '',
      mentions: [],
    };

    if (e.event === 'uploaded') { out.push(Object.assign({}, base, { kind: 'upload' })); return; }

    // The archive events, branched on the EVENT rather than on `fid` like the
    // workflow rows below. These carry no field — what changed is where a folder
    // lives, not a value in the form — so the `fid` chain would classify them as ''
    // and drop them, and a ticket whose files silently left the working folder is
    // exactly what a reader needs told.
    if (e.event === 'archived' || e.event === 'restored') {
      out.push(Object.assign({}, base, { kind: e.event }));
      return;
    }

    if (source === 'workflow') {
      // Sub-category and its note get their OWN kinds rather than folding into
      // `category`: a REPAIR whose component changes from GPS to BATTERY leaves
      // `category` untouched, so the audit emits only the sub-category row — and
      // labelling that row "Category changed: REPAIR → REPAIR" would be noise.
      const kind = fid === 'status' ? 'status'
                 : (fid === 'assignee' || fid === 'assigneeName') ? 'assign'
                 : fid === 'priority' ? 'priority'
                 : fid === 'category' ? 'category'
                 : fid === 'subCategory' ? 'subcategory'
                 : fid === 'subCategoryNote' ? 'subcatnote' : '';
      // Everything else a sentinel write carries — a whole-store `items` array, a
      // seed marker — is not a workflow change and must not clutter the timeline.
      // The retired `type` field lands here too: nothing displays it any more, so
      // an audit row about it would be a change the reader cannot see the effect of.
      if (!kind) return;
      out.push(Object.assign({}, base, { kind }));
      return;
    }

    if (e.event === 'saved') {
      // The batch marker for a save. A `saved` row that names a field carries no
      // more than the per-field rows below it, so only the bare one is shown.
      if (!fid) out.push(Object.assign({}, base, { kind: 'save' }));
      return;
    }

    // A row that records NOTHING is not history.
    //
    // Until the backend stopped writing them, a section's FIRST save recorded an
    // `added` row for every field the section declares — empty ones included —
    // because the client posts the whole field list and an absent stored key was
    // read as an addition. Every clock in that section then named the saver for a
    // change nobody made, which is the owner's report exactly: "in the fields I have
    // not done anything, when I check history it says my name and nothing is there
    // changed".
    //
    // The backend no longer WRITES those rows, and for the ones already on disk it
    // refuses them at read time. This is the same rule on the client, and it has to
    // be here as well because the audit payload is CACHED: an IR opened from a
    // cached fetch would otherwise keep showing the noise until the next one.
    //
    // Deliberately NARROW — `added`/`removed` on SECTION rows only, which is exactly
    // where this code sits: a workflow row pushes and returns above. A blanket
    // "both values are empty" rule would delete three things that are not noise:
    // the `saved` marker (already handled above), `uploaded`/`archived`/`restored`
    // (they carry no values by design — where a folder lives is the fact), and a
    // status going from unset to set, where '' → 'Open' is the whole change.
    if (e.event === 'added'   && base.newValue === '') return;
    if (e.event === 'removed' && base.oldValue === '') return;

    out.push(Object.assign({}, base, {
      kind: e.event === 'added' ? 'add'
          : e.event === 'removed' ? 'remove'
          // Its own kind, so a restore is visibly distinct from the edit it undid.
          // A reader scanning for "why is this the old value again?" is looking for
          // exactly one row, and folding it into `edit` hides it among the edits.
          : e.event === 'reverted' ? 'revert' : 'edit',
    }));
  });

  (Array.isArray(nudgeItems) ? nudgeItems : []).forEach(n => {
    if (!n) return;
    if (String(n.irNumber || '') !== String(irNumber || '')) return;
    out.push({
      at: Number(n.createdAt) || 0,
      timestamp: '',
      by: n.fromName || n.from || '',
      source: 'comment',
      sectionId: '',
      fieldId: n.fieldId || '',
      // Same shape as an audit entry — see the note on `base` above.
      oldValue: '',
      newValue: '',
      kind: 'comment',
      message: n.message || '',
      mentions: Array.isArray(n.mentions) ? n.mentions : [],
    });
  });

  out.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    // One save writes a whole batch at a single timestamp. Sections before
    // workflow, so the edit that caused a state change reads before the change.
    const rank = s => (s === 'section' ? 0 : s === 'workflow' ? 1 : 2);
    return rank(a.source) - rank(b.source);
  });

  const cap = Number(limit) > 0 ? Number(limit) : 0;
  return (cap && out.length > cap) ? out.slice(out.length - cap) : out;
}

// ─── PUT A VALUE BACK ─────────────────────────────────────────────────────────
// The field-history view's own state. Held HERE rather than in the DOM so a value of
// up to 500 characters never has to be escaped into an attribute: the restore button
// carries an INDEX into `timeline`, and the handler reads the row back out of it.
// Only the field-history view sets this; the ticket-level view and the Overview's
// inline timeline leave it null and render no restore control.
let fieldHistView = null;

// What the field history can offer for ONE timeline row. THREE answers, deliberately
// — "not a candidate" and "a candidate that cannot be put back" are different
// situations, and only one of them deserves a sentence:
//
//   null                not a candidate — render nothing at all
//   {ok:false, reason}  a candidate that cannot be put back — render the reason
//   {ok:true, value}    offer it, with this value
//
// PURE. No DOM, no fetch, no clock — a suite can drive it with fixtures.
//
// The IR header is out of scope BY CONSTRUCTION, not by an extra rule: a status,
// assignee, priority or category change arrives as its own kind ('status', 'assign',
// …), none of which is in the map below. They live in a different store under a
// different key shape and are governed by the separate Triage axis, so restoring one
// is a different decision — including what `statusOwned` would then mean — and it is
// deliberately not this one.
const RESTORABLE_KINDS = { edit: true, remove: true, revert: true };
function restoreOfferFor(item) {
  if (!item || !item.fieldId) return null;
  // `add` is the one value-bearing edit that offers nothing: its old value is ''
  // by construction (the backend writes `line('added', k, '', newJ)`), so "put back"
  // on it could only ever mean "clear this field" — a delete wearing a restore's
  // clothes, which is not what anyone opens a history to do.
  if (!RESTORABLE_KINDS[String(item.kind || '')]) return null;
  const old = item.oldValue == null ? '' : String(item.oldValue);
  // THE TRUNCATION RULE, enforced here AND in the backend (restoreField); both are
  // needed, and they are not redundant. `snapValue` caps every audited value at 500
  // characters plus a '…', irreversibly — the full value is kept nowhere else — so
  // writing that prefix back would corrupt the field silently, with nothing left to
  // compare against. It can only emit <=500 characters or exactly 501, so a length
  // above 500 PROVES truncation. THIS check is so the button is never offered; the
  // backend's is so a crafted request cannot write it.
  if (old.length > 500) {
    return { ok: false, reason: 'This value was too long to be recorded in full, so it can be viewed but not put back.' };
  }
  return { ok: true, value: old };
}

// The value the audit trail says this field holds NOW: the newest value-bearing row
// for it. The timeline is oldest-first, so the last match wins.
//
// This is what goes out as `expectCurrent`. The restore's guard is "has anything
// changed since the server told me what this field holds?", and the answer is taken
// from what the SERVER sent rather than from the input on screen — reading the DOM
// would be wrong twice over: the input may hold an unsaved edit, and it may not be on
// screen at all by the time the button is pressed (the modal is mounted on the body
// and outlives any tab switch).
//
// Both sides of that comparison pass through the same 500-character truncation, which
// is what makes it work on a long value: its audited form is truncated, so comparing
// against the untruncated stored value would never match on exactly the fields where
// a restore is most likely to be wanted.
const VALUE_BEARING_KINDS = { add: true, edit: true, remove: true, revert: true };
function fieldCurrentFrom(timeline, fieldId) {
  if (!fieldId) return '';
  let cur = '';
  (Array.isArray(timeline) ? timeline : []).forEach(it => {
    if (!it || String(it.fieldId || '') !== String(fieldId)) return;
    if (!VALUE_BEARING_KINDS[String(it.kind || '')]) return;
    cur = it.newValue == null ? '' : String(it.newValue);
  });
  return cur;
}

// The confirmation, then the write. Both halves live here so the button's handler is
// one line and the two cannot drift apart.
async function putFieldValueBack(i) {
  const v = fieldHistView;
  if (!v) return;
  const item = v.timeline[i];
  if (!item) return;
  const offer = restoreOfferFor(item);
  if (!offer || !offer.ok) return;

  // The gate, checked HERE, because this button is rendered inside a modal mounted on
  // `document.body` — outside every section pane, so applySectionAccessGating's
  // disable sweep never reaches it. A control mounted outside a pane CANNOT inherit
  // the pane's gate; that is exactly how the add-row and add-evidence buttons stayed
  // live on a view-only screen, and the symptom there was a button that hovered like
  // a live one and did nothing. The backend enforces the same rule with the same
  // predicate; this is so the button is never offered in the first place.
  if (!canEditSection(v.sectionId)) {
    showToast('You have view-only access to this section — you can read the history, but not put a value back.');
    return;
  }

  const shown = s => (s === '' ? '(empty)' : (s.length > 300 ? s.slice(0, 300) + '…' : s));
  const label = fieldLabelFor(v.fieldId);
  const ok = confirm(
    'Put an earlier value back into "' + label + '"?\n\n' +
    'Put back:  ' + shown(offer.value) + '\n' +
    'Replacing: ' + shown(fieldCurrentFrom(v.timeline, v.fieldId)) + '\n\n' +
    'Everything else on this IR stays exactly as it is. This is recorded in the IR’s own ' +
    'history and the admin is told.');
  if (!ok) return;
  await submitFieldRestore(offer.value);
}

async function submitFieldRestore(value) {
  const v = fieldHistView;
  if (!v) return;
  const fd = new FormData();
  fd.append('action', 'restoreField');
  fd.append('irNumber', v.irNumber);
  fd.append('sectionId', v.sectionId);
  fd.append('fieldId', v.fieldId);
  fd.append('value', value);
  // The newest value the audit trail reported for this field. The backend refuses the
  // write if the store no longer matches it — the guard against a change made between
  // opening the history and pressing the button, which is the one case where a blind
  // restore would discard somebody else's newer edit with nobody knowing.
  fd.append('expectCurrent', fieldCurrentFrom(v.timeline, v.fieldId));
  // Display names only. The backend has no form registry and cannot resolve a field
  // id to a label, so the two labels travel with the request for the admin notice.
  fd.append('labels', JSON.stringify({
    sectionLabel: sectionDisplayName(v.sectionId),
    fieldLabel: fieldLabelFor(v.fieldId),
  }));
  try {
    const res  = await fetch(CONFIG.GAS_URL, { method: 'POST', body: fd });
    const data = await res.json();
    if (data.status !== 'ok') { showToast(data.message || 'The value could not be put back.'); return; }
    showToast(data.message || 'The earlier value was put back.');
    // Re-read the ticket rather than patching the screen locally: the store is the
    // truth, and the audit has a new row on it that the history must show.
    await loadSectionData(v.irNumber);
    renderOverviewEditable();
    await loadActivityLog(v.irNumber);
    openHistoryModal({ fieldId: v.fieldId, sectionId: v.sectionId });
  } catch {
    // Deliberately NOT "nothing was changed": a request that reached the backend and
    // then lost its response looks identical from here to one that never left, and
    // claiming the first would be a lie about the one thing the user needs to know.
    showToast('Could not reach the backend. Reopen the history to see whether the value was put back.');
  }
}

// One renderer for both consumers. Markup is the existing `.hist-*` block, reused
// unchanged so the timeline inherits the modal's styling and the design system's
// tokens with no new colours.
function renderTimelineInto(el, timeline, opts) {
  if (!el) return;
  const o = opts || {};
  const list = Array.isArray(timeline) ? timeline : [];
  if (!list.length) {
    el.innerHTML = `<div class="hist-list"><div class="nudge-empty">` +
      escHtml(o.emptyText || 'No activity yet — save a section, triage the IR, upload a file or leave a comment, and it appears here.') +
      `</div></div>`;
    return;
  }
  const clip = s => String(s == null ? '' : s).slice(0, 200);
  // `i` is the index into the caller's OWN timeline — the array they passed, in its
  // original oldest-first order — and it is what the restore button carries back.
  // The render reverses for display; the handler must not, or it would read the
  // wrong row's value back out of `fieldHistView`.
  const rows = list.map((it, i) => ({ it, i })).reverse().map(({ it, i }) => {
    const meta = TIMELINE_KINDS[it.kind] || { icon: 'dot', label: it.kind || 'Activity' };
    // The restore control, and THREE answers rather than two — see restoreOfferFor.
    // It exists only when the caller supplied a restore context, which today means
    // only the field-history modal: the ticket-level view and the Overview's inline
    // timeline mix every field together and have no single field to put a value back
    // into, so they must render no button at all rather than a dead one.
    let restoreRow = '';
    if (o.restore) {
      const offer = restoreOfferFor(it);
      if (offer && offer.ok) {
        restoreRow = `<div class="hist-restore-row"><button type="button" class="hist-restore-btn" data-hist-i="${i}" title="Put this earlier value back">${iconSvg('clock')}Put back ${escHtml(clip(it.oldValue))}</button></div>`;
      } else if (offer) {
        restoreRow = `<div class="hist-restore-row"><span class="hist-restore-note">${escHtml(offer.reason)}</span></div>`;
      }
    }
    // A save row is a whole-section event and its label already says so, so the
    // `(whole section)` chip that used to sit here only repeated it. A field row
    // keeps its human label, resolved through the section index.
    const field = (it.kind !== 'save' && it.fieldId)
      ? `<span class="hist-field">${escHtml(fieldLabelFor(it.fieldId))}</span>` : '';
    // "workflow" is the backend's own name for the __IRS__ sentinel store. The
    // reader knows the action as Triage — the button, the modal and the toast all
    // say so — so the chip says it too.
    //
    // The archive events are written through that same store, so they arrive as
    // `source: 'workflow'` — but a folder move is not a triage edit, and chipping it
    // "Triage" would put a word on the row that no button in the app uses for it.
    const isArchiveEvent = it.kind === 'archived' || it.kind === 'restored';
    const srcChip = (it.source === 'workflow' && !isArchiveEvent)
      ? '<span class="hist-src">Triage</span>' : '';

    let body = '';
    if (it.kind === 'comment') {
      // The mention chip belongs in the chip row with the field and source chips,
      // not in a diff block of its own.
      const mention = (it.mentions && it.mentions.length)
        ? `<span class="hist-src">@mention</span>` : '';
      body = `<div class="nudge-msg">${escHtml(clip(it.message))}</div>`;
      if (mention) body += `<div class="hist-diff">${mention}</div>`;
    } else if (it.kind === 'edit' || it.kind === 'remove' || it.kind === 'revert') {
      // One body for all three, because they read the same way and mean the same
      // thing by it: `old` is what was there before this row's action and `new` is
      // what is there after. For a `revert` that is "the value it replaced" and "the
      // value put back", which is exactly the Was/Now a reader expects.
      body = `<div class="hist-diff"><span class="hist-old">Was</span> ${escHtml(clip(it.oldValue))}</div>` +
             `<div class="hist-diff"><span class="hist-new">Now</span> ${escHtml(clip(it.newValue))}</div>`;
    } else if (it.kind === 'add') {
      body = `<div class="hist-diff"><span class="hist-new">Now</span> ${escHtml(clip(it.newValue))}</div>`;
    } else if (it.newValue) {
      body = `<div class="hist-diff"><span class="hist-new">${escHtml(clip(it.newValue))}</span></div>`;
    }

    // ONE timestamp format for both halves of the list. Audit rows used to render
    // the backend's raw `dd-MMM-yyyy HH:mm:ss` while comment rows rendered
    // toDisplayDateTime's `DD Month YYYY, HH:MM` — two formats interleaved in one
    // newest-first list, which reads as two different feeds. `at` is already the
    // parsed instant for both halves, so format from it, and keep the raw string
    // only as the fallback for a row the parser could not read.
    const when = it.at ? toDisplayDateTime(new Date(it.at).toISOString()) : (it.timestamp || '');
    // A comment row's own label already says "Comment" and its field chip already
    // names the field, so a third "· comment" suffix said nothing. A section row
    // still names its section, and a triage row names itself.
    const where = it.source === 'comment'
      ? ''
      : (sectionDisplayName(it.sectionId) || (it.source === 'workflow' ? 'Triage' : ''));
    return `<div class="hist-item">
      <div class="hist-top"><span class="hist-ev">${iconSvg(meta.icon)}${escHtml(meta.label)}</span>${field}${srcChip}<span class="hist-time">${escHtml(when)}</span></div>
      <div class="hist-by">by ${escHtml(it.by || 'unknown')}${where ? ' · ' + escHtml(where) : ''}</div>
      ${body}
      ${restoreRow}
    </div>`;
  }).join('');
  el.innerHTML = `<div class="hist-list">${rows}</div>`;
  // Bound here rather than inlined into an `onclick`, because the payload is a field
  // value of up to 500 characters and it must reach `confirm()` intact. The button
  // carries an index into the timeline the caller handed us — see fieldHistView.
  if (o.restore) {
    el.querySelectorAll('.hist-restore-btn').forEach(b => {
      b.addEventListener('click', () => putFieldValueBack(Number(b.dataset.histI)));
    });
  }
}

// ─── AUDIT TRAIL / EDIT HISTORY ───────────────────────────────────────────────
// Shows the whole story for the open IR: every section save, field correction,
// upload, triage change and comment — newest first. Needs the redeployed backend
// (the `getAuditLog` action, whose match was widened to reach sentinel writes).
// `quiet` suppresses the toasts. The Overview calls it on every IR open, and
// an IR with no history on a backend that predates the widened getAuditLog
// match should render an empty state — not an error toast per open.
async function fetchAuditEntries(irNumber, limit, quiet, fieldId) {
  try {
    // A field-scoped read is filtered by the BACKEND, before its 400-line cap. A
    // filter applied here instead would answer with "this field's rows, minus the
    // older ones that fell outside the ticket's newest 400" — and the OLDEST rows are
    // precisely the ones a restore reaches for, so the one read that matters most
    // would be the one quietly short.
    const fieldQ = fieldId ? `&fieldId=${encodeURIComponent(fieldId)}` : '';
    const res  = await fetch(`${CONFIG.GAS_URL}?action=getAuditLog&irNumber=${encodeURIComponent(irNumber)}&limit=${limit}${fieldQ}`);
    const data = await res.json();
    if (data.status === 'ok') return Array.isArray(data.entries) ? data.entries : [];
    if (data.status === 'error' && !quiet) showToast('History: ' + (data.message || 'backend error'));
  } catch {
    if (!quiet) showToast('History unavailable — backend not connected yet');
  }
  return [];
}

// A field's own 🕓 button. One line, because the section is derived rather than
// passed: FIELD_SECTION_INDEX knows it for every field a form declares, and the
// Overview's two hand-rendered fields fall back to OVERVIEW_KEY — the same pairing
// the backend's canEdit() makes, since Triage folds into permissions['sec-a'].
function openFieldHistory(fieldId) {
  return openHistoryModal({ fieldId: fieldId, sectionId: fieldSectionFor(fieldId) });
}

// The History modal. `opts` is optional and carries exactly one thing: the field this
// history is about. With it the modal shows one field's changes and offers a restore;
// without it, the whole ticket's story and no restore.
//
//   openHistoryModal()                     the ticket  (the 🕓 History button)
//   openHistoryModal({fieldId, sectionId}) one field   (a field's own 🕓)
async function openHistoryModal(opts) {
  // Guarded deliberately: the ticket-level button is wired as
  // `addEventListener('click', openHistoryModal)`, so this receives a MouseEvent.
  // Reading `.fieldId` off an event is undefined — harmless today, and a landmine the
  // first time an event carries a property by that name.
  const o = (opts && typeof opts === 'object' && !opts.target) ? opts : {};
  const fieldId = String(o.fieldId || '');
  if (!currentIR?.irNumber) { showToast('Open an IR first'); return; }
  const irNumber = currentIR.irNumber;
  const sectionId = fieldId ? (o.sectionId || fieldSectionFor(fieldId)) : '';
  const entries = await fetchAuditEntries(irNumber, 400, false, fieldId);
  // Comments come along in both views — a comment on a field is part of that field's
  // story — but a field view takes only that field's, through the same helper the 💬
  // buttons already use.
  const comments = fieldId ? commentsForCtx('field', null, fieldId) : (Array.isArray(nudges) ? nudges : []);
  const timeline = buildTimeline(irNumber, entries, comments, 400);
  // The restore context, and the ONE thing that decides whether any restore control
  // is drawn. It is set only for a field view, so the ticket-level modal and the
  // Overview's inline timeline cannot sprout a button with no single field to write
  // into. See the note in renderTimelineInto.
  fieldHistView = fieldId ? { irNumber, sectionId, fieldId, timeline } : null;

  // One modal, ever. Without this, a second open — including the one this does after
  // a successful restore — stacks a second #history-modal on the body, and
  // closeHistoryModal's getElementById then removes the newer one and leaves the
  // older, stale one behind.
  closeHistoryModal();

  const heading = fieldId ? `History · ${fieldLabelFor(fieldId)}` : `History · ${irNumber}`;
  // Whether a restore is drawn at all, decided HERE rather than per row. A view-only
  // user gets the whole history and no button: offering one that refuses on click is
  // the "hovers like a live control and does nothing" failure this app has already
  // been bitten by twice. The blurb below says the same thing in words, so the absence
  // is explained rather than merely a gap.
  const mayRestore = fieldId ? canEditSection(sectionId) : false;
  const blurb = fieldId
    ? `Every recorded change to this field${sectionId ? ' in ' + escHtml(sectionDisplayName(sectionId)) : ''} and any comments on it, newest first.` +
      (mayRestore ? ' You can put an earlier value back.' : ' You have view-only access here, so you can read this but not change it.')
    : 'Everything that has happened to this IR — saves, field edits, uploads, triage changes and comments (newest first).';
  const modal = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'history-modal';
  modal.innerHTML = `
    <div class="inward-options-card nudge-card">
      <div class="inward-options-head">
        <h3>${escHtml(heading)}</h3>
        <button type="button" class="inward-options-close" onclick="closeHistoryModal()">&times;</button>
      </div>
      <div class="nudge-ctx-line">${blurb}</div>
      <div id="history-list"></div>
    </div>`;
  document.body.appendChild(modal);
  renderTimelineInto(document.getElementById('history-list'), timeline, {
    restore: mayRestore ? fieldHistView : null,
    emptyText: fieldId
      ? 'No changes recorded yet for this field.'
      : undefined,
  });
  modal.addEventListener('click', e => { if (e.target === modal) closeHistoryModal(); });
}
function closeHistoryModal() {
  document.querySelectorAll('#history-modal').forEach(m => m.remove());
  fieldHistView = null;
}

// ─── DEMO MODE DATA ──────────────────────────────────────────────────────────
// Shown before the GAS endpoint is connected, so the UI is visible immediately.
//
// The records carry NO `status`, exactly like the real ones that come back from
// `listIRs` — app-owned state is app-owned even when it is invented. `initialStatus`
// keeps the customer's own words, unfixed: 'In Production' and 'QC Investigation' are
// what the Sheet says, which is the point of the field.
//
// `customerName` IS A PERSON AND `companyName` IS A COMPANY, because that is what the two
// columns in the intake form actually hold — "Who's Reporting?" and "Where Do You Work?".
// The sample used to put a company name in `customerName` and carry no `companyName` at
// all, which taught the demo a shape the real data never has; see knownCompanies() for
// what that cost when it was read back.
function getDemoIRs() {
  return [
    { irNumber: 'IR409', droneId: 'S25P014',  dateRaised: '2025-10-01', summaryLink: 'https://docs.google.com/document/d/DEMO_SUMMARY_LINK', customerName: 'Sreenivas Pai', contactPhone: '7828148298', companyName: 'AgriKart Pvt Ltd', contactEmail: 'ops@agrikart.in',      issueType: 'Hardware Damage',   issueDesc: 'Drone arm cracked during landing', spoc: 'Monish Raza', initialStatus: 'In Production',    incidentDate: '2025-09-28' },
    { irNumber: 'IR408', droneId: 'S100-003', dateRaised: '2025-09-28', summaryLink: 'https://docs.google.com/document/d/DEMO_SUMMARY_LINK', customerName: 'Meera Iyer',     contactPhone: '9845012345', companyName: 'FarmVista Solutions', contactEmail: 'support@farmvista.com', issueType: 'Firmware Issue',    issueDesc: 'GPS lock failure mid-flight',      spoc: 'Ravi Singh',  initialStatus: 'QC Investigation', incidentDate: '2025-09-25' },
    { irNumber: 'IR407', droneId: 'S25P017',  dateRaised: '2025-09-20', summaryLink: 'https://docs.google.com/document/d/DEMO_SUMMARY_LINK', customerName: 'Arjun Deshpande', contactPhone: '9900112233', companyName: 'SkyHarvest Corp',     contactEmail: 'tech@skyharvest.in',   issueType: 'Battery Issue',     issueDesc: 'Battery swelling after 50 cycles', spoc: 'Adhik Nair',  initialStatus: 'Open',             incidentDate: '2025-09-18' },
    { irNumber: 'IR406', droneId: 'S25P010',  dateRaised: '2025-09-15', summaryLink: 'https://docs.google.com/document/d/DEMO_SUMMARY_LINK', customerName: 'Kavya Reddy',    contactPhone: '9765432100', companyName: 'GreenField Agri',     contactEmail: 'field@greenfield.co',  issueType: 'Operational Query', issueDesc: 'Propeller vibration at high RPM',   spoc: 'Monish Raza', initialStatus: 'Delivered',        incidentDate: '2025-09-12' },
    { irNumber: 'IR405', droneId: 'S25P040',  dateRaised: '2025-09-10', summaryLink: 'https://docs.google.com/document/d/DEMO_SUMMARY_LINK', customerName: 'Imran Sheikh',   contactPhone: '9123456780', companyName: 'DroneWorks India',    contactEmail: 'service@droneworks.in', issueType: 'RMA / Return',      issueDesc: 'Complete unit returned for RMA',   spoc: 'Ravi Singh',  initialStatus: 'Closed',           incidentDate: '2025-09-08' },
  ];
}

// The sample's stages, and they are exactly what the old fallback produced: the Sheet's
// word for each record, folded into the ten. No `updatedBy`, so `appState()` returns null
// and no assignee, priority or category is invented for a ticket nobody has worked —
// which is the same restraint the real records get.
function getDemoIRState() {
  return {
    IR409: { status: 'Production'    },
    IR408: { status: 'Investigation' },
    IR407: { status: 'Open'          },
    IR406: { status: 'Delivered'     },
    IR405: { status: 'Delivered'     },
  };
}
