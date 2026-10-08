/* ============================================================
   build-ui-options.mjs — assemble the three UI direction pages

   Emits, for the owner to review on his phone:

     preview/index.html   chooser — three cards, one per option
     preview/a.html       "Desk, finished"
     preview/b.html       "Indrones Industrial"
     preview/c.html       "Modern SaaS light"
     preview/preview.css  shared: tokens + skeleton (one file, hashed on link)

   WHY THIS IS GENERATED RATHER THAN HAND-WRITTEN

   The same reason tools/build-polish-preview.mjs is: a hand-copied mock drifts
   from the app the moment anyone edits a token, and then the owner picks a design
   that was never actually achievable. Here the COLOURS AND TYPE come out of
   tokens.css and palette.css at build time — the real files, concatenated — so
   every option can only use values the app already has. The classes in the
   markup are the app's own class names (.ir-card, .list-toolbar, .nav-item,
   .form-group, .insights-card …), and the assertions at the bottom of this file
   check each one still exists in the app's stylesheets. A rename in the app
   fails the build here rather than silently turning the preview into fiction.

   WHAT IS *NOT* COPIED

   The app's component stylesheets are deliberately NOT loaded. base.css,
   components.css and views.css would each fight the option skins rule-for-rule,
   and the point of the page is to show the SKIN. So:

     preview.css  = tokens.css + palette.css + a colour-free SKELETON (layout,
                    spacing and structure only — no colour, no radius, no shadow)
     <option>.css = the skin, inlined in the page, scoped to .pv

   One skeleton, three skins. That is also the honest shape of the real job: the
   layout does not change between these options, the language does.

   Usage:  node tools/build-ui-options.mjs
           node tools/build-ui-options.mjs --check   (verifies preview/ is current)

   These pages are COMMITTED and SERVED, unlike tools/.cache/polish-preview.html,
   because the owner reviews them on his phone rather than on this machine. That
   makes the output a build artifact in git, which is why `--check` exists and why
   tools/smoke-preview.mjs runs it: edit tokens.css, forget to rebuild, and the
   live review advertises colours the app no longer has.
   ============================================================ */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(join(ROOT, p), 'utf8');

const tokensCss  = read('tokens.css');
const paletteCss = read('palette.css');
const themeCss   = read('theme.css');
const baseCss    = read('base.css');
const appCss     = [baseCss, read('components.css'), read('views.css'), read('industrial.css')].join('\n');
const appSource  = read('app.js') + '\n' + read('index.html');

// The version the sign-in screen shows, read from the app rather than retyped.
// A preview that says v55 while the app says v56 is a small thing that makes the
// whole page feel untrustworthy, and it is exactly the kind of duplication that
// rots silently — nothing would ever have failed to tell us.
const APP_VERSION = (read('app.js').match(/const APP_VERSION\s*=\s*'([^']+)'/) || [])[1] || 'unknown';

// ── the classes this page mocks must be the app's real ones ──────────────────
// A preview built from invented class names would look like the app and share
// nothing with it, and the owner would approve a design that had to be redone
// from scratch. These are every class the SCREENS below put on an element.
//
// Checked against the app's STYLESHEETS **and its markup**, not stylesheets alone.
// `.ir-cat` and `.ir-date` are a real, load-bearing pair of classes that the app
// emits on every row and never writes a rule for — they simply inherit `.ir-meta`.
// Requiring a rule would have meant either inventing styles the app does not have
// or dropping the two classes the real rows carry, and both would make this page
// less faithful than the thing it is supposed to preview.
const REQUIRED = [
  'nav-item', 'nav-icon', 'nav-label', 'nav-count', 'sidebar-brand', 'brand-text',
  'list-toolbar', 'list-toolbar-top', 'list-title', 'list-count',
  'search-bar', 'segments', 'segment', 'segment-count',
  'ir-list', 'ir-card', 'ir-card-main', 'ir-title-row', 'ir-title', 'ir-assignee',
  'ir-meta', 'ir-sn', 'ir-dot', 'ir-cat', 'ir-date', 'ir-age', 'ir-card-side',
  'badge', 'prio',
  'glass-card', 'landing-head', 'landing-mark', 'landing-wordmark', 'landing-brand',
  'landing-full', 'wa-corner', 'wa-glyph',
  'doors', 'door', 'door-bar', 'door-role', 'door-chev', 'door-body', 'door-title',
  'landing-terms', 'landing-lang', 'landing-foot', 'auth-hint',
  'cust-welcome', 'cust-tagline', 'cust-lead', 'cust-helper', 'cust-unregistered',
  'code-card', 'code-title', 'code-sub', 'code-email', 'code-boxes', 'code-box',
  'form-input', 'btn', 'btn-ghost', 'btn-secondary', 'link-btn', 'link-sm', 'auth-or',
  'banner-main', 'banner-pills', 'banner-actions',
  'tabs-container', 'tab', 'section-content', 'section-title',
  'ir-progress', 'ir-progress-bar', 'ir-progress-text',
  'form-group', 'form-label', 'overview-panel', 'overview-head', 'overview-title',
  'insights-filters', 'insights-filter', 'insights-total', 'insights-cards',
  'insights-card', 'insights-card-n', 'insights-card-label',
  'insights-block', 'insights-h', 'insights-subcats', 'insights-subcat',
  'insights-subcat-n', 'insights-mix', 'insights-mix-row', 'insights-mix-n',
];
const hasClass = (c, src) => new RegExp('[\'"]' + c + '\\b|[\\s"]' + c + '(?![a-zA-Z0-9_-])').test(src);
const missing = REQUIRED.filter(c => !hasClass(c, appCss) && !hasClass(c, appSource));

// IDs are checked too, because two of the banner's three hooks are IDs in the
// real app (`#ir-banner`, `#ir-banner-title`) and a preview that renamed them to
// classes would be describing a screen the app does not have.
const REQUIRED_IDS = ['ir-banner', 'ir-banner-title', 'ir-banner-sub'];
const missingIds = REQUIRED_IDS.filter(id => !new RegExp('id="' + id + '"').test(appSource));

// ── the sample IRs the list and the ticket show ──────────────────────────────
// Real vocabulary throughout — the four real statuses, the four real categories,
// the real REPAIR sub-categories — so the owner is judging the design against
// rows that look like his rows, not against "Lorem Ipsum IR".
const ROWS = [
  { no: 'IR-412', sn: 'D25G-0114', cat: 'CRASH',             sub: '',        date: '12-Sep-2026', age: '19d', who: 'A. Sharma', prio: 'Urgent', status: 'Investigation', badge: 'badge-open',     late: false },
  { no: 'IR-409', sn: 'H25P-0032', cat: 'REPAIR',            sub: 'BATTERY', date: '08-Sep-2026', age: '23d', who: 'R. Kumar',  prio: 'High',   status: 'On Hold',          badge: 'badge-pending',  late: true  },
  { no: 'IR-407', sn: 'VTR-0007',  cat: 'GENERAL MAINTENANCE', sub: '',      date: '02-Sep-2026', age: '29d', who: 'P. Nair',   prio: 'Medium', status: 'Delivered',        badge: 'badge-resolved', late: false },
  { no: 'IR-401', sn: 'D10G-0221', cat: 'REMOTE SUPPORT',    sub: '',        date: '21-Aug-2026', age: '41d', who: '',          prio: 'Low',    status: 'Delivered',        badge: 'badge-closed',   late: false },
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── SCREENS ──────────────────────────────────────────────────────────────────
// Written ONCE. All four are rendered under every option, so the four pages
// differ by their stylesheet alone — which is what makes the comparison mean
// something. (Four hand-built mock-ups would differ in a dozen accidental ways
// and the owner would be picking between those, not between designs.)

const navItem = (id, label, count, active, glyph) => `
      <div class="nav-item${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>
        <span class="nav-icon" aria-hidden="true">${glyph}</span>
        <span class="nav-label">${label}</span>
        ${count ? `<span class="nav-count">${count}</span>` : ''}
      </div>`;

// The nav bar. It is a phone screenshot, so the sidebar is the bottom bar — the
// app turns #sidebar into one below 1024px and that is where the owner will see
// it. Rendered as the desktop rail here and as the bottom bar by the page's own
// media query, so one markup serves both.
const chromeBefore = active => `
    <div class="pv-app">
      <aside class="sidebar">
        <div class="sidebar-brand"><span class="brand-mark"></span><span class="brand-text">I-PASSBOOK</span></div>
        <nav class="sidebar-nav">
          ${navItem('tickets',  'IRs',           '412', active === 'tickets',  '')}
          ${navItem('insights', 'Insights',      '',    active === 'insights', '')}
          ${navItem('log',      'Log Analyser',  '',    active === 'log',      '')}
          <div class="nav-item"><span class="nav-icon" aria-hidden="true"></span><span class="nav-label">Legacy Records</span></div>
        </nav>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <div class="topbar-title">${active === 'insights' ? 'Insights' : active === 'log' ? 'Log Analyser' : 'I-PASSBOOK'}</div>
          <div class="header-actions"><span class="bell"></span><span class="avatar">MR</span></div>
        </header>`;

const chromeAfter = `
      </div>
    </div>`;

// The landing screen, redrawn to the markup index.html actually ships: one head over
// two STACKED doors, each one an accordion, then the acknowledgement and the language
// selector, then the shared foot. The old mock-up here was two cards side by side with
// a `quick-row` and a "Forgot password?" — a design that no longer exists anywhere, and
// a preview that shows a screen the app does not have is worse than no preview.
const doorBar = (role, open) => `
            <div class="door-bar"${open ? ' data-open="1"' : ''}>
              <span class="door-role">${role}</span><span class="door-chev"></span>
            </div>`;
const screenSignIn = () => `
    <div class="pv-app is-auth">
      <a class="wa-corner" aria-label="Chat with us on WhatsApp"><span class="wa-glyph"></span></a>
      <div class="auth-wrap">
        <header class="landing-head">
          <span class="landing-mark" aria-hidden="true"></span>
          <div class="landing-wordmark"><div class="landing-brand">I-PASSBOOK</div></div>
          <p class="landing-full">INDRONES-AFTER SALES SERVICE BOOK</p>
        </header>
        <div class="doors">
          <section class="door glass-card">
            ${doorBar('Employee', true)}
            <div class="door-body">
              <h2 class="door-title">Log in to I-PASSBOOK</h2>
              <input class="form-input" type="email" value="raza@indrones.com" readonly />
              <button type="button" class="btn">Continue</button>
              <div class="auth-or"><span>or</span></div>
              <button type="button" class="btn btn-secondary">Continue with Indrones&rsquo; official email</button>
              <button type="button" class="btn btn-secondary">Continue with fingerprint / passkey</button>
              <button type="button" class="btn btn-secondary">Continue with pattern</button>
              <button type="button" class="link-btn link-sm">First sign-in with a temporary password</button>
            </div>
          </section>
          <section class="door glass-card">
            ${doorBar('Customer', false)}
            <div class="door-body">
              <p class="cust-welcome">Welcome! This is I-PASSBOOK</p>
              <p class="cust-tagline">For Everything Related To Indrones&rsquo; After-Sales</p>
              <p class="cust-lead">Log in to your I-PASSBOOK account.</p>
              <input class="form-input" type="email" value="you@company.com" readonly />
              <p class="cust-helper">Use your official email registered with us while onboarding as a customer</p>
              <button type="button" class="btn">Continue</button>
              <div class="auth-or"><span>or</span></div>
              <p class="cust-unregistered">if you are not registered with us so far, contact customer.relations@indrones.com for onboarding. See you there!</p>
            </div>
          </section>
        </div>
        <p class="landing-terms">By continuing, you acknowledge that you understand and agree to the Terms &amp; Conditions and Privacy Policy</p>
        <div class="landing-lang"><select aria-label="Language"><option>English</option><option>&#1575;&#1585;&#1583;&#1608;</option><option>&#2361;&#2367;&#2306;&#2342;&#2368;</option></select></div>
        <p class="landing-foot">
          <span class="link-btn">Report a problem</span>
          <span class="link-btn">Help &amp; FAQ</span>
        </p>
        <p class="pv-version">${esc(APP_VERSION)}</p>
      </div>
    </div>`;

// The code step, which is a screen of its own — a sibling of the landing page, not a
// block inside either door, exactly as index.html has it. It is here because it is now
// the screen EVERY door passes through, so a design comparison that stopped at the
// landing page would be comparing the one screen nobody stays on.
const screenCode = () => `
    <div class="pv-app is-auth">
      <div id="code-view" data-open="1">
        <div class="glass-card code-card">
          <h2 class="code-title">Check your email</h2>
          <p class="code-sub"><span>If you have a indrones after sales account, we sent a code to</span>
            <strong class="code-email">raza@indrones.com</strong><span>.</span></p>
          <div class="code-boxes">${[0,1,2,3,4,5].map(() => '<input class="code-box" type="text" inputmode="numeric" maxlength="1" />').join('')}</div>
          <button type="button" class="link-btn">Use a different account</button>
        </div>
      </div>
    </div>`;

const screenList = () => `
    ${chromeBefore('tickets')}
        <div class="list-toolbar">
          <div class="list-toolbar-top">
            <span class="list-title">IRs</span>
            <span class="list-count">412</span>
          </div>
          <input class="search-bar" type="text" placeholder="Search by IR number or drone ID…" readonly />
          <div class="segments">
            <span class="segment active">All<span class="segment-count">412</span></span>
            <span class="segment">Open<span class="segment-count">37</span></span>
            <span class="segment">Paused<span class="segment-count">6</span></span>
            <span class="segment">Resolved<span class="segment-count">318</span></span>
            <span class="segment">Closed<span class="segment-count">51</span></span>
          </div>
          <div class="segments">
            <span class="segment">CRASH<span class="segment-count">9</span></span>
            <span class="segment">REPAIR<span class="segment-count">58</span></span>
            <span class="segment">GENERAL MAINTENANCE<span class="segment-count">121</span></span>
            <span class="segment">REMOTE SUPPORT<span class="segment-count">224</span></span>
          </div>
        </div>
        <div class="sync-status"><span class="sync-msg">Synced from the client sheet</span><span class="sync-meta">2m ago</span></div>
        <div class="ir-list">
          ${ROWS.map(r => `
          <div class="ir-card${r.no === 'IR-409' ? ' is-selected' : ''}">
            <div class="ir-card-main">
              <div class="ir-title-row">
                <span class="ir-title">${r.no}</span>
                ${r.who ? `<span class="ir-assignee">${r.who}</span>` : ''}
              </div>
              <div class="ir-meta">
                <span class="ir-sn">${r.sn}</span>
                <span class="ir-dot">·</span><span class="ir-cat">${r.cat}</span>
                ${r.sub ? `<span class="ir-dot">·</span><span class="ir-cat">${r.sub}</span>` : ''}
                <span class="ir-dot">·</span><span class="ir-date">${r.date}</span>
                <span class="ir-dot">·</span><span class="ir-age${r.late ? ' is-late' : ''}">${r.age}</span>
              </div>
            </div>
            <div class="ir-card-side">
              <span class="prio">${r.prio}</span>
              <span class="badge ${r.badge}">${r.status}</span>
              ${r.late ? '<span class="badge badge-danger">Overdue</span>' : ''}
            </div>
          </div>`).join('')}
        </div>
    ${chromeAfter}`;

const screenTicket = () => `
    ${chromeBefore('tickets')}
        <div id="ir-banner">
          <div class="banner-main">
            <div id="ir-banner-title">IR-409</div>
            <div id="ir-banner-sub">H25P-0032 · REPAIR · BATTERY · raised 08-Sep-2026</div>
            <div class="banner-pills">
              <span class="prio">High</span>
              <span class="badge badge-pending">On Hold</span>
              <span class="badge badge-danger">Overdue</span>
            </div>
          </div>
          <div class="banner-actions">
            <button type="button" class="btn-ghost">Allot CAPS</button>
            <button type="button" class="btn-ghost">Comments</button>
            <button type="button" class="btn-ghost">History</button>
          </div>
        </div>
        <div class="overview-panel">
          <div class="overview-head"><h2 class="overview-title">Overview</h2></div>
          <div class="overview-grid">
            <div class="overview-cell"><span class="overview-k">Customer</span><span class="overview-v">Oil India Ltd</span></div>
            <div class="overview-cell"><span class="overview-k">Drone</span><span class="overview-v">H25P-0032</span></div>
            <div class="overview-cell"><span class="overview-k">Reported fault</span><span class="overview-v">Flight time dropped to 11 min</span></div>
          </div>
        </div>
        <div class="tabs-container">
          <span class="tab">Report</span>
          <span class="tab active">B: Inward</span>
          <span class="tab">C: IQC</span>
          <span class="tab">D: Investigation</span>
          <span class="tab">E: Production</span>
          <span class="tab">F: Quality Test</span>
          <span class="tab">G: PDI/Dispatch</span>
        </div>
        <div class="section-content">
          <h2 class="section-title">Section B — Inward Checklist (Inventory)</h2>
          <div class="form-group">
            <label class="form-label">Inward Date</label>
            <input class="form-input" type="text" value="09-Sep-2026" readonly />
          </div>
          <div class="form-group">
            <label class="form-label">Inward By (Name)</label>
            <input class="form-input" type="text" value="Store — S. Iyer" readonly />
          </div>
          <div class="form-group">
            <label class="form-label">Remarks</label>
            <textarea class="form-input" rows="3" readonly>Battery pack swollen on cell 3. Received with charger and case. No visible impact damage to the airframe.</textarea>
          </div>
          <button type="button" class="btn">Save Section B</button>
          <div class="sec-export-row">
            <button type="button" class="btn btn-secondary">Download</button>
            <button type="button" class="btn btn-secondary">Download and share</button>
          </div>
        </div>
    ${chromeAfter}`;

const screenInsights = () => `
    ${chromeBefore('insights')}
        <div class="list-toolbar">
          <div class="list-toolbar-top"><span class="list-title">Insights</span></div>
        </div>
        <div class="insights-body">
          <div class="insights-filters">
            <label class="insights-filter"><span>Year</span><select class="form-input"><option>All years</option><option>FY 2026-27</option></select></label>
            <label class="insights-filter"><span>Month</span><select class="form-input"><option>All months</option><option>September</option></select></label>
            <label class="insights-filter"><span>Status</span><select class="form-input"><option>All statuses</option><option>Open</option></select></label>
            <label class="insights-filter"><span>Category</span><select class="form-input"><option>All categories</option><option>REPAIR</option></select></label>
          </div>
          <p class="insights-total"><strong>412</strong> IRs match these filters</p>
          <div class="insights-cards">
            <span class="insights-card active"><span class="insights-card-n">9</span><span class="insights-card-label">CRASH</span></span>
            <span class="insights-card"><span class="insights-card-n">58</span><span class="insights-card-label">REPAIR</span></span>
            <span class="insights-card"><span class="insights-card-n">121</span><span class="insights-card-label">GENERAL MAINTENANCE</span></span>
            <span class="insights-card"><span class="insights-card-n">224</span><span class="insights-card-label">REMOTE SUPPORT</span></span>
          </div>
          <div class="insights-block">
            <h3 class="insights-h">REPAIR — by sub-category</h3>
            <div class="insights-subcats">
              <span class="insights-subcat">GPS<span class="insights-subcat-n">12</span></span>
              <span class="insights-subcat">BATTERY<span class="insights-subcat-n">19</span></span>
              <span class="insights-subcat">CAMERA/LENS<span class="insights-subcat-n">8</span></span>
              <span class="insights-subcat">AIRFRAME<span class="insights-subcat-n">11</span></span>
              <span class="insights-subcat is-others">OTHERS<span class="insights-subcat-n">8</span></span>
            </div>
          </div>
          <div class="insights-block">
            <h3 class="insights-h">Status mix</h3>
            <div class="insights-mix">
              <span class="insights-mix-row"><span class="badge badge-open">Open</span><span class="insights-mix-n">37</span></span>
              <span class="insights-mix-row"><span class="badge badge-pending">Paused</span><span class="insights-mix-n">6</span></span>
              <span class="insights-mix-row"><span class="badge badge-resolved">Resolved</span><span class="insights-mix-n">318</span></span>
              <span class="insights-mix-row"><span class="badge badge-closed">Closed</span><span class="insights-mix-n">51</span></span>
            </div>
          </div>
        </div>
    ${chromeAfter}`;

const SCREENS = [
  { id: 'signin',   label: 'Sign-in',   note: 'two stacked doors, one of them open', html: screenSignIn },
  { id: 'code',     label: 'Code step', note: 'the screen both doors pass through',  html: screenCode },
  { id: 'list',     label: 'IR list',   note: '412 rows, filtered by status and category', html: screenList },
  { id: 'ticket',   label: 'Ticket',    note: 'banner, overview, tab strip, a section form', html: screenTicket },
  { id: 'insights', label: 'Insights',  note: 'the screen that does not open today', html: screenInsights },
];

// ── SKELETON — layout only ───────────────────────────────────────────────────
// Deliberately colour-free, radius-free and shadow-free: everything that makes
// one option different from another lives in the skin below. If a rule here
// needs a colour it is in the wrong block.
const SKELETON = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
.pv { margin: 0; font-family: var(--font-sans); font-size: var(--text-base); line-height: var(--leading-body); }
.pv h1, .pv h2, .pv h3, .pv p { margin: 0; }
.pv button { font: inherit; cursor: pointer; }
.pv input, .pv select, .pv textarea { font: inherit; }
.pv .form-input { display: block; width: 100%; }
.pv .btn, .pv .btn-ghost, .pv .btn-secondary, .pv .link-btn { display: inline-flex; align-items: center; justify-content: center; }

/* ── the review chrome (this is the page, not the app) ── */
.pv-top { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: baseline; }
.pv-top h1 { font-size: var(--text-lg); }
.pv-tabs { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.pv-tab { display: inline-block; text-decoration: none; }
.pv-screens { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-items: start; }
.pv-shot { display: flex; flex-direction: column; gap: 0.5rem; }
.pv-shot-cap { display: flex; gap: 0.5rem; align-items: baseline; }
.pv-shot-cap b { font-size: var(--text-sm); }
.pv-shot-cap span { font-size: var(--text-xs); }
.pv-phone { position: relative; overflow: hidden; }
.pv-notes { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.pv-notes ul { margin: 0.35rem 0 0; padding-left: 1.1rem; }
.pv-notes li { margin-bottom: 0.2rem; }

/* ── the app shell ── */
.pv-app { display: flex; min-height: 620px; }
.pv-app .sidebar { flex: 0 0 190px; display: flex; flex-direction: column; }
.pv-app .sidebar-nav { display: flex; flex-direction: column; flex: 1; padding: 0.5rem; gap: 1px; }
.pv-app .sidebar-brand { display: flex; align-items: center; gap: 0.5rem; padding: 0.85rem 0.75rem; }
.pv-app .brand-mark { width: 20px; height: 20px; display: block; }
.pv-app .nav-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.6rem; }
.pv-app .nav-icon { width: 16px; height: 16px; flex: 0 0 auto; }
.pv-app .nav-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-app .workspace { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.pv-app .topbar { display: flex; align-items: center; gap: 0.75rem; padding: 0 0.9rem; min-height: 52px; }
.pv-app .topbar-title { flex: 1 1 auto; min-width: 0; }
.pv-app .header-actions { display: flex; align-items: center; gap: 0.6rem; }
.pv-app .bell { width: 18px; height: 18px; }
.pv-app .avatar { display: grid; place-items: center; width: 30px; height: 30px; font-size: var(--text-2xs); }
.pv-app.is-auth { min-height: 0; }
/* The min-width here is load-bearing, not tidiness. Without it this flex item's
   automatic minimum is its MIN-CONTENT width, and the doors grid's min-content is
   two 240px tracks plus the gap — 500px — so the wrap grew to 532 inside a 387px
   phone mock and the customer card rendered half off the right edge, clipped by
   .pv-phone's overflow. The grid never got the chance to collapse to one column,
   because its container had already been forced wider than the phone. */
.pv-app .auth-wrap { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; padding: 2rem 1rem; }
.pv-app .glass-card { width: 100%; max-width: 340px; display: flex; flex-direction: column; gap: 0.7rem; }
.pv-app .landing-head { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; text-align: center; }
.pv-app .landing-mark { width: 40px; height: 40px; }
/* Stacked, not side by side, and the collapsed door is a bar rather than a hidden
   card — this is the whole shape the owner asked for on 2026-10-08. */
.pv-app .doors { display: flex; flex-direction: column; gap: 0.6rem; width: 100%; max-width: 420px; }
.pv-app .doors .glass-card { max-width: none; gap: 0; }
.pv-app .door-bar { display: flex; align-items: center; gap: 0.6rem; min-height: 56px; }
.pv-app .door-role { flex: 1 1 auto; text-align: left; }
.pv-app .door-body { display: flex; flex-direction: column; gap: 0.7rem; padding-top: 0.9rem; }
.pv-app .door[data-open="0"] .door-body { display: none; }
.pv-app .landing-foot { display: flex; flex-wrap: wrap; justify-content: center; gap: 1rem; }
.pv-app .landing-terms { max-width: 420px; text-align: center; }
.pv-app .landing-lang { display: flex; justify-content: center; }
.pv-app .cust-welcome, .pv-app .cust-tagline, .pv-app .cust-lead,
.pv-app .cust-helper, .pv-app .cust-unregistered { text-align: left; }
/* The corner, drawn in the preview at the size it is on a phone. */
.pv-app .wa-corner { position: absolute; top: 0.85rem; right: 0.85rem; display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; }
.pv-app .wa-glyph { width: 22px; height: 22px; }
.pv-app .auth-wrap { position: relative; }
/* THE CODE STEP, full screen inside the mock. */
.pv-app #code-view { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; padding: 2rem 1rem; }
.pv-app .code-card { max-width: 420px; text-align: center; }
.pv-app .code-boxes { display: flex; gap: 0.4rem; justify-content: center; }
.pv-app .code-box { width: 100%; max-width: 48px; min-width: 0; height: 52px; text-align: center; }

/* ── the IR list ── */
.pv-app .list-toolbar { display: flex; flex-direction: column; gap: 0.55rem; padding: 0.85rem 0.9rem 0.7rem; }
.pv-app .list-toolbar-top { display: flex; align-items: baseline; gap: 0.5rem; }
.pv-app .list-title { flex: 1 1 auto; }
.pv-app .search-bar { width: 100%; }
.pv-app .segments { display: flex; gap: 0.3rem; overflow-x: auto; scrollbar-width: none; }
.pv-app .segments::-webkit-scrollbar { display: none; }
.pv-app .segment { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 0.35rem; white-space: nowrap; }
.pv-app .sync-status { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.9rem; }
.pv-app .sync-msg { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-app .ir-list { display: flex; flex-direction: column; flex: 1 1 auto; }
.pv-app .ir-card { display: flex; align-items: flex-start; gap: 0.6rem; }
.pv-app .ir-card-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.pv-app .ir-title-row { display: flex; align-items: baseline; gap: 0.5rem; }
.pv-app .ir-title { flex: 0 0 auto; }
.pv-app .ir-assignee { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-app .ir-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem; }
.pv-app .ir-card-side { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem; }

/* ── the ticket ── */
.pv-app .ir-banner { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-start; padding: 0.9rem; }
.pv-app .banner-main { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.pv-app .banner-pills { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.pv-app .banner-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.pv-app .overview-panel { padding: 0.9rem; }
.pv-app .overview-head { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.6rem; }
.pv-app .overview-grid { display: grid; gap: 0.5rem 1rem; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.pv-app .overview-cell { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.pv-app .tabs-container { display: flex; gap: 0.25rem; overflow-x: auto; padding: 0 0.9rem; scrollbar-width: none; }
.pv-app .tabs-container::-webkit-scrollbar { display: none; }
.pv-app .tab { flex: 0 0 auto; white-space: nowrap; }
.pv-app .section-content { display: flex; flex-direction: column; gap: 0.7rem; padding: 0.9rem; }
.pv-app .form-group { display: flex; flex-direction: column; gap: 0.3rem; }
.pv-app .sec-export-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }

/* ── insights ── */
.pv-app .insights-body { display: flex; flex-direction: column; gap: 0.9rem; padding: 0.9rem; }
.pv-app .insights-filters { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.pv-app .insights-filter { display: flex; flex-direction: column; gap: 0.2rem; }
.pv-app .insights-cards { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
.pv-app .insights-card { display: flex; flex-direction: column; gap: 0.15rem; text-align: left; }
.pv-app .insights-subcats { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.pv-app .insights-subcat { display: inline-flex; align-items: baseline; gap: 0.4rem; }
.pv-app .insights-mix { display: flex; flex-direction: column; gap: 0.3rem; }
.pv-app .insights-mix-row { display: flex; align-items: center; gap: 0.6rem; }
.pv-app .insights-mix-n { margin-left: auto; }

/* The four screens are phone screenshots, so below the grid's own breakpoint the
   shell becomes what the phone actually shows: nav bar at the BOTTOM, no rail.
   base.css:855 does the same thing to #sidebar and this mirrors it, because a
   design reviewed in a desktop shell is a design reviewed for the wrong screen. */
@media (max-width: 639px) {
  .pv-app { flex-direction: column-reverse; min-height: 0; }
  .pv-app .sidebar { flex: 0 0 auto; }
  .pv-app .sidebar-nav { flex-direction: row; overflow-x: auto; }
  .pv-app .sidebar-brand { display: none; }
  .pv-app .nav-item { flex: 1 1 0; flex-direction: column; gap: 0.1rem; text-align: center; }
  .pv-app .nav-item .nav-count { display: none; }
  .pv-app .ir-card-side { flex-direction: row; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
}
`;

// ── BOARD CHROME — the review pages' own furniture ───────────────────────────
// The jump row, the blocks, the demo card and its caption bar, the caveat. It is
// the page, not the app, so it belongs to the shared sheet and not to either
// board's skin.
//
// It used to live inside PARTS_SKIN, and that was a real bug rather than untidy
// code: a skin is inlined per page, so the second board was built with none of it
// and its captions ran together as one line. It was found by looking at a
// screenshot, not by reading — the CSS was valid and every test passed.
//
// Keeping it here also means a board cannot drift from the other one's furniture.
// Nothing in this block touches the app: every selector names a .pv- element that
// exists only on a review page.
const BOARD_CHROME = `
/* ── the board's own chrome ── */
.pv-app.is-demo { display: block; min-height: 0; background: var(--surface-base); }
.pv-jump { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1.75rem; }
.pv-jump a { padding: 0.35rem 0.75rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-base); color: var(--ink-gray-7); font-size: var(--text-sm); text-decoration: none; }
.pv-jump a:hover { border-color: var(--accent-soft-line); background: var(--accent-soft); }
.pv-block { margin-bottom: 2.75rem; }
.pv-kicker { display: block; color: var(--ink-gray-5); font-size: var(--text-2xs); font-weight: var(--weight-medium); letter-spacing: 0.06em; text-transform: uppercase; }
.pv-block-title { margin: 0.2rem 0 0.4rem; font-size: var(--text-2xl); font-weight: var(--weight-semibold); }
.pv-block-note { max-width: 68ch; color: var(--ink-gray-7); font-size: var(--text-sm); }
.pv-demo { margin-bottom: 1rem; overflow: hidden; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); background: var(--surface-base); box-shadow: var(--elevation-sm); }
.pv-demo-cap { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; padding: 0.6rem 0.9rem; border-bottom: 1px solid var(--outline-gray-1); background: var(--surface-gray-1); }
.pv-demo-cap b { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.pv-demo-cap span { color: var(--ink-gray-6); font-size: var(--text-xs); }
.pv-demo-pad { padding: 0.9rem; }
.pv-demo-ticket { padding: 0.9rem 0; }
.pv-caveat { margin: -0.25rem 0 1rem; padding: 0.75rem 0.9rem; border: 1px solid var(--outline-gray-2); border-left: 3px solid var(--accent); border-radius: var(--radius-3); background: var(--surface-gray-1); color: var(--ink-gray-7); font-size: var(--text-xs); line-height: var(--leading-body); }
.pv-caveat b { color: var(--ink-gray-9); font-weight: var(--weight-medium); }
/* Visible to a screen reader only. The step letters are decoration; the section
   name is the part worth announcing, and the bars carry no text at all. */
.pv-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* The verdict list — a row per claim, its verdict beside it, its evidence under.
   THIS BLOCK WAS IN THE WRONG PLACE and it rendered as one run-on line: it lived
   in the empty-states skin, which is inlined only on empty.html, so on board.html
   the classes matched nothing and <b>It is a drawing of data you have</b> sat
   flush against <span>No migration</span> with no space and no rule between rows.
   Every test passed and the CSS was valid; it is only visible by rendering the
   page. It belongs in the shared sheet, like the rest of the chrome, because
   BOTH boards use it — a skin is inlined per page and cannot be shared. */
.pv-lic { margin-top: 0.2rem; }
.pv-lic-row { padding: 0.6rem 0; border-bottom: 1px solid var(--outline-gray-2); }
.pv-lic-row b { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.pv-lic-row p { margin: 0.25rem 0 0; color: var(--ink-gray-7); font-size: var(--text-xs); line-height: var(--leading-body); }
.pv-lic-row .yes { margin-left: 0.5rem; color: var(--st-resolved-fg); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.pv-lic-row .no { margin-left: 0.5rem; color: var(--st-danger-fg); font-size: var(--text-xs); font-weight: var(--weight-medium); }
/* .warn had NO RULE AT ALL — not here and not in the skin it was copied from —
   so on both boards a "Decide" verdict rendered as plain text wedged against the
   claim it belongs to, while "No migration" beside it was coloured and spaced.
   Half a list looking styled is worse than none of it looking styled. */
.pv-lic-row .warn { margin-left: 0.5rem; color: var(--st-paused-fg); font-size: var(--text-xs); font-weight: var(--weight-medium); }
`;

// ── THE FOUR OPTIONS ─────────────────────────────────────────────────────────
// Each `skin` is the whole of what changes. They are written as one stylesheet
// each, scoped to .pv, because that is exactly how the winner would be adopted:
// one file's worth of rules, replacing the two design languages that are live in
// the app today (industrial.css on every screen, the POLISH block underneath it).

const OPTIONS = [
  {
    key: 'a',
    name: 'Desk, finished',
    tagline: 'Finish the ERPNext look you already approved — and apply it everywhere.',
    theme: 'light',
    blurb: 'The sign-in screen and the IR list are already drawn in Frappe/ERPNext Desk. This option simply finishes the job: the same flat, neutral, hairline language on the ticket, Insights and every modal. Nothing floats, nothing glows, and the accent colour appears in exactly two places — the selected row and the primary button.',
    wins: [
      'One language on every screen, so the seam between the list and the ticket disappears',
      'The densest of the three — the most IRs per phone screen, which matters at 400+ records',
      'Cheapest to reach, because industrial.css already exists and already covers every screen',
      'Reads as a tool. Nothing to learn, nothing to get distracted by.',
    ],
    loses: [
      'Plain. There is no brand colour anywhere except a thin selected-row rule.',
      'Status is a word and a dot rather than a coloured pill, so scanning by colour is harder.',
      'It looks like an ERP, because it is one.',
    ],
    skin: `
.pv { background: var(--surface-base); color: var(--ink-gray-9); }

/* review chrome */
.pv-page { max-width: 1240px; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
.pv-top { border-bottom: 1px solid var(--outline-gray-1); padding-bottom: 0.75rem; margin-bottom: 1.25rem; }
.pv-tab { padding: 0.25rem 0.6rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-2); color: var(--ink-gray-7); font-size: var(--text-sm); }
.pv-tab.is-here { background: var(--ink-gray-9); border-color: var(--ink-gray-9); color: var(--surface-base); }
.pv-shot-cap b { color: var(--ink-gray-9); }
.pv-shot-cap span { color: var(--ink-gray-6); }
.pv-phone { border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-base); }
.pv-notes { margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid var(--outline-gray-1); }
.pv-notes h2 { font-size: var(--text-md); }
.pv-notes li { color: var(--ink-gray-7); font-size: var(--text-sm); }
.pv-version { color: var(--ink-gray-5); font-size: var(--text-xs); }

/* shell */
.pv-app .sidebar { background: var(--surface-gray-1); border-right: 1px solid var(--outline-gray-1); }
.pv-app .sidebar-brand { border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .brand-mark { background: var(--ink-gray-8); border-radius: var(--radius-1); }
.pv-app .brand-text { font-size: var(--text-sm); font-weight: var(--weight-semibold); letter-spacing: 0.02em; }
.pv-app .nav-item { border-radius: var(--radius-2); color: var(--ink-gray-7); font-size: var(--text-sm); cursor: pointer; }
.pv-app .nav-item:hover { background: var(--surface-gray-2); color: var(--ink-gray-9); }
.pv-app .nav-item.active { background: var(--surface-gray-3); color: var(--ink-gray-9); font-weight: var(--weight-medium); }
.pv-app .nav-icon { background: var(--surface-gray-5); border-radius: var(--radius-1); }
.pv-app .nav-item.active .nav-icon { background: var(--ink-gray-7); }
.pv-app .nav-count { font-size: var(--text-2xs); color: var(--ink-gray-6); font-variant-numeric: tabular-nums; }
.pv-app .topbar { background: var(--surface-base); border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .topbar-title { font-size: var(--text-md); font-weight: var(--weight-semibold); }
.pv-app .bell { background: var(--surface-gray-4); border-radius: var(--radius-1); }
.pv-app .avatar { background: var(--surface-gray-3); color: var(--ink-gray-8); border-radius: var(--radius-2); font-weight: var(--weight-medium); }

/* list */
.pv-app .list-toolbar { background: var(--surface-base); border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .list-title { font-size: var(--text-md); font-weight: var(--weight-semibold); }
.pv-app .list-count { color: var(--ink-gray-7); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
.pv-app .search-bar { padding: 0.4rem 0.6rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-2); background: var(--surface-base); color: var(--ink-gray-9); font-size: var(--text-base); }
.pv-app .search-bar::placeholder { color: var(--ink-gray-5); }
.pv-app .segment { padding: 0.2rem 0.5rem; border: 1px solid transparent; border-radius: var(--radius-2); font-size: var(--text-xs); color: var(--ink-gray-7); cursor: pointer; }
.pv-app .segment:hover { background: var(--surface-gray-2); }
.pv-app .segment.active { background: var(--surface-gray-3); color: var(--ink-gray-9); border-color: var(--outline-gray-2); font-weight: var(--weight-medium); }
.pv-app .segment-count { color: var(--ink-gray-5); font-variant-numeric: tabular-nums; }
.pv-app .sync-status { font-size: var(--text-xs); color: var(--ink-gray-6); border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .ir-card { padding: 0.5rem 0.9rem; border-bottom: 1px solid var(--outline-gray-1); cursor: pointer; }
.pv-app .ir-card:hover { background: var(--surface-gray-1); }
.pv-app .ir-card.is-selected { background: var(--surface-gray-2); box-shadow: inset 3px 0 0 var(--ink-gray-9); }
.pv-app .ir-title { font-size: var(--text-sm); font-weight: var(--weight-semibold); color: var(--ink-gray-9); font-variant-numeric: tabular-nums; }
.pv-app .ir-assignee { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .ir-meta { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .ir-dot { color: var(--ink-gray-4); }
.pv-app .ir-age.is-late { color: var(--st-danger-fg); }
.pv-app .prio { font-size: var(--text-2xs); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-gray-6); }
/* Status as a dot and a word. It is what ERPNext does, and it is the whole of
   this option's answer to colour. */
.pv-app .badge { display: inline-flex; align-items: center; gap: 0.3rem; font-size: var(--text-xs); color: var(--ink-gray-8); }
.pv-app .badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--ink-gray-5); }
.pv-app .badge-open::before { background: var(--ink-blue-7); }
.pv-app .badge-pending::before { background: var(--ink-amber-7); }
.pv-app .badge-resolved::before { background: var(--ink-green-7); }
.pv-app .badge-closed::before { background: var(--ink-gray-5); }
.pv-app .badge-danger::before { background: var(--ink-red-7); }

/* auth */
.pv-app.is-auth { background: var(--surface-gray-1); }
.pv-app .glass-card { padding: 1.5rem 1.25rem; background: var(--surface-base); border: 1px solid var(--outline-gray-1); border-radius: var(--radius-3); }
.pv-app .auth-logo { background: var(--ink-gray-8); border-radius: var(--radius-2); }
.pv-app .auth-brand { font-size: var(--text-lg); font-weight: var(--weight-semibold); letter-spacing: 0.03em; }
.pv-app .auth-full { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .auth-hint { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .form-input { padding: 0.45rem 0.6rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-2); background: var(--surface-base); color: var(--ink-gray-9); font-size: var(--text-base); }
.pv-app .form-label { font-size: var(--text-xs); color: var(--ink-gray-7); font-weight: var(--weight-medium); }
.pv-app .btn { padding: 0.45rem 0.9rem; border: 1px solid var(--ink-gray-9); border-radius: var(--radius-2); background: var(--ink-gray-9); color: var(--surface-base); font-size: var(--text-sm); font-weight: var(--weight-medium); }
.pv-app .btn-secondary, .pv-app .btn-ghost { padding: 0.4rem 0.8rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-2); background: var(--surface-base); color: var(--ink-gray-8); font-size: var(--text-sm); }
.pv-app .btn-ghost { border-color: transparent; }
.pv-app .link-btn { border: 0; background: none; color: var(--ink-gray-7); font-size: var(--text-xs); text-decoration: underline; }
.pv-app .auth-or { display: flex; align-items: center; gap: 0.5rem; font-size: var(--text-2xs); color: var(--ink-gray-5); }
.pv-app .auth-or::before, .pv-app .auth-or::after { content: ""; flex: 1 1 auto; height: 1px; background: var(--outline-gray-1); }

/* ticket */
.pv-app #ir-banner { border-bottom: 1px solid var(--outline-gray-1); background: var(--surface-base); }
.pv-app #ir-banner-title { font-size: var(--text-xl); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.pv-app #ir-banner-sub { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .overview-panel { border-bottom: 1px solid var(--outline-gray-1); background: var(--surface-gray-1); }
.pv-app .overview-title { font-size: var(--text-sm); font-weight: var(--weight-semibold); text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-gray-7); }
.pv-app .overview-k { font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-gray-5); }
.pv-app .overview-v { font-size: var(--text-sm); color: var(--ink-gray-9); }
.pv-app .tabs-container { border-bottom: 1px solid var(--outline-gray-1); background: var(--surface-base); }
.pv-app .tab { padding: 0.45rem 0.7rem; font-size: var(--text-sm); color: var(--ink-gray-6); border-bottom: 2px solid transparent; cursor: pointer; }
.pv-app .tab.active { color: var(--ink-gray-9); border-bottom-color: var(--ink-gray-9); font-weight: var(--weight-medium); }
.pv-app .section-content { background: var(--surface-base); }
.pv-app .section-title { font-size: var(--text-md); font-weight: var(--weight-semibold); }

/* insights */
.pv-app .insights-body { background: var(--surface-base); }
.pv-app .insights-total { font-size: var(--text-sm); color: var(--ink-gray-7); }
.pv-app .insights-total strong { color: var(--ink-gray-9); font-variant-numeric: tabular-nums; }
.pv-app .insights-card { padding: 0.55rem 0.65rem; border: 1px solid var(--outline-gray-1); border-radius: var(--radius-3); background: var(--surface-gray-1); cursor: pointer; }
.pv-app .insights-card.active { border-color: var(--ink-gray-8); background: var(--surface-gray-2); }
.pv-app .insights-card-n { font-size: var(--text-xl); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.pv-app .insights-card-label { font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-gray-6); }
.pv-app .insights-h { font-size: var(--text-sm); font-weight: var(--weight-semibold); text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-gray-7); margin-bottom: 0.5rem; }
.pv-app .insights-subcat { padding: 0.25rem 0.5rem; border: 1px solid var(--outline-gray-1); border-radius: var(--radius-2); background: var(--surface-gray-1); font-size: var(--text-xs); color: var(--ink-gray-8); }
.pv-app .insights-subcat.is-others { border-style: dashed; color: var(--ink-gray-6); }
.pv-app .insights-subcat-n { color: var(--ink-gray-6); font-variant-numeric: tabular-nums; }
.pv-app .insights-mix-row { font-size: var(--text-sm); }
.pv-app .insights-mix-n { font-variant-numeric: tabular-nums; color: var(--ink-gray-8); }
`,
  },

  {
    key: 'b',
    name: 'Indrones Industrial',
    tagline: 'Dark instrument panel, industrial yellow, technical labels. Built to look like Indrones.',
    theme: 'dark',
    blurb: 'A dark graphite shell with the industrial yellow from Indrones’ own logo as the only accent. Keys and numbers are set in the monospace face, sections are numbered like a series index, corners are cut square, and status reads as a small LED rather than a soft pill. It is an instrument panel for drone telemetry, which is what this app actually is.',
    wins: [
      'Unmistakably Indrones — the dark canvas and yellow read as the same family as the website',
      'Monospace numbers line up in columns, which is what you want in a 412-row list of IR keys',
      'Dark is genuinely better on a phone in a hangar or an oil field, and for battery',
      'The instrument framing makes a log analyser look like it belongs rather than like a bolt-on',
    ],
    loses: [
      'A bigger change than the other two — the dark theme exists in the app, but this makes it the default',
      'The yellow has to clear WCAG AA on dark. It does (about 11.2:1, measured at build time), but it may still get nudged for contrast rather than taste',
      'Technical labelling can read as cold to someone who is not an engineer',
    ],
    skin: `
/* The only colour here that is not already in the app's token set. It is the
   brand yellow from indrones.com's logo asset, and it is PROVISIONAL: adopting
   Option B means adding a \`yellow\` preset to palette.css through the documented
   three-file path (app.js PALETTES, the [data-palette] block, the index.html
   pre-paint list), and tools/smoke-palette.mjs will then MEASURE it for WCAG AA
   and refuse it if it fails. Measured at build time against the dark surface, and refused if it drops below AA. */
.pv { --ind-yellow: #ffc400; --ind-ink-on-yellow: #171717;
      background: var(--surface-gray-10); color: var(--ink-gray-1); }

.pv-page { max-width: 1240px; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
.pv-top { border-bottom: 1px solid var(--outline-gray-8); padding-bottom: 0.75rem; margin-bottom: 1.25rem; }
.pv-top h1 { letter-spacing: 0.06em; text-transform: uppercase; font-size: var(--text-base); }
.pv-top > p { color: var(--ink-gray-4); font-size: var(--text-sm); }
.pv-tab { padding: 0.25rem 0.6rem; border: 1px solid var(--outline-gray-8); color: var(--ink-gray-4); font-size: var(--text-xs); font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; }
.pv-tab.is-here { background: var(--ind-yellow); border-color: var(--ind-yellow); color: var(--ind-ink-on-yellow); }
.pv-shot-cap b { color: var(--ind-yellow); font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.1em; text-transform: uppercase; }
.pv-shot-cap span { color: var(--ink-gray-5); }
.pv-phone { border: 1px solid var(--outline-gray-8); background: var(--surface-gray-10); }
.pv-notes { margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid var(--outline-gray-8); }
.pv-notes h2 { font-size: var(--text-base); text-transform: uppercase; letter-spacing: 0.06em; color: var(--ind-yellow); }
.pv-notes li { color: var(--ink-gray-3); font-size: var(--text-sm); }
.pv-version { color: var(--ink-gray-6); font-size: var(--text-xs); font-family: var(--font-mono); }

/* shell */
.pv-app .sidebar { background: var(--surface-gray-10); border-right: 1px solid var(--outline-gray-9); }
.pv-app .sidebar-brand { border-bottom: 1px solid var(--outline-gray-9); }
.pv-app .brand-mark { background: var(--ind-yellow); }
.pv-app .brand-text { font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.16em; color: var(--ink-gray-2); }
.pv-app .nav-item { color: var(--ink-gray-5); font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
.pv-app .nav-item:hover { color: var(--ink-gray-1); background: var(--surface-gray-9); }
.pv-app .nav-item.active { color: var(--ind-yellow); background: var(--surface-gray-9); box-shadow: inset 2px 0 0 0 var(--ind-yellow); }
.pv-app .nav-icon { border: 1px solid currentColor; }
.pv-app .nav-item.active .nav-icon { background: var(--ind-yellow); }
.pv-app .nav-count { font-variant-numeric: tabular-nums; color: var(--ink-gray-4); }
.pv-app .topbar { background: var(--surface-gray-10); border-bottom: 1px solid var(--outline-gray-9); }
.pv-app .topbar-title { font-family: var(--font-mono); font-size: var(--text-sm); letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-gray-1); }
.pv-app .bell { border: 1px solid var(--outline-gray-7); }
.pv-app .avatar { border: 1px solid var(--ind-yellow); color: var(--ind-yellow); font-family: var(--font-mono); }

/* list — a readout, not a set of cards */
.pv-app .list-toolbar { background: var(--surface-gray-10); border-bottom: 1px solid var(--outline-gray-9); }
.pv-app .list-title { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.16em; font-size: var(--text-sm); }
.pv-app .list-title::before { content: "01 / "; color: var(--ind-yellow); }
.pv-app .list-count { font-family: var(--font-mono); color: var(--ind-yellow); font-variant-numeric: tabular-nums; }
.pv-app .search-bar { padding: 0.4rem 0.6rem; border: 1px solid var(--outline-gray-8); background: var(--surface-gray-9); color: var(--ink-gray-1); font-size: var(--text-base); }
.pv-app .search-bar::placeholder { color: var(--ink-gray-6); }
.pv-app .segment { padding: 0.2rem 0.5rem; border: 1px solid var(--outline-gray-8); color: var(--ink-gray-4); font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
.pv-app .segment.active { border-color: var(--ind-yellow); color: var(--ind-yellow); background: var(--surface-gray-9); }
.pv-app .segment-count { color: var(--ink-gray-6); font-variant-numeric: tabular-nums; }
.pv-app .segment.active .segment-count { color: var(--ind-yellow); }
.pv-app .sync-status { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-gray-6); border-bottom: 1px solid var(--outline-gray-9); }
.pv-app .ir-card { padding: 0.5rem 0.9rem; border-bottom: 1px solid var(--outline-gray-9); cursor: pointer; }
.pv-app .ir-card:hover { background: var(--surface-gray-9); }
.pv-app .ir-card.is-selected { background: var(--surface-gray-9); box-shadow: inset 2px 0 0 0 var(--ind-yellow); }
.pv-app .ir-title { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--ind-yellow); font-variant-numeric: tabular-nums; }
.pv-app .ir-assignee { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-gray-4); }
.pv-app .ir-meta { font-size: var(--text-2xs); color: var(--ink-gray-5); }
.pv-app .ir-dot { color: var(--outline-gray-7); }
.pv-app .ir-age.is-late { color: var(--st-danger-fg); }
.pv-app .prio { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-gray-4); }
/* Status as an LED. A block, not a rounded pill — the corner is the language.
   The colour comes from the app's own SEMANTIC status tokens (--st-*-fg), not
   from the raw ramps, so if a status colour is ever retuned all three options
   follow it. It is also why this is --st-*-fg and NOT --focus-*: the focus family
   is a box-shadow, and background:var(--focus-blue) renders as nothing at all. */
.pv-app .badge { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.1rem 0.4rem; border: 1px solid var(--outline-gray-8); background: var(--surface-gray-9); font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-gray-3); }
.pv-app .badge::before { content: ""; width: 5px; height: 5px; background: var(--ink-gray-6); }
.pv-app .badge-open::before { background: var(--st-open-fg); }
.pv-app .badge-pending::before { background: var(--st-paused-fg); }
.pv-app .badge-resolved::before { background: var(--st-resolved-fg); }
.pv-app .badge-closed::before { background: var(--st-closed-fg); }
.pv-app .badge-danger { border-color: var(--st-danger-bd); color: var(--st-danger-fg); }
.pv-app .badge-danger::before { background: var(--st-danger-fg); }

/* auth */
.pv-app.is-auth { background: var(--surface-gray-10); }
.pv-app .glass-card { padding: 1.5rem 1.25rem; background: var(--surface-gray-9); border: 1px solid var(--outline-gray-8); border-top: 2px solid var(--ind-yellow); }
.pv-app .auth-logo { background: var(--ind-yellow); }
.pv-app .auth-brand { font-family: var(--font-mono); font-size: var(--text-md); letter-spacing: 0.24em; color: var(--ink-gray-1); }
.pv-app .auth-full { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-gray-6); }
.pv-app .auth-hint { font-size: var(--text-xs); color: var(--ink-gray-4); }
.pv-app .form-input { padding: 0.45rem 0.6rem; border: 1px solid var(--outline-gray-8); background: var(--surface-gray-10); color: var(--ink-gray-1); font-size: var(--text-base); }
.pv-app .form-label { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-gray-4); }
.pv-app .btn { padding: 0.45rem 0.9rem; border: 1px solid var(--ind-yellow); background: var(--ind-yellow); color: var(--ind-ink-on-yellow); font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.1em; text-transform: uppercase; font-weight: var(--weight-semibold); }
.pv-app .btn-secondary, .pv-app .btn-ghost { padding: 0.4rem 0.8rem; border: 1px solid var(--outline-gray-8); background: transparent; color: var(--ink-gray-2); font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; }
.pv-app .btn-ghost { border-color: var(--outline-gray-9); color: var(--ink-gray-4); }
.pv-app .link-btn { border: 0; background: none; color: var(--ink-gray-5); font-size: var(--text-xs); text-decoration: underline; }
.pv-app .auth-or { display: flex; align-items: center; gap: 0.5rem; font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-gray-6); }
.pv-app .auth-or::before, .pv-app .auth-or::after { content: ""; flex: 1 1 auto; height: 1px; background: var(--outline-gray-9); }

/* ticket */
.pv-app #ir-banner { border-bottom: 1px solid var(--outline-gray-9); background: var(--surface-gray-9); }
.pv-app #ir-banner-title { font-family: var(--font-mono); font-size: var(--text-xl); color: var(--ind-yellow); font-variant-numeric: tabular-nums; }
.pv-app #ir-banner-sub { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-gray-5); }
.pv-app .overview-panel { border-bottom: 1px solid var(--outline-gray-9); background: var(--surface-gray-10); }
.pv-app .overview-title { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.16em; text-transform: uppercase; color: var(--ind-yellow); }
.pv-app .overview-k { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-gray-6); }
.pv-app .overview-v { font-size: var(--text-sm); color: var(--ink-gray-1); }
.pv-app .tabs-container { border-bottom: 1px solid var(--outline-gray-9); background: var(--surface-gray-10); }
.pv-app .tab { padding: 0.45rem 0.7rem; font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-gray-5); border-bottom: 2px solid transparent; cursor: pointer; }
.pv-app .tab.active { color: var(--ind-yellow); border-bottom-color: var(--ind-yellow); }
.pv-app .section-content { background: var(--surface-gray-10); }
.pv-app .section-title { font-family: var(--font-mono); font-size: var(--text-sm); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-gray-1); }

/* insights */
.pv-app .insights-body { background: var(--surface-gray-10); }
.pv-app .insights-total { font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-gray-5); }
.pv-app .insights-total strong { color: var(--ind-yellow); font-size: var(--text-md); }
.pv-app .insights-card { padding: 0.55rem 0.65rem; border: 1px solid var(--outline-gray-9); border-left: 2px solid var(--outline-gray-8); background: var(--surface-gray-9); cursor: pointer; }
.pv-app .insights-card.active { border-left-color: var(--ind-yellow); }
.pv-app .insights-card-n { font-family: var(--font-mono); font-size: var(--text-xl); color: var(--ink-gray-1); font-variant-numeric: tabular-nums; }
.pv-app .insights-card-label { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-gray-5); }
.pv-app .insights-h { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.16em; text-transform: uppercase; color: var(--ind-yellow); margin-bottom: 0.5rem; }
.pv-app .insights-subcat { padding: 0.25rem 0.5rem; border: 1px solid var(--outline-gray-9); background: var(--surface-gray-9); font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.06em; color: var(--ink-gray-2); }
.pv-app .insights-subcat.is-others { border-style: dashed; border-color: var(--outline-gray-7); color: var(--ink-gray-4); }
.pv-app .insights-subcat-n { color: var(--ind-yellow); font-variant-numeric: tabular-nums; }
.pv-app .insights-mix-row { font-size: var(--text-sm); }
.pv-app .insights-mix-n { font-family: var(--font-mono); color: var(--ind-yellow); font-variant-numeric: tabular-nums; }
`,
  },

  {
    key: 'c',
    name: 'Modern SaaS light',
    tagline: 'Soft canvas, white cards, generous spacing. The Linear / Stripe register.',
    theme: 'light',
    blurb: 'A light grey canvas with white cards floating on it, gentle shadows, wide corner radii and a tinted primary button. It is the visual language of every well-made product tool, which means nobody has to learn it — and it makes a form-heavy passbook feel lighter than it is.',
    wins: [
      'Instantly familiar. Nothing on screen asks to be learnt.',
      'Cards separate the passbook sections clearly, which suits a nine-section form',
      'The softest of the three on a small screen — big tap targets, nothing cramped',
      'Ages well and looks deliberate rather than inherited',
    ],
    loses: [
      'The least dense. Noticeably fewer IRs per phone screen, and this list is 412 rows.',
      'The shadow-and-card look is everywhere, so it makes the app look like a product, not like Indrones',
      'Two competing ideas meet here: a heavy data list wants density and a SaaS card wants air',
    ],
    skin: `
.pv { background: var(--surface-gray-1); color: var(--ink-gray-9); }

.pv-page { max-width: 1240px; margin: 0 auto; padding: 1.5rem 1rem 3.5rem; }
.pv-top { padding-bottom: 0.9rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--outline-gray-1); }
.pv-top h1 { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.pv-top > p { color: var(--ink-gray-6); font-size: var(--text-sm); }
.pv-tab { padding: 0.3rem 0.75rem; border: 1px solid var(--outline-gray-2); border-radius: 999px; background: var(--surface-base); color: var(--ink-gray-7); font-size: var(--text-sm); }
.pv-tab.is-here { background: var(--accent); border-color: var(--accent); color: var(--btn-solid-fg); }
.pv-shot-cap b { color: var(--ink-gray-9); }
.pv-shot-cap span { color: var(--ink-gray-5); }
.pv-phone { border: 1px solid var(--outline-gray-1); border-radius: var(--radius-6); background: var(--surface-gray-1); box-shadow: var(--elevation-sm); }
.pv-notes { margin-top: 1.75rem; padding-top: 1.5rem; border-top: 1px solid var(--outline-gray-1); }
.pv-notes h2 { font-size: var(--text-md); font-weight: var(--weight-semibold); }
.pv-notes li { color: var(--ink-gray-7); font-size: var(--text-sm); }
.pv-version { color: var(--ink-gray-5); font-size: var(--text-xs); }

/* shell */
.pv-app .sidebar { background: var(--surface-base); border-right: 1px solid var(--outline-gray-1); }
.pv-app .sidebar-brand { border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .brand-mark { background: var(--accent); border-radius: var(--radius-2); }
.pv-app .brand-text { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.pv-app .nav-item { border-radius: var(--radius-4); color: var(--ink-gray-7); font-size: var(--text-sm); margin-bottom: 2px; cursor: pointer; }
.pv-app .nav-item:hover { background: var(--surface-gray-1); color: var(--ink-gray-9); }
.pv-app .nav-item.active { background: var(--accent-soft); color: var(--accent); font-weight: var(--weight-medium); }
.pv-app .nav-icon { background: var(--surface-gray-4); border-radius: var(--radius-1); }
.pv-app .nav-item.active .nav-icon { background: var(--accent); }
.pv-app .nav-count { font-size: var(--text-2xs); color: var(--ink-gray-6); font-variant-numeric: tabular-nums; }
.pv-app .topbar { background: var(--surface-base); border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .topbar-title { font-size: var(--text-md); font-weight: var(--weight-semibold); }
.pv-app .bell { background: var(--surface-gray-3); border-radius: 999px; }
.pv-app .avatar { background: var(--accent); color: var(--btn-solid-fg); border-radius: 999px; font-weight: var(--weight-medium); }

/* list */
.pv-app .list-toolbar { background: var(--surface-base); border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .list-title { font-size: var(--text-md); font-weight: var(--weight-semibold); }
.pv-app .list-count { padding: 0.05rem 0.45rem; border-radius: 999px; background: var(--surface-gray-2); color: var(--ink-gray-7); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.pv-app .search-bar { padding: 0.5rem 0.75rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); background: var(--surface-gray-1); color: var(--ink-gray-9); font-size: var(--text-base); }
.pv-app .search-bar::placeholder { color: var(--ink-gray-5); }
.pv-app .segment { padding: 0.25rem 0.65rem; border-radius: 999px; background: var(--surface-gray-2); color: var(--ink-gray-7); font-size: var(--text-xs); cursor: pointer; }
.pv-app .segment.active { background: var(--accent); color: var(--btn-solid-fg); font-weight: var(--weight-medium); }
.pv-app .segment-count { color: var(--ink-gray-5); font-variant-numeric: tabular-nums; }
.pv-app .segment.active .segment-count { color: var(--btn-solid-fg); opacity: 0.75; }
.pv-app .sync-status { font-size: var(--text-xs); color: var(--ink-gray-5); }
.pv-app .ir-list { gap: 0.6rem; padding: 0.75rem 0.9rem; }
.pv-app .ir-card { padding: 0.75rem 0.85rem; background: var(--surface-base); border: 1px solid var(--outline-gray-1); border-radius: var(--radius-5); box-shadow: var(--elevation-sm); cursor: pointer; }
.pv-app .ir-card:hover { box-shadow: var(--elevation-md); }
.pv-app .ir-card.is-selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.pv-app .ir-title { font-size: var(--text-sm); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.pv-app .ir-assignee { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .ir-meta { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .ir-dot { color: var(--ink-gray-4); }
.pv-app .ir-age.is-late { color: var(--ink-red-8); }
.pv-app .prio { font-size: var(--text-2xs); letter-spacing: 0.03em; text-transform: uppercase; color: var(--ink-gray-5); }
/* Pills, tinted from the app's semantic status tokens. Those are the layer the
   app already maintains (tokens.css:1126-1148): bg/fg/bd per status, so a retuned
   status colour moves all three options at once rather than just this one. */
.pv-app .badge { display: inline-flex; align-items: center; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: var(--text-2xs); font-weight: var(--weight-medium); border: 1px solid transparent; }
.pv-app .badge-open { background: var(--st-open-bg); color: var(--st-open-fg); border-color: var(--st-open-bd); }
.pv-app .badge-pending { background: var(--st-paused-bg); color: var(--st-paused-fg); border-color: var(--st-paused-bd); }
.pv-app .badge-resolved { background: var(--st-resolved-bg); color: var(--st-resolved-fg); border-color: var(--st-resolved-bd); }
.pv-app .badge-closed { background: var(--st-closed-bg); color: var(--st-closed-fg); border-color: var(--st-closed-bd); }
.pv-app .badge-danger { background: var(--st-danger-bg); color: var(--st-danger-fg); border-color: var(--st-danger-bd); }

/* auth */
.pv-app.is-auth { background: var(--surface-gray-1); }
.pv-app .glass-card { padding: 1.75rem 1.5rem; background: var(--surface-base); border: 1px solid var(--outline-gray-1); border-radius: var(--radius-6); box-shadow: var(--elevation-lg); }
.pv-app .auth-logo { background: var(--accent); border-radius: var(--radius-3); }
.pv-app .auth-brand { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.pv-app .auth-full { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .auth-hint { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .form-input { padding: 0.55rem 0.75rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); background: var(--surface-base); color: var(--ink-gray-9); font-size: var(--text-base); }
.pv-app .form-label { font-size: var(--text-xs); color: var(--ink-gray-7); font-weight: var(--weight-medium); }
.pv-app .btn { padding: 0.55rem 1rem; border: 1px solid var(--btn-solid-bg); border-radius: var(--radius-4); background: var(--btn-solid-bg); color: var(--btn-solid-fg); font-size: var(--text-sm); font-weight: var(--weight-medium); }
.pv-app .btn-secondary, .pv-app .btn-ghost { padding: 0.5rem 0.9rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); background: var(--surface-base); color: var(--ink-gray-8); font-size: var(--text-sm); }
.pv-app .btn-ghost { border-color: transparent; background: transparent; }
.pv-app .link-btn { border: 0; background: none; color: var(--accent); font-size: var(--text-xs); }
.pv-app .auth-or { display: flex; align-items: center; gap: 0.5rem; font-size: var(--text-2xs); color: var(--ink-gray-5); }
.pv-app .auth-or::before, .pv-app .auth-or::after { content: ""; flex: 1 1 auto; height: 1px; background: var(--outline-gray-1); }

/* ticket */
.pv-app #ir-banner { background: var(--surface-base); border-bottom: 1px solid var(--outline-gray-1); }
.pv-app #ir-banner-title { font-size: var(--text-xl); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.pv-app #ir-banner-sub { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .overview-panel { margin: 0.9rem; background: var(--surface-base); border: 1px solid var(--outline-gray-1); border-radius: var(--radius-5); box-shadow: var(--elevation-sm); }
.pv-app .overview-title { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.pv-app .overview-k { font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-gray-5); }
.pv-app .overview-v { font-size: var(--text-sm); color: var(--ink-gray-9); }
.pv-app .tabs-container { background: var(--surface-base); border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .tab { padding: 0.45rem 0.75rem; border-radius: var(--radius-3); font-size: var(--text-sm); color: var(--ink-gray-6); cursor: pointer; }
.pv-app .tab.active { background: var(--accent-soft); color: var(--accent); font-weight: var(--weight-medium); }
.pv-app .section-content { margin: 0.9rem; padding: 1rem; background: var(--surface-base); border: 1px solid var(--outline-gray-1); border-radius: var(--radius-5); box-shadow: var(--elevation-sm); }
.pv-app .section-title { font-size: var(--text-md); font-weight: var(--weight-semibold); }

/* insights */
.pv-app .insights-body { background: var(--surface-gray-1); }
.pv-app .insights-total { font-size: var(--text-sm); color: var(--ink-gray-7); }
.pv-app .insights-total strong { color: var(--ink-gray-9); font-variant-numeric: tabular-nums; }
.pv-app .insights-card { padding: 0.75rem 0.85rem; background: var(--surface-base); border: 1px solid var(--outline-gray-1); border-radius: var(--radius-5); box-shadow: var(--elevation-sm); cursor: pointer; }
.pv-app .insights-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.pv-app .insights-card-n { font-size: var(--text-2xl); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.pv-app .insights-card-label { font-size: var(--text-2xs); color: var(--ink-gray-6); }
.pv-app .insights-h { font-size: var(--text-sm); font-weight: var(--weight-semibold); margin-bottom: 0.6rem; }
.pv-app .insights-subcat { padding: 0.25rem 0.6rem; border-radius: 999px; background: var(--surface-base); border: 1px solid var(--outline-gray-1); font-size: var(--text-xs); color: var(--ink-gray-8); }
.pv-app .insights-subcat.is-others { border-style: dashed; color: var(--ink-gray-6); }
.pv-app .insights-subcat-n { color: var(--ink-gray-5); font-variant-numeric: tabular-nums; }
.pv-app .insights-mix-row { font-size: var(--text-sm); }
.pv-app .insights-mix-n { font-variant-numeric: tabular-nums; color: var(--ink-gray-8); }
`,
  },

  {
    key: 'd',
    name: 'Tabler arrangement',
    tagline: 'The Tabler arrangement — a page-header band, count tiles instead of pills, one dense results card.',
    theme: 'light',
    blurb: 'This one is ARRANGEMENT, and it is read off Tabler\'s own stylesheet rather than guessed at. The heading and the filters sit on the page the way Tabler\'s page-header and its filter row do, and only the results are a card — so controls and data stop being the same white rectangle. The status and category filters become a strip of count tiles: a big number over a small uppercase label, which is the single biggest change on this screen. Cards are 8px with a soft shadow, tabs are an underline, a status is a pill with a dot in it, and every small muted label is 11px uppercase and letter-spaced — that last habit is more of what makes a screen read as Tabler than its colour does. The colour is the blue you already have, and that is deliberate: Tabler\'s own palette is a neutral grey very close to Option C\'s, which is exactly why the previous attempt at this looked like Option C. All of the difference here is structure.',
    wins: [
      'Answers in front, literally: the filters become a strip of big numbers, so the state of all 412 IRs is read before the first row',
      'The count IS the filter — tapping a tile narrows the list, so the number and the control are one object instead of two',
      'Controls are visibly not data: the title and filters sit on the page, and only the results are a card',
      'The densest arrangement here — hairline rows fit more IRs per phone screen than floating cards do',
      'Every block carries its name in a header strip, so a nine-section passbook reads as nine labelled cards rather than one long form',
      'Status is a pill with a dot, so a row is still readable in greyscale, or by someone who does not separate red from green',
    ],
    loses: [
      'Tabler is a Bootstrap admin template. Taking its arrangement means rebuilding the app shell, not swapping a stylesheet — this is the biggest job of the four by a wide margin.',
      'Tabler uses a hamburger drawer on a phone, never a bottom bar. Adopting it properly changes the phone navigation you already have.',
      'The count tiles take vertical space above the list, so a phone shows a couple fewer rows than Option A does. They scroll sideways rather than wrap, which limits the damage.',
      'Flat and square also reads as a tool rather than a product — less friendly than Option C, and less familiar than A.',
      'Two of the four screens are standing in for a Tabler page header rather than having one of their own.',
    ],
    fine: [
      'Nothing from Tabler is in this repo. No Bootstrap, no Tabler CSS, no seventh stylesheet — every rule above is written with your own tokens.',
      'The only numbers taken from it are geometry, not code: a 56px top bar, an 8px card radius, a 20px page title, and 15rem as a grid cell\'s minimum width. Tabler is MIT, so it may be read for ideas; that is all this is.',
      'Tabler on a phone is a hamburger drawer rather than a bottom bar. These four screens share one markup and keep your bottom bar, so that single difference is described above rather than shown.',
      'Fields are 14px, which is what the app really uses. On a phone the app raises them to 16px so iOS stops zooming the page, and this arrangement keeps that rule.',
    ],
    skin: `

/* ── Option D — the Tabler arrangement ───────────────────────────────────────
   This is read off Tabler's own stylesheet rather than guessed at. It is MIT, so
   it may be read for ideas, and nothing of it is copied in — every value below
   is one of YOUR tokens, and the four numbers I did take from it are geometry,
   not code:

     1. a page HEADER BAND sits on the page background, not inside a card, with a
        large title (Tabler's page-title is 1.25rem) and a hairline under it;
     2. the FILTERS ARE DATA — a strip of count tiles, a big number over a tiny
        uppercase label, instead of a row of pills;
     3. a card is 8px with a soft shadow and a heading strip, and a status chip is
        a pill with a DOT in it;
     4. everything small and muted is 12px, uppercase and letter-spaced. That
        single habit is more of what makes a screen read as Tabler than its
        colour does.

   The blue is your own. Tabler's palette is a neutral grey very close to Option
   C's — which is exactly why a merely re-coloured version of this looked like
   Option C. The difference is arrangement, and here it is all of it. */

.pv { background: var(--surface-gray-1); color: var(--ink-gray-9); }

/* ── review chrome (this is the page around the app, not the app) ── */
.pv-page { max-width: 1240px; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
.pv-top { padding-bottom: 0.9rem; margin-bottom: 1.25rem; border-bottom: 1px solid var(--outline-gray-2); }
.pv-top h1 { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.pv-top > p { color: var(--ink-gray-6); font-size: var(--text-sm); }
.pv-tab { padding: 0.3rem 0.7rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-base); color: var(--ink-gray-7); font-size: var(--text-sm); }
.pv-tab.is-here { background: var(--accent-soft); border-color: var(--accent-soft-line); color: var(--accent); font-weight: var(--weight-medium); }
.pv-shot-cap b { color: var(--ink-gray-9); font-weight: var(--weight-semibold); }
.pv-shot-cap span { color: var(--ink-gray-5); }
.pv-phone { border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); background: var(--surface-gray-1); box-shadow: var(--elevation-sm); }
.pv-notes { margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px solid var(--outline-gray-2); }
.pv-notes h2 { font-size: var(--text-md); font-weight: var(--weight-semibold); }
.pv-notes li { color: var(--ink-gray-7); font-size: var(--text-sm); }
.pv-version { color: var(--ink-gray-5); font-size: var(--text-xs); }

/* ── the rail ── */
.pv-app { background: var(--surface-gray-1); }
.pv-app .sidebar { flex: 0 0 208px; background: var(--surface-base); border-right: 1px solid var(--outline-gray-2); }
.pv-app .sidebar-brand { padding: 0.95rem 0.85rem; border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .brand-mark { background: var(--accent); border-radius: var(--radius-2); }
.pv-app .brand-text { font-size: var(--text-sm); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-sm); }
.pv-app .sidebar-nav { padding: 0.55rem 0.5rem; gap: 2px; }
/* Rail labels are 14px, and the selected one is accent text on a wash — never a
   filled block. Tabler's sidebar is quiet; that is why it does not get tiring. */
.pv-app .nav-item { padding: 0.45rem 0.55rem; border-radius: var(--radius-3); color: var(--ink-gray-7); font-size: var(--text-base); cursor: pointer; }
.pv-app .nav-item:hover { background: var(--surface-gray-1); color: var(--ink-gray-9); }
.pv-app .nav-item.active { background: var(--accent-soft); color: var(--accent); font-weight: var(--weight-medium); }
.pv-app .nav-icon { background: var(--surface-gray-4); border-radius: var(--radius-1); }
.pv-app .nav-item.active .nav-icon { background: var(--accent); }
.pv-app .nav-count { padding: 0.05rem 0.4rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); color: var(--ink-gray-6); font-size: var(--text-2xs); font-variant-numeric: tabular-nums; }

/* ── the top bar: Tabler's navbar is 3.5rem tall with a hairline seam ── */
.pv-app .topbar { min-height: 56px; background: var(--surface-base); box-shadow: inset 0 -1px 0 var(--outline-gray-2); }
.pv-app .topbar-title { font-size: var(--text-md); font-weight: var(--weight-semibold); }
.pv-app .bell { background: var(--surface-gray-3); border-radius: var(--radius-2); }
/* A rounded SQUARE avatar, not a circle. Small, and one of the things that makes
   the whole frame read as an admin portal rather than as a consumer app. */
.pv-app .avatar { background: var(--accent-soft); border: 1px solid var(--accent-soft-line); color: var(--accent); border-radius: var(--radius-2); font-weight: var(--weight-semibold); }

/* ── the list ────────────────────────────────────────────────────────────────
   THE structural difference: the title band and the filters sit ON the page,
   the way Tabler's page-header and its filter row do, and only the RESULTS are a
   card. In every other option the whole toolbar is one white rectangle, so the
   controls and the data look like the same kind of object. Here they cannot. */
.pv-app .list-toolbar { padding: 1.1rem 1.1rem 0; gap: 0.7rem; }
.pv-app .list-toolbar-top { padding-bottom: 0.7rem; border-bottom: 1px solid var(--outline-gray-2); gap: 0.6rem; }
.pv-app .list-title { font-size: var(--text-3xl); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-3xl); }
.pv-app .list-count { padding: 0.1rem 0.5rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-base); color: var(--ink-gray-6); font-size: var(--text-2xs); font-weight: var(--weight-medium); letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }
.pv-app .search-bar { padding: 0.55rem 0.75rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-base); color: var(--ink-gray-9); font-size: var(--text-base); box-shadow: var(--elevation-sm); }
.pv-app .search-bar::placeholder { color: var(--ink-gray-5); }

/* ── the filters, as a row of count tiles ────────────────────────────────────
   The counts were already in the markup; this only stops them being pills. A
   number you can read across the room over a label you read once is Tabler's
   stat strip, and it is the single biggest visible change on this screen.
   The order property lifts the number above the label WITHOUT touching the
   markup, which is
   the constraint this whole review runs under: four options, one set of screens.
   The row scrolls sideways rather than wrapping, so the list stays near the top
   on a phone. */
.pv-app .list-toolbar > .segments { gap: 0.45rem; padding-bottom: 0.35rem; }
.pv-app .segment { flex: 0 0 auto; flex-direction: column; align-items: flex-start; gap: 0; width: 6.75rem; min-width: 0; white-space: normal; padding: 0.45rem 0.6rem; background: var(--surface-base); border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); box-shadow: var(--elevation-sm); color: var(--ink-gray-6); font-size: var(--text-2xs); font-weight: var(--weight-medium); line-height: var(--leading-2xs); letter-spacing: 0.02em; text-transform: uppercase; cursor: pointer; }
.pv-app .segment:hover { border-color: var(--outline-gray-3); }
.pv-app .segment.active { background: var(--accent-soft); border-color: var(--accent-soft-line); color: var(--accent); box-shadow: none; }
.pv-app .segment-count { order: -1; white-space: nowrap; color: var(--ink-gray-9); font-size: var(--text-3xl); font-weight: var(--weight-semibold); line-height: var(--leading-3xl); letter-spacing: var(--tracking-3xl); font-variant-numeric: tabular-nums; text-transform: none; }
.pv-app .segment.active .segment-count { color: var(--accent); }
.pv-app .sync-status { padding: 0 1.1rem 0.5rem; color: var(--ink-gray-5); font-size: var(--text-xs); }

/* ── the results: ONE card, hairline rows, the answer pinned right ───────────
   The flex reset is load-bearing: the skeleton gives .ir-list flex-grow, which
   is invisible while the list has no background and looks like a bug the moment
   it has one. */
.pv-app .ir-list { flex: 0 0 auto; margin: 0 1.1rem 1.1rem; background: var(--surface-base); border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); box-shadow: var(--elevation-sm); overflow: hidden; }
.pv-app .ir-card { padding: 0.55rem 0.85rem; border-bottom: 1px solid var(--outline-gray-1); cursor: pointer; }
.pv-app .ir-card:last-child { border-bottom: 0; }
.pv-app .ir-card:hover { background: var(--surface-gray-1); }
.pv-app .ir-card.is-selected { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent-bar); }
.pv-app .ir-title { font-size: var(--text-base); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.pv-app .ir-assignee { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .ir-meta { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .ir-dot { color: var(--ink-gray-4); }
.pv-app .ir-age.is-late { color: var(--ink-red-8); font-weight: var(--weight-medium); }
.pv-app .prio { padding: 0.1rem 0.4rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-1); color: var(--ink-gray-6); font-size: var(--text-2xs); font-weight: var(--weight-medium); letter-spacing: 0.04em; text-transform: uppercase; }

/* ── the status chip ─────────────────────────────────────────────────────────
   Tabler's .status is a pill with a DOT in it, so the state survives being read
   in greyscale or by someone who does not separate red from green — the one gap
   a colour-only pill leaves open. The colours are the app's own status layer
   (tokens.css:1126-1148), reused rather than re-invented, so a retuned status
   colour moves every option at once. */
.pv-app .badge { display: inline-flex; align-items: center; gap: 0.35rem; height: 1.5rem; padding: 0.25rem 0.6rem; border: 1px solid transparent; border-radius: var(--radius-9); font-size: var(--text-2xs); font-weight: var(--weight-medium); white-space: nowrap; }
.pv-app .badge::before { content: ""; flex: 0 0 auto; width: 0.4rem; height: 0.4rem; border-radius: 50%; background: currentColor; }
.pv-app .badge-open { background: var(--st-open-bg); color: var(--st-open-fg); border-color: var(--st-open-bd); }
.pv-app .badge-pending { background: var(--st-paused-bg); color: var(--st-paused-fg); border-color: var(--st-paused-bd); }
.pv-app .badge-resolved { background: var(--st-resolved-bg); color: var(--st-resolved-fg); border-color: var(--st-resolved-bd); }
.pv-app .badge-closed { background: var(--st-closed-bg); color: var(--st-closed-fg); border-color: var(--st-closed-bd); }
.pv-app .badge-danger { background: var(--st-danger-bg); color: var(--st-danger-fg); border-color: var(--st-danger-bd); }

/* ── buttons: 40px, because that is Tabler's own height AND the app's tap rule,
   so the densest option here is not allowed to make the controls small. ── */
.pv-app .btn { min-height: 40px; padding: 0.5rem 1rem; border: 1px solid var(--btn-solid-bg); border-radius: var(--radius-3); background: var(--btn-solid-bg); color: var(--btn-solid-fg); font-size: var(--text-base); font-weight: var(--weight-medium); }
.pv-app .btn-secondary { min-height: 40px; padding: 0.5rem 0.9rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-base); color: var(--ink-gray-8); font-size: var(--text-base); }
.pv-app .btn-ghost { min-height: 40px; padding: 0.5rem 0.8rem; border: 1px solid transparent; border-radius: var(--radius-3); background: transparent; color: var(--ink-gray-7); font-size: var(--text-base); }
.pv-app .btn-ghost:hover { background: var(--surface-gray-2); color: var(--ink-gray-9); }
.pv-app .link-btn { border: 0; background: none; color: var(--accent); font-size: var(--text-xs); }

/* ── auth ── */
.pv-app .glass-card { padding: 1.5rem; background: var(--surface-base); border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); box-shadow: var(--elevation-sm); }
.pv-app .auth-logo { background: var(--accent); border-radius: var(--radius-3); }
.pv-app .auth-brand { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.pv-app .auth-full { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .auth-hint { font-size: var(--text-xs); color: var(--ink-gray-6); }
.pv-app .form-input { padding: 0.55rem 0.75rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-base); color: var(--ink-gray-9); font-size: var(--text-base); }
/* A label is a label, not a sentence: 11px uppercase and tracked, so it can
   never be mistaken for the value sitting under it. */
.pv-app .form-label { color: var(--ink-gray-6); font-size: var(--text-2xs); font-weight: var(--weight-medium); letter-spacing: 0.04em; text-transform: uppercase; }
.pv-app .auth-or { display: flex; align-items: center; gap: 0.5rem; font-size: var(--text-2xs); color: var(--ink-gray-5); letter-spacing: 0.04em; text-transform: uppercase; }
.pv-app .auth-or::before,
.pv-app .auth-or::after { content: ""; flex: 1 1 auto; height: 1px; background: var(--outline-gray-1); }

/* ── the ticket ── */
.pv-app #ir-banner { margin: 1.1rem 1.1rem 0; padding: 1rem 1.1rem; background: var(--surface-base); border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); box-shadow: var(--elevation-sm); }
.pv-app #ir-banner-title { font-size: var(--text-3xl); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-3xl); font-variant-numeric: tabular-nums; }
.pv-app #ir-banner-sub { font-size: var(--text-xs); color: var(--ink-gray-6); }
/* The overview is Tabler's DATAGRID: an auto-fit grid of label-over-value cells
   that reflows to one column on a phone without a media query of its own. */
.pv-app .overview-panel { margin: 1.1rem 1.1rem 0; padding: 0; background: var(--surface-base); border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); box-shadow: var(--elevation-sm); overflow: hidden; }
.pv-app .overview-head { margin: 0; padding: 0.65rem 1rem; border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .overview-title { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.pv-app .overview-grid { margin: 0; padding: 1rem; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.pv-app .overview-k { color: var(--ink-gray-5); font-size: var(--text-2xs); font-weight: var(--weight-medium); letter-spacing: 0.04em; text-transform: uppercase; }
.pv-app .overview-v { font-size: var(--text-base); color: var(--ink-gray-9); }
/* Tabler's tabs are an UNDERLINE, not a pill: the strip stays flat and the
   section you are in is the one with the accent rule under it. */
.pv-app .tabs-container { margin: 1.1rem 1.1rem 0; padding: 0; gap: 0; background: transparent; border-bottom: 1px solid var(--outline-gray-2); }
.pv-app .tab { padding: 0.6rem 0.35rem; margin: 0 0.7rem 0 0; border-bottom: 2px solid transparent; border-radius: 0; color: var(--ink-gray-6); font-size: var(--text-sm); cursor: pointer; }
.pv-app .tab:hover { color: var(--ink-gray-8); }
.pv-app .tab.active { border-bottom-color: var(--accent); color: var(--accent); font-weight: var(--weight-medium); }
.pv-app .section-content { margin: 1.1rem; padding: 0 0 1rem; gap: 0.7rem; background: var(--surface-base); border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); box-shadow: var(--elevation-sm); overflow: hidden; }
.pv-app .section-content > .section-title { margin: 0; padding: 0.7rem 1rem; border-bottom: 1px solid var(--outline-gray-1); color: var(--ink-gray-6); font-size: var(--text-2xs); font-weight: var(--weight-semibold); letter-spacing: 0.04em; text-transform: uppercase; }
.pv-app .section-content > *:not(.section-title) { margin: 0 1rem; }

/* ── insights ── */
.pv-app .insights-body { padding: 1.1rem; gap: 0.8rem; }
.pv-app .insights-filters { padding: 0.9rem 1rem; background: var(--surface-base); border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); box-shadow: var(--elevation-sm); }
.pv-app .insights-filter span { color: var(--ink-gray-5); font-size: var(--text-2xs); font-weight: var(--weight-medium); letter-spacing: 0.04em; text-transform: uppercase; }
.pv-app .insights-total { font-size: var(--text-sm); color: var(--ink-gray-6); }
.pv-app .insights-total strong { color: var(--ink-gray-9); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.pv-app .insights-card { padding: 0.75rem 0.9rem; background: var(--surface-base); border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); box-shadow: var(--elevation-sm); cursor: pointer; }
.pv-app .insights-card:hover { border-color: var(--outline-gray-3); }
.pv-app .insights-card.active { background: var(--accent-soft); border-color: var(--accent-soft-line); box-shadow: none; }
.pv-app .insights-card-n { color: var(--ink-gray-9); font-size: var(--text-4xl); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-4xl); font-variant-numeric: tabular-nums; }
.pv-app .insights-card.active .insights-card-n,
.pv-app .insights-card.active .insights-card-label { color: var(--accent); }
.pv-app .insights-card-label { color: var(--ink-gray-6); font-size: var(--text-2xs); font-weight: var(--weight-medium); letter-spacing: 0.04em; text-transform: uppercase; }
.pv-app .insights-block { padding: 0 0 0.9rem; background: var(--surface-base); border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); box-shadow: var(--elevation-sm); overflow: hidden; }
.pv-app .insights-h { margin: 0; padding: 0.65rem 1rem; border-bottom: 1px solid var(--outline-gray-1); color: var(--ink-gray-6); font-size: var(--text-2xs); font-weight: var(--weight-semibold); letter-spacing: 0.04em; text-transform: uppercase; }
.pv-app .insights-block > *:not(.insights-h) { margin: 0.85rem 1rem 0; }
.pv-app .insights-subcat { padding: 0.25rem 0.6rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-base); color: var(--ink-gray-8); font-size: var(--text-xs); }
.pv-app .insights-subcat.is-others { border-style: dashed; color: var(--ink-gray-6); }
.pv-app .insights-subcat-n { color: var(--ink-gray-5); font-variant-numeric: tabular-nums; }
.pv-app .insights-mix-row { font-size: var(--text-sm); }
.pv-app .insights-mix-n { color: var(--ink-gray-8); font-weight: var(--weight-medium); font-variant-numeric: tabular-nums; }

/* ── on a phone ──────────────────────────────────────────────────────────────
   The skeleton turns the rail into the bottom bar below 640px. These are the
   same rules once it has — and the flex reset is load-bearing: a media query
   adds no specificity, so without it the 208px rail width would become a 208px
   -tall bottom bar. */
@media (max-width: 639px) {
  .pv-app .sidebar { flex: 0 0 auto; border-right: 0; border-top: 1px solid var(--outline-gray-2); }
  .pv-app .sidebar-nav { padding: 0.4rem; }
  .pv-app .nav-item { padding: 0.4rem 0.2rem; }
  .pv-app .topbar { min-height: 52px; }
  .pv-app .list-toolbar { padding: 0.9rem 0.75rem 0; }
  .pv-app .list-title { font-size: var(--text-2xl); }
  .pv-app .sync-status { padding: 0 0.75rem 0.5rem; }
  .pv-app .ir-list { margin: 0 0.75rem 0.9rem; }
  .pv-app #ir-banner { margin: 0.75rem 0.75rem 0; padding: 0.9rem; }
  .pv-app .overview-panel { margin-left: 0.75rem; margin-right: 0.75rem; }
  .pv-app .tabs-container { margin-left: 0.75rem; margin-right: 0.75rem; }
  .pv-app .section-content { margin: 0.75rem; padding: 0 0 0.9rem; }
  .pv-app .insights-body { padding: 0.75rem; gap: 0.7rem; }
  .pv-app .segment { width: 6.25rem; }
}
`,
  },
];

// ── emit ─────────────────────────────────────────────────────────────────────

// Every scan below works on comment-free CSS. Both of the checks below describe
// the mistakes they look for in their own comments, so scanning the raw text
// makes each one match its own prose — a build that refuses over a bug that is
// not in the file, which is worse than no check at all.
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// ── the brand yellow, CARRIED rather than copied ─────────────────────────────
// preview.css has to carry the INDRONES names, because the default palette preset
// points at them and a preset that resolves to nothing renders as no accent at all —
// the review would show the options and one of them colourless.
//
// base.css is where those names are declared, and base.css as a whole cannot come
// across: it is the app's reset, layout and component chrome, and dropping it into the
// review sheet would restyle the REVIEW rather than the design. So the block is
// EXTRACTED from base.css — every rule whose body declares an `--ind-*` token, with its
// own selector, verbatim. Not retyped: a brand value changed in base.css and not here
// would leave a review page advertising a colour the app no longer has, which is the
// exact failure `--check` exists to catch and the exact reason this is an extraction
// and not a second copy of the hex.
const brandBlock = (stripComments(baseCss).match(/[^{}]*\{[^{}]*--ind-[^{}]*\}/g) || [])
  .map(b => b.trim()).join('\n');
if (!/--ind-yellow\s*:/.test(brandBlock)) {
  throw new Error('base.css no longer declares the INDRONES brand tokens; preview.css would ship a colourless default palette');
}

const previewCss = `/* GENERATED by tools/build-ui-options.mjs — do not edit.
   tokens.css + the INDRONES brand block (extracted from base.css) + palette.css +
   theme.css, verbatim, then a colour-free layout skeleton, then the review pages'
   own furniture. The skins are inlined in their own pages, after this sheet. */\n\n`
  + tokensCss + '\n\n' + brandBlock + '\n\n' + paletteCss + '\n\n' + themeCss + '\n\n' + SKELETON + '\n\n' + BOARD_CHROME;

const cssHash = createHash('sha256').update(previewCss).digest('hex').slice(0, 8);

const pageHead = (opt, title) => `<!doctype html>
<html lang="en"${opt.theme === 'dark' ? ' data-theme="dark"' : ''}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title>${esc(title)}</title>
<!-- The ?v= is a content hash, and it is load-bearing: the app's service worker
     serves same-origin subresources stale-while-revalidate, so without it a
     rebuilt preview.css would be answered from the cache once and the review
     would be of the previous build. A new hash is a new URL. -->
<link rel="stylesheet" href="preview.css?v=${cssHash}" />
<style>\n${opt.skin}\n</style>
</head>
<body class="pv">
<div class="pv-page">`;

const switcher = here => `
  <div class="pv-top">
    <h1>I-PASSBOOK — UI option ${here.key.toUpperCase()}: ${esc(here.name)}</h1>
    <p>${esc(here.tagline)}</p>
    <nav class="pv-tabs">
      <a class="pv-tab" href="index.html">All three</a>
      ${OPTIONS.map(o => `<a class="pv-tab${o.key === here.key ? ' is-here' : ''}" href="${o.key}.html">Option ${o.key.toUpperCase()} — ${esc(o.name)}</a>`).join('\n      ')}
    </nav>
  </div>`;

const notes = opt => `
  <div class="pv-notes">
    <div><h2>What it is</h2><p>${opt.blurb}</p></div>
    <div><h2>Why you might pick it</h2><ul>${opt.wins.map(w => `<li>${w}</li>`).join('')}</ul></div>
    <div><h2>What it costs you</h2><ul>${opt.loses.map(l => `<li>${l}</li>`).join('')}</ul></div>
    <div><h2>The fine print</h2><ul>
      <li>All four pages carry identical markup, taken from the app's real class names, and colour from its real tokens. Only the styling differs — in Option D that styling is mostly arrangement.</li>
      <li>They are static. Adopting one is a separate pass through the app; that pass is the expensive part, which is why you are choosing first.</li>
      <li>Sample records are shown (IR-412 and friends). The statuses, categories and REPAIR sub-categories are the real ones.</li>
      ${(opt.fine || []).map(f => `<li>${f}</li>`).join('\n      ')}
    </ul></div>
  </div>`;

const optionPage = opt => pageHead(opt, `UI option ${opt.key.toUpperCase()} — ${opt.name}`)
  + switcher(opt)
  + `
  <div class="pv-screens">
    ${SCREENS.map(s => `
    <div class="pv-shot">
      <div class="pv-shot-cap"><b>${esc(s.label)}</b><span>${esc(s.note)}</span></div>
      <div class="pv-phone">${s.html()}</div>
    </div>`).join('')}
  </div>`
  + notes(opt)
  + `
</div>
</body>
</html>
`;

const chooserPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title>I-PASSBOOK — UI options</title>
<link rel="stylesheet" href="preview.css?v=${cssHash}" />
<style>
.pv { background: var(--surface-gray-1); color: var(--ink-gray-9); }
.pv-page { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1rem 3.5rem; }
.pv-pick { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.pv-card { display: flex; flex-direction: column; gap: 0.6rem; padding: 1.1rem; background: var(--surface-base); border: 1px solid var(--outline-gray-1); border-radius: var(--radius-5); box-shadow: var(--elevation-sm); text-decoration: none; color: inherit; }
.pv-card:hover { box-shadow: var(--elevation-lg); border-color: var(--outline-elevation-2); }
.pv-card .k { font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-gray-5); }
.pv-card h2 { font-size: var(--text-lg); font-weight: var(--weight-semibold); margin: 0; }
.pv-card p { margin: 0; font-size: var(--text-sm); color: var(--ink-gray-7); }
.pv-card .go { margin-top: auto; font-size: var(--text-sm); color: var(--accent); font-weight: var(--weight-medium); }
.pv-swatches { display: flex; gap: 0.3rem; }
.pv-swatches span { width: 22px; height: 22px; border: 1px solid var(--outline-gray-1); }
.pv-card-note { margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px solid var(--outline-gray-1); font-size: var(--text-sm); color: var(--ink-gray-7); }
.pv-card-note h2 { font-size: var(--text-md); color: var(--ink-gray-9); }
/* Swatch colours are the option's own surfaces and accent, so the card previews
   the language rather than describing it. Light values here are literal because
   the chooser page is not inside any option's theme. */
.sw-a span:nth-child(1) { background: #ffffff; } .sw-a span:nth-child(2) { background: #f8f8f8; }
.sw-a span:nth-child(3) { background: #e2e2e2; } .sw-a span:nth-child(4) { background: #383838; }
.sw-b span:nth-child(1) { background: #171717; } .sw-b span:nth-child(2) { background: #383838; }
.sw-b span:nth-child(3) { background: #ffc400; } .sw-b span:nth-child(4) { background: #f8f8f8; }
.sw-c span:nth-child(1) { background: #ffffff; } .sw-c span:nth-child(2) { background: #f3f3f3; }
.sw-c span:nth-child(3) { background: #ededed; } .sw-c span:nth-child(4) { background: #3b6fd4; }
.sw-d span:nth-child(1) { background: #f8f8f8; } .sw-d span:nth-child(2) { background: #ffffff; }
.sw-d span:nth-child(3) { background: #e2e2e2; } .sw-d span:nth-child(4) { background: #0475d3; }
</style>
</head>
<body class="pv">
<div class="pv-page">
  <div class="pv-top" style="margin-bottom:1.25rem">
    <h1 style="font-size:var(--text-xl);font-weight:var(--weight-semibold)">I-PASSBOOK — pick a design direction</h1>
    <p style="color:var(--ink-gray-6);font-size:var(--text-sm);max-width:60ch">
      Four options. Each one shows the SAME four screens — sign-in, IR list, ticket,
      Insights — drawn from the app's real markup and its real colour tokens. A, B
      and C change the design language and leave the layout alone; D changes the
      arrangement. Open them in any order; they link to each other.
    </p>
  </div>

  <div class="pv-pick">
    ${OPTIONS.map(o => `
    <a class="pv-card" href="${o.key}.html">
      <span class="k">Option ${o.key.toUpperCase()}</span>
      <h2>${esc(o.name)}</h2>
      <div class="pv-swatches sw-${o.key}"><span></span><span></span><span></span><span></span></div>
      <p>${esc(o.tagline)}</p>
      <span class="go">Open option ${o.key.toUpperCase()} →</span>
    </a>`).join('')}
  </div>

  <div class="pv-card-note">
    <h2>Before you pick</h2>
    <p>
      The app currently runs <b>two</b> design languages at once: the ERPNext Desk look
      on the sign-in screen and the IR list, and a softer accent-tinted look on the
      ticket, Insights and every modal. That seam — not any single screen — is the
      main reason it reads as unfinished. Options A, B and C each collapse it to one
      language; D replaces the arrangement as well, so it is a bigger job.
    </p>
    <p>
      Option D is the arrangement of <b>Tabler</b>, a well-known admin template,
      drawn with your own tokens and your own blue. Its heading and filters sit on
      the page and only the results are a card; the status and category filters
      become a strip of big count tiles; cards are 8px with a soft shadow and
      statuses are pills with a dot. Nothing of Tabler is in the repo — no
      Bootstrap, no Tabler file, no seventh stylesheet — and the only things taken
      from it are four measurements: a 56px top bar, an 8px card radius, a 20px
      page title and a 15rem grid cell.
    </p>
    <p>
      If it looks out of date, add a <code>?1</code> to the address and reload: the
      app's service worker caches what it serves, and every page here carries a
      build hash so a fresh build is a fresh address.
    </p>

  <div class="pv-card-note">
    <h2>Then the parts, one at a time</h2>
    <p>
      Choosing a direction and choosing a <i>component</i> are different decisions, and
      judging six components while four whole screens compete for attention is how a good
      piece gets rejected for the company it kept. So the pieces from real Tabler that are
      worth having — spinners, milestone steps, clean toasts, charts, a people board — are
      built on a board of their own, in option D's language, and reviewed one at a time.
    </p>
    <div class="pv-pick" style="margin:0.9rem 0 0">
      <a class="pv-card" href="parts.html">
        <span class="k">Review 1 &mdash; four components</span>
        <h2>Steps, charts, People, spinner and toast</h2>
        <p>Three ways to draw the six saved sections, four charts drawn from numbers
           Insights already computes, the answer to the department board, and the two
           pieces you would feel rather than look at.</p>
        <span class="go">Open the parts board &rarr;</span>
      </a>
    </div>
    <p>
      And the second question, which is a different kind of judgement and gets its own
      board for that reason: what the app shows when there is <i>nothing</i> to show. The
      three empty states it really has, the CC0 illustration sets rendered in place, and
      one finding that settles most of it — every one of those sets bakes its own colours
      into the artwork, so the pink stays pink under all four of your accent presets.
    </p>
    <div class="pv-pick" style="margin:0.9rem 0 0">
      <a class="pv-card" href="empty.html">
        <span class="k">Review 2 &mdash; the empty states</span>
        <h2>Ours in the app's own line language, or a CC0 doodle</h2>
        <p>Three line drawings at 96px drawn the way every icon in the app is already
           drawn, one Open Doodles file as shipped and the same file re-coloured by two
           CSS rules, and the licence table — including the set that would have been the
           obvious first pick and cannot be committed at all.</p>
        <span class="go">Open the empty-state board &rarr;</span>
      </a>
    </div>
    <p>
      And the third, which is a workflow question wearing a layout costume. You asked for a kanban;
      what a kanban actually settles is <i>how a card moves between columns</i>, and the app has
      already answered two thirds of that in its own source comments. The board shows both sets of
      columns it could use &mdash; the four the app counts today, and the six sections the ticket's
      tab strip is already named after &mdash; and then one event, drawn three ways, with what each
      rule does to the ageing clock.
    </p>
    <div class="pv-pick" style="margin:0.9rem 0 0">
      <a class="pv-card" href="board.html">
        <span class="k">Review 3 &mdash; the board</span>
        <h2>Every IR in one board, and three ways a card can move</h2>
        <p>One board whose columns are the sections, holding all 412 IRs at once &mdash; plus the
           decision underneath it: does saving a section move the card, or does a person?
           The answer decides whether "In status 3d" stays true.</p>
        <span class="go">Open the board &rarr;</span>
      </a>
    </div>
  </div>
</div>
</body>
</html>
`;


// ═════════════════════════════════════════════════════════════════════════════
// REVIEW 1 — the component board (preview/parts.html)
// ═════════════════════════════════════════════════════════════════════════════
// The four options answer "what should the app look like". This page answers a
// different question — "which of these individual pieces earns its place" — one
// at a time, without a whole screen of noise around each. It is D-only on
// purpose: D is the approved direction, and skinning a component board four ways
// would turn every judgement into a comparison.
//
// It is written by this same builder on purpose. It inherits the token check, the
// NOT_A_COLOUR check, the no-script / no-third-party rule, the scoping rule and
// the --check staleness gate without a line of new machinery; what it adds is D's
// own skin, so the pieces arrive in the language that was approved.

// The six steps, mirroring SECTION_IDS / SECTION_LABELS / SECTION_SHORT in
// app.js. Written out rather than imported, because this file reads CSS and HTML
// as text and never evaluates app.js.
const BOARD_STEPS = [
  ['B', 'Inward', 'Inward Checklist'],
  ['C', 'IQC', 'IQC Visual Inspection'],
  ['D', 'Investigation', 'Investigation'],
  ['E', 'Production', 'Production (Rework)'],
  ['F', 'Quality Test', 'Quality Test Report'],
  ['G', 'PDI/Dispatch', 'PDI Report/Dispatch Record'],
];
// A deliberately UNEVEN passbook: B, C, D and F are saved, E never was. That hole
// is the entire reason the strip below cannot use Tabler's own shortcut — a tidy
// four-in-a-row would hide the problem the page exists to show.
const BOARD_DONE = ['sec-b', 'sec-c', 'sec-d', 'sec-f'];
const stepDone = i => BOARD_DONE.includes('sec-' + BOARD_STEPS[i][0].toLowerCase());
// "this step is done AND so is the next one" — which is what makes the line
// between them solid. Computed here rather than in CSS because the connector
// belongs to the item on its LEFT and a selector cannot look backwards.
const stepLinked = i => stepDone(i) && i + 1 < BOARD_STEPS.length && stepDone(i + 1);

// Tabler's .steps with THREE states instead of two. Tabler marks a POSITION and
// greys everything after it (.step-item.active ~ .step-item), which is right for
// a linear wizard and wrong for us: ir.done[] is a set that can have holes, so
// section F can be saved while E never was. Each dot therefore carries its own
// state and nothing is inferred from what precedes it. That is the one place this
// deliberately departs from Tabler, and it is the finding the board is here to
// make — see the note on the skin below.
const stepsStrip = () => `
        <ul class="steps">
          ${BOARD_STEPS.map(([letter, short, full], i) => `
          <li class="step-item${stepDone(i) ? ' is-done' : ''}${stepLinked(i) ? ' is-linked' : ''}">
            <span class="step-n">${letter}</span>
            <span class="step-short">${short}</span>
            <span class="step-full">${full}</span>
          </li>`).join('')}
        </ul>`;

// Tabler's OTHER progress idiom: .progress-steps, a row of pill bars instead of
// dots and a line. It is the more compact of the two and reads better on a phone,
// so both are on the board and you pick.
const compactSteps = () => `
        <ul class="progress-steps">
          ${BOARD_STEPS.map(([letter], i) => `
          <li class="progress-steps-item${stepDone(i) ? ' is-done' : ''}"><span class="pv-sr">Section ${letter}${stepDone(i) ? ' saved' : ' not saved yet'}</span></li>`).join('')}
        </ul>`;

// One bar split into six segments, each keeping its own colour — Tabler's
// .progress-stacked. It answers "how far through, and WHERE the holes are" in a
// single row, which a smooth bar cannot.
const stackedBar = () => `
        <div class="progress-stacked">
          ${BOARD_STEPS.map(([letter], i) => `
          <div class="progress"><div class="progress-bar${stepDone(i) ? ' is-done' : ''}"><span class="pv-sr">Section ${letter}</span></div></div>`).join('')}
        </div>`;

// The chip the app draws today, copied out of views.css so the board can show it
// beside the new ideas. smoke-preview.mjs asserts the copied fill width still
// matches views.css, so this copy cannot drift into a comparison against
// something the app does not actually do.
const currentChip = () => `
        <span class="ir-progress p4" title="4 of 6 sections saved">
          <span class="ir-progress-bar"></span>
          <span class="ir-progress-text">4/6</span>
        </span>`;

// A tab strip, twice: once plain, once with each tab carrying its own saved
// state. The second is not a different control — it is the same control with the
// state moved onto it, which is the whole point of variant B.
const tabRow = withState => `
        <div class="tabs-container">
          <span class="tab${withState ? ' is-saved' : ''}">Report</span>
          ${BOARD_STEPS.map(([letter, short], i) =>
            `<span class="tab${i === 0 ? ' active' : ''}${withState && stepDone(i) ? ' is-saved' : ''}">${letter}&#8202;&#183;&#8202;${short}</span>`).join('')}
        </div>`;

// ── the charts ───────────────────────────────────────────────────────────────
// Real shapes, real vocabulary. Every figure below is the shape the existing
// aggregator already produces — counts per month off dateRaisedISO, the status
// mix off insightsSummary().statuses, the categories off .categories. Nothing here
// is a second source of truth, so a chart can never disagree with the count above
// it, and a drawing is all that has to be written.
//
// HTML columns rather than SVG bars, deliberately: an SVG stretched with
// preserveAspectRatio="none" distorts its own rounded corners and any text inside
// it, and one that is not stretched has to reconcile a fixed viewBox with a
// container whose width it does not know. A twelve-column chart is a flex row.
const MONTHS = [
  ['Apr', 41], ['May', 38], ['Jun', 27], ['Jul', 33], ['Aug', 46], ['Sep', 52],
  ['Oct', 18], ['Nov', 0], ['Dec', 0], ['Jan', 0], ['Feb', 0], ['Mar', 0],
];
const monthChart = () => {
  const max = Math.max(...MONTHS.map(m => m[1]));
  return `
        <figure class="chart">
          <div class="cols">
            ${MONTHS.map(([label, v]) => `
            <div class="col">
              <span class="col-bar${v === 0 ? ' is-zero' : ''}" style="height:${v === 0 ? 0 : ((v / max) * 100).toFixed(1)}%"></span>
              <span class="col-t">${label}</span>
            </div>`).join('')}
          </div>
          <figcaption class="chart-note">Raised per month, from <b>dateRaisedISO</b> — the only sortable date a record carries. Months with nothing in them keep their slot, so the axis never quietly shortens.</figcaption>
        </figure>`;
};

// The status mix as one bar rather than four numbers.
const STATUS_MIX = [['Open', 37, 'open'], ['Paused', 6, 'paused'], ['Resolved', 318, 'resolved'], ['Closed', 51, 'closed']];
const statusChart = () => {
  const total = STATUS_MIX.reduce((n, s) => n + s[1], 0);
  return `
        <figure class="chart">
          <div class="mix-bar">
            ${STATUS_MIX.map(([label, v, key]) =>
              `<span class="mix-seg st-${key}" style="width:${((v / total) * 100).toFixed(2)}%"><span class="pv-sr">${label}: ${v}</span></span>`).join('')}
          </div>
          <div class="mix-key">
            ${STATUS_MIX.map(([label, v, key]) =>
              `<span class="mix-key-item"><span class="mix-dot st-${key}"></span>${label}<b>${v}</b></span>`).join('')}
          </div>
          <figcaption class="chart-note">The same <b>statuses</b> bucket the screen already counts, drawn instead of listed. The colours are the app's own <b>--st-*-fg</b> tokens, so the industrial.css contrast fix reaches them for free.</figcaption>
        </figure>`;
};

// Category mix as bars.
const CATS = [['REMOTE SUPPORT', 224], ['GENERAL MAINTENANCE', 121], ['REPAIR', 58], ['CRASH', 9]];
const categoryChart = () => {
  const max = Math.max(...CATS.map(c => c[1]));
  return `
        <figure class="chart">
          ${CATS.map(([label, v]) => `
          <div class="bar-row">
            <span class="bar-label">${label}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${((v / max) * 100).toFixed(1)}%"></span></span>
            <span class="bar-n">${v}</span>
          </div>`).join('')}
          <figcaption class="chart-note">Rendered straight from <b>insightsSummary().categories</b> — the pure single-pass function the screen already calls, so charting adds rendering and nothing else.</figcaption>
        </figure>`;
};

// ── the People card ──────────────────────────────────────────────────────────
// Counting by ASSIGNEE, not by department. No IR carries a department; the only
// membership list lives in an admin-only store whose own admin session reads back
// empty. So the card is called People, because that is what it measures, and a
// card headed "Departments" while counting something else would be worse than no
// card. "Unassigned" is a row like any other — untriaged IRs have no assignee, and
// without it the column would not add up to the total.
const PEOPLE = [
  ['Angad Kumbhar', 'AK', 46, 3],
  ['Monish Raza', 'MR', 38, 1],
  ['S. Iyer', 'SI', 27, 0],
  ['Priya Nair', 'PN', 19, 2],
  ['Kishor Salunkhe', 'KS', 12, 0],
  [null, null, 23, 5],
];
const peopleCard = () => {
  const max = Math.max(...PEOPLE.map(p => p[2]));
  return `
        <div class="people">
          <div class="people-head">
            <span class="people-h">People</span>
            <span class="people-sub">who is carrying what</span>
          </div>
          ${PEOPLE.map(([name, init, open, late]) => `
          <div class="person${name ? '' : ' is-unassigned'}">
            <span class="person-face">${init || '?'}</span>
            <span class="person-name">${name || 'Unassigned'}</span>
            <span class="person-track"><span class="person-fill" style="width:${((open / max) * 100).toFixed(1)}%">${late ? `<span class="person-late" style="width:${((late / open) * 100).toFixed(1)}%"></span>` : ''}</span></span>
            <span class="person-n">${open}</span>
            ${late ? `<span class="badge badge-danger">${late} late</span>` : '<span class="person-clear"></span>'}
          </div>`).join('')}
          <p class="chart-note">Counted from the Allot CAPS <b>assignee</b>. Untriaged IRs have none, so they are the last row rather than missing from the sum. Initials, not photographs — the app already draws an initials avatar in its header, and initials need nothing vendored.</p>
        </div>`;
};

// ── the spinners ─────────────────────────────────────────────────────────────
// Tabler's .spinner-border is drawn in currentColor, so it takes the colour of
// whatever it sits inside and needs no token of its own. The app already has
// @keyframes spin and .legacy-spinner; this is the same idea in Tabler's measured
// shape, not a third parallel loading system.
const spinner = (size, label, tone) => `
          <span class="spin-demo${tone ? ' spin-' + tone : ''}">
            <span class="spinner-border${size === 'sm' ? ' spinner-border-sm' : ''}" role="status" aria-label="${label}"></span>
            <span class="spin-label">${label}</span>
          </span>`;

// ── the toasts ───────────────────────────────────────────────────────────────
// Left is what the app shows today, recreated from base.css so the comparison is
// against the real thing rather than a memory of it. Right is Tabler's
// arrangement: a header, a body and a tinted mark. It is a RESTYLE of the single
// element the app already has, not a second toast system — the app's contract is
// one message that replaces the last, and nothing here asks for a queue.
const toastNew = (tone, title, body) => `
          <div class="toast${tone ? ' toast-' + tone : ''}">
            <div class="toast-header">
              <span class="toast-dot"></span>
              <strong class="toast-title">${title}</strong>
              <span class="toast-x" aria-hidden="true">&#215;</span>
            </div>
            <div class="toast-body">${body}</div>
          </div>`;

// ── the board's chrome ───────────────────────────────────────────────────────
const boardTop = (title, sub, here) => `
  <div class="pv-top">
    <h1>${esc(title)}</h1>
    <p>${esc(sub)}</p>
    <nav class="pv-tabs">
      <a class="pv-tab" href="index.html">The four options</a>
      <a class="pv-tab${here === 'parts' ? ' is-here' : ''}" href="parts.html">Parts</a>
      <a class="pv-tab${here === 'empty' ? ' is-here' : ''}" href="empty.html">Empty states</a>
      <a class="pv-tab${here === 'board' ? ' is-here' : ''}" href="board.html">Board</a>
    </nav>
  </div>`;

const boardJump = () => `
  <nav class="pv-jump">
    <a href="#steps">Steps and progress</a>
    <a href="#charts">Charts and stats</a>
    <a href="#people">People</a>
    <a href="#feedback">Spinner and toast</a>
  </nav>`;

const boardBlock = (id, kicker, title, note, body) => `
  <section class="pv-block" id="${id}">
    <span class="pv-kicker">${kicker}</span>
    <h2 class="pv-block-title">${title}</h2>
    <p class="pv-block-note">${note}</p>
    ${body}
  </section>`;

const demo = (label, hint, inner, cls) => `
      <div class="pv-demo${cls ? ' ' + cls : ''}">
        <div class="pv-demo-cap"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div>
        <div class="pv-app is-demo">${inner}</div>
      </div>`;

const CAVEAT_STEPS = `
      <div class="pv-caveat">
        <b>Two things this strip cannot say.</b> <b>done[]</b> is monotonic — saving appends and nothing
        removes — so a step reading done means <i>this section was saved</i>, never <i>this section is
        filled</i>. A step can be solid over a section with three empty fields. And there is no per-step
        timestamp on the record, so "when did each step complete?" is only answerable from the audit log,
        which is a separate read. Neither is a reason not to build it; both are reasons not to word it
        as "complete".
      </div>`;

const CAVEAT_CHARTS = `
      <div class="pv-caveat">
        <b>Never canvas.</b> The one canvas painting in the app hardcodes six hex values precisely
        because a canvas cannot read a CSS custom property — which would freeze one palette and one
        theme. These are HTML and SVG filled with the app's own tokens, so every palette and both themes
        follow for nothing. And an <b>undated</b> bucket is shown rather than swallowed: dropping rows
        with no parseable date would make a chart disagree with the total printed above it.
      </div>`;

const CAVEAT_TOAST = `
      <div class="pv-caveat">
        <b>The toast contract is not negotiable, and none of this changes it.</b> One element,
        <b>#toast</b> holding <b>#toast-text</b>; the message is written into that span and never over it,
        because <b>pointer-events: none</b> on the span is what lets a tap reach the pill that dismisses
        it. One message replaces the last — the old busy latch is gone and documented as a bug, not a
        design. <b>.show</b> stays the class toggle and the 2.5s clock stays. Only the paint changes,
        which is why this can be adopted without touching logic that took a bug to get right.
      </div>`;

const partsBoard = () => boardJump() + `

${boardBlock('steps', 'Component 1 of 4', 'Steps and progress',
  'Three ways to draw the same six saved sections, plus the chip the app already has. All four read <b>ir.done[]</b> and <b>sectionProgress()</b> — nothing here needs a new field, a new endpoint or a backend change.',
  demo('Tabler steps', 'dots and a line, with three states rather than two', stepsStrip(), 'pv-demo-pad')
+ demo('Compact steps', 'Tabler progress-steps: pill bars, no labels', compactSteps(), 'pv-demo-pad')
+ demo('Stacked bar', 'progress-stacked: one bar split into six segments', stackedBar(), 'pv-demo-pad')
+ demo('What the app has today', 'the 4/6 chip, copied from views.css', currentChip(), 'pv-demo-pad')
+ demo('Ticket, variant A', 'steps above, tabs kept — literally what you asked for', stepsStrip() + tabRow(false), 'pv-demo-ticket')
+ demo('Ticket, variant B', 'the tabs carry the state — one strip, not two', compactSteps() + tabRow(true), 'pv-demo-ticket')
+ CAVEAT_STEPS)}

${boardBlock('charts', 'Component 2 of 4', 'Charts and stats',
  'Insights already computes every number on the screen in one pure pass. These are drawings of that same output, not a second set of sums, so a chart can never disagree with the count printed above it.',
  demo('Raised per month', 'columns — twelve slots, empty months kept', monthChart(), 'pv-demo-pad')
+ demo('Status mix', 'one bar instead of four numbers', statusChart(), 'pv-demo-pad')
+ demo('Category mix', 'bars straight from insightsSummary().categories', categoryChart(), 'pv-demo-pad')
+ demo('Stat tile with a sparkline', 'the count tile from option D, carrying a trend', `
          <div class="segs-demo">
            <span class="segment"><span class="segment-count">412</span>All</span>
            <span class="segment active"><span class="segment-count">37</span>Open</span>
            <span class="segment"><span class="segment-count">6</span>Paused</span>
          </div>
          <div class="spark-tile">
            <span class="spark-k">Open, last 30 days</span>
            <span class="spark-v">37<span class="spark-delta">&#43;4</span></span>
            <svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="Open IRs over the last 30 days"><polyline class="spark-line" points="0,22 9,19 18,21 27,14 36,16 45,9 54,12 63,6 72,10 81,4 90,7 100,3" /></svg>
          </div>`, 'pv-demo-pad')
+ CAVEAT_CHARTS)}

${boardBlock('people', 'Component 3 of 4', 'People',
  'This is the answer to the department board — counting by <b>assignee</b> instead. No IR carries a department anywhere, so a card headed "Departments" would be counting something else.',
  demo('Team load', 'initials, a bar, and an Unassigned row', peopleCard(), 'pv-demo-pad'))}

${boardBlock('feedback', 'Component 4 of 4', 'Spinner and toast',
  'The two pieces you would feel rather than look at. The spinner is Tabler’s, drawn in <b>currentColor</b> so it takes the colour of wherever it sits. The toast is a restyle of the single element the app already has — one message that replaces the last, never a queue.',
  demo('Spinner, two sizes', 'the sign-in wait is the one that needs it most', `
          ${spinner('lg', 'Signing you in…', 'accent')}
          ${spinner('sm', 'Saving section D…', '')}`, 'pv-demo-pad')
+ demo('Spinner in a button', 'today the label swaps and nothing else moves', `
          <div class="btn-demo">
            <span class="btn is-busy"><span class="spinner-border spinner-border-sm" role="status" aria-label="Signing in"></span>Signing in…</span>
            <span class="btn btn-secondary is-busy"><span class="spinner-border spinner-border-sm" role="status" aria-label="Saving"></span>Saving…</span>
          </div>`, 'pv-demo-pad')
+ demo('Toast, today and proposed', 'left is base.css; right is the restyle', `
          <div class="toast-pair">
            <div class="toast-col">
              <span class="toast-tag">Today</span>
              <div class="toast-today">Section saved successfully!</div>
            </div>
            <div class="toast-col">
              <span class="toast-tag">Proposed</span>
              ${toastNew('', 'Saved', 'Section D saved. Analysis date stamped.')}
              ${toastNew('danger', 'Could not save', 'Backend unreachable — kept on this device.')}
              ${toastNew('success', 'Comment posted', 'Kishor was emailed automatically.')}
            </div>
          </div>`, 'pv-demo-pad')
+ CAVEAT_TOAST)}
`;

// The board's stylesheet. D's skin first, so every shared component arrives in
// the approved language, then the rules for the pieces that do not exist yet.
//
// The geometry is Tabler 1.6.1's, read off its own stylesheet rather than
// remembered: dot 0.5rem, connector 2px, items flex: 1 1 0 with overflow-x auto;
// spinner 1.5rem on a 2px currentColor border; toast 350px max on a 1px border
// with a tinted header. The MEASUREMENTS are Tabler's. The COLOURS are the app's
// own tokens, because that is the only way a preview stays honest about what the
// app can actually produce.
const PARTS_SKIN = OPTIONS.find(o => o.key === 'd').skin + `

/* The board's own furniture — the jump row, the blocks, the demo card, the
   caveat — is in BOARD_CHROME, in the shared sheet, because BOTH boards use it.
   This block is only what the parts board alone needs. */

/* On the ticket demos the tab strip insets itself by 0.9rem, so the compact bar
   above it has to inset to match — otherwise the two rows read as unrelated.

   The auto width is load-bearing, and it is the whole reason this rule has a
   width in it at all. The base rule sets width:100%, which resolves against the
   containing block's CONTENT box — and a margin is added outside that. So "100%
   wide, with 0.9rem each side" is 1.8rem wider than the space it has, and the bar
   runs out past the right edge of the frame. A block with width:auto is sized to
   fit its margins instead, which is what was meant. It showed up as a 14px spill
   in a geometry probe at phone width and nowhere else: at desktop width the demo
   frame is wide enough to absorb it.

   The three class names are load-bearing: .pv-app .progress-steps below is two,
   so this has to be three to win. It used to also need to come last, back when
   both rules were in this skin; now the base rule is in the later sheet and this
   still wins on specificity, which is the arrangement that cannot break by
   someone re-ordering a file. */
.pv-demo-ticket .pv-app .progress-steps { width: auto; margin: 0 0.9rem 0.7rem; }

/* ── .steps — Tabler 1.6.1 geometry, three states instead of two ──
   Tabler marks a POSITION: .step-item.active, and every item after it is greyed
   by a sibling selector. That is correct for a linear wizard and wrong here,
   because ir.done[] is a set with holes in it — section F can be saved while E
   never was. So each dot carries its own state and nothing is inferred from what
   precedes it. This is the one deliberate departure from Tabler on this page. */
.pv-app .steps { display: flex; flex-wrap: nowrap; gap: 0; width: 100%; margin: 0; padding: 0; list-style: none; overflow-x: auto; overflow-y: hidden; }
.pv-app .step-item { position: relative; flex: 1 1 0; min-width: 2.5rem; min-height: 1rem; padding: 1rem 0.2rem 0; text-align: center; }
.pv-app .step-item::before { position: absolute; inset-inline-start: 50%; top: 0; z-index: 1; box-sizing: content-box; width: 0.5rem; height: 0.5rem; content: ""; transform: translateX(-50%); border-radius: 50%; background: var(--outline-gray-3); }
.pv-app .step-item:not(:last-child)::after { position: absolute; inset-inline-start: 50%; top: 0.25rem; width: 100%; height: 2px; content: ""; transform: translateY(-50%); background: var(--outline-gray-2); }
.pv-app .step-item.is-done::before { background: var(--accent); }
.pv-app .step-item.is-done.is-linked::after { background: var(--accent); }
.pv-app .step-n { display: block; color: var(--ink-gray-5); font-size: var(--text-2xs); font-weight: var(--weight-semibold); letter-spacing: 0.04em; }
.pv-app .step-item.is-done .step-n { color: var(--accent); }
.pv-app .step-short { display: block; margin-top: 0.1rem; color: var(--ink-gray-6); font-size: var(--text-2xs); }
.pv-app .step-item.is-done .step-short { color: var(--ink-gray-8); font-weight: var(--weight-medium); }
/* The long name is for a wide screen; on a phone the letters carry it. */
.pv-app .step-full { display: none; }

/* ── .progress-steps — Tabler's compact variant: pill bars, no dots ── */
.pv-app .progress-steps { display: flex; flex-wrap: nowrap; gap: 0.25rem; width: 100%; margin: 0; padding: 0; list-style: none; }
.pv-app .progress-steps-item { flex: 1 1 0; min-height: 0.25rem; border-radius: var(--radius-9); background: var(--outline-gray-2); }
.pv-app .progress-steps-item.is-done { background: var(--accent); }

/* ── .progress-stacked — one bar, one segment per section ── */
.pv-app .progress-stacked { display: flex; gap: 2px; width: 100%; height: 0.5rem; }
.pv-app .progress-stacked .progress { display: flex; flex: 1 1 0; min-width: 0; height: 100%; overflow: hidden; border-radius: var(--radius-9); background: var(--surface-gray-3); }
.pv-app .progress-stacked .progress-bar { width: 100%; background: var(--surface-gray-3); }
.pv-app .progress-stacked .progress-bar.is-done { background: var(--accent); }

/* ── the app's existing chip, copied from views.css so the comparison is real ──
   smoke-preview.mjs ties the fill width below back to views.css, so this copy
   cannot drift into a comparison against something the app no longer draws. */
.pv-app .ir-progress { display: inline-flex; align-items: center; gap: 5px; }
.pv-app .ir-progress-bar { display: block; width: 30px; height: 4px; overflow: hidden; border-radius: var(--radius-9); background: var(--surface-gray-3); }
.pv-app .ir-progress-bar::after { display: block; width: 66.666%; height: 100%; content: ""; border-radius: inherit; background: var(--ink-gray-6); }
.pv-app .ir-progress-text { color: var(--ink-gray-5); font-size: var(--text-2xs); line-height: 1; font-variant-numeric: tabular-nums; }

/* ── the tabs, once with the state carried on them ──
   The strip already has a slot for exactly this. views.css puts an unsaved dot in
   the tab's right padding via .tab.has-unsaved::after; a saved section shows a
   mark in the same slot, so variant B costs no new control and no new row. */
.pv-app .tabs-container { display: flex; gap: 0.25rem; overflow-x: auto; padding: 0 0.9rem; scrollbar-width: none; }
.pv-app .tabs-container::-webkit-scrollbar { display: none; }
.pv-app .tab { position: relative; flex: 0 0 auto; padding: 0.55rem 0.75rem; white-space: nowrap; border-bottom: 2px solid transparent; color: var(--ink-gray-5); font-size: var(--text-sm); font-weight: var(--weight-medium); }
.pv-app .tab.active { border-bottom-color: var(--accent); color: var(--accent); }
.pv-app .tab.is-saved { padding-right: 1.3rem; }
.pv-app .tab.is-saved::after { position: absolute; top: 0.5rem; right: 0.45rem; width: 5px; height: 5px; content: ""; border-radius: 50%; background: var(--accent); }

/* ── charts ── */
.pv-app .chart { margin: 0; }
.pv-app .chart-note { margin-top: 0.6rem; color: var(--ink-gray-6); font-size: var(--text-xs); line-height: var(--leading-body); }
.pv-app .chart-note b { color: var(--ink-gray-8); font-weight: var(--weight-medium); }
/* Twelve columns as a flex row rather than stretched SVG: a stretched viewBox
   distorts its own rounded corners and any text inside it. */
.pv-app .cols { display: flex; gap: 3px; align-items: flex-end; height: 108px; }
.pv-app .col { display: flex; flex: 1 1 0; min-width: 0; flex-direction: column; justify-content: flex-end; align-items: center; gap: 0.35rem; height: 100%; }
.pv-app .col-bar { width: 100%; max-width: 2.25rem; min-height: 2px; border-radius: var(--radius-3); background: var(--accent); }
.pv-app .col-bar.is-zero { background: var(--surface-gray-3); }
.pv-app .col-t { flex: 0 0 auto; color: var(--ink-gray-5); font-size: var(--text-2xs); }
.pv-app .mix-bar { display: flex; gap: 2px; height: 0.75rem; }
.pv-app .mix-seg { border-radius: var(--radius-9); }
.pv-app .mix-key { display: flex; flex-wrap: wrap; gap: 0.35rem 1rem; margin-top: 0.6rem; }
.pv-app .mix-key-item { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--ink-gray-7); font-size: var(--text-xs); }
.pv-app .mix-key-item b { color: var(--ink-gray-9); font-variant-numeric: tabular-nums; }
.pv-app .mix-dot { width: 8px; height: 8px; border-radius: 50%; }
.pv-app .st-open { background: var(--st-open-fg); }
.pv-app .st-paused { background: var(--st-paused-fg); }
.pv-app .st-resolved { background: var(--st-resolved-fg); }
.pv-app .st-closed { background: var(--st-closed-fg); }
.pv-app .bar-row { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.45rem; }
.pv-app .bar-label { flex: 0 0 9.5rem; color: var(--ink-gray-7); font-size: var(--text-2xs); letter-spacing: 0.02em; text-transform: uppercase; }
.pv-app .bar-track { flex: 1 1 auto; min-width: 0; height: 0.45rem; overflow: hidden; border-radius: var(--radius-9); background: var(--surface-gray-3); }
.pv-app .bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
.pv-app .bar-n { flex: 0 0 auto; color: var(--ink-gray-8); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.pv-app .segs-demo { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 0.9rem; }
.pv-app .spark-tile { display: flex; flex-direction: column; gap: 0.2rem; max-width: 24rem; padding: 0.7rem 0.85rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); }
.pv-app .spark-k { color: var(--ink-gray-6); font-size: var(--text-2xs); letter-spacing: 0.02em; text-transform: uppercase; }
.pv-app .spark-v { display: flex; align-items: baseline; gap: 0.4rem; color: var(--ink-gray-9); font-size: var(--text-3xl); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-3xl); font-variant-numeric: tabular-nums; }
.pv-app .spark-delta { color: var(--ink-green-7); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.pv-app .spark { display: block; width: 100%; height: 28px; }
/* non-scaling-stroke keeps the line 2px wide however far the viewBox is
   stretched, so a sparkline in a wide tile does not go hairline. */
.pv-app .spark-line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }

/* ── People ── */
.pv-app .people { display: flex; flex-direction: column; gap: 0.1rem; }
.pv-app .people-head { display: flex; align-items: baseline; gap: 0.5rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--outline-gray-2); }
.pv-app .people-h { font-size: var(--text-3xl); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-3xl); }
.pv-app .people-sub { color: var(--ink-gray-6); font-size: var(--text-2xs); letter-spacing: 0.04em; text-transform: uppercase; }
.pv-app .person { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0; border-bottom: 1px solid var(--outline-gray-1); }
.pv-app .person:last-of-type { border-bottom: 0; }
.pv-app .person-face { display: grid; place-items: center; flex: 0 0 auto; width: 26px; height: 26px; border: 1px solid var(--accent-soft-line); border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: var(--text-2xs); font-weight: var(--weight-semibold); }
.pv-app .person.is-unassigned .person-face { border-color: var(--outline-gray-2); background: var(--surface-gray-3); color: var(--ink-gray-6); }
.pv-app .person-name { flex: 0 0 8.5rem; min-width: 0; overflow: hidden; color: var(--ink-gray-8); font-size: var(--text-sm); text-overflow: ellipsis; white-space: nowrap; }
.pv-app .person-track { flex: 1 1 auto; min-width: 0; height: 0.4rem; overflow: hidden; border-radius: var(--radius-9); background: var(--surface-gray-3); }
.pv-app .person-fill { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
/* The overdue share is a red segment at the start of the bar, not a recoloured
   whole bar. Recolouring the whole width said "this person has at least one late
   IR" and nothing about how many — so a bar 46 long and a bar 12 long were the
   same red, and the colour stopped tracking the number it sits next to. */
.pv-app .person-late { display: block; height: 100%; border-radius: inherit; background: var(--st-danger-fg); }
.pv-app .person-n { flex: 0 0 auto; color: var(--ink-gray-9); font-size: var(--text-xs); font-weight: var(--weight-medium); font-variant-numeric: tabular-nums; }
.pv-app .person-clear { flex: 0 0 auto; width: 3.6rem; }

/* ── spinner — Tabler's, in currentColor so it needs no colour of its own ── */
@keyframes board-spin { to { transform: rotate(360deg); } }
.pv-app .spinner-border { display: inline-block; flex-shrink: 0; width: 1.5rem; height: 1.5rem; vertical-align: -0.125em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: 0.75s linear infinite board-spin; }
.pv-app .spinner-border-sm { width: 1rem; height: 1rem; border-width: 1px; }
.pv-app .spin-demo { display: inline-flex; align-items: center; gap: 0.6rem; margin-right: 1.75rem; color: var(--ink-gray-7); }
.pv-app .spin-accent { color: var(--accent); }
.pv-app .spin-label { color: inherit; font-size: var(--text-sm); }
.pv-app .btn-demo { display: flex; flex-wrap: wrap; gap: 0.6rem; }
.pv-app .btn.is-busy { gap: 0.5rem; }
.pv-app .btn .spinner-border, .pv-app .btn-secondary .spinner-border { width: 14px; height: 14px; border-width: 2px; }

/* ── toast — Tabler's arrangement over the app's ONE element ──
   The app has a single #toast holding a single #toast-text, and a newer message
   replaces the older one. Nothing below adds a second toast or a queue; it is a
   restyle of that element, which is why it can be adopted without touching the
   logic that took a bug to get right. */
.pv-app .toast-pair { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.pv-app .toast-col { display: flex; flex-direction: column; gap: 0.6rem; }
.pv-app .toast-tag { color: var(--ink-gray-5); font-size: var(--text-2xs); letter-spacing: 0.06em; text-transform: uppercase; }
/* What base.css draws today, kept faithful to its own values rather than tidied —
   including its max-width. Without it the pill stretches to the column and looks
   far worse than the thing it is supposed to be a fair comparison against. */
.pv-app .toast-today { width: 100%; max-width: min(420px, 100%); padding: 9px 16px; border-radius: var(--radius-4); background: var(--surface-gray-10); color: var(--ink-base); font-size: var(--text-sm); font-weight: var(--weight-medium); text-align: center; box-shadow: var(--elevation-xl); }
.pv-app .toast { width: 100%; max-width: 350px; overflow: hidden; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); background: var(--surface-base); box-shadow: var(--elevation-lg); }
.pv-app .toast-header { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--outline-gray-1); background: var(--surface-gray-1); }
.pv-app .toast-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-gray-5); }
.pv-app .toast-title { flex: 1 1 auto; color: var(--ink-gray-8); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.pv-app .toast-x { color: var(--ink-gray-5); font-size: var(--text-sm); line-height: 1; }
.pv-app .toast-body { padding: 0.75rem; color: var(--ink-gray-7); font-size: var(--text-sm); }
.pv-app .toast-danger .toast-dot { background: var(--st-danger-fg); }
.pv-app .toast-success .toast-dot { background: var(--st-resolved-fg); }

@media (max-width: 639px) {
  .pv-app.is-demo { flex-direction: column; min-height: 0; }
  .pv-app .person-name { flex: 0 0 6.5rem; }
  .pv-app .bar-label { flex: 0 0 6.5rem; }
  .pv-jump { gap: 0.3rem; }
  /* Six equal cells in a 390px screen leave about 54px each, and "Investigation"
     needs 84 — measured, not guessed: the labels ran over their neighbours and the
     strip's own overflow-x hid the fact. So on a phone the letters carry it, the
     same way the app's own tab strip already reads "B · Inward". The long name is
     still there for a screen reader, and the connectors and dots still show where
     the holes are. */
  .pv-app .step-item { min-width: 0; padding-left: 0.1rem; padding-right: 0.1rem; }
  .pv-app .step-short { display: none; }
  .pv-app .step-n { font-size: var(--text-sm); }
  /* The compact variant keeps its four labels on one line by letting the row
     scroll, which is what Tabler's own .progress-steps does. */
  .pv-app .bar-track { min-width: 3rem; }
}
`;

// ══ Review 2: empty states, and the illustrations that could sit in them ═════
//
// The second review, kept separate from the parts board because it is a
// different kind of judgement: the parts board asks whether a component is
// built right, this one asks whether a picture belongs in the app at all. The
// owner asked to look at the CC0 sets separately, and a style call cannot be
// made while six components are competing for attention.
//
// THE FINDING THIS BOARD EXISTS TO SHOW, and it is not the one the plan
// expected. Every one of these sets HARDCODES ITS OWN PALETTE:
//
//   Open Doodles   2 fills  (#000000 line + #FF5678 accent)  — in ALL 33 files
//   Open Peeps     6 fills  (black, white, #FF5989, #91D7E0 …)
//   Humaaans      11 fills  (a full figure palette)
//
// The app has FOUR accent presets and two themes, and every piece of the app
// draws with var(--accent) and currentColor. An illustration with a baked-in
// pink cannot do that: it is pink under the teal preset, pink in dark mode, and
// nothing in the design system can change it.
//
// So the board does not merely assert this. It renders each set AS SHIPPED, so
// the clash is visible, and then renders Open Doodles a second time with two
// CSS rules pointing its two fills at tokens — which is a real, small fix, not a
// hope: a presentation attribute loses to any CSS rule, so `[fill="#FF5678"]
// { fill: var(--accent) }` re-colours the artwork outright. Humaaans and Open
// Peeps cannot be fixed that way without redrawing them, because the problem is
// not one colour, it is eleven.

const ILLUSTRATIONS = {
  unboxing: 'vendor/illustrations/open-doodles/unboxing.svg',
  chilling: 'vendor/illustrations/open-doodles/chilling.svg',
  levitate: 'vendor/illustrations/open-doodles/levitate.svg',
  peep: 'vendor/illustrations/open-peeps/happy.svg',
  humaaans: 'vendor/illustrations/humaaans/hero-1.svg',
};

// Read a vendored file and make it safe to paste into a page. Five jobs:
//
//   1. Drop the XML prologue and any comments. The prologue is not valid inside
//      an HTML body, and the comments are the artist's generator credit
//      ("Generator: Sketch 57.1 — https://sketch.com"), which is a URL that
//      fetches nothing and would still trip the build's no-third-party guard.
//      Removing a comment is not weakening that guard: it still catches a real
//      <image href="https://...">, which is the thing it is for.
//   2. Drop the xmlns declarations. They are namespace identifiers, not fetches,
//      and inline HTML does not need them — the parser puts <svg> in the SVG
//      namespace on its own and understands xlink:href without being told.
//   3. Namespace every id, and rewrite the refs that point at them. Open Peeps
//      carries 20 ids and Humaaans 22, and an inlined SVG inherits the PAGE's id
//      space: a collision would silently repoint a clip-path at the wrong
//      element, which shows up as a shape filling in wrong rather than as error.
//      The prefix is per INSTANCE, not per file, because this board deliberately
//      shows one artwork more than once — as shipped, re-coloured, and under four
//      accent presets. Those are six copies of the same nine ids, and a page with
//      the same id six times is invalid markup whatever the browser does with it.
//      So the counter below is not decoration: it is what makes the page legal.
//
//   4. Delete width/height and put the sizing in CSS, so one rule can size every
//      set. The viewBox stays, so the shape and aspect survive. The regex needs
//      the leading \s, otherwise it would also eat the width out of
//      stroke-width.
//   5. Add the class and aria-hidden. These are decoration: the sentence beside
//      them is what a screen reader should read.
//
// The vendored files themselves are left exactly as downloaded, metadata and all
// — provenance belongs on disk, not in the page.
let illInstance = 0;
const inlineSvg = (slug, cls) => {
  // One number for the whole call, taken once. Advancing it per id would give
  // each id a different prefix and leave every href pointing at the last one
  // seen — a set of refs that resolve to the wrong element or to nothing.
  const n = ++illInstance;
  // Ids inside one file are not unique either, and that is the vendored files'
  // own doing, not a mistake here: they are Sketch exports, and Sketch emits one
  // id per SHAPE — unboxing.svg carries id="ink-shape" SEVENTEEN times. Those
  // duplicates are unreferenced labels, so the file renders fine on its own, but
  // pasting it into a page inherits seventeen collisions. So the first occurrence
  // keeps the plain name and the rest are numbered, which also matches how a
  // browser resolves a repeated id: the first one, in document order.
  const seen = new Map();
  return read(ILLUSTRATIONS[slug])
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\sxmlns(:xlink)?="[^"]*"/g, '')
    .replace(/\sid="([^"]+)"/g, (_, id) => {
      const k = (seen.get(id) || 0) + 1;
      seen.set(id, k);
      return k === 1
        ? ` id="ill-${slug}-${n}-${id}"`
        : ` id="ill-${slug}-${n}-dup${k}-${id}"`;
    })
    .replace(/(xlink:href|href)="#([^"]+)"/g, (_, a, id) => `${a}="#ill-${slug}-${n}-${id}"`)
    .replace(/\s(width|height)="[^"]*"/g, '')
    .replace(/<svg\b/, `<svg class="${cls}" aria-hidden="true" focusable="false"`)
    .trim();
};

// Our own candidate, and the case for it is stronger than "we have no other
// option": the app ALREADY draws like this. Every glyph in it comes from
// ICON_PATHS — 24x24, fill:none, stroke:currentColor, round caps and joins — so
// these are not a new visual language, they are the app's own language at 96px.
// That is also why they obey all four accent presets and both themes without a
// single override: there is nothing in them but currentColor and var(--accent).
//
// The stroke is proportionally LIGHTER than the icons' 1.75/24 (which would be
// 7px here and read as a heavy outline). A 96px illustration is looked at, not
// decoded at a glance, so it can afford to be finer than a 24px glyph.
const OUR_ART = {
  // A list with nothing on it and a glass over it — "no IRs match this filter".
  filter: `
      <rect x="14" y="10" width="46" height="62" rx="7"/>
      <path d="M24 26h26"/><path d="M24 38h26"/><path d="M24 50h15"/>
      <circle cx="64" cy="58" r="16" stroke="var(--accent)"/>
      <path d="M75 69l10 10" stroke="var(--accent)"/>`,
  // An open crate with nothing in it — "no IRs found".
  empty: `
      <path d="M14 42h68v32a7 7 0 0 1-7 7H21a7 7 0 0 1-7-7z"/>
      <path d="M31 42L40 22h16l9 20" stroke="var(--accent)"/>
      <path d="M14 42h68"/>`,
  // A telemetry trace with a failed mark on it — the log reader did not load.
  logfail: `
      <path d="M10 44h13l7-19 9 40 8-21h11"/>
      <circle cx="72" cy="66" r="16" stroke="var(--accent)"/>
      <path d="M66 60l12 12" stroke="var(--accent)"/>
      <path d="M78 60L66 72" stroke="var(--accent)"/>`,
};

const ourIll = k => `<svg class="pv-ill" viewBox="0 0 96 96" aria-hidden="true" focusable="false"
        fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${OUR_ART[k]}</svg>`;

// The three empty states the app really has, copied from the code, not invented.
// There is no fourth: the plan expected one on Insights ("nothing to chart yet")
// and the app does not have one — insightsSummary always reports a total, so a
// filtered-to-nothing Insights screen shows zeroes, not an empty state. A board
// showing a state the app cannot produce would be the same failure as a test
// double that invents an API.
//
// Two of the three carry a 2.5rem EMOJI (app.js:5061, 5062) and the third has no
// mark at all (app.js:4425). The emoji is worth looking at closely: it is a
// colour bitmap rendered by the operating system, identical in both themes, and
// no token can touch it.
const EMPTY_STATES = [
  ['No IRs match this filter.', '\u{1F50D}', 'app.js:5061 — the list under a filter'],
  ['No IRs found. Create one via the customer form.', '\u{1F4ED}', 'app.js:5062 — the list with nothing in it'],
  ['The flight-log reader did not load. Reload the app and try again.', null, 'app.js:4425 — no mark at all today'],
];

// The app's .empty-state, reproduced from components.css. Copied rather than
// imported because the preview deliberately does not load the component
// sheets — the same reason the 4/6 chip and the toast are copied on the parts
// board — and the smoke test checks this copy against the real file, so a copy
// that drifts fails the build instead of quietly flattering the candidates.
const emptyState = (mark, text) => `
        <div class="empty-state">${mark ? `<span>${mark}</span>` : ''}${text}</div>`;

const emptyJump = () => `
  <nav class="pv-jump">
    <a href="#today">Today</a>
    <a href="#ours">Our own line art</a>
    <a href="#doodles">Open Doodles</a>
    <a href="#palette">Does it follow the palette?</a>
    <a href="#others">Open Peeps and Humaaans</a>
    <a href="#licences">Can we even use it?</a>
  </nav>`;

const CAVEAT_EMPTY = `
      <div class="pv-caveat">
        <b>The honest summary: almost nothing genuinely open in the illustration world is
        industrial.</b> The three licence-bulletproof sets are all hand-drawn PEOPLE — a doodle of
        somebody unboxing something, a peep waving, a figure in a navy jumper. None of them is a
        drone part, a checklist or a telemetry trace. If that warmth is what you want at
        "no IRs found", they are the safest way to get it and the licence is beyond question. If
        what you want is a picture that belongs to this app's own language, the third section is
        the only one that qualifies — and it costs about 1 KB instead of 87.
      </div>`;

const EMPTY_SKIN = OPTIONS.find(o => o.key === 'd').skin + `
/* ── the empty-state board ──────────────────────────────────────────────────
   Option D's skin verbatim, then this. Everything below is scoped to .pv. */

/* A demo is a card, not the app shell: the app root is a flex column and a demo
   shows one component, so it has to be a block or the empty state lays out as a
   flex row. min-height:0 for the same reason — the shell is a full viewport
   tall and a card is not. */
.pv-app.is-demo { display: block; min-height: 0; }

.pv-demo-note { margin: 0 0 0.6rem; color: var(--ink-gray-7); font-size: var(--text-xs); }

/* A copy of components.css's .empty-state, kept byte-for-byte in its four
   declarations so a candidate is judged in the real frame. 4rem of vertical
   padding is a lot inside a review card, and it is NOT reduced here: reducing it
   would make every candidate look tighter and better than it will be in the app. */
.pv-app .empty-state {
  text-align: center;
  color: var(--ink-gray-5);
  padding: 4rem 1.5rem;
  font-size: var(--text-base);
  line-height: var(--leading-body);
}
.pv-app .empty-state span { display: block; margin-bottom: 0.9rem; font-size: 2.5rem; }

/* One sizing rule for every set, which is why the width/height attributes are
   stripped out of the vendored files at build time. Height first and width auto,
   because Open Doodles is 4:3 and ours are square — fixing both would squash one
   of them. The emoji above is 2.5rem; an illustration at 6rem is a much bigger
   mark, and that difference is part of what is being judged. */
.pv-app .pv-ill { display: block; width: auto; height: 6rem; max-width: 100%; margin: 0 auto 0.9rem; color: var(--ink-gray-6); }

/* The whole argument, in two rules. A presentation attribute has no specificity,
   so ANY css rule beats it — which is what makes a two-fill set salvageable and
   an eleven-fill set not. Same markup, two renders: only the class differs.

   .pv-tok is the DEMO WRAPPER, and the artwork is inside it — so the descendant
   combinator runs that way. Written the other way round (.pv-app .pv-tok …) the
   rule matches nothing at all, silently, and both cards render pink: the section
   would have shown the reader a broken claim and a working one that looked
   identical to it. Caught by reading computed fill values in a browser, not by
   reading this rule. */
.pv-tok [fill="#FF5678"] { fill: var(--accent); }
.pv-tok [fill="#000000"] { fill: var(--ink-gray-9); }

/* Four presets, one artwork, no overrides. Nested data-palette works because
   palette.css sets the accent role as custom properties, and custom properties
   inherit — so the attribute re-themes everything under it. */
.pv-accent-row { display: flex; flex-wrap: wrap; gap: 0.6rem; }
.pv-accent-tile {
  flex: 1 1 7rem; min-width: 0; padding: 0.7rem; text-align: center;
  border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); background: var(--surface-base);
}
/* The extra .pv-app is load-bearing, not noise: .pv-app .pv-ill is (0,2,0) and
   this would tie with it and win on source order alone. A tie that happens to
   resolve correctly today is a rule that breaks the next time the sheet moves. */
.pv-accent-tile .pv-app .pv-ill { height: 4rem; margin-bottom: 0.4rem; }
.pv-accent-tile b { display: block; color: var(--ink-gray-8); font-size: var(--text-xs); font-weight: var(--weight-semibold); }
.pv-accent-tile i { display: block; color: var(--ink-gray-6); font-size: var(--text-2xs); font-style: normal; }

@media (max-width: 639px) {
  .pv-app .pv-ill { height: 5rem; }
  .pv-accent-tile { flex: 1 1 6rem; }
}
`;

// ── the board ───────────────────────────────────────────────────────────────
const emptyBoard = () => emptyJump() + `
  <section class="pv-block" id="today">
    <span class="pv-kicker">What the app shows now</span>
    <h2 class="pv-block-title">Three empty states, and one of them is blank</h2>
    <p class="pv-block-note">Copied from the app rather than remembered: two carry a 2.5rem emoji
    and the third carries nothing at all. The emoji is drawn by the operating system, so it is the
    same picture in dark mode as in light and no token can reach it — which is the only real
    argument against it.</p>
${EMPTY_STATES.map(([text, mark, hint]) => demo(
  hint.split(' — ')[0], hint.split(' — ')[1], emptyState(mark, text), 'pv-demo-pad')).join('')}
    ${CAVEAT_EMPTY}
  </section>

  <section class="pv-block" id="ours">
    <span class="pv-kicker">The app's own line language, enlarged</span>
    <h2 class="pv-block-title">Ours, drawn the way every glyph in the app is already drawn</h2>
    <p class="pv-block-note">Every icon in the app comes from one table, ICON_PATHS: 24x24,
    <b>fill:none</b>, <b>stroke:currentColor</b>, round caps and joins. These are the same
    drawing at 96px in the same idiom, so there is nothing to keep in sync — no vendored file, no
    licence file, and no override needed for any of the four accent presets or either theme. The
    accent stroke is <b>var(--accent)</b>, which is what makes that true.</p>
${demo('No IRs match this filter', 'a glass over a list that has nothing on it', emptyState(ourIll('filter'), EMPTY_STATES[0][0]), 'pv-demo-pad')}
${demo('No IRs found', 'an open crate with nothing in it', emptyState(ourIll('empty'), EMPTY_STATES[1][0]), 'pv-demo-pad')}
${demo('The flight-log reader did not load', 'a trace with a failed mark — the state that has no mark today', emptyState(ourIll('logfail'), EMPTY_STATES[2][0]), 'pv-demo-pad')}
    <div class="pv-caveat">
      <b>What this costs, and what it is not.</b> One 96x96 line drawing is about 1 KB, it is
      written with our tokens, and it needs no licence because we drew it. What it is not is
      warm — it is an icon at illustration size, and it will read as a diagram, not as a person.
      If the point of an empty state is to be friendly, this is the wrong answer and it says so.
    </div>
  </section>

  <section class="pv-block" id="doodles">
    <span class="pv-kicker">Open Doodles — CC0, 33 ready-made doodles</span>
    <h2 class="pv-block-title">The pink one, and the same artwork pointed at our tokens</h2>
    <p class="pv-block-note">This is the whole finding on one screen. Every one of Open Doodles'
    33 files uses exactly two fills: <b>#000000</b> for the line and <b>#FF5678</b> for the accent.
    The first card is the file as shipped. The second is the same markup with two CSS rules
    mapping those two values to <b>var(--ink-gray-9)</b> and <b>var(--accent)</b> — a presentation
    attribute loses to any CSS rule, so this is a real re-colour, not a filter.</p>
${demo('As shipped', 'the pink is baked into the file', emptyState(inlineSvg('unboxing', 'pv-ill'), 'No IRs found. Create one via the customer form.'), 'pv-demo-pad')}
${demo('Re-coloured by two rules', 'same markup, one extra class — now it follows the accent', emptyState(inlineSvg('unboxing', 'pv-ill'), 'No IRs found. Create one via the customer form.'), 'pv-demo-pad pv-tok')}
${demo('Levitate, re-coloured', 'a calm one, and the register the set mostly has', emptyState(inlineSvg('levitate', 'pv-ill'), 'No IRs match this filter.'), 'pv-demo-pad pv-tok')}
${demo('Chilling, re-coloured', 'the set is lifestyle doodles: lounging, skating, coffee', emptyState(inlineSvg('chilling', 'pv-ill'), 'The flight-log reader did not load. Reload the app and try again.'), 'pv-demo-pad pv-tok')}
    <div class="pv-caveat">
      <b>Read the register, not the drawing.</b> Twenty-nine of the thirty-three are people
      doing something leisurely — <b>ballet, bikini, moshing, roller-skating, ice-cream,
      zombieing</b>. Three are arguable for a QA tool (<b>unboxing</b> for an empty box,
      <b>reading-side</b> for a search, <b>chilling</b> for nothing pending) and the rest are
      wrong for this app, which is a licence fact about the set, not a criticism of it.
      They are also large: 21 KB to 200 KB each, against about 1 KB for ours.
    </div>
  </section>

  <section class="pv-block" id="palette">
    <span class="pv-kicker">Does it actually follow the palette?</span>
    <h2 class="pv-block-title">One artwork, four presets, no overrides</h2>
    <p class="pv-block-note">The claim above, tested rather than asserted. The same re-coloured
    doodle under each of the app's four accent presets — Blue, Violet, Teal, Graphite. Nothing
    changes between the tiles except a <b>data-palette</b> attribute, because the accent role is a
    custom property and custom properties inherit. An as-shipped doodle would be pink in all four.</p>
    <div class="pv-accent-row">
      <div class="pv-accent-tile"><div class="pv-app is-demo pv-tok">${inlineSvg('unboxing', 'pv-ill')}</div><b>Blue</b><i>the default</i></div>
      <div class="pv-accent-tile" data-palette="violet"><div class="pv-app is-demo pv-tok">${inlineSvg('unboxing', 'pv-ill')}</div><b>Violet</b><i>data-palette</i></div>
      <div class="pv-accent-tile" data-palette="teal"><div class="pv-app is-demo pv-tok">${inlineSvg('unboxing', 'pv-ill')}</div><b>Teal</b><i>data-palette</i></div>
      <div class="pv-accent-tile" data-palette="graphite"><div class="pv-app is-demo pv-tok">${inlineSvg('unboxing', 'pv-ill')}</div><b>Graphite</b><i>data-palette</i></div>
    </div>
  </section>

  <section class="pv-block" id="others">
    <span class="pv-kicker">Open Peeps and Humaaans — also CC0</span>
    <h2 class="pv-block-title">The two that cannot be re-coloured by a rule</h2>
    <p class="pv-block-note">Both are equally free and equally safe to commit. The difference is
    that their artwork carries its own palette — Peeps uses six fills, this Humaaans figure
    eleven — so the fix that works for Open Doodles does not exist here. Making either follow
    <b>var(--accent)</b> means redrawing it, which is not a licence question any more.</p>
${demo('Open Peeps', 'six fills, four of them referenced by id — a character set, not a scene', emptyState(inlineSvg('peep', 'pv-ill'), 'No IRs found. Create one via the customer form.'), 'pv-demo-pad')}
${demo('Humaaans', 'eleven fills: skin, hair, jumper, jeans — a whole fixed figure', emptyState(inlineSvg('humaaans', 'pv-ill'), 'The flight-log reader did not load. Reload the app and try again.'), 'pv-demo-pad')}
    <div class="pv-caveat">
      <b>Two things worth knowing before you look.</b> Both sets are part-kits more than
      picture-books — Humaaans is a library of heads, torsos and legs you compose a figure from,
      and what is rendered here is one of the artist's own ready-made examples. And both are
      portrait figures with faces, which is a bigger commitment than a doodle: a face in an error
      state is a mascot whether it was meant to be one or not.
    </div>
  </section>

  <section class="pv-block" id="licences">
    <span class="pv-kicker">Can we even use it?</span>
    <h2 class="pv-block-title">The question is not "is it free" — it is "may it be committed"</h2>
    <p class="pv-block-note">This repository is public, so putting an SVG in it is redistribution,
    not use. That single test removes most of the illustration world, including the set everyone
    recommends first.</p>
    <div class="pv-lic">
      <div class="pv-lic-row"><b>Open Doodles</b><span class="yes">CC0 — committable</span>
        <p>Public domain, no conditions at all. "Free for Commercial and Personal Use. No need to
        credit, license, or anything." 33 ready-made doodles; two fills each.</p></div>
      <div class="pv-lic-row"><b>Open Peeps</b><span class="yes">CC0 — committable</span>
        <p>Public domain under CC0. Hand-drawn people, largely a part-kit; six fills.</p></div>
      <div class="pv-lic-row"><b>Humaaans</b><span class="yes">CC0 — committable</span>
        <p>Public domain under CC0. Mix-and-match vector people; eleven fills.</p></div>
      <div class="pv-lic-row"><b>Tabler Illustrations</b><span class="no">No — paid, and restricted</span>
        <p>A codecalm.net product whose licence forbids use in open-source or freely-available
        products. This repository is both. Tabler's CSS and icons are MIT and were read for their
        measured geometry; the illustrations cannot be used at all.</p></div>
      <div class="pv-lic-row"><b>unDraw</b><span class="no">No — and it is the trap</span>
        <p>The most-recommended free set on the web, promising no attribution, while its terms
        forbid distributing the assets in packs — which is exactly what vendoring them here is.
        It would have been the obvious first pick on the FAQ headline alone.</p></div>
      <div class="pv-lic-row"><b>Storyset, Blush, DrawKit, ManyPixels, absurd.design</b><span class="no">No</span>
        <p>Bespoke licences, variously restrictive; one of them is non-commercial.</p></div>
    </div>
    <div class="pv-caveat">
      <b>If one is chosen.</b> Three of its SVGs get written into the app in the same place every
      other glyph lives — the ICON_PATHS idiom — with <b>var(--accent)</b> in place of the baked-in
      colour, and the set's copyright line goes into <b>vendor/</b> beside the file, the way
      pdf-lib's already does. If none is chosen, the five files under
      <b>vendor/illustrations/</b> are deleted and the board with them; that is a two-line change.
    </div>
  </section>
`;

// ═════════════════════════════════════════════════════════════════════════════
// REVIEW 3 — the board (preview/board.html)
// ═════════════════════════════════════════════════════════════════════════════
// The question this page answers is not "what should a board look like". It is
// "how does a card move between columns" — and the honest starting point is
// that the app ALREADY HAS the field a board needs.
//
// `ir.status` is one of TEN workflow stages (IR_STATUS_VALUES, app.js). It is
// written by hand in Allot CAPS and nowhere else, stamped with `statusAt` only
// when someone really changes it, and bucketed into Open/Paused/Resolved/Closed
// by statusCategory(). So a board is a new DRAWING of a field that exists, not a
// new field — which is why this page can show real columns at all, and why it
// does not need a migration.
//
// The literals below are written out rather than imported, because this builder
// reads CSS and HTML as text and never evaluates app.js. smoke-preview.mjs is
// what makes that safe: every status, every bucket and every section letter on
// this page is checked back against app.js's own arrays, so none of it can rot
// quietly.

// ── the one rule the whole board follows ────────────────────────────────────
//
// EVERY IR has a status. The status says which section the IR is in. So the
// columns ARE the sections. That is the entire mechanism; nothing else is being
// decided here, and the first version of this page managed to make it look hard
// by arguing about it for four screens.
//
// The only thing that needs care is this: the app has ten stages and only six of
// them name a section. The other four — Open and Remote Support, On Hold, and the
// finished one — would fall off a board whose columns were sections alone. So
// they get columns of their own at the two ends, and the result is that every stage
// lands in exactly one column and the counts add up to every IR there is. The
// retired word 'Other' keeps a place in the last column too: it is not a stage any
// more, but tickets in the store still hold it and a card in no column is invisible.
//
// Written out rather than imported, because this builder reads CSS and HTML as
// text and never evaluates app.js. smoke-preview.mjs is what makes that safe: it
// reads the ten stages out of app.js and requires this page to place each of them
// exactly once, with Other beside them and nothing else invented.
const KB_IR_TOTAL = 412;

// Left to right. `stages` is the app's own status values that land in the column,
// and the union of every `stages` array is IR_STATUS_VALUES exactly — the
// property the smoke test checks, and the reason no IR can be missing from it.
const KB_COLUMNS = [
  { key: 'start', title: 'Not started', stages: ['Open', 'Remote Support'], n: 11, cards: [
    { no: 'IR-396', sn: 'D25G-0102', cat: 'REPAIR',         age: '44d', who: '',        done: 0 },
    { no: 'IR-388', sn: 'H25P-0018', cat: 'REMOTE SUPPORT', age: '52d', who: 'P. Nair', done: 0 },
  ] },
  { key: 'hold', title: 'Paused', stages: ['On Hold'], n: 6, cards: [
    { no: 'IR-402', sn: 'D10G-0221', cat: 'CRASH', age: '41d', who: '', done: 1, late: true },
  ] },
  { key: 'B', letter: 'B', title: 'Inward Checklist', stages: ['Inward'], n: 4, cards: [
    { no: 'IR-415', sn: 'VTR-0011',  cat: 'GENERAL MAINTENANCE', age: '4d',  who: '',         done: 0 },
    { no: 'IR-412', sn: 'D25G-0114', cat: 'CRASH',               age: '19d', who: 'A. Sharma', done: 1, late: true },
  ] },
  { key: 'C', letter: 'C', title: 'IQC Visual Inspection', stages: ['Inspection'], n: 3, cards: [
    { no: 'IR-411', sn: 'H25P-0029', cat: 'REPAIR', age: '8d', who: 'P. Nair', done: 1 },
  ] },
  { key: 'D', letter: 'D', title: 'Investigation', stages: ['Investigation'], n: 7, cards: [
    { no: 'IR-409', sn: 'H25P-0032', cat: 'REPAIR', age: '23d', who: 'R. Kumar',  done: 2, late: true },
    { no: 'IR-408', sn: 'S25P-0044', cat: 'CRASH',  age: '25d', who: 'A. Sharma', done: 2, late: true },
  ] },
  { key: 'E', letter: 'E', title: 'Production (Rework)', stages: ['Production'], n: 5, cards: [
    { no: 'IR-406', sn: 'VTR-0007', cat: 'GENERAL MAINTENANCE', age: '29d', who: 'P. Nair', done: 3 },
  ] },
  { key: 'F', letter: 'F', title: 'Quality Test Report', stages: ['Quality Test'], n: 4, cards: [
    { no: 'IR-403', sn: 'D10G-0207', cat: 'CRASH', age: '31d', who: 'R. Kumar', done: 4 },
  ] },
  { key: 'G', letter: 'G', title: 'PDI Report/Dispatch Record', stages: ['PDI/Dispatch'], n: 3, cards: [
    { no: 'IR-401', sn: 'S25P-0014', cat: 'REMOTE SUPPORT', age: '36d', who: 'A. Sharma', done: 5 },
  ] },
  { key: 'done', title: 'Finished', stages: ['Delivered', 'Other'], n: 369, quiet: true, cards: [
    { no: 'IR-398', sn: 'VTR-0003', cat: 'GENERAL MAINTENANCE', age: '58d', who: 'P. Nair', done: 6 },
  ] },
];

// The big picture in one bar, from the four numbers the list screen's segment
// strip already prints — so the bar and the strip cannot disagree.
const KB_MIX = [
  ['Open', 37, 'open'],
  ['Paused', 6, 'paused'],
  ['Resolved', 318, 'resolved'],
  ['Closed', 51, 'closed'],
];

// One card. Written in the app's own list-row vocabulary — .ir-title, .ir-sn,
// .ir-cat, .ir-age, .ir-progress — because the point of a board is that it draws
// rows the app already has, and a card invented for the preview would have the
// owner approving a board for a row the app cannot render.
const kbCard = (c) => {
  if (c.ghost) return `
                <div class="pv-kb-card pv-kb-card-ghost"><span class="pv-kb-ghost-label">${esc(c.ghost)}</span></div>`;
  const cls = [c.late ? 'is-late' : '', c.just ? 'pv-kb-card-just' : ''].filter(Boolean).join(' ');
  return `
                <div class="pv-kb-card${cls ? ' ' + cls : ''}">
                  <div class="pv-kb-card-top">
                    <span class="ir-title">${esc(c.no)}</span>
                    <span class="ir-age${c.late ? ' is-late' : ''}">${esc(c.age)}</span>
                  </div>
                  <div class="ir-meta"><span class="ir-sn">${esc(c.sn)}</span><span class="ir-dot">·</span><span class="ir-cat">${esc(c.cat)}</span></div>
                  <div class="pv-kb-card-foot">
                    <span class="ir-assignee${c.who ? '' : ' pv-kb-unassigned'}">${c.who ? esc(c.who) : 'Unassigned'}</span>
                    <span class="ir-progress p${c.done}${c.done >= 6 ? ' is-complete' : ''}" title="${c.done} of 6 sections saved"><span class="ir-progress-bar"></span><span class="ir-progress-text">${c.done}/6</span></span>
                  </div>
                </div>`;
};

// A column. The `over` argument is what lets the three rule demos re-place the
// same card — that is the whole point of them: one card, one event, three rules.
const kbCol = (col, over = {}) => {
  const cards = over.cards || col.cards;
  const n = over.n === undefined ? col.n : over.n;
  const cls = over.cls || '';
  return `
              <div class="pv-kb-col${col.quiet ? ' pv-kb-col-quiet' : ''}${cls ? ' ' + cls : ''}">
                <div class="pv-kb-col-head"><span class="pv-kb-col-title">${col.letter ? col.letter + ' · ' : ''}${esc(col.title)}</span><span class="pv-kb-col-count">${n}</span></div>
                <span class="pv-kb-col-sub">${col.stages.map(esc).join(' · ')}</span>
                <div class="pv-kb-col-body">${cards.map(c => kbCard(c)).join('')}${n > cards.length ? `<span class="pv-kb-more">+${n - cards.length} more</span>` : ''}</div>
              </div>`;
};
const kbOf = key => KB_COLUMNS.find(c => c.key === key);

// A scrollable region needs a keyboard route in, or a board is mouse-only.
const kbBoard = (label, cols) => `
            <div class="pv-kb-board" role="region" aria-label="${esc(label)}" tabindex="0">${cols.join('')}
            </div>`;

const kbStrip = () => `
            <div class="pv-kb-strip">
              ${KB_MIX.map(([, n, k]) => `<span class="pv-kb-seg pv-kb-seg-${k}" style="width:${(n / KB_IR_TOTAL * 100).toFixed(2)}%"></span>`).join('')}
            </div>
            <div class="pv-kb-legend">
              ${KB_MIX.map(([label, n, k]) => `<span class="pv-kb-key"><i class="pv-kb-dot pv-kb-seg-${k}"></i>${label} <b>${n}</b></span>`).join('')}
              <span class="pv-kb-key pv-kb-key-total">All <b>${KB_IR_TOTAL}</b></span>
            </div>`;

const kbJump = () => `
  <nav class="pv-jump">
    <a href="#board">The board</a>
    <a href="#moves">How a card moves</a>
    <a href="#place">Where it lives</a>
    <a href="#limits">What it costs</a>
  </nav>`;

const CAVEAT_BOARD = `
      <div class="pv-caveat">
        <b>Two things the board cannot say, and both are the app's doing rather than the board's.</b>
        A <b>Paused</b> IR keeps its status as On Hold, so the app no longer knows which section it was
        paused in — which is why Paused is a column of its own rather than the card sitting where it
        stopped. And <b>Finished</b> is deliberately one wide column: 369 IRs that need no action do
        not deserve eight columns of screen, and the count is the useful part. Both are columns
        rather than omissions, so the totals still add up to all 412.
      </div>`;

const CAVEAT_MOVES = `
      <div class="pv-caveat">
        <b>The app has already answered two of these three, in its own source.</b>
        From the comment on <b>ownedStatus()</b>: <i>"saving Section B is not triage, so an IR whose
        Section B was saved must go on following the Sheet's Col D until somebody changes the status
        here."</i> And from <b>syncIRStateAfterSectionSave()</b>: <i>"Status is no longer mirrored
        from a section form… A section save that happens to post a status key must not be able to
        move the workflow clock."</i> Both sentences exist because someone already tried rule 2 and
        took it out. The reason is the clock: <b>statusAt</b>, which is what "In status 3d" and the
        overdue limits are measured from.
      </div>`;

const boardBoard = () => kbJump() + `

  <section class="pv-block" id="board">
    <span class="pv-kicker">The board</span>
    <h2 class="pv-block-title">Every IR has a status. The status says which section it is in. So the columns are the sections.</h2>
    <p class="pv-block-note">That is the whole mechanism. The app has ten workflow stages and six of
    them name one of your six sections, so those are the middle six columns. The other four —
    Open and Remote Support, On Hold, and the finished one — get columns at the two ends so that
    nothing falls off the board.</p>
    <div class="pv-demo">
      <div class="pv-demo-cap"><b>All ${KB_IR_TOTAL} IRs</b><span>every status the app has lands in exactly one column</span></div>
      <div class="pv-demo-pad">${kbStrip()}
${kbBoard('IR board, one column per status group, all ' + KB_IR_TOTAL + ' IRs', KB_COLUMNS.map(c => kbCol(c)))}</div>
    </div>
${CAVEAT_BOARD}
  </section>

  <section class="pv-block" id="moves">
    <span class="pv-kicker">The one decision the board needs from you</span>
    <h2 class="pv-block-title">When a section is saved, does the card move?</h2>
    <p class="pv-block-note">One event, drawn three ways: <b>Ravi saves Section D on IR-409</b>,
    which is sitting in the Investigation column with 2 of 6 sections saved.</p>

    <div class="pv-demo">
      <div class="pv-demo-cap"><b>Rule 1 — a person moves it, in Allot CAPS</b><span>what the app does today</span></div>
      <div class="pv-demo-pad">${kbBoard('Rule 1: the card does not move', [
        kbCol(kbOf('C')),
        kbCol(kbOf('D'), { cls: 'pv-kb-col-here' }),
        kbCol(kbOf('E')),
      ])}</div>
    </div>
    <p class="pv-block-note"><b>Nothing moves.</b> Saving a section is not a stage change, so IR-409
    stays in D until somebody opens Allot CAPS. The cost is that the board is only as current as the
    last person to triage — and this is the rule the app's own comments argue for.</p>

    <div class="pv-demo">
      <div class="pv-demo-cap"><b>Rule 2 — it moves itself on save</b><span>the rule the app tried and removed</span></div>
      <div class="pv-demo-pad">${kbBoard('Rule 2: the card advances on save', [
        kbCol(kbOf('D'), { cards: [kbOf('D').cards[1]], n: 6 }),
        kbCol(kbOf('E'), { cards: [kbOf('D').cards[0], kbOf('E').cards[0]], n: 6, cls: 'pv-kb-col-here' }),
        kbCol(kbOf('F')),
      ])}</div>
    </div>
    <p class="pv-block-note"><b>IR-409 slides into E the moment D is saved.</b> Three things go
    wrong. <b>done[] only records saved, never finished</b>, so a section saved with three empty
    fields moves the card just as far as a completed one. <b>The stage and the sections drift apart</b>
    the first time somebody works on F before finishing E, which your engineers will do. And
    <b>the clock resets on every save</b> — the time an IR has been in its stage would read 0 days
    forever, and the overdue limits stop meaning anything.</p>

    <div class="pv-demo">
      <div class="pv-demo-cap"><b>Rule 3 — it advances, and anyone can push it back</b><span>the one worth talking about</span></div>
      <div class="pv-demo-pad">${kbBoard('Rule 3: advance on save, drag to correct', [
        kbCol(kbOf('C')),
        kbCol(kbOf('D'), { cards: [kbOf('D').cards[1], { ghost: 'IR-409 can be dragged back here' }], n: 6 }),
        kbCol(kbOf('E'), { cards: [Object.assign({}, kbOf('D').cards[0], { just: true }), kbOf('E').cards[0]], n: 6, cls: 'pv-kb-col-here' }),
      ])}</div>
    </div>
    <p class="pv-block-note"><b>It advances, and the person who knows better drags it back.</b>
    A drag is a write, so each one has to say whether it moved the clock. The shape that survives:
    <b>saving a section proposes a move, and only a person setting the stage writes the clock.</b>
    The board stays current and the ageing stays true.</p>
${CAVEAT_MOVES}
  </section>

  <section class="pv-block" id="place">
    <span class="pv-kicker">Where the board goes</span>
    <h2 class="pv-block-title">A switch beside the filters, not a seventh tab</h2>
    <p class="pv-block-note">The board is another view of the list you already have, so it reads the
    same rows, the same search box and the same filters — a separate "Board" tab would mean filtering
    twice and finding different numbers on each. One switch on the List screen, and both views obey
    whatever is typed above them.</p>
    <div class="pv-demo pv-demo-pad">
      <div class="pv-kb-toolbar">
        <div class="pv-kb-ltbar">
          <span class="pv-kb-ltitle">IRs</span>
          <span class="pv-kb-lcount">${KB_IR_TOTAL}</span>
          <span class="pv-kb-switch"><span class="pv-kb-switch-btn is-on">List</span><span class="pv-kb-switch-btn">Board</span></span>
        </div>
        <div class="pv-kb-viewsegs">
          <span class="pv-kb-viewseg is-on">All<span class="pv-kb-viewseg-n">${KB_IR_TOTAL}</span></span>
          ${KB_MIX.map(([label, n]) => `<span class="pv-kb-viewseg">${label}<span class="pv-kb-viewseg-n">${n}</span></span>`).join('')}
        </div>
      </div>
    </div>
    <div class="pv-caveat">
      <b>One thing the switch does not solve.</b> The count tiles count <i>every</i> IR and a board
      column shows a few cards plus a number. The tiles have to move <i>into</i> the board view as
      column totals — which is what the headers above already are — or the two will appear to
      disagree.
    </div>
  </section>

  <section class="pv-block" id="limits">
    <span class="pv-kicker">What this is, and what it is not</span>
    <h2 class="pv-block-title">The honest list</h2>
    <div class="pv-lic">
      <div class="pv-lic-row"><b>It is a drawing of data you have</b><span class="yes">No migration</span>
        <p>Every card is built from fields the app already stores: <b>ir.status</b>, the assignee, the
        category, the raised date, and <b>ir.done[]</b>. Adopting a board is a rendering pass, not a
        data change.</p></div>
      <div class="pv-lic-row"><b>A ten-line map is the only new code</b><span class="yes">Small</span>
        <p>The app folds its ten workflow stages into four buckets today. Pointing them at your six
        sections instead is a pure function with no backend, no new field and no write — and which
        status goes in which column is written out under each column heading above, where you can
        check it against the ticket.</p></div>
      <div class="pv-lic-row"><b>Dragging needs a write per drag</b><span class="warn">Decide</span>
        <p>A drag that persists is a store write and an audit entry, which the app already does on
        every triage save. What needs deciding is who may drag — that is the TR access axis, not a
        new one.</p></div>
      <div class="pv-lic-row"><b>The board is inert</b><span class="warn">By rule</span>
        <p>Nothing here can be dragged or clicked by script — the review pages are forbidden a
        <b>&lt;script&gt;</b> and a test enforces it. Rule 3 above is a picture of a drag, not a drag.</p></div>
      <div class="pv-lic-row"><b>No subtasks, no swimlanes, no WIP limits</b><span class="no">Not shown</span>
        <p>Real kanban tools put cards inside cards and cap how many may sit in a column. Neither maps
        onto anything the app stores, so neither is drawn. If you want one, say which.</p></div>
      <div class="pv-lic-row"><b>On your phone it is one column at a time</b><span class="warn">Sideways</span>
        <p>A board is wide by nature. On the phone it scrolls sideways inside its own frame — the page
        itself never scrolls — so you see one column and the edge of the next. That is the honest cost
        of a board on a 390px screen, and the reason the counts in the headers matter: they are what
        you read without scrolling.</p></div>
    </div>
  </section>
`;

// The board's stylesheet. D's skin first, so the cards, badges, chips and segments
// arrive exactly as the approved direction draws them, then this.
const BOARD_SKIN = OPTIONS.find(o => o.key === 'd').skin + `
/* ── the board ──────────────────────────────────────────────────────────────
   Option D's skin verbatim, then this. Everything below is scoped to .pv. */

/* The board itself. overflow-x on the FRAME, never on the page: a board is wide
   by nature and the one rule that cannot bend is that the page body never
   scrolls sideways. The columns refuse to shrink (flex: 0 0 15rem — Tabler's own
   grid cell), so the frame is what scrolls and a phone sees one column plus the
   edge of the next.
   overscroll-behavior-x keeps a swipe at the end of the board from turning into
   a browser back-navigation, which on a phone is the difference between scrolling
   a board and leaving the app.
   tabindex is on the element in the markup, not here, because a scrollable region
   with no keyboard route into it is mouse-only. */
.pv-kb-board { display: flex; gap: 0.75rem; overflow-x: auto; overscroll-behavior-x: contain; padding-bottom: 0.35rem; }
.pv-kb-board:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

.pv-kb-col { flex: 0 0 15rem; display: flex; flex-direction: column; gap: 0.4rem; min-width: 0; }
/* The column the worked example is talking about. A coloured rule under the
   header rather than a tinted fill, so it reads as a marker pointing at
   something and not as a state the app has — nothing in I-PASSBOOK has an
   accent-filled card. */
.pv-kb-col-here > .pv-kb-col-head { border-bottom-color: var(--accent); }
.pv-kb-col-here > .pv-kb-col-head .pv-kb-col-count { background: var(--accent-soft); color: var(--accent); }
/* Finished. 369 of the 412 IRs live here and none of them need looking at, so
   the column is drawn flat rather than dimmed to the point of unreadable: the
   count still has to be legible, because the count is the whole information. */
.pv-kb-col-quiet > .pv-kb-col-head { border-bottom-style: dashed; }
.pv-kb-col-quiet .pv-kb-col-body { opacity: 0.75; }
.pv-kb-col-head { display: flex; align-items: baseline; gap: 0.5rem; padding-bottom: 0.35rem; border-bottom: 2px solid var(--outline-gray-2); }
.pv-kb-col-title { flex: 1 1 auto; min-width: 0; font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.pv-kb-col-count { flex: 0 0 auto; min-width: 1.6rem; padding: 0.05rem 0.4rem; border-radius: var(--radius-9); background: var(--surface-gray-3); color: var(--ink-gray-7); font-size: var(--text-2xs); font-weight: var(--weight-medium); text-align: center; font-variant-numeric: tabular-nums; }
.pv-kb-col-sub { color: var(--ink-gray-5); font-size: var(--text-2xs); line-height: 1.3; }
.pv-kb-col-body { display: flex; flex-direction: column; gap: 0.4rem; }
.pv-kb-more { color: var(--ink-gray-5); font-size: var(--text-xs); padding: 0.15rem 0.1rem; }

/* ── the app's own list-row words, carried rather than assumed ──────────────
   Copied declaration for declaration from views.css (:207, :226, :273-288,
   :1763-1796). This is not duplication for its own sake, and it is the second
   time this page has been caught by the same trap.

   A review page loads tokens.css, palette.css, the shared skeleton and its OWN
   skin. It never loads views.css. Option D's skin DOES carry these classes — but
   it scopes every one of them under .pv-app, and NO BOARD PAGE HAS A .pv-app
   ELEMENT. So .pv-app .ir-meta reached nothing, and the board drew app
   vocabulary with rules that applied to none of it. It showed, and only by
   looking: the meta line ran together as "H25P-0032·REPAIR" because .ir-meta's
   flex gap was missing, the 2/6 chip's bar had no width or height because
   .ir-progress-bar's were missing, and the IR number was not bold because
   .ir-title's weight was missing. Every card on the page and every assertion in
   this repo stayed green, because "the rule exists" and "the rule applies" are
   different claims and only one of them was being checked.

   These come FIRST, so the board's own overrides below win by order at equal
   specificity. .ir-cat deliberately has no rule here, because it has none in the
   app either — it is styled entirely by .ir-meta and .ir-meta > *, both below. */
.pv-kb-card .ir-title { font-size: var(--text-base); font-weight: var(--weight-semibold); color: var(--ink-gray-9); letter-spacing: var(--tracking-base); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv-kb-card .ir-assignee { font-size: var(--text-2xs); font-weight: var(--weight-medium); color: var(--ink-gray-5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv-kb-card .ir-meta { display: flex; align-items: center; gap: 0.3rem; font-size: var(--text-xs); color: var(--ink-gray-5); flex-wrap: nowrap; overflow: hidden; min-width: 0; }
.pv-kb-card .ir-meta > * { flex: 0 0 auto; white-space: nowrap; }
.pv-kb-card .ir-sn { color: var(--ink-gray-6); font-weight: var(--weight-medium); }
.pv-kb-card .ir-dot { opacity: 0.5; }
.pv-kb-card .ir-age { color: var(--ink-gray-5); }
.pv-kb-card .ir-age.is-late { color: var(--st-danger-fg); font-weight: var(--weight-medium); }
.pv-kb-card .ir-progress { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; }
.pv-kb-card .ir-progress-bar { display: block; width: 30px; height: 4px; border-radius: var(--radius-9); background: var(--surface-gray-3); overflow: hidden; }
.pv-kb-card .ir-progress-bar::after { content: ''; display: block; height: 100%; width: 0; border-radius: inherit; background: var(--ink-gray-6); }
.pv-kb-card .ir-progress-text { font-size: var(--text-2xs); line-height: 1; color: var(--ink-gray-5); font-variant-numeric: tabular-nums; }
.pv-kb-card .ir-progress.is-complete .ir-progress-bar::after { background: var(--ink-green-7); }
.pv-kb-card .ir-progress.is-complete .ir-progress-text { color: var(--ink-green-7); font-weight: var(--weight-semibold); }

/* A card. 8px radius and the soft shadow are D's card geometry, so a board card
   and a list card are the same object seen two ways. */
.pv-kb-card { display: flex; flex-direction: column; gap: 0.3rem; padding: 0.5rem 0.6rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-4); background: var(--surface-base); box-shadow: var(--elevation-sm); }
.pv-kb-card.is-late { border-left: 3px solid var(--ink-red-7); }
.pv-kb-card-top { display: flex; align-items: baseline; gap: 0.4rem; }
.pv-kb-card-top .ir-title { flex: 1 1 auto; min-width: 0; }
.pv-kb-card-top .ir-age { flex: 0 0 auto; }
.pv-kb-card .ir-meta { font-size: var(--text-2xs); }
.pv-kb-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }
.pv-kb-card-foot .ir-assignee { font-size: var(--text-2xs); }
.pv-kb-unassigned { color: var(--ink-amber-7); font-weight: var(--weight-medium); }

/* The two states that only exist because rule 3 is being explained: the card
   that has just arrived, and the dashed slot it would go back to. They are
   pictures of a gesture, and the dashed edge is what says so. */
.pv-kb-card-just { border-color: var(--accent); box-shadow: var(--elevation-md); }
.pv-kb-card-ghost { align-items: center; justify-content: center; min-height: 4.2rem; border-style: dashed; border-color: var(--outline-gray-3); background: var(--surface-gray-1); box-shadow: none; }
.pv-kb-ghost-label { color: var(--ink-gray-5); font-size: var(--text-2xs); font-weight: var(--weight-medium); text-align: center; }

/* The whole-picture bar. One bar split in proportion to the four numbers the
   list screen's segment strip already prints, so the board and the strip cannot
   disagree on screen — which is the only place a disagreement would be noticed.
   Segments are filled with the SOLID status ink (--st-*-fg) and not the tint
   (--st-*-bg): a tint is designed to sit behind text on a card and at 9% width
   it would read as an empty gap rather than as a segment. */
.pv-kb-strip { display: flex; height: 0.6rem; margin-bottom: 0.5rem; border-radius: var(--radius-3); overflow: hidden; background: var(--surface-gray-2); }
.pv-kb-seg { display: block; height: 100%; }
.pv-kb-seg-open { background: var(--st-open-fg); }
.pv-kb-seg-paused { background: var(--st-paused-fg); }
.pv-kb-seg-resolved { background: var(--st-resolved-fg); }
.pv-kb-seg-closed { background: var(--st-closed-fg); }
.pv-kb-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.9rem; margin-bottom: 0.75rem; color: var(--ink-gray-6); font-size: var(--text-2xs); }
.pv-kb-key { display: inline-flex; align-items: center; gap: 0.3rem; font-variant-numeric: tabular-nums; }
.pv-kb-key b { color: var(--ink-gray-8); font-weight: var(--weight-medium); }
.pv-kb-key-total { margin-left: auto; padding-left: 0.9rem; border-left: 1px solid var(--outline-gray-2); }
/* The legend's swatch reuses the segment's own class for its fill, so a colour
   cannot be right in the bar and wrong in the key beside it. */
.pv-kb-dot { width: 0.5rem; height: 0.5rem; border-radius: var(--radius-9); }

/* The List | Board switch, drawn where the app already puts a control of this
   kind. Not interactive on a review page — it is a picture of a switch.
   THE FIRST VERSION OF THIS DEMO WAS UNSTYLED. It borrowed the app's own class
   names (list-toolbar-top, segments, segment, segment-count), which live in
   views.css — and a review page loads tokens.css and palette.css only, never
   views.css. So the classes matched nothing: the switch sat in a cramped box and
   the counts ran together as bare text ("All412 Open37Paused6…"). It validated,
   every test passed, and the owner would have been shown a picture of a control
   that is not what the app draws. Borrowing a class name is not borrowing a rule;
   if this page wants the app's look it has to carry the declarations, and these
   are written in D's measured geometry with this board's own names. */
.pv-kb-toolbar { display: flex; flex-direction: column; gap: 0.6rem; }
.pv-kb-ltbar { display: flex; align-items: baseline; gap: 0.5rem; }
.pv-kb-ltitle { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.pv-kb-lcount { color: var(--ink-gray-6); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
.pv-kb-switch { display: inline-flex; flex: 0 0 auto; margin-left: auto; padding: 2px; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-gray-1); }
.pv-kb-switch-btn { padding: 0.2rem 0.6rem; border-radius: var(--radius-2); color: var(--ink-gray-6); font-size: var(--text-xs); }
.pv-kb-switch-btn.is-on { background: var(--surface-base); color: var(--ink-gray-9); font-weight: var(--weight-medium); box-shadow: var(--elevation-sm); }
.pv-kb-viewsegs { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.pv-kb-viewseg { display: inline-flex; align-items: baseline; gap: 0.35rem; padding: 0.2rem 0.55rem; border: 1px solid var(--outline-gray-2); border-radius: var(--radius-3); background: var(--surface-base); color: var(--ink-gray-7); font-size: var(--text-xs); }
.pv-kb-viewseg.is-on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: var(--weight-medium); }
.pv-kb-viewseg-n { color: var(--ink-gray-6); font-variant-numeric: tabular-nums; }
.pv-kb-viewseg.is-on .pv-kb-viewseg-n { color: var(--accent); }

/* The progress chip's base and its six fills, copied declaration for declaration
   from views.css:1772-1791. The parts board carries only .p4 because it only ever
   draws 4/6; a board draws every count there is, so it has to carry all six — or
   five of them would render as an empty track with a number beside it.

   The width:0 base is not decoration and it is the one rule here that was found
   by MEASURING rather than by reading. views.css sets it (:1776) and D's skin
   REPLACES it with 66.666%, because the parts board only ever draws a 4/6 chip —
   but D's rule is scoped to .pv-app and a board card is not inside the app shell,
   so nothing set a width for a card at all. A 0/6 chip then computed to
   width:auto, which inside a 30px overflow-hidden track is a FULL bar: the board
   would have drawn "0/6" beside a bar that looked complete. Nothing errors, the
   CSS is valid, and every test passed. It showed up as a single "auto" in a list
   of computed ::after widths in a headless browser, and nowhere else. */
.pv-kb-card .ir-progress-bar::after { width: 0; }
.pv-kb-card .ir-progress.p1 .ir-progress-bar::after { width: 16.666%; }
.pv-kb-card .ir-progress.p2 .ir-progress-bar::after { width: 33.333%; }
.pv-kb-card .ir-progress.p3 .ir-progress-bar::after { width: 50%; }
.pv-kb-card .ir-progress.p4 .ir-progress-bar::after { width: 66.666%; }
.pv-kb-card .ir-progress.p5 .ir-progress-bar::after { width: 83.333%; }
.pv-kb-card .ir-progress.p6 .ir-progress-bar::after { width: 100%; }

@media (max-width: 639px) {
  /* Narrower columns so the next one is genuinely visible rather than a sliver —
     a board that shows one column and 4px of the next reads as broken, and the
     whole gesture of a board is that there is something to the right. */
  .pv-kb-col { flex: 0 0 13.25rem; }
}
`;

// Every skin in this build — the four options plus the review boards. The token
// check, the colour-kind check and the scoping check all run over THIS list, so a
// board cannot reference a token the app does not define (which renders as
// NOTHING, silently) any more than an option can. A board is a skin; it is held
// to a skin's rules.
const REVIEW_BOARDS = [
  { file: 'preview/parts.html', skin: PARTS_SKIN, what: 'the components, one at a time' },
  { file: 'preview/empty.html', skin: EMPTY_SKIN, what: 'the empty states, and what could sit in them' },
  { file: 'preview/board.html', skin: BOARD_SKIN, what: 'the whole board at once, and how a card moves between columns' },
];
const SKINS = [...OPTIONS.map(o => o.skin), ...REVIEW_BOARDS.map(b => b.skin)];

const boardPage = (skin, title, sub, here, body) =>
  pageHead({ skin }, title)
  + boardTop(title, sub, here)
  + body
  + `
</div>
</body>
</html>
`;

// ── what gets written ────────────────────────────────────────────────────────
// Built in memory first, so the checks below can inspect the real bytes and so
// `--check` can compare them against what is on disk without touching anything.
const FILES = {
  'preview.css': previewCss,
  'index.html': chooserPage(),
};
OPTIONS.forEach(o => { FILES[o.key + '.html'] = optionPage(o); });
FILES['parts.html'] = boardPage(PARTS_SKIN,
  'I-PASSBOOK \u2014 Tabler parts',
  'Spinners, milestone steps, clean toasts, charts, a people board \u2014 the parts of Tabler worth having, one at a time, in option D\u2019s language.',
  'parts', partsBoard());
FILES['empty.html'] = boardPage(EMPTY_SKIN,
  'I-PASSBOOK \u2014 Empty states',
  'What the app shows when there is nothing to show \u2014 and the CC0 illustration sets that could sit there, rendered in place, as shipped and re-coloured.',
  'empty', emptyBoard());
FILES['board.html'] = boardPage(BOARD_SKIN,
  'I-PASSBOOK — IR board',
  'The IR list as a board — every IR in one picture, and the real decision underneath it: how a card moves between columns.',
  'board', boardBoard());

// ── self-check ───────────────────────────────────────────────────────────────
// The same contract the polish preview keeps: a build that produces something
// subtly wrong should fail HERE, loudly, rather than in front of the owner.
const problems = [];

// The one that matters most. `var(--something-typo)` is not an error anywhere —
// it silently renders as nothing, so a mistyped token produces a page that is
// merely, invisibly wrong, and the owner would be reviewing a colour that is not
// the colour. Every custom property referenced anywhere in the generated output
// must be defined in the app's own tokens/palette or by a skin.
const defined = new Set(
  [...(tokensCss + brandBlock + paletteCss + themeCss + SKINS.join('\n')).matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)]
    .map(m => m[1])
);
const referenced = new Set(
  [...(previewCss + SKINS.join('\n')).matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)]
    .map(m => m[1])
);
const undefined_ = [...referenced].filter(t => !defined.has(t)).sort();
if (undefined_.length) problems.push(`tokens used but never defined (these render as NOTHING): ${undefined_.join(', ')}`);

// Existence is not enough — a token can exist and still be the WRONG KIND. The
// app has families that are not colours: --focus-* and --elevation-* are
// box-shadows, --text-* are font sizes, --radius-* are lengths, --weight-* are
// numbers. Writing a shadow token into a colour property is not an error
// anywhere; it produces an invalid declaration, which the browser drops, so the
// element silently keeps whatever was behind it. Option B shipped four status
// dots and one "overdue" date that way before this check existed, and no amount
// of reading the token table would have revealed it.
//
// Comments are stripped FIRST. They have to be: this check's own explanation
// names the bad pattern, and without stripping it matches the prose and refuses
// every build — an error message about a bug that is not in the file.
const NOT_A_COLOUR = /^--(focus|elevation|shadow|text|leading|weight|radius|font|ease|safe|header-h|list-w|content-max|bottombar-h)/;
const COLOUR_PROP = /^(background|background-color|color|border-color|border-(top|right|bottom|left)-color|outline-color|fill|stroke|text-decoration-color|caret-color)$/;
const kindErrors = [];
[...(stripComments(previewCss) + '\n' + SKINS.map(stripComments).join('\n')).matchAll(/([-a-z]+)\s*:\s*([^;{}]*)/g)].forEach(m => {
  const [, prop, value] = m;
  if (!COLOUR_PROP.test(prop)) return;
  [...value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].forEach(v => {
    if (NOT_A_COLOUR.test(v[1])) kindErrors.push(`${prop}: var(${v[1]})`);
  });
});
if (kindErrors.length) problems.push(`non-colour tokens used as colours: ${[...new Set(kindErrors)].join(', ')}`);

// Option B's accent is the one colour in this whole build that is NOT already in
// the app, so it is the one that can fail accessibility. The app measures its own
// palettes in smoke-palette.mjs; nothing would measure this one, and "it looked
// fine" is how a brand yellow ends up at 3:1 on dark. So measure it here, against
// the app's real dark surface, and refuse it if it does not clear AA.
//
// Read from tokens.css rather than retyped: a hardcoded #171717 would keep
// passing after someone retuned the dark theme, which is the failure this is
// supposed to catch.
const darkBlock = tokensCss.slice(tokensCss.indexOf('[data-theme="dark"]'));
const darkSurface = (darkBlock.match(/--surface-gray-10:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
if (!darkSurface) problems.push('could not read --surface-gray-10 out of the dark theme to measure Option B against');
const yellow = (OPTIONS.find(o => o.key === 'b').skin.match(/--ind-yellow:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
if (!yellow) problems.push('Option B declares no --ind-yellow to measure');

const lum = hex => {
  const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
let accentRatio = 0;
if (darkSurface && yellow) {
  accentRatio = ratio(yellow, darkSurface);
  if (accentRatio < 4.5) problems.push(`Option B's accent ${yellow} is only ${accentRatio.toFixed(2)}:1 on ${darkSurface} — below AA (4.5:1)`);
}

if (missing.length) problems.push(`class names the app does not use: ${missing.join(', ')}`);
if (missingIds.length) problems.push(`ids the app does not use: ${missingIds.join(', ')}`);

const written = Object.keys(FILES);
written.filter(f => f.endsWith('.html')).forEach(f => {
  const html = FILES[f];
  if (!html.includes(`preview.css?v=${cssHash}`)) problems.push(`${f} does not link the hashed stylesheet`);
  if (/<script/i.test(html)) problems.push(`${f} carries a script — these pages must stay inert`);
  if (/https?:\/\//.test(html.replace(/https?:\/\/www\.w3\.org/g, ''))) problems.push(`${f} reaches out to a third party`);
});
// A skin that leaked into another option would make two of the three look alike
// and the review worthless. So: walk each skin at brace depth 0 and require every
// selector there to be scoped to .pv. A depth-0 walk rather than a line-by-line
// regex, because a rule's declaration block legitimately spans several lines and
// a regex looking for "a line that starts with a letter" trips over exactly that
// (it flagged Option B's own `.pv {` continuation before this was written).
function topLevelSelectors(css) {
  const src = stripComments(css);
  const out = [];
  let sel = '', depth = 0;
  for (const ch of src) {
    if (ch === '{') { if (depth === 0) out.push(sel.trim()); depth++; sel = ''; }
    else if (ch === '}') { depth = Math.max(0, depth - 1); sel = ''; }
    else if (depth === 0) sel += ch;
  }
  return out.filter(Boolean);
}
// Every top-level selector must live in this page's own `pv` namespace — either
// the option root (`.pv`, `.pv-app …`) or the review chrome (`.pv-page`, `.pv-tab`).
// Anything else could escape into the app, or into another option's page.
OPTIONS.forEach(o => {
  const bare = topLevelSelectors(o.skin).filter(s => !s.startsWith('@') && !/^\.pv\b/.test(s));
  if (bare.length) problems.push(`option ${o.key} has unscoped rules: ${bare.slice(0, 3).join(' | ')}`);
  if (!/^\.pv\b/m.test(o.skin)) problems.push(`option ${o.key} never scopes to .pv`);
});
// The review boards are skins too, and a board rule that escaped its own page
// would restyle an option page and quietly change what the owner is comparing.
// Same walk, same rule: every top-level selector must live in the .pv namespace.
REVIEW_BOARDS.forEach(b => {
  const bare = topLevelSelectors(b.skin).filter(s => !s.startsWith('@') && !/^\.pv\b/.test(s));
  if (bare.length) problems.push(`${b.file} has unscoped rules: ${bare.slice(0, 3).join(' | ')}`);
  if (!/^\.pv\b/m.test(b.skin)) problems.push(`${b.file} never scopes to .pv`);
});
if (problems.length) {
  console.error('\nBUILD REFUSED:');
  problems.forEach(p => console.error('  - ' + p));
  process.exit(1);
}

// ── write, or verify that what is committed is current ───────────────────────
// `--check` exists because these pages are COMMITTED and SERVED: the deployed
// copies are a build artifact in git, so editing tokens.css or palette.css and
// forgetting to rebuild leaves a live preview advertising colours the app no
// longer has — and the owner would be choosing a design against a stale board.
// tools/smoke-preview.mjs runs this mode, so the drift fails the test suite
// rather than waiting to be noticed.
const OUT = join(ROOT, 'preview');
const stale = [];
if (process.argv.includes('--check')) {
  for (const [name, content] of Object.entries(FILES)) {
    let onDisk = null;
    try { onDisk = fs.readFileSync(join(OUT, name), 'utf8'); } catch { /* missing counts as stale */ }
    if (onDisk !== content) stale.push(name);
  }
  if (stale.length) {
    console.error('\npreview/ IS STALE: ' + stale.join(', '));
    console.error('The committed review pages no longer match what this builder produces.');
    console.error('Run:  node tools/build-ui-options.mjs');
    process.exit(1);
  }
  console.log(`preview/ is current with the app (tokens ${cssHash})`);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(FILES)) fs.writeFileSync(join(OUT, name), content);

const nPages = written.filter(f => f.endsWith('.html')).length;
console.log(`wrote preview/  (${nPages} pages + preview.css?v=${cssHash})`);
console.log(`  ${(previewCss.length / 1024).toFixed(1)} KB shared css, tokens and palette verbatim from the app`);
if (accentRatio) console.log(`  Option B accent ${yellow} on ${darkSurface}: ${accentRatio.toFixed(2)}:1  (AA needs 4.5, AAA needs 7)`);
OPTIONS.forEach(o => console.log(`  preview/${o.key}.html  ${o.name}`));
REVIEW_BOARDS.forEach(b => console.log(`  ${b.file}  ${b.what}`));
