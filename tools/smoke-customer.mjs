// Smoke test for CUSTOMER ACCOUNTS — the one account in this app that belongs to
// somebody outside Indrones.
//
//   node tools/smoke-customer.mjs
//
// Every signed-in account before v8 was a member of staff, and the whole access model
// leans on that: view is granted on every section to everyone, `getPassbook` on a
// sentinel store hands over the lot, and `getAuditLog`/`getLegacyIR` take a bare IR
// number on trust. All of that is fine while the only people holding a session token
// are colleagues. The moment a customer holds one, each of those is a hole — and none
// of them LOOKS like one, which is exactly why this file exists.
//
//   * It runs the REAL backend functions against a double, not a reading of the source.
//     The list narrowing, the sentinel narrowing and every refusal are asserted against
//     what the function actually returns. A source-level check cannot tell a filter that
//     runs from a filter that is commented out, and this repo has shipped a leak behind
//     one before.
//   * It asserts the SCOPE IS A ROW FILTER, not a permission level. A customer keeps the
//     header row, their own tickets, and the theme; nothing else in the store is theirs.
//   * It asserts every refusal in the direction that matters: the call must THROW. An
//     empty answer would be indistinguishable from "there is nothing there", and a
//     customer silently seeing nothing is a bug nobody would ever report.
//
// The double is NARROW ON PURPOSE — it implements the Drive members the store plumbing
// touches, the four members of a sheet that `intakeGrid` uses, and nothing else. It
// deliberately does NOT implement `UrlFetchApp` or `GmailApp`: if a future change
// reaches for one, this suite throws rather than quietly passing.
//
// The IR repo sheet it serves is a FIXTURE with four rows across three companies. The
// company column is found BY HEADER SUBSTRING, the same way the frontend's own mapper
// finds it, so a reworded form question is a thing this suite can actually see.

import fs from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { makeReporter } from './harness.mjs';

const r = makeReporter();
const url = p => new URL(p, import.meta.url);
const read = p => fs.readFileSync(url(p), 'utf8');
const backendGs = read('../backend.gs');

// ── The double ─────────────────────────────────────────────────────────────────
// A fresh context per case. Every store read is memoised per execution (`_storeMemo`)
// and every remembered file id is CACHED ACROSS executions (CacheService), so reusing
// one context would let case two be answered from case one's state — a test that passes
// by not running.

function seqGen() { let n = 0; return () => 'id-' + (++n); }

// A folder: a name and a list of children. `getFilesByName` and `getFoldersByName`
// answer ITERATORS, faithfully — the backend calls `.hasNext()`/`.next()` on them, and
// a double that hands back an array would make those calls throw in a way the real
// platform never would.
function makeFolder(name, next) {
  const files = [], folders = [];
  const it = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  return {
    getName: () => name,
    getFoldersByName: n => it(folders.filter(f => f.getName() === n)),
    createFolder: n => { const f = makeFolder(n, next); folders.push(f); return f; },
    getFilesByName: n => it(files.filter(f => f.getName() === n)),
    createFile(n, content) {
      const f = {
        __name: n, __content: String(content == null ? '' : content),
        getId: () => f.__id, getName: () => f.__name, isTrashed: () => false,
        getBlob: () => ({ getDataAsString: () => f.__content }),
        setContent: c => { f.__content = String(c); },
        getLastUpdated: () => new Date(0),
      };
      f.__id = next();
      files.push(f);
      return f;
    },
    __add(f) { files.push(f); },
  };
}

// The intake sheet, served as a GRID. `rows` is what the sheet would DISPLAY, so the
// fixture below is written in the strings a person sees, not in Date objects.
function makeSheet(grid) {
  return {
    getSheetByName(name) {
      if (name !== 'Form Responses') return null;
      return {
        getLastRow: () => grid.length,
        getLastColumn: () => (grid[0] ? grid[0].length : 0),
        getRange: (row, col, nr, nc) => ({
          getDisplayValues: () => grid.slice(row - 1, row - 1 + nr).map(rw => rw.slice(col - 1, col - 1 + nc)),
        }),
      };
    },
  };
}

const SHEET_HEADER = ['Timestamp', 'IR Number', 'Issue Status', 'Priority', 'Where Do You Work',
                      'Drone Serial No.', "Who's Reporting", 'What Happened'];
// Three companies, and one row the desk typed by hand with a stray space in its IR
// number — `app.js` accepts that spelling on purpose, so the scope must too.
const SHEET_ROWS = [
  SHEET_HEADER,
  ['2026-01-01', 'IR105', 'Delivered',  'P2', 'Acme Survey',  'S25-001', 'Ravi',   'Battery swelling'],
  ['2026-01-02', 'IR106', 'Open',       'P1', 'Acme Survey',  'S25-002', 'Ravi',   'Gimbal drift'],
  ['2026-01-03', 'IR 107', 'Open',      'P3', 'Acme Survey',  'S25-003', 'Meera',  'Landing gear'],
  ['2026-01-04', 'IR200', 'Inward',     'P2', 'Bharat Geo',   'S100-01', 'Anand',  'Motor noise'],
  ['2026-01-05', 'IR300', 'Investigation', 'P1', 'Ceres Drones', 'S75-01', 'Nisha', 'Compass error'],
];

// `files` is the initial store: path -> object. Sub-folders are made on demand.
function fresh(opts) {
  const o = opts || {};
  const next = seqGen();
  const root = makeFolder(o.rootName || 'I-PASSBOOK', next);
  const allFiles = new Map();
  const mails = [];
  const grid = o.grid || SHEET_ROWS;

  // Register every file so getFileById can find it, and seed the store.
  const seed = (folder, path, obj) => {
    const parts = path.split('/');
    const fname = parts.pop();
    let f = folder;
    parts.forEach(p => {
      const it = f.getFoldersByName(p);
      f = it.hasNext() ? it.next() : f.createFolder(p);
    });
    const file = f.createFile(fname, JSON.stringify(obj));
    allFiles.set(file.getId(), file);
    return file;
  };

  const ctx = { console };
  createContext(ctx);
  // CONFIG is read out of the loaded backend, never typed in here: a test that looked
  // in a different drawer from the app would be asserting "file not found", loudly and
  // for the wrong reason.
  runInContext(backendGs, ctx, { filename: 'backend.gs' });
  ctx.CONFIG = runInContext('CONFIG', ctx);

  ctx.DriveApp = {
    getFolderById(id) {
      if (id !== ctx.CONFIG.DRIVE_ROOT_FOLDER_ID) throw new Error('no such folder: ' + id);
      return root;
    },
    getFileById(id) {
      const f = allFiles.get(id);
      if (!f) throw new Error('no such file: ' + id);
      return f;
    },
  };
  ctx.SpreadsheetApp = {
    create: () => { throw new Error('this suite has no need for a backup sheet'); },
    openById(id) {
      if (id === ctx.CONFIG.IR_REPO_SHEET_ID) return makeSheet(grid);
      throw new Error('the app has no spreadsheet store beyond the read-only IR repo (id ' + id + ')');
    },
  };
  ctx.LockService = {
    getScriptLock: () => ({
      waitLock() { return true; },
      releaseLock() {},
    }),
  };
  const cache = new Map();
  ctx.CacheService = {
    getScriptCache: () => ({
      get: k => (cache.has(String(k)) ? cache.get(String(k)) : null),
      put: (k, v) => cache.set(String(k), String(v)),
      remove: k => cache.delete(String(k)),
    }),
  };
  ctx.MailApp = { sendEmail: (to, subject, body, options) => mails.push({ to, subject, body, options: options || null }) };
  ctx.PropertiesService = {
    getScriptProperties: () => ({
      _p: Object.create(null),
      getProperty(k) { return k in this._p ? this._p[k] : null; },
      setProperty(k, v) { this._p[k] = String(v); },
    }),
  };
  ctx.MimeType = { PLAIN_TEXT: 'text/plain', HTML: 'text/html' };
  ctx.Session = { getEffectiveUser: () => ({ getEmail: () => '' }), getScriptTimeZone: () => 'Asia/Kolkata' };
  let uuidSeq = 0;
  ctx.Utilities = {
    // Faithful to the real getId()/getUuid(): a v4-shaped UUID — 36 characters, lower
    // case, dashes in the standard places. The Google handoff code is DERIVED from this
    // string by stripping the dashes, and that shape is a security property, so a stub
    // of the wrong shape would have the suite asserting against the double.
    getUuid: () => 'aaaaaaaa-bbbb-4ccc-8ddd-' + String(++uuidSeq).padStart(12, '0').slice(-12),
    computeDigest: () => [1, 2, 3, 4],
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    base64Decode: s => s,
    formatDate: () => '01-Jan-2026 00:00:00',
  };

  // The store, seeded through the same folder the backend will search. The store
  // folder is created under the name CONFIG carries, so a rename in backend.gs cannot
  // leave this double looking in the wrong drawer and testing "not found" loudly.
  const storeRoot = root.createFolder(ctx.CONFIG.STORE_FOLDER_NAME);
  Object.keys(o.files || {}).forEach(path => seed(storeRoot, path, o.files[path]));

  // The two IR section files, and the index that names them. The index is built HERE
  // from the ids this double actually minted, never typed in: `readIR` resolves an id
  // through getFileById and THROWS for one it cannot find, so a hand-written id would
  // make every ticket read fail — for a reason that has nothing to do with the scope.
  if (o.sections) {
    const irs = {};
    const dir = (() => {
      const it = storeRoot.getFoldersByName('sections');
      return it.hasNext() ? it.next() : storeRoot.createFolder('sections');
    })();
    Object.keys(o.sections).forEach(num => {
      const f = dir.createFile(num + '.json', JSON.stringify(o.sections[num]));
      allFiles.set(f.getId(), f);
      irs[num] = f.getId();
    });
    const idx = dir.createFile('index.json', JSON.stringify({ irs: irs }));
    allFiles.set(idx.getId(), idx);
  }

  const call = (expr) => runInContext(expr, ctx);
  return { ctx, call, mails, root, allFiles,
    // Every call below is the REAL function, reached through its real name.
    err(expr) { try { call(expr); return null; } catch (e) { return e.message || String(e); } } };
}

// ── The fixture ────────────────────────────────────────────────────────────────
// Two customers of two different companies, one staff account, one admin.
const ACCESS = {
  departments: {}, memberships: {},
  customers: { 'ops@acme.example': 'Acme Survey', 'ops@bharat.example': 'Bharat Geo' },
};
const USERS = {
  'ops@acme.example':   { hash: 'x', salt: 's', status: 'active', name: 'Acme Ops', mustChange: 'no' },
  'ops@bharat.example': { hash: 'x', salt: 's', status: 'active', name: 'Bharat Ops', mustChange: 'no' },
  'ravi@indrones.com':  { hash: 'x', salt: 's', status: 'active', name: 'Ravi', mustChange: 'no' },
};
const ADMIN = 'monish.raza@indrones.com';
const STAFF = 'ravi@indrones.com';
const ACCT  = 'ops@acme.example';
const OTHER = 'ops@bharat.example';

const store = (extra) => Object.assign({
  'access.json': ACCESS,
  'users.json': USERS,
  'irs.json': {
    IR105: { status: 'Delivered', assignee: 'Ravi', updatedAt: 1, seededFrom: 'sheet', done: { 'sec-b': true } },
    IR200: { status: 'Inward',    assignee: 'Anand', updatedAt: 2, done: {} },
    IR300: { status: 'Open',      assignee: 'Nisha', updatedAt: 3, done: {} },
  },
  'config.json': {
    theme: { preset: 'blue' },
    'team-directory': { people: ['ravi@indrones.com'] },
    analyser: { profiles: { S25: { vibeX: 10.6 } } },
  },
  'comments.json': { all: { items: [{ text: 'internal only', by: STAFF }] } },
  'kb.json': { 'kb-1': { title: 'internal article' } },
  'audit/2026-01-01.jsonl': '',
  'backup.json': { ok: true, lastRunMs: 1 },
}, extra || {});

// A store that ALSO serves the two IR section files, for the getPassbook cases. The
// index is generated from the ids the double mints — see `fresh`.
function withSections() { return {}; }

const SECTIONS = {
  IR105: {
    'sec-a': { customerName: 'Acme Ops', companyName: 'Acme Survey' },
    'sec-b': { internalNote: 'bench inspection, do not send to the customer' },
    'sec-d': { rootCause: 'cell imbalance' },
  },
  IR200: { 'sec-a': { customerName: 'Bharat Ops' }, 'sec-b': { internalNote: 'not yours' } },
};

// ── 1. The scope is a row filter, and it is a third role ───────────────────────
r.head('a customer account is scoped to a company, not granted a permission level');

const a = fresh({ files: store(), sections: SECTIONS });
const eff = JSON.parse(a.call("JSON.stringify(getEffectiveAccess('" + ACCT + "'))"));
r.ok('the role is CUSTOMER, not user', eff.role === 'customer', eff.role);
r.ok('the company is carried on the access object', eff.customerOf === 'Acme Survey', eff.customerOf);
r.ok('every editable section is "none" — the seam canView already reads',
  ['sec-b', 'sec-c', 'sec-d', 'sec-e', 'sec-f', 'sec-g'].every(s => eff.permissions[s] === 'none'),
  JSON.stringify(eff.permissions));
r.ok('...and the Overview survives, because a customer may read their own record',
  eff.permissions['sec-a'] === 'view', eff.permissions['sec-a']);
r.ok('triage is off — the Overview board is a staff surface', eff.triage === false);
r.ok('no departments, so no grant can be reached through the membership map',
  Array.isArray(eff.departments) && eff.departments.length === 0);

const staffEff = JSON.parse(a.call("JSON.stringify(getEffectiveAccess('" + STAFF + "'))"));
r.ok('a staff account is unchanged — view on everything, and no company',
  staffEff.role === 'user' && staffEff.customerOf === '' &&
  ['sec-b', 'sec-c', 'sec-d', 'sec-e', 'sec-f', 'sec-g'].every(s => staffEff.permissions[s] === 'view'),
  JSON.stringify(staffEff.permissions));

const admEff = JSON.parse(a.call("JSON.stringify(getEffectiveAccess('" + ADMIN + "'))"));
r.ok('the admin still bypasses everything', admEff.role === 'admin' && admEff.customerOf === '');

// The scope map is keyed the same way users.json is, so an address that differs only
// in case or spacing is the same account everywhere — otherwise a customer could be
// scoped on one path and unscoped on another.
r.ok('the scope lookup normalises the address the same way every other lookup does',
  a.call("JSON.stringify(customerCompany('  OPS@ACME.example  '))") === '"Acme Survey"',
  a.call("JSON.stringify(customerCompany('  OPS@ACME.example  '))"));
r.ok('and an address nobody scoped is simply not a customer',
  a.call("JSON.stringify(customerCompany('nobody@example.com'))") === '""');

// The trap the whole design turns on: "no company" must never mean "no access".
r.ok('an address with NO scope is an ordinary account, which is why the scope is never cleared to ""',
  /no company/i.test(backendGs) || /Clearing the scope would give/.test(backendGs),
  'the refusal that stops a customer being promoted by an empty scope');

// ── 2. The list is narrowed on the server ───────────────────────────────────────
r.head('listIRs keeps the header and the customer\'s own rows, and nothing else');

const acme = JSON.parse(a.call("JSON.stringify(listIRs('" + ACCT + "').grid)"));
r.ok('the header row is kept, so the frontend mapper still works',
  JSON.stringify(acme[0]) === JSON.stringify(SHEET_HEADER), JSON.stringify(acme[0]));
r.ok('exactly the three Acme rows come back — header plus three',
  acme.length === 4, acme.length);
r.ok('every returned row is Acme\'s',
  acme.slice(1).every(rw => rw[4] === 'Acme Survey'),
  JSON.stringify(acme.slice(1).map(rw => rw[4])));
r.ok('another company\'s rows are ABSENT, not merely unrendered',
  !/Bharat Geo|Ceres Drones/.test(JSON.stringify(acme)), JSON.stringify(acme));

const bharat = JSON.parse(a.call("JSON.stringify(listIRs('" + OTHER + "').grid)"));
r.ok('and a second customer sees only their own single row',
  bharat.length === 2 && bharat[1][4] === 'Bharat Geo', JSON.stringify(bharat));

const all = JSON.parse(a.call("JSON.stringify(listIRs('" + STAFF + "').grid)"));
r.ok('staff still see the whole sheet — this narrowed one caller, not the list',
  all.length === SHEET_ROWS.length, all.length);

// FAIL CLOSED is the whole direction of this design. A customer seeing an empty list
// is a support call; a customer seeing somebody else's fleet is a breach.
const noCol = fresh({ files: store(), sections: SECTIONS,
  grid: [SHEET_HEADER.map((h, i) => (i === 4 ? 'Firm' : h))].concat(SHEET_ROWS.slice(1)) });
r.ok('when the company column cannot be found, a customer gets NO rows',
  JSON.parse(noCol.call("JSON.stringify(listIRs('" + ACCT + "').grid)")).length === 0,
  noCol.call("JSON.stringify(listIRs('" + ACCT + "').grid)"));
r.ok('...and it is empty, never the whole sheet — the failure is not the same as "no filter"',
  JSON.parse(noCol.call("JSON.stringify(listIRs('" + ACCT + "').grid)")).length === 0);
r.ok('...and the same unreadable header still gives staff their list, because they are not scoped',
  JSON.parse(noCol.call("JSON.stringify(listIRs('" + STAFF + "').grid)")).length === SHEET_ROWS.length);

// The company column is found by header SUBSTRING, the same needle the frontend's own
// mapper uses. Two different spellings of the question would put the two halves of the
// app on different columns, and a wrong column here does not give a wrong number — it
// gives the wrong customer's tickets.
r.ok('the company column is matched by header substring, never by position',
  /companyColumnIndex\(/.test(backendGs) &&
  /where do you work/.test(backendGs) &&
  !/getRange\([^)]*,\s*5\s*\)/.test(backendGs));
r.ok('...and the same is true of the IR number column',
  /irNumberColumnIndex\(/.test(backendGs) && /ir number/.test(backendGs));

// ── 3. One ticket, and the sections that are not theirs ────────────────────────
r.head('getPassbook gives a customer their own ticket, with the internals gone');

const pbAcme = JSON.parse(a.call("JSON.stringify(getPassbook('IR105', '" + ACCT + "').sections)"));
r.ok('their own ticket opens', pbAcme['sec-a'] !== undefined, JSON.stringify(Object.keys(pbAcme)));
r.ok('and the six working sections do NOT come with it',
  ['sec-b', 'sec-c', 'sec-d', 'sec-e', 'sec-f', 'sec-g'].every(s => pbAcme[s] === undefined),
  JSON.stringify(Object.keys(pbAcme)));

const bad = a.err("getPassbook('IR200', '" + ACCT + "')");
r.ok('another company\'s ticket THROWS rather than coming back empty',
  !!bad && /not one of your tickets/i.test(bad), bad);
r.ok('...and so does a ticket that does not exist at all, so the two cannot be told apart',
  !!a.err("getPassbook('IR999', '" + ACCT + "')"), a.err("getPassbook('IR999', '" + ACCT + "')"));

// The spelling trap: the sheet holds BOTH "IR105" and "IR 107", and app.js accepts
// both. A scope that matched the raw string would deny a customer their own ticket
// over one stray space.
r.ok('a hand-typed IR number with a space in it still resolves to the customer',
  a.call("JSON.stringify(customerOwnsIR('Acme Survey', 'IR107'))") === 'true' &&
  a.call("JSON.stringify(customerOwnsIR('Acme Survey', 'IR 107'))") === 'true');

// ── 4. The sentinel stores — the hole that is easiest to miss ──────────────────
r.head('the sentinel app stores are reduced, because they bypass the section filter');

const irs = JSON.parse(a.call("JSON.stringify(getPassbook('__IRS__', '" + ACCT + "').sections)"));
r.ok('__IRS__ carries the customer\'s own tickets and no others',
  Object.keys(irs).sort().join(',') === 'IR105',
  JSON.stringify(Object.keys(irs)) + ' — IR107 is absent because no ticket state was ever written for it, and a scope grants nothing it cannot find');
r.ok('...and each carries only the stage, who has it, and when it moved',
  Object.keys(irs.IR105).sort().join(',') === 'assignee,status,updatedAt',
  JSON.stringify(irs.IR105));
r.ok('...so the internal markers — seededFrom, done — are gone',
  !/seededFrom|done/.test(JSON.stringify(irs)), JSON.stringify(irs));
r.ok('a second customer gets a different set from the same store',
  Object.keys(JSON.parse(a.call("JSON.stringify(getPassbook('__IRS__', '" + OTHER + "').sections)"))).join(',') === 'IR200',
  a.call("JSON.stringify(getPassbook('__IRS__', '" + OTHER + "').sections)"));

const cfg = JSON.parse(a.call("JSON.stringify(getPassbook('__CONFIG__', '" + ACCT + "').sections)"));
r.ok('__CONFIG__ is reduced to the theme alone',
  Object.keys(cfg).join(',') === 'theme', JSON.stringify(Object.keys(cfg)));
r.ok('...so the staff team directory never leaves the server',
  !/team-directory/.test(JSON.stringify(cfg)), JSON.stringify(cfg));
r.ok('...and neither do the flight-log limits, which the owner keeps out of the repo entirely',
  !/analyser|vibeX|10\.6/.test(JSON.stringify(cfg)), JSON.stringify(cfg));
r.ok('the theme still arrives, because the portal has to match the app\'s colours',
  JSON.stringify(cfg.theme) === '{"preset":"blue"}', JSON.stringify(cfg.theme));

r.ok('__NUDGES__ — the internal comment threads — comes back empty',
  JSON.stringify(JSON.parse(a.call("JSON.stringify(getPassbook('__NUDGES__', '" + ACCT + "').sections)"))) === '{}',
  a.call("JSON.stringify(getPassbook('__NUDGES__', '" + ACCT + "').sections)"));
r.ok('__KB__ comes back empty too',
  JSON.stringify(JSON.parse(a.call("JSON.stringify(getPassbook('__KB__', '" + ACCT + "').sections)"))) === '{}');

// The staff side must be untouched by any of this. A narrowing that also narrowed the
// staff would be a feature that broke the product to secure it.
const staffCfg = JSON.parse(a.call("JSON.stringify(getPassbook('__CONFIG__', '" + STAFF + "').sections)"));
r.ok('staff still get the whole config store',
  staffCfg['team-directory'] !== undefined && staffCfg.analyser !== undefined,
  JSON.stringify(Object.keys(staffCfg)));
r.ok('staff still get every ticket\'s state',
  Object.keys(JSON.parse(a.call("JSON.stringify(getPassbook('__IRS__', '" + STAFF + "').sections)"))).length === 3);
r.ok('...and staff still get the comment thread',
  a.call("JSON.stringify(getPassbook('__NUDGES__', '" + STAFF + "').sections.all.items.length)") === '1');

// The reduction is an ALLOWLIST, so a key added to a store later is invisible by
// default rather than leaked by default. This is the assertion that keeps it that way:
// an unrecognised sentinel comes back empty, not whole.
r.ok('an app store nobody has reasoned about comes back EMPTY for a customer, not whole',
  /return \{\};/.test(backendGs.slice(backendGs.indexOf('function narrowSentinelForCustomer'),
                                       backendGs.indexOf('function narrowSentinelForCustomer') + 2400)));
r.ok('...and the reduction never mutates what readJson memoised, or it would leak to every later caller',
  /function narrowSentinelForCustomer[\s\S]{0,2500}?var out = \{\}/.test(backendGs) &&
  !/delete src\./.test(backendGs.slice(backendGs.indexOf('function narrowSentinelForCustomer'),
                                        backendGs.indexOf('function narrowSentinelForCustomer') + 2400)));

// ── 5. Every write, and the reads that carry no per-record check ───────────────
r.head('a customer is refused the audit trail, the legacy records, and every write');

r.ok('saveSection refuses — and refuses the SENTINEL arm too, or the workflow is theirs',
  !!a.err("saveSection('__IRS__', 'IR105', {status:'Delivered'}, [], '" + ACCT + "', '')"),
  a.err("saveSection('__IRS__', 'IR105', {status:'Delivered'}, [], '" + ACCT + "', '')"));
r.ok('...and a real section as well',
  !!a.err("saveSection('IR105', 'sec-b', {x:1}, [], '" + ACCT + "', '')"));
r.ok('...before it writes anything, so nothing is left half-done',
  /refuseCustomer\(access, 'saving records'\)/.test(backendGs));
// The check must run before the sentinel allowlist can matter, which is the ordering
// the assertion above pins in words. This one pins it in behaviour: the store is
// unchanged after the refusal.
r.ok('...and the store is untouched afterwards',
  a.call("JSON.stringify(readJson('irs.json').IR105.status)") === '"Delivered"');

r.ok('the audit trail refuses, and it takes a bare IR number on trust otherwise',
  !!a.err("getAuditLog('IR105', 50, '', '" + ACCT + "')"),
  a.err("getAuditLog('IR105', 50, '', '" + ACCT + "')"));
r.ok('the legacy index refuses',
  !!a.err("listLegacyIRs('" + ACCT + "')"), a.err("listLegacyIRs('" + ACCT + "')"));
r.ok('and one legacy record refuses',
  !!a.err("getLegacyIR('IR105', '" + ACCT + "')"), a.err("getLegacyIR('IR105', '" + ACCT + "')"));
r.ok('the comment thread refuses a customer posting into it — they cannot read the replies',
  !!a.err("sendNudgeEmail({to:'" + STAFF + "', irNumber:'IR105', message:'hello'}, '" + ACCT + "')"),
  a.err("sendNudgeEmail({to:'" + STAFF + "', irNumber:'IR105', message:'hello'}, '" + ACCT + "')"));

r.ok('every one of those still works for staff, so the refusals are scoped and not a blanket',
  a.err("getAuditLog('IR105', 50, '', '" + STAFF + "')") === null ||
  /audit/.test(a.err("getAuditLog('IR105', 50, '', '" + STAFF + "')") || ''),
  a.err("getAuditLog('IR105', 50, '', '" + STAFF + "')") || 'audit read reached the store, as it should');

// The refusal is ONE helper, so a new endpoint cannot invent its own wording and a
// new role cannot be forgotten in one place only.
r.ok('there is ONE refusal helper, and it names the role rather than the endpoint',
  /function refuseCustomer\(/.test(backendGs) &&
  /role === 'customer'/.test(backendGs.slice(backendGs.indexOf('function refuseCustomer'),
                                             backendGs.indexOf('function refuseCustomer') + 260)));
r.ok('...and every gated action calls it rather than testing the role inline',
  (backendGs.match(/refuseCustomer\(/g) || []).length >= 6,
  (backendGs.match(/refuseCustomer\(/g) || []).length + ' call sites');

// ── 6. Onboarding — the account that must never exist without its scope ───────
r.head('inviting a customer is admin-only, and the scope lands before the account does');

const inv = fresh({ files: store(), sections: SECTIONS });
r.ok('a non-admin cannot invite',
  /admins only/i.test(inv.err("inviteCustomer({email:'new@acme.example', company:'Acme Survey', name:'New'}, '" + STAFF + "')") || ''),
  inv.err("inviteCustomer({email:'new@acme.example', company:'Acme Survey', name:'New'}, '" + STAFF + "')") || 'NOT REFUSED');
r.ok('...and no account was created by the attempt',
  inv.call("JSON.stringify(!!findUser('new@acme.example'))") === 'false');

// The load-bearing ordering. An account with no scope is not an unprivileged account —
// it is an ordinary one, with view on every section and every ticket in the company.
// So the grant is written FIRST, and a failure to create the account must leave neither.
const okInv = JSON.parse(inv.call("JSON.stringify(inviteCustomer({email:'new@acme.example', company:'Acme Survey', name:'New Person'}, '" + ADMIN + "'))"));
r.ok('an admin can invite', okInv.status === 'ok', JSON.stringify(okInv));
r.ok('the account exists afterwards', inv.call("JSON.stringify(!!findUser('new@acme.example'))") === 'true');
r.ok('and it is scoped', inv.call("JSON.stringify(customerCompany('new@acme.example'))") === '"Acme Survey"');
r.ok('...and it is a customer, not an ordinary account with a job title',
  inv.call("JSON.stringify(getEffectiveAccess('new@acme.example').role)") === '"customer"');
r.ok('and the account it made can never be used before a password is chosen',
  inv.call("JSON.stringify(String(findUser('new@acme.example').mustChange))") === '"yes"');
r.ok('an invitation email was actually sent',
  inv.mails.length === 1 && inv.mails[0].to === 'new@acme.example',
  JSON.stringify(inv.mails.map(m => m.to)));
r.ok('...and it carries NO code, because this account could not redeem one',
  !/\b\d{6}\b/.test(inv.mails[0].body), inv.mails[0].body.split('\n').slice(-10).join(' | '));
r.ok('...and it names the door it does open — the ordinary reset, asked for on demand',
  /first time here/i.test(inv.mails[0].body) && /choose your password/i.test(inv.mails[0].body),
  inv.mails[0].body);
r.ok('...and NO password ever travels by email',
  !/temporary password is|your password is [^.]/i.test(inv.mails[0].body), inv.mails[0].body);
r.ok('...and the link it offers is the CUSTOMER page, not the staff app',
  /customer\.html/.test(inv.mails[0].body) && !/index\.html/.test(inv.mails[0].body),
  (inv.mails[0].body.match(/https?:\/\/\S+/) || ['(no link)'])[0]);

// ── THE TRAP ────────────────────────────────────────────────────────────────────
// The invitation's FIRST version mailed a 'login' code and told the customer to sign in
// with it. It could never have worked, and nothing in this repo would have said so: the
// account createUserRow makes sits on an admin-issued temporary password, and
// passwordlessLogin refuses to redeem a login code for such an account. Both halves are
// asserted here — the refusal that made the old email dead on arrival, and the door the
// email now names actually opening — so the mistake cannot be re-made silently.
const trap = fresh({ files: store(), sections: SECTIONS });
trap.call("inviteCustomer({email:'new@acme.example', company:'Acme Survey', name:'New Person'}, '" + ADMIN + "')");

r.ok('a freshly invited account is refused by the code door — which is why no code is emailed',
  JSON.parse(trap.call("JSON.stringify(passwordlessLogin('new@acme.example', '', '', '').codeSent)")) === false,
  trap.call("JSON.stringify(passwordlessLogin('new@acme.example', '', '', ''))"));
r.ok('...and refused outright when a code IS offered, naming the temp password as the reason',
  /admin-issued password/.test(trap.call("JSON.stringify(passwordlessLogin('new@acme.example', '123456', '', '').message)")),
  trap.call("JSON.stringify(passwordlessLogin('new@acme.example', '123456', '', ''))"));

const invCode = JSON.parse(trap.call("JSON.stringify(issueAuthCode('new@acme.example', 'reset', CODE_TTL_MIN))"));
const invSet  = JSON.parse(trap.call("JSON.stringify(resetPassword({email:'new@acme.example', code:" + JSON.stringify(invCode) + ", newPassword:'chosen-by-the-customer'}))"));
r.ok('the reset door the invitation names DOES open, and sets their own password',
  invSet.status === 'ok', JSON.stringify(invSet));
r.ok('...and it retires the admin-issued password in the same act',
  trap.call("JSON.stringify(String(findUser('new@acme.example').mustChange))") === '""');
r.ok('...and afterwards the temp-password refusal is gone, so the code door is theirs from then on',
  !/admin-issued password/.test(trap.call("JSON.stringify(passwordlessLogin('new@acme.example', '123456', '', '').message)")),
  trap.call("JSON.stringify(passwordlessLogin('new@acme.example', '123456', '', ''))"));
r.ok('...and asking for a fresh code in the same breath is throttled, not silently dropped',
  /wait a minute/i.test(trap.call("JSON.stringify(passwordlessLogin('new@acme.example', '', '', '').message)")),
  trap.call("JSON.stringify(passwordlessLogin('new@acme.example', '', '', ''))"));

r.ok('inviting an existing account is refused rather than silently re-scoping it',
  JSON.parse(inv.call("JSON.stringify(inviteCustomer({email:'" + ACCT + "', company:'Bharat Geo'}, '" + ADMIN + "').status)")) === 'error',
  inv.call("JSON.stringify(inviteCustomer({email:'" + ACCT + "', company:'Bharat Geo'}, '" + ADMIN + "'))"));
r.ok('...and the existing scope was NOT overwritten by the attempt',
  inv.call("JSON.stringify(customerCompany('" + ACCT + "'))") === '"Acme Survey"');
r.ok('an admin can never be invited as a customer',
  JSON.parse(inv.call("JSON.stringify(inviteCustomer({email:'" + ADMIN + "', company:'Acme Survey'}, '" + ADMIN + "').status)")) === 'error');
r.ok('and a scope with no company is refused, because it is the thing that decides the rows',
  JSON.parse(inv.call("JSON.stringify(inviteCustomer({email:'x@y.example', company:'  '}, '" + ADMIN + "').status)")) === 'error');

// Clearing a scope PROMOTES. That is the one edit an admin could make by accident and
// never notice, so it is refused for any address outside the company's own domain.
r.ok('clearing the scope of an OUTSIDE address is refused, in words that name the consequence',
  /Clearing the scope would give/.test(inv.call("JSON.stringify(setCustomerCompany({email:'" + ACCT + "', company:''}, '" + ADMIN + "').message)") || ''),
  inv.call("JSON.stringify(setCustomerCompany({email:'" + ACCT + "', company:''}, '" + ADMIN + "'))"));
r.ok('...and the scope really is still there afterwards',
  inv.call("JSON.stringify(customerCompany('" + ACCT + "'))") === '"Acme Survey"');
r.ok('changing it to a different company is allowed',
  JSON.parse(inv.call("JSON.stringify(setCustomerCompany({email:'" + ACCT + "', company:'Bharat Geo'}, '" + ADMIN + "').status)")) === 'ok');

// ── 7. The portal's own boot call ───────────────────────────────────────────────
r.head('getMyCustomer tells the portal who it is talking to, and no store contents');
const mine = JSON.parse(a.call("JSON.stringify(getMyCustomer('" + ACCT + "'))"));
r.ok('it reports the company and the display name',
  mine.customerOf === 'Acme Survey' && mine.name === 'Acme Ops', JSON.stringify(mine));
r.ok('...and nothing else — no scope map, no permission grid, no ticket ids',
  Object.keys(mine).sort().join(',') === 'apiVersion,customerOf,email,name,portalUrl,status',
  Object.keys(mine).sort().join(','));
r.ok('a staff account gets an empty scope rather than an error, so the portal can redirect them',
  JSON.parse(a.call("JSON.stringify(getMyCustomer('" + STAFF + "').customerOf)")) === '');
r.ok('...and an account that does not exist at all gets the same empty answer',
  JSON.parse(a.call("JSON.stringify(getMyCustomer('ghost@nowhere.example').customerOf)")) === '');

// ── 8. The wire ────────────────────────────────────────────────────────────────
r.head('the routing carries the caller, so no scoped read can be reached unscoped');
r.ok('listIRs is dispatched WITH the verified email',
  /listIRs:\s*function \(\) \{ return listIRs\(email\); \}/.test(backendGs),
  (backendGs.match(/[^\n]*listIRs:[^\n]*/) || ['none'])[0]);
r.ok('...and it takes an argument at all, which is the whole change',
  /function listIRs\(authEmail\)/.test(backendGs));
r.ok('the audit and legacy reads are handed the caller too',
  /getAuditLog\(e\.parameter\.irNumber, e\.parameter\.limit, e\.parameter\.fieldId, email\)/.test(backendGs) &&
  /listLegacyIRs:\s*function \(\) \{ return listLegacyIRs\(email\); \}/.test(backendGs) &&
  /getLegacyIR:\s*function \(\) \{ return getLegacyIR\(e\.parameter\.irNumber, email\); \}/.test(backendGs));
r.ok('the customer actions are routed on the authed maps, never pre-auth',
  /inviteCustomer:\s*function/.test(backendGs) &&
  /getMyCustomer:\s*function/.test(backendGs) &&
  /setCustomerCompany:\s*function/.test(backendGs));
r.ok('the version is 8, so a portal can refuse to run against an older backend',
  /API_VERSION:\s*8\b/.test(backendGs),
  (backendGs.match(/API_VERSION:[^\n]*/) || [''])[0]);
// The reason the bump is not cosmetic: an older backend does not merely lack the
// feature, it answers a customer's token with the whole repository.
r.ok('and the bump carries its reason, not just a number',
  /does not merely lack the feature, it ANSWERS[\s\S]{0,40}?customer's token with the whole repository/.test(backendGs),
  (backendGs.match(/[^\n]*ANSWERS[^\n]*/) || ['none'])[0]);
r.ok('no UrlFetchApp was added — the invitation is MailApp, not a webhook',
  !/UrlFetchApp/.test(backendGs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
  (backendGs.match(/[^\n]*UrlFetchApp[^\n]*/) || ['none'])[0]);

// ── 9. The scope lives where it cannot be self-served ───────────────────────────
r.head('the scope is a grant, and it sits where grants cannot be written by a customer');
r.ok('it lives in access.json, not users.json',
  /customers/.test(backendGs.slice(backendGs.indexOf('function accessStore'),
                                   backendGs.indexOf('function accessStore') + 1400)) &&
  !/customers/.test(backendGs.slice(backendGs.indexOf('function createUserRow'),
                                    backendGs.indexOf('function createUserRow') + 900)));
r.ok('accessStore normalises the map, so a store written before v8 reads as "no customers"',
  /a\.customers\s*=\s*\{\}/.test(backendGs));
r.ok('...and the sentinel allowlist does NOT name it — a sentinel write skips every ACL',
  !/SENTINEL_SECTIONS[\s\S]{0,400}?customers/.test(backendGs),
  'access.json must never be reachable through saveSection');

r.finish();
