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

The `?dev=1` query parameter activates **dev auth bypass** — you'll be logged in as "Dev Tester" without needing a real account. This only works on `localhost`/`127.0.0.1`/`::1`.

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

- **Bump `CACHE_NAME` in `sw.js`** (e.g. `ipassbook-v19` → `v20`) on any deploy that
  changes a cached asset, or returning users keep the stale shell. The service
  worker is stale-while-revalidate, so existing installs pick the new version up
  without a reinstall — one reload behind, which is why the bump matters.
- **`gh-pages` is not `main`.** Committing on `main` deploys nothing. Confirm the
  two are in sync before telling anyone it shipped.

## Deploying the Backend (GAS)

1. Open [script.google.com](https://script.google.com)
2. Create a new project or open the existing one
3. Paste the contents of `backend.gs`
4. Update `CONFIG` values if Sheet/Drive IDs change
5. Deploy → New deployment → Web app
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the web app URL and update `CONFIG.GAS_URL` in `app.js`

## Google Cloud Setup

**Not required.** Auth is allowlist-gated email + password handled entirely by
`backend.gs`; there is no `CONFIG.GOOGLE_CLIENT_ID` and no OAuth client to
create. The only Google Cloud–adjacent requirement is that the Apps Script
deployment runs as an account that can read the Sheets and Drive folders listed
in `CONFIG` at the top of `backend.gs`.

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
  styles: `applyAccessGating` reads `detailView.style.display`, and
  `applySectionAccessGating` selects `.tab:not([style*="display: none"])` — with a
  `:not([data-intake])` exclusion, because the 📋 Report tab is never hidden and
  would otherwise always win that fallback

## Tests

There is no test framework and no build step; the suites are plain node scripts
that run the real `app.js` and report one verdict:

```bash
node tools/smoke-all.mjs        # every suite
node tools/smoke-intake.mjs     # one suite
```

| Suite | Approach |
|---|---|
| `tools/harness.mjs` | Shared: evaluates `app.js` under a stubbed DOM in `node:vm` and returns a `__T` object built from getters appended in the same lexical scope. Because `app.js` has no exports, this is the only way to reach into it — and running the file is itself half the test, since every parse-time `getElementById` and module-level statement executes for real. |
| `tools/smoke-shell.mjs` | Derives the ids `app.js` reads **from its source** and asserts each exists in `index.html`; tab/pane counts; the `<script>` contract; stylesheet cascade order; token-only CSS |
| `tools/smoke-ir-state.mjs` | `__IRS__` load / merge / ownership |
| `tools/smoke-intake.mjs` | The Sheet column map and the 📋 Report rendering |
| `tools/smoke-boot.mjs` | **Real headless Chrome** (`--headless=new --dump-dom --virtual-time-budget`), served from a local `http.createServer`. Phase 1 boots the real app; phase 2 synthesizes a fixture page with `window.fetch` stubbed to return a crafted CSV, proving the whole chain reaches the DOM. Exits 0 with a `SKIP` line if no Chrome is found. |

**When you add a suite, name it `tools/smoke-*.mjs`** — `smoke-all.mjs` discovers
suites by that pattern. Suites must be independent and exit non-zero on failure.

Two rules the tests enforce that are easy to break by accident:

- Every id `app.js` touches at parse time must exist in `index.html`, or the app
  dies before it starts. `smoke-shell.mjs` parses the source for this rather than
  keeping a hand-written list that would drift.
- The 📋 Report pane must contain **no** `<input>`, `<textarea>` or `<select>`. It
  is the client's original report; an editable control there would imply the app
  edits it.