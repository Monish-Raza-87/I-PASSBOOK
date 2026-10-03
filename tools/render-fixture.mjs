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
const outDir = path.join(os.tmpdir(), 'ipassbook-render');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'app.html');

const DAY = 86400000, NOW = Date.now();
const { T, byId } = loadApp(`
  renderInsights, renderIRList, renderBannerMeta,
  INSIGHTS_ALL, SECTION_IDS, sectionProgress,
  get allIRs(){return allIRs;}, set allIRs(v){allIRs=v;},
  get currentIR(){return currentIR;}, set currentIR(v){currentIR=v;},
  get currentView(){return currentView;}, set currentView(v){currentView=v;},
  get insightsFilters(){return insightsFilters;}, set insightsFilters(v){insightsFilters=v;},
  get _dataIsDemo(){return _dataIsDemo;}, set _dataIsDemo(v){_dataIsDemo=v;},
  irList,
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

const css = ['tokens.css', 'palette.css', 'theme.css', 'base.css', 'components.css', 'views.css', 'desk.css']
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
<div id="detail-view" style="display:block"><div id="ir-banner">${banner}</div></div>
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

console.log(outFile);
console.log(`  insights ${insights.length} bytes · banner ${banner.length} · list ${list.length}`);
console.log(doorFile);
console.log(`  door ${doorBlock.length} bytes`);

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
