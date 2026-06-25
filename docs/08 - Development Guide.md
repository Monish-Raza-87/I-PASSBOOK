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

The `?dev=1` query parameter activates **dev auth bypass** — you'll be logged in as "Dev Tester" without needing a real Google account. This only works on `localhost`/`127.0.0.1`/`::1`.

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

The Google OAuth Client ID in `app.js` comes from a Google Cloud project. To recreate:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Enable **Google Identity** API
4. Create OAuth 2.0 Client ID (Web application)
5. Add authorized JavaScript origins (your deployment domain)
6. Add authorized redirect URIs
7. Copy the Client ID to `CONFIG.GOOGLE_CLIENT_ID`

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
- **CSS custom properties** for all colors/sizes — use `var(--primary)` etc.
- **Mobile-first** — always test on phone viewport first
- **Dev bypass** — always use `?dev=1` for local development
- **Status field** — `a_overallStatus` is the source of truth for IR status on the index