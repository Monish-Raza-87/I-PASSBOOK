# 08 — Development Guide

## Running Locally

Since this is a vanilla HTML/CSS/JS app with no build tools:

```bash
# Recommended — no dependencies, cannot fail on a machine with no registry access
node tools/serve-local.mjs          # → http://localhost:3000/
node tools/serve-local.mjs 8080     # a different port

# Alternatives
python -m http.server 3000
npx serve -l 3000 -s                # downloads a package on first run
# ...or the VS Code Live Server extension: right-click index.html
```

> **Prefer `tools/serve-local.mjs`.** `npx serve` has to fetch the package on first
> run, and when that fails it fails **silently** — no error, no server, just a
> browser that cannot reach localhost. The script also sends
> `Cache-Control: no-store`, so an edited stylesheet is not served out of the
> browser's own cache.

Then open: `http://localhost:3000/?dev=1`

The `?dev=1` query parameter activates **dev auth bypass** — you'll be logged in as "Dev Tester" (with admin access) without needing a real account. This only works on `localhost`/`127.0.0.1`/`::1`.

Backend calls are left **unauthorized** in this mode (there is no session to attach),
so the app falls back to demo data. That is what makes it safe: **nothing done in a
`?dev=1` session can read or write the live Drive store.** It is for inspecting the
UI — layout, the palettes, the polish level — not for testing data.

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

**Use the tool, not `git checkout gh-pages`.** `tools/deploy-ghpages.mjs` copies
`main`'s served files across with git plumbing, so it never checks out the branch
and never touches your working tree:

```bash
node tools/deploy-ghpages.mjs                 # dry run — says exactly what would ship
node tools/deploy-ghpages.mjs --commit        # writes the commit on gh-pages (local)
node tools/deploy-ghpages.mjs --commit --push # ...and pushes. THIS IS THE DEPLOY.
```

It refuses to run with a dirty tree (deploying a file that is not committed is how
`gh-pages` drifts from `main`), enumerates the served set rather than globbing — a
glob over the repo would ship `backend.gs` to a public site — carries `.nojekyll`
over, and **warns when `CACHE_NAME` has not changed**. Always dry-run first; the
push is the one command here that reaches users.

Two things not to forget on every deploy:

- **Bump `CACHE_NAME` in `sw.js`** (e.g. `ipassbook-v22` → `v23`) on any deploy that
  changes a cached asset, or returning users keep the stale shell. The service
  worker is stale-while-revalidate, so existing installs pick the new version up
  without a reinstall — one reload behind, which is why the bump matters. The deploy
  tool prints the old and new value and warns if they match.
- **`gh-pages` is not `main`.** Committing on `main` deploys nothing. Confirm the
  two are in sync before telling anyone it shipped — the dry run's commit line
  (`main <sha> → gh-pages <sha>`) is how you check, and `git ls-remote origin gh-pages`
  confirms what is actually live.

## Deploying the Backend (GAS)

GAS separates the **editor** code from the **deployed** version that serves
`/exec`. There is no migration to sequence any more — the app's data lives in
Drive JSON files that the *deployed* code and the *editor* code read identically,
and the old backend never looks at `_store/`. So the order below is simply: set up
the store, then deploy.

**This is a NEW Apps Script project, under `monish.raza@indrones.com`.** The data
and the backend sit in one account, and `customer.relations@` is out of the
picture. See [05 — Configuration & Secrets](05 - Configuration & Secrets.md) for why.

> ### ⚠️ Where things stand now — read before following the steps below
>
> The project **exists and is live**: its `/exec` ends **`jQXatfT/exec`**, and
> `app.js` already points at it. So most of the original cutover below has already
> happened, and two of its steps are now **wrong for this project**:
>
> - **Do not create a new project, and do not use "New deployment".** For every
>   later deploy of *this* project, use **Deploy → Manage deployments → pencil →
>   New version**. A "New deployment" mints a different `/exec` and breaks every
>   installed client, because the URL lives in a cached `app.js`.
> - **The backend is now current too — done 2026-09-19.** Both halves are live:
>   `gh-pages` @ `f101611` (`CACHE_NAME` `ipassbook-v34`) serves the emailed-code
>   frontend and the live backend is the branch's `backend.gs`, so a password login
>   really does answer `otpRequired` and the code box appears. The steps below still
>   describe how to get there because they are how the next backend change ships.
>   **Deploy the backend last, never first** — new backend + old frontend is the
>   combination that locks everybody out, because the old frontend has nowhere to
>   type the code.
>
> **After the deploy, run `installArchiveTrigger()` once** from the editor, signed in
> as `monish.raza@indrones.com` — that is the account that owns the Drive folder, and
> the trigger executes as whoever installed it. Until you do, closed IR folders are
> archived only when `archiveClosedIRs()` is run by hand. Confirm exactly one trigger
> appears in the project's Triggers page; the function is idempotent, so a second run
> is safe but should add nothing.


**Step 1 — one-time setup (run from the editor, before the deploy).**
1. Sign in to [script.google.com](https://script.google.com) **as
   `monish.raza@indrones.com`** and create a new project
2. Paste the contents of `backend.gs` — **do not deploy yet**
3. Update `CONFIG` values if Drive IDs change
4. Run, from the editor's function dropdown, in this order — pick the function and
   press **Run**. Its report appears in the **Execution log** (View → Execution log,
   or the panel at the bottom). Nothing else is printed, so an apparently blank run
   means *look at the log*, not that the function was silent: these functions log
   their reports precisely because the editor never displays a return value. The
   first run in a session asks for authorisation once — *Review permissions →
   Advanced → Go to project (unsafe) → Allow* — which is the `script.send_mail`
   scope the comment notifications need.
   - `initializeStore()` — creates `_store/` inside `CONFIG.DRIVE_ROOT_FOLDER_ID`,
     makes its three subfolders, sets the folder **Private (not link-shared)**, and
     seeds the empty files. It is idempotent by guard, not by accident: an existing
     file is left exactly as it is. **Confirm `_store/` appeared and is not shared.**
   - `seedDepartments()` — writes the owner's department → section grants, plus
     `Triage` for CR and Management. It reports `created` / `updated` (naming the
     delta, e.g. `qc: +sec-f, -sec-g`) / `unchanged`, and critically a **`dropped`
     list** — any existing grant the new mapping does not reproduce. **Read the
     dropped list.** A rewrite is the one thing that can lose a grant silently.
   - `seedMemberships()` — adds one department edge per person. It **only ever
     adds** and says so; nothing is removed. Emails with no account are printed —
     the edge is correct and harmless, but those people cannot sign in yet.
   - `bootstrapAdmin()` — creates the admin account if missing and prints a one-time
     temporary password **to the execution log**; if it exists it is left alone and
     only the flags are normalised. **Run this before handing out anything, and
     copy the password out of the log then** — it is not stored anywhere else.
   - `seedAccounts()` — creates **one account per seeded member** and prints each
     address with its temporary password. The roster is the union of
     `SEED_MEMBERSHIPS`, not a second list, so every department edge that
     `seedMemberships()` created has an account behind it. It is **additive**: an
     account that already exists is skipped and its password is left alone, so
     re-running it is safe and cannot invalidate a password someone is using. Run it
     **after** `bootstrapAdmin()` — admin addresses are skipped here.
5. **Copy the credentials into a local txt now** — the admin's password from
   `bootstrapAdmin()` and the whole `seedAccounts()` table. This is the handover
   document for Step 4. **Never the repo — it is public.** Note that the log is not
   a safe home for them either: anyone with editor access to the project can read it,
   and it does not last forever. Clear those two lines from the log once copied.

`maintenancePruneSessions()` and `maintenancePruneAuditLog()` are **anytime after
go-live**, not pre-flight — they are destructive and manual, and the audit trail is
evidence that must not shrink behind anyone's back.

The old pre-flight order (`migrateAddColumns` → `migrateAclReport` →
`bootstrapAdmin`, then a ~2-minute cutover window) existed because widening a
`DEPARTMENTS` tab would be read *positionally* by the still-live old backend and
misgrant every section, and because the `APP_DATA` merge rewrote rows the live app
was reading. Neither exists now: there are no columns and no rows, `_store/` is a
folder the old backend never looks at, and the store starts empty.

**Step 2 — deployment.**
1. Deploy → **New deployment** → Web app:
   - Execute as: **Me**
   - Who has access: **Anyone**
2. Copy the `/exec` URL.
3. Check `monish.raza@` has at least **view** access to the client's `Form Responses`
   sheet and the legacy workbook — the script reads both as the executing account.
   **Check this before the cutover, not during it.**
4. **Test the new URL on its own before touching the frontend**: a plain
   `?action=ping` in a browser tab, then `?action=getPassbook&irNumber=IR409` with a
   real token. Only once it answers correctly do `app.js` and `gh-pages` change —
   which keeps the frontend pointing at a working backend for the whole window.
5. Update `CONFIG.GAS_URL` in `app.js:13` to the new `/exec` URL, **bump
   `CACHE_NAME` in `sw.js`** (the URL constant lives in a cached asset), and
   **deploy the frontend** — `node tools/deploy-ghpages.mjs` to dry-run,
   then `--commit --push`. (The live value is `ipassbook-v19` and `main` already
   carries `v22`, so that bump is satisfied; the tool prints both and warns.)

> ⚠️ **This is the one project where "New deployment" is right.** The rule below —
> never create a new deployment, edit the existing one — protects the **existing**
> project's `/exec` URL. This project is new, so its URL is *expected* to differ, and
> the old project stays alive, untouched, as the rollback. For any *later* deploy of
> **this** project, edit the existing deployment.

**Step 2b — the Google door: a SECOND deployment of the same project.** Skip this
and Google sign-in is simply absent; nothing else about the app changes. Do it out
of order (after any number of primary re-deploys) and it still works — it only
needs *a* version, and it is fine for both deployments to serve the same one.

> **Any change to `backend.gs` must be re-deployed to BOTH deployments**, because the
> door's two halves run on different ones: `googleStart` is served by this one, and
> `googleExchange` by the primary. Publishing a new version to the primary alone leaves
> the door half-updated — the click leaves for a deployment still running the old code
> and comes back with a code the new primary may not understand. When in doubt, redeploy
> the primary first (it is the one every other request uses), then this one.

1. Deploy → **New deployment** → Web app, and here — the one place it is required —
   that is *not* the mistake Step 2's warning is about: the second deployment is
   **additive**, and the first one's `/exec` is not touched by it.
   - Description: `Google door`
   - Execute as: **Me**
   - Who has access: **Anyone within indrones.com**
2. Copy **that** `/exec` URL — not the first one — into `CONFIG.SSO_URL` in `app.js`
   (see [05](05 - Configuration & Secrets.md)), bump `CACHE_NAME`, and deploy the
   frontend.
3. Sign out and click **Sign in with Google**. You should land on a small I-PASSBOOK page
   saying *Signed in as you@indrones.com* with a **Continue to I-PASSBOOK** button; one
   tap puts you in. If the button does not appear at all, `CONFIG.SSO_URL` is empty. If it
   appears and the page says *"Google did not report an account for this browser"*, this
   deployment's access level is wrong: under plain "Anyone", `Session.getActiveUser()`
   returns `''` for every caller and the ladder refuses every time. Check the access level,
   not the code. If you tap Continue and get *"That Google sign-in link is no longer
   valid"*, the primary deployment is not serving the version that has `googleExchange` —
   see the note above. If instead you see a page of **HTML source code**, the deployment is
   serving a version older than the one that switched to `HtmlService` — `ContentService`
   cannot serve a page, and that is what a page served through it looks like.

> **Why a second deployment rather than flipping the first.** Google refuses a
> domain-restricted request at its own edge, before the script runs. Flipping the
> primary to domain-only would therefore kill the **password** door too, for exactly
> the people who need it: a shared machine with no Google session, and the external
> address in `CONFIG.EXTERNAL_EMAILS`, which no domain restriction admits. Two
> deployments, one script, two doors.
>
> **Why the door is opened by a NAVIGATION and not a `fetch`.** This is the one thing
> about this feature that is easy to "simplify" back into a bug. A background `fetch`
> from the gh-pages origin to the domain-scoped deployment is answered by Google with
> **401 before the script runs** — a cross-site background request does not carry the
> caller's Google session cookie, and no amount of CORS configuration on our side
> changes that, because the refusal happens above us. A **top-level navigation** to the
> same URL reports the caller perfectly. That is why the button sets `location.href`,
> and why the answer comes back as a one-time code in the URL fragment for the primary
> deployment to redeem. If you are ever tempted to replace it with a `fetch`, this
> paragraph is the reason not to.
>
> **Why the door ends with ONE TAP and not a redirect.** Also easy to "simplify" back
> into a bug, and it already was one. Apps Script cannot bounce a top-level window back
> on its own, twice over: `ContentService` has **no `HTML` mime type**, so a page served
> through it goes out as plain text and the user is shown the page's *source*; and since
> the September 2021 IFRAME sandbox change a script page may not navigate the top window
> without a user gesture, so a scripted `location.replace()` would move only Google's
> frame. The shipped version did both and failed silently — the Workspace identity was
> read and a real code was minted, and the user just saw code. So the door returns an
> `HtmlService` page carrying one `<a target="_top">` link the user taps. **Do not put a
> `<script>` or a `location.` assignment back into `handoffPage`**, and do not reach for
> `ContentService` to serve it — `tools/smoke-backend.mjs` pins both.
>
> Rolling back is deleting the `Google door` deployment and clearing `CONFIG.SSO_URL`.
> No code change, no data touched.
>
> **The return trip is covered, not blank.** Swapping the handed-back code for a session
> is one Apps Script round trip, and until it finishes there is no screen to show — so
> `index.html` raises `#sso-wait` **before paint** for a `#sso=` return and `app.js`
> clears it from `showAuth()` and `showApp()`. The owner's report was that the *sign-in
> form* showed through that gap. Two things not to "tidy up": do not turn the attribute
> gate into a class toggled from `app.js` (the form would flash underneath for exactly
> the round trip the screen exists to cover), and do not widen it from `'#sso='` to
> `'#sso'` (a `#ssoerr=` refusal has nothing to wait for — it must land on the form with
> the door's reason already on it). `tools/smoke-ui.mjs` pins both, and the attribute
> round trip itself.

**Step 3 — verify.** Hard-reload, sign in as the admin, complete the forced
password change, and open User Access — the footer must read `API v3`. If it does
not, the deployment was not the one `/exec` serves. Then check seven tabs
(`📋 Report` + six lettered), `sec-b` selected by default, the Overview rendering
its facts, timeline and legacy log, and 🕓 History opening. Then **save a section,
reload, and confirm it came back** — that is the round trip that proves the store
is writable, not just readable.

**Then sign in as a CR account and a Production account.** CR must see the Triage
button and have **no** section save enabled; Production must have Triage **hidden**
and B/C/D/E/G save-enabled with F read-only. This is the check that catches the
`sec-a` permission gap — the Overview is dropped for every non-admin if
`getPassbook` filters on a permission map that no longer contains `sec-a`, and the
admin testing it would never see the bug.

**Step 4 — users.** Every account is provisioned fresh, so distributing credentials
**is** the onboarding. Announce the day before and again at cutover, and deliver
each person's block individually — never nineteen passwords in one message.

**Step 5 — hygiene.** Delete the local credentials txt (or move it to a password
manager). Watch the GAS Executions panel for a day: the restructured `try/catch`
surfaces errors as JSON instead of silent HTML pages. **Keep the old Apps Script
project and the old spreadsheet for 30 days** — reverting the one line in `app.js`
and pushing returns the app to the old backend, with no data lost.

**The ejection check** (worth running once, because it is the failure mode the
Drive store introduced): rename `sessions.json` in `_store/`, confirm the app
reports a store error and does **not** sign anyone out, then rename it back. A
session store that cannot be read must never be reported as "your session died".

## Google Cloud Setup

**Not required.** Auth is email + password handled entirely by `backend.gs`; there
is no `CONFIG.GOOGLE_CLIENT_ID` and no OAuth client to create. The only Google
Cloud–adjacent requirement is that the Apps Script deployment runs as an account
that can read the Sheets and Drive folders listed in `CONFIG` at the top of
`backend.gs`, and that it holds the `script.send_mail` scope for the email flows.

## Google Drive Setup

The app's data is **JSON files in Drive**, owned by `monish.raza@indrones.com`, in
one folder:

```
1itfTVbllh8Mi6TD6I2_OyYp_Wj4xrLIK/          ← CONFIG.DRIVE_ROOT_FOLDER_ID
├── IR409/  IR410/  …                       ← uploads, one FOLDER per ticket
└── _store/                                 ← Restricted. Staff never open this.
    ├── users.json      sessions.json       codes.json      attempts.json
    ├── access.json     { departments: {…}, memberships: {…} }
    ├── irs.json        { "IR409": {status, assignee, priority, category, …}, … }
    ├── config.json     { "team-directory": …, "inward-options": …, "iqc-config": … }
    ├── kb.json         { "<key>": {…} }
    ├── comments.json   { "all": { "items": [ … ] } }
    ├── sections/       IR409.json → { "sec-b": {…}, "sec-f": {…} }  +  index.json
    ├── audit/          IR409.jsonl — one JSON object per line, append-only
    │                   signins.jsonl — the same shape, for sign-ins (see docs/10)
    └── backups/        <store>-<yyyy-MM-dd-HHmmss>.json — always a NEW file
```

Everything is created by `initializeStore()` — there is no `getOrCreate*`
function any more, and **no read path may create a file**. A read that silently
brought `users.json` into existence would turn a misconfigured deploy into an empty
store, and an empty `users.json` is every account missing at once.

Three rules that the code and the suites both enforce:

- **`_store/` is Restricted; upload files are shared individually.** The upload
  *folders* are link-shared (as they always were) and each uploaded **file** gets
  `ANYONE_WITH_LINK` on itself, so links in a passbook keep working. `_store/` —
  password hashes, salts, session tokens — is `PRIVATE` / `NONE`. This is the one
  place where the sheet→file move could have weakened security, and it is closed by
  folder placement rather than by a new mechanism.
- **Every store write replaces ONE KEY, never the file.** All five subjects resolve
  to "a JSON object that maps a key to a fields object", so `saveSection` does
  `store[sectionId] = fields`. `writeJson('config.json', fields)` would wipe the
  team directory and the dropdown config; `writeJson('irs.json', row)` would wipe
  the workflow state of all 450 tickets. See "THE ONE STORE PATH" in `backend.gs`.
- **`readJson` returns `null` only for a file that provably is not there.** An empty
  file, an unreadable file or a `JSON.parse` failure **throws**. There is
  deliberately no `fallback` argument: a corrupt `users.json` that read as "no
  accounts" would have the very next `createUser` persist that emptiness plus one
  account.

Two more details that are load-bearing:

- **`sections/index.json` maps IR → file id, and is read via `getFileById`** — a
  direct fetch. `getFilesByName` is a Drive *search* and is eventually consistent:
  a miss right after a create would write a second `IR409.json` and silently fork the
  ticket. The name search survives only as a self-healing fallback, and a
  multi-match is resolved by **newest**, never arbitrarily. For the same reason
  `writeIR` **refuses** to write without a file id.
- **The lock is not optional.** Drive has no transactions, no atomic append and no
  compare-and-set: every write is a whole-file `setContent`, so two concurrent
  writers that each read before the other wrote lose one of the two saves. In the
  sheet version two saves upserted two separate *rows* and could not clobber each
  other, so this is a genuine new cost of the move. `withRowLock` therefore covers
  the **read** as well as the write, and inside it a read is always
  `readJsonLocked` — never the memoised `readJson`, whose copy may predate the lock.

### The two read-only input Sheets

These are **inputs**, not stores. Nothing in the app writes to either.

| Sheet | `CONFIG` key | Used for |
|---|---|---|
| Customer Support Form (External) (Responses) | `IR_REPO_SHEET_ID` | tab `Form Responses` only — columns A (summary link), B (IR Number), C (timestamp), K (drone serial no.) |
| Legacy workbook | `LEGACY_SHEET_ID` | the 🏛 Legacy read-only view |

`SpreadsheetApp` appears in exactly two functions — `listIRs()` and
`listLegacyIRs()` — and the suites assert that, because a third appearance would
mean the app is writing to a sheet again.

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
  time (`app.js:699-726` — 28 of them), so `index.html` must keep those ids and `app.js` must
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
| `tools/smoke-backend.mjs` | Regex over `backend.gs`, which cannot run in Node: deleted machinery is really gone, the owner's constants hold, the router dispatches nothing outside `try`, the must-change branch returns before any session is minted, the sentinel **allowlist** is an allowlist, **every** `MailApp.sendEmail` site is quota-checked (walked to its enclosing function — a flat scan would pass on a truncated window), and **no positional column layout survives**: every `SpreadsheetApp.` site is walked to its enclosing function and must be one of the two read-only inputs, and every store function is asserted free of `getRange`/`getRows`/`appendRow`/`setValues`/`USER_HEADS`/`userCol`/`ensureHeaders`. Its `fnBody()` helper requires `(` after a function name, so `createUser` cannot silently match `createUserRow`. |
| `tools/smoke-store.mjs` | **Executes** the real `backend.gs` under a fake Drive platform in `node:vm` and calls the store functions for real — the only suite that can prove *behaviour* here. It pins both halves of the lock claim (the read is inside it, and a racing save is refused rather than lost), the one-key write (`__IRS__` patch leaves IR410 intact; `iqc-config` leaves `team-directory`), `readJson`'s throw-don't-fallback contract, the audit landing **after** the data write and per-ticket, `getPassbook` through the index, the name-lookup-miss that no longer forks a ticket, `assertRealIR` refusing a path-shaped IR, `purgeUsers` backing up before it destroys, `sessionCheck` failing **open**, and uploads landing in the root IR folder with only the **file** link-shared. |
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
nudge mail path) passed all 444 cases of the earlier version, one of them under a
heading that claimed the opposite.

For anything store-shaped or concurrency-shaped, the honest move is
**`tools/smoke-store.mjs`**, which already stubs the Apps Script globals
(`SpreadsheetApp` / `MailApp` / `Utilities` / `LockService` + a fake `DriveApp`) and
*actually calls* the function. Add a case there. It found two production bugs the
regex suite could not: `sec-g` sitting in `RETIRED_SECTION_IDS` (so every PDI
Report save was refused), and a ticket-forking name lookup on the write path. If
the thing you are changing cannot be executed there either, hand it to a second
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