/* ============================================================
   build-polish-preview.mjs — assemble the polish-level review page

   Emits tools/.cache/polish-preview.html, a self-contained page that renders the
   app's REAL components under three polish depths so the owner can pick one.

   Why this is generated rather than hand-written: the page has to look like the
   app, and a hand-copied stylesheet drifts the moment anyone edits views.css.
   So the tokens, the palette roles and every component rule shown here are read
   out of the app's own files at build time. If a rule is renamed in the app, the
   preview loses it (and the assertions below fail) rather than silently showing
   an older design.

   The one thing NOT copied is the polish itself — that is the decision the page
   exists to support, so it lives in this file, in the POLISH block below, using
   only the app's tokens.

   Usage:  node tools/build-polish-preview.mjs
   ============================================================ */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(join(ROOT, p), 'utf8');

const tokensCss = read('tokens.css');
const paletteCss = read('palette.css');
const baseCss = read('base.css');
const componentsCss = read('components.css');
const viewsCss = read('views.css');

// ── A minimal CSS block parser ───────────────────────────────────────────────
// Handles nesting (@supports/@media wrap further blocks), which a regex over
// `sel { body }` cannot do once a block contains braces.
function blocks(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const sel = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    if (!sel) { i = j; continue; }
    out.push({ sel, body: src.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

// ── Dark-theme output ────────────────────────────────────────────────────────
// The app stamps `data-theme="dark"` from a toggle; the artifact must ALSO honour
// the viewer's untouched "system" setting, where no attribute is stamped at all.
// So each dark rule is emitted twice: once behind the explicit stamp (the toggle
// wins over a light OS) and once behind the media query, guarded with :not() so
// an explicit light choice still beats a dark OS.
const DARK_SEL = /\[data-theme="dark"\]/g;
const LIGHT_GUARD = ':root:not([data-theme="light"])';

function emit(list) {
  let normal = '', dark = '';
  for (const b of list) {
    if (DARK_SEL.test(b.sel)) {
      DARK_SEL.lastIndex = 0;
      dark += `${b.sel} {${b.body}}\n`;
      dark += `${b.sel.replace(DARK_SEL, LIGHT_GUARD)} {${b.body}}\n`;
      continue;
    }
    DARK_SEL.lastIndex = 0;
    if (b.sel.startsWith('@supports') || b.sel.startsWith('@media')) {
      const inner = emit(blocks(b.body));
      if (inner.normal) normal += `${b.sel} {${inner.normal}}\n`;
      if (inner.dark) dark += `${b.sel} {${inner.dark}}\n`;
      continue;
    }
    normal += `${b.sel} {${b.body}}\n`;
  }
  return { normal, dark };
}

function themed(css) {
  const { normal, dark } = emit(blocks(css));
  return normal + (dark ? `@media (prefers-color-scheme: dark) {\n${dark}}\n` : '');
}

// ── Which component rules to show ────────────────────────────────────────────
// Matched against each comma-separated part of a selector. A rule is kept whole
// if any part matches, so a grouped rule keeps the app's own grouping.
const WANTED = [
  /^\.btn(-[a-z0-9-]+)?(:[a-z-]+|\.(saving|saved|error)|\[disabled\])?$/,
  /^\.badge(-[a-z]+)?(::before|:hover)?$/,
  /^\.prio(-[a-z]+)?(::before)?$/,
  /^\.form-(group|label|input)(:hover|:focus|::placeholder|:disabled|\[readonly\])?$/,
  /^\.input-flat$/,
  /^\.field-lock(ed)?(-icon|-label)?$/,
  /^\.segments?(-cat|-count)?(::-[a-z-]+|:hover|\.active| .segment-count)?$/,
  /^\.tab(-icon|-label)?(\.active|:hover)?$/,
  /^\.tabs-container(::-[a-z-]+)?$/,
  /^\.ir-(card|card-main|card-side|card-hover|title-row|title|assignee|hover-text|meta|sn|cat|date|dot|summary-link)(:hover|:active|\.is-selected|::before)?$/,
  /^\.section-divider(:first-child)?$/,
  /^\.analysis-note$/,
  /^\.cc-note$/,
  /^\.acc-badge(-[a-z]+)?$/,
  /^\.auth-(head|brand|hint|error)$/,
  /modal/i,
];
const matches = sel => sel.split(',').map(s => s.trim()).some(part => WANTED.some(re => re.test(part)));

function pick(css) {
  const kept = [];
  for (const b of blocks(css)) {
    if (b.sel.startsWith('@supports') || b.sel.startsWith('@media')) {
      const inner = pick(b.body);
      if (inner) kept.push(`${b.sel} {${inner}}`);
      continue;
    }
    if (matches(b.sel)) kept.push(`${b.sel} {${b.body}}`);
  }
  return kept.join('\n');
}

const componentCss = themed(pick(baseCss) + '\n' + pick(componentsCss) + '\n' + pick(viewsCss));

// ── Fail loudly rather than shipping a preview that renders the wrong app ────
const required = ['.btn', '.ir-card', '.ir-card-hover', '.ir-assignee', '.badge',
  '.segment', '.tab', '.form-input', '.analysis-note', '.auth-brand'];
const missing = required.filter(sel => !componentCss.includes(sel + ' {') && !componentCss.includes(sel + ','));
if (missing.length) {
  console.error('These component rules were not found — did they get renamed?\n  ' + missing.join('\n  '));
  process.exit(1);
}

// ── The polish levels ────────────────────────────────────────────────────────
// Cumulative by construction: the base block is "Subtle" and applies at every
// level; each later block adds to the ones before it. Written this way so the
// three levels cannot drift into three unrelated designs — Noticeable is exactly
// Moderate plus its own layer, and Moderate is exactly Subtle plus its own.
const POLISH = `
/* ============================================================
   POLISH LEVELS

   Subtle applies always. Moderate adds on top of it. Noticeable adds on top of
   both. Nothing here introduces a colour: every value is one of the app's own
   tokens, so the levels stay on-palette and theme-aware for free.
   ============================================================ */

/* ── Subtle — the same flat language, better made ─────────────────────────────
   No new colour and no new shape. What changes is rhythm and separation: a real
   spacing scale instead of ad-hoc margins, one hairline to say "new block", and
   overlays that sit on the page rather than floating above it. */
.stage {
  --pv-gap: 1rem;
  --pv-pad: 1.35rem;
  --pv-block-r: var(--radius-5);
}
.pv-block {
  padding: var(--pv-pad);
  border: 1px solid var(--outline-gray-1);
  border-radius: var(--pv-block-r);
  background: var(--surface-base);
}
.pv-stack { display: flex; flex-direction: column; gap: var(--pv-gap); }
.pv-pane { padding: var(--pv-pad); }
.pv-label {
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-gray-5);
  margin-bottom: 0.5rem;
}
/* The modal's own backdrop, softened from the app's 65% to sit behind the page
   rather than erase it. */
.pv-scrim {
  background: var(--surface-alpha-gray-4);
  border-radius: var(--pv-block-r);
  padding: 1.5rem;
  display: grid;
  place-items: center;
}

/* ── Moderate — tinted surfaces, a real page header, accent active states ──── */
.stage[data-polish="moderate"],
.stage[data-polish="noticeable"] { --pv-gap: 1.25rem; --pv-pad: 1.6rem; }

.stage[data-polish="moderate"] .pv-pagehead,
.stage[data-polish="noticeable"] .pv-pagehead {
  padding: 1.2rem var(--pv-pad);
  background: var(--surface-gray-1);
  border-bottom: 1px solid var(--outline-gray-1);
  border-radius: var(--pv-block-r) var(--pv-block-r) 0 0;
}
.pv-eyebrow {
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
}
.pv-title {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-xl);
  color: var(--ink-gray-9);
  margin: 0.15rem 0 0.2rem;
  text-wrap: balance;
}
.pv-sub { font-size: var(--text-sm); color: var(--ink-gray-6); }

/* Accent-coloured active states. This is the change the owner will notice most:
   today every "you are here" state in the app is grey. */
.stage[data-polish="moderate"] .segment.active,
.stage[data-polish="noticeable"] .segment.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.stage[data-polish="moderate"] .segment.active .segment-count,
.stage[data-polish="noticeable"] .segment.active .segment-count { color: var(--accent); }
.stage[data-polish="moderate"] .tab.active,
.stage[data-polish="noticeable"] .tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.stage[data-polish="moderate"] .ir-card.is-selected::before,
.stage[data-polish="noticeable"] .ir-card.is-selected::before { background: var(--accent); }
.stage[data-polish="moderate"] .ir-card.is-selected,
.stage[data-polish="noticeable"] .ir-card.is-selected { background: var(--accent-soft); }

/* ── Noticeable — depth, motion, a gradient ground ──────────────────────────── */
.stage[data-polish="noticeable"] .pv-block {
  box-shadow: var(--elevation-md);
  border-color: var(--outline-gray-2);
}
.stage[data-polish="noticeable"] .pv-pagehead {
  background: linear-gradient(120deg, var(--accent-soft), var(--surface-base) 70%);
}
.stage[data-polish="noticeable"] .ir-card { transition: transform 0.14s var(--ease), background 0.14s var(--ease); }
.stage[data-polish="noticeable"] .ir-card:hover { transform: translateX(3px); }
.stage[data-polish="noticeable"] .btn-primary { box-shadow: var(--elevation-sm); }
.stage[data-polish="noticeable"] .analysis-note { border-left-width: 4px; }
`;

// ── Preview chrome ───────────────────────────────────────────────────────────
// Deliberately quiet and NOT part of any polish level: the frame must not be
// mistaken for the design under review.
const CHROME = `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--surface-gray-1);
  color: var(--ink-gray-9);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}
.pv-wrap { max-width: 1180px; margin: 0 auto; padding-block: 0 4rem; padding-inline: 20px; }

.pv-bar {
  position: sticky; top: 0; z-index: var(--z-header);
  background: var(--surface-base);
  border-bottom: 1px solid var(--outline-gray-1);
  padding-top: env(safe-area-inset-top, 0px);
}
.pv-bar-in {
  max-width: 1180px; margin: 0 auto; padding: 0.7rem 20px;
  display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
}
.pv-brand { font-weight: var(--weight-semibold); letter-spacing: -0.01em; margin-right: auto; }
.pv-brand span { color: var(--ink-gray-5); font-weight: var(--weight-regular); font-size: var(--text-sm); }

.pv-ctl { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); }
.pv-ctl button {
  font: inherit; font-size: var(--text-sm); color: var(--ink-gray-6);
  background: none; border: 0; padding: 0.28rem 0.6rem; border-radius: var(--radius-3); cursor: pointer;
}
.pv-ctl button:hover { background: var(--surface-gray-2); color: var(--ink-gray-9); }
.pv-ctl button[aria-pressed="true"] { background: var(--surface-gray-10); color: var(--ink-base); }

.pv-sw { display: flex; gap: 4px; padding: 2px; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); }
.pv-sw button {
  width: 26px; height: 24px; border: 1px solid transparent; border-radius: var(--radius-3);
  cursor: pointer; background: none; padding: 0; display: grid; place-items: center;
}
.pv-sw button i { width: 14px; height: 14px; border-radius: var(--radius-full); display: block; border: 1px solid var(--outline-gray-3); }
.pv-sw button[aria-pressed="true"] { border-color: var(--ink-gray-7); }

.pv-sec { margin-top: 2.25rem; }
.pv-sec > h2 {
  font-size: var(--text-lg); font-weight: var(--weight-semibold); margin: 0 0 0.2rem;
  letter-spacing: var(--tracking-lg);
}
.pv-sec > p { margin: 0 0 1rem; color: var(--ink-gray-6); font-size: var(--text-sm); max-width: 68ch; }

.pv-trio { display: grid; gap: 1rem; grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 900px) { .pv-trio { grid-template-columns: 1fr; } }
.pv-trio > div { min-width: 0; }
.pv-trio h3 {
  font-size: var(--text-sm); font-weight: var(--weight-semibold); margin: 0 0 0.5rem;
  display: flex; align-items: baseline; gap: 0.4rem;
}
.pv-trio h3 em { font-style: normal; font-weight: var(--weight-regular); font-size: var(--text-xs); color: var(--ink-gray-5); }
.pv-flat { border: 1px solid var(--outline-gray-1); border-radius: var(--radius-4); overflow: hidden; background: var(--surface-base); }
.pv-flat .ir-card { border-bottom: 0; }

.pv-grid2 { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 760px) { .pv-grid2 { grid-template-columns: 1fr; } }
.pv-row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.pv-note { font-size: var(--text-xs); color: var(--ink-gray-5); margin-top: 0.6rem; }

.pv-tickethead {
  display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
  padding: 0.85rem var(--pv-pad); border-bottom: 1px solid var(--outline-gray-1);
}
.pv-ticketnum { font-size: var(--text-md); font-weight: var(--weight-semibold); letter-spacing: -0.01em; }
.pv-actions { margin-left: auto; display: flex; gap: 0.4rem; }
.pv-actions .btn { width: auto; }

.pv-field { display: flex; flex-direction: column; }
.pv-login { max-width: 340px; margin: 0 auto; }
.pv-login .form-input { margin-bottom: 0.6rem; }
.pv-mark {
  width: 46px; height: 46px; margin: 0 auto 0.9rem; border-radius: var(--radius-5);
  background: var(--accent); color: var(--btn-solid-fg);
  display: grid; place-items: center; font-weight: var(--weight-bold); font-size: var(--text-lg);
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;

// ── Sample data ──────────────────────────────────────────────────────────────
// The app's own demo rows (getDemoIRs in app.js), so the preview shows exactly
// the records a signed-in user sees before the backend is connected — and
// plainly not anyone's real tickets.
// `own` is a full name, not initials: the row shows the assignee's name in the
// space to the right of the IR number, and shows the rest of the ticket's detail
// on hover. The preview has to render the SAME markup the app does (see
// renderIRList) or the owner reviews a look the app does not have.
const IRS = [
  { n: 'IR409', drone: 'S25P014', cat: 'Hardware Damage', date: '2025-10-01', status: 'In Production', cls: 'badge-open', prio: 'High', own: 'Monish Raza', age: '2d', late: false, prog: '4' },
  { n: 'IR408', drone: 'S100-003', cat: 'Firmware Issue', date: '2025-09-28', status: 'QC Investigation', cls: 'badge-pending', prio: 'Medium', own: 'Ravi Singh', age: '5d', late: false, prog: '2' },
  { n: 'IR407', drone: 'S25P017', cat: 'Battery Issue', date: '2025-09-20', status: 'Open', cls: 'badge-open', prio: 'Urgent', own: 'Adhik Nair', age: '13d', late: true, prog: '1' },
  { n: 'IR405', drone: 'S25P040', cat: 'RMA / Return', date: '2025-09-10', status: 'Closed', cls: 'badge-closed', prio: '', own: 'Ravi Singh', age: '23d', late: false, prog: '6' },
];

const card = ir => `
  <div class="ir-card">
    <div class="ir-card-main">
      <div class="ir-title-row">
        <span class="ir-title">${ir.n}</span>
        <span class="ir-assignee" title="Assigned to ${ir.own}">${ir.own}</span>
      </div>
      <div class="ir-meta">
        <span class="ir-sn">${ir.drone}</span>
        <span class="ir-dot">·</span><span class="ir-cat">${ir.cat}</span>
        <span class="ir-dot">·</span><span class="ir-date">${ir.date}</span>
        <span class="ir-dot">·</span><span class="ir-age${ir.late ? ' is-late' : ''}">${ir.age}</span>
      </div>
      <div class="ir-card-hover">
        <span class="ir-hover-text">Assigned to ${ir.own} · ${ir.drone} · ${ir.cat} · ${ir.date} · ${ir.age}${ir.late ? ' · overdue' : ''}</span>
        <a href="#" class="ir-summary-link" onclick="return false">View Summary ↗</a>
      </div>
    </div>
    <div class="ir-card-side">
      ${ir.prio ? `<span class="prio prio-${ir.prio.toLowerCase()}">${ir.prio}</span>` : ''}
      <span class="badge ${ir.cls}">${ir.status}</span>
      ${ir.late ? '<span class="badge badge-danger" title="Past its target date">Overdue</span>' : ''}
      <span class="ir-progress p${ir.prog}"><span class="ir-progress-bar"></span><span class="ir-progress-text">${ir.prog}/6</span></span>
    </div>
  </div>`;

// The full component set, rendered at whatever level the switcher selects.
const STAGE = level => `
<div class="stage" data-polish="${level}">
  <div class="pv-block" style="padding:0">
    <div class="pv-pagehead">
      <div class="pv-eyebrow">After-Sales · Master Index</div>
      <h1 class="pv-title">Service tickets</h1>
      <div class="pv-sub">442 records · 18 open · synced from the intake sheet</div>
    </div>

    <div class="pv-pane">
      <div class="segments">
        <button class="segment active">All <span class="segment-count">442</span></button>
        <button class="segment">Open <span class="segment-count">18</span></button>
        <button class="segment">Paused <span class="segment-count">6</span></button>
        <button class="segment">Resolved <span class="segment-count">311</span></button>
        <button class="segment">Closed <span class="segment-count">107</span></button>
      </div>

      <div class="tabs-container" style="margin-top:1rem">
        <button class="tab active">Overview</button>
        <button class="tab">Report</button>
        <button class="tab">Section A</button>
        <button class="tab">Section B</button>
      </div>
    </div>

    <div>${IRS.map((ir, i) => card(ir).replace('class="ir-card"', `class="ir-card${i === 1 ? ' is-selected' : ''}"`)).join('')}</div>
  </div>

  <div class="pv-grid2" style="margin-top:1.25rem">
    <div class="pv-block">
      <div class="pv-tickethead" style="padding-inline:0;border-bottom:0;padding-top:0">
        <span class="pv-ticketnum">IR409</span>
        <span class="badge badge-open">In Production</span>
        <span class="prio prio-high">High</span>
      </div>
      <div class="pv-actions" style="margin-left:0">
        <button class="btn btn-ghost">Comments</button>
        <button class="btn btn-ghost">History</button>
        <button class="btn btn-ghost">Legacy</button>
      </div>
      <div class="section-divider">Section B · Propulsion</div>
      <div class="pv-field">
        <label class="form-label" for="pv-f1">Motor serial number</label>
        <input class="form-input" id="pv-f1" value="MTR-8841-02">
      </div>
      <div class="pv-field" style="margin-top:0.9rem">
        <label class="form-label" for="pv-f2">Observation</label>
        <input class="form-input" id="pv-f2" placeholder="Not recorded yet">
      </div>
      <div class="analysis-note" style="margin-top:1rem">
        Arm crack propagated from the motor mount. Replacement arm issued and the
        unit re-flown before dispatch.
      </div>
      <div class="pv-row" style="margin-top:1rem">
        <button class="btn btn-primary" style="width:auto">Save</button>
        <button class="btn btn-secondary" style="width:auto">Reset</button>
      </div>
    </div>

    <div class="pv-block">
      <div class="pv-label">Status</div>
      <div class="pv-row">
        <span class="badge badge-open">Open</span>
        <span class="badge badge-pending">Paused</span>
        <span class="badge badge-resolved">Resolved</span>
        <span class="badge badge-closed">Closed</span>
        <span class="badge badge-legacy">Legacy</span>
        <span class="badge badge-danger">Escalated</span>
      </div>
      <div class="pv-label" style="margin-top:1.25rem">Priority</div>
      <div class="pv-row">
        <span class="prio prio-low">Low</span>
        <span class="prio prio-medium">Medium</span>
        <span class="prio prio-high">High</span>
        <span class="prio prio-urgent">Urgent</span>
      </div>
      <div class="pv-label" style="margin-top:1.25rem">Buttons</div>
      <div class="pv-row">
        <button class="btn" style="width:auto">Default</button>
        <button class="btn btn-primary" style="width:auto">Primary</button>
        <button class="btn btn-secondary" style="width:auto">Secondary</button>
        <button class="btn btn-danger" style="width:auto">Delete</button>
      </div>
      <div class="pv-note">Buttons and badges keep the app's own colours at every level — the accent moves with the palette, the meaning never does.</div>
    </div>
  </div>

  <div class="pv-grid2" style="margin-top:1.25rem">
    <div class="pv-block" style="padding:0">
      <div class="pv-label" style="padding:var(--pv-pad) var(--pv-pad) 0">Modal</div>
      <div class="pv-scrim" style="margin:0 var(--pv-pad) var(--pv-pad)">
        <div class="inward-options-modal" style="position:static;background:var(--surface-elevation-2);border:1px solid var(--outline-elevation-2);border-radius:var(--radius-5);padding:1.1rem;width:100%;max-width:330px">
          <div style="font-weight:var(--weight-semibold);margin-bottom:0.15rem">Triage IR409</div>
          <div class="pv-sub" style="margin-bottom:0.9rem">Status, owner and priority in one place.</div>
          <div class="pv-field">
            <label class="form-label" for="pv-f3">Status</label>
            <input class="form-input" id="pv-f3" value="In Production">
          </div>
          <div class="pv-field" style="margin-top:0.75rem">
            <label class="form-label" for="pv-f4">Assigned to</label>
            <input class="form-input" id="pv-f4" value="Monish Raza">
          </div>
          <div class="pv-row" style="margin-top:1rem;justify-content:flex-end">
            <button class="btn btn-secondary" style="width:auto">Cancel</button>
            <button class="btn btn-primary" style="width:auto">Save</button>
          </div>
        </div>
      </div>
    </div>

    <div class="pv-block">
      <div class="pv-label">Sign-in</div>
      <div class="pv-login">
        <div class="pv-mark">IP</div>
        <div class="auth-head" style="margin-bottom:1rem">
          <div class="auth-brand" style="display:flex;flex-direction:column;align-items:center;gap:2px">
            <strong style="font-size:var(--text-lg)">Sign in</strong>
            <span class="auth-hint">Accounts are created by an administrator.</span>
          </div>
        </div>
        <input class="form-input" placeholder="you@indrones.com" id="pv-f5">
        <input class="form-input" type="password" placeholder="Password" value="hunter2xy" id="pv-f6">
        <button class="btn btn-primary">Continue</button>
      </div>
    </div>
  </div>
</div>`;

// The three-up strip. Same card, same tokens, three depths — the comparison the
// owner asked for, without having to hold one in memory while looking at another.
const TRIO = ['subtle', 'moderate', 'noticeable'].map(l => `
  <div>
    <h3>${l[0].toUpperCase() + l.slice(1)}<em>${l === 'subtle' ? 'rhythm and separation only'
      : l === 'moderate' ? 'Subtle + tint, header, accent states'
        : 'Moderate + depth, motion, gradient'}</em></h3>
    <div class="stage" data-polish="${l}">
      <div class="pv-flat">${card(IRS[1])}</div>
    </div>
  </div>`).join('');

const html = `<title>I-PASSBOOK Polish Review</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap">
<style>
${themed(tokensCss)}
${paletteCss}
${componentCss}
${POLISH}
${CHROME}
</style>

<div class="pv-bar">
  <div class="pv-bar-in">
    <div class="pv-brand">I-PASSBOOK <span>· polish review</span></div>
    <div class="pv-ctl" role="group" aria-label="Polish level">
      <button data-level="subtle" aria-pressed="false">Subtle</button>
      <button data-level="moderate" aria-pressed="false">Moderate</button>
      <button data-level="noticeable" aria-pressed="true">Noticeable</button>
    </div>
    <div class="pv-ctl" role="group" aria-label="Theme">
      <button data-theme="light" aria-pressed="false">Light</button>
      <button data-theme="dark" aria-pressed="false">Dark</button>
      <button data-theme="system" aria-pressed="true">System</button>
    </div>
    <div class="pv-sw" role="group" aria-label="Accent colour">
      <button data-palette="blue" aria-pressed="true" title="Blue"><i style="background:var(--surface-blue-9)"></i></button>
      <button data-palette="violet" aria-pressed="false" title="Violet"><i style="background:var(--surface-violet-9)"></i></button>
      <button data-palette="teal" aria-pressed="false" title="Teal"><i style="background:var(--surface-teal-9)"></i></button>
      <button data-palette="graphite" aria-pressed="false" title="Graphite"><i style="background:var(--surface-gray-10)"></i></button>
    </div>
  </div>
</div>

<div class="pv-wrap">
  <div class="pv-sec">
    <h2>The same ticket, three ways</h2>
    <p>One record, one set of tokens, three depths. Everything below is the app's own
       component CSS — only the polish layer differs between the columns.</p>
    <div class="pv-trio">${TRIO}</div>
  </div>

  <div class="pv-sec">
    <h2>Every screen at <span id="pv-level-name">Moderate</span></h2>
    <p>The full component set at the level selected above. Switch the accent to see how far
       the colour reaches: buttons, links, the note's edge rule, active tabs and segments.</p>
    <div id="pv-stage">${STAGE('moderate')}</div>
  </div>

  <div class="pv-sec">
    <p class="pv-note">Records shown are the app's built-in demo rows, not real tickets.
       Accent colours are the four presets shipping with this change.</p>
  </div>
</div>

<script>
(function () {
  var KEY = 'ipassbook-polish-preview';
  var state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { state = {}; }
  if (!state.level) state.level = 'noticeable';   // the level the owner chose
  if (!state.theme) state.theme = 'system';
  if (!state.palette) state.palette = 'blue';

  var root = document.documentElement;
  var stage = document.getElementById('pv-stage');
  var levelName = document.getElementById('pv-level-name');

  // The stage markup is authored once and re-rendered per level. Captured from
  // the DOM rather than duplicated in the source, so the three levels can never
  // be shown different components.
  var tpl = stage.innerHTML;

  function render() {
    stage.innerHTML = tpl.replace('data-polish="moderate"', 'data-polish="' + state.level + '"');
    levelName.textContent = state.level[0].toUpperCase() + state.level.slice(1);
    document.querySelectorAll('[data-level]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.level === state.level));
    });
    document.querySelectorAll('[data-theme]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.theme === state.theme));
    });
    document.querySelectorAll('[data-palette]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.palette === state.palette));
    });
  }

  function applyTheme() {
    if (state.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);
  }

  function applyPalette() { root.setAttribute('data-palette', state.palette); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* viewer's storage is not ours to rely on */ }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.level) { state.level = b.dataset.level; render(); }
    else if (b.dataset.theme) { state.theme = b.dataset.theme; applyTheme(); render(); }
    else if (b.dataset.palette) { state.palette = b.dataset.palette; applyPalette(); render(); }
    else return;
    save();
  });

  applyTheme();
  applyPalette();
  render();
})();
</script>
`;

fs.mkdirSync(join(ROOT, 'tools', '.cache'), { recursive: true });
const out = join(ROOT, 'tools', '.cache', 'polish-preview.html');
fs.writeFileSync(out, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`polish-preview.html written — ${kb} KB, ${html.split('\n').length} lines.`);
console.log(`  ${(html.match(/<style>/g) || []).length} style block, ${(html.match(/<script/g) || []).length} script block`);
