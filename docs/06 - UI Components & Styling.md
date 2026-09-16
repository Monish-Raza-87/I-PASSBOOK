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
grid of `.triage-row` label/control pairs: Status, Assigned to, Priority, Type.
`TICKET_PRIORITIES` and `TICKET_TYPES` are app-owned — the customer Form has
neither column. Status options come from the single `IR_STATUS_VALUES` list, so
the modal and the banner pill can never drift apart. Gated on **`canTriage()`**,
which is a **separate axis from the section grants**: CR and Management hold it
while editing no section at all, and a department that edits Section C does not
thereby get it. It replaced a `canEditSection('sec-a')` read when Section A stopped
being a section — the audience is unchanged, plus Management.

### Filter segments (`.segments` / `.segment`)
Frappe's All / Open / Paused / Resolved / Closed strip with live counts. Each
segment maps to a **status category**, not a status value — see below.

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

### Automated timeline (`#ir-timeline` and `#history-list`)
One pure function, two places. `buildTimeline(irNumber, auditEntries, nudgeItems, limit)`
does no fetch, no DOM and no clock, so a suite can drive it with fixtures — and so
the Overview panel and the 🕓 History modal can never tell different stories. The
modal is a thin shell (fetch → build → render, `limit: 400`); the Overview calls the
same renderer with `limit: 40`.

| Source | Condition | Kind |
|---|---|---|
| audit, section | `saved` with no field | `save` |
| audit, section | `added` / `changed` / `removed` | `add` / `edit` / `remove` |
| audit, workflow | field `status` / `assignee`,`assigneeName` / `priority` / `type` | `status` / `assign` / `priority` / `type` |
| audit, any | `event: 'uploaded'` | `upload` |
| comment | a nudge item matching this IR | `comment` (chip `@mention` when it has mentions) |

`renderTimelineInto(el, timeline, opts)` reuses the `.hist-*` classes unchanged —
all token-based, so the design-system rule holds. Exactly two additions:
`#ir-timeline .hist-list { max-height: 48vh }` (the modal's 64vh is wrong inline)
and a `.hist-src` chip marking which half an entry came from.

> ⚠️ **Timestamps are parsed explicitly, never with `Date.parse`.** The backend
> stamps `'dd-MMM-yyyy HH:mm:ss'`, and `Date.parse` returns **`NaN`** for that shape
> in V8 — which would not throw, it would silently sort the entire timeline by
> nothing. `parseAuditTimestamp()` handles the shape directly. `SUPPRESSED_AUDIT_FIELDS`
> also drops `done` deltas (the renderer is the belt to the backend's braces,
> because rows written before the backend changed are still in the log).

### Client's Report (`#sec-intake`, the 📋 tab)
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
there is no path by which a re-save could write these values back into
`APP_DATA`. Every value is escaped with `escHtml` — the description, company name
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
