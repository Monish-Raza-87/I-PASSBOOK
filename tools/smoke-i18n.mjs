// Smoke test for the English language layer.
//
//   node tools/smoke-i18n.mjs
//
// Only English ships, so NOTHING here changes a single word a user reads today.
// That is exactly why it needs a test: a change with no visible effect has no
// natural way to fail, and an indirection that silently resolves to a key — or to
// a blank — would sit in the app looking like it works.
//
// The four properties that make the layer worth having, and that a test has to
// hold up, are:
//
//   1. IT IS WIRED, IN BOTH HALVES. index.html loads it before app.js; sw.js
//      precaches it; the deploy tool serves it. A layer that is not served is a
//      layer that works on the developer's machine and 404s on a phone.
//   2. NO MISSING STRINGS. Every key the markup asks for exists. A missing one is
//      not a grey fallback — it is the raw key on screen.
//   3. NO ORPHANS. Every string is asked for by markup or by code. An orphan is a
//      word that looks translated and is not shipped anywhere, which is how a
//      translation drifts out of step with the app it describes.
//   4. THE FALLBACK IS REAL. The English text stays in the markup AND in the
//      table, and applyStatic() only ever overwrites an element whose key it
//      holds. That is what makes i18n.js failing to load a non-event.

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
// The six-file cascade is the app's own contract (smoke-shell.mjs pins the order).
// A language table added to it would be a seventh stylesheet by the back door.
// The app's rule is SIX local sheets in one pinned cascade (smoke-shell.mjs).
// The Google Fonts link is not part of it — it is the one third-party stylesheet,
// and it is loaded from a CDN, not from this repo.
const localSheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
  .map(m => m[0]).filter(tag => !/^https?:/i.test((tag.match(/href="([^"]+)"/) || [])[1] || ''));
ok('it adds no local stylesheet — the six-file cascade is untouched',
  localSheets.length === 6, localSheets);
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
ok('app.js\'s own t() calls all have strings too',
  [...appJs.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]).every(k => keys.includes(k)),
  [...appJs.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]).filter(k => !keys.includes(k)));

// ── 3. No orphans ────────────────────────────────────────────────────────────
head('no string is dead weight');

// The two status maps are asked for by VALUE, through status()/priority(), so
// their keys are referenced even though no call site names them.
const byValue = new Set([...Object.values(L.I18N.STATUS_KEYS), ...Object.values(L.I18N.PRIORITY_KEYS)]);
const codeKeys = new Set([...appJs.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]));
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
ok('the app stores fourteen statuses', statusValues.length === 14, statusValues.length);
ok('all fourteen are mapped, each to a real string',
  statusValues.every(v => L.I18N.STATUS_KEYS[v] && keys.includes(L.I18N.STATUS_KEYS[v])),
  statusValues.filter(v => !L.I18N.STATUS_KEYS[v]));
ok('...and the map invents no status the app cannot store',
  Object.keys(L.I18N.STATUS_KEYS).every(v => statusValues.includes(v)),
  Object.keys(L.I18N.STATUS_KEYS).filter(v => !statusValues.includes(v)));
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
ok('...and the load handler paints the static chrome, above every early return',
  /window\.addEventListener\('load'[\s\S]{0,400}?window\.I18N\.applyStatic\(\)/.test(appJs));

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

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
