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
- Plays `assets/Indrones Intro v2.mp4` for ~2 seconds
- Neutral dark chrome with the "I-PASSBOOK" wordmark
- Fades out, then checks auth state

### 2. Auth Screen
- Email + password sign-in, then a 6-digit code emailed to the same address. **There
  is no sign-up** — an admin provisions every account and hands over a temporary
  password (see [10 — Auth & Access Model](10 - Auth & Access Model.md)). The code is
  issued once and reused for the rest of the working day.
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
Browser → GET docs.google.com/.../gviz/tq?tqx=out:csv&gid=<Form Responses>
       → parseCSV → mapSheetRows(rows) → setAllIRs()   ← app state merged here
       → No Apps Script deploy required (sheet is link-shared)
       → Falls back to GAS ?action=listIRs, then demo data, on failure
```
> **Note:** The IR list is read directly from the **"Form Responses"** tab by the
> frontend. The GAS `listIRs` action reads the same tab (`IR_REPO_TAB`) and is
> kept as a fallback; it also joins `irs.json` for the app-owned status.

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