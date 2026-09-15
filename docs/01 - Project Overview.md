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
| Frontend | Vanilla HTML/CSS/JS | No framework, single `app.js` (~4,900 lines) |
| Styling | Hand-written CSS, layered, no build step | Frappe-derived design tokens, light + dark |
| Backend | Google Apps Script (GAS) | Deployed as web app, in `backend.gs` |
| Database | Google Sheets | `APP_DATA` tab for passbook data, `Form Responses` tab for IR records |
| File Storage | Google Drive | Photos/files stored in `IR###/Section X` folders |
| Auth | Email + password, allowlist-gated | OTP + captcha sign-up; server session token in `sessionStorage` |
| PWA | Service Worker + Manifest | Offline caching of static assets |

## File Structure

```
i-passbook-app/
├── index.html          # App shell: splash, auth, sidebar, ticket list, detail pane
├── app.js              # All frontend logic (~4,900 lines)
├── tokens.css          # Design tokens — generated, see docs/09
├── base.css            # Reset, typography, splash/auth, app shell, breakpoints
├── components.css      # Buttons, inputs, pills, dropdowns, modals
├── views.css           # Ticket list, sync bar, ticket detail, intake report, section tables
├── tools/
│   ├── gen-tokens.mjs     # Regenerates tokens.css from frappe/frappe-ui
│   ├── harness.mjs        # Shared smoke-test harness
│   ├── smoke-all.mjs      # Runs every suite — the whole test command
│   └── smoke-*.mjs        # suites: shell, ir-state, intake, boot
├── backend.gs          # Google Apps Script backend (~1,240 lines)
├── sw.js               # Service worker for offline caching
├── manifest.json       # PWA manifest
├── assets/
│   ├── logo.png        # App icon (237 KB)
│   └── Indrones Intro v2.mp4  # Splash screen video (4.1 MB)
└── docs/               # ← This knowledge base
```

`style.css` no longer exists — it was replaced by the four layered stylesheets above
(see [09 — Design System](09 - Design System.md)).

## Key Design Decisions

1. **No build tools** — deployed as static files, no bundler/transpiler
2. **No npm** — zero dependencies, runs in browser directly
3. **Mobile-first** — designed for phone use by field/warehouse staff
4. **Demo mode** — falls back to 5 hardcoded sample IRs when GAS backend is unreachable
5. **Dev bypass** — `?dev=1` on localhost skips auth entirely