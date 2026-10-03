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
head('List | Board is a switch over one filtered set of rows');
ok('index.html carries the switch, with a button per view',
  /id="list-view-switch"/.test(html) &&
  /data-view="list"/.test(html) && /data-view="board"/.test(html));
ok('it sits in the list toolbar, beside the title, above the filters',
  html.indexOf('id="list-view-switch"') > html.indexOf('class="list-toolbar-top"') &&
  html.indexOf('id="list-view-switch"') < html.indexOf('id="search-input"'));
ok('the board is a sibling of the list, not a seventh nav tab',
  /<div id="ir-board"[^>]*class="ir-board"/.test(html) &&
  !/data-section="board"/.test(html));
ok('the board pane is reachable by keyboard, for its sideways scroll',
  /<div id="ir-board"[^>]*tabindex="0"/.test(html));

// The one filter, two drawings: the branch is the whole contract.
const applyFilters = (appJs.match(/function applyListFilters\(\)[\s\S]*?\n\}/) || [''])[0];
ok('applyListFilters feeds the board the very same rows the list would get',
  /if \(listMode === 'board'\) renderBoard\(rows\);/.test(applyFilters) &&
  /else renderIRList\(rows\);/.test(applyFilters),
  applyFilters.slice(-160));
ok('...so a filter or a search repaints whichever view is showing',
  /setListView\([\s\S]*?applyListFilters\(\)/.test(appJs));

// CSS alone decides which of the two is drawn, so the buttons, the pane class and
// the repaint cannot disagree about which view is showing.
ok('the switch is a class on the pane, not two elements kept in step',
  /#index-view\.is-board \.ir-list\s*\{\s*display:\s*none/.test(viewsCss) &&
  /#index-view\.is-board \.ir-board\s*\{/.test(viewsCss) &&
  /pane\.classList\.toggle\('is-board'/.test(appJs));

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

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
