# 04 — Backend API Reference

The backend is a **Google Apps Script (GAS) web app** deployed from `backend.gs`.

**Base URL:** `https://script.google.com/macros/s/AKfycbz-borqx_TeCTh1Ibc70vv9SIHaFxRvVGs4XolbJG0EG2qEg4kVQ0hyclDOeLM8kCDP/exec`

---

## Access Control (per-user, per-section)

Each user has a **role** and a **per-section permission** of `view`, `comment` or
`edit`. There is no separate role registry beyond the admin list:

- `ADMIN_EMAILS` → `{ role: 'admin', permissions: { every section: 'edit' } }`, and
  admins bypass every permission check.
- Otherwise the `ACL` tab (on the app-data sheet, created on demand by
  `getOrCreateAclTab`) is scanned for the caller's email. One row per email; the
  columns after the email are the nine section keys, each holding `view`,
  `comment` or `edit` (blank = no access).
- **No matching row → `{ role: 'none', permissions: {} }`** — the default is no
  access, not access.

`canView(perms, sec)` accepts any of the three levels; `canEdit` requires `edit`.
The frontend mirrors this in `canViewSection` / `canCommentSection` /
`canEditSection`, but **with a deliberate permissive fallback**: while `access` is
undefined (during a backend redeploy window, or a transient `getMyAccess`
failure) it grants edit on every section, so the app keeps working exactly as it
did before ACLs existed. That leniency is safe only because the backend enforces
independently — do not make the frontend the only check.

The three entry points — `listACL` (read the matrix), `requestAccess` (a user
asks), `decideRequest` (an admin approves or denies) — are all admin-gated except
`requestAccess`.

---

## Sentinel stores (no redeploy to add one)

App-owned records that are **not** one of the 9 workflow sections are saved under
an `irNumber` beginning with `__`. `backend.gs` exempts those from **every**
per-section ACL check (`getPassbook` and `saveSection` both test
`String(irNumber).indexOf('__') === 0`), so a brand-new store works against the
already-deployed backend with no redeploy — exactly as `__CONFIG__` and
`__NUDGES__` already do. `sectionId` becomes each record's own key:

| irNumber / sectionId | Holds |
|---|---|
| `__CONFIG__` / `team-directory` | `{ entries: [{name, email}] }` |
| `__CONFIG__` / `inward-options` | `{ options: {…} }` |
| `__CONFIG__` / `iqc-config` | `{ zones, resultOptions }` |
| `__IRS__` / `<irNumber>` | App-owned workflow state — status, assignee, priority, type, `done[]` |
| `__NUDGES__` / `all` | `{ items: [comment, …] }` |

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

> ⚠️ **Sentinel rows are readable and writable by ANY signed-in user.** The ACL
> exemption is what makes zero-redeploy stores possible, and also means these are
> shared scratch space, not access-controlled storage. Never put anything
> sensitive in one.

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
- `role: 'none'` → `{ status: 'ok', sections: {} }` (empty, not an error —
  defence in depth; the frontend never routes such a user here).
- For a **real** IR, sections the caller cannot at least view are omitted
  (`canView`), unless they are an admin.
- For a **sentinel** IR, everything is returned — see above.

Passing a sentinel irNumber returns that whole store keyed by sectionId, which is
how `loadSentinelAll('__IRS__')` reads every ticket's workflow state in one call.

### `getMyAccess`
Returns the signed-in user's role and per-section permissions
(`{ role, permissions: { 'sec-a': 'edit', … }, pendingRequest }`), used by the
frontend's `canViewSection` / `canCommentSection` / `canEditSection`.

### `getAuditLog`
```
GET {BASE_URL}?action=getAuditLog&irNumber=IR409
```
Returns the `AUDIT_LOG` trail for one IR, newest first (see *Audit trail* below).

### `listLegacyIRs`
Lists the pre-app per-IR tabs (legacy workbook, ~IR310–IR441) so the master list
can badge them and the detail view can show a read-only copy.

### `listACL` / `getCaptcha`
`listACL` returns the per-user per-section access matrix for the admin UI.
`getCaptcha` returns a fresh sign-up captcha challenge.

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

**Authorisation.** Real sections require access: `role: 'none'` →
`Forbidden: you do not have access to this IR.`; a role without edit on that
section → `Forbidden: you do not have edit access to <sectionId>.` Admins bypass.
Sentinel IRs skip both checks.

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
Relays a comment notification via `MailApp.sendEmail`, restricted to
`@indrones.com` recipients. The sender is the `replyTo`. Requires redeploy and a
one-time `script.send_mail` consent (see Development Guide).

### Auth and access management
`requestSignup` → `verifySignup` (OTP) → `login` (email + password) →
`logout`. Access is granted through `requestAccess` (user asks), `decideRequest`
(admin approves/denies) and `saveACL` (admin edits the matrix directly).

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
  ADMIN_EMAILS: ['customer.relations@indrones.com', 'monish.raza@indrones.com'],
};
```

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