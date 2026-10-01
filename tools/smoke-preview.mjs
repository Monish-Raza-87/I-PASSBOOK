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
const PARTS = read('../preview/parts.html');
const EMPTY = read('../preview/empty.html');
const BOARD = read('../preview/board.html');
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
Object.entries({ ...PAGE, index: chooser, parts: PARTS, empty: EMPTY, board: BOARD }).forEach(([k, h]) => {
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
const SKIN_HTML = { ...PAGE, parts: PARTS, empty: EMPTY, board: BOARD };
const skinOf = k => stripCssComments((SKIN_HTML[k].match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '');
// The skin with its own phone block cut out: what it says at every width.
const widePartOf = k => {
  const sheet = skinOf(k);
  const b = phoneBlockOf(sheet);
  return b ? sheet.slice(0, b.at) + sheet.slice(b.end + 1) : sheet;
};
const collisions = [];
// The parts board is a skin too — and a heavier one, because it inlines option
// D's skin whole. That makes it the most likely place for a rule to slip out and
// beat a phone rule nobody was looking at.
[...KEYS, 'parts', 'empty', 'board'].forEach(k => {
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

// ── 7. The parts board ──────────────────────────────────────────────────────
// The board is where the owner judges six components one at a time, and it is
// built from the app's real numbers — the six section letters, the 4/6 chip, the
// toast. Each of those is a copy of something the app owns, and a copy that has
// drifted is worse than no board: it would have him approve a step strip drawn
// over a section list the app no longer has.
r.head('the parts board shows the app\'s own components, not a recollection of them');
const dSkin = (PAGE.d.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const partsSkin = (PARTS.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
// Inheriting D's skin verbatim is what makes the board's buttons, badges, cards
// and tabs the approved direction's buttons, badges, cards and tabs. If the board
// grew its own copy of them, two screens would be showing two designs.
r.ok('parts: carries option D\'s skin verbatim, then its own layer on top',
  partsSkin.startsWith(dSkin) && partsSkin.length > dSkin.length,
  `d=${dSkin.length} parts=${partsSkin.length}`);
r.ok('parts: links the SAME hashed stylesheet as the four options',
  (PARTS.match(/preview\.css\?v=([0-9a-f]+)/) || [])[1] === (PAGE.a.match(/preview\.css\?v=([0-9a-f]+)/) || [])[1]);
// It must not grow a fifth set of the four screens: the comparison is four-way
// and stays four-way, which is the promise the chooser page makes.
r.ok('parts: renders none of the four option screens',
  !/class="pv-phone"/.test(PARTS) && !/class="pv-screens"/.test(PARTS));
r.ok('parts: carries the four headed sections it promises',
  ['steps', 'charts', 'people', 'feedback'].every(id => PARTS.includes(`id="${id}"`)));
r.ok('parts: and a jump list that reaches all four',
  ['#steps', '#charts', '#people', '#feedback'].every(h => PARTS.includes(`href="${h}"`)));
// The board renders the six step letters from a literal list, because the builder
// reads CSS and HTML as text and never evaluates app.js. So the literal is the one
// thing here that can rot silently — and it is checked against the app's own
// SECTION_IDS rather than against itself.
const sectionIds = [...((read('../app.js').match(/const SECTION_IDS\s*=\s*\[([^\]]*)\]/) || [])[1] || '').matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
// The strip is drawn on three demos, so the letters arrive in whole sixes; the
// mod-6 check is what keeps a seventh step from being quietly ignored by the Set.
const allLetters = [...PARTS.matchAll(/class="step-n">([A-Z])<\/span>/g)].map(m => m[1]);
const boardLetters = [...new Set(allLetters)];
const expectedLetters = sectionIds.map(id => id.replace(/^sec-/, '').toUpperCase()).join(',');
r.ok('parts: the six steps are the app\'s six sections, in the app\'s order',
  sectionIds.length === 6 && allLetters.length % 6 === 0 && boardLetters.join(',') === expectedLetters,
  `app=${expectedLetters} board=${boardLetters.join(',')} (${allLetters.length / 6} strips)`);
// The board shows the chip the app draws today beside the new ideas, and that
// chip is a copy of views.css. smoke-list-intel.mjs already pins progressChip's
// markup; this pins the other half — that the board's copy is of the real thing.
const views = read('../views.css');
const boardFill = (partsSkin.match(/\.ir-progress-bar::after\s*\{[^}]*width:\s*([0-9.]+%)/) || [])[1];
r.ok('parts: the copied 4/6 chip still fills 66.666%, as views.css does',
  boardFill === '66.666%' && views.includes('.ir-progress.p4 .ir-progress-bar::after { width: 66.666%; }'),
  `board=${boardFill}`);
// And the comparison against "what the app has today" has to be fair: the pill is
// reproduced WITH base.css's max-width, because without it it stretches to the
// column and looks far worse than the thing it is standing in for.
r.ok('parts: the today-toast keeps a max-width, so the comparison is fair',
  /\.toast-today\s*\{[^}]*max-width:/.test(partsSkin));

// ── 8. The empty-state board ────────────────────────────────────────────────
// This board is asked to recommend a picture, and a recommendation is only worth
// anything if the thing being replaced is shown honestly and the candidates are
// the real files. So the assertions here are about provenance, not taste: the
// states must be the app's own, the frame must be the app's own, and the artwork
// must be the artwork — unmodified in the vendored file and inert in the page.
r.head('the empty-state board shows the app\'s real empty states, not invented ones');
const emptySkin = (EMPTY.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
r.ok('empty: carries option D\'s skin verbatim, then its own layer on top',
  emptySkin.startsWith(dSkin) && emptySkin.length > dSkin.length,
  `d=${dSkin.length} empty=${emptySkin.length}`);
r.ok('empty: links the SAME hashed stylesheet as the four options',
  (EMPTY.match(/preview\.css\?v=([0-9a-f]+)/) || [])[1] === (PAGE.a.match(/preview\.css\?v=([0-9a-f]+)/) || [])[1]);
r.ok('empty: renders none of the four option screens',
  !/class="pv-phone"/.test(EMPTY) && !/class="pv-screens"/.test(EMPTY));
r.ok('empty: carries the six headed sections it promises',
  ['today', 'ours', 'doodles', 'palette', 'others', 'licences'].every(id => EMPTY.includes(`id="${id}"`)));
r.ok('empty: and a jump list that reaches all six',
  ['#today', '#ours', '#doodles', '#palette', '#others', '#licences'].every(h => EMPTY.includes(`href="${h}"`)));

// The board may not invent an empty state. Every sentence it renders is read back
// out of app.js and required to be there, WITH the emoji the app really renders —
// a board that showed a friendlier wording, or a mark the app does not draw,
// would have the owner approve a picture for a screen that does not exist.
const appJs = read('../app.js');
const realStates = [
  ['No IRs match this filter.', '\u{1F50D}'],
  ['No IRs found. Create one via the customer form.', '\u{1F4ED}'],
  ['The flight-log reader did not load. Reload the app and try again.', null],
];
realStates.forEach(([text, mark]) => {
  r.ok(`empty: "${text.slice(0, 34)}…" is the app's own wording`,
    appJs.includes(text) && EMPTY.includes(text));
  if (mark) {
    r.ok(`...and the app really draws it with ${mark}, so the board shows the same`,
      new RegExp(`<span>${mark}</span>`).test(appJs) && EMPTY.includes(mark));
  } else {
    r.ok('...and the third state really has no mark at all in the app', appJs.includes(`<div class="empty-state">${text}`));
  }
});

// The frame the candidates are judged in is a COPY of components.css, and a copy
// that drifted would flatter or damn the wrong candidate. Compared declaration by
// declaration against the real file rather than eyeballed.
const comps = read('../components.css');
const emptyStateRule = (comps.match(/\.empty-state\s*\{([^}]*)\}/) || [])[1] || '';
const decl = s => [...s.matchAll(/([-a-z]+)\s*:\s*([^;]+)/g)].map(m => `${m[1]}:${m[2].trim().replace(/\s+/g, ' ')}`);
const realDecls = decl(emptyStateRule);
r.ok('empty: the .empty-state frame is copied from components.css, declaration for declaration',
  realDecls.length >= 4 && realDecls.every(d => emptySkin.includes(d.replace(/:/, ': ')) ||
    emptySkin.includes(d.replace(/:\s*/, ': ')) || emptySkin.includes(d.split(':')[0] + ': ' + d.split(':').slice(1).join(':'))),
  realDecls.join(' | '));
r.ok('...and the 2.5rem mark it renders is the app\'s size too',
  /\.empty-state span\s*\{[^}]*font-size:\s*2\.5rem/.test(comps) &&
  /\.empty-state span\s*\{[^}]*font-size:\s*2\.5rem/.test(emptySkin));

// The vendored files are third-party markup being pasted into a page. Whatever
// the licence says about the artwork, the page must not inherit a script or a
// fetch from them — and that is a property of the FILE, so it is checked there
// rather than only in the built output.
const vendored = ['open-doodles/unboxing', 'open-doodles/chilling', 'open-doodles/levitate', 'open-peeps/happy', 'humaaans/hero-1']
  .map(n => [`vendor/illustrations/${n}.svg`, read(`../vendor/illustrations/${n}.svg`)]);
vendored.forEach(([p, svg]) => {
  r.ok(`${p.split('/').pop()}: no script, no inline style block, no image element`,
    !/<script/i.test(svg) && !/<style/i.test(svg) && !/<image\b/i.test(svg));
  // The generator credit is a URL that fetches nothing, so it is not a defect in
  // the file — it is a reason the builder has to strip comments before inlining,
  // which is what stops it tripping the no-third-party guard.
  r.ok(`${p.split('/').pop()}: carries no fetching reference outside its comments`,
    !/<[a-z][^>]*(href|src)="https?:/i.test(svg.replace(/<!--[\s\S]*?-->/g, '')));
});
// ...and the built page really is inert, which is the half that matters.
r.ok('empty: the inlined artwork brought no script into the page', !/<script/i.test(EMPTY));
r.ok('...and left no third-party URL behind, comments stripped or not',
  (EMPTY.match(/https?:\/\/[^\s"')]+/g) || []).filter(u => !u.startsWith('https://www.w3.org')).length === 0,
  (EMPTY.match(/https?:\/\/[^\s"')]+/g) || []).filter(u => !u.startsWith('https://www.w3.org')));

// An inlined SVG inherits the PAGE's id space, so two files that share an id — or
// a file that shares one with the page's own sections — would silently repoint a
// clip-path at the wrong element. That shows up as a shape filling in wrong, not
// as an error, which is exactly the class of bug a board is not allowed to have.
const allIds = [...EMPTY.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
r.ok('empty: no id in the page is used twice, artwork included',
  dupes.length === 0, [...new Set(dupes)]);
r.ok('...and the artwork\'s ids are namespaced, so a collision cannot happen by accident',
  allIds.filter(id => id.startsWith('ill-')).length > 0 &&
  vendored.some(([, svg]) => /\sid="/.test(svg)));

// The claim the board makes is that the re-colour is two CSS rules over the SAME
// artwork. If the two cards had different markup, the comparison would be
// between two drawings and would prove nothing about re-colouring at all. The
// instance prefix is stripped before comparing, because the builder gives each
// inlined copy its own id space on purpose — that is what keeps six copies of one
// file from putting the same id on the page six times.
const svgInDemo = label => {
  const i = EMPTY.indexOf(`<b>${label}</b>`);
  const m = i < 0 ? null : EMPTY.slice(i).match(/<svg\b[\s\S]*?<\/svg>/);
  return m && m[0];
};
const withoutInstanceIds = s => s.replace(/ill-[a-z-]+-\d+-/g, 'ill-');
const shipped = svgInDemo('As shipped'), recoloured = svgInDemo('Re-coloured by two rules');
r.ok('empty: the as-shipped and re-coloured cards carry the same artwork, byte for byte',
  !!shipped && !!recoloured && withoutInstanceIds(shipped) === withoutInstanceIds(recoloured),
  `shipped=${shipped ? shipped.length : 'MISSING'} recoloured=${recoloured ? recoloured.length : 'MISSING'}`);
r.ok('...and the only difference between them is the class that re-colours it',
  (() => {
    // The class of the demo that ENCLOSES a caption. `lastIndexOf('<div class=
    // "pv-demo')` is not good enough and quietly returns "pv-demo-cap" for both
    // cards, because the caption's own wrapper also starts with those characters
    // — an assertion that then compares the wrong two things and cannot fail for
    // the reason it exists. The negative lookahead is what excludes it.
    const tag = label => {
      const i = EMPTY.indexOf(`<b>${label}</b>`);
      if (i < 0) return null;
      let last = null;
      for (const m of EMPTY.slice(0, i).matchAll(/<div class="pv-demo(?!-)([^"]*)"/g)) last = m[1];
      return last;
    };
    const a = tag('As shipped'), b = tag('Re-coloured by two rules');
    // The classes must be identical apart from the one that does the work, and
    // the one that does the work must be on the SECOND card only — an assertion
    // that both carried it would pass while proving nothing.
    return !!a && !!b && !/\bpv-tok\b/.test(a) && /\bpv-tok\b/.test(b) &&
      b.replace(/\s*pv-tok/, '') === a;
  })(), 'the two cards must differ only by pv-tok');
// The selector is pinned EXACTLY, prefix and all, and that is not pedantry: the
// first version of this rule was written `.pv-app .pv-tok [fill=…]`, which
// matched nothing, because .pv-tok is the demo wrapper and the artwork is the
// DESCENDANT — so the ancestor combinator ran the wrong way. The rule was valid
// CSS, the build passed, the test passed, and both cards rendered pink. Only
// reading the computed fill value in a browser showed it. A regex that accepted
// any prefix would have gone on passing.
r.ok('...which targets exactly the two fills Open Doodles actually uses, from the demo wrapper down',
  /^\s*\.pv-tok \[fill="#FF5678"\]\s*\{\s*fill:\s*var\(--accent\)/m.test(emptySkin) &&
  /^\s*\.pv-tok \[fill="#000000"\]\s*\{\s*fill:\s*var\(--ink-gray-9\)/m.test(emptySkin));
vendored.filter(([p]) => /open-doodles/.test(p)).forEach(([p, svg]) => {
  const fills = [...new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map(m => m[1].toUpperCase()))].sort();
  r.ok(`${p.split('/').pop()}: is two-tone, which is what makes the two rules sufficient`,
    JSON.stringify(fills) === JSON.stringify(['#000000', '#FF5678']), fills.join(' '));
});

// The palette claim — "it follows all four presets" — is only true if the presets
// are real, so the board's four tiles are checked against palette.css's own
// selectors rather than against a list of names typed here.
const paletteCss = read('../palette.css');
r.ok('empty: all four accent tiles are rendered',
  ['violet', 'teal', 'graphite'].every(p => EMPTY.includes(`data-palette="${p}"`)) && EMPTY.includes('<b>Blue</b>'));
r.ok('...and every one of them is a preset palette.css really defines',
  ['blue', 'violet', 'teal', 'graphite'].every(p => new RegExp(`\\[data-palette="${p}"\\]`).test(paletteCss)));

// The vendored artwork is INLINED, which is the whole reason it can be reviewed
// without a second request. If a file were also served, the page would be paying
// for it twice and the deploy would be carrying a licence question it does not
// need to carry.
r.ok('empty: the artwork is inlined, so none of it is served as a separate file',
  !/vendor\/illustrations/.test(deployJs) && !/vendor\/illustrations/.test(swJs));
r.ok('...and the licence for it is in the repo, beside the files',
  fs.existsSync(url('../vendor/illustrations/LICENSE.md')) &&
  /CC0/.test(read('../vendor/illustrations/LICENSE.md')));

// ── 9. The board ────────────────────────────────────────────────────────────
// This board is asked to recommend a WORKFLOW RULE, and the whole reason it can
// is that the app already stores a workflow stage. That makes every status name,
// every bucket and every count on the page a claim about the app rather than a
// drawing of one — so the assertions here are provenance, not taste: the stages
// must be the app's fourteen, the buckets its four, the section letters its six,
// and the numbers must add up the way the page says they do.
r.head('the board draws the app\'s real workflow, not an invented one');
const boardSkin = (BOARD.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
r.ok('board: carries option D\'s skin verbatim, then its own layer on top',
  boardSkin.startsWith(dSkin) && boardSkin.length > dSkin.length,
  `d=${dSkin.length} board=${boardSkin.length}`);
r.ok('board: links the SAME hashed stylesheet as the four options',
  (BOARD.match(/preview\.css\?v=([0-9a-f]+)/) || [])[1] === (PAGE.a.match(/preview\.css\?v=([0-9a-f]+)/) || [])[1]);
r.ok('board: renders none of the four option screens',
  !/class="pv-phone"/.test(BOARD) && !/class="pv-screens"/.test(BOARD));
r.ok('board: carries the five headed sections it promises',
  ['today', 'stages', 'moves', 'place', 'limits'].every(id => BOARD.includes(`id="${id}"`)));
r.ok('board: and a jump list that reaches all five',
  ['#today', '#stages', '#moves', '#place', '#limits'].every(h => BOARD.includes(`href="${h}"`)));

// The fourteen stages. Read out of app.js rather than typed here, so a status
// added to the app without a column to hold it fails the build instead of
// rendering as a card in no column at all.
const statusValues = [...((appJs.match(/const IR_STATUS_VALUES\s*=\s*\[([^\]]*)\]/) || [])[1] || '').matchAll(/'([^']+)'/g)].map(m => m[1]);
r.ok('board: the app really does store fourteen workflow stages', statusValues.length === 14, statusValues.join(' '));
// The mapping table's first column, which is where every stage on the board is
// named. Every cell is read back and required to be one of the app's own.
const mappedStages = [...BOARD.matchAll(/<tr><td>([^<]+)<\/td>/g)].map(m => m[1]);
r.ok('board: every stage in the mapping table is one of the app\'s own',
  mappedStages.length === 14 && mappedStages.every(s => statusValues.includes(s)),
  mappedStages.filter(s => !statusValues.includes(s)));
// Set equality, not order: the board groups the mapping by column, which is a
// different order from the app's own list. A status the app can store and the
// board cannot place is exactly the silent hole this catches.
r.ok('...and the board places all fourteen, so none can fall off it unnoticed',
  mappedStages.length === statusValues.length &&
  [...mappedStages].sort().join('|') === [...statusValues].sort().join('|'));

// The four buckets, read from STATUS_CATEGORIES' own keys.
const statusCats = (appJs.match(/const STATUS_CATEGORIES\s*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';
const bucketKeys = [...statusCats.matchAll(/^\s*([a-z]+):\s*\[/gm)].map(m => m[1]);
r.ok('board: the four columns are statusCategory\'s four buckets',
  bucketKeys.join(',') === 'open,paused,resolved,closed', bucketKeys.join(','));
r.ok('...and the card that claims to be in one really is a stage from that bucket',
  bucketKeys.every(k => new RegExp(`<span class="pv-kb-col-title">${k[0].toUpperCase() + k.slice(1)}</span>`).test(BOARD)));

// The count the board prints in a column head is not a decoration: the page says
// the seven stage columns add up to the Open tile and no more. A board whose
// totals drifted would have the owner approve a workflow against arithmetic that
// is wrong, which is the one error nobody reading a board can see.
const countIn = (html, title) => {
  const m = html.match(new RegExp(`<span class="pv-kb-col-title">${title}</span><span class="pv-kb-col-count">(\\d+)</span>`));
  return m ? Number(m[1]) : null;
};
const todayHtml = BOARD.slice(BOARD.indexOf('id="today"'), BOARD.indexOf('id="stages"'));
const stagesHtml = BOARD.slice(BOARD.indexOf('id="stages"'), BOARD.indexOf('id="moves"'));
const bucketCounts = ['Open', 'Paused', 'Resolved', 'Closed'].map(t => countIn(todayHtml, t));
r.ok('board: the four buckets are all drawn with a count', bucketCounts.every(n => n !== null), bucketCounts.join(' '));
// The totals the app's own segment strip prints on the list screen — the same
// five numbers the preview shows there. Compared rather than trusted, because
// "these are the counts from the list screen" is a claim the page makes in prose.
const stripCounts = [...(PAGE.d.match(/<div class="segments">([\s\S]*?)<\/div>/) || [])[1].matchAll(/<span class="segment(?: active)?">[^<]*<span class="segment-count">(\d+)<\/span>/g)].map(m => Number(m[1]));
r.ok('board: the bucket counts are the ones the list screen prints, not new ones',
  bucketCounts.join(',') === stripCounts.slice(1).join(','),
  `board=${bucketCounts.join(',')} strip=${stripCounts.join(',')}`);
r.ok('...and they still add up to the total on the strip',
  bucketCounts.reduce((a, b) => a + b, 0) === stripCounts[0],
  `${bucketCounts.reduce((a, b) => a + b, 0)} vs ${stripCounts[0]}`);
// The claim in CAVEAT_STAGES, made checkable: the stage board is a zoom into one
// bucket. If these two numbers ever disagree the page is lying in a caveat, which
// is worse than lying on a card.
const stageCols = [...stagesHtml.matchAll(/<span class="pv-kb-col-count">(\d+)<\/span>/g)].map(m => Number(m[1]));
r.ok('board: the stage columns are seven, and they sum to the Open bucket',
  stageCols.length === 7 && stageCols.reduce((a, b) => a + b, 0) === bucketCounts[0],
  `${stageCols.join('+')}=${stageCols.reduce((a, b) => a + b, 0)} vs Open=${bucketCounts[0]}`);

// The six section letters and names, checked against SECTION_IDS / SECTION_SHORT
// rather than against the literal list in the builder — that literal is the one
// thing on this page that can rot silently, and this is what stops it.
// SECTION_SHORT carries NINE keys, not six: A, H and I are still in the table,
// named "Overview (formerly Section A)", "PDI (now part of G)" and "Dispatch (now
// part of G)". They are retired tabs kept for old links, so a check that asked
// for six would fail on the app being right — and one that asked the board to
// print all nine would have it draw three sections the ticket has not had for
// months. The six are SECTION_IDS, already read in section 7 above; the board is
// held to those and only those.
const shortNames = Object.fromEntries([...appJs.matchAll(/'(sec-[a-z])':\s*'([^']+)'/g)].map(m => [m[1].replace('sec-', '').toUpperCase(), m[2]]));
const liveSections = sectionIds.map(id => id.replace('sec-', '').toUpperCase());
r.ok('board: the app has nine tab names but only six are live sections',
  Object.keys(shortNames).length === 9 && liveSections.length === 6,
  `names=${Object.keys(shortNames).join(',')} live=${liveSections.join(',')}`);
const mappedLetters = [...BOARD.matchAll(/<td><b>([A-G])<\/b> /g)].map(m => m[1]);
r.ok('...and every section column on the board is one of the six',
  mappedLetters.length > 0 && mappedLetters.every(l => liveSections.includes(l)), [...new Set(mappedLetters)].join(','));
r.ok('...and every one of the six is reachable from a stage',
  liveSections.every(l => mappedLetters.includes(l)), liveSections.join(','));
// ...and nothing the app has RETIRED is drawn as if it were current.
r.ok('...and no retired section is drawn as a live column',
  !mappedLetters.some(l => !liveSections.includes(l)) && !/formerly Section A/.test(BOARD));
r.ok('...and the board prints each section under the app\'s own name for it',
  liveSections.every(l => shortNames[l] && BOARD.includes(shortNames[l])),
  liveSections.filter(l => !shortNames[l] || !BOARD.includes(shortNames[l])));

// The chip. A board draws every count there is, so it needs all six fills — the
// parts board carries only .p4 because it only ever draws 4/6. Copied from
// views.css:1786-1791, and compared against it declaration by declaration.
const chipWid = n => (views.match(new RegExp(`\\.ir-progress\\.p${n} \\.ir-progress-bar::after\\s*\\{\\s*width:\\s*([0-9.]+%)`)) || [])[1];
const boardWid = n => (boardSkin.match(new RegExp(`\\.pv-kb-card \\.ir-progress\\.p${n} \\.ir-progress-bar::after\\s*\\{\\s*width:\\s*([0-9.]+%)`)) || [])[1];
r.ok('board: all six progress fills are copies of views.css, not recollections',
  [1, 2, 3, 4, 5, 6].every(n => chipWid(n) && chipWid(n) === boardWid(n)),
  [1, 2, 3, 4, 5, 6].map(n => `p${n}: views=${chipWid(n)} board=${boardWid(n)}`).join(' | '));
// A card that draws a count the board cannot fill would render as an empty track
// with a number beside it — a silent, plausible-looking wrong.
const drawnCounts = [...BOARD.matchAll(/class="ir-progress p(\d)/g)].map(m => Number(m[1]));
r.ok('...and no card draws a count outside 0-6',
  drawnCounts.length > 0 && drawnCounts.every(n => n >= 0 && n <= 6), [...new Set(drawnCounts)].sort().join(','));
// p0 is real and deliberate: progressChip() emits `p${done}` and done can be 0,
// and NEITHER sheet defines a .p0 rule — so a 0/6 card draws an empty track with
// "0/6" beside it, which is exactly the app's own behaviour. Asserting the
// absence on both sides is what stops the board inventing a fill the app does not
// have, and it is why the 0 the check above allows is not a hole in it.
r.ok('...and p0 is left empty in both sheets, as the app leaves it',
  !/\.ir-progress\.p0\b/.test(views) && !/\.ir-progress\.p0\b/.test(boardSkin) &&
  drawnCounts.includes(0), `board draws p0: ${drawnCounts.includes(0)}`);
// ...which only means an EMPTY bar if something sets the base width. views.css
// does (:1776, `width: 0`); D's skin then overrides it with 66.666% inside
// `.pv-app`, and a board card is not inside `.pv-app` — so without the base
// copied here a 0/6 chip computes to `width: auto`, which in a 30px
// overflow-hidden track is a FULL bar. Valid CSS, no error, every test green,
// and the board would have shown "0/6" beside a bar that looked finished.
const chipBase = sheet => (sheet.match(/\.ir-progress-bar::after\s*\{[^}]*?width:\s*([0-9.]+%?|0)\s*;/s) || [])[1];
r.ok('board: the empty base the app relies on is copied, not inherited by luck',
  chipBase(views) === '0' && chipBase(boardSkin) === '0',
  `views=${chipBase(views)} board=${chipBase(boardSkin)}`);

// A board is wide by nature, and the one rule that cannot bend is that the page
// body never scrolls sideways. So the board must carry its own scroll frame —
// and, because a scrollable region with no keyboard route in it is mouse-only,
// an accessible name and a tab stop on that frame.
r.ok('board: the board scrolls inside its own frame, never the page',
  /\.pv-kb-board\s*\{[^}]*overflow-x:\s*auto/.test(boardSkin) &&
  /\.pv-kb-board\s*\{[^}]*overscroll-behavior-x:\s*contain/.test(boardSkin));
// The bug this catches was found by rendering, not by reading. Board A's columns
// were written straight into a .pv-demo-pad with no scroll frame around them, so
// they became BLOCK children of a block: four full-width columns stacked
// vertically, each a "column" only in the source. The page still validated, every
// assertion here passed, and the geometry probe is what showed it — one column
// 449px wide in a board whose columns are 240px.
r.ok('board: no column is a bare child of a demo pad — every one is inside a frame',
  !/pv-demo-pad">\s*<div class="pv-kb-col/.test(BOARD) &&
  (BOARD.match(/class="pv-kb-board"/g) || []).length === 5,
  `${(BOARD.match(/class="pv-kb-board"/g) || []).length} frames`);
r.ok('...and every board on the page is named and reachable by keyboard',
  (BOARD.match(/class="pv-kb-board"/g) || []).length === (BOARD.match(/class="pv-kb-board"[^>]*tabindex="0"/g) || []).length &&
  (BOARD.match(/class="pv-kb-board"[^>]*aria-label="[^"]+"/g) || []).length === (BOARD.match(/class="pv-kb-board"/g) || []).length,
  `${(BOARD.match(/class="pv-kb-board"/g) || []).length} boards`);

// ── 10. The owner can reach it ──────────────────────────────────────────────
r.head('every preview file is served, and none of it is in the app\'s shell');
const PREVIEW_FILES = ['preview/index.html', 'preview/a.html', 'preview/b.html', 'preview/c.html', 'preview/d.html', 'preview/parts.html', 'preview/empty.html', 'preview/board.html', 'preview/preview.css'];
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
