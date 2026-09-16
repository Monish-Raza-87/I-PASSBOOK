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
│ Auth backend │  (GAS — email + password, admin-provisioned
│ (GAS action) │   accounts, 30-day sliding session token)
└─────────────┘
```

## App Screens

### 1. Splash Screen
- Plays `assets/Indrones Intro v2.mp4` for ~2 seconds
- Neutral dark chrome with the "I-PASSBOOK" wordmark
- Fades out, then checks auth state

### 2. Auth Screen
- Email + password sign-in. **There is no sign-up** — an admin provisions every
  account and hands over a temporary password (see
  [10 — Auth & Access Model](10 - Auth & Access Model.md)).
- Also lives here: the **forgot-password** flow (email → reset code → new
  password) and the **forced password change** screen a first-time account lands on.
- Dev bypass: `localhost` + `?dev=1` → auto-creates "Dev Tester" user
- Stores the display profile in `localStorage` as `ipb_user` and the server
  session token alongside it, slid forward on use, good for 30 days of activity

### 3. Main App
- **Sidebar** (≥1024px) or **bottom nav** (<1024px) — Tickets, Legacy Records,
  User Access (admins), theme toggle
- **Ticket list** — search + All/Open/Paused/Resolved/Closed filter segments, with
  a sync bar (`#sync-status`) showing the last status message, a "Synced HH:MM"
  stamp and a manual Refresh. Silent staleness is what sends people back to the
  Sheet, so it is deliberately always visible.
- **Passbook detail** — the 📋 Report tab plus the 9 tabbed sections. On desktop it
  opens beside the list (split pane); below 1024px it is a full screen with a Back
  button.
- Routing is hash-based (`#/tickets`, `#/tickets/IR409`) so deep links and the
  browser back button work on a static host

## Who owns what (the load-bearing split)

The client's **Google Form stays the front door**, and the Sheet it writes to is
the **immutable client intake**: what the customer wrote is never edited by the
app. The app owns all **mutable workflow state**.

| Data | Owner | Where it lives |
|---|---|---|
| Serial no., description, incident date, who reported, evidence | Sheet | Form Responses tab, read-only |
| Status, assignee, priority, type, section completion, SLA, CSAT | **App** | `__IRS__` sentinel store |

Precedence is always **app > Sheet**, merged in the single writer `setAllIRs()`
(`app.js`), which every `fetchIRs()` path funnels through so the three paths
cannot disagree. This is what fixed the original badge bug: the list badge read
the Sheet's Col D while an in-app status edit saved to `APP_DATA`
`sec-a.a_overallStatus` — itself auto-filled *from* Col D on every open — so an
in-app status change never reached the badge. `a_overallStatus` is now **legacy**:
it is still saved, and the legacy log still shows it, but nothing reads it back as
the badge's truth and `getAllIRStatuses()` no longer scans `sec-a` rows at all — it
reads `__IRS__`.

The app takes ownership of a ticket's status **when someone changes the status in
the app** (`irState[x].statusOwned`), not by opening a ticket or saving a section.
An edit made in the Sheet therefore still works on an untriaged ticket.

> **Consequence worth saying out loud to staff:** once a ticket is triaged in the
> app, changing Col D in the Sheet no longer does anything.

## Data Flow

### Fetching IR List (`fetchIRs`)
```
Browser → GET docs.google.com/.../gviz/tq?tqx=out:csv&gid=<Form Responses>
       → parseCSV → mapSheetRows(rows) → setAllIRs()   ← app state merged here
       → No Apps Script deploy required (sheet is link-shared)
       → Falls back to GAS ?action=listIRs, then demo data, on failure
```
> **Note:** The IR list is read directly from the **"Form Responses"** tab by the
> frontend. The GAS `listIRs` action reads the same tab (`IR_REPO_TAB`) and is
> kept as a fallback; it also joins `__IRS__` for the app-owned status.

### The intake column map (`INTAKE_FIELDS` / `mapSheetRows`)
`mapSheetRows()` is pure — no fetch, no DOM — so the whole mapping is unit-tested
(`tools/smoke-intake.mjs`). Headers are matched by **substring**, so a small
reword of a Form question does not break the map, and a reordered Form still maps
field-for-field. Each record carries:

- the typed projection the rest of the app reads (`irNumber`, `status`,
  `dateRaisedISO`, …)
- `intake{}` — the **raw cell text** for every ingested column, because the typed
  projection is lossy (the Sheet's Timestamp carries a time that `dateRaised`
  drops)
- `extra[]` — any column the Form writes that `INTAKE_FIELDS` does not model

`extra` is the audit. `backend.gs`'s `IR_REPO_*_COL` constants account for columns
A–D, F–I, K–N and P–R, so **columns E, J and O are unaccounted for** — and so is
anything the Form grows later. Rather than dropping them, they surface on the 📋
Report tab and the app records which headers it did not recognise
(`lastSheetAudit`).

### Fetching Passbook Data (`getPassbook`)
```
Browser → GET GAS_URL?action=getPassbook&irNumber=IR409
       → GAS reads APP_DATA tab for all rows matching IR409
       → Returns { status: "ok", sections: { "sec-a": {...}, "sec-b": {...}, ... } }
```
`sec-a` here is the **Overview's data key**, not a section — it is not in
`SECTION_KEYS`, which is why `getPassbook`'s visibility filter names
`OVERVIEW_KEY` explicitly. Without that, the Overview's data would be returned to
the admin alone and blank for everyone else.

The same call returns the whole `__IRS__` store in one request
(`getPassbook('__IRS__')` → `{sections: {IR409: {...}, IR410: {...}}}`), because
that is already how `getPassbook` behaves.


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
| A | IR Number (e.g., "IR409") — or a `__`-prefixed sentinel store name, e.g. `__IRS__` |
| B | Section ID (e.g., "sec-b"), or for a sentinel row the **record's own key** (for `__IRS__`, the real IR — the sentinel name is in column A) |
| C | Saved By (email) |
| D | Fields (JSON object) |
| E | Last Updated (timestamp) |

Each section save = one row. Upsert by matching IR Number + Section ID. The
`__IRS__` store therefore adds one row per IR, keyed by the real IR in column B —
see [04](04 - Backend API Reference.md) for why one row per IR rather than one map
record. The merge migration rewrites these rows in place and must **never** touch a
row whose column A starts with `__`.

## Demo Mode

When GAS is unreachable (CORS error, network failure), the app falls back to `getDemoIRs()` which returns 5 hardcoded sample records (IR405–IR409). This keeps the UI visible for development/review.