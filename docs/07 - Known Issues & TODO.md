# 07 — Known Issues & TODO

> **Status of the auth/access rewrite (Sept 2026).** Code-complete, documented in
> [10](10 - Auth & Access Model.md), and passing all 444 cases — but **not
> deployed.** `main` holds it; gh-pages and the live GAS deployment still serve the
> old build, and the two must cut over **together** (the old frontend calls actions
> the new backend no longer has). `CACHE_NAME` is already bumped for that moment.
> The one thing still owed by the owner: the department → section edit mapping.
> Departments are seeded with empty grants on purpose — no grant was guessed.

> **Status of the Frappe Helpdesk pivot.** Phase 1 (shell + design system) and
> Phase 2 **Stages 1 and 2** are committed on `main` and **live on `gh-pages`**
> (`74c0298`) — app-owned workflow state (`__IRS__`) and the read-only 📋 Report
> tab. Be precise about what that means: the deployed build carries the pivot
> **and the pre-rewrite auth**, so what is live today is *not* the auth/access
> rewrite described above. Stages 3–8 (list intelligence, SLA, dashboard, canned
> responses, knowledge base, CSAT) are designed but unstarted; the plan is the
> source of truth for those.

## Known Issues

### Security
- ⚠️ **The pre-auth surface is open by necessity.** `ping`, `sessionCheck`, `login`, `changePassword`, `forgotPassword` and `resetPassword` must answer without a session, so the GAS URL being public is not itself the boundary — the **rate limits** are. `login`/`changePassword` share `LOGIN_ATTEMPTS` (5 failures → 15-minute lockout) and `forgotPassword` is capped at 3 codes/hour/email plus a global daily mail cap. Weakening any of those re-opens a guessing oracle.
- ✅ **Data actions require a session** — `listIRs`, `getPassbook`, `saveSection` and every admin action call `requireAuth`, and the caller's email is read **from the token**, never from a request parameter, so the identity cannot be spoofed. (`docs/05` used to list the opposite; that was the pre-rewrite build.)
- ❌ **File uploads shared with anyone-with-link** — `ANYONE_WITH_LINK` sharing on all uploaded files
- ❌ **The IR list is read straight from a link-shared Sheet, bypassing the token gate.** Making the app the pane of glass does not close this; it only stops staff *needing* the Sheet. Moving the read behind the authenticated `listIRs` action is a separate, worthwhile change.
- ⚠️ **Sentinel stores are world-readable and world-writable by any signed-in user.** `__`-prefixed irNumbers skip the per-section ACL check, so an **assignee is advisory, not access-controlled** — any signed-in user can reassign any ticket. Consistent with how comments and the Team Directory already behave, but "assignment" implies authority it does not have. Fixing it needs a redeploy plus an ACL-tab migration. (This is also why the department grants are **not** sentinels — see [10](10 - Auth & Access Model.md).) `SENTINEL_SECTIONS` + `assertSentinelWritable()` now bound *which* stores exist and what shape their keys take, so a caller can no longer invent a store — or aim a write at one that was never meant to be writable — but writes *within* an allowed store are still open to everyone, by design.
- ⚠️ **Everyone signed in can view every section, including Section A and Section D** — customer names, contact emails and root-cause analysis. This is a **deliberate owner decision**, not an oversight: *"Once anyone signin in, provide view access to everyone by default. its not about who."* Edit is what is controlled. If it ever needs re-tightening, the seam survives — `canView` still exists and `getPassbook`'s per-section filter is one line.

### Functionality
- ❌ **No offline editing** — PWA caches static assets but can't function without GAS backend
- ❌ **No conflict resolution** — if two users edit the same section simultaneously, last-save-wins with no warning
- ❌ **No delete capability** — sections can be updated but never cleared/deleted
- ❌ **No IR creation from app** — new IRs must come from the Google Form → "Form Responses" tab (deliberate; the Form is the client's front door)
- ❌ **No validation** — forms have no required-field checks before save
- ⚠️ **Section completion is tracked but not shown** — `__IRS__.done[]` records which sections have been saved (written on save, recomputed on every `openPassbook()`), but no progress indicator renders yet. That is Stage 3.
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
- 🔧 **Legacy importer hardcoded** — `importSingleTab()` has placeholder cell mappings
- 🔧 **`__IRS__` adds one `APP_DATA` row per IR** (~450 rows). Every `getPassbook` call does a full `getDataRange().getValues()` then filters, so request cost grows with the tab. Fine now; if it bites, read a narrower range.
- 🔧 **`__IRS__` writes are audited as `irNumber = __IRS__`**, adding noise to `AUDIT_LOG`. Filter them out of the history view.
- 🔧 **The deployed backend is older than `backend.gs`**, so `getAuditLog` may not be live. Nothing in Stages 1–2 depends on it.

## Tests

`node tools/smoke-all.mjs` — **444 cases across 7 suites**, all passing.

| Suite | What it proves |
|---|---|
| `smoke-shell.mjs` | Every id `app.js` reads at parse time exists in `index.html`; the 10 tabs and 10 panes; the plain end-of-body `<script>` contract; cascade order; token-only intake CSS; and that the **irreversible purge is two-step in the UI too** (review → copy → delete), not just in the endpoint behind it |
| `smoke-ir-state.mjs` | `__IRS__` ownership, precedence and merge |
| `smoke-intake.mjs` | The Sheet column map, the audit, degenerate/reordered input, and escaping — including **the ticket-list card rendered from two untrusted sources** (the public customer Form's serial field, and `__IRS__` status/priority, which any signed-in user can write). Asserts on real rendered output: no injected attribute, no attribute beyond the fixed set the renderer writes, and a `javascript:` link produces no anchor at all |
| `smoke-access.mjs` | View + comment for everyone, edit only from departments, admin bypass, the fallback **failing closed on writes**, and that the de-admined `customer.relations@` address is gone from `app.js` entirely |
| `smoke-session.mjs` | The token is in `localStorage` and survives a `sessionStorage` wipe; `clearLocalAuth` is the one teardown path and stops the poll; **the poll restarts after an in-page re-login**; the dead `forceReauth()` stays deleted; and **`confirmSessionAlive()` resolves true when fetch rejects** |
| `smoke-backend.mjs` | Regex over `backend.gs`: deleted machinery really gone, `SESSION_DAYS: 30`, one admin, the restructured router (**nothing dispatches outside `try`**), all 17 new actions dispatched, grants in real tabs, the sentinel **allowlist**, the mail cap **on every send site**, the temp-password clock on **both** doors that accept one, `resetPassword` preserving `Status`, the `LockService` guard on index-based deletes, and the must-change branch returning **before** any session is minted |
| `smoke-boot.mjs` | **Real headless Chrome**: the app boots via `?dev=1`; the full CSV → map → render chain reaches the DOM; and a third phase loads the **signed-out** login screen with the sign-up machinery absent from the DOM. Skips cleanly if no Chrome is installed |

There is no build step and no test framework — suites are plain node scripts.
Still not automatable here: rendering both themes and 360/768/1024/1440 widths,
and confirming a live end-to-end sign-in (that needs the real backend).

### What the suite could not see, and what closed the gap

Every case above is **static**: `smoke-backend.mjs` reads `backend.gs` as text and
`node --check` only proves it parses. No suite *executed* the backend, because it
needs `SpreadsheetApp`, `MailApp`, `Utilities` and `PropertiesService`. Two
adversarial review passes — the second of which built a mocked Apps Script runtime
and actually ran the file — found three defects invisible to all 444 cases:

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