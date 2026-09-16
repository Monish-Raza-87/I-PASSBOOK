# 04 — Backend API Reference

The backend is a **Google Apps Script (GAS) web app** deployed from `backend.gs`.

**Base URL:** `https://script.google.com/macros/s/AKfycbz-borqx_TeCTh1Ibc70vv9SIHaFxRvVGs4XolbJG0EG2qEg4kVQ0hyclDOeLM8kCDP/exec`

---

## Access Control (two levels: view+comment, or edit)

There is **no per-user permission list**. The whole model is two sentences:

- **Every signed-in account can view and comment on everything.** No row anywhere
  records this; it is the default inside `getEffectiveAccess`.
- **Edit comes from departments.** A user holds zero or more departments; a
  department grants edit on a subset of the nine sections. The mapping is
  many-to-many in both directions — one person may hold several departments, one
  department holds many people.

`ADMIN_EMAILS` → `{ role: 'admin', permissions: { every section: 'edit' } }`, and
admins bypass every check **by role, not by the permission map** — an admin whose
`getMyAccess` failed still gets edit, or they would be locked out of their own
provisioning screen.

Grants live in two real Sheets tabs (never a sentinel — see below):

| Tab | Shape |
|---|---|
| `DEPARTMENTS` | `Key, Name, Active, sec-a…sec-i, Updated At, Updated By`. A section column holds `'edit'` or `''`. |
| `USER_DEPARTMENTS` | Edge list: `Email, Department Key, Added At, Added By`. One row per (person, department). |

`canView(perms, sec)` accepts any non-empty level and `canComment` follows it;
`canEdit` requires exactly `edit`. The frontend mirrors this in `canViewSection` /
`canCommentSection` / `canEditSection`.

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

The three that mutate rows **by remembered index** (`purgeUsers`,
`deleteDepartment`, `setUserDepartments`) run inside `withRowLock()` — a
`LockService` script lock taken before the `getDataRange()` snapshot. Deleting
bottom-up only stops a function's own deletes from invalidating each other; it does
nothing about a row another admin appends in between, which shifts every index
below it and makes the next `deleteRow()` hit the wrong row. Apps Script has no
transactions and `SpreadsheetApp` has no row identity, so a script lock is the only
mutual exclusion available. If the lock cannot be taken the call **refuses**
rather than proceeding unprotected. `purgeUsers` additionally takes `dryRun=1`
(returns the plan, deletes nothing) and `expect=<count>` (refuses if the account
list changed since the plan was reviewed) — so an irreversible delete removes what
a human actually saw, or nothing.

---

## Sentinel stores (no redeploy to add a *key*; adding a store is deliberate)

App-owned records that are **not** one of the 9 workflow sections are saved under
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
| `__IRS__` / `<irNumber>` | App-owned workflow state — status, assignee, priority, type, `done[]` |
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

**Why one row per IR for `__IRS__`** rather than one map record: each record gets
its own ~50,000-char cell, so there is no ceiling to hit where failure would be
silent data loss, and two people editing two different tickets never clobber each
other. `getPassbook` already returns every row matching one irNumber, so the whole
store is still a single request.

> ⚠️ **Sentinel rows are readable and writable by ANY signed-in user.** Being on
> the allowlist is what makes zero-redeploy keys possible, and also means these are
> shared scratch space, not access-controlled storage. Never put anything
> sensitive in one — and **never put a permission in one.** That is why the
> department grants live in the real `DEPARTMENTS` / `USER_DEPARTMENTS` tabs: a
> grant stored as a sentinel could be rewritten through `saveSection` by the very
> people it is meant to restrain.

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
- Merges status from APP_DATA (sec-a → `a_overallStatus`)
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
      "a_irNumber": "IR409",
      "a_crmOwner": "Monish Raza",
      ...
    },
    "sec-b": { ... }
  }
}
```

Access behaviour:
- For a **real** IR, sections the caller cannot at least view are omitted
  (`canView`), unless they are an admin. In practice everyone can view, so nothing
  is omitted today — the filter is kept because the seam is what a future
  re-tightening would use.
- For a **sentinel** IR, everything is returned — see above.

Passing a sentinel irNumber returns that whole store keyed by sectionId, which is
how `loadSentinelAll('__IRS__')` reads every ticket's workflow state in one call.

### `getMyAccess`
Returns the signed-in user's `{ role, permissions: { 'sec-a': 'edit', … },
departments, mustChangePassword }`, used by the frontend's `canViewSection` /
`canCommentSection` / `canEditSection`. It is computed live from the department
tabs, so a grant change takes effect on the next call — no session re-mint needed.

### `getAuditLog`
```
GET {BASE_URL}?action=getAuditLog&irNumber=IR409
```
Returns the `AUDIT_LOG` trail for one IR, newest first (see *Audit trail* below).

### `listLegacyIRs`
Lists the pre-app per-IR tabs (legacy workbook, ~IR310–IR441) so the master list
can badge them and the detail view can show a read-only copy.

### Pre-auth endpoints
These answer **before** `requireAuth`, which is why they must never leak anything
about an account:

| Action | Purpose |
|---|---|
| `ping` | Version handshake. Returns `API_VERSION`; a stale cached frontend uses it to explain itself instead of failing obscurely. |
| `sessionCheck` | Cheap liveness probe. Called by `confirmSessionAlive()` — which treats an unreachable server as **alive**, because ejecting someone on a flaky connection is the bug, not the fix. |
| `login` | Email + password → session token (or `mustChangePassword` with **no** token — see below). |
| `changePassword` | Verifies the current password, clears the must-change flag, revokes every existing session, mints a new one. Unauthenticated by design (a first-login account has no token) and therefore wired to the **same** `LOGIN_ATTEMPTS` limiter as `login` — and it enforces the **same temp-password expiry**, because a temp password posted here buys a session exactly as it would at `login`. Both go through `isTempPasswordAccount()` / `tempPasswordExpired()` so the two doors cannot drift. |
| `forgotPassword` | Mails a 6-digit reset code. Response is byte-identical whether or not the account exists (no enumeration), throttled to 3 codes/hour/email plus a global hourly ceiling with a resend gap, and it retires earlier live codes. |
| `resetPassword` | Verifies the code (5-attempt cap), sets the new password, revokes all sessions, and **returns no token** — the user then signs in, which proves the password was typed correctly. It **preserves** the account's `Status` rather than writing `'active'`: a reset must not re-enable an account an admin deliberately disabled, and it refuses a disabled account outright. |

`forgotPassword` sends through `sendAuthMail`, which enforces a **global** daily
`MAIL_DAILY_CAP` (400). That cap covers **every** mail this script sends, not just
auth: `sendNudgeEmail` calls `mailQuotaOk('nudge')` before its own send, and the
nudge ceiling stops short of the cap by `MAIL_AUTH_RESERVE` (40) so a busy comment
day cannot starve the reset code. An uncapped path would not merely annoy — it
would burn the day's quota and silently disable password recovery for the whole
company. `mailQuotaOk()` is the single gate; add no send site that skips it.

`forgotPassword` is also capped **across all emails** (`CODE_MAX_PER_HOUR_GLOBAL`)
as well as per email, because GAS web apps expose no reliable client IP: without
it, 3/hour/address times enough addresses spends the whole day's mail budget in an
hour, and because the response is generic nobody would notice.

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
1. Creates `IR###/Section X` folder structure in Google Drive
2. Decodes base64 → creates file in Drive
3. Sets file to anyone-with-link view access
4. Appends `_links` field with comma-separated Drive URLs

**Upsert logic:**
- If a row with matching `irNumber + sectionId` exists → updates it
- Otherwise → appends new row

**Response:**
```json
{ "status": "ok", "message": "Section sec-a saved for IR409" }
```

**Authorisation.** Real sections require edit access on that section:
`Forbidden: you do not have edit access to <sectionId>.` Admins bypass. Sentinel
IRs skip the check entirely.

**Section A intake strip.** Immediately before the write, `saveSection` deletes
these keys from any incoming `sec-a` payload, so a crafted save cannot write a
divergent copy of the client's report into `APP_DATA`:

```js
['a_irNumber','a_droneId','a_dateRaised','a_issueType','a_issueDesc','a_customerName',
 'a_contactEmail','a_incidentLocationWeather','a_evidence','a_companyName']
```

They are displayed live from the IR Repository / the 📋 Report tab, never from
`APP_DATA`. **This list is authoritative** — note that `a_crmOwner`,
`a_contactPhone` and `a_activityLog` are deliberately *not* in it: those three are
editable Section A fields, not intake.

> Because the strip is a delete and the write replaces the whole row, the intake
> keys never persist in `APP_DATA` at all. Adding a field to Section A does not
> put it under the strip — only the ten IDs above are protected.

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

### Auth and access management
`login` → (forced `changePassword` on first sign-in) → session. `forgotPassword` →
`resetPassword` for a lost password. `logout` revokes one session.
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

  // App data ("I-Passbook App Repository") — APP_DATA tab
  PASSBOOK_SHEET_ID: '141L8Wt4hrvJmN3dTtnI8VDK76NutK_7KZ_jbM2qEOwQ',
  DATA_TAB:          'APP_DATA',

  DRIVE_ROOT_FOLDER_ID: '1sc9mXOHPaWW1wiVvtDmyYLflGUogtm06',
  ALLOWED_DOMAIN: 'indrones.com',
  ADMIN_EMAILS: ['monish.raza@indrones.com'],          // exactly one
  EXTERNAL_EMAILS: ['kishor.salunkhe@uavgarage.com'],  // the one non-Indrones address
  API_VERSION: 2,
  SESSION_DAYS: 30,          // slid on use…
  SESSION_SLIDE_HOURS: 6,    // …but at most one write per session per 6h
  TEMP_PW_TTL_DAYS: 14,
};
```

Module-level (outside `CONFIG`) limits that are deliberately constants rather than
config, because changing one is a security decision, not a setting:

| Constant | Value | Guards |
|---|---|---|
| `MAIL_DAILY_CAP` | 400 | every `MailApp.sendEmail` in the script |
| `MAIL_AUTH_RESERVE` | 40 | the slots the nudge path may **not** spend |
| `CODE_MAX_PER_HOUR` | 3 | reset codes per email |
| `CODE_MAX_PER_HOUR_GLOBAL` | 12 | reset codes across all emails |
| `CODE_MAX_ATTEMPTS` | 5 | wrong guesses before a code is burned |
| `CODE_TTL_MIN` | 15 | how long a reset code lives |
| `SESSION_SLIDE_HOURS` | 6 | see above |
| `LOGIN_MAX_FAILS` | 5 in a 10-min window → 15-min lockout | `login` **and** `changePassword`, shared |

`ALLOWED_EMAILS` no longer exists: with no self-signup there is no allowlist to
consult, only the `@indrones.com` domain check plus the explicit
`EXTERNAL_EMAILS` exceptions.

> ⚠️ The **deployed** backend is an older build than `backend.gs` — keep
> `PASSBOOK_SHEET_ID` and `DRIVE_ROOT_FOLDER_ID` in sync with the live deployment.

**Columns A–D, F–I, K–N and P–R are accounted for; E, J and O are not.** The
customer Form writes them, the backend has no constant for them, and until the
intake mapper (see [02](02 - Architecture & Data Flow.md)) nothing in the app read
them. They now surface on the ticket's 📋 Report tab under "Other columns from the
Sheet". If you add a constant for one, remove its reliance on that fallback.

---

## Legacy Importer

`importLegacyData()` — utility function to crawl old per-IR tabs (e.g., `IR409` tab) and migrate them into the unified `APP_DATA` format. Cell mappings are hardcoded and need manual adjustment per legacy sheet format.