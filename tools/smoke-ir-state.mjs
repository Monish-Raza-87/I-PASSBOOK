// Smoke test for the app-owned workflow-state layer (`__IRS__`).
//
//   node tools/smoke-ir-state.mjs
//
// See tools/harness.mjs for how app.js is loaded and reached into.
//
// What it covers is the risky part of the Frappe pivot: precedence between the
// Sheet's Col D and the app's own status, and the exact point at which the app
// takes a ticket's status over. Stage 4 (ageing, SLA) and Stage 5 (dashboard)
// both read these values, so a regression here is silent and expensive.

import { loadApp, makeReporter } from './harness.mjs';

const T = loadApp(`
  setAllIRs, applyIRStateToAllIRs, appState, ownedStatus, markSectionDone, initialsOf,
  statusCategory, IR_STATUS_VALUES, IR_CATEGORIES, REPAIR_SUBCATEGORIES, REPAIR_OTHERS,
  get allIRs() { return allIRs; },
  get irState() { return irState; }, set irState(v) { irState = v; },
  get currentIR() { return currentIR; }, set currentIR(v) { currentIR = v; },
`);

// ── Assertions ────────────────────────────────────────────────────────────────
const { ok, head, finish } = makeReporter();

head('constants');
ok('14 status values, unchanged', T.IR_STATUS_VALUES.length === 14, T.IR_STATUS_VALUES);
ok("statuses are the Form's exact strings",
  T.IR_STATUS_VALUES.includes('QC Investigation') && T.IR_STATUS_VALUES.includes('Remote Support'),
  T.IR_STATUS_VALUES);
ok('the four categories, in the order the desk reads them',
  T.IR_CATEGORIES.join('|') === 'CRASH|GENERAL MAINTENANCE|REMOTE SUPPORT|REPAIR', T.IR_CATEGORIES);
ok('nine REPAIR sub-categories, OTHERS last',
  T.REPAIR_SUBCATEGORIES.length === 9 && T.REPAIR_SUBCATEGORIES[8] === 'OTHERS', T.REPAIR_SUBCATEGORIES);
// The escape hatch has to be one of the sub-categories, or `subCategory === OTHERS`
// silently never matches and the note field can never be filled.
ok('...and the escape hatch is spelled the same in both places',
  T.REPAIR_OTHERS === 'OTHERS' && T.REPAIR_SUBCATEGORIES.includes(T.REPAIR_OTHERS), T.REPAIR_OTHERS);

head('merge precedence (app > Sheet)');
// Three tickets as fetchIRsFromSheet hands them over: status from Col D.
T.setAllIRs([
  { irNumber: 'IR409', status: 'Inward',            droneId: 'S25G-1', dateRaised: '1 Aug' },
  { irNumber: 'IR410', status: 'Visual Inspection', droneId: 'S75-2',  dateRaised: '2 Aug' },
  { irNumber: 'IR411', status: 'Open',              droneId: 'F-3',    dateRaised: '3 Aug' },
]);
T.irState = {
  // Triaged: the app owns the status.
  IR409: { status: 'Production', statusOwned: true, statusAt: 1, statusBy: 'a@indrones.com',
           assignee: 'ravi@indrones.com', assigneeName: 'Ravi Singh', priority: 'Urgent',
           category: 'REPAIR', subCategory: 'GPS', subCategoryNote: '',
           done: ['sec-a', 'sec-b'], updatedBy: 'a@indrones.com' },
  // First-sight seed: the app has seen this ticket but nobody has edited it.
  IR410: { status: '', seededAt: 1, seededFrom: 'sheet', seededBy: 'a@indrones.com' },
  // Section B saved (a real edit) but the status was never set by the app.
  IR411: { done: ['sec-b'], updatedBy: 'a@indrones.com' },
};
T.applyIRStateToAllIRs();
const by = n => T.allIRs.find(i => i.irNumber === n);

ok('app status beats Sheet Col D', by('IR409').status === 'Production', by('IR409').status);
ok('assignee lands on the record', by('IR409').assigneeName === 'Ravi Singh', by('IR409').assignee);
ok('priority lands on the record', by('IR409').priority === 'Urgent', by('IR409').priority);
ok('category lands on the record', by('IR409').category === 'REPAIR', by('IR409').category);
ok('sub-category lands beside it', by('IR409').subCategory === 'GPS', by('IR409').subCategory);
// The retired `type` key must not survive on the merged row: the store still holds
// it for every IR triaged before this field existed, and applyIRStateToAllIRs is
// the only place that could carry it back onto a record the UI then renders.
ok('...and the retired `type` is NOT read off the store', by('IR409').type === undefined, by('IR409').type);
ok('done[] lands on the record', by('IR409').done.length === 1, by('IR409').done);
ok('a bare seed does NOT claim the status', by('IR410').status === 'Visual Inspection', by('IR410').status);
ok('a bare seed exposes no assignee', !by('IR410').assignee, by('IR410').assignee);
ok('a bare seed exposes no category', !by('IR410').category, by('IR410').category);
ok('saving a section does NOT claim the status', by('IR411').status === 'Open', by('IR411').status);
ok('but it does record the section as done', by('IR411').done.join(',') === 'sec-b', by('IR411').done);
ok('appState() rejects a bare seed', T.appState('IR410') === null, T.appState('IR410'));
ok('appState() accepts a real edit', !!T.appState('IR409'));
ok('ownedStatus() is empty for a section-save-only row', T.ownedStatus('IR411') === '', T.ownedStatus('IR411'));
ok('ownedStatus() returns the triaged status', T.ownedStatus('IR409') === 'Production', T.ownedStatus('IR409'));

head('the badge bug, and that it is fixed');
// Before: the list badge read Col D, so an in-app status change never showed —
// even though everything else about the change was saved correctly.
ok('IR409 badge shows the app value, not Inward', by('IR409').status === 'Production', by('IR409').status);
ok('and it colours by the new category', T.statusCategory('Production') === 'open', T.statusCategory('Production'));
ok('Hold still maps to paused', T.statusCategory('Hold') === 'paused');
ok('Delivered still maps to resolved', T.statusCategory('Delivered') === 'resolved');

head('a Sheet edit cannot overwrite a triaged ticket');
T.setAllIRs([{ irNumber: 'IR409', status: 'Close', droneId: 'S25G-1', dateRaised: '1 Aug' }]);
ok('re-fetch + re-merge keeps the app value', by('IR409').status === 'Production', by('IR409').status);

head('section completion');
// `sec-a` is RETIRED and `sec-h`/`sec-i` were merged away: they must be dropped from
// `done[]` on the way out of the store, and must not be addable. Without the filter a
// stale or half-migrated `__IRS__` row would resurrect them, and a retired id in
// `done[]` renders as a tick on a section that no longer has a pane.
ok('markSectionDone adds', T.markSectionDone('IR409', 'sec-c').join(',') === 'sec-b,sec-c', T.markSectionDone('IR409', 'sec-c'));
ok('markSectionDone drops a retired id silently',
  T.markSectionDone('IR409', 'sec-a').join(',') === 'sec-b', T.markSectionDone('IR409', 'sec-a'));
ok('markSectionDone is idempotent', (() => {
  const once = T.markSectionDone('IR409', 'sec-b');
  return once.join(',') === T.markSectionDone('IR409', 'sec-b').join(',') && once.filter(x => x === 'sec-b').length === 1;
})(), T.markSectionDone('IR409', 'sec-b'));
ok('markSectionDone does not mutate irState', T.irState.IR409.done.join(',') === 'sec-a,sec-b', T.irState.IR409.done);
ok('a brand-new IR starts its done list', T.markSectionDone('IR999', 'sec-b').join(',') === 'sec-b');

head('retired section ids are filtered out of the store');
T.setAllIRs([{ irNumber: 'IR412', status: 'Open' }]);
T.irState = { IR412: { done: ['sec-a', 'sec-b', 'sec-g', 'sec-h', 'sec-i'], updatedBy: 'a@indrones.com' } };
T.applyIRStateToAllIRs();
// sec-a/h/i are gone; sec-g is a LIVE id (the merged PDI section) and must survive —
// which is exactly the distinction a blanket "drop anything that moved" filter gets
// wrong, and why the filter is against SECTION_IDS and not against SEC_TARGET_MAP.
ok('sec-a / sec-h / sec-i are filtered out of ir.done',
  by('IR412').done.join(',') === 'sec-b,sec-g', by('IR412').done);
T.irState = { IR412: { done: 'not-an-array', updatedBy: 'a@indrones.com' } };
T.applyIRStateToAllIRs();
ok('a malformed done[] becomes an empty array, not a crash', Array.isArray(by('IR412').done) && by('IR412').done.length === 0,
  by('IR412').done);

head('initials');
ok('"Monish Raza" → MR', T.initialsOf('Monish Raza') === 'MR', T.initialsOf('Monish Raza'));
ok('email → MR', T.initialsOf('monish.raza@indrones.com') === 'MR', T.initialsOf('monish.raza@indrones.com'));
ok('single word → 2 chars', T.initialsOf('Ravi') === 'RA', T.initialsOf('Ravi'));
ok('empty → ?', T.initialsOf('') === '?', T.initialsOf(''));
ok('undefined does not throw', T.initialsOf(undefined) === '?');

head('records with no Sheet date (legacy / demo paths)');
T.setAllIRs([{ irNumber: 'IR900', status: 'Open' }]);
ok('missing dateRaised survives the merge', by('IR900').dateRaised === undefined);
ok('missing droneId survives the merge', by('IR900').droneId === undefined);

head('an IR triaged before Category existed');
// The store still holds `type: 'Repair'` on every IR triaged under the old field.
// Nothing may resurrect it: the plan's decision was to CLEAR the old values, and
// a read site that still consulted `type` would show one on exactly the IRs CR has
// not re-triaged yet — which is the whole population the change is about.
T.setAllIRs([{ irNumber: 'IR413', status: 'Open' }]);
T.irState = { IR413: { status: 'Production', statusOwned: true, type: 'Repair', updatedBy: 'a@indrones.com' } };
T.applyIRStateToAllIRs();
ok('the old value is not carried onto the record', by('IR413').type === undefined, by('IR413').type);
ok('and the category is empty, not invented', by('IR413').category === '', JSON.stringify(by('IR413').category));
// A cleared category is a REAL state the store can hold (CR re-triages a REPAIR to
// REMOTE SUPPORT, and the sub-category is dropped with it). `if (s.category)` would
// leave the previous value on the in-memory row, so the list would keep showing a
// sub-category the store no longer has.
T.irState = { IR413: { category: 'REMOTE SUPPORT', subCategory: '', subCategoryNote: '', updatedBy: 'a@indrones.com' } };
T.applyIRStateToAllIRs();
ok('a cleared sub-category really clears', by('IR413').subCategory === '', JSON.stringify(by('IR413').subCategory));
ok('...and the note with it', by('IR413').subCategoryNote === '', JSON.stringify(by('IR413').subCategoryNote));

finish();
