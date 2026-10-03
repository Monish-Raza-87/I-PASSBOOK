// Smoke test for the two things the owner asked for on the Allot CAPS panel
// (Release A, item A5): the panel's new NAME, the type-to-search "Assigned to"
// picker, and the day window every priority label now carries.
//
//   node tools/smoke-allot.mjs
//
// Three claims are pinned here, and each of them fails in a way that LOOKS fine:
//
//   1. "Allot CAPS" is a DISPLAY rename. The word Triage was retired from the
//      screen, not from the store — the permission is still the `triage` key on
//      a profile and still asked for through canTriage(). A rename that reached
//      the stored key would not break any test, any render, or any screen; it
//      would silently un-grant CR and Management, and the only symptom would be
//      two people losing a button they have always had.
//
//   2. The assigned-to control's STORED value is an email and its DISPLAYED
//      value is a name. `applyTriage` must read the hidden email input, never
//      the box a person types in — otherwise the name is written into the store,
//      the assignment email is addressed to nobody, and the ticket still claims
//      an owner. And a name typed into the box that matches no one must resolve
//      to NOTHING rather than being accepted, for the same reason.
//
//   3. A priority's day window is READ FROM IR_OVERDUE_DAYS, not written out a
//      second time. Two copies of "3" is two answers waiting to disagree, and
//      the disagreement is invisible: the label would say one window while the
//      clock painted the ticket late on another. The map itself is pinned by
//      smoke-list-intel.mjs and smoke-door-faq.mjs; this suite pins that the
//      label derives from it.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();

const appJs     = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const T = loadApp(`
  canTriage, myAccess, IR_OVERDUE_DAYS, irOverdueLimit,
  TRIAGE_LABEL, TRIAGE_SHORT, CATEGORY_LABELS,
  priorityLabel, priorityWindow,
  assigneeRows, assigneeMatches, assigneeOptionHtml, assigneeDisplayName, resolveTriageAssignee,
  setUser: u => { currentUser = u; },
  get teamDirectory() { return teamDirectory; },
  setDirectory: e => { teamDirectory = e; },
`);

// ── 1. The rename is display-only ─────────────────────────────────────────────
r.head('"Allot CAPS" renames the panel, not the permission');

r.ok('the header button reads Allot CAPS',
  /id="ir-triage-btn"[^>]*>[\s\S]{0,80}?<\/span>Allot CAPS</.test(indexHtml),
  (indexHtml.match(/id="ir-triage-btn"[^\n]*/) || ['(no button)'])[0]);
r.ok('...and the retired word is nowhere in the button markup',
  !/id="ir-triage-btn"[^\n]*>[\s\S]{0,80}?<\/span>Triage</.test(indexHtml));
r.ok('the panel heading says Allot CAPS too',
  /<h3>Allot CAPS \$\{escHtml\(ir\.irNumber\)\}<\/h3>/.test(appJs));
r.ok('and the panel no longer calls itself Triage',
  !/<h3>Triage \$\{escHtml\(ir\.irNumber\)\}<\/h3>/.test(appJs));

// The half that must NOT have moved. Every one of these is a stored key or the
// function that reads it; a rename that touched any of them is the bug this
// section exists to catch.
r.ok('the permission is still the `triage` key on a profile',
  /const a = myAccess\(\); if \(a\.role === 'admin'\) return true; return a\.triage === true;/.test(appJs));
r.ok('the grant grid still writes data-sec="triage"',
  /data-sec="triage"/.test(appJs));
// The real risk of a rename that reached the store: every section granted, and
// the panel still missing. If `canTriage` ever started reading a grant instead
// of the `triage` axis, THIS is the account that would notice.
T.setUser({ email: 'qc@indrones.com', sessionToken: 't',
           access: { role: 'user', departments: [],
                     permissions: { 'sec-a': 'edit', 'sec-b': 'edit', 'sec-c': 'edit',
                                    'sec-d': 'edit', 'sec-e': 'edit', 'sec-f': 'edit',
                                    'sec-g': 'edit' },
                     triage: false } });
r.ok('every section granted, and still no Allot CAPS — the two axes stay separate',
  T.canTriage() === false);
T.setUser({ email: 'plain@indrones.com', sessionToken: 't',
           access: { role: 'user', permissions: {}, departments: [], triage: false } });
r.ok('a profile without triage cannot allot caps', T.canTriage() === false);
T.setUser({ email: 'cr@indrones.com', sessionToken: 't',
           access: { role: 'user', permissions: {}, departments: [], triage: true } });
r.ok('...and one with it can', T.canTriage() === true);
r.ok('the admin UI label was renamed with it, and the short code was not',
  T.TRIAGE_LABEL === 'TR' && /^Allot CAPS \(/.test(T.TRIAGE_SHORT),
  [T.TRIAGE_LABEL, T.TRIAGE_SHORT]);

// ── 2. The "Assigned to" picker ───────────────────────────────────────────────
r.head('the assigned-to picker is a combo, and its store value is an email');

r.ok('the box is a combobox pointing at its list',
  /id="triage-assignee"[^>]*role="combobox"/.test(appJs) &&
  /aria-controls="triage-assignee-list"/.test(appJs));
r.ok('the stored value lives in a hidden input of its own',
  /id="triage-assignee-email"/.test(appJs) && /<input type="hidden" id="triage-assignee-email"/.test(appJs));
r.ok('the list is a listbox, and it is built from the one option builder',
  /id="triage-assignee-list"[^>]*role="listbox"/.test(appJs) &&
  /list\.innerHTML = assigneeOptionHtml\(query\);/.test(appJs));
r.ok('applyTriage reads the hidden email, never the typed name',
  /const email\s+= document\.getElementById\('triage-assignee-email'\)\?\.value/.test(appJs) &&
  !/const email\s+= document\.getElementById\('triage-assignee'\)\?\.value/.test(appJs));
r.ok('the old native select is gone, so there is exactly one control',
  !/<select class="form-input" id="triage-assignee">/.test(appJs));

r.head('the filter is a function of its argument, not of the DOM');
const dir = T.teamDirectory;
const names = T.assigneeRows().map(d => d.name);
r.ok('an empty query matches the whole team', T.assigneeMatches('').length === dir.length, dir.length);
r.ok('...and a bare "@" does too, because that is the mention habit',
  T.assigneeMatches('@').length === dir.length);
r.ok('rows come back name-sorted, on a copy',
  names.join('|') === names.slice().sort((a, b) => String(a).localeCompare(String(b))).join('|'),
  names);
r.ok('...and the stored directory was not re-ordered by the render',
  T.teamDirectory.map(d => d.email).join('|') === dir.map(d => d.email).join('|'));
r.ok('a name fragment narrows to that person',
  T.assigneeMatches('rav').length === 1 && T.assigneeMatches('rav')[0].name === 'Ravi Singh',
  T.assigneeMatches('rav'));
r.ok('an email fragment narrows the same way',
  T.assigneeMatches('adhik.nair@').length === 1);
r.ok('matching ignores case', T.assigneeMatches('RAVI').length === 1);
r.ok('and a query nobody matches returns nobody',
  T.assigneeMatches('zzz-nobody').length === 0);

r.head('the option list always keeps a way back to Unassigned');
const htmlAll = T.assigneeOptionHtml('');
r.ok('every directory name is offered',
  dir.every(d => htmlAll.indexOf(T.assigneeDisplayName(d.email)) !== -1), dir.length);
r.ok('the email rides along as the option\'s own value',
  htmlAll.indexOf(`data-email="${dir[0].email}"`) !== -1);
r.ok('Unassigned is FIRST, before any name',
  htmlAll.indexOf('>Unassigned<') !== -1 &&
  htmlAll.indexOf('combo-item') < htmlAll.indexOf('>Unassigned<') &&
  htmlAll.indexOf('>Unassigned<') < htmlAll.indexOf(dir[0].name),
  htmlAll.slice(0, 220));
r.ok('the Unassigned row resolves to the empty email, not a person',
  /pickTriageAssignee\(''\)/.test(htmlAll));
r.ok('a filtered list still offers the way back',
  T.assigneeOptionHtml('rav').indexOf('>Unassigned<') !== -1);
r.ok('an unmatched query says so instead of showing an empty box',
  /combo-empty/.test(T.assigneeOptionHtml('zzz-nobody')) &&
  T.assigneeOptionHtml('zzz-nobody').indexOf('zzz-nobody') !== -1);
r.ok('and it still offers Unassigned under the empty row',
  T.assigneeOptionHtml('zzz-nobody').indexOf('>Unassigned<') !== -1);

r.head('what a typed name resolves to');
r.ok('a full name resolves to the email',
  (T.resolveTriageAssignee('Ravi Singh') || {}).email === 'ravi@indrones.com');
r.ok('an email resolves to itself', (T.resolveTriageAssignee('ravi@indrones.com') || {}).email === 'ravi@indrones.com');
r.ok('the "Name <email>" form the mention box prints also resolves',
  (T.resolveTriageAssignee('Ravi Singh <ravi@indrones.com>') || {}).email === 'ravi@indrones.com');
r.ok('an empty box means unassigned', (T.resolveTriageAssignee('') || {}).email === '');
r.ok('the word Unassigned means unassigned',
  (T.resolveTriageAssignee('Unassigned') || {}).email === '');
r.ok('a PARTIAL name resolves to NOTHING — it must never be accepted',
  T.resolveTriageAssignee('Rav') === null);
r.ok('a name that matches no one resolves to nothing too',
  T.resolveTriageAssignee('Some Outsider') === null);
r.ok('and a bare unrelated email is not silently invented as a member',
  T.resolveTriageAssignee('stranger@example.com') === null);

r.head('the box displays a name and stores an email');
r.ok('a known email displays its name',
  T.assigneeDisplayName('ravi@indrones.com') === 'Ravi Singh');
r.ok('an unknown email displays itself rather than vanishing',
  T.assigneeDisplayName('ghost@indrones.com') === 'ghost@indrones.com');
r.ok('and no assignee displays nothing, which is what the placeholder is for',
  T.assigneeDisplayName('') === '' && T.assigneeDisplayName(null) === '');

r.head('the picker cannot lie about what a save would write');
r.ok('blur commits a resolvable entry', /function commitAssigneeInput\(\)/.test(appJs) &&
  /if \(r\) \{[\s\S]{0,120}hidden\.value = r\.email;/.test(appJs));
r.ok('...and REVERTS the rest, so the box never shows a name the save ignores',
  /box\.value = assigneeDisplayName\(hidden \? hidden\.value : ''\)/.test(appJs));
r.ok('Escape closes without changing the value',
  /e\.key === 'Escape'[\s\S]{0,60}closeAssigneeOptions\(\)/.test(appJs));
r.ok('Enter is only swallowed when a row is actually highlighted',
  /e\.key === 'Enter'[\s\S]{0,160}assigneeSuggestIndex >= 0 && items\[assigneeSuggestIndex\]/.test(appJs));

// ── 3. Priority labels carry the window, read from the clock's own map ────────
r.head('a priority label carries the window the overdue clock uses');

const WINDOW = { Urgent: '0–1 day', High: '0–3 days', Medium: '0–7 days', Low: '0–14 days' };
Object.keys(WINDOW).forEach(k => {
  r.ok(`${k} reads "${WINDOW[k]}"`, T.priorityWindow(k) === WINDOW[k], T.priorityWindow(k));
  r.ok(`...and its full label is "${k} (${WINDOW[k]})"`,
    T.priorityLabel(k) === `${k} (${WINDOW[k]})`, T.priorityLabel(k));
});

// The derivation, stated as a property rather than as five more literals: for
// EVERY key in the map, the spoken window is "0–" plus that key's own number.
// Change a number in IR_OVERDUE_DAYS and this cannot stay green by accident —
// which is the whole point of reading it instead of copying it.
r.ok('every window is derived from IR_OVERDUE_DAYS, not written out again',
  Object.keys(T.IR_OVERDUE_DAYS).every(k => {
    const d = T.IR_OVERDUE_DAYS[k];
    return T.priorityWindow(k) === `0–${d} ${d === 1 ? 'day' : 'days'}`;
  }), Object.keys(T.IR_OVERDUE_DAYS).map(k => [k, T.IR_OVERDUE_DAYS[k], T.priorityWindow(k)]));
r.ok('a priority outside the four gets NO window, rather than the loosest one',
  T.priorityWindow('Whatever') === '' && T.priorityLabel('Whatever') === 'Whatever',
  T.priorityWindow('Whatever'));
r.ok('...even though the CLOCK still has to answer with a number for it',
  T.irOverdueLimit('Whatever') === 14);
r.ok('and an absent priority has no window either',
  T.priorityWindow('') === '' && T.priorityWindow(null) === '');
r.ok('the stored word is matched case-insensitively, like the clock does',
  T.priorityWindow('high') === '0–3 days');

r.head('every surface that shows a priority shows the same one');
// Pinned as an EXACT SUBSTRING rather than a pattern, because the first version
// of this assertion used a loose /\$\{[^}]*\}/ and silently matched the ticket
// HEADER instead of the list card — so it passed, and would keep passing, with
// the card still printing the raw stored word. The discriminator is the card's
// own class sanitiser, which the header does not have.
const cardPrio = '<span class="prio prio-${escHtml(String(ir.priority).toLowerCase().replace(/[^a-z0-9_-]/g, \'\'))}">${escHtml(priorityLabel(ir.priority))}</span>';
r.ok('the list card prints the label, not the raw stored word',
  appJs.indexOf(cardPrio) !== -1, cardPrio.slice(0, 60));
r.ok('...and the ticket header prints the same label from the same function',
  /<span class="prio prio-\$\{String\(ir\.priority\)\.toLowerCase\(\)\}">\$\{escHtml\(priorityLabel\(ir\.priority\)\)\}<\/span>/.test(appJs));
r.ok('the Allot CAPS dropdown offers each priority with its window',
  /TICKET_PRIORITIES\.map\(v => opt\(v, ir\.priority \|\| '', priorityLabel\(v\)\)\)/.test(appJs));
r.ok('...and the options are built from the same four the clock knows',
  /const TICKET_PRIORITIES = \['Urgent', 'High', 'Medium', 'Low'\];/.test(appJs) &&
  Object.keys(T.IR_OVERDUE_DAYS).join('|') === 'Urgent|High|Medium|Low',
  Object.keys(T.IR_OVERDUE_DAYS));
r.ok('the card\'s folded detail line carries it too, since the pill is small',
  /ir\.priority \? escHtml\(priorityLabel\(ir\.priority\)\) : ''/.test(appJs));

r.finish();
