# I-PASSBOOK Project Milestone Log
*Last Updated: 2026-10-22*

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
- **Stage 1**: email only → the reusable 8-hour emailed code (issued or reused, uniform response that is no account-existence oracle).
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

### v93 — the instruction named a control that did not exist

He tried the fingerprint door the next time he signed in and got Chrome's own message:
*"No passkeys available. There aren't any passkeys for monish-raza-87.github.io on this
device."* And then the request underneath it, in his words:

> *"I am not asking to look into my github or anyone else needing a key of my github account
> but I am asking that my device's, i.e., currently laptop that I am using, whichever login
> password is, I can enter that same to login in my app."*

Two things had to be separated. `monish-raza-87.github.io` is not his GitHub account — it is
**the address the app is served from** (GitHub Pages), and a browser will only ever offer a
key that was created *for the address it was created on*. That is the browser protecting him,
and the app never contacts GitHub at any point. The thing he wants — his own device's login —
**is** what a platform authenticator gives: the dialog that appears is Windows Hello, which is
his fingerprint, his face, or his PIN. (A site is, by design, never allowed to ask for the raw
Windows account password. That restriction is the feature.)

The actual defect was elsewhere, and it was mine. Every failure sentence the app owns ends
with the same instruction — *go to your profile menu and set the method up again* — and **the
profile menu could not do it.** It was one `<button>` carrying three labels:

| `loadUnlock()` | label | action |
|---|---|---|
| nothing | "Turn on Quick unlock" | enrol |
| record, no `patternHash` | **"Add unlock pattern"** | pattern setup |
| record with `patternHash` | "Remove quick unlock" | confirm → remove |

A record holding a **fingerprint and no pattern** — the state right after enrolling, and his
state — fell into row two and got **only** "Add unlock pattern". There was no way to
re-register the fingerprint and no way to remove the record. So when the browser stopped
holding that key, every route the app offered led back to the same refusal, and the refusal
sent him to the one place that could not help. **The recovery message named a control that did
not exist**, and nothing in 37 suites was checking that the two agreed.

The fix is two rows: the primary row offers what is still **missing** (and hides when both
methods are registered), and **removal is its own row, shown whenever there is a record to
remove**. All four recovery sentences now name the row by the words that are actually on it —
*"Open your profile menu (top right), choose "Remove quick unlock", then set it up again"* —
and `smoke-unlock.mjs` pins the row, its handler, the two-way visibility rule, and (against
comment-stripped source) that no sentence still says "off and on again".

⚠ **The version bump here is load-bearing beyond the code.** A device that has not refreshed
is still running the old build, and *the old build is exactly what produces the message he
reported*: a pre-v91 `submitUnlock` called `credentials.get()` with no `allowCredentials`,
which is a discoverable-credential request, which the browser can only answer with its own
picker — hence "no passkeys available on this device". So the fix and the refresh are two
halves of one repair, and the answer to him says so.

**Shipped as v93.** Frontend only — `backend.gs` untouched, `API_VERSION` did not move and
**no Apps Script paste is owed.**

---

## 9. The letters move A–G, Costing becomes a section, and Insights counts models (2026-10-13)

### What he asked for

Two asks in one message, the first conditioned on safety — *"a small rename, if it is safe
and not breaking anything"*:

> *"INWARD to be named section A i.e. currently it is written B. INWARD … similarly, B.
> VISUAL INSPECTION, C. INVESTIGATION, D. COSTING, E. PRODUCTION, F. QUALITY TESTS,
> G. PDI/DISPATCH. So … apart from changing names of section, it also splits current
> investigation section's two parts, A and B, into two different sections. Our current
> "Part B — cost analysis (repair estimate & lead time)" goes as a new section,
> D. COSTING. In INSIGHTS, still UAS MODELS filter is not there. It has DRONE SN but not
> MODELS. Also, name of filters should be "UAS SN" and "UAS MODEL"."*

He was right that it is not a rename. It is a **split**, and the split is right on the
merits rather than only on his word: `docs/03` had already recorded that Section D's two
halves are **signed off by two different roles** — Part A by the Technical Support
(QC Manager), Part B by the **Purchase Manager**. Two sign-offs by two people is a section
boundary. It was only ever one section because the Sheet said so.

### ⚠ The trap that shaped the whole change

The section letters are **also the permission keys** — `sec-b`…`sec-g` in
`_store/access.json`, `SECTION_KEYS` in `backend.gs`. So the obvious reading of the ask
(*renumber the sections*) would have **silently re-granted rights**: `sec-c`, freed by
moving IQC's letter to B, becomes free for a new section to inherit every department's
existing edit grant on QC inspection. Nothing would have failed. It would simply have
worked, with the wrong people holding the wrong doors.

So the **ids did not move; only the displayed letter did** — the same trick
`OVERVIEW_KEY = 'sec-a'` already plays, and the same reason the merged `g_*`/`i_*` field
ids were deliberately left alone. One table (`SECTION_LABELS`) and one function
(`sectionLetter(id)`) now own the letter, and it is **never derived from the id**. The one
place that had derived it — `BOARD_COLUMNS`' keys — was inverted, because
`paintBoardMoveOffer` resolves a column back to a section *by letter*: type the letters by
hand, leave Investigation's key at `'D'` while `sec-cost` also maps to `'D'`, and the
move-on offer silently attaches to the wrong ticket record.

### Three decisions he made when asked

- **Costing counts in the progress bar** — the bar becomes 7 sections, A–G.
- **The warranty question moves out of Costing and into Investigation**, below
  *Preventive action*. Costing is therefore not always applicable: a warranty repair, or
  anything not charged for, legitimately has no cost figures.
- **Costing must be finished before a ticket moves on to Production.**

Three consequences follow directly. Because Costing can be *legitimately blank*, its
**Close button is never disabled for being empty** — closing a blank Costing asks one
confirmation instead. Because the warranty question stays in Investigation, it needs **no
data migration at all** — it was always stored in `sec-d` and it stays there. And "costing
first" is a **gate on the Board's own offer**, not a new workflow stage, which is the cheap
answer and the one that does not invent a status.

### The data half, where the quiet bug was

Backend `saveSection` **replaces** a section object, and a declared field absent from the
payload counts as *deleted* — `restoreField` depends on that. So the moment `sec-d`
stopped declaring the three cost fields, the next ordinary Investigation save would have
**destroyed every stored estimate on every ticket**, silently, with no error and nothing to
notice until someone opened a costing page and found it gone.

Two lines prevent it, and both read **only stored data**: the Costing pane resolves a
field's home through `FIELD_SECTION_INDEX` (never from the stored section, which is what
would draw a blank pane while the values sat one section over), and an Investigation save
**carries the three legacy keys forward** unchanged while the stored record still holds
them. Gated on stored data it is self-limiting — the moment the values stop living in
`sec-d`, the carry-forward goes inert on its own. Gating on anything the load path
*invented* would have cancelled the two halves and let the data-loss bug back in.

The precedent was already in the same function: `d_logAnalysis` is carried through, not
collected, with the comment *"dropping it here would mean a perfectly ordinary Section D
save quietly deleted the report."* This is that same rule, applied to three more fields.

### The one manual step it costs him

`sec-cost` is the first genuinely **new** section id since the restructure — `sec-a` is the
Overview, `sec-h`/`sec-i` are retired and explicitly rejected by `saveSection`. A new id
needs **three lines in `backend.gs`** (`SECTION_KEYS`, `SEED_GRANTS`, `API_VERSION` 10 → 11),
so it owes **one paste into both `/exec` deployments**.

⚠ The trap that paste sets, and the reason the frontend ships with an explicit guard:
`saveSection` skips the permission check entirely for an **admin**, and `getPassbook`'s read
filter also exempts admins. So on an un-pasted backend **the owner sees Costing work
perfectly while everyone else gets an empty pane and `Forbidden` on save** — the exact
failure shape this repo has been bitten by before (*"blank Overview for 18 people, looks
fine to the one person looking"*). The Costing pane therefore renders **read-only with a
plain notice** until the backend answers that it knows the key, and the notice is worded
honestly: for the admin an un-pasted backend does not fail, so a notice promising failure
would be a lie he could disprove in one click. Blocking him is still right — it is the
forcing function that gets the paste done.

### Verification

`node tools/smoke-all.mjs` green across all 37 suites, with the affected suites updated
deliberately rather than loosened — **a red build here is a coupling I did not predict,
not a suite to relax.** The couplings it did find were real and are now pinned:

- `smoke-preview.mjs` had baked in the very derivation this change deletes
  (`id.replace(/^sec-/,'').toUpperCase()` → `"COST"`). It now reads `SECTION_LABELS` and
  `BOARD_SECTION_COLUMNS` out of `app.js` text, so it **enforces** the deliberate exclusion
  of the Costing board column instead of re-deriving the id.
- `tools/build-ui-options.mjs`, a generator that never evaluates `app.js`, now carries
  section **ids** alongside letters, so `'sec-' + letter` can never be reconstructed again.
- `smoke-workflow.mjs`'s admin fixture was given a realistic permission map: `permissions:
  {}` no longer describes any admin the server can produce, because the v94
  `backendKnowsSection` guard correctly reads a missing key as *"the backend predates this
  section"* and disables every Close.

One defect was found by **driving the app in a real browser**, and no source-text suite
could have found it: the tab strip is wider than a phone screen, and the active tab was
never scrolled into view. That mattered because one of `showSection`'s two callers selects
a section **nobody pressed** — `applySectionAccessGating` moves a person off a tab their
category has just switched off — so on a phone the tab lit up outside the window while the
strip went on showing its neighbours: the right section, with nothing on screen saying
which one it was. It is one line in `showSection` (`inline: 'start'`, matching the strip's
own `scroll-snap-align`, **not** `'nearest'`, which leaves a wide tab showing its first few
letters), inert on a wide screen where the strip has nothing to scroll, and now pinned in
`smoke-workflow.mjs` — the harness's own elements have no `scrollIntoView` at all, which is
why nothing had ever noticed.

The same probe also caught **two of my own assertions measuring nothing**: the section
inputs do not exist until `buildSectionForms()` has run, so "the Costing pane is blank"
passed for a reason that had nothing to do with the code under test; and
`pane.scrollWidth` disagreed with every element it was supposed to describe. *A reproducible
probe can still measure the wrong thing.*

**Shipped as v94.** Frontend first, as always. The backend paste is **owed** — three lines
pasted into **both** `/exec` deployments as a **New version**, with the primary still
ending `jQXatfT/exec`, and then the Section D (Costing) edit boxes ticked by hand in
**User Access → Departments**, because the seed only applies to a fresh run and a re-seed
would strip hand-ticked boxes. The consequences of each — the legacy cost values that stay
under `sec-d`, and the gate that is Triage-overridable — are recorded in
[07 — Known Issues & TODO](docs/07 - Known Issues & TODO.md).

---

## 10. Edit for everyone, a switch that takes it away, and a film you can replay (2026-10-14)

### What he asked for

Three asks, and only the first two are this release:

> *"By default all users will have view and edit access of all the sections … restricting
> edit permission is not a good thing for us as of now … Nonetheless, we have the
> functionality to change accesses and in future if we find its need, we will do so."*

> *"let us give edit access to all employees for now with functionality to revoke edit
> permission if required at any later point of time … our department grid remains relevant
> at the same time we have control button in our hand."*

> *"a replay button for the intro video on the sign-in page"* — a refresh does not replay
> the film, and he wants it to play first when he is introducing the app to someone.
> Placed, at his word, *"over the left panel, sitting somewhere not easily visible,
> clickable on purpose only."*

The third ask — a **Company & Contact register** to replace the duplicated IR-derived
company dropdown — is **v96**, held until he sends the company list only he can give.
The split is deliberate: one paste should cover v94 and v95 together rather than two.

### ⚠ The trap that shaped the whole design

**Nothing in this codebase could represent a denial.** Every reader of a department's
rights was truthiness-only — `departmentCapabilities`, `getEffectiveAccess` — so
"switch a section off for these people" had no encoding at all. Worse, two writers would
have erased any attempt to bolt one on:

- `seedDepartments` was an **upsert that deleted** every section key of a named
  department its own mapping did not reproduce. A revoke stored inside `grants` would be
  wiped by the next re-seed and the department would quietly get edit back.
- `saveDepartment` **replaces the whole record**, so an ordinary Save is the write-side
  twin of the same trap.

Both are defeated by one placement: **the revoke is a sibling key on the department
record, not a value inside `grants`.** Neither the seed's loop nor a Save that does not
mention it can reach it. `revokes[s] === true` means *for the people in this department,
edit on section `s` is off*; absent key, absent map and `{}` all mean "takes nothing
away", which is also why the change needed **no migration** — `revokes` starts absent
everywhere, which reads as edit on all seven.

### The rule that makes the owner's own use case work

**Deny wins.** Two departments, one switching Section F off and one not, and the person
loses edit on Section F. Without that, adding someone to a revoking department would do
nothing while they held any other, and *"switch one person off"* — the thing he actually
asked for — would not work at all. The one honest limitation is the other direction:
department-only **can** switch one person off and **cannot** switch one person back on.
If that is ever hit, the fix is a per-person allow-override, deliberately not built.

### The half that is invisible to whoever is testing it

An **admin bypasses `canEdit` entirely.** A pane whose edit a department has switched off
looks perfectly normal to him and is dead for everybody else — this repo's recurring
failure, and undetectable from the admin's side. So `getMyAccess` gained **`revokedBy`**
(`{ "sec-f": ["Production"] }`), **explanatory only** — the gate is still `permissions`,
where the section has already arrived as `'view'`. The affected person gets a one-line
note in the pane naming the department, and the Close tooltip names it too; the admin
gets the mirror of the same fact as an `edit off: Section F` suffix on the department
card, since he can never feel it on the pane. Both are **suppressed when nobody is
named** — detectability is not attribution, and only the server may say *who* switched
it off.

### The load-bearing ordering

`getEffectiveAccess` builds each section as `'view'` **before** its `try` and raises it
to `'edit'` **inside** it. That was tidiness when the default was a read; the default is
now a *write*, so the `catch` is the only thing between an unreadable `access.json` and a
company-wide edit grant. A refactor that hoisted the loop out of the `try` — which would
look like a simplification — would fail open. `smoke-backend.mjs` pins the order, not
just the words. The frontend's own fallback stays view-only for the same reason.

`saveDepartment` also gained a rule of its own: **absence is not consent.** A shell
cached from before the flip posts section `grants` and never mentions `revokes`; reading
that silence as `{}` would silently restore edit to everyone in the department. Present
but empty **replaces**; absent is **refused** outright.

### The seed's last destructive write is gone

`seedDepartments` is now **add-only** — it creates what is missing and touches nothing
else, not `revokes`, not `triage`, not `active` — matching the philosophy its companion
`seedMemberships()` has documented since it was written. Re-running it can no longer take
edit away from anyone or hand it back, and the report says so in words and points at the
real control. `SEED_GRANTS` is **kept in the source, labelled `HISTORICAL — no longer
read`**: it is the only in-repo record of what the pre-v95 model granted, so it is the
rollback reference, and deleting it would destroy that. `TRIAGE_DEPARTMENTS` stays live —
the seed still uses it on create.

### The replay control, and the bug only a measurement could find

`paintBrandPanel()` plays the film once per **version**; a refresh deliberately does not
replay it. The replay is a small button inside the panel, at `opacity: .22`, full on
`:hover`/`:focus-visible`, still a real focusable control — a deliberate click beats
reduced-motion, because an explicit replay is consent in a way an autoplay is not. The
play sequence was extracted into `playBrandFilm()` so the replay and the first paint run
**the same code**, and the wire-up sits **before** the early returns so it works on a
device that has already seen the film.

⚠ **It shipped invisible, and reading the CSS said it was fine.** `.brand-replay` took
its ink from `--ink-gray-7` — the ink of the **form's** surface — and on the left half
that surface is nowhere: each ground repaints the panel, and on the `dark` ground the
token resolved to `#383838` at 22% over `#0b0b0b`, which is nothing at all. Of the six
grounds exactly one happened to read. The fix is a `--panel-ink` custom property
**declared per ground**, with `--ink-gray-7` as the below-1024px fallback where the panel
has no ground of its own; the two fused grounds take dark ink in the light theme and
**invert back** under `[data-theme="dark"]`, where their ramps are not painted at all.
Every one of the six grounds × two themes, plus the four phone combinations, was then
**sampled off a render** — a ring pixel differing from its local ground by roughly
0.22 × (ink − ground) — rather than judged by reading the sheet.

### Verification

`node tools/smoke-all.mjs` green across all 37 suites, with the access suites **rewritten
deliberately** rather than loosened: the default is now all-edit, a revoke takes one away,
and deny-wins is its own named case. `smoke-store` grew the keystone — revoke `sec-d`
through the real store, prove `restoreField` is refused, **re-run the seed and prove the
revoke survives** — which is the whole design in one test. The `render-fixture` departments
fixture was still speaking the pre-v95 shape (`grants: {}`); a fixture inventing an API the
server no longer has renders perfectly while describing a server that is gone, so it now
posts a full `revokes` boolean map.

**Shipped as v95.** Frontend first, as always. The backend paste is **owed** — and it is
more urgent than usual, because a department Save on a **pre-v95** backend silently wipes
`grants` and turns off `triage`. The paste goes into **both** `/exec` deployments as a
**New version**, with the primary still ending `jQXatfT/exec`, and is confirmed by `ping`.

---

## 12. The Company & Contact register — the duplicate dropdown, fixed at the source (2026-10-17)

Three owner asks came out of the 2026-10-14 session. v95 shipped the first two. This is
the third: *"a Company & Contact register in User Access → Customers, replacing the
duplicated IR-derived company dropdown."*

### The problem it removes

A customer's whole access is a **company name string** in `access.json`, compared against
the company column of the intake sheet. Until now the list an admin could pick from was
**derived from that same column** — so it offered whatever a human had typed. The live
sheet holds the company text 459 times across 62 distinct values, and the same
organisation appears under several spellings, several times over. Picking the wrong
spelling gave a customer an **empty portal with no error anywhere**, which is the failure
this repo has been bitten by before ([two columns that look like one](docs/10%20-%20Auth%20%26%20Access%20Model.md)).

### The shape

New store file **`_store/companies.json`**, added to the `initializeStore` seed list. Each
record is a slug key and a company:

```json
{ "companies": { "<slug>": {
    "name": "Acme Survey Pvt Ltd",              // canonical; MANDATORY
    "email": "", "phone": "", "address": "", "pincode": "", "city": "", "state": "",
    "sheets": ["Acme Survey", "ACME SURVEY"],   // the exact intake-column spellings
    "contacts": [ { "id": "c1", "name": "", "email": "", "phone": "", "active": true } ],
    "notes": "", "updatedAt": "", "updatedBy": "" } } }
```

Two admin actions, `saveCompany` and `deleteCompany`. There is deliberately **no
`listCompanies`**: the register rides along on `listUsers`, which the modal already loads,
so there is no second answer to *"which companies exist"*.

### `sheets` is the design, not a convenience

The register is the source of truth, but the sheet's text is messy and will not match a
corrected name. So scoping matches the canonical name **or any alias** — and **one**
function, `companySheetNames()`, builds the names that **both** scoping paths read: the
portal's `customerIRS` and the server-side list filter `filterGridToCompany`. They cannot
disagree about which rows are a company's.

**Without the aliases, correcting a company's name would empty the portal of the customer
it was corrected for — silently.** Two consequences follow, and both are what make the
register safe to adopt with no migration:

- A scope the register has never heard of resolves to **itself** (`[scopeName]`), so every
  company that predates the register behaves byte-for-byte as it did.
- A **rename** appends the old name to `sheets` **and** rewrites the matching
  `access.json.customers` entries to the canonical name, in the **same lock**. The rewrite
  makes the register authoritative; the alias stays as the net for the IRs, which are never
  rewritten.

Aliases split on **newlines only** — real company names contain commas, so a comma
separator would silently split one company into two.

### Seeding without publishing the customer list

The register has to start from the names already on the tickets, and **this repo is
public**. So the seed is an algorithm, not data:

| Function | Does |
|---|---|
| `seedCompanies()` | Reads the live intake sheet, groups the company column through `sameCompanyKey()`, and makes the **most-used spelling** canonical with the rest as `sheets`. **Create-only.** Holds **no hard-coded company name** — the repo carries the algorithm, the sheet carries the list. Similar-but-different spellings are left as two companies on purpose, to be merged by hand in the app. |
| `seedCompanyContacts()` | Attaches contact people from the client directory's `Drones` tab to companies **already in the register**. **Add-only** — a contact joins only when its email (or name, with no email) is not already there — and it reports unknown spellings rather than inventing a company for them. |

Both are **editor-run**, not routed actions, so neither adds API surface. `COMPANY_PLACEHOLDERS`
(`na`, `n/a`, `nil`, `none`, `no`, `-`, `--`, `test`, `testing`, `x`) is refused as a name on
save and skipped by the seed — a list of placeholder tokens, never an organisation, so it can
live in the open.

### The panel

`renderCustomersTab` is reworked around the register: a searchable list of company cards
(each with its aliases shown, its account count, and its contacts — a contact whose email
already has an account reads **Re-invite**, one with only a phone offers **WhatsApp**), and
a second section listing **the spellings no registered company speaks for**, each with a
button to fold it into a company or make it a new one. That second section is the tool that
actually finishes the job the dropdown started.

The invite dropdown keeps every option that worked before: registered names first, and the
leftovers in an optgroup labelled *Not in the register yet*. And because a registered
company that **no IR spells** is the one remaining route into an empty portal, inviting one
asks first in words and names the field that fixes it — it does not refuse, because a first
sale genuinely has no IR yet.

The form is a **draft** in the panel's module state, not the record itself: adding or
removing a contact row is a repaint of a form that is being typed into, so the fields are
read back out of the DOM first. And the draft leaves by its **own** serialiser — a record
carries `sheets` as an array and a draft carries it as a textarea string, so posting a draft
through the record's serializer would send an empty alias list and silently un-register
every spelling the company had.

### Verification

`node tools/smoke-all.mjs` green. `smoke-invite.mjs` gained the register as driven
assertions rather than source text: the card's three contact states, the two dropdown
groups, the repaint that must not eat the typing, the refusal that must not cost it, and the
two serialisers asserted against each other. It also now **runs both normalisers** — the
browser's and the backend's — over the same awkward inputs and requires identical answers,
because two normalisers that drift give a customer a portal scoped by a rule the panel never
showed the admin. `smoke-backend.mjs` pins the alias chain end to end, the create-refuses-a-
duplicate-slug rule, the rename sweep, and that the seed holds no company name.

⚠ `saveCompany` **bumps `API_VERSION` to 12**, and the register is not a cosmetic bump: a
pre-v96 backend has no `companies` in `listUsers`, so the panel falls back to the old
IR-derived list and every register edit lands nowhere. The paste goes into **both** `/exec`
deployments as a **New version**.

---

## 13. No file ids in the source — the addresses move into the Drive store (2026-10-17)

### What prompted it

The owner: *"I want to ask you that is it possible that we prevent even one word of data
leak and even try to keep link not in open repository but somewhere in master folder in my
drive."* `backend.gs` is in a **public** repository — it has to be, because GitHub Pages on
the Free plan requires a public repo — and it carried the app's live Sheet ids, its Drive
root folder id, and a third party's real mailbox.

### What the survey found, before anything was changed

| Value | Already public? |
|---|---|
| `IR_REPO_SHEET_ID`, `DRIVE_ROOT_FOLDER_ID`, `LEGACY_SHEET_ID`, the external address | **Yes** — on `origin/main` since the repo began, 8 files each |
| `CLIENT_DIRECTORY_SHEET_ID` | **No** — only in `09adb26`, which was **local and unpushed** |
| any of them on `gh-pages` | **No** — that branch's tree carries no `backend.gs` at all |

The unpushed one mattered most: it is the newest and most sensitive (a client directory of
names, contact people and mailboxes), and it could still be kept out entirely for free.

### The shape of the change

`backend.gs:58` already said it, about the client directory id: *"READ ONCE, BY
`seedCompanyContacts()`. Nothing at runtime reads it."* So that one costs **zero** to move.
The others sit on real request paths, and the honest problem is not the code but the deploy:
**the `_store/` root folder id cannot live in `_store/ids.json`**, because reading that file
needs the folder first. It became the **`STORE_ROOT_FOLDER_ID` Script Property** — the one
value with a bootstrap constraint.

Two accessors, deliberately: `storeIds()` answers `{}` for a missing key and never throws,
because `seedCompanyContacts` has a documented "not configured" answer it must keep;
`requireStoreId()` throws an error naming the key and the fix, because the alternative is
`openById(undefined)` → `"Invalid argument: id"`, which is true, useless, and takes out both
the IR list and the ticket view.

`ids.json` is **not** `config.json`. That file is the client-facing `__CONFIG__` sentinel
every signed-in account can read; nothing routes to `ids.json`, so the app cannot read it at
all. Its content is cached for six hours, so the hot read path pays **no extra Drive call**
in the steady state.

### Three things found by looking rather than by reasoning

1. **`isMailRecipientAllowed` is the only runtime reader of the address list, and it fails
   SILENTLY.** Miss it and the expression is simply `[]`, the third party is denied, and the
   mail never arrives — with no error anywhere. It must not throw (a mail path that throws
   reveals whether an account exists), so `seedStoreIds()` prints the list it wrote.
2. **`ping` cannot confirm this deploy.** It is routed pre-auth and touches no store, so it
   answers `13` while the property is unset and the whole store is unreachable. Every
   previous release's verification instruction says to confirm with `ping`; this one must
   not. Confirm with `listIRs`.
3. **The first version of the test guards re-published the ids.** They pinned the literal
   values in order to forbid them — into the same public repository the change was cleaning.
   A guard must not carry the value it guards. The assertions are shape-based now.

### Honest limits, written down rather than implied

This does **not** unpublish the four older values. Forks keep them, GitHub keeps unreachable
objects for a retention window, and mirrors keep them permanently. It is **cleanup and
defence in depth**: it stops the *next* slipping share setting from being reachable. The
control that actually stops access is the sheet sharing.

### Verification

`node tools/smoke-all.mjs` green across all 37 suites, with the four VM suites
(`smoke-store`, `smoke-customer`, `smoke-backup-pulse`, `render-doorpage`) updated to seed
the Script Property and `ids.json` — they run the **real** backend, so a missing property
fails them at the first store access rather than testing anything. `smoke-backend.mjs` gained
seven assertions for the move and `smoke-list-intel.mjs` the same rule against the backend
(it had been enforced on `app.js` only, which is how the leak survived). A repo-wide scan for
all five values now returns nothing outside the guards — and the guards no longer name them.

⚠ `API_VERSION` moves to **13**, and this is the first release with a **deploy
prerequisite**: the Script Property, then `seedStoreIds()`, then a New version on each of the
two deployments.

---

## 14. v113 — the customer has no password, and a code can be asked for again (2026-10-22)

### What he asked for

A customer never uses a password: sign-in is email + a 6-digit code, and only that. The
"First time here?" / set-password door goes. The code lives **8 hours**, not 8h30m. Pressing
Resend mails the **same** code; three resends are allowed per code, and the fourth points at
**Indrones Customer Relations** with its official email and WhatsApp number — never a
person's name. The invitation opens with **Welcome** and says I-PASSBOOK, the portal link,
the login email, and "Password: a sign-in code we email you — nothing to remember."

### The silent bug underneath it

`createUserRow` marks every new account `mustChange: 'yes'`, and `passwordlessLogin`
refused a login code for such an account. That rule is correct for **staff** — an admin
issues a one-use temporary password — but `inviteCustomer` creates a customer the same way,
so a freshly invited customer pressed Continue and **no code was sent**, with nothing on
screen saying why. The exemption is keyed on the **company scope in `access.json`**, not a
new users.json flag: the scope is already what makes an account a customer, and a flag
would have to be written by every future account-creating path.

### What shipped

- **Backend.** Customer scopes bypass the temp-password gate. `sendLoginCodeMail` is the
  one body for a first send and a resend. `resendLoginCode` mails the live digits again,
  holds a per-code cap of **3**, and reads the CR email/WhatsApp from `portal.json` for the
  refusal. `LOGIN_OTP_TTL_MIN` is **480** (8 hours); the session remains 8h30m, so a code
  can never outlive the sign-in it bought.
- **Portal.** The sign-in sheet is one door, two steps. The set-password field and
  "First time here?" link are gone. "Send the code again" appears only at step 2, waits out
  the backend's 60-second gap, shows the same-code confirmation, and replaces itself with
  the Customer Relations sentence after the third ask. No CR name is printed.
- **Invitation & handover.** "Welcome" greeting, the owner's wording, and the code door in
  the admin's copyable handover text — no first-time password steps anywhere.
- **FAQ.** The code lifetime is quoted as 8 hours, matching the constant.

### Verification

`node tools/smoke-customer.mjs` and `node tools/smoke-all.mjs` green. The customer suite
now proves the invited account is not treated as a temp-password account, the code is
mailed directly, a wrong code is answered as a wrong code, resend carries the identical
digits, three resends are allowed, and the fourth is capped with the CR contact.

⚠ `API_VERSION` does not change for v113, but **`backend.gs` does**: paste it into both
`/exec` deployments as a **New version**, then hard-reload the app.

---

## 15. v114 — customers leave the employee grid (2026-10-22)

### What he asked for

The User access desk must keep **customers and employees separate**. A customer is not a
colleague with an empty department set, and the People & departments matrix must not show
them at all.

### What shipped

- The first tab is now **Employees & departments**, and `renderPeopleTab()` filters out
  every account with a `customerOf` scope before painting. Customers are managed only in
  the **Customers** tab.
- The customer-specific badge and full-width “manage it in Customers” row are gone from
  the employee matrix, because the row itself is gone. `savePeopleMatrix()` still skips
  customers defensively.
- The customer invite copy no longer says the customer “sets their own password”; it says
  the code is emailed on demand.
- Docs and the invite suite now assert the separation instead of asserting the old badge.

### Verification

`node tools/smoke-invite.mjs` and `node tools/smoke-all.mjs` green.

---

## 16. v115 — the portal looks like Indrones, and the resend button counts down (2026-10-23)

### What he asked for

The customer sign-in sheet must show a **disabled resend button under the OTP field, with a
60-second countdown that reaches zero and then enables it**. And the customer portal must
stop looking like a different product: it has to match `indrones.com/#programs` — clean,
professional, and interactive.

### What shipped

- **Resend.** The old text link is gone. The button sits directly under the OTP field,
  starts disabled, and its own label counts down (`Resend in 60s`). At zero it becomes
  `Resend code`. A successful resend restarts the 60-second wait and reports
  `Sent again · n of 3`. The fourth ask is replaced by the Customer Relations sentence.
- **The portal's look.** The palette is now paper/ink/yellow from indrones.com, with sharp
  corners, mono micro-labels, editorial uppercase headings, hairline rules, numbered
  activity tiles, hover lift and a yellow active state. The sign-in sheet is square with a
  yellow top rule; buttons are square mono labels; product cards and ticket rows follow the
  same language. Dark mode keeps the same structure on the app's dark ground.
- **No new framework, font or image.** The portal still loads only `portal.css` and
  `portal.js`, so the two pages that mount it cannot drift and a customer pays nothing new.

### Verification

`node tools/render-portal.mjs` — 106 passed, 0 failed, including the real 60-second
countdown and the same-code resend. `node tools/smoke-all.mjs` green. The intro acceptance
test was also made reliable by waiting for the previous headless Chrome to exit before the
next load reuses its profile; that hand-off was the one flaky step.

---

## 17. v116 — the app's own code screen gets the resend button too (2026-10-23)

### What he reported

The countdown was missing where he was signing in. The screen he was on was **not** the
portal's sheet: the customer door on `index.html` hands off to the app's shared
`#code-view` ("Check your email"), and the v115 resend control existed only in
`portal.js`. A customer signing in through the app's own door therefore saw no resend.

### What shipped

- `#code-view` now carries a square resend bar directly under the six boxes:
  **disabled**, label counting `Resend in 60s` → `Resend code`.
- It mails the **same six digits** through the existing `login … resend: true` action,
  restarts the 60-second gap, and stops at the third resend with the Customer Relations
  sentence returned by the backend.
- `loginBackend()` gained the `resend` flag; a customer's request goes through
  `customerAuth`, an employee's through `loginBackend`, so both doors use one backend rule.
- The code screen's own close/back path clears the timer; a returning arrival resets it.

### Verification

`node tools/smoke-shell.mjs` pins the markup, order, countdown and same-code request.
`node tools/smoke-boot.mjs` drives the real browser and asserts the button is present,
disabled and counting at the code step. `node tools/smoke-all.mjs` green.

---

## 18. v117 — I-INSPECTOR chunk 2, NA, save age, and the writing helper (2026-10-23)

### What he asked for

Build all four: the NA control and section-completion gate; the rule engine and live
checklist; the save-age indicator and failed-save alert; and the English/Hinglish writing
helper with maturity retrieval.

### What shipped

- **NA control.** Every section now has **Not applicable** beside Close. It is stored on
  the IR row (`na[]`), counts as complete for the progress chip, refuses Close while set,
  and only CR/admin can undo it. A normal user setting it gets a toast that CR will review.
- **Section completion gate.** `closeSection` runs `inspectorSectionFindings` and refuses
  only on **Block** findings. The first deterministic Block rules are R-05a (inward rows),
  R-05b (IQC zones), R-05c/R-130 (repair rows), R-125 (Investigation/Root Cause), and
  R-137 (inward photos). FIR/Ask/Note findings are shown but do not block.
- **Live checklist.** A movable cap button bottom-right opens the findings for the
  section you are in. It can be hidden and restored from the IR banner, remembers its
  position per device, and shows each finding's severity and rule number. Saving stays
  free; only Close consults Blocks.
- **Save age.** The indicator now reads `Saved just now`, then `Saved 12s ago`,
  `Saved 5 min ago`, and `Saved 1h ago`. It is per section and updates on a timer.
- **Failed save.** A failed auto-save tells the user in a toast that the change is **NOT
  saved** and to contact the admin immediately, and calls the new backend
  `reportInspectorAlert` once per IR+section. That uses `sendAdminNotice`, so only
  `CONFIG.ADMIN_EMAILS` receive it; it cannot be pointed at a client-supplied address.
- **Writing helper.** English/Hinglish checks (doubled words, punctuation spacing,
  capitals, chat abbreviations, its/it’s, loose dates, spelling, empty filler, Devanagari,
  Hinglish detection) are Notes on the live checklist. They never block.
- **Maturity retrieval.** When Section C has investigation text, the Inspector lists up
  to three past IRs whose issue text/model overlaps, with their IR numbers. It is
  retrieval, not a model; nothing leaves Indrones.
- **IR Close gate.** A ticket cannot be set to **Delivered** while any section is neither
  completed nor NA (R-115).

### Honest limits

The rule engine now runs the deterministic checks above; the remaining Block/FIR/Ask
rules in the book (cross-section timings, reopening, table-derived dispatch, some
advisory rules) need the section-open timestamps and the FIR ledger, so they are the next
pass. The writing helper is a conservative first dictionary, not a full grammar engine.

### Verification

`node tools/smoke-all.mjs` green. `smoke-sections.mjs` pins the NA storage, the Close gate,
the live panel, the save-age wording, and the failed-save report. The browser boot suite
also drives the real code screen. `API_VERSION` moves to **21** for
`reportInspectorAlert`; paste `backend.gs` into both `/exec` deployments as a **New
version**.

---

## 19. v118 — I-INSPECTOR goes invisible, and the IR header gives the screen back (2026-10-23)

### What he said

The floating Inspector and the IR header were eating the space the section form needs.
I-INSPECTOR should work in the background and suggest changes the way Grammarly does while
typing — no panel, no button taking a corner of the screen.

### What shipped

- Removed the floating cap button, the findings panel, and the banner's **Inspector**
  restore button. Nothing about the Inspector is on screen as chrome any more.
- The same rule engine now writes a **tiny badge in the field's own label**: `!` for a
  Block, `•` for a FIR/Ask/Note. Hover reads the message; tapping repeats it as a toast.
  A Block also draws a red edge on the control. It costs no layout height.
- The section form gets the screen back:
  - the workspace header no longer repeats the IR number (the banner already carries it),
  - the banner is tighter and its action buttons are smaller,
  - the collapsed Overview is a thin one-line strip, with its Save button hidden while
    collapsed.
- The NA control stays beside Close; the rule engine, save-age wording and failed-save
  admin notice are unchanged.

### Verification

`node tools/smoke-all.mjs` green.

---

## 20. Future Roadmap (Planned)

### Log Analysis Visualization
- **3D Flight Simulation**: Integration of `Three.js` to visualize the flight path during identified "Alert" periods.
- **Intelligence Loop**: Building a database of known failure patterns to move from "Manual Alerting" to "AI-Driven Diagnostics."

---
*End of Log*
