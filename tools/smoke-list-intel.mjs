// Smoke test for the two list-intelligence stages: the completion count
// (Stage 3) and the ageing clock with its overdue flags (Stage 4).
//
//   node tools/smoke-list-intel.mjs
//
// Both of these fail SILENTLY and in the same direction, which is why they are
// pinned together: they turn an absence into a number. A ticket nobody has
// touched must not read "0/6 sections saved" as though six forms were waiting,
// and a ticket with no timestamp must not read "0d" as though it were raised
// this morning. The whole `__IRS__` design rests on the app never inventing a
// timestamp; an age is exactly where that rule gets broken by accident, because
// `Date.now() - 0` is a perfectly good number.
//
// So the test is mostly about the CASES THAT MUST RETURN NOTHING, and about the
// two dates that look interchangeable and are not: `ir.statusAt` is a real clock
// the app wrote, `ir.dateRaisedISO` is the client's raise date, and
// `ir.dateRaised` — the one actually displayed — is a display string the Sheet
// supplied and is deliberately not parseable here.

import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();
const DAY = 86400000;

// "now", anchored to the REAL clock rather than a frozen date.
//
// It was `Date.UTC(2026, 8, 18, 12, 0, 0)` — a fixed 18 Sep 2026 — and that quietly
// rotted: the unit assertions below all PASS `NOW` explicitly, so they stayed
// deterministic, but every assertion made against a RENDERED card did not.
// `renderIRList` calls `irAge(ir)` with no clock, so it ages the fixture against
// Date.now() while the fixture was built from the frozen NOW. A `statusAt` of
// "9 days before 18 Sep" reads "In status 9d" on the 18th and "10d" on the 19th,
// and the suite went red at 17:30 IST on 2026-09-19 for no reason but the date.
//
// Tracking the real clock fixes the whole class at once: the fixture and the
// renderer then read the same clock, and `NOW - n * DAY` renders as exactly n for
// any n, on any day, forever. The explicit-clock arithmetic below is unchanged and
// is still fully deterministic, because it supplies `now` itself.
const NOW = Date.now();

const { T, byId } = loadApp(`
  sectionProgress, daysSince, irAge, irOverdue, irOverdueLimit,
  IR_OVERDUE_DAYS, IR_OVERDUE_DEFAULT_DAYS, DAY_MS,
  ageLabel, ageTitle, overdueTitle, progressChip, wantProgress,
  renderIRList, renderBannerMeta, mergeLegacyOnlyIRs, applyIRStateToAllIRs,
  SECTION_IDS, statusCategory, SEGMENT_LABELS,
  get allIRs() { return allIRs; }, set allIRs(v) { allIRs = v; },
  get irState() { return irState; }, set irState(v) { irState = v; },
  get legacyMap() { return legacyMap; }, set legacyMap(v) { legacyMap = v; },
  get currentIR() { return currentIR; }, set currentIR(v) { currentIR = v; },
  get currentView() { return currentView; }, set currentView(v) { currentView = v; },
  irList,
`, { capture: true });

const isoDaysAgo = n => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const ir = (over = {}) => ({ irNumber: 'IR500', status: 'Open', ...over });

// ── Stage 3: the completion count ─────────────────────────────────────────────
r.head('the completion count');

r.ok('the denominator is the six live sections, pinned to SECTION_IDS',
  T.sectionProgress([]).total === 6 && T.sectionProgress([]).total === T.SECTION_IDS.length,
  { total: T.sectionProgress([]).total, live: T.SECTION_IDS.length });

r.ok('two saved sections count two',
  T.sectionProgress(['sec-b', 'sec-c']).done === 2, T.sectionProgress(['sec-b', 'sec-c']));

// The store still holds `sec-a`/`sec-h`/`sec-i` markers from the nine-section
// shell. Counting one would promise a section that has neither tab nor pane.
r.ok('a RETIRED section id is not counted',
  T.sectionProgress(['sec-b', 'sec-a', 'sec-h', 'sec-i']).done === 1,
  T.sectionProgress(['sec-b', 'sec-a', 'sec-h', 'sec-i']));

r.ok('an unknown id is not counted',
  T.sectionProgress(['sec-b', 'sec-zz']).done === 1);

r.ok('a missing or junk done[] counts zero, never NaN',
  T.sectionProgress(undefined).done === 0 && T.sectionProgress(null).done === 0 &&
  T.sectionProgress('sec-b').done === 0 && T.sectionProgress({}).done === 0,
  [T.sectionProgress(undefined).done, T.sectionProgress('sec-b').done]);

r.ok('a duplicated id counts once, and can never exceed the six live ids',
  T.sectionProgress(['sec-b', 'sec-b']).done === 1 &&
  T.sectionProgress(['sec-b', 'sec-c', 'sec-b', 'junk', 'junk']).done === 2,
  [T.sectionProgress(['sec-b', 'sec-b']).done, T.sectionProgress(['sec-b', 'sec-c', 'sec-b', 'junk', 'junk']).done]);
r.ok('a store row full of junk cannot render more than 6',
  T.sectionProgress(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).done === 0);
r.ok('every live id saved is exactly the total',
  T.sectionProgress(T.SECTION_IDS).done === T.SECTION_IDS.length);

const chip = T.progressChip({ done: 3, total: 6 });
r.ok('the chip writes the count and the p3 fill class',
  chip.includes('ir-progress p3') && chip.includes('>3/6<') && chip.includes('3 of 6 sections saved'),
  chip);
r.ok('a full passbook is marked complete and says so',
  T.progressChip({ done: 6, total: 6 }).includes('is-complete') &&
  T.progressChip({ done: 6, total: 6 }).includes('All 6 sections saved'));
// The card is asserted elsewhere to carry no attribute the renderer did not
// write, so the fill must not arrive as an inline style.
r.ok('the fill is a class, never an inline style',
  !chip.includes('style=') && !T.progressChip({ done: 6, total: 6 }).includes('style='), chip);

r.ok('a legacy-only record with nothing saved gets NO chip',
  T.wantProgress({ isLegacyOnly: true }, { done: 0, total: 6 }) === false);
r.ok('...but a legacy-only record WITH saved sections does',
  T.wantProgress({ isLegacyOnly: true }, { done: 2, total: 6 }) === true);
r.ok('a normal record always gets one',
  T.wantProgress({}, { done: 0, total: 6 }) === true);

// ── Stage 4: the clock ────────────────────────────────────────────────────────
r.head('the clock, and what it measures');

r.ok('daysSince floors whole days', T.daysSince(NOW - (3 * DAY + 1000), NOW) === 3, T.daysSince(NOW - 3 * DAY - 1000, NOW));
r.ok('a few hours old is 0 days, not 1', T.daysSince(NOW - 3600000, NOW) === 0);
// A laptop whose clock runs fast must not produce "-1 days" on a screenshot.
r.ok('a timestamp in the future reads 0, never negative',
  T.daysSince(NOW + 5 * DAY, NOW) === 0, T.daysSince(NOW + 5 * DAY, NOW));
r.ok('a non-number has no answer at all', T.daysSince('yesterday', NOW) === null && T.daysSince(undefined, NOW) === null);

r.ok('an app-recorded status change is an "in status" clock',
  T.irAge(ir({ statusAt: NOW - 6 * DAY }), NOW).days === 6 &&
  T.irAge(ir({ statusAt: NOW - 6 * DAY }), NOW).basis === 'status',
  T.irAge(ir({ statusAt: NOW - 6 * DAY }), NOW));

r.ok('with no statusAt it falls back to the raise date, and SAYS SO',
  T.irAge(ir({ dateRaisedISO: isoDaysAgo(21) }), NOW).days === 21 &&
  T.irAge(ir({ dateRaisedISO: isoDaysAgo(21) }), NOW).basis === 'raised',
  T.irAge(ir({ dateRaisedISO: isoDaysAgo(21) }), NOW));

r.ok('the app clock wins over the raise date when both exist',
  T.irAge(ir({ statusAt: NOW - 2 * DAY, dateRaisedISO: isoDaysAgo(90) }), NOW).basis === 'status');

// `applyIRStateToAllIRs` writes `statusAt: s.statusAt || null`, so an explicit
// null is a real value on the merged record and must not be treated as a clock.
r.ok('an explicit null statusAt falls through to the raise date',
  T.irAge(ir({ statusAt: null, dateRaisedISO: isoDaysAgo(5) }), NOW).days === 5);

r.ok('no timestamp anywhere means NO clock — not zero days',
  T.irAge(ir({}), NOW) === null && T.irAge(ir({ dateRaisedISO: '' }), NOW) === null,
  [T.irAge(ir({}), NOW), T.irAge(ir({ dateRaisedISO: '' }), NOW)]);

// The trap this whole suite exists for: `dateRaised` is what the card displays
// ("28 Sep 2025") and it is NOT a date this app may compute from — the clean one
// is dateRaisedISO. Falling back to it would hand every legacy record a clock.
r.ok('the DISPLAY-only dateRaised is not a clock',
  T.irAge(ir({ dateRaised: isoDaysAgo(40) }), NOW) === null, T.irAge(ir({ dateRaised: isoDaysAgo(40) }), NOW));
r.ok('a JS Date string is not accepted as the ISO date either',
  T.irAge(ir({ dateRaisedISO: '2026-08-01T00:00:00Z' }), NOW) === null);

// Written with isoDaysAgo rather than two hard-coded dates: the assertion is that
// a raise date is read as UTC midnight, which is a claim about the DATE STRING,
// not about 18 September. Hard-coding the pair pinned it to the calendar the suite
// happened to be written on and would have expired the next day.
r.ok('the raise date is read as UTC midnight, so it does not drift by a day',
  T.irAge(ir({ dateRaisedISO: isoDaysAgo(0) }), NOW).days === 0 &&
  T.irAge(ir({ dateRaisedISO: isoDaysAgo(1) }), NOW).days === 1,
  [T.irAge(ir({ dateRaisedISO: isoDaysAgo(0) }), NOW).days, T.irAge(ir({ dateRaisedISO: isoDaysAgo(1) }), NOW).days]);

r.head('the wording says which clock it is');
const inStatus = T.irAge(ir({ statusAt: NOW - 6 * DAY }), NOW);
const raised   = T.irAge(ir({ dateRaisedISO: isoDaysAgo(21) }), NOW);
r.ok('an app clock reads "In status Nd"', T.ageLabel(inStatus) === 'In status 6d', T.ageLabel(inStatus));
r.ok('a raise-date clock reads "Raised Nd ago" — it is NOT called "in status"',
  T.ageLabel(raised) === 'Raised 21d ago', T.ageLabel(raised));
r.ok('no clock means no label', T.ageLabel(null) === '', T.ageLabel(null));
r.ok('the title names the date the number came from',
  T.ageTitle(ir({ statusAt: NOW - 6 * DAY }), inStatus).includes('Status last changed') &&
  T.ageTitle(ir({ dateRaisedISO: isoDaysAgo(21) }), raised).includes('Raised'),
  [T.ageTitle(ir({ statusAt: NOW - 6 * DAY }), inStatus), T.ageTitle(ir({ dateRaisedISO: isoDaysAgo(21) }), raised)]);
r.ok('...and the raise-date title admits the status may have moved since',
  /not of its status/.test(T.ageTitle(ir({ dateRaisedISO: isoDaysAgo(21) }), raised)));

// ── Stage 4: overdue ──────────────────────────────────────────────────────────
r.head('overdue, by priority');

r.ok('the limits are the owner\'s: Urgent 1, High 3, Medium 7, Low 14',
  T.irOverdueLimit('Urgent') === 1 && T.irOverdueLimit('High') === 3 &&
  T.irOverdueLimit('Medium') === 7 && T.irOverdueLimit('Low') === 14,
  { u: T.irOverdueLimit('Urgent'), h: T.irOverdueLimit('High'), m: T.irOverdueLimit('Medium'), l: T.irOverdueLimit('Low') });
r.ok('the default is the LOOSEST limit, so an unprioritised ticket is not flagged early',
  T.irOverdueLimit('') === T.IR_OVERDUE_DEFAULT_DAYS && T.IR_OVERDUE_DEFAULT_DAYS === Math.max(...Object.values(T.IR_OVERDUE_DAYS)),
  T.irOverdueLimit(''));
r.ok('case and stray whitespace do not escape the map',
  T.irOverdueLimit('high') === 3 && T.irOverdueLimit('  High ') === 3,
  [T.irOverdueLimit('high'), T.irOverdueLimit('  High ')]);
r.ok('an unknown priority takes the default, not a wrong limit',
  T.irOverdueLimit('Whenever') === T.IR_OVERDUE_DEFAULT_DAYS);

const aged = (n, over = {}) => ir({ statusAt: NOW - n * DAY, ...over });
r.ok('High is overdue on day 3 (the limit is reached, not passed)',
  T.irOverdue(aged(3, { priority: 'High' }), NOW) !== null, T.irOverdue(aged(3, { priority: 'High' }), NOW));
r.ok('High is NOT overdue on day 2',
  T.irOverdue(aged(2, { priority: 'High' }), NOW) === null);
r.ok('Urgent is overdue on day 1, and not on day 0',
  T.irOverdue(aged(1, { priority: 'Urgent' }), NOW) !== null &&
  T.irOverdue(aged(0, { priority: 'Urgent' }), NOW) === null);
r.ok('Low waits 14 days',
  T.irOverdue(aged(13, { priority: 'Low' }), NOW) === null &&
  T.irOverdue(aged(14, { priority: 'Low' }), NOW) !== null);
r.ok('the flag carries the numbers, so the tooltip can be specific',
  JSON.stringify(T.irOverdue(aged(9, { priority: 'Medium' }), NOW)) ===
    JSON.stringify({ days: 9, limit: 7, basis: 'status' }),
  T.irOverdue(aged(9, { priority: 'Medium' }), NOW));

// Only a ticket still in the pipeline runs a clock. A paused or finished one is
// old, not late — flagging it would put a red badge on the archive.
r.head('only an OPEN ticket can be overdue');
['Hold', 'Delivered', 'Close', 'Other'].forEach(s => {
  r.ok(`a ${s} ticket is not overdue at 400 days`,
    T.irOverdue(ir({ status: s, statusAt: NOW - 400 * DAY, priority: 'Urgent' }), NOW) === null);
});
r.ok('...and an in-pipeline status IS (Flight Test is open, not finished)',
  T.irOverdue(ir({ status: 'Flight Test', statusAt: NOW - 400 * DAY, priority: 'Urgent' }), NOW) !== null);
r.ok('an overdue flag needs a clock: a ticket with no timestamp is never overdue',
  T.irOverdue(ir({ priority: 'Urgent' }), NOW) === null);
r.ok('the raise-date clock can flag overdue too, and says so in the basis',
  T.irOverdue(ir({ dateRaisedISO: isoDaysAgo(30), priority: 'Medium' }), NOW).basis === 'raised',
  T.irOverdue(ir({ dateRaisedISO: isoDaysAgo(30), priority: 'Medium' }), NOW));
r.ok('no ticket at all is not an overdue ticket',
  T.irOverdue(null, NOW) === null && T.irOverdue(undefined, NOW) === null);

r.ok('the tooltip names the clock, the days and the limit',
  /9 days in this status/.test(T.overdueTitle(aged(9, { priority: 'Medium' }), { days: 9, limit: 7, basis: 'status' })) &&
  /7-day limit for Medium priority/.test(T.overdueTitle(aged(9, { priority: 'Medium' }), { days: 9, limit: 7, basis: 'status' })),
  T.overdueTitle(aged(9, { priority: 'Medium' }), { days: 9, limit: 7, basis: 'status' }));
r.ok('an unprioritised overdue ticket says so rather than naming a priority',
  /unprioritised IR/.test(T.overdueTitle(ir({}), { days: 15, limit: 14, basis: 'raised' })),
  T.overdueTitle(ir({}), { days: 15, limit: 14, basis: 'raised' }));

// ── The rendered card ─────────────────────────────────────────────────────────
r.head('the card and the header render it');

T.allIRs = [
  ir({ irNumber: 'IR501', done: ['sec-b', 'sec-c'], statusAt: NOW - 9 * DAY,
       priority: 'Medium', status: 'Production', droneId: 'S25P014', dateRaised: '01 September 2026',
       dateRaisedISO: isoDaysAgo(40), category: 'REPAIR' }),
  ir({ irNumber: 'IR502', done: [], status: 'Open', dateRaisedISO: isoDaysAgo(2) }),
];
T.applyIRStateToAllIRs();
T.renderIRList(T.allIRs);
const card = byId.get('ir-list').innerHTML;

r.ok('a started ticket shows its count and fill class',
  /ir-progress p2/.test(card) && />2\/6</.test(card), card.match(/ir-progress[^"]*"[^>]*>[\s\S]{0,60}/));
r.ok('an untouched ticket shows 0/6 — the count is honest, not hidden',
  /ir-progress p0/.test(card) && />0\/6</.test(card));
r.ok('the overdue ticket is flagged, the fresh one is not',
  (card.match(/badge-danger/g) || []).length === 1, card.match(/badge-danger/g));
r.ok('the flag\'s tooltip names the limit for that ticket\'s priority',
  /7-day limit for Medium priority/.test(card), (card.match(/title="Overdue[^"]*"/) || [''])[0]);
r.ok('the age is on the card, worded as the app clock',
  /In status 9d/.test(card) && /ir-age is-late/.test(card));
r.ok('the second ticket is aged from its raise date, and says "Raised"',
  // The NUMBER is deliberately not pinned here. This fixture's raise date is fixed
  // text (`isoDaysAgo(2)` off the suite's NOW, i.e. 16 Sep 2026) while renderIRList
  // ages it against the real clock — so the card said "2d" on the 18th, "3d" on the
  // 19th, and the assertion rotted a day after it was written. The arithmetic is
  // pinned exactly, and date-independently, by the irAge unit assertions above,
  // which pass an explicit NOW; what belongs HERE is the wording and the BASIS.
  /Raised \d+d ago/.test(card) &&
  /This is the age of the IR, not of its status/.test(card),
  (card.match(/Raised [^<]*/) || [''])[0]);
r.ok('no card carries an inline style (smoke-intake pins the attribute set)',
  !/style=/.test(card), (card.match(/style="[^"]*"/) || [''])[0]);
// The date is real Sheet text and the category is writable by any signed-in
// user, so both land in an attribute here — they must arrive escaped.
T.allIRs = [ir({ irNumber: 'IR503', dateRaisedISO: isoDaysAgo(1), priority: '" onmouseover="alert(1)',
                 statusAt: NOW - 2 * DAY })];
T.applyIRStateToAllIRs();
T.renderIRList(T.allIRs);
const hostile = byId.get('ir-list').innerHTML;
r.ok('a hostile priority cannot add an attribute through the tooltip path',
  !/onmouseover="alert/.test(hostile), (hostile.match(/onmouseover[^>]{0,30}/) || [''])[0]);

// The header words it in full, from the same helpers.
T.currentIR = ir({ irNumber: 'IR501', done: ['sec-b', 'sec-c', 'sec-d'], statusAt: NOW - 9 * DAY, priority: 'Medium', status: 'Production' });
T.renderBannerMeta();
const banner = byId.get('ir-banner-pills').innerHTML;
r.ok('the header shows the same age, flagged late',
  /In status 9d/.test(banner) && /meta-pill meta-late/.test(banner), banner);
r.ok('the header flags overdue and shows the completion chip',
  /badge-danger/.test(banner) && /ir-progress p3/.test(banner), banner);
r.ok('the header and the card agree on the count for the same ticket',
  /3\/6/.test(banner) && T.sectionProgress(T.currentIR.done).done === 3);

// ── The legacy-only merge ─────────────────────────────────────────────────────
// Legacy stubs are appended to allIRs AFTER setAllIRs() has merged app-owned
// state. Without the merge being re-applied, a legacy IR that HAS been triaged
// in the app renders as untouched — and with Stage 3 on the card, as "0/6" over
// a ticket with saved sections.
r.head('a legacy-only IR keeps the app-owned state it has');
T.allIRs = [];
T.irState = { IR310: { assigneeName: 'Ravi Singh', category: 'REPAIR', done: ['sec-b'], status: 'Production', statusOwned: true, statusAt: NOW - 4 * DAY, updatedBy: 'a@indrones.com' } };
T.legacyMap = { IR310: { irNumber: 'IR310', label: 'Old record | S25P001' } };
T.mergeLegacyOnlyIRs();
T.renderIRList(T.allIRs);
const legacyCard = byId.get('ir-list').innerHTML;
r.ok('the stub exists and is marked legacy', T.allIRs.length === 1 && T.allIRs[0].isLegacyOnly === true);
r.ok('its app-owned CATEGORY survives into the list', /REPAIR/.test(legacyCard), legacyCard.slice(0, 300));
r.ok('its app-owned STATUS survives, not the stub\'s "Open"',
  /Production/.test(legacyCard) && !/>Open</.test(legacyCard), legacyCard.slice(0, 300));
r.ok('its saved section is counted — not 0/6',
  /ir-progress p1/.test(legacyCard) && />1\/6</.test(legacyCard),
  (legacyCard.match(/ir-progress[^"]*"[^>]*>/g) || [''])[0]);
// The stub itself carries no date. The app-owned statusAt on this one IS a real
// clock, so the age it shows must be the app's "in status", not a raise date the
// stub never had — and a stub with no triage at all must show no clock.
r.ok('a triaged legacy IR shows its app clock, worded as "In status"',
  /In status 4d/.test(legacyCard) && !/Raised/.test(legacyCard),
  (legacyCard.match(/(In status|Raised)[^<]*/g) || [''])[0]);

r.head('a legacy-only IR with no triage has no clock at all');
T.allIRs = [];
T.irState = {};
T.legacyMap = { IR312: { irNumber: 'IR312', label: 'Old record | S25P003' } };
T.mergeLegacyOnlyIRs();
T.renderIRList(T.allIRs);
const bare = byId.get('ir-list').innerHTML;
r.ok('no age chip without a timestamp — never "0d"', !/ir-age/.test(bare), bare.slice(0, 300));
r.ok('no overdue flag either', !/badge-danger/.test(bare));

r.head('a legacy-only IR with nothing saved gets no completion chip');
T.allIRs = [];
T.irState = {};
T.legacyMap = { IR311: { irNumber: 'IR311', label: 'Old record | S25P002' } };
T.mergeLegacyOnlyIRs();
T.renderIRList(T.allIRs);
r.ok('no chip over a historic record nobody has touched',
  !/ir-progress/.test(byId.get('ir-list').innerHTML), byId.get('ir-list').innerHTML.slice(0, 300));

// ── The list's local copy, and the failure path it makes honest ──────────────
// The list was blank until the whole repository had come down. Now this device's
// last copy paints first, and — more important than the speed — a total outage STOPS
// replacing a real list with five fabricated sample IRs. Someone with four hundred
// real IRs who is shown samples could act on one.
r.head("the IR list is painted from this device's last copy");
const SEED = [
  { irNumber: 'IR700', droneId: 'S25P900', dateRaised: '01-Aug-2026', status: 'Open',
    customerName: 'Real Customer', issueDesc: 'real one', intake: { spoc: 'real spoc' } },
];

// A fetch that never succeeds: the sheet read and the backend read both fail, which
// is the outage this branch exists for.
const deadFetch = () => Promise.reject(new Error('offline'));
function loadList(fetchImpl) {
  return loadApp(`
    fetchIRs, paintCachedIRList, readIRListCache, writeIRListCache,
    IR_LIST_CACHE_KEY, getDemoIRs,
    get allIRs() { return allIRs; }, set allIRs(v) { allIRs = v; },
    get dataIsDemo() { return _dataIsDemo; },
    get syncText() { return document.getElementById('sync-status').innerHTML; },
  `, { capture: true, fetch: fetchImpl || deadFetch });
}

// `loadApp` gives each instance its OWN localStorage, so the copy is seeded THROUGH
// the app (writeIRListCache writes `allIRs`) — the only way to reach the sandbox
// realm's storage from out here.
const A = loadList();
const seed = (T, records) => { T.allIRs = records; T.writeIRListCache(); T.allIRs = []; };
seed(A.T, SEED);
r.ok('the seeded copy is readable back, in the shape the list needs', (() => {
  const got = A.T.readIRListCache();
  return Array.isArray(got) && got.length === 1 && got[0].irNumber === 'IR700';
})(), A.T.readIRListCache());
r.ok('painting it puts a real card on screen with NO network at all', (() => {
  const painted = A.T.paintCachedIRList();
  return painted === true && A.T.allIRs.length === 1 && /IR700/.test(A.byId.get('ir-list').innerHTML);
})(), A.T.allIRs.length);
r.ok('and it does not paint over a list already on screen', (() => {
  // A manual refresh must not flash stale cards over the fresh ones it just got.
  A.T.allIRs = [{ irNumber: 'IR800', status: 'Open' }];
  return A.T.paintCachedIRList() === false && A.T.allIRs[0].irNumber === 'IR800';
})());
r.ok('a copy with no records is not a hit — an empty list is not a cached list', (() => {
  seed(A.T, []);
  return A.T.readIRListCache() === null;
})(), A.T.readIRListCache());

r.head('an outage NEVER replaces a real list with sample IRs');
const B = loadList();
B.T.allIRs = SEED;
await B.T.fetchIRs();
r.ok('the real records are still the ones in memory',
  B.T.allIRs.length === 1 && B.T.allIRs[0].irNumber === 'IR700', B.T.allIRs.map(x => x.irNumber));
r.ok('the demo flag stays OFF — nothing fabricated reaches the Insights page',
  B.T.dataIsDemo === false, B.T.dataIsDemo);
r.ok('and the status line names what actually happened, not "demo data"',
  /Could not refresh/.test(B.T.syncText) && !/demo data/.test(B.T.syncText), B.T.syncText);

r.head('a COLD start with nothing real still gets the sample cards');
const C = loadList();
await C.T.fetchIRs();
r.ok('nothing cached and nothing loaded → sample cards, flagged as demo',
  C.T.dataIsDemo === true && C.T.allIRs.length > 0, C.T.allIRs.length);
r.ok('and the wording is the one the demo notice is pinned to',
  /Could not sync — showing demo data/.test(C.T.syncText), C.T.syncText);

r.head('a successful sync replaces the copy, which is the whole invalidation story');
const SHEET = 'Timestamp,IR Number,Drone Serial,Customer Name\n2026-08-01,IR900,S25P901,Fresh Customer\n';
const liveFetch = url => String(url).indexOf('gviz/tq') >= 0
  ? Promise.resolve({ ok: true, text: () => Promise.resolve(SHEET), json: () => Promise.resolve({}) })
  : Promise.reject(new Error('backend not needed'));
const D = loadList(liveFetch);
seed(D.T, SEED);
r.ok('a fresh read puts the sheet records up and drops the stale ones', await (async () => {
  await D.T.fetchIRs();
  const now = D.T.allIRs.map(x => x.irNumber);
  return now.length === 1 && now[0] === 'IR900';
})(), D.T.allIRs.map(x => x.irNumber));
r.ok('...and writes them to the copy, so the next cold start paints the NEW list',
  (() => { const got = D.T.readIRListCache(); return !!got && got.length === 1 && got[0].irNumber === 'IR900'; })(),
  D.T.readIRListCache());
r.ok('the status line credits the Sheet, and no demo flag is set',
  /loaded from the Sheet/.test(D.T.syncText) && D.T.dataIsDemo === false, D.T.syncText);

r.finish();