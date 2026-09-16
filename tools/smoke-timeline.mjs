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
  renderTimelineInto, sectionDisplayName,
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
r.ok('a type change', kinds(T.buildTimeline('IR409', [workflowRow({ fieldId: 'type' })], [])) === 'type');
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
r.ok('a save row names the whole section rather than a field',
  /whole section/.test(render(built([sectionRow({})]), {})),
  render(built([sectionRow({})]), {}).slice(0, 300));
r.ok('a field row is labelled with its human name, not its id',
  (() => {
    const h = render(built([sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' })]), {});
    return h.indexOf('b_remarks') < 0 && /Remarks/.test(h);
  })(), render(built([sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' })]), {}).slice(0, 400));
r.ok('a merged-section field id is labelled too — g_* resolves inside sec-f',
  (() => {
    const h = render(built([sectionRow({ sectionId: 'sec-f', event: 'changed', fieldId: 'g_missionReport', oldValue: 'a', newValue: 'b' })]), {});
    return h.indexOf('g_missionReport') < 0 && /Quality Test/.test(h);
  })(), render(built([sectionRow({ sectionId: 'sec-f', event: 'changed', fieldId: 'g_missionReport', oldValue: 'a', newValue: 'b' })]), {}).slice(0, 500));
r.ok('an upload row shows the file name and the source field name',
  (() => {
    const h = render(built([sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'qc-report.pdf' })]), {});
    return /qc-report\.pdf/.test(h) && /File uploaded/.test(h);
  })(), render(built([sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'qc-report.pdf' })]), {}).slice(0, 400));
r.ok('a workflow row is chipped so it reads as a different kind of event',
  /hist-src">workflow/.test(render(built([workflowRow({})]), {})),
  render(built([workflowRow({})]), {}).slice(0, 400));
r.ok('a comment row is placed under "comment", not under a section',
  /· comment/.test(render(built([], [comment({})]), {})),
  render(built([], [comment({})]), {}).slice(0, 400));
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
r.ok('all ten kinds are complete', missing.length === 0 && Object.keys(T.TIMELINE_KINDS).length === 10,
  { missing, count: Object.keys(T.TIMELINE_KINDS).length });
r.ok('and the builder only ever emits one of them', (() => {
  const everything = T.buildTimeline('IR409', [
    sectionRow({}), sectionRow({ event: 'added', fieldId: 'b_remarks', newValue: 'x' }),
    sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' }),
    sectionRow({ event: 'removed', fieldId: 'b_remarks', oldValue: 'a' }),
    sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'x.pdf' }),
    workflowRow({ fieldId: 'status' }), workflowRow({ fieldId: 'assignee' }),
    workflowRow({ fieldId: 'priority' }), workflowRow({ fieldId: 'type' }),
  ], [comment({})]);
  return everything.length === 10 &&
    everything.every(x => !!T.TIMELINE_KINDS[x.kind]);
})(), T.buildTimeline('IR409', [
  sectionRow({}), sectionRow({ event: 'added', fieldId: 'b_remarks', newValue: 'x' }),
  sectionRow({ event: 'changed', fieldId: 'b_remarks', oldValue: 'a', newValue: 'b' }),
  sectionRow({ event: 'removed', fieldId: 'b_remarks', oldValue: 'a' }),
  sectionRow({ event: 'uploaded', fieldId: 'f_qcDocs', newValue: 'x.pdf' }),
  workflowRow({ fieldId: 'status' }), workflowRow({ fieldId: 'assignee' }),
  workflowRow({ fieldId: 'priority' }), workflowRow({ fieldId: 'type' }),
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

r.finish();
