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
let allIRs      = [];          // master list fetched from GAS
let currentIR   = null;        // the IR open in detail view
let currentSectionData = {};   // cached data for open passbook

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
      const stored = sessionStorage.getItem('ipb_user');
      if (stored) {
        currentUser = JSON.parse(stored);
        showApp();
      } else if (shouldUseDevAuthBypass()) {
        currentUser = createDevUser();
        sessionStorage.setItem('ipb_user', JSON.stringify(currentUser));
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
  sessionStorage.setItem('ipb_user', JSON.stringify(currentUser));
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
  // Load admin-customizable inward dropdown options (best-effort)
  loadInwardOptions();
  // Load admin-customizable IQC inspection points + result options
  loadIqcConfig();
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
      <button class="signout-btn" id="signout-btn">Sign Out</button>
    `;
    document.body.appendChild(menu);
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
  sessionStorage.removeItem('ipb_user');
  if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
  location.reload();
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
}

// Back button
backBtn.addEventListener('click', showIndex);

// ─── DRAFT AUTO-SAVE ──────────────────────────────────────────────────────────
// Any edit within a section is persisted as a draft (debounced), so unsaved
// progress survives navigation/reload/failed saves.
let draftTimer = null;
document.getElementById('sections-wrapper').addEventListener('input', e => {
  const sec = e.target.closest('.section-content');
  if (!sec) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft(sec.id), 400);
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
  'sec-d': {
    title: 'Section D — Technical Support Analysis',
    fields: [
      { id: 'd_techDate',       label: 'Analysis Date',      type: 'date' },
      { id: 'd_techBy',         label: 'Tech Support Engineer', type: 'text', placeholder: 'Engineer name' },
      { id: 'd_rootCause',      label: 'Root Cause',          type: 'textarea', placeholder: 'Detailed root cause analysis...' },
      { id: 'd_repairScope',    label: 'Recommended Repair Scope', type: 'textarea', placeholder: 'What exactly needs repair or replacement...' },
      { id: 'd_matCostEstimate',label: 'Material Cost Estimate (₹)', type: 'number', placeholder: '0.00' },
      { id: 'd_labourCost',     label: 'Labour Cost Estimate (₹)',   type: 'number', placeholder: '0.00' },
      { id: 'd_totalEstimate',  label: 'Total Estimate (₹)',         type: 'number', placeholder: '0.00' },
      { id: 'd_crStatus',       label: 'Cost Report (CR) Status',    type: 'select', options: ['Not Sent','Sent – Awaiting Approval','Approved by Customer','Rejected by Customer'] },
      { id: 'd_crDate',         label: 'CR Sent / Approval Date',    type: 'date' },
      { id: 'd_techPhotos',     label: 'Analysis Photos / Reports',  type: 'file', multiple: true },
      { id: 'd_notes',          label: 'Additional Notes',           type: 'textarea', placeholder: 'Any additional observations...' },
    ]
  },
  'sec-e': {
    title: 'Section E — Production (Rework)',
    fields: [
      { id: 'e_prodStart',    label: 'Production Start Date', type: 'date' },
      { id: 'e_prodEnd',      label: 'Production End Date',   type: 'date' },
      { id: 'e_prodBy',       label: 'Production Technician', type: 'text', placeholder: 'Technician name' },
      { id: 'e_reworkItems',  label: 'Rework / Replacement Items',  type: 'textarea', placeholder: 'List of components replaced or repaired...' },
      { id: 'e_partNos',      label: 'Part Numbers Used',           type: 'textarea', placeholder: 'Part No. | Item | Qty' },
      { id: 'e_prodPhotos',   label: 'Rework Photos',               type: 'file', multiple: true },
      { id: 'e_prodRemarks',  label: 'Production Remarks',          type: 'textarea', placeholder: 'Any notes for QC team...' },
    ]
  },
  'sec-f': {
    title: 'Section F — Quality Control (QC)',
    fields: [
      { id: 'f_qcDate',       label: 'QC Date',           type: 'date' },
      { id: 'f_qcBy',         label: 'QC Inspector',      type: 'text', placeholder: 'Inspector name' },
      { id: 'f_qcChecklist',  label: 'QC Checklist / Test Results', type: 'textarea', placeholder: 'Motor test, ESC test, Compass, GPS, Gimbal...' },
      { id: 'f_qcResult',     label: 'QC Result',         type: 'select', options: ['Pass – Proceed to Flight Test','Fail – Return to Production','Conditional Pass'] },
      { id: 'f_qcPhotos',     label: 'QC Test Evidence',  type: 'file', multiple: true },
      { id: 'f_qcRemarks',    label: 'QC Remarks',        type: 'textarea', placeholder: 'Additional observations...' },
    ]
  },
  'sec-g': {
    title: 'Section G — Flight Test',
    fields: [
      { id: 'g_ftDate',       label: 'Flight Test Date',    type: 'date' },
      { id: 'g_ftPilot',      label: 'Test Pilot',          type: 'text', placeholder: 'Pilot name' },
      { id: 'g_ftDuration',   label: 'Test Duration (mins)', type: 'number', placeholder: '0' },
      { id: 'g_ftConditions', label: 'Test Conditions',      type: 'textarea', placeholder: 'Wind speed, location, altitude...' },
      { id: 'g_ftObservation',label: 'Flight Test Observations', type: 'textarea', placeholder: 'How the drone performed, any anomalies...' },
      { id: 'g_ftResult',     label: 'Flight Test Result',   type: 'select', options: ['Pass – Ready for PDI','Fail – Return to Production','Conditional Pass'] },
      { id: 'g_actualMatCost',label: 'Actual Material Cost (₹)', type: 'number', placeholder: '0.00' },
      { id: 'g_actualLabour', label: 'Actual Labour Cost (₹)',   type: 'number', placeholder: '0.00' },
      { id: 'g_actualTotal',  label: 'Actual Total Cost (₹)',    type: 'number', placeholder: '0.00' },
      { id: 'g_ftPhotos',     label: 'Flight Test Photos / Video', type: 'file', multiple: true },
    ]
  },
  'sec-h': {
    title: 'Section H — Pre-Delivery Inspection (PDI)',
    fields: [
      { id: 'h_pdiDate',     label: 'PDI Date',            type: 'date' },
      { id: 'h_pdiBy',       label: 'PDI Inspector',       type: 'text', placeholder: 'Inspector name' },
      {
        id: 'h_pdiChecklist', label: 'PDI Checklist', type: 'checklist',
        items: [
          'Physical Condition – OK',
          'All Parts Present',
          'Battery Fully Charged',
          'Firmware Updated',
          'Calibration Done',
          'Accessories Packed',
          'Documentation Included',
          'Branding / Labels Intact',
        ]
      },
      { id: 'h_pdiResult',   label: 'PDI Result',          type: 'select', options: ['Pass – Ready to Dispatch','Fail – Return to QC'] },
      { id: 'h_pdiPhotos',   label: 'PDI Photos',          type: 'file', multiple: true },
      { id: 'h_pdiRemarks',  label: 'PDI Remarks',         type: 'textarea', placeholder: 'Packing instructions, special notes...' },
    ]
  },
  'sec-i': {
    title: 'Section I — Logistics & Dispatch',
    fields: [
      { id: 'i_dispatchDate', label: 'Dispatch Date',      type: 'date' },
      { id: 'i_dispatchBy',   label: 'Dispatched By',      type: 'text', placeholder: 'Logistics / store person name' },
      { id: 'i_courier',      label: 'Courier / Transporter', type: 'text', placeholder: 'e.g. BlueDart, DHL, own vehicle' },
      { id: 'i_awbNo',        label: 'AWB / Docket No.',   type: 'text', placeholder: 'Tracking number' },
      { id: 'i_stNo',         label: 'Stock Transfer (ST) No.', type: 'text', placeholder: 'ST number from ERP / Tally' },
      { id: 'i_deliveryAddr', label: 'Delivery Address',   type: 'textarea', placeholder: 'Full delivery address...' },
      { id: 'i_estDelivery',  label: 'Expected Delivery Date', type: 'date' },
      { id: 'i_dispatchPhotos', label: 'Dispatch / Packing Photos', type: 'file', multiple: true },
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

  if (field.type === 'textarea') {
    control = `<textarea id="${id}" class="form-input" placeholder="${field.placeholder || ''}" ${field.readonly ? 'readonly' : ''}>${esc(val)}</textarea>`;
  } else if (field.type === 'select') {
    const opts = field.options.map(o => `<option value="${o}">${o}</option>`).join('');
    control = `<select id="${id}" class="form-input">${opts}</select>`;
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

  return `
    <div class="form-group${isRestricted ? ' field-restricted' : ''}">
      <label class="form-label${isRestricted ? ' field-restricted-label' : ''}" for="${id}">${field.label}${lockIcon}</label>
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

function populateFieldValue(sectionId, fieldId, value) {
  const section = SECTIONS[sectionId];
  const field = section?.fields.find(f => f.id === fieldId);

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
    if (field.type === 'file') {
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
      populateFieldValue(secId, fieldId, value);
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

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  toast.textContent = msg;
  toast.style.transform = 'translateX(-50%) translateY(0px)';
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(100px)';
  }, 3000);
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
