// Smoke test for the Overview panel: the Maps link, and the write path underneath it.
//
//   node tools/smoke-overview.mjs
//
// Two changes land together here and they are held to different standards, because
// they fail differently.
//
// The MAPS LINK is visible, so a person notices when it is wrong. What they cannot
// notice is the way it is wrong QUIETLY: a link whose href lags the text box by one
// save takes you to the previous site and looks perfectly correct, and a link left
// visible on a ticket with no site claims we know where something is when we do not.
// So the link's assertions are about when it exists and what it currently points at.
//
// The WRITE PATH is invisible. It has no rendered output at all, which is exactly
// why it needs a test: the bug it closes — a flush that "saves" a unit it has no way
// to save, and therefore clears that unit's draft and dirty flag while sending
// nothing — is silent, and its symptom is a person's typing disappearing with no
// warning. Reading the source cannot tell you whether that still happens, so the
// assertion below actually runs a flush and counts what came out of the transport.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
const appJs    = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const viewsCss = fs.readFileSync(new URL('../views.css', import.meta.url), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// A stand-in DOM, small but honest.
// ─────────────────────────────────────────────────────────────────────────────
// The panel's `querySelectorAll` MATCHES a real selector string rather than
// returning every child, and the element set honours the `[id]` part of it. That
// matters: a stub that ignored the selector would pass even if the reader asked for
// the wrong tag or the wrong attribute, which is the one class of bug this test is
// here to catch.
//
// Everything else is the harness's own minimal element, repeated here because this
// suite replaces the whole `document`: app.js runs top to bottom at load and reaches
// for real elements on the way (`#toast`, the tab strip), so a fake document that
// returned null for an id it had not been told about would throw during the load and
// the test would fail for a reason that has nothing to do with what it tests.
function fakeEl(tag, id, value) {
  const handlers = {};
  const attrs = {};
  const classes = new Set();
  return {
    tagName: String(tag).toUpperCase(), id, value,
    hidden: false, href: undefined, style: {}, dataset: {},
    textContent: '', innerHTML: '', children: [],
    _attrs: attrs, _handlers: handlers,
    classList: {
      add(...n) { n.forEach(x => classes.add(x)); },
      remove(...n) { n.forEach(x => classes.delete(x)); },
      contains: n => classes.has(n),
      toggle(n, force) {
        const on = force === undefined ? !classes.has(n) : !!force;
        on ? classes.add(n) : classes.delete(n);
        return on;
      },
      get length() { return classes.size; },
    },
    setAttribute(n, v) { attrs[n] = String(v); },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null; },
    removeAttribute(n) { delete attrs[n]; },
    addEventListener(type, fn) { (handlers[type] || (handlers[type] = [])).push(fn); },
    removeEventListener() {},
    _fire(type) { (handlers[type] || []).forEach(fn => fn()); },
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild() {}, insertBefore() {}, remove() {},
    focus() {}, blur() {}, scrollIntoView() {}, closest: () => null,
  };
}

// The selector the reader uses: 'input[id], select[id], textarea[id]'.
const FIELD_SEL = /^(input|select|textarea)\[id\]$/;

function panelOf(children) {
  const root = fakeEl('div', 'ir-overview-editable', '');
  root.querySelectorAll = sel => {
    const tags = String(sel).split(',')
      .map(s => s.trim()).filter(s => FIELD_SEL.test(s))
      .map(s => FIELD_SEL.exec(s)[1].toUpperCase());
    return children.filter(el => el.id && tags.includes(el.tagName));
  };
  return root;
}

// A fresh stub for any id the suite did not name, exactly as the harness does — so
// the only ids in this document with real behaviour are the ones under test.
function fakeDoc(elements) {
  const reg = new Map(elements.map(el => [el.id, el]));
  return {
    getElementById: id => reg.get(id) || fakeEl('div', '', ''),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: tag => fakeEl(tag, '', ''),
    body: fakeEl('body', '', ''),
    documentElement: fakeEl('html', '', ''),
    addEventListener() {}, readyState: 'complete',
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. The link builder
// ═════════════════════════════════════════════════════════════════════════════
r.head('a site becomes a Maps URL, and a blank becomes nothing');

const T1 = loadApp('mapsLink,');

r.ok('a typed site becomes Google\'s own search URL',
  T1.mapsLink('Plot 4, Whitefield, Bengaluru') ===
  'https://www.google.com/maps/search/?api=1&query=Plot%204%2C%20Whitefield%2C%20Bengaluru',
  T1.mapsLink('Plot 4, Whitefield, Bengaluru'));
// The same `query=` takes a coordinate pair, which is why there is ONE shape here
// rather than an "is this a coordinate?" branch that could guess wrong.
r.ok('a coordinate pair goes through the same one shape',
  T1.mapsLink('12.9716, 77.5946') ===
  'https://www.google.com/maps/search/?api=1&query=12.9716%2C%2077.5946',
  T1.mapsLink('12.9716, 77.5946'));
r.ok('...and the comma is encoded, so the pair is one query and not two',
  !/query=12\.9716,/.test(T1.mapsLink('12.9716, 77.5946')));
// The blanks. An empty `query=` opens Maps on the whole world, which reads as "we
// know where this is" at exactly the moment we do not.
r.ok('an empty box, whitespace, null and undefined all give no link',
  ['', '   ', '\t\n', null, undefined].every(v => T1.mapsLink(v) === null),
  ['', '   ', null, undefined].map(v => [v, T1.mapsLink(v)]));
r.ok('a value of only whitespace is trimmed away, not merely left blank',
  T1.mapsLink('  Whitefield  ') === T1.mapsLink('Whitefield'), T1.mapsLink('  Whitefield  '));
r.ok('the number 0 is not mistaken for blank',
  T1.mapsLink(0) === 'https://www.google.com/maps/search/?api=1&query=0', T1.mapsLink(0));

// Nothing reaches Google from here. The value goes into a URL string and that is all
// this does — which is the whole reason a maps feature was allowed anywhere near data
// this sensitive.
const mapsBody = (appJs.match(/function mapsLink\(value\)\s*\{[\s\S]*?\n\}/) || [''])[0];
r.ok('the builder was found, so the next two assertions are about real code',
  mapsBody.length > 0);
r.ok('...and it fetches nothing and sends nothing — it only builds a string',
  mapsBody.length > 0 && !/fetch\(|XMLHttpRequest|\.send\(|new Image|\.src\s*=/.test(mapsBody),
  mapsBody.slice(0, 160));
r.ok('...and it touches no DOM, clock or storage, so a render may call it freely',
  mapsBody.length > 0 && !/document\.|window\.|localStorage|Date\.now|new Date/.test(mapsBody));

// ═════════════════════════════════════════════════════════════════════════════
// 2. The reader is generic — a property, not a style choice
// ═════════════════════════════════════════════════════════════════════════════
r.head('the panel is read by what is on screen, not by a list of what should be');

const children = [
  fakeEl('input', 'a_crmOwner', 'Ravi Singh'),
  fakeEl('input', 'a_contactPhone', '+91 98450 00000'),
  fakeEl('input', 'a_siteLocation', '  '),
  // A field the app has NEVER heard of, here on purpose. This is the assertion that
  // fails if the reader is ever replaced by a hand-written list of ids — and that
  // list is precisely how a new Overview field ends up looking normal on screen
  // while never being saved.
  fakeEl('input', 'a_brandNewField', 'should come back too'),
  // Right tag, no id: the `[id]` in the selector has to mean something.
  fakeEl('input', '', 'no id, no value key'),
  // Wrong tag: a label is not a field.
  fakeEl('div', 'not_a_field', 'ignored'),
];
const T2 = loadApp('collectOverviewValues,', {
  globals: { document: fakeDoc([panelOf(children)]) },
});
const got = T2.collectOverviewValues();

r.ok('every named input in the panel comes back', got.a_crmOwner === 'Ravi Singh', got);
r.ok('...including one the app has never heard of, which is what "generic" means',
  got.a_brandNewField === 'should come back too', Object.keys(got));
r.ok('...an element with no id is skipped, since a value with no name cannot be stored',
  !Object.values(got).includes('no id, no value key'), Object.values(got));
r.ok('...and a non-field in the same panel is left out',
  !Object.prototype.hasOwnProperty.call(got, 'not_a_field'), Object.keys(got));
r.ok('a whitespace-only value is carried through as typed; trimming is the URL builder\'s job',
  got.a_siteLocation === '  ', JSON.stringify(got.a_siteLocation));

// The panel absent is the case that used to cost data. The Save button is a SIBLING
// of the panel (index.html), so it stays live when the panel does not render — and
// the old hard-coded payload would then have posted two empty strings, which the
// backend MERGES over the stored row. An empty object posts nothing, and the row is
// left alone.
const T3 = loadApp('collectOverviewValues,', { globals: { document: fakeDoc([]) } });
r.ok('with no panel on the page the reader returns NOTHING, not two empty strings',
  Object.keys(T3.collectOverviewValues()).length === 0, T3.collectOverviewValues());
r.ok('the reader finds the panel by query, so a new field needs no second edit',
  /querySelectorAll\('input\[id\], select\[id\], textarea\[id\]'\)/.test(appJs));

// The Save button must read through that same reader, or the panel and the payload
// can disagree — which is the drift this replaced in the first place.
r.ok('the manual save reads through the shared collector, not its own literal',
  /const fields = collectOverviewValues\(\);/.test(appJs) &&
  !/a_crmOwner:\s*document\.getElementById/.test(appJs));

// ═════════════════════════════════════════════════════════════════════════════
// 3. The flush cannot discard a unit it has no way to save
// ═════════════════════════════════════════════════════════════════════════════
r.head('a flush saves only what can be saved, and never throws work away instead');

const T4 = loadApp(`
  unitAutoSaves, OVERVIEW_KEY, SECTION_IDS,
`, {});
r.ok('the Overview is not an auto-saving unit', T4.unitAutoSaves(T4.OVERVIEW_KEY) === false);
r.ok('...and every real section is', T4.SECTION_IDS.every(id => T4.unitAutoSaves(id) === true),
  T4.SECTION_IDS.filter(id => !T4.unitAutoSaves(id)));

// The behaviour, not the source. A save is a real POST, so the count is taken at the
// transport — that is the only place that can tell "posted nothing" apart from
// "posted something the assertion did not think to look at". The recorder lives out
// here because a closure inside the sandbox cannot see this realm's array.
//
// The body arrives here already rebuilt by app.js's own fetch wrapper (it copies the
// entries and appends the session pair), which is the right thing to read: it is the
// body that would actually have gone to the server, not the one the caller built.
const calls = [];
const record = init => {
  const rec = {};
  const body = init && init.body;
  if (body && typeof body.entries === 'function') {
    for (const [k, v] of body.entries()) rec[k] = v;
  }
  calls.push(rec);
};
const loadFlushing = () => loadApp(`
  flushDirtyUnits, hasUnsavedChanges, markSectionDirty, OVERVIEW_KEY,
  get dirtyIds() { return Array.from(_dirtySections); },
  set currentIR(v) { currentIR = v; },
`, {
  fetch: (url, init) => {
    record(init);
    return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) });
  },
});

// `autoSaveUnit` is async and the flush is deliberately not awaited anywhere, so the
// assertions are taken after the queue has drained.
const tick = () => new Promise(res => setTimeout(res, 20));
const saves = () => calls.filter(c => c.action === 'saveSection');

const A = loadFlushing();
A.currentIR = { irNumber: 'IR001' };
A.markSectionDirty(A.OVERVIEW_KEY);
r.ok('typing in the Overview marks it dirty, so the leave guard will speak up',
  A.hasUnsavedChanges() === true && A.dirtyIds.join() === A.OVERVIEW_KEY, A.dirtyIds);

calls.length = 0;
A.flushDirtyUnits();
await tick();
r.ok('...and a flush posts NOTHING for it — it is not the flush\'s unit to save',
  saves().length === 0, saves().map(c => c.sectionId));
r.ok('...and it stays dirty, so the draft is intact and the guard is still armed',
  A.hasUnsavedChanges() === true && A.dirtyIds.join() === A.OVERVIEW_KEY, A.dirtyIds);

// The control. Without it, "the flush posts nothing" would be satisfied just as well
// by a flush broken into doing nothing at all.
const B = loadFlushing();
B.currentIR = { irNumber: 'IR001' };
B.markSectionDirty('sec-b');
calls.length = 0;
B.flushDirtyUnits();
await tick();
r.ok('a real section IS still flushed — the fix narrowed the flush, it did not stop it',
  saves().length === 1 && saves()[0].sectionId === 'sec-b', saves().map(c => c.sectionId));
r.ok('...and a flushed section is cleared, because it really was saved',
  B.hasUnsavedChanges() === false, B.dirtyIds);

// ═════════════════════════════════════════════════════════════════════════════
// 4. One rule, read by every end
// ═════════════════════════════════════════════════════════════════════════════
r.head('the timer, the flush and the writer all ask the same question');

r.ok('the rule is defined exactly once',
  (appJs.match(/function unitAutoSaves\(/g) || []).length === 1,
  (appJs.match(/function unitAutoSaves\(/g) || []).length);
r.ok('...the timer reads it',
  /if \(!isTrackedUnit\(unitId\) \|\| !unitAutoSaves\(unitId\)\) return;/.test(appJs));
r.ok('...the flush reads it',
  /Array\.from\(_dirtySections\)\.filter\(unitAutoSaves\)/.test(appJs));
r.ok('...and the writer reads it, so a future caller cannot bypass the rule',
  /async function autoSaveUnit\(unitId\)[\s\S]{0,500}?if \(!unitAutoSaves\(unitId\)\) return;/.test(appJs));
r.ok('the old bare OVERVIEW_KEY comparison is gone from the timer, so the two ends cannot diverge again',
  !/function scheduleAutoSave\(unitId\)[\s\S]{0,300}?if \(unitId === OVERVIEW_KEY\) return;/.test(appJs));

// ═════════════════════════════════════════════════════════════════════════════
// 5. The link on the page
// ═════════════════════════════════════════════════════════════════════════════
r.head('the link appears only when it has somewhere to go, and stays current');

const editable  = (appJs.match(/function renderOverviewEditable\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
const linkRule  = (viewsCss.match(/\.overview-site-link\s*\{[^}]*\}/) || [''])[0];
const guardRule = (viewsCss.match(/\.overview-site-link\[hidden\]\s*\{\s*display:\s*none;\s*\}/) || [''])[0];

r.ok('the panel was found, so the rest of these are about real code', editable.length > 0);
r.ok('the link leaves the app in a new tab, and says so to the browser',
  /target="_blank"/.test(editable) && /rel="noopener noreferrer"/.test(editable));
r.ok('it is hidden in the markup, so it never flashes before the first paint',
  /id="a_site-link"[^>]*hidden/.test(editable), editable.match(/<a class="overview-site-link"[^>]*>/));
r.ok('its href is built by the shared builder, never pasted together here',
  /mapsLink\(site && site\.value\)/.test(editable));
r.ok('a blank site clears the href as well as hiding the link, so no stale target remains',
  /removeAttribute\('href'\)/.test(editable));
r.ok('typing repaints it, so it never points at the previously saved site',
  /site\.addEventListener\('input', paintSiteLink\)/.test(editable));
// A read-only reader's input is disabled and never fires an input event, so the one
// paint at render is the only thing that gives them the link at all.
r.ok('...and it is painted once at render, which is the only paint a reader gets',
  /paintSiteLink\(\);\s*\n\}/.test(editable), editable.slice(-120));

// The trap: a `display` in the rule outranks the browser's own [hidden] style, so a
// link hidden with `el.hidden = true` would stay on screen. The guard rule is what
// makes the hiding real, and only its ORDER makes it work.
r.ok('the link sets a display, which is what makes the [hidden] guard necessary',
  /display:\s*inline-flex/.test(linkRule), linkRule.slice(0, 80));
r.ok('...and the guard rule exists, so `hidden` actually hides it',
  guardRule.length > 0, guardRule);
r.ok('...and it comes AFTER the display rule, since order is what decides it',
  viewsCss.indexOf(guardRule) > viewsCss.indexOf(linkRule),
  [viewsCss.indexOf(linkRule), viewsCss.indexOf(guardRule)]);
r.ok('the link meets the same 40px tap floor the tabs and .btn-ghost use',
  /min-height:\s*40px/.test(linkRule));

// ── The one geometric condition this markup depends on ───────────────────────
// The link cannot shrink: its text is nowrap, so its min-content width is a hard
// floor. The row is a two-track grid whose LABEL track may take up to 190px, and
// grid will undercut the value track below its min-content when the two minimums
// do not both fit — so the row has a minimum usable width, and past it the link
// spills out of the panel rather than wrapping.
//
// That width is only reachable in the desktop split, where the detail pane is
// `viewport − sidebar − list`. Measured in Chrome at the app's own font stack, the
// link's min-content is 106.64px; the arithmetic below is the check that the
// narrowest reachable pane still clears it, with slack.
//
// It is written out because the numbers that decide it live in THREE other files
// and none of them looks like a layout constraint on this panel. Raising --list-w,
// or the sidebar, or moving the lg breakpoint, would silently overflow the panel —
// and this is the assertion that says so instead.
const tokensCss = fs.readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const baseCss   = fs.readFileSync(new URL('../base.css', import.meta.url), 'utf8');
const num = (css, re, what) => {
  const m = css.match(re);
  if (!m) throw new Error('smoke-overview: could not read ' + what);
  return parseFloat(m[1]);
};
const ROOT_PX   = 16;                                                  // no html font-size is set
const sidebar   = num(tokensCss, /--sidebar-w:\s*([\d.]+)px/, '--sidebar-w');
// tokens.css holds the value that applies at 1024, which is the narrow case. The
// only other definition is base.css's `@media (min-width: 1440px)` bump to 440px,
// and a WIDER list at a wider viewport can only widen the pane — so the minimum is
// always the tokens value against the lg breakpoint.
const listW     = num(tokensCss, /--list-w:\s*([\d.]+)px/, '--list-w');
const lgBreak   = num(baseCss, /@media \(min-width:\s*(\d+)px\)\s*\{\s*#panes\s*\{\s*flex-direction:\s*row/, 'the lg split-pane breakpoint');
const labelMax  = num(viewsCss, /\.overview-edit-row\s*\{[^}]*?grid-template-columns:\s*minmax\([\d.]+px,\s*([\d.]+)px\)/, 'the label track maximum');
const rowGap    = num(viewsCss, /\.overview-edit-row\s*\{[^}]*?gap:\s*[\d.]+rem\s+([\d.]+)rem/, 'the row column gap');
const panelPadX = num(viewsCss, /\.overview-panel\s*\{[^}]*?padding:\s*[\d.]+rem\s+([\d.]+)rem/, 'the panel\'s horizontal padding');

// Chrome measured 106.64px for 'Open in Maps →' at these styles. It moves with the
// font, which is why the check is a SLACK check and not an equality: a font swap
// costs a pixel or two and must not fail the suite; a 40px list-width increase must.
const LINK_MIN_CONTENT = 106.64;

const narrowestPane = lgBreak - sidebar - listW;
const narrowestRow  = narrowestPane - (panelPadX * 2 * ROOT_PX) - 2;   // the panel's 1px borders
const valueTrack    = narrowestRow - labelMax - (rowGap * ROOT_PX);
const slack         = valueTrack - LINK_MIN_CONTENT;

r.ok('the narrowest reachable desktop pane still leaves the link room, with slack',
  slack > 24, { lgBreak, sidebar, listW, narrowestPane, narrowestRow, valueTrack,
                linkMinContent: LINK_MIN_CONTENT, slack: Math.round(slack * 100) / 100 });
// A sanity floor on the read itself: if a regex above silently matched the wrong
// number the slack would be nonsense, and a test that reads nonsense is worse than
// no test. These are the values these files actually hold today.
r.ok('...and the numbers it read are the ones those files actually hold',
  lgBreak === 1024 && sidebar === 232 && listW === 400 && labelMax === 190,
  { lgBreak, sidebar, listW, labelMax });

// ═════════════════════════════════════════════════════════════════════════════
// 6. The new field is a real stored field, not just an input
// ═════════════════════════════════════════════════════════════════════════════
r.head('the site field is wired into the parts that make a field a field');

const T5 = loadApp('fieldLabelFor, fieldSectionFor, OVERVIEW_KEY,');
r.ok('it has a history label, so a history row never shows the raw storage key',
  T5.fieldLabelFor('a_siteLocation') === 'Site location', T5.fieldLabelFor('a_siteLocation'));
r.ok('...and it resolves to the Overview, so its history is gated on Triage like its neighbours',
  T5.fieldSectionFor('a_siteLocation') === T5.OVERVIEW_KEY, T5.fieldSectionFor('a_siteLocation'));
r.ok('it carries the same per-field history button as the other two',
  /hist\('a_siteLocation'\)/.test(editable));
// The LABEL is chrome and comes from the language table; the storage KEY does not.
r.ok('its label comes from the language table',
  /escHtml\(t\('overview\.siteLocation'\)\)/.test(editable) && !/>Site location</.test(editable));
r.ok('the link text does too', /t\('common\.openInMaps'\)/.test(editable));

r.finish();
