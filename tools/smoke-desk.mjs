// Smoke test for desk.css — the ERPNext Desk prototype on the sign-in screen
// and the IR list.
//
//   node tools/smoke-desk.mjs
//
// This file is a PROTOTYPE the owner has not yet approved, and that is the whole
// reason it needs a suite of its own: it loads last, so it overrides the
// `POLISH — level: NOTICEABLE` block, and nothing about a stylesheet stops a
// later rule from escaping its scope. Two things must stay true while it is on
// trial, and neither is visible by looking at the screens:
//
//   1. IT CANNOT LEAK. Every rule is scoped to one of the three selectors the
//      prototype owns, or it is in the one sanctioned global block (the measured
//      status/priority colour steps). If a rule escapes, a screen the owner has
//      not reviewed changes under him and he reviews the prototype by accident.
//   2. IT IS REMOVABLE. That is the same property stated the other way: delete
//      the file and its one <link>, and the app is exactly what it was.
//
// The colour assertions pin MEASUREMENTS, not preferences. Five of six status
// pills failed WCAG AA in both themes before this file; the specific step chosen
// for each one is the fix, and a "tidy-up" that moves one back is a regression
// that no screenshot would show.

import fs from 'node:fs';
import { makeReporter } from './harness.mjs';

const r = makeReporter();
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const desk = read('../desk.css');
const tokens = read('../tokens.css');
const palette = read('../palette.css');
const html = read('../index.html');
const swJs = read('../sw.js');
const deployJs = read('../tools/deploy-ghpages.mjs');

// ── Parse desk.css into rules ────────────────────────────────────────────────
// A linear walk with a selector stack, rather than a `sel { body }` regex: a
// regex cannot tell a media query's opening from a rule's, and it reads
// `@media (…) {` as a selector with the first inner selector as its body — which
// would make the scope check below silently skip every phone rule in the file.
const css = desk.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [];
{
  const stack = [];
  let buf = '';
  for (const ch of css) {
    if (ch === '{') { stack.push(buf.trim()); buf = ''; continue; }
    if (ch === '}') { rules.push({ sel: stack.pop(), decls: buf.trim() }); buf = ''; continue; }
    buf += ch;
  }
}
// A rule, not a container: `@media …` ends up with an empty body here (its
// contents arrive as their own rules), and `:root` with a body full of `--x: y`.
const declRules = rules.filter(x => /:/.test(x.decls));
const selectors = declRules.flatMap(x => x.sel.split(',').map(s => s.trim()));

// ── 1. It is a layer, and it is last ─────────────────────────────────────────
r.head('desk.css is loaded last, and shipped');
const at = html.indexOf('href="desk.css"');
r.ok('index.html links it', at > -1);
r.ok('...AFTER views.css, which is the whole reason it wins',
  at > html.indexOf('href="views.css"'), { desk: at, views: html.indexOf('href="views.css"') });
r.ok('the service worker caches it', /'\.\/desk\.css'/.test(swJs));
r.ok('the deploy tool serves it', /'desk\.css'/.test(deployJs));
// A new file reaches nobody until the cache name moves: the shell is served
// stale-while-revalidate, so the first load after a deploy is the OLD shell.
const cache = swJs.match(/CACHE_NAME\s*=\s*'ipassbook-v(\d+)'/);
r.ok('the cache name was bumped past the version that predates it',
  !!cache && parseInt(cache[1], 10) >= 54, cache && cache[1]);

// ── 2. It cannot leak ────────────────────────────────────────────────────────
r.head('no rule escapes the two screens it is allowed to change');
const SCOPES = /^(#auth-container|#password-change|#index-view)\b/;
// The one sanctioned global block: the status and priority colour steps, and the
// pill's dot. Deliberately NOT scoped — a pill nobody can read is a defect on
// every screen, and fixing it on two of six would leave the app disagreeing with
// itself. It is a fixed list: anything new here has to be argued for.
const GLOBALS = /^(:root|\[data-theme="dark"\]|\.badge|\.badge::before|\.prio-(low|medium|high|urgent)$)/;
const escaped = selectors.filter(s => !SCOPES.test(s) && !GLOBALS.test(s));
r.ok('every rule is scoped, or is one of the sanctioned globals',
  escaped.length === 0, escaped);
r.ok('...and the globals are only the colour steps and the pill dot',
  selectors.filter(s => !SCOPES.test(s)).length <= 14,
  selectors.filter(s => !SCOPES.test(s)));

// A rule that reached `.ir-card-side` is the owner's known defect re-opened: a
// side column that can shrink, or an `overflow` on it, clips a status pill at
// its start edge. views.css carries the long explanation; this is the guard.
r.head('the side column stays untouched');
r.ok('desk.css has no rule for .ir-card-side', !/\.ir-card-side/.test(css));

// ── 3. Token-only ────────────────────────────────────────────────────────────
r.head('every value is an existing token');
// --desk-* is declared here; everything else must come from tokens.css or
// palette.css. The two shadows are the only raw values, and they are Desk's own
// `0 1px 2px rgba(0,0,0,.1)` — a shadow is not a colour role and cannot be a
// token without inventing an elevation scale this app does not have.
const shadows = (css.match(/--desk-shadow:[^;]*;/g) || []).join(' ');
const withoutShadows = css.replace(/--desk-shadow:[^;]*;/g, '');
r.ok('no raw hex anywhere', !/#[0-9a-fA-F]{3,8}\b/.test(withoutShadows),
  (withoutShadows.match(/#[0-9a-fA-F]{3,8}\b/g) || []));
r.ok('no colour function outside the two shadow declarations',
  !/(?:rgba?|hsla?|oklch|color-mix)\(/.test(withoutShadows),
  (withoutShadows.match(/(?:rgba?|hsla?|oklch|color-mix)\(/g) || []));
// A named colour is the one way to add a colour this suite would otherwise miss
// — `background: red` is neither hex nor a function. Every var() is removed
// first, because `--surface-gray-1` contains the word `gray` and a bare keyword
// scan would fail the whole file on its own token names.
const withoutVars = withoutShadows.replace(/var\([^)]*\)/g, '');
const named = withoutVars.match(
  /\b(?:red|green|blue|black|white|gr[ae]y|orange|yellow|purple|pink|brown|cyan|magenta|lime|navy|teal|gold|silver|maroon|olive|aqua|fuchsia|beige|ivory)\b/gi);
r.ok('no named colour anywhere', !named, named);
r.ok('...and the shadows are Desk\'s own two values', /0 1px 2px/.test(shadows), shadows);

const declared = new Set(
  [...(tokens + palette + desk).matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]))];
const unknown = used.filter(t => !declared.has(t));
r.ok('every var() it uses is declared by tokens.css, palette.css or itself',
  unknown.length === 0, unknown);

// ── 4. The measurements, pinned ──────────────────────────────────────────────
// Contrast values are for the pill's own tinted ground, in light / dark. They
// are repeated here from desk.css's header on purpose: this is the assertion,
// that is the explanation, and they must agree.
r.head('the status pills are the AA-safe steps');
const PILL = {
  open:     ['--ink-blue-8',   '5.97', '8.56'],
  paused:   ['--ink-amber-8',  '6.48', '8.31'],
  resolved: ['--ink-green-8',  '7.20', '9.36'],
  closed:   ['--ink-gray-7',   '10.55', '6.63'],
  legacy:   ['--ink-violet-7', '7.01', '6.35'],
  danger:   ['--ink-red-7',    '5.68', '4.81'],
};
for (const [state, [step, light, dark]] of Object.entries(PILL)) {
  const set = (css.match(new RegExp(`--st-${state}-fg:\\s*var\\((--[a-z0-9-]+)\\)`)) || [])[1];
  r.ok(`--st-${state}-fg is ${step}`, set === step, set);
  r.ok(`...and the header still reports ${light} light / ${dark} dark for it`,
    new RegExp(`${step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*${light}[^\\n]*${dark}`).test(desk));
}
r.ok('every step it names is one tokens.css actually emits',
  Object.values(PILL).every(([step]) => declared.has(step)),
  Object.values(PILL).map(([s]) => s).filter(s => !declared.has(s)));

r.head('priority and the muted grey are the AA-safe steps');
const PRIO = { low: '--ink-gray-6', medium: '--ink-blue-8', high: '--ink-amber-8', urgent: '--ink-red-7' };
for (const [name, step] of Object.entries(PRIO)) {
  const set = (css.match(new RegExp(`\\.prio-${name}\\s*\\{\\s*color:\\s*var\\((--[a-z0-9-]+)\\)`)) || [])[1];
  r.ok(`.prio-${name} is ${step}`, set === step, set);
}
// --ink-gray-5 is 4.18:1 on the page and 3.76:1 on a hovered row: it fails AA
// everywhere the list puts it. It must not come back through the alias.
r.ok('--desk-muted is the measured step, not the one that fails',
  /--desk-muted:\s*var\(--ink-gray-6\)/.test(css),
  (css.match(/--desk-muted:[^;]*/) || [])[0]);

// ── 5. The pill keeps giving width back ──────────────────────────────────────
// The border goes (2px back per pill) and the dot grows by 1px. The side column
// can never shrink, so a pill that got wider would squeeze the MIDDLE of the row
// — the direction the owner already reported as a clipped status.
r.head('the pill is not wider than it was');
r.ok('the badges drop their border',
  /\.badge-open[\s\S]{0,120}border-color:\s*transparent/.test(css));
r.ok('the dot is Desk\'s 6px and the pill size is not raised',
  /\.badge::before\s*\{\s*width:\s*6px;\s*height:\s*6px/.test(css) &&
  !/\.badge\s*\{[^}]*font-size/.test(css));

// ── 6. The one phone rule that is a bug fix, not a look ──────────────────────
r.head('the search field stops iOS zooming the page');
// iOS Safari zooms the viewport for any focused field under 16px. .form-input is
// covered in components.css; .search-bar is a different class and was missed, so
// the IR search box — the field with the most typing on the list screen — was
// the one field that sprang the layout open.
// Every 639px block, joined: the file has two (the auth tap-targets and the
// search field) and matching only the first would test the wrong one.
const phoneBlock = [...css.matchAll(/@media \(max-width: 639px\)[^{]*\{([\s\S]*?)\n\}/g)]
  .map(m => m[1]).join('\n');
r.ok('the phone block is a real media query', phoneBlock.length > 0);
r.ok('...and it raises the search field to 16px',
  /#index-view \.search-bar\s*\{[^}]*font-size:\s*16px/.test(phoneBlock), phoneBlock);
r.ok('...and no phone rule in the file lowers a font size',
  !/font-size:\s*(?:0\.\d+rem|1[0-5]px|(?:9|10|11|12|13|14|15)px)/.test(phoneBlock),
  (phoneBlock.match(/font-size:[^;]+/g) || []));

// ── 7. It layers over the polish block, it does not replace it ───────────────
r.head('the chosen look still governs every other screen');
const views = read('../views.css');
r.ok('the POLISH marker is still in views.css',
  /POLISH — level: NOTICEABLE/.test(views));
r.ok('desk.css does not declare a polish level of its own',
  !/POLISH/.test(css), (css.match(/POLISH[^\n]*/) || [])[0]);
// The two rules desk.css reverses on the list are exactly the two the polish
// block owns there; if either were ever deleted from views.css, desk.css would be
// silently depending on nothing.
r.ok('the polish accent chip and gradient still exist to be overridden',
  /\.segment\.active\s*\{\s*background:\s*var\(--accent-soft\)/.test(views) &&
  /\.list-toolbar\s*\{[\s\S]{0,200}?linear-gradient/.test(views));

r.finish();
