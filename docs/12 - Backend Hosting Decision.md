# 12 — Backend Hosting Decision (Firebase vs. GitHub vs. Apps Script)

> **Status: DECIDED 2026-10-11 — keep Apps Script; do not migrate.**
> Written at the owner's request after he asked whether we could remove the cold
> start, whether GitHub or Firebase were better options, and whether Firebase's
> Cloud Functions would be needed (and paid).
>
> **₹0 is a hard constraint, not a preference.** Every option below is judged first
> on whether it keeps the running cost at zero without a card on file, and only then
> on speed.

## The question, in the owner's words

> *"In my app if it is a professional app I should never ever have and expect
> '1. Cold start'. Are the options of Github or firebase good? in terms of 0 cost and
> data privacy and reliability?"*

> *"Is firebase perfectly ok for us? I am ok with login with link instead of otp, but
> is it best option with us? can we not keep OTP based as well via app script as we
> have developed a beautiful OTP based login already?"*

## What is actually being complained about

Two separate delays, and it matters that they are separate because they have
different fixes:

| # | What the owner sees | What it is | Its real cause |
|---|---|---|---|
| 1 | *"Backend syncing is taking long"* | the first data request of a session | **Apps Script cold start** — the script is evicted after ~5 min idle and the next call rebuilds the whole runtime. Also the Drive store's per-operation cost ([[store-round-trip-cost]]). |
| 2 | *"login via indrones email account, it takes time to wakeup backend"* | the sign-in round trip | the same cold start, **paid twice** — the Google door's handoff page and the exchange are two separate executions ([[backend-cold-start-warmup]]). |

A keep-warm trigger is installed and `warmBackend()` runs on the sign-in screen.
**Neither removes the cold start** — they only make it rarer. Read the Apps Script
*Executions* page before claiming it is gone.

## Options

### A. Apps Script + Drive JSON — *what is running now*

| | |
|---|---|
| Cost | **₹0**, no card, no billing account, no quota to exceed at this scale |
| Privacy | data lives in the owner's own Drive, under his own Workspace account, `_store/` private with link-sharing NONE |
| Reliability | Apps Script is a shared, best-effort service. **No uptime SLA on the free tier.** |
| Cold start | **yes** — ~5 min idle eviction |
| Data access | the owner can open any file and read it; the nightly backup snapshots the whole store |

### B. Firebase (Firestore + Auth)

| | |
|---|---|
| Cost | Spark (free) plan needs **no card**. Firestore's free quota is generous for 453 tickets and a handful of users |
| Privacy | data moves to a **new Google Cloud project**, not the owner's Workspace Drive — still Google, but a **different trust boundary** than "a folder in my Drive" |
| Reliability | Firestore is a managed, always-on datastore — **genuinely no cold start**, and it has an offline-capable web SDK, which the app currently hand-rolls in `localStorage` |
| Cold start | **no** — for the data half |
| ⚠ Caveat | the Spark plan carries **no uptime SLA** either. "No cold start" is not "guaranteed available". |

### C. GitHub Pages — *not an option for the data half*

GitHub Pages is already the frontend host. It serves static files and nothing else:
no writes, no per-user data, no server code. It can replace the **host**, never the
**backend**. There is nothing here to evaluate.

## What a migration would cost, and what it would lose

Moving the store to Firestore is not a lift-and-shift. The things built on `_store/`
being *files in a Drive folder* are the things that would have to be rebuilt or
given up:

- the **nightly backup** and its rehearsal (`_rehearsal/`, `sections/index.json`
  rebuilt not copied) — [[safety-net-is-bundled-and-owed]]
- the **audit trail** and the `mode` param that keeps auto-saves out of it
- the **access matrix** in `_store/access.json`
- the **email index** (`Email_Index`, 646 threads) merged into each ticket's timeline
- the **two-account split** — `_store/` in `monish.raza`, the Form and the mailbox in
  `customer.relations` ([[two-accounts-one-system]])
- the ability to **open the file and read it**

Plus, every backend action (`backend.gs`, ~7,465 lines) talks to the Drive store
through one layer. That layer changing is a rewrite of the store, not a swap of one
constant.

## The recommendation

**Keep Apps Script. Do not migrate.** The two complaints above are cold-start
complaints, and the honest reading of the evidence is that the data half *already
works* — the owner confirmed **"Yes, 453 IRs Loaded"** on 2026-10-11, which is the
sheet's own ticket count. The remaining delay is a first-request tax, paid once per
session, not a per-action one.

If the cold start is still unacceptable **after** that, the surgical move is a
**hybrid**, and it is a later decision, not this one:

- **Firestore for the ticket/section data** — this is where the repeated round trips
  are, and it is the half that gains most (no cold start, real offline support).
- **Apps Script retained for auth** — the emailed-code sign-in stays exactly as it
  is, because it is already built, already good, and moving it is the single largest
  piece of work in a full migration. That answers the owner's own question
  (*"can we not keep OTP based as well via app script"*) with **yes**.

⚠ **A partial migration is a real cost of its own**: two stores means two backups,
two failure modes, and a ticket whose data can be split across them. It should be
entered deliberately, not as a first step.

## Cloud Functions — needed? paid?

**Not needed, and yes they are paid.**

- **Paid, and that is the whole point.** Firebase Cloud Functions requires the
  **Blaze** plan — a card on file — even when the usage sits inside the free
  allowance and the bill is ₹0. On the **Spark** plan you cannot deploy a function
  at all. So adding them converts "free" into "free *unless somebody makes a
  mistake*", which is exactly the property the ₹0 constraint exists to protect.
- **Not needed**, because the app has no work that must happen *outside* a request:
  - the **OTP email** is sent by Apps Script, in the same request that mints the code
  - the **nightly backup** is a time-driven Apps Script trigger — a scheduled job,
    which is the one thing Firestore-alone cannot do. Apps Script stays, so it is
    already covered.
  - **Insights aggregates** are computed in the browser from the list the app
    already holds. No server work.
- The single case that *would* want a function is server-side trust — a computation
  the client must not be able to fake. Nothing in this app is that today.

## What would change this answer

Written down so the decision can be revisited on evidence rather than mood:

1. The owner measures the cold start **after** the keep-warm trigger has been
   running for a week and it is still costing him a visible wait per session.
2. The store's per-operation cost starts to bite at the **save** end — the network
   half of a save is **still unmeasured** ([[perf-is-one-cost-that-grows]]); it has
   never been counted, and it is the number that would decide this.
3. Indrones grows past what the free Drive store comfortably holds, or the app needs
   more than one person editing the same ticket at once.

Until one of those is true, the honest engineering answer is that this is a
**rewrite in search of a problem**, and the ₹0 / data-in-my-own-Drive property is
worth more than the seconds it would save.

## Caveats stated plainly

- **Free-tier numbers move.** Firebase's quotas and Cloud Functions' plan
  requirements have changed more than once. Verify them against Google's current
  pricing page before acting on this document.
- **No SLA anywhere on this stack.** Spark has none, and neither does the Apps
  Script free tier. This app is reliable because it is simple and because the
  nightly backup exists — not because anybody promised uptime.
- **The cold start is real and is not "fixed".** The keep-warm trigger makes it
  rarer. Only the Executions page can say whether it happened.
