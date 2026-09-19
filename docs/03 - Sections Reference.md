# 03 — Sections Reference

All **6** passbook sections, **B–G**, defined in the `SECTIONS` object in `app.js`.
This was nine sections (`sec-a`…`sec-i`) until the restructure: old Section A became
the **Overview panel**, and two pairs merged — QC + Flight Test into one **Quality
Test Report**, PDI + Dispatch into one **PDI Report/Dispatch Record**.

Two tabs are not sections:

- **📋 Report** — the read-only view of the client's original Google Form
  submission. No fields, no save button, no entry in `SECTIONS`. Documented in
  [06 — UI Components & Styling](06 - UI Components & Styling.md).
- **The Overview panel** — Section A's content, pinned above the tab strip rather
  than behind a tab. See below.

### Draft auto-preservation (all sections)
Any edit within a section is auto-persisted to `localStorage` as a draft keyed
`ipb_draft_<irNumber>_<sectionId>` (debounced on `input`, immediate on `change`).
On reopening an IR, after saved data loads, drafts are restored on top and a
banner ("You have unsaved entries restored…") offers **Discard restored drafts**.
A draft is cleared only on a successful Save (or via Discard). E-signatures are
included in the draft, so signing survives even if the section isn't saved
(signing also triggers an immediate draft write). Files/photos are not persisted
in the draft and must be re-attached.

---

## Comments / Tag system (app-wide)
Any signed-in user can **@-tag a teammate** to remind or assign them, at three
levels, available everywhere in the app. (Internally the data model is still
called "nudges" — the user-facing name is "Comments".)

- **Per IR** — `💬 Comments` button in the IR banner (scope `ir`).
- **Per section** — a `💬` button injected after each section title (scope `section`).
- **Per field** — a `💬` button on every field label (scope `field`, Sheets-like cell comments).

Each section/field `💬` button shows a small **count badge** of the comments sitting on
it — red when one is unread and addressed to the signed-in user — so comments "reflect
over that section" without opening the modal (Google-Workspace anchored-comment style).
The badge updates on load, on poll (~90 s), and after each comment is posted/read.

### Composing a comment
The Comments modal shows the existing thread for that context plus a composer:
- **Tag someone (@)** — type `@` or a few letters of a name/email; matching
  entries from the **Team Directory** appear as suggestions. **Keyboard-friendly:**
  ↑/↓ to move the highlight, **Enter** to select, **Esc** to close. A full email
  can also be typed directly.
- **Message** — free text.
- **💬 Comment** — a **single button** that posts the comment in-app **and** relays the
  email notification automatically via the Apps Script backend (`MailApp.sendEmail`) —
  zero operator clicks, no in-app/email choice, and **no mail client ever opens**
  (Google-Workspace style). If the backend is unreachable the comment is still saved
  in-app and a non-intrusive toast explains the email is pending — it never falls back
  to a `mailto:` popup. Email starts working the moment `sendNudgeEmail` is deployed
  + authorised.

### Delivery
- **In-app 🔔 bell** in the header shows a badge with the unread count of comments
  addressed to (or mentioning) the signed-in user. Opening the bell lists them
  (newest first) with an **Open IR** action and marks them read. (There is no manual
  "send email" button — email is always automatic on comment creation.)
- The bell polls the backend every ~90 s and refreshes on open.

### Backend (`backend.gs`) — comment email
The `sendNudgeEmail` POST action (name kept for contract stability) sends via
`MailApp.sendEmail`, restricted to `@indrones.com` recipients plus the explicit
`EXTERNAL_EMAILS` exceptions (so the app can't be used to mail externally) —
`isMailRecipientAllowed()` is that guard, and `kishor.salunkhe@uavgarage.com` is the
one address it admits. The sender's email is set as `replyTo`. Email
subject/body read "you have a comment" / "mentioned you in a comment"
(no "nudge" wording). **Requires redeploying** the Apps Script web app after
adding this action (and completing the one-time `script.send_mail` OAuth consent —
see Development Guide). It checks `mailQuotaOk('nudge')` before sending and reports
a visible error if the day's mail is spent, rather than failing silently — see
[04](04 - Backend API Reference.md).

### Storage (no backend redeploy required)
Comments are stored via the existing generic `saveSection` / `getPassbook`
endpoints under a special irNumber `__NUDGES__` / sectionId `all`, field
`items` = array of:
```
{ id, irNumber, scope, sectionId?, fieldId?, sectionLabel?, fieldLabel?,
  to, from, fromName, message, mentions[], createdAt, readBy[] }
```

Adding a comment does a fresh fetch → append → save to reduce lost writes; the save
holds the script lock, so a concurrent append is refused rather than silently lost.
All comments live under one key (`all`) of `_store/comments.json`, so the list is
bounded by how much the backend is willing to rewrite on every post — the cell limit
that used to cap this is gone, but a whole-file rewrite is the new cost, so archive
past a few hundred comments if it ever grows.

### Team Directory (admin-editable)
`TEAM_DIRECTORY_DEFAULTS` seeds the @-mention suggestions; admins
(`ADMIN_EMAILS` + dev) edit it via **⚙ Directory** in the bell panel. Overrides
persist to GAS under irNumber `__CONFIG__` / sectionId `team-directory`
(field `entries`) and to `localStorage` (`ipb_team_directory`).
`loadTeamDirectory()` runs at app start.

## Audit trail / Edit history (app-wide)
Every section save records the **date of the event** and captures any
**overwrite** (correction) so events are traceable back later — the "date of events"
requirement. Backend (`backend.gs`, requires redeploy):

- `saveSection` appends to **`_store/audit/IR409.jsonl`** — one Drive file per ticket,
  one JSON object per line, short-keyed:
  `{ t, ir, sec, by, ev, fid, old, nw }` — i.e. Timestamp, IR Number, Section ID,
  Saved By, Event, Field ID, Old Value, New Value.
- Events: `saved` (one marker per **human** section save), `added` / `changed` /
  `removed` (one line per field), `uploaded` (one line per uploaded file, with the
  file name in New Value) — so uploads are traceable too, which they were not before.
- **`reverted`** is the sixth, appended by `restoreField` when an earlier value is put
  back. It is deliberately **not** `restored`: that value already means *"this
  ticket's folder came back out of the Drive archive"* (`archiveAuditLine`), and one
  word for two events is how a reader ends up unable to tell a folder move from a value
  being put back. `old` is the value being **replaced** and `nw` is the value **put
  back**, so *Was / Now* reads the same as on a `changed` row. See
  [`restoreField`](04%20-%20Backend%20API%20Reference.md#restorefield).
- Three suppressions keep the log readable, each for a stated reason: derived
  Drive-link keys (`*_links`) and the `done` completion array are never diffed (a
  500-character JSON diff of `done` would drown the real edits on every save), and
  the bare `saved` marker is not written for a `__`-sentinel write — every section
  save also fires `patchIRState`, so without that guard each save produced two marker
  lines, one of them contentless.
- **The audit append happens AFTER the data write, inside the same lock.** It used to
  be the other way round, so a failed save left an audit line for a save that never
  happened.
- The **`__NUDGES__` store is not audited at all.** Comment items already carry
  their own author and timestamp, which is strictly better information than a line
  holding a truncated copy of the whole array, and they were dominating the log.
- A sentinel write is filed under the ticket it is **about**: `__IRS__`/IR409 goes to
  `IR409.jsonl`, while `__CONFIG__` / `__NUDGES__` / `__KB__` have no ticket and get
  `CONFIG.jsonl` / `NUDGES.jsonl` / `KB.jsonl`. So two people on different tickets
  never touch the same audit file.
- `getAuditLog(irNumber, limit, fieldId)` GET action returns the trail for one IR,
  oldest first, capped at 400 entries. `fieldId` is optional and filters to one
  field's lines — applied **before** the cap, so the cap bounds that field's history
  rather than the ticket's. Filtering afterwards would hand back the tail of the
  ticket's newest 400 lines that happen to be about that field, so a field's older
  changes would fall outside the window and its "history" would silently be a recent
  sample. It reads that ticket's file and matches **two** line shapes: an ordinary
  section line (whose `ir` is the IR) and a workflow line (whose `sec` is
  the IR and whose `ir` is the `__IRS__` store name) — which is what lets triage
  changes appear in the same timeline as saves with no second store. A workflow line
  is reported with the **real** IR in `irNumber`, so a consumer filtering on it cannot
  silently drop every status change.
- `_store/audit/` has **no automatic cap, rotation or delete path**. The 400 cap
  bounds the *response*, not the read. Pruning is a manual lever:
  `maintenancePruneAuditLog()` (retains `AUDIT_RETENTION_DAYS`, default 400 days),
  deliberately manual because the audit trail is evidence and must not shrink behind
  anyone's back. **A ticket's history is kept for exactly as long as the ticket is** —
  the owner's rule (*"Till that IR is completely closed and archived … Till IR records
  are being kept in drive, so the history"*). The age rule is per **subject**, so
  without a guard an entry could go while its ticket was wide open, which the function's
  own comment admitted. It now decides liveness from the IR store (`__IRS__`) **and**
  `sections/index.json` — the same two the archive sweep reads, so the two cannot
  disagree about whether an IR is live — and **skips a per-ticket subject entirely**
  while that IR exists, before the file is even read. Sentinel subjects (`signins`,
  `config`, `nudges`, `kb`) keep the old behaviour. The returned message says how many
  ticket files it left untouched and why, rather than silently pruning fewer lines.
  A line whose timestamp cannot be parsed is **kept**, never guessed at.

Frontend: the IR banner **🕓 History** button opens a modal listing the trail newest
first, showing who saved, the event, the field, and old→new values. It and the
Overview's timeline are the **same** renderer over the same pure
`buildTimeline(...)` — see below. Until the backend is redeployed it shows "No
history yet".

### One field's history, and putting a value back
Every **field's** label also carries a small 🕓 button (`buildField`, and the two
Overview-editable fields). It opens the **same** modal, filtered to that one field:
one modal, one look, two entry points. The button is a **read**, so it survives the
view-only sweep, exactly as exporting a section does — a view-only user may see what
changed and who changed it.

The field's own 🕓 derives its section rather than being passed one
(`fieldSectionFor`), and the Overview's two hand-rendered fields fall back to
`OVERVIEW_KEY` — the same pairing the backend's `canEdit()` makes, because
`getEffectiveAccess` folds Triage into `permissions['sec-a']`. `fieldLabelFor` gained
a two-entry fallback so `a_crmOwner` and `a_contactPhone` read as words rather than as
raw ids; they are **not** in `SECTIONS`, so it used to fall back to the id.

Where a row can reproduce a value **in full**, the modal offers **Put back**. Three
answers, not two (`restoreOfferFor`): *not a candidate* renders nothing at all, *a
candidate that cannot be put back* renders the reason, and *offered* renders the
button. The rules:

| Row | Offered? |
|---|---|
| `changed` / `removed` / a previous `reverted` | **yes** — the old value is complete |
| `added` | **no** — its old value is `''` by construction, so "put back" could only mean "clear this field" |
| `uploaded` | **no** — only the file name is recorded; the Drive URL is deliberately not stored and is not re-derivable |
| any value over **500** characters | **no** — see the truncation rule below |
| every Triage kind (`status`, `assign`, `priority`, `category`, …) | **no** — the IR header lives in a different store under a different key shape, governed by the separate Triage axis. Out of scope **by construction**, not by an extra rule that could be forgotten |
| a whole-section `saved` marker, a comment, an archive move | **no** — not a field value at all |

**The truncation rule is the one that cannot be argued with.** `snapValue` caps every
audited value at 500 characters plus a trailing `…`, silently and irreversibly — the
full value is kept **nowhere else**. Writing that prefix back would corrupt the field
with no error and nothing to compare against. `snapValue` can only emit ≤500
characters or exactly 501, so `value.length > 500` **proves** truncation. It is
checked in the frontend (so the button is never offered) **and** in the backend (so a
crafted request cannot write it); the two are not redundant.

**The restore is gated twice, and both gates are needed.** The modal is created with
`document.createElement` and appended to `document.body`, so it is **outside every
section pane** and `applySectionAccessGating`'s disable sweep never reaches it. A
control mounted outside a pane cannot inherit the pane's gate — that is exactly how
the add-row and add-evidence buttons stayed live on a view-only screen. So the modal
decides `mayRestore` from `canEditSection(sectionId)` and draws **no** restore control
without it (saying so in the blurb rather than leaving a silent gap), and the click
handler checks the same predicate again before it writes anything. The backend
enforces the same rule with the same predicate. A view-only user therefore sees the
whole history and no button: offering one that refuses on click is the "hovers like a
live control and does nothing" failure this app has already been bitten by twice.

A successful restore re-reads the ticket rather than patching the screen locally — the
store is the truth, and the audit has a new row the history must show — then reopens
the field's history so the change is visible where it was made. Both the bell notice
and the admin email happen **after** the write's lock is released, so a failure in
either is reported in words ("saved, but the admin email was not sent") and never
fails a restore that already committed.

---

## The Overview panel (what was Section A)
**Data key:** `sec-a` — **not a section**

The Overview is **not a section**. It has no letter, no tab, no pane, and no entry
in `SECTION_IDS` or `SECTIONS`. It is a panel pinned above the tab strip, so it is
always visible, and it is always one click from a save.

**Why it kept the id `sec-a`.** Renaming the data key would have forced a second
migration for no user-visible gain. Keeping it preserves at zero cost the existing
`a_crmOwner`/`a_contactPhone` values in the ticket's own store file, the drafts keyed
`ipb_draft_<ir>_sec-a`, the `a_*` → `sec-a` field resolution, the backend's
locked-intake strip, and the meaning of existing audit lines. No UI ever shows
the letter "A".

Three structural properties, each load-bearing:

1. **`id="ir-overview"`, not `sec-…`** — the test regexes that enumerate panes match
   `<div id="(sec-[a-z]+)" class="section-content`. An `ir-` prefix makes it
   impossible to miscount as a section.
2. **Not `class="section-content"`** — the tab handler removes `active` from every
   `.section-content` and re-adds it only to the clicked pane, so a panel carrying
   that class would be hidden forever on the first tab click.
3. **Outside `#sections-wrapper`** — the wrapper's delegated `input`/`change`
   listeners drive `saveDraft`. Being outside excludes the Overview from drafting
   structurally. That is intended, not an oversight: it is always visible and one
   click from a save, so a draft adds nothing.

### What it shows, in order

| Block | Content |
|---|---|
| Fact strip | IR number, drone serial, date raised, company, respondent, issue type — read-only, plus a `Full report →` link that activates the 📋 Report tab |
| Editable | `a_crmOwner`, `a_contactPhone` only |
| Timeline | the automated activity timeline (see below) |
| Legacy log | `a_activityLog`, read-only, labelled `Legacy` |

The two long textareas (`a_issueDesc`, `a_incidentLocationWeather`) are **not**
pinned here: ten fields above the tabs would push the strip a screen down on a
phone, and they already sit immediately left in the same strip, on the Report tab.

### Saving
`saveOverview()` mirrors `saveSection` minus files and drafts, posting
`sectionId: 'sec-a'` with `fields: { a_crmOwner, a_contactPhone }`. It reuses the
**existing** `saveSection` action rather than adding one, so there is one ACL
branch, one upsert, and one audit path.

The **locked-key guard in `saveSection` is unchanged** and still strips the ten
customer-form keys from any `sec-a` payload, so the Overview cannot write a second,
divergent copy of the intake facts. That guard is why the panel is safe to make
writable at all.

### Authorization — Triage, not a department
Editing the Overview is gated on the **`Triage`** flag, not on department grants —
"who owns the ticket header" is one question, and CR held `sec-a` edit before. A
department may triage while editing no section at all; that is exactly what CR and
Management get. See [10 — Auth & Access Model](10 - Auth & Access Model.md).

`getEffectiveAccess` sets `perms['sec-a']` to `'view'` for everyone and raises it to
`'edit'` when triage is held, so the existing `canEdit` seam disables the two inputs
for everyone else. The backend is the authority: the save is rejected without it.

> **The bug this design would have shipped.** `getPassbook` drops any row the caller
> cannot view, and it filtered on a permission map built from `SECTION_KEYS`. Once
> `sec-a` left that list, **no** permission map had the key — so the Overview's data
> (including the legacy log) would have been dropped for all 18 non-admin users and
> kept only for the admin, and it would have looked perfectly fine to whoever tested
> it, because the tester is the admin. `getPassbook` now names `OVERVIEW_KEY`
> explicitly.

### Field table

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `a_irNumber` | IR Number | text | 🔒 Locked intake — from Col B |
| `a_droneId` | Drone Serial No. | text | 🔒 Locked intake — from Col K |
| `a_dateRaised` | Date of Incident | date | 🔒 Locked intake — from **Col I "Date of Incident"**. ⚠️ The label says *Incident*, not *raised*: the Sheet's raise timestamp is Col C |
| `a_companyName` | Company Name | text | 🔒 Locked intake — from Col R |
| `a_customerName` | Respondant Name | text | 🔒 Locked intake — the name portion of Col L |
| `a_contactEmail` | Respondant Email | email | 🔒 Locked intake — from Col P |
| `a_issueType` | What Support Is Required? | text | 🔒 Locked intake — from Col G |
| `a_issueDesc` | Issue Description | textarea | 🔒 Locked intake — from Col H. Report tab only |
| `a_incidentLocationWeather` | Incident Location and Weather | textarea | 🔒 Locked intake — from Col M. Report tab only |
| `a_evidence` | Evidence (from customer form) | readonlyLinks | 🔒 Locked intake — Cols N and Q as links |
| `a_crmOwner` | Customer Relations Manager | text | **Editable** — who here owns the client relationship |
| `a_contactPhone` | Customer Phone | tel | **Editable** — seeded from the phone portion of Col L |
| `a_activityLog` | Activity Log (Timeline) | activityTable | **Read-only legacy.** Rendered in the Overview with `<span>`s instead of inputs, labelled `Legacy`. Nothing writes it any more |
| `a_overallStatus` | IR Status | select | **Legacy.** Status now lives in `__IRS__` and is edited through Triage; this is the Sheet-sourced seed value |

The hand-written activity log is deliberately **not** merged into the timeline:
synthesising entries from it would invent timestamps the data does not have. It stays
a separate, labelled block.

### Auto-Population from the IR Repository
Locked intake fields are pre-filled from the IDS/CR/007 sheet's **"Form
Responses"** tab when an IR is opened:

| Overview field (`sec-a` data key) | Form Responses Column | Config Key |
|---|---|---|
| `a_irNumber` | Col B — IR Number | `IR_REPO_IR_COL` |
| `a_droneId` | Col K — Mention the Drone Serial No (S250XX) | `IR_REPO_ID_COL` |
| `a_dateRaised` | Col I — Date of Incident | `IR_REPO_INCIDENT_COL` |
| `a_companyName` | Col R — Where Do You Work? | `IR_REPO_COMPANY_COL` |
| `a_customerName` | Col L — Who's Reporting? (name portion) | `IR_REPO_REPORTER_COL` |
| `a_contactEmail` | Col P — Email Address | `IR_REPO_EMAIL_COL` |
| `a_issueType` | Col G — What Support Is Required? | `IR_REPO_SUPPORT_COL` |
| `a_issueDesc` | Col H — Please Describe Your Problem... | `IR_REPO_DESC_COL` |
| `a_incidentLocationWeather` | Col M — Incident Location and Weather | `IR_REPO_INCIDENT_LOC_COL` |
| `a_evidence` | Cols N and Q — Evidence links | `IR_REPO_EVIDENCE_N_COL` / `_Q_COL` |
| `a_overallStatus` | Col D — Issue Status | `IR_REPO_STATUS_COL` |
| `a_crmOwner` | Col F — SPOC (seed only; editable after) | `IR_REPO_SPOC_COL` |

### The automated timeline
Every activity in an IR is recorded for context, from four sources, so nobody has to
maintain it by hand:

| Source | Condition | Kind |
|---|---|---|
| audit, section | `saved` with no field | `save` |
| audit, section | `added` / `changed` / `removed` | `add` / `edit` / `remove` |
| audit, section | event `reverted` — an earlier value put back | `revert` (its own kind, so a restore is visibly distinct from the edit it undid — a reader asking "why is this the old value again?" is looking for exactly one row, and folding it into `edit` hides it among the edits) |
| audit, workflow | `status` / `assignee`,`assigneeName` / `priority` / `type` | `status` / `assign` / `priority` / `type` |
| audit, either | event `uploaded` | `upload` |
| audit, either | event `archived` / `restored` | `archived` / `restored` (branched on the **event**, not on `fid` — these carry no field, and chipping a folder move "Triage" would put a word on the row that no button in the app uses for it) |
| comment | a `__NUDGES__` item for this IR | `comment` (chip `@mention` when it carries mentions) |

`done[]` deltas are suppressed: completion is already implied by the section save
that caused them, and each one is a 500-character JSON array. The pure
`buildTimeline(irNumber, auditEntries, nudgeItems, limit)` is shared by the Overview
(`limit: 40`) and the 🕓 History modal (`limit: 400`) — the ticket-level one and the
per-field one both — so the two can never disagree. The timestamps are
`dd-MMM-yyyy HH:mm:ss`, which is **not** ISO 8601, so they are parsed by an explicit
month-table parser rather than by `Date.parse`.

The renderer takes one optional `restore` context, and **only** the field-history
modal supplies it (and only when the viewer may edit there). The ticket-level modal
and the Overview's inline timeline mix every field together and have no single field
to write into, so they render no restore control at all rather than a dead one. The
button carries an **index** into the caller's own oldest-first timeline — never the
value itself, because that is up to 500 characters and would have to be escaped into
an attribute — and the list is rendered newest-first, so the index and the display
order are deliberately different things.

---

## Section B — Inward Checklist (Inventory)
**ID:** `sec-b`

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `b_inwardDate` | Inward Date | date | |
| `b_inwardBy` | Inward By (Name) | text | Person who performed the inward |
| `b_stNo` | Stock Transfer (ST) No. | text | Assigned by Inventory |
| `b_inwardTable` | Particulars Received | inwardTable | 11-row table: Particular, Model/Value (dropdown or free text), Qty |
| `b_inwardPhotos` | Inward Photos (Image or PDF) | imageEvidence | 📷 Capture photo / + Add image / PDF |
| `b_remarks` | Remarks | textarea | |

### Particulars table (`b_inwardTable`)
Saved as an object keyed by particular name: `{ "Air Vehicle": { model, qty, remark }, ... }`.
Each row has Model/Value, Qty, and a per-row Remark (an overall `b_remarks`
textarea is also at the bottom). 11 particulars from the IDS master Inward Checklist:

| # | Particular | Input | Option group |
|---|---|---|---|
| 1 | Air Vehicle | dropdown | `airframe` |
| 2 | Battery | dropdown | `battery` |
| 3 | Charger | dropdown | `charger` |
| 4 | Radio Controller | dropdown | `rc` |
| 5 | Payload | dropdown | `payload` |
| 6 | Propeller | dropdown | `airframe` |
| 7 | Base | dropdown | `base` |
| 8 | Bag With Foam | dropdown | `airframe` |
| 9 | Tripod/Bipod | free text | — |
| 10 | Center Pole | free text | — |
| 11 | Toolkit-Box And Accessories | free text | — |

### Dropdown option groups (admin-customizable)
Defaults defined in `INWARD_OPTIONS_DEFAULTS` (`app.js`); admins
(`ADMIN_EMAILS` — currently just `monish.raza@indrones.com`) edit them via the
**⚙ Manage Dropdown Options** button shown on the inward table. Overrides persist
to GAS under irNumber `__CONFIG__` / sectionId `inward-options` (shared) and to
`localStorage` (per-device fallback). `loadInwardOptions()` runs at app start.

| Group | Used by | Default options |
|---|---|---|
| `airframe` | Air Vehicle, Propeller, Bag With Foam | Sigma 25 Geo (S25G), Sigma 25 Pro (S25P), Sigma 75 (S75), Sigma 100 (S100), Fujin, Fighter, Talon, Striver, DID NOT COME |
| `battery` | Battery | 4S3P, 6S3P, 6S2P, 4S4P, LiPo 22000 mAh, LiPo 16000 mAh, 6S4P, DID NOT COME |
| `charger` | Charger | D2, Ultra Power, Hota, Sky RC, ISDT K2, DID NOT COME |
| `rc` | Radio Controller | Skydroid T12, Siyi MK15, Siyi MK32, DID NOT COME |
| `payload` | Payload | ADTI 24 mp, View Pro A609, Siyi A8 Mini, Share 5 Angle, Sony A6000, DID NOT COME |
| `base` | Base | Emlid RS2, Spectra SP85, Spectra SP60, DID NOT COME |

### A note on digital signatures
Every section used to carry `esignature` fields (`b_signInward`, `b_signInventory`,
`c_signIqc`, `d_signQcManager`, `d_signPurchaseManager`, `e_signProduction`,
`f_signQc`, `g_signPilot`, `h_signPdi`), auto-stamped with the signed-in user on every
save. **The provision for digital signatures was withdrawn, so the whole feature was
removed** — the fields, the renderer, `esignatureState`, `signSectionOnSave`, and the
`.esignature-*` CSS. Values already stored in `_store/` are left alone; they simply
stop being rendered, and `store[sectionId] = fields` drops each key the next time that
section is saved.

**Exporting a section** replaces what D's old PDF download did, and is available on
every section — see [Per-section export](#per-section-export-download--download-and-share).

---

## Section C — IQC Visual Inspection
**ID:** `sec-c`

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `c_iqcDate` | Inspection Date | date | |
| `c_iqcBy` | Inspected By | text | IQC inspector name |
| `c_iqcTable` | Visual Inspection Checklist | iqcTable | Zone rows: Result (PASS/FAIL/NA) + per-row Remark |
| `c_iqcPhotos` | Inspection Photos (Image or PDF) | imageEvidence | 📷 Capture photo / + Add image / PDF |
| `c_remarks` | Remarks | textarea | Overall remarks at the bottom |

> The `c_evidenceLink` field ("Link to Evidence (Photo / Video) Folder") was **removed**.
> Evidence is attached with `c_iqcPhotos` instead, so it travels inside the section's
> exported PDF rather than pointing at a folder someone has to open separately.

### Visual inspection checklist (`c_iqcTable`)
Saved as an object keyed by zone id: `{ "A1": { result, remark }, "D5I": { result, remark, name, checks }, ... }`.
Editable placeholder rows also store the inspector-entered `name` and `checks`.

Inspection zones (`IQC_ZONES` in `app.js`), grouped A–E:

| Group | Zone id | Code | Item | Visual checks |
|---|---|---|---|---|
| A — Airframe | A1 | A.1. | All Four Arms | Cracks, Bends, Deformations, Loose Arms and Damage To Holes |
|  | A2 | A.2. | Air Vehicle Body | Damage, Crack, Scratch, Missing/Loose Screws, Loose Objects Inside |
|  | A3 | A.3. | Landing Gears/Legs | Damage |
| B — Propulsion | B1 | B.1. | All The Propellers | Chipping, Damage, Self-Tightening Bolts Are Intact |
|  | B2 | B.2. | All 4 Prop-Mounts | Bend, Bolts Are Tightened, Scratch |
|  | B3 | B.3. | All Four Motors | Deposit Of Dirt, Debris, Sign Of Impact, Scratch, Free to Rotate |
| C — Battery And Charger | C1 | C.1. | All The Batteries | Case Damage, Scratch, Missing/Loose Bolt, Voltage Check (Balance/Imbalance) |
|  | C2 | C.2. | Battery Bay | Damage, Looseness, Battery Connectors |
|  | C3 | C.3. | Battery Charger | Power On Test, Damage, Scratch, Loose Objects Inside, Power Cable |
| D — Avionics And Sensors | D1 | D.1. | GPS | Damage, Scratch |
|  | D2 | D.2. | Antennas | Missing, Damage, Scratch |
|  | D3 | D.3. | Dampeners | Damage, Scratch |
|  | D4 | D.4. | Radio Controller | Damage, Scratch, Charging Port, Loose Objects Inside, Power On Test and Screen Test |
|  | D5a | D.5. | ODS | Damage, Scratch |
|  | D5b | D.5. | Sensor/Payload | Damage, Scratch, Loose Objects Inside, SD Card Availability, Payload Cable And Connectors Are Intact |
|  | D5I / D5II / D5III | D.5.I / II / III | _(editable)_ | Inspector fills item name + checks |
| E — Accessories | E1 | E.1. | Base With Bag | Damage, Scratch, Missing Part (Antenna, Charging Cable), Power On Test |
|  | E2 | E.2. | Tripod/BiPod, Center Pole | Damage, Missing Part |
|  | E3 | E.3. | Drone Bag With Foam | Damage |
|  | E4 / E5 | E.4 / E.5. | _(editable)_ | Inspector fills item name + checks |

Each check row has a **Result** dropdown (`PASS` / `FAIL` / `NA`) and a **Remark** field.
The bottom `c_remarks` textarea holds overall remarks. Photos and PDFs of the inspection
are attached with `c_iqcPhotos`.

### Admin customization (Section C)
Admins (`ADMIN_EMAILS` — `monish.raza@indrones.com`,
plus the `?dev=1` user for testing) see a **⚙ Manage Inspection Points & Dropdowns**
button under the IQC table. The modal edits:
- the **Result dropdown options** (one per line; defaults `PASS` / `FAIL` / `NA`),
- the **inspection points** themselves — each row's type (Header group / Check row /
  Editable blank), code, item/group name, and visual-checks text — with add/remove.

Changes persist to GAS under irNumber `__CONFIG__` / sectionId `iqc-config` (shared
across users) and to `localStorage` (per-device fallback); `loadIqcConfig()` runs at
app start and re-renders any open IQC table while preserving entered results/remarks.
Runtime state lives in `iqcZones` / `iqcResultOptions`; defaults are
`IQC_ZONES_DEFAULTS` / `IQC_RESULT_OPTIONS_DEFAULTS`. (Section B's inward options use
the same admin set — see `isAdmin()`.)

---

## Section D — Investigation
**ID:** `sec-d`

Section D is built in two parts, each signed off by a different role:
- **Part A — Investigation** (flight-data analysis) → signed off by the
  **Technical Support (QC Manager)**.
- **Part B — Cost Analysis** (repair estimate & lead time) → signed off by the
  **Purchase Manager**.

In the original I-PASSBOOK sheet the two signatures sit side-by-side; here they
are split — the QC Manager signature appears at the end of Part A and the
Purchase Manager signature at the end of Part B. The damage-report sub-section
from the sheet is deferred (later development).

### Part A — Investigation

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `d_partA` | Part A — Investigation | divider | Sub-section heading band (no value) |
| `d_analysisBy` | Analysis Performed By | text | Engineer / analyst name |
| `d_analysisDate` | Analysis Date | date | |
| `d_intro` | _(none)_ | analysisNote | Read-only dynamic line: "Dear customer, analysis of **IRXXX** for your system with ID **XXXXX** has been completed. Its findings are as below." — `IRXXX` → `currentIR.irNumber`, `XXXXX` → `currentIR.droneId` |
| `d_investigation` | Description of Investigation | textarea | |
| `d_evidence` | Investigation Evidence (Images) | imageEvidence | Image or PDF, with a name/context caption per file (see below); 📷 capture supported |
| `d_rootCause` | Root Cause | textarea | |
| `d_correctiveAction` | Corrective Action | textarea | |
| `d_preventiveAction` | Preventive Action | textarea | |

### Per-section export (Download / Download and share)
Every section B–G ends with a `.sec-export-row` holding two buttons:

| Button | id | What it does |
|---|---|---|
| ⬇ Download | `download-sec-<x>` | Builds the section as a real PDF **file** and downloads it |
| ⬇ Download and share | `share-sec-<x>` | Same file, handed to the device share sheet (`navigator.share`) |

The export replaces the old D-only **⬇ Download Investigation (PDF)**, which wrote HTML
into a popup and called the print dialog and so could never produce a file to attach.
Built with the vendored **pdf-lib** (`vendor/pdf-lib.min.js`), in three layers:

| Function | Job |
|---|---|
| `sectionPdfModel(sectionId, fieldValues, ir)` | **Pure.** Values → `{title, irNumber, droneId, blocks}`. Driven by `SECTIONS`, so a field added later exports with no new code |
| `collectExportMedia(sectionId, lib)` | Resolves each attachment to bytes: a photo becomes a JPEG at **1600px long edge, quality 0.82** (`fitLongEdge`); a PDF is merged into the report when its bytes can be read |
| `drawSectionPdf(model, media, lib)` | The only pdf-lib code. A4, 40pt margins, Helvetica |

- **Exporting reads the current form values, not the saved ones**, so unsaved edits are
  included. It never writes anything back.
- **Attached PDFs are merged into the report** whenever their bytes can be obtained —
  always for a file attached in this sitting. A PDF attached earlier is only a Drive URL,
  and reading it back depends on Drive's CORS headers; when that fails the user is told
  **before** the work starts, and the report names the document at the end rather than
  dropping it silently.
- **Any user may export.** A view-only user's pane disables every control, so the two
  buttons carry `.sec-export-btn` and are exempted from that gating — exporting is a read.
- Filenames are `IR409 - Section B.pdf`, sanitised against path separators and reserved
  characters.

### Image evidence (`imageEvidence` type)
Each entry is an image **or PDF** plus a free-text **Name / context** caption. This
control is shared by Section D and by the upload fields in Sections E / F / G / H / I.
Control state lives in `evidenceState[fieldId]` (reset on `openPassbook`):

```
evidenceState['d_evidence'] = [
  { caption, link, file, url, type, name },   // link = Drive URL ('' while pending);
  ...                                         // file/url = local File + object URL;
]                                             // type = 'image'|'pdf'; name = filename
```

- **Add:** `+ Add image / PDF` opens a picker (`accept="image/*,application/pdf"`,
  multiple). **📷 Capture photo** opens the device camera directly
  (`<input accept="image/*" capture="environment">` → back camera on phones).
  Each picked file is shown as a thumbnail (images) or a 📄 Open-PDF card (PDFs),
  with an editable caption and a ✕ remove button.
- **Preview:** saved Drive images render via `https://lh3.googleusercontent.com/d/{id}`
  (extracted from the Drive URL); local files use their object URL; PDFs link out.
- **Saved value** (`d_evidence` etc.) is an array `[{ caption, link, type, name }]` —
  captions + type/filename paired with the Drive URLs of already-uploaded files;
  pending (not-yet-uploaded) files have `link: ''`.
- **Upload:** on Save, only the pending files are sent as files (fieldId
  `d_evidence`); the backend uploads them to Drive and stores the new URLs in
  `d_evidence_links` (comma-separated, in upload order). Already-uploaded links
  are carried in `d_evidence` and re-sent on every save, so they survive re-saves.
- **Link merge:** because the backend overwrites `d_evidence_links` with only the
  newest uploads, newly-uploaded URLs are merged back into `evidenceState` from
  `d_evidence_links` — on load (`populateFieldValue`) and immediately after a
  successful save (`refreshEvidenceLinksAfterSave`) — so captions stay paired
  with their files and a later caption-only re-save persists the URLs in
  `d_evidence`.
- **Back-compat:** fields migrated from the old `file` type (Sections E/F/G/H/I
  uploads) had only `<fieldId>_links` with no entry array; on load those links
  seed one entry each so old uploads still preview.
- **Drafts:** captions + already-uploaded links are included in the draft (like
  other fields); the local image/PDF files themselves are not (consistent with the
  all-sections note that files/photos must be re-attached).

### Part B — Cost Analysis (Repair Estimate & Lead Time)

Mirrors Section D Part B of the I-PASSBOOK sheet — the repair/replace estimate
columns (Particulars / Qty / Rate / Cost / Remark), the warranty qualification
question, the lead time, and the Purchase Manager sign-off.

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `d_partB` | Part B — Cost Analysis (Repair Estimate & Lead Time) | divider | Sub-section heading band (no value) |
| `d_warrantyQualified` | Is This Repair Qualified For Cover Under Warranty? (Yes/No) | select | Options: _(blank)_, Yes, No. Label matches the Format worksheet row exactly |
| `d_repairTable` | Particulars For Repair / Replace | costTable | See the `costTable` type below |
| `d_leadTime` | Estimated Lead Time | text | e.g. "7–10 working days" |
| `d_goAhead` | Received Go Ahead By The Customer? | select | Options: _(blank)_, Yes, No. Customer approval of the estimate (Format tab row 55) |

> **Note on Part B field types:** the Format worksheet's Section D region uses
> heavy cell-merging, so Google's public CSV endpoint blanks out most of the
> merged cells (the warranty row text and the input types aren't readable via
> the link-shared feed). Field labels and order were confirmed from the cells
> that *are* visible — the repair-table header (row 47: Particulars/Qty/Rate/
> Cost/Remark at U/W/X/Y/Z), "Received Go Ahead By The Customer" (row 55), and
> the two signatures (row 60: Technical Support (QC Manager) at U, Purchase
> Manager at X). The warranty, lead-time and go-ahead **input types** (select
> Yes/No vs. text vs. date) were inferred — if the sheet uses a different
> control for any of these, tell me and I'll adjust.

### Cost estimate table (`costTable` type)
A repeatable repair/replace estimate table mirroring the sheet's Part B layout:

| Column | Behaviour |
|---|---|
| `#` | Read-only serial number (auto, re-numbered on row delete) |
| Particulars | Free text — the part / labour item |
| Qty | Number (≥0) |
| Rate | Number (≥0) — per-unit cost |
| Cost | **Auto** = Qty × Rate (read-only, recomputed on input) |
| Remark | Free text |
| ✕ | Remove row |

A **Total Repair Cost: ₹…** line sums Cost across all rows live. `+ Add Row`
appends a fresh row. **Saved value** is an array
`[{ particular, qty, rate, cost, remark }, ...]`; completely blank rows are
dropped on save. On load, saved rows are rebuilt (Cost re-computed); an empty
saved value re-seeds 3 blank rows so the operator always has inputs ready.

---

---

## Section E — Production (Rework)
**ID:** `sec-e`

| Field ID | Label | Type |
|---|---|---|
| `e_prodDocs` | Route Card / Job Card (Image or PDF) | imageEvidence |
| `e_prodRemarks` | Rework Details / Remarks | textarea |

Stripped to just the route/job card upload (shared `imageEvidence` — image **or** PDF,
preview + 📷 capture, see Section D "Image evidence") and a rework remark.

---

## Section F — Quality Test Report
**ID:** `sec-f` · was **QC (in-house/bench) + Flight Test**

All QC tests, in one place: an in-house/bench QC report **and** the flight test
reports. They always belonged to the same QA process — the split was a data-entry
convention, not a boundary.

| Field ID | Label | Type | From |
|---|---|---|---|
| `f_qcDocs` | QC Report (Image or PDF) | imageEvidence | old Section F |
| `f_qcRemarks` | QC Remarks | textarea | old Section F |
| `g_basicReport` | Flight Test Report (Image or PDF) | imageEvidence | old Section G — Basic **and** Mission, merged |
| `g_flightLogs` | Data Check — Flight Logs | checkpointEvidence | old Section G |
| `g_postProcessing` | Data Check — Post-Processing | checkpointEvidence | old Section G |
| `g_dataCheckRemarks` | Data Check Remarks | textarea | old Section G |

QC report upload (shared `imageEvidence`) and remarks; then **one** flight test report
upload — the Basic and Mission uploads were merged into `g_basicReport` — and two
**data-check checkpoints** (`checkpointEvidence`, see below), one for flight logs and one
for post-processing, each a tick the QC person marks "done" **plus** an image/PDF
attachment with preview, and a data-check remark.

> **The flight-test merge.** `g_basicReport` ("Basic Flight Test Report") and
> `g_missionReport` ("Mission Flight Test Report") are now **one** field, labelled
> **"Flight Test Report (Image or PDF)"**. The survivor keeps the id `g_basicReport` so
> its audit history and every anchored comment stay attached, and the retired field's
> saved uploads are folded into it when the section loads (`mergeFlightReportEntries`,
> deduped by link, else name, else caption). Nothing is written back, so no existing
> record is modified — the next ordinary save of the section simply drops the retired key.
>
> **The field ids were deliberately NOT renamed.** `sec-f` holds `f_*` **and** `g_*`
> ids, and `sec-g` (below) holds `h_*` **and** `i_*`. Field ids are also the anchors
> inside every `__NUDGES__` comment item (`n.fieldId`) and the `Field ID` of every
> historical audit line, so renaming them would orphan every comment anchored to one and
> split its audit history across two names.
>
> That wart is only survivable because a field id is resolved through
> `FIELD_SECTION_INDEX`, an index built from `SECTIONS` itself. Resolving it by
> prefix — the way this used to work — sends `g_basicReport` to `sec-g`, a section that
> does not declare it.

### Data-check checkpoint (`checkpointEvidence` type)
A composite field grouping a **done tick** + an **image/PDF attachment**:
- A checkbox (`<id>_done`) the QC person ticks to confirm the check is performed/verified.
- An `imageEvidence` attachment living under `<id>_attach` (preview + caption + 📷 capture).
- **Saved value:** `{ done: bool, attach: [{ caption, link, type, name }] }`. Pending
  attachment files are uploaded under the `<id>_attach` field id, so Drive links land in
  `<id>_attach_links` and are merged back on load / after save (same machinery as
  `imageEvidence`).

---

## Section G — PDI Report/Dispatch Record
**ID:** `sec-g` · was **PDI + Logistics & Dispatch**

The pre-delivery inspection and the dispatch record are two halves of one handover:
what was checked, then where it went.

| Field ID | Label | Type | Notes | From |
|---|---|---|---|---|
| `h_pdiDate` | PDI Date | date | | old Section H |
| `h_pdiBy` | PDI Inspector | text | | old Section H |
| `h_pdiDocs` | PDI Report (Image or PDF) | imageEvidence | upload + 📷 capture | old Section H |
| `h_pdiRemarks` | PDI Remarks | textarea | | old Section H |
| `h_pdiChecklist` | PDI Checklist | checklist | 8 items (see below) | old Section H |
| `h_dispatchChecklist` | Dispatch Checklist — verify same goods as received (Section B) | dispatchChecklist | dynamic, from Section B | old Section H |
| `h_pdiResult` | PDI Result | select | Pass – Ready to Dispatch / Fail – Return to QC | old Section H |
| `i_dispatchDate` | Dispatch Date | date | | old Section I |
| `i_dispatchBy` | Dispatched By | text | | old Section I |
| `i_courier` | Courier / Transporter | text | | old Section I |
| `i_awbNo` | AWB / Docket No. | text | | old Section I |
| `i_stNo` | Stock Transfer (ST) No. | text | | old Section I |
| `i_deliveryAddr` | Delivery Address | textarea | | old Section I |
| `i_estDelivery` | Expected Delivery Date | date | | old Section I |
| `i_dispatchPhotos` | Dispatch / Packing Photos (Image or PDF) | imageEvidence | | old Section I |

**Checklist items** (each has ✔ Received / ✘ Missing / ⚠ Damaged / N/A):
1. Physical Condition – OK
2. All Parts Present
3. Battery Fully Charged
4. Firmware Updated
5. Calibration Done
6. Accessories Packed
7. Documentation Included
8. Branding / Labels Intact

**Dispatch checklist (`dispatchChecklist` type).** Auto-built from the goods actually
received in Section B (`b_inwardTable`) — one row per received particular, each with a
dropdown: ✔ Dispatched (same qty) / ⚠ Short (less qty) / ✘ Missing / N/A. Ensures exactly
the same items received go back out. The list reads the live Section B table (then saved
data) and re-renders whenever Section B is edited or saved; prior selections are preserved.
Placed before the PDI e-signature. Saved as `{ [particular]: status }`.

> A "Delivery & Feedback" section was **planned, never built**, and is shelved for
> now — it is not part of the app. The old Section I here is the *Dispatch* half of
> the owner's Section G, not that planned section.

---

## Merged fields, Drive folders, and the one-column rewrite

### Where each merged field id lives

| Holds | Section | Field id prefixes | Why it is not a rename |
|---|---|---|---|
| `sec-f` | Quality Test Report | `f_*`, `g_*` | `g_*` ids are comment anchors and audit history |
| `sec-g` | PDI Report/Dispatch Record | `h_*`, `i_*` | same, and `h_dispatchChecklist` is read by the Section B table |

### Drive folders keep their historical names
A merged section keeps the folder of its **first-listed source**, so new uploads land
alongside the existing files instead of starting a second folder for the same
section:

| Section | Drive folder | Status |
|---|---|---|
| `sec-f` | `Section F - Quality Control` | live — both QC and Flight Test uploads land here |
| `sec-g` | `Section H - PDI` | live — both PDI and Dispatch uploads land here |
| — | `Section G - Flight Test` | historical — browsable, never written again |
| — | `Section I - Logistics Dispatch` | historical — browsable, never written again |

Renaming those two folders is a Drive-wide mutation that needs its own editor
function; it is an explicitly optional later step. Until then the folder names simply
no longer match the section letters — a wart, recorded in
[07 — Known Issues & TODO](07 - Known Issues & TODO.md).

### Completion markers were remapped in one pass
`done[]` holds completed section ids. Old ids were remapped **from the original
value in a single pass**, never as sequential replaces — `sec-h → sec-g → sec-f`
would *chain*, silently moving a historical Flight Test completion onto the wrong
section. `sec-a` was **dropped**: the Overview is not a completable section. The
frontend additionally filters `done[]` against `SECTION_IDS`, so a stale or
partially-migrated store cannot reintroduce a retired id.
| `i_remarks` | Logistics Remarks | textarea |