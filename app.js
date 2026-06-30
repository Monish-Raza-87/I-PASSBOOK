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

  document.getElementById('ir-banner-title').textContent = irNumber;
  document.getElementById('ir-banner-sub').textContent =
    `${currentIR.droneId || '—'} · ${currentIR.customerName || '—'} · Status: ${currentIR.status || 'Open'}`;

  indexView.style.display = 'none';
  detailView.style.display = 'flex';
  backBtn.style.display = 'block';
  headerTitle.textContent = irNumber;

  // Build all section forms
  buildSectionForms(irNumber);

  // Load saved data for this IR
  await loadSectionData(irNumber);
}

// Back button
backBtn.addEventListener('click', showIndex);

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
      { id: 'b_receivedDate', label: 'Date of Inward',  type: 'date' },
      { id: 'b_receivedBy',   label: 'Received By (Inventory Staff)', type: 'text', placeholder: 'Staff name' },
      { id: 'b_trackingNo',   label: 'Inward Tracking No. / Courier', type: 'text', placeholder: 'AWB or docket number' },
      {
        id: 'b_checklist', label: 'Items Received', type: 'checklist',
        items: [
          'Air Vehicle (Drone Frame)',
          'Flight Controller',
          'Battery Pack (1)',
          'Battery Pack (2)',
          'Battery Pack (3)',
          'Battery Charger',
          'Remote Controller',
          'Propellers Set',
          'Case / Carry Bag',
          'Accessories / Others',
        ]
      },
      { id: 'b_inwardPhotos', label: 'Inward Photos',   type: 'file', multiple: true },
      { id: 'b_remarks',      label: 'Inventory Remarks', type: 'textarea', placeholder: 'Condition at receiving, missing items, etc.' },
    ]
  },
  'sec-c': {
    title: 'Section C — IQC Inspection',
    fields: [
      { id: 'c_iqcDate',       label: 'Inspection Date', type: 'date' },
      { id: 'c_iqcBy',         label: 'IQC Inspector',   type: 'text', placeholder: 'Inspector name' },
      { id: 'c_externalDmg',   label: 'External Damage Observed', type: 'textarea', placeholder: 'Cracks, dents, broken parts...' },
      { id: 'c_electricalDmg', label: 'Electrical / PCB Damage',  type: 'textarea', placeholder: 'Burnt components, corrosion...' },
      { id: 'c_iqcPhotos',     label: 'IQC Inspection Photos',    type: 'file', multiple: true },
      { id: 'c_iqcObservation',label: 'Overall IQC Observation',  type: 'textarea', placeholder: 'Summary of findings...' },
      { id: 'c_iqcResult',     label: 'IQC Result',               type: 'select', options: ['Pass – Proceed to Tech Analysis','Fail – Return to Customer','Partial – Proceed with caution'] },
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
    if (field.type === 'activityTable') {
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

  const fieldValues = {};
  const fileFields  = [];

  for (const field of section.fields) {
    if (field.type === 'file') {
      const inp = document.getElementById(field.id);
      if (inp?.files?.length > 0) {
        fileFields.push({ id: field.id, files: inp.files });
      }
    } else if (field.type === 'checklist') {
      const checkValues = {};
      field.items.forEach((_, i) => {
        const el = document.getElementById(field.id + '_' + i);
        if (el) checkValues[field.items[i]] = el.value;
      });
      fieldValues[field.id] = checkValues;
    } else if (field.type === 'activityTable') {
      const body = document.getElementById(field.id + '-body');
      if (body) {
        const rows = body.querySelectorAll('.activity-table-row');
        const tableData = [];
        rows.forEach(row => {
          tableData.push({
            dayCount: row.querySelector('.act-day')?.value || '',
            date: row.querySelector('.act-date')?.value || '',
            activity: row.querySelector('.act-activity')?.value || '',
            remark: row.querySelector('.act-remark')?.value || '',
          });
        });
        fieldValues[field.id] = tableData;
      }
    } else {
      const el = document.getElementById(field.id);
      if (el) fieldValues[field.id] = el.value;
    }
  }

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
      showToast('Section saved successfully!');
    } else {
      throw new Error(data.message || 'Backend error');
    }
  } catch (err) {
    btn.textContent = '⚠ Retry Save';
    btn.className = 'btn error';
    if (btnTop) { btnTop.textContent = '⚠ Retry Save'; btnTop.className = 'btn error'; }
    showToast('❌ Save failed: ' + err.message);
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
