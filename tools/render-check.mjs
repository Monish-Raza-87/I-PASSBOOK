// Render a page in headless Chrome at real device widths and report anything
// that overflows. NO node_modules — it drives Chrome's DevTools Protocol over the
// debugging port with Node's own WebSocket.
//
//   node tools/render-check.mjs _render-check.html
//   node tools/render-check.mjs faq.html 320 360 414 768 1024
//
// Exit code is 1 if any width overflows, so this can gate a deploy the way the
// smoke suites do.
//
// ── Why this exists, and why it is not just "open it and look" ────────────────
//
// Judging CSS by reading it fails. So does `--window-size`: Windows clamps it, so
// asking for 360 gives a ~500px viewport, and a layout measured at 500px reads as
// perfect while the same page at a real 360px phone is a mess. This sets the
// viewport through `Emulation.setDeviceMetricsOverride`, which is the browser's
// own phone emulation — the media queries then match the width being reported, so
// what is measured is what a phone would lay out.
//
// ── What counts as a failure ─────────────────────────────────────────────────
//
// Two things, and they are different bugs:
//
//   · the PAGE scrolls sideways — `documentElement.scrollWidth > width`. This is
//     the hard one; nothing anywhere in the app or its static pages may do it.
//   · an element sticks out past the right edge. Usually the cause of the first,
//     and named separately so the report says WHERE rather than just that.
//
// A pane that scrolls or CLIPS inside its own frame is exempt from the second and
// NOT from the first: the board and the chart axis scroll on purpose, and the IR
// row's meta line clips on purpose (views.css: `.ir-meta { overflow: hidden }` —
// the middle gives way so the status pills can never be pushed off the edge).
// `hidden` matters here and was missing at first: a clipped element still reports a
// `getBoundingClientRect().right` past the page edge — clipping changes the paint,
// not the box — so the IR list failed at 320px on `span.ir-age.is-late` while the
// page itself measured `scrollWidth 320` and not one pixel moved. The measurement
// that found it: on all six cards the age chip's right edge sat 43–314px past its
// own `.ir-meta` right edge, i.e. entirely inside the clip, and on two of them it
// happened to land past 320 as well. Exempting it here costs nothing, because
// genuine sideways movement is still caught by the page-scroll check above, which
// no descendant's overflow style can excuse.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const CHROME = CHROME_CANDIDATES.find(p => { try { return p && fs.existsSync(p); } catch { return false; } });
if (!CHROME) { console.error('render-check: no Chrome found at any known path'); process.exit(2); }

const args = process.argv.slice(2);
const page = args.find(a => !/^\d+$/.test(a));
const widths = args.filter(a => /^\d+$/.test(a)).map(Number);
if (!page) { console.error('usage: node tools/render-check.mjs <page.html> [width ...]'); process.exit(2); }
const WIDTHS = widths.length ? widths : [320, 360, 414, 768, 1024];
const fileUrl = pathToFileURL(path.resolve(page)).href;
const PORT = 9411 + Math.floor(Math.random() * 400);
// A FRESH profile directory per run. A fixed one is a trap: if a previous run's
// Chrome is still alive (a killed script, a crashed probe) it holds the profile
// lock, the new process silently hands off to the old one, and this tool reports
// "Chrome never opened a debugging target" — a message about the browser for a
// problem that is really about a leftover process.
const PROFILE = path.join(process.env.TEMP || os.tmpdir(), 'render-check-' + PORT);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  '--user-data-dir=' + PROFILE,
  fileUrl,
], { stdio: 'ignore' });

// The probe. Runs at each width and reports; it must never throw, because a
// throwing probe would look like a page with no problems.
const PROBE = `(() => {
  const W = window.innerWidth;
  const out = { width: W, scroll: document.documentElement.scrollWidth, out: [], clipped: [] };
  const scrollsItself = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
    }
    return false;
  };
  const name = el => (el.tagName.toLowerCase() +
    (el.id ? '#' + el.id : '') +
    (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')).slice(0, 70);
  document.querySelectorAll('body *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    if (r.right > W + 0.5 && !scrollsItself(el)) {
      out.out.push({ el: name(el), right: +r.right.toFixed(1), over: +(r.right - W).toFixed(1) });
    }
    // Text that cannot fit the box it was given. Not a failure on its own — an
    // ellipsised title is a design — but it is where a real truncation shows up.
    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 &&
        cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && cs.textOverflow !== 'ellipsis') {
      out.clipped.push({ el: name(el), text: (el.textContent || '').trim().slice(0, 30),
                         by: el.scrollWidth - el.clientWidth });
    }
  });
  out.out = out.out.slice(0, 25);
  out.clipped = out.clipped.slice(0, 25);
  return out;
})()`;

let tab;
try {
  for (let i = 0; i < 60 && !tab; i++) {
    try {
      const tabs = await getJson('/json');
      tab = tabs.find(t => t.type === 'page');
    } catch {}
    if (!tab) await sleep(250);
  }
  if (!tab) throw new Error('Chrome never opened a debugging target');

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params) => new Promise(res => {
    const id = ++seq; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  // Every call is bounded, and NOT only `Runtime.evaluate`. The first version of
  // this bounded the probe alone and hung forever on `Emulation.setDeviceMetrics`
  // — a CDP call whose reply simply never came — which is the same failure the note
  // below describes and just as silent: no output at all, which reads like "found
  // nothing to report". A dead socket is worse still, because there is nothing left
  // to answer at any timeout, so a close/error rejects everything still pending.
  const withTimeout = (p, ms, what) => Promise.race([
    p, new Promise(res => setTimeout(() => res({ __timeout: what }), ms)),
  ]);
  ws.addEventListener('close', () =>
    { for (const [id, res] of pending) res({ __timeout: 'the debugger connection closed' }); pending.clear(); });
  ws.addEventListener('error', () =>
    { for (const [id, res] of pending) res({ __timeout: 'the debugger connection errored' }); pending.clear(); });

  const cdp = (method, params) => withTimeout(send(method, params), 20000, method + ' never came back');
  for (const call of [['Page.enable'], ['Runtime.enable'], ['Page.navigate', { url: fileUrl }]]) {
    const r = await cdp(call[0], call[1]);
    if (r && r.__timeout) throw new Error(r.__timeout);
  }
  await sleep(900);   // fonts, and the app's own first paint

  let failures = 0;
  for (const width of WIDTHS) {
    const em = await cdp('Emulation.setDeviceMetricsOverride',
      { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
    if (em && em.__timeout) {
      console.log(`  FAIL  ${String(width).padStart(4)}px   ${em.__timeout}`);
      failures++;
      continue;
    }
    await sleep(250);
    const res = await withTimeout(send('Runtime.evaluate', { expression: PROBE, returnByValue: true }),
                                  15000, 'the probe');
    if (res.__timeout) {
      console.log(`  FAIL  ${String(width).padStart(4)}px   ${res.__timeout} never came back — ` +
        'the page is still busy (an unhandled fetch, a service worker, a media element)');
      failures++;
      continue;
    }
    const v = res.result && res.result.result && res.result.result.value;
    if (!v) { console.log(`  ${width}px  PROBE FAILED: ${JSON.stringify(res.result).slice(0, 160)}`); failures++; continue; }
    // The viewport really is the width asked for. Without `<meta name="viewport">`
    // a mobile emulation lays the page out at 980px and reports `innerWidth` 980,
    // so every width "passes" while nothing was measured at 320px at all — the
    // exact silent pass this tool exists to catch, so it asserts the width first.
    if (Math.abs(v.width - width) > 1) {
      console.log(`  FAIL  ${String(width).padStart(4)}px   the page laid out at ${v.width}px — ` +
        `is <meta name="viewport" content="width=device-width, initial-scale=1"> in the <head>?`);
      failures++;
      continue;
    }
    const pageScrolls = v.scroll > v.width + 1;
    const bad = pageScrolls || v.out.length;
    if (bad) failures++;
    console.log(`  ${pageScrolls ? 'FAIL' : 'ok  '}  ${String(width).padStart(4)}px   scrollWidth ${v.scroll}` +
      (v.out.length ? `   ${v.out.length} element(s) past the edge` : ''));
    v.out.forEach(o => console.log(`          ${o.el}  +${o.over}px`));
    v.clipped.forEach(c => console.log(`          (clipped ${c.by}px) ${c.el}  "${c.text}"`));
  }
  console.log(failures ? `\n${failures} width(s) FAILED` : '\nno overflow at any width');
  process.exitCode = failures ? 1 : 0;
} catch (err) {
  console.error('render-check: ' + err.message);
  process.exitCode = 2;
} finally {
  chrome.kill();
  // Best-effort: a leftover profile is what breaks the NEXT run, and on Windows
  // the handle is often still held for a moment after the process exits.
  try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
}
