# 10 — Auth & Access Model

The canonical write-up of how someone gets into I-PASSBOOK and what they may do
once they are in. Everything here is the owner's decision, made deliberately, and
several of the choices invert what the app did before — where that is true, the
old behaviour is named so a future session does not "fix" it back.

## One link, two doors

**There is one address.** `https://monish-raza-87.github.io/I-PASSBOOK/` is what the
owner hands to everybody, and it is the landing page for both audiences at once. The
screen is a **common head over two doors**, and the owner's ask — *"both portals are
linked/accessed via same link"*, with *"clear identification"* of which is which — is
answered by the role chip on each door bar, which is the **first thing inside the
control**, above every field.

The shape has moved twice and both moves are worth knowing, because the older shapes
are what a future session would otherwise restore:

- **Two cards side by side** was the first shape. A grid of two `.door glass-card`
  sections, stacked on a phone. It was replaced on 2026-10-08 — the owner:
  *"employee login box is much lengthier than customer's, plus employee one's looks
  cluttered … I liked how vercel is showing."*
- **Two cards stacked, both open** was the middle shape, and it made the page taller
  without answering the complaint.

- **Two cards stacked, one always open (an exclusive accordion)** was the third shape,
  and it too was rejected. The owner, 2026-10-09: *"no its not done, I asked page opens
  the tabs collapsed, then we may open anyone or collapse anyone without being
  dependent on other."* Opening either bar closed the other, and one bar was open on
  arrival. Both were wrong.

**What ships now is two independent, both-shut doors.** Stacking is still what fixes the
length problem rather than making the two panels equal: side by side, two panels of
different content are read against each other and the shorter one reads as incomplete
however it is filled. Stacked, each is only ever compared with the page, and the folded
one is a single 56px bar. But the interlock is gone: each bar reads its OWN state and
moves only itself, so any combination of open and shut is reachable.

`#auth-container` holds a `<header class="landing-head">`, a `.doors` flex column
(max-width 420px), the shared `.landing-terms` line, the language selector, `.landing-foot`
and the credit.

| | Employee (`#door-employee`) | Customer (`#door-customer`) |
|---|---|---|
| Holds | the one staff `#auth-form` — email → emailed code — plus the `.quick-row` (Google handoff, passkey, pattern) | its own `#cust-form`: welcome, the helper line, the address, **Continue**, `or`, and the desk's address for anyone not onboarded |
| Already signed in | the app shell | `#cust-session` replaces the form with **Open the Customer Space** → the portal, in this same page |
| Update banner | yes — it reports the *app's* build | no — a customer never runs the app |

**The customer door is a real sign-in form, and the portal opens behind it without the
URL moving.** Since v112 a customer arrives at the app's own address, signs in there, and
`enterCustomerMode()` replaces the staff document with the portal in place — the owner,
2026-10-22: *"it should be ideal that customers also go via …/I-PASSBOOK/ where there is a
login portal for customers. Post that login screen, they directly land into the page we
have just designed."* The portal itself lives in `portal.css` and `portal.js`; the old
`customer.html` survives only as a thin loader over those two files, because every
invitation already emailed points at it. The old rule here was *"the customer card opens the door; it does not copy it"* —
a link-out with a description and no form at all. That is no longer true and should not
be restored: the owner asked for the customer's own form, in the shape app.notion.com
uses, and the two doors now share only the one code step (`#code-view`) below them. What
the old rule was protecting is still protected: the portal keeps its own `ipbc_`
storage keys, so a customer session can never be inherited by, or inherit, a staff one
on a shared machine, and the signed-in customer gets a link rather than a second form.

`tools/smoke-shell.mjs` pins the markup and `tools/smoke-doors.mjs` pins the behaviour:
the head appears once and above the doors, the mark appears once and not again inside
either door, `.doors` is a flex column with no media query that could make it a grid,
both panels ship **folded** in the markup, and `setDoor()` writes all three statements of
the one fact in one pass: `data-open` turns the chevron, `hidden` folds the panel (with
the `!important` that beats `display: flex`), and `aria-expanded` tells a screen reader.

**Both-shut is not merely a legal state — it is the state the page arrives in.**
`paintDoors()` shuts both, every time, and restores nothing from storage. `DOOR_KEY`
(`ipb_door`) records only the last door a person actually *opened*, because the code step
comes back to the door that asked: a customer who mistyped their address and is put back
on the Employee bar has lost their place. It is not consulted on arrival.

The panels ship folded in the markup for the same reason. They shipped unfolded until
2026-10-09 on the argument that a JS-off page then still showed the door; that traded a
visible snap on every visit — both panels painted open, then folded a tick later — for a
fallback that was never worth anything, since `toggleDoor` is the only thing that ever
opened a panel and the bars are inert without JS.

## The funnel, in two steps

**Admin, once per person:** User Access → add the email → tick their departments →
copy the generated credentials block into a txt and hand it over.

**Person, once ever:** open the link → email + temp password → set their own
password → in.

From then on: view + comment everywhere, edit on their departments' sections, and
one sign-in per working day — email + password, then the 6-digit code emailed to
that address — because the session is 8h30m and **absolute**, so it does not carry
someone from one shift into the next.

**The Google door — a second way in, never a replacement.** On a browser already
signed into an @indrones.com Workspace account, a **Sign in with Google** button
appears above the password form: one click, no password and no emailed code,
because on that door the Workspace session *is* the factor. It is served by a
separate deployment of the same backend (see
[05](05 - Configuration & Secrets.md)); `CONFIG.SSO_URL` empty means the button is
not shown at all, and nothing else changes.

That click **leaves the page**, and that is the mechanism rather than a side effect:
a background `fetch` to the domain-restricted deployment is refused by Google with a
**401 before any of our code runs**, because a cross-site background request does not
carry the caller's Google session. A top-level navigation to the same URL reports the
caller perfectly. So the click navigates — first to **Google's own account picker**, and
then, with the chosen account, to the door, which reads the Workspace identity and
answers with a page naming that account and carrying **one link** — `target="_top"`,
which the user taps — back to the app with a **one-time handoff code** in the URL
fragment (`#sso=…`, or `#ssoerr=…` for a refusal). The app then swaps that code for a
session on the primary backend.

The picker is not decoration. A browser with more than one Google account signed in feeds
a web app its **default** account, and Apps Script gives no way to ask for a different one
— so on a phone holding a personal account and a work one, the door can be handed the
wrong identity. Worse, because the door deployment is restricted to `indrones.com`, a
personal default makes Google refuse the request before our code runs, which is a page of
Google's that we cannot put a message on. Choosing **before** the browser leaves is the
only place that can be fixed from. For the same reason the door's own page offers **"Not
you? Choose a different account"**, so an account that is merely the wrong one (the other
indrones account on the same phone, one with no account row, a disabled one) is one tap
from being corrected.

That last tap is not a design choice. Apps Script cannot redirect a top-level window on
its own — since the September 2021 IFRAME sandbox change a script page may not navigate
the top window without a user gesture, and `ContentService` cannot serve HTML at all,
so the "bounce straight back" version showed users the source of a page that never ran.
Both failures are silent, which is why the tests now pin the shape of that page.

The code is 32 hex characters, single-use and live for two minutes; it rides in the
fragment, which is never sent to a server, and the link target is a server-side
constant, so the door cannot be turned into an open redirect.
Both the code and the address-bar trace are gone by the time the app has drawn.

Swapping that code for a session is one Apps Script round trip, so the app covers it
with a **wait screen** rather than the sign-in form: `index.html` raises
`data-sso="wait"` before paint for a `#sso=` return, and `app.js` clears it from
`showAuth()` and `showApp()` — every route to a real screen — so no path can leave it
stuck. A refusal (`#ssoerr=`) raises no wait screen at all: the door has already
explained itself and there is nothing to sit through. See
[06 — UI Components & Styling](06 - UI Components & Styling.md).

The password door is not a lesser fallback. It is the door for a shared machine
with no Google session, and the **only** door for an address outside the company
domain (`EXTERNAL_EMAILS`), which no domain-restricted deployment will admit. The
ladder is therefore:

| Situation | Google door |
|---|---|
| No Google account reported by the browser | Refuse, and name the password door |
| Address outside `indrones.com` | Refuse, name the domain, name the password door |
| No account row | Refuse — **there is still no self-signup**; a Google account is an identity, not a membership |
| Account disabled | Refuse; an admin must re-enable it |
| Temp-password account | Refuse and point at the password door, so the **forced first-login change still happens** |
| Otherwise | Mint a session with the same last-login stamp and audit line as the password door (`google sso · <device>`) |

Two things it deliberately does **not** do. It never touches the lockout counter —
not `recordFailedLogin` (a Workspace session is not guessable, so there is nothing
to throttle) and not `clearFailedLogin` either (someone fumbling their password must
not wash that counter away by clicking the Google button). And it never signs anyone
in automatically: the sign-in is a **click**, because signing out reloads the page
and an automatic door would put the next person on a shared laptop straight back
into the previous person's session.

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
| **View + comment** | every signed-in account, on all seven sections **and the Overview** | the floor in `getEffectiveAccess` — *nothing* records it |
| **Edit** | **every staff account, by default** | the same function, with the floor raised to `'edit'` |
| **Edit, switched off** | a section, for the people in a department that has unticked it | `access.json` → `departments[].revokes` + `memberships` |

Comment travels with view — there is no separate comment level to grant. The
owner's words: *"Just two — view and edit. view and comment are for everyone.
i.e., comment comes with view. and edit comes with access provided."*

### Edit is the default, and a department's only job is to take it away

**This inverted on 2026-10-14** and the old shape is worth naming, because it is what a
future session would otherwise restore. Until v95 a department *granted* the sections
its people might edit, and a person in no department could edit nothing. The owner
replaced that with the off-switch — his words: *"let us give edit access to all
employees for now with functionality to revoke edit permission if required at any
later point of time … our department grid remains relevant at the same time we have
control button in our hand."*

So the department record carries a **`revokes` map** instead of a `grants` map, and the
**grid tick means "edit is ON"**. The tick is the normal state; unticking it is the
whole control. A tick is also the *complement* of what is stored — see below.

| Case | Rule |
|---|---|
| Two departments, one switching `S` off, one not | The person **loses** edit on `S`. **Deny wins.** |
| A person in no department | Keeps edit on all seven. |
| A department with no `revokes` key (every existing one) | Takes nothing away. |
| A department marked inactive | Applies **neither** axis — revokes nothing, triages nothing. |
| `sec-a` (the Overview) | Never revocable; it is not in `SECTION_KEYS`, so neither end of the revoke map can name it. |
| A customer | Unchanged: every section `'none'`, the Overview `'view'`. |
| An admin | Bypasses the whole thing. |

**Deny-wins is not a preference.** Without it, adding someone to a revoking department
would do nothing while they hold any other department, and the owner's own use case —
*switch one person off* — would not work at all.

**The one honest limitation.** Department-only *can* switch one person off (deny-wins
does it) and it **cannot** switch one person back on. "Department A needs Section F,
department B does not" is not expressible for the same person; the only escape is
removing them from the revoking department, which affects its other members. If that is
ever hit, the fix is a per-person allow-override, deliberately not built.

### The revoke is a SIBLING key, and that is what makes it survive

`revokes` sits beside `grants` and `triage` on the department record rather than inside
any of them, and the whole design rests on that one placement. Two writers would
otherwise erase it:

- **`seedDepartments`** used to *delete* every section key of a named department that
  was not in its own mapping, so a revoke stored in `grants` would be wiped by the next
  re-seed and the department would quietly get edit back. It is now **add-only** — see
  "Departments".
- **`saveDepartment` replaces the whole record**, so an ordinary Save is the write-side
  twin of the same trap.

`grants` is now **frozen legacy data**: carried through the save untouched, read by
nothing. It is kept rather than deleted because it is the only record of what the old
model granted, so it is the rollback reference.

**Absence is not consent.** `saveDepartment` refuses a body that does not mention
`revokes` at all — *"This Access screen is out of date — reload the app…"* — rather than
reading the absence as `{}`. A shell cached from before the flip posts section `grants`
instead, and treating that silence as "revoke nothing" would silently restore edit to
everyone in the department. Present but empty **replaces**; absent **refuses**. Same
shape as `saveSection`'s own "Reload the app".

### The person it affects has to be told, by name

⚠ **This screen has one viewer who can never feel the change and one who can.** An admin
bypasses `canEdit` entirely, so a pane whose edit a department has switched off looks
perfectly normal to him and is dead for everybody else. That is this repo's recurring
failure — a control that works for the one person testing it — and it is not detectable
from the admin's side at all.

The backend therefore reports **`revokedBy`** — `{ 'sec-f': ['Production', …] }` — beside
`permissions` in `getMyAccess`, and it is **explanatory only**: the gate stays
`permissions`, where the section already arrives as `'view'`. Two things are painted from
it, and only when the payload actually named somebody:

- a one-line note **in the pane itself**, under the section title, in a distinct class
  (`.section-edit-off-note`; the server-stale note looks itself up by its own class, so
  two painters cannot delete each other's element);
- the tooltip on the disabled Close and on the add-row.

With nobody named — an admin, a customer, a backend that predates v95, or the synthetic
fallback profile — **the note is not painted at all** and the tooltip falls back to the
plain sentence. Detectability is not attribution: *"this section is read-only"* is a fact,
*"Production switched it off"* is a claim, and only the server may make it.

The admin gets the mirror of the same fact, since he cannot see the pane: the department
card's own sub-line gains a suffix only when something is off — `5 people · edit off:
Section F`.

**Edit is many-to-many in both directions.** One person may hold several
departments; one department holds many people. `memberships` is therefore
`{ email: [departmentKey, …] }` — a **list per person**, so one person's departments
are one key read rather than a scan of an edge list (which is what the sheet version
did on every single access check, and `getEffectiveAccess` runs on every
authenticated request). A wide `dept1|dept2|…` layout was rejected for the same
reason it was before: it forces a schema change every time a department is added.

### Triage is a second axis, not a seventh section

Editing the **Overview** — the customer's owner and contact phone, and the ticket
status — is gated on a **`triage`** flag stored as a **sibling of `grants` and
`revokes`** in the department record, not as a section grant. It is granted to **CR**
(who owned the ticket header before) and to **Management** (who asked for it).

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

### Why the revokes are not in a sentinel store

There is an admin-editable team directory persisted to a `__CONFIG__` sentinel,
which is a tempting home for department assignment. **Do not put access state there.**
`__`-prefixed irNumbers skip *every* ACL check in `saveSection`, so a revoke stored
as a sentinel could be rewritten through `saveSection` by the very people it is
meant to restrain. `revokes` lives in `access.json` inside `_store/`, which is reached
only through `accessStore()` and the admin actions, all behind `requireAdmin` — and
`_store/` itself is Private, so it is not readable through the Drive UI either.

The same argument is why the flip did not move access state *out* of the store: the
one reader every path funnels through is the thing keeping the write surface small.

### The fallback fails closed — and it matters MORE since v95

`myAccess()` returns a provisional object while `getMyAccess` is in flight (first
paint, or a transient backend failure). It grants **view everywhere and edit
nowhere**. The asymmetry is the point: a disabled Save button is recoverable, an
unauthorised write is not. It previously failed open on edit, which turned
"permissions have not arrived yet" into "everyone can write". The backend enforces
independently, so a wrong guess costs a button — never a bad write.

⚠ **The same ordering is load-bearing in the BACKEND, and it is more delicate now.**
`getEffectiveAccess` builds the per-section map as `'view'` **before** its `try`, and
raises it to `'edit'` **inside** it. That was a tidiness when the default was a read;
now the default is a *write*, so the `catch` is the only thing between an unreadable
`access.json` and a company-wide edit grant. A refactor that hoisted the loop out of the
`try` — which would look like a simplification — would fail open. `tools/smoke-backend.mjs`
pins the order, not just the words.

### A customer is a scope, not a third level

The two levels above are about *what you may do*. There is a third kind of account,
and conflating it with a level is the mistake to avoid: a **customer** is an ordinary
account that is **scoped to one company**. They may do almost nothing, but that is a
side effect of the scope rather than the reason for it — what defines them is that
the backend narrows every read to a single company's rows.

The whole setting is a **company name**, stored as a third map in `access.json`
beside `departments` and `memberships`:

```json
"customers": { "ops@agrikart.in": "AgriKart Pvt Ltd" }
```

`customerCompany(email)` is the **one** reader of that map — a second copy of the
lookup is how one caller ends up disagreeing with another — and `getEffectiveAccess`
resolves it **before** the section map is built, because the scope changes what that
map is allowed to say. The answer is every `SECTION_KEY` set to `'none'`, with
`none[OVERVIEW_KEY] = 'view'` and `triage: false`. That is deliberately built out of
the *existing* seams: `getPassbook` already filters rows through `canView()`, so the
withholding needs **no new filter code**, and the Overview's two inputs are disabled
by the same `canEdit()` seam every other field uses rather than by a customer branch.

Three details are load-bearing:

- **A customer must never be granted view because the scope lookup failed.** The
  `customerCompany` read sits *outside* the `try/catch` that guards the department
  read — and it cannot fail open either, because `accessStore()` throws on a malformed
  file and that throw leaves `getEffectiveAccess` rather than resolving to `''`.
- **Admin is tested first.** An admin is never also a customer, so a stale row in the
  customers map cannot quietly narrow the owner's own view of the repository.
- **The Overview is not a section, but it is a gated record**, so it gets a permission
  key like any other. Leaving it out is the exact bug described under *Triage* below:
  `getPassbook`'s filter would drop that row for every non-admin, and the tester —
  being the admin — would see nothing wrong.

**"Customer" is also a `role` value**, and that is a separate axis from the scope:
`role` is `admin` / `customer` / `user`, and `refuseCustomer(access, what)` blocks a
customer at doors that are staff-only. Those endpoints have **no per-record ACL**, so
that check is the only thing standing between an outsider's token and another
company's data. `getAuditLog` and `getLegacyIR` are the sharp examples: the first
trusts the caller's token for the whole repository, the second takes an arbitrary IR
number. This is why **v8 is not a cosmetic bump** — see the `API_VERSION` note in
[04](04 - Backend API Reference.md).

**Clearing a scope is refused, on purpose.** `setCustomerCompany` will not write an
empty company for an address outside the organisation, because "no company" does not
mean "no access" — it means *every* IR. Clearing would silently **promote** the
account to a full staff view. An admin who wants a customer to lose access sets them
**disabled**; that is the reversible switch, and the Customers tab says so in words
rather than leaving the trap in place.

**How an account is created** is the invitation flow, not a password handover: the
scope is written to `access.json` **first**, then the ordinary `createUserRow` (which
always sets `mustChange: 'yes'`), then the email. **No code rides in that email** — a
fresh temp-password account cannot redeem a login code, because `passwordlessLogin`
refuses one by design — so the mail names the ordinary reset door. A send failure is
reported in words and never as a failed create: the account exists, which is the part
that matters, and the admin can hand the same text over by hand.

### The register: where a company name comes from (v96)

The `customers` map above stores a **company name as a string**, and the backend compares
that string against the company column of the intake sheet. Until v96 the list of names an
admin could pick was **derived from the sheet itself** — which meant it offered whatever a
human had typed, misspellings included, and the same organisation appeared several times
under several spellings. Choosing the wrong one gave a customer an empty portal with no
error anywhere.

Since v96 the source of truth is **`_store/companies.json`** — the Company & Contact
register, edited in **User Access → Customers** and documented on the wire in
[04 — Backend API Reference](04 - Backend API Reference.md#the-company--contact-register--savecompany-deletecompany-v96).
Three things about it matter *here*, because each one is a way the scope itself could go
wrong:

- **A scope matches the canonical name OR any of the company's aliases.** The record's
  `sheets` array carries the exact spellings its IRs use, and one function
  (`companySheetNames`) builds the list that **both** scoping paths read — the portal's
  `customerIRS` and the server-side list filter `filterGridToCompany`. They cannot
  disagree about which rows belong to a company. Without the aliases, correcting a
  company's name would empty the portal of the customer it was corrected for.
- **A name the register does not know still works.** `companySheetNames` returns the
  scope **itself** when no record claims it, so every company that predates the register
  behaves exactly as it did — the register can be adopted without a migration and without
  a single portal going quiet.
- **A rename follows through.** Renaming a company appends the old name to `sheets` *and*
  rewrites the matching `customers` entries to the canonical name in the same lock. The
  rewrite makes the register authoritative; the alias stays as the safety net for the IRs,
  which are never rewritten. A rename that did neither would orphan the accounts that
  pointed at the old spelling — the accounts would keep working, and the register would
  stop describing them.

**The panel still offers a spelling it has not been told about**, in a second optgroup
labelled *Not in the register yet*, and lists those leftovers above the invite row with a
button to fold each into a company or make it a new one. That is the tool that actually
fixes the duplicate dropdown: the register is the answer, and the leftovers are the work.
And because a registered company that **no IR spells** is the one remaining way to onboard
somebody into an empty portal, inviting such a company asks first, in words, and names the
field that fixes it — rather than refusing, because a first sale genuinely has no IR yet.

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
happened for them, and the code was decoration on the busiest accounts. The code
lives for 8 hours, an hour inside the session it mints, so a code can never outlive
the sign-in it bought.

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
- **A code still expires.** `LOGIN_OTP_TTL_MIN` is 480 minutes, and an expired entry
  is marked used rather than left usable.
- **The password is re-sent with every attempt.** The frontend holds it in memory
  only (`_otpPassword`, never persisted), so a reload between the two steps restarts
  the flow instead of leaving a half-open conversation — a code on its own, without
  the password, buys nothing.

### Reset code and sign-in code: one machinery, opposite endings

| | Reset code | Sign-in code |
|---|---|---|
| Issued by | `forgotPassword`, for any address, unauthenticated | `doLoginPassword`, **only after a correct password** |
| Lives | `CODE_TTL_MIN` — **15 minutes** | `LOGIN_OTP_TTL_MIN` — **8h**, an hour inside the session |
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
**8h** — an hour inside the session it mints — and the same code will sign in
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

**Five tabs**, all powered by one `?action=listUsers` call:

- **People & departments** — a people × departments tick matrix. One "Save all" posts
  the grid, and unchanged rows are skipped, so a 19-person grid with one edit is one
  write. Per-row actions: reset password, enable/disable. A customer's row carries a
  green `customer · <Company>` badge, holds **no ticks**, and says in a full-width row
  that department access does not apply to them and where to manage them instead.
- **Departments** — the department → section grant grid (seven checkboxes, **A–G**,
  with the labels taken from `sectionLetter()`) plus a **Triage** checkbox rendered after them and labelled `TR`, so it reads as a
  different kind of thing, plus a member count. *"Need one person to edit one
  section? Create a department with just that person in it."* The collector reads
  `.acc-grant[data-key]` generically, so the Triage box is saved with no change to
  the collector — it only needed the extra label. ⚠️ The new **Costing** box starts
  **unticked for every department** and is ticked by hand: the seed (`SEED_GRANTS`) only
  applies to a fresh `seedDepartments` run, which would strip hand-ticked boxes.
- **Create people** — single add, a bulk textarea (one email per line, split on
  `[\s,;]+`, deduped, **skip-and-report** so one typo cannot abort a 19-person
  run), and the one-time credentials panel.
- **Customers** — invite a customer (email, optional contact name, and the company),
  edit an existing account's company, and copy the handover text. See
  *A customer is a scope* above for why the company is the whole setting.
- **Versions** — who is on which build (see [08](08 - Development Guide.md)).

### The Customers tab's company picker: the register first, the IRs underneath

**Since v96 the list is the register** — `_store/companies.json`, edited in this tab and
described in *The register: where a company name comes from* above. It was, until v96,
every company already named on an IR unioned with every company an account was already
scoped to, and that union is exactly what produced the duplicate dropdown: the list was
the sheet's own messy text, so the same organisation appeared several times under several
spellings, and picking the wrong one scoped a customer to a string no row carried.

The IR-derived names are **not gone**, because they are how a company the register has not
been told about is discovered. They now sit in a second `optgroup`, labelled *Not in the
register yet*, under the registered names — visibly second, still selectable, and each one
also listed above the picker with a button to fold it into a company or make it a new one.
That list is the tool that finishes the job: the register is the answer, and the leftovers
are the work.

An **"Other company (type it)…"** option is always present — and is preselected when there
is nothing to pick from, which is the normal state on a first sale — so the picker can
never block a genuinely new company. Choosing it reveals a text field rather than leaving a
stale hidden value to be submitted in place of the choice actually made.

**"Named on an IR" means the `companyName` column — Col R, "Where Do You Work?" — and
that is not interchangeable with the column next to it.** The value an admin picks here
becomes the only thing the backend compares rows against (`customerIRS()` →
`companyColumnIndex()`), so the picker and the scope must read the same column or the
customer is scoped to a string no row carries. This panel read `customerName` (Col L,
"Who's Reporting?" — the *person* who raised the fault, with the phone split off it by
`splitNamePhone`) until 2026-10-08. The two columns hold different things, so the
dropdown offered staff names the scope could never match: **the invitation mailed, the
customer signed in, and the portal was empty, with nothing on screen saying why.** The
fix is one identifier; `tools/smoke-invite.mjs` now pins it against the backend's own
header needles rather than against another screen, because agreeing with the Insights
"Customer" facet was never the standard that mattered.

**A registered company that no IR spells is now the last silent way into an empty portal**,
so inviting one **asks first**, in words, and names the field that fixes it (the company's
*Other spellings*). It asks rather than refuses because a first sale genuinely has no IR
yet, and refusing would make the one customer you cannot onboard the one you just created a
record for.

### A customer's row cannot be emptied by the grid

`savePeopleMatrix()` **skips customer rows outright**, and that is not an optimisation.
A customer holds no department ticks, so their row is an empty set — and an empty set
in that grid means "remove everything". Writing it would be a silent change to an
account the grid cannot manage in the first place. The row exists there only so an
admin can find them; the Customers tab is where they are changed.

### The page paints from the last saved copy, then refreshes

One `listUsers` round
trip against a cold Apps Script container, with seven boot calls already in flight,
is a long blank page — reported from the field as *"User access page also takes
forever to load"*. `ipb_access_cache` (localStorage) now holds the last roster, and
the modal renders it immediately, marking itself `.access-stale` — *"showing the
last saved copy — refreshing…"* — while the real read runs behind it and overwrites
the cache on success. It is deliberately **localStorage and not `CacheService`**:
`listUsers` is written by nine different actions, so one missed invalidation would
show an admin the roster they just changed as unchanged, which is worse than a slow
page. A local copy needs no invalidation at all, because the refresh always
replaces it.

**Temp passwords are never stored.** Only the hash, the salt and the
`tempPwIssuedAt` timestamp reach the store. A temp password is 5 unambiguous
letters (no `I O 0 1 l`) + `-` + 4 digits, e.g. `Kx7Qm-4392`, and it expires after
14 days. It is shown once, with a copy button and an explicit warning.

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

Departments are created in the admin UI, and since v95 their only job on the section
axis is the **off-switch** (see above). The department *names* come from a seed; nothing
else about them does.

**`seedDepartments()` is ADD ONLY, and it is now the last destructive writer to have
been removed.** Until v95 it was an upsert: it created missing departments, rewrote the
`grants` of existing ones to match `SEED_GRANTS`, and **deleted** any key its mapping did
not reproduce — printing a `dropped` list of what it had taken away. That is why
`SEED_GRANTS` had to be treated as the owner's own written mapping rather than an
inference. It now **creates what is MISSING and touches nothing else** — not `grants`,
not `revokes`, not `triage`, not `active` — which matches the philosophy its companion
`seedMemberships()` has documented since it was written: *add, and say so.* Re-running it
can therefore no longer take edit away from anyone, and the report says that in words and
points at the control that can (*"To take edit away, untick a section in User Access →
Departments"*).

`SEED_GRANTS` is **kept in the source and labelled `HISTORICAL — no longer read`.** It is
the only in-repo record of what the pre-v95 model granted, so deleting it would destroy
the rollback reference. The mapping it holds — the owner's, given in writing for the
release that needed it — was:

| Department | Granted, pre-v95 | Also |
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

`TRIAGE_DEPARTMENTS` stays live: the seed still uses it to set `triage` on a department
it creates. Under the new model that table is the *only* part of the old mapping with a
job, and it is right that it is the only part still read.

**Rollback, if the off-switch ever has to go:** tick every box back (a Save posts
`revokes: '{}'`), then restore the previous files. The frozen `grants` are still there and
still describe the old model exactly.

`seedMemberships()` writes the person↔department edges from `SEED_MEMBERSHIPS`.
It **only ever adds** and says so in its report ("Nothing removed"), because it must
not disturb an edge an admin added later — which is why it does not reuse
`setUserDepartments()` (that replaces one person's whole list, correct for an admin
editing that person, wrong for a seed). Emails with no account yet are printed: the
edge is correct and harmless, but those people cannot sign in. **IQC and Compliance
are deliberately omitted**, and the report says so, so the omission is visibly
intentional.

Two people hold two departments on purpose, and both are faithful rather than
clever: the owner gave **one list for Purchase and Inventory**, and since the two
departments were granted *different* sections (B/D/G vs D), the three people get
**both edges** rather than a merged department or a guess about who belongs where.
Both are reversible in the Departments tab in seconds. Under the new model those two
edges do what they always did — but now they *hold edit on*, and the only way they
could take it away is for one of the two departments to switch a section off.

### Deleting a department takes its memberships with it

`deleteDepartment` removes the department key **and** filters that key out of every
membership list, deleting a list that becomes empty. Otherwise a dangling membership
would resurrect the department's settings the moment its key was recreated —
silently, and under the same name. The access matrix and the department record are
in the **same file**, so this is one locked write, not two that can half-fail. The
confirm text flipped with the model: deleting a department now **restores** edit on
anything it had switched off, and says so.

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
- **`clearLocalAuth()` is the ONE place local auth state is torn down**, and that now
  includes the two device caches. The IR list's copy is keyed **by the account it
  belongs to** (`ipb_ir_list:<email>`) and is removed on sign-out; the roster copy
  (`ipb_access_cache`) is removed with it. The key is the security-relevant half: a
  device-global list meant a customer signing in on a shared machine was painted a
  staff member's whole repository for one round trip before their own scoped answer
  replaced it. With no stored profile there is no identity, so there is **no cache at
  all** — the key is `null` and both the read and the write are no-ops, rather than
  falling back to a shared one. A device that is simply left signed in keeps its warm
  copy; the cost is one refresh, on the sign-out path only.

## Related

- [04 — Backend API Reference](04 - Backend API Reference.md) — the actions, the
  `access.json` schema, the `CONFIG` block
- [05 — Configuration & Secrets](05 - Configuration & Secrets.md) — and the
  never-commit-a-credential rule (the repo is **public**)
- [08 — Development Guide](08 - Development Guide.md) — the store layout, the deploy
  order, and why the one-time setup no longer needs a cutover window: there are no
  columns to widen and no live rows to rewrite
