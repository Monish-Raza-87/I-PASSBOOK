# 10 — Auth & Access Model

The canonical write-up of how someone gets into I-PASSBOOK and what they may do
once they are in. Everything here is the owner's decision, made deliberately, and
several of the choices invert what the app did before — where that is true, the
old behaviour is named so a future session does not "fix" it back.

## The funnel, in two steps

**Admin, once per person:** User Access → add the email → tick their departments →
copy the generated credentials block into a txt and hand it over.

**Person, once ever:** open the link → email + temp password → set their own
password → in.

From then on: view + comment everywhere, edit on their departments' sections, and
no re-login for 30 days of activity.

There is **no self-signup**. No OTP, no captcha, no allowlist, no "request
access" screen, no admin approval queue. Every account is created by the admin.
The old flow asked a new hire to prove who they were three times, then parked them
on a "you don't have access" screen until a human noticed — that parked-human step
was the actual onboarding bug.

## Two levels, not three

| Level | Who has it | Comes from |
|---|---|---|
| **View + comment** | every signed-in account, on all nine sections | the default in `getEffectiveAccess` — *nothing* records it |
| **Edit** | a section, for the people whose departments grant it | `DEPARTMENTS` + `USER_DEPARTMENTS` |

Comment travels with view — there is no separate comment level to grant. The
owner's words: *"Just two — view and edit. view and comment are for everyone.
i.e., comment comes with view. and edit comes with access provided."*

**Edit is many-to-many in both directions.** One person may hold several
departments; one department holds many people. `USER_DEPARTMENTS` is an edge list
(one row per person↔department pair) for that reason — a wide `dept1|dept2|…`
layout was rejected because it forces a schema change every time a department is
added.

### Why the grants are not in a sentinel store

There is an admin-editable team directory persisted to a `__CONFIG__` sentinel,
which is a tempting home for department assignment. **Do not put a grant there.**
`__`-prefixed irNumbers skip *every* ACL check in `saveSection`, so a grant stored
as a sentinel could be rewritten through `saveSection` by the very people it is
meant to restrain. Grants live in real Sheets tabs.

### The fallback fails closed

`myAccess()` returns a provisional object while `getMyAccess` is in flight (first
paint, or a transient backend failure). It grants **view everywhere and edit
nowhere**. The asymmetry is the point: a disabled Save button is recoverable, an
unauthorised write is not. It previously failed open on edit, which turned
"permissions have not arrived yet" into "everyone can write". The backend enforces
independently, so a wrong guess costs a button — never a bad write.

## The forced first password change

**Enforced by the absence of a token.** When an account still has
`Must Change Password = 'yes'`, `doLoginPassword` returns
`{ status: 'ok', mustChangePassword: true, email, name }` — and **no
`sessionToken`**. No code path mints a session for such an account except
`changePassword` itself. The frontend screen is therefore pure presentation:
deleting it in devtools changes nothing, because there is nothing to use.

A `Scope='pwchange'` restricted session was evaluated and **rejected** — it would
add a column that every `requireAuth` path must forever remember to check, and one
forgotten check silently promotes a temp-password holder to full user. With no
token, there is no footgun.

`changePassword` is unauthenticated (a first-login account has no token) and takes
a password, so it is exactly as guessable as `login` — it is wired to the **same**
`LOGIN_ATTEMPTS` limiter, not a new one. On success it re-verifies the current
password, clears the flag as part of the one identity-block write, revokes every
session the temp password may have minted, and then mints a real one.

## The session

| | |
|---|---|
| Where | `localStorage`, under `ipb_session` — a separate key from the profile (`ipb_user`) |
| How long | **30 days**, slid forward on each authenticated request |
| Idle timeout | **none** — deleted |
| Slide throttle | at most one expiry write per session per 6h |

The owner's ask was explicit: *"No automatically sign-out. Keep it as simple as
google-sheet."* Google's web default is 14 days (configurable 7/14/30 or never);
native mobile apps never expire. 30 days, slid on use, was chosen to match.

The 15-minute idle timeout and the `sessionStorage` home were both **deliberate
removals**, made after that decision. Do not reintroduce them as a hardening
measure without re-reading this file: they were the reason people re-authenticated
constantly, which was the complaint.

### Why the repeated sign-in prompts actually happened

Not the TTL. A **loop**: `stopNudgePolling()` existed and was never called, so a
90-second poll kept firing an unauthorised request into a dead session; the
interceptor wiped local auth and re-armed itself; and the User Access modal's
Reconnect button called `signOut()`. The fix is structural, in four parts:

1. Any good response clears `_authSuspect`.
2. Only a **parseable JSON** `unauthorized`, on a call that **actually carried a
   token**, may start an ejection. An HTTP error, an HTML error page or a CORS
   failure never can — those are what a flaky connection looks like.
3. On suspicion, **storage is not touched.** `confirmSessionAlive()` probes once
   via `_origFetch` (so it cannot recurse), and returns **`true` on network
   failure**. Ejecting on a bad connection is the bug, not the fix.
4. If it is genuinely dead: in the admin modal, an inline **retry** that calls
   `loadAccessData()` — *not* `signOut()`. Elsewhere, the ordinary expiry path.

`clearLocalAuth()` is the single teardown path and stops the nudge poll. Half-cleared
state was itself a cause of spurious re-login: a stale profile with no token took
the `showAuth()` branch at boot.

## Password recovery

`forgotPassword` → `resetPassword`. The response is byte-identical whether or not
the account exists, so it cannot be used to enumerate staff. It is throttled to 3
codes/hour/email with a resend gap, retires earlier live codes, and caps guessing
at 5 attempts inside the code's 15-minute window. `resetPassword` **returns no
token** — the user signs in with the new password afterwards, which is what proves
it was typed correctly.

Mail goes through `MailApp` only. **Never `UrlFetchApp`** — that scope broke
Google Sign-In once, and the `script.send_mail` scope is already granted. One
daily ceiling (`MAIL_DAILY_CAP`, enforced in `mailQuotaOk`) covers **every** mail
this script sends. The high-volume comment path stops short of it, leaving
`MAIL_AUTH_RESERVE` slots that only auth mail may spend — so a busy comment day
cannot starve the reset code that is the only way back into a locked account.

An earlier draft of this document claimed the cap already covered every caller.
It did not: `sendNudgeEmail` called `MailApp.sendEmail` directly, so any signed-in
user could loop it and take out password recovery for the whole company.

## The admin UI (User Access)

Three tabs, all powered by one `?action=listUsers` call:

- **People** — a people × departments tick matrix. One "Save all" posts the grid,
  and unchanged rows are skipped, so a 19-person grid with one edit is one write.
  Per-row actions: reset password, enable/disable.
- **Departments** — the department → section grant grid (nine checkboxes A–I) plus
  a member count. *"Need one person to edit one section? Create a department with
  just that person in it."*
- **Create people** — single add, a bulk textarea (one email per line, split on
  `[\s,;]+`, deduped, **skip-and-report** so one typo cannot abort a 19-person
  run), and the one-time credentials panel.

**Temp passwords are never stored.** Only the hash, the salt and the
`Temp Password Issued At` timestamp reach the Sheet. A temp password is 5
unambiguous letters (no `I O 0 1 l`) + `-` + 4 digits, e.g. `Kx7Qm-4392`, and it
expires after 14 days. It is shown once, with a copy button and an explicit
warning.

**The credentials txt** is the handover document: link, email, temp password,
the three first-sign-in steps (including "Add to Home screen"), the view+comment
vs edit explanation, the forgot-password path, and *"Keep this safe and do not
forward it."* A second copy button emits CSV (`email,tempPassword`) for a private
Sheet or mail-merge.

### Account reset

An admin action removes every `USERS` row except the admin's, plus their membership
edges, and revokes all their sessions. It is irreversible, so it is **two steps in
the UI, backed by two calls**:

1. **Review** — `purgeUsers` with `dryRun=1` returns the rows that *would* go and
   writes nothing, so it is safe to press by accident. The modal renders them as a
   copyable tab-separated list.
2. **Delete** — the same call without `dryRun`, pinned with
   `expect=<reviewed count>`. If an account was created or removed in between, the
   backend refuses and nothing is deleted, so the list a human approved is the list
   that goes.

It requires the literal word `PURGE`, leaves admin rows alone, and runs inside a
`LockService` script lock — see [04](04 - Backend API Reference.md).

The first version of this was one press that deleted immediately and returned a
"backup" in the response while the copy told the admin the rows were *"shown below
first"*. A response is not a backup: a dropped connection, or simply a closed tab,
took the only record of those accounts with them.

## Departments

Production · QC · Flight Test · IQC · Purchase · Inventory · CR · Compliance ·
Engineering · Management

Departments are created in the admin UI and carry their own section grants. The
grid is seeded **empty** — no grant is inferred from a department's name, because
a wrong guess here grants write access silently. The owner supplies the mapping.

## Constraints that are load-bearing

- **`USERS` columns A–E must not move.** `doLoginPassword` reads `row[1]`/`row[2]`
  by index. New columns are appended from F. Flags are stored as the literals
  `'yes'`/`''`, never booleans.
- **`requireAuth`/`lookupSession` keep their `→ email|null` signature**, so
  `getPassbook`/`saveSection`/`sendNudgeEmail` and their call sites are untouched.
- **Nothing dispatches outside `try`** in either router. Pre-auth dispatch used to
  sit outside it, where an exception escaped as an HTML error page — which the
  frontend's interceptor read as "your session died".
- **`ADMIN_EMAILS` holds exactly one address.** Adding a second is a one-line edit
  plus a GAS redeploy; until then, nobody can provision or unblock anyone if that
  one person is unreachable.

## Related

- [04 — Backend API Reference](04 - Backend API Reference.md) — the actions, the
  tab schemas, the `CONFIG` block
- [05 — Configuration & Secrets](05 - Configuration & Secrets.md) — and the
  never-commit-a-credential rule (the repo is **public**)
- [08 — Development Guide](08 - Development Guide.md) — the deploy order and why
  the editor/deployment split lets migrations run before cutover
