// Real-browser boot smoke test.
//
//   node tools/smoke-boot.mjs
//
// The vm-based suites (smoke-ir-state, smoke-intake, smoke-shell) evaluate app.js
// under a stubbed DOM. That proves the logic and the DOM contract, but it cannot
// prove the app BOOTS in a real engine: parse-time errors, boot-order mistakes
// and a mis-wired tab would all pass there and fail here.
//
// So this serves the repo and drives headless Chrome through a ticket deep link
// (#/tickets/<ir>), then asserts on the DOM Chrome actually produced. It is the
// check the Phase 1 and Stage 1 commits both recorded as missing ("no browser
// here").
//
// If no Chrome is installed it prints SKIP and exits 0 — this is a dev-side
// check, not something a deploy should depend on.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const chromePath = CHROME_CANDIDATES.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

if (!chromePath) {
  console.log('SKIP  no Chrome/Edge found — real-browser boot test not run');
  process.exit(0);
}

// ── Static server for the repo ────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ── The Sheet fixture, for the second phase ───────────────────────────────────
// The Form Responses header row as backend.gs describes it, with plausible
// questions at E, J and O — the three columns its IR_REPO_*_COL constants do not
// account for. The live render must surface all three.
const HEADERS = [
  'Summary', 'IR Number', 'Timestamp', 'Issue Status', 'Your Role', 'SPOC',
  'What Support Is Required?', 'Please Describe Your Problem', 'Date of Incident', 'Score',
  'Mention the Drone Serial No (S250XX)', "Who's Reporting? (Name & Contact)",
  'Incident Location and Weather', 'Evidence: Attach Files From The Incident', 'Internal Notes',
  'Email Address', 'Evidence: Attach Screenshot of UAV Forecast', 'Where Do You Work?',
];
const ROW = [
  'https://docs.google.com/document/d/FIXTURE', 'IR409', '2025-09-28 14:02:03', 'In Production',
  'CRM', 'Monish Raza', 'Hardware Damage', 'Drone arm cracked during landing', '2025-09-25',
  '9', 'S25P014', 'SREENIVAS PAI 7828148298', 'Pune, 32C clear',
  'https://drive.google.com/file/d/N/view', 'chase the courier',
  'ops@agrikart.in', 'https://drive.google.com/file/d/Q/view', 'AgriKart Pvt Ltd',
];
const csvCell = v => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
const SHEET_CSV = [HEADERS, ROW].map(r => r.map(csvCell).join(',')).join('\n');

// Stubs only the Sheet read and blocks everything else, so a real network can
// never make this test pass or fail by accident. Injected ahead of app.js, which
// captures window.fetch at parse time.
const FIXTURE_PATH = '/__sheet-fixture.html';
const STUB = `<script>
  window.fetch = function (url) {
    if (String(url).indexOf('gviz/tq') >= 0) {
      return Promise.resolve(new Response(${JSON.stringify(SHEET_CSV)},
        { status: 200, headers: { 'Content-Type': 'text/csv' } }));
    }
    return Promise.reject(new Error('blocked in test'));
  };
<\/script>
`;

// ── The probe channel ─────────────────────────────────────────────────────────
// Filled by the browser, read by the phase below.
const PROBE_PATH = '/__probe';
let probeFromBrowser = null;
let probePosts = 0;
let markProbeDone = null;
const probeArrived = new Promise(res => { markProbeDone = res; });
const probeDone = () => markProbeDone(probeFromBrowser);

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(String(req.url).split('?')[0].split('#')[0]);
  const send = (body, type) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };

  // The auth probe reports over HTTP rather than into the DOM. Scraping a rendered
  // <pre> meant the phase depended on Chrome deciding to EXIT: --dump-dom only prints
  // when the virtual-time budget runs out, and a page that keeps a timer or a fetch
  // alive can stall that indefinitely — which is what it did, dumping nothing at all.
  // A POST cannot stall.
  if (url === PROBE_PATH && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      if (parsed) {
        probePosts++;
        probeFromBrowser = parsed;      // always keep the latest, for diagnosis
        if (parsed.done) probeDone();   // ...but only a finished run ends the wait
      }
      res.writeHead(204); res.end();
    });
    return;
  }

  if (url === FIXTURE_PATH) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    // Inject ahead of the app script so the stub is in place before it evaluates.
    return send(html.replace('<script src="app.js"></script>', STUB + '<script src="app.js"></script>'), MIME['.html']);
  }

  if (url === AUTH_PATH) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    return send(html
      .replace('<script src="app.js"></script>', AUTH_STUB + '<script src="app.js"></script>')
      .replace('</body>', AUTH_DRIVER + '</body>'), MIME['.html']);
  }

  if (url === INTRO_PATH || url === INTRO_SIGNED_IN_PATH) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const seed = url === INTRO_SIGNED_IN_PATH ? SIGNED_IN_SEED : '';
    return send(html
      .replace('<head>', '<head>' + seed)
      .replace('</body>', INTRO_DRIVER + '</body>'), MIME['.html']);
  }

  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    send(buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ── The auth fixture, for the third phase ─────────────────────────────────────
// The only way to prove the two-step sign-in and the password reveal is to run
// them in a real engine: the vm suites stub `document.querySelectorAll` to return
// [], so the reveal buttons there are inert, and smoke-boot's main phase boots
// through the DEV BYPASS — which skips the form entirely.
//
// So this fixture answers the GAS endpoints with a scripted backend and drives the
// form with real clicks, reporting each step back over HTTP as it happens. Chrome is
// only ever asked to LOAD a URL here, so the probe has to be self-driving.
const AUTH_PATH = '/__auth-fixture.html';

// Injected BEFORE app.js: app.js captures window.fetch at parse time as _origFetch
// and loginBackend posts through _origFetch, so this is the only place a stub can
// stand. Non-login GAS calls get a benign error object rather than a rejection —
// finishAuth() fires refreshMyAccess() immediately after a successful sign-in, and
// an unhandled rejection there would show up as a console error this suite would
// then blame on the app.
const AUTH_STUB = `<script>
  var _realFetch = window.fetch.bind(window);
  window.fetch = function (url, init) {
    var u = String(url);
    // The probe reports back over the same origin. Everything else that is not a GAS
    // endpoint stays blocked, so a real network can never make this phase pass.
    if (u.indexOf('${PROBE_PATH}') >= 0) return _realFetch(url, init);
    if (u.indexOf('script.google.com') < 0) return Promise.reject(new Error('blocked in test'));
    var action = '';
    try { action = (init && init.body && init.body.get) ? String(init.body.get('action') || '') : ''; } catch (e) {}
    if (action !== 'login') {
      return Promise.resolve(new Response(JSON.stringify({ status: 'error', message: 'blocked in test' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    var code = '';
    try { code = String(init.body.get('code') || ''); } catch (e) {}
    var payload;
    if (!code) {
      payload = { status: 'ok', otpRequired: true, email: 'asha@indrones.com', name: 'Asha', codeSent: true };
    } else if (code === '424242') {
      payload = { status: 'ok', sessionToken: 'tok-from-probe', email: 'asha@indrones.com',
                  access: { role: 'user', permissions: { 'sec-b': 'view' }, departments: [], triage: false } };
    } else {
      payload = { status: 'error', message: 'Wrong code. 4 attempt(s) left.' };
    }
    return Promise.resolve(new Response(JSON.stringify(payload),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
<\/script>
`;

// Injected AFTER app.js, so the app is fully defined before the probe starts.
// Every step is recorded even when a later one times out, so a failure names the
// step that broke rather than reporting one opaque timeout.
const AUTH_DRIVER = `<script>
// Every step is reported as it happens, so a run that dies halfway still says where.
// The driver must be self-driving: Chrome is only ever asked to load a URL here.
(function () {
  var out = { steps: [] };
  function post() {
    try { _realFetch('${PROBE_PATH}', { method: 'POST', body: JSON.stringify(out) }); } catch (e) {}
  }
  function log(k, v) { out[k] = v; out.steps.push(k); post(); }
  function el(id) { return document.getElementById(id); }
  function shown(id) { var e = el(id); return !!e && e.style.display !== 'none'; }
  function waitFor(fn, ms) {
    return new Promise(function (res, rej) {
      var t0 = Date.now();
      (function tick() {
        var v = false;
        try { v = fn(); } catch (e) { v = false; }
        if (v) return res(true);
        if (Date.now() - t0 > ms) return rej(new Error('timeout'));
        setTimeout(tick, 25);
      })();
    });
  }
  post();   // a synchronous first report: if nothing else arrives, the script ran
  (async function () {
  try {
    // Do NOT wait on shown('auth-container'): that div is visible in the STATIC
    // markup, before app.js has booted, so it is true the instant the HTML parses.
    // Racing it means clicking a Sign in button with no listener — a native form
    // submit, which reloads the page and re-runs this driver, forever. The splash
    // going away is the app taking over: showAuth() runs in that same callback, and
    // it is what wires the form and seeds the reveal buttons.
    await waitFor(function () { return !shown('splash-screen') && shown('auth-container'); }, 30000);
    log('authShown', true);
    log('appBooted', true);

    var email = el('auth-email'), pass = el('auth-password');
    email.value = 'asha@indrones.com';
    pass.value = 'hunter2hunter2';

    // ── the reveal toggle ──
    var eye = el('eye-auth-password');
    log('eyeHasGlyph', /<svg/.test(eye.querySelector('.pw-toggle-icon').innerHTML));
    log('typeBefore', pass.type);
    eye.click();
    log('typeAfter', pass.type);
    log('pressedAfter', eye.getAttribute('aria-pressed'));
    log('glyphFlipped', /<svg/.test(eye.querySelector('.pw-toggle-icon').innerHTML) &&
                        eye.querySelector('.pw-toggle-icon').innerHTML !== '');
    log('slashIsInTheGlyph', eye.querySelector('.pw-toggle-icon').innerHTML.indexOf('17 17') > -1);
    log('labelAfter', eye.getAttribute('aria-label'));
    eye.click();
    log('typeBack', pass.type);
    log('pressedBack', eye.getAttribute('aria-pressed'));

    // ── step 1: password only ──
    el('auth-signin-btn').click();
    await waitFor(function () { return shown("auth-login-code-wrap"); }, 15000);
    log('codeStepShown', true);
    log('codeNote', el('auth-login-code-note').textContent);
    log('passwordHiddenAtStep2', !shown('auth-password'));
    log('signInBtnHiddenAtStep2', !shown('auth-signin-btn'));
    log('stillNoSession', localStorage.getItem('ipb_session') === null);

    // ── step 2a: a wrong code ──
    var cin = el('auth-login-code');
    cin.value = '000000';
    el('auth-login-code-btn').click();
    await waitFor(function () {
      var e = el('auth-error');
      return !!e && e.style.display !== 'none' && /attempt/.test(e.textContent);
    }, 15000);
    log('wrongCodeError', el('auth-error').textContent);
    log('stillOnCodeStep', shown('auth-login-code-wrap'));
    log('stillNoSessionAfterWrongCode', localStorage.getItem('ipb_session') === null);

    // ── step 2b: the right code ──
    cin.value = '424242';
    el('auth-login-code-btn').click();
    await waitFor(function () { return shown("app-container"); }, 15000);
    log('signedIn', true);
    log('token', localStorage.getItem('ipb_session'));
    log('authGone', !shown('auth-container'));
  } catch (e) {
    log('failedAt', out.steps[out.steps.length - 1] || 'start');
    log('error', String((e && e.message) || e));
  }
  out.done = true;
  post();
  })();
})();
<\/script>
`;

// ── The intro probe ───────────────────────────────────────────────────────────
// The splash plays every time a device arrives at the sign-in screen, and is
// skipped only for a device that is already signed in. Both halves of that have a
// quiet failure mode — a dead video reference still lets the splash disappear (the
// fallback timer guarantees it), so a 404 looks exactly like success from the
// outside, and a skip that came from the wrong place still looks like a skip. The
// only way to tell them apart is to ask a real browser, three times:
//
//   1. a fresh device                 → the intro really plays, and really arrives
//   2. the SAME device again          → it plays AGAIN (the point of the change)
//   3. the same device, signed in     → no splash, and no 9.7 MB download
//
// Load 2 reuses the same profile on purpose. Strictly it no longer has to: what
// decides the skip is the ABSENCE of a stored session, not a memory of having seen
// the video, so a fresh profile would answer the same way. Sharing it keeps the
// claim honest — this is a device that really did play the intro once, being asked
// to play it again.
const INTRO_PATH = '/__intro.html';

// The same page, with a stored sign-in seeded before index.html's pre-paint script
// runs. The seed has to be the FIRST thing in <head>: the attribute the stylesheet
// keys off is set by that script, at parse time, before anything else could set it.
const INTRO_SIGNED_IN_PATH = '/__intro-signedin.html';
const SIGNED_IN_SEED = `<script>try{
localStorage.setItem('ipb_user', JSON.stringify({name:'Seeded Tester',email:'seeded@indrones.com',initial:'S'}));
localStorage.setItem('ipb_session','seeded-token');
}catch(e){}</script>`;

const INTRO_DRIVER = `<script>
(function () {
  function report(o) {
    try { fetch('/__probe', { method: 'POST', body: JSON.stringify(o) }); } catch (e) {}
  }
  // Sampled NOW, while this script is the last thing in the body and \`load\` has
  // not fired: app.js has already parsed and bound its load handler but has not
  // run it, so this is the splash as the person would first see it — before any
  // dismissal. The snapshot below is taken after it is gone and cannot tell a
  // skipped splash from one that merely finished.
  var visibleAtStart = null;
  var s0 = document.getElementById('splash-screen');
  if (s0) { try { visibleAtStart = getComputedStyle(s0).display !== 'none'; } catch (e) {} }
  function snap() {
    var s = document.getElementById('splash-screen');
    var v = document.getElementById('splash-video');
    var res = performance.getEntriesByType('resource') || [];
    var mp4 = res.filter(function (e) { return /intro_ipassbookv2\\.mp4/.test(e.name); });
    report({
      done: true,
      splashVisibleAtStart: visibleAtStart,
      splashInlineDisplay: s ? s.style.display : null,
      splashComputed: s ? getComputedStyle(s).display : null,
      prePaintAttr: document.documentElement.getAttribute('data-splash'),
      videoDuration: v && isFinite(v.duration) ? v.duration : null,
      videoReadyState: v ? v.readyState : null,
      videoErrorCode: v && v.error ? v.error.code : null,
      mp4Requests: mp4.length,
    });
  }
  // Wait for the splash to actually go away rather than for a fixed delay: a
  // video that plays to the end dismisses it at ~9s, one that fails dismisses it
  // at once, and the fallback covers everything between.
  var t0 = Date.now();
  (function tick() {
    var s = document.getElementById('splash-screen');
    var gone = s && (s.style.display === 'none' || getComputedStyle(s).display === 'none');
    if (gone || Date.now() - t0 > 25000) { setTimeout(snap, 400); return; }
    setTimeout(tick, 50);
  })();
})();
<\/script>
`;

// ── Drive Chrome ──────────────────────────────────────────────────────────────

// `--virtual-time-budget` lets the splash timer and the boot sequence run to
// completion before the DOM is dumped, without a real 10-second wait. It is a
// BUDGET OF VIRTUAL TIME, and every timer fired spends some of it — including the
// probe's own polling below, which is why the auth phase asks for a much larger
// one. Too small and Chrome dumps the DOM mid-wait with no probe in it at all,
// which reads as "the driver never ran" rather than "the budget ran out".
function runChrome(headlessFlag, url, budgetMs) {
  return new Promise(resolve => {
    const args = [
      headlessFlag, '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
      '--mute-audio', '--enable-logging=stderr', '--log-level=0',
      '--virtual-time-budget=' + (budgetMs || 15000), '--dump-dom', url,
    ];
    const proc = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => proc.kill(), 120000);
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', () => { clearTimeout(timer); resolve({ out, err }); });
  });
}

// `--dump-dom` prints the DOM; older/newer channels disagree on the flag name, so
// fall back rather than reporting a false failure.
let { out: dom, err: log } = await runChrome('--headless=new', `${base}/?dev=1#/tickets/IR409`);
if (!/<\/html>/i.test(dom)) ({ out: dom, err: log } = await runChrome('--headless', `${base}/?dev=1#/tickets/IR409`));

// ── Assertions ────────────────────────────────────────────────────────────────
head('the app boots');
ok('Chrome produced a DOM', /<\/html>/i.test(dom), dom.length);
ok('the splash screen is dismissed',
  /id="splash-screen"[^>]*style="[^"]*display:\s*none/.test(dom));
ok('the auth screen is hidden and the app shell is shown',
  /id="auth-container"[^>]*style="[^"]*display:\s*none/.test(dom) &&
  /id="app-container"[^>]*style="[^"]*display:\s*flex/.test(dom));

head('the ticket list rendered');
const cards = (dom.match(/class="ir-card/g) || []).length;
ok('at least one ticket card rendered', cards > 0, cards);
ok('the sync bar reported something', /id="sync-status"[^>]*>\s*<span class="sync-msg"/.test(dom),
  (dom.match(/id="sync-status"[\s\S]{0,160}/) || [''])[0]);

head('the Report tab is wired end to end');
ok('the intake tab is in the strip', /data-section="sec-intake"/.test(dom));
ok('the intake pane exists', /id="sec-intake"/.test(dom));
// The pane's own markup is nested divs, so a `</div></div>` match truncates it.
// Bound the capture by the NEXT pane instead — Section B follows the intake view.
const intakeBody = html => (html.match(/<div id="sec-intake-body">([\s\S]*?)<div id="sec-b"/) || [])[1] || '';
const intake = intakeBody(dom);
ok('renderIntake() actually painted the pane', intake.length > 200, intake.length);
ok('the read-only note is in the rendered page', /The app never edits these values/.test(dom));
ok('no undefined or NaN leaked into the report', !/undefined|NaN/.test(intake), intake.slice(0, 200));
ok('the intake pane has no editable control',
  !/<(input|textarea|select)\b/.test(intake), (intake.match(/<(input|textarea|select)\b/g) || []).slice(0, 4));

head('the six sections, and the Overview above them');
const tabStrip = (dom.match(/id="section-tabs">([\s\S]*?)<div id="sections-wrapper"/) || [])[1] || '';
const SIX = ['sec-b','sec-c','sec-d','sec-e','sec-f','sec-g'];
ok('seven tabs in the strip (six sections + Report)',
  // `class="tab( |")` and not `class="tab` — the loose form also counts a tab's
  // own inner glyph span (`class="tab-icon"`), which is not a tab.
  (tabStrip.match(/class="tab(?=[ "])/g) || []).length === 7,
  (tabStrip.match(/class="tab(?=[ "])/g) || []).length);
ok('every section tab is present',
  SIX.every(s => tabStrip.includes(`data-section="${s}"`)));
ok('Section B is the default tab', /class="tab active" data-section="sec-b"/.test(tabStrip));
ok('the six section panes are intact',
  SIX.every(s => dom.includes(`id="${s}" class="section-content`)));
// The three retired ids must leave no trace at all — not a tab, not a pane. A
// leftover `sec-g` pane next to the merged `sec-f` pane is the exact shape of a
// half-applied merge, and it would silently swallow saves into a row nothing reads.
ok('sec-a / sec-h / sec-i have neither a tab nor a pane',
  ['sec-a','sec-h','sec-i'].every(s =>
    !tabStrip.includes(`data-section="${s}"`) && !dom.includes(`id="${s}" class="section-content`)),
  ['sec-a','sec-h','sec-i'].filter(s => dom.includes(`id="${s}" class="section-content`)));

head('the Overview panel is pinned above the tabs');
// HTML comments are DOM nodes, so `--dump-dom` serialises them. index.html explains
// these very rules in a comment directly above the panel, and that prose contains
// both `id="ir-overview"` and `class="section-content"` with no `>` between them —
// so a page-wide regex matches the EXPLANATION of the rule, not a violation of it.
const domNoComments = dom.replace(/<!--[\s\S]*?-->/g, '');
ok('the Overview panel is in the DOM', /id="ir-overview"/.test(domNoComments));
ok('it is not a section pane (no section-content class)', (() => {
  const tag = (domNoComments.match(/<div id="ir-overview"[^>]*>/) || [''])[0];
  return tag.length > 0 && !/section-content/.test(tag);
})(), (domNoComments.match(/<div id="ir-overview"[^>]*>/) || [''])[0]);
ok('it sits outside the sections wrapper', (() => {
  const i = domNoComments.indexOf('id="ir-overview"'), w = domNoComments.indexOf('id="sections-wrapper"');
  return i > -1 && w > -1 && i < w;
})());
ok('the facts strip rendered', (dom.match(/class="overview-fact"/g) || []).length >= 4,
  (dom.match(/class="overview-fact"/g) || []).length);
ok('the timeline block rendered', /id="ir-timeline"/.test(dom));
ok('the Overview save button is in the DOM', /id="save-overview"/.test(dom));

head('the activity log moved below the sections, and ships collapsed');
// The unit suite checks the MARKUP; this checks the RENDERED page, which is the
// only place the moved block's ordering and its collapsed default can be seen.
ok('it renders AFTER every section',
  domNoComments.indexOf('id="ir-activity"') > domNoComments.indexOf('id="sections-wrapper"'),
  [domNoComments.indexOf('id="ir-activity"'), domNoComments.indexOf('id="sections-wrapper"')]);
ok('it renders INSIDE the detail pane, so #detail-view still means "an IR is open"',
  domNoComments.indexOf('id="ir-activity"') < domNoComments.lastIndexOf('</div>'));
ok('it is not a section pane', (() => {
  const tag = (domNoComments.match(/<div id="ir-activity"[^>]*>/) || [''])[0];
  return tag.length > 0 && !/section-content|sec-/.test(tag);
})(), (domNoComments.match(/<div id="ir-activity"[^>]*>/) || [''])[0]);
ok('the panel is CLOSED on a fresh load',
  (() => {
    const tag = (domNoComments.match(/<div id="ir-activity"[^>]*>/) || [''])[0];
    return !/is-open/.test(tag);
  })());
ok('and its toggle announces that it is closed',
  /id="ir-activity-toggle"[^>]*aria-expanded="false"/.test(domNoComments));
ok('the toggle is a real button, so the fold is keyboard-reachable',
  /<button[^>]*id="ir-activity-toggle"/.test(domNoComments));

head('the Insights dashboard renders as a sibling pane and stays out of the way');
// The unit suite pins renderLayout()'s branches; this pins the RENDERED page. The
// two claims that only a real run can make are that the pane is a sibling of
// #detail-view (not a child — #ir-activity's containment is what makes that pane's
// display mean "an IR is open"), and that it is hidden on a cold #/tickets load
// rather than sitting under the IR list.
ok('the pane exists', /<div id="insights-view"[^>]*>/.test(domNoComments),
  (domNoComments.match(/<div id="insights-view"[^>]*>/) || [''])[0]);
ok('it is not a section pane', (() => {
  const tag = (domNoComments.match(/<div id="insights-view"[^>]*>/) || [''])[0];
  return tag.length > 0 && !/section-content|sec-/.test(tag);
})(), (domNoComments.match(/<div id="insights-view"[^>]*>/) || [''])[0]);
ok('it is a SIBLING of #detail-view, so that pane keeps meaning "an IR is open"',
  (() => {
    const d = domNoComments.indexOf('id="detail-view"');
    const i = domNoComments.indexOf('id="insights-view"');
    // It must come AFTER the detail pane closes, not inside it.
    return d > -1 && i > d && domNoComments.indexOf('id="ir-activity"') < i;
  })());
ok('it is hidden — this run is on #/tickets, so the router never asked for it',
  /id="insights-view"[^>]*style="display:\s*none/.test(domNoComments),
  (domNoComments.match(/<div id="insights-view"[^>]*>/) || [''])[0]);
// The dashboard is painted even while hidden (renderInsights() runs from
// setAllIRs() on every fetch path), so the thing worth pinning is not "is it
// painted" but "is anything of it on SCREEN" — and that the demo fallback, which
// would otherwise show five fabricated rows as statistics, says so.
ok('so none of its numbers reach the screen',
  /id="insights-view"[^>]*style="display:\s*none/.test(domNoComments));
ok('nothing claims a demo sample is real data unless it is',
  !/insights-demo/.test(domNoComments) || /Could not sync — showing demo data/.test(domNoComments),
  (domNoComments.match(/insights-demo[\s\S]{0,120}/) || [''])[0]);
ok('the nav item is a hash link, and its slot got its glyph',
  /<a class="nav-item" id="nav-insights" href="#\/insights"/.test(domNoComments) &&
  /id="nav-insights"[\s\S]{0,300}?class="nav-icon"[^>]*>\s*<svg/.test(domNoComments));

head('every icon slot in the rendered page is actually filled');
// This is the check that catches a MISSING icon: `iconSvg` answers an unknown name
// with '' — correct for safety, and completely silent. A slot that is still empty
// after showApp() ran means a call site asked for a name the map does not have, and
// in a browser that is a blank button, not a failing test.
const iconSlots = [...domNoComments.matchAll(
  /<(span|div)[^>]*class="([^"]*\b(?:nav-icon|ph-icon|btn-icon|activity-caret|tab-icon|sidebar-toggle-icon|list-toggle-icon|nudge-bell-icon)\b[^"]*)"[^>]*>([\s\S]{0,400}?)<\/\1>/g)];
const emptySlots = iconSlots.filter(m => !/<svg/.test(m[3]));
ok('there are icon slots on the page at all', iconSlots.length >= 8, iconSlots.length);
ok('none of them is left empty', emptySlots.length === 0,
  emptySlots.map(m => m[2]).slice(0, 8));
ok('the IR nav glyph is an inline SVG, not an emoji or a blank',
  /id="nav-tickets"[\s\S]{0,300}?class="nav-icon"[^>]*>\s*<svg/.test(domNoComments));
ok('the comments button carries the speech-bubble icon',
  /id="ir-nudge-btn"[\s\S]{0,300}?<svg/.test(domNoComments));
ok('no SVG in the page reaches for a network asset the offline shell lacks',
  !/<svg[^>]*(xlink:href|<image|<use)/.test(dom));
ok('and no emoji is left in the chrome', !/💬|🔔|🎫|📋/.test(domNoComments),
  (domNoComments.match(/.*(?:💬|🔔|🎫|📋).*/g) || []).slice(0, 3));

head('no javascript errors');
// Chrome logs uncaught page errors to stderr with --enable-logging.
function errorsIn(text) {
  return text.split('\n').filter(l => /Uncaught|Unhandled|SyntaxError|TypeError|ReferenceError/i.test(l));
}
ok('no uncaught errors on the fallback path', errorsIn(log).length === 0, errorsIn(log).slice(0, 5));

// ── Phase 2: the path staff will actually see ─────────────────────────────────
// Phase 1 exercised the fallback (the Sheet is not reachable from here). This
// loads the app against a stubbed Sheet response, so the whole chain renders for
// real: CSV → mapSheetRows → allIRs → renderIntake → DOM.
head('the real Sheet path, rendered');
const sheetRun = await runChrome('--headless=new', `${base}${FIXTURE_PATH}?dev=1#/tickets/IR409`);
const sdom = /<\/html>/i.test(sheetRun.out)
  ? sheetRun.out
  : (await runChrome('--headless', `${base}${FIXTURE_PATH}?dev=1#/tickets/IR409`)).out;
const sbody = intakeBody(sdom);

ok('the fixture page booted', /id="app-container"[^>]*style="[^"]*display:\s*flex/.test(sdom));
ok('the report painted', sbody.length > 400, sbody.length);
ok("the customer's description is shown", sbody.includes('Drone arm cracked during landing'));
ok('the drone serial is shown', sbody.includes('S25P014'));
ok('the company is shown', sbody.includes('AgriKart Pvt Ltd'));
ok('the email is shown', sbody.includes('ops@agrikart.in'));
ok('the SPOC is shown', sbody.includes('Monish Raza'));
ok('Col L is split into name and phone', sbody.includes('SREENIVAS PAI') && sbody.includes('7828148298'));

head('the column that was dropped is now shown');
// The Sheet's Timestamp — when the client raised the IR — had no home on the
// ticket before this stage. Section A's a_dateRaised is the INCIDENT date.
ok('the raised time is rendered', sbody.includes('28 September 2025, 14:02'), sbody.slice(0, 300));
ok('and the incident date is rendered separately', sbody.includes('25 September 2025'));

head('columns the app does not model are surfaced, live');
ok('the extras block renders', sdom.includes('Other columns from the Sheet'));
ok('E/J/O are listed by their Sheet header',
  ['Your Role', 'Score', 'Internal Notes'].every(l => sbody.includes(l)), sbody.match(/Your Role|Score|Internal Notes/g));
ok('and their values come through', sbody.includes('chase the courier'));

head('links');
ok('evidence renders as real anchors',
  sbody.includes('https://drive.google.com/file/d/N/view') &&
  sbody.includes('https://drive.google.com/file/d/Q/view'));
ok('the original report link is a real anchor',
  /href="https:\/\/docs\.google\.com\/document\/d\/FIXTURE"[^>]*class="intake-open"/.test(sbody),
  (sbody.match(/<a [^>]*intake-open[^>]*>/) || [''])[0]);
ok('no undefined or NaN on the Sheet path', !/undefined|NaN/.test(sbody));

head('no javascript errors on the Sheet path');
ok('clean console', errorsIn(sheetRun.err).length === 0, errorsIn(sheetRun.err).slice(0, 5));

// ── Phase 3: the signed-OUT path — what a person actually lands on first ──────
// Phases 1 and 2 both use the ?dev=1 bypass, so neither ever renders the login
// screen. That is exactly the gap that let a broken sign-up flow ship: the auth
// UI was never loaded in a real engine. This loads it with the dev bypass OFF,
// which is the state every new employee starts in.
//
// The stub still blocks the network, so boot finds no stored session and shows
// the login screen. Nothing here proves sign-in WORKS (that needs a real backend);
// it proves the screen renders, and that the deleted sign-up machinery is gone.
head('the signed-out path');
const anon = await runChrome('--headless=new', `${base}/`);
const adom = /<\/html>/i.test(anon.out) ? anon.out : (await runChrome('--headless', `${base}/`)).out;

ok('Chrome produced a DOM', /<\/html>/i.test(adom), adom.length);
ok('the app shell is hidden',
  /id="app-container"[^>]*style="[^"]*display:\s*none/.test(adom),
  (adom.match(/id="app-container"[^>]*/) || [''])[0]);
ok('the login screen is shown',
  /id="auth-container"[^>]*style="[^"]*display:\s*flex/.test(adom),
  (adom.match(/id="auth-container"[^>]*/) || [''])[0]);
ok('the password-change screen is hidden',
  /id="password-change"[^>]*style="[^"]*display:\s*none/.test(adom),
  (adom.match(/id="password-change"[^>]*/) || [''])[0]);

head('the sign-up machinery is gone, not merely hidden');
// Absent from the DOM entirely — a hidden-but-present control is how the old
// captcha/OTP flow survived three rounds of "simplify the auth screen".
const gone = ['auth-signup-btn', 'auth-captcha-wrap', 'auth-otp-wrap', 'auth-name-wrap',
              'request-access', 'auth-toggle-mode', 'auth-website'];
ok('no deleted auth control remains in the DOM',
  gone.every(id => !adom.includes('id="' + id + '"')),
  gone.filter(id => adom.includes('id="' + id + '"')));

head('the new sign-in path is present');
['auth-form', 'auth-email', 'auth-password', 'auth-signin-btn',
 'auth-forgot-link', 'auth-forgot-wrap', 'auth-reset-wrap',
 'auth-code', 'auth-new-password', 'pc-form', 'pc-new', 'pc-confirm']
  .forEach(id => ok('#' + id + ' exists', adom.includes('id="' + id + '"')));

head('no javascript errors on the signed-out path');
ok('clean console', errorsIn(anon.err).length === 0, errorsIn(anon.err).slice(0, 5));

// ── Phase 3: sign in for real, and reveal a password ──────────────────────────
head('the password reveal and the two-step sign-in, driven in a real browser');

// Chrome is started WITHOUT --dump-dom and WITHOUT a virtual-time budget: real
// timers and a real network stack, because the probe reports over HTTP and the only
// thing this waits on is that report. The process is killed once it arrives.
async function runAuthProbe() {
  const proc = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', '--mute-audio',
    '--enable-logging=stderr', '--log-level=0',
    `${base}${AUTH_PATH}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stderr.on('data', d => { log += d; });
  const timedOut = Symbol('timeout');
  const settled = await Promise.race([
    probeArrived,
    new Promise(r => setTimeout(() => r(timedOut), 60000)),
  ]);
  try { proc.kill(); } catch { /* already gone */ }
  return { probe: settled === timedOut ? probeFromBrowser : settled, timedOut: settled === timedOut, log };
}

const ap = await runAuthProbe();
const probe = ap.probe;
if (process.env.PROBE_DEBUG) {
  console.log('RAW PROBE:', JSON.stringify(probe), '\nPOSTS:', probePosts);
  console.log('CONSOLE:', (ap.log || '').split('\n').filter(l => /:CONSOLE\(/.test(l)).slice(0, 20).join('\n'));
}
ok('the probe ran and reported back', !!probe,
  ap.timedOut ? 'no report within 60s' : (ap.log || '').slice(-400) || 'no report');
ok('it reached the end without failing', probe && !probe.error,
  probe ? { failedAt: probe.failedAt, error: probe.error, steps: probe.steps } : null);

if (probe && !probe.error) {
  head('the reveal toggle flips the field, in a real engine');
  ok('the eye button was seeded with a glyph, not left blank', probe.eyeHasGlyph === true);
  ok('the field starts masked', probe.typeBefore === 'password', probe.typeBefore);
  ok('clicking it reveals the password', probe.typeAfter === 'text', probe.typeAfter);
  ok('the button reports itself pressed', probe.pressedAfter === 'true', probe.pressedAfter);
  ok('the glyph stays a real icon after the flip', probe.glyphFlipped === true);
  ok('and it is the SLASHED eye, so the visible state is distinguishable',
    probe.slashIsInTheGlyph === true, probe.slashIsInTheGlyph);
  ok('the label switches to the action that is now available',
    probe.labelAfter === 'Hide password', probe.labelAfter);
  ok('clicking again masks it', probe.typeBack === 'password', probe.typeBack);
  ok('and un-presses the button', probe.pressedBack === 'false', probe.pressedBack);

  head('step 1 buys no session, only a code');
  ok('the code step appeared', probe.codeStepShown === true, probe.steps);
  ok('the password field is hidden at step 2', probe.passwordHiddenAtStep2 === true);
  ok('so is the Sign in button', probe.signInBtnHiddenAtStep2 === true);
  ok('the note names the address the code went to',
    /asha@indrones\.com/.test(probe.codeNote || ''), probe.codeNote);
  ok('and it gives the lifetime as a duration, not "end of the day"',
    /valid for 8:30 hours/.test(probe.codeNote || '') &&
    !/all day|end of the day|every sign-in today/i.test(probe.codeNote || ''), probe.codeNote);
  // The whole point of the two-step split: a correct password alone must not
  // produce a session token. Asserting on the real localStorage is the only check
  // here that a stubbed DOM could not make.
  ok('NO token was stored after the password step', probe.stillNoSession === true,
    probe.token);

  head('step 2 refuses a wrong code and accepts the right one');
  ok('the backend error is surfaced verbatim',
    /attempt\(s\) left/.test(probe.wrongCodeError || ''), probe.wrongCodeError);
  ok('a wrong code leaves you on the code step', probe.stillOnCodeStep === true);
  ok('and stores no token', probe.stillNoSessionAfterWrongCode === true);
  ok('the right code signs in', probe.signedIn === true, probe.steps);
  ok('the token is now in localStorage', probe.token === 'tok-from-probe', probe.token);
  ok('and the auth card is gone', probe.authGone === true);
}

// ── Phase 4: the intro plays once per device ──────────────────────────────────
head('the intro video plays on the way to sign-in, and only a signed-in device skips it');

function waitForProbe(before, ms) {
  return new Promise(res => {
    const t0 = Date.now();
    (function tick() {
      if (probePosts > before && probeFromBrowser && probeFromBrowser.done) return res(probeFromBrowser);
      if (Date.now() - t0 > ms) return res(null);
      setTimeout(tick, 100);
    })();
  });
}

// A real, persistent Chrome profile, shared by all three loads.
const introProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'ipb-intro-'));

async function runIntroLoad(ms, pagePath = INTRO_PATH) {
  const before = probePosts;
  const proc = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', '--mute-audio',
    // Muted autoplay is normally allowed, but the intro is the entire point of
    // this phase — a policy block would show up as "the video is fine but never
    // played", which is a confusing way to fail.
    '--autoplay-policy=no-user-gesture-required',
    '--enable-logging=stderr', '--log-level=0',
    '--user-data-dir=' + introProfile,
    `${base}${pagePath}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const got = await waitForProbe(before, ms);
  // Give Chrome a moment to shut the profile down cleanly before killing it. This
  // used to be load-bearing: the intro wrote an "already seen" flag to the profile's
  // LevelDB and killing the process the instant the probe arrived could lose it,
  // which made the return-visit assertions fail over a working feature. That flag is
  // gone (nothing is written by the intro any more, so nothing can be lost), and no
  // assertion now reads anything a previous load wrote — but killing a browser
  // mid-write is still not worth doing to save 1.5s.
  if (got) await new Promise(r => setTimeout(r, 1500));
  try { proc.kill(); } catch { /* already gone */ }
  return got;
}

// Real time, not virtual: the video has to actually play, and that takes ~9s.
const firstIntro = await runIntroLoad(45000);
ok('the intro probe reported from a real browser', !!firstIntro);
if (firstIntro) {
  // readyState >= 1 means Chrome really fetched and parsed the file. Without this
  // assertion the suite cannot tell a working intro from a missing one, because
  // the splash disappears either way.
  ok('the first open really loads the intro video',
    firstIntro.videoReadyState >= 1 && firstIntro.videoErrorCode === null,
    { readyState: firstIntro.videoReadyState, error: firstIntro.videoErrorCode });
  ok('it is the full-length intro, not a truncated read',
    firstIntro.videoDuration > 8.5 && firstIntro.videoDuration < 9.5,
    firstIntro.videoDuration);
  ok('the splash is on screen before anything dismisses it',
    firstIntro.splashVisibleAtStart === true, firstIntro.splashVisibleAtStart);
  ok('the splash is dismissed afterwards',
    firstIntro.splashInlineDisplay === 'none', firstIntro.splashInlineDisplay);
  ok('nothing skipped it before paint — this device had no session to resume',
    firstIntro.prePaintAttr === null, firstIntro.prePaintAttr);
}

// THE POINT OF THE CHANGE. Before this, the intro was once per device and a
// returning visitor never saw it again; the owner asked for it every time someone
// goes to the sign-in screen. `mp4Requests` is the honest signal — the splash
// element ends up display:none whether it played, failed, or was skipped, so the
// only thing that distinguishes "it played" from "it did not" is whether the
// browser went and got the video.
const secondIntro = await runIntroLoad(45000);
ok('the second open on the same device reports', !!secondIntro);
if (secondIntro) {
  ok('a device that has already seen the intro is shown it AGAIN',
    secondIntro.splashVisibleAtStart === true && secondIntro.mp4Requests >= 1,
    { visibleAtStart: secondIntro.splashVisibleAtStart, mp4: secondIntro.mp4Requests });
  ok('...because seeing it before is no longer a reason to skip it',
    secondIntro.prePaintAttr === null, secondIntro.prePaintAttr);
}

// The one thing that does skip it. A seeded sign-in is put in localStorage before
// index.html's pre-paint script runs, which is what a resuming device looks like
// from that script's side.
const signedInIntro = await runIntroLoad(30000, INTRO_SIGNED_IN_PATH);
ok('the signed-in device reports', !!signedInIntro);
if (signedInIntro) {
  ok('a device that is already signed in never sees the splash',
    signedInIntro.splashVisibleAtStart === false && signedInIntro.prePaintAttr === 'skip',
    { visibleAtStart: signedInIntro.splashVisibleAtStart, attr: signedInIntro.prePaintAttr });
  // preload="none" plus a boot path that returns before touching the video: the
  // ~9.7 MB is not paid by someone whose session was going to resume anyway.
  ok('...and does not download the video to find that out',
    signedInIntro.mp4Requests === 0, signedInIntro.mp4Requests);
}

try { fs.rmSync(introProfile, { recursive: true, force: true }); } catch {}

server.close();

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
