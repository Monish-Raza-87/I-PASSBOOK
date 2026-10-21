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
  parseISODate, toISODate, irFiscalYear, irMonthNumber, fyLabel, MONTH_LABELS,
  insightsFacets, insightsSummary, insightsMatches, insightsByCompany,
  companyRecordFor, companyNamesFor, INSIGHTS_SKELETON, renderInsights, renderSetup,
  personKey, serialFormatProblem, canonicalSerial, resolveSerial, reporterKeyFor,
  isOutOfScopeModel, isOutOfScopeSerial, inspectorFindings, serialSuggestion,
  postmanNo, postmanSubject, postmanDigest,
  reporterName, setCorrections, canonicalPersonName, personCorrectionKey,
  get corrections() { return corrections; },
  get accessCache() { return accessCache; }, set accessCache(v) { accessCache = v; },
  get currentUser() { return currentUser; }, set currentUser(v) { currentUser = v; },
  categoryCounts, renderCategorySegments, applyListFilters, setCategoryFilter, setListView,
  IR_CATEGORIES, REPAIR_SUBCATEGORIES, REPAIR_OTHERS, UNCATEGORISED, CATEGORY_ALL,
  INSIGHTS_ALL, SEGMENT_LABELS, categoryLabel, subCategoryLabel, statusCategory,
  get allIRs() { return allIRs; }, set allIRs(v) { allIRs = v; },
  get insightsFilters() { return insightsFilters; }, set insightsFilters(v) { insightsFilters = v; },
  get activeCategory() { return activeCategory; },
  get currentView() { return currentView; }, set currentView(v) { currentView = v; },
  showInsights, throttleTrailing,
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

// ── The Sheet's own display format ────────────────────────────────────────────
// The Form Responses tab shows its Timestamp as `9/6/2023 15:56:49` — MONTH first,
// proven by rows reading `9/13/2023`. It used to be handed to `new Date(string)`,
// which is implementation-defined for a non-ISO string: Chrome parses it, Safari
// answers Invalid Date. The result was a dashboard whose year and month dropdowns
// were empty on one browser and full on another, with nothing on screen to explain
// the difference.
r.head('the Sheet\'s own date format is parsed by hand, not by the browser');
r.ok('9/6/2023 15:56:49 → 2023-09-06', T.toISODate('9/6/2023 15:56:49') === '2023-09-06',
  T.toISODate('9/6/2023 15:56:49'));
r.ok('a two-digit day is read as a day', T.toISODate('9/13/2023 17:22:45') === '2023-09-13',
  T.toISODate('9/13/2023 17:22:45'));
r.ok('no time at all still reads', T.toISODate('12/31/2025') === '2025-12-31', T.toISODate('12/31/2025'));
r.ok('an impossible month is refused, not rolled over', T.toISODate('13/1/2025') === '',
  T.toISODate('13/1/2025'));
r.ok('an already-ISO date is unchanged', T.toISODate('2025-09-28') === '2025-09-28');

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
  { irNumber: 'IR1', dateRaisedISO: '2025-09-01', customerName: 'Acme', droneId: 'D-1', droneModel: 'SIGMA 100' },
  { irNumber: 'IR2', dateRaisedISO: '2026-05-01', customerName: 'Beta', droneId: 'D-2', droneModel: 'SIGMA 75' },
  { irNumber: 'IR3', dateRaisedISO: '2025-01-01', customerName: 'Acme', droneId: 'D-1', droneModel: 'SIGMA 100' },
  { irNumber: 'IR4' },                                   // legacy stub: no ISO date
  { irNumber: 'IR5', dateRaisedISO: '' },                // demo record: empty ISO
]);
r.ok('years newest first', fx.years.join(',') === '2026,2025,2024', fx.years);
r.ok('only months that actually occur', fx.months.join(',') === '1,5,9', fx.months);
// Reported by is keyed by PERSON, not by spelling. The two Acme rows are one person,
// the label is the spelling the tickets actually use, and the count rides along. The
// owner asked for these ALPHABETICALLY (2026-10-19): a ranking makes him scan for a
// name he already knows.
r.ok('customers deduped by person, alphabetical, with a count',
  fx.customers.map(c => c.value + ':' + c.label + ':' + c.n).join(',') === 'n:acme:Acme:2,n:beta:Beta:1',
  fx.customers);
{
  const ab = T.insightsFacets([
    { irNumber: 'IR1', customerName: 'Zed',  dateRaisedISO: '2025-09-01' },
    { irNumber: 'IR2', customerName: 'Zed',  dateRaisedISO: '2025-09-02' },
    { irNumber: 'IR3', customerName: 'Zed',  dateRaisedISO: '2025-09-03' },
    { irNumber: 'IR4', customerName: 'Abel', dateRaisedISO: '2025-09-04' },
    { irNumber: 'IR5', companyName: 'Zeta Works', dateRaisedISO: '2025-09-05' },
    { irNumber: 'IR6', companyName: 'Alpha Works', dateRaisedISO: '2025-09-06' },
    { irNumber: 'IR7', companyName: 'Alpha Works', dateRaisedISO: '2025-09-07' },
  ]);
  r.ok('...and a busier name does not jump the queue',
    ab.customers.map(c => c.label).join(',') === 'Abel,Zed', ab.customers);
  r.ok('companies are alphabetical too, count and all',
    ab.companies.map(c => c.label + ' (' + c.n + ')').join(',') === 'Alpha Works (2),Zeta Works (1)',
    ab.companies);
}
r.ok('drones deduped and sorted', fx.drones.join(',') === 'D-1,D-2', fx.drones);
// The model is the SECOND device axis and it is not the serial: one serial is one
// machine, one model is a fleet. Deduped and sorted the same way, and a row with no
// model contributes nothing rather than an empty option in the dropdown.
r.ok('models deduped and sorted, and a row without one adds no option',
  fx.models.join(',') === 'SIGMA 100,SIGMA 75', fx.models);
r.ok('the undated count is surfaced, not swallowed', fx.undated === 2, fx.undated);
r.ok('an empty list yields empty facets, not a crash',
  JSON.stringify(T.insightsFacets([])) === '{"years":[],"months":[],"customers":[],"drones":[],"models":[],"companies":[],"undated":0,"offFleet":0}',
  T.insightsFacets([]));
r.ok('a non-list yields the same', T.insightsFacets(null).undated === 0);

// ── The company axis ──────────────────────────────────────────────────────────
// The dashboard and the Customers screen must agree on what a company IS. They agree by
// both resolving a spelling through the register's name + aliases, so this block pins
// that: one option per COMPANY, and a filter that matches every spelling of it.
r.head('the company axis groups a company by its register record, aliases and all');
{
  const CO_IR = [
    { irNumber: 'IR1', companyName: 'Acme Survey',          status: 'Open',      dateRaisedISO: '2025-09-01' },
    { irNumber: 'IR2', companyName: 'ACME SURVEY PVT LTD',  status: 'Delivered',  dateRaisedISO: '2025-09-02' },
    { irNumber: 'IR3', companyName: 'Beta Farms',           status: 'On Hold',    dateRaisedISO: '2025-09-03' },
    { irNumber: 'IR4', companyName: '',                     status: 'Open',       dateRaisedISO: '2025-09-04' },
  ];
  // NO register: every spelling has to stand for itself, because the register may not be
  // loaded at all (a non-admin never opens User access) and a dashboard that showed an
  // empty dropdown in that case would look broken rather than unscoped.
  T.accessCache = { users: [], departments: [], companies: [], apiVersion: 0 };
  const raw = T.insightsFacets(CO_IR).companies;
  r.ok('with no register, each spelling is its own option and the blank is not one',
    raw.length === 3 && raw.every(c => c.n === 1) && !raw.some(c => !c.label),
    raw.map(c => c.label + ':' + c.n));

  // WITH the register: two companies, because two of those spellings are one customer.
  T.accessCache = { users: [], departments: [], companies: [{
    key: 'acme', name: 'Acme Survey Pvt Ltd', sheets: ['Acme Survey'], contacts: [],
  }], apiVersion: 0 };
  const grouped = T.insightsFacets(CO_IR).companies;
  r.ok('with the register loaded, one company is ONE option however many spellings it has',
    grouped.length === 2 && grouped[0].value === 'acme' && grouped[0].n === 2 &&
    grouped[0].label === 'Acme Survey Pvt Ltd', JSON.stringify(grouped));
  r.ok('...and the options are ranked by how much work the company raises',
    grouped[1].value === 'Beta Farms' && grouped[1].n === 1, JSON.stringify(grouped));

  // The predicate. A plain equality test would pass the first two assertions and fail
  // this one the moment an alias existed — which is exactly the silent divergence the
  // register was built to end.
  r.ok('filtering by the company matches BOTH of its spellings, not just the canonical one',
    T.insightsMatches(CO_IR[0], { company: 'acme' }) && T.insightsMatches(CO_IR[1], { company: 'acme' }),
    JSON.stringify({ first: T.insightsMatches(CO_IR[0], { company: 'acme' }), second: T.insightsMatches(CO_IR[1], { company: 'acme' }) }));
  r.ok('...and leaves another company out', !T.insightsMatches(CO_IR[2], { company: 'acme' }));
  r.ok('...and leaves a row with no company out, rather than counting it as "all"',
    !T.insightsMatches(CO_IR[3], { company: 'acme' }));
  r.ok('"All companies" is no filter at all',
    T.insightsMatches(CO_IR[2], { company: T.INSIGHTS_ALL }) && T.insightsMatches(CO_IR[3], {}),
    T.INSIGHTS_ALL);
  r.ok('a filter object built before this axis existed still matches everything',
    T.insightsMatches(CO_IR[0], { fy: T.INSIGHTS_ALL, model: T.INSIGHTS_ALL }));

  // The table. Its counts are taken with the COMPANY axis lifted, so it can show a
  // distribution while one of its own values is the filter — and every other axis still
  // applies, or the table would disagree with the page it sits on.
  const ranked = T.insightsByCompany(CO_IR, { company: 'acme' }, Date.now());
  r.ok('the by-company table lifts its own axis, so it still lists the OTHER companies',
    ranked.length === 2 && ranked[0].value === 'acme' && ranked[0].total === 2,
    JSON.stringify(ranked));
  const openOnly = T.insightsByCompany(CO_IR, { company: 'acme', status: 'open' }, Date.now());
  r.ok('...and keeps every other axis, so a status filter narrows the table as it narrows the page',
    openOnly.length === 1 && openOnly[0].total === 1 && openOnly[0].open === 1,
    JSON.stringify(openOnly));
  T.accessCache = { users: [], departments: [], companies: [], apiVersion: 0 };
}

// ── Summary ───────────────────────────────────────────────────────────────────
r.head('the summary counts every row, including the ones it cannot place');
const FIXTURE = [
  // FY 2025-26 (Apr 2025 – Mar 2026)
  { irNumber: 'IRa', dateRaisedISO: '2025-09-10', status: 'Production',   category: 'REPAIR',            subCategory: 'GPS',      subCategoryNote: '',        customerName: 'Acme', droneId: 'D-1', droneModel: 'SIGMA 100' },
  { irNumber: 'IRb', dateRaisedISO: '2025-09-20', status: 'Delivered',    category: 'REPAIR',            subCategory: 'OTHERS',   subCategoryNote: 'Cracked canopy', customerName: 'Acme', droneId: 'D-2', droneModel: 'SIGMA 75' },
  { irNumber: 'IRc', dateRaisedISO: '2026-02-01', status: 'Hold',         category: 'CRASH',             subCategory: '',         subCategoryNote: '',        customerName: 'Beta', droneId: 'D-3', droneModel: 'SIGMA 100' },
  { irNumber: 'IRd', dateRaisedISO: '2026-03-31', status: 'Open',         category: 'GENERAL MAINTENANCE', subCategory: '',       subCategoryNote: '',        customerName: 'Beta', droneId: 'D-4', droneModel: 'STRIVER' },
  // FY 2026-27
  { irNumber: 'IRe', dateRaisedISO: '2026-04-01', status: 'Close',        category: 'REMOTE SUPPORT',    subCategory: '',         subCategoryNote: '',        customerName: 'Gamma', droneId: 'D-5', droneModel: 'SIGMA 55' },
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
// ⚠ THE TRAP THIS SUITE IS ONE EDIT AWAY FROM. `insightsMatches` tests
// `f.x !== INSIGHTS_ALL`, so an object that OMITS a key hands it `undefined` — which
// is `!== INSIGHTS_ALL` — and every row is filtered out. A dashboard of zeroes with
// no error anywhere, from a caller that merely built its filter object before the
// axis existed. So an absent key has to mean the same thing as `INSIGHTS_ALL`: there
// is no filter on this axis. Asserted here rather than only in the fixtures, because
// two suites build exactly such an object and both would otherwise have to be
// rewritten whenever an axis is added.
r.ok('a filter object that OMITS a key filters nothing on that key',
  T.insightsSummary(FIXTURE, { fy: T.INSIGHTS_ALL, month: T.INSIGHTS_ALL, status: T.INSIGHTS_ALL,
                               category: T.INSIGHTS_ALL, customer: T.INSIGHTS_ALL }).matched === 7,
  T.insightsSummary(FIXTURE, { fy: T.INSIGHTS_ALL, month: T.INSIGHTS_ALL, status: T.INSIGHTS_ALL,
                               category: T.INSIGHTS_ALL, customer: T.INSIGHTS_ALL }).matched);
r.ok('an empty filter object matches everything, too',
  T.insightsSummary(FIXTURE, {}).matched === 7, T.insightsSummary(FIXTURE, {}).matched);
r.ok('...while an EXPLICIT all on every axis says the same thing',
  T.insightsSummary(FIXTURE, ALL_ON).matched === 7);
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
// Two, not one — and the second one is the assertion that matters. IRb is
// Delivered. IRe still holds the retired word "Close", which STATUS_LEGACY folds
// onto Delivered, so a ticket finished under the old vocabulary counts as resolved
// under the new one instead of silently dropping out of the totals. The row did not
// move; the word it was written with did.
r.ok('status filters by the four buckets, and a retired Close folds into resolved',
  T.insightsSummary(FIXTURE, F({ status: 'resolved' })).matched === 2,
  T.insightsSummary(FIXTURE, F({ status: 'resolved' })).matched);
r.ok('...so the retired word and the stage it means land in the same bucket',
  T.statusCategory('Close') === T.statusCategory('Delivered') &&
  T.statusCategory('Hold') === T.statusCategory('On Hold') &&
  T.statusCategory('Other') !== T.statusCategory('Delivered'),
  ['Close', 'Delivered', 'Hold', 'On Hold', 'Other'].map(w => [w, T.statusCategory(w)]));
r.ok('...and the buckets are the list strip\'s own words',
  T.SEGMENT_LABELS.map(([k]) => k).join(',') === 'all,open,paused,resolved,closed',
  T.SEGMENT_LABELS);
r.ok('category filters to one', T.insightsSummary(FIXTURE, F({ category: 'REPAIR' })).matched === 3);
r.ok('the uncategorised sentinel filters to the rows with none',
  T.insightsSummary(FIXTURE, F({ category: T.UNCATEGORISED })).matched === 1,
  T.insightsSummary(FIXTURE, F({ category: T.UNCATEGORISED })).matched);
r.ok('customer filters exactly', T.insightsSummary(FIXTURE, F({ customer: T.reporterKeyFor('Acme') })).matched === 2);
r.ok('drone filters exactly', T.insightsSummary(FIXTURE, F({ drone: 'D-3' })).matched === 1);
// The model axis, added 2026-10-13. The Sheet writes the model in column S and the
// app read it nowhere, so the fleet could not be counted at all.
r.ok('model filters to the whole fleet, not to one machine',
  T.insightsSummary(FIXTURE, F({ model: 'SIGMA 100' })).matched === 2,
  T.insightsSummary(FIXTURE, F({ model: 'SIGMA 100' })).matched);
r.ok('a model with one ticket filters to one', T.insightsSummary(FIXTURE, F({ model: 'STRIVER' })).matched === 1);
r.ok('model and drone combine', T.insightsSummary(FIXTURE, F({ model: 'SIGMA 100', drone: 'D-1' })).matched === 1);
r.ok('a model that is in no row matches nothing rather than everything',
  T.insightsSummary(FIXTURE, F({ model: 'SIGMA 999' })).matched === 0);
r.ok('the rows with no model at all are matched by no model filter',
  T.insightsSummary(FIXTURE, F({ model: 'SIGMA 55' })).matched === 1);
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
// The Service Desk OPENS ON THE GRID as of 2026-10-11 (the owner: "when I click on
// IRS Service Desk, it should default open in Grid view"), so the module default is
// now `grid` and `#ir-list` is not the surface a render writes until the List is
// asked for BY NAME. Everything below is about the LIST's category axis, so it asks.
T.setListView('list');
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
// The tab CARRIES the stored key and SHOWS the house label. Both halves matter:
// the key is what a click filters on and what the store compares, and the label is
// the only thing a reader meets — the row that used to read "All Categories" beside
// "GENERAL MAINTENANCE".
{
  const strip = byId.get('list-categories').innerHTML;
  r.ok('each category tab carries the stored key',
    /data-cat="GENERAL MAINTENANCE"/.test(strip), strip.slice(0, 300));
  // The label sits immediately before the count span, whatever the indentation.
  r.ok('...and shows the label, so one row is one style',
    strip.includes(T.categoryLabel('GENERAL MAINTENANCE') + '<span class="segment-count"') &&
    !strip.includes('GENERAL MAINTENANCE<span'), strip.slice(0, 300));
  r.ok('...with the special two tabs in that same style',
    strip.includes('All categories<span') && strip.includes('No category<span'));
}
r.ok('the label maps are tables, not a lower-case rule — an unknown key passes through',
  T.categoryLabel('CRASH') === 'Crash' &&
  T.categoryLabel('REMOTE SUPPORT') === 'Remote support' &&
  T.subCategoryLabel('TRIPOD/BIPOD') === 'Tripod/bipod' &&
  T.subCategoryLabel('TOPSHELL') === 'Topshell' &&
  // Not in either table: unchanged, rather than guessed at or mangled. The retired
  // WING still shows on the old rows that carry it.
  T.categoryLabel('WING') === 'WING' && T.subCategoryLabel('WING') === 'WING' &&
  T.categoryLabel('') === '' && T.subCategoryLabel(null) === '');
r.ok('and "No category" is offered only when something is in it',
  /data-cat="__none__"/.test(byId.get('list-categories').innerHTML));
T.allIRs = T.allIRs.map(ir => Object.assign({}, ir, { category: ir.category || 'REPAIR' }));
T.renderCategorySegments();
r.ok('...and disappears once every IR is categorised',
  !/__none__/.test(byId.get('list-categories').innerHTML),
  byId.get('list-categories').innerHTML.slice(0, 300));

// ── The pane ──────────────────────────────────────────────────────────────────
r.head('the dashboard never presents a wait as an answer');
// The pane is VISIBILITY-GATED: `#insights-body` is static markup in index.html, so
// it exists on every route, and renderInsights() returns without painting unless the
// dashboard is the pane on screen — which is what stops the two boot-time callers
// from rebuilding a hidden pane. Everything below asserts what the dashboard PAINTS,
// so the pane has to be showing, exactly as handleRoute()'s `#/insights` branch makes
// it. The gate itself is asserted at the bottom of this file.
T.currentView = 'insights';
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
// Two device axes, and they are named for what they are: the serial is the machine,
// the model is the fleet. "DRONE SN" named neither of them clearly enough for the
// owner to find the model filter he was looking for.
r.ok('the device filters are named "UAS SN" and "UAS MODEL"',
  painted.includes('>UAS SN<') && painted.includes('>UAS MODEL<'),
  (painted.match(/insights-filter-label[^>]*>[^<]*/g) || []).join(' | '));
r.ok('...and the pane really wires the model dropdown',
  painted.includes('ins-model') && painted.includes('All models'));
r.ok('a card per category', T.IR_CATEGORIES.every(k => painted.includes('data-cat="' + k + '"')));
r.ok('the match line reports the real numbers', /<strong>7<\/strong> of 7/.test(painted),
  (painted.match(/insights-total[\s\S]{0,180}/) || [''])[0]);
r.ok('the undated rows are disclosed rather than silently excluded',
  /carry no readable date/.test(painted), (painted.match(/insights-note[^<]*/) || [''])[0]);
r.ok('the REPAIR breakout lists all nine sub-categories, each in the house style',
  T.REPAIR_SUBCATEGORIES.every(k => painted.includes(T.subCategoryLabel(k))));
// The keys are ALL CAPS because they are keys, and the chips beside them are the
// only place a reader meets one. A raw key leaking in is the exact defect the
// owner saw as "All Categories" sitting next to "GENERAL MAINTENANCE".
r.ok('...and not one of them is printed as the raw stored key',
  !/TOPSHELL|AIRFRAME|TRIPOD\/BIPOD|CAMERA\/LENS/.test(painted),
  (painted.match(/insights-subcats[\s\S]{0,400}/) || [''])[0]);
// The card's visible text is the label; the raw key must still travel in
// `data-cat`, because that is what the click handler filters on and what the
// store compares. So this looks for the key between the TAGS, not anywhere.
r.ok('the category cards wear the house style too, not the stored key',
  painted.includes('>' + T.categoryLabel('GENERAL MAINTENANCE') + '<') &&
  !painted.includes('>GENERAL MAINTENANCE<') &&
  painted.includes('data-cat="GENERAL MAINTENANCE"'));
// The acronyms are the reason the labels are a map and not a lower-case rule.
r.ok('...while an acronym keeps its capitals',
  T.subCategoryLabel('GPS') === 'GPS' && T.subCategoryLabel('RC') === 'RC');
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
// The list read has a 12s abort and every failure path is silent, so this is
// reachable in normal use rather than theoretical.
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

r.head('a long findings list opens in place, and the box arrives prefilled');
{
  // The owner, 2026-10-19: *"I am not able to see rest of 30 more issues as there is no
  // options to skip any entry for now and move on to next, or scroll down."* So the
  // tail is a <details>, not a dead sentence; and the serial box carries the Inspector's
  // own proposal so the decision is one press.
  T.currentUser = { email: 'dev@indrones.com', access: { role: 'admin', departments: ['cr'], permissions: {}, triage: true, revokedBy: {} } };
  const many = [];
  for (let i = 1; i <= 11; i++) {
    many.push({ irNumber: 'IR' + i, droneId: 'S100-V3 (R&D)', droneIdRaw: 'S100-V3 (R&D)', droneModel: 'SIGMA 100',
                customerName: 'Test Reporter', contactEmail: 'test.reporter@example.com' });
  }
  T.allIRs = many;
  T.insightsFilters = Object.assign({}, ALL_ON);
  // THE FINDINGS ARE NOT ON THE DASHBOARD ANY MORE. The Inspector, the Postman and
  // every repair box moved to their own pane on 2026-10-21 — Insights is counts only —
  // so the pane that has to be showing for these to paint is #/setup.
  T.currentView = 'setup';
  T.renderSetup();
  const h = byId.get('setup-body').innerHTML;
  r.ok('the serial tail is a <details> that can be opened',
    /<details class="ins-flag-details">/.test(h) && /Show the other 3/.test(h), (h.match(/Show the other[^<]*/) || [''])[0]);
  r.ok('...and every one of the 11 is reachable, not 8 of them',
    (h.match(/<input[^>]*id="ins-fix-sn-\d+"/g) || []).length === 11,
    (h.match(/<input[^>]*id="ins-fix-sn-\d+"/g) || []).length);
  r.ok('a proposal the Inspector has is written into the box, and marked',
    (h.match(/value="S100-V3"/g) || []).length === 11 && /ins-suggest/.test(h),
    (h.match(/value="S100-V3"/g) || []).length);
  // ONE MAILBOX: one reporter entry, labelled "NAME (email)", with a box per spelling
  // so CR can overrule the choice. The owner's rule: "only one name to each email ID"
  // and "mention name and in bracket email ID" (2026-10-19).
  T.allIRs = [
    { irNumber: 'IRa', customerName: 'test person', contactEmail: 'test.reporter@example.com' },
    { irNumber: 'IRb', customerName: 'TEST PERSON S', contactEmail: 'test.reporter@example.com' },
  ];
  T.renderSetup();
  const hm = byId.get('setup-body').innerHTML;
  r.ok('one mailbox is ONE reporter entry, and it reads NAME (email)',
    /TEST PERSON S \(test\.reporter@example\.com\)/.test(hm), hm.slice(0, 400));
  r.ok('...the fuller spelling is the one it speaks with, not the first row',
    (hm.match(/TEST PERSON S/g) || []).length >= 2 && !/<option[^>]*>test person</i.test(hm), hm.slice(0, 400));
  r.ok('...and it is reported as merged, with one editable box per spelling',
    /merged inside one mailbox/.test(hm) &&
    (hm.match(/<input[^>]*id="ins-fix-rp-\d+-\d+"/g) || []).length === 2,
    (hm.match(/<input[^>]*id="ins-fix-rp-\d+-\d+"/g) || []).length);

  // TWO MAILBOXES, two entries — and NO question: each mailbox has a person's name.
  T.allIRs = [
    { irNumber: 'IRa', customerName: 'test person', contactEmail: 'one@example.com' },
    { irNumber: 'IRb', customerName: 'TEST PERSON S', contactEmail: 'two@example.com' },
  ];
  // These two names are read off the REPORTER facet — one option per name+address
  // pair — so this one looks at the dashboard, not at Setup.
  T.currentView = 'insights';
  T.renderInsights();
  const hr = byId.get('insights-body').innerHTML;
  r.ok('two mailboxes are two entries, each with the address in brackets',
    /test person \(one@example\.com\)/i.test(hr) && /TEST PERSON S \(two@example\.com\)/i.test(hr), hr.slice(0, 400));
  r.ok('...and neither is a finding — the mailbox already has a name',
    !/no person's name/.test(hr) && (hr.match(/<input[^>]*id="ins-fix-rp-\d+-\d+"/g) || []).length === 0,
    (hr.match(/<input[^>]*id="ins-fix-rp-\d+-\d+"/g) || []).length);
  T.currentUser = null;
  T.allIRs = FIXTURE;
  T.currentView = 'insights';
  T.renderInsights();
}

r.head('a filter that has left the data is reset, not kept');
// The select cannot show an option that no longer exists. Keeping the value would
// leave the page reporting 0 matches with every dropdown reading "All" — the one
// failure a reader cannot diagnose from the screen.
T.allIRs = FIXTURE;
T.insightsFilters = Object.assign({}, ALL_ON, { customer: T.reporterKeyFor('Gamma') });
T.renderInsights();
r.ok('a customer still in the list is kept', T.insightsFilters.customer === T.reporterKeyFor('Gamma'), T.insightsFilters.customer);
T.insightsFilters = Object.assign({}, ALL_ON, { customer: 'a-customer-that-left' });
T.renderInsights();
r.ok('one that has gone is dropped back to All',
  T.insightsFilters.customer === T.INSIGHTS_ALL, T.insightsFilters.customer);
T.insightsFilters = Object.assign({}, ALL_ON, { drone: 'D-9' });
T.renderInsights();
r.ok('a drone serial that has gone is dropped too', T.insightsFilters.drone === T.INSIGHTS_ALL);

// ── The hygiene batch: R-108 as code, and the fleet we actually make ──────────
r.head('R-108 is code now, not a sentence in the rule book');
// The owner's four formats, exactly as he wrote them: SIGMA 25 → S25XXX,
// SIGMA 25 PRO → S25PXXX, SIGMA 100 → S100-XXX, SIGMA 75 → S75XXX. A serial from
// a machine we do not make is a DIFFERENT finding: it is left off the fleet lists
// and named, never treated as a malformed one — the rule says ask CR, never block.
r.ok('a clean serial passes in each of the four formats',
  ['S25018', 'S25P033', 'S100-003', 'S75004'].every(sn => T.serialFormatProblem(sn) === ''),
  ['S25018', 'S25P033', 'S100-003', 'S75004'].map(sn => T.serialFormatProblem(sn)));
// THE APP CORRECTS WHAT IT CAN PROVE. The owner's rule (2026-10-18): S100-XXX is
// compulsory and "correction to wrong entry has to be made by our app only". So a
// serial that is merely MISSPELLED never reaches CR — the normaliser fixes it.
r.ok('S100-12 is corrected to S100-012, not sent to CR', T.canonicalSerial('S100-12') === 'S100-012',
  T.canonicalSerial('S100-12'));
r.ok('...and a corrected serial then passes the format check',
  T.serialFormatProblem('S100-12') === '', T.serialFormatProblem('S100-12'));
r.ok('...case, spaces and separators are all the same serial',
  ['s100_24', ' S100 24 ', 'S100-024', 'S100024'].every(v => T.canonicalSerial(v) === 'S100-024'),
  ['s100_24', ' S100 24 ', 'S100-024', 'S100024'].map(v => T.canonicalSerial(v)));
r.ok('S25P-014 is corrected to S25P014', T.canonicalSerial('S25P-014') === 'S25P014');
r.ok('S25-007 is corrected to S25007', T.canonicalSerial('S25-007') === 'S25007');
r.ok('S75-4 is corrected and padded to S75004', T.canonicalSerial('S75-4') === 'S75004');
r.ok('a clean serial is returned unchanged', T.canonicalSerial('S25P033') === 'S25P033');
// NOTHING IS GUESSED. A value the app cannot prove is left exactly as written and
// stays a finding for CR — a wrong guess would invent an aircraft.
//
// THE OWNER'S TWO EXCEPTIONS, 2026-10-19. A contracted SIGMA 75 carries its customer's
// own alpha suffix (`S75-ACME`) and is written that way and no other; and an R&D
// machine is written as its version (`S100-V1`, `S100-V3`, `S25P-V4`), never as a unit
// number, and never with the words "R&D" bolted on. Both are CORRECT, so neither
// reaches CR.
r.ok('S75-ACME is the accepted spelling and is NOT a finding',
  T.canonicalSerial('S75-ACME') === 'S75-ACME' && T.serialFormatProblem('S75-ACME') === '',
  T.serialFormatProblem('S75-ACME'));
r.ok('...and it normalises the separators it was typed with',
  ['s75 acme', 'S75_ACME', 'S75.ACME'].every(v => T.canonicalSerial(v) === 'S75-ACME'),
  ['s75 acme', 'S75_ACME', 'S75.ACME'].map(v => T.canonicalSerial(v)));
r.ok('an R&D version is a format, not a mistake',
  ['S100-V1', 'S100-V3', 'S25P-V4', 'S25-V2', 'S75-V1'].every(v => T.serialFormatProblem(v) === ''),
  ['S100-V1', 'S100-V3', 'S25P-V4', 'S25-V2', 'S75-V1'].map(v => T.serialFormatProblem(v)));
r.ok('"S25PV4 R&D" is corrected to S25P-V4',
  T.canonicalSerial('S25PV4 R&D') === 'S25P-V4', T.canonicalSerial('S25PV4 R&D'));
r.ok('...and so are the other ways the version gets typed',
  ['S100 V3', 's100-v3', 'S100V3', 'S100-V03', 'S100-V3 R&D'].every(v => T.canonicalSerial(v) === 'S100-V3'),
  ['S100 V3', 's100-v3', 'S100V3', 'S100-V03', 'S100-V3 R&D'].map(v => T.canonicalSerial(v)));
r.ok('a 4-digit body is outside the owner\'s format and is left alone',
  T.canonicalSerial('S100-1234') === 'S100-1234' && T.serialFormatProblem('S100-1234') !== '');
r.ok('a free-written name is NOT a finding — it is not a malformed serial',
  T.serialFormatProblem('FIGHTER') === '' && T.serialFormatProblem('HECTOR-V1') === '');
r.ok('a blank serial is not a finding', T.serialFormatProblem('') === '');
r.ok('S25P030 is not mistaken for a malformed S25', T.serialFormatProblem('S25P030') === '');

r.head('a finding can carry a proposal, and a proposal is never a guess');
// The box is prefilled and CR presses once. The prefix comes from the MODEL, and the
// number must ALREADY be written in the serial — nothing is invented.
r.ok('a model word and a short number are proposed in that model\'s format',
  T.serialSuggestion('SIGMA 25 018', 'SIGMA 25') === 'S25018' &&
  T.serialSuggestion('SIGMA 100 12', 'SIGMA 100') === 'S100-012' &&
  T.serialSuggestion('S75 7', 'SIGMA 75') === 'S75007',
  ['SIGMA 25 018', 'SIGMA 100 12', 'S75 7'].map((v, i) => T.serialSuggestion(v, ['SIGMA 25', 'SIGMA 100', 'SIGMA 75'][i])));
r.ok('an R&D version is proposed as a version',
  T.serialSuggestion('S100 v33', 'SIGMA 100') === 'S100-V33' &&
  T.serialSuggestion('SIGMA 25 PRO V4', 'SIGMA 25 PRO') === 'S25P-V4',
  [T.serialSuggestion('S100 v33', 'SIGMA 100'), T.serialSuggestion('SIGMA 25 PRO V4', 'SIGMA 25 PRO')]);
r.ok('a bare unit number is NOT proposed from — the model cannot be read off it',
  T.serialSuggestion('25018', 'SIGMA 25 PRO') === '', T.serialSuggestion('25018', 'SIGMA 25 PRO'));
r.ok('a 4-digit body gets NO proposal, because the app would be inventing one',
  T.serialSuggestion('S100-1234', 'SIGMA 100') === '', T.serialSuggestion('S100-1234', 'SIGMA 100'));
r.ok('an unknown model gets no proposal either',
  T.serialSuggestion('123', 'DJI Mavic 2 Pro') === '' && T.serialSuggestion('FIGHTER', 'STRIVER') === '');
r.ok('and every proposal really passes the format check',
  ['S25P018', 'S100-012', 'S75007'].every(v => T.serialFormatProblem(v) === ''));

r.head('equipment we do not make stays out of the fleet lists, and is named instead');
r.ok('DJI is out of scope on the model axis', T.isOutOfScopeModel('DJI Mavic 2 Pro') === true);
r.ok('MAVIC is out of scope even without the DJI word', T.isOutOfScopeModel('Mavic 3E') === true);
// The owner's correction (2026-10-18): "DJI, MAVIC can be eliminated and removed
// from the app but not AGISOFT."
r.ok('AGISOFT stays IN scope — it is in their workflow', T.isOutOfScopeModel('AGISOFT') === false);
r.ok('one of our own models is in scope', T.isOutOfScopeModel('SIGMA 25 PRO') === false);
r.ok('a serial that says Mavic is out of scope', T.isOutOfScopeSerial('DJI Mavic 2 Pro 101') === true);
r.ok('a real serial is in scope', T.isOutOfScopeSerial('S25P033') === false);

{
  const ff = T.insightsFacets([
    { irNumber: 'IR1', customerName: 'Acme', droneId: 'S25P033', droneModel: 'SIGMA 25 PRO' },
    { irNumber: 'IR2', customerName: 'Acme', droneId: 'Mavic 2 pro', droneModel: 'DJI Mavic 2 Pro' },
    { irNumber: 'IR3', customerName: 'ACME', droneId: '', droneModel: 'AGISOFT' },
  ]);
  r.ok('only the DJI/MAVIC row is counted as off-fleet', ff.offFleet === 1, ff.offFleet);
  r.ok('...and put no option in the UAS SN list', ff.drones.join(',') === 'S25P033', ff.drones);
  r.ok('...and AGISOFT is still an option in the MODEL list',
    ff.models.join(',') === 'AGISOFT,SIGMA 25 PRO', ff.models);
  r.ok('a person is one reporter however the name is typed', ff.customers.length === 1, ff.customers);
  r.ok('...and the label is the spelling most tickets use', ff.customers[0].n === 3, ff.customers[0]);
}

r.head('a reporter is identified by the NAME on the ticket, not the mailbox');
{
  // One manager files for a whole team, so a single address can carry several
  // genuinely different reporters. The name is the identity and the address is
  // provenance. Two spellings of one name ARE one person.
  const rows = [
    { irNumber: 'IR1', customerName: 'Test Reporter', contactEmail: 'test.reporter@example.com' },
    { irNumber: 'IR2', customerName: 'test  reporter', contactEmail: 'TEST.REPORTER@example.com' },
    { irNumber: 'IR3', customerName: 'Test Reporter', contactEmail: 'other@elsewhere.in' },
    { irNumber: 'IR4', customerName: 'Solo Person',  contactEmail: '' },
    { irNumber: 'IR5', customerName: '',             contactEmail: 'no.name@acme.in' },
  ];
  r.ok('the identity is the NAME paired with the address it came from',
    T.reporterKeyFor('Test Reporter', 'test.reporter@example.com') === 'p:test reporter|test.reporter@example.com');
  r.ok('...and case or punctuation in the address does not split it',
    T.reporterKeyFor('Test Reporter', 'TEST.REPORTER@example.com') === 'p:test reporter|test.reporter@example.com');
  r.ok('one mailbox filing for two people is TWO entries — the name decides',
    T.reporterKeyFor('Test Reporter', 'manager@example.com') !==
    T.reporterKeyFor('Solo Person', 'manager@example.com'));
  r.ok('one person from two addresses is two entries, one per mailbox',
    T.reporterKeyFor('Test Reporter', 'test.reporter@example.com') !==
    T.reporterKeyFor('Test Reporter', 'other@elsewhere.in'));
  r.ok('a row that names nobody still belongs to its mailbox',
    T.reporterKeyFor('', 'No.Name@Acme.in') === 'e:no.name@acme.in');
  r.ok('...and a row with neither is no person at all', T.reporterKeyFor('', '') === '');
}

r.head('the Inspector finds the same things the panel lists');
{
  const f = T.inspectorFindings([
    { irNumber: 'IR1', droneId: 'S100-12', droneIdRaw: 'S100-12', droneModel: 'SIGMA 100' },
    { irNumber: 'IR2', droneId: 'S100-003', droneIdRaw: 'S100-003', droneModel: 'SIGMA 100' },
    { irNumber: 'IR3', droneId: 'Mavic 2 pro', droneIdRaw: 'Mavic 2 pro', droneModel: 'DJI Mavic 2 Pro' },
    { irNumber: 'IR4', droneId: 'FIGHTER', droneIdRaw: 'FIGHTER', droneModel: 'STRIVER' },
    { irNumber: 'IR5', droneId: 'S100-1234', droneIdRaw: 'S100-1234', droneModel: 'SIGMA 100' },
    { irNumber: 'IR6', droneId: 'S25P-V4', droneIdRaw: 'S25P-V4', droneModel: 'SIGMA 25 PRO' },
  ]);
  r.ok('a serial the app can prove wrong is reported as auto-corrected',
    f.autoFixed.length === 1 && f.autoFixed[0].from === 'S100-12' && f.autoFixed[0].to === 'S100-012', f.autoFixed);
  r.ok('...and it is NOT also a CR finding',
    f.serial.every(x => x.irNumber !== 'IR1'), f.serial);
  r.ok('a serial the app cannot prove stays a serial finding',
    f.serial.length === 1 && f.serial[0].irNumber === 'IR5' && f.serial[0].raw === 'S100-1234', f.serial);
  r.ok('the finding carries the IR, the serial and the reason',
    f.serial[0].sn === 'S100-1234' && /S100-XXX/.test(f.serial[0].why), f.serial[0]);
  r.ok('an R&D version is not a finding at all',
    f.serial.every(x => x.irNumber !== 'IR6'), f.serial);
  r.ok('an off-fleet row is an off-fleet finding, never a serial finding',
    f.offFleet.length === 1 && f.offFleet[0].irNumber === 'IR3' && f.serial.every(x => x.irNumber !== 'IR3'),
    f.offFleet);
  r.ok('a free-written serial is neither finding',
    f.serial.every(x => x.irNumber !== 'IR4') && f.offFleet.every(x => x.irNumber !== 'IR4'), f);
  r.ok('the total is every row the pass looked at', f.total === 6, f.total);
}

r.head('one mailbox is one name; a mailbox with no name is the only question left');
{
  // ONE email, two spellings: the app reduces the mailbox to one name itself (the
  // owner's rule, 2026-10-19), so this is reported as automatic, never as a question.
  const same = T.inspectorFindings([
    { irNumber: 'IR1', customerName: 'Test Reporter', contactEmail: 'test.reporter@example.com' },
    { irNumber: 'IR2', customerName: 'test  reporter', contactEmail: 'test.reporter@example.com' },
    { irNumber: 'IR3', customerName: 'Asha Rao', contactEmail: 'asha@acme.in' },
  ]);
  r.ok('a spelling and its fuller form under ONE email are merged, not asked',
    same.reporters.length === 0 && same.autoMerged.length === 1, same);
  // Rows here are raw (no mapper), so the case is the row's own; the mapper hands
  // the same pass a CAPS name.
  r.ok('...onto the most complete spelling',
    same.autoMerged[0].to.toLowerCase() === 'test reporter', same.autoMerged[0]);
  r.ok('...and the merge names the address and both spellings',
    same.autoMerged[0].email === 'test.reporter@example.com' &&
    same.autoMerged[0].names.length === 2, same.autoMerged[0]);

  // TWO emails, same name: two mailboxes are two entries, and NEITHER is a question.
  const two = T.inspectorFindings([
    { irNumber: 'IR1', customerName: 'Sample Name',   contactEmail: 'one@example.com' },
    { irNumber: 'IR2', customerName: 'Sample Name S', contactEmail: 'two@example.com' },
  ]);
  r.ok('two addresses with a name each are two entries and no question',
    two.reporters.length === 0 && two.autoMerged.length === 0, two);

  // A mailbox that never names a person: the app shows the email and asks once.
  const org = T.inspectorFindings([
    { irNumber: 'IR1', customerName: 'Sample Company Pvt Ltd', contactEmail: 'ops@example.com' },
    { irNumber: 'IR2', customerName: 'FORM RESPONSES',         contactEmail: 'form@example.com' },
  ]);
  r.ok('a company or a form title is NEVER a reporter — that mailbox is a question',
    org.reporters.length === 2 && org.autoMerged.length === 0, org.reporters);
  r.ok('...and the question is keyed by the ADDRESS, which is what the list shows',
    org.reporters.every(g => /^e:/.test(g.key) && g.email) &&
    org.reporters.map(g => g.email).join(',') === 'form@example.com,ops@example.com', org.reporters);
  r.ok('...with the raw cell kept so CR can see what was written',
    org.reporters.some(g => g.spellings.some(s => s.name === 'FORM RESPONSES')), org.reporters);
}

r.head('an approved correction is what changes the app, and only it');
{
  T.setCorrections({ items: {
    'serial:S100-V3': { kind: 'serial', from: 'S100-V3', to: 'S100-003', by: 'cr@indrones.com' },
    'person:n:test reporter': { kind: 'person', from: 'test reporter', email: 'test.reporter@example.com', to: 'TEST REPORTER' },
  } });
  r.ok('the approved serial wins over the raw one', T.resolveSerial('S100-V3') === 'S100-003');
  r.ok('...and is shown in the standard format', T.resolveSerial('s100-v3') === 'S100-003');
  r.ok('the approved reporter name is shown', T.reporterName('test reporter', 'test.reporter@example.com') === 'TEST REPORTER');
  r.ok('...and the decision is keyed by the NAME, so another address saying it gets it too',
    T.reporterName('Test Reporter', 'other@elsewhere.in') === 'TEST REPORTER');
  r.ok('a different person in the same mailbox is untouched',
    T.reporterName('Solo Person', 'test.reporter@example.com') === 'SOLO PERSON');
  r.ok('an uncorrected name is shown in CAPS, which is the approved house form',
    T.reporterName('Asha Rao', 'asha@acme.in') === 'ASHA RAO');
  r.ok('a serial with no entry still gets the deterministic fix',
    !T.corrections.items['serial:S100-12'] && T.resolveSerial('S100-12') === 'S100-012');
  // With a correction in force, the Inspector stops reporting it as a finding.
  const f = T.inspectorFindings([
    { irNumber: 'IR1', droneId: 'S100-V3', droneIdRaw: 'S100-V3', droneModel: 'SIGMA 100' },
  ]);
  r.ok('a corrected serial is no longer a finding', f.serial.length === 0, f.serial);
  const fp = T.inspectorFindings([
    { irNumber: 'IR1', customerName: 'test reporter', contactEmail: 'test.reporter@example.com' },
    { irNumber: 'IR2', customerName: 'Test Reporter', contactEmail: 'test.reporter@example.com' },
  ]);
  r.ok('a reporter spelling CR already decided is not asked again', fp.reporters.length === 0, fp.reporters);
  T.setCorrections({});
}

r.head('a legacy email-keyed correction still lands, but never renames a teammate');
{
  T.setCorrections({ items: {
    'person:e:manager@example.com': { kind: 'person', from: 'manager person', email: 'manager@example.com', to: 'MANAGER PERSON' },
  } });
  r.ok('the spelling it was written for is corrected',
    T.reporterName('Manager Person', 'manager@example.com') === 'MANAGER PERSON');
  r.ok('a teammate filed from the same mailbox is NOT',
    T.reporterName('Solo Person', 'manager@example.com') === 'SOLO PERSON');
  T.setCorrections({});
}

r.head('the old field is gone from the source');
const appJs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
// Comments are stripped first: this file documents what it replaced, and a
// negative assertion a comment can trip fails for the wrong reason.
const code = appJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
r.ok('TICKET_TYPES is not defined anywhere', !/TICKET_TYPES/.test(code));
r.ok('nothing reads a record\'s `type` any more',
  !/\bir\.type\b|currentIR\.type|st\.type|s\.type/.test(code),
  (code.match(/[^\n]*\b(ir|currentIR|st|s)\.type\b[^\n]*/) || [''])[0]);

// ── The two things that keep the pane and the list off the frame budget ───────
r.head('a hidden dashboard is not rebuilt, and showing it always repaints');

// The gate exists because `#insights-body` is static markup: it is in the DOM on
// every route, so without this check the two boot-time callers rebuilt the whole
// dashboard — a full pass over allIRs plus a large innerHTML parse, measured at ~21ms
// for 600 IRs — while the IR list owned the screen. Asserted by OUTCOME, not by
// reading the source: the pane is emptied, the render is called while another pane
// owns the screen, and the empty body is what proves nothing was painted.
{
  T.allIRs = FIXTURE;
  T.insightsFilters = Object.assign({}, ALL_ON);
  T.currentView = 'insights';
  T.renderInsights();
  const painted = byId.get('insights-body').innerHTML;
  T.currentView = 'index';
  byId.get('insights-body').innerHTML = 'CANARY';
  T.renderInsights();
  r.ok('while another pane owns the screen the body is untouched',
    byId.get('insights-body').innerHTML === 'CANARY',
    byId.get('insights-body').innerHTML.slice(0, 120));
  r.ok('and it really had something to paint',
    painted.includes('insights-card') || painted.includes('insights-filters'),
    painted.slice(0, 120));

  // The gate is only safe because it is the SAME predicate renderLayout() uses to
  // decide whether the pane is on screen. Pin the two together: if the layout ever
  // starts showing #insights-view on some other condition, the gate would silently
  // start hiding a pane the user is looking at.
  const laySrc = code.slice(code.indexOf('function renderLayout()'));
  r.ok('renderLayout decides the pane is on screen on the same predicate the gate uses',
    /const insights = currentView === 'insights'/.test(laySrc) &&
    /insightsView\.style\.display = insights \?/.test(laySrc.slice(0, 4000)),
    (laySrc.match(/[^\n]*insightsView\.style\.display[^\n]*/) || [''])[0]);

  // Showing it again is what makes the gate safe: showInsights() repaints
  // unconditionally, so the pane can never be left showing a stale body.
  T.showInsights();
  r.ok('showing the pane repaints it from the list already in memory',
    byId.get('insights-body').innerHTML !== 'CANARY' &&
    byId.get('insights-body').innerHTML.includes('insights-filters'),
    byId.get('insights-body').innerHTML.slice(0, 120));
}

r.head('the search box is rate-limited, and the last keystroke is the one that paints');
// Typing used to repaint the whole list once per keystroke — ~64ms of main-thread
// work per character at 600 IRs, the largest measured cost on any human-scale
// interaction. The listener is now leading+trailing throttled. What matters, and what
// these assert, is the pair of properties that make that safe: the FIRST input is
// immediate, and the LAST state is always the one painted.
{
  T.currentView = 'insights';   // the count label lives on the list, but the render does not care
  const seen = [];
  const spy = T.throttleTrailing(() => seen.push(T.searchInput.value), 60);
  T.searchInput.value = 'i';
  spy(); T.searchInput.value = 'ir'; spy();
  T.searchInput.value = 'ir4'; spy(); T.searchInput.value = 'ir41'; spy();
  r.ok('the first call is immediate, not deferred', seen.length === 1 && seen[0] === 'i', seen);
  await new Promise(res => setTimeout(res, 140));
  r.ok('and exactly one trailing call follows, carrying the LAST value',
    seen.length === 2 && seen[1] === 'ir41', seen);
  await new Promise(res => setTimeout(res, 140));
  r.ok('with no further calls once the keyboard is still', seen.length === 2, seen);

  // The throttle is on the LISTENER only. The render itself must stay immediate,
  // because the segment strip, the category strip, loadIRState() and patchIRState()
  // all call applyListFilters() directly and each must land on the tick it was asked.
  T.currentView = 'insights';
  T.allIRs = FIXTURE;
  T.setListView('list');   // this block asserts on #ir-list, so it asks for the List
  T.searchInput.value = 'ird';
  T.applyListFilters();
  r.ok('applyListFilters() still paints on the tick it is called',
    byId.get('ir-list').innerHTML.includes('IRd') &&
    !byId.get('ir-list').innerHTML.includes('IRa'),
    byId.get('ir-list').innerHTML.slice(0, 160));
  T.searchInput.value = '';
  T.applyListFilters();
  r.ok('the source wires the listener through throttleTrailing, not straight to the render',
    /searchInput\.addEventListener\('input',\s*throttleTrailing\(applyListFilters/.test(code),
    (code.match(/searchInput\.addEventListener\([^\n]*/) || [''])[0]);
}

r.head('the postman post is numbered forever and explains itself');
{
  r.ok('the subject is the exact form the owner asked for, zero-padded',
    T.postmanSubject(1) === 'I-PASSBOOK POSTMAN BRINGS POST NO. #001 TO CR' &&
    T.postmanSubject(42) === 'I-PASSBOOK POSTMAN BRINGS POST NO. #042 TO CR',
    [T.postmanSubject(1), T.postmanSubject(42)]);
  r.ok('...and the series does not wrap at 999',
    T.postmanSubject(1000) === 'I-PASSBOOK POSTMAN BRINGS POST NO. #1000 TO CR',
    T.postmanSubject(1000));

  const d = T.postmanDigest([
    { irNumber: 'IR1', customerName: 'test person',   contactEmail: 'test.reporter@example.com' },
    { irNumber: 'IR2', customerName: 'TEST PERSON S', contactEmail: 'test.reporter@example.com' },
    { irNumber: 'IR3', droneId: 'S100-1234', droneIdRaw: 'S100-1234', droneModel: 'SIGMA 100' },
  ]);
  // An email is a conversation with a person (owner, 2026-10-21): it opens by
  // addressing CR, says what is wanted before saying anything else, and explains every
  // finding in the same three beats — why, what to do, then the IRs.
  r.ok('the mail is a letter, and it addresses CR first',
    /^Dear CR,/.test(d.text) &&
    /Regards,[\r\n]+I-PASSBOOK POSTMAN$/.test(d.text.trim()),
    d.text.slice(0, 200));
  r.ok('...it says what it needs before it lists anything',
    d.text.indexOf('WHAT I NEED FROM YOU') > 0 &&
    d.text.indexOf('WHAT I NEED FROM YOU') < d.text.indexOf('SERIALS THAT FIT NO FORMAT'),
    d.text.slice(0, 600));
  r.ok('...and every finding is explained the same way: why, then what to do',
    /Why I am asking:/.test(d.text) && /What to do:/.test(d.text));
  r.ok('the digest is signed by I-PASSBOOK POSTMAN, and names no other bot',
    /I-PASSBOOK POSTMAN/.test(d.text) && !/POSTMASTER/.test(d.text));
  r.ok('a merge the app did itself is reported, not asked',
    /SPELLINGS I MERGED/.test(d.text) && /TEST PERSON S/.test(d.text) &&
    /What to do: nothing/.test(d.text), d.text);
  r.ok('a merge is NOT counted as an item needing a decision', d.count === 1, d);
}

// ── SETUP is not the dashboard ────────────────────────────────────────────────
// The owner, 2026-10-21: *"whole insights page is cluttered, whole inspector and
// postman thing should be kept separately and not in insights. Insights is simply for
// someone to take info from stats."* So the two panes are asserted as a PAIR: the
// dashboard still counts, and the Inspector does not appear on it.
r.head('Insights counts, Setup repairs');
{
  T.currentView = 'insights';
  T.allIRs = FIXTURE;
  T.insightsFilters = Object.assign({}, ALL_ON);
  T.renderInsights();
  const dash = byId.get('insights-body').innerHTML;
  r.ok('the dashboard carries no Inspector panel and no correction box',
    !/banner|I-INSPECTOR/.test(dash) && !/ins-assign/.test(dash) && !/ins-flags/.test(dash),
    (dash.match(/I-INSPECTOR/) || [''])[0]);
  r.ok('...and no ledger of corrections', !/corrections? in force/.test(dash));

  T.currentUser = { email: 'dev@indrones.com', access: { role: 'admin', departments: ['cr'], permissions: {}, triage: true, revokedBy: {} } };
  T.currentView = 'setup';
  T.renderSetup();
  const setup = byId.get('setup-body').innerHTML;
  r.ok('Setup carries the Inspector, the Postman and the one-IR box',
    /I-INSPECTOR/.test(setup) && /I-PASSBOOK POSTMAN/.test(setup) && /ins-assign-ir/.test(setup));
  r.ok('...and it is gated exactly like the dashboard: another pane owns the screen, nothing is painted',
    (() => {
      T.currentView = 'index';
      byId.get('setup-body').innerHTML = 'CANARY';
      T.renderSetup();
      return byId.get('setup-body').innerHTML === 'CANARY';
    })());
  T.currentUser = null;
  T.currentView = 'insights';
}

// ── The sparkline, opened ──────────────────────────────────────────────────────
r.head('the month chart can be opened into its own numbers');
{
  T.currentView = 'insights';
  T.allIRs = FIXTURE;
  T.insightsFilters = Object.assign({}, ALL_ON);
  T.renderInsights();
  const h = byId.get('insights-body').innerHTML;
  r.ok('a month-by-month table sits behind a summary', /<details class="insights-12m"/.test(h) &&
    /Month by month/.test(h));
  r.ok('...with one row per month and a total', (h.match(/<th scope="row">/g) || []).length >= 13 &&
    /<tfoot>/.test(h));
}

r.finish();
