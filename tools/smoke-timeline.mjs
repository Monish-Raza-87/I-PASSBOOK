// Smoke test for the automated activity timeline.
//
//   node tools/smoke-timeline.mjs
//
// Decision 3 of the restructure — "so any activity happening in an IR is being
// recorded for context" — reaches the user entirely through `buildTimeline`, which
// is why that function is PURE: no fetch, no DOM, no clock. Everything the owner
// asked to see is asserted here as BEHAVIOUR, not as shape.
//
// The single most dangerous line in it is the timestamp parse. The backend stamps
// `'dd-MMM-yyyy HH:mm:ss'`, and `Date.parse('21-Aug-2026 14:03:11')` returns NaN in
// V8. NaN does not throw — it sorts as if every row happened at the same instant,
// so the timeline would look plausible and be in the wrong order forever. The first
// three cases below exist to catch that specifically.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();

const T = loadApp(`
  buildTimeline, parseAuditTimestamp, SUPPRESSED_AUDIT_FIELDS, TIMELINE_KINDS,
  renderTimelineInto, sectionDisplayName, iconSvg, ICON_PATHS,
  restoreOfferFor, fieldCurrentFrom, RESTORABLE_KINDS, VALUE_BEARING_KINDS,
  renderInto: (el, tl, opts) => renderTimelineInto(el, tl, opts),
`);

// The four shapes the backend actually writes, taken from appendAuditEntries:
//   [Timestamp, IR Number, Section ID, Saved By, Event, Field ID, Old Value, New Value]
// and getAuditLog's translation of them: it adds `source`, blanks the section id for a
// workflow row, and reports `irNumber` as the IR the row is ABOUT — which for a
// workflow row is column C, the ticket, NOT the `__IRS__` store name sitting in the
// row's own column B. So these fixtures are the real payload shape, and the
// `irNumber`-based filtering this file does for comments is safe on both halves.
const sectionRow = (o) => Object.assign({
  timestamp: '21-Aug-2026 14:03:11', irNumber: 'IR409', sectionId: 'sec-b',
  savedBy: 'ganesh@indrones.com', event: 'saved', fieldId: '', oldValue: '', newValue: '',
  source: 'section',
}, o);
const workflowRow = (o) => Object.assign({
  timestamp: '21-Aug-2026 15:00:00', irNumber: 'IR409', sectionId: '',
  savedBy: 'adhik@indrones.com', event: 'changed', fieldId: 'status', oldValue: 'Open', newValue: 'Production',
  source: 'workflow',
}, o);
const comment = (o) => Object.assign({
  irNumber: 'IR409', fieldId: 'b_remarks', message: 'Please re-check the ST number.',
  from: 'ravi@indrones.com', fromName: 'Ravi', createdAt: Date.parse('2026-08-21T09:30:00Z'),
}, o);

const kinds = tl => tl.map(x => x.kind).join(',');

// ── The timestamp parse ───────────────────────────────────────────────────────
r.head('the dd-MMM-yyyy timestamp parses deterministically');
// `'21-Aug-2026 14:03:11'` is NOT an ISO 8601 string, so per ECMA-262 Date.parse
// falls back to "implementation-specific heuristics" — other engines and other
// versions may return NaN, or parse it as a different day/month order. NaN is the
// dangerous case: it does not throw, it sorts as if every row happened at the same
// instant, and the timeline then looks plausible and is in the wrong order forever.
//
// This engine (Node 24 / V8) happens to parse it correctly, so the assertion below
// is NOT "Date.parse is broken here" — it is that the ordering contract must not
// DEPEND on that, and does not: the explicit parser resolves the shape itself and
// only falls back to Date.parse for anything it does not recognise.
const aug21 = new Date(2026, 7, 21, 14, 3, 11).getTime();
r.ok('the backend shape is not ISO, so Date.parse on it is implementation-defined',
  !/^\d{4}-\d{2}-\d{2}T/.test('21-Aug-2026 14:03:11'));
r.ok('this engine parses it by luck, which is exactly why the parser is explicit',
  Number.isFinite(Date.parse('21-Aug-2026 14:03:11')), Date.parse('21-Aug-2026 14:03:11'));
const parsedSrc = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .slice(fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').indexOf('function parseAuditTimestamp'));
r.ok('parseAuditTimestamp matches the shape itself before ever calling Date.parse',
  (() => {
    const body = parsedSrc.slice(0, parsedSrc.indexOf('\n}'));
    const regexAt = body.indexOf('exec(');
    const fallbackAt = body.indexOf('Date.parse');
    return regexAt > -1 && fallbackAt > -1 && regexAt < fallbackAt;
  })(), parsedSrc.slice(0, parsedSrc.indexOf('\n}')));
const parsed = T.parseAuditTimestamp('21-Aug-2026 14:03:11');
r.ok('the explicit parser returns a finite number', Number.isFinite(parsed), parsed);
r.ok('and it is the exact instant the string names',
  parsed === aug21, { got: parsed, want: aug21, asString: new Date(parsed).toString() });
r.ok('the day/month/year land where the string says',
  (() => { const d = new Date(parsed); return d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 21; })(),
  new Date(parsed).toString());
r.ok('the time of day does too',
  (() => { const d = new Date(parsed); return d.getHours() === 14 && d.getMinutes() === 3 && d.getSeconds() === 11; })(),
  new Date(parsed).toString());
r.ok('a second timestamp one minute later sorts after it',
  T.parseAuditTimestamp('21-Aug-2026 14:04:11') > T.parseAuditTimestamp('21-Aug-2026 14:03:11'));
r.ok('a January stamp is not treated as December',
  T.parseAuditTimestamp('05-Jan-2026 00:00:00') < T.parseAuditTimestamp('05-Feb-2026 00:00:00'));
r.ok('day 1 vs day 2 does not depend on a leading zero',
  T.parseAuditTimestamp('1-Aug-2026 00:00:00') < T.parseAuditTimestamp('02-Aug-2026 00:00:00'));
r.ok('a Date object passes through', T.parseAuditTimestamp(new Date(aug21)) === aug21);
r.ok('a number passes through', T.parseAuditTimestamp(aug21) === aug21);
r.ok('null/empty is 0, not NaN', T.parseAuditTimestamp(null) === 0 && T.parseAuditTimestamp('') === 0);
r.ok('nothing returns NaN for any plausible input',
  [null, '', 'garbage', '2026-08-21', '21-Aug-2026', 0, new Date(aug21)]
    .every(v => !Number.isNaN(T.parseAuditTimestamp(v))),
  [null, '', 'garbage', '2026-08-21', '21-Aug-2026', 0, new Date(aug21)].map(v => [v, T.parseAuditTimestamp(v)]));
r.ok('an unrecognised month name falls through rather than inventing a date',
  Number.isFinite(T.parseAuditTimestamp('21-Zzz-2026 00:00:00')) ||
  T.parseAuditTimestamp('21-Zzz-2026 00:00:00') === 0,
  T.parseAuditTimestamp('21-Zzz-2026 00:00:00'));
r.ok('the seconds-less shape still parses, since only ordering matters',
  Number.isFinite(T.parseAuditTimestamp('21-Aug-2026 14:03')), T.parseAuditTimestamp('21-Aug-2026 14:03'));

// ── Each event kind maps to its own kind ──────────────────────────────────────
r.head('each event the backend writes maps to one timeline kind');
r.ok('a section save', kinds(T.buildTimeline('IR409', [sectionRow({})], [])) === 'save');
r.ok('an added field',
  kinds(T.buildTimeline('IR409', [sectionRow({ event: 'added', fieldId: 'b_remarks', newValue: 'ok' })], [])) === 'add');
r.ok('a changed field',
  kinds(T.buildTimeline('IR409', [sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' })], [])) === 'edit');
r.ok('a removed field',
  kinds(T.buildTimeline('IR409', [sectionRow({ event: 'removed', fieldId: 'b_remarks', oldValue: 'a' })], [])) === 'remove');
r.ok('an uploaded file', kinds(T.buildTimeline('IR409', [sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'qc-report.pdf' })], [])) === 'upload');
r.ok('a status change', kinds(T.buildTimeline('IR409', [workflowRow({ fieldId: 'status' })], [])) === 'status');
r.ok('an assignment', kinds(T.buildTimeline('IR409', [workflowRow({ fieldId: 'assignee' })], [])) === 'assign');
r.ok('an assigneeName change is the same kind, not a second event',
  kinds(T.buildTimeline('IR409', [workflowRow({ fieldId: 'assigneeName' })], [])) === 'assign');
r.ok('a priority change', kinds(T.buildTimeline('IR409', [workflowRow({ fieldId: 'priority' })], [])) === 'priority');
r.ok('a category change', kinds(T.buildTimeline('IR409', [workflowRow({ fieldId: 'category' })], [])) === 'category');
// Sub-category and its note are SEPARATE kinds, not folded into `category`. A REPAIR
// moved from GPS to BATTERY leaves `category` at REPAIR, so the audit emits only the
// sub-category row — and rendering that as "Category changed: REPAIR → REPAIR" is a
// row that tells the reader nothing.
r.ok('a sub-category change is its own kind',
  kinds(T.buildTimeline('IR409', [workflowRow({ fieldId: 'subCategory' })], [])) === 'subcategory');
r.ok('...as is the OTHERS note',
  kinds(T.buildTimeline('IR409', [workflowRow({ fieldId: 'subCategoryNote' })], [])) === 'subcatnote');
r.ok('a comment', kinds(T.buildTimeline('IR409', [], [comment({})])) === 'comment');

r.head('workflow noise is not mistaken for a change');
// Every __IRS__ patch carries the whole store. A `saved` marker, a seed marker and
// the `items` array of a __NUDGES__ write all land in the workflow half, and none of
// them is a workflow CHANGE. If they were emitted the timeline would show a dozen
// meaningless rows around every triage.
r.ok('a non-status workflow field is dropped',
  T.buildTimeline('IR409', [workflowRow({ fieldId: 'items' })], []).length === 0);
r.ok('a blank workflow field is dropped',
  T.buildTimeline('IR409', [workflowRow({ fieldId: '' })], []).length === 0);
r.ok('a seed marker is dropped',
  T.buildTimeline('IR409', [workflowRow({ fieldId: 'seededFrom', event: 'added' })], []).length === 0);
// The retired `type` field. Every audit row already written about it is still on the
// sheet, and the first re-triage of each such IR adds a `removed: type` row. Nothing
// displays `type` any more, so a row about it describes a change with no visible
// effect — dropped, like the other noise.
r.ok('the retired `type` field is dropped too',
  T.buildTimeline('IR409', [workflowRow({ fieldId: 'type', event: 'removed', oldValue: 'Repair' })], []).length === 0);
r.ok('a non-marker `saved` row that names a field is not double-counted',
  T.buildTimeline('IR409', [sectionRow({ event: 'saved', fieldId: 'b_remarks' })], []).length === 0,
  T.buildTimeline('IR409', [sectionRow({ event: 'saved', fieldId: 'b_remarks' })], []));
r.ok('the bare saved marker IS shown',
  T.buildTimeline('IR409', [sectionRow({ event: 'saved', fieldId: '' })], []).length === 1);

r.head('done[] deltas are suppressed');
// Completion is implied by the section's own save row. Without the suppression each
// save emits a 500-char JSON array diff of the `done` list — the single largest
// source of audit noise, and it says nothing the save row does not.
r.ok('SUPPRESSED_AUDIT_FIELDS is exactly [done]',
  T.SUPPRESSED_AUDIT_FIELDS.join(',') === 'done', T.SUPPRESSED_AUDIT_FIELDS);
r.ok('a done[] change is suppressed in the section half',
  T.buildTimeline('IR409', [sectionRow({ event: 'changed', fieldId: 'done', oldValue: '["sec-b"]', newValue: '["sec-b","sec-c"]' })], []).length === 0);
r.ok('and in the workflow half, where the same key arrives via __IRS__',
  T.buildTimeline('IR409', [workflowRow({ fieldId: 'done' })], []).length === 0);
r.ok('but the suppression is by exact id — a similarly-named field survives',
  T.buildTimeline('IR409', [sectionRow({ event: 'changed', fieldId: 'b_doneBy', oldValue: 'a', newValue: 'b' })], []).length === 1);

// ── Uploads ───────────────────────────────────────────────────────────────────
r.head('an upload carries the file name, against the SOURCE field');
// The row's Field ID is the field the human picked a file for (`f_qcDocs`), never
// the derived `f_qcDocs_links`. That is what keeps `/_links$/` skipping from
// reintroducing the noise the audit log was just cleaned of.
r.head('the uploaded row');
const up = T.buildTimeline('IR409', [sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'qc-report.pdf' })], [])[0];
r.ok('the kind is upload', up.kind === 'upload', up.kind);
r.ok('the field id is the source field, not the _links key',
  up.fieldId === 'f_qcDocs', up.fieldId);
r.ok('the file name is the value', up.newValue === 'qc-report.pdf', up.newValue);
r.ok('and the section it belongs to is kept', up.sectionId === 'sec-b', up.sectionId);
r.ok('a workflow upload would not carry a section id', (() => {
  const w = T.buildTimeline('IR409', [workflowRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'x.pdf' })], [])[0];
  return w.kind === 'upload' && w.sectionId === '';
})(), T.buildTimeline('IR409', [workflowRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'x.pdf' })], [])[0]);

// ── Comments ──────────────────────────────────────────────────────────────────
r.head('comments merge in, and only for this IR');
r.ok('a comment for this IR is included', T.buildTimeline('IR409', [], [comment({})]).length === 1);
r.ok('a comment for a DIFFERENT IR is not',
  T.buildTimeline('IR409', [], [comment({ irNumber: 'IR410' })]).length === 0,
  T.buildTimeline('IR409', [], [comment({ irNumber: 'IR410' })]));
r.ok('a comment with no irNumber at all is not',
  T.buildTimeline('IR409', [], [comment({ irNumber: '' })]).length === 0);
const cm = T.buildTimeline('IR409', [], [comment({ mentions: ['ravi@indrones.com'] })])[0];
r.ok('the message rides along', cm.message === 'Please re-check the ST number.', cm.message);
r.ok('the mentions array rides along', cm.mentions.join(',') === 'ravi@indrones.com', cm.mentions);
r.ok('the author name is preferred over the address', cm.by === 'Ravi', cm.by);
r.ok('and the address is used when there is no name',
  T.buildTimeline('IR409', [], [comment({ fromName: '' })])[0].by === 'ravi@indrones.com');
r.ok('a comment anchors to its field',
  T.buildTimeline('IR409', [], [comment({ fieldId: 'c_notes' })])[0].fieldId === 'c_notes');
r.ok('createdAt (ms) is used as `at`, not a string parse',
  cm.at === comment({}).createdAt, cm.at);

// ── Ordering ──────────────────────────────────────────────────────────────────
r.head('mixed timestamps sort ascending, with the section/workflow tiebreak');
// One save writes a whole batch at ONE timestamp: the marker and every field row.
// Without a tiebreak the order within a batch is whatever Array.sort felt like, so
// the same ticket renders differently on two reloads.
const mixed = T.buildTimeline('IR409', [
  workflowRow({ timestamp: '21-Aug-2026 15:00:00', fieldId: 'status' }),
  sectionRow({ timestamp: '21-Aug-2026 14:03:11' }),
  workflowRow({ timestamp: '20-Aug-2026 09:00:00', fieldId: 'priority' }),
], [comment({ createdAt: T.parseAuditTimestamp('21-Aug-2026 12:00:00') })]);
r.ok('oldest first', kinds(mixed) === 'priority,comment,save,status', kinds(mixed));
r.ok('every entry has a finite `at`', mixed.every(x => Number.isFinite(x.at)), mixed.map(x => x.at));
r.ok('and they are non-decreasing', mixed.every((x, i) => i === 0 || mixed[i - 1].at <= x.at), mixed.map(x => x.at));
// The tiebreak, named: the section save row must come before the workflow row it
// triggered, because at the same instant the thing that happened is the edit.
r.head('same instant: section before workflow');
const tie = T.buildTimeline('IR409', [
  workflowRow({ timestamp: '21-Aug-2026 14:03:11', fieldId: 'status' }),
  sectionRow({ timestamp: '21-Aug-2026 14:03:11' }),
], []);
r.ok('section first, workflow second', kinds(tie) === 'save,status', kinds(tie));
r.ok('two workflow rows at the same instant both survive',
  T.buildTimeline('IR409', [
    workflowRow({ timestamp: '21-Aug-2026 14:03:11', fieldId: 'status' }),
    workflowRow({ timestamp: '21-Aug-2026 14:03:11', fieldId: 'priority' }),
  ], []).length === 2);

// ── Trimming ──────────────────────────────────────────────────────────────────
r.head('limit trims from the newest end');
const many = [];
for (let i = 1; i <= 10; i++) {
  many.push(sectionRow({ timestamp: '0' + (i % 9 + 1) + '-Aug-2026 10:00:0' + (i % 9), fieldId: 'b_remarks', event: 'changed', oldValue: 'v' + i, newValue: 'v' + (i + 1) }));
}
r.ok('no limit keeps everything', T.buildTimeline('IR409', many, []).length === 10);
r.ok('limit 3 keeps exactly 3', T.buildTimeline('IR409', many, [], 3).length === 3);
r.ok('and keeps the NEWEST 3, not the oldest', (() => {
  const got = T.buildTimeline('IR409', many, [], 3);
  const all = T.buildTimeline('IR409', many, []);
  return got[got.length - 1].newValue === all[all.length - 1].newValue;
})(), T.buildTimeline('IR409', many, [], 3).map(x => x.newValue));
r.ok('a limit larger than the list is a no-op', T.buildTimeline('IR409', many, [], 99).length === 10);
r.ok('limit 0 means everything, not nothing', T.buildTimeline('IR409', many, [], 0).length === 10);
r.ok('a negative or junk limit means everything too',
  T.buildTimeline('IR409', many, [], -5).length === 10 && T.buildTimeline('IR409', many, [], 'x').length === 10);
r.ok('the result is still oldest-first after trimming',
  T.buildTimeline('IR409', many, [], 3).every((x, i, a) => i === 0 || a[i - 1].at <= x.at));

// ── Nothing undefined leaks ───────────────────────────────────────────────────
r.head('a sparse row interpolates nothing undefined');
// These rows come from a spreadsheet where a blank cell is '' and an out-of-range
// column read is `undefined`. Either one rendered as the string "undefined" is a
// user-visible bug on a row nothing else would flag.
const sparse = T.buildTimeline('IR409', [
  { },                                                    // every column blank
  { timestamp: null, savedBy: null, event: 'changed', fieldId: null },
  sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: undefined, newValue: undefined }),
  workflowRow({ oldValue: undefined, newValue: undefined }),
], [comment({ message: undefined, mentions: undefined, createdAt: undefined })]);
r.ok('every entry still has a finite `at`', sparse.every(x => Number.isFinite(x.at)), sparse.map(x => x.at));
r.ok('no entry has an undefined kind', sparse.every(x => !!x.kind), sparse.map(x => x.kind));
r.ok('values are strings, never undefined',
  sparse.every(x => typeof x.oldValue === 'string' && typeof x.newValue === 'string'),
  sparse.map(x => [x.oldValue, x.newValue]));
r.ok('mentions is always an array', sparse.every(x => Array.isArray(x.mentions)), sparse.map(x => x.mentions));
r.ok('and nothing renders as the string "undefined"', (() => {
  const el = { innerHTML: '' };
  T.renderInto(el, sparse, {});
  return !/undefined|NaN/.test(el.innerHTML);
})(), (() => { const el = { innerHTML: '' }; T.renderInto(el, sparse, {}); return (el.innerHTML.match(/undefined|NaN/g) || []); })());

r.head('junk in, empty out — no throw');
r.ok('a null audit list is fine', T.buildTimeline('IR409', null, null).length === 0);
r.ok('a null entry is skipped', T.buildTimeline('IR409', [null, undefined], []).length === 0);
r.ok('a null comment is skipped', T.buildTimeline('IR409', [], [null]).length === 0);
r.ok('a non-array audit list is fine', T.buildTimeline('IR409', 'nope', []).length === 0);
r.ok('a missing irNumber matches nothing rather than everything',
  T.buildTimeline(undefined, [], [comment({})]).length === 0);

// ── The renderer ──────────────────────────────────────────────────────────────
r.head('the renderer paints both consumers from one function');
// The renderer consumes TIMELINE ENTRIES, not audit rows — so every call below goes
// through buildTimeline first. Passing a raw audit row here would render the
// "unknown kind" fallback and pass a test that proves nothing.
const built = (rows, comments) => T.buildTimeline('IR409', rows || [], comments || []);
const render = (tl, opts) => { const el = { innerHTML: '' }; T.renderInto(el, tl, opts); return el.innerHTML; };
r.ok('an empty timeline says so, with the caller\'s wording',
  /Nothing here yet/.test(render([], { emptyText: 'Nothing here yet.' })),
  render([], { emptyText: 'Nothing here yet.' }).slice(0, 160));
r.ok('and has a default wording for the other caller',
  /No activity yet/.test(render([], {})), render([], {}).slice(0, 160));
r.ok('a save row is labelled as a whole-section event, with no field chip repeating it',
  (() => {
    const h = render(built([sectionRow({})]), {});
    return /Section saved/.test(h) && h.indexOf('hist-field') < 0;
  })(), render(built([sectionRow({})]), {}).slice(0, 500));
r.ok('a field row is labelled with its human name, not its id',
  (() => {
    const h = render(built([sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' })]), {});
    return h.indexOf('b_remarks') < 0 && /Remarks/.test(h);
  })(), render(built([sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' })]), {}).slice(0, 400));
r.ok('a merged-section field id is labelled too — g_* resolves inside sec-f',
  (() => {
    const h = render(built([sectionRow({ sectionId: 'sec-f', event: 'changed', fieldId: 'g_basicReport', oldValue: 'a', newValue: 'b' })]), {});
    return h.indexOf('g_basicReport') < 0 && /Quality Test/.test(h);
  })(), render(built([sectionRow({ sectionId: 'sec-f', event: 'changed', fieldId: 'g_basicReport', oldValue: 'a', newValue: 'b' })]), {}).slice(0, 500));
r.ok('an upload row shows the file name and the source field name',
  (() => {
    const h = render(built([sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'qc-report.pdf' })]), {});
    return /qc-report\.pdf/.test(h) && /File uploaded/.test(h);
  })(), render(built([sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'qc-report.pdf' })]), {}).slice(0, 400));
r.ok('a triage row is chipped so it reads as a different kind of event',
  /hist-src">Triage/.test(render(built([workflowRow({})]), {})),
  render(built([workflowRow({})]), {}).slice(0, 600));
r.ok("the backend's internal store name is gone from what a user reads",
  !/workflow/i.test(render(built([workflowRow({})]), {})),
  render(built([workflowRow({})]), {}).slice(0, 600));
r.ok('a comment row is attributed to its author, never to a section',
  (() => {
    const h = render(built([], [comment({})]), {});
    return /hist-by">by Ravi</.test(h) && !/hist-by">by [^<]*·/.test(h);
  })(), render(built([], [comment({})]), {}).slice(0, 600));
r.ok('and it keeps the field chip, which is where its context comes from',
  /Remarks/.test(render(built([], [comment({})]), {})));
r.ok('a mention is chipped', /@mention/.test(render(built([], [comment({ mentions: ['x@y.com'] })]), {})));
r.ok('a pre-merge history row is labelled by its OLD letter, not the survivor',
  (() => {
    const h = render(built([sectionRow({ sectionId: 'sec-h', event: 'changed', fieldId: 'h_dispatchChecklist', oldValue: 'a', newValue: 'b' })]), {});
    return /PDI \(now part of G\)/.test(h);
  })(), render(built([sectionRow({ sectionId: 'sec-h', event: 'changed', fieldId: 'h_dispatchChecklist', oldValue: 'a', newValue: 'b' })]), {}).slice(0, 500));
r.ok('a long message is clipped, not dumped', (() => {
  const long = 'x'.repeat(900);
  const h = render(built([], [comment({ message: long })]), {});
  return h.indexOf(long) < 0 && h.length < 4000;
})());
r.ok('markup in a message is escaped, not executed',
  !/<script>/.test(render(built([], [comment({ message: '<script>alert(1)</script>' })]), {})));
r.ok('markup in a field value is escaped too',
  !/<script>/.test(render(built([sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: '<script>x</script>' })]), {})));
r.ok('the newest row renders first in the DOM (the builder stays oldest-first)',
  (() => {
    const h = render(built([
      workflowRow({ timestamp: '20-Aug-2026 09:00:00', fieldId: 'priority', newValue: 'Urgent' }),
      workflowRow({ timestamp: '21-Aug-2026 09:00:00', fieldId: 'status', newValue: 'Production' }),
    ]), {});
    return h.indexOf('Production') < h.indexOf('Urgent');
  })());
r.ok('a row with no timestamp still renders a time, from `at`',
  (() => {
    const h = render(built([], [comment({ createdAt: aug21 })]), {});
    return !/hist-time">\s*<\/span>/.test(h);
  })(), render(built([], [comment({ createdAt: aug21 })]), {}).slice(0, 300));
r.ok('a null element is a no-op, not a crash', (() => {
  try { T.renderInto(null, [], {}); return true; } catch (e) { return false; }
})());
r.ok('a non-array timeline renders the empty state, not a crash',
  /No activity yet/.test(render(null, {})), render(null, {}).slice(0, 160));

r.head('every kind has an icon and a label');
const missing = Object.keys(T.TIMELINE_KINDS).filter(k => !T.TIMELINE_KINDS[k].icon || !T.TIMELINE_KINDS[k].label);
// The count is pinned on purpose: a kind is a thing the reader sees, and one added
// without a thought about the wording is a row nobody can interpret. But the pin is
// a LIST, not a number, so the failure names what appeared or disappeared.
const KINDS = ['save','add','edit','remove','status','assign','priority',
               'category','subcategory','subcatnote','upload','comment',
               'archived','restored','revert'];
const actual = Object.keys(T.TIMELINE_KINDS).slice().sort();
r.ok('every kind the reader can see is complete, and none appeared unannounced',
  missing.length === 0 && actual.join(',') === KINDS.slice().sort().join(','),
  { missing, unexpected: actual.filter(k => KINDS.indexOf(k) < 0),
    gone: KINDS.filter(k => actual.indexOf(k) < 0) });
r.ok('and the builder only ever emits one of them', (() => {
  const everything = T.buildTimeline('IR409', [
    sectionRow({}), sectionRow({ event: 'added', fieldId: 'b_remarks', newValue: 'x' }),
    sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' }),
    sectionRow({ event: 'removed', fieldId: 'b_remarks', oldValue: 'a' }),
    sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'x.pdf' }),
    workflowRow({ fieldId: 'status' }), workflowRow({ fieldId: 'assignee' }),
    workflowRow({ fieldId: 'priority' }), workflowRow({ fieldId: 'category' }),
    workflowRow({ fieldId: 'subCategory' }), workflowRow({ fieldId: 'subCategoryNote' }),
  ], [comment({})]);
  return everything.length === 12 &&
    everything.every(x => !!T.TIMELINE_KINDS[x.kind]);
})(), T.buildTimeline('IR409', [
  sectionRow({}), sectionRow({ event: 'added', fieldId: 'b_remarks', newValue: 'x' }),
  sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' }),
  sectionRow({ event: 'removed', fieldId: 'b_remarks', oldValue: 'a' }),
  sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'x.pdf' }),
  workflowRow({ fieldId: 'status' }), workflowRow({ fieldId: 'assignee' }),
  workflowRow({ fieldId: 'priority' }), workflowRow({ fieldId: 'category' }),
  workflowRow({ fieldId: 'subCategory' }), workflowRow({ fieldId: 'subCategoryNote' }),
], [comment({})]).map(x => x.kind));

r.head('pre-merge history is labelled by what it was, not relabelled');
r.ok('a sec-a row reads as the Overview',
  T.sectionDisplayName('sec-a') === 'Overview (formerly Section A)', T.sectionDisplayName('sec-a'));
r.ok('a sec-h row keeps its old letter', /PDI/.test(T.sectionDisplayName('sec-h')), T.sectionDisplayName('sec-h'));
r.ok('a sec-i row keeps its old letter', /Dispatch/.test(T.sectionDisplayName('sec-i')), T.sectionDisplayName('sec-i'));
r.ok('a live section uses its current short name',
  T.sectionDisplayName('sec-f') === 'Quality Test Report', T.sectionDisplayName('sec-f'));
r.ok('an unknown id falls back to itself', T.sectionDisplayName('sec-zz') === 'sec-zz');
r.ok('and an empty id is empty, so no "(formerly" leaks into a comment row',
  T.sectionDisplayName('') === '');

r.head('every kind\'s icon comes from the one inline set');
// The app had no SVG at all before this: every icon was an emoji, which renders as
// a different picture on every OS. These assertions pin the three properties that
// make the replacement work offline and in both themes.
const svgs = Object.keys(T.TIMELINE_KINDS).map(k => T.iconSvg(T.TIMELINE_KINDS[k].icon));
r.ok('all ten icons render as inline SVG',
  svgs.every(s => /^<svg[\s\S]*<\/svg>$/.test(s)),
  svgs.map((s, i) => [Object.keys(T.TIMELINE_KINDS)[i], s.slice(0, 40)]));
r.ok('every icon inherits the themed text colour instead of hardcoding one',
  svgs.every(s => /stroke="currentColor"/.test(s)) && !/#[0-9a-fA-F]{3,8}/.test(svgs.join('')),
  svgs.join('').match(/#[0-9a-fA-F]{3,8}/g));
r.ok('no icon reaches for a network asset the offline shell would not have',
  !/https?:|xlink:href|<image|<use/.test(svgs.join('')));
r.ok('an unknown kind renders no icon rather than "undefined"',
  T.iconSvg('nope') === '' && T.iconSvg(undefined) === '' && T.iconSvg(null) === '');
r.ok('the set is one family — every icon on the same grid at one stroke weight',
  svgs.every(s => /viewBox="0 0 24 24"/.test(s) && /stroke-width="1.75"/.test(s)));
r.ok('the unknown-kind fallback resolves through the same set',
  /<svg/.test(T.iconSvg((T.TIMELINE_KINDS.zzz || { icon: 'dot' }).icon)));

r.head('the wording names the event the backend actually wrote');
// Two vocabularies for one event is the failure mode: the audit row says `changed`
// and the screen said "Edited", the store says `workflow` and the UI said
// "workflow". Each label below is the Triage modal's own noun for the same field.
r.ok('the backend verb `changed` is not relabelled "Edited"',
  T.TIMELINE_KINDS.edit.label === 'Changed', T.TIMELINE_KINDS.edit.label);
r.ok("the triage events reuse the Triage modal's own nouns",
  T.TIMELINE_KINDS.status.label === 'Status changed' &&
  T.TIMELINE_KINDS.assign.label === 'Assigned to' &&
  T.TIMELINE_KINDS.priority.label === 'Priority changed' &&
  T.TIMELINE_KINDS.category.label === 'Category changed' &&
  T.TIMELINE_KINDS.subcategory.label === 'Sub-category changed',
  ['status', 'assign', 'priority', 'category', 'subcategory'].map(k => T.TIMELINE_KINDS[k].label));
r.ok('no label still says "whole section" or "workflow"',
  !Object.values(T.TIMELINE_KINDS).some(k => /whole section|workflow/i.test(k.label)),
  Object.values(T.TIMELINE_KINDS).map(k => k.label));

r.head('one timestamp format for both halves of the list');
// The backend stamps `dd-MMM-yyyy HH:mm:ss`; comments carry epoch ms. Both used to
// be rendered as-is, so one newest-first list showed two formats interleaved and
// read as two different feeds. Timezone-safe either way: parseAuditTimestamp builds
// a LOCAL Date and toDisplayDateTime reads it back locally, so only the format
// changes, never the instant.
const auditRow   = render(built([sectionRow({})]), {});
const commentRow = render(built([], [comment({})]), {});
const timeOf = h => (h.match(/hist-time">([^<]*)/) || [])[1] || '';
r.ok('the audit row is formatted, not raw',
  /^\d{2} \w+ \d{4}, \d{2}:\d{2}$/.test(timeOf(auditRow)), timeOf(auditRow));
r.ok('the comment row uses the identical shape',
  /^\d{2} \w+ \d{4}, \d{2}:\d{2}$/.test(timeOf(commentRow)), timeOf(commentRow));
r.ok('the raw backend stamp never reaches the screen',
  !/\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2}/.test(auditRow), timeOf(auditRow));

r.head('old/new read as words');
const diffRow = render(built([sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' })]), {});
r.ok('the prefixes are Was / Now, not old: / new:',
  /hist-old">Was</.test(diffRow) && /hist-new">Now</.test(diffRow) &&
  !/\bold:/.test(diffRow) && !/\bnew:/.test(diffRow), diffRow.slice(0, 500));

// ── Putting an old value back ─────────────────────────────────────────────────
r.head('a restore is offered only where the row reproduces a value in full');
// THREE answers from restoreOfferFor, and the distinction is the point:
// "not a candidate" renders NOTHING (a sentence on every row would be noise on a
// field that has never been edited), while "a candidate that cannot be put back"
// renders the reason — the reader picked that row on purpose and deserves to know
// why it is inert.
const item = (o) => Object.assign({ kind: 'edit', fieldId: 'b_remarks', oldValue: 'old text' }, o);
r.ok('a plain field edit offers its old value',
  (() => { const o = T.restoreOfferFor(item()); return o && o.ok === true && o.value === 'old text'; })(),
  T.restoreOfferFor(item()));
r.ok('a removal offers the value that was removed',
  T.restoreOfferFor(item({ kind: 'remove' })).ok === true);
// A restore is itself restorable: putting back the value a restore replaced is
// exactly the same act, and refusing it would make the first restore final.
r.ok('a previous restore offers what it replaced',
  T.restoreOfferFor(item({ kind: 'revert' })).ok === true);
r.ok('the offer carries the OLD value, never the new one',
  T.restoreOfferFor(item({ oldValue: 'was', newValue: 'is' })).value === 'was');

// THE TRUNCATION RULE. snapValue caps an audited value at 500 characters plus a '…',
// silently and irreversibly — the full value is kept NOWHERE else, so writing that
// prefix back would corrupt the field with no error and nothing to compare against.
// It can only emit <=500 chars or exactly 501, so a length above 500 PROVES it.
const long = n => 'x'.repeat(n);
r.ok('a 500-character value is offered', T.restoreOfferFor(item({ oldValue: long(500) })).ok === true);
r.ok('a truncated 501-character value is NOT offered',
  T.restoreOfferFor(item({ oldValue: long(500) + '…' })).ok === false,
  T.restoreOfferFor(item({ oldValue: long(500) + '…' })));
r.ok('and it says why in words, rather than rendering nothing',
  /too long to be recorded in full/.test(T.restoreOfferFor(item({ oldValue: long(501) })).reason),
  T.restoreOfferFor(item({ oldValue: long(501) })).reason);
r.ok('the reason promises the value is still viewable',
  /can be viewed but not put back/.test(T.restoreOfferFor(item({ oldValue: long(501) })).reason));

r.head('rows that cannot be a restore at all offer nothing');
r.ok('no entry', T.restoreOfferFor(null) === null);
r.ok('no field', T.restoreOfferFor(item({ fieldId: '' })) === null);
// The backend writes `line('added', k, '', newJ)`, so an add row's old value is ''
// by construction — "put back" on it could only mean "clear this field", a delete
// wearing a restore's clothes.
r.ok('an ADD row — its old value is empty by construction',
  T.restoreOfferFor(item({ kind: 'add', oldValue: '' })) === null);
r.ok('a whole-section save row', T.restoreOfferFor(item({ kind: 'save', fieldId: '' })) === null);
r.ok('a comment row', T.restoreOfferFor(item({ kind: 'comment' })) === null);
r.ok('an upload — the Drive URL is deliberately not recorded, so it is not re-derivable',
  T.restoreOfferFor(item({ kind: 'upload' })) === null);
r.ok('an archive move — a folder position is not a field value',
  T.restoreOfferFor(item({ kind: 'archived' })) === null &&
  T.restoreOfferFor(item({ kind: 'restored' })) === null);
// The IR header (status / assignee / priority / category / sub-category) lives in a
// different store under a different key shape, governed by the separate Triage axis.
// It is out of scope BY CONSTRUCTION — none of its kinds is in the map — rather than
// by an extra rule that could be forgotten.
r.ok('every Triage kind offers nothing',
  ['status', 'assign', 'priority', 'category', 'subcategory', 'subcatnote']
    .every(k => T.restoreOfferFor(item({ kind: k })) === null),
  ['status', 'assign', 'priority', 'category', 'subcategory', 'subcatnote']
    .filter(k => T.restoreOfferFor(item({ kind: k })) !== null));
r.ok('and the restorable set is exactly the three value-bearing edits',
  Object.keys(T.RESTORABLE_KINDS).sort().join(',') === 'edit,remove,revert',
  Object.keys(T.RESTORABLE_KINDS));

r.head('`expectCurrent` is the newest value the SERVER reported, not the input on screen');
// Read from the audit rows rather than from the DOM, and that matters twice over:
// the input may hold an unsaved edit, and it may not be on screen at all by the time
// the button is pressed — the modal is mounted on the body and outlives a tab switch.
const tl = built([
  sectionRow({ event: 'added', fieldId: 'b_remarks', oldValue: '', newValue: 'first' }),
  sectionRow({ timestamp: '21-Aug-2026 14:10:00', event: 'changed', fieldId: 'b_remarks', oldValue: 'first', newValue: 'second' }),
  sectionRow({ timestamp: '21-Aug-2026 14:20:00', event: 'changed', fieldId: 'b_other', oldValue: 'x', newValue: 'y' }),
  sectionRow({ timestamp: '21-Aug-2026 14:30:00', event: 'changed', fieldId: 'b_remarks', oldValue: 'second', newValue: 'third' }),
], [comment({ fieldId: 'b_remarks', message: 'looks wrong', createdAt: Date.parse('2026-08-21T10:00:00Z') })]);
r.ok('the newest row for the field wins', T.fieldCurrentFrom(tl, 'b_remarks') === 'third',
  T.fieldCurrentFrom(tl, 'b_remarks'));
r.ok('a sibling field is not confused with it', T.fieldCurrentFrom(tl, 'b_other') === 'y');
r.ok('a field with no history answers empty, not undefined',
  T.fieldCurrentFrom(tl, 'b_nothing') === '');
r.ok('no field id at all answers empty', T.fieldCurrentFrom(tl, '') === '');
r.ok('a comment row cannot become the current value',
  T.fieldCurrentFrom(tl, 'b_remarks') !== 'looks wrong', T.fieldCurrentFrom(tl, 'b_remarks'));
// A `removed` row's new value is '' — the field was cleared — so it must BE the
// current value, or a restore would think the field still holds the deleted text.
const removed = built([
  sectionRow({ event: 'added', fieldId: 'b_x', oldValue: '', newValue: 'text' }),
  sectionRow({ timestamp: '21-Aug-2026 14:40:00', event: 'removed', fieldId: 'b_x', oldValue: 'text', newValue: '' }),
]);
r.ok('a removal makes the current value empty',
  T.fieldCurrentFrom(removed, 'b_x') === '', JSON.stringify(T.fieldCurrentFrom(removed, 'b_x')));
r.ok('and the removal row is still offered as a restore',
  T.restoreOfferFor(removed[removed.length - 1]).ok === true);
r.ok('the value-bearing kinds are exactly the four that write a value',
  Object.keys(T.VALUE_BEARING_KINDS).sort().join(',') === 'add,edit,remove,revert',
  Object.keys(T.VALUE_BEARING_KINDS));

r.head('the restore control is rendered for the field view and nowhere else');
// `o.restore` is supplied only by the field-history modal. The ticket-level view and
// the Overview's inline timeline mix every field together and have no single field to
// put a value back into, so they must render NO control rather than a dead one.
const el0 = () => ({ innerHTML: '', querySelectorAll: () => [] });
const renderR = (t, opts) => { const el = el0(); T.renderInto(el, t, opts); return el.innerHTML; };
const editable = built([
  sectionRow({ event: 'added', fieldId: 'b_remarks', oldValue: '', newValue: 'first' }),
  sectionRow({ timestamp: '21-Aug-2026 14:10:00', event: 'changed', fieldId: 'b_remarks', oldValue: 'first', newValue: 'second' }),
]);
const fieldView = { irNumber: 'IR409', sectionId: 'sec-b', fieldId: 'b_remarks', timeline: editable };
r.ok('the ticket-level view renders no restore button even on a restorable row',
  (renderR(editable, {}) + renderR(editable, { emptyText: 'x' })).indexOf('hist-restore') < 0,
  renderR(editable, {}).slice(0, 300));
const fh = renderR(editable, { restore: fieldView });
r.ok('the field view renders the button on the restorable row',
  /class="hist-restore-btn"/.test(fh), fh.slice(0, 600));
r.ok('the button names the value it would put back',
  /Put back first/.test(fh), (fh.match(/hist-restore-btn[^<]*/) || [''])[0]);
r.ok('the button carries an INDEX, not the value — a 500-character value cannot go in an attribute',
  /data-hist-i="\d+"/.test(fh) && !/data-hist-val/.test(fh),
  (fh.match(/hist-restore-btn[^>]*/) || [''])[0]);

// THE INDEX IS INTO THE CALLER'S OWN ARRAY, which is oldest-first, while the list is
// rendered newest-first. Off by the reversal, the button puts back the WRONG row's
// value — silently, and on the one screen built for recovering from mistakes.
r.ok('the index is the entry\'s position in the caller\'s OLDEST-FIRST timeline',
  (() => {
    const ids = [...fh.matchAll(/data-hist-i="(\d+)"/g)].map(m => Number(m[1]));
    return ids.length === 1 && ids[0] === 1;
  })(), (fh.match(/data-hist-i="\d+"/g) || []));
r.ok('and the newest row is the one displayed FIRST',
  fh.indexOf('Put back first') < fh.indexOf('Now second') || !/Now second/.test(fh),
  fh.slice(0, 600));

r.head('the row that cannot be put back says so, and the add row says nothing');
const mixRows = built([
  sectionRow({ event: 'added', fieldId: 'b_remarks', oldValue: '', newValue: 'first' }),
  sectionRow({ timestamp: '21-Aug-2026 14:10:00', event: 'changed', fieldId: 'b_remarks', oldValue: long(501), newValue: 'second' }),
  sectionRow({ timestamp: '21-Aug-2026 14:20:00', event: 'uploaded', fieldId: 'b_remarks', oldValue: '', newValue: 'qc-1.pdf' }),
]);
const mh = renderR(mixRows, { restore: { irNumber: 'IR409', sectionId: 'sec-b', fieldId: 'b_remarks', timeline: mixRows } });
r.ok('a truncated value renders a NOTE, never a button',
  /hist-restore-note/.test(mh) && !/hist-restore-btn/.test(mh),
  (mh.match(/hist-restore-note[\s\S]{0,120}/) || [''])[0]);
r.ok('the note explains itself instead of being a silent gap',
  /too long to be recorded in full/.test(mh));
r.ok('the upload row renders NOTHING at all — not even a note',
  (mh.match(/hist-restore-row/g) || []).length === 1,
  (mh.match(/hist-restore-row/g) || []).length);
r.ok('the add row renders nothing either, so "clear this field" is never offered',
  !/Put back /.test(mh), (mh.match(/Put back [^<]*/g) || []));
r.ok('the upload is still SHOWN — it is viewable, only not restorable',
  /qc-1\.pdf/.test(mh));

// The value goes into the button's own label and into `confirm()` verbatim, so it is
// an interpolation of stored data on a screen any signed-in user can open.
r.head('a stored value cannot inject markup through the restore control');
const evil = built([sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: '<img src=x onerror=alert(1)>', newValue: 'clean' })]);
const eh = renderR(evil, { restore: { irNumber: 'IR409', sectionId: 'sec-b', fieldId: 'b_remarks', timeline: evil } });
r.ok('the value is escaped in the button label',
  !/<img src=x/.test(eh) && /&lt;img src=x/.test(eh),
  (eh.match(/hist-restore-btn[\s\S]{0,160}/) || [''])[0]);

r.finish();
