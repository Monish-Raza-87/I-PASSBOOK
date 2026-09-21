# 02 — Architecture & Data Flow

## High-Level Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────▶│  Google Apps      │────▶│  Google Drive    │
│  (PWA SPA)   │◀────│  Script Backend   │◀────│  JSON files      │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │                     │
      │                     └────▶ Google Sheets — READ-ONLY inputs only
      │                            (customer Form Responses, legacy workbook)
      │ Auth via
      ▼
┌─────────────┐
│ Auth backend │  (GAS — email + password + an emailed sign-in code,
│ (GAS action) │   admin-provisioned accounts, 8h30m absolute session)
└─────────────┘
```

**No spreadsheet holds app data.** The app's own store is JSON files in Drive —
accounts, sessions, the access matrix, every saved section, the audit trail — under
`_store/` in `CONFIG.DRIVE_ROOT_FOLDER_ID`. The only two Sheets the backend touches
are read-only inputs: the client's `Form Responses` tab, and the legacy workbook for
the 🏛 Legacy view. See [08 — Development Guide](08 - Development Guide.md) for the
store layout.

## App Screens

### 1. Splash Screen
- Plays the intro — on the way to the **sign-in screen**, every time. Two cuts of it
  ship: `assets/intro_ipassbookv2_mobile.mp4` (portrait, 9.07 s) is listed **first** in
  the `<video>` and gated with `media="(max-width: 639px)"`; the 16:9 master
  `assets/intro_ipassbookv2.mp4` (9.03 s) carries no media attribute, so it is both
  the desktop cut and the fallback for a browser that ignores `media` on `<source>`.
  `<source>` selection takes the **first** entry that matches, so the order matters —
  swapping them sends every phone the landscape master.
- The one device that skips it is one that is **already signed in** (`ipb_user` and
  `ipb_session` both present), because those people resume straight into the app. The
  pre-paint script in `index.html` sets `data-splash="skip"` on that pair before the
  body parses, so they see nothing, and `app.js`'s boot path skips too — before it
  touches the video, so they download nothing either (`preload="none"`).
- Dismissal is driven by the video's own `ended` event, not a fixed wait, with an
  `INTRO_FALLBACK_MS` (9.5 s) backstop so a missing or unplayable file still
  reaches sign-in. **The fallback must stay ≥ the longest cut** — a shorter timer is
  what silently cut the previous intro off mid-play; `smoke-shell.mjs` now reads the
  duration out of each MP4 header and fails if it doesn't.
- Nothing is drawn over the video. It plays full-bleed; the loader bar is timed from
  the video's own duration via `--intro-ms`. The wordmark and the full product name
  that used to sit on top of it live on the sign-in card instead.
- Fades out, then checks auth state

### 2. Auth Screen
- **Sign in with Google**, when a second deployment is configured (`CONFIG.SSO_URL`).
  No password and no emailed code. The click **leaves the page**: it navigates to the
  second deployment, which reads the caller's Workspace identity and answers with a page
  naming that account and carrying **one button** — Apps Script's sandbox forbids a page
  from navigating the top window on its own, so the user taps it — which returns to the
  app with a one-time code in the URL fragment that the app swaps for a session on the
  primary backend. A wrong or missing URL shows **no button** and changes nothing else.
  The round trip the code is exchanged over is covered by the **wait screen**
  (`#sso-wait`): `index.html` raises it before paint for a `#sso=` return and `app.js`
  takes it down when a real screen is reached, so the sign-in form never shows through
  the handover — see [06 — UI Components & Styling](06 - UI Components & Styling.md).
  It is an **addition**: the password form below it is not a lesser fallback. See
  [10 — Auth & Access Model](10 - Auth & Access Model.md).
- Email + password sign-in, then a 6-digit code emailed to the same address. **There
  is no sign-up** — an admin provisions every account and hands over a temporary
  password (see [10 — Auth & Access Model](10 - Auth & Access Model.md)). The code is
  issued once and reused for the rest of the working day. A temp-password account is
  refused on the Google door and sent here, so the forced change still happens.
- Also lives here: the **forgot-password** flow (email → reset code → new
  password) and the **forced password change** screen a first-time account lands on.
- Dev bypass: `localhost` + `?dev=1` → auto-creates "Dev Tester" user
- Stores the display profile in `localStorage` as `ipb_user` and the server
  session token alongside it — **absolute**, 8h30m from sign-in, and never slid
  forward on use

### 3. Main App
- **Sidebar** (≥1024px) or **bottom nav** (<1024px) — Tickets, Legacy Records,
  User Access (admins), theme toggle
- **Ticket list** — search + All/Open/Paused/Resolved/Closed filter segments, with
  a sync bar (`#sync-status`) showing the last status message, a "Synced HH:MM"
  stamp and a manual Refresh. Silent staleness is what sends people back to the
  Sheet, so it is deliberately always visible.
- **Passbook detail** — the 📋 Report tab plus the six lettered sections (B–G) and
  the Overview. On desktop it opens beside the list (split pane); below 1024px it is
  a full screen with a Back button.
- **Insights** — counts over the same IRs (FY, month, status, category, customer,
  drone), a read-only third pane rather than a panel inside the detail one, so
  `#detail-view`'s display keeps meaning "an IR is open". No new endpoint: the whole
  list is already in memory.
- Routing is hash-based (`#/tickets`, `#/tickets/IR409`, `#/insights`, `#/legacy`) so
  deep links and the browser back button work on a static host

## Who owns what (the load-bearing split)

The client's **Google Form stays the front door**, and the Sheet it writes to is
the **immutable client intake**: what the customer wrote is never edited by the
app. The app owns all **mutable workflow state**.

| Data | Owner | Where it lives |
|---|---|---|
| Serial no., description, incident date, who reported, evidence | Sheet | Form Responses tab, read-only |
| Status, assignee, priority, category, section completion, SLA, CSAT | **App** | `irs.json` under `__IRS__` |

Precedence is always **app > Sheet**, merged in the single writer `setAllIRs()`
(`app.js`), which every `fetchIRs()` path funnels through so the three paths
cannot disagree. This is what fixed the original badge bug: the list badge read
the Sheet's Col D while an in-app status edit saved to the app's own store as
`sec-a.a_overallStatus` — itself auto-filled *from* Col D on every open — so an
in-app status change never reached the badge. `a_overallStatus` is now **legacy**:
it is still saved, and the legacy log still shows it, but nothing reads it back as
the badge's truth and `getAllIRStatuses()` reads `irs.json`.

The app takes ownership of a ticket's status **when someone changes the status in
the app** (`irState[x].statusOwned`), not by opening a ticket or saving a section.
An edit made in the Sheet therefore still works on an untriaged ticket.

> **Consequence worth saying out loud to staff:** once a ticket is triaged in the
> app, changing Col D in the Sheet no longer does anything.

## Data Flow

### Fetching IR List (`fetchIRs`)
```
Browser → localStorage 'ipb_ir_list'  ← this device's last copy, painted first
       → GET docs.google.com/.../gviz/tq?tqx=out:csv&gid=<Form Responses>
       → parseCSV → mapSheetRows(rows) → setAllIRs()   ← app state merged here
       → No Apps Script deploy required (sheet is link-shared)
       → Falls back to GAS ?action=listIRs, then demo data, on failure
```
> **Note:** The IR list is read directly from the **"Form Responses"** tab by the
> frontend. The GAS `listIRs` action reads the same tab (`IR_REPO_TAB`) and is
> kept as a fallback; it also joins `irs.json` for the app-owned status.
>
> **The cache is a first paint, not a source of truth.** It exists so the list is on
> screen before any network call, and it needs no invalidation because the read
> below always overwrites it — it can only ever be one round trip stale. What it
> also buys is honesty on the failure path: with a list already on screen, an outage
> keeps the **real** records and says *"Could not refresh — showing the last saved
> list"*. The five fabricated sample IRs are reached **only** from a cold start with
> nothing real to show. Showing samples to someone who has four hundred real IRs is
> not a placeholder, it is misinformation they could act on.
>
> **`listIRs` was NOT promoted to the primary read**, though it was planned. It
> returns no `intake`, no `extra` and no `dateRaisedISO` and does not split the name
> from the phone, unlike `mapSheetRows` — promoting it would have silently emptied
> the 📋 Report tab's raw cells and made Insights treat every IR as undated. See
> [07](07 - Known Issues & TODO.md).

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
       → GAS resolves the subject to ONE JSON file:  sections/IR409.json  (via
         sections/index.json → getFileById), or for a sentinel store the file
         named by sentinelStoreFile(): irs.json / config.json / comments.json / kb.json
       → Returns { status: "ok", sections: { "sec-a": {...}, "sec-b": {...}, ... } }
```
All five subjects are the same shape — **a JSON object that maps a key to a fields
object** — so there is exactly one read path and one write path. `sec-a` is the
**Overview's data key**, not a section — it is not in `SECTION_KEYS`, which is why
`getPassbook`'s visibility filter names `OVERVIEW_KEY` explicitly. Without that, the
Overview's data would be returned to the admin alone and blank for everyone else.

The same call returns the whole `__IRS__` store in one request
(`getPassbook('__IRS__')` → `{sections: {IR409: {...}, IR410: {...}}}`), because
that is already how `getPassbook` behaves — and with a keyed file that read is now
literally one `readJson('irs.json')`.


### Saving a Section (`saveSection`)
```
Browser → POST GAS_URL with FormData:
           action=saveSection, irNumber, sectionId, savedBy, fields (JSON), files (JSON)
       → If files: uploads to Google Drive → IR###/Section X folder  (outside the lock)
       → ONE locked read-merge-write:  store[sectionId] = fields
         (for `sec-a` — the Overview — the stored record is copied first and the
          posted keys laid over it, so a_activityLog survives; every other section
          keeps replace semantics, which is what `restoreField` depends on)
       → appendAuditLinesLocked() LAST, inside the same lock
       → Returns { status: "ok", message: "..." }
```

The write replaces **one key**, never the file. That single fact is the most
dangerous thing to get wrong here: `writeJson('config.json', fields)` would wipe the
team directory and the dropdown config, and `writeJson('irs.json', row)` would wipe
the workflow state of all 450 tickets.

## The store, not a sheet

There is no `APP_DATA` tab any more. The equivalent layout is:

| Sheet version | Store version |
|---|---|
| one row per (IR, Section) in `APP_DATA`, upserted by matching two columns | `sections/IR409.json` → `{ "sec-b": {…}, "sec-f": {…} }`, assigned by **key** |
| the `__IRS__` sentinel in column A, one row per IR in column B | `irs.json` → `{ "IR409": {status, assignee, …} }` |
| `AUDIT_LOG`, matched by scanning a column | `audit/IR409.jsonl`, one JSON object per line, **one file per ticket** |
| `APP_DATA_BACKUP_<date>` tab | `backups/<store>-<yyyy-MM-dd-HHmmss>.json`, always a **new file** |
| a row has no name, so its fields are addressed by **position** (`userCol`, `USER_HEADS`, `getRange(i+1, 4)`) | a record has names, so every read-modify-write is a **key** assignment |

Two consequences worth remembering:

- `sections/index.json` maps IR → **file id**, and the read is a direct fetch
  (`getFileById`). `getFilesByName` is a Drive *search* and is eventually
  consistent, so a miss right after a create would produce a second `IR409.json` and
  silently **fork the ticket**. The search survives only as a self-healing fallback.
- Drive has no transactions and no atomic append: every write is a whole-file
  replace. So `withRowLock` covers the **read** as well as the write, and every read
  inside it is `readJsonLocked` — never the memoised `readJson`.

## Demo Mode

When GAS is unreachable (CORS error, network failure), the app falls back to `getDemoIRs()` which returns 5 hardcoded sample records (IR405–IR409). This keeps the UI visible for development/review.