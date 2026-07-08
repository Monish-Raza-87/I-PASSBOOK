/* ============================================================
   I-PASSBOOK — app.js
   Single Page App routing, auth, form rendering & API calls
   ============================================================ */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// IMPORTANT: Replace these with your actual values before deploying.
const CONFIG = {
  // Google Apps Script Web App URL (v2 — correct column mappings)
  GAS_URL: 'https://script.google.com/macros/s/AKfycbz-borqx_TeCTh1Ibc70vv9SIHaFxRvVGs4XolbJG0EG2qEg4kVQ0hyclDOeLM8kCDP/exec',

  // Google OAuth Client ID — restricts login to @indrones.com accounts
  GOOGLE_CLIENT_ID: '719566494973-i27l1935v7rrcatv11simfoertsf733a.apps.googleusercontent.com',

  // Allowed domain — only @indrones.com emails can log in
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
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentUser = null;

// ─── GAS CALL AUTH (verified Google ID token) ────────────────────────────────
// Every Apps Script backend call must carry a fresh, verified Google ID token.
// The backend now validates that token (signature via Google tokeninfo, expiry,
// audience = our client ID, @indrones.com domain) and reads the caller's email
// FROM THE TOKEN — not from a parameter. This closes the spoofing hole the old
// email-parameter gate had (anyone who knew the GAS URL + an @indrones.com
// email could read/write all data).
//
// `currentUser.token` is a GIS ID token (~1h lifetime). We keep one warm in
// memory: at boot a silent Google One-Tap (auto_select) re-issues one for
// returning users, and the interceptor refreshes + retries once if the backend
// reports the token expired/stale. The token is NEVER persisted to storage.
let _gisReady = null;
function loadGis() {
  if (_gisReady) return _gisReady;
  _gisReady = new Promise((resolve) => {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve(); // resolve anyway; refresh fails gracefully
    document.head.appendChild(s);
  });
  return _gisReady;
}

let _refreshing = null;
function refreshIdToken() {
  if (_refreshing) return _refreshing;
  _refreshing = new Promise((resolve, reject) => {
    loadGis().then(() => {
      if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) return reject(new Error('gis-unavailable'));
      let done = false;
      const finish = (ok, val) => { if (done) return; done = true; _refreshing = null; ok ? resolve(val) : reject(val); };
      const timer = setTimeout(() => finish(false, new Error('timeout')), 9000);
      try {
        google.accounts.id.initialize({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          callback: (resp) => {
            if (resp && resp.credential) { currentUser.token = resp.credential; finish(true, resp.credential); }
            else finish(false, new Error('no-credential'));
          },
        });
        google.accounts.id.prompt({ auto_select: true }); // silent for returning users
      } catch (e) { clearTimeout(timer); finish(false, e); }
    });
  });
  return _refreshing;
}

function ensureAuthToken() {
  if (currentUser && currentUser.token) return Promise.resolve(currentUser.token);
  return refreshIdToken();
}

const _origFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  return (async () => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isGAS = url.indexOf(CONFIG.GAS_URL) === 0;
    if (!isGAS) return _origFetch(input, init);

    // Dev bypass (localhost + ?dev=1): no real Google account to mint a token,
    // so backend calls can't be authorized and fall back to demo data. This is
    // intentional — real testing happens signed-in on the live site.
    if (shouldUseDevAuthBypass()) return _origFetch(input, init);

    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    const emailQ = currentUser && currentUser.email ? ('userEmail=' + encodeURIComponent(currentUser.email)) : '';
    // buildInput(null) → userEmail only (works with the old email-gate backend
    // during the redeploy window). buildInput(token) → idToken + userEmail.
    const buildInput = (tok) => url + sep + (tok ? ('idToken=' + encodeURIComponent(tok) + (emailQ ? '&' : '')) : '') + emailQ;

    const isFormData = init && init.body && init.body instanceof FormData;
    const origBody = isFormData ? init.body : null;
    const buildInit = (tok) => {
      if (isFormData) {
        // FormData() only accepts an HTMLFormElement, so copy entries by hand.
        const fd = new FormData();
        for (const [k, v] of origBody.entries()) fd.append(k, v);
        if (tok) fd.append('idToken', tok);
        if (emailQ) fd.append('userEmail', currentUser.email);
        return Object.assign({}, init, { body: fd });
      }
      return init;
    };

    let token = currentUser && currentUser.token;
    if (!token) { try { token = await ensureAuthToken(); } catch { /* leave token null */ } }

    input = isFormData ? url : buildInput(token);
    init = buildInit(token);
    let resp = await _origFetch(input, init);

    // Retry once only on a real auth rejection (token expired / stale). Match
    // the backend's exact "Unauthorized…" message so unrelated errors (e.g. an
    // @-nudge to a non-Indrones address) don't trigger a pointless re-auth.
    if (resp && resp.ok) {
      try {
        const data = await resp.clone().json();
        if (data && data.status === 'error' && (data.message || '').toLowerCase().indexOf('unauthorized') === 0) {
          try {
            const fresh = await refreshIdToken();
            input = isFormData ? url : buildInput(fresh);
            init = buildInit(fresh);
            resp = await _origFetch(input, init);
          } catch { /* give up; surface the original error */ }
        }
      } catch { /* response wasn't JSON; ignore */ }
    }
    return resp;
  })();
};
let allIRs      = [];          // master list fetched from GAS
let currentIR   = null;        // the IR open in detail view
let currentSectionData = {};   // cached data for open passbook
let legacyMap   = {};          // irNumber -> { label, gid, embedUrl, openUrl } for legacy IRs (≤~IR441)

// ─── AUTHORIZATION ─────────────────────────────────────────────────────────────
const AUTHORIZED_CR_EMAILS = [
  'monish.raza@indrones.com',
  'ravi@indrones.com',
  'adhik.nair@indrones.com',
];

function isAuthorizedCR() {
  return currentUser?.email &&
         AUTHORIZED_CR_EMAILS.includes(currentUser.email.toLowerCase().trim());
}

// ─── ADMIN (config editors) ───────────────────────────────────────────────────
// Admins may customize Section B inward dropdowns and Section C inspection
// points / result options.
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

// ─── SPLASH → AUTH FLOW ──────────────────────────────────────────────────────
window.addEventListener('load', () => {
  // Check for local file protocol (Google Auth won't work)
  if (window.location.protocol === 'file:') {
    alert('⚠️ GOOGLE AUTH WARNING: You are running this app directly from a local file. Google Login will NOT work unless you serve the app via a local server (http://localhost) or deploy it to Netlify.');
  }

  // Give the splash video time to play (4 seconds for the Indrones intro)
  setTimeout(() => {
    splash.style.opacity = '0';
    splash.style.transform = 'scale(1.04)';
    setTimeout(() => {
      splash.style.display = 'none';
      const stored = loadStoredUser();
      if (stored) {
        currentUser = stored;
        showApp();
      } else if (shouldUseDevAuthBypass()) {
        currentUser = createDevUser();
        persistUser(currentUser, false); // dev bypass: this tab only
        showApp();
      } else {
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

// ─── PERSISTENT LOGIN ("keep me logged in") ──────────────────────────────────
// Stores the signed-in profile so the app reopens already logged in on the
// device. `persist=true` (the checkbox) writes to localStorage (survives app
// close / phone restart); `persist=false` writes to sessionStorage only (this
// tab, cleared on close). Only the profile is persisted — the raw ID token is
// NEVER written to storage (it's unused after sign-in; the backend gate relies
// on the verified email, and keeping the token out of storage limits exposure
// if the device is shared or lost).
function persistUser(user, persist) {
  const safe = {
    name:    user.name,
    email:   user.email,
    picture: user.picture,
    initial: user.initial,
  };
  try {
    sessionStorage.setItem('ipb_user', JSON.stringify(safe));
    if (persist) localStorage.setItem('ipb_user', JSON.stringify(safe));
    else localStorage.removeItem('ipb_user');
  } catch { /* storage may be unavailable in private mode — non-fatal */ }
}

function loadStoredUser() {
  try {
    const persisted = localStorage.getItem('ipb_user');
    if (persisted) return JSON.parse(persisted);
    const session = sessionStorage.getItem('ipb_user');
    if (session) return JSON.parse(session);
  } catch { }
  return null;
}

// ─── GOOGLE AUTH ─────────────────────────────────────────────────────────────
function showAuth() {
  authCont.style.display = 'flex';
  // Load Google Identity Services dynamically
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = initGoogleAuth;
  document.head.appendChild(script);
}

function initGoogleAuth() {
  // Render a hidden Google button and click programmatically for custom styling
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredential,
    auto_select: false,
  });
  // Also set up the manual button
  document.getElementById('google-signin-btn').addEventListener('click', () => {
    google.accounts.id.prompt(); // show One Tap
  });
}

function handleCredential(response) {
  // Decode the JWT to read user info
  const payload = parseJwt(response.credential);
  const email = payload.email || '';

  if (!email.endsWith('@' + CONFIG.ALLOWED_DOMAIN)) {
    document.getElementById('auth-error').style.display = 'block';
    return;
  }

  currentUser = {
    name:    payload.name,
    email:   payload.email,
    picture: payload.picture,
    initial: payload.name?.charAt(0)?.toUpperCase() || '?',
    token:   response.credential,
  };
  const keepBox = document.getElementById('keep-signin');
  persistUser(currentUser, keepBox ? keepBox.checked !== false : true);
  showApp();
}

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return {}; }
}

// ─── APP BOOT ────────────────────────────────────────────────────────────────
function showApp() {
  authCont.style.display = 'none';
  appCont.style.display  = 'flex';
  showIndex();

  // Set up user avatar
  userAvatar.textContent = currentUser?.initial || '?';
  if (currentUser?.picture) {
    userAvatar.style.backgroundImage = `url(${currentUser.picture})`;
    userAvatar.style.backgroundSize  = 'cover';
    userAvatar.textContent = '';
  }

  // User menu toggle
  userAvatar.addEventListener('click', toggleUserMenu);

  // Fetch IRs
  fetchIRs();
  // Load legacy I-PASSBOOK index (read-only archive of pre-app IRs) — best-effort
  loadLegacyIndex();
  // Load admin-customizable inward dropdown options (best-effort)
  loadInwardOptions();
  // Load admin-customizable IQC inspection points + result options
  loadIqcConfig();
  // Load team directory (@-mention suggestions) + nudges, and start nudge polling
  loadTeamDirectory();
  loadNudges();
  startNudgePolling();

  // Bell toggle
  const bell = document.getElementById('nudge-bell');
  if (bell) bell.addEventListener('click', toggleNudgePanel);
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
      <button class="signout-btn" id="reconnect-btn">⟳ Reconnect to Google</button>
      <button class="signout-btn" id="signout-btn">Sign Out</button>
    `;
    document.body.appendChild(menu);
    document.getElementById('reconnect-btn').addEventListener('click', () => { menu.style.display = 'none'; reconnectGoogle(); });
    document.getElementById('signout-btn').addEventListener('click', signOut);
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
  try {
    localStorage.removeItem('ipb_user');
    sessionStorage.removeItem('ipb_user');
  } catch { }
  if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
  location.reload();
}

// ─── RECONNECT TO GOOGLE ─────────────────────────────────────────────────────
// The silent One-Tap (auto_select) used at boot is unreliable on mobile PWAs —
// it often doesn't fire on a reopened app, so the backend's token gate rejects
// saves and the legacy archive with "Unauthorized". This user-initiated flow
// shows the real One-Tap card (a tap, not a silent moment), which is reliable,
// then refreshes the token-gated data. Reachable from the user menu.
function reconnectGoogle() {
  return loadGis().then(() => {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
      showToast('Google sign-in unavailable — check your connection');
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; showToast('Reconnect timed out — try again'); }
    }, 20000);
    try {
      google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: (resp) => {
          if (settled) return; settled = true; clearTimeout(timer);
          if (resp && resp.credential) {
            currentUser.token = resp.credential;
            // keep the stored profile's email in sync if the re-signed account differs
            try {
              const p = parseJwt(resp.credential);
              if (p.email) { currentUser.email = p.email; currentUser.name = p.name || currentUser.name; }
            } catch { /* keep existing */ }
            showToast('✓ Reconnected to Google');
            loadLegacyIndex();   // re-fetch the token-gated legacy archive
          } else {
            showToast('Reconnect cancelled — saves & legacy need a Google sign-in');
          }
        },
      });
      google.accounts.id.prompt(); // visible One-Tap — reliable when user-initiated
    } catch (e) {
      clearTimeout(timer);
      showToast('Reconnect failed — try Sign Out and sign in again');
    }
  });
}

// ─── MASTER INDEX ────────────────────────────────────────────────────────────
function showIndex() {
  indexView.style.display = 'block';
  detailView.style.display = 'none';
  backBtn.style.display = 'none';
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

async function fetchIRsFromSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.IR_REPO_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${CONFIG.IR_REPO_GID}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  const text = await res.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim());
  // Match by substring so minor wording changes in the form headers don't break it
  const col = needle => headers.findIndex(h => h.includes(needle));
  const C = {
    summary:    col('Summary'),
    irNo:       col('IR Number'),
    timestamp:  col('Timestamp'),
    status:     col('Issue Status'),
    spoc:       col('SPOC'),
    category:   col('What Support'),
    desc:       col('Please Describe'),
    incident:   col('Date of Incident'),
    uas:        col('Drone Serial No'),
    reportedBy: col("Who's Reporting"),
    email:      col('Email Address'),
  };
  const cell = (row, i) => (i >= 0 && row[i] != null ? row[i].trim() : '');

  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const irNumber = cell(row, C.irNo);
    if (!irNumber) continue;
    const ts   = cell(row, C.timestamp);
    const inc  = cell(row, C.incident);
    const stat = cell(row, C.status) || 'Open';
    const { name, phone } = splitNamePhone(cell(row, C.reportedBy));
    records.push({
      irNumber,
      droneId:       cell(row, C.uas),
      dateRaised:    toDisplayDate(ts),
      dateRaisedISO: toISODate(ts),
      status:        stat,
      summaryLink:   cell(row, C.summary),
      customerName:  name,
      contactPhone:  phone,
      contactEmail:  cell(row, C.email),
      issueType:     cell(row, C.category),
      issueDesc:     cell(row, C.desc),
      spoc:          cell(row, C.spoc),
      initialStatus: stat,
      incidentDate:  toISODate(inc),
    });
  }
  return records.reverse();   // latest first
}

async function fetchIRs() {
  setSyncStatus('⟳ Syncing with IR Repository...');

  // 1. Primary: read the sheet directly (no backend deploy needed)
  try {
    const records = await fetchIRsFromSheet();
    if (records && records.length) {
      allIRs = records;
      setSyncStatus(`✓ ${allIRs.length} IRs loaded from sheet · Last sync: ${new Date().toLocaleTimeString()}`);
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
      allIRs = data.records || [];
      setSyncStatus(`✓ ${allIRs.length} IRs loaded · Last sync: ${new Date().toLocaleTimeString()}`);
      renderIRList(allIRs);
      return;
    }
    throw new Error(data.message || 'Unknown error');
  } catch (err) {
    setSyncStatus('⚠ Could not sync. Showing demo data.');
    // Demo mode: render sample cards so UI is visible
    allIRs = getDemoIRs();
    renderIRList(allIRs);
  }
}

function setSyncStatus(msg) { syncStatus.textContent = msg; }

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
      // Surface the real reason. "Unauthorized" = no valid Google token on this
      // device (silent sign-in didn't fire) — saves will fail the same way; the
      // fix is Reconnect to Google from the user menu. Anything else is a backend
      // error (e.g. the deployer can't open the legacy sheet) — show it verbatim.
      var msg = (data.message || 'unknown error').toLowerCase();
      if (msg.indexOf('unauthorized') === 0) {
        showToast('Legacy needs Google sign-in — tap avatar → Reconnect to Google');
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
  if (!records || records.length === 0) {
    irList.innerHTML = '<div class="empty-state"><span>📭</span>No IRs found. Create one via the customer form.</div>';
    return;
  }

  irList.innerHTML = records.map(ir => `
    <div class="ir-card animate-slide-up" data-id="${ir.irNumber}" onclick="openPassbook('${ir.irNumber}')">
      <div class="ir-card-main">
        <div class="ir-title">${ir.irNumber}</div>
        <div class="ir-meta">
          <span class="ir-sn">${ir.droneId || ''}</span>
          ${ir.dateRaised ? `<span class="ir-dot">·</span><span class="ir-date">${ir.dateRaised}</span>` : ''}
        </div>
      </div>
      <div class="ir-card-side">
        ${legacyMap[ir.irNumber] ? `<span class="badge badge-legacy" title="Recorded in the legacy I-PASSBOOK">Legacy</span>` : ''}
        <span class="badge ${getBadgeClass(ir.status)}">${ir.status || 'Open'}</span>
        ${ir.summaryLink ? `<a href="${ir.summaryLink}" class="ir-summary-link" onclick="event.stopPropagation()" target="_blank">View Summary ↗</a>` : ''}
      </div>
    </div>
  `).join('');
}

function getBadgeClass(status) {
  if (!status || status.toLowerCase() === 'open') return 'badge badge-open';
  if (status.toLowerCase().includes('pend'))      return 'badge badge-pending';
  return 'badge badge-closed';
}

// Search / filter
searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase();
  const filtered = allIRs.filter(ir =>
    ir.irNumber?.toLowerCase().includes(q) ||
    ir.droneId?.toLowerCase().includes(q)
  );
  renderIRList(filtered);
});

// ─── PASSBOOK DETAIL ─────────────────────────────────────────────────────────
async function openPassbook(irNumber) {
  currentIR = allIRs.find(ir => ir.irNumber === irNumber) || { irNumber };
  esignatureState = {};   // clear signatures from any previously-open IR
  evidenceState = {};     // clear image-evidence state from any previously-open IR
  dispatchChecklistState = {}; // clear Section H dispatch checklist from previous IR

  document.getElementById('ir-banner-title').textContent = irNumber;
  document.getElementById('ir-banner-sub').textContent =
    `${currentIR.droneId || '—'} · ${currentIR.customerName || '—'} · Status: ${currentIR.status || 'Open'}`;

  indexView.style.display = 'none';
  detailView.style.display = 'flex';
  backBtn.style.display = 'block';
  headerTitle.textContent = irNumber;

  // Build all section forms
  buildSectionForms(irNumber);

  // Load saved data for this IR, then restore any unsaved drafts on top
  await loadSectionData(irNumber);
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
          <div class="legacy-title">🏛 Legacy I-PASSBOOK Record</div>
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

// Back button
backBtn.addEventListener('click', showIndex);

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
      { id: 'a_irNumber',      label: 'IR Number',                    type: 'text',     placeholder: 'e.g. IR409',      readonly: true },
      { id: 'a_droneId',       label: 'Drone Serial No.',             type: 'text',     placeholder: 'e.g. S25P014',    readonly: true },
      { id: 'a_dateRaised',    label: 'Date of Incident',             type: 'date',     restricted: true },
      { id: 'a_crmOwner',      label: 'Customer Relations Manager',    type: 'text',     placeholder: 'Name of CRM person', restricted: true },
      { id: 'a_customerName',  label: 'Customer / Client Name',       type: 'text',     placeholder: 'Organisation or person', restricted: true },
      { id: 'a_contactEmail',  label: 'Customer Email',               type: 'email',    placeholder: 'customer@example.com', restricted: true },
      { id: 'a_contactPhone',  label: 'Customer Phone',               type: 'tel',      placeholder: '+91 XXXXX XXXXX', restricted: true },
      { id: 'a_issueType',     label: 'What Support Is Required?',    type: 'text',     placeholder: 'e.g. Hardware Damage, Software Issue...', restricted: true },
      { id: 'a_issueDesc',     label: 'Issue Description',            type: 'textarea', placeholder: 'Describe the problem in detail...', restricted: true },
      { id: 'a_activityLog',   label: 'Activity Log (Timeline)',      type: 'activityTable', restricted: true },
      { id: 'a_overallStatus', label: 'IR Status',                    type: 'select',   options: ['Open','Hold','Close','Inward','Visual Inspection','QC Investigation','Production','QC','Flight Test','PDI','Approval','Delivered','Remote Support','Other'], restricted: true },
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
    container.innerHTML = section.fields.map(f => buildField(f, irNumber)).join('');
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
}

function buildField(field, irNumber) {
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
  } else {
    // text, number, date, email, tel
    control = `<input type="${field.type}" id="${id}" class="form-input" placeholder="${field.placeholder || ''}" value="${esc(val)}" ${field.readonly ? 'readonly style="opacity:0.6"' : ''} />`;
  }

  // Apply restricted field behavior (CRM-only fields)
  const isRestricted = field.restricted && !isAuthorizedCR();
  if (isRestricted) {
    if (field.type === 'inwardTable' || field.type === 'iqcTable') {
      control = control.replace(/<select /g, '<select disabled ');
      control = control.replace(/<input /g, '<input disabled ');
    } else if (field.type === 'esignature') {
      // Signature buttons are disabled for non-authorized users on restricted sections
      control = control.replace(/<button type="button" class="btn-esign/g, '<button type="button" disabled class="btn-esign');
    } else if (field.type === 'activityTable') {
      // Disable all inputs inside the activity table
      control = control.replace(/<input /g, '<input disabled ');
      // Disable the "Add Row" button
      control = control.replace(/<button type="button" class="btn-add-row"/, '<button type="button" class="btn-add-row" disabled style="opacity:0.4;cursor:not-allowed;"');
    } else if (field.type === 'url') {
      // Disable just the URL input inside the wrapper
      control = control.replace(/<input type="url"/, '<input type="url" disabled');
    } else {
      control = control.replace(/<select /, '<select disabled ');
      control = control.replace(/<input /, '<input disabled ');
      control = control.replace(/<textarea /, '<textarea disabled ');
    }
  }

  const lockIcon = isRestricted ? ' <span class="field-lock-icon" title="Only authorized CRM personnel can edit this field">&#128274;</span>' : '';
  // Per-field nudge / comment button (skipped for the read-only analysis note).
  const fieldNudgeBtn = field.type && field.type !== 'analysisNote'
    ? `<button type="button" class="field-nudge-btn" data-field-id="${escHtml(id)}" title="Comments on this field" onclick="openNudgeModalForField('${escHtml(id)}')">💬<span class="comment-count" style="display:none;">0</span></button>`
    : '';
  const labelHtml = field.label
    ? `<label class="form-label${isRestricted ? ' field-restricted-label' : ''}" for="${id}">${field.label}${lockIcon}${fieldNudgeBtn}</label>`
    : (fieldNudgeBtn ? `<div class="form-label">${fieldNudgeBtn}</div>` : '');

  return `
    <div class="form-group${isRestricted ? ' field-restricted' : ''}">
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
    const canOverride = isInwardAdmin() || isAuthorizedCR() || sig.signedBy === email;
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
  fetch(`${CONFIG.GAS_URL}?action=getPassbook&irNumber=__CONFIG__`)
    .then(r => r.json())
    .then(data => {
      const saved = data?.sections?.['inward-options'];
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
    })
    .catch(() => { /* GAS unreachable — keep defaults/localStorage */ });
}

function saveInwardOptions() {
  if (!isInwardAdmin()) { showToast('Not authorized'); return; }
  try { localStorage.setItem('ipb_inward_options', JSON.stringify(inwardOptions)); } catch {}
  const fd = new FormData();
  fd.append('action', 'saveSection');
  fd.append('irNumber', '__CONFIG__');
  fd.append('sectionId', 'inward-options');
  fd.append('savedBy', currentUser?.email || 'unknown');
  fd.append('fields', JSON.stringify({ options: inwardOptions }));
  fd.append('files', JSON.stringify([]));
  fetch(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.json())
    .then(() => showToast('Inward options saved'))
    .catch(() => showToast('Saved locally (backend unreachable)'));
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
  fetch(`${CONFIG.GAS_URL}?action=getPassbook&irNumber=__CONFIG__`)
    .then(r => r.json())
    .then(data => {
      const saved = data?.sections?.['iqc-config'];
      if (!saved) return;
      if (Array.isArray(saved.zones)) iqcZones = saved.zones;
      if (Array.isArray(saved.resultOptions)) iqcResultOptions = saved.resultOptions;
      try { localStorage.setItem('ipb_iqc_config', JSON.stringify({ zones: iqcZones, resultOptions: iqcResultOptions })); } catch {}
      reRenderIqcTables();
    })
    .catch(() => { /* GAS unreachable — keep defaults/localStorage */ });
}

function saveIqcConfig() {
  try { localStorage.setItem('ipb_iqc_config', JSON.stringify({ zones: iqcZones, resultOptions: iqcResultOptions })); } catch {}
  const fd = new FormData();
  fd.append('action', 'saveSection');
  fd.append('irNumber', '__CONFIG__');
  fd.append('sectionId', 'iqc-config');
  fd.append('savedBy', currentUser?.email || 'unknown');
  fd.append('fields', JSON.stringify({ zones: iqcZones, resultOptions: iqcResultOptions }));
  fd.append('files', JSON.stringify([]));
  fetch(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.json())
    .then(() => showToast('Inspection config saved'))
    .catch(() => showToast('Saved locally (backend unreachable)'));
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
    if (field.type === 'analysisNote' || field.type === 'divider') {
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
  banner.style.display = 'block';
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
function showToast(msg) {
  toast.textContent = msg;
  toast.style.transform = 'translateX(-50%) translateY(0px)';
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(100px)';
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
  fetch(`${CONFIG.GAS_URL}?action=getPassbook&irNumber=__CONFIG__`)
    .then(r => r.json())
    .then(data => {
      const saved = data?.sections?.['team-directory'];
      if (saved && Array.isArray(saved.entries) && saved.entries.length) {
        teamDirectory = saved.entries;
        try { localStorage.setItem('ipb_team_directory', JSON.stringify(saved.entries)); } catch {}
      }
    })
    .catch(() => { /* GAS unreachable — keep defaults/localStorage */ });
}
function saveTeamDirectory() {
  if (!isAdmin()) { showToast('Not authorized'); return; }
  try { localStorage.setItem('ipb_team_directory', JSON.stringify(teamDirectory)); } catch {}
  const fd = new FormData();
  fd.append('action', 'saveSection');
  fd.append('irNumber', '__CONFIG__');
  fd.append('sectionId', 'team-directory');
  fd.append('savedBy', currentUser?.email || 'unknown');
  fd.append('fields', JSON.stringify({ entries: teamDirectory }));
  fd.append('files', JSON.stringify([]));
  fetch(CONFIG.GAS_URL, { method: 'POST', body: fd })
    .then(r => r.json())
    .then(() => showToast('Team directory saved'))
    .catch(() => showToast('Saved locally (backend unreachable)'));
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
      const items = data?.sections?.[NUDGE_SEC]?.items;
      nudges = Array.isArray(items) ? items : [];
      refreshBell();
      refreshCommentCounts();
      if (document.getElementById('nudge-panel')?.style.display === 'block') renderNudgePanel();
      rerenderOpenNudgeModal();
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
  badge.style.display = c > 0 ? 'block' : 'none';
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
    const loc = (ctx && ctx.scope === 'ir') ? `<div class="nudge-ctx">📍 ${escHtml(scopeContextText(n))}</div>` : '';
    const statusChip = resolved
      ? `<span class="nudge-status resolved" title="Resolved${n.resolvedBy ? ' by ' + n.resolvedBy : ''}${n.resolvedAt ? ' · ' + relativeTime(n.resolvedAt) : ''}">✓ Resolved</span>`
      : `<span class="nudge-status open">● Open</span>`;
    const actionBtn = resolved
      ? `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escHtml(n.id)}')">↻ Reopen</button>`
      : `<button type="button" class="nudge-mini" onclick="toggleNudgeStatus('${escHtml(n.id)}')">✓ Resolve</button>`;
    return `<div class="nudge-post ${mine ? 'mine' : ''} ${resolved ? 'resolved' : ''}">
      <div class="nudge-item-top">
        <span class="nudge-from">${escHtml(n.fromName || n.from || 'Someone')}</span>
        <span class="nudge-time">${escHtml(relativeTime(n.createdAt))}</span>
      </div>
      ${loc}
      <div class="nudge-to">→ ${escHtml(n.to || '')}</div>
      <div class="nudge-msg">${escHtml(n.message || '')}</div>
      <div class="nudge-post-actions">${statusChip}${actionBtn}</div>
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
  // One action: posts the comment in-app AND emails the recipient automatically.
  await sendNudgeEmailBackend(nudge);
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
    : '<div class="nudge-empty">No history yet. Once the backend is redeployed, every save and field correction will be recorded here.</div>';
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
