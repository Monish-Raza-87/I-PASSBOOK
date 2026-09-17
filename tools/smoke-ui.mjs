// Smoke test for the five UI changes the owner asked for after walking the real app.
//
//   node tools/smoke-ui.mjs
//
//   1. saving IS signing — no second, role-specific button
//   2. the activity log is collapsed, and reads in plain English
//   3. it sits below every section, inside the detail pane
//   4. the sidebar and the IR list both fold away
//   5. the comments icon is a real icon, not an emoji
//   +  no user-visible "ticket" survives anywhere
//
// Every case here is BEHAVIOUR the browser would also produce, not a snapshot of
// the source. The two that are source-level — "signESignature is gone" and "the
// fill happens before the values are collected" — cannot be observed through a
// stub DOM, and both are stated as intent about ORDER or ABSENCE, so a regex over
// comment-stripped source is the honest way to pin them.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();

const APP_JS = new URL('../app.js', import.meta.url);
const INDEX  = new URL('../index.html', import.meta.url);
const appSrc   = fs.readFileSync(APP_JS, 'utf8');
const indexSrc = fs.readFileSync(INDEX, 'utf8');

// Comments are prose ABOUT the change, and several of them name the thing that was
// removed ("no Sign as … button any more"). Every source assertion below therefore
// reads the code with comments stripped, so a comment can never satisfy it.
//
// The stripper is a real single-pass scanner rather than a regex, because a regex
// cannot know that `accept="image/*,application/pdf"` inside a template literal is
// not the start of a block comment. An earlier regex version ate half of app.js.
function stripJs(src) {
  let out = '', i = 0, state = 'code';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
      out += c; i++; continue;
    }
    if (state === 'line')   { if (c === '\n') { state = 'code'; out += c; } i++; continue; }
    if (state === 'block')  { if (c === '*' && d === '/') { state = 'code'; i += 2; } else i++; continue; }
    // Inside a string: keep the text — UI copy lives in these, which is the point of
    // scanning at all — but never let it open a comment. A template's `${…}` is left
    // as-is: it is code, and treating it as code is the conservative direction.
    if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
    if ((state === 'single' && c === "'") ||
        (state === 'double' && c === '"')  ||
        (state === 'template' && c === '`')) state = 'code';
    out += c; i++;
  }
  return out;
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
  SECTIONS, renderESignatureHTML, signSectionOnSave, refreshESignature,
  renderActivityCount, applyActivityState, toggleActivity,
  applyChromeState, toggleRail, toggleList, renderLayout, iconSvg, ICON_PATHS,
  TIMELINE_KINDS, IR_CATEGORIES,
  storedFlag, setFlag, RAIL_KEY, LIST_KEY, ACTIVITY_KEY, ACTIVITY_LIMIT,
  get sig() { return esignatureState; },
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

const ME = 'monish.raza@indrones.com';

// ── 1. Saving is signing ──────────────────────────────────────────────────────
r.head('the "Sign as …" button is gone — Save is the only action');
r.ok('signESignature is not defined anywhere in the source',
  !/\bsignESignature\b/.test(appCode), (appCode.match(/.*signESignature.*/) || [])[0]);
r.ok('no "Override & Re-sign" survives',
  !/re-?sign/i.test(appCode), (appCode.match(/.*re-?sign.*/i) || [])[0]);
r.ok('no e-signature markup emits a <button> at all', (() => {
  const unsigned = T.renderESignatureHTML('b_signInward', 'Inward Performed By');
  T.sig.b_signInward = { signedBy: ME, signedAt: '2026-09-16T09:30:00.000Z', history: [] };
  const signed = T.renderESignatureHTML('b_signInward', 'Inward Performed By');
  delete T.sig.b_signInward;
  return !/<button|<input|onclick/.test(unsigned + signed);
})(), [T.renderESignatureHTML('b_signInward', 'Inward Performed By')]);

r.head('an unfilled role line says what will fill it');
const unsignedHTML = T.renderESignatureHTML('b_signInward', 'Inward Performed By');
r.ok('the role is named', /Inward Performed By/.test(unsignedHTML), unsignedHTML);
r.ok('and it says the fill is automatic, not a task for the reader',
  /esignature-muted/.test(unsignedHTML) && /save/i.test(unsignedHTML), unsignedHTML);

r.head('a filled role line names the person and the moment');
T.sig.c_signIqc = { signedBy: ME, signedAt: '2026-09-16T09:30:00.000Z', history: [] };
const signedHTML = T.renderESignatureHTML('c_signIqc', 'IQC Inspector');
r.ok('the role is kept', /IQC Inspector/.test(signedHTML), signedHTML);
r.ok('the person is shown', signedHTML.includes(ME), signedHTML);
r.ok('and the moment is formatted, not a raw ISO string',
  /esignature-stamp/.test(signedHTML) && !/T09:30:00\.000Z/.test(signedHTML), signedHTML);
r.ok('earlier savers are kept, not discarded',
  (() => {
    T.sig.c_signIqc.history = [{ signedBy: 'ravi@indrones.com', signedAt: '2026-09-01T04:00:00.000Z' }];
    const h = T.renderESignatureHTML('c_signIqc', 'IQC Inspector');
    return /esignature-history/.test(h) && h.includes('ravi@indrones.com');
  })(), T.renderESignatureHTML('c_signIqc', 'IQC Inspector'));
delete T.sig.c_signIqc;

r.head('the fill stamps only what nobody has claimed');
// One helper, used by every case below: the signature state is a module-level
// object the app owns, so tests mutate it in place rather than reassigning it.
// `fill` returns the state as a plain {fieldId: signedBy} map, which is what every
// assertion below actually cares about.
const fresh = () => { Object.keys(T.sig).forEach(k => delete T.sig[k]); };
const filled = () => {
  const out = {};
  Object.keys(T.sig).forEach(k => {
    const v = T.sig[k];
    if (v && typeof v === 'object' && v.signedBy) out[k] = v.signedBy;
  });
  return out;
};

r.head('one save claims one role line');
fresh();
T.user = { email: ME };
T.sig.b_remarks = 'a plain text field must not be touched';
T.signSectionOnSave('sec-b');
r.ok('the first unfilled role line takes the saver',
  T.sig.b_signInward && T.sig.b_signInward.signedBy === ME, T.sig.b_signInward);
r.ok('the moment is recorded with it',
  !!(T.sig.b_signInward && T.sig.b_signInward.signedAt), T.sig.b_signInward);
r.ok('a NON-e-signature field in the same section is untouched',
  T.sig.b_remarks === 'a plain text field must not be touched', T.sig.b_remarks);
r.ok('a section with ONE role line fills exactly that one', (() => {
  fresh();
  T.signSectionOnSave('sec-c');
  return Object.keys(filled()).join() === 'c_signIqc';
})(), filled());

r.head('the fill never overwrites a person already on the line');
r.ok('the load-bearing rule, stated as a case', (() => {
  fresh();
  const before = { signedBy: 'ganesh@indrones.com', signedAt: '2026-08-21T04:00:00.000Z', history: [] };
  T.sig.b_signInward = Object.assign({}, before);
  T.signSectionOnSave('sec-b');
  return T.sig.b_signInward.signedBy === before.signedBy &&
         T.sig.b_signInward.signedAt === before.signedAt;
})(), T.sig.b_signInward);

r.head('a two-role section stays separable — this is what Section B is for');
// Inward signs first, Inventory signs later. Both lines must stand, each against
// the right person. Filling every empty block on every save would stamp
// "Inventory (ST No. Assigner)" with the Inward person's name.
r.ok('the two people each get their OWN line', (() => {
  fresh();
  T.user = { email: 'ganesh@indrones.com' };
  T.signSectionOnSave('sec-b');                      // Inward performs
  T.user = { email: 'adhik@indrones.com' };
  T.signSectionOnSave('sec-b');                      // Inventory assigns the ST no.
  const f = filled();
  return f.b_signInward === 'ganesh@indrones.com' && f.b_signInventory === 'adhik@indrones.com';
})(), filled());
r.ok('and the second save did not overwrite the first line', (() => {
  const f = filled();
  return f.b_signInward === 'ganesh@indrones.com';
})(), filled());
r.ok('saving the SAME section twice does not creep onto the next role', (() => {
  fresh();
  T.user = { email: ME };
  T.signSectionOnSave('sec-b');
  T.signSectionOnSave('sec-b');
  T.signSectionOnSave('sec-b');
  return Object.keys(filled()).join() === 'b_signInward';
})(), filled());

r.head('an unfilled role line nobody has claimed stays visibly unfilled');
r.ok('a third person saving a fully-claimed section claims nothing', (() => {
  fresh();
  T.user = { email: 'ganesh@indrones.com' };
  T.signSectionOnSave('sec-b');
  T.user = { email: 'adhik@indrones.com' };
  T.signSectionOnSave('sec-b');
  T.user = { email: 'third@indrones.com' };
  T.signSectionOnSave('sec-b');
  const f = filled();
  return Object.keys(f).length === 2 && !Object.values(f).includes('third@indrones.com');
})(), filled());
r.ok('an existing chain of earlier savers survives the fill', (() => {
  fresh();
  const history = [{ signedBy: 'old@indrones.com', signedAt: '2026-07-01T04:00:00.000Z' }];
  T.sig.c_signIqc = { signedBy: '', signedAt: '', history: history };
  T.user = { email: ME };
  T.signSectionOnSave('sec-c');
  return T.sig.c_signIqc.history === history && T.sig.c_signIqc.signedBy === ME;
})(), T.sig.c_signIqc);

r.head('the fill touches one section, and only when someone is signed in');
r.ok('another section\'s role lines are left alone', (() => {
  fresh();
  T.user = { email: ME };
  T.signSectionOnSave('sec-b');
  return !T.sig.d_signQcManager && !T.sig.f_signQc;
})(), Object.keys(T.sig));
r.ok('with nobody signed in it is a no-op, not a crash', (() => {
  fresh();
  T.user = null;
  try { T.signSectionOnSave('sec-b'); } catch (e) { return 'threw: ' + e.message; }
  return Object.keys(T.sig).length === 0;
})());
r.ok('an unknown section is a no-op too', (() => {
  T.user = { email: ME };
  try { T.signSectionOnSave('sec-nope'); return true; } catch (e) { return 'threw: ' + e.message; }
})());
r.ok('and a user object with no email does not stamp "undefined"', (() => {
  fresh();
  T.user = {};
  T.signSectionOnSave('sec-b');
  return Object.keys(T.sig).length === 0;
})(), Object.keys(T.sig));
fresh();

r.head('the signature is in the payload, not written afterwards');
// Sliced from the RAW source, not the comment-stripped one: the ordering claim is
// about two call sites, and the stripper's job is prose, not structure.
r.ok('saveSection stamps BEFORE it collects the values', (() => {
  const from = appSrc.indexOf('async function saveSection(');
  if (from < 0) return false;
  const body = appSrc.slice(from, from + 4000);
  const sign = body.indexOf('signSectionOnSave(');
  const collect = body.indexOf('collectSectionValues(');
  return sign > -1 && collect > -1 && sign < collect;
})(), (() => {
  const from = appSrc.indexOf('async function saveSection(');
  const body = appSrc.slice(from, from + 4000);
  return { found: from, sign: body.indexOf('signSectionOnSave('), collect: body.indexOf('collectSectionValues(') };
})());

r.head('every role line the PDF needs still exists');
// The fields are kept as read-only auto-filled records rather than deleted: Section
// D's PDF prints "Investigation Authorised" from d_signQcManager, so removing the
// field would silently empty a line on a document that goes to a customer.
const esigFields = [];
Object.keys(T.SECTIONS).forEach(sid => {
  T.SECTIONS[sid].fields.forEach(f => { if (f.type === 'esignature') esigFields.push(f); });
});
r.ok('all nine survive', esigFields.length === 9, esigFields.length);
r.ok('each keeps the role label the PDF and the screen read',
  esigFields.every(f => !!f.role && !!f.id), esigFields.map(f => [f.id, f.role]));
r.ok('and the authoriser Section D prints is among them',
  esigFields.some(f => f.id === 'd_signQcManager' && f.role === 'Technical Support (QC Manager)'),
  esigFields.map(f => f.id));

r.head('a role line cannot be used to inject markup');
const evil = T.renderESignatureHTML('b_signInward', '<img src=x onerror=alert(1)>');
r.ok('the role is escaped', !/<img/.test(evil), evil);
r.ok('and so is the name that fills it', (() => {
  T.sig.b_signInward = { signedBy: '<script>bad()</script>', signedAt: '2026-09-16T09:30:00.000Z', history: [] };
  const h = T.renderESignatureHTML('b_signInward', 'Inward Performed By');
  delete T.sig.b_signInward;
  return !/<script/.test(h);
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
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const emojiLines = appCode.split('\n').filter(l => EMOJI.test(l));
r.ok('no emoji is left in a slot the icon helper fills',
  !/(💬|🔔|🎫)/.test(appCode),
  emojiLines.filter(l => /💬|🔔|🎫/.test(l)));
r.ok('the count has not grown past the recorded number', emojiLines.length <= 29,
  { now: emojiLines.length, budget: 29, sample: emojiLines.slice(0, 5).map(l => l.trim().slice(0, 60)) });
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
r.ok('the deep link still works — the route name was NOT renamed',
  /parts\[0\] === 'tickets'/.test(appCode) && T.IR_CATEGORIES.length === 4);
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
