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
r.ok('it consults the department grants', /departmentEditGrants|getUserDepartments/.test(gea));
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
  /function departmentEditGrants/.test(code) && /function getUserDepartments/.test(code));

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

r.head('the section keys are the nine the frontend uses');
const keys = (code.match(/SECTION_KEYS\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
const list = keys.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
r.ok('nine section keys', list.length === 9, list);
r.ok('they are sec-a … sec-i in order',
  list.join(',') === 'sec-a,sec-b,sec-c,sec-d,sec-e,sec-f,sec-g,sec-h,sec-i', list);

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
// The three index-based destructive paths must actually use it, and the read
// snapshot must be INSIDE the lock or the lock buys nothing.
['purgeUsers', 'deleteDepartment', 'setUserDepartments'].forEach(fn => {
  const body = fnBody(fn);
  r.ok(fn + ' is wrapped in withRowLock', /withRowLock\(/.test(body));
  r.ok(fn + ' takes its snapshot inside the lock',
    body.indexOf('withRowLock') < body.indexOf('getDataRange'),
    { lock: body.indexOf('withRowLock'), read: body.indexOf('getDataRange') });
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

r.finish();
