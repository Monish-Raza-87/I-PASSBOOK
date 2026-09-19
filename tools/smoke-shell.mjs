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

// The splash plays every time a device arrives at the sign-in screen. The one
// device that skips it is one that is ALREADY SIGNED IN — nine seconds of video in
// front of a session that was going to resume anyway is a delay, not a welcome.
//
// That decision is made twice: once before paint in index.html (which cannot call
// into app.js, because app.js has not parsed yet) and once in app.js's boot path.
// The two must ask the same question, and nothing in this app fails as quietly as
// they would by drifting: the stylesheet hides the splash while the boot path
// plays the video, or the boot path skips while the splash is still on screen, and
// either one only ever shows up on a real device.
head('the splash skip and the boot path ask the same question');
const prePaint = (html.match(/<head>[\s\S]*?<\/head>/) || [''])[0];
ok('index.html decides the skip before paint, off BOTH stored keys',
  /getItem\('ipb_user'\)/.test(prePaint) && /getItem\('ipb_session'\)/.test(prePaint));
// Before the body is parsed, or the person whose session is resuming sees the
// splash flash for a frame before app.js hides it.
ok('...and marks it with data-splash="skip"',
  /setAttribute\('data-splash', 'skip'\)/.test(prePaint));
ok('base.css hides the splash off that exact attribute',
  /html\[data-splash="skip"\]\s*#splash-screen\s*\{[^}]*display:\s*none/.test(read('../base.css')));
ok('app.js asks it once, through hasStoredSession()',
  /function hasStoredSession\(\)/.test(appJs) &&
  /localStorage\.getItem\(USER_KEY\) && localStorage\.getItem\(SESSION_KEY\)/.test(appJs));
// ...and the NAMES agree, not merely the shape. "index.html reads two keys" is not
// the claim; "index.html reads the two keys app.js reads" is. A renamed constant on
// one side is exactly the drift this block exists to catch, and reading the
// literals out of their declarations is the only way to compare them.
const userKey = (appJs.match(/const USER_KEY\s*=\s*'([^']+)';/) || [])[1];
const sessionKey = (appJs.match(/const SESSION_KEY\s*=\s*'([^']+)';/) || [])[1];
ok('app.js declares the two keys it checks',
  !!userKey && !!sessionKey, { user: userKey, session: sessionKey });
ok('index.html checks THOSE keys, spelled the same way',
  !!userKey && !!sessionKey &&
  prePaint.includes("getItem('" + userKey + "')") &&
  prePaint.includes("getItem('" + sessionKey + "')"),
  { user: userKey, session: sessionKey });
ok('the boot path consults the same predicate',
  /if \(hasStoredSession\(\)\) \{ dismissSplash\(true\); return; \}/.test(appJs));
// The old once-per-device flag is gone, not merely unused: a leftover write would
// keep working and quietly make the intro once-per-device again for anyone whose
// key it set, which is the bug the owner asked to have removed.
ok('the old once-per-device flag is gone from every file',
  !/introSeen/.test(appJs) && !/introSeen/.test(html) &&
  !/data-intro/.test(appJs) && !/data-intro/.test(html) && !/data-intro/.test(read('../base.css')));

// The splash is sized to the VIEWPORT, not to the video's own pixels. This is
// asserted because the wrong version is the one that looks right when you read
// it: `min-width/min-height: 100%` with `width/height: auto` reads as full-bleed,
// but a replaced element with auto sizing keeps its INTRINSIC size and the
// minimums only ever raise it. That shipped, and put a 1080x1920 element on a
// phone, so the centring crop showed 47% x 43% of the frame against the desktop's
// 74% x 74% — the owner reported the result as the mobile intro "not appearing
// properly". object-fit: cover is what does the cropping, deliberately, once the
// element is the size of the screen.
head('the splash video fills the screen instead of zooming into the middle of it');
const splashVideo = (read('../base.css').match(/\.splash-video\s*\{[^}]*\}/) || [''])[0];
ok('.splash-video is pinned to the viewport, not to its own pixel size',
  /inset:\s*0/.test(splashVideo) &&
  /width:\s*100%/.test(splashVideo) && /height:\s*100%/.test(splashVideo),
  splashVideo);
ok('...and it does not size itself from the video\'s intrinsic dimensions',
  !/width:\s*auto/.test(splashVideo) && !/height:\s*auto/.test(splashVideo) &&
  !/min-width/.test(splashVideo) && !/min-height/.test(splashVideo),
  splashVideo);
ok('object-fit: cover does the cropping, so the aspect ratio is preserved',
  /object-fit:\s*cover/.test(splashVideo));
// The phone cut is chosen by a media query on <source>, and the phone cut is the
// portrait one — so if this pairing drifts, the phone silently gets the 16:9
// desktop frame it has no room for.
ok('the portrait mobile cut is offered first, gated to phone widths',
  /intro_ipassbookv2_mobile\.mp4[\s\S]{0,120}max-width:\s*639px/.test(html) &&
  html.indexOf('intro_ipassbookv2_mobile.mp4') < html.indexOf('intro_ipassbookv2.mp4"'),
  (html.match(/<video id="splash-video"[\s\S]{0,400}/) || [''])[0]);

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
  /class="auth-logo"/.test(html) && /assets\/icon-mark\.png/.test(authHead));
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
  !/class="auth-logo"[^>]*icon-192/.test(html) &&
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
// The bug this pins, found by the owner in dark mode and by nobody on the light
// page: the cutout's flood fill reached INSIDE the circle, through the light
// knockout band behind the "Passbook" script, and punched out the monogram and
// the lettering. On a light page that is invisible — a transparent hole shows the
// page, and the page is the same near-white the artwork's background was. On the
// dark one the whole mark became an empty box.
//
// A dimension check and a "not blank" check both pass on the hollowed-out mark,
// so this decodes the pixels and counts them. The white monogram and script
// knockouts are ~22,000 fully opaque near-white pixels when the mark is intact
// and ~800 when the fill has eaten them — the numbers below are measured against
// both versions of the real file, not chosen.
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
  let clear = 0, solid = 0, nearWhiteSolid = 0;
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3];
    if (a === 0) { clear++; continue; }
    if (a !== 255) continue;
    solid++;
    const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    if (lum > 230) nearWhiteSolid++;
  }
  return { clear, solid, nearWhiteSolid, total: w * h };
})();

ok('the mark still contains its white artwork — the fill did not eat the monogram',
  !!markStats && markStats.nearWhiteSolid > 8000,
  markStats ? `${markStats.nearWhiteSolid} opaque near-white px (hollowed-out mark: ~800)` : 'unreadable PNG');
ok('and that white is a real share of the mark, not a few stray rim pixels',
  !!markStats && markStats.nearWhiteSolid / markStats.solid > 0.1,
  markStats ? `${(100 * markStats.nearWhiteSolid / markStats.solid).toFixed(1)}% of opaque px are near-white` : '');
ok('the background is still transparent — the fix did not put the square back',
  !!markStats && markStats.clear / markStats.total > 0.3 && markStats.clear / markStats.total < 0.6,
  markStats ? `${(100 * markStats.clear / markStats.total).toFixed(0)}% transparent` : '');

// The mark's two tones are both dark, so on the dark surface it is invisible as
// drawn. inverted it is legible, and the inversion is what keeps the artwork's
// internal contrast (the monogram is a knockout in the disc, so it inverts with
// it). Both in-app marks have to be covered, or one of them stays a blank box.
const baseCss = read('../base.css');
ok('dark mode inverts BOTH in-app marks, so neither is a blank box on the dark page',
  /\[data-theme="dark"\]\s*\.brand-mark\s+img\s*,\s*\[data-theme="dark"\]\s*\.auth-logo\s*\{[^}]*filter:\s*invert\(1\)/.test(
    baseCss.replace(/\s+/g, m => m.includes('\n') ? '\n' : ' ')),
  (baseCss.match(/\[data-theme="dark"\][^{]*\{[^}]*invert[^}]*\}/) || ['none — the mark is invisible in dark mode'])[0]);
// brightness(0) invert(1) flattens the mark to a single colour, and the monogram
// disappears into the disc. It is the obvious-looking wrong answer here.
ok('and it is invert(1), NOT brightness(0) invert(1) which flattens the mark',
  !/\[data-theme="dark"\][^{]*\{[^}]*brightness\(0\)[^}]*\}/.test(baseCss));

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
// …and the credit line, on the sign-in card as well as inside the app. The
// wording is the owner's, verbatim — "by Mr. Raza For Indrones", capital F.
ok('the credit is on the sign-in card, not only behind the sign-in',
  /app-credit/.test((html.match(/<div id="auth-container">[\s\S]*?<\/div>\s*<\/div>/) || [''])[0]) &&
  /Mr\. Raza For Indrones/.test(html));
// …filled by one writer, so there is one place to look when the number is wrong.
ok('app.js fills every slot through the shared .app-version class',
  /querySelectorAll\('\.app-version'\)/.test(appJs));
// And the sign-in flow must not raise the toast that covered the code box: the
// note under the field already states both cases in full, so the toast was a
// duplicate that sat over the very controls the user was reaching for.
const otpStep = (appJs.match(/const gotoOtpStep = \([\s\S]*?\n  \};/) || [''])[0];
ok('the code step sets the inline note', /auth-login-code-note/.test(otpStep));
ok('...and raises NO toast over the code box', otpStep !== '' && !/showToast/.test(otpStep), otpStep.slice(0, 80));

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
