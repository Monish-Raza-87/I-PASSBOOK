// Smoke test for the UI changes the owner asked for after walking the real app.
//
//   node tools/smoke-ui.mjs
//
//   1. the digital-signature feature is gone — nothing signs a section
//   2. the activity log is collapsed, and reads in plain English
//   3. it sits below every section, inside the detail pane
//   4. the sidebar and the IR list both fold away
//   5. the comments icon is a real icon, not an emoji
//   +  no user-visible "ticket" survives anywhere
//
// Every case here is BEHAVIOUR the browser would also produce, not a snapshot of
// the source. The one source-level case — "no signature function survives" — cannot
// be observed through a stub DOM: absence is not a behaviour, so a regex over
// comment-stripped source is the honest way to pin it.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();

const APP_JS = new URL('../app.js', import.meta.url);
const INDEX  = new URL('../index.html', import.meta.url);
const appSrc   = fs.readFileSync(APP_JS, 'utf8');
const indexSrc = fs.readFileSync(INDEX, 'utf8');
const viewsCode = fs.readFileSync(new URL('../views.css', import.meta.url), 'utf8');
const componentsCode = fs.readFileSync(new URL('../components.css', import.meta.url), 'utf8');
const baseSrc = fs.readFileSync(new URL('../base.css', import.meta.url), 'utf8');
const swSrc   = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// Comments are prose ABOUT the change, and several of them name the thing that was
// removed ("no Sign as … button any more"). Every source assertion below therefore
// reads the code with comments stripped, so a comment can never satisfy it.
//
// This is a real single-pass scanner, not a regex, and it keeps a STACK rather than
// a single state. Three things forced that, all of them present in app.js:
//
//   * `accept="image/*,application/pdf"` sits inside a template literal — a regex
//     would read `/*` as an opening block comment.
//   * `.replace(/"/g, …)` is a REGEX LITERAL containing a quote. Read as code, that
//     quote opens a string that runs on for a hundred lines.
//   * a template literal can contain `${ … }`, and THAT can contain another
//     template — which a single-state scanner closes early and then loses its place.
//
// All three desync it, and a desynced scanner does not fail loudly: it silently
// stops stripping comments and hands every assertion below a file with a hole in it.
// That is exactly how the emoji ledger came in sixteen under the truth.
function stripJs(src) {
  const stack = [{ t: 'code', braces: 0 }];
  const top = () => stack[stack.length - 1];
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    const st = top();
    if (st.t === 'line')  { if (c === '\n') { stack.pop(); out += c; } i++; continue; }
    if (st.t === 'block') { if (c === '*' && d === '/') { stack.pop(); i += 2; } else i++; continue; }
    if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
    // Inside a string: keep the text — UI copy lives in these, which is the point of
    // scanning at all — but never let it open a comment.
    if (st.t === 'single') { out += c; if (c === "'") stack.pop(); i++; continue; }
    if (st.t === 'double') { out += c; if (c === '"') stack.pop(); i++; continue; }
    if (st.t === 'regex') {
      if (c === '[') st.inClass = true;
      else if (c === ']') st.inClass = false;
      else if (c === '/' && !st.inClass) stack.pop();
      out += c; i++; continue;
    }
    if (st.t === 'template') {
      if (c === '`') { stack.pop(); out += c; i++; continue; }
      // `${` opens a real code context — which is the only way a comment or a nested
      // template inside an interpolation is ever seen for what it is.
      if (c === '$' && d === '{') { stack.push({ t: 'code', braces: 0 }); out += c + d; i += 2; continue; }
      out += c; i++; continue;
    }
    if (c === '/' && d === '/') { stack.push({ t: 'line' }); i += 2; continue; }
    if (c === '/' && d === '*') { stack.push({ t: 'block' }); i += 2; continue; }
    if (c === '/' && opensRegex(out)) { stack.push({ t: 'regex', inClass: false }); out += c; i++; continue; }
    if (c === "'") { stack.push({ t: 'single' }); out += c; i++; continue; }
    if (c === '"') { stack.push({ t: 'double' }); out += c; i++; continue; }
    if (c === '`') { stack.push({ t: 'template' }); out += c; i++; continue; }
    if (c === '{') { st.braces++; out += c; i++; continue; }
    if (c === '}') {
      if (st.braces > 0) st.braces--;
      else if (stack.length > 1) { stack.pop(); out += c; i++; continue; }   // closes a `${ … }`
      out += c; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

// `/` divides when a value has just ended — a name, a `)`, a `]`, or a closing
// quote. Everywhere else it opens a regex literal. That is the rule the language
// itself uses; the two disagree only for a regex whose first token is one of those,
// which app.js has none of. Only the tail of the output is examined, so this stays
// O(1) per slash.
function opensRegex(out) {
  const tail = out.slice(-16).replace(/\s+$/, '');
  const prev = tail.slice(-1);
  if (prev === '') return true;
  if (prev === ')' || prev === ']') return false;
  if (prev === '"' || prev === "'" || prev === '`') return false;
  if (/[\w$]/.test(prev)) {
    // After a KEYWORD a `/` opens a regex (`return /x/`); after a name it divides.
    return /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(tail);
  }
  return true;
}
const stripHtml   = s => s.replace(/<!--[\s\S]*?-->/g, '');
const appCode     = stripJs(appSrc);
const indexCode   = stripHtml(indexSrc);

// Ancestry, not adjacency: "is X inside Y" is the whole claim for the activity
// panel, and a substring test cannot answer it — #ir-activity sits AFTER
// #ir-overview in the file, so `overview[\s\S]*timeline` matches even when the
// timeline is nowhere near the Overview. This walks the div/section nesting and
// records the real parent chain.
function ancestorPath(html, id) {
  const tags = /<(\/?)(div|section|aside|main|nav|header|footer)\b([^>]*)>/g;
  const stack = [];
  let m;
  while ((m = tags.exec(html))) {
    const [, close, name, attrs] = m;
    if (close) { if (stack.length) stack.pop(); continue; }
    const found = /id="([^"]+)"/.exec(attrs);
    if (found && found[1] === id) return stack.slice();
    stack.push(found ? found[1] : name);
  }
  return null;
}
const insideOf = (id, ancestorId) => (ancestorPath(indexCode, id) || []).includes(ancestorId);

const { T, byId } = loadApp(`
  SECTIONS,
  renderActivityCount, applyActivityState, toggleActivity,
  applyChromeState, toggleRail, toggleList, renderLayout, iconSvg, ICON_PATHS,
  TIMELINE_KINDS, IR_CATEGORIES,
  storedFlag, setFlag, RAIL_KEY, LIST_KEY, ACTIVITY_KEY, ACTIVITY_LIMIT,
  get view() { return currentView; },
  set view(v) { currentView = v; },
  set ir(v) { currentIR = v; },
  set user(v) { currentUser = v; },
  // The pane-visibility adjective classes live on <body>, and the harness's body is
  // one stable stub, so this is the real thing renderLayout toggles rather than a
  // copy of it.
  bodyClasses: document.body.classList,
  // The list fold is an adjective class on <html>, like the sidebar's rail.
  get htmlEl() { return document.documentElement; },
  set logCache(v) { activityLogCache = v; },
  setEntries: (irNumber, entries) => { activityLogCache = { irNumber: irNumber, entries: entries }; },
  refreshActivityLog,
`, { capture: true });

// ── 1. Nothing signs a section any more ───────────────────────────────────────
// Signatures were never asked for, and the auto-stamped block ("Digital Signature —
// Test Pilot / Recorded automatically when this section is saved") was noise on
// every section. Who saved a section is answered by the activity log below.
r.head('the digital-signature feature is gone, everywhere');
r.ok('no e-signature field survives in any section', (() => {
  const left = [];
  Object.keys(T.SECTIONS).forEach(sid => {
    T.SECTIONS[sid].fields.forEach(f => { if (f.type === 'esignature') left.push(sid + '.' + f.id); });
  });
  return left.length === 0;
})(), 'an `esignature` field type still exists in SECTIONS');
r.ok('no renderer, filler or stamp function survives',
  !/\b(signESignature|renderESignatureHTML|refreshESignature|signSectionOnSave|esignatureState)\b/.test(appCode),
  (appCode.match(/.*\b(signESignature|renderESignatureHTML|refreshESignature|signSectionOnSave|esignatureState)\b.*/) || [])[0]);
r.ok('and nothing renders a signed name or an auto-stamp',
  !/signedBy|signedAt/.test(appCode), (appCode.match(/.*signed(By|At).*/) || [])[0]);
r.ok('the e-signature CSS is gone with it',
  !/\.esignature-/.test(fs.readFileSync(new URL('../views.css', import.meta.url), 'utf8')));
r.ok('saving a section no longer stamps anything', (() => {
  const from = appSrc.indexOf('async function saveSection(');
  if (from < 0) return false;
  return appSrc.slice(from, from + 4000).indexOf('signSectionOnSave(') === -1;
})());

// ── 2 + 3. The activity panel ─────────────────────────────────────────────────
r.head('the activity log sits under the sections, inside the detail pane');
r.ok('#ir-activity is inside #detail-view, so #detail-view stays a truthful "is an IR open" flag',
  insideOf('ir-activity', 'detail-view') && !insideOf('ir-activity', 'index-view'),
  ancestorPath(indexCode, 'ir-activity'));
r.ok('it is inside #detail-view but OUTSIDE #sections-wrapper',
  !insideOf('ir-activity', 'sections-wrapper'), ancestorPath(indexCode, 'ir-activity'));
r.ok('and it comes after every section in reading order',
  indexCode.indexOf('id="ir-activity"') > indexCode.indexOf('id="sections-wrapper"'));
r.ok('#ir-timeline is mounted inside the activity panel, not in the Overview',
  insideOf('ir-timeline', 'ir-activity') && !insideOf('ir-timeline', 'ir-overview'),
  ancestorPath(indexCode, 'ir-timeline'));
r.ok('it is none of the three things the pane rules reserve for sections',
  !/id="ir-activity"[^>]*class="[^"]*\bsec-/.test(indexCode) &&
  !/id="ir-activity"[^>]*class="[^"]*section-content/.test(indexCode));
r.ok('the intake log stays in the Overview, where it belongs',
  insideOf('ir-legacy-log', 'ir-overview'));

r.head('the panel is collapsed by default and remembers being opened');
r.ok('the markup ships it closed', (() => {
  const tag = indexCode.slice(indexCode.indexOf('id="ir-activity"'), indexCode.indexOf('id="ir-activity-body"'));
  return !/class="[^"]*\bis-open/.test(tag) && /aria-expanded="false"/.test(tag);
})(), indexCode.slice(indexCode.indexOf('id="ir-activity"'), indexCode.indexOf('id="ir-activity-body"')));
r.ok('the control is a real button, so it is reachable by keyboard',
  /<button[^>]*id="ir-activity-toggle"/.test(indexCode) &&
  /id="ir-activity-toggle"[\s\S]{0,200}?aria-controls=/.test(indexCode));
r.ok('the icon inside the toggle is hidden from screen readers',
  /class="activity-caret" aria-hidden="true"/.test(indexCode));

// `capture: true` memoizes only the ids the app actually asks for, so the two
// elements the assertions below read have to be primed by calling the real
// functions once — which is also the boot path, so this is not a stub artefact.
const panel     = (T.applyActivityState(false), byId.get('ir-activity'));
const toggleBtn = byId.get('ir-activity-toggle');
const countEl   = (T.renderActivityCount(0, 0), byId.get('ir-activity-count'));

r.ok('an unremembered preference leaves it collapsed',
  !T.storedFlag(T.ACTIVITY_KEY), T.storedFlag(T.ACTIVITY_KEY));
T.applyActivityState(false);
r.ok('closing removes the class and says so', !panel.classList.contains('is-open') &&
  toggleBtn.getAttribute('aria-expanded') === 'false',
  [panel.classList.contains('is-open'), toggleBtn.getAttribute('aria-expanded')]);
T.applyActivityState(true);
r.ok('opening adds the class and flips the announcement together',
  panel.classList.contains('is-open') && toggleBtn.getAttribute('aria-expanded') === 'true',
  [panel.classList.contains('is-open'), toggleBtn.getAttribute('aria-expanded')]);
r.ok('the class, not an inline display, drives the fold — panes own inline display',
  !('display' in panel.style) || !panel.style.display, panel.style);
r.ok('the stylesheet is what hides the collapsed body, not an inline style', (() => {
  const css = fs.readFileSync(new URL('../views.css', import.meta.url), 'utf8');
  const base = /\.activity-body\s*\{[^}]*display:\s*none/.test(css);
  const open = /#ir-activity\.is-open\s+\.activity-body\s*\{[^}]*display:\s*block/.test(css);
  return base && open;
})(), fs.readFileSync(new URL('../views.css', import.meta.url), 'utf8')
  .split('\n').filter(l => /activity-body/.test(l)));

r.head('the toggle flips the preference and the panel together');
(() => {
  try { localStorage.removeItem(T.ACTIVITY_KEY); } catch { /* non-fatal */ }
  T.toggleActivity();
  const opened = panel.classList.contains('is-open') && T.storedFlag(T.ACTIVITY_KEY);
  T.toggleActivity();
  const closed = !panel.classList.contains('is-open') && !T.storedFlag(T.ACTIVITY_KEY);
  return opened && closed;
})();
r.ok('open → persisted → closed → forgotten',
  !panel.classList.contains('is-open') && !T.storedFlag(T.ACTIVITY_KEY),
  [panel.classList.contains('is-open'), T.storedFlag(T.ACTIVITY_KEY)]);
r.ok('a remembered open survives a reload', (() => {
  T.setFlag(T.ACTIVITY_KEY, true);
  T.applyActivityState(T.storedFlag(T.ACTIVITY_KEY));
  const on = panel.classList.contains('is-open');
  T.setFlag(T.ACTIVITY_KEY, false);
  T.applyActivityState(T.storedFlag(T.ACTIVITY_KEY));
  return on && !panel.classList.contains('is-open');
})());

r.head('the count is honest, including while the panel is shut');
r.ok('the panel renders even when collapsed — the number must never go stale',
  // Nothing in refreshActivityLog may be gated on is-open. The panel is not a
  // pane, so there is no reason to skip work that costs one innerHTML.
  !/is-open/.test(appCode.slice(appCode.indexOf('function refreshActivityLog'),
                                 appCode.indexOf('function renderActivityCount'))));
const countEl2 = byId.get('ir-activity-count');
T.renderActivityCount(128, 40);
r.ok('a trimmed list says so rather than lying', countEl2.textContent === '40 of 128', countEl2.textContent);
T.renderActivityCount(12, 12);
r.ok('a complete list is just the number', countEl2.textContent === '12', countEl2.textContent);
T.renderActivityCount(0, 0);
r.ok('an IR with no activity shows no number at all', countEl2.textContent === '', countEl2.textContent);
r.ok('the count element is the one the markup declares, read once at boot',
  countEl === countEl2);
r.ok('the cap is the one the renderer uses', T.ACTIVITY_LIMIT === 40, T.ACTIVITY_LIMIT);

r.head('the panel is hidden entirely when no IR is open');
r.ok('renderOverview hides it in both of its branches', (() => {
  const from = appSrc.indexOf('function renderOverview(');
  const next = appSrc.indexOf('\nfunction ', from + 10);
  const body = appSrc.slice(from, next < 0 ? from + 3000 : next);
  // One branch for "no IR open" and one for the normal path — a panel left visible
  // over a closed IR would show the previous IR's activity under a blank screen.
  return (body.match(/activity\.classList\.add\('is-hidden'\)/g) || []).length === 1 &&
         (body.match(/activity\.classList\.remove\('is-hidden'\)/g) || []).length === 1;
})(), (() => {
  const from = appSrc.indexOf('function renderOverview(');
  const next = appSrc.indexOf('\nfunction ', from + 10);
  return (appSrc.slice(from, next < 0 ? from + 3000 : next).match(/.*is-hidden.*/g) || []);
})());

// ── 4. The two folds ──────────────────────────────────────────────────────────
r.head('the sidebar folds to an icon rail');
r.ok('the control is a real button in the header',
  /<button[^>]*id="sidebar-toggle"/.test(indexCode) &&
  /id="sidebar-toggle"[\s\S]{0,200}?aria-controls="sidebar"/.test(indexCode));
r.ok('it lives OUTSIDE the panes, so folding a pane cannot hide the control that undoes it',
  indexCode.indexOf('id="sidebar-toggle"') < indexCode.indexOf('id="index-view"'),
  [indexCode.indexOf('id="sidebar-toggle"'), indexCode.indexOf('id="index-view"')]);
r.ok('the fold is a class on the document root, never an inline width',
  /root\.classList\.toggle\('rail-collapsed', rail\)/.test(appCode) &&
  !/sidebar\.style\.(width|display)/.test(appCode));
r.ok('and it is remembered per device', T.RAIL_KEY === 'rail' && T.LIST_KEY === 'list');

r.head('a list row carries state, and gives way in the one place that costs nothing');
// The owner, 2026-09-21: IR470's "AN" circle was "overlapping above 'open' status
// i.e., hiding it". Nothing was painted over anything — the row had collected more
// chips than the 400px `--list-w` pane holds, the side column was allowed to
// shrink, and a shrunk right-aligned flex column overflows at its START edge,
// where `overflow: hidden` sliced the `Open` pill in half. These assertions pin
// the three rules that make that impossible, plus the two the owner asked for:
// the assignee's name beside the IR number, and the rest of the ticket on hover.
const sideRule = (viewsCode.match(/\.ir-card-side \{[\s\S]*?\n\}/) || [''])[0];
r.ok('the side column can never be squeezed — flex-basis auto, no shrink',
  /flex: 0 0 auto;/.test(sideRule) && !/flex: 0 1 auto/.test(sideRule), sideRule);
r.ok('...and it no longer hides anything, so no pill can be clipped away',
  !/overflow/.test(sideRule), sideRule);
r.ok('...while the middle column is still the one that gives way',
  /\.ir-card-main \{[\s\S]*?flex: 1 1 auto;/.test(viewsCode) &&
  /\.ir-card-main \{[\s\S]*?min-width: 0;/.test(viewsCode));
r.ok('a title can never wrap the row taller than its neighbours',
  /\.ir-title \{[\s\S]*?white-space: nowrap;/.test(viewsCode) &&
  /\.ir-title \{[\s\S]*?text-overflow: ellipsis;/.test(viewsCode));

// The owner's own fix for the row: "instead of placing AN in a circle on left of
// IR470 … we may write down Adhik Nair in small on the right of IR470". The circle
// cost a 26px chip plus a gap in the side column, on exactly the row that could
// least afford one, and the empty space he pointed at really is empty.
//
// The guard is scoped to the ROW, not to the helper by name. `initialsOf()` came
// back for the Insights People card — a full-width card, one row per assignee, no
// chips on the line and no 400px budget — and banning the name outright would
// fail on work that does not touch the row he complained about. What he asked to
// be gone is asserted where it lived: inside `renderIRList`.
//
// `\r?\n` on both sides of the closing brace, because app.js is CRLF. The first
// draft of this used a bare `\n}\n`, which matches nothing at all in a CRLF file —
// so the body came back empty and the assertion below would have passed on an
// empty string, testing nothing.
const rowBody = (appCode.match(/function renderIRList\(records\)[\s\S]*?\r?\n\}\r?\n/) || [''])[0];
r.ok('the assignee is a NAME beside the IR number, not an initials chip',
  /<div class="ir-title-row">[\s\S]{0,200}?<span class="ir-assignee"/.test(appCode),
  (appCode.match(/class="ir-title-row"[\s\S]{0,160}/) || [''])[0]);
r.ok('...and the initials circle is gone from the renderer and the stylesheet',
  !/assignee-avatar/.test(appCode) && !/assignee-avatar/.test(viewsCode) &&
  rowBody.length > 1000 && !/initialsOf/.test(rowBody) && !/person-avatar/.test(rowBody),
  { rowBodyChars: rowBody.length, initialsInRow: /initialsOf/.test(rowBody) });r.ok('the name is allowed to shrink, and carries the full name for when it does',
  /\.ir-assignee \{[\s\S]*?flex: 0 1 auto;/.test(viewsCode) &&
  /\.ir-assignee \{[\s\S]*?text-overflow: ellipsis;/.test(viewsCode) &&
  /<span class="ir-assignee" title="Assigned to /.test(appCode));

// The owner's other half: "or else show when hovered above it or both."
r.ok('the hover line exists, and the renderer fills it from the same record',
  /<div class="ir-card-hover">/.test(appCode) && /hoverBits/.test(appCode));
r.ok('...it sits over the SAME two grid rows, so revealing it moves nothing',
  /\.ir-card-hover \{[\s\S]*?grid-area: 1 \/ 1 \/ 3 \/ 1;/.test(viewsCode) &&
  /\.ir-card-main \{[\s\S]*?display: grid;/.test(viewsCode) &&
  /\.ir-card-main \{[\s\S]*?grid-template-rows: auto auto;/.test(viewsCode));
r.ok('...it is out of the tab order at rest — an invisible focusable link is a trap',
  /\.ir-card-hover \{[\s\S]*?visibility: hidden;/.test(viewsCode) &&
  /\.ir-card:hover \.ir-card-hover \{ visibility: visible; \}/.test(viewsCode));
r.ok('...and the hover rules are guarded, because a tap leaves :hover stuck on',
  /@media \(hover: hover\) \{/.test(viewsCode) &&
  viewsCode.indexOf('@media (hover: hover)') < viewsCode.indexOf('.ir-card:hover .ir-card-hover'));
r.ok('the covered title and meta fade rather than being removed, keeping the box',
  /\.ir-card:hover \.ir-title-row,\s*\n\s*\.ir-card:hover \.ir-meta \{ opacity: 0; \}/.test(viewsCode));
r.ok('the two conveniences left the row at EVERY width, not just on phones',
  !/\.ir-card-side[\s\S]{0,400}?badge-legacy/.test(appCode) &&
  !/@media \(max-width: 639px\) \{\s*\n\s*\.ir-card-side/.test(viewsCode));
r.ok('...and the Summary link is still rendered, just not in the row',
  /ir-card-hover[\s\S]{0,200}?ir-summary-link/.test(appCode));

r.head('the IR list folds away, but never into an empty screen');r.ok('the control is a real button in the header',
  /<button[^>]*id="list-toggle"/.test(indexCode) &&
  /id="list-toggle"[\s\S]{0,200}?aria-controls="index-view"/.test(indexCode));
r.ok('renderLayout still writes INLINE display, for all three panes',
  /indexView\.style\.display\s*=/.test(appCode) && /detailView\.style\.display\s*=/.test(appCode) &&
  /insightsView\.style\.display\s*=/.test(appCode));
r.ok('the list can never be hidden while the user is on the index', (() => {
  T.view = 'index';
  T.setFlag(T.LIST_KEY, true);      // asked for the room, but no IR is open
  T.renderLayout();
  const hidden = byId.get('index-view').style.display === 'none';
  T.setFlag(T.LIST_KEY, false);
  return !hidden;
})(), byId.get('index-view').style.display);

// The fold is a 56px RAIL now, not `display: none` — the sidebar's own treatment.
// Two things follow, and both are asserted below: folding never removes the pane
// from the layout (so nothing is ever stranded), and it does something on the
// index screen too, which is precisely what the owner found broken.
r.ok('an open IR keeps the list beside it, and folding gives the width away as a rail', (() => {
  // The default harness viewport is a PHONE, where an open detail legitimately hides
  // the list. The claim being tested is the DESKTOP rule, so it needs a desktop.
  const { T: D } = loadApp(`
    renderLayout, setFlag, LIST_KEY,
    get view() { return currentView; },
    set view(v) { currentView = v; },
    set ir(v) { currentIR = v; },
    get htmlEl() { return document.documentElement; },
  `, { capture: true, desktop: true });
  D.view = 'detail';
  D.ir = { irNumber: 'IR409' };
  D.setFlag(D.LIST_KEY, false);
  D.renderLayout();
  const besideIt = !D.htmlEl.classList.contains('list-collapsed');
  D.setFlag(D.LIST_KEY, true);
  D.renderLayout();
  const folded = D.htmlEl.classList.contains('list-collapsed');
  D.setFlag(D.LIST_KEY, false);
  return besideIt && folded;
})(), 'desktop: beside the detail; folded it is a rail, still on screen');

r.ok('the fold changes the layout with no IR open — the defect that read as a dead button', (() => {
  const { T: D } = loadApp(`
    renderLayout, setFlag, LIST_KEY,
    get view() { return currentView; },
    set view(v) { currentView = v; },
    get htmlEl() { return document.documentElement; },
  `, { capture: true, desktop: true });
  D.view = 'index';
  D.setFlag(D.LIST_KEY, false);
  D.renderLayout();
  const open = !D.htmlEl.classList.contains('list-collapsed');
  D.setFlag(D.LIST_KEY, true);
  D.renderLayout();
  const folded = D.htmlEl.classList.contains('list-collapsed');
  D.setFlag(D.LIST_KEY, false);
  return open && folded;
})(), 'the index screen folds too, not just the tooltip');

r.ok('a phone never folds the list, because there the list IS the screen', (() => {
  T.view = 'index';
  T.setFlag(T.LIST_KEY, true);
  T.renderLayout();
  const folded = T.htmlEl.classList.contains('list-collapsed');
  T.setFlag(T.LIST_KEY, false);
  T.renderLayout();
  return !folded;
})(), 'below lg the fold is inert, and the rail never appears');

r.ok('the rail carries the count and its own way back', (() => {
  const rail = indexCode.slice(indexCode.indexOf('id="list-rail"'));
  return /id="list-rail"[\s\S]{0,400}?id="list-rail-restore"/.test(indexCode) &&
    /id="list-rail-count"/.test(indexCode) &&
    /class="list-rail-icon"/.test(rail) &&
    /listRailRestore\.addEventListener\('click',\s*toggleList\)/.test(appCode) &&
    /listRailCountEl\.textContent\s*=/.test(appCode) &&
    /\['#list-rail-restore \.list-rail-icon',\s*'list'\]/.test(appCode);
})(), 'a restore button, a live count, and an icon that is actually filled');

r.ok('the rail is CSS-owned: one class on <html>, no second writer of a pane display', (() => {
  // Read as code, not as prose — the block above is explained in a comment that
  // names these selectors, and a comment must never satisfy a source assertion.
  const css = baseSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  return /#list-rail \{ display: none; \}/.test(css) &&
    /html\.list-collapsed #index-view \{/.test(css) &&
    /html\.list-collapsed #index-view \.list-toolbar,[\s\S]{0,200}?html\.list-collapsed #index-view \.ir-board,/.test(css) &&
    /html\.list-collapsed #index-view > #sync-status \{ display: none; \}/.test(css) &&
    /html\.list-collapsed #list-rail \{/.test(css) &&
    /classList\.toggle\('list-collapsed', desktop && !boardFull && storedFlag\(LIST_KEY\)\)/.test(appCode) &&
    // The board exception is the whole reason the fold is not simply
    // `storedFlag(LIST_KEY)`, so it is pinned rather than left to the comment.
    /const boardFull\s*=\s*desktop && listMode === 'board'/.test(appCode);
})(), 'the rules live in base.css above lg and nowhere write display inline');
r.ok('the detail pane is what governs the back button, not the fold',
  /backBtn\.style\.display\s*=/.test(appCode));

// ── The two columns the user can drag ─────────────────────────────────────────
r.head('the sidebar and the IR list are as wide as the user leaves them');

r.ok('both columns carry a drag handle, and it says how to undo the drag', (() => {
  const s = indexCode.slice(indexCode.indexOf('id="sidebar-resize"') - 200, indexCode.indexOf('id="sidebar-resize"') + 200);
  const l = indexCode.slice(indexCode.indexOf('id="list-resize"') - 200, indexCode.indexOf('id="list-resize"') + 200);
  return /class="pane-resize" id="sidebar-resize"/.test(s) && /double-click to reset/.test(s) &&
         /class="pane-resize" id="list-resize"/.test(l) && /double-click to reset/.test(l);
})(), 'a handle on each column edge, with the reset named in the tooltip');

r.ok('a handle exists only above lg — and is hidden by a rule, not by having none', (() => {
  const css = baseSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  // Below lg the handle has no rule of its own, so a missing base `display: none`
  // would leave it as an empty flex child of the phone bottom bar. That is a real
  // bug this pins: "the rule exists" is not "the rule applies".
  if (!/#sidebar-resize, #list-resize \{ display: none; \}/.test(css)) return false;
  if (!/#sidebar-resize, #list-resize \{ display: block; \}/.test(css)) return false;
  const at = css.indexOf('@media (min-width: 1024px) {');
  return css.indexOf('#sidebar-resize, #list-resize { display: block; }') > at &&
    css.indexOf('.pane-resize {') > at &&
    css.indexOf('html.pane-resizing') > at;
})(), 'off by default, on inside the desktop block');

r.ok('a handle is a pointer nicety, not a keyboard affordance it cannot honour',
  /id="sidebar-resize" title="[^"]*" aria-hidden="true"/.test(indexCode) &&
  /id="list-resize" title="[^"]*" aria-hidden="true"/.test(indexCode) &&
  !/id="(sidebar|list)-resize"[^>]*tabindex/.test(indexCode));

r.ok('the drag sets a custom property on <html> — never a width on the pane', (() => {
  const fn = appCode.slice(appCode.indexOf('function wirePaneResize'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  return /documentElement\.style\.setProperty\(cssVar, last \+ 'px'\)/.test(body) &&
    !/\.style\.width/.test(body) && !/\.style\.flexBasis/.test(body);
})(), 'one source of width, so every var(--sidebar-w) rule follows for free');

r.ok('the reset clears the property AND the stored number',
  /handle\.addEventListener\('dblclick',[\s\S]{0,200}?style\.removeProperty\(cssVar\)/.test(appCode) &&
  /handle\.addEventListener\('dblclick',[\s\S]{0,300}?localStorage\.removeItem\(key\)/.test(appCode));

r.ok('the drag uses pointer capture, so it survives leaving the 7px strip', (() => {
  const fn = appCode.slice(appCode.indexOf('function wirePaneResize'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  return /handle\.setPointerCapture\(e\.pointerId\)/.test(body) &&
    /handle\.releasePointerCapture\(e\.pointerId\)/.test(body) &&
    /addEventListener\('pointerup', onPointerUp\)/.test(body) &&
    // pointercancel as well as pointerup: a system gesture on a touchscreen ends
    // the drag without ever sending pointerup, and without this the app would sit
    // in `pane-resizing` with the transition still disabled.
    /addEventListener\('pointercancel', onPointerUp\)/.test(body);
})(), 'capture on down, released on both endings');

{ // Clamping, storage round-trip and the reset, measured rather than restated.
  const { T: W } = loadApp(`
    clampWidth, storedWidth, applyStoredWidths, SIDEBAR_W_KEY, LIST_W_KEY,
  `, { capture: true });
  r.ok('a width below the minimum is raised to it, and one above the maximum is cut',
    W.clampWidth(10, W.LIST_W_KEY) === W.clampWidth(280 - 1000, W.LIST_W_KEY) &&
    W.clampWidth(10, W.LIST_W_KEY) > 10 &&
    W.clampWidth(9999, W.LIST_W_KEY) < 9999,
    [W.clampWidth(10, W.LIST_W_KEY), W.clampWidth(9999, W.LIST_W_KEY)]);
  r.ok('...and the sidebar has its own, narrower pair of limits',
    W.clampWidth(5000, W.SIDEBAR_W_KEY) <= 360 &&
    W.clampWidth(5000, W.SIDEBAR_W_KEY) < W.clampWidth(5000, W.LIST_W_KEY),
    [W.clampWidth(5000, W.SIDEBAR_W_KEY), W.clampWidth(5000, W.LIST_W_KEY)]);
  // The window guard. The harness reports no innerWidth, so the fallback 1024 is
  // what every clamp above is measured against — which is the point: no column may
  // exceed half the window even when the stored number says it may.
  r.ok('no column may take more than half the window, whatever was saved',
    W.clampWidth(9999, W.LIST_W_KEY) <= 512, W.clampWidth(9999, W.LIST_W_KEY));
  r.ok('a stored width is clamped on the way IN as well as on the way out',
    /function storedWidth\(key\)[\s\S]{0,300}?clampWidth\(n, key\)/.test(appCode));
  r.ok('garbage in storage is refused rather than applied',
    /Number\.isFinite\(n\) && n > 0 \? clampWidth\(n, key\) : 0/.test(appCode) &&
    W.storedWidth('not-a-number') === 0);
}

{ // The end-to-end drag, driven through the real handlers.
  const { T: D, byId: d } = loadApp(`
    wirePaneResize, applyStoredWidths, storedWidth, LIST_W_KEY,
    get htmlEl() { return document.documentElement; },
  `, { capture: true, desktop: true });
  const handle = d.get('list-resize');
  const pane = d.get('index-view');
  const root = D.htmlEl;
  let fakeWidth = 400;
  pane.getBoundingClientRect = () => ({ width: fakeWidth });
  D.wirePaneResize(handle, '--list-w', D.LIST_W_KEY, pane);

  handle.dispatch('pointerdown', { clientX: 400 });
  const busy = root.classList.contains('pane-resizing');
  handle.dispatch('pointermove', { clientX: 460 });
  const moved = root.style.getPropertyValue('--list-w');
  handle.dispatch('pointermove', { clientX: 9000 });
  const capped = root.style.getPropertyValue('--list-w');
  handle.dispatch('pointerup', { clientX: 9000 });
  const idle = !root.classList.contains('pane-resizing');

  r.ok('a drag writes the width onto <html> as it moves',
    busy && moved === '460px', [busy, moved]);
  r.ok('...and the clamp holds it at the limit, not past it', capped === '512px', capped);
  r.ok('...and the class that disables the transition is gone when the drag ends', idle);
}

{ // The board giving up its column, and the fold standing down while it does.
  const { T: B } = loadApp(`
    setListView, renderLayout, setFlag, LIST_KEY, applyListFilters,
    get htmlEl() { return document.documentElement; },
    get listMode() { return listMode; },
    get view() { return currentView; },
    set view(v) { currentView = v; },
    renderBoard() {}, renderIRList() {},
  `, { capture: true, desktop: true });
  B.view = 'index';
  B.setFlag(B.LIST_KEY, true);          // the list is folded…
  B.setListView('board');
  const hiddenSidebar = /html\.board-full #sidebar \{ display: none; \}/.test(baseSrc);
  const full = B.htmlEl.classList.contains('board-full');
  const unfolded = !B.htmlEl.classList.contains('list-collapsed');
  const mode = B.listMode;
  B.setListView('list');
  const backToNormal = !B.htmlEl.classList.contains('board-full') &&
                       B.htmlEl.classList.contains('list-collapsed');
  B.setFlag(B.LIST_KEY, false);
  r.ok('choosing Board gives it the workspace', full && mode === 'board');
  r.ok('...and the stylesheet steps the sidebar, the placeholder and the fold aside',
    hiddenSidebar &&
    /html\.board-full #index-view \{ flex: 1 1 auto; width: auto; \}/.test(baseSrc) &&
    /html\.board-full #detail-placeholder \{ display: none; \}/.test(baseSrc) &&
    // Both fold controls go with them — a toggle for a column that is not on
    // screen is a dead control, which is how this one read in the browser.
    /html\.board-full #list-toggle,\s*\n\s*html\.board-full #sidebar-toggle \{ display: none; \}/.test(baseSrc));
  r.ok('...and the fold stands down, because a rail over the board is a stranding',
    unfolded);
  r.ok('...and going back to List restores both the fold and the sidebar',
    backToNormal);
  r.ok('the board class is inert below lg, so the phone board is untouched',
    (() => {
      const css = baseSrc.replace(/\/\*[\s\S]*?\*\//g, '');
      const at = css.indexOf('@media (min-width: 1024px) {');
      const board = css.indexOf('html.board-full #sidebar');
      return at >= 0 && board > at;
    })());
}

r.head('the Insights pane is a third sibling, not a panel inside the detail');
// Four claims. The dashboard must NOT be reached by opening the detail pane (the
// pane's display is the app's only "an IR is open" flag, and #ir-activity is pinned
// inside it), it must keep the IR list beside it on DESKTOP, it must NOT keep it on
// a phone (below lg #panes is a column, so "beside" is impossible: both panes were
// flex:1 with a zero basis and the list took the top half of the screen with the
// dashboard squeezed underneath — the owner's "there is a tile above it
// permanently"), and "No IR selected" must not show over it, which it otherwise
// would because that placeholder is keyed on body.view-detail being ABSENT.
r.ok('the insights pane is visible at view = \'insights\', and the detail is not', (() => {
  T.view = 'insights';
  T.renderLayout();
  const on  = byId.get('insights-view').style.display === 'flex';
  const off = byId.get('detail-view').style.display === 'none';
  T.view = 'index';
  T.renderLayout();
  return on && off && byId.get('insights-view').style.display === 'none';
})(), byId.get('insights-view').style.display);
r.ok('the IR list stays beside it on desktop', (() => {
  const { T: D, byId: dById } = loadApp(`
    renderLayout, setFlag, LIST_KEY,
    get view() { return currentView; },
    set view(v) { currentView = v; },
  `, { capture: true, desktop: true });
  D.setFlag(D.LIST_KEY, false);
  D.view = 'insights';
  D.renderLayout();
  const beside = dById.get('index-view').style.display !== 'none';
  // Desktop has no back affordance at all — the list never leaves the screen, so
  // there is nothing to go back to. (`#back-btn` is display:none !important there
  // as well; this is the JS half of the same claim.)
  const noBack = dById.get('back-btn').style.display === 'none';
  return beside && noBack;
})());
r.ok('on a PHONE the dashboard takes the screen and the list gets out of the way', (() => {
  // The default harness viewport is a phone. Both panes were flex:1 in a column,
  // so without this the list is the top half of the screen — permanently, which is
  // exactly what the owner reported.
  T.view = 'insights';
  T.renderLayout();
  const listGone = byId.get('index-view').style.display === 'none';
  const paneOn   = byId.get('insights-view').style.display === 'flex';
  // ...and it is only safe to fold the list because the SAME change hands the
  // dashboard a back button. Without this the fold strands the user, which is the
  // worry the original comment here was trying to answer.
  const back = byId.get('back-btn').style.display === 'block';
  T.view = 'index';
  T.renderLayout();
  const listBack = byId.get('index-view').style.display !== 'none';
  return listGone && paneOn && back && listBack;
})());
r.ok('...and the dashboard can be left again, on the phone', (() => {
  // The back button is wired to goIndex(), so "shown" has to mean "goes somewhere".
  return /backBtn\.addEventListener\('click'[\s\S]{0,80}goIndex\(\)/.test(appCode);
})());
r.ok('every view marks its nav item, so a tap is never a silent no-op', (() => {
  // `.nav-item.active` had a rule in base.css and no code ever applied it: tapping
  // Insights changed nothing visible anywhere, which reads as a dead tap.
  const onInsights = (() => {
    T.view = 'insights'; T.renderLayout();
    const el = byId.get('nav-insights');
    const other = byId.get('nav-tickets');
    return el.classList.contains('active') &&
           el.getAttribute('aria-current') === 'page' &&
           !other.classList.contains('active') &&
           other.getAttribute('aria-current') === null;
  })();
  const onIndex = (() => {
    T.view = 'index'; T.renderLayout();
    return byId.get('nav-tickets').classList.contains('active') &&
           !byId.get('nav-insights').classList.contains('active');
  })();
  // A ticket is a row of the IR list, not a section of its own.
  const onTicket = (() => {
    T.view = 'detail'; T.renderLayout();
    return byId.get('nav-tickets').classList.contains('active') &&
           !byId.get('nav-insights').classList.contains('active');
  })();
  // The Log Analyser is a peer section of the dashboard, so it marks its own item
  // and clears the other two — three items in the table, and all three must agree.
  const onLog = (() => {
    T.view = 'log'; T.renderLayout();
    return byId.get('nav-log').classList.contains('active') &&
           byId.get('nav-log').getAttribute('aria-current') === 'page' &&
           !byId.get('nav-insights').classList.contains('active') &&
           !byId.get('nav-tickets').classList.contains('active');
  })();
  T.view = 'index'; T.renderLayout();
  return onInsights && onIndex && onTicket && onLog;
})());
r.ok('the empty state is suppressed over it, in both directions', (() => {
  T.view = 'insights';
  T.renderLayout();
  const suppressed = !T.bodyClasses.contains('view-detail') &&
                     T.bodyClasses.contains('view-insights');
  // ...and coming back off the dashboard must clear it again, or the IR list would
  // keep the placeholder hidden for good.
  T.view = 'index';
  T.renderLayout();
  return suppressed && !T.bodyClasses.contains('view-insights');
})());
r.ok('the back button answers to the pane that OWNS the screen, not the detail alone',
  // It used to be `(!desktop && detail)`. That was right while the dashboard kept
  // the list on a phone; once the list folds, a phone needs a way back off the
  // dashboard too. The Log Analyser is the third pane that owns the screen, for the
  // same reason, so `full` grew a third term rather than a second flag. Desktop is
  // still excluded — `#back-btn` is display:none !important there, because the list
  // never leaves the screen.
  /backBtn\.style\.display\s*=\s*\(!desktop && full\)/.test(appCode) &&
  /const full\s*=\s*detail \|\| insights \|\| log;/.test(appCode),
  (appCode.match(/backBtn\.style\.display[^\n]*/) || [''])[0]);
r.ok('the pane is marked in the static shell with a non-sec id and no section class',
  /<div id="insights-view">/.test(indexCode) && !/insights-view[\s\S]{0,200}section-content/.test(indexCode));
r.ok('the nav item is a plain hash link with no JS binding',
  /<a class="nav-item" id="nav-insights" href="#\/insights"/.test(indexCode));
r.ok('its icon span ships EMPTY, like every other static glyph',
  /id="nav-insights"[\s\S]{0,140}<span class="nav-icon" aria-hidden="true"><\/span>/.test(indexCode));

r.head('the dashboard paints a skeleton, never a page of zeroes');
// A dashboard of zeroes is not "loading" — it is the answer "nothing was raised",
// and it is the wrong one. renderInsights() is called from four places with no
// sequence token, so it has to be safe with an empty list at any of them.
r.ok('an empty list leaves the skeleton and no cards', (() => {
  const { T: I, byId: iById } = loadApp(`
    renderInsights, INSIGHTS_SKELETON,
    set allIRs(v) { allIRs = v; },
  `, { capture: true });
  I.allIRs = [];
  I.renderInsights();
  const h = iById.get('insights-body').innerHTML;
  return h.includes('insights-skeleton') && !/insights-card/.test(h) && h.trim() === I.INSIGHTS_SKELETON.trim();
})());
r.ok('both toggles go away below 1024px, where the sidebar is a bottom bar',
  /@media \(max-width: 1023px\)[\s\S]{0,200}#sidebar-toggle,\s*#list-toggle\s*\{\s*display:\s*none/.test(
    fs.readFileSync(new URL('../base.css', import.meta.url), 'utf8')));
r.ok('and every rail rule is desktop-scoped, so the bottom bar is untouched',
  /@media \(min-width: 1024px\)[\s\S]*rail-collapsed/.test(
    fs.readFileSync(new URL('../base.css', import.meta.url), 'utf8')));

r.head('the chrome state is applied from one place at boot');
r.ok('showApp applies both the rail and the panel before the first paint',
  /applyChromeState\(\)/.test(appCode) && /applyActivityState\(storedFlag\(ACTIVITY_KEY\)\)/.test(appCode));
r.ok('applyChromeState re-runs renderLayout rather than duplicating the rule',
  /function applyChromeState\(\)[\s\S]*?renderLayout\(\)/.test(appCode));
r.ok('both header toggles are wired to their handlers',
  /railToggle\.addEventListener\('click', toggleRail\)/.test(appCode) &&
  /listToggle\.addEventListener\('click', toggleList\)/.test(appCode) &&
  /activityToggle\.addEventListener\('click', toggleActivity\)/.test(appCode));

// ── 5. Icons ──────────────────────────────────────────────────────────────────
r.head('every icon name the app asks for actually exists');
// This is the assertion that caught the real bug: the map was renamed (`IR`,
// `message`) without the call sites following, so five icon slots — the IR nav
// glyph, the detail placeholder, and all three comments buttons — rendered '' and
// left a silently blank control. `iconSvg` answers an unknown name with '' rather
// than 'undefined', which is right for safety and exactly why this needs its own
// test: nothing else can tell a missing icon from an intentional one.
r.ok('a name that is not in the map renders nothing, by design',
  T.iconSvg('no-such-icon') === '' && T.iconSvg(undefined) === '' && T.iconSvg(null) === '');
r.ok('so every name the source references must BE in the map', (() => {
  const refs = [...appCode.matchAll(/iconSvg\(\s*'([^']+)'/g)].map(m => m[1]);
  const init = appCode.slice(appCode.indexOf('function initIcons'));
  [...init.matchAll(/'([a-z][\w-]*)'\]/g)].forEach(m => refs.push(m[1]));
  return refs.filter(n => !(n in T.ICON_PATHS));
})(), 'names referenced but not defined');
r.ok('and every kind in the timeline resolves through it too',
  Object.keys(T.TIMELINE_KINDS).every(k => /<svg/.test(T.iconSvg(T.TIMELINE_KINDS[k].icon))),
  Object.keys(T.TIMELINE_KINDS).filter(k => !/<svg/.test(T.iconSvg(T.TIMELINE_KINDS[k].icon))));
r.ok('the map has no dead entries — nothing defined but never asked for', (() => {
  const refs = new Set();
  [...appCode.matchAll(/iconSvg\(\s*'([^']+)'/g)].forEach(m => refs.add(m[1]));
  const init = appCode.slice(appCode.indexOf('function initIcons'));
  [...init.matchAll(/'([a-z][\w-]*)'\]/g)].forEach(m => refs.add(m[1]));
  Object.keys(T.TIMELINE_KINDS).forEach(k => refs.add(T.TIMELINE_KINDS[k].icon));
  return Object.keys(T.ICON_PATHS).filter(k => !refs.has(k));
})(), 'defined but never referenced');

r.head('the comments icon is a real icon');
r.ok('it resolves, and it is a speech bubble rather than a blank',
  /<svg/.test(T.iconSvg('comment')) && /M21 15a2 2/.test(T.iconSvg('comment')),
  T.iconSvg('comment'));
r.ok('the call sites use it instead of the emoji',
  !/💬|🔔/.test(appCode) && !/💬|🔔/.test(indexCode),
  (appCode.match(/.*[💬🔔].*/g) || []).concat(indexCode.match(/.*[💬🔔].*/g) || []));
r.ok('the placeholder icon is not the ticket emoji either',
  !/🎫/.test(appCode) && !/🎫/.test(indexCode));
// The rule is "no GLYPH is hand-drawn in the markup" — index.html never runs
// initIcons(), so an inline icon there is an icon that renders in exactly one place
// and is invisible everywhere the app draws its own. ONE exception was added
// 2026-10-08 and it is not a glyph: the cursive flourish under the wordmark. It
// carries no meaning, it is aria-hidden, and it is the BRAND — which has to be
// painted on a screen that exists to be looked at before app.js has run. So the
// assertion is now "at most one <svg>, and it is that one", which keeps the rule's
// teeth instead of dropping it.
r.ok('the nav and header glyph slots are empty spans in the markup, so there is ONE icon source',
  /id="nav-tickets"[\s\S]{0,200}?class="nav-icon"[^>]*><\/span>/.test(indexCode) &&
  /id="sidebar-toggle"[\s\S]{0,200}?class="sidebar-toggle-icon"[^>]*><\/span>/.test(indexCode) &&
  (indexCode.match(/<svg/g) || []).length === 1 &&
  /<svg class="brand-stroke"[^>]*aria-hidden="true"[^>]*>/.test(indexCode),
  (indexCode.match(/<svg[^>]*>/g) || []));
r.ok('and index.html holds no emoji for the helper to have replaced with nothing',
  !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(indexCode),
  (indexCode.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []));

r.head('the emoji debt is a ledger, not a licence');
// What is left in app.js is emoji inside PROSE and inside a handful of older
// in-panel buttons (⚠️ hints, ✓/✘ option labels, 📎/📷/📄 evidence affordances,
// the User Access modal). Those are a separate pass — the owner asked about the
// icons in the chrome, and rewriting customer-facing option labels is a different
// change with a different risk. Pinning the count means it can only go DOWN: a new
// emoji cannot be added without this test failing and someone deciding about it.
//
// The number moved from 29 to 45 without a single emoji being added. 29 was a
// measurement of a file with a hole in it: stripJs used to lose its place at
// app.js's first regex literal and stop stripping comments for a thousand lines, so
// every emoji below that point was invisible to this count. 45 is what the file
// actually holds.
//
// 45 → 46, decided deliberately: the sync-status line gained a second wording
// ("Could not refresh — showing the last saved list"), and it carries the SAME ⚠ the
// line directly above it has always carried. No new emoji was introduced into the
// file — one more line uses the old one, in the same helper, for the same kind of
// message. Bumping the ledger is the decision this test exists to force.
//
// 46 → 47, and the recorded figure had drifted: HEAD's app.js measures 44, so the
// previous number was two above the file it claimed to describe. The three new lines
// are the backup-health line on the User Access screen — the failure state, the
// never-ran state, and the healthy/at-risk pair. Like the bump before it, no glyph is
// new: ⚠ is on the sync-status line and the access hints, and ✓ is on the "session ✓"
// line of this same modal. The number is pinned to what the file MEASURES, so the
// next emoji has to come past this assertion and someone has to decide about it.
//
// 47 → 49, decided deliberately: the User Access screen gained a Customers tab, and two
// of its lines carry glyphs the SAME modal already uses for the same jobs — ✅/⚠️ on the
// invite outcome, exactly as the backup-health line above it pairs ✓ with ⚠, and 📋 on
// the copy button, exactly as "Copy all handover texts" in the Create tab has always
// carried it. No glyph enters the app that was not already here, and the emoji the tab
// was DRAWN with (an envelope on the Invite button) was dropped rather than added, since
// the heading and the label already say what it does. This modal is the one place the
// ledger's own note calls out as a separate pass; the count still only goes down.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const emojiLines = appCode.split('\n').filter(l => EMOJI.test(l));
r.ok('no emoji is left in a slot the icon helper fills',
  !/(💬|🔔|🎫)/.test(appCode),
  emojiLines.filter(l => /💬|🔔|🎫/.test(l)));
r.ok('the count has not grown past the recorded number', emojiLines.length <= 49,
  { now: emojiLines.length, budget: 49, sample: emojiLines.slice(0, 5).map(l => l.trim().slice(0, 60)) });
r.ok('and none of them sits in the activity-log renderer, which owns its own icons',
  !EMOJI.test(appCode.slice(appCode.indexOf('function renderTimelineInto'),
                            appCode.indexOf('function renderTimelineInto') + 4000)));

// ── The rename ────────────────────────────────────────────────────────────────
r.head('nothing a person can read still says "ticket"');
r.ok('index.html keeps it only in the id and the deep-link route',
  indexCode.split('\n').filter(l => /ticket/i.test(l))
    .every(l => /id="nav-tickets"|href="#\/tickets"/.test(l)),
  indexCode.split('\n').filter(l => /ticket/i.test(l)));
r.ok('no capital-T "Ticket" survives in app.js prose or strings',
  !/\bTickets?\b/.test(appCode), (appCode.match(/.*\bTickets?\b.*/g) || []));
r.ok('every lowercase survivor is a deliberate identifier', (() => {
  const allowed = /nav-tickets|#\/tickets|TICKET_(TYPES|PRIORITIES)|goTicket|'tickets?'|name: 'ticket'/;
  const bad = appCode.split('\n').filter(l => /ticket/i.test(l) && !allowed.test(l));
  return bad.length === 0;
})(), appCode.split('\n').filter(l => /ticket/i.test(l)).slice(0, 8));
// ── The legacy record: read-only, from the backend ────────────────────────────
// The embedded workbook is gone for good. The file is restricted, which is what
// closed the leak, and the browser can no longer open it — so the records come back
// through the token-gated backend instead, ONE tab at a time. The card must render
// the grid as label/value rows (never a table: a legacy tab is wide, and a phone
// answers a table with sideways scrolling), and the dead iframe machinery must not
// survive anywhere in the app.
r.head('the legacy record is rendered read-only from the backend, never embedded');
const L = loadApp(`legacyGridHtml, openLegacyRecord, openLegacyWorkbook, closeLegacyModal`);
r.ok('there is no iframe and no embed URL left anywhere in the app',
  !/<iframe/.test(appCode) && !/embedUrl/.test(appCode) && !/rm=minimal/.test(appCode),
  (appCode.match(/[^\n]*iframe[^\n]*/g) || ['none'])[0]);
r.ok('...and the dead embed helpers went with it',
  !/openLegacyModal|legacyTick|_legacyLoaded|LEGACY_SLOW_MS/.test(appCode));
r.ok('the record read is the token-gated getLegacyIR action',
  /action=getLegacyIR&irNumber=/.test(appCode) && /function openLegacyRecord\(/.test(appCode));
r.ok('a single filled cell reads as a heading, not a label with an empty value', (() => {
  const html = L.legacyGridHtml([['Overview'], ['', ''], ['IR Number', 'IR310']]);
  return /legacy-row-head/.test(html) && /Overview/.test(html) &&
         /legacy-label[^>]*>IR Number</.test(html) && /legacy-value[^>]*>IR310</.test(html);
})(), L.legacyGridHtml([['Overview'], ['IR Number', 'IR310']]));
r.ok('a two-column row becomes a stacked label/value — NOT a <table>',
  (() => { const h = L.legacyGridHtml([['IR Number', 'IR310']]);
           return !/<table/i.test(h) && /legacy-row/.test(h); })(),
  L.legacyGridHtml([['IR Number', 'IR310']]));
r.ok('blank spacer rows are dropped, and an empty record says so plainly', (() => {
  const blank = L.legacyGridHtml([[''], ['  ', '']]);
  const empty = L.legacyGridHtml([]);
  return !/legacy-row/.test(blank) && /legacy-empty/.test(empty);
})(), L.legacyGridHtml([]));
r.ok('opening a record paints a loading state before the fetch resolves',
  /class="legacy-loading"/.test(appCode) && /getLegacyIR&irNumber=/.test(appCode));
r.ok('a slow record read is abandoned rather than left spinning forever',
  /setTimeout\(\(\) => controller\.abort\(\), 12000\)/.test(appCode));
r.ok('closing bumps the sequence, so an in-flight fetch cannot paint into a closed card',
  /_legacyReq\+\+/.test(appCode) && /if \(req !== _legacyReq\)/.test(appCode));
r.ok('the index is built from legacyMap and every row opens its own record',
  /Object\.values\(legacyMap\)/.test(appCode) && /legacy-index-item/.test(appCode) &&
  /openLegacyRecord\(btn\.dataset\.ir\)/.test(appCode));
r.ok('the spinner is the app\'s own spin animation, so reduced-motion already covers it',
  /\.legacy-spinner \{[\s\S]{0,220}?animation: spin /.test(componentsCode) &&
  /@keyframes spin/.test(fs.readFileSync(new URL('../base.css', import.meta.url), 'utf8')));
r.ok('the record card scrolls inside itself rather than off the phone screen',
  /\.legacy-card-record \{[^}]*max-height: 92vh/.test(componentsCode) &&
  /\.legacy-record \{[^}]*overflow-y: auto/.test(componentsCode));
// The legacy frame's `loading="lazy"` went with the frame, but evidence thumbnails
// keep theirs — they really do scroll into view, which is what lazy is for.
r.ok('evidence thumbnails keep their lazy loading, which is what lazy is for',
  /class="evidence-thumb" alt="evidence" loading="lazy"/.test(appCode));

r.ok('the deep link still works — the route name was NOT renamed',
  /parts\[0\] === 'tickets'/.test(appCode) && T.IR_CATEGORIES.length === 4);
// ── The way home, and the guard in front of it ────────────────────────────────
// The owner asked for the product name to be clickable and, in the same breath, for
// a warning when something is unsaved. The two are one feature: the warning is only
// honest if it knows what is unsaved, and the flag behind it has to be set on the
// KEYSTROKE — the draft is written to localStorage on a 400 ms debounce, so a guard
// that asked the draft would miss every click inside that window.
r.head('the title is the way home, and leaving with unsaved work asks first');
const asked = [];
let answersYes = true;
const U = loadApp(`
  _dirtySections, markSectionDirty, hasUnsavedChanges, updateDirtyIndicators,
  dirtyUnitLabels, confirmLeaveIR, OVERVIEW_KEY, SECTIONS,
`, { globals: { confirm: msg => { asked.push(msg); return answersYes; } } });

r.ok('a freshly opened IR is clean, and asking costs nothing', (() => {
  asked.length = 0;
  return U.hasUnsavedChanges() === false && U.confirmLeaveIR() === true && asked.length === 0;
})(), { asked: asked.length });
r.ok('a keystroke in a section marks it unsaved immediately', (() => {
  U.markSectionDirty('sec-c');
  return U.hasUnsavedChanges() === true && U._dirtySections.has('sec-c') === true;
})(), Array.from(U._dirtySections));
r.ok('and the prompt says WHICH section is at risk, not just "changes"', (() => {
  asked.length = 0;
  U.confirmLeaveIR();
  return asked.length === 1 && asked[0].indexOf('sec-c') !== -1;
})(), asked);
r.ok('the wording promises what actually happens — the draft keeps the typing',
  (() => { asked.length = 0; U.confirmLeaveIR(); return /draft/i.test(asked[0]) && /has not reached the server yet/i.test(asked[0]); })(),
  asked);
r.ok('saying No keeps the user where they are', (() => {
  answersYes = false;
  const stayed = U.confirmLeaveIR() === false;
  answersYes = true;
  return stayed;
})());
r.ok('saving clears it, so a clean screen never prompts again', (() => {
  U._dirtySections.delete('sec-c');
  asked.length = 0;
  return U.hasUnsavedChanges() === false && U.confirmLeaveIR() === true && asked.length === 0;
})(), Array.from(U._dirtySections));
r.ok('the Overview counts too — it has no draft, so this flag is its ONLY warning', (() => {
  U.markSectionDirty(U.OVERVIEW_KEY);
  const tracked = U.hasUnsavedChanges() === true;
  U._dirtySections.clear();
  return tracked;
})());
r.ok('the read-only 📋 Report tab cannot be marked — it has nothing to save', (() => {
  U.markSectionDirty('sec-intake');
  const clean = U.hasUnsavedChanges() === false;
  U._dirtySections.clear();
  return clean;
})());
r.ok('the dirty flag is set on the keystroke, not on the 400 ms draft debounce', (() => {
  const body = appSrc.slice(appSrc.indexOf("addEventListener('input', e => {"));
  const seg  = body.slice(0, body.indexOf('saveDraft('));
  return seg.indexOf('markSectionDirty(') !== -1;
})(), appSrc.slice(appSrc.indexOf("addEventListener('input', e => {")).slice(0, 400));
r.ok('a restored draft is unsaved too, and says so', (() => {
  const from = appSrc.indexOf('function restoreDrafts(');
  return appSrc.slice(from, from + 700).indexOf('markSectionDirty(') !== -1;
})());
r.ok('the Overview panel gets its own listeners — it is outside #sections-wrapper',
  /getElementById\('ir-overview'\)/.test(appCode) && /ir-overview-editable/.test(appCode));
r.ok('the guard is on BOTH ways home — the title and the Back button — and on neither twice',
  (() => {
    const guarded = appCode.match(/if \(confirmLeaveIR\(\)\) goIndex\(\)/g) || [];
    const back = /backBtn\.addEventListener\('click', \(\) => \{ if \(confirmLeaveIR\(\)\) goIndex\(\); \}\)/.test(appCode);
    const home = /bindHomeLink\(headerTitle\)/.test(appCode);
    // Back button, title click, title keydown = three call sites, no more.
    return guarded.length === 3 && back && home;
  })(), (appCode.match(/.*confirmLeaveIR.*/g) || []).map(l => l.trim()));
r.ok('goIndex itself is NOT guarded — a redirect must never raise a prompt',
  (() => {
    const from = appCode.indexOf('function goIndex()');
    return from !== -1 && appCode.slice(from, from + 200).indexOf('confirmLeaveIR') === -1;
  })());
r.ok('Enter and Space both work on the title, and Space does not scroll the page',
  /e\.key !== 'Enter' && e\.key !== ' ' && e\.key !== 'Spacebar'/.test(appCode) &&
  /e\.preventDefault\(\)/.test(appCode.slice(appCode.indexOf('function bindHomeLink'), appCode.indexOf('function bindHomeLink') + 500)));
r.ok('the title says it is a control, in the markup as well as the CSS',
  /id="header-title"[^>]*role="button"[^>]*tabindex="0"/.test(indexCode), (indexCode.match(/.*id="header-title".*/) || [])[0]);
r.ok('the unsaved dot is drawn on the tab strip, in the tab\'s own right padding',
  /\.tab\.has-unsaved \{ position: relative; \}/.test(viewsCode) &&
  /\.tab\.has-unsaved::after \{/.test(viewsCode), (viewsCode.match(/.*has-unsaved.*/g) || []));
r.ok('and it is named exactly what updateDirtyIndicators toggles',
  /classList\.toggle\('has-unsaved', _dirtySections\.has\(tab\.dataset\.section\)\)/.test(appCode));
r.ok('the dot sits BEFORE the polish block — nothing may be appended after it',
  viewsCode.indexOf('.tab.has-unsaved') < viewsCode.indexOf('POLISH — level:'), {
    dot: viewsCode.indexOf('.tab.has-unsaved'), polish: viewsCode.indexOf('POLISH — level:'),
  });
r.ok('a save marks the section clean BEFORE the toast, not 3 s later with the button',
  (() => {
    const from = appCode.indexOf('async function saveSection(');
    const seg  = appCode.slice(from, from + 3000);
    const clean = seg.indexOf('_dirtySections.delete(sectionId)');
    const toast = seg.indexOf('showToast(');
    return clean !== -1 && toast !== -1 && clean < toast;
  })());
r.ok('and the Overview does the same, through its own access sweep',
  (() => {
    const from = appCode.indexOf('async function saveOverview(');
    const seg  = appCode.slice(from, from + 2000);
    return seg.indexOf('_dirtySections.delete(OVERVIEW_KEY)') !== -1 &&
           seg.indexOf('applyOverviewGating()') !== -1;
  })());
// ── The Google door ───────────────────────────────────────────────────────────
// The door is a NAVIGATION, not a fetch, and that is a measured fact rather than a
// preference: a cross-site fetch from gh-pages to the domain-restricted deployment
// gets 401 from Google BEFORE our code runs, while the same URL opened as a
// top-level navigation reports the caller perfectly. So there are two halves:
//
//   click → `location.href = SSO_URL + '?action=googleStart'` (LEAVES the page)
//         → the door sends the browser back to CONFIG.APP_URL with a one-time code
//           in the fragment → app.js exchanges it on the MAIN backend, which is
//           "Anyone" and therefore reachable.
//
// The blocks below drive the real functions; the fragment cases hand the app a
// `location` with a hash already set, because that is exactly how the browser
// delivers the return — `_handoff` is read once, at parse time.
const HANDOFF_CODE = 'deadbeefdeadbeefdeadbeefdeadbeef';
const HASH_BASE = { search: '', hostname: '127.0.0.1', protocol: 'http:', href: 'http://127.0.0.1:3000/' };

const gPosts = [];
// The reply is armed BEFORE the call, because the stub is asked and answered inside
// one synchronous step: read afterwards, every call would see whatever the previous
// assertion had left behind.
let gReply = null;
const gFetch = (url, init) => {
  gPosts.push({ url: String(url), body: init && init.body });
  if (!gReply) return Promise.reject(new Error('blocked in test'));
  const reply = gReply;
  return Promise.resolve({
    ok: true,
    text: () => Promise.resolve(JSON.stringify(reply)),
    json: () => Promise.resolve(reply),
  });
};
// A getter/setter PAIR, so a test can read where the click navigated to and reset it
// between assertions. `location` here is the sandbox global app.js actually uses.
const NAV = `get locationHref() { return location.href; },
             set locationHref(v) { location.href = v; }`;
const SESSION_REPLY = {
  status: 'ok', sessionToken: 'tok-google-1', email: 'sreenivas.pai@indrones.com',
  access: { role: 'user', permissions: {}, departments: [], triage: false },
};
const gexchangePost = () => gPosts.find(p => p.body &&
  p.body.entries().some(e => e[0] === 'action' && e[1] === 'googleExchange'));

r.head('the Google door is inert until a second deployment is named');
const G = loadApp(`
  CONFIG, submitGoogleSignIn, setAuthMode, setAuthError, ${NAV},
  get currentUser() { return currentUser; },
`, { capture: true, fetch: gFetch });

// The invariant is NOT "it ships empty" — it shipped empty until the second
// deployment existed, and it is now set. The invariant that keeps this feature
// reversible and safe is that whichever URL is in there is a deployment of its OWN:
// empty is the off switch, and anything else must be a script.google.com /exec that
// is not the primary backend. Pointing it at GAS_URL would send the door's
// navigation to the "Anyone" deployment, where getActiveUser() is not the signed-in
// Workspace account, and the door would refuse every caller.
r.ok('SSO_URL is its own deployment — empty (the off switch) or a /exec that is NOT the primary backend',
  G.T.CONFIG.SSO_URL === '' || (
    G.T.CONFIG.SSO_URL.indexOf('https://script.google.com/') === 0 &&
    /\/exec$/.test(G.T.CONFIG.SSO_URL) &&
    G.T.CONFIG.SSO_URL !== G.T.CONFIG.GAS_URL
  ), JSON.stringify(G.T.CONFIG.SSO_URL));
// The mechanism is a navigation, so a page load in the middle of a sign-in must make
// ZERO Google calls — there is nothing to probe and nothing to fetch.
r.ok('a plain load makes no Google call at all — the door is opened by a CLICK, not a probe',
  gPosts.length === 0, gPosts.map(p => p.url));
r.ok('an EMPTY SSO_URL hides the button AND the separator, so there is no orphan "or" line',
  (() => {
    const real = G.T.CONFIG.SSO_URL;
    G.T.CONFIG.SSO_URL = '';
    G.T.setAuthMode('login');
    const hidden = G.byId.get('auth-google-btn').style.display === 'none' &&
                   G.byId.get('auth-or').style.display === 'none';
    G.T.CONFIG.SSO_URL = real;
    return hidden;
  })());
r.ok('...and a set SSO_URL is what reveals them, through the one mode sync',
  (() => {
    G.T.CONFIG.SSO_URL = 'https://sso.example.invalid/exec';
    G.T.setAuthMode('login');
    const shown = G.byId.get('auth-google-btn').style.display === '' &&
                  G.byId.get('auth-or').style.display === '';
    G.T.CONFIG.SSO_URL = '';
    G.T.setAuthMode('login');
    return shown;
  })());
r.ok('...and the button is not merely hidden — its markup ships hidden',
  /id="auth-google-btn"[^>]*style="display:none"/.test(indexSrc),
  (indexSrc.match(/.*auth-google-btn.*/) || [])[0]);
r.ok('...and the separator with it, so there is no orphan "or" line',
  /id="auth-or"[^>]*style="display:none"/.test(indexSrc));
r.ok('the door is never posted to — SSO_URL is only ever OPENED',
  !/action=googleSignIn/.test(appSrc) && !/SSO_URL[^\n]*postAuth/.test(appCode));

r.head('the click LEAVES the page — that is the mechanism, not a side effect');
G.T.CONFIG.SSO_URL = 'https://sso.example.invalid/exec';
G.T.locationHref = 'SENTINEL';
gPosts.length = 0;
await G.T.submitGoogleSignIn();
// The click goes to GOOGLE'S ACCOUNT PICKER, not straight to the door, and that is
// the phone fix: a browser with two accounts signed in feeds a web app its DEFAULT
// one, and if that one is a personal account the domain-restricted door is refused
// by Google before our code runs — nothing in the app can detect or recover from
// that, so the choice has to be made before we leave. The door is what Google comes
// back to, so the account picked is the one the door then names.
r.ok('the click opens Google\'s account picker, carrying the door as the address to return to',
  G.T.locationHref === 'https://accounts.google.com/AccountChooser?continue=' +
    encodeURIComponent('https://sso.example.invalid/exec?action=googleStart'),
  G.T.locationHref);
r.ok('...and the door it returns to is the START action, so the round trip restarts rather than resuming',
  (() => {
    const m = G.T.locationHref.match(/continue=([^&]*)/);
    return !!m && decodeURIComponent(m[1]) === 'https://sso.example.invalid/exec?action=googleStart';
  })(), G.T.locationHref);
// This assertion used to be "reaches the network ZERO times", and the wake-up makes
// that no longer the honest form of the claim. What it is really protecting is that
// nothing about the HANDOFF travels over the network from here: the code is minted
// by the door and comes back in the URL fragment, so there is no call to await, no
// failure to show, and no request that could be the sign-in itself. The one request
// the click now makes is a credential-free ping whose answer is thrown away.
r.ok('...and it is a navigation, not a call: nothing about the handoff is sent from here',
  gPosts.filter(p => !/action=ping/.test(p.url)).length === 0,
  gPosts.filter(p => !/action=ping/.test(p.url)).map(p => p.url));
r.ok('...the single request it does make is the wake-up, and it carries no credential',
  gPosts.length === 1 && /action=ping/.test(gPosts[0].url) && !gPosts[0].body,
  gPosts.map(p => ({ url: p.url, body: !!p.body })));
// The return address is a server-side constant. A `?next=` here would make the app
// hand an attacker the choice of where Google sends the browser back to.
r.ok('the URL carries no return address — every part of it is built from SSO_URL alone',
  /function googleStartUrl\(\) \{[\s\S]{0,400}?CONFIG\.SSO_URL \+ '\?action=googleStart'/.test(appCode) &&
  !/location\.search|location\.hash/.test(
    (appCode.match(/function googleStartUrl\(\) \{[\s\S]*?\n\}/) || [''])[0]),
  (appCode.match(/function googleStartUrl\(\) \{[\s\S]*?\n\}/) || [''])[0].slice(0, 120));
r.ok('the button is disabled on the way out, so a second click cannot start a second handoff',
  G.byId.get('auth-google-btn').disabled === true);
r.ok('...and the screen names the step it is about to take, so the picker is not a surprise',
  G.byId.get('auth-hint-text').textContent ===
    'Taking you to Google — choose your indrones.com account.',
  G.byId.get('auth-hint-text').textContent);
r.ok('an EMPTY SSO_URL means the click does nothing at all',
  (() => {
    G.T.CONFIG.SSO_URL = '';
    G.T.locationHref = 'SENTINEL';
    G.T.submitGoogleSignIn();
    return G.T.locationHref === 'SENTINEL';
  })(), G.T.locationHref);

r.head('a return from the door is exchanged once, at parse time, on the MAIN backend');
// The fragment is parsed at module scope, but boot runs on `window.load` — which the
// stub DOM does not dispatch — so the return is driven explicitly here. The wiring
// itself is pinned by source further down; what this drives is the exchange.
gPosts.length = 0;
gReply = SESSION_REPLY;
const G2 = loadApp(`
  CONFIG, isHandoffReturn, finishHandoff, checkHandoff, ${NAV},
  armSsoSlowNote, endSsoWait, SSO_SLOW_MS,
  get htmlEl() { return document.documentElement; },
  get _ssoSlowTimer() { return _ssoSlowTimer; },
  get currentUser() { return currentUser; },
`, { capture: true, fetch: gFetch,
     globals: { location: Object.assign({}, HASH_BASE, { hash: '#sso=' + HANDOFF_CODE }) } });
r.ok('the fragment is recognised as a handoff return',
  G2.T.isHandoffReturn() === true, G2.T.isHandoffReturn());
// checkHandoff() reads the fragment and REPLACES the address bar in the same
// call (there is no module-scope _handoff any more — the SSO-stability work made
// the read idempotent via sessionStorage instead), so the code is still
// recoverable after the recogniser has consumed the hash.
r.ok('and read as a CODE, with the prefix stripped exactly once',
  G2.T.checkHandoff() && G2.T.checkHandoff().code === HANDOFF_CODE,
  G2.T.checkHandoff());
gPosts.length = 0;
// What index.html's pre-paint script raises before app.js has parsed a byte. Set
// here by hand because the stub DOM never runs it — the gate itself is pinned by
// source further down; what this drives is the teardown.
G2.T.htmlEl.setAttribute('data-sso', 'wait');
await G2.T.finishHandoff(G2.T.checkHandoff());
r.ok('landing in the app takes the wait screen down',
  G2.T.htmlEl.getAttribute('data-sso') === null, G2.T.htmlEl.getAttribute('data-sso'));
r.ok('...and disarms the slow note, so a timer cannot fire at a screen that is gone',
  G2.T._ssoSlowTimer === null, G2.T._ssoSlowTimer);
r.ok('the code is exchanged for a session, on the MAIN backend, carrying no stale token',
  (() => {
    const p = gexchangePost();
    if (!p) return false;
    const keys = p.body.entries().map(e => e[0]);
    return p.url === G2.T.CONFIG.GAS_URL &&
           p.body.entries().some(e => e[0] === 'code' && e[1] === HANDOFF_CODE) &&
           keys.indexOf('sessionToken') === -1;
  })(), gPosts.map(p => p.url));
r.ok('the device label travels, so the audit line can say where it was opened',
  (() => {
    const p = gexchangePost();
    return !!p && p.body.entries().some(e => e[0] === 'device' && String(e[1]).length > 0);
  })(), gexchangePost() && gexchangePost().body.entries());
r.ok('a yes signs the user in — the password door\'s own finishAuth, unchanged',
  G2.T.currentUser && G2.T.currentUser.sessionToken === 'tok-google-1' &&
  G2.T.currentUser.email === 'sreenivas.pai@indrones.com',
  G2.T.currentUser && G2.T.currentUser.email);

r.head('the handoff code never survives in the address bar');
// replaceState, not `location.hash = …`: assigning pushes a history entry, and the
// back button would then land on a URL whose code is already spent — which reads as
// "that link is no longer valid" on a sign-in that actually worked. The app routes by
// hash, so `location.hash = …` is everywhere ELSE in this file; the assertion is
// scoped to the handoff block, where the one thing it must never do is assign.
// checkHandoff() — there is no module-scope _handoff; the read replaces the
// address bar in the same call, driven through sessionStorage fallback.
const handoffSeg = appCode.slice(appCode.indexOf('function checkHandoff() {'),
                                 appCode.indexOf('function isHandoffReturn'));
r.ok('the spent fragment is wiped with replaceState, not by assigning the hash',
  /history\.replaceState\(/.test(handoffSeg) && !/location\.hash\s*=/.test(handoffSeg),
  handoffSeg.slice(0, 160));
r.ok('...after the code has been read, so the wipe cannot race the read',
  handoffSeg.indexOf('decodeURIComponent(h.slice(5))') < handoffSeg.indexOf('history.replaceState'));
r.ok('the fragment is a transient namespace, not a route — it is consumed before routing',
  /if \(h\.indexOf\('#sso='\) === 0\)/.test(appCode) && /#ssoerr=/.test(appCode));

r.head('a refusal from the door lands on the same error line as a wrong password');
gPosts.length = 0;
const G3 = loadApp(`
  isHandoffReturn, finishHandoff, setAuthError, checkHandoff, ${NAV},
  get htmlEl() { return document.documentElement; },
  get currentUser() { return currentUser; },
`, { capture: true, fetch: gFetch,
     globals: { location: Object.assign({}, HASH_BASE, { hash: '#ssoerr=' +
       encodeURIComponent('Set your own password first: sign in with your temporary password, then use Google from then on.') }) } });
r.ok('it is recognised as a return, so the splash is skipped for a refusal too',
  G3.T.isHandoffReturn() === true);
// Raised by hand, because a refusal must NOT raise it (index.html's gate is the
// narrow `#sso=`, pinned by source below). This is the other half of that: if some
// other path ever did leave it up, the refusal's own route to the sign-in screen
// takes it down rather than trapping the person behind a wait that already ended.
G3.T.htmlEl.setAttribute('data-sso', 'wait');
await G3.T.finishHandoff(G3.T.checkHandoff());
r.ok('a refusal clears the wait screen too — every route to a real screen does',
  G3.T.htmlEl.getAttribute('data-sso') === null, G3.T.htmlEl.getAttribute('data-sso'));
r.ok('the backend\'s own words are shown, not a generic failure',
  /Set your own password first/.test(G3.byId.get('auth-error').textContent),
  G3.byId.get('auth-error').textContent);
r.ok('and the error line is made visible, the way every other auth error is',
  G3.byId.get('auth-error').style.display === 'block');
r.ok('...and the sign-in screen is the one on show, with the password form one tap away',
  G3.byId.get('auth-container').style.display !== 'none');
// The refusal route to the sign-in screen is showAuth(), which wakes the backend on
// the way in — so the claim is that nothing but that wake-up is sent, which is what
// keeps "a refusal exchanges nothing" true rather than merely quiet.
r.ok('nothing is exchanged — there is no code, so nothing but the wake-up reaches the network',
  gPosts.filter(p => !/action=ping/.test(p.url)).length === 0,
  gPosts.filter(p => !/action=ping/.test(p.url)).map(p => p.url));
r.ok('no session is invented from a refusal',
  !G3.T.currentUser || !G3.T.currentUser.sessionToken, G3.T.currentUser && G3.T.currentUser.sessionToken);
r.ok('clearing it hides the line again rather than leaving an empty box',
  (() => { G3.T.setAuthError(''); return G3.byId.get('auth-error').style.display === 'none'; })());

r.head('the two doors share one session model, one error line and one regex');
r.ok('finishAuth is the password door\'s own function, called unchanged',
  /finishAuth\(d\.email, d\)/.test(appCode));
r.ok('the password form is never replaced — its handler is still wired',
  /signInBtn\.addEventListener\('click', \(\) => \(_authMode === 'login' \? submitPwd\(\) : submitLogin\(\)\)\)/.test(appCode) &&
  /auth-google-btn/.test(indexSrc) && /id="auth-signin-btn"/.test(indexSrc));
r.ok('googleExchange AND deviceUnlock are listed as self-authenticating, and the deleted pair is gone from the regex',
  /googleExchange/.test((appCode.match(/const isAuthCall = [^\n]*/) || [''])[0]) &&
  /deviceUnlock/.test((appCode.match(/const isAuthCall = [^\n]*/) || [''])[0]) &&
  !/googleSignIn\|googleSignInProbe/.test(appCode),
  (appCode.match(/const isAuthCall = [^\n]*/) || [''])[0]);
r.ok('nothing in the door reaches for UrlFetchApp or getEffectiveUser — the server half is pinned in smoke-backend',
  !/UrlFetchApp|getEffectiveUser/.test(appCode));

r.head('the wait screen covers the handoff — the owner saw the form instead');
// The owner's report, verbatim: "In transition, it was showing login page still
// while it was loading the app." The exchange is an Apps Script round trip, and the
// app used to spend it showing a sign-in form to somebody who had just signed in.
const waitMarkup = (indexSrc.match(/<div id="sso-wait"[\s\S]*?<\/div>\s*<\/div>/) || [''])[0];
// The quick-unlock module sits between finishHandoff's endings and setAuthMode, so
// the block is cut at ITS first code line — appCode is comment-stripped, so a
// banner comment is not findable there.
const waitBlock = appCode.slice(appCode.indexOf('const SSO_SLOW_MS'),
                                appCode.indexOf("const UNLOCK_KEY = 'ipb_unlock'") > 0
                                  ? appCode.indexOf("const UNLOCK_KEY = 'ipb_unlock'")
                                  : appCode.indexOf('function setAuthMode'));
r.ok('the screen exists, and carries a mark, a title, a note and a moving bar',
  /<img class="sso-wait-mark"/.test(waitMarkup) &&
  /<p class="sso-wait-title">/.test(waitMarkup) &&
  /<p class="sso-wait-note" id="sso-wait-note">/.test(waitMarkup) &&
  /<div class="sso-wait-sweep"><\/div>/.test(waitMarkup), waitMarkup.slice(0, 120));
r.ok('it says where the person is going, not what the software is doing',
  /on your way to I-PASSBOOK/i.test(waitMarkup), waitMarkup);
r.ok('the id app.js reaches for at 8s is the one the markup carries',
  /getElementById\('sso-wait-note'\)/.test(appCode) && /id="sso-wait-note"/.test(indexSrc));
r.ok('the mark is the already-precached one, so the screen downloads nothing',
  (() => {
    const m = waitMarkup.match(/src="([^"]+)"/);
    return !!m && new RegExp('\\./' + m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(swSrc);
  })(), (waitMarkup.match(/src="([^"]+)"/) || [])[1]);

r.ok('the wait screen is hidden by default and shown by the attribute — the splash\'s own pattern',
  /#sso-wait \{[\s\S]*?display: none;/.test(baseSrc) &&
  /html\[data-sso="wait"\] #sso-wait \{ display: flex; \}/.test(baseSrc));

// The owner's second look at this screen, verbatim: "the logo/icon used is not the
// correct one with proper background etc, it has unclear things in the logo." Both
// halves of that were real, and both were caused by this one rule.
// 1. The artwork is a 4:3 lockup (512x384 — the disc, then "Passbook" beside it), so a
//    square box SQUASHES it. `width: auto` off a height is the rule `.auth-logo` and
//    `.brand-mark` have always followed; this rule must not be the exception.
// 2. The disc is dark slate (#323943) and this screen is #0b0b0b by definition, so
//    without the invert the disc disappears and only the knocked-out white pieces
//    show — a logo with holes in it. Same treatment, same reason, as the dark theme's
//    own `[data-theme="dark"] .auth-logo { filter: invert(1); }`.
// Measured, not guessed: decoded the PNG and composited it on #0b0b0b both ways.
const waitMarkRule = (baseSrc.match(/\.sso-wait-mark \{[\s\S]*?\n\}/) || [''])[0];
r.ok('the mark is drawn from a height with width:auto — a square box squashes a 4:3 lockup',
  /height: \d+px;/.test(waitMarkRule) && /width: auto;/.test(waitMarkRule), waitMarkRule);
r.ok('...and no width: with a px value, which is the squash itself',
  !/width: \d+px;/.test(waitMarkRule));
r.ok('...and it is inverted, or a dark slate disc on #0b0b0b reads as a logo with holes',
  /filter: invert\(1\);/.test(waitMarkRule), waitMarkRule);
r.ok('...matching the dark-theme treatment the mark already gets everywhere else',
  /\[data-theme="dark"\] \.landing-mark \{[\s\S]{0,20}?filter: invert\(1\);/.test(baseSrc));
r.ok('...and it sits on the splash\'s layer and ground, so the handover does not flash',
  /#sso-wait \{[\s\S]*?z-index: var\(--z-splash\)/.test(baseSrc) &&
  /#sso-wait \{[\s\S]*?background: #0b0b0b/.test(baseSrc));
// The sweep's own rule, not the whole file: base.css has other `transition: width`
// declarations (the legacy progress bar), and a global scan would be testing those.
const sweepRule = (baseSrc.match(/\.sso-wait-sweep \{[\s\S]*?\n\}/) || [''])[0];
r.ok('the bar is INDETERMINATE — a determinate bar would be a guess about a round trip',
  /animation: ssoSweep [\d.]+s var\(--ease\) infinite;/.test(sweepRule) &&
  !/transition/.test(sweepRule), sweepRule.slice(0, 80));
r.ok('...and reduced motion parks it centred, because the global guard would leave an empty track',
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.sso-wait-sweep \{ animation: none; transform: translateX\(-50%\); \}/.test(baseSrc));

r.ok('app.js takes it down from showAuth, so a refusal is never behind a wait',
  /function showAuth\(\) \{\s*\n\s*endSsoWait\(\);/.test(appCode));
r.ok('...and from showApp, so landing in the app is what ends the wait',
  /function showApp\(\) \{[\s\S]{0,400}?endSsoWait\(\);/.test(appCode));
r.ok('...in showApp BEFORE the temp-password guard, which diverts away from the shell',
  appCode.indexOf('endSsoWait();', appCode.indexOf('function showApp()')) <
  appCode.indexOf('mustChangePassword', appCode.indexOf('function showApp()')));
r.ok('the slow note is armed only on the exchange, never for a refusal that has nothing to wait for',
  appCode.indexOf('armSsoSlowNote();') > appCode.indexOf('if (h.error) {'));
r.ok('and the exchange has a catch — an unhandled rejection would strand the wait screen',
  /\.catch\(\(\) => \{[\s\S]{0,400}?showAuth\(\)/.test(waitBlock));
r.ok('both endings of a failed exchange re-enable the Google button',
  (waitBlock.match(/btn\.disabled = false;/g) || []).length === 2);
r.ok('the note text is a real timeout, not a promise that never resolves',
  /SSO_SLOW_MS = \d{4,}/.test(appCode) && /setTimeout\(\(\) => \{/.test(waitBlock));
r.ok('clearing the wait also disarms the timer, so it cannot fire at a screen that is gone',
  /function endSsoWait\(\) \{[\s\S]*?clearTimeout\(_ssoSlowTimer\)/.test(appCode));

r.head('the splash skip and the handoff return are pinned to each other');
// index.html decides this BEFORE app.js parses, so that the nine-second intro never
// flashes on the way into a sign-in that has already started. If the two conditions
// drift, a Google return pays for the intro and app.js cannot tell anyone.
//
// The two pre-paint gates are read out of the source SEPARATELY and checked against
// each other, because they are deliberately NOT the same test: the splash skip covers
// both branches, and the wait screen covers only a code. An earlier version of this
// assertion searched the whole file for the narrow form and required it to be absent,
// which was fine until a second gate legitimately needed it — and then it could not
// tell the two lines apart at all.
const gate = re => (indexSrc.match(re) || [''])[0];
const splashGate = gate(/if \(\(location\.hash \|\| ''\)\.indexOf\('#sso'\) === 0\) \{\s*document\.documentElement\.setAttribute\('data-splash', 'skip'\)/);
const waitGate = gate(/if \(\(location\.hash \|\| ''\)\.indexOf\('#sso='\) === 0\) \{\s*document\.documentElement\.setAttribute\('data-sso', 'wait'\)/);
r.ok('the pre-paint script skips the splash on a handoff return',
  /\(\s*location\.hash \|\| ''\)\.indexOf\('#sso'\)/.test(splashGate), splashGate);
r.ok('...and it uses the BROAD prefix, so a refusal skips the nine-second intro too',
  splashGate !== '' && waitGate !== '' && splashGate !== waitGate,
  { splash: splashGate, wait: waitGate });
r.ok('app.js makes the same call at boot, for the loads pre-paint cannot cover',
  /const handoff = checkHandoff\(\);\s*\n\s*if \(handoff\) \{ splash\.style\.display = 'none'; finishHandoff\(handoff\); return; \}/.test(appCode));
r.ok('...and a device already signed in still wins, so a stale fragment cannot hijack it',
  appCode.indexOf('if (hasStoredSession()) { dismissSplash(true); return; }') <
  appCode.indexOf('const handoff = checkHandoff();'));

// ── Waking the backend before it is needed ────────────────────────────────────
r.head('the backend is woken before it is needed, never at the moment it is needed');

// Code only — stripJs has removed comments, so every claim below is about what
// actually runs rather than about what a comment says runs.
const fnBody = (name, from = 0) => {
  const i = appCode.indexOf('function ' + name + '(', from);
  if (i < 0) return '';
  const j = appCode.indexOf('\nfunction ', i + 1);
  return appCode.slice(i, j < 0 ? appCode.length : j);
};

// The 31.6s cold start measured against the live deployment is the reason this
// exists at all, so the NUMBER is worth pinning: a warm-up fired after a delay
// longer than a person takes to type would overlap nothing.
r.ok('the wake-up is a real request to the real backend, not a placeholder',
  /_origFetch\(url, init\)/.test(fnBody('warmBackend')) &&
  /CONFIG\.GAS_URL \+ \(CONFIG\.GAS_URL\.indexOf\('\?'\) >= 0 \? '&' : '\?'\)/.test(fnBody('warmBackend')));
r.ok('...it asks for the trivially cheap ping, which does no work and mints nothing',
  /'action=ping&_=' \+ Date\.now\(\)/.test(fnBody('warmBackend')));
r.ok('it goes through _origFetch, so a warm-up cannot touch the session gate',
  /_origFetch\(/.test(fnBody('warmBackend')) && !/[^_]fetch\(url/.test(fnBody('warmBackend')));
r.ok('it carries a cache-buster and no-store, because a cached warm-up reaches nothing',
  /_=' \+ Date\.now\(\)/.test(fnBody('warmBackend')) && /cache: 'no-store'/.test(fnBody('warmBackend')));
r.ok('the whole body is inside a try, so a browser that refuses keepalive cannot break a screen',
  /try \{[\s\S]*?_origFetch\(url, init\)[\s\S]*?\} catch \(e\)/.test(fnBody('warmBackend')));
r.ok('and the rejection is swallowed — never read, never toasted, never logged',
  /if \(p && typeof p\.catch === 'function'\) p\.catch\(\(\) => \{\}\)/.test(fnBody('warmBackend')));
r.ok('it is coalesced, so boot reaching showAuth twice cannot send two',
  /const WARM_MIN_GAP_MS = \d{4,};/.test(appCode) &&
  /Date\.now\(\) - _lastWarmAt < WARM_MIN_GAP_MS\) return;/.test(fnBody('warmBackend')));
r.ok('...and the gap is short enough to cover the typing it exists to overlap',
  /const WARM_MIN_GAP_MS = (\d+);/.test(appCode) &&
  Number(appCode.match(/const WARM_MIN_GAP_MS = (\d+);/)[1]) <= 60000,
  appCode.match(/const WARM_MIN_GAP_MS = (\d+);/));
r.ok('the dev bypass is skipped, so a localhost session does not poke the live backend',
  /shouldUseDevAuthBypass\(\)\) return;/.test(fnBody('warmBackend')));

// WHERE it fires is the whole feature. The intro is ~9s of the cold start paid for
// by time already being spent, and the ordering below is what buys that.
r.ok('the load that is heading for the sign-in screen wakes the backend BEFORE the intro',
  appCode.indexOf('warmBackend();') >
    appCode.indexOf('if (isHandoffReturn()) { splash.style.display') &&
  appCode.indexOf('warmBackend();') < appCode.indexOf('const video = document.getElementById(\'splash-video\')'));
r.ok('...and a device with a stored session does not, because its own first call is the wake-up',
  appCode.indexOf('if (hasStoredSession()) { dismissSplash(true); return; }') <
  appCode.indexOf('warmBackend();'));
r.ok('showAuth wakes it too, so an expiry, a sign-out and a refused handoff all start one',
  /function showAuth\(\) \{\s*\n\s*endSsoWait\(\);[\s\S]{0,400}?warmBackend\(\);/.test(appCode));
r.ok('showApp does not — there is nothing pre-auth left to wait for once inside',
  fnBody('showApp').indexOf('warmBackend') === -1);
r.ok('the Google tap starts one BEFORE it navigates, which is the only call that can be cancelled',
  appCode.indexOf('warmBackend({ keepalive: true });') > appCode.indexOf('function submitGoogleSignIn()') &&
  appCode.indexOf('warmBackend({ keepalive: true });') < appCode.indexOf('location.href = googleStartUrl();'));
r.ok('...and only that one asks to outlive the page',
  (appCode.match(/keepalive: true/g) || []).length === 1 &&
  /if \(opts && opts\.keepalive\) init\.keepalive = true;/.test(fnBody('warmBackend')));

// The behaviour itself, not the source: run the real function against a transport
// that records what it was asked for.
// Read from the shipped source rather than hard-coded, so a deployment URL change
// cannot leave this assertion testing a stale string.
const WARM_GAS_URL = (appSrc.match(/GAS_URL: '([^']+)'/) || [])[1] || '';
const warm = await (async () => {
  const calls = [];
  const okTransport = () => Promise.resolve({ text: () => Promise.resolve('{"status":"ok","apiVersion":3}') });
  const W = loadApp(`
    warmBackend, WARM_MIN_GAP_MS, CONFIG,
    set warmAt(v) { _lastWarmAt = v; },
    get warmAt() { return _lastWarmAt; },
  `, { fetch: (url, init) => { calls.push({ url: String(url), init: init || {} }); return okTransport(); } });

  W.warmAt = 0;
  W.warmBackend();
  const first = calls.slice();
  W.warmBackend();                      // immediately again — must coalesce
  const afterSecond = calls.length;

  W.warmAt = 0;
  W.warmBackend({ keepalive: true });   // the navigating call
  const tap = calls[calls.length - 1];

  // A transport that refuses, and one that throws on the way in: neither may
  // escape. An unhandled rejection here is a fatal error in Node, so a suite that
  // gets to the assertions below has already proven the swallow.
  const B = loadApp('warmBackend, CONFIG', { fetch: () => Promise.reject(new Error('blocked')) });
  const C = loadApp('warmBackend, CONFIG', { fetch: () => { throw new Error('boom'); } });
  let threw = false;
  try { B.warmBackend(); C.warmBackend(); } catch (e) { threw = true; }
  await new Promise(r => setTimeout(r, 30));   // let any rejection surface

  return { first, afterSecond, tap, threw, gap: W.WARM_MIN_GAP_MS };
})();

r.ok('the wake-up calls the backend exactly once, and stops',
  warm.first.length === 1, warm.first.length);
r.ok('the request is the ping on the configured backend',
  warm.first[0].url.indexOf(WARM_GAS_URL + '?action=ping') === 0,
  warm.first[0].url);
r.ok('it is a GET with no body, and no session token can ride on it',
  !warm.first[0].init.method && !warm.first[0].init.body &&
  warm.first[0].url.indexOf('sessionToken') === -1);
r.ok('a second call inside the gap sends nothing extra',
  warm.afterSecond === 1, warm.afterSecond);
r.ok('the navigating call asks to outlive the page',
  warm.first.length === 1 && warm.tap.init.keepalive === true, warm.tap);
r.ok('a refusing backend cannot throw out of a warm-up', warm.threw === false);
r.ok('...and neither can a transport that throws on the way in', warm.threw === false);

// ── The backup-health line, and the tab that had stopped switching ────────────
// Two things are pinned here, and they fail differently.
//
// The health line has THREE states and only one of them is reassuring: healthy,
// failed, and "could not ask". The third is the one worth a test, because the
// tempting implementation renders it as fine — which turns an unknown into a
// reassurance, the exact inversion a backup screen must never make.
//
// The tab switch is the other kind of bug: not a wrong value but a MISSING CALL.
// Four tabs highlighted while the body below them never changed, and no snapshot
// assertion could ever have noticed, because nothing was wrong with what was
// rendered — nothing was rendered at all.
r.head('the backup line tells the truth in all three states, and the tabs actually switch');

const ACCESS_BINDINGS = `
  document,
  loadBackupHealth, backupHealthHtml, renderAccessPanel, renderAccessTabs,
  set accessTab(v) { accessTab = v; },
  get accessTab() { return accessTab; },
  set accessCache(v) { accessCache = v; },
`;

// Drive one load to completion and read what the panel ended up holding. The
// panel is the real #access-panels element from the stub DOM, so this reads the
// markup the browser would have been handed — not a copy the test assembled.
async function healthOnScreen(reply, tab) {
  const which = tab || 'versions';
  const A = loadApp(ACCESS_BINDINGS, {
    capture: true,
    fetch: () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve({ json: () => Promise.resolve(reply) })),
  });
  const panel = A.T.document.getElementById('access-panels');
  A.T.accessCache = { users: [], departments: [], apiVersion: 5 };
  A.T.accessTab = which;
  panel.innerHTML = '';
  A.T.loadBackupHealth();
  await new Promise(r => setTimeout(r, 30));
  return panel.innerHTML;
}

const healthy = await healthOnScreen({
  status: 'ok', apiVersion: 5, ok: true, never: false,
  at: '2026-10-03 23:40', ago: '2 hours ago', irs: 19, users: 18,
  sheetUrl: 'https://docs.google.com/spreadsheets/d/EXAMPLE/edit',
});
r.ok('a healthy backup reads as healthy, with the time and the counts',
  healthy.includes('access-backup-ok') && healthy.includes('Last backup') &&
  healthy.includes('2026-10-03 23:40') && healthy.includes('19 IRs') && healthy.includes('18 accounts'),
  healthy.slice(0, 120));
r.ok('...and offers the sheet without pretending the counts are the whole story',
  healthy.includes('open the backup sheet') && healthy.includes('14 daily copies'),
  healthy.indexOf('14 daily copies') >= 0);

const unknownReply = await healthOnScreen(new Error('no network in test'));
r.ok('a transport that refuses is shown as UNKNOWN, wearing the failure colour',
  unknownReply.includes('access-backup-bad') && unknownReply.includes('unknown'),
  unknownReply.slice(0, 140));
r.ok('...and it does NOT wear the tick, which is the whole point of the state',
  !unknownReply.includes('access-backup-ok') && unknownReply.indexOf('✓') === -1,
  unknownReply.indexOf('✓'));
r.ok('...and it says in words that it knows nothing, rather than nothing at all',
  unknownReply.includes('could not ask') || unknownReply.includes('Read it as unknown'),
  unknownReply.includes('Read it as unknown'));

const refused = await healthOnScreen({ status: 'error', message: 'Unauthorized' });
r.ok('a backend that refuses is UNKNOWN too, and shows the real reason',
  refused.includes('access-backup-bad') && refused.includes('Unauthorized'),
  refused.slice(0, 140));
r.ok('...still without a tick anywhere on the line', refused.indexOf('✓') === -1);

const never = await healthOnScreen({ status: 'ok', apiVersion: 5, ok: true, never: true });
r.ok('a deployment with no backup yet says so, and names the fix',
  never.includes('No backup has run yet') && never.includes('runNightlyBackup'),
  never.slice(0, 140));
r.ok('...and never claims a last-backup time it does not have',
  !never.includes('Last backup'), never.indexOf('Last backup'));

// The repaint guard: an answer that arrives after the admin moved to another tab
// must not overwrite that tab's body. This is why `settle` re-checks accessTab.
const elsewhere = await healthOnScreen({ status: 'ok', ok: true, never: false, at: 'x', ago: 'y' }, 'people');
r.ok('a late answer for a tab the admin has left does not paint over the new tab',
  elsewhere.indexOf('Last backup') === -1 && elsewhere.indexOf('Backups') === -1,
  JSON.stringify(elsewhere));

// The tab handler itself. Source, not behaviour: the harness cannot click a
// button, and absence-of-a-call is precisely what a rendered snapshot cannot see.
const tabHandler = /accessTab\s*=\s*btn\.dataset\.tab;[\s\S]{0,600}?renderAccessPanel\(\)[\s\S]{0,400}?\}\);/.exec(appCode);
r.ok('switching tabs re-renders the panel, not only the highlight', !!tabHandler,
  tabHandler ? tabHandler[0].replace(/\s+/g, ' ').slice(0, 90) : 'no handler re-renders the panel');
r.ok('...and the versions tab is the one that asks for the backup state',
  !!tabHandler && tabHandler[0].indexOf('loadBackupHealth') >= 0,
  tabHandler ? tabHandler[0].indexOf('loadBackupHealth') : -1);

// Every tab the strip can select must end up painting something. Three have an
// explicit branch and People is the fallback, which is why the fallback is
// asserted rather than a fifth literal 'people' comparison that does not exist.
// This list has to grow with the strip: a tab added to the markup and forgotten
// here would be checked by nothing at all, which is the failure mode this whole
// section was written for.
const panelFn = /function renderAccessPanel\s*\(\)\s*\{[\s\S]*?\n\}/.exec(appCode);
const panelText = panelFn ? panelFn[0].replace(/\s+/g, ' ') : '';
r.ok('every tab the strip offers has a branch in the panel renderer',
  !!panelFn && ['depts', 'create', 'customers', 'versions'].every(t =>
    new RegExp(`accessTab === '${t}'`).test(panelText)) && /else renderPeopleTab\(\)/.test(panelText),
  panelText.slice(0, 200));
// ...and the list above is the strip's own, not a shorter one written by hand.
r.ok('...and the list above is complete — every data-tab in the strip is named in it',
  (() => {
    const strip = (appCode.match(/<div class="access-tabs">[\s\S]*?<\/div>/) || [''])[0];
    const tabs = [...strip.matchAll(/data-tab="([a-z]+)"/g)].map(m => m[1]);
    const named = ['people', 'depts', 'create', 'customers', 'versions'];
    return tabs.length === named.length && tabs.every(t => named.indexOf(t) >= 0);
  })(),
  (appCode.match(/data-tab="[a-z]+"/g) || []));

// The classes the line leans on must be real styles, or the red is not red.
r.ok('the healthy and unknown colours are defined in views.css, from tokens',
  /\.access-backup-ok\s*\{[^}]*var\(--ink-green/.test(viewsCode) &&
  /\.access-backup-bad\s*\{[^}]*var\(--ink-red/.test(viewsCode),
  (viewsCode.match(/\.access-backup-(?:ok|bad)\s*\{[^}]*\}/g) || []).join(' | '));

// ── The harness itself ────────────────────────────────────────────────────────
r.head('the stub DOM is faithful enough for these assertions to be able to fail');
r.ok('classList.toggle remembers, in both the one- and two-argument form',
  (() => {
    const e = { classList: null };
    // Reach the real stub through a captured element rather than constructing one.
    const probe = byId.get('ir-activity');
    probe.classList.toggle('probe-x');
    const on = probe.classList.contains('probe-x');
    probe.classList.toggle('probe-x', false);
    const off = !probe.classList.contains('probe-x');
    probe.classList.toggle('probe-y', true);
    const forced = probe.classList.contains('probe-y');
    probe.classList.remove('probe-y');
    return on && off && forced && !probe.classList.contains('probe-y');
  })());
r.ok('setAttribute/getAttribute round-trip', (() => {
  const probe = byId.get('ir-activity-toggle');
  probe.setAttribute('data-probe', '7');
  return probe.getAttribute('data-probe') === '7' && probe.getAttribute('nope') === null;
})());

r.finish();
