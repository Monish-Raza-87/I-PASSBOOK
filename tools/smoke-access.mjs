// Smoke test for the access model: EDIT for every staff account, an off-switch per
// department, customers a separate role, admins bypassing everything.
//
//   node tools/smoke-access.mjs
//
// ⚠ THE MODEL INVERTED IN v95 AND THIS FILE WAS REWRITTEN WITH IT. It used to open
// with "view + comment for everyone, edit from departments" and build its central
// fixture as a staff account with 'view' everywhere. That profile is now what a person
// whose sections have all been switched OFF looks like — it is the RARE end of the
// range, not the ordinary one. The owner's instruction of 2026-10-14 was: *"by default
// all users will have view and edit access of all the sections … let us give edit
// access to all employees for now with functionality to revoke edit permission if
// required at any later point of time."* So the two fixtures below are inverted, and
// the assertions that hung off the old one are rebuilt rather than reworded.
//
// WHERE THE RULE ACTUALLY LIVES. The resolution of departments into a permission map —
// including DENY WINS, the rule that one department switching a section off beats every
// department that leaves it on — happens in the BACKEND, in getEffectiveAccess(). This
// suite is the frontend's half: given a resolved map, does every control answer it the
// same way. The resolution itself is proved against the real store in smoke-store.mjs
// (the keystone there revokes sec-d on a department and reads the map back) and in
// smoke-backend.mjs (the shape of departmentCapabilities). Nothing here re-implements it.
//
// The most valuable assertion here is still the fallback one. `myAccess()` returns a
// fallback while getMyAccess is still in flight (first paint, or a transient backend
// failure). That fallback has to fail CLOSED on writes and OPEN on reads: a disabled
// Save button is recoverable, an unauthorised write is not. ⚠ And the stakes ROSE in
// v95: the real profile is now edit-everywhere, so a fallback that guessed edit would
// turn "permissions have not arrived yet" into "everyone can write", for the whole
// company, for the duration of an outage.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();

const appJs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

const T = loadApp(`
  SECTION_IDS, OVERVIEW_KEY, ADMIN_EMAILS, isAdmin, myAccess,
  canViewSection, canCommentSection, canEditSection, canTriage, sectionRevokedBy,
  setUser: u => { currentUser = u; },
  clearUserAccess: () => { if (currentUser) delete currentUser.access; },
`);

const SECTIONS = T.SECTION_IDS;

const permsOf = level => {
  const perms = {};
  SECTIONS.forEach(s => { perms[s] = level; });
  perms[T.OVERVIEW_KEY] = 'view';
  return perms;
};

// THE ORDINARY ACCOUNT, as of v95: an admin creates it and it can edit every section
// straight away, with no department and no grant of any kind. That is the default the
// owner asked for, and it is what the fixture below is named for.
const staffUser = (over = {}) => ({
  name: 'Staff', email: 'staff@indrones.com', sessionToken: 't',
  access: Object.assign({ role: 'user', permissions: permsOf('edit'),
                          departments: [], triage: false, revokedBy: {} }, over),
});

// THE OTHER END: every section switched off by a department. Built by flipping the whole
// map rather than by naming one section, so a later section that is added to SECTION_IDS
// arrives already revoked here instead of silently becoming editable in the fixture.
const revokedUser = (over = {}) => ({
  name: 'Revoked', email: 'revoked@indrones.com', sessionToken: 't',
  access: Object.assign({ role: 'user', permissions: permsOf('view'),
                          departments: ['QC'], triage: false, revokedBy: {} }, over),
});

// ── Who is an admin ───────────────────────────────────────────────────────────
r.head('the admin list');
r.ok('exactly one admin address', T.ADMIN_EMAILS.length === 1, T.ADMIN_EMAILS);
r.ok('and it is monish.raza@indrones.com', T.ADMIN_EMAILS[0] === 'monish.raza@indrones.com', T.ADMIN_EMAILS);
r.ok('customer.relations is NOT an admin', !T.ADMIN_EMAILS.includes('customer.relations@indrones.com'));
r.ok('isAdmin() is case/whitespace tolerant', (() => {
  T.setUser({ email: '  Monish.Raza@Indrones.com ', sessionToken: 't' });
  return T.isAdmin() === true;
})());

// De-admining an address is not enough on its own: it survived in
// TEAM_DIRECTORY_DEFAULTS, the seed for the @-mention autocomplete, long after it
// stopped being an account. A directory entry that resolves to no mailbox turns a
// mention into a silent bounce, and it reads to the next maintainer as an
// authority. Asserted over the whole source so it cannot come back anywhere.
r.head('the de-admined address is gone from the frontend entirely');
r.ok('customer.relations@indrones.com appears nowhere in app.js',
  !/customer\.relations@indrones\.com/i.test(appJs),
  (appJs.match(/[^\n]*customer\.relations[^\n]*/i) || [''])[0]);
r.ok('and no Customer Relations seed row remains',
  !/name:\s*'Customer Relations'/i.test(appJs),
  (appJs.match(/[^\n]*Customer Relations[^\n]*/) || [''])[0]);

// ── Everyone gets view + comment + EDIT, everywhere ───────────────────────────
r.head('a brand-new staff account: view + comment + EDIT on all seven sections');
T.setUser(staffUser());
r.ok('the section list is the seven survivors', SECTIONS.length === 7 && SECTIONS.join(',') === 'sec-b,sec-c,sec-d,sec-cost,sec-e,sec-f,sec-g', SECTIONS);
r.ok('canView all six', SECTIONS.every(s => T.canViewSection(s)),
  SECTIONS.filter(s => !T.canViewSection(s)));
r.ok('canComment all six (comment comes WITH view)',
  SECTIONS.every(s => T.canCommentSection(s)),
  SECTIONS.filter(s => !T.canCommentSection(s)));
// ⚠ INVERTED IN v95. This asserted `canEdit NONE of them`, and that sentence was true
// for exactly as long as edit came from a department. It now comes from the account
// being a staff account at all — so an account with NO departments edits everything,
// and an assertion that it does not would be the old model re-asserted by accident.
r.ok('and canEdit ALL of them — the v95 default needs no department and no grant',
  SECTIONS.every(s => T.canEditSection(s)),
  SECTIONS.filter(s => !T.canEditSection(s)));
// The one thing the default does NOT carry. Edit on all seven sections is not edit on
// the ticket header: status, assignee and priority are a separate axis with its own
// department flag, and if the two ever collapsed a brand-new account could re-status
// every IR in the building.
r.ok('and still cannot Triage — the default is seven sections, not the ticket header',
  T.canTriage() === false);
// Retired ids are not sections any more, and no permission map carries them — so a
// stale bookmark or a cached shell asking for one gets a clean "no", not a crash.
r.ok('the retired ids are not in the section list',
  ['sec-a', 'sec-h', 'sec-i'].every(s => !SECTIONS.includes(s)), SECTIONS);

// ── The one account that cannot edit: everything switched off ──────────────────
r.head('a department that unticked every section takes edit away, and the sections stay VISIBLE');
T.setUser(revokedUser());
r.ok('the premise holds — nothing is editable', !SECTIONS.some(s => T.canEditSection(s)),
  SECTIONS.filter(s => T.canEditSection(s)));
// ⚠ THE LEVER TAKES EDIT, NEVER THE SECTION. A revoked person can still read every
// pane and still comment on it; only the write controls go dead. If a revoke ever hid
// a tab, the app would be answering "you may not edit this" with "this does not exist",
// and the person would have no way to tell which had happened.
r.ok('every section is still VIEWABLE — a revoke never hides a tab',
  SECTIONS.every(s => T.canViewSection(s)), SECTIONS.filter(s => !T.canViewSection(s)));
r.ok('and still commentable', SECTIONS.every(s => T.canCommentSection(s)),
  SECTIONS.filter(s => !T.canCommentSection(s)));

// ── A write right on one section does not leak to the next ─────────────────────
r.head('the resolved map is what the frontend obeys, one key per section');
// The frontend receives a map the backend has already resolved, and this is the shape
// of it. What is being proved here is NOT the resolution (that is getEffectiveAccess,
// proved in smoke-store.mjs) but that the frontend reads it KEY BY KEY and invents
// nothing — no "has any edit at all, therefore edit everywhere", which is the mistake
// a union-across-departments model invites and deny-wins exists to defeat.
T.setUser(staffUser({
  permissions: Object.assign(permsOf('edit'), { 'sec-c': 'view' }),
  departments: ['IQC', 'Production'],
  revokedBy: { 'sec-c': ['IQC'] },
}));
r.ok('the revoked section is not editable', T.canEditSection('sec-c') === false);
r.ok('...and the other six are untouched by it',
  SECTIONS.filter(s => s !== 'sec-c').every(s => T.canEditSection(s)),
  SECTIONS.filter(s => s !== 'sec-c' && !T.canEditSection(s)));
r.ok('view is unaffected on the revoked section',
  T.canViewSection('sec-c') && T.canCommentSection('sec-c'));
// The independence case, and the one that matters most: holding edit on seven sections
// must NOT confer Triage. If the two were conflated, an ordinary editor would also get
// the ticket header — status, assignee, priority — for every IR.
r.ok('an edit right on any section does NOT confer Triage', T.canTriage() === false);
r.ok('the department list is carried for the UI',
  T.myAccess().departments.join(',') === 'IQC,Production', T.myAccess().departments);
// The attribution the pane's note is painted from. Absent must read as "nobody said",
// which is a different sentence from "no department did it" — see the sweep below.
r.ok('and the revoking department is carried by name, so the person can be told',
  T.sectionRevokedBy('sec-c').join(',') === 'IQC', T.sectionRevokedBy('sec-c'));
r.ok('a section nobody revoked attributes to nobody',
  T.sectionRevokedBy('sec-b').length === 0, T.sectionRevokedBy('sec-b'));

// ── Triage is a SECOND axis, and the two do not leak into each other ─────────
r.head('CR and Management hold Triage, and Triage is not what gives them their sections');
// ⚠ THIS SECTION INVERTED IN v95 TOO, and in the direction that is easy to miss. It used
// to prove "a Triage holder edits NO section" — the CR profile was triage:true with every
// section at view, so the two axes were distinguishable by their VALUES. They no longer
// are: a CR account now edits all seven sections AND holds Triage, exactly like everybody
// else's edit rights plus one extra flag. So the risk has flipped end for end. What must
// be proved now is the OTHER direction of the leak — that holding edit on every section
// does not, by itself, hand anyone the ticket header. The fixture below is the ordinary
// staff account with `triage` left at false, and the assertions run both ways.
T.setUser(staffUser({ email: 'adhik.nair@indrones.com', departments: ['CR'] }));
r.ok('the ordinary account edits all seven sections', SECTIONS.every(s => T.canEditSection(s)));
r.ok('and Triage is still NOT granted — the sections did not carry it', T.canTriage() === false);
// Now the CR profile as the backend actually builds it: the same map, plus the flag. The
// backend also raises the Overview's own key to 'edit' (getEffectiveAccess:
// `if (triage) perms[OVERVIEW_KEY] = 'edit'`), so the payload a Triager receives carries
// it — one canEdit() seam gates the Overview like any other record, no second check.
T.setUser(staffUser({
  email: 'adhik.nair@indrones.com',
  permissions: Object.assign(permsOf('edit'), { 'sec-a': 'edit' }),
  departments: ['CR'], triage: true,
}));
r.ok('Triage is granted', T.canTriage() === true);
r.ok('the Overview rides the same flag, so its two fields are writable',
  T.canEditSection(T.OVERVIEW_KEY) === true, T.myAccess().permissions[T.OVERVIEW_KEY]);
r.ok('but the Overview is readable by everyone, Triage or not',
  (() => { T.setUser(staffUser()); return T.canViewSection('sec-a'); })(),
  T.myAccess().permissions['sec-a']);
// Belt and braces: the frontend does not rely on that map alone. The Overview's
// write path is gated on canTriage() itself, so a payload that forgot to raise the
// key cannot open the ticket header. Asserted over the source because the gate is
// inside a click handler the vm harness does not invoke.
//
// The message is now worded "Allot CAPS" — the panel's DISPLAY name since the
// owner renamed it — while the permission it names is still `triage` and still
// asked for through canTriage(). Both halves are pinned here so a later rename
// cannot quietly swap the GATE for a message change.
r.ok('the Overview save is gated on canTriage(), not on the permission map',
  /if \(!canTriage\(\)\) \{ showToast\('You need Allot CAPS access/.test(appJs),
  (appJs.match(/[^\n]*canTriage\(\)[^\n]*/) || []).slice(0, 4));
// `triage` absent from the profile (an older cached payload) must read as false —
// `undefined === true` is false, but the fallback literal makes it explicit.
T.setUser({
  email: 'old-payload@indrones.com', sessionToken: 't',
  access: { role: 'user', permissions: permsOf('edit'), departments: [] },
});
r.ok('a profile with no triage field at all is NOT a Triage holder', T.canTriage() === false);
T.setUser({
  email: 'sneaky@indrones.com', sessionToken: 't',
  access: { role: 'user', permissions: permsOf('edit'), departments: [], triage: 'yes' },
});
r.ok('and a truthy-but-not-true value does not either', T.canTriage() === false, 'yes');

// ── Admin bypass ──────────────────────────────────────────────────────────────
r.head('an admin bypasses every check');
// Deliberately given EMPTY permissions: the bypass must come from the role, not
// from the permission map, or an admin whose getMyAccess failed would be locked
// out of their own provisioning screen.
T.setUser({ name: 'Monish', email: 'monish.raza@indrones.com', sessionToken: 't',
            access: { role: 'admin', permissions: {}, departments: [] } });
r.ok('canView all six', SECTIONS.every(s => T.canViewSection(s)));
r.ok('canComment all six', SECTIONS.every(s => T.canCommentSection(s)));
r.ok('canEdit all six', SECTIONS.every(s => T.canEditSection(s)));
r.ok('and Triages — the role bypasses that axis too',
  T.canTriage() === true);
r.ok('even with an empty permission map',
  Object.keys(T.myAccess().permissions).length === 0);

// ── The fallback: open on reads, closed on writes ─────────────────────────────
r.head('the un-loaded-access fallback fails closed');
T.setUser({ name: 'Slow', email: 'slow@indrones.com', sessionToken: 't' });   // no .access yet
r.ok('it is marked as a fallback', T.myAccess().__fallback === true, T.myAccess());
r.ok('reads are allowed — the app stays usable', SECTIONS.every(s => T.canViewSection(s)),
  SECTIONS.filter(s => !T.canViewSection(s)));
r.ok('commenting is allowed', SECTIONS.every(s => T.canCommentSection(s)));
// THE assertion. Granting edit here would turn "permissions have not arrived yet"
// into "everyone can write" for the duration of the outage.
//
// ⚠ THE STAKES OF THIS ONE ROSE IN v95, which is why the comment is longer than the
// line. It used to be a guard against a small over-grant: the real profile was view,
// so a fallback that guessed edit gave away a little more than it should have. The
// real profile is now EDIT ON EVERY SECTION, so the same fallback would give away
// exactly the same thing as the real thing — for the whole company, for the whole of
// an outage, with every Save button looking normal. And the fallback is not a rare
// path: it is what paints on first load and on every refresh, for as long as
// getMyAccess takes. It must keep answering 'view'.
r.ok('editing is NOT — never grant a write from a guess',
  !SECTIONS.some(s => T.canEditSection(s)), SECTIONS.filter(s => T.canEditSection(s)));
// Same rule for the second axis, and it needs its own assertion: Triage is what
// gates the ticket header, so a fallback that leaked it would let any signed-in
// user re-status and re-assign every IR in the building while getMyAccess is down.
r.ok('Triage is NOT — the fallback is spelled `triage: false`, not undefined',
  T.myAccess().triage === false && T.canTriage() === false, T.myAccess().triage);
r.ok('the fallback still carries a view on the Overview',
  T.canViewSection('sec-a') === true, T.myAccess().permissions);
r.ok('and a view everywhere else',
  SECTIONS.every(s => T.canViewSection(s)));

// ── The view-only screen: a write button must not look alive ──────────────────
// Reported from the field, on a laptop, in Chrome AND Edge, by one user and not
// the admin: the two evidence buttons — "+ Add image / PDF" and "📷 Capture
// photo" — rendered normally, highlighted on hover, and clicking them did
// NOTHING. No error, no dialog, no message, so it was twice blamed on the
// browser. The cause was here: they shared the COMMENT button's exemption from
// the disable sweep, and comment comes WITH view, so that exemption is satisfied
// for every user who can see the section at all. The buttons stayed live while
// the file inputs they click (`-picker` / `-capture`) were disabled a few lines
// above — and a disabled control has no activation behaviour, so `input.click()`
// opened nothing and said nothing. An admin never sees it: admins skip the sweep.
r.head('a view-only screen disables the WRITE buttons, not just the fields');

const i18nSrc = fs.readFileSync(new URL('../i18n.js', import.meta.url), 'utf8');

const VSEC = 'sec-b';
// A fake element carrying only the surface applySectionAccessGating touches.
//
// The classList is a REAL one — backed by a Set, with the two-argument
// `toggle(name, force)` the DOM has. The gate now also runs the category
// applicability rule, which toggles a class on the pane; a stub missing
// `toggle` throws inside the app rather than in an assertion, so the failure
// reads as a broken app when it is a broken double. `contains` reads the same
// Set the other three write, so a class added here is a class the sweep sees.
const fakeClassList = (...classes) => {
  const set = new Set(classes);
  return {
    contains: c => set.has(c),
    add: (...n) => { n.forEach(x => set.add(x)); },
    remove: (...n) => { n.forEach(x => set.delete(x)); },
    toggle(n, force) {
      const on = force === undefined ? !set.has(n) : !!force;
      on ? set.add(n) : set.delete(n);
      return on;
    },
    get _set() { return set; },
  };
};
const fakeEl = (...classes) => ({
  id: '', type: 'button', disabled: false, style: {}, title: '',
  classList: fakeClassList(...classes),
});

// The pane, and the NOTES the gate paints into it.
//
// ⚠ A note is written by className and then looked up again BY THAT CLASS, and the two
// painters — "the server does not know this section" and "a department switched edit
// off" — must never find each other's element, or whichever runs second deletes the
// first one's work. So this double keeps real children and answers a class selector
// against them. The harness's default `querySelector` returns null, which would make
// both of these vacuous: each painter would build a fresh node every pass and no
// assertion could tell a painted note from a missing one.
let paneNotes = [];
const fakePane = () => ({
  id: VSEC, style: {}, dataset: {},
  classList: fakeClassList(),
  querySelectorAll: () => sweepEls,
  querySelector: sel => {
    if (sel.charAt(0) !== '.') return null;
    const cls = sel.slice(1);
    if (cls !== 'section-edit-off-note' && cls !== 'section-server-note') return null;
    return paneNotes.find(n => n.className === cls) || null;
  },
  firstChild: null,
  insertBefore(node) { paneNotes.push(node); return node; },
});
// `document.createElement` is the one the app uses to BUILD a note, so it is replaced
// through the harness's own hook rather than by patching the app. A created node
// removes ITSELF from the same list the pane searches, which is what makes
// `paint…Note(pane, false)` — "this no longer applies, take it down" — testable.
const makeNote = tag => ({
  tagName: String(tag).toUpperCase(), className: '', textContent: '',
  remove() { const i = paneNotes.indexOf(this); if (i > -1) paneNotes.splice(i, 1); },
});

const D = loadApp(`
  applySectionAccessGating, canEditSection,
  setUser: u => { currentUser = u; },
  document,
`, { preload: i18nSrc, createElement: makeNote });

let sweepEls = [];
let fakeSave = null;
let thePane = null;
D.document.querySelector = () => null;
D.document.getElementById = id => {
  if (id === VSEC) return thePane;
  if (id === 'close-' + VSEC) return fakeSave;
  if (id === 'autosave-' + VSEC) return null;
  return null;                      // every other pane: the `if (!pane) return` guard
};

// ⚠ THE FIXTURE IS BUILT THE WAY THE BACKEND NOW BUILDS IT: edit everywhere, then the
// named sections flipped to view. It used to be `{ [VSEC]: 'view' }` — a map that had no
// 'edit' in it at all, which was a faithful picture of the old model and is now a
// picture of an account whose sections have ALL been switched off. A suite that kept
// that fixture would go on passing while testing a profile nobody has.
//
// `revokedBy` is passed alongside because the pane's note is painted from it, and the
// two states it distinguishes are the point: a section switched off by a NAMED
// department, and a section that is view-only for a reason the server did not name
// (an older backend, a customer, the fallback profile).
const sweepAs = (revokes, revokedBy) => {
  const perms = permsOf('edit');
  Object.keys(revokes || {}).forEach(s => { perms[s] = revokes[s]; });
  D.setUser({ email: 'u@indrones.com', sessionToken: 't',
              access: { role: 'user', permissions: perms, departments: [], triage: false,
                        revokedBy: revokedBy || {} } });
  thePane = fakePane();
  paneNotes = [];
  sweepEls = [
    fakeEl('btn-add-evidence'),      // 0  + Add image / PDF
    fakeEl('btn-add-evidence'),      // 1  📷 Capture photo
    fakeEl('field-nudge-btn'),       // 2  💬 comment — a read-adjacent act
    fakeEl('btn-add-row'),           // 3  a write
    fakeEl('form-input'),            // 4  an ordinary field
    fakeEl(),                        // 5  the hidden pickers (its type is set below)
    fakeEl('field-hist-btn'),        // 6  🕓 a field's history — a READ
  ];
  sweepEls[5].type = 'file';
  fakeSave = fakeEl('btn');
  D.applySectionAccessGating();
  return { add: sweepEls[0], cap: sweepEls[1], comment: sweepEls[2],
           addRow: sweepEls[3], field: sweepEls[4], file: sweepEls[5],
           hist: sweepEls[6], save: fakeSave,
           note: paneNotes.find(n => n.className === 'section-edit-off-note') || null };
};

const vo = sweepAs({ [VSEC]: 'view' }, { [VSEC]: ['QC'] });
r.ok('the premise holds — this user really is view-only here',
  D.canEditSection(VSEC) === false && D.canEditSection('sec-c') === true);
r.ok('"+ Add image / PDF" is DISABLED — it is a write',
  vo.add.disabled === true, vo.add);
r.ok('"📷 Capture photo" is disabled too — same act, same gate',
  vo.cap.disabled === true, vo.cap);
// THE regression assertion. The silent click came from these two disagreeing:
// the button live, the input it clicks dead. Whatever the rule is, a write button
// and the Save button must answer it the same way.
r.ok('every write button agrees with Close, which is what makes the click silent-proof',
  vo.add.disabled === vo.save.disabled && vo.cap.disabled === vo.save.disabled &&
  vo.addRow.disabled === vo.save.disabled,
  { add: vo.add.disabled, save: vo.save.disabled, addRow: vo.addRow.disabled });
r.ok('...and it says WHY, like Close does, instead of hovering like a live button',
  vo.add.title.length > 0 && vo.add.title === vo.cap.title && /QC/.test(vo.add.title),
  vo.add.title);
// ⚠ AND IT NAMES THE DEPARTMENT, which is the whole reason the revoke can be diagnosed
// at all. The admin who flips the switch bypasses canEdit entirely and can never see the
// pane they changed, so if the affected person is not told in words, the ONLY symptom is a
// Save button that does nothing — no error, no dialog, which is the failure shape this
// repo keeps being bitten by. `revokedBy` comes from the server, so the note is painted
// only when the server actually said who; see the unattributed case below.
r.ok('the tooltip NAMES the department that switched it off, rather than saying "view-only"',
  /QC/.test(vo.add.title) && /QC/.test(vo.cap.title) &&
  /QC/.test(vo.addRow.title || ''), { add: vo.add.title, addRow: vo.addRow.title });
r.ok('and the same sentence is painted into the pane itself, so it is not hidden in a tooltip',
  !!vo.note && /QC/.test(vo.note.textContent), vo.note && vo.note.textContent);
// The note must never claim MORE than the server said. An attribution of [] means "nobody
// told us" — an admin, a customer, a backend older than v95 — and guessing a department
// from a map that merely lacks 'edit' would put a colleague's name on a change they did
// not make. So the note stands down entirely and the generic sentence is used instead.
const voAnon = sweepAs({ [VSEC]: 'view' }, {});
r.ok('with nobody named, the pane note is NOT painted at all — no guess is made',
  voAnon.note === null, voAnon.note);
r.ok('...and the tooltip falls back to the plain sentence, with no invented department',
  /view-only/.test(voAnon.add.title) && !/QC/.test(voAnon.add.title), voAnon.add.title);
r.ok('the disabled button is styled disabled, not merely inert',
  vo.add.style.opacity === '0.5' && vo.add.style.cursor === 'not-allowed', vo.add.style);
// Not an over-correction: commenting is NOT editing, and comment comes with view.
r.ok('the 💬 comment button stays alive for a view-only user',
  !vo.comment.disabled, vo.comment.disabled);
// Same rule for a field's history: reading what changed and who changed it is a
// VIEW act, and the feature is useless if only editors can audit an editor. It is
// safe because the button opens a read-only view — and the restore it may offer is
// rendered inside the history modal, which is mounted on document.body (outside
// every pane, so this sweep never reaches it) and checks canEditSection itself.
r.ok('the 🕓 field-history button stays alive for a view-only user',
  !vo.hist.disabled, vo.hist.disabled);
r.ok('...and it is left unstyled, not dimmed like a dead control',
  vo.hist.style.opacity === undefined, vo.hist.style);
r.ok('the ordinary field is disabled (unchanged behaviour)', vo.field.disabled === true);
r.ok('the hidden file inputs are disabled (this is what made the click a no-op)',
  vo.file.disabled === true);

const ed = sweepAs({ 'sec-c': 'view' }, { 'sec-c': ['IQC'] });
r.ok('an EDITOR gets live buttons — the sweep does not run at all',
  ed.add.disabled === false && ed.cap.disabled === false && ed.save.disabled === false,
  { add: ed.add.disabled, save: ed.save.disabled });
r.ok('...and no view-only tooltip is left on them', ed.add.title === '', ed.add.title);
r.ok('...nor a note, because this pane is not the one that was switched off',
  ed.note === null, ed.note);
// The revoke is PER SECTION, and this is the assertion that says so. The pane under test
// is `sec-b`, which is editable; `sec-c` is the one switched off. A sweep that read one
// key and applied it to the whole screen — or that took "some section is view-only" as its
// condition — would be invisible until the day two sections disagreed, because until then
// every pane answered the same way. Here they disagree on purpose.
r.ok('a DIFFERENT section being switched off does not disable this one\'s buttons',
  D.canEditSection('sec-c') === false && ed.add.disabled === false,
  { secC: D.canEditSection('sec-c'), add: ed.add.disabled });

r.head('the restore control is gated where it is RENDERED, and gated again on click');
// The history modal is created with document.createElement and appended to
// document.body, so it is outside every section pane and the sweep above never
// reaches it. A control mounted outside a pane CANNOT inherit the pane's gate —
// that is exactly how the add-row and add-evidence buttons stayed live on a
// view-only screen. So the restore must carry its own check, and it carries two:
// one where the modal decides whether to draw it, one in the click handler.
const appSrc = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const bodyOf = (name) => {
  const at = appSrc.search(new RegExp('function\\s+' + name + '\\s*\\('));
  if (at < 0) return '';
  const rest = appSrc.slice(at);
  const end = rest.indexOf('\n}');
  return end < 0 ? rest : rest.slice(0, end + 2);
};
const ohm = bodyOf('openHistoryModal');
r.ok('the modal decides `mayRestore` from canEditSection, not from a flag it was handed',
  /const mayRestore = fieldId \? canEditSection\(sectionId\) : false;/.test(ohm),
  (ohm.match(/[^\n]*mayRestore[^\n]*/) || [''])[0]);
r.ok('and with no edit right it passes NO restore context, so no button is drawn',
  /restore: mayRestore \? fieldHistView : null,/.test(ohm),
  (ohm.match(/[^\n]*restore:[^\n]*/) || [''])[0]);
r.ok('the absence is explained in words, so it is not a silent gap',
  /You have view-only access here, so you can read this but not change it\./.test(ohm));
const pfvb = bodyOf('putFieldValueBack');
r.ok('the click handler checks the same predicate before it writes anything',
  /if \(!canEditSection\(v\.sectionId\)\)/.test(pfvb),
  (pfvb.match(/[^\n]*canEditSection[^\n]*/) || [''])[0]);
r.ok('...and it fires BEFORE the confirm dialog, so no dialog is shown for a write that cannot happen',
  pfvb.indexOf('if (!canEditSection(') < pfvb.indexOf('confirm('),
  { gate: pfvb.indexOf('if (!canEditSection('), confirm: pfvb.indexOf('confirm(') });
r.ok('a view-only click says why, rather than doing nothing',
  /view-only access to this section/.test(pfvb));
r.ok('and the renderer never checks access itself — it has no access context to check',
  !/canEditSection/.test(bodyOf('renderTimelineInto')),
  (bodyOf('renderTimelineInto').match(/[^\n]*canEditSection[^\n]*/) || ['none — correct']));

r.head('an ordinary user is never an admin');
T.setUser({ email: 'plain@indrones.com', sessionToken: 't', access: { role: 'user', permissions: {}, departments: [] } });
r.ok('isAdmin() is false', T.isAdmin() === false);
r.ok('and a missing session does not make one', (() => {
  T.setUser(null);
  return T.isAdmin() === false;
})());

r.finish();
