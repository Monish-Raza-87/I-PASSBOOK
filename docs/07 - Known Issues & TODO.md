# 07 — Known Issues & TODO

> **Status of the Drive-store migration (Sept 2026).** Every byte the app owns now
> lives in JSON files under `_store/` in the owner's Drive
> (`1itfTVbllh8Mi6TD6I2_OyYp_Wj4xrLIK`), and the backend touches exactly **two**
> Sheets — both as *inputs*: the client's `Form Responses` tab and the legacy
> workbook. **Both halves are now live (2026-09-19):** the frontend is on `gh-pages`
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
> **Status of the Frappe Helpdesk pivot.** Phase 1 (shell + design system) and Phase 2
> **Stages 1 and 2** are committed on `main` and live on `gh-pages` (`74c0298`) —
> app-owned workflow state (`__IRS__`) and the read-only 📋 Report tab. The dashboard
> went in early as the **Insights** page. **Stages 3 and 4 — the section completion
> count and the ageing clock with overdue flags — are built and green (2026-09-18) and
> are live on the frontend**: `gh-pages` publishes from `category-insights`, so the
> `eb522b5` deploy (cache v32) carries them. The **backend** for that branch is not
> deployed yet — see the owner step below. Stages 6–8 (canned responses, knowledge
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
- ⚠️ **The fixed-name store files are located by a Drive *search*.** `sections/IR*.json`
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
  refuses to read as "nobody is signed in" — but it is the one place a fork is still
  possible. The fix is the same pattern as sections: one index file holding their ids.
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

### Security
- ⚠️ **The pre-auth surface is open by necessity.** `ping`, `sessionCheck`, `login`, `changePassword`, `forgotPassword` and `resetPassword` must answer without a session, so the GAS URL being public is not itself the boundary — the **rate limits** are. `login`/`changePassword` share `attempts.json` (5 failures → 15-minute lockout); the two emailed-code paths share one issuer with a **3-codes/hour/email** budget counted across *both* purposes (so a password reset cannot buy extra sign-in codes), a 60-second resend gap, a **per-purpose** global hourly ceiling — **12 reset codes**, **120 sign-in codes**, the looser one justified because a sign-in code is only issued after a correct password — and every mail sits under one daily `MailApp` cap. Weakening any of those re-opens a guessing oracle.
- ⚠️ **A leaked sign-in code is useful for a whole working day.** The code is deliberately **reusable** (`consume=false`) so one mail covers every sign-in that day, which means a code read over someone's shoulder stays live until the shift ends — the same window as the session it mints. What bounds it is the shared attempt counter (5 wrong guesses burn it) and the password that must be presented alongside it. **The mitigation is now in place: every successful sign-in writes a line to `audit/signins.jsonl`** — the account, the time, what the browser claimed to be, and **how old the code was** when it was redeemed. That last field is the signal: a code issued and used within a minute is ordinary, one issued at 9am and redeemed at 4pm is the shape to look for. Read it with `reportRecentSignins(days)` from the editor (there is deliberately no screen for it). The record cannot refuse a sign-in — its write sits in its own `try`, and `smoke-store.mjs` proves a *throwing* audit write still returns a working session.
- ✅ **Data actions require a session** — `listIRs`, `getPassbook`, `saveSection` and every admin action call `requireAuth`, and the caller's email is read **from the token**, never from a request parameter (`saveSection`'s `savedBy` is the verified email, not the posted one), so the identity cannot be spoofed.
- ❌ **File uploads shared with anyone-with-link** — `ANYONE_WITH_LINK` sharing on all uploaded files. Deliberate: the link in a passbook has to keep working for a customer. `_store/` is the counterweight — it is `PRIVATE`/`NONE` and is a **sibling** of the upload folders, so hashes, salts and live session tokens are not readable through the Drive UI. That only holds while `_store/` is not link-shared; `initializeStore()` sets it, and re-sharing the folder by hand would undo it silently.
- ❌ **The IR list is read straight from a link-shared Sheet, bypassing the token gate.** Making the app the pane of glass does not close this; it only stops staff *needing* the Sheet. Moving the read behind the authenticated `listIRs` action is a separate, worthwhile change — and it is now a *small* one, because `listIRs` already joins `irs.json` for the app-owned status.
  - **Partially addressed (2026-09-20), and the exposure is unchanged.** The reported problem was the *wait*, not the exposure, and that is fixed: a device's last list is painted from `ipb_ir_list` before any network call, and an outage no longer overwrites a real list with sample IRs. But the planned second step — promoting `listIRs` to the primary read — was **deliberately not taken**, because `listIRs` returns no `intake`, no `extra` and no `dateRaisedISO` and does not split the name from the phone, unlike `mapSheetRows`. Promoting it would have silently emptied the 📋 Report tab's raw cells and made Insights treat every IR as undated. Closing this properly needs the two record shapes reconciled first; until then the direct Sheet read stays primary and `listIRs` stays the outage fallback.
- ⚠️ **Sentinel stores are world-readable and world-writable by any signed-in user.** `__`-prefixed irNumbers skip the per-section ACL check, so an **assignee is advisory, not access-controlled** — any signed-in user can reassign any ticket. Consistent with how comments and the team directory already behave, but "assignment" implies authority it does not have. `SENTINEL_SECTIONS` + `assertSentinelWritable()` bound *which* stores exist and what shape their keys take, so a caller can no longer invent a store — or aim a write at one that was never meant to be writable — but writes *within* an allowed store are still open to everyone, by design. (This is also why the department grants are **not** sentinels — see [10](10 - Auth & Access Model.md). If one ever were, it could be rewritten by the very people it restrains.)
- ⚠️ **Everyone signed in can view every section, including Section D and the Overview** — customer names, contact emails and root-cause analysis. This is a **deliberate owner decision**, not an oversight: *"Once anyone signin in, provide view access to everyone by default. its not about who."* Edit is what is controlled. If it ever needs re-tightening, the seam survives — `canView` still exists and `getPassbook`'s per-section filter is one line. The Overview is the one row that had to be **explicitly** exempted from that filter, because it is not in `SECTION_KEYS` — see the bug note in [10](10 - Auth & Access Model.md).
- ⚠️ **`sessionCheck` puts the token in a URL.** It is a GET probe (`?action=sessionCheck&sessionToken=…`) and GAS logs the URL, so a live token can appear in the Executions panel. Every other call posts it in a form body. Moving this one to a POST body is a worthwhile small change; it is not done.

### Functionality
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
- ⚠️ **The completion count is read from `done[]` and can only ever say 0–6.** It walks
  the six live `SECTION_IDS` and asks whether each was saved, so a store row holding a
  duplicate or a retired `sec-a`/`sec-h`/`sec-i` marker cannot render "7/6" or promise
  a tab nobody can open. A legacy-only record shows no chip *until* something is saved
  against it — "0/6" over a historic record would read as work outstanding.
- ⚠️ **The hand-typed activity log is read-only and will stay that way** — it is kept in the Overview as a labelled `Legacy` block so history is not lost, but nothing writes it any more. It is deliberately **not** folded into the generated timeline: it has no per-row timestamp, so merging it would mean inventing when things happened. The app's own record of activity is the timeline.
- ⚠️ **A stale service worker sees the new backend with the old shell for one load.** The deployed build carries the old nine-section shell, so a browser still holding it will request `sec-h`/`sec-i` (refused with a clear "reload the app" error, because `RETIRED_SECTION_IDS` names them) and can post `a_overallStatus` into the `sec-a` row, which nothing reads. Harmless, and the `CACHE_NAME` bump ends it on the next reload — but it is the residual cost of the frontend and backend cutting over together.
- ⚠️ **Three Sheet columns are unmodelled** — the Form writes columns E, J and O, for which no `IR_REPO_*_COL` constant exists. The 📋 Report tab surfaces them under "Other columns from the Sheet" rather than dropping them, and the app records which headers it did not recognise (`lastSheetAudit`). A new Form question is therefore visible, but appears in a catch-all block instead of a modelled field.
- ⚠️ **The live Sheet header row has never been verified directly** — reads from this dev environment return HTTP 401, so the header row is taken from `backend.gs`'s constants plus a test fixture. The mapper is self-auditing and matches by substring, which is why it was built that way; still, confirm against the real Sheet when convenient. This matters **more** now, not less: the Form Responses tab is one of only two Sheets the backend reads.

### UX
- ⚠️ **Emoji still live in the older in-panel chrome** — the app's *icons* are now one inline-SVG set (`ICON_PATHS` / `iconSvg`), and the chrome the owner walks daily is fully converted. What is left is emoji inside **prose and status text**, plus a handful of older in-panel buttons: the `⚠️` hints, the `✓`/`✘`/`⚠` option labels (`Received` / `Missing` / `Damaged`), the `📎`/`📷`/`📄` evidence affordances, and the User Access modal's `👥`/`💾`/`📋`. Converting those is a **separate pass** — the option labels are customer-facing strings and the evidence affordances are inside the upload flow. `smoke-ui.mjs` caps the count at **45 non-comment lines**, so it can only go down: a new emoji cannot be added without a test failing and somebody deciding about it. (45 is a correction, not growth — the older ledger of 29 scanned only the part of the file the suite happened to concatenate, and every emoji below that point was invisible to it.)
- ⚠️ **No loading state per section** — loading saved data is silent; user sees empty forms briefly
- ⚠️ **No error recovery** — if save fails, the retry button appears but doesn't auto-retry
- ⚠️ **File previews are image-only** — PDF uploads show no preview, only images get thumbnails
- ⚠️ **Checklist UX** — checklist items use dropdown selects instead of more intuitive checkbox UX
- ⚠️ **No confirmation dialog** — save button has no "are you sure?" for critical sections
- ⚠️ **Assignment emails read as comments** — `sendNudgeEmail`'s subject is hardcoded to the comment wording, so the notification an assignee receives says "you have a comment". Needs a redeploy to fix — and the redeploy that fixes it is the cutover.

### Technical Debt
- 🔧 **Large single-file frontend** — all logic in one `app.js` (~5,350 lines and growing); the CSS is split into four layered files (see [09](09 - Design System.md))
- 🔧 **No build pipeline** — no minification, no bundling, no tree-shaking
- 🔧 **No type safety** — vanilla JS, no TypeScript or JSDoc
- 🔧 **One-working-day sessions** — `localStorage`, **8h30m absolute** from sign-in, never slid forward on use, and no idle timeout inside that window. Deliberate: the daily sign-in is what the emailed code protects, and a session that slides forward on every request never expires for exactly the people who use the app most. It replaced a 30-day sliding session (see the security items above).
- 🔧 **One admin** — a bus factor of one. Adding another is a one-line `ADMIN_EMAILS` edit plus a GAS redeploy.
- 🔧 **The 90-second nudge poll is ~40 authenticated GETs/hour/user.** In the sheet version each one scanned the `SESSIONS`, `APP_DATA` and `__NUDGES__` tabs; now it is one memoised `sessions.json` read plus one `comments.json` read, which is strictly cheaper. `lookupSession` is a **pure read** — the absolute expiry removed the throttled slide write this path used to do — so the poll now adds no session writes at all, not merely few. The polling itself is a pre-existing concern and is not fixed here.
- 🔧 **`ACL` and `ACCESS_REQUESTS` tabs are frozen, not deleted.** Nothing has read them since 2026-09-17, when the store moved to Drive JSON. They are the only record of the old hand-assigned grants, so they wait 30 days — deletable from 2026-10-17 (see "Waiting on the owner").
- 🔧 **The audit has no automatic pruning, cap, rotation or delete path** — `_store/audit/` holds one append-only `.jsonl` file per subject: `IR409.jsonl` per ticket, plus `CONFIG.jsonl` / `NUDGES.jsonl` / `KB.jsonl` for the sentinel stores, whose writes belong to no ticket. There should not be an automatic bound: the audit trail is evidence. The lever is manual and locked — `maintenancePruneAuditLog()` (retains `AUDIT_RETENTION_DAYS`, default 400). The 400-entry cap in `getAuditLog` bounds the *response*.
  - The prune is **per-subject**, so it can delete history for a ticket that is still open. That is the sheet version's behaviour too — not a regression — and the audit cannot currently tell whether a ticket is closed, so a smarter rule is not available yet.
  - `getAuditLog`'s `truncated` flag is **off by one**: it reports `truncated` when there are exactly `cap` entries, so there is nothing hidden. Nothing in `app.js` reads it.
- 🔧 **`maintenancePruneAuditLog` reads and rewrites every audit file** it finds, under one lock. Each file is small (~40 KB for a busy ticket), so the whole sweep is bounded, but it is the one editor-run function whose cost grows with the number of tickets. Run it deliberately, not on a schedule nobody watches.
- 🔧 **Drive folder names no longer match the section letters.** A merged section keeps the folder of its **first-listed source**, so `sec-f` writes to `'Section F - Quality Control'` (which therefore also holds Flight Test uploads) and `sec-g` to `'Section H - PDI'` (also Dispatch). `'Section G - Flight Test'` and `'Section I - Logistics Dispatch'` are historical — browsable, never written again. Renaming them is a Drive-wide mutation needing its own editor function; deliberately left as an optional later step rather than bundled into a cutover.
- 🔧 **Merged sections hold two field-id prefixes** — `sec-f` declares `f_*` **and** `g_*`, `sec-g` declares `h_*` **and** `i_*`. This is not laziness: field ids are comment anchors (`n.fieldId` inside every comments item) *and* the `Field ID` of every historical audit row, so renaming `g_basicReport` → `f_basicReport` would orphan every anchored comment on it and split its audit history across two names. It is survivable only because field ids resolve through `FIELD_SECTION_INDEX`, built from `SECTIONS` itself — resolving by prefix, as the code used to, sends `g_basicReport` to a section that no longer exists.
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

`node tools/smoke-all.mjs` — **2184 cases across 16 suites**, all passing.
(2165 before the Google wait screen; 1954 before the field-report build; 1762 before the field-history/restore build;
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
| `smoke-list-intel.mjs` | **The two list stages that turn an absence into a number, which is exactly how they fail.** Stage 3: the completion count reads `done[]` against the six live ids, so a duplicate, an unknown id or a retired `sec-a` marker cannot push it past 6 or promise a tab nobody can open, a junk `done[]` counts 0 rather than `NaN`, and the fill arrives as a `p0`–`p6` **class**, never an inline style (the card's attribute set is pinned by `smoke-intake.mjs`). Stage 4: the clock is `statusAt` when the app recorded the change and the client's `dateRaisedISO` otherwise, **and the label says which** ("In status 6d" vs "Raised 21d ago"); the display-only `dateRaised` string and a JS `Date` string are both refused; a future timestamp reads 0 days, not negative; and with neither date there is **no clock at all** — no age chip and no overdue flag. Overdue is by priority (Urgent 1 / High 3 / Medium 7 / Low 14, the loosest for an unprioritised IR, matched case-insensitively, reached on the day itself), and **only an `open` ticket can be flagged** — a paused or delivered one is old, not late. Then the rendered card and header are asserted from real output: both carry the same count and age, exactly one `badge-danger` between a late and a fresh ticket, the tooltip names that ticket's own limit, a hostile priority cannot add an attribute through the tooltip path — and a legacy-only IR keeps its app-owned category, status, saved sections and clock instead of rendering as untouched |
| `smoke-intake.mjs` | The Sheet column map, the audit, degenerate/reordered input, and escaping — including **the ticket-list card rendered from two untrusted sources** (the public customer Form's serial field, and `__IRS__` status/priority, which any signed-in user can write). Asserts on real rendered output: no injected attribute, no attribute beyond the fixed set the renderer writes, and a `javascript:` link produces no anchor at all |
| `smoke-sections.mjs` | The six-section contract; every field id in every **merged** section resolves to its section id — `g_basicReport → sec-f`, `h_dispatchChecklist → sec-g`, `i_courier → sec-g`, the cases that fail without `FIELD_SECTION_INDEX`; the prefix fallback still works for an id in no form; the Overview's structural isolation; and that `saveDraft('sec-a')` writes nothing |
| `smoke-timeline.mjs` | Drives the **pure** `buildTimeline` in the `vm` harness — behaviour, not shape. Each event kind maps correctly; `done` deltas are suppressed; an `uploaded` row carries the file name with the **source** field id; comments merge in and other IRs are excluded; a `'dd-MMM-yyyy HH:mm:ss'` fixture parses (the `Date.parse` → `NaN` trap); mixed timestamps sort with the tiebreak; `limit` trims from the newest end; and no entry ever interpolates the literal `undefined` |
| `smoke-access.mjs` | View + comment for everyone, edit only from departments, admin bypass, the fallback **failing closed on writes**, and that the de-admined `customer.relations@` address is gone from `app.js` entirely. Also that `canTriage()` is a **separate axis**: a `sec-c` edit grant does not confer it, a CR user has `triage: true` with `canEditSection` false for all six, and `myAccess().triage === false` on the fallback |
| `smoke-session.mjs` | The token is in `localStorage` and survives a `sessionStorage` wipe; `clearLocalAuth` is the one teardown path and stops the poll; **the poll restarts after an in-page re-login**; the dead `forceReauth()` stays deleted; and **`confirmSessionAlive()` resolves true when fetch rejects** |
| `smoke-boot.mjs` | **Real headless Chrome**: the app boots via `?dev=1`, the Overview renders its facts/legacy log, the activity panel renders **below** the sections and **collapsed**, **every icon slot in the rendered page is filled**, and the full CSV → map → render chain reaches the DOM; a phase loads the **signed-out** login screen with the sign-up machinery absent from the DOM; and a final phase drives the sign-in **form** against a scripted backend — the reveal toggle masks, unmasks and re-masks the field with a real glyph and a switching label, step 1 shows the code step and stores **no** token, the code-step note names the address, a wrong code is refused with the attempt count and the right one signs in. It is also the only suite that would catch a `TypeError` from a shadowed function name — `renderBannerMeta`'s local `canTriage` had to be renamed `showTriage` for exactly that reason. Skips cleanly if no Chrome is installed |
| `smoke-ui.mjs` | **The digital-signature feature is gone, everywhere** — no `esignature` field survives in any section, no `signESignature`/`renderESignatureHTML`/`refreshESignature`/`signSectionOnSave`/`esignatureState` exists in the source, nothing renders `signedBy`/`signedAt`, the `.esignature-*` CSS is gone with it, and `saveSection` no longer stamps. Then, as behaviour: the activity panel's placement, collapsed default, class-not-inline `display` fold and honest `N of M` count; the sidebar folding to an icon rail and the IR list never folding into an empty screen; the Insights pane being a third sibling rather than a panel inside the detail; the dashboard painting a skeleton rather than a page of zeroes; **`indexView` can never be hidden while the user is on the index** (asserted on a **desktop** viewport, since the phone layout hides it legitimately); the comments icon being a real icon; the emoji ledger holding at 45; and that **every icon name the source references exists in `ICON_PATHS`** — in both directions, so a dead entry fails too |
| `smoke-export.mjs` | **The per-section PDF export, and the image fields it carries.** `pdfSafe`, `fitLongEdge` (the 1600px / 82% rule, as arithmetic), `wrapText` and `exportFileName`/`sanitizeFileName` are driven directly, since none of them needs a browser. `sectionPdfModel` is checked against the real `SECTIONS` metadata for B and C — including the new `b_inwardPhotos` / `c_iqcPhotos` fields, the deleted `c_evidenceLink`, every table shape (`inwardTable`, `iqcTable`, `costTable`, `dispatchChecklist`), an all-empty section, an unknown section id, and that `g_basicReport` is modelled while the retired `g_missionReport` appears nowhere. `mergeFlightReportEntries` / `savedEvidenceEntries` prove the flight-test merge is **idempotent** and that two unmatchable entries are both kept. The buttons are asserted as six `download-sec-*` and six `share-sec-*` inside `.sec-export-row`, that `#download-sec-d` is gone, and that the gating exempts exactly `sec-export-btn` so a view-only user can still export. Finally `drawSectionPdf` runs against **the real vendored pdf-lib, evaluated inside the sandbox** (see the harness note below): a filled Section B is one A4 page, a two-page attached PDF makes three, an unreadable attachment degrades to the report alone, a long section spills to a second page, and a Remarks box full of emoji exports instead of throwing. It also pins the packaging side — the vendor file is the UMD build, `index.html` loads it before `app.js`, `sw.js` caches it, and `deploy-ghpages.mjs`'s explicit `SERVED` list carries it |

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
   published first as the order requires. To confirm it took, run
   `reportRecentSignins(1)` from the editor: it prints a line per sign-in, or an empty
   window if nobody has signed in since the paste. Editor
   https://script.google.com/home/projects/1HBTlKzgMInqvt_yCUCwsA0RmrvetIylFyPxpHA_ch5mEpvOhDYbTBUj9/edit
   — **Deploy → Manage deployments → ✏️ → New version**. Never "New deployment" (it
   mints a different `/exec` and breaks every installed client), and the `/exec` URL
   must keep ending `jQXatfT/exec`. **Backend last, never first** — and the frontend
   goes first again here, because the device label the audit records comes from
   `app.js` and an old backend simply ignores the extra field.

   > **`https://script.google.com/d/<deployment-id>/edit` does NOT work.** The editor
   > is keyed by the **script ID**, not the deployment ID, and the deployment ID is
   > what appears in the `/exec` URL (`…/macros/s/AKfycb…jQXatfT/exec`). Pasting that
   > into a `/d/…/edit` link opens Google Drive's *"the file you have requested does
   > not exist"*. Use the `/home/projects/<script-id>/edit` form above.
2. **Run `installArchiveTrigger()` once** if the Triggers page is empty, signed in as
   `monish.raza@indrones.com` — the account that owns the Drive folder, because the
   trigger executes as whoever installed it. Idempotent; confirm exactly one trigger on
   the Triggers page. Until it exists, closed IR folders are archived only by hand.
3. **Publish the frontend** whenever `app.js` moves: `node tools/deploy-ghpages.mjs` to
   dry-run, then `node tools/deploy-ghpages.mjs --commit --push`. Needs
   `DEPLOY_SOURCE=category-insights` while the work is on that branch, and a
   `CACHE_NAME` bump in `sw.js` or the deploy warns that returning users keep the stale
   shell for a load. The last publish was `3286ff0` (cache v35).
4. **Delete the retired `ACL` and `ACCESS_REQUESTS` tabs** — nothing has read them since
   the store moved to Drive JSON on **2026-09-17**, so **2026-10-17** is the earliest
   safe date; they are the only record of the old hand-assigned grants, which is the
   whole reason to wait. Deleting is right-click → Delete on each tab in the IR
   workbook. Leaving them costs only clutter, so this is housekeeping, not a fix.
   Drive usage is worth a look at the same time (see "Erase archived IR folders").
- [ ] Push notifications for IR status changes
- [ ] Photo gallery view for saved file links
- [ ] Form validation with required fields
- [ ] Offline-first with local storage sync queue
- [ ] Multi-language support (Hindi + English)
- [ ] **Erase archived IR folders.** Not built, deliberately: closing an IR moves its
      folder to `Archive IRs/` and nothing is ever deleted. The owner will watch Drive
      usage for a while and ask for this separately if space becomes an issue.
- [ ] Move the IR list read behind the authenticated `listIRs` action (closes the last
      unauthenticated data path)
- [ ] An ids index for the fixed-name store files, on the `sections/index.json` pattern

### Done since this list was written
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
- ✅ **The app has a real icon, generated from one brand master.** The owner-supplied
  crop is now `assets/icon-master.jpeg` (1653×1653), and `icon-192.png`,
  `icon-512.png` and `apple-touch-icon.png` are all produced from it by
  `tools/make-icons.ps1` — the whole square is downscaled, never a bounding-box crop,
  because the background wash runs corner to corner and a tight crop leaves a visible
  seam. The mark sits at 75% of the width, consistently inset across all three, and the
  master is the **only** source: the superseded 2048×2048 upload is deleted rather than
  left beside it to be picked up by mistake. `smoke-shell.mjs` now fails if any icon is
  blank or the master goes missing.
- ✅ **The logo sits on the page instead of in a tile on it.** The owner reported the
  icon arriving "in a shape of square" and asked for it borderless, "to feel real
  embedded into the page". The square was the artwork's own light background, and the
  fix is `assets/icon-mark.png` — the same logo with that background **keyed out** —
  used for the sidebar and the sign-in card, while the tab, home screen and manifest
  keep the square icons, because an OS tile has to be square. It cannot be done by
  colour: the monogram and the "Passbook" script are the same colour as the background,
  so a flood fill inward from the border is what separates them, and one wrong
  tolerance either leaves the square or hollows the logo out.
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
  (no assignee, no category, and now "0/6" over a ticket with saved sections); the
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
- ✅ **Per-section PDF export, images in B and C, and the end of digital signatures.**
  Every section B–G now has **⬇ Download** and **⬇ Download and share**, which build a
  real PDF file (vendored `pdf-lib`) with that section's photos embedded and any
  readable attached PDF merged in. Sections B and C gained the shared
  `imageEvidence` control, and C's "Link to Evidence Folder" field was removed. The
  nine `esignature` fields and their machinery were deleted, and the two Flight Test
  Report uploads became one field.
- ✅ **The section restructure** — nine sections became six (**B–G**); old Section A's
  content became the pinned **Overview panel** (data key `sec-a`, no letter, no tab);
  QC + Flight Test merged into **Section F — Quality Test Report**; PDI + Dispatch
  merged into **Section G — PDI Report/Dispatch Record**.
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
