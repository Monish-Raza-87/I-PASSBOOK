/* ============================================================
   I-PASSBOOK — app.js
   Single Page App routing, auth, form rendering & API calls
   ============================================================ */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// IMPORTANT: Replace these with your actual values before deploying.
const CONFIG = {
  // Google Apps Script Web App URL (v2 — correct column mappings)
  GAS_URL: 'https://script.google.com/macros/s/AKfycbz-borqx_TeCTh1Ibc70vv9SIHaFxRvVGs4XolbJG0EG2qEg4kVQ0hyclDOeLM8kCDP/exec',

  // Allowed domain — only @indrones.com (plus explicitly-allowlisted) accounts
  ALLOWED_DOMAIN: 'indrones.com',

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

// ─── EMAIL + PASSWORD AUTH (allowlist-gated, no Google) ───────────────────────
// No Google sign-in anywhere. A user signs UP with email + password — the
// backend only lets emails on CONFIG.ALLOWED_EMAILS create an account. Sign-in
// exchanges email + password for a revocable server SESSION TOKEN (12h), which
// the frontend holds in sessionStorage and attaches to every backend call. A
// refresh within a session stays signed in, but a FULL app close wipes
// sessionStorage — so reopening the app ALWAYS requires signing in again,
// regardless of who was logged in before (a handed-off device can't inherit a
// session). The caller's email is read FROM the session token by the backend,
// never a client param, so the allowlist gate can't be spoofed. An idle timeout
// also forces re-sign-in after inactivity. See [[auth-token-gate]].

// Persist/restore the session token in sessionStorage (NOT localStorage) — this
// is what makes "close the app → must sign in again" work.
const SESSION_KEY = 'ipb_session';
function persistSession(token) {
  try { if (token) sessionStorage.setItem(SESSION_KEY, token); else sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}
function loadSession() {
  try { return sessionStorage.getItem(SESSION_KEY) || null; } catch { return null; }
}

// ─── IDLE TIMEOUT / FORCED RE-AUTH ───────────────────────────────────────────
// After IDLE_MS of no user activity, the session is revoked and the user is
// bounced to the login screen (no page reload — the toast stays visible). This
// is a "basic reason for re-sign-in": a device left open doesn't stay signed in
// forever, which matters on a shared / handed-off device.
const IDLE_MS = 15 * 60 * 1000;   // 15 minutes
let _idleTimer = null;
let _idleListenersAdded = false;
function resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  if (!currentUser || !currentUser.sessionToken) return;   // only arm when signed in
  _idleTimer = setTimeout(() => {
    showToast('Signed out due to inactivity — please sign in again');
    forceReauth();
  }, IDLE_MS);
}
function startIdleTimer() {
  if (!_idleListenersAdded) {
    _idleListenersAdded = true;
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev =>
      window.addEventListener(ev, resetIdleTimer, { passive: true }));
  }
  resetIdleTimer();
}
// Revoke the server session, clear in-session state, and show the login screen
// (no reload). Used by the idle timeout and the session-expired path.
function forceReauth() {
  const st = currentUser && currentUser.sessionToken;
  if (st) {
    try {
      const fd = new FormData();
      fd.append('action', 'logout');
      fd.append('sessionToken', st);
      _origFetch(CONFIG.GAS_URL, { method: 'POST', body: fd }).catch(() => {});
    } catch { /* non-fatal */ }
  }
  try {
    sessionStorage.removeItem('ipb_user');
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* non-fatal */ }
  currentUser = null;
  _authToastShown = false;
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  if (typeof showAuth === 'function') showAuth();
}

// Exchange email + password for a server session token + access payload.
// Called from the Sign in button. Stores the session, clears any stale
// sessionError, and returns the backend's parsed {status,...} so the caller can
// surface the real rejection reason (e.g. "Wrong password."). Uses _origFetch
// (not the intercepted fetch) so the login call isn't subject to the session
// gate, and so a bad password can't trigger the "session expired" auto-logout.
function loginBackend(email, password) {
  if (!email || !password) return Promise.resolve({ status: 'error', message: 'Enter your email and password.' });
  const fd = new FormData();
  fd.append('action', 'login');
  fd.append('email', email);
  fd.append('password', password);
  const doFetch = _origFetch(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.text().then(t => {
      // Apps Script returns JSON after a redirect; parse what came back.
      try { return JSON.parse(t); } catch { return { status: 'error', message: 'Bad response from server.' }; }
    }))
    .then(data => {
      if (data && data.status === 'ok' && data.sessionToken) {
        currentUser.sessionToken = data.sessionToken;
        // backend doLoginPassword nests the access payload under data.access
        // (the getMyAccess return). Without this, currentUser.access would be
        // all-undefined and lock the user out of sections.
        const a = (data && data.access) || {};
        currentUser.access = { role: a.role, permissions: a.permissions, pendingRequest: !!a.pendingRequest };
        currentUser.sessionError = null;   // clear any stale reason on a real mint
        persistSession(data.sessionToken);
        return data;
      }
      // Pass the backend's own error message through (e.g. "Wrong password." /
      // "No account found for this email — sign up first."). Store it so the UI
      // can surface the real reason instead of a generic "login failed".
      currentUser.sessionError = (data && data.message) ? data.message : 'Login failed.';
      return data && data.message
        ? { status: 'error', message: data.message }
        : { status: 'error', message: 'Login failed.' };
    })
    .catch(err => ({ status: 'error', message: 'Network error: ' + (err && err.message ? err.message : 'unable to reach backend') }));
  // 15s hard backstop — a hung fetch can never leave the caller waiting forever.
  return Promise.race([
    doFetch,
    new Promise(r => setTimeout(() => r({ status: 'error', message: 'Login timed out — check your connection' }), 15000)),
  ]);
}

// Sign-up is two steps (email verification via OTP):
//   1) requestSignupBackend — backend emails a 6-digit code to the allowlisted
//      address (MailApp, already scoped — no new permission). No account yet.
//   2) verifySignupBackend  — user enters the code; backend creates the account
//      and mints a session. `t` = ms since the form became ready (server-enforced
//      bot time-gate). `website` is a honeypot — must stay empty.
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
function requestSignupBackend(email, password, t, website, captchaId, captchaAnswer) {
  if (!email || !password) return Promise.resolve({ status: 'error', message: 'Enter your email and a password.' });
  return postAuth('requestSignup', {
    email, password, t: String(t || 0), website: website || '',
    captchaId: captchaId || '', captchaAnswer: captchaAnswer || ''
  });
}
function verifySignupBackend(email, password, code) {
  if (!email || !password || !code) return Promise.resolve({ status: 'error', message: 'Enter your email, password, and the code.' });
  return postAuth('verifySignup', { email, password, code });
}

// Fetch a self-hosted captcha challenge (server-generated SVG image). The answer
// stays on the server; the client only gets the image + an id to reference it.
let _captchaId = null;
function fetchCaptcha(imgEl) {
  const errEl = document.getElementById('auth-captcha-error');
  if (imgEl) imgEl.style.display = 'none';
  if (errEl) { errEl.style.display = ''; errEl.textContent = 'Loading challenge…'; }
  const url = CONFIG.GAS_URL + (CONFIG.GAS_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=getCaptcha';
  return _origFetch(url).then(r => r.text().then(t => {
    try { return JSON.parse(t); } catch { return { status: 'error', message: 'Bad response from server.' }; }
  })).then(d => {
    if (d && d.status === 'ok' && d.captchaId && d.svg && imgEl) {
      _captchaId = d.captchaId;
      // Base64 data-URI is the most broadly compatible way to render an SVG in <img>
      // (handles the U+2212 minus sign and any other non-Latin1 char without encoding drama).
      try { imgEl.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(d.svg))); }
      catch (e) { imgEl.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(d.svg); }
      imgEl.alt = 'Captcha challenge';
      imgEl.style.display = '';
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    } else if (imgEl) {
      // Surface the REAL reason instead of silently showing a blank box. The most common
      // cause is the GAS backend not yet redeployed with the getCaptcha action.
      const reason = (d && d.message) ? d.message : 'no response from server';
      if (errEl) {
        errEl.style.display = '';
        errEl.textContent = /Unknown action/i.test(reason)
          ? 'Backend needs redeploy — captcha action missing. Tap ↻ after redeploying.'
          : 'Captcha unavailable — tap ↻ to retry. (' + reason + ')';
      }
      console.warn('fetchCaptcha: challenge not loaded', d);
    }
    return d;
  }).catch(err => {
    const e2 = document.getElementById('auth-captcha-error');
    if (e2) { e2.style.display = ''; e2.textContent = 'Captcha unavailable — check your connection, then tap ↻.'; }
    console.warn('fetchCaptcha: network error', err);
    return null;
  });
}

// Refresh the caller's role/permissions from the backend (boot + after access
// changes). Best-effort — a failure leaves the previous access in place.
function refreshMyAccess() {
  if (!currentUser || !currentUser.sessionToken) return Promise.resolve(null);
  const url = CONFIG.GAS_URL + (CONFIG.GAS_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=getMyAccess';
  return fetch(url).then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.status === 'ok') {
        currentUser.access = { role: data.role, permissions: data.permissions, pendingRequest: !!data.pendingRequest };
        return data;
      }
      return null;
    })
    .catch(() => null);
}

const _origFetch = window.fetch.bind(window);
let _authToastShown = false;       // one "session expired" hint per session, not per call
window.fetch = function (input, init) {
  return (async () => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isGAS = url.indexOf(CONFIG.GAS_URL) === 0;
    if (!isGAS) return _origFetch(input, init);

    // Dev bypass (localhost + ?dev=1): no real account, so backend calls aren't
    // authorized and fall back to demo data. Intentional — real testing happens
    // signed-in on the live site.
    if (shouldUseDevAuthBypass()) return _origFetch(input, init);

    // login / signup are self-authenticating (email+password in the body) — do
    // NOT attach a session token to them (there isn't one yet, and they must not
    // trip the session-expired auto-logout below).
    const isAuthCall = url.indexOf('action=login') >= 0 || url.indexOf('action=requestSignup') >= 0 || url.indexOf('action=verifySignup') >= 0;

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
      // Pass the FormData auth call through untouched (uses _origFetch directly).
      resp = await _origFetch(input, init);
    } else if (isFormData) {
      // FormData() only accepts an HTMLFormElement, so copy entries by hand.
      const fd = new FormData();
      for (const [k, v] of origBody.entries()) fd.append(k, v);
      appendAuth(fd);
      resp = await _origFetch(url, Object.assign({}, init, { body: fd }));
    } else {
      // GET-style: append creds to the URL.
      const sep = url.indexOf('?') >= 0 ? '&' : '?';
      let q = '';
      if (sessionToken) q += (q ? '&' : '') + 'sessionToken=' + encodeURIComponent(sessionToken);
      if (email) q += (q ? '&' : '') + 'userEmail=' + encodeURIComponent(email);
      resp = await _origFetch(url + (q ? sep + q : ''), init);
    }

    // If the session is gone (expired / revoked / backend redeployed with a fresh
    // SESSIONS tab), surface ONE hint and bounce back to the login screen so the
    // user just signs in again — no "Reconnect" step, fully automatic. This is
    // the "auto mode" recovery: a dead session never leaves the user stuck.
    if (resp && resp.ok && !isAuthCall && !_authToastShown) {
      try {
        const data = await resp.clone().json();
        if (data && data.status === 'error' && String(data.message || '').toLowerCase().indexOf('unauthorized') === 0) {
          _authToastShown = true;
          showToast('Session expired — please sign in again');
          try {
            sessionStorage.removeItem('ipb_user');
            sessionStorage.removeItem(SESSION_KEY);
            localStorage.removeItem('ipb_user');   // clear any legacy persistent profile
          } catch { /* non-fatal */ }
          currentUser = null;
          if (typeof showAuth === 'function') showAuth();
        }
      } catch { /* not JSON */ }
    }
    return resp;
  })();
};
let allIRs      = [];          // master list fetched from GAS
let currentIR   = null;        // the IR open in detail view
let currentSectionData = {};   // cached data for open passbook
let legacyMap   = {};          // irNumber -> { label, gid, embedUrl, openUrl } for legacy IRs (≤~IR441)

// ─── ADMIN (config editors + access managers) ─────────────────────────────────
// Admins manage users & per-section access, and bypass every permission check.
// Must match backend CONFIG.ADMIN_EMAILS.
const ADMIN_EMAILS = [
  'monish.raza@indrones.com',
  'customer.relations@indrones.com',
];
function isAdmin() {
  const email = currentUser?.email?.toLowerCase().trim();
  if (!email) return false;
  if (ADMIN_EMAILS.includes(email)) return true;
  // Allow the local dev user (?dev=1) to test admin features.
  if (email === `dev@${CONFIG.ALLOWED_DOMAIN}`) return true;
  return false;
}
// Kept as an alias so existing Section B code reads naturally.
const isInwardAdmin = isAdmin;

// ─── ACCESS CONTROL (per-section view / comment / edit) ───────────────────────
// `currentUser.access` is populated by loginBackend / refreshMyAccess:
//   { role: 'admin'|'user'|'none', permissions: { 'sec-a':'edit', ... }, pendingRequest }
// During the backend redeploy window (or a transient getMyAccess failure) access
// may be undefined — we fall back to a permissive profile so the app keeps
// working exactly as it did before ACLs existed. The backend enforces
// independently once redeployed, so this frontend leniency is safe in transition.
const SECTION_IDS = ['sec-a','sec-b','sec-c','sec-d','sec-e','sec-f','sec-g','sec-h','sec-i'];
function myAccess() {
  if (currentUser && currentUser.access) return currentUser.access;
  // Permissive fallback: treat as a user with edit on every section.
  const all = {};
  SECTION_IDS.forEach(s => { all[s] = 'edit'; });
  return { role: isAdmin() ? 'admin' : 'user', permissions: all, pendingRequest: false, __fallback: true };
}
function canViewSection(secId)    { const a = myAccess(); if (a.role === 'admin') return true; const v = a.permissions && a.permissions[secId]; return v === 'view' || v === 'comment' || v === 'edit'; }
function canCommentSection(secId) { const a = myAccess(); if (a.role === 'admin') return true; const v = a.permissions && a.permissions[secId]; return v === 'comment' || v === 'edit'; }
function canEditSection(secId)    { const a = myAccess(); if (a.role === 'admin') return true; return !!(a.permissions && a.permissions[secId] === 'edit'); }

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
// cell (no ceiling), and two people editing two different tickets never clobber
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
// owns everything mutable — status, assignee, priority, type, which sections are
// done, CSAT. One row per IR, keyed by irNumber.
//
// Ownership of a ticket's status begins the moment a human changes the STATUS in
// the app (statusOwned). Until then the Sheet's Col D is still what the list
// shows, so an edit made in the Sheet on an untriaged ticket still works — it
// only stops mattering once somebody has taken the ticket in hand here. Note
// that assigning or categorising does NOT take over the status.
const IR_STATE_IR = '__IRS__';
let irState = {};             // irNumber -> { status, statusOwned, statusAt, statusBy,
                              //              assignee, priority, type, done[], … }
let irStateSyncedAt = null;   // Date of the last successful __IRS__ read

// The row for one IR, but only if a human has actually edited it. A row that
// holds nothing but the first-sight seed is a marker, not an edit.
function appState(irNumber) {
  const s = irState[irNumber];
  if (!s || !s.updatedBy) return null;
  return s;
}

// The status this app has actually taken ownership of, or '' while the Sheet is
// still the authority for the ticket. Deliberately separate from appState():
// saving Section B is not triage, so a ticket whose Section B was saved must go
// on following the Sheet's Col D until somebody changes the status here.
function ownedStatus(irNumber) {
  const s = irState[irNumber];
  return (s && s.statusOwned && s.status) ? s.status : '';
}

// Record that the app has seen this IR, without claiming ownership of its
// status yet. Written once per ticket, on first open. Records `seededAt` rather
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
}

// The single writer of `allIRs`. Every fetchIRs() path goes through it so
// app-owned state is merged exactly once, after the Sheet/demo data lands, and
// the three paths can never disagree about precedence.
function setAllIRs(records) {
  allIRs = Array.isArray(records) ? records : [];
  applyIRStateToAllIRs();
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
    ir.type = s.type || '';
    ir.done = Array.isArray(s.done) ? s.done : [];
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
  // Same guard as loadIRState: a ticket can be opened by deep link before the
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
  const done = Array.isArray(row.done) ? row.done.slice() : [];
  if (!done.includes(sectionId)) done.push(sectionId);
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

// Ticket categories, app-owned (the Form has no such column). These are a guess
// at Indrones' own groupings and are meant to be edited in this one line —
// nothing else in the app depends on the specific values.
const TICKET_TYPES = ['Repair', 'Replacement', 'Warranty', 'AMC', 'Demo', 'Training', 'Other'];

// Triage priorities. `priority` is read from the Sheet's "Priority" column when
// one exists (fetchIRsFromSheet) and from here when the app sets it.
const TICKET_PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

// Runtime option lists (defaults merged with any saved overrides).
let inwardOptions = JSON.parse(JSON.stringify(INWARD_OPTIONS_DEFAULTS));
// E-signature state for the open IR: { [fieldId]: { signedBy, signedAt, history: [] } }
let esignatureState = {};
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
const irList      = document.getElementById('ir-list');
const searchInput = document.getElementById('search-input');
const backBtn     = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const userAvatar  = document.getElementById('user-avatar');
const syncStatus  = document.getElementById('sync-status');
const toast       = document.getElementById('toast');

// ─── SHELL REFS ──────────────────────────────────────────────────────────────
// The Frappe-style shell (sidebar / list / split pane). These are only touched
// by the layout + router code below — nothing in the section rendering path
// reads them.
const navAccess     = document.getElementById('nav-access');
const navAdminLabel = document.getElementById('nav-admin-label');
const navTheme      = document.getElementById('nav-theme');
const navThemeIcon  = document.getElementById('nav-theme-icon');
const navThemeLabel = document.getElementById('nav-theme-label');
const navCountEl    = document.getElementById('nav-count');
const listSegments  = document.getElementById('list-segments');
const listCountEl   = document.getElementById('list-count');
const bannerPills   = document.getElementById('ir-banner-pills');

// ─── VIEW / ROUTER STATE ─────────────────────────────────────────────────────
// currentView is the single source of truth for which screen is showing.
// renderLayout() translates it into the inline display values that the rest of
// the app reads back (applyAccessGating tests detailView.style.display).
let currentView = 'index';     // 'index' | 'detail'
let activeSegment = 'all';     // ticket-list filter segment
let _appBooted = false;        // showApp() guard — it re-binds listeners
let _irsReady = null;          // promise for the first IR-list load (deep links await it)
let _openSeq = 0;              // supersedes an in-flight openPassbook()
const mqDesktop = window.matchMedia('(min-width: 1024px)');

// ─── SPLASH → AUTH FLOW ──────────────────────────────────────────────────────
window.addEventListener('load', () => {
  // Check for local file protocol (login + backend calls won't work)
  if (window.location.protocol === 'file:') {
    alert('⚠️ You are running this app directly from a local file. Login and the backend will NOT work unless you serve the app via a local server (http://localhost) or deploy it to GitHub Pages.');
  }

  // Give the splash video time to play (4 seconds for the Indrones intro)
  setTimeout(() => {
    splash.style.opacity = '0';
    splash.style.transform = 'scale(1.04)';
    setTimeout(() => {
      splash.style.display = 'none';
      const stored = loadStoredUser();
      const storedSession = loadSession();
      if (stored && storedSession) {
        currentUser = stored;
        // Restore the server session token so backend calls are authorized with
        // no sign-in pop-up. This only happens on a refresh WITHIN a session — a
        // full app close wipes sessionStorage (loadStoredUser/loadSession return
        // null) and the user must sign in again below.
        currentUser.sessionToken = storedSession;
        showApp();
        // Refresh role/permissions from the backend (drives access gating +
        // request-access screen). Best-effort; gating has a safe fallback. If
        // the session is dead, the interceptor bounces back to the login screen.
        refreshMyAccess().then(() => { if (typeof applyAccessGating === 'function') applyAccessGating(); });
        startIdleTimer();   // arm the inactivity auto sign-out
      } else if (shouldUseDevAuthBypass()) {
        currentUser = createDevUser();
        persistUser(currentUser, false); // dev bypass: this tab only
        showApp();
      } else {
        // Stale profile with no session = effectively signed out. Drop the
        // stale profile and show the login screen so the user signs in fresh.
        if (stored) { try { sessionStorage.removeItem('ipb_user'); localStorage.removeItem('ipb_user'); } catch { /* non-fatal */ } }
        showAuth();
      }
    }, 800);
  }, 2000);
});

function shouldUseDevAuthBypass() {
  const params = new URLSearchParams(window.location.search);
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  return CONFIG.ENABLE_DEV_AUTH_BYPASS && isLocalHost && params.get('dev') === '1';
}

function createDevUser() {
  return {
    name: 'Dev Tester',
    email: `dev@${CONFIG.ALLOWED_DOMAIN}`,
    initial: 'D',
    token: 'local-dev',
  };
}

// ─── IN-SESSION PROFILE (sessionStorage — NOT persistent across app close) ────
// The profile + session token live in sessionStorage only, so a full app close
// wipes them and the next open forces a fresh sign-in (a handed-off device can't
// inherit the previous user's session). A refresh within a session keeps the
// user signed in. The server session token is the real credential; this profile
// is just the display name/email. The raw password is NEVER stored.
function persistUser(user /* persist flag ignored — always sessionStorage */) {
  const safe = {
    name:    user.name,
    email:   user.email,
    picture: user.picture,
    initial: user.initial,
  };
  try {
    sessionStorage.setItem('ipb_user', JSON.stringify(safe));
    // Deliberately do NOT write localStorage — that would survive app close and
    // defeat the "reopen → must sign in again" security model.
    localStorage.removeItem('ipb_user');
  } catch { /* storage may be unavailable in private mode — non-fatal */ }
}

function loadStoredUser() {
  try {
    // sessionStorage only — a full app close clears it, forcing re-sign-in.
    const session = sessionStorage.getItem('ipb_user');
    if (session) return JSON.parse(session);
    // If a very old localStorage profile lingers from the prior "keep me logged
    // in" model, ignore (and clean) it — we never restore a cross-close session.
    localStorage.removeItem('ipb_user');
  } catch { }
  return null;
}

// ─── EMAIL + PASSWORD AUTH UI ────────────────────────────────────────────────
function showAuth() {
  authCont.style.display = 'flex';
  appCont.style.display  = 'none';
  const err = document.getElementById('auth-error');
  if (err) err.style.display = 'none';
  // Reset to a clean Sign-in form (showAuth can be called mid-session by the
  // idle timeout / session-expired path, when the form may be in signup/OTP mode).
  const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  const show = (id) => { const el = document.getElementById(id); if (el) el.style.display = ''; };
  hide('auth-name-wrap'); hide('auth-otp-wrap'); hide('auth-captcha-wrap');
  show('auth-signin-btn'); hide('auth-signup-btn');
  const toggleBtn = document.getElementById('auth-toggle-mode');
  if (toggleBtn) toggleBtn.textContent = 'Need an account? Sign up';
  _authMode = 'login'; _pendingSignup = null;
  ['auth-email', 'auth-password', 'auth-otp', 'auth-captcha'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  wireAuthForm();
}

let _authFormWired = false;
let _authFormReadyTs = 0;          // for the server-enforced bot time-gate
let _authMode = 'login';           // 'login' | 'signup' | 'otp'
let _pendingSignup = null;         // { email, password } held between OTP request & verify
function wireAuthForm() {
  if (_authFormWired) return;
  const form = document.getElementById('auth-form');
  if (!form) return;
  _authFormWired = true;
  _authFormReadyTs = Date.now();

  const emailIn    = document.getElementById('auth-email');
  const passIn     = document.getElementById('auth-password');
  const honeyIn    = document.getElementById('auth-website');   // honeypot — humans leave empty
  const signInBtn   = document.getElementById('auth-signin-btn');
  const signUpBtn   = document.getElementById('auth-signup-btn');
  const toggleBtn   = document.getElementById('auth-toggle-mode');
  const otpWrap     = document.getElementById('auth-otp-wrap');
  const otpIn       = document.getElementById('auth-otp');
  const otpNote     = document.getElementById('auth-otp-note');
  const verifyBtn   = document.getElementById('auth-verify-btn');
  const resendLink  = document.getElementById('auth-resend-link');
  const captchaWrap = document.getElementById('auth-captcha-wrap');
  const captchaImg  = document.getElementById('auth-captcha-img');
  const captchaIn   = document.getElementById('auth-captcha');
  const captchaRefresh = document.getElementById('auth-captcha-refresh');
  const errEl       = document.getElementById('auth-error');

  const showError = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = msg ? 'block' : 'none'; } };
  const refreshCaptcha = () => { if (captchaImg) fetchCaptcha(captchaImg); if (captchaIn) captchaIn.value = ''; };
  const setOtpStep = (on, note) => {
    if (otpWrap) otpWrap.style.display = on ? 'flex' : 'none';
    if (on && otpNote && note) otpNote.textContent = note;
    if (on) _authMode = 'otp'; else if (_authMode === 'otp') _authMode = 'signup';
    if (on) {
      signUpBtn.style.display = 'none';
      if (captchaWrap) captchaWrap.style.display = 'none';   // captcha already validated
      if (otpIn) setTimeout(() => otpIn.focus(), 50);
    }
  };

  const finishSuccess = (email, d) => {
    const name = (email.split('@')[0] || 'User');
    currentUser.name    = name;
    currentUser.email   = email;
    currentUser.initial = name.charAt(0).toUpperCase() || '?';
    delete currentUser.picture;
    currentUser.sessionToken = d.sessionToken;
    const a = (d && d.access) || {};
    currentUser.access = { role: a.role, permissions: a.permissions, pendingRequest: !!a.pendingRequest };
    persistSession(d.sessionToken);
    persistUser(currentUser, true);
    showApp();
    refreshMyAccess().then(() => { if (typeof applyAccessGating === 'function') applyAccessGating(); });
    startIdleTimer();   // arm the inactivity auto sign-out
  };

  const submitLogin = () => {
    const email = (emailIn.value || '').trim().toLowerCase();
    const password = passIn.value || '';
    if (!email || !password) { showError('Enter your email and password.'); return; }
    signInBtn.disabled = true; signInBtn.textContent = 'Signing in…';
    showError('');
    currentUser = currentUser || { email: email };
    currentUser.email = email;
    loginBackend(email, password).then(d => {
      signInBtn.disabled = false; signInBtn.textContent = 'Sign in';
      if (d && d.status === 'ok' && d.sessionToken) finishSuccess(email, d);
      else showError((d && d.message) || 'Login failed.');
    });
  };

  // Step 1: ask the backend to email a 6-digit code to the allowlisted address.
  // The honeypot + time-to-submit + captcha are all checked server-side.
  const requestCode = (email, password) => {
    const t = Date.now() - _authFormReadyTs;
    const website = (honeyIn && honeyIn.value) || '';
    if (website) return Promise.resolve({ status: 'error', message: 'Sign-up could not be completed.' });
    const answer = (captchaIn && captchaIn.value) || '';
    return requestSignupBackend(email, password, t, website, _captchaId, answer);
  };

  const submitSignup = () => {
    const email = (emailIn.value || '').trim().toLowerCase();
    const password = passIn.value || '';
    if (!email || !password) { showError('Enter your email and a password.'); return; }
    if (password.length < 6) { showError('Password must be at least 6 characters.'); return; }
    if (captchaIn && !captchaIn.value) { showError('Please solve the captcha.'); return; }
    signUpBtn.disabled = true; signUpBtn.textContent = 'Sending code…';
    showError('');
    requestCode(email, password).then(d => {
      signUpBtn.disabled = false; signUpBtn.textContent = 'Sign up';
      if (d && d.status === 'ok') {
        _pendingSignup = { email, password };
        currentUser = { email: email };
        setOtpStep(true, 'Enter the 6-digit code sent to ' + email);
        if (d.message) showToast(d.message);
      } else {
        // A wrong/expired captcha is refreshed so the user gets a fresh image.
        if (d && d.captchaRefresh) refreshCaptcha();
        showError((d && d.message) || 'Sign up failed.');
      }
    });
  };

  // Step 2: verify the code → backend creates the account + mints a session.
  const submitVerify = () => {
    if (!_pendingSignup) { showError('Please request a code first.'); return; }
    const code = (otpIn && otpIn.value || '').trim();
    if (!code) { showError('Enter the 6-digit code from your email.'); return; }
    verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying…';
    showError('');
    verifySignupBackend(_pendingSignup.email, _pendingSignup.password, code).then(d => {
      verifyBtn.disabled = false; verifyBtn.textContent = 'Verify & create account';
      if (d && d.status === 'ok' && d.sessionToken) {
        const email = _pendingSignup ? _pendingSignup.email : (currentUser && currentUser.email || '');
        _pendingSignup = null;
        setOtpStep(false);
        finishSuccess(email, d);
      } else {
        showError((d && d.message) || 'Verification failed.');
      }
    });
  };

  const resendCode = () => {
    if (!_pendingSignup) return;
    resendLink.textContent = 'Sending…';
    resendLink.style.pointerEvents = 'none';
    showError('');
    requestCode(_pendingSignup.email, _pendingSignup.password).then(d => {
      resendLink.textContent = 'Resend code';
      resendLink.style.pointerEvents = '';
      if (d && d.status === 'ok') showToast(d.message || 'New code sent');
      else showError((d && d.message) || 'Could not resend.');
    });
  };

  signInBtn.addEventListener('click', submitLogin);
  signUpBtn.addEventListener('click', submitSignup);
  if (verifyBtn) verifyBtn.addEventListener('click', submitVerify);
  if (resendLink) resendLink.addEventListener('click', resendCode);
  if (captchaRefresh) captchaRefresh.addEventListener('click', (e) => { e.preventDefault(); refreshCaptcha(); });
  if (toggleBtn) toggleBtn.addEventListener('click', toggleAuthMode);
  // Enter submits the CURRENT mode (login / signup / otp), not always login.
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (_authMode === 'otp') submitVerify();
    else if (_authMode === 'signup') submitSignup();
    else submitLogin();
  });
}

function toggleAuthMode() {
  const nameWrap  = document.getElementById('auth-name-wrap');
  const toggleBtn = document.getElementById('auth-toggle-mode');
  const signInBtn = document.getElementById('auth-signin-btn');
  const signUpBtn = document.getElementById('auth-signup-btn');
  const otpWrap   = document.getElementById('auth-otp-wrap');
  const captchaWrap = document.getElementById('auth-captcha-wrap');
  const captchaImg  = document.getElementById('auth-captcha-img');
  if (!nameWrap) return;
  const isSignup = nameWrap.style.display !== 'none';
  if (isSignup) {
    // → Sign in mode
    nameWrap.style.display = 'none';
    if (otpWrap) otpWrap.style.display = 'none';
    if (captchaWrap) captchaWrap.style.display = 'none';
    signInBtn.style.display = '';
    signUpBtn.style.display = 'none';
    _authMode = 'login';
    _pendingSignup = null;
    if (toggleBtn) toggleBtn.textContent = 'Need an account? Sign up';
  } else {
    // → Sign up mode (captcha is required, so fetch a fresh challenge now)
    nameWrap.style.display = '';
    if (otpWrap) otpWrap.style.display = 'none';
    if (captchaWrap) { captchaWrap.style.display = ''; if (captchaImg) fetchCaptcha(captchaImg); }
    signInBtn.style.display = 'none';
    signUpBtn.style.display = '';
    _authMode = 'signup';
    if (toggleBtn) toggleBtn.textContent = 'Already have an account? Sign in';
  }
}

// ─── THEME ───────────────────────────────────────────────────────────────────
// Preference is 'light' | 'dark' | 'system' under localStorage 'theme'.
// 'system' is the default and honours the OS setting live; the nav toggle
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

  if (navThemeIcon)  navThemeIcon.textContent  = dark ? '☀️' : '🌙';
  if (navThemeLabel) navThemeLabel.textContent = dark ? 'Light mode' : 'Dark mode';
  if (navTheme)      navTheme.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

function toggleTheme() {
  try { localStorage.setItem(THEME_KEY, isDarkTheme() ? 'light' : 'dark'); } catch { /* non-fatal */ }
  applyTheme(true);
}

// Follow the OS while the preference is still 'system'.
(function watchSystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (storedTheme() === 'system') applyTheme(true); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
})();

// ─── LAYOUT ──────────────────────────────────────────────────────────────────
// One function owns the panes' visibility. It must keep writing *inline*
// styles: applyAccessGating reads detailView.style.display, and
// applySectionAccessGating selects `.tab:not([style*="display: none"])`.
//
//   desktop (≥1024px) : list always visible, detail beside it when open
//   mobile            : list and detail are separate full screens
function renderLayout() {
  const desktop = mqDesktop.matches;
  const detail  = currentView === 'detail';
  indexView.style.display  = (desktop || !detail) ? 'flex' : 'none';
  detailView.style.display = detail ? 'flex' : 'none';
  backBtn.style.display    = (!desktop && detail) ? 'block' : 'none';
  document.body.classList.toggle('view-detail', detail);

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
//   #/legacy             → opens the read-only legacy workbook modal
// showIndex()/openPassbook() stay the view functions; the router only decides
// when to call them, so nothing here re-implements rendering.
function currentRoute() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'tickets' && parts[1]) return { name: 'ticket', irNumber: decodeURIComponent(parts[1]) };
  if (parts[0] === 'legacy') return { name: 'legacy' };
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

async function handleRoute() {
  if (!currentUser) return;
  const r = currentRoute();

  if (r.name === 'legacy') {
    if (typeof openLegacyWorkbook === 'function') openLegacyWorkbook();
    goIndex();
    return;
  }

  if (r.name === 'ticket') {
    // Already showing this ticket — don't rebuild every section form.
    if (currentView === 'detail' && currentIR?.irNumber === r.irNumber) return;
    // A deep link resolves before the IR list has loaded; wait so the banner
    // gets the drone serial and customer name.
    if (!allIRs.length && _irsReady) { try { await _irsReady; } catch { /* open anyway */ } }
    if (!currentUser) return;                   // signed out while waiting
    if (currentRoute().irNumber !== r.irNumber) return;   // superseded meanwhile
    openPassbook(r.irNumber);
    return;
  }

  if (currentView === 'index') return;
  showIndex();
}

window.addEventListener('hashchange', () => { handleRoute(); });

// ─── APP BOOT ────────────────────────────────────────────────────────────────
function showApp() {
  authCont.style.display = 'none';
  appCont.style.display  = 'flex';

  // Idempotent: this function binds click listeners to the avatar, the bell and
  // the request-access buttons. A second call (re-login, router re-entry) would
  // double-fire every one of them, so bind once and only refresh the layout.
  if (_appBooted) { renderLayout(); syncNavAccess(); return; }
  _appBooted = true;

  showIndex();
  applyTheme();          // sync the nav toggle with the stored preference
  syncNavAccess();

  // Set up user avatar
  userAvatar.textContent = currentUser?.initial || '?';
  if (currentUser?.picture) {
    userAvatar.style.backgroundImage = `url(${currentUser.picture})`;
    userAvatar.style.backgroundSize  = 'cover';
    userAvatar.textContent = '';
  }

  // User menu toggle
  userAvatar.addEventListener('click', toggleUserMenu);
  if (navTheme) navTheme.addEventListener('click', toggleTheme);
  if (navAccess) navAccess.addEventListener('click', openAccessModal);

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
  // Load app-owned workflow state (status / assignee / priority / type per IR).
  // Runs alongside the first fetchIRs(); setAllIRs merges whatever has arrived,
  // and loadIRState re-merges + re-renders when it lands, so either order is
  // correct.
  loadIRState();
  loadNudges();
  startNudgePolling();

  // Bell toggle
  const bell = document.getElementById('nudge-bell');
  if (bell) bell.addEventListener('click', toggleNudgePanel);

  // Wire the request-access screen buttons (shown later by applyAccessGating
  // if the signed-in user has no access yet).
  const raBtn = document.getElementById('request-access-btn');
  if (raBtn) raBtn.addEventListener('click', requestAccessAction);
  const raOut = document.getElementById('request-access-signout');
  if (raOut) raOut.addEventListener('click', signOut);

  // Enter the route. A hash already in the URL (deep link / restored tab) wins;
  // otherwise start on the ticket list without adding a history entry.
  if (!location.hash) history.replaceState(null, '', '#/tickets');
  handleRoute();
}

// Shows the Administration nav group only to admins.
function syncNavAccess() {
  const admin = isAdmin();
  if (navAdminLabel) navAdminLabel.style.display = admin ? '' : 'none';
  if (navAccess)     navAccess.style.display     = admin ? '' : 'none';
}

// ─── ACCESS GATING (boot-level: app vs request-access screen) ────────────────
// Called after login / refreshMyAccess. A signed-in user with role 'none'
// (and not an admin) gets the request-access screen instead of the IR index.
function applyAccessGating() {
  const ra = document.getElementById('request-access');
  if (!ra) return;
  const a = myAccess();
  const locked = a.role === 'none' && !isAdmin() && !a.__fallback;
  if (locked) {
    // #request-access is a sibling of #app-container, so the whole shell
    // (sidebar + header + panes) goes away, not just the panes.
    ra.style.display = 'flex';
    appCont.style.display = 'none';
    indexView.style.display = 'none';
    detailView.style.display = 'none';
    document.body.classList.remove('view-detail');
    const emailEl = document.getElementById('request-access-email');
    if (emailEl) emailEl.textContent = currentUser?.email || '';
    const pendEl = document.getElementById('request-access-pending');
    if (pendEl) pendEl.style.display = a.pendingRequest ? 'block' : 'none';
    const btn = document.getElementById('request-access-btn');
    if (btn) { btn.disabled = !!a.pendingRequest; btn.textContent = a.pendingRequest ? 'Access requested' : 'Request access'; }
    return;
  }
  // Has access (or fallback during transition) → hide request-access screen.
  ra.style.display = 'none';
  // Only restore the shell if the user is actually signed in (this runs on the
  // access-refresh path, which can also fire while the login screen is up).
  if (authCont.style.display === 'none') appCont.style.display = 'flex';
  syncNavAccess();
  if (detailView.style.display === 'flex') {
    applySectionAccessGating();   // a passbook is open — re-gate with fresh access
  } else {
    showIndex();
  }
}

// Submit an access request. The backend records it as pending + emails admins.
function requestAccessAction() {
  const fd = new FormData();
  fd.append('action', 'requestAccess');
  fd.append('name', currentUser?.name || '');
  fetch(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (data && data.status === 'ok') {
        if (currentUser.access) currentUser.access.pendingRequest = true;
        applyAccessGating();
        showToast('Access requested — an admin will review it');
      } else {
        showToast('Could not request access: ' + ((data && data.message) || 'backend error'));
      }
    })
    .catch(() => showToast('Could not reach the backend — try again'));
}

// ─── ADMIN: User Access & Requests modal ─────────────────────────────────────
const ACCESS_LEVELS = ['', 'view', 'comment', 'edit'];
const ACCESS_LABEL  = { '': 'None', 'view': 'View', 'comment': 'Comment', 'edit': 'Edit' };
const SECTION_LABELS = { 'sec-a':'A','sec-b':'B','sec-c':'C','sec-d':'D','sec-e':'E','sec-f':'F','sec-g':'G','sec-h':'H','sec-i':'I' };

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
        <div class="inward-options-title">👥 User Access &amp; Requests</div>
        <button type="button" class="inward-options-close" onclick="closeAccessModal()" title="Close">&times;</button>
      </div>
      <div class="access-status" id="access-status"></div>
      <div class="access-body">
        <div class="access-section">
          <h3>Pending requests</h3>
          <div id="access-requests"><div class="access-loading">Loading…</div></div>
        </div>
        <div class="access-section">
          <h3>Users</h3>
          <p class="access-hint">Add a teammate's @indrones.com email and pick one access level for all sections. Need finer control? Choose <strong>Custom…</strong> to set sections A–I separately.</p>
          <p class="access-legend"><span class="acc-lv none">None</span> no access · <span class="acc-lv view">View</span> read-only · <span class="acc-lv comment">Comment</span> view + comment · <span class="acc-lv edit">Edit</span> view + comment + edit · <strong>Custom…</strong> per section</p>
          <div class="access-add-row">
            <input type="email" id="access-new-email" class="form-input" placeholder="teammate@indrones.com" />
            <button type="button" class="btn" id="access-add-btn">+ Add</button>
          </div>
          <div id="access-users"><div class="access-loading">Loading…</div></div>
          <button type="button" class="btn" id="access-save-all" style="margin-top:0.75rem;">💾 Save all changes</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeAccessModal(); });
  document.getElementById('access-add-btn').addEventListener('click', addAccessUser);
  document.getElementById('access-save-all').addEventListener('click', saveAllAccess);
  updateAccessStatus();
  loadAccessData();
}
function updateAccessStatus() {
  const el = document.getElementById('access-status');
  if (!el) return;
  const hasSession = !!(currentUser && currentUser.sessionToken);
  const cred = hasSession
    ? 'session ✓'
    : ('no active session — ' + escHtml((currentUser && currentUser.sessionError) || 'sign in again'));
  el.innerHTML = `Signed in as <strong>${escHtml(currentUser?.email || '—')}</strong> · ${cred}`;
}
function closeAccessModal() { document.getElementById('access-modal')?.remove(); }

let accessCache = { users: [], requests: [] };
function accessReconnectHtml(reason) {
  // reason = the REAL backend rejection (expired/revoked session). With
  // email+password auth there is no "Reconnect" — the user just signs in again.
  const why = reason ? escHtml(String(reason)) : 'Your sign-in session isn’t active, so the backend rejected this request.';
  const hint = 'Your session expired. Sign in again and this list reloads automatically.';
  return `<div class="access-error">
    <div id="access-reconnect-reason">${why}</div>
    <button type="button" class="btn" id="access-reconnect-btn" style="margin-top:0.6rem;">Sign in again</button>
    <div class="access-hint" style="margin-top:0.5rem;">${hint}</div>
  </div>`;
}
function loadAccessData() {
  fetch(CONFIG.GAS_URL + (CONFIG.GAS_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=listACL')
    .then(r => r.json())
    .then(data => {
      if (data && data.status === 'ok') {
        accessCache = { users: data.users || [], requests: data.requests || [] };
        renderAccessRequests();
        renderAccessUsers();
        return;
      }
      const unauthorized = data && String(data.message || '').toLowerCase().indexOf('unauthorized') === 0;
      // Surface the REAL backend rejection reason instead of a generic message.
      const reason = (currentUser && currentUser.sessionError) || (data && data.message) || '';
      const html = unauthorized
        ? accessReconnectHtml(reason)
        : '<div class="access-error">Could not load — is the backend redeployed? ' + escHtml((data && data.message) || '') + '</div>';
      document.getElementById('access-requests').innerHTML = html;
      document.getElementById('access-users').innerHTML = '';
      if (unauthorized) {
        const rb = document.getElementById('access-reconnect-btn');
        if (rb) rb.addEventListener('click', () => { signOut(); });
      }
    })
    .catch(() => {
      document.getElementById('access-requests').innerHTML = '<div class="access-error">Could not reach the backend.</div>';
      document.getElementById('access-users').innerHTML = '';
    });
}

function renderAccessRequests() {
  const el = document.getElementById('access-requests');
  const reqs = accessCache.requests || [];
  if (!reqs.length) { el.innerHTML = '<div class="access-empty">No pending requests.</div>'; return; }
  el.innerHTML = reqs.map(r => `
    <div class="access-request-row">
      <div><div class="access-req-name">${escHtml(r.name || '—')}</div><div class="access-req-email">${escHtml(r.email)}</div><div class="access-req-time">${escHtml(r.requestedAt || '')}</div></div>
      <div class="access-req-actions">
        <button type="button" class="btn btn-sm" onclick="approveRequest('${escHtml(r.email)}')">Approve</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="rejectRequest('${escHtml(r.email)}')">Reject</button>
      </div>
    </div>`).join('');
}

// A user's effective single access level when all 9 sections are equal. If the
// sections differ, the user is in "Custom…" mode (mixed per-section perms).
function userAccessLevel(u) {
  const p = (u && u.permissions) || {};
  const first = (p[SECTION_IDS[0]] || '');
  return SECTION_IDS.every(s => (p[s] || '') === first) ? first : '__custom__';
}

function renderAccessUsers() {
  const el = document.getElementById('access-users');
  const users = accessCache.users || [];
  if (!users.length) { el.innerHTML = '<div class="access-empty">No users yet — add one above.</div>'; return; }
  el.innerHTML = users.map((u, idx) => {
    const level = userAccessLevel(u);
    const isCustom = level === '__custom__';
    // Primary access-level selector: None / View / Comment / Edit / Custom…
    const levelOpts = ['', 'view', 'comment', 'edit', '__custom__']
      .map(l => `<option value="${l}"${l === level ? ' selected' : ''}>${l === '__custom__' ? 'Custom…' : ACCESS_LABEL[l]}</option>`).join('');
    // Per-section grid (only shown in Custom mode). Selects always exist in the
    // DOM so readRowPermsFromDom works in both modes.
    const cells = SECTION_IDS.map(s => {
      const v = (u.permissions && u.permissions[s]) || '';
      const sopts = ACCESS_LEVELS.map(l => `<option value="${l}"${l === v ? ' selected' : ''}>${ACCESS_LABEL[l]}</option>`).join('');
      return `<label class="acc-sec"><span>${SECTION_LABELS[s]}</span>
        <select class="access-cell" data-row="${idx}" data-sec="${s}">${sopts}</select></label>`;
    }).join('');
    return `<div class="access-user-card" data-row="${idx}">
      <div class="access-user-top">
        <div class="access-email-line">${escHtml(u.email)}</div>
        <div class="access-user-controls">
          <select class="access-level" data-row="${idx}">${levelOpts}</select>
          <button type="button" class="btn btn-sm btn-danger" onclick="removeAccessUser(${idx})">Remove</button>
        </div>
      </div>
      <div class="access-perms-grid" style="${isCustom ? '' : 'display:none;'}">${cells}</div>
    </div>`;
  }).join('');
  // Wire each row's access-level selector.
  el.querySelectorAll('.access-level').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = Number(sel.dataset.row);
      const val = sel.value;
      const card = el.querySelector(`.access-user-card[data-row="${idx}"]`);
      const grid = card && card.querySelector('.access-perms-grid');
      if (val === '__custom__') { if (grid) grid.style.display = ''; return; }
      // One level for all sections: update cache + every per-section dropdown so a
      // later "Custom…" expand reflects the chosen level. readRowPermsFromDom reads
      // those dropdowns, so this is what gets saved.
      if (grid) grid.style.display = 'none';
      const u = accessCache.users[idx];
      if (u) { u.permissions = u.permissions || {}; SECTION_IDS.forEach(s => { u.permissions[s] = val; }); }
      el.querySelectorAll(`.access-cell[data-row="${idx}"]`).forEach(c => { c.value = val; });
    });
  });
}

// Read the current dropdown selections for a row from the DOM (captures the
// admin's edits before saving).
function readRowPermsFromDom(idx) {
  const perms = {};
  SECTION_IDS.forEach(s => {
    const sel = document.querySelector(`.access-cell[data-row="${idx}"][data-sec="${s}"]`);
    perms[s] = sel ? sel.value : '';
  });
  return perms;
}

function saveAccessRow(email, perms) {
  const fd = new FormData();
  fd.append('action', 'saveACL');
  fd.append('email', email);
  fd.append('permissions', JSON.stringify(perms));
  fd.append('mode', 'upsert');
  return fetch(CONFIG.GAS_URL, { method: 'POST', body: fd }).then(r => r.json());
}

function addAccessUser() {
  const inp = document.getElementById('access-new-email');
  const email = (inp?.value || '').trim().toLowerCase();
  if (!email.endsWith('@' + CONFIG.ALLOWED_DOMAIN)) { showToast('Enter a valid @' + CONFIG.ALLOWED_DOMAIN + ' email'); return; }
  if (accessCache.users.some(u => u.email === email)) { showToast('That user is already listed'); return; }
  const perms = {}; SECTION_IDS.forEach(s => { perms[s] = ''; });
  accessCache.users.push({ email, permissions: perms });
  inp.value = '';
  // Render the new row locally WITHOUT reloading from the server — a reload
  // would wipe any unsaved dropdown edits the admin made in other rows. The
  // new user is persisted on "Save all changes" (or immediately below).
  renderAccessUsers();
  saveAccessRow(email, perms).then(d => {
    showToast(d && d.status === 'ok' ? 'Added ' + email + ' — set permissions, then Save all changes' : 'Add pending: ' + ((d && d.message) || 'will save with Save all'));
  });
}

function removeAccessUser(idx) {
  const u = accessCache.users[idx];
  if (!u) return;
  if (!confirm('Remove access for ' + u.email + '?')) return;
  // Remove locally + re-render (no server reload, which would wipe unsaved
  // edits in other rows). The delete is persisted immediately below.
  accessCache.users.splice(idx, 1);
  renderAccessUsers();
  const fd = new FormData();
  fd.append('action', 'saveACL');
  fd.append('email', u.email);
  fd.append('mode', 'remove');
  fetch(CONFIG.GAS_URL, { method: 'POST', body: fd }).then(r => r.json()).then(d => {
    showToast(d && d.status === 'ok' ? 'Removed ' + u.email : 'Remove pending: ' + ((d && d.message) || 'will clear on next reload'));
  });
}

function saveAllAccess() {
  const users = accessCache.users || [];
  let done = 0, failed = 0;
  const total = users.length;
  if (!total) { showToast('Nothing to save'); return; }
  const btn = document.getElementById('access-save-all');
  btn.disabled = true; btn.textContent = 'Saving…';
  Promise.all(users.map((u, idx) => saveAccessRow(u.email, readRowPermsFromDom(idx))
    .then(d => { if (d && d.status === 'ok') done++; else failed++; })
    .catch(() => failed++)
  )).then(() => {
    btn.disabled = false; btn.textContent = '💾 Save all changes';
    showToast(failed ? `Saved ${done}, ${failed} failed` : `Saved access for ${done} user${done === 1 ? '' : 's'}`);
    loadAccessData();
  });
}

function approveRequest(email) {
  // Approve with default View on every section — the admin can fine-tune in the
  // users table below. Keeps the request flow one click.
  const perms = {}; SECTION_IDS.forEach(s => { perms[s] = 'view'; });
  const fd = new FormData();
  fd.append('action', 'decideRequest');
  fd.append('email', email);
  fd.append('decision', 'approve');
  fd.append('permissions', JSON.stringify(perms));
  fetch(CONFIG.GAS_URL, { method: 'POST', body: fd }).then(r => r.json()).then(d => {
    showToast(d && d.status === 'ok' ? `Approved ${email} — default View access. Adjust below.` : 'Approve failed: ' + ((d && d.message) || 'error'));
    loadAccessData();
  });
}
function rejectRequest(email) {
  if (!confirm('Reject access request from ' + email + '?')) return;
  const fd = new FormData();
  fd.append('action', 'decideRequest');
  fd.append('email', email);
  fd.append('decision', 'reject');
  fetch(CONFIG.GAS_URL, { method: 'POST', body: fd }).then(r => r.json()).then(d => {
    showToast(d && d.status === 'ok' ? `Rejected ${email}` : 'Reject failed: ' + ((d && d.message) || 'error'));
    loadAccessData();
  });
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
      ${isAdmin() ? '<button class="signout-btn" id="access-admin-btn">👥 User Access &amp; Requests</button>' : ''}
      <button class="signout-btn" id="signout-btn">Sign Out</button>
    `;
    document.body.appendChild(menu);
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
      fetch(CONFIG.GAS_URL, { method: 'POST', body: fd }).catch(() => {});
    } catch { /* non-fatal */ }
  }
  try {
    sessionStorage.removeItem('ipb_user');
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('ipb_user');   // clear any legacy persistent profile
  } catch { }
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
// raised the IR and the ticket has never shown it — only the date. Falls back to
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
// the status are the ticket's identity and its workflow, and priority is
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
    // values only: a column that exists but is blank for this ticket would just
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
  setSyncStatus('⟳ Syncing with the IR Repository…');

  // 1. Primary: read the sheet directly (no backend deploy needed)
  try {
    const records = await fetchIRsFromSheet();
    if (records && records.length) {
      setAllIRs(records);
      _lastSyncAt = new Date();
      setSyncStatus(`✓ ${allIRs.length} tickets loaded from the Sheet`);
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
      _lastSyncAt = new Date();
      setSyncStatus(`✓ ${allIRs.length} tickets loaded`);
      renderIRList(allIRs);
      return;
    }
    throw new Error(data.message || 'Unknown error');
  } catch (err) {
    setSyncStatus('⚠ Could not sync — showing demo data');
    // Demo mode: render sample cards so UI is visible
    setAllIRs(getDemoIRs());
    renderIRList(allIRs);
  }
}

// Manual re-read of the ticket list + app-owned state. Staff should never have
// to wonder whether what they are looking at is stale — this is the answer.
let _refreshing = false;
async function refreshIRList() {
  if (_refreshing) return;
  _refreshing = true;
  try {
    await fetchIRs();
    await loadIRState();
    // A ticket can be open while the list refreshes. Adopt the freshly-read
    // record so the banner and the client report stop showing stale Sheet data —
    // app-owned fields are already merged onto it by setAllIRs(). If the ticket
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
    `<button type="button" class="sync-refresh" onclick="refreshIRList()" title="Re-read the ticket list from the Sheet">↻ Refresh</button>`;
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
  // keep latest-first ordering by IR number
  allIRs.sort((a, b) => parseInt((b.irNumber || '').replace(/\D/g, ''), 10) - parseInt((a.irNumber || '').replace(/\D/g, ''), 10));
}

function renderIRList(records) {
  renderSegments();
  if (!records || records.length === 0) {
    irList.innerHTML = allIRs.length
      ? '<div class="empty-state"><span>🔍</span>No IRs match this filter.</div>'
      : '<div class="empty-state"><span>📭</span>No IRs found. Create one via the customer form.</div>';
    updateListCounts(0);
    return;
  }

  irList.innerHTML = records.map(ir => {
    const owner = ir.assigneeName || ir.assignee || '';
    return `
    <div class="ir-card animate-slide-up${currentView === 'detail' && currentIR?.irNumber === ir.irNumber ? ' is-selected' : ''}" data-id="${ir.irNumber}" onclick="goTicket('${ir.irNumber}')">
      ${owner ? `<span class="assignee-avatar" title="Assigned to ${escHtml(owner)}">${escHtml(initialsOf(owner))}</span>` : ''}
      <div class="ir-card-main">
        <div class="ir-title">${ir.irNumber}</div>
        <div class="ir-meta">
          <span class="ir-sn">${ir.droneId || ''}</span>
          ${ir.type ? `<span class="ir-dot">·</span><span class="ir-type">${escHtml(ir.type)}</span>` : ''}
          ${ir.dateRaised ? `<span class="ir-dot">·</span><span class="ir-date">${ir.dateRaised}</span>` : ''}
        </div>
      </div>
      <div class="ir-card-side">
        ${legacyMap[ir.irNumber] ? `<span class="badge badge-legacy" title="Recorded in the legacy I-PASSBOOK">Legacy</span>` : ''}
        ${ir.priority ? `<span class="prio prio-${String(ir.priority).toLowerCase()}">${ir.priority}</span>` : ''}
        <span class="${getBadgeClass(ir.status)}">${ir.status || 'Open'}</span>
        ${ir.summaryLink ? `<a href="${ir.summaryLink}" class="ir-summary-link" onclick="event.stopPropagation()" target="_blank" rel="noopener">View Summary ↗</a>` : ''}
      </div>
    </div>
  `;
  }).join('');
  updateListCounts(records.length);
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

// The one place the search box and the segment strip combine into a filter.
function applyListFilters() {
  const q = (searchInput.value || '').toLowerCase().trim();
  let rows = allIRs;
  if (activeSegment !== 'all') rows = rows.filter(ir => statusCategory(ir.status) === activeSegment);
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

// ─── PASSBOOK DETAIL ─────────────────────────────────────────────────────────
async function openPassbook(irNumber) {
  // Sequence token: a fast second open (list clicks, a hash change) must not let
  // the slower first one finish and paint over it.
  const seq = ++_openSeq;

  currentIR = allIRs.find(ir => ir.irNumber === irNumber) || { irNumber };
  esignatureState = {};   // clear signatures from any previously-open IR
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
      currentIR.type = st.type || '';
      currentIR.done = Array.isArray(st.done) ? st.done : [];
    }
    renderBannerMeta();
    // First sight of this ticket: record that the app has seen it. Deliberately
    // does NOT claim ownership of the status — see seedIRState.
    seedIRState(irNumber);
  }

  currentView = 'detail';
  renderLayout();
  headerTitle.textContent = irNumber;

  // Build all section forms
  buildSectionForms(irNumber);

  // The client's original report. Read-only and Sheet-only, so it needs no
  // reload after a section save — only after the ticket itself changes.
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
    body.innerHTML = '<p class="intake-audit">No ticket selected.</p>';
    return;
  }

  // `intake` holds the raw cells for a Sheet-sourced ticket. Legacy and demo
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
  // this ticket — named so the gap is visible rather than assumed away.
  const unmapped = (lastSheetAudit.unmapped || [])
    .filter(h => !extras.some(x => x.label === h));
  const auditNote = unmapped.length
    ? `<p class="intake-audit">The client's form also writes ${unmapped.map(escHtml).join(', ')} — empty on this ticket.</p>`
    : '';
  const noSheetNote = ir.intake
    ? ''
    : `<p class="intake-audit">No Sheet row for this ticket — showing only the fields the app holds. ` +
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

// The banner's triage line. All four values are app-owned (`__IRS__`); the Sheet
// only supplies the status a ticket starts life with.
function renderBannerMeta() {
  if (!bannerPills || !currentIR) return;
  const ir    = currentIR;
  const owner = ir.assigneeName || ir.assignee || '';
  const canTriage = canEditSection('sec-a');
  bannerPills.innerHTML =
    `<span class="${getBadgeClass(ir.status)}">${escHtml(ir.status || 'Open')}</span>` +
    (ir.priority ? `<span class="prio prio-${String(ir.priority).toLowerCase()}">${escHtml(ir.priority)}</span>` : '') +
    (ir.type ? `<span class="meta-pill">${escHtml(ir.type)}</span>` : '') +
    (owner
      ? `<span class="meta-pill meta-owner" title="Assigned to ${escHtml(ir.assignee || owner)}">👤 ${escHtml(owner)}</span>`
      : `<span class="meta-pill meta-unassigned">Unassigned</span>`);
  const triageBtn = document.getElementById('ir-triage-btn');
  if (triageBtn) triageBtn.style.display = canTriage ? '' : 'none';
}

// ─── TRIAGE MODAL (status / assignee / priority / type) ──────────────────────
// Writes to `__IRS__` — the app's own record — and never touches the client's
// Sheet, which keeps the customer's original report intact. Reuses the
// full-screen modal pattern of the team-directory editor so it works at phone
// width without a new layout.
function openTriageModal() {
  if (!currentIR) return;
  if (!canEditSection('sec-a')) { showToast('You do not have edit access to triage tickets'); return; }
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
        <label class="triage-row"><span>Type</span>
          <select class="form-input" id="triage-type">
            <option value="">— None —</option>${TICKET_TYPES.map(v => opt(v, ir.type || '')).join('')}
          </select>
        </label>
      </div>
      <div class="inward-options-foot">
        <button type="button" class="btn" onclick="closeTriageModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="applyTriage()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}
function closeTriageModal() { document.getElementById('triage-modal')?.remove(); }

async function applyTriage() {
  if (!currentIR) return;
  const irNumber = currentIR.irNumber;
  const status   = document.getElementById('triage-status')?.value     || '';
  const email    = document.getElementById('triage-assignee')?.value   || '';
  const priority = document.getElementById('triage-priority')?.value   || '';
  const type     = document.getElementById('triage-type')?.value       || '';
  const prev     = String(currentIR.assignee || '').toLowerCase();
  const member   = teamDirectory.find(d => String(d.email).toLowerCase() === email.toLowerCase());

  const patch = { status, statusOwned: true, assignee: email, assigneeName: member ? (member.name || email) : '', priority, type };
  // Only a real status CHANGE moves the clock. Re-saving the same status must
  // not reset time-in-status, or every triage edit would fake a fresh ticket.
  if (status && status !== currentIR.status) {
    patch.statusAt = Date.now();
    patch.statusBy = myEmail() || 'unknown';
  }
  closeTriageModal();
  await patchIRState(irNumber, patch);
  showToast('Triage saved');

  // Assignment notifies through the comment machinery already in place — the
  // bell, the unread badge, the 90s poll and the email all work unchanged.
  // Known wart: the email's subject is hardcoded to comment wording in
  // backend.gs, so an assignment notification reads as a comment.
  if (email && email.toLowerCase() !== prev) {
    const n = {
      id: nudgeId(), irNumber, scope: 'section', sectionId: 'sec-a', fieldId: 'a_overallStatus',
      sectionLabel: 'A: Preliminary', fieldLabel: 'IR Status',
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

// Open a full-screen, read-only embed of the IR's legacy I-PASSBOOK tab. The
// sheet itself is shown via Google's preview endpoint (no editing UI); a link
// to open it directly in Google Sheets is provided as a fallback.
function openLegacyModal(embedUrl, label, openUrl) {
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
        <iframe src="${embedUrl}" class="legacy-frame" title="Legacy record ${escHtml(label || '')}" referrerpolicy="no-referrer" loading="lazy"></iframe>
        <div class="legacy-fallback">
          <span>Can't see the record here?</span>
          <a href="${openUrl}" target="_blank" rel="noopener" class="url-open-btn">Open in Google Sheets ↗</a>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeLegacyModal(); });
}

function closeLegacyModal() {
  const m = document.getElementById('legacy-modal');
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

// Back button (mobile only — the desktop split pane keeps the list on screen)
backBtn.addEventListener('click', goIndex);

// IR banner nudge / comments button
const irNudgeBtn = document.getElementById('ir-nudge-btn');
if (irNudgeBtn) irNudgeBtn.addEventListener('click', openNudgeModalForIR);
// IR banner audit-trail / history button
const irHistoryBtn = document.getElementById('ir-history-btn');
if (irHistoryBtn) irHistoryBtn.addEventListener('click', openHistoryModal);
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
  if (sec) saveDraft(sec.id);
});

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
const SECTIONS = {
  'sec-a': {
    title: 'Section A — Preliminary Details & Activity Log',
    fields: [
      // ── Locked intake fields: auto-populated from the customer IR form,
      //    read-only for EVERYONE (no one edits these — they're the form's record).
      { id: 'a_irNumber',      label: 'IR Number',                    type: 'text',     readonly: true, locked: true },
      { id: 'a_droneId',       label: 'Drone Serial No.',             type: 'text',     readonly: true, locked: true },
      { id: 'a_dateRaised',    label: 'Date of Incident',             type: 'date',     readonly: true, locked: true },
      { id: 'a_companyName',   label: 'Company Name',                type: 'text',     readonly: true, locked: true },
      { id: 'a_customerName',  label: 'Respondant Name',             type: 'text',     readonly: true, locked: true },
      { id: 'a_contactEmail',  label: 'Respondant Email',            type: 'email',    readonly: true, locked: true },
      { id: 'a_issueType',     label: 'What Support Is Required?',    type: 'text',     readonly: true, locked: true },
      { id: 'a_issueDesc',     label: 'Issue Description',            type: 'textarea', readonly: true, locked: true },
      { id: 'a_incidentLocationWeather', label: 'Incident Location and Weather', type: 'textarea', readonly: true, locked: true },
      { id: 'a_evidence',      label: 'Evidence (from customer form)', type: 'readonlyLinks', locked: true },
      // ── Editable (governed by Section A edit permission): CRM fills these.
      { id: 'a_crmOwner',      label: 'Customer Relations Manager',  type: 'text',     placeholder: 'Name of CRM person' },
      { id: 'a_contactPhone',  label: 'Customer Phone',              type: 'tel',      placeholder: '+91 XXXXX XXXXX' },
      { id: 'a_activityLog',   label: 'Activity Log (Timeline)',     type: 'activityTable' },
      { id: 'a_overallStatus', label: 'IR Status',                    type: 'select',   options: IR_STATUS_VALUES },
    ]
  },
  'sec-b': {
    title: 'Section B — Inward Checklist (Inventory)',
    fields: [
      { id: 'b_inwardDate', label: 'Inward Date',  type: 'date' },
      { id: 'b_inwardBy',   label: 'Inward By (Name)', type: 'text', placeholder: 'Person who performed the inward' },
      { id: 'b_stNo',       label: 'Stock Transfer (ST) No.', type: 'text', placeholder: 'ST number assigned by Inventory' },
      { id: 'b_inwardTable', label: 'Particulars Received', type: 'inwardTable' },
      { id: 'b_remarks',    label: 'Remarks', type: 'textarea', placeholder: 'Condition at receiving, missing items, observations, etc.' },
      { id: 'b_signInward',    label: 'Digital Signature — Inward Performed By',  type: 'esignature', role: 'Inward Performed By' },
      { id: 'b_signInventory', label: 'Digital Signature — Inventory (ST No. Assigner)', type: 'esignature', role: 'Inventory (ST No. Assigner)' },
    ]
  },
  'sec-c': {
    title: 'Section C — IQC Visual Inspection',
    fields: [
      { id: 'c_iqcDate',      label: 'Inspection Date', type: 'date' },
      { id: 'c_iqcBy',        label: 'Inspected By',    type: 'text', placeholder: 'IQC inspector name' },
      { id: 'c_evidenceLink', label: 'Link to Evidence (Photo / Video) Folder', type: 'url', placeholder: 'Paste folder link...' },
      { id: 'c_iqcTable',     label: 'Visual Inspection Checklist', type: 'iqcTable' },
      { id: 'c_remarks',      label: 'Remarks', type: 'textarea', placeholder: 'Overall inspection remarks, observations, summary...' },
      { id: 'c_signIqc',      label: 'Digital Signature — IQC Inspector', type: 'esignature', role: 'IQC Inspector' },
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
      { id: 'd_signQcManager',  label: 'Digital Signature — Technical Support (QC Manager)', type: 'esignature', role: 'Technical Support (QC Manager)' },

      // ── Part B — Cost Analysis (Repair Estimate & Lead Time) ──
      { id: 'd_partB',              label: 'Part B — Cost Analysis (Repair Estimate &amp; Lead Time)', type: 'divider' },
      { id: 'd_warrantyQualified',  label: 'Is This Repair Qualified For Cover Under Warranty? (Yes/No)', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'd_repairTable',        label: 'Particulars For Repair / Replace', type: 'costTable' },
      { id: 'd_leadTime',           label: 'Estimated Lead Time', type: 'text', placeholder: 'e.g. 7–10 working days' },
      { id: 'd_goAhead',            label: 'Received Go Ahead By The Customer?', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'd_signPurchaseManager', label: 'Digital Signature — Purchase Manager', type: 'esignature', role: 'Purchase Manager' },
    ]
  },
  'sec-e': {
    title: 'Section E — Production (Rework)',
    fields: [
      { id: 'e_prodDocs',     label: 'Route Card / Job Card (Image or PDF)', type: 'imageEvidence' },
      { id: 'e_prodRemarks',  label: 'Rework Details / Remarks',    type: 'textarea', placeholder: 'Describe the rework performed, observations, notes for QC...' },
      { id: 'e_signProduction', label: 'Digital Signature — Production Technician', type: 'esignature', role: 'Production Technician' },
    ]
  },
  'sec-f': {
    title: 'Section F — Quality Control (QC)',
    fields: [
      { id: 'f_qcDocs',       label: 'QC Report (Image or PDF)', type: 'imageEvidence' },
      { id: 'f_qcRemarks',    label: 'QC Remarks',        type: 'textarea', placeholder: 'Additional observations...' },
      { id: 'f_signQc',       label: 'Digital Signature — QC Inspector', type: 'esignature', role: 'QC Inspector' },
    ]
  },
  'sec-g': {
    title: 'Section G — Flight Test',
    fields: [
      { id: 'g_basicReport',   label: 'Basic Flight Test Report (Image or PDF)',    type: 'imageEvidence' },
      { id: 'g_missionReport', label: 'Mission Flight Test Report (Image or PDF)', type: 'imageEvidence' },
      { id: 'g_flightLogs',     label: 'Data Check — Flight Logs',     type: 'checkpointEvidence', tickLabel: 'Flight Logs data check performed & verified' },
      { id: 'g_postProcessing', label: 'Data Check — Post-Processing', type: 'checkpointEvidence', tickLabel: 'Post-processing data check performed & verified' },
      { id: 'g_dataCheckRemarks', label: 'Data Check Remarks', type: 'textarea', placeholder: 'Notes on flight logs / post-processing checks...' },
      { id: 'g_signPilot',    label: 'Digital Signature — Test Pilot', type: 'esignature', role: 'Test Pilot' },
    ]
  },
  'sec-h': {
    title: 'Section H — Pre-Delivery Inspection (PDI)',
    fields: [
      { id: 'h_pdiDocs',     label: 'PDI Report (Image or PDF)', type: 'imageEvidence' },
      { id: 'h_pdiRemarks',  label: 'PDI Remarks',         type: 'textarea', placeholder: 'Packing instructions, special notes...' },
      { id: 'h_dispatchChecklist', label: 'Cross Check Particulars — received (Section B) vs packed for dispatch', type: 'dispatchChecklist' },
      { id: 'h_pdiResult',   label: 'PDI Result',          type: 'select', options: ['Pass – Ready to Dispatch','Fail – Return to QC'] },
      { id: 'h_signPdi',     label: 'Digital Signature — PDI Inspector', type: 'esignature', role: 'PDI Inspector' },
    ]
  },
  'sec-i': {
    title: 'Section I — Logistics & Dispatch',
    fields: [
      { id: 'i_dispatchDate', label: 'Dispatch Date',      type: 'date' },
      { id: 'i_courier',      label: 'Courier / Transporter', type: 'courierName', default: 'Bluedart' },
      { id: 'i_courierTrackId', label: 'Courier Tracking ID', type: 'text', placeholder: 'AWB / docket / tracking number' },
      { id: 'i_clientReceivedDate', label: 'Client Received the Courier Date', type: 'date' },
      { id: 'i_dispatchPhotos', label: 'Attachments (Image or PDF)', type: 'imageEvidence' },
      { id: 'i_remarks',      label: 'Logistics Remarks',  type: 'textarea', placeholder: 'Special instructions, insurance, etc.' },
    ]
  },
};

function buildSectionForms(irNumber) {
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

  // Wire Section A top save button (duplicate of bottom)
  const btnTopA = document.getElementById('save-sec-a-top');
  if (btnTopA) btnTopA.onclick = () => saveSection('sec-a', irNumber);

  // Wire Section D Part A PDF download
  const dlD = document.getElementById('download-sec-d');
  if (dlD) dlD.onclick = () => downloadSectionDPartA();

  // Inject a 💬 nudge button after each section title (per-section tagging)
  Object.keys(SECTIONS).forEach(secId => {
    const sec = document.getElementById(secId);
    if (!sec || sec.querySelector('.sec-nudge-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sec-nudge-btn';
    btn.dataset.sectionId = secId;
    btn.innerHTML = '💬<span class="comment-count" style="display:none;">0</span>';
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
        if (el.type === 'file') { el.disabled = true; return; }
        // Don't disable the section's comment button if the user can comment.
        if (el.classList.contains('field-nudge-btn') && comment) return;
        if (el.classList.contains('btn-add-row') || el.classList.contains('btn-esign') ||
            el.classList.contains('btn-add-evidence') || el.classList.contains('field-nudge-btn')) {
          if (!comment) { el.disabled = true; el.style.opacity = '0.5'; el.style.cursor = 'not-allowed'; }
          return;
        }
        el.disabled = true;
      });
    }

    // Section 💬 comment button visibility
    const secNudge = pane.querySelector('.sec-nudge-btn');
    if (secNudge) secNudge.style.display = comment ? '' : 'none';
    // Field 💬 buttons
    pane.querySelectorAll('.field-nudge-btn').forEach(b => { b.style.display = comment ? '' : 'none'; });
  });
}

function buildField(field, irNumber, sectionId) {
  const id = field.id;
  let control = '';

  // Auto-fill values from the current IR (Form Responses data).
  // Shared across textarea / url / text / date / email / tel controls.
  const autoFill = {
    'a_irNumber':      currentIR?.irNumber || '',
    'a_droneId':       currentIR?.droneId || '',
    'a_dateRaised':    toISODate(currentIR?.incidentDate || currentIR?.dateRaised),
    'a_crmOwner':      currentIR?.spoc || '',
    'a_customerName':  currentIR?.customerName || '',
    'a_contactEmail':  currentIR?.contactEmail || '',
    'a_contactPhone':  currentIR?.contactPhone || '',
    'a_issueType':     currentIR?.issueType || '',
    'a_issueDesc':     currentIR?.issueDesc || '',
    'a_overallStatus': currentIR?.status || currentIR?.initialStatus || '',
    // Locked intake fields sourced from the customer form (cols M/N+Q/R):
    'a_companyName':              currentIR?.companyName || '',
    'a_incidentLocationWeather':  currentIR?.incidentLocationWeather || '',
    'a_evidence':                 [currentIR?.evidenceFormN, currentIR?.evidenceFormQ].filter(Boolean).join('\n'),
  };
  const val = autoFill[field.id] !== undefined ? autoFill[field.id] : '';
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
      <div class="file-upload-wrapper" onclick="document.getElementById('${id}').click()">
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
  } else if (field.type === 'activityTable') {
    const initialRows = 5;
    const defaultDate = toISODate(currentIR?.dateRaised);
    let rowsHtml = '';
    // First row: pre-filled with "IR Reported" and the date
    rowsHtml += buildActivityRow(1, defaultDate, 'IR Reported');
    for (let i = 2; i <= initialRows; i++) {
      rowsHtml += buildActivityRow(i, '');
    }
    control = `
      <div class="activity-table-wrapper" id="${id}">
        <div class="activity-table-header">
          <span class="act-col-day">#</span>
          <span class="act-col-date">Date</span>
          <span class="act-col-activity">Activity Description</span>
          <span class="act-col-remark">Remark</span>
        </div>
        <div class="activity-table-body" id="${id}-body">
          ${rowsHtml}
        </div>
        <button type="button" class="btn-add-row" onclick="addActivityRow('${id}')">+ Add Row</button>
      </div>
    `;
  } else if (field.type === 'costTable') {
    // Repair/Replace estimate table mirroring the I-PASSBOOK sheet Section D Part B:
    // columns Particulars | Qty | Rate | Cost (auto = Qty*Rate) | Remark, plus a total.
    const initialRows = 3;
    let rowsHtml = '';
    for (let i = 1; i <= initialRows; i++) rowsHtml += buildCostRow(i);
    control = `
      <div class="cost-table-wrapper" id="${id}">
        <div class="cost-table-header">
          <span class="cost-sn">#</span>
          <span class="cost-particular">Particulars For Repair / Replace</span>
          <span class="cost-qty">Qty</span>
          <span class="cost-rate">Rate</span>
          <span class="cost-cost">Cost</span>
          <span class="cost-remark">Remark</span>
          <span class="cost-del-h"></span>
        </div>
        <div class="cost-table-body" id="${id}-body">${rowsHtml}</div>
        <button type="button" class="btn-add-row" onclick="addCostRow('${id}')">+ Add Row</button>
        <div class="cost-total">Total Repair Cost: ₹<span id="${id}-total">0.00</span></div>
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
  } else if (field.type === 'esignature') {
    control = `<div class="esignature-block" id="${id}-block" data-field="${id}" data-role="${esc(field.role || '')}">${renderESignatureHTML(id, field.role || '')}</div>`;
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
          <button type="button" class="btn-add-evidence" onclick="addEvidenceImage('${id}')">+ Add image / PDF</button>
          <button type="button" class="btn-add-evidence" onclick="captureEvidenceImage('${id}')">📷 Capture photo</button>
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
            <button type="button" class="btn-add-evidence" onclick="addEvidenceImage('${escHtml(attachId)}')">+ Add image / PDF</button>
            <button type="button" class="btn-add-evidence" onclick="captureEvidenceImage('${escHtml(attachId)}')">📷 Capture photo</button>
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
    ? `<button type="button" class="field-nudge-btn" data-field-id="${escHtml(id)}" title="Comments on this field" onclick="openNudgeModalForField('${escHtml(id)}')">💬<span class="comment-count" style="display:none;">0</span></button>`
    : '';
  const labelHtml = field.label
    ? `<label class="form-label${locked ? ' field-locked-label' : ''}" for="${id}">${field.label}${lockIcon}${fieldNudgeBtn}</label>`
    : (fieldNudgeBtn ? `<div class="form-label">${fieldNudgeBtn}</div>` : '');

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

function buildActivityRow(dayCount, dateValue, activityValue) {
  return `
    <div class="activity-table-row">
      <input type="number" class="form-input act-day" value="${dayCount}" readonly />
      <input type="date" class="form-input act-date" value="${dateValue}" />
      <input type="text" class="form-input act-activity" placeholder="Activity..." value="${activityValue || ''}" />
      <input type="text" class="form-input act-remark" placeholder="Remark..." />
    </div>
  `;
}

function addActivityRow(fieldId) {
  const body = document.getElementById(fieldId + '-body');
  if (!body) return;
  const existingRows = body.querySelectorAll('.activity-table-row');
  const nextDay = existingRows.length > 0
    ? parseInt(existingRows[existingRows.length - 1].querySelector('.act-day').value || '0') + 1
    : 1;
  body.insertAdjacentHTML('beforeend', buildActivityRow(nextDay, ''));
  const lastRow = body.lastElementChild;
  if (lastRow) lastRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── COST TABLE (Section D Part B) ────────────────────────────────────────────
// Repair/Replace estimate rows: Particulars | Qty | Rate | Cost (auto) | Remark.
// Cost per row = Qty × Rate; a running total is shown under the table.

function buildCostRow(sn) {
  const escSn = (sn == null ? '' : sn);
  return `
    <div class="cost-table-row">
      <input type="number" class="form-input cost-sn" value="${escSn}" readonly />
      <input type="text"   class="form-input cost-particular" placeholder="Particular..." />
      <input type="number" class="form-input cost-qty" placeholder="0" min="0" step="any" oninput="recalcCostRow(this)" />
      <input type="number" class="form-input cost-rate" placeholder="0.00" min="0" step="any" oninput="recalcCostRow(this)" />
      <input type="text"   class="form-input cost-cost" readonly />
      <input type="text"   class="form-input cost-remark" placeholder="Remark..." />
      <button type="button" class="cost-del" onclick="removeCostRow(this)" title="Remove row">&#10005;</button>
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

// ─── E-SIGNATURE (Section B) ───────────────────────────────────────────────────
// Captures the signed-in user's email + full timestamp. Once signed, the cell
// is locked (not editable, not deletable). An authorized user may override
// (re-sign); each prior value is retained in `history` and shown on hover.

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderESignatureHTML(fieldId, role) {
  const sig = esignatureState[fieldId];
  const email = currentUser?.email || '';
  const history = (sig && sig.history) ? sig.history : [];
  const historyLines = history.map(h => `• ${escHtml(h.signedBy)} — ${escHtml(formatTimestamp(h.signedAt))}`).join('<br>');
  const historyTitle = historyLines
    ? `Edit history (hover):&#10;${history.map(h => `${h.signedBy} — ${formatTimestamp(h.signedAt)}`).join('\n')}`
    : '';

  if (sig && sig.signedBy) {
    const canOverride = isAdmin() || sig.signedBy === email;
    const overrideBtn = canOverride
      ? `<button type="button" class="btn-esign btn-esign-override" onclick="signESignature('${fieldId}')">Override &amp; Re-sign</button>`
      : '';
    return `
      <div class="esignature-signed" title="${escHtml(historyTitle)}">
        <div class="esignature-row">
          <span class="esignature-check">&#10003;</span>
          <div class="esignature-info">
            <div class="esignature-line">${escHtml(role)} — signed by <strong>${escHtml(sig.signedBy)}</strong></div>
            <div class="esignature-stamp">${escHtml(formatTimestamp(sig.signedAt))}</div>
          </div>
        </div>
        ${historyLines ? `<div class="esignature-history"><span class="esignature-history-label">Edit history:</span><br>${historyLines}</div>` : ''}
        ${overrideBtn}
      </div>`;
  }
  // Unsigned
  const signBtn = email
    ? `<button type="button" class="btn-esign btn-esign-sign" onclick="signESignature('${fieldId}')">Sign as ${escHtml(email)}</button>`
    : `<span class="esignature-muted">Sign in to sign.</span>`;
  return `<div class="esignature-unsigned"><span class="esignature-role">${escHtml(role)}</span>${signBtn}</div>`;
}

function refreshESignature(fieldId) {
  const block = document.getElementById(fieldId + '-block');
  if (block) block.innerHTML = renderESignatureHTML(fieldId, block.dataset.role || '');
}

// Sign (or override-and-resign) the given e-signature field.
function signESignature(fieldId) {
  const email = currentUser?.email;
  if (!email) { showToast('Sign in first'); return; }
  const prev = esignatureState[fieldId];
  const history = (prev && prev.signedBy)
    ? [...(prev.history || []), { signedBy: prev.signedBy, signedAt: prev.signedAt }]
    : (prev?.history || []);
  esignatureState[fieldId] = { signedBy: email, signedAt: new Date().toISOString(), history };
  refreshESignature(fieldId);
  // Persist the signature as a draft so it survives even if the section isn't saved
  const secId = sectionIdFromFieldId(fieldId);
  if (secId) saveDraft(secId);
  showToast('Signed: ' + email);
}

// ─── INWARD DROPDOWN OPTIONS (admin-customizable) ──────────────────────────────
// Persisted to GAS under irNumber="__CONFIG__", sectionId="inward-options"
// (best-effort) and mirrored to localStorage so edits survive when GAS is
// unreachable. Falls back to INWARD_OPTIONS_DEFAULTS on load.

function loadInwardOptions() {
  // 1. localStorage override (per-device, always available)
  try {
    const local = localStorage.getItem('ipb_inward_options');
    if (local) inwardOptions = Object.assign({}, INWARD_OPTIONS_DEFAULTS, JSON.parse(local));
  } catch {}
  // 2. Shared config from GAS (best-effort, non-blocking)
  loadSentinel('__CONFIG__', 'inward-options')
    .then(saved => {
      if (saved && saved.options && typeof saved.options === 'object') {
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
  try {
    const local = localStorage.getItem('ipb_iqc_config');
    if (local) {
      const cfg = JSON.parse(local);
      if (Array.isArray(cfg.zones)) iqcZones = cfg.zones;
      if (Array.isArray(cfg.resultOptions)) iqcResultOptions = cfg.resultOptions;
    }
  } catch {}
  loadSentinel('__CONFIG__', 'iqc-config')
    .then(saved => {
      if (!saved) return;
      if (Array.isArray(saved.zones)) iqcZones = saved.zones;
      if (Array.isArray(saved.resultOptions)) iqcResultOptions = saved.resultOptions;
      try { localStorage.setItem('ipb_iqc_config', JSON.stringify({ zones: iqcZones, resultOptions: iqcResultOptions })); } catch {}
      reRenderIqcTables();
    });
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

function populateFieldValue(sectionId, fieldId, value, isDraft = false) {
  const section = SECTIONS[sectionId];
  const field = section?.fields.find(f => f.id === fieldId);

  // analysisNote is a read-only display line built from currentIR — nothing to populate.
  if (field?.type === 'analysisNote') return;
  // divider is a static sub-heading — no value to populate.
  if (field?.type === 'divider') return;

  // Handle imageEvidence type — value is [{caption, link, type, name}]
  if (field?.type === 'imageEvidence') {
    let arr = Array.isArray(value) ? value : [];
    // When loading SAVED data, captions saved with empty links (pending upload at
    // last save) get their Drive URLs merged in from '<fieldId>_links'. Skip this
    // for drafts: a draft's empty link means a not-yet-uploaded image, which must
    // NOT pick up a Drive URL belonging to a different (saved) entry.
    if (!isDraft) {
      const linksRaw = currentSectionData?.[sectionId]?.[fieldId + '_links'];
      if (linksRaw) {
        const links = String(linksRaw).split(',').map(s => s.trim()).filter(Boolean);
        let li = 0;
        arr = arr.map(e => {
          if (!e.link && li < links.length) return { caption: e.caption || '', link: links[li++], type: e.type || '', name: e.name || '' };
          return { caption: e.caption || '', link: e.link || '', type: e.type || '', name: e.name || '' };
        });
      }
      // Back-compat: fields migrated from the old `file` type stored only Drive
      // links in <fieldId>_links with no entry array. Seed one entry per link so
      // those uploads still preview after migration to imageEvidence.
      if (!arr.length) {
        const links = String(currentSectionData?.[sectionId]?.[fieldId + '_links'] || '').split(',').map(s => s.trim()).filter(Boolean);
        arr = links.map(l => ({ caption: '', link: l, type: '', name: '' }));
      }
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

  // Handle esignature type — value is { signedBy, signedAt, history: [] }
  if (field?.type === 'esignature') {
    esignatureState[fieldId] = (value && typeof value === 'object') ? value : {};
    refreshESignature(fieldId);
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

  // Handle activityTable type
  if (field?.type === 'activityTable') {
    const body = document.getElementById(fieldId + '-body');
    if (!body) return;

    if (Array.isArray(value)) {
      // New format: array of row objects
      body.innerHTML = '';
      value.forEach((row, i) => {
        body.insertAdjacentHTML('beforeend', buildActivityRow(
          row.dayCount || (i + 1),
          row.date || ''
        ));
        const rows = body.querySelectorAll('.activity-table-row');
        const lastRow = rows[rows.length - 1];
        if (lastRow) {
          lastRow.querySelector('.act-activity').value = row.activity || '';
          lastRow.querySelector('.act-remark').value = row.remark || '';
        }
      });
    } else if (typeof value === 'string' && value.trim()) {
      // Backward compatibility: old textarea data
      const firstActivity = body.querySelector('.activity-table-row:first-child .act-activity');
      if (firstActivity) firstActivity.value = value;
    }
    return;
  }

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

// Collect all field values for a section from the DOM + esignatureState.
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
    } else if (field.type === 'activityTable') {
      const body = document.getElementById(field.id + '-body');
      const tableData = [];
      if (body) {
        body.querySelectorAll('.activity-table-row').forEach(row => {
          tableData.push({
            dayCount: row.querySelector('.act-day')?.value || '',
            date:     row.querySelector('.act-date')?.value || '',
            activity: row.querySelector('.act-activity')?.value || '',
            remark:   row.querySelector('.act-remark')?.value || '',
          });
        });
      }
      fieldValues[field.id] = tableData;
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
    } else if (field.type === 'esignature') {
      fieldValues[field.id] = esignatureState[field.id] || {};
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
  const letter = (fieldId || '').split('_')[0];     // 'a','b',...
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
  esignatureState = {};
  buildSectionForms(currentIR.irNumber);
  if (currentSectionData) {
    Object.entries(currentSectionData).forEach(([secId, fields]) => {
      Object.entries(fields).forEach(([fieldId, value]) => populateFieldValue(secId, fieldId, value));
    });
  }
  refreshDraftBanner();
  showToast('Drafts discarded — saved data restored');
}

async function saveSection(sectionId, irNumber) {
  const btn = document.getElementById('save-' + sectionId);
  const btnTop = document.getElementById('save-' + sectionId + '-top');
  const section = SECTIONS[sectionId];
  if (!section) return;

  const btnLabel = `Save Section ${sectionId.replace('sec-', '').toUpperCase()}`;
  btn.textContent = 'Saving…';
  btn.className = 'btn saving';
  if (btnTop) { btnTop.textContent = 'Saving…'; btnTop.className = 'btn saving'; }

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
        mimeType: files[idx].type,
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
      showToast('Section saved successfully!');
      // For sections with image evidence, pull the freshly-uploaded Drive URLs
      // back into the in-memory state so captions stay paired with images.
      refreshEvidenceLinksAfterSave(sectionId, irNumber);
      // Saving Section B changes the goods Section H verifies against — refresh
      // the dispatch checklist so it lists exactly what was received.
      if (sectionId === 'sec-b') renderDispatchChecklist('h_dispatchChecklist');
      // Record this save in the app-owned workflow state: Section A owns the
      // status, and every section save marks that section done for this IR.
      syncIRStateAfterSectionSave(sectionId, irNumber, fieldValues);
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
    btn.textContent = btnLabel;
    btn.className = 'btn';
    if (btnTop) { btnTop.textContent = btnLabel; btnTop.className = 'btn'; }
  }, 3000);
}

// A section save is the one place that knows an IR was actually touched, so it
// is where the app takes ownership of that ticket's workflow state.
function syncIRStateAfterSectionSave(sectionId, irNumber, fieldValues) {
  const patch = { done: markSectionDone(irNumber, sectionId) };
  // Section A carries the IR Status dropdown. Mirroring it into __IRS__ is what
  // makes an in-app status change reach the list badge: the badge reads app
  // state, and the Section A row in APP_DATA is not where the badge looks.
  if (sectionId === 'sec-a' && fieldValues && fieldValues.a_overallStatus) {
    const next = String(fieldValues.a_overallStatus).trim();
    const cur  = ownedStatus(irNumber) || currentIR?.status || '';
    if (next && next !== cur) {
      patch.status      = next;
      patch.statusOwned = true;
      patch.statusAt    = Date.now();
      patch.statusBy    = myEmail() || 'unknown';
    }
  }
  patchIRState(irNumber, patch);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
  });
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
  });
}

// ─── SECTION D — PART A PDF DOWNLOAD ──────────────────────────────────────────
// Builds a clean, client-facing printable document of the Investigation (Part A
// only) and opens the browser print dialog so it can be saved/shared as a PDF.
// Part B (Cost Analysis) is deliberately excluded.
async function downloadSectionDPartA() {
  const irNum  = currentIR?.irNumber || 'IR';
  const drone  = currentIR?.droneId  || '';
  const getVal = id => { const el = document.getElementById(id); return el ? (el.value || '') : ''; };
  const analysisBy   = getVal('d_analysisBy');
  const analysisDate = toDisplayDate(getVal('d_analysisDate'));
  const investigation = getVal('d_investigation');
  const rootCause     = getVal('d_rootCause');
  const corrective    = getVal('d_correctiveAction');
  const preventive    = getVal('d_preventiveAction');

  // Evidence images: uploaded images use their Drive URL; not-yet-saved images
  // are read as data URLs so they embed reliably in the printed document.
  const entries = evidenceState['d_evidence'] || [];
  const images = [];
  for (const e of entries) {
    if ((e.type || '') === 'pdf') continue;   // PDFs can't embed in the printed doc
    let src = e.link || '';
    if (!src && e.file) { try { src = await fileToDataUrl(e.file); } catch {} }
    if (src) images.push({ caption: e.caption || '', src });
  }

  const esc   = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nlbr  = s => esc(s).replace(/\n/g, '<br>');
  const para  = (label, val) => val && val.trim()
    ? `<h2>${esc(label)}</h2><div class="val">${nlbr(val)}</div>`
    : `<h2>${esc(label)}</h2><div class="val muted">—</div>`;
  const imgBlock = images.map(im => `
    <figure>
      <img src="${esc(im.src)}" />
      ${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}
    </figure>`).join('');

  // QC Manager sign-off — the Investigation (Part A) authoriser. Shows the
  // signed name + date if already signed, otherwise "Pending".
  const qcSig = esignatureState['d_signQcManager'];
  const qcSignBlock = (() => {
    if (qcSig && qcSig.signedBy) {
      const when = qcSig.signedAt ? toDisplayDate(qcSig.signedAt.split('T')[0]) : '';
      return `<div class="signoff">
        <h2>Investigation Authorised</h2>
        <div class="signoff-row">
          <div class="signoff-label">Technical Support (QC Manager)</div>
          <div class="signoff-name">${esc(qcSig.signedBy)}</div>
          <div class="signoff-date">${esc(when)}</div>
        </div>
      </div>`;
    }
    return `<div class="signoff">
      <h2>Investigation Authorised</h2>
      <div class="signoff-row">
        <div class="signoff-label">Technical Support (QC Manager)</div>
        <div class="signoff-name muted">Pending signature</div>
        <div class="signoff-date"></div>
      </div>
    </div>`;
  })();

  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(irNum)} — Investigation</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; }
  .head { border-bottom: 2px solid #0E62FF; padding-bottom: 10px; margin-bottom: 14px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #0E62FF; }
  .brand { font-size: 12px; color: #64748b; letter-spacing: .04em; text-transform: uppercase; }
  .meta { font-size: 13px; color: #334155; margin: 12px 0; }
  .meta span { display: inline-block; margin-right: 18px; }
  .intro { background: #eef4ff; border-left: 4px solid #0E62FF; padding: 12px 14px; font-size: 14px; line-height: 1.5; margin: 6px 0 18px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #0E62FF; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin: 22px 0 8px; }
  .val { font-size: 14px; line-height: 1.55; white-space: pre-wrap; }
  .val.muted { color: #94a3b8; }
  figure { margin: 12px 0; text-align: center; page-break-inside: avoid; }
  figure img { max-width: 100%; max-height: 600px; border: 1px solid #e2e8f0; border-radius: 8px; }
  figcaption { font-size: 12px; color: #475569; margin-top: 6px; }
  .signoff { margin-top: 28px; page-break-inside: avoid; }
  .signoff h2 { margin-bottom: 12px; }
  .signoff-row { display: flex; align-items: flex-end; gap: 28px; }
  .signoff-label { font-size: 12px; color: #475569; border-top: 1px solid #0f172a; padding-top: 6px; min-width: 240px; }
  .signoff-name { font-size: 14px; font-weight: 600; color: #0f172a; }
  .signoff-name.muted { color: #94a3b8; font-weight: 400; }
  .signoff-date { font-size: 12px; color: #475569; }
  .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
</style></head><body>
  <div class="head">
    <div class="brand">Indrones After-Sales · I-PASSBOOK</div>
    <h1>Investigation Report</h1>
  </div>
  <div class="meta">
    <span><strong>IR:</strong> ${esc(irNum)}</span>
    <span><strong>System ID:</strong> ${esc(drone)}</span>
    <span><strong>Date:</strong> ${esc(analysisDate)}</span>
    <span><strong>Analyst:</strong> ${esc(analysisBy)}</span>
  </div>
  <div class="intro">Dear customer, analysis of <strong>${esc(irNum)}</strong> for your system with ID <strong>${esc(drone)}</strong> has been completed. Its findings are as below.</div>
  ${para('Description of Investigation', investigation)}
  ${images.length ? `<h2>Investigation Evidence</h2>${imgBlock}` : ''}
  ${para('Root Cause', rootCause)}
  ${para('Corrective Action', corrective)}
  ${para('Preventive Action', preventive)}
  ${qcSignBlock}
  <div class="foot">This report was generated from I-PASSBOOK · Section D (Part A — Investigation).</div>
  <script>
    (function(){
      var printed = false;
      function go(){ if (printed) return; printed = true; setTimeout(function(){ window.focus(); window.print(); }, 250); }
      var imgs = Array.prototype.slice.call(document.images);
      var pending = imgs.length;
      if (!pending) { window.onload = go; return; }
      function done(){ if (--pending <= 0) go(); }
      imgs.forEach(function(im){
        if (im.complete && im.naturalWidth) { done(); return; }
        im.onload  = done;
        im.onerror = done;
      });
      window.onload = function(){ setTimeout(go, 4000); };
    })();
  <\/script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { showToast('Allow pop-ups to download the PDF'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ─── IMAGE EVIDENCE (Section D) ───────────────────────────────────────────────
// Per-image evidence with a name/context caption. New images are uploaded to
// Drive via the existing file mechanism (fieldId '_links'); captions + the
// already-uploaded Drive URLs live in the field value `d_evidence` as
// [{caption, link}]. The backend overwrites '_links' with only the newly-uploaded
// URLs on each save, so already-uploaded links are carried in `d_evidence` and
// re-sent on every save; newly-uploaded links are merged back from '_links'
// after a save (and on load) so captions stay paired with their images.
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
                onclick="removeEvidenceImage('${escHtml(fieldId)}', ${i})" title="Remove">&#10005;</button>
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
    const type = f.type === 'application/pdf' ? 'pdf' : (f.type.startsWith('image/') ? 'image' : '');
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
// Toasts queue instead of overwriting: back-to-back messages used to clobber
// each other's text, and the first timer would hide the newer message early.
let _toastQueue = [];
let _toastBusy = false;

function showToast(msg) {
  _toastQueue.push(msg);
  if (!_toastBusy) drainToastQueue();
}

function drainToastQueue() {
  const msg = _toastQueue.shift();
  if (msg === undefined) { _toastBusy = false; return; }
  _toastBusy = true;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    // Let the hide transition finish before the next message slides in.
    setTimeout(drainToastQueue, 300);
  }, 3000);
}

// ─── NUDGE / TAG / ALERT SYSTEM ───────────────────────────────────────────────
// Lets any user @-tag a teammate (by name, with autocomplete from the Indrones
// directory) at three levels — the whole IR, a section, or a single field. The
// tagged person sees a 🔔 notification in-app, and the sender can also fire off a
// pre-filled email (mailto). No backend redeploy needed: nudges are stored via
// the existing generic saveSection/getPassbook endpoints under a special
// irNumber '__NUDGES__' / sectionId 'all' (same mechanism as the admin config).

// ── Team directory (admin-editable; used for @-mention autocomplete) ──
const TEAM_DIRECTORY_DEFAULTS = [
  { name: 'Monish Raza',        email: 'monish.raza@indrones.com' },
  { name: 'Ravi Singh',         email: 'ravi@indrones.com' },
  { name: 'Adhik Nair',          email: 'adhik.nair@indrones.com' },
  { name: 'Customer Relations', email: 'customer.relations@indrones.com' },
];
let teamDirectory = TEAM_DIRECTORY_DEFAULTS.map(d => ({ ...d }));

function loadTeamDirectory() {
  try {
    const local = localStorage.getItem('ipb_team_directory');
    if (local) { const arr = JSON.parse(local); if (Array.isArray(arr) && arr.length) teamDirectory = arr; }
  } catch {}
  loadSentinel('__CONFIG__', 'team-directory')
    .then(saved => {
      if (saved && Array.isArray(saved.entries) && saved.entries.length) {
        teamDirectory = saved.entries;
        try { localStorage.setItem('ipb_team_directory', JSON.stringify(saved.entries)); } catch {}
      }
    });
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
      ? `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escHtml(n.id)}')">↻ Reopen</button>`
      : `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escHtml(n.id)}')">✓ Resolve</button>`;
    return `<div class="nudge-item ${resolved ? 'resolved' : ''}">
      <div class="nudge-item-top">
        <span class="nudge-from">${escHtml(n.fromName || n.from || 'Someone')}</span>
        <span class="nudge-time">${escHtml(relativeTime(n.createdAt))}</span>
      </div>
      <div class="nudge-ctx">🔔 ${escHtml(n.irNumber || '')} · ${escHtml(scopeContextText(n))}</div>
      <div class="nudge-msg">${escHtml(n.message || '')}</div>
      <div class="nudge-actions">
        ${statusChip}
        ${actionBtn}
        ${canOpen ? `<button type="button" class="nudge-mini" onclick="openIRFromNudge('${escHtml(n.irNumber)}')">Open IR</button>` : ''}
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
          <button type="button" class="btn" onclick="sendComment()">💬 Comment</button>
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
      ? `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escHtml(n.id)}')">↻ Reopen</button>`
      : `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escHtml(n.id)}')">✓ Resolve</button>`;
    const editBtn = editable && !editing
      ? `<button type="button" class="nudge-mini" onclick="startEditNudge('${escHtml(n.id)}')" title="Edit comment">✏ Edit</button>`
      : '';
    const editedTag = n.editedAt
      ? `<span class="nudge-edited" title="Edited${n.editedBy ? ' by ' + n.editedBy : ''} · ${relativeTime(n.editedAt)}">(edited)</span>`
      : '';
    const msgOrEditor = editing
      ? `<div class="nudge-edit-wrap">
           <textarea class="nudge-edit-input" id="nudge-edit-${escHtml(n.id)}">${escHtml(n.message || '')}</textarea>
           <button type="button" class="nudge-mini primary" onclick="editNudge('${escHtml(n.id)}', document.getElementById('nudge-edit-${escHtml(n.id)}').value)">Save</button>
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
    `<button type="button" class="nudge-suggest-item" data-idx="${i}" data-email="${escHtml(d.email)}" data-name="${escHtml((d.name||'').replace(/"/g, '&quot;'))}" onclick="selectNudgeRecipient('${escHtml(d.email)}','${escHtml((d.name||'').replace(/'/g, ''))}')">
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

// ─── AUDIT TRAIL / EDIT HISTORY ───────────────────────────────────────────────
// Shows the backend AUDIT_LOG for the open IR: every save + every field overwrite
// (old→new), newest first — so any later correction is traceable. Requires the
// redeployed backend (getAuditLog action).
async function openHistoryModal() {
  if (!currentIR?.irNumber) { showToast('Open an IR first'); return; }
  const irNumber = currentIR.irNumber;
  let entries = [];
  try {
    const res  = await fetch(`${CONFIG.GAS_URL}?action=getAuditLog&irNumber=${encodeURIComponent(irNumber)}`);
    const data = await res.json();
    if (data.status === 'ok') entries = Array.isArray(data.entries) ? data.entries : [];
    else if (data.status === 'error') { showToast('History: ' + (data.message || 'backend error')); }
  } catch {
    showToast('History unavailable — backend not connected yet');
  }
  const evLabel = e => e.event === 'changed' ? '✏️ changed'
    : e.event === 'added' ? '➕ added'
    : e.event === 'removed' ? '➖ removed'
    : '💾 saved';
  const clip = s => String(s == null ? '' : s).slice(0, 200);
  const body = entries.length
    ? entries.slice().reverse().map(e => {
        const field = e.fieldId
          ? `<span class="hist-field">${escHtml(e.fieldId)}</span>`
          : '<span class="hist-field hist-muted">(section save)</span>';
        let diff = '';
        if (e.event === 'changed' || e.event === 'removed')
          diff = `<div class="hist-diff"><span class="hist-old">old:</span> ${escHtml(clip(e.oldValue))}</div>`
               + `<div class="hist-diff"><span class="hist-new">new:</span> ${escHtml(clip(e.newValue))}</div>`;
        else if (e.event === 'added')
          diff = `<div class="hist-diff"><span class="hist-new">new:</span> ${escHtml(clip(e.newValue))}</div>`;
        return `<div class="hist-item">
          <div class="hist-top"><span class="hist-ev">${evLabel(e)}</span>${field}<span class="hist-time">${escHtml(e.timestamp || '')}</span></div>
          <div class="hist-by">by ${escHtml(e.savedBy || '')} · ${escHtml(e.sectionId || '')}</div>
          ${diff}
        </div>`;
      }).join('')
    : '<div class="nudge-empty">No history yet — saves and edits for this IR will appear here.</div>';
  const modal = document.createElement('div');
  modal.className = 'inward-options-modal';
  modal.id = 'history-modal';
  modal.innerHTML = `
    <div class="inward-options-card nudge-card">
      <div class="inward-options-head">
        <h3>History · ${escHtml(irNumber)}</h3>
        <button type="button" class="inward-options-close" onclick="closeHistoryModal()">&times;</button>
      </div>
      <div class="nudge-ctx-line">Audit trail — every save &amp; field correction (newest first).</div>
      <div class="hist-list">${body}</div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeHistoryModal(); });
}
function closeHistoryModal() { document.getElementById('history-modal')?.remove(); }

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
