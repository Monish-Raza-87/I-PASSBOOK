// Smoke test for the index.html ⇄ app.js DOM contract.
//
//   node tools/smoke-shell.mjs
//
// app.js runs as a plain end-of-body <script> and captures a set of element ids
// into top-level `const`s the moment it evaluates. Every one of those ids must
// exist in index.html at parse time, or the whole app fails to boot — silently,
// because there is no bundler and no type checker to catch it.
//
// This test derives the required ids FROM app.js rather than listing them, so it
// catches a rename on either side, and it pins the tab/pane shape that the
// Frappe pivot's routing and access-gating depend on.

import fs from 'node:fs';
import zlib from 'node:zlib';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const appJs = read('../app.js');
const html = read('../index.html');
const viewsCss = read('../views.css');
const i18nCode = read('../i18n.js');

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

// ── Every parse-time getElementById must resolve ──────────────────────────────
head('parse-time element ids');
const parseTimeIds = [...appJs.matchAll(/\nconst\s+(\w+)\s*=\s*document\.getElementById\(['"]([^'"]+)['"]\)/g)]
  .map(m => ({ name: m[1], id: m[2] }));

ok('app.js captures ids at parse time', parseTimeIds.length >= 12, parseTimeIds.length);

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const missing = parseTimeIds.filter(x => !htmlIds.has(x.id));
ok('every captured id exists in index.html', missing.length === 0, missing);

// ── The section strip ─────────────────────────────────────────────────────────
head('the section strip');
const tabs = [...html.matchAll(/<div class="tab[^"]*"([^>]*)>/g)].map(m => m[1]);
const tabSection = attr => (attr.match(/data-section="([^"]+)"/) || [])[1];
const tabIds = tabs.map(tabSection).filter(Boolean);
const sectionTabs = tabIds.filter(id => id !== 'sec-intake');

ok('exactly 6 section tabs', sectionTabs.length === 6, sectionTabs);
ok('the 📋 Report tab is present and marked data-intake',
  /data-section="sec-intake"[^>]*data-intake="1"/.test(html), tabs);
ok('the intake tab is first, so the report reads as the cover page',
  tabIds[0] === 'sec-intake', tabIds);
ok('the intake tab carries no section pane in SECTIONS\' shape (it is not savable)',
  !/\n\s*'sec-intake':/.test(appJs));
// The merged section letters are a hard contract: the owner's department mapping is
// written against B–G, so a letter drifting here silently mis-grants access.
ok('the letters are B–G in order, with no A/H/I',
  sectionTabs.join(',') === 'sec-b,sec-c,sec-d,sec-e,sec-f,sec-g', sectionTabs);

// The gating fallback must skip the intake tab or it would always win it: the
// intake pane is never hidden, so it is always "the first visible tab".
ok('the active-tab fallback excludes the intake tab',
  /querySelector\('\.tab:not\(\[style\*="display: none"\]\):not\(\[data-intake\]\)'\)/.test(appJs));

head('section panes');
const SECTION_IDS = (appJs.match(/const SECTION_IDS = \[([^\]]+)\]/) || [])[1];
const sectionIds = SECTION_IDS.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
ok('SECTION_IDS has 6 entries', sectionIds.length === 6, sectionIds);

const paneIds = [...html.matchAll(/<div id="(sec-[a-z]+)" class="section-content/g)].map(m => m[1]);
ok('every SECTION_ID has a pane', sectionIds.every(s => paneIds.includes(s)), { sectionIds, paneIds });
ok('every SECTION_ID has a tab', sectionIds.every(s => tabIds.includes(s)), { sectionIds, tabIds });
ok('the intake pane exists', paneIds.includes('sec-intake'), paneIds);
ok('panes are exactly the 6 sections + the intake view',
  paneIds.length === 7 && paneIds.filter(p => p !== 'sec-intake').length === 6, paneIds);

// ── The Overview panel ────────────────────────────────────────────────────────
// Three structural rules, each of which breaks the app in a way that is invisible
// to a visual check. See the comment block in index.html.
head('the Overview panel');
// Scope to the element's own opening tag. index.html explains these three rules in
// a comment directly above the div, and a page-wide regex matches the PROSE — the
// comments name the very strings being asserted against.
const ovTag = (html.match(/<div id="ir-overview"[^>]*>/) || [''])[0];
ok('the Overview panel exists', ovTag.length > 0, html.indexOf('ir-overview'));
ok('it is id="ir-overview", not sec-*', /id="ir-overview"/.test(ovTag) && !/\bid="sec-/.test(ovTag), ovTag);
ok('it is NOT class="section-content" — the tab handler would hide it forever',
  !/section-content/.test(ovTag), ovTag);
ok('it sits outside #sections-wrapper',
  html.indexOf('<div id="ir-overview"') < html.indexOf('id="sections-wrapper"'));
ok('it is not in SECTION_IDS and has no tab',
  !sectionIds.includes('sec-a') && !tabIds.includes('sec-a'));
ok('sec-a survives as a data key (the Overview\'s APP_DATA row)',
  /const OVERVIEW_KEY = 'sec-a'/.test(appJs));
ok('the legacy activity log renders read-only, never as inputs',
  /activity-table-row is-readonly/.test(appJs) && !/class="activity-table-row"[\s\S]{0,80}<input/.test(appJs));
ok('the retired activityTable machinery is gone, not merely unused', (() => {
  // Assert on the CODE, not the word: the comment left in populateFieldValue names
  // the retired type on purpose, so a bare /activityTable/ scan would fail on its own
  // explanation. A quoted literal is what a live branch would need.
  const code = appJs.replace(/^\s*\/\/.*$/gm, '');
  return !/'activityTable'/.test(code) && !/buildActivityRow|addActivityRow/.test(code);
})(), (appJs.replace(/^\s*\/\/.*$/gm, '').match(/activityTable|buildActivityRow|addActivityRow/g) || []));

// ── Contracts the pivot depends on ────────────────────────────────────────────
head('load-bearing contracts');
ok('app.js is a plain end-of-body script (no module/defer)',
  /<script src="app\.js"><\/script>/.test(html) && !/type="module"/.test(html));
ok('the intake pane is rendered by renderIntake(), never saved',
  /function renderIntake\(/.test(appJs) && /renderIntake\(\);/.test(appJs));
ok('saveDraft ignores non-SECTIONS panes',
  /if \(!SECTIONS\[sectionId\]\) return;/.test(appJs));
// palette.css sits between tokens.css and base.css and that position is
// load-bearing: it re-points the accent role (:root in tokens.css) onto a colour
// family, and every var(--accent) in base/components/views resolves against it.
// Before tokens.css it would be overridden; after base.css it would still win on
// specificity but leave the first paint accent-less. Hence an explicit order.
//
// Matched as `href="…"`, not as a bare filename: index.html's comment above the
// links names palette.css too, and a bare indexOf would find the prose first and
// happily report the wrong order.
// industrial.css is a deliberate sixth entry, and its position — LAST, after
// views.css — is what it depends on: it is the app's whole look, it wins over the
// `POLISH — level:` block at the end of views.css by cascade order alone, and it
// is scoped to eight named roots. Listing it here is what fails if someone
// reorders the links.
//
// theme.css is a seventh, and it sits between palette.css and base.css. It is
// token-only, so it has no position-dependent rule of its own — it is listed at
// all because a theme file that loads after base.css would leave the first paint
// on the wrong mode's values, which is the flash it exists to prevent.
const cascade = ['tokens.css', 'palette.css', 'theme.css', 'base.css', 'components.css', 'views.css', 'industrial.css']
  .map(f => html.indexOf(`href="${f}"`));
ok('the stylesheet cascade order is unchanged',
  cascade.every((v, i) => v >= 0 && (i === 0 || v > cascade[i - 1])), cascade);

head('new styles are token-only (no raw hex, no px font sizes)');
const intakeCss = (viewsCss.match(/\/\* ── Client's original report[\s\S]*?(?=\n\/\* ──|\Z)/) || [''])[0];
ok('intake styles present', intakeCss.includes('.intake-row'), intakeCss.slice(0, 120));
ok('no raw hex colours', !/#[0-9a-fA-F]{3,8}\b/.test(intakeCss), intakeCss.match(/#[0-9a-fA-F]{3,8}\b/g));
ok('no px font sizes', !/font-size:\s*[\d.]+px/.test(intakeCss), intakeCss.match(/font-size:\s*[\d.]+px/g));

// ── The irreversible action is two-step in the UI, not just in the backend ────
// purgeUsers deletes every non-admin account and cannot be undone. Its button used
// to delete on the first press and render a "backup" from the response — which is
// not a backup if the response never arrives. Now: press once to REVIEW, copy the
// list, press again to DELETE. Asserted here rather than only in the backend suite
// because a two-phase endpoint behind a one-phase button is still one-phase.
head('the purge button reviews before it deletes');
// Anchored to the enclosing function: from the purge button's listener to the
// column-0 `}` that closes the tab renderer. A fixed-length window would silently
// start passing on a truncated slice as soon as the handler grew.
const purgeAt = appJs.indexOf("getElementById('access-purge')");
const purgeEnd = purgeAt < 0 ? -1 : appJs.indexOf('\n}', purgeAt);
const purgeUI = purgeAt < 0 ? '' : appJs.slice(purgeAt, purgeEnd + 2);
ok('the purge handler is present', purgeUI.length > 500, purgeUI.length);
ok('the slice is the whole enclosing function, not a truncated window',
  purgeUI.trimEnd().endsWith('}') && (purgeUI.match(/adminPost\('purgeUsers'/g) || []).length === 2,
  { tail: purgeUI.trimEnd().slice(-60), calls: (purgeUI.match(/adminPost\('purgeUsers'/g) || []).length });
ok('the first call is a dry run', /dryRun: '1'/.test(purgeUI),
  (purgeUI.match(/dryRun[^\n]*/) || [''])[0]);
const posts = [...purgeUI.matchAll(/adminPost\('purgeUsers'[^)]*\)/g)].map(m => m[0]);
ok('there are exactly two purgeUsers calls (review, then delete)', posts.length === 2, posts);
ok('the dry run comes first, the real delete second',
  /dryRun/.test(posts[0] || '') && !/dryRun/.test(posts[1] || ''), posts);
ok('the delete pins the reviewed count, so a changed list is refused',
  /expect:/.test(posts[1] || ''), posts[1]);
ok('the list is rendered before the delete button exists',
  purgeUI.indexOf('readonly>') < purgeUI.indexOf('access-purge-go'),
  { list: purgeUI.indexOf('readonly>'), del: purgeUI.indexOf('access-purge-go') });
// The button must not promise deletion, or the first press reads as the last one.
// These two live in the tab markup, which is above the handler, so they are
// asserted against the whole file.
ok('the button says "Review", not "Delete"',
  /Review what will be deleted/.test(appJs) && !/Delete all non-admin accounts/.test(appJs),
  (appJs.match(/id="access-purge"[^>]*>[^<]*/) || [''])[0]);
// And the copy may not claim the rows are shown before they are removed unless the
// markup actually does that — the old copy claimed it while showing them after.
ok('the danger-zone copy describes the two steps',
  /It cannot be undone, so it happens in two steps/.test(appJs),
  (appJs.match(/[^>]*two steps[^<]*/) || [''])[0]);
ok('the old "shown below first" claim is gone',
  !/shown below first/.test(appJs), (appJs.match(/[^\n]*shown below[^\n]*/) || [''])[0]);

// ── The intro video ───────────────────────────────────────────────────────────
// The intro plays once per VERSION, in the brand panel, and is then skipped. The
// failure mode this guards is quiet: if the file 404s or the name changes, the panel
// simply RESTS — the still and the heartbeat are already on screen and the sign-in
// form is usable either way — so the app looks fine and just never shows the intro.
// Nothing else in the suite would notice.
head('the intro video');
const swJs = read('../sw.js');

const videoTag = (html.match(/<video id="brand-video"[\s\S]*?<\/video>/) || [''])[0];
ok('the brand panel video tag exists', videoTag.length > 0);

// ONE cut, ungated. The splash carried a second, portrait cut behind a
// `max-width: 639px` media query so a phone could pick a file it had room for. The
// panel is not drawn below 1024px at all, so that gate now selects for a case that
// never happens — a phone would have to download a 4 MB cut to play in a box that has
// no height. Both the gate and the file went with it.
const sources = [...videoTag.matchAll(/<source\s+src="[^"]+"[^>]*>/g)].map(m => m[0]);
ok('the panel offers one ungated cut of the intro', sources.length === 1, sources);
ok('...and it is not media-gated, because the width gate is now the panel itself',
  /assets\/brand-intro\.mp4/.test(sources[0] || '') && !/media=/.test(sources[0] || ''),
  sources);
ok('that cut exists on disk',
  fs.existsSync(new URL('../assets/brand-intro.mp4', import.meta.url)));
// …and the two the splash carried are GONE from the tree, asserted as an absence rather
// than merely un-asserted: dropped from SERVED they would linger on gh-pages forever,
// which is what deploy-ghpages.mjs's PRUNE list is for, and 14 MB of video nothing can
// request is 14 MB in every clone.
ok('the two splash cuts are gone from the tree',
  !fs.existsSync(new URL('../assets/intro_ipassbookv2.mp4', import.meta.url)) &&
  !fs.existsSync(new URL('../assets/intro_ipassbookv2_mobile.mp4', import.meta.url)));
ok('and no file still references the cut it replaced',
  !/Indrones Intro v2\.mp4/.test(html) && !/Indrones Intro v2\.mp4/.test(appJs));
// preload="none" + no autoplay is what stops a RETURNING user — and every phone, where
// the panel never plays it — downloading the intro. Either alone would fetch it.
ok('it is preloaded lazily and not autoplayed',
  /preload="none"/.test(videoTag) && !/\bautoplay\b/.test(videoTag),
  videoTag.replace(/\s+/g, ' '));
// Precaching it in SHELL would make EVERY first-time install pay the whole download
// before sign-in, which is the opposite of what lazy loading bought.
ok('the intro is not precached in the service worker shell',
  !/brand-intro/.test(swJs) && !/intro_ipassbookv2/.test(swJs));

// Nothing is drawn over the intro. A darkening layer with backdrop-filter: blur()
// used to sit on top of it — the owner saw the result as a blurry video — and the
// wordmark that sat on that layer moved to the sign-in card. Scoped to the panel block
// and the panel styles, because `backdrop-filter` is used legitimately elsewhere (the
// frosted headers, and the glass on the doors beside this panel).
//
// Both halves are sliced between NAMED markers rather than by counting closing tags: a
// boundary that silently turns into '' turns the test into a tautology. Keep the markers
// in index.html and base.css in step with these.
const panelBlock = (html.match(/<div class="auth-brand-panel"[\s\S]*?<header class="landing-head">/) || [''])[0];
ok('nothing is layered over the video',
  panelBlock.length > 0 &&
  !/splash-overlay|splash-logo|splash-sub|class="[^"]*overlay/.test(panelBlock),
  panelBlock.replace(/\s+/g, ' ').slice(0, 200));
const panelCss = (read('../base.css').match(/THE BRAND PANEL[\s\S]*?THE LANDING PAGE \(ONE HEAD, TWO DOORS\)/) || [''])[0];
ok('and no blur or darkening rule is left in the panel styles',
  panelCss.length > 0 &&
  !/backdrop-filter|splash-overlay|splash-logo|splash-sub/.test(panelCss));
// The common head, not either card, is where the full product name now lives — the
// owner asked for the mark and the name to be shared ABOVE the two doors rather than
// repeated inside each. Sliced between the head's own markers and bounded by the doors
// grid, so this is a claim about the head and cannot be satisfied by the same words
// turning up in a card later. It sits inside the brand panel now, which does not change
// any of that: the panel is above the doors in document order too.
const landingHead = (html.match(/<header class="landing-head">[\s\S]*?<div class="doors">/) || [''])[0];
ok('the product name moved to the common head, above both doors',
  // ⚠ THE FULL NAME, WITH "PRODUCT" IN IT. This assertion read
  // "INDRONES-AFTER SALES SERVICE BOOK" until 2026-10-09, and the owner caught it:
  // *"It should everywhere has PRODUCT in that."* The line under the wordmark is the
  // expansion of I-PASSBOOK, and an expansion that names I, A, S, S and B while dropping
  // the P is not an expansion. See smoke-i18n for the other half of the same claim.
  landingHead.length > 0 && /INDRONES PRODUCT AFTER SALES SERVICE BOOK/.test(landingHead),
  landingHead.replace(/\s+/g, ' ').slice(0, 160));
// ⚠ THE HEAD HAS HAD THREE STRAIGHTLINES, and the two that lost are asserted as GONE
// rather than merely un-asserted, because each of them was a sentence somebody once
// had a good reason for.
//
//   1. "Indrones Product After-Sales Summary Book" — the same information with the
//      mechanism thrown away.
//   2. "INDRONES FROM I · PRODUCT FROM P · AFTER FROM A · SALES FROM S · SUMMARY FROM
//      S · BOOK AS IT IS" — the owner's own expansion, one term per letter, drawn a
//      term at a time. It was replaced on 2026-10-08 by the PLAIN NAME, and his reason
//      was not that the expansion was wrong but that it was MOVING: *"the whole page
//      below it is increasing/decreasing its height … And line increasing/decreasing
//      should not happen."* A per-term animation re-laid-out the head on every term,
//      so the doors stepped up and down the page all the way through it.
//
// The check is on the head and on the language table's VALUE, not on the whole repo:
// i18n.js's comment quotes both old lines on purpose, and index.html's
// <meta name="description"> is a sentence for a search engine rather than a name on a
// screen.
ok('...and both superseded straplines are gone from the head and from the language table',
  !/Indrones Product After-Sales Summary Book/.test(landingHead) &&
  !/INDRONES FROM I/.test(landingHead) &&
  !/'app\.fullName':\s*'Indrones Product After-Sales Summary Book'/.test(read('../i18n.js')) &&
  !/'app\.fullName':\s*'INDRONES FROM I/.test(read('../i18n.js')));
// The line is now ONE STATIC STRING, and that is the fix for the page growing and
// shrinking: nothing can change its height at runtime, on any screen width. The
// per-term markup, its rules and its typing loop are gone from all three files — and
// a `.bt-term` left behind in the stylesheet would be exactly the kind of remnant that
// makes a deletion look like a bug.
ok('...and the per-term expansion is gone from the markup, the stylesheet and app.js',
  !/bt-term/.test(html) &&
  // Comments stripped first: base.css explains AT LENGTH what left and why, and that
  // explanation names `.bt-term`. A bare scan would fail on the note recording the
  // deletion, which is the opposite of what this is for.
  !/\.bt-term/.test(read('../base.css').replace(/\/\*[\s\S]*?\*\//g, '')) &&
  !/BT_TERM_MS/.test(appJs));
// Its height is the one thing on this page that may not depend on the content above
// it, so the fixed string is pinned AND the animation's own re-layout is checked for:
// app.js must not write the full-name line at all.
ok('...and nothing types, rewrites or measures that line at runtime',
  !/landing-full/.test(appJs) && !/_btTerms/.test(appJs));

// The topbar's chrome must not dress the landing head, and it did. base.css's
// topbar rule was a bare `header` element selector, so `<header class="landing-head">`
// inherited `position: sticky`, a white `background`, a bottom border and a fixed
// 56px `height` — the wordmark spilled straight out of the band it was sitting in.
// Every suite passed; only a rendered geometry probe at 1100px showed it. The rule
// is scoped now, and this pins BOTH halves: the scope is still named, and no bare
// `header` rule has come back. Asserting only the absence would also pass on a file
// where the topbar rule had been deleted, which is not the same thing at all.
const baseCssStripped = read('../base.css').replace(/\/\*[\s\S]*?\*\//g, '');
ok('the topbar chrome is scoped to #workspace, so no landing <header> inherits a topbar',
  /#workspace header\s*\{[\s\S]{0,240}?position:\s*sticky/.test(baseCssStripped) &&
  !/\n\s*header\s*\{/.test(baseCssStripped),
  (baseCssStripped.match(/\n\s*header\s*\{[^}]*/) || [])[0]);

// Read the real duration out of an MP4 header, so the timer below is checked
// against the files rather than against a number someone typed. This is the bug
// that shipped before: a 2000ms timer against a 3940ms video, so the intro was
// always cut off mid-play. The mvhd box in these files is version 0.
const mp4DurationMs = (file) => {
  const b = fs.readFileSync(new URL(`../assets/${file}`, import.meta.url));
  const i = b.indexOf('mvhd');
  if (i < 0 || b[i + 4] === 1) return null;
  const timescale = b.readUInt32BE(i + 16);
  const duration = b.readUInt32BE(i + 20);
  return timescale ? (duration / timescale) * 1000 : null;
};
const introMs = mp4DurationMs('brand-intro.mp4');
ok('the intro is a readable MP4', introMs !== null, introMs);

const fallbackMs = Number((appJs.match(/INTRO_FALLBACK_MS\s*=\s*(\d+)/) || [])[1]);
ok('app.js declares an intro fallback timer', Number.isFinite(fallbackMs), fallbackMs);
// The backstop for the case the `ended` event never arrives — the video played and then
// stalled. It must OUTLAST the file, or it would crossfade away a perfectly good intro
// on every device. Checked against the MP4 rather than against a number typed beside it,
// which is the bug this replaced: a 9500ms timer against a longer file truncates it.
ok('the fallback outlasts the intro, so it truncates nothing',
  introMs !== null && fallbackMs >= introMs, { fallbackMs, introMs });

// THE PANEL PLAYS THE INTRO ONCE PER VERSION, and the one device that never sees it is
// one that is ALREADY SIGNED IN — ten seconds of video in front of a session that was
// going to resume anyway is a delay, not a welcome.
//
// This used to be decided TWICE: once before paint in index.html, because #splash-screen
// was `position:fixed; inset:0` and painted with the body before app.js parsed, and once
// in app.js's boot path. It is ONE decision now, and that is a consequence of the split
// rather than a simplification: the panel is a child of #auth-container, which is
// `display: none` until showAuth() sets it inline, and BOTH skip cases — a stored
// session, a Google return — route to showApp() or to the SSO wait screen and never call
// showAuth() at all. A panel that is never displayed cannot flash, so a pre-paint
// attribute has nothing left to do.
//
// It is asserted as GONE FROM BOTH FILES rather than merely un-asserted: a pre-paint
// attribute nobody sets, beside a stylesheet rule nobody matches, both look like working
// code — and the next person to move the panel would find out otherwise.
head('arriving signed in skips the panel, and the skip is asked in one place');
const prePaint = (html.match(/<head>[\s\S]*?<\/head>/) || [''])[0];
ok('index.html no longer decides the skip before paint',
  // Both the setter AND any selector that could act on it. Not a bare scan for the
  // string: index.html carries a note saying what used to be here and why it left, and
  // that note names the attribute — a scan would fail on the record of the deletion,
  // which is the opposite of what this is for.
  !/setAttribute\('data-splash'/.test(html) && !/html\[data-splash/.test(html));
ok('...and the head script no longer reads the stored session at all',
  !/getItem\('ipb_user'\)/.test(prePaint) && !/getItem\('ipb_session'\)/.test(prePaint),
  (prePaint.match(/[^\n]*getItem\([^\n]*/) || [''])[0]);
ok('...and base.css no longer hides anything off that attribute',
  !/data-splash/.test(read('../base.css')));
ok('app.js asks it once, through hasStoredSession()',
  /function hasStoredSession\(\)/.test(appJs) &&
  /localStorage\.getItem\(USER_KEY\) && localStorage\.getItem\(SESSION_KEY\)/.test(appJs));
// ...and the boot path consults THAT predicate, not a second copy of the condition.
// It returns before checkHandoff() and before warmBackend(): a device that is already
// signed in must not pay a backend wake-up for a sign-in screen it will never see.
ok('the boot path leaves through the same predicate',
  /if \(hasStoredSession\(\)\) \{ routeBoot\(\); return; \}/.test(appJs),
  (appJs.match(/[^\n]*hasStoredSession\(\)[^\n]*/) || [''])[0]);
ok('...before the handoff is even looked for, and before the backend is woken',
  appJs.indexOf('if (hasStoredSession()) {') < appJs.indexOf('const handoff = checkHandoff();') &&
  appJs.indexOf('const handoff = checkHandoff();') < appJs.indexOf('warmBackend();'));
// The old once-per-device flag is gone, not merely unused: a leftover write would
// keep working and quietly make the intro once-per-device again for anyone whose
// key it set, which is the bug the owner asked to have removed.
ok('the old once-per-device flag is gone from every file',
  !/introSeen/.test(appJs) && !/introSeen/.test(html) &&
  !/data-intro/.test(appJs) && !/data-intro/.test(html) && !/data-intro/.test(read('../base.css')));

// ...and the rule that replaced it is neither of the two that were wrong before.
// The intro is played in full once per VERSION: not once per device (the owner had
// that removed, and a key written but never compared against APP_VERSION would
// bring it straight back), and not on every load (which is what the owner reported
// and asked to have removed again). Both halves are pinned, because either one
// alone still produces a bug — the comparison without the write plays it forever,
// the write without the comparison plays it never.
ok('the intro is recorded against the running version, not against the device',
  /localStorage\.setItem\(INTRO_DONE_KEY, APP_VERSION\)/.test(appJs) &&
  /localStorage\.getItem\(INTRO_DONE_KEY\) === APP_VERSION/.test(appJs) &&
  /const INTRO_DONE_KEY\s*=\s*'[^']+';/.test(appJs));

// THE STILL AND THE VIDEO OCCUPY ONE SQUARE, and the square is what makes the handover
// between them happen at the same coordinates and the same scale. Asserted rather than
// assumed, because this is the same class of bug the splash shipped once: the wrong
// version is the one that looks right when you read it — `min-width/min-height: 100%`
// with `width/height: auto` reads as full-bleed, but a replaced element with auto sizing
// keeps its INTRINSIC size and the minimums only ever raise it, which put a 1080x1920
// element on a phone and showed 47% x 43% of the frame. Here both children are absolutely
// positioned against the stage, so there is no intrinsic size left to fight.
//
// The squareness is also load-bearing for the heartbeat: the three node coordinates are
// percentages of THIS box, measured by the owner against the master artwork's own 2048²
// canvas. Re-shaping the stage moves every node without an error anywhere.
head('the still and the video occupy one square, so the handover does not move');
const brandStage = (read('../base.css').match(/\.brand-stage\s*\{[^}]*\}/) || [''])[0];
ok('.brand-stage is a square, and it is the box the heartbeat percentages are of',
  /position:\s*relative/.test(brandStage) && /aspect-ratio:\s*1\s*\/\s*1/.test(brandStage),
  brandStage);
ok('...and it declares itself a container, which is what sizes the nodes',
  /container-type:\s*inline-size/.test(brandStage), brandStage);
const brandMedia = (read('../base.css').match(/\.brand-still,\s*\n\.brand-video\s*\{[^}]*\}/) || [''])[0];
ok('the still and the video are both pinned to the square, not to their own pixels',
  /inset:\s*0/.test(brandMedia) &&
  /width:\s*100%/.test(brandMedia) && /height:\s*100%/.test(brandMedia) &&
  !/width:\s*auto/.test(brandMedia) && !/height:\s*auto/.test(brandMedia) &&
  !/min-width/.test(brandMedia) && !/min-height/.test(brandMedia),
  brandMedia);
ok('object-fit: contain letterboxes both into it, so neither is cropped against the other',
  /object-fit:\s*contain/.test(brandMedia));
// ⚠ AND THE PLAYING FILM IS THE ONE EXCEPTION, DELIBERATELY. The stage is square and the
// film is 16:9, so a letterboxed film leaves a band of the ground showing above and below
// the picture — a rectangle again, just a different shape. The film's field is LIGHT and
// the ground it plays on is not, so that band would be the "box" the owner reported, back
// in a new place. Cropping the frame's centre makes the film's own field cover the whole
// square instead. The still is never cropped: it is square art and fills the stage exactly,
// which is what the rule above pins.
ok('...but the playing film alone is cropped to fill the square, so its own field is the ground',
  /\[data-brand="video"\]\s*\.brand-video\s*\{[^}]*object-fit:\s*cover/.test(read('../base.css')));
// THE FILM'S FIELD IS THE ONE COLOUR IN base.css MEASURED OFF A PIXEL. It is held across
// the ramp's LEFT HALF and only then hands over to the shipped crossing, and the hold is
// the whole mechanism: a field that ramps from its first stop reads as a gradient, not as
// a ground, and the film sitting on it is a box again. Both stops are pinned, because a
// ramp that keeps the token and loses the second stop looks correct in a diff.
const baseCssRaw = read('../base.css');
ok('the film ramp holds its measured field flat across the left half before the crossing',
  /--ind-film:\s*#[0-9a-f]{6}/.test(baseCssRaw) &&
  /var\(--ind-film\)\s+0%,\s*var\(--ind-film\)\s+45%/.test(baseCssRaw));
ok('...and that ramp is scoped to the split, so a window dragged narrow keeps the phone ground',
  (() => {
    // Position is the only thing that can tell the two apart, so the rule's media query is
    // found by scanning backwards to the nearest one — the same idiom the fused-ground
    // check below uses. A rule that merely MENTIONS --ind-film must not be mistaken for the
    // rule that declares it, hence the search for the declaration and not the first mention.
    const at = baseCssRaw.search(/--ind-film:\s*#/);
    if (at < 0) return false;
    const media = ((baseCssRaw.slice(0, at).match(/@media[^{]*/g) || []).pop() || '').trim();
    return /min-width:\s*1024px/.test(media) && !/max-width/.test(media);
  })());
// THE CROSSFADE IS ONE ATTRIBUTE, and it ships as "rest" in the markup, so a browser with
// no JavaScript gets the still and the heartbeat and never asks for the video. Both
// halves are pinned because either alone is broken: the rule without the markup default
// flashes an empty panel, and the markup default without the rule means the video never
// appears at all.
ok('the resting state is what the markup ships, and one attribute is the whole crossfade',
  /<div class="auth-brand-panel" data-brand="rest"/.test(html) &&
  /\[data-brand="video"\]\s*\.brand-video\s*\{\s*opacity:\s*1/.test(read('../base.css')));
// It plays in ONE HALF of a screen whose other half is a usable form, so no rule may pin
// it to the viewport any more. A leftover `.splash-video` would be dead CSS that reads as
// live, and the next person to reach for it would find the video under the doors.
ok('the video fills its half of the screen and no longer the whole of it',
  !/\.splash-video/.test(html) && !/\.splash-video/.test(read('../base.css')));

// ── The app icon ─────────────────────────────────────────────────────────────
// The icon set replaced a letterhead PNG that was standing in as one. A manifest
// is easy to get wrong and fails silently: Chrome drops an icon whose bytes do
// not match the size it claims, and offers no install prompt — with no error in
// the console, so nobody notices until someone tries to add it to a home screen.
head('the app icon');
ok('index.html points at the icon set, not the old letterhead',
  /rel="icon"[^>]*assets\/icon-192\.png/.test(html) &&
  /rel="apple-touch-icon"[^>]*assets\/apple-touch-icon\.png/.test(html) &&
  !/assets\/logo\.png/.test(html));
// The mark moved out of the card and into the common head above both doors, so it is
// asserted by its new class and against the head, not the card. It is still the ONE
// mark on this screen: smoke-shell's landing block asserts neither card repeats it.
ok('the common head shows the mark',
  /class="landing-mark"/.test(html) && /assets\/icon-mark\.png/.test(landingHead));
// The sidebar and the sign-in card show the BORDERLESS mark, while the tab, the
// home screen and the manifest keep the square icons — an OS tile has to be
// square, and iOS/Android mask it themselves. The two must not be swapped: the
// square one inside the app shows the light background it was drawn on, which is
// the "it comes in a shape of square" the owner reported.
ok('the sidebar brand mark is the borderless mark, not the square icon',
  /class="brand-mark"[^>]*>\s*<img[^>]*assets\/icon-mark\.png/.test(html) &&
  !/class="brand-mark"[^>]*>\s*[A-Za-z]/.test(html),
  (html.match(/class="brand-mark"[\s\S]{0,140}/) || [''])[0]);
ok('...and neither in-app mark falls back to the square icon',
  !/class="landing-mark"[^>]*icon-192/.test(html) &&
  !/class="brand-mark"[^>]*icon-192/.test(html));
// The cutout has to be regenerable and CHECKED, not just present: a mark that
// silently kept its background looks fine on the light page and wrong everywhere
// else, and a mark whose fill ate the logo looks fine until someone opens it.
ok('the borderless mark is a real PNG with an alpha channel, and is not blank',
  (() => {
    const p = new URL('../assets/icon-mark.png', import.meta.url);
    if (!fs.existsSync(p)) return false;
    const b = fs.readFileSync(p);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    // IHDR colour type 6 = truecolour with alpha. Without it the "borderless"
    // mark would be a white rectangle.
    const colourType = b[25];
    return w === 512 && h > 200 && colourType === 6 && b.length > 8192;
  })(), 'expected a 512-wide RGBA PNG');

// ── The mark must still HAVE its artwork, and must work in dark mode ──────────
//
// The bug the original version of this pinned, found by the owner in dark mode
// and by nobody on the light page: the 2025 mark's flood fill reached INSIDE the
// circle, through the light knockout band behind the "Passbook" script, and
// punched out the monogram and the lettering. On a light page that is invisible —
// a transparent hole shows the page and the page is the same near-white the
// artwork's background was. On the dark one the whole mark became an empty box.
//
// ── What replaced it, and why the numbers below are different ────────────────
//
// On 2026-10-10 the owner replaced the brand with Option A, The Telemetry Grid, and
// told me to "use our same logo everywhere". That artwork needed no flood fill at
// all: its field is a flat near-white and its art is two SOLID inks, so a plain
// colour key separates them and the whole leak-and-restore failure mode is gone
// with the disc it belonged to. See tools/make-icons.ps1.
//
// But a key introduces a DIFFERENT silent failure, which is why this still decodes
// the pixels instead of trusting the dimensions: a key tuned too tight leaves the
// mark as a white rectangle on the page, and one tuned too loose eats the artwork.
// Both produce a valid 512-wide RGBA PNG that a "not blank" check passes.
//
// So the counts below are the real file's, measured, not chosen: the mark is
// ~44% transparent field, and of what is left the great majority is ink — a
// yellow bolt and a navy chevron. The yellow is the one that can vanish without
// the mark looking wrong, because what remains is still a recognisable shape.
function pngPixels(p) {
  const b = fs.readFileSync(p);
  let off = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (off + 12 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (ct !== 6) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  let p2 = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p2++];
    const line = raw.subarray(p2, p2 + stride); p2 += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, bb = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) {
        const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, px: out };
}

const markStats = (() => {
  const png = pngPixels(new URL('../assets/icon-mark.png', import.meta.url));
  if (!png) return null;
  const { w, h, px } = png;
  let clear = 0, solid = 0, yellow = 0, navy = 0;
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3];
    if (a < 128) { clear++; continue; }
    if (a !== 255) continue;
    solid++;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    if (r > 200 && g > 150 && b < 120) yellow++;
    else if (r < 90 && g < 90 && b < 110 && b > r) navy++;
  }
  return { clear, solid, yellow, navy, total: w * h };
})();

ok('the mark still carries its brand yellow — the key did not eat the bolt',
  !!markStats && markStats.solid > 0 && markStats.yellow / markStats.solid > 0.25,
  markStats ? `${(100 * markStats.yellow / Math.max(1, markStats.solid)).toFixed(0)}% of opaque px are brand yellow` : 'unreadable PNG');
ok('...and its navy, so the crop is on the monogram and not on the wordmark',
  !!markStats && markStats.solid > 0 && markStats.navy / markStats.solid > 0.08,
  markStats ? `${(100 * markStats.navy / Math.max(1, markStats.solid)).toFixed(0)}% of opaque px are navy` : '');
// The key has to have actually run. A mark that kept its background is a white
// rectangle sitting on the page — the exact thing the owner reported against the
// old one ("it comes in a shape of square") — and its dimensions and byte count
// are indistinguishable from a correct one's.
ok('the background is gone — the key ran, and the square did not come back',
  !!markStats && markStats.clear / markStats.total > 0.3 && markStats.clear / markStats.total < 0.7,
  markStats ? `${(100 * markStats.clear / markStats.total).toFixed(0)}% transparent` : '');

// The 2026 Option A mark is two SOLID inks on a transparent field, not a dark disc
// with its monogram knocked out of it, and the two need opposite treatments:
//   * a disc with holes inverts to a light disc with dark holes — legible, and the
//     design keeps its internal contrast;
//   * two flat inks do not. Inverting Option A turns its navy bone-white and, far
//     worse, turns the brand yellow #f8c808 into #0737f7 — an electric blue. The
//     bolt is the loudest shape in the mark, so that is not a dark variant of the
//     brand, it is a different one. Rendered before it was changed, not reasoned
//     about (tools/.cache/mark-dark.png).
// So dark mode flattens both inks to one WHITE SILHOUETTE. Both in-app marks have
// to be covered, or one of them stays a dark shape on a dark page.
const baseCss = read('../base.css');
const baseFlat = baseCss.replace(/\s+/g, m => m.includes('\n') ? '\n' : ' ');
ok('dark mode draws BOTH in-app marks as a flat white silhouette',
  /\[data-theme="dark"\]\s*\.brand-mark\s+img\s*,\s*\[data-theme="dark"\]\s*\.landing-mark\s*\{[^}]*filter:\s*brightness\(0\)\s+invert\(1\)/.test(baseFlat),
  (baseCss.match(/\[data-theme="dark"\][^{]*\{[^}]*invert[^}]*\}/) || ['none — the mark is invisible in dark mode'])[0]);
// Plain invert(1) is the obvious-looking wrong answer for THIS artwork: it leaves
// the mark legible, so it passes any "is it visible" check, and turns the brand
// yellow blue, which no contrast measurement can see.
ok('and NOT a filter that begins with a bare invert(1), which would turn the brand yellow blue',
  !/\[data-theme="dark"\][^{]*\{[^}]*filter:\s*invert\(1\)/.test(baseFlat));
// ⚠ THIS ASSERTION IS INVERTED, AND IT IS NOT A LOOSENING. The handoff screen used to be
// the one screen that was dark whatever the theme was, so its mark took the dark-theme
// silhouette treatment. It now stands on `--ind-ground` — the app's own ground, light in
// light mode — where `brightness(0) invert(1)` renders the brand mark as a white blob on
// a white page. So what is asserted is that the filter is GONE. "It is still there" is
// exactly the failure the old form of this line could no longer see: it pinned the
// treatment to a screen whose ground had moved out from under it. base.css carries the
// whole argument above `#sso-wait`.
ok('the sign-in handoff mark does NOT take the dark-screen silhouette, which is now white on white',
  !/\.sso-wait-mark\s*\{[^}]*filter:\s*brightness\(0\)\s+invert\(1\)/.test(baseFlat),
  (baseCss.match(/\.sso-wait-mark\s*\{[^}]*\}/) || ['none'])[0]);

const manifest = JSON.parse(read('../manifest.json'));
ok('the manifest declares both icon sizes',
  manifest.icons.some(i => i.sizes === '192x192' && i.src === 'assets/icon-192.png') &&
  manifest.icons.some(i => i.sizes === '512x512' && i.src === 'assets/icon-512.png'),
  manifest.icons);
// A PNG's IHDR carries its dimensions at bytes 16 and 20 — read them rather than
// trusting the label.
ok('every declared icon is a real PNG of the size it claims',
  manifest.icons.every(ic => {
    const p = new URL(`../${ic.src}`, import.meta.url);
    if (!fs.existsSync(p)) return false;
    const b = fs.readFileSync(p);
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` === ic.sizes;
  }), manifest.icons);
// iOS ignores <link rel="icon"> and asks for this exact file name at the root of
// the assets folder it is given; a missing one falls back to a screenshot of the
// page, which is what the home screen would show instead of the mark.
ok('the apple-touch-icon is a real 180x180 PNG', (() => {
  const p = new URL('../assets/apple-touch-icon.png', import.meta.url);
  if (!fs.existsSync(p)) return false;
  const b = fs.readFileSync(p);
  return b.readUInt32BE(16) === 180 && b.readUInt32BE(20) === 180;
})());
// A dimension check passes on a BLANK icon, which is exactly what a botched
// regeneration produces — tools/make-icons.ps1 writes a fresh file of the right
// size even if it read a master that was wrong or empty. A flat single-colour
// PNG of this size deflates to a few hundred bytes, so the byte count is the
// canary the IHDR cannot be. The master is asserted too: it is the only source
// for all three, and a missing one is what the NEXT icon change would trip on.
ok('no icon is a blank file, and the master they come from is present', (() => {
  const names = ['assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png'];
  const thin = names.filter(n => {
    const p = new URL(`../${n}`, import.meta.url);
    return !fs.existsSync(p) || fs.statSync(p).size < 4096;
  });
  const master = new URL('../assets/icon-master.png', import.meta.url);
  return thin.length === 0 && fs.existsSync(master) && fs.statSync(master).size > 4096;
})(), 'a blank PNG deflates to well under 4 KB');
// sw.js precaches what it lists, and the deploy only serves what SERVED names.
// An entry in one and not the other is a 404 the browser swallows.
const served = (read('../tools/deploy-ghpages.mjs').match(/const SERVED = \[[\s\S]*?\]/) || [''])[0];
const shellList = (swJs.match(/const SHELL = \[[\s\S]*?\]/) || [''])[0];
ok('every precached shell file is in the deploy\'s served list',
  [...shellList.matchAll(/'\.\/([^']+)'/g)].map(m => m[1])
    .every(p => p === '' || served.includes(`'${p}'`)),
  [...shellList.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]));

// ── The version the user READS must be the version they are RUNNING ───────────
// APP_VERSION prints on the sign-in card and in the sidebar footer, so a report
// can be answered by looking. CACHE_NAME decides which build a returning device
// actually serves — and the shell is stale-while-revalidate, so a device can be a
// whole load behind whatever gh-pages holds. Those two disagreeing is EXACTLY the
// confusion the visible version exists to remove, so they are pinned to each
// other: bump one and this fails until the other follows.
head('the version on screen is the version being served');
const shownVersion = (appJs.match(/^const APP_VERSION = '([^']+)';/m) || [])[1];
const cacheVersion = (swJs.match(/^const CACHE_NAME = 'ipassbook-([^']+)';/m) || [])[1];
ok('app.js declares APP_VERSION', !!shownVersion, shownVersion);
ok('sw.js declares CACHE_NAME in the ipassbook-<v> shape', !!cacheVersion, cacheVersion);
ok('the number a user reads equals the number their device is running',
  !!shownVersion && shownVersion === cacheVersion,
  { shown: shownVersion, cache: cacheVersion });
// Declaring it is not enough — it has to reach the page. Slots in index.html…
ok('index.html carries version slots (the sign-in card AND the app footer)',
  (html.match(/class="app-version"/g) || []).length >= 2,
  (html.match(/class="app-version"/g) || []).length);
// …and the credit line, on the landing page as well as inside the app. The wording
// is the owner's, verbatim — "by Mr. Raza For Indrones", capital F.
//
// Sliced between the two containers by id, NOT by a `</div></div>` pattern: the
// landing page is a grid of two <section> cards now, so the old "next two closing
// divs" bound stops matching and the assertion would have been testing '' — green
// for the worst possible reason. A named boundary cannot go stale that way.
const authContainer = html.slice(
  html.indexOf('<div id="auth-container">'),
  html.indexOf('<div id="password-change">'));
ok('the credit is on the landing page, not only behind the sign-in',
  authContainer.length > 0 &&
  /app-credit/.test(authContainer) &&
  /Mr\. Raza For Indrones/.test(authContainer));
// …filled by one writer, so there is one place to look when the number is wrong.
ok('app.js fills every slot through the shared .app-version class',
  /querySelectorAll\('\.app-version'\)/.test(appJs));
// On the SIGN-IN CARD the number gets its own line (the owner's ask, 2026-10-02):
// it is the fact a person is asked to read back when they report a problem, and
// inline after a middot it read as part of the sentence. Scoped to #auth-container
// on purpose — the sidebar copy is a footer in a flex column, where a second line
// is the thing that would look wrong. Pinned, because a cascade that puts it back
// inline is invisible until someone stares at the card.
ok('the version sits on its own line on the sign-in card',
  /#auth-container \.app-version\s*\{[^}]*display:\s*block/.test(baseCss),
  (baseCss.match(/#auth-container \.app-version[^}]*\}/) || [''])[0]);
ok('...and that rule is scoped, so the sidebar footer keeps its single line',
  (() => {
    // Every rule that sets display:block on .app-version must be the scoped one.
    // Written as a scan of the real rule bodies rather than a lookahead, because a
    // lookahead here matches the scoped rule too and would pass for the wrong reason.
    const rules = [...baseCss.matchAll(/([^{}]*?)\.app-version\s*\{([^}]*)\}/g)];
    const blocking = rules.filter(m => /display:\s*block/.test(m[2]));
    return blocking.length === 1 && /#auth-container/.test(blocking[0][1]);
  })(), [...baseCss.matchAll(/([^{}]*?)\.app-version\s*\{([^}]*)\}/g)].map(m => m[1].trim()));
ok('...and the middot that joined the two halves is gone with it, so nothing dangles',
  /#auth-container \.credit-dot\s*\{[^}]*display:\s*none/.test(baseCss), 'orphan mid dot');
// ── THE OLD IN-FORM CODE STEP IS GONE, AND SO IS ITS TOAST ────────────────────
// These two assertions used to drive `gotoOtpStep`, the function that folded a code field
// open INSIDE the sign-in form and wrote a note under it. The owner moved the code to a
// screen of its own (#code-view — see the landing block below), the function went with it,
// and both assertions were then testing '' : `indexOf` returned -1, the slice was empty, and
// "the code step sets the inline note" was green for a reason that had nothing to do with
// the app. What replaces them is the claim that survives the move, and the one they were
// really about — that no toast ever sat over the boxes.
ok('the in-form code step and its inline note are gone with the screen they belonged to',
  (() => {
    // app.js's own note above the new screen NAMES the block it replaced, so the scan runs
    // over the code with its comments off. A test that searched the raw text would fail on
    // the prose describing the very departure it is asserting.
    const code = appJs.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return !/gotoOtpStep/.test(code) && !/auth-login-code-note/.test(code) &&
           !/auth-login-code-wrap/.test(code);
  })());
ok('...and nothing raises a toast over the code boxes',
  (appJs.match(/function submitCode\(\)[\s\S]*?\n\}/) || [''])[0].length > 200 &&
  !/showToast/.test((appJs.match(/function submitCode\(\)[\s\S]*?\n\}/) || [''])[0]) &&
  /setCodeError\(/.test(appJs));

// ── The update notice: two slots, one writer, and a worker that never lies ────
// A device parked on an old build is the argument for this existing at all. Three
// things have to hold or it does nothing: the worker must not answer the version
// question out of its own cache, BOTH screens need a slot (a device stuck at
// sign-in is the one that most needs telling), and the two slots must be filled by
// one writer, so there is one place to look when the wording is wrong.
head('the update notice can be seen, and can be trusted');
const bannerSlots = appJs.match(/document\.getElementById\('update-banner-(ws|auth)'\)/g) || [];
ok('app.js binds both banner slots', bannerSlots.length === 2, bannerSlots);
ok('index.html carries both slots, hidden until there is something to say',
  (html.match(/class="update-banner" id="update-banner-(ws|auth)" style="display:none"/g) || []).length === 2,
  html.match(/id="update-banner-[a-z]+"[^>]*/g));
const writeBanner = (appJs.match(/function paintUpdateBanner\(\)[\s\S]*?\n\}/) || [''])[0];
ok('one function paints both slots, through the same body',
  /\[updateBannerWs, updateBannerAuth\]\.forEach/.test(writeBanner), writeBanner.slice(0, 80));
// Nothing may reach past that writer: a second assignment to a slot is a second
// place the text can be wrong, and the slots are re-written on every paint.
ok('...and nothing writes to a slot directly, outside that one function',
  (appJs.match(/updateBanner(Ws|Auth)\.(innerHTML|style)/g) || []).length === 0,
  appJs.match(/updateBanner(Ws|Auth)\.(innerHTML|style)/g));
// sw.js must never precache ITSELF. The app asks for ./sw.js to answer "is a newer
// build deployed?", and a cached copy of that answer is the one answer worse than
// no answer at all — right once, then wrong for the life of the cache, because the
// Cache API ignores the `cache:` mode on the request that asks.
ok('the worker does not precache its own script', !/'\.\/sw\.js'/.test(shellList), shellList.slice(0, 60));
ok('...and sw.js states that rule up where the version numbers are explained',
  /OWN script: never intercepted/.test(swJs) && /isOwnScript/.test(swJs));
// The probe compares the CACHE_NAME gh-pages is SERVING against the APP_VERSION the
// page is RUNNING, so the pin above is not cosmetic — it is the premise of the
// whole check. A worker body without a parseable number reads as "no idea", which
// is the safe direction: no notice, never a false one.
ok('the probe\'s premise is the served-vs-running pin above',
  shownVersion === cacheVersion && /ipassbook-\(v\\d\+\)/.test(appJs),
  { shown: shownVersion, cache: cacheVersion });

// ── Boot reads `__CONFIG__` ONCE, not once per consumer ───────────────────────
// The inward dropdowns, the IQC config, the team directory and the palette allowlist
// are four records in one store. Each consumer used to fetch that store for itself —
// same URL, same payload, four round trips on the way to a screen the owner already
// reported as slow. This pins the shape that replaced it: ONE request, all four
// records applied from its payload, and the post-sign-in palette read served from
// memory when the boot read has already landed.
head('one boot read of the shared config store, not one per consumer');
const fnBodyOf = name => {
  const from = appJs.indexOf('function ' + name + '(');
  if (from < 0) return '';
  // Brace-count from the first `{` so a nested block does not cut the body short.
  const open = appJs.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(from, i + 1); }
  }
  return appJs.slice(from);
};
ok('exactly one place fetches the whole store',
  (appJs.match(/loadSentinelAll\('__CONFIG__'\)/g) || []).length === 1);
const perConsumer = ['loadInwardOptions', 'loadIqcConfig', 'loadTeamDirectory']
  .filter(n => /loadSentinel(All)?\(/.test(fnBodyOf(n)));
ok('and none of the three per-record loaders fetches anything itself',
  perConsumer.length === 0, perConsumer);
ok('the fan-out hands each record to its own applier',
  /applyInwardOptions\(sections\['inward-options'\]\)/.test(appJs) &&
  /applyIqcConfig\(sections\['iqc-config'\]\)/.test(appJs) &&
  /applyTeamDirectory\(sections\['team-directory'\]\)/.test(appJs));
ok('a failed read leaves the local copies standing rather than blanking them',
  /loadSentinelAll\('__CONFIG__'\)\.then\(sections => \{\s*\n\s*if \(!sections\) return;/.test(appJs));
ok('the palette read is served from the boot payload when it has landed',
  /const cached = sharedConfigRecord\('theme'\)/.test(fnBodyOf('loadPaletteConfig')) &&
  /cached !== undefined \? Promise\.resolve\(cached\) : loadSentinel\('__CONFIG__', 'theme'\)/.test(appJs));
// `undefined` (never read / the read failed) must be distinguishable from a record
// that is genuinely absent, or a missing theme would re-fetch on every session.
ok('...and "not read yet" is not confused with "absent from a successful read"',
  /return _configSections \? _configSections\[sectionId\] : undefined;/.test(fnBodyOf('sharedConfigRecord')));
ok('the three loaders still paint from localStorage before any network call',
  ['ipb_inward_options', 'ipb_iqc_config', 'ipb_team_directory']
    .every(k => appJs.includes(`localStorage.getItem('${k}')`)));
// The appliers are what a SAVE keeps working through: saveIqcConfig and friends
// write the same records, and a boot that had stopped applying them would look
// like a save that silently did nothing.
ok('the appliers are still the ones the savers round-trip through',
  /saveSentinel\('__CONFIG__', 'iqc-config'/.test(appJs) &&
  /saveSentinel\('__CONFIG__', 'inward-options'/.test(appJs) &&
  /saveSentinel\('__CONFIG__', 'team-directory'/.test(appJs));

// ── The landing page: two doors, stacked and collapsible ──────────────────────
// One address serves both audiences, and since 2026-10-08 the two doors are
// ACCORDIONS stacked one above the other rather than cards side by side. The owner:
// *"currently employee login box is much lengthier than customer's, plus employee
// one's looks cluttered … let us have both employee login and customer login option
// arranged vertically aligned, one above another. each condensed, i.e., collapsible,
// so whichever the person wants to access will click on/arrow and expand it."*
//
// Every clause of that is a property of the MARKUP, which is why it is asserted here
// rather than looked at. The one job of this screen is that a visitor can tell the two
// apart BEFORE typing anything.
head('the landing page offers two doors, stacked, each of them collapsible');
{
  const baseCssRaw = read('../base.css');
  const i18nJs     = read('../i18n.js');
  // Comments are stripped before the STRUCTURAL scans. Several of the comments in
  // base.css and app.js name the very selectors this block asserts are GONE, because a
  // rule that was removed is worth explaining where it stood — and a test that searched
  // the raw text would fail on the prose describing the absence it is asserting.
  const stripCss = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stripJs  = js  => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*/g, '$1');
  const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, '');
  const baseCss  = stripCss(baseCssRaw);
  const appCode  = stripJs(appJs);
  const htmlCode = stripHtml(html);
  // i18n.js's notes QUOTE the very strings this block asserts are gone — the two retired
  // straplines, the three deleted code-step strings — so its whole-line comments come off
  // before any absence check. Only whole-line comments: a general stripper would have to
  // guess at the quotes around every English sentence in the table.
  const i18nCode = i18nJs.replace(/^\s*\/\/.*$/gm, '');

  // THE BOUNDARY IS A NAMED MARKER. It used to be "the next two closing divs", and a
  // boundary that silently resolves to '' turns every assertion below into a tautology
  // that still prints PASS. The marker is the code step's own banner, which stands
  // between #auth-container's close and #code-view — so this is the landing page and
  // nothing else.
  const doorsBlock = (html.match(/<div class="doors">[\s\S]*?<!-- ========== CHECK YOUR EMAIL/) || [''])[0];
  ok('the landing page is a .doors column holding exactly two door sections',
    doorsBlock.length > 0 &&
    (doorsBlock.match(/<section class="door [^"]*"/g) || []).length === 2,
    (doorsBlock.match(/<section class="door [^"]*"/g) || []).length);

  // ── STACKED, AND THAT IS THE WHOLE FIX ───────────────────────────────────────
  // Side by side, two cards of different content are read AGAINST each other and the
  // shorter one reads as incomplete however it is filled — which was the complaint.
  // Stacked, each is compared only with the page. A flex COLUMN with one max width, and
  // not a grid: an `auto-fit` grid still puts them two-up on any screen wide enough,
  // which is the very arrangement that was rejected.
  ok('...and it is one flex column, so the two doors can never sit side by side',
    /\.doors \{[^}]*display: flex/.test(baseCss) &&
    /\.doors \{[^}]*flex-direction: column/.test(baseCss) &&
    !/\.doors \{[^}]*grid-template-columns/.test(baseCss),
    (baseCss.match(/\.doors \{[^}]*\}/) || [''])[0]);
  // …and a column is a column at EVERY width, so there is no wide-screen arrangement left
  // to undo and no media query is needed. What stood here was an auto-fit grid plus a
  // query that collapsed it.
  // The `\{` is load-bearing. The check is "no media query REWRITES .doors", and the
  // ground blocks do mention the name — inside a `:not(.doors)` on `.auth-main`'s direct
  // children, which is a statement about the footing and not about this box at all.
  // Matching the bare name fired on that. A selector is only rearranged by a rule that
  // OPENS on it.
  ok('...and nothing rearranges them at any width, so no media query is needed',
    !/@media[^{]*\{[^@]*\.doors\s*\{/.test(baseCss));
  ok('...and a door is the width of the column, not of its own contents',
    /\.door \{[^}]*max-width: none;/.test(baseCss) &&
    /\.doors \{[^}]*max-width: 420px;/.test(baseCss));

  // ── EACH DOOR IS AN ACCORDION, AND THE BAR IS THE CONTROL ───────────────────
  // The two words are the owner's, changed on 2026-10-10: *"'EMPLOYEE' in employee
  // button to updated to 'AS A EMPLOYEE', and customer button updated to 'AS A
  // CUSTOMER'. So it gives a wholesome sense of login as a employee or login as a
  // customer."* They are asserted here rather than left to the i18n table because
  // they are the two words that complete the head above them — "LOGIN" over "AS A
  // EMPLOYEE" is one sentence, and the plain nouns are not.
  for (const [which, key, word] of [
    ['employee', 'door.employee', 'AS A EMPLOYEE'],
    ['customer', 'door.customer', 'AS A CUSTOMER'],
  ]) {
    const card = (doorsBlock.match(new RegExp('<section class="door [^"]*" id="door-' + which + '"[\\s\\S]*?</section>')) || [''])[0];
    ok('#' + which + ' is a door whose whole BAR is the control',
      card.length > 0 &&
      new RegExp('<button type="button" class="door-bar" id="door-' + which + '-toggle"').test(card));
    ok('...and the bar says both halves of the one fact: that it is open, and what it opens',
      new RegExp('id="door-' + which + '-toggle"[\\s\\S]{0,240}?aria-expanded=').test(card) &&
      new RegExp('id="door-' + which + '-toggle"[\\s\\S]{0,240}?aria-controls="door-' + which + '-body"').test(card));
    // THE ROLE CHIP IS A <span> INSIDE THE BAR, not a <p> of its own: the whole bar is
    // the control, so "which of these two am I?" is answered by a thing that is itself
    // pressable rather than by a label sitting beside one.
    ok('...and "' + word + '" is a chip inside that bar, above the chevron',
      new RegExp('<span class="door-role" id="door-' + which + '-role" data-i18n="' + key + '">' + word + '</span>').test(card) &&
      card.indexOf('class="door-role"') > card.indexOf('class="door-bar"') &&
      card.indexOf('class="door-role"') < card.indexOf('class="door-chev"'));
    ok('...and a chevron is there to BE the state display',
      new RegExp('id="door-' + which + '-toggle"[\\s\\S]{0,400}?<span class="door-chev" aria-hidden="true"></span>').test(card));
    // THE PANEL SHIPS FOLDED, which is the opposite of what this asserted until
    // 2026-10-09. The old assertion read "a JS-off page still shows the door", and it was
    // wrong on both counts: shipping unfolded meant a browser painted both panels open and
    // app.js folded them a tick later — a visible snap on every single visit, which the
    // owner had already complained about twice — and the `aria-expanded="false"` the markup
    // already carried described a collapsed panel that was in fact open. With JS off
    // nothing is lost: the bars are inert either way, because `toggleDoor` is the only
    // thing that ever opened a panel. Markup and first paint now agree, so nothing moves.
    ok('...and the panel ships FOLDED, so the first frame is not both doors snapping shut',
      new RegExp('<div class="door-body" id="door-' + which + '-body" hidden>').test(card) &&
      new RegExp('id="door-' + which + '"[^>]*data-open="0"').test(card));
  }

  // ── ONE FACT, THREE STATEMENTS, AND NOTHING TO GET OUT OF STEP ─────────────
  // `data-open` turns the chevron, `hidden` folds the panel, `aria-expanded` tells a
  // screen reader. Three statements of one fact is one more than is comfortable, and each
  // is load-bearing: `hidden` alone leaves the arrow pointing down inside a shut panel,
  // and a class alone leaves a keyboard user tabbing through fields they cannot see. The
  // assertion is that ALL THREE are written, for the door that was named, in one pass.
  //
  // ⚠ THE TWO DOORS ARE INDEPENDENT, AND THAT IS THE OWNER'S CORRECTION OF 2026-10-09.
  // They were an ACCORDION until then — one bar open on arrival, opening either one
  // closing the other — and that was argued for here at length. He rejected the argument:
  // *"no its not done, I asked page opens the tabs collapsed, then we may open anyone or
  // collapse anyone without being dependent on other."* So setDoor takes a door AND its
  // state rather than a sole choice, `toggleDoor` exists and flips ONE door, and BOTH
  // SHUT is not merely a legal state but the state the page arrives in.
  //
  // The accordion's own worry is answered by the default rather than by the interlock:
  // two open panels put the employee's four mechanisms and the customer's three above
  // each other, which is the clutter he objected to — and it cannot happen on arrival,
  // because arrival is both-shut.
  ok('setDoor writes all three statements of the one fact, for the door it was given',
    /function setDoor\(which, on\) \{/.test(appCode) &&
    /sec\.dataset\.open = on \? '1' : '0';/.test(appCode) &&
    /bar\.setAttribute\('aria-expanded', on \? 'true' : 'false'\);/.test(appCode) &&
    /body\.hidden = !on;/.test(appCode) &&
    // …and it names ONE door. A `DOORS.forEach` inside setDoor is the interlock coming
    // back by the side door, so its absence is asserted rather than its shape.
    !/function setDoor\(which, on\) \{[\s\S]{0,600}?DOORS\.forEach/.test(appCode));
  // The `!important` is not decoration: `display: flex` on .door-body would otherwise beat
  // the user agent's `[hidden] { display: none }`, which is the classic way an accordion
  // silently never closes.
  ok('...and the folded panel really is folded, the `!important` and all',
    /\.door-body\[hidden\] \{ display: none !important; \}/.test(baseCss));
  ok('...and the chevron turns over on that one attribute, with no glyph and no script',
    /\.door\[data-open="1"\] \.door-chev \{ transform: rotate\(-135deg\); \}/.test(baseCss));
  // THE TWO ARE INDEPENDENT. `toggleDoor` flips the door it is handed and reads that
  // door's own state to do it, so neither bar can move the other. This is asserted as the
  // PRESENCE of the toggle and the ABSENCE of any cross-door write, because the failure
  // mode is a line reappearing, not a shape going missing.
  ok('...and each bar toggles ITSELF, reading its own state and touching no other door',
    /function toggleDoor\(which\) \{/.test(appCode) &&
    /setDoor\(w, !\(sec && sec\.dataset\.open === '1'\)\);/.test(appCode) &&
    !/DOORS\.filter\(x => x !== w\)/.test(appCode));
  // BOTH SHUT IS THE ARRIVAL STATE, not an edge case to be prevented.
  ok('...and the page arrives with BOTH bars shut, which is the state he asked for',
    /function paintDoors\(\) \{[\s\S]{0,220}?DOORS\.forEach\(w => setDoor\(w, false\)\);/.test(appCode) &&
    !/setDoor\(DOORS\.indexOf\(want\) >= 0 \? want : 'employee'\);/.test(appCode));
  // The last door a device opened is still worth remembering — it is what the sign-in
  // code screen hands back to when it closes, and nothing else depends on it.
  ok('...and the door a device used last is still remembered, for the code screen',
    /const DOOR_KEY = 'ipb_door';/.test(appCode) &&
    /localStorage\.setItem\(DOOR_KEY, w\)/.test(appCode) &&
    /function closeCodeView\(restore\) \{[\s\S]{0,400}?setDoor\(/.test(appCode));
  // …and it is repainted by the one function EVERY route back to the landing goes
  // through, not only at wiring time: a sign-out returns to this screen and must find the
  // door this device left open.
  const showAuthBody = (appCode.match(/function showAuth\(\) \{[\s\S]*?\n\}/) || [''])[0];
  ok('...and showAuth() paints the doors, above its own early work',
    showAuthBody.length > 200 && /paintDoors\(\);/.test(showAuthBody));
  ok('...and the bars are wired once, by the landing screen’s one wiring pass',
    /function wireDoors\(\) \{/.test(appCode) && /wireLanding\(\) \{[\s\S]{0,200}?wireDoors\(\);/.test(appCode));

  // ── THE BRAND, SAID ONCE, ABOVE BOTH DOORS ───────────────────────────────────
  const headBlock = (html.match(/<header class="landing-head">[\s\S]*?<\/header>/) || [''])[0];
  ok('the mark and the wordmark are one common head, above the doors',
    headBlock.length > 0 &&
    html.indexOf('<header class="landing-head">') < html.indexOf('<div class="doors">') &&
    (html.match(/class="landing-head"/g) || []).length === 1);
  ok('...and it carries the app name and the full product name',
    /data-i18n="app\.name"/.test(headBlock) && /data-i18n="app\.fullName"/.test(headBlock));
  ok('...with the mark once, and no second copy inside either door',
    (headBlock.match(/class="landing-mark"/g) || []).length === 1 &&
    !/landing-mark|auth-logo/.test(doorsBlock));

  // ── THE LINE UNDER THE WORDMARK IS THE PLAIN NAME, AND IT IS STATIC ─────────
  // THREE STRAIGHTLINES HAVE STOOD THERE and the two that lost are asserted as GONE,
  // because prose comes back by accretion and both were once somebody's good idea:
  //   1. "Indrones Product After-Sales Summary Book".
  //   2. *"INDRONES FROM I · PRODUCT FROM P · AFTER FROM A · SALES FROM S · SUMMARY FROM
  //      S · BOOK AS IT IS"* — the owner's own expansion, which he wrote to explain the
  //      acronym TO ME rather than to put on the page. It was replaced on 2026-10-08 by
  //      the plain name, and his reason was not that the expansion was wrong but that it
  //      MOVED: *"the whole page below it is increasing/decreasing its height … And line
  //      increasing/decreasing should not happen."*
  ok('the line under the wordmark is the owner’s plain name, in the markup and in the table',
    // The name, not the name-with-a-letter-missing. Corrected 2026-10-09 — see the note
    // on the head assertion above for the owner's own words.
    /<p class="landing-full" id="landing-full" data-i18n="app\.fullName">INDRONES PRODUCT AFTER SALES SERVICE BOOK<\/p>/.test(headBlock) &&
    /'app\.fullName':\s*'INDRONES PRODUCT AFTER SALES SERVICE BOOK'/.test(i18nJs));
  ok('...and both superseded straplines are gone from the head and from the language table',
    !/Indrones Product After-Sales Summary Book/.test(headBlock) &&
    !/Indrones Product After-Sales Summary Book/.test(i18nCode) &&
    !/INDRONES FROM I/.test(headBlock) && !/INDRONES FROM I/.test(i18nCode));
  // ── AND IT CANNOT CHANGE THE PAGE'S HEIGHT ───────────────────────────────────
  // Three things together make that true, and any one of them alone is not enough: the
  // line is ONE STRING, so its height is fixed at every width; nothing types, rewrites or
  // measures it at runtime; and NO rule reserves a second line "just in case", which would
  // buy a guarantee against a thing that can no longer happen and pay for it with a
  // permanent gap under the head.
  ok('...and no rule reserves a second line, which would be a permanent gap',
    /\.landing-full \{[^}]*\}/.test(baseCss) &&
    !/\.landing-full \{[^}]*min-height/.test(baseCss));
  ok('...and nothing types it, rewrites it or measures it at runtime',
    /function buildBrandTyping\(\)/.test(appCode) &&
    /landing-brand/.test(appCode) && !/landing-full/.test(appCode));
  ok('...and the whole per-term expansion is gone from the markup, the stylesheet and the code',
    !/bt-term/.test(html) && !/\.bt-term/.test(baseCss) &&
    !/bt-term/.test(appCode) && !/BT_TERM_MS/.test(appCode));

  // ── THE WORDMARK TYPES ITSELF ─────────────────────────────────────────────────
  // The owner, 2026-10-08: "I-PASSBOOK itself in-loop animation where I-PASSBOOK appears
  // as if being typed". It replaced a looping cursive stroke, and the stroke is asserted
  // GONE rather than merely un-asserted.
  ok('...and the cursive stroke and its dash animation are gone',
    !/brand-stroke/.test(html) && !/brandWrite/.test(baseCssRaw) &&
    !/stroke-dasharray/.test(baseCssRaw));
  // The word is the MARKUP's, and that is what makes the animation possible: app.js splits
  // text that is already on the page. A head that shipped empty and filled itself in from
  // script would leave a JS-off reader, a screen reader and a reduced-motion visitor with
  // nothing at all.
  ok('...and the finished word is in the markup, not typed in by script',
    /<h1 class="landing-brand" id="landing-brand" data-i18n="app\.name">I-PASSBOOK<\/h1>/.test(headBlock));
  // `display`, NOT `opacity`. Hiding an untipped letter with opacity leaves it occupying
  // its own width, so the wordmark would be its full width from the first frame and the
  // letters would fade in — a fade, never a type. Removing it from the box is what makes
  // the word grow left to right.
  ok('...and an untipped letter is hidden with display, so the word grows as it is typed',
    /\.bt-lt \{ display: none; \}/.test(baseCssRaw) &&
    /\.bt-lt\.is-on \{ display: inline; \}/.test(baseCssRaw) &&
    !/\.bt-lt[^{]*\{[^}]*opacity/.test(baseCssRaw));
  ok('...and the caret follows the last letter, with no measured position',
    /\.bt-caret\.is-on \{ display: inline-block; animation: btBlink/.test(baseCssRaw));
  // The reduced-motion block is not a courtesy: if app.js never runs, or dies part-way,
  // this paints the whole word anyway — and the markup has it to paint.
  ok('...and every letter is shown for anyone who has asked for less motion',
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,200}?\.bt-lt \{ display: inline !important; \}/.test(baseCssRaw) &&
    /prefersReducedMotion\(\)/.test(appCode));
  // …and the timings are NOT in the stylesheet. Half a chain in each file is a chain nobody
  // can change.
  ok('...and the sequence lives in one place, in app.js',
    /function startBrandTyping\(\)/.test(appCode) &&
    /function stopBrandTyping\(\)/.test(appCode) &&
    /BT_LETTER_MS/.test(appCode) &&
    !/animation-duration/.test((baseCssRaw.match(/\.bt-[^{]*\{[^}]*\}/g) || []).join('\n')));
  // The loop runs only while the sign-in screen IS the screen: the intro covers it until it
  // finishes, so a chain started at parse time would be seconds into its loop before anybody
  // could see it — and a chain left running after sign-in mutates hidden DOM for the length
  // of a session.
  ok('...and it runs only while the sign-in screen is the one on screen',
    /startBrandTyping\(\);/.test(showAuthBody) &&
    /function showApp\(\) \{[\s\S]{0,900}?stopBrandTyping\(\);/.test(appCode));
  // ── …AND THE LETTERS DO NOT SLIDE ─────────────────────────────────────────────
  // Hiding an untipped letter is necessary but not sufficient, and the first cut of this
  // shipped with only that half: a heading centred on whatever is on screen is re-laid out
  // on every keystroke, so every letter already placed drifts outward as the next one
  // arrives. Measured in a real browser on 2026-10-08: the finished word is 155px wide, so
  // the "I" travelled 79px to the left over the first second of every loop — an unfolding,
  // not a typewriter, and not what "appears as if being typed" means. The fix is a box
  // reserved to the finished word's width with the text left-aligned inside it.
  ok('...and the word is typed into a box of the FINISHED width, so no letter slides',
    /function reserveBrandBox\(\)/.test(appCode) &&
    /if \(width > 0\) box\.style\.minWidth = Math\.ceil\(width\) \+ 'px'/.test(appCode) &&
    /\.landing-wordmark \{[^}]*text-align: left/.test(baseCssRaw));
  // The reserve must sit BEFORE startBrandTyping()'s `_btRun` guard. Behind it, a
  // sign-out/sign-in would find the chain already looping and skip the measure — and the
  // second visit to the landing page is exactly when a zero-width first measure (the screen
  // not yet laid out) would still need repairing.
  ok('...measured on every entry to the landing screen, not only the first',
    /reserveBrandBox\(\);\s*[\s\S]{0,400}?if \(_btRun\) return;/.test(appCode));

  // ── THE EMPLOYEE PANEL: ONE LIST, FOUR DOORS ──────────────────────────────────
  // The owner, 2026-10-08: *"it should see all 4 login options like vercel where all options
  // are listed in a single list where at the top is 'Log in to I-PASSBOOK' then is a box for
  // entering email, below it is a button 'Continue', below it is a line which separates next
  // below option which is 'continue with indrones' official email' then below it 'continue
  // with fingerprint/passkey' then below it 'continue with pattern'. there is no space for
  // forgot password now because we are not having any password based login anyfurther."*
  const empCard = (doorsBlock.match(/<section class="door [^"]*" id="door-employee"[\s\S]*?<\/section>/) || [''])[0];
  const empForm = (empCard.match(/<form id="auth-form"[\s\S]*?<\/form>/) || [''])[0];
  ok('the employee door still owns the one #auth-form',
    (doorsBlock.match(/<form id="auth-form"/g) || []).length === 1 && empForm.length > 200);
  ok('...headed by the owner’s own first line, over a field, over Continue',
    /<h2 class="door-title" id="auth-title" data-i18n="auth\.loginTitle">Log in to I-PASSBOOK<\/h2>/.test(empForm) &&
    /<input class="form-input" type="email" id="auth-email"/.test(empForm) &&
    /<button type="submit" class="btn" id="auth-signin-btn" data-i18n="auth\.continue">Continue<\/button>/.test(empForm));
  ok('...in that order, with the divider after Continue and the alternatives under it',
    empForm.indexOf('id="auth-title"') < empForm.indexOf('id="auth-email"') &&
    empForm.indexOf('id="auth-email"') < empForm.indexOf('id="auth-signin-btn"') &&
    empForm.indexOf('id="auth-signin-btn"') < empForm.indexOf('id="auth-or"') &&
    empForm.indexOf('id="auth-or"') < empForm.indexOf('id="auth-google-btn"'));
  // THE DIVIDER IS THE BLOCK'S, NOT GOOGLE'S. It used to be keyed on `!!CONFIG.SSO_URL`
  // from when the Google button was the only thing under it. It sits above three
  // alternatives, and since 2026-10-08 two of them — the unlock pair — are drawn on every
  // entry screen whether or not this device can use them, so "is there anything below me"
  // and "is this the entry screen" are the same question.
  ok('...and the divider is shown for the whole alternatives block, not for Google alone',
    /set\('auth-or',\s*firstStep && \(!!CONFIG\.SSO_URL \|\| quickOn\)\)/.test(appCode));
  ok('...and it ships hidden, so a JS-off page never shows a lone "or"',
    /<div class="auth-or" id="auth-or" style="display:none">/.test(empForm));
  // ── FOUR ANSWERS TO ONE QUESTION, AND ONE OF THEM IS THE ACCENT ───────────────
  // `.btn-secondary`, NOT a bare `.btn`, on all three alternatives. industrial.css gives a
  // bare `.btn` on this screen the accent, so that a door's ONE action reads as the door —
  // and four bare buttons stacked in one list is four yellow buttons and a hierarchy of
  // none. It is also what the page he pointed at does: vercel.com's own list is one filled
  // "Continue with Email" over four neutral alternatives.
  ok('...and the three alternatives are .btn-secondary, leaving one accent on the panel',
    /class="btn btn-secondary" id="auth-google-btn"/.test(empForm) &&
    /class="btn btn-secondary" id="auth-unlock-btn"/.test(empForm) &&
    /class="btn btn-secondary" id="auth-pattern-link"/.test(empForm) &&
    (empForm.match(/class="btn btn-secondary"/g) || []).length === 3 &&
    (empForm.match(/class="btn"/g) || []).length === 1);
  ok('...named as the owner named them, each one an answer to the same question',
    /data-i18n="auth\.sso">Continue with Indrones’ official email<\/button>/.test(empForm) &&
    /data-i18n="auth\.unlock">Continue with fingerprint \/ passkey<\/button>/.test(empForm) &&
    /data-i18n="auth\.usePattern">Continue with pattern<\/button>/.test(empForm));
  // BOTH DOORS ARE ALWAYS OFFERED ON THE ENTRY SCREEN. The owner, 2026-10-08: *"to the users
  // who have not so far activated fingerprint/passkey and pattern method, it would still
  // show it to them but when they try to click on it and use that method it would say to
  // them that 'This login method activates after you enable it from your login.'"* — which
  // reverses the earlier "an offer that opens onto nothing is worse than no offer", and is
  // a better rule for the same reason the old one was tidy: a person who has never heard of
  // the feature cannot miss it. What a tap does is what the record decides.
  ok('...and the pair is one block, and both doors are drawn whether or not this device has them',
    /<div id="auth-quick" style="display:none">[\s\S]*?id="auth-unlock-btn"[\s\S]*?id="auth-pattern-link"[\s\S]*?<\/div>/.test(empForm) &&
    /const quickOn = \(entry \|\| mode === 'pattern'\);/.test(appCode) &&
    /set\('auth-unlock-btn',\s*mode === 'pattern' \? fp : true\);/.test(appCode) &&
    /set\('auth-pattern-link',\s*mode === 'pattern' \? pat : true\);/.test(appCode));
  // …and the tap that has nothing to open explains itself, in the owner's sentence plus the
  // four steps that turn the method on. Asserted on BOTH halves: a note with no steps is the
  // sentence he already had, and steps that do not reach a real control are worse than none.
  ok('...and tapping a door this device has not got explains how to get it, in four steps',
    /function showMethodInactiveNote\(\)/.test(appCode) &&
    /if \(!methodReady\('fingerprint'\)\) return showMethodInactiveNote\(\);/.test(appCode) &&
    /if \(!methodReady\('pattern'\)\) return showMethodInactiveNote\(\);/.test(appCode) &&
    (empForm.match(/data-i18n="auth\.methodInactive\.step[1-4]"/g) || []).length === 4 &&
    /data-i18n="auth\.methodInactive\.say">This login method activates after you enable it from your login\.<\/p>/.test(empForm));
  // The guidance is only worth having if it points at controls that exist. So the label
  // is read OUT OF the menu that owns it — syncQuickUnlockMenu changes that row's wording
  // with the device's state — and the note is then required to say the same words. A note
  // that sends someone looking for a row that is called something else is worse than the
  // silence it replaced, and this is the assertion that keeps the two spellings married.
  ok('...and the steps name the controls the app actually has',
    (() => {
      const rowLabel = (appCode.match(/btn\.textContent = '(Turn on Quick unlock)';/) || [])[1];
      return !!rowLabel && i18nCode.includes(rowLabel) &&
        /id="auth-method-note-close"/.test(empForm) &&
        /hideMethodInactiveNote\(\);/.test(appCode);
    })());
  // `.btn-quick` was the fingerprint button's own class and it is GONE, not dormant: three
  // suites used to name it and nothing on screen carries it any more.
  ok('...and the retired .btn-quick class is gone from the markup and from the stylesheet',
    !/btn-quick/.test(html) && !/btn-quick/.test(baseCss));
  // ── AND THERE IS NO PASSWORD LOGIN LEFT TO RECOVER ────────────────────────────
  // *"there is no space for forgot password now because we are not having any password based
  // login anyfurther."* Asserted as an ABSENCE — in the markup, the table and the code —
  // because a control comes back by accretion. What is NOT gone is the first-login password,
  // which is a different thing wearing similar clothes and is the only door a brand-new
  // account has; see #auth-pwd-link.
  ok('there is no "Forgot password?" control anywhere on the landing page',
    !/Forgot password/i.test(htmlCode) && !/auth-forgot/.test(htmlCode) &&
    !/cust-forgot/.test(htmlCode) && !/auth-forgot/.test(appCode) &&
    !/function submitCustomerPassword/.test(appCode) &&
    !/auth\.forgot/.test(i18nJs) && !/cust\.forgot/.test(i18nJs));
  ok('...and no password-reset flow survives anywhere either',
    !/auth-new-password|auth-reset-wrap/.test(htmlCode) &&
    !/auth-new-password|auth-reset-wrap/.test(appCode) &&
    !/id="cust-password"/.test(htmlCode) && !/id="cust-password"/.test(appCode));

  // ── THE CUSTOMER DOOR: THE OWNER'S OWN WORDS, AND NO PASSWORD ─────────────────
  // It SIGNS IN, here, because the owner asked for one page with two doors on it — a door
  // that hands you to another page to be opened is not one door. All of it is the SAME
  // backend action the staff door uses: `login` with no password IS the OTP door.
  const custCard = (doorsBlock.match(/<section class="door [^"]*" id="door-customer"[\s\S]*?<\/section>/) || [''])[0];
  const custForm = (custCard.match(/<form id="cust-form"[\s\S]*?<\/form>/) || [''])[0];
  ok('the customer door carries its own sign-in form',
    custForm.length > 200);
  ok('...opening with the three lines the owner wrote, in the markup and in the table',
    /<p class="cust-welcome" data-i18n="cust\.welcome">Welcome! This is I-PASSBOOK<\/p>/.test(custForm) &&
    /<p class="cust-tagline" data-i18n="cust\.tagline">For everything related to Indrones’ after-sales<\/p>/.test(custForm) &&
    /<p class="cust-lead" data-i18n="cust\.login">Log in to your I-PASSBOOK account\.<\/p>/.test(custForm) &&
    /'cust\.welcome':\s*'Welcome! This is I-PASSBOOK'/.test(i18nJs) &&
    /'cust\.login':\s*'Log in to your I-PASSBOOK account\.'/.test(i18nJs));
  ok('...then the address, then the helper line UNDER it, quiet, and not a placeholder',
    /<input class="form-input" type="email" id="cust-email"/.test(custForm) &&
    /<p class="cust-helper" id="cust-hint" data-i18n="cust\.emailHelper">Use your official email registered with us while onboarding as a customer<\/p>/.test(custForm) &&
    custForm.indexOf('id="cust-email"') < custForm.indexOf('id="cust-hint"') &&
    custForm.indexOf('id="cust-hint"') < custForm.indexOf('id="cust-signin-btn"') &&
    /'cust\.emailHelper':\s*'Use your official email registered with us while onboarding as a customer'/.test(i18nJs));
  ok('...then Continue, then the divider, then the desk’s own address',
    /<button type="submit" class="btn" id="cust-signin-btn" data-i18n="cust\.continue">Continue<\/button>/.test(custForm) &&
    /<div class="auth-or" id="cust-or"><span data-i18n="cust\.or">or<\/span><\/div>/.test(custForm) &&
    /<p class="cust-unregistered" data-i18n="cust\.unregistered">if you are not registered with us so far, contact customer\.relations@indrones\.com for onboarding\. See you there!<\/p>/.test(custForm) &&
    /'cust\.unregistered':\s*'if you are not registered with us so far, contact customer\.relations@indrones\.com for onboarding\. See you there!'/.test(i18nJs));
  ok('...offering the address and the mailed code, and no password at all',
    /id="cust-email"/.test(custForm) &&
    !/type="password"/.test(custForm) && !/type="password"/.test(custCard));
  // …and the code itself is NOT in here. It lives on its own screen now, shared with the
  // employee's door, because an employee at this step and a customer at this step are in the
  // SAME state — an address that has been mailed a 6-digit code.
  ok('...and no code block inside the door, which is what the shared screen replaced',
    !/id="cust-code"/.test(htmlCode) && !/id="cust-code"/.test(appCode) &&
    !/cust-code-wrap/.test(htmlCode) && !/cust-code-wrap/.test(appCode) &&
    !/auth-login-code-wrap/.test(htmlCode) && !/auth-login-code-wrap/.test(appCode));
  // The app.js side of the same decision: ONE stage-1 request, and it is the passwordless
  // one. `password: ''` is not an empty password — the backend reads the ABSENCE of a real
  // one as the OTP door — so a revert to a password route would have to change this line and
  // would fail here.
  ok('...and its one request is the passwordless door, handing to the shared code screen',
    /customerAuth\('login', \{ email: email, password: '' \}\)\.then\(d => \{/.test(appCode) &&
    /openCodeView\('customer', email, ''\); return; \}/.test(appCode));
  // A customer who already holds a session is not asked again — and it is read from the
  // CUSTOMER's key, never the staff one, so a staff session on this machine cannot open this
  // door and the customer's cannot open the app's.
  ok('...and a customer already holding a session gets the way in instead of the form',
    /<div id="cust-session" style="display:none">[\s\S]*?<a class="btn" id="customer-space-open" href="customer\.html" data-i18n="door\.openSpace">/.test(custCard) &&
    /localStorage\.getItem\('ipbc_session'\)/.test(appCode) &&
    /localStorage\.setItem\('ipbc_session'/.test(appCode) &&
    /localStorage\.setItem\('ipbc_user'/.test(appCode));

  // ── THE CODE STEP: ONE SCREEN FOR BOTH DOORS ──────────────────────────────────
  // The owner, 2026-10-08: *"it lands in next screen totally blank and in center it says
  // 'Check your email' in big heading and below it is 'If you have a indrones after sales
  // account, we sent a code to <that email id>.' in normal text size. then equivant number
  // of boxes below that line to fill the code. and a button below boxes saying 'Use a
  // different account'. clicking this button will land back to initial login page."*
  const codeBlock = (html.match(/<div id="code-view">[\s\S]*?<!-- ========== FIRST-LOGIN PASSWORD CHANGE/) || [''])[0];
  ok('the code step is a screen of its own, a SIBLING of the landing page',
    codeBlock.length > 300 &&
    html.indexOf('<div id="code-view">') > html.indexOf('<div id="auth-container">') &&
    html.indexOf('<div id="code-view">') > html.indexOf('</section>', html.indexOf('id="door-customer"')),
    { at: html.indexOf('<div id="code-view">') });
  ok('...headed "Check your email" in a big heading, with the address it went to',
    /<h2 class="code-title" id="code-title" data-i18n="code\.title">Check your email<\/h2>/.test(codeBlock) &&
    /data-i18n="code\.sub">If you have a indrones after sales account, we sent a code to<\/span>\s*<strong class="code-email" id="code-email"><\/strong>/.test(codeBlock) &&
    /'code\.title':\s*'Check your email'/.test(i18nJs));
  // SIX REAL <input> ELEMENTS, not one field with a six-cell background. That is what opens
  // the phone's numeric keypad on the first box and lets the OS offer the code straight from
  // the mail. `inputmode="numeric"`, NEVER `type="number"`: a number field on a phone gives a
  // keypad with a decimal point, and — the one that actually bites — silently drops a leading
  // zero, which is a real digit of a real code. The `type="number"` scan is written as "an
  // input with that type", because the note in the markup names the type it refuses.
  const boxes = [...codeBlock.matchAll(/<input class="code-box"[^>]*\/>/g)].map(m => m[0]);
  ok('...over six real boxes, each one a text field with a numeric keypad',
    boxes.length === 6 &&
    boxes.every(b => /type="text"/.test(b) && /inputmode="numeric"/.test(b) && /maxlength="1"/.test(b)) &&
    !/<input[^>]*type="number"/.test(codeBlock),
    boxes.length);
  ok('...each carrying its OWN accessible name, so the language layer reaches all six',
    boxes.every((b, i) => b.indexOf('data-i18n-aria="code.digit"') >= 0 &&
                          b.indexOf('data-i18n-var-n="' + (i + 1) + '"') >= 0) &&
    /'code\.digit':\s*'Digit \{n\} of the code'/.test(i18nJs));
  // `autocomplete="one-time-code"` on the FIRST box only: it is the hint the OS reads to
  // offer the code from the mail, and repeating it on all six makes some browsers offer it
  // six times.
  ok('...with the one-time-code hint on the first box and on no other',
    /autocomplete="one-time-code"/.test(boxes[0]) &&
    boxes.slice(1).every(b => !/autocomplete="one-time-code"/.test(b)));
  ok('...and "Use a different account" is the one way out, under them',
    /<button type="button" class="link-btn" id="code-different" data-i18n="code\.different">Use a different account<\/button>/.test(codeBlock) &&
    codeBlock.indexOf('id="code-boxes"') < codeBlock.indexOf('id="code-different"'));
  // NO RESEND ANYWHERE, and that is a decision rather than an omission: the owner's list for
  // this screen is the heading, the sub-line, the boxes and that one button, and a "send it
  // again" would be the one control here whose only possible behaviour is to send mail.
  ok('...inside a form, with one place to say it went wrong and no resend beside it',
    /<form id="code-form" autocomplete="off">/.test(codeBlock) &&
    /<p id="code-error" class="auth-error" style="display:none"><\/p>/.test(codeBlock) &&
    !/resend/i.test(codeBlock) && !/Send the code again/i.test(codeBlock) &&
    !/code\.resent|code\.resend|code\.verifying/.test(i18nCode));
  // ── …and the machinery app.js owns, since six boxes means owning the caret ────
  ok('opening the step takes the WHOLE landing page down, and stops the wordmark typing',
    /function openCodeView\(door, email, password\) \{[\s\S]{0,1800}?authCont\.style\.display = 'none';/.test(appCode) &&
    /function openCodeView\(door, email, password\) \{[\s\S]{0,1800}?stopBrandTyping\(\);/.test(appCode));
  ok('...and closing it puts back the door that ASKED, not the Employee’s by default',
    /function closeCodeView\(restore\) \{[\s\S]{0,900}?setDoor\(_codeDoor === 'customer' \? 'customer' : 'employee', true\);/.test(appCode));
  ok('...and a code arriving all at once always fills from the FIRST box',
    /const start = \(digits\.length >= boxes\.length\) \? 0 : Math\.max\(0, Math\.min\(from, boxes\.length - 1\)\);/.test(appCode));
  // Busy as an ATTRIBUTE rather than as disabled boxes: disabling the field the person is
  // looking at moves the screen under them, and the answer they are waiting for lands right
  // here. `data-busy` dims the group in CSS; the guard in app.js is what stops the second
  // submit.
  ok('...and checking it is busy in a way that does not take the screen away',
    /if \(cv && cv\.dataset\.busy === '1'\) return;/.test(appCode) &&
    /cv\.dataset\.busy = '1'; cv\.setAttribute\('aria-busy', 'true'\);/.test(appCode) &&
    /#code-view\[data-busy="1"\] \.code-boxes \{ opacity: 0\.5; \}/.test(baseCss));
  // WHICH REQUEST IS MADE IS THE ONLY THING THE DOOR CHANGES. A customer's code is checked by
  // the same backend action the staff door uses — `login` with no password IS the OTP door —
  // but a customer's session must be written under the customer's keys and hand off to
  // customer.html, which is finishCustomerAuth's job and not finishAuth's.
  ok('...and a customer’s code is checked by the staff door’s own action, under the customer’s keys',
    /const req = \(_codeDoor === 'customer'\)/.test(appCode) &&
    /\? customerAuth\('login', \{ email: _codeEmail, password: '', code: code \}\)/.test(appCode) &&
    /: loginBackend\(_codeEmail, _codePassword, code\);/.test(appCode) &&
    /finishCustomerAuth\(_codeEmail, d\);/.test(appCode));

  // ── WHAT EVERY VISITOR PASSES, BELOW BOTH DOORS ───────────────────────────────
  const doorsEnd = html.indexOf('</section>', html.indexOf('id="door-customer"'));
  const termsAt  = html.indexOf('<p class="landing-terms"');
  const footAt   = html.indexOf('<div class="landing-foot">');
  ok('the acknowledgement is one line below both doors, said once',
    termsAt > doorsEnd && footAt > termsAt &&
    /<p class="landing-terms"><span data-i18n="landing\.termsPre">By continuing, you acknowledge that you understand and agree to the <\/span><a href="terms\.html" data-i18n="landing\.termsTos">Terms &amp; Conditions<\/a><span data-i18n="landing\.termsAnd"> and <\/span><a href="privacy\.html" data-i18n="landing\.termsPrivacy">Privacy Policy<\/a><\/p>/.test(html) &&
    /'landing\.termsPre':\s*'By continuing, you acknowledge that you understand and agree to the '/.test(i18nJs),
    { termsAt, doorsEnd });
  // ⚠ BOTH PHRASES ARE NOW REAL ANCHORS, and the four keys around them are what makes that
  // possible: `data-i18n` sets an element's textContent, so a single-key sentence with an
  // anchor nested inside it would have its link wiped on every repaint. Asserted rather than
  // assumed, because the failure is silent — the sentence still reads correctly, it just
  // stops being clickable, and the page it should have opened is unreachable.
  ok('...with both phrases linked, and split into keys so the anchors survive a repaint',
    /<a href="terms\.html" data-i18n="landing\.termsTos">/.test(htmlCode) &&
    /<a href="privacy\.html" data-i18n="landing\.termsPrivacy">/.test(htmlCode) &&
    /'landing\.termsTos':\s*'Terms & Conditions'/.test(i18nJs) &&
    /'landing\.termsPrivacy':\s*'Privacy Policy'/.test(i18nJs) &&
    !/'landing\.terms':/.test(i18nJs));
  // Both pages must actually SHIP. A link to a page the deploy never publishes is the same
  // 404 the two phrases were plain text to avoid. Checked against the deploy tool's own
  // SERVED list rather than a second hand-kept list here, so the two cannot drift.
  const deploySrc = read('./deploy-ghpages.mjs');
  const exists = p => { try { read(p); return true; } catch (e) { return false; } };
  ok('...and both pages exist and are published',
    exists('../terms.html') && exists('../privacy.html') &&
    /'terms\.html'/.test(deploySrc) && /'privacy\.html'/.test(deploySrc));
  // The language picker, where the owner asked for it ("a language select option at bottom
  // like in notion.app"). Its options are BUILT by app.js from I18N.LANGS, one per language, so
  // a language added to that list appears here with no second edit.
  ok('the language picker is a native select, filled from the language table',
    /<div class="landing-lang">\s*<select id="lang-select" aria-label="Language" data-i18n-aria="landing\.language"><\/select>/.test(html) &&
    /function buildLangSelect\(\) \{[\s\S]{0,700}?window\.I18N\.LANGS\.forEach\(l => \{/.test(appCode) &&
    /LANGS:/.test(i18nJs) && /'landing\.language':\s*'Language'/.test(i18nJs));
  // ⚠ THE CONTROL IS REAL AND THE CHOICE IS REMEMBERED; what is behind two of its three
  // options today is English, through I18N's per-string fallback. That is said rather than
  // implied — a picker that silently did nothing would be worse than no picker at all.
  ok('...and the choice it makes is remembered on the device',
    /setLang/.test(i18nJs) && /getElementById\('lang-select'\)/.test(appCode) &&
    /addEventListener\('change'/.test(appCode));
  // The foot: the desk's two doors, below BOTH and outside either. Anchored on the CUSTOMER
  // section's closing tag rather than merely on the grid's, because a foot that drifted one
  // level in would sit inside a card — which "comes after .doors" would happily pass.
  //
  // It was a <p> holding two links; on 2026-10-10 the owner moved one out and one in —
  // *"We need to remove report a problem button from login page, this element is for
  // customers after loging in. Help and FAQ button and Language button can be placed
  // adjacent."* So it is a <div> now: the Help & FAQ link, and the language picker pulled
  // up out of a sibling line of its own so the two sit beside each other.
  const footHtml = html.slice(footAt, html.indexOf('</div>', html.indexOf('id="lang-select"')) + 6);
  ok('the Help & FAQ and the language picker are one common foot, below both doors',
    footAt > doorsEnd &&
    /<div class="landing-foot">[\s\S]*?id="auth-faq-link"[\s\S]*?id="lang-select"/.test(html) &&
    !/auth-faq-link|lang-select/.test(custCard) &&
    !/auth-faq-link|lang-select/.test(empCard));
  ok('...and it is a centred line, not a card of its own',
    /\.landing-foot \{[\s\S]*?justify-content:\s*center/.test(baseCss) &&
    /\.landing-foot \{[\s\S]*?display:\s*flex/.test(baseCss));
  // ⚠ "Report a problem" IS NOT ON THIS SCREEN ANY MORE, and the id that drives it is
  // deliberately still in the document — it just lives where the thing it opens actually
  // exists. It used to be here, next to the FAQ link, and opened a form for somebody who had
  // not signed in yet; the owner's words were "this element is for customers after loging
  // in". `wireCustomerDoor()` and smoke-door-faq still resolve the id, so moving the button
  // was the whole change — nothing was deleted and no feature was orphaned.
  ok('...and "Report a problem" is off the sign-in screen entirely',
    !/customer-door-open/.test(footHtml) &&
    footHtml.indexOf('auth-faq-link') > -1);
  ok('...because it moved behind the sign-in, still hidden until a form is configured',
    /<button type="button" class="nav-item" id="customer-door-open" style="display:none"/.test(html) &&
    /getElementById\('customer-door-open'\)/.test(appCode));

  // ── THE CORNER: WHAT REPLACES "SIGN UP" ────────────────────────────────────────
  // The owner, 2026-10-08: *"since we do not have any signup options … we would have whatsapp
  // button instead there, so that who so ever wants any further help can click on that button
  // and come to official indrones after sales whatsapp chat with us ready to receive them
  // there."*
  ok('the top-right corner holds the desk’s WhatsApp chat, and there is no sign-up',
    /<a class="wa-corner" id="whatsapp-btn" href="#" target="_blank" rel="noopener noreferrer"/.test(html) &&
    /<span class="wa-glyph" aria-hidden="true"><\/span>/.test(html) &&
    /data-i18n-aria="door\.whatsapp"/.test(html) &&
    !/sign ?up/i.test(htmlCode));
  // HIDDEN WHILE CONFIG.WHATSAPP_URL IS EMPTY, and that is the honest state rather than an
  // unfinished one: a button that opens an empty tab is worse than no button, and there is no
  // Indrones after-sales WhatsApp link anybody here can verify. Paste the URL and it appears,
  // with no other change.
  ok('...and it is off the screen entirely until a number is configured',
    /<a class="wa-corner" id="whatsapp-btn"[^>]*style="display:none"/.test(html) &&
    /function wireWhatsApp\(\) \{[\s\S]{0,300}?const url = CONFIG\.WHATSAPP_URL;/.test(appCode) &&
    /if \(!url\) \{ btn\.style\.display = 'none'; return; \}/.test(appCode));
  // ⚠ IT IS A LABELLED PILL IN THE BOTTOM-RIGHT AS OF 2026-10-10, NOT A BARE DISC IN THE
  // TOP-RIGHT. The owner: *"whatsapp button to be made as in indrones.com 'get in touch'"*.
  // What the old assertions pinned — a 44px grey circle whose meaning had to be guessed, or
  // hovered for a `title` — is exactly what he asked to have replaced, so the position half
  // of this check moved with the design rather than being deleted.
  ok('...carrying the words, not a glyph a person has to guess at',
    /<span class="wa-label" data-i18n="door\.whatsappCta">Get in touch<\/span>/.test(html) &&
    /\.wa-corner \{[\s\S]*?background: var\(--ind-wa\)/.test(baseCss) &&
    /\.wa-corner:hover \{[\s\S]*?background: var\(--ind-wa-hi\)/.test(baseCss));
  // The visible word and the spoken name must agree, or voice control says what it can see
  // and hits nothing (WCAG 2.5.3). This is the one place the pair can drift.
  ok('...and its spoken name begins with the words printed on it',
    /'door\.whatsapp':\s*'Get in touch/.test(i18nCode) &&
    /'door\.whatsappCta':\s*'Get in touch'/.test(i18nCode));
  // Fixed to the SCREEN and not to the head, so it stays put while the page scrolls — and it
  // clears the phone's own home indicator via the inset, because a Safari tab on a notched
  // phone draws under the bottom edge. `top` was the status bar's inset and went with the move.
  ok('...pinned to the screen’s corner, clear of the phone’s own home indicator',
    /\.wa-corner \{[\s\S]*?position: fixed/.test(baseCss) &&
    /\.wa-corner \{[\s\S]*?env\(safe-area-inset-bottom/.test(baseCss) &&
    /\.wa-corner \{[\s\S]*?env\(safe-area-inset-right/.test(baseCss));
}

// ── The two halves of one ground ────────────────────────────────────────────────
head('the fused ground is restated for the phone, and the two restatements agree');
{
  // base.css paints the fused ground twice: once inside `@media (min-width: 1024px)` for
  // the split screen, and once inside `@media (max-width: 1023px)` for the phone, where
  // the ground is a `vh`-sized ramp rather than a feathered crossing. The second cannot
  // inherit the first's control tokens — a media query is not a scope, and `--btn-solid-*`
  // and the glass are set on `.auth-main` inside the desktop query — so they are
  // RESTATED, under the same selector, with the same values.
  //
  // ⚠ THE RESTATEMENT IS THE WHOLE RISK, and base.css's own comment promised this check:
  // "THIS SET AND THAT SET MUST MOVE TOGETHER … tools/smoke-shell.mjs holds the two lists
  // to each other so that a change to one that is not made to the other fails rather than
  // drifting." It did not, until now — which is the same defect as two spellings of one
  // thing, caught the same way. The symptom would be a control that is legible on a
  // laptop and invisible on the phone in the hangar, which is the device this app is for.
  const css = read('../base.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const SELECTOR = ':root:not([data-theme="dark"]) .auth-brand-panel[data-ground^="fuse"] ~ .auth-main {';
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Position is the ONLY thing that can tell the two apart, because the selector is
  // deliberately the same string in both — so each block's media query is found by
  // scanning backwards to the nearest one.
  const blocks = [...css.matchAll(new RegExp(esc(SELECTOR) + '([\\s\\S]*?)\\n  \\}', 'g'))].map(m => ({
    media: ((css.slice(0, m.index).match(/@media[^{]*/g) || []).pop() || '').trim(),
    decls: [...m[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)]
      .map(d => d[1] + ': ' + d[2].replace(/\s+/g, ' ').trim())
  }));
  const desktop = blocks.find(b => /min-width:\s*1024px/.test(b.media));
  const phone   = blocks.find(b => /max-width:\s*1023px/.test(b.media));

  ok('the fused ground is restated exactly twice — once per width, and neither of them gone',
    blocks.length === 2 && !!desktop && !!phone, blocks.map(b => b.media));

  ok('...and the two carry the SAME control tokens, to the value, so neither width can drift alone',
    !!desktop && !!phone && desktop.decls.length >= 8 &&
    desktop.decls.join('\n') === phone.decls.join('\n'),
    desktop && phone ? {
      desktopOnly: desktop.decls.filter(d => !phone.decls.includes(d)),
      phoneOnly:   phone.decls.filter(d => !desktop.decls.includes(d))
    } : 'a block is missing — see base.css on the phone ramp');
}

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
