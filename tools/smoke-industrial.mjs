// Smoke test for industrial.css — INDRONES INDUSTRIAL, the app's whole look, which
// the owner chose on 2026-10-08 (it replaced the ERPNext Desk prototype, and that
// file is deleted rather than dormant).
//
//   node tools/smoke-industrial.mjs
//
// The suite has the same two jobs it had when this slot held a two-screen prototype,
// and neither is visible by looking at the screens:
//
//   1. IT CANNOT LEAK. Every rule is scoped to one of the eight roots the look owns,
//      or it is in the one sanctioned global block (the measured status/priority
//      colour steps). If a rule escapes, a screen nobody has looked at changes under
//      it — and the list went from six roots to eight, so the surface this guard is
//      protecting is larger, not smaller.
//   2. IT IS REMOVABLE. That is the same property stated the other way: delete the
//      file and its one <link>, and the app is exactly what it was. That is why the
//      whole look lives in one file, and why every rule restyles a class that already
//      exists rather than needing markup to go with it. The one place this look could
//      have broken that rule — the LED — is a ::before on the app's own .badge.
//
// The colour assertions pin MEASUREMENTS, not preferences. Five of six status pills
// failed WCAG AA in both themes before this file existed; the specific step chosen
// for each one is the fix, and a "tidy-up" that moves one back is a regression no
// screenshot would show.

import fs from 'node:fs';
import { makeReporter } from './harness.mjs';

const r = makeReporter();
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../industrial.css').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = read('../tokens.css');
const palette = read('../palette.css');
const base = read('../base.css');
const html = read('../index.html');
const swJs = read('../sw.js');
const deployJs = read('./deploy-ghpages.mjs');
const views = read('../views.css');

// ── Parse industrial.css into rules ───────────────────────────────────────────
// A linear walk with a selector stack, rather than a `sel { body }` regex: a regex
// cannot tell a media query's opening from a rule's, and it reads `@media (…) {` as a
// selector with the first inner selector as its body — which would make the scope
// check below silently skip every phone rule in the file.
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
// A rule, not a container: `@media …` ends up with an empty body here (its contents
// arrive as their own rules), and `:root` with a body full of `--x: y`.
const declRules = rules.filter(x => /:/.test(x.decls));
const selectors = declRules.flatMap(x => x.sel.split(',').map(s => s.trim()));

// ── 1. It is a layer, and it is last ──────────────────────────────────────────
r.head('industrial.css is loaded last, and shipped');
const at = html.indexOf('href="industrial.css"');
r.ok('index.html links it', at > -1);
r.ok('...AFTER views.css, which is the whole reason it wins',
  at > html.indexOf('href="views.css"'), { industrial: at, views: html.indexOf('href="views.css"') });
r.ok('the service worker caches it', /'\.\/industrial\.css'/.test(swJs));
r.ok('the deploy tool serves it', /'industrial\.css'/.test(deployJs));
// A new file reaches nobody until the cache name moves: the shell is served
// stale-while-revalidate, so the first load after a deploy is the OLD shell.
const cache = swJs.match(/CACHE_NAME\s*=\s*'ipassbook-v(\d+)'/);
r.ok('the cache name was bumped past the version that predates it',
  !!cache && parseInt(cache[1], 10) >= 73, cache && cache[1]);
// The file it replaced is gone, not dormant. Two looks in the repo is one look too
// many: the one nobody is loading goes stale invisibly and gets "restored" later.
r.ok('the Desk prototype it replaced was deleted, not left behind',
  !fs.existsSync(new URL('../desk.css', import.meta.url)) &&
  !/desk\.css/.test(html) && !/desk\.css/.test(swJs) && !/desk\.css/.test(deployJs));

// ── 2. It cannot leak ─────────────────────────────────────────────────────────
r.head('no rule escapes the eight roots it is allowed to change');
// The eight roots are the app's own view containers plus the two shell bands, not a
// list of screens that happened to be reviewed. #index-view carries the IR list AND
// the board switch; #detail-view is one IR; #insights-view and #log-view are the two
// read-only panes. #sidebar and #workspace header are the chrome — the first is ALSO
// the phone bottom bar, because it is the same element re-laid out, so styling it
// covers the phone with no second rule. Widening this list is the whole cost of
// applying the look to another screen, and the reason it is a list at all is that a
// rule escaping it changes a screen nobody has looked at.
const SCOPES = /^(#auth-container|#password-change|#index-view|#detail-view|#insights-view|#log-view|#sidebar|#workspace header)\b/;
// The one sanctioned global block: the status and priority colour steps. Deliberately
// NOT scoped — a pill nobody can read is a defect on every screen, and fixing it on
// three of eight would leave the app disagreeing with itself. It is a fixed list:
// anything new here has to be argued for.
const GLOBALS = /^(:root|\[data-theme="dark"\]|\.prio-(low|medium|high|urgent)$)/;
const escaped = selectors.filter(s => !SCOPES.test(s) && !GLOBALS.test(s));
r.ok('every rule is scoped, or is one of the sanctioned globals',
  escaped.length === 0, escaped);
r.ok('...and the globals are only the colour steps',
  selectors.filter(s => !SCOPES.test(s)).length <= 14,
  selectors.filter(s => !SCOPES.test(s)));

// A rule that reached `.ir-card-side` is the owner's known defect re-opened: a side
// column that can shrink, or an `overflow` on it, clips a status pill at its start
// edge. views.css carries the long explanation; this is the guard.
r.head('the side column stays untouched');
r.ok('industrial.css has no rule for .ir-card-side', !/\.ir-card-side/.test(css));

// ── 3. Token-only ────────────────────────────────────────────────────────────
r.head('every value is an existing token');
// The corner block writes `0px` and nothing else raw; there is no shadow in this file
// at all, which is itself the design (nothing on an instrument panel floats). So the
// raw-value checks below are allowed to be absolute.
r.ok('no raw hex anywhere', !/#[0-9a-fA-F]{3,8}\b/.test(css),
  (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []));
r.ok('no colour function anywhere', !/(?:rgba?|hsla?|oklch|color-mix|linear-gradient)\(/.test(css),
  (css.match(/(?:rgba?|hsla?|oklch|color-mix|linear-gradient)\(/g) || []));
// A named colour is the one way to add a colour this suite would otherwise miss —
// `background: red` is neither hex nor a function. Every var() is removed first,
// because `--surface-gray-1` contains the word `gray` and a bare keyword scan would
// fail the whole file on its own token names.
const named = css.replace(/var\([^)]*\)/g, '').match(
  /\b(?:red|green|blue|black|white|gr[ae]y|orange|yellow|purple|pink|brown|cyan|magenta|lime|navy|teal|gold|silver|maroon|olive|aqua|fuchsia|beige|ivory)\b/gi);
r.ok('no named colour anywhere', !named, named);

// base.css is in this list, and it has to be. It DECLARES the brand yellow — #ffc400,
// Indrones' own — because there is no yellow ramp in tokens.css for palette.css to
// point at, and palette.css is pure var() onto tokens.css by rule (smoke-palette fails
// on any raw colour in it). So base.css is where a colour this file may legitimately
// read can live, and the two `--ind-*` names used below are written there once, with
// their reasoning, and measured by smoke-palette like every other colour in the app.
const declared = new Set(
  [...(tokens + palette + base + css).matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]))];
const unknown = used.filter(t => !declared.has(t));
r.ok('every var() it uses is declared by tokens.css, palette.css, base.css or itself',
  unknown.length === 0, unknown);

// ── 3b. The two colour traps this file fell into on its first render ─────────
// Both were real, both shipped to a screenshot before they were caught, and both are
// invisible to every check above: `--ink-gray-2` IS a declared token and `#ffc400` IS
// a real colour. They are checked here so they are not re-introduced by a later hand.
r.head('the file reads the accent role, not the brand yellow, and never a -1/-2/-3 ink step');

// THE INK RAMP INVERTS. --ink-gray-1 is #ededed in light and #242424 in dark, so it
// is near-the-page in one theme and near-the-type in the other; -9 is primary text in
// both. A rule that colours text with -1/-2/-3 is therefore unreadable in exactly one
// of the two themes, and there is no way to see that by reading the rule.
const inkText = [...css.matchAll(/color:\s*var\(--ink-gray-([1-5])\)/g)].map(m => m[1]);
r.ok('no text is coloured with --ink-gray-1 … -5, which invert or fail AA',
  inkText.length === 0, inkText);
r.ok('...and the primary text step it uses instead is --ink-gray-9',
  /color:\s*var\(--ink-gray-9\)/.test(css));

// The brand yellow is 11.18:1 on the dark ground and ~1.4:1 on a light one, so every
// mark and every accent word has to go through the accent role, which palette.css
// already resolved per theme. That it also carries the other four palettes is
// checked by smoke-palette; this is the half that belongs to this file.
r.ok('the brand yellow is named nowhere — every mark is the accent role',
  !/--ind-yellow/.test(css), (css.match(/[^\n]*--ind-yellow[^\n]*/g) || []));
r.ok('...and no --ind-* colour token is named at all, so the four other palettes still work',
  !/var\(--ind-(?!ground|panel|inset|line|rule|muted|dim)/.test(css),
  (css.match(/var\(--ind-[a-z-]+\)/g) || []));
r.ok('...and the accent is a real role, defined in palette.css for every preset',
  /--accent:/.test(palette) && (palette.match(/--accent:/g) || []).length >= 5);

// --ind-dim is --ink-gray-5 (4.18:1 — below AA). It is allowed to be the unlit LED's
// fill and nothing else. One use is the rule; a second means a word went grey.
const dimUses = (css.match(/var\(--ind-dim\)/g) || []).length;
r.ok('--ind-dim is a FILL, used once, on the unlit LED', dimUses === 1, dimUses);
r.ok('...and the one use is a background, never a color',
  /background:\s*var\(--ind-dim\)/.test(css) && !/color:\s*var\(--ind-dim\)/.test(css));

// ── 4. The measurements, pinned ───────────────────────────────────────────────
// Contrast values are for the pill's own tinted ground, in light / dark. They are
// repeated here from industrial.css's header on purpose: this is the assertion, that
// is the explanation, and they must agree.
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
    new RegExp(`${step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*${light}[^\\n]*${dark}`)
      .test(read('../industrial.css')));
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
r.ok('--ind-muted is the measured step, not the one that fails',
  /--ind-muted:\s*var\(--ink-gray-6\)/.test(css),
  (css.match(/--ind-muted:[^;]*/) || [])[0]);

// ── 5. The LED is lit, square, and no wider than the pill it replaced ────────
r.head('the badge is an LED: lit from the status family, squared, and not wider');
// THE SUBTLE ONE. `--focus-*` is a box-SHADOW family; writing `background:
// var(--focus-blue)` is not an error anywhere — the declaration is invalid, the
// browser drops it, and every LED renders as an unlit grey square while the suite
// stays green. Option B shipped exactly that trap once. So the colour must come from
// `--st-*-fg`, and the assertion is on the family, not on one rule.
const ledColours = [...css.matchAll(/\.badge-[a-z]+::before[^{]*\{\s*background:\s*var\((--[a-z-]+)\)/g)]
  .map(m => m[1]);
r.ok('the LED takes its colour from the status family, never from --focus-*',
  ledColours.length >= 6 && ledColours.every(t => /^--st-/.test(t)), ledColours);
r.ok('...and --focus- is named nowhere in the file at all', !/--focus-/.test(css));
// The side column can never shrink, so a badge that got wider would squeeze the
// MIDDLE of the row — the direction the owner already reported as a clipped status.
// The visible border costs 2px; the horizontal padding gives back 3px and the gap
// 2px, so the LED is narrower than the pill it replaced, not wider. Measured against
// the base rule in components.css rather than against a remembered number.
const baseBadge = (read('../components.css').match(/\.badge\s*\{([^}]*)\}/) || [])[1] || '';
const px = s => { const m = s.match(/padding:\s*[\d.]+px\s+([\d.]+)px/); return m ? +m[1] : null; };
const basePad = px(baseBadge);
const ledBadge = (css.match(/#index-view \.badge,[\s\S]*?\{([^}]*)\}/) || [])[1] || '';
const ledPad = px(ledBadge);
r.ok('components.css still lays the badge out with pixel padding, so this is comparable',
  basePad === 8, baseBadge.trim());
r.ok('...and the LED comes in at or under that', ledPad !== null && ledPad <= basePad,
  { base: basePad, led: ledPad });
r.ok('the LED is square where the pill it replaced was --radius-9',
  /\.badge\s*\{[^}]*border-radius:\s*0/.test(css));
r.ok('...and the dot is a 5px square, not the base 5px circle',
  /\.badge::before\s*\{[^}]*width:\s*5px;\s*height:\s*5px[^}]*border-radius:\s*0/.test(css),
  (css.match(/\.badge::before\s*\{[^}]*\}/) || [''])[0]);

// ── 6. The corners, which are the whole design in one block ──────────────────
r.head('the corners are squared by re-pointing the radius scale, inside the screens only');
const cornerRule = (css.match(/#auth-container,\n#password-change,[\s\S]{0,400}?\{\s*--radius-1:\s*0px;[\s\S]{0,400}?\}/) || [''])[0];
r.ok('the screen set zeroes the radius scale in one place', cornerRule.length > 0);
r.ok('...all eight steps from --radius-1 to --radius-8', /--radius-8:\s*0px/.test(cornerRule));
// --radius-9 is 999px, the ROUND family (the dot, the avatar). Leaving it alone is
// what makes "the LED is squared by hand" a meaningful sentence rather than a
// tautology, and it keeps circles circular.
r.ok('...and --radius-9 is deliberately NOT zeroed', !/--radius-9:\s*0px/.test(css));
// Exactly four corners in the app cannot be reached from the scale, because they are
// drawn from a literal: .badge::before and .badge (--radius-9, 999px), #user-avatar
// (--radius-9) and .door-role (a literal 999px in base.css). Each one is squared by
// hand and each one carries a comment saying why. `border-radius: 0` written a fifth
// time would be a corner the scale already covered — i.e. a rule that only looks like
// it is doing something.
const handSquared = [...css.matchAll(/([^{}]+)\{\s*[^{}]*?border-radius:\s*0[;}]/g)]
  .map(m => m[1].trim().split(',')[0].trim().split(/\s+/).pop());
r.ok('exactly four rules square a corner by hand, and each is one the scale cannot reach',
  handSquared.length === 4, handSquared);
r.ok('...and they are the LED, its dot, the avatar and the role chip',
  handSquared.every(s => /\.badge(::before)?$|#user-avatar$|\.door-role$/.test(s)), handSquared);
// The claim in each of those comments is that base.css draws that corner from a
// literal. Checked against base.css rather than trusted.
r.ok('...and base.css really does round .door-role with a literal, not a token',
  /\.door-role\s*\{[^}]*border-radius:\s*999px/.test(base));

// ── 7. The phone rules that are bug fixes, not look ──────────────────────────
r.head('the search field stops iOS zooming the page, and no phone rule shrinks type');
// iOS Safari zooms the viewport for any focused field under 16px. .form-input is
// covered in components.css; .search-bar is a different class and was missed, so the
// IR search box — the field with the most typing on the list screen — was the one
// field that sprang the layout open.
// Every 639px block, joined: the file has three (the auth tap target, the search
// field, the filter tiles) and matching only the first would test the wrong one.
const phoneBlocks = [...css.matchAll(/@media \(max-width: 639px\)[^{]*\{([\s\S]*?)\n\}/g)]
  .map(m => m[1]);
const phoneBlock = phoneBlocks.join('\n');
r.ok('the phone blocks are real media queries', phoneBlocks.length >= 3, phoneBlocks.length);
r.ok('...and one of them raises the search field to 16px',
  /#index-view \.search-bar\s*\{\s*font-size:\s*16px/.test(phoneBlock), phoneBlock);
r.ok('...and no phone rule in the file lowers a font size',
  !/font-size:\s*(?:0\.\d+rem|1[0-5]px|(?:9|10|11|12|13|14|15)px)/.test(phoneBlock),
  (phoneBlock.match(/font-size:[^;]+/g) || []));
// A look that made the app's tap targets smaller would be a regression whatever the
// design language is. The three phone rules only ever RAISE a control.
r.ok('...and the auth buttons are raised, on a phone, to 44px',
  /#auth-container \.btn,[\s\S]{0,80}?height:\s*44px/.test(phoneBlock));

// ── 7b. The doors' one action ─────────────────────────────────────────────────
// A bare `.btn` is the NEUTRAL button — components.css:14 fills it with
// --surface-gray-10, near-black in light and near-white in dark. Nothing on the
// landing page asks for .btn-primary, so the two "Sign in" buttons shipped WHITE on a
// dark ground, which is what a screenshot caught. The rule that fixes it has to name
// the four variants back out, or it repaints the fingerprint door, the ghost, the
// Google button and the sign-out; and it has to restate hover/active, because a
// :not() chain out-specifies `.btn-primary:hover`.
r.head('the doors wear the accent, and only the doors, and only their one action');
const doorBtn = '#auth-container .btn:not(.btn-ghost):not(.btn-secondary):not(.btn-google):not(.btn-quick)';
for (const v of ['btn-ghost', 'btn-secondary', 'btn-google', 'btn-quick']) {
  r.ok(`...and .${v} is named back out, in markup and here`,
    new RegExp(`class="btn ${v}"`).test(html) && new RegExp(`:not\\(\\.${v}\\)`).test(css));
}
const doorRule = (css.match(new RegExp(doorBtn.replace(/[.()]/g, '\\$&') + ',\\n[\\s\\S]{0,200}?\\{([^}]*)\\}')) || [])[1] || '';
r.ok('the door action takes the accent solid fill, not --surface-gray-10',
  /background:\s*var\(--btn-solid-bg\)/.test(doorRule) &&
  /color:\s*var\(--btn-solid-fg\)/.test(doorRule), doorRule);
r.ok('...and it has no hover or active state that falls back to the neutral grey',
  new RegExp(`${doorBtn.replace(/[.()]/g, '\\$&')}:hover[^{]*\\{[^}]*var\\(--btn-solid-bg-hover\\)`).test(css) &&
  new RegExp(`${doorBtn.replace(/[.()]/g, '\\$&')}:active[^{]*\\{[^}]*var\\(--btn-solid-bg-active\\)`).test(css));
r.ok('...and it keeps its colour while it is busy, rather than flashing the amber .saving slab',
  new RegExp(`${doorBtn.replace(/[.()]/g, '\\$&')}\\.saving`).test(css) &&
  /background:\s*var\(--btn-solid-bg-hover\);\s*\n\s*color:\s*var\(--btn-solid-fg\)/.test(css));

// ── 8. It layers over the polish block, it does not replace it ───────────────
r.head('the chosen look still governs every other screen');
r.ok('the POLISH marker is still in views.css',
  /POLISH — level: NOTICEABLE/.test(views));
r.ok('industrial.css does not declare a polish level of its own',
  !/POLISH/.test(css), (css.match(/POLISH[^\n]*/) || [])[0]);
// The two rules this file reverses on the list are exactly the two the polish block
// owns there; if either were ever deleted from views.css, industrial.css would be
// silently depending on nothing.
r.ok('the polish accent chip and gradient still exist to be overridden',
  /\.segment\.active\s*\{\s*background:\s*var\(--accent-soft\)/.test(views) &&
  /\.list-toolbar\s*\{[\s\S]{0,200}?linear-gradient/.test(views));

// ── 9. The structural moves, pinned ───────────────────────────────────────────
// §5–§9 of industrial.css are structure rather than colour, which makes them easier
// to undo by accident: none of them is a value anyone would think to protect, and
// deleting one leaves a screen that still LOOKS fine while having quietly gone back
// to the thing it was changed away from. So each move gets an assertion.

r.head('the count tiles are tiles');
// The shape is the whole idea: number first and larger, label under it, out of the
// existing markup. `flex-direction: column` + `order: -1` on the count is that, and
// nothing else in the file does it.
const segRule = (css.match(/#index-view \.segment\s*\{[^}]*flex-direction:[^}]*\}/) || [''])[0];
r.ok('a segment lays its contents out in a column', /flex-direction:\s*column/.test(segRule), segRule);
r.ok('...and the count is lifted above the label',
  /#index-view \.segment-count\s*\{[^}]*order:\s*-1/.test(css),
  (css.match(/#index-view \.segment-count\s*\{[^}]*\}/) || [''])[0]);
r.ok('...at a size above the label\'s',
  /#index-view \.segment-count\s*\{[^}]*font-size:\s*var\(--text-md\)/.test(css));
// The tiles absorb the slack on their row, so a strip never ends in a rag of dead
// space — and the basis is `auto`, not `0`, so a tile is never narrower than its own
// label. The cap only bites on a lone tile on a last row.
r.ok('...and the tile takes up the slack without ever being squeezed',
  /#index-view \.segment\s*\{[^}]*flex:\s*1 1 auto/.test(css) &&
  /#index-view \.segment\s*\{[^}]*max-width:\s*11rem/.test(css));

// The strip wraps instead of scrolling sideways. This is the assertion that matters
// most on a phone: `overflow-x: auto` is still in views.css and would come straight
// back if this rule were dropped, hiding half the statuses off the right edge — the
// exact defect the tiles exist to remove.
const segsRule = (css.match(/#index-view \.segments\s*\{[^}]*\}/) || [''])[0];
r.ok('the strip wraps rather than scrolling sideways',
  /flex-wrap:\s*wrap/.test(segsRule) && /overflow:\s*visible/.test(segsRule), segsRule);

// "You are here" is one pixel of brand colour on the edge, never a filled slab: a
// yellow fill is 11.2:1 against the ink that would land on it, but the LABEL on a
// tile is muted grey, and a filled tile would put muted grey on the loudest colour
// on the screen.
r.ok('the active tile is marked by an accent border, not a colour block',
  /#index-view \.segment\.active\s*\{[^}]*border-color:\s*var\(--accent\)/.test(css),
  (css.match(/#index-view \.segment\.active\s*\{[^}]*\}/) || [''])[0]);

// The row identifies itself by one bright element. The identifier is the brand
// yellow and the rest of the row is muted — that is the readout reading.
r.ok('the IR number is the one bright thing on a row',
  /#index-view \.ir-title\s*\{[^}]*color:\s*var\(--accent\)/.test(css),
  (css.match(/#index-view \.ir-title\s*\{[^}]*\}/) || [''])[0]);
// views.css slides the row on hover. A row answers the pointer by lighting up; an
// instrument panel does not move when you look at it.
r.ok('...and the row lights up on hover instead of sliding',
  /#index-view \.ir-card:hover\s*\{\s*background:\s*var\(--ind-inset\)/.test(css) &&
  /#index-view \.ir-card:hover\s*\{\s*transform:\s*none/.test(css));

r.head('the look reaches the shell and the other four roots');
// Not "the rule exists" but "the rule names these roots": a scoped rule that forgot
// one of them is invisible on that screen and nothing else would say so.
r.ok('the sidebar sits on the page ground, not the panel',
  /#sidebar\s*\{\s*background:\s*var\(--ind-ground\)/.test(css));
r.ok('...and the active nav item is marked with a 2px accent rail',
  /#sidebar \.nav-item\.active\s*\{[^}]*box-shadow:\s*inset 2px 0 0 0 var\(--accent\)/.test(css),
  (css.match(/#sidebar \.nav-item\.active\s*\{[^}]*\}/) || [''])[0]);
r.ok('the header band is ruled off from the panes',
  /#workspace header\s*\{\s*border-bottom:\s*1px solid var\(--ind-line\)/.test(css));
r.ok('the insights and log toolbars sit on the panel',
  css.includes('#insights-view .list-toolbar') && css.includes('#log-view .list-toolbar'));
r.ok('both read-only panes get the page ground',
  /#insights-view,\s*\n#log-view\s*\{\s*background:\s*var\(--ind-ground\)/.test(css));
r.ok('the detail pane gets the page ground',
  css.includes('#detail-view { background: var(--ind-ground)'));
r.ok('...and its banner stops being the gradient',
  css.includes('#detail-view #ir-banner'));
r.ok('...and its Overview panel becomes a flat panel with a rule',
  /#detail-view \.overview-panel\s*\{[^}]*box-shadow:\s*none/.test(css));

r.head('the datagrid is re-mapped onto markup that exists');
// Option D drew `.overview-grid`. The app has never had that class, and a rule for it
// would be dead CSS that reads as a working style — the failure mode this assertion
// exists to prevent is someone "restoring" the re-map by pasting D.
r.ok('nothing styles .overview-grid, which no markup carries',
  !/\.overview-grid\b/.test(css) && !/overview-grid/.test(html));
r.ok('the re-map targets the real container',
  /#detail-view \.overview-facts\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(15rem/.test(css),
  (css.match(/#detail-view \.overview-facts\s*\{[^}]*\}/) || [''])[0]);
r.ok('...and the grey block and its padding are gone',
  /#detail-view \.overview-facts\s*\{[^}]*padding:\s*0/.test(css) &&
  /#detail-view \.overview-facts\s*\{[^}]*background:\s*transparent/.test(css));
r.ok('...and each cell carries the hairline that makes it a grid',
  /#detail-view \.overview-fact\s*\{[^}]*border-bottom:\s*1px solid var\(--ind-rule\)/.test(css));

// The label pair in the datagrid moves to the measured step, like every other
// secondary grey in this file.
r.ok('the fact label is at the AA step, not --ink-gray-5',
  /#detail-view \.overview-fact-label\s*\{[^}]*color:\s*var\(--ind-muted\)/.test(css),
  (css.match(/#detail-view \.overview-fact-label\s*\{[^}]*\}/) || [''])[0]);

// Every class this file names has to be one the app actually puts on an element. A
// rule for a class that does not exist is dead CSS that reads as a working style, and
// the failure is invisible: the screen simply does not change. Checked against the
// app's own source, not against this file.
r.head('every class it styles is one the app really uses');
const appSource = read('../app.js') + '\n' + html
  + '\n' + [tokens, palette, base, read('../components.css'), views].join('\n');
const classNames = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map(m => m[1]));
const missing = [...classNames].filter(c => !new RegExp(`(^|[^\\w-])${c}([^\\w-]|$)`).test(appSource));
r.ok('...and every one of them exists in the app', missing.length === 0, missing);

r.finish();
