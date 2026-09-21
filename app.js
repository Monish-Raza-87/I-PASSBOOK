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
const APP_VERSION = 'v45';

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

  // IR Repository spreadsheet — read directly by the frontend via Google's
  // public CSV endpoint (sheet is link-shared, so no login/Apps Script needed).
  // "Form Responses" tab (gid 335027370) holds the IR records (matched by header):
  //   Col A Summary · Col B IR Number · Col C Timestamp · Col D Issue Status ·
  //   Col F SPOC · Col G What Support Is Required? · Col H Please Describe… ·
  //   Col I Date of Incident · Col K Drone Serial No · Col L Who's Reporting? · Col P Email Address
  IR_REPO_SHEET_ID: '1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4',
  IR_REPO_GID:      '335027370',   // numeric gid — more reliable than the tab name
  IR_REPO_TAB:      'Form Responses',

  // Legacy I-PASSBOOK workbook (pre-app records, kept current until the app is
  // released and the user confirms go-live). Link-shared, so it embeds read-only
  // with NO Google sign-in / token / backend — shown via the 🏛 Legacy button on
  // the home screen. Each IR is its own tab in this workbook.
  LEGACY_SHEET_ID: '14VnWnCg-W7I8Vv97amhuwfSqiozictVMivO3F9Bed5s',
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
  if (!email || !password) return Promise.resolve({ status: 'error', message: 'Enter your email and password.' });
  const fd = new FormData();
  fd.append('action', 'login');
  fd.append('email', email);
  fd.append('password', password);
  if (code) fd.append('code', String(code).trim());
  // Sent on both steps; the backend only records it on the one that mints the
  // session. An older cached app.js sends nothing, and the audit line says
  // "device not reported" rather than failing.
  fd.append('device', deviceLabel());
  const doFetch = _origFetch(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.text().then(t => {
      // Apps Script returns JSON after a redirect; parse what came back.
      try { return JSON.parse(t); } catch { return { status: 'error', message: 'Bad response from server.' }; }
    }))
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

// POST helper for every self-authenticating auth call (the password lifecycle).
// Goes through _origFetch so it carries no session token and can never trip the
// session gate — a wrong reset code must not look like an expired session.
function postAuth(action, fields) {
  const fd = new FormData();
  fd.append('action', action);
  Object.keys(fields).forEach(k => fd.append(k, fields[k]));
  return _origFetch(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.text().then(t => {
      try { return JSON.parse(t); } catch { return { status: 'error', message: 'Bad response from server.' }; }
    }))
    .catch(err => ({ status: 'error', message: 'Network error: ' + (err && err.message ? err.message : 'unable to reach backend') }));
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
  return postAuth('googleExchange', { code, device: deviceLabel() });
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
const _handoff = (() => {
  const h = location.hash || '';
  let out = null;
  if (h.indexOf('#sso=') === 0) {
    out = { code: decodeURIComponent(h.slice(5)) };
  } else if (h.indexOf('#ssoerr=') === 0) {
    out = { error: decodeURIComponent(h.slice(8)) || 'Google sign-in failed.' };
  }
  if (!out) return null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* the code is spent anyway */ }
  return out;
})();

// True while a Google sign-in is arriving. Read by the splash so a return from the
// door does not sit through the nine-second intro BEFORE it signs in — the intro is
// the app's opening, and this is the middle of a sign-in that has already started.
function isHandoffReturn() { return !!_handoff; }


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
    const isAuthCall = /[?&]action=(login|changePassword|forgotPassword|resetPassword|logout|sessionCheck|ping|googleExchange)\b/.test(url);

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
let legacyMap   = {};          // irNumber -> { label, gid, embedUrl, openUrl } for legacy IRs (≤~IR441)

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
// Ownership of an IR's status begins the moment a human changes the STATUS in
// the app (statusOwned). Until then the Sheet's Col D is still what the list
// shows, so an edit made in the Sheet on an untriaged IR still works — it
// only stops mattering once somebody has taken the IR in hand here. Note
// that assigning or categorising does NOT take over the status.
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

// The status this app has actually taken ownership of, or '' while the Sheet is
// still the authority for the IR. Deliberately separate from appState():
// saving Section B is not triage, so an IR whose Section B was saved must go
// on following the Sheet's Col D until somebody changes the status here.
function ownedStatus(irNumber) {
  const s = irState[irNumber];
  return (s && s.statusOwned && s.status) ? s.status : '';
}

// Record that the app has seen this IR, without claiming ownership of its
// status yet. Written once per IR, on first open. Records `seededAt` rather
// than a `statusAt`, because we genuinely do not know when the Sheet's status
// was set and Stage 4's ageing must not be built on an invented timestamp.
function seedIRState(irNumber) {
  if (irState[irNumber]) return;
  irState[irNumber] = {
    status: '',
    seededAt: Date.now(),
    seededFrom: 'sheet',
    seededBy: myEmail() || 'unknown',
  };
  saveSentinel(IR_STATE_IR, irNumber, irState[irNumber]);
}

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
  if (currentView === 'detail' && currentIR) renderBannerMeta();
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
    if (owned) ir.status = owned;
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

// The 14 workflow statuses. These are written by the customer Google Form into
// the Sheet's Col D, so they are NEVER renamed here — Frappe's Open/Paused/
// Resolved/Closed vocabulary is a mapping over them (STATUS_CATEGORIES below).
// The status dropdown in the triage modal and the Section A form both read this
// one list.
const IR_STATUS_VALUES = ['Open','Hold','Close','Inward','Visual Inspection','QC Investigation','Production','QC','Flight Test','PDI','Approval','Delivered','Remote Support','Other'];

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
const indexView   = document.getElementById('index-view');
const detailView  = document.getElementById('detail-view');
const insightsView = document.getElementById('insights-view');
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
const bannerPills   = document.getElementById('ir-banner-pills');
const railToggle    = document.getElementById('sidebar-toggle');
const listToggle    = document.getElementById('list-toggle');

// ─── VIEW / ROUTER STATE ─────────────────────────────────────────────────────
// currentView is the single source of truth for which screen is showing.
// renderLayout() translates it into the inline display of the three panes.
let currentView = 'index';     // 'index' | 'detail' | 'insights'
let activeSegment = 'all';     // IR-list filter segment
let activeCategory = 'all';    // IR-list filter category (a SECOND, independent axis)
let _appBooted = false;        // showApp() guard — it re-binds listeners
let _irsReady = null;          // promise for the first IR-list load (deep links await it)
let _openSeq = 0;              // supersedes an in-flight openPassbook()
const mqDesktop = window.matchMedia('(min-width: 1024px)');

// ─── SPLASH → AUTH FLOW ──────────────────────────────────────────────────────
// The intro video plays every time this device arrives at the SIGN-IN screen. It
// is the app's opening, not a one-off: sign out and it plays again.
//
// The single exception is a device that is already signed in. Those people resume
// straight into the app, and nine seconds of video in front of a session that was
// going to resume anyway is a delay rather than a welcome. That case is decided
// before paint (index.html) and re-checked here via hasStoredSession(), so what
// the stylesheet hid and what this function does are the same decision.
//
// Note this is the BOOT path only — which is why signing out shows the intro
// again (signOut() reloads) but an in-app session EXPIRY does not (that path calls
// showAuth() in place, covering the screen would be actively worse, and the
// expiry toast is the thing the person needs to read).
//
// It is driven by the video's own `ended` event rather than a fixed wait, so
// re-exporting the intro at a different length needs no code change. The
// fallback timers below are backstops for the cases where `ended` never
// arrives — a decode failure, a browser that refuses to play, a 404 — because
// the user must reach sign-in no matter what the video does.
const INTRO_FALLBACK_MS = 9500;   // current video is 9.03s; a little margin over that
const SPLASH_FADE_MS    = 800;

window.addEventListener('load', () => {
  // Check for local file protocol (login + backend calls won't work)
  if (window.location.protocol === 'file:') {
    alert('⚠️ You are running this app directly from a local file. Login and the backend will NOT work unless you serve the app via a local server (http://localhost) or deploy it to GitHub Pages.');
  }

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
  if (isHandoffReturn()) { splash.style.display = 'none'; finishHandoff(_handoff); return; }

  const video = document.getElementById('splash-video');
  if (!video) { dismissSplash(false); return; }

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
  const finish = () => { clearTimeout(fallback); dismissSplash(false); };
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
// Four modes share one form: 'login' | 'otp' | 'forgot' | 'reset'. There is no
// sign-up mode — accounts are provisioned by the admin — so the things a person
// can do here are sign in, finish signing in with an emailed code, and recover a
// forgotten password via a different emailed code.
let _authFormWired = false;
let _authMode = 'login';     // 'login' | 'otp' | 'forgot' | 'reset'
let _resetEmail = '';
// Sign-in step 2 needs the credential from step 1, because the backend verifies
// the password again on the second call rather than trusting a half-open
// conversation. In memory only — same rule as _pcTemp, and for the same reason:
// a temporary credential must not outlive the screen that asked for it.
let _otpEmail = '';
let _otpPassword = null;

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
  refreshMyAccess().then(() => { if (typeof applySectionAccessGating === 'function') applySectionAccessGating(); });
}

function showAuth() {
  endSsoWait();
  authCont.style.display = 'flex';
  appCont.style.display  = 'none';
  const pc = document.getElementById('password-change');
  if (pc) pc.style.display = 'none';
  document.body.classList.remove('view-detail');
  _resetEmail = '';
  // The password from step 1 is held here for step 2 and dies with the screen —
  // the same rule as _pcTemp: in memory, and never written to storage.
  _otpEmail = '';
  _otpPassword = null;
  setAuthMode('login');
  const err = document.getElementById('auth-error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  ['auth-email', 'auth-password', 'auth-code', 'auth-new-password', 'auth-login-code'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  wireAuthForm();
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
  if (hint) hint.textContent = 'Taking you to Google — choose your indrones.com account.';
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

// Show/hide the pieces each mode needs. Everything lives inside #auth-form, so
// the browser's own Enter-to-submit keeps working in all four modes.
function setAuthMode(mode) {
  _authMode = mode;
  const set = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  set('auth-password',      mode === 'login');
  set('auth-signin-btn',    mode === 'login');
  set('auth-forgot-link',   mode === 'login');
  set('auth-login-code-wrap',      mode === 'otp');
  set('auth-forgot-wrap',   mode === 'forgot');
  set('auth-reset-wrap',    mode === 'reset');
  set('auth-back-link',     mode !== 'login');
  set('auth-email',         true);          // every mode needs the email
  // The Google door belongs to the FIRST step and nowhere else. Left visible on the
  // code step it would offer a second way in beside a form that is mid-way through
  // the first — and it is the one control on this screen that ignores everything
  // typed above it.
  //
  // Visibility is now just "is a second deployment configured". It used to depend on
  // a silent probe's answer, which had to go: the probe was a background call, and
  // Google refuses those to this deployment (see the GOOGLE SIGN-IN block). So a
  // machine with no Google session shows the button too, and clicking it lands on
  // Google's own page — which offers to sign in, and refuses a personal account with
  // a sentence Google writes, before our code is reached. An absent button would
  // have been tidier and less honest: it would tell a person the feature does not
  // exist when the truth is that they are not signed in.
  set('auth-google-btn',    mode === 'login' && !!CONFIG.SSO_URL);
  set('auth-or',            mode === 'login' && !!CONFIG.SSO_URL);
  // `required` follows visibility explicitly rather than relying on browsers
  // agreeing that a display:none control is barred from constraint validation —
  // a hidden required input that still validated would make the forgot and reset
  // steps unsubmittable.
  const passIn = document.getElementById('auth-password');
  if (passIn) passIn.required = (mode === 'login');
  const hint = document.getElementById('auth-hint-text');
  if (hint) {
    hint.textContent = mode === 'forgot'
      ? 'Enter your email and we’ll send you a reset code.'
      : mode === 'reset'
        ? 'Enter the code from your email and choose a new password.'
        : mode === 'otp'
          ? 'One more step. Enter the code we emailed you.'
          : 'Sign in with the credentials your admin gave you.';
  }
  const err = document.getElementById('auth-error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  if (mode === 'otp') {
    const first = document.getElementById('auth-login-code');
    // Focused on the next tick, not now: the wrap is only just display:'' and a
    // focus() on a node the browser has not laid out yet is silently dropped.
    if (first) setTimeout(() => first.focus(), 60);
  }
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
  const codeIn     = document.getElementById('auth-code');
  const newIn      = document.getElementById('auth-new-password');
  const otpIn      = document.getElementById('auth-login-code');
  const signInBtn  = document.getElementById('auth-signin-btn');
  const otpBtn     = document.getElementById('auth-login-code-btn');
  const forgotBtn  = document.getElementById('auth-forgot-btn');
  const resetBtn   = document.getElementById('auth-reset-btn');
  const resendLink = document.getElementById('auth-resend-link');
  // The same line the Google door writes to — one definition, so a refusal from
  // either door appears in one place and in one style.
  const showError  = setAuthError;
  const emailOf    = () => ((emailIn && emailIn.value) || '').trim().toLowerCase();

  const submitLogin = () => {
    const email = emailOf();
    const password = (passIn && passIn.value) || '';
    if (!email || !password) { showError('Enter your email and password.'); return; }
    signInBtn.disabled = true; signInBtn.textContent = 'Signing in…';
    showError('');
    currentUser = currentUser || {};
    currentUser.email = email;
    loginBackend(email, password).then(d => {
      signInBtn.disabled = false; signInBtn.textContent = 'Sign in';
      // A temporary password is correct but not yet a session — the change is the
      // only way forward, and the password just typed is the credential for it.
      if (d && d.mustChangePassword) { showPasswordChange(email, true, password); return; }
      // Stage 1 of two: the password is right and a code is on its way. Hold the
      // password for stage 2 and move the form on rather than reporting success —
      // there is no session yet, and pretending otherwise would sign nobody in.
      if (d && d.status === 'ok' && d.otpRequired) { gotoOtpStep(email, password, d); return; }
      if (d && d.status === 'ok' && d.sessionToken) finishAuth(email, d);
      else showError((d && d.message) || 'Sign in failed.');
    });
  };

  // Move to the code step, holding the credential from stage 1 in memory.
  const gotoOtpStep = (email, password, d) => {
    _otpEmail = email;
    _otpPassword = password;
    if (otpIn) otpIn.value = '';
    setAuthMode('otp');
    const note = document.getElementById('auth-login-code-note');
    if (note) {
      // codeSent:false means the backend REUSED the code it already emailed today,
      // so claiming to have just sent one would send the user looking for a mail
      // that is not there. Both branches name the address and state the lifetime as
      // a DURATION — never "end of the day", which is false for anyone whose first
      // sign-in was after lunch: the window is 8h30m from the SEND.
      note.textContent = (d && d.codeSent === false)
        ? 'A 6-digit code was sent to ' + email + ' earlier. It is valid for 8:30 hours from when it was sent.'
        : 'A 6-digit code is sent to ' + email + '. It is valid for 8:30 hours.';
    }
    // Deliberately NO toast here. There used to be one — "Use the code from
    // earlier today" — and it said the same thing the note above it already says,
    // in less detail, from the bottom of the screen where it covered the code box
    // and the Verify button. Reported from the field as the notice "hiding the
    // screen", appearing over and over, because every retry of a slow sign-in
    // raised it again. A message that duplicates the one already on screen and
    // covers the control the user is reaching for is a net loss; the note stays.
  };

  // Stage 2: the code from the email, with the password again.
  const submitOtp = () => {
    const code = ((otpIn && otpIn.value) || '').trim();
    if (!/^\d{6}$/.test(code)) { showError('Enter the 6-digit code from your email.'); return; }
    // The in-memory password is the only copy — a page reload between the two
    // steps leaves nothing to send, so say so plainly and restart the flow
    // instead of posting an empty password and reporting a bogus wrong password.
    if (!_otpPassword) { showError('Your sign-in timed out — please sign in again.'); setAuthMode('login'); return; }
    otpBtn.disabled = true; otpBtn.textContent = 'Verifying…';
    showError('');
    loginBackend(_otpEmail, _otpPassword, code).then(d => {
      otpBtn.disabled = false; otpBtn.textContent = 'Verify code';
      if (d && d.status === 'ok' && d.sessionToken) {
        _otpPassword = null;
        finishAuth(_otpEmail, d);
        return;
      }
      // The code is consumed by nothing, so a mistyped one can simply be retyped.
      // Do not clear the field: the user is comparing it with their email.
      showError((d && d.message) || 'Could not verify the code.');
    });
  };

  const submitForgot = () => {
    const email = emailOf();
    if (!email) { showError('Enter your email first.'); return; }
    forgotBtn.disabled = true; forgotBtn.textContent = 'Sending…';
    showError('');
    forgotPasswordBackend(email).then(d => {
      forgotBtn.disabled = false; forgotBtn.textContent = 'Email me a code';
      // The backend answers identically whether or not the account exists, so the
      // UI must not imply otherwise — always move on to the code step.
      _resetEmail = email;
      setAuthMode('reset');
      const note = document.getElementById('auth-reset-note');
      if (note) note.textContent = 'If ' + email + ' has an account, a 6-digit code is on its way.';
      showToast((d && d.message) || 'Check your inbox for the reset code');
    });
  };

  const submitReset = () => {
    const email = _resetEmail || emailOf();
    const code  = ((codeIn && codeIn.value) || '').trim();
    const pw    = (newIn && newIn.value) || '';
    if (!code) { showError('Enter the 6-digit code from your email.'); return; }
    if (pw.length < 8) { showError('New password must be at least 8 characters.'); return; }
    resetBtn.disabled = true; resetBtn.textContent = 'Setting…';
    showError('');
    resetPasswordBackend(email, code, pw).then(d => {
      resetBtn.disabled = false; resetBtn.textContent = 'Set new password';
      if (d && d.status === 'ok') {
        // No token is returned on purpose: signing in with the new password is
        // what proves it was typed the way the user meant.
        if (codeIn) codeIn.value = '';
        if (newIn) newIn.value = '';
        if (emailIn) emailIn.value = email;
        setAuthMode('login');
        showError('');
        showToast('Password set — sign in with your new password');
      } else {
        showError((d && d.message) || 'Could not reset the password.');
      }
    });
  };

  const resend = () => {
    if (!resendLink) return;
    resendLink.textContent = 'Sending…';
    resendLink.style.pointerEvents = 'none';
    forgotPasswordBackend(_resetEmail || emailOf()).then(d => {
      resendLink.textContent = 'Resend code';
      resendLink.style.pointerEvents = '';
      showToast((d && d.message) || 'If that account exists, a new code is on its way');
    });
  };

  if (signInBtn)  signInBtn.addEventListener('click', submitLogin);
  if (otpBtn)     otpBtn.addEventListener('click', submitOtp);
  if (forgotBtn)  forgotBtn.addEventListener('click', submitForgot);
  if (resetBtn)   resetBtn.addEventListener('click', submitReset);
  if (resendLink) resendLink.addEventListener('click', resend);
  const forgotLink = document.getElementById('auth-forgot-link');
  if (forgotLink) forgotLink.addEventListener('click', () => setAuthMode('forgot'));
  const backLink = document.getElementById('auth-back-link');
  if (backLink) backLink.addEventListener('click', () => setAuthMode('login'));
  const googleBtn = document.getElementById('auth-google-btn');
  if (googleBtn) googleBtn.addEventListener('click', submitGoogleSignIn);

  // Enter submits the CURRENT mode, not always login.
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    if (_authMode === 'forgot') submitForgot();
    else if (_authMode === 'reset') submitReset();
    else if (_authMode === 'otp') submitOtp();
    else submitLogin();
  });
}

// ─── THEME ───────────────────────────────────────────────────────────────────
// Preference is 'light' | 'dark' | 'system' under localStorage 'theme'.
// 'system' is the default and honours the OS setting live; the Appearance menu
// switches to an explicit light/dark. The <head> script applies the stored
// value before first paint so there is no flash.
const THEME_KEY = 'theme';

function storedTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}
function prefersDark() { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
function isDarkTheme() {
  const p = storedTheme();
  return p === 'dark' || (p !== 'light' && prefersDark());
}

const THEME_CHOICES = [
  { value: 'light',  label: 'Light' },
  { value: 'dark',   label: 'Dark' },
  { value: 'system', label: 'System' },
];

function setTheme(value) {
  try { localStorage.setItem(THEME_KEY, value); } catch { /* non-fatal */ }
  applyTheme(true);
  syncAppearanceMenu();
}

function applyTheme(animate) {
  const dark = isDarkTheme();
  const root = document.documentElement;
  if (animate) {
    // Suppress transitions for the two frames around the swap, otherwise every
    // surface cross-fades at once and the switch reads as a flash.
    root.classList.add('no-transition');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-transition')));
  }
  if (dark) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
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
const FALLBACK_PALETTE = 'blue';
const PALETTES = [
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
// The light/dark/palette controls live in the user menu (top right). They used to
// be a single nav button at the bottom of the sidebar, which meant scrolling a
// whole column to reach a control that belongs to the account, not to the IR list.
//
// Rendered as two labelled groups of rows, never icon-only: a swatch plus a word
// for each palette, and a word for each theme. Selection is carried by
// aria-checked and a tick, so it is legible without relying on colour alone.
function syncAppearanceMenu() {
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  const theme = storedTheme();
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
//   mobile            : list and detail are separate full screens
//
// The list fold is decided HERE rather than by a stylesheet rule, because an
// inline `display` beats any rule and this function is the one place allowed to
// write it. Folding the list must never strand the user on an empty index screen,
// which is why the fold only ever applies while a detail pane is open.
//
// `detailView.style.display` is only ever WRITTEN here, never read back. The
// sibling-pane arrangement is still required, for a different reason: tools/
// smoke-ui.mjs and tools/smoke-boot.mjs pin #ir-activity inside #detail-view, so
// that pane's display is a truthful "an IR is open" flag and nothing else may
// live in it.
function renderLayout() {
  const desktop  = mqDesktop.matches;
  const detail   = currentView === 'detail';
  const insights = currentView === 'insights';
  // On mobile the list and the detail are separate full screens, so an open
  // detail always hides the list. On desktop they sit side by side, so the list
  // hides only when the user asked for the room — and only while a detail is
  // actually open.
  const listHidden = detail && (!desktop || storedFlag(LIST_KEY));
  indexView.style.display  = listHidden ? 'none' : 'flex';
  detailView.style.display = detail ? 'flex' : 'none';
  // The Insights dashboard is a SIBLING pane, not a panel inside the detail one:
  // it keeps the IR list beside it on desktop (the mobile back button is
  // display:none there, so hiding the list would strand the user on a screen with
  // no way back to an IR).
  if (insightsView) insightsView.style.display = insights ? 'flex' : 'none';
  backBtn.style.display    = (!desktop && detail) ? 'block' : 'none';
  document.body.classList.toggle('view-detail', detail);
  // Suppresses #detail-placeholder's "No IR selected" empty state, which shows
  // whenever body.view-detail is absent — including on the dashboard, where an
  // "no IR selected" message is simply wrong.
  document.body.classList.toggle('view-insights', insights);

  // On desktop the list stays on screen, so mark which row is open.
  if (irList) {
    irList.querySelectorAll('.ir-card').forEach(card => {
      card.classList.toggle('is-selected', detail && card.dataset.id === currentIR?.irNumber);
    });
  }
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
//   #/legacy             → opens the read-only legacy workbook modal
// showIndex()/openPassbook()/showInsights() stay the view functions; the router
// only decides when to call them, so nothing here re-implements rendering.
function currentRoute() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'tickets' && parts[1]) return { name: 'ticket', irNumber: decodeURIComponent(parts[1]) };
  if (parts[0] === 'insights') return { name: 'insights' };
  if (parts[0] === 'legacy') return { name: 'legacy' };
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

async function handleRoute() {
  if (!currentUser) return;
  const r = currentRoute();

  if (r.name === 'legacy') {
    if (typeof openLegacyWorkbook === 'function') openLegacyWorkbook();
    goIndex();
    return;
  }

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

  // Set up user avatar
  userAvatar.textContent = currentUser?.initial || '?';
  if (currentUser?.picture) {
    userAvatar.style.backgroundImage = `url(${currentUser.picture})`;
    userAvatar.style.backgroundSize  = 'cover';
    userAvatar.textContent = '';
  }

  // User menu toggle
  userAvatar.addEventListener('click', toggleUserMenu);
  if (navAccess) navAccess.addEventListener('click', openAccessModal);
  if (railToggle) railToggle.addEventListener('click', toggleRail);
  if (listToggle) listToggle.addEventListener('click', toggleList);

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
const TRIAGE_SHORT = 'Triage (header, status & Overview)';

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
      </div>
      <div class="access-body" id="access-panels"><div class="access-loading">Loading…</div></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeAccessModal(); });
  modal.querySelectorAll('.access-tab').forEach(btn => {
    btn.addEventListener('click', () => { accessTab = btn.dataset.tab; renderAccessTabs(); });
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
  else                             renderPeopleTab();
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
    const pending = u.mustChangePassword ? '<span class="acc-badge acc-badge-temp">temp password</span>' : '';
    return `<tr data-email="${escHtml(u.email)}">
      <td class="acc-matrix-name">
        <div class="access-email-line">${escHtml(u.email)}</div>
        <div class="acc-matrix-sub">${escHtml(u.name || '')}${u.name ? ' · ' : ''}${escHtml(u.lastLoginAt || 'never signed in')} ${badge}${pending}</div>
        <div class="acc-matrix-actions">
          <button type="button" class="btn btn-sm btn-secondary acc-reset" data-email="${escHtml(u.email)}">Reset password</button>
          ${u.isAdmin ? '' : `<button type="button" class="btn btn-sm btn-secondary acc-toggle" data-email="${escHtml(u.email)}" data-status="${u.status === 'disabled' ? 'active' : 'disabled'}">${u.status === 'disabled' ? 'Enable' : 'Disable'}</button>`}
        </div>
      </td>
      ${depts.length ? cells : '<td class="acc-matrix-sub">Create a department first →</td>'}
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
    const adminBtn = document.getElementById('access-admin-btn');
    if (adminBtn) adminBtn.addEventListener('click', () => { menu.style.display = 'none'; openAccessModal(); });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== userAvatar) menu.style.display = 'none';
    });
  }
  return menu;
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
  headerTitle.textContent = 'I-PASSBOOK';
}

// ─── INSIGHTS ────────────────────────────────────────────────────────────────
// Counts over the IR list, sliced by the variables the desk actually asks about.
// Everything here is client-side over `allIRs` + `irState`, both of which are
// already fully in memory (one gviz CSV read, plus one `__IRS__` read), so this
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
  const rows = all.filter(ir => {
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
  });

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
        IR_CATEGORIES.map(k => insightsOpt(k, f.category)).join('') +
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

    <div class="insights-cards">
      ${IR_CATEGORIES.map(k => `
        <button type="button" class="insights-card${f.category === k ? ' active' : ''}" data-cat="${escHtml(k)}">
          <span class="insights-card-n">${sum.categories[k]}</span>
          <span class="insights-card-label">${escHtml(k)}</span>
        </button>`).join('')}
      ${sum.uncategorised ? `
        <button type="button" class="insights-card is-muted${f.category === UNCATEGORISED ? ' active' : ''}" data-cat="${escHtml(UNCATEGORISED)}">
          <span class="insights-card-n">${sum.uncategorised}</span>
          <span class="insights-card-label">No category</span>
        </button>` : ''}
    </div>

    ${sum.categories.REPAIR ? `
      <div class="insights-block">
        <h3 class="insights-h">REPAIR — by sub-category</h3>
        <div class="insights-subcats">
          ${REPAIR_SUBCATEGORIES.map(k => `
            <span class="insights-subcat${k === REPAIR_OTHERS ? ' is-others' : ''}">
              ${escHtml(k)}<span class="insights-subcat-n">${sum.subcategories[k]}</span>
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
      <h3 class="insights-h">Status mix</h3>
      <div class="insights-mix">
        ${SEGMENT_LABELS.filter(([k]) => k !== 'all').map(([k, label]) => `
          <span class="insights-mix-row">
            <span class="${CATEGORY_BADGE[k]}">${escHtml(label)}</span>
            <span class="insights-mix-n">${sum.statuses[k] || 0}</span>
          </span>`).join('')}
      </div>
    </div>`;
}

function showInsights() {
  currentView = 'insights';
  renderLayout();
  headerTitle.textContent = 'Insights';
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

// ─── IR REPOSITORY — DIRECT SHEET READ ───────────────────────────────────────
// Reads the "Form Responses" tab straight from Google Sheets as CSV. No Apps Script
// deploy required. Falls back to GAS / demo if the sheet is unreachable.

// Parse CSV text into rows[][] — handles quoted fields, embedded commas,
// doubled quotes, and newlines inside quoted fields.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

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
let lastSheetAudit = { headers: [], unmapped: [] };

// Rows (as parseCSV returns them) → IR records, latest first.
// Pure: no fetch and no DOM, so tools/smoke-intake.mjs can assert the whole
// mapping — including a reordered or extended header row — with neither.
function mapSheetRows(rows) {
  const headers = (rows && rows[0] ? rows[0] : []).map(h => String(h).trim());
  const { map, consumed, unmapped } = buildIntakeMap(headers);
  lastSheetAudit = { headers, unmapped };

  const idxOf = needle => headers.findIndex(h => h.includes(needle));
  const iIrNo = idxOf('IR Number');
  const iStat = idxOf('Issue Status');
  const iPrio = idxOf('Priority');
  const cell = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');

  const records = [];
  for (let r = 1; r < (rows ? rows.length : 0); r++) {
    const row = rows[r];
    if (!row) continue;
    const irNumber = cell(row, iIrNo);
    if (!irNumber) continue;

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
      status:        stat,
      summaryLink:   cell(row, map.summaryLink),
      customerName:  name,
      contactPhone:  phone,
      contactEmail:  cell(row, map.contactEmail),
      issueType:     cell(row, map.issueType),
      issueDesc:     cell(row, map.issueDesc),
      spoc:          cell(row, map.spoc),
      priority:      cell(row, iPrio),
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
  return records.reverse();   // latest first
}

async function fetchIRsFromSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.IR_REPO_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${CONFIG.IR_REPO_GID}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  const text = await res.text();
  return mapSheetRows(parseCSV(text));
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

  // 1. Primary: read the sheet directly (no backend deploy needed)
  try {
    const records = await fetchIRsFromSheet();
    if (records && records.length) {
      setAllIRs(records);
      writeIRListCache();
      _lastSyncAt = new Date();
      setSyncStatus(`✓ ${allIRs.length} IRs loaded from the Sheet`);
      renderIRList(allIRs);
      return;
    }
  } catch (e) { /* fall through to GAS backend */ }

  // 2. Fallback: Apps Script backend
  try {
    const url = `${CONFIG.GAS_URL}?action=listIRs`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res  = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status === 'ok') {
      setAllIRs(data.records || []);
      writeIRListCache();
      _lastSyncAt = new Date();
      setSyncStatus(`✓ ${allIRs.length} IRs loaded`);
      renderIRList(allIRs);
      return;
    }
    throw new Error(data.message || 'Unknown error');
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

function readIRListCache() {
  try {
    const raw = localStorage.getItem(IR_LIST_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.records) || !c.records.length) return null;
    return c.records;
  } catch { return null; }
}

function writeIRListCache() {
  try {
    localStorage.setItem(IR_LIST_CACHE_KEY, JSON.stringify({ at: Date.now(), records: allIRs }));
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
// Loads the index of legacy per-IR tabs (token-gated via the backend) so the
// master list can badge legacy IRs and the detail view can embed a read-only
// copy of the original sheet record. Best-effort: failures just skip legacy.
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
    irList.innerHTML = allIRs.length
      ? '<div class="empty-state"><span>🔍</span>No IRs match this filter.</div>'
      : '<div class="empty-state"><span>📭</span>No IRs found. Create one via the customer form.</div>';
    updateListCounts(0);
    return;
  }

  irList.innerHTML = records.map(ir => {
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
    return `
    <div class="ir-card animate-slide-up${currentView === 'detail' && currentIR?.irNumber === ir.irNumber ? ' is-selected' : ''}" data-id="${escJsAttr(ir.irNumber)}" onclick="goTicket('${escJsAttr(ir.irNumber)}')">
      ${owner ? `<span class="assignee-avatar" title="Assigned to ${escHtml(owner)}">${escHtml(initialsOf(owner))}</span>` : ''}
      <div class="ir-card-main">
        <div class="ir-title">${escHtml(ir.irNumber)}</div>
        <div class="ir-meta">
          <span class="ir-sn">${escHtml(ir.droneId || '')}</span>
          ${ir.category ? `<span class="ir-dot">·</span><span class="ir-cat">${escHtml(ir.category)}</span>` : ''}
          ${ir.subCategory ? `<span class="ir-dot">·</span><span class="ir-cat">${escHtml(ir.subCategory)}</span>` : ''}
          ${ir.dateRaised ? `<span class="ir-dot">·</span><span class="ir-date">${escHtml(ir.dateRaised)}</span>` : ''}
          ${age ? `<span class="ir-dot">·</span><span class="ir-age${late ? ' is-late' : ''}" title="${escHtml(ageTitle(ir, age))}">${escHtml(ageLabel(age))}</span>` : ''}
        </div>
      </div>
      <div class="ir-card-side">
        ${legacyMap[ir.irNumber] ? `<span class="badge badge-legacy" title="Recorded in the legacy I-PASSBOOK">Legacy</span>` : ''}
        ${ir.priority ? `<span class="prio prio-${escHtml(String(ir.priority).toLowerCase().replace(/[^a-z0-9_-]/g, ''))}">${escHtml(ir.priority)}</span>` : ''}
        <span class="${getBadgeClass(ir.status)}">${escHtml(ir.status || 'Open')}</span>
        ${late ? `<span class="badge badge-danger" title="${escHtml(overdueTitle(ir, late))}">Overdue</span>` : ''}
        ${showProg ? progressChip(prog) : ''}
        ${sumUrl ? `<a href="${escHtml(sumUrl)}" class="ir-summary-link" onclick="event.stopPropagation()" target="_blank" rel="noopener">View Summary ↗</a>` : ''}
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

// Initials for the assignee chip on a list card. Accepts a display name or an
// email and never throws on either.
function initialsOf(nameOrEmail) {
  const s = String(nameOrEmail || '').trim();
  if (!s) return '?';
  const base = s.includes('@') ? s.split('@')[0] : s;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function updateListCounts(shown) {
  if (navCountEl)  navCountEl.textContent = allIRs.length;
  if (listCountEl) {
    listCountEl.textContent = shown === allIRs.length
      ? `${allIRs.length} total`
      : `${shown} of ${allIRs.length}`;
  }
}

// ─── STATUS CATEGORIES ───────────────────────────────────────────────────────
// Frappe groups workflow statuses into three categories — Open (clock running),
// Paused (clock suspended), Resolved (clock stopped) — and colours the pill by
// category rather than by status. The 14 values in a_overallStatus are written
// by the customer Google Form and read by getAllIRStatuses(), so they are
// mapped here, never renamed.
//
// The old getBadgeClass() painted everything that was not Open/Hold as grey
// "closed", so Inward, Production, PDI and Flight Test all *looked* finished
// while they were still in the pipeline. This map fixes that.
const STATUS_CATEGORIES = {
  open:     ['Open', 'Inward', 'Visual Inspection', 'QC Investigation', 'Production',
             'QC', 'Flight Test', 'PDI', 'Approval', 'Remote Support'],
  paused:   ['Hold'],
  resolved: ['Delivered'],
  closed:   ['Close', 'Other'],
};

const CATEGORY_BADGE = {
  open:     'badge badge-open',
  paused:   'badge badge-pending',
  resolved: 'badge badge-resolved',
  closed:   'badge badge-closed',
};

function statusCategory(status) {
  const s = String(status || 'Open').trim().toLowerCase();
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

function irOverdueLimit(priority) {
  // Matched case-insensitively rather than by direct key lookup: a stored
  // 'high' would otherwise miss the map and silently take the loosest limit,
  // which is the one wrong answer that looks like it worked.
  const p = String(priority || '').trim().toLowerCase();
  for (const key of Object.keys(IR_OVERDUE_DAYS)) {
    if (key.toLowerCase() === p) return IR_OVERDUE_DAYS[key];
  }
  return IR_OVERDUE_DEFAULT_DAYS;
}

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
                : key;
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
  renderIRList(rows);
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
    if (owned) currentIR.status = owned;
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
    // First sight of this IR: record that the app has seen it. Deliberately
    // does NOT claim ownership of the status — see seedIRState.
    seedIRState(irNumber);
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
    const hasNewData = currentSectionData && Object.keys(currentSectionData).length > 0;
    if (!hasNewData) openLegacyModal(legacy.embedUrl, legacy.label, legacy.openUrl);
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
       <label class="overview-edit-label" for="a_crmOwner">Customer Relations Manager${hist('a_crmOwner')}</label>
       <input class="form-input" type="text" id="a_crmOwner" placeholder="Name of CRM person" value="${escHtml(val('a_crmOwner', currentIR?.spoc))}"${ro} />
     </div>
     <div class="overview-edit-row">
       <label class="overview-edit-label" for="a_contactPhone">Customer Phone${hist('a_contactPhone')}</label>
       <input class="form-input" type="tel" id="a_contactPhone" placeholder="+91 XXXXX XXXXX" value="${escHtml(val('a_contactPhone', currentIR?.contactPhone))}"${ro} />
     </div>` +
    (canWrite ? '' : `<p class="overview-note">Only Customer Relations and Management can edit these. Everyone can read them.</p>`);
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
  btn.title = canWrite ? '' : 'You need Triage access to edit the Overview';
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
  if (!canTriage()) { showToast('You need Triage access to edit the Overview'); return; }
  const btn = document.getElementById('save-overview');
  const label = btn ? btn.textContent : '';
  // Same double-post guard as saveSection, and for the same reason: the Overview
  // posts to the same backend action. Its key is OVERVIEW_KEY, so it never collides
  // with a section save that happens to be in flight.
  if (_savesInFlight.has(OVERVIEW_KEY)) return;
  _savesInFlight.add(OVERVIEW_KEY);
  if (btn) { btn.textContent = 'Saving…'; btn.className = 'btn saving'; btn.disabled = true; }

  const fields = {
    a_crmOwner:     document.getElementById('a_crmOwner')?.value || '',
    a_contactPhone: document.getElementById('a_contactPhone')?.value || '',
  };

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
    `<span class="${getBadgeClass(ir.status)}">${escHtml(ir.status || 'Open')}</span>` +
    (ir.priority ? `<span class="prio prio-${String(ir.priority).toLowerCase()}">${escHtml(ir.priority)}</span>` : '') +
    (ir.category ? `<span class="meta-pill">${escHtml(ir.category)}</span>` : '') +
    (ir.subCategory ? `<span class="meta-pill">${escHtml(ir.subCategory)}</span>` : '') +
    (age ? `<span class="meta-pill${late ? ' meta-late' : ''}" title="${escHtml(ageTitle(ir, age))}">${escHtml(ageLabel(age))}</span>` : '') +
    (late ? `<span class="badge badge-danger" title="${escHtml(overdueTitle(ir, late))}">Overdue</span>` : '') +
    (wantProgress(ir, prog) ? progressChip(prog) : '') +
    (owner
      ? `<span class="meta-pill meta-owner" title="Assigned to ${escHtml(ir.assignee || owner)}">👤 ${escHtml(owner)}</span>`
      : `<span class="meta-pill meta-unassigned">Unassigned</span>`);
  const triageBtn = document.getElementById('ir-triage-btn');
  if (triageBtn) triageBtn.style.display = showTriage ? '' : 'none';
}

// ─── TRIAGE MODAL (status / assignee / priority / category) ──────────────────
// Writes to `__IRS__` — the app's own record — and never touches the client's
// Sheet, which keeps the customer's original report intact. Reuses the
// full-screen modal pattern of the team-directory editor so it works at phone
// width without a new layout.
function openTriageModal() {
  if (!currentIR) return;
  if (!canTriage()) { showToast('You do not have Triage access — ask an admin to grant it'); return; }
  if (document.getElementById('triage-modal')) return;
  const ir     = currentIR;
  const owners = teamDirectory.slice().sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
  const cur    = String(ir.assignee || '').toLowerCase();
  const opt    = (v, sel) => `<option value="${escHtml(v)}"${v === sel ? ' selected' : ''}>${escHtml(v)}</option>`;
  const modal  = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'triage-modal';
  modal.innerHTML = `
    <div class="inward-options-card">
      <div class="inward-options-head">
        <h3>Triage ${escHtml(ir.irNumber)}</h3>
        <button type="button" class="inward-options-close" onclick="closeTriageModal()">&times;</button>
      </div>
      <p class="inward-options-hint">Recorded here in the passbook, not in the client's Google Sheet — the Sheet keeps the customer's original report untouched. Assigning someone sends them a notification.</p>
      <div class="inward-options-body triage-body">
        <label class="triage-row"><span>Status</span>
          <select class="form-input" id="triage-status">${IR_STATUS_VALUES.map(v => opt(v, ir.status || 'Open')).join('')}</select>
        </label>
        <label class="triage-row"><span>Assigned to</span>
          <select class="form-input" id="triage-assignee">
            <option value="">— Unassigned —</option>
            ${owners.map(d => `<option value="${escHtml(d.email)}"${String(d.email).toLowerCase() === cur ? ' selected' : ''}>${escHtml(d.name || d.email)}</option>`).join('')}
          </select>
        </label>
        <label class="triage-row"><span>Priority</span>
          <select class="form-input" id="triage-priority">
            <option value="">— None —</option>${TICKET_PRIORITIES.map(v => opt(v, ir.priority || '')).join('')}
          </select>
        </label>
        <label class="triage-row"><span>Category</span>
          <select class="form-input" id="triage-category">
            <option value="">— Choose —</option>${IR_CATEGORIES.map(v => opt(v, ir.category || '')).join('')}
          </select>
        </label>
        <!-- Sub-category exists ONLY under REPAIR. Both rows stay in the DOM and are
             shown/hidden, rather than being added and removed, so the two selects
             never lose the listener wired below by being replaced. -->
        <label class="triage-row" id="triage-subcat-row"${ir.category === 'REPAIR' ? '' : ' style="display:none"'}>
          <span>Sub-category</span>
          <select class="form-input" id="triage-subcategory">
            <option value="">— Choose —</option>${REPAIR_SUBCATEGORIES.map(v => opt(v, ir.subCategory || '')).join('')}
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
function closeTriageModal() { document.getElementById('triage-modal')?.remove(); }

async function applyTriage() {
  if (!currentIR) return;
  const irNumber = currentIR.irNumber;
  const status   = document.getElementById('triage-status')?.value     || '';
  const email    = document.getElementById('triage-assignee')?.value   || '';
  const priority = document.getElementById('triage-priority')?.value   || '';
  const category = document.getElementById('triage-category')?.value   || '';
  const prev     = String(currentIR.assignee || '').toLowerCase();
  const member   = teamDirectory.find(d => String(d.email).toLowerCase() === email.toLowerCase());

  // Category is MANDATORY. It is the one triage field the list filter and the
  // Insights page count by, so a triaged IR without one would be invisible to both
  // — an "uncategorised" hole no report could explain. The sub-category is required
  // too, but only where it exists (REPAIR); the note only under OTHERS.
  if (!category) {
    showToast('Choose a Category before saving Triage');
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
  if (status && status !== currentIR.status) {
    patch.statusAt = Date.now();
    patch.statusBy = myEmail() || 'unknown';
  }
  closeTriageModal();
  await patchIRState(irNumber, patch);
  showToast('Triage saved');
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

// ─── LEGACY RECORD: THE WAIT, MADE HONEST ────────────────────────────────────
// The app makes ZERO requests for this view — Google renders a ~450-tab workbook
// inside the iframe — so there is nothing here to await and nothing here to make
// faster. What there IS to fix is the silence: a blank frame with a permanent
// "Can't see it?" note underneath reads as hung and as broken at the same time, and
// a user cannot tell which. So: a spinner, the elapsed count so a long wait reads as
// long rather than stuck, and the fallback link withheld until the frame has really
// failed or a generous timeout has passed.
//
// The loaded frame is KEPT (detached, not discarded) once it has painted, so
// reopening the same archive reattaches it instead of paying the render again. And
// the frame no longer carries `loading="lazy"`: it is on screen the moment it is
// built, so asking the browser to decide whether it is *near* the viewport only
// adds a decision to the front of a twenty-second render.
const LEGACY_SLOW_MS = 20000;
let _legacyTimer = null;
let _legacyLoaded = { key: '', modal: null };

function legacyTick(modal, startedAt) {
  const out = modal.querySelector('.legacy-loading-elapsed');
  if (!out) return;
  const secs = Math.round((Date.now() - startedAt) / 1000);
  out.textContent = secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
}

// Open a full-screen, read-only embed of the IR's legacy I-PASSBOOK tab. The
// sheet itself is shown via Google's preview endpoint (no editing UI); a link
// to open it directly in Google Sheets is provided as a fallback.
function openLegacyModal(embedUrl, label, openUrl) {
  const key = embedUrl + '|' + String(label || '');
  if (_legacyTimer) { clearInterval(_legacyTimer); _legacyTimer = null; }

  // Reopening the same archive: the frame already painted once, so reattach it and
  // skip the loading state entirely. This is the difference between a two-second
  // reopen and a twenty-second one, and it costs nothing but not throwing the
  // element away.
  if (_legacyLoaded.modal && _legacyLoaded.key === key) {
    document.body.appendChild(_legacyLoaded.modal);
    return;
  }

  let modal = document.getElementById('legacy-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.className = 'inward-options-modal';   // reuse the full-screen overlay style
  modal.id = 'legacy-modal';
  modal.innerHTML = `
    <div class="legacy-card">
      <div class="legacy-head">
        <div>
          <div class="legacy-title">🏛 Legacy I-PASSBOOK</div>
          <div class="legacy-sub">${escHtml(label || '')} · read-only</div>
        </div>
        <button type="button" class="inward-options-close" onclick="closeLegacyModal()" title="Close">&times;</button>
      </div>
      <div class="legacy-frame-wrap">
        <iframe src="${embedUrl}" class="legacy-frame" title="Legacy record ${escHtml(label || '')}" referrerpolicy="no-referrer"></iframe>
        <div class="legacy-loading" id="legacy-loading" role="status" aria-live="polite">
          <span class="legacy-spinner" aria-hidden="true"></span>
          <span class="legacy-loading-title">Loading the archive…</span>
          <span class="legacy-loading-note">This is the old I-PASSBOOK workbook, and it is a big one. It can take a moment.</span>
          <span class="legacy-loading-elapsed">0s</span>
        </div>
        <div class="legacy-fallback" id="legacy-fallback" style="display:none">
          <span>Still not showing?</span>
          <a href="${openUrl}" target="_blank" rel="noopener" class="url-open-btn">Open in Google Sheets ↗</a>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeLegacyModal(); });

  const frame = modal.querySelector('.legacy-frame');
  const startedAt = Date.now();
  const done = () => {
    if (_legacyTimer) { clearInterval(_legacyTimer); _legacyTimer = null; }
    const load = modal.querySelector('.legacy-loading');
    if (load) load.remove();
    // The frame painted, so this view is worth keeping for a reopen — but only the
    // one that actually loaded.
    _legacyLoaded = { key, modal };
  };
  if (frame) frame.addEventListener('load', done, { once: true });

  // The clock, and the point at which the fallback stops being noise and becomes
  // advice. Both stop the moment the frame loads — `done` owns that.
  legacyTick(modal, startedAt);
  _legacyTimer = setInterval(() => {
    legacyTick(modal, startedAt);
    if (Date.now() - startedAt < LEGACY_SLOW_MS) return;
    if (_legacyTimer) { clearInterval(_legacyTimer); _legacyTimer = null; }
    const fb = modal.querySelector('.legacy-fallback');
    if (fb) fb.style.display = 'flex';
  }, 1000);
}

function closeLegacyModal() {
  if (_legacyTimer) { clearInterval(_legacyTimer); _legacyTimer = null; }
  const m = document.getElementById('legacy-modal');
  // Detached, NOT discarded — `_legacyLoaded` keeps it so a reopen is instant. The
  // reference is dropped the moment a different archive is opened.
  if (m) m.remove();
}

// Open the entire legacy I-PASSBOOK workbook (IR1–IR441) read-only, embedded
// with tab switching — via Google's preview endpoint. The workbook is
// link-shared, so this needs NO Google sign-in, NO token, NO backend call and
// therefore NO sign-in pop-ups. A fallback link opens it directly in Sheets.
function openLegacyWorkbook() {
  const id = CONFIG.LEGACY_SHEET_ID;
  const embedUrl = `https://docs.google.com/spreadsheets/d/${id}/preview?rm=minimal`;
  const openUrl  = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  openLegacyModal(embedUrl, 'All pre-app records · switch tabs at the bottom', openUrl);
}

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
  const l = legacyMap[currentIR?.irNumber];
  if (l) openLegacyModal(l.embedUrl, l.label, l.openUrl);
});
// Home-screen "Legacy I-PASSBOOK" button — opens the whole old workbook read-only
const legacyWorkbookBtn = document.getElementById('legacy-workbook-btn');
if (legacyWorkbookBtn) legacyWorkbookBtn.addEventListener('click', openLegacyWorkbook);

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
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.section).classList.add('active');
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

  // Wire save buttons
  Object.keys(SECTIONS).forEach(secId => {
    const btn = document.getElementById('save-' + secId);
    if (btn) btn.onclick = () => saveSection(secId, irNumber);
  });

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

    // Save buttons (top + bottom) + D PDF download
    ['save-' + secId, 'save-' + secId + '-top'].forEach(bid => {
      const b = document.getElementById(bid);
      if (!b) return;
      b.disabled = !edit;
      b.style.opacity = edit ? '' : '0.5';
      b.style.cursor = edit ? '' : 'not-allowed';
      b.title = edit ? '' : 'You have view-only access to this section';
    });

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
  // commentable for this user (skipped for read-only analysis notes too).
  const canFieldComment = sectionId ? canCommentSection(sectionId) : true;
  const fieldNudgeBtn = (field.type && field.type !== 'analysisNote' && canFieldComment && !locked)
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
  const fieldHistBtn = (field.type && field.type !== 'analysisNote' && !locked)
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

// Collect all field values for a section from the DOM + evidenceState.
// Shared by saveSection and the draft auto-persist. Returns { fieldValues, fileFields }.
function collectSectionValues(sectionId) {
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
    'when you open this IR again. But it is not recorded until you press Save.\n\n' +
    'Leave anyway?'
  );
}

// Sections with a save in flight. A Set rather than a boolean so two sections can
// be saved at once — the guard is per-section, which is the unit the backend writes
// and the unit the button belongs to.
const _savesInFlight = new Set();

async function saveSection(sectionId, irNumber) {
  const btn = document.getElementById('save-' + sectionId);
  const btnTop = document.getElementById('save-' + sectionId + '-top');
  const section = SECTIONS[sectionId];
  if (!section) return;

  // A second click while the first request is in flight would post the same section
  // twice: two writes, two audit batches, and the second one's diff computed against
  // whatever the first had already stored. The buttons go DEAD for the duration, and
  // this guard closes the other half — the Save button inside a modal, and a
  // keyboard submit, both reach here without touching those two elements.
  if (_savesInFlight.has(sectionId)) return;
  _savesInFlight.add(sectionId);

  const btnLabel = `Save Section ${sectionId.replace('sec-', '').toUpperCase()}`;
  btn.textContent = 'Saving…';
  btn.className = 'btn saving';
  btn.disabled = true;
  if (btnTop) { btnTop.textContent = 'Saving…'; btnTop.className = 'btn saving'; btnTop.disabled = true; }

  // Collect field values
  const formData = new FormData();
  formData.append('action', 'saveSection');
  formData.append('irNumber', irNumber);
  formData.append('sectionId', sectionId);
  formData.append('savedBy', currentUser?.email || 'unknown');

  const { fieldValues, fileFields } = collectSectionValues(sectionId);
  formData.append('fields', JSON.stringify(fieldValues));

  // Convert files to base64
  const filePayload = [];
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

  formData.append('files', JSON.stringify(filePayload));

  try {
    const res  = await fetch(CONFIG.GAS_URL, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.status === 'ok') {
      btn.textContent = '✓ Saved!';
      btn.className = 'btn saved';
      if (btnTop) { btnTop.textContent = '✓ Saved!'; btnTop.className = 'btn saved'; }
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
      // Record this save in the app-owned workflow state — every section save
      // marks that section done for this IR, and the save is now on the timeline.
      syncIRStateAfterSectionSave(sectionId, irNumber, fieldValues);
      loadActivityLog(irNumber);
    } else {
      throw new Error(data.message || 'Backend error');
    }
  } catch (err) {
    btn.textContent = '⚠ Retry Save';
    btn.className = 'btn error';
    if (btnTop) { btnTop.textContent = '⚠ Retry Save'; btnTop.className = 'btn error'; }
    showToast('❌ Save failed: ' + err.message + ' — your entries are kept as a draft.');
  }

  setTimeout(() => {
    _savesInFlight.delete(sectionId);
    btn.textContent = btnLabel;
    btn.className = 'btn';
    // Re-enabled through the ACCESS sweep, never with a bare `disabled = false`.
    // A blind re-enable would hand Save back to a view-only user whose access
    // payload arrived while this request was in flight — which is precisely the
    // silent failure applySectionAccessGating exists to prevent, and it is the
    // reason smoke-access.mjs asserts that every write control agrees with Save.
    if (typeof applySectionAccessGating === 'function') applySectionAccessGating();
    else { btn.disabled = false; if (btnTop) btnTop.disabled = false; }
  }, 3000);
}

// A section save is the one place that knows an IR was actually touched, so it
// is where the app takes ownership of that IR's workflow state.
function syncIRStateAfterSectionSave(sectionId, irNumber, fieldValues) {
  // Status is no longer mirrored from a section form. The IR Status dropdown lived
  // in Section A, which is gone; status is now written only by the Triage modal
  // (see applyTriage), which owns `status`/`statusOwned`/`statusAt` itself. A
  // section save that happens to post a status key must not be able to move the
  // workflow clock.
  patchIRState(irNumber, { done: markSectionDone(irNumber, sectionId) });
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

// The two Overview fields the Triage panel hand-renders. They are real stored IR
// data — they live under the `sec-a` key like everything else the Overview writes —
// but they are NOT in SECTIONS, because that panel builds its own two inputs rather
// than going through buildField. The lookup above therefore finds nothing for them,
// and without this table every reader of this helper shows the raw storage key:
// "a_crmOwner" on a history row is a leak of the schema into the UI.
const OVERVIEW_FIELD_LABELS = {
  a_crmOwner:     'Customer Relations Manager',
  a_contactPhone: 'Customer Phone',
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
  // The Overview's two hand-rendered fields are stored under OVERVIEW_KEY, and the
  // Overview's own gate is Triage — the same pairing the backend's canEdit() makes,
  // because getEffectiveAccess folds Triage into permissions[OVERVIEW_KEY].
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
    ['#legacy-workbook-btn .nav-icon',       'legacy'],
    ['#nav-access .nav-icon',                'users'],
    ['#sidebar-toggle .sidebar-toggle-icon', 'panel-left'],
    ['#list-toggle .list-toggle-icon',       'list'],
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
function getDemoIRs() {
  return [
    { irNumber: 'IR409', droneId: 'S25P014', dateRaised: '2025-10-01', status: 'In Production',  summaryLink: 'https://docs.google.com/spreadsheets/d/1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4/edit#gid=0', customerName: 'AgriKart Pvt Ltd',      contactEmail: 'ops@agrikart.in',      issueType: 'Hardware Damage',   issueDesc: 'Drone arm cracked during landing', spoc: 'Monish Raza', initialStatus: 'In Production',  incidentDate: '2025-09-28' },
    { irNumber: 'IR408', droneId: 'S100-003', dateRaised: '2025-09-28', status: 'QC Investigation', summaryLink: 'https://docs.google.com/spreadsheets/d/1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4/edit#gid=0', customerName: 'FarmVista Solutions',   contactEmail: 'support@farmvista.com', issueType: 'Firmware Issue',    issueDesc: 'GPS lock failure mid-flight',      spoc: 'Ravi Singh',  initialStatus: 'QC Investigation', incidentDate: '2025-09-25' },
    { irNumber: 'IR407', droneId: 'S25P017', dateRaised: '2025-09-20', status: 'Open',            summaryLink: 'https://docs.google.com/spreadsheets/d/1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4/edit#gid=0', customerName: 'SkyHarvest Corp',       contactEmail: 'tech@skyharvest.in',   issueType: 'Battery Issue',     issueDesc: 'Battery swelling after 50 cycles', spoc: 'Adhik Nair',  initialStatus: 'Open',            incidentDate: '2025-09-18' },
    { irNumber: 'IR406', droneId: 'S25P010', dateRaised: '2025-09-15', status: 'Delivered',        summaryLink: 'https://docs.google.com/spreadsheets/d/1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4/edit#gid=0', customerName: 'GreenField Agri',       contactEmail: 'field@greenfield.co',  issueType: 'Operational Query', issueDesc: 'Propeller vibration at high RPM',   spoc: 'Monish Raza', initialStatus: 'Delivered',        incidentDate: '2025-09-12' },
    { irNumber: 'IR405', droneId: 'S25P040', dateRaised: '2025-09-10', status: 'Closed',           summaryLink: 'https://docs.google.com/spreadsheets/d/1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4/edit#gid=0', customerName: 'DroneWorks India',      contactEmail: 'service@droneworks.in', issueType: 'RMA / Return',      issueDesc: 'Complete unit returned for RMA',   spoc: 'Ravi Singh',  initialStatus: 'Closed',           incidentDate: '2025-09-08' },
  ];
}
