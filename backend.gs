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
  DRIVE_ROOT_FOLDER_ID: '1sc9mXOHPaWW1wiVvtDmyYLflGUogtm06',

  ALLOWED_DOMAIN: 'indrones.com',

  // Admins can manage users & assign per-section access (and bypass all
  // permission checks). Must match the frontend ADMIN_EMAILS.
  ADMIN_EMAILS: ['customer.relations@indrones.com', 'monish.raza@indrones.com'],

  // Session lifetime (days). A server-issued session token lets the PWA stay
  // signed in across reopens with no repeated sign-in pop-ups.
  SESSION_DAYS: 30,

  // ALLOWLIST — the ONLY emails that may CREATE an account via the sign-up
  // flow. The user maintains this list. An email NOT listed here (and not an
  // admin below) is rejected at sign-up before any USERS row is created. Once an
  // account exists, the user signs in with email + password. Add one email per
  // line, lowercase. NOTE: the *deployed* backend is an older build than this
  // file — keep this list in sync with the live deployment.
  ALLOWED_EMAILS: [
    'monish.raza@indrones.com',
    'ganesh.suryavanshi@indrones.com',
    'ravi@indrones.com',
    'harshad@indrones.com',
    'vaibhav.panchal@indrones.com',
    'angad.kumbhar@indrones.com',
    'mansi.sisale@indrones.com',
    'adhik.nair@indrones.com',
    'satish.dhanawade@indrones.com',
    'mukesh.mane@indrones.com',
    'nilesh.pawar@indrones.com',
    'tushar.kadam@indrones.com',
    'vicky.malekar@indrones.com',
    'ankit.prajapati@indrones.com',
    'vipin@indrones.com',
    'omkar.surekar@indrones.com',
    'sanket.gaikwad@indrones.com',
    'kishor.salunkhe@uavgarage.com',
    'customer.relations@indrones.com',
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
// The token is minted at sign-in (doLoginPassword) / sign-up (doVerifySignup) and
// stored on the SESSIONS tab; the frontend persists it and attaches it to every
// call. The caller's email is read FROM the token (never from a client param),
// so the allowlist / @indrones-only gate can't be spoofed by passing a known
// email. No Google ID token is involved anywhere — this backend makes no
// outbound network calls (so it needs no script.external_request scope).
function requireAuth(e) {
  var st = (e.parameter.sessionToken || '').toString().trim();
  if (st) return lookupSession(st);
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// USERS + PASSWORD AUTH (allowlist-gated sign-up)
// ──────────────────────────────────────────────────────────────────────────────
// Sign-up is gated by CONFIG.ALLOWED_EMAILS: only a listed email (or an admin)
// can create an account. Passwords are stored as SHA-256(salt + password) with a
// per-account random salt — the plain password is never stored. After sign-up or
// sign-in, the backend mints a revocable 30-day session token (see SESSIONS)
// that the frontend persists. No Google sign-in at any point.

function isAllowedEmail(email) {
  email = (email || '').toLowerCase().trim();
  if (!email) return false;
  var list = (CONFIG.ALLOWED_EMAILS || []).map(function (x) { return String(x).toLowerCase().trim(); });
  if (list.indexOf(email) > -1) return true;
  return isAdminEmail(email);   // admins can always sign up
}

function getOrCreateUsersTab(ss) {
  var tab = ss.getSheetByName('USERS');
  if (!tab) {
    tab = ss.insertSheet('USERS');
    tab.getRange(1, 1, 1, 5).setValues([['Email', 'PasswordHash', 'Salt', 'Created At', 'Created By']]);
    tab.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0E62FF').setFontColor('#ffffff');
    tab.setFrozenRows(1);
  }
  return tab;
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
  var tab = getOrCreateUsersTab(ss);
  var data = tab.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === email) return data[i];
  }
  return null;
}

// Mint a fresh session token for an email and append it to SESSIONS.
function mintSession(email) {
  var ss    = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  var tab   = getOrCreateSessionsTab(ss);
  var token = Utilities.getUuid();
  var now   = new Date();
  var exp   = new Date(now.getTime() + CONFIG.SESSION_DAYS * 24 * 60 * 60 * 1000);
  tab.appendRow([token, email, now, exp, '']);
  return token;
}

// ──────────────────────────────────────────────────────────────────────────────
// EMAIL VERIFICATION (OTP) + BOT GUARD (honeypot + time-gate) — no external calls
// ──────────────────────────────────────────────────────────────────────────────
// Sign-up is TWO steps now: (1) requestSignup — allowlist gate + bot checks, then
// email a 6-digit OTP via MailApp (the script.send_mail scope already granted for
// sendNudgeEmail — NO new scope, NO UrlFetchApp, so NO external_request). (2)
// verifySignup — the user enters the code from their mailbox; only then is the
// USERS row created and a session minted. This proves the signer-upper actually
// OWNS the allowlisted email (closing the "someone else signs up with your email
// first" gap) without reintroducing the scope that broke Google sign-in.
//
// Bot guard (server-enforced, zero network): a hidden honeypot field humans never
// fill, plus a minimum time-to-submit (a human can't type email+password in <2s).
// Checked on the SERVER, not just the client, so it can't be bypassed by skipping
// the UI. Genuine reCAPTCHA/Turnstile was rejected on purpose: verifying their
// token needs UrlFetchApp.fetch → script.external_request → the deploy trap again.
var OTP_TTL_MIN        = 10;
var OTP_MIN_SUBMIT_MS  = 2000;     // a human can't fill the form faster than this
var OTP_RESEND_GAP_MS = 60 * 1000; // min gap between code (re)issues per email
var OTP_MAX_RESENDS   = 5;

function getOrCreatePendingTab(ss) {
  var tab = ss.getSheetByName('PENDING_SIGNUPS');
  if (!tab) {
    tab = ss.insertSheet('PENDING_SIGNUPS');
    tab.getRange(1, 1, 1, 5).setValues([['Email', 'OTP Code', 'Created At', 'Expires At', 'Resend Count']]);
    tab.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0E62FF').setFontColor('#ffffff');
    tab.setFrozenRows(1);
  }
  return tab;
}

// 6-digit numeric code (100000–999999). GAS server runtime: Math.random is fine.
function makeOtp() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

// Return [rowValues, rowIndex] for a pending sign-up by email, or null.
function findPendingRow(ss, email) {
  email = (email || '').toLowerCase().trim();
  var tab = getOrCreatePendingTab(ss);
  var data = tab.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === email) return [data[i], i + 1];
  }
  return null;
}

// Step 1 of sign-up: validate + bot-check, email a 6-digit code. No account yet.
function doRequestSignup(params) {
  var email    = (params.email || '').toString().toLowerCase().trim();
  var password = (params.password || '').toString();
  var honey    = (params.website || '').toString();          // honeypot — must stay empty
  var tMs      = parseInt(params.t || '0', 10) || 0;          // ms since form became ready

  // Bot guard (server-enforced). Don't reveal which check tripped.
  if (honey) return { status: 'error', message: 'Sign-up could not be completed.' };
  if (tMs < OTP_MIN_SUBMIT_MS) return { status: 'error', message: 'Please slow down and fill the form, then try again.' };

  if (!email)    return { status: 'error', message: 'Enter your email.' };
  if (!isAllowedEmail(email)) return { status: 'error', message: 'This email is not on the allowed list. Ask an admin to add you.' };
  if (!password || password.length < 6) return { status: 'error', message: 'Password must be at least 6 characters.' };

  var ss = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  if (findUserRow(ss, email)) return { status: 'error', message: 'An account already exists for this email — sign in instead.' };

  var tab = getOrCreatePendingTab(ss);
  var now = new Date();
  var existing = findPendingRow(ss, email);
  var resendCount = 0;
  if (existing) {
    var row = existing[0];
    var createdMs = row[2] ? new Date(row[2]).getTime() : 0;
    resendCount = Number(row[4]) || 0;
    if ((now.getTime() - createdMs) < OTP_RESEND_GAP_MS) {
      return { status: 'error', message: 'A code was already sent — wait a moment, then resend.' };
    }
    if (resendCount >= OTP_MAX_RESENDS) {
      return { status: 'error', message: 'Too many code requests — please try again later.' };
    }
    resendCount += 1;
  } else {
    resendCount = 1;
  }

  var code = makeOtp();
  var expires = new Date(now.getTime() + OTP_TTL_MIN * 60 * 1000);

  if (existing) {
    tab.getRange(existing[1], 2, 1, 4).setValues([[code, now, expires, resendCount]]);   // update OTP/Created/Expires/Resend
  } else {
    tab.appendRow([email, code, now, expires, resendCount]);
  }

  // Send the OTP via the already-authorized MailApp (script.send_mail). Best-effort:
  // if the daily mail quota is hit, surface it so the user isn't left waiting.
  try {
    MailApp.sendEmail(
      email,
      'Your I-PASSBOOK sign-up code',
      'Your I-PASSBOOK verification code is ' + code + '.\n\nIt expires in ' + OTP_TTL_MIN +
        ' minutes. If you did not request this, you can safely ignore this email.',
      { name: 'I-PASSBOOK' }
    );
  } catch (e) {
    return { status: 'error', message: 'Could not send the verification email right now (mail quota reached). Please try again later.' };
  }
  return { status: 'ok', message: 'A verification code was sent to ' + email + '. Enter it below to finish sign-up.' };
}

// Step 2 of sign-up: verify the emailed code, then create the account + mint session.
function doVerifySignup(params) {
  var email    = (params.email || '').toString().toLowerCase().trim();
  var password = (params.password || '').toString();
  var code     = (params.code || '').toString().trim();

  if (!email || !password) return { status: 'error', message: 'Enter your email and password.' };
  if (!code) return { status: 'error', message: 'Enter the verification code from your email.' };
  if (password.length < 6) return { status: 'error', message: 'Password must be at least 6 characters.' };

  var ss = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  if (findUserRow(ss, email)) {
    // Account appeared since requestSignup (race / duplicate verify) — clean up.
    var p = findPendingRow(ss, email); if (p) getOrCreatePendingTab(ss).deleteRow(p[1]);
    return { status: 'error', message: 'An account already exists for this email — sign in instead.' };
  }

  var existing = findPendingRow(ss, email);
  if (!existing) return { status: 'error', message: 'No pending sign-up — request a code first.' };
  var row = existing[0];
  var expires = row[3] ? new Date(row[3]) : null;
  if (expires && expires < new Date()) return { status: 'error', message: 'The code expired — request a new one.' };
  if (String(row[1]).trim() !== code) return { status: 'error', message: 'Wrong verification code.' };

  // Create the account.
  var salt = Utilities.getUuid();
  var hash = hashPassword(password, salt);
  getOrCreateUsersTab(ss).appendRow([email, hash, salt, new Date(), 'self-signup']);
  getOrCreatePendingTab(ss).deleteRow(existing[1]);   // consume the pending row

  var token = mintSession(email);
  return { status: 'ok', sessionToken: token, email: email, access: getMyAccess(email) };
}

// Sign in: verify email + password against the USERS tab, then mint a session.
function doLoginPassword(params) {
  var email    = (params.email || '').toString().toLowerCase().trim();
  var password = (params.password || '').toString();
  if (!email || !password) return { status: 'error', message: 'Enter your email and password.' };

  var ss  = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  var row = findUserRow(ss, email);
  if (!row) return { status: 'error', message: 'No account found for this email — sign up first.' };

  var salt     = String(row[2]);
  var expected = String(row[1]);
  if (hashPassword(password, salt) !== expected) return { status: 'error', message: 'Wrong password.' };

  var token = mintSession(email);
  return { status: 'ok', sessionToken: token, email: email, access: getMyAccess(email) };
}

function doGet(e) {
  var action = e.parameter.action || '';
  // getMyAccess needs identity (session token) but is valid for users with no
  // access yet (so the request-access screen can render after sign-up/sign-in).
  if (action === 'getMyAccess') {
    var email = requireAuth(e);
    if (!email) return buildResponse({ status: 'error', message: 'Unauthorized: a valid sign-in is required.' });
    return buildResponse(getMyAccess(email));
  }

  var authEmail = requireAuth(e);
  if (!authEmail) return buildResponse({ status: 'error', message: 'Unauthorized: a valid sign-in is required.' });
  var result;
  try {
    if      (action === 'listIRs')        result = listIRs();
    else if (action === 'getPassbook')    result = getPassbook(e.parameter.irNumber, authEmail);
    else if (action === 'getAuditLog')    result = getAuditLog(e.parameter.irNumber);
    else if (action === 'listLegacyIRs')  result = listLegacyIRs();
    else if (action === 'listACL')        result = listACL(authEmail);
    else                                  result = { status: 'error', message: 'Unknown action: ' + action };
  } catch (err) {
    result = { status: 'error', message: err.message };
  }
  return buildResponse(result);
}

function doPost(e) {
  var params = e.parameter;
  var action = params.action || '';
  // signup / login are self-authenticating (email + password) — no prior session.
  if (action === 'requestSignup') return buildResponse(doRequestSignup(params));
  if (action === 'verifySignup')   return buildResponse(doVerifySignup(params));
  if (action === 'login')  return buildResponse(doLoginPassword(params));
  // logout revokes the session itself (handled before the auth gate).
  if (action === 'logout') return buildResponse(doLogout(params.sessionToken));
  // requestAccess needs identity but is valid for users with no access yet.
  if (action === 'requestAccess') {
    var em = requireAuth(e);
    if (!em) return buildResponse({ status: 'error', message: 'Unauthorized: a valid @indrones.com sign-in is required.' });
    return buildResponse(requestAccess(em, params));
  }

  var authEmail = requireAuth(e);
  if (!authEmail) return buildResponse({ status: 'error', message: 'Unauthorized: a valid @indrones.com sign-in is required.' });
  var result;
  try {
    if (action === 'saveSection') {
      var fields    = JSON.parse(params.fields  || '{}');
      var files     = JSON.parse(params.files   || '[]');
      // savedBy is the VERIFIED email from the credential — never a client value.
      result = saveSection(params.irNumber, params.sectionId, fields, files, authEmail);
    } else if (action === 'sendNudgeEmail') {
      result = sendNudgeEmail(params, authEmail);
    } else if (action === 'saveACL') {
      result = saveACL(params, authEmail);
    } else if (action === 'decideRequest') {
      result = decideRequest(params, authEmail);
    } else {
      result = { status: 'error', message: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { status: 'error', message: err.message };
  }
  return buildResponse(result);
}

// ──────────────────────────────────────────────────────────────────────────────
// SESSIONS — server-issued session tokens (so the PWA stays signed in without
// repeated Google One-Tap pop-ups). Stored on the data sheet's SESSIONS tab.
// ──────────────────────────────────────────────────────────────────────────────
var SECTION_KEYS = ['sec-a','sec-b','sec-c','sec-d','sec-e','sec-f','sec-g','sec-h','sec-i'];

function getOrCreateSessionsTab(ss) {
  var tab = ss.getSheetByName('SESSIONS');
  if (!tab) {
    tab = ss.insertSheet('SESSIONS');
    tab.getRange(1, 1, 1, 5).setValues([['Session Token', 'Email', 'Created At', 'Expires At', 'Revoked']]);
    tab.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0E62FF').setFontColor('#ffffff');
    tab.setFrozenRows(1);
  }
  return tab;
}

// Verify a session token and return its email, or null if missing/expired/revoked.
function lookupSession(token) {
  if (!token) return null;
  try {
    var ss  = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
    var tab = getOrCreateSessionsTab(ss);
    var data = tab.getDataRange().getValues();
    var now = new Date();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== token) continue;
      if (String(data[i][4]).toLowerCase() === 'revoked') return null;
      var exp = data[i][3] ? new Date(data[i][3]) : null;
      if (exp && exp < now) return null;
      return String(data[i][1]).toLowerCase().trim();
    }
    return null;
  } catch (e) { return null; }
}

function doLogout(sessionToken) {
  if (!sessionToken) return { status: 'ok' };
  try {
    var ss  = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
    var tab = getOrCreateSessionsTab(ss);
    var data = tab.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === sessionToken) { tab.getRange(i + 1, 5).setValue('revoked'); break; }
    }
  } catch (e) { /* non-fatal */ }
  return { status: 'ok' };
}

// ──────────────────────────────────────────────────────────────────────────────
// ACCESS CONTROL — per-user, per-section permission levels.
// Level hierarchy: '' (none) < 'view' < 'comment' < 'edit'.
// Admins (CONFIG.ADMIN_EMAILS) bypass everything: full edit, view all, manage.
// ──────────────────────────────────────────────────────────────────────────────
function isAdminEmail(email) {
  email = (email || '').toLowerCase().trim();
  return CONFIG.ADMIN_EMAILS.map(function (a) { return a.toLowerCase(); }).indexOf(email) > -1;
}

function getOrCreateAclTab(ss) {
  var tab = ss.getSheetByName('ACL');
  if (!tab) {
    var heads = ['Email'].concat(SECTION_KEYS).concat(['Updated At', 'Updated By']);
    tab = ss.insertSheet('ACL');
    tab.getRange(1, 1, 1, heads.length).setValues([heads]);
    tab.getRange(1, 1, 1, heads.length).setFontWeight('bold').setBackground('#0E62FF').setFontColor('#ffffff');
    tab.setFrozenRows(1);
  }
  return tab;
}

function getOrCreateRequestsTab(ss) {
  var tab = ss.getSheetByName('ACCESS_REQUESTS');
  if (!tab) {
    var heads = ['Email', 'Name', 'Requested At', 'Status', 'Decided By', 'Decided At'];
    tab = ss.insertSheet('ACCESS_REQUESTS');
    tab.getRange(1, 1, 1, heads.length).setValues([heads]);
    tab.getRange(1, 1, 1, heads.length).setFontWeight('bold').setBackground('#0E62FF').setFontColor('#ffffff');
    tab.setFrozenRows(1);
  }
  return tab;
}

// Resolve a user's role + per-section permissions.
// role: 'admin' (full edit, bypass) | 'user' (ACL entry exists) | 'none' (no entry).
function getEffectiveAccess(email) {
  email = (email || '').toLowerCase().trim();
  if (isAdminEmail(email)) {
    var all = {};
    SECTION_KEYS.forEach(function (s) { all[s] = 'edit'; });
    return { role: 'admin', permissions: all };
  }
  try {
    var ss  = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
    var tab = getOrCreateAclTab(ss);
    var data = tab.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase().trim() === email) {
        var perms = {};
        for (var j = 0; j < SECTION_KEYS.length; j++) perms[SECTION_KEYS[j]] = String(data[i][j + 1] || '').trim();
        return { role: 'user', permissions: perms };
      }
    }
  } catch (e) { /* fall through to none */ }
  return { role: 'none', permissions: {} };
}

function canView(perms, sec)    { var v = perms && perms[sec]; return v === 'view' || v === 'comment' || v === 'edit'; }
function canComment(perms, sec) { var v = perms && perms[sec]; return v === 'comment' || v === 'edit'; }
function canEdit(perms, sec)    { return !!(perms && perms[sec] === 'edit'); }

// GET getMyAccess — the caller's own role/permissions + whether they have a
// pending access request. Used at boot to decide app vs request-access screen.
function getMyAccess(email) {
  email = (email || '').toLowerCase().trim();
  var access = getEffectiveAccess(email);
  var pending = false;
  try {
    var rt = getOrCreateRequestsTab(SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID));
    var data = rt.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === email && String(data[i][3]) === 'pending') { pending = true; break; }
    }
  } catch (e) { /* ignore */ }
  return { status: 'ok', role: access.role, permissions: access.permissions, pendingRequest: pending };
}

// GET listACL (admin) — all users + their perms, plus pending requests.
function listACL(authEmail) {
  if (!isAdminEmail(authEmail)) return { status: 'error', message: 'Forbidden: admins only.' };
  var ss = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  var atab = getOrCreateAclTab(ss);
  var rtab = getOrCreateRequestsTab(ss);
  var adata = atab.getDataRange().getValues();
  var users = [];
  for (var i = 1; i < adata.length; i++) {
    var email = String(adata[i][0] || '').trim();
    if (!email) continue;
    var perms = {};
    for (var j = 0; j < SECTION_KEYS.length; j++) perms[SECTION_KEYS[j]] = String(adata[i][j + 1] || '').trim();
    users.push({ email: email, permissions: perms });
  }
  var rdata = rtab.getDataRange().getValues();
  var requests = [];
  for (var k = 1; k < rdata.length; k++) {
    if (String(rdata[k][3]) !== 'pending') continue;
    requests.push({
      email: String(rdata[k][0] || '').trim(),
      name:  String(rdata[k][1] || '').trim(),
      requestedAt: rdata[k][2] ? Utilities.formatDate(new Date(rdata[k][2]), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') : ''
    });
  }
  return { status: 'ok', users: users, requests: requests };
}

// POST saveACL (admin) — upsert or remove one user's per-section permissions.
function saveACL(params, authEmail) {
  if (!isAdminEmail(authEmail)) return { status: 'error', message: 'Forbidden: admins only.' };
  var email = (params.email || '').toString().toLowerCase().trim();
  if (!email) return { status: 'error', message: 'Email required.' };
  var mode = (params.mode || 'upsert').toString();
  var perms = {};
  try { perms = JSON.parse(params.permissions || '{}'); } catch (e) { perms = {}; }
  var ss  = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  var tab = getOrCreateAclTab(ss);
  var data = tab.getDataRange().getValues();
  var ts  = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) { if (String(data[i][0]).toLowerCase().trim() === email) { rowIdx = i; break; } }
  if (mode === 'remove') {
    if (rowIdx > 0) tab.deleteRow(rowIdx + 1);
    return { status: 'ok', message: 'Removed ' + email };
  }
  var row = [email];
  for (var j = 0; j < SECTION_KEYS.length; j++) {
    var v = perms[SECTION_KEYS[j]];
    row.push((v === 'view' || v === 'comment' || v === 'edit') ? v : '');
  }
  row.push(ts); row.push(authEmail);
  if (rowIdx > 0) tab.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);
  else tab.appendRow(row);
  return { status: 'ok', message: 'Saved access for ' + email };
}

// POST requestAccess (any verified @indrones user) — record a pending request
// and email the admins.
function requestAccess(email, params) {
  email = (email || '').toLowerCase().trim();
  var name = (params.name || '').toString().trim();
  var ss  = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  var tab = getOrCreateRequestsTab(ss);
  var data = tab.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === email && String(data[i][3]) === 'pending')
      return { status: 'ok', message: 'Your access request is already pending.' };
  }
  var ts = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
  tab.appendRow([email, name, ts, 'pending', '', '']);
  try {
    var subj = '[I-PASSBOOK] Access request from ' + email;
    var body = (name ? name + '\n' : '') + email + ' requested access to I-PASSBOOK.\n\nApprove it from the app: avatar menu → User Access & Requests → Pending.';
    CONFIG.ADMIN_EMAILS.forEach(function (a) { MailApp.sendEmail(a, subj, body, { name: 'I-PASSBOOK' }); });
  } catch (e) { /* email is best-effort; the request row is enough */ }
  return { status: 'ok', message: 'Access request sent to the admins.' };
}

// POST decideRequest (admin) — approve (optionally with initial perms) or reject.
function decideRequest(params, authEmail) {
  if (!isAdminEmail(authEmail)) return { status: 'error', message: 'Forbidden: admins only.' };
  var email    = (params.email || '').toString().toLowerCase().trim();
  var decision = (params.decision || '').toString();           // 'approve' | 'reject'
  var perms = {};
  try { perms = JSON.parse(params.permissions || '{}'); } catch (e) { perms = {}; }
  var ss  = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  var tab = getOrCreateRequestsTab(ss);
  var data = tab.getDataRange().getValues();
  var ts  = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === email && String(data[i][3]) === 'pending') {
      tab.getRange(i + 1, 4).setValue(decision);
      tab.getRange(i + 1, 5).setValue(authEmail);
      tab.getRange(i + 1, 6).setValue(ts);
      break;
    }
  }
  if (decision === 'approve') {
    saveACL({ email: email, permissions: JSON.stringify(perms), mode: 'upsert' }, authEmail);
  }
  return { status: 'ok', message: 'Request ' + decision + 'd.' };
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
    var ss  = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
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
// ACTION: getPassbook
// Returns all saved section data for a given IR number
// ──────────────────────────────────────────────────────────────────────────────
function getPassbook(irNumber, authEmail) {
  if (!irNumber) throw new Error('irNumber is required.');

  var access = getEffectiveAccess(authEmail);
  // No-access users see nothing (defence in depth — the frontend keeps them on
  // the request-access screen, but the backend never trusts that).
  if (access.role === 'none') return { status: 'ok', sections: {} };

  var isSentinel = String(irNumber).indexOf('__') === 0; // __NUDGES__ / __CONFIG__ app stores

  var ss   = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
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
  // Real sections require edit permission (admins bypass). Sentinel app stores
  // (comments read-marks, dropdown config) are writable by any authenticated
  // user with access — the comment UI itself is gated client-side by canComment.
  if (!isSentinel && access.role === 'none')
    throw new Error('Forbidden: you do not have access to this IR.');
  if (!isSentinel && access.role !== 'admin' && !canEdit(access.permissions, sectionId))
    throw new Error('Forbidden: you do not have edit access to ' + sectionId + '.');

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
  var ss   = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
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
// Sends an automatic nudge email via MailApp (no operator clicks). Restricted
// to the allowed domain so the app can't be used to mail outside Indrones.
// ──────────────────────────────────────────────────────────────────────────────
function sendNudgeEmail(params, authEmail) {
  var to       = (params.to || '').trim();
  var fromName = (params.fromName || authEmail || 'Someone');
  var irNumber = params.irNumber || '';
  var message  = params.message || '';
  var context  = params.context || '';
  var sectionId = (params.sectionId || '').toString();
  // Sender is the verified caller — a client can't spoof the reply-to address.
  var from     = authEmail || '';

  // Comment permission gate. Admins bypass. Otherwise the caller must have
  // 'comment'/'edit' on the comment's target section; an IR-scope comment (no
  // sectionId) requires comment access on at least one section.
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

  // Only allow @indrones.com recipients (prevents abuse / external leaks).
  var suffix = '@' + CONFIG.ALLOWED_DOMAIN;
  if (to.toLowerCase().indexOf(suffix) !== to.length - suffix.length) {
    throw new Error('Email can only be sent to @' + CONFIG.ALLOWED_DOMAIN + ' addresses.');
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
  if (!tab) {
    tab = ss.insertSheet('APP_DATA');
    tab.getRange(1, 1, 1, 5).setValues([['IR Number', 'Section ID', 'Saved By', 'Fields (JSON)', 'Last Updated']]);
    tab.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0E62FF').setFontColor('#ffffff');
    tab.setFrozenRows(1);
  }
  return tab;
}

// ──────────────────────────────────────────────────────────────────────────────
// ONE-TIME SETUP — run manually from the editor to pre-create the AUDIT_LOG tab.
// Safe to run repeatedly (no-op if the tab already exists).
// ──────────────────────────────────────────────────────────────────────────────
function setupAuditLog() {
  var ss = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
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
  var ss  = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
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
  var ss   = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
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
// RESPONSE HELPER — Always return CORS-friendly JSON
// ──────────────────────────────────────────────────────────────────────────────
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
