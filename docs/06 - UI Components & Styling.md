# 06 — UI Components & Styling

The stylesheet is five layered files, loaded in this order from `index.html`:

| File | Contents |
|---|---|
| `tokens.css` | **Generated.** Colour ramps (light + dark), radius, typography, elevation, focus rings, layout metrics, z-index scale, semantic aliases |
| `palette.css` | **Hand-written.** The accent *role* — `--accent`, `--accent-soft`, `--accent-bar`, `--btn-solid-*` — re-pointed per palette. Loaded right after `tokens.css`, and must not move: `tokens.css` is regenerated whole, so the role cannot live there |
| `base.css` | Reset, typography helpers, keyframes, splash, auth, app shell (sidebar / header / panes), responsive breakpoints |
| `components.css` | Buttons, form controls, pills, search, dropdowns, modals, loading states |
| `views.css` | Ticket list, sync bar, ticket detail, the read-only intake report, the section tables, comments / history / admin UI — and, **last**, the polish level (see [09](09 - Design System.md)) |

For provenance, the generation script and the browser-support decisions, see
[09 — Design System](09 - Design System.md). In short: **the palette is Frappe
Helpdesk's**, ported by hand, with no Tailwind and no build step.

## Design Tokens

Three families, exactly as Frappe defines them:

```css
/* backgrounds, per hue + neutral ramp (1 = most subtle) */
--surface-base      /* page */
--surface-gray-1..10
--surface-sidebar
--surface-elevation-1|2|3
--surface-blue-1..10  --surface-green-*  --surface-red-*  --surface-amber-*  --surface-violet-*  --surface-teal-*

/* text and icons — ramps stop at 9 */
--ink-base
--ink-gray-1..9
--ink-blue-*  --ink-green-*  --ink-red-*  --ink-amber-*  --ink-violet-*  --ink-teal-*

/* borders and dividers */
--outline-gray-1..9
--outline-elevation-1|2
--outline-blue-*  --outline-green-*  --outline-red-*  --outline-amber-*  --outline-violet-*  --outline-teal-*

/* and alpha variants of the above for layering over images */
--surface-alpha-*  --outline-alpha-*
```

Everything else is derived:

```css
--radius-0..9, --radius-full      /* 4 = 8px is the default component radius */
--text-2xs..7xl                   /* each with a matching --leading-* and --tracking-* */
--weight-regular: 420             /* yes, 420 — not 400 */
--elevation-sm..2xl               /* shadows differ between light and dark */
--focus-default                   /* box-shadow ring, not an outline */
--header-h --sidebar-w --list-w --bottombar-h --safe-b --safe-t
--z-base --z-sticky --z-sidebar --z-header --z-dropdown --z-overlay --z-modal --z-toast --z-splash
```

Semantic shortcuts on `:root` — these are what the component CSS actually uses:

```css
--btn-solid-bg: var(--surface-gray-10);   /* neutral, inverts in dark mode */
--st-open-bg/fg/bd  --st-paused-*  --st-resolved-*  --st-closed-*  --st-legacy-*  --st-danger-*
```

`--accent` and the `--btn-solid-*` button colours are **not** here — they are the
*role* the palette layer re-points, and they live in `palette.css`. A component must
use `var(--accent)`, never `--surface-blue-*` or `--ink-blue-*` directly: naming a
colour family hard-codes the palette and the user's choice silently stops working.
See [09](09 - Design System.md).

**Rule for new CSS: never a raw hex, never a px font size.** Use a token. The only
deliberate exception is the splash screen's fixed black (`#0b0b0b`, so the intro
video sits on neutral chrome). There is no second one: the captcha image backdrop
(`#f4f4f4`) went with the captcha, when sign-up was removed.

## Theming and appearance

- Theme preference is `'light' | 'dark' | 'system'`, stored in `localStorage` under
  `theme`. `'system'` (the default) follows `prefers-color-scheme` live.
- Dark is applied as `[data-theme="dark"]` on `<html>`; light removes the attribute.
- **Palette** preference is `'blue' | 'violet' | 'teal' | 'graphite'`, stored in
  `localStorage` under `palette`, applied as `[data-palette="…"]` on `<html>`. Blue
  is also the value on bare `:root`, so it applies even if storage is unreadable.
- A tiny inline script in `<head>` applies **both** values **before first paint**, so
  there is no flash of the wrong theme or the wrong accent.
- `applyTheme(true)` in `app.js` stamps `.no-transition` on `<html>` for two
  `requestAnimationFrame`s around a swap — without it every transitioning surface
  cross-fades at once and the swap reads as a flash.
- Both controls live in the **user menu (top right)**, in an `Appearance` group: theme
  rows and palette rows, each a labelled row with a swatch, marked `aria-checked`.
  They are **not** in the sidebar foot — that was where the theme toggle used to be,
  and it required scrolling to the bottom of the sidebar to reach. General rule:
  **no primary control lives at the bottom of a scrolling column.**
- The site-wide allowlist for palettes is `__CONFIG__/theme`
  (`{ palettes: [...], default }`), read by every signed-in user and writable only by
  an admin. A stored choice that is no longer allowed falls back to the default.

## Key Components

### App shell
- **≥1024px** — `#sidebar` (232px: brand, nav) · `#workspace`
  (56px header, then `#panes`: list 400px + detail). `body.view-detail` reveals the
  detail pane; the list stays on screen, so ticket switching never leaves the page.
- **<1024px** — `#sidebar` becomes a fixed bottom bar (icons over labels, counts
  and the brand hidden), and list / detail are separate full screens. The
  **`Made with … for Indrones V<nn>` credit line is hidden here too** (issue from the
  field: it "occupied this place" where the menu items needed room). It is only
  hidden on phone and tablet — the desktop sidebar keeps it, and it is how a report
  can be answered by looking at the screen.

`renderLayout()` in `app.js` is the only place that sets pane visibility, and it
must keep writing **inline** `display` values — `applyAccessGating` reads
`detailView.style.display`, and `applySectionAccessGating` selects
`.tab:not([style*="display: none"])`.

**The sidebar brand types itself, on a loop.** The owner, 2026-10-10: *"in dashboard
above service desk, are placed logo and I-PASSBOOK… logo appears and then I-PASSBOOK
gets typed, then it fades and then it repeats itself."* That is `#sidebar .brand-mark`
plus `.brand-text` and nothing else — a ~6 s cycle in which the mark fades in, the word
types, the pair holds, both fade, and there is a beat of empty before it repeats. It is
**`base.css`**, immediately after `.brand-text`, and three things about it are
load-bearing rather than decorative:

- **It is wrapped in `@media (prefers-reduced-motion: no-preference)`.** `base.css`
  carries a global reduced-motion rule that forces `animation-iteration-count: 1` and a
  0.01 ms duration on everything in the document. Unwrapped, a device asking for less
  motion would be thrown straight to this animation's **last** keyframe — the faded-out
  beat — and would sit looking at two blank spaces where the app's name goes. Guarded,
  the rule simply never applies and the lockup stays composed.
- **The keyframes drive *out of* the composed state, not into it.** The un-animated
  `.brand-text` is the full word at full width, always. The tempting inverse — hide it
  in the base rule and animate it in — leaves a blank sidebar the moment anything stops
  the animation: reduced motion, a print stylesheet, a future `animation: none`. This
  way round, "no animation" and "animation finished" both mean "the brand is there".
  The fill mode is deliberately left off for the same reason.
- **The typing is a `clip-path`, not a width.** The word is laid out at full width for
  the whole cycle and `white-space: nowrap` keeps it on one line, so the flex row never
  reflows and nothing else on the screen moves; only those ~90×16 px repaint. Animating
  `width` would buy a layout pass per step, on the chrome of every screen, for a worse
  result — a wipe instead of typing. `steps()` is what makes it read as typing, and the
  clip is applied to a flex item, which is blockified, so it applies.

Nothing is paid for when nothing is seen: `#sidebar` is `display:none` while signed out
and below 1024 px, so the animation exists but paints nothing, and the collapsed 56 px
rail hides `.brand-text` outright — the rail is untouched on purpose. **This is not the
intro.** `INTRO_DONE_KEY` / `paintBrandPanel()` govern the once-per-VERSION sign-in film
and share nothing with it; the two must not be wired together. If the motion ever wears
thin, the whole answer is `animation-iteration-count` — one number, no markup.

### Splash (`#splash-screen`)
Fixed overlay at `--z-splash` holding nothing but the intro video and a loader bar.
**Nothing is layered over the video** — a darkening div with a backdrop blur used to
sit here and the owner read the result as a blurry video. The wordmark and the
"Indrones Product After-Sales Summary Book" line it carried moved to the sign-in
card, where the full product name belongs.

Two cuts ship — a portrait phone cut listed first and gated by `media`, then the
16:9 master as both the desktop cut and the fallback. `<source>` takes the first
match, so the order is load-bearing.

The intro plays **every time a device arrives at the sign-in screen**. The one
device that skips it is one that is **already signed in** — nine seconds of video in
front of a session that was going to resume anyway is a delay, not a welcome. That
is decided from `localStorage.ipb_user` **and** `localStorage.ipb_session` together,
in two places that must agree: the pre-paint script in `index.html` sets
`data-splash="skip"` on `<html>` before the body parses (`base.css` hides the splash
off that attribute, so no flash), and `app.js`'s boot path re-asks through
`hasStoredSession()`. `smoke-shell.mjs` pins the two conditions to each other —
if they drift, a signed-in user gets a video or a signed-out one gets a blank
screen, and both only ever show up on a real device.

Skipping also has to be free: the video is `preload="none"` with no `autoplay`, and
the boot path returns before it touches the video, so a resuming device downloads
nothing. Neither cut is in `sw.js`'s `SHELL` — precaching them would charge every
first-time install ~13 MB before sign-in. Every other visit does fetch the cut, so
this is the one place the app spends bandwidth on purpose.

Dismissal listens for the video's `ended` event rather than waiting a fixed time, so
a re-exported intro needs no code change; `INTRO_FALLBACK_MS` is the backstop when
`ended` never arrives, and must stay ≥ the longest cut. The loader bar's
`animation-duration` is `var(--intro-ms)`, which `app.js` sets from the video's own
duration on `loadedmetadata` — it previously ran a fixed 1.85 s and reached 100%
with seven seconds of intro still to play.

Adding an asset here means adding it to `SERVED` in `tools/deploy-ghpages.mjs` (and
to `PRUNE` if it replaces one).

### Google wait screen (`#sso-wait`)
A full-screen overlay on the splash's own layer (`--z-splash`) and its own black
ground (`#0b0b0b`), holding the borderless icon mark, "Signing you in…", "You're on
your way to I-PASSBOOK.", and an indeterminate sweep bar. It exists because the
owner watched a Google sign-in and reported: *"In transition, it was showing login
page still while it was loading the app"* — the one-time handoff code is exchanged
over an Apps Script round trip, and the app used to spend that round trip showing
the sign-in form to somebody who had already signed in.

It is shown by **attribute, not by a class toggled from `app.js`**, exactly like the
splash: `index.html`'s pre-paint script sets `data-sso="wait"` on `<html>` before the
body parses and `base.css` reveals the overlay off that attribute, so there is no
frame where the form shows through. The gate is the **narrow** prefix
`'#sso='` — a refusal (`#ssoerr=`) has nothing to wait for and must land straight on
the form with the door's reason already on it.

It is taken down by `endSsoWait()`, called from **`showAuth()` and `showApp()`**
rather than from the two endings of `finishHandoff()` — so *every* route to a real
screen clears it and no path can leave a person staring at a sign-in that already
finished. In `showApp()` it sits **before** the temporary-password guard, because
that guard diverts to the password-change screen and a diverted sign-in still has to
lose the wait. The same call clears the 8-second slow-note timer
(`SSO_SLOW_MS`, which swaps the line for "Still signing you in — the backend can
take a moment to wake up."), so a timer cannot fire at a screen that is gone.

The bar is deliberately **indeterminate**: the wait is one round trip, under a second
warm and several seconds against a cold Apps Script start, so a determinate bar
would be a guess. The sweep travels inside the track's own width so it never appears
to stop mid-track, and the global reduced-motion guard would leave it parked as an
empty track — the one state that reads as *stuck* rather than *working* — so it is
parked centred explicitly instead. The mark is already in `sw.js`'s `SHELL`, so the
screen downloads nothing.

**The mark is drawn from a height with `width: auto`, and it carries NO filter at all.**
The height is a real defect fixed, not a preference: the owner's second look reported
*"the logo/icon used is not the correct one with proper background etc, it has unclear
things in the logo."* The artwork then was a **4:3 lockup** (`512×384`: the disc, then
"Passbook" beside it), so `.sso-wait-mark` forcing `width: 56px; height: 56px` squashed
it — the same reason `.auth-logo` and `.brand-mark` have always sized the mark off a
height.

**The filter is gone, and its removal is the part a reader is most likely to undo.**
That disc was a dark slate (`#323943`) on a permanently `#0b0b0b` screen, so
`filter: invert(1)` turned the disc light and kept its knocked-out monogram legible —
right for that artwork. Two things then moved underneath it: the mark became the
current **two flat inks on transparency** (see [the app icon](01 - Project Overview.md)),
and this screen's ground became the app's own `--ind-ground`, which is **light in light
mode**. On the old treatment the mark would now be `brightness(0) invert(1)` — a white
silhouette on a white page. So the rule is: **whatever ground the screen stands on, the
artwork is drawn as it is.** `smoke-shell.mjs` pins the height, the `width: auto`, the
absence of a pixel width, **and the absence of that filter** — an assertion that had to
be inverted rather than loosened, because "the filter is still there" was exactly the
failure the old form of the line could no longer see.

### Auth card (`.glass-card`)
`--surface-elevation-1` card with an `--outline-gray-1` hairline, `--elevation-lg` and
`--radius-6`, capped at 400px — **and `backdrop-filter: var(--glass-blur)` since
2026-10-09, inside an `@supports` block**, with the same lit top edge the app's other
glass surfaces carry. The `@supports` is the whole safety net: a browser without
`backdrop-filter` gets the solid card it has always had, never a translucent panel with
nothing behind it. The blur is real but nothing shows it over a flat colour, which is
why `#auth-container` also paints a two-lobe accent field behind this card. This is a
deliberate return of the thing that used to block light mode — the old glassmorphism
cluster was many unguarded blurs over an opaque ground; this is one, guarded, over a
field that was chosen to make it visible. See
[09 — Design System](09 - Design System.md) for the five tokens and the full list of
surfaces that spend them.

### The landing page (`.doors`, `.door`, `.door-role`)
The sign-in screen is **one common typed head over two stacked doors**, not a grid of
two cards. An `Employee` door carries the unchanged `#auth-form` with all four of its
methods in one box; a `Customer` door below it has no password field at all and links
out for its reset. `.doors` is a **flex column** capped at 420px, and no media query
makes it a grid, so the phone and the desktop arrangements cannot drift apart.

| | Employee (`#door-employee`) | Customer (`#door-customer`) |
|---|---|---|
| Holds | the one staff `#auth-form` — email → emailed code — plus the `.quick-row` (Google handoff, passkey, pattern) | its own `#cust-form`: welcome, the helper line, the address, **Continue**, `or`, and the desk's address for anyone not onboarded |
| On arrival | **shut** | **shut** |

**Both doors ship folded and both are independent.** `paintDoors()` shuts both on every
arrival and restores nothing from storage; `toggleDoor(which)` reads only that door's own
`data-open` and moves only that door. Any combination of open and shut is reachable —
this is not an accordion, and it was one until 2026-10-09. The owner's correction, after
two rejected attempts: *"I asked page opens the tabs collapsed, then we may open anyone
or collapse anyone without being dependent on other."* `setDoor()` writes the one fact in
all three of its places — `data-open` turns the chevron, `hidden` folds the panel (with a
`!important` that beats `display: flex`), and `aria-expanded` tells a screen reader — and
the markup ships in that same state, so nothing moves on the first frame. See
[10 — Auth & Access Model](10 - Auth & Access Model.md#one-link-two-doors).

Each door is `<section class="door glass-card" data-open="0">`, so the skin's
`#auth-container .glass-card` rule dresses both, there is no second place for either
card's shape to drift from, and the section carries the fold state a CSS reader can see.

Nothing about this screen can be measured through `index.html` itself: over `file://`
app.js fires a blocking `alert()` and the renderer stops answering CDP calls, so
`tools/render-check.mjs` hangs with no output at all. `tools/render-fixture.mjs` cuts
the `#auth-container` block out of `index.html` between two named ids and writes it to
`%TEMP%/ipassbook-render/landing.html`; that is the page to measure and to photograph.

**The sign-in chain has a third screen and a fourth camera.** Between the landing page
and the `#sso-wait` screen sits the **transitional page the Google door ends on**
(`handoffPage()` in `backend.gs`), served by Apps Script at `script.google.com` — a
different origin from the app, in the middle of a sign-in, only after a real Workspace
identity has been read. It is the one screen in the product that no smoke suite and no
route can show you, which is how it spent three months in the app's *previous* look
without anyone noticing. `node tools/render-doorpage.mjs` runs the real function under a
faked Apps Script platform and writes both of its branches — the handoff and the
refusal — to `%TEMP%/ipassbook-render/`, ready for `render-themes.mjs`. Its dark branch
is written out separately with the media query rewritten, because that page reads
`prefers-color-scheme` rather than the app's stored preference. See
[04 — Backend API Reference](04 - Backend API Reference.md).

### Ticket list (`#index-view`)
`.list-toolbar` (title, the List/Board/Grid switch, count, search, filter segments,
the priority and sort selects) over `.ir-list`. Rows are
`.ir-card` — flat with dividers rather than floating cards, which holds up better
at 400 rows. `.ir-card.is-selected` marks the row **the screen is about** — see
*The ticket dock* below, which is the other way that becomes true.

**The toolbar is compact by measurement, not by taste (2026-10-11).** The owner, looking
at this screen: *"the amount of space occupied by header (almost blank), search bar,
filters (all sorts of) are occupying in the page is too much and should be thought out
intelligently and designed modularly."* He was right, and the number was **328px above the
first row** — 37% of a 900px window, and **394px of a 844px phone**, 47% of the screen spent
before the work starts.

It is now two rows and one fold:

- **`.list-toolbar-top`** — title, the view switch, **the search box**, the count and the
  `Filters ▾` toggle, on one line. The search moved up onto the title row; it is also the
  order `smoke-board.mjs` already pins (the switch must sit between `class="list-toolbar-top"`
  and `id="search-input"`), so the constraint and the design agree instead of fighting. On a
  phone the row wraps to two lines and the toggle is a 40px target.
- **`#filter-summary`** — the **names of the filters in force**, each a chip that clears
  itself. **This is not decoration and it is not optional.** The app's written rule is that
  filters deliberately do not persist (`VIEW_KEY`), because *a hidden filter surviving a
  reload is how someone concludes the app has lost tickets*. Folding the panel away hides the
  controls, so the closed row has to *say* what is filtering — and then a filter can never be
  hidden and in force at the same time. It is empty and takes no height at all until one is.
- **`#list-filters`** — the status strip, the category strip and both selects, unchanged,
  inside a panel shut unless asked for. `list-toolbar:not(.is-filters-open)` hides it, and it
  is hidden **by a class rather than with `hidden`** because the strips inside it are measured
  *in place* by the geometry checks in the suites; taking them out of layout would break
  twenty rules that have nothing to do with this change.

`--header-h` went 56px → **44px** in the same pass (still clearing a 40px touch target with
room for the rule beneath it); `--rail-w` follows it automatically. Net: **130px** of chrome
in Grid/Board and **165px** in List at 1440×900, **160px** on the phone. The open/closed state
of the fold persists through the same `storedFlag`/`setFlag` convention as the rail — it is a
**UI fold, not a filter**, which is the opposite rule on purpose, and `FILTERS_KEY` says so
in a comment where someone would otherwise "fix" it.

⚠ **Option 3 — "keep it, hide it on scroll" — was evaluated and rejected**, because it saves
nothing at rest (the top of the list is where every filter change lands), it would hide the
search box exactly while searching, it needs a scroll listener on `#ir-list` that this project
has already measured and deliberately not paid for, and it makes *"how much space is this
taking?"* stop having an answer. The compact toolbar reclaims the space **always**, with no
new listener, and hide-on-scroll layers on top of it later if he still wants it.

An `.ir-card` shows the **assignee's name** as `.ir-assignee`, beside the IR number
in `.ir-title-row`. It was an initials circle (`.assignee-avatar`, `initialsOf()`)
until 2026-09-21, and that circle was the last chip to break the row — see below.
The owner's replacement: *"instead of placing AN in a circle on left of IR470, there
is plenty of space on the right of all IR numbers … we may write down Adhik Nair in
small on the right of IR470."* That space really is empty, the number is short, and
the meta line below runs the full width — so the name costs the row nothing. It
shrinks and ellipsises before anything carrying state, and its `title` holds the
full name for when it does.

**Every row is the same height, and every pill that carries state is always whole.**
This is enforced, not hoped for, and it took two attempts:

1. Triaging a ticket added an avatar and marking it Urgent added a pill, and
   `.ir-card-side` was `flex-wrap: wrap` — so IR470 became two lines while its
   neighbours stayed one. Reported as *"why is the tab of IR470 much bigger than
   others? is there a feature that… changes its normal size?"*.
2. The wrap was replaced with a side column that could **shrink**
   (`flex: 0 1 auto` + `overflow: hidden`), which was worse in a way nothing caught
   until IR470: a shrunk, right-aligned flex column overflows at its **inline-start**
   edge, and `overflow: hidden` then slices it. `Open` was being cut in half, with
   the avatar immediately to its left — reported as *"it has AN written in a circle …
   but it is overlapping above 'open' status i.e., hiding it."* Nothing was painted
   over anything; the pill was cut, and the circle merely sat where the cut was.

The numbers, because this is arithmetic and not taste: the desktop list pane is
`--list-w` (`tokens.css`), so a row has ~371px of content width, and IR470 had
collected the avatar, Urgent, Open, Overdue, the completion chip, Legacy **and**
`View Summary ↗` — more than a 400px pane holds. So the row now:

- **`.ir-card-side` is `flex: 0 0 auto` with no `overflow`** — it cannot be
  squeezed, so `justify-content: flex-end` cannot push a pill past its own start
  edge, and nothing is left to hide. Pills render whole or not at all.
- **carries only what carries state**: priority, status, the Overdue flag and the
  completion chip. `Legacy` and `View Summary ↗` left the row at **every** width
  (not just on phones) — both are already inside the ticket, in words and in the
  header link. This deleted the old `@media (max-width: 639px)` rule, so a phone now
  keeps exactly the chip set a desktop does and there is no breakpoint to keep in
  step.
- **gives way only in `.ir-card-main`** — `flex: 1 1 auto; min-width: 0`, with
  `.ir-title` and `.ir-assignee` nowrap+ellipsis so a long title can never wrap the
  row taller than its neighbours. The middle gives way because the serial, the
  category and the date are one tap away inside the ticket and the statuses are not.

**Everything the row cannot hold is revealed on hover**, which is the other half of
the owner's rule: *"any additional info if coming in that tile should either find its
place adequately without disturbing other elements and professional appearance or
else show when hovered above it or both."* `.ir-card-hover` is filled by
`renderIRList` from the same record (assigned-to, the Legacy record in words, serial,
category, sub-category, date, age and overdue), and it is a **grid item spanning the
same two rows** as the title and the meta — so revealing it changes no height and
moves nothing, and the two it covers fade to `opacity: 0` rather than being removed,
which is what keeps the box the same size.

Three details in that hover line are load-bearing. It uses `visibility: hidden`, not
`opacity: 0`, because an invisible `opacity: 0` Summary link would still be in the
tab order and a keyboard user would land on it. The hover rules sit inside
`@media (hover: hover)`, because a touch device fires `:hover` on tap and leaves it
stuck — a phone would swap a row's contents to the hover line and never swap back.
And nothing about the row depends on `position: absolute`, so no overlay can be
clipped by `#ir-list`'s own scroll box.

**Two scroll areas, and both are the owner's.** On 2026-10-10 he asked for *"separate
scroll bar for IR list and similarly in for board since number of columns are more, we
can have left-right scrollable bar on top of columns space."* They were answered in
opposite ways, and the difference is worth knowing:

- **The list already had its own, and it was left alone.** `.ir-list` is
  `flex: 1; min-height: 0; overflow-y: auto`, and `#index-view` around it declares **no
  `overflow` at all** — so the toolbar with the title, the search box and the two filter
  strips sits outside the scroller and stays put while the rows move under it. The
  property doing the work is the *absent* one: a single `overflow: auto` added to
  `#index-view` would put the whole pane in one scroller, toolbar and all, and nothing
  else on the screen would look wrong. `min-height: 0` is the other half — without it a
  flex item refuses to shrink below its content, so the list would grow past the pane and
  the scrollbar would appear on the **window** instead. `smoke-board.mjs` pins all three.
- **The board's bar is a second, real element.** `#ir-board-scroll` is an empty
  `.board-scrollbar` div carrying one 1 px child, placed between `.ir-list` and
  `#ir-board` as their sibling; `scrollBoardMirror()` in `app.js` sizes that child to the
  **board's** `scrollWidth` and keeps the two `scrollLeft`s equal in both directions,
  under a re-entrancy guard. The reason it exists is that **CSS cannot move a
  scrollbar**: one is always drawn at the *end* edge of its own scroll container, so the
  board's own always lands along the bottom, under column bodies as tall as the pane and
  half a screen from the column headers you are scrolling to reach. The only CSS that
  relocates it is the `scaleY(-1)` flip, which flips every descendant with it. The board
  **keeps its own bar as well** — on a touch device that one is the only one a finger
  meets, and removing it would leave the last row of cards looking cut off. Both are
  shown and hidden together by the single `#index-view.is-board` gate, and both are
  driven in `smoke-board.mjs`.

### The three drawings — List, Board, Grid (`#ir-list`, `#ir-board`, `#ir-grid`)
All three are drawings of **one filtered set of rows**, which is the whole design.
`applyListFilters()` is the single place that filters, sorts and searches, and its last
three lines route the *same* `rows` to `renderIRList`, `renderBoard` or `renderIRGrid`.
So the search box, both filter strips, and the priority and sort selects apply to all
three for free, and no drawing can show a set the others do not.

- **The switch is CSS-driven.** `#index-view` carries exactly one class naming the
  drawing — `is-board` or `is-grid`, neither for the List — and `setListView()` is its
  only writer. The buttons, the pane class and the repaint therefore cannot disagree.
  An unrecognised mode normalises back to `list`, never to a blank pane.
- **The Service Desk ARRIVES on the Grid** (2026-10-13). `showApp()` ends its arrival with
  `setListView('grid')`, whatever this device last chose. It shipped at v90 as
  `setListView(listMode)` — the value read from `VIEW_KEY` — on the reasoning that a
  remembered drawing should win, and that is what kept the Grid off the owner's screen: his
  device had chosen List before the Grid existed, and `handleRoute`'s own "opens on the Grid"
  rule could never fire, because `showApp()` calls `showIndex()` (which sets `currentView =
  'index'`) *before* `handleRoute()`, whose first line returns early on `'index'`. So
  `VIEW_KEY` now supplies only the pre-boot first paint, and every arrival lands on the Grid.
  Choosing List still works and still sticks for the length of the session; it just does not
  outlive a reload. The guard in `handleRoute` is **kept** — it is what stops a mid-session
  flip to List being stamped back to Grid. `smoke-ui.mjs` pins both halves, because deleting
  either one is a plausible-looking repair that puts the bug back.
- **A view that needs the workspace takes it.** At ≥1024px `#index-view` is a fixed
  `--list-w` rail (400px), and nine columns of cards — or a grid — do not fit in 400px.
  `html.view-full` makes the pane take the whole row and steps the "No IR selected"
  placeholder and the **list's** fold toggle aside. **It is one class for both views**,
  not one each: "this drawing takes the whole row" is a single fact, and two parallel
  classes would be two places for it to drift. Everything behind it is desktop-scoped, so
  a phone (where both views are already a full screen) is untouched.

  ⚠ **IT DOES NOT HIDE THE SIDEBAR, AND BETWEEN 2026-10-11 AND 2026-10-13 IT DID.** The
  rule `html.view-full #sidebar { display: none }` stepped the Service Desk bar aside with
  the placeholder, on the reasoning that a drawing which takes the whole row should not be
  sharing it. That was my reasoning, never the owner's, and on 2026-10-13 he met its
  consequence: he scrolled the Grid down to IR001 and could not reach the Service Desk at
  all — *"in grid view the left bar of service desk is not visible. Even grid view should
  have left tab of service desk with option to expand or collapse it."* The bar is how a
  person moves between Insights, the Log, the FAQ and a ticket; a view that removes it is a
  view with no way out of itself. So it stays, and the **room** is taken by choice instead
  — its own toggle folds it to the 56px rail, which is the same fold the IR list has and
  the same one a maximised ticket already lives with. `#sidebar-toggle` therefore stays on
  screen in these two views too: a fold control is precisely what a view this wide needs.
  Measured at 1440×900: sidebar 232px → 44px on fold, grid pane 1208px → 1396px.
  `smoke-ui.mjs` now asserts the **absence** of that rule (against comment-stripped source)
  as well as the three `html.view-full` rules that remain.
- **The Board** is nine columns from `BOARD_COLUMNS`, with the column's FULL count in its
  header and every card drawn. Its own sideways scroll bar is described below.

**The Grid** (2026-10-11 — *"I also want a grid view option. As of now we have list and
board. but grid in my view will have better UI for users"*) is the same rows as square
tiles, `repeat(auto-fill, minmax(17.5rem, 1fr))` — so a narrow pane falls to one column
with no breakpoint behind it.
`.ir-tile` reuses the app's own parts rather than inventing any: `.ir-title`, the shared
`getBadgeClass()` badge, `statusLabel()`, the shared `progressChip()`, the `.prio` dot
and **`initialsOf()`** for the monogram — the one reader that helper has left since the
row's initials circle was removed. A tile shows the **company** (`companyName`, Col R —
never `customerName`, Col L, which is the *person*), the serial, the category, priority,
the Overdue flag, the completion chip and the age; the reporter's name is the tile's
`title`. Clicking a tile opens the **existing ticket pane** — the mockup's slide-out
drawer was rejected, and a second ticket screen is what `smoke-board.mjs` pins against.

**Neither drawing caps anything as of 2026-10-13.** `GRID_CAP = 60` and `BOARD_CAP = 25`
per column are gone, and the `.grid-more` / `.kb-more` chips with them. They had been
justified by cost, and the cost was then *measured* at 454 IRs: 454 tiles cost ~14 ms to
build and ~44 ms to assign and lay out, warm — which is what the uncapped **List** has
always cost on every keystroke (~0.06–0.1 ms/row). The cap was not proportionate to
anything the list does not already do, so it was deleted rather than tuned. There is
deliberately **no chunker, no `IntersectionObserver` and no scroll listener**; this
project has evaluated and declined that cost once already
([PROJECT_HISTORY §6](../PROJECT_HISTORY.md)).

**The end-of-list note.** Blank space under the last row is the one thing an uncapped
drawing cannot distinguish from a drawing that gave up, so the blank now has a sentence
in it: `grid.foot` — *"No more IRs — {n} shown"* — drawn by `renderIRGrid()` as the last
child, spanning the row (`grid-column: 1 / -1`). Two rules it keeps: it is drawn **only
when something was drawn** (an empty result already says so in the shared `.empty-state`,
and "0 shown" underneath it would be two screens arguing), and it carries **no
`overflow`** — a grid row sized `min-content` with a clipped child is the v89 trap.

Two things the mockup asked for that a tile would have to be given, and they are stated
rather than faked: there is **no warranty field** on a record (the only warranty value is
a Section C *form* field, which a tile cannot reach without loading every ticket's
Section C), and the **model** is not a field on the ticket's own status data — it is a
filter read off the raw intake grid (Col S, `droneModel`; see
[03](03 - Sections Reference.md)). Its `Critical` priority does not exist either; the
real four are Urgent, High, Medium, Low. Its 12–16px corners became square for free by
asking for `var(--radius-N)` (`#index-view` re-points those tokens to `0px`), and it
casts no shadow, because this look floats nothing.

⚠ **`grid-auto-rows: min-content` on `.ir-grid` is load-bearing, and `auto` — the
default — crushes every tile.** This is the list's own scroll bug one level down. A
`grid-auto-rows: auto` track starts at its items' automatic minimum size, and that
minimum is **zero** for an item with `overflow: hidden`, as a tile is (kept for width
safety, the same reason `.ir-card` keeps it). So every row started at 0 and then grew
only by its share of the container's free space: measured 1440×900 with 80 records,
16 rows, clientHeight 572 — each row got 399/16, and the tiles came out **24px tall
holding 124px of content**, clipped by their own `overflow: hidden`. And because the rows
absorbed exactly the free space, `scrollHeight` equalled `clientHeight` and there was
**no scrollbar** — a crushed grid that reads as a short one. `min-content` sizes each row
from its items instead of from the leftover space: same run, row 159px, `scrollHeight`
2584 vs `clientHeight` 572, and it scrolls. Same family as `.ir-list > * { flex: 0 0 auto }`:
a definite height only helps if the children refuse to absorb it.

**Priority and sort are the same pipeline, not a second filter system.** The two
`<select>`s in the toolbar (`.list-select`, raised to 16px on a phone so iOS does not
zoom) feed `applyListFilters()` and nothing else — so they order and filter all three
drawings at once. Sort uses **`dateRaisedISO`**, the only clean sortable date on a record
(`dateRaised` is display-only), with priority ranked Urgent-first and unset last, and
`sortIRRows()` **copies before it sorts** — `applyListFilters` hands it `allIRs` itself
when no filter is active and `.sort()` is in place, so sorting in place would silently
reorder the master list and every Insights count with it. The default order is
**Newest first**, which means this release changed the List's order too. The view mode is
remembered across a reload; **the filters deliberately are not** — a hidden priority
filter surviving a reload is how someone concludes the app has lost tickets.

### The ticket dock (`#ir-dock`)
A strip along the bottom of the window holding every ticket the owner has opened, and the
window that one of them can raise. His words, after checking Gmail himself: *"bottom
sheet, where it can be minimised… such that I can minimise and keep multiple IRs on my
worklist on screen minimised."* And, on the shape of the minimised tabs: *"seated adjacent to
each other in bottom, i.e., a line one next to other, facing us (the user)"* — a **row**, not
Gmail's vertical stack.

**Three states, and v91 is the change that made all three exist** (2026-10-13 — *"a window
manager"*, after meeting v90's bottom sheet):

| State | `currentView` | What binds it | On screen |
|---|---|---|---|
| Minimised | `index` | in `dockIRs`, not `dockOpen` | a tab in the strip |
| **Restored** | `index` | `dockOpen` | a centred window + a scrim + the strip |
| **Maximised** | `detail` | `currentIR` | the passbook, **full page** |

- **The tab** — name left, ellipsised, then **three buttons right-aligned in his order**:
  the mid-size panel, the full view, and close. The name is *also* a button, so the whole tab
  body brings its window back rather than only the three small corners.
- **The window** — centred, `min(56rem, 100vw - 2rem)` by `min(70vh, 40rem)`: **smaller than
  the screen on every side**, so the drawing behind it stays visible, which is the request
  (*"show me the IR above screen, center placed, but smaller size than screen"*). The
  definite-height chain is the same `max-height` + `min-height: 0; overflow-y: auto` pair as
  everywhere else, so the window's own contents scroll rather than the page (measured at
  1440×900: `scrollHeight` 1158 against `clientHeight` 582).
- **The scrim** — one dimming layer, `rgb(0 0 0 / 0.45)` plus the app's one sanctioned
  `backdrop-filter: blur(2px)` (in industrial.css's `@supports` block, beside
  `.inward-options-modal`). It is a **child of `#ir-dock`** and not a `<body>` sibling, because
  `smoke-industrial.mjs` counts non-scoped selectors in `industrial.css` against a ceiling of
  22 and `#ir-dock` is already in its `CHROME` list — as a child the count does not move.
  Clicking the scrim **minimises**, which is what `Escape` already did; no new semantics.
- **The strip survives maximise.** `applyDockState()` (`app.js`) is the one writer of **two**
  classes: `body.has-dock` (the strip is on screen) and `#ir-dock.has-window` (the window is
  up). At v90 one flag did both, so maximising a ticket erased every other tab. `has-window` is
  a **class and not a re-render**: `renderLayout()` runs on every layout pass and
  `renderDock()` refetches the timeline, so wiring them together would put a network call
  inside a layout pass.
- **A maximised ticket takes the whole row.** `listHidden` in `renderLayout()` is
  `detail ? true : (full && !desktop)` — an IR is a thing you are working on, and the panes
  that keep the desktop split (dashboard, analyser, FAQ) are views *of* the list. The back
  arrow is the *same predicate*, because that is all it is: the way back from a fold.
- **The window is not a second ticket screen.** ⚠ **What it holds changed on 2026-10-13.**
  v91's sheet carried the ticket's **activity list** (`buildTimeline()` +
  `renderTimelineInto()`) over two one-field quick-sets (`dockSetStatus`,
  `dockSetPriority`). He rejected all three of those in one sentence: *"the data it is
  showing in small tab is not correct, it should show 'Allot CAPS' options and 'Report'
  details to give IR's overview. Activity log is not required."* So the window now holds
  exactly two blocks, in that order:

  | Block | Built by | Shown when |
  |---|---|---|
  | **Allot CAPS** | `triageFieldsHTML(ir, 'dock-')` | `canTriage()` |
  | **Report** | `intakeBodyHTML(ir)` | always — read-only by construction |

  Both are the **app's own builders**, the same two calls the full-screen Allot CAPS dialog
  and the 📋 Report tab make — `smoke-board.mjs` pins that the dock defines *neither*, so
  there is no second copy of the form or the report to drift. The window passes an **id
  prefix** (`'dock-'`) so the two forms can never collide in the DOM; the dialog's own ids are
  byte-identical to before, which is what keeps every suite naming `triage-assignee` reading
  true. `applyTriage(irNumber, p)` likewise takes the prefix, and takes the **ticket** rather
  than reading `currentIR` — a window can be up on a ticket the passbook is not holding.
  **Expand still calls `goTicket()`** — the existing passbook and no new one. All three
  drawings open it (`openDock()`), and it works on a phone (measured at 390×844: the same
  centred window, 366×633, strictly inside the viewport).
- **Saving from the window does not close it.** The dialog's Save calls
  `closeTriageModal()` because the dialog *is* the task; the window's calls `renderDock()`
  instead, because the window is a place he is working and closing it on every field would
  lose his worklist position. Both go through the one `applyTriage()`.
- ⚠ **The window's Save needs `width: auto`.** `.btn` is `width: 100%` — a form button fills
  its column — so a Save inside `.dock-allot-foot` renders as a full-width yellow **band**
  unless the footer escapes it, which `justify-content: flex-end` cannot do on its own (a
  flex item starts at its auto width, and here that width *is* 100%). `.btn-sm` does not
  escape it either: it sizes height, padding, font-size and radius only. The dialog's footer
  carries the same escape (`.inward-options-foot .btn`), and `smoke-board.mjs` pins the
  window's. This was found by looking at a screenshot, not by geometry — every measurement
  said "a button in the footer".
- **Not a route.** `#/tickets/IR470` still means *full screen* — it is what a nudge and an
  emailed link land on — so the dock never writes the hash and the hash never opens a sheet.
  A consequence, stated rather than discovered: **browser Back does not close the window.**
  Close is ✕; `Escape` **minimises** (non-destructive) under the same fire-only-while-open
  guard the customer door uses.
- **`#ir-dock` is a static child of `<body>`**, like the other floating chrome — never inside
  `#index-view`, which is overflow-free by assertion and re-shaped by `list-collapsed`.
  `dockIRs` is memory, so coming back restores the worklist intact.
- ⚠ **`#ir-dock` carries `--z-overlay` (80), not `--z-bottombar`.** A stacking context cannot
  put a child above itself, so the scrim, the window and the strip had to rise as a family to
  cover the header (40) and the sidebar (30). Inside the dock the order is scrim `0`, window
  `1`, strip `2` — and the strip needs `position: relative; z-index: 2`, or a non-positioned
  child paints *under* its own scrim and every tab becomes unclickable while a window is up.

⚠ **`#toast` had to be taught about the strip, and the hidden state is the half that bites.**
`#toast` has **no `opacity: 0` rest state** — base.css hides it purely with
`transform: translateX(-50%) translateY(140%)`, **140% of its own height**. Raising `bottom`
by the dock's height therefore lifted the *hidden* pill back on screen, fully opaque, sitting
on a tab (measured: y851–889 on a 900px window). So `body.has-dock #toast` carries the dock
height in the hidden offset too — **and re-states `.show`**, because `body.has-dock #toast`
(1 id, 1 class, 1 element) outranks base.css's `#toast.show` (1 id, 1 class) whatever the
source order, and without that line every toast in the app would be invisible while the dock
was up. **A hide implemented as a transform is a hide with an implicit size in it.**

### Sync bar (`#sync-status`)
`.sync-msg` (the last status message) + `.sync-meta` (`Synced HH:MM`) +
`.sync-refresh` (the `↻ Refresh` button), written by `renderSyncBar()`. It is a
deliberate, permanent line of chrome rather than a transient toast: **silent
staleness is what sends staff back to the Sheet**, so the app always says when it
last read the data and always offers a re-read.

### Triage modal (`#triage-modal`)
Opened from the ticket banner. Reuses the `.inward-options-modal` shell (fixed
positioning, appended to `document.body`, `--z-overlay`) with a `.triage-body`
grid of `.triage-row` label/control pairs: Status, Assigned to, Priority,
**Category**.

**Category** replaced the old `Type` field, whose seven values (Repair,
Replacement, Warranty, AMC, Demo, Training, Other) described a commercial
arrangement rather than the work, which is not what the desk sorts by. It is
`IR_CATEGORIES` — CRASH, GENERAL MAINTENANCE, REMOTE SUPPORT, REPAIR — and it is
**mandatory**: `applyTriage()` refuses the save with a toast when it is empty,
because it is the one triage field the list filter and the Insights page count by,
so an uncategorised IR is invisible to both. Under **REPAIR** a Sub-category row
appears (`REPAIR_SUBCATEGORIES`: GPS, TRIPOD/BIPOD, TOPSHELL, CAMERA/LENS, BATTERY,
CHARGER, RC, AIRFRAME, OTHERS), and under **OTHERS** a free-text "Mention it" note
appears, which is also required — OTHERS exists so CR can name a fault the list
does not cover, and an empty one re-creates the unexplained bucket the categories
were introduced to remove. Both conditional rows stay in the DOM and are
shown/hidden (`wireTriageCategoryRows()`), never added and removed, so the selects
never lose their listener by being replaced. Changing Category away from REPAIR
clears the sub-category and the note.

The old `type` key is **not** bulk-rewritten out of `_store/irs.json` — that would
be a destructive pass over every record. It is dropped per-IR by `applyTriage()`
(`patch.type = undefined`; `JSON.stringify` omits it) the next time CR saves that
IR's Triage, and no read site consults it any more.

`TICKET_PRIORITIES` and `IR_CATEGORIES` are app-owned — the customer Form has
neither column. Status options come from the single `IR_STATUS_VALUES` list, so
the modal and the banner pill can never drift apart. Gated on **`canTriage()`**,
which is a **separate axis from the section revokes**: CR and Management hold it
while switching no section off, and a department that switches Section C off does not
thereby get it. It replaced a `canEditSection('sec-a')` read when Section A stopped
being a section — the audience is unchanged, plus Management.

### Filter segments (`.segments` / `.segment`)
Frappe's All / Open / Paused / Resolved / Closed strip with live counts. Each
segment maps to a **status category**, not a status value — see below.

A **second** `.segments` row, `#list-categories`, carries the same thing for
Category (`renderCategorySegments()` / `categoryCounts()`). It is a second
INDEPENDENT axis, not a third row of the same control: a CRASH that is Resolved is
a real question, so the two combine in `applyListFilters()` rather than replacing
one another. Its "No category" segment is offered only while something is in it —
on a fully triaged list a permanent `0` reads as a bug rather than as good news.
`setCategoryFilter()` is the single setter, so the Insights cards can deep-link
into a filtered list without duplicating the repaint order.

### Insights dashboard (`#insights-view`)
A **third sibling pane**, routed at `#/insights`. Not a panel inside
`#detail-view`: that pane's display is the app's only truthful "an IR is open" flag
(`#ir-activity` is pinned inside it), and on desktop the dashboard keeps the IR list
beside it — the mobile back button is `display:none` there, so hiding the list
would strand the user. Visible to every signed-in user: it only counts rows the IR
list already shows them.

Filters (FY April–March, Month, Status, Category, Customer, Drone SN) over a card
per category with its count, the REPAIR sub-category breakout with the OTHERS notes
verbatim, and the four-bucket status mix. Clicking a card sets the list filter and
opens the IR list.

**Month filters independently of FY** — `month` narrows across every year and `fy`
across every month; both set is their intersection. All client-side over `allIRs` +
`irState`; no new endpoint. `insightsSummary()` is pure, and `renderInsights()` is
synchronous, idempotent and safe with an empty list, which is what lets four callers
(`setAllIRs`, `loadIRState`, `refreshIRList`, `showInsights`) use it with no
sequence token. With `allIRs` empty it re-emits `INSIGHTS_SKELETON` — the pane's own
static markup, because the first frame happens before `fetchIRs()` is even called —
rather than a dashboard of zeroes, which is not "loading" but the wrong answer.

**It counts, and nothing else.** The Inspector, the corrections ledger and I-PASSBOOK
POSTMAN used to sit under the stat row; they were moved to Setup (below) on the
owner's ruling, 2026-10-21: *"Insights is simply for someone to take info from stats,
not for all this. This is a setup and configurational work."* The 12-month graph opens
into a month-by-month `<details>` table that reads the same `monthCounts()` output, so
the picture and the numbers cannot drift.

### Setup (`#setup-view`)
The configuration pane, routed at `#/setup`, a fourth read-only sibling. `renderSetup()`
carries what `renderInsights()` gave up: I-INSPECTOR's findings (bad serials, unnamed
mailboxes, off-fleet equipment, spellings auto-merged, serials auto-corrected), the
per-IR "give one IR its reporter" box, the collapsed correction ledger
(`<details>`, closed by default — *"why can't it be made a tab to be opened when
needed"*), and the POSTMAN strip with the Send and preview controls.

The two panes share ONE click listener (`onPaneClick`) rather than two copies, and the
same visibility gate: `renderSetup()` returns at once unless `currentView === 'setup'`,
so the Inspector's freshness is maintained by calling it beside every
`renderInsights()` refresh site (`setAllIRs`, the overlay-apply path, the legacy-stub
path) without ever painting a hidden pane. `renderLayout()` owns `#setup-view`'s
`display` and the `view-setup` body class like every other pane.

### Status pills (`.badge`) and priority (`.prio`)
| Class | Category | Statuses mapped to it |
|---|---|---|
| `.badge-open` (blue) | Open — clock running | Open, Inward, Visual Inspection, QC Investigation, Production, QC, Flight Test, PDI, Approval, Remote Support |
| `.badge-pending` (amber) | Paused — clock suspended | Hold |
| `.badge-resolved` (green) | Resolved — clock stopped | Delivered |
| `.badge-closed` (grey) | Closed | Close, Other |
| `.badge-legacy` (violet) | Legacy workbook record | — |

The mapping lives in `STATUS_CATEGORIES` in `app.js`. The 14 status *values* are
written by the customer Google Form and are never renamed. The category map
replaced an older `getBadgeClass()` that painted everything except Open/Hold grey,
so Inward, Production, PDI and Flight Test all *looked* finished.

Priority (`.prio-low|medium|high|urgent`) renders only when the IR carries a
`priority` value — the Google Form has no Priority column yet. Adding one is
enough; no code change is needed.

### Section tabs (`.tabs-container` / `.tab`)
Horizontally scrollable, `scroll-snap-type: x mandatory`, sticky under the header
via `--header-h`. **Eight** tabs: the read-only **📋 Report** tab first (marked
`data-intake="1"`), then the seven workflow sections (**A–G**). `app.js` binds one
listener to the seven static section `.tab` nodes. `sec-b` is the default selection.
The retired `sec-a`/`sec-h`/`sec-i` have **neither** a tab nor a pane — the OLD
Section A is the Overview panel, which sits above this strip and is deliberately not
part of it (see below). ⚠️ "Section A" is the **inward checklist** now (`sec-b`); only
the *old* Section A is the Overview.

Three things about this strip are load-bearing:

- `applySectionAccessGating` falls back to the first visible tab with
  `.tab:not([style*="display: none"]):not([data-intake])`. The intake tab is
  **never hidden**, so without that `:not([data-intake])` it would have swallowed
  the fallback for every restricted user and silently defaulted them onto a
  read-only screen.
- `renderLayout()` writes inline `display` on the panes, and the gating code reads
  those inline values back. See *App shell* above.

A third is about being able to **read** the strip. Eight tabs are wider than a phone
screen, so `showSection()` scrolls the tab it just activated into the strip's own view —
`inline: 'start'`, because the strip's CSS already says `scroll-snap-align: start` and
`'nearest'` scrolls the minimum, which on a 390px screen leaves a wide tab like *"B:
Visual Inspection"* showing only its first few letters. This matters because one of
`showSection`'s two callers selects a section **nobody pressed**:
`applySectionAccessGating` moves a person off a tab their category has just switched
off. Without the scroll, the tab lights up outside the window while the strip goes on
showing its neighbours — the section is right, and nothing on screen says which one it
is. `block: 'nearest'` cannot move the page, because the strip is `position: sticky` and
so is always in view vertically. Pinned in `smoke-workflow.mjs`; a source-text suite
could never see it, since it exists only in a laid-out browser.

### Overview panel (`#ir-overview`) — what was Section A
Pinned **above** the tab strip, so it is always visible and always one click from a
save. It is **not a section**: `id="ir-overview"`, not `class="section-content"`,
and outside `#sections-wrapper`. Each of those three is load-bearing — the pane
regexes key on `sec-`, the tab handler removes `active` from every
`.section-content` and re-adds it only to the clicked pane (so a panel carrying that
class would vanish on the first tab click), and the wrapper's delegated listeners
drive `saveDraft` (so being outside it excludes the Overview from drafting
structurally — intended, because the panel is always visible and a draft would add
nothing).

| Class | Role |
|---|---|
| `.overview-panel` | The outer card |
| `.overview-head` / `.overview-title` | Title row, with `#save-overview` |
| `.overview-facts` | Compact read-only fact strip: IR number, drone serial, date raised, company, respondent, issue type, plus a `Full report →` link that activates the 📋 Report tab |
| `#ir-overview-editable` | The two writable fields — `a_crmOwner`, `a_contactPhone` |
| `#ir-timeline` | The automated activity timeline |
| `#ir-legacy-log` | The legacy hand-typed log, read-only, labelled `Legacy` |

**Ten fields would have been wrong.** The two long textareas (`a_issueDesc`,
`a_incidentLocationWeather`) are deliberately **not** pinned here: ten fields above
the tabs pushes the strip a screen down on a phone, and they already sit
immediately left on the Report tab. That is also why the fact strip and the Report
tab **intentionally duplicate** the short facts — do not "dedupe" them. The strip is
a glance; the Report tab is the record.

The legacy log renders the existing four-column grid with `<span>`s instead of
`<input>`s (`.activity-table-row.is-readonly`), plus a `.legacy-tag` styled like
`.hist-field`. It is **not** merged into the timeline: it has no per-row timestamp,
so folding it in would mean inventing when things happened.

`saveOverview()` posts `sectionId: 'sec-a'` through the **existing** `saveSection`
action — no new endpoint, one ACL branch, one upsert, one audit path — and the
backend's locked-intake strip is what keeps it from writing a divergent copy of the
customer's report. Gated on **`canTriage()`**; see the Triage modal above.

### Activity log (`#ir-activity` → `#ir-timeline`, and `#history-list`)
One pure function, two places. `buildTimeline(irNumber, auditEntries, nudgeItems, limit)`
does no fetch, no DOM and no clock, so a suite can drive it with fixtures — and so
the activity panel and the 🕓 History modal can never tell different stories. The
modal is a thin shell (fetch → build → render, `limit: 400`); the panel calls the
same renderer with `ACTIVITY_LIMIT` (40).

**The panel sits BELOW every section**, inside `#detail-view` and outside
`#sections-wrapper` — it used to live in the Overview, where it was the longest
block on the page and pushed the sections a user came for off-screen. Three
structural rules follow from that placement, and all three are load-bearing:

1. It is **not** `sec-*`, and carries **no** `class="section-content"` — the tab
   handler clears `.active` from every `.section-content`, so either would make it
   disappear the first time somebody clicked a tab.
2. It is **outside `#sections-wrapper`**, which excludes it from that wrapper's
   delegated input/change listeners (they drive `saveDraft`; the log has nothing to
   draft).
3. It is **inside `#detail-view`**, so `#detail-view`'s inline `display` stays a
   truthful "is an IR open" flag — `applyAccessGating` reads exactly that.

**Collapsed by default, and the fold is a CLASS, not inline `display`.** `docs/06`
reserves inline `display` for panes (see the note under Section tabs), and
`applySectionAccessGating` selects `.tab:not([style*="display: none"])`. So:

```css
.activity-body { display: none; }
#ir-activity.is-open .activity-body { display: block; }
```

`applyActivityState(open)` toggles `is-open` on the panel **and** `aria-expanded` on
`#ir-activity-toggle` together — they are one state, so they are set in one place.
`toggleActivity()` flips the remembered preference (`localStorage['activity']`, the
`THEME_KEY` pattern: a module-level `*_KEY` const, accessors in `try/catch /* non-fatal */`).
The whole header row is the toggle, so the hit area is the full width.

> ⚠️ **The list renders while collapsed.** `refreshActivityLog()` is never gated on
> `is-open`, so the header count is always truthful. It builds the whole timeline and
> slices it here rather than passing a limit to `buildTimeline`, so the count can
> report the true total — `40 of 128`, not a bare `40`.

| Source | Condition | Kind |
|---|---|---|
| audit, section | `saved` with no field | `save` |
| audit, section | `added` / `changed` / `removed` | `add` / `edit` / `remove` |
| audit, section | `event: 'reverted'` | `revert` — "Put back", with its own Was/Now body |
| audit, workflow | field `status` / `assignee`,`assigneeName` / `priority` / `type` | `status` / `assign` / `priority` / `type` |
| audit, any | `event: 'uploaded'` | `upload` |
| audit, any | `event: 'archived'` / `'restored'` | `archived` / `restored` |
| comment | a nudge item matching this IR | `comment` |

`renderTimelineInto(el, timeline, opts)` reuses the `.hist-*` classes unchanged —
all token-based, so the design-system rule holds. Rows carry an icon from
`ICON_PATHS` (below) and read in plain English: `Was` / `Now` rather than `old:` /
`new:`, one timestamp format for both halves of the list, and the backend's internal
`workflow` vocabulary never shown.

**`buildTimeline` takes a fourth source, and it is the only one the app does not
own.** `emailMessages` is the ticket's own correspondence, read from the email
crawl's `Email_Index` tab in the *intake* spreadsheet (see `listIRThreads` in
[04](04 - Backend API Reference.md)) — a table written by a script outside this repo
that nothing in the app can edit. It is a **fifth, optional parameter**, appended
rather than inserted so the four existing call sites keep working untouched, and its
rows merge into the **same** list as the audit rows because an email and a section
save are one story about one ticket. A separate panel would be a second history to
keep in step with the first.

Three deliberate restraints in how those rows render:

- **A mail gets its own kind, glyph and label** (`email` → `mail` → "Email") rather
  than borrowing `comment`. The three sit in one list, and a customer's mail must be
  tellable from a colleague's comment at a glance. The envelope is a fourth picture
  rather than a reuse of `comment`'s balloon or `inbox`'s tray, which already means
  the empty state — the one thing a merged timeline cannot afford is a glyph that
  means two things.
- **The `Direction` value is printed raw**, whatever the sheet says. It is not known
  whether that column holds `IN`/`OUT`, `in`/`out` or `Inbound`/`Outbound`, and mapping
  it onto a vocabulary this file invented would put a confident wrong word on every
  row. It is a **chip**, not body text, because an inbound mail and one we sent are
  otherwise identical rows.
- **The mailbox rides the by-line**, abbreviated to its local part. That is not
  decoration: a mail delivered to both mailboxes is written **twice**, once per
  `Mailbox`, and without the mailbox those two rows read as a rendering bug.

An unparseable `Date` yields `at: 0` and sinks the row to the bottom of the
newest-first list. That is the recoverable failure; dating it "today" and floating it
to the top would not be.

### The per-field 🕓 button, and the restore row it leads to
Every field's label carries a small 🕓 beside the 💬 comment button
(`.field-hist-btn`, in `components.css` next to `.field-nudge-btn`: float right,
`--text-xs`, transparent border, `.icon` at 14px). It is rendered by `buildField`
and by the Overview's two hand-rendered fields, and it is on the **same** view-only
whitelist as `.field-nudge-btn` and `.sec-export-btn` — reading the history is a view
act, and `applySectionAccessGating` DEFAULT-DISABLES every control inside a pane, so
anything not named there dies for a view-only user. On a phone it gets a hit-area
pseudo-element like the nudge chip does, so a 14px glyph still meets the 40px target.

The restore row lives in the field-history modal only (`.hist-restore-row`,
`.hist-restore-btn`, `.hist-restore-note` — in `views.css`'s history block, **never**
after the polish block, which must stay last to keep winning):
a full-width `inline-flex` button whose label is `Put back <value>`, with
`word-break: break-word` and `max-width: 100%` because the value it names is up to
200 displayed characters of stored data. When a value is a candidate but cannot be
put back, the row is a **note** instead — the explanation in italics, not a disabled
button.

> ⚠️ **Timestamps are parsed explicitly, never with `Date.parse`.** The backend
> stamps `'dd-MMM-yyyy HH:mm:ss'`, and `Date.parse` returns **`NaN`** for that shape
> in V8 — which would not throw, it would silently sort the entire timeline by
> nothing. `parseAuditTimestamp()` handles the shape directly. `SUPPRESSED_AUDIT_FIELDS`
> also drops `done` deltas (the renderer is the belt to the backend's braces,
> because rows written before the backend changed are still in the log).

### Icons — `ICON_PATHS` / `iconSvg(name, extraClass?)`
There is **no icon font, no sprite, and no `.svg` asset**. Every icon in the app is
one inline `<svg>` from a single map, because the service worker caches a fixed
`SHELL` list: a new asset file would need a `SHELL` entry *and* a `CACHE_NAME` bump,
whereas inline markup costs the cache nothing and stays offline-correct.

```js
iconSvg('comment')  // → '<svg class="icon" viewBox="0 0 24 24" …>…</svg>'
iconSvg('nope')     // → ''
```

All bodies are on one 24×24 grid at `stroke-width="1.75"`, `fill="none"`,
`stroke="currentColor"` — so an icon is always its row's text colour and needs no
token for either theme. The `.icon` rule in `base.css` owns the sizing (`1em`).

> ⚠️ **`iconSvg` returns `''` for an unknown name, never `'undefined'`, and never
> interpolates its argument.** That is what makes the unescaped `${iconSvg(…)}` in
> `renderTimelineInto` injection-safe. The cost is that a **typo is silent**: a call
> site asking for a name the map does not have renders a blank button with no error.
> Two tests exist for exactly that — `smoke-ui.mjs` cross-checks every referenced
> name against `ICON_PATHS` (in both directions, so a dead entry fails too), and
> `smoke-boot.mjs` asserts that every icon slot in the **rendered** page is filled.
> Add a name to the map before you reference it.

Slots in `index.html` are **empty spans** (`<span class="nav-icon">`), filled by
`initIcons()`; each is guarded by `!el.querySelector('svg')` so a re-login (which
re-runs `showApp`) is a no-op instead of stacking a second icon. There is no theme
glyph any more: the old sidebar-foot toggle that needed one is gone, and the theme
and palette rows in the user menu show their state with `aria-checked` and a check
mark rather than an icon.

### Collapsible chrome (`#sidebar-toggle`, `#list-toggle`)
Both mirror Gmail: the sidebar folds to an icon rail, and the IR list folds away.
The state lives in `localStorage` (`'rail'`, `'list'`) and **survives every
re-render** — `renderIRList()` replaces `irList.innerHTML` wholesale on each
keystroke, so no fold state may live inside the list.

- **Rail** — `document.documentElement` gets `html.rail-collapsed`, and every rule
  that acts on it sits inside `@media (min-width: 1024px)`, because under 1024px the
  sidebar is the bottom bar (<1024px mode) and shares none of its layout. The toggle
  is hidden at that width.
- **List** — the fold is decided **inside `renderLayout()`**, not by a stylesheet
  rule, because an inline `display` beats any rule and `renderLayout` is the one
  place allowed to write it:

  ```js
  const listHidden = detail ? true : (full && !desktop);
  indexView.style.display = listHidden ? 'none' : 'flex';
  ```

  Two clauses, and they are two different reasons. `detail ? true` is 2026-10-13: an open
  ticket takes the whole row **on every width**, because *"I want to eliminate fully the idea
  of having IR open in right small panel."* The `full && !desktop` half is the older rule — on
  a phone the dashboard, analyser and FAQ are separate full screens, so each of them hides the
  list there and keeps it beside them on a desktop. A user can therefore never fold themselves
  onto an empty index screen, and neither clause is a second flag.

  The back arrow reads the **same predicate** —
  `backBtn.style.display = listHidden ? 'block' : 'none'` — because whatever hides the list is
  what reveals the way back. ⚠ `base.css` used to carry `#back-btn { display: none !important; }`
  in its ≥1024px block, on the reasoning that desktop never leaves the list. That stopped being
  true for a ticket, and `!important` outranks the inline style written here, so the rule was
  removed rather than re-scoped.

`applyChromeState()` sets both from storage and re-runs `renderLayout()` rather than
duplicating the rule; `showApp()` calls it once, before the first paint.

### Section export row — `.sec-export-row`
Every section A–G ends with two buttons under Save: **⬇ Download**
(`#download-sec-<x>`) and **⬇ Download and share** (`#share-sec-<x>`). Both build the
section as a real PDF file; the second hands it to the device share sheet. See
`docs/03` → *Per-section export* for what goes into the document.

```css
.sec-export-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
.sec-export-row .btn { flex: 0 1 auto; }
```

Both buttons also carry `.sec-export-btn`, which is **not** cosmetic: a view-only
user's pane disables every `input, textarea, select, button` in it, and this class is
what exempts the two export buttons from that sweep. Exporting is a read, so a viewer
may download and share while still being unable to save. The wiring in `app.js` and
the exemption in the gating loop name the same class, so renaming one without the
other would leave a viewer with a dead button.

### Digital signatures — removed
`esignature` fields, `renderESignatureHTML`, `signSectionOnSave`, `esignatureState`
and the `.esignature-*` rules are all **gone**. The provision for digital signatures
was withdrawn, so a section is no longer stamped with whoever pressed Save. Saved
signature values in `_store/` are left untouched — they simply stop being rendered, and
each key is dropped the next time that section is saved (`store[sectionId] = fields`).

This is also why the old "kept, not deleted" note about `d_signQcManager` no longer
applies: D's export used to print an "Investigation Authorised" line from it, and that
whole download was replaced by the per-section export above.

### Client's Report (`#sec-intake`, the Report tab)
The read-only intake view: every column the customer's Google Form actually
wrote, unedited, so staff stop opening the Sheet to see what the client said.
Built by `renderIntake()` into `#sec-intake-body`.

| Class | Role |
|---|---|
| `.intake-head` | Title row holding the `.intake-open` link out to Col A |
| `.intake-open` | "Open original report ↗" — the Sheet's Summary document |
| `.intake-note` | The standing "the app never edits these values" reassurance |
| `.intake-list` / `.intake-row` | One ingested field per row; single column on phones, `grid-template-columns: 11rem 1fr` at ≥640px |
| `.intake-row-wide` | Long-text rows, which stay single-column at every width |
| `.intake-label` / `.intake-value` | The two columns |
| `.intake-empty` | Em-dash for a blank cell |
| `.intake-link` / `.intake-plain` / `.intake-ev` / `.intake-ev-icon` | Evidence URLs as labelled anchors (non-URL tokens fall back to plain text) |
| `.intake-extras` / `.intake-extras-head` | "Other columns from the Sheet" — columns the app doesn't model |
| `.intake-audit` | Names headers seen but not recognised, so a Form change is visible rather than silent |

**It is read-only, and it contains no form control at all** — asserted by both
`tools/smoke-intake.mjs` and `tools/smoke-boot.mjs`. It renders from
`currentIR.intake` (the raw cells), never from the editable section forms, so
there is no path by which a re-save could write these values back into the
ticket's store file. Every value is escaped with `escHtml` — the description, company name
and location are free text typed by the customer.

### Buttons (`.btn`)
Neutral solid by default (`--surface-gray-10`, which is near-black in light and
near-white in dark). Variants: `.btn-secondary` (outline), `.btn-primary` (**the
accent** — `--btn-solid-bg`, so it follows the chosen palette), `.btn-danger`,
`.btn-lg`, `.btn-sm`, `.btn-inline`. Async states: `.saving`
(amber), `.saved` (green), `.error` (red) — all three are applied by
`className` assignment in `app.js`, so their rules must not be removed by a
grep-based dead-CSS sweep.

### Form controls
`.form-group` · `.form-label` · `.form-input` (32px, `--surface-gray-2`, focus →
`--outline-gray-4` + `--focus-default`) · `select.form-input` (CSS-drawn chevron) ·
`.field-locked` / `.field-lock-icon` / `.field-locked-label` (locked intake fields,
still used by the Overview's fact strip) · `.checklist-row` ·
`.file-upload-wrapper` / `.photo-thumb`.

### Section tables
`.activity-table-*`, `.cost-table-*`, `.inward-table-*`, `.iqc-*`,
`.crosscheck-table`. The activity, cost and IQC rows restack into single-column
grid areas below 640px rather than scrolling horizontally.

`.activity-table-*` survives the retirement of the editable activity log: the table
machinery (the row builder, `addActivityRow`, the collect path and the
`.btn-add-row`) is **gone**, but the grid is still what renders the **legacy log**
in the Overview — as `.activity-table-row.is-readonly`, with `<span>`s where the
inputs were. Keep the header/row grid and its `@media (max-width: 639px)` restack;
the `.activity-table-row .form-input` and `.act-*` rules were deleted with the
inputs.

### Dropdowns and modals
`#user-menu` (`--z-dropdown`), `.nudge-panel`, `.inward-options-modal`
(`--z-overlay`), `.access-card`. Every modal is appended to `document.body` and
relies on fixed positioning — do not re-parent one into an ancestor with a
`transform` or `overflow`. Z-index now comes from the `--z-*` scale; the old
stylesheet had `#user-menu` and `.inward-options-modal` colliding at `200`.

### The backup-health line — three states, and unknown is not fine

One line at the top of User Access → **Versions**:
`.access-backup`, with `.access-backup-when` for the timestamp and
`.access-backup-ok` / `.access-backup-bad` for the colour. It is the only place in the
app where the state of the safety net is visible, and the state that matters is the
third one:

| State | What it looks like |
|---|---|
| checking | `Checking…` — the request is in flight |
| healthy | `✓ Last backup: <when> (<how long ago>)`, in green, with the counts and a link to the backup Sheet |
| failed | `⚠ Last backup: …` in red, with the run's own message |
| **unknown** | `⚠ Backup status unknown — <why>` in **the same red**, plus a sentence saying this says nothing about the backups, only that this device could not ask |

**Unknown must never render as healthy.** The tempting shortcut is to treat a failed
request as "no news", which turns an unreadable status into a reassurance — the exact
inversion a backup screen exists to prevent. `smoke-ui.mjs` pins all four states,
including that the unknown branch contains no `✓` anywhere.

The line repaints **only if the Versions tab is still the one open** when the answer
arrives (`settle()` re-checks `accessTab`), so a slow reply cannot overwrite whatever
the admin has since moved to. It is fetched on the **first open of the Versions tab**,
not with the modal, because it is an admin-only request that the other three tabs have
no use for.

> The tab strip had a bug worth remembering: it set `accessTab`, re-highlighted the
> tabs, and **never re-rendered the panel**. Every tab but the one the modal opened on
> looked broken. No snapshot assertion could have caught it — a missing call is not a
> wrong value — which is why `smoke-ui.mjs` now asserts that the click handler calls
> `renderAccessPanel()`.

### The Legacy record card — read-only, from the backend
The 🏛 Legacy button no longer embeds the workbook, and never will again: the file is
**restricted** (2 October 2026), which is what closed the leak — embedding a tab forced
the whole file to stay link-shared, and link-sharing is per file, not per tab. The
records come back through the token-gated backend instead.

- **The 🏛 Legacy button opens an INDEX** (`openLegacyWorkbook`) — the tab names from
  `listLegacyIRs`, each row (`.legacy-index-item`) a tap away, with the label
  ellipsised so a long tab name cannot push the row wide.
- **Opening a record** (`openLegacyRecord`) fetches one tab (`getLegacyIR`) and paints
  `.legacy-loading` (a `.legacy-spinner` plus a `role="status" aria-live="polite"`
  note) until it lands. The read is abandoned after 12s rather than spinning forever.
- **The grid is rendered as label/value ROWS, never a `<table>`.** `.legacy-row` stacks
  `.legacy-label` over `.legacy-value`; a row with a single filled cell becomes
  `.legacy-row-head` (a heading), and a row with none is a spacer and is dropped. A
  legacy tab is wide, and a phone answers a table with sideways scrolling — the exact
  thing this app refuses to ask of someone reading.
- `.legacy-card-record` sizes to its content (`max-height: 92vh`, `max-width: 720px`)
  and `.legacy-record` scrolls inside it; there is no frame holding the card open.
- **The dead iframe machinery is deleted**, not left dark: `openLegacyModal`,
  `legacyTick`, `_legacyLoaded` and `LEGACY_SLOW_MS` are gone, and `listLegacyIRs` no
  longer hands out an `embedUrl`. `smoke-ui.mjs` asserts no `<iframe>` and no embed URL
  survives in `app.js`, and `smoke-list-intel.mjs` fails if a public read path — a
  `gviz` CSV fetch or a `docs.google.com/spreadsheets/d/…` address — ever returns.

### Toast (`#toast`)
Bottom-centre, `--z-toast`, above the phone bottom bar. `app.js` toggles the `.show`
class rather than writing a transform inline, and writes the message into
`#toast-text` — never over it — because `#toast-text { pointer-events: none }` is
what lets the tap through to the pill that listens for it.

**One message, not a queue.** It used to queue: 3 seconds per message plus 300ms
between, and one save enqueued two (the success line, plus "Saved locally — backend
unreachable" whenever the sentinel write failed). A save could hold the screen for
over six seconds, and with `pointer-events: none` there was nothing the user could
do about it. Now a newer message **replaces** the old one and restarts the clock
(`TOAST_MS`, 2.5s), the timer handle is kept so a hand dismissal cancels it, and
the pill is **tappable to dismiss**. The old `_toastBusy` latch is gone: it was
cleared only by a timer reaching the end of the queue, so one throw in between
meant no toast could ever be shown again and the last one stayed up for good.

## Responsive Breakpoints

Frappe's own scale, adopted wholesale:

| Width | Layout |
|---|---|
| < 640px | Phone. Tables restack; bottom nav. |
| 640–1023px | Tablet. Two-column tables; bottom nav. |
| ≥ 1024px | Desktop. Sidebar + split pane. |
| ≥ 1440px | Wider list column (`--list-w: 440px`). |

The old stylesheet used `640 max` / `600 min` / `1000 min` / `599 max`, whose
600–640px band applied both rule sets at once. That overlap is gone.
