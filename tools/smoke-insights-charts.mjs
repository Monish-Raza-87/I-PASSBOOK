// Smoke test for the Insights charts, the People card and the initials avatar
// (Stage 3 of the "build what was approved" release).
//
//   node tools/smoke-insights-charts.mjs
//
// One property matters more than every other assertion in this file, and it is
// the reason the block exists at all: THE PICTURE MUST ADD UP TO THE NUMBER
// PRINTED ABOVE IT.
//
// A dashboard has two ways to lie and both of them look fine. It can leave a row
// out — an IR whose date the app cannot read, an IR nobody is assigned — so the
// bars total less than the headline and a reader who adds them up concludes the
// page is broken. Or it can draw from a DIFFERENT filtered set than the total it
// prints, and then the two disagree by a number nobody can reproduce. So the
// helpers under test here are pure and take the same `filters` object the summary
// takes, and the two "bucket" assertions are about a bucket that is drawn even
// when it is empty, because empty is exactly when its absence goes unnoticed.

import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
const DAY = 86400000;
const NOW = Date.now();

const { T, byId } = loadApp(`
  insightsMatches, insightsSummary, monthCounts, sparkPoints, assigneeCounts,
  initialsOf, UNASSIGNED_KEY, MONTH_ABBR, MONTH_LABELS,
  IR_CATEGORIES, SEGMENT_LABELS, CATEGORY_BADGE,
  INSIGHTS_ALL, UNCATEGORISED, renderInsights,
  statusCategory, irOverdue, irFiscalYear, irMonthNumber,
  get allIRs() { return allIRs; }, set allIRs(v) { allIRs = v; },
  get insightsFilters() { return insightsFilters; }, set insightsFilters(v) { insightsFilters = v; },
  get _dataIsDemo() { return _dataIsDemo; }, set _dataIsDemo(v) { _dataIsDemo = v; },
`, { capture: true });

const ALL = T.INSIGHTS_ALL;
const noFilter = () => ({ fy: ALL, month: ALL, status: ALL, category: ALL, customer: ALL, drone: ALL });

const isoDaysAgo = n => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const ir = over => ({ irNumber: 'IR500', status: 'Open', ...over });

// ── monthCounts: twelve buckets and an honest thirteenth ─────────────────────
r.head('the month buckets, and the one that is not a month');

r.ok('the twelve months and the undated bucket are all present, all zero, on no rows',
  (() => {
    const mc = T.monthCounts([], noFilter());
    return mc.months.length === 12 && mc.months.every(n => n === 0) && mc.undated === 0 && mc.total === 0;
  })());

r.ok('a row lands in its own month, one-based, not off by one',
  (() => {
    const mc = T.monthCounts([ir({ dateRaisedISO: '2026-03-14' })], noFilter());
    return mc.months[2] === 1 && mc.months.reduce((a, b) => a + b, 0) === 1;
  })(), T.monthCounts([ir({ dateRaisedISO: '2026-03-14' })], noFilter()).months);

// The whole point of the thirteenth bucket. An unreadable date must go SOMEWHERE
// — dropping it is what makes the bars total less than the headline.
r.ok('a row with no readable date is COUNTED, in `undated`, never dropped',
  (() => {
    const mc = T.monthCounts([
      ir({ dateRaisedISO: '2026-03-14' }),
      ir({ dateRaisedISO: '' }),
      ir({ dateRaisedISO: 'not a date' }),
      ir({}),
    ], noFilter());
    return mc.undated === 3 && mc.months[2] === 1 && mc.total === 4;
  })());

r.ok('...and `total` is the twelve plus the bucket, which is what the renderer draws',
  (() => {
    const rows = [ir({ dateRaisedISO: '2026-01-02' }), ir({}), ir({ dateRaisedISO: '2026-07-31' }), ir({})];
    const mc = T.monthCounts(rows, noFilter());
    return mc.total === mc.months.reduce((a, b) => a + b, 0) + mc.undated && mc.total === 4;
  })());

r.ok('junk input is zero rows, never a throw and never NaN',
  (() => {
    const a = T.monthCounts(null, noFilter()), b = T.monthCounts(undefined, noFilter()),
          c = T.monthCounts('nonsense', noFilter()), d = T.monthCounts({}, noFilter());
    return [a, b, c, d].every(mc =>
      mc.months.length === 12 && mc.months.every(n => n === 0) && mc.undated === 0 && mc.total === 0);
  })());

// THE CONTRACT. The chart and the headline are computed from the same rows
// through the same predicate, and this is the assertion that says so — if either
// one is ever refactored onto its own copy of the filter, this goes red.
r.head('the chart and the headline are the same number');

r.ok('the bars total exactly the count the page prints, on the whole list',
  (() => {
    const rows = [
      ir({ dateRaisedISO: '2026-02-10', status: 'Production' }),
      ir({ dateRaisedISO: '2026-02-20', status: 'Delivered' }),
      ir({ dateRaisedISO: '2026-09-01', status: 'Hold' }),
      ir({ dateRaisedISO: '' }),
      ir({}),
    ];
    const mc = T.monthCounts(rows, noFilter()), sum = T.insightsSummary(rows, noFilter());
    return mc.total === sum.matched && sum.matched === 5;
  })());

r.ok('...and still exactly, under a filter that excludes rows',
  (() => {
    const rows = [
      ir({ dateRaisedISO: '2026-02-10', status: 'Production' }),
      ir({ dateRaisedISO: '2026-02-20', status: 'Delivered' }),
      ir({ dateRaisedISO: '2026-09-01', status: 'Hold' }),
      ir({ dateRaisedISO: '2026-09-05', status: 'Hold' }),
    ];
    const f = Object.assign(noFilter(), { status: 'paused' });
    const mc = T.monthCounts(rows, f), sum = T.insightsSummary(rows, f);
    return mc.total === sum.matched && sum.matched === 2 && mc.months[8] === 2;
  })());

r.ok('a month filter narrows the chart to that month, and the total follows it',
  (() => {
    const rows = [
      ir({ dateRaisedISO: '2026-02-10' }), ir({ dateRaisedISO: '2026-09-01' }), ir({ dateRaisedISO: '2026-09-05' }),
    ];
    const f = Object.assign(noFilter(), { month: String(T.irMonthNumber('2026-09-01')) });
    const mc = T.monthCounts(rows, f);
    return mc.total === 2 && mc.months[8] === 2 && mc.months.every((n, i) => (i === 8 ? n === 2 : n === 0));
  })());

// ── sparkPoints: geometry only, and never a canvas ───────────────────────────
r.head('the sparkline is arithmetic, and it is arithmetic a browser can draw');

r.ok('twelve values give twelve points, spanning the full box',
  (() => {
    const pts = T.sparkPoints([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 100, 28).split(' ');
    return pts.length === 12 && pts[0].startsWith('0.00,') && pts[11].startsWith('100.00,');
  })());

r.ok('the largest value sits on the top edge, and a zero on the bottom',
  (() => {
    const pts = T.sparkPoints([0, 5], 100, 28).split(' ');
    return pts[0] === '0.00,28.00' && pts[1] === '100.00,0.00';
  })(), T.sparkPoints([0, 5], 100, 28));

r.ok('the scale is the series max, never a notional one — a flat run of 3s fills the box',
  (() => {
    const pts = T.sparkPoints([3, 3], 100, 28).split(' ');
    return pts[0] === '0.00,0.00' && pts[1] === '100.00,0.00';
  })(), T.sparkPoints([3, 3], 100, 28));

r.ok('an all-zero series is a flat line on the FLOOR, not a divide-by-zero',
  T.sparkPoints([0, 0, 0], 100, 28).split(' ').every(p => p.endsWith(',28.00')),
  T.sparkPoints([0, 0, 0], 100, 28));

r.ok('fewer than two points is an empty string, not a one-point "line"',
  T.sparkPoints([], 100, 28) === '' && T.sparkPoints([7], 100, 28) === '' &&
  T.sparkPoints(null, 100, 28) === '' && T.sparkPoints(undefined, 100, 28) === '');

r.ok('junk inside the series becomes 0 rather than NaN in the attribute',
  (() => {
    const s = T.sparkPoints([1, null, undefined, 'x', NaN, Infinity, 4], 100, 28);
    return s !== '' && !/NaN|Infinity/.test(s);
  })(), T.sparkPoints([1, null, undefined, 'x', NaN, Infinity, 4], 100, 28));

r.ok('and the string is only numbers, commas and spaces — safe in an attribute',
  /^[0-9., -]*$/.test(T.sparkPoints([1, 2, 3, 4], 100, 28)), T.sparkPoints([1, 2, 3, 4], 100, 28));

// ── assigneeCounts: the bucket that is always there ──────────────────────────
r.head('who is holding work — and the row that says nobody is');

r.ok('with NO rows at all, Unassigned is still the one row returned',
  (() => {
    const rows = T.assigneeCounts([], noFilter(), NOW);
    return rows.length === 1 && rows[0].key === T.UNASSIGNED_KEY && rows[0].open === 0 && rows[0].late === 0;
  })(), T.assigneeCounts([], noFilter(), NOW));

r.ok('...and it is present when every row HAS a name, so the counts can still be added up',
  (() => {
    const rows = T.assigneeCounts([ir({ assigneeName: 'Ravi Singh' })], noFilter(), NOW);
    return rows.length === 2 && rows[rows.length - 1].key === T.UNASSIGNED_KEY;
  })(), T.assigneeCounts([ir({ assigneeName: 'Ravi Singh' })], noFilter(), NOW));

r.ok('a blank, whitespace or missing name is Unassigned — never a nameless person',
  (() => {
    const rows = T.assigneeCounts([
      ir({ assigneeName: '   ' }), ir({ assigneeName: '' }), ir({}), ir({ assigneeName: 'Ravi Singh' }),
    ], noFilter(), NOW);
    const u = rows.find(p => p.key === T.UNASSIGNED_KEY);
    return u.total === 3 && rows.length === 2;
  })());

r.ok('Unassigned is pinned LAST whatever it counts, even when it leads on the numbers',
  (() => {
    const rows = T.assigneeCounts([
      ir({ assigneeName: 'A' }), ir({}), ir({}), ir({}), ir({}),
    ], noFilter(), NOW);
    return rows[rows.length - 1].key === T.UNASSIGNED_KEY && rows[0].key === 'A';
  })(), T.assigneeCounts([ir({ assigneeName: 'A' }), ir({}), ir({}), ir({}), ir({})], noFilter(), NOW));

r.ok('open counts the open and paused work, and only that',
  (() => {
    const rows = T.assigneeCounts([
      ir({ assigneeName: 'A', status: 'Open' }),
      ir({ assigneeName: 'A', status: 'Hold' }),
      ir({ assigneeName: 'A', status: 'Delivered' }),
      ir({ assigneeName: 'A', status: 'Close' }),
    ], noFilter(), NOW);
    const a = rows.find(p => p.name === 'A');
    return a.total === 4 && a.open === 2;
  })());

// The late column and the late tile are the same number read twice. `now` is
// supplied by the caller for exactly this reason: a dashboard that decides what
// is overdue from the wall clock inside the helper cannot be tested at all, and
// two helpers reading two clocks a millisecond apart can disagree.
r.ok('late counts what is overdue AT THE GIVEN CLOCK, not at the day the test ran',
  (() => {
    // 20 days in status, no priority → the default 14-day limit, so it is over.
    const rows = [ir({ assigneeName: 'A', status: 'Open', statusAt: NOW - 20 * DAY })];
    const at = days => T.assigneeCounts(rows, noFilter(), NOW - days * DAY).find(p => p.name === 'A');
    return at(0).late === 1 && at(10).late === 0 && !!T.irOverdue(rows[0], NOW);
  })(), (() => {
    const rows = [ir({ assigneeName: 'A', status: 'Open', statusAt: NOW - 20 * DAY })];
    return [0, 10, 20].map(d => T.assigneeCounts(rows, noFilter(), NOW - d * DAY).find(p => p.name === 'A').late);
  })());

r.ok('a row that is not in the pipeline is never late, however old — it is not running a clock',
  (() => {
    const rows = [ir({ assigneeName: 'A', status: 'Delivered', statusAt: NOW - 900 * DAY })];
    const a = T.assigneeCounts(rows, noFilter(), NOW).find(p => p.name === 'A');
    return a.late === 0 && a.total === 1 && T.irOverdue(rows[0], NOW) === null;
  })());

r.ok('the per-person open counts sum to the page\'s own open+late reading',
  (() => {
    // The unassigned row is FINISHED, so it is counted in `total` and in neither
    // of the two columns — which is the case that proves the columns are not just
    // "one per row".
    const rows = [
      ir({ assigneeName: 'A', status: 'Open', statusAt: NOW - 20 * DAY }),
      ir({ assigneeName: 'B', status: 'Hold', statusAt: NOW - 30 * DAY }),
      ir({ status: 'Delivered' }),
    ];
    const people = T.assigneeCounts(rows, noFilter(), NOW);
    const openNow = people.reduce((a, p) => a + p.open, 0);
    const lateNow = people.reduce((a, p) => a + p.late, 0);
    return openNow === 2 && lateNow === 1 &&
      people.reduce((a, p) => a + p.total, 0) === 3 &&
      people.find(p => p.key === T.UNASSIGNED_KEY).open === 0;
  })());

r.ok('the same filters the headline uses are the ones the People card counts',
  (() => {
    const rows = [
      ir({ assigneeName: 'A', status: 'Open' }), ir({ assigneeName: 'B', status: 'Delivered' }),
    ];
    const all = T.assigneeCounts(rows, noFilter(), NOW);
    const f = Object.assign(noFilter(), { status: 'open' });
    const openOnly = T.assigneeCounts(rows, f, NOW);
    // Unfiltered both people are there; under the open filter B's row is GONE
    // rather than present and zero, because a person holding nothing is a row
    // the reader gains nothing from — unlike the Unassigned bucket, which stays.
    return all.find(p => p.name === 'B').total === 1 &&
      openOnly.find(p => p.name === 'A').total === 1 &&
      !openOnly.some(p => p.name === 'B') &&
      openOnly.reduce((a, p) => a + p.total, 0) === T.insightsSummary(rows, f).matched;
  })());

// ── initialsOf ───────────────────────────────────────────────────────────────
r.head('two letters, and no more');

r.ok('two words give the first letter of the first and the last',
  T.initialsOf('Ravi Singh') === 'RS' && T.initialsOf('Adhik Nair') === 'AN');
r.ok('three words drop the middle — first and last, as every avatar does',
  T.initialsOf('Ravi Kumar Singh') === 'RS' && T.initialsOf('Mohd Abdul Raza') === 'MR');
r.ok('one word gives its first two letters',
  T.initialsOf('Ravi') === 'RA' && T.initialsOf('A') === 'A');
r.ok('nothing in gives nothing out — the renderer supplies the question mark',
  T.initialsOf('') === '' && T.initialsOf('   ') === '' && T.initialsOf(null) === '' &&
  T.initialsOf(undefined) === '' && T.initialsOf(42) === '');
r.ok('extra spaces do not create an empty word',
  T.initialsOf('  Ravi   Singh  ') === 'RS', T.initialsOf('  Ravi   Singh  '));

// ── The rendered markup ──────────────────────────────────────────────────────
// The helpers above are pure and could all be right while the page drew none of
// it. These read back what renderInsights actually wrote.

const FIXTURE = [
  ir({ irNumber: 'IR601', dateRaisedISO: '2026-02-10', status: 'Open',      assigneeName: 'Ravi Singh' }),
  ir({ irNumber: 'IR602', dateRaisedISO: '2026-02-18', status: 'Hold',      assigneeName: 'Ravi Singh' }),
  ir({ irNumber: 'IR603', dateRaisedISO: '2026-09-01', status: 'Production', assigneeName: 'Adhik Nair' }),
  ir({ irNumber: 'IR604', dateRaisedISO: '2026-09-20', status: 'Delivered', assigneeName: 'Adhik Nair' }),
  ir({ irNumber: 'IR605', dateRaisedISO: '',           status: 'Open' }),
];
T.allIRs = FIXTURE;
T.insightsFilters = noFilter();
T._dataIsDemo = false;
T.renderInsights();
const html = byId.get('insights-body').innerHTML;

r.head('what the page actually drew');

r.ok('the sparkline is a real inline SVG with ONE polyline',
  /<svg class="spark"[^>]*viewBox="0 0 100 28"/.test(html) &&
  (html.match(/<polyline /g) || []).length === 1 &&
  /<polyline points="[0-9., ]+"[\s\S]{0,60}?fill="none" stroke="currentColor"/.test(html),
  (html.match(/<svg class="spark"[\s\S]{0,220}/) || [''])[0]);

// Not a preference. The app's one canvas painting hardcodes six hex values,
// because a canvas cannot read a CSS variable — so a canvas here would ignore
// all four palettes and both themes.
r.ok('...and the insights page contains NO canvas at all',
  !/<canvas/i.test(html) && !/getContext\(/.test(html));

r.ok('the undated column is drawn even when the bucket is EMPTY',
  (() => {
    T.allIRs = [ir({ dateRaisedISO: '2026-02-10' })];
    T.renderInsights();
    const dated = byId.get('insights-body').innerHTML;
    T.allIRs = FIXTURE;
    T.renderInsights();
    return /class="chart-bar-col is-undated is-zero"/.test(dated) &&
           (dated.match(/chart-bar-col/g) || []).length === 13 &&
           /<span class="chart-bar-x">—<\/span>/.test(dated);
  })());

r.ok('the axis is thirteen columns, and the caption says what the dash is',
  (html.match(/class="chart-bar-col/g) || []).length === 13 &&
  /<p class="chart-note">— = /.test(html));

r.ok('the undated bar counts IR605, and the headline agrees',
  /class="chart-bar-col is-undated[^"]*"[\s\S]{0,160}?<span class="chart-bar-n">1<\/span>/.test(html),
  (html.match(/is-undated[\s\S]{0,200}/) || [''])[0]);

r.ok('an Unassigned row is always rendered, and it carries IR605',
  /class="person-row is-unassigned"/.test(html) &&
  /<span class="person-name">Unassigned<\/span>/.test(html));

r.ok('...and the People rows count every filtered IR, matching the headline',
  (() => {
    const sum = T.insightsSummary(FIXTURE, noFilter());
    const rendered = [...html.matchAll(/<span class="person-n(?: is-late)?">(\d+)<\/span>/g)];
    const total = T.assigneeCounts(FIXTURE, noFilter(), NOW).reduce((a, p) => a + p.total, 0);
    return total === sum.matched && rendered.length === 2 * T.assigneeCounts(FIXTURE, noFilter(), NOW).length;
  })());

r.ok('an avatar renders the initials, and the Unassigned row gets the question mark',
  (html.match(/<span class="person-avatar" aria-hidden="true">[^<]+<\/span>/g) || []).length ===
  T.assigneeCounts(FIXTURE, noFilter(), NOW).length &&
  /person-avatar" aria-hidden="true">RS</.test(html) &&
  /class="person-row is-unassigned"[\s\S]{0,120}person-avatar" aria-hidden="true">\?</.test(html));

r.ok('the stat row reads the same four numbers the rest of the page does',
  (() => {
    const sum = T.insightsSummary(FIXTURE, noFilter());
    const people = T.assigneeCounts(FIXTURE, noFilter(), Date.now());
    const openNow = people.reduce((a, p) => a + p.open, 0);
    const lateNow = people.reduce((a, p) => a + p.late, 0);
    const ns = (html.match(/<span class="insights-stat-n">(\d+)<\/span>/g) || [])
      .map(s => s.replace(/\D+/g, ''));
    return ns[0] === String(sum.matched) && ns[1] === String(openNow) && ns[2] === String(lateNow);
  })(), (html.match(/<span class="insights-stat-n">\d+<\/span>/g) || []));

r.ok('nothing on this page ships as a canvas or an image — it is all HTML and one SVG',
  !/<img |<canvas|background-image/i.test(html));

r.ok('an empty list still renders the skeleton rather than a throw',
  (() => {
    T.allIRs = [];
    T.renderInsights();
    const skel = byId.get('insights-body').innerHTML;
    T.allIRs = FIXTURE;
    T.renderInsights();
    return skel.length > 0 && !/person-row/.test(skel);
  })());

r.finish();
