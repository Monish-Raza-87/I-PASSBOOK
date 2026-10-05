// Smoke test for the three theme modes.
//
//   node tools/smoke-theme.mjs
//
// theme.css is the MODE layer: light, cream, dark. It is the file the owner's
// two complaints — light is "pinchy to the eyes", dark is "plain, lines less
// visible" — were answered in, and every claim in its header comment is a
// NUMBER. So this suite does not restate those numbers; it re-derives them from
// the file and fails if the file and the claim have drifted apart.
//
// Three failure modes it exists to catch, all of them invisible in a browser:
//   1. A contrast claim quietly stops holding after a value is nudged.
//   2. A token set on `:root` in theme.css — which loads AFTER tokens.css and
//      shares `[data-theme="dark"]`'s specificity — leaks a light literal onto a
//      dark screen. (This is not theoretical: an earlier draft of theme.css
//      overrode --surface-sidebar on :root while dark sets it to `transparent`,
//      which would have painted the dark sidebar a near-white slab.)
//   3. Two files disagree about which modes exist, so a menu choice does nothing.
//
// The oklch→sRGB→WCAG maths below is deliberately the same code smoke-palette.mjs
// uses. One measurement, one implementation.

import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const themeCss = read('../theme.css');
const tokensCss = read('../tokens.css');
const paletteCss = read('../palette.css');
const appJs = read('../app.js');
const html = read('../index.html');
const swJs = read('../sw.js');
const deployJs = read('../tools/deploy-ghpages.mjs');
const colors = JSON.parse(read('../tools/.cache/colors.json'));

const MODES = ['light', 'cream', 'dark'];
const PALETTES = ['blue', 'violet', 'teal', 'graphite'];

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');
const r3 = n => Math.round(n * 1000) / 1000;

// ── colour maths (same as smoke-palette.mjs) ──────────────────────────────────
function toHex(value) {
  const v = String(value).trim();
  if (v === 'neutral/white') return '#ffffff';
  if (v === 'neutral/black') return '#000000';
  const m = v.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error('not an oklch value: ' + v);
  const L = +m[1], C = +m[2], H = +m[3];
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, mm = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s,
  ];
  return '#' + lin.map(x => {
    const c = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, '0');
  }).join('');
}
const lum = hex => {
  const n = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));
// How far red leads blue. The one number that separates cream from a grey page.
const warmth = hex => { const [r, , b] = rgb(hex); return r - b; };

// ── the base ramp, resolved through Frappe's own table (never a literal here) ─
function rawTokenHex(token, mode) {
  const tv = colors.themedVariables[mode];
  const m = token.match(/^--(surface|ink|outline)-(.+)$/);
  if (!m) throw new Error('unrecognised token name: ' + token);
  const ref = tv[m[1]] && tv[m[1]][m[2]];
  if (!ref) throw new Error('no such token: ' + token);
  if (ref === 'neutral/white' || ref === 'neutral/black') return toHex(ref);
  const [md, fam, step] = String(ref).split('/');
  const raw = colors[md] && colors[md][fam] && colors[md][fam][step];
  if (!raw) throw new Error('unresolvable reference ' + ref + ' for ' + token);
  return toHex(raw);
}

// ── parse both override layers ────────────────────────────────────────────────
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// The name class must admit DIGITS: --surface-gray-1, --outline-gray-1 and
// --surface-elevation-2 all carry one, and a class of [a-zA-Z-] silently drops
// every token with a number in its name — which reads as "theme.css set
// nothing" rather than as a parse error.
const declsOf = body => {
  const out = {};
  for (const m of body.matchAll(/([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
};
const rulesOf = css => [...strip(css).matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), decls: declsOf(m[2]), body: m[2] }));

const themeRules = rulesOf(themeCss);
const paletteRules = rulesOf(paletteCss);

// theme.css's selectors are a closed set, deliberately: a new form means a new
// mode, and this suite must be taught about it rather than silently ignoring it.
function themeApplies(sel, mode, palette) {
  return sel.split(',').map(s => s.trim().replace(/\s+/g, '')).some(p => {
    if (p === ':root') return true;             // html, in every mode
    if (p === '[data-theme="cream"]') return mode === 'cream';
    if (p === '[data-theme="dark"]') return mode === 'dark';
    const c = p.match(/^\[data-theme="cream"\]\[data-palette="([a-z]+)"\]$/);
    if (c) return mode === 'cream' && palette === c[1];
    throw new Error('theme.css has a selector this suite does not know: ' + p);
  });
}
function themeOverride(token, mode, palette) {
  let val;
  for (const r of themeRules) {
    if (themeApplies(r.sel, mode, palette) && r.decls[token] !== undefined) val = r.decls[token];
  }
  return val;
}
function paletteValue(token, palette) {
  let val;
  for (const r of paletteRules) {
    const sels = r.sel.split(',').map(s => s.trim().replace(/\s+/g, ''));
    if (sels.some(s => s === ':root' || s === `[data-palette="${palette}"]`) && r.decls[token] !== undefined) {
      val = r.decls[token];
    }
  }
  return val;
}

// The whole point of the layering: theme.css beats palette.css beats tokens.css,
// because that is the order index.html loads them in.
function resolve(token, mode, palette, seen = new Set()) {
  if (seen.has(token)) throw new Error('var() cycle at ' + token);
  seen.add(token);
  const raw = themeOverride(token, mode, palette)
    ?? paletteValue(token, palette)
    ?? rawTokenHex(token, mode === 'dark' ? 'dark' : 'light');
  const m = String(raw).match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/);
  return m ? resolve(m[1], mode, palette, seen) : String(raw).trim();
}
// A resolver that reports rather than throws, so one bad token name does not
// abort the other thirty assertions.
const broken = [];
function hex(token, mode, palette = 'blue') {
  try { return resolve(token, mode, palette); }
  catch (e) { broken.push(`${mode}/${palette} ${token}: ${e.message}`); return '#ff00ff'; }
}

// ── 1. hygiene ────────────────────────────────────────────────────────────────
head('theme.css is a token layer, not a second base.css');

const DECL_OK = /^color-scheme$/;   // the one non-custom property allowed, and only for the UA hint
const stray = themeRules.flatMap(r =>
  [...r.body.matchAll(/([a-zA-Z0-9-]+)\s*:\s*[^;]+;/g)]
    .map(m => m[1]).filter(n => !n.startsWith('--') && !DECL_OK.test(n)));
ok('it declares custom properties and a color-scheme hint, nothing else',
  stray.length === 0, stray);

const known = new Set([...MODES.flatMap(m => [`:root`, `[data-theme="${m}"]`]),
  ...PALETTES.map(p => `[data-theme="cream"][data-palette="${p}"]`)]);
ok('every selector is one of the known mode/palette forms',
  themeRules.every(r => themeApplies(r.sel, 'cream', 'blue') !== undefined && r.sel.split(',').every(s => known.has(s.trim().replace(/\s+/g, ' ')))),
  themeRules.map(r => r.sel));

ok('no declaration is !important', !/!important/.test(strip(themeCss)));
ok('light is the absence of the attribute, so theme.css never writes [data-theme="light"]',
  !/\[data-theme="light"\]/.test(strip(themeCss)));

// ── 2. the leak rule ──────────────────────────────────────────────────────────
// `:root` matches the html element in ALL THREE modes, and `:root` and
// `[data-theme="dark"]` have EQUAL specificity — so theme.css (loaded after
// tokens.css) beats tokens.css's own dark values. Any token this file sets on
// :root must therefore be restated by BOTH other modes, or a light literal
// reaches a dark or cream screen.
head('a token set on :root is restated by every mode that should differ');

const rootTokens = Object.keys(themeRules
  .filter(r => r.sel.split(',').some(s => s.trim() === ':root'))
  .reduce((a, r) => Object.assign(a, r.decls), {}));
ok('the :root block declares something at all', rootTokens.length > 0, rootTokens);

for (const mode of ['cream', 'dark']) {
  const declared = new Set(themeRules
    .filter(r => r.sel.split(',').some(s => s.trim() === `[data-theme="${mode}"]` || /^\[data-theme="cream"\]\[data-palette=/.test(s.trim())))
    .flatMap(r => Object.keys(r.decls)));
  const leaked = rootTokens.filter(t => !declared.has(t));
  ok(`${mode} restates every :root token — nothing light leaks onto it`, leaked.length === 0, leaked);
}

// The specific instance of that trap, named, because it is the one that was
// actually hit: dark sets --surface-sidebar to `transparent`, and a plain
// :root literal here would beat it.
ok('--surface-sidebar is left to tokens.css, where dark sets it to transparent',
  !rootTokens.includes('--surface-sidebar'), rootTokens.filter(t => t === '--surface-sidebar'));

// ── 3. structure, per mode ─────────────────────────────────────────────────────
// The de-glare claim, measured. Before theme.css these were 1.00:1 in light
// (base, elevation-1/2/3 all #ffffff) and 1.087:1 in dark.
head('the page ground is visibly not the panel');

for (const mode of MODES) {
  const base = hex('--surface-base', mode), ground = hex('--surface-gray-1', mode);
  const c = contrast(base, ground);
  ok(`${mode}: the ground separates from the panel`, c >= 1.10,
    { base, ground, ratio: r3(c) });
}

head('the common hairline is a line, not a rumour');

// Both thresholds are measured against the panel, because a border is drawn
// between a panel and a ground and has to be visible against the lighter of the
// two — the panel in light and cream, the ground's neighbour in dark. The bar is
// 1.35 against the panel and 1.20 against the ground; the values before this
// file existed were 1.17:1 (light) and 1.155:1 (dark), against the panel.
for (const mode of MODES) {
  const base = hex('--surface-base', mode);
  const ground = hex('--surface-gray-1', mode);
  const line = hex('--outline-gray-1', mode);
  const vsPanel = contrast(line, base), vsGround = contrast(line, ground);
  ok(`${mode}: --outline-gray-1 reads against the panel and the ground`,
    vsPanel >= 1.35 && vsGround >= 1.20,
    { line, panel: r3(vsPanel), ground: r3(vsGround) });
}

// ── 4. AA for every ink step that carries text ────────────────────────────────
head('every ink step that carries words meets AA on both surfaces');

for (const mode of MODES) {
  for (const step of [6, 7, 8, 9]) {
    const ink = hex(`--ink-gray-${step}`, mode);
    const onPanel = contrast(ink, hex('--surface-base', mode));
    const onGround = contrast(ink, hex('--surface-gray-1', mode));
    ok(`${mode}: --ink-gray-${step} is readable on the panel and the ground`,
      onPanel >= 4.5 && onGround >= 4.5,
      { ink, panel: r3(onPanel), ground: r3(onGround) });
  }
}
// gray-5 is the placeholder step and is knowingly short of AA in the grey ramp.
// In cream it was chosen by hand, so it has no such excuse and is held to AA.
ok('cream: --ink-gray-5 is AA, not a placeholder-grade grey',
  contrast(hex('--ink-gray-5', 'cream'), hex('--surface-base', 'cream')) >= 4.5,
  r3(contrast(hex('--ink-gray-5', 'cream'), hex('--surface-base', 'cream'))));

// ── 5. the accent, in every palette, in every mode ─────────────────────────────
// The accent is the one colour that has to work everywhere, and on cream it was
// the reason the four compound rules exist: the default blue step is under AA on
// the cream panel.
head('the accent is AA on the panel in all twelve mode/palette combinations');

for (const mode of MODES) {
  for (const palette of PALETTES) {
    const a = hex('--accent', mode, palette);
    const c = contrast(a, hex('--surface-base', mode));
    ok(`${mode}/${palette}: the accent reads on the panel`, c >= 4.5, { accent: a, ratio: r3(c) });
  }
}

head('the accent moved down a step on cream — and the palettes that did not need it went with it');

// The reason the block exists, stated as a measurement rather than a claim: the
// step the palettes pick for light is under AA on the cream panel. If this ever
// goes green-as-empty the override has become decoration and should be re-argued.
const underAA = PALETTES.filter(p =>
  contrast(hex('--accent', 'light', p), hex('--surface-base', 'cream')) < 4.5);
ok("blue's light step fails AA on cream — that, and not taste, is why the override exists",
  underAA.includes('blue'),
  underAA.map(p => ({ palette: p, onCream: r3(contrast(hex('--accent', 'light', p), hex('--surface-base', 'cream'))) })));

// palette.css states that the four presets are kept structurally identical, so
// "measure contrast once" is a valid argument for all of them. Cream preserves
// that: every palette steps down, not only the one that had to.
for (const palette of PALETTES) {
  ok(`cream/${palette}: the accent is darker than light's`,
    lum(hex('--accent', 'cream', palette)) < lum(hex('--accent', 'light', palette)),
    { cream: hex('--accent', 'cream', palette), light: hex('--accent', 'light', palette) });
}

head('the solid button keeps its own text readable');

for (const mode of MODES) {
  for (const palette of PALETTES) {
    const bg = hex('--btn-solid-bg', mode, palette);
    const fg = hex('--btn-solid-fg', mode, palette);
    const c = contrast(fg, bg);
    ok(`${mode}/${palette}: the button's label on the button's fill`, c >= 4.5, { bg, fg, ratio: r3(c) });
  }
}

// ── 6. warmth: what makes cream cream, and light light ────────────────────────
// Not "it looks warm" — the red channel leads the blue, or it does not.
head('cream is warm and light is neutral, by channel arithmetic');

const LIGHT_NEUTRALS = ['--surface-base', '--surface-gray-1', '--surface-gray-2',
  '--surface-gray-3', '--outline-gray-1', '--outline-gray-2'];
for (const t of LIGHT_NEUTRALS) {
  const v = hex(t, 'light');
  ok(`light: ${t} sits at zero chroma — it can never blur into cream`,
    warmth(v) === 0, { value: v, warmth: warmth(v) });
}

const CREAM_WARM = ['--surface-base', '--surface-gray-1', '--surface-gray-2', '--surface-gray-3',
  '--surface-sidebar', '--surface-elevation-1', '--surface-elevation-2', '--surface-elevation-3',
  '--outline-gray-1', '--outline-gray-2',
  '--ink-gray-5', '--ink-gray-6', '--ink-gray-7', '--ink-gray-8', '--ink-gray-9'];
for (const t of CREAM_WARM) {
  const v = hex(t, 'cream');
  ok(`cream: ${t} is warm (red leads blue)`, warmth(v) >= 5, { value: v, warmth: warmth(v) });
}

ok('cream is the softer panel of the two — that is the de-glare',
  lum(hex('--surface-base', 'cream')) < lum(hex('--surface-base', 'light')),
  { cream: lum(hex('--surface-base', 'cream')), light: lum(hex('--surface-base', 'light')) });

// ── 7. every mode must be reachable ────────────────────────────────────────────
head('the three files agree on which modes exist');

const arr = (src, name) => {
  const m = src.match(new RegExp(name + `\\s*=\\s*\\[([^\\]]*)\\]`));
  return m ? [...m[1].matchAll(/'([a-z]+)'/g)].map(x => x[1]) : null;
};
const appThemes = arr(appJs, 'THEME_VALUES');
const htmlThemes = arr(html, 'THEMES');
ok('app.js names the modes', Array.isArray(appThemes) && appThemes.length > 0, appThemes);
ok('the pre-paint script names the same modes, in the same order',
  Array.isArray(htmlThemes) && String(appThemes) === String(htmlThemes),
  { appJs: appThemes, indexHtml: htmlThemes });

// Scoped to the THEME_CHOICES array on purpose: the palette menu in the same
// file uses the same { value, label } shape, so an unscoped scan would accept a
// palette name as a mode.
const choicesBlock = (appJs.match(/THEME_CHOICES\s*=\s*\[([\s\S]*?)\];/) || [, ''])[1];
const choices = [...choicesBlock.matchAll(/value:\s*'([a-z]+)'/g)].map(m => m[1]);
ok('the Appearance menu offers them all, plus system',
  JSON.stringify([...appThemes, 'system'].sort()) === JSON.stringify([...new Set(choices)].sort()),
  { choices: [...new Set(choices)] });

const chromeApp = Object.keys(JSON.parse(
  (appJs.match(/THEME_CHROME\s*=\s*\{([^}]*)\}/) || [, '{}'])[1]
    .replace(/([a-z]+):/g, '"$1":').replace(/'/g, '"').replace(/,\s*$/, '').replace(/^/, '{') + '}'));
const chromeHtml = [...(html.match(/var CHROME = \{([^}]*)\}/) || [, ''])[1].matchAll(/([a-z]+)\s*:/g)].map(m => m[1]);
ok('both chrome maps cover every mode — no mode paints the wrong browser bar',
  appThemes.every(t => chromeApp.includes(t)) && String(appThemes) === String(chromeHtml),
  { appJs: chromeApp, indexHtml: chromeHtml });

// ── 8. it is actually wired into the page ───────────────────────────────────────
head('theme.css is loaded, and loaded in the right place');

const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
  .map(m => (m[0].match(/href="([^"]+)"/) || [])[1] || '');
ok('index.html loads it', links.includes('theme.css'), links);
ok('it loads after palette.css and before base.css — it must override tokens.css',
  links.indexOf('palette.css') < links.indexOf('theme.css') &&
  links.indexOf('theme.css') < links.indexOf('base.css'), links);

ok('the pre-paint script mirrors applyTheme: light is the absence of the attribute',
  /if \(t !== 'light'\) document\.documentElement\.setAttribute\('data-theme', t\);/.test(html));
ok('applyTheme removes the attribute for light rather than setting a value',
  /if \(t === 'light'\) root\.removeAttribute\('data-theme'\);/.test(appJs));
ok('system resolves to light or dark only — cream is taste, never chosen for you',
  /return prefersDark\(\) \? 'dark' : 'light';/.test(appJs));

// The same guard form appears in the standalone pages (faq, inspector, plan, the
// demo run-sheet) and in the preview builders. In all of them it must ask "did the
// viewer express no preference?", never "did they not pick light?" — the second
// question now has the wrong answer for cream.
head('no stylesheet asks the wrong question about the OS setting');

const guardFiles = [...fs.readdirSync(new URL('..', import.meta.url)).filter(f => /\.(html|css)$/.test(f))
  .map(f => '../' + f),
  '../tools/build-polish-preview.mjs'];
// Matched with the `:root` prefix on purpose: a real selector always writes
// `:root:not([data-theme="light"])`, so this stays precise and does not fire on a
// comment that quotes the old form while explaining why it was wrong.
const wrongGuard = guardFiles.filter(f => /:root:not\(\[data-theme="light"\]\)/.test(read(f)));
ok('every OS guard tests for the absence of the attribute',
  wrongGuard.length === 0, wrongGuard.map(f => f.replace('../', '')));
ok('the standalone pages carry the corrected guard',
  ['../backup.html', '../faq.html', '../inspector.html', '../plan.html', '../docs/I-PASSBOOK Demo Run-Sheet.html']
    .every(f => /:root:not\(\[data-theme\]\)/.test(read(f))));

// ── 9. it is actually shipped ───────────────────────────────────────────────────
head('theme.css is shipped');

ok('the service worker caches it', /'\.\/theme\.css'/.test(swJs));
ok('the deploy tool serves it', /'theme\.css'/.test(deployJs));
ok('it is NOT precached twice or left out of the shell',
  (swJs.match(/'\.\/theme\.css'/g) || []).length === 1);

const cacheV = (swJs.match(/CACHE_NAME\s*=\s*'ipassbook-v(\d+)'/) || [])[1];
const appV = (appJs.match(/APP_VERSION\s*=\s*'v(\d+)'/) || [])[1];
ok('the cache name and APP_VERSION moved together',
  !!cacheV && cacheV === appV, { cache: cacheV, app: appV });

// A stale preview build is a separate suite's job (smoke-preview.mjs). What
// matters here is that the palette preview knows cream exists.

// ── report ─────────────────────────────────────────────────────────────────────
if (broken.length) {
  console.log('\n— unresolved tokens —');
  for (const b of broken) console.log('  ' + b);
  fails += broken.length;
}

console.log(fails ? `\n${fails} FAILED\n` : '\nOK\n');
process.exit(fails ? 1 : 0);
