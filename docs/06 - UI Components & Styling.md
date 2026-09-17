# 06 — UI Components & Styling

The stylesheet is four layered files, loaded in this order from `index.html`:

| File | Contents |
|---|---|
| `tokens.css` | **Generated.** Colour ramps (light + dark), radius, typography, elevation, focus rings, layout metrics, z-index scale, semantic aliases |
| `base.css` | Reset, typography helpers, keyframes, splash, auth, app shell (sidebar / header / panes), responsive breakpoints |
| `components.css` | Buttons, form controls, pills, search, dropdowns, modals, loading states |
| `views.css` | Ticket list, sync bar, ticket detail, the read-only intake report, the 9 section tables, comments / history / admin UI |

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
--surface-blue-1..10  --surface-green-*  --surface-red-*  --surface-amber-*  --surface-violet-*

/* text and icons — ramps stop at 9 */
--ink-base
--ink-gray-1..9
--ink-blue-link
--ink-blue-*  --ink-green-*  --ink-red-*  --ink-amber-*  --ink-violet-*

/* borders and dividers */
--outline-gray-1..9
--outline-elevation-1|2
--outline-blue-*  --outline-green-*  --outline-red-*  --outline-amber-*  --outline-violet-*

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
--accent: var(--ink-blue-link);
--btn-solid-bg: var(--surface-gray-10);   /* neutral, inverts in dark mode */
--st-open-bg/fg/bd  --st-paused-*  --st-resolved-*  --st-closed-*  --st-legacy-*  --st-danger-*
```

**Rule for new CSS: never a raw hex, never a px font size.** Use a token. The only
deliberate exception is the splash screen's fixed black (`#0b0b0b`, so the intro
video sits on neutral chrome). There is no second one: the captcha image backdrop
(`#f4f4f4`) went with the captcha, when sign-up was removed.

## Theming

- Preference is `'light' | 'dark' | 'system'`, stored in `localStorage` under `theme`.
- `'system'` (the default) follows `prefers-color-scheme` live.
- Dark is applied as `[data-theme="dark"]` on `<html>`; light removes the attribute.
- A tiny inline script in `<head>` applies the stored value **before first paint**,
  so a dark-mode device never flashes white.
- `applyTheme(true)` in `app.js` stamps `.no-transition` on `<html>` for two
  `requestAnimationFrame`s around a swap — without it every transitioning surface
  cross-fades at once and the swap reads as a flash.

## Key Components

### App shell
- **≥1024px** — `#sidebar` (232px: brand, nav, theme toggle) · `#workspace`
  (56px header, then `#panes`: list 400px + detail). `body.view-detail` reveals the
  detail pane; the list stays on screen, so ticket switching never leaves the page.
- **<1024px** — `#sidebar` becomes a fixed bottom bar (icons over labels, counts
  and the brand hidden), and list / detail are separate full screens.

`renderLayout()` in `app.js` is the only place that sets pane visibility, and it
must keep writing **inline** `display` values — `applyAccessGating` reads
`detailView.style.display`, and `applySectionAccessGating` selects
`.tab:not([style*="display: none"])`.

### Splash (`#splash-screen`)
Fixed overlay at `--z-splash`, Indrones intro video, neutral dark chrome, loader bar.

### Auth card (`.glass-card`)
Flat `--surface-elevation-1` card with `--outline-gray-1` hairline and
`--elevation-lg`. No backdrop blur — the light-mode glass cluster is what blocked
light mode before, and `--surface-alpha-*` is the replacement where layering is
genuinely needed.

### Ticket list (`#index-view`)
`.list-toolbar` (title, count, search, filter segments) over `.ir-list`. Rows are
`.ir-card` — flat with dividers rather than floating cards, which holds up better
at 400 rows. `.ir-card.is-selected` marks the row open in the split pane.

An `.ir-card` also carries the **assignee initials** badge (`.ir-assignee`, from
`__IRS__`) when the ticket has been triaged to someone.

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
| audit, workflow | field `status` / `assignee`,`assigneeName` / `priority` / `type` | `status` / `assign` / `priority` / `type` |
| audit, any | `event: 'uploaded'` | `upload` |
| comment | a nudge item matching this IR | `comment` |

`renderTimelineInto(el, timeline, opts)` reuses the `.hist-*` classes unchanged —
all token-based, so the design-system rule holds. Rows carry an icon from
`ICON_PATHS` (below) and read in plain English: `Was` / `Now` rather than `old:` /
`new:`, one timestamp format for both halves of the list, and the backend's internal
`workflow` vocabulary never shown.

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
re-runs `showApp`) is a no-op instead of stacking a second icon. `applyTheme()` owns
the theme glyph, since it is a state rather than a constant.

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
near-white in dark). Variants: `.btn-secondary` (outline), `.btn-primary` (blue),
`.btn-danger`, `.btn-lg`, `.btn-sm`, `.btn-inline`. Async states: `.saving`
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

### Toast (`#toast`)
Bottom-centre, `--z-toast`. `app.js` toggles the `.show` class rather than writing
a transform inline, and messages **queue** — back-to-back toasts used to overwrite
each other's text, and the first timer would hide the newer message early.

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
