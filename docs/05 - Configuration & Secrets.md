# 05 — Configuration & Secrets

## What's Hardcoded in `app.js`

| Item | Location | Current Value | Notes |
|---|---|---|---|
| GAS Web App URL | `CONFIG.GAS_URL` | `https://script.google.com/macros/s/AKfycbz.../exec` | Must be replaced on new GAS deployments |
| Allowed Domain | `CONFIG.ALLOWED_DOMAIN` | `indrones.com` | Only emails ending with this domain can sign up (plus explicit allowlist entries) |
| Dev Auth Bypass | `CONFIG.ENABLE_DEV_AUTH_BYPASS` | `true` | Set to `false` in production |
| IR Repository CSV | `CONFIG.IR_REPO_SHEET_ID` / `IR_REPO_GID` | `1MPcWvgZ...` / `335027370` | Read directly by the frontend from the link-shared sheet |

There is **no Google OAuth client ID** any more. Google Sign-In was replaced by
allowlist-gated email + password auth (OTP + captcha on sign-up, server session
token in `sessionStorage`, idle timeout, login lockout) — so no Google Cloud
project is needed to run this app.

## What's Hardcoded in `backend.gs`

| Item | Location | Current Value |
|---|---|---|
| IR Repository Sheet ID | `CONFIG.IR_REPO_SHEET_ID` | `1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4` |
| Passbook Sheet ID | `CONFIG.PASSBOOK_SHEET_ID` | `14VnWnCg-W7I8Vv97amhuwfSqiozictVMivO3F9Bed5s` |
| Drive Root Folder ID | `CONFIG.DRIVE_ROOT_FOLDER_ID` | `1W41jpmnmIOmoG2XFfdlurkATvFSfxN9r` |
| Allowed Domain | `CONFIG.ALLOWED_DOMAIN` | `indrones.com` |

## PWA Config (`manifest.json`)

- `name`: "I-PASSBOOK"
- `short_name`: "I-PASSBOOK"
- `display`: "standalone"
- `theme_color`: "#0E62FF"
- `background_color`: "#0b1120"

## Security Concerns

1. **Client IDs exposed** — OAuth Client ID and GAS URL are in client-side JS. This is acceptable for OAuth (client IDs are not secrets), but the GAS endpoint has **no server-side auth check** — anyone with the URL can call `listIRs` and `getPassbook`.
2. **No CORS restriction** — The GAS endpoint returns JSON to any origin.
3. **File upload auth** — File uploads to Drive use the GAS service account, not the user's Google auth. All uploaded files get `ANYONE_WITH_LINK` sharing.
4. **Session storage only** — User auth is stored in `sessionStorage`, not persisted across tabs/windows.