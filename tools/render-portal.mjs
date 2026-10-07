// Boot customer.html in a real browser with a stubbed backend, drive the whole portal,
// and report what actually painted.
//
//   node tools/render-portal.mjs
//
// NO node_modules — same DevTools-Protocol-over-the-debugging-port approach as
// tools/render-check.mjs, and for the same reason: Windows clamps `--window-size`, so a
// "phone" measured that way is really a ~500px one.
//
// ── Why this exists ───────────────────────────────────────────────────────────
//
// tools/render-check.mjs renders the page and finds overflow. It cannot render the
// SIGNED-IN half at all: with no session token every block below the hero stays
// `hidden`, so it measures a page that no customer will ever see, and a bug in the
// ticket list — a clipped pill, a status that never folds, a ticket that is not theirs —
// is invisible to it and to every static suite. Reading the source is not evidence
// either; the last three releases each proved that.
//
// So this serves the REAL customer.html over a local origin (file:// would make
// `localStorage` unreliable, which is exactly what the portal signs in with), installs a
// stub backend before any page script runs, and then drives the page the way a customer
// does: open the sheet, step through both doors, read the list, open a ticket, and
// measure the result at five device widths.
//
// ── What it asserts ───────────────────────────────────────────────────────────
//
// Behaviour, not structure: the words on screen, the classes on the pills, and whether
// the page scrolls sideways. Each check names the trap it is guarding, because most of
// these are states that LOOK right — a pill that says "Investigation" when the store was
// unreadable is a confident lie about every ticket at once.
//
// The stub is a FIXTURE, not a model of the backend. It returns the shapes backend.gs
// returns and nothing more; tools/smoke-customer.mjs is where the real backend is
// exercised. A fixture that invents a field the backend does not send is worse than no
// fixture (see tools/smoke-backend.mjs's note on ContentService.MimeType).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const CHROME = CHROME_CANDIDATES.find(p => { try { return p && fs.existsSync(p); } catch { return false; } });
if (!CHROME) { console.error('render-portal: no Chrome found at any known path'); process.exit(2); }

const ROOT = path.resolve(import.meta.dirname, '..');
const SLEEP = ms => new Promise(r => setTimeout(r, ms));

// The stub is also written out — already evaluated, so it is byte-for-byte the script this
// probe installs — for tools/render-themes.mjs to photograph the SAME signed-in state that
// was just measured:
//
//   node tools/render-themes.mjs customer.html --width 414 \
//     --seed "$(cat tools/.cache/portal-seed.mjs)" \
//     --eval "document.querySelectorAll('#ticket-list .ticket')[0].click()"
//
// Without this the only way to photograph the portal is to hand-copy the stub, and a
// hand-copied stub is a DIFFERENT fixture: the first attempt at this re-escaped the
// newlines, so the screenshot showed a description with a literal \n in it and looked like
// a page bug. The picture must be of the state the suite proved.
const SEED_FILE = path.join(ROOT, 'tools', '.cache', 'portal-seed.mjs');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n          ' + String(detail).replace(/\n/g, '\n          ').slice(0, 400) : '')); }
};

// ── The stub backend ───────────────────────────────────────────────────────────
// Installed with Page.addScriptToEvaluateOnNewDocument, so it runs before the page's
// own pre-paint theme script AND before the portal's boot. `?state=` selects which
// account the page is booted as, so one process can exercise every state.
const STUB = `
(function () {
  var state = new URLSearchParams(location.search).get('state') || 'customer';
  try { localStorage.clear(); } catch (e) {}
  if (state !== 'signedout') {
    try { localStorage.setItem('ipbc_session', 'stub-token-for-render'); } catch (e) {}
  }

  // A faithful stand-in for the intake header row: the columns the Form writes, in a
  // plausible order, including three the portal must NOT render (Issue Status, Priority,
  // Summary — the desk's own columns) so that "the portal reads only its own six" is a
  // measured fact rather than a reading of the source.
  var HEADERS = ['Timestamp', 'Date of Incident', 'IR Number', 'Drone Serial No',
    'Where Do You Work', "Who's Reporting", 'Email Address', 'SPOC',
    'What Support Do You Need?', 'Please Describe The Issue In Detail',
    'Incident Location and Weather', 'Evidence: Attach Files From The Incident',
    'Evidence: Attach Screenshot of UAV Forecast', 'Summary', 'Issue Status', 'Priority'];

  var ROWS = [
    ['14/09/2026 10:22:41', '13/09/2026', 'IR 107', 'IND-S25-0042', 'Acme Survey', 'Priya Nair',
     'reports@acmesurvey.example', 'Priya Nair', 'Repair / Part Replacement',
     'The unit drifted hard right on take-off and then landed itself.\\nSecond flight showed the same drift.\\n\\nWe stopped flying it after that.',
     'Chakan, Pune - clear sky, wind 12 km/h',
     'https://drive.google.com/file/d/AAAAAAAAAAAAAAAAAAAA/view, https://drive.google.com/file/d/BBBBBBBBBBBBBBBBBBBB/view',
     'https://drive.google.com/file/d/CCCCCCCCCCCCCCCCCCCC/view',
     'INTERNAL SUMMARY - MUST NOT REACH THE CUSTOMER', 'Investigation', 'P2'],
    ['20/09/2026 09:05:00', '20/09/2026', 'IR 204', 'IND-S25-0051', 'Acme Survey', 'Priya Nair',
     'reports@acmesurvey.example', 'Priya Nair', 'Maintenance / Servicing',
     'Routine 50-hour service requested before the survey season starts.',
     'Chakan, Pune - indoor', '', '',
     'INTERNAL SUMMARY - MUST NOT REACH THE CUSTOMER', 'Delivered', 'P3'],
    ['02/10/2026 16:40:12', '02/10/2026', 'IR 310', 'IND-S100-0007', 'Acme Survey', 'Arun Mehta',
     'arun@acmesurvey.example', 'Arun Mehta', 'Calibration',
     'Compass calibration drifts a few degrees on every flight, and the heading readout wanders.',
     'Chakan, Pune - overcast',
     '', 'https://drive.google.com/file/d/DDDDDDDDDDDDDDDDDDDD/view',
     'INTERNAL SUMMARY - MUST NOT REACH THE CUSTOMER', 'Open', 'P3'],
    // NOT an IR number. app.js's own list skips these, and so must this page: a spare
    // parts order typed into the intake sheet is a row, not a ticket.
    ['03/10/2026 11:00:00', '', 'Spare parts order', '', 'Acme Survey', 'Priya Nair',
     '', '', '', 'Two sets of props and one battery.', '', '', '', '', '', ''],
  ];

  // The app's workflow store, in the shape narrowSentinelForCustomer() leaves it: their
  // own IRs only, and only status/assignee/updatedAt on each.
  var IRS = {
    IR107: { status: 'Investigation', assignee: 'Ravi Singh', updatedAt: '2026-09-20T04:00:00.000Z' },
    IR204: { status: 'Delivered',     assignee: 'Monish Raza', updatedAt: '2026-09-28T04:00:00.000Z' },
    // A retired word the app has stopped using. The customer must never be shown it.
    IR310: { status: 'qc',            assignee: 'A. Kumar',    updatedAt: '2026-10-02T04:00:00.000Z' },
  };

  // One ticket's Overview, as getPassbook returns it to a customer: the Overview survives
  // (it is not a section), and a real section does NOT — but it is included here anyway so
  // that the portal's half of that guarantee is measured rather than assumed.
  var ONE = { 'sec-a': {
    a_crmOwner: 'Ravi Singh', a_contactPhone: '+91 98765 43210', a_siteLocation: 'Chakan, Pune',
    b_inwardPhotos: 'SECRET INTERNAL PRODUCTION NOTE',
  } };

  var env = o => Promise.resolve({ ok: true, json: () => Promise.resolve(o) });

  // Every action the page asks for, so "did it tell the server it was leaving?" is a
  // measured fact rather than a reading of the source.
  window.__calls = [];

  window.fetch = function (url, opts) {
    var u = String(url);
    var p = new URLSearchParams(u.indexOf('?') >= 0 ? u.slice(u.indexOf('?') + 1) : '');
    var action = p.get('action');
    if (!action && opts && opts.body && opts.body.get) action = opts.body.get('action');
    window.__calls.push(action);

    if (action === 'login') {
      var code = opts && opts.body && opts.body.get ? String(opts.body.get('code') || '') : '';
      if (!code) {
        // Step one. The 'newaccount' state is a freshly invited account, still on its
        // admin-issued temporary password — the state the invitation mail has to route
        // around.
        if (state === 'newaccount') {
          return env({ status: 'ok', otpRequired: true, email: 'reports@acmesurvey.example',
                       codeSent: false, message: 'Enter the sign-in code already emailed to you today.' });
        }
        return env({ status: 'ok', otpRequired: true, email: 'reports@acmesurvey.example',
                     codeSent: true, message: 'We emailed you a 6-digit sign-in code.' });
      }
      if (code === '123456') {
        return env({ status: 'ok', sessionToken: 'minted-by-the-stub',
                     access: { customerOf: 'Acme Survey' }, email: 'reports@acmesurvey.example' });
      }
      return env({ status: 'error', message: 'That code is not right, or it has expired.' });
    }
    if (action === 'forgotPassword') return env({ status: 'ok', message: 'If we hold that address, a code is on its way.' });
    if (action === 'resetPassword') return env({ status: 'ok', message: 'Your password is set.' });
    if (action === 'logout') return env({ status: 'ok' });
    if (action === 'getMyCustomer') {
      if (state === 'staff') return env({ status: 'ok', email: 'cradmin@indrones.com', customerOf: '', name: 'CR Admin', apiVersion: 8 });
      return env({ status: 'ok', email: 'reports@acmesurvey.example', customerOf: 'Acme Survey', name: 'Priya Nair', portalUrl: '', apiVersion: 8 });
    }
    if (action === 'listIRs') return env({ status: 'ok', grid: [HEADERS].concat(ROWS) });
    if (action === 'getPassbook') {
      if (p.get('irNumber') === '__IRS__') {
        if (state === 'nostore') return env({ status: 'error', message: 'Could not read the app store just now.' });
        return env({ status: 'ok', sections: { __IRS__: IRS } });
      }
      return env({ status: 'ok', sections: ONE });
    }
    return env({ status: 'error', message: 'portal probe: no stub for ' + action });
  };
})();
`;

// The overflow probe, same two questions as render-check: does the PAGE scroll sideways,
// and does any element stick out past the edge. An element that scrolls or clips inside
// its own frame is exempt from the second and never from the first.
const MEASURE = `(() => {
  const W = window.innerWidth;
  const out = { width: W, scroll: document.documentElement.scrollWidth, out: [], clipped: [] };
  const scrollsItself = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
    }
    return false;
  };
  const name = el => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')).slice(0, 60);
  document.querySelectorAll('body *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    if (r.right > W + 0.5 && !scrollsItself(el)) out.out.push({ el: name(el), over: +(r.right - W).toFixed(1) });
    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 &&
        cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && cs.textOverflow !== 'ellipsis') {
      out.clipped.push({ el: name(el), text: (el.textContent || '').trim().slice(0, 32), by: el.scrollWidth - el.clientWidth });
    }
  });
  out.out = out.out.slice(0, 12); out.clipped = out.clipped.slice(0, 12);
  return out;
})()`;

// ── A tiny static server, so the page has a real origin ───────────────────────
// file:// is not an option here: Chrome's localStorage on a file origin is unreliable,
// and localStorage is what the portal signs in with. Serving the repo root also lets the
// page's two relative image references resolve, so what is measured is the real page.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p;
      try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }
      const file = path.join(ROOT, p);
      // Containment: a served root one directory up would hand out the whole disk.
      if (!file.startsWith(ROOT + path.sep)) { rq.writeHead(403).end('forbidden'); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { rq.writeHead(404).end('not found'); return; }
        rq.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        rq.end(buf);
      });
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

// Closing this in the `finally` is not tidiness: a listening server holds the event loop
// open, so a run that reaches its last line still never exits, and every line it printed
// sits in the pipe unflushed. That failure looks exactly like a hang with no output.
const SERVER = await serve();
const PORT = SERVER.address().port;
const BASE = 'http://127.0.0.1:' + PORT + '/customer.html';

const PROFILE = path.join(process.env.TEMP || os.tmpdir(), 'render-portal-' + PORT);
const DEBUG_PORT = PORT + 1;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  '--user-data-dir=' + PROFILE, 'about:blank',
], { stdio: 'ignore' });

let ws, seq = 0;
const pending = new Map();
const send = (method, params) => new Promise(res => {
  const id = ++seq; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const call = async (method, params) => {
  const m = await send(method, params);
  return m.result;
};
const evaluate = async js => {
  const r = await call('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception || {}).description);
  return r.result && r.result.value;
};
const waitFor = async (js, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if (await evaluate(js)) return true; } catch { /* mid-nav */ }
    await SLEEP(80);
  }
  return false;
};
const goto = async (state, width) => {
  await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 640 });
  await call('Page.navigate', { url: BASE + (state ? '?state=' + state : '') });
  await SLEEP(500);
};

// Everything this page can legitimately be measured on, in one place.
const text = () => evaluate('document.body.innerText');
const visible = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; })()`);

try {
  try {
    fs.mkdirSync(path.dirname(SEED_FILE), { recursive: true });
    fs.writeFileSync(SEED_FILE, STUB);
  } catch (e) { console.log('  note: could not write ' + SEED_FILE + ' — ' + e.message); }

  let tab;
  for (let i = 0; i < 60 && !tab; i++) {
    try {
      const tabs = await new Promise((res, rej) => {
        http.get({ host: '127.0.0.1', port: DEBUG_PORT, path: '/json' }, r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
        }).on('error', rej);
      });
      tab = tabs.find(t => t.type === 'page');
    } catch {}
    if (!tab) await SLEEP(250);
  }
  if (!tab) throw new Error('Chrome never opened a debugging target');

  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

  const WIDTHS = [320, 360, 414, 768, 1024];
  const overflow = async (label, widths) => {
    for (const w of widths) {
      await call('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: w < 640 });
      await SLEEP(220);
      const v = await evaluate(MEASURE);
      const bad = v.scroll > v.width + 1 || v.out.length;
      ok(`${label} — no sideways scroll at ${w}px`, !bad,
        `scrollWidth ${v.scroll}` + (v.out.length ? '  past the edge: ' + v.out.map(o => `${o.el} +${o.over}px`).join(', ') : ''));
      if (v.clipped.length) console.log(`          (clipped) ` + v.clipped.map(c => `${c.el} "${c.text}" by ${c.by}px`).join(' | '));
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n— signed out: nothing about anybody\'s tickets is on the page —');
  // ════════════════════════════════════════════════════════════════════════════
  await goto('signedout', 414);
  ok('the signed-in block stays hidden', !(await visible('#reports')));
  ok('the header offers Sign in, not Sign out', (await visible('#header-signin')) && !(await visible('#signout')));
  ok('...and names nobody', !(await visible('#header-who')));
  ok('the hero keeps offering a way in, and offers it to the explainer rather than a form',
    /sign in to your reports/i.test(await evaluate(`document.getElementById('hero-cta').textContent`))
    && await evaluate(`document.getElementById('hero-cta').getAttribute('href') === '#access'`));
  ok('...and the aside explains access to a visitor',
    await visible('#access-visitor') && !(await visible('#access-member')));

  await evaluate(`document.querySelector('.js-signin').click()`);
  await SLEEP(150);
  ok('the sheet opens on the page, not on the staff app', await visible('#signin'));
  const s1 = await evaluate(`document.getElementById('signin').innerText`);
  ok('...titled as the customer\'s own reports', /your reports/i.test(s1), s1);
  ok('...asking only for an email address', await visible('#signin-email') && !(await visible('#code-field')) && !(await visible('#newpass-field')));
  ok('...and its button asks to email a code, not to sign in',
    /email me a code/i.test(await evaluate(`document.getElementById('signin-go').textContent`)));
  // The invitation mail tells a brand-new customer to take this route, so it has to be
  // reachable in one press from the screen they land on.
  ok('...with the door the invitation names one press away',
    /first time here/i.test(await evaluate(`document.getElementById('signin-firsttime').textContent`)));

  // An empty address must not spend a code, and must say what is wanted.
  await evaluate(`document.getElementById('signin-go').click()`);
  await SLEEP(180);
  ok('pressing it with no address asks for one rather than mailing nobody',
    /enter your email address/i.test(await evaluate(`document.getElementById('signin-msg').textContent`))
    && await visible('#signin-email') && !(await visible('#code-field')),
    await evaluate(`document.getElementById('signin-msg').textContent`));

  // ── the daily door, end to end ──────────────────────────────────────────────
  await evaluate(`document.getElementById('signin-email').value = 'reports@acmesurvey.example'`);
  await evaluate(`document.getElementById('signin-go').click()`);
  await SLEEP(250);
  const s2 = await evaluate(`document.getElementById('signin').innerText`);
  ok('pressing it asks for the code, and freezes the address it was sent to',
    await visible('#code-field') && await evaluate(`document.getElementById('signin-email').readOnly`), s2);
  ok('...and now offers to sign in', /^sign in$/i.test((await evaluate(`document.getElementById('signin-go').textContent`)).trim()));
  ok('...and the page has not signed anybody in on a stub reply that carried no token',
    !(await visible('#reports')));

  await evaluate(`document.getElementById('signin-code').value = '123456'`);
  await evaluate(`document.getElementById('signin-go').click()`);
  ok('the code signs the customer in and lands them on their own list',
    await waitFor(`document.querySelectorAll('#ticket-list .ticket').length > 0`),
    await evaluate(`document.getElementById('signin-msg').textContent`));
  ok('...and the sheet gets out of the way', !(await visible('#signin')));

  // ── the first-time door, end to end ─────────────────────────────────────────
  // What the invitation email sends a brand-new customer to. It has to reach a screen
  // that takes the code AND the new password in one go, or the mail is promising a step
  // that does not exist — which is exactly the fault the old invitation had.
  await goto('signedout', 414);
  await evaluate(`document.querySelector('.js-signin').click()`);
  await evaluate(`document.getElementById('signin-email').value = 'reports@acmesurvey.example'`);
  await evaluate(`document.getElementById('signin-firsttime').click()`);
  await SLEEP(180);
  const s3 = await evaluate(`document.getElementById('signin').innerText`);
  ok('the door the invitation names is titled for what it does', /set your password/i.test(s3), s3);
  ok('...and says nobody at Indrones chooses or can read that password',
    /nobody at indrones chooses it/i.test(s3), s3);
  ok('...and it takes only the address at this step', !(await visible('#newpass-field')), s3);

  await evaluate(`document.getElementById('signin-go').click()`);
  await SLEEP(250);
  const s4 = await evaluate(`document.getElementById('signin').innerText`);
  ok('asking for it brings ONE screen with the code and the new password together',
    await visible('#code-field') && await visible('#newpass-field'), s4);
  ok('...stating the rule the backend enforces, rather than letting them discover it',
    /at least 8 characters/i.test(s4), s4);
  ok('...and its button now sets the password',
    /set my password/i.test(await evaluate(`document.getElementById('signin-go').textContent`)));

  await evaluate(`document.getElementById('signin-code').value = '654321'`);
  await evaluate(`document.getElementById('signin-newpass').value = 'a-password-of-my-own'`);
  await evaluate(`document.getElementById('signin-go').click()`);
  await SLEEP(300);
  const s5 = await evaluate(`document.getElementById('signin').innerText`);
  ok('setting it hands them back to the sign-in door, because the reset mints no session',
    /your password is set/i.test(s5) && /email me a code/i.test(await evaluate(`document.getElementById('signin-go').textContent`)), s5);
  ok('...and does NOT claim they are signed in', !(await visible('#reports')), s5);

  // ── the account that cannot use the code door yet ────────────────────────────
  // A freshly invited account sits on an admin-issued temporary password, and
  // passwordlessLogin refuses to redeem a login code for it. Saying "we emailed you a
  // code" here would leave them waiting for a mail that was never sent.
  await goto('newaccount', 414);
  await evaluate(`document.querySelector('.js-signin').click()`);
  await evaluate(`document.getElementById('signin-email').value = 'brand.new@acmesurvey.example'`);
  await evaluate(`document.getElementById('signin-go').click()`);
  await SLEEP(250);
  const s6 = await evaluate(`document.getElementById('signin-msg').textContent`);
  ok('a brand-new account is NOT told a code is on its way', !/emailed you|code is on its way/i.test(s6), s6);
  ok('...and is pointed at the door that does work for it', /first time here/i.test(s6), s6);

  await evaluate(`document.getElementById('signin').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await SLEEP(150);
  ok('Escape closes the sheet', !(await visible('#signin')));

  await overflow('signed out', WIDTHS);

  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n— a customer\'s own list —');
  // ════════════════════════════════════════════════════════════════════════════
  await goto('customer', 414);
  await waitFor(`document.querySelectorAll('#ticket-list .ticket').length > 0`);
  ok('the list paints', await visible('#reports') && await visible('#reports-list'));
  ok('...and the header names the account, not the person', /Acme Survey/.test(await evaluate(`document.getElementById('header-who').textContent`)));

  const cards = await evaluate(`Array.from(document.querySelectorAll('#ticket-list .ticket')).map(b => ({
    ir: b.querySelector('.ticket-ir').textContent,
    pill: b.querySelector('.pill') ? b.querySelector('.pill').textContent : '',
    cls: b.querySelector('.pill') ? b.querySelector('.pill').className : ''
  }))`);
  ok('a row that is not an IR number is not drawn as a ticket',
    cards.length === 3 && !cards.some(c => /spare parts/i.test(c.ir)), JSON.stringify(cards));
  ok('the newest report comes first',
    JSON.stringify(cards.map(c => c.ir)) === JSON.stringify(['IR 310', 'IR 204', 'IR 107']), JSON.stringify(cards.map(c => c.ir)));
  ok('the stage comes from the app\'s own store, not from the sheet\'s Issue Status column',
    cards[2].pill === 'Investigation' && cards[0].pill === 'Quality Test', JSON.stringify(cards));
  ok('a retired word never reaches a customer — `qc` reads as Quality Test',
    !cards.some(c => /^qc$/i.test(c.pill)), JSON.stringify(cards));
  ok('Delivered reads as done, and only Delivered does',
    cards.find(c => c.ir === 'IR 204').cls.includes('done') && !cards[0].cls.includes('done'), JSON.stringify(cards));

  const listText = await evaluate(`document.getElementById('reports-list').innerText`);
  ok('the customer\'s own words are shown, not the desk\'s internal summary',
    /drifted hard right/i.test(listText) && !/INTERNAL SUMMARY/.test(listText), listText);

  await overflow('the list', WIDTHS);

  // ── nothing on the page offers a way IN to somebody already in ──────────────
  // Found by looking at a screenshot, not by measuring: every width passed while the hero
  // still said "Sign in to your reports" to a customer who was signed in. The header had
  // been swapped and these two had not.
  ok('the hero stops offering a way in, and points at the reports instead',
    /your reports/i.test(await evaluate(`document.getElementById('hero-cta').textContent`))
    && !/sign in/i.test(await evaluate(`document.getElementById('hero-cta').textContent`))
    && await evaluate(`document.getElementById('hero-cta').getAttribute('href') === '#reports'`),
    await evaluate(`document.getElementById('hero-cta').outerHTML`));
  ok('the aside shows the account rather than an invitation to sign in',
    (await visible('#access-member')) && !(await visible('#access-visitor'))
    && /Acme Survey/.test(await evaluate(`document.getElementById('access-member-who').textContent`)));
  ok('...and there is no sign-in control left anywhere on the page',
    (await evaluate(`Array.from(document.querySelectorAll('.js-signin')).filter(e => e.offsetParent !== null).length`)) === 0,
    await evaluate(`Array.from(document.querySelectorAll('.js-signin')).map(e => e.id || e.className).join(', ')`));
  ok('...with a way out in both places', (await evaluate(`document.querySelectorAll('.js-signout').length`)) === 2);

  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n— one ticket —');
  // ════════════════════════════════════════════════════════════════════════════
  await call('Emulation.setDeviceMetricsOverride', { width: 414, height: 1000, deviceScaleFactor: 1, mobile: true });
  await evaluate(`Array.from(document.querySelectorAll('#ticket-list .ticket')).find(b => b.querySelector('.ticket-ir').textContent === 'IR 107').click()`);
  await waitFor(`document.querySelector('#one-body .record')`);
  await SLEEP(200);
  ok('opening a ticket replaces the list rather than stacking under it',
    await visible('#report-one') && !(await visible('#reports-list')));

  const one = await evaluate(`document.getElementById('one-body').innerText`);
  ok('the customer\'s own report is reproduced', /drifted hard right/i.test(one), one);
  // innerText, not textContent: the description is inserted with `<br>`, and a `<br>` is
  // invisible to textContent — so a textContent check would pass on a paragraph the
  // customer sees run together into one blob. The value is escaped BEFORE the breaks are
  // added and `.v.long` is `white-space: pre-wrap`, so what they typed is what is read back.
  const descStart = one.indexOf('The unit drifted');
  ok('...with the line breaks they typed kept',
    one.includes('landed itself.\nSecond flight showed the same drift.'),
    descStart < 0 ? 'the description is not on the page at all'
                  : JSON.stringify(one.slice(descStart, descStart + 200)));
  ok('...and the desk\'s own fields beside it',
    /point of contact/i.test(one) && /Ravi Singh/.test(one) && /\+91 98765 43210/.test(one) && /Chakan, Pune/.test(one), one);
  // Uppercased by CSS on the label, not in the data — so the stage must be read back
  // case-insensitively, exactly as a customer reads it.
  ok('...and the stage and the person carrying it',
    /investigation/i.test(one) && /being worked on by/i.test(one), one);
  ok('an internal section is not rendered even when the reply carries one',
    !/SECRET INTERNAL/.test(one), one);
  ok('the desk\'s own columns never reach this page — no internal summary, no priority',
    !/INTERNAL SUMMARY/.test(one) && !/\bP2\b/.test(one), one);
  ok('evidence is a link, because this page cannot know whether Drive will open it',
    await evaluate(`document.querySelectorAll('#one-body .v a[href^="https://"]').length >= 3`));
  ok('...and the caveat about Drive is stated rather than assumed',
    /Google Drive, which decides for itself/i.test(one), one);

  const back = await evaluate(`(() => { document.getElementById('back-to-list').click(); return true; })()`);
  await SLEEP(200);
  ok('and there is a way back to the list',
    back && (await visible('#reports-list')) && !(await visible('#report-one')));

  await evaluate(`Array.from(document.querySelectorAll('#ticket-list .ticket')).find(b => b.querySelector('.ticket-ir').textContent === 'IR 107').click()`);
  await waitFor(`document.querySelector('#one-body .record')`);
  await SLEEP(250);   // the detail view scrolls itself into place
  await overflow('one ticket', WIDTHS);

  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n— when the store cannot be read, the page says so instead of guessing —');
  // ════════════════════════════════════════════════════════════════════════════
  await goto('nostore', 414);
  await waitFor(`document.querySelectorAll('#ticket-list .ticket').length > 0`);
  const ns = await evaluate(`document.getElementById('reports-list').innerText`);
  ok('the list still shows what the customer reported', /drifted hard right/i.test(ns), ns);
  ok('...but paints NO stage at all, rather than "Open" on every ticket at once',
    (await evaluate(`document.querySelectorAll('#ticket-list .pill').length`)) === 0, ns);
  ok('...and says why, in a sentence', /could not read the current stage/i.test(ns), ns);

  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n— a staff account at the customer door is a wrong door, not a broken one —');
  // ════════════════════════════════════════════════════════════════════════════
  await goto('staff', 1024);
  await SLEEP(400);
  const st = await evaluate(`document.getElementById('reports').innerText`);
  ok('the empty list is not shown to them as if it were their reports', !(await visible('#reports-list')), st);
  ok('...they are told it is a service-desk account and given the other door',
    /service-desk account/i.test(st) && await evaluate(`!!document.querySelector('#reports-sub a[href="./index.html"]')`), st);
  ok('...and the header names them, so they know they are signed in, with a way out',
    (await visible('#signout')) && (await visible('#header-who'))
    && /cradmin@indrones\.com/.test(await evaluate(`document.getElementById('header-who').textContent`)));

  // On a phone the header name is dropped for room — deliberately — so the identity has to
  // be somewhere else, or a customer on a borrowed phone cannot tell whose account it is.
  await goto('customer', 360);
  await waitFor(`document.querySelectorAll('#ticket-list .ticket').length > 0`);
  ok('at phone width the header yields the name, and the list carries it instead',
    !(await visible('#header-who'))
    && /signed in as reports@acmesurvey\.example/i.test(await evaluate(`document.getElementById('reports-sub').textContent`)),
    await evaluate(`document.getElementById('reports-sub').textContent`));

  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n— signing out —');
  // ════════════════════════════════════════════════════════════════════════════
  // Last, because it destroys the session every check above needs.
  await evaluate(`document.querySelector('#access-member .js-signout').click()`);
  await SLEEP(300);
  ok('signing out clears the page at once', !(await visible('#reports')) && await visible('#header-signin'));
  ok('...forgets the token on the device, rather than merely hiding the view',
    await evaluate(`(() => { try { return localStorage.getItem('ipbc_session') === null; } catch (e) { return true; } })()`));
  ok('...tells the server to retire it too, so it is dead everywhere and not just here',
    (await evaluate(`window.__calls`)).includes('logout'), JSON.stringify(await evaluate(`window.__calls`)));
  ok('...and puts every invitation back where a visitor expects it',
    /sign in to your reports/i.test(await evaluate(`document.getElementById('hero-cta').textContent`))
    && await visible('#access-visitor') && !(await visible('#access-member')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} catch (err) {
  console.error('render-portal: ' + err.message);
  process.exitCode = 2;
} finally {
  try { ws && ws.close(); } catch {}
  try { SERVER.close(); } catch {}
  chrome.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
}
