// Smoke test for the IR board.
//
//   node tools/smoke-board.mjs
//
// The board is a DRAWING of data the app already stores, which is what makes it
// cheap — and what makes it dangerous. Every column heading, every mapping and
// every count on it is a claim about the app rather than a picture of one, so the
// assertions below are provenance, not taste:
//
//   * the nine columns between them place IR_STATUS_VALUES EXACTLY — every stage
//     once, none invented, none missing. A status the app can store and the board
//     cannot place is the failure a reader could never see: the card would simply
//     be nowhere, and the board would look fine.
//   * and they place every value the app can still be HANDED, because the store
//     holds old tickets. The eight retired Sheet words are folded to the stage they
//     mean (canonicalStage) and land in that stage's column; 'Other', which is not a
//     stage at all, keeps the column it has always had. Both halves are asserted
//     against boardColumnOf itself rather than against the table it reads.
//   * a section column is named with the app's OWN short name, so the column a
//     card sits in and the tab it lives on say the same words.
//   * the header count is the column's FULL count while only the drawing is
//     capped, so a column can never quietly under-report what it holds.
//   * nothing moves a card by itself. Moving an IR's stage writes `statusAt`,
//     which is what every ageing readout is measured from, so it stays a
//     deliberate act — see the note on syncIRStateAfterSectionSave().

import fs from 'node:fs';
import vm from 'node:vm';
import { loadApp } from './harness.mjs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const appJs = read('../app.js');
const html = read('../index.html');
const viewsCss = read('../views.css');
const baseCss = read('../base.css');

// The language table, evaluated rather than regexed out of the source: its own
// values contain escaped apostrophes, and a regex that has to know that is a test
// that breaks the day someone writes one.
const i18nCtx = { console: { warn() {} } };
i18nCtx.window = i18nCtx;
vm.createContext(i18nCtx);
vm.runInContext(read('../i18n.js'), i18nCtx, { filename: 'i18n.js' });
const i18nKeys = Object.keys(i18nCtx.I18N.STRINGS);

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const head = t => console.log('\n— ' + t + ' —');

// ── The nine columns place the app's fourteen stages, exactly ────────────────
head('the columns are the app\'s own workflow stages');

const statusValues = [...((appJs.match(/const IR_STATUS_VALUES\s*=\s*\[([^\]]*)\]/) || [])[1] || '')
  .matchAll(/'([^']+)'/g)].map(m => m[1]);
ok('the app really does store ten workflow stages', statusValues.length === 10, statusValues.join(' '));

// The BOARD_COLUMNS literal, brace-matched from its `[` so a later array in the
// file cannot be swept in.
const bcStart = appJs.indexOf('const BOARD_COLUMNS = [');
const bcEnd = bcStart < 0 ? -1 : appJs.indexOf('\n];', bcStart);
const boardCols = bcStart < 0 ? '' : appJs.slice(bcStart, bcEnd + 3);
ok('the board declares its columns', boardCols.length > 0, bcStart);

const placed = [...boardCols.matchAll(/stages:\s*\[([^\]]*)\]/g)]
  .flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
// The ONE stage-less value a column has to keep a place for. 'Other' is not in
// IR_STATUS_VALUES and must not be: nothing new can be set to it. But old tickets
// hold it, canonicalStage returns it unchanged, and a card in no column is a card
// nobody can see — so it keeps the finished column it has always had.
const KEPT_NON_STAGE = 'Other';
ok('every stage a column claims is one of the app\'s own, or the retired Other',
  placed.length > 0 && placed.every(s => statusValues.includes(s) || s === KEPT_NON_STAGE),
  placed.filter(s => !statusValues.includes(s) && s !== KEPT_NON_STAGE));
ok('the nine columns place all ten, each exactly once',
  placed.filter(s => s !== KEPT_NON_STAGE).length === statusValues.length &&
  [...placed.filter(s => s !== KEPT_NON_STAGE)].sort().join('|') === [...statusValues].sort().join('|'),
  `${placed.length} placed: ${placed.join('/')}`);
ok('...and the retired Other keeps a column of its own there too',
  placed.filter(s => s === KEPT_NON_STAGE).length === 1, placed);

const colCount = (boardCols.match(/\{\s*key:/g) || []).length;
ok('there are nine columns', colCount === 9, colCount);

// ── The section columns wear the app's own short names ───────────────────────
head('a section column is named the way its tab is');

const shortNames = Object.fromEntries([...appJs.matchAll(/'(sec-[a-z])':\s*'([^']+)'/g)]
  .map(m => [m[1], m[2]]));
ok('SECTION_SHORT still names all six sections', Object.keys(shortNames).length >= 6, shortNames);
// The title is built from SECTION_SHORT rather than typed out, so the two cannot
// drift: a renamed section renames its column for free.
const built = ['sec-b', 'sec-c', 'sec-d', 'sec-e', 'sec-f', 'sec-g']
  .filter(id => boardCols.includes(`SECTION_SHORT['${id}']`));
ok('every section column builds its heading from SECTION_SHORT',
  built.length === 6, built);
ok('...and the letter is prefixed, so the heading reads like the tab',
  /'B · '\s*\+\s*SECTION_SHORT\['sec-b'\]/.test(boardCols));

// ── The two end columns exist because some stages name no section ────────────
head('the stages that name no section still get a column each');
// The headings come from the language table rather than from a literal here, so
// the assertion checks the KEY the column reads and the stages it owns — the words
// themselves are smoke-i18n.mjs's business, and only its business.
ok('a start column holds the un-started stages',
  /title:\s*t\('board\.notStarted'\)[^}]*stages:\s*\[\s*'Open'\s*,\s*'Remote Support'\s*\]/.test(boardCols));
ok('a paused column holds On Hold',
  /title:\s*t\('board\.paused'\)[^}]*stages:\s*\[\s*'On Hold'\s*\]/.test(boardCols));
ok('a finished column holds the closing stages, and is drawn quiet',
  /title:\s*t\('board\.finished'\)[^}]*stages:\s*\[[^\]]*'Delivered'[^\]]*\][^}]*quiet:\s*true/.test(boardCols));
ok('...and it is the ONE place a value that is not a stage can sit',
  /title:\s*t\('board\.finished'\)[^}]*stages:\s*\[\s*'Delivered'\s*,\s*'Other'\s*\]/.test(boardCols),
  (boardCols.match(/stages:\s*\[[^\]]*'Other'[^\]]*\]/) || ['(none)'])[0]);

// ── Every value the app can be HANDED still lands somewhere ─────────────────
// The table above is a claim about the board; this is the board's behaviour, run
// against the real function rather than read out of the source. The population is
// every value that can be sitting in the store today: the ten, the eight words the
// Sheet wrote before the vocabulary changed, and Other.
head('nothing the store can hold falls off the board');

const T = loadApp('canonicalStage, boardColumnOf, IR_STATUS_VALUES, STATUS_LEGACY');
const RETIRED = ['Hold', 'Visual Inspection', 'QC Investigation', 'QC',
                 'Flight Test', 'PDI', 'Approval', 'Close'];

ok('the fold table holds exactly the eight retired words',
  Object.keys(T.STATUS_LEGACY).sort().join('|') === RETIRED.map(w => w.toLowerCase()).sort().join('|'),
  Object.keys(T.STATUS_LEGACY).sort());
ok('none of the ten needs folding — every one is already a stage',
  T.IR_STATUS_VALUES.every(s => T.canonicalStage(s) === s));
// The mapping, stated in full rather than as a property, because it is a DECISION:
// two old words folding to one stage is intended (QC and Flight Test both mean
// Quality Test), and a change to any single row should be a conscious edit here.
const COLUMN = {
  'Open': 'start', 'Remote Support': 'start', 'On Hold': 'hold',
  'Inward': 'B', 'Inspection': 'C', 'Investigation': 'D', 'Production': 'E',
  'Quality Test': 'F', 'PDI/Dispatch': 'G', 'Delivered': 'done', 'Other': 'done',
  'Hold': 'hold', 'Visual Inspection': 'C', 'QC Investigation': 'D',
  'QC': 'F', 'Flight Test': 'F', 'PDI': 'G', 'Approval': 'G', 'Close': 'done',
};
Object.entries(COLUMN).forEach(([value, col]) => {
  ok(`"${value}" sits in the ${col} column`, T.boardColumnOf(value) === col, T.boardColumnOf(value));
});
// The two properties the table above cannot express: a retired word goes where the
// stage it MEANS goes, whatever its casing, and a value nobody recognises still gets
// a column rather than vanishing.
ok('a retired word lands exactly where the stage it means lands',
  RETIRED.every(w => T.boardColumnOf(w) === T.boardColumnOf(T.canonicalStage(w))));
ok('...and casing does not change the answer',
  RETIRED.every(w => T.boardColumnOf(w.toUpperCase()) === T.boardColumnOf(w)));
ok('a value nobody recognises still gets the first column, never none',
  T.boardColumnOf('Something New') === 'start' && T.boardColumnOf('') === 'start');

// ── A column's count is the truth even when its drawing is capped ────────────
head('a capped column still counts everything it holds');
ok('the drawing is capped', /const BOARD_CAP\s*=\s*\d+/.test(appJs));
ok('...and the header prints the FULL count, not the drawn one',
  /class="kb-col-count">\$\{rows\.length\}/.test(appJs));
ok('...and the capped cards are the ones actually drawn',
  /const shown = rows\.slice\(0, BOARD_CAP\)/.test(appJs) && /\$\{shown\.map\(boardCard\)/.test(appJs));
ok('...and what was left behind is stated, with a way back to the list',
  /more > 0 \? `<button type="button" class="kb-more">\$\{escHtml\(t\('board\.more', \{ n: more \}\)\)\}<\/button>`/.test(appJs),
  (appJs.match(/[^\n]*kb-more[^\n]*/) || [''])[0]);

// ── The switch re-draws the SAME rows, and is CSS-driven ─────────────────────
head('List | Board | Grid is a switch over one filtered set of rows');
ok('index.html carries the switch, with a button per view',
  /id="list-view-switch"/.test(html) &&
  /data-view="list"/.test(html) && /data-view="board"/.test(html) &&
  /data-view="grid"/.test(html));
// Three buttons, and the count is asserted rather than each one being spotted: a
// fourth drawing added by copying a button is a drawing with no renderer behind it.
// `class="view-switch-btn` without the closing quote, because the ACTIVE one carries
// a second class — an exact match would count two and pass a three-button claim.
ok('...exactly three of them, one per drawing the app can actually render',
  (html.match(/class="view-switch-btn[" ]/g) || []).length === 3 &&
  new Set(html.match(/data-view="[a-z]+"/g) || []).size === 3 &&
  (html.match(/data-view="(list|board|grid)"/g) || []).length === 3,
  (html.match(/data-view="[a-z]+"/g) || []));
// The tablist's own label said "List or board". With a third tab that is a lie a
// screen reader reads out, so it moved into the language table with the buttons.
ok('...and the tablist is labelled from the language table, not from the old two-view wording',
  /role="tablist"[^>]*data-i18n-aria="list\.viewMode"/.test(html) &&
  !/data-i18n-aria="list\.viewBoard"/.test(html));
ok('it sits in the list toolbar, beside the title, above the filters',
  html.indexOf('id="list-view-switch"') > html.indexOf('class="list-toolbar-top"') &&
  html.indexOf('id="list-view-switch"') < html.indexOf('id="search-input"'));
ok('the board is a sibling of the list, not a seventh nav tab',
  /<div id="ir-board"[^>]*class="ir-board"/.test(html) &&
  !/data-section="board"/.test(html));
ok('the board pane is reachable by keyboard, for its sideways scroll',
  /<div id="ir-board"[^>]*tabindex="0"/.test(html));
// The grid scrolls VERTICALLY, like the list it is a drawing of, so it needs no
// tabindex — a stop that goes nowhere is worse than no stop. It is pinned here so a
// later "make it reachable like the board" does not quietly add one.
ok('the grid is a sibling of both, and carries no tabindex of its own',
  /<div id="ir-grid"[^>]*class="ir-grid"/.test(html) &&
  !/<div id="ir-grid"[^>]*tabindex/.test(html));
// ⚠ SIBLING, never a child of `.ir-list`. `.ir-list > *` is `flex: 0 0 auto` — the
// guard that stopped the rows being crushed when the list learned to scroll — and a
// grid inside it would be pinned at its content height and never scroll at all.
ok('...and it is NOT nested inside .ir-list, whose children cannot shrink',
  html.indexOf('id="ir-grid"') > html.indexOf('id="ir-list"') &&
  html.slice(html.indexOf('id="ir-list"'), html.indexOf('id="ir-grid"'))
      .indexOf('<div id="ir-grid"') === -1,
  html.slice(html.indexOf('id="ir-board"'), html.indexOf('id="ir-grid"') + 40).slice(-120));

// The one filter, three drawings: the branch is the whole contract.
const applyFilters = (appJs.match(/function applyListFilters\(\)[\s\S]*?\n\}/) || [''])[0];
ok('applyListFilters feeds each drawing the very same rows the list would get',
  /if \(listMode === 'board'\) renderBoard\(rows\);/.test(applyFilters) &&
  /else if \(listMode === 'grid'\) renderIRGrid\(rows\);/.test(applyFilters) &&
  /else renderIRList\(rows\);/.test(applyFilters),
  applyFilters.slice(-200));
ok('...so a filter or a search repaints whichever view is showing',
  /setListView\([\s\S]*?applyListFilters\(\)/.test(appJs));

// CSS alone decides which of the three is drawn, so the buttons, the pane class and
// the repaint cannot disagree about which view is showing.
ok('the switch is a class on the pane, not three elements kept in step',
  /#index-view\.is-board \.ir-list\s*\{\s*display:\s*none/.test(viewsCss) &&
  /#index-view\.is-board \.ir-board\s*\{/.test(viewsCss) &&
  /pane\.classList\.toggle\('is-board'/.test(appJs));
ok('...and the grid is gated by its own class on the same pane, hiding the other two',
  /#index-view\.is-grid \.ir-list,/.test(viewsCss) &&
  /#index-view\.is-grid \.ir-board\s*\{\s*display:\s*none/.test(viewsCss) &&
  /#index-view\.is-grid \.ir-grid\s*\{/.test(viewsCss) &&
  /pane\.classList\.toggle\('is-grid'/.test(appJs));
// The class is the ONLY gate, and this is the assertion that says so out loud: if the
// three-way normalisation ever lets a fourth word through, `is-board` and `is-grid`
// are both false and the list is what shows — never nothing.
ok('an unrecognised mode falls back to the list rather than to a blank pane',
  /listMode = VIEW_MODES\.includes\(mode\) \? mode : 'list';/.test(appJs) &&
  /const VIEW_MODES = \['list', 'board', 'grid'\];/.test(appJs));

// ── The board scrolls sideways inside its own frame, never the page ──────────
head('the board scrolls inside itself');
ok('the board frame scrolls sideways and contains its overscroll',
  /#index-view\.is-board \.ir-board\s*\{[^}]*overflow-x:\s*auto/.test(viewsCss) &&
  /#index-view\.is-board \.ir-board\s*\{[^}]*overscroll-behavior-x:\s*contain/.test(viewsCss));

// ── Nothing moves a card by itself ──────────────────────────────────────────
// `statusAt` is what "in status 3d" and every overdue limit are measured from, so
// a section save that moved the stage would reset the clock on every keystroke.
head('a card moves only when a person moves it');
ok('a section save still cannot touch the workflow status',
  !/function syncIRStateAfterSectionSave[\s\S]{0,900}?patch\.status\s*=/.test(appJs));
ok('the board itself writes nothing — it renders, it does not save',
  !/patchIRState|saveSentinel|postSectionSave/.test((appJs.match(/function renderBoard\(records\)[\s\S]*?\n\}/) || [''])[0]));
ok('boardColumnOf is pure: no DOM, no clock, no fetch',
  !/document\.|Date\.now|fetch\(/.test((appJs.match(/function boardColumnOf\(status\)[\s\S]*?\n\}/) || [''])[0]));
ok('an unrecognised status falls to the first column rather than vanishing',
  /return col \? col\.key : 'start';/.test(appJs));

// ── The offer to move a card on, by hand ────────────────────────────────────
// The board is read-only by design, so this one conditional button is the whole of
// the board's write surface and it deserves to be pinned down precisely: who it is
// offered to, what it writes, and what it must never say.
head('moving a card on is a press, and it says so honestly');

const closeBody = (appJs.match(/async function closeSection\(sectionId, irNumber\)[\s\S]*?\nfunction markSectionClosed/) || [''])[0];
const moveBody  = (appJs.match(/async function moveOnByHand\(irNumber, stage\)[\s\S]*?\n\}/) || [''])[0];
ok('closing a section still writes no workflow status',
  closeBody.length > 0 && !/patch\.status|statusAt|'status'/.test(closeBody), closeBody.length);
ok('...and the offer is the only section-side writer of the workflow clock',
  /statusAt: Date\.now\(\)/.test(moveBody) && /status: stage/.test(moveBody) &&
  /statusOwned: true/.test(moveBody));

ok('the offer is raised only for the section that owns the IR\'s current stage',
  /SECTION_IDS\.find\(id => SECTION_LABELS\[id\] === colKey\)/.test(appJs));
ok('...and only once that section is closed, never before the work is done',
  /secId !== owner \|\| !next \|\| !done\.includes\(secId\)/.test(appJs));
ok('...and the two end columns offer nothing, because they own several stages',
  /if \(i < 0 \|\| i >= BOARD_COLUMNS\.length - 1\) return null;/.test(appJs));
ok('...and it never re-stamps the clock for a press that moves nothing',
  /if \(!stage \|\| cur === stage\) return;/.test(moveBody));
ok('it is a ghost, so it never competes with the Close button beside it',
  /btn\.className = 'btn btn-ghost btn-move-on'/.test(appJs));
// One toast replaces another, so a cheerful confirmation here would erase the one
// warning the user must not miss. The pill and the timeline are the confirmation.
ok('it claims no success it cannot guarantee',
  moveBody.length > 0 && !/showToast/.test(moveBody));
ok('the offer is repainted wherever the facts behind it change',
  /paintBoardMoveOffer\(irNumber\)/.test((appJs.match(/function paintClosedSections[\s\S]*?\n\}/) || [''])[0]) &&
  /paintBoardMoveOffer\(ir\.irNumber\)/.test((appJs.match(/function renderBannerMeta[\s\S]*?\n\}/) || [''])[0]));
ok('every section has a close row for it to appear in',
  (html.match(/class="sec-close-row"/g) || []).length === 6 &&
  (html.match(/id="close-sec-[a-g]"/g) || []).length === 6);

// ── House rules the new UI has to obey ──────────────────────────────────────
head('the new UI obeys the app\'s own rules');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const boardCode = [
  (appJs.match(/const BOARD_COLUMNS = \[[\s\S]*?\n\];/) || [''])[0],
  (appJs.match(/function boardCard\(ir\)[\s\S]*?\n\}/) || [''])[0],
  (appJs.match(/function renderBoard\(records\)[\s\S]*?\n\}/) || [''])[0],
].join('\n');
ok('the board adds no emoji of its own', !EMOJI.test(boardCode),
  (boardCode.match(EMOJI) || []));
ok('the switch markup carries no emoji either',
  !EMOJI.test((html.match(/<span class="view-switch"[\s\S]*?<\/span>\s*<span class="list-count"/) || [''])[0]));
// Every glyph in this app has exactly ONE source, so the board uses the shared
// chip renderer rather than drawing its own count.
ok('the card reuses the shared completion chip, not a second renderer',
  /\$\{showProg \? progressChip\(prog\) : ''\}/.test(appJs));
ok('and it escapes every value it prints, as the list row does',
  /escHtml\(ir\.droneId/.test((appJs.match(/function boardCard\(ir\)[\s\S]*?\n\}/) || [''])[0]) &&
  /escJsAttr\(ir\.irNumber\)/.test((appJs.match(/function boardCard\(ir\)[\s\S]*?\n\}/) || [''])[0]));

// ── Every word the board shows comes out of the language table ───────────────
// The board was built with its wording written out. Moving that wording into
// i18n.js is worth nothing if one heading is left behind as a literal — that one
// heading is the screen a second language cannot translate, and it is invisible
// until someone reads that language and finds a stray English word.
head('the board\'s own words come from the language table');
ok('none of the board\'s new strings is left as a bare literal',
  !/'(Not started|Paused|Finished|Unassigned|IR board|List|Board)'/.test(boardCode),
  (boardCode.match(/'(Not started|Paused|Finished|Unassigned|IR board|List|Board)'/) || []));
const boardKeys = [...boardCode.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]);
ok('...and every one of them is a key the table really holds',
  boardKeys.length >= 3 && boardKeys.every(k => i18nKeys.includes(k)), boardKeys);
ok('the empty states are shared with the list, so the two views say the same words',
  /allIRs\.length \? t\('list\.emptyFiltered'\) : t\('board\.emptyNone'\)/.test(appJs));
ok('the move offer is a table string with its slots filled, not a concatenation',
  /t\('move\.to', \{ column: next\.label \}\)/.test(appJs) && /t\('move\.hint', \{ stage: next\.stage \}\)/.test(appJs));

// The board is placed ABOVE the polish block: nothing may be appended after it.
ok('the board styles sit before the POLISH block, not after it',
  viewsCss.indexOf('THE IR BOARD') > -1 &&
  viewsCss.indexOf('THE IR BOARD') < viewsCss.indexOf('POLISH — level:'));
ok('and the board restates no colour — every value is a token',
  !/#[0-9a-fA-F]{3,8}\b/.test(viewsCss.slice(viewsCss.indexOf('THE IR BOARD'), viewsCss.indexOf('POLISH — level:'))));

// ── The list already scrolls on its own, and this is what keeps it that way ───
// The first half of his request — "separate scroll bar for IR list" — was already
// true and is deliberately NOT changed: `.ir-list` is its own vertical scroller and
// the toolbar above it sits outside that scroller, so the search box and the two
// filter strips stay put while the rows move under them. The property that makes it
// so is `#index-view` carrying NO overflow — one added there would make the whole
// pane scroll, toolbar and all, and nothing else in the app would look wrong.
head('the IR list scrolls inside itself, under a toolbar that stays put');
const listRule = ((viewsCss + baseCss).match(/\n\.ir-list\s*\{([^}]*)\}/) || [])[1] || '';
ok('the list is its own vertical scroll area',
  /overflow-y:\s*auto/.test(listRule) &&
  /flex:\s*1/.test(listRule) && /min-height:\s*0/.test(listRule), listRule.trim());
// `min-height: 0` is the half that actually fails: without it a flex item refuses to
// shrink below its content, so the list grows past the pane and the SCROLLBAR APPEARS
// ON THE WINDOW instead — the exact complaint this is answering.
const paneRules = [...(baseCss + viewsCss).matchAll(/(?:^|\n)#index-view\s*\{([^}]*)\}/g)].map(m => m[1]);
ok('...and the pane around it never scrolls, so the toolbar cannot leave the screen',
  paneRules.length > 0 && paneRules.every(r => !/overflow/.test(r)),
  paneRules.map(r => r.trim().replace(/\s+/g, ' ')));
// Sibling order is the other half of "separate": a toolbar INSIDE the scroller would
// ride up with the rows no matter what the CSS says.
const listAt = html.indexOf('id="ir-list"');
const toolbarAt = html.indexOf('class="list-toolbar"');
ok('...and the toolbar is markup the list does not contain',
  toolbarAt > -1 && listAt > toolbarAt &&
  html.slice(toolbarAt, listAt).indexOf('id="ir-list"') === -1 &&
  (html.match(/id="ir-list"/g) || []).length === 1);

// ── ⚠ AND THE ANCHOR AT THE TOP OF THAT CHAIN ─────────────────────────────────
// The three assertions above passed for weeks on a list that could not scroll one
// pixel. This block exists because of exactly why.
//
// Every pane from #app-container down is `flex: 1; min-height: 0`, and that only
// clips its content if its parent's height is DEFINITE. `body` declared
// `min-height: 100dvh`, so it was not: the chain resolved against the CONTENT's
// height instead of the viewport's, `.ir-list` grew to fit its rows, and the whole
// PAGE scrolled while `overflow-y: auto` never overflowed once.
//
// The owner, 2026-10-11: "IR List scroll is still not there." He was right.
//
// ⚠ SAY WHAT THIS IS. A stylesheet assertion is the WEAK half — it pins the fix
// against regression, it does not prove the list scrolls. The proof is a browser and
// it cannot be a screenshot, because render-themes launches Chrome with
// `--hide-scrollbars`. It is `tools/render-themes.mjs --eval`, forcing the overflow
// and then reading scrollTop back: measured 2026-10-11, 1440x900, 40 rows added —
// before, list clientHeight 3459 = scrollHeight 3459 and `scrollTop = 300` did
// nothing while the body stood at 3797px; after, 562 vs 781, scrollTop settled at
// 219, body 900. At 390x600 with a 1400px child, `#auth-container` holds at 600 and
// scrolls its own content rather than trapping it.
// ⚠ COMMENTS STRIPPED FIRST, and this is not tidiness. The note inside `body`
// QUOTES the bug — it says the rule "said `min-height: 100dvh`" — so testing the raw
// rule body matched the prose describing the fault and failed a fix that was present.
// The same trap runs the other way: `overflow: hidden` appears in that prose too, so
// the second assertion below would have PASSED on a stylesheet that had lost the
// declaration entirely. A test that reads comments is reading the wrong text.
const baseCssNC = baseCss.replace(/\/\*[\s\S]*?\*\//g, '');
const bodyRule = (baseCssNC.match(/\nbody\s*\{([^}]*)\}/) || [])[1] || '';
ok('the shell is anchored to a DEFINITE height, not a minimum',
  /height:\s*100dvh/.test(bodyRule) && !/min-height:\s*100dvh/.test(bodyRule),
  bodyRule.trim().replace(/\s+/g, ' ').slice(0, 160));
ok('...and the page itself never scrolls, so the panes own their scroll areas',
  /overflow:\s*hidden/.test(bodyRule));
// The chain, stated once: each of these must be flexible AND allowed to shrink below
// its content. Drop `min-height: 0` from any one and the list stops clipping again,
// one level up from where it was lost the first time.
const chain = ['#app-container', '#panes', '#index-view'];
const chainCss = (baseCss + viewsCss).replace(/\/\*[\s\S]*?\*\//g, '');
const chainRules = chain.map(sel => {
  const re = new RegExp('(?:^|\\n)' + sel + '\\s*\\{([^}]*)\\}', 'g');
  return [...chainCss.matchAll(re)].map(m => m[1]);
});
ok('...and every pane from #app-container to #index-view is flexible and may shrink',
  chainRules.every(rs => rs.length > 0 &&
    rs.every(b => /flex:\s*1/.test(b) && /min-height:\s*0/.test(b))),
  chain.map((s, i) => s + ' x' + chainRules[i].length).join(' '));

// ── ⚠ AND THE ROWS MUST NOT SHRINK, OR THE FIX BREAKS THE LIST IT FIXED ──────
// The height fix above is what made the list scroll — and it is also what CRUSHED
// it. `.ir-list` is a COLUMN flex container, so each row is a flex ITEM and
// `flex-shrink` defaults to 1. With no definite height there was nothing to shrink
// into, so nobody ever saw it. The moment `body` got `height: 100dvh`, the list
// became definite too and forty-nine rows were squeezed to fit 562px.
//
// The owner, 2026-10-11, after v87 shipped: "after bringing in scroll bar for IRs,
// it has significantly affected the representation/view of list."
//
// ⚠ SAY WHAT THIS IS, because it is the SAME weakness the block above confesses to.
// A declaration test is the WEAK half. The proof is a browser: measured the same day,
// 1440x900, 49 rows injected — `.ir-card` height **77px -> 17px** without the rule,
// 77px with it; `.ir-list` scrollHeight 849 -> 3765 (the pre-fix content height to the
// pixel) and it scrolls; the page does not. `tools/render-themes.mjs --eval` is the
// only instrument, since Chrome runs with `--hide-scrollbars`.
const irListCss = viewsCss.replace(/\/\*[\s\S]*?\*\//g, '');
const irListRule = (irListCss.match(/(?:^|\n)\.ir-list\s*\{([^}]*)\}/) || [])[1] || '';
const irListChildRules = [...irListCss.matchAll(/(?:^|\n)\.ir-list\s*>\s*([^\s{,]+)\s*\{([^}]*)\}/g)]
  .map(m => ({ sel: m[1], body: m[2] }));
ok('the list is a COLUMN flex container, so its rows are shrinkable flex items',
  /display:\s*flex/.test(irListRule) && /flex-direction:\s*column/.test(irListRule),
  irListRule.trim().replace(/\s+/g, ' ').slice(0, 120));
ok('...and every child of it refuses to shrink, so a row keeps its own height',
  irListChildRules.some(r => r.sel === '*' && /flex:\s*0\s+0\s+auto/.test(r.body)),
  irListChildRules.map(r => '.ir-list > ' + r.sel).join(', ') || '(no child rule at all)');

// ── The left-right bar rides ABOVE the columns, not under them ───────────────
// The owner, 2026-10-10: "previously I have asked about separate scroll bar for IR
// list and similarly in for board since number of columns are more, we can have
// left-right scrollable bar on top of columns space."
//
// The bar is a real SECOND scrollbar, so asserting the CSS alone asserts nothing —
// two elements kept in step drift apart silently, and a bar that has stopped moving
// the columns looks exactly like a bar that is working. What is asserted here is that
// the three parts agree: the element is placed before the board, CSS shows it only
// when the board shows, and the app keeps the two scrolled together.
head('the board\'s scroll bar rides above the columns');

const barAt = html.indexOf('id="ir-board-scroll"');
const boardAt = html.indexOf('id="ir-board"');
// `before`, not merely `present`: a bar after the board IS the bug this element
// exists to fix, and the two sit one line apart in the markup — exactly the layout
// an edit moves by accident. No intervening close tag means they are siblings.
// Sliced from the END of the bar's own markup, not from its opening tag: the bar is
// `<div id="ir-board-scroll" …><div></div></div>`, so its own closing tags are inside
// that span and would read as a nesting change that is not there.
const barEnd = html.indexOf('</div></div>', barAt) + '</div></div>'.length;
ok('the bar sits between the list and the board, as their sibling',
  barAt > -1 && barEnd > barAt && boardAt > barEnd &&
  barAt > html.indexOf('id="ir-list"') &&
  html.slice(barEnd, boardAt).indexOf('</div>') === -1,
  { barAt, barEnd, boardAt, between: html.slice(barEnd, boardAt).trim().slice(0, 120) });
// Its one child is the thumb the app sizes. With no child there is nothing to give a
// length to, and the bar shows a full-width thumb over a board that is still scrolling.
ok('...and it carries the thumb element the app sizes',
  /id="ir-board-scroll"[^>]*>\s*<div><\/div>\s*<\/div>/.test(html));
// The board below is the scrollable region and already carries tabindex and a label;
// a second stop for one column strip would be worse than none.
ok('...and it is hidden from assistive tech, since the board below is the region',
  /id="ir-board-scroll"[^>]*aria-hidden="true"/.test(html));

const barRules = [...viewsCss.matchAll(/([^{}]*\.board-scrollbar[^{}]*)\{([^}]*)\}/g)];
const shownRules = barRules.filter(m => /display:\s*block/.test(m[2]));
ok('it is display:none until the pane carries .is-board',
  barRules.some(m => /display:\s*none/.test(m[2])) &&
  shownRules.length === 1 && /\.is-board/.test(shownRules[0][1]),
  { rules: barRules.length, shown: shownRules.map(m => m[1].trim()) });
const shownBody = shownRules.length ? shownRules[0][2] : '';
ok('...and it scrolls sideways only, never vertically',
  /overflow-x:\s*auto/.test(shownBody) && /overflow-y:\s*hidden/.test(shownBody),
  shownBody.trim());
// The board's OWN bar is deliberately kept as well: on a touch device it is the one a
// finger meets, and hiding it would leave the last row of cards looking cut off.
ok('the board keeps its own reachable bar too, for touch',
  (viewsCss.match(/#index-view\.is-board\s+\.ir-board\s*\{[^}]*\}/g) || [])
    .some(r => /overflow-x:\s*auto/.test(r)));

// ── Driven, against the app's own element ────────────────────────────────────
// `byId` memoizes elements by id, so these ARE the objects app.js is holding — a
// mirroring test against fresh stubs would prove nothing about the app. The identity
// check is what earns the rest: if app.js were bound to a different element, every
// assertion below would pass while the real board scrolled alone.
const { T: B, byId } = loadApp(
  'scrollBoardMirror, mirrorBoardScroll, get irBoard() { return irBoard; }',
  { capture: true });
const board = byId.get('ir-board');
const bar = byId.get('ir-board-scroll');
ok('the test is holding the same board element the app is',
  !!board && !!bar && B.irBoard === board, { same: B.irBoard === board });

const thumb = { style: {} };
bar.appendChild(thumb);
board.scrollWidth = 2266;   // nine columns of cards, the width actually measured
board.scrollLeft = 400;
B.scrollBoardMirror();
// Both jobs in one call, and they are different jobs: the WIDTH comes from the board's
// scrollWidth (so the thumb is the right length for the columns there are), the OFFSET
// from its scrollLeft. A version that copied clientWidth would pass a length check and
// still draw a thumb that lies about the board.
ok('the thumb is sized to the board\'s scrollWidth and follows its offset',
  thumb.style.width === '2266px' && bar.scrollLeft === 400,
  { width: thumb.style.width, barLeft: bar.scrollLeft });
// The bar has no thumb until a render puts one there; measuring must be a no-op, not
// a TypeError on the boot path where the markup has not been filled in yet.
bar.children.length = 0;
let threw = null;
try { B.scrollBoardMirror(); } catch (e) { threw = e && e.message; }
ok('a bar with no thumb is a no-op rather than a crash', threw === null, threw);

board.scrollLeft = 640; B.mirrorBoardScroll(board, bar);
ok('dragging the board moves the bar with it', bar.scrollLeft === 640, bar.scrollLeft);
bar.scrollLeft = 1200; B.mirrorBoardScroll(bar, board);
ok('...and the bar drives the board, so either end can be the one you grab',
  board.scrollLeft === 1200, board.scrollLeft);

// The re-entrancy guard, DRIVEN rather than reasoned about. Writing one element's
// scrollLeft fires its own scroll event, which writes the other's, which fires again;
// the stubs below make that happen on purpose, so deleting the guard hangs or overflows
// this suite instead of quietly shipping. Two levels is the honest maximum: the write
// each setter makes is refused by the guard, so the recursion is exactly one deep.
const pairA = { _v: 0 }, pairB = { _v: 0 };
let depth = 0, deepest = 0;
for (const o of [pairA, pairB]) {
  Object.defineProperty(o, 'scrollLeft', {
    get() { return this._v; },
    set(v) { this._v = v; deepest = Math.max(deepest, ++depth); B.mirrorBoardScroll(pairA, pairB); depth--; },
  });
}
pairA.scrollLeft = 400;
// EXACTLY two, not "at most": if the setters never re-entered, the depth would be 1
// and the guard would be untested — a green assertion about code that was never run.
ok('the two-way mirror terminates instead of echoing forever',
  deepest === 2 && pairA.scrollLeft === 400 && pairB.scrollLeft === 400,
  { deepest, a: pairA.scrollLeft, b: pairB.scrollLeft });

// Where the mirror is re-taken. A bar measured once and never again is stale the
// moment a column empties or the board goes full-screen, and a stale bar looks
// completely normal — it is simply the wrong length.
const rbBody = (appJs.match(/function renderBoard\(records\)[\s\S]*?\n\}/) || [''])[0];
const slvBody = (appJs.match(/function setListView\(mode\)[\s\S]*?\n\}/) || [''])[0];
ok('renderBoard re-measures after the columns are in the DOM',
  (rbBody.match(/scrollBoardMirror\(\);/g) || []).length >= 2,
  (rbBody.match(/.*scrollBoardMirror.*/g) || []));
ok('...and choosing the board re-measures once the fold has been applied',
  /requestAnimationFrame\(scrollBoardMirror\)/.test(slvBody),
  (slvBody.match(/.*scrollBoardMirror.*/g) || []));

// ══════════════════════════════════════════════════════════════════════════════
// THE IR GRID — the third drawing, and the one that taught this file the most
// ══════════════════════════════════════════════════════════════════════════════
// The owner, 2026-10-11: "for viewing our list of IRs, I also want a grid view
// option. As of now we have list and board. but grid in my view will have better UI
// for users." It is a third branch of applyListFilters, so it obeys the same search
// box, the same two strips and the same sort for free — and those are asserted above,
// on the switch, not here.
head('the grid draws the same rows as tiles, from fields an IR actually has');

const gridCode = [
  (appJs.match(/const GRID_CAP\s*=\s*\d+;/) || [''])[0],
  (appJs.match(/function gridTile\(ir\)[\s\S]*?\n\}/) || [''])[0],
  (appJs.match(/function renderIRGrid\(records\)[\s\S]*?\n\}/) || [''])[0],
].join('\n');
// ⚠ COMMENTS STRIPPED FIRST, and for the third time in this file it is not tidiness.
// The note inside `gridTile` explains in prose that there is "no warranty field and no
// model field on an IR" and warns about `companyName` with a ⚠. Testing the raw
// function body found the WORD warranty and the EMOJI in the prose describing their
// absence — a test that reads comments is reading the wrong text.
const gridSrc = gridCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
ok('the grid has its own renderer, beside the board\'s', gridCode.length > 0);
// The cap is the REASON this view is affordable at all: the list's cost is measured
// proportional to data (~0.1ms/row, docs/07), a tile is a heavier node than a row,
// and the search path repaints on every 150ms tick. The board caps for the same
// reason. Asserted as an inequality so a future "just raise it" is a decision.
ok('and it caps what it draws, so a search keystroke cannot repaint 453 tiles',
  /const GRID_CAP = (\d+);/.test(appJs) && Number(RegExp.$1) > 0 && Number(RegExp.$1) <= 60,
  (appJs.match(/const GRID_CAP = \d+;/) || [''])[0]);
ok('...and what it left behind is stated, with a way back to the list',
  /const shown = records\.slice\(0, GRID_CAP\)/.test(appJs) &&
  /more > 0/.test(appJs) &&
  /class="grid-more">\$\{escHtml\(t\('grid\.more', \{ n: more \}\)\)\}/.test(appJs));

// ⚠ `companyName`, NEVER `customerName`. The intake form has two name-shaped columns
// — Col L is the PERSON who reported it, Col R is the COMPANY — and access is scoped
// by the company, so reading the wrong one is a mistake this project has already paid
// for (a customer with an empty portal and no error anywhere). The reporter's name is
// still reachable, as the tile's tooltip, which is where it belongs.
ok('the tile identifies the COMPANY, and never prints the person\'s name',
  /escHtml\(ir\.companyName\)/.test(gridCode) &&
  !/>\$\{escHtml\(ir\.customerName\)\}/.test(gridCode) &&
  /title="\$\{escHtml\(ir\.customerName\)\}"/.test(gridCode));
// The mockup asked for a "Product Name" and a warranty status; an IR has neither. The
// serial is the only product identifier a record actually carries.
ok('it ships no warranty and no model, because an IR has no such field',
  !/warranty/i.test(gridSrc) && !/ir\.model/i.test(gridSrc) &&
  /escHtml\(ir\.droneId\)/.test(gridSrc));
// A tile that reads as broken is a blank middle, so the subject falls back.
ok('the subject falls back to what the customer wrote rather than going blank',
  /ir\.issueType \|\| ir\.issueDesc \|\| ''/.test(gridCode));
// `droneId` is written by the PUBLIC customer form and was an XSS vector; the tile
// keeps the row's and the board's discipline rather than inventing a third.
ok('...and every value on it is escaped, as the row and the card are',
  /escHtml\(ir\.irNumber\)/.test(gridCode) &&
  /escJsAttr\(ir\.irNumber\)/.test(gridCode) &&
  /escHtml\(initialsOf\(owner\)\)/.test(gridCode));
// The monogram is `initialsOf()`, the one reader it has left since the row's circle
// was removed in September. There are no avatars in this app and nothing uploads one.
ok('the assignee is a monogram from the app\'s own initials helper, not an avatar',
  /initialsOf\(owner\)/.test(gridCode) && !/<img/.test(gridCode));
ok('...and an unassigned ticket says so in the app\'s own words',
  /t\('common\.unassigned'\)/.test(gridCode));
// The click target is the EXISTING ticket pane. The mockup's slide-out drawer was
// rejected by the owner, and a second ticket screen is the failure this pins.
ok('a tile opens the app\'s own ticket pane and nothing else',
  /onclick="goTicket\('\$\{escJsAttr\(ir\.irNumber\)\}'\)"/.test(gridCode) &&
  !/drawer|openDrawer/.test(gridCode));
ok('the grid adds no emoji of its own', !EMOJI.test(gridSrc), (gridSrc.match(EMOJI) || []));
ok('...and the open ticket is marked in the grid as it is in the list',
  (appJs.match(/querySelectorAll\('\.ir-card'\)/) || []).length >= 1 &&
  /querySelectorAll\('\.ir-tile'\)/.test(appJs));

// ── The sort, and the mutation it must not make ───────────────────────────────
// Sort + priority are the mockup's own two controls, and they are NOT a second filter
// system: both feed applyListFilters(), the one function the search box and both
// strips already pass through. So every drawing is filtered and ordered by one path.
head('priority and sort are the same pipeline the search box uses');

const prioAt = html.indexOf('id="filter-priority"');
const sortAt = html.indexOf('id="sort-by"');
ok('the toolbar carries both selects, after the strips',
  prioAt > -1 && sortAt > prioAt &&
  prioAt > html.indexOf('id="list-categories"') && sortAt < html.indexOf('id="search-input"') + 4000);
ok('...and each is read by applyListFilters and by nothing else',
  /filterPriority\.addEventListener\('change'/.test(appJs) &&
  /sortBy\.addEventListener\('change'/.test(appJs) &&
  /activePriority = filterPriority\.value/.test(appJs) &&
  /activeSort = sortBy\.value/.test(appJs));
ok('the priority filter and the sort are both applied inside applyListFilters',
  /ir\.priority === activePriority/.test(applyFilters) &&
  /rows = sortIRRows\(rows, activeSort\)/.test(applyFilters),
  applyFilters.slice(-260));
// Priority is app-owned and most tickets have none, so "No priority" is a real bucket
// rather than an empty state — the same convention the category strip's own
// uncategorised bucket set.
ok('"No priority" is a bucket of its own, not an empty result',
  /UNCATEGORISED/.test(applyFilters) && /!ir\.priority/.test(applyFilters));
// ⚠ THE MUTATION HAZARD, and the reason this assertion exists: applyListFilters hands
// sortIRRows `allIRs` ITSELF when no filter is active, and `.sort()` is IN PLACE — so
// sorting without copying would silently reorder the master list and every count on
// the Insights dashboard with it.
const sortBody = (appJs.match(/function sortIRRows\(rows, mode\)[\s\S]*?\n\}/) || [''])[0];
ok('the sort copies before it sorts, so it cannot reorder the master list',
  /const out = rows\.slice\(\)/.test(sortBody) && sortBody.length > 0,
  sortBody.slice(0, 120));
// `dateRaised` is display-only; `dateRaisedISO` is the one clean sortable date on a
// record. Sorting on the display string would order tickets by the month's name.
ok('...and it sorts on the ISO date, not on the display string',
  /dateRaisedISO/.test(sortBody) && !/\.dateRaised\b(?!ISO)/.test(sortBody));
ok('...with priority ranked Urgent-first, and unset last',
  /PRIORITY_RANK/.test(appJs) && /Object\.fromEntries\(TICKET_PRIORITIES/.test(appJs) &&
  /PRIORITY_RANK/.test(sortBody));

// ── The two rules that keep the grid from being crushed and from being one wide ──
head('the grid rows are content-sized, and the pane is gated by one class');

const gridCssNC = viewsCss.replace(/\/\*[\s\S]*?\*\//g, '');
const gridRule = (gridCssNC.match(/#index-view\.is-grid \.ir-grid\s*\{([^}]*)\}/) || [])[1] || '';
ok('the grid is its own vertical scroller, like the list',
  /overflow-y:\s*auto/.test(gridRule) && /flex:\s*1/.test(gridRule) && /min-height:\s*0/.test(gridRule),
  gridRule.trim().replace(/\s+/g, ' ').slice(0, 140));
// ⚠⚠ THE FIX THIS FILE EXISTS FOR, ONE LEVEL DOWN. `grid-auto-rows: auto` — the
// default — starts every row at its items' automatic minimum size, and that minimum
// is ZERO for an item with `overflow: hidden`, as a tile is. So each row grew only by
// its share of the container's free space: measured 1440x900, 80 records, 16 rows,
// clientHeight 572 — rows resolved to 24px against 124px of tile content, clipped,
// and scrollHeight equalled clientHeight so there was NO scrollbar. A crushed grid
// that reads as a short one. `min-content` sizes the rows from their content instead
// of from the leftover space. Same lesson as `.ir-list > * { flex: 0 0 auto }`.
ok('...and its rows are content-sized, not handed the leftover free space',
  /grid-auto-rows:\s*min-content/.test(gridRule),
  (gridRule.match(/grid-auto-rows:[^;]*/) || ['(no grid-auto-rows at all)'])[0]);
// The mockup's 280px, and `auto-fill` so a narrow pane falls to one column with no
// breakpoint behind it.
ok('the columns are the mockup\'s own minimum width, and auto-fill does the phone',
  /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(17\.5rem,\s*1fr\)\)/.test(gridRule));
// Square tiles "for free": #index-view re-points --radius-1…--radius-8 to 0px, so
// asking for a TOKEN is what makes them square. A hand-written radius would be a
// second opinion about the look, and a shadow is the one thing this look never does.
const tileRule = (gridCssNC.match(/(?:^|\n)\.ir-tile\s*\{([^}]*)\}/) || [])[1] || '';
ok('the tile takes its radius from a token, and writes no radius value of its own',
  /border-radius:\s*var\(--radius-\d\)/.test(tileRule) &&
  !/border-radius:\s*[^;]*\d(?:px|rem)/.test(tileRule) &&
  /background:\s*var\(--ind-panel\)/.test(tileRule),
  (tileRule.match(/border-radius:[^;]*/) || ['(none)'])[0]);
ok('...and it floats nothing, because this look floats nothing',
  !/box-shadow/.test(tileRule) && !/box-shadow/.test(gridRule));
ok('...and it clips its own subject to two lines, the only way vanilla CSS can',
  /-webkit-line-clamp:\s*2/.test(gridCssNC) &&
  /\.ir-tile-subject\s*\{[^}]*-webkit-box-orient:\s*vertical/.test(gridCssNC));
// Folded to the rail, the grid must go too, or it stays on screen over nothing.
ok('folding the list to its rail hides the grid with the list and the board',
  /html\.list-collapsed #index-view \.ir-list,[\s\S]{0,200}?html\.list-collapsed #index-view \.ir-grid,/.test(baseCss));
// A phone zooms the page for a control under 16px, and a `<select>` counts.
ok('the two selects are raised to 16px on a phone, like the search field',
  /@media \(max-width: 639px\)\s*\{\s*\.list-select\s*\{\s*font-size:\s*16px;\s*\}\s*\}/.test(gridCssNC));

// ── Driven, against the app's own renderer ───────────────────────────────────
// Everything above reads the source. This runs it, because a renderer that is
// correct in the file and wrong in the browser is precisely the failure this suite
// was written after: the list "had" `overflow-y: auto` for weeks and could not
// scroll one pixel.
const { T: G, byId: gById } = loadApp(
  'renderIRGrid, gridTile, GRID_CAP, get irGrid() { return irGrid; }',
  { capture: true });
const gridEl = gById.get('ir-grid');
ok('the test is holding the same grid element the app is', !!gridEl && G.irGrid === gridEl);

const tileIR = {
  irNumber: 'IR470', status: 'Open', issueType: 'Battery not charging',
  companyName: 'MAHYCO', customerName: 'A Person', droneId: 'SN-4412',
  category: 'CRASH', priority: 'Urgent', assigneeName: 'AN Adhik Nair',
  dateRaisedISO: '2026-09-01',
};
const oneTile = G.gridTile(tileIR);
ok('a tile is drawn from a record, and carries the id the app routes on',
  /class="ir-tile/.test(oneTile) && /data-id="IR470"/.test(oneTile));
ok('...it prints the company and the serial, and NOT the reporter\'s name',
  /MAHYCO/.test(oneTile) && /SN-4412/.test(oneTile) &&
  oneTile.indexOf('A Person') > 0 && !/>A Person</.test(oneTile),
  oneTile.replace(/\s+/g, ' ').slice(0, 200));
ok('...it carries the status badge the list uses, not a colour of its own',
  /class="badge/.test(oneTile) && /Open/.test(oneTile));
ok('...and the priority, the assignee monogram and the age',
  /prio prio-urgent/.test(oneTile) && /AN/.test(oneTile) && /ir-age/.test(oneTile));

G.renderIRGrid([]);
ok('an empty result says so, in the words the list and the board already use',
  /class="empty-state"/.test(gridEl.innerHTML), gridEl.innerHTML.slice(0, 120));

const many = Array.from({ length: 200 }, (_, i) => ({ ...tileIR, irNumber: 'IR' + i }));
G.renderIRGrid(many);
// ⚠ `class="ir-tile[" ]` and not `class="ir-tile` — the tile's OWN children are
// `.ir-tile-top`, `.ir-tile-subject`, `.ir-tile-meta`, `.ir-tile-foot`, `.ir-tile-state`,
// `.ir-tile-who`, `.ir-tile-avatar` and `.ir-tile-co`, so a prefix match counted all nine
// of them per tile. It read 540 against a cap of 60 — a number that would have passed
// for the wrong reason the day it happened to line up.
const TILE_RE = /class="ir-tile[" ]/g;
const drawn = (gridEl.innerHTML.match(TILE_RE) || []).length;
ok('the cap is what is DRAWN, and exactly the cap',
  drawn === G.GRID_CAP, { drawn, cap: G.GRID_CAP });
ok('...and the rest is offered as a way back to the list, with the count in it',
  /class="grid-more"/.test(gridEl.innerHTML) && /grid-more/.test(appJs) &&
  gridEl.innerHTML.indexOf('grid-more') > gridEl.innerHTML.indexOf('class="ir-tile'));
// The header count is the FULL count while only the drawing is capped — the board's
// own rule, and the reason a capped view can never quietly under-report.
G.renderIRGrid(many.slice(0, 3));
ok('a short result draws every tile and offers no way out',
  (gridEl.innerHTML.match(TILE_RE) || []).length === 3 &&
  !/grid-more/.test(gridEl.innerHTML),
  (gridEl.innerHTML.match(TILE_RE) || []).length);

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
