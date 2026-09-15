# 07 — Known Issues & TODO

> **Status of the Frappe Helpdesk pivot.** Phase 1 (shell + design system) is
> deployed. Phase 2 **Stages 1 and 2 are committed on `main` and not yet deployed**
> — app-owned workflow state (`__IRS__`) and the read-only 📋 Report tab. Stages
> 3–8 (list intelligence, SLA, dashboard, canned responses, knowledge base, CSAT)
> are designed but unstarted; the plan is the source of truth for those.

## Known Issues

### Security
- ❌ **No server-side auth on GAS endpoints** — anyone with the URL can call `listIRs` and `getPassbook`
- ❌ **Client IDs in frontend** — OAuth Client ID is not a secret, but the GAS URL being public means data is accessible without auth
- ❌ **File uploads shared with anyone-with-link** — `ANYONE_WITH_LINK` sharing on all uploaded files
- ❌ **The IR list is read straight from a link-shared Sheet, bypassing the token gate.** Making the app the pane of glass does not close this; it only stops staff *needing* the Sheet. Moving the read behind the authenticated `listIRs` action is a separate, worthwhile change.
- ⚠️ **Sentinel stores are world-readable and world-writable by any signed-in user.** `__`-prefixed irNumbers skip every ACL check, so an **assignee is advisory, not access-controlled** — any signed-in user can reassign any ticket. Consistent with how comments and the Team Directory already behave, but "assignment" implies authority it does not have. Fixing it needs a redeploy plus an ACL-tab migration.

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
- 🔧 **Large single-file frontend** — all logic in one `app.js` (~4,900 lines and growing); the CSS is now split into four layered files (see docs/09)
- 🔧 **No build pipeline** — no minification, no bundling, no tree-shaking
- 🔧 **No type safety** — vanilla JS, no TypeScript or JSDoc
- 🔧 **Session-only auth** — `sessionStorage` means re-auth on every new tab (deliberate)
- 🔧 **Legacy importer hardcoded** — `importSingleTab()` has placeholder cell mappings
- 🔧 **`__IRS__` adds one `APP_DATA` row per IR** (~450 rows). Every `getPassbook` call does a full `getDataRange().getValues()` then filters, so request cost grows with the tab. Fine now; if it bites, read a narrower range.
- 🔧 **`__IRS__` writes are audited as `irNumber = __IRS__`**, adding noise to `AUDIT_LOG`. Filter them out of the history view.
- 🔧 **The deployed backend is older than `backend.gs`**, so `getAuditLog` may not be live. Nothing in Stages 1–2 depends on it.

## Tests

`node tools/smoke-all.mjs` — **166 cases across 4 suites**, all passing.

| Suite | What it proves |
|---|---|
| `smoke-shell.mjs` | Every id `app.js` reads at parse time exists in `index.html`; the 10 tabs and 10 panes; the plain end-of-body `<script>` contract; cascade order; token-only intake CSS |
| `smoke-ir-state.mjs` | `__IRS__` ownership, precedence and merge |
| `smoke-intake.mjs` | The Sheet column map, the audit, degenerate/reordered input, and escaping |
| `smoke-boot.mjs` | **Real headless Chrome**: the app boots, and the full CSV → map → render chain reaches the DOM. Skips cleanly if no Chrome is installed |

There is no build step and no test framework — suites are plain node scripts.
Still not automatable here: rendering both themes and 360/768/1024/1440 widths,
and confirming the view-only ACL path shows no edit affordance on the new fields.

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
- ✅ **Role-based access** — per-user, per-section `view` / `comment` / `edit` ACL, admin bypass, request-access flow (see [04](04 - Backend API Reference.md))
- ✅ **Audit trail / history for section edits** — `AUDIT_LOG` + the 🕓 History modal
- ✅ **Auto-calculation for the Section D repair table** — Cost = Qty × Rate, live Total Repair Cost
- ✅ **Viewing uploaded files** — the `imageEvidence` control previews saved Drive images and links PDFs, with captions
- ✅ **App-owned status, assignee, priority and type** — no longer read back from the Sheet (Stage 1)
- ✅ **The Sheet gap** — every ingested column is now visible on the ticket, including the raise time and the three unmodelled columns (Stage 2)