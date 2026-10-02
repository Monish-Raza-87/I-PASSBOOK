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
//   * a section column is named with the app's OWN short name, so the column a
//     card sits in and the tab it lives on say the same words.
//   * the header count is the column's FULL count while only the drawing is
//     capped, so a column can never quietly under-report what it holds.
//   * nothing moves a card by itself. Moving an IR's stage writes `statusAt`,
//     which is what every ageing readout is measured from, so it stays a
//     deliberate act — see the note on syncIRStateAfterSectionSave().

import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const appJs = read('../app.js');
const html = read('../index.html');
const viewsCss = read('../views.css');

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
ok('the app really does store fourteen workflow stages', statusValues.length === 14, statusValues.join(' '));

// The BOARD_COLUMNS literal, brace-matched from its `[` so a later array in the
// file cannot be swept in.
const bcStart = appJs.indexOf('const BOARD_COLUMNS = [');
const bcEnd = bcStart < 0 ? -1 : appJs.indexOf('\n];', bcStart);
const boardCols = bcStart < 0 ? '' : appJs.slice(bcStart, bcEnd + 3);
ok('the board declares its columns', boardCols.length > 0, bcStart);

const placed = [...boardCols.matchAll(/stages:\s*\[([^\]]*)\]/g)]
  .flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
ok('every stage a column claims is one of the app\'s own',
  placed.length > 0 && placed.every(s => statusValues.includes(s)),
  placed.filter(s => !statusValues.includes(s)));
ok('and the nine columns place all fourteen, each exactly once',
  placed.length === statusValues.length &&
  [...placed].sort().join('|') === [...statusValues].sort().join('|'),
  `${placed.length} placed: ${placed.join('/')}`);

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
ok('a start column holds the un-started stages',
  /title:\s*'Not started'[^}]*stages:\s*\[\s*'Open'\s*,\s*'Remote Support'\s*\]/.test(boardCols));
ok('a paused column holds Hold',
  /title:\s*'Paused'[^}]*stages:\s*\[\s*'Hold'\s*\]/.test(boardCols));
ok('a finished column holds the closed stages, and is drawn quiet',
  /title:\s*'Finished'[^}]*stages:\s*\[[^\]]*'Close'[^\]]*\][^}]*quiet:\s*true/.test(boardCols));

// ── A column's count is the truth even when its drawing is capped ────────────
head('a capped column still counts everything it holds');
ok('the drawing is capped', /const BOARD_CAP\s*=\s*\d+/.test(appJs));
ok('...and the header prints the FULL count, not the drawn one',
  /class="kb-col-count">\$\{rows\.length\}/.test(appJs));
ok('...and the capped cards are the ones actually drawn',
  /const shown = rows\.slice\(0, BOARD_CAP\)/.test(appJs) && /\$\{shown\.map\(boardCard\)/.test(appJs));
ok('...and what was left behind is stated, with a way back to the list',
  /more > 0 \? `<button type="button" class="kb-more">\+\$\{more\} more — see list<\/button>`/.test(appJs));

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

// The board is placed ABOVE the polish block: nothing may be appended after it.
ok('the board styles sit before the POLISH block, not after it',
  viewsCss.indexOf('THE IR BOARD') > -1 &&
  viewsCss.indexOf('THE IR BOARD') < viewsCss.indexOf('POLISH — level:'));
ok('and the board restates no colour — every value is a token',
  !/#[0-9a-fA-F]{3,8}\b/.test(viewsCss.slice(viewsCss.indexOf('THE IR BOARD'), viewsCss.indexOf('POLISH — level:'))));

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails ? 1 : 0);
