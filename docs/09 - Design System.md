# 09 — Design System

Where the colours, type, radius, shadows and focus rings in this app come from,
how to change them, and the two decisions that are not obvious.

## Provenance

The design language is **[Frappe Helpdesk](https://github.com/frappe/helpdesk)'s**,
which in turn is
[`frappe/frappe-ui`](https://github.com/frappe/frappe-ui)'s "Espresso 2.0" token
system. This app adopts the tokens, the component shapes and the feature model —
but **not** the stack. Frappe Helpdesk is a Vue SPA on Frappe Framework
(Python + MariaDB + Redis); I-PASSBOOK stays a static PWA on GitHub Pages with a
Google Apps Script backend and Google Sheets as the database.

Nothing was invented. The values in `tokens.css` are ported from:

| Source file in `frappe/frappe-ui` | Used for |
|---|---|
| `tailwind/colors.json` → `themedVariables` | every `--surface-*` / `--ink-*` / `--outline-*` value, in both modes |
| `tailwind/generated/radius.json` | `--radius-0…9`, `--radius-full` |
| `tailwind/generated/typography.json` | `--text-*` with their `lineHeight` and `letterSpacing` |
| `tailwind/generated/effects.json` | `--elevation-*` and `--focus-*`, per mode |
| `src/components/Button/Button.vue` | which token each button variant uses |

Frappe Helpdesk itself pins an older `frappe-ui`; these values come from `main`.
Re-deriving them against a pinned release is a one-line change to `SOURCES` in
the generator.

## Regenerating `tokens.css`

```bash
node tools/gen-tokens.mjs
```

It fetches the four source files above (caching them under `tools/.cache/` so
re-runs work offline), resolves the `themeVariables` reference indirection,
converts every `oklch()` value to sRGB, and rewrites `tokens.css`.

**`tokens.css` is checked in and deployed as-is.** The script is a convenience,
not a build step — if you hand-edit `tokens.css` and later re-run the script,
your edit is lost. Prefer adding a semantic alias at the bottom of the file over
editing a generated value.

To add a hue family, add its name to `HUES` in the script and re-run.

## Decision 1 — the palette ships twice (sRGB, then oklch)

Every Frappe colour is `oklch()`, and Frappe's Tailwind utilities compile to
`color-mix(in srgb, …)`. Both need Chrome/Edge 111+, Safari 16.4+, Firefox 113+,
and Frappe ships no fallbacks.

This app runs on field and warehouse phones and tablets we do not control. A
helpdesk that renders unstyled on a warehouse tablet is a worse failure than
slightly clipped colour, so `tokens.css` emits the whole palette **twice**:

```css
:root { --surface-base: #ffffff; … }          /* sRGB — always applied */
@supports (color: oklch(0 0 0)) {
  :root { --surface-base: oklch(1 0 0); … }   /* exact value where supported */
}
```

The hex is the oklch value converted to sRGB and gamut-clipped (the conversion is
in the generator). Wide-gamut displays get the exact colour; everything else gets
the closest sRGB equivalent.

**Why not the usual two-declaration trick** (`--x: #fff; --x: oklch(…)` in the
same block)? Because custom properties are not validated at parse time. A browser
without `oklch()` support stores the oklch string happily, and the failure only
surfaces when `var()` is substituted — at which point the declaration is
*invalid at computed-value time* and resolves to `unset`, i.e. it loses the hex
rather than falling back to it. `@supports` is the only correct way to do this.

## Decision 2 — the primary "action" colour is neutral

Frappe's primary button is `bg-surface-gray-10 text-ink-base`, not a brand hue.
`--surface-gray-10` is near-black in light mode and near-white in dark, so the
same token inverts correctly with no per-theme override.

The old Indrones brand blue (`#0E62FF`) is **gone** — no bespoke primary. That is
why `--btn-solid-bg` exists as a semantic alias: it names the role, so the accent
is a one-line change rather than a sweep through the CSS.

That alias is not decoration. It is what the **palette layer** re-points — see
below.

Blue still appears where it carries *meaning* rather than taste: the `--st-open-*`
triple, which is the "Open" status category. Those are deliberately not part of
the accent role, so choosing the Teal palette does not turn every Open badge teal.

The old `--ink-blue-link` token is **also gone**, and for a reason worth keeping:
it was `#0c8ef8`, which is **3.37:1 on white** — below WCAG AA at body size, which
is exactly the size the app's links are. Links and `.btn-primary` now come off
`ink-blue-7` / `surface-blue-9` (4.68:1 and 6.70:1). `tools/smoke-palette.mjs`
measures this on every palette in both themes, so a future palette cannot quietly
go unreadable.

## Palettes — the accent role

Users pick an appearance from four ready-made palettes — **Blue** (default),
**Violet**, **Teal**, **Graphite** — in the **user menu (top right)**. The
controls live there rather than at the bottom of the sidebar, which is where the
theme toggle used to be and which the owner had to scroll to reach. General rule
for this project: **no primary control lives at the bottom of a scrolling column.**

The mechanism is one indirection, in `palette.css`:

```
colour family  →  role name  →  component
`--ink-blue-7` →  `--accent`  →  a link's color
```

`palette.css` is loaded between `tokens.css` and `base.css` and sets eight roles
per palette: `--accent`, `--accent-soft`, `--accent-soft-line`, `--accent-bar`,
`--btn-solid-bg`, `--btn-solid-bg-hover`, `--btn-solid-bg-active`, `--btn-solid-fg`.

Three things to know:

- **`tokens.css` is generated and gets overwritten whole**, so the roles cannot
  live there. Add accent values to `palette.css` or they will disappear on the
  next `node tools/gen-tokens.mjs`.
- **Every palette follows one pattern** — accent `ink-<family>-7`, wash
  `surface-<family>-1`, bar `surface-<family>-7`, button `surface-<family>-9/-8/-7`
  — which is why contrast only had to be measured once. Graphite is the neutral,
  spelled `gray` in the tokens, and is the one licensed deviation (button on
  `gray-10/-9/-8`).
- **Red, green and amber are excluded on purpose.** They already mean danger,
  success and warning in the status badges; offering them as an accent would
  repaint a "Closed" badge with a cosmetic preference.

**Adding a palette** means editing two files, or the menu offers a choice that
does nothing: the `PALETTES` list in `app.js`, and a `[data-palette="…"]` block in
`palette.css`. `index.html`'s pre-paint script carries its own copy of the names
as a fallback, so it is a third place to update if the list changes.

The site-wide allowlist is `__CONFIG__/theme` (`{ palettes: [...], default }`).
A stored choice that is no longer allowed falls back to the default rather than
breaking.

## The polish level

The owner reviewed three levels as a preview page and chose **Noticeable**
(2026-09-18). The level is not a build flag, a config value or a class on
`<html>` — **it is a block at the end of `views.css`**, headed
`POLISH — level: NOTICEABLE`. Read that block's own header before editing it.

Two properties make it work, and both are easy to break:

1. **It wins because it is last, not because it is stronger.** Almost every rule
   in it restates a selector that already exists earlier, at the *same*
   specificity. Move the block, or reorder the stylesheet links, and the polish
   silently stops applying — no error, just a plainer app.
2. **It introduces no colour.** Every value is an existing token, so the level
   follows all four palettes and both themes with no extra work.

The levels are cumulative: Subtle (rhythm, separation) → Moderate (tinted
surfaces, a page header, accent-coloured active states) → Noticeable (depth,
motion, a gradient ground). Going back down means deleting the parts marked
"Noticeable", or the block.

`tools/build-polish-preview.mjs` regenerates the review page the decision was
made from (`tools/.cache/polish-preview.html`, a local file, git-ignored).
`tools/smoke-polish.mjs` ties the two together: it fails if the preview's rules
and the shipped block disagree, and if a selector in the block has no earlier
rule to beat.


## Token families and ramps

Three families. Learn these three and the rest follows:

- `--surface-*` — backgrounds. `1` is the most subtle, `10` the most emphatic.
- `--ink-*` — text and icons. Ramps **stop at 9**.
- `--outline-*` — borders and dividers.

Each has a neutral `gray-1…10` ramp plus per-hue ramps (`red, blue, green, amber,
violet`), and each has an `-alpha-*` variant for layering over images or
gradients. In light mode the alpha ramps are black-alpha; in dark they are
white-alpha. They are the replacement for the old glassmorphism cluster, which is
what used to block light mode.

Two quirks preserved deliberately rather than "fixed":

- Dark `--ink-gray-4` and `--ink-gray-5` are the same value. That is what the
  source says.
- Dark `--surface-alpha-base` is `rgba(0,0,0,0.039)` — black alpha in dark mode,
  where every other dark alpha token is white. Also from the source.

## Typography

`Inter Variable`, loaded with the `opsz,wght@14..32,100..900` axis — **not** the
static weight list. The design uses `font-variation-settings: 'opsz' 24, 'cv11' 1`
and a regular weight of **420**, neither of which a static Inter build provides.

Weights: `regular 420 · medium 500 · semibold 600 · bold 700`.

Sizes run `--text-2xs` (11px) to `--text-7xl` (32px), each paired with
`--leading-*` and `--tracking-*` (UI text is tight, 1.15; `--leading-body: 1.5`
for prose).

## Elevation and focus

Shadows differ between light and dark — dark mode carries its own values, which
is *not* what a naive reading of Frappe's source suggests. Dark depth additionally
comes from `--surface-elevation-1|2|3` rather than from shadow alone.

Focus rings are **box-shadows, not outlines**: `0 0 0 2px` in light, `0 0 0 3px`
in dark, applied through `--focus-default` on `:focus-visible`. They are shadows
so that they compose with a card's own shadow instead of replacing it.

## Adding a component

1. Find the equivalent in `frappe/frappe-ui` or `frappe/helpdesk` and read which
   tokens it uses. Do not eyeball a colour.
2. Use only `var(--…)` tokens — no raw hex, no px font sizes.
3. If a role has no token, add a semantic alias at the bottom of `tokens.css`
   (mapping onto an existing Frappe token) rather than inventing a value.
4. If the colour should follow the user's palette, use `var(--accent)` /
   `var(--accent-soft)` / `var(--btn-solid-bg)` — **never** a `--surface-blue-*`
   or `--ink-blue-*` directly. Naming a colour family in a component hard-codes
   the palette and the choice silently stops working.
5. Check both themes. A token that works in light and not in dark means the wrong
   family was picked — `surface` where `ink` was needed, most often.
