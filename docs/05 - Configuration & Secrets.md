# 05 — Configuration & Secrets

## What's Hardcoded in `app.js`

| Item | Location | Current Value | Notes |
|---|---|---|---|
| GAS Web App URL | `CONFIG.GAS_URL` (line 10) | `https://script.google.com/macros/s/AKfycbz.../exec` | Must be replaced on new GAS deployments |
| Google OAuth Client ID | `CONFIG.GOOGLE_CLIENT_ID` (line 13) | `719566494973-i27l1935v7rrcatv11simfoertsf733a.apps.googleusercontent.com` | Tied to the Google Cloud project |
| Allowed Domain | `CONFIG.ALLOWED_DOMAIN` (line 16) | `indrones.com` | Only emails ending with this domain can log in |
| Dev Auth Bypass | `CONFIG.ENABLE_DEV_AUTH_BYPASS` (line 20) | `true` | Set to `false` in production |

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