// Smoke test for the Insights dashboard and the IR list's Category filter.
//
//   node tools/smoke-insights.mjs
//
// Two things are being pinned here, and both of them fail SILENTLY in production:
//
//   1. The fiscal-year arithmetic. An FY runs 1 April – 31 March and is named by
//      the year it starts in, so 2026-03-31 belongs to FY 2025-26 and 2026-04-01
//      to FY 2026-27. Get the boundary wrong and every April/May report is
//      quietly off by a year — no error, no blank cell, just wrong numbers.
//   2. The buckets for rows the dashboard cannot place: an IR with no readable
//      ISO date, and an IR CR has not categorised yet. Both must be COUNTED and
//      named. Dropping them makes the categories sum to less than the total with
//      nothing on screen to explain the gap; folding them into a real category
//      makes that category wrong instead.
//
// `ir.dateRaisedISO` is the only clean sortable date a record has:
// `ir.dateRaised` is display-only (it holds whatever the Sheet had, including raw
// text), and there is no createdAt/timestamp anywhere. Legacy-only stubs and every
// demo record carry no ISO date at all, which is why the "unknown" bucket is
// reachable in normal use rather than a theoretical case.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();

// capture: true memoizes elements by id, so innerHTML a render wrote survives to
// be asserted on. Without it getElementById returns a fresh stub every call and
// every "did it paint?" test would pass vacuously.
const { T, byId } = loadApp(`
  parseISODate, irFiscalYear, irMonthNumber, fyLabel, MONTH_LABELS,
  insightsFacets, insightsSummary, INSIGHTS_SKELETON, renderInsights,
  categoryCounts, renderCategorySegments, applyListFilters, setCategoryFilter,
  IR_CATEGORIES, REPAIR_SUBCATEGORIES, REPAIR_OTHERS, UNCATEGORISED, CATEGORY_ALL,
  INSIGHTS_ALL, SEGMENT_LABELS,
  get allIRs() { return allIRs; }, set allIRs(v) { allIRs = v; },
  get insightsFilters() { return insightsFilters; }, set insightsFilters(v) { insightsFilters = v; },
  get activeCategory() { return activeCategory; },
  get currentView() { return currentView; }, set currentView(v) { currentView = v; },
  set dataIsDemo(v) { _dataIsDemo = v; },
  searchInput, irList,
`, { capture: true });

const iso = s => ({ dateRaisedISO: s });

// ── The date parser ───────────────────────────────────────────────────────────
r.head('only a clean ISO date is a date');
r.ok('a real date parses', JSON.stringify(T.parseISODate('2025-09-28')) === '{"y":2025,"m":9,"d":28}',
  T.parseISODate('2025-09-28'));
r.ok('a blank is null, not year 0', T.parseISODate('') === null, T.parseISODate(''));
r.ok('undefined is null', T.parseISODate(undefined) === null);
r.ok('null is null', T.parseISODate(null) === null);
r.ok('a display-only date string is null',
  T.parseISODate('28 Sep 2025') === null, T.parseISODate('28 Sep 2025'));
r.ok('month 13 is null', T.parseISODate('2025-13-01') === null, T.parseISODate('2025-13-01'));
r.ok('month 00 is null', T.parseISODate('2025-00-10') === null, T.parseISODate('2025-00-10'));
r.ok('day 00 is null', T.parseISODate('2025-09-00') === null, T.parseISODate('2025-09-00'));
r.ok('a JS Date string is not accepted by accident',
  T.parseISODate('2025-09-28T00:00:00Z') === null, T.parseISODate('2025-09-28T00:00:00Z'));

// ── The fiscal year ───────────────────────────────────────────────────────────
r.head('the fiscal year runs 1 April – 31 March');
// The four dates that matter are the two days either side of each boundary. The
// off-by-one here is a whole year of misreported figures.
r.ok('31 Mar 2026 → FY 2025', T.irFiscalYear('2026-03-31') === 2025, T.irFiscalYear('2026-03-31'));
r.ok('1 Apr 2026 → FY 2026',  T.irFiscalYear('2026-04-01') === 2026, T.irFiscalYear('2026-04-01'));
r.ok('31 Mar 2025 → FY 2024', T.irFiscalYear('2025-03-31') === 2024, T.irFiscalYear('2025-03-31'));
r.ok('1 Apr 2025 → FY 2025',  T.irFiscalYear('2025-04-01') === 2025, T.irFiscalYear('2025-04-01'));
r.ok('a September date is in that same calendar year',
  T.irFiscalYear('2025-09-28') === 2025, T.irFiscalYear('2025-09-28'));
r.ok('a January date belongs to the PREVIOUS year\'s FY',
  T.irFiscalYear('2026-01-15') === 2025, T.irFiscalYear('2026-01-15'));
r.ok('no date → null, never a wrong year', T.irFiscalYear('') === null, T.irFiscalYear(''));
r.ok('the label names the year it starts in', T.fyLabel(2025) === '2025-26', T.fyLabel(2025));
r.ok('...and rolls the century correctly', T.fyLabel(2099) === '2099-00', T.fyLabel(2099));
r.ok('twelve month names, January first',
  T.MONTH_LABELS.length === 12 && T.MONTH_LABELS[0] === 'January', T.MONTH_LABELS);

// ── Facets ────────────────────────────────────────────────────────────────────
r.head('the dropdowns are built from the whole list, not the filtered rows');
// A select built from filtered rows would drop every other option the moment one
// was chosen, leaving the reader unable to change their mind — the same reason
// segmentCounts() counts allIRs rather than what is on screen.
const fx = T.insightsFacets([
  { irNumber: 'IR1', dateRaisedISO: '2025-09-01', customerName: 'Acme', droneId: 'D-1' },
  { irNumber: 'IR2', dateRaisedISO: '2026-05-01', customerName: 'Beta', droneId: 'D-2' },
  { irNumber: 'IR3', dateRaisedISO: '2025-01-01', customerName: 'Acme', droneId: 'D-1' },
  { irNumber: 'IR4' },                                   // legacy stub: no ISO date
  { irNumber: 'IR5', dateRaisedISO: '' },                // demo record: empty ISO
]);
r.ok('years newest first', fx.years.join(',') === '2026,2025,2024', fx.years);
r.ok('only months that actually occur', fx.months.join(',') === '1,5,9', fx.months);
r.ok('customers deduped and sorted', fx.customers.join(',') === 'Acme,Beta', fx.customers);
r.ok('drones deduped and sorted', fx.drones.join(',') === 'D-1,D-2', fx.drones);
r.ok('the undated count is surfaced, not swallowed', fx.undated === 2, fx.undated);
r.ok('an empty list yields empty facets, not a crash',
  JSON.stringify(T.insightsFacets([])) === '{"years":[],"months":[],"customers":[],"drones":[],"undated":0}',
  T.insightsFacets([]));
r.ok('a non-list yields the same', T.insightsFacets(null).undated === 0);

// ── Summary ───────────────────────────────────────────────────────────────────
r.head('the summary counts every row, including the ones it cannot place');
const FIXTURE = [
  // FY 2025-26 (Apr 2025 – Mar 2026)
  { irNumber: 'IRa', dateRaisedISO: '2025-09-10', status: 'Production',   category: 'REPAIR',            subCategory: 'GPS',      subCategoryNote: '',        customerName: 'Acme', droneId: 'D-1' },
  { irNumber: 'IRb', dateRaisedISO: '2025-09-20', status: 'Delivered',    category: 'REPAIR',            subCategory: 'OTHERS',   subCategoryNote: 'Cracked canopy', customerName: 'Acme', droneId: 'D-2' },
  { irNumber: 'IRc', dateRaisedISO: '2026-02-01', status: 'Hold',         category: 'CRASH',             subCategory: '',         subCategoryNote: '',        customerName: 'Beta', droneId: 'D-3' },
  { irNumber: 'IRd', dateRaisedISO: '2026-03-31', status: 'Open',         category: 'GENERAL MAINTENANCE', subCategory: '',       subCategoryNote: '',        customerName: 'Beta', droneId: 'D-4' },
  // FY 2026-27
  { irNumber: 'IRe', dateRaisedISO: '2026-04-01', status: 'Close',        category: 'REMOTE SUPPORT',    subCategory: '',         subCategoryNote: '',        customerName: 'Gamma', droneId: 'D-5' },
  // Unplaceable rows — counted, and named.
  { irNumber: 'IRf', status: 'Remote Support' },                       // no ISO date, no category
  { irNumber: 'IRg', dateRaisedISO: '2025-11-05', status: 'Other',      category: 'REPAIR', subCategory: 'WING' },  // retired sub-category
];
const ALL_ON = { fy: T.INSIGHTS_ALL, month: T.INSIGHTS_ALL, status: T.INSIGHTS_ALL,
                 category: T.INSIGHTS_ALL, customer: T.INSIGHTS_ALL, drone: T.INSIGHTS_ALL };

const s0 = T.insightsSummary(FIXTURE, ALL_ON);
r.ok('total is the whole list', s0.total === 7, s0.total);
r.ok('with no filter, matched === total', s0.matched === 7, s0.matched);
r.ok('all four categories are always present as keys',
  T.IR_CATEGORIES.every(k => typeof s0.categories[k] === 'number'), s0.categories);
r.ok('REPAIR counts both its rows', s0.categories.REPAIR === 3, s0.categories.REPAIR);
r.ok('CRASH counts one', s0.categories.CRASH === 1, s0.categories.CRASH);
r.ok('the uncategorised row is COUNTED, not dropped',
  s0.uncategorised === 1, s0.uncategorised);
r.ok('the categories plus the uncategorised bucket = total',
  Object.values(s0.categories).reduce((a, b) => a + b, 0) + s0.uncategorised === s0.total,
  { categories: s0.categories, uncategorised: s0.uncategorised, total: s0.total });
r.ok('every sub-category key is present',
  T.REPAIR_SUBCATEGORIES.every(k => typeof s0.subcategories[k] === 'number'), s0.subcategories);
r.ok('GPS and OTHERS each count one', s0.subcategories.GPS === 1 && s0.subcategories.OTHERS === 1);
// IRg carries subCategory 'WING' — a component that is not on the list any more.
// It must land in "Not set" rather than inventing a tenth sub-category or being
// silently added to AIRFRAME.
r.ok('a retired sub-category is not invented and not misfiled',
  s0.repairUnset === 1 && !Object.keys(s0.subcategories).includes('WING'), s0.repairUnset);
r.ok('the REPAIR sub-categories plus "not set" = the REPAIR count',
  Object.values(s0.subcategories).reduce((a, b) => a + b, 0) + s0.repairUnset === s0.categories.REPAIR,
  { subcategories: s0.subcategories, repairUnset: s0.repairUnset, repair: s0.categories.REPAIR });
r.ok('undated rows are counted separately', s0.undated === 1, s0.undated);
r.ok('the status mix is the four buckets, not 14 statuses',
  Object.keys(s0.statuses).sort().join(',') === 'closed,open,paused,resolved', Object.keys(s0.statuses));
r.ok('...and every matched row is in exactly one bucket',
  Object.values(s0.statuses).reduce((a, b) => a + b, 0) === s0.matched, s0.statuses);
r.ok('a genuinely empty list is all zeroes, not a crash',
  T.insightsSummary([], ALL_ON).total === 0 && T.insightsSummary(null, ALL_ON).matched === 0);

// ── Filters ───────────────────────────────────────────────────────────────────
r.head('Month filters INDEPENDENTLY of the fiscal year');
// The user asked for this explicitly. If Month were a child of FY, asking for
// "September" while FY 2025-26 was selected could only ever mean Sep 2025; the
// point is that it can also mean every September on record.
const F = (over) => Object.assign({}, ALL_ON, over);
r.ok('FY 2025 alone → the five FY 2025-26 rows',
  T.insightsSummary(FIXTURE, F({ fy: 2025 })).matched === 5, T.insightsSummary(FIXTURE, F({ fy: 2025 })).matched);
r.ok('FY 2026 alone → the one FY 2026-27 row',
  T.insightsSummary(FIXTURE, F({ fy: 2026 })).matched === 1, T.insightsSummary(FIXTURE, F({ fy: 2026 })).matched);
r.ok('September alone → the two Septembers, from two DIFFERENT fiscal years',
  T.insightsSummary(FIXTURE, F({ month: 9 })).matched === 2, T.insightsSummary(FIXTURE, F({ month: 9 })).matched);
r.ok('FY 2025 + September is the intersection, not a contradiction',
  T.insightsSummary(FIXTURE, F({ fy: 2025, month: 9 })).matched === 2,
  T.insightsSummary(FIXTURE, F({ fy: 2025, month: 9 })).matched);
r.ok('FY 2026 + September is empty — Sep 2026 has no rows',
  T.insightsSummary(FIXTURE, F({ fy: 2026, month: 9 })).matched === 0,
  T.insightsSummary(FIXTURE, F({ fy: 2026, month: 9 })).matched);
// A select hands back a STRING; the option list holds numbers. Comparing them raw
// matches nothing, silently, and only for these two filters.
r.ok('a year arriving as a string still filters', T.insightsSummary(FIXTURE, F({ fy: '2025' })).matched === 5);
r.ok('a month arriving as a string still filters', T.insightsSummary(FIXTURE, F({ month: '9' })).matched === 2);
// The rows with no readable date cannot belong to any year or month. They must be
// excluded BY the filter and remain visible as a count, not vanish unexplained.
r.ok('a year filter excludes the undated row', T.insightsSummary(FIXTURE, F({ fy: 2025 })).undated === 0);
r.ok('...and the unfiltered view still reports it', s0.undated === 1);

r.head('the other four filters');
r.ok('status filters by the four buckets',
  T.insightsSummary(FIXTURE, F({ status: 'resolved' })).matched === 1,
  T.insightsSummary(FIXTURE, F({ status: 'resolved' })).matched);
r.ok('...and the buckets are the list strip\'s own words',
  T.SEGMENT_LABELS.map(([k]) => k).join(',') === 'all,open,paused,resolved,closed',
  T.SEGMENT_LABELS);
r.ok('category filters to one', T.insightsSummary(FIXTURE, F({ category: 'REPAIR' })).matched === 3);
r.ok('the uncategorised sentinel filters to the rows with none',
  T.insightsSummary(FIXTURE, F({ category: T.UNCATEGORISED })).matched === 1,
  T.insightsSummary(FIXTURE, F({ category: T.UNCATEGORISED })).matched);
r.ok('customer filters exactly', T.insightsSummary(FIXTURE, F({ customer: 'Acme' })).matched === 2);
r.ok('drone filters exactly', T.insightsSummary(FIXTURE, F({ drone: 'D-3' })).matched === 1);
r.ok('customer + category combine',
  T.insightsSummary(FIXTURE, F({ customer: 'Acme', category: 'CRASH' })).matched === 0,
  T.insightsSummary(FIXTURE, F({ customer: 'Acme', category: 'CRASH' })).matched);
r.ok('an unknown customer matches nothing rather than everything',
  T.insightsSummary(FIXTURE, F({ customer: 'Nobody' })).matched === 0);

// ── The IR list's Category filter ─────────────────────────────────────────────
r.head('the category filter is a second, independent axis on the IR list');
T.allIRs = [
  { irNumber: 'IR1', droneId: 'D-1', status: 'Open',      category: 'CRASH' },
  { irNumber: 'IR2', droneId: 'D-2', status: 'Open',      category: 'REPAIR' },
  { irNumber: 'IR3', droneId: 'D-3', status: 'Delivered', category: 'REPAIR' },
  { irNumber: 'IR4', droneId: 'D-4', status: 'Open' },
];
const counts = T.categoryCounts();
r.ok('all counts the whole list', counts.all === 4, counts.all);
r.ok('REPAIR counts two', counts.REPAIR === 2, counts.REPAIR);
r.ok('CRASH counts one', counts.CRASH === 1, counts.CRASH);
r.ok('a category with no rows is still 0, not missing',
  counts['GENERAL MAINTENANCE'] === 0 && counts['REMOTE SUPPORT'] === 0, counts);
r.ok('rows with no category get their own bucket',
  counts[T.UNCATEGORISED] === 1, counts[T.UNCATEGORISED]);
r.ok('the buckets sum to the total',
  T.IR_CATEGORIES.reduce((a, k) => a + counts[k], 0) + counts[T.UNCATEGORISED] === counts.all, counts);

const listHtml = () => byId.get('ir-list').innerHTML;
T.searchInput.value = '';
T.setCategoryFilter('REPAIR');
r.ok('choosing a category filters the list to it',
  listHtml().includes('IR2') && listHtml().includes('IR3') && !listHtml().includes('IR1'), listHtml().slice(0, 200));
r.ok('the active category is remembered', T.activeCategory === 'REPAIR', T.activeCategory);
r.ok('the strip is repainted with the choice marked',
  /class="segment active"[^>]*data-cat="REPAIR"/.test(byId.get('list-categories').innerHTML),
  byId.get('list-categories').innerHTML.slice(0, 300));
// The two axes combine. A CRASH that is Resolved is a real question the desk asks,
// and a filter design where the second axis silently cleared the first would answer
// it wrongly rather than refusing to.
T.setCategoryFilter('CRASH');
T.searchInput.value = 'ir1';
T.applyListFilters();
r.ok('category + search combine',
  listHtml().includes('IR1') && !listHtml().includes('IR2'), listHtml().slice(0, 200));
T.searchInput.value = '';
T.setCategoryFilter(T.CATEGORY_ALL);
r.ok('back to All shows everything again',
  ['IR1', 'IR2', 'IR3', 'IR4'].every(n => listHtml().includes(n)), listHtml().slice(0, 200));
r.ok('the category strip labels are the categories themselves',
  /data-cat="GENERAL MAINTENANCE"/.test(byId.get('list-categories').innerHTML),
  byId.get('list-categories').innerHTML.slice(0, 300));
r.ok('and "No category" is offered only when something is in it',
  /data-cat="__none__"/.test(byId.get('list-categories').innerHTML));
T.allIRs = T.allIRs.map(ir => Object.assign({}, ir, { category: ir.category || 'REPAIR' }));
T.renderCategorySegments();
r.ok('...and disappears once every IR is categorised',
  !/__none__/.test(byId.get('list-categories').innerHTML),
  byId.get('list-categories').innerHTML.slice(0, 300));

// ── The pane ──────────────────────────────────────────────────────────────────
r.head('the dashboard never presents a wait as an answer');
// A dashboard of zeroes is not "loading" — it is the answer "nothing was raised",
// and it is the wrong one. This is also the cold-deep-link frame: showApp() paints
// #/insights before fetchIRs() has even been called.
T.allIRs = [];
T.renderInsights();
const skel = byId.get('insights-body').innerHTML;
r.ok('an empty list paints the skeleton, not a page of zeroes',
  skel.includes('insights-skeleton') && !/insights-card/.test(skel), skel.slice(0, 200));
r.ok('the skeleton is the pane\'s own static markup',
  skel.trim() === T.INSIGHTS_SKELETON.trim(), skel.slice(0, 200));

T.allIRs = FIXTURE;
T.insightsFilters = Object.assign({}, ALL_ON);
T.renderInsights();
const painted = byId.get('insights-body').innerHTML;
r.ok('with data it paints the filters', painted.includes('ins-fy') && painted.includes('ins-drone'));
r.ok('a card per category', T.IR_CATEGORIES.every(k => painted.includes('data-cat="' + k + '"')));
r.ok('the match line reports the real numbers', /<strong>7<\/strong> of 7/.test(painted),
  (painted.match(/insights-total[\s\S]{0,180}/) || [''])[0]);
r.ok('the undated rows are disclosed rather than silently excluded',
  /carry no readable date/.test(painted), (painted.match(/insights-note[^<]*/) || [''])[0]);
r.ok('the REPAIR breakout lists all nine sub-categories',
  T.REPAIR_SUBCATEGORIES.every(k => painted.includes(k)));
r.ok('the OTHERS note is shown verbatim — that is the field\'s whole purpose',
  painted.includes('Cracked canopy'), painted.slice(painted.indexOf('insights-others'), painted.indexOf('insights-others') + 220));
r.ok('the retired sub-category adds a "Not set" chip rather than a tenth component',
  /Not set/.test(painted));
r.ok('the status mix uses the list strip\'s own labels',
  painted.includes('Resolved') && painted.includes('Closed'));

// Escaping. `customerName` and `droneId` come from the PUBLIC customer form and the
// triage fields are rewritable by any signed-in user through the sentinel, so an
// unescaped interpolation here is a stored-XSS path — the same hole
// renderIRList's comment documents.
r.head('every interpolated value is escaped');
T.allIRs = [{ irNumber: 'IRx', dateRaisedISO: '2025-09-01', status: 'Open', category: 'REPAIR', subCategory: 'OTHERS', subCategoryNote: '<img src=x onerror=alert(1)>', customerName: '<script>bad()</script>', droneId: '"><b>x' }];
T.insightsFilters = Object.assign({}, ALL_ON);
T.renderInsights();
const evil = byId.get('insights-body').innerHTML;
r.ok('a customer name from the public form cannot inject markup',
  !/<script>bad\(\)<\/script>/.test(evil) && evil.includes('&lt;script&gt;'), evil.slice(0, 200));
r.ok('nor can an OTHERS note', !/<img src=x/.test(evil));
r.ok('nor can a drone serial', !/"><b>x/.test(evil));

r.head('a dashboard built from the demo sample says so');
// The IR list falling back to demo data is self-evident — five sample cards in a
// list of 450 real ones reads as a placeholder. The SAME five rows on a dashboard
// read as statistics, and "CRASH: 2" is a number somebody could quote in a meeting.
// The gviz read has an 8s abort and both fallbacks are silent, so this is reachable
// in normal use rather than theoretical.
T.allIRs = FIXTURE;
T.dataIsDemo = true;
T.insightsFilters = Object.assign({}, ALL_ON);
T.renderInsights();
const demoHtml = byId.get('insights-body').innerHTML;
r.ok('the warning is on the page', /insights-demo/.test(demoHtml),
  (demoHtml.match(/insights-demo[\s\S]{0,140}/) || [''])[0]);
r.ok('it names the demo sample, not a vague "some data may be missing"',
  /demo sample/.test(demoHtml) && /not real IRs/.test(demoHtml));
T.dataIsDemo = false;
T.renderInsights();
r.ok('and it is gone the moment the data is real',
  !/insights-demo/.test(byId.get('insights-body').innerHTML));

r.head('a filter that has left the data is reset, not kept');
// The select cannot show an option that no longer exists. Keeping the value would
// leave the page reporting 0 matches with every dropdown reading "All" — the one
// failure a reader cannot diagnose from the screen.
T.allIRs = FIXTURE;
T.insightsFilters = Object.assign({}, ALL_ON, { customer: 'Gamma' });
T.renderInsights();
r.ok('a customer still in the list is kept', T.insightsFilters.customer === 'Gamma', T.insightsFilters.customer);
T.insightsFilters = Object.assign({}, ALL_ON, { customer: 'A-Customer-That-Left' });
T.renderInsights();
r.ok('one that has gone is dropped back to All',
  T.insightsFilters.customer === T.INSIGHTS_ALL, T.insightsFilters.customer);
T.insightsFilters = Object.assign({}, ALL_ON, { drone: 'D-9' });
T.renderInsights();
r.ok('a drone serial that has gone is dropped too', T.insightsFilters.drone === T.INSIGHTS_ALL);

r.head('the old field is gone from the source');
const appJs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
// Comments are stripped first: this file documents what it replaced, and a
// negative assertion a comment can trip fails for the wrong reason.
const code = appJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
r.ok('TICKET_TYPES is not defined anywhere', !/TICKET_TYPES/.test(code));
r.ok('nothing reads a record\'s `type` any more',
  !/\bir\.type\b|currentIR\.type|st\.type|s\.type/.test(code),
  (code.match(/[^\n]*\b(ir|currentIR|st|s)\.type\b[^\n]*/) || [''])[0]);

r.finish();
