# 07 — Known Issues & TODO

> **Status of the section restructure + auth/access rewrite (Sept 2026).**
> Code-complete, documented in [10](10 - Auth & Access Model.md), and passing all
> **929 cases across 11 suites** — but **not deployed.** `main` holds it; gh-pages
> and the live GAS deployment still serve the old build, and the two must cut over
> **together** (the old frontend calls actions the new backend no longer has, and the
> restructure re-letters the section tabs). `CACHE_NAME` is already bumped for that
> moment. **Nothing is still owed by the owner:** the department → section mapping
> arrived, and it now lives in `SEED_GRANTS` in `backend.gs` (see
> [10](10 - Auth & Access Model.md)). It is written by `seedDepartments()`, which
> reports a `dropped` list — the one thing a grants rewrite can lose silently.
>
> The restructure is what makes this one release rather than two: nine sections
> (`sec-a`…`sec-i`) became six (**B–G**), Section A's content became the pinned
> **Overview panel**, and the two `APP_DATA` merges are a migration that rewrites
> rows the live app is reading — so it cannot run pre-flight. See
> [08](08 - Development Guide.md) for the forced run order.
>
> **Status of the Frappe Helpdesk pivot.** Phase 1 (shell + design system) and
> Phase 2 **Stages 1 and 2** are committed on `main` and **live on `gh-pages`**
> (`74c0298`) — app-owned workflow state (`__IRS__`) and the read-only 📋 Report
> tab. Be precise about what that means: the deployed build carries the pivot
> **and the pre-rewrite auth and the old nine sections**, so what is live today is
> *not* what `main` holds. Stages 3–8 (list intelligence, SLA, dashboard, canned
> responses, knowledge base, CSAT) are designed but unstarted; the plan is the
> source of truth for those.

## Known Issues

### Security
- ⚠️ **The pre-auth surface is open by necessity.** `ping`, `sessionCheck`, `login`, `changePassword`, `forgotPassword` and `resetPassword` must answer without a session, so the GAS URL being public is not itself the boundary — the **rate limits** are. `login`/`changePassword` share `LOGIN_ATTEMPTS` (5 failures → 15-minute lockout) and `forgotPassword` is capped at 3 codes/hour/email plus a global daily mail cap. Weakening any of those re-opens a guessing oracle.
- ✅ **Data actions require a session** — `listIRs`, `getPassbook`, `saveSection` and every admin action call `requireAuth`, and the caller's email is read **from the token**, never from a request parameter, so the identity cannot be spoofed. (`docs/05` used to list the opposite; that was the pre-rewrite build.)
- ❌ **File uploads shared with anyone-with-link** — `ANYONE_WITH_LINK` sharing on all uploaded files
- ❌ **The IR list is read straight from a link-shared Sheet, bypassing the token gate.** Making the app the pane of glass does not close this; it only stops staff *needing* the Sheet. Moving the read behind the authenticated `listIRs` action is a separate, worthwhile change.
- ⚠️ **Sentinel stores are world-readable and world-writable by any signed-in user.** `__`-prefixed irNumbers skip the per-section ACL check, so an **assignee is advisory, not access-controlled** — any signed-in user can reassign any ticket. Consistent with how comments and the Team Directory already behave, but "assignment" implies authority it does not have. Fixing it needs a redeploy plus an ACL-tab migration. (This is also why the department grants are **not** sentinels — see [10](10 - Auth & Access Model.md).) `SENTINEL_SECTIONS` + `assertSentinelWritable()` now bound *which* stores exist and what shape their keys take, so a caller can no longer invent a store — or aim a write at one that was never meant to be writable — but writes *within* an allowed store are still open to everyone, by design.
- ⚠️ **Everyone signed in can view every section, including Section D and the Overview** — customer names, contact emails and root-cause analysis. This is a **deliberate owner decision**, not an oversight: *"Once anyone signin in, provide view access to everyone by default. its not about who."* Edit is what is controlled. If it ever needs re-tightening, the seam survives — `canView` still exists and `getPassbook`'s per-section filter is one line. The Overview is the one row that had to be **explicitly** exempted from that filter, because it is not in `SECTION_KEYS` — see the bug note in [03](03 - Sections Reference.md).

### Functionality
- ❌ **No offline editing** — PWA caches static assets but can't function without GAS backend
- ❌ **No conflict resolution** — if two users edit the same section simultaneously, last-save-wins with no warning
- ❌ **No delete capability** — sections can be updated but never cleared/deleted
- ❌ **No IR creation from app** — new IRs must come from the Google Form → "Form Responses" tab (deliberate; the Form is the client's front door)
- ❌ **No validation** — forms have no required-field checks before save
- ⚠️ **Section completion is tracked but not shown** — `__IRS__.done[]` records which sections have been saved (written on save, recomputed on every `openPassbook()`), but no progress indicator renders yet. That is Stage 3. Note `done[]` was **remapped** by the merge migration (`sec-h`/`sec-i` → `sec-g`, old `sec-g` → `sec-f`, `sec-a` dropped) from the original value in a single pass, and the frontend additionally filters it against `SECTION_IDS`, so a stale or half-migrated store cannot reintroduce a retired id.
- ⚠️ **The hand-typed activity log is read-only and will stay that way** — it is kept in the Overview as a labelled `Legacy` block so history is not lost, but nothing writes it any more. It is deliberately **not** folded into the generated timeline: it has no per-row timestamp, so merging it would mean inventing when things happened. The app's own record of activity is the timeline.
- ⚠️ **A stale service worker sees the new backend with the old shell for one load.** It requests `sec-g` and receives merged data (so Flight Test labels briefly sit on correct data), cannot save `sec-h`/`sec-i` (rejected with a clear "reload the app" error), and can post `a_overallStatus` into the `sec-a` row, which nothing reads. Harmless, and the `CACHE_NAME` bump ends it on the next reload — but it is the residual cost of the frontend and backend having to cut over together.
- ⚠️ **Three Sheet columns are unmodelled** — the Form writes columns E, J and O, for which no `IR_REPO_*_COL` constant exists. Stage 2 surfaces them on the 📋 Report tab under "Other columns from the Sheet" rather than dropping them, and the app records which headers it did not recognise (`lastSheetAudit`). A new Form question is therefore visible, but appears in a catch-all block instead of a modelled field.
- ⚠️ **The live Sheet header row has never been verified directly** — reads from this dev environment return HTTP 401, so the header row is taken from `backend.gs`'s constants plus a test fixture. The mapper is self-auditing and matches by substring, which is why it was built that way; still, confirm against the real Sheet when convenient.

### UX
- ⚠️ **No loading state per section** — loading saved data is silent; user sees empty forms briefly
- ⚠️ **No error recovery** — if save fails, the retry button appears but doesn't auto-retry
- ⚠️ **File previews are image-only** — PDF uploads show no preview, only images get thumbnails
- ⚠️ **Checklist UX** — checklist items use dropdown selects instead of more intuitive checkbox UX
- ⚠️ **No confirmation dialog** — save button has no "are you sure?" for critical sections
- ⚠️ **Assignment emails read as comments** — `sendNudgeEmail`'s subject is hardcoded to the comment wording, so the notification an assignee receives says "you have a comment". Needs a redeploy to fix.

### Technical Debt
- 🔧 **Large single-file frontend** — all logic in one `app.js` (~5,350 lines and growing); the CSS is now split into four layered files (see docs/09)
- 🔧 **No build pipeline** — no minification, no bundling, no tree-shaking
- 🔧 **No type safety** — vanilla JS, no TypeScript or JSDoc
- 🔧 **30-day persistent sessions** — `localStorage`, slid on use, no idle timeout (the owner's choice; see the security item above)
- 🔧 **One admin** — a bus factor of one. Adding another is a one-line `ADMIN_EMAILS` edit plus a GAS redeploy.
- 🔧 **The 90-second nudge poll is ~40 authenticated GETs/hour/user**, each doing full `SESSIONS`, `APP_DATA` and `__NUDGES__` scans. The session slide is throttled to ≤1 write per session per 6h so this change does not *add* to the problem, but the polling cost itself is a pre-existing concern. Not fixed here.
- 🔧 **`ACL` and `ACCESS_REQUESTS` tabs are frozen, not deleted.** They are the only record of the old hand-assigned grants; leave them for 30 days after cutover, then delete.
- 🔧 **Legacy importer hardcoded** — `importSingleTab()` has placeholder cell mappings. It also has a **pre-existing duplicate-append bug**: its comment says "if not already there", but it calls `appendRow` unconditionally, so a re-run duplicates rows. Out of scope for the restructure (only the retired `'sec-i'` id was remapped); noted here so it is not rediscovered as new.
- 🔧 **`AUDIT_LOG` has no automatic pruning, cap, rotation or delete path.** Volume used to be dominated by `__NUDGES__` saves (one row per comment post, resolve, edit *and* markRead, each carrying a 500-character copy of the whole comment array); those are no longer audited at all, and the bare `saved` marker plus the `done` delta are suppressed — so a human section save is now `1 + K` rows and a triage change `0..3`. There is still no automatic bound, and there should not be one: the audit trail is evidence. The lever is manual and locked — `maintenancePruneAuditLog()` (retains `AUDIT_RETENTION_DAYS`, default 400). The 400-entry cap in `getAuditLog` bounds the *response*, not the read.
- 🔧 **Drive folder names no longer match the section letters.** A merged section keeps the folder of its **first-listed source**, so new uploads land alongside the existing files instead of opening a second folder for the same section: `sec-f` → `'Section F - Quality Control'` (now also holds Flight Test uploads) and `sec-g` → `'Section H - PDI'` (now also holds Dispatch uploads). `'Section G - Flight Test'` and `'Section I - Logistics Dispatch'` are historical — browsable, never written again. Renaming them is a Drive-wide mutation needing its own editor function; deliberately left as an optional later step rather than bundled into a cutover.
- 🔧 **Merged sections hold two field-id prefixes** — `sec-f` declares `f_*` **and** `g_*`, `sec-g` declares `h_*` **and** `i_*`. This is not laziness: field ids are comment anchors (`n.fieldId` inside every `__NUDGES__` item) *and* the `Field ID` of every historical `AUDIT_LOG` row, so renaming `g_missionReport` → `f_missionReport` would orphan every anchored comment on it and split its audit history across two names. It is survivable only because field ids resolve through `FIELD_SECTION_INDEX`, built from `SECTIONS` itself — resolving by prefix, as the code used to, sends `g_missionReport` to a section that no longer exists.
- 🔧 **`getAuditLog` and `getPassbook` read whole tabs.** Both do a full `getDataRange().getValues()` and filter in memory, so request cost grows with `APP_DATA` / `AUDIT_LOG`. `__IRS__` alone adds one row per IR (~450). Fine now; if it bites, read a narrower range (the `AUDIT_LOG` case is the likelier one, since that tab only ever grows).
- 🔧 **The deployed backend is older than `backend.gs`.** `getAuditLog`, the upload audit event and the whole restructure are not live until the cutover deploy. Nothing in Stages 1–2 depends on them.

## Tests

`node tools/smoke-all.mjs` — **929 cases across 11 suites**, all passing.

| Suite | What it proves |
|---|---|
| `smoke-shell.mjs` | Every id `app.js` reads at parse time exists in `index.html`; the **7 tabs and 7 panes** (📋 Report + six lettered); that the retired `sec-a`/`sec-h`/`sec-i` have **neither** a tab nor a pane, and that the Overview carries neither `class="section-content"` nor a `sec-` id; the plain end-of-body `<script>` contract; cascade order; token-only intake CSS; and that the **irreversible purge is two-step in the UI too** (review → copy → delete), not just in the endpoint behind it |
| `smoke-ir-state.mjs` | `__IRS__` ownership, precedence and merge — including that a **retired** section id is filtered out of `ir.done` |
| `smoke-intake.mjs` | The Sheet column map, the audit, degenerate/reordered input, and escaping — including **the ticket-list card rendered from two untrusted sources** (the public customer Form's serial field, and `__IRS__` status/priority, which any signed-in user can write). Asserts on real rendered output: no injected attribute, no attribute beyond the fixed set the renderer writes, and a `javascript:` link produces no anchor at all |
| `smoke-sections.mjs` | The six-section contract; every field id in every **merged** section resolves to its section id — `g_missionReport → sec-f`, `h_dispatchChecklist → sec-g`, `i_courier → sec-g`, the cases that fail without `FIELD_SECTION_INDEX`; the prefix fallback still works for an id in no form; the Overview's structural isolation; and that `saveDraft('sec-a')` writes nothing |
| `smoke-timeline.mjs` | Drives the **pure** `buildTimeline` in the `vm` harness — behaviour, not shape. Each event kind maps correctly; `done` deltas are suppressed; an `uploaded` row carries the file name with the **source** field id; comments merge in and other IRs are excluded; a `'dd-MMM-yyyy HH:mm:ss'` fixture parses (the `Date.parse` → `NaN` trap); mixed timestamps sort with the tiebreak; `limit` trims from the newest end; and no entry ever interpolates the literal `undefined` |
| `smoke-access.mjs` | View + comment for everyone, edit only from departments, admin bypass, the fallback **failing closed on writes**, and that the de-admined `customer.relations@` address is gone from `app.js` entirely. Also that `canTriage()` is a **separate axis**: a `sec-c` edit grant does not confer it, a CR user has `triage: true` with `canEditSection` false for all six, and `myAccess().triage === false` on the fallback |
| `smoke-session.mjs` | The token is in `localStorage` and survives a `sessionStorage` wipe; `clearLocalAuth` is the one teardown path and stops the poll; **the poll restarts after an in-page re-login**; the dead `forceReauth()` stays deleted; and **`confirmSessionAlive()` resolves true when fetch rejects** |
| `smoke-backend.mjs` | Regex over `backend.gs`: deleted machinery really gone, `SESSION_DAYS: 30`, one admin, the restructured router (**nothing dispatches outside `try`**), all dispatched actions, grants in real tabs, the sentinel **allowlist**, the mail cap **on every send site**, the temp-password clock on **both** doors that accept one, `resetPassword` preserving `Status`, the `LockService` guard on index-based deletes, the must-change branch returning **before** any session is minted, `DEPT_HEADS` at 12 columns with `Triage` **last** (so the section offset stays `3 + j`), and that the merge's era-classifier is used for the group key |
| `smoke-merge-plan.mjs` | **Executes** `planSectionMerge` — the *production* function, extracted from `backend.gs`'s source and run in a `vm` with no Apps Script — over fixture arrays shaped like `getDataRange().getValues()`. An IR with `sec-g` → one `sec-f` with unioned keys; `sec-h`+`sec-i` → one `sec-g`; **an IR with all four → exactly two survivors and two deletes** (the direction-collision regression test); no `sec-g` row retains `g_*`; `sec-g` is dated by its **own field ids**, never by its section column; an unmarked `sec-g` row is **left alone and named** in `ambiguous[]`; `done[] = ['sec-a','sec-g','sec-h','sec-i'] → ['sec-f','sec-g']` (the chaining test); sentinels and `sec-a` rows untouched; and **the second run is a genuine no-op, not merely equivalent** |
| `smoke-merge-apply.mjs` | The adversarial pass the plan asked for: loads the **whole** of `backend.gs` into a `vm` with a faked Apps Script platform (`SpreadsheetApp`/`Utilities`/`LockService`), and asserts on the *order of calls* — that the lock is taken **before** the snapshot is read and the snapshot is read **inside** the lock; that deletes run **bottom-up**, so the `__IRS__` sentinel (fixtured *below* both delete targets) survives a top-down delete; that every surviving row is exactly where it was, in its original order; that the dated backup tab is byte-identical to the pre-merge rows; that a second apply writes nothing and leaves the backup holding **pre**-merge state; `restoreAppDataFromBackup` and its same-day refusal; and the audit layer end to end (header written by the real `getOrCreateAuditTab`, rows exactly 8 wide, timestamps round-tripping, no `done`/`_links` rows, 500-char truncation) |
| `smoke-boot.mjs` | **Real headless Chrome**: the app boots via `?dev=1`, the Overview renders its facts/timeline/legacy log, the full CSV → map → render chain reaches the DOM; and a third phase loads the **signed-out** login screen with the sign-up machinery absent from the DOM. It is also the only suite that would catch a `TypeError` from a shadowed function name — `renderBannerMeta`'s local `canTriage` had to be renamed `showTriage` for exactly that reason. Skips cleanly if no Chrome is installed |

There is no build step and no test framework — suites are plain node scripts.

### What the suite could not see, and what closed the gap

Every case above is **static**: `smoke-backend.mjs` reads `backend.gs` as text and
`node --check` only proves it parses. No suite *executed* the backend, because it
needs `SpreadsheetApp`, `MailApp`, `Utilities` and `PropertiesService`. Two
adversarial review passes — the second of which built a mocked Apps Script runtime
and actually ran the file — found three defects invisible to all 444 cases that
existed at the time:

- `changePassword` had **no temp-password expiry check** (it lived only in
  `doLoginPassword`), so an expired temp password could be posted straight to it
  and mint a full 30-day session. The TTL was decorative.
- `resetPassword` wrote a literal `'active'` into `Status`, so resetting the
  password of a deliberately disabled account **re-enabled it**.
- `sendNudgeEmail` called `MailApp.sendEmail` directly, bypassing the daily cap —
  while `smoke-backend.mjs` asserted under the heading *"the mail cap is global, not
  per-flow"* that it covered comment notifications. That assertion was false, and
  the heading is what made it look verified.

All three are fixed, and each now has an assertion that would fail if it came back.
The lesson worth keeping: **a regex suite asserts that code is shaped a certain
way, never that it behaves that way.** When a change is security-shaped and the
runtime cannot be executed here, it needs an adversarial pass, not more cases.

**The restructure applied that lesson rather than repeating it.** Two gaps were named
in advance and then closed the same way:

- *"that `mergeSectionsApply` deletes the **right** rows — the planner is tested, the
  row-index arithmetic around it is not"* and *"that is the only thing that will
  catch an off-by-one in the delete order."* → `smoke-merge-apply.mjs` mocked the
  platform and asserted the **call order**: the lock is taken before the snapshot is
  read, deletes run bottom-up, and the `__IRS__` sentinel survives — fixtured
  deliberately *below* both delete targets, so a top-down delete eats it.
- The `sec-a` row surviving `getPassbook` for a **non-admin** remains genuinely
  untestable here (it needs the real Sheets plus a non-admin session), so it is not
  asserted — it is a **named cutover check** instead, in
  [08](08 - Development Guide.md): sign in as a CR account and a Production account
  and confirm the Overview renders and the right tabs are gated. Testing it as the
  admin would have proved nothing, and that is exactly how the bug would have
  shipped.

**Still not automatable here:** rendering both themes at 360/768/1024/1440, the
DEPARTMENTS positional offsets against real rows, whether Apps Script accepts a
12-column header, whether the lock is genuinely *acquired* at runtime, Drive folder
behaviour, and a live end-to-end sign-in.

## Planned / Nice-to-Have Features

- [ ] Dashboard with IR stats (open/closed/pending counts) — *Stage 5*
- [ ] Section completion progress indicator on Master Index cards — *Stage 3; the data already exists*
- [ ] Ticket ageing / time-in-status / overdue flags — *Stage 4*
- [ ] Canned responses — *Stage 6*
- [ ] Knowledge base — *Stage 7*
- [ ] CSAT score — *Stage 8*
- [ ] Push notifications for IR status changes
- [ ] Photo gallery view for saved file links
- [ ] Form validation with required fields
- [ ] Offline-first with local storage sync queue
- [ ] Export to PDF
- [ ] Multi-language support (Hindi + English)

### Done since this list was written
- ✅ **The section restructure** — nine sections became six (**B–G**); old Section A's
  content became the pinned **Overview panel** (data key `sec-a`, no letter, no tab);
  QC + Flight Test merged into **Section F — Quality Test Report**; PDI + Dispatch
  merged into **Section G — PDI Report/Dispatch Record**. The merge is a migration
  (`planSectionMerge` → `mergeSectionsApply`) with a dated backup tab and an undo
  (`restoreAppDataFromBackup`), documented in [03](03 - Sections Reference.md).
- ✅ **The automated activity log.** The hand-typed table is retired to a read-only
  `Legacy` block; activity is now generated from four sources the app already
  records — section saves and field edits, status/assignee/priority/type changes,
  comments and @mentions, and **file uploads** (which previously left no trace at
  all). One pure `buildTimeline(...)` feeds both the Overview panel and the 🕓
  History modal, so the two can never tell different stories.
- ✅ **The department matrix is populated.** The owner's mapping now lives in
  `SEED_GRANTS`; `seedDepartments()` upserts it and reports `created` / `updated` /
  `unchanged` / and a **`dropped`** list, and `seedMemberships()` adds the
  person↔department edges while never removing one. **Triage** is a new,
  second, independent axis — CR and Management triage without editing any section.
- ✅ **The lesson the restructure taught, worth generalising:** *a migration that
  rewrites rows the live app is reading cannot run pre-flight.* Column-widening can
  (the live code keeps reading the columns it knows), but the `APP_DATA` merge
  cannot — a client on the old build would keep writing rows the merge had already
  collapsed. That, plus the fact that the old backend reads `DEPARTMENTS`
  **positionally** against a list that just got shorter, is what forces the grants,
  the memberships and the merge into the cutover window **after** the deploy and
  before the `gh-pages` push. The run order in [08](08 - Development Guide.md) is
  derived from those two facts, not chosen.
- ✅ **A second review pass over the whole rewrite**, run adversarially and — in one
  case — by actually executing `backend.gs` against a mocked Apps Script runtime.
  It found three defects the 444 static cases could not see; all are fixed and
  pinned (see **Tests** below). It also confirmed the property the rewrite exists
  for held under execution: **no code path mints a session for an account on a
  temp password except `changePassword`.**
- ✅ **The ticket-list card is rendered safely.** It was interpolating the public
  customer Form's serial field and the ACL-exempt `__IRS__` status straight into
  `innerHTML`, with an unescaped quote in the `onclick` — enough for an
  unauthenticated attacker to lift an admin's session token from `localStorage`.
  `escJsAttr()` + `safeUrl()` now cover the JS and URL contexts, and the whole
  card is asserted against real rendered output.
- ✅ **Admin-provisioned accounts** — no self-signup; forced password change on first sign-in; forgot-password by email; 30-day sliding session; admin bulk provisioning with a copyable credentials txt (see [10](10 - Auth & Access Model.md))
- ✅ **Two-level access from departments** — view+comment for everyone, edit from the department↔section matrix, admin bypass
- ✅ **The repeated sign-in prompts in User Access** — the real cause was a 90s poll re-arming the ejector after every wipe, plus a Reconnect button that called `signOut()`
- ✅ **The irreversible account purge is two-step** — review the list, copy it, then
  delete; the backend plans before it deletes, refuses if the list changed since
  the review, and runs under a `LockService` lock so a concurrent write cannot make
  an index-based `deleteRow` hit the wrong row. The old copy promised the rows were
  "shown below first" while the code deleted them before responding.
- ✅ **Audit trail / history for section edits** — `AUDIT_LOG` + the 🕓 History modal
- ✅ **Auto-calculation for the Section D repair table** — Cost = Qty × Rate, live Total Repair Cost
- ✅ **Viewing uploaded files** — the `imageEvidence` control previews saved Drive images and links PDFs, with captions
- ✅ **App-owned status, assignee, priority and type** — no longer read back from the Sheet (Stage 1)
- ✅ **The Sheet gap** — every ingested column is now visible on the ticket, including the raise time and the three unmodelled columns (Stage 2)