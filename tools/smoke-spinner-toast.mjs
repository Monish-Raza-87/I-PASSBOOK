// Smoke test for the two pieces a person FEELS rather than looks at: the busy
// spinner and the toast (Stage 3 of the "build what was approved" release).
//
//   node tools/smoke-spinner-toast.mjs
//
// Both of these are restyles of machinery the app already had, and in both cases
// the machinery is the part that must not move. The toast's contract is asserted
// here in full because every one of its clauses fixes a way it has already stuck
// once: a queue that held the screen for six seconds, a timer whose handle was
// thrown away so a manual dismiss left a second one armed, and the message written
// OVER the span instead of into it, which silently killed the tap-to-dismiss.
//
// The spinner's assertions are about there being ONE of it. A ring drawn twice —
// once as a class, once as a ::before, or once per busy class name — is the exact
// way an app ends up with two spinners that drift apart.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// Comments are stripped before every STRUCTURAL check. The app's comments name
// these classes and keyframes on purpose — several of them exist to explain why a
// rule was removed — so a test that searched the raw text would fail on the prose
// describing the very absence it is asserting.
const stripCss = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs  = js  => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*/g, '$1');

const components = stripCss(read('components.css'));
const baseCss    = stripCss(read('base.css'));
const html       = read('index.html');
const appCode    = stripJs(read('app.js'));

const cssRule = (css, sel) =>
  (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}')) || [''])[0];

// ── The spinner: one ring, on the button itself ──────────────────────────────
r.head('the spinner is one ring, and it lives on the button');

const ringSel = (components.match(/([^{}]*?)\{[^}]*animation:\s*spin\b[^}]*\}/) || ['', ''])[1];
r.ok('the ring is declared once, for BOTH busy class names, in one rule',
  /\.btn\.saving::before\s*,\s*\.btn\.is-busy::before\s*$/.test(ringSel.trim()),
  ringSel);
r.ok('...and it animates on the keyframes base.css already declares',
  /@keyframes\s+spin\s*\{/.test(baseCss) &&
  (components.match(/@keyframes\s+spin\b/g) || []).length === 0,
  { inBase: /@keyframes\s+spin\s*\{/.test(baseCss), inComponents: (components.match(/@keyframes\s+spin\b/g) || []).length });

r.ok('the ring is drawn in currentColor, so it takes the colour of wherever it sits',
  (() => {
    const body = (components.match(/([^{}]*?)\{[^}]*animation:\s*spin\b[^}]*\}/) || ['', ''])[0];
    return /border:\s*2px solid currentColor/.test(body) &&
           /border-right-color:\s*transparent/.test(body);
  })());

r.ok('...and it is a pseudo-element, so it cannot be doubled or orphaned',
  /::before/.test(ringSel) && !/\.spinner-border\s*\{/.test(components) &&
  !/spinner-border/.test(appCode) && !/\.spinner-border\s*\{/.test(appCode));

r.ok('a busy button swallows the second tap — under BOTH of its class names',
  /\.btn\.saving\s*\{[^}]*pointer-events:\s*none/.test(components) &&
  /\.btn\.is-busy\s*\{[^}]*pointer-events:\s*none/.test(components));

r.ok('the button the ring lands in is already inline-flex with a gap, so nothing shifts',
  (() => {
    const btn = cssRule(components, '.btn');
    return /display:\s*inline-flex/.test(btn) && /gap:/.test(btn);
  })(), cssRule(components, '.btn').slice(0, 200));

r.ok('the reduced-motion guard still collapses every animation to one iteration',
  /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]{0,300}?animation-duration:\s*0\.01ms\s*!important[\s\S]{0,200}?animation-iteration-count:\s*1\s*!important/.test(baseCss));

r.ok('every auth button that goes busy goes back to idle through the one helper',
  (() => {
    const handlers = appCode.slice(appCode.indexOf('const submitLogin'),
                                   appCode.indexOf('const submitReset'));
    const busy   = (handlers.match(/set(Busy|Idle)\(/g) || []).length;
    const manual = (handlers.match(/\.disabled\s*=\s*(true|false)/g) || []).length;
    return busy >= 8 && busy % 2 === 0 && manual === 0;
  })(),
  { setBusyOrIdle: (appCode.slice(appCode.indexOf('const submitLogin'), appCode.indexOf('const submitReset')).match(/set(Busy|Idle)\(/g) || []).length });

r.ok('...and no auth button swaps its label by hand any more',
  !/signInBtn\.textContent|otpBtn\.textContent|forgotBtn\.textContent|resetBtn\.textContent/.test(appCode));

// ── The toast: the shape in the markup ───────────────────────────────────────
r.head('the toast is one element, and one span inside it');

r.ok('index.html carries exactly one #toast holding exactly one #toast-text',
  (html.match(/id="toast"/g) || []).length === 1 &&
  (html.match(/id="toast-text"/g) || []).length === 1 &&
  /<div id="toast"[^>]*><span id="toast-text"><\/span><\/div>/.test(html),
  (html.match(/<div id="toast"[\s\S]{0,140}/) || [''])[0]);

r.ok('...and the span is the only thing in it that can be painted',
  /#toast-text\s*\{\s*pointer-events:\s*none;\s*\}/.test(baseCss));

r.ok('the span still lets a tap through to the pill that dismisses it',
  /#toast-text\s*\{[^}]*pointer-events:\s*none/.test(baseCss) &&
  (html.match(/id="toast-text"/g) || []).length === 1);

// ── The toast: the contract, in the code ─────────────────────────────────────
r.head('the toast replaces, never queues');

r.ok('the interval is 2500ms and it is read, never a second literal',
  /const TOAST_MS\s*=\s*2500;/.test(appCode) && (appCode.match(/TOAST_MS/g) || []).length === 2 &&
  !/setTimeout\([^)]*,\s*2500\s*\)/.test(appCode),
  (appCode.match(/TOAST_MS/g) || []).length);

r.ok('the message is written INTO the span, with a fallback for a stale cached shell',
  /const slot = document\.getElementById\('toast-text'\);[\s\S]{0,120}?if \(slot\) slot\.textContent = msg; else toast\.textContent = msg;/
    .test(appCode));

r.ok('...and never assigned to the pill itself, which would delete the span',
  !/\btoast\.textContent\s*=/.test(appCode.replace(/else toast\.textContent = msg;/, '')));

r.ok('the previous timer is cleared, so there is no backlog of messages',
  /if \(_toastTimer\) clearTimeout\(_toastTimer\);\s*\n\s*_toastTimer = setTimeout\(/.test(appCode));

r.ok('dismissing by hand cancels the armed timer rather than leaving it to fire',
  /function hideToast\(\)\s*\{[\s\S]{0,140}?clearTimeout\(_toastTimer\);[\s\S]{0,80}?toast\.classList\.remove\('show'\)/.test(appCode));

r.ok('the class toggle is `.show` and nothing else',
  /toast\.classList\.add\('show'\)/.test(appCode) &&
  /toast\.classList\.remove\('show'\)/.test(appCode) &&
  /#toast\.show\s*\{/.test(baseCss));

r.ok('there is no queue anywhere in the toast — no array, no push, no shift',
  (() => {
    const start = appCode.indexOf('function showToast');
    const end   = appCode.indexOf('\r\n}', start) < 0
      ? appCode.indexOf('\n}', start)
      : appCode.indexOf('\r\n}', start);
    const block = appCode.slice(start, end + 2);
    return block.length > 200 && block.length < 900 && !/\.push\(|\.shift\(|\[/.test(block);
  })(), appCode.slice(appCode.indexOf('function showToast'), appCode.indexOf('function showToast') + 700));

// ── The toast: what it actually does ─────────────────────────────────────────
r.head('and it does that, driven for real');

const { T, byId } = loadApp(`
  showToast, hideToast, TOAST_MS,
  get _toastTimer() { return _toastTimer; },
`, { capture: true });

// The span is looked up per assertion rather than once: with `capture: true`
// getElementById memoises on FIRST CALL, and nothing has asked for #toast-text
// until showToast runs.
const pill = byId.get('toast');
const span = () => byId.get('toast-text');

T.showToast('Section saved');
r.ok('one message shows the pill and writes into the span',
  span().textContent === 'Section saved' && pill.classList.contains('show') &&
  T._toastTimer !== null, { text: span().textContent, armed: T._toastTimer !== null });

T.showToast('Saved locally — backend unreachable');
r.ok('a second message REPLACES the first, and only one timer is armed',
  span().textContent === 'Saved locally — backend unreachable' && T._toastTimer !== null &&
  pill.classList.contains('show'));

T.hideToast();
r.ok('and it can be dismissed by hand, which disarms the timer',
  !pill.classList.contains('show') && T._toastTimer === null);

r.ok('a message after a dismissal comes back — the busy flag cannot latch',
  (() => {
    T.showToast('again');
    return span().textContent === 'again' && pill.classList.contains('show');
  })());

r.finish();
