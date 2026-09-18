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
│   ├── make-icons.ps1     # Regenerates the icon set from assets/icon-master.jpeg
│   ├── deploy-ghpages.mjs # Publishes to the gh-pages branch (dry run by default)
│   ├── serve-local.mjs    # Zero-dependency local server (no npm download)
│   ├── harness.mjs        # Shared smoke-test harness
│   ├── smoke-all.mjs      # Runs every suite — the whole test command
│   └── smoke-*.mjs        # suites: shell, boot, palette, polish, store, backend …
├── backend.gs          # Google Apps Script backend (~1,240 lines)
├── sw.js               # Service worker for offline caching
├── manifest.json       # PWA manifest
├── assets/
│   ├── icon-master.jpeg # The brand master — the ONLY source for the icons below
│   ├── icon-192.png    # App icon (manifest + favicon + the sign-in card)
│   ├── icon-512.png    # App icon, large
│   ├── apple-touch-icon.png  # 180×180, the size iOS asks for
│   ├── logo.png        # Legacy letterhead — NOT an icon, pruned from the deploy
│   ├── intro_ipassbookv2.mp4         # Splash video, 16:9 master (9.7 MB, 9.0s)
│   └── intro_ipassbookv2_mobile.mp4  # Splash video, portrait cut (3.8 MB, 9.1s)
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

## Key Design Decisions

1. **No build tools** — deployed as static files, no bundler/transpiler
2. **No npm** — zero dependencies, runs in browser directly
3. **Mobile-first** — designed for phone use by field/warehouse staff
4. **Demo mode** — falls back to 5 hardcoded sample IRs when GAS backend is unreachable
5. **Dev bypass** — `?dev=1` on localhost skips auth entirely