# 05 — Configuration & Secrets

## What's Hardcoded in `app.js`

| Item | Location | Current Value | Notes |
|---|---|---|---|
| GAS Web App URL | `CONFIG.GAS_URL` | `https://script.google.com/macros/s/AKfycbz.../exec` | The **new** project under `monish.raza@indrones.com`. Until this is switched the app keeps talking to the old backend — which is also the rollback (see [08](08 - Development Guide.md)) |
| Allowed Domain | `CONFIG.ALLOWED_DOMAIN` | `indrones.com` | Emails must end with this domain, plus the `externalEmails` exceptions in `_store/ids.json` (they were in `backend.gs` until v13 — see below) |
| Dev Auth Bypass | `CONFIG.ENABLE_DEV_AUTH_BYPASS` | `true` | Set to `false` in production |
| IR Repository sheet | `_store/ids.json` → `irRepoSheetId` + `CONFIG.IR_REPO_TAB` | *(not in the repo)* / `Form Responses` | Read by the **backend** (`action=listIRs`), token-gated. The **file is restricted to the company**, and the frontend no longer reads it at all — see [07](07 - Known Issues & TODO.md). The id left `app.js` in 2026-10 and left `backend.gs` in v13 |
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

1. The click sets `location.href` to Google's **account picker** —
   `https://accounts.google.com/AccountChooser?continue=<SSO_URL + '?action=googleStart'>`.
   The picker comes first because a phone with two Google accounts signed in feeds a web
   app its **default** one, and a personal account being the default means Google refuses
   the domain-scoped door before any of our code runs. Nothing in the app can see that, so
   the only place it can be fixed from is before the browser leaves. After the choice,
   Google returns to the door, which answers with an `HtmlService` page naming the account
   it recognised and carrying **two links** — the primary one (`target="_top"`, because that
   is the only navigation Apps Script's sandbox permits; see below) back to `CONFIG.APP_URL`
   with a one-time code in the **fragment**, `#sso=<32 hex>`, or `#ssoerr=<why>` for a
   refusal, plus **"Not you? Choose a different account"** for the account that is merely
   the wrong one. **The user taps the primary link.**
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
code is issued once and reused for **8 hours from the send**, so a second sign-in
inside that window (another device) needs no second mail. The window is a duration
from issue, **not** "until the end of the working day" — a first sign-in at 2pm
leaves the code live until 10pm. The session is **8h30m and absolute** — one
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

> ⚠ **NOTHING SENSITIVE, SINCE v13 (2026-10-17).** Every Google file id and the
> external address list were **removed from the source**, because this repo is
> public. They live in `_store/ids.json` now, plus one Script Property for the
> `_store/` root folder itself. See "Where the file ids live" below — and note that
> the deploy now has a **prerequisite step** that `ping` cannot verify.

| Item | Location | Current Value |
|---|---|---|
| Store folder name | `CONFIG.STORE_FOLDER_NAME` | `_store` |
| Allowed Domain | `CONFIG.ALLOWED_DOMAIN` | `indrones.com` |
| Admin emails | `CONFIG.ADMIN_EMAILS` | `['monish.raza@indrones.com']` |
| API version | `CONFIG.API_VERSION` | `20` — bumped by any change that adds an **action**, a new section id, or a **deploy prerequisite** (`11` = `sec-cost`, the Costing split; `12` = the company register; `13` = the file ids leave the source; `14` = the Inspector's correction ledger; `15` = I-PASSBOOK POSTMAN's `sendPostmaster`; `16` = a reporter correction is keyed by the NAME, not the mailbox; `17` = every post carries a permanent number (#001, #002, …) in its subject and first line; `18` = a reporter is a NAME paired with the address it was filed from, and CR can name a mailbox for rows that name nobody; `19` = **one IR can be named on its own**; `20` = **the customer portal** — `getCustomerPortal`, `saveCustomerProfile`, `rateIR`, `savePortalConfig`, and a fourth store file, `portal.json`). The running list with each bump's reason is the comment beside the constant in `backend.gs`. A stale cached frontend reads the number off `ping` and explains itself instead of failing obscurely — and since `backup.html` lives outside the app and cannot be told to reload, `ping` answering the expected number is how you know a paste landed. ⚠ **v13 is the exception: `ping` is pre-auth and touches no store, so it answers `13` happily while every store action is broken.** Confirm v13 with `listIRs`, or with `backupPulse` |
| Session TTL · temp-password TTL | `CONFIG.SESSION_HOURS` · `CONFIG.TEMP_PW_TTL_DAYS` | `8.5` hours (**absolute**, never slid) · `14` days |
| Backup folder name | `CONFIG.BACKUP_FOLDER_NAME` | `I-PASSBOOK backups` — a **sibling** of `_store/`, inside the same private root, and the one folder in there shared **`DOMAIN_WITH_LINK`** so a backup can be opened from a phone |
| Backup run budget | `CONFIG.BACKUP_BUDGET_MS` | `240000` (4 min). The Apps Script kill at six minutes leaves **no record at all**, so the run stops itself early, while it can still write `ok: false` and mail the admin |
| Backup rotation | `CONFIG.BACKUP_KEEP_DAILY` · `_WEEKLY` · `_MONTHLY` | `14` · `8` · `12`, then one **a year forever** |
| Rehearsal folder name | `REHEARSAL_FOLDER_NAME` | `_rehearsal` — a scratch folder **inside** `I-PASSBOOK backups` where `rehearseRestore()` rebuilds the newest archive and reads it back. Deliberately **not named for a date**, so the rotation skips it; overwritten each run, so it never grows |

### Where the file ids live (v13, 2026-10-17)

`backend.gs` is in a **public repository** — it has to be, because GitHub Pages on
the Free plan requires a public repo. An id is not a password: with the sheet
Restricted, an id lands you on Google's "you need access" page. But an id in public
**plus a share setting that slips is a leak**, and that is not hypothetical — the
intake sheet was readable by anyone for two days in October 2026 exactly that way.
So the ids left the source.

| Value | Where it lives now | Read by |
|---|---|---|
| `_store/` **root folder id** | Script Property **`STORE_ROOT_FOLDER_ID`** | `getRootFolder()`, `rootFolderId()` |
| IR Repository sheet id | `_store/ids.json` → `irRepoSheetId` | `intakeGrid()`, `emailThreadsKey()`, `readEmailThreadsFromSheet()` |
| Legacy workbook id | `_store/ids.json` → `legacySheetId` | `listLegacyIRs()`, `getLegacyIR()`, `inventoryLegacyWorkbook()` |
| Client directory sheet id | `_store/ids.json` → `clientDirectorySheetId` | `seedCompanyContacts()` only (editor-run) |
| External address list | `_store/ids.json` → `externalEmails` | `isMailRecipientAllowed()` only |

**Why the root folder cannot go in `ids.json`:** reading that file needs the folder
first. It is the bootstrap, and a Script Property is the only mechanism here that
does not itself need a Drive lookup. Script Properties are **per-project**, so they
are set once and shared by both deployments.

**`ids.json` is deliberately NOT `config.json`.** `config.json` is the client-facing
`__CONFIG__` sentinel that **every signed-in account can read**; nothing routes to
`ids.json`, so the app cannot read it at all.

**Two accessors, and the difference matters:**

- `storeIds()` — memoised, answers `{}` for a missing key, never throws. Used where a
  documented "not configured" answer exists (`seedCompanyContacts`).
- `requireStoreId(name)` — throws an error that **names the key and names
  `seedStoreIds()`**. Without it an absent id reaches the platform as
  `openById(undefined)` → `"Invalid argument: id"`, which is true, useless, and takes
  out both the IR list and the ticket view.

**Cost: one cached read.** `ids.json` changes approximately never, so its content is
cached alongside the store-id cache (6h, the platform maximum). In the steady state
the hot read path pays **no extra Drive call**; a cold cache pays one file open, on a
path that already opens `access.json`.

**⚠ One silent-failure path to know about.** `isMailRecipientAllowed()` is the only
runtime reader of the address list and it **fails closed** — if `externalEmails` is
missing, the third party is simply denied and their mail never arrives, with no error
anywhere. It must not throw (a mail path that throws reveals whether an account
exists), so the discovery route is `seedStoreIds()`, which **prints the list it
wrote**. If that colleague reports missing mail, check `ids.json` first.

### The two one-off editor functions

```
setStoreRootFolder('<the Drive folder id>')   // the folder that CONTAINS _store/
seedStoreIds()                                // the four values below, from a Script Property
```

`seedStoreIds()` reads a Script Property named **`SEED_STORE_IDS`** holding a JSON
object, writes `_store/ids.json`, and then **deletes that property** — so there is one
authority and not two. It **refuses to overwrite a non-empty `ids.json`** unless called
as `seedStoreIds(true)`, because a half-remembered re-run replacing a working set with
an empty one is the failure mode worth guarding. If the ids are ever lost they are
recoverable from each file's own URL, so the cost is a re-paste, never data loss.

`CONFIG.PASSBOOK_SHEET_ID` and `CONFIG.DATA_TAB` are **gone**. The old
"I-Passbook App Repository" spreadsheet is not read, written or required by
anything in the app any more; it is left on Drive untouched as an archive.

The `STORE_ROOT_FOLDER_ID` Script Property here **replaces** the older `1W41jpmn…`
folder that earlier revisions of this document listed, and then the
`CONFIG.DRIVE_ROOT_FOLDER_ID` constant that replaced *that*. The store must sit in `monish.raza@`'s
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