# 05 — Configuration & Secrets

## What's Hardcoded in `app.js`

| Item | Location | Current Value | Notes |
|---|---|---|---|
| GAS Web App URL | `CONFIG.GAS_URL` | `https://script.google.com/macros/s/AKfycbz.../exec` | The **new** project under `monish.raza@indrones.com`. Until this is switched the app keeps talking to the old backend — which is also the rollback (see [08](08 - Development Guide.md)) |
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
> the salt and an issued-at timestamp ever reaches the store; and the local
> credentials txt is deleted once the passwords have been handed over.

## What's Hardcoded in `backend.gs`

| Item | Location | Current Value |
|---|---|---|
| IR Repository Sheet ID | `CONFIG.IR_REPO_SHEET_ID` | `1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4` — **read-only input** |
| Legacy workbook ID | `CONFIG.LEGACY_SHEET_ID` | `14VnWnCg-W7I8Vv97amhuwfSqiozictVMivO3F9Bed5s` — **read-only input** |
| Drive Root Folder ID | `CONFIG.DRIVE_ROOT_FOLDER_ID` | `1itfTVbllh8Mi6TD6I2_OyYp_Wj4xrLIK` — the store is `_store/` inside it |
| Store folder name | `CONFIG.STORE_FOLDER_NAME` | `_store` |
| Allowed Domain | `CONFIG.ALLOWED_DOMAIN` | `indrones.com` |
| Admin emails | `CONFIG.ADMIN_EMAILS` | `['monish.raza@indrones.com']` |
| External exceptions | `CONFIG.EXTERNAL_EMAILS` | `['kishor.salunkhe@uavgarage.com']` |
| API version | `CONFIG.API_VERSION` | `3` — the Drive-JSON store. A different deployment from v2 |
| Session / temp-password TTL | `SESSION_DAYS` · `TEMP_PW_TTL_DAYS` | `30` · `14` |

`CONFIG.PASSBOOK_SHEET_ID` and `CONFIG.DATA_TAB` are **gone**. The old
"I-Passbook App Repository" spreadsheet is not read, written or required by
anything in the app any more; it is left on Drive untouched as an archive.

The `DRIVE_ROOT_FOLDER_ID` here **replaces** the older `1W41jpmn…` folder that
earlier revisions of this document listed. The store must sit in `monish.raza@`'s
own Drive, not in a folder shared with `customer.relations@` — that account is used
by several people, so anything in it is deletable by any of them.

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
   `login`/`changePassword` (one shared `attempts.json`) and on `forgotPassword`
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
   session: a must-change account is minted **no token** at all until it sets its
   own password. The expiry is enforced on **both** doors that accept the
   credential (`login` *and* `changePassword`, which is unauthenticated and takes
   the same password) — enforcing it on only one left the side door open. The weak
   link is the handover message, not the store.
6. **One admin is a bus factor of one.** Nobody else can provision or unblock
   anyone. Adding one is a one-line `ADMIN_EMAILS` edit plus a GAS redeploy.
7. **The session token is stored and travels in plaintext.** Tokens are opaque
   random strings, kept as **keys of `sessions.json` in `_store/`** (not hashed), so
   anyone who can read that file can impersonate any live session. That is why
   `_store/` is **Restricted** and its parent folder is not link-shared, and it is
   why the store lives in `monish.raza@`'s Drive rather than a folder several people
   can open. `sessionCheck` is the one call that puts the token in a URL
   (`?action=sessionCheck&sessionToken=…`) because it is a GET probe; GAS logs the
   URL, so the token can appear in the Executions panel. Every other call posts it
   in a form body. Moving `sessionCheck` to a POST body is a worthwhile small
   change.
8. **Uploads are `ANYONE_WITH_LINK`, the store is not.** Every uploaded **file**
   gets `ANYONE_WITH_LINK` on itself so the link in a passbook keeps working; the
   upload **folders** stay browsable by link, exactly as before. `_store/` is
   `PRIVATE` / `NONE`. Sharing is per-file rather than per-folder, which is what
   makes those two facts compatible — and it is why `saveSection` refuses a sentinel
   store that carries files, since that path would otherwise create a link-shared
   file through the app's own quota.
9. **The frontend reads the IR master list from a link-shared Sheet**, bypassing the
   token gate entirely — see `docs/07`. The app being the pane of glass does not
   close that; it only stops staff *needing* the Sheet.
10. **The Drive store has no transactions.** Every write replaces a whole file, so
    the correctness of a save rests on `withRowLock` and on reads inside it being
    taken *after* the lock. Two things follow: a save that cannot get the lock is
    refused rather than applied (`withRowLock`, `LOCK_BUSY_MESSAGE`), and a session
    store that cannot be read must fail **open** in `sessionCheck` — reporting it as
    "your session died" would sign out all twenty users in one poll window.