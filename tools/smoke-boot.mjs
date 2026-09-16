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

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(String(req.url).split('?')[0].split('#')[0]);
  const send = (body, type) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };

  if (url === FIXTURE_PATH) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    // Inject ahead of the app script so the stub is in place before it evaluates.
    return send(html.replace('<script src="app.js"></script>', STUB + '<script src="app.js"></script>'), MIME['.html']);
  }

  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    send(buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ── Drive Chrome ──────────────────────────────────────────────────────────────
// `--virtual-time-budget` lets the splash timer and the boot sequence run to
// completion before the DOM is dumped, without a real 10-second wait.
function runChrome(headlessFlag, url) {
  return new Promise(resolve => {
    const args = [
      headlessFlag, '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
      '--mute-audio', '--enable-logging=stderr', '--log-level=0',
      '--virtual-time-budget=15000', '--dump-dom', url,
    ];
    const proc = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => proc.kill(), 60000);
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

head('the 📋 Report tab is wired end to end');
ok('the intake tab is in the strip', /data-section="sec-intake"/.test(dom));
ok('the intake pane exists', /id="sec-intake"/.test(dom));
// The pane's own markup is nested divs, so a `</div></div>` match truncates it.
// Bound the capture by the NEXT pane instead — Section A follows the intake view.
const intakeBody = html => (html.match(/<div id="sec-intake-body">([\s\S]*?)<div id="sec-a"/) || [])[1] || '';
const intake = intakeBody(dom);
ok('renderIntake() actually painted the pane', intake.length > 200, intake.length);
ok('the read-only note is in the rendered page', /The app never edits these values/.test(dom));
ok('no undefined or NaN leaked into the report', !/undefined|NaN/.test(intake), intake.slice(0, 200));
ok('the intake pane has no editable control',
  !/<(input|textarea|select)\b/.test(intake), (intake.match(/<(input|textarea|select)\b/g) || []).slice(0, 4));

head('the 9 sections are untouched');
const tabStrip = (dom.match(/id="section-tabs">([\s\S]*?)<div id="sections-wrapper"/) || [])[1] || '';
ok('10 tabs in the strip (9 sections + Report)',
  (tabStrip.match(/class="tab/g) || []).length === 10, (tabStrip.match(/class="tab/g) || []).length);
ok('every section tab is present',
  ['sec-a','sec-b','sec-c','sec-d','sec-e','sec-f','sec-g','sec-h','sec-i']
    .every(s => tabStrip.includes(`data-section="${s}"`)));
ok('Section A is still the default tab', /class="tab active" data-section="sec-a"/.test(tabStrip));
ok('the 9 section panes are intact',
  ['sec-a','sec-b','sec-c','sec-d','sec-e','sec-f','sec-g','sec-h','sec-i']
    .every(s => dom.includes(`id="${s}" class="section-content`)));

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

server.close();

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
