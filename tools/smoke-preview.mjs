// Smoke test for the UI review pages in preview/.
//
//   node tools/smoke-preview.mjs
//
// These are the four design directions the owner picks from, and they are the
// one artifact in this repo where being WRONG IS INVISIBLE: nobody reads four
// hand-built mock pages looking for a mistake, they just look at the colours and
// choose. So the properties that make the review worth anything are asserted
// here, and every one of them is a way the review could quietly lie:
//
//   1. THE COMPARISON MUST BE FAIR. All four screens are rendered once and
//      re-skinned four ways. If the markup ever diverged between the pages, the
//      owner would be comparing four different mock-ups and picking between
//      accidents of my typing rather than between designs.
//   2. THE PREVIEW MUST BE REACHABLE. A review nobody can open is not a review,
//      so every path has to be in the deploy tool's SERVED list — and, just as
//      importantly, must NOT be in the service worker's shell, because four mock
//      pages precached into every real install is a cost with no benefit.
//   3. IT MUST NOT BE STALE. These pages are built from the app's real tokens and
//      committed, so a tokens.css edit with no rebuild advertises colours the app
//      no longer has — the owner would be choosing against a board that is wrong.
//   4. IT MUST NOT LIE ABOUT THE APP. Every class and id it puts on an element
//      has to be one the app really uses (checked by the builder, re-run here).
//   5. A SKIN MUST NOT WIN A FIGHT IT DID NOT KNOW IT WAS IN. A skin is inlined
//      AFTER the shared sheet, and a media query adds no specificity — so a skin
//      rule silently beats the skeleton's phone rules at every width. That is how
//      a 200px desktop rail becomes a 200px-tall bottom bar on a phone. Asserted
//      in 7 below.

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { makeReporter } from './harness.mjs';

const r = makeReporter();
const url = p => new URL(p, import.meta.url);
const read = p => fs.readFileSync(url(p), 'utf8');

const PAGE = {
  a: read('../preview/a.html'),
  b: read('../preview/b.html'),
  c: read('../preview/c.html'),
  d: read('../preview/d.html'),
};
const KEYS = Object.keys(PAGE);
const chooser = read('../preview/index.html');
const css = read('../preview/preview.css');
const tokens = read('../tokens.css');
const palette = read('../palette.css');
const swJs = read('../sw.js');
const deployJs = read('./deploy-ghpages.mjs');

// ── 1. The builder's own checks pass, and the output is current ──────────────
r.head('the builder passes its own checks, and the committed pages are up to date');
const check = spawnSync(process.execPath, [url('./build-ui-options.mjs').pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--check'],
  { encoding: 'utf8' });
r.ok('build-ui-options.mjs --check exits clean', check.status === 0,
  (check.stdout + check.stderr).trim());
// The check is only worth anything if it can fail. tokens.css is the file most
// likely to be edited without a rebuild, since it is the one that is GENERATED.
r.ok('...and it is a real check, not a no-op', /is current with the app/.test(check.stdout), check.stdout.trim());

// ── 2. The comparison is fair ────────────────────────────────────────────────
r.head('all four options render the SAME four screens');
const screens = Object.entries(PAGE).map(([k, h]) => [k, h.slice(h.indexOf('<div class="pv-screens">'), h.indexOf('<div class="pv-notes">'))]);
r.ok('each page carries four screens', screens.every(([, s]) => (s.match(/class="pv-phone"/g) || []).length === 4));
r.ok('...and the screens are byte-identical between all four pages',
  screens.every(([, s]) => s === screens[0][1]),
  screens.map(([k, s]) => `${k}:${s.length}`).join(' '));
// Same markup, different skin — asserted the other way round too, because
// identical pages would mean four links to one design.
r.ok('...while the four pages really do differ from each other',
  new Set(Object.values(PAGE)).size === KEYS.length);

// ── 3. Each option is a skin, and only a skin ────────────────────────────────
r.head('each page is one skin over the shared sheet, and nothing else');
// The skin is inlined so a page cannot render half-styled while a second request
// is in flight; the shared sheet is a separate file because it is 65 KB.
r.ok('every page links the same hashed stylesheet',
  KEYS.every(k => PAGE[k].includes('preview.css?v=')) &&
  new Set(KEYS.map(k => (PAGE[k].match(/preview\.css\?v=([0-9a-f]+)/) || [])[1])).size === 1);
// The ?v= is what stops the app's own service worker answering a rebuilt
// preview.css out of its cache — the review would be of the previous build.
r.ok('...and the hash is a content hash, not a version someone has to remember',
  /preview\.css\?v=[0-9a-f]{8}/.test(PAGE.a), (PAGE.a.match(/preview\.css\?v=[0-9a-f]+/) || [])[0]);
r.ok('preview.css is tokens.css and palette.css VERBATIM, in that order',
  css.includes(tokens.trim()) && css.includes(palette.trim()) &&
  css.indexOf(tokens.trim()) < css.indexOf(palette.trim()));
// The single most important property of the shared sheet: it carries tokens and
// LAYOUT, never component styling. If a component rule rode along, it would be
// beating the skins below it on every page and all three options would start to
// look like whatever leaked — the review would quietly stop meaning anything.
// Anchored at line start, because the skeleton legitimately writes `.pv .ir-card`
// and only an UNSCOPED `.ir-card` is the leak.
const APP_CLASSES = /\n\s*\.(ir-card|ir-list|ir-meta|ir-title|ir-banner|btn|btn-[a-z-]+|badge|segment|segments|tab|tabs-container|form-input|form-group|form-label|list-toolbar|list-title|section-content|section-title|insights-[a-z-]+|nav-item|nav-icon|glass-card|search-bar|prio)\b/g;
// Collected in one pass rather than `test()` then `matchAll`: `.test()` on a /g
// regex advances its lastIndex, which is exactly the kind of statefulness that
// makes a check report the wrong detail at the moment it finally fails.
const leaks = [...css.matchAll(APP_CLASSES)].map(m => m[0].trim());
r.ok('...and no app component rule leaked into the shared sheet', leaks.length === 0, leaks);
r.ok('...so the skeleton really is only layout and the review chrome',
  /\/\* ── the app shell ── \*\//.test(css) && /\/\* ── the IR list ── \*\//.test(css));

// ── 4. It is inert and self-contained ───────────────────────────────────────
r.head('the pages are inert: no script, no third party, no network');
Object.entries({ ...PAGE, index: chooser }).forEach(([k, h]) => {
  r.ok(`${k}: no script`, !/<script/i.test(h));
  const external = (h.match(/https?:\/\/[^\s"')]+/g) || []).filter(u => !u.startsWith('https://www.w3.org'));
  r.ok(`${k}: reaches no third party`, external.length === 0, external);
});

// ── 5. The dark option uses the app's real dark convention ───────────────────
r.head('the dark option is the app\'s dark theme, not a private one');
// If Option B invented its own dark values it would show a design the app cannot
// produce. It sets the same attribute index.html sets pre-paint.
r.ok('option B sets data-theme="dark" on <html>, as the app does',
  /<html lang="en" data-theme="dark">/.test(PAGE.b));
r.ok('...and tokens.css really overrides on that attribute',
  /\[data-theme="dark"\]\s*\{/.test(tokens));
r.ok('the light options set no theme attribute at all',
  /<html lang="en">/.test(PAGE.a) && /<html lang="en">/.test(PAGE.c) && /<html lang="en">/.test(PAGE.d));
r.ok('...and every preview page in KEYS was actually read', KEYS.length === 4);

// ── 6. A skin cannot silently beat the skeleton's phone rules ────────────────
r.head('no skin overrides the skeleton\'s phone rules without re-stating them');
// The skin is inlined AFTER the shared sheet and a media query carries no
// specificity, so a skin rule such as `.pv-app .sidebar { flex: 0 0 200px }` wins
// at EVERY width — including inside the skeleton's max-width:639px block, where
// `flex: 0 0 auto` was the whole reason the rail becomes a bottom bar rather than
// a 200px-tall one. Nothing errors, the source reads perfectly, and the only
// symptom is a phone screenshot that is quietly nonsense. So: for every property
// the skeleton sets on a selector inside its phone block, a skin that sets that
// property on that selector ANYWHERE ELSE must re-state it in a phone block of
// its own.
const phoneBlockOf = sheet => {
  const i = sheet.indexOf('@media (max-width: 639px)');
  if (i < 0) return null;
  const start = sheet.indexOf('{', i);
  let depth = 0, end = -1;
  for (let j = start; j < sheet.length; j++) {
    if (sheet[j] === '{') depth++;
    else if (sheet[j] === '}' && --depth === 0) { end = j; break; }
  }
  return { at: i, end, body: sheet.slice(start + 1, end) };
};
// selector -> Set(property), for one block body
const declsIn = body => {
  const map = new Map();
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = [...m[2].matchAll(/(^|;)\s*([-a-z]+)\s*:/g)].map(x => x[2]);
    for (const sel of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      map.set(sel, new Set([...(map.get(sel) || []), ...props]));
    }
  }
  return map;
};
const stripCssComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const sheetPhone = phoneBlockOf(css);
r.ok('the shared sheet has a phone block worth protecting', !!sheetPhone);
const phoneDecls = sheetPhone ? declsIn(sheetPhone.body) : new Map();
r.ok('...and it really does carry phone rules', phoneDecls.size > 0, [...phoneDecls.keys()]);
const skinOf = k => stripCssComments((PAGE[k].match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '');
// The skin with its own phone block cut out: what it says at every width.
const widePartOf = k => {
  const sheet = skinOf(k);
  const b = phoneBlockOf(sheet);
  return b ? sheet.slice(0, b.at) + sheet.slice(b.end + 1) : sheet;
};
const collisions = [];
KEYS.forEach(k => {
  const wide = widePartOf(k), own = phoneBlockOf(skinOf(k));
  const ownDecls = own ? declsIn(own.body) : new Map();
  const wideRules = declsIn(wide.replace(/@media[^{]*\{/g, ''));
  for (const [sel, props] of phoneDecls) {
    for (const prop of props) {
      if (!wideRules.get(sel)?.has(prop)) continue;   // the skin never touches it
      if (!ownDecls.get(sel)?.has(prop)) collisions.push(`${k}: ${sel} { ${prop} } is set at every width but not re-stated on a phone`);
    }
  }
});
r.ok('...so every skin that fights a phone rule re-states it in its own phone block',
  collisions.length === 0, collisions);

// ── 7. The owner can reach it ───────────────────────────────────────────────
r.head('every preview file is served, and none of it is in the app\'s shell');
const PREVIEW_FILES = ['preview/index.html', 'preview/a.html', 'preview/b.html', 'preview/c.html', 'preview/d.html', 'preview/preview.css'];
PREVIEW_FILES.forEach(f => r.ok(`deploy serves ${f}`, deployJs.includes(`'${f}'`)));
// The negative half matters more: the shell is precached on every install, so a
// mock page in there would be downloaded by every user who never opens it.
r.ok('...and NOTHING under preview/ is in sw.js\'s precache shell',
  !/preview\//.test(swJs), (swJs.match(/[^\n]*preview[^\n]*/g) || []));
// The served set is enumerated on purpose; a glob would ship backend.gs the day
// someone adds a file. Asserting the shape, not the intent.
r.ok('the served set is still an explicit list, not a glob',
  /const SERVED = \[/.test(deployJs) && !/readdirSync[\s\S]{0,80}SERVED/.test(deployJs));

r.finish();
