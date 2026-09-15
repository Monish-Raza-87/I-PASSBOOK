// Shared smoke-test harness.
//
// app.js is a plain end-of-body <script> with no exports (a load-bearing
// contract of the app), so the only way to test it is to run the real file and
// then reach into its lexical scope. `loadApp` evaluates the whole source under
// a stubbed DOM and returns a `__T` object built from getters appended in that
// same lexical scope.
//
// Running the file is itself half the test: it proves app.js still evaluates top
// to bottom, so every parse-time getElementById and every module-level statement
// executes for real here rather than being assumed to work.

import fs from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const APP_JS = new URL('../app.js', import.meta.url);

// Minimal DOM: enough for module-level statements and the render paths to run,
// with nothing that could pass a test the browser would fail.
function el() {
  return {
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, focus() {}, blur() {},
    scrollIntoView() {}, children: [], insertBefore() {}, closest() { return null; },
  };
}

/**
 * Evaluate app.js under a stubbed DOM.
 *
 * @param {string} bindings Extra property definitions for the `__T` object, e.g.
 *   `'mapSheetRows, INTAKE_FIELDS, get lastSheetAudit() { return lastSheetAudit; }'`.
 *   `let`/`const` at a script's top level are not properties of the global
 *   object, so they can only be reached from inside this lexical scope.
 * @param {{capture?: boolean}} [opts] `capture: true` memoizes elements by id so
 *   a test can read back what a render wrote, and returns `{ T, byId }` instead
 *   of just `T`.
 * @returns the populated `__T` object, or `{ T, byId }` when capturing.
 */
export function loadApp(bindings = '', opts = {}) {
  const store = {};
  const storage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };

  const byId = new Map();
  const getElementById = opts.capture
    // Persistent, so innerHTML written by a render survives to be asserted on.
    ? id => { if (!byId.has(id)) byId.set(id, el()); return byId.get(id); }
    : () => el();

  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams, AbortController, Date, Math, JSON, Promise, Set, Map,
    Array, Object, String, Number, RegExp, Error, Intl,
    alert() {},
    // No network: every loader takes its failure branch, which is also the branch
    // the "backend unreachable" behaviour depends on.
    fetch: () => Promise.reject(new Error('no network in test')),
    localStorage: storage,
    sessionStorage: storage,
    navigator: { userAgent: 'node', onLine: true },
    location: { hash: '', search: '', hostname: '127.0.0.1', protocol: 'http:', href: 'http://127.0.0.1:3000/' },
    document: {
      getElementById,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => el(),
      body: el(),
      documentElement: el(),
      addEventListener() {},
      readyState: 'complete',
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {}, removeEventListener() {} });
  ctx.window.matchMedia = ctx.matchMedia;
  ctx.window.addEventListener = () => {};
  ctx.window.location = ctx.location;

  const src = fs.readFileSync(APP_JS, 'utf8') + `\n;globalThis.__T = {\n${bindings}\n};`;
  createContext(ctx);
  runInContext(src, ctx, { filename: 'app.js' });
  return opts.capture ? { T: ctx.__T, byId } : ctx.__T;
}

/** Tiny assertion helpers, so every smoke test reports the same way. */
export function makeReporter() {
  let fails = 0;
  return {
    ok(name, cond, extra) {
      console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
      if (!cond) fails++;
    },
    head: t => console.log('\n— ' + t + ' —'),
    finish() {
      console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
      process.exit(fails ? 1 : 0);
    },
    get fails() { return fails; },
  };
}
