# 02 — Architecture & Data Flow

## High-Level Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────▶│  Google Apps      │────▶│  Google Sheets   │
│  (PWA SPA)   │◀────│  Script Backend   │◀────│  + Google Drive  │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │
      │ Auth via
      ▼
┌─────────────┐
│ Auth backend │  (GAS — email + password, @indrones.com
│ (GAS action) │   allowlist, OTP sign-up, server session token)
└─────────────┘
```

## App Screens

### 1. Splash Screen
- Plays `assets/Indrones Intro v2.mp4` for ~2 seconds
- Neutral dark chrome with the "I-PASSBOOK" wordmark
- Fades out, then checks auth state

### 2. Auth Screen
- Email + password sign-in; sign-up adds OTP verification and a server captcha
- Domain restriction: only `@indrones.com` emails (plus explicit allowlist entries)
- Dev bypass: `localhost` + `?dev=1` → auto-creates "Dev Tester" user
- Stores the display profile in `sessionStorage` as `ipb_user`; the real
  credential is the server session token, cleared when the app closes

### 3. Main App
- **Sidebar** (≥1024px) or **bottom nav** (<1024px) — Tickets, Legacy Records,
  User Access (admins), theme toggle
- **Ticket list** — search + All/Open/Paused/Resolved/Closed filter segments
- **Passbook detail** — 9 tabbed sections. On desktop it opens beside the list
  (split pane); below 1024px it is a full screen with a Back button.
- Routing is hash-based (`#/tickets`, `#/tickets/IR409`) so deep links and the
  browser back button work on a static host

## Data Flow

### Fetching IR List (`listIRs`)
```
Browser → GET docs.google.com/.../gviz/tq?tqx=out:csv&sheet=Form Responses
       → Frontend parses CSV directly from the IR Repository Sheet
       → No Apps Script deploy required (sheet is link-shared)
       → Falls back to GAS ?action=listIRs, then demo data, on failure
```
> **Note:** The IR list is read directly from the **"Form Responses"** tab by the
> frontend. The GAS `listIRs` action reads the same tab (`IR_REPO_TAB`) and is
> kept as a fallback; it also joins `APP_DATA` for `a_overallStatus`.

### Fetching Passbook Data (`getPassbook`)
```
Browser → GET GAS_URL?action=getPassbook&irNumber=IR409
       → GAS reads APP_DATA tab for all rows matching IR409
       → Returns { status: "ok", sections: { "sec-a": {...}, ... } }
```

### Saving a Section (`saveSection`)
```
Browser → POST GAS_URL with FormData:
           action=saveSection, irNumber, sectionId, savedBy, fields (JSON), files (JSON)
       → If files: uploads to Google Drive → IR###/Section X folder
       → Upserts row in APP_DATA tab
       → Returns { status: "ok", message: "..." }
```

## APP_DATA Sheet Structure

| Column | Content |
|---|---|
| A | IR Number (e.g., "IR409") |
| B | Section ID (e.g., "sec-a") |
| C | Saved By (email) |
| D | Fields (JSON object) |
| E | Last Updated (timestamp) |

Each section save = one row. Upsert by matching IR Number + Section ID.

## Demo Mode

When GAS is unreachable (CORS error, network failure), the app falls back to `getDemoIRs()` which returns 5 hardcoded sample records (IR405–IR409). This keeps the UI visible for development/review.