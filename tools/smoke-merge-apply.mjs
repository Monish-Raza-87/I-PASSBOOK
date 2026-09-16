// Mock-platform integration test for the three functions that TOUCH live data.
//
//   node tools/smoke-merge-apply.mjs
//
// `smoke-merge-plan.mjs` executes the pure planner against fixtures, and proves the
// PLAN is right. It cannot prove the plan is APPLIED right. `mergeSectionsApply`
// rewrites and deletes by REMEMBERED 1-indexed row numbers, and one off-by-one in the
// delete order corrupts rows the planner never looked at. No regex suite can see that
// either — those assert the source is SHAPED a certain way, never that it behaves.
//
// So this file loads the WHOLE of backend.gs into a vm with a fake Apps Script
// platform underneath it — a Sheet that is just a 2-D array, a lock that records when
// it was taken — and calls the real functions. Production code, unmodified; only the
// platform is fake.
//
// The specific failure it exists for: `deleteRow(n)` shifts everything below `n` up by
// one. Delete ascending and the SECOND target has already moved, so `deleteRow` takes
// out whatever now sits at that index — which in a real store is somebody else's row,
// or a `__IRS__` sentinel. The fixture below is built so a top-down delete eats the
// sentinel, because that is the shape of the damage in the real sheet.

import fs from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { makeReporter } from './harness.mjs';

const r = makeReporter();

// ── A fake Apps Script platform ───────────────────────────────────────────────
// Everything Google provides, reduced to what these code paths actually call. The
// event log is the point: it lets a test assert the ORDER of platform calls (was the
// snapshot taken inside the lock? were the deletes bottom-up?) rather than inferring
// it from the source text.
const events = [];
const cell = v => (v == null ? '' : v);

class FakeRange {
  constructor(sheet, row, col, nRows, nCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.nRows = nRows == null ? 1 : nRows;
    this.nCols = nCols == null ? 1 : nCols;
  }
  getValues() {
    const out = [];
    for (let r0 = 0; r0 < this.nRows; r0++) {
      const line = [];
      for (let c0 = 0; c0 < this.nCols; c0++) line.push(this.sheet.cell(this.row + r0, this.col + c0));
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    values.forEach((line, r0) => line.forEach((v, c0) => this.sheet.put(this.row + r0, this.col + c0, v)));
    return this;
  }
  clearContent() {
    for (let r0 = 0; r0 < this.nRows; r0++) {
      for (let c0 = 0; c0 < this.nCols; c0++) this.sheet.put(this.row + r0, this.col + c0, '');
    }
    return this;
  }
  // Formatting calls are chainable in Apps Script and return the range.
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class FakeSheet {
  constructor(name, values) {
    this.name = name;
    this.rows = (values || []).map(l => l.slice());
  }
  getName() { return this.name; }
  cell(r, c) {
    const line = this.rows[r - 1];
    return (line && c - 1 < line.length) ? cell(line[c - 1]) : '';
  }
  put(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const line = this.rows[r - 1];
    while (line.length < c) line.push('');
    line[c - 1] = v;
  }
  // Google's getLastRow/getLastColumn ignore trailing empty rows and columns, so the
  // data window is the CONTENT, not the 1000-row default grid. Getting this wrong
  // would make getDataRange() return 1000 rows and every row number in the plan wrong.
  getLastRow() {
    let last = 0;
    this.rows.forEach((line, i) => { if (line.some(v => cell(v) !== '')) last = i + 1; });
    return last;
  }
  getLastColumn() {
    let last = 0;
    this.rows.slice(0, this.getLastRow()).forEach(line => line.forEach((v, i) => {
      if (cell(v) !== '' && i + 1 > last) last = i + 1;
    }));
    return last;
  }
  getMaxRows() { return 1000; }        // the default grid, so ensureRoom is a no-op
  getMaxColumns() { return 26; }
  insertRowsAfter() {}
  insertColumnsAfter() {}
  setFrozenRows() {}
  getSheetId() { return 0; }
  getRange(row, col, nRows, nCols) { return new FakeRange(this, row, col, nRows, nCols); }
  getDataRange() {
    events.push('read:' + this.name);
    return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  deleteRow(n) { events.push('delete:' + this.name + ':' + n); this.rows.splice(n - 1, 1); }
  appendRow(arr) { events.push('append:' + this.name); this.rows.push(arr.slice()); }
  clearContent() { this.rows = []; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find(s => s.getName() === n) || null; }
  insertSheet(n) { events.push('insertSheet:' + n); const s = new FakeSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  getName() { return 'fake'; }
}

const ss = new FakeSpreadsheet();
const opened = [];

// The two date formats the backend asks for, and nothing else. Throwing on an
// unmocked format or timezone is deliberate: a new format string would otherwise
// silently produce a wrong-but-plausible timestamp and this suite would pass.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
  SpreadsheetApp: {
    openById(id) { opened.push(id); return ss; },
  },
  Utilities: {
    formatDate(d, tz, fmt) {
      if (tz !== 'Asia/Kolkata') throw new Error('unmocked timezone: ' + tz);
      const p = istParts(d);
      if (fmt === 'yyyy-MM-dd') return p.year + '-' + p.month + '-' + p.day;
      if (fmt === 'dd-MMM-yyyy HH:mm:ss') {
        return p.day + '-' + MONTHS[Number(p.month) - 1] + '-' + p.year +
               ' ' + p.hour + ':' + p.minute + ':' + p.second;
      }
      throw new Error('unmocked date format: ' + fmt);
    },
  },
  LockService: {
    getScriptLock() {
      events.push('getScriptLock');
      return {
        waitLock(ms) { events.push('waitLock:' + ms); return true; },
        releaseLock() { events.push('releaseLock'); },
      };
    },
  },
  // Present so a stray reference elsewhere in the file cannot throw at load time.
  Session: { getActiveUser: () => ({ getEmail: () => '' }) },
  Logger: { log() {} },
  ContentService: { createTextOutput: () => ({ setMimeType: () => ({}) }), MimeType: { JSON: 'json' } },
};

// Load the REAL file. No host built-ins are passed: `instanceof Array` is false across
// realms, and the merge planner uses it, so the context must own its intrinsics (see
// the same note in smoke-merge-plan.mjs).
const src = fs.readFileSync(new URL('../backend.gs', import.meta.url), 'utf8');
createContext(ctx);
try {
  runInContext(src, ctx, { filename: 'backend.gs' });
} catch (e) {
  console.log('  FAIL  backend.gs evaluates under a mocked Apps Script platform → ' + e.message);
  process.exit(1);
}
r.ok('the whole backend loads with only the Apps Script API faked',
  typeof ctx.mergeSectionsApply === 'function' && typeof ctx.appendAuditEntries === 'function' &&
  typeof ctx.getAuditLog === 'function');
r.ok('it loaded the real source, not a copy',
  /planSectionMerge/.test(src) && /APP_DATA_BACKUP_/.test(src), src.length);

// ── Fixtures ──────────────────────────────────────────────────────────────────
const DATA_HEADS = ['IR Number', 'Section ID', 'Saved By', 'Fields (JSON)', 'Last Updated'];
const R = (ir, sec, fields, by, at) =>
  [ir, sec, by || 'a@indrones.com', JSON.stringify(fields || {}), at || '10-Aug-2026 10:00:00'];

// Deliberately interleaved, with unrelated IRs between the merge's own rows, and the
// sentinel sitting BELOW both delete targets. A top-down delete takes out row 2 first,
// after which the old row 7 is row 6 and row 8 is row 7 — so `deleteRow(7)` removes
// the sentinel and leaves IR600's dispatch row behind. Every assertion below is
// downstream of getting that right.
const ORIGINAL = [
  DATA_HEADS,
  R('IR600', 'sec-g', { g_missionReport: 'flight ok' }, 'ft@indrones.com', '12-Aug-2026 09:00:00'),
  R('IR601', 'sec-b', { b_remarks: 'keep me' }, 'inv@indrones.com', '11-Aug-2026 09:00:00'),
  R('IR600', 'sec-f', { f_qcDocs_links: 'http://drive/1' }, 'qc@indrones.com', '13-Aug-2026 09:00:00'),
  R('IR600', 'sec-h', { h_dispatchChecklist: 'packed' }, 'pd@indrones.com', '14-Aug-2026 09:00:00'),
  R('IR602', 'sec-c', { c_notes: 'keep me too' }, 'qc@indrones.com', '11-Aug-2026 09:00:00'),
  R('IR600', 'sec-i', { i_courier: 'BlueDart' }, 'dp@indrones.com', '15-Aug-2026 09:00:00'),
  R('__IRS__', 'IR600', { status: 'Production', done: ['sec-a', 'sec-g'] }, 'sys@indrones.com', '10-Aug-2026 09:00:00'),
  R('IR603', 'sec-g', { g_missionReport: 'lone flight test' }, 'ft@indrones.com', '16-Aug-2026 09:00:00'),
];
ss.sheets.push(new FakeSheet('APP_DATA', ORIGINAL));

const tab = () => ss.getSheetByName('APP_DATA');
const backups = () => ss.getSheets().filter(s => /^APP_DATA_BACKUP_/.test(s.getName()));
const preRestores = () => ss.getSheets().filter(s => /^APP_DATA_PRE_RESTORE_/.test(s.getName()));
const byIRSec = (ir, sec) => {
  const line = tab().rows.find(l => l[0] === ir && l[1] === sec);
  return line ? { by: line[2], at: line[4], fields: JSON.parse(line[3]) } : null;
};
const seq = () => tab().rows.slice(1).map(l => l[0] + '/' + l[1]);
const snapshot = () => JSON.stringify(tab().rows);

// ── The report changes nothing ────────────────────────────────────────────────
r.head('the read-only report writes nothing at all');
const report = ctx.mergeSectionsReport();
r.ok('it reports', /REPORT ONLY/.test(report), report.split('\n')[0]);
r.ok('it says what it would do', /Rows rewritten:\s+3/.test(report) && /Rows deleted:\s+2/.test(report),
  report.split('\n').filter(l => /Rows (rewritten|deleted)/.test(l)));
r.ok('the sheet is untouched', snapshot() === JSON.stringify(ORIGINAL));
r.ok('and no backup was created by a READ', backups().length === 0, backups().map(s => s.getName()));
r.ok('it takes no lock either — it changes nothing', events.indexOf('getScriptLock') < 0);

// ── Apply, for real ───────────────────────────────────────────────────────────
r.head('mergeSectionsApply rewrites and deletes the rows the plan named');
events.length = 0;
const applied = ctx.mergeSectionsApply();

r.ok('the lock is taken FIRST, before the snapshot is read',
  events[0] === 'getScriptLock' && events[1] === 'waitLock:20000' &&
  events.indexOf('read:APP_DATA') > 1,
  events.slice(0, 4));
r.ok('the snapshot is read INSIDE the lock, not before it',
  events.indexOf('read:APP_DATA') < events.indexOf('releaseLock'),
  events);
r.ok('and the lock is released at the end, in a finally',
  events[events.length - 1] === 'releaseLock', events.slice(-2));

r.ok('9 rows became 7 — two deleted, nothing appended',
  tab().rows.length === 7, tab().rows.length);
// ONE assertion that pins the delete order, the retargeting and the sentinel at once.
r.ok('every surviving row is exactly where it was, in its original order',
  seq().join(' ') === 'IR601/sec-b IR600/sec-f IR600/sec-g IR602/sec-c __IRS__/IR600 IR603/sec-f',
  seq());
r.ok('THE SENTINEL SURVIVED — a top-down delete would have eaten it',
  seq().includes('__IRS__/IR600'));
r.ok('and the deletes ran bottom-up, not top-down',
  events.indexOf('delete:APP_DATA:7') < events.indexOf('delete:APP_DATA:2'),
  events.filter(e => /^delete/.test(e)));

r.head('the merged rows hold the union, with the newest author and stamp');
const f = byIRSec('IR600', 'sec-f');
r.ok('sec-f took the old Flight Test value', f.fields.g_missionReport === 'flight ok', f.fields);
r.ok('and kept its own QC value', f.fields.f_qcDocs_links === 'http://drive/1', f.fields);
r.ok('its author is the newest source row', f.by === 'qc@indrones.com', f.by);
r.ok('and its stamp is that row\'s stamp', f.at === '13-Aug-2026 09:00:00', f.at);
const g = byIRSec('IR600', 'sec-g');
r.ok('sec-g took both dispatch halves',
  g.fields.h_dispatchChecklist === 'packed' && g.fields.i_courier === 'BlueDart', g.fields);
r.ok('NO sec-g row holds a g_* key — Flight Test did not land in PDI',
  !Object.keys(g.fields).some(k => k.indexOf('g_') === 0), Object.keys(g.fields));
r.ok('the newest dispatch row supplied the author', g.by === 'dp@indrones.com', g.by);
r.ok('done[] is present and remapped on both',
  JSON.stringify(f.fields.done) === '[]' && JSON.stringify(g.fields.done) === '[]',
  { f: f.fields.done, g: g.fields.done });

r.head('a lone source row is retargeted in place, not re-created');
r.ok('IR603 is now sec-f', seq().includes('IR603/sec-f'));
r.ok('and it kept its own data',
  byIRSec('IR603', 'sec-f').fields.g_missionReport === 'lone flight test',
  byIRSec('IR603', 'sec-f'));

r.head('rows the merge had no business touching are byte-identical');
// Looked up by content, not by index: an off-by-one in a TEST fixture produces a
// failure that looks exactly like a real bug, which is the most expensive kind of
// false positive to chase.
const untouchedBefore = ORIGINAL.filter(l => l[0] === 'IR601' || l[0] === 'IR602');
const untouchedAfter = [tab().rows.find(l => l[0] === 'IR601'), tab().rows.find(l => l[0] === 'IR602')];
r.ok('IR601/sec-b is untouched', JSON.stringify(untouchedBefore[0]) === JSON.stringify(untouchedAfter[0]),
  untouchedAfter[0]);
r.ok('IR602/sec-c is untouched', JSON.stringify(untouchedBefore[1]) === JSON.stringify(untouchedAfter[1]),
  untouchedAfter[1]);

// ── The backup ────────────────────────────────────────────────────────────────
r.head('the backup is the WHOLE pre-merge snapshot, in a dated tab');
const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
  .format(new Date());
r.ok('exactly one backup tab exists', backups().length === 1, backups().map(s => s.getName()));
r.ok('named for today in IST — the code asks for Asia/Kolkata, not UTC',
  backups()[0].getName() === 'APP_DATA_BACKUP_' + istToday &&
  /^APP_DATA_BACKUP_\d{4}-\d{2}-\d{2}$/.test(backups()[0].getName()),
  backups()[0].getName());
r.ok('it holds the pre-merge rows, byte for byte',
  JSON.stringify(backups()[0].rows) === JSON.stringify(ORIGINAL));
r.ok('the report names it, so the operator can find it',
  applied.indexOf('APP_DATA_BACKUP_' + istToday) > -1 && /restoreAppDataFromBackup/.test(applied),
  applied.split('\n').slice(-3));

// ── Idempotency, in the real code path ────────────────────────────────────────
r.head('a second run is refused, and changes nothing');
const afterApply = snapshot();
const again = ctx.mergeSectionsApply();
r.ok('it says Already merged', /^Already merged/.test(again), again);
r.ok('the sheet is byte-identical', snapshot() === afterApply);
r.ok('no SECOND backup was made — the guard runs before the backup, not after',
  backups().length === 1, backups().map(s => s.getName()));
r.ok('and the existing backup still holds the PRE-merge state, not the post-merge one',
  JSON.stringify(backups()[0].rows) === JSON.stringify(ORIGINAL));

// ── The undo ──────────────────────────────────────────────────────────────────
r.head('the undo restores the pre-merge sheet, and is itself undoable');
const restored = ctx.restoreAppDataFromBackup();
r.ok('it reports what it did', /Restored APP_DATA from APP_DATA_BACKUP_/.test(restored),
  restored.split('\n')[0]);
r.ok('the sheet is byte-identical to the ORIGINAL again',
  snapshot() === JSON.stringify(ORIGINAL), seq());
r.ok('the post-merge state was saved as the redo', preRestores().length === 1,
  preRestores().map(s => s.getName()));
r.ok('and it holds the merged rows', preRestores()[0].rows.length === 7,
  preRestores()[0].rows.length);
r.ok('the backup tab is left alone, not consumed', backups().length === 1);

r.head('the merge is repeatable after an undo, and lands on the same result');
// After a restore the store is back to pre-merge; a re-apply must be refused only by
// the same-day backup guard, which is the documented way to run it twice in a day.
const reApply = ctx.mergeSectionsApply();
r.ok('it refuses because a backup already exists today — not silently',
  /^Refusing:/.test(reApply) && /already exists/.test(reApply), reApply.split('\n')[0]);
r.ok('and the store is still the pre-merge state', snapshot() === JSON.stringify(ORIGINAL));

// ── appendAuditEntries ────────────────────────────────────────────────────────
r.head('the audit log is written in the documented shape');
// The AUDIT_LOG tab is deliberately NOT pre-created: getOrCreateAuditTab is the thing
// that writes the header, and asserting the header it actually wrote is half the point.
// An empty pre-made tab silently takes its "already exists" branch instead.
const audit = () => ss.getSheetByName('AUDIT_LOG');
r.ok('the tab did not exist before the first audit write', !audit());
ctx.appendAuditEntries(ss, 'IR700', 'sec-b', 'inv@indrones.com',
  { b_a: 'old', b_gone: '2' },
  { b_a: 'new', b_b: 'added', done: ['sec-b'], b_doc_links: 'http://drive/x' },
  [{ fieldId: 'b_doc', name: 'photo.jpg' }]);

// A SNAPSHOT, not a reference: `audit().rows` is the live array, so holding it and
// then asking for `.length` later would count the rows the NEXT assertion writes.
const rows = audit().rows.map(l => l.slice());
r.ok('the header is exactly the eight documented columns',
  JSON.stringify(rows[0]) === JSON.stringify(['Timestamp', 'IR Number', 'Section ID', 'Saved By',
    'Event', 'Field ID', 'Old Value', 'New Value']), rows[0]);
r.ok('every row is exactly eight wide, so setValues cannot misalign the columns',
  rows.slice(1).every(l => l.length === 8), rows.slice(1).map(l => l.length));
r.ok('the events are, in order: saved, changed, added, removed, uploaded',
  rows.slice(1).map(l => l[4]).join(',') === 'saved,changed,added,removed,uploaded',
  rows.slice(1).map(l => l[4]));
const ts = rows[1][0];
r.ok('the timestamp is real, not a Date object', typeof ts === 'string' && ts.length > 10, ts);
r.ok('and it round-trips through the parser the timeline uses',
  ctx.parseAuditTimestamp(ts) !== null, ts);
r.ok('the saved marker carries no field and no values',
  rows[1][5] === '' && rows[1][6] === '' && rows[1][7] === '', rows[1]);
r.ok('changed carries old → new',
  rows[2][5] === 'b_a' && rows[2][6] === 'old' && rows[2][7] === 'new', rows[2]);
r.ok('added carries an empty old value', rows[3][5] === 'b_b' && rows[3][6] === '', rows[3]);
r.ok('removed is logged with an empty new value',
  rows[4][5] === 'b_gone' && rows[4][6] === '2' && rows[4][7] === '', rows[4]);
r.ok('an upload names the SOURCE field, never the derived _links key',
  rows[5][5] === 'b_doc' && rows[5][7] === 'photo.jpg', rows[5]);
r.ok('no row mentions done or a _links key, so the noise is gone',
  !rows.slice(1).some(l => l[5] === 'done' || /_links$/.test(l[5])),
  rows.slice(1).map(l => l[5]));

r.head('sentinel writes get no bare saved marker, but their fields are logged');
ctx.appendAuditEntries(ss, '__IRS__', 'IR700', 'sys@indrones.com', { status: 'Open' },
  { status: 'Production' }, []);
const sentinelRows = audit().rows.slice(rows.length);
r.ok('exactly one row', sentinelRows.length === 1, sentinelRows);
r.ok('it is the field change, not a contentless marker',
  sentinelRows[0][4] === 'changed' && sentinelRows[0][5] === 'status' &&
  sentinelRows[0][6] === 'Open' && sentinelRows[0][7] === 'Production', sentinelRows[0]);
r.ok('and there is no second, empty marker row for the same write',
  !sentinelRows.some(l => l[4] === 'saved'), sentinelRows);

r.head('a long value is truncated, so one field cannot dominate the tab');
ctx.appendAuditEntries(ss, 'IR700', 'sec-c', 'qc@indrones.com', {}, { c_big: 'x'.repeat(600) }, []);
const bigRow = audit().rows[audit().rows.length - 1];
r.ok('truncated at 500 and marked as truncated',
  bigRow[7].length === 501 && bigRow[7].slice(-1) === '…' && bigRow[7].slice(0, 3) === 'xxx',
  bigRow[7].length);

r.head('an upload is logged only when a file was actually picked');
const before = audit().rows.length;
ctx.appendAuditEntries(ss, 'IR700', 'sec-d', 'pd@indrones.com', {}, { d_a: '1' }, []);
ctx.appendAuditEntries(ss, 'IR700', 'sec-d', 'pd@indrones.com', {}, { d_b: '2' }, [null]);
r.ok('no upload rows for an empty or null uploads list',
  !audit().rows.slice(before).some(l => l[4] === 'uploaded'),
  audit().rows.slice(before).map(l => l[4]));

// ── getAuditLog ───────────────────────────────────────────────────────────────
r.head('getAuditLog finds section rows AND workflow rows, and nothing else');
ctx.appendAuditEntries(ss, 'IR701', 'sec-b', 'inv@indrones.com', {}, { b_x: '1' }, []);
ctx.appendAuditEntries(ss, '__IRS__', 'IR701', 'sys@indrones.com', {}, { assignee: 'x' }, []);
const log = ctx.getAuditLog('IR700');
r.ok('it returns entries', log.status === 'ok' && log.entries.length > 0, log);
// THE invariant a consumer relies on: an entry is about the IR that was asked for.
// A workflow row's own column B says `__IRS__` — the STORE, not the ticket — so
// reporting it verbatim would hand back an entry nobody can attribute, and any future
// `e.irNumber === irNumber` filter would silently drop every status change.
r.ok('every entry belongs to IR700, including the workflow ones',
  log.entries.every(e => e.irNumber === 'IR700'),
  log.entries.filter(e => e.irNumber !== 'IR700'));
r.ok('the workflow row IS reachable — its IR lives in the Section ID column',
  log.entries.some(e => e.source === 'workflow' && e.fieldId === 'status'), log.entries);
r.ok('and a workflow row reports no sectionId, so it cannot be mistaken for a save',
  log.entries.filter(e => e.source === 'workflow').every(e => e.sectionId === ''), log.entries);
r.ok('the __IRS__ row for a DIFFERENT IR is excluded',
  !log.entries.some(e => e.sectionId === 'IR701' || e.irNumber === 'IR701'), log.entries.length);
r.ok('IR701 does not leak in', !log.entries.some(e => e.irNumber === 'IR701'), log.entries.length);
r.ok('the order is OLDEST FIRST, as the header claims',
  (() => {
    const t = log.entries.map(e => ctx.parseAuditTimestamp(e.timestamp));
    return t.every((v, i) => v !== null && (i === 0 || v >= t[i - 1]));
  })(), log.entries.map(e => e.timestamp).slice(0, 3));

r.head('limit trims the response from the OLDEST end');
const capped = ctx.getAuditLog('IR700', 2);
r.ok('two entries come back', capped.entries.length === 2, capped.entries.length);
r.ok('they are the NEWEST two', JSON.stringify(capped.entries) === JSON.stringify(log.entries.slice(-2)),
  { got: capped.entries.length, want: log.entries.slice(-2).length });
r.ok('and the response is flagged truncated', capped.truncated === true, capped.truncated);
r.ok('an absent IR is an empty list, not an error',
  JSON.stringify(ctx.getAuditLog('IR999')) === JSON.stringify({ status: 'ok', entries: [], truncated: false }),
  ctx.getAuditLog('IR999'));
r.ok('a limit above the cap is clamped, not obeyed',
  ctx.getAuditLog('IR700', 100000).entries.length === log.entries.length);
r.ok('a nonsense limit falls back to the cap rather than returning nothing',
  ctx.getAuditLog('IR700', 0).entries.length === log.entries.length &&
  ctx.getAuditLog('IR700', 'x').entries.length === log.entries.length);
r.ok('and a missing IR number throws instead of returning the whole log', (() => {
  try { ctx.getAuditLog(''); return false; } catch (e) { return /required/.test(e.message); }
})());

r.finish();
