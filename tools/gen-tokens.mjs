/* ============================================================
   gen-tokens.mjs — regenerate tokens.css

   Source of truth: frappe/frappe-ui `tailwind/colors.json`,
   `tailwind/generated/radius.json`, `tailwind/generated/effects.json`,
   `tailwind/generated/typography.json`.

   We hand-write plain CSS with no build step, so this script is a
   convenience for re-deriving the palette — NOT part of the deploy.
   tokens.css is checked in and is plain, hand-editable CSS. If you edit
   it by hand and later re-run this script, your edit is lost.

   Why the palette is emitted twice: Frappe's colours are all `oklch()`
   and their utilities compile to `color-mix()`, which need Chrome/Edge
   111+, Safari 16.4+, Firefox 113+. This app runs on field and warehouse
   devices we do not control, so every token is emitted as an sRGB hex
   first (works everywhere) and then upgraded to the exact `oklch()` inside
   `@supports` (wide-gamut accuracy where it is supported). The hex values
   are the oklch values converted and gamut-clipped — see docs/09.

   Usage:  node tools/gen-tokens.mjs
   ============================================================ */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'tools', '.cache');
const SOURCES = {
  colors: 'https://raw.githubusercontent.com/frappe/frappe-ui/main/tailwind/colors.json',
  radius: 'https://raw.githubusercontent.com/frappe/frappe-ui/main/tailwind/generated/radius.json',
  effects: 'https://raw.githubusercontent.com/frappe/frappe-ui/main/tailwind/generated/effects.json',
  typography: 'https://raw.githubusercontent.com/frappe/frappe-ui/main/tailwind/generated/typography.json',
};

// ── Which families to emit ───────────────────────────────────────────────────
// Only the hues this app actually uses. Add a name here and re-run to extend.
//
// `teal` is here for the palette presets rather than for any current use: it is one
// of the four accents a user can choose, and it was the one family Frappe ships that
// the app had not emitted yet. The ramps already exist in the cache, so this costs
// bytes and no colour decisions.
const HUES = ['red', 'blue', 'green', 'amber', 'violet', 'teal'];
// Raw key names as they appear in colors.json's themedVariables.
const GRAY = ['base', ...Array.from({ length: 10 }, (_, i) => `gray-${i + 1}`)];
const GRAY_INK = ['base', ...Array.from({ length: 9 }, (_, i) => `gray-${i + 1}`)];

// ── oklch → sRGB hex ─────────────────────────────────────────────────────────
// oklch → oklab → linear sRGB (Ottosson), then the sRGB transfer function.
// Out-of-gamut results are clipped, which is the point: the hex is the
// always-available approximation of the oklch value.
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];

  return lin.map(v => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  });
}

const hex2 = n => n.toString(16).padStart(2, '0');

// Parse any of the value shapes that appear in colors.json.
function toCss(value) {
  const v = String(value).trim();

  const m = v.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/);
  if (m) {
    const [, L, C, H, A] = m;
    const [r, g, b] = oklchToRgb(parseFloat(L), parseFloat(C), parseFloat(H));
    const alpha = A === undefined ? null : parseFloat(A);
    const hex = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    return {
      hex: alpha === null ? hex : `rgba(${r}, ${g}, ${b}, ${alpha})`,
      oklch: v,
    };
  }

  const named = { 'neutral/white': '#ffffff', 'neutral/black': '#000000' };
  if (named[v]) return { hex: named[v], oklch: null };

  throw new Error(`Unhandled colour value: ${v}`);
}

// ── Resolve themedVariables references → CSS values ──────────────────────────
function resolve(ref, colors) {
  if (ref === 'neutral/white') return { hex: '#ffffff', oklch: null };
  if (ref === 'neutral/black') return { hex: '#000000', oklch: null };
  if (ref === 'neutral/transparent') return { hex: 'transparent', oklch: null };

  const [mode, family, step] = ref.split('/');
  const raw = colors[mode]?.[family]?.[step];
  if (!raw) throw new Error(`Unresolved token reference: ${ref}`);
  return toCss(raw);
}

// ── Build the token table for one mode ───────────────────────────────────────
function buildMode(mode, colors) {
  const tv = colors.themedVariables[mode];
  const out = [];   // { name, hex, oklch }

  const push = (name, ref) => {
    const { hex, oklch } = resolve(ref, colors);
    out.push({ name, hex, oklch });
  };

  // surface / ink / outline — neutral ramps
  for (const key of GRAY) {
    if (tv.surface[key]) push(`--surface-${key}`, tv.surface[key]);
  }
  for (const key of GRAY) {
    if (tv['surface-alpha'][key]) push(`--surface-alpha-${key}`, tv['surface-alpha'][key]);
  }
  push('--surface-sidebar', tv.surface.sidebar);
  push('--surface-alpha-sidebar', tv['surface-alpha'].sidebar);
  for (const n of ['1', '2', '3']) push(`--surface-elevation-${n}`, tv.surface[`elevation-${n}`]);
  for (const n of ['1', '2', '3']) push(`--surface-alpha-elevation-${n}`, tv['surface-alpha'][`elevation-${n}`]);

  for (const key of GRAY_INK) {
    if (tv.ink[key]) push(`--ink-${key}`, tv.ink[key]);
  }

  for (const key of GRAY_INK) {
    if (tv.outline[key]) push(`--outline-${key}`, tv.outline[key]);
  }
  for (const key of GRAY_INK) {
    if (tv['outline-alpha'][key]) push(`--outline-alpha-${key}`, tv['outline-alpha'][key]);
  }
  for (const n of ['1', '2']) push(`--outline-elevation-${n}`, tv.outline[`elevation-${n}`]);

  // hue ramps
  for (const hue of HUES) {
    for (let n = 1; n <= 10; n++) {
      if (tv.surface[`${hue}-${n}`]) push(`--surface-${hue}-${n}`, tv.surface[`${hue}-${n}`]);
    }
    for (let n = 1; n <= 9; n++) {
      if (tv.ink[`${hue}-${n}`]) push(`--ink-${hue}-${n}`, tv.ink[`${hue}-${n}`]);
    }
    for (let n = 1; n <= 10; n++) {
      if (tv.outline[`${hue}-${n}`]) push(`--outline-${hue}-${n}`, tv.outline[`${hue}-${n}`]);
    }
  }

  return out;
}

// ── Fetch (cached in tools/.cache so re-runs work offline) ───────────────────
async function load(name, url) {
  const file = join(CACHE, `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${url}: ${res.status}`);
  const text = await res.text();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, text);
  return JSON.parse(text);
}

// ── Emit ─────────────────────────────────────────────────────────────────────
const colors = await load('colors', SOURCES.colors);
const radius = await load('radius', SOURCES.radius);
const effects = await load('effects', SOURCES.effects);
const typography = await load('typography', SOURCES.typography);

const light = buildMode('light', colors);
const dark = buildMode('dark', colors);

const pad = arr => Math.max(...arr.map(t => t.name.length));
const blockHex = (tokens, indent = '  ') => {
  const w = pad(tokens) + 1;
  return tokens.map(t => `${indent}${(t.name + ':').padEnd(w)} ${t.hex};`).join('\n');
};
const blockOklch = (tokens, indent = '    ') => {
  const hue = tokens.filter(t => t.oklch);
  const w = pad(hue) + 1;
  return hue.map(t => `${indent}${(t.name + ':').padEnd(w)} ${t.oklch};`).join('\n');
};

const elevation = (mode, indent = '  ') =>
  Object.entries(effects.elevation[mode])
    .filter(([k]) => k !== 'custom')
    .map(([k, v]) => `${indent}--elevation-${k}: ${v};`).join('\n');

const focus = (mode, indent = '  ') =>
  Object.entries(effects.focus[mode])
    .map(([k, v]) => `${indent}--focus-${k}: ${v};`).join('\n');

const RADIUS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'full'];
const FONT_SIZES = ['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl'];

const css = `/* ============================================================
   tokens.css — I-PASSBOOK design tokens

   Ported from frappe/frappe-ui ("Espresso 2.0"). GENERATED by
   tools/gen-tokens.mjs — re-run that script to re-derive the palette,
   but treat this file as hand-editable plain CSS: it is checked in and
   deployed as-is, with no build step.

   Palette structure (Frappe's three-family model):
     --surface-*   backgrounds, per hue + neutral ramp, 1 = most subtle
     --ink-*       text and icons              (ramps stop at 9)
     --outline-*   borders and dividers
     --surface-alpha-* / --outline-alpha-*   same ramps as alpha over
                   whatever is behind, for layering on images/gradients

   Light is the default on :root; dark overrides live on
   [data-theme="dark"] so the theme toggle wins in both directions.

   ⚠ The palette is emitted twice — sRGB hex first, then oklch inside
   @supports. See the header of tools/gen-tokens.mjs for why.
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   1 · PALETTE — sRGB (always applied; works on every browser)
   ══════════════════════════════════════════════════════════ */
:root {
${blockHex(light)}

  /* Elevation — shadows stay light-ish in dark mode; depth there comes
     from --surface-elevation-* instead. */
${elevation('light')}

  /* Focus rings (box-shadow, not outline — composes with card shadows) */
${focus('light')}
}

[data-theme="dark"] {
${blockHex(dark)}

${elevation('dark')}

${focus('dark')}
}

/* ══════════════════════════════════════════════════════════
   2 · PALETTE — oklch upgrade (wide-gamut displays only)
   ══════════════════════════════════════════════════════════ */
@supports (color: oklch(0 0 0)) {
  :root {
${blockOklch(light)}
  }

  [data-theme="dark"] {
${blockOklch(dark)}
  }
}

/* ══════════════════════════════════════════════════════════
   3 · RADIUS
   Frappe's default component radius is --radius-4 (8px).
   The numeric scale is the only one — v1 dropped the named
   sm/md/lg aliases and the bare \`rounded\`.
   ══════════════════════════════════════════════════════════ */
:root {
${RADIUS.map(k => `  --radius-${k}: ${radius[k]};`).join('\n')}
}

/* ══════════════════════════════════════════════════════════
   4 · TYPOGRAPHY
   Inter Variable with optical sizing. Note the regular weight is
   420, not 400 — that is deliberate, matching Frappe. UI text runs
   at line-height 1.15; body copy and paragraphs relax to 1.5–1.6.
   ══════════════════════════════════════════════════════════ */
:root {
  --font-sans: 'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --weight-regular:  ${typography.fontWeight.regular};
  --weight-medium:   ${typography.fontWeight.medium};
  --weight-semibold: ${typography.fontWeight.semibold};
  --weight-bold:     ${typography.fontWeight.bold};

${FONT_SIZES.map(s => {
  const [size, opts] = typography.fontSize[s];
  return `  --text-${s}: ${size};\n  --leading-${s}: ${opts.lineHeight};\n  --tracking-${s}: ${opts.letterSpacing};`;
}).join('\n')}

  --leading-body: 1.5;
}

/* ══════════════════════════════════════════════════════════
   5 · LAYOUT
   --header-h replaces the hardcoded 56px sticky offsets
   (.tabs-container, #user-menu, .nudge-panel all assumed it).
   ══════════════════════════════════════════════════════════ */
:root {
  --header-h: 56px;
  --sidebar-w: 232px;
  --list-w: 400px;
  --bottombar-h: 60px;
  --content-max: 860px;
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-t: env(safe-area-inset-top, 0px);

  --ease: cubic-bezier(0.4, 0, 0.2, 1);

  /* One z-index scale, replacing the ad-hoc 10/40/60/200/300/1000–1003/9999
     (which had #user-menu and .inward-options-modal colliding at 200). */
  --z-base: 1;
  --z-sticky: 20;
  --z-sidebar: 30;
  --z-header: 40;
  --z-bottombar: 40;
  --z-dropdown: 60;
  --z-overlay: 80;
  --z-modal: 90;
  --z-toast: 100;
  --z-splash: 110;
}

/* ══════════════════════════════════════════════════════════
   6 · SEMANTIC ALIASES
   Names the app's own components use. Each maps onto a Frappe token,
   so nothing here is a new colour — only a shorter way to say it.
   ══════════════════════════════════════════════════════════ */
:root {
  /* The accent role (--accent, --btn-solid-*) lives in palette.css, NOT here,
     because this script rewrites tokens.css wholesale — anything added to this
     block would be erased on the next run. This file names colours; palette.css
     names the job. Status categories, below, are semantic and do not move. */

  /* Status categories (see STATUS_CATEGORIES in app.js) */
  --st-open-bg:     var(--surface-blue-2);
  --st-open-fg:     var(--ink-blue-5);
  --st-open-bd:     var(--outline-blue-1);

  --st-paused-bg:   var(--surface-amber-2);
  --st-paused-fg:   var(--ink-amber-6);
  --st-paused-bd:   var(--outline-amber-2);

  --st-resolved-bg: var(--surface-green-2);
  --st-resolved-fg: var(--ink-green-6);
  --st-resolved-bd: var(--outline-green-2);

  --st-closed-bg:   var(--surface-gray-2);
  --st-closed-fg:   var(--ink-gray-6);
  --st-closed-bd:   var(--outline-gray-2);

  --st-legacy-bg:   var(--surface-violet-2);
  --st-legacy-fg:   var(--ink-violet-5);
  --st-legacy-bd:   var(--outline-violet-1);

  --st-danger-bg:   var(--surface-red-2);
  --st-danger-fg:   var(--ink-red-6);
  --st-danger-bd:   var(--outline-red-1);

  /* Collapsed sidebar (Gmail-style rail). A rail exactly as wide as the header is
     tall, so the collapse toggle at the top-left and the brand mark below it
     share one column edge. An alias, not a new value. */
  --rail-w: var(--header-h);
}
`;

writeFileSync(join(ROOT, 'tokens.css'), css);
console.log(`tokens.css written — ${light.length} light tokens, ${dark.length} dark tokens, ${css.split('\n').length} lines.`);
