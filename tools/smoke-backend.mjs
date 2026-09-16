// Smoke test for backend.gs — the parts a frontend suite cannot reach.
//
//   node tools/smoke-backend.mjs
//
// backend.gs runs inside Google Apps Script, so it cannot be executed here: it
// has SpreadsheetApp, MailApp, Utilities and PropertiesService, none of which
// exist in Node, and it is deployed by hand into a different runtime. `node
// --check` proves it parses and nothing more.
//
// So this suite asserts the things that are cheap to get wrong in a 1,700-line
// rewrite and expensive to discover in production: that the deleted actions are
// really gone from the dispatcher (or a stale cached frontend silently calls
// nothing), that the security-relevant constants are what the owner decided, and
// that the router's structure is the restructured one — with NO dispatch outside
// the try/catch, which was the specific way errors used to surface as an HTML
// page instead of JSON.

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
r.ok('API_VERSION is 2', /API_VERSION:\s*2\b/.test(code), (code.match(/API_VERSION:[^\n]*/) || [''])[0]);
r.ok('the session is 30 days', /SESSION_DAYS:\s*30\b/.test(code), (code.match(/SESSION_DAYS:[^\n]*/) || [''])[0]);
r.ok('the session slides on use', /SESSION_SLIDE_HOURS:/.test(code));
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

r.head('the edit grants live in a real tab, never a sentinel');
// Sentinel (__-prefixed) irNumbers skip every ACL check in saveSection, so
// grants stored in one could be rewritten by any signed-in user.
r.ok('a DEPARTMENTS tab is read by the ACL',
  /getOrCreateDeptTab|'DEPARTMENTS'/.test(code));
r.ok('a USER_DEPARTMENTS edge list exists',
  /getOrCreateUserDeptTab|USER_DEPARTMENTS/.test(code));
r.ok('the grant reader does not touch a sentinel store',
  !/__CONFIG__[\s\S]{0,200}(edit|grant)/i.test(gea));
r.ok('department grants and memberships are separate readers',
  // departmentCapabilities replaced departmentEditGrants: ONE read of DEPARTMENTS
  // answering both axes (section grants AND Triage), rather than two functions
  // re-scanning the same rows.
  /function departmentCapabilities/.test(code) && /function getUserDepartments/.test(code));
r.ok('nothing still calls the removed departmentEditGrants', !/departmentEditGrants/.test(code));
r.ok('the two axes are returned as one object', /\{\s*grants:\s*\{\},\s*triage:\s*false\s*\}/.test(code),
  (code.match(/grants:\s*\{\},\s*triage[^\n]*/) || [''])[0]);

r.head('Triage is a second axis, not a seventh grant');
// The distinction the whole design rests on: a department may triage without editing
// ANY section. CR and Management get exactly that — they own the ticket header
// (status, assignee, priority) and none of the six section forms. If Triage were
// modelled as a seventh entry in SECTION_KEYS it would also appear as a column at
// 3 + j, shift every real grant by one, and grant write access to a form.
const cap = fnBody('departmentCapabilities');
r.ok('triage is read in the same pass, from its own cell', /out\.triage\s*=\s*true/.test(cap),
  (cap.match(/[^\n]*out\.triage[^\n]*/) || [''])[0]);
r.ok('the section loop stays bounded by SECTION_KEYS, so Triage is not in it',
  /j\s*<\s*SECTION_KEYS\.length/.test(cap), (cap.match(/for \(var j[^\n]*/) || [''])[0]);
r.ok('the triage cell is read positionally through the arithmetic helper',
  /data\[i\]\[triageCol\]/.test(cap) && /deptTriageIndex\(\)/.test(cap),
  (cap.match(/[^\n]*triageCol[^\n]*/) || [''])[0]);
r.ok('a deactivated department grants neither axis',
  /toLowerCase\(\)\s*===\s*'no'\)\s*continue/.test(cap), (cap.match(/[^\n]*'no'[^\n]*/) || [''])[0]);
r.ok('it short-circuits before scanning when there are no departments',
  /if \(!keys\.length\) return out/.test(cap));
// The offset arithmetic. Triage is appended LAST precisely so `3 + j` keeps meaning
// what it meant; inserting the column anywhere else would shift all six grants.
const deptHeadLine = (code.match(/DEPT_HEADS\s*=[^\n]*/) || [''])[0];
r.ok('Triage is appended after SECTION_KEYS, never inserted among them',
  /\[[^\]]*\]\s*\.concat\(SECTION_KEYS\)\s*\.concat\(\[/.test(deptHeadLine), deptHeadLine);
const deptTail = ((deptHeadLine.match(/\.concat\(\[([^\]]*)\]\)/) || [])[1] || '')
  .split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
const nSections = (((code.match(/SECTION_KEYS\s*=\s*\[([^\]]*)\]/) || [])[1] || '')
  .split(',').filter(s => s.trim()).length);
r.ok('Triage is the LAST column', deptTail[deptTail.length - 1] === 'Triage', deptTail);
r.ok('DEPARTMENTS is 3 + 6 + 3 = 12 columns', 3 + nSections + deptTail.length === 12,
  { lead: 3, sections: nSections, tail: deptTail.length });
r.ok('the triage index is arithmetic, never a magic 11',
  /function deptTriageIndex\(\)\s*\{\s*return 3 \+ SECTION_KEYS\.length \+ 2;/.test(code),
  (code.match(/function deptTriageIndex[^\n]*/) || [''])[0]);
r.ok('every Triage read goes through it, so the next widening cannot misread it',
  (code.match(/deptTriageIndex\(\)/g) || []).length >= 4,
  (code.match(/deptTriageIndex\(\)/g) || []).length);
r.ok('triage is granted by role for admins, not by a department row',
  /triage:\s*true/.test(gea), (gea.match(/[^\n]*triage[^\n]*/) || []).slice(0, 3));
// Fail-closed: the department read happens AFTER the triage default is set, so a
// throw inside it still leaves a minimum-privilege profile rather than an
// undefined-that-reads-as-falsy-by-accident.
r.ok('triage is defaulted BEFORE the department read',
  gea.indexOf('triage') > -1 && gea.indexOf('triage') < gea.indexOf('departmentCapabilities'),
  { triageAt: gea.indexOf('triage'), readAt: gea.indexOf('departmentCapabilities') });
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

r.head('the section keys are the six the frontend uses');
const keys = (code.match(/SECTION_KEYS\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
const list = keys.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
r.ok('six section keys', list.length === 6, list);
r.ok('they are sec-b … sec-g in order',
  list.join(',') === 'sec-b,sec-c,sec-d,sec-e,sec-f,sec-g', list);
// The Overview is not a section but IS a gated record, and it keeps the historical
// id `sec-a` so its APP_DATA row, drafts and audit rows survive untouched.
r.ok('the Overview keeps the id sec-a, outside SECTION_KEYS',
  /OVERVIEW_KEY\s*=\s*'sec-a'/.test(code) && list.indexOf('sec-a') < 0);
r.ok('the three retired ids are derived, not a second literal that can drift',
  /RETIRED_SECTION_IDS\s*=\s*Object\.keys\(SEC_TARGET_MAP\)/.test(code),
  (code.match(/RETIRED_SECTION_IDS[^\n]*/) || [''])[0]);
r.ok('the merge targets are sec-g→sec-f, sec-h→sec-g, sec-i→sec-g',
  /'sec-g'\s*:\s*'sec-f'/.test(code) && /'sec-h'\s*:\s*'sec-g'/.test(code) && /'sec-i'\s*:\s*'sec-g'/.test(code),
  (code.match(/SEC_TARGET_MAP\s*=\s*\{[^}]*\}/) || [''])[0]);

r.head('the Overview survives getPassbook for a non-admin (§2.4)');
// The single most dangerous detail in the restructure: remove sec-a from
// SECTION_KEYS and no permission map has a sec-a key, so this filter would drop the
// Overview's row for all 18 non-admin users and keep it only for the admin — who is
// the one person testing it. The fix is an explicit allowance, and this asserts it.
const gpb = fnBody('getPassbook');
r.ok('getPassbook names OVERVIEW_KEY in its section filter', /OVERVIEW_KEY/.test(gpb),
  (gpb.match(/[^\n]*canView[^\n]*/) || [''])[0]);
r.ok('the allowance is in the skip condition itself, not a comment',
  /!isSentinel\s*&&\s*secId\s*!==\s*OVERVIEW_KEY\s*&&/.test(gpb),
  (gpb.match(/if\s*\(!isSentinel[^\n]*/) || [''])[0]);
r.ok('and it is inside the per-row loop, so it applies to every row',
  /for\s*\([^)]*\)[\s\S]{0,600}OVERVIEW_KEY/.test(gpb));

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
// The flag is cleared as part of the one identity-block write (columns B..H), so
// it is the empty string in the must-change slot rather than a header name.
r.ok('it rewrites the whole identity block in one write',
  /getRange\(idx,\s*2,\s*1,\s*USER_ID_BLOCK_COLS\)/.test(cp), cp.match(/getRange\([^)]*\)/));
r.ok('it revokes before minting', cp.indexOf('revokeAllSessions') < cp.indexOf('mintSession'),
  { revoke: cp.indexOf('revokeAllSessions'), mint: cp.indexOf('mintSession') });
r.ok('it tells the client the flag is cleared',
  /mustChangePassword:\s*false/.test(cp), (cp.match(/mustChangePassword:[^,]*/) || [''])[0]);

r.head('a temporary password stops working on a clock — on BOTH doors that take it');
// The TTL originally lived only in doLoginPassword. changePassword is
// unauthenticated and accepts the same credential, so an expired temp password
// could be POSTed straight to it: it verified the hash and minted a full 30-day
// session. The expiry closed the front door and left the side door open.
const ttl = fnBody('tempPasswordExpired');
r.ok('the expiry is one named helper', ttl.length > 100, ttl.length);
r.ok('it uses TEMP_PW_TTL_DAYS', /TEMP_PW_TTL_DAYS/.test(ttl),
  (ttl.match(/TEMP_PW_TTL_DAYS[^\n]*/) || [''])[0]);
r.ok('an unstamped temp password is treated as non-expiring, not as expired',
  /if \(!issued\) return null/.test(ttl), (ttl.match(/if \(!issued\)[^\n]*/) || [''])[0]);
const tmpFlag = fnBody('isTempPasswordAccount');
r.ok('the must-change flag is read in one place too',
  /Must Change Password/.test(tmpFlag), tmpFlag.slice(0, 160));
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
r.ok('it is throttled per email', /CODE_MAX_PER_HOUR/.test(fp));
r.ok('it has a GLOBAL hourly ceiling too, not only a per-email one',
  /CODE_MAX_PER_HOUR_GLOBAL/.test(fp), (fp.match(/CODE_MAX_PER_HOUR_GLOBAL[^\n]*/) || [''])[0]);
r.ok('...counted across every email, so many addresses cannot fan out the mail budget',
  /recentAnyEmail/.test(fp));
r.ok('it has a resend gap', /CODE_RESEND_GAP_MS/.test(fp));
r.ok('it retires earlier live codes', /'yes'/.test(fp));
r.ok('it never reveals a failure', /catch/.test(fp));
r.ok('it sends through sendAuthMail', /sendAuthMail/.test(fp));

const rp = fnBody('resetPassword');
r.ok('resetPassword exists', rp.length > 200, rp.length);
r.ok('resetPassword caps guessing', /CODE_MAX_ATTEMPTS/.test(rp), (rp.match(/CODE_MAX_ATTEMPTS[^\n]*/) || [''])[0]);
r.ok('resetPassword marks the code used', /'yes'/.test(rp));
r.ok('resetPassword returns NO token', !/sessionToken/.test(rp));
r.ok('resetPassword revokes every session', /revokeAllSessions/.test(rp));
// A reset may not change whether an account is enabled. It originally wrote the
// literal 'active' into the Status column, so resetting the password of a
// deliberately disabled account silently re-enabled it — an admin action leaking
// authority into a user-facing flow.
r.ok('resetPassword PRESERVES Status instead of forcing it active',
  /userCol\(urow, 'Status'\) \|\| 'active'/.test(rp),
  (rp.match(/userCol\(urow, 'Status'\)[^\n]*/) || [''])[0] || 'literal active restored');
r.ok('and refuses a disabled account outright', /disabled/i.test(rp),
  (rp.match(/[^\n]*disabled[^\n]*/i) || [''])[0]);

r.head('sessions');
const ls = fnBody('lookupSession');
r.ok('lookupSession exists', ls.length > 200, ls.length);
// Column numbers, not header names: lookupSession reads by index for speed.
r.ok('it slides the expiry on use', /getRange\(i \+ 1, 4\)\.setValue/.test(ls),
  (ls.match(/getRange\([^)]*\)[^\n]*/) || [''])[0]);
r.ok('and records when it last saw the session', /getRange\(i \+ 1, 6\)\.setValue/.test(ls));
r.ok('the slide is throttled, or the 90s poll becomes a write storm',
  /SESSION_SLIDE_HOURS/.test(ls), (ls.match(/SESSION_SLIDE_HOURS[^\n]*/) || [''])[0]);
r.ok('a stale-slide failure cannot fail the lookup',
  /catch \(e2\)/.test(ls), (ls.match(/catch \(e2\)[^\n]*/) || [''])[0]);
r.ok('it honours revocation', /'revoked'/.test(ls));
r.ok('it rejects an expired session', /exp < now/.test(ls));
r.ok('it never prunes inside itself (pruneSessions is bottom-up)', !/deleteRow/.test(ls));

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
// The dry-run return must come BEFORE the first deleteRow, or "review before you
// delete" is a promise the code does not keep.
r.ok('...and the dry-run branch precedes every delete',
  pu.indexOf('if (dryRun)') < pu.indexOf('deleteRow'),
  { dryRunAt: pu.indexOf('if (dryRun)'), firstDelete: pu.indexOf('deleteRow') });
r.ok('it returns what it deleted, as a backup', /asRows/.test(pu) && /removed: asRows/.test(pu));
r.ok('it plans first, then deletes the plan in reverse',
  /plan\.push\(/.test(pu) && /for \(var k = plan\.length - 1; k >= 0; k--\)/.test(pu));
r.ok('deletion is refused if the list changed since the review',
  /params\.expect/.test(pu) && /Nothing was deleted/.test(pu),
  (pu.match(/var expect[^\n]*/) || [''])[0]);
r.ok('it leaves admins alone', /isAdminEmail/.test(pu));
// Revocation is inline (one pass over SESSIONS) rather than N calls to
// revokeAllSessions — deliberate for a bulk purge, so the assertion is on the
// effect, not on the helper.
r.ok('it revokes every session it can still see',
  /setValue\('revoked'\)/.test(pu), (pu.match(/setValue\('revoked'\)/) || ['absent'])[0]);
r.ok('and stamps the revocation time', /getRange\(n \+ 1, 7\)/.test(pu));
r.ok('it removes the department edges too',
  /getOrCreateUserDeptTab/.test(pu) && /edges\.deleteRow/.test(pu));

r.head('row-index deletes are serialised against concurrent writers');
// Every deleteRow() here is index-based against an earlier getValues() snapshot.
// Deleting bottom-up only protects against OUR OWN deletes; a row appended by
// another admin in between shifts every index below it and we delete the WRONG
// row — silently, and in purgeUsers irrecoverably. Apps Script has no
// transactions, so a script lock is the only mutual exclusion available.
const wl = fnBody('withRowLock');
r.ok('withRowLock exists', wl.length > 200, wl.length);
r.ok('it takes a script lock', /LockService\.getScriptLock\(\)/.test(wl));
r.ok('it waits rather than racing', /waitLock\(/.test(wl), (wl.match(/waitLock\([^)]*\)/) || [''])[0]);
r.ok('it releases in a finally, so a throw cannot strand the lock',
  /finally/.test(wl) && /releaseLock\(\)/.test(wl));
r.ok('it REFUSES rather than proceeding unprotected when the lock is unavailable',
  /status: 'error'/.test(wl) && /busy with another admin change/.test(wl),
  (wl.match(/catch \(e\) \{[\s\S]{0,160}/) || [''])[0]);
// The index-based destructive paths must actually use it, and the read snapshot
// must be INSIDE the lock or the lock buys nothing.
['purgeUsers', 'deleteDepartment', 'setUserDepartments',
 // Added with the section merge: mergeSectionsApply rewrites AND deletes by
 // remembered row index (a new combination — no earlier migration locks), and the
 // two maintenance prunes are index-based deletes like purgeUsers.
 'mergeSectionsApply', 'restoreAppDataFromBackup', 'maintenancePruneAuditLog'].forEach(fn => {
  const body = fnBody(fn);
  r.ok(fn + ' is wrapped in withRowLock', /withRowLock\(/.test(body));
  r.ok(fn + ' takes its snapshot inside the lock',
    body.indexOf('withRowLock') < body.indexOf('getDataRange'),
    { lock: body.indexOf('withRowLock'), read: body.indexOf('getDataRange') });
  r.ok(fn + ' deletes bottom-up, so its own deletes cannot shift its targets', (() => {
    if (!/deleteRow/.test(body)) return true;                 // nothing to order
    const descendingLoop = /for \([^)]*;\s*\w+\s*>=\s*[\w.]+\s*;\s*\w+--\)/.test(body);
    const descendingSort = /sort\(function \(a, b\) \{ return b\.\w+ - a\.\w+; \}\)/.test(body);
    return descendingLoop || descendingSort;
  })(), (body.match(/[^\n]*(sort|for \()[^\n]*deleteRow|deleteRow[^\n]*/) || ['']).slice(0, 2));
});

// ── Column widths ─────────────────────────────────────────────────────────────
r.head('the users row is written at the right width');
// A range of the wrong width is the classic silent Apps Script failure: the
// values are dropped or the range throws at runtime, and nothing catches it
// until someone's password does not stick.
const blockCols = Number((code.match(/USER_ID_BLOCK_COLS\s*=\s*(\d+)/) || [])[1]);
r.ok('USER_ID_BLOCK_COLS is 7 (columns B..H)', blockCols === 7, blockCols);
r.ok('no getRange(…, 2, 1, 6) remains', !/getRange\([^)]*,\s*2\s*,\s*1\s*,\s*6\s*\)/.test(code));
r.ok('no getRange(…, 2, 1, USER_HEADS.length - 1) either (that is 10, not 7)',
  !/USER_HEADS\.length\s*-\s*1/.test(code), (code.match(/USER_HEADS\.length[^\n]*/) || [''])[0]);
const userHeads = ((code.match(/USER_HEADS\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '')
  .split(',').filter(s => s.trim());
r.ok('the users header has 11 columns', userHeads.length === 11, userHeads.length);
r.ok('the first five are the ones doLoginPassword reads by index',
  /'Email'/.test(userHeads[0]) && /'Password Hash'|Hash/.test(userHeads[1]) && /Salt/.test(userHeads[2]),
  userHeads.slice(0, 5));

r.head('every tab is widened on first use, never rebuilt');
// getDataRange() returns rows only as wide as the last column, so an un-widened
// tab yields undefined on the new indices — silently.
const eh = fnBody('ensureHeaders');
r.ok('ensureHeaders writes row 1 only', /getRange\(1, 1, 1,/.test(eh) || /setValues\(\[heads\]\)/.test(eh), eh.slice(0, 300));
r.ok('ensureHeaders does not touch data rows', !/deleteRow|clearContent|clear\(/.test(eh));
// Idempotent: it compares the existing row against the wanted headers and writes
// only on a difference, so re-running it can never reformat a live tab.
r.ok('ensureHeaders is idempotent — it compares before writing',
  /same/.test(eh) && /if \(!same\)|if \(same\)/.test(eh), eh.slice(0, 400));
r.ok('ensureHeaders writes the header row only',
  /setValues\(\[heads\]\)/.test(eh), (eh.match(/setValues[^\n]*/) || [''])[0]);
['getOrCreateUsersTab', 'getOrCreateSessionsTab', 'getOrCreateDeptTab',
 'getOrCreateUserDeptTab', 'getOrCreateCodesTab']
  .forEach(fn => r.ok(fn + ' uses ensureHeaders', /ensureHeaders\(/.test(fnBody(fn))));

// ── AUDIT_LOG: the widened read, the noise it no longer writes ────────────────
r.head('the audit log records the workflow half too');
// Sentinel writes were always recorded, but with `IR Number = '__IRS__'` and the
// real IR in the SECTION ID column, and getAuditLog matched column B only — so
// every status/assignee/priority change was written and then unreachable. Widening
// that match is the whole reason the timeline needs no new storage.
const gal = fnBody('getAuditLog');
r.ok('getAuditLog matches the workflow rows by the real IR in column C',
  /colC\s*===\s*irNumber/.test(gal) && /data\[i\]\[2\]/.test(gal),
  (gal.match(/[^\n]*colC[^\n]*/) || [''])[0]);
r.ok('and only when column B is a sentinel, so a future sentinel cannot leak in',
  /colB\.indexOf\('__'\)\s*===\s*0/.test(gal),
  (gal.match(/[^\n]*isWorkflowRow[^\n]*/) || [''])[0]);
r.ok('each entry is labelled with which half it came from',
  /source:\s*isWorkflowRow\s*\?\s*'workflow'\s*:\s*'section'/.test(gal),
  (gal.match(/[^\n]*source:[^\n]*/) || [''])[0]);
r.ok('a workflow row reports no section id, so it cannot be mistaken for a save',
  /sectionId:\s*isWorkflowRow\s*\?\s*''\s*:\s*data\[i\]\[2\]/.test(gal));
// An entry has to be attributable to the IR it is ABOUT. Reporting a workflow row's
// own column B verbatim would hand back `__IRS__` — the STORE, not the ticket — and
// quietly make any future `e.irNumber === irNumber` filter drop every status change.
// (The frontend happens not to filter on it today, which is exactly why this would rot.)
r.ok('a workflow row reports the real IR, not the store name in its own column B',
  /irNumber:\s*isWorkflowRow\s*\?\s*data\[i\]\[2\]\s*:\s*data\[i\]\[1\]/.test(gal),
  (gal.match(/[^\n]*irNumber:[^\n]*/) || [''])[0]);
r.ok('row order is the sheet order — append-only, so it is already chronological',
  !/\.sort\(/.test(gal));
r.ok('the response is capped', /AUDIT_RESPONSE_CAP/.test(gal),
  (gal.match(/var AUDIT_RESPONSE_CAP[^\n]*/) || [''])[0]);
r.ok('the cap keeps the NEWEST entries, not the oldest',
  /entries\.slice\(entries\.length\s*-\s*cap\)/.test(gal),
  (gal.match(/[^\n]*slice\([^\n]*/) || [''])[0]);
r.ok('and it says when it truncated, rather than silently dropping',
  /truncated:/.test(gal));

r.head('the three volume measures');
const sae = fnBody('appendAuditEntries');
r.ok('appendAuditEntries takes the uploads as a 7th parameter',
  /function appendAuditEntries\(([^)]*)\)/.test(code) &&
  ((code.match(/function appendAuditEntries\(([^)]*)\)/) || [])[1] || '').split(',').length === 7,
  (code.match(/function appendAuditEntries\([^)]*\)/) || [''])[0]);
r.ok('an upload writes an "uploaded" event', /'uploaded'/.test(sae));
r.ok('the uploaded row names the SOURCE field, never the derived _links key',
  /u\.fieldId/.test(sae) && /snapValue\(u\.name/.test(sae),
  (sae.match(/[^\n]*'uploaded'[^\n]*/) || [''])[0]);
r.ok('the derived link keys are still skipped in both diff loops',
  (sae.match(/_\|links\$\/|_links\$\//g) || []).length === 2 ||
  (sae.match(/_links\$\/\.test\(k\)/g) || []).length === 2,
  (sae.match(/_links/g) || []).length);
r.ok('done is suppressed — completion is implied by the save row',
  (sae.match(/k === 'done'\) return/g) || []).length === 2,
  (sae.match(/[^\n]*'done'[^\n]*/g) || []));
r.ok('the bare "saved" marker is written only for non-sentinel writes',
  /if \(!isSentinel\) rows\.push\(\[ts[^\n]*'saved'/.test(sae),
  (sae.match(/[^\n]*'saved'[^\n]*/) || [''])[0]);
// (a) — comments already carry their author and createdAt in the items array, at
// far better fidelity than a 500-char copy of the whole array, once per post,
// resolve, edit AND markRead. Guarded at the CALL site so the excluded store never
// reaches the function.
const audCall = sv.indexOf('appendAuditEntries(');
const nudgeGuard = sv.indexOf("irNumber !== '__NUDGES__'");
r.ok('__NUDGES__ saves are excluded from the audit at the source',
  nudgeGuard > -1 && nudgeGuard < audCall, { guard: nudgeGuard, call: audCall });
r.ok('the guard reads as a guard, not an inverted condition',
  !/irNumber === '__NUDGES__'[\s\S]{0,40}appendAuditEntries/.test(sv));
r.ok('the uploads are collected during the upload loop, before the audit call',
  sv.indexOf('uploads.push(') < audCall, { collect: sv.indexOf('uploads.push('), call: audCall });
r.ok('and passed into the same batch, so they share the save timestamp',
  /appendAuditEntries\([^)]*uploads\)/.test(sv),
  (sv.match(/[^\n]*appendAuditEntries\([^\n]*/) || [''])[0]);

r.head('pruning is a manual lever, like the session prune');
// Destructive and index-based, so it locks; manual because the audit trail is
// evidence and must not shrink behind anyone's back.
const mpal = fnBody('maintenancePruneAuditLog');
r.ok('maintenancePruneAuditLog exists', mpal.length > 300, mpal.length);
r.ok('the retention window is a named constant', /AUDIT_RETENTION_DAYS\s*=\s*\d+/.test(code),
  (code.match(/var AUDIT_RETENTION_DAYS[^\n]*/) || [''])[0]);
r.ok('it says so plainly when there is nothing to do, and writes nothing',
  /return 'Nothing older than/.test(mpal), (mpal.match(/[^\n]*Nothing older[^\n]*/) || [''])[0]);
r.ok('an unparseable stamp is KEPT, never pruned by accident',
  /parseAuditTimestamp/.test(mpal) && /continue/.test(mpal),
  (mpal.match(/[^\n]*parseAuditTimestamp[^\n]*/) || [''])[0]);
// dateParseTrap: Date.parse('21-Aug-2026 14:03:11') is NaN in V8, so a naive
// `new Date(v).getTime()` would make every row look unparseable — or worse, prune
// the wrong ones. The explicit parser exists for this and is used by both prunes.
r.ok('parseAuditTimestamp parses dd-MMM-yyyy explicitly, not via Date.parse',
  (() => {
    const p = fnBody('parseAuditTimestamp');
    return p.length > 100 && !/Date\.parse/.test(p) &&
      /substring|substr|split|match/.test(p) && /'jan'/.test(p);
  })(), fnBody('parseAuditTimestamp').slice(0, 400));

// ── The three pre-existing bugs the mapping surfaced ──────────────────────────
r.head('the migration reports still describe the OLD nine-section world');
// migrateAclReport's entire purpose is the owner's last chance to see the old
// per-user grants. Iterating SECTION_KEYS after the shrink would label old column 1
// (sec-a's grant) as sec-b AND never read the last three columns — a report that is
// wrong in both directions, on exactly the one screen where being wrong matters.
const mar = fnBody('migrateAclReport');
r.ok('migrateAclReport reads a historical nine-key literal',
  /LEGACY_ACL_SECTIONS\s*=\s*\[[\s\S]*?\]/.test(code) &&
  (((code.match(/LEGACY_ACL_SECTIONS\s*=\s*\[([^\]]*)\]/) || [])[1] || '').split(',').filter(s => s.trim()).length === 9),
  (code.match(/LEGACY_ACL_SECTIONS\s*=\s*\[[^\n]*/) || [''])[0]);
r.ok('and iterates THAT, not the live SECTION_KEYS',
  /LEGACY_ACL_SECTIONS\.length/.test(mar) && !/SECTION_KEYS/.test(mar),
  (mar.match(/[^\n]*SECTION_KEYS[^\n]*/g) || ['none']));
r.ok('the report says out loud which list it is reading against',
  /HISTORICAL nine-section list/.test(mar));
const ist = fnBody('importSingleTab');
r.ok('importSingleTab no longer writes a retired section id',
  !/'sec-i'/.test(ist) && !/'sec-h'/.test(ist),
  (ist.match(/[^\n]*sec-[hi][^\n]*/g) || ['none']));
r.ok('the legacy dispatch mapping points at the merged sec-g',
  /'sec-g'/.test(ist), (ist.match(/sec-g[^\n]*/) || [''])[0]);
// The TODO lives in a COMMENT, and `code` has comments stripped — so this one
// assertion reads the raw source. (The rest of this suite asserts on `code` on
// purpose: a comment naming a deleted function must not satisfy its own check.)
const istSrc = fnBody('importSingleTab', src);
r.ok('the unconditional appendRow is flagged rather than quietly left',
  /TODO/i.test(istSrc), (istSrc.match(/[^\n]*TODO[^\n]*/i) || [''])[0]);
// A hardcoded width in a report is a lie with a delay fuse: 'DEPARTMENTS → 15 cols'
// survived two widenings because no test asserted it.
r.ok('migrateAddColumns derives every width, with no hardcoded column count',
  !/→\s*\d+\s*cols/.test(code), (code.match(/[^\n]*→[^\n]*cols[^\n]*/g) || ['none']));
r.ok('and it prints the derived count', /DEPT_HEADS\.length \+ ' cols'/.test(code));

r.head('a legacy DEPARTMENTS tab is rebuilt, not silently reinterpreted');
// SECTION_KEYS shrinking re-letters EVERY column: an existing 14-column tab read
// positionally would map old col 4 (sec-a's grant) onto new col 4 (sec-b's grant),
// and old col 10 (old sec-g) onto 'Updated At'. Silent misgrant, letter by letter.
const dts = fnBody('deptTabShape');
r.ok('deptTabShape exists', dts.length > 150, dts.length);
r.ok('it distinguishes absent / current / legacy-9 / unknown',
  ['absent', 'current', 'legacy-9', 'unknown'].every(s => dts.includes("'" + s + "'")),
  (dts.match(/'[a-z0-9-]+'/g) || []));
r.ok('legacy-9 is recognised by comparing against the historical nine-key list',
  /LEGACY_DEPT_SECTIONS/.test(dts) && /LEGACY_DEPT_SECTIONS\s*=\s*\[/.test(code));
r.ok('migrateAddColumns refuses to widen a tab it does not recognise',
  /deptTabShape\(/.test(fnBody('migrateAddColumns')) && /LEFT ALONE/.test(fnBody('migrateAddColumns')),
  (fnBody('migrateAddColumns').match(/[^\n]*LEFT ALONE[^\n]*/g) || []));
r.ok('seedDepartments consults it too', /deptTabShape\(/.test(fnBody('seedDepartments')));
r.ok('a legacy tab is snapshotted before it is rebuilt',
  /DEPARTMENTS_BACKUP_/.test(fnBody('seedDepartments')) || /DEPARTMENTS_BACKUP_/.test(code),
  (code.match(/DEPARTMENTS_BACKUP_[^\n]*/g) || []).slice(0, 2));

r.head('seedDepartments upserts and names what it drops');
// `have[key]` used to mean merely "present", so a half-granted row was never
// corrected. And the one thing a rewrite can silently lose is an existing grant
// the new mapping does not reproduce — so it is printed, loudly. This is the
// direct application of "a response is not a backup".
const sd = fnBody('seedDepartments');
r.ok('it compares the desired row against the existing one',
  /deltas/.test(sd), (sd.match(/[^\n]*deltas[^\n]*/) || []).slice(0, 2));
r.ok('it reports created / updated / unchanged', /created/.test(sd) && /updated/.test(sd) && /unchanged/.test(sd));
r.ok('it prints a DROPPED GRANTS section', /DROPPED GRANTS/.test(sd),
  (sd.match(/[^\n]*DROPPED GRANTS[^\n]*/) || [''])[0]);
r.ok('and it lists what was dropped, not merely that something was',
  /dropped\.push\(/.test(sd) && /dropped\.join/.test(sd));
r.ok('the mapping itself is a module-level literal recording whose call it was',
  /SEED_GRANTS\s*=\s*\{/.test(code) && /TRIAGE_DEPARTMENTS/.test(code),
  (code.match(/var SEED_GRANTS[^\n]*/) || [''])[0]);
// The owner gave ONE list for Purchase AND Inventory. Guessing which person belongs
// to which is exactly the "a wrong guess grants write access silently" failure the
// codebase's own comment forbids — and the two departments do NOT have equal grants
// (B/D/G vs D), so they cannot be merged either.
r.ok('Purchase and Inventory are not merged into one department',
  /'purchase'/.test(code) && /'inventory'/.test(code),
  (code.match(/SEED_GRANTS\s*=\s*\{[\s\S]{0,700}?\}/) || [''])[0].slice(0, 400));

r.head('seedMemberships only ever ADDS');
// setUserDepartments deletes then re-appends — correct for an admin editing one
// person, wrong for a seed that must not disturb edges added later.
const sm = fnBody('seedMemberships');
r.ok('it does not delete anything', !/deleteRow|clear\(/.test(sm),
  (sm.match(/[^\n]*(deleteRow|clear\()/) || ['none'])[0]);
r.ok('it skips what is already present', /present\[email \+ '\|' \+ key\]/.test(sm),
  (sm.match(/[^\n]*present\[[^\n]*/) || [''])[0]);
r.ok('it appends in one block rather than row by row',
  /setValues\(rows\)/.test(sm), (sm.match(/[^\n]*setValues[^\n]*/) || [''])[0]);
r.ok('and it says "nothing removed" in its report',
  /Nothing removed/.test(sm), (sm.match(/[^\n]*Nothing removed[^\n]*/) || [''])[0]);
r.ok('it names the people added who cannot sign in yet',
  /NOT YET SIGN-IN-ABLE/.test(sm), (sm.match(/[^\n]*SIGN-IN-ABLE[^\n]*/) || [''])[0]);
r.ok('it says the IQC/Compliance omission is intentional',
  /IQC and Compliance have no members/.test(sm));
r.ok('it names the Purchase/Inventory doubling as intentional too',
  /Purchase AND Inventory each list all three/.test(sm));

r.head('the run order is stated, and the merge is not pre-flight');
// The merge REWRITES rows the live app is currently reading. A migration that
// rewrites live rows cannot run pre-flight, full stop — the mirror image of the
// column-widening rationale. This asserts the banner still says so, in order.
const bannerAt = src.indexOf('Pre-flight (undeployed');
const banner = bannerAt < 0 ? '' : src.slice(bannerAt, bannerAt + 1400);
r.ok('the banner exists', banner.length > 200, banner.length);
r.ok('pre-flight is migrateAddColumns → migrateAclReport → bootstrapAdmin',
  /migrateAddColumns\(\)\s*→\s*migrateAclReport\(\)\s*→\s*bootstrapAdmin\(\)/.test(banner),
  (banner.match(/[^\n]*Pre-flight[^\n]*/) || [''])[0]);
r.ok('the cutover group is seedDepartments → seedMemberships → report → apply',
  /seedDepartments\(\)\s*→\s*seedMemberships\(\)/.test(banner) &&
  /mergeSectionsReport\(\)\s*→\s*mergeSectionsApply\(\)/.test(banner),
  (banner.match(/[^\n]*seedDepartments[^\n]*/) || [''])[0]);
r.ok('report comes BEFORE apply in the printed order',
  banner.indexOf('mergeSectionsReport') < banner.indexOf('mergeSectionsApply'),
  { report: banner.indexOf('mergeSectionsReport'), apply: banner.indexOf('mergeSectionsApply') });
r.ok('the two prunes are listed as post-go-live, not pre-flight',
  banner.indexOf('maintenancePruneSessions') > banner.indexOf('go-live'),
  (banner.match(/[^\n]*maintenancePruneSessions[^\n]*/) || [''])[0]);
r.ok('the banner says WHY the split exists, not just what to run',
  /rewrites live rows cannot be pre-flight|REWRITES rows the live app/.test(banner),
  (banner.match(/[^\n]*REWRITES[^\n]*/) || [''])[0]);
// The merge is index-based and destroys rows, so it locks — and unlike every earlier
// migration, it rewrites AND deletes. That combination is what the lock is for.
r.ok('mergeSectionsApply is the only migration that locks',
  /withRowLock/.test(fnBody('mergeSectionsApply')) && !/withRowLock/.test(fnBody('seedDepartments')) &&
  !/withRowLock/.test(fnBody('seedMemberships')));
r.ok('it guards idempotency before it touches anything',
  (() => {
    const b = fnBody('mergeSectionsApply');
    return b.indexOf('Already merged') > -1 && b.indexOf('Already merged') < b.indexOf('insertSheet');
  })(), (fnBody('mergeSectionsApply').match(/[^\n]*Already merged[^\n]*/) || [''])[0]);
r.ok('it refuses to overwrite an existing backup, so double-apply is impossible',
  /already exists/.test(fnBody('mergeSectionsApply')),
  (fnBody('mergeSectionsApply').match(/[^\n]*already exists[^\n]*/) || [''])[0]);
r.ok('the backup is the WHOLE snapshot, written in one call',
  /setValues\(data\)|setValues\(all\)/.test(fnBody('mergeSectionsApply')),
  (fnBody('mergeSectionsApply').match(/[^\n]*setValues[^\n]*/) || [''])[0]);
r.ok('there is an undo, and the undo is itself undoable',
  /function restoreAppDataFromBackup/.test(code) && /APP_DATA_PRE_RESTORE_/.test(code),
  (code.match(/APP_DATA_[A-Z_]*BACKUP_[^\n]*|APP_DATA_PRE_RESTORE_[^\n]*/g) || []).slice(0, 2));

r.head('the field-id wart is documented where it bites');
// Field ids are never renamed: they are also the anchors inside every __NUDGES__
// item and the Field ID of every historical AUDIT_LOG row. Renaming g_missionReport
// → f_missionReport would orphan every comment on it and split its audit history.
// So sec-f holds g_* and sec-g holds h_*/i_* — which only works because the
// frontend resolves a field id through an index built from SECTIONS.
r.ok('the merge deliberately keeps the ids as they are',
  /ids are never renamed|never renamed|No field-id renames/i.test(src),
  (src.match(/[^\n]*renamed[^\n]*/i) || [''])[0]);
r.ok('a collision would be reported, never silently resolved',
  /collisions/.test(code), (code.match(/[^\n]*collisions[^\n]*/) || ['']).slice(0, 2));
r.ok('DONE_MAP drops sec-a and never chains',
  /DONE_MAP\s*=\s*\{\s*'sec-a':\s*null/.test(code) &&
  /'sec-h':\s*'sec-g'/.test(code) && !/'sec-h':\s*'sec-f'/.test(code),
  (code.match(/var DONE_MAP[^\n]*/) || [''])[0]);

r.head('sec-g is two eras at once, and the planner knows it');
// THE regression this block exists for. After the merge, `sec-g` is the LIVE
// PDI/Dispatch section — and it is also a SOURCE for sec-f. A plain SEC_TARGET_MAP
// lookup therefore reads a freshly-merged PDI row as Flight Test data, so a SECOND run
// of the merge sweeps it into sec-f: silently, and the result still looks like a
// perfectly plausible sheet. A row's own field ids date it, because ids are never
// renamed (old Flight Test wrote g_*, the new Section G writes h_*/i_*).
r.ok('a row-aware classifier exists, and the group key uses it',
  /function mergeTargetFor/.test(code) && /mergeTargetFor\(data\[i\], sec\)/.test(code),
  (code.match(/[^\n]*mergeTargetFor[^\n]*/) || ['']).slice(0, 2));
r.ok('the naive per-section lookup is gone from the planner',
  !/function targetFor/.test(fnBody('planSectionMerge')) &&
  !/targetFor\(sec\)/.test(fnBody('planSectionMerge')),
  (fnBody('planSectionMerge').match(/[^\n]*targetFor\([^\n]*/) || [''])[0]);
r.ok('the classifier keys on g_* for sec-g, and defers every other id to the map',
  /indexOf\('g_'\) === 0/.test(fnBody('mergeTargetFor')) &&
  /secId !== 'sec-g'/.test(fnBody('mergeTargetFor')),
  fnBody('mergeTargetFor').slice(0, 160));
r.ok('a sec-g row with no field to date it is REPORTED, never guessed at',
  /ambiguous/.test(fnBody('planSectionMerge')) && /ambiguous:\s*\[\]/.test(fnBody('planSectionMerge')) &&
  /ERA-AMBIGUOUS/.test(fnBody('describeMergePlan')),
  (fnBody('describeMergePlan').match(/[^\n]*AMBIGUOUS[^\n]*/) || [''])[0]);
// The skip is what makes a re-run an EMPTY plan rather than one that rewrites every
// already-merged row — so the guard below it can actually fire. It must run before
// anything is pushed onto the plan.
r.ok('a group with nothing to merge is skipped, before any survivor is planned',
  (() => {
    const b = fnBody('planSectionMerge');
    const skip = b.indexOf('sourceRows.length === 0 && targetRows.length <= 1');
    const push = b.indexOf('plan.survivors.push');
    return skip > -1 && push > -1 && skip < push;
  })(), (fnBody('planSectionMerge').match(/[^\n]*targetRows\.length <= 1[^\n]*/) || [''])[0]);
r.ok('the idempotency guard tests BOTH counts, not deletes alone',
  /plan\.survivors\.length === 0 && plan\.deletes\.length === 0/.test(fnBody('mergeSectionsApply')),
  (fnBody('mergeSectionsApply').match(/[^\n]*survivors\.length === 0[^\n]*/) || [''])[0]);

r.head('every editor-facing report is LOGGED, not merely returned');
// The Apps Script editor's execution log shows only what the code logs — a returned
// value is never displayed. So a function that only returns its report is, to the
// human running it from the function dropdown, indistinguishable from one that did
// nothing: "Execution completed" and no `dropped` grant list, no merge plan, no
// ERA-AMBIGUOUS block, no backup tab name, no one-time admin password. Every one of
// those is a thing the operator must READ to run the cutover safely.
//
// This is the same failure mode as the `→ 15 cols` strings that rotted: a report
// nobody can read is worse than no report, and nothing asserted it.
r.ok('report() exists and both logs and returns',
  /function report\(msg\)\s*\{[\s\S]{0,200}console\.log\(msg\)[\s\S]{0,100}return msg;/.test(code),
  (code.match(/[^\n]*function report\(msg\)[^\n]*/) || [''])[0]);

// Every editor-facing function that produces a report must route every one of its
// report returns through report(). Checked per-function on the real source, so a
// new early-return cannot slip in unlogged. `describeMergePlan` is exempt: it is a
// helper whose caller logs, and `migrateAclReport` logs directly (it predates
// report() and its output is the one the owner must paste somewhere private).
const REPORTING_FNS = ['migrateAddColumns', 'seedDepartments', 'seedMemberships',
  'mergeSectionsReport', 'mergeSectionsApply', 'restoreAppDataFromBackup',
  'bootstrapAdmin', 'maintenancePruneSessions', 'maintenancePruneAuditLog'];
const unlogged = REPORTING_FNS.filter(fn => {
  const body = fnBody(fn);
  if (!body || !/report\(/.test(body)) return true;
  if (!/return\s+(['"])/.test(body)) return false;   // no bare report return at all
  // A LOCKED function's inner early-returns are values handed up to the single
  // outer `return report(withRowLock(fn))`, so a bare return inside one IS logged.
  // Outside that shape, a bare `return '…'` never reaches the log.
  return !/return report\(withRowLock\(function/.test(body);
});
r.ok('no editor-facing function returns a report string unlogged',
  unlogged.length === 0, unlogged);

r.ok('the locked functions wrap the WHOLE call, not each inner return',
  ['mergeSectionsApply', 'restoreAppDataFromBackup', 'maintenancePruneAuditLog']
    .every(fn => /^function \w+\(\) \{\r?\n  return report\(withRowLock\(function/.test(
      (code.slice(code.indexOf('function ' + fn + '()'))))),
  // Wrapping the outer call is what makes every early refusal inside the lock
  // visible too — wrapping the inner returns instead would leave the "Already
  // merged" and "Refusing: … already exists" paths silent.
  'the refusals inside the lock are the messages that matter most');

r.ok('report() is called for the refusal paths too, not just the happy path',
  /if \(!email\) return report\(/.test(fnBody('bootstrapAdmin')) &&
  /if \(shape === 'unknown'\)[\s\S]{0,400}return report\(/.test(fnBody('seedDepartments')),
  'a swallowed "refusing to touch DEPARTMENTS" is the message that matters most');

r.finish();
