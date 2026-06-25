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
| Frontend | Vanilla HTML/CSS/JS | No framework, single `app.js` (31 KB) |
| Styling | Custom CSS with CSS variables | Dark glassmorphism theme |
| Backend | Google Apps Script (GAS) | Deployed as web app, in `backend.gs` |
| Database | Google Sheets | `APP_DATA` tab for passbook data, `Form Responses` tab for IR records |
| File Storage | Google Drive | Photos/files stored in `IR###/Section X` folders |
| Auth | Google OAuth 2.0 (GIS) | Restricted to `@indrones.com` domain |
| PWA | Service Worker + Manifest | Offline caching of static assets |

## File Structure

```
i-passbook-app/
├── index.html          # Main HTML shell (splash, auth, index, detail views)
├── app.js              # All frontend logic (~663 lines)
├── style.css           # Complete stylesheet (~540 lines)
├── backend.gs          # Google Apps Script backend (~316 lines)
├── sw.js               # Service worker for offline caching
├── manifest.json       # PWA manifest
├── assets/
│   ├── logo.png        # App icon (237 KB)
│   └── Indrones Intro v2.mp4  # Splash screen video (4.1 MB)
└── docs/               # ← This knowledge base
```

## Key Design Decisions

1. **No build tools** — deployed as static files, no bundler/transpiler
2. **No npm** — zero dependencies, runs in browser directly
3. **Mobile-first** — designed for phone use by field/warehouse staff
4. **Demo mode** — falls back to 5 hardcoded sample IRs when GAS backend is unreachable
5. **Dev bypass** — `?dev=1` on localhost skips Google auth entirely