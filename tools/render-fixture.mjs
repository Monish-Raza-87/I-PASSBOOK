// Build a standalone page out of the app's REAL rendered markup, so
// tools/render-check.mjs can measure the app's own output at phone widths without
// booting the app (no backend, no service worker, no intro video, no sign-in).
//
//   node tools/render-fixture.mjs
//   node tools/render-check.mjs "%TEMP%/ipassbook-render/app.html"
//
// It runs app.js under tools/harness.mjs's stub DOM, calls the real renderers over
// a fixture, and writes their innerHTML into a page that links the app's six
// stylesheets. What is measured is therefore the app's own markup and the app's own
// cascade — not a mock-up of them, which is the only kind of render check worth
// having.
//
// ── It writes OUTSIDE the repository, on purpose ──────────────────────────────
//
// It used to write `_render-check.html` into the repo root, and every commit then
// depended on remembering to delete it — `deploy-ghpages.mjs` refuses a dirty tree,
// so a forgotten scratch file was a blocked deploy. The stylesheets are referenced
// by absolute file:// URL instead of a relative path precisely so the page can live
// in the OS temp directory.
//
// ── The fixture is a SPREAD, not a realistic day ─────────────────────────────
//
// Ten IRs chosen to hit the shapes the layout has to survive: the longest assignee
// name, a ticket carrying every chip, an IR with no date, one with no assignee at
// all, and one with three of six sections saved. A tidy fixture renders tidily and
// proves nothing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadApp } from './harness.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
// The flight-log reader is a plain script loaded before app.js, and the log pane
// and the limits panel are BOTH built from it (window.DataFlash.TUNED is the field
// list, so the panel and the scorer cannot disagree about which numbers exist).
// Evaluated inside the sandbox, the way index.html loads it.
const DATAPLASH_SRC = fs.readFileSync(path.join(ROOT, 'dataflash.js'), 'utf8');
const outDir = path.join(os.tmpdir(), 'ipassbook-render');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'app.html');

const DAY = 86400000, NOW = Date.now();
const { T, byId } = loadApp(`
  renderInsights, renderIRList, renderBannerMeta, renderOverviewFacts,
  INSIGHTS_ALL, SECTION_IDS, sectionProgress,
  get allIRs(){return allIRs;}, set allIRs(v){allIRs=v;},
  get currentIR(){return currentIR;}, set currentIR(v){currentIR=v;},
  get currentView(){return currentView;}, set currentView(v){currentView=v;},
  get insightsFilters(){return insightsFilters;}, set insightsFilters(v){insightsFilters=v;},
  get _dataIsDemo(){return _dataIsDemo;}, set _dataIsDemo(v){_dataIsDemo=v;},
  irList,
  openAccessModal, renderCustomersTab, renderPeopleTab, renderDepartmentsTab,
  set accessTab(v){accessTab=v;},
  set accessCache(v){accessCache=v;},
  get currentUser(){return currentUser;}, set currentUser(v){currentUser=v;},
`, { capture: true });

const ALL = T.INSIGHTS_ALL;
const iso = n => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const mk = (n, o) => ({ irNumber: 'IR' + n, status: 'Open', ...o });

const FIXTURE = [
  mk(601, { dateRaisedISO: iso(300), status: 'Open', assigneeName: 'Ravi Singh', category: 'REPAIR',
            priority: 'High', statusAt: NOW - 32 * DAY, done: ['sec-b', 'sec-c', 'sec-d'] }),
  mk(602, { dateRaisedISO: iso(250), status: 'Hold', assigneeName: 'Ravi Singh', category: 'CRASH', priority: 'Low' }),
  mk(603, { dateRaisedISO: iso(200), status: 'QC', assigneeName: 'Adhik Nair', category: 'GENERAL MAINTENANCE' }),
  mk(604, { dateRaisedISO: iso(150), status: 'Delivered', assigneeName: 'Adhik Nair', category: 'REPAIR', done: ['sec-b'] }),
  mk(605, { dateRaisedISO: iso(120), status: 'Open', assigneeName: 'Mohd Abdul Raza', category: 'REMOTE SUPPORT',
            priority: 'Urgent', statusAt: NOW - 42 * DAY }),
  mk(606, { dateRaisedISO: iso(90), status: 'Production', category: 'REPAIR' }),
  mk(607, { dateRaisedISO: iso(40), status: 'Visual Inspection', assigneeName: 'Ravi Singh' }),
  mk(608, { dateRaisedISO: iso(10), status: 'Close', assigneeName: 'Adhik Nair', category: 'CRASH', done: T.SECTION_IDS }),
  mk(609, { dateRaisedISO: '', status: 'Open', assigneeName: 'Ravi Singh', category: 'REPAIR' }),
  mk(610, { dateRaisedISO: iso(5), status: 'PDI' }),
];

T.allIRs = FIXTURE;
T.insightsFilters = { fy: ALL, month: ALL, status: ALL, category: ALL, customer: ALL, drone: ALL };
T._dataIsDemo = false;
T.renderInsights();
const insights = byId.get('insights-body').innerHTML;

T.currentIR = FIXTURE[0];
T.currentView = 'detail';
T.renderBannerMeta();
const banner = byId.get('ir-banner-pills').innerHTML;

T.renderIRList(FIXTURE);
const list = byId.get('ir-list').innerHTML;

// ── The detail pane's Overview, which is the one place a look RE-MAPS a shape ──
// industrial.css's datagrid section rewrites `.overview-facts` from a grey block into
// the panel's own ruled field grid. That is the single piece of real layout work in
// that file and, until this, nothing rendered it: the app fixture carried a banner and
// nothing under it, so the one rule that could break the pane was the one rule no
// screenshot could show. `renderOverviewFacts()` is called here rather than the grid
// being re-typed, so what is measured is the app's own markup.
//
// The panel itself is taken from index.html by DEPTH — the same reason the customer
// door below is, and the same helper does it: the block holds nested divs, so a
// non-greedy regex would stop at the first `</div>` and measure a third of the card.
function sliceBlock(marker, label) {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`${label} is not in index.html`);
  let depth = 0, i = start;
  while (i < src.length) {
    if (src.startsWith('<div', i)) { depth++; i += 4; continue; }
    if (src.startsWith('</div>', i)) { depth--; i += 6; if (!depth) break; continue; }
    i++;
  }
  if (depth) throw new Error(`unbalanced <div> in ${label}`);
  return src.slice(start, i);
}
const overviewBlock = sliceBlock('<div id="ir-overview" class="overview-panel">', 'the Overview panel');
const tabsBlock = sliceBlock('<div class="tabs-container" id="section-tabs">', 'the section tabs');
// The harness's stub DOM answers getElementById from one flat map, creating the element
// on first ask — so the renderer writes into a stub node and the result is read back out
// of it, which is how every other panel on this page is obtained.
T.renderOverviewFacts();
const overview = overviewBlock.replace(
  '<div id="ir-overview-facts"></div>',
  `<div id="ir-overview-facts">${byId.get('ir-overview-facts').innerHTML}</div>`);

const css = ['tokens.css', 'palette.css', 'theme.css', 'base.css', 'components.css', 'views.css', 'industrial.css']
  .map(f => `<link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, f)).href}">`).join('\n');

// ── The customer door, forced open ───────────────────────────────────────────
// Extracted from index.html by DEPTH, not by a lazy regex: the modal contains
// nested divs, and a non-greedy match would stop at the first `</div>` and
// measure a third of the card. This is the app's own markup and the app's own
// cascade — the only kind of render check worth having.
const doorBlock = (() => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('<div class="customer-door" id="customer-door"');
  if (start === -1) throw new Error('the customer door is not in index.html');
  let depth = 0, i = start;
  while (i < html.length) {
    if (html.startsWith('<div', i)) { depth++; i += 4; continue; }
    if (html.startsWith('</div>', i)) { depth--; i += 6; if (!depth) break; continue; }
    i++;
  }
  if (depth) throw new Error('unbalanced <div> in the customer door block');
  // `display:none` is the shipped state; `flex` is what the open door sets.
  // The button's href is set by app.js from CUSTOMER_FORM_URL, which never runs in
  // a static fixture, so it is pasted in here. It costs nothing to measure — the
  // URL is not drawn — but a screenshot of a primary button pointing at "#" would
  // be a picture of a state the app never shows.
  const formUrl = (fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
    .match(/^const CUSTOMER_FORM_URL = '([^']*)';/m) || [])[1] || '#';
  return html.slice(start, i)
    .replace('style="display:none"', 'style="display:flex"')
    .replace('href="#"', `href="${formUrl}"`);
})();

fs.writeFileSync(outFile, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>app fixture</title>
${css}
</head><body>
<div id="insights-view" style="display:block"><div id="insights-body">${insights}</div></div>
<div id="detail-view" style="display:block"><div id="ir-banner">${banner}</div>
  <div class="section-content active">${overview}</div>
  ${tabsBlock}
</div>
<div id="index-view" style="display:block"><div id="ir-list">${list}</div></div>
<div style="padding:8px">
  <button class="btn is-busy" id="b1">Signing in…</button>
  <button class="btn saving" id="b2">Saving…</button>
  <button class="btn btn-secondary is-busy" id="b3">Save Section C</button>
</div>
</body></html>`);

// A second page: the same six stylesheets, and the door standing open. It is a
// separate file because the door is a FIXED overlay — on the page above it would
// sit over everything and every element underneath would be "past the edge" of
// its frame, which measures nothing.
const doorFile = path.join(outDir, 'door.html');
fs.writeFileSync(doorFile, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>customer door</title>
${css}
</head><body>
${doorBlock}
</body></html>`);

// ── The User Access modal, on the Customers tab ───────────────────────────────
// A third page, and a separate file for the same reason the door has one: the modal is
// a FIXED overlay, so on the page above it would sit over everything and every element
// underneath would read as "past the edge of its frame" — a measurement of nothing.
//
// The shell is taken from app.js's own openAccessModal() template literal rather than
// re-typed here, so what is measured is the app's markup and not a copy of it that can
// drift. It cannot be obtained by CALLING openAccessModal() under the harness: that
// function builds its element with document.createElement and appends it to body, and
// the stub DOM's appendChild is a no-op — the object it fills is thrown away.
//
// The roster and the ticket list are the shape a first sale really has: an admin, an
// active and a disabled staff member, two departments, two scoped customers, and four
// companies on the IRs — including a long one, which is what decides whether the panel
// survives a narrow column.
const ACCESS_USERS = [
  { email: 'monish.raza@indrones.com', name: 'Monish Raza', status: 'active', isAdmin: true,
    departments: [], customerOf: '', lastLoginAt: '07-Oct-2026 08:14' },
  { email: 'ravi@indrones.com', name: 'Ravi Singh', status: 'active', isAdmin: false,
    departments: ['qa'], customerOf: '', mustChangePassword: true, lastLoginAt: '' },
  { email: 'adhik@indrones.com', name: 'Adhik Nair', status: 'disabled', isAdmin: false,
    departments: ['prod'], customerOf: '', lastLoginAt: '02-Oct-2026 17:40' },
  { email: 'ops@agrikart.in', name: 'Asha Rao', status: 'active', isAdmin: false,
    departments: [], customerOf: 'AgriKart Pvt Ltd', lastLoginAt: '06-Oct-2026 11:02' },
  { email: 'support@farmvista.com', name: 'Vikram Iyer', status: 'active', isAdmin: false,
    departments: [], customerOf: 'FarmVista Solutions', lastLoginAt: '05-Oct-2026 09:30' },
];
const ACCESS_DEPTS = [
  { key: 'qa', name: 'Quality', grants: {} },
  { key: 'prod', name: 'Production', grants: {} },
];

T.accessCache = { users: ACCESS_USERS, departments: ACCESS_DEPTS, apiVersion: 8 };
T.allIRs = [
  // Two columns, as the intake form really has them: `customerName` is the person who
  // reported it, `companyName` is where they work. The company dropdown reads the second
  // — see knownCompanies() — so a fixture that named only the first would render an empty
  // dropdown here and nothing would notice.
  { irNumber: 'IR601', customerName: 'Asha Rao',      companyName: 'AgriKart Pvt Ltd' },
  { irNumber: 'IR602', customerName: 'Vikram Shah',   companyName: 'FarmVista Solutions' },
  { irNumber: 'IR603', customerName: 'Nisha Menon',   companyName: 'GreenField Agri Cooperative Society' },
  { irNumber: 'IR604', customerName: 'Ravi Kulkarni', companyName: 'SkyHarvest Corp' },
];

const accessShellTemplate = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const at = src.indexOf("<div class=\"access-card\">");
  if (at === -1) throw new Error('the User Access card is not in app.js');
  let depth = 0, i = at;
  while (i < src.length) {
    if (src.startsWith('<div', i)) { depth++; i += 4; continue; }
    if (src.startsWith('</div>', i)) { depth--; i += 6; if (!depth) break; continue; }
    i++;
  }
  if (depth) throw new Error('unbalanced <div> in the User Access card');
  const card = src.slice(at, i);
  if (card.indexOf('${') >= 0) throw new Error('the User Access card grew an interpolation; it can no longer be lifted out verbatim');
  return '<div class="inward-options-modal">' + card + '</div>';
})();

T.accessTab = 'customers';
T.renderCustomersTab();
const accessCustomers = byId.get('access-panels').innerHTML;
T.accessTab = 'people';
T.renderPeopleTab();
const accessPeople = byId.get('access-panels').innerHTML;

const withPanel = html => accessShellTemplate.replace(
  '<div class="access-body" id="access-panels"><div class="access-loading">Loading…</div></div>',
  '<div class="access-body" id="access-panels">' + html + '</div>');

const accessFile = path.join(outDir, 'access.html');
fs.writeFileSync(accessFile, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>user access — customers</title>
${css}
</head><body>
${withPanel(accessCustomers)}
</body></html>`);

const accessPeopleFile = path.join(outDir, 'access-people.html');
fs.writeFileSync(accessPeopleFile, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>user access — people</title>
${css}
</head><body>
${withPanel(accessPeople)}
</body></html>`);

console.log(outFile);
console.log(`  insights ${insights.length} bytes · banner ${banner.length} · list ${list.length}`);
console.log(accessFile);
console.log(`  customers panel ${accessCustomers.length} bytes · people panel ${accessPeople.length}`);
console.log(doorFile);
console.log(`  door ${doorBlock.length} bytes`);

// ── The landing page, with both doors standing open ──────────────────────────
// The one screen EVERYBODY sees, and the one that has to survive a phone: two cards
// side by side on a desktop and stacked on a 320px screen, each with a chip, a
// heading, a paragraph and a list on it. It is a separate page and NOT a slice of
// index.html rendered whole, because index.html cannot be measured at all: loaded
// over `file://` it fires a blocking `alert()` (app.js detects the local-file
// protocol and warns), and the renderer then never answers another CDP call — the
// tool hangs with no output, which reads exactly like a page with nothing wrong.
//
// The markup is index.html's own, cut between two named ids rather than by counting
// closing tags, so a third card or a deeper nest cannot silently shrink the slice.
const landingBlock = (() => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('<div id="auth-container">');
  const end = html.indexOf('<div id="password-change">');
  if (start === -1 || end === -1 || end < start) throw new Error('cannot slice the landing page out of index.html');
  // `display:none` is the shipped state; `flex` is what showAuth() sets on it.
  // The mark is referenced RELATIVELY in index.html and this page lives in the OS
  // temp directory, so it has to be made absolute here or it loads as a broken
  // image — a 76px hole where the logo is. The layout numbers would not notice; a
  // screenshot would, and would be a picture of a page that does not exist.
  return html.slice(start, end)
    .replace('<div id="auth-container">', '<div id="auth-container" style="display:flex">')
    .replace(/src="assets\//g, `src="${pathToFileURL(path.join(ROOT, 'assets')).href}/`);
})();
const landingFile = path.join(outDir, 'landing.html');
fs.writeFileSync(landingFile, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>landing page — two doors</title>
${css}
</head><body>
${landingBlock}
</body></html>`);
console.log(landingFile);
console.log(`  landing ${landingBlock.length} bytes`);

// ── The legacy record card, read-only ─────────────────────────────────────────
// The rows come from the app's OWN legacyGridHtml — the one function that turns a
// sheet grid into record markup — so what is measured is the app's output and the
// app's cascade, not a mock-up of them. The card shell around it is the same shape
// openLegacyRecord builds. The grid is a spread, not a tidy record: a single-cell
// banner, a multi-column row, and a description long enough to force wrapping,
// because those are the shapes that decide whether a phone scrolls sideways.
const LG = loadApp(`legacyGridHtml`);
const LEGACY_GRID = [
  ['I-PASSBOOK'],
  ['', ''],
  ['IR Number', 'IR310'],
  ['Drone Serial No', 'S25P023'],
  ['Date of Incident', '2025-03-14'],
  ['Customer / Operator', 'SREENIVAS PAI', '', '7828148298'],
  ['Problem Description', 'Drone lost GPS lock at 40m AGL during a spray run; RTL triggered and it landed hard on the left arm. Arm cracked, two propellers broken.'],
  ['Action Taken', 'Arm replaced, GPS module reseated, test flown two packs.'],
  ['', '', ''],
];
const legacyRows = LG.legacyGridHtml(LEGACY_GRID);
const legacyFile = path.join(outDir, 'legacy.html');
fs.writeFileSync(legacyFile, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>legacy record</title>
${css}
</head><body>
<div class="inward-options-modal" id="legacy-modal">
  <div class="legacy-card legacy-card-record">
    <div class="legacy-head">
      <div>
        <div class="legacy-title">🏛 Legacy I-PASSBOOK</div>
        <div class="legacy-sub">IR310 | S25P023 · read-only</div>
      </div>
      <button type="button" class="inward-options-close" title="Close">&times;</button>
    </div>
    <div class="legacy-record">
${legacyRows}
      <p class="legacy-link-note">The original is in a restricted workbook; this copy is read-only.
        <a href="#" class="url-open-btn">Open in Google Sheets ↗</a></p>
    </div>
  </div>
</div>
</body></html>`);
console.log(legacyFile);
console.log(`  legacy ${legacyRows.length} bytes of rows`);

// ── The board and the list as they are BEFORE anybody allots anything ─────────
// The fixture at the top of this file sets `status` directly on each record, which
// is the shape of a store where every ticket HAS a stage — the steady state once CR
// has walked them. This page is the other end: what the app shows the moment a list
// is fetched and nobody has touched it.
//
// It is a separate page, and a separate loadApp, because the records here have to
// carry `status: ''` and a legacy Col-D word in `initialStatus` — exactly what
// mapSheetRows produces (see the note there) — and then be pushed through the REAL
// merge. Hand-setting `status: 'Open'` would have proved nothing: the question this
// page answers is whether the merge puts it there, on every surface that draws it.
// Reading that off the source is not evidence; the release before last proved it.
const { T: OP, byId: opById } = loadApp(`
  applyIRStateToAllIRs, renderIRList, renderBoard, renderInsights, renderBannerMeta,
  INSIGHTS_ALL, SECTION_IDS,
  get allIRs(){return allIRs;}, set allIRs(v){allIRs=v;},
  get irState(){return irState;}, set irState(v){irState=v;},
  get currentIR(){return currentIR;}, set currentIR(v){currentIR=v;},
  get currentView(){return currentView;}, set currentView(v){currentView=v;},
  get insightsFilters(){return insightsFilters;}, set insightsFilters(v){insightsFilters=v;},
  get _dataIsDemo(){return _dataIsDemo;}, set _dataIsDemo(v){_dataIsDemo=v;},
  get irList(){return irList;},
`, { capture: true });

// `initialStatus` holds the words the desk actually stopped maintaining: retired
// stage names that no longer map to anything, plus a couple that still do. If the
// old adoption rule were alive, these are what would leak onto the screens.
const UNALLOTTED = [
  ['IR701', 'In Production',   { assigneeName: 'Ravi Singh',      category: 'REPAIR' }],
  ['IR702', 'QC Investigation',{ assigneeName: 'Adhik Nair' }],
  ['IR703', 'Open',            { assigneeName: 'Mohd Abdul Raza', category: 'REMOTE SUPPORT', priority: 'Urgent' }],
  ['IR704', 'Delivered',       { assigneeName: 'Ravi Singh',      category: 'CRASH', done: ['sec-b'] }],
  ['IR705', 'Closed',          {}],
  ['IR706', '',                { assigneeName: 'Adhik Nair',      category: 'GENERAL MAINTENANCE' }],
].map(([irNumber, initialStatus, o], i) => ({
  irNumber,
  initialStatus,
  status: '',                    // as mapSheetRows leaves it: app-owned, and empty
  dateRaisedISO: iso(i * 9 + 2),
  dateRaised: new Date(NOW - (i * 9 + 2) * DAY).toISOString().slice(0, 10),
  statusAt: null,
  droneId: 'S25P02' + i,
  ...o,
}));

OP.allIRs = UNALLOTTED;
OP.irState = {};                 // nobody has allotted anything
OP.applyIRStateToAllIRs();       // ← the merge under test
OP._dataIsDemo = false;
OP.insightsFilters = { fy: ALL, month: ALL, status: ALL, category: ALL, customer: ALL, drone: ALL };

OP.renderInsights();
const opInsights = opById.get('insights-body').innerHTML;
OP.currentIR = UNALLOTTED[0];
OP.currentView = 'detail';
OP.renderBannerMeta();
const opBanner = opById.get('ir-banner-pills').innerHTML;
OP.renderIRList(OP.allIRs);
const opList = opById.get('ir-list').innerHTML;
OP.renderBoard(OP.allIRs);
const opBoard = opById.get('ir-board').innerHTML;

const openFile = path.join(outDir, 'open.html');
fs.writeFileSync(openFile, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>nothing allotted</title>
${css}
</head><body>
<div id="index-view" style="display:block">
  <div id="ir-list">${opList}</div>
  <div id="ir-board">${opBoard}</div>
</div>
<div id="detail-view" style="display:block"><div id="ir-banner">${opBanner}</div></div>
<div id="insights-view" style="display:block"><div id="insights-body">${opInsights}</div></div>
</body></html>`);
console.log(openFile);
console.log(`  open ${opList.length} bytes of list · ${opBoard.length} of board · ${opInsights.length} of insights`);

// ── The Flight log pane, and the limits panel ─────────────────────────────────
// Both of these are the only screens in the app whose content is a TABLE-shaped
// thing at phone width — a score row with three fields on it, and a limits form
// with a label, an input and a unit — which is exactly the shape that has scrolled
// sideways before. The score block and the panel are drawn from the app's OWN
// renderers over a report with the app's own field names, so what is measured is
// the app's markup in the app's cascade.
//
// The report is a spread rather than a tidy one: a vibration detail long enough to
// force wrapping, a profile name longer than any real airframe, a finding that
// carries a source message (so the jump button is drawn) and one that does not.
// A clean fixture lays out cleanly and would prove nothing about the messy case.
const REPORT = {
  verdict: 'REVIEW',
  fileName: '2026-10-04 13-22-07.bin',
  fileBytes: 8412160,
  meta: {
    firmware: 'ArduCopter V4.5.7 (f1e4c9b0)',
    vehicle: 'S25',
    durationSeconds: 743,
    frames: 128456,
    skippedBytes: 0,
    truncated: false,
  },
  score: {
    total: 86,
    airframe: 'STRIVER MK-II LONG RANGE',
    profile: 'STRIVER MK-II LONG RANGE',
    parts: [
      { id: 'vibeX', label: 'X vibration', score: 100, band: 'green', detail: 'peak 12.4 m/s², watch above 30' },
      { id: 'vibeY', label: 'Y vibration', score: 92, band: 'green', detail: 'peak 21.8 m/s², watch above 30' },
      { id: 'vibeZ', label: 'Z vibration', score: 74, band: 'amber', detail: 'peak 38.1 m/s², watch above 30, fail above 60' },
      { id: 'current', label: 'Current', score: 61, band: 'amber', detail: '78.2 A held 6.4 s, watch above 70, fail above 90' },
      { id: 'motors', label: 'Motor balance', score: 100, band: 'green', detail: 'widest spread 84 µs' },
      { id: 'attitude', label: 'Attitude tracking', score: 96, band: 'green', detail: 'worst 11.2°' },
      { id: 'gps', label: 'GPS quality', score: 88, band: 'amber', detail: 'worst HDop 1.62, 11 satellites' },
    ],
    checklist: [
      { id: 'clipping', label: 'Accelerometer clipping', detail: 'IMU1 clipped 4 times, most at 41:12.', needsTick: true },
      { id: 'err', label: 'ERR subsystem codes', detail: 'EKF altitude and compass variance were raised.', needsTick: true },
    ],
    open: [
      { id: 'profile', label: 'Limits used', detail: 'Judged against STRIVER MK-II LONG RANGE.' },
      { id: 'voltage', label: 'Pack voltage', detail: 'No rule yet — recorded and shown, not scored.' },
      { id: 'res', label: 'Battery resistance', detail: 'No rule yet — recorded and shown, not scored.' },
      { id: 'norule', label: 'Battery temperature — no limit set', detail: 'The area is left out of the average until a number is set.' },
    ],
  },
  findings: [
    { severity: 'review', title: 'Z vibration reached 38.1 m/s²', atSeconds: 612, message: 'VIBE',
      detail: 'Above the 30 m/s² watch level and well under the 60 m/s² fail level. Worth a look at the motor mounts before the next flight.' },
    { severity: 'review', title: 'Current held 78.2 A for 6.4 s', message: 'BAT',
      detail: 'Longer than the 5 s the pack is rated to hold it for.' },
    { severity: 'note', title: 'Log ends mid-frame', detail: 'The file looks truncated — the last partial frame could not be read.' },
  ],
  parameters: [
    { message: 'VIBE', column: 'VibeX', unit: 'm/s²', count: 12840, min: 0.4, max: 12.4, mean: 1.8 },
    { message: 'VIBE', column: 'VibeY', unit: 'm/s²', count: 12840, min: 0.5, max: 21.8, mean: 2.1 },
    { message: 'BAT', column: 'Curr', unit: 'A', count: 6210, min: 0.1, max: 78.2, mean: 31.4 },
  ],
};

const { T: LG2, byId: lgById } = loadApp(`
  renderLog, logScoreHTML, logProfileNoteHTML, renderAnalyserLimitsBody,
  normaliseAnalyserConfig, isAdmin, ADMIN_EMAILS, SECTION_IDS,
  get logState() { return logState; },
  get allIRs() { return allIRs; }, set allIRs(v) { allIRs = v; },
  get analyserConfig() { return analyserConfig; }, set analyserConfig(v) { analyserConfig = v; },
  get _alDraft() { return _alDraft; }, set _alDraft(v) { _alDraft = v; },
  get _alProfile() { return _alProfile; }, set _alProfile(v) { _alProfile = v; },
  get currentUser() { return currentUser; }, set currentUser(v) { currentUser = v; },
  // The voltage and capacity lines on this page are built by the READER, not by this
  // fixture — a hand-typed stand-in would render just as prettily and prove nothing
  // about the real string, which is the one thing a rendered probe is for. So the
  // page scores a real (synthetic) flight through the real scorer and splices out
  // the two entries the pack produces.
  __fixturePackScore: pack => DataFlash.scoreFlightLog(
    { __messages: __fixtureMsgs, __time: { min: 1000, max: 1108 } }, [],
    DataFlash.resolveRules({ profiles: { STRIVER: pack } }, 'STRIVER')).score,
`, {
  capture: true,
  preload: DATAPLASH_SRC,
  globals: {
    // 100 A held for 108 s: 3000 mAh, a tenth of the pack declared below. A sample
    // every 2 s, so the trapezoid integration has a real series to work on.
    __fixtureMsgs: Array.from({ length: 55 }, (_, i) =>
      ({ _name: 'BAT', _t: 1000 + i * 2, Volt: 23.4, Curr: 100 })),
  },
});

LG2.currentUser = { email: LG2.ADMIN_EMAILS[0] };   // the panel is admin-only, so the fixture is an admin
LG2.allIRs = FIXTURE;
LG2.analyserConfig = LG2.normaliseAnalyserConfig({
  profiles: { STRIVER: { curReview: 70, curFail: 90, pwmSpread: 250 } },
  models: ['STRIVER'],
});
// The two lines the pack produces, as the reader actually writes them.
const packBits = LG2.__fixturePackScore({ cellsSeries: 6, packMah: 30000 });
REPORT.score.open = REPORT.score.open.filter(o => o.id !== 'voltage')
  .concat(packBits.open.filter(o => o.id === 'voltage'));
REPORT.score.checklist = packBits.checklist.filter(c => c.id === 'mah')
  .concat(REPORT.score.checklist);

LG2.logState.report = REPORT;
LG2.logState.model = 'STRIVER MK-II LONG RANGE';
LG2.logState.target = 'IR601';
LG2.logState.fileName = REPORT.fileName;
LG2.logState.fileSize = REPORT.fileBytes;
LG2.renderLog();
const logPane = lgById.get('log-body').innerHTML;

// The panel renders into #al-body through the app's real renderer. The card shell
// around it is the one openAnalyserLimitsModal builds — copied, not re-invented,
// because the shell is what decides whether the form has room at phone width.
// (openAnalyserLimitsModal itself cannot be called here: it bails if a
// `#analyser-limits-modal` already exists, and the capture stub auto-creates an
// element for every id it is asked for, so the guard is always true under test.)
LG2._alDraft = LG2.normaliseAnalyserConfig(LG2.analyserConfig);
LG2._alDraft.profiles.__default__ = { attTrack: 15, hdopFail: 2.0 };
LG2._alProfile = 'STRIVER';
LG2.renderAnalyserLimitsBody();
const alBody = lgById.get('al-body').innerHTML;

const logFile = path.join(outDir, 'log.html');
fs.writeFileSync(logFile, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>flight log pane</title>
${css}
</head><body>
<div id="log-view">
  <div class="list-toolbar">
    <div class="list-toolbar-top"><span class="list-title">Log Analyser</span></div>
  </div>
  <div id="log-body" class="log-body">${logPane}</div>
</div>
<div class="inward-options-modal" id="analyser-limits-modal" style="display:flex">
  <div class="inward-options-card">
    <div class="inward-options-head">
      <h3>Log limits</h3>
      <button type="button" class="inward-options-close">&times;</button>
    </div>
    <p class="inward-options-hint">The numbers a flight log is scored against, per airframe. They are stored privately and never appear in the app's published files.</p>
    <div class="inward-options-body" id="al-body">${alBody}</div>
    <div class="inward-options-foot">
      <button type="button" class="btn">Cancel</button>
      <button type="button" class="btn btn-primary">Save limits</button>
    </div>
  </div>
</div>
</body></html>`);
console.log(logFile);
console.log(`  log pane ${logPane.length} bytes · limits panel ${alBody.length} bytes`);
