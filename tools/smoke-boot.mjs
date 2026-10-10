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
// The Form Responses header row as the app reads it, with plausible questions at
// E, J and O — the three columns INTAKE_FIELDS claims no field for. The live render
// must surface all three.
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
// Stubs only the IR list read and blocks everything else, so a real network can
// never make this test pass or fail by accident. Injected ahead of app.js, which
// captures window.fetch at parse time.
//
// The list read is `action=listIRs`, and it answers with the sheet's GRID — the
// header row followed by the data rows. It used to be an anonymous fetch of the
// sheet's CSV from Google's gviz endpoint; see listIRs in backend.gs for why that
// had to go, and why the wire carries a grid rather than finished records.
const FIXTURE_PATH = '/__sheet-fixture.html';
const STUB = `<script>
  function __json(o) {
    return Promise.resolve(new Response(JSON.stringify(o),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  window.fetch = function (url, init) {
    var u = String(url);
    var b = init && init.body;
    var act = (b && typeof b.get === 'function' && b.get('action')) || '';
    if (u.indexOf('action=listIRs') >= 0 || act === 'listIRs') {
      return __json({ status: 'ok', grid: ${JSON.stringify([HEADERS, ROW])} });
    }
    // The two steps of the sign-in, so the probe can drive the real code screen. The
    // action rides the POST body — postAuth builds a FormData — so it is read from
    // there and not from the URL, which carries nothing but the deployment address.
    if (act === 'login') {
      var code = (b.get('code') || '');
      if (!code) return __json({ status: 'ok', otpRequired: true });
      if (code !== '424242') {
        return __json({ status: 'error', message: 'That code is not right. 2 attempt(s) left.' });
      }
      return __json({ status: 'ok', sessionToken: 'tok-from-the-code',
                      access: { role: 'member', permissions: {}, departments: [] } });
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
      .replace('<script src="app.js"></script>', INTRO_STUB + '<script src="app.js"></script>')
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
      // The real backend's stage-1 answer names the address and states the
      // lifetime as a duration (see passwordlessLogin — the reusable-code mail
      // copy), so the stub mirrors it; the note assertions below read this text.
      payload = { status: 'ok', otpRequired: true, email: 'asha@indrones.com', name: 'Asha', codeSent: true,
                  message: 'A 6-digit code is sent to asha@indrones.com. It is valid for 8:30 hours from when it was sent, and the same code works for every sign-in until it expires.' };
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
  // COMPUTED, not the inline style. #code-view is hidden by a stylesheet RULE
  // (base.css: display:none, display:flex under [data-open="1"]), so it carries no
  // inline style to read: a probe asking only about style.display calls it visible
  // from the moment the document parses and then measures the empty screen it has
  // not left yet.
  function shown(id) {
    var e = el(id);
    if (!e) return false;
    return window.getComputedStyle(e).display !== 'none';
  }
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
    // Do NOT wait on the document being parsed: #auth-container is display:none in
    // base.css and only showAuth() sets it inline, so this is the app taking over rather
    // than the markup arriving — which is what wired the form and seeded the reveal
    // buttons. Racing it means clicking a Sign in button with no listener, a native form
    // submit, which reloads the page and re-runs this driver, forever.
    //
    // The splash used to have to go away first. It is gone; there is nothing else to
    // wait for, and shown() reads the COMPUTED display, so a stylesheet rule is enough.
    await waitFor(function () { return shown('auth-container'); }, 30000);
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

    // ── step 1: an address, and no session yet ──
    el('auth-signin-btn').click();
    await waitFor(function () { return shown('code-view'); }, 15000);
    log('codeStepShown', true);
    log('codeEmail', el('code-email').textContent);
    // The landing page goes away WHOLE — head, both doors, the terms line, the language
    // picker. That is what makes this read as the blank centred page the owner asked for,
    // and it is a property of the markup (#code-view is a SIBLING of #auth-container).
    log('landingGoneAtStep2', !shown('auth-container'));
    log('stillNoSession', localStorage.getItem('ipb_session') === null);

    // ── step 2a: a wrong code ──
    var boxes = document.querySelectorAll('#code-boxes .code-box');
    // Filled the way the input handler expects: one digit per box, each announced. The
    // LAST box is what trips the submit — six boxes full is the code — which is also how
    // a person filling the sixth box submits without reaching for a button.
    function typeCode(s) {
      for (var i = 0; i < boxes.length; i++) {
        boxes[i].value = s.charAt(i);
        boxes[i].dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    typeCode('000000');
    await waitFor(function () {
      var e = el('code-error');
      return !!e && e.style.display !== 'none' && /attempt/.test(e.textContent);
    }, 15000);
    log('wrongCodeError', el('code-error').textContent);
    log('stillOnCodeStep', shown('code-view'));
    log('stillNoSessionAfterWrongCode', localStorage.getItem('ipb_session') === null);

    // ── step 2b: the right code ──
    log('boxCount', boxes.length);
    typeCode('424242');
    // Read SYNCHRONOUSLY, in the same turn as the last keystroke, before any reply can
    // arrive: submitCode() flips data-busy to '1' and only the answer flips it back, so
    // this one value says whether the sixth digit reached the submit at all.
    log('busyRightAfterTypingRight', el('code-view').dataset.busy);
    log('boxesRightAfterTyping', Array.prototype.map.call(boxes, function (b) { return b.value; }).join('|'));
    var signedIn = false;
    try { await waitFor(function () { return shown("app-container"); }, 15000); signedIn = true; }
    catch (e) { signedIn = false; }
    // Logged on BOTH outcomes: a bare timeout says only that something did not
    // happen, and the four things that decide it — the code as the boxes hold it, the
    // busy flag that would refuse a second submit, the error line, and whether the
    // request went out at all — are what make the failure answerable.
    log('signedInAfterRightCode', signedIn);
    log('boxesAfterRightCode', Array.prototype.map.call(boxes, function (b) { return b.value; }).join(''));
    log('busyAfterRightCode', el('code-view').dataset.busy);
    log('codeErrorAfterRightCode', el('code-error').textContent);
    if (!signedIn) throw new Error('timeout waiting for the shell after the right code');
    log('signedIn', true);
    log('token', localStorage.getItem('ipb_session'));
    log('authGone', !shown('auth-container'));
    log('codeViewGoneAfterSignIn', !shown('code-view'));
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
// The intro plays in the brand panel on a first arrival at a wide width, and is
// skipped for a device that has already been given this version's intro, and for one
// that is already signed in. Every one of those has a quiet failure mode — a dead video
// reference still leaves a perfectly good resting panel on screen, so a 404 looks
// exactly like success from the outside, and a skip that came from the wrong place still
// looks like a skip. The only way to tell them apart is to ask a real browser, three
// times:
//
//   1. a fresh device                 → the intro really plays, and really arrives
//   2. the SAME device again          → it does NOT play, and does not even fetch it
//   3. the same device, signed in      → no panel promotion, no download, no wake-up
//
// Load 2 reuses the same profile on purpose: what decides the skip is the record the
// FIRST load wrote against APP_VERSION, so this is a device that really was given the
// intro once, being asked again.
//
// ⚠ THE WINDOW HAS TO BE WIDE. The panel is not drawn below 1024px — that is the whole
// phone strategy, and it means the video is never played there. Headless Chrome's
// default window is 800x600, which is a phone-sized viewport for this purpose, so
// without --window-size the first scenario would measure the phone path and report the
// feature as broken. See runIntroLoad().
const INTRO_PATH = '/__intro.html';

// Counts the backend wake-up, and answers every Apps Script call locally.
//
// THE WAKE-UP IS COUNTED HERE because that count IS the assertion: the panel looks
// right whether or not anything woke the backend, so "the ping left the page during the
// intro" is only observable from inside the page.
//
// EVERY GAS CALL IS ANSWERED LOCALLY, and that is not tidiness. The signed-in load goes
// past showApp() into the app, whose first act is refreshMyAccess() against the live
// deployment — with a token this test made up. The live backend rejects it, the
// interceptor confirms the session is dead and signs the device out, and the scenario
// measures a sign-in screen it was supposed to prove was unreachable. Every stubbed call
// gets the same benign error object the auth fixture uses, which the interceptor's own
// rule 1 (`isUnauthorized` false) ignores. Nothing outside script.google.com is touched,
// so this is the app running against a backend that simply says no — not a rewritten app.
//
// It also keeps the phase off the live backend entirely: a cold one is a half-minute hang
// in the middle of a test that has no stake in it.
const INTRO_STUB = `<script>
  var _introRealFetch = window.fetch.bind(window);
  var INTRO_ERR = '{"status":"error","message":"blocked in test"}';
  window.fetch = function (url, init) {
    var u = String(url);
    if (u.indexOf('script.google.com') < 0) return _introRealFetch(url, init);
    if (/action=ping/.test(u)) {
      window.__warmPings = (window.__warmPings || 0) + 1;
      window.__warmPingUrl = u;
      return Promise.resolve(new Response('{"status":"ok","apiVersion":3}',
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return Promise.resolve(new Response(INTRO_ERR,
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
<\/script>
`;

// The same page, with a stored sign-in seeded before anything else runs. It has to be
// the FIRST thing in <head>: app.js's boot handler decides this load's whole route from
// localStorage the moment `load` fires, and the seed must be there before that.
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
  // Sampled NOW, while this script is the last thing in the body and \`load\` has not
  // fired: app.js has parsed and bound its load handler but has not run it, so the
  // panel is still in the state the MARKUP shipped it in. That is the one sample that
  // can tell a promotion from a default, and it cannot be taken later.
  var p0 = document.querySelector('.auth-brand-panel');
  var brandAtStart = p0 ? p0.getAttribute('data-brand') : null;
  function snap() {
    var panel = document.querySelector('.auth-brand-panel');
    var v = document.getElementById('brand-video');
    var head = document.querySelector('.auth-brand-panel .landing-head');
    var stage = document.querySelector('.brand-stage');
    var auth = document.getElementById('auth-container');
    var app = document.getElementById('app-container');
    var res = performance.getEntriesByType('resource') || [];
    var mp4 = res.filter(function (e) { return /brand-intro\\.mp4/.test(e.name); });
    report({
      done: true,
      brandAtStart: brandAtStart,
      brandMode: panel ? panel.getAttribute('data-brand') : null,
      ground: panel ? panel.getAttribute('data-ground') : null,
      stageDisplay: stage ? getComputedStyle(stage).display : null,
      headClipped: head ? getComputedStyle(head).position === 'absolute' : null,
      videoDuration: v && isFinite(v.duration) ? v.duration : null,
      videoReadyState: v ? v.readyState : null,
      videoErrorCode: v && v.error ? v.error.code : null,
      mp4Requests: mp4.length,
      warmPings: window.__warmPings || 0,
      warmPingUrl: window.__warmPingUrl || null,
      authDisplay: auth ? getComputedStyle(auth).display : null,
      appDisplay: app ? getComputedStyle(app).display : null,
    });
  }
  // SETTLE FOR 1800ms AFTER A REAL SCREEN IS UP, and both halves of that are deliberate.
  // "A real screen" is whichever of the two this load ends on — the sign-in page or the
  // app — because this driver is run three times and only the first two end on the
  // sign-in. The form is usable from the first frame now, which is the whole point of the
  // split, and that is also the moment app.js has called play() on the panel's video.
  // 1800ms is long enough for the video to have started and for its request to have been
  // recorded in the resource timeline, and deliberately SHORT of the intro's own ~10s, so
  // nothing measured here depends on the video having finished. Scenario 2 is a test of
  // exactly that: a device that has already been given this version's intro never asks
  // for the file at all, and the record of that is taken long before \`ended\` could have
  // fired either way.
  var t0 = Date.now(), ready0 = null;
  (function tick() {
    var auth = document.getElementById('auth-container');
    var app = document.getElementById('app-container');
    var up = (auth && getComputedStyle(auth).display !== 'none') ||
             (app && getComputedStyle(app).display !== 'none');
    if (up && ready0 === null) ready0 = Date.now();
    if ((ready0 !== null && Date.now() - ready0 > 1800) || Date.now() - t0 > 25000) { snap(); return; }
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
ok('the splash screen is gone from the document entirely',
  !/id="splash-screen"/.test(dom));
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
  /<(span|div)[^>]*class="([^"]*\b(?:nav-icon|ph-icon|btn-icon|activity-caret|tab-icon|sidebar-toggle-icon|list-toggle-icon|list-rail-icon|nudge-bell-icon)\b[^"]*)"[^>]*>([\s\S]{0,400}?)<\/\1>/g)];
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
// The ids the two doors and the shared code step are built from. The retired ones —
// `auth-forgot-link`, `auth-reset-wrap`, `auth-code`, `auth-new-password` — are asserted
// GONE in the head above, and `auth-login-code-*` no longer exists at all: the code moved
// to a screen of its own, which is why the list now names that screen instead.
['auth-form', 'auth-email', 'auth-password', 'auth-signin-btn', 'auth-pwd-link',
 'cust-form', 'cust-email', 'cust-signin-btn', 'auth-or', 'auth-quick',
 'code-view', 'code-form', 'code-boxes', 'code-email', 'code-different',
 'lang-select', 'door-employee-toggle', 'door-customer-toggle',
 'pc-form', 'pc-new', 'pc-confirm']
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
  probe ? JSON.stringify(probe) : null);

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
  ok('the code screen appeared, and the landing page went with it',
    probe.codeStepShown === true && probe.landingGoneAtStep2 === true, JSON.stringify(probe));
  ok('and it names the address the code was sent to',
    /asha@indrones\.com/.test(probe.codeEmail || ''), probe.codeEmail);
  // The whole point of the two-step split: an address alone must not produce a session
  // token. Asserting on the real localStorage is the only check here that a stubbed DOM
  // could not make.
  ok('NO token was stored after the address step', probe.stillNoSession === true,
    probe.token);

  head('step 2 refuses a wrong code and accepts the right one');
  ok('the backend error is surfaced verbatim',
    /attempt\(s\) left/.test(probe.wrongCodeError || ''), probe.wrongCodeError);
  ok('a wrong code leaves you on the code screen', probe.stillOnCodeStep === true);
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
    // ⚠ WIDE ON PURPOSE. The panel is not drawn below 1024px, and app.js will not call
    // play() there either — that is the phone strategy, and it means every assertion in
    // this phase would be measuring the phone path on Chrome's default 800x600 window
    // and reporting a working feature as broken.
    '--window-size=1440,900',
    // Muted autoplay is normally allowed, but the intro is the entire point of
    // this phase — a policy block would show up as "the video is fine but never
    // played", which is a confusing way to fail.
    '--autoplay-policy=no-user-gesture-required',
    '--enable-logging=stderr', '--log-level=0',
    '--user-data-dir=' + introProfile,
    `${base}${pagePath}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const got = await waitForProbe(before, ms);
  // Give Chrome a moment to shut the profile down cleanly before killing it. This is
  // load-bearing: the first load records the version it just delivered in the profile's
  // LevelDB, and the SECOND load's assertion is precisely that it reads that record and
  // skips the video. Killing the process the instant the probe arrived could lose the
  // write and fail a working feature.
  //
  // ⚠ 4000ms, AND IT IS A DISK-FLUSH WINDOW RATHER THAN A FUNCTIONAL WAIT. The write is
  // issued when play() resolves — the probe only ever arrives after that, because
  // brandMode is set in the same breath — but Chrome flushes its LevelDB lazily, and
  // child.kill() on Windows is a hard terminate with no flush of its own. 1500ms was
  // enough on an idle machine and not enough when this suite runs inside smoke-all: it
  // failed there and passed alone, which is the worst way for a test to be wrong.
  if (got) await new Promise(r => setTimeout(r, 4000));
  try { proc.kill(); } catch { /* already gone */ }
  return got;
}

// Real time, not virtual: the video has to actually play, and that takes ~10s. The
// probe settles 1.8s after the form appears, so this budget covers the boot, not the
// whole intro.
const firstIntro = await runIntroLoad(45000);
ok('the intro probe reported from a real browser', !!firstIntro);
if (firstIntro) {
  // The panel ships as "rest" and app.js is the only thing that promotes it. Sampled
  // before `load` fired, so this is the markup's own default and not a promotion.
  ok('the panel arrives in its resting state, before app.js has touched it',
    firstIntro.brandAtStart === 'rest', firstIntro.brandAtStart);
  ok('the first open promotes it to the video',
    firstIntro.brandMode === 'video', firstIntro.brandMode);
  // readyState >= 1 means Chrome really fetched and parsed the file. Without this the
  // suite cannot tell a working intro from a missing one, because the resting panel is
  // perfectly good either way.
  ok('...and the video really loads',
    firstIntro.videoReadyState >= 1 && firstIntro.videoErrorCode === null,
    { readyState: firstIntro.videoReadyState, error: firstIntro.videoErrorCode });
  ok('it is the full-length intro, not a truncated read',
    firstIntro.videoDuration > 9.5 && firstIntro.videoDuration < 10.5,
    firstIntro.videoDuration);
  // At a wide width the stage is drawn and the head beside it is clipped, which is the
  // "brand said once" rule as it actually renders: the lockup already carries the
  // wordmark, so printing the head too would say it twice.
  ok('the stage is drawn, and the common head beside it is clipped to nothing',
    firstIntro.stageDisplay === 'block' && firstIntro.headClipped === true,
    { stage: firstIntro.stageDisplay, headClipped: firstIntro.headClipped });
  ok('the form is up under it, so nobody is waiting for the video',
    firstIntro.authDisplay === 'flex', firstIntro.authDisplay);
  // The wake-up, proven in the one place it can be: a real browser, on the load that
  // ends at the sign-in screen. The assertion is that it left the page during the intro
  // — i.e. that the ~10s of video and everything typed afterwards are spent overlapping
  // Apps Script's cold start rather than waiting behind it.
  ok('the backend is woken on the way to sign-in, not when the button is pressed',
    firstIntro.warmPings >= 1 && /action=ping/.test(firstIntro.warmPingUrl || ''),
    { pings: firstIntro.warmPings, url: firstIntro.warmPingUrl });
}

// THE POINT OF THE CHANGE. The intro is the app's OPENING, delivered once per VERSION:
// the video on the first arrival, and on the first arrival after an update, because
// APP_VERSION is what the key is compared against and the deploy bumps it with
// CACHE_NAME. Every visit in between rests.
//
// `mp4Requests` is the honest signal, and here it is the whole assertion: the panel is
// on screen and looks right whether the video played, failed, or was never asked for, so
// the only thing that separates one from the other from outside is whether the browser
// went and got the file at all. It is also the weight saving, stated as a number: a
// returning device downloads no video, no still — nothing this panel needs is fetched
// before sign-in on the second visit.
const secondIntro = await runIntroLoad(45000);
ok('the second open on the same device reports', !!secondIntro);
if (secondIntro) {
  ok('a device that has already been given this version\'s intro is not given it again',
    secondIntro.brandMode === 'rest', secondIntro.brandMode);
  ok('...and never fetches the video to find that out',
    secondIntro.mp4Requests === 0, secondIntro.mp4Requests);
  ok('...and it is the resting panel, not an empty one, that it rests on',
    secondIntro.stageDisplay === 'block' && secondIntro.headClipped === true,
    { stage: secondIntro.stageDisplay, headClipped: secondIntro.headClipped });
  // Not once-ever: the container goes cold again, so every arrival at the sign-in
  // screen earns its own ping. A device that has seen the intro before is still a
  // person about to sign in — and now it gets to the form without waiting at all.
  ok('a returning device wakes the backend again', secondIntro.warmPings >= 1,
    secondIntro.warmPings);
}

// The one thing that skips it entirely. A seeded sign-in is put in localStorage before
// app.js's boot handler runs, which is what a resuming device looks like from there.
const signedInIntro = await runIntroLoad(30000, INTRO_SIGNED_IN_PATH);
ok('the signed-in device reports', !!signedInIntro);
if (signedInIntro) {
  // The panel is inside #auth-container, and showAuth() is the only route that ever
  // puts it on screen. A resuming device goes through showApp() instead, so the panel is
  // never displayed and never promoted — no video, no still, nothing to flash.
  ok('a device that is already signed in never reaches the sign-in screen at all',
    signedInIntro.authDisplay === 'none' && signedInIntro.appDisplay === 'flex',
    { auth: signedInIntro.authDisplay, app: signedInIntro.appDisplay });
  ok('...and the panel is left in its resting state, unpromoted',
    signedInIntro.brandMode === 'rest' && signedInIntro.brandAtStart === 'rest',
    { atStart: signedInIntro.brandAtStart, mode: signedInIntro.brandMode });
  // preload="none" plus a boot path that returns before touching the video: the 1.6 MB
  // is not paid by someone whose session was going to resume anyway.
  ok('...and does not download the video to find that out',
    signedInIntro.mp4Requests === 0, signedInIntro.mp4Requests);
  // The same early return skips the wake-up, and that is deliberate rather than
  // incidental: this load is going into the app, whose first real call warms the
  // backend by being that call. A ping here would be a second, useless request.
  ok('...and wakes nothing, because its own first call is the wake-up',
    signedInIntro.warmPings === 0, signedInIntro.warmPings);
}

try { fs.rmSync(introProfile, { recursive: true, force: true }); } catch {}

server.close();

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
