# 07 — Known Issues & TODO

> **Status of the Drive-store migration (Sept 2026).** Every byte the app owns now
> lives in JSON files under `_store/` in the owner's Drive
> (the `STORE_ROOT_FOLDER_ID` Script Property, until v13 `CONFIG.DRIVE_ROOT_FOLDER_ID`),
> and the backend touches exactly **two**
> Sheets — both as *inputs*: the client's `Form Responses` tab and the legacy
> workbook. Neither sheet id is in this repository any more either, as of v13. **Both halves are now live (2026-09-19):** the frontend is on `gh-pages`
> at `f101611` (`CACHE_NAME` `ipassbook-v34`) and the matching `backend.gs` is pasted
> into the live Apps Script project in place, so sign-in really does demand the
> emailed code — the owner confirmed it end to end. **The order that got there is the
> rule for next time: frontend first, always**, because new backend + old frontend is
> what locks everybody out. See [08](08 - Development Guide.md) for the deploy, which
> is a New version on the existing deployment plus a `CACHE_NAME` bump.
>
> The new store starts **empty** — there was no app data to migrate, by the owner's
> word. The old "I-Passbook App Repository" spreadsheet is **not read, written or
> required** by anything any more; it is left on Drive untouched as an archive.
> `CONFIG.PASSBOOK_SHEET_ID` and `CONFIG.DATA_TAB` are gone from the code.
>
> The restructure that came with it — nine sections (`sec-a`…`sec-i`) became six
> (**B–G**) plus the pinned **Overview** panel — is also in this same release, and
> `main` had never been deployed before it. So the two cut over **together**, and the
> old nine-section shell is what is live today. That is why the stale-service-worker
> item below still applies.
>
> ⚠️ **Superseded on the count, not the shape (2026-10-13):** the six sections became
> **seven** when Costing split out of Investigation, and the **displayed letters moved
> down one to A–G**. The ids did **not** move — they are permission keys. So the
> paragraph above is history; the tab strip now reads A–G and `sec-cost` is the one new
> id. See [03](03 - Sections Reference.md).
>
> **Status of the Frappe Helpdesk pivot.** Phase 1 (shell + design system) and Phase 2
> **Stages 1 and 2** are committed on `main` and live on `gh-pages` (`74c0298`) —
> app-owned workflow state (`__IRS__`) and the read-only 📋 Report tab. The dashboard
> went in early as the **Insights** page. **Stages 3 and 4 — the section completion
> count and the ageing clock with overdue flags — are built and green (2026-09-18) and
> are live on the frontend**: `gh-pages` publishes from `category-insights`, so the
> `eb522b5` deploy (cache v32) carries them. The **backend** for that branch went in
> with the same pastes, because the whole of `backend.gs` goes over the wall at once
> rather than one branch's share of it — all of it is live as of 2026-09-23, so nothing
> described here is waiting on a deployment. Stages 6–8 (canned responses, knowledge
> base, CSAT) are designed but unstarted; the plan is the source of truth for those.

## Known Issues

### Storage — the failure modes the sheet did not have

These are new, and they are the price of the move. Each is mitigated; none is closed
completely, and the honest mitigation is named rather than implied.

- ⚠️ **Drive has no transactions.** A sheet write was one row — two people saving the
  same ticket upserted two rows and could not clobber each other. A store write is
  **read-whole-file → merge → write-whole-file**, so a merge onto a read taken before
  the other writer's write silently drops one of the two saves. That is why every
  read-merge-write holds the script lock and reads *inside* it with `readJsonLocked`
  (the memoised `readJson` is deliberately unusable there). **The residual cost:** a
  save that cannot get the lock is **refused, not applied** — `{status:'error'}` with
  `LOCK_BUSY_MESSAGE`, worded so it cannot be mistaken for an admin-changes message.
  The frontend already keeps the user's entry as a local draft and shows "⚠ Retry
  Save", so nothing is lost; the user just has to press it.
- ⚠️ **The fixed-name store files are located by a Drive *search* — narrowed, not closed
  (2026-09-22).** `sections/IR*.json`
  are protected — `sections/index.json` maps IR → file id and the read is a direct
  `getFileById`, because a search miss right after a create would write a second
  `IR409.json` and silently fork a ticket. The fixed-name files — `users.json`,
  `sessions.json`, `access.json`, `irs.json`, `config.json`, `kb.json`,
  `comments.json`, `codes.json`, `attempts.json` — have no such index: they are found
  by `getFilesByName`, which is **eventually consistent**.
  A miss on a file that does exist reads as `null`, and the write path creates a
  *second* `users.json` — the store forks, and the accounts in the first copy vanish
  from the app's view. It is bounded in practice (the file is created once by
  `initializeStore()`, the store is small, the search is warm) and `sessions.json`
  refuses to read as "nobody is signed in".
  **What changed:** the id a search returns is now remembered, and a file the backend
  CREATES is remembered the instant it is made, so the window is **one lookup per file
  per cache lifetime rather than one per lookup** — after the first successful
  resolution, every later read and write fetches by id and cannot miss. That is what
  took a Google sign-in from eleven searches to none. **What has not changed:** the
  first resolution is still a search, so a cache eviction (or a deploy, or a store
  nobody has read for six hours) re-opens the window for exactly one lookup — and a
  search that misses at that moment can still fork the file. Closing it properly is
  still the same pattern as sections: one index file holding their ids, which is the
  only form of this that needs no cache at all to be correct.
- ⚠️ **`sections/index.json` is one file that every section save rewrites.** Every
  save, on any ticket, reads and rewrites it. It is serialised by the script lock, so
  it cannot corrupt — it is a *throughput* ceiling, not a correctness hole. Fine at
  twenty users; if it ever bites, the index shards per IR.
- ⚠️ **A store file that cannot be read THROWS — deliberately.** `readJson` returns
  `null` only when the file provably does not exist; an empty or unparseable file
  raises. Do not "fix" this into a fallback: the tempting version answers `{}` for a
  corrupt `users.json`, reads as "no accounts", and the very next `createUser` writes
  that emptiness back plus one account. Twenty accounts, gone. The user-visible
  consequence is the intended one: an error, and nothing changed.
- ⚠️ **Drive revision history is not the rollback path.** It is not durable for
  non-Google-format files, so `restoreAppDataFromBackup()` was deleted rather than
  re-pointed. A destructive admin operation instead writes
  `backups/<label>-<yyyy-MM-dd-HHmmss>.json` — **always a new file**, so it can never
  overwrite an earlier snapshot — and the response names it.

### The safety net — Phase 1 of the plan (built 2026-10-03)

The plan's Phase 1 is a **second copy of the store that exists without anyone
remembering to make it, and whose state can be read from the app**. Four pieces, all
in `backend.gs`; the mechanism is in [04](04 - Backend API Reference.md).

- ✅ **The change journal** — `_store/journal/YYYY-MM-DD.jsonl`, one line per write,
  appended **inside the same lock as the write it describes**. It is an **index, not a
  copy**: who, when, which action, which IR, which section, and the key *names* —
  never the values. That is what lets it be kept for years without becoming a second
  database. Auto-saves are journalled (`auto: true`) but stay out of the audit trail,
  because the audit trail is a record of what *people* changed.
- ✅ **The nightly export** — one dated folder a night in `I-PASSBOOK backups`
  (a sibling of `_store/`, and the one folder in there shared `DOMAIN_WITH_LINK` so
  the owner can open a backup from a phone): `raw/` for restore, `csv/` for
  spreadsheets, a Google Sheet with a tab per record type for reading.
- ✅ **Rotation** — 14 daily, 8 weekly, 12 monthly, and one a year **forever**,
  grandfather-father-son. A folder not named for a date is never touched, and the
  only code that can trash anything is `pruneBackups`, which can only reach the
  backup root. **The rotation is the one place in this app that deletes something**,
  so both suites find every trash site and require it to live inside that one
  function.
- ✅ **Health, visible** — `_store/backup.json` is rewritten at the end of every run
  and read by the admin-only `getBackupHealth`, which paints one line on the User
  Access → Versions tab. **Three states, and unknown is not fine**: a health line that
  renders "fine" when the request failed turns an unknown into a reassurance, so an
  unreadable status wears the failure red and says it knows nothing.
- ⚠️ **A nightly run that fails is loud, but only as loud as one mail.** The run
  records `ok: false` and mails the admin; the health line turns red the next time an
  admin opens that tab. Nothing pushes. That is the deliberate line — the app has no
  notification channel of its own — but it does mean a failure can sit unnoticed over
  a weekend if nobody opens the admin screen.
- ✅ **The restore rehearsal** (`rehearseRestore()`, built 2026-10-03). It rebuilds a
  real store from a real backup folder into `_rehearsal/` — a scratch folder inside
  the backup root, **not named for a date**, so the rotation can never reach it — and
  then reads it back and prints a verdict (`REHEARSAL PASSED` / `REHEARSAL FAILED`).
  It is run by hand from the editor. The property that matters is structural: it
  resolves the backup root and nothing else, so it **cannot** write to `_store/`, and
  a pinned test forbids any helper it is built from naming a live store path. It
  catches an archive that holds less than its manifest says, and one holding a file
  that will not parse. **The finding it was built for:** `sections/index.json` holds
  **Drive file ids**, so an index copied verbatim names ids that no longer exist —
  the rehearsal rebuilds it from the restored files and proves every ticket resolves.
  Mechanism in [04](04 - Backend API Reference.md); procedure in
  [08](08 - Development Guide.md).
- ⚠️ **The nightly backup carries the store, not the uploaded evidence.** `raw/` is
  every file under `_store/` — records, links, hashes, audit and journal. The photos
  and documents a passbook holds live in the per-IR folders (`IR409/Section …/`)
  *beside* `_store/`, so a restore from a backup brings back every record and every
  link but **not the files themselves**. The rehearsal says this out loud in its own
  report rather than leaving it to be discovered. Those files reach the owner's server
  by a different road — `Archive IRs`, which is what `CONFIG.ARCHIVE_FOLDER_NAME` is
  bound to — and Drive's own copy of them is the live one. If that is not enough, the
  export needs a second pass over the per-IR folders, which is real work and a real
  cost increase, and has not been started.
- ⚠️ **The backup folder is `DOMAIN_WITH_LINK`, and a copy of `_store/` is in it.**
  That sharing is deliberate — the owner has to open a backup from a phone and their
  server has to fetch it — but it is worth saying out loud that `raw/users.json`
  (password hashes and salts) and `raw/sessions.json` (live session tokens) therefore
  travel with it, and `_rehearsal/` adds a second copy. The boundary is the domain
  rather than the folder. This does not weaken `_store/` itself, which stays
  `PRIVATE`/`NONE`; it means the backup folder's link is as sensitive as the store.
- ❌ **Yearly archives of out-of-window IRs are not built.** The rotation keeps
  yearly folders forever, but nothing yet moves an old IR's *section data* into a
  yearly bundle of its own, so the live store still grows with every IR ever raised.
  Also Phase 1, also unstarted.

### Security
- ⚠️ **The pre-auth surface is open by necessity.** `ping`, `sessionCheck`, `login`, `changePassword`, `forgotPassword` and `resetPassword` must answer without a session, so the GAS URL being public is not itself the boundary — the **rate limits** are. `login`/`changePassword` share `attempts.json` (5 failures → 15-minute lockout); the two emailed-code paths share one issuer with a **3-codes/hour/email** budget counted across *both* purposes (so a password reset cannot buy extra sign-in codes), a 60-second resend gap, a **per-purpose** global hourly ceiling — **12 reset codes**, **120 sign-in codes**, the looser one justified because a sign-in code is only issued after a correct password — and every mail sits under one daily `MailApp` cap. Weakening any of those re-opens a guessing oracle.
- ⚠️ **A leaked sign-in code is useful for a whole working day.** The code is deliberately **reusable** (`consume=false`) so one mail covers every sign-in that day, which means a code read over someone's shoulder stays live until the shift ends — the same window as the session it mints. What bounds it is the shared attempt counter (5 wrong guesses burn it) and the password that must be presented alongside it. **The mitigation is now in place: every successful sign-in writes a line to `audit/signins.jsonl`** — the account, the time, what the browser claimed to be, and **how old the code was** when it was redeemed. That last field is the signal: a code issued and used within a minute is ordinary, one issued at 9am and redeemed at 4pm is the shape to look for. Read it with `reportRecentSignins(days)` from the editor (there is deliberately no screen for it). The record cannot refuse a sign-in — its write sits in its own `try`, and `smoke-store.mjs` proves a *throwing* audit write still returns a working session.
- ✅ **Data actions require a session** — `listIRs`, `getPassbook`, `saveSection` and every admin action call `requireAuth`, and the caller's email is read **from the token**, never from a request parameter (`saveSection`'s `savedBy` is the verified email, not the posted one), so the identity cannot be spoofed. Since 2026-10-03 the **list read** has no second, unauthenticated path either; the anonymous `gviz` CSV fetch is gone.
- ❌ **File uploads shared with anyone-with-link** — `ANYONE_WITH_LINK` sharing on all uploaded files. Deliberate: the link in a passbook has to keep working for a customer. `_store/` is the counterweight — it is `PRIVATE`/`NONE` and is a **sibling** of the upload folders, so hashes, salts and live session tokens are not readable through the Drive UI. That only holds while `_store/` is not link-shared; `initializeStore()` sets it, and re-sharing the folder by hand would undo it silently.
- ✅ **The IR list is read through the token gate, and the Sheet is restricted (2026-10-03).** It used to be fetched **anonymously** from Google's `gviz` CSV endpoint, with `listIRs` kept as a fallback — so every row of the IR Repository was readable by anyone holding the address, and the address sat in `app.js`, which is any browser that opens the app. Two halves closed it: `listIRs` now returns the tab **as a grid** (`getDisplayValues()` — the header row plus the data rows as displayed), and the frontend's CSV path is **deleted**, not merely deprioritised. The Sheet itself is restricted to the company.
  - **Why the grid is the whole trick.** The old objection to promoting `listIRs` was real and is worth keeping: it returned no `intake`, no `extra`, no `dateRaisedISO` and no split name/phone, unlike `mapSheetRows`, so promoting it would have emptied the 📋 Report tab's raw cells and made Insights treat every IR as undated. Shipping the **grid** instead of finished records sidesteps the reconciliation entirely — the backend no longer needs to know what any column means, and `INTAKE_FIELDS` (matched by header substring) stays the single map. `getDisplayValues()` rather than `getValues()` because the mapper is written against the strings a CSV carries; a `Date` object arrives through JSON in a different shape and would make every date column unparseable.
  - **`listIRs` also carries no status any more.** It used to merge one in from `irs.json` via `getAllIRStatuses()`, giving one question two answers. `__IRS__` is the only owner of the workflow.
  - **Regression guards:** `smoke-backend.mjs` asserts `listIRs` uses `getDisplayValues()` (never `getValues()`), reads no store, and injects no status; `smoke-list-intel.mjs` asserts an empty repository renders as empty rather than falling through to the sample cards.
  - **The app names no sheet any more, and the legacy records came back (2026-10-03).** Phase 0's last two halves. First, the addresses: `IR_REPO_SHEET_ID`, `IR_REPO_TAB` and `LEGACY_SHEET_ID` are **gone from `app.js`**, along with the five demo records that carried the Repository URL as a `summaryLink` — because the frontend no longer reads either file, and an address in a public repo is a standing hazard (change a sharing setting by accident and the data is public instantly, with no deploy and no sign on screen). The backend keeps both addresses; it reads the files as their owner. Second, the **legacy view is rebuilt** from backend data: `listLegacyIRs` returns tab names only (no `embedUrl` — the frame can never load against a restricted file, so the URL was removed rather than left to rot), and a new token-gated `getLegacyIR` returns **one tab at a time** as a displayed grid, which `openLegacyRecord` renders read-only as label/value rows — never a `<table>`, because a legacy tab is wide and a phone answers a table with sideways scrolling. The dead iframe machinery (`openLegacyModal`, `legacyTick`, `_legacyLoaded`) is deleted, not kept dark. **`smoke-list-intel.mjs` now carries the guard the plan asked for**: it fails if a `gviz`/`tqx=out` fetch, a `docs.google.com/spreadsheets/d/…` address, or a sheet id ever returns to `app.js`.
  - ✅ **The rest of the workbook has been seen, and nothing is owed here (2026-10-06).** Only the tabs named like an IR are reachable in the app — `listLegacyIRs` matches `/^IR\s*(\d+)/i` and **skips every other tab without saying so**. The workbook is restricted and reads from this environment 401, so the only way to find out what else was in it was a function the owner runs once, and he has run it: `inventoryLegacyWorkbook()` reported **170 tabs — 161 named like an IR and 9 others**, four of those empty, and only `INDEX`, `S100 TC` (a Root Cause Analysis) and `STRIVER 003` (a two-column parts list) holding data. It also settled a trap worth remembering: **row 1 is a department band, not the field labels**, and the form has two generations (a 50-column one and an older 30-column one). The function stays committed — it is **not an action** (no route, so it adds no API surface and does not move `API_VERSION`), reads the workbook and nothing else, and prints one log line per tab through `report()`. Its companion, `legacyPeekLines()`, is **retired**: it existed only to print the non-IR tabs' rows, and those are now known, so `PEEK_TABS` is `[]` and no customer row is printed again. **Run it again only if a new tab appears while the workbook is restricted.**
- ⚠️ **Sentinel stores are world-readable and world-writable by any signed-in user.** `__`-prefixed irNumbers skip the per-section ACL check, so an **assignee is advisory, not access-controlled** — any signed-in user can reassign any ticket. Consistent with how comments and the team directory already behave, but "assignment" implies authority it does not have. `SENTINEL_SECTIONS` + `assertSentinelWritable()` bound *which* stores exist and what shape their keys take, so a caller can no longer invent a store — or aim a write at one that was never meant to be writable — but writes *within* an allowed store are still open to everyone, by design. (This is also why the department revokes are **not** sentinels — see [10](10 - Auth & Access Model.md). If one ever were, it could be rewritten by the very people it restrains.)
- ⚠️ **Everyone signed in can view every section, including Investigation and the Overview** — customer names, contact emails and root-cause analysis. This is a **deliberate owner decision**, not an oversight: *"Once anyone signin in, provide view access to everyone by default. its not about who."* Edit is what is controlled. If it ever needs re-tightening, the seam survives — `canView` still exists and `getPassbook`'s per-section filter is one line. The Overview is the one row that had to be **explicitly** exempted from that filter, because it is not in `SECTION_KEYS` — see the bug note in [10](10 - Auth & Access Model.md). ⚠️ **`sec-cost` (Costing) starts at *view* for everyone too**, and that is the same universal default — the seed only applies to a fresh `seedDepartments` run, so its edit boxes are ticked by hand. Until then the Costing pane is visibly read-only, not silently empty.
  - **There is now exactly ONE exception, and it is not a level: a customer account** (added 2026-10-07). An account scoped to a company in `access.json`'s `customers` map comes back from `getEffectiveAccess` with **every section `'none'`** and the Overview at `'view'`, so it sees its own company's IRs and nothing else. This does not weaken the decision above for staff — it is about accounts that are not staff at all. The withholding needs **no new filter code**: it rides the existing `canView()` in `getPassbook`. What *is* new is `refuseCustomer(access, what)` on the endpoints with no per-record ACL (`saveSection`, the comment thread, `getAuditLog`, `getLegacyIR`, `listLegacyIRs`) — and **that check is the whole control** on those, because the audit log trusts the caller's token for the repository and the legacy reads take an arbitrary IR number. `API_VERSION` 8 exists because an older backend would answer a customer's token with everything.
  - ✅ **The invite panel offered the wrong column, and it is fixed — 2026-10-08.** The company dropdown in **User Access → Customers** is what an admin picks to scope a customer, and it was built from `ir.customerName` — Col L, **"Who's Reporting?"**, the *person* who raised the fault. The backend scopes rows by `companyName` — Col R, **"Where Do You Work?"** — so the two never agreed. Nothing failed loudly: the account was created, the invitation mailed, and the customer's portal came back **empty**, with nothing on screen saying why. Both columns exist on every real ticket (`splitNamePhone` even splits the phone off Col L), so this was not a missing field, just the wrong one. One identifier in `knownCompanies()`; `tools/smoke-invite.mjs` now pins the column against the backend's own `companyColumnIndex` needles rather than against the Insights facet it happened to share a bug with. The demo records in `getDemoIRs()` carried a company name in `customerName` and no `companyName` at all, which is how the wrong shape got taught in the first place — they now carry both columns, as the form does.
- ✅ **The Insights "Customer" filter is now labelled "Reported by", and a separate Company axis reads Col R — fixed 2026-10-19.** `insightsFacets()` still keys the person list on `ir.customerName` (Col L) because that is what a reporter IS, while the new `Company` filter reads `ir.companyName` (Col R) through the register. The two axes are visible side by side, so the same word no longer means two things, and no chart count changed for existing filters. `smoke-insights.mjs` pins both axes and their labels.
- ✅ **`sessionCheck` no longer puts the token in a URL — fixed 2026-10-09.** It used to be a GET probe (`?action=sessionCheck&sessionToken=…`), and GAS writes the request URL to the Executions panel, so a live token could appear in a log an admin reads. It is now a **POST** with the token in the body (`app.js` → `confirmSessionAlive`), matching every other call. `action` **stays in the query deliberately**: the fetch interceptor recognises an auth call by matching the URL, and a call it does not recognise gets the token appended straight back onto the query string — which would undo the fix. `doPost` has carried `sessionCheck` all along, so no backend change was needed, and `application/x-www-form-urlencoded` is CORS-safelisted, so there is no preflight to be refused.

### Functionality
- ⚠️ **Every ticket starts Open — including old finished ones, until CR allots them.**
  Since 2026-10-03 a ticket's stage is the app's alone: a ticket with no store row reads
  **Open** by derivation, and the Sheet's Col D is no longer a starting value — it is
  carried as `initialStatus` and is now read by **no line of `app.js`**. The sharp edge is
  deliberate and worth saying out loud: a legacy ticket whose Col D said *Close* or
  *Delivered* now reads **Open**, so the board shows a finished aircraft as not started
  until somebody allots it. The alternative was a ticket wearing a stage the desk had
  stopped maintaining, which is the worse lie. **Rows already in the store are left
  exactly as they are** — CR is reviewing and re-allotting every ticket by hand, so they
  are corrected by the people who own them rather than by a migration. `seedIRState()` is
  **deleted, not disabled**, and `smoke-workflow.mjs` renders all four screens that show a
  stage (list card, ticket header, board column, Insights "open now") rather than
  asserting the merged value once — Release B proved those four can disagree.
- ❌ **No offline editing** — PWA caches static assets but can't function without GAS backend
- ❌ **No conflict resolution *for the user*** — the lock stops a lost write at the file level, but if two people edit the same section the second save still wins with no warning and no diff. The store being correct is not the same as the humans being told.
- ❌ **No delete capability** — sections can be updated but never cleared/deleted
- ❌ **No IR creation from app** — new IRs must come from the Google Form → "Form Responses" tab (deliberate; the Form is the client's front door)
- ❌ **No validation** — forms have no required-field checks before save
- ⚠️ **Ageing runs on whichever clock is real, and says which one it used.** Two
  clocks exist and they are not interchangeable: `statusAt`, written by
  `applyTriage` **only on a real status change**, and `dateRaisedISO`, the client's
  own raise date. A card therefore reads **"In status 6d"** when the app recorded the
  change itself and **"Raised 21d ago"** when it did not — because a status the Sheet
  set carries no timestamp anywhere, and this app will not invent one. `ir.dateRaised`
  — the string the card *displays* — is deliberately **not** parseable here for the
  same reason. With neither date (every legacy-only record) there is **no clock at
  all**: no age chip, and no overdue flag, rather than "0d". **The overdue limits are
  `IR_OVERDUE_DAYS` in app.js — Urgent 1 day, High 3, Medium 7, Low 14, and the
  loosest of those for an unprioritised IR**; only a ticket whose status category is
  **open** can be flagged, so a paused or finished one is old, not late. A limit is
  reached on the day itself (`>=`), and it is the one place to change the policy.
- ⚠️ **The completion count is read from `done[]` and can only ever say 0–7.** It walks
  the seven live `SECTION_IDS` and asks whether each was saved, so a store row holding a
  duplicate or a retired `sec-a`/`sec-h`/`sec-i` marker cannot render "8/7" or promise
  a tab nobody can open. A legacy-only record shows no chip *until* something is saved
  against it — "0/7" over a historic record would read as work outstanding. ⚠️ Costing
  counts in that total, and **it can legitimately be closed blank** (a warranty repair)
  — see the blank-close confirmation in [03](03 - Sections Reference.md).
- ⚠️ **The hand-typed activity log is read-only and will stay that way** — it is kept in the Overview as a labelled `Legacy` block so history is not lost, but nothing writes it any more. It is deliberately **not** folded into the generated timeline: it has no per-row timestamp, so merging it would mean inventing when things happened. The app's own record of activity is the timeline.
- ⚠️ **A stale service worker sees the new backend with the old shell for one load.** The deployed build carries the old nine-section shell, so a browser still holding it will request `sec-h`/`sec-i` (refused with a clear "reload the app" error, because `RETIRED_SECTION_IDS` names them) and can post `a_overallStatus` into the `sec-a` row, which nothing reads. Harmless, and the `CACHE_NAME` bump ends it on the next reload — but it is the residual cost of the frontend and backend cutting over together.
- ⚠️ **Three Sheet columns are unmodelled** — the Form writes columns E, J and O, for which no `IR_REPO_*_COL` constant exists. The 📋 Report tab surfaces them under "Other columns from the Sheet" rather than dropping them, and the app records which headers it did not recognise (`lastSheetAudit`). A new Form question is therefore visible, but appears in a catch-all block instead of a modelled field.
- ⚠️ **The live Sheet header row has never been verified directly** — reads from this dev environment return HTTP 401, so the header row is taken from `backend.gs`'s constants plus a test fixture. The mapper is self-auditing and matches by substring, which is why it was built that way; still, confirm against the real Sheet when convenient. This matters **more** now, not less: the Form Responses tab is one of only two Sheets the backend reads.

### UX
- ✅ **Emoji are down to 19 non-comment lines, and only in slots where text is all that can live — 2026-10-09.** The app's *icons* are one inline-SVG set (`ICON_PATHS` / `iconSvg`), and the conversion has since finished everywhere an element can be built: the `⚠️` hints, the `📎`/`📷`/`📄` evidence affordances and the User Access modal's `👥`/`💾`/`📋` are all gone. What survives is emoji inside **strings no element can be built into** — the `✓`/`✘`/`⚠` option labels (`Received` / `Missing` / `Damaged`), the sync status strings, `'✓ Saved!'` / `'⚠ Retry Save'`, and one `alert()`. `smoke-ui.mjs` **tightened its cap to 19** rather than leaving it at 49, so the boundary now has no room in it, and the survivors are classified **by name** in `TEXT_ONLY` rather than waved through by count — a survivor that is none of those things fails the suite instead of being absorbed into a number with space left in it.
- ✅ **A section says it is loading — fixed 2026-10-27 (v123).** `openPassbook` clears the previous ticket's record, paints **Loading saved data…** on every section's own indicator, and then says Saved, Draft restored, or Couldn't load — one honest word instead of empty forms that look like an empty ticket. The read now reports success/failure, and a failed read keeps the drafts on disk and says so. `smoke-sections.mjs` pins all four states and both languages.
- ✅ **A failed save retries with backoff, then stops — fixed 2026-10-27 (v123).** It already retried every 10 s forever; it now doubles the wait to a 60 s ceiling, stops after six attempts with **Not saved — contact the admin**, and a new keystroke resets the budget. The draft is never discarded. `smoke-sections.mjs` pins the constants, the cap, and the reset.
- ✅ **A PDF now has a preview — fixed 2026-10-27 (v123).** A saved PDF frames Drive's `/preview` endpoint (not `/view`, which refuses to frame); a not-yet-uploaded PDF frames its own blob URL. It is a `<details>` fold, so a section with several documents mounts no viewer until asked, and the Open link remains the escape hatch. `smoke-ui.mjs` pins the endpoint, the lazy frame and the bounded height.
- ⚠️ **Checklist UX** — checklist items use dropdown selects instead of more intuitive checkbox UX
- 🔧 **No confirmation dialog — and no Save button left to hang one on.** The Save button is gone from all seven sections, and autosave fires about 1.5 s after you stop typing, so the old *"are you sure?"* step has no moment to attach to any more. What is genuinely missing in its place is **undo**: a save that overwrites a section is not reversible from inside the app. (The one confirmation the app does own is the blank-Costing close — see [03](03 - Sections Reference.md).)
- ✅ **Assignment emails no longer read as comments — fixed 2026-10-27.** The assignment path now sends `kind: 'assignment'`; `sendNudgeEmail` chooses its subject (`you have been assigned`) and opening line from it, and a missing kind still means comment, so an older client is unchanged. The client's toast says *Assignment* on that path too. `smoke-store.mjs` drives both kinds against the real backend and `smoke-ui.mjs` pins the flag on the request. Needs the next backend paste.
- ⚠️ **The sign-in wait is improved, not fixed — and the improvement is unverified in the field.** Apps Script shuts the script down when nobody is using it, and the next caller pays the whole start-up before one line of our code runs: measured against the live deployment on 2026-09-21, `ping` took **31.6s** on the first call, then 3.7s and 1.5s. `warmBackend()` now fires that trivially cheap `ping` as soon as a load is known to be heading for the sign-in screen, so the wake-up overlaps the ~9-second intro and everything the person types. **The mechanism is measured; the outcome is not.** Three pings fired at once measured 9.0s / 9.5s / 10.5s each where a lone one is under four, so a submit that catches the wake-up still in flight may queue behind it — expected to be no worse than the cold start the submit would have paid by itself, but not proven. Nothing may be built on the wake-up: a container that has gone cold again still has to wake, which is why the wait screen's 8-second slow note (`SSO_SLOW_MS`) stays exactly where it is. The Google door is the worst case and is **not** warmed by this — the door and the app are two deployments of the same script, and waking one does not wake the other, so the exchange can still pay a second cold start. **The half that removes the wait rather than overlapping it is `installKeepWarmTrigger()`**, an every-minute trigger calling an empty `keepBackendWarm()` — **installed 2026-09-23**, run once from the editor, so the container is no longer left to go cold. One thing about it is **not verifiable from here**: whether that single trigger also keeps the domain-scoped door warm, since an unauthenticated request to that deployment never reaches our code. The thing to watch is whether the first sign-in of the day is actually shorter. **A third and separate cause was found and fixed on 2026-09-22**, and it was ours, not the platform's: the exchange resolved five store files — `codes.json`, `users.json`, `signins.jsonl`, `sessions.json`, `access.json` — by name, twice each, and a name lookup is a Drive *search* at about **0.37s** measured. That is **eleven searches**, and it was most of the 8-10 seconds reported from the field. `findStoreFile` now asks `CacheService` for the file's id first, so a warm sign-in pays **zero** searches; the expected result is about 5-6 seconds instead of 8-10, and the 8-second note should no longer appear. This half is **not measurable from here either**, but it *is* deployed — it and the trigger both went in with the 2026-09-23 paste, so the 5-6 seconds is now a real prediction to check rather than one held back by an undeployed backend. The real exchange needs the owner's Google identity, and what I could measure is the fallback path and the count of searches, both pinned in `smoke-store.mjs`. What is left is the floor: a ~1.8s platform round trip, three lock acquisitions, and five file reads and writes on top. Those are the next thing to doubt if 5-6 seconds still reads as slow. See [02 — Architecture & Data Flow](02 - Architecture & Data Flow.md).
- ✅ **The ticket dock's worklist survives a reload — fixed 2026-10-27 (v123).** `dockIRs` is stored under `ipb_dock_irs` and restored ONCE per page, after the IR rows exist, keeping only tickets still in the loaded list and dropping duplicates. The open sheet is deliberately not restored — the strip is the convenience, a window popping up is not. Sign-out clears the key and the memory. `smoke-ui.mjs` drives the restore, the dead-id filter and the empty-first-paint case. Still not built, and not asked for: dragging the window larger or smaller, snapping it, reordering the tabs, and more than one window open at a time.
- ⚠️ **The window's Allot CAPS form is the same form, not a shorter one, and that is deliberate.** He asked the small tab to show *"Allot CAPS options and Report details to give IR's overview"*; it now shows the dialog's whole Allot CAPS block plus the client's whole 📋 Report, drawn by the same two builders. That makes the window's contents **longer** than v91's activity list, so a ticket opened on a phone needs scrolling to reach the Report. The alternative — a subset built for the window — is a second form kept in step with the first by nothing, which is the failure `smoke-board.mjs` guards. If he finds it too long, the shape to reach for is a fold **inside** the window, not a second builder.
- 🔧 **A reload puts the Service Desk back on the Grid, and that is deliberate too.** Since 2026-10-13 the arrival mode is the Grid whatever `VIEW_KEY` holds — see [06](06 - UI Components & Styling.md), *The three drawings*. Choosing List still works and still sticks for as long as the page is open; it just does not outlive a reload. This is the behaviour the owner asked for twice, and the one token to put back if he ever wants a remembered default is `setListView(listMode)` in `showApp()`.
- ⚠️ **The Grid's own blank area has no faded mark, and that is a choice, not an oversight.** He asked for a big faded logo *"in blank space"* when no Service Desk is open and chose the `#detail-placeholder` panel — the *"No IR selected"* blank. Grid takes the workspace on desktop (`html.view-full`) and that rule hides that panel, so in Grid there is a large empty area below the tiles where a watermark would also look right. It is a separate small change, on his ask. (The area is narrower since 2026-10-13 — the rule no longer hides the **sidebar**, so the grid pane is the viewport less the Service Desk bar, and now carries a `"No more IRs — N shown"` footer. See [06](06 - UI Components & Styling.md).)

### Technical Debt
- ✅ **The line-ending trap is closed — 2026-10-27.** `.gitattributes` now carries `* text=auto eol=lf`, so a fresh clone on Windows checks the files out as LF regardless of `core.autocrlf`. The existing blobs were already LF, so this is a one-file change and no renormalise commit was needed. The lesson stands and is why the file exists: a suite that reads source text is coupled to the checkout, not to the code.
- 🔧 **Large single-file frontend** — all logic in one `app.js` (~5,350 lines and growing); the CSS is split into four layered files (see [09](09 - Design System.md))
- 🔧 **No build pipeline** — no minification, no bundling, no tree-shaking
- 🔧 **No type safety** — vanilla JS, no TypeScript or JSDoc
- 🔧 **One-working-day sessions** — `localStorage`, **8h30m absolute** from sign-in, never slid forward on use, and no idle timeout inside that window. Deliberate: the daily sign-in is what the emailed code protects, and a session that slides forward on every request never expires for exactly the people who use the app most. It replaced a 30-day sliding session (see the security items above).
- 🔧 **One admin** — a bus factor of one. Adding another is a one-line `ADMIN_EMAILS` edit plus a GAS redeploy.
- 🔧 **The 90-second nudge poll is ~40 authenticated GETs/hour/user.** In the sheet version each one scanned the `SESSIONS`, `APP_DATA` and `__NUDGES__` tabs; now it is one memoised `sessions.json` read plus one `comments.json` read, which is strictly cheaper. `lookupSession` is a **pure read** — the absolute expiry removed the throttled slide write this path used to do — so the poll now adds no session writes at all, not merely few. The polling itself is a pre-existing concern and is not fixed here.
- 🔧 **`ACL` and `ACCESS_REQUESTS` tabs are frozen, not deleted.** Nothing has read them since 2026-09-17, when the store moved to Drive JSON. They are the only record of the old hand-assigned grants, so they wait 30 days — deletable from 2026-10-17 (see "Waiting on the owner").
- 🔧 **The audit has no automatic pruning, cap, rotation or delete path** — `_store/audit/` holds one append-only `.jsonl` file per subject: `IR409.jsonl` per ticket, plus `CONFIG.jsonl` / `NUDGES.jsonl` / `KB.jsonl` for the sentinel stores, whose writes belong to no ticket. There should not be an automatic bound: the audit trail is evidence. The lever is manual and locked — `maintenancePruneAuditLog()` (retains `AUDIT_RETENTION_DAYS`, default 400). The 400-entry cap in `getAuditLog` bounds the *response*.
  - The prune is **per-subject**, so it can delete history for a ticket that is still open. That is the sheet version's behaviour too — not a regression — and the audit cannot currently tell whether a ticket is closed, so a smarter rule is not available yet.
  - ✅ `getAuditLog`'s `truncated` flag was **off by one** and is fixed (2026-10-27): it compared the sliced length to the cap, so exactly `cap` entries claimed something had been hidden. It now asks `entries.length > cap` BEFORE slicing. `smoke-store.mjs` pins both boundaries.
- 🔧 **`maintenancePruneAuditLog` reads and rewrites every audit file** it finds, under one lock. Each file is small (~40 KB for a busy ticket), so the whole sweep is bounded, but it is the one editor-run function whose cost grows with the number of tickets. Run it deliberately, not on a schedule nobody watches.
- 🔧 **Drive folder names no longer match the section letters.** A merged section keeps the folder of its **first-listed source**, so `sec-f` writes to `'Section F - Quality Control'` (which therefore also holds Flight Test uploads) and `sec-g` to `'Section H - PDI'` (also Dispatch). `'Section G - Flight Test'` and `'Section I - Logistics Dispatch'` are historical — browsable, never written again. Renaming them is a Drive-wide mutation needing its own editor function; deliberately left as an optional later step rather than bundled into a cutover.
- 🔧 **Merged sections hold two field-id prefixes** — `sec-f` declares `f_*` **and** `g_*`, `sec-g` declares `h_*` **and** `i_*`. This is not laziness: field ids are comment anchors (`n.fieldId` inside every comments item) *and* the `Field ID` of every historical audit row, so renaming `g_basicReport` → `f_basicReport` would orphan every anchored comment on it and split its audit history across two names. It is survivable only because field ids resolve through `FIELD_SECTION_INDEX`, built from `SECTIONS` itself — resolving by prefix, as the code used to, sends `g_basicReport` to a section that no longer exists.
- ✅ **A dry-run-first move for Costing's legacy `sec-d` values — built 2026-10-27.** `migrateCostingFields()` is editor-run (not routed), and with no argument it only **plans**: it reads every indexed ticket, lists what would move, and writes nothing. `migrateCostingFields(true)` applies it per ticket under the normal lock, moves the three `d_*` values to `sec-cost`, writes `added`/`removed` audit lines and a journal entry, and removes an emptied `sec-d`. A field held at BOTH homes with **different** values is reported as a conflict and left untouched. Re-running is safe. `smoke-store.mjs` drives the dry run, apply, conflict and idempotence; `smoke-backend.mjs` pins that it is not a route or a trigger. **This still needs the next backend paste.** The old carry-forward remains in place, so an un-migrated ticket is still read correctly until an operator applies the plan.
- 🔧 **"Costing first" is a gate on the app's own offer, not a rule the server enforces.**
  A ticket may not reach E · Production until D · Costing is closed — but the Board still
  shows **no Costing column**, because no workflow status means "Costing" and a D column
  would sit permanently empty and read as broken. A column means a new status, which
  drags in `IR_STATUS_VALUES`, the Triage dropdown, `canonicalStage` and the overdue
  clocks: a larger, separate change. **Triage remains the deliberate override** — a CR
  can still move a ticket by hand, which is what keeps a real situation from stranding a
  ticket. When the gate withholds the offer it **names the reason**; a withheld control
  with no explanation reads as a bug.
- 🔧 **One section id is genuinely new, so this release owes a backend paste.** `sec-cost`
  is the first section id since the restructure that is not a reletter — `sec-a` is the
  Overview and `sec-h`/`sec-i` are retired. Until the three `backend.gs` lines
  (`SECTION_KEYS`, `SEED_GRANTS`, `API_VERSION`) are pasted into **both** `/exec`
  deployments as a New version, the Costing pane renders read-only with a plain notice
  rather than offering a Save that can only answer `Forbidden`. ⚠️ That notice is the
  point: an **admin** skips the ACL entirely, so on an un-pasted backend the owner sees
  it work perfectly while everyone else gets an empty pane — the same shape as the blank
  Overview that once looked fine to the only person looking. And permissions do not
  migrate with the id: `sec-cost` starts at **view** for everyone, so its boxes are
  ticked once by hand in User Access → Departments.
- ✅ **The backend caught up with the frontend — 2026-09-19.** The owner pasted
  `backend.gs` into the Apps Script project as a **New version** on the existing
  deployment, so the `/exec` URL is unchanged. Proven behaviourally, not from the
  deploy output: signing out and back in now demands the emailed code, which only the
  new backend issues. `__CONFIG__/theme` writes and the archive trigger are live with
  it. The order that got there — **frontend first, always** — is the rule for the next
  backend change too: a new backend meeting an old frontend locks everyone out, because
  a password login returns `otpRequired` *instead of* a token and the old frontend has
  no box to type the code into. See [08](08 - Development Guide.md).
- ✅ **The two evidence buttons were silently dead on a view-only section — FIXED
  2026-09-19.** Reported from the field: a user on a laptop, in **both Chrome and
  Edge**, saw "+ Add image / PDF" and "📷 Capture photo" render normally and
  highlight on hover, and clicking either did **nothing at all** — no error, no
  dialog, no message — while the same account worked on a phone and the admin never
  saw it at all. It was not the browser, the device, or the account's session: the
  user had **view-only** access to that section. `applySectionAccessGating` disables
  the Save button and every field on a view-only screen, and `btn-add-evidence` sits
  in the same sweep — but it shared the **comment** button's exemption, and comment
  comes *with* view, so that exemption is satisfied for every user who can see the
  section. The buttons therefore stayed live while the hidden file inputs they click
  (`-picker`, `-capture`) were disabled a few lines above, and a disabled control has
  no activation behaviour — so `input.click()` opened nothing, silently. An admin
  never reproduces it because admins skip the sweep entirely. The buttons are now
  gated on **edit**, like Save, and carry the same "You have view-only access to this
  section" tooltip. `smoke-access.mjs` reproduces it: the new assertions fail against
  the old code with the exact state that caused the silence (`{add: false, save:
  true}` — Save disabled, the evidence buttons live).
- ✅ **File uploads silently vanished on some Android phones — FIXED and DEPLOYED
  2026-09-19.** The owner reported the camera and file picker "not working" for one user
  across two phones. The cause was not the app's UI: Android's document picker (and
  several camera apps) hand Chrome a file it cannot type, so `File.type` arrives as `''`
  even for a plain JPEG. The client passed that straight through as `mimeType`, and the
  upload loop began `if (!file.base64 || !file.name || !file.mimeType) return;` — so the
  file was **dropped with no error while the save still reported success**. The thumbnail
  appeared before saving and was gone after a reload, which is exactly what "uploads don't
  work" looks like with nothing in the log. Fixed on both sides: the MIME type is now
  derived from the **filename extension first** (`resolveMime`/`mimeFromName`, mirrored in
  `app.js`), because a recognised extension must beat a useless declared type — a Drive
  file stored as `application/octet-stream` is one that will not preview. A file with no
  name or no contents now **throws** instead of being skipped, so the failure is loud and
  the draft is kept. `smoke-store.mjs` reproduces the phone case behaviourally (the old
  code fails it), and `smoke-backend.mjs` pins the shape.

## Tests

`node tools/smoke-all.mjs` — **4693 cases across 37 suites**, all passing.
(The figure in the heading is MEASURED by summing the run, never carried forward: it
said "2273 across 16 suites" long after both numbers had stopped being true, which is
the same drift the emoji ledger below had to be corrected for. It also said 4273
until 2026-10-27, when the same summation found 4649 before v122's 9 new cases — the
lesson had to be applied to itself.)
(2246 before the store's remembered file ids landed — the 27 new ones are 22 in
`smoke-store.mjs`, which counts the Drive searches a real Google exchange performs
(11 before, 0 warm, 4 with the cache emptied) and pins that a bad id, a missing file
and a `CacheService` that throws all fall back to the search, and 5 in
`smoke-backend.mjs`, which pin the shape a behavioural suite cannot see: that
`CacheService` is reached only from the three guarded helpers, that the expiration is
the platform's maximum rather than a longer value the guard would silently swallow,
and that the audit rides the same remembered id instead of its own name search;
2239 before the keep-warm trigger landed — its 7 are all in `smoke-backend.mjs` and
pin the shape a behavioural suite cannot see: that `keepBackendWarm()` is empty of
work, that one timer is installed rather than five, and that uninstalling it can only
ever delete a trigger matched by handler name, so it cannot take the nightly archive
sweep with it; 2213 before the backend wake-up landed — 23 of the 26 new ones are in `smoke-ui.mjs`,
which runs `warmBackend` against a recording transport and pins where it is fired from,
and 3 are in `smoke-boot.mjs`'s intro phase, where a real Chrome proves the ping leaves
the page during the intro; 2203 before the IR list row was rebuilt around state-only chips and a hover line; 2199 before the wait screen's mark was corrected; 2184 before the Google account picker; 2165 before the Google wait screen; 1954 before the field-report build; 1762 before the field-history/restore build;
1605 across 15 when the Drive-store migration shipped; `smoke-list-intel.mjs` and its
69 cases arrived with Stages 3–4;
the 15 for the silent-upload fix arrive with `smoke-store.mjs`'s first *behavioural*
reproduction of a user-reported bug — it calls `saveSection` with a file whose MIME
type is empty, which is what an Android picker really does — and the 5 that pin the
mark decode the PNG and count its pixels, because the checks that were there before
passed on the broken file. The 33 that arrived with the sign-in audit are the same
kind of thing: 15 in `smoke-store.mjs` drive the real two-step login and read the
real `audit/signins.jsonl` back — including that a *throwing* audit write still
yields a working session — while the rest pin the request that carries the device
label and the shape of the record. The **148** added by the field-report build are
mostly of that kind too — the load-bearing ones are **behavioural**, not textual —
and 12 in `smoke-list-intel.mjs` seed the IR-list cache *through the app* and read it
back with no network at all, including that a total outage keeps the real records and
the demo flag `false`, because showing five fabricated sample IRs to someone with four
hundred real ones is misinformation they could act on. The rest pin the other eleven
reports.)

**The Google door was rebuilt TWICE, and the second rebuild is the more instructive
one.** It shipped first as a silent probe plus a background sign-in `fetch`; that
design could never have worked, and the failure was **measured** rather than guessed —
a cross-site request from gh-pages to the domain-scoped deployment comes back `401`
**from Google, before any of our code runs**. The same URL opened as a top-level
**navigation** reports the caller perfectly. So the door became two halves: a click
that *leaves the page*, and a one-time handoff code that comes back in the URL
fragment. That version reached the owner's browser and showed him **the source of the
redirect page** — the Workspace identity had been read and a real code minted; the page
simply never ran.

Two silent failures, both in the return leg. `ContentService.MimeType` has **no `HTML`
member**, so `setMimeType(ContentService.MimeType.HTML)` passed `undefined` and the
response went out as plain text — and the suite was **green**, because
`smoke-store.mjs`'s fake `ContentService` had invented that member, so the mock
disagreed with the platform while agreeing with the code. And since the September 2021
IFRAME sandbox change an Apps Script page may not navigate the top-level window without
a user gesture, so even with the right mime the scripted `location.replace()` would have
moved only Google's frame. The door now returns an `HtmlService` page with one
`<a target="_top">` link the user taps — Google's own documented remedy — so sign-in
costs one tap more than planned and works.

Three lessons are pinned so they cannot un-happen. `ContentService.MimeType` in the
fake platform no longer has `HTML` (the real constant belongs to DriveApp's `MimeType`
enum, the other one — and the two are deliberately split in the stub the same way).
`smoke-backend.mjs` asserts on the **source** that nothing ever asks
`ContentService.MimeType.HTML`, because a mock can always be made to agree with a bug.
And the shape of the page is pinned from four sides — it comes from `HtmlService`, every
link wears `target="_top"`, there is no `<script>` and no `location.` assignment, and
the identity and the refusal are both escaped on the way in.

35 assertions in `smoke-backend.mjs` pin the shape the behaviour cannot show — which
identity call is used, that `redeemHandoff` **checks** `used` rather than only setting
it (a replay hole the first version had), that the link target is built server-side and
reads no request parameter, and that the two halves share one mint so a fix cannot land
on only one of them. 36 in `smoke-ui.mjs` drive the behaviour: the click navigates and
reaches the network zero times, an empty `SSO_URL` makes it do nothing at all, a
`#sso=` return exchanges the code on the **primary** backend carrying no stale token,
a `#ssoerr=` return shows the door's own words with nothing exchanged, the spent
fragment is wiped with `replaceState` rather than by assigning the hash, and the
pre-paint splash skip in `index.html` covers the refusal branch too — not just the
code branch, which would otherwise cost a refused sign-in nine seconds of intro.

One failure was **retired, not fixed**, worth knowing about because it will come
back if someone re-pins it: `smoke-list-intel.mjs` asserted the card said
`Raised 2d ago` for a fixture whose raise date is fixed text while `renderIRList`
ages it against the real clock. It passed on 18 Sep 2026 and failed on the 19th. The
word *card* now asserts the wording and the basis, and the arithmetic stays pinned
by the `irAge` assertions above it, which pass an explicit `NOW` and cannot rot.

**A suite that fails inside `smoke-all` but passes on its own is Chrome contention,
not a regression** — re-run just that suite before believing it. `smoke-boot.mjs`
launches real browsers, and twice a full run has produced an empty first paint
(no icon slots, 33 failures) or a lost `localStorage` flag. The second one is
understood, and the cause has since been removed: Chrome writes the profile
asynchronously, so a load that killed the process the instant the probe arrived could
lose the intro's "already seen" flag — and that flag no longer exists, because the
intro now writes nothing at all. The ~1.5s wait after the probe is kept anyway.
The first one is not diagnosed, only observed — re-run and it is gone.

Suites are discovered by `readdirSync` — a new `tools/smoke-*.mjs` is picked up with
no registration step.

| Suite | What it proves |
|---|---|
| `smoke-store.mjs` | **Executes production code.** Loads the whole of `backend.gs` into a `vm` under a fake Drive platform and calls the real functions. A second save on one IR **merges** (the first section survives); a `__IRS__` patch writes **one key** of `irs.json` and leaves every other ticket intact; saving `iqc-config` leaves `team-directory` and `inward-options` intact; comments round-trip as `sections['all'].items`; `readJson` **throws** on an unreadable or non-JSON file and answers `null` only for a file that is genuinely absent — never `[]`, never `{}`; the audit line lands **after** the data write and in the ticket's own file; a save that cannot get the lock is **refused** rather than merged onto a stale read; a name lookup that misses does **not** fork the ticket into a second file — the write goes to the file `sections/index.json` names; `initializeStore()` really creates `_store/` with its three subfolders; and the store folder is shared `PRIVATE`. It also drives **both emailed-code paths for real**: a sign-in code is reused rather than re-issued, it expires on its own clock, five wrong guesses burn it, a reset code and a sign-in code cannot redeem each other in either direction, both global hourly ceilings refuse rather than throw, and the OTP step sits **after** the disabled-account and temp-password gates. It is the only suite that runs any of those paths at all |
| `smoke-backend.mjs` | Regex over `backend.gs`, retargeted from Sheets to the store: deleted sheet machinery really gone (`getRange`, `appendRow`, every `getOrCreate*Tab`, the merge planner, the importer, the column constants); **every remaining `SpreadsheetApp.` call site walks to its enclosing function and must be one of the read-only inputs**, and the store functions contain no positional layout at all; the one-key write rule; `readJson`'s throw-don't-fallback contract; `getStoreFolder` never creating; the index and the anti-fork rule; per-IR audit, audit-last, and no early return that can skip one; the forced password change (no token before any mint, TTL on **both** doors); the mail cap on every send site; the sentinel allowlist; the lock's release-in-`finally` and refuse-rather-than-proceed wording; every locked write path named in the LOCKED list; and the editor run order printed where the editor will actually see it |
| `smoke-shell.mjs` | Every id `app.js` reads at parse time exists in `index.html`; the **7 tabs and 7 panes** (📋 Report + six lettered); that the retired `sec-a`/`sec-h`/`sec-i` have **neither** a tab nor a pane, and that the Overview carries neither `class="section-content"` nor a `sec-` id; the plain end-of-body `<script>` contract; cascade order; token-only intake CSS; and that the **irreversible purge is two-step in the UI too** (review → copy → delete), not just in the endpoint behind it |
| `smoke-ir-state.mjs` | `__IRS__` ownership, precedence and merge — including that a **retired** section id is filtered out of `ir.done` |
| `smoke-list-intel.mjs` | **The two list stages that turn an absence into a number, which is exactly how they fail.** Stage 3: the completion count reads `done[]` against the seven live ids, so a duplicate, an unknown id or a retired `sec-a` marker cannot push it past 7 or promise a tab nobody can open, a junk `done[]` counts 0 rather than `NaN`, and the fill arrives as a `p0`–`p7` **class**, never an inline style (the card's attribute set is pinned by `smoke-intake.mjs`). Stage 4: the clock is `statusAt` when the app recorded the change and the client's `dateRaisedISO` otherwise, **and the label says which** ("In status 6d" vs "Raised 21d ago"); the display-only `dateRaised` string and a JS `Date` string are both refused; a future timestamp reads 0 days, not negative; and with neither date there is **no clock at all** — no age chip and no overdue flag. Overdue is by priority (Urgent 1 / High 3 / Medium 7 / Low 14, the loosest for an unprioritised IR, matched case-insensitively, reached on the day itself), and **only an `open` ticket can be flagged** — a paused or delivered one is old, not late. Then the rendered card and header are asserted from real output: both carry the same count and age, exactly one `badge-danger` between a late and a fresh ticket, the tooltip names that ticket's own limit, a hostile priority cannot add an attribute through the tooltip path — and a legacy-only IR keeps its app-owned category, status, saved sections and clock instead of rendering as untouched |
| `smoke-intake.mjs` | The Sheet column map, the audit, degenerate/reordered input, and escaping — including **the ticket-list card rendered from two untrusted sources** (the public customer Form's serial field, and `__IRS__` status/priority, which any signed-in user can write). Asserts on real rendered output: no injected attribute, no attribute beyond the fixed set the renderer writes, and a `javascript:` link produces no anchor at all |
| `smoke-sections.mjs` | The six-section contract; every field id in every **merged** section resolves to its section id — `g_basicReport → sec-f`, `h_dispatchChecklist → sec-g`, `i_courier → sec-g`, the cases that fail without `FIELD_SECTION_INDEX`; the prefix fallback still works for an id in no form; the Overview's structural isolation; and that `saveDraft('sec-a')` writes nothing |
| `smoke-timeline.mjs` | Drives the **pure** `buildTimeline` in the `vm` harness — behaviour, not shape. Each event kind maps correctly; `done` deltas are suppressed; an `uploaded` row carries the file name with the **source** field id; comments merge in and other IRs are excluded; a `'dd-MMM-yyyy HH:mm:ss'` fixture parses (the `Date.parse` → `NaN` trap); mixed timestamps sort with the tiebreak; `limit` trims from the newest end; and no entry ever interpolates the literal `undefined` |
| `smoke-access.mjs` | View + comment for everyone, edit only from departments, admin bypass, the fallback **failing closed on writes**, and that the de-admined `customer.relations@` address is gone from `app.js` entirely. Also that `canTriage()` is a **separate axis**: a `sec-c` edit grant does not confer it, a CR user has `triage: true` with `canEditSection` false for all six, and `myAccess().triage === false` on the fallback |
| `smoke-session.mjs` | The token is in `localStorage` and survives a `sessionStorage` wipe; `clearLocalAuth` is the one teardown path and stops the poll; **the poll restarts after an in-page re-login**; the dead `forceReauth()` stays deleted; and **`confirmSessionAlive()` resolves true when fetch rejects** |
| `smoke-boot.mjs` | **Real headless Chrome**: the app boots via `?dev=1`, the Overview renders its facts/legacy log, the activity panel renders **below** the sections and **collapsed**, **every icon slot in the rendered page is filled**, and the full CSV → map → render chain reaches the DOM; a phase loads the **signed-out** login screen with the sign-up machinery absent from the DOM; and a final phase drives the sign-in **form** against a scripted backend — the reveal toggle masks, unmasks and re-masks the field with a real glyph and a switching label, step 1 shows the code step and stores **no** token, the code-step note names the address, a wrong code is refused with the attempt count and the right one signs in. It is also the only suite that would catch a `TypeError` from a shadowed function name — `renderBannerMeta`'s local `canTriage` had to be renamed `showTriage` for exactly that reason. Skips cleanly if no Chrome is installed |
| `smoke-ui.mjs` | **The digital-signature feature is gone, everywhere** — no `esignature` field survives in any section, no `signESignature`/`renderESignatureHTML`/`refreshESignature`/`signSectionOnSave`/`esignatureState` exists in the source, nothing renders `signedBy`/`signedAt`, the `.esignature-*` CSS is gone with it, and `saveSection` no longer stamps. Then, as behaviour: the activity panel's placement, collapsed default, class-not-inline `display` fold and honest `N of M` count; the sidebar folding to an icon rail and the IR list never folding into an empty screen; the Insights pane being a third sibling rather than a panel inside the detail; the dashboard painting a skeleton rather than a page of zeroes; **`indexView` can never be hidden while the user is on the index** (asserted on a **desktop** viewport, since the phone layout hides it legitimately); the comments icon being a real icon; the emoji ledger holding at 45; and that **every icon name the source references exists in `ICON_PATHS`** — in both directions, so a dead entry fails too |
| `smoke-export.mjs` | **The per-section PDF export, and the image fields it carries.** `pdfSafe`, `fitLongEdge` (the 1600px / 82% rule, as arithmetic), `wrapText` and `exportFileName`/`sanitizeFileName` are driven directly, since none of them needs a browser. `sectionPdfModel` is checked against the real `SECTIONS` metadata for the inward and IQC sections (`sec-b` / `sec-c`) — including the new `b_inwardPhotos` / `c_iqcPhotos` fields, the deleted `c_evidenceLink`, every table shape (`inwardTable`, `iqcTable`, `costTable`, `dispatchChecklist`), an all-empty section, an unknown section id, and that `g_basicReport` is modelled while the retired `g_missionReport` appears nowhere. `mergeFlightReportEntries` / `savedEvidenceEntries` prove the flight-test merge is **idempotent** and that two unmatchable entries are both kept. The buttons are asserted as seven `download-sec-*` and seven `share-sec-*` inside `.sec-export-row`, that `#download-sec-d` is gone, and that the gating exempts exactly `sec-export-btn` so a view-only user can still export. Finally `drawSectionPdf` runs against **the real vendored pdf-lib, evaluated inside the sandbox** (see the harness note below): a filled Section A is one A4 page, a two-page attached PDF makes three, an unreadable attachment degrades to the report alone, a long section spills to a second page, and a Remarks box full of emoji exports instead of throwing. It also pins the packaging side — the vendor file is the UMD build, `index.html` loads it before `app.js`, `sw.js` caches it, and `deploy-ghpages.mjs`'s explicit `SERVED` list carries it |

There is no build step and no test framework — suites are plain node scripts.
`smoke-boot.mjs` stubs `window.fetch` rather than reaching the network, so the
`CONFIG.GAS_URL` change cannot break it.

`tools/harness.mjs` evaluates `app.js` in a `node:vm` context, and that context now
**owns its own intrinsics** — the host's `Array`/`Object`/`String`/`Number`/`Date`/
`Math`/`JSON`/`Promise`/`Set`/`Map`/`RegExp`/`Error`/`Intl` are deliberately *not*
handed in, only the genuinely non-V8 globals a bare context lacks (`console`,
timers, `URLSearchParams`, `AbortController`, `alert`). Handing the host's in would
shadow the realm's: every `[a, b]` literal in `app.js` would be an array of the
sandbox's realm while the name `Array` resolved to the host's, so `x instanceof
Array` would be false for the app's own array. `smoke-store.mjs` already loaded
`backend.gs` this way for this exact reason, and `smoke-export.mjs` made it matter:
the vendored `pdf-lib` recognises a page size through just such a check and rejects
the app's own `[w, h]` with *"page must be of type ... or Array, but was actually of
type NaN"*.

The same suite is why `loadApp` gained `opts.preload` — source evaluated **inside**
the sandbox before `app.js`. That is not the same thing as `opts.globals`, which
builds a library in the harness's own realm; preloading gives the app a `pdf-lib`
built from the sandbox's intrinsics, which is what a browser has. It is used for
nothing else.

### What a regex suite cannot see, and what closed the gap

`smoke-backend.mjs` reads `backend.gs` as **text**, and `node --check` only proves it
parses. Neither can tell behaviour from shape, and the cost of that was concrete:
**three defects shipped through 444 passing regex cases**, one of them under a heading
that claimed the opposite.

- `changePassword` had **no temp-password expiry check** (it lived only in
  `doLoginPassword`), so an expired temp password could be posted straight to it and
  mint a full session (30 days at the time; 8h30m since the session became absolute).
  The TTL was decorative.
- `resetPassword` wrote a literal `'active'` into `Status`, so resetting the password
  of a deliberately disabled account **re-enabled it**.
- `sendNudgeEmail` called `MailApp.sendEmail` directly, bypassing the daily cap —
  while the suite asserted, under the heading *"the mail cap is global, not per-flow"*,
  that it covered comment notifications. The assertion was false, and the heading is
  what made it look verified.

The lesson, which is why `smoke-store.mjs` exists: **a regex asserts that code is
shaped a certain way, never that it behaves that way.** The storage move is exactly the
change that lesson applies to, because it converts an atomic one-row write into a
whole-file read-merge-write — the failure mode is a *silently dropped save*, which is
invisible to any amount of grepping. So the suite that mocks the platform and runs the
real functions was kept, retargeted from a fake `SpreadsheetApp` to a fake `DriveApp`,
and it found two defects on its first honest run:

- **`sec-g` was in `RETIRED_SECTION_IDS`**, derived from a merge map that listed
  `sec-g: sec-f` — so the **live** Section G, which the frontend renders with a Save
  button, had every save refused with *"was merged into another section"*. The map had
  no other consumer once the sheet merge was deleted; it is now a literal, with a
  comment saying `sec-g` must never be added.
- **`writeIR` resolved the ticket's file by name search**, so a search miss would have
  written a second `IR409.json` and forked the ticket across two files. It now goes
  through `sections/index.json` and **refuses** to write without a file id.

The same lesson repeated in the UI pass, and the shape of it is worth keeping: the icon
map's keys were renamed (`IR`, `comment`) while the call sites were not, so **five icon
slots rendered `''`** — the IR nav glyph, the detail placeholder, and all three comments
buttons. Nothing threw. `iconSvg` answers an unknown name with `''` by design, which is
correct and completely silent. A suite that asserted *"the icons are SVGs"* would have
passed; the suite that catches it asserts *"every name the source asks for exists in the
map"*, in both directions, and `smoke-boot.mjs` then checks it in a real browser where a
missing icon is a blank button rather than a red test. **When a lookup can fail
silently, the test has to be about the lookup, not the output.**

**Named cutover checks rather than test cases**, because they need the real Drive, a
real session, or a non-admin account, and asserting them as the admin would have proved
nothing:

- Sign in as a CR account and a Production account and confirm the Overview renders
  and the right tabs are gated. (The `sec-a` row surviving `getPassbook` for a
  *non-admin* is untestable here, and it is exactly the bug that would have shipped.)
- The first save → reload on the new store, to confirm the round trip against real
  Drive rather than a fake.

**Still not automatable here:** rendering both themes at 360/768/1024/1440; whether
Apps Script genuinely *acquires* the lock at runtime; whether `getFilesByName` is ever
actually stale in the wild (the spike is the only way to know); Drive revision retention;
and a live end-to-end sign-in. See the verification list in
[08](08 - Development Guide.md).

## Planned / Nice-to-Have Features

- [x] Dashboard with IR stats — *built as the **Insights** page (`#/insights`): counts
      by category, FY/month/status/customer/drone filters, a REPAIR sub-category
      breakout and a status mix. Deliberately counts and filters only — no charts, no
      ageing buckets (`statusAt` only exists for in-app-triaged IRs, since the app
      refuses to invent a timestamp for a Sheet-set status).*
- [x] Section completion progress indicator on Master Index cards — *Stage 3; built
      2026-09-18. A `3/6` chip with a small bar, reading `done[]` against the six live
      section ids, on the card and in the IR header. Filled sections turn green at
      `6/6`.*
- [x] Ticket ageing / time-in-status / overdue flags — *Stage 4; built 2026-09-18. The
      clock is `statusAt` when the app recorded the status change and the raise date
      otherwise, and the label says which ("In status 6d" / "Raised 21d ago"); nothing
      is shown when there is no real timestamp. Overdue is by priority — see the
      limits note under Functionality.*
- [ ] Canned responses — *Stage 6*
- [ ] Knowledge base — *Stage 7*
- [ ] CSAT score — *Stage 8*

> **On the stage numbering.** There is no Stage 5 anywhere in this repo — the
> checklist goes 4, 6, 7, 8. The stage plan itself is **not a file in this
> repository**, which is why the pivot section above can only say "the plan is the
> source of truth": a session reading only these docs cannot check the plan's own
> wording. If the plan is worth keeping, it belongs in `docs/` where the rest of
> the reasoning lives.

### Waiting on the owner, not on code

Everything else on this page is a dev task. These are the ones that need a human with
the Google account. **Item 1 is done as of 2026-09-19** — both halves are live, so what
is left is small.

1. ✅ **DONE 2026-09-19 — `backend.gs` pasted into the Apps Script project as a New
   version.** That one paste turned on three things at once: the emailed sign-in code,
   `__CONFIG__/theme` writes, and the fix for uploads that vanished on Android. Proven
   by signing out and back in and being asked for the code. **A second paste went in the
   same day for the sign-in audit** (see the security note above), with the frontend
   published first as the order requires.

   **A third paste went in on 2026-09-23**, carrying the two changes aimed at the
   sign-in wait — the every-minute `installKeepWarmTrigger()` and the file-id cache in
   `findStoreFile`. `installKeepWarmTrigger()` was run the same morning and answered
   *already installed — 1 trigger(s) call `keepBackendWarm`. Nothing changed.*, so the
   sweep is live. The owner confirmed the deployment version date matches the paste, so
   **both halves are deployed**. What is still unproven is the **outcome**, and only the
   field can show it — see the sign-in-wait note under UX below.

   To confirm a paste took, run
   `reportRecentSignins(1)` from the editor: it prints a line per sign-in, or an empty
   window if nobody has signed in since the paste. Editor
   https://script.google.com/home/projects/1HBTlKzgMInqvt_yCUCwsA0RmrvetIylFyPxpHA_ch5mEpvOhDYbTBUj9/edit
   — **Deploy → Manage deployments → ✏️ → New version**. Never "New deployment" (it
   mints a different `/exec` and breaks every installed client), and the `/exec` URL
   must keep ending `jQXatfT/exec`. **Backend last, never first** — and the frontend
   goes first again here, because the device label the audit records comes from
   `app.js` and an old backend simply ignores the extra field.

   ✅ **The live state as of 2026-10-07 was `apiVersion 7`** — proven by `ping`, not by
   a deploy date — so everything up to and including the flight-log limits was running,
   and **what that copy did *not* hold was `API_VERSION: 8`, the customer accounts**.
   That was the one that mattered most of any so far: a `v7` deployment does not merely
   lack the feature, it **answers a customer's token with the whole repository**, so no
   customer account may be created until it is in. It rides the whole committed backend
   at once — paste the current `backend.gs` into **both** `/exec` deployments (the
   primary and the domain-scoped Google door) and everything goes live together. The
   way to confirm it without opening anything is `ping` answering **`apiVersion 8`**.

   ✅ **THAT PASTE IS IN — 2026-10-08, `apiVersion 8` on both deployments**, and it is
   the owner's own reading of `ping` that says so, never a deploy date or a version
   timestamp. So the customer accounts, the server-side narrowing that keeps one
   customer's rows away from another's, and the fifth **Customers** tab in User Access
   are all live, and the gate that said *no customer account may be created until this
   lands* is OPEN. ✅ **`API_VERSION 9` — the team roster, `listTeam` — went in on
   2026-10-09**, the same way and read the same way, and it is **the owner's own `ping`
   that says so**: `apiVersion 9`. The frontend went first, at `v80`, and the paste
   followed it into the `/exec` deployments. Nothing broke in the window between them,
   which is what the version note predicted: `loadTeamRoster()` is best-effort, so a v9
   frontend meeting a v8 backend simply had no roster to show. The two ways to read the
   number, both of which need no tooling: inside the app, the User Access panel's own
   status line (`Signed in as … · session ✓ · API v9`), or the deployment URL with
   `?action=ping` appended — `ping` is in the pre-auth map, so it answers without a
   token. The primary deployment is
   `…/macros/s/AKfycbzwiZyj_eO2P-5lddbUhs-ZJBSSwt6qLa8RKCOPkyysR4d35_ahtPXfijfyejQXatfT/exec`
   and the Google door's is
   `…/a/macros/indrones.com/s/AKfycbybK8zQxCvU8-BZIMMAgzI_71sZZhYHE9vh0We5nDtTydOSny_zZ_yQfIi0z22D7uKj/exec`;
   a cold first tap can take 20–30 seconds, which is the warm-up and not a bad paste.

   **The history, kept because each line was an operational lesson, none of it now
   outstanding.** The `backup.html` verdict was proved live by exactly the mechanism
   that makes it worth trusting — it can only print *"Backup is fine — last good run
   …"* when the backend actually answers `backupPulse` with `{status:'ok', ok:true,
   atMs}`; a deployment without that action makes the page say *"The backend did not
   answer this check"* instead. **`rehearseRestore()` has since been run on a real
   archive and returned `REHEARSAL PASSED`** — and so have `runNightlyBackup()` (*"40
   file(s) read, 20 written, 21 IR(s), 18 account(s), rotated out 0 old folder(s)"*)
   and `installBackupTrigger()` (*"Nightly backup trigger installed — every day at
   about 23:40 IST"*). The rehearsal only ever rebuilds into `_rehearsal/`, so it
   cannot touch `_store/`.

   > **`backup.html` lives at
   > `https://monish-raza-87.github.io/I-PASSBOOK/backup.html`** — **`I-PASSBOOK`,
   > capitalised**. The lowercase `i-passbook-app` path is the repo *name*, not the
   > Pages path, and it 404s. The live check is the red one: the page must go RED when
   > the timestamp it is given is stale, which is the state a stopped backup would
   > produce.

   > **`https://script.google.com/d/<deployment-id>/edit` does NOT work.** The editor
   > is keyed by the **script ID**, not the deployment ID, and the deployment ID is
   > what appears in the `/exec` URL (`…/macros/s/AKfycb…jQXatfT/exec`). Pasting that
   > into a `/d/…/edit` link opens Google Drive's *"the file you have requested does
   > not exist"*. Use the `/home/projects/<script-id>/edit` form above.
2. ✅ **The Triggers page holds three triggers — confirmed 2026-10-09.** `keepBackendWarm`
   (every minute), `runNightlyBackup` (daily ~23:40 IST) and `archiveClosedIRs` (daily
   ~02:00) are all listed, owned by `monish.raza@indrones.com`, the account that owns the
   Drive folder — which matters, because a trigger executes as whoever installed it. Each
   is installed by running its own idempotent function once from the editor —
   `installKeepWarmTrigger()`, `installBackupTrigger()`, `installArchiveTrigger()` — and
   each replies *already installed* if it is there. **`runNightlyBackup()` was then run by
   hand once**, which is what the installer asks for and what gives the app its first
   "last backup" line: *"Backup 2026-10-09: 45 file(s) read, 20 written, 21 IR(s), 18
   account(s), rotated out 0 old folder(s)."* — 51 seconds, and `rotated out 0` is correct
   for a first run, since nothing is old enough to retire yet.
3. ✅ **The frontend is published at cache `v85` — 2026-10-10.** `v80` carried the team
   roster read (`listTeam`); `v82` was the two doors folded and independent on liquid
   glass; `v84` split the sign-in screen in two and deleted the full-screen splash. **`v85`
   is the three things the owner asked for on 2026-10-10**: the intro film now plays on a
   phone as well as a desktop (he was shown both and asked for it by name), the
   "Signing you in…" screen takes the app's own `--ind-ground` instead of the `#0b0b0b`
   it had been left on, and the unlock pattern reads its three colours from the cascade
   instead of six hardcoded hexes — so it is the first release in which that canvas
   follows all four palettes and both themes. Read on the live site after the push:
   `sw.js` answering `ipassbook-v85`, `app.js` answering `APP_VERSION = 'v85'` and
   carrying `patternInk`, `preview/video.html` `200`, `assets/brand-intro.mp4` and
   `assets/brand-panel-dark.png` both `200`, and the four pruned files
   (`intro_ipassbookv2.mp4`, `intro_ipassbookv2_mobile.mp4`, `Indrones Intro v2.mp4`,
   `logo.png`) all `404`. **All read on 2026-10-10 and all answered.** Publishing is
   `DEPLOY_SOURCE=category-insights node tools/deploy-ghpages.mjs` to dry-run, then the
   same with `--commit --push`; it needs the working tree clean, so the commits go
   first, and a `CACHE_NAME` bump in `sw.js` or it warns that returning users keep the
   stale shell for a load. The deploy is confirmed by reading the **served** files,
   never by a deploy date. The backend half is unchanged in this release — it is still
   **`v85` frontend / `API_VERSION 9` backend.**

   ✅ **`v86`–`v94` all shipped.** The published build is **`v94`** (gh-pages `d559e77`,
   `sw.js` answering `ipassbook-v94`): the section letters A–G with Costing as its own
   section (`v94`), the closed-loop profile menu (`v93`), the Service Desk bar and the
   ticket window (`v92`), the dock (`v90`), the IR grid (`v89`), the fused sign-in panel
   (`v88`+`v89` as one deploy). **`v93` and `v94` each owe a backend paste** and both are
   still outstanding — and item 6 below is the paste that carries all three at once.

   ✅ **`v95` IS PUBLISHED — 2026-10-14, gh-pages `e05164b`.** `APP_VERSION` and
   `CACHE_NAME` both read `v95`; all 37 smoke suites pass. Read on the live site after the
   push, never off a deploy date: `sw.js` answering `ipassbook-v95`, `app.js` answering
   `APP_VERSION = 'v95'`, `index.html` carrying `id="brand-replay"`, `base.css` carrying ten
   `--panel-ink`, `i18n.js` carrying `intro.replay` twice. It carries two things: **edit for
   every staff account by default, with a department's unticked box as the off-switch** (see
   [10](10 - Auth & Access Model.md) — the model inverted), and the **replay control for the
   intro film** on the sign-in screen's left panel. Its backend half **landed the same day** —
   see item 6 below. `API_VERSION` was deliberately **not** bumped by v95: it adds no action
   and no section id, which is this repo's stated trigger.

   ⏳ **`v96` — the Company & Contact register — is BUILT on both halves, and NOT deployed.**
   `APP_VERSION`/`CACHE_NAME` read `v96` and `backend.gs` reads **`API_VERSION: 12`**, all 37
   smoke suites pass, `preview/` is rebuilt — and the two things that make it live are both
   still owed: the frontend deploy and the **backend paste into BOTH `/exec` deployments**
   (a New version each; primary still ends `jQXatfT/exec`), confirmed by `ping` answering
   `12`. It ships a new store file (`_store/companies.json`), the actions `saveCompany` /
   `deleteCompany`, and the register panel in User Access → Customers; see
   [04](04 - Backend API Reference.md) and [10](10 - Auth & Access Model.md). **This is the
   first release since v8 where a new field on `listUsers` matters to the frontend**, so the
   order is the same as always: **frontend first, backend last.**

   > ⚠ **A pre-v96 backend is silent, not broken.** `listUsers` would carry no `companies`,
   > so the panel quietly falls back to the **old IR-derived company list** and every register
   > edit lands nowhere — no error, and the screen says it saved. That is the exact failure
   > shape of v95's `revokes`, which is why the paste is a two-step task and is not done until
   > **`ping` answers 12**.

   > **A process note worth keeping.** Part 2 changed `index.html` **inside
   > `#auth-container`**, which is the exact string `render-fixture.mjs` and
   > `build-ui-options.mjs` slice from. So `node tools/build-ui-options.mjs` had to be
   > re-run before the deploy or the `preview/` fixtures would have been sliced from a tag
   > that no longer matched. The tag is a **slice anchor**, and adding an attribute to it is
   > a silent break — the plan forbade touching that tag, and it held.

   > ⚠ **`--push` PUSHES `gh-pages` ONLY. IT DOES NOT PUSH THE SOURCE BRANCH.** The tool
   > reads the served files out of `DEPLOY_SOURCE` and commits them to `gh-pages`
   > (`git push origin gh-pages`), and stops there. So after the `v85` deploy
   > **`origin/category-insights` was still at `6f0739f` while the release commit
   > `04a7e62` existed only on the machine it was made on** — and the same is true of
   > `v83` and `v84` before it. Nothing is lost as long as that machine is the same one,
   > but a clone of this repo does not contain the source of what is running. Deciding
   > whether the source branch should be pushed with the deploy is the owner's call; it
   > has not been.

   ✅ **`v97` — NO GOOGLE FILE IDS IN THE SOURCE — is BUILT (2026-10-17).** Backend-only;
   `API_VERSION: 13`. The four Sheet/Drive identifiers and the external address list left
   `CONFIG` for `_store/ids.json`, and the `_store/` root folder id left it for the
   **`STORE_ROOT_FOLDER_ID` Script Property** — because `backend.gs` is in a **public**
   repository, and a public id plus a share setting that slips is precisely how the intake
   sheet became readable to the world for two days in October 2026. Full detail in
   [05](05 - Configuration & Secrets.md); the reader list and the two accessors are in
   [04](04 - Backend API Reference.md).

   ⏳ **v97 has a DEPLOY PREREQUISITE, which no previous release has had.** The code alone is
   not a working deploy: the Script Property must be set and `seedStoreIds()` run, or every
   store-backed action throws a named error. The order is:

   1. `setStoreRootFolder('<the Drive folder id>')` — the folder that **contains** `_store/`
   2. a Script Property `SEED_STORE_IDS` holding the four values, then `seedStoreIds()`
      (it deletes its own seeding property, and refuses to clobber a non-empty file)
   3. *Deploy → Manage deployments → New version* for **each** of the two `/exec` deployments
   4. confirm with **`listIRs`** — see the warning below

   > ⚠ **`ping` CANNOT CONFIRM THIS ONE, AND EVERY PREVIOUS RELEASE TOLD YOU IT COULD.**
   > `ping` is routed **pre-auth** and touches no store, so it answers `13` happily while
   > the Script Property is unset and the entire store is unreachable. Confirm a v97 paste
   > with an action that actually reads the store — `listIRs`, or `backupPulse`. This is the
   > same one-directional rule as the 404 trap in [08](08 - Development Guide.md): a good
   > answer is evidence, a bad one is not.

   > ⚠ **The ids are clean going FORWARD; the four older ones are already public and stay
   > that way.** They have been on `origin/main` since the repo began, in 8 files each, and
   > a force-push does not recall them from a fork or a mirror. Treat them as disclosed. The
   > move is defence in depth — it stops the NEXT mistake being reachable — and the control
   > that actually stops access is the sheet sharing, which the owner reports is Restricted
   > and which I have **not** verified myself.

   > **A guard must not carry the value it guards.** The first version of the v97 test
   > assertions pinned the literal ids and the external address in order to forbid them —
   > which re-published all five into the same public repository the change was cleaning.
   > The assertions are **shape-based** now (any 30+ character id-shaped literal carrying a
   > digit; any non-`indrones.com` address), which is both leak-free and stronger, because
   > it catches a value arriving by a route nobody listed.

   > ⚠ **The history purge is deliberately LAST, and must not touch `gh-pages`.**
   > `gh-pages` carries none of the values (its tree has no `backend.gs`), so rewriting it
   > buys nothing — and `tools/deploy-ghpages.mjs` pushes **without `--force`**, so a
   > rewritten `gh-pages` makes the next deploy fail outright. The branches that DO carry
   > them are `main`, `category-insights`, `otp-login` and `auth-rewrite`. **One commit
   > message carries two of them in full** (it names the live data sheet and the old master
   > sheet in its subject/body), and a content-only filter leaves messages alone, so the
   > rewrite needs a message pass or those survive forever. Every commit hash changes, which
   > dangles the SHAs quoted throughout this file and `PROJECT_HISTORY.md`. That message is
   > **not reproduced here** — quoting it to describe the purge would re-publish exactly what
   > the purge removes, which is the same fault as a guard carrying the value it guards.

   > **A new file needs a SERVED line, and a stale one is worse than a missing one.**
   > `terms.html` and `privacy.html` are in `tools/deploy-ghpages.mjs`'s `SERVED` array.
   > A file that exists in the repo but not in that array is never published; a file
   > dropped from it is not deleted either — it lingers on `gh-pages` until it is named
   > in `PRUNE`. The two are not symmetrical and both have been got wrong.

   > **Two things stopped this deploy the first time, and neither is a code fault.**
   > **(a)** `tools/deploy-ghpages.mjs` **refuses to run on a dirty tree** — it checks
   > `git status --porcelain` and aborts, so seventeen uncommitted files stop it at
   > line one. Commit first. **(b)** On Windows **PowerShell**, `DEPLOY_SOURCE=… node …`
   > is not valid syntax — PowerShell has no env-var prefix, so the variable is silently
   > empty and the script falls back to `main`, the wrong branch. Use
   > `$env:DEPLOY_SOURCE='category-insights'; node tools/deploy-ghpages.mjs --commit --push`
   > (or run it from bash). The dry run prints `cache ipassbook-v79 → ipassbook-v80`;
   > **if that line shows no change, stop** — returning users would stay a load behind.
   > Its `prune` line is safe to read as information: it removes files that are on
   > `gh-pages` but no longer referenced, which is how the two dead pre-rename assets
   > (`assets/Indrones Intro v2.mp4`, `assets/logo.png`) went; the live ones,
   > `assets/intro_ipassbookv2.mp4` and `_mobile.mp4`, are named in `index.html` and stay.

4. ⏳ **`v83` — the transitional page and the legacy archive, in one release (2026-10-09).**
   Two unrelated things that both answer the same complaint: *"the subsequent pages which
   we have designed for transition must also be of our current app theme… plus, i do not
   see that you have fed data into our app all that was gathered from my legacy database."*

   **(a) The Google door's page now wears the app's theme.** `handoffPage()` in
   `backend.gs` was still drawing the look the app abandoned — a `#005cad` blue button and
   a `border-radius: 14px` card. It cannot link the app's stylesheets (different origin,
   and a delayed first paint at that moment is the one thing it must not do), so the
   values are literals, each commented with the token it came from. See
   `docs/04 - Backend API Reference.md`. **This is a backend change and owes a paste to
   BOTH `/exec` deployments, via New version.**

   **(b) The legacy archive is loaded again, and it had been loaded by nobody since
   2026-07-08.** `loadLegacyIndex()` lost its only caller in `d92b206`, for a reason that
   was true then and is not true now (it had to mint a Google One-Tap identity per call;
   the token is a server session attached by the fetch interceptor since the auth rework).
   The stale note stood in its place for three months, and the effect was that
   `legacyMap` stayed empty on every device — so **no card was ever badged "Legacy
   record" and `#ir-legacy-btn`, the only way into a pre-app ticket, was never shown.**
   Every test of that feature passed the whole time, because all of them test the
   function's BODY and none could see that nothing called it. `smoke-list-intel.mjs` now
   asserts the caller.

   Read on the live site after the push: `sw.js` answering `ipassbook-v83` and `app.js`
   answering `APP_VERSION = 'v83'`.

5. **Delete the retired `ACL` and `ACCESS_REQUESTS` tabs** — nothing has read them since
   the store moved to Drive JSON on **2026-09-17**, so **2026-10-17** is the earliest
   safe date; they are the only record of the old hand-assigned grants, which is the
   whole reason to wait. Deleting is right-click → Delete on each tab in the IR
   workbook. Leaving them costs only clutter, so this is housekeeping, not a fix.
   Drive usage is worth a look at the same time (see "Erase archived IR folders").
6. ✅ **DONE 2026-10-14 — THE `v95` PASTE LANDED, ON BOTH DEPLOYMENTS.** The owner pasted the
   whole `backend.gs` into both `/exec` deployments as a **New version** (primary still ending
   `jQXatfT/exec`). **The primary is confirmed by a pre-auth read of `ping`**, which answered
   `{"status":"ok","apiVersion":11,…}` — appended to the deployment URL as `?action=ping`, which
   needs no token because `ping` is in the pre-auth map. It carried **three releases at once**:
   v93's profile-menu recovery fix, v94's `sec-cost` section, and v95's revoke model.

   > ⚠ **The 404 rule is ONE-DIRECTIONAL, and this is where it pays off.** A 404 on
   > `CONFIG.GAS_URL` proves nothing — a live deployment answers one (see
   > `backend-exec-can-vanish`). But a **200 carrying the right payload is real positive
   > evidence**, and that asymmetry is the only reason this could be closed from here at all.

   > ⚠ **The old second step — "then tick the Section D (Costing) boxes by hand" — is
   > OBSOLETE.** It was written when a new section id started at *view* for everyone. Since
   > v95 edit is the default, so `sec-cost` starts at *edit* like every other section and
   > nothing needs ticking. Do not go looking for boxes to tick.

   > **The Google door's half is still unread from here.** `/a/macros/indrones.com/…` redirects
   > an anonymous read to `google.com/a/indrones.com/ServiceLogin`, and that redirect is *not*
   > evidence either way. The owner's own browser, already inside the domain, reads it.
   > Nothing in the app depends on the two deployments agreeing, so this is a record, not a risk.

   **Why it could not wait, kept because the shape recurs.** The v95 frontend's Departments grid
   reads `revokes`. On a **pre-v95** backend that key did not exist, so an ordinary **Save** in
   User Access → Departments would have silently **wiped `grants` and turned off `triage`** for
   that department — no error, and the screen said it saved. That is the real cost of
   frontend-first whenever the frontend learns a **new field**, as opposed to a new value.

   **Still unproven, and only the field can prove it:** no staff account has yet reported meeting
   the new *"edit was switched off by …"* note. To see it end to end: open **User Access →
   Departments**, untick one box, Save, reload — it must stay unticked. That is the whole
   feature.
- [ ] Push notifications for IR status changes
- [ ] Photo gallery view for saved file links
- [ ] Form validation with required fields
- [ ] Offline-first with local storage sync queue
- [x] Multi-language support (Hindi + English) — *built 2026-10-08, `v78`. `TABLES.hi` in
      `i18n.js` is a real second table keyed to the same strings as English, with English
      kept as the per-string floor; Urdu was **deleted** from the picker the same day on
      the owner's instruction ("Keep only hindi and english"), not left untranslated. It
      is a HALF-translation and says so: the chrome, the workflow statuses, the landing
      page and the customer's panel are Hindi; the six section forms and every toast in
      `app.js` are still English inside a Hindi frame. Building it found one real defect —
      the sign-in button's label was written by `app.js` in English and overwrote whatever
      the table put there, on both doors, in every language. `customer.html` has no
      language layer at all and was not in scope.*
- [ ] **Populate the IRs from the two crawled mailboxes and the legacy workbook.** The
      owner's ask of 2026-10-08, restated on 2026-10-09 as *"my app should be ready to fly
      from day 1 with all previous contexts."* It is **two halves, and only one of them is
      blocked.**

      **The workbook half now works — 2026-10-09, `v83`.** All 161 pre-app IRs named like
      one in the legacy workbook are reachable again: they appear in the master list with
      a **Legacy record** badge, and `#ir-legacy-btn` opens the original tab read-only
      through `getLegacyIR`, one tab at a time. What that took was **one line** — a caller
      — because the whole feature was already built and had simply been unplugged on
      2026-07-08 (see the checklist above). Note what this is and is not: the workbook is
      read **live and on demand**, so a legacy ticket is *reachable*, not *copied*. The
      app still owns no legacy row, and `sections/IR<n>.json` is written only for IRs
      somebody works on in the app. Bringing the workbook's *contents* into the store —
      so a legacy ticket can be triaged, assigned and counted like any other — is a
      different and larger job, and it is still not started.

      **The email half is blocked on data that is not in this repo — and the blocking
      question is now one run away from being answered.** `Email_Index` is built and
      complete (2393 rows / 646 threads, two mailboxes, 370 of 452 IRs) but **nothing
      here can read it**: there is no `Email_Index` code anywhere in the repo, no
      `GmailApp` use, and no column definition. Its build script was run from the Apps
      Script editor and never committed, and the tab lives in one of the two mailboxes.

      Three facts are needed before a line of it can be designed — **which spreadsheet
      holds it, what its tab is called, and what its columns are** — and as of
      2026-10-09 a function exists that answers all three in one run without anybody
      editing anything: **`inventoryEmailIndex()`**, committed but **not yet run**. It
      searches the Drive for spreadsheets named like an index and inventories each one's
      tabs, header rows and row counts. It is the sibling of `inventoryLegacyWorkbook()`
      (which is how the workbook's 170 tabs were settled), it is editor-run, it has no
      route, and it **never touches Gmail** — a mail scope would force every account on
      the deployment to re-authorise the whole app for a one-off survey. It prints the
      account it ran as first, because the two mailboxes belong to different accounts and
      a file one can see the other frequently cannot: an empty search is a statement
      about identity before it is one about naming.

      **The run happened, and it landed better than expected (2026-10-09).**
      `inventoryEmailIndex()` was run from the editor and answered all three questions at
      once. **`Email_Index` is a second tab in the spreadsheet the app already opens** —
      `_store/ids.json` → `irRepoSheetId` (it was `CONFIG.IR_REPO_SHEET_ID` until v13), the same file as `CONFIG.IR_REPO_TAB`
      ('Form Responses', the client intake read on every boot). So reading it needs **no new
      file, no sharing change, no new OAuth scope and no extra permission** — it is one
      `getSheetByName('Email_Index')` beside a call the app already makes. Worth generalising:
      before assuming an unknown legacy source needs access granted, check whether it already
      lives in a file the app opens.

      **The schema, header on row 1, 2394 rows including it — i.e. 2393 messages:**

      ```
      IR_No | Thread_Id | Message_Id | Date | From | To | Subject | Preview | Direction | Mailbox
      ```

      `IR_No` attaches a message to a ticket, `Thread_Id` groups a conversation, `Direction`
      is in/out, and `Mailbox` distinguishes the two mailboxes — one row per *message-per-mailbox*,
      so a mail delivered to both accounts is two rows with two `Message_Id`s. Everything an
      importer needs is present; nothing has to be inferred.

      **Two things the same run turned up in that file, neither previously recorded.**
      `LS_Data` is a 455×23 normalised mirror of the response sheet with clean headers
      (`IR_YEAR`, `IR_MONTH`, `INTERNAL_EXTERNAL`, `IR_SUB-CATEGORY`, `RESOLUTION METHOD`,
      `UAS SN`, `CUSTOMER_NAME`) — if those are populated they are a better source than
      re-deriving the same facts from free text, and `IR_SUB-CATEGORY` is exactly what the
      category insights need. And `Timeline 1` is an **object** sheet (a chart or embedded
      object), so `getRange()` on it throws *"The action is not supported for OBJECT sheet"* —
      the survey caught that per-tab and carried on, and any reader must skip non-grid tabs
      rather than trust `getSheets()`.

      The other half of the owner's ask, the **CR representative derived from the IR's
      date**, stays blocked on this one: it has no caller until an ingest exists.

- [x] **The `Email_Index` reaches the app** — **built 2026-10-09 as `API_VERSION 10`.**
      The tab and its 10-column schema were confirmed that day, and it lives in a file
      the app already opens, so it needed no new access of any kind. **The owner chose
      the placement: the activity timeline.** A ticket's mail now merges into the same
      list as its audit rows through `buildTimeline`'s new fifth parameter — an email
      and a section save are one story about one ticket, and a second panel would be a
      second history to keep in step. Rows carry their own kind, glyph and label so a
      customer's mail is never mistaken for a colleague's comment; the crawl's own
      `Direction` value is printed raw as a chip rather than mapped onto an invented
      vocabulary; and the mailbox rides the by-line, which is what explains a mail that
      appears twice. **Never a section form** — nothing there writes it, and a form
      implies an editor. See `listIRThreads` in [04](04 - Backend API Reference.md).

      **Two things this deliberately still does not do.** The `Date` column's exact
      format is not declared anywhere, so the reader parses it with the same tolerant
      parser the audit rows use and lets an unreadable one sink to the bottom rather
      than dating it today. And the crawl files each message **once, under the first IR
      it matches**, so a thread can sit under a ticket only its opening message
      concerned (the recorded example: IR013 losing a 26-message thread to IR012). The
      owner decided on 2026-10-06 to change that to *file under every IR it mentions* —
      that change is in the **crawl**, not in the app, and is not made.
- [ ] **The IR's CR primary representative, derived from its date.** The rule is the
      owner's, given 2026-10-08, and is recorded here because it exists nowhere else in
      the repo: **from 11 May 2026 onward, Adhik; before that, Monish Raza — except before
      27 Aug 2023 and between 1 Apr 2024 and 16 Jun 2025, when it is Ravi Singh.** It is
      deterministic in the IR's date, so it is a pure function and a test rather than a
      judgement, but it has no caller until the ingest above lands. Note the open question:
      whether this belongs in the Overview's "Customer Relations Manager" field, which is
      per-ticket and human-editable, or in a separate read-only field of its own.
- [x] **"Assigned to" in the Allot panel offers no onboarded employees.** Built
      2026-10-09 as **`API_VERSION 9`** — a new authenticated action, `listTeam`, that
      returns `{email, name}` for every ACTIVE account that is not a customer, and
      nothing else. The old note called this blocked on a paste "before any frontend
      work can be tested against it"; that turned out to be half right and the other
      half is what made it shippable now. The frontend half is `loadTeamRoster()`, and
      it is **best-effort by design**: a `v8` backend answers an error or an HTML page,
      both land as a miss, and the hand-edited directory simply stands alone — which is
      exactly what shipped before. So the frontend could be built and tested first, and
      the paste is what turns the roster on rather than what unblocks the work.
      **The join, and the trap it avoids.** `teamDirectory` is a MEMORY — a list an admin
      types names into; the accounts are the FACT. The app now reads `teamPeople()` —
      the union, keyed on the lower-cased email, with the account's own name winning —
      and the union is never written back to `ipb_team_directory`, so the editor keeps
      editing the admin's own document. Two silent failures drove this: a hand-typed
      name that matches no account makes the assignment a notification nobody receives
      while the ticket shows an owner, and a colleague who has an account but was never
      typed in is simply unpickable. A directory row for somebody with no account yet is
      KEPT, so an admin who wrote down a joiner does not have them vanish.
      **A real bug fell out of testing it**: `setUserStatus` returned its new state as a
      SECOND `status` key, which overwrote the `'ok'` that every caller in this backend
      tests. It answered `status: 'disabled'` where everything else answers `'ok'`. Only
      one call site reads it and it reads `.message` first, so nothing had noticed. The
      state now travels as `userStatus`, and `smoke-store.mjs` pins it.

- [x] **An ids index for the fixed-name store files, on the `sections/index.json`
      pattern — DECIDED AGAINST, 2026-10-09, not deferred.** Read the code before
      building it and the numbers came out the wrong way round; `smoke-store.mjs`
      section 13 is the measurement.
      - `rememberedStoreId` already answers from `CacheService`, which is free, and it is
        per FILE: once a file has been looked up, its id lives for six hours regardless of
        how many requests follow. Measured on the real store fake — a **cold** ticket open
        pays a search; the next open pays **0**; the first save after an eviction pays one
        search per file it opens (`sections/index.json`, `audit/IR409.jsonl`,
        `journal/<date>.jsonl`) and every save after that pays **0**. That zero is the
        steady state, and it is the case a person lives in — the save they make twenty
        times a day costs no search at all.
      - An index file would have to be found and then **read** on every request, warm or
        cold — the same ~0.37s Drive measured for a search — to remove three searches
        **once per six-hour window**. It is slower in the state that matters.
      - It is also a second cache over the same facts, and it cannot do the one thing
        `rememberStoreId` does at CREATE time: a file made in this execution is in the id
        cache immediately, so it closes the window in which Drive's eventual consistency
        hides a file it has just made (`findOrCreateStoreFile`). The index would not hold
        that file until the index was rewritten.

- [x] **The app feels laggy.** Raised 2026-10-08. **Measured 2026-10-08**, in a real
      browser (headless Chrome, 390×844, the app's own bundle served locally, rows shaped
      like what `listIRs` returns) rather than read off the source — the whole point of
      the exercise, because static reading ranked the suspects in an order the clock did
      not agree with.
      **What the clock said** (N = the number of IRs in the list):

      | Work | 100 | 300 | 600 | 1200 |
      |---|---|---|---|---|
      | one full `renderIRList` | 21 ms | 42 ms | 60 ms | 91–122 ms |
      | one `renderInsights` (dashboard) | 7 ms | 11 ms | 21 ms | 28 ms |
      | `renderBoard` (capped at 25 cards) | — | — | 4.5 ms | — |
      | `renderLayout` | 0.1 ms | 0.5 ms | 0.6 ms | 1.3 ms |
      | `renderSegments` / `renderCategorySegments` | — | — | 0.8 / 0.3 ms | — |
      | `applyIRStateToAllIRs`, `refreshCommentCounts` (46 buttons), `buildTimeline` | — | — | under 2 ms each | — |

      `renderIRGrid` is the first entry here that is a **row** rather than N — measured
      2026-10-11 at 1440×900 on the same probe: **13.4 ms for 60 records, 12.7 ms for
      300, 13.7 ms for 1200.** Flat, because `GRID_CAP = 60` bounded what it built and
      the cap did not move with N.

      ⚠ **THAT MEASUREMENT WAS TAKEN THROUGH THE CAP, SO IT MEASURED THE CAP.** It is
      kept here as the worked example of the mistake: every number in the row above is
      the cost of building 60 tiles, and the reader who took them as "the grid is flat"
      would have concluded the opposite of the truth. The owner removed both caps on
      2026-10-13, and the uncapped cost was then measured properly:

      | Work | Measurement |
      |---|---|
      | 454 tiles — build the strings | 14 ms |
      | 454 tiles — assign + forced layout (warm) | 44 ms |
      | 454 tiles — assign + forced layout (coldest first paint) | ~146 ms |
      | 454 tiles — same, re-measured on the live v91 page | 78 ms |
      | the **uncapped IR list**, per keystroke | 27–45 ms (0.06–0.1 ms/row) |

      Which is what the uncapped list has always cost. `renderIRList` at 1200 measured
      **211 ms** in the same run, so the honest reading is not "the grid is flat" but
      "the grid and the list cost the same per row, and the list was never capped." The
      caps are gone, and no chunker, `IntersectionObserver` or scroll listener replaced
      them.

      So there is exactly **one** cost in this app proportional to the data — putting N
      cards on screen at ~0.06–0.1 ms each — and everything else a static read flags
      (layout walks, state overlays, the comment-bell sweep) is noise. `buildSectionForms`
      is a single ~22 ms hit per ticket open.

      **Two things were paid for nothing, and both are fixed:**
      1. The search box repainted the entire list **once per keystroke**. Five characters
         was ~5 × 60 ms = ~300 ms of main-thread work at 600 IRs. The listener is now
         leading+trailing rate-limited at 150 ms (`throttleTrailing`) — one rebuild per
         burst, and the *last* state is always the one painted. Measured after: **41 ms
         for the same five keystrokes**. `applyListFilters()` itself is untouched, so the
         segment strips, `loadIRState()` and `patchIRState()` still land on the tick they
         are asked for.
      2. `renderInsights()` rebuilt the whole dashboard **while it was hidden**, twice per
         boot. Its own header claimed it was "a no-op while the pane is not showing" and
         it had no such guard: `#insights-body` is static markup in `index.html`, so it
         exists on every route. Now gated on `currentView`, with `showInsights()`
         repainting on entry and `handleRoute()` only reaching it after `_irsReady` — so
         nothing can go stale. Measured after: **0 ms while hidden**, unchanged 10–21 ms
         when shown.

      **Still unmeasured, and it is the honest remaining question.** Everything above is
      CPU. The network half cannot be measured from this environment, and the code proves
      **two backend round trips per section save** (`saveSection` POST, then an
      `getAuditLog&limit=400` GET from `loadActivityLog`) and **two per IR open**
      (`getPassbook`, then the same audit GET). At the store's measured ~0.37 s per
      operation that is ~0.7 s per save and ~0.7 s per ticket, and a section save fires
      1.5 s after you stop typing. **The next step is his, and it is a count, not a guess:**
      open the browser's Network tab, type one character into any section, wait for
      "Saved", and count the requests. If it reads 2, the next release should fold the
      audit entries into the `getPassbook` reply (a backend change, so a paste) or skip the
      post-save audit refetch when the save wrote no diff.

      **How to re-measure these numbers** (they are the app's own bundle in a real
      browser, not a reading of the source, and they do drift with N):
      `node tools/serve-local.mjs 3111`, then
      `node tools/render-themes.mjs http://127.0.0.1:3111/index.html --width 390 --height 844 --themes light --settle 2500 --eval "<js>"`,
      where the eval builds N synthetic rows, calls `setAllIRs(rows)`, times
      `renderIRList(allIRs)` and `renderInsights()` with `performance.now()`, and returns
      `JSON.stringify(...)` — the harness prints whatever the eval returns. The probes are
      scratch files under `tools/.cache/` (gitignored, like every other one-off fixture),
      so the recipe above is the durable part.
- [ ] **Erase archived IR folders.** Not built, deliberately: closing an IR moves its
      folder to `Archive IRs/` and nothing is ever deleted. The owner will watch Drive
      usage for a while and ask for this separately if space becomes an issue.
- [x] **Move the IR list read behind the authenticated `listIRs` action — DONE 2026-10-03.**
      The no-login read path is deleted from `app.js` and the app names no sheet at all;
      `listIRs` sits in the authed map and takes the caller's identity, so the read can no
      longer be reached unsigned. `smoke-list-intel.mjs` fails if a `gviz`/`tqx=out` fetch,
      a `spreadsheets/d/<id>` address, or a sheet id ever returns to `app.js`.

### Done since this list was written
- ✅ **Eight things the owner raised on 2026-10-10, all closed in the `v86` work.** Listed
  here so the next reader can find them; each is written up in full in
  [01 — Project Overview](01 - Project Overview.md) (the icons),
  [06 — UI Components & Styling](06 - UI Components & Styling.md) (the head line, the
  sidebar lockup, the two scroll areas) and
  [04 — Backend API Reference](04 - Backend API Reference.md) (the door page).

  - **The tab icon is the clean mark, and the home-screen tiles are plated.** He supplied
    `Mobile Logo.png` and `Browser Tab Logo.png` by name and said which slot each was for.
    `<link rel="icon">` had been pointing at `icon-192.png` — the framed lockup, which at
    16 px is a smudge, and which he had *separately* reported as "dirt" at 56 px on the door
    page before anyone joined the two up. It now points at `icon-mark.png` on `index.html`
    and on the four standalone pages. **The two files are one mark on two grounds**, not two
    marks: the transparent one everywhere the app paints the mark, the plated one wherever
    an OS draws a tile and masks it. No new file went into any precache or serve list.
  - **The door page's logo was wrong twice over, and both halves are fixed.** The mark it
    loads is `assets/icon-mark.png` **from the app's origin**, so replacing the artwork fixed
    it with no paste. Separately its dark treatment was a **bare `invert(1)`**, which turns
    the brand yellow `#f8c808` into `#0737f7`, an electric blue; it is now
    `brightness(0) invert(1)`, matching the app. The comment that justified the old value
    described the 2025 disc — rewritten, not deleted.
  - **The fingerprint door explained nothing, because ONE `catch` said "cancelled" to every
    failure.** A device that no longer holds the key, a browser refusing the call, a
    dismissed prompt and a timeout are four different things and wore one sentence — which
    is why *"it is different now"* could not be diagnosed from the screen. Each now has its
    own message; enrollment failure is reported instead of handing over a pattern dialog in
    silence (it was an empty `catch (e) { }`); the button's busy label went through the
    translation table like every other one in the app; a dead twin function
    (`unlockFingerprintGesture`, defined and never called) is deleted; and a passkey is no
    longer left on the device with no record pointing at it. **What is still owed is his
    retry** — the fixed build will name which of the four it is.
  - **And then it asked for a USB key, because `allowCredentials` was conditional**
    (2026-10-13). *"It has to ask for my device's login key but is either asking for some USB
    method or QR code scan method."* A `credentials.get()` with no `allowCredentials` is not
    "any key will do" — it is a **discoverable-credential** request, which a browser may only
    answer by offering its own picker across every transport it knows. Enrolment mints this
    device's passkey with `residentKey: 'discouraged'`, so the key that picker hunts for cannot
    exist: the app was asking the wrong question, and reporting the answer as a broken
    fingerprint. The rule was written down at the top of `app.js` and the live path simply did
    not follow it — **and no suite asserted the shape of the call**, which is why it shipped.
    Three changes: `allowCredentials` is now mandatory on that path and always carries a
    transport; with no stored `credentialId` the call is **not made at all** (a sentence naming
    the state replaces a picker he cannot satisfy); and enrolment now records
    `transports` and accepts RS256 beside ES256, so a chipset that will not mint ES256 is no
    longer read as a broken fingerprint. `authenticatorSelection` is unchanged —
    `residentKey: 'discouraged'` is *why* the id is mandatory, and weakening it to
    `'preferred'` would trade a rule for an accident. **⚠ I cannot test a platform
    authenticator**, so the suites pin only the shape of the call; only his own device can
    test the real thing. If it still offers USB/QR, the instruction is: turn quick unlock off
    in the avatar menu and set it up again. A device that genuinely cannot do it now gets a
    plain in-page explanation (`showMethodInactiveNote('nohardware')`) rather than four
    onboarding steps it cannot follow.
  - ⚠️ **AND THAT INSTRUCTION NAMED A CONTROL THE APP DID NOT HAVE (found 2026-10-13, from
    his own report).** Every recovery sentence above sends him to the profile menu to
    re-register the method — and the menu was **one button carrying three labels**: no record
    = "Turn on Quick unlock"; a record with no pattern = "Add unlock pattern"; a record with a
    pattern = "Remove quick unlock". So a record holding a **fingerprint and no pattern** — the
    state right after enrolling, and his state — showed *only* "Add unlock pattern": **no way
    to re-register the fingerprint, and no way to remove the record.** When the browser no
    longer held that key, every route the app offered led back to the same refusal, and the
    refusal told him to do the one thing the menu made impossible. He described the loop
    rather than the bug: *"my device's, i.e., currently laptop that I am using, whichever login
    password is, I can enter that same to login in my app."*
    Removal is now **its own row**, shown whenever a record exists, and the primary row offers
    only what is *missing* (it hides when both methods are registered). All four recovery
    sentences name the row by its real words: *"Open your profile menu (top right), choose
    "Remove quick unlock", then set it up again."* `smoke-unlock.mjs` pins the row, its click
    handler, the two-way visibility rule and — against **comment-stripped** source — that no
    sentence still says "off and on again". **The lesson is not about WebAuthn**: a recovery
    message is only as good as the control it names, and nothing was checking that the two
    agreed.
  - **The sidebar lockup types itself on a loop**, as he described: mark, then the word
    typed, then both fade, then a beat, then again. A `clip-path` reveal rather than a width
    change, wrapped in `no-preference`, and the keyframes drive *out of* the composed state
    so that "no animation" and "animation finished" both mean "the brand is there".
  - **The board has a left-right bar above its columns** — a real second scrollbar in
    `#ir-board-scroll`, kept in step with the board by `scrollBoardMirror()`, because CSS
    cannot move a scrollbar off the bottom edge of its own scroll container and the
    `scaleY(-1)` flip would flip every card with it. **The IR list's own separate scroll area
    already existed and was deliberately left alone**: `.ir-list` scrolls inside a
    `#index-view` that declares no `overflow`, so the search box and both filter strips stay
    put. Both halves are pinned in `smoke-board.mjs`.
  - **The sign-in head now quotes the product name**: `WELCOME TO INDRONES' AFTER SALES
    PORTAL "I-PASSBOOK"` (straight quotes, his choice), in the markup and in both languages.
- ✅ **The Help & FAQ page wears the app's own skin at last.** The owner, 2026-10-10:
  *"Help and FAQ page's UI is not aligned with our app's UI, rectify it."* He was looking
  at `faq.html`, and it was true — the page had been left on the language the app
  abandoned on 2026-10-08. It was blue (`--accent: #2440d8`), rounded (`--radius: 10px`),
  3px-left-barred cards with an 18px `backdrop-filter` over an ambient gradient. The app
  beside it is **INDRONES INDUSTRIAL**: a ruled flat ground, square corners, hairlines,
  and the mono face for anything that labels rather than speaks.
  The page now restates the app's own **role** tokens — `--ind-ground`, `--ind-panel`,
  `--ind-inset`, `--ind-line`, `--ind-rule`, `--ink`, `--ind-muted`, `--accent` and the two
  `--st-*-fg` callout edges — under the app's own names, light values on bare `:root` and
  both dark blocks re-pointing every one of them, because a colour defined only inside a
  dark block is invisible to a viewer whose system theme is the other one. **The glass and
  the gradient are gone, not replaced**: `industrial.css` §9 keeps the blur for the app's
  floating chrome and says why a panel is not floating — *"a flat colour is what a sticker
  is"* — so with nothing to blur there was nothing for the gradient to show either.
  Two things are worth knowing about it. **The accent is a role and not the brand yellow**:
  `#ffc400` is 11.18:1 on the dark ground and about 1.4:1 on this one, so the light block
  carries the **ink** `#171717` and only the dark block carries the yellow. And **the
  brand yellow appears exactly once**, as a 3px rule across the masthead — a fill, where
  it is legible in both themes, and never a word. `smoke-door-faq.mjs` used to check three
  tokens by the page's own old private names (`--bg`, `--fg`, `--surface`), which would
  have gone on passing while the page wore a look the app had left; it now checks the
  **roles**, both dark blocks, and both accent invariants.
- ✅ **The mobile intro filled the screen by zooming into the middle of it.** The
  splash video was sized `min-width/min-height: 100%` with `width/height: auto`,
  which reads as full-bleed and is not — a replaced element with auto sizing keeps
  its **intrinsic** size, and the minimums only ever raise it. Measured on the live
  build: a phone rendered the portrait cut at its native 1080×1920 and cropped it to
  the centre, showing **47% × 43%** of the frame against the desktop's 74% × 74% —
  a ~2.3× zoom, worst on the narrowest screen. It is `inset: 0` + 100% + `object-fit:
  cover` now, so the element is the size of the screen and the cropping is
  deliberate. The portrait cut itself was always right and always chosen
  (1080×1920, 3.8 MB, gated to `max-width: 639px`); the file was never the problem.
- ✅ **The app has a real icon, generated from one brand master.** On 2026-10-10 the
  owner replaced the brand with **Option A, The Telemetry Grid & Sub-Branding Variant**,
  and asked for it "everywhere". The master is now `assets/icon-master.png` (1024², the
  owner's 2048² original resampled — the largest size anything downstream asks for),
  and `icon-192.png`, `icon-512.png` and `apple-touch-icon.png` are all produced from
  it by `tools/make-icons.ps1`. Asked whether the tab icon should be the monogram or the
  whole lockup he answered **"The full lockup"**, so the three square icons are the whole
  thing, dimension marks and crosshairs included — that is what the variant *is*. The
  master is the **only** source: the superseded 2025 disc master is deleted rather than
  left beside it to be picked up by mistake. `smoke-shell.mjs` now fails if any icon is
  blank or the master goes missing.
- ✅ **The logo sits on the page instead of in a tile on it.** The owner reported the
  earlier icon arriving "in a shape of square" and asked for it borderless, "to feel real
  embedded into the page". The fix is `assets/icon-mark.png` — the **monogram** with its
  background **keyed out** — used for the sidebar, the sign-in panel and the emailed door
  page, while the tab, home screen and manifest keep the square lockup icons, because an
  OS tile has to be square. Under Option A the key is a **colour key** (an alpha ramp off
  the flat `#fffffd` field), not the border flood fill the old disc needed: the three inks
  are each 200+ levels from the field, so connectivity has nothing left to separate. The
  crop is measured, and the tool **asserts** it still lands on the monogram before writing,
  because a wrong crop is silent — the wrong rectangle still produces a valid PNG.
  Dark mode no longer inverts this mark: `invert(1)` turns the brand yellow electric blue,
  which is not a brand. It is `brightness(0) invert(1)` — a flat white silhouette.
- ✅ **The list says how far along each IR is, and how long it has been sitting.**
  Every card carries a `3/6` completion chip (a small bar plus the count, green at
  `6/6`) and an age — `In status 6d` when the app recorded the status change, `Raised
  21d ago` when only the client's raise date is real — with an **Overdue** badge on any
  open IR past its priority's limit. The IR header says the same thing, from the same
  helpers, so the two can never disagree. **Nothing is ever invented**: an IR with no
  real timestamp shows no age and is never overdue, and a legacy-only record with
  nothing saved shows no chip. Building this also fixed a real bug on the way —
  legacy-only stubs are appended to `allIRs` *after* `setAllIRs()` merges app-owned
  state, so a legacy IR that had been triaged rendered in the list as untouched
  (no assignee, no category, and now "0/7" over a ticket with saved sections); the
  merge is now re-applied to the records it missed.
- ✅ **Closed IRs have their Drive folders archived, and reopened ones come back.**
  A daily trigger (installed once with `installArchiveTrigger()`) moves the folder of
  any IR that has been `Close` for more than 30 days into `Archive IRs/`, capped at 10
  per run so the first sweep can be watched, and brings a folder back when its ticket
  is reopened. **Nothing is ever erased.** One resolver, `findIRFolder()`, is what makes
  this safe: the folder is looked for in the root *then* the archive, so an upload to an
  archived IR lands beside its existing files instead of silently forking a second
  `root/IR409`. Recorded as `archived` / `restored` in the ticket's own audit file. See
  [04](04 - Backend API Reference.md).
- ✅ **Users choose their own appearance, and the app is no longer plain.** Four preset
  palettes — Blue, Violet, Teal, Graphite — plus light/dark/system, both in an
  *Appearance* group in the **user menu** rather than the sidebar foot that had to be
  scrolled to. The accent became a real role (`palette.css`) instead of hard-coded blue,
  which also fixed a genuine accessibility bug: links and `.btn-primary` were at
  **3.37:1**, below WCAG AA, and are now 4.68:1 and 6.70:1. The look itself is the
  **Noticeable** polish level, a block at the end of `views.css`. See
  [09](09 - Design System.md).
- ✅ **App storage moved out of Google Sheets entirely.** Every byte the app owns —
  accounts, sessions, the access matrix, saved sections, the audit trail, comments,
  the knowledge base, backups — is a JSON file under `_store/` in the owner's Drive.
  The only two Sheets left are inputs. The old repository spreadsheet is archive-only,
  and the four sheet primitives that made positional rows safe (`findUserRowIndex`,
  `userCol`, `USER_HEADS`, `deptTabShape`) are deleted rather than shimmed: a JSON
  record has names, so every read-modify-write is a key assignment.
- ✅ **Per-section PDF export, images in the inward and IQC sections, and the end of digital signatures.**
  Every section A–G now has **⬇ Download** and **⬇ Download and share**, which build a
  real PDF file (vendored `pdf-lib`) with that section's photos embedded and any
  readable attached PDF merged in. The inward and IQC sections (`sec-b` / `sec-c`) gained the shared
  `imageEvidence` control, and IQC's "Link to Evidence Folder" field was removed. The
  nine `esignature` fields and their machinery were deleted, and the two Flight Test
  Report uploads became one field.
- ✅ **The section restructure** — nine sections became six (**B–G**); old Section A's
  content became the pinned **Overview panel** (data key `sec-a`, no letter, no tab);
  QC + Flight Test merged into **Section F — Quality Test Report**; PDI + Dispatch
  merged into **Section G — PDI Report/Dispatch Record**.
- ✅ **Costing became a section of its own, and the letters moved down one — 2026-10-13.**
  The six sections (**B–G**) became **seven, displayed A–G**: today's Part B — the cost
  analysis inside Investigation — is now **Section D — Costing** (`sec-cost`), because
  its two halves were always signed off by two different roles (Technical Support, and
  the Purchase Manager). The **ids did not move** — they are permission keys — so only
  the displayed letter changed, through a single `SECTION_LABELS` table read by
  `sectionLetter(id)` and never derived from the id. The warranty question moved into
  Investigation, below Preventive action. And Insights gained its **UAS MODEL** filter,
  with the two device filters renamed **UAS SN** and **UAS MODEL**. The eighth tab also
  made the strip wider than a phone screen for good, so `showSection()` now scrolls the
  tab it activates into view — one of its two callers selects a section *nobody pressed*
  (the Remote Support applicability redirect), and a tab that lights up off-screen says
  nothing about which section you are in. See
  [03](03 - Sections Reference.md); the owed backend paste and the data consequences are
  in Technical Debt above.
- ✅ **The automated activity log.** The hand-typed table is retired to a read-only
  `Legacy` block; activity is now generated from four sources the app already records —
  section saves and field edits, status/assignee/priority/category changes, comments and
  @mentions, and **file uploads** (which previously left no trace at all). One pure
  `buildTimeline(...)` feeds both the Overview panel and the 🕓 History modal, so the
  two can never tell different stories.
- ✅ **The borderless mark works in dark mode, and the reason it did not is worth
  keeping.** When the owner asked for the tile to be removed, the cutout's flood fill
  turned out to be reaching INSIDE the circle — through the light knockout band behind
  the "Passbook" script, which crosses the rim — and punching out the monogram and the
  lettering with it. That is invisible on a light page, because a transparent hole shows
  the page and the page is the same near-white the artwork's background was; it only
  showed up in dark mode, where the mark became an empty box. So there were two bugs,
  not one: the cutout ate 21,000 pixels of artwork, and the surviving tones are all dark,
  so the mark is invisible on the dark surface as drawn. `tools/make-icons.ps1` now
  restores the circle from the original pixels (`RestoreDisc`), found from the surviving
  ink rather than hardcoded geometry, and **refuses to write a mark whose circle does not
  come back filled**; `base.css` inverts the mark in dark mode, which works *because* the
  monogram is a knockout in the disc. `smoke-shell.mjs` decodes the PNG and counts pixels
  — ~22,000 opaque near-white ones intact, ~800 hollowed out — because a size check and a
  "not blank" check both pass on the broken file. The generalisable part: **a mark that
  is correct on a light background can be broken in a way only a dark background shows**,
  and rendering it over magenta is what makes it obvious.
- ✅ **The department matrix is populated.** The owner's mapping lives in
  `SEED_GRANTS`; `seedDepartments()` upserts it and reports `created` / `updated` /
  `unchanged` / and a **`dropped`** list, and `seedMemberships()` adds the
  person↔department edges while never removing one. **Triage** is a new, second,
  independent axis — CR and Management triage without editing any section.
- ✅ **The lesson this migration taught, worth generalising:** *a store with no
  transactions makes the read part of the critical section.* `withRowLock` used to
  guard only the write; it now guards the read, and every read inside it bypasses the
  per-execution memo. The second half of the same lesson: *a read that cannot tell
  "absent" from "unreadable" is a data-loss bug* — `readJson` returns `null` only for a
  genuinely missing file and throws otherwise, because the convenient version destroys
  the store it was meant to protect.
- ✅ **The ticket-list card is rendered safely.** It was interpolating the public
  customer Form's serial field and the ACL-exempt `__IRS__` status straight into
  `innerHTML`, with an unescaped quote in the `onclick` — enough for an
  unauthenticated attacker to lift an admin's session token from `localStorage`.
  `escJsAttr()` + `safeUrl()` now cover the JS and URL contexts, and the whole card is
  asserted against real rendered output.
- ✅ **Admin-provisioned accounts** — no self-signup; forced password change on first sign-in; forgot-password by email; **two-step sign-in** with a 6-digit emailed code that is issued once and reused for the working day; an **8h30m absolute** session; admin bulk provisioning with a copyable credentials txt (see [10](10 - Auth & Access Model.md))
- ✅ **Two-level access from departments** — view+comment for everyone, edit from the department↔section matrix, admin bypass
- ✅ **The repeated sign-in prompts in User Access** — the real cause was a 90s poll re-arming the ejector after every wipe, plus a Reconnect button that called `signOut()`
- ✅ **The irreversible account purge is two-step** — review the list, copy it, then
  delete; the backend plans before it deletes, refuses if the list changed since the
  review, runs under the script lock, and writes a `backups/purge-users-<ts>.json`
  snapshot **before** the first destructive write. A response is not a backup: the old
  copy promised the rows were "shown below first" while the code deleted them before
  responding.
- ✅ **Audit trail / history for section edits** — `_store/audit/IR409.jsonl` + the 🕓 History modal
- ✅ **Auto-calculation for the Section D repair table** — Cost = Qty × Rate, live Total Repair Cost
- ✅ **Viewing uploaded files** — the `imageEvidence` control previews saved Drive images and links PDFs, with captions
- ✅ **App-owned status, assignee, priority and category** — no longer read back from the Sheet (Stage 1)
- ✅ **The Sheet gap** — every ingested column is now visible on the ticket, including the raise time and the three unmodelled columns (Stage 2)
