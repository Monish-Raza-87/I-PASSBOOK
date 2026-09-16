// Smoke test for the access model: view + comment for everyone, edit from
// departments, admins bypass everything.
//
//   node tools/smoke-access.mjs
//
// The owner's rule is two levels only — "view and comment are for everyone, i.e.
// comment comes with view, and edit comes with access provided". This suite is
// the executable form of that sentence.
//
// The most valuable assertion here is the LAST one. `myAccess()` returns a
// fallback while getMyAccess is still in flight (first paint, or a transient
// backend failure). That fallback has to fail CLOSED on writes and OPEN on reads:
// a disabled Save button is recoverable, an unauthorised write is not. Getting it
// backwards is a silent, invisible, security-shaped bug — nothing about the UI
// would look wrong.

import fs from 'node:fs';
import { loadApp, makeReporter } from './harness.mjs';

const r = makeReporter();

const appJs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

const T = loadApp(`
  SECTION_IDS, ADMIN_EMAILS, isAdmin, myAccess,
  canViewSection, canCommentSection, canEditSection,
  setUser: u => { currentUser = u; },
  clearUserAccess: () => { if (currentUser) delete currentUser.access; },
`);

const SECTIONS = T.SECTION_IDS;

// A plain staff account: view everywhere, edit nowhere. This is what every
// account looks like the moment the admin creates it.
const plainUser = () => {
  const perms = {};
  SECTIONS.forEach(s => { perms[s] = 'view'; });
  return { name: 'Plain', email: 'plain@indrones.com', sessionToken: 't', access: { role: 'user', permissions: perms, departments: [] } };
};

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

// ── Everyone gets view + comment, everywhere ──────────────────────────────────
r.head('a plain account: view + comment on all nine sections');
T.setUser(plainUser());
r.ok('canView all nine', SECTIONS.every(s => T.canViewSection(s)),
  SECTIONS.filter(s => !T.canViewSection(s)));
r.ok('canComment all nine (comment comes WITH view)',
  SECTIONS.every(s => T.canCommentSection(s)),
  SECTIONS.filter(s => !T.canCommentSection(s)));
r.ok('canEdit NONE of them', !SECTIONS.some(s => T.canEditSection(s)),
  SECTIONS.filter(s => T.canEditSection(s)));

// ── Edit arrives from a department, and only on the granted section ───────────
r.head('a department grants edit on exactly its own sections');
T.setUser({
  email: 'iqc@indrones.com', sessionToken: 't',
  access: {
    role: 'user',
    permissions: Object.assign({}, plainUser().access.permissions, { 'sec-c': 'edit' }),
    departments: ['IQC'],
  },
});
r.ok('sec-c is editable', T.canEditSection('sec-c') === true);
r.ok('and NOTHING else is', !SECTIONS.filter(s => s !== 'sec-c').some(s => T.canEditSection(s)),
  SECTIONS.filter(s => s !== 'sec-c' && T.canEditSection(s)));
r.ok('view is unaffected on the other eight',
  SECTIONS.filter(s => s !== 'sec-c').every(s => T.canViewSection(s)));

// Multiple departments union rather than override — the many-to-many rule.
r.head('two departments union their grants');
T.setUser({
  email: 'multi@indrones.com', sessionToken: 't',
  access: {
    role: 'user',
    permissions: Object.assign({}, plainUser().access.permissions, { 'sec-c': 'edit', 'sec-e': 'edit' }),
    departments: ['IQC', 'Production'],
  },
});
r.ok('both granted sections are editable',
  T.canEditSection('sec-c') && T.canEditSection('sec-e'));
r.ok('the other seven are not',
  SECTIONS.filter(s => !['sec-c', 'sec-e'].includes(s)).every(s => !T.canEditSection(s)),
  SECTIONS.filter(s => !['sec-c', 'sec-e'].includes(s) && T.canEditSection(s)));
r.ok('the department list is carried for the UI',
  T.myAccess().departments.join(',') === 'IQC,Production', T.myAccess().departments);

// ── Admin bypass ──────────────────────────────────────────────────────────────
r.head('an admin bypasses every check');
// Deliberately given EMPTY permissions: the bypass must come from the role, not
// from the permission map, or an admin whose getMyAccess failed would be locked
// out of their own provisioning screen.
T.setUser({ name: 'Monish', email: 'monish.raza@indrones.com', sessionToken: 't',
            access: { role: 'admin', permissions: {}, departments: [] } });
r.ok('canView all nine', SECTIONS.every(s => T.canViewSection(s)));
r.ok('canComment all nine', SECTIONS.every(s => T.canCommentSection(s)));
r.ok('canEdit all nine', SECTIONS.every(s => T.canEditSection(s)));
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
r.ok('editing is NOT — never grant a write from a guess',
  !SECTIONS.some(s => T.canEditSection(s)), SECTIONS.filter(s => T.canEditSection(s)));

r.head('an ordinary user is never an admin');
T.setUser({ email: 'plain@indrones.com', sessionToken: 't', access: { role: 'user', permissions: {}, departments: [] } });
r.ok('isAdmin() is false', T.isAdmin() === false);
r.ok('and a missing session does not make one', (() => {
  T.setUser(null);
  return T.isAdmin() === false;
})());

r.finish();
