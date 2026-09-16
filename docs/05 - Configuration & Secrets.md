# 05 — Configuration & Secrets

## What's Hardcoded in `app.js`

| Item | Location | Current Value | Notes |
|---|---|---|---|
| GAS Web App URL | `CONFIG.GAS_URL` | `https://script.google.com/macros/s/AKfycbz.../exec` | Must be replaced on new GAS deployments |
| Allowed Domain | `CONFIG.ALLOWED_DOMAIN` | `indrones.com` | Emails must end with this domain, plus the `EXTERNAL_EMAILS` exceptions in `backend.gs` |
| Dev Auth Bypass | `CONFIG.ENABLE_DEV_AUTH_BYPASS` | `true` | Set to `false` in production |
| IR Repository CSV | `CONFIG.IR_REPO_SHEET_ID` / `IR_REPO_GID` | `1MPcWvgZ...` / `335027370` | Read directly by the frontend from the link-shared sheet |

There is **no Google OAuth client ID** any more. Google Sign-In was replaced by
admin-provisioned email + password auth — the admin creates each account and
hands over a temporary password, the person sets their own on first sign-in, and
the session then lasts 30 days of activity in `localStorage`. There is no
self-signup, so there is no OTP, captcha or allowlist either. See
[10 — Auth & Access Model](10 - Auth & Access Model.md).

> ⚠️ **Never commit a credential to this repo.** It is **public**, and `gh-pages`
> serves it as a live website. That means: no temp password in a commit message,
> PR body, issue, docs file or test fixture; nothing but `hashPassword(temp, salt)`,
> the salt and an issued-at timestamp ever reaches the Sheet; and the local
> credentials txt is deleted once the passwords have been handed over.

## What's Hardcoded in `backend.gs`

| Item | Location | Current Value |
|---|---|---|
| IR Repository Sheet ID | `CONFIG.IR_REPO_SHEET_ID` | `1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4` |
| Passbook Sheet ID | `CONFIG.PASSBOOK_SHEET_ID` | `14VnWnCg-W7I8Vv97amhuwfSqiozictVMivO3F9Bed5s` |
| Drive Root Folder ID | `CONFIG.DRIVE_ROOT_FOLDER_ID` | `1W41jpmnmIOmoG2XFfdlurkATvFSfxN9r` |
| Allowed Domain | `CONFIG.ALLOWED_DOMAIN` | `indrones.com` |
| Admin emails | `CONFIG.ADMIN_EMAILS` | `['monish.raza@indrones.com']` |
| External exceptions | `CONFIG.EXTERNAL_EMAILS` | `['kishor.salunkhe@uavgarage.com']` |
| API version | `CONFIG.API_VERSION` | `2` |
| Session / temp-password TTL | `SESSION_DAYS` · `TEMP_PW_TTL_DAYS` | `30` · `14` |

## PWA Config (`manifest.json`)

- `name`: "I-PASSBOOK"
- `short_name`: "I-PASSBOOK"
- `display`: "standalone"
- `theme_color`: "#0E62FF"
- `background_color`: "#0b1120"

## Security Concerns

1. **The GAS URL is public and the endpoint answers without auth for the pre-auth
   actions only.** `listIRs`, `getPassbook`, `saveSection` and every admin action
   require a session token; `ping`, `sessionCheck`, `login`, `changePassword`,
   `forgotPassword` and `resetPassword` do not, by necessity. The rate limits on
   `login`/`changePassword` (shared `LOGIN_ATTEMPTS`) and on `forgotPassword`
   (3/hour/email, plus a global hourly ceiling, plus a daily `MailApp` cap) are what
   keep the open surface from being a guessing oracle — they are load-bearing, not
   decoration.
2. **No CORS restriction** — The GAS endpoint returns JSON to any origin.
3. **File upload auth** — File uploads to Drive use the GAS service account, not the user's Google auth. All uploaded files get `ANYONE_WITH_LINK` sharing.
4. **Persistent sessions** — The session token lives in `localStorage` for 30 days
   of activity and there is **no idle timeout**. That is the owner's deliberate
   choice (it is how Google's own products behave), but it means a shared or
   handed-off device stays signed in. There is no device-level session management
   or suspicious-login detection here; the mitigation is `logout`, or revoking
   from the admin's User Access modal.
5. **Temp passwords travel in plaintext** — by design, in a txt the admin hands
   over. They are stored only as a hash, expire after 14 days, and cannot become a
   session: a `Must Change Password` account is minted **no token** at all until
   it sets its own password. The weak link is the handover message, not the Sheet.
6. **One admin is a bus factor of one.** Nobody else can provision or unblock
   anyone. Adding one is a one-line `ADMIN_EMAILS` edit plus a GAS redeploy.
7. **The session token is stored in plaintext and, for `sessionCheck`, travels in a
   query string.** Tokens are opaque random strings in the `SESSIONS` tab (not
   hashed), so anyone who can read the Sheet can impersonate any live session —
   which is why the Sheet must stay private to the deployer. `sessionCheck` is the
   one call that puts the token in a URL (`?action=sessionCheck&sessionToken=…`)
   because it is a GET probe; GAS logs the URL, so the token can appear in the
   Executions panel. Every other call posts it in a form body. Moving
   `sessionCheck` to a POST body is a worthwhile small change.
8. **The frontend reads the IR master list from a link-shared Sheet**, bypassing the
   token gate entirely — see `docs/07`. The app being the pane of glass does not
   close that; it only stops staff *needing* the Sheet.