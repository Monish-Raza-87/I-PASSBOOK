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
 'setUserDepartments', 'purgeUsers']
  .forEach(a => r.ok('"' + a + '" is dispatched',
    new RegExp('\\b' + a + '\\s*:').test(dispatchers),
    (dispatchers.match(new RegExp('.{0,30}\\b' + a + '\\s*:')) || ['absent'])[0]));

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
const capN     = Number((code.match(/MAIL_DAILY_CAP\s*=\s*(\d+)/) || [])[1]);
const reserveN = Number((code.match(/MAIL_AUTH_RESERVE\s*=\s*(\d+)/) || [])[1]);
r.ok('the reserve is non-zero and strictly below the cap',
  reserveN > 0 && reserveN < capN, { cap: capN, reserve: reserveN });

// The property, stated structurally: walk to the function enclosing each literal
// send and require that it consulted the cap. A third sender added later cannot
// slip through uncapped without failing here.
const sendSites = [...code.matchAll(/MailApp\.sendEmail/g)];
r.ok('there are exactly two send sites', sendSites.length === 2, sendSites.length);
sendSites.forEach((m, i) => {
  const owner = enclosingFn(m.index);
  const body  = owner ? fnBody(owner.name) : '';
  r.ok('send site ' + (i + 1) + ' (' + (owner ? owner.name : 'top level') + ') is quota-checked',
    /mailQuotaOk/.test(body),
    { site: i + 1, fn: owner && owner.name, capped: /mailQuotaOk/.test(body) });
});

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
  'seedDepartments', 'seedMemberships', 'maintenancePruneAuditLog'];
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
  /return create \? getStoreFolder\(\)\.createFolder\(name\) : null/.test(fnBody('getStoreSubfolder')),
  (fnBody('getStoreSubfolder').match(/[^\n]*createFolder[^\n]*/) || [''])[0]);

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
r.ok('each entry is labelled with which half it came from',
  /source:\s*isWorkflowRow\s*\?\s*'workflow'\s*:\s*'section'/.test(gal),
  (gal.match(/[^\n]*source:[^\n]*/) || [''])[0]);
r.ok('a workflow line reports no section id, so it cannot be mistaken for a save',
  /sectionId:\s*isWorkflowRow\s*\?\s*''\s*:\s*sec/.test(gal));
// An entry has to be attributable to the IR it is ABOUT. Reporting a workflow
// line's own `ir` verbatim would hand back `__IRS__` — the STORE, not the ticket —
// and quietly make any future `e.irNumber === irNumber` filter drop every status
// change. (The frontend happens not to filter on it today, which is exactly why
// this would rot.)
r.ok('a workflow line reports the real IR, not the store name in its own field',
  /irNumber:\s*isWorkflowRow\s*\?\s*sec\s*:\s*ir/.test(gal),
  (gal.match(/[^\n]*irNumber:[^\n]*/) || [''])[0]);
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

r.finish();
