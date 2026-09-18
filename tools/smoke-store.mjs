// Mock-platform integration test for the Drive-JSON store.
//
//   node tools/smoke-store.mjs
//
// Every other backend suite is a REGEX over `backend.gs`. Those can only prove the
// source is SHAPED a certain way — never that it behaves. Three real defects have
// already shipped through 444 passing regex cases, one of them under a heading that
// claimed the opposite.
//
// So this file loads the WHOLE of `backend.gs` into a vm with a fake Apps Script
// platform underneath it — Drive folders and files that are just strings in a Map, a
// lock that records when it was taken — and calls the real functions. Production code,
// unmodified; only the platform is fake.
//
// What it exists for, specifically. The store moved from sheet ROWS to whole Drive
// FILES, and that changes the failure mode completely: a sheet write is one row, but a
// store write is read-whole-file → merge → write-whole-file, so a merge onto a stale
// read silently DROPS the other writer's save. That is a data-loss bug regexes cannot
// see, and it is the reason every write path takes the lock. The assertions below pin
// both halves: that a merge keeps its siblings, and that the read really is inside the
// lock rather than only the write.

import fs from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { makeReporter } from './harness.mjs';

const r = makeReporter();

// ── A fake Apps Script platform ───────────────────────────────────────────────
// Everything Google provides, reduced to what the store code paths actually call. The
// event log is the point: it lets a test assert the ORDER of platform calls (was the
// file read inside the lock? did the audit write land after the data write?) rather
// than inferring it from the source text.
const events = [];
const mails = [];   // every MailApp.sendEmail the backend makes, in order

class FakeFile {
  constructor(id, name, folder) {
    this.id = id; this.name = name; this.folder = folder;
    this.content = ''; this.sharing = null;
    this.updated = ++FakeFolder.seq;   // monotonically increasing, so "newest wins" is testable
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getLastUpdated() { return new Date(2026, 0, 1, 0, 0, this.updated); }
  getUrl() { return 'https://drive.google.com/file/d/' + this.id; }
  setSharing(access, perm) { this.sharing = access + '/' + perm; }
  getBlob() {
    // An unreadable file is a REAL Drive condition, and readJson must throw on it
    // rather than answer "empty". Modelled as a throw, not as '' — '' is the empty
    // file, which is a different (also-refused) case.
    if (this.blobThrows) throw new Error('the file could not be read');
    return { getDataAsString: () => this.content };
  }
  setContent(text) {
    events.push('write:' + this.name);
    this.content = String(text);
    return this;
  }
}

class FakeFolder {
  constructor(id, name) {
    this.id = id; this.name = name; this.folders = []; this.files = [];
    // Parentage is tracked because the archive feature moves folders between the
    // root and `Archive IRs/`, and "where is this folder NOW" is the only honest
    // way to answer whether it is archived — a stored flag would be a second
    // source of truth. Set on create AND on move, below.
    this.parent = null;
  }

  getName() { return this.name; }
  getId() { return this.id; }
  setSharing(access, perm) { this.sharing = access + '/' + perm; }

  getFoldersByName(name) {
    const hits = this.folders.filter(f => f.getName() === name);
    return iter(hits);
  }
  createFolder(name) {
    const f = new FakeFolder(this.id + '/' + name, name);
    f.parent = this;
    this.folders.push(f);
    return f;
  }
  getParents() { return iter(this.parent ? [this.parent] : []); }
  // Child LISTING, consistent unlike a search. The archive sweep uses this to read
  // `Archive IRs/` in one call rather than searching for ~450 tickets one by one.
  getFolders() { return iter(this.folders.slice()); }
  // A move, not a copy. The id survives, which is exactly why archiving a ticket
  // does not break the file links already stored in its passbook.
  //
  // The lock state is captured INTO the event string, so one assertion can prove
  // Drive work did not happen inside the script lock — the same trick `search:` and
  // `write:` use for the store files.
  moveTo(target) {
    events.push('move:' + this.name + '->' + target.getName() + ':lock=' + lockState.held);
    if (this.parent) this.parent.folders = this.parent.folders.filter(f => f !== this);
    this.parent = target;
    target.folders.push(this);
    return this;
  }
  getFilesByName(name) {
    events.push('search:' + name);
    // Drive's search is eventually consistent. The window is modelled here, and it is
    // exactly what sections/index.json exists to avoid: a file created a moment ago
    // is not yet findable by name.
    const hits = this.files.filter(f => f.getName() === name && !f.invisibleToSearch);
    return iter(hits);
  }
  createFile(name, content, mime) {
    // The real API takes EITHER (name, content, mime) or a single Blob, and the
    // upload path uses the Blob form — `sectionFolder.createFile(blob)`. Without this
    // the fake names every uploaded file "[object Object]", which reads as a passing
    // test until someone asserts on a file's name.
    if (name && typeof name === 'object' && name.name) {
      mime = name.mime; content = name.data; name = name.name;
    }
    const f = new FakeFile('file-' + (++FakeFolder.seq), name, this);
    f.content = String(content == null ? '' : content);
    f.mime = mime;
    this.files.push(f);
    events.push('create:' + name);
    return f;
  }
  getFiles() {
    // Child LISTING, unlike a search, is consistent — the assumption readIR relies on
    // when it falls back to a name lookup. Returns every file in the folder.
    return iter(this.files.slice());
  }
}

FakeFolder.seq = 0;

function iter(list) {
  let i = 0;
  return { hasNext: () => i < list.length, next: () => list[i++] };
}

const ROOT = new FakeFolder('root-id', 'I-PASSBOOK');
const allFiles = new Map();     // id -> FakeFile, for DriveApp.getFileById

const DriveAppFake = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
  Permission: { VIEW: 'VIEW', NONE: 'NONE' },
  // The real folder id is read from CONFIG rather than hardcoded, so a test that
  // passes cannot be passing against an id the code no longer uses.
  getFolderById(id) {
    if (id !== ctx.CONFIG.DRIVE_ROOT_FOLDER_ID) throw new Error('no such folder: ' + id);
    return ROOT;
  },
  // A DIRECT fetch, unlike a search. An id that is not in the map is a file that was
  // trashed or moved — the case readIR refuses rather than silently starting over.
  getFileById(id) {
    const f = allFiles.get(id);
    if (!f) throw new Error('no such file: ' + id);
    return f;
  },
  createFile(name, content, mime) { return ROOT.createFile(name, content, mime); },
};

// Register every file created anywhere, so getFileById can find it.
const realCreateFile = FakeFolder.prototype.createFile;
FakeFolder.prototype.createFile = function (name, content, mime) {
  const f = realCreateFile.call(this, name, content, mime);
  allFiles.set(f.getId(), f);
  return f;
};

// The lock. `held` is what makes the exclusivity claim testable: waitLock REFUSES
// while a lock is already out, so a nested write is provably rejected rather than
// allowed to interleave — and the event order proves the read sits inside it.
const lockState = { held: false, acquired: 0 };
const lockEvents = [];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function istParts(d) {
  const out = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).forEach(p => { if (p.type !== 'literal') out[p.type] = p.value; });
  return out;
}

const ctx = {
  console,
  DriveApp: DriveAppFake,
  MimeType: { PLAIN_TEXT: 'text/plain' },
  Utilities: {
    getUuid: () => 'uuid-' + (++FakeFolder.seq),
    base64Decode: s => s,
    newBlob: (data, mime, name) => ({ data, mime, name }),
    computeDigest: (alg, s) => {
      // Deterministic and non-cryptographic. The suites never assert a real hash —
      // only that two different (salt, password) pairs give different values.
      let h = 0;
      const str = String(s);
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
      return [h & 255, (h >> 8) & 255, (h >> 16) & 255, (h >> 24) & 255];
    },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    formatDate(d, tz, fmt) {
      if (tz !== 'Asia/Kolkata') throw new Error('unmocked timezone: ' + tz);
      const p = istParts(d);
      if (fmt === 'yyyy-MM-dd') return p.year + '-' + p.month + '-' + p.day;
      if (fmt === 'yyyy-MM-dd-HHmmss') {
        return p.year + '-' + p.month + '-' + p.day + '-' + p.hour + p.minute + p.second;
      }
      if (fmt === 'dd-MMM-yyyy HH:mm:ss') {
        return p.day + '-' + MONTHS[Number(p.month) - 1] + '-' + p.year +
               ' ' + p.hour + ':' + p.minute + ':' + p.second;
      }
      throw new Error('unmocked date format: ' + fmt);
    },
  },
  LockService: {
    getScriptLock: () => ({
      waitLock(ms) {
        lockEvents.push('waitLock:' + ms);
        // A real waitLock BLOCKS, then THROWS when it times out. Refusing with a
        // return value would prove nothing: withRowLock only treats a throw as
        // "could not get the lock", so a `return false` would let the nested write
        // proceed and the exclusivity assertion below would pass while proving
        // nothing at all.
        if (lockState.held) throw new Error('Could not acquire lock.');
        lockState.held = true; lockState.acquired++;
        return true;
      },
      releaseLock() { lockEvents.push('releaseLock'); lockState.held = false; },
    }),
  },
  // Present so a stray reference elsewhere in the file cannot throw at load time.
  SpreadsheetApp: { openById: () => { throw new Error('no sheet in this suite'); } },
  // Mail is RECORDED, not thrown. sendAuthMail swallows a throw and answers false,
  // so a throwing MailApp cannot distinguish "we sent a code" from "we did not" —
  // and the OTP flow's whole contract is which of those happened. PropertiesService
  // backs mailQuotaOk's daily counter and must exist or every send throws before
  // it ever reaches MailApp.
  MailApp: { sendEmail: (to, subject, body) => { mails.push({ to, subject, body }); } },
  PropertiesService: {
    getScriptProperties: () => ({
      _p: Object.create(null),
      getProperty(k) { return k in this._p ? this._p[k] : null; },
      setProperty(k, v) { this._p[k] = String(v); },
      deleteProperty(k) { delete this._p[k]; },
    }),
  },
  // `getEffectiveUser` is what the archive sweep records as the actor on an audit
  // line. It is the account a trigger runs as, which is why the sweep reads it
  // rather than taking a caller-supplied name.
  Session: {
    getActiveUser: () => ({ getEmail: () => '' }),
    getEffectiveUser: () => ({ getEmail: () => 'monish.raza@indrones.com' }),
    getScriptTimeZone: () => 'Asia/Kolkata',
  },
  Logger: { log() {} },
  ContentService: { createTextOutput: () => ({ setMimeType: () => ({}) }), MimeType: { JSON: 'json' } },
};

// Load the REAL file. No host built-ins are passed: `instanceof Array` is false across
// realms and the backend uses it, so the context must own its intrinsics.
const src = fs.readFileSync(new URL('../backend.gs', import.meta.url), 'utf8');
createContext(ctx);
try {
  runInContext(src, ctx, { filename: 'backend.gs' });
} catch (e) {
  console.log('  FAIL  backend.gs evaluates under a mocked Apps Script platform → ' + e.message);
  process.exit(1);
}

r.ok('the whole backend loads with only the Apps Script API faked',
  typeof ctx.saveSection === 'function' && typeof ctx.getPassbook === 'function' &&
  typeof ctx.initializeStore === 'function');
r.ok('it loaded the real source, not a copy',
  /readJsonLocked/.test(src) && /_store/.test(src), src.length);
r.ok('and it touches Drive, not a spreadsheet, for the store',
  /DriveApp\.getFolderById/.test(src) && !/SpreadsheetApp[\s\S]{0,200}APP_DATA/.test(src));

// ── Set up a real store ───────────────────────────────────────────────────────
r.head('initializeStore creates _store/ and refuses to share it');
ctx.initializeStore();

const store = ROOT.getFoldersByName('_store').next();
r.ok('_store/ exists inside the root folder', !!store);
r.ok('THE STORE IS NOT LINK-SHARED — it holds password hashes and session tokens',
  store.sharing === 'PRIVATE/NONE', store.sharing);
r.ok('it has the three subfolders',
  ['sections', 'audit', 'backups'].every(n => store.getFoldersByName(n).hasNext()),
  store.folders.map(f => f.getName()));

// A store read straight off Drive, ignoring the per-execution memo. The memo is a
// performance device; a test that read through it could pass while the FILE is wrong.
const fresh = path => {
  const i = path.indexOf('/');
  const folder = i < 0 ? store : store.getFoldersByName(path.substring(0, i)).next();
  const name = i < 0 ? path : path.substring(i + 1);
  const it = folder.getFilesByName(name);
  return it.hasNext() ? JSON.parse(it.next().content) : null;
};

r.ok('sections/index.json exists', fresh('sections/index.json') !== null);

const storeFile = name => store.getFilesByName(name).next();
const sectionFile = ir => store.getFoldersByName('sections').next().getFilesByName(ir + '.json').next();
const auditFile = sub => store.getFoldersByName('audit').next().getFilesByName(sub + '.jsonl').next();

// The admin, because this suite is about HOW THINGS ARE STORED and an admin bypasses
// the per-section ACL. The access model has its own suite (smoke-access.mjs) and its
// own assertions against the same access.json built below.
const ADMIN = 'monish.raza@indrones.com';

// Seed the real access matrix too, so the new access.json writer is exercised rather
// than assumed, and so a later save-as-a-department-user would be meaningful.
ctx.seedDepartments();
ctx.seedMemberships();
r.ok('seedDepartments wrote access.json as department records, not rows',
  (function () { const a = fresh('access.json');
    return a.departments.qc && a.departments.qc.grants['sec-b'] === true &&
           a.departments.cr.triage === true && a.departments.cr.grants['sec-b'] !== true; })(),
  fresh('access.json').departments);
r.ok('seedMemberships wrote one LIST per person, not an edge table',
  (function () { const m = fresh('access.json').memberships;
    return Array.isArray(m['angad.kumbhar@indrones.com']) &&
           m['angad.kumbhar@indrones.com'].indexOf('qc') > -1 &&
           m['angad.kumbhar@indrones.com'].indexOf('flight-test') > -1; })(),
  fresh('access.json').memberships);
r.ok('a department user gets edit on a granted section through the new store',
  ctx.getEffectiveAccess('angad.kumbhar@indrones.com').permissions['sec-b'] === 'edit',
  ctx.getEffectiveAccess('angad.kumbhar@indrones.com').permissions);

// ── 1. Two sections on one IR, in two separate executions ─────────────────────
r.head('a section save writes ONE key of the ticket file, and a second save keeps the first');

// Separate executions = separate store memos. Without this the second save would read
// its own memo and the merge would be untested.
const reexec = () => { ctx._storeMemo = {}; ctx._rootFolderMemo = null; ctx._storeFolderMemo = null; };

ctx.saveSection('IR409', 'sec-b', { b_remarks: 'inward ok', b_qty: '3' }, [], ADMIN);
reexec();
ctx.saveSection('IR409', 'sec-f', { f_qcResult: 'Pass' }, [], ADMIN);

const ir409 = fresh('sections/IR409.json');
r.ok('the second save did NOT replace the ticket file', !!ir409 && !!ir409['sec-b'] && !!ir409['sec-f'],
  ir409);
r.ok('the first section survived intact', ir409['sec-b'].b_remarks === 'inward ok', ir409['sec-b']);
r.ok('and the second section landed', ir409['sec-f'].f_qcResult === 'Pass', ir409['sec-f']);

// ── 2. A __IRS__ patch replaces ONE ticket, not the workflow state of all of them ──
r.head('a __IRS__ patch writes one key of irs.json, leaving every other ticket intact');

ctx.saveSection('__IRS__', 'IR409', { status: 'Production', done: ['sec-b'] }, [], ADMIN);
reexec();
ctx.saveSection('__IRS__', 'IR410', { status: 'Closed' }, [], ADMIN);
reexec();
ctx.saveSection('__IRS__', 'IR409', { status: 'Dispatch', done: ['sec-b', 'sec-f'] }, [], ADMIN);

const irs = fresh('irs.json');
r.ok('IR409 holds its LATEST state', irs.IR409.status === 'Dispatch', irs.IR409);
r.ok('IR409 kept its done list from the newer patch', irs.IR409.done.length === 2, irs.IR409.done);
r.ok('IR410 IS STILL THERE — a whole-file write would have destroyed it', irs.IR410.status === 'Closed',
  Object.keys(irs));

// ── 3. One config key leaves its siblings alone ───────────────────────────────
r.head('an iqc-config save leaves team-directory and inward-options intact');

ctx.saveSection('__CONFIG__', 'team-directory', { entries: [{ name: 'Angad', email: 'angad.kumbhar@indrones.com' }] }, [], ADMIN);
reexec();
ctx.saveSection('__CONFIG__', 'inward-options', { options: { qty: ['1', '2'] } }, [], ADMIN);
reexec();
ctx.saveSection('__CONFIG__', 'iqc-config', { zones: ['North'], resultOptions: ['Pass', 'Fail'] }, [], ADMIN);

const conf = fresh('config.json');
r.ok('the team directory survived', conf['team-directory'].entries.length === 1, Object.keys(conf));
r.ok('the inward options survived', conf['inward-options'].options.qty.length === 2, conf['inward-options']);
r.ok('the iqc config landed', conf['iqc-config'].zones[0] === 'North', conf['iqc-config']);

// ── 4. Comments round-trip through the shape the frontend reads ────────────────
r.head('comments.json still round-trips as sections[\'all\'].items');

const items = [{ author: 'angad.kumbhar@indrones.com', text: 'looking into it', createdAt: '10-Aug-2026 10:00:00' }];
ctx.saveSection('__NUDGES__', 'all', { items: items }, [], 'angad.kumbhar@indrones.com');
reexec();

const pb = ctx.getPassbook('__NUDGES__', 'angad.kumbhar@indrones.com');
r.ok('getPassbook answers the sentinel key the frontend asks for',
  pb.status === 'ok' && !!pb.sections['all'], pb.sections);
r.ok('and the items array came back whole', pb.sections['all'].items.length === 1, pb.sections['all']);
r.ok('a second comment APPENDS to the array rather than replacing the key',
  (function () {
    ctx.saveSection('__NUDGES__', 'all', { items: items.concat([{ author: 'b@indrones.com', text: 'fixed' }]) }, [], 'b@indrones.com');
    reexec();
    return ctx.getPassbook('__NUDGES__', 'angad.kumbhar@indrones.com').sections['all'].items.length === 2;
  })());

// ── 5. readJson refuses to turn a broken file into an empty one ───────────────
r.head('readJson throws on a corrupt or unreadable file, and answers null only for a truly absent one');

ctx._storeMemo = {};
const users = storeFile('users.json');
const usersBefore = users.content;
users.content = '{ this is not json';
let threw = null;
try { ctx.readJson('users.json'); } catch (e) { threw = e.message; }
r.ok('CORRUPT JSON THROWS — it does not answer {} and quietly empty the store',
  !!threw && /not valid JSON/.test(threw), threw);

users.content = '';
threw = null;
try { ctx.readJson('users.json'); } catch (e) { threw = e.message; }
r.ok('AN EMPTY FILE THROWS too — "no content" is not "no users"',
  !!threw && /is empty/.test(threw), threw);

users.content = usersBefore;
users.blobThrows = true;
ctx._storeMemo = {};
threw = null;
try { ctx.readJson('users.json'); } catch (e) { threw = e.message; }
r.ok('AN UNREADABLE FILE THROWS — it is not treated as absent',
  !!threw && /could not be read/.test(threw), threw);
users.blobThrows = false;
users.content = usersBefore;      // restored, so the later suites start from a real store

ctx._storeMemo = {};
r.ok('a file that genuinely does not exist answers null, and only null',
  ctx.readJson('nothing-here.json') === null, ctx.readJson('nothing-here.json'));
r.ok('and the file was left exactly as the test found it — nothing was "repaired"',
  users.content === usersBefore, users.content);

// ── 6. The lock: the READ is inside it, and a second writer is refused ────────
r.head('the read sits INSIDE the lock — a read-then-merge onto a stale snapshot is the data-loss bug');

ctx._storeMemo = {};
events.length = 0; lockEvents.length = 0;
ctx.saveSection('IR500', 'sec-c', { c_notes: 'first' }, [], ADMIN);

const lockAt   = lockEvents.indexOf('waitLock:20000');
const releaseAt = lockEvents.lastIndexOf('releaseLock');
const firstRead = events.findIndex(e => /^search:|^read:/.test(e));
const firstWrite = events.findIndex(e => /^write:/.test(e));
const lastWrite  = events.map(e => /^write:/.test(e)).lastIndexOf(true);

r.ok('the lock is taken at all', lockAt === 0, lockEvents);
r.ok('THE READ HAPPENS AFTER THE LOCK IS TAKEN — not before it',
  firstRead >= 0 && firstWrite > firstRead, { firstRead, firstWrite, events });
r.ok('the last write also happens before the lock is released',
  lastWrite < events.length && releaseAt >= 0 && lockAt < releaseAt, { lastWrite, releaseAt });
r.ok('and the lock is released exactly once, in a finally',
  lockEvents.filter(e => e === 'releaseLock').length === 1, lockEvents);

// A second writer while the lock is out. The real Apps Script lock would BLOCK, then
// throw on timeout; here it throws immediately, which is the same refusal.
r.head('a second save while the lock is held is REFUSED, not merged over the first');
lockState.held = true;
let refused = null;
try { ctx.saveSection('IR500', 'sec-d', { d_rootCause: 'racing' }, [], ADMIN); }
catch (e) { refused = e.message; }
lockState.held = false;
r.ok('the racing save THROWS rather than reporting success it did not achieve',
  !!refused && /busy|NOT saved/i.test(refused), refused);
r.ok('and it wrote nothing — sec-d is not in the file',
  !fresh('sections/IR500.json')['sec-d'], Object.keys(fresh('sections/IR500.json')));
r.ok('the first save is still there, undamaged',
  fresh('sections/IR500.json')['sec-c'].c_notes === 'first', fresh('sections/IR500.json'));

// ── 7. The audit is per-IR, and written AFTER the data ────────────────────────
r.head('the audit is written per ticket, AFTER the data write');

ctx._storeMemo = {};
events.length = 0;
ctx.saveSection('IR600', 'sec-b', { b_remarks: 'first' }, [], ADMIN);
reexec();
events.length = 0;
ctx.saveSection('IR600', 'sec-b', { b_remarks: 'changed' }, [], ADMIN);

const dataIdx  = events.findIndex(e => e === 'write:IR600.json');
const auditIdx = events.findIndex(e => e === 'write:IR600.jsonl');
r.ok('the ticket file is written BEFORE the audit file', dataIdx >= 0 && auditIdx > dataIdx,
  { dataIdx, auditIdx, events });
r.ok('the audit landed in the TICKET\'s own file, per-IR', !!auditFile('IR600'));

const lines = auditFile('IR600').content.trim().split('\n').map(l => JSON.parse(l));
r.ok('the old value and the new value are both recorded',
  lines.some(l => l.fid === 'b_remarks' && l.old === 'first' && l.nw === 'changed'),
  lines.filter(l => l.fid === 'b_remarks'));
r.ok('the timestamp is the display string the timeline prints verbatim, not ISO',
  /^\d{1,2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2}$/.test(lines[0].t), lines[0].t);

// A __IRS__ patch is ABOUT the ticket, so it belongs in the ticket's file.
ctx.saveSection('__IRS__', 'IR600', { status: 'Dispatch' }, [], ADMIN);
reexec();
const afterPatch = auditFile('IR600').content.trim().split('\n').map(l => JSON.parse(l));
r.ok('a __IRS__ patch is recorded in the TICKET\'s audit file, not in a store-named one',
  afterPatch.some(l => l.fid === 'status' && l.nw === 'Dispatch'), afterPatch.filter(l => l.fid === 'status'));
r.ok('and getAuditLog reads it back as a WORKFLOW entry for that ticket',
  (function () {
    const log = ctx.getAuditLog('IR600', 50);
    // `added`, not `changed`: this is the first status IR600 ever had. The event name
    // is not the point — what is asserted is that the entry is attributed to the
    // TICKET and marked as WORKFLOW, which is what the timeline filters on.
    const e = log.entries.filter(x => x.fieldId === 'status' && x.newValue === 'Dispatch');
    return e.length && e[0].source === 'workflow' && e[0].irNumber === 'IR600' && e[0].sectionId === '';
  })(), ctx.getAuditLog('IR600', 50).entries.slice(-3));
r.ok('a DIFFERENT ticket\'s audit file knows nothing about IR600',
  !store.getFoldersByName('audit').next().getFilesByName('IR601.jsonl').hasNext() ||
  !/IR600/.test(auditFile('IR601').content), 'IR601.jsonl');

// ── 8. getPassbook reads the ticket back through the index ────────────────────
r.head('getPassbook reads a real ticket back through sections/index.json');

ctx._storeMemo = {};
const pb2 = ctx.getPassbook('IR409', ADMIN);
r.ok('both sections came back', !!pb2.sections['sec-b'] && !!pb2.sections['sec-f'], pb2.sections);
r.ok('an IR that was never saved answers empty, not an error',
  ctx.getPassbook('IR999', ADMIN).sections.sec_b === undefined &&
  Object.keys(ctx.getPassbook('IR999', ADMIN).sections).length === 0);

// The index is what keeps a search's eventual consistency from forking the store.
r.ok('sections/index.json holds IR409 → its file id',
  fresh('sections/index.json').irs.IR409 === sectionFile('IR409').getId(),
  fresh('sections/index.json').irs);

// A search that misses must not write a SECOND file for the same IR. This is the
// failure the index exists for, and it is worth being precise about WHICH lookup it
// threatens: a name search is eventually consistent, so it can miss a file that was
// created a moment ago — including on the WRITE path, where the miss means
// createFile() and a silent fork of the ticket.
r.head('a name lookup that misses does not fork the ticket into a second file');
const sectionFolder = store.getFoldersByName('sections').next();
// While the blind spot is on, EVERY name lookup misses it — including this test's own
// `fresh()`/`sectionFile()` helpers, which search by name just like production does. So
// the file has to be read by identity out of the folder's child list instead: that is
// the direct fetch (`getFileById`) the index makes, and the only honest way to look at
// a file that a search cannot see.
const byIdentity = name => sectionFolder.files.find(f => f.getName() === name);
byIdentity('IR409.json').invisibleToSearch = true; // simulate the inconsistent search
ctx._storeMemo = {};
ctx.saveSection('IR409', 'sec-g', { g_pdi: 'packed' }, [], ADMIN);
r.ok('NO SECOND IR409.json WAS CREATED — the write went to the file the index names',
  sectionFolder.files.filter(f => f.getName() === 'IR409.json').length === 1,
  sectionFolder.files.map(f => f.getName()));
const ir409Merged = JSON.parse(byIdentity('IR409.json').content);
r.ok('and the new section merged into that file, keeping the older sections',
  ir409Merged['sec-g'].g_pdi === 'packed' && !!ir409Merged['sec-b'], Object.keys(ir409Merged));
r.ok('and it is the very file the index names — not a lookalike beside it',
  fresh('sections/index.json').irs.IR409 === byIdentity('IR409.json').getId(),
  fresh('sections/index.json').irs);
byIdentity('IR409.json').invisibleToSearch = false;

// The self-healing fallback: an index that has LOST an entry must recover from the
// name lookup rather than start a new file. Forced by clearing the entry by hand.
r.head('an index that lost its entry recovers from the name lookup, newest file wins');
(function () {
  const idxFile = sectionFolder.getFilesByName('index.json').next();
  const idx = JSON.parse(idxFile.content);
  delete idx.irs.IR409;
  idxFile.content = JSON.stringify(idx);
})();
ctx._storeMemo = {};
const recovered = ctx.getPassbook('IR409', ADMIN);
r.ok('the ticket was found by name and read back whole',
  Object.keys(recovered.sections).length === 3, Object.keys(recovered.sections));
r.ok('and its index entry was rewritten, so the next read is a direct id fetch',
  fresh('sections/index.json').irs.IR409 === sectionFile('IR409').getId(),
  fresh('sections/index.json').irs);

// ── 9. An IR number cannot escape its folder ──────────────────────────────────
r.head('a real-IR save asserts the IR shape before touching Drive');
let bad = null;
try { ctx.saveSection('../../etc', 'sec-b', { x: 1 }, [], ADMIN); }
catch (e) { bad = e.message; }
r.ok('A PATH-SHAPED IR NUMBER IS REFUSED', !!bad && /Invalid IR number/.test(bad), bad);
bad = null;
try { ctx.saveSection('__EVIL__', 'x', { y: 1 }, [], ADMIN); }
catch (e) { bad = e.message; }
r.ok('an unknown sentinel store is refused by the allowlist', !!bad && /Unknown app store/.test(bad), bad);

// ── 10. purgeUsers snapshots before it destroys ──────────────────────────────
r.head('purgeUsers writes a backup file BEFORE the destructive write, and honours dryRun');

ctx._storeMemo = {};
ctx.createUserRow('doomed@indrones.com', 'Doomed', ADMIN);
ctx.createUserRow('kept@indrones.com', 'Kept', ADMIN);

const plan = ctx.purgeUsers({ confirm: 'PURGE', dryRun: '1' }, ADMIN);
r.ok('dryRun reports the accounts it would remove and removes nothing',
  plan.status === 'ok' && plan.dryRun === true && plan.count === 2, plan);
r.ok('and the accounts are still there', !!fresh('users.json')['doomed@indrones.com'], Object.keys(fresh('users.json')));

events.length = 0;
const done = ctx.purgeUsers({ confirm: 'PURGE', expect: String(plan.count) }, ADMIN);
const backupIdx = events.findIndex(e => /^create:purge-users-/.test(e));
const usersWriteIdx = events.findIndex(e => e === 'write:users.json');
r.ok('THE BACKUP IS CREATED BEFORE users.json IS REWRITTEN',
  backupIdx >= 0 && usersWriteIdx > backupIdx, { backupIdx, usersWriteIdx, events });
r.ok('the accounts are gone', !fresh('users.json')['doomed@indrones.com'], Object.keys(fresh('users.json')));
r.ok('the backup file holds the pre-purge store as content, not just a name',
  /doomed@indrones\.com/.test(store.getFoldersByName('backups').next().files[0].content),
  store.getFoldersByName('backups').next().files.map(f => f.getName()));

// The two-phase contract: an irreversible delete removes what was SEEN, or nothing.
const stale = ctx.purgeUsers({ confirm: 'PURGE', expect: '99' }, ADMIN);
r.ok('a stale expect count refuses the delete rather than applying it',
  stale.status === 'error' && /changed while you were reviewing/.test(stale.message), stale);

// ── 11. sessionCheck fails OPEN when the store is unreadable ─────────────────
r.head('a store error must not look like a dead token — sessionCheck fails open');

// A REAL, valid token first, so the only thing wrong when the probe runs is the store.
ctx._storeMemo = {};
const liveToken = ctx.mintSession('angad.kumbhar@indrones.com');
r.ok('the fresh token is valid while the store is healthy',
  ctx.sessionCheck({ parameter: { sessionToken: liveToken } }).alive === true,
  ctx.sessionCheck({ parameter: { sessionToken: liveToken } }));

const sessFile = storeFile('sessions.json');
const goodSessions = sessFile.content;
sessFile.content = 'not json at all';
ctx._storeMemo = {};
let probe = null;
try { probe = ctx.sessionCheck({ parameter: { sessionToken: liveToken } }); }
catch (e) { probe = { threw: e.message }; }
r.ok('it answers status ok / alive true instead of throwing',
  probe && probe.status === 'ok' && probe.alive === true, probe);
r.ok('AND THE MESSAGE DOES NOT START WITH "unauthorized" — the frontend auto-logs-out on that',
  probe && !/^unauthorized/i.test(String(probe.message || '')), probe && probe.message);
r.ok('which is what stops one bad file from ejecting every signed-in user at once',
  probe && /unreadable/i.test(String(probe.message || '')), probe && probe.message);

sessFile.content = goodSessions;
ctx._storeMemo = {};
r.ok('the token still works once the store is readable again',
  ctx.sessionCheck({ parameter: { sessionToken: liveToken } }).alive === true);

// ── 12. Uploads still work, and only the FILE is link-shared ─────────────────
r.head('an upload lands in the IR section folder, and only the FILE is link-shared');
ctx._storeMemo = {};
ctx.saveSection('IR700', 'sec-b', { b_remarks: 'with a file' },
  [{ fieldId: 'b_docs', name: 'checklist.pdf', mimeType: 'application/pdf', base64: 'AAA' }],
  ADMIN);
const irFolder = ROOT.getFoldersByName('IR700').next();
r.ok('the IR folder was created in the root, NOT inside _store',
  ROOT.folders.map(f => f.getName()).indexOf('IR700') > -1, ROOT.folders.map(f => f.getName()));
const uploaded = irFolder.getFoldersByName('Section B - Inward Checklist').next().files[0];
r.ok('the uploaded file is anyone-with-link, so its link keeps working',
  uploaded.sharing === 'ANYONE_WITH_LINK/VIEW', uploaded.sharing);
r.ok('and the link was merged back into the section as a *_links key',
  /b_docs_links/.test(Object.keys(fresh('sections/IR700.json')['sec-b']).join(' ')),
  Object.keys(fresh('sections/IR700.json')['sec-b']));
r.ok('the audit records the upload as its own event',
  auditFile('IR700').content.trim().split('\n').map(l => JSON.parse(l))
    .some(l => l.ev === 'uploaded' && l.nw === 'checklist.pdf'),
  auditFile('IR700').content);

// The owner's report, reproduced. On two Android phones the photo showed a
// thumbnail before saving and was gone after a reload, with no error anywhere:
// Android's picker hands Chrome `File.type === ''` for a plain JPEG, and the
// upload loop used to `return` on a falsy mimeType. The name is the source of
// truth now, so the file must land — and land TYPED, because a Drive file stored
// as octet-stream is one that will not preview.
const sectionFolderOf = ir => ROOT.getFoldersByName(ir).next()
  .getFoldersByName('Section B - Inward Checklist').next();

ctx.saveSection('IR701', 'sec-b', { b_remarks: 'from an Android camera' },
  [{ fieldId: 'b_docs', name: 'IMG_20260919.jpg', mimeType: '', base64: 'AAA' }], ADMIN);
const phoneFile = sectionFolderOf('IR701').files[0];
r.ok('a phone upload with NO MIME type lands instead of vanishing',
  !!phoneFile && phoneFile.getName() === 'IMG_20260919.jpg',
  sectionFolderOf('IR701').files.map(f => f.getName()));
r.ok('and it lands typed image/jpeg, not octet-stream — Drive has to preview it',
  !!phoneFile && phoneFile.mime === 'image/jpeg', phoneFile && phoneFile.mime);
r.ok('so its link still reaches the section',
  /b_docs_links/.test(Object.keys(fresh('sections/IR701.json')['sec-b']).join(' ')),
  Object.keys(fresh('sections/IR701.json')['sec-b']));

// A generic type from the picker must lose to a recognised extension: that is the
// difference between a file that previews in the app and one that downloads.
ctx.saveSection('IR702', 'sec-b', {},
  [{ fieldId: 'b_docs', name: 'photo.HEIC', mimeType: 'application/octet-stream', base64: 'AAA' }], ADMIN);
const heicFile = sectionFolderOf('IR702').files[0];
r.ok('a generic octet-stream declaration loses to the extension',
  !!heicFile && heicFile.mime === 'image/heic', heicFile && heicFile.mime);

// A file that arrives with no contents is a broken upload, not a reason to drop
// one quietly. Loud beats silent — the client keeps the entries as a draft.
let brokenUpload = null;
try {
  ctx.saveSection('IR703', 'sec-b', { b_remarks: 'should not persist' },
    [{ fieldId: 'b_docs', name: 'empty.jpg', mimeType: '', base64: '' }], ADMIN);
} catch (e) { brokenUpload = e.message; }
r.ok('a file with no contents THROWS instead of being skipped in silence',
  !!brokenUpload && /without its name or contents/.test(brokenUpload), brokenUpload);
r.ok('and it says what to do about it, rather than just failing',
  !!brokenUpload && /Re-select/.test(brokenUpload), brokenUpload);
r.ok('nothing was written: the throw happens before the locked store write',
  !fresh('sections/IR703.json'),
  fresh('sections/IR703.json') && Object.keys(fresh('sections/IR703.json')));

// App stores must not carry uploads at all — that was the last sentinel hole.
let sentinelUpload = null;
try {
  ctx.saveSection('__CONFIG__', 'iqc-config', { zones: [] },
    [{ fieldId: 'x', name: 'a.txt', mimeType: 'text/plain', base64: 'AA' }], 'angad.kumbhar@indrones.com');
} catch (e) { sentinelUpload = e.message; }
r.ok('an app store carrying a file upload is refused', !!sentinelUpload && /cannot carry file uploads/.test(sentinelUpload),
  sentinelUpload);

// ── The emailed sign-in code ──────────────────────────────────────────────────
// Sign-in is TWO steps now: the password, then a 6-digit code mailed to the
// address. The code is deliberately REUSABLE for a whole working day (8h30m), so
// someone signing in on a phone and then a desktop types it once. These run the
// real doLoginPassword against the real Drive-fake, because "one code covers the
// day" is a claim about stored state, not about source text.
r.head('sign-in is two steps: the password, then a code that lasts the working day');

const OTPPW = 'correct-horse-battery';
const OTPUSER = 'otp.one@indrones.com', OTP2 = 'otp.two@indrones.com',
      OTP3 = 'otp.three@indrones.com';

// An ordinary, already-onboarded account: real hash, no forced change, enabled.
function mkUser(email) {
  ctx.createUserRow(email, email.split('@')[0], ADMIN);
  ctx.withRowLockOrThrow(function () {
    var users = ctx.readJsonLocked('users.json');
    users[email].hash   = ctx.hashPassword(OTPPW, 'salty');
    users[email].salt   = 'salty';
    users[email].mustChange = '';
    users[email].status = 'active';
    users[email].tempPwIssuedAt = null;
    ctx.writeJsonLocked('users.json', users);
  });
}
[OTPUSER, OTP2, OTP3].forEach(mkUser);

const codeEntries = () => (fresh('codes.json') || { entries: [] }).entries;
const liveLoginCode = email => codeEntries()
  .filter(e => e.email === email && e.purpose === 'login' && !e.used).pop() || null;
const setCodes = entries => ctx.withRowLockOrThrow(() => ctx.writeJsonLocked('codes.json', { entries }));

reexec(); mails.length = 0;
const step1 = ctx.doLoginPassword({ email: OTPUSER, password: OTPPW });
r.ok('step 1 accepts the password, asks for a code, and mints NO session',
  step1.status === 'ok' && step1.otpRequired === true && !step1.sessionToken, step1);
r.ok('it reports that a code WAS sent, since there was none to reuse',
  step1.codeSent === true, step1.message);

const first = liveLoginCode(OTPUSER);
r.ok('a login-purpose code is now in the store', !!first, codeEntries().length + ' entries');
r.ok('it is six digits', /^\d{6}$/.test(first.code), first.code);
r.ok('and it lives 8h30m — one working day, not the reset window',
  first.expiresAt - first.createdAt === 510 * 60 * 1000,
  (first.expiresAt - first.createdAt) / 60000 + ' min vs reset ' + 15);
r.ok('the code was EMAILED, and the mail carries it',
  mails.length === 1 && mails[0].to === OTPUSER && mails[0].body.indexOf(first.code) > -1,
  mails.map(m => m.to + ' / ' + m.subject));
r.ok('the mail gives a DURATION from the send, not "end of the working day"',
  /valid for 8:30 hours from now/.test(mails[0].body) &&
  !/end of the working day|every sign-in today/.test(mails[0].body), mails[0].body);

// A wrong code is refused, and says how much rope is left.
reexec();
const wrong = ctx.doLoginPassword({ email: OTPUSER, password: OTPPW, code: '000000' });
r.ok('a wrong code is refused and mints no session',
  wrong.status === 'error' && !wrong.sessionToken, wrong);
r.ok('and it counts the tries down', /attempt\(s\) left/.test(wrong.message), wrong.message);

// The right code mints a session — and survives its own use.
reexec();
const ok1 = ctx.doLoginPassword({ email: OTPUSER, password: OTPPW, code: first.code });
r.ok('the emailed code mints a session', ok1.status === 'ok' && !!ok1.sessionToken, ok1);
r.ok('the session runs 8h30m and does not slide',
  (function () { const t = fresh('sessions.json').tokens[ok1.sessionToken];
    return t.expiresAt - t.createdAt === 8.5 * 3600 * 1000 && !('lastSeenAt' in t); })(),
  fresh('sessions.json').tokens[ok1.sessionToken]);
r.ok('the code is NOT consumed by that sign-in — the whole point of the feature',
  (function () { const e = liveLoginCode(OTPUSER); return !!e && e.code === first.code && e.attempts === 1; })() ||
  (function () { const e = liveLoginCode(OTPUSER); return !!e && e.code === first.code; })(),
  liveLoginCode(OTPUSER));

// Second sign-in of the day: same code, no second email.
reexec(); mails.length = 0;
const step2 = ctx.doLoginPassword({ email: OTPUSER, password: OTPPW });
r.ok('signing in again asks for the code already in the inbox',
  step2.otpRequired === true && step2.codeSent === false, step2.message);
r.ok('and sends NO second mail', mails.length === 0, mails.length);
r.ok('it did not replace the live code with a newer one',
  liveLoginCode(OTPUSER).code === first.code, liveLoginCode(OTPUSER).code);
reexec();
const ok2 = ctx.doLoginPassword({ email: OTPUSER, password: OTPPW, code: first.code });
r.ok('the SAME code signs in a second device the same day',
  ok2.status === 'ok' && !!ok2.sessionToken && ok2.sessionToken !== ok1.sessionToken,
  ok2.status + ' ' + (ok2.sessionToken || ''));

// Expiry: a code past its window is not reused, a fresh one is issued.
// createdAt is backdated as well as expiresAt — the 60s resend gap is real
// wall-clock time and a test does not advance it, so without this the reissue
// would be refused by the throttle and this would be measuring the wrong thing.
ctx.withRowLockOrThrow(function () {
  const raw = ctx.readJsonLocked('codes.json');
  raw.entries.forEach(e => {
    if (e.email === OTPUSER && e.purpose === 'login') {
      e.createdAt = Date.now() - 2 * 3600 * 1000;
      e.expiresAt = Date.now() - 1000;
    }
  });
  ctx.writeJsonLocked('codes.json', raw);
});
reexec(); mails.length = 0;
const step3 = ctx.doLoginPassword({ email: OTPUSER, password: OTPPW });
r.ok('an expired code is not reused — a fresh one is issued and mailed',
  step3.otpRequired === true && step3.codeSent === true && mails.length === 1, step3.message);

// Five wrong guesses burn it, shared across the day because the entry is.
reexec();
let burn = null;
for (let i = 0; i < 5; i++) burn = ctx.doLoginPassword({ email: OTPUSER, password: OTPPW, code: '000000' });
r.ok('five wrong guesses burn the code', /Too many wrong codes/.test(burn.message), burn.message);
reexec();
const afterBurn = ctx.doLoginPassword({ email: OTPUSER, password: OTPPW, code: '000000' });
r.ok('and afterwards there is no active code to guess at',
  afterBurn.status === 'error' && /No sign-in code is active/.test(afterBurn.message), afterBurn.message);

// A wrong PASSWORD must still not send anything — the code gate is behind it.
reexec(); mails.length = 0;
const badPw = ctx.doLoginPassword({ email: OTPUSER, password: 'not-the-password' });
r.ok('a wrong password sends no code and asks for none',
  badPw.status === 'error' && badPw.otpRequired === undefined && mails.length === 0, badPw.message);

// ── purpose isolation: a sign-in code is not a reset code, or vice versa ──────
r.head('a sign-in code cannot reset a password, and a reset code cannot sign in');
reexec(); mails.length = 0;
ctx.forgotPassword({ email: OTP2 });
const resetCode = codeEntries().filter(e => e.email === OTP2 && e.purpose === 'reset' && !e.used).pop();
r.ok('forgotPassword issued a reset code through the shared issuer', !!resetCode,
  codeEntries().filter(e => e.email === OTP2).map(e => e.purpose).join(','));
r.ok('and it lives 15 minutes, not the sign-in window',
  resetCode.expiresAt - resetCode.createdAt === 15 * 60 * 1000,
  (resetCode.expiresAt - resetCode.createdAt) / 60000 + ' min');

reexec();
const crossReset = ctx.resetPassword({ email: OTP2, code: resetCode.code, newPassword: 'a-brand-new-one' });
r.ok('the reset code DOES reset, and returns no session',
  crossReset.status === 'ok' && !crossReset.sessionToken, crossReset);

// With the reset spent, ask for a sign-in code and try to use IT as a reset.
// The reset entry's createdAt is nudged back past the 60s resend gap first —
// otherwise the gap sees a code issued moments ago (of ANY purpose) and refuses
// the sign-in code, which is correct behaviour but not what this is measuring.
ctx.withRowLockOrThrow(function () {
  const raw = ctx.readJsonLocked('codes.json');
  raw.entries.forEach(e => { if (e.email === OTP2) e.createdAt = Date.now() - 120000; });
  ctx.writeJsonLocked('codes.json', raw);
});
// Sign in with the password the reset CHOSE, since that is now the real one.
const OTP2PW = 'a-brand-new-one';
reexec(); mails.length = 0;
const stepB = ctx.doLoginPassword({ email: OTP2, password: OTP2PW });
r.ok('the password the reset chose works, and now wants a code',
  stepB.status === 'ok' && stepB.otpRequired === true, stepB.message);
const login2 = liveLoginCode(OTP2);
r.ok('a sign-in code was mailed separately from the reset one',
  !!login2 && mails.length === 1, mails.length);

reexec();
const crossLogin = ctx.resetPassword({ email: OTP2, code: login2.code, newPassword: 'a-brand-new-two' });
r.ok('a SIGN-IN code cannot be redeemed as a password reset',
  crossLogin.status === 'error' && /No reset code is outstanding/.test(crossLogin.message),
  crossLogin.message);
r.ok('...and the failed attempt did not spend the sign-in code',
  (function () { const e = liveLoginCode(OTP2); return !!e && e.code === login2.code; })(),
  liveLoginCode(OTP2));
reexec();
const okB = ctx.doLoginPassword({ email: OTP2, password: OTP2PW, code: login2.code });
r.ok('which still signs in afterwards', okB.status === 'ok' && !!okB.sessionToken, okB.status);

// A reset code cannot be used to sign in either.
reexec();
const loginAsReset = ctx.doLoginPassword({ email: OTPUSER, password: OTPPW, code: resetCode.code });
r.ok('an old RESET code is not accepted as a sign-in code',
  loginAsReset.status === 'error', loginAsReset.message);

// ── the two hourly ceilings, which are deliberately different sizes ───────────
r.head('login codes get a looser hourly ceiling than reset codes — a password came first');
const now = Date.now();
const filler = (n, purpose) => Array.from({ length: n }, (_, i) => ({
  email: 'filler' + i + '@indrones.com', code: '111111', purpose,
  createdAt: now, expiresAt: now + 3600000, attempts: 0, used: false,
}));

setCodes(filler(12, 'reset'));
reexec();
ctx.forgotPassword({ email: OTP3 });
r.ok('12 reset codes across all addresses already spent the hour — a 13th is refused',
  codeEntries().length === 12, codeEntries().length);

// The sign-in ceiling is 120, precisely because a login code needs a correct
// password first. 12 sign-ins an hour would lock out a 15-person team on one
// morning, which is what the reset-sized ceiling would have done.
setCodes(filler(120, 'login'));
reexec(); mails.length = 0;
const capped = ctx.doLoginPassword({ email: OTP3, password: OTPPW });
r.ok('120 sign-in codes already spent the hour — the next one is refused',
  capped.status === 'error' && mails.length === 0, capped.message);
r.ok('and the refusal says so instead of pointing at an empty inbox',
  /wait a minute/.test(capped.message), capped.message);
r.ok('the reset ceiling was NOT raised with it',
  ctx.globalCodeCap('reset') === 12 && ctx.globalCodeCap('login') === 120,
  ctx.globalCodeCap('reset') + ' / ' + ctx.globalCodeCap('login'));

// Under the ceiling the very same call succeeds — so the test above measured the
// ceiling and not something else about OTP3.
setCodes(filler(119, 'login'));
reexec(); mails.length = 0;
const underCap = ctx.doLoginPassword({ email: OTP3, password: OTPPW });
r.ok('one under the ceiling, the same sign-in gets its code',
  underCap.status === 'ok' && underCap.codeSent === true && mails.length === 1,
  underCap.message + ' / mails=' + mails.length);

// ── the account-state gates still win over the code step ─────────────────────
r.head('the code step sits BEHIND every account-state gate');
ctx.withRowLockOrThrow(function () {
  var users = ctx.readJsonLocked('users.json');
  users[OTP3].status = 'disabled';
  ctx.writeJsonLocked('users.json', users);
});
reexec(); mails.length = 0;
const off = ctx.doLoginPassword({ email: OTP3, password: OTPPW });
r.ok('a disabled account is refused at the password, before any code is sent',
  off.status === 'error' && mails.length === 0 && off.otpRequired === undefined, off.message);

ctx.withRowLockOrThrow(function () {
  var users = ctx.readJsonLocked('users.json');
  users[OTP3].status = 'active';
  users[OTP3].mustChange = 'yes';
  ctx.writeJsonLocked('users.json', users);
});
reexec(); mails.length = 0;
const temp = ctx.doLoginPassword({ email: OTP3, password: OTPPW });
r.ok('a temp-password holder is sent to the forced change, NOT asked for a code',
  temp.status === 'ok' && temp.mustChangePassword === true && mails.length === 0, temp);

// ── ARCHIVING A CLOSED IR'S DRIVE FOLDER ──────────────────────────────────────
// The feature's whole risk lives in one place: `getOrCreateSectionFolder` finds the
// IR folder BY NAME, so a folder sitting in `Archive IRs/` must still be found — or
// the next upload silently creates a SECOND, empty `root/IR801` and one ticket's
// files end up split across two folders with no error anywhere. The first three
// assertions below are that hazard, stated as a regression test.
r.head('a closed IR folder moves to Archive IRs/, and uploads still land in it');

const ARCHIVE_NAME = ctx.CONFIG.ARCHIVE_FOLDER_NAME;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const seedIRs = rows => ctx.withRowLockOrThrow(() => ctx.writeJsonLocked('irs.json', rows));
const uploadTo = (ir, name) => ctx.saveSection(ir, 'sec-b', {},
  [{ base64: 'x', name: name, mimeType: 'image/png', fieldId: 'f_inwardDocs' }], ADMIN);
const archiveFolder = () => ROOT.getFoldersByName(ARCHIVE_NAME).hasNext()
  ? ROOT.getFoldersByName(ARCHIVE_NAME).next() : null;
const hasRoot = ir => ROOT.getFoldersByName(ir).hasNext();
const hasArchived = ir => { const a = archiveFolder(); return !!a && a.getFoldersByName(ir).hasNext(); };
const archivedFileNames = ir => {
  const sec = archiveFolder().getFoldersByName(ir).next()
    .getFoldersByName('Section B - Inward Checklist').next();
  return sec.files.map(f => f.getName());
};
// A status write through the SAME path the app uses — saveSection on the __IRS__
// sentinel — so the reopen hook is exercised rather than called directly.
const setStatus = (ir, status) => ctx.saveSection('__IRS__', ir,
  { status: status, statusOwned: true, statusAt: NOW, assignee: ADMIN }, [], ADMIN);

// IR801: a plain closed-and-aged ticket with one uploaded file.
uploadTo('IR801', 'first.png');
// Captured BEFORE the move, so the assertion below can prove the move kept the same
// folder object rather than copying it.
const ir801Before = ROOT.getFoldersByName('IR801').next();
r.ok('an upload creates root/IR801 and puts the file in its section folder',
  hasRoot('IR801') && ROOT.getFoldersByName('IR801').next()
    .getFoldersByName('Section B - Inward Checklist').next().files[0].getName() === 'first.png');

seedIRs({
  IR801: { status: 'Close',    statusOwned: true,  statusAt: NOW - 31 * DAY_MS },
  IR802: { status: 'Close',    statusOwned: true,  statusAt: NOW - 29 * DAY_MS },  // too recent
  IR803: { status: 'Close',    statusOwned: true                        },          // no statusAt
  IR804: { status: 'Close',    statusOwned: false, statusAt: NOW - 40 * DAY_MS },  // Col D only
  IR805: { status: 'Production', statusOwned: true, statusAt: NOW - 40 * DAY_MS }, // not closed
});

events.length = 0;
const sweep1 = ctx.archiveClosedIRs();
r.ok('the sweep is idempotent, reports in words, and goes through report()',
  /^Archive sweep — archived 1, restored 0/.test(sweep1), sweep1);
r.ok('a ticket closed 31 days ago moved to Archive IRs/',
  hasArchived('IR801') && !hasRoot('IR801'));
r.ok('31 days on, the ticket keeps its own folder name and its section subfolders',
  archivedFileNames('IR801').join(',') === 'first.png', archivedFileNames('IR801'));
r.ok('closed only 29 days ago — NOT moved, and the report says how many are waiting',
  !hasArchived('IR802') && /not yet 30 days old/.test(sweep1), sweep1);
r.ok('a Close with no usable statusAt is named, never archived on an invented date',
  !hasArchived('IR803') && /no usable close date/.test(sweep1), sweep1);
r.ok('a Close the APP does not own (Sheet Col D only) is left alone',
  !hasArchived('IR804'), sweep1);
r.ok('a ticket that is not closed is left alone', !hasArchived('IR805'));

// THE REGRESSION TEST. Everything above is setup for this one.
events.length = 0;
uploadTo('IR801', 'second.png');
r.ok('AN UPLOAD AFTER ARCHIVING LANDS BESIDE THE FIRST FILE, not in a new folder',
  archivedFileNames('IR801').join(',') === 'first.png,second.png',
  archivedFileNames('IR801'));
r.ok('and NOTHING was created at the root — this is the fork the resolver prevents',
  !hasRoot('IR801'));
r.ok('and it is the SAME folder object, moved rather than copied — so every stored ' +
     'file link still resolves',
  archiveFolder().getFoldersByName('IR801').next() === ir801Before);

// ── idempotency, the cap, and the report's other lines ────────────────────────
events.length = 0;
const sweep2 = ctx.archiveClosedIRs();
r.ok('a second sweep moves nothing at all',
  events.filter(e => e.indexOf('move:') === 0).length === 0, events);
r.ok('and says so rather than reporting a silent zero', /archived 0, restored 0/.test(sweep2), sweep2);

r.ok('the cap is small enough to watch land', ctx.ARCHIVE_MAX_PER_RUN === 10, ctx.ARCHIVE_MAX_PER_RUN);
r.ok('and the ageing rule is a month, not a week',
  ctx.ARCHIVE_AFTER_DAYS === 30, ctx.ARCHIVE_AFTER_DAYS);

// ── the reopen ────────────────────────────────────────────────────────────────
// The app's own path: a triage save that takes the ticket out of Close.
setStatus('IR801', 'Production');
r.ok('a status change out of Close brings the folder straight back to the root',
  hasRoot('IR801') && !hasArchived('IR801'));

// The same ticket put back, then reopened by hand in the store — no hook fires, so
// the sweep is the only thing that can notice, which is what it is for.
seedIRs({ IR806: { status: 'Close', statusOwned: true, statusAt: NOW - 31 * DAY_MS } });
uploadTo('IR806', 'x.png');
ctx.archiveClosedIRs();
r.ok('IR806 archived', hasArchived('IR806') && !hasRoot('IR806'));
ctx.withRowLockOrThrow(() => {
  const s = ctx.readJsonLocked('irs.json');
  s.IR806.status = 'Production';                 // hand-edited: no hook, no app involved
  ctx.writeJsonLocked('irs.json', s);
});
const sweep3 = ctx.archiveClosedIRs();
r.ok('the sweep restores a folder whose ticket is no longer closed, however it changed',
  hasRoot('IR806') && !hasArchived('IR806') && /Restored: IR806/.test(sweep3), sweep3);

// ── the audit trail ───────────────────────────────────────────────────────────
r.head('the archive is recorded on the ticket, not only in Drive');
const audit801 = ctx.getAuditLog('IR801').entries;
const archLine = audit801.filter(e => e.event === 'archived');
const restLine = audit801.filter(e => e.event === 'restored');
r.ok('IR801 carries an archived line and a restored line',
  archLine.length === 1 && restLine.length === 1,
  audit801.map(e => e.event).join(','));
r.ok('both are attributed to the ticket and route as workflow writes',
  archLine[0].irNumber === 'IR801' && archLine[0].source === 'workflow' &&
  restLine[0].irNumber === 'IR801', archLine[0]);
r.ok('the sweep records WHO ran it, from the session rather than a literal',
  archLine[0].savedBy === 'monish.raza@indrones.com', archLine[0].savedBy);
r.ok('an archived line names the destination', /Archive IRs/.test(archLine[0].newValue), archLine[0].newValue);
const audit802 = ctx.getAuditLog('IR802').entries;
r.ok('a ticket that was NOT moved has no archived line — the log never runs ahead',
  audit802.filter(e => e.event === 'archived').length === 0, audit802.length);

// ── the lock ──────────────────────────────────────────────────────────────────
// The fake records the lock state INTO each move event string, so this is a real
// check rather than a reading of the source: Drive work must never happen with the
// global script lock held.
const moveEvents = events.filter(e => e.indexOf('move:') === 0);
r.ok('moves were actually recorded, so the next assertion is not vacuous',
  moveEvents.length >= 2, moveEvents);
r.ok('EVERY folder move happened OUTSIDE the script lock',
  !/move:.*:lock=true/.test(events.join('|')), moveEvents);

// ── out of scope, enforced ────────────────────────────────────────────────────
r.ok('nothing in the backend erases anything — archiving MOVES and stops',
  !/setTrashed|removeFile\(|deleteFile\(/.test(src), 'grep over the real source');

r.finish();
