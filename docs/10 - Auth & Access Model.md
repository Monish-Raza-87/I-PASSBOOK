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
one sign-in per working day — email + password, then the 6-digit code emailed to
that address — because the session is 8h30m and **absolute**, so it does not carry
someone from one shift into the next.

There is **no self-signup**. No captcha, no allowlist, no "request
access" screen, no admin approval queue. Every account is created by the admin.
The **emailed code is not a way in for a stranger** — it is a second step on an
account whose password has *already* been verified, and it is issued only from
behind that verification. The old flow asked a new hire to prove who they were
three times, then parked them on a "you don't have access" screen until a human
noticed — that parked-human step was the actual onboarding bug.

## Two levels, not three

| Level | Who has it | Comes from |
|---|---|---|
| **View + comment** | every signed-in account, on all six sections **and the Overview** | the default in `getEffectiveAccess` — *nothing* records it |
| **Edit** | a section, for the people whose departments grant it | `access.json` → `departments` + `memberships` |

Comment travels with view — there is no separate comment level to grant. The
owner's words: *"Just two — view and edit. view and comment are for everyone.
i.e., comment comes with view. and edit comes with access provided."*

**Edit is many-to-many in both directions.** One person may hold several
departments; one department holds many people. `memberships` is therefore
`{ email: [departmentKey, …] }` — a **list per person**, so one person's departments
are one key read rather than a scan of an edge list (which is what the sheet version
did on every single access check, and `getEffectiveAccess` runs on every
authenticated request). A wide `dept1|dept2|…` layout was rejected for the same
reason it was before: it forces a schema change every time a department is added.

### Triage is a second axis, not a seventh section

Editing the **Overview** — the customer's owner and contact phone, and the ticket
status — is gated on a **`triage`** flag stored as a **sibling of `grants`** in the
department record, not as a section grant. It is granted to **CR** (who owned the
ticket header before) and to **Management** (who asked for it).

Do not model it as a seventh grant — and note that the storage makes that hard to do
by accident: `triage` is not inside `grants`, so nothing iterating section grants can
pick it up. A department may triage while editing **no section at all**, and that is
exactly what CR and Management get — so a `sec-a`-as-a-section design would have
forced them to hold an edit grant they must never have. The two axes are read in one
pass (`departmentCapabilities`, whose only caller is `getEffectiveAccess`) and
answered by two separate questions on the frontend: `canEditSection(id)` and
`canTriage()`.

`getEffectiveAccess` sets `perms['sec-a']` to `'view'` for everyone and raises it to
`'edit'` when triage is held, so the Overview's two inputs go through the **existing**
`canEdit` seam and are disabled for everyone else. The backend is the authority; the
save is rejected without the flag.

> **The bug that design would have shipped.** `getPassbook` filters rows with
> `canView(access.permissions, secId)`, and `getEffectiveAccess` built that map from
> `SECTION_KEYS`. Once `sec-a` left that list, *no* permission map had the key — so
> the Overview's data would have been **dropped for all 18 non-admin users** and kept
> only for the admin, and it would have looked perfectly fine to whoever tested it,
> because the tester is the admin. `getPassbook` now names `OVERVIEW_KEY` explicitly,
> and the cutover check in [08](08 - Development Guide.md) signs in as a CR *and* a
> Production account rather than trusting the admin's view.

### Why the grants are not in a sentinel store

There is an admin-editable team directory persisted to a `__CONFIG__` sentinel,
which is a tempting home for department assignment. **Do not put a grant there.**
`__`-prefixed irNumbers skip *every* ACL check in `saveSection`, so a grant stored
as a sentinel could be rewritten through `saveSection` by the very people it is
meant to restrain. Grants live in `access.json` inside `_store/`, which is reached
only through `accessStore()` and the admin actions, all behind `requireAdmin` — and
`_store/` itself is Private, so it is not readable through the Drive UI either.

### The fallback fails closed

`myAccess()` returns a provisional object while `getMyAccess` is in flight (first
paint, or a transient backend failure). It grants **view everywhere and edit
nowhere**. The asymmetry is the point: a disabled Save button is recoverable, an
unauthorised write is not. It previously failed open on edit, which turned
"permissions have not arrived yet" into "everyone can write". The backend enforces
independently, so a wrong guess costs a button — never a bad write.

## The forced first password change

**Enforced by the absence of a token.** When an account still has
`mustChange = 'yes'`, `doLoginPassword` returns
`{ status: 'ok', mustChangePassword: true, email, name }` — and **no
`sessionToken`**. No code path mints a session for such an account except
`changePassword` itself. The frontend screen is therefore pure presentation:
deleting it in devtools changes nothing, because there is nothing to use.

A `Scope='pwchange'` restricted session was evaluated and **rejected** — it would
add a field that every `requireAuth` path must forever remember to check, and one
forgotten check silently promotes a temp-password holder to full user. With no
token, there is no footgun.

`changePassword` is unauthenticated (a first-login account has no token) and takes
a password, so it is exactly as guessable as `login` — it is wired to the **same**
`attempts.json` limiter, not a new one. On success it re-verifies the current
password, clears the flag on the same account record it re-read **inside the lock**,
revokes every session the temp password may have minted, and then mints a real one.

**Both doors enforce the same expiry.** `changePassword` accepts the same temporary
credential `login` does, so a TTL checked only in `doLoginPassword` closed the front
door and left the side door open: an expired temp password could be POSTed straight
here, verified against the hash, and minted a full session (30 days at the time;
8h30m today). `tempPasswordExpired()`
is now called on both paths, before either mints anything.

## The session

| | |
|---|---|
| Where | `localStorage`, under `ipb_session` — a separate key from the profile (`ipb_user`) |
| Server side | as a **key of `sessions.json`** in `_store/` — keyed by the token itself, so a lookup is one key read and a revoke one key assignment. The record is `{email, createdAt, expiresAt, revokedAt}` — deliberately **no `lastSeenAt`**, because with an absolute expiry nothing would ever read or update it |
| How long | **8h30m, absolute** — `CONFIG.SESSION_HOURS`, one working day |
| Slide | **none.** `lookupSession` never rewrites `expiresAt`; the expiry is fixed at mint time, so a session ends one working day after sign-in however busy that day was. Removing the slide also removed the throttled write this path used to do — a lookup is now a **pure read** |
| Idle timeout | **none** — deleted, and now bounded by the absolute expiry above, so an idle tab cannot outlive the shift |

`lookupSession` deliberately distinguishes **"this token is not valid"** from **"the
session store cannot be read"**: the first returns null (the frontend signs the user
out), the second **throws**, and `sessionCheck` catches it and fails **open** with a
message that never starts with `unauthorized`. Without that, one bad `sessions.json`
would answer "your session died" to all twenty users in the same poll window — the
frontend's probe trusts that answer.

The owner's ask was explicit: *"No automatically sign-out. Keep it as simple as
google-sheet."* Google's web default is 14 days (configurable 7/14/30 or never);
native mobile apps never expire. That is where the **30-day sliding session** came
from — and it has since been **reversed**. The session is 8h30m and absolute,
because a session that slides forward on every request never expires for exactly the
people who use the app most: the daily sign-in that the emailed code protects never
happened for them, and the code was decoration on the busiest accounts. One working
day is also the window the sign-in code lives in, so the code and the session it
mints now end together.

The 15-minute idle timeout and the `sessionStorage` home are still **deliberate
removals**, and they stay removed. Do not reintroduce them as a hardening measure
without re-reading this file: they were the reason people re-authenticated
constantly, which was the complaint. The absolute expiry is a different lever — it
bounds how long a session may live, not how long it may sit idle.

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

## The emailed sign-in code

Sign-in is **two steps**: the password, then a 6-digit code mailed to the same
address. The password is verified first, and everything about the code's design
follows from that one fact — including why its limits are looser than the reset
code's.

`doLoginPassword` verifies the password and then hands to
`loginOtpStep(email, params.code, name)`:

| Call | What comes back |
|---|---|
| no `code`, no live code | one is issued via `issueAuthCode(email, 'login', LOGIN_OTP_TTL_MIN)` and emailed — `{status:'ok', otpRequired:true, codeSent:true, …}`, with **no token** |
| no `code`, but a live code exists | nothing is issued and no mail is sent — `{codeSent:false, message:'Enter the sign-in code already emailed to you today.'}` |
| `code` supplied | `verifyAuthCode(email, 'login', code, false)`; on success it returns null and the session is minted |

**The code is reused, not re-issued.** Issuing a second one would retire the live
code by design (`issueAuthCode` marks earlier live codes of the same purpose used),
so the mail already sitting in someone's inbox would stop working — "one code per
day" would silently become "the newest mail wins". A phone at 9am and a desktop at
2pm take the same code from the same single mail.

**The redeem does not consume it.** `consume = false` leaves the entry live. That is
the whole feature, and its cost is named at the end of this section.

**Both existing gates run first.** The OTP step sits *after* the disabled-account
check and *after* the temp-password branch, so neither is bypassed by the new step —
a disabled account is still refused, and a first-login user is still answered
`mustChangePassword` with no token and is never asked for a code.

### What bounds the reuse

- **The attempt counter is shared across the whole day**, because the code entry is:
  5 wrong guesses (`CODE_MAX_ATTEMPTS`) burn it and force a fresh one. It is
  deliberately counted per code, not per IP — GAS web apps expose no reliable client
  address, and the entry is the only thing that can be counted honestly.
- **A code still expires.** `LOGIN_OTP_TTL_MIN` is 510 minutes, and an expired entry
  is marked used rather than left usable.
- **The password is re-sent with every attempt.** The frontend holds it in memory
  only (`_otpPassword`, never persisted), so a reload between the two steps restarts
  the flow instead of leaving a half-open conversation — a code on its own, without
  the password, buys nothing.

### Reset code and sign-in code: one machinery, opposite endings

| | Reset code | Sign-in code |
|---|---|---|
| Issued by | `forgotPassword`, for any address, unauthenticated | `doLoginPassword`, **only after a correct password** |
| Lives | `CODE_TTL_MIN` — **15 minutes** | `LOGIN_OTP_TTL_MIN` — **8h30m**, the same window as the session |
| On success | **consumed** — one reset, one code (`consume=true`) | **reused** — `consume=false` |
| Retry | 5 wrong guesses burn it | 5 wrong guesses burn it, and the count runs all day |
| Global ceiling | `CODE_MAX_PER_HOUR_GLOBAL` — **12/hour** | `CODE_MAX_PER_HOUR_GLOBAL_LOGIN` — **120/hour** |
| Redeem path | `redeemCodeIn(…)` inside `resetPassword`'s wider lock | `verifyAuthCode(…)`, which takes its own lock |

Both are **issued** by the one `issueAuthCode(email, purpose, ttlMin)` — per-email
budget, 60s resend gap, global ceiling, retire the earlier live code — and
**redeemed** by the one lock-free `redeemCodeIn(entries, email, purpose, code,
consume)`, with `verifyAuthCode` as the locking wrapper for callers that hold no
lock. The split is why `resetPassword` calls `redeemCodeIn` directly: it redeems
inside a lock that also covers `users.json` and `sessions.json`, because a reset is
one event and must not half-happen, and a nested lock deadlocks rather than queues.
Two copies of a security throttle is how one of them quietly stops working.

The **per-email budget counts codes of any purpose**, so asking for a password reset
cannot buy extra sign-in codes in the same hour. The **global ceilings are per
purpose** (`globalCodeCap`), and the 10x gap is deliberate: `reset` is reachable by
any unauthenticated caller for any address, while `login` cannot be walked that way
and has to absorb the whole team between 9 and 10am. At a shared 12/hour, the app
would refuse a code to everyone after the twelfth and look broken at exactly the
moment everyone is trying to start work.

### The one honest error

When there is no live code to reuse **and** one cannot be issued — the per-email
hourly budget, the 60s resend gap (which counts codes of *any* purpose, so a reset
requested a moment ago is enough), or the global hourly ceiling — the sign-in path
answers `{status:'error', message:'Could not send a sign-in code just now — wait a
minute and try again.'}`.

It has to be an error rather than a prompt: there is no code, so telling the user to
enter "the code we emailed you" would be a plain lie with no way forward from that
screen. The message deliberately does not say which limit was hit — that is
admin-facing detail, not something a person signing in can act on.

### The gap, and what closes it: the sign-in audit

The reuse is the feature and it has a cost worth stating plainly. A sign-in code
read over someone's shoulder, or out of an inbox left open, stays usable for
**8h30m** — the same window as the session it mints — and the same code will sign in
on more than one device. A 15-minute reset code, consumed by its one use, has
neither property.

What bounds it is the shared attempt counter and the password that must be
presented alongside every attempt. **And since 2026-09-19 every successful sign-in
also writes a line to `audit/signins.jsonl`** — the record that makes an abused code
visible rather than merely bounded. One line per session minted:

| Field | Holds |
|---|---|
| `t` | the time, in the audit trail's own `dd-MMM-yyyy HH:mm:ss` IST format, so `maintenancePruneAuditLog` ages it correctly with no special case |
| `by` | the account that signed in — read from the verified identity, never from the request |
| `nw` | `code <age> old · <device>` |
| `ir` / `sec` / `ev` | `__AUTH__` / `signin` / `signin`, so the line is recognisable as belonging to no ticket |

**The age is the field that matters.** A code issued and redeemed within a minute is
an ordinary sign-in; a code issued at 9am and redeemed at 4pm is the shape of a code
somebody else obtained. The device is what the *browser claimed* (`Android · Chrome`,
`Windows · Edge`, `iOS · Safari`, plus `· home-screen app` when the PWA is installed)
— a clue, not proof, and coarse on purpose so a human can scan it.

Read it with **`reportRecentSignins(days)`** from the Apps Script editor — the same
kind of operator lever as `maintenancePruneAuditLog`, and deliberately not a screen:
the record's value is that it exists and can be produced on demand.

**The record can never refuse a sign-in.** Its write sits in its own `try`, separate
from the last-login stamp's, and the session is minted *after* it. A log that
sometimes blocks the door it is meant to watch would be worse than no log, so this is
enforced rather than intended: `smoke-store.mjs` replaces `appendAuditLinesLocked`
with a throwing function, completes a sign-in, and asserts the returned token is a
real session. Two smaller rules protect it in the same spirit — the code's issue time
is read *after* the code verifies (so the entry found is the one just accepted, still
live because `consume=false`), and the read is wrapped so an unreadable `codes.json`
records `age unknown` instead of failing a verified sign-in.

## Password recovery

`forgotPassword` → `resetPassword`. The response is byte-identical whether or not
the account exists, so it cannot be used to enumerate staff. It carries no throttle
of its own: it calls the same `issueAuthCode(email, 'reset', CODE_TTL_MIN)` the
sign-in path uses (see above), so the per-email budget, the resend gap, the global
ceiling and the retire-the-older-code rule cannot drift between the two mails — and
a throttled issue is answered with the same generic message, so the throttle is not
itself an oracle. Guessing is capped at 5 attempts inside the code's 15-minute
window. `resetPassword` **returns no token** — the user signs in with the new
password afterwards, which is what proves it was typed correctly.

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
- **Departments** — the department → section grant grid (six checkboxes, **B–G**)
  plus a **Triage** checkbox rendered after them and labelled `TR`, so it reads as a
  different kind of thing, plus a member count. *"Need one person to edit one
  section? Create a department with just that person in it."* The collector reads
  `.acc-grant[data-key]` generically, so the Triage box is saved with no change to
  the collector — it only needed the extra label.
- **Create people** — single add, a bulk textarea (one email per line, split on
  `[\s,;]+`, deduped, **skip-and-report** so one typo cannot abort a 19-person
  run), and the one-time credentials panel.

**Temp passwords are never stored.** Only the hash, the salt and the
`tempPwIssuedAt` timestamp reach the store. A temp password is 5
unambiguous letters (no `I O 0 1 l`) + `-` + 4 digits, e.g. `Kx7Qm-4392`, and it
expires after 14 days. It is shown once, with a copy button and an explicit
warning.

**The credentials txt** is the handover document: link, email, temp password,
the three first-sign-in steps (including "Add to Home screen"), the view+comment
vs edit explanation, the forgot-password path, and *"Keep this safe and do not
forward it."* A second copy button emits CSV (`email,tempPassword`) for a private
document or mail-merge — **never for the repo**, which is public.

### Account reset

An admin action removes every account except the admin's, plus their memberships,
and revokes all their sessions. It is irreversible, so it is **two steps in the
UI, backed by two calls**:

1. **Review** — `purgeUsers` with `dryRun=1` returns the accounts that *would* go
   and writes nothing, so it is safe to press by accident. The modal renders them as
   a copyable tab-separated list.
2. **Delete** — the same call without `dryRun`, pinned with
   `expect=<reviewed count>`. If an account was created or removed in between, the
   backend refuses and nothing is deleted, so the list a human approved is the list
   that goes.

It requires the literal word `PURGE`, leaves admin accounts alone, and runs inside a
`LockService` script lock — see [04](04 - Backend API Reference.md).

The first version of this was one press that deleted immediately and returned a
"backup" in the response while the copy told the admin the rows were *"shown below
first"*. A response is not a backup: a dropped connection, or simply a closed tab,
took the only record of those accounts with them.

**The Drive store obeys the same rule.** `snapshotStore('purge-users', [...])`
writes `backups/purge-users-<yyyy-MM-dd-HHmmss>.json` holding the whole of
`users.json`, `access.json` and `sessions.json` — **always a new file**, so it can
never overwrite an earlier snapshot — and it does so **before** the first destructive
write, refusing if it cannot. The response names the backup file, so the rollback
path is something the admin has rather than something the admin is told about. This
replaces `restoreAppDataFromBackup()`, which was deleted with the sheet: Drive
revision history is not a durable substitute for a JSON file's history, so the
snapshot is a real file instead.

## Departments

Production · QC · Flight Test · IQC · Purchase · Inventory · CR · Compliance ·
Engineering · Management

Departments are created in the admin UI and carry their own section grants. The
**seeded** grants are the owner's mapping, not an inference — a wrong guess here
grants write access silently, so for a release the grid was deliberately seeded
*empty* and the mapping was requested in writing. It arrived, and now lives in
`SEED_GRANTS` in `backend.gs`:

| Department | Sections | Also |
|---|---|---|
| Production | B, C, D, E, G | |
| QC | B, C, D, F | |
| Flight Test | F | |
| Purchase | D | |
| Inventory | B, D, G | |
| Engineering | D | |
| CR | — | **Triage** |
| Management | — | **Triage** |
| IQC, Compliance | — | |

Changing it is the owner's call; edit `SEED_GRANTS` and re-run `seedDepartments()`.

**`seedDepartments()` is an upsert, never a blind append, and it reports what it
did.** The distinction matters: "the row is present" is not "the row is correct",
so a half-granted department would otherwise never be repaired. It prints
`created` / `updated` (naming the delta, e.g. `qc: +sec-f, -sec-g`) / `unchanged`,
and — critically — a **`dropped` list**: any grant the new mapping does not
reproduce. A grants rewrite is the one operation that can lose a grant without
anyone noticing, so the thing it might lose is printed rather than assumed.

`seedMemberships()` writes the person↔department edges from `SEED_MEMBERSHIPS`.
It **only ever adds** and says so in its report ("Nothing removed"), because it must
not disturb an edge an admin added later — which is why it does not reuse
`setUserDepartments()` (that replaces one person's whole list, correct for an admin
editing that person, wrong for a seed). Emails with no account yet are printed: the
edge is correct and harmless, but those people cannot sign in. **IQC and Compliance
are deliberately omitted**, and the report says so, so the omission is visibly
intentional.

Two people hold two departments on purpose, and both are faithful rather than
clever: the owner gave **one list for Purchase and Inventory**, and since
`inventory` and `purchase` have *different* grants (B/D/G vs D), the three people
get **both edges** rather than a merged department or a guess about who belongs
where. Both are reversible in the Departments tab in seconds.

### Deleting a department takes its memberships with it

`deleteDepartment` removes the department key **and** filters that key out of every
membership list, deleting a list that becomes empty. Otherwise a dangling membership
would resurrect the department's grants the moment its key was recreated —
silently, and under the same name. The access matrix and the department record are
in the **same file**, so this is one locked write, not two that can half-fail.

### The re-lettering hazard is gone

Shrinking `SECTION_KEYS` from nine to six **re-lettered every column** in the sheet
version, which made a stale `DEPARTMENTS` tab actively dangerous: old column 4
(`sec-a`'s grant) would be read as `sec-b`'s, and old column 10 (old `sec-g`'s) as
`Updated At`. That is why `deptTabShape()` and `migrateAddColumns()` existed, and
why they are deleted: a grant is a **key** in `access.json` now, so there is no
position to re-letter and no header to classify. Reordering the sections cannot
misgrant anything.

## Constraints that are load-bearing

- **An account's fields are named, and the ones with security meaning have fixed
  spellings**: `mustChange`, `status`, `hash`, `salt`, `tempPwIssuedAt`. Flags are
  stored as the literals `'yes'`/`''`, never booleans. There is no positional block
  any more and no column that must not move — which is precisely why `saveUser`,
  `userCol` and `USER_ID_BLOCK_COLS` are gone: a key assignment has no position.
- **`requireAuth`/`lookupSession` keep their `→ email|null` signature**, so
  `getPassbook`/`saveSection`/`sendNudgeEmail` and their call sites are untouched.
  `lookupSession` **throws** when the session store cannot be read, rather than
  answering `null`, and `sessionCheck` fails open on that — see "The session" above.
  It is also a **pure read** now: with an absolute expiry there is no slide to write
  back, so a lookup never touches the store.
- **Nothing dispatches outside `try`** in either router. Pre-auth dispatch used to
  sit outside it, where an exception escaped as an HTML error page — which the
  frontend's interceptor read as "your session died".
- **`ADMIN_EMAILS` holds exactly one address.** Adding a second is a one-line edit
  plus a GAS redeploy; until then, nobody can provision or unblock anyone if that
  one person is unreachable.
- **Every store read-merge-write holds the lock, and reads inside it with
  `readJsonLocked`.** Drive has no transactions: two writers that each read before
  the other wrote lose one of the two changes, and a read taken before the lock is
  merged over whatever landed in between. `readJson`'s memo is *not* usable inside a
  lock for exactly that reason.

## Related

- [04 — Backend API Reference](04 - Backend API Reference.md) — the actions, the
  `access.json` schema, the `CONFIG` block
- [05 — Configuration & Secrets](05 - Configuration & Secrets.md) — and the
  never-commit-a-credential rule (the repo is **public**)
- [08 — Development Guide](08 - Development Guide.md) — the store layout, the deploy
  order, and why the one-time setup no longer needs a cutover window: there are no
  columns to widen and no live rows to rewrite
