// Smoke test for the palette layer.
//
//   node tools/smoke-palette.mjs
//
// palette.css names the accent ROLE (--accent, --btn-solid-*) and points it at
// one of the colour families tokens.css defines. The failure modes here are all
// silent in a browser: a token name with a typo resolves to nothing, so the
// property falls back to its inherited value and the accent quietly disappears;
// a palette listed in app.js but missing from the CSS is a menu choice that does
// nothing; and a palette whose ramp inverts badly leaves an unreadable button in
// one theme only.
//
// So this suite parses the real files and resolves every var() through Frappe's
// own colour table, then measures contrast. It never restates the values.

import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const appJs = read('../app.js');
const html = read('../index.html');
const paletteCss = read('../palette.css');
const tokensCss = read('../tokens.css');
const swJs = read('../sw.js');
const deployJs = read('../tools/deploy-ghpages.mjs');
const backendGs = read('../backend.gs');

const colors = JSON.parse(read('../tools/.cache/colors.json'));

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

// ── oklch → sRGB hex, and WCAG relative luminance ────────────────────────────
// The same conversion tools/gen-tokens.mjs uses to emit the hex fallbacks, so a
// pass here means the palette is readable on the sRGB path too, not only where
// oklch is supported.
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

// `--surface-blue-9` → the themedVariables entry for that mode, resolved one hop
// through Frappe's table to the raw colour. Deliberately a name lookup and not a
// table: an unknown name must FAIL rather than resolve to a default, or a typo in
// palette.css would pass silently (which is exactly how it fails in a browser).
function tokenHex(token, mode) {
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

// ── Parse palette.css ────────────────────────────────────────────────────────
head('palette.css structure');

const ROLES = ['--accent', '--accent-soft', '--accent-soft-line', '--accent-bar',
  '--btn-solid-bg', '--btn-solid-bg-hover', '--btn-solid-bg-active', '--btn-solid-fg'];

// Comments are stripped first: the file opens with a long header comment, and
// without this the blue block's selector would run back into it and the block
// would be discarded as if it were a comment.
const cssOnly = paletteCss.replace(/\/\*[\s\S]*?\*\//g, '');

// Each block's selectors + declarations. The blue block's selector is
// `:root,\n[data-palette="blue"]`.
const blocks = [...cssOnly.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .map(m => ({ sel: m[1].trim(), body: m[2] }))
  .filter(b => /--(accent|btn-solid)/.test(b.body));

const paletteNames = blocks.map(b => {
  const m = b.sel.match(/\[data-palette="([a-z]+)"\]/);
  return m ? m[1] : null;
}).filter(Boolean);

ok('every preset has a [data-palette] block',
  ['blue', 'violet', 'teal', 'graphite'].every(n => paletteNames.includes(n)), paletteNames);
ok('blue is also declared on :root, so it survives an unreadable localStorage',
  blocks.some(b => paletteNames.includes('blue') && /(^|,)\s*:root\s*(,|$)/.test(b.sel)), paletteNames);

// app.js and palette.css must agree. A name in one and not the other is a menu
// entry that does nothing, which is invisible until someone picks it.
const jsPalettes = [...appJs.matchAll(/\{\s*value:\s*'([a-z]+)',\s*label:\s*'[^']+',\s*swatch:/g)].map(m => m[1]);
ok('app.js lists the same presets as palette.css',
  jsPalettes.length > 0 && jsPalettes.slice().sort().join() === paletteNames.slice().sort().join(),
  { jsPalettes, paletteNames });

// …and the pre-paint script's fallback list must agree too, or a stored value
// would be rewritten to blue on every load even though it is a valid preset.
const prepaint = html.match(/var PALETTES = \[([^\]]*)\]/);
const prepaintList = prepaint ? [...prepaint[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]) : [];
ok('the pre-paint script knows every preset',
  prepaintList.slice().sort().join() === paletteNames.slice().sort().join(),
  { prepaintList, paletteNames });

// ── Every role, in every preset, resolves ────────────────────────────────────
head('roles resolve to real tokens');

// tokens.css must actually EMIT each referenced token, or palette.css would be
// pointing at something the generator stopped producing.
const emitted = new Set([...tokensCss.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1]));

for (const block of blocks) {
  const name = (block.sel.match(/\[data-palette="([a-z]+)"\]/) || [, 'blue'])[1];
  const decls = new Map([...block.body.matchAll(/(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\)/g)]
    .map(m => [m[1], m[2]]));

  const missing = ROLES.filter(r => !decls.has(r));
  ok(`${name}: declares all ${ROLES.length} roles`, missing.length === 0, missing);

  const unemitted = [...decls.values()].filter(t => !emitted.has(t));
  ok(`${name}: points only at tokens tokens.css emits`, unemitted.length === 0, unemitted);

  const unresolved = [];
  for (const [role, token] of decls) {
    try { tokenHex(token, 'light'); tokenHex(token, 'dark'); }
    catch (e) { unresolved.push(role + ' → ' + token + ': ' + e.message); }
  }
  ok(`${name}: every token resolves in both themes`, unresolved.length === 0, unresolved);
}

// No raw colour values: palette.css must be aliases only, or it becomes a second
// place colours are defined and the two can drift.
ok('palette.css contains no raw hex',
  !/#[0-9a-fA-F]{3,8}\b/.test(paletteCss.replace(/\/\*[\s\S]*?\*\//g, '')), null);
ok('palette.css contains no raw colour functions',
  !/\b(rgb|rgba|hsl|hsla|oklch|color-mix)\(/.test(paletteCss.replace(/\/\*[\s\S]*?\*\//g, '')), null);

// ── Contrast, measured per preset per theme ──────────────────────────────────
head('contrast holds in both themes');

const AA = 4.5;          // normal text
const MIN_STEP = 1.15;   // a hover state must be visible, not a no-op

for (const block of blocks) {
  const name = (block.sel.match(/\[data-palette="([a-z]+)"\]/) || [, 'blue'])[1];
  const decls = new Map([...block.body.matchAll(/(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\)/g)]
    .map(m => [m[1], m[2]]));

  for (const mode of ['light', 'dark']) {
    let bg, fg, accent, page, hover, active;
    try {
      bg = tokenHex(decls.get('--btn-solid-bg'), mode);
      fg = tokenHex(decls.get('--btn-solid-fg'), mode);
      accent = tokenHex(decls.get('--accent'), mode);
      page = tokenHex('--surface-base', mode);
      hover = tokenHex(decls.get('--btn-solid-bg-hover'), mode);
      active = tokenHex(decls.get('--btn-solid-bg-active'), mode);
    } catch (e) {
      ok(`${name}/${mode}: contrast measurable`, false, e.message);
      continue;
    }

    const cBtn = contrast(fg, bg);
    ok(`${name}/${mode}: button text on the solid accent ≥ ${AA}`,
      cBtn >= AA, { fg, bg, contrast: +cBtn.toFixed(2) });

    const cAccent = contrast(accent, page);
    ok(`${name}/${mode}: accent text on the page ≥ ${AA}`,
      cAccent >= AA, { accent, page, contrast: +cAccent.toFixed(2) });

    // The button's own states must be distinguishable from each other, or a
    // press looks like nothing happened.
    ok(`${name}/${mode}: hover and active differ from rest`,
      contrast(bg, hover) >= MIN_STEP && contrast(bg, active) >= MIN_STEP,
      { bg, hover, active, restVsHover: +contrast(bg, hover).toFixed(2), restVsActive: +contrast(bg, active).toFixed(2) });
  }
}

// ── All four presets are structurally identical ──────────────────────────────
head('one pattern, four families');

// Every preset must be the SAME shape with only the family name swapped. That is
// what makes the contrast measured above a property of the set rather than of
// four hand-tuned blocks that could drift apart one edit at a time.
//
// Graphite is spelled `gray` in the token names (the palette is called Graphite,
// the ramp is called gray) and is allowed two deliberate deviations, both because
// a neutral has no hue to carry emphasis: its bar takes the stronger gray-8 step
// rather than gray-7, and its solid button sits on the gray-10/-9/-8 steps the
// neutral .btn uses rather than a hue's -9/-8/-7.
const famOf = n => (n === 'graphite' ? 'gray' : n);
const SHAPE = {
  '--accent': f => `--ink-${f}-7`,
  '--accent-soft': f => `--surface-${f}-1`,
  '--accent-soft-line': f => `--outline-${f}-1`,
  '--accent-bar': f => `--surface-${f}-7`,
  '--btn-solid-fg': () => '--ink-base',
};
const NEUTRAL_EXCEPTIONS = {
  graphite: {
    '--accent-bar': '--surface-gray-8',
    '--btn-solid-bg': '--surface-gray-10',
    '--btn-solid-bg-hover': '--surface-gray-9',
    '--btn-solid-bg-active': '--surface-gray-8',
  },
};

for (const block of blocks) {
  const name = (block.sel.match(/\[data-palette="([a-z]+)"\]/) || [, 'blue'])[1];
  const fam = famOf(name);
  const exceptions = NEUTRAL_EXCEPTIONS[name] || {};
  const decls = new Map([...block.body.matchAll(/(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\)/g)]
    .map(m => [m[1], m[2]]));
  const wrong = Object.entries(SHAPE)
    .filter(([role, expect]) => decls.get(role) !== (exceptions[role] || expect(fam)))
    .map(([role, expect]) => `${role}: ${decls.get(role)} ≠ ${exceptions[role] || expect(fam)}`);
  // A button exception must be complete — a half-applied one would leave hover
  // pointing at a hue the palette no longer uses.
  if (exceptions['--btn-solid-bg']) {
    const b = ['--btn-solid-bg', '--btn-solid-bg-hover', '--btn-solid-bg-active'];
    const partial = b.filter(r => decls.get(r) !== exceptions[r]);
    if (partial.length) wrong.push('incomplete neutral button exception: ' + partial.join(', '));
  }
  ok(`${name}: follows the shared role pattern`, wrong.length === 0, wrong);
}

const graphite = blocks.find(b => (b.sel.match(/\[data-palette="([a-z]+)"\]/) || [])[1] === 'graphite');
ok('graphite is the neutral: its solid button is the grayscale ramp',
  /--btn-solid-bg:\s*var\(--surface-gray-10\)/.test(graphite.body) &&
  /--btn-solid-bg-hover:\s*var\(--surface-gray-9\)/.test(graphite.body), graphite.body.slice(0, 200));

// Links must clear AA. The token this replaced did not — that is the reason the
// accent does not use it, so pin the fact rather than the intent.
const linkToken = colors.themedVariables.light.ink['blue-link'];
const linkHexLight = toHex(colors[linkToken.split('/')[0]][linkToken.split('/')[1]][linkToken.split('/')[2]]);
ok('the retired --ink-blue-link really was below AA (the reason blue does not use it)',
  contrast(linkHexLight, '#ffffff') < 4.5, { hex: linkHexLight, contrast: +contrast(linkHexLight, '#ffffff').toFixed(2) });

// Red / green / amber already mean danger, success and warning in the status
// badges. Offering them as an accent would repaint a "Closed" badge.
const semantic = ['red', 'green', 'amber'];
ok('no semantic status family is offered as a palette',
  !paletteNames.some(n => semantic.includes(n)), paletteNames);

// ── The seam is wired, not merely declared ───────────────────────────────────
head('the accent role is consumed');

const baseCss = read('../base.css');
const componentsCss = read('../components.css');
const viewsCss = read('../views.css');
const consumers = [baseCss, componentsCss, viewsCss];
const uses = consumers.reduce((n, css) => n + (css.match(/var\(--accent\)|var\(--accent-soft\)|var\(--accent-soft-line\)|var\(--accent-bar\)|var\(--btn-solid/g) || []).length, 0);
ok('the accent role has consumers in the stylesheets', uses >= 10, uses);

ok('.btn-primary draws on the accent role, not a hardcoded family',
  /\.btn-primary\s*\{[^}]*background:\s*var\(--btn-solid-bg\)/.test(componentsCss));
ok('no rule still hardcodes the blue family for the accent bar',
  !/border-left:\s*3px solid var\(--surface-blue-/.test(viewsCss));

// The status badges must NOT have moved with the palette.
ok('status badge colours are still semantic, not accent',
  /--st-open-bg:\s*var\(--surface-blue-2\)/.test(tokensCss) &&
  /--st-danger-bg:\s*var\(--surface-red-2\)/.test(tokensCss));

// ── The control moved out of the sidebar foot ────────────────────────────────
head('appearance lives in the user menu');

ok('the sidebar theme button is gone from index.html', !/id="nav-theme"/.test(html));
ok('app.js no longer captures nav-theme ids', !/getElementById\('nav-theme/.test(appJs));
ok('no dead nav-theme listener remains', !/navTheme/.test(appJs));
ok('the user menu builds an appearance group',
  /buildAppearanceGroup\(\)/.test(appJs) && /function buildAppearanceGroup/.test(appJs));
ok('appearance rows are words plus a swatch, never icon-only',
  /class="appearance-swatch"/.test(appJs) && /class="appearance-label"/.test(appJs));
ok('selection is exposed to assistive tech, not only by colour',
  /role="radio"/.test(appJs) && /aria-checked/.test(appJs));
ok('the menu is rebuilt when the allowlist arrives',
  /function loadPaletteConfig/.test(appJs) && /menu\.remove\(\)/.test(appJs));

// ── The site-wide allowlist must be writable ─────────────────────────────────
head('__CONFIG__/theme');

ok("the backend allows writing the 'theme' key",
  /'__CONFIG__':\s*\[[^\]]*'theme'/.test(backendGs), (backendGs.match(/'__CONFIG__':[^\]]*\]/) || [''])[0]);
ok('the frontend reads the same key it is allowed to write',
  /loadSentinel\('__CONFIG__',\s*'theme'\)/.test(appJs));
ok('an empty or malformed allowlist falls back to every preset, never to none',
  /if \(!allow \|\| !allow\.length\) return PALETTES;/.test(appJs));

// ── Ship it ──────────────────────────────────────────────────────────────────
head('palette.css is shipped');

ok('the service worker caches it', /'\.\/palette\.css'/.test(swJs));
ok('the deploy tool serves it', /'palette\.css'/.test(deployJs));
ok('the cache name was bumped for the new file',
  (() => { const m = swJs.match(/CACHE_NAME\s*=\s*'ipassbook-v(\d+)'/); return !!m && parseInt(m[1], 10) > 24; })());

console.log(fails ? `\n${fails} FAILED\n` : '\nOK\n');
process.exit(fails ? 1 : 0);
