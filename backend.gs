// ============================================================
//  I-PASSBOOK — Google Apps Script Backend (backend.gs)
//  Deploy as: Web App → Execute as: Me → Who has access: Anyone
// ============================================================

// ──────────────────────────────────────────────────────────────────────────────
// CONFIG — Update these Sheet IDs before deploying
// ──────────────────────────────────────────────────────────────────────────────
var CONFIG = {
  // The IR Repository sheet (Form Responses tab) — source of new IR records
  IR_REPO_SHEET_ID: '1MPcWvgZxqiTWJMLs1dksmS9q9I14SYOgr8sWn8FelG4',
  IR_REPO_TAB:      'Form Responses',   // IR records (Col G = What Support, Col H = Description)
  IR_REPO_IR_COL:        2,   // Column B  — "IR Number"
  IR_REPO_ID_COL:        11,   // Column K  — "Mention the Drone Serial No (S250XX)"
  IR_REPO_SUMLINK_COL:   1,   // Column A  — "Summary"
  IR_REPO_DATE_COL:       3,   // Column C  — "Timestamp"
  IR_REPO_STATUS_COL:     4,  // Column D  — "Issue Status"
  IR_REPO_SPOC_COL:       6,   // Column F  — "SPOC"
  IR_REPO_SUPPORT_COL:    7,   // Column G  — "What Support Is Required?"
  IR_REPO_DESC_COL:       8,   // Column H  — "Please Describe Your Problem..."
  IR_REPO_INCIDENT_COL:   9,   // Column I  — "Date of Incident"
  IR_REPO_REPORTER_COL:  12,   // Column L  — "Who's Reporting? (Name & Contact)"
  IR_REPO_EMAIL_COL:      16,   // Column P  — "Email Address"
  IR_REPO_INCIDENT_LOC_COL: 13, // Column M  — "Incident Location and Weather"
  IR_REPO_EVIDENCE_N_COL:   14, // Column N  — "Evidence: Attach Files From The Incident"
  IR_REPO_EVIDENCE_Q_COL:   17, // Column Q  — "Evidence: Attach Screenshot of UAV Forecast..."
  IR_REPO_COMPANY_COL:      18, // Column R  — "Where Do You Work?"

  // The I-PASSBOOK App Data sheet ("I-Passbook App Repository") — APP_DATA tab
  // holds all saved section data. NOTE: the *deployed* backend is an older
  // build than this file; keep this ID in sync with the live deployment.
  PASSBOOK_SHEET_ID: '141L8Wt4hrvJmN3dTtnI8VDK76NutK_7KZ_jbM2qEOwQ',
  DATA_TAB:          'APP_DATA',  // Web App data goes here

  // Google Drive root folder for IR uploads — "I-PASSBOOK APP" folder in the
  // customer.relations@indrones.com Drive. The account that deploys this script
  // (Execute as: Me) MUST have Editor access to this folder.
  //
  // This address is the FOLDER'S OWNER, not an app account: it is no longer in
  // ADMIN_EMAILS and no longer has a USERS row. Do not "tidy" this line away —
  // the ID below resolves only for a deployer who has been granted access to that
  // specific folder, and the note is how they know which one to ask for.
  DRIVE_ROOT_FOLDER_ID: '1sc9mXOHPaWW1wiVvtDmyYLflGUogtm06',

  ALLOWED_DOMAIN: 'indrones.com',

  // Bump this whenever the action set or a response shape changes. `ping` reports
  // it, so a cached frontend talking to a newer backend (or vice versa) can say so
  // in words a human can act on instead of failing as "Unknown action".
  API_VERSION: 2,

  // The ONE admin. Admins bypass every permission check and are the only accounts
  // that can provision people, set department grants or reset passwords. Must
  // match the frontend ADMIN_EMAILS.
  ADMIN_EMAILS: ['monish.raza@indrones.com'],

  // Session lifetime (DAYS). Minted at sign-in and SLID forward on use, so an
  // active user is never signed out — matching how a Google Workspace web session
  // behaves (default 14 days, admin-settable to 30). The frontend keeps the token
  // in localStorage, so reopening the app resumes the session with no sign-in.
  // Bounds how long a (possibly stolen) token stays valid.
  SESSION_DAYS: 30,

  // How stale a session's Last Seen At may get before lookupSession rewrites its
  // Expires At (the "slide"). The frontend polls comments every 90s, so an
  // unthrottled slide would be ~40 sheet writes per hour per user; 6h caps it at
  // <=1 write per 6h while still sliding long before the 30-day expiry.
  SESSION_SLIDE_HOURS: 6,

  // A temporary password handed over by the admin stops being a credential after
  // this many days, whether or not it was ever used. The forced first-login change
  // handles "it lives forever"; this handles "it was read off a WhatsApp message".
  TEMP_PW_TTL_DAYS: 14,

  // NON-Indrones addresses that are allowed to exist as accounts. There is no
  // self-signup any more, so this is NOT an allowlist — it exists so the
  // @indrones.com recipient guard in sendNudgeEmail doesn't silently lock these
  // people out of their own comment notifications. Add one email per line.
  EXTERNAL_EMAILS: [
    'kishor.salunkhe@uavgarage.com',
  ],

  // Legacy I-PASSBOOK sheet (the pre-app workbook used till ~IR441). Each IR is
  // its own tab named like "IR310 | S25P023". Surfaced read-only in the app so
  // the team doesn't have to look in two places. Tabs not matching /^IR\d+/
  // (Flow chart, index, format) are ignored.
  LEGACY_SHEET_ID: '14VnWnCg-W7I8Vv97amhuwfSqiozictVMivO3F9Bed5s',
};

// ──────────────────────────────────────────────────────────────────────────────
// ENTRY POINTS
// ──────────────────────────────────────────────────────────────────────────────
// AUTH — verify the caller by a server-issued, revocable session token.
// The token is minted at sign-in (doLoginPassword) or after the forced first
// password change (changePassword) and stored on the SESSIONS tab; the frontend
// persists it and attaches it to every call. The caller's email is read FROM the
// token (never from a client param), so an identity can't be spoofed by passing a
// known email. No Google ID token is involved anywhere — this backend makes no
// outbound network calls (so it needs no script.external_request scope).
function requireAuth(e) {
  var st = (e.parameter.sessionToken || '').toString().trim();
  if (st) return lookupSession(st);
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// USERS + PASSWORD AUTH (admin-provisioned accounts)
// ──────────────────────────────────────────────────────────────────────────────
// There is NO self-signup. The admin creates every account from the app, which
// returns a one-time temporary password the admin hands over out-of-band. On
// first sign-in the user is FORCED to set their own password before any session
// is minted (see changePassword). Passwords are stored as SHA-256(salt+password)
// with a per-account random salt — the plain password is never stored, and a
// temporary password reaches the sheet only as a hash plus an issued-at stamp.
//
// Everyone who signs in gets VIEW + COMMENT on all nine sections by default;
// EDIT comes only from department membership (see getEffectiveAccess).

// Per-execution Sheet memo. Apps Script gives every execution a fresh global
// scope, so this cannot leak an open Sheet across requests — it only stops
// doPost from paying openById() two or three times in the same request.
var _ssMemo = null;
function getSs() {
  if (!_ssMemo) _ssMemo = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  return _ssMemo;
}

// Widen a tab's header row IN PLACE without touching a single data row. Columns
// are append-only by design (positional readers such as doLoginPassword read
// row[1]/row[2]), so this is the whole migration for an existing tab. Safe to
// call on every getOrCreate*, and a no-op once the header already matches.
function ensureHeaders(tab, heads) {
  var have = tab.getLastColumn();
  var row = have > 0 ? tab.getRange(1, 1, 1, have).getValues()[0] : [];
  var same = row.length === heads.length;
  if (same) {
    for (var i = 0; i < heads.length; i++) {
      if (String(row[i]) !== heads[i]) { same = false; break; }
    }
  }
  if (same) return tab;
  tab.getRange(1, 1, 1, heads.length).setValues([heads]);
  tab.getRange(1, 1, 1, heads.length).setFontWeight('bold').setBackground('#0E62FF').setFontColor('#ffffff');
  tab.setFrozenRows(1);
  return tab;
}

// Column order is a CONTRACT: A–E are read positionally by doLoginPassword and
// the forced-change path, so never reorder them — append only.
var USER_HEADS = ['Email', 'PasswordHash', 'Salt', 'Created At', 'Created By',
                  'Must Change Password', 'Password Changed At', 'Status',
                  'Name', 'Last Login At', 'Temp Password Issued At'];
// Columns B..H — hash, salt, Created At, Created By, Must Change Password,
// Password Changed At, Status. The block every password write touches at once.
var USER_ID_BLOCK_COLS = 7;

function getOrCreateUsersTab(ss) {
  var tab = ss.getSheetByName('USERS');
  if (!tab) tab = ss.insertSheet('USERS');
  return ensureHeaders(tab, USER_HEADS);
}

// SHA-256 digest of (salt + password), returned as a lowercase hex string.
// Utilities.computeDigest returns signed-byte arrays, so normalize to hex.
function hashPassword(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + String(password));
  return raw.map(function (b) {
    var h = (b < 0 ? b + 256 : b).toString(16);
    return h.length < 2 ? '0' + h : h;
  }).join('');
}

// Find a USERS row by email (case-insensitive). Returns the row values or null.
function findUserRow(ss, email) {
  email = (email || '').toLowerCase().trim();
  var data = getOrCreateUsersTab(ss).getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === email) return data[i];
  }
  return null;
}

// Same lookup, but returns the 1-indexed SHEET row number (0 = not found).
function findUserRowIndex(ss, email) {
  email = (email || '').toLowerCase().trim();
  var data = getOrCreateUsersTab(ss).getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === email) return i + 1;
  }
  return 0;
}

// Read one optional USERS column by its header name, tolerant of a row shorter
// than the header (getDataRange returns rows only as wide as the last column,
// so an un-widened tab yields undefined rather than throwing).
function userCol(row, name) {
  var i = USER_HEADS.indexOf(name);
  return (i >= 0 && row && i < row.length) ? String(row[i] == null ? '' : row[i]).trim() : '';
}

// Mint a fresh session token for an email and append it to SESSIONS.
function mintSession(email) {
  var tab   = getOrCreateSessionsTab(getSs());
  var token = Utilities.getUuid();
  var now   = new Date();
  var exp   = new Date(now.getTime() + CONFIG.SESSION_DAYS * 24 * 60 * 60 * 1000);
  tab.appendRow([token, email, now, exp, '', now, '']);
  // Opportunistic prune of long-expired rows — never from inside lookupSession,
  // where a delete would race the row scan it is iterating.
  try { pruneSessions(); } catch (e) { /* non-fatal */ }
  return token;
}

// Serialise a read-snapshot-then-mutate-rows sequence.
//
// Every deleteRow() in this file is index-based and every index comes from a
// getValues() snapshot taken earlier. Deleting bottom-up keeps OUR OWN deletes
// from invalidating each other, but it does nothing about a CONCURRENT writer: if
// another admin appends or deletes a row between our snapshot and our deletes,
// every index below it shifts and we delete the wrong row — silently. In
// purgeUsers that is unrecoverable.
//
// Apps Script has no transactions and SpreadsheetApp has no row identity, so a
// script lock is the only mutual exclusion available. It is applied to the
// destructive admin paths, where a mis-indexed delete cannot be undone. The
// ordinary write paths (saveSection, comments) are deliberately NOT locked — they
// append and overwrite by scanned key rather than by remembered index, and
// serialising every save would make the app slower for no safety gain.
function withRowLock(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    // Could not get the lock: refuse rather than proceed unprotected. For a
    // destructive action, "try again in a moment" is the correct answer.
    return { status: 'error', message: 'The backend is busy with another admin change — try again in a moment.' };
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* execution ending anyway */ }
  }
}

// Revoke every session belonging to an email. Called on password change/reset and
// when an account is disabled — the cheap alternative to checking Status on every
// single authenticated request.
function revokeAllSessions(email) {
  email = (email || '').toLowerCase().trim();
  if (!email) return 0;
  var tab = getOrCreateSessionsTab(getSs());
  var data = tab.getDataRange().getValues();
  var now = new Date();
  var n = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase().trim() !== email) continue;
    if (!String(data[i][0])) continue;
    tab.getRange(i + 1, 5).setValue('revoked');
    tab.getRange(i + 1, 7).setValue(now);
    n++;
  }
  return n;
}

// Delete SESSIONS rows that expired more than 7 days ago. Bottom-up so earlier
// deletes don't shift the indices of later ones.
function pruneSessions() {
  var tab = getOrCreateSessionsTab(getSs());
  var data = tab.getDataRange().getValues();
  var cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  for (var i = data.length - 1; i >= 1; i--) {
    if (!String(data[i][0])) { tab.deleteRow(i + 1); continue; }
    var exp = data[i][3] ? new Date(data[i][3]) : null;
    if (exp && exp < cutoff) tab.deleteRow(i + 1);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// TEMPORARY PASSWORDS (admin hands these over; the sheet only ever sees a hash)
// ──────────────────────────────────────────────────────────────────────────────
// 5 letters + '-' + 4 digits, e.g. "Kx7Qm-4392". The alphabet drops I, O, 0 and 1
// because these are read off a screen and typed by hand — the ambiguous glyphs
// are the ones that produce "wrong password" support calls.
var TEMP_PW_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
var TEMP_PW_DIGITS  = '23456789';

function makeTempPassword() {
  var out = '';
  for (var i = 0; i < 5; i++) out += TEMP_PW_LETTERS.charAt(Math.floor(Math.random() * TEMP_PW_LETTERS.length));
  out += '-';
  for (var j = 0; j < 4; j++) out += TEMP_PW_DIGITS.charAt(Math.floor(Math.random() * TEMP_PW_DIGITS.length));
  return out;
}

// Create a USERS row with a temp password. Returns the plaintext ONCE — it is
// never written anywhere and cannot be recovered afterwards.
function createUserRow(email, name, createdBy) {
  var ss  = getSs();
  var tab = getOrCreateUsersTab(ss);
  var pw  = makeTempPassword();
  var salt = Utilities.getUuid();
  var now  = new Date();
  tab.appendRow([email, hashPassword(pw, salt), salt, now, createdBy,
                 'yes', '', 'active', name || '', '', now]);
  return pw;
}

// ──────────────────────────────────────────────────────────────────────────────
// RESET CODES — one generic store for the forgot-password flow. No external calls.
// ──────────────────────────────────────────────────────────────────────────────
// Replaces the old PENDING_SIGNUPS (sign-up is gone) with a single-purpose store
// for emailed 6-digit codes. `Attempts` is the important column: without it a
// 6-digit code is a million guesses against an endpoint anyone can reach, so a
// code dies after CODE_MAX_ATTEMPTS wrong tries regardless of its TTL.
var CODE_TTL_MIN        = 15;
var CODE_RESEND_GAP_MS  = 60 * 1000;   // min gap between code (re)issues per email
var CODE_MAX_PER_HOUR   = 3;           // throttle: codes issued per email per hour
var CODE_MAX_PER_HOUR_GLOBAL = 12;     // throttle: codes issued across ALL emails per hour
var CODE_MAX_ATTEMPTS   = 5;           // wrong guesses before the code is burned
var MAIL_DAILY_CAP      = 400;         // ceiling on ALL app-sent mail per day (see mailQuotaOk)

var CODE_HEADS = ['Email', 'Code', 'Purpose', 'Created At', 'Expires At', 'Attempts', 'Used'];

function getOrCreateCodesTab(ss) {
  var tab = (ss || getSs()).getSheetByName('CODES');
  if (!tab) tab = (ss || getSs()).insertSheet('CODES');
  return ensureHeaders(tab, CODE_HEADS);
}

// 6-digit numeric code (100000–999999). GAS server runtime: Math.random is fine.
function makeResetCode() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

// Daily mail ceiling, covering EVERY mail this script sends. MailApp quota is
// per-script and shared, so an uncapped path does not merely annoy — it burns the
// day's quota and silently disables every OTHER mail, including the reset code
// that is the only way back into a locked account.
//
// `kind` is the caller's class, and it exists so that a busy comment day cannot
// starve password resets: 'nudge' (comment notifications, the high-volume path)
// stops short of the ceiling, leaving MAIL_AUTH_RESERVE slots that only auth mail
// may spend. Everything else — auth, and any future caller that forgets to pass a
// kind — may use the whole ceiling.
//
// This used to be reachable only from sendAuthMail, which meant the cap covered
// the low-volume path and left the high-volume one open: any signed-in user could
// loop sendNudgeEmail and take out password recovery for the whole company.
var MAIL_AUTH_RESERVE = 40;

function mailQuotaOk(kind) {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var key   = 'mailcount:' + today;
  var n = Number(props.getProperty(key) || 0);
  var ceiling = (kind === 'nudge') ? Math.max(0, MAIL_DAILY_CAP - MAIL_AUTH_RESERVE) : MAIL_DAILY_CAP;
  if (n >= ceiling) return false;
  props.setProperty(key, String(n + 1));
  return true;
}

// Send one auth email. Returns true on success; never throws (a mail failure must
// not turn into a 500 that reveals whether the account exists).
function sendAuthMail(to, subject, body) {
  if (!mailQuotaOk('auth')) return false;
  try {
    MailApp.sendEmail(to, subject, body, { name: 'I-PASSBOOK' });
    return true;
  } catch (e) { return false; }
}

// Return [rowValues, rowIndex] for the newest live code for an email+purpose.
function findCodeRow(ss, email, purpose) {
  email = (email || '').toLowerCase().trim();
  var tab  = getOrCreateCodesTab(ss);
  var data = tab.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).toLowerCase().trim() !== email) continue;
    if (String(data[i][2]) !== purpose) continue;
    if (String(data[i][6]).toLowerCase() === 'yes') continue;   // already used
    return [data[i], i + 1];
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// PASSWORD LIFECYCLE — forced first change, forgot, reset
// ──────────────────────────────────────────────────────────────────────────────

// ── TEMP-PASSWORD FRESHNESS: ONE GATE, EVERY ENTRY POINT ─────────────────────
// A temp password is a credential the admin reads off a screen and sends by chat,
// so it must stop working on a clock. That check lives here, in ONE place, and is
// called from every endpoint that accepts a temp password as proof of identity:
// doLoginPassword AND changePassword.
//
// It used to live only in doLoginPassword. changePassword is unauthenticated and
// takes the same credential, so an expired temp password could be posted straight
// to it: it verified the hash, then minted a full 30-day session. The TTL was
// decorative — it closed the login door while the change-password door stood open
// beside it. If a third endpoint ever accepts this credential, call these too.
function isTempPasswordAccount(row) {
  return String(userCol(row, 'Must Change Password')).toLowerCase() === 'yes';
}

// Returns an error object when the temp password is past its life, else null.
function tempPasswordExpired(row) {
  var issued = userCol(row, 'Temp Password Issued At');
  if (!issued) return null;                 // never stamped → never expires
  var ageDays = (Date.now() - new Date(issued).getTime()) / 86400000;
  if (ageDays > CONFIG.TEMP_PW_TTL_DAYS) {
    return { status: 'error', message: 'That temporary password has expired — ask an admin to issue a new one.' };
  }
  return null;
}

// POST changePassword — the forced first-login change, and the ordinary one.
// Unauthenticated by design: a temp-password holder has NO session token (see
// doLoginPassword), so the credential being presented IS the password itself.
// That makes this endpoint exactly as guessable as login, so it shares login's
// lockout rather than inventing a second, weaker throttle.
function changePassword(params) {
  var email    = (params.email || '').toString().toLowerCase().trim();
  var current  = (params.currentPassword || '').toString();
  var next     = (params.newPassword || '').toString();
  if (!email || !current || !next) return { status: 'error', message: 'Enter your email, current password and a new password.' };
  if (next.length < 8) return { status: 'error', message: 'New password must be at least 8 characters.' };
  if (next === current) return { status: 'error', message: 'New password must be different from the current one.' };

  var ss = getSs();
  var locked = lockoutRemaining(ss, email);
  if (locked) return locked;

  var row = findUserRow(ss, email);
  // Generic on purpose: "no account" and "wrong password" must be the same
  // response, or this endpoint enumerates who has an I-PASSBOOK account.
  if (!row) { recordFailedLogin(ss, email); return { status: 'error', message: 'Email or password is incorrect.' }; }
  if (String(userCol(row, 'Status')).toLowerCase() === 'disabled') {
    return { status: 'error', message: 'This account has been disabled. Ask an admin to re-enable it.' };
  }
  // The temp-password clock applies HERE TOO — see the note above. Without this
  // line an expired temp password still buys a session through this door.
  if (isTempPasswordAccount(row)) {
    var stale = tempPasswordExpired(row);
    if (stale) return stale;
  }
  if (hashPassword(current, String(row[2])) !== String(row[1])) {
    var until = recordFailedLogin(ss, email);
    if (until) return { status: 'error', message: 'Wrong password. Account locked for ' + Math.round(LOGIN_LOCK_MS / 60000) + ' min after too many attempts.' };
    return { status: 'error', message: 'Email or password is incorrect.' };
  }

  var idx  = findUserRowIndex(ss, email);
  var salt = Utilities.getUuid();
  var tab  = getOrCreateUsersTab(ss);
  var now  = new Date();
  // One write for the whole identity block — columns B..H, i.e. hash, salt, the
  // preserved Created At/By, and every flag that must flip together with them.
  tab.getRange(idx, 2, 1, USER_ID_BLOCK_COLS).setValues([[
    hashPassword(next, salt), salt, row[3] || now, row[4] || '', '', now, 'active'
  ]]);
  clearFailedLogin(ss, email);
  // Any session the temp password ever minted dies here. (It shouldn't have been
  // able to mint one, but a revoked-anything is cheaper than trusting that.)
  revokeAllSessions(email);
  var token = mintSession(email);
  return { status: 'ok', sessionToken: token, email: email, mustChangePassword: false, access: getMyAccess(email) };
}

// POST forgotPassword — email a 6-digit reset code. Deliberately GENERIC: the
// response is byte-identical whether or not the account exists, so this cannot be
// used to enumerate who has an I-PASSBOOK account.
function forgotPassword(params) {
  var email = (params.email || '').toString().toLowerCase().trim();
  var generic = { status: 'ok', message: 'If that email has an account, a reset code is on its way.' };
  if (!email) return { status: 'error', message: 'Enter your email.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return generic;

  try {
    var ss  = getSs();
    var row = findUserRow(ss, email);
    if (!row) return generic;                       // no enumeration
    if (String(userCol(row, 'Status')).toLowerCase() === 'disabled') return generic;

    var tab  = getOrCreateCodesTab(ss);
    var data = tab.getDataRange().getValues();
    var now  = new Date();
    var hourAgo = now.getTime() - 60 * 60 * 1000;
    var recent = 0, newestMs = 0, recentAnyEmail = 0;
    for (var i = data.length - 1; i >= 1; i--) {
      var createdMs = data[i][3] ? new Date(data[i][3]).getTime() : 0;
      if (createdMs > hourAgo) recentAnyEmail++;
      if (String(data[i][0]).toLowerCase().trim() !== email) continue;
      if (createdMs > hourAgo) recent++;
      if (createdMs > newestMs) newestMs = createdMs;
    }
    if (recent >= CODE_MAX_PER_HOUR) return generic;                 // throttled — same answer
    if (newestMs && (now.getTime() - newestMs) < CODE_RESEND_GAP_MS) return generic;
    // A SECOND, GLOBAL ceiling. The per-email throttle above is the one a person
    // can hit by accident; this is the one that stops an unauthenticated caller
    // walking the whole staff list and pulling 3 codes per address — ~20 addresses
    // × 3 would spend the day's entire mail budget inside an hour, and because the
    // response is generic nobody would notice the reset mail had stopped.
    // (GAS web apps expose no reliable client IP, so this is global rather than
    // per-source. Normal traffic is a handful of resets an hour.)
    if (recentAnyEmail >= CODE_MAX_PER_HOUR_GLOBAL) return generic;

    var code = makeResetCode();
    // Retire any earlier live code so only the newest one can be redeemed.
    for (var j = 1; j < data.length; j++) {
      if (String(data[j][0]).toLowerCase().trim() === email && String(data[j][2]) === 'reset'
          && String(data[j][6]).toLowerCase() !== 'yes') {
        tab.getRange(j + 1, 7).setValue('yes');
      }
    }
    tab.appendRow([email, code, 'reset', now, new Date(now.getTime() + CODE_TTL_MIN * 60 * 1000), 0, '']);
    sendAuthMail(email, 'Your I-PASSBOOK password reset code',
      'Your I-PASSBOOK password reset code is ' + code + '.\n\n' +
      'It expires in ' + CODE_TTL_MIN + ' minutes. If you did not ask to reset your password, ' +
      'you can ignore this email — your current password still works.');
  } catch (e) { /* never reveal a failure — same generic answer */ }
  return generic;
}

// POST resetPassword — redeem a reset code and set a new password. Returns NO
// session token: the user signs in with the password they just chose, which is
// what proves it was typed correctly (and matches what they'll type next time).
function resetPassword(params) {
  var email = (params.email || '').toString().toLowerCase().trim();
  var code  = (params.code || '').toString().trim();
  var next  = (params.newPassword || '').toString();
  if (!email || !code || !next) return { status: 'error', message: 'Enter your email, the code and a new password.' };
  if (next.length < 8) return { status: 'error', message: 'New password must be at least 8 characters.' };

  var ss = getSs();
  var found = findCodeRow(ss, email, 'reset');
  if (!found) return { status: 'error', message: 'No reset code is outstanding for this email — request a new one.' };

  var tab = getOrCreateCodesTab(ss);
  var row = found[0], idx = found[1];
  var expires = row[4] ? new Date(row[4]) : null;
  if (expires && expires < new Date()) {
    tab.getRange(idx, 7).setValue('yes');
    return { status: 'error', message: 'That code expired — request a new one.' };
  }
  if (String(row[1]).trim() !== code) {
    var tries = (Number(row[5]) || 0) + 1;
    if (tries >= CODE_MAX_ATTEMPTS) {
      tab.getRange(idx, 7).setValue('yes');   // burn it — a 6-digit code gets 5 guesses
      return { status: 'error', message: 'Too many wrong codes — request a new one.' };
    }
    tab.getRange(idx, 6).setValue(tries);
    return { status: 'error', message: 'Wrong code. ' + (CODE_MAX_ATTEMPTS - tries) + ' attempt(s) left.' };
  }

  var uidx = findUserRowIndex(ss, email);
  if (!uidx) return { status: 'error', message: 'No account found for this email.' };
  var urow = findUserRow(ss, email);
  // A disabled account stays disabled. Without this, "Disable" was reversible by
  // the person it was aimed at: forgotPassword refuses to ISSUE a code to a
  // disabled account, but a code issued shortly BEFORE the disable is still live
  // for its full window — redeeming it used to flip Status back to 'active' and
  // hand them a working password. Offboarding a person mid-reset is exactly the
  // case that hits this, so the guard is on the redeem, not just the issue.
  if (String(userCol(urow, 'Status')).toLowerCase() === 'disabled') {
    return { status: 'error', message: 'This account has been disabled. Ask an admin to re-enable it.' };
  }
  var salt = Utilities.getUuid();
  var now  = new Date();
  // Status is PRESERVED, never written as a literal 'active' — this endpoint has
  // no business changing whether an account is enabled.
  getOrCreateUsersTab(ss).getRange(uidx, 2, 1, USER_ID_BLOCK_COLS)
    .setValues([[hashPassword(next, salt), salt, urow[3] || now, urow[4] || '',
                 '', now, userCol(urow, 'Status') || 'active']]);
  tab.getRange(idx, 7).setValue('yes');      // consume the code
  clearFailedLogin(ss, email);
  revokeAllSessions(email);                  // a reset signs every other device out
  return { status: 'ok', message: 'Password set. Sign in with your new password.' };
}

// ──────────────────────────────────────────────────────────────────────────────
// LOGIN LOCKOUT — brute-force guard (matters on a shared/handed-off device).
// ──────────────────────────────────────────────────────────────────────────────
// After MAX wrong passwords within a rolling window, the account is locked for
// LOCK_MIN. Tracked per email in LOGIN_ATTEMPTS. Successful login clears it.
var LOGIN_MAX_FAILS = 5;
var LOGIN_WINDOW_MS = 10 * 60 * 1000;   // 10-min rolling window
var LOGIN_LOCK_MS   = 15 * 60 * 1000;   // 15-min lockout

function getOrCreateAttemptsTab(ss) {
  var tab = ss.getSheetByName('LOGIN_ATTEMPTS');
  if (!tab) {
    tab = ss.insertSheet('LOGIN_ATTEMPTS');
    tab.getRange(1, 1, 1, 4).setValues([['Email', 'Fail Count', 'Window Start', 'Locked Until']]);
    tab.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#0E62FF').setFontColor('#ffffff');
    tab.setFrozenRows(1);
  }
  return tab;
}

// Return [rowValues, rowIndex] for an email's attempt record, or null.
function findAttemptRow(ss, email) {
  var tab = getOrCreateAttemptsTab(ss);
  var data = tab.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === email) return [data[i], i + 1];
  }
  return null;
}

// Record a failed attempt. Returns the lockout-until Date (null = not locked).
function recordFailedLogin(ss, email) {
  var tab = getOrCreateAttemptsTab(ss);
  var now = new Date();
  var existing = findAttemptRow(ss, email);
  var count = 1, windowStart = now, lockedUntil = null;
  if (existing) {
    var row = existing[0];
    var ws = row[2] ? new Date(row[2]) : now;
    if ((now.getTime() - ws.getTime()) > LOGIN_WINDOW_MS) { count = 1; windowStart = now; }
    else { count = (Number(row[1]) || 0) + 1; windowStart = ws; }
    if (count >= LOGIN_MAX_FAILS) lockedUntil = new Date(now.getTime() + LOGIN_LOCK_MS);
    tab.getRange(existing[1], 2, 1, 3).setValues([[count, windowStart, lockedUntil]]);
  } else {
    if (count >= LOGIN_MAX_FAILS) lockedUntil = new Date(now.getTime() + LOGIN_LOCK_MS);
    tab.appendRow([email, count, windowStart, lockedUntil]);
  }
  return lockedUntil;
}

// Clear the attempt record on a successful login (best-effort).
function clearFailedLogin(ss, email) {
  var existing = findAttemptRow(ss, email);
  if (existing) getOrCreateAttemptsTab(ss).deleteRow(existing[1]);
}

// Shared lockout gate. Returns a ready-to-return error object while the account
// is locked, else null. Used by BOTH login and changePassword — the forced
// first-login change takes a password too, so it must be throttled identically.
function lockoutRemaining(ss, email) {
  var att = findAttemptRow(ss, email);
  if (!att) return null;
  var locked = att[0][3] ? new Date(att[0][3]) : null;
  if (!locked || locked <= new Date()) return null;
  var mins = Math.max(1, Math.ceil((locked.getTime() - Date.now()) / 60000));
  return { status: 'error', message: 'Too many wrong attempts. Try again in ' + mins + ' min.' };
}

// Sign in: verify email + password against the USERS tab, then mint a session.
//
// A user whose row still says "Must Change Password" gets NO session token back —
// only the flag. That is what makes the forced first change unskippable: there is
// no credential to skip to, so deleting the screen in devtools buys nothing.
function doLoginPassword(params) {
  var email    = (params.email || '').toString().toLowerCase().trim();
  var password = (params.password || '').toString();
  if (!email || !password) return { status: 'error', message: 'Enter your email and password.' };

  var ss  = getSs();

  // Lockout check (applies whether or not the account exists — avoids leaking
  // which emails have accounts, and stops password guessing on a shared device).
  var locked = lockoutRemaining(ss, email);
  if (locked) return locked;

  var row = findUserRow(ss, email);
  if (!row) {
    recordFailedLogin(ss, email);
    // Deliberately specific, and the one place this app enumerates. There is no
    // self-signup, so a new hire who mistypes their address has NO other way to
    // learn why they cannot get in — "wrong password" would send them to retry a
    // password that cannot work, and then to the admin anyway. The cost is that an
    // unauthenticated caller can learn which @indrones.com addresses have accounts,
    // in a domain whose addresses are guessable anyway. Judged worth it for a
    // 20-person internal tool; revisit if the staff list ever becomes sensitive.
    // NOTE changePassword is generic — only this human-facing door is specific.
    return { status: 'error', message: 'No account found for this email — ask an admin to create one.' };
  }

  var salt     = String(row[2]);
  var expected = String(row[1]);
  if (hashPassword(password, salt) !== expected) {
    var until = recordFailedLogin(ss, email);
    if (until) {
      var mins2 = Math.max(1, Math.round(LOGIN_LOCK_MS / 60000));
      return { status: 'error', message: 'Wrong password. Account locked for ' + mins2 + ' min after too many attempts.' };
    }
    return { status: 'error', message: 'Wrong password.' };
  }

  if (String(userCol(row, 'Status')).toLowerCase() === 'disabled') {
    recordFailedLogin(ss, email);
    return { status: 'error', message: 'This account has been disabled. Ask an admin to re-enable it.' };
  }

  // First sign-in on an admin-issued temporary password: stop here and force the
  // change. A temp password also EXPIRES, so one read off a chat message stops
  // being a credential after TEMP_PW_TTL_DAYS whether or not it was ever used.
  if (isTempPasswordAccount(row)) {
    var stale = tempPasswordExpired(row);
    if (stale) return stale;
    clearFailedLogin(ss, email);
    return { status: 'ok', mustChangePassword: true, email: email, name: userCol(row, 'Name') };
  }

  clearFailedLogin(ss, email);
  var idx = findUserRowIndex(ss, email);
  if (idx) { try { getOrCreateUsersTab(ss).getRange(idx, 10).setValue(new Date()); } catch (e) { /* non-fatal */ } }
  var token = mintSession(email);
  return { status: 'ok', sessionToken: token, email: email, access: getMyAccess(email) };
}

// ──────────────────────────────────────────────────────────────────────────────
// ROUTING
// ──────────────────────────────────────────────────────────────────────────────
// Every dispatch lives INSIDE the try. The old build had the pre-auth branches
// above it, which is how a thrown error there became an HTML error page that the
// frontend could only report as "Could not reach the backend".
//
// Each dispatcher has two maps: `preAuth` (self-authenticating — login, the
// password flows, the liveness probe) and `authed` (everything that needs an
// identity). Adding an action means adding one entry, not another if-branch in
// an unprotected zone.

function ping() {
  return { status: 'ok', apiVersion: CONFIG.API_VERSION, serverTime: new Date().toISOString() };
}

// Cheap liveness probe used by the frontend before it ejects anyone. Answers
// ok/alive either way — a false answer must be distinguishable from a failure.
function sessionCheck(e) {
  var email = requireAuth(e);
  return { status: 'ok', alive: !!email, email: email || '' };
}

function unauthorizedResponse() {
  // The frontend's interceptor keys on this message starting with "unauthorized".
  return { status: 'error', message: 'Unauthorized: a valid sign-in is required.' };
}

// A stale cached frontend calling an action this build doesn't have gets a message
// a human can act on, instead of a bare "Unknown action".
function unknownAction(action) {
  return { status: 'error', message: 'This action is not available on the backend (' + action +
           '). The backend has been upgraded — reload the app.' };
}

function doGet(e) {
  var action = e.parameter.action || '';
  var result;
  try {
    var preAuth = {
      ping:         function () { return ping(); },
      sessionCheck: function () { return sessionCheck(e); },
    };
    if (preAuth[action]) return buildResponse(preAuth[action]());

    var email = requireAuth(e);
    if (!email) return buildResponse(unauthorizedResponse());

    var authed = {
      // getMyAccess is valid for ANY signed-in user — everyone has at least view.
      getMyAccess:   function () { return getMyAccess(email); },
      listIRs:       function () { return listIRs(); },
      getPassbook:   function () { return getPassbook(e.parameter.irNumber, email); },
      getAuditLog:   function () { return getAuditLog(e.parameter.irNumber); },
      listLegacyIRs: function () { return listLegacyIRs(); },
      listUsers:     function () { return listUsers(email); },
    };
    result = authed[action] ? authed[action]() : unknownAction(action);
  } catch (err) {
    result = { status: 'error', message: (err && err.message) || String(err) };
  }
  return buildResponse(result);
}

function doPost(e) {
  var params = e.parameter;
  var action = params.action || '';
  var result;
  try {
    var preAuth = {
      // Self-authenticating: the credential is in the body, not a session token.
      login:          function () { return doLoginPassword(params); },
      changePassword: function () { return changePassword(params); },
      forgotPassword: function () { return forgotPassword(params); },
      resetPassword:  function () { return resetPassword(params); },
      // logout revokes the session it is handed, so it authenticates itself.
      logout:         function () { return doLogout(params.sessionToken); },
      ping:           function () { return ping(); },
      sessionCheck:   function () { return sessionCheck(e); },
    };
    if (preAuth[action]) return buildResponse(preAuth[action]());

    var email = requireAuth(e);
    if (!email) return buildResponse(unauthorizedResponse());

    var authed = {
      saveSection: function () {
        var fields = JSON.parse(params.fields || '{}');
        var files  = JSON.parse(params.files  || '[]');
        // savedBy is the VERIFIED email from the credential — never a client value.
        return saveSection(params.irNumber, params.sectionId, fields, files, email);
      },
      sendNudgeEmail:    function () { return sendNudgeEmail(params, email); },

      // Admin-only (each re-checks isAdminEmail — the gate here is only routing).
      createUser:        function () { return createUser(params, email); },
      bulkCreateUsers:   function () { return bulkCreateUsers(params, email); },
      resetUserPassword: function () { return resetUserPassword(params, email); },
      setUserStatus:     function () { return setUserStatus(params, email); },
      listUsers:         function () { return listUsers(email); },
      saveDepartment:    function () { return saveDepartment(params, email); },
      deleteDepartment:  function () { return deleteDepartment(params, email); },
      setUserDepartments: function () { return setUserDepartments(params, email); },
      purgeUsers:        function () { return purgeUsers(params, email); },
    };
    result = authed[action] ? authed[action]() : unknownAction(action);
  } catch (err) {
    result = { status: 'error', message: (err && err.message) || String(err) };
  }
  return buildResponse(result);
}

// ──────────────────────────────────────────────────────────────────────────────
// SESSIONS — server-issued session tokens, so a signed-in device stays signed in
// without repeated sign-in prompts. Stored on the data sheet's SESSIONS tab.
// ──────────────────────────────────────────────────────────────────────────────
var SECTION_KEYS = ['sec-a','sec-b','sec-c','sec-d','sec-e','sec-f','sec-g','sec-h','sec-i'];
var SESSION_HEADS = ['Session Token', 'Email', 'Created At', 'Expires At', 'Revoked',
                     'Last Seen At', 'Revoked At'];

function getOrCreateSessionsTab(ss) {
  var tab = (ss || getSs()).getSheetByName('SESSIONS');
  if (!tab) tab = (ss || getSs()).insertSheet('SESSIONS');
  return ensureHeaders(tab, SESSION_HEADS);
}

// Verify a session token and return its email, or null if missing/expired/revoked.
//
// The expiry SLIDES on every use, so an active user is never signed out — the
// behaviour the owner asked for, and what a Google Workspace web session does.
// The rewrite is throttled to CONFIG.SESSION_SLIDE_HOURS because the frontend
// polls comments every 90s; unthrottled it would be ~40 sheet writes per hour per
// user for no benefit, since the window is 30 days.
function lookupSession(token) {
  if (!token) return null;
  try {
    var tab  = getOrCreateSessionsTab(getSs());
    var data = tab.getDataRange().getValues();
    var now  = new Date();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== token) continue;
      if (String(data[i][4]).toLowerCase() === 'revoked') return null;
      var exp = data[i][3] ? new Date(data[i][3]) : null;
      if (exp && exp < now) return null;
      try {
        var lastSeen = data[i][5] ? new Date(data[i][5]) : null;
        var stale = !lastSeen ||
          (now.getTime() - lastSeen.getTime()) > CONFIG.SESSION_SLIDE_HOURS * 60 * 60 * 1000;
        if (stale) {
          tab.getRange(i + 1, 4).setValue(new Date(now.getTime() + CONFIG.SESSION_DAYS * 24 * 60 * 60 * 1000));
          tab.getRange(i + 1, 6).setValue(now);
        }
      } catch (e2) { /* the slide is best-effort — never fail a lookup for it */ }
      return String(data[i][1]).toLowerCase().trim();
    }
    return null;
  } catch (e) { return null; }
}

function doLogout(sessionToken) {
  if (!sessionToken) return { status: 'ok' };
  try {
    var tab  = getOrCreateSessionsTab(getSs());
    var data = tab.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === sessionToken) {
        tab.getRange(i + 1, 5).setValue('revoked');
        tab.getRange(i + 1, 7).setValue(new Date());
        break;
      }
    }
  } catch (e) { /* non-fatal */ }
  return { status: 'ok' };
}

// ──────────────────────────────────────────────────────────────────────────────
// ACCESS CONTROL — two levels, and only two.
//
//   VIEW + COMMENT  — every signed-in user, on every section. No row anywhere.
//   EDIT            — granted by DEPARTMENT membership only.
//
// Departments are MANY-TO-MANY in both directions: a person may hold several
// departments, a department holds many people (USER_DEPARTMENTS is the edge list),
// and each department grants edit on a subset of the nine sections (DEPARTMENTS).
// So a person's edit rights are the UNION of their departments' grants.
//
// These two tabs hold AUTHORITY, so they must stay real Sheets tabs and never move
// into a `__`-prefixed sentinel store: sentinel irNumbers skip every ACL check in
// saveSection (see the isSentinel branches there), so a sentinel would let any
// signed-in user rewrite the grant matrix and hand themselves edit everywhere.
// ──────────────────────────────────────────────────────────────────────────────
function isAdminEmail(email) {
  email = (email || '').toLowerCase().trim();
  return CONFIG.ADMIN_EMAILS.map(function (a) { return a.toLowerCase(); }).indexOf(email) > -1;
}

var DEPT_HEADS = ['Key', 'Name', 'Active'].concat(SECTION_KEYS).concat(['Updated At', 'Updated By']);
var USERDEPT_HEADS = ['Email', 'Department Key', 'Added At', 'Added By'];

function getOrCreateDeptTab(ss) {
  var tab = (ss || getSs()).getSheetByName('DEPARTMENTS');
  if (!tab) tab = (ss || getSs()).insertSheet('DEPARTMENTS');
  return ensureHeaders(tab, DEPT_HEADS);
}
function getOrCreateUserDeptTab(ss) {
  var tab = (ss || getSs()).getSheetByName('USER_DEPARTMENTS');
  if (!tab) tab = (ss || getSs()).insertSheet('USER_DEPARTMENTS');
  return ensureHeaders(tab, USERDEPT_HEADS);
}

// "Flight Test" -> "flight-test". Stable keys mean renaming a department in the UI
// never orphans the people mapped to it.
function deptKeyFromName(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Every department key a person holds (whether or not the department is active).
function getUserDepartments(email) {
  email = (email || '').toLowerCase().trim();
  var data = getOrCreateUserDeptTab(getSs()).getDataRange().getValues();
  var keys = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() !== email) continue;
    var k = String(data[i][1]).trim();
    if (k && keys.indexOf(k) < 0) keys.push(k);
  }
  return keys;
}

// The union of section edits granted by the departments a person holds.
// Deactivated departments grant nothing, which is how a department is retired
// without deleting its history.
function departmentEditGrants(email) {
  var out = {};
  var keys = getUserDepartments(email);
  if (!keys.length) return out;          // short-circuit: no departments, no 2nd scan
  var data = getOrCreateDeptTab(getSs()).getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var k = String(data[i][0]).trim();
    if (keys.indexOf(k) < 0) continue;
    if (String(data[i][2] || '').trim().toLowerCase() === 'no') continue;
    for (var j = 0; j < SECTION_KEYS.length; j++) {
      if (String(data[i][3 + j] || '').trim().toLowerCase() === 'edit') out[SECTION_KEYS[j]] = true;
    }
  }
  return out;
}

// Resolve a user's role + per-section permissions. There is no 'none' any more:
// view+comment is universal, so the only question this answers is which sections
// are editable.
function getEffectiveAccess(email) {
  email = (email || '').toLowerCase().trim();
  if (isAdminEmail(email)) {
    var all = {};
    SECTION_KEYS.forEach(function (s) { all[s] = 'edit'; });
    return { role: 'admin', permissions: all, departments: [] };
  }
  // Default: view + comment everywhere. Built BEFORE the department read so that
  // any failure below still leaves a usable, minimum-privilege profile — the
  // catch fails open on reads and closed on writes, never to locked-out.
  var perms = {};
  SECTION_KEYS.forEach(function (s) { perms[s] = 'view'; });
  var depts = [];
  try {
    depts = getUserDepartments(email);
    var grants = departmentEditGrants(email);
    SECTION_KEYS.forEach(function (s) { if (grants[s]) perms[s] = 'edit'; });
  } catch (e) { /* keep view-only */ }
  return { role: 'user', permissions: perms, departments: depts };
}

// Comment now comes WITH view — the owner's rule is "view and comment are for
// everyone". Kept as named helpers because they are the semantic seam the call
// sites below are written against.
function canView(perms, sec)    { var v = perms && perms[sec]; return v === 'view' || v === 'comment' || v === 'edit'; }
function canComment(perms, sec) { var v = perms && perms[sec]; return v === 'view' || v === 'comment' || v === 'edit'; }
function canEdit(perms, sec)    { return !!(perms && perms[sec] === 'edit'); }

// GET getMyAccess — the caller's own role/permissions. Drives the frontend's
// per-section save-button gating. Valid for every signed-in user.
function getMyAccess(email) {
  email = (email || '').toLowerCase().trim();
  var access = getEffectiveAccess(email);
  var mustChange = false;
  try {
    var row = findUserRow(getSs(), email);
    if (row) mustChange = String(userCol(row, 'Must Change Password')).toLowerCase() === 'yes';
  } catch (e) { /* ignore */ }
  return {
    status: 'ok',
    role: access.role,
    permissions: access.permissions,
    departments: access.departments,
    mustChangePassword: mustChange,
    apiVersion: CONFIG.API_VERSION
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// ADMIN ACTIONS — provisioning, departments, and the reset
// ──────────────────────────────────────────────────────────────────────────────
function requireAdmin(authEmail) {
  if (!isAdminEmail(authEmail)) throw new Error('Forbidden: admins only.');
}
function validEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim());
}

// GET/POST listUsers (admin) — everything the three admin tabs need, in one call.
function listUsers(authEmail) {
  requireAdmin(authEmail);
  var ss = getSs();
  var udata = getOrCreateUsersTab(ss).getDataRange().getValues();
  var users = [];
  for (var i = 1; i < udata.length; i++) {
    var email = String(udata[i][0] || '').toLowerCase().trim();
    if (!email) continue;
    var access = getEffectiveAccess(email);
    users.push({
      email: email,
      name: userCol(udata[i], 'Name'),
      status: userCol(udata[i], 'Status') || 'active',
      mustChangePassword: userCol(udata[i], 'Must Change Password').toLowerCase() === 'yes',
      createdAt: udata[i][3] ? Utilities.formatDate(new Date(udata[i][3]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
      lastLoginAt: userCol(udata[i], 'Last Login At') ? Utilities.formatDate(new Date(userCol(udata[i], 'Last Login At')), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') : '',
      isAdmin: isAdminEmail(email),
      departments: access.departments,
      permissions: access.permissions
    });
  }
  users.sort(function (a, b) { return a.email < b.email ? -1 : (a.email > b.email ? 1 : 0); });

  var ddata = getOrCreateDeptTab(ss).getDataRange().getValues();
  var departments = [];
  for (var r = 1; r < ddata.length; r++) {
    var key = String(ddata[r][0] || '').trim();
    if (!key) continue;
    var grants = {};
    for (var j = 0; j < SECTION_KEYS.length; j++) {
      grants[SECTION_KEYS[j]] = String(ddata[r][3 + j] || '').trim().toLowerCase() === 'edit';
    }
    departments.push({
      key: key,
      name: String(ddata[r][1] || '').trim(),
      active: String(ddata[r][2] || '').trim().toLowerCase() !== 'no',
      grants: grants,
      members: 0
    });
  }
  // Member counts, so the Departments tab can show who a change would affect.
  var edge = getOrCreateUserDeptTab(ss).getDataRange().getValues();
  for (var e = 1; e < edge.length; e++) {
    var ek = String(edge[e][1] || '').trim();
    for (var d = 0; d < departments.length; d++) {
      if (departments[d].key === ek) { departments[d].members++; break; }
    }
  }
  return { status: 'ok', users: users, departments: departments, apiVersion: CONFIG.API_VERSION };
}

// POST createUser (admin) — one account + a one-time temporary password.
function createUser(params, authEmail) {
  requireAdmin(authEmail);
  var email = (params.email || '').toString().toLowerCase().trim();
  var name  = (params.name || '').toString().trim();
  if (!validEmail(email)) return { status: 'error', message: 'Enter a valid email address.' };
  var ss = getSs();
  if (findUserRow(ss, email)) return { status: 'error', message: 'An account already exists for ' + email + '.' };
  if (isAdminEmail(email)) return { status: 'error', message: 'That address is already an admin.' };
  var pw = createUserRow(email, name, authEmail);
  return { status: 'ok', email: email, name: name, tempPassword: pw,
           message: 'Account created. Copy the temporary password now — it cannot be shown again.' };
}

// POST bulkCreateUsers (admin) — paste a list of emails.
// Split on anything whitespace/comma/semicolon, dedupe, and SKIP-AND-REPORT rather
// than abort: one typo in a 19-person paste must not throw away the other 18.
function bulkCreateUsers(params, authEmail) {
  requireAdmin(authEmail);
  var raw = (params.emails || '').toString();
  var names = (params.names || '').toString();
  var list = raw.split(/[\s,;]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  // Unique, order preserved.
  var seen = {}, emails = [];
  list.forEach(function (e2) { if (!seen[e2]) { seen[e2] = true; emails.push(e2); } });
  if (!emails.length) return { status: 'error', message: 'Paste at least one email address.' };
  if (emails.length > 200) return { status: 'error', message: 'That is more than 200 addresses — split it into batches.' };

  // "email, Name" lines in the optional names box, so bulk onboarding can carry
  // display names without turning the main box into a CSV parser.
  var nameMap = {};
  names.split('\n').forEach(function (line) {
    var m = line.split(',');
    if (m.length >= 2) nameMap[m[0].trim().toLowerCase()] = m.slice(1).join(',').trim();
  });

  var ss = getSs();
  var created = [], skipped = [];
  emails.forEach(function (em) {
    if (!validEmail(em))          { skipped.push({ email: em, reason: 'not a valid email address' }); return; }
    if (isAdminEmail(em))         { skipped.push({ email: em, reason: 'already an admin' }); return; }
    if (findUserRow(ss, em))      { skipped.push({ email: em, reason: 'account already exists' }); return; }
    try {
      created.push({ email: em, name: nameMap[em] || '', tempPassword: createUserRow(em, nameMap[em] || '', authEmail) });
    } catch (err) {
      skipped.push({ email: em, reason: (err && err.message) || 'failed' });
    }
  });
  return { status: 'ok', created: created, skipped: skipped,
           message: created.length + ' account(s) created' + (skipped.length ? ', ' + skipped.length + ' skipped' : '') + '.' };
}

// POST resetUserPassword (admin) — issue a fresh temporary password and force the
// change again. Also signs the user's existing devices out.
function resetUserPassword(params, authEmail) {
  requireAdmin(authEmail);
  var email = (params.email || '').toString().toLowerCase().trim();
  var ss = getSs();
  var idx = findUserRowIndex(ss, email);
  if (!idx) return { status: 'error', message: 'No account found for ' + email + '.' };
  var row = findUserRow(ss, email);
  var pw = makeTempPassword();
  var salt = Utilities.getUuid();
  var now = new Date();
  // Columns B..H, then column K for the issued-at stamp the temp-password expiry
  // is measured from. Created At/By are preserved — this is not a new account.
  getOrCreateUsersTab(ss).getRange(idx, 2, 1, USER_ID_BLOCK_COLS)
    .setValues([[hashPassword(pw, salt), salt, row[3] || now, row[4] || authEmail, 'yes', '', 'active']]);
  getOrCreateUsersTab(ss).getRange(idx, 11).setValue(now);
  revokeAllSessions(email);
  clearFailedLogin(ss, email);
  return { status: 'ok', email: email, tempPassword: pw,
           message: 'New temporary password issued. Copy it now — it cannot be shown again.' };
}

// POST setUserStatus (admin) — enable/disable without deleting the account.
function setUserStatus(params, authEmail) {
  requireAdmin(authEmail);
  var email  = (params.email || '').toString().toLowerCase().trim();
  var status = (params.status || '').toString().toLowerCase() === 'disabled' ? 'disabled' : 'active';
  if (isAdminEmail(email) && status === 'disabled') {
    return { status: 'error', message: 'You cannot disable an admin account.' };
  }
  var ss  = getSs();
  var idx = findUserRowIndex(ss, email);
  if (!idx) return { status: 'error', message: 'No account found for ' + email + '.' };
  getOrCreateUsersTab(ss).getRange(idx, 8).setValue(status);
  // Revoke rather than checking Status on every authenticated request.
  if (status === 'disabled') revokeAllSessions(email);
  return { status: 'ok', email: email, status: status, message: email + ' is now ' + status + '.' };
}

// POST saveDepartment (admin) — create or update one department's section grants.
function saveDepartment(params, authEmail) {
  requireAdmin(authEmail);
  var name = (params.name || '').toString().trim();
  var key  = (params.key || '').toString().trim() || deptKeyFromName(name);
  if (!name && !key) return { status: 'error', message: 'A department needs a name.' };
  if (!key) return { status: 'error', message: 'Could not derive a key from that name — use letters or digits.' };
  var grants = {};
  try { grants = JSON.parse(params.grants || '{}'); } catch (e) { grants = {}; }

  var ss = getSs();
  var tab = getOrCreateDeptTab(ss);
  var data = tab.getDataRange().getValues();
  var ts = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
  var row = [key, name || key, (params.active === 'no' ? 'no' : 'yes')];
  SECTION_KEYS.forEach(function (s) { row.push(grants[s] ? 'edit' : ''); });
  row.push(ts); row.push(authEmail);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) { tab.getRange(i + 1, 1, 1, row.length).setValues([row]); return { status: 'ok', key: key, message: 'Saved ' + key }; }
  }
  tab.appendRow(row);
  return { status: 'ok', key: key, message: 'Created ' + key };
}

// POST deleteDepartment (admin) — remove the department AND every membership edge,
// so no one keeps edit rights through a department that no longer exists.
function deleteDepartment(params, authEmail) {
  requireAdmin(authEmail);
  var key = (params.key || '').toString().trim();
  if (!key) return { status: 'error', message: 'Department key required.' };
  return withRowLock(function () {
    var ss = getSs();
    var tab = getOrCreateDeptTab(ss);
    var data = tab.getDataRange().getValues();
    var removed = 0;
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).trim() === key) { tab.deleteRow(i + 1); removed++; }
    }
    var edges = getOrCreateUserDeptTab(ss);
    var edata = edges.getDataRange().getValues();
    for (var j = edata.length - 1; j >= 1; j--) {
      if (String(edata[j][1]).trim() === key) edges.deleteRow(j + 1);
    }
    return { status: 'ok', message: removed ? 'Deleted ' + key : 'No such department: ' + key };
  });
}

// POST setUserDepartments (admin) — replace one person's department memberships.
function setUserDepartments(params, authEmail) {
  requireAdmin(authEmail);
  var email = (params.email || '').toString().toLowerCase().trim();
  if (!email) return { status: 'error', message: 'Email required.' };
  var keys = [];
  try { keys = JSON.parse(params.departments || '[]'); } catch (e) { keys = []; }
  if (!(keys instanceof Array)) keys = [];
  keys = keys.map(function (k) { return String(k).trim(); }).filter(Boolean);

  return withRowLock(function () {
    var ss = getSs();
    var tab = getOrCreateUserDeptTab(ss);
    var data = tab.getDataRange().getValues();
    // Delete bottom-up so earlier deletes can't shift later row numbers.
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).toLowerCase().trim() === email) tab.deleteRow(i + 1);
    }
    var ts = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
    keys.forEach(function (k) { tab.appendRow([email, k, ts, authEmail]); });
    return { status: 'ok', email: email, departments: keys, message: email + ': ' + keys.length + ' department(s)' };
  });
}

// POST purgeUsers (admin) — the "treat this as new development" reset: remove
// every account except the admins.
//
// IRREVERSIBLE, so it is deliberately TWO calls in one endpoint:
//
//   params.dryRun === '1'  → plan only. Returns the rows that WOULD go, deletes
//                            nothing. This is what the UI calls first, so the
//                            admin can copy the backup before anything is lost.
//   otherwise              → deletes exactly that plan.
//
// It used to do both at once: the rows were deleted and the "backup" came back in
// the same response, so a dropped connection or a closed tab meant the only record
// of what had existed was gone along with the accounts — while the UI told the
// admin the rows were "shown below first". A response is not a backup. Nothing is
// destroyed now until a human has seen the list.
function purgeUsers(params, authEmail) {
  requireAdmin(authEmail);
  if (String(params.confirm || '') !== 'PURGE') {
    return { status: 'error', message: 'Refused: confirmation text did not match.' };
  }
  var dryRun = String(params.dryRun || '') === '1';

  return withRowLock(function () {
    var ss = getSs();
    var tab = getOrCreateUsersTab(ss);
    var data = tab.getDataRange().getValues();

    // Pass 1 — PLAN ONLY. No writes. Rows are collected in ascending index order
    // and deleted in reverse, so a delete never invalidates an index still to come.
    var plan = [], blanks = [];
    for (var i = 1; i < data.length; i++) {
      var email = String(data[i][0] || '').toLowerCase().trim();
      if (!email) { blanks.push(i + 1); continue; }        // a stray empty row
      if (isAdminEmail(email)) continue;
      plan.push({
        row: i + 1,
        email: email,
        name: userCol(data[i], 'Name'),
        createdBy: String(data[i][4] || ''),
        createdAt: data[i][3] ? Utilities.formatDate(new Date(data[i][3]), 'Asia/Kolkata', 'dd-MMM-yyyy') : ''
      });
    }
    var asRows = plan.map(function (p) {
      return { email: p.email, name: p.name, createdBy: p.createdBy, createdAt: p.createdAt };
    });

    if (dryRun) {
      // Counts only, plus the list. Nothing is written and nothing is locked in.
      var edgeCount = 0;
      var etab = getOrCreateUserDeptTab(ss);
      var edata = etab.getDataRange().getValues();
      for (var j = 1; j < edata.length; j++) {
        var e2 = String(edata[j][0] || '').toLowerCase().trim();
        if (e2 && !isAdminEmail(e2)) edgeCount++;
      }
      return { status: 'ok', dryRun: true, removed: asRows, count: asRows.length,
               blankRows: blanks.length, edges: edgeCount,
               message: 'Nothing deleted. ' + asRows.length + ' account(s), '
                        + edgeCount + ' membership(s) and ' + blanks.length
                        + ' empty row(s) would be removed. Copy the list, then confirm.' };
    }

    // Pass 2 — delete, in reverse, exactly what was planned.
    // If the caller reviewed a list, refuse when the world has changed under it:
    // an irreversible delete must remove what was SEEN, or nothing at all.
    var expect = (params.expect === undefined || params.expect === '') ? null : Number(params.expect);
    if (expect !== null && expect !== plan.length) {
      return { status: 'error', message: 'The account list changed while you were reviewing it ('
               + plan.length + ' now, ' + expect + ' when you looked). Nothing was deleted — review it again.' };
    }
    for (var k = plan.length - 1; k >= 0; k--) tab.deleteRow(plan[k].row);
    for (var b = blanks.length - 1; b >= 0; b--) tab.deleteRow(blanks[b]);

    // Every membership edge for a removed account goes too.
    var edges = getOrCreateUserDeptTab(ss);
    var ed = edges.getDataRange().getValues();
    for (var m = ed.length - 1; m >= 1; m--) {
      var em = String(ed[m][0] || '').toLowerCase().trim();
      if (em && !isAdminEmail(em)) edges.deleteRow(m + 1);
    }
    // And every session, so a still-open tab can't keep working on a dead account.
    var st = getOrCreateSessionsTab(ss);
    var sdata = st.getDataRange().getValues();
    for (var n = sdata.length - 1; n >= 1; n--) {
      var se = String(sdata[n][1] || '').toLowerCase().trim();
      if (!se || isAdminEmail(se)) continue;
      st.getRange(n + 1, 5).setValue('revoked');
      st.getRange(n + 1, 7).setValue(new Date());
    }
    return { status: 'ok', removed: asRows, count: asRows.length,
             message: 'Removed ' + asRows.length + ' account(s). Admins were kept.' };
  });
}
// Reads Form Responses tab from IR Repository and returns IR list, latest first
// ──────────────────────────────────────────────────────────────────────────────
function listIRs() {
  var ss   = SpreadsheetApp.openById(CONFIG.IR_REPO_SHEET_ID);
  var tab  = ss.getSheetByName(CONFIG.IR_REPO_TAB);
  if (!tab) throw new Error('Tab "' + CONFIG.IR_REPO_TAB + '" not found in IR Repository.');

  var lastRow = tab.getLastRow();
  if (lastRow < 2) return { status: 'ok', records: [] };

  // 1. Pre-fetch all statuses from the data sheet once
  var statusMap = getAllIRStatuses();

  var rows = tab.getRange(2, 1, lastRow - 1, tab.getLastColumn()).getValues();
  var records = rows
    .map(function(row) {
      var irNumber = (row[CONFIG.IR_REPO_IR_COL - 1] || '').toString().trim();
      return {
        dateRaised:    row[CONFIG.IR_REPO_DATE_COL - 1]
                        ? Utilities.formatDate(new Date(row[CONFIG.IR_REPO_DATE_COL - 1]), 'Asia/Kolkata', 'dd-MMM-yyyy')
                        : '',
        irNumber:      irNumber,
        droneId:       (row[CONFIG.IR_REPO_ID_COL - 1] || '').toString().trim(),
        summaryLink:   (row[CONFIG.IR_REPO_SUMLINK_COL - 1] || '').toString().trim(),
        status:        statusMap[irNumber] || 'Open',
        customerName:  (row[CONFIG.IR_REPO_REPORTER_COL - 1] || '').toString().trim(),
        contactEmail:  (row[CONFIG.IR_REPO_EMAIL_COL - 1] || '').toString().trim(),
        issueType:     (row[CONFIG.IR_REPO_SUPPORT_COL - 1] || '').toString().trim(),
        issueDesc:     (row[CONFIG.IR_REPO_DESC_COL - 1] || '').toString().trim(),
        spoc:          (row[CONFIG.IR_REPO_SPOC_COL - 1] || '').toString().trim(),
        initialStatus: (row[CONFIG.IR_REPO_STATUS_COL - 1] || '').toString().trim(),
        incidentDate:  (row[CONFIG.IR_REPO_INCIDENT_COL - 1] || '').toString().trim(),
        // Section A auto-populated intake fields (read-only in the app, sourced
        // from the customer form). N & Q are two separate evidence columns the
        // frontend combines into a single "Evidence" field.
        incidentLocationWeather: (row[CONFIG.IR_REPO_INCIDENT_LOC_COL - 1] || '').toString().trim(),
        evidenceFormN: (row[CONFIG.IR_REPO_EVIDENCE_N_COL - 1] || '').toString().trim(),
        evidenceFormQ: (row[CONFIG.IR_REPO_EVIDENCE_Q_COL - 1] || '').toString().trim(),
        companyName:  (row[CONFIG.IR_REPO_COMPANY_COL - 1] || '').toString().trim(),
      };
    })
    .filter(function(r) { return r.irNumber !== ''; })
    .reverse();

  return { status: 'ok', records: records };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: Get all IR statuses in one single read
// ──────────────────────────────────────────────────────────────────────────────
function getAllIRStatuses() {
  var map = {};
  try {
    var ss  = getSs();
    var tab = ss.getSheetByName('APP_DATA');
    if (!tab) return map;
    
    var data = tab.getDataRange().getValues();
    // APP_DATA structure: [IR Number, Section ID, Saved By, Fields, Updated]
    for (var i = 1; i < data.length; i++) {
        var irNum = data[i][0];
        var secId = data[i][1];
        if (secId === 'sec-a') {
            try {
                var fields = JSON.parse(data[i][3] || '{}');
                map[irNum] = fields['a_overallStatus'] || 'Open';
            } catch(e) {}
        }
    }
  } catch(e) {}
  return map;
}

// ──────────────────────────────────────────────────────────────────────────────
// SENTINEL STORE ALLOWLIST
// ──────────────────────────────────────────────────────────────────────────────
// Sentinel (`__`-prefixed) irNumbers skip every per-section ACL check, which is
// what lets a new app store ship without a backend redeploy. The allowlist below
// IS the access control for them, and it is load-bearing rather than tidy:
//
// Before it, ANY signed-in account — including one with no edit grant anywhere —
// could write any `__` store through saveSection, and saveSection replaces the
// whole row. One POST could therefore:
//   • blank `__NUDGES__/all` and delete every comment on every ticket, company-wide
//   • rewrite `__IRS__/<ir>` status/assignee/priority — the fields the UI treats as
//     authoritative workflow state, so decision "edit comes from departments" was
//     simply not true for them
//   • rewrite the shared dropdowns, IQC zones and @-mention directory in `__CONFIG__`
//   • host arbitrary files in the company Drive under the deployer's quota
//
// Adding a store here is a deliberate act. Prefer the narrowest key list that
// works; '*' means "keyed by a real-world id" and still validates the shape.
var SENTINEL_SECTIONS = {
  '__CONFIG__': ['team-directory', 'inward-options', 'iqc-config'],
  '__NUDGES__': ['all'],
  '__IRS__':    '*',   // one row per IR number
  '__KB__':     '*'    // one row per article id (Stage 7 — not yet written)
};

function assertSentinelWritable(irNumber, sectionId) {
  var allowed = SENTINEL_SECTIONS[irNumber];
  if (!allowed) throw new Error('Unknown app store: ' + irNumber);
  var key = String(sectionId);
  if (allowed === '*') {
    // A real-world id, and nothing else: no whitespace, quotes or slashes, so a
    // key cannot escape its namespace or become a path segment in Drive.
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(key)) throw new Error('Invalid key for ' + irNumber + ': ' + key);
    return;
  }
  if (allowed.indexOf(key) < 0) throw new Error('Unknown key for ' + irNumber + ': ' + key);
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION: getPassbook
// Returns all saved section data for a given IR number
// ──────────────────────────────────────────────────────────────────────────────
function getPassbook(irNumber, authEmail) {
  if (!irNumber) throw new Error('irNumber is required.');

  var access = getEffectiveAccess(authEmail);
  // Everyone signed in has view on every section, so this filter no longer hides
  // anything today — it is kept as the seam that re-tightens reads in one line if
  // the owner ever wants view restricted again.

  var isSentinel = String(irNumber).indexOf('__') === 0; // __NUDGES__ / __CONFIG__ app stores

  var ss   = getSs();
  var tab  = getOrCreateDataTab(ss);
  var data = tab.getDataRange().getValues();

  var sections = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] !== irNumber) continue;
    var secId = String(data[i][1] || '');
    // Hide real sections the caller can't view. Sentinel app stores (comments,
    // dropdown config) are shared app data — visible to any user with access.
    if (!isSentinel && access.role !== 'admin' && !canView(access.permissions, secId)) continue;
    var fields = {};
    try { fields = JSON.parse(data[i][3] || '{}'); } catch(e) {}
    sections[secId] = fields;
  }

  return { status: 'ok', sections: sections };
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION: saveSection
// Saves form fields + uploads files to Google Drive under IR/Section folder
// ──────────────────────────────────────────────────────────────────────────────
function saveSection(irNumber, sectionId, fields, files, savedBy) {
  if (!irNumber || !sectionId) throw new Error('irNumber and sectionId are required.');

  var access = getEffectiveAccess(savedBy);
  var isSentinel = String(irNumber).indexOf('__') === 0; // __NUDGES__ / __CONFIG__
  // Real sections require EDIT permission (admins bypass). This is the check that
  // makes "everyone can view" not become "everyone can write" — the frontend
  // disables the save buttons, but the backend never trusts a client gate.
  // Sentinel app stores (comments, dropdown config) stay writable by any signed-in
  // user: they ARE shared app data, and comments are part of view access. That
  // openness is bounded by the allowlist — see SENTINEL_SECTIONS — because an
  // unbounded sentinel write is a write to the app's own control plane.
  if (isSentinel) assertSentinelWritable(irNumber, sectionId);
  else if (access.role !== 'admin' && !canEdit(access.permissions, sectionId))
    throw new Error('Forbidden: you do not have edit access to ' + sectionId + '.');

  // App stores never carry files. Rejecting uploads here closes the last sentinel
  // hole: the upload branch runs before any ACL is consulted and sets every file to
  // ANYONE_WITH_LINK, so a sentinel write was an unauthenticated-quota way to host
  // arbitrary public files in the company Drive.
  if (isSentinel && files && files.length > 0)
    throw new Error('App stores cannot carry file uploads.');

  // 1. Handle file uploads first — create IR folder / Section subfolder
  var fileLinks = {};
  if (files && files.length > 0) {
    var sectionFolder = getOrCreateSectionFolder(irNumber, sectionId);
    files.forEach(function(file) {
      if (!file.base64 || !file.name || !file.mimeType) return;
      var blob     = Utilities.newBlob(Utilities.base64Decode(file.base64), file.mimeType, file.name);
      var uploaded = sectionFolder.createFile(blob);
      uploaded.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      if (!fileLinks[file.fieldId]) fileLinks[file.fieldId] = [];
      fileLinks[file.fieldId].push(uploaded.getUrl());
    });
    // Merge file links back into fields as comma-separated URLs
    Object.keys(fileLinks).forEach(function(fid) {
      fields[fid + '_links'] = fileLinks[fid].join(', ');
    });
  }

  // 2. Write to APP_DATA tab (upsert row for irNumber + sectionId)
  var ss   = getSs();
  var tab  = getOrCreateDataTab(ss);
  var data = tab.getDataRange().getValues();

  var existingRow = -1;
  var existingFields = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === irNumber && data[i][1] === sectionId) {
      existingRow = i + 1; // 1-indexed row in sheet
      try { existingFields = JSON.parse(data[i][3] || '{}'); } catch(e) {}
      break;
    }
  }

  // 2b. Section A intake fields are auto-populated from the customer form and
  // are editable by NO ONE. Strip any of them from the incoming payload so a
  // crafted save can't write a divergent copy into APP_DATA. (They're displayed
  // live from the IR Repository, not from here.)
  if (sectionId === 'sec-a') {
    ['a_irNumber','a_droneId','a_dateRaised','a_issueType','a_issueDesc','a_customerName',
     'a_contactEmail','a_incidentLocationWeather','a_evidence','a_companyName'].forEach(function(k) {
      delete fields[k];
    });
  }

  // 2c. Audit trail — record this save + every field overwrite (old→new) so any
  // later correction is traceable. Derived Drive-link keys (*_links) are skipped.
  appendAuditEntries(ss, irNumber, sectionId, savedBy, existingFields, fields);

  var timestamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
  var rowData   = [irNumber, sectionId, savedBy, JSON.stringify(fields), timestamp];

  if (existingRow > 0) {
    tab.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    tab.appendRow(rowData);
  }

  return { status: 'ok', message: 'Section ' + sectionId + ' saved for ' + irNumber };
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION: sendNudgeEmail
// Sends an automatic nudge email via MailApp (no operator clicks). Restricted so
// the app can't be used to mail outside Indrones.
// ──────────────────────────────────────────────────────────────────────────────
function isMailRecipientAllowed(to) {
  var addr = String(to || '').toLowerCase().trim();
  if (!addr) return false;
  var suffix = '@' + CONFIG.ALLOWED_DOMAIN;
  if (addr.indexOf(suffix) === addr.length - suffix.length) return true;
  var ext = (CONFIG.EXTERNAL_EMAILS || []).map(function (x) { return String(x).toLowerCase().trim(); });
  if (ext.indexOf(addr) > -1) return true;
  try { return !!findUserRow(getSs(), addr); } catch (e) { return false; }
}

function sendNudgeEmail(params, authEmail) {
  var to       = (params.to || '').trim();
  var fromName = (params.fromName || authEmail || 'Someone');
  var irNumber = params.irNumber || '';
  var message  = params.message || '';
  var context  = params.context || '';
  var sectionId = (params.sectionId || '').toString();
  // Sender is the verified caller — a client can't spoof the reply-to address.
  var from     = authEmail || '';

  // No comment gate: comment comes WITH view, so every signed-in user may post one.
  // (Kept as a call to canComment so the seam survives if that ever changes.)
  var access = getEffectiveAccess(authEmail);
  var allowed = access.role === 'admin';
  if (!allowed) {
    if (sectionId) allowed = canComment(access.permissions, sectionId);
    else allowed = SECTION_KEYS.some(function (s) { return canComment(access.permissions, s); });
  }
  if (!allowed) throw new Error('Forbidden: you do not have comment access.');

  // Accept "Name <email>" or a bare email; extract the bare address.
  var angleMatch = to.match(/<([^>]+)>/);
  if (angleMatch) to = angleMatch[1].trim();

  if (!to) throw new Error('Recipient (to) is required.');

  // Recipient guard — this app must not become a way to mail outside Indrones.
  // Allowed: any @indrones.com address, anyone who actually has an account here,
  // and anything in EXTERNAL_EMAILS. That last list is the escape hatch for a
  // non-Indrones colleague who needs the mail but has no account.
  if (!isMailRecipientAllowed(to)) {
    throw new Error('Email can only be sent to @' + CONFIG.ALLOWED_DOMAIN + ' addresses or to someone with an I-PASSBOOK account.');
  }

  var subject = '[I-PASSBOOK] ' + irNumber + ' — you have a comment';
  var lines = [
    'Hi,',
    '',
    fromName + ' mentioned you in a comment on I-PASSBOOK.',
    '',
    'IR: ' + irNumber
  ];
  if (context) lines.push('Context: ' + context);
  lines = lines.concat(['', 'Message:', message, '', '— Sent automatically via I-PASSBOOK', '']);

  var body = lines.join('\n');
  var options = { name: 'I-PASSBOOK' };
  if (from) options.replyTo = from;

  // Counted against the same daily ceiling as auth mail, from the nudge side of
  // the reserve. A visible error beats a silent one: if the day's mail is spent,
  // the comment still posts and the sender is told the notification did not go.
  if (!mailQuotaOk('nudge')) {
    return { status: 'error', message: 'Daily notification limit reached — the comment was saved, but no email was sent.' };
  }
  MailApp.sendEmail(to, subject, body, options);
  return { status: 'ok', message: 'Email sent to ' + to };
}

// ──────────────────────────────────────────────────────────────────────────────
// DRIVE HELPERS
// ──────────────────────────────────────────────────────────────────────────────
function getOrCreateSectionFolder(irNumber, sectionId) {
  var rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);

  // IR folder: e.g., "IR409"
  var irFolder = getOrCreateSubfolder(rootFolder, irNumber);

  // Section folder: e.g., "Section B - Inward"
  var sectionLabel = getSectionLabel(sectionId);
  var sectionFolder = getOrCreateSubfolder(irFolder, sectionLabel);

  return sectionFolder;
}

function getOrCreateSubfolder(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function getSectionLabel(sectionId) {
  var labels = {
    'sec-a': 'Section A - Preliminary Details',
    'sec-b': 'Section B - Inward Checklist',
    'sec-c': 'Section C - IQC Inspection',
    'sec-d': 'Section D - Investigation',
    'sec-e': 'Section E - Production Rework',
    'sec-f': 'Section F - Quality Control',
    'sec-g': 'Section G - Flight Test',
    'sec-h': 'Section H - PDI',
    'sec-i': 'Section I - Logistics Dispatch',
  };
  return labels[sectionId] || sectionId;
}

// ──────────────────────────────────────────────────────────────────────────────
// SHEET HELPER — Ensure APP_DATA tab exists with correct headers
// ──────────────────────────────────────────────────────────────────────────────
function getOrCreateDataTab(ss) {
  var tab = ss.getSheetByName('APP_DATA');
  if (!tab) tab = ss.insertSheet('APP_DATA');
  return ensureHeaders(tab, ['IR Number', 'Section ID', 'Saved By', 'Fields (JSON)', 'Last Updated']);
}

// ──────────────────────────────────────────────────────────────────────────────
// ONE-TIME SETUP — run manually from the editor to pre-create the AUDIT_LOG tab.
// Safe to run repeatedly (no-op if the tab already exists).
// ──────────────────────────────────────────────────────────────────────────────
function setupAuditLog() {
  var ss = getSs();
  getOrCreateAuditTab(ss);
  getOrCreateDataTab(ss);
  return 'APP_DATA + AUDIT_LOG tabs ready on sheet ' + CONFIG.PASSBOOK_SHEET_ID;
}

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT TRAIL — records every section save + every field overwrite (old→new) so
// corrections are traceable. Lives in an AUDIT_LOG tab on the data sheet.
// Columns: Timestamp | IR Number | Section ID | Saved By | Event | Field ID |
//          Old Value | New Value
// ──────────────────────────────────────────────────────────────────────────────
function getOrCreateAuditTab(ss) {
  var tab = ss.getSheetByName('AUDIT_LOG');
  if (!tab) {
    tab = ss.insertSheet('AUDIT_LOG');
    tab.getRange(1, 1, 1, 8).setValues([['Timestamp', 'IR Number', 'Section ID', 'Saved By', 'Event', 'Field ID', 'Old Value', 'New Value']]);
    tab.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#0E62FF').setFontColor('#ffffff');
    tab.setFrozenRows(1);
  }
  return tab;
}
function snapValue(v) {
  if (v == null) return '';
  var s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
  return s.length > 500 ? s.substring(0, 500) + '…' : s;
}
function appendAuditEntries(ss, irNumber, sectionId, savedBy, existingFields, newFields) {
  var tab = getOrCreateAuditTab(ss);
  var ts = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
  var rows = [];
  // One row per save event (so even a no-change save is traceable).
  rows.push([ts, irNumber, sectionId, savedBy, 'saved', '', '', '']);
  var ex = existingFields || {};
  var nw = newFields || {};
  Object.keys(nw).forEach(function(k) {
    if (/_links$/.test(k)) return;            // derived Drive-link keys — not user edits
    var had = ex.hasOwnProperty(k);
    var newJ = snapValue(nw[k]);
    if (!had) {
      rows.push([ts, irNumber, sectionId, savedBy, 'added', k, '', newJ]);
    } else if (snapValue(ex[k]) !== newJ) {
      rows.push([ts, irNumber, sectionId, savedBy, 'changed', k, snapValue(ex[k]), newJ]);
    }
  });
  Object.keys(ex).forEach(function(k) {
    if (/_links$/.test(k)) return;
    if (!nw.hasOwnProperty(k)) rows.push([ts, irNumber, sectionId, savedBy, 'removed', k, snapValue(ex[k]), '']);
  });
  if (rows.length > 1) tab.getRange(tab.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION: getAuditLog — returns the audit trail for one IR, oldest first
// ──────────────────────────────────────────────────────────────────────────────
function getAuditLog(irNumber) {
  if (!irNumber) throw new Error('irNumber is required.');
  var ss  = getSs();
  var tab = ss.getSheetByName('AUDIT_LOG');
  if (!tab) return { status: 'ok', entries: [] };
  var data = tab.getDataRange().getValues();
  var entries = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === irNumber) {
      entries.push({
        timestamp: data[i][0], irNumber: data[i][1], sectionId: data[i][2],
        savedBy: data[i][3], event: data[i][4], fieldId: data[i][5],
        oldValue: data[i][6], newValue: data[i][7]
      });
    }
  }
  return { status: 'ok', entries: entries };
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION: listLegacyIRs
// Enumerates the per-IR tabs in the legacy I-PASSBOOK workbook (tabs named like
// "IR310 | S25P023"). Returns each IR's number, full tab label, and ready-made
// embed/open URLs so the frontend can show the legacy record read-only. Tabs not
// matching /^IR\d+/ (Flow chart, index, format, etc.) are skipped. Token-gated.
// ──────────────────────────────────────────────────────────────────────────────
function listLegacyIRs() {
  var ss = SpreadsheetApp.openById(CONFIG.LEGACY_SHEET_ID);
  var sheets = ss.getSheets();
  var sheetId = CONFIG.LEGACY_SHEET_ID;
  var records = [];
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    var m = name.match(/^IR\s*(\d+)/i);
    if (!m) continue;
    var gid = sheets[i].getSheetId();
    records.push({
      irNumber:  'IR' + m[1],
      label:     name,
      gid:       gid,
      embedUrl:  'https://docs.google.com/spreadsheets/d/' + sheetId + '/preview?rm=minimal&gid=' + gid + '&single=true',
      openUrl:   'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit#gid=' + gid
    });
  }
  records.sort(function (a, b) {
    return parseInt(b.irNumber.replace(/\D/g, ''), 10) - parseInt(a.irNumber.replace(/\D/g, ''), 10);
  });
  return { status: 'ok', records: records };
}

// ──────────────────────────────────────────────────────────────────────────────
// STAGE 2: LEGACY DATA IMPORTER (Utility)
// Use this to crawl old tabs (IR409, etc) and populate APP_DATA
// ──────────────────────────────────────────────────────────────────────────────
function importLegacyData() {
  var ss   = getSs();
  var tabs = ss.getSheets();
  var count = 0;
  
  // We look for tabs that look like "IR###"
  tabs.forEach(function(tab) {
    var name = tab.getName();
    if (/^IR\d+$/.test(name)) {
      try {
        importSingleTab(ss, tab);
        count++;
      } catch(e) {
        console.log('Error importing ' + name + ': ' + e.message);
      }
    }
  });
  
  return { status: 'ok', message: 'Imported ' + count + ' legacy IR records.' };
}

function importSingleTab(ss, tab) {
    var irNumber = tab.getName();
    var dataTab  = getOrCreateDataTab(ss);
    
    // This is where we map the manual cells to the app sections
    // Note: User can adjust these cell mappings based on their manual format
    var mappings = {
        'sec-a': { 'a_customerName': 'B10', 'a_droneModel': 'C15' }, // Examples
        'sec-d': { 'd_rootCause': 'F50', 'd_actionTaken': 'F52' },
        'sec-i': { 'i_dispatchDate': 'H90' }
    };
    
    var timestamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
    
    Object.keys(mappings).forEach(function(secId) {
        var fields = {};
        Object.keys(mappings[secId]).forEach(function(fieldKey) {
            var cell = mappings[secId][fieldKey];
            fields[fieldKey] = tab.getRange(cell).getValue();
        });
        
        // Save to APP_DATA if not already there
        var rowData = [irNumber, secId, 'MigrationBot', JSON.stringify(fields), timestamp];
        dataTab.appendRow(rowData);
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// ONE-TIME SETUP + MIGRATIONS — run these from the Apps Script editor.
//
// Apps Script separates the editor's code from the version serving /exec, so
// these can run against the new code HOURS BEFORE the new deployment goes live,
// with zero impact on anyone using the app. That is the whole point of doing the
// sheet work in this order: the data model is ready before the switch, and the
// switch is a single deployment edit.
//
// Run order: migrateAddColumns() → migrateAclReport() → seedDepartments() →
//            bootstrapAdmin().  After go-live: maintenancePruneSessions() anytime.
// ──────────────────────────────────────────────────────────────────────────────

// Widen every tab this build reads to its current header set. Touches ONLY row 1,
// so it is safe on live data and safe to re-run.
function migrateAddColumns() {
  var ss = getSs();
  var done = [];
  getOrCreateUsersTab(ss);      done.push('USERS → 11 cols');
  getOrCreateSessionsTab(ss);   done.push('SESSIONS → 7 cols');
  getOrCreateDeptTab(ss);       done.push('DEPARTMENTS → 15 cols');
  getOrCreateUserDeptTab(ss);   done.push('USER_DEPARTMENTS → 4 cols');
  getOrCreateCodesTab(ss);      done.push('CODES → 7 cols');
  getOrCreateAttemptsTab(ss);
  getOrCreateDataTab(ss);
  return 'Migrated: ' + done.join(', ') + '.';
}

// READ-ONLY report of the retired ACL tab — the last chance to see the grants that
// were hand-assigned before departments replaced them. Changes nothing.
function migrateAclReport() {
  var tab = getSs().getSheetByName('ACL');
  if (!tab) return 'No ACL tab — nothing to migrate (this is expected on a fresh sheet).';
  var data = tab.getDataRange().getValues();
  var lines = ['Old per-user ACL (ACL tab) — ' + Math.max(0, data.length - 1) + ' row(s):', ''];
  for (var i = 1; i < data.length; i++) {
    var email = String(data[i][0] || '').trim();
    if (!email) continue;
    var granted = [];
    for (var j = 0; j < SECTION_KEYS.length; j++) {
      var v = String(data[i][j + 1] || '').trim();
      if (v) granted.push(SECTION_KEYS[j] + '=' + v);
    }
    lines.push(email + '  →  ' + (granted.length ? granted.join(' ') : '(nothing)'));
  }
  lines.push('', 'Nobody needs migrating: everyone gets view+comment automatically, and edit now');
  lines.push('comes from department membership. Use this only to check nobody had edit you');
  lines.push('want to preserve — then set it up in the Departments tab.');
  var out = lines.join('\n');
  console.log(out);
  return out;
}

// Create the department names as EMPTY rows — names only, NO section grants.
// Deliberately no grants: which department may edit which section is the owner's
// call, and a guess here would hand out edit rights nobody asked for. Tick them in
// the app's Departments tab.
var SEED_DEPARTMENTS = [
  'Production', 'QC', 'Flight Test', 'IQC', 'Purchase',
  'Inventory', 'CR', 'Compliance', 'Engineering', 'Management'
];

function seedDepartments() {
  var ss = getSs();
  var tab = getOrCreateDeptTab(ss);
  var data = tab.getDataRange().getValues();
  var have = {};
  for (var i = 1; i < data.length; i++) have[String(data[i][0] || '').trim()] = true;
  var ts = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
  var added = [];
  SEED_DEPARTMENTS.forEach(function (name) {
    var key = deptKeyFromName(name);
    if (have[key]) return;
    var row = [key, name, 'yes'];
    SECTION_KEYS.forEach(function () { row.push(''); });   // no grants — the owner ticks these
    row.push(ts); row.push('seed');
    tab.appendRow(row);
    added.push(key);
  });
  return added.length
    ? 'Created ' + added.length + ' department(s): ' + added.join(', ') + '. Now tick their sections in the app.'
    : 'All ' + SEED_DEPARTMENTS.length + ' departments already exist — nothing to do.';
}

// Ensure the admin has a usable account. If the row is missing it is created with
// a temporary password (returned ONCE — copy it out of the execution log); if it
// exists, its password is left alone and only the flags are normalised so the
// admin isn't forced through the first-login change.
function bootstrapAdmin() {
  var ss = getSs();
  var email = (CONFIG.ADMIN_EMAILS[0] || '').toLowerCase().trim();
  if (!email) return 'No CONFIG.ADMIN_EMAILS configured.';
  var idx = findUserRowIndex(ss, email);
  if (idx) {
    getOrCreateUsersTab(ss).getRange(idx, 6).setValue('');      // Must Change Password = no
    getOrCreateUsersTab(ss).getRange(idx, 8).setValue('active');
    return 'Admin ' + email + ' already exists — flags normalised, existing password untouched.';
  }
  var pw = createUserRow(email, 'Monish Raza', 'bootstrap');
  return 'Created admin ' + email + '.\nTEMPORARY PASSWORD: ' + pw +
         '\nSign in with it, set your own password, and delete this log line afterwards.';
}

// Delete long-expired session rows. Safe anytime; nothing calls it automatically
// except a best-effort prune at sign-in.
function maintenancePruneSessions() {
  pruneSessions();
  return 'Pruned expired sessions.';
}

// ──────────────────────────────────────────────────────────────────────────────
// RESPONSE HELPER — Always return CORS-friendly JSON
// ──────────────────────────────────────────────────────────────────────────────
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
