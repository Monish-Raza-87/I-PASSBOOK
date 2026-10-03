// Screenshot a page in each theme mode, at real device widths.
//
//   node tools/render-themes.mjs preview/parts.html
//   node tools/render-themes.mjs tools/.cache/polish-preview.html --width 1280 --height 1100
//
// Writes tools/.cache/theme-shots/<page>-<theme>-<width>.png and prints the path
// of each. NO node_modules — same DevTools-Protocol-over-the-debugging-port
// approach as tools/render-check.mjs, and for the same reason: Windows clamps
// `--window-size`, so a "phone" shot taken that way is really a ~500px one.
//
// ── Why this exists ───────────────────────────────────────────────────────────
//
// Judging CSS by reading it fails. The three themes in theme.css make claims —
// that light stops glaring, that dark's borders became visible, that cream is
// warm — and those claims are about how a rendered pixel LOOKS, not about a ratio
// in a test. smoke-theme.mjs proves the numbers; this proves the pixels. Neither
// is sufficient alone.

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
if (!CHROME) { console.error('render-themes: no Chrome found at any known path'); process.exit(2); }

const argv = process.argv.slice(2);
const page = argv.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
if (!page) { console.error('usage: node tools/render-themes.mjs <page.html|http://url> [--width N] [--height N] [--themes a,b,c] [--seed "js"] [--settle ms]'); process.exit(2); }
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const WIDTH = Number(flag('width', 1280));
const HEIGHT = Number(flag('height', 900));
const THEMES = flag('themes', 'light,cream,dark').split(',');
const SETTLE = Number(flag('settle', 1800));
// Injected before ANY page script runs, on every navigation — the way a device
// that has already seen the intro would look. Without it the intro plays in full
// (~9s) and every shot is of a video.
const SEED = flag('seed', '');
// Run after the page has settled and before the capture, on EVERY mode. This is
// how a state that is not stored anywhere — the full-screen board, a half-finished
// drag — can be photographed at all. Its return value is printed, so a driver that
// silently did nothing is visible rather than looking like a layout bug.
const EVAL = flag('eval', '');

const ROOT = path.resolve(import.meta.dirname, '..');
const target = /^https?:/.test(page) ? page : pathToFileURL(path.resolve(page)).href;
const label = /^https?:/.test(page) ? (page.replace(/[^\w]+/g, '_').slice(0, 40))
  : path.basename(page, '.html');
const OUT = path.join(ROOT, 'tools', '.cache', 'theme-shots');
fs.mkdirSync(OUT, { recursive: true });

// A fresh profile per run: a leftover Chrome from a killed run holds the profile
// lock, the new process silently hands off to it, and this reports "no debugging
// target" — a browser-shaped message for a leftover-process problem.
const PORT = 9820 + Math.floor(Math.random() * 400);
const PROFILE = path.join(process.env.TEMP || os.tmpdir(), 'render-themes-' + PORT);
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
  target,
], { stdio: 'ignore' });

let tab;
try {
  for (let i = 0; i < 60 && !tab; i++) {
    try { tab = (await getJson('/json')).find(t => t.type === 'page'); } catch {}
    if (!tab) await sleep(250);
  }
  if (!tab) throw new Error('Chrome never opened a debugging target');

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params) => new Promise(res => {
    const id = ++seq; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  // Bounded, always: a page that boots the whole app can leave a CDP call waiting
  // forever, and an unbounded await looks exactly like a tool that found nothing.
  const withTimeout = (p, ms, what) => Promise.race([
    p, new Promise(res => setTimeout(() => res({ __timeout: what }), ms)),
  ]);

  await send('Page.enable');
  await send('Runtime.enable');
  if (SEED) await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED });
  await send('Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 640 });
  await send('Page.navigate', { url: target });
  await sleep(SETTLE);   // fonts, the splash, and the app's first paint

  // Each mode is reached by writing the stored preference and RELOADING, not by
  // stamping the attribute afterwards. That is the path a real device takes, so
  // it exercises the pre-paint script in index.html too — a theme that only
  // appears when you set the attribute by hand is a theme that flashes white on
  // every load. The direct stamp stays as a fallback and says when it was needed.
  const stamp = t => `(() => {
    try { localStorage.setItem('theme', ${JSON.stringify(t)}); } catch (e) {}
    return true;
  })()`;

  const probeExpr = `(() => {
    const r = document.documentElement;
    const g = n => getComputedStyle(r).getPropertyValue(n).trim();
    return { mode: r.getAttribute('data-theme') || 'light',
             panel: g('--surface-base'), ground: g('--surface-gray-1'), line: g('--outline-gray-1') };
  })()`;

  for (const t of THEMES) {
    const set = await withTimeout(send('Runtime.evaluate', { expression: stamp(t), returnByValue: true }),
      15000, 'the preference write');
    if (set.__timeout) { console.log(`  ${t}: ${set.__timeout} never came back`); continue; }
    await send('Page.reload');
    await sleep(SETTLE);

    let said = '';
    if (EVAL) {
      // awaitPromise so an expression can wait for a transition to finish (or any
      // other timed state) before the shot; a plain value still resolves at once.
      const r = await withTimeout(send('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true }),
        15000, 'the --eval expression');
      const v = r.result && r.result.result;
      said = r.__timeout ? `  eval: ${r.__timeout} never came back`
        : v && v.value !== undefined ? `  eval → ${JSON.stringify(v.value)}`
        : r.result && r.result.exceptionDetails ? `  eval THREW: ${r.result.exceptionDetails.text}`
        : '';
    }

    let probe = await withTimeout(send('Runtime.evaluate', { expression: probeExpr, returnByValue: true }),
      15000, 'the colour probe');
    let v = probe.result && probe.result.result && probe.result.result.value;
    let forced = '';
    if (v && v.mode !== t) {
      // Storage was unavailable (a file:// origin) or the page ignored it. Force
      // the mode so the shot is still worth taking — and say so.
      await send('Runtime.evaluate', {
        expression: t === 'light'
          ? `document.documentElement.removeAttribute('data-theme')`
          : `document.documentElement.setAttribute('data-theme', ${JSON.stringify(t)})`,
        returnByValue: true,
      });
      await sleep(220);
      probe = await withTimeout(send('Runtime.evaluate', { expression: probeExpr, returnByValue: true }),
        15000, 'the colour probe');
      v = probe.result && probe.result.result && probe.result.result.value;
      forced = '  (stamped by hand — the page did not pick it up)';
    }
    await sleep(220);   // let transitions settle before capturing

    const cap = await withTimeout(send('Page.captureScreenshot', { format: 'png' }), 20000, 'the capture');
    if (!cap || !cap.result || !cap.result.data) { console.log(`  ${t}: capture failed`); continue; }

    const file = path.join(OUT, `${label}-${t}-${WIDTH}.png`);
    fs.writeFileSync(file, Buffer.from(cap.result.data, 'base64'));
    console.log(`  ${t.padEnd(6)} ${path.relative(ROOT, file)}` +
      (v ? `   panel ${v.panel}  ground ${v.ground}  line ${v.line}` : '') + forced + said);
  }
} finally {
  try { chrome.kill(); } catch {}
}
