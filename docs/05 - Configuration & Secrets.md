# 05 — Configuration & Secrets

## What's Hardcoded in `app.js`

| Item | Location | Current Value | Notes |
|---|---|---|---|
| GAS Web App URL | `CONFIG.GAS_URL` | `https://script.google.com/macros/s/AKfycbz.../exec` | The **new** project under `monish.raza@indrones.com`. Until this is switched the app keeps talking to the old backend — which is also the rollback (see [08](08 - Development Guide.md)) |
| Allowed Domain | `CONFIG.ALLOWED_DOMAIN` | `indrones.com` | Emails must end with this domain, plus the `EXTERNAL_EMAILS` exceptions in `backend.gs` |
| Dev Auth Bypass | `CONFIG.ENABLE_DEV_AUTH_BYPASS` | `true` | Set to `false` in production |
| IR Repository CSV | `CONFIG.IR_REPO_SHEET_ID` / `IR_REPO_GID` | `1MPcWvgZ...` / `335027370` | Read directly by the frontend from the link-shared sheet |
| Google door | `CONFIG.SSO_URL` | `https://script.google.com/a/macros/indrones.com/s/AKfycbybK8zQxCvU8-.../exec` (set 2026-09-20) | The **second** deployment's `/exec` URL. Note the `/a/macros/indrones.com/` segment — that is what marks it as the domain-scoped deployment, not the primary one. Empty is a working state: the Google button is not shown and nothing else changes. See below and [08](08 - Development Guide.md) |

There is **no Google OAuth client ID**. The `CONFIG.SSO_URL` row above is not a
Client ID and does not need one: it points at a *second deployment of the same
Apps Script project*, set to **Execute as: Me → Who has access: Anyone within
indrones.com**, where `Session.getActiveUser().getEmail()` reports the signed-in
Workspace account of the person making the request. That is the whole mechanism —
documented Google behaviour, no Cloud Console project and no `UrlFetchApp` (which
`smoke-backend.mjs` forbids outright, because it broke Google sign-in once).
Deleting that second deployment turns the feature off with no code change.

**That URL is OPENED, never fetched — and that is measured, not assumed.** The first
version of this door called it with a background `fetch`, and it could never have
worked: a request from the gh-pages origin to the domain-scoped deployment comes back
**401 from Google before our code runs**, because a cross-site background request does
not carry the caller's Google session cookie. The same URL opened as a **top-level
navigation** reports the caller perfectly. So the mechanism is two halves:

1. The click sets `location.href` to `SSO_URL + '?action=googleStart'`. The response is
   an `HtmlService` page naming the account it recognised and carrying **one link** —
   `target="_top"`, because that is the only navigation Apps Script's sandbox permits
   (see below) — back to `CONFIG.APP_URL` with a one-time code in the **fragment**,
   `#sso=<32 hex>`, or `#ssoerr=<why>` for a refusal. **The user taps that one link.**
2. The app reads that fragment once, at parse time, wipes it with `history.replaceState`,
   and POSTs `googleExchange` with the code to the **primary** backend, which is
   "Anyone" and therefore reachable. That call mints the session.

**Why the door cannot send you back by itself.** It was first built as a page that
`location.replace()`d straight back, which is impossible twice over, and both failures
are silent. `ContentService.MimeType` has **no `HTML`** member — so a redirect page
served through it goes out as plain text and the user is shown the page's *source*
instead of running it. And since the September 2021 IFRAME sandbox change an Apps Script
page may not navigate the top-level window without a user gesture
(`allow-top-navigation` became `allow-top-navigation-by-user-activation`), so even with
the right mime it would have moved only Google's frame and left the app inside an iframe
at the wrong origin. Google's documented remedy is a link, so sign-in ends with **one
tap**: *Continue to I-PASSBOOK*, or *Back to sign in* after a refusal.

The code is 32 hex characters (~122 bits) from `Utilities.getUuid()`, single-use, and
live for **two minutes**. It travels in the fragment rather than a query string on
purpose: fragments are never sent to a server, so it cannot land in a proxy log, a CDN
log or a `Referer` header. The link target is built server-side from
`CONFIG.APP_URL` and reads no request parameter — that, not a validation step, is what
makes the door structurally incapable of an open redirect.

**Google sign-in is additive, never a replacement.** Password + emailed code
remains a first-class door and the only one for a machine with no Google session
or an address outside the domain (`EXTERNAL_EMAILS`). Sign-in is **two steps** in
password mode: the password, then a 6-digit code emailed to the same address. The
code is issued once and reused for **8h30m from the send**, so a second sign-in
inside that window (another device) needs no second mail. The window is a duration
from issue, **not** "until the end of the working day" — a first sign-in at 2pm
leaves the code live until 10:30pm. The session is **8h30m and absolute** — one
working day, not slid forward on use — so everyone starts the day with a sign-in.
A temporary password is refused on the Google door and pointed back at the
password door, so the forced first-login change still happens. There is no
self-signup on either door, so there is no captcha or allowlist either. See
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
| Session TTL · temp-password TTL | `CONFIG.SESSION_HOURS` · `CONFIG.TEMP_PW_TTL_DAYS` | `8.5` hours (**absolute**, never slid) · `14` days |

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
   `login`/`changePassword` (one shared `attempts.json`), on the emailed codes
   (3 codes/hour/email, counted across **both** purposes, plus a 60s resend gap and
   a **per-purpose** global hourly ceiling — 12 reset codes, 120 sign-in codes), and
   the daily `MailApp` cap are what keep the open surface from being a guessing
   oracle — they are load-bearing, not decoration.
2. **No CORS restriction** — The GAS endpoint returns JSON to any origin.
3. **File upload auth** — File uploads to Drive use the GAS service account, not the user's Google auth. All uploaded files get `ANYONE_WITH_LINK` sharing.
4. **Sessions are one working day and never slide.** The session token lives in
   `localStorage` for **8h30m from sign-in** and there is **no idle timeout** inside
   that window — an unattended tab stays signed in until the absolute expiry, which
   is the owner's deliberate choice. What is new is that the clock now bounds it: a
   shared or handed-off device is signed out at the end of the shift whether or not
   anyone presses `logout`. It replaced a 30-day sliding session, which never expired
   for exactly the people who used the app most. There is still no device-level
   session management or suspicious-login detection here; the mitigations are
   `logout`, or revoking from the admin's User Access modal.
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