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

r.head('the IR list folds away, but never into an empty screen');
r.ok('the control is a real button in the header',
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
r.ok('an open IR still shows the list when nobody asked to fold it', (() => {
  // The default harness viewport is a PHONE, where an open detail legitimately hides
  // the list. The claim being tested is the DESKTOP rule, so it needs a desktop.
  const { T: D, byId: dById } = loadApp(`
    renderLayout, setFlag, LIST_KEY,
    get view() { return currentView; },
    set view(v) { currentView = v; },
    set ir(v) { currentIR = v; },
  `, { capture: true, desktop: true });
  D.view = 'detail';
  D.ir = { irNumber: 'IR409' };
  D.setFlag(D.LIST_KEY, false);
  D.renderLayout();
  const besideIt = dById.get('index-view').style.display !== 'none';
  D.setFlag(D.LIST_KEY, true);
  D.renderLayout();
  const folded = dById.get('index-view').style.display === 'none';
  D.view = 'index';
  D.renderLayout();
  const backOnIndex = dById.get('index-view').style.display !== 'none';
  return besideIt && folded && backOnIndex;
})(), 'desktop: list beside the detail, foldable, never hidden on the index');
r.ok('and folding it is genuinely possible while an IR is open', (() => {
  T.view = 'detail';
  T.ir = { irNumber: 'IR409' };
  T.setFlag(T.LIST_KEY, true);
  T.renderLayout();
  const folded = byId.get('index-view').style.display === 'none';
  T.setFlag(T.LIST_KEY, false);
  T.renderLayout();
  T.view = 'index';
  T.ir = null;
  T.renderLayout();
  return folded;
})());
r.ok('the detail pane is what governs the back button, not the fold',
  /backBtn\.style\.display\s*=/.test(appCode));

r.head('the Insights pane is a third sibling, not a panel inside the detail');
// Three claims. The dashboard must NOT be reached by opening the detail pane (the
// pane's display is the app's only "an IR is open" flag, and #ir-activity is pinned
// inside it), it must keep the IR list beside it on desktop — the mobile back
// button is display:none there, so hiding the list would strand the user — and
// "No IR selected" must not show over it, which it otherwise would because that
// placeholder is keyed on body.view-detail being ABSENT.
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
  return dById.get('index-view').style.display !== 'none';
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
r.ok('the back button is still the detail pane\'s alone',
  /backBtn\.style\.display\s*=\s*\(!desktop && detail\)/.test(appCode),
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
r.ok('the nav and header glyph slots are empty spans in the markup, so there is ONE icon source',
  /id="nav-tickets"[\s\S]{0,200}?class="nav-icon"[^>]*><\/span>/.test(indexCode) &&
  /id="sidebar-toggle"[\s\S]{0,200}?class="sidebar-toggle-icon"[^>]*><\/span>/.test(indexCode) &&
  !/<svg/.test(indexCode));
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
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const emojiLines = appCode.split('\n').filter(l => EMOJI.test(l));
r.ok('no emoji is left in a slot the icon helper fills',
  !/(💬|🔔|🎫)/.test(appCode),
  emojiLines.filter(l => /💬|🔔|🎫/.test(l)));
r.ok('the count has not grown past the recorded number', emojiLines.length <= 46,
  { now: emojiLines.length, budget: 45, sample: emojiLines.slice(0, 5).map(l => l.trim().slice(0, 60)) });
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
// ── The legacy archive: the wait, said out loud ───────────────────────────────
// The owner reported the archive as slow and asked for it to SAY it is loading. The
// app makes no request for this view — Google renders a ~450-tab workbook in an
// iframe — so there is nothing here to speed up; what was wrong was the silence, and
// a permanent "can't see it?" note that read as broken while it was merely slow.
r.head('the legacy archive says it is loading, and only cries help when it is');
const L = loadApp(`legacyTick, LEGACY_SLOW_MS, openLegacyModal, closeLegacyModal, _legacyLoaded`);
r.ok('the panel is announced to a screen reader and names the archive',
  /class="legacy-loading" id="legacy-loading" role="status" aria-live="polite"/.test(appCode) &&
  /Loading the archive…/.test(appCode), (appCode.match(/.*legacy-loading".*/) || [])[0]);
r.ok('a spinner, and the note that explains the scale of the wait',
  /class="legacy-spinner"/.test(appCode) && /the old I-PASSBOOK workbook/.test(appCode));
r.ok('the elapsed count reads in seconds, and rolls into minutes', (() => {
  const el = { textContent: '' };
  const modal = { querySelector: () => el };
  const t0 = Date.now();
  L.legacyTick(modal, t0);
  const zero = el.textContent;
  L.legacyTick(modal, t0 - 5000);
  const five = el.textContent;
  L.legacyTick(modal, t0 - 65000);
  const min = el.textContent;
  return zero === '0s' && five === '5s' && min === '1m 5s';
})(), 'expected 0s / 5s / 1m 5s');
r.ok('and it survives a missing element rather than throwing mid-count', (() => {
  try { L.legacyTick({ querySelector: () => null }, Date.now()); return true; } catch (e) { return 'threw: ' + e.message; }
})());
r.ok('the "open in Sheets" fallback starts hidden — a slow load is not a failure',
  /id="legacy-fallback" style="display:none"/.test(appCode));
r.ok('and is revealed only after a real timeout', (() => {
  const m = /Date\.now\(\) - startedAt < LEGACY_SLOW_MS\) return;/.test(appCode);
  const reveal = /if \(fb\) fb\.style\.display = 'flex';/.test(appCode);
  return m && reveal && L.LEGACY_SLOW_MS >= 10000;
})(), L.LEGACY_SLOW_MS);
r.ok('the panel goes away on the frame\'s OWN load event, not on a guessed delay',
  /frame\.addEventListener\('load', done, \{ once: true \}\)/.test(appCode) &&
  /if \(load\) load\.remove\(\);/.test(appCode));
r.ok('the archive frame no longer waits to be told it is near the viewport', (() => {
  const tag = (appCode.match(/<iframe src="\$\{embedUrl\}"[\s\S]{0,200}?>/) || [''])[0];
  return tag !== '' && !/loading=/.test(tag);
})(), (appCode.match(/<iframe src="\$\{embedUrl\}"[\s\S]{0,200}?>/) || [''])[0]);
// Evidence thumbnails keep their lazy loading — they really do scroll into view.
r.ok('...while the evidence thumbnails keep theirs, which is what lazy is for',
  /class="evidence-thumb" alt="evidence" loading="lazy"/.test(appCode));
r.ok('a loaded archive is KEPT, so reopening it is instant rather than re-rendered', (() => {
  const reopen = /_legacyLoaded\.modal && _legacyLoaded\.key === key/.test(appCode);
  const kept   = /_legacyLoaded = \{ key, modal \};/.test(appCode);
  return reopen && kept;
})(), (appCode.match(/.*_legacyLoaded.*/g) || []).map(l => l.trim()));
r.ok('closing detaches the frame but does NOT throw the loaded one away', (() => {
  const from = appCode.indexOf('function closeLegacyModal()');
  const body = appCode.slice(from, from + 400);
  return /clearInterval\(_legacyTimer\)/.test(body) && !/_legacyLoaded\s*=/.test(body);
})(), appCode.slice(appCode.indexOf('function closeLegacyModal()'), appCode.indexOf('function closeLegacyModal()') + 260));
r.ok('a key that does not match never reattaches the wrong archive',
  /_legacyLoaded\.key === key/.test(appCode) && /const key = embedUrl \+ '\|' \+ String\(label \|\| ''\)/.test(appCode));
r.ok('the wait is drawn over the frame, so removing it costs no relayout',
  /\.legacy-loading \{[\s\S]{0,200}?position: absolute;/.test(componentsCode) &&
  /\.legacy-frame-wrap \{[^}]*position: relative/.test(componentsCode), (componentsCode.match(/.*legacy-loading \{.*/) || [])[0]);
r.ok('the spinner is the app\'s own spin animation, so reduced-motion already covers it',
  /\.legacy-spinner \{[\s\S]{0,220}?animation: spin /.test(componentsCode) &&
  /@keyframes spin/.test(fs.readFileSync(new URL('../base.css', import.meta.url), 'utf8')));

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
  (() => { asked.length = 0; U.confirmLeaveIR(); return /draft/i.test(asked[0]) && /not recorded until you press Save/i.test(asked[0]); })(),
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
  p.body.entries.some(e => e[0] === 'action' && e[1] === 'googleExchange'));

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
r.ok('the click navigates to the door with the start action and no parameters of its own',
  G.T.locationHref === 'https://sso.example.invalid/exec?action=googleStart',
  G.T.locationHref);
r.ok('...and it is a navigation, not a call: the click itself reaches the network ZERO times',
  gPosts.length === 0, gPosts.map(p => p.url));
// The return address is a server-side constant. A `?next=` here would make the app
// hand an attacker the choice of where Google sends the browser back to.
r.ok('the start URL carries no return address — it is built from SSO_URL alone',
  /function googleStartUrl\(\) \{\s*return CONFIG\.SSO_URL \+ '\?action=googleStart';/.test(appCode),
  (appCode.match(/[^\n]*googleStartUrl[^\n]*/) || [''])[0]);
r.ok('the button is disabled on the way out, so a second click cannot start a second handoff',
  G.byId.get('auth-google-btn').disabled === true);
r.ok('and the screen says what is happening while the browser is leaving',
  G.byId.get('auth-hint-text').textContent === 'Taking you to Google…',
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
  CONFIG, isHandoffReturn, finishHandoff, ${NAV},
  get _handoff() { return _handoff; },
  get currentUser() { return currentUser; },
`, { capture: true, fetch: gFetch,
     globals: { location: Object.assign({}, HASH_BASE, { hash: '#sso=' + HANDOFF_CODE }) } });
r.ok('the fragment is recognised as a handoff return',
  G2.T.isHandoffReturn() === true, G2.T.isHandoffReturn());
r.ok('and read as a CODE, with the prefix stripped exactly once',
  G2.T._handoff && G2.T._handoff.code === HANDOFF_CODE, G2.T._handoff);
gPosts.length = 0;
await G2.T.finishHandoff(G2.T._handoff);
r.ok('the code is exchanged for a session, on the MAIN backend, carrying no stale token',
  (() => {
    const p = gexchangePost();
    if (!p) return false;
    const keys = p.body.entries.map(e => e[0]);
    return p.url === G2.T.CONFIG.GAS_URL &&
           p.body.entries.some(e => e[0] === 'code' && e[1] === HANDOFF_CODE) &&
           keys.indexOf('sessionToken') === -1;
  })(), gPosts.map(p => p.url));
r.ok('the device label travels, so the audit line can say where it was opened',
  (() => {
    const p = gexchangePost();
    return !!p && p.body.entries.some(e => e[0] === 'device' && String(e[1]).length > 0);
  })(), gexchangePost() && gexchangePost().body.entries);
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
const handoffSeg = appCode.slice(appCode.indexOf('const _handoff = (() => {'),
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
  isHandoffReturn, finishHandoff, setAuthError, ${NAV},
  get _handoff() { return _handoff; },
  get currentUser() { return currentUser; },
`, { capture: true, fetch: gFetch,
     globals: { location: Object.assign({}, HASH_BASE, { hash: '#ssoerr=' +
       encodeURIComponent('Set your own password first: sign in with your temporary password, then use Google from then on.') }) } });
r.ok('it is recognised as a return, so the splash is skipped for a refusal too',
  G3.T.isHandoffReturn() === true);
await G3.T.finishHandoff(G3.T._handoff);
r.ok('the backend\'s own words are shown, not a generic failure',
  /Set your own password first/.test(G3.byId.get('auth-error').textContent),
  G3.byId.get('auth-error').textContent);
r.ok('and the error line is made visible, the way every other auth error is',
  G3.byId.get('auth-error').style.display === 'block');
r.ok('...and the sign-in screen is the one on show, with the password form one tap away',
  G3.byId.get('auth-container').style.display !== 'none');
r.ok('nothing is exchanged — there is no code, so nothing reaches the network',
  gPosts.length === 0, gPosts.map(p => p.url));
r.ok('no session is invented from a refusal',
  !G3.T.currentUser || !G3.T.currentUser.sessionToken, G3.T.currentUser && G3.T.currentUser.sessionToken);
r.ok('clearing it hides the line again rather than leaving an empty box',
  (() => { G3.T.setAuthError(''); return G3.byId.get('auth-error').style.display === 'none'; })());

r.head('the two doors share one session model, one error line and one regex');
r.ok('finishAuth is the password door\'s own function, called unchanged',
  /finishAuth\(d\.email, d\)/.test(appCode));
r.ok('the password form is never replaced — its handler is still wired',
  /signInBtn\.addEventListener\('click', submitLogin\)/.test(appCode) &&
  /auth-google-btn/.test(indexSrc) && /id="auth-signin-btn"/.test(indexSrc));
r.ok('googleExchange is listed as self-authenticating, and the deleted pair is gone from the regex',
  /googleExchange\)/.test((appCode.match(/const isAuthCall = [^\n]*/) || [''])[0]) &&
  !/googleSignIn\|googleSignInProbe/.test(appCode),
  (appCode.match(/const isAuthCall = [^\n]*/) || [''])[0]);
r.ok('nothing in the door reaches for UrlFetchApp or getEffectiveUser — the server half is pinned in smoke-backend',
  !/UrlFetchApp|getEffectiveUser/.test(appCode));

r.head('the splash skip and the handoff return are pinned to each other');
// index.html decides this BEFORE app.js parses, so that the nine-second intro never
// flashes on the way into a sign-in that has already started. If the two conditions
// drift, a Google return pays for the intro and app.js cannot tell anyone.
r.ok('the pre-paint script skips the splash on a handoff return',
  /\(location\.hash \|\| ''\)\.indexOf\('#sso'\) === 0/.test(indexSrc),
  (indexSrc.match(/[^\n]*indexOf\('#sso[^\n]*/) || [''])[0]);
r.ok('...and its prefix test covers the REFUSAL branch too, not just the code',
  !/indexOf\('#sso='\)/.test(indexSrc));
r.ok('app.js makes the same call at boot, for the loads pre-paint cannot cover',
  /if \(isHandoffReturn\(\)\) \{ splash\.style\.display = 'none'; finishHandoff\(_handoff\); return; \}/.test(appCode));
r.ok('...and a device already signed in still wins, so a stale fragment cannot hijack it',
  appCode.indexOf('if (hasStoredSession()) { dismissSplash(true); return; }') <
  appCode.indexOf('if (isHandoffReturn()) { splash.style.display'));

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
