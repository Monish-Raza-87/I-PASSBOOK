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

**The mark is drawn from a height with `width: auto`, and it is inverted** — and both
halves of that were a real defect, not a preference. The owner's second look reported
*"the logo/icon used is not the correct one with proper background etc, it has unclear
things in the logo."* The artwork is a **4:3 lockup** (`512×384`: the disc, then
"Passbook" beside it), so `.sso-wait-mark` forcing `width: 56px; height: 56px` squashed
it — the same reason `.auth-logo` and `.brand-mark` have always sized the mark off a
height. And the disc is a dark slate (`#323943`) on a permanently `#0b0b0b` screen, so
without `filter: invert(1)` the disc vanished into the ground and only the knocked-out
white pieces showed, which reads as a logo full of holes. That is the same treatment,
for the same reason, as the dark theme's own `[data-theme="dark"] .auth-logo`. Both
were confirmed by decoding the PNG and compositing it on `#0b0b0b` both ways, not by
guessing — and `smoke-ui.mjs` now pins the height, the `width: auto`, the absence of a
pixel width, and the invert.

### Auth card (`.glass-card`)
Flat `--surface-elevation-1` card with `--outline-gray-1` hairline and
`--elevation-lg`. No backdrop blur — the light-mode glass cluster is what blocked
light mode before, and `--surface-alpha-*` is the replacement where layering is
genuinely needed.

### Ticket list (`#index-view`)
`.list-toolbar` (title, count, search, filter segments) over `.ir-list`. Rows are
`.ir-card` — flat with dividers rather than floating cards, which holds up better
at 400 rows. `.ir-card.is-selected` marks the row open in the split pane.

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
which is a **separate axis from the section grants**: CR and Management hold it
while editing no section at all, and a department that edits Section C does not
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
via `--header-h`. **Seven** tabs: the read-only **📋 Report** tab first (marked
`data-intake="1"`), then the six workflow sections (**B–G**). `app.js` binds one
listener to the six static section `.tab` nodes. `sec-b` is the default selection.
The retired `sec-a`/`sec-h`/`sec-i` have **neither** a tab nor a pane — old Section
A is the Overview panel, which sits above this strip and is deliberately not part
of it (see below).

Two things about this strip are load-bearing:

- `applySectionAccessGating` falls back to the first visible tab with
  `.tab:not([style*="display: none"]):not([data-intake])`. The intake tab is
  **never hidden**, so without that `:not([data-intake])` it would have swallowed
  the fallback for every restricted user and silently defaulted them onto a
  read-only screen.
- `renderLayout()` writes inline `display` on the panes, and the gating code reads
  those inline values back. See *App shell* above.

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
  const listHidden = detail && (!desktop || storedFlag(LIST_KEY));
  indexView.style.display = listHidden ? 'none' : 'flex';
  ```

  The `detail &&` guard is the point: on desktop the list hides **only** while a
  detail pane is open and the user asked for the room, and on mobile the two are
  separate full screens so an open detail always hides the list. A user can
  therefore never fold themselves onto an empty index screen.

`applyChromeState()` sets both from storage and re-runs `renderLayout()` rather than
duplicating the rule; `showApp()` calls it once, before the first paint.

### Section export row — `.sec-export-row`
Every section B–G ends with two buttons under Save: **⬇ Download**
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

### The Legacy archive modal — a loading state, and one that is kept
The 🏛 Legacy button embeds the old ~450-tab workbook in an iframe. **The app makes
zero requests for it** — Google renders the whole workbook, which is why it is slow,
and why "make it faster" is not a code question here. What was missing was honesty
about the wait: previously a blank frame, with a "Can't see the record here?" note
*always* visible, so a slow load and a broken one looked identical.

- `.legacy-loading` (absolute, inset 0, over the frame) holds `.legacy-spinner` and
  a `role="status" aria-live="polite"` message, with a live **elapsed counter**
  (`.legacy-loading-elapsed`, `tabular-nums`) so the wait is visibly progressing.
- It is removed on the iframe's `load` event. `.legacy-fallback` ("Still not
  showing?") appears **only** after `LEGACY_SLOW_MS` (20s) has passed without a
  load, or if the load fails — never before.
- The iframe carries **no `loading="lazy"`**, deliberately: it must start loading
  when the modal opens, not when it scrolls into view.
- The loaded frame is **kept in the DOM** (`_legacyLoaded`) keyed by URL + label, so
  reopening the same archive after the first load is instant, and `closeLegacyModal`
  detaches rather than destroys it.

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
