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

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const appJs = read('../app.js');
const html = read('../index.html');
const viewsCss = read('../views.css');

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
const cascade = ['tokens.css', 'palette.css', 'base.css', 'components.css', 'views.css']
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
// The intro plays once per device and is then skipped. The failure mode this
// guards is quiet: if the file 404s or the name changes, the splash still goes
// away — the fallback timer dismisses it — so the app looks fine and just never
// shows the intro. Nothing else in the suite would notice.
head('the intro video');
const swJs = read('../sw.js');

const videoTag = (html.match(/<video id="splash-video"[\s\S]*?<\/video>/) || [''])[0];
ok('the splash video tag exists', videoTag.length > 0);
ok('it points at the current intro file',
  /src="assets\/intro_ipassbookv2\.mp4"/.test(videoTag),
  videoTag.replace(/\s+/g, ' '));
ok('and no longer references the file it replaced',
  !/Indrones Intro v2\.mp4/.test(html) && !/Indrones Intro v2\.mp4/.test(appJs));
ok('the file it points at exists on disk',
  fs.existsSync(new URL('../assets/intro_ipassbookv2.mp4', import.meta.url)));
// preload="none" + no autoplay is what stops a RETURNING user downloading ~9.7 MB
// for a splash they will never be shown. Either attribute alone would fetch it.
ok('it is preloaded lazily and not autoplayed',
  /preload="none"/.test(videoTag) && !/\bautoplay\b/.test(videoTag),
  videoTag.replace(/\s+/g, ' '));
// Precaching it in SHELL would make EVERY first-time install pay the whole
// download before sign-in, which is the opposite of what lazy loading bought.
ok('it is not precached in the service worker shell',
  !/intro_ipassbookv2/.test(swJs));

// Read the real duration out of the MP4 header, so the timer below is checked
// against the file rather than against a number someone typed. This is the bug
// that shipped before: a 2000ms timer against a 3940ms video, so the intro was
// always cut off mid-play.
const mp4DurationMs = (() => {
  const b = fs.readFileSync(new URL('../assets/intro_ipassbookv2.mp4', import.meta.url));
  const i = b.indexOf('mvhd');
  if (i < 0) return null;
  const v = b[i + 4];
  if (v === 1) return null;
  const timescale = b.readUInt32BE(i + 16);
  const duration = b.readUInt32BE(i + 20);
  return timescale ? (duration / timescale) * 1000 : null;
})();
ok('the intro is a readable MP4', mp4DurationMs !== null, mp4DurationMs);

const fallbackMs = Number((appJs.match(/INTRO_FALLBACK_MS\s*=\s*(\d+)/) || [])[1]);
ok('app.js declares an intro fallback timer', Number.isFinite(fallbackMs), fallbackMs);
ok('the fallback is at least as long as the video, so it never cuts it',
  mp4DurationMs !== null && fallbackMs >= mp4DurationMs,
  { fallbackMs, mp4DurationMs });

head('the intro plays once, then is skipped');
ok('app.js keys the "already seen" flag on localStorage',
  /INTRO_SEEN_KEY/.test(appJs) &&
  /localStorage\.getItem\(INTRO_SEEN_KEY\)/.test(appJs) &&
  /localStorage\.setItem\(INTRO_SEEN_KEY/.test(appJs));
ok('the flag is recorded, not replayed, when the intro is shown',
  appJs.indexOf("localStorage.setItem(INTRO_SEEN_KEY") < appJs.indexOf('video.play()'),
  { set: appJs.indexOf("localStorage.setItem(INTRO_SEEN_KEY"), play: appJs.indexOf('video.play()') });
// The pre-paint script must set this BEFORE the body is parsed, or a returning
// user sees the splash flash before app.js hides it.
const prePaint = (html.match(/<head>[\s\S]*?<\/head>/) || [''])[0];
ok('the pre-paint script sets data-intro before the body parses',
  /data-intro/.test(prePaint) && /introSeen/.test(prePaint));
ok('base.css hides the splash off that attribute',
  /html\[data-intro="seen"\]\s*#splash-screen\s*\{[^}]*display:\s*none/.test(read('../base.css')));

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
