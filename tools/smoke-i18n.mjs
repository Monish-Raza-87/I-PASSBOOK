// Smoke test for the language layer.
//
//   node tools/smoke-i18n.mjs
//
// TWO languages ship — English and हिन्दी — and the second arrived as a data table with no
// call site changed, which is what the first paragraph of i18n.js has promised since the
// day it was written. That promise is exactly why this file needs a test at every step:
// an indirection that silently resolves to a key — or to a blank, or to the English word
// behind a Hindi label — would sit in the app looking like it works.
//
// The properties that make the layer worth having, and that a test has to hold up, are:
//
//   1. IT IS WIRED, IN BOTH HALVES. index.html loads it before app.js; sw.js
//      precaches it; the deploy tool serves it. A layer that is not served is a
//      layer that works on the developer's machine and 404s on a phone.
//   2. NO MISSING STRINGS, IN EITHER TABLE. Every key the markup asks for exists, and
//      every key English has, Hindi has. A missing one is not a grey fallback — it is
//      the raw key on screen, or a Hindi frame around an English body that nobody
//      chose.
//   3. NO ORPHANS. Every string is asked for by markup or by code, and no translation
//      is keyed to something the app can never ask for. Either is a word that looks
//      translated and is not shipped anywhere, which is how a table drifts out of step
//      with the app it describes.
//   4. THE FALLBACK IS REAL. The English text stays in the markup AND in the English
//      table, and lookup() reaches it per string. That is what makes i18n.js failing to
//      load a non-event, and a half-translated screen readable rather than dotted.

import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const i18nJs = read('../i18n.js');
const appJs  = read('../app.js');
const html   = read('../index.html');
const swJs   = read('../sw.js');
const deploy = read('./deploy-ghpages.mjs');

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

// ── Load the layer the way a browser does ────────────────────────────────────
function loadI18n(extra) {
  const ctx = { console: { warn() {} } };
  ctx.window = ctx;
  if (extra) Object.assign(ctx, extra);
  vm.createContext(ctx);
  vm.runInContext(i18nJs, ctx, { filename: 'i18n.js' });
  return ctx;
}
const L = loadI18n();
const STRINGS = L.I18N.STRINGS;
const keys = Object.keys(STRINGS);

// ── 1. It is wired ───────────────────────────────────────────────────────────
head('the layer is wired into the app, the cache and the deploy');

ok('i18n.js is a plain script in index.html',
  /<script src="i18n\.js"><\/script>/.test(html));
ok('...and it loads BEFORE app.js, which reads window.t as it evaluates',
  html.indexOf('<script src="i18n.js">') > -1 &&
  html.indexOf('<script src="i18n.js">') < html.indexOf('<script src="app.js">'),
  [html.indexOf('<script src="i18n.js">'), html.indexOf('<script src="app.js">')]);
ok('...and it is not a module, which app.js could not wait for',
  !/type="module"/.test(html));
// The app's rule is ONE pinned cascade of local sheets (smoke-shell.mjs pins the
// ORDER). This assertion is about the SET: a language table added to it would be a
// new local stylesheet by the back door. It names the sheets rather than counting
// them, because a bare count says "seven" without saying which seven — and on
// 2026-10-03 theme.css legitimately took the list from six to seven.
// The Google Fonts link is not part of it — that is the one third-party stylesheet,
// and it is loaded from a CDN, not from this repo.
const CASCADE = ['tokens.css', 'palette.css', 'theme.css', 'base.css', 'components.css', 'views.css', 'industrial.css'];
const localSheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
  .map(m => m[0]).filter(tag => !/^https?:/i.test((tag.match(/href="([^"]+)"/) || [])[1] || ''));
ok('it adds no local stylesheet — i18n brings words, not another sheet',
  localSheets.map(tag => (tag.match(/href="([^"]+)"/) || [])[1] || '').join('|') === CASCADE.join('|'),
  localSheets.map(tag => (tag.match(/href="([^"]+)"/) || [])[1] || ''));
ok('sw.js precaches it, so an offline phone still has its words',
  /'\.\/i18n\.js'/.test(swJs));
ok('...and the cache name still moves with the version, as that pin requires',
  swJs.includes('ipassbook-v' + (appJs.match(/const APP_VERSION = 'v(\d+)'/) || [])[1]),
  (appJs.match(/const APP_VERSION = '(v\d+)'/) || [])[1] + ' vs ' + (swJs.match(/CACHE_NAME = '([^']+)'/) || [])[1]);
ok('the deploy tool serves it',
  /^\s*'i18n\.js',\s*$/m.test(deploy));

// ── 2. Nothing the markup asks for is missing ────────────────────────────────
head('every key the markup asks for is in the table');

const ATTRS = [
  ['data-i18n',             /\sdata-i18n="([^"]+)"/g],
  ['data-i18n-title',       /\sdata-i18n-title="([^"]+)"/g],
  ['data-i18n-aria',        /\sdata-i18n-aria="([^"]+)"/g],
  ['data-i18n-placeholder', /\sdata-i18n-placeholder="([^"]+)"/g],
];
const asked = new Set();
ATTRS.forEach(([, re]) => { for (const m of html.matchAll(re)) asked.add(m[1]); });

ok('the markup asks for keys at all', asked.size > 20, asked.size);
ok('...and every one of them has a string',
  [...asked].every(k => keys.includes(k)), [...asked].filter(k => !keys.includes(k)));
// `t(` and `tFloor(` — the second is app.js's own helper for a label IT writes rather
// than one the markup carries, and it asks the table for a key exactly like the first.
// A regex that saw only `t(` would call every tFloor key an orphan, which is the failure
// that made this line necessary rather than hypothetical.
const CODE_KEY_RE = /\bt(?:Floor)?\('([^']+)'/g;
ok('app.js\'s own t() calls all have strings too',
  [...appJs.matchAll(CODE_KEY_RE)].map(m => m[1]).every(k => keys.includes(k)),
  [...appJs.matchAll(CODE_KEY_RE)].map(m => m[1]).filter(k => !keys.includes(k)));

// ── 3. No orphans ────────────────────────────────────────────────────────────
head('no string is dead weight');

// The two status maps are asked for by VALUE, through status()/priority(), so
// their keys are referenced even though no call site names them.
const byValue = new Set([...Object.values(L.I18N.STATUS_KEYS), ...Object.values(L.I18N.PRIORITY_KEYS)]);
const codeKeys = new Set([...appJs.matchAll(CODE_KEY_RE)].map(m => m[1]));
const orphans = keys.filter(k => !asked.has(k) && !codeKeys.has(k) && !byValue.has(k));
ok('every string is asked for by markup, by code, or by a status value',
  orphans.length === 0, orphans);

// ── 4. The table itself is sound ─────────────────────────────────────────────
head('the table reads as English, not as a place where words should be');

ok('no value is empty', keys.every(k => String(STRINGS[k]).trim().length > 0),
  keys.filter(k => !String(STRINGS[k]).trim()));
ok('no value is just its own key, which is what a pasted key looks like',
  keys.every(k => STRINGS[k] !== k), keys.filter(k => STRINGS[k] === k));
ok('keys are lowercase dotted paths, so they sort and read predictably',
  keys.every(k => /^[a-z][A-Za-z0-9]*(\.[a-zA-Z0-9]+)+$/.test(k)),
  keys.filter(k => !/^[a-z][A-Za-z0-9]*(\.[a-zA-Z0-9]+)+$/.test(k)));
ok('there are no duplicate keys — the later one silently wins, so this is not cosmetic',
  keys.length === new Set(keys).size);

// Every {slot} a string declares must be filled by someone. A slot with no
// supplier renders literally as "{n}" on screen.
const slotted = keys.filter(k => /\{\w+\}/.test(STRINGS[k]));
const declared = new Set(slotted.flatMap(k => [...STRINGS[k].matchAll(/\{(\w+)\}/g)].map(m => m[1])));
const supplied = new Set([...html.matchAll(/\sdata-i18n-var-(\w+)=/g)].map(m => m[1]));
const codeSlots = new Set([...appJs.matchAll(/\bt\('[^']+',\s*\{([^}]*)\}/g)]
  .flatMap(m => [...m[1].matchAll(/(\w+)\s*:/g)].map(x => x[1])));
ok('every {slot} a string declares is supplied by a data-i18n-var-* or a call site',
  [...declared].every(s => supplied.has(s) || codeSlots.has(s)),
  { declared: [...declared], supplied: [...supplied], codeSlots: [...codeSlots] });
ok('the close buttons supply their letter, so no button shows a bare {letter}',
  (html.match(/data-i18n="section\.close" data-i18n-var-letter="[A-G]"/g) || []).length === 6);

// ── The workflow statuses, mapped one for one ────────────────────────────────
head('every workflow status has a word, and no word has no status');
const statusValues = [...((appJs.match(/const IR_STATUS_VALUES\s*=\s*\[([^\]]*)\]/) || [])[1] || '')
  .matchAll(/'([^']+)'/g)].map(m => m[1]);
ok('the app stores ten statuses', statusValues.length === 10, statusValues.length);
ok('all ten are mapped, each to a real string',
  statusValues.every(v => L.I18N.STATUS_KEYS[v] && keys.includes(L.I18N.STATUS_KEYS[v])),
  statusValues.filter(v => !L.I18N.STATUS_KEYS[v]));
// The map carries a SECOND arm now, and this is the assertion that keeps it honest.
// The eight words the Sheet wrote before the vocabulary changed, plus Other, are
// still held by tickets in the store — and the map must reach the same string as the
// stage each one now means, because that shared key is the whole mechanism by which
// an old ticket reads as a word instead of as a raw stored value.
const RETIRED_WORDS = ['Hold', 'Visual Inspection', 'QC Investigation', 'QC',
                       'Flight Test', 'PDI', 'Approval', 'Close', 'Other'];
const FOLD = { 'Hold': 'On Hold', 'Visual Inspection': 'Inspection',
               'QC Investigation': 'Investigation', 'QC': 'Quality Test',
               'Flight Test': 'Quality Test', 'PDI': 'PDI/Dispatch',
               'Approval': 'PDI/Dispatch', 'Close': 'Delivered' };
ok('every retired word is mapped too, and to the stage it means',
  RETIRED_WORDS.every(w => L.I18N.STATUS_KEYS[w] &&
    (w === 'Other' ? true : L.I18N.STATUS_KEYS[w] === L.I18N.STATUS_KEYS[FOLD[w]])),
  RETIRED_WORDS.filter(w => !L.I18N.STATUS_KEYS[w]));
ok('...so an old ticket reads as its stage, not as its stored word',
  L.I18N.status('QC Investigation') === 'Investigation' &&
  L.I18N.status('Close') === 'Delivered' &&
  L.I18N.status('Hold') === 'On Hold',
  [L.I18N.status('QC Investigation'), L.I18N.status('Close'), L.I18N.status('Hold')]);
ok('...while Other still reads as itself, since it is not a stage',
  L.I18N.status('Other') === 'Other');
ok('...and the map invents no status the app can neither store nor fold',
  Object.keys(L.I18N.STATUS_KEYS).every(v => statusValues.includes(v) || RETIRED_WORDS.includes(v)),
  Object.keys(L.I18N.STATUS_KEYS).filter(v => !statusValues.includes(v) && !RETIRED_WORDS.includes(v)));
ok('a status with no mapping reads as the stored value, never as blank',
  L.I18N.status('Something New') === 'Something New' && L.I18N.status('') === '');

const priorities = [...((appJs.match(/const TICKET_PRIORITIES = \[([^\]]*)\]/) || [])[1] || '')
  .matchAll(/'([^']+)'/g)].map(m => m[1]);
ok('every priority the app offers has a word too',
  priorities.length > 0 && priorities.every(p => L.I18N.PRIORITY_KEYS[String(p).toLowerCase()]),
  priorities.filter(p => !L.I18N.PRIORITY_KEYS[String(p).toLowerCase()]));

// ── The behaviours the app leans on ──────────────────────────────────────────
head('t(), status() and applyStatic() behave the way callers assume');

ok('t() returns the string', L.t('list.title') === 'IRs');
ok('t() fills its slots', L.t('board.more', { n: 3 }) === '+3 more — see list', L.t('board.more', { n: 3 }));
ok('t() leaves a slot alone when no value is given, rather than writing "undefined"',
  L.t('board.more') === '+{n} more — see list', L.t('board.more'));
ok('t() returns the KEY when it has no string — visibly wrong, never blank',
  L.t('totally.made.up') === 'totally.made.up');
ok('...and it says so once per key, so the failure is findable in a console',
  (() => {
    const c = loadI18n();
    let n = 0;
    c.console.warn = () => n++;
    c.I18N.t('x.y'); c.I18N.t('x.y'); c.I18N.t('x.y');
    return n === 1;
  })());

// The wrapper app.js uses, under a sandbox where i18n.js never loaded. That is
// the flaky-network case: the app must stay readable, not throw.
const noLayer = (() => {
  const ctx = { console };
  // app.js's wrapper reads `window.I18N`, so the sandbox needs a window — one with
  // nothing on it, which is exactly the "i18n.js never arrived" case.
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    'const t = (key, vars) => (window.I18N ? window.I18N.t(key, vars) : key);\n' +
    'globalThis.__t = t;', ctx);
  return vm.runInContext('__t("list.title")', ctx);
})();
ok('with the layer missing entirely, app.js\'s wrapper returns the key and does not throw',
  noLayer === 'list.title', noLayer);
ok('...and app.js really does guard its three handles that way',
  /window\.I18N \? window\.I18N\.t\(key, vars\) : key/.test(appJs) &&
  /window\.I18N \? window\.I18N\.status\(v\) : v/.test(appJs) &&
  /window\.I18N \? window\.I18N\.priority\(v\) : v/.test(appJs));

// tFloor — the SECOND wrapper, and the one whose degradation runs the other way.
//
// These are not two spellings of one helper and this block is what stops a later reader
// merging them: t() shows the KEY when the layer is missing, tFloor() shows the ENGLISH.
// The English is right for a button label app.js writes itself (its English is already in
// the markup, and a dotted key on a button is worse than a word in the wrong language) and
// wrong for everything else, where a visible key is the only thing that gets a missing
// string fixed. Both behaviours are asserted, so merging them fails a test rather than
// failing silently on somebody's phone.
const tFloorSrc = (appJs.match(/const tFloor = \(key, english\) => \{[\s\S]*?\n\};/) || [])[0] || '';
const floor = (i18n, key, english) => {
  const ctx = { window: { I18N: i18n } };
  vm.createContext(ctx);
  vm.runInContext(
    tFloorSrc + '\nglobalThis.__r = tFloor(' + JSON.stringify(key) + ', ' + JSON.stringify(english) + ');',
    ctx);
  return ctx.__r;
};
ok('tFloor exists in app.js and is a real function', tFloorSrc.length > 40, tFloorSrc.length);
ok('...it returns the table\'s string when the layer is loaded',
  floor({ t: () => 'जारी रखें' }, 'auth.continue', 'Continue') === 'जारी रखें');
ok('...it returns the ENGLISH when i18n.js never loaded — never a dotted key on a button',
  floor(null, 'auth.continue', 'Continue') === 'Continue');
ok('...and the English too when the layer loaded but holds no such key',
  floor({ t: k => k }, 'auth.continue', 'Continue') === 'Continue');
ok('...which is the opposite of t(), and that is the point of having both',
  floor({ t: k => k }, 'auth.continue', 'Continue') === 'Continue' && noLayer === 'list.title');
// The landing page's own two buttons, and the four view titles: every label app.js writes
// by hand on a screen a reader sees BEFORE signing in. A hard-coded English literal here
// is invisible in testing and obvious the moment the picker is switched.
const handWritten = ['auth.continue', 'auth.signIn', 'auth.sending', 'auth.signingIn'];
ok('the sign-in buttons\' four labels are asked for through the table, not written by hand',
  handWritten.every(k => appJs.includes(`'${k}'`)) &&
  !/signBtn\.textContent = pwMode \? 'Sign in' : 'Continue'/.test(appJs) &&
  !/setBusy\(signInBtn, 'Sending…'\)/.test(appJs) &&
  !/setBusy\(signBtn, 'Sending…'\)/.test(appJs),
  handWritten.filter(k => !appJs.includes(`'${k}'`)));
ok('...and the four view titles too, so no header reads English under a Hindi sidebar',
  ['app.name', 'nav.insights', 'nav.logAnalyser', 'nav.help']
    .every(k => new RegExp(`headerTitle\\.textContent = tFloor\\('${k.replace('.', '\\.')}'`).test(appJs)));
// The claim is not "within N characters of the handler's first line" — that was a
// stand-in for the real one, and it broke the moment the handler grew an honest
// comment above the call. The claim is that the paint comes BEFORE any way out of the
// handler, so a device that takes an early return (an already-signed-in session, a
// Google return, a brief splash) still gets its chrome in the chosen language.
ok('...and the load handler paints the static chrome, above every early return',
  (() => {
    const start = appJs.indexOf("window.addEventListener('load'");
    if (start < 0) return false;
    const head = appJs.slice(start, start + 2000);
    const paint = head.indexOf('window.I18N.applyStatic()');
    const exit = head.indexOf('return');
    return paint > 0 && (exit < 0 || paint < exit);
  })());

// applyStatic, driven against a stand-in DOM.
//
// `dataset` is built from the attributes at construction rather than left empty,
// because that is what the real DOM does: `data-i18n-placeholder` IS
// `el.dataset.i18nPlaceholder`. A stub with a blank dataset would let applyStatic
// look correct while reading every key as undefined — the test would pass for the
// wrong reason, which is the one failure mode a test may not have.
const fake = (attrs) => {
  const a = new Map(Object.entries(attrs));
  const dataset = {};
  for (const [k, v] of a) {
    const m = /^data-(.+)$/.exec(k);
    if (m) dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return {
    dataset, _attrs: a, textContent: null, title: null,
    get attributes() { return [...a.entries()].map(([name, value]) => ({ name, value })); },
    setAttribute(n, v) { a.set(n, String(v)); },
    getAttribute: n => (a.has(n) ? a.get(n) : null),
  };
};
const textEl  = fake({ 'data-i18n': 'list.title' });
const noKeyEl = fake({ 'data-i18n': 'nope.nope' });
const ariaEl  = fake({ 'data-i18n-aria': 'auth.showPassword' });
const slotEl  = fake({ 'data-i18n': 'section.close', 'data-i18n-var-letter': 'E' });
const holder = { textEl, noKeyEl, ariaEl, slotEl };
const dom = {
  querySelectorAll: sel => {
    const want = sel.replace(/[[\]]/g, '');
    return Object.values(holder).filter(el => el.getAttribute(want) !== null);
  },
};
const D = loadI18n({ document: dom });
D.I18N.applyStatic();
ok('applyStatic fills an element whose key it holds', textEl.textContent === 'IRs', textEl.textContent);
ok('...and LEAVES ALONE one whose key it does not, so the markup\'s own English stands',
  noKeyEl.textContent === null, noKeyEl.textContent);
ok('it fills an aria-label as readily as text', ariaEl.getAttribute('aria-label') === 'Show password');
ok('it fills {slots} from data-i18n-var-*, so one string covers six buttons',
  slotEl.textContent === 'Mark Section E completed', slotEl.textContent);
// A translation is data a translator writes. Writing it as markup would let a
// stray angle bracket in one become a tag.
ok('it writes textContent, never innerHTML',
  /el\.textContent = s/.test(i18nJs) && !/\.innerHTML\s*=/.test(i18nJs));

// ── The board's own words, as the first real customer of the layer ───────────
head('the wording the board and the list show comes from the table');
ok('the list and the board draw the same filtered-empty wording',
  (appJs.match(/t\('list\.emptyFiltered'\)/g) || []).length === 2,
  (appJs.match(/t\('list\.emptyFiltered'\)/g) || []).length);
ok('the board\'s own empty sentence is its own — the list\'s says "create one via the form"',
  STRINGS['board.emptyNone'] === 'No IRs found.' &&
  !/customer form/.test(STRINGS['board.emptyNone']) &&
  /customer form/.test(STRINGS['list.emptyNone']));
ok('the autosave indicator asks the table for all four of its states',
  ['common.saved', 'common.saving', 'common.notSaved', 'common.retrying']
    .every(k => appJs.includes(`t('${k}')`)));
ok('the close button label is built from the table, not concatenated',
  /t\('section\.close', \{ letter: sectionId\.replace\('sec-', ''\)\.toUpperCase\(\) \}\)/.test(appJs));
ok('...and no section button is left with a hand-written label',
  !/`Mark Section \$\{/.test(appJs));

// ── The second language ───────────────────────────────────────────────────────
//
// Hindi arrived on 2026-10-08 as a table and nothing else, which is the claim this
// section has to hold up: that the option in the picker is backed by real words, that
// it is keyed to the same keys as English, and that the English fallback it sits on top
// of is still a floor rather than a competitor.
//
// Urdu is checked for ABSENCE here rather than simply left untested, because "the owner
// withdrew it" and "someone re-added it" look identical from the source unless a test
// says which one is wanted.
head('हिन्दी is a real table, and English is still the floor');

const H = loadI18n();
const LANGS = H.I18N.LANGS;

ok('the picker offers exactly two languages, English first',
  LANGS.length === 2 && LANGS[0].code === 'en' && LANGS[1].code === 'hi',
  LANGS.map(l => l.code));
ok('Urdu is gone from the list, not merely untranslated',
  !LANGS.some(l => l.code === 'ur') && !/اردو/.test(i18nJs));
ok('...and every entry is a code, an endonym and a direction',
  LANGS.every(l => /^[a-z]{2}$/.test(l.code) && String(l.label).trim() && /^(ltr|rtl)$/.test(l.dir)));
ok('...with the label as the language\'s OWN name, so a reader can find it',
  LANGS[1].label === 'हिन्दी');
// Every language with a table must change the reading direction the page claims, and a
// language without one must not. Both languages here are ltr, so this asserts the guard
// exists rather than that it fires — the day an rtl language returns, it fires there.
ok('the direction guard is keyed on having a table, not on the list',
  /if \(ready\(_lang\)\) document\.documentElement\.dir = meta\.dir/.test(i18nJs));

const hi = H.I18N.TABLES.hi;
const hiKeys = Object.keys(hi || {});
ok('the Hindi table exists and is not a stub', hiKeys.length > 100, hiKeys.length);
ok('...and it translates every string English has — no gaps to fall through',
  keys.every(k => hiKeys.includes(k)), keys.filter(k => !hiKeys.includes(k)));
ok('...and invents none English does not have, or the word is unreachable',
  hiKeys.every(k => keys.includes(k)), hiKeys.filter(k => !keys.includes(k)));
ok('...with no empty value', hiKeys.every(k => String(hi[k]).trim().length > 0),
  hiKeys.filter(k => !String(hi[k]).trim()));
ok('...and it is a TRANSLATION, not the English table copied',
  hiKeys.filter(k => hi[k] !== STRINGS[k]).length > 100,
  hiKeys.filter(k => hi[k] !== STRINGS[k]).length);

// A slot dropped in translation renders a literally broken control — "{n}" as the
// heading text of a six-box code step. The two tables must declare the same slots in
// the same string, key for key.
const slotMismatch = hiKeys.filter(k => {
  const a = (STRINGS[k].match(/\{\w+\}/g) || []).sort().join(',');
  const b = (String(hi[k]).match(/\{\w+\}/g) || []).sort().join(',');
  return a !== b;
});
ok('every {slot} survives translation, so no control renders a bare {n}',
  slotMismatch.length === 0, slotMismatch);

// The four kinds of string that must NOT be translated, each because translating it
// changes what it POINTS AT rather than what it reads as. The note above the Hindi table
// in i18n.js gives the reasoning; this is the half that fails when someone "finishes the
// translation" by rendering the acronym expansion or the section letter into Devanagari.
ok('the name, its expansion, and the two identifiers the user types are not translated',
  hi['app.name'] === 'I-PASSBOOK' &&
  hi['app.fullName'] === 'INDRONES-AFTER SALES SERVICE BOOK' &&
  hi['auth.email'] === 'you@indrones.com' &&
  hi['cust.email'] === 'you@company.com' &&
  hi['overview.phoneHint'] === '+91 XXXXX XXXXX',
  [hi['app.name'], hi['app.fullName'], hi['auth.email'], hi['cust.email'], hi['overview.phoneHint']]);
ok('...and the section letter stays Latin, because the tab above the button says "B"',
  hi['section.close'].includes('{letter}') &&
  ['B', 'C', 'D', 'E', 'F', 'G'].every(L => String(hi['section.' + L.toLowerCase()]).includes(L)),
  ['B', 'C', 'D', 'E', 'F', 'G'].filter(L => !String(hi['section.' + L.toLowerCase()]).includes(L)));
// The desk's address, in the two sentences that carry it. It reaches a reader ONLY
// through this table (app.js is asserted free of it), so a translation that dropped it
// would leave a person with an instruction and no address.
ok('the desk\'s address survives in both Hindi sentences that carry it',
  (hi['cust.unregistered'].match(/customer\.relations@indrones\.com/g) || []).length === 1 &&
  (hi['cust.tempPasswordNoCode'].match(/customer\.relations@indrones\.com/g) || []).length === 1);
// The menu row it names is a literal in app.js and is not translated, so the instruction
// has to quote the English.
ok('the unlock guidance still quotes the menu row by its real, English label',
  hi['auth.methodInactive.step3'].includes('Turn on Quick unlock') &&
  appJs.includes("btn.textContent = 'Turn on Quick unlock'"));

// The behaviour, not the table: pick Hindi and the words change; ask for a key Hindi does
// not hold and English still answers.
//
// These load with a stand-in `document` because setLang() repaints the static chrome as
// part of switching (`applyStatic()` reaches for `document.querySelectorAll`), and a
// context without one would throw on the repaint rather than on anything being tested.
// A browser always has a document; the sandbox has to be told to have one.
const withDom = () => loadI18n({ document: { documentElement: {}, querySelectorAll: () => [] } });
const HS = withDom();
ok('setLang("hi") is accepted and remembered for the session',
  HS.I18N.setLang('hi') === true && HS.I18N.lang() === 'hi');
ok('...and the app then reads in Hindi',
  HS.t('list.title') === 'IR' && HS.t('auth.continue') === 'जारी रखें',
  [HS.t('list.title'), HS.t('auth.continue')]);
ok('...with the slots still filled from the call site',
  HS.t('board.more', { n: 3 }) === '+3 और — सूची देखें', HS.t('board.more', { n: 3 }));
ok('...and a status word folds a retired Sheet value into its Hindi stage',
  HS.I18N.status('QC Investigation') === 'जाँच', HS.I18N.status('QC Investigation'));
ok('a stored "ur" is refused as a choice and reconciled to English on load, not left dangling',
  HS.I18N.setLang('ur') === false && HS.I18N.setLang('ur-PK') === false);
// The floor: a language with a table still falls back per-string, which is what keeps a
// partially translated screen readable instead of dotted. The table is replaced by a
// one-key one rather than by a real second language, because the claim is about the
// FALLBACK and a smaller table makes the fallback visible.
ok('...and the English floor is what answers a key the other table lacks',
  (() => {
    const S = withDom();
    S.I18N.TABLES.hi = { 'list.title': 'IR' };
    S.I18N.setLang('hi');
    return S.t('list.title') === 'IR' && S.t('auth.continue') === 'Continue';
  })());

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
