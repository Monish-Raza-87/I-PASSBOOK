# I-PASSBOOK Project Milestone Log
*Last Updated: 2026-10-11*

This document serves as the authoritative record of architectural changes, bug fixes, and feature blueprints implemented during the recent development cycle.

## 1. Authentication & Access Control (Completed)

### Google SSO Stability (Mobile)
- **Problem**: Mobile browsers were stripping the `#sso=` fragment or delaying the redirect, causing sign-in failures and a redundant 9-second intro video.
- **Solution**: 
    - Moved handoff detection from parse-time to the active boot sequence.
    - Implemented `sessionStorage` recovery to survive accidental page reloads.
    - Forced the splash screen to hide immediately upon handoff detection, bypassing the intro video.
- **Outcome**: Seamless, instant transition from Google Account Picker to the app.

### Passwordless Transition (Phase 1)
- **Goal**: Eliminate "login friction" for daily users.
- **Implementation**: 
    - Removed the password field from the primary sign-in flow.
    - Implemented **OTP-First Login**: Users now enter their email $\rightarrow$ receive 6-digit code $\rightarrow$ enter app.
    - **Persistent Identity**: Added logic to pre-fill the email address from `localStorage`, transforming daily login into a "Verify and Enter" experience.
- **Status**: Pushed to `category-insights` branch.

---

## 2. Drone Log Analysis Hub (Blueprint & Research)

### The "Indrones Gold Standard" Diagnostic Engine
A specialized forensic tool for ArduPilot `.bin` files, integrated as a Global Hub in the Service Desk.

#### Analysis Criteria (The Rules):
- **Vibrations**: Flag any axis ($X, Y, Z$) exceeding **30**.
- **PWM Saturation**: Detect when motor outputs (`RCOUT`) hit physical limits for $\geq 500\text{ms}$.
- **Telemetry Anomalies**: Identify sudden, non-physical jumps or dips in altitude and attitude.
- **Power Rail**: Monitor for voltage brown-outs and current spikes.

#### Technical Architecture:
- **Local Parsing**: Uses a JavaScript-based binary parser (inspired by `ardulog` and `jsdataflashparser`) to process files entirely in the browser for privacy and speed.
- **IR Bridge**: Analysis results are not just viewed; they can be "Pushed" to a specific IR number via a dropdown, automatically appending the diagnostic summary to the ticket.
- **Service Desk Integration**: Moved from individual IRs to a centralized Hub to optimize performance.

## 3. Auth Shipped 2026-09-30 (Passwordless + Quick Unlock)

### The Passwordless Daily Door (now with a working backend)
- **The 2026-09-27 passwordless commits were frontend-only**: the backend still demanded a password on both steps, the code step could never submit, and first-login temp-password accounts had lost their only door. Sign-in was broken as deployed; this cycle rebuilt both ends.
- **Stage 1**: email only → the reusable 8h30m emailed code (issued or reused, uniform response that is no account-existence oracle).
- **Stage 2**: email + 6-digit code → the same gates → the same audit line → the session. No password anywhere.
- The password door survives as an opt-in mode ("Use password instead") for legacy shells and the temp-password first login.

### Quick unlock (fingerprint + pattern)
- Per-device token in `devices.json`; fingerprint via WebAuthn platform authenticator (`userVerification: required`) as the LOCAL gesture; 3×3 pattern fallback hashed client-side (SHA-256, two-draw setup).
- Unlock verifies the token pre-auth with uniform refusals + the login limiter; account gates then run; audits the method, not a code age.
- Every password path (change, reset, revoke-all) revokes the devices too.

### One active session per account ("option A")
- Chosen 2026-09-21, now implemented: `mintSession` retires every other live token of the account inside its lock. Accepted cost: signing in on the phone signs the desktop out.

### Google door on the phone (PWA)
- The account picker now opens in a NEW browser tab (`window.open`), not a top-level navigation from the standalone window — the old navigation reached Google with no usable cookie context and showed Google's own "unable to open the file at present" error.
- Diagnostic, if it still fails: try Google sign-in on the laptop. If the laptop fails too, re-publish the door deployment (New version, keep the URL ending `7uKj`).

---

## 4. In-App Update Notice + Version Reporting (2026-10-01)

### The problem the owner actually reported
He refreshed the app on his phone and it stayed on the old build. gh-pages was serving
that build the whole time — the deploy was fine, the **update mechanism** was not.
Five separate causes, all real, and the fifth is the one that would have shipped a
feature that lies:

1. Navigations went **through** GitHub Pages' ~10-minute HTTP cache.
2. A brand new `CACHE_NAME` was filled by `cache.addAll(SHELL)` — bare fetches, so
   the HTTP cache could put the *previous* build's bodies inside the new cache.
3. `skipWaiting()` + `clients.claim()` hand over to a new worker, but **nothing
   reloads the open page**, so it kept running the old `app.js`.
4. Registration was bare and nothing ever called `reg.update()`.
5. **A version probe poisons itself.** A same-origin `fetch('./sw.js')` is
   intercepted by the worker's own stale-while-revalidate branch, and the Cache API
   ignores a request's `cache:` mode — so the probe is correct exactly once, and then
   answered from a cache the worker just wrote. Fixing the *check* required excluding
   the worker's own URL.

### What shipped
- **`sw.js`**: the self-script exclusion (3a); new caches filled via
  `new Request(u, { cache: 'reload' })`; navigations revalidated with `'no-cache'`
  so the offline fallback still has an HTTP entry to fall back on. `skipWaiting` and
  `claim` are kept deliberately — a plain refresh is the habit that must keep working.
- **The banner**: an amber, in-flow notice on **both** the sign-in card and the app
  shell (a device parked at sign-in is the one that most needs telling). The probe
  reads `CACHE_NAME` out of the served `sw.js`, compares it **strictly newer** against
  `APP_VERSION`, and is throttled to one per 5 minutes with every failure silent.
- **The tap is the only thing that reloads.** It settles a pending install first
  (a reload during install would be served by the worker being replaced and land back
  on the old build), then `reg.update()`, then reload. It refuses outright while a
  save is in flight, and prompts when the User Access modal or a draft is open. A
  `controllerchange` listener is kept only as a belt — with `skipWaiting()` it fires
  at *install* time, so it could never be the trigger.
- **👥 User Access → Versions**: who is on which build, grouped off the roster the
  modal already loads. The owner asked for no broadcast and no chasing — the banner
  is the announcement, and this tab is how he checks without asking anyone.
- **`backend.gs`**: `stampSignin()` writes `appVersion` inside the `lastLoginAt` write
  that was already happening — **zero extra Drive operations**. Validated on write
  (it is stored-XSS surface: it arrives in a body and is rendered as HTML), and never
  blanked by a sign-in that cannot report one.

### Honest limits
- The fix **cannot bootstrap itself**: a device on the previous build gets to the new
  one through the *old* machinery, so that first hop per device may need a manual
  refresh. Everything after it is automatic.
- On an **installed iOS home-screen app** the tap may not take until the app is fully
  closed and reopened. If the version does not move, the banner correctly reappears.

---

## 5. The IR Grid, and the two scroll bugs the browser found (2026-10-11)

### What he asked for
*"In our app, for viewing our list of IRs, I also want a grid view option. As of now we
have list and board. but grid in my view will have better UI for users."* — with a
pasted Odoo-style mockup described as *"something like this"*, a picture of the *shape*
rather than a specification of this app.

Four decisions came from him rather than from me: a **third mode** (List and Board
untouched), **sort + priority dropdowns added** (the app had no priority filter at all),
**square tiles** matching the app rather than the mockup's 12–16px corners, and a tile
click that opens **the app's own ticket pane**, not the mockup's slide-out drawer.

### What the mockup asked for that this app cannot give, and it was stated, not faked
- `Critical / High / Medium / Low` — the real four are **Urgent**/High/Medium/Low.
- `New / In Progress / Waiting Parts / Resolved` — fabricated; the app owns **ten
  stages**, badge-coloured by four categories.
- **Warranty Status** — **no warranty field exists on an IR**; the only warranty value
  lives inside a Section D *form* field a tile cannot reach.
- **Product Name** — **no model field exists on an IR either** (Col S is read by
  nothing). The serial is the only product identifier a record carries.
- Assignee **avatar photos** — no avatars in this app; the tile reuses `initialsOf()`,
  the monogram helper the row stopped using on 2026-09-21.
- Hover **elevation shadows** — this look floats nothing; a tile is a fill plus a hairline.

### The build
The grid is a **third branch of `applyListFilters()`**, which is what makes it obey the
one search box, both filter strips and the new sort for free — no second filter system.
`html.board-full` was generalised to **`html.view-full`** (one class for "this drawing
takes the whole row", set by both Board and Grid) because at ≥1024px the pane is a fixed
400px rail and a grid inside it would have been **one tile wide**. `GRID_CAP = 60`,
mirroring `BOARD_CAP`, measured **13.4 ms flat** against `renderIRList`'s 211 ms at 1200.

### ⚠ The bug that only a browser could show
The first render was wrong and looked plausible: **every tile 24px tall holding 124px of
content**, and `scrollHeight === clientHeight`, so there was **no scrollbar** — a crushed
grid that reads as a short one. Cause: `grid-auto-rows: auto` starts each row at its
items' automatic minimum size, which is **zero for an item with `overflow: hidden`** (a
tile, kept for width safety). So each row grew only by its share of the container's free
space — 399/16 per row at 1440×900 with 80 records. `min-content` fixed it: rows 159px,
`scrollHeight` 2584 vs `clientHeight` 572, and it scrolls.

**This is the same family as v87→v88, one level down**: a definite height only helps if
the children refuse to absorb it — `.ir-list > * { flex: 0 0 auto }` then,
`grid-auto-rows: min-content` now. And the same lesson twice over: **a declaration is not
an application**, and geometry probes — not screenshots, because Chrome runs with
`--hide-scrollbars` — are the only instrument.

**Shipped as v89** (frontend only — no `API_VERSION` move, no Apps Script paste). Note
that v88's own crushed-list fix (`views.css` `.ir-list > * { flex: 0 0 auto }`) rides in
the same deploy, because the version could not be pushed without his go.

---

## 6. The ticket dock, and the chrome that was eating the screen (2026-10-11)

### What he asked for
Four things, asked in one message the day v89 landed. *"When i'm on a grid view page, IR
should not occupy the space in page, it should be grid only… on my click on any ir box, ir
will slide in and view above other IRs, but not in a full screen view. if i want to continue
fully into that ir, there would be an expand button."* Then, sharper, after checking Gmail
himself: *"bottom sheet, where it can be minimised… such that I can minimise and keep
multiple IRs on my worklist on screen minimised."* Plus: *"the amount of space occupied by
header (almost blank), search bar, filters (all sorts of) are occupying in the page is too
much and should be thought out intelligently and designed modularly"*, a Service Desk that
opens on the **Grid**, and a **big faded logo** in the blank space where no ticket is open.

All four are one ask — *give the work the screen* — so they ship together as **v90**.

### Part A — the dock
`#ir-dock` is **a static child of `<body>`**, the same home as the other floating chrome
(never inside `#index-view`, which is `overflow: hidden` by assertion and re-shaped by
`list-collapsed`). Two bindings hold the whole state — `dockIRs` (strip order) and `dockOpen`
(the one sheet up) — and `renderDock()` rebuilds the strip and the sheet together from them,
so there is no incremental DOM to keep in step and no way for the two to disagree.

- **The tab** is name-left, then **three buttons right-aligned in his order**: mid-size
  panel, full view, close. The name *is* also the button that brings the sheet back, which
  makes the whole tab body a target and not only its three small corners.
- **The row, not a stack.** He checked Gmail and wants the minimised tabs **adjacent along
  the bottom, facing the user**, so that is what is built. More tabs than fit is real but
  rare; the strip is a horizontal scroll of exactly the tabs that cannot fit.
- **Exactly one sheet; the rest stay minimised.** **Newest lands last**, left to right.
  Re-opening a docked ticket restores it rather than adding a second copy.
- **Expand is `goTicket()` — the existing passbook and no new one.** A lighter ticket screen
  that drifts from the passbook is the real risk, and the guard against it is reuse, not
  discipline: the sheet's activity list is `buildTimeline()` + `renderTimelineInto()`, the
  exact pair the passbook's `#ir-timeline` calls; the quick actions write through the single
  store writer `patchIRState()`, whose own tail already repaints the drawing underneath; and
  they render **only** when `canEditSection()` passes, or a view-only user is shown controls
  that cannot work.
- **The rightmost button is not labelled "Save".** He called it *save and close*, and there
  is nothing to save — the sheet holds no editable fields and every quick action writes
  through the moment it is used. It closes, and it cannot lose a change. A control called
  Save that does not save is a lie the app would have to keep.

**The dock is deliberately not a route.** `#/tickets/IR470` keeps meaning *full screen*: it
is what a nudge and an emailed link land on. So the dock never writes the hash and the hash
never opens a sheet — and one consequence is stated rather than discovered: **browser Back
does not close the sheet.** Close is ✕, and `Escape` **minimises** (non-destructive, focus
back to the tab) under the same guard shape the customer door uses — it fires only while a
sheet is open, so it never swallows a key anywhere else in the app.

### Part B — the chrome, measured rather than guessed
**328px of chrome sat above the first row** (37% of a 900px window; 394px of a 844px phone —
47% of the screen spent before the work starts).

| | Before | After |
|---|---|---|
| App header | 56px | **44px** (`--header-h`; `--rail-w` follows automatically) |
| Title · view switch · **search** · count | two rows, ~49px | **one row** |
| Status strip + category strip + both selects | 134px, always open | **one Filters row, ~28px closed** |
| Sync bar | 25px | folded under the Filters row |
| **Grid/Board, 1440×900** | **328px** | **130px** |
| **List, 1440×900** (400px pane, row one wraps) | **328px** | **165px** |
| **Phone 390×844** | **394px** | **160px** |

The closed row **names what is filtering** — `Filters ▾  "crash" · Crash · Urgent` — and each
chip clears its own filter. That is not decoration: this app has a written rule that filters
**deliberately do not persist** (`VIEW_KEY`), because *a hidden filter surviving a reload is
how someone concludes the app has lost tickets*. Collapsing the panel hides the controls, so
the closed row has to say what is in force, and a filter can never be hidden and applying at
the same time. The open/closed state persists through the same `storedFlag`/`setFlag`
convention as the rail — a **UI fold, not a filter**, which is the opposite rule on purpose.

The panel is hidden **by a class on the toolbar, not with `hidden`**, because the strips in
it are measured *in place* by the geometry checks in the suites — 20-odd rules over
`.segment` / `.segment-count` — and taking them out of layout would have broken all of them.

### ⚠ Option 3, evaluated and rejected — written down, because "we thought about it" is not a record
*Keep it, hide it on scroll* was the obvious third option and it was not built:

1. **The pane does not scroll — the list does.** Hiding the toolbar means a scroll listener
   on `#ir-list`, throttled through rAF. This project already measured its scroll path and
   deliberately stopped a repaint on every search tick; this would add one back.
2. **It hides the search box exactly while searching.** You scroll *to scan results*, and the
   control vanishes at the moment it is most wanted.
3. **It saves nothing at rest.** At the top of the list — where he lands after every filter
   change — the full chrome is still there. The 328px is only reclaimed once he is already
   reading.
4. **It is non-deterministic**, so *"how much space is this taking?"* stops having an answer —
   which is the question he actually asked.

The compact toolbar reclaims the space **always**, with no new listener. And it is reversible:
if he wants hide-on-scroll *after* living with this, it layers on top without undoing any of it.

### Part C — the Service Desk opens on the Grid
Done in `handleRoute()`, **not on the link** — `#nav-tickets` is a plain `<a href="#/tickets">`
with no JS binding by design, and suites lean on that. Two guards keep it honest: arriving
while already on a drawing does not stamp on the view he just chose, and coming **back from a
ticket** does not force the Grid, so Back returns to the drawing he left. `setListView()`'s
own byte-pinned line is untouched, so no assertion moved.

### Part D — the faded mark
`#detail-placeholder` — the *"No IR selected"* blank, which he chose over the empty list. It
is `assets/icon-mark.png`, **not** `logo.png` (that one is in the deploy tool's prune list and
is deleted from gh-pages), sized large and faded, with its own dark-theme treatment because
the mark has one and would otherwise vanish in dark mode.

⚠ **Stated consequence of Part C:** Grid takes the whole workspace on desktop, and that rule
*hides* `#detail-placeholder`. So with Grid now the default, the mark is met in **List** —
the one drawing with blank space to fill. If he wants a watermark in the Grid's own empty area
too, that is a separate small change he can ask for.

### ⚠ The bug the screenshots found, and only the screenshots could
The dock shipped, and the toast landed **on top of it** — visible in the PNG, sitting on
IR407's tab. The probe explained it: `#toast` has **no `opacity: 0` rest state**; base.css hides
it purely by sliding it down `translateY(140%)` — **140% of its own height**. Raising `bottom`
by the dock's height therefore lifted the *hidden* pill back into view: fully opaque at
y851–889 on a 900px window. The fix adds the dock height to the hidden offset as well — and
**re-states `body.has-dock #toast.show`**, because `body.has-dock #toast` (1 id, 1 class, 1
element) outranks base.css's `#toast.show` (1 id, 1 class) whatever the source order, so
without that line *every toast in the app* would be invisible whenever the dock was on screen.
Three assertions now pin all three halves. **A hide implemented as a transform is a hide with
an implicit size in it**, and moving the element moves that size too.

### The mark, in one place
A row or tile is **lit** when the screen is about that ticket — the passbook is on it
(`currentIR`), or its sheet is up (`dockOpen`). Those two cannot both be true, because the
dock stands down the moment the passbook opens, so `litTicket()` answers one question rather
than OR-ing two half-answers. It is read at render time by the list row and the grid tile, so
a rebuild for a filter change keeps the mark, and `renderDock()` re-applies it as well, because
opening or minimising a sheet changes no layout at all. The board still marks nothing: it is a
wall of work, not a column of rows.

### Verification
37 suites green. Then driven in a real browser: three tickets docked → three tabs, one sheet,
correct order; ✕ on the open one → the next takes its place; ✕ out of order → the space
closes; the middle button → `#/tickets/IR409` **and the existing passbook up**, proving no
second ticket screen was built. The mark: open A lights A, open B lights B alone, minimise
lights nothing, expand keeps A lit behind the passbook. The definite-height chain survived the
shrink — 65 injected rows still give `scrollHeight` 4989 vs `clientHeight` 748, and `scrollTop`
takes. On 390×844: one column, tabs clear of the app's own bottom bar, both selects 16px,
`scrollWidth === innerWidth`, and a shown toast clears the strip while a hidden one is off the
window.

**Shipped as v90.** Frontend only — nothing here is routed, so `API_VERSION` did not move and
**no Apps Script paste is owed.**

---

## 7. Future Roadmap (Planned)

### Log Analysis Visualization
- **3D Flight Simulation**: Integration of `Three.js` to visualize the flight path during identified "Alert" periods.
- **Intelligence Loop**: Building a database of known failure patterns to move from "Manual Alerting" to "AI-Driven Diagnostics."

---
*End of Log*
