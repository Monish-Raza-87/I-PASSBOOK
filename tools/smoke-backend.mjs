// Smoke test for backend.gs — the parts a frontend suite cannot reach.
//
//   node tools/smoke-backend.mjs
//
// backend.gs runs inside Google Apps Script, so it cannot be executed here: it
// has SpreadsheetApp, MailApp, Utilities and PropertiesService, none of which
// exist in Node, and it is deployed by hand into a different runtime. `node
// --check` proves it parses and nothing more.
//
// So this suite asserts the things that are cheap to get wrong in a 2,900-line
// rewrite and expensive to discover in production: that the deleted actions are
// really gone from the dispatcher (or a stale cached frontend silently calls
// nothing), that the security-relevant constants are what the owner decided, and
// that the router's structure is the restructured one — with NO dispatch outside
// the try/catch, which was the specific way errors used to surface as an HTML
// page instead of JSON.
//
// WHAT IT CANNOT PROVE, and does not pretend to: it is a regex suite, so it
// asserts the code is SHAPED a certain way, never that it BEHAVES that way. Three
// real defects (an unenforced temp-password expiry on changePassword,
// resetPassword re-enabling a disabled account, and an uncapped nudge mail path)
// once passed every case here. The BEHAVIOURAL half of the backend now lives in
// tools/smoke-store.mjs, which loads this same file under a fake Drive platform
// and actually CALLS the store functions. When a change is concurrency-shaped or
// store-shaped, prove it there, not here.
//
// Since v3 the app has no spreadsheet: everything the app owns is JSON in Drive,
// so the assertions below about storage are about FILE SHAPES and KEY
// ASSIGNMENTS, not about columns and rows. There is deliberately no assertion
// anywhere below that keeps a positional column layout alive — see the "no
// positional" block, which asserts the opposite.

import fs from 'node:fs';
import { makeReporter } from './harness.mjs';

const r = makeReporter();
const src = fs.readFileSync(new URL('../backend.gs', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The body of one function, to end of line 0. The name must be followed by `(`,
// or `createUser` would also match `createUserRow` and silently return the wrong
// body — which is exactly the kind of false pass this suite exists to avoid.
function fnBody(name, text = code) {
  const at = text.search(new RegExp('function\\s+' + name + '\\s*\\('));
  if (at < 0) return '';
  const rest = text.slice(at);
  const end = rest.indexOf('\n}');
  return end < 0 ? rest : rest.slice(0, end + 2);
}

// Which function encloses a given offset — so a check can be anchored to "the
// function that actually contains this call" rather than a character window that
// silently stops matching when someone reformats the file above it.
const FN_STARTS = [...code.matchAll(/^function\s+(\w+)\s*\(/gm)].map(m => ({ name: m[1], at: m.index }));
function enclosingFn(at) {
  let best = null;
  for (const f of FN_STARTS) if (f.at < at) best = f;
  return best;
}

// ── Configuration ─────────────────────────────────────────────────────────────
r.head('the owner\'s security decisions');
r.ok('API_VERSION is 3 — the Drive-JSON store, a different deployment from v2',
  /API_VERSION:\s*3\b/.test(code), (code.match(/API_VERSION:[^\n]*/) || [''])[0]);
r.ok('the session is one working day, 8h30m', /SESSION_HOURS:\s*8\.5\b/.test(code), (code.match(/SESSION_HOURS:[^\n]*/) || [''])[0]);
r.ok('the session does NOT slide on use — an absolute expiry',
  !/SESSION_SLIDE_HOURS/.test(code) && !/lastSeenAt/.test(code));
r.ok('temporary passwords expire', /TEMP_PW_TTL_DAYS:\s*\d+/.test(code), (code.match(/TEMP_PW_TTL_DAYS:[^\n]*/) || [''])[0]);

r.head('exactly one admin');
const admins = (code.match(/ADMIN_EMAILS:\s*\[([^\]]*)\]/) || [])[1] || '';
r.ok('ADMIN_EMAILS holds exactly one address', admins.split(',').filter(s => s.trim()).length === 1, admins);
r.ok('and it is monish.raza@indrones.com', admins.includes('monish.raza@indrones.com'), admins);
r.ok('customer.relations is not in it', !admins.includes('customer.relations'), admins);

r.head('the allowlist is gone, the external exception is not');
r.ok('no ALLOWED_EMAILS array remains', !/ALLOWED_EMAILS\s*[:=]/.test(code));
r.ok('EXTERNAL_EMAILS exists and holds uavgarage',
  /EXTERNAL_EMAILS:\s*\[[^\]]*uavgarage\.com/.test(code),
  (code.match(/EXTERNAL_EMAILS:[^\n]*/) || [''])[0]);

r.head('the store is the owner\'s Drive folder, and there is no app spreadsheet');
// The whole point of the migration: the ONLY spreadsheet left is the client's Form
// Responses (an input) and the legacy workbook (a read-only archive). A surviving
// PASSBOOK_SHEET_ID would mean the store did not actually move.
r.ok('DRIVE_ROOT_FOLDER_ID is the owner\'s folder',
  /DRIVE_ROOT_FOLDER_ID:\s*'1itfTVbllh8Mi6TD6I2_OyYp_Wj4xrLIK'/.test(code),
  (code.match(/DRIVE_ROOT_FOLDER_ID:[^\n]*/) || [''])[0]);
r.ok('the store folder is named _store',
  /STORE_FOLDER_NAME:\s*'_store'/.test(code), (code.match(/STORE_FOLDER_NAME:[^\n]*/) || [''])[0]);
r.ok('PASSBOOK_SHEET_ID is gone', !/PASSBOOK_SHEET_ID/.test(code),
  (code.match(/PASSBOOK_SHEET_ID[^\n]*/) || [''])[0]);
r.ok('DATA_TAB (the APP_DATA tab) is gone', !/\bDATA_TAB\b/.test(code),
  (code.match(/[^\n]*DATA_TAB[^\n]*/) || [''])[0]);
r.ok('the two read-only INPUT sheets are still configured',
  /IR_REPO_SHEET_ID:/.test(code) && /LEGACY_SHEET_ID:/.test(code));

// ── Deleted machinery ─────────────────────────────────────────────────────────
r.head('the self-signup and request-access machinery is gone');
const deleted = [
  'isAllowedEmail', 'doRequestSignup', 'doVerifySignup', 'makeOtp',
  'getOrCreatePendingTab', 'getCaptcha', 'doCaptcha',
  'requestAccess', 'decideRequest', 'getOrCreateRequestsTab',
  'listACL', 'saveACL', 'getOrCreateAclTab',
];
deleted.forEach(name => {
  const defined = new RegExp('function\\s+' + name + '\\s*\\(').test(code);
  r.ok(name + ' is not defined', !defined);
});

r.head('and no OTP/captcha helper survived under another name');
r.ok('no PENDING_SIGNUPS tab is created', !/PENDING_SIGNUPS['"]?\s*\)?\s*\.?(insert|get|append)/.test(code));
r.ok('no captcha image is generated', !/createCaptcha|svgChallenge|captchaAnswer/i.test(code));
// The reset code is single-use, TTL'd and attempt-capped, and is never returned
// to the caller — the response is the same whether or not the account exists.
r.ok('the reset code is never returned to the client',
  !/return\s*\{[^}]*\bcode\b\s*:/.test(code), (code.match(/return \{[^}]*code\s*:[^\n]*/) || [''])[0]);

r.head('every sheet-shaped machine is gone, not adapted');
// Each of these only made sense against a spreadsheet. The dangerous outcome is
// not that one survived — it is that one survived AS AN ADAPTER, keeping the
// positional column layout alive under a new name. So this asserts absence, and
// the "no positional layout" block below asserts that nothing re-grew it.
[
  'getSs', 'ensureHeaders',
  'getOrCreateUsersTab', 'getOrCreateSessionsTab', 'getOrCreateDeptTab',
  'getOrCreateUserDeptTab', 'getOrCreateCodesTab', 'getOrCreateAttemptsTab',
  'getOrCreateDataTab', 'getOrCreateAuditTab',
  'migrateAddColumns', 'migrateAclReport', 'deptTabShapeShape', 'deptTabShapeHeader',
  'deptTabShape', 'deptTriageIndex', 'userCol', 'findUserRowIndex',
  'planSectionMerge', 'mergeTargetFor', 'fieldKeysOf', 'addDone',
  'orderDoneBySections', 'countDistinctIRs', 'describeMergePlan',
  'mergeSectionsReport', 'mergeSectionsApply', 'restoreAppDataFromBackup',
  'importSingleTab', 'importLegacyData', 'setupAuditLog', 'appendAuditEntries',
  'seedDepartmentsRebuildLegacy', 'deptTabShapeFor',
].forEach(name => {
  r.ok(name + ' is not defined', !new RegExp('function\\s+' + name + '\\s*\\(').test(code));
});
r.ok('no column-layout constant survived (they are field names now)',
  !/\b(USER_HEADS|SESSION_HEADS|DEPT_HEADS|CODE_HEADS|USERDEPT_HEADS|USER_ID_BLOCK_COLS|LEGACY_DEPT_SECTIONS|LEGACY_ACL_SECTIONS|SEC_TARGET_MAP|DONE_MAP)\b/.test(code),
  (code.match(/[^\n]*(USER_HEADS|DEPT_HEADS|SEC_TARGET_MAP|DONE_MAP|USER_ID_BLOCK_COLS)[^\n]*/g) || ['']).slice(0, 3));
r.ok('no APP_DATA_BACKUP_ / DEPARTMENTS_BACKUP_ tab logic remains',
  !/APP_DATA_BACKUP_|APP_DATA_PRE_RESTORE_|DEPARTMENTS_BACKUP_/.test(code),
  (code.match(/APP_DATA_[A-Z_]*|DEPARTMENTS_BACKUP_[^\n]*/g) || ['']).slice(0, 2));
r.ok('no getOrCreate* survives under any other name',
  !/function\s+getOrCreate(?!Section|Subfolder)\w*/.test(code),
  (code.match(/function\s+getOrCreate\w*/g) || ['']));

// ── The dispatchers ───────────────────────────────────────────────────────────
r.head('routing is the restructured form');
// The old dispatchers ran their pre-auth branch and a string of action lookups
// OUTSIDE any try/catch, so an exception escaped as an HTML error page — which
// the frontend's interceptor used to read as "your session died". The fix is
// structural: nothing dispatches outside the try.
const doPostAt = code.indexOf('function doPost');
const doGetAt  = code.indexOf('function doGet');
r.ok('doPost and doGet both exist', doPostAt > 0 && doGetAt > 0, { doPostAt, doGetAt });

[['doPost', doPostAt], ['doGet', doGetAt]].forEach(([name, at]) => {
  const body = code.slice(at, at + 2600);
  const tryAt = body.indexOf('try {');
  const buildAt = body.indexOf('buildResponse(');
  r.ok(name + ' opens a try before its first buildResponse', tryAt >= 0 && tryAt < buildAt,
    { tryAt, buildAt });
  r.ok(name + ' has both a preAuth and an authed map',
    /preAuth\s*=/.test(body) && /authed\s*=/.test(body));
  r.ok(name + ' requires auth after the preAuth map', /requireAuth\(/.test(body));
});

r.head('the new actions are dispatched');
// Scoped to the two dispatchers, so a name that merely appears elsewhere in the
// file cannot satisfy this. Keys are unquoted identifiers (`login: function…`).
const dispatchers = [code.slice(doPostAt, doPostAt + 2600), code.slice(doGetAt, doGetAt + 2600)].join('\n');
['ping', 'sessionCheck', 'login', 'logout', 'changePassword', 'forgotPassword',
 'resetPassword', 'getMyAccess', 'listUsers', 'createUser', 'bulkCreateUsers',
 'resetUserPassword', 'setUserStatus', 'saveDepartment', 'deleteDepartment',
 'setUserDepartments', 'purgeUsers', 'googleExchange']
  .forEach(a => r.ok('"' + a + '" is dispatched',
    new RegExp('\\b' + a + '\\s*:').test(dispatchers),
    (dispatchers.match(new RegExp('.{0,30}\\b' + a + '\\s*:')) || ['absent'])[0]));

// googleStart is dispatched from doGet as a BRANCH, not a map entry, and that is
// deliberate: it must return an HtmlOutput (a redirect page), so it can never go
// through buildResponse, which serialises to JSON. A map entry would have to.
const doGetBody = code.slice(doGetAt, doGetAt + 2600);
r.ok('"googleStart" is dispatched, and BEFORE the preAuth map',
  /action === 'googleStart'/.test(doGetBody) &&
  doGetBody.indexOf('googleStart') < doGetBody.indexOf('preAuth'),
  { at: doGetBody.indexOf('googleStart'), preAuth: doGetBody.indexOf('preAuth') });
r.ok('...and it returns early rather than falling through to buildResponse',
  /if \(action === 'googleStart'\) return doGoogleStart\(\);/.test(doGetBody),
  (doGetBody.match(/[^\n]*googleStart[^\n]*/) || ['absent'])[0]);

r.ok('an unknown action explains itself to a stale client',
  /backend has been upgraded|unknownAction/i.test(code),
  (code.match(/function unknownAction[\s\S]{0,300}/) || [''])[0]);

// ── The access model ──────────────────────────────────────────────────────────
r.head('getEffectiveAccess: view for everyone, edit from departments');
const gea = fnBody('getEffectiveAccess');
r.ok('the function exists', gea.length > 200, gea.length);
r.ok('it grants a view default', /'view'/.test(gea), gea.slice(0, 400));
r.ok('it layers edit on top', /edit/i.test(gea));
r.ok('it consults the department capabilities', /departmentCapabilities\(/.test(gea),
  (gea.match(/[^\n]*departmentCapabilities[^\n]*/) || [''])[0]);
r.ok("role 'none' is unreachable", !/role:\s*'none'/.test(code), (code.match(/role:\s*'none'/) || [''])[0]);

r.head('canComment follows view, and canEdit still needs edit');
const canComment = fnBody('canComment');
const canEditFn  = fnBody('canEdit');
r.ok('canComment accepts a view permission', /'view'/.test(canComment), canComment);
r.ok('canEdit requires exactly edit', /===?\s*'edit'/.test(canEditFn), canEditFn);

r.head('the edit grants live in access.json, never in a sentinel store');
// Sentinel (__-prefixed) irNumbers skip every ACL check in saveSection, so
// grants stored in one could be rewritten by any signed-in user.
const aStore = fnBody('accessStore');
r.ok('access.json is the one access store', /readJson\('access\.json'\)/.test(aStore),
  (aStore.match(/[^\n]*access\.json[^\n]*/) || [''])[0]);
r.ok('it is normalised to departments + memberships',
  /departments:\s*\{\}/.test(aStore) && /memberships:\s*\{\}/.test(aStore));
r.ok('a malformed access file THROWS rather than reading as "no grants"',
  !/catch/.test(aStore),
  (aStore.match(/[^\n]*catch[^\n]*/) || ['no catch — readJson throws through'])[0]);
r.ok('the grant reader does not touch a sentinel store',
  !/__CONFIG__[\s\S]{0,200}(edit|grant)/i.test(gea));
r.ok('department grants and memberships are separate readers',
  // departmentCapabilities replaced departmentEditGrants: ONE read of access.json
  // answering both axes (section grants AND Triage), rather than two functions
  // re-scanning the same rows.
  /function departmentCapabilities/.test(code) && /function getUserDepartments/.test(code));

r.head('a membership is a LIST PER PERSON, not a scan');
// The structural win of the move: reading one person's departments is one key
// read. The sheet version scanned the whole USER_DEPARTMENTS tab for every single
// access check, and getEffectiveAccess runs on every authenticated request.
const gud = fnBody('getUserDepartments');
r.ok('it reads one key of the memberships map',
  /accessStore\(\)\.memberships\[k\]/.test(gud), (gud.match(/[^\n]*memberships\[[^\n]*/) || [''])[0]);
r.ok('and never scans a list of edges', !/forEach[\s\S]{0,80}match\(/.test(gud) || !/edge/i.test(gud),
  (gud.match(/[^\n]*edge[^\n]*/i) || ['none'])[0]);
r.ok('it de-duplicates, so a doubled key cannot double a grant',
  /out\.indexOf\(key\) < 0/.test(gud), (gud.match(/[^\n]*indexOf\(key\)[^\n]*/) || [''])[0]);

r.head('Triage is a second axis, not a seventh grant');
// The distinction the whole design rests on: a department may triage without editing
// ANY section. CR and Management get exactly that — they own the ticket header
// (status, assignee, priority) and none of the six section forms. If Triage were
// modelled as a seventh entry in SECTION_KEYS it would also become a grantable
// section — write access to a form nobody meant to open.
const cap = fnBody('departmentCapabilities');
r.ok('the two axes are returned as one object', /\{\s*grants:\s*\{\},\s*triage:\s*false\s*\}/.test(cap),
  (cap.match(/grants:\s*\{\},\s*triage[^\n]*/) || [''])[0]);
r.ok('triage is read in the same pass, from its own field', /out\.triage\s*=\s*true/.test(cap),
  (cap.match(/[^\n]*out\.triage[^\n]*/) || [''])[0]);
r.ok('the section loop stays bounded by SECTION_KEYS, so Triage is not in it',
  /SECTION_KEYS\.forEach[\s\S]{0,80}out\.grants\[s\]/.test(cap),
  (cap.match(/[^\n]*SECTION_KEYS\.forEach[^\n]*/) || [''])[0]);
r.ok('triage is stored OUTSIDE grants, so nothing walking grants can mistake it for a section',
  !/grants\[.triage.\]/.test(cap) && /d\.triage/.test(cap),
  (cap.match(/[^\n]*triage[^\n]*/g) || []).slice(0, 3));
r.ok('a deactivated department grants neither axis',
  /toLowerCase\(\)\s*===\s*'no'\)\s*return/.test(cap), (cap.match(/[^\n]*'no'[^\n]*/) || [''])[0]);
r.ok('it short-circuits before a second read when there are no departments',
  /if \(!keys\.length\) return out/.test(cap));
r.ok('a membership naming a department that is gone is skipped, not thrown on',
  /if \(!d\) return/.test(cap), (cap.match(/[^\n]*!d[^\n]*/) || [''])[0]);
r.ok('triage is granted by role for admins, not by a department row',
  /triage:\s*true/.test(gea), (gea.match(/[^\n]*triage[^\n]*/) || []).slice(0, 3));
// Fail-closed: the department read happens AFTER the triage default is set, so a
// throw inside it still leaves a minimum-privilege profile rather than an
// undefined-that-reads-as-falsy-by-accident.
r.ok('triage is defaulted BEFORE the department read',
  gea.indexOf('triage') > -1 && gea.indexOf('triage') < gea.indexOf('departmentCapabilities'),
  { triageAt: gea.indexOf('triage'), readAt: gea.indexOf('departmentCapabilities') });
r.ok('a throw inside the department read still leaves the view-only profile',
  /catch \(e\) \{ \/\* keep view-only/.test(src),
  (src.match(/[^\n]*keep view-only[^\n]*/) || [''])[0]);
// The Overview rides the ordinary permission map so ONE canEdit() seam gates it.
r.ok('the Overview is given a permission key like any section',
  /perms\[OVERVIEW_KEY\]/.test(gea), (gea.match(/[^\n]*OVERVIEW_KEY[^\n]*/g) || []).slice(0, 3));
r.ok('and its key is raised to edit when triage is held',
  /if \(triage\) perms\[OVERVIEW_KEY\] = 'edit'/.test(gea),
  (gea.match(/[^\n]*OVERVIEW_KEY = 'edit'[^\n]*/) || [''])[0]);
r.ok('every signed-in user gets at least view on the Overview',
  /perms\[OVERVIEW_KEY\] = 'view'/.test(gea),
  (gea.match(/[^\n]*OVERVIEW_KEY = 'view'[^\n]*/) || [''])[0]);
r.ok('admin gets edit on the Overview by role, not by a department row',
  /all\[OVERVIEW_KEY\] = 'edit'/.test(gea));

r.head('sentinel stores are an allowlist, not a wildcard');
// "Skip the ACL for __-prefixed irNumbers" was written for the app's own stores,
// but it was applied to ANY __-prefixed string. One POST with irNumber
// `__NUDGES__` could therefore delete every comment on every ticket, and
// `__CONFIG__` could rewrite the shared dropdowns. The write path now checks the
// store against a fixed table AND validates the key shape.
const allow = fnBody('assertSentinelWritable');
r.ok('assertSentinelWritable exists', allow.length > 150, allow.length);
r.ok('it rejects an unknown store', /Unknown app store/.test(allow));
r.ok('it rejects an unknown key in a known store', /Unknown key for/.test(allow));
r.ok('the key allowlist is a table, not a truthiness check',
  /SENTINEL_SECTIONS\s*=\s*\{/.test(code), (code.match(/SENTINEL_SECTIONS[^\n]*/) || [''])[0]);
r.ok("a '*' store still validates the key shape (no slashes, quotes or whitespace)",
  /\^\[A-Za-z0-9_-\]\{1,40\}\$/.test(allow), (allow.match(/test\(key\)/) || [''])[0]);
const sv = fnBody('saveSection');
r.ok('saveSection calls it for sentinel writes', /assertSentinelWritable\(/.test(sv));
r.ok('and only for sentinel writes — real IRs still go through canEdit',
  /isSentinel/.test(sv) && /canEdit/.test(sv));
r.ok('a sentinel write cannot carry a file upload into Drive',
  /App stores cannot carry file uploads/.test(sv),
  (sv.match(/cannot carry[^\n]*/) || [''])[0]);
// An IR number becomes a Drive FOLDER and FILE name. Asserted after the ACL and
// before any folder or file work, so `../../etc` cannot escape its namespace.
r.ok('a real IR number is shape-checked before it reaches the filesystem',
  /assertRealIR\(irNumber\)/.test(sv) && /\^IR\\d\+\$/.test(fnBody('assertRealIR')),
  (fnBody('assertRealIR').match(/[^\n]*IR\\d[^\n]*/) || [''])[0]);

r.head('the section keys are the six the frontend uses');
const keys = (code.match(/SECTION_KEYS\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
const list = keys.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
r.ok('six section keys', list.length === 6, list);
r.ok('they are sec-b … sec-g in order',
  list.join(',') === 'sec-b,sec-c,sec-d,sec-e,sec-f,sec-g', list);
// The Overview is not a section but IS a gated record, and it keeps the historical
// id `sec-a` so its key in sections/IR409.json and its audit lines survive untouched.
r.ok('the Overview keeps the id sec-a, outside SECTION_KEYS',
  /OVERVIEW_KEY\s*=\s*'sec-a'/.test(code) && list.indexOf('sec-a') < 0);
// THE bug this block exists for. `SEC_TARGET_MAP` carried the old→new MERGE mapping
// (`sec-g: sec-f`), and RETIRED_SECTION_IDS was derived from its keys — so `sec-g`
// landed in the retired list. But `sec-g` is also the LIVE PDI Report/Dispatch
// Record section, so every Section G save was refused with "was merged into
// another section". A plain literal, with sec-g deliberately absent.
const retiredLine = (code.match(/RETIRED_SECTION_IDS\s*=[^\n]*/) || [''])[0];
r.ok('the retired ids are a literal pair, sec-h and sec-i',
  /RETIRED_SECTION_IDS\s*=\s*\['sec-h',\s*'sec-i'\]/.test(code), retiredLine);
r.ok('SEC-G IS NOT RETIRED — it is a live section the app saves to',
  !/sec-g/.test(retiredLine), retiredLine);
r.ok('the derivation that made sec-g unsavable is gone', !/SEC_TARGET_MAP/.test(code),
  (code.match(/SEC_TARGET_MAP[^\n]*/) || [''])[0]);
// ...and the warning is in a COMMENT, so this one reads the raw source. It has to
// say why, or the next tidy-up will "restore" the map and break Section G again.
r.ok('the source warns that sec-g must never be added to that list',
  /sec-g[\s\S]{0,600}never be added/i.test(src),
  (src.match(/[^\n]*never be added[^\n]*/i) || [''])[0]);

r.head('the Overview survives getPassbook for a non-admin (§2.4)');
// The single most dangerous detail in the restructure: remove sec-a from
// SECTION_KEYS and no permission map has a sec-a key, so this filter would drop the
// Overview's record for all 18 non-admin users and keep it only for the admin — who
// is the one person testing it. The fix is an explicit allowance, and this asserts it.
const gpb = fnBody('getPassbook');
r.ok('getPassbook names OVERVIEW_KEY in its record filter', /OVERVIEW_KEY/.test(gpb),
  (gpb.match(/[^\n]*canView[^\n]*/) || [''])[0]);
r.ok('the allowance is in the skip condition itself, not a comment',
  /!isSentinel\s*&&\s*secId\s*!==\s*OVERVIEW_KEY\s*&&/.test(gpb),
  (gpb.match(/if\s*\(!isSentinel[^\n]*/) || [''])[0]);
r.ok('and it is inside the per-key loop, so it applies to every record',
  /Object\.keys\(stored\)\.forEach[\s\S]{0,600}OVERVIEW_KEY/.test(gpb));

r.head('the Overview cannot be written by someone without Triage');
// There is deliberately NO OVERVIEW_KEY exemption on saveSection's ACL line: the
// Overview gets an ordinary permission key ('view' for everyone, 'edit' only for
// admins and Triage holders), so the same canEdit() seam gates it. An exemption
// here would let any signed-in user rewrite the ticket header.
r.ok('saveSection checks canEdit for it like any other record',
  /canEdit\(access\.permissions,\s*sectionId\)/.test(sv));
r.ok('saveSection has no OVERVIEW_KEY exemption on the ACL line',
  !/sectionId\s*!==\s*OVERVIEW_KEY[\s\S]{0,200}canEdit/.test(sv),
  (sv.match(/[^\n]*OVERVIEW_KEY[^\n]*/g) || []).slice(0, 3));
r.ok('a retired section id is refused with a reload instruction',
  /RETIRED_SECTION_IDS\.indexOf/.test(sv) && /Reload the app/.test(sv),
  (sv.match(/[^\n]*RETIRED_SECTION_IDS[^\n]*/) || [''])[0]);
// The locked-intake strip must still name every customer-form key, or a crafted
// Overview save could write a divergent copy of the client's own report.
r.ok('the locked intake keys are still stripped from a sec-a payload',
  /sectionId === OVERVIEW_KEY/.test(sv) && /'a_irNumber'/.test(sv) && /'a_contactEmail'/.test(sv));
r.ok('a_crmOwner and a_contactPhone are NOT stripped (CRM owns them)',
  !/'a_crmOwner'/.test(sv) && !/'a_contactPhone'/.test(sv));

// ── The forced password change ────────────────────────────────────────────────
r.head('a temporary password cannot become a session');
const dlp = fnBody('doLoginPassword');
r.ok('doLoginPassword exists', dlp.length > 200, dlp.length);
r.ok('it returns mustChangePassword', /mustChangePassword/.test(dlp));
// Delegated, not inlined: the clock lives in one helper so both doors that accept
// a temp password (login and changePassword) cannot drift apart. The helper
// itself is asserted in the block below.
r.ok('it checks the temp-password expiry via the shared helper',
  /tempPasswordExpired\(/.test(dlp) && /isTempPasswordAccount\(/.test(dlp));
r.ok('it checks the disabled status', /disabled/i.test(dlp));
// The whole security argument for the forced change: no token on that path.
// Isolate the must-change return statement and assert it carries no token.
const mcReturns = dlp.split('\n').filter(l => /mustChangePassword/.test(l) && /return/.test(l));
r.ok('a must-change return exists', mcReturns.length > 0, mcReturns);
r.ok('and it carries NO sessionToken',
  mcReturns.every(l => !/sessionToken/.test(l)), mcReturns);
// The branch must return BEFORE any mint — that ordering is the whole security
// argument. (It cannot be "no mintSession anywhere", because the normal path
// below it does mint.)
const mcAt = dlp.indexOf('mustChangePassword: true');
r.ok('the must-change branch returns before any session is minted',
  mcAt > 0 && mcAt < dlp.indexOf('mintSession'),
  { mustChangeAt: mcAt, mintAt: dlp.indexOf('mintSession') });

r.head('changePassword is as guarded as login');
const cp = fnBody('changePassword');
r.ok('it re-verifies the current password', /hashPassword/.test(cp));
r.ok('it shares the login attempt limiter', /recordFailedLogin|clearFailedLogin/.test(cp));
r.ok('it refuses a disabled account', /disabled/i.test(cp));
// The flag is cleared as one key of the account record. There is no positional
// block any more — the record IS the row, so the identity fields (createdAt,
// createdBy) are carried over by not being touched.
r.ok('it clears the flag as a key of the same account record',
  /rec\.mustChange\s*=\s*''/.test(cp), (cp.match(/[^\n]*mustChange[^\n]*/) || [''])[0]);
r.ok('and it re-reads the record INSIDE the lock, so a concurrent change cannot be clobbered',
  cp.indexOf('readJsonLocked(\'users.json\')') > -1 &&
  cp.indexOf('withRowLockOrThrow') < cp.indexOf('readJsonLocked(\'users.json\')'),
  { lock: cp.indexOf('withRowLockOrThrow'), read: cp.indexOf("readJsonLocked('users.json')") });
r.ok('it revokes before minting', cp.indexOf('revokeAllSessions') < cp.indexOf('mintSession') ||
  cp.indexOf('revokeSessionsForIn') < cp.indexOf('mintSession'),
  { revoke: Math.max(cp.indexOf('revokeAllSessions'), cp.indexOf('revokeSessionsForIn')),
    mint: cp.indexOf('mintSession') });
r.ok('the revoke and the password write share ONE lock',
  /writeJsonLocked\('users\.json'[\s\S]{0,700}revokeSessionsForIn/.test(cp),
  (cp.match(/[^\n]*revokeSessionsForIn[^\n]*/) || [''])[0]);
r.ok('it never writes a literal status, so a disabled account stays disabled',
  !/status\s*=\s*'active'/.test(cp), (cp.match(/[^\n]*status\s*=[^\n]*/) || [''])[0]);
r.ok('it tells the client the flag is cleared',
  /mustChangePassword:\s*false/.test(cp), (cp.match(/mustChangePassword:[^,]*/) || [''])[0]);

r.head('a temporary password stops working on a clock — on BOTH doors that take it');
// The TTL originally lived only in doLoginPassword. changePassword is
// unauthenticated and accepts the same credential, so an expired temp password
// could be POSTed straight to it: it verified the hash and minted a full session.
// The expiry closed the front door and left the side door open.
const ttl = fnBody('tempPasswordExpired');
r.ok('the expiry is one named helper', ttl.length > 100, ttl.length);
r.ok('it uses TEMP_PW_TTL_DAYS', /TEMP_PW_TTL_DAYS/.test(ttl),
  (ttl.match(/TEMP_PW_TTL_DAYS[^\n]*/) || [''])[0]);
r.ok('an unstamped temp password is treated as non-expiring, not as expired',
  /if \(!issued\) return null/.test(ttl), (ttl.match(/if \(!issued\)[^\n]*/) || [''])[0]);
r.ok('an unreadable stamp is treated as non-expiring too',
  /if \(!at\) return null/.test(ttl), (ttl.match(/if \(!at\)[^\n]*/) || [''])[0]);
// The epoch-milliseconds decision, asserted where it bites: a stored DISPLAY
// string would make `ageDays` NaN and never expire anything — and the same shape
// in lookupSession would accept an expired session.
r.ok('the age is computed through asDate, not by trusting the stored type',
  /asDate\(issued\)/.test(ttl), (ttl.match(/[^\n]*asDate\(issued\)[^\n]*/) || [''])[0]);
const tmpFlag = fnBody('isTempPasswordAccount');
r.ok('the must-change flag is read in one place too',
  /userField\(u, 'mustChange'\)/.test(tmpFlag), tmpFlag.slice(0, 160));
r.ok('doLoginPassword enforces it', /tempPasswordExpired\(/.test(dlp));
r.ok('changePassword enforces it', /tempPasswordExpired\(/.test(cp));
r.ok('...before it mints anything, so no session escapes the check',
  cp.indexOf('tempPasswordExpired') >= 0 && cp.indexOf('tempPasswordExpired') < cp.indexOf('mintSession'),
  { check: cp.indexOf('tempPasswordExpired'), mint: cp.indexOf('mintSession') });
r.ok('neither door tells an attacker which address exists',
  !/No account found/.test(cp), (cp.match(/No account found[^\n]*/) || [''])[0]);

// ── Mail and sessions ─────────────────────────────────────────────────────────
r.head('mail uses the already-granted scope');
r.ok('MailApp.sendEmail is used', /MailApp\.sendEmail/.test(code));
r.ok('no UrlFetchApp anywhere (it broke Google Sign-In once)',
  !/UrlFetchApp/.test(code), (code.match(/UrlFetchApp[^\n]*/) || [''])[0]);
r.ok('the recipient guard consults EXTERNAL_EMAILS',
  /isMailRecipientAllowed/.test(code));

r.head('the mail cap covers every sender, not just auth');
// The first version of this fix put the quota check inside sendAuthMail only, so
// the LOW-volume path was capped and the HIGH-volume one — the comment nudge,
// which any signed-in user can call in a loop — was wide open. Burning the day's
// MailApp quota silently takes out password recovery for the whole company, which
// is the only way back into a locked account.
//
// This block previously asserted the opposite under this exact heading ("the mail
// cap is global, not per-flow") while checking only sendAuthMail. The claim was
// false and the heading made it look verified. The assertions below check the
// property that was actually claimed: EVERY send consults the cap first.
const sam = fnBody('sendAuthMail');
r.ok('sendAuthMail enforces the daily cap', /mailQuotaOk\(\s*'auth'\s*\)/.test(sam), sam.slice(0, 160));
r.ok('sendAuthMail never throws', /catch/.test(sam));

const snd = fnBody('sendNudgeEmail');
const nudgeCheck = snd.indexOf('mailQuotaOk');
r.ok('sendNudgeEmail enforces the daily cap too', nudgeCheck >= 0, snd.slice(-260));
r.ok('...and checks BEFORE it sends, not after',
  nudgeCheck >= 0 && nudgeCheck < snd.indexOf('MailApp.sendEmail'),
  { checkAt: nudgeCheck, sendAt: snd.indexOf('MailApp.sendEmail') });
r.ok('...and tells the sender the notification did not go, instead of failing silently',
  /status:\s*'error'/.test(snd) && /Daily notification limit/.test(snd));

const mq = fnBody('mailQuotaOk');
r.ok('mailQuotaOk reads MAIL_DAILY_CAP', /MAIL_DAILY_CAP/.test(mq), mq.slice(0, 200));
r.ok('mailQuotaOk counts per day', /Utilities\.formatDate/.test(mq));
r.ok('the nudge path stops short of the ceiling, so a busy comment day cannot starve resets',
  /MAIL_AUTH_RESERVE/.test(mq), (mq.match(/var ceiling[^\n]*/) || [''])[0]);
// 'notice' joins 'nudge' on the reserved side. An admin notice is triggered by a
// user action (a restore), so it belongs in the same group as the comment nudge:
// it may neither spend the slots that are the only way back into a locked account,
// nor be starved by a busy restore day.
r.ok('the reserved group is named, and it is the two user-triggered kinds',
  /kind === 'nudge' \|\| kind === 'notice'/.test(mq),
  (mq.match(/var reserved[^\n]*/) || [''])[0]);
r.ok('an admin notice is charged against the reserved ceiling, not the full one',
  /mailQuotaOk\(\s*'notice'\s*\)/.test(fnBody('sendAdminNotice')),
  (fnBody('sendAdminNotice').match(/[^\n]*mailQuotaOk[^\n]*/) || [''])[0]);
const capN     = Number((code.match(/MAIL_DAILY_CAP\s*=\s*(\d+)/) || [])[1]);
const reserveN = Number((code.match(/MAIL_AUTH_RESERVE\s*=\s*(\d+)/) || [])[1]);
r.ok('the reserve is non-zero and strictly below the cap',
  reserveN > 0 && reserveN < capN, { cap: capN, reserve: reserveN });

// The property, stated structurally: walk to the function enclosing each literal
// send and require that it consulted the cap. A third sender added later cannot
// slip through uncapped without failing here.
//
// THREE, and the count is the point of the assertion: 1 = sendAuthMail (sign-in
// codes, resets), 2 = sendNudgeEmail (comment notifications), 3 = sendAdminNotice
// (an old value was put back). A fourth appearing without this line changing means
// a new outbound path was added and nobody looked at the daily ceiling — which is
// how a busy day silently disables password recovery for the whole company.
const sendSites = [...code.matchAll(/MailApp\.sendEmail/g)];
r.ok('there are exactly three send sites', sendSites.length === 3, sendSites.length);
sendSites.forEach((m, i) => {
  const owner = enclosingFn(m.index);
  const body  = owner ? fnBody(owner.name) : '';
  r.ok('send site ' + (i + 1) + ' (' + (owner ? owner.name : 'top level') + ') is quota-checked',
    /mailQuotaOk/.test(body),
    { site: i + 1, fn: owner && owner.name, capped: /mailQuotaOk/.test(body) });
});

r.head('the admin notice is addressed from CONFIG, and its link is built from CONFIG');
const san = fnBody('sendAdminNotice');
r.ok('the recipient set comes from CONFIG.ADMIN_EMAILS',
  /CONFIG\.ADMIN_EMAILS/.test(san), (san.match(/[^\n]*ADMIN_EMAILS[^\n]*/) || [''])[0]);
r.ok('...and every recipient passes the same guard as all outbound mail',
  /isMailRecipientAllowed\(/.test(san),
  (san.match(/[^\n]*isMailRecipientAllowed[^\n]*/) || [''])[0]);
r.ok('no recipient means no send, rather than a mail to nobody',
  /if \(!recipients\.length\) return false;/.test(san));
r.ok('it never throws — it returns true/false, because the restore already committed',
  /catch/.test(san) && /return false/.test(san) && !/throw/.test(san),
  (san.match(/[^\n]*(throw|catch)[^\n]*/g) || []));
r.ok('the reply-to is the VERIFIED caller, never a client-supplied address',
  /if \(replyTo\) options\.replyTo = replyTo;/.test(san),
  (san.match(/[^\n]*replyTo[^\n]*/) || [''])[0]);
r.ok('and it is passed the authenticated email, not a request field',
  /sendAdminNotice\([\s\S]{0,240}?,\s*by\)/.test(fnBody('restoreField')),
  (fnBody('restoreField').match(/[^\n]*sendAdminNotice\([^\n]*/) || [''])[0]);

// The deep link. A URL echoed from a request body into an email the admin trusts is
// a phishing vector — the admin sees Indrones' own app name in the From line and a
// link that goes wherever the caller chose. So the base is a CONFIG value and the
// only request-derived part is the IR number, which is validated and encoded.
const dl = fnBody('irDeepLink');
r.ok('irDeepLink builds from CONFIG.APP_URL and nothing else',
  /CONFIG\.APP_URL/.test(dl) && !/params|e\.parameter|request/i.test(dl),
  (dl.match(/[^\n]*(params|parameter|APP_URL)[^\n]*/g) || []));
r.ok('a blank APP_URL yields no link at all, so the line is left out',
  /if \(!base\) return '';/.test(dl));
r.ok('the app is hash-routed, so the link lands on the ticket',
  /'#\/tickets\/'/.test(dl), (dl.match(/[^\n]*#\/tickets[^\n]*/) || [''])[0]);
r.ok('the IR number is URL-encoded into the fragment',
  /encodeURIComponent\(String\(irNumber/.test(dl));
r.ok('the body includes the link only when there is one',
  /if \(link\) body = body\.concat/.test(fnBody('restoreField')),
  (fnBody('restoreField').match(/[^\n]*if \(link\)[^\n]*/) || [''])[0]);
r.ok('APP_URL is configured, so the notice really carries a link',
  /APP_URL:\s*'https:\/\//.test(code), (code.match(/APP_URL:[^\n]*/) || [''])[0]);
r.ok('the subject names the IR, so the inbox sorts itself',
  /'\[I-PASSBOOK\] ' \+ irNumber/.test(fnBody('restoreField')),
  (fnBody('restoreField').match(/[^\n]*\[I-PASSBOOK\][^\n]*/) || [''])[0]);

// Section and field labels live in the FRONTEND's form registry. The backend has no
// copy, so the caller sends them — and they are DISPLAY strings only, never used to
// resolve anything. Same trust level as sendNudgeEmail's `context`/`fromName`.
r.head('the labels in the notice are display strings, cleaned and capped');
const nl = fnBody('noticeLabel');
r.ok('it strips control characters and collapses whitespace',
  /replace\(/.test(nl) && /\\s\+/.test(nl), (nl.match(/[^\n]*replace[^\n]*/g) || ['']).slice(0, 2));
r.ok('it caps the length rather than trusting the caller',
  /substring\(0, 80\)/.test(nl), (nl.match(/[^\n]*80[^\n]*/) || [''])[0]);
r.ok('and falls back to the id, so a bare request still reads as something',
  /return s \|\| String\(fallback/.test(nl));
r.ok('both labels go through it on the way in',
  (fnBody('restoreField').match(/noticeLabel\(/g) || []).length === 2,
  fnBody('restoreField').match(/[^\n]*noticeLabel[^\n]*/g));
r.ok('a malformed labels blob degrades to the ids instead of failing the restore',
  /try \{ labels = JSON\.parse\(params\.labels \|\| '\{\}'\) \|\| \{\}; \} catch/.test(code),
  (code.match(/[^\n]*params\.labels[^\n]*/) || [''])[0]);

r.head('forgotPassword cannot be used to enumerate');
const fp = fnBody('forgotPassword');
r.ok('the response is generic and identical either way',
  /generic/.test(fp) && (fp.match(/generic/g) || []).length >= 2,
  (fp.match(/generic/g) || []).length);
r.ok('it delegates the throttle to the shared issuer', /issueAuthCode\(email, 'reset'/.test(fp),
  (fp.match(/[^\n]*issueAuthCode[^\n]*/) || [''])[0]);
r.ok('it never reveals a failure', /catch/.test(fp));
r.ok('it sends through sendAuthMail', /sendAuthMail/.test(fp));
r.ok('and the send is outside the lock, so mail never holds the store',
  !/withRowLockOrThrow/.test(fp));

// ── the shared emailed-code machinery ────────────────────────────────────────
// forgotPassword and the sign-in OTP were carrying two copies of the same
// throttle. These assert there is now ONE, and that it is still correct.
r.head('codes: one issuer, one redeemer, one throttle');
const iac = fnBody('issueAuthCode');
r.ok('issueAuthCode exists and is lock-protected', /withRowLockOrThrow/.test(iac));
r.ok('it is throttled per email', /CODE_MAX_PER_HOUR\b/.test(iac),
  (iac.match(/[^\n]*CODE_MAX_PER_HOUR[^\n]*/) || [''])[0]);
r.ok('the per-email budget counts ANY purpose, so a reset buys no extra sign-ins',
  /recent\+\+/.test(iac) && !/purpose === 'reset'[\s\S]{0,40}recent\+\+/.test(iac),
  (iac.match(/[^\n]*recent\+\+[^\n]*/) || [''])[0]);
r.ok('it has a GLOBAL hourly ceiling too, not only a per-email one',
  /globalCodeCap\(purpose\)/.test(iac), (iac.match(/[^\n]*globalCodeCap[^\n]*/) || [''])[0]);
r.ok('...and the ceiling is per PURPOSE, so sign-in codes cannot spend the reset budget',
  /purpose === 'login' \? CODE_MAX_PER_HOUR_GLOBAL_LOGIN : CODE_MAX_PER_HOUR_GLOBAL/.test(src),
  (src.match(/[^\n]*CODE_MAX_PER_HOUR_GLOBAL_LOGIN = [^\n]*/) || [''])[0]);
r.ok('the sign-in ceiling is looser than the reset one — a code needs a correct password first',
  /CODE_MAX_PER_HOUR_GLOBAL_LOGIN = (\d+)/.test(src) &&
  Number(src.match(/CODE_MAX_PER_HOUR_GLOBAL_LOGIN = (\d+)/)[1]) >
  Number(src.match(/CODE_MAX_PER_HOUR_GLOBAL = (\d+)/)[1]),
  src.match(/CODE_MAX_PER_HOUR_GLOBAL_LOGIN = \d+/)[0]);
r.ok('it has a resend gap', /CODE_RESEND_GAP_MS/.test(iac));
r.ok('it retires earlier live codes', /&&\s*!e\.used\)\s*e\.used = true/.test(iac),
  (iac.match(/[^\n]*e\.used[^\n]*/) || [''])[0]);
r.ok('it prunes on the way in, so the file cannot grow without bound',
  /pruneCodesIn/.test(iac));
r.ok('it returns null when throttled, rather than throwing',
  /return null/.test(iac) && !/throw/.test(iac));
// The throttle is a read-then-write JUDGEMENT: two requests arriving together must
// not both see "under the limit" and both issue. The MAIL, which is slow, stays
// outside the lock.
r.ok('the throttle decision is inside the lock', iac.indexOf('withRowLockOrThrow') < iac.indexOf('CODE_MAX_PER_HOUR'),
  { lock: iac.indexOf('withRowLockOrThrow'), throttle: iac.indexOf('CODE_MAX_PER_HOUR') });

const rci = fnBody('redeemCodeIn');
r.ok('redeemCodeIn is the ONE redeem, and is lock-FREE by design',
  rci.length > 200 && !/withRowLock/.test(rci),
  (rci.match(/[^\n]*withRowLock[^\n]*/) || [''])[0] || 'lock-free');
r.ok('...because resetPassword calls it inside a wider lock — nesting deadlocks',
  /redeemCodeIn\(entries, email, 'reset'/.test(fnBody('resetPassword')));
r.ok('it caps guessing', /CODE_MAX_ATTEMPTS/.test(rci), (rci.match(/[^\n]*CODE_MAX_ATTEMPTS[^\n]*/) || [''])[0]);
r.ok('it burns the code on the last wrong guess',
  /found\.used = true[\s\S]{0,400}Too many wrong codes/.test(rci),
  (rci.match(/[^\n]*Too many wrong codes[^\n]*/) || [''])[0]);
r.ok('it rejects an expired code', /found\.used = true[\s\S]{0,200}That code expired/.test(rci));
r.ok('it says how many attempts are left', /attempt\(s\) left/.test(rci));
// THE feature: a sign-in code survives its own use so one code covers the day.
r.ok('consume is the caller\'s choice — a sign-in code is NOT spent by signing in',
  /if \(consume\) found\.used = true/.test(rci) &&
  /verifyAuthCode\(email, 'login', code, false\)/.test(src),
  (src.match(/[^\n]*'login', code, false[^\n]*/) || [''])[0]);
r.ok('...while a RESET code IS spent by the reset it performs',
  /redeemCodeIn\(entries, email, 'reset', code, true\)/.test(fnBody('resetPassword')));

const vac = fnBody('verifyAuthCode');
r.ok('verifyAuthCode wraps it in its own lock for callers that have none',
  /withRowLockOrThrow/.test(vac) && /redeemCodeIn/.test(vac));

r.head('resetPassword');
const rp = fnBody('resetPassword');
r.ok('resetPassword exists', rp.length > 200, rp.length);
r.ok('resetPassword returns NO token', !/sessionToken/.test(rp));
r.ok('resetPassword revokes every session', /revokeSessionsForIn\(sess, email\)/.test(rp));
r.ok('it persists the consume, so the code is spent by the reset',
  /saveCodes\(\)/.test(rp), (rp.match(/[^\n]*saveCodes\(\)[^\n]*/) || [''])[0]);
r.ok('the whole redeem is ONE lock — code, password and sessions together',
  /withRowLockOrThrow\(function[\s\S]{0,200}readJsonLocked\('codes\.json'\)/.test(rp) &&
  /revokeSessionsForIn\(sess, email\)/.test(rp),
  (rp.match(/[^\n]*withRowLockOrThrow[^\n]*/) || [''])[0]);
// A reset may not change whether an account is enabled. It originally wrote the
// literal 'active' into the Status column, so resetting the password of a
// deliberately disabled account silently re-enabled it — an admin action leaking
// authority into a user-facing flow.
r.ok('resetPassword PRESERVES Status instead of forcing it active',
  /userField\(rec, 'status'\)/.test(rp) && !/status\s*=\s*'active'/.test(rp),
  (rp.match(/[^\n]*status[^\n]*/) || [''])[0] || 'literal active restored');
r.ok('and refuses a disabled account outright', /disabled/i.test(rp),
  (rp.match(/[^\n]*disabled[^\n]*/i) || [''])[0]);

r.head('sessions');
const ls = fnBody('lookupSession');
r.ok('lookupSession exists', ls.length > 200, ls.length);
// Key reads, not column indices: the token IS the key of the session store, so
// there is no row index to search for and nothing positional left to misread.
r.ok('it reads the session by TOKEN, one key of tokens',
  /tokens\[token\]/.test(ls), (ls.match(/[^\n]*tokens\[token\][^\n]*/) || [''])[0]);
r.ok('it does NOT slide the expiry on use — one working day, then out',
  !/expiresAt\s*=/.test(ls) && !/lastSeenAt/.test(ls),
  (ls.match(/[^\n]*expiresAt[^\n]*/) || [''])[0] || 'no write');
r.ok('it does not write at all — a lookup is a pure read',
  !/writeJson/.test(ls) && !/withRowLock/.test(ls));
r.ok('a store that cannot be read THROWS — it is never reported as a dead token',
  /sessionsTokens\(\)/.test(ls) && !/catch/.test(ls),
  (ls.match(/[^\n]*sessionsTokens[^\n]*/) || [''])[0]);
r.ok('it honours revocation', /s\.revokedAt/.test(ls));
r.ok('it rejects an expired session', /exp\.getTime\(\) <= Date.now\(\)/.test(ls));
r.ok('the expiry goes through asDate, so a string cannot coerce to NaN and pass',
  /asDate\(s\.expiresAt\)/.test(ls), (ls.match(/[^\n]*asDate\(s\.expiresAt\)[^\n]*/) || [''])[0]);
r.ok('it never prunes inside itself (pruneSessions is bottom-up)', !/delete /.test(ls));

r.head('a session store that cannot be read must not eject everyone');
// lookupSession now throws on an unreadable store, because null means "this token
// is not valid" and the frontend TRUSTS that answer by signing the user out. A
// bad file would eject all twenty users in the same poll window. sessionCheck
// therefore has to fail OPEN, with a message that does not start with
// `unauthorized` — that prefix is what the fetch interceptor auto-logs-out on.
const sc = fnBody('sessionCheck');
r.ok('sessionCheck catches the store failure', /catch/.test(sc));
r.ok('and answers status ok / alive true rather than throwing',
  /status:\s*'ok'/.test(sc) && /alive:\s*true/.test(sc), sc.slice(0, 400));
r.ok('the failure message names the store, so an operator can act on it',
  /unreadable|unavailable|could not be read/i.test(sc),
  (sc.match(/[^\n]*message[^\n]*/) || [''])[0]);
r.ok('AND IT NEVER STARTS WITH "unauthorized"',
  !/unauthorized/i.test(sc.replace(/unauthorizedResponse/g, '')),
  (sc.match(/[^\n]*unauthorized[^\n]*/i) || [''])[0] || 'no unauthorized literal in sessionCheck');
r.ok('requireAuth documents the throw rather than swallowing it',
  /this THROWS when the session store cannot be read/i.test(src),
  (src.match(/[^\n]*THROWS[^\n]*/) || [''])[0]);

r.head('user provisioning is admin-only');
['createUser', 'bulkCreateUsers', 'resetUserPassword', 'setUserStatus',
 'saveDepartment', 'deleteDepartment', 'setUserDepartments', 'purgeUsers', 'listUsers']
  .forEach(fn => {
    const body = fnBody(fn);
    r.ok(fn + ' calls requireAdmin', /requireAdmin\(/.test(body), body.slice(0, 120));
  });
r.ok('requireAdmin is the one gate',
  /function requireAdmin/.test(code) && /isAdminEmail/.test(fnBody('requireAdmin')),
  fnBody('requireAdmin').slice(0, 200));

r.head('the destructive reset is gated twice');
const pu = fnBody('purgeUsers');
r.ok('it demands the literal confirmation', /'PURGE'/.test(pu));
r.ok('it supports a dry run that returns a plan and deletes nothing',
  /if \(dryRun\) \{[\s\S]{0,900}?dryRun: true/.test(pu),
  (pu.match(/if \(dryRun\)/) || [''])[0]);
// The dry-run return must come BEFORE the first destructive write, or "review
// before you delete" is a promise the code does not keep.
r.ok('...and the dry-run branch precedes every write',
  pu.indexOf('if (dryRun)') < pu.indexOf('snapshotStore'),
  { dryRunAt: pu.indexOf('if (dryRun)'), firstWrite: pu.indexOf('snapshotStore') });
r.ok('the plan is SORTED, because a JSON object keeps insertion order, not alphabetical',
  /plan\.sort\(/.test(pu), (pu.match(/[^\n]*plan\.sort[^\n]*/) || [''])[0]);
r.ok('deletion is refused if the account list changed since the review',
  /params\.expect/.test(pu) && /Nothing was deleted/.test(pu),
  (pu.match(/var expect[^\n]*/) || [''])[0]);
r.ok('it leaves admins alone', /isAdminEmail/.test(pu));
// The rollback path. `restoreAppDataFromBackup` is deleted, so this snapshot is
// what replaces it — written as a NEW file, before the first destructive write.
r.ok('A BACKUP FILE IS TAKEN BEFORE THE FIRST DESTRUCTIVE WRITE',
  /snapshotStore\('purge-users'[\s\S]{0,600}delete users\[p\.email\]/.test(pu),
  (pu.match(/[^\n]*snapshotStore[^\n]*/) || [''])[0]);
r.ok('the snapshot covers every file it is about to destroy',
  /snapshotStore\('purge-users',\s*\['users\.json',\s*'access\.json',\s*'sessions\.json'\]\)/.test(pu),
  (pu.match(/[^\n]*snapshotStore\([^\n]*/) || [''])[0]);
r.ok('and the response names the backup file, not just that one exists',
  /backup: backup/.test(pu) && /Backup: ' \+ backup/.test(pu),
  (pu.match(/[^\n]*backup[^\n]*/) || [''])[0]);
// One key assignment per store, on the same locked read the plan was built from.
r.ok('it deletes the planned keys and rewrites users.json once',
  (pu.match(/delete users\[p\.email\]/g) || []).length === 1 &&
  (pu.match(/writeJsonLocked\('users\.json'/g) || []).length === 1,
  { deletes: (pu.match(/delete users\[/g) || []).length,
    writes: (pu.match(/writeJsonLocked\('users\.json'/g) || []).length });
r.ok('it removes the membership keys too',
  /delete memberships\[e\]/.test(pu) && /writeJsonLocked\('access\.json'/.test(pu),
  (pu.match(/[^\n]*memberships\[e\][^\n]*/) || [''])[0]);
// Revocation is inline (one pass over sessions.json) rather than N calls to
// revokeAllSessions — deliberate for a bulk purge, so the assertion is on the
// effect, not on the helper. It skips admins for the same reason their accounts
// are spared: revoking the admin running this would sign them out mid-purge.
r.ok('it revokes every session it can still see', /s\.revokedAt = now/.test(pu),
  (pu.match(/[^\n]*revokedAt[^\n]*/) || ['absent'])[0]);
r.ok('and skips already-revoked, blank and ADMIN tokens',
  /if \(!s \|\| s\.revokedAt\) return;/.test(pu) &&
  /if \(!usersKey\(s\.email\) \|\| isAdminEmail\(s\.email\)\) return;/.test(pu),
  (pu.match(/[^\n]*isAdminEmail\(s\.email\)[^\n]*/) || [''])[0]);
r.ok('the plan is read through the lock, so it describes the snapshot it deletes',
  pu.indexOf('withRowLock') > -1 && pu.indexOf('readJsonLocked(\'users.json\')') > pu.indexOf('withRowLock'),
  { lock: pu.indexOf('withRowLock'), read: pu.indexOf("readJsonLocked('users.json')") });

// ── The lock ──────────────────────────────────────────────────────────────────
r.head('read-merge-write is serialised, because a Drive file has no transactions');
// Drive has no atomic append and no compare-and-set: every store write is a
// whole-file replace, so two writers that each read before the other wrote lose
// one of the two changes. The sheet version did not have this problem for
// ordinary saves — two saves upserted two separate ROWS — so the lock is a
// genuine new cost of moving to files, and it is why it is not optional.
const wl = fnBody('withRowLock');
r.ok('withRowLock exists', wl.length > 200, wl.length);
r.ok('it takes a script lock', /LockService\.getScriptLock\(\)/.test(wl));
r.ok('it waits rather than racing', /waitLock\(/.test(wl), (wl.match(/waitLock\([^)]*\)/) || [''])[0]);
r.ok('it releases in a finally, so a throw cannot strand the lock',
  /finally/.test(wl) && /releaseLock\(\)/.test(wl));
r.ok('a release that itself throws cannot mask the real error',
  /try \{ lock\.releaseLock\(\); \} catch/.test(wl),
  (wl.match(/[^\n]*releaseLock[^\n]*/) || [''])[0]);
r.ok('it REFUSES rather than proceeding unprotected when the lock is unavailable',
  /status: 'error'/.test(wl) && /LOCK_BUSY_MESSAGE/.test(wl),
  (wl.match(/catch \(e\) \{[\s\S]{0,160}/) || [''])[0]);
// The wording matters: the old message blamed "another admin change", which was
// alarming and wrong for an ordinary save that happened to overlap another one.
// The frontend already keeps the user's entry as a draft and shows "⚠ Retry Save".
r.ok('the busy message says the change was NOT saved, so the draft is not thrown away',
  /was NOT saved/.test(fnBody('withRowLock')) || /was NOT saved/.test(code),
  (code.match(/var LOCK_BUSY_MESSAGE[^\n]*/) || [''])[0]);
r.ok('and it no longer blames an admin change',
  !/busy with another admin change/.test(code),
  (code.match(/[^\n]*admin change[^\n]*/) || [''])[0]);

r.head('the not-a-response-envelope paths throw instead of returning an error object');
// A session token or a count handed an error OBJECT would be read as a value —
// the caller sees a truthy token that authenticates nothing.
const wlt = fnBody('withRowLockOrThrow');
r.ok('withRowLockOrThrow exists', wlt.length > 100, wlt.length);
r.ok('it checks the envelope rather than the truthiness of the result',
  /out\.ok !== true/.test(wlt), (wlt.match(/[^\n]*ok !== true[^\n]*/) || [''])[0]);
r.ok('and throws the busy message when the lock was not taken',
  /throw new Error\(/.test(wlt) && /LOCK_BUSY_MESSAGE/.test(wlt), wlt.slice(0, 300));
r.ok('mintSession uses it, so a lock failure can never be mistaken for a token',
  /return withRowLockOrThrow\(/.test(fnBody('mintSession')));

r.head('every store mutation is inside a lock, and reads into it');
// The read snapshot must be INSIDE the lock or the lock buys nothing: a read taken
// before it would be merged over whatever landed in between.
// forgotPassword is deliberately absent: it no longer touches the store itself,
// it delegates both the throttle and the write to issueAuthCode (asserted above).
const LOCKED = ['saveSection', 'mintSession', 'doLogout', 'revokeAllSessions', 'pruneSessions',
  'recordFailedLogin', 'clearFailedLogin', 'changePassword', 'resetPassword',
  'issueAuthCode', 'verifyAuthCode',
  'createUserRow', 'resetUserPassword', 'setUserStatus',
  'saveDepartment', 'deleteDepartment', 'setUserDepartments', 'purgeUsers',
  'seedDepartments', 'seedMemberships', 'maintenancePruneAuditLog',
  'restoreField', 'appendAdminNotice'];
LOCKED.forEach(fn => {
  const body = fnBody(fn);
  r.ok(fn + ' takes the lock', /withRowLock(OrThrow)?\(/.test(body));
  // Every store READ inside it must be the locked form — readJsonLocked, never the
  // memoised readJson, which may hold a copy taken before the lock.
  const unlockReads = (body.match(/readJson\(/g) || []).length;
  r.ok(fn + ' never reads the store through the memo inside the lock',
    unlockReads === 0, (body.match(/[^\n]*readJson\([^\n]*/g) || ['none']));
  const lockAt = body.indexOf('withRowLock');
  const firstWrite = Math.min(
    ...['writeJsonLocked(', 'writeIR(', 'appendAuditLinesLocked(']
      .map(s => body.indexOf(s)).filter(i => i >= 0));
  r.ok(fn + ' writes only after the lock is taken',
    !isFinite(firstWrite) || lockAt < firstWrite,
    { lock: lockAt, firstWrite: isFinite(firstWrite) ? firstWrite : 'none' });
});
// The two bulk-provisioning actions do no store work of their own: each account is
// created through the ONE locked entry point, so a pasted list of nineteen cannot
// race a concurrent edit to a twentieth account.
r.ok('createUser creates through the locked entry point',
  /createUserRow\(/.test(fnBody('createUser')), fnBody('createUser').slice(-200));
r.ok('bulkCreateUsers creates through the same one, per address',
  /createUserRow\(/.test(fnBody('bulkCreateUsers')));
r.ok('and neither writes users.json itself',
  !/writeJson/.test(fnBody('createUser')) && !/writeJson/.test(fnBody('bulkCreateUsers')));

// seedAccounts() — the editor-run bulk onboarding. It is the one place that creates
// many accounts in a loop, so the nested-lock trap is live here: createUserRow takes
// its OWN lock, and the fake platform in smoke-store.mjs proves a second waitLock
// while one is out is REFUSED, not queued. So holding the lock around the loop would
// make the FIRST account succeed and every later one throw.
r.head('seedAccounts provisions the seeded roster through the one locked entry point');
const sa = fnBody('seedAccounts');
r.ok('every account goes through createUserRow', /createUserRow\(/.test(sa));
r.ok('and it does NOT take the lock itself — a nested lock is refused, not queued',
  !/withRowLock(OrThrow)?\(/.test(sa), (sa.match(/[^\n]*withRowLock[^\n]*/) || ['none — correct'])[0]);
r.ok('it writes users.json nowhere itself',
  !/writeJson|setContent/.test(sa), (sa.match(/[^\n]*(writeJson|setContent)[^\n]*/) || ['none — correct'])[0]);
// ADD ONLY. Rewriting an existing account is worse than doing nothing: it issues a
// fresh temp password to somebody already using theirs, and invalidates what they have.
r.ok('an existing account is SKIPPED, never rewritten — the guard comes first',
  sa.indexOf('findUser(email)') > -1 && sa.indexOf('findUser(email)') < sa.indexOf('createUserRow('),
  { guard: sa.indexOf('findUser(email)'), create: sa.indexOf('createUserRow(') });
r.ok('and an admin address is skipped, so bootstrapAdmin() stays the only creator of it',
  /isAdminEmail\(/.test(sa) && sa.indexOf('isAdminEmail(') < sa.indexOf('createUserRow('));
r.ok('a bad address is reported, not attempted',
  /validEmail\(/.test(sa) && sa.indexOf('validEmail(') < sa.indexOf('createUserRow('));
// No second roster. A duplicated list drifts the moment somebody joins; the union of
// SEED_MEMBERSHIPS is what guarantees every seeded edge has an account behind it.
r.ok('the roster is the union of SEED_MEMBERSHIPS, not a second copy of it',
  /SEED_MEMBERSHIPS\[key\]/.test(sa) && !/@indrones\.com['"]/.test(sa),
  (sa.match(/[^\n]*@indrones[^\n]*/) || ['no hardcoded address — correct'])[0]);
r.ok('and it iterates SEED_GRANTS for a deterministic order, so two runs report alike',
  /Object\.keys\(SEED_GRANTS\)/.test(sa) && /\.sort\(\)/.test(sa));
// The plaintext password must not reach the store or any file — only the log.
r.ok('the temp passwords are printed, and the report says they are shown once',
  /report\(/.test(sa) && /Shown ONCE/.test(src) && /stored nowhere/.test(src));
r.ok('and the report tells the operator to copy it to the local credentials txt',
  /local credentials txt/.test(sa));
// A derived display name must not become a guess. "ravi@"/"purchase@" have no full
// name in them, so they stay blank rather than being invented.
r.ok('displayNameFor invents nothing for an address with no dot in it',
  /indexOf\('\.'\) < 0\) return ''/.test(fnBody('displayNameFor')),
  fnBody('displayNameFor').replace(/\s+/g, ' ').slice(0, 120));
// The lock is only worth anything if the record written is the one the lock read.
// Taking a record from OUTSIDE the lock and writing it back inside undoes whatever
// landed in between — the exact lost update the plan's risk table names.
r.ok('bootstrapAdmin re-reads the admin record INSIDE the lock',
  fnBody('bootstrapAdmin').indexOf("readJsonLocked('users.json')") >
  fnBody('bootstrapAdmin').indexOf('withRowLockOrThrow'),
  (fnBody('bootstrapAdmin').match(/[^\n]*readJsonLocked[^\n]*/) || [''])[0]);
r.ok('and writes it with the locked write, not a helper that takes its own lock',
  /writeJsonLocked\('users\.json'/.test(fnBody('bootstrapAdmin')) &&
  !/saveUser\(/.test(code),
  (code.match(/[^\n]*saveUser[^\n]*/) || ['no saveUser helper — correct'])[0]);
// A write helper that takes its OWN lock is a trap: every caller of it either
// already holds the lock (nested) or holds a record read before it. Its absence is
// asserted because re-adding it would silently restore both failure modes.
r.ok('there is deliberately no saveUser helper to be called from inside a lock',
  /no `saveUser\(email, rec\)` helper any more/.test(src),
  (src.match(/[^\n]*saveUser[^\n]*/) || [''])[0]);

// The locked helpers are called only from inside a lock, by construction. Whether
// LockService is re-entrant within one execution is not documented, so the design
// avoids depending on the answer.
r.ok('the *Locked helpers document that the caller holds the lock',
  /The caller HOLDS THE LOCK/.test(src) || /assumes the lock is held/i.test(src),
  (src.match(/[^\n]*HOLDS THE LOCK[^\n]*/) || [''])[0]);
r.ok('a nested withRowLock is documented as forbidden, not tested for',
  /avoided by[\s\S]{0,20}construction/i.test(src),
  (src.match(/[^\n]*avoided by[^\n]*/) || [''])[0]);

// ── No positional layout, anywhere ────────────────────────────────────────────
r.head('the positional column layout is really gone, not adapted');
// The whole point of the move. A surviving `getRange(i + 1, 4)` — under any name,
// as any "compatibility shim" — would keep the sheet's most fragile property
// alive: a record whose fields are addressed by POSITION, so that inserting a
// field silently reinterprets every value after it. The store functions must
// address fields by NAME only.
['readJson', 'writeJson', 'saveUser', 'findUser', 'purgeUsers', 'saveSection',
 'readIR', 'writeIR', 'departmentCapabilities', 'getUserDepartments', 'accessStore',
 'changePassword', 'resetPassword', 'forgotPassword', 'mintSession', 'lookupSession',
 'seedDepartments', 'seedMemberships', 'buildAuditLines', 'getAuditLog'].forEach(fn => {
  const body = fnBody(fn);
  r.ok(fn + ' has no sheet primitive in it',
    !/getRange\(|getDataRange|setValues|deleteRow|appendRow|insertSheet/.test(body),
    (body.match(/[^\n]*(getRange|getDataRange|setValues|deleteRow|appendRow)[^\n]*/g) || ['none']));
});
// SpreadsheetApp is still needed — but ONLY for the two read-only inputs, which
// are not stores. Anything else reaching for it is the app writing to a sheet again.
const ssSites = [...code.matchAll(/SpreadsheetApp\./g)];
r.ok('SpreadsheetApp is used exactly twice', ssSites.length === 2, ssSites.length);
ssSites.forEach((m, i) => {
  const owner = enclosingFn(m.index);
  r.ok('SpreadsheetApp site ' + (i + 1) + ' is a read-only input (' + (owner ? owner.name : 'top level') + ')',
    !!owner && ['listIRs', 'listLegacyIRs', 'getAllIRStatuses'].indexOf(owner.name) > -1,
    { site: i + 1, fn: owner && owner.name });
});
r.ok('and neither of them writes: the client sheet is an INPUT, never a store',
  !/setValue|appendRow|getRange\([^)]*\)\.set/.test(fnBody('listIRs')) &&
  !/setValue|appendRow/.test(fnBody('listLegacyIRs')),
  (code.match(/[^\n]*(appendRow|\.setValue)[^\n]*/g) || ['']));

r.head('a store write replaces ONE KEY, never the file');
// The single most dangerous mis-reading of this design:
//   writeJson('config.json', fields)   destroys the team directory and dropdowns
//   writeJson('irs.json', fields)      destroys all 450 tickets' workflow state
//   writeJson('comments.json', fields) destroys every comment on every ticket
//   writeJson('users.json', rec)       destroys every other account
// All four are keyed maps, and all four resolve through ONE mapping table, so the
// assertion that matters is that the table covers every sentinel the app accepts.
const ssf = fnBody('sentinelStoreFile');
[['__IRS__', 'irs.json'], ['__CONFIG__', 'config.json'],
 ['__NUDGES__', 'comments.json'], ['__KB__', 'kb.json']].forEach(([s, f]) => {
  r.ok(s + ' resolves to ' + f + ', and only through the one table',
    new RegExp("case '" + s + "':\\s*return '" + f.replace('.', '\\.') + "'").test(ssf),
    (ssf.match(new RegExp("case '" + s + "'[^\\n]*")) || [''])[0]);
});
// A fifth subject with no case falls through to null, and saveSection throws on it
// rather than defaulting to a file — a default here would write app data into
// whatever file the default named.
r.ok('an unknown sentinel resolves to null, not to a default file',
  !/default:/.test(ssf), (ssf.match(/[^\n]*default:[^\n]*/) || ['no default — correct'])[0]);
// Every sentinel store is read AND written through that table, so a new keyed store
// cannot be added on one side only and silently miss the lock or the audit.
r.ok('getPassbook resolves its store through the same table',
  /sentinelStoreFile\(irNumber\)/.test(fnBody('getPassbook')));
r.ok('and every sentinel write does too',
  (sv.match(/sentinelStoreFile\(irNumber\)/g) || []).length === 1 &&
  /readJsonLocked\(storeFile\)/.test(sv),
  (sv.match(/[^\n]*sentinelStoreFile[^\n]*/) || [''])[0]);
r.ok('saveSection assigns store[sectionId], not the whole store',
  /store\[sectionId\] = fields;/.test(sv), (sv.match(/[^\n]*store\[sectionId\][^\n]*/) || [''])[0]);
r.ok('and it never writes the sibling keys away',
  !/writeJsonLocked\(storeFile,\s*fields\)/.test(sv),
  (sv.match(/[^\n]*writeJsonLocked\(storeFile[^\n]*/) || [''])[0]);
// irs.json is the one non-sentinel keyed store: one key per IR, never "the value".
r.ok('irs.json is read as a keyed map, never as "the value"',
  /var irs = readJson\('irs\.json'\)/.test(fnBody('getAllIRStatuses')),
  (fnBody('getAllIRStatuses').match(/[^\n]*readJson\([^\n]*/) || [''])[0]);
r.ok('and the reader indexes it by IR number, so one ticket cannot stand for all',
  /irs\[irNum\]/.test(fnBody('getAllIRStatuses')),
  (fnBody('getAllIRStatuses').match(/[^\n]*irs\[[^\n]*/) || [''])[0]);

r.head('readJson: null only for an absent file, and it throws otherwise');
// The tempting version of this helper answers {} for an unreadable file, and that
// version DESTROYS data: one corrupt users.json reads as "no accounts", and the
// very next createUser persists that emptiness plus one account.
const rj = fnBody('readJson');
r.ok('it answers null for a file that is not there', /\? parseStoreJson\(path, file\) : null/.test(rj),
  (rj.match(/[^\n]*: null[^\n]*/) || [''])[0]);
r.ok('it has NO fallback argument — the dangerous convenience is absent',
  /function readJson\(path\)/.test(code), (code.match(/function readJson\([^)]*\)/) || [''])[0]);
r.ok('an EMPTY file throws rather than reading as "no data"',
  /is empty — refusing to read it as "no data"/.test(code) ||
  /is empty/.test(fnBody('parseStoreJson')),
  (fnBody('parseStoreJson').match(/[^\n]*is empty[^\n]*/) || [''])[0]);
r.ok('a parse failure throws, with the file named',
  /is not valid JSON/.test(fnBody('parseStoreJson')) &&
  /Nothing was changed/.test(fnBody('parseStoreJson')),
  (fnBody('parseStoreJson').match(/[^\n]*not valid JSON[^\n]*/) || [''])[0]);
r.ok('it memoises per execution, like _ssMemo did',
  /hasOwnProperty\.call\(_storeMemo, path\)/.test(rj), (rj.match(/[^\n]*_storeMemo[^\n]*/) || [''])[0]);
r.ok('the locked read deliberately BYPASSES the memo',
  !/_storeMemo\[path\]\) return/.test(fnBody('readJsonLocked').split('_storeMemo[path] = val')[0]) ||
  /var file = findStoreFile\(path, false\);/.test(fnBody('readJsonLocked')),
  (fnBody('readJsonLocked').match(/[^\n]*_storeMemo[^\n]*/g) || ['']));
r.ok('and it says why: a pre-lock read would clobber what landed in between',
  /before the lock was taken/i.test(src), (src.match(/[^\n]*BEFORE the lock[^\n]*/) || [''])[0]);

r.head('the store folder is never created by a read path');
// A read path that quietly made `_store/` would turn a misconfigured deploy into
// an EMPTY store — and an empty users.json is every account missing at once.
const gsf = fnBody('getStoreFolder');
r.ok('getStoreFolder only ever looks it up',
  /getFoldersByName/.test(gsf) && !/createFolder/.test(gsf),
  (gsf.match(/[^\n]*createFolder[^\n]*/) || ['no createFolder — correct'])[0]);
r.ok('a missing store folder is an error naming the run of initializeStore()',
  /initializeStore\(\) once/.test(gsf), (gsf.match(/[^\n]*initializeStore[^\n]*/) || [''])[0]);
r.ok('a subfolder IS creatable, but only when the caller asks',
  /create \? getStoreFolder\(\)\.createFolder\(name\) : null/.test(fnBody('getStoreSubfolder')),
  (fnBody('getStoreSubfolder').match(/[^\n]*createFolder[^\n]*/) || [''])[0]);
// getFoldersByName is a Drive SEARCH, and one save asks for the same subfolder
// several times. The memo is per-execution, so it cannot serve a stale folder to a
// later request — but a MISS must NOT be memoised, or a caller with create=true
// could never create the folder the caller before it merely looked for.
const gsub = fnBody('getStoreSubfolder');
r.ok('a hit is answered from the per-execution memo, without a second search',
  /hasOwnProperty\.call\(_subfolderMemo, name\)/.test(gsub) &&
  gsub.indexOf('hasOwnProperty.call(_subfolderMemo, name)') < gsub.indexOf('getFoldersByName'),
  (gsub.match(/[^\n]*_subfolderMemo[^\n]*/) || [''])[0]);
r.ok('a MISS is deliberately not memoised, so create=true still creates',
  /if \(folder\) _subfolderMemo\[name\] = folder/.test(gsub),
  (gsub.match(/[^\n]*_subfolderMemo\[name\][^\n]*/) || [''])[0]);

r.head('initializeStore creates the store and leaves it Restricted');
const isf = fnBody('initializeStore');
r.ok('it exists and reports', isf.length > 400 && /report\(/.test(isf), isf.length);
r.ok('THE STORE IS SET PRIVATE — it holds password hashes and session tokens',
  /setSharing\(DriveApp\.Access\.PRIVATE, DriveApp\.Permission\.NONE\)/.test(isf),
  (isf.match(/[^\n]*setSharing[^\n]*/) || [''])[0]);
r.ok('it creates the three subfolders',
  /STORE_SECTIONS_DIR/.test(isf) && /STORE_AUDIT_DIR/.test(isf) && /STORE_BACKUP_DIR/.test(isf));
r.ok('it seeds users.json as an EMPTY object, which is a real state',
  /\['users\.json', \{\}\]/.test(isf), (isf.match(/[^\n]*users\.json[^\n]*/) || [''])[0]);
r.ok('and sessions.json as { tokens: {} }, the shape lookupSession reads',
  /\['sessions\.json', \{ tokens: \{\} \}\]/.test(isf));
r.ok('it seeds sections/index.json, or the first IR would fork its own file',
  /\[STORE_INDEX, \{ irs: \{\} \}\]/.test(isf), (isf.match(/[^\n]*STORE_INDEX[^\n]*/) || [''])[0]);
r.ok('it is idempotent — an existing file is left alone, never re-seeded',
  /if \(findStoreFile\(pair\[0\], false\)\) return;/.test(isf),
  (isf.match(/[^\n]*findStoreFile\(pair[^\n]*/) || [''])[0]);
r.ok('the guard comes BEFORE the write, or "idempotent" is a claim the code does not keep',
  isf.indexOf('findStoreFile(pair[0], false)') < isf.indexOf('writeJson(pair[0]'),
  { guard: isf.indexOf('findStoreFile(pair[0], false)'), write: isf.indexOf('writeJson(pair[0]') });
r.ok('it writes through writeJson, so the memo and the file agree',
  /writeJson\(pair\[0\], pair\[1\]\)/.test(isf),
  (isf.match(/[^\n]*writeJson\(pair[^\n]*/) || [''])[0]);
r.ok('nothing is written with a raw setContent, so no file is left blank or half-written',
  !/setContent/.test(isf), (isf.match(/[^\n]*setContent[^\n]*/) || ['none — correct'])[0]);
r.ok('...and the report is handed to report(), not only returned',
  isf.indexOf('report(out)') > -1 && isf.indexOf('report(out)') < isf.indexOf('return out'),
  { report: isf.indexOf('report(out)'), ret: isf.indexOf('return out') });

r.head('the index is what stops a Drive search from forking a ticket');
// getFilesByName is a Drive SEARCH and is eventually consistent: a miss right
// after a create means createFile() and a SECOND IR409.json — the ticket silently
// forks in two, and every later save lands on one half of it.
const ri = fnBody('readIR');
const wi = fnBody('writeIR');
r.ok('readIR resolves through sections/index.json first',
  /idx\.irs\[irNumber\]/.test(ri), (ri.match(/[^\n]*idx\.irs\[[^\n]*/) || [''])[0]);
r.ok('and fetches by ID, a direct read, not by name',
  /DriveApp\.getFileById\(id\)/.test(ri), (ri.match(/[^\n]*getFileById[^\n]*/) || [''])[0]);
// An indexed file that has been moved or trashed must REFUSE. Quietly starting a
// new file would take the ticket's whole history with it.
r.ok('an indexed file that is gone is an error, not a fresh start',
  /is listed in the index but is not in Drive/.test(ri) && /Nothing was changed/.test(ri),
  (ri.match(/[^\n]*not in Drive[^\n]*/) || [''])[0]);
// The write path. This is the one that actually forks the ticket, and it took a
// behavioural suite to catch: it resolved its file by NAME through writeJson, so a
// save moments after the create missed the search and created a second file.
r.ok('writeIR REFUSES to resolve its file by name',
  /refusing to write/.test(wi) && /without the file id/.test(wi),
  (wi.match(/[^\n]*refusing to write[^\n]*/) || [''])[0]);
r.ok('it writes by id', /DriveApp\.getFileById\(fileId\)/.test(wi),
  (wi.match(/[^\n]*getFileById[^\n]*/) || [''])[0]);
r.ok('it never searches and never creates',
  !/getFilesByName|createFile|findStoreFile/.test(wi),
  (wi.match(/[^\n]*(getFilesByName|createFile)[^\n]*/) || ['none — correct']));
r.ok('and it says why, in the source, so nobody "simplifies" it back',
  /a name lookup here is how a ticket gets forked/i.test(src),
  (src.match(/[^\n]*forked in two[^\n]*/) || [''])[0]);
r.ok('saveSection threads the id from readIR into writeIR',
  /readIR\(irNumber, true, true\)/.test(sv) && /writeIR\(irNumber, data, ir\.fileId\)/.test(sv),
  (sv.match(/[^\n]*writeIR\([^\n]*/) || [''])[0]);
// The fallback, for an index that has LOST an entry. A multi-match is resolved by
// newest, never arbitrarily — picking arbitrarily is how a fork becomes permanent.
r.ok('the name search survives only as a self-healing fallback',
  /findAllByName/.test(ri) && /function findAllByName/.test(code));
r.ok('a multi-match is resolved by NEWEST, never arbitrarily',
  /getLastUpdated\(\)\) > String\(pick\.getLastUpdated\(\)\)/.test(ri),
  (ri.match(/[^\n]*getLastUpdated[^\n]*/) || [''])[0]);
r.ok('and the recovered entry is written back to the index',
  /idx\.irs\[irNumber\] = pick\.getId\(\)/.test(ri) && /writeSectionsIndex\(idx\)/.test(ri),
  (ri.match(/[^\n]*writeSectionsIndex[^\n]*/) || [''])[0]);

r.head('the audit is per ticket, and it is written AFTER the data');
const bal = fnBody('buildAuditLines');
r.ok('buildAuditLines is PURE — it reads nothing and writes nothing',
  bal.length > 400 && !/writeJson|setContent|createFile|getBlob|readJson/.test(bal),
  (bal.match(/[^\n]*(writeJson|setContent|getBlob|readJson)[^\n]*/g) || ['none — correct']));
r.ok('so the caller can hold one lock across read → build → write → append',
  /the caller can hold the lock/i.test(src));
r.ok('it takes the uploads as a 6th parameter',
  /function buildAuditLines\(([^)]*)\)/.test(code) &&
  ((code.match(/function buildAuditLines\(([^)]*)\)/) || [])[1] || '').split(',').length === 6,
  (code.match(/function buildAuditLines\([^)]*\)/) || [''])[0]);
r.ok('an upload writes an "uploaded" event', /'uploaded'/.test(bal));
r.ok('the uploaded line names the SOURCE field, never the derived _links key',
  /u\.fieldId/.test(bal) && /snapValue\(u\.name/.test(bal),
  (bal.match(/[^\n]*'uploaded'[^\n]*/) || [''])[0]);
r.ok('the derived link keys are still skipped in both diff loops',
  (bal.match(/_links\$\/\.test\(k\)/g) || []).length === 2,
  (bal.match(/_links/g) || []).length);
r.ok('done is suppressed — completion is implied by the save line',
  (bal.match(/k === 'done'\) return/g) || []).length === 2,
  (bal.match(/[^\n]*'done'[^\n]*/g) || []));
r.ok('the bare "saved" marker is written only for non-sentinel writes',
  /if \(!isSentinel\) lines\.push\(line\('saved'/.test(bal),
  (bal.match(/[^\n]*'saved'[^\n]*/) || [''])[0]);
r.ok('the audit timestamp stays the DISPLAY string the timeline prints verbatim',
  /'dd-MMM-yyyy HH:mm:ss'/.test(bal), (bal.match(/[^\n]*formatDate[^\n]*/) || [''])[0]);

// The ordering fix. appendAuditEntries was called BEFORE the data write, so a save
// that then failed left an audit entry for a save that never happened.
//
// There are TWO write paths inside this one lock — the sentinel store and the real
// IR — and each has its own pair. So the assertion is that in BOTH branches the
// LAST thing done is the audit: comparing a single pair of indices across the whole
// function would be satisfied by the first branch alone.
const auditSites = [...sv.matchAll(/appendAuditLinesLocked\(/g)].map(m => m.index);
const dataWrites = ['writeJsonLocked(storeFile, store)', 'writeIR(irNumber, data, ir.fileId)']
  .map(s => sv.indexOf(s)).filter(i => i >= 0);
r.ok('both write paths audit AFTER they write their data',
  auditSites.length === 2 && dataWrites.length === 2 &&
  auditSites[0] > dataWrites[0] && auditSites[1] > dataWrites[1],
  { audits: auditSites, dataWrites });
r.ok('and no early return can skip an audit that already happened',
  // Every `return` in the function comes after that branch's audit, so a branch
  // cannot write data, return, and leave the audit behind it unwritten.
  [...sv.matchAll(/return\s/g)].map(m => m.index)
    .every(i => i > Math.min(...auditSites) || i < Math.min(...dataWrites)),
  { returns: [...sv.matchAll(/return\s/g)].map(m => m.index), audits: auditSites });
r.ok('and both audits are inside the locked block, not after it',
  Math.max(...auditSites) < sv.lastIndexOf('});'),
  { lastAudit: Math.max(...auditSites), close: sv.lastIndexOf('});') });
// __NUDGES__ is excluded at the SOURCE, so the excluded store never reaches the
// function: comments already carry their own author and createdAt, and a comment
// save fires on post, resolve, edit AND markRead.
const audCall = sv.indexOf('buildAuditLines(');
const nudgeGuard = sv.indexOf("irNumber === '__NUDGES__'");
r.ok('__NUDGES__ saves are excluded from the audit at the source',
  nudgeGuard > -1 && nudgeGuard < audCall, { guard: nudgeGuard, call: audCall });
r.ok('the guard reads as a guard, not an inverted condition',
  !/irNumber !== '__NUDGES__'[\s\S]{0,40}buildAuditLines/.test(sv));
r.ok('the uploads are collected during the upload loop, before the audit build',
  sv.indexOf('uploads.push(') < audCall, { collect: sv.indexOf('uploads.push('), call: audCall });
r.ok('and passed into the same build, so they share the save timestamp',
  /buildAuditLines\([^)]*uploads\)/.test(sv),
  (sv.match(/[^\n]*buildAuditLines\([^\n]*/) || [''])[0]);

r.head('the audit subject is the TICKET, not the store name');
// A `__IRS__` patch is ABOUT IR409, so it belongs in IR409's audit file. In the
// sheet version it was written all along, merely unreachable, because the reader
// matched rows by one column and a workflow row carried `__IRS__` in it.
const asf = fnBody('auditSubjectFor');
r.ok('a __IRS__ subject resolves to the real IR', /'__IRS__'\) return String\(sectionId\)/.test(asf),
  (asf.match(/[^\n]*__IRS__[^\n]*/) || [''])[0]);
r.ok('another sentinel goes to a file named for the store, with __ stripped',
  /replace\(\/__\/g, ''\)/.test(asf), (asf.match(/[^\n]*replace[^\n]*/) || [''])[0]);
r.ok('a real IR keeps its own number', /\n\s*return String\(irNumber\);/.test(asf));
r.ok('audit files are one per subject, .jsonl',
  /function auditFileName\(irNumber\) \{ return irNumber \+ '\.jsonl'; \}/.test(code),
  (code.match(/function auditFileName[^\n]*/) || [''])[0]);
r.ok('appendAuditLinesLocked documents that the caller holds the lock',
  /The caller HOLDS THE LOCK/.test(src),
  (src.match(/[^\n]*HOLDS THE LOCK[^\n]*/) || [''])[0]);
r.ok('it creates the audit/ subfolder only when it must write',
  /getStoreSubfolder\(STORE_AUDIT_DIR, true\)/.test(fnBody('appendAuditLinesLocked')) &&
  /getStoreSubfolder\(STORE_AUDIT_DIR, false\)/.test(fnBody('readAuditLines')),
  { write: fnBody('appendAuditLinesLocked').match(/STORE_AUDIT_DIR, \w+/),
    read: fnBody('readAuditLines').match(/STORE_AUDIT_DIR, \w+/) });
r.ok('one unreadable line is turned into a VISIBLE placeholder, never skipped silently',
  /'unreadable'/.test(fnBody('parseAuditLines')) && /line skipped/.test(fnBody('parseAuditLines')),
  (fnBody('parseAuditLines').match(/[^\n]*unreadable[^\n]*/) || [''])[0]);

r.head('getAuditLog reads one ticket, and the workflow half is reachable');
const gal = fnBody('getAuditLog');
r.ok('it reads ONE subject file, not a whole-log scan',
  /readAuditLines\(auditSubjectFor/.test(gal), (gal.match(/[^\n]*readAuditLines[^\n]*/) || [''])[0]);
r.ok('it matches the workflow lines by the real IR in `sec`',
  /sec === irNumber/.test(gal), (gal.match(/[^\n]*isWorkflowRow[^\n]*/) || [''])[0]);
r.ok('and only when `ir` is a sentinel, so a future sentinel cannot leak in',
  /ir\.indexOf\('__'\)\s*===\s*0/.test(gal),
  (gal.match(/[^\n]*isWorkflowRow[^\n]*/) || [''])[0]);

// The line → entry mapping was pulled out into ONE helper so the reader and the
// save response cannot drift apart. The four assertions below follow the mapping
// to where it now lives; they still pin exactly what they always did.
r.head('auditEntryFromLine is the ONE mapping from a stored line to a client entry');
r.ok('it exists as a helper of its own', fnBody('auditEntryFromLine').length > 200);
const aef = fnBody('auditEntryFromLine');
r.ok('it recomputes the workflow test from the same two fields',
  /sec === irNumber/.test(aef) && /ir\.indexOf\('__'\)\s*===\s*0/.test(aef),
  (aef.match(/[^\n]*isWorkflowRow[^\n]*/) || [''])[0]);
r.ok('each entry is labelled with which half it came from',
  /source:\s*isWorkflowRow\s*\?\s*'workflow'\s*:\s*'section'/.test(aef),
  (aef.match(/[^\n]*source:[^\n]*/) || [''])[0]);
r.ok('a workflow line reports no section id, so it cannot be mistaken for a save',
  /sectionId:\s*isWorkflowRow\s*\?\s*''\s*:\s*sec/.test(aef));
// An entry has to be attributable to the IR it is ABOUT. Reporting a workflow
// line's own `ir` verbatim would hand back `__IRS__` — the STORE, not the ticket —
// and quietly make any future `e.irNumber === irNumber` filter drop every status
// change. (The frontend happens not to filter on it today, which is exactly why
// this would rot.)
r.ok('a workflow line reports the real IR, not the store name in its own field',
  /irNumber:\s*isWorkflowRow\s*\?\s*sec\s*:\s*ir/.test(aef),
  (aef.match(/[^\n]*irNumber:[^\n]*/) || [''])[0]);

r.head('a line that records nothing is refused by the reader');
r.ok('an `added` line with an empty new value is not history',
  /l\.ev === 'added'\s*&&\s*String\(l\.nw\s*\|\| ''\) === ''/.test(gal),
  (gal.match(/[^\n]*'added'[^\n]*/) || [''])[0]);
r.ok('a `removed` line with an empty old value is not history',
  /l\.ev === 'removed'\s*&&\s*String\(l\.old \|\| ''\) === ''/.test(gal),
  (gal.match(/[^\n]*'removed'[^\n]*/) || [''])[0]);
// Order matters and is the whole point of the rule: the dead rows must be dropped
// BEFORE the cap, or a first save's hundreds of empty rows would push the real
// edits out of the newest 400 — and the oldest rows are what a restore reaches for.
r.ok('the dead rows are dropped BEFORE the cap, not after it',
  gal.indexOf("l.ev === 'added'") > -1 &&
  gal.indexOf("l.ev === 'added'") < gal.indexOf('entries.slice(entries.length - cap)'));
r.ok('the rule is NARROW — only those two events, so the save marker survives',
  (gal.match(/l\.ev ===/g) || []).length === 2,
  (gal.match(/l\.ev ===[^\n]*/g) || ['none']));

r.ok('line order is file order — append-only, so it is already chronological',
  !/\.sort\(/.test(gal));
r.ok('the response is capped', /AUDIT_RESPONSE_CAP/.test(gal),
  (gal.match(/var AUDIT_RESPONSE_CAP[^\n]*/) || [''])[0]);
r.ok('the cap keeps the NEWEST entries, not the oldest',
  /entries\.slice\(entries\.length\s*-\s*cap\)/.test(gal),
  (gal.match(/[^\n]*slice\([^\n]*/) || [''])[0]);
r.ok('and it says when it truncated, rather than silently dropping',
  /truncated:/.test(gal));

r.head('pruning is a manual lever, like the session prune');
// Destructive, so it locks; manual because the audit trail is evidence and must
// not shrink behind anyone's back.
const mpal = fnBody('maintenancePruneAuditLog');
r.ok('maintenancePruneAuditLog exists', mpal.length > 300, mpal.length);
r.ok('the retention window is a named constant', /AUDIT_RETENTION_DAYS\s*=\s*\d+/.test(code),
  (code.match(/var AUDIT_RETENTION_DAYS[^\n]*/) || [''])[0]);
r.ok('it says so plainly when there is nothing to do, and writes nothing',
  /return 'Nothing older than/.test(mpal), (mpal.match(/[^\n]*Nothing older[^\n]*/) || [''])[0]);
r.ok('an unparseable stamp is KEPT, never pruned by accident',
  /parseAuditTimestamp/.test(mpal) && /ms === null/.test(mpal),
  (mpal.match(/[^\n]*parseAuditTimestamp[^\n]*/) || [''])[0]);
r.ok('it walks the audit/ folder rather than one tab',
  /folder\.getFiles\(\)/.test(mpal), (mpal.match(/[^\n]*getFiles\(\)[^\n]*/) || [''])[0]);
r.ok('per-subject files mean only the affected tickets are rewritten',
  /file\.setContent\(keep\.map/.test(mpal),
  (mpal.match(/[^\n]*setContent[^\n]*/) || [''])[0]);
r.ok('and it counts the unreadable lines it deliberately kept',
  /unreadable/.test(mpal), (mpal.match(/[^\n]*unreadable[^\n]*/) || [''])[0]);
// dateParseTrap: Date.parse('21-Aug-2026 14:03:11') is NaN in V8, so a naive
// `new Date(v).getTime()` would make every row look unparseable — or worse, prune
// the wrong ones. The explicit parser exists for this and is used by both prunes.
r.ok('parseAuditTimestamp parses dd-MMM-yyyy explicitly, not via Date.parse',
  (() => {
    const p = fnBody('parseAuditTimestamp');
    return p.length > 100 && !/Date\.parse/.test(p) &&
      /match\(/.test(p) && /'jan'/.test(p);
  })(), fnBody('parseAuditTimestamp').slice(0, 400));

// ── Putting an old value back ─────────────────────────────────────────────────
r.head('restoreField writes ONE KEY, and nothing else about the IR moves');
// The tempting shortcut is to reuse saveSection: it already has the gate, the lock
// and the audit. But its write is `store[sectionId] = fields` — the WHOLE section
// key — so restoring one field through it means resending the entire section from
// the client, and a client holding a stale form silently reverts every sibling
// field in it. That is the exact accident this feature exists to repair.
const rf = fnBody('restoreField');
// The lock's closing bracket: the first `});` at or after the audit append — NOT the
// last `});` in the function, because the bell record's own `appendAdminNotice({…});`
// would otherwise be mistaken for the lock's end.
const lockClose = rf.indexOf('});', rf.indexOf('appendAuditLinesLocked('));
r.ok('restoreField exists and is shaped as its own action', rf.length > 800, rf.length);
r.ok('it takes one field and the value to put back',
  /function restoreField\(irNumber, sectionId, fieldId, value, expectCurrent, by, labels\)/.test(code),
  (code.match(/function restoreField\([^)]*\)/) || [''])[0]);
r.ok('it never calls saveSection', !/saveSection\(/.test(rf));
r.ok('it reads the section file itself, inside its own lock',
  /readIR\(/.test(rf) && /withRowLockOrThrow\(/.test(rf));
r.ok('and it uses the LOCKED read, never the memoised one',
  !/readJson\(/.test(rf), (rf.match(/[^\n]*readJson\([^\n]*/g) || ['none — correct']));
r.ok('there is exactly ONE lock, never a nested second',
  (rf.match(/withRowLock(OrThrow)?\(/g) || []).length === 1,
  (rf.match(/[^\n]*withRowLock[^\n]*/g) || []));
r.ok('the write is writeIR against the id readIR resolved',
  /writeIR\(irNumber, data, ir\.fileId\)/.test(rf),
  (rf.match(/[^\n]*writeIR\([^\n]*/) || [''])[0]);
r.ok('it copies the section key-by-key and replaces ONE field',
  /Object\.keys\(stored\)\.forEach/.test(rf) && /next\[fieldId\] = restoreVal;/.test(rf),
  (rf.match(/[^\n]*next\[fieldId\][^\n]*/) || [''])[0]);
r.ok('and it never deletes a key, so a sibling cannot disappear',
  !/delete /.test(rf), (rf.match(/[^\n]*delete [^\n]*/g) || ['none — correct']));

r.head('a value that was truncated in the audit can never be written back');
// snapValue caps an audited value at 500 characters and appends '…', silently and
// irreversibly: the full old value is kept NOWHERE else, not in the store and not in
// a backup. Putting the prefix back would corrupt the field with no error. The test
// can be exact because snapValue can only emit <=500 chars or exactly 501.
r.ok('the refusal is on the length, and it is stated in words',
  /restoreVal\.length > 500/.test(rf) && /too long to be recorded in full/.test(rf),
  (rf.match(/[^\n]*500[^\n]*/) || [''])[0]);
r.ok('it refuses BEFORE the lock, so a refused restore writes nothing at all',
  rf.indexOf('restoreVal.length > 500') < rf.indexOf('withRowLockOrThrow('),
  { refuse: rf.indexOf('restoreVal.length > 500'), lock: rf.indexOf('withRowLockOrThrow(') });
r.ok('the audit values go through snapValue, so the line has the same shape as a save',
  (rf.match(/snapValue\(/g) || []).length >= 4,
  (rf.match(/[^\n]*snapValue[^\n]*/g) || []));

r.head('a stale caller changes nothing');
// The guard that makes a restore safe to offer: the client sends the value it
// believes is current, and a mismatch refuses. Without it, a blind restore discards
// whatever landed in between with nobody knowing.
r.ok('the expectation is compared against what is STORED, inside the lock',
  /snapValue\(current\) !== expect/.test(rf),
  (rf.match(/[^\n]*expect[^\n]*/) || ['']).slice(0, 3));
r.ok('the comparison uses snapValue on both sides, so a long value still matches',
  /var expect = \(expectCurrent == null\) \? '' : String\(expectCurrent\);/.test(rf));
r.ok('the mismatch is refused in words and changes nothing',
  /changed while you were looking/.test(rf) && /nothing was changed/.test(rf));
r.ok('the compare-and-write are both inside the lock, so nothing lands between them',
  rf.indexOf('snapValue(current) !== expect') > rf.indexOf('withRowLockOrThrow(') &&
  rf.indexOf('snapValue(current) !== expect') < rf.indexOf('writeIR('),
  { compare: rf.indexOf('snapValue(current) !== expect'), write: rf.indexOf('writeIR(') });

r.head('a removed field is exactly what a restore is for');
// The owner's own words: "if someone has deleted important info ... if required I
// can restore that version". A field whose key is gone is not an error — it is the
// main case, so a missing key reads as an empty current value.
r.ok('a missing key is read as empty rather than refused',
  /hasOwnProperty\(fieldId\)/.test(rf) && /var current = hasKey \? stored\[fieldId\] : '';/.test(rf));
r.ok('and only a file that does not exist yet is refused, in words',
  /if \(!ir\.fileId\)/.test(rf) && /nothing to put back/.test(rf),
  (rf.match(/[^\n]*fileId[^\n]*/) || [''])[0]);
r.ok('that refusal comes before the section is even read, so it cannot half-run',
  rf.indexOf('if (!ir.fileId)') < rf.indexOf('var data = ir.data;'),
  { check: rf.indexOf('if (!ir.fileId)'), read: rf.indexOf('var data = ir.data;') });

r.head('restoreField is gated exactly like the save it replaces');
r.ok('a sentinel store is refused outright — it is a different action, not a smaller one',
  /String\(irNumber\)\.indexOf\('__'\) === 0/.test(rf) && /cannot be restored through this action/.test(rf));
r.ok('the IR number is validated', /assertRealIR\(irNumber\)/.test(rf));
r.ok('the gate is copied VERBATIM from saveSection, so the two cannot drift',
  /else if \(access\.role !== 'admin' && !canEdit\(access\.permissions, sectionId\)\)/.test(rf) &&
  /Forbidden: you do not have edit access to /.test(rf),
  (rf.match(/[^\n]*canEdit\(access\.permissions[^\n]*/) || [''])[0]);
r.ok('and it is the same line saveSection uses, character for character',
  (fnBody('saveSection').match(/else if \(access\.role !== 'admin' && !canEdit\(access\.permissions, sectionId\)\)/g) || []).length === 1);
r.ok('a retired section is refused, so no orphan key is written for a merged one',
  /RETIRED_SECTION_IDS\.indexOf\(String\(sectionId\)\) > -1/.test(rf) &&
  /Reload the app to get the current version/.test(rf));
r.ok('the access check is made BEFORE the lock, so a forbidden caller never blocks a writer',
  rf.indexOf('getEffectiveAccess(by)') < rf.indexOf('withRowLockOrThrow('),
  { gate: rf.indexOf('getEffectiveAccess(by)'), lock: rf.indexOf('withRowLockOrThrow(') });
r.ok('all three ids are required',
  /if \(!irNumber \|\| !sectionId \|\| !fieldId\)/.test(rf) &&
  /irNumber, sectionId and fieldId are required/.test(rf));

r.head('the restore is audited as `reverted`, never as `restored`');
r.ok('a `reverted` line is appended inside the same lock as the write',
  /appendAuditLinesLocked\(auditSubjectFor\(irNumber, sectionId\)/.test(rf) &&
  rf.indexOf('appendAuditLinesLocked(') > rf.indexOf('writeIR(') &&
  rf.indexOf('appendAuditLinesLocked(') < lockClose,
  { write: rf.indexOf('writeIR('), audit: rf.indexOf('appendAuditLinesLocked('), close: lockClose });
r.ok('the new event is `reverted`', /ev: 'reverted'/.test(rf),
  (rf.match(/[^\n]*ev: '[^\n]*/) || [''])[0]);
// `restored` already means "this ticket's folder came back out of the Drive
// archive" (archiveAuditLine). One word for two events is how a reader ends up
// unable to tell a folder move from a value being put back.
r.ok('and `restored` is not reused for it anywhere in the new code',
  !/ev: 'restored'/.test(rf) && !/ev: 'restored'/.test(fnBody('appendAdminNotice')),
  (rf.match(/[^\n]*'restored'[^\n]*/g) || ['none — correct']));
r.ok('and it is still the archive event, so nothing was renamed out from under it',
  /'restored'/.test(code) && /function archiveAuditLine\(/.test(code) &&
  /archiveAuditLine\(irNumber, 'restored'/.test(code),
  (code.match(/[^\n]*'restored'[^\n]*/g) || []).slice(0, 2));
r.ok('the line has no keys beyond the established eight',
  /\{ t: ts, ir: irNumber, sec: sectionId, by: by, ev: 'reverted',/.test(rf) &&
  /fid: fieldId, old: snapValue\(current\), nw: snapValue\(restoreVal\) \}/.test(rf),
  (rf.match(/[^\n]*fid: fieldId[^\n]*/) || [''])[0]);
r.ok('`old` is the value being REPLACED and `nw` the one put back, as on every other row',
  /old: snapValue\(current\), nw: snapValue\(restoreVal\)/.test(rf));
r.ok('the timestamp uses the same display format the timeline prints verbatim',
  /'dd-MMM-yyyy HH:mm:ss'/.test(rf));
r.ok('the subject is the TICKET, through auditSubjectFor, not the section',
  /auditSubjectFor\(irNumber, sectionId\)/.test(rf));

// The notices. The durable half of "tell the admin" is the `reverted` line, which is
// inside the lock and cannot go missing. The loud half is deliberately OUTSIDE: a
// mail or bell failure reported as a failed restore would be false, and the user's
// retry would then be refused by the expectCurrent guard — a confusing way to learn
// the write worked. Same rule as saveSection's reopenIR.
r.head('both notices are after the lock, and neither can fail the restore');
r.ok('the lock really does close after the audit append',
  lockClose > rf.indexOf('appendAuditLinesLocked('), { lockClose, audit: rf.indexOf('appendAuditLinesLocked(') });
r.ok('the in-app notice is posted outside the locked block',
  rf.indexOf('appendAdminNotice(') > lockClose,
  { notice: rf.indexOf('appendAdminNotice('), lockClose });
r.ok('and the email too', rf.indexOf('sendAdminNotice(') > lockClose,
  { mail: rf.indexOf('sendAdminNotice('), lockClose });
r.ok('a bell failure is caught and reported in words, not thrown',
  /catch \(e\) \{ notes\.push\('the in-app notice could not be posted'\); \}/.test(rf));
r.ok('a mail failure is caught and reported in words, not thrown',
  /if \(!sendAdminNotice\([\s\S]{0,120}notes\.push\('the admin email was not sent'\);/.test(rf),
  (rf.match(/[^\n]*admin email was not sent[^\n]*/) || [''])[0]);
r.ok('the restore still reports success, with what lagged named in the message',
  /result\.message \+= ' \(' \+ notes\.join\(', and '\) \+ '\.\)'/.test(rf),
  (rf.match(/[^\n]*result\.message[^\n]*/) || [''])[0]);
r.ok('the caller is told what was replaced and what is there now',
  /was: snapValue\(current\), now: snapValue\(restoreVal\)/.test(rf));
r.ok('the result names the field and the section, so the client needs no guess',
  /irNumber: irNumber, sectionId: sectionId, fieldId: fieldId/.test(rf));

r.head('the backend minted a bell record that matches the client\'s own shape');
// Everything in the bell so far has been written by the CLIENT (sendComment in
// app.js). This is the first record the server writes, so it must use the exact
// shape the renderer and isForMe already read, or it will be invisible.
const aan = fnBody('appendAdminNotice');
r.ok('it takes its OWN lock, so it is never called inside one',
  (aan.match(/withRowLock(OrThrow)?\(/g) || []).length === 1,
  (aan.match(/[^\n]*withRowLock[^\n]*/g) || []));
r.ok('and it says in words that it must not be called from inside one',
  /never be called from inside one|Nested locks are forbidden/i.test(src),
  (src.match(/[^\n]*nested lock[^\n]*/i) || [''])[0]);
r.ok('it writes comments.json through the sentinel file',
  /sentinelStoreFile\('__NUDGES__'\)/.test(aan),
  (aan.match(/[^\n]*__NUDGES__[^\n]*/) || [''])[0]);
r.ok('it uses the locked read and the locked write',
  /readJsonLocked\(file\)/.test(aan) && /writeJsonLocked\(file, store\)/.test(aan) &&
  !/readJson\(/.test(aan),
  (aan.match(/[^\n]*readJson[^\n]*/g) || []));
r.ok('it preserves whatever else the \'all\' key carries — the client owns it',
  /store\.all = keyed;/.test(aan) && /keyed\.items = items;/.test(aan),
  (aan.match(/[^\n]*(keyed|store\.all)[^\n]*/g) || []).slice(0, 3));
r.ok('an existing items array is APPENDED to, never replaced',
  /items\.push\(/.test(aan) && !/items = \[\]/.test(aan),
  (aan.match(/[^\n]*items[^\n]*/g) || []).slice(0, 4));
r.ok('the id is a UUID, not a counter a concurrent write could collide with',
  /'restore-' \+ Utilities\.getUuid\(\)/.test(aan));
r.ok('it is a FIELD-scoped nudge, so a click can open the field it is about',
  /scope: 'field'/.test(aan) && /sectionId: n\.sectionId/.test(aan) && /fieldId: n\.fieldId/.test(aan));
r.ok('ownership is decided by `to` and `mentions`, which is what isForMe reads',
  /to: recipients\.join\(','\)/.test(aan) && /mentions: recipients/.test(aan),
  (aan.match(/[^\n]*(to:|mentions:)[^\n]*/g) || []));
r.ok('the recipients are the admins, lowercased like every other address',
  /CONFIG\.ADMIN_EMAILS[\s\S]{0,140}toLowerCase\(\)/.test(aan),
  (aan.match(/[^\n]*ADMIN_EMAILS[^\n]*/) || [''])[0]);
r.ok('`from` is the verified caller, and fromName too — the backend has no display names',
  /from: n\.by/.test(aan) && /fromName: n\.by/.test(aan));
r.ok('it arrives open and unread',
  /status: 'open'/.test(aan) && /readBy: \[\]/.test(aan) &&
  /resolvedAt: null/.test(aan) && /resolvedBy: null/.test(aan),
  (aan.match(/[^\n]*(status:|readBy:|resolvedAt:)[^\n]*/g) || []));
r.ok('a client timestamp, like every other record in that list',
  /createdAt: Date\.now\(\)/.test(aan));
r.ok('the message names both values, so the bell needs no second lookup',
  /replacing "/.test(aan) && /now "/.test(aan),
  (aan.match(/[^\n]*message:[^\n]*/) || [''])[0]);
r.ok('an unconfigured admin list posts nothing rather than an unowned record',
  /if \(!recipients\.length\) return null;/.test(aan));

// ── The retention rule ────────────────────────────────────────────────────────
r.head('the prune leaves a LIVE ticket\'s history alone');
// The owner's rule: "Till that IR is completely closed and archived ... Till IR
// records are being kept in drive, so the history." The age rule is per SUBJECT, so
// without this an entry could go while its ticket was still wide open.
r.ok('liveness is decided from the IR store AND the sections index',
  /readJsonLocked\(sentinelStoreFile\('__IRS__'\)\)/.test(mpal) &&
  /var idx = readSectionsIndex\(true\);/.test(mpal) && /idx\.irs/.test(mpal),
  (mpal.match(/[^\n]*(__IRS__|readSectionsIndex)[^\n]*/g) || []));
r.ok('a per-ticket subject whose IR still exists is SKIPPED, not pruned',
  /if \(\/\^IR\\d\+\$\/\.test\(subject\) && live\[subject\]\) \{/.test(mpal),
  (mpal.match(/[^\n]*skippedLive[^\n]*/g) || ['']).slice(0, 2));
r.ok('the test is on the subject NAME, so a sentinel file is unaffected',
  /\^IR\\d\+\$/.test(mpal), (mpal.match(/[^\n]*IR\\d[^\n]*/) || [''])[0]);
r.ok('the skip happens before the file is read, not line by line',
  mpal.indexOf('continue;') < mpal.indexOf('parseAuditLines('),
  { skip: mpal.indexOf('continue;'), read: mpal.indexOf('parseAuditLines(') });
r.ok('both reads happen under the one lock',
  mpal.indexOf("sentinelStoreFile('__IRS__')") > mpal.indexOf('withRowLock') &&
  mpal.indexOf('readSectionsIndex(true)') > mpal.indexOf('withRowLock'),
  { lock: mpal.indexOf('withRowLock'), irs: mpal.indexOf("sentinelStoreFile('__IRS__')"),
    index: mpal.indexOf('readSectionsIndex(true)') });
r.ok('the message says how many were skipped and why, rather than quietly pruning fewer',
  /skippedLive\+\+/.test(mpal) && /LIVE IR/.test(mpal),
  (mpal.match(/[^\n]*LIVE IR[^\n]*/) || [''])[0]);
r.ok('the note is appended to BOTH exits, so a no-op run explains itself too',
  // Declared once, then appended to the "nothing to prune" return AND the
  // "pruned N" return — a run that prunes fewer lines than expected must say why.
  (mpal.match(/skipNote/g) || []).length === 3 &&
  /days\. Audit unchanged\.' \+ skipNote;/.test(mpal),
  (mpal.match(/[^\n]*skipNote[^\n]*/g) || []).slice(0, 4));
r.ok('erring toward keeping: only a file with prunable lines is ever rewritten',
  /if \(!gone\) \{ keptLines \+= lines\.length; continue; \}/.test(mpal),
  (mpal.match(/[^\n]*gone[^\n]*/) || [''])[0]);
r.ok('an unreadable line is KEPT, never pruned by accident',
  /ms === null/.test(mpal) && /unreadable\+\+/.test(mpal));
r.ok('it stays manual — no trigger is wired to the audit prune',
  !/newTrigger\([^)]*maintenancePruneAuditLog/.test(code) &&
  !/maintenancePruneAuditLog[\s\S]{0,80}create\(\)/.test(code),
  (code.match(/[^\n]*newTrigger[^\n]*/g) || ['none — correct']));

r.head('nothing in the backend erases anything');
// The pinned global assertion, restated here because the restore path is a new
// place where "just clear it" would be a tempting implementation.
r.ok('no setTrashed / removeFile / deleteFile anywhere',
  !/setTrashed|removeFile\(|deleteFile\(/.test(code),
  (code.match(/[^\n]*(setTrashed|removeFile|deleteFile)[^\n]*/g) || ['none — correct']));
r.ok('and the audit is append-only — the new path only appends lines',
  /appendAuditLinesLocked/.test(rf) && !/setContent/.test(rf),
  (rf.match(/[^\n]*setContent[^\n]*/g) || ['none — correct']));

r.head('every stored date goes through asDate');
// A stored date that round-trips as a STRING makes `exp < now` compare string to
// Date, coerce to NaN, and accept an expired session. Internal dates are epoch
// milliseconds; only the audit timestamp stays a display string.
const ad = fnBody('asDate');
r.ok('asDate is the one place a stored value becomes a Date',
  /instanceof Date/.test(ad) && /new Date\(n\)/.test(ad), ad.slice(0, 300));
r.ok('and an unreadable value answers null rather than an Invalid Date',
  /isNaN\(d\.getTime\(\)\) \? null : d/.test(ad), (ad.match(/[^\n]*isNaN[^\n]*/) || [''])[0]);
r.ok('session expiry is stored as epoch ms at mint',
  /expiresAt:\s*now \+ CONFIG\.SESSION_HOURS \* 60 \* 60 \* 1000/.test(fnBody('mintSession')),
  (fnBody('mintSession').match(/[^\n]*expiresAt[^\n]*/) || [''])[0]);
r.ok('and read back through asDate, never compared as a string',
  /asDate\(s\.expiresAt\)/.test(ls) && /asDate\(found\.expiresAt\)/.test(src) &&
  /asDate\(e\.createdAt\)/.test(fnBody('issueAuthCode')),
  (fnBody('redeemCodeIn').match(/[^\n]*asDate\(found\.expiresAt\)[^\n]*/) || [''])[0] || 'asDate');

// ── Seeding the owner's mapping ───────────────────────────────────────────────
r.head('seedDepartments upserts ONE KEY per department and names what it drops');
// `have[key]` used to mean merely "present", so a half-granted row was never
// corrected. And the one thing a rewrite can silently lose is an existing grant
// the new mapping does not reproduce — so it is printed, loudly. This is the
// direct application of "a response is not a backup".
const sd = fnBody('seedDepartments');
r.ok('it compares the desired grants against the existing ones',
  /deltas/.test(sd), (sd.match(/[^\n]*deltas[^\n]*/) || []).slice(0, 2));
r.ok('it reports created / updated / unchanged', /created/.test(sd) && /updated/.test(sd) && /unchanged/.test(sd));
r.ok('it prints a DROPPED GRANTS section', /DROPPED GRANTS/.test(sd),
  (sd.match(/[^\n]*DROPPED GRANTS[^\n]*/) || [''])[0]);
r.ok('and it lists what was dropped, not merely that something was',
  /dropped\.push\(/.test(sd) && /dropped\.join/.test(sd));
r.ok('it writes ONE key per department, as one file',
  /store\.departments\[key\] = /.test(sd) && /writeJsonLocked\('access\.json', store\)/.test(sd),
  (sd.match(/[^\n]*store\.departments\[key\][^\n]*/) || [''])[0]);
r.ok('a department the seed does not name is left UNTOUCHED, not deleted',
  !/delete store\.departments/.test(sd),
  (sd.match(/[^\n]*delete store\.departments[^\n]*/) || ['none — correct']));
r.ok('it takes the lock, so a concurrent admin edit cannot be clobbered',
  /withRowLockOrThrow/.test(sd));
const sg = (code.match(/SEED_GRANTS\s*=\s*\{[\s\S]*?\n\};/) || [''])[0];
r.ok('the mapping itself is a module-level literal recording whose call it was',
  /SEED_GRANTS\s*=\s*\{/.test(code) && /TRIAGE_DEPARTMENTS/.test(code),
  (code.match(/var SEED_GRANTS[^\n]*/) || [''])[0]);
// The owner gave ONE list for Purchase AND Inventory. Guessing which person belongs
// to which is exactly the "a wrong guess grants write access silently" failure the
// codebase's own comment forbids — and the two departments do NOT have equal grants
// (B/D/G vs D), so they cannot be merged either.
r.ok('Purchase and Inventory are not merged into one department',
  /'purchase'/.test(sg) && /'inventory'/.test(sg), sg.slice(0, 400));
r.ok('Triage is granted to CR and Management alone',
  /TRIAGE_DEPARTMENTS\s*=\s*\['cr',\s*'management'\]/.test(code),
  (code.match(/var TRIAGE_DEPARTMENTS[^\n]*/) || [''])[0]);

r.head('seedMemberships only ever ADDS');
// setUserDepartments REPLACES one person's whole list — correct for an admin
// editing that person, wrong for a seed that must not disturb edges added later.
const sm = fnBody('seedMemberships');
r.ok('it does not delete anything', !/delete |clear\(/.test(sm),
  (sm.match(/[^\n]*(delete |clear\()/) || ['none'])[0]);
r.ok('it skips what is already present', /if \(list\.indexOf\(key\) > -1\)/.test(sm),
  (sm.match(/[^\n]*indexOf\(key\)[^\n]*/) || [''])[0]);
r.ok('it appends to the person\'s own list, one key assignment',
  /store\.memberships\[email\] = list/.test(sm),
  (sm.match(/[^\n]*store\.memberships\[email\][^\n]*/) || [''])[0]);
r.ok('and it says "nothing removed" in its report',
  /Nothing removed/.test(sm), (sm.match(/[^\n]*Nothing removed[^\n]*/) || [''])[0]);
r.ok('it names the people added who cannot sign in yet',
  /NOT YET SIGN-IN-ABLE/.test(sm), (sm.match(/[^\n]*SIGN-IN-ABLE[^\n]*/) || [''])[0]);
r.ok('it says the IQC/Compliance omission is intentional',
  /IQC and Compliance have no members/.test(sm));
r.ok('it names the Purchase/Inventory doubling as intentional too',
  /Purchase AND Inventory each list all three/.test(sm));
r.ok('it takes the lock', /withRowLockOrThrow/.test(sm));

r.head('deleting a department takes its memberships with it');
// Otherwise a dangling membership resurrects the grants the moment the key is
// recreated — silently, and with the same name.
const dd = fnBody('deleteDepartment');
r.ok('it removes the department key', /delete store\.departments\[key\]/.test(dd));
r.ok('and filters the key out of every membership list',
  /list\.filter\(function \(k\) \{ return String\(k\)\.trim\(\) !== key; \}\)/.test(dd),
  (dd.match(/[^\n]*filter\([^\n]*/) || [''])[0]);
r.ok('a list emptied by that is removed entirely, not left as []',
  /delete store\.memberships\[email\]/.test(dd),
  (dd.match(/[^\n]*delete store\.memberships[^\n]*/) || [''])[0]);
r.ok('it writes once, inside the lock',
  /withRowLockOrThrow/.test(dd) && (dd.match(/writeJsonLocked\('access\.json'/g) || []).length === 1);

r.head('setUserDepartments replaces ONE person, and only that person');
const sud = fnBody('setUserDepartments');
r.ok('it assigns the person\'s own key', /store\.memberships\[email\] = keys/.test(sud));
r.ok('an emptied list is DELETED rather than stored as []',
  /else delete store\.memberships\[email\]/.test(sud),
  (sud.match(/[^\n]*delete store\.memberships[^\n]*/) || [''])[0]);
r.ok('it never touches another person\'s memberships',
  !/Object\.keys\(store\.memberships\)/.test(sud),
  (sud.match(/[^\n]*Object\.keys[^\n]*/) || ['none — correct']));
r.ok('it takes the lock', /withRowLockOrThrow/.test(sud));

// ── The run order ─────────────────────────────────────────────────────────────
r.head('the setup run order is stated, and there is no cutover window left');
// The old order existed because (a) widening a DEPARTMENTS tab would be read
// positionally by the still-live old backend and misgrant every section, and (b)
// the APP_DATA merge rewrote rows the live app was reading. Neither exists now:
// there are no columns and no rows, `_store/` is a folder the old backend never
// looks at, and the store starts empty.
//
// The banner is asserted in TWO places on purpose, because it is stated twice and
// an editor only reads one of them: the run-order comment block above the setup
// functions, and the `Next:` line initializeStore() prints into the execution log.
const bannerAt = src.lastIndexOf('ONE-TIME SETUP');
const banner = bannerAt < 0 ? '' : src.slice(bannerAt, bannerAt + 1800);
r.ok('the banner exists', banner.length > 400, banner.length);
r.ok('the order is initializeStore → seedDepartments → seedMemberships → bootstrapAdmin',
  /initializeStore\(\)[\s\S]{0,400}seedDepartments\(\)[\s\S]{0,400}seedMemberships\(\)[\s\S]{0,400}bootstrapAdmin\(\)/.test(banner),
  (banner.match(/[^\n]*initializeStore[^\n]*/) || [''])[0]);
r.ok('AND THE SAME ORDER IS PRINTED where the editor will actually see it',
  /Next: seedDepartments\(\) → seedMemberships\(\) → bootstrapAdmin\(\) → seedAccounts\(\)/.test(fnBody('initializeStore')),
  (fnBody('initializeStore').match(/[^\n]*Next:[^\n]*/) || [''])[0]);
r.ok('the banner says the cutover ordering problem is GONE, not just that it changed',
  /no cutover ordering problem any more/i.test(banner),
  (banner.match(/[^\n]*cutover[^\n]*/i) || [''])[0]);
r.ok('and it says WHY, so nobody re-invents the split',
  /no columns and no rows/i.test(banner),
  (banner.match(/[^\n]*no columns[^\n]*/) || [''])[0]);
r.ok('the prunes are listed as post-go-live, not pre-flight',
  /Anytime after go-live[\s\S]{0,200}maintenancePruneSessions\(\)/.test(banner),
  (banner.match(/[^\n]*go-live[^\n]*/) || [''])[0]);
r.ok('the old pre-flight functions are named nowhere', !/migrateAddColumns/.test(code));

r.head('the field-id wart is documented where it bites');
// Field ids are never renamed: they are also the anchors inside every __NUDGES__
// item and the Field ID of every historical audit line, and there is no migration
// that could rewrite them. Renaming g_missionReport → f_missionReport would orphan
// every comment on it and split its audit history. The one place that could break
// this in a single line is the intake strip in saveSection, so what is asserted is
// that the ONLY mutation it makes to a payload is a DELETE — never a copy under a
// new key, which is what a "rename for consistency" would look like.
const fieldMutations = (sv.match(/fields\[[^\]]*\]\s*=\s*fields\[/g) || []);
r.ok('saveSection never renames a field key — no key is ever assigned from another',
  fieldMutations.length === 0 && /delete fields\[k\];/.test(sv),
  fieldMutations.length ? fieldMutations : 'delete only — correct');
r.ok('and the ONLY key it adds is the derived upload-links key',
  (sv.match(/fields\[[^\]]*\]\s*=/g) || []).length === 1 &&
  /fields\[fid \+ '_links'\]/.test(sv),
  (sv.match(/fields\[[^\]]*\] =[^\n]*/g) || ['']));
r.ok('no other function rewrites a field key either',
  !/fields\[[^\]]*\]\s*=\s*fields\[/.test(code),
  (code.match(/fields\[[^\]]*\] = fields\[[^\n]*/g) || ['none — correct']));

// ── Editor-facing reports ─────────────────────────────────────────────────────
r.head('every editor-facing report is LOGGED, not merely returned');
// The Apps Script editor's execution log shows only what the code logs — a returned
// value is never displayed. So a function that only returns its report is, to the
// human running it from the function dropdown, indistinguishable from one that did
// nothing: "Execution completed" and no `dropped` grant list, no one-time admin
// password, no store folder name. Every one of those must be READ to run setup safely.
//
// This is the same failure mode as the `→ 15 cols` strings that rotted: a report
// nobody can read is worse than no report, and nothing asserted it.
r.ok('report() exists and both logs and returns',
  /function report\(msg\)\s*\{[\s\S]{0,200}console\.log\(msg\)[\s\S]{0,100}return msg;/.test(code),
  (code.match(/[^\n]*function report\(msg\)[^\n]*/) || [''])[0]);

// Every editor-facing function that produces a report must route every one of its
// report returns through report(). Checked per-function on the real source, so a
// new early-return cannot slip in unlogged.
const REPORTING_FNS = ['initializeStore', 'seedDepartments', 'seedMemberships',
  'bootstrapAdmin', 'maintenancePruneSessions', 'maintenancePruneAuditLog'];
const unlogged = REPORTING_FNS.filter(fn => {
  const body = fnBody(fn);
  if (!body || !/report\(/.test(body)) return true;
  if (!/return\s+(['"])/.test(body)) return false;   // no bare report return at all
  // A LOCKED function's inner early-returns are values handed up to the single
  // outer `return report(withRowLockOrThrow(fn))`, so a bare return inside one IS
  // logged. Outside that shape, a bare `return '…'` never reaches the log.
  return !/return report\(withRowLockOrThrow\(function/.test(body);
});
r.ok('no editor-facing function returns a report string unlogged',
  unlogged.length === 0, unlogged);

r.ok('the locked setup functions wrap the WHOLE call, not each inner return',
  ['seedDepartments', 'seedMemberships', 'maintenancePruneAuditLog']
    .every(fn => /^function \w+\(\) \{\r?\n  return report\(withRowLockOrThrow\(function/.test(
      (code.slice(code.indexOf('function ' + fn + '()'))))),
  // Wrapping the outer call is what makes every early refusal inside the lock
  // visible too — wrapping the inner returns instead would leave them silent.
  'the refusals inside the lock are the messages that matter most');

r.ok('report() is called for the refusal paths too, not just the happy path',
  /if \(!email\) return report\(/.test(fnBody('bootstrapAdmin')) &&
  /No audit\/ folder — nothing to prune/.test(fnBody('maintenancePruneAuditLog')),
  'a swallowed "no admin email configured" is the message that matters most');

r.head('the admin bootstrap does not silently reuse an unknown password');
// If the record is missing it CREATES one and prints a one-time temporary password
// — the only place that password exists, so the log line is the delivery mechanism.
const ba = fnBody('bootstrapAdmin');
r.ok('it prints the temporary password to the log',
  /TEMPORARY PASSWORD:/.test(ba), (ba.match(/[^\n]*TEMPORARY PASSWORD[^\n]*/) || [''])[0]);
r.ok('and says to delete that log line afterwards',
  /delete this log line/.test(ba), (ba.match(/[^\n]*log line[^\n]*/) || [''])[0]);
r.ok('an existing admin keeps its password — only the flags are normalised',
  /existing password untouched/.test(ba) && /rec\.mustChange\s*=\s*''/.test(ba),
  (ba.match(/[^\n]*untouched[^\n]*/) || [''])[0]);
r.ok('the normalising write is inside the lock',
  /withRowLockOrThrow/.test(ba));

r.head('the Drive archive has exactly ONE trigger installer, and no hidden ones');
// The behaviour of the sweep is in smoke-store.mjs, where it actually runs. What is
// asserted here is the shape a behavioural suite cannot see: that nothing else in
// the file has quietly acquired the power to create a trigger — or, since the Google
// door needs to know its own address, the power to do anything else with ScriptApp.
const scriptAppUses = (code.match(/ScriptApp\.\w+/g) || []);
r.ok('ScriptApp appears only in the two trigger functions, and in the door\'s own-address read',
  (function () {
    const allowed = ['installArchiveTrigger', 'removeArchiveTrigger', 'googleSwitchUrl']
      .map(fn => fnBody(fn)).join('\n');
    return scriptAppUses.every(u => allowed.indexOf(u) > -1);
  })(), scriptAppUses);
r.ok('the installer is IDEMPOTENT — it lists before it creates',
  /getProjectTriggers\(\)[\s\S]{0,200}?existing\.length[\s\S]{0,400}?newTrigger/.test(
    fnBody('installArchiveTrigger')));
r.ok('and it can be undone, so installed-but-unwanted is a state you can leave',
  /deleteTrigger/.test(fnBody('removeArchiveTrigger')));
r.ok('both print through report(), because the editor never shows a return value',
  /return report\(/.test(fnBody('installArchiveTrigger')) &&
  /return report\(/.test(fnBody('removeArchiveTrigger')));
r.ok('the sweep CANNOT throw — a nightly failure email is a failure nobody reads',
  /^function archiveClosedIRs\(\) \{\r?\n  try \{\r?\n    return report\(/.test(
    code.slice(code.indexOf('function archiveClosedIRs()'))));

r.head('the archived-folder fork is closed at the source');
// The regression: getOrCreateSectionFolder used to resolve the IR folder by name
// from the ROOT only, so a folder moved to Archive IRs/ would not be found and a
// second, empty one would be created. smoke-store.mjs proves the behaviour; this
// pins the line that caused it.
r.ok('getOrCreateSectionFolder no longer looks the IR folder up in the root',
  !/getOrCreateSubfolder\(rootFolder,\s*irNumber\)/.test(code) &&
  /findIRFolder\(irNumber, true\)/.test(fnBody('getOrCreateSectionFolder')),
  (fnBody('getOrCreateSectionFolder').match(/var \w+ = [^\n]*/) || [''])[0]);
r.ok('the resolver searches the archive but NEVER creates it as a side effect',
  /var archive = getArchiveFolder\(false\)/.test(fnBody('findIRFolder')),
  'an ordinary upload must not bring Archive IRs/ into existence');
r.ok('nothing in the backend erases a folder or a file',
  !/setTrashed|removeFile\(|\bdeleteFile\(/.test(code));

r.head('an upload with no MIME type still lands, and a broken one is never dropped quietly');
// The owner's report: on two Android phones the photo showed a thumbnail before
// saving and was gone after a reload, with no error anywhere. Android's picker
// hands Chrome `File.type === ''` for a plain JPEG, and the upload loop used to
// `return` on a falsy mimeType — a silent drop under a "✓ Saved!".
r.ok('the upload loop no longer skips a file for a missing MIME type',
  !/if \(!file\.base64 \|\| !file\.name \|\| !file\.mimeType\) return;/.test(sv),
  (sv.match(/if \(!file\.base64[^\n]*/) || ['none — correct'])[0]);
r.ok('it still refuses a file with no name or no contents, loudly',
  /if \(!file\.base64 \|\| !file\.name\)\s*\n\s*throw new Error\(/.test(sv),
  (sv.match(/if \(!file\.base64[^\n]*/) || [''])[0]);
r.ok('the MIME type comes from resolveMime, not straight off the wire',
  /var mime\s*=\s*resolveMime\(file\.mimeType, file\.name\)/.test(sv));
r.ok('and the blob is built with that resolved type',
  /Utilities\.newBlob\(Utilities\.base64Decode\(file\.base64\), mime, file\.name\)/.test(sv));
r.ok('a recognised extension beats a useless declared type',
  /d === 'application\/octet-stream'/.test(fnBody('resolveMime')) &&
  /if \(generic && byName\) return byName;/.test(fnBody('resolveMime')));
r.ok('resolveMime can never return an empty string — Drive needs a real type',
  /return d \|\| byName \|\| 'application\/octet-stream'/.test(fnBody('resolveMime')));
r.ok('the extension map covers the phone formats, not only the desktop ones',
  ['jpg','jpeg','png','gif','webp','heic','heif','bmp','tiff','pdf']
    .every(e => new RegExp('\\b' + e + ':').test(fnBody('mimeFromName'))),
  (fnBody('mimeFromName').match(/heic[^\n]*/) || [''])[0]);
r.ok('mimeFromName reads the LAST extension and lowercases it',
  /toLowerCase\(\)\.match\(\/\\\.\(\[a-z0-9\]\+\)\$\/\)/.test(fnBody('mimeFromName')));

r.head('every sign-in leaves a record, and nothing about that record can refuse a sign-in');
// A sign-in code is reusable for its whole lifetime by design, so a code read over
// someone's shoulder stays live with it. The audit line is the only thing that makes
// that visible, which is why it must exist on every success — and must never be able
// to fail the sign-in it is recording.
r.ok('a sign-in audit stream exists, named rather than inlined',
  /var SIGNIN_AUDIT_SUBJECT = 'signins';/.test(code), (code.match(/SIGNIN_AUDIT_SUBJECT = [^\n]*/) || [''])[0]);
r.ok('the successful sign-in path writes it',
  /appendAuditLinesLocked\(SIGNIN_AUDIT_SUBJECT/.test(fnBody('doLoginPassword')));
// `code` has its comments stripped, so this has to be structural: the audit write
// must sit inside a try that OPENS after the previous catch (its own, not the
// last-login stamp's) and CLOSES before the session is minted. Both halves matter —
// sharing the stamp's try is the same as having no protection at all.
const loginBody = fnBody('doLoginPassword');
const auditAt = loginBody.indexOf('appendAuditLinesLocked(SIGNIN_AUDIT_SUBJECT');
const mintAt = loginBody.indexOf('var token = mintSession');
r.ok('the audit write sits in its OWN try, not the last-login stamp\'s',
  auditAt > -1 &&
  loginBody.lastIndexOf('try', auditAt) > loginBody.lastIndexOf('catch', auditAt),
  'the nearest try/catch keyword before the audit write must be try — otherwise it ' +
  'shares the last-login stamp\'s catch and can never be non-fatal on its own');
r.ok('and that try is CLOSED before the session is minted, so a failure cannot escape',
  auditAt > -1 && mintAt > auditAt && /\bcatch\b/.test(loginBody.slice(auditAt, mintAt)));
r.ok('the session is minted AFTER the audit attempt, so a slow log cannot lose a token',
  auditAt < mintAt);
r.ok('the line records WHO, and the age of the code they redeemed',
  /by: String\(email \|\| ''\)/.test(fnBody('signinAuditLine')) &&
  /'code ' \+ codeAgeLabel\(codeIssuedAt, nowMs\) \+ ' old'/.test(fnBody('signinAuditLine')));
r.ok('a sign-in that reports no device says so instead of recording an empty column',
  /' · device not reported'/.test(fnBody('signinAuditLine')));
r.ok('the device string is length-capped rather than trusted',
  /\.slice\(0, 120\)/.test(fnBody('signinAuditLine')));
r.ok('the code\'s age is read AFTER the code verifies, never before',
  fnBody('loginOtpStep').indexOf('verifyAuthCode(email, \'login\', code, false)') <
  fnBody('loginOtpStep').indexOf('info.codeIssuedAt'));
// Again structural, because comments are stripped: the age read must be wrapped in
// its own try/catch so an unreadable codes.json cannot fail a verified sign-in.
const otpBody = fnBody('loginOtpStep');
const ageAt = otpBody.indexOf('info.codeIssuedAt');
r.ok('an unreadable code store leaves the age unknown rather than failing the sign-in',
  /try/.test(otpBody.slice(otpBody.lastIndexOf('try', ageAt), ageAt)) &&
  /\bcatch\b/.test(otpBody.slice(ageAt, otpBody.indexOf('return null', ageAt))),
  otpBody.slice(ageAt, otpBody.indexOf('return null', ageAt)));
r.ok('an operator can read the log back without a screen for it',
  /function reportRecentSignins\(days\)/.test(code) &&
  /readAuditLines\(SIGNIN_AUDIT_SUBJECT\)/.test(fnBody('reportRecentSignins')));
r.ok('the reader is read-only — it takes no lock',
  !/withRowLockOrThrow/.test(fnBody('reportRecentSignins')));

// ── THE GOOGLE DOOR ───────────────────────────────────────────────────────────
// The door is TWO HALVES ON TWO DEPLOYMENTS, and the reason is measured rather than
// assumed: a cross-site fetch from the app to the "Anyone within indrones.com"
// deployment is refused by Google with a 401 BEFORE any of this code runs, while the
// same URL opened as a top-level NAVIGATION gets through. So half one is a
// navigation (GET googleStart, on the domain-restricted deployment), and half two is
// an ordinary POST (googleExchange, on the "Anyone" deployment) carrying back the
// one-time handoff code half one minted.
//
// Behaviour lives in smoke-store.mjs, which calls the real functions. What is pinned
// HERE is the shape behaviour cannot show: which identity call is used, that the two
// halves share one mint so a fix cannot land on only one of them, and that the
// redirect has no client-supplied target.
r.head('the Google door reads the CALLER, and never the script owner');
const gcall = fnBody('googleCallerEmail');
r.ok('it uses getActiveUser — the caller — and nothing else',
  /Session\.getActiveUser\(\)/.test(gcall), (gcall.match(/[^\n]*getActiveUser[^\n]*/) || [''])[0]);
// The single most dangerous word in this feature. getEffectiveUser returns the
// SCRIPT OWNER, which under "Execute as: Me" is one person for every caller on
// earth — so this would not fail, it would silently make everyone monish.raza.
r.ok('getEffectiveUser appears NOWHERE in the identity path — it would make everyone the owner',
  !/getEffectiveUser/.test(gcall) && !/getEffectiveUser/.test(fnBody('googleDoorCheck')) &&
  !/getEffectiveUser/.test(fnBody('doGoogleStart')),
  (code.match(/[^\n]*getEffectiveUser[^\n]*/g) || ['none']));
r.ok('a Session call that fails is an empty identity, not an exception',
  /try\s*{/.test(gcall) && /catch/.test(gcall) && /return '';/.test(gcall));

r.head('the refusal ladder is one function, so both halves cannot disagree');
const gdoor = fnBody('googleDoorCheck');
r.ok('the door goes through it', /googleDoorCheck\(\)/.test(fnBody('doGoogleStart')));
r.ok('an empty identity is refused', /if \(!email\)/.test(gdoor));
r.ok('a non-domain address is refused against CONFIG.ALLOWED_DOMAIN',
  /CONFIG\.ALLOWED_DOMAIN/.test(gdoor), (gdoor.match(/[^\n]*ALLOWED_DOMAIN[^\n]*/) || [''])[0]);
r.ok('an address with no account is refused — there is still no self-signup',
  /findUser\(email\)/.test(gdoor) && /No account found/.test(gdoor));
r.ok('a disabled account is refused', /disabled/.test(gdoor));
r.ok('a temp-password account is refused and sent to the password door',
  /isTempPasswordAccount\(u\)/.test(gdoor) && /temporary password/i.test(gdoor));
r.ok('...and it reuses tempPasswordExpired rather than inventing a second TTL',
  /tempPasswordExpired\(u\)/.test(gdoor));
r.ok('...and every refusal precedes the admit, so no code escapes the ladder',
  gdoor.indexOf('isTempPasswordAccount') < gdoor.lastIndexOf('return { email: email'),
  { check: gdoor.indexOf('isTempPasswordAccount'), admit: gdoor.lastIndexOf('return { email: email') });
// The counter belongs to the password door. Reading OR WRITING it here would give a
// probe a way to lock a legitimate user out of their own recovery path — and
// CLEARING it here would let someone wash away their own failed-password count by
// clicking the Google button, which is a lockout bypass.
r.ok('NOTHING in either half touches the lockout counters',
  !/lockoutRemaining|recordFailedLogin|clearFailedLogin/.test(gdoor) &&
  !/lockoutRemaining|recordFailedLogin|clearFailedLogin/.test(fnBody('doGoogleStart')) &&
  !/lockoutRemaining|recordFailedLogin|clearFailedLogin/.test(fnBody('mintGoogleSession')));

r.head('half one issues a code, and mints nothing');
const gstart = fnBody('doGoogleStart');
r.ok('it mints no session and writes no audit line of its own',
  !/\bmintSession\(/.test(gstart) && !/appendAuditLinesLocked/.test(gstart));
r.ok('...and issuing the handoff is the only thing it does with an admitted address',
  /issueHandoff\(c\.email\)/.test(gstart),
  (gstart.match(/[^\n]*issueHandoff[^\n]*/) || [''])[0]);
r.ok('a refusal is reported as a refusal, never swallowed into a code',
  /if \(c\.error\) return handoffPage\(null, '', c\.error\.message\)/.test(gstart));
r.ok('...and the admitted address is named ON THE PAGE, so the user sees which account before signing',
  /handoffPage\(code, c\.email, ''\)/.test(gstart),
  (gstart.match(/[^\n]*handoffPage\(code[^\n]*/) || [''])[0]);

r.head('the handoff code is a 122-bit secret, and it travels in the URL FRAGMENT');
const findH = fnBody('findHandoffIn');
r.ok('it is looked up BY CODE — on the way back there is no address to look it up by',
  /String\(e\.code\) !== want/.test(findH), findH.slice(0, 260));
r.ok('...and only among purpose "google" entries, so an emailed code can never be one',
  /purpose\) !== 'google'/.test(findH));
r.ok('the code is a hyphen-stripped UUID, not a six-digit code',
  /Utilities\.getUuid\(\)\.replace\(\/-\/g, ''\)/.test(fnBody('issueHandoff')),
  (fnBody('issueHandoff').match(/[^\n]*getUuid[^\n]*/) || [''])[0]);
r.ok('the TTL is in minutes, and short',
  Number((code.match(/HANDOFF_TTL_MIN\s*=\s*(\d+)/) || [])[1]) > 0 &&
  Number((code.match(/HANDOFF_TTL_MIN\s*=\s*(\d+)/) || [])[1]) <= 5,
  (code.match(/HANDOFF_TTL_MIN\s*=\s*\d+/) || ['absent'])[0]);
// A spent code must be REFUSED, not merely marked. Setting `used = true` and never
// reading it back is a replay hole, and it is exactly the bug this assertion was
// written after: the first version of redeemHandoff had it.
r.ok('redeemHandoff CHECKS used, it does not merely set it',
  /if \(!found \|\| found\.used\) return refused;/.test(fnBody('redeemHandoff')),
  (fnBody('redeemHandoff').match(/[^\n]*found\.used[^\n]*/) || [''])[0]);
r.ok('issuing twice retires the earlier live code for that address',
  /!\s*e\.used\)\s*e\.used = true/.test(fnBody('issueHandoff')),
  (fnBody('issueHandoff').match(/[^\n]*e\.used = true[^\n]*/) || [''])[0]);
r.ok('an unreadable expiry refuses — "cannot tell" must not mean "fresh"',
  /var exp = asDate\(found\.expiresAt\)/.test(fnBody('redeemHandoff')) &&
  /if \(!exp \|\| exp\.getTime\(\) < Date\.now\(\)\) return refused;/.test(fnBody('redeemHandoff')));
r.ok('the refusals do not say whether the code ever existed — no oracle',
  (fnBody('redeemHandoff').match(/message:\s*'/g) || []).length === 1,
  (fnBody('redeemHandoff').match(/[^\n]*message:[^\n]*/) || [''])[0]);

r.head('the door ends on a page whose way forward is a link the user taps — an automatic redirect is impossible here');const hpage = fnBody('handoffPage');
const hesc = fnBody('htmlEscape');
// THE BUG THIS BLOCK EXISTS FOR. The door once answered with
// `ContentService.createTextOutput(html).setMimeType(ContentService.MimeType.HTML)`
// and a `location.replace` back to the app — and BOTH halves failed silently:
// ContentService.MimeType has no HTML member, so the response went out as plain text
// and the user was shown the source of a page that never ran; and since the 2021
// IFRAME sandbox change an Apps Script page cannot navigate the top-level window
// without a user gesture, so it would have moved Google's frame and left the app
// inside an iframe at the wrong origin.
r.ok('it serves through HtmlService — the only thing in Apps Script that returns a page',
  /HtmlService\.createHtmlOutput\(/.test(hpage) && !/ContentService/.test(hpage),
  (hpage.match(/[^\n]*createHtmlOutput[^\n]*/) || [''])[0]);
r.ok('THE IMAGINARY MEMBER CANNOT COME BACK: nothing asks ContentService for HTML',
  !/ContentService\.MimeType\.HTML/.test(code),
  (code.match(/[^\n]*ContentService\.MimeType\.HTML[^\n]*/) || ['none — good'])[0]);
r.ok('the page does NOT try to navigate itself — that is what the sandbox forbids',
  !/location\.replace\(/.test(hpage) && !/location\.href\s*=/.test(hpage) &&
  !/<script/i.test(hpage));
r.ok('...and every link on the page wears target="_top", or the tap would only move Google\'s frame',
  (hpage.match(/<a\b[^>]*>/g) || []).length > 0 &&
  (hpage.match(/<a\b[^>]*>/g) || []).every(t => /target="_top"/.test(t)),
  (hpage.match(/<a\b[^>]*>/g) || []).join(' '));
r.ok('...and nothing else can leave the page: two branch links and one shared "not you", no form, no meta refresh',
  (hpage.match(/<a\b/g) || []).length === 3 &&        // one primary per branch, plus the
                                                      // single "choose a different account" link
  !/<form|<meta http-equiv="refresh"/i.test(hpage));

// ── THE PHONE THAT HANDS OVER THE WRONG GOOGLE ACCOUNT ────────────────────────
// The app starts every Google sign-in at Google's own account picker, because a web
// app is served the browser's DEFAULT account and a phone with a personal account
// signed in would otherwise be refused by Google before our code ran. This is the
// other half of that: the page the door ends on can send the person back to the
// picker, so an account that is merely the WRONG one — not an invalid one — is one
// tap from being fixed, without a trip back through the app.
r.head('the door page can send you back to Google\'s picker with the right account');
const swfn = fnBody('googleSwitchUrl');
r.ok('the return address is the RUNNING deployment, read from the platform',
  /ScriptApp\.getService\(\)\.getUrl\(\)/.test(swfn), swfn.slice(0, 200));
r.ok('...inside a try, because that read is the platform\'s to refuse',
  /try \{[\s\S]*?catch \(err\) \{ self = ''; \}/.test(swfn), swfn.slice(0, 200));
r.ok('...and an empty read returns NOTHING, so the caller ships no dead link',
  /if \(!self\) return '';/.test(swfn));
r.ok('the target is Google\'s picker, with the encoding it needs for a URL inside a URL',
  /'https:\/\/accounts\.google\.com\/AccountChooser\?continue='/.test(swfn) &&
  /encodeURIComponent\(self \+ '\?action=googleStart'\)/.test(swfn),
  (swfn.match(/[^\n]*AccountChooser[^\n]*/) || [''])[0]);
r.ok('...and it comes back to the DOOR, not to the app — the app would only re-pick the same account',
  !/CONFIG\.APP_URL/.test(swfn));
r.ok('the page carries it on BOTH branches, and only when it is real',
  /var sw = googleSwitchUrl\(\);/.test(hpage) && /\+ body \+ alt \+/.test(hpage) &&
  /var alt = sw\s*\n?\s*\?/.test(hpage), (hpage.match(/[^\n]*var alt[^\n]*/) || [''])[0]);
r.ok('...as a SECOND link, below the primary one, so the page still ends on Continue',
  /'<a class="alt" target="_top" href="' \+ htmlEscape\(sw\) \+ '"/.test(hpage));
r.ok('...and the whole thing is still built server-side, with no request parameter to move it',
  !/\bparam/.test(swfn) && !/\be\.parameter/.test(swfn));
r.ok('it reads CONFIG.APP_URL', /CONFIG\.APP_URL/.test(hpage));
// Structural, not a check: there is no client-supplied URL to validate, so there is
// nothing an attacker can point at their own site. A `?next=` parameter would turn
// this GET into an open redirect on a Google-hosted origin.
r.ok('...and reads NO request parameter at all',
  !/\bparam/.test(hpage) && !/\be\.parameter/.test(hpage),
  (hpage.match(/[^\n]*param[^\n]*/) || ['none'])[0]);
r.ok('the code travels in the FRAGMENT, which is never sent to a server',
  /'#sso='/.test(hpage) && !/\?sso=/.test(hpage),
  (hpage.match(/[^\n]*#sso[^\n]*/) || [''])[0]);
r.ok('a refusal comes back as #ssoerr, encoded, so the reason survives into the app',
  /#ssoerr=/.test(hpage) && /encodeURIComponent/.test(hpage));
r.ok('every value that reaches the markup is escaped for it',
  /&amp;/.test(hesc) && /&lt;/.test(hesc) && /&gt;/.test(hesc) &&
  /&quot;/.test(hesc) && /&#39;/.test(hesc),
  (hesc.match(/[^\n]*replace\([^\n]*/) || [''])[0]);
r.ok('...and the identity and the refusal are both escaped on the way in, never bare',
  /htmlEscape\(email\)/.test(hpage) && /htmlEscape\(message \|\|/.test(hpage) &&
  !/\+\s*email\s*\+/.test(hpage) && !/\+\s*message\s*\+/.test(hpage));

r.head('half two mints EXACTLY what the password door mints, from one shared body');
const gexch = fnBody('doGoogleExchange');
const gmint = fnBody('mintGoogleSession');
// Two halves on two deployments are two chances to fix only one of them, so there is
// one mint — the same last-login stamp, the same `google sso · <device>` line, the
// same payload — and half two calls it rather than repeating it.
r.ok('the exchange mints through mintGoogleSession, not by hand',
  /mintGoogleSession\(res\.email, params\.device\)/.test(gexch) && !/\bmintSession\(/.test(gexch),
  (gexch.match(/[^\n]*mintGoogleSession[^\n]*/) || [''])[0]);
r.ok('a bad code returns the refusal as-is, with no email attached to it',
  /if \(res\.error\) return res\.error;/.test(gexch) && /res\.email/.test(gexch));
r.ok('the mint returns the same payload shape as the password door',
  /\bmintSession\(email\)/.test(gmint) &&
  /sessionToken: token/.test(gmint) && /access: getMyAccess\(email\)/.test(gmint),
  (gmint.match(/[^\n]*sessionToken[^\n]*/) || [''])[0]);
r.ok('the last-login stamp is written, and is best-effort like the password door\'s',
  /lastLoginAt/.test(gmint) && /catch/.test(gmint));
r.ok('the sign-in line records the door it came through',
  /signinAuditLine\(email, null, device, signinAt, 'google'\)/.test(gmint),
  (gmint.match(/[^\n]*signinAuditLine[^\n]*/) || [''])[0]);

r.head('a Google handoff is invisible to the emailed-code throttle');
// A handoff is not a mailed six-digit code, and counting it would let three Google
// sign-ins spend a colleague's budget for the reset that is the only way back into a
// locked account.
r.ok('issueAuthCode skips purpose "google"',
  /purpose\) === 'google'\) return;/.test(fnBody('issueAuthCode')),
  (fnBody('issueAuthCode').match(/[^\n]*'google'[^\n]*/) || [''])[0]);

r.head('signinAuditLine still writes the old line for everyone else');
const sal = fnBody('signinAuditLine');
r.ok('the method argument is OPTIONAL — a caller that passes nothing is unchanged',
  /signinAuditLine\(email, codeIssuedAt, device, nowMs, method\)/.test(code));
r.ok('only the google door changes the wording, and it says so without a code age',
  /=== 'google'/.test(sal) && /'google sso'/.test(sal) && !/code .*google/.test(sal));

r.head('the Google door needs no network and no new permission');
// The one thing that already broke Google Sign-In once, and the reason this design
// was chosen over an OAuth Client ID: nothing here calls out.
r.ok('no UrlFetchApp anywhere — still true after adding this door',
  !/UrlFetchApp/.test(code), (code.match(/[^\n]*UrlFetchApp[^\n]*/) || ['none']));
r.ok('it needs no OAuth scope of its own — Session is core',
  !/ScriptApp\.getOAuthToken|OAuth2/.test(code));

r.finish();
