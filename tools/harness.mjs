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
//
// `classList` and the attribute pair are the exceptions to "minimal": they are
// REAL, backed by a Set and a map. A stub that swallows `toggle()` would make
// every collapse/expand assertion vacuous — the test could not fail, which is
// worse than no test. `toggle(name, force)` follows the DOM signature exactly,
// including the two-argument `force` form the app leans on.
function el() {
  const classes = new Set();
  const attrs = new Map();
  return {
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    classList: {
      add(...names) { names.forEach(n => classes.add(n)); },
      remove(...names) { names.forEach(n => classes.delete(n)); },
      contains: n => classes.has(n),
      toggle(n, force) {
        const on = force === undefined ? !classes.has(n) : !!force;
        on ? classes.add(n) : classes.delete(n);
        return on;
      },
      get length() { return classes.size; },
    },
    _classes: classes,
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, blur() {},
    setAttribute(n, v) { attrs.set(n, String(v)); },
    getAttribute(n) { return attrs.has(n) ? attrs.get(n) : null; },
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
 * @param {{capture?: boolean, splitStorage?: boolean, globals?: object, preload?: string}} [opts]
 *   `capture: true` memoizes elements by id so a test can read back what a render
 *   wrote, and returns `{ T, byId }` instead of just `T`. `splitStorage: true` gives
 *   localStorage and sessionStorage SEPARATE stores (see below). `globals` are
 *   assigned onto the sandbox before app.js runs, for a suite that needs the app to
 *   see something the stub DOM does not provide. `preload` is source evaluated inside
 *   the sandbox for the same reason but in the sandbox's own realm — see the note in
 *   the body.
 * @returns the populated `__T` object, or `{ T, byId }` when capturing.
 */
export function loadApp(bindings = '', opts = {}) {
  const makeStorage = () => {
    const store = {};
    return {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    };
  };
  // Default: ONE shared store behind both names.
  //
  // That is wrong in general — in a browser they are different stores, and the
  // session model is precisely the thing that moved from one to the other. It is
  // kept as the default because the older suites were written against it and
  // would otherwise see their fixture state vanish. `splitStorage: true` opts into
  // the browser-faithful behaviour, which is what lets smoke-session.mjs prove
  // that a session survives a sessionStorage wipe.
  const shared = makeStorage();
  const storage = shared;
  const storage2 = opts.splitStorage ? makeStorage() : shared;

  const byId = new Map();
  const getElementById = opts.capture
    // Persistent, so innerHTML written by a render survives to be asserted on.
    ? id => { if (!byId.has(id)) byId.set(id, el()); return byId.get(id); }
    : () => el();

  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams, AbortController,
    // NOTE the absence of Array / Object / String / Number / Date / Math / JSON /
    // Promise / Set / Map / RegExp / Error / Intl.
    //
    // A context has its own intrinsics, and handing it the host's would shadow them:
    // every `[a, b]` literal in app.js is then an array of the SANDBOX's realm while
    // the name `Array` resolves to the HOST's, so `x instanceof Array` — which the
    // vendored pdf-lib uses to recognise a page size — is false for the app's own
    // array. smoke-store.mjs already loads backend.gs this way and for this reason.
    // Only genuinely non-V8 globals (the ones a bare context lacks) are supplied.
    alert() {},
    // No network: every loader takes its failure branch, which is also the branch
    // the "backend unreachable" behaviour depends on.
    fetch: opts.fetch || (() => Promise.reject(new Error('no network in test'))),
    localStorage: storage,
    sessionStorage: storage2,
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
  // Extra globals a suite needs the app to see.
  if (opts.globals) Object.assign(ctx, opts.globals);
  // Only when a suite supplies its own transport. app.js posts with FormData, so
  // a suite that drives the real login path needs the constructor to exist; it is
  // left undefined otherwise so no existing suite changes behaviour.
  if (opts.fetch) {
    ctx.FormData = class { constructor() { this.entries = []; } append(k, v) { this.entries.push([k, v]); } };
  }
  // `desktop: true` reports a ≥1024px viewport, which is the ONLY way to exercise
  // the desktop half of renderLayout — the two halves put the list and the detail
  // pane on one screen or on two, so a suite that only ever sees the default would
  // silently test the phone layout and call it the layout.
  ctx.matchMedia = q => ({
    matches: !!opts.desktop && /min-width/.test(String(q)),
    addEventListener() {}, addListener() {}, removeEventListener() {},
  });
  ctx.window.matchMedia = ctx.matchMedia;
  ctx.window.addEventListener = () => {};
  ctx.window.location = ctx.location;

  const src = fs.readFileSync(APP_JS, 'utf8') + `\n;globalThis.__T = {\n${bindings}\n};`;
  createContext(ctx);
  // Source evaluated INSIDE the sandbox, before app.js.
  //
  // This is not the same thing as `globals`. A library handed in through `globals`
  // was built in this file's realm, and pdf-lib in particular rejects the app's own
  // array literals — its page-size check is realm-sensitive, so `doc.addPage([w, h])`
  // from inside the sandbox throws "must be of type ... or Array". Evaluating the
  // library here gives the app one built from the sandbox's own intrinsics, which is
  // what a browser has. Used by smoke-export.mjs for the vendored pdf-lib.
  if (opts.preload) runInContext(opts.preload, ctx, { filename: 'preload.js' });
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
