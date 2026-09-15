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

The app is static files, so deploy to any static host:

- **Netlify** — drag the folder to Netlify Drop
- **Vercel** — `vercel --prod` from the project root
- **GitHub Pages** — push to a repo and enable Pages
- **Firebase Hosting** — `firebase deploy`

No build step required — deploy the files as-is.

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
- **Status field** — `a_overallStatus` is the source of truth for IR status on the
  index. Its 14 values are mapped to Frappe's Open/Paused/Resolved/Closed
  **categories** by `STATUS_CATEGORIES` in `app.js` for pill colouring — the
  values themselves are never renamed, because the customer Google Form writes them
- **Shell DOM is static** — `app.js` captures twelve element references at parse
  time (`app.js:434-445`), so `index.html` must keep those ids and `app.js` must
  stay a plain end-of-body `<script src>` (never `type="module"`/`defer`)
- **View state is inline** — `renderLayout()` is the only place that writes
  `indexView`/`detailView`/`backBtn` display, and it must keep writing *inline*
  styles: `applyAccessGating` reads `detailView.style.display`, and
  `applySectionAccessGating` selects `.tab:not([style*="display: none"])`