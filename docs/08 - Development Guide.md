# 08 — Development Guide

## Running Locally

Since this is a vanilla HTML/CSS/JS app with no build tools:

```bash
# Option 1: Python (if installed)
cd D:\Projects\i-passbook-app
python -m http.server 3000

# Option 2: Node.js (if installed)
npx serve -l 3000 -s

# Option 3: VS Code Live Server extension
# Right-click index.html → "Open with Live Server"
```

Then open: `http://localhost:3000/?dev=1`

The `?dev=1` query parameter activates **dev auth bypass** — you'll be logged in as "Dev Tester" (with admin access) without needing a real account. This only works on `localhost`/`127.0.0.1`/`::1`.

> **Do not remove the dev bypass casually.** It is reachable only on localhost plus
> `?dev=1`, and it is the *only* way `smoke-boot.mjs` can boot the authenticated
> app shell in a real browser — phases 1 and 2 both depend on it entirely. The
> `shouldUseDevAuthBypass()` early return sits deliberately before the stored-session
> check, so the bypass wins even when a real session is present.

Deep links work too, because routing is hash-based:

```
http://localhost:3000/#/tickets          → the ticket list
http://localhost:3000/#/tickets/IR409    → that IR's passbook open
```

Note the service worker caches the shell aggressively. While editing CSS or JS,
either use a hard reload or unregister the SW in DevTools → Application.

## Deploying the Frontend

The app is static files with no build step — deploy as-is. **It actually runs on
the `gh-pages` branch of `Monish-Raza-87/I-PASSBOOK`**, which is an *orphan* branch
(a second root commit holding only the served files, not a merge of `main`), so
deployment is a push to that branch rather than a build. Other static hosts work
too:

- **GitHub Pages** — push the files to the `gh-pages` branch
- **Netlify** — drag the folder to Netlify Drop
- **Vercel** — `vercel --prod` from the project root
- **Firebase Hosting** — `firebase deploy`

Two things not to forget on every deploy:

- **Bump `CACHE_NAME` in `sw.js`** (e.g. `ipassbook-v20` → `v21`) on any deploy that
  changes a cached asset, or returning users keep the stale shell. The service
  worker is stale-while-revalidate, so existing installs pick the new version up
  without a reinstall — one reload behind, which is why the bump matters.
- **`gh-pages` is not `main`.** Committing on `main` deploys nothing. Confirm the
  two are in sync before telling anyone it shipped.

## Deploying the Backend (GAS)

GAS separates the **editor** code from the **deployed** version that serves
`/exec`, so sheet migrations can run hours before cutover with zero user impact.
The order below is the one that matters — deviating from it breaks either the old
clients or the `/exec` URL.

**Step 1 — pre-flight (undeployed, no impact).**
1. Open [script.google.com](https://script.google.com) and open the existing project
2. Paste the contents of `backend.gs` — **do not deploy yet**
3. Update `CONFIG` values if Sheet/Drive IDs change
4. Run, from the editor's function dropdown, in this order:
   - `migrateAddColumns()` — widens `USERS`, `SESSIONS` and the new tabs in place.
     It **refuses to widen** a `DEPARTMENTS` tab whose header it does not recognise
     (`deptTabShape` → `legacy-9`/`unknown`) rather than overwriting row 1 and
     reinterpreting columns
   - `migrateAclReport()` — **read-only.** The last chance to see the old
     hand-assigned grants before they are orphaned. Paste the output somewhere
     private, never into the repo.
   - `bootstrapAdmin()` — creates the admin row if missing and prints a one-time
     temporary password to the execution log; if the row exists it is left alone
     and only the flags are normalised. **Run this before handing out anything.**

   `seedDepartments()`, `seedMemberships()` and the merge are deliberately **not**
   here — see the cutover window below for why. The grants are no longer ticked by
   hand: `seedDepartments()` writes the owner's mapping, and reports the deltas.
5. Copy the credentials list to a local txt. **Never the repo — it is public.**

**Step 2 — cutover window (~2 minutes; announce first, and confirm nobody is mid-save).**

Two facts force this order, and neither is negotiable:

- The grants and memberships cannot land **before** the deploy. `getOrCreateDeptTab`
  → `ensureHeaders` is reached on **every read**, and until the new backend is the
  one serving `/exec` the live code still reads `DEPARTMENTS` **positionally** — so
  a 12-column tab built for six sections would be read letter-by-letter against the
  old nine, silently granting the wrong sections to the wrong departments.
- The merge cannot run **before** the deploy either: it rewrites rows the live app
  is reading. It is the mirror of the column-widening rationale — a migration that
  rewrites live rows has no safe pre-flight.

1. Deploy → Manage deployments → **edit the existing deployment** → New version.
   **Never "New deployment"** — the `/exec` URL must not change, or
   `CONFIG.GAS_URL` and every installed client breaks.
   - Execute as: **Me**
   - Who has access: **Anyone**
2. `seedDepartments()` — writes the department → section grants, plus `Triage` for
   CR and Management. It is an **upsert** and idempotent: it reports `created` /
   `updated` (naming the delta, e.g. `qc: +sec-f, -sec-g`) / `unchanged`, and
   critically a **`dropped` list** — any existing grant the new mapping does not
   reproduce. **Read the dropped list.** A rewrite is the one thing that can lose a
   grant silently.
3. `seedMemberships()` — adds one `USER_DEPARTMENTS` edge per person. It **only ever
   adds** and says so; nothing is removed. Emails with no `USERS` row are printed —
   the edge is correct and harmless, but those people cannot sign in yet.
4. `mergeSectionsReport()` — **read-only.** Read the plan before applying it. Check
   that every IR with old `sec-g` rows goes to `sec-f` and every `sec-h`/`sec-i`
   goes to `sec-g`, and read the `ERA-AMBIGUOUS` block if it appears: those are
   `sec-g` rows with no `g_*`/`h_*`/`i_*` field to date them, which are left
   untouched on purpose. Merge any of them by hand only if they are old Flight Test
   data.
5. `mergeSectionsApply()` — applies it. It snapshots **inside the row lock**, refuses
   if it finds nothing to do, and writes a dated tab
   `APP_DATA_BACKUP_<yyyy-MM-dd>` **before** the first write, refusing if that tab
   already exists. Copy the backup tab to a private sheet before trusting it.
6. `mergeSectionsReport()` again — it must report **zero** rows to rewrite and zero
   to delete. Anything else means the first pass did not land.
7. **Push `gh-pages`** — frontend and backend go live together.
8. If the URL did change, update `CONFIG.GAS_URL` in `app.js` and redeploy the
   frontend in the same window.

The old frontend is broken by design at this point: it calls actions that no
longer exist. So cut over both halves together — deploy the backend, then
immediately push `gh-pages`.

**Undo.** `restoreAppDataFromBackup()` finds the newest `APP_DATA_BACKUP_<date>`,
saves the current state to `APP_DATA_PRE_RESTORE_<date>` (so the undo is itself
undoable — one level of redo), and replaces the data rows with the backup's. It
clears first even though the merge only deletes, because a client on a stale
service worker may have appended real rows in the meantime. A dated tab, not a
response: *a response is not a backup*.

**Step 3 — verify.** Hard-reload, sign in as the admin, complete the forced
password change, and open User Access — the footer must read `API v2`. If it does
not, the deployment was not the one `/exec` serves. Then check seven tabs
(`📋 Report` + six lettered), `sec-b` selected by default, the Overview rendering
its facts, timeline and legacy log, and 🕓 History opening.

**Then sign in as a CR account and a Production account.** CR must see the Triage
button and have **no** section save enabled; Production must have Triage **hidden**
and B/C/D/E/G save-enabled with F read-only. This is the check that catches the
`sec-a` permission gap — the Overview is dropped for every non-admin if
`getPassbook` filters on a permission map that no longer contains `sec-a`, and the
admin testing it would never see the bug.


**Step 4 — users.** Every account is re-provisioned, so distributing credentials
**is** the migration. Announce the day before and again at cutover, and deliver
each person's block individually — never nineteen passwords in one message.

**Step 5 — hygiene.** Delete the local credentials txt (or move it to a password
manager). Leave `ACL` and `ACCESS_REQUESTS` frozen for 30 days, then delete. Watch
the GAS Executions panel for a day: the restructured `try/catch` now surfaces
errors as JSON instead of silent HTML pages.

## Google Cloud Setup

**Not required.** Auth is email + password handled entirely by `backend.gs`; there
is no `CONFIG.GOOGLE_CLIENT_ID` and no OAuth client to create. The only Google
Cloud–adjacent requirement is that the Apps Script deployment runs as an account
that can read the Sheets and Drive folders listed in `CONFIG` at the top of
`backend.gs`, and that it holds the `script.send_mail` scope for the email flows.

## Google Sheets Setup

Two Google Sheets are needed:

### 1. IR Repository Sheet
- Must have a tab named `Form Responses`
- Columns used: A (summary link), B (IR Number), C (timestamp), K (drone serial no.)
- Typically fed by a Google Form

### 2. Passbook Sheet
- Must have a tab named `APP_DATA`
- The `getOrCreateDataTab()` function auto-creates this with headers if missing
- Headers: `IR Number | Section ID | Saved By | Fields (JSON) | Last Updated`

Every other tab is created on first use by a `getOrCreate*Tab` function, which
calls `ensureHeaders(tab, heads)` — it writes row 1 only, and only when the header
differs, so re-running it can never reformat a live tab:

| Tab | Created by | Holds |
|---|---|---|
| `USERS` | `getOrCreateUsersTab` | One row per account: Email, Password Hash, Salt, Created At, Created By, plus Must Change Password, Password Changed At, Status, Name, Last Login At, Temp Password Issued At |
| `SESSIONS` | `getOrCreateSessionsTab` | Session tokens, expiry, and Last Seen At / Revoked At |
| `DEPARTMENTS` | `getOrCreateDeptTab` | One row per department + its nine section grants |
| `USER_DEPARTMENTS` | `getOrCreateUserDeptTab` | The person↔department edge list — this *is* the access matrix |
| `CODES` | `getOrCreateCodesTab` | Password-reset codes, with expiry, attempt count and a used flag |
| `LOGIN_ATTEMPTS` | `getOrCreateAttemptsTab` | Failed-login counters, shared by `login` and `changePassword` |

> ⚠️ `USERS` columns A–E **must not move** — `doLoginPassword` reads `row[1]` and
> `row[2]` by index for speed. New columns are appended from F, and the identity
> block is written as one `getRange(idx, 2, 1, USER_ID_BLOCK_COLS)` call.

## Project Conventions

- **No semicolons** in `app.js` (mostly) — consistent with the existing style
- **Design tokens for all colours and sizes** — never a raw hex or px in
  `base.css` / `components.css` / `views.css`; see [09 — Design System](09 - Design System.md)
- **Mobile-first** — always test on phone viewport first
- **Dev bypass** — always use `?dev=1` for local development
- **Status field** — IR status on the index is **app-owned** (`__IRS__`), with the
  Sheet's Col D as the fallback until someone changes the status in the app. See
  [02 — Architecture & Data Flow](02 - Architecture & Data Flow.md). `a_overallStatus`
  in Section A is still saved (the audit trail and the backend's `getAllIRStatuses()`
  read it) but is no longer read back as the badge's truth. The 14 status *values*
  are written by the customer Google Form and are never renamed; `STATUS_CATEGORIES`
  maps them to Frappe's Open/Paused/Resolved/Closed **categories** for pill colouring
- **Shell DOM is static** — `app.js` captures twelve element references at parse
  time (`app.js:639-650`), so `index.html` must keep those ids and `app.js` must
  stay a plain end-of-body `<script src>` (never `type="module"`/`defer`)
- **View state is inline** — `renderLayout()` is the only place that writes
  `indexView`/`detailView`/`backBtn` display, and it must keep writing *inline*
  styles: `applySectionAccessGating` selects `.tab:not([style*="display: none"])` — with a
  `:not([data-intake])` exclusion, because the 📋 Report tab is never hidden and
  would otherwise always win that fallback. There is no longer a boot-level access
  gate (`applyAccessGating` was deleted with `role: 'none'`); what remains is
  per-section **edit** gating inside an open passbook.
- **The auth screen must not depend on lazily-created ids.** `#password-change` is
  a full-screen sibling of `#app-container`, not a child, for the same reason
  `#request-access` was: nothing in the shell may be reachable while it is up.
  If you add a parse-time `const X = document.getElementById(...)` for a screen
  that is only rendered later, `smoke-shell.mjs` will fail — and it is right to.

## Tests

There is no test framework and no build step; the suites are plain node scripts
that run the real `app.js` and report one verdict:

```bash
node tools/smoke-all.mjs        # every suite
node tools/smoke-intake.mjs     # one suite
```

| Suite | Approach |
|---|---|
| `tools/harness.mjs` | Shared: evaluates `app.js` under a stubbed DOM in `node:vm` and returns a `__T` object built from getters appended in the same lexical scope. Because `app.js` has no exports, this is the only way to reach into it — and running the file is itself half the test, since every parse-time `getElementById` and module-level statement executes for real. Opt into `splitStorage: true` when a suite needs `localStorage` and `sessionStorage` to be genuinely separate stores; the default aliases them to one. |
| `tools/smoke-shell.mjs` | Derives the ids `app.js` reads **from its source** and asserts each exists in `index.html`; tab/pane counts; the `<script>` contract; stylesheet cascade order; token-only CSS; and the two-step purge UI |
| `tools/smoke-ir-state.mjs` | `__IRS__` load / merge / ownership |
| `tools/smoke-intake.mjs` | The Sheet column map, the 📋 Report rendering, and escaping — including the ticket-list card, rendered from the public Form's serial field and from `__IRS__` status/priority. Asserts on rendered output (no injected attribute, no `javascript:` anchor), not on the source |
| `tools/smoke-access.mjs` | The access model: view+comment for everyone, edit only where a department grants it, admin bypass, and the un-loaded-access fallback failing **closed on writes** |
| `tools/smoke-session.mjs` | Uses `splitStorage`: the token is in `localStorage` and survives a `sessionStorage` wipe; `clearLocalAuth()` empties both stores and stops the nudge poll; the poll **restarts** after an in-page re-login; and `confirmSessionAlive()` resolves **true** when fetch rejects |
| `tools/smoke-backend.mjs` | Regex over `backend.gs`, which cannot run in Node: deleted machinery is really gone, the owner's constants hold, the router dispatches nothing outside `try`, the must-change branch returns before any session is minted, the sentinel **allowlist** is an allowlist, and **every** `MailApp.sendEmail` site is quota-checked (walked to its enclosing function — a flat scan would pass on a truncated window). Its `fnBody()` helper requires `(` after a function name, so `createUser` cannot silently match `createUserRow`. |
| `tools/smoke-boot.mjs` | **Real headless Chrome** (`--headless=new --dump-dom --virtual-time-budget`), served from a local `http.createServer`. Phase 1 boots the real app; phase 2 synthesizes a fixture page with `window.fetch` stubbed to return a crafted CSV, proving the whole chain reaches the DOM; phase 3 loads the app with the dev bypass **off** — the signed-out login screen every new employee starts on — and asserts the deleted sign-up controls are absent from the DOM entirely, not merely hidden. Exits 0 with a `SKIP` line if no Chrome is found. |

`node --check` does not understand the `.gs` extension. To syntax-check the
backend, copy it to a `.js` file first:

```bash
cp backend.gs /tmp/backend-check.js && node --check /tmp/backend-check.js
```

**Know what `smoke-backend.mjs` can and cannot prove.** It is a regex suite over
the source, so it asserts that the code is *shaped* a certain way — never that it
*behaves* that way. Three real defects (an unenforced temp-password expiry on
`changePassword`, `resetPassword` re-enabling a disabled account, and an uncapped
nudge mail path) passed all 444 cases, one of them under a heading that claimed the
opposite. If you are changing something security-shaped and have no way to execute
it here, the honest move is to stub the Apps Script globals
(`SpreadsheetApp` / `MailApp` / `Utilities` / `PropertiesService` / `LockService`)
in a throwaway script and actually call the function — or hand it to a second
reviewer with that instruction. More regex cases will not find it.

**When you add a suite, name it `tools/smoke-*.mjs`** — `smoke-all.mjs` discovers
suites by that pattern. Suites must be independent and exit non-zero on failure.

Two rules the tests enforce that are easy to break by accident:

- Every id `app.js` touches at parse time must exist in `index.html`, or the app
  dies before it starts. `smoke-shell.mjs` parses the source for this rather than
  keeping a hand-written list that would drift.
- The 📋 Report pane must contain **no** `<input>`, `<textarea>` or `<select>`. It
  is the client's original report; an editable control there would imply the app
  edits it.