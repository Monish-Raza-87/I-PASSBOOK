// Smoke test for the app-owned workflow-state layer (`__IRS__`).
//
//   node tools/smoke-ir-state.mjs
//
// app.js is a plain end-of-body script with no exports, so this evaluates the
// whole file under a stubbed DOM and then reaches into its lexical scope through
// a harness appended to the source (see `__T` below). That makes the test
// self-contained — no copy of the merge logic to drift out of date — and it also
// proves app.js still evaluates top-to-bottom: every parse-time
// getElementById call and every module-level statement runs for real here.
//
// What it covers is the risky part of the Frappe pivot: precedence between the
// Sheet's Col D and the app's own status, and the exact point at which the app
// takes a ticket's status over. Stage 4 (ageing, SLA) and Stage 5 (dashboard)
// both read these values, so a regression here is silent and expensive.

import fs from 'node:fs';

const APP_JS = new URL('../app.js', import.meta.url);

// ── Minimal DOM ────────────────────────────────────────────────────────────────
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

const store = {};
const storage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

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
    getElementById: () => el(),
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

// `let`/`const` at the top level of a script are not properties of the global
// object, so reach them through getters appended in the same lexical scope.
const HARNESS = `
;globalThis.__T = {
  setAllIRs, applyIRStateToAllIRs, appState, ownedStatus, markSectionDone, initialsOf,
  statusCategory, IR_STATUS_VALUES, TICKET_TYPES,
  get allIRs() { return allIRs; },
  get irState() { return irState; }, set irState(v) { irState = v; },
  get currentIR() { return currentIR; }, set currentIR(v) { currentIR = v; },
};`;

const { createContext, runInContext } = await import('node:vm');
const src = fs.readFileSync(APP_JS, 'utf8') + HARNESS;
createContext(ctx);
runInContext(src, ctx, { filename: 'app.js' });
const T = ctx.__T;

// ── Assertions ────────────────────────────────────────────────────────────────
let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

head('constants');
ok('14 status values, unchanged', T.IR_STATUS_VALUES.length === 14, T.IR_STATUS_VALUES);
ok("statuses are the Form's exact strings",
  T.IR_STATUS_VALUES.includes('QC Investigation') && T.IR_STATUS_VALUES.includes('Remote Support'),
  T.IR_STATUS_VALUES);
ok('ticket types present', T.TICKET_TYPES.length === 7, T.TICKET_TYPES);

head('merge precedence (app > Sheet)');
// Three tickets as fetchIRsFromSheet hands them over: status from Col D.
T.setAllIRs([
  { irNumber: 'IR409', status: 'Inward',            droneId: 'S25G-1', dateRaised: '1 Aug' },
  { irNumber: 'IR410', status: 'Visual Inspection', droneId: 'S75-2',  dateRaised: '2 Aug' },
  { irNumber: 'IR411', status: 'Open',              droneId: 'F-3',    dateRaised: '3 Aug' },
]);
T.irState = {
  // Triaged: the app owns the status.
  IR409: { status: 'Production', statusOwned: true, statusAt: 1, statusBy: 'a@indrones.com',
           assignee: 'ravi@indrones.com', assigneeName: 'Ravi Singh', priority: 'Urgent',
           type: 'Repair', done: ['sec-a', 'sec-b'], updatedBy: 'a@indrones.com' },
  // First-sight seed: the app has seen this ticket but nobody has edited it.
  IR410: { status: '', seededAt: 1, seededFrom: 'sheet', seededBy: 'a@indrones.com' },
  // Section B saved (a real edit) but the status was never set by the app.
  IR411: { done: ['sec-b'], updatedBy: 'a@indrones.com' },
};
T.applyIRStateToAllIRs();
const by = n => T.allIRs.find(i => i.irNumber === n);

ok('app status beats Sheet Col D', by('IR409').status === 'Production', by('IR409').status);
ok('assignee lands on the record', by('IR409').assigneeName === 'Ravi Singh', by('IR409').assignee);
ok('priority lands on the record', by('IR409').priority === 'Urgent', by('IR409').priority);
ok('done[] lands on the record', by('IR409').done.length === 2, by('IR409').done);
ok('a bare seed does NOT claim the status', by('IR410').status === 'Visual Inspection', by('IR410').status);
ok('a bare seed exposes no assignee', !by('IR410').assignee, by('IR410').assignee);
ok('saving a section does NOT claim the status', by('IR411').status === 'Open', by('IR411').status);
ok('but it does record the section as done', by('IR411').done.join(',') === 'sec-b', by('IR411').done);
ok('appState() rejects a bare seed', T.appState('IR410') === null, T.appState('IR410'));
ok('appState() accepts a real edit', !!T.appState('IR409'));
ok('ownedStatus() is empty for a section-save-only row', T.ownedStatus('IR411') === '', T.ownedStatus('IR411'));
ok('ownedStatus() returns the triaged status', T.ownedStatus('IR409') === 'Production', T.ownedStatus('IR409'));

head('the badge bug, and that it is fixed');
// Before: the list badge read Col D, so an in-app status change never showed —
// even though everything else about the change was saved correctly.
ok('IR409 badge shows the app value, not Inward', by('IR409').status === 'Production', by('IR409').status);
ok('and it colours by the new category', T.statusCategory('Production') === 'open', T.statusCategory('Production'));
ok('Hold still maps to paused', T.statusCategory('Hold') === 'paused');
ok('Delivered still maps to resolved', T.statusCategory('Delivered') === 'resolved');

head('a Sheet edit cannot overwrite a triaged ticket');
T.setAllIRs([{ irNumber: 'IR409', status: 'Close', droneId: 'S25G-1', dateRaised: '1 Aug' }]);
ok('re-fetch + re-merge keeps the app value', by('IR409').status === 'Production', by('IR409').status);

head('section completion');
ok('markSectionDone adds', T.markSectionDone('IR409', 'sec-c').join(',') === 'sec-a,sec-b,sec-c', T.markSectionDone('IR409', 'sec-c'));
ok('markSectionDone is idempotent', T.markSectionDone('IR409', 'sec-a').join(',') === 'sec-a,sec-b', T.markSectionDone('IR409', 'sec-a'));
ok('markSectionDone does not mutate irState', T.irState.IR409.done.join(',') === 'sec-a,sec-b', T.irState.IR409.done);
ok('a brand-new IR starts its done list', T.markSectionDone('IR999', 'sec-a').join(',') === 'sec-a');

head('initials');
ok('"Monish Raza" → MR', T.initialsOf('Monish Raza') === 'MR', T.initialsOf('Monish Raza'));
ok('email → MR', T.initialsOf('monish.raza@indrones.com') === 'MR', T.initialsOf('monish.raza@indrones.com'));
ok('single word → 2 chars', T.initialsOf('Ravi') === 'RA', T.initialsOf('Ravi'));
ok('empty → ?', T.initialsOf('') === '?', T.initialsOf(''));
ok('undefined does not throw', T.initialsOf(undefined) === '?');

head('records with no Sheet date (legacy / demo paths)');
T.setAllIRs([{ irNumber: 'IR900', status: 'Open' }]);
ok('missing dateRaised survives the merge', by('IR900').dateRaised === undefined);
ok('missing droneId survives the merge', by('IR900').droneId === undefined);

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
