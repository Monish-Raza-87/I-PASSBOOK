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

## 7. The window, the whole grid, and the door that asked for the wrong key (2026-10-13)

Eight notes arrived two days after v90 went live. Two were acceptance — *"for dock — ok."* —
and six were defects, four of them in the dock that had just been accepted. They are really
one story: **v90 shipped a bottom sheet where the owner had asked for a window manager.**

A window has three states, and his complaint was that two of them did not exist:

| State | `currentView` | What binds it | On screen |
|---|---|---|---|
| Minimised | `index` | in `dockIRs`, not `dockOpen` | a tab in the strip |
| **Restored** | `index` | `dockOpen` | a centred window + a scrim + the strip |
| **Maximised** | `detail` | `currentIR` | the passbook, **full page** |

### 7.1 A maximised ticket takes the full page, and the strip survives it

*"Clicking on maximise does not mean that it open in side panel on right. it means taking
full page. I want to eliminate fully the idea of having IR open in right small panel."*

`listHidden` in `renderLayout()` was `full && !desktop`. It is now `detail ? true : (full &&
!desktop)` — an open ticket takes the whole row on **every** width. Insights, Log and FAQ keep
their deliberate desktop split, because those are views *of* the list and an IR is a thing you
are working on.

The back arrow became the *same predicate* — `backBtn.style.display = listHidden ? 'block' :
'none'` — because that is the only thing the button actually is: the way back from a fold.
⚠ `base.css` carried `#back-btn { display: none !important; }` in its ≥1024px block, and
`!important` outranks an inline style, so the arrow would have been invisible on exactly the
width where the fold had just started happening. Removed, and the removal is asserted as an
absence.

*"Maximising one IR does not mean that all other minimised tabs gets erased from screen."*
`applyDockState()` is now the one writer of **two** classes: `body.has-dock` (the strip exists)
and `#ir-dock.has-window` (the window is up). At v90 one flag did both, so maximising closed
the world. `has-window` is a **class and not a re-render** on purpose — `renderLayout()` runs on
every layout pass and `renderDock()` refetches the timeline, so wiring them together would put
a network call inside a layout pass. `dockOpen` is deliberately *kept* while maximised, so Back
returns to the drawing with the same window up.

And a click on any tab while a ticket is maximised now puts the maximum down and raises the
clicked one — his described journey (minimise, then navigate) in **one** click.

### 7.2 The window is centred, and the drawing behind it is blurred

*"Either show me the IR above screen, center placed, but smaller size than screen, behind it
all irs blurr, with other tab buttons of minimise and maximise, like windows does."*

`.dock-sheet` stopped being a bottom sheet and became a centred window: `position: fixed;
left/top: 50%; transform: translate(-50%,-50%); width: min(56rem, 100vw - 2rem); max-height:
min(70vh, 40rem)` — smaller than the screen on every side, so the blurred drawing is visible
around it, which is the request.

Two things about the scrim are load-bearing:

- **It is a CHILD of `#ir-dock`**, not a `<body>` sibling, and the reason is a test budget:
  `smoke-industrial.mjs` counts non-scoped selectors in `industrial.css` against a ceiling of
  22, and `#ir-dock` is already in its `CHROME` list. As a child, `#ir-dock .dock-scrim` matches
  and the count does not move; as a sibling it would have spent the last of the headroom.
- **`#ir-dock` itself moved from `--z-bottombar` (40) to `--z-overlay` (80).** A stacking context
  cannot put a child above itself, so the scrim, the window and the strip had to rise as a
  family to cover the header (40) and the sidebar (30). `--z-overlay` was declared for this and
  had no reader until now. Inside the dock: scrim 0, window 1, strip 2 — and the strip needs
  `position: relative; z-index: 2` or a non-positioned child paints *under* its own scrim and
  every tab becomes unclickable while the window is up.

**One blur on one scrim layer.** industrial.css §9 forbids glass on the IR list because
`backdrop-filter` is a compositor layer per element and 300+ blurred tiles would recomposite
every scroll frame. A single scrim is the shape that section sanctions, and the blur lives in
its existing `@supports` block beside `.inward-options-modal`.

**Measured, 1440×900** (Chrome, CDP, `--hide-scrollbars` so geometry is the instrument):
window 896×282 at (272, 309) in 1440×900 — strictly inside on all four sides; scrim 1440×900
with computed `backdrop-filter: blur(2px)`; `#index-view` still `display: flex` behind it; a
click on the scrim minimises and the three tabs survive. Force 90 rows into `.dock-sheet-body`
and the sheet stops at **630px** — exactly `min(70vh, 40rem)` — while the body scrolls 4248
against 582 and `scrollTop` takes, with `documentElement.scrollHeight` still 900. The v87/v89
definite-height chain holds.

### 7.3 The grid draws every IR, and says when it has

*"grid scroll down is limited and not keeps continuing till end of IRs, it says a button +394
more - see list. this is not correct. If I do not want to go into list and continue in grid
mode, then why should I be not allowed to?"*

`GRID_CAP = 60` and `BOARD_CAP = 25`-per-column are **gone**, both, on his instruction when he
was asked whether to remove the "+N more — see list" chip from the grid alone or from both:
*"Remove it from both."* 60 + 394 is his 454 IRs — the cap was exactly what he was looking at.

**The cap's justification was cost, so the cost was measured rather than argued about.** The
published 13.4ms figure had been measured *through* the cap, so the uncapped cost was unknown:

| Drawing | Cost |
|---|---|
| 454 tiles — building the strings | 14ms |
| 454 tiles — assign + forced layout, warm | 44ms |
| 454 tiles — assign + forced layout, coldest first paint | ~146ms |
| 454 tiles — same, re-measured on the live v91 page | 78ms |
| The **uncapped IR list**, per keystroke | 27–45ms (0.06–0.1ms a row) |

That comparison is what decides it, and it is recorded here because *"the cap was there for
performance"* stops being checkable the moment the cap is gone. The uncapped grid costs what
the uncapped **list has always cost, on every keystroke** — so the cap was not proportionate to
anything the list does not already do. No chunker, no `IntersectionObserver`, no scroll
listener: this project has evaluated and declined that cost once already (§6, Option 3).

**The end-of-list note.** *"below grid where there might be empty area, you may mention
something like no irs anyfurther."* Blank space under the last row is the one thing an uncapped
drawing cannot distinguish from a drawing that gave up, so the blank now has a sentence in it:
`grid.foot` → *"No more IRs — {n} shown"* / *"और कोई IR नहीं — {n} दिखाए गए"*. It spans the row
(`grid-column: 1 / -1`) and carries no `overflow` — a grid row sized `min-content` with a
clipped child is the v89 trap. Drawn only when something *was* drawn: an empty result already
says so in `.empty-state`, and "No more IRs — 0 shown" underneath it would be two screens
arguing.

The two delegated click handlers the caps needed went with the chips — a handler for a class
nothing emits is a branch no test can reach and no user can hit.

**Verified, 1440×900:** 454 records out of `renderIRGrid` → **454 tiles**, the foot the last
child and below the last tile row, `#ir-grid` scrolling 14426 against 783 **with
`documentElement.scrollHeight` still 900** — an uncapped grid is exactly the shape that breaks
a definite-height chain, and it does not.

### 7.4 The Service Desk arrives on the Grid

*"Still in my app from login, not sure why but list view was open for default and I had to
select grid to go into that."* — the **second** time he had reported this.

`handleRoute` has said "the Service Desk opens on the Grid" since v90 and it **could never
fire**. `showApp()` calls `showIndex()` — which sets `currentView = 'index'` — *before* its own
`handleRoute()`, and `handleRoute`'s first line returns early when the view is already
`'index'`. So the route rule was swallowed on every boot and every sign-in, and what actually
landed was `setListView(listMode)`: the value read from `VIEW_KEY`, which on the owner's device
still said `'list'` from before the Grid existed. `DEFAULT_VIEW = 'grid'` only ever applied to a
device that had never chosen, which is the one device that did not need it.

One token: `setListView('grid')`. The guard in `handleRoute` is **kept** — it is what stops a
mid-session flip to List being stamped back to Grid. The consequence, stated rather than
discovered: a stored choice no longer outlives a reload. That is what he asked for, twice.

**Verified in a real browser** with `listMode` seeded to `'list'` *before* the app's own script
ran (a sentinel in the same seed proves the seed landed): after boot, `listMode` reads `'grid'`,
`#index-view` carries `is-grid`, the List row computes `display: none`, and the switch agrees —
`grid: aria-selected=true, .active`. Flipping to List in place still works and still sticks for
the length of the session.

### 7.5 The fingerprint door asks for the right key

*"The fingerprint login option is not working. It has to ask for my device's login key but is
either asking for some USB method or QR code scan method, not sure what is it and this seems
to be broken."*

That is not a broken fingerprint. `submitUnlock()` attached `allowCredentials` **only when
`rec.credentialId` was truthy** — and a `credentials.get()` *without* it is not "any key will
do": it is a **discoverable-credential** request, which a browser may only answer by offering
its own picker across every transport it knows (USB security keys, a phone over QR). Enrolment
mints this device's passkey with `residentKey: 'discouraged'`, so the key that picker hunts for
cannot exist. The app was asking the wrong question and reporting the answer as a fault in his
finger. The rule was already written down at the top of `app.js`; the live path simply did not
follow it — and **no suite asserted the shape**, which is why it shipped.

- `allowCredentials` is now **mandatory on this path**, always carrying `transports:
  rec.transports?.length ? … : ['internal']`.
- With **no** `credentialId` the call is **not made at all**; he gets a sentence naming the
  state and the way out instead of a picker he cannot satisfy.
- Enrolment records `transports` from `cred.response?.getTransports?.()` (floored at
  `['internal']`) and accepts **RS256 beside ES256**, so a chipset that will not mint ES256 is
  no longer read as a broken fingerprint. `authenticatorSelection` is **unchanged** —
  `platform` + `userVerification: 'required'` + `residentKey: 'discouraged'` is the reason
  `allowCredentials` is mandatory, and weakening it to `'preferred'` would trade a rule for an
  accident.

**The plain explanation** (his chosen answer, when asked what a device with no built-in
sensor should do): `#auth-method-note` gained a second variant. `showMethodInactiveNote
('inactive')` keeps the four steps — the method is not on this device yet. `'nohardware'`
swaps the say, hides the `<ol>` (there are no steps to follow on a machine that cannot do it)
and explains that turning quick unlock off and on again re-registers the device. The variant is
a `data-variant` attribute and each string is its own `data-i18n` element, so no code writes
text and a language switch repaints the right sentence without the function ever running again.

⚠ **I cannot test a platform authenticator.** Suites pin the *shape* — `smoke-unlock.mjs` now
drives a record with no id (no prompt is opened) and a record with one (the exact id, byte for
byte, with its transport). Only the owner, on his own device, can test the real thing, and the
instruction worth repeating to him is: **"if it still asks for a USB key, turn quick unlock off
in your avatar menu and set it up again."**

### Verification

37 suites green. Then driven in a real browser at 1440×900, 390×844 and through a seeded
pre-boot `localStorage` — geometry probes via CDP `--eval`, since Chrome runs
`--hide-scrollbars` and a screenshot can never show a scrollbar. Every number quoted above is
from those runs. On the phone: window 366×333 at (12, 255) in 390×844 — centred and smaller than
the screen on every side, **not** full-screen; the strip one row, scrolled by its own
`overflow-x`, clear of the app's own bottom bar; `scrollWidth === innerWidth` with a window up;
`#detail-view` padding-bottom resolves to the strip's own height.

**Shipped as v91.** Frontend only — `backend.gs` untouched, `API_VERSION` did not move and
**no Apps Script paste is owed.**

---

## 8. The bar that came back, and the window that was showing the wrong thing (2026-10-13)

v91 shipped in the morning and the owner lived with it for a few hours. Two notes came back,
and they are two unrelated faults — one a rule I had written on my own reasoning, one a
window whose contents he had already told me were wrong.

His words:

> *"On loggin in I landed into Grid but view and it is scrolling down till IR001 but in grid
> view the left bar of service desk is not visible. Even grid view should have left tab of
> service desk with option to expand or collapse it. When clicking on any IR, it opens a small
> tab making the behind screen blurr. only when we click on 'open the whole passbook' button,
> the whole IR opens, understood but the data it is showing in small tab is not correct, it
> should show 'Allot CAPS' options and 'Report' details to give IR's overview. Activity log is
> not required."*

### The Service Desk bar belongs to every view

`html.view-full` — the single class meaning *"this drawing takes the workspace"* — had carried
`#sidebar { display: none }` since v89. The reasoning was mine and it sounded fine: a board or a
grid that takes the whole row should not be sharing it with a navigation bar.

It is wrong, and the way it is wrong is worth writing down. `renderLayout()` never touches
`#sidebar`, so the deletion was the whole fix — one rule, in one file. But the *reason* is the
part that generalises: **the Service Desk bar is how a person moves between Insights, the Log,
the FAQ and a ticket.** A view that removes it is a view with no way out of itself. Scrolling
the Grid down to IR001 put him in exactly that position.

So the bar stays, and the **room** is taken by choice instead — its own `#sidebar-toggle` folds
it to the 56px rail, which is the same fold the IR list has and the same one a maximised ticket
already lives with. `#sidebar-toggle` therefore stays on screen in these two views as well: a
fold control is precisely what a view this wide now needs. `#list-toggle` still goes — the pane
holds the drawing, and folding *that* to the list's rail would replace a grid with a count.

Measured at 1440×900 in a real browser: sidebar `232×900` at `x=0`, `display: flex`;
`#index-view` `1208×856` at `x=232` — exactly the viewport less the bar. Folding: sidebar 232 →
**44**, grid 1208 → **1396**. Unfolding returns both.

⚠ Below 1024px `#sidebar-toggle` is `display: none` (it is the bottom bar there, and
`width: 100%` would fight a rail width), so a probe that calls `.click()` on it at 390px will
still set `rail-collapsed` and read as *"the fold does nothing on a phone"*. That is the probe
clicking a hidden button, not a defect. It caught me once.

### The window now shows the ticket, not the ticket's history

v91's sheet carried the ticket's **activity list** over two one-field quick-sets. He had asked
for a window; what he got was a third view of the same timeline. His replacement, in one
sentence: the **Allot CAPS** options and the client's **Report** — *"to give IR's overview"* —
and **no** activity log.

The tempting build is a window-shaped form: fewer fields, tighter, "just for the window". That
is a second form, kept in step with the first by nothing, and it is the failure this codebase
already pins against. So the window renders **the app's own two builders**:

| Block | Builder | Shown when |
|---|---|---|
| **Allot CAPS** | `triageFieldsHTML(ir, 'dock-')` | `canTriage()` |
| **Report** | `intakeBodyHTML(ir)` | always — read-only by construction |

Getting one builder to serve two places is the whole of the work, and the mechanism is an **id
prefix**. `triageFieldsHTML(ir, p)`, `applyTriage(irNumber, p)`, the assignee combo
(`renderAssigneeOptions`, `closeAssigneeOptions`, `onAssigneeKeydown`, `pickTriageAssignee`,
`commitAssigneeInput`), `wireTriageCategoryRows` and the three `assigneeOptionHtml` row
handlers all take `p`, defaulting to `''`. The dialog's prefix is the empty string, so **every
id it has ever had is byte-identical** — which is what keeps every existing suite that names
`triage-assignee` reading true, and is why the prefix was chosen over renaming anything.

Two things fell out of doing it honestly:

- **`applyTriage` now takes the ticket, not `currentIR`.** A window can be up on a ticket the
  passbook is not holding, and writing the passbook's ticket would be a silent wrong-field bug.
- **Saving from the window does not close it.** The dialog calls `closeTriageModal()` because
  the dialog *is* the task; the window calls `renderDock()` instead, because closing on every
  field would lose his worklist position. One `applyTriage`, two tails.

Deleted with it, and each with a tombstone comment saying why: `loadDockTimeline()`,
`dockSetStatus()`, `dockSetPriority()`, the `[data-dock-set]` handler in `wireDock()`, and the
`dock.activity` / `dock.showing` i18n keys in both tables. ⚠ The removal also removed a waste
that was invisible: the window used to fetch the ticket's **400-entry audit log** on every
open, for a list nobody had asked for. `loadActivityLog()` is now called only when the
passbook is actually showing that ticket, so **a window opens without a single round trip**.

### The Save button that was a yellow band

Caught by looking, not by measuring. `.btn` is `width: 100%` — a form button fills its column —
so the window's Save rendered as a full-width yellow **band** inside `.dock-allot-foot`.
`justify-content: flex-end` cannot shrink it back: a flex item starts at its auto width, and
here that width *is* 100%. `.btn-sm` does not escape it either — it sizes height, padding,
font-size and radius and nothing else. The dialog's own footer already carried the escape
(`.inward-options-foot .btn { width: auto }`); the window needed the same line.

**Every geometry probe said "a button in the footer."** Only the screenshot said band. This is
the second time this project has paid for judging a layout without rendering it, and the reason
`smoke-board.mjs` now pins the escape is that no probe can be written that would have.

### Verification

All 37 suites green (4,400+ cases). Browser probes at 1440×900 and 390×844 via CDP `--eval`
(Chrome runs `--hide-scrollbars`, so geometry is the instrument for anything about scrolling):

- **Item A:** sidebar visible and `display: flex` in Grid; fold 232 → 44 and grid 1208 → 1396;
  `#list-toggle` and the placeholder correctly hidden; `html.view-full` set.
- **Item B:** window `896×630` at (272, 135) in 1440×900 — inside the viewport on all four
  sides and smaller than the screen on every side. All six Allot CAPS fields present plus the
  Save; `.dock-report` carries 13 `.intake-row`; `#dock-timeline` and `.dock-quick` gone; the
  scrim covers the viewport with `backdrop-filter: blur(2px)`; `#ir-dock` at `z-index: 80`;
  `#index-view` still `display: flex` behind it; `.dock-sheet-body` scrolls (1158 vs 582) and
  `scrollTop` takes. Phone 390×844: the **same** centred window, `366×633` at (12, 106),
  `scrollWidth === innerWidth`.
- **The three states still hand off:** three tabs docked → maximise → `#index-view` hidden,
  `#detail-view` fills the row, hash `#/tickets/IR409`, `#ir-activity` present (the existing
  passbook, not a new one), and **three tabs still in the strip**; clicking a *different* tab
  puts the maximum up as a window in **one** click with all three tabs intact.

**Shipped as v92.** Frontend only — `backend.gs` untouched, `API_VERSION` did not move and
**no Apps Script paste is owed.**

---

## 9. Future Roadmap (Planned)

### Log Analysis Visualization
- **3D Flight Simulation**: Integration of `Three.js` to visualize the flight path during identified "Alert" periods.
- **Intelligence Loop**: Building a database of known failure patterns to move from "Manual Alerting" to "AI-Driven Diagnostics."

---
*End of Log*
