#!/usr/bin/env node
// ============================================================
// build-video-options.mjs — the intro video, both ways, on one page
// ============================================================
//
//   node tools/build-video-options.mjs
//
// Writes preview/video.html: the app's REAL sign-in screen, sliced out of
// index.html, with the intro video demonstrated two ways behind a switch.
//
// ── Why this page exists, and why it is generated rather than written ────────
//
// The owner, 2026-10-10: *"the video was clearly identified to be playing in a box and
// not blended in the page. So if it is possible to blend it in the page then ok, or else
// we will keep it as a splash video. If keeping video in login page then it has to play
// everytime I am coming to login page, while if it is going to be in splash screen then
// also it will play everytime I open the app. Both in web or mobile."* And, asked which,
// *"let me see and evaluate both options, 1 and 2."*
//
// So both are built and he looks at them. A still frame cannot answer this question —
// the whole complaint is about MOTION inside a rectangle — so the review has to be a
// live page with the live video, on the device he actually reviews on.
//
// ⚠ IT SLICES index.html RATHER THAN MOCKING IT, and that is the point of the generator.
// A hand-copied sign-in screen is a picture of a screen that used to exist: this page is
// opened at the exact moment a decision is being made between two versions of that
// screen, and a mock that has drifted would make the decision on a screen neither option
// would produce. The slice is cut between two named ids, the way tools/render-fixture.mjs
// does it, so a third card or a deeper nest cannot silently shrink it.
//
// ⚠ THE PANEL KEEPS ITS SHIPPED GROUND, AND THAT IS THE FIX. The first build of this page
// renamed the panel's `data-ground` to `film` — a word with no rules behind it — so every
// `[data-ground^="fuse"]` block switched itself off and the page could paint whatever it
// liked with no `!important` in sight. It was clever and it was wrong: it produced a
// plainer page with a video on it, not the app's screen with the video blended into it,
// and the owner's answer said exactly that — *"only if it really blends in our page and
// colors."* So the shipped ground stays on and option 1 changes one thing only: the left
// end of the fused ramp, while the film is playing. Nothing in the app is touched by this
// file either way.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'preview', 'video.html');

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ── The slice ──────────────────────────────────────────────────────────────────
// Same two anchors render-fixture.mjs uses. `display:none` is the shipped state and
// `flex` is what showAuth() sets on it, so it is set here the same way.
let landing = (() => {
  const start = indexHtml.indexOf('<div id="auth-container">');
  const end = indexHtml.indexOf('<div id="password-change">');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('cannot slice the landing screen out of index.html — the anchors moved');
  }
  return indexHtml.slice(start, end)
    .replace('<div id="auth-container">', '<div id="auth-container" style="display:flex">')
    // This page lives one directory down, so everything index.html points at by a
    // relative path has to be walked back up one. A missed one is a broken link that
    // only shows up on the page a person actually clicks.
    .replace(/(src|href)="assets\//g, '$1="../assets/')
    .replace(/href="(faq|terms|privacy)\.html"/g, 'href="../$1.html"');
})();

// ── The two options' own CSS ───────────────────────────────────────────────────
// Everything here is scoped to `html[data-opt]`, so it exists only on this page.
//
// ── OPTION 1: THE RAMP ITSELF STARTS AT THE FILM'S OWN FIELD ────────────────────
//
// The first version of this option renamed the panel's ground to a word with no rules
// behind it and painted a flat `#f1f1f1` panel beside a white column. It DID remove the
// box — and it also threw the app's whole look away, which is not "blending the video
// into the page", it is replacing the page. The owner said so in one line: *"only if it
// really blends in our page and colors."*
//
// SO THE PAGE KEEPS ITS FUSED GROUND, and the RAMP is what changes. `#auth-container`
// paints `--ind-ground` as ONE gradient across both halves and both halves are
// transparent over it, so the left end of that gradient is the only thing standing
// between the film and a seamless edge. Move the left end onto the film's own field and
// the rectangle has nowhere to appear.
//
// THE FIELD IS MEASURED, NOT CHOSEN. `tools/.cache/vidprobe.mjs` decodes the real MP4
// through Chrome and reads the pixels back: across six frames spanning the whole ten
// seconds the outer ring is 42-48% `#f2f2f2`, with `#f1f1f1`-`#f6f6f6` around it. The
// `#0b0b0b` in base.css's own note — "the ground the video was graded against" — is
// wrong, and this is the measurement that says so: the film is LIGHT-field art.
//
// THE CROSSING STILL CROSSES. The field holds to 46% of the screen, the black arrives by
// 54%, and the amber and the yellow follow exactly as base.css draws them. The film's own
// right edge sits at 44.4% (a 560px stage centred in a 720px half of a 1440px screen), so
// it is inside the solid field with room to spare — that number is the reason the stage
// is not widened.
// THE FIELD HOLDS PAST THE HEAD, AND THE BLACK IS WHAT GIVES WAY. The first attempt kept
// base.css's black band and opened the field only to 46%, which put the black straight
// under the head: "WELCOME TO INDRONES'" came out dark-on-black and half of it vanished.
// The head is set in ink and lives at 60% of the width, so the field has to reach about
// 56% and the crossing to the yellow has to be complete before the head starts. That
// means the black goes while the film is playing — and the black is the one thing that
// cannot stay, because the fusion puts it in the same half the film needs to be light in.
// It returns the moment the film ends, when the still and the heartbeat take over.
//
// THE CROSSING IS STILL A CROSSING, in the owner's own fourth word and at the width the
// fuse block argues for: field to yellow over ~12% of the width, still climbing as it
// passes the doors.
/* ⚠ THE FIELD IS #f4f4f4 AND NOT THE #f2f2f2 THE FILE ITSELF MEASURES, and the difference
   is not sloppiness — it is the difference between the film's EDGE and the film's CENTRE.
   The ring probe reads the outer 3% of each frame, which is what the ground has to match
   when the whole frame is shown. `cover` crops that ring away, so what lands on the panel
   is the middle of the frame — and the middle of every frame carries a soft white bloom
   around the mark, four levels brighter. Measured on the render, not inferred: a scanline
   across the stage reads #f2f2f2 outside it and #f6f6f6 inside, which is exactly the faint
   rectangle this number removes. tools/.cache/probe-seam.ps1 prints those rows.
   AND THE EDGE IS FEATHERED ANYWAY, because the bloom means no single value is right
   everywhere: the mask lets the last 22% of the stage fade into the ground, so the film
   has no boundary at all — only a value that approaches the ground's. */
// THE BLACK COMES BACK, NARROW, AT THE FOLD — and finding that it could is the reason this
// took a second pass. The first attempt dropped the black altogether, on the argument that
// the fusion puts it in the same half the film needs to be light in. That argument was
// right about the HALF and wrong about the BAND: the film's own right edge lands at 44% of
// the width and the head is not set until 60%, so there is a clear 16% of empty ground at
// the fold for the black to live in. Kept there it does the job the fuse block says it
// does — the shadowed edge of a plate lying on a coloured table — instead of being deleted.
//
// THE FIELD HOLDS PAST THE FILM. The field runs to 44% and the film's edge is at 44.4%, so
// the crossing starts just after the film ends and never crosses the artwork.
const optionCss = `
:root { --ind-film: #f4f4f4; }

/* ⚠ THE SELECTOR IS THIS LONG BECAUSE IT HAS TO BE, and the reason is worth keeping:
   base.css sets the fused ramp on #auth-container through
   :root:not([data-theme="dark"]) #auth-container:has(> .auth-brand-panel[data-ground="fuse-feather"])
   which counts 1 id and 4 classes. A plain html[data-opt="1"] #auth-container counts 1
   id and 1 class and LOSES SILENTLY — the page renders, the film plays, and the ramp
   never moves. :has(> .auth-brand-panel[data-brand="video"]) is what wins, and it is also
   the honest condition: the light end of the ramp exists only while the film does. */
:root:not([data-theme="dark"])[data-opt="1"] #auth-container:has(> .auth-brand-panel[data-brand="video"]) {
  --ind-ground: linear-gradient(96deg,
    var(--ind-film) 0%, var(--ind-film) 45%,
    #0b0b0b 50%, #1d1808 53%, #6b5200 56%,
    #d9a600 59%, var(--ind-yellow) 63%,
    #ffd21a 80%, #ffe066 100%);
}

/* THE FILM COVERS ITS SQUARE, WHICH COSTS NOTHING AND IS WORTH SAYING WHY. The video is
   16:9 in a 1:1 stage, so "contain" letterboxes it to 56% of the square's height and the
   artwork — already framed with a wide margin inside its own frame — comes out at about
   half the size the resting artwork is. "cover" scales it to fill the square instead. On
   any other video that would crop the picture; on THIS one it crops nothing that can be
   seen, because the field the crop eats is one flat colour edge to edge. The artwork spans
   x400-800 of 1280, so the 44% the crop removes comes off the margin.
   THE FEATHER IS RADIAL AND SIZED OFF THE STAGE, so it holds at every width: solid to 72%
   of the nearest edge, which leaves the artwork (22%-78% of the square) untouched. */
html[data-opt="1"] .auth-brand-panel .brand-video {
  opacity: 1;
  object-fit: cover;
  -webkit-mask-image: radial-gradient(closest-side, #000 72%, transparent 100%);
          mask-image: radial-gradient(closest-side, #000 72%, transparent 100%);
}
html[data-opt="1"] .auth-brand-panel .brand-still,
html[data-opt="1"] .auth-brand-panel .brand-heartbeat { opacity: 0; }

/* ── THE PHONE, WHICH IS THE HALF OF THIS HE NAMED OUT LOUD ──────────────────────
   *"Both in web or mobile."* Under 1024px base.css draws no stage at all — the panel is
   a compact brand head on the page's ground and nothing large is downloaded before
   sign-in — so option 1 on a phone has to CHOOSE a place for the film: a 16:9 band across
   the top of the column, above the head.

   ⚠ THE CROSSING IS VERTICAL HERE, AND THE FIELD IS SHORT, AND BOTH OF THOSE WERE LEARNED
   FROM A RENDER RATHER THAN ARGUED. The first phone build reused the desktop idea — a
   long field with a black band in the middle — and the black landed squarely on the head:
   "WELCOME TO INDRONES'" and "LOGIN" came out dark-on-black and half of them were gone.
   The band is 219px of an 844px screen, the head runs from 26% to 58%, and so the field
   has to stop at the foot of the film and the yellow has to have arrived before the head
   begins. There is no room left for the black, so on a phone there is none; the ground
   goes field to yellow and the dark top of the shipped phone ramp is simply replaced by
   the film that is standing in it.

   THE MASK CHANGES SHAPE WITH THE BAND. A radial mask sized off "closest-side" is right
   for a square and wrong for a 16:9 band — on a 390x219 band it would fade the left and
   right thirds of the FILM away. On a phone the feather is on the bottom edge, where the
   band meets the page. ⚠ NO BACKTICKS IN HERE: this comment lives inside a JS template
   literal, and a stray backtick ends the string and throws at the next space. */
@media (max-width: 1023px) {
  :root:not([data-theme="dark"])[data-opt="1"] #auth-container:has(> .auth-brand-panel[data-brand="video"]) {
    --ind-ground: linear-gradient(180deg,
      var(--ind-film) 0%, var(--ind-film) 27%,
      #6b5200 31%, var(--ind-yellow) 38%,
      #ffd21a 70%, #ffe066 100%);
  }
  html[data-opt="1"] .auth-brand-panel .brand-stage {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
  }
  html[data-opt="1"] .auth-brand-panel .brand-video {
    -webkit-mask-image: linear-gradient(180deg, #000 0 86%, transparent 100%);
            mask-image: linear-gradient(180deg, #000 0 86%, transparent 100%);
  }
  /* THE MARK GOES, BECAUSE THE FILM IS ALREADY DRAWING IT. The head is the phone's brand
     material in full — a mark, the wordmark and the strap line — and with the film above
     it the screen would draw the same monogram twice, once in motion and once still. The
     mark is the duplicate; the wordmark and the strap are text and stay, and the h1 in
     particular must never leave the tree. */
  html[data-opt="1"] .auth-brand-panel .landing-mark { display: none; }
}

/* ── THE SPLASH, WHICH IS OPTION 2 ──────────────────────────────────────────────
   A cover over everything, the video letterboxed on its own field rather than on black,
   so even the cover has no box in it. It is dismissed by the video ending or by one tap,
   and it comes back on every single load — that is the option, not an oversight. */
html[data-opt="2"] .vd-splash { display: flex; }
.vd-splash {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--ind-film);
  opacity: 1;
  transition: opacity 0.5s ease;
}
.vd-splash.is-gone { opacity: 0; pointer-events: none; }
.vd-splash video { width: 100%; height: 100%; object-fit: contain; }
.vd-splash .vd-skip {
  position: absolute;
  right: 1rem;
  bottom: 1rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--ind-paper-rule);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  color: #171717;
  font: 500 13px/1 var(--font-sans, system-ui);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

/* ── THE REVIEW BAR ────────────────────────────────────────────────────────────
   Pinned to the viewport bottom and UNDER the splash, which is the whole reason it is
   at 9000 and the splash at 10000: what a person sees first has to include the splash
   and nothing of the review. */
.vd-bar {
  position: fixed;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  z-index: 9000;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.4rem;
  border-radius: 999px;
  background: rgba(12, 12, 12, 0.88);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.42);
  font: 500 13px/1 var(--font-sans, system-ui);
  color: #f1f1f1;
  max-width: calc(100vw - 1.5rem);
}
.vd-bar b { font-weight: 600; padding: 0 0.45rem; white-space: nowrap; }
.vd-bar button {
  padding: 0.4rem 0.75rem;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.vd-bar button.is-here { background: var(--ind-yellow); color: #171717; font-weight: 600; }
.vd-bar .vd-sep { width: 1px; height: 18px; background: rgba(255, 255, 255, 0.22); margin: 0 0.2rem; }
@media (max-width: 640px) {
  .vd-bar { flex-wrap: wrap; justify-content: center; border-radius: 1rem; }
  .vd-bar b { width: 100%; text-align: center; }
}
`;

// ── The page ───────────────────────────────────────────────────────────────────
const page = `<!doctype html>
<html lang="en" data-opt="1">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title>I-PASSBOOK — the intro video, two ways</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap" rel="stylesheet" />
<!-- The app's own cascade, in the app's own order, walked back one directory.
     industrial.css stays LAST for the reason its header gives. -->
<link rel="stylesheet" href="../tokens.css" />
<link rel="stylesheet" href="../palette.css" />
<link rel="stylesheet" href="../theme.css" />
<link rel="stylesheet" href="../base.css" />
<link rel="stylesheet" href="../components.css" />
<link rel="stylesheet" href="../views.css" />
<link rel="stylesheet" href="../industrial.css" />
<style>${optionCss}</style>
</head>
<body>

${landing}

<!-- ── OPTION 2, the cover. Empty in the markup: the video element is built by the
     script below, so that a page opened in option 1 never asks the network for a
     second copy of the film. -->
<div class="vd-splash" id="vd-splash">
  <video id="vd-splash-video" muted playsinline preload="none" src="../assets/brand-intro.mp4"></video>
  <button type="button" class="vd-skip" id="vd-skip">Skip</button>
</div>

<!-- ── THE REVIEW BAR ── -->
<div class="vd-bar">
  <b>The intro&nbsp;video</b>
  <button type="button" data-opt="1" class="is-here">1 · blended into the page</button>
  <button type="button" data-opt="2">2 · full-screen splash</button>
  <span class="vd-sep"></span>
  <button type="button" id="vd-replay">Replay</button>
</div>

<script>
(function () {
  var root   = document.documentElement;
  var panel  = document.querySelector('.auth-brand-panel');
  var stageV = document.getElementById('brand-video');     // option 1's video, in the panel
  var coverV = document.getElementById('vd-splash-video'); // option 2's video, in the cover
  var splash = document.getElementById('vd-splash');
  var bar    = document.querySelector('.vd-bar');

  // THE GROUND WORD IS LEFT ALONE, AND THAT IS THE CHANGE FROM THE FIRST BUILD OF THIS
  // PAGE. Renaming it to "film" switched every [data-ground^="fuse"] rule off — the ramp,
  // the glass on the two door cards, the card shadows — which made this page a plainer
  // page with a video on it rather than the app's own screen. The panel now keeps the
  // shipped "fuse-feather", and option 1 changes ONE thing: the left end of that ramp,
  // and only while the film is playing.
  if (panel) panel.dataset.ground = panel.dataset.ground || 'fuse-feather';

  // The panel ships at data-brand="rest" - still and heartbeat and no video - because
  // that is the honest JS-off state and the state a device that HAS seen the intro gets.
  // Option 1 is the other state, so it is set here and the video asked for by name.
  function playInPage() {
    if (!panel || !stageV) return;
    panel.dataset.brand = 'video';
    try { stageV.currentTime = 0; } catch (e) {}
    var p = stageV.play();
    if (p && p.catch) p.catch(function () { panel.dataset.brand = 'rest'; });
  }

  function playCover() {
    splash.classList.remove('is-gone');
    try { coverV.currentTime = 0; } catch (e) {}
    var p = coverV.play();
    if (p && p.catch) p.catch(function () { dismiss(); });
  }

  function dismiss() {
    splash.classList.add('is-gone');
    try { coverV.pause(); } catch (e) {}
    // The sign-in screen is live underneath from the first frame; the cover is the only
    // thing that was ever in front of it, and it is now transparent.
  }

  // ── The switch ──
  function show(which) {
    root.dataset.opt = which;
    Array.prototype.forEach.call(bar.querySelectorAll('button[data-opt]'), function (b) {
      b.classList.toggle('is-here', b.dataset.opt === which);
    });
    if (which === '2') playCover();
    else { dismiss(); playInPage(); }
  }
  Array.prototype.forEach.call(bar.querySelectorAll('button[data-opt]'), function (b) {
    b.addEventListener('click', function () { show(b.dataset.opt); });
  });
  document.getElementById('vd-replay').addEventListener('click', function () {
    if (root.dataset.opt === '2') playCover(); else playInPage();
  });
  document.getElementById('vd-skip').addEventListener('click', dismiss);
  coverV.addEventListener('ended', dismiss, { once: false });

  // ── The first frame: option 1, playing, the moment the page paints ──
  // NO "ONCE PER VERSION" GATE ANYWHERE ON THIS PAGE, and that is the second half of
  // what he asked for: whichever option he picks, the film plays EVERY time — every
  // arrival at the sign-in screen for option 1, every launch for option 2. Reload this
  // page to see exactly that.
  playInPage();
})();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, page);
console.log(OUT);
console.log(`  ${page.length} bytes · landing slice ${landing.length} bytes`);
