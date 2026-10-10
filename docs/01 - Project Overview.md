# 01 — Project Overview

## What It Is

**I-PASSBOOK** = **I**ndrones **P**roduct **A**fter-Sales **S**ummary **Book**

A Progressive Web App (PWA) for **Indrones** (Indian drone company) that serves as their product after-sales intelligence platform. It tracks, manages, and resolves **Information Reports (IRs)** — the company's internal term for customer service/repair tickets for drone products.

## Who Uses It

- **Warehouse staff** — receiving drones, doing inward checklists
- **IQC inspectors** — inspecting incoming units
- **Tech support engineers** — analyzing root causes, estimating repair costs
- **Production technicians** — performing rework
- **QC inspectors** — testing after rework
- **Test pilots** — flight testing repaired drones
- **PDI inspectors** — pre-delivery checks before shipping
- **Logistics staff** — dispatching units back to customers

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | No framework, single `app.js` (~5,350 lines) |
| Styling | Hand-written CSS, layered, no build step | Frappe-derived design tokens, light + dark |
| Backend | Google Apps Script (GAS) | Deployed as web app, in `backend.gs` |
| Database | **JSON files in Google Drive** | `_store/` in the owner's Drive folder — accounts, sessions, access, every section, the audit trail. No spreadsheet holds app data (see [02](02 - Architecture & Data Flow.md)) |
| Sheets (inputs only) | Google Sheets — **read-only** | `Form Responses` for IR intake, the legacy workbook for the 🏛 Legacy view. Nothing is ever written to either |
| File Storage | Google Drive | Photos/files stored in `IR###/Section X` folders |
| Auth | Email + password + an **emailed 6-digit code**, admin-provisioned | No self-signup; sign-in is two steps (password, then a code that is issued once and reused for the working day); an **8h30m absolute** session token in `localStorage` (see [10](10 - Auth & Access Model.md)) |
| PWA | Service Worker + Manifest | Offline caching of static assets |

## File Structure

```
i-passbook-app/
├── index.html          # App shell: splash, auth, sidebar, ticket list, detail pane
├── app.js              # All frontend logic (~5,350 lines)
├── tokens.css          # Design tokens — generated, see docs/09
├── palette.css         # The accent role + the four selectable palettes (hand-written, not generated)
├── base.css            # Reset, typography, splash/auth, app shell, breakpoints
├── components.css      # Buttons, inputs, pills, dropdowns, modals
├── views.css           # Ticket list, sync bar, ticket detail, intake report, section tables
├── tools/
│   ├── gen-tokens.mjs     # Regenerates tokens.css from frappe/frappe-ui
│   ├── make-icons.ps1     # Regenerates the icon set from assets/icon-master.png
│   ├── deploy-ghpages.mjs # Publishes to the gh-pages branch (dry run by default)
│   ├── serve-local.mjs    # Zero-dependency local server (no npm download)
│   ├── harness.mjs        # Shared smoke-test harness
│   ├── smoke-all.mjs      # Runs every suite — the whole test command
│   └── smoke-*.mjs        # suites: shell, boot, palette, polish, store, backend …
├── backend.gs          # Google Apps Script backend (~1,240 lines)
├── sw.js               # Service worker for offline caching
├── manifest.json       # PWA manifest
├── assets/
│   ├── icon-master.png        # The ink master — the owner's "Browser Tab Logo",
│   │                          #   478×522, the monogram ON TRANSPARENCY. Build input.
│   ├── icon-master-plate.png  # The plate master — his "Mobile Logo", 741×809,
│   │                          #   the same monogram on an opaque plate. Build input.
│   ├── icon-mark.png          # Generated. The ink master cropped to its ink box,
│   │                          #   512×588 — the mark the app and every page shows:
│   │                          #   sidebar, sign-in card, `#sso-wait`, the Google
│   │                          #   door's transition page, AND the browser tab.
│   ├── icon-192.png           # Generated. The master ON THE PLATE, 192²
│   ├── icon-512.png           # Generated. The master ON THE PLATE, 512²
│   ├── apple-touch-icon.png   # Generated. The master ON THE PLATE, 180²
│   ├── brand-intro.mp4        # The sign-in film (the left half of the split door)
│   ├── brand-panel-light.png  # The sign-in panel's ground, light
│   ├── brand-panel-dark.png   # The sign-in panel's ground, dark
│   ├── logo.png               # Legacy letterhead — NOT an icon, pruned at deploy
│   └── Indrones Intro v2.mp4  # Superseded by brand-intro.mp4, pruned at deploy
└── docs/               # ← This knowledge base
```

`style.css` no longer exists — it was replaced by the five layered stylesheets above
(see [09 — Design System](09 - Design System.md)).

**The icon pipeline, in one place, because it is not obvious from the files.**
`assets/icon-master.jpeg` is the brand master and the only source; the three PNGs
beside it are generated from it by `tools/make-icons.ps1` (PowerShell +
System.Drawing — this repo has no npm access, so there is no sharp/jimp).
The tool downscales the master **as a whole square**, never cropping to the
mark's bounding box: the artwork sits on a soft wash that reaches all four edges
of the master, and a tight crop slices that gradient into a visible rectangular
seam on a white icon. So the size of the mark inside the icon is decided by how
the master is cropped, not by the tool — the master's current crop puts the mark
at 75% of the icon's width. Replacing the master means re-running the tool **and
bumping `CACHE_NAME` in `sw.js`**, because `icon-192.png` is precached.

The same run also writes **`assets/icon-mark.png`**, and that one is a different
kind of file: the artwork with its light background made **transparent**, for the
two places the app shows the brand *inside* itself (the sidebar and the sign-in
card). The square OS icons keep their background on purpose — a home-screen tile
is square and the platform masks it — but on a card that background reads as a
tile sitting on the page, which is what the owner saw and asked to have removed.
Keying it out cannot be done by colour, because the monogram and the "Passbook"
script are the *same colour* as the background they sit on; only **connectivity**
separates them, so the tool floods inward from the border and stops at anything
that is not background-coloured. That flood is ~2.7 million pixels, so it is
compiled with `Add-Type` rather than looped in PowerShell.

**The flood alone was not enough, and the failure was invisible for a while.**
The white inside the circle is NOT sealed off by the circle: the "Passbook" script
crosses the rim, so the light knockout band behind those letters is a bridge from
the outside straight into the middle of the artwork. The flood walked it and
punched out the monogram and the lettering — 21,000 pixels of artwork turned
see-through. On a light page that is indistinguishable from correct, because a
transparent hole shows the page and the page is the same near-white the artwork's
background was; it only became visible in **dark mode**, where the mark turned
into an empty box. The circle was restored from the original pixels after the
fill (`RestoreDisc`), located from the surviving ink rather than from hardcoded
geometry. Rendering the mark over magenta is what makes this class of bug obvious.

`smoke-shell.mjs` decodes the PNG and counts its pixels — the intact mark had
~22,000 opaque near-white ones and a hollowed-out mark had ~800 — because a
dimension check and a "not blank" check both pass on the broken file.

---

### ⚠ All of the above is history. The brand changed on 2026-10-10.

The owner replaced the 2025 disc with **Option A, The Telemetry Grid & Sub-Branding
Variant**, and said: *"we need to use our same logo everywhere which is Option A."*
Asked whether the icon should be the monogram or the whole lockup he answered **"The
full lockup."** The master is now **`assets/icon-master.png`** — the same artwork
resampled to 1024×1024, because the delivered 2048×2048 master lives in the untracked
`Brand Elements I-PASSBOOK/` folder and a clone must be able to regenerate the icons.

Four things changed with it, and the four paragraphs above describe none of them:

- **There is no disc, so there is no flood fill and no `RestoreDisc`.** Option A's
  field is a flat near-white and its art is two **solid** inks — navy `#2b2b3a` and
  brand yellow `#f8c808`, plus a darker yellow facet on the bolt. `RestoreDisc` is
  **deleted, not left dormant** — it was keyed to a disc that no longer exists.
- **The mark is the monogram, not the lockup.** `icon-mark.png` is the P alone, because
  the places the app shows it sit it beside the name already spelled out in text.
- **The blueprint gridlines and hairlines were kept, deliberately.** They were drawn
  over that artwork and the colour key kept them, which was the right answer: the
  telemetry grid was the point of the variant.
- **Dark mode flattens the mark to a WHITE SILHOUETTE** — `brightness(0) invert(1)`, the
  exact treatment the old note above called the wrong answer. It was the wrong answer
  *for a disc*; it is the right one here. Inverting Option A outright turns its navy
  bone-white and its brand yellow `#f8c808` into `#0737f7`, an electric blue — legible,
  so it passes any "is it visible" check, and not the brand. Rendered and looked at
  before changing it, not reasoned about: `tools/.cache/mark-dark.png`.

### ⚠⚠ And the icon split changed again, the same day — 2026-10-10, later.

The owner then supplied **two files of his own** — `Mobile Logo.png` and
`Browser Tab Logo.png` in the untracked `Brand Elements I-PASSBOOK/` — and named their
slots: the first for the home screen, the second **for the browser tab**. They are one
composition at two scales: the tab file is the monogram **on transparency** (478×522),
the mobile file the same monogram **on an opaque plate** (741×809), and the ratio agrees
to four decimals (0.9157 vs 0.9159), which is what makes them derivable from one another
rather than each resampled down its own pipeline.

So there are now **two masters**, and the split is **one mark, two grounds** rather than
two marks:

| File | Source | Where it goes |
|---|---|---|
| `icon-master.png` | his **Browser Tab Logo**, verbatim | build input only — never served |
| `icon-master-plate.png` | his **Mobile Logo**, verbatim | build input only — never served |
| `icon-mark.png` | the ink master, cropped to its own alpha bounding box and resized to exactly 512 wide (512×588) | the sidebar, the sign-in panel, `#sso-wait`, the Google door's transition page, **and the browser tab** |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | the **plate** master, edge-clamped to a square and resized | the manifest and the OS home-screen tiles |

The reasoning is that a home screen draws a **square and masks it itself**, so a tile
should arrive plated; but a page draws the mark on its own ground, where a plate reads as
exactly the "shape of square" the owner had already reported once. The tab was the last
place still holding the framed lockup, where at 16 px it is a smudge — the same artwork he
had separately called "dirt" at 56 px on the door page, before anyone connected the two.
**No new file was added to any list**: `icon-mark.png` was already precached and already
served, so the tab simply points at it (`<link rel="icon">` on `index.html` and the four
standalone pages) and nothing had to be kept in step in three places.

**What the tool does now, and what it refuses.** No colour key runs at all — the incoming
art arrives with its alpha already in it, and a key over keyed art is how the old
leak-and-restore failure would come back. `icon-mark.png`'s crop is **measured** from the
master's own alpha, not hardcoded, and the tool **refuses to write anything** unless every
one of these holds: the two masters are still the same composition (aspect within 0.005);
the plate master's corner is opaque and its field carries at least 3 % artwork; the tab
master has opaque pixels at all; its ink is at least 30 % of its canvas wide and does not
fill the whole canvas (a crop that found nothing and a crop that found everything are the
two shapes a silent failure takes); at least 10 % of the mark's opaque pixels are brand
yellow and 5 % navy (the bolt is the thing that can go missing without the mark looking
broken); and the mark is 20–70 % transparent. **All of those checks run before a single
file is saved** — they did not, and the tiles used to be written first, so a refusal
ending *"Nothing was written"* left three fresh square icons on disk for the next
`git add` to carry into a release. The plate colour is **sampled from the plate master's
own corner** rather than hardcoded, so it follows the owner's file.

`smoke-shell.mjs` checks the other side of it: that `icon-mark.png` really is
49 % transparent, 66 % brand yellow and 29 % navy; that both masters are present; that
every declared manifest icon is a real PNG of the size it claims and not a blank one; and
that `index.html` points the tab at `icon-mark.png` and **not** at `icon-192.png`.

The mark is never drawn above 60 px in the app (26 px sidebar, 56 px handoff, 60 px
sign-in panel).

## Key Design Decisions

1. **No build tools** — deployed as static files, no bundler/transpiler
2. **No npm** — zero dependencies, runs in browser directly
3. **Mobile-first** — designed for phone use by field/warehouse staff
4. **Demo mode** — falls back to 5 hardcoded sample IRs when GAS backend is unreachable
5. **Dev bypass** — `?dev=1` on localhost skips auth entirely