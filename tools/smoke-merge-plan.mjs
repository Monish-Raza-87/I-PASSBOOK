// Smoke test for `planSectionMerge` — the merge migration's only executable part.
//
//   node tools/smoke-merge-plan.mjs
//
// This is the strongest test available for the one change in the release that
// REWRITES live data. `mergeSectionsApply` cannot be run here: it needs
// SpreadsheetApp, Utilities and LockService. But the dangerous half of it — deciding
// which row survives, which is deleted, which keys union, and where each `done[]` id
// lands — lives in a PURE function with no Apps Script dependency at all.
//
// So the source is extracted from backend.gs by name and EXECUTED here against
// fixture arrays shaped exactly like `getDataRange().getValues()`. Production code,
// not a copy: if the real function changes, this test changes with it.
//
// The regression it exists for is the DIRECTION COLLISION. Old `sec-g` (Flight Test)
// is a SOURCE for new `sec-f`, while new `sec-g` is a TARGET for old `sec-h`/`sec-i`.
// A sequential rewrite-and-rescan merges Flight Test rows into PDI and looks
// completely plausible afterwards. The test for it is the "all four rows" case.

import fs from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { makeReporter } from './harness.mjs';

const r = makeReporter();
const src = fs.readFileSync(new URL('../backend.gs', import.meta.url), 'utf8');

// ── Extract the pure part, and only the pure part ─────────────────────────────
// Bounded by brace matching rather than `indexOf('\n}')`, so a nested block inside
// the function cannot silently truncate it into something that still evaluates.
function fnSource(name) {
  const at = src.search(new RegExp('^function\\s+' + name + '\\s*\\(', 'm'));
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  return '';
}

const PURE_FNS = ['planSectionMerge', 'mergeTargetFor', 'fieldKeysOf', 'addDone',
                  'orderDoneBySections', 'countDistinctIRs', 'parseAuditTimestamp'];
const parts = PURE_FNS.map(name => ({ name, code: fnSource(name) }));
const missing = parts.filter(p => !p.code.length);
if (missing.length) {
  console.log('  FAIL  every pure function was found in backend.gs → ' + JSON.stringify(missing.map(m => m.name)));
  process.exit(1);
}

// Constants, read as source so they cannot drift from the real values.
const constSource = name => {
  const at = src.search(new RegExp('^var\\s+' + name + '\\s*=', 'm'));
  if (at < 0) return '';
  const end = src.indexOf(';', at);
  return src.slice(at, end + 1);
};
const CONSTS = ['SECTION_KEYS', 'SEC_TARGET_MAP', 'DONE_MAP'];
const consts = CONSTS.map(c => constSource(c)).join('\n');
// A constant this test names but cannot find would silently evaluate as `undefined`
// inside the vm — the functions would still load, and every assertion would be
// measuring a differently-configured merge than the one that ships. Fail loudly.
const missingConsts = CONSTS.filter(c => !constSource(c).length);
if (missingConsts.length) {
  console.log('  FAIL  every constant was found in backend.gs → ' + JSON.stringify(missingConsts));
  process.exit(1);
}

// A FRESH vm context, with its OWN intrinsics — deliberately NOT the host's.
//
// This is load-bearing, not hygiene. `planSectionMerge` and `addDone` use
// `x instanceof Array`, and `instanceof` is FALSE across realms: an array created by
// the HOST's `JSON.parse` fails `instanceof` against the context's own `Array`, and
// vice versa. Passing the host's `{ JSON, Object, Array, … }` in — the obvious thing
// to do, and what this file did first — makes `addDone` discard every id but the last,
// so the suite accused the production code of a `done[]` data-loss bug that does not
// exist. The context must be self-contained for extracted source to behave the way it
// behaves in Apps Script, where there is only ever one realm.
const ctx = { console };          // console is the only host value worth keeping
createContext(ctx);
try {
  runInContext(consts + '\n' + parts.map(p => p.code).join('\n\n'), ctx, { filename: 'backend.pure.js' });
} catch (e) {
  console.log('  FAIL  the extracted pure source evaluates with no Apps Script globals → ' + e.message);
  process.exit(1);
}
r.ok('the pure half of the migration runs with no Apps Script globals at all',
  typeof ctx.planSectionMerge === 'function');
r.ok('the merge map it uses is the real one',
  ctx.SEC_TARGET_MAP['sec-g'] === 'sec-f' && ctx.SEC_TARGET_MAP['sec-h'] === 'sec-g' &&
  ctx.SEC_TARGET_MAP['sec-i'] === 'sec-g', ctx.SEC_TARGET_MAP);
r.ok('DONE_MAP drops sec-a and never chains', ctx.DONE_MAP['sec-a'] === null &&
  ctx.DONE_MAP['sec-g'] === 'sec-f' && ctx.DONE_MAP['sec-h'] === 'sec-g' &&
  ctx.DONE_MAP['sec-i'] === 'sec-g', ctx.DONE_MAP);

// ── Fixtures ──────────────────────────────────────────────────────────────────
// APP_DATA is [IR Number, Section ID, Saved By, Fields (JSON), Last Updated].
const HEADER = ['IR Number', 'Section ID', 'Saved By', 'Fields', 'Last Updated'];
const row = (ir, sec, fields, by, at) => [ir, sec, by || 'a@indrones.com',
  JSON.stringify(fields || {}), at || '10-Aug-2026 10:00:00'];
const sheet = (...rows) => [HEADER].concat(rows);
const plan = data => ctx.planSectionMerge(data);
const bySection = p => p.survivors.map(s => s.irNumber + '/' + s.sectionId).sort().join(',');
const fieldsOf = (p, ir, sec) => JSON.parse(p.survivors.find(s => s.irNumber === ir && s.sectionId === sec).rowData[3]);

// THE HARNESS IS ONLY AS GOOD AS THIS: apply the plan to the snapshot the way
// mergeSectionsApply does — write survivors in place, delete the rest bottom-up —
// so idempotency and the delete set can both be checked against a real second pass.
function apply(data, p) {
  const out = data.map(r2 => r2.slice());
  p.survivors.forEach(s => { out[s.row - 1] = s.rowData.slice(); });
  p.deletes.map(d => d.row).sort((a, b) => b - a).forEach(row1 => out.splice(row1 - 1, 1));
  return out;
}

// ── The direction collision ───────────────────────────────────────────────────
r.head('an IR holding all four old rows becomes exactly two');
// The regression test for the whole design. Old sec-g is a SOURCE for sec-f; new
// sec-g is a TARGET for old sec-h/sec-i. One snapshot, groups keyed by TARGET.
const allFour = sheet(
  row('IR500', 'sec-g', { g_missionReport: 'flight ok' }, 'ft@indrones.com', '12-Aug-2026 09:00:00'),
  row('IR500', 'sec-f', { f_qcDocs_links: 'http://drive/1' }, 'qc@indrones.com', '11-Aug-2026 09:00:00'),
  row('IR500', 'sec-h', { h_dispatchChecklist: 'packed' }, 'pd@indrones.com', '13-Aug-2026 09:00:00'),
  row('IR500', 'sec-i', { i_courier: 'BlueDart' }, 'dp@indrones.com', '14-Aug-2026 09:00:00'),
);
const p1 = plan(allFour);
r.ok('exactly two survivors', p1.survivors.length === 2, p1.survivors.map(s => s.sectionId));
r.ok('exactly two deletes', p1.deletes.length === 2, p1.deletes.map(d => d.row + ':' + d.sectionId));
r.ok('the survivors are sec-f and sec-g', bySection(p1) === 'IR500/sec-f,IR500/sec-g', bySection(p1));
r.ok('one IR is touched, not two', p1.counts.irsTouched === 1, p1.counts);
r.ok('nothing is created — the row count can only stay or shrink',
  p1.survivors.length + (allFour.length - 1 - p1.survivors.length - p1.deletes.length) >= 0 &&
  !Object.prototype.hasOwnProperty.call(p1, 'creates'), Object.keys(p1));
r.ok('five rows in, three rows out (the header plus two data rows)',
  apply(allFour, p1).length === 3, apply(allFour, p1).length);

r.head('the Flight Test row did NOT end up in PDI');
// This is the failure the design exists to prevent: `sec-g` is both a source for
// sec-f and a target for sec-h/sec-i. A sequential pass puts `g_missionReport` in
// the new sec-g row alongside the dispatch data, and nothing about the result looks
// wrong until somebody opens Section G and finds flight-test fields in it.
const fRow = fieldsOf(p1, 'IR500', 'sec-f');
const gRow = fieldsOf(p1, 'IR500', 'sec-g');
r.ok('sec-f holds the old f_* key', fRow.f_qcDocs_links === 'http://drive/1', fRow);
r.ok('sec-f holds the old g_* key too (that is the merge)',
  fRow.g_missionReport === 'flight ok', fRow);
r.ok('NO sec-g row holds a g_* key',
  !Object.keys(gRow).some(k => k.indexOf('g_') === 0), Object.keys(gRow));
r.ok('sec-g holds the h_* key', gRow.h_dispatchChecklist === 'packed', gRow);
r.ok('sec-g holds the i_* key', gRow.i_courier === 'BlueDart', gRow);
r.ok('and sec-g holds NO f_* key either, in the other direction',
  !Object.keys(gRow).some(k => k.indexOf('f_') === 0), Object.keys(gRow));

// ── Each pair on its own ──────────────────────────────────────────────────────
r.head('QC + Flight Test merge into sec-f');
const qcOnly = sheet(
  row('IR501', 'sec-g', { g_missionReport: 'ok' }),
  row('IR501', 'sec-f', { f_qcDocs_links: 'http://drive/2' }),
);
const p2 = plan(qcOnly);
r.ok('one survivor, one delete', p2.survivors.length === 1 && p2.deletes.length === 1,
  { s: p2.survivors.length, d: p2.deletes.length });
r.ok('the survivor is the EXISTING sec-f row, so it keeps its position',
  p2.survivors[0].row === 3, p2.survivors[0].row);
r.ok('and it carries both keys', (() => {
  const f = fieldsOf(p2, 'IR501', 'sec-f');
  return f.g_missionReport === 'ok' && f.f_qcDocs_links === 'http://drive/2';
})(), fieldsOf(p2, 'IR501', 'sec-f'));
r.ok('the deleted row is the old sec-g', p2.deletes[0].sectionId === 'sec-g', p2.deletes[0]);

r.head('a lone source row is retargeted IN PLACE, never re-created');
// No target row exists, so the first source row is rewritten. That is what removes
// a `creates` array from the plan entirely — and why the backup's row count is a
// meaningful check rather than a formality.
const loneG = sheet(row('IR502', 'sec-g', { g_missionReport: 'ok' }));
const p3 = plan(loneG);
r.ok('one survivor', p3.survivors.length === 1, p3.survivors.length);
r.ok('ZERO deletes — the row was rewritten, not moved',
  p3.deletes.length === 0, p3.deletes);
r.ok('the survivor is the original row index', p3.survivors[0].row === 2, p3.survivors[0].row);
r.ok('and its section column now says sec-f', p3.survivors[0].rowData[1] === 'sec-f', p3.survivors[0].rowData);
r.ok('the applied sheet has the same number of rows as before',
  apply(loneG, p3).length === loneG.length, { before: loneG.length, after: apply(loneG, p3).length });

r.head('PDI + Dispatch merge into sec-g');
const pdi = sheet(
  row('IR503', 'sec-h', { h_dispatchChecklist: 'packed' }, 'pd@indrones.com', '13-Aug-2026 09:00:00'),
  row('IR503', 'sec-i', { i_courier: 'BlueDart' }, 'dp@indrones.com', '14-Aug-2026 09:00:00'),
);
const p4 = plan(pdi);
r.ok('one survivor', p4.survivors.length === 1 && p4.survivors[0].sectionId === 'sec-g',
  p4.survivors.map(s => s.sectionId));
r.ok('one delete', p4.deletes.length === 1, p4.deletes);
r.ok('both keys are unioned', (() => {
  const g = fieldsOf(p4, 'IR503', 'sec-g');
  return g.h_dispatchChecklist === 'packed' && g.i_courier === 'BlueDart';
})(), fieldsOf(p4, 'IR503', 'sec-g'));

// ── done[] ────────────────────────────────────────────────────────────────────
r.head('done[] is remapped in ONE pass, so it cannot chain');
// sec-h → sec-g → sec-f would be the chained result of sequential replaces: a
// historical PDI completion silently recorded as a Flight Test completion.
// Every row here carries a real field for its own section: an old Flight Test row is
// identified BY its `g_*` field, so a fixture that omits one is not an old sec-g row
// at all — see `mergeTargetFor`.
const doneRows = sheet(
  row('IR504', 'sec-g', { done: ['sec-a', 'sec-g'], g_missionReport: 'ok' }),
  row('IR504', 'sec-h', { done: ['sec-a', 'sec-h'], h_dispatchChecklist: 'packed' }),
  row('IR504', 'sec-i', { done: ['sec-i'], i_courier: 'BlueDart' }),
);
const p5 = plan(doneRows);
r.ok('sec-a is dropped, sec-g→sec-f, sec-h→sec-g, sec-i→sec-g',
  fieldsOf(p5, 'IR504', 'sec-f').done.join(',') === 'sec-f' &&
  fieldsOf(p5, 'IR504', 'sec-g').done.join(',') === 'sec-g',
  { f: JSON.parse(p5.survivors.find(s => s.sectionId === 'sec-f').rowData[3]).done,
    g: JSON.parse(p5.survivors.find(s => s.sectionId === 'sec-g').rowData[3]).done });
r.ok('nothing landed on sec-f from the PDI side (no chaining)',
  JSON.parse(p5.survivors.find(s => s.sectionId === 'sec-f').rowData[3]).done.indexOf('sec-g') < 0);
// One entry per id per row, and a row is never skipped: sec-a ×2 (dropped), sec-g→sec-f,
// sec-h→sec-g, sec-i→sec-g. A count below this means a row's done[] went unprocessed.
r.ok('every remap is logged, for every row', p5.doneRemaps.length === 5, p5.doneRemaps);
r.ok('the drop is logged too', p5.doneRemaps.some(x => /sec-a.*dropped/.test(x)), p5.doneRemaps);
r.ok('done is always present, so the app need not guess',
  p5.survivors.every(s => Array.isArray(JSON.parse(s.rowData[3]).done)),
  p5.survivors.map(s => JSON.parse(s.rowData[3]).done));
// Stable across runs: a re-run's diff should be empty, not merely equivalent.
r.ok('done is ordered by SECTION_KEYS, not by insertion',
  (() => {
    const rows = sheet(row('IR505', 'sec-h', { done: ['sec-g', 'sec-b'] }), row('IR505', 'sec-i', { done: ['sec-c'] }));
    const done = fieldsOf(plan(rows), 'IR505', 'sec-g').done;
    return done.join(',') === 'sec-b,sec-c,sec-f';
  })(), (() => {
    const rows = sheet(row('IR505', 'sec-h', { done: ['sec-g', 'sec-b'] }), row('IR505', 'sec-i', { done: ['sec-c'] }));
    return fieldsOf(plan(rows), 'IR505', 'sec-g').done;
  })());

// ── The two eras of sec-g ─────────────────────────────────────────────────────
r.head('sec-g is dated by its own field ids, never by its section column');
// THE regression the classifier exists for. After the merge, `sec-g` is the live
// PDI/Dispatch section — but it is also a SOURCE for sec-f. A plain map lookup reads
// the merged PDI row as Flight Test, so a SECOND run sweeps it into sec-f, silently,
// and the result still looks like a perfectly plausible sheet.
r.ok('an old Flight Test row (g_*) targets sec-f',
  ctx.mergeTargetFor(row('IR520', 'sec-g', { g_missionReport: 'x' }), 'sec-g') === 'sec-f');
r.ok('a new PDI/Dispatch row (h_*) targets sec-g — itself',
  ctx.mergeTargetFor(row('IR520', 'sec-g', { h_dispatchChecklist: 'x' }), 'sec-g') === 'sec-g');
r.ok('and one carrying only i_* does too',
  ctx.mergeTargetFor(row('IR520', 'sec-g', { i_courier: 'x' }), 'sec-g') === 'sec-g');
r.ok('a MERGED sec-f row holds g_* and is still just sec-f',
  ctx.mergeTargetFor(row('IR520', 'sec-f', { f_a: 1, g_missionReport: 'x' }), 'sec-f') === 'sec-f');
r.ok('sec-h and sec-i are unambiguous, marker or no marker',
  ctx.mergeTargetFor(row('IR520', 'sec-h', {}), 'sec-h') === 'sec-g' &&
  ctx.mergeTargetFor(row('IR520', 'sec-i', {}), 'sec-i') === 'sec-g');
r.ok('an unreadable Fields column does not provoke a guess',
  ctx.mergeTargetFor(row('IR520', 'sec-g', null), 'sec-g') === 'sec-g' &&
  ctx.mergeTargetFor(['IR520', 'sec-g', 'a@b.com', '{not json', 'x'], 'sec-g') === 'sec-g');

r.head('the second run is a genuine no-op, not merely equivalent');
// The property mergeSectionsApply's guard is built on. If a re-run still plans
// survivors, the guard walks past it and every already-merged row is rewritten.
const merged = apply(allFour, p1);
const p1b = plan(merged);
r.ok('no survivors on a re-run', p1b.survivors.length === 0, p1b.survivors);
r.ok('no deletes on a re-run', p1b.deletes.length === 0, p1b.deletes);
r.ok('and a second apply changes not one byte',
  JSON.stringify(apply(merged, p1b)) === JSON.stringify(merged));
r.ok('the merged PDI row was NOT swept into sec-f by the re-run',
  merged.some(r2 => r2[0] === 'IR500' && r2[1] === 'sec-g'));
r.ok('the guard mergeSectionsApply uses would fire',
  p1b.survivors.length === 0 && p1b.deletes.length === 0);

r.head('a sec-g row with no field to date it is left alone, and named');
// An old Flight Test row so empty that nothing identifies it. Leaving it as sec-g is
// the SAFE direction — a stray, visible row beats a silent merge that destroys
// dispatch data — but it has to be VISIBLE, because the rehearsal's whole check is
// "did every sec-g row move?".
const pE = plan(sheet(row('IR521', 'sec-g', { done: ['sec-a'] })));
r.ok('nothing is merged', pE.survivors.length === 0 && pE.deletes.length === 0, pE);
r.ok('the ambiguity is recorded', pE.ambiguous.length === 1, pE.ambiguous);
r.ok('and it names the IR and the row',
  /IR521/.test(pE.ambiguous[0]) && /row 2/.test(pE.ambiguous[0]), pE.ambiguous[0]);
r.ok('a normal new sec-g row is not flagged — this is not a blanket warning',
  plan(sheet(row('IR522', 'sec-g', { h_dispatchChecklist: 'x' }))).ambiguous.length === 0);
r.ok('neither is an old Flight Test row',
  plan(sheet(row('IR523', 'sec-g', { g_missionReport: 'x' }))).ambiguous.length === 0);

// ── What must not move ────────────────────────────────────────────────────────
r.head('rows the merge has no business touching are left alone');
const untouched = sheet(
  row('IR506', 'sec-b', { b_remarks: 'keep' }, 'inv@indrones.com', '15-Aug-2026 09:00:00'),
  row('IR506', 'sec-c', { c_notes: 'keep' }),
  row('IR506', 'sec-e', { e_notes: 'keep' }),
  row('IR507', 'sec-b', { b_remarks: 'also keep' }),
);
const p6 = plan(untouched);
r.ok('no survivors — nothing to merge', p6.survivors.length === 0, p6.survivors);
r.ok('no deletes', p6.deletes.length === 0, p6.deletes);
r.ok('the applied sheet is byte-identical to the original',
  JSON.stringify(apply(untouched, p6)) === JSON.stringify(untouched));

r.head('sentinel stores are never rewritten');
// Column A is the store name and column B is a real-world key for these. Nothing
// matches today's map, but the guard is what stops a FUTURE map entry from
// corrupting the app's own workflow state — where the damage would be silent and
// total.
const sentinels = sheet(
  row('__IRS__', 'IR508', { status: 'Production', done: ['sec-a', 'sec-g'] }),
  row('__NUDGES__', 'all', { items: [] }),
  row('__CONFIG__', 'statuses', { list: [] }),
);
const p7 = plan(sentinels);
r.ok('no sentinel row is a survivor', p7.survivors.length === 0, p7.survivors);
r.ok('no sentinel row is deleted', p7.deletes.length === 0, p7.deletes);
r.ok('nothing is touched at all', JSON.stringify(apply(sentinels, p7)) === JSON.stringify(sentinels));

r.head('a row with a blank IR or section is skipped, not guessed at');
const blanks = sheet(row('', 'sec-g', { g_missionReport: 'x' }), row('IR509', '', { g_missionReport: 'y' }));
const p8 = plan(blanks);
r.ok('both blank-ish rows are left alone',
  p8.survivors.length === 0 && p8.deletes.length === 0, { s: p8.survivors, d: p8.deletes });

// ── What the plan must SURFACE rather than resolve ────────────────────────────
r.head('a collision is reported, never silently resolved');
// A real collision means somebody wrote a field through the API that no form
// declares. Later wins, but the operator has to see it. The carrier row still needs
// its `g_*` marker, or it is not an old Flight Test row and never reaches sec-f.
const collide = sheet(
  row('IR510', 'sec-f', { f_notes: 'from f' }, 'a@indrones.com', '11-Aug-2026 09:00:00'),
  row('IR510', 'sec-g', { g_missionReport: 'ok', f_notes: 'from g' }, 'b@indrones.com', '12-Aug-2026 09:00:00'),
);
const p9 = plan(collide);
r.ok('the collision is recorded', p9.collisions.length === 1, p9.collisions);
r.ok('and it names the field', /f_notes/.test(p9.collisions[0]), p9.collisions[0]);
r.ok('it does not stop the merge', p9.survivors.length === 1, p9.survivors.length);
r.ok('the newer value wins', fieldsOf(p9, 'IR510', 'sec-f').f_notes === 'from g',
  fieldsOf(p9, 'IR510', 'sec-f'));
r.ok('the clean case records no collision',
  plan(sheet(row('IR511', 'sec-f', { f_a: 1 }), row('IR511', 'sec-g', { g_b: 2 }))).collisions.length === 0);

r.head('two rows already holding the target id is an anomaly, and is reported');
const dup = sheet(row('IR512', 'sec-f', { f_a: 1 }), row('IR512', 'sec-f', { f_b: 2 }));
const p10 = plan(dup);
r.ok('the duplicate is recorded', p10.duplicates.length === 1, p10.duplicates);
r.ok('and it names both rows', /rows 2 and 3/.test(p10.duplicates[0]), p10.duplicates[0]);
r.ok('one survivor is still produced', p10.survivors.length === 1, p10.survivors.length);
r.ok('and the other row is deleted, so the duplicate is resolved',
  p10.deletes.length === 1, p10.deletes);

r.head('the newest source row supplies the author and the stamp');
// So the merged row's "Saved By" and "Last Updated" agree with each other, rather
// than pairing the newest author with the oldest timestamp.
const latest = sheet(
  row('IR513', 'sec-f', { f_a: 1 }, 'old@indrones.com', '10-Aug-2026 09:00:00'),
  row('IR513', 'sec-g', { g_b: 2 }, 'new@indrones.com', '12-Aug-2026 09:00:00'),
);
const p11 = plan(latest);
r.ok('Saved By is the newest author', p11.survivors[0].rowData[2] === 'new@indrones.com', p11.survivors[0].rowData);
r.ok('Last Updated is the newest stamp', p11.survivors[0].rowData[4] === '12-Aug-2026 09:00:00', p11.survivors[0].rowData);
r.ok('but the row POSITION is still the existing target row',
  p11.survivors[0].row === 2, p11.survivors[0].row);

// ── Idempotency ───────────────────────────────────────────────────────────────
r.head('applying the plan makes a second run a no-op');
// This is what `mergeSectionsApply`'s "Already merged" guard tests, and what the
// dated backup makes unreachable — but the planner is the thing that has to be
// idempotent for either to hold.
[['all four', allFour, p1], ['QC only', qcOnly, p2], ['lone source', loneG, p3],
 ['PDI+Dispatch', pdi, p4], ['done rows', doneRows, p5], ['collision', collide, p9]].forEach(([name, data, p]) => {
  const once = apply(data, p);
  const p2nd = plan(once);
  r.ok('re-planning after ' + name + ' finds no deletes', p2nd.deletes.length === 0, p2nd.deletes);
  r.ok('re-planning after ' + name + ' finds no survivors either',
    p2nd.survivors.length === 0, p2nd.survivors.map(s => s.sectionId));
  r.ok('and a second apply changes nothing at all',
    JSON.stringify(apply(once, p2nd)) === JSON.stringify(once));
});
// And the whole store at once, since order between groups is what a real run does.
const wholeStore = sheet(
  row('IR500', 'sec-g', { g_missionReport: 'x', done: ['sec-a'] }),
  row('IR500', 'sec-f', { f_a: 1 }),
  row('IR500', 'sec-h', { h_a: 1 }),
  row('IR500', 'sec-i', { i_a: 1 }),
  row('IR501', 'sec-g', { g_missionReport: 'y' }),
  row('IR502', 'sec-b', { b_a: 1 }),
  row('__IRS__', 'IR500', { status: 'Production' }),
);
const pAll = plan(wholeStore);
r.ok('the whole store: 3 survivors and 2 deletes',
  pAll.survivors.length === 3 && pAll.deletes.length === 2,
  { s: pAll.survivors.map(x => x.irNumber + '/' + x.sectionId), d: pAll.deletes });
r.ok('2 IRs touched', pAll.counts.irsTouched === 2, pAll.counts);
r.ok('the sentinel survived the whole-store pass',
  JSON.stringify(apply(wholeStore, pAll)).indexOf('__IRS__') > -1);
r.ok('the untouched sec-b row is still sec-b',
  apply(wholeStore, pAll).some(r2 => r2[0] === 'IR502' && r2[1] === 'sec-b'));
const pAll2 = plan(apply(wholeStore, pAll));
r.ok('and a re-run of the whole store is a no-op',
  pAll2.deletes.length === 0 && pAll2.survivors.length === 0, pAll2);
r.ok('with nothing left ambiguous either', pAll2.ambiguous.length === 0, pAll2.ambiguous);

// ── Degenerate input ──────────────────────────────────────────────────────────
r.head('degenerate input returns an empty plan, never a throw');
[[null], [undefined], [[]], [sheet()], [HEADER], ['not an array']].forEach(([bad]) => {
  let out = null, err = null;
  try { out = ctx.planSectionMerge(bad); } catch (e) { err = e.message; }
  r.ok('planSectionMerge(' + JSON.stringify(bad) + ') → empty plan, no throw',
    err === null && out && out.survivors.length === 0 && out.deletes.length === 0, { err, out });
});
r.ok('a row whose Fields column is not JSON does not abort the merge', (() => {
  const bad = sheet(['IR514', 'sec-f', 'a@b.com', '{not json', '10-Aug-2026 10:00:00'],
                    row('IR514', 'sec-g', { g_a: 1 }));
  const p = ctx.planSectionMerge(bad);
  return p.survivors.length === 1 && JSON.parse(p.survivors[0].rowData[3]).g_a === 1;
})());
r.ok('a row whose Last Updated is unparseable still merges', (() => {
  const bad = sheet(['IR515', 'sec-f', 'a@b.com', '{"f_a":1}', 'garbage'],
                    row('IR515', 'sec-g', { g_a: 1 }));
  const p = ctx.planSectionMerge(bad);
  return p.survivors.length === 1;
})(), ctx.planSectionMerge(sheet(['IR515', 'sec-f', 'a@b.com', '{"f_a":1}', 'garbage'], row('IR515', 'sec-g', { g_a: 1 }))).survivors);
r.ok('a non-array done value is treated as empty, not fatal', (() => {
  const bad = sheet(row('IR516', 'sec-f', { done: 'nope', f_a: 1 }), row('IR516', 'sec-g', { g_a: 2 }));
  const p = ctx.planSectionMerge(bad);
  return JSON.parse(p.survivors[0].rowData[3]).done.length === 0;
})());

r.finish();
