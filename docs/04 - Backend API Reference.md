# 04 — Backend API Reference

The backend is a **Google Apps Script (GAS) web app** deployed from `backend.gs`.

**Base URL:** `https://script.google.com/macros/s/AKfycbz-borqx_TeCTh1Ibc70vv9SIHaFxRvVGs4XolbJG0EG2qEg4kVQ0hyclDOeLM8kCDP/exec`

---

## Access Control (two levels: view+comment, or edit)

There is **no per-user permission list**. The whole model is two sentences:

- **Every signed-in account can view and comment on everything.** Nothing is stored
  to record this; it is the default inside `getEffectiveAccess`. That now includes the
  **Overview** (`sec-a`), which is not one of the sections and so needed naming
  explicitly in `getPassbook`'s filter — see below.
- **Edit comes from departments.** A user holds zero or more departments; a
  department grants edit on a subset of the **six** sections (**B–G**). The mapping
  is many-to-many in both directions — one person may hold several departments, one
  department holds many people.
- **Triage is a separate axis.** Editing the Overview (ticket owner, status) is
  gated on the **`Triage`** flag in `DEPARTMENTS`, not on a section grant, and is
  granted to **CR** and **Management**. A department may triage while editing no
  section at all — which is exactly what those two get. Do not model it as a
  seventh section.

`ADMIN_EMAILS` → `{ role: 'admin', permissions: { every section: 'edit' }, triage: true }`,
and admins bypass every check **by role, not by the permission map** — an admin whose
`getMyAccess` failed still gets edit, or they would be locked out of their own
provisioning screen.

Grants live in `access.json`, in `_store/` — never in a sentinel store (see below):

| Key | Shape |
|---|---|
| `departments` | `{ "cr": { name, active, grants: { "sec-b": true, … }, triage: true }, … }`. A section appears in `grants` only when the department has **edit**; `triage` is a sibling of `grants`, deliberately outside it. |
| `memberships` | `{ "someone@indrones.com": ["production", "qa"], … }` — **a list per person**, so reading one person's departments is one key read rather than a scan of an edge list. |

There is no positional read and no column offset to keep in sync: a section grant is
a key, and `triage` lives in its own field precisely so that nothing iterating
`grants` can mistake it for a seventh section.

`canView(perms, sec)` accepts any non-empty level and `canComment` follows it;
`canEdit` requires exactly `edit`. The frontend mirrors this in `canViewSection` /
`canCommentSection` / `canEditSection`, plus `canTriage()` for the second axis.
`departmentCapabilities(email)` reads **both** axes in one pass (one read of
`access.json`, one function) and is the only department reader in the access path.

> ⚠️ **The frontend's fallback (no `access` yet — first paint, or a transient
> `getMyAccess` failure) grants view + comment everywhere and edit *nowhere*.**
> That asymmetry is deliberate: a disabled Save button is recoverable, an
> unauthorised write is not. It used to fail open on edit, which turned
> "permissions have not arrived yet" into "everyone can write". The backend
> enforces independently regardless — do not make the frontend the only check.

The admin entry points are `listUsers` (read everything the modal needs in one
call), `createUser` / `bulkCreateUsers`, `resetUserPassword`, `setUserStatus`,
`setUserDepartments`, `saveDepartment`, `deleteDepartment` and `purgeUsers` — all
gated by `requireAdmin`. There is no request-access flow: nobody asks, the admin
grants.

Every function that mutates the store (`saveSection`, `mintSession`, `issueAuthCode`,
`doLogout`, `revokeAllSessions`, `pruneSessions`, `recordFailedLogin`,
`clearFailedLogin`, the password flows, the user/department mutations, `purgeUsers`,
`deleteDepartment`, `setUserDepartments`, `seedDepartments`, `seedMemberships`,
`maintenancePruneAuditLog`) runs inside `withRowLock()` — a `LockService` script lock
taken **before** the read.

The reason is specific to a file store: **Drive has no transactions, no atomic
append and no compare-and-set.** Every write is a whole-file `setContent`, so two
writers that each read before the other wrote lose one of the two changes. In the
sheet version two saves upserted two separate *rows* and could not clobber each
other, so this is a genuine new cost of the move and it is why the lock is not
optional. Three rules follow:

- The snapshot is read **inside** the lock, and always with `readJsonLocked` —
  never the memoised `readJson`, whose copy may predate the lock. `smoke-store.mjs`
  asserts both halves: that the read is inside, and that a racing save is refused
  rather than lost.
- If the lock cannot be taken the call **refuses** rather than proceeding
  unprotected, and says so in words that tell the user the change was **not saved**
  (`withRowLock`) or throws, for paths whose return value is not a response envelope
  (`withRowLockOrThrow` — a session token or a count read as an error object would
  be a truthy token that authenticates nothing).
- Uploads — base64 decode, `createFile`, `setSharing`, `MailApp.sendEmail` — happen
  **outside** the lock, so one person's file upload does not queue every other write.

`purgeUsers` additionally takes `dryRun=1` (returns the plan, deletes nothing) and
`expect=<count>` (refuses if the account list changed since the plan was reviewed) —
so an irreversible delete removes what a human actually saw, or nothing. Because
`restoreAppDataFromBackup` is gone with the sheet, it writes a
`backups/purge-users-<timestamp>.json` snapshot of `users.json`, `access.json` and
`sessions.json` **before** its first destructive write, and names that file in its
response.

---

## Sentinel stores (no redeploy to add a *key*; adding a store is deliberate)

App-owned records that are **not** one of the 6 workflow sections are saved under
an `irNumber` beginning with `__`. `backend.gs` exempts those from the per-section
ACL check (`getPassbook` and `saveSection` both test
`String(irNumber).indexOf('__') === 0`), so a new **key** inside an existing store
works against the already-deployed backend with no redeploy — exactly as
`__CONFIG__` and `__NUDGES__` already do. `sectionId` becomes each record's own key:

| irNumber / sectionId | Holds |
|---|---|
| `__CONFIG__` / `team-directory` | `{ entries: [{name, email}] }` |
| `__CONFIG__` / `inward-options` | `{ options: {…} }` |
| `__CONFIG__` / `iqc-config` | `{ zones, resultOptions }` |
| `__IRS__` / `<irNumber>` | App-owned workflow state — status, assignee, priority, category, subCategory, `done[]` |
| `__NUDGES__` / `all` | `{ items: [comment, …] }` |

**The exemption is an allowlist, not a prefix.** `SENTINEL_SECTIONS` names every
store and, for the two that are keyed by a real-world id (`__IRS__`, `__KB__`), the
shape that key must have; `assertSentinelWritable()` is called from `saveSection`
before any write. Adding a store is therefore a deliberate edit, not something a
caller can do by inventing a name. Without it, "any `__`-prefixed irNumber skips
the ACL" meant one `saveSection` POST could blank `__NUDGES__/all` (every comment
on every ticket), rewrite `__IRS__/<ir>` status, or host arbitrary files in the
deployer's Drive.

Frontend helpers: `loadSentinel(ir, sec)` reads one record; `loadSentinelAll(ir)`
reads a whole store in one request (keyed by sectionId) and — importantly —
**resolves `null` for a failed read but `{}` for a successful empty one**, so a
dead backend is never mistaken for "no app state"; `saveSentinel()` upserts and
never rejects.

**Why `__IRS__` is a keyed map** rather than one record per ticket: each ticket is
one **key** of `irs.json`, so a status change is a single key assignment and cannot
reach any other ticket. `getPassbook` returns all of them in one request, and with a
JSON file that read is literally one `readJson('irs.json')` — no row scan, and no
per-cell length ceiling to hit silently.

> ⚠️ **Sentinel stores are readable and writable by ANY signed-in user.** Being on
> the allowlist is what makes zero-redeploy keys possible, and also means these are
> shared scratch space, not access-controlled storage. Never put anything
> sensitive in one — and **never put a permission in one.** That is why the
> department grants live in `access.json` inside `_store/`: a grant stored as a
> sentinel could be rewritten through `saveSection` by the very people it is meant
> to restrain. (`access.json` is not a sentinel; it is reached only through
> `accessStore()` and the admin actions, all behind `requireAdmin`.)
>
> A sentinel write is also refused if it carries a **file upload** — that branch
> runs before any ACL and sets every file to `ANYONE_WITH_LINK`, so an unbounded
> sentinel write would have been a way to host arbitrary public files.

---

## GET Endpoints

### `listIRs`
Fetches all IR records from the **Form Responses** tab.

> The frontend now reads this tab directly via Google's CSV endpoint (no deploy
> needed); this GAS action is the fallback.

```
GET {BASE_URL}?action=listIRs
```

**Response:**
```json
{
  "status": "ok",
  "records": [
    {
      "irNumber": "IR409",
      "droneId": "S25P014",
      "dateRaised": "01-Oct-2025",
      "summaryLink": "https://...",
      "status": "In Production"
    }
  ]
}
```

- Reads from IR Repository sheet (`Form Responses` tab)
- Merges status from **`__IRS__`** (`fields.status`), falling back to the Sheet's
  Col D. It used to scan `sec-a` rows for `a_overallStatus` — that was the
  pre-Stage-1 path and it died with Section A. The truthiness test matters:
  `seedIRState` writes `status: ''` on first sight, so an empty string must fall
  through to the Sheet rather than blanking the badge.
- Returns latest-first order (reversed)

### `getPassbook`
Fetches all saved section data for a specific IR.

```
GET {BASE_URL}?action=getPassbook&irNumber=IR409
```

**Response:**
```json
{
  "status": "ok",
  "sections": {
    "sec-a": {
      "a_crmOwner": "Monish Raza",
      "a_contactPhone": "98xxxxxxxx",
      "a_activityLog": "[{…legacy rows…}]"
    },
    "sec-b": { ... }
  }
}
```

`sec-a` here is the **Overview's data key**, not a section — the ten intake keys are
stripped before the write, so only the three editable/legacy keys ever appear.

Access behaviour:
- For a **real** IR, sections the caller cannot at least view are omitted
  (`canView`), unless they are an admin. In practice everyone can view, so nothing
  is omitted today — the filter is kept because the seam is what a future
  re-tightening would use.
- **`sec-a` is exempt from that filter by name** (`OVERVIEW_KEY`). It is a data key,
  not a section, so it is absent from every permission map — including the one
  `getEffectiveAccess` builds from `SECTION_KEYS`. Without the exemption the
  Overview's data (owner, contact phone, and the legacy activity log) would be
  returned to the **admin alone** and blank for all 18 other users, and the admin
  testing it would see nothing wrong.
- For a **sentinel** IR, everything is returned — see above.

Passing a sentinel irNumber returns that whole store keyed by sectionId, which is
how `loadSentinelAll('__IRS__')` reads every ticket's workflow state in one call.

### `getMyAccess`
Returns the signed-in user's `{ role, permissions: { 'sec-b': 'edit', …, 'sec-a': 'edit' }, triage, departments, mustChangePassword }`,
used by the frontend's `canViewSection` / `canCommentSection` / `canEditSection` /
`canTriage`. It is computed live from `access.json`, so a grant change takes effect
on the next call — no session re-mint needed.

`perms['sec-a']` is set to `'view'` for everyone and raised to `'edit'` when triage
is held, so the Overview's two inputs reuse the **existing** `canEdit` seam. The
backend is the authority: a save without the flag is rejected regardless of what the
frontend rendered. `triage` is initialized **before** the department read, so a
throw still returns a minimum-privilege profile — the same fail-closed intent as the
frontend's fallback, and the same asymmetry (a disabled button is recoverable, an
unauthorised write is not).

### `getAuditLog`
```
GET {BASE_URL}?action=getAuditLog&irNumber=IR409
```
Returns the audit trail for one IR, **oldest first** (the frontend reverses for
display), capped at **400** entries with a `truncated` flag.

The read is **one file**: `audit/IR409.jsonl`, resolved by `auditSubjectFor(irNumber,
sectionId)`. Per-ticket rather than per-month is deliberate — a monthly shard reaches
~1.3 MB, and because Drive has no atomic append every audit write rewrites the whole
file (~4 MB of I/O per save on the last day of the month, invisible in month 1 and
severe by month 12). Per-ticket files are ~40 KB, which suits the only query that
exists, and two people on different tickets never touch the same file.

Within that file it matches **two** line shapes, and the second is the whole reason
the workflow half of the timeline needs no new storage:

| Shape | Condition | `source` |
|---|---|---|
| section line | `ir === irNumber` | `'section'` |
| workflow line | `sec === irNumber` **and** `ir` starts with `__` | `'workflow'` |

A `__IRS__` patch is **about** IR409, so it lands in IR409's own file — the
per-ticket split is what makes the workflow half reachable, where a sheet scan with a
`__`-prefix guard was needed to keep a *future* sentinel from leaking in. File order
is already chronological (append-only), so the two shapes interleave with no sort.

> ⚠️ **This endpoint is session-gated but not per-IR gated** — any signed-in user
> can read the trail for any IR they know the number of. That is consistent with
> view-is-for-everyone, and it is worth stating rather than discovering.

Entries carry `source`. For a workflow line both `sectionId` is **blank** and
`irNumber` is the **real IR**: the line stores the sentinel in its own `ir` field,
and reporting that verbatim would hand back `__IRS__` — the store, not the ticket —
and quietly make any `e.irNumber === irNumber` filter drop every status change.

### `listLegacyIRs`
Lists the pre-app per-IR tabs (legacy workbook, ~IR310–IR441) so the master list
can badge them and the detail view can show a read-only copy.

### Pre-auth endpoints
These answer **before** `requireAuth`, which is why they must never leak anything
about an account:

| Action | Purpose |
|---|---|
| `ping` | Version handshake. Returns `API_VERSION`; a stale cached frontend uses it to explain itself instead of failing obscurely. |
| `sessionCheck` | Cheap liveness probe. Called by `confirmSessionAlive()` — which treats an unreachable server as **alive**, because ejecting someone on a flaky connection is the bug, not the fix. **It also fails open on a store error**, with a message that never starts with `unauthorized`: the frontend's interceptor auto-logs-out on that prefix, so a `sessions.json` that cannot be read would sign out all twenty users in the same poll window. |
| `login` | Email + password → a code, then email + password + code → session token. **Two steps** — the password alone buys no token; see [`login`](#login) below. |
| `changePassword` | Verifies the current password, clears the must-change flag, revokes every existing session, mints a new one. Unauthenticated by design (a first-login account has no token) and therefore wired to the **same** `attempts.json` limiter as `login` — and it enforces the **same temp-password expiry**, because a temp password posted here buys a session exactly as it would at `login`. Both go through `isTempPasswordAccount()` / `tempPasswordExpired()` so the two doors cannot drift. |
| `forgotPassword` | Mails a 6-digit **reset** code. Response is byte-identical whether or not the account exists (no enumeration), and it does no throttling of its own — it calls the one shared `issueAuthCode(email, 'reset', CODE_TTL_MIN)`, which is where the per-email budget, the resend gap, the global ceiling and the retire-the-older-code rule live. |
| `resetPassword` | Redeems the code (5-attempt cap, and a **reset** code is **consumed** by the reset it performs), sets the new password, revokes all sessions, and **returns no token** — the user then signs in, which proves the password was typed correctly. It **preserves** the account's `Status` rather than writing `'active'`: a reset must not re-enable an account an admin deliberately disabled, and it refuses a disabled account outright. It calls the lock-free `redeemCodeIn(…, consume=true)` inside its own wider lock, covering `codes.json`, `users.json` and `sessions.json` together — a redeem is one event, and a nested lock would deadlock rather than queue. |

`forgotPassword` sends through `sendAuthMail`, which enforces a **global** daily
`MAIL_DAILY_CAP` (400). That cap covers **every** mail this script sends, not just
auth: `sendNudgeEmail` calls `mailQuotaOk('nudge')` before its own send, and the
nudge ceiling stops short of the cap by `MAIL_AUTH_RESERVE` (40) so a busy comment
day cannot starve the reset code. An uncapped path would not merely annoy — it
would burn the day's quota and silently disable password recovery for the whole
company. `mailQuotaOk()` is the single gate; add no send site that skips it.

Both emailed-code paths are capped **across all emails** as well as per email,
because GAS web apps expose no reliable client IP: without it, 3/hour/address times
enough addresses spends the whole day's mail budget in an hour, and because
`forgotPassword`'s response is generic nobody would notice. The ceiling is **per
purpose** — `globalCodeCap(purpose)`, 12/hour for `'reset'` and 120/hour for
`'login'` — and the 10x gap is deliberate: a reset code is issued to any
unauthenticated caller for any address, while a sign-in code is issued **only after
a correct password**. At a shared 12/hour, a 15-person team would exhaust the
ceiling on one morning's sign-ins and the app would look broken at exactly the
moment everyone is trying to start work.

---

## POST Endpoints

### `saveSection`
Saves form data + uploaded files for one section of an IR.

```
POST {BASE_URL}
Content-Type: multipart/form-data
```

**Form Fields:**

| Param | Type | Description |
|---|---|---|
| `action` | string | `"saveSection"` |
| `irNumber` | string | e.g. `"IR409"` |
| `sectionId` | string | e.g. `"sec-a"` |
| `savedBy` | string | User email |
| `fields` | JSON string | Object of field key→value pairs |
| `files` | JSON string | Array of `{fieldId, name, mimeType, base64}` objects |

**File handling:**
1. Creates `IR###/Section X` folder structure in Google Drive — **outside the lock**,
   because base64 decode, `createFile` and `setSharing` are the slow part of a save
   and none of them touches the store
2. Decodes base64 → creates file in Drive
3. Sets the **file** (never the folder) to anyone-with-link view access
4. Appends `_links` field with comma-separated Drive URLs

**Write logic:**
- The subject resolves to **one JSON file** — `sections/IR409.json` via
  `sections/index.json` → `getFileById`, or the sentinel file from
  `sentinelStoreFile()` — and the write is `store[sectionId] = fields`.
- **One key, never the file.** `writeJson('irs.json', row)` would wipe every other
  ticket's workflow state; `writeJson('comments.json', …)` would wipe every comment.
- The read that is merged onto is taken **inside the lock** and with
  `readJsonLocked`, so a concurrent save to another section of the same IR is not
  lost. If the lock cannot be taken the save is **refused**, not applied.

**Response:**
```json
{ "status": "ok", "message": "Section sec-a saved for IR409" }
```

**Authorisation.** Real sections require edit access on that section:
`Forbidden: you do not have edit access to <sectionId>.` Admins bypass. Sentinel IRs
skip the ACL — and are instead checked against `SENTINEL_SECTIONS`. **`sec-a` is the
Overview**: it is not in `SECTION_KEYS`, but `getEffectiveAccess` gives it a
permission key like any section (`'view'` for everyone, `'edit'` only for admins and
Triage holders), so it is gated through the **same** `canEdit` line. There is
deliberately no `OVERVIEW_KEY` exemption there — exempting it would let any signed-in
user rewrite the ticket header.

**Retired section ids are rejected.** `RETIRED_SECTION_IDS` is a plain literal
(`['sec-h','sec-i']`) checked before the write, so a client on a stale service worker
that still posts a retired id receives a clear "reload the app" error instead of
quietly writing a key nothing reads. It was previously *derived* from
`SEC_TARGET_MAP`, which put `sec-g` in the list — and `sec-g` is the live PDI
Report/Dispatch Record section, so every Section G save was refused with "was merged
into another section". The map is deleted and the list is a literal with a comment
saying `sec-g` must never be added to it.

**A real IR number is shape-checked** (`/^IR\d+$/`) after the ACL and **before** any
folder or file work, because it becomes a Drive folder and file name.

**Audit.** Every section save calls `buildAuditLines(...)` — a **pure** function, so
the caller can hold one lock across read → build → write → append — and the append
happens **last**, inside the same lock. (It previously ran *before* the data write, so
a save that then failed left an audit entry for a save that never happened.) Two
carve-outs: the `__NUDGES__` store is **not audited at all** (comment items already
carry their own author and timestamp, and a copy of the whole comment array per read /
markRead was dominating the log), and no bare `saved` marker is written for a
`__`-sentinel write.

**Section A intake strip.** Immediately before the write, `saveSection` deletes
these keys from any incoming `sec-a` payload, so a crafted save cannot write a
divergent copy of the client's report into the store:

```js
['a_irNumber','a_droneId','a_dateRaised','a_issueType','a_issueDesc','a_customerName',
 'a_contactEmail','a_incidentLocationWeather','a_evidence','a_companyName']
```

They are displayed live from the IR Repository / the 📋 Report tab, never from the
store. **This list is authoritative.** Three keys are deliberately *excluded*
from it:

| Key | Why not stripped |
|---|---|
| `a_crmOwner` | Writable through the `sec-a` path, gated on **Triage** — this is what `saveOverview()` posts |
| `a_contactPhone` | Same — the other Overview-editable field |
| `a_activityLog` | **Never written by anyone.** It is the legacy hand-typed log, shown read-only; it is in the field table for reading, not for saving |

> Because the strip is a `delete` — the only mutation `saveSection` makes to a
> payload — and because the write replaces the whole key, the intake keys never
> persist in the store at all. **A field key is never renamed anywhere**: a key is
> also the anchor inside every `__NUDGES__` item and the `Field ID` of every
> historical audit line, so renaming one would orphan every comment on it and split
> its history. Adding a field to the Overview does not put it under the strip — only
> the ten IDs above are protected, so **a new Overview field must be added
> deliberately**, and the one to think twice about is anything sourced from the
> customer's Form.

### `sendNudgeEmail`
Relays a comment notification via `MailApp.sendEmail`. The sender is the `replyTo`.
Requires redeploy and a one-time `script.send_mail` consent (see Development
Guide). **`MailApp`, never `UrlFetchApp`** — the `UrlFetchApp` scope is what broke
Google Sign-In in `8541019`, and there are exactly two `MailApp.sendEmail` call
sites (this one and the auth mail); both check `mailQuotaOk()` first. This one
checks it as `'nudge'`, from the reserve side of the ceiling, and returns a visible
`status: 'error'` when the day's mail is spent — the comment still posts, and the
sender is told the notification did not go. Failing silently would leave people
believing a colleague had been emailed.

### `login`
Sign-in is **two steps**, and the password alone buys no session.

```
POST {BASE_URL}
Content-Type: multipart/form-data
```

**Form Fields:**

| Param | Type | Description |
|---|---|---|
| `action` | string | `"login"` |
| `email` | string | |
| `password` | string | |
| `code` | string | **optional** — the 6-digit sign-in code. Absent on step 1, present on step 2. |

**Step 1 — no `code`.** The password is verified, and then:

```json
{
  "status": "ok",
  "otpRequired": true,
  "email": "asha@indrones.com",
  "name": "Asha P",
  "codeSent": true,
  "message": "We emailed you a 6-digit sign-in code."
}
```

There is **no `sessionToken`** in that response. `codeSent` distinguishes the two
outcomes, and the frontend branches on it rather than claiming a mail that was
never sent:

| `codeSent` | Meaning |
|---|---|
| `true` | No live code existed, so one was issued (`issueAuthCode(email, 'login', LOGIN_OTP_TTL_MIN)`) and emailed |
| `false` | A live, unexpired code already existed, so **nothing was issued and no mail was sent** — `message` reads *"Enter the sign-in code already emailed to you today."* One code covers every sign-in that day, on every device |

When there is no live code to reuse **and** one cannot be issued — the per-email
hourly budget, the 60s resend gap, or the global hourly ceiling — this is the one
place the sign-in path answers with an **error** instead of a prompt:

```json
{ "status": "error", "message": "Could not send a sign-in code just now — wait a minute and try again." }
```

That has to be an error. Telling the user to enter "the code we emailed you" when
no code was sent and none can be sent would be a plain lie, and there is no way
forward from that screen. The message deliberately does not say which limit was
hit — that is admin-facing detail, not something a person signing in can act on.

**Step 2 — with `code`.** The same `email` and `password` are sent again, plus the
code. A correct code mints the ordinary session:

```json
{ "status": "ok", "sessionToken": "…", "email": "asha@indrones.com", "access": { "role": "user", "permissions": { "sec-b": "view" }, "departments": [], "triage": false } }
```

The redeem is `verifyAuthCode(email, 'login', code, false)` — **`consume = false`**.
The code is deliberately **not** marked used on success; that reuse is the whole
feature, and it is what lets the same code work on a phone at 9am and a desktop at
2pm. What still bounds abuse is the **attempt counter**, which is shared across the
day because the code entry is: **5** wrong guesses (`CODE_MAX_ATTEMPTS`) burn the
code and force a fresh one. A wrong guess answers
`{"status":"error","message":"Wrong code. N attempt(s) left."}`.

**Both existing gates run before the OTP step**, so the new step bypasses neither:
a **disabled** account is refused, and a temp-password account is answered
`{ status: 'ok', mustChangePassword: true, … }` with **no token and no email sent**
— asking a first-login user for an emailed code would be a step that buys nothing.

**Password checking is unchanged.** The lockout (5 failures in a 10-minute window →
15-minute lockout), the generic `"Wrong password."`, the deliberate
no-account-found message and the temp-password TTL all run first and exactly as
before — the OTP step is the last thing `doLoginPassword` does before it stamps
`lastLoginAt` and mints the session.

### Auth and access management
`login` → session, in the two steps documented above. A first sign-in on an
admin-issued temp password stops at `mustChangePassword` and goes through
`changePassword` instead. `forgotPassword` → `resetPassword` for a lost password.
`logout` revokes one session.
Access is granted only through the admin actions listed under
[Access Control](#access-control-two-levels-viewcomment-or-edit); there is no
self-service path in either direction.

---

## CONFIG Object (backend.gs)

```javascript
var CONFIG = {
  // IR Repository sheet
  IR_REPO_SHEET_ID: '1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4',
  IR_REPO_TAB:      'Form Responses',
  IR_REPO_IR_COL:      2,   // B  "IR Number"
  IR_REPO_ID_COL:     11,   // K  "Mention the Drone Serial No (S250XX)"
  IR_REPO_SUMLINK_COL: 1,   // A  "Summary"
  IR_REPO_DATE_COL:    3,   // C  "Timestamp"
  IR_REPO_STATUS_COL:  4,   // D  "Issue Status"
  IR_REPO_SPOC_COL:    6,   // F  "SPOC"
  IR_REPO_SUPPORT_COL: 7,   // G  "What Support Is Required?"
  IR_REPO_DESC_COL:    8,   // H  "Please Describe Your Problem..."
  IR_REPO_INCIDENT_COL: 9,  // I  "Date of Incident"
  IR_REPO_REPORTER_COL: 12, // L  "Who's Reporting? (Name & Contact)"
  IR_REPO_EMAIL_COL:   16,  // P  "Email Address"
  IR_REPO_INCIDENT_LOC_COL: 13, // M  "Incident Location and Weather"
  IR_REPO_EVIDENCE_N_COL:   14, // N  "Evidence: Attach Files From The Incident"
  IR_REPO_EVIDENCE_Q_COL:   17, // Q  "Evidence: Attach Screenshot of UAV Forecast..."
  IR_REPO_COMPANY_COL:      18, // R  "Where Do You Work?"

  // The app's store — JSON files in the owner's Drive folder, under _store/
  DRIVE_ROOT_FOLDER_ID: '1itfTVbllh8Mi6TD6I2_OyYp_Wj4xrLIK',
  STORE_FOLDER_NAME:    '_store',

  // The two READ-ONLY input Sheets. Nothing in the app writes to either.
  LEGACY_SHEET_ID:  '14VnWnCg-W7I8Vv97amhuwfSqiozictVMivO3F9Bed5s',

  ALLOWED_DOMAIN: 'indrones.com',
  ADMIN_EMAILS: ['monish.raza@indrones.com'],          // exactly one
  EXTERNAL_EMAILS: ['kishor.salunkhe@uavgarage.com'],  // the one non-Indrones address
  API_VERSION: 3,
  SESSION_HOURS: 8.5,        // one working day — ABSOLUTE, no slide on use
  TEMP_PW_TTL_DAYS: 14,
};
```

`PASSBOOK_SHEET_ID` and `DATA_TAB` are **gone**: there is no app spreadsheet. The
old "I-Passbook App Repository" workbook is not read or written by anything any
more — it is left on Drive as an archive.

Module-level (outside `CONFIG`) limits that are deliberately constants rather than
config, because changing one is a security decision, not a setting:

| Constant | Value | Guards |
|---|---|---|
| `MAIL_DAILY_CAP` | 400 | every `MailApp.sendEmail` in the script |
| `MAIL_AUTH_RESERVE` | 40 | the slots the nudge path may **not** spend |
| `CODE_MAX_PER_HOUR` | 3 | codes issued to **one email** per hour — counted across **both** purposes, so asking for a reset cannot buy extra sign-in codes |
| `CODE_MAX_PER_HOUR_GLOBAL` | 12 | **reset** codes across all emails (the unauthenticated path) |
| `CODE_MAX_PER_HOUR_GLOBAL_LOGIN` | 120 | **sign-in** codes across all emails — 10x looser, because a sign-in code is only issued after a correct password |
| `CODE_MAX_ATTEMPTS` | 5 | wrong guesses before a code is burned — shared across the day for a sign-in code |
| `CODE_RESEND_GAP_MS` | 60000 | the minimum gap between code issues for one email |
| `CODE_TTL_MIN` | 15 | how long a **reset** code lives, and it is consumed on use |
| `LOGIN_OTP_TTL_MIN` | 510 (8h30m) | how long a **sign-in** code lives, and it is **reusable** inside that window |
| `LOGIN_MAX_FAILS` | 5 in a 10-min window → 15-min lockout | `login` **and** `changePassword`, one shared `attempts.json` |

`globalCodeCap(purpose)` is the ONE reader of the two global ceilings — 120 for
`'login'`, 12 otherwise. The asymmetry is the point: a reset code can be asked for
by anyone for any address, while a sign-in code is issued only behind a correct
password, and the sign-in path has to absorb the whole team arriving between 9 and
10am.

`SESSION_DAYS` and `SESSION_SLIDE_HOURS` are **gone**. The session is a fixed
8h30m from sign-in and there is no slide to throttle: see the login flow above.

`ALLOWED_EMAILS` no longer exists: with no self-signup there is no allowlist to
consult, only the `@indrones.com` domain check plus the explicit
`EXTERNAL_EMAILS` exceptions.

> ⚠️ `DRIVE_ROOT_FOLDER_ID` must be the **owner's** folder
> (`monish.raza@indrones.com`), not one shared with `customer.relations@` — that
> account is used by several people, so anything in it is deletable by any of them.
> Changing this ID means a new store: the existing JSON files do not follow it.

**Columns A–D, F–I, K–N and P–R are accounted for; E, J and O are not.** The
customer Form writes them, the backend has no constant for them, and until the
intake mapper (see [02](02 - Architecture & Data Flow.md)) nothing in the app read
them. They now surface on the ticket's 📋 Report tab under "Other columns from the
Sheet". If you add a constant for one, remove its reliance on that fallback.

---

## Editor-facing functions (not endpoints)

These are run by hand from the Apps Script editor's function dropdown. They share a
convention: **top-level, no parameters, return a human-readable string report, and
are safe to re-run.** None of them is a key in the `doGet`/`doPost` dispatch maps,
so none is reachable over HTTP.

> ⚠️ **Every report also goes through `report()`, which logs it.** This is not
> decoration. The Apps Script editor's execution log shows **only what the code
> logs** — a function's *return value is never displayed*. So a function that only
> returned its report would look, to the person running it, exactly like one that
> did nothing: `Execution completed`, and no `dropped` grant list, no store folder
> name, no one-time admin password. Every one of those is something an operator has
> to **read** to run the setup safely. Wrapping the outer call
> (`return report(withRowLockOrThrow(…))`) rather than the inner returns is
> deliberate: it is what makes the early refusals — *"Nothing older than …"*,
> *"No CONFIG.ADMIN_EMAILS configured."* — visible too. `smoke-backend.mjs` asserts
> both.

**The run order:**

```
One-time setup (before the deploy — no user impact):
  initializeStore() → seedDepartments() → seedMemberships() → bootstrapAdmin() → seedAccounts()

Anytime after go-live:
  maintenancePruneSessions(), maintenancePruneAuditLog()
```

There is **no cutover window any more.** The old order existed because widening a
`DEPARTMENTS` tab would be read *positionally* by the still-live old backend and
misgrant every section, and because the `APP_DATA` merge rewrote rows the live app
was reading. Neither applies: there are no columns and no rows, `_store/` is a
folder the old backend never looks at, and the store starts empty. The whole
pre-flight/cutover split collapses into "run five functions, then deploy".

| Function | Kind | What it does |
|---|---|---|
| `initializeStore()` | idempotent | Creates `_store/` inside `DRIVE_ROOT_FOLDER_ID`, makes `sections/`, `audit/` and `backups/`, sets the folder **Private (not link-shared)**, and seeds the empty files. Idempotent by **guard**, not by accident: an existing file is left exactly as it is. Prints the store's name, its sharing state, what it seeded, and the next three calls |
| `bootstrapAdmin()` | idempotent | Creates the admin account if missing, printing a one-time temp password to the execution log. If it exists it is left alone and only the flags are normalised — re-reading the record **inside** the lock, so a concurrent password reset is not undone |
| `seedDepartments()` | upsert | Writes `SEED_GRANTS` plus `triage` for CR and Management. Reports `created`/`updated`/`unchanged` and a **`dropped`** list — an existing grant the new mapping does not reproduce. A department the seed does not name is left untouched, never deleted |
| `seedMemberships()` | additive only | Adds one department edge per person from `SEED_MEMBERSHIPS`. Never removes. Prints emails with no account yet, and says plainly that the IQC/Compliance omission and the Purchase/Inventory doubling are intentional |
| `seedAccounts()` | additive only | Creates **one account per seeded member** — the roster is the union of `SEED_MEMBERSHIPS` itself, so there is no second list to drift — and prints each address with its temp password. An existing account is **skipped, never rewritten**: re-issuing would invalidate the password somebody is already using. Must run after `bootstrapAdmin()` (admin addresses are skipped) and must **not** hold the lock, because `createUserRow` takes its own and a nested lock is refused, not queued |
| `maintenancePruneSessions()` | destructive, locked | Removes expired sessions |
| `maintenancePruneAuditLog()` | destructive, locked | Retains `AUDIT_RETENTION_DAYS` of audit lines, per subject file. Manual on purpose — the audit trail is evidence and must not shrink behind anyone's back. A line whose timestamp cannot be parsed is **kept**, never pruned by accident |

The full procedure, with the verification steps, is in
[08 — Development Guide](08 - Development Guide.md).

---

## Deleted with the sheet

These existed only to make positional rows safe or to migrate sheet data. With no
data to migrate they have no job, and **nothing may survive as an adapter** — a
`getRange(i+1, 4)`-shaped shim would keep the positional layout alive, which is the
whole thing this change removes:

`getSs`, `ensureHeaders`, every `getOrCreate*Tab`, `migrateAddColumns`,
`migrateAclReport`, `deptTabShape`, `deptTriageIndex`, `userCol`,
`findUserRowIndex`, `planSectionMerge`, `mergeTargetFor`, `mergeSectionsReport`,
`mergeSectionsApply`, `restoreAppDataFromBackup`, `importSingleTab`,
`importLegacyData`, `setupAuditLog`, `appendAuditEntries`, `saveUser`, and the
column constants `USER_HEADS` / `SESSION_HEADS` / `DEPT_HEADS` / `CODE_HEADS` /
`USERDEPT_HEADS` / `USER_ID_BLOCK_COLS` / `LEGACY_DEPT_SECTIONS` /
`LEGACY_ACL_SECTIONS` / `SEC_TARGET_MAP` / `DONE_MAP`.

The one deletion that needed a replacement: `restoreAppDataFromBackup` was the
rollback path, so `snapshotStore()` writes a
`backups/<store>-<yyyy-MM-dd-HHmmss>.json` **new file** before every destructive
admin operation, and `purgeUsers` names that file in its response.

`SpreadsheetApp` survives in exactly **two** functions — `listIRs()` and
`listLegacyIRs()` — and the suite asserts that by walking every call site to its
enclosing function, because a third appearance would mean the app is writing to a
sheet again.