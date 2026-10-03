// Smoke test for the workflow vocabulary — Release B.
//
//   node tools/smoke-workflow.mjs
//
// The ten stages replace fourteen statuses, and the Sheet stops writing two of the
// app's own fields. Three claims carry the whole release, and each of them has a way
// to be true on the developer's machine and false in the field:
//
//   1. THE TEN ARE THE VOCABULARY. What the dropdown OFFERS is the ten; the eight
//      retired words the store still holds stay READABLE by folding onto the stage
//      each one means. A fold that goes missing does not throw — an old ticket just
//      quietly changes colour, drops out of a filter total, or (worst) starts a
//      fresh clock on finished work.
//   2. THE SHEET CANNOT MOVE A STATUS. Its Col D is read ONCE per ticket, as that
//      ticket's STARTING stage, and the Sheet's Priority column is not read at all.
//      Re-adding either read would look reasonable and would split the record in two.
//   3. A REMOTE SUPPORT JOB HAS NO INWARD, INSPECTION, PRODUCTION, QC OR DISPATCH.
//      That is new machinery — nothing in the app could previously say "this step is
//      not part of this job" — so the tab, the pane, the Close button and the press
//      itself are each asserted, rather than the rule being read out of the source.
//
// The tab listener is wired at module level by `document.querySelectorAll('.tab')`,
// so a suite that only reaches into functions cannot press a tab. `preload` wraps the
// sandbox's own document with a Proxy that hands the app six real tab elements for
// that ONE selector and delegates everything else — which is what makes the press
// testable at all, and keeps the rest of app.js evaluating against the normal stub.

import { loadApp, makeReporter } from './harness.mjs';

const TABS = ['sec-b', 'sec-c', 'sec-d', 'sec-e', 'sec-f', 'sec-g'];

// A transport, because Allot CAPS persists through FormData. Without one the app
// cannot build the body at all (saveSentinel calls `new FormData()`), so a suite
// that leaves it out cannot reach the clock guard it is here to prove. Every post is
// recorded, so the assertions can also say WHAT was written, not just that something
// was. A `{status:'ok'}` answer keeps the "Saved locally" toast out of the way.
const POSTS = [];
const resp = (data) => {
  const r = { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  r.clone = () => resp(data);
  return r;
};
const FETCH = (url, init) => {
  POSTS.push({ url: String(url), body: init && init.body });
  return Promise.resolve(resp({ status: 'ok' }));
};

// Evaluated INSIDE the sandbox, before app.js — see tools/harness.mjs.
const PRELOAD = `
const __wfBase = document;
const __wfTabs = ${JSON.stringify(TABS)}.map(id => {
  const el = __wfBase.createElement('div');
  el.dataset.section = id;
  el.classList.add('tab');
  return el;
});
const __wfQsa = sel => (sel === '.tab' ? __wfTabs.slice() : __wfBase.querySelectorAll(sel));
document = new Proxy(__wfBase, {
  get(t, k) { return k === 'querySelectorAll' ? __wfQsa : t[k]; },
  set(t, k, v) { t[k] = v; return true; },
});
globalThis.__wfTabs = __wfTabs;
`;

const { T, byId } = loadApp(`
  IR_STATUS_VALUES, STATUS_LEGACY, canonicalStage, statusCategory, boardColumnOf,
  SECTION_IDS, REMOTE_SUPPORT_KEEPS, categoryInapplicableSections,
  applyCategoryApplicability, applySectionAccessGating, canEditSection,
  showSection, moveOnByHand,
  mapSheetRows, applyIRStateToAllIRs, ownedStatus, seedIRState, appState,
  openTriageModal, applyTriage,
  renderIRList, renderBannerMeta, statusLabel,
  setUser: u => { currentUser = u; },
  set allIRs(v) { allIRs = v; }, get allIRs() { return allIRs; },
  set irState(v) { irState = v; }, get irState() { return irState; },
  set currentIR(v) { currentIR = v; }, get currentIR() { return currentIR; },
  document, tabs: __wfTabs,
`, { preload: PRELOAD, capture: true, fetch: FETCH });

const { ok, head, finish } = makeReporter();

// ── 1. The ten, and the eight words they replace ──────────────────────────────
head('the ten stages are the vocabulary');

const TEN = ['Open', 'Inward', 'Inspection', 'Investigation', 'Production',
             'Quality Test', 'PDI/Dispatch', 'Delivered', 'On Hold', 'Remote Support'];
const RETIRED = ['Hold', 'Visual Inspection', 'QC Investigation', 'QC',
                 'Flight Test', 'PDI', 'Approval', 'Close'];
const FOLD = { 'Hold': 'On Hold', 'Visual Inspection': 'Inspection',
               'QC Investigation': 'Investigation', 'QC': 'Quality Test',
               'Flight Test': 'Quality Test', 'PDI': 'PDI/Dispatch',
               'Approval': 'PDI/Dispatch', 'Close': 'Delivered' };

ok('the app offers exactly the ten, in the desk\'s order',
  T.IR_STATUS_VALUES.join('|') === TEN.join('|'), T.IR_STATUS_VALUES.join('|'));
ok('no retired word is offered as a value any more',
  !T.IR_STATUS_VALUES.some(v => RETIRED.includes(v)), T.IR_STATUS_VALUES);
// The mapping is stated in full rather than as a property, because it is a DECISION:
// QC and Flight Test both fold to Quality Test, and PDI and Approval both fold to
// PDI/Dispatch. A change to any single row should be a conscious edit here.
ok('each retired word folds onto the stage it means',
  RETIRED.every(w => T.canonicalStage(w) === FOLD[w]),
  RETIRED.map(w => [w, T.canonicalStage(w)]));
ok('...and every target is one of the ten, so nothing folds into nothing',
  RETIRED.every(w => T.IR_STATUS_VALUES.includes(T.canonicalStage(w))));
ok('a stage folds to itself — the fold never renames a live value',
  T.IR_STATUS_VALUES.every(s => T.canonicalStage(s) === s));
ok('folding twice is folding once',
  [...TEN, ...RETIRED, '', 'Something New'].every(s => T.canonicalStage(T.canonicalStage(s)) === T.canonicalStage(s)));
ok('casing does not matter — the Sheet wrote its own spelling',
  T.canonicalStage('qc investigation') === 'Investigation' &&
  T.canonicalStage('HOLD') === 'On Hold' &&
  T.canonicalStage('  Flight Test  ') === 'Quality Test',
  [T.canonicalStage('qc investigation'), T.canonicalStage('HOLD')]);
// A value nobody recognises is RETURNED, not replaced. Swapping it for Open would
// hide exactly the row the desk needs to see: one the app cannot account for.
ok('a word nobody recognises passes through, so it stays visible',
  T.canonicalStage('Something New') === 'Something New');
ok('an empty status is Open, never a blank that renders as nothing',
  T.canonicalStage('') === 'Open' && T.canonicalStage(null) === 'Open' &&
  T.canonicalStage(undefined) === 'Open',
  [T.canonicalStage(''), T.canonicalStage(null), T.canonicalStage(undefined)]);
// The two readers that were rebuilt from the ten. Both go through canonicalStage, so
// an old ticket sits where the stage it MEANS sits, in the list and on the board.
ok('a retired word colours as the stage it means',
  T.statusCategory('Close') === T.statusCategory('Delivered') &&
  T.statusCategory('Hold') === T.statusCategory('On Hold') &&
  T.statusCategory('QC Investigation') === T.statusCategory('Investigation'),
  RETIRED.map(w => [w, T.statusCategory(w)]));
ok('...and sits in the same board column',
  RETIRED.every(w => T.boardColumnOf(w) === T.boardColumnOf(T.canonicalStage(w))),
  RETIRED.map(w => [w, T.boardColumnOf(w)]));

// ── 2. What the dropdown offers, and what it opens on ─────────────────────────
// Driven through the real modal builder rather than read out of the source: the
// option list, the selected one and the values are all what a browser would get.
head('Allot CAPS offers the ten, and opens on the ticket\'s stage');

T.setUser({ email: 'cr@indrones.com', sessionToken: 't',
            access: { role: 'user', permissions: {}, departments: [], triage: true } });

let built = null;
const realCreate = T.document.createElement;
T.document.createElement = () => (built = {
  className: '', id: '', innerHTML: '', remove() {},
});
const realGetById = T.document.getElementById;
const fake = {};
const fakeEl = (value) => ({ value, style: {}, classList: {
  contains: () => false, add() {}, remove() {}, toggle: () => false,
}, remove() {} });
T.document.getElementById = id => (id === 'triage-modal' ? null : (fake[id] || realGetById(id)));

const openFor = (ir) => {
  T.currentIR = ir;
  built = null;
  T.openTriageModal();
  const html = built ? built.innerHTML : '';
  const sel = (html.match(/<select[^>]*id="triage-status"[\s\S]*?<\/select>/) || [''])[0];
  return {
    html,
    values: [...sel.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]),
    selected: (sel.match(/<option value="([^"]*)" selected>/) || [])[1],
  };
};

const remote = openFor({ irNumber: 'IR700', status: 'Open', category: 'REMOTE SUPPORT', done: [] });
ok('the modal is built at all — otherwise every assertion below is vacuous',
  remote.html.includes('id="triage-status"'), remote.html.slice(0, 60));
ok('the status dropdown offers the ten and nothing else',
  remote.values.join('|') === TEN.join('|'), remote.values);
ok('...with no blank option, because a workflow status is never "none"',
  !remote.values.includes(''), remote.values);
ok('...and no retired word is offerable',
  !remote.values.some(v => RETIRED.includes(v)), remote.values);

const legacy = openFor({ irNumber: 'IR701', status: 'QC Investigation', category: 'REPAIR', done: [] });
ok('an old ticket opens on the stage its stored word means',
  legacy.selected === 'Investigation', legacy.selected);
ok('...so CR is never shown a blank box on a ticket that has a status',
  !!legacy.selected, legacy.selected);

// ── 3. The clock guard ────────────────────────────────────────────────────────
// `statusAt` is what "in status 3d" and every overdue limit are measured from. The
// comparison is against the ticket's STAGE, not its stored word — comparing the raw
// word would read a legacy ticket as changed on every single save, stamping a fresh
// clock and erasing the real time-in-status of exactly the tickets the fold carries
// forward.
head('saving Allot CAPS re-stamps the clock only for a real movement');

const triageAs = async (ir, pick) => {
  // The ticket goes into the list as well as the detail view, because that is what
  // a real open is: `currentIR` is a reference into `allIRs`, so the merge that runs
  // inside the save is what refreshes the row the NEXT save compares against.
  T.allIRs = [ir];
  T.currentIR = ir;
  Object.keys(fake).forEach(k => delete fake[k]);
  fake['triage-status'] = fakeEl(pick.status);
  fake['triage-assignee-email'] = fakeEl('');
  fake['triage-priority'] = fakeEl('');
  fake['triage-category'] = fakeEl(pick.category || 'CRASH');
  fake['triage-subcategory'] = fakeEl(pick.subCategory || '');
  fake['triage-subcat-note'] = fakeEl('');
  await T.applyTriage();
  return T.irState[ir.irNumber] || {};
};

// The ticket the Sheet called 'QC Investigation'; the box shows 'Investigation'.
const irLegacy = { irNumber: 'IR702', status: 'QC Investigation', category: 'REPAIR', done: [] };
const firstSave = await triageAs(irLegacy, { status: 'Investigation' });
ok('the stored word becomes the stage, so the store leaves the old vocabulary',
  firstSave.status === 'Investigation', firstSave.status);
ok('...and a save that moves nothing stamps no clock',
  firstSave.statusAt === undefined, firstSave.statusAt);

const moved = await triageAs(irLegacy, { status: 'Production' });
ok('a real movement does stamp the clock',
  typeof moved.statusAt === 'number' && moved.statusAt > 0, moved.statusAt);
ok('...and records who moved it', moved.statusBy === 'cr@indrones.com', moved.statusBy);
ok('...and the movement really reaches the store, not just memory',
  (() => {
    const last = POSTS.filter(p => p.body && p.body.get && p.body.get('sectionId') === 'IR702').pop();
    return !!last && last.body.get('irNumber') === '__IRS__' &&
           JSON.parse(last.body.get('fields')).status === 'Production';
  })(), POSTS.length);

const resaved = await triageAs(irLegacy, { status: 'Production' });
ok('re-saving the same stage moves nothing — the clock is not reset by an edit',
  resaved.statusAt === moved.statusAt, [moved.statusAt, resaved.statusAt]);

// ── 4. The move-on offer never re-stamps either ───────────────────────────────
head('the board\'s move-on offer is a movement, not a re-stamp');
T.irState = { IR703: { status: 'QC Investigation', updatedBy: 'a@indrones.com' } };
await T.moveOnByHand('IR703', 'Investigation');
ok('moving a ticket to the stage it is already held as does nothing at all',
  T.irState.IR703.status === 'QC Investigation' && T.irState.IR703.statusAt === undefined,
  T.irState.IR703);
await T.moveOnByHand('IR703', 'Production');
ok('...while a real movement writes the stage and the clock together',
  T.irState.IR703.status === 'Production' && typeof T.irState.IR703.statusAt === 'number',
  { status: T.irState.IR703.status, statusAt: T.irState.IR703.statusAt });

// ── 5. The Sheet is not a writer ──────────────────────────────────────────────
head('the Sheet hands over a starting stage, and can never move one');

const HEAD = ['Summary', 'IR Number', 'Timestamp', 'Issue Status'];
const mapOne = (status, extraHead = [], extraRow = []) =>
  T.mapSheetRows([HEAD.concat(extraHead), ['', 'IR800', '2025-09-28 14:02:03', status].concat(extraRow)])[0];

const fromSheet = mapOne('QC Investigation');
ok('the Sheet\'s Col D does not become the workflow status',
  fromSheet.status === '', JSON.stringify(fromSheet.status));
ok('...it is kept beside it as the intake record, unedited',
  fromSheet.initialStatus === 'QC Investigation', fromSheet.initialStatus);

T.allIRs = [fromSheet];
T.irState = {};
T.applyIRStateToAllIRs();
ok('a ticket nobody has opened takes the Sheet\'s stage as its STARTING value, folded',
  T.allIRs[0].status === 'Investigation', T.allIRs[0].status);
ok('...and the app holds no status of its own for it',
  T.ownedStatus('IR800') === '', T.ownedStatus('IR800'));
// The one read of Col D there is: the first time the app opens the ticket. What gets
// STORED is the folded stage, not the word the Sheet used — the store leaves the old
// vocabulary at the moment of adoption, so nothing downstream has to fold it again
// and no retired word is ever written back into __IRS__.
T.seedIRState('IR800', 'QC Investigation');
ok('opening the ticket stores the STAGE, folded as it is adopted',
  T.irState.IR800.status === 'Investigation', T.irState.IR800.status);
// And now the Sheet cannot move it: a re-fetch only ever rewrites `initialStatus`.
T.allIRs = [mapOne('Close')];
T.applyIRStateToAllIRs();
ok('a later Sheet edit cannot move a ticket the app holds',
  T.allIRs[0].status === 'Investigation', T.allIRs[0].status);
ok('...while the Sheet\'s own word changes freely, because it is a record of what was said',
  T.allIRs[0].initialStatus === 'Close', T.allIRs[0].initialStatus);

const withPri = mapOne('Open', ['Priority'], ['Urgent']);
ok('the Sheet\'s Priority column is not read either — Allot CAPS is the only writer',
  withPri.priority === undefined && !('priority' in withPri), JSON.stringify(withPri.priority));

// ── 6. A REMOTE SUPPORT job has five fewer steps ──────────────────────────────
// New machinery, and off-not-hidden is the decision: a tab that vanishes reads as a
// permission problem and sends someone to an admin to ask for access they have.
head('Remote Support switches off every section but Investigation');

ok('Investigation is the one a remote job keeps', T.REMOTE_SUPPORT_KEEPS.join(',') === 'sec-d',
  T.REMOTE_SUPPORT_KEEPS);
ok('a remote ticket loses exactly the other five',
  T.categoryInapplicableSections({ category: 'REMOTE SUPPORT' }).join(',') === 'sec-b,sec-c,sec-e,sec-f,sec-g',
  T.categoryInapplicableSections({ category: 'REMOTE SUPPORT' }));
ok('every other category loses nothing',
  ['CRASH', 'GENERAL MAINTENANCE', 'REPAIR', '', undefined].every(
    c => T.categoryInapplicableSections({ category: c }).length === 0),
  ['CRASH', 'GENERAL MAINTENANCE', 'REPAIR', ''].map(c => T.categoryInapplicableSections({ category: c })));
ok('no ticket at all loses nothing — the rule cannot run off a null',
  T.categoryInapplicableSections(null).length === 0 && T.categoryInapplicableSections(undefined).length === 0);

// A stand-in DOM for the applicability pass and for showSection. The elements are the
// harness's own — a REAL classList, a REAL attribute pair and a `dispatch` that fires
// the listeners the app wired — so a class the app sets is a class this suite reads,
// and the tab press below is the app's own handler rather than a copy of it.
const tabs = {}; const panes = {}; const closes = {};
TABS.forEach(id => {
  tabs[id] = T.tabs[TABS.indexOf(id)];   // the elements the module-level wiring reached
  panes[id] = realCreate();
  // A real button starts enabled and untitled; the harness's element has no such
  // members, and `undefined === false` would make the "Close still works" assertion
  // pass for the wrong reason — the failure mode this file exists to avoid.
  closes['close-' + id] = Object.assign(realCreate(), { disabled: false, title: '' });
});
const activeTab = () => TABS.find(id => tabs[id].classList.contains('active'));
const closeBtn  = id => closes['close-' + id];

// Everything this suite does not own falls through to the harness's own captured
// elements — the toast slot among them, so an assertion can read what a handler SAID
// rather than only what it did.
const harnessGet = T.document.getElementById;
T.document.querySelector = (sel) => {
  const m = /^\.tab\[data-section="([^"]+)"\]$/.exec(sel);
  if (m) return tabs[m[1]] || null;
  if (sel === '.tab.active[data-section]') return tabs[activeTab()] || null;
  return null;
};
T.document.querySelectorAll = (sel) => sel === '.tab' ? TABS.map(id => tabs[id])
                                    : sel === '.section-content' ? TABS.map(id => panes[id]) : [];
T.document.getElementById = id => panes[id] || closes[id] || harnessGet(id);

const OFF_CLASS = 'tab-inapplicable';
const remoteIR = { irNumber: 'IR704', category: 'REMOTE SUPPORT', done: [] };
T.currentIR = remoteIR;
T.applyCategoryApplicability();

ok('the five sections that do not apply are marked off',
  TABS.filter(id => id !== 'sec-d').every(id => tabs[id].classList.contains(OFF_CLASS)),
  TABS.filter(id => !tabs[id].classList.contains(OFF_CLASS)));
ok('Investigation is NOT marked off', !tabs['sec-d'].classList.contains(OFF_CLASS));
ok('...and the tab is still THERE, not hidden — off is not "missing"',
  TABS.every(id => tabs[id].style.display !== 'none'));
ok('...and it says why, on hover', tabs['sec-b'].title === 'Not part of a Remote Support job',
  tabs['sec-b'].title);
ok('...and says the same to a screen reader',
  tabs['sec-b'].getAttribute('aria-disabled') === 'true' &&
  tabs['sec-d'].getAttribute('aria-disabled') === 'false');
ok('the pane is switched off too, because the tab is not the only way in',
  TABS.filter(id => id !== 'sec-d').every(id => panes[id].classList.contains('is-inapplicable')) &&
  !panes['sec-d'].classList.contains('is-inapplicable'));
// Close is the ONLY write control a section has, which is why the edit grant gates
// it — and why the applicability rule must gate it too, or a switched-off section
// would still be closable from the pane.
ok('Close is disabled with the same reason',
  TABS.filter(id => id !== 'sec-d').every(id => closeBtn(id).disabled === true &&
    closeBtn(id).title === 'Not part of a Remote Support job'));
ok('...while Investigation keeps a working Close',
  closeBtn('sec-d').disabled === false && closeBtn('sec-d').title === '');

// Standing in a section that goes off — the category can change under an open tab,
// because Allot CAPS writes it.
T.showSection('sec-b');
ok('the ticket is standing in a section before it goes off',
  activeTab() === 'sec-b', activeTab());
T.applyCategoryApplicability();
ok('...and is moved to the section that stays, rather than left in a dead pane',
  activeTab() === 'sec-d' && panes['sec-d'].classList.contains('active'), activeTab());

// And the other way: a category change must take the marking OFF again, or a
// re-triaged ticket would keep five sections switched off for good. This goes through
// Allot CAPS itself rather than calling the applicability rule directly, because that
// is the path the desk takes and the one that has to re-decide Close as well.
//
// The user is an admin here on purpose: the grant owns whether a Close button is
// enabled at all, so a view-only account would leave this assertion testing access
// rather than applicability. An admin's Close is enabled everywhere, which isolates
// the one rule under test.
head('re-triaging takes the sections back on, Close included');

T.setUser({ email: 'monish.raza@indrones.com', sessionToken: 't',
            access: { role: 'admin', permissions: {}, departments: [], triage: true } });
T.currentIR = remoteIR;
T.applySectionAccessGating();
ok('a remote ticket is switched off, and its Close with it',
  tabs['sec-b'].classList.contains(OFF_CLASS) && closeBtn('sec-b').disabled === true &&
  closeBtn('sec-c').disabled === true, closeBtn('sec-b').disabled);

await triageAs(remoteIR, { status: 'Open', category: 'REPAIR', subCategory: 'GPS' });
ok('re-triaging to a normal category switches every section back on',
  TABS.every(id => !tabs[id].classList.contains(OFF_CLASS) &&
                   !panes[id].classList.contains('is-inapplicable')),
  TABS.filter(id => tabs[id].classList.contains(OFF_CLASS)));
ok('...and Close comes back with it, rather than staying dead behind a live tab',
  TABS.every(id => closeBtn(id).disabled === false && closeBtn(id).title === ''),
  TABS.map(id => [id, closeBtn(id).disabled, closeBtn(id).title]));

// ── 7. Pressing a switched-off tab says so ────────────────────────────────────
// The click listener is wired at module level, so this is the ONE place the press
// itself can be driven. A control follows: the same press on a ticket where the
// section applies must switch the pane — otherwise the guard below proves nothing.
head('a switched-off tab answers the press with the reason');

T.currentIR = { irNumber: 'IR706', category: 'REMOTE SUPPORT', done: [] };
T.applyCategoryApplicability();
T.showSection('sec-d');
const fired = tabs['sec-b'].dispatch('click');
ok('the press really reaches a handler, so what follows is not vacuous', fired >= 1, fired);
ok('pressing a switched-off tab does NOT switch the pane',
  activeTab() === 'sec-d' && !panes['sec-b'].classList.contains('active'), activeTab());
ok('...and the press SAYS why, rather than doing nothing at all',
  byId.get('toast-text').textContent === 'Not part of a Remote Support job',
  byId.get('toast-text').textContent);

T.currentIR = { irNumber: 'IR707', category: 'REPAIR', done: [] };
T.applyCategoryApplicability();
tabs['sec-b'].dispatch('click');
ok('the same press on a ticket where the section applies switches the pane',
  activeTab() === 'sec-b' && panes['sec-b'].classList.contains('active'), activeTab());

// ── 8. A retired word is folded EVERYWHERE it is printed ──────────────────────
// The store will hold the eight retired words for a while — re-aligning old entries
// is a job the desk does gradually — so every surface that prints a status is a
// surface that can print the wrong one. That is not hypothetical: the ticket header
// folded ('Investigation') while the list card printed the raw stored word
// ('QC Investigation'), so ONE ticket read two ways depending on where you looked at
// it. Both renderers are driven here and their output compared, because "the fold
// exists in the source" is not the same claim as "both screens agree".
//
// The card is the important half: it is the screen a person actually scans, and a
// card reading 'QC Investigation' is how a retired word gets read back into use.
head('a retired word is folded wherever it is printed');

const legacyIR = {
  irNumber: 'IR720', droneId: 'S25P099', initialStatus: 'QC Investigation',
  dateRaisedISO: '2025-09-28', done: [],
};
T.irState = { IR720: { status: 'QC Investigation', statusOwned: true,
                       statusAt: Date.now() - 2 * 86400000, statusBy: 'cr@indrones.com',
                       updatedBy: 'cr@indrones.com', updatedAt: Date.now(), done: [] } };
T.allIRs = [legacyIR];
T.applyIRStateToAllIRs();
ok('the row really does still hold the retired word, so the check is not vacuous',
  legacyIR.status === 'QC Investigation', legacyIR.status);

T.renderIRList([legacyIR]);
const cardHtml = byId.get('ir-list').innerHTML;
ok('the list card prints the folded stage, not the stored word',
  cardHtml.includes('>Investigation<') && !cardHtml.includes('QC Investigation'),
  cardHtml.match(/class="badge[^"]*">[^<]*</g));

T.currentIR = legacyIR;
T.renderBannerMeta();
const bannerHtml = byId.get('ir-banner-pills').innerHTML;
ok('the ticket header prints the folded stage too',
  bannerHtml.includes('>Investigation<') && !bannerHtml.includes('QC Investigation'),
  bannerHtml.match(/class="badge[^"]*">[^<]*</g));
// The two are asserted EQUAL rather than each asserted against a literal, because
// the bug was a disagreement between them: two checks against the same string would
// both have passed while the screens still differed.
ok('and the two screens cannot spell the same ticket differently',
  cardHtml.match(/class="badge[^"]*">([^<]*)</)[1] ===
  bannerHtml.match(/class="badge[^"]*">([^<]*)</)[1],
  [cardHtml.match(/class="badge[^"]*">([^<]*)</), bannerHtml.match(/class="badge[^"]*">([^<]*)</)]);

ok('every retired word folds to its stage through the one print helper',
  RETIRED.every(w => T.statusLabel(w) === FOLD[w]), RETIRED.map(w => [w, T.statusLabel(w)]));
ok('a live stage prints as itself — the helper never renames it',
  TEN.every(s => T.statusLabel(s) === s));
// The empty case is the one that has no fold table entry: a ticket nobody has opened
// holds no status at all, and a pill must never read blank.
ok('a ticket with no status prints Open, never an empty pill',
  T.statusLabel('') === 'Open' && T.statusLabel(null) === 'Open' && T.statusLabel(undefined) === 'Open',
  [T.statusLabel(''), T.statusLabel(null), T.statusLabel(undefined)]);
// 'Other' is the escape hatch: not one of the ten, so canonicalStage leaves it, and
// it must still print its own word rather than falling into the Open default.
ok("an old 'Other' ticket still reads as Other",
  T.statusLabel('Other') === 'Other', T.statusLabel('Other'));

finish();
