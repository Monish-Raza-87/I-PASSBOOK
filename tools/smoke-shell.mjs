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

// Two cuts of the same intro. The phone one must come FIRST and carry the media
// gate: <source> selection takes the first entry that matches, so a desktop file
// listed first would win on a phone as well and the portrait cut would never play.
const sources = [...videoTag.matchAll(/<source\s+src="[^"]+"[^>]*>/g)].map(m => m[0]);
ok('the splash offers two cuts of the intro', sources.length === 2, sources);
ok('the phone cut is listed first and is the media-gated one',
  /intro_ipassbookv2_mobile\.mp4/.test(sources[0] || '') &&
  /media="\(max-width: 639px\)"/.test(sources[0] || '') &&
  !/media=/.test(sources[1] || ''),
  sources);
ok('both cuts exist on disk',
  ['intro_ipassbookv2.mp4', 'intro_ipassbookv2_mobile.mp4']
    .every(f => fs.existsSync(new URL(`../assets/${f}`, import.meta.url))));
ok('and no longer references the file it replaced',
  !/Indrones Intro v2\.mp4/.test(html) && !/Indrones Intro v2\.mp4/.test(appJs));
// preload="none" + no autoplay is what stops a RETURNING user downloading the
// intro for a splash they will never be shown. Either alone would fetch it.
ok('it is preloaded lazily and not autoplayed',
  /preload="none"/.test(videoTag) && !/\bautoplay\b/.test(videoTag),
  videoTag.replace(/\s+/g, ' '));
// Precaching either cut in SHELL would make EVERY first-time install pay the
// whole download before sign-in, which is the opposite of what lazy loading bought.
ok('neither cut is precached in the service worker shell',
  !/intro_ipassbookv2/.test(swJs));

// Nothing is drawn over the intro. A darkening layer with backdrop-filter: blur()
// used to sit on top of it — the owner saw the result as a blurry video — and the
// wordmark that sat on that layer moved to the sign-in card. Scoped to the splash
// block and the splash styles, because `backdrop-filter` is used legitimately
// elsewhere (the frosted headers).
const splashBlock = (html.match(/<div id="splash-screen">[\s\S]*?<!-- ========== AUTH SCREEN/) || [''])[0];
ok('nothing is layered over the video',
  splashBlock.length > 0 &&
  !/splash-overlay|splash-logo|splash-sub|class="[^"]*overlay/.test(splashBlock),
  splashBlock.replace(/\s+/g, ' ').slice(0, 200));
const splashCss = (read('../base.css').match(/SPLASH[\s\S]*?AUTH SCREEN/) || [''])[0];
ok('and no blur or darkening rule is left in the splash styles',
  splashCss.length > 0 &&
  !/backdrop-filter|splash-overlay|splash-logo|splash-sub/.test(splashCss));
// The card, not the splash, is where the full product name now lives. Bounded by
// the hint paragraph rather than by the next </div>, which closes .auth-brand.
const authHead = (html.match(/<div class="auth-head">[\s\S]*?id="auth-hint-text"/) || [''])[0];
ok('the product name moved to the sign-in card',
  /Indrones Product After-Sales Summary Book/.test(authHead),
  authHead.replace(/\s+/g, ' '));

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
const durations = {
  desktop: mp4DurationMs('intro_ipassbookv2.mp4'),
  mobile: mp4DurationMs('intro_ipassbookv2_mobile.mp4')
};
ok('both cuts are readable MP4s', Object.values(durations).every(v => v !== null), durations);

const fallbackMs = Number((appJs.match(/INTRO_FALLBACK_MS\s*=\s*(\d+)/) || [])[1]);
ok('app.js declares an intro fallback timer', Number.isFinite(fallbackMs), fallbackMs);
ok('the fallback outlasts the longer cut, so it truncates neither',
  Object.values(durations).every(v => v !== null && fallbackMs >= v),
  { fallbackMs, ...durations });

// The loader bar is timed from the video, not from a number in the stylesheet —
// it used to reach 100% at 1.85s while nine seconds of intro were still playing,
// which read as a stuck progress bar.
ok('the loader bar is timed from the video itself',
  /--intro-ms/.test(appJs) && /var\(--intro-ms/.test(read('../base.css')));

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
ok('the sign-in card shows the mark',
  /class="auth-logo"/.test(html) && /assets\/icon-192\.png/.test(authHead));
// The sidebar mark was a lettered "IP" square standing in for the logo, which is
// exactly the sort of placeholder that survives a redesign because nothing breaks
// when it does. It is the icon now — and the same file the sign-in card uses, so
// the app cannot end up wearing two different marks.
ok('the sidebar brand mark is the icon, not a lettered stand-in',
  /class="brand-mark"[^>]*>\s*<img[^>]*assets\/icon-192\.png/.test(html) &&
  !/class="brand-mark"[^>]*>\s*[A-Za-z]/.test(html),
  (html.match(/class="brand-mark"[\s\S]{0,120}/) || [''])[0]);

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
  const master = new URL('../assets/icon-master.jpeg', import.meta.url);
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

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
