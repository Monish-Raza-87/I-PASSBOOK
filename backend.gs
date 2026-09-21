// ============================================================
//  I-PASSBOOK — Google Apps Script Backend (backend.gs)
//
//  TWO deployments of this one script, and both are required:
//
//  1. THE MAIN ONE — Execute as: Me → Who has access: Anyone.
//     Serves every action the app makes, including password sign-in with its
//     emailed code. Its /exec URL is the one in the frontend's CONFIG.GAS_URL and
//     must NOT change. It has to stay on "Anyone": an address outside the domain
//     (see CONFIG.EXTERNAL_EMAILS), and any machine with no Google session, can
//     only get in through this door, and a domain restriction blocks the request
//     at Google's edge before this script ever runs.
//
//  2. THE GOOGLE DOOR — same script, same version, Execute as: Me →
//     Who has access: Anyone within <domain>. It serves ONLY googleStart, reached
//     by the browser NAVIGATING to it, and its /exec URL goes in the frontend's
//     CONFIG.SSO_URL. The domain restriction is what makes Session.getActiveUser()
//     report the caller: under "Anyone" it returns '' and the action refuses.
//     Delete this deployment and Google sign-in disappears; nothing else is
//     affected.
//
//     WHY A NAVIGATION AND NOT A BACKGROUND CALL — measured, not assumed. A page
//     on a different address (the gh-pages app) calling this URL with fetch() gets
//     **401** from Google before this script runs, because the caller's Google
//     session is not attached to a cross-site background request; the identical
//     URL opened as a navigation gets through and reports the caller. So the door
//     is a CLICK that leaves the page for about a second and comes straight back
//     with a one-time handoff code. googleExchange (a POST on deployment 1, which
//     is "Anyone") swaps that code for a session. See docs/10.
// ============================================================

// ──────────────────────────────────────────────────────────────────────────────
// CONFIG — Update DRIVE_ROOT_FOLDER_ID before deploying
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

  // ── THE APP'S OWN STORE ──────────────────────────────────────────────────────
  // There is no app spreadsheet any more. Everything the app owns — accounts,
  // sessions, the access matrix, every saved section, the audit trail — lives as
  // JSON files in `_store/` inside the folder below. The ONLY spreadsheet left is
  // the client's Form Responses sheet above, which is an INPUT, never a store.
  //
  // This folder belongs to monish.raza@indrones.com, who owns it outright, so the
  // store is not inside an account that several people share. The script must be
  // deployed from THAT account (Deploy → Execute as: Me), because it writes here
  // as whoever runs it.
  DRIVE_ROOT_FOLDER_ID: '1itfTVbllh8Mi6TD6I2_OyYp_Wj4xrLIK',
  // The store's own folder, a SIBLING of the per-IR upload folders (IR409/, …).
  // It must stay Restricted: the upload FILES are set to anyone-with-link one by
  // one, so their links keep working while this one holds password hashes. See
  // initializeStore().
  STORE_FOLDER_NAME: '_store',

  // Where a closed IR's own folder goes, a sibling of `_store/` and of the live
  // per-IR folders. The owner binds this one to the company server so the data
  // syncs off Drive; nothing here erases anything yet. See archiveClosedIRs().
  ARCHIVE_FOLDER_NAME: 'Archive IRs',

  ALLOWED_DOMAIN: 'indrones.com',

  // Bump this whenever the action set or a response shape changes. `ping` reports
  // it, so a cached frontend talking to a newer backend (or vice versa) can say so
  // in words a human can act on instead of failing as "Unknown action".
  //
  // v3 = the Drive-JSON store. The response SHAPES are unchanged from v2; what
  // changed is where the data lives. It is bumped anyway because the store moved
  // accounts, so a v2 client and a v3 deployment are genuinely different things
  // and the footer check in docs/08 is how an operator tells them apart.
  API_VERSION: 3,

  // The ONE admin. Admins bypass every permission check and are the only accounts
  // that can provision people, set department grants or reset passwords. Must
  // match the frontend ADMIN_EMAILS.
  ADMIN_EMAILS: ['monish.raza@indrones.com'],

  // The deployed app's own address, used for ONE thing: building the deep link in
  // an admin notification email (see sendAdminNotice / irDeepLink).
  //
  // It is a CONFIG value and never a client-supplied one. A URL that a client hands
  // us and we then put in an email the admin trusts is a phishing vector — the
  // admin sees the app's own sender name and clicks whatever the link says. So the
  // link is assembled here, from this constant alone. Blank it (or leave it blank
  // on a fresh clone) and the email simply carries no link.
  //
  // The app routes by hash, so a ticket link is APP_URL + '#/tickets/IR409'.
  APP_URL: 'https://monish-raza-87.github.io/I-PASSBOOK/',

  // Session lifetime, in HOURS — one working day (8h30m). Minted at sign-in and
  // ABSOLUTE: it does not slide on use, so an active user is still signed out at
  // the end of the shift and signs in again the next morning.
  //
  // This replaced a 30-day sliding session, which is a deliberate reversal: the
  // daily sign-in is what gives the sign-in code below something to protect, and
  // a session that slides forward on every request never expires for exactly the
  // people who use the app most.
  SESSION_HOURS: 8.5,

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
// password change (changePassword) and stored in the session store; the frontend
// persists it and attaches it to every call. The caller's email is read FROM the
// token (never from a client param), so an identity can't be spoofed by passing a
// known email. No Google ID token is involved anywhere — this backend makes no
// outbound network calls (so it needs no script.external_request scope).
//
// This THROWS when the session store cannot be read. That is deliberate: null
// means "this token is not valid", which callers answer as `unauthorized` and the
// frontend trusts by signing the user out. A store that cannot be read says
// nothing about the token, so it must not be reported as though it did — see
// sessionCheck, which fails open for exactly this reason.
function requireAuth(e) {
  var st = (e.parameter.sessionToken || '').toString().trim();
  if (st) return lookupSession(st);
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// THE STORE — the app's own data, as JSON files in Google Drive
// ──────────────────────────────────────────────────────────────────────────────
// There is no app spreadsheet any more. Everything the app owns lives under
// `_store/` inside CONFIG.DRIVE_ROOT_FOLDER_ID:
//
//   users.json   sessions.json  codes.json   attempts.json
//   access.json  irs.json       config.json  kb.json   comments.json
//   sections/    IR409.json → { 'sec-b': {…}, 'sec-f': {…} }   +  index.json
//   audit/       IR409.jsonl — one JSON object per line, append-only
//   backups/     <label>-<yyyy-MM-dd-HHmmss>.json — always a NEW file
//
// What this buys over a sheet, and what it costs:
//
//   + A record has a NAME. A lookup is a key read and a write is a key
//     assignment, so every positional hazard goes away with the layout that
//     caused it: no rows shifting under a delete, no header that silently
//     re-letters when a section is added, no `row[1]` read "for speed".
//   + A whole store is one file, so a backup is a file copy.
//   − Drive has no atomic append and no transactions. A read-merge-write must
//     therefore hold the script lock (see withRowLock) or two saves to one IR
//     lose one of them. That is the ONE place this design is weaker than the
//     sheet was, and the lock is not optional because of it.
//
// The response SHAPES the frontend sees are unchanged. Only where the bytes live
// changed.

var STORE_SECTIONS_DIR = 'sections';
var STORE_AUDIT_DIR    = 'audit';
var STORE_BACKUP_DIR   = 'backups';
var STORE_INDEX        = 'sections/index.json';

// Per-execution store memo, exactly as `_ssMemo` used to memoise the spreadsheet.
// Apps Script gives every execution a fresh global scope, so this cannot leak an
// open store across requests; it exists because one frontend save fires four
// backend calls and an unmemoised store would pay a Drive round trip for each.
var _storeMemo      = {};
var _rootFolderMemo = null;
var _storeFolderMemo = null;
var _subfolderMemo  = {};   // subfolder name → Folder, for this execution only

function getRootFolder() {
  if (!_rootFolderMemo) _rootFolderMemo = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
  return _rootFolderMemo;
}

// The `_store/` folder. Never CREATED from here: a read path that quietly made the
// folder would turn a misconfigured deploy into an empty store, and an empty
// users.json is every account missing. initializeStore() creates it, once, by hand.
function getStoreFolder() {
  if (_storeFolderMemo) return _storeFolderMemo;
  var it = getRootFolder().getFoldersByName(CONFIG.STORE_FOLDER_NAME);
  if (!it.hasNext()) {
    throw new Error('The app store folder "' + CONFIG.STORE_FOLDER_NAME + '" was not found in Drive folder ' +
                    CONFIG.DRIVE_ROOT_FOLDER_ID + '. Run initializeStore() once from the Apps Script editor.');
  }
  _storeFolderMemo = it.next();
  return _storeFolderMemo;
}

// A subfolder of the store. Returns null when it is missing and `create` is false:
// "this folder does not exist yet" is a legitimate empty answer for a READ — a
// fresh store has no audit/ until the first save — and never a reason to create.
function getStoreSubfolder(name, create) {
  // Memoised per execution, for the same reason `_storeMemo` is: getFoldersByName is
  // a Drive SEARCH, and one save asks for the same subfolder several times
  // (`sections/` for the index and the IR file, `audit/` for the lines it appends).
  // The memo lives in the execution's own global scope, so it cannot serve a stale
  // folder to a later request. A MISS is deliberately not memoised: a caller with
  // create=true must still be able to create the folder the previous caller only
  // looked for.
  if (Object.prototype.hasOwnProperty.call(_subfolderMemo, name)) return _subfolderMemo[name];
  var it = getStoreFolder().getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : (create ? getStoreFolder().createFolder(name) : null);
  if (folder) _subfolderMemo[name] = folder;
  return folder;
}

// A store path is a bare file name in `_store/`, or "sub/file.json".
function storeFolderFor(path, create) {
  var p = String(path);
  var i = p.indexOf('/');
  return i < 0 ? getStoreFolder() : getStoreSubfolder(p.substring(0, i), create);
}
function storeNameFor(path) {
  var p = String(path);
  var i = p.indexOf('/');
  return i < 0 ? p : p.substring(i + 1);
}

function findStoreFile(path, createFolder) {
  var folder = storeFolderFor(path, !!createFolder);
  if (!folder) return null;
  var it = folder.getFilesByName(storeNameFor(path));
  return it.hasNext() ? it.next() : null;
}

function parseStoreJson(path, file) {
  var text = file.getBlob().getDataAsString();
  if (!text || !text.trim()) {
    throw new Error('Store file ' + path + ' is empty — refusing to read it as "no data".');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Store file ' + path + ' is not valid JSON (' + e.message + '). Nothing was changed.');
  }
}

// Read a store file, memoised per execution.
//
// Returns null ONLY when the file provably does not exist. A read error or a
// JSON.parse failure THROWS, and there is deliberately no `fallback` argument:
// the tempting version of this helper answers `{}` for an unreadable file, and
// that version destroys data — one corrupt users.json would read as "no
// accounts", and the very next createUser would write that emptiness back plus
// one account. Corruption must surface as an error, never as "empty".
function readJson(path) {
  if (Object.prototype.hasOwnProperty.call(_storeMemo, path)) return _storeMemo[path];
  var file = findStoreFile(path, false);
  _storeMemo[path] = file ? parseStoreJson(path, file) : null;
  return _storeMemo[path];
}

// Read inside a locked region. Deliberately NOT the memoised read: a memoised
// value may have been read BEFORE the lock was taken, and reusing it would
// clobber whatever landed in between — precisely the lost update the lock exists
// to prevent. Inside a lock, the read must be the CURRENT file.
function readJsonLocked(path) {
  var file = findStoreFile(path, false);
  var val = file ? parseStoreJson(path, file) : null;
  _storeMemo[path] = val;
  return val;
}

// Write a store file. ALWAYS one file, and for the keyed stores always one KEY —
// see the note on createUserRow and THE ONE STORE PATH. Call it with the
// lock already held on every read-merge-write path.
function writeJson(path, obj) {
  var file = findStoreFile(path, true);
  if (!file) file = storeFolderFor(path, true).createFile(storeNameFor(path), '', MimeType.PLAIN_TEXT);
  file.setContent(JSON.stringify(obj));
  _storeMemo[path] = obj;
}
function writeJsonLocked(path, obj) { writeJson(path, obj); }

// ── THE ONE STORE PATH ────────────────────────────────────────────────────────
// Every subject the app stores resolves to "a JSON object that maps a key to a
// fields object", so getPassbook and saveSection need exactly one code path and
// not two. The mapping is:
//
//   real IR     sections/IR409.json   keyed by sectionId   sec-b, sec-f, sec-a
//   __IRS__     irs.json              keyed by IR number   IR409, IR410
//   __CONFIG__  config.json           keyed by store key   team-directory, iqc-config
//   __NUDGES__  comments.json         keyed by 'all'       all
//   __KB__      kb.json               keyed by article id  kb-12
//
// `saveSection` therefore writes `store[key] = fields` for all five, and the
// "is this a sentinel" question survives only where it belongs: the ACCESS check.

// The file a sentinel subject lives in, or null for a real IR number.
function sentinelStoreFile(irNumber) {
  switch (String(irNumber)) {
    case '__IRS__':    return 'irs.json';
    case '__CONFIG__': return 'config.json';
    case '__NUDGES__': return 'comments.json';
    case '__KB__':     return 'kb.json';
  }
  return null;
}

// IR numbers reach a Drive FILE NAME, so the shape is asserted before any folder
// or file work happens. Without this, `../` or a `__`-prefixed string that is not
// on the allowlist would name a store file of the caller's choosing.
function assertRealIR(irNumber) {
  if (!/^IR\d+$/.test(String(irNumber))) {
    throw new Error('Invalid IR number: ' + irNumber + '. Expected the form IR409.');
  }
}

// sections/index.json — the IR → file id map. A Drive `getFilesByName` is a
// SEARCH and is eventually consistent: a miss right after a create writes a second
// IR409.json and the store silently forks, with two halves of one ticket's data
// in two files. The index is read by direct id fetch instead, and the search below
// is only a self-healing fallback for a file the index has lost track of.
function readSectionsIndex(locked) {
  // Inside a lock the memo must be bypassed: an index read before the lock was
  // taken can be missing the entry another writer just added, and re-writing it
  // would drop that writer's ticket from the map.
  var idx = locked ? readJsonLocked(STORE_INDEX) : readJson(STORE_INDEX);
  if (!idx || typeof idx !== 'object') idx = {};
  if (!idx.irs || typeof idx.irs !== 'object') idx.irs = {};
  return idx;
}
function writeSectionsIndex(idx) { writeJson(STORE_INDEX, idx); }

// The sections file for one IR, as { fileId, data }. `create` makes the file.
function readIR(irNumber, create, locked) {
  assertRealIR(irNumber);
  var idx = readSectionsIndex(!!locked);
  var id = idx.irs[irNumber];

  if (id) {
    // A direct fetch. A file that the index names but Drive cannot produce has
    // been trashed or moved by hand — say so rather than silently starting over,
    // because "start over" here means an empty section map for a live ticket.
    var byId = null;
    try { byId = DriveApp.getFileById(id); }
    catch (e) { byId = null; }

    if (byId) {
      var data = parseStoreJson(STORE_SECTIONS_DIR + '/' + irNumber + '.json', byId);
      return { fileId: id, data: (data && typeof data === 'object') ? data : {} };
    }
    throw new Error('sections/' + irNumber + '.json is listed in the index but is not in Drive (id ' + id + '). ' +
                    'Nothing was changed — check the folder, or delete its index entry to start the file again.');
  }

  // Not in the index: a genuine first save for this IR, or an index that lost the
  // entry. Look the file up by name before creating a second one.
  var hits = findAllByName(STORE_SECTIONS_DIR + '/' + irNumber + '.json');
  if (hits.length) {
    // A MULTI-MATCH IS RESOLVED BY NEWEST, never by "whichever Drive listed first".
    // Two files under one IR number means either event the index exists to prevent,
    // and an arbitrary pick would make the app read one half of a ticket and write
    // the other. Newest is the best guess available and it is at least deterministic.
    var pick = hits[0];
    hits.forEach(function (f) {
      if (String(f.getLastUpdated()) > String(pick.getLastUpdated())) pick = f;
    });
    var d2 = parseStoreJson(STORE_SECTIONS_DIR + '/' + irNumber + '.json', pick);
    idx.irs[irNumber] = pick.getId();
    writeSectionsIndex(idx);
    return { fileId: pick.getId(), data: (d2 && typeof d2 === 'object') ? d2 : {}, duplicates: hits.length > 1 ? hits.length : 0 };
  }

  if (!create) return { fileId: null, data: {} };

  var file = storeFolderFor(STORE_SECTIONS_DIR + '/x', true)
    .createFile(irNumber + '.json', '{}', MimeType.PLAIN_TEXT);
  idx.irs[irNumber] = file.getId();
  writeSectionsIndex(idx);
  return { fileId: file.getId(), data: {} };
}

// Every file of that name, not just the first. Used only by the self-healing fallback.
function findAllByName(path) {
  var folder = storeFolderFor(path, false);
  if (!folder) return [];
  var it = folder.getFilesByName(storeNameFor(path));
  var out = [];
  while (it.hasNext()) out.push(it.next());
  return out;
}

// Write a ticket's sections file.
//
// BY ID, NOT BY NAME, and that is the whole point. Resolving the file with a name
// search on the WRITE path re-opens exactly the hole sections/index.json closes: a
// Drive search is eventually consistent, so a save a moment after the file was created
// can miss it, `createFile` a SECOND IR409.json, and fork the ticket — after which
// reads and writes alternate between two files and each looks like the other's data
// is missing. `writeJson` resolves by name and is therefore right for the fixed-name
// stores and wrong for this one. The caller passes the id readIR already resolved, so
// in practice no lookup happens here at all.
function writeIR(irNumber, data, fileId) {
  var path = STORE_SECTIONS_DIR + '/' + irNumber + '.json';
  if (!fileId) throw new Error('refusing to write ' + path + ' without the file id from readIR() — ' +
                               'a name lookup here is how a ticket gets forked in two.');
  var file = DriveApp.getFileById(fileId);   // throws if the indexed file is gone: refuse, never fork
  file.setContent(JSON.stringify(data));
  _storeMemo[path] = data;
}

// ── THE APPEND-ONLY AUDIT ─────────────────────────────────────────────────────
// audit/IR409.jsonl — one JSON object per line. Per-IR rather than per-month:
// Drive has no atomic append, so every audit write rewrites the whole file, and a
// monthly shard reaches ~1.3 MB (~4 MB of I/O per save, worst on the last day of
// the month) while a ticket's own file is ~40 KB. It also kills the old
// `colB starts with '__'` trick — a __IRS__ patch is ABOUT IR409, so it belongs in
// IR409's log, and two people on different tickets never touch the same file.

function auditFileName(irNumber) { return irNumber + '.jsonl'; }

// The subject an audit line belongs to. A sentinel write is about the thing it
// names: `__IRS__`/IR409 is IR409's history, `__CONFIG__`/iqc-config has no ticket
// and goes to a file named for the store.
function auditSubjectFor(irNumber, sectionId) {
  if (String(irNumber) === '__IRS__') return String(sectionId);
  if (String(irNumber).indexOf('__') === 0) return String(irNumber).replace(/__/g, '');
  return String(irNumber);
}

function parseAuditLines(text, subject) {
  var out = [];
  String(text || '').split('\n').forEach(function (line) {
    var t = line.trim();
    if (!t) return;
    try { out.push(JSON.parse(t)); }
    catch (e) {
      // One bad line must not hide the rest of a ticket's history. Recorded as a
      // line the reader can SEE, never skipped silently.
      out.push({ timestamp: '', user: '', section: '', action: 'unreadable',
                 field: '', oldValue: '', newValue: '', note: subject + '.jsonl line skipped: ' + e.message });
    }
  });
  return out;
}

function readAuditLines(subject) {
  var folder = getStoreSubfolder(STORE_AUDIT_DIR, false);
  if (!folder) return [];
  var it = folder.getFilesByName(auditFileName(subject));
  if (!it.hasNext()) return [];
  return parseAuditLines(it.next().getBlob().getDataAsString(), subject);
}

// Appends to one subject's file. The caller HOLDS THE LOCK: this is a
// read-whole-file → append → write-whole-file, and two concurrent appends would
// otherwise drop one of the lines.
function appendAuditLinesLocked(subject, lines) {
  if (!lines || !lines.length) return 0;
  var folder = getStoreSubfolder(STORE_AUDIT_DIR, true);
  var name = auditFileName(subject);
  var it = folder.getFilesByName(name);
  var file, existing = '';
  if (it.hasNext()) {
    file = it.next();
    existing = file.getBlob().getDataAsString();
    if (existing && existing.charAt(existing.length - 1) !== '\n') existing += '\n';
  } else {
    file = folder.createFile(name, '', MimeType.PLAIN_TEXT);
  }
  var body = lines.map(function (l) { return JSON.stringify(l); }).join('\n');
  file.setContent(existing + body + '\n');
  return lines.length;
}

// ── THE SIGN-IN AUDIT ─────────────────────────────────────────────────────────
// audit/signins.jsonl — the same append-only shape a ticket's log uses, under a
// subject with no ticket. A sign-in is not ABOUT an IR, so it gets its own file
// rather than being smeared into one; `auditSubjectFor` already names a non-ticket
// store for its own subject, and this one is named for what it records.
//
// WHY IT EXISTS. A sign-in code is reusable for its whole lifetime by design (see
// loginOtpStep) — that is the feature, one mail covering the day. The cost is that a
// code read over someone's shoulder stays live until it expires, and until now
// NOTHING recorded that a sign-in had happened at all: the audit trail holds section
// saves, comments and archive moves, every one of them per-ticket, so there was no
// way to see a code used at 9am and again at 4pm from two different places. This is
// that record. It is read with `reportRecentSignins`, which is an operator lever run
// from the editor — there is deliberately no screen for it.
var SIGNIN_AUDIT_SUBJECT = 'signins';

// "47 min" / "7h 12m" — how long the code being redeemed had been alive. The AGE is
// the interesting part of the line: a code issued and redeemed within a minute is
// the ordinary case, while one issued at 9am and redeemed at 4pm is the shape of a
// code somebody else got hold of.
function codeAgeLabel(issuedAt, nowMs) {
  var t = asDate(issuedAt);
  if (!t) return 'age unknown';
  var mins = Math.max(0, Math.round((nowMs - t.getTime()) / 60000));
  if (mins < 60) return mins + ' min';
  return Math.floor(mins / 60) + 'h ' + ('0' + (mins % 60)).slice(-2) + 'm';
}

// One line per successful sign-in. `device` is what the BROWSER claimed, so it is a
// clue and not proof — the point is to make "signed in from two places" visible at a
// glance, not to establish who was at the keyboard.
//
// `method` says which door was used. Only the Google door passes anything, and it
// passes 'google': there is no code on that door, so recording a code's age would be
// inventing a fact. Every other caller — including every existing one — produces
// exactly the line it always did.
function signinAuditLine(email, codeIssuedAt, device, nowMs, method) {
  var note = (String(method || '') === 'google')
    ? 'google sso'
    : 'code ' + codeAgeLabel(codeIssuedAt, nowMs) + ' old';
  var dev  = String(device || '').trim().slice(0, 120);
  note += dev ? ' · ' + dev : ' · device not reported';
  return {
    t: Utilities.formatDate(new Date(nowMs), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss'),
    ir: '__AUTH__', sec: 'signin', by: String(email || ''),
    ev: 'signin', fid: '', old: '', nw: note
  };
}

// ── BACKUPS ───────────────────────────────────────────────────────────────────
// Always a NEW file, never an overwrite: a backup that can be overwritten by the
// next backup is not a rollback path. This replaces the dated
// APP_DATA_BACKUP_<date> tab the sheet version wrote before a destructive merge.
function snapshotStore(label, paths) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd-HHmmss');
  var name  = String(label || 'store') + '-' + stamp + '.json';
  var payload = { takenAt: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss'),
                  label: String(label || 'store'), files: {} };
  (paths || []).forEach(function (p) {
    var file = findStoreFile(p, false);
    payload.files[p] = file ? file.getBlob().getDataAsString() : null;
  });
  var folder = getStoreSubfolder(STORE_BACKUP_DIR, true);
  folder.createFile(name, JSON.stringify(payload), MimeType.PLAIN_TEXT);
  return name;
}

// ── ONE-TIME SETUP (run from the Apps Script editor) ──────────────────────────
// Creates `_store/` and its subfolders, and seeds the files that a read path is
// not allowed to create on its own. Nothing here is idempotent-by-accident: an
// existing file is left exactly as it is.
function initializeStore() {
  var root = getRootFolder();
  var it = root.getFoldersByName(CONFIG.STORE_FOLDER_NAME);
  var store = it.hasNext() ? it.next() : root.createFolder(CONFIG.STORE_FOLDER_NAME);

  // `_store/` must NOT be link-shared. The upload folders beside it are, and the
  // upload FILES are shared individually — but this folder holds password hashes,
  // salts and session tokens, so a link on it would hand them to anyone.
  store.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

  getStoreSubfolder(STORE_SECTIONS_DIR, true);
  getStoreSubfolder(STORE_AUDIT_DIR, true);
  getStoreSubfolder(STORE_BACKUP_DIR, true);

  var seeded = [];
  [['users.json', {}], ['sessions.json', { tokens: {} }], ['codes.json', { entries: [] }],
   ['attempts.json', {}], ['access.json', { departments: {}, memberships: {} }],
   ['irs.json', {}], ['config.json', {}], ['kb.json', {}], ['comments.json', {}],
   [STORE_INDEX, { irs: {} }]
  ].forEach(function (pair) {
    if (findStoreFile(pair[0], false)) return;
    writeJson(pair[0], pair[1]);
    seeded.push(pair[0]);
  });

  var out = 'Store folder: ' + store.getName() + ' (id ' + store.getId() + ')\n' +
            'Sharing: PRIVATE (not link-shared)\n' +
            'Seeded: ' + (seeded.length ? seeded.join(', ') : '(nothing — every file already existed)') + '\n' +
            'Next: seedDepartments() → seedMemberships() → bootstrapAdmin() → seedAccounts()';
  report(out);
  return out;
}

// The ONE place a stored value becomes a Date.
//
// Internal dates — session expiry, lockout-until, created-at, last-seen — are
// stored as epoch MILLISECONDS, because JSON has no date type. Stored as a
// display string instead, `exp < now` compares a string to a Date, coerces to
// NaN, and silently ACCEPTS an expired session. Only the audit `timestamp` stays
// a string, because the timeline prints it verbatim.
function asDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  var n = Number(v);
  if (!isNaN(n)) return new Date(n);
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// USERS — one record per account, keyed by lowercase email.
// { "someone@indrones.com": { hash, salt, createdAt, createdBy, mustChange,
//                             passwordChangedAt, status, name, lastLoginAt,
//                             tempPwIssuedAt } }
//
// There is NO self-signup. The admin creates every account from the app, which
// returns a one-time temporary password the admin hands over out-of-band. On
// first sign-in the user is FORCED to set their own password before any session
// is minted (see changePassword). Passwords are stored as SHA-256(salt+password)
// with a per-account random salt — the plain password is never stored, and a
// temporary password reaches the store only as a hash plus an issued-at stamp.
//
// Everyone who signs in gets VIEW + COMMENT on every section by default; EDIT
// comes only from department membership (see getEffectiveAccess).
function usersKey(email) { return String(email || '').toLowerCase().trim(); }

function allUsers() {
  var u = readJson('users.json');
  return (u && typeof u === 'object') ? u : {};
}

// One account record, or null. Never creates the file — an authority store is
// never brought into existence by a read.
function findUser(email) {
  var k = usersKey(email);
  return k ? (allUsers()[k] || null) : null;
}

// One field of a record, as a trimmed string (or '' when unset). The old
// `userCol(row, 'Name')` read a sheet column by its header; a record has names.
function userField(u, name) {
  if (!u) return '';
  var v = u[name];
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v.trim() : String(v);
}

// NOTE: there is deliberately no `saveUser(email, rec)` helper any more. Every
// write to users.json is a key assignment made INLINE inside the lock that read
// it, because the record being written has to be the one the lock protects — a
// helper taking a record from its caller cannot promise that, and one taking its
// own lock would be a nested lock on every path that already holds one.

// SESSIONS — { tokens: { "<uuid>": { email, createdAt, expiresAt, revokedAt } } }
//
// Keyed by the token itself, so a lookup is one key read and a revoke is one key
// assignment: no row scan, and nothing that can shift under a concurrent write.
//
// A MISSING or malformed sessions.json THROWS rather than reading as "nobody is
// signed in". initializeStore() creates the file, so its absence means the store
// is wrong, not that all twenty users logged out — and answering "no sessions"
// there would sign out the whole company in one poll window. See lookupSession.
function sessionsTokens() {
  var s = readJson('sessions.json');
  if (!s || !s.tokens || typeof s.tokens !== 'object') {
    throw new Error('Store file sessions.json is missing or malformed — run initializeStore() from the Apps Script editor.');
  }
  return s.tokens;
}

// Drop tokens that expired more than 7 days ago. Operates on an already-read
// store; the caller holds the lock and does the write.
function pruneSessionsIn(store) {
  var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  var n = 0;
  Object.keys(store.tokens).forEach(function (t) {
    var exp = asDate(store.tokens[t].expiresAt);
    if (!exp || exp.getTime() < cutoff) { delete store.tokens[t]; n++; }
  });
  return n;
}

// Revoke every session for an email IN an already-read store. Called on password
// change/reset and when an account is disabled — the cheap alternative to
// checking Status on every single authenticated request.
function revokeSessionsForIn(store, email) {
  email = usersKey(email);
  if (!email || !store || !store.tokens) return 0;
  var now = Date.now(), n = 0;
  Object.keys(store.tokens).forEach(function (t) {
    var s = store.tokens[t];
    if (usersKey(s.email) !== email) return;
    if (s.revokedAt) return;
    s.revokedAt = now;
    n++;
  });
  return n;
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

// Mint a fresh session token for an email and record it in the session store.
//
// Locked, and the read happens INSIDE the lock. In the sheet version this was an
// atomic `appendRow` and needed no lock; as a read-merge-write, a sign-in racing
// a session slide would lose the newly minted token and eject the user on their
// very next request. Throws if the lock cannot be taken — a failure to mint must
// never be mistaken for a token.
function mintSession(email) {
  return withRowLockOrThrow(function () {
    var store = readJsonLocked('sessions.json');
    if (!store || !store.tokens) store = { tokens: {} };
    var token = Utilities.getUuid();
    var now   = Date.now();
    store.tokens[token] = {
      email:      usersKey(email),
      createdAt:  now,
      expiresAt:  now + CONFIG.SESSION_HOURS * 60 * 60 * 1000,
      revokedAt:  null
    };
    // There is deliberately NO lastSeenAt. It existed for the sliding expiry, and
    // with an ABSOLUTE expiry nothing would ever update or read it — a field named
    // "last seen" that only ever held the mint time would be worse than absent,
    // because the next person to reason about session lifetime would believe it.
    // Opportunistic prune of long-expired tokens, in the same write. Never from
    // inside lookupSession, where a write would race the read it is serving.
    pruneSessionsIn(store);
    writeJsonLocked('sessions.json', store);
    return token;
  });
}

// Serialise a read-merge-write sequence against the Drive store.
//
// Drive has no transactions, no atomic append and no compare-and-set. Every store
// write is therefore a whole-file replace, and two concurrent writers that each
// read before the other wrote will lose one of the two changes. The sheet version
// did not have this problem for ordinary saves — two saves upserted two separate
// ROWS and could not clobber each other — so this lock is a genuine new cost of
// moving to files, and it is why it is not optional.
//
// The scope is precise: ONLY `read → merge → write` goes inside. A single global
// script lock is the only mutual exclusion Apps Script offers, so the goal is to
// keep the critical section short, not to avoid it. Uploads — base64 decode,
// createFile, setSharing, MailApp.sendEmail — all happen OUTSIDE.
//
// Two rules that matter, both about nesting:
//
//   • ONE locked entry point per action. Nested withRowLock calls are avoided by
//     construction, never by testing whether the lock is re-entrant — that is not
//     documented. A helper called from inside a lock takes the `*In` / `*Locked`
//     form that assumes the lock is already held.
//   • Read with readJsonLocked inside the lock, never readJson. readJson is
//     memoised per execution, so a value read before the lock was taken would
//     clobber whatever landed in between.
//
// Pure reads are deliberately NOT locked. getPassbook, getAuditLog, listIRs,
// sessionCheck and ping tolerate a slightly stale snapshot — which is already true
// today — and the frontend polls comments every 90s per user, so locking reads
// would put ~800 requests an hour in front of one lock.
function withRowLock(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    // Could not get the lock: refuse rather than proceed unprotected.
    return { status: 'error', message: LOCK_BUSY_MESSAGE };
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* execution ending anyway */ }
  }
}

// The same lock, for a path whose return value is NOT a response envelope — a
// session token, a count. Handing those an error OBJECT would read as success, so
// a failure to acquire the lock throws instead and the caller's own error
// handling answers.
function withRowLockOrThrow(fn) {
  var out = withRowLock(function () { return { ok: true, value: fn() }; });
  if (!out || out.ok !== true) throw new Error((out && out.message) || LOCK_BUSY_MESSAGE);
  return out.value;
}

// Says what happened in the user's terms: the save did not reach the server, so
// the app's "⚠ Retry Save" draft is the right thing to show. The old wording
// blamed "another admin change", which was alarming and simply wrong for an
// ordinary save that happened to overlap another one.
var LOCK_BUSY_MESSAGE = 'The server was busy and this change was NOT saved — please try again.';

// Revoke every session belonging to an email. Called on password change/reset and
// when an account is disabled — the cheap alternative to checking Status on every
// single authenticated request. Locked; see revokeSessionsForIn for the form that
// runs inside a lock the caller already holds.
function revokeAllSessions(email) {
  if (!usersKey(email)) return 0;
  return withRowLockOrThrow(function () {
    var store = readJsonLocked('sessions.json');
    if (!store || !store.tokens) return 0;
    var n = revokeSessionsForIn(store, email);
    if (n) writeJsonLocked('sessions.json', store);
    return n;
  });
}

// Delete session tokens that expired more than 7 days ago. Safe anytime; nothing
// calls it automatically except a best-effort prune at sign-in.
function pruneSessions() {
  return withRowLockOrThrow(function () {
    var store = readJsonLocked('sessions.json');
    if (!store || !store.tokens) return 0;
    var n = pruneSessionsIn(store);
    if (n) writeJsonLocked('sessions.json', store);
    return n;
  });
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

// Create an account with a temp password. Returns the plaintext ONCE — it is
// never written anywhere and cannot be recovered afterwards.
//
// Adds ONE key to users.json. The alternative — writing a fresh object holding
// just this account — would delete every other account in the company, which is
// the single most dangerous mis-reading of a keyed store.
function createUserRow(email, name, createdBy) {
  var k    = usersKey(email);
  if (!k) throw new Error('An account needs an email address.');
  var pw   = makeTempPassword();
  var salt = Utilities.getUuid();
  var now  = Date.now();
  return withRowLockOrThrow(function () {
    var store = readJsonLocked('users.json') || {};
    store[k] = {
      hash:              hashPassword(pw, salt),
      salt:              salt,
      createdAt:         now,
      createdBy:         createdBy || '',
      mustChange:        'yes',
      passwordChangedAt: null,
      status:            'active',
      name:              name || '',
      lastLoginAt:       null,
      // The stamp the temp-password TTL is measured from. Null on an account
      // whose password was set properly, and then the TTL never applies.
      tempPwIssuedAt:    now
    };
    writeJsonLocked('users.json', store);
    return pw;
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// RESET CODES — one generic store for the forgot-password flow. No external calls.
// ──────────────────────────────────────────────────────────────────────────────
// Replaces the old PENDING_SIGNUPS (sign-up is gone) with a single-purpose store
// for emailed 6-digit codes. `Attempts` is the important column: without it a
// 6-digit code is a million guesses against an endpoint anyone can reach, so a
// code dies after CODE_MAX_ATTEMPTS wrong tries regardless of its TTL.
var CODE_TTL_MIN        = 15;
// Sign-in codes last a working day, and are REUSABLE inside it: one email at the
// first sign-in covers every sign-in that day. Deliberately the same window as
// CONFIG.SESSION_HOURS — when the session dies, so does the code.
var LOGIN_OTP_TTL_MIN   = 510;         // 8h30m
var CODE_RESEND_GAP_MS  = 60 * 1000;   // min gap between code (re)issues per email
var CODE_MAX_PER_HOUR   = 3;           // throttle: codes issued per email per hour
var CODE_MAX_PER_HOUR_GLOBAL = 12;     // throttle: RESET codes across ALL emails per hour
var CODE_MAX_PER_HOUR_GLOBAL_LOGIN = 120;  // throttle: LOGIN codes across ALL emails per hour
var CODE_MAX_ATTEMPTS   = 5;           // wrong guesses before the code is burned
var MAIL_DAILY_CAP      = 400;         // ceiling on ALL app-sent mail per day (see mailQuotaOk)

// The global ceiling is PER PURPOSE, and the two differ by 10x on purpose.
//
// `reset` is unauthenticated — anyone can ask for a code for any address — so it
// keeps the tight 12/hour that stops a caller walking the staff list and spending
// the day's mail budget. `login` is issued only AFTER a correct password, so it
// cannot be walked that way, and it has to absorb the morning: with twenty people
// signing in between 9 and 10am, a shared ceiling of 12 would refuse a code to
// everyone after the twelfth and the app would look broken at exactly the moment
// the whole company is trying to start work.
function globalCodeCap(purpose) {
  return purpose === 'login' ? CODE_MAX_PER_HOUR_GLOBAL_LOGIN : CODE_MAX_PER_HOUR_GLOBAL;
}

// CODES — { entries: [ { email, code, purpose, createdAt, expiresAt, attempts,
//                        used } ] }, newest last.
//
// A LIST rather than one record per email, because the throttle needs HISTORY,
// not the current code: "how many codes has this address asked for in the last
// hour" is a count over issued codes, and a one-per-email record would forget
// every code it replaced. Entries older than a day are dropped on write, so the
// file stays small — the longest window any reader asks about is one hour.
//
// THREE PURPOSES live here and they are not interchangeable:
//   'reset'  — 6 digits, emailed, 15 min, single use.
//   'login'  — 6 digits, emailed, 8h30m, REUSABLE inside the day.
//   'google' — 32 hex chars, NEVER emailed: it is the one-time handoff the Google
//              door hands back to the browser in a URL fragment. It is looked up BY
//              CODE, not by email (the app knows the code and not yet the address),
//              and it is deliberately invisible to the emailed-code throttle below:
//              counting it would let three Google sign-ins in an hour spend a
//              person's budget for a password reset. See issueHandoff / redeemHandoff.
function codesEntries() {
  var c = readJson('codes.json');
  return (c && c.entries instanceof Array) ? c.entries : [];
}

// The newest live (unused) entry for an email + purpose, or null. Returns the
// entry OBJECT inside the store, so the caller mutates it in place and writes the
// store once — there is no index to remember and nothing to shift.
function findCodeEntry(entries, email, purpose) {
  var k = usersKey(email);
  for (var i = entries.length - 1; i >= 0; i--) {
    var e = entries[i];
    if (usersKey(e.email) !== k) continue;
    if (String(e.purpose) !== purpose) continue;
    if (e.used) continue;
    return e;
  }
  return null;
}

// Drop entries older than a day. A window longer than any reader asks about, so
// pruning can never change an answer.
function pruneCodesIn(entries) {
  var cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return entries.filter(function (e) {
    var t = asDate(e.createdAt);
    return !!t && t.getTime() >= cutoff;
  });
}

// 6-digit numeric code (100000–999999). GAS server runtime: Math.random is fine.
function makeResetCode() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

// ── ONE ISSUE PATH FOR EVERY EMAILED CODE ────────────────────────────────────
// Shared by forgotPassword (purpose 'reset') and the sign-in OTP (purpose
// 'login'). Both want the same shape — a per-email budget, a resend gap, a global
// ceiling, and only the newest live code redeemable — and two copies of a
// security throttle is how one of them quietly stops working.
//
// Returns the code, or null when throttled. The CALLER sends the mail, OUTSIDE
// this lock: MailApp.sendEmail is slow and must not hold it.
function issueAuthCode(email, purpose, ttlMin) {
  return withRowLockOrThrow(function () {
    var raw = readJsonLocked('codes.json');
    var entries = pruneCodesIn((raw && raw.entries instanceof Array) ? raw.entries : []);
    var now = Date.now();
    var hourAgo = now - 60 * 60 * 1000;
    var recent = 0, newestMs = 0, recentSamePurpose = 0;
    entries.forEach(function (e) {
      // A Google handoff code is not an emailed code and must not be counted here.
      // It costs no mail, it is not guessable, and it is not something a person
      // "asks for" — so spending the hourly budget on it would mean three Google
      // sign-ins silently refusing a colleague their password reset, which is the
      // one path back into a locked account.
      if (String(e.purpose) === 'google') return;
      var at = asDate(e.createdAt);
      var createdMs = at ? at.getTime() : 0;
      if (createdMs > hourAgo && String(e.purpose) === purpose) recentSamePurpose++;
      if (usersKey(e.email) !== email) return;
      // The per-email budget counts codes of ANY purpose: one person, one budget,
      // so asking for a reset cannot buy extra sign-in codes in the same hour.
      if (createdMs > hourAgo) recent++;
      if (createdMs > newestMs) newestMs = createdMs;
    });
    if (recent >= CODE_MAX_PER_HOUR) return null;
    if (newestMs && (now - newestMs) < CODE_RESEND_GAP_MS) return null;
    if (recentSamePurpose >= globalCodeCap(purpose)) return null;

    // Retire any earlier live code of this purpose, so only the newest redeems.
    entries.forEach(function (e) {
      if (usersKey(e.email) === email && String(e.purpose) === purpose && !e.used) e.used = true;
    });
    var code = makeResetCode();
    entries.push({ email: email, code: code, purpose: purpose, createdAt: now,
                   expiresAt: now + ttlMin * 60 * 1000, attempts: 0, used: false });
    writeJsonLocked('codes.json', { entries: entries });
    return code;
  });
}

// The REDEEM itself, lock-free: the caller holds the lock and owns the write.
//
// It is split out because resetPassword redeems inside a bigger lock that covers
// codes.json, users.json AND sessions.json together — a reset is one event, and
// splitting it across locks would let a second redeem of the same code slip
// between them. Sign-in has no such coupling, so it uses verifyAuthCode below,
// which takes its own lock. Nested locks are forbidden, hence the split.
//
// Returns null when the code is good, or an error envelope to return verbatim.
// Mutates `entries` (attempts / used); the caller persists.
//
// `consume` is the whole difference between the two callers. A RESET code is
// burned on use — one reset, one code. A SIGN-IN code is deliberately NOT: it
// stays valid for its full working day so the same code covers every sign-in that
// day, which is the entire point of the 8h30m window. What still bounds abuse is
// the attempt counter, which is shared across the day for the same reason.
function redeemCodeIn(entries, email, purpose, code, consume) {
  var isLogin = (purpose === 'login');
  var again   = isLogin ? ' sign in again to get a new one.' : ' request a new one.';

  var found = findCodeEntry(entries, email, purpose);
  if (!found) {
    // Reached when no code was ever issued AND when the live one was used up —
    // burned by five wrong guesses, or expired. The wording has to fit both, so it
    // says there is no ACTIVE code rather than that none was sent.
    return { status: 'error', message: isLogin
      ? 'No sign-in code is active for this address —' + again
      : 'No reset code is outstanding for this email —' + again };
  }

  var expires = asDate(found.expiresAt);
  if (expires && expires.getTime() < Date.now()) {
    found.used = true;
    return { status: 'error', message: 'That code expired —' + again };
  }
  if (String(found.code).trim() !== String(code)) {
    var tries = (Number(found.attempts) || 0) + 1;
    if (tries >= CODE_MAX_ATTEMPTS) {
      found.used = true;                     // burn it — a 6-digit code gets 5 guesses
      found.attempts = tries;
      return { status: 'error', message: 'Too many wrong codes —' + again };
    }
    found.attempts = tries;
    // The count is deliberately per CODE, not per IP: GAS web apps expose no
    // reliable client address, and the entry is the only thing that can be
    // counted honestly.
    return { status: 'error', message: 'Wrong code. ' + (CODE_MAX_ATTEMPTS - tries) + ' attempt(s) left.' };
  }

  if (consume) found.used = true;
  return null;
}

// Redeem an emailed code under its own lock. See redeemCodeIn for the split.
//
// Writes even when nothing changed (a clean sign-in with consume=false, or a
// "no active code" miss). That is deliberate and safe rather than sloppy: the
// read is inside the lock, so the file being rewritten is the one just read, and
// a concurrent issue cannot be clobbered. Tracking a dirty flag to save one small
// write would buy less than the bug it could hide.
function verifyAuthCode(email, purpose, code, consume) {
  return withRowLockOrThrow(function () {
    var raw = readJsonLocked('codes.json');
    var entries = (raw && raw.entries instanceof Array) ? raw.entries : [];
    var err = redeemCodeIn(entries, email, purpose, code, consume);
    writeJsonLocked('codes.json', { entries: entries });
    return err;
  });
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
//
// `notice` is in the RESERVED group, not the free one, and that is the point of
// naming it at all. A restore notice is triggered by a signed-in user's action
// (see restoreField), so it is user-paced like a comment — an uncapped class here
// would let a busy afternoon of restores spend the slots that are the only way back
// into a locked account. It is a low-volume path today, but "low volume" is a
// property of the current UI, not of this function, and the ceiling is the one
// place that can promise it.
var MAIL_AUTH_RESERVE = 40;

function mailQuotaOk(kind) {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var key   = 'mailcount:' + today;
  var n = Number(props.getProperty(key) || 0);
  var reserved = (kind === 'nudge' || kind === 'notice');
  var ceiling = reserved ? Math.max(0, MAIL_DAILY_CAP - MAIL_AUTH_RESERVE) : MAIL_DAILY_CAP;
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

// ──────────────────────────────────────────────────────────────────────────────
// ADMIN NOTICES — one email per event the admin should hear about as it happens.
// ──────────────────────────────────────────────────────────────────────────────
// Today that is exactly one thing: somebody put an old value back (restoreField).
// The owner's reason for wanting it is traceability — hear about it now rather than
// reconstruct it later from a failure:
//
//   "All high level notification may come to admin, its better for traceability and
//    ease instead of waiting for failure point and then backtracing via
//    investigation, time taking."
//
// Same swallowing contract as sendAuthMail, and it matters MORE here: this runs
// AFTER a restore has already been written to the store, so a mail failure must not
// be reported as a failed restore. It returns true/false, and the caller says
// "saved, but no email was sent" in words.
//
// The recipient set is CONFIG.ADMIN_EMAILS filtered through the same
// isMailRecipientAllowed guard every other outbound mail uses, so this can never
// become a way to mail an address the app is not allowed to reach.
function sendAdminNotice(subject, body, replyTo) {
  var recipients = (CONFIG.ADMIN_EMAILS || []).filter(function (a) {
    return isMailRecipientAllowed(a);
  });
  if (!recipients.length) return false;
  if (!mailQuotaOk('notice')) return false;
  var options = { name: 'I-PASSBOOK' };
  // The VERIFIED caller, so the admin can reply straight to whoever did it. Same
  // rule as sendNudgeEmail: never a client-supplied address.
  if (replyTo) options.replyTo = replyTo;
  try {
    MailApp.sendEmail(recipients.join(','), subject, body, options);
    return true;
  } catch (e) { return false; }
}

// A ticket's own address in the deployed app, built from CONFIG.APP_URL and
// nothing else — see the note there on why a client-supplied URL is refused. The
// app is hash-routed, so this lands on the ticket's own screen. Returns '' when
// APP_URL is blank, and every caller must then simply leave the link out.
function irDeepLink(irNumber) {
  var base = String(CONFIG.APP_URL || '');
  if (!base) return '';
  return base + '#/tickets/' + encodeURIComponent(String(irNumber || ''));
}

// One client-supplied DISPLAY string, cleaned for a notice. Section and field
// labels live in the FRONTEND's form registry — the backend has no copy and cannot
// resolve them — so the caller sends them alongside the restore. They are shown,
// never used to resolve anything, so this trims, drops control characters, caps the
// length and falls back to the id. Same trust level as sendNudgeEmail's `context`
// and `fromName`, which are client-supplied display strings too.
function noticeLabel(raw, fallback) {
  var s = String(raw == null ? '' : raw).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 80) s = s.substring(0, 80) + '…';
  return s || String(fallback || '');
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
// to it: it verified the hash, then minted a full session. The TTL was
// decorative — it closed the login door while the change-password door stood open
// beside it. If a third endpoint ever accepts this credential, call these too.
function isTempPasswordAccount(u) {
  return userField(u, 'mustChange').toLowerCase() === 'yes';
}

// Returns an error object when the temp password is past its life, else null.
function tempPasswordExpired(u) {
  var issued = userField(u, 'tempPwIssuedAt');
  if (!issued) return null;                 // never stamped → never expires
  var at = asDate(issued);
  if (!at) return null;                     // unreadable stamp → never expires
  var ageDays = (Date.now() - at.getTime()) / 86400000;
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
  var email    = usersKey(params.email);
  var current  = (params.currentPassword || '').toString();
  var next     = (params.newPassword || '').toString();
  if (!email || !current || !next) return { status: 'error', message: 'Enter your email, current password and a new password.' };
  if (next.length < 8) return { status: 'error', message: 'New password must be at least 8 characters.' };
  if (next === current) return { status: 'error', message: 'New password must be different from the current one.' };

  var locked = lockoutRemaining(email);
  if (locked) return locked;

  var u = findUser(email);
  // Generic on purpose: "no account" and "wrong password" must be the same
  // response, or this endpoint enumerates who has an I-PASSBOOK account.
  if (!u) { recordFailedLogin(email); return { status: 'error', message: 'Email or password is incorrect.' }; }
  if (userField(u, 'status').toLowerCase() === 'disabled') {
    return { status: 'error', message: 'This account has been disabled. Ask an admin to re-enable it.' };
  }
  // The temp-password clock applies HERE TOO — see the note above. Without this
  // line an expired temp password still buys a session through this door.
  if (isTempPasswordAccount(u)) {
    var stale = tempPasswordExpired(u);
    if (stale) return stale;
  }
  if (hashPassword(current, String(u.salt)) !== String(u.hash)) {
    var until = recordFailedLogin(email);
    if (until) return { status: 'error', message: 'Wrong password. Account locked for ' + Math.round(LOGIN_LOCK_MS / 60000) + ' min after too many attempts.' };
    return { status: 'error', message: 'Email or password is incorrect.' };
  }

  var salt = Utilities.getUuid();
  var now  = Date.now();
  // ONE locked read-merge-write covering the account and the sessions. Written
  // as one key assignment per store, and the account's identity fields (created
  // at, created by) are carried over rather than re-derived — this is the same
  // account, not a new one.
  withRowLockOrThrow(function () {
    var users = readJsonLocked('users.json') || {};
    var rec = users[email];
    if (!rec) throw new Error('Your account could not be read — try again in a moment.');
    rec.hash              = hashPassword(next, salt);
    rec.salt              = salt;
    rec.mustChange        = '';
    rec.passwordChangedAt = now;
    rec.status            = rec.status || 'active';
    rec.tempPwIssuedAt    = null;
    writeJsonLocked('users.json', users);

    // Any session the temp password ever minted dies here. (It shouldn't have
    // been able to mint one, but a revoked-anything is cheaper than trusting
    // that.) Done in the SAME lock so the revoke cannot interleave with a
    // concurrent sign-in's mint.
    var sess = readJsonLocked('sessions.json');
    if (sess && sess.tokens) {
      if (revokeSessionsForIn(sess, email)) writeJsonLocked('sessions.json', sess);
    }
  });

  clearFailedLogin(email);
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
    var u = findUser(email);
    if (!u) return generic;                         // no enumeration
    if (userField(u, 'status').toLowerCase() === 'disabled') return generic;

    // The throttle and the lock both live in issueAuthCode now — this endpoint
    // and the sign-in OTP were carrying two copies of the same judgement, and the
    // second copy is where a security throttle rots. A null here means throttled,
    // which is answered with the SAME generic message (see above) rather than an
    // error, so the throttle is not itself an oracle.
    var issued = issueAuthCode(email, 'reset', CODE_TTL_MIN);

    if (issued) {
      sendAuthMail(email, 'Your I-PASSBOOK password reset code',
        'Your I-PASSBOOK password reset code is ' + issued + '.\n\n' +
        'It expires in ' + CODE_TTL_MIN + ' minutes. If you did not ask to reset your password, ' +
        'you can ignore this email — your current password still works.');
    }
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

  // ONE locked read-merge-write covering codes.json, users.json and sessions.json
  // together, because a redeem is a single event: the code is consumed, the
  // password changes, and every other device is signed out. Split across separate
  // locks, a second redeem of the same code could slip between them.
  var outcome = withRowLockOrThrow(function () {
    var now = Date.now();
    var raw = readJsonLocked('codes.json');
    var entries = (raw && raw.entries instanceof Array) ? raw.entries : [];
    var saveCodes = function () { writeJsonLocked('codes.json', { entries: entries }); };

    // Lock-free redeem (see redeemCodeIn) — it is called HERE rather than through
    // verifyAuthCode precisely because this lock is the wide one: taking the
    // one-file lock inside this one would nest, and nesting is what deadlocks.
    // consume=true: a reset code is spent by the reset it performs.
    var badCode = redeemCodeIn(entries, email, 'reset', code, true);
    if (badCode) { saveCodes(); return badCode; }

    var users = readJsonLocked('users.json') || {};
    var rec = users[email];
    if (!rec) return { status: 'error', message: 'No account found for this email.' };
    // A disabled account stays disabled. Without this, "Disable" was reversible
    // by the person it was aimed at: forgotPassword refuses to ISSUE a code to a
    // disabled account, but a code issued shortly BEFORE the disable is still
    // live for its full window — redeeming it used to flip Status back to
    // 'active' and hand them a working password. Offboarding a person mid-reset
    // is exactly the case that hits this, so the guard is on the redeem, not
    // just the issue.
    if (userField(rec, 'status').toLowerCase() === 'disabled') {
      return { status: 'error', message: 'This account has been disabled. Ask an admin to re-enable it.' };
    }

    var salt = Utilities.getUuid();
    rec.hash              = hashPassword(next, salt);
    rec.salt              = salt;
    rec.mustChange        = '';
    rec.passwordChangedAt = now;
    rec.tempPwIssuedAt    = null;
    // Status is PRESERVED, never written as a literal 'active' — the guard above
    // has already refused the only case where that would matter, and this
    // endpoint has no business changing whether an account is enabled.
    writeJsonLocked('users.json', users);
    saveCodes();   // persist the consume=true above — the code is spent by this reset

    var sess = readJsonLocked('sessions.json');
    if (sess && sess.tokens && revokeSessionsForIn(sess, email)) writeJsonLocked('sessions.json', sess);
    return { status: 'ok', message: 'Password set. Sign in with your new password.' };
  });

  clearFailedLogin(email);
  return outcome;
}

// ──────────────────────────────────────────────────────────────────────────────
// LOGIN LOCKOUT — brute-force guard (matters on a shared/handed-off device).
// ──────────────────────────────────────────────────────────────────────────────
// After MAX wrong passwords within a rolling window, the account is locked for
// LOCK_MIN. Tracked per email in LOGIN_ATTEMPTS. Successful login clears it.
// After MAX wrong passwords within a rolling window, the account is locked for
// LOCK_MIN. Tracked per email in attempts.json.
// { "someone@indrones.com": { count, windowStart, lockedUntil } }
var LOGIN_MAX_FAILS = 5;
var LOGIN_WINDOW_MS = 10 * 60 * 1000;   // 10-min rolling window
var LOGIN_LOCK_MS   = 15 * 60 * 1000;   // 15-min lockout

function attemptsStore() {
  var a = readJson('attempts.json');
  return (a && typeof a === 'object') ? a : {};
}

// Record a failed attempt. Returns the lockout-until epoch ms, or null.
//
// Locked: it is a read-merge-write of one key, and two wrong guesses arriving
// together must count as two rather than one, or the lockout is trivially
// defeated by sending the guesses in parallel.
function recordFailedLogin(email) {
  var k = usersKey(email);
  if (!k) return null;
  return withRowLockOrThrow(function () {
    var store = readJsonLocked('attempts.json') || {};
    var now = Date.now();
    var rec = store[k];
    var count = 1, windowStart = now, lockedUntil = null;
    if (rec) {
      var ws = asDate(rec.windowStart);
      if (!ws || (now - ws.getTime()) > LOGIN_WINDOW_MS) { count = 1; windowStart = now; }
      else { count = (Number(rec.count) || 0) + 1; windowStart = ws.getTime(); }
    }
    if (count >= LOGIN_MAX_FAILS) lockedUntil = now + LOGIN_LOCK_MS;
    store[k] = { count: count, windowStart: windowStart, lockedUntil: lockedUntil };
    writeJsonLocked('attempts.json', store);
    return lockedUntil;
  });
}

// Clear the attempt record on a successful login (best-effort — a failure here
// must never fail the sign-in that just succeeded).
function clearFailedLogin(email) {
  var k = usersKey(email);
  if (!k) return;
  try {
    withRowLockOrThrow(function () {
      var store = readJsonLocked('attempts.json');
      if (!store || !store[k]) return;
      delete store[k];
      writeJsonLocked('attempts.json', store);
    });
  } catch (e) { /* best-effort */ }
}

// Shared lockout gate. Returns a ready-to-return error object while the account
// is locked, else null. Used by BOTH login and changePassword — the forced
// first-login change takes a password too, so it must be throttled identically.
function lockoutRemaining(email) {
  var rec = attemptsStore()[usersKey(email)];
  if (!rec) return null;
  var locked = asDate(rec.lockedUntil);
  if (!locked) return null;
  var now = Date.now();
  if (locked.getTime() <= now) return null;
  var mins = Math.max(1, Math.ceil((locked.getTime() - now) / 60000));
  return { status: 'error', message: 'Too many wrong attempts. Try again in ' + mins + ' min.' };
}

// Sign in: verify email + password against the USERS tab, then mint a session.
//
// A user whose row still says "Must Change Password" gets NO session token back —
// only the flag. That is what makes the forced first change unskippable: there is
// no credential to skip to, so deleting the screen in devtools buys nothing.
function doLoginPassword(params) {
  var email    = usersKey(params.email);
  var password = (params.password || '').toString();
  if (!email || !password) return { status: 'error', message: 'Enter your email and password.' };

  // Lockout check (applies whether or not the account exists — avoids leaking
  // which emails have accounts, and stops password guessing on a shared device).
  var locked = lockoutRemaining(email);
  if (locked) return locked;

  var u = findUser(email);
  if (!u) {
    recordFailedLogin(email);
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

  var salt     = String(u.salt);
  var expected = String(u.hash);
  if (hashPassword(password, salt) !== expected) {
    var until = recordFailedLogin(email);
    if (until) {
      var mins2 = Math.max(1, Math.round(LOGIN_LOCK_MS / 60000));
      return { status: 'error', message: 'Wrong password. Account locked for ' + mins2 + ' min after too many attempts.' };
    }
    return { status: 'error', message: 'Wrong password.' };
  }

  if (userField(u, 'status').toLowerCase() === 'disabled') {
    recordFailedLogin(email);
    return { status: 'error', message: 'This account has been disabled. Ask an admin to re-enable it.' };
  }

  // First sign-in on an admin-issued temporary password: stop here and force the
  // change. A temp password also EXPIRES, so one read off a chat message stops
  // being a credential after TEMP_PW_TTL_DAYS whether or not it was ever used.
  if (isTempPasswordAccount(u)) {
    var stale = tempPasswordExpired(u);
    if (stale) return stale;
    clearFailedLogin(email);
    return { status: 'ok', mustChangePassword: true, email: email, name: userField(u, 'Name') };
  }

  clearFailedLogin(email);

  // ── SECOND FACTOR: the emailed sign-in code ────────────────────────────────
  // Sign-in is two steps. The password is verified above; the caller then has to
  // redeem a 6-digit code that was emailed. A caller who reaches here has already
  // proved the password, so everything below runs on a VERIFIED identity — which
  // is exactly why the code's throttle can be far looser than the reset code's
  // (see globalCodeCap).
  //
  // Placed AFTER the temp-password branch on purpose: a temp-password holder is
  // being sent to the forced-change screen and has no session anyway, so asking
  // them for an emailed code first would be a step that buys nothing.
  var otpInfo = {};
  var otpStep = loginOtpStep(email, params.code, userField(u, 'Name'), otpInfo);
  if (otpStep) return otpStep;

  // Last-login stamp. Best-effort: a failure to record it must never fail a
  // sign-in that has already been verified.
  try {
    withRowLockOrThrow(function () {
      var users = readJsonLocked('users.json');
      if (!users || !users[email]) return;
      users[email].lastLoginAt = Date.now();
      writeJsonLocked('users.json', users);
    });
  } catch (e) { /* non-fatal */ }

  // The sign-in audit, in its OWN try so that a failure to write the log can never
  // reach the caller as a failed login. This is the whole contract of the record: a
  // log that sometimes blocks the door it is meant to watch is worse than no log,
  // so nothing here is allowed to throw outward.
  try {
    var signinAt = Date.now();
    withRowLockOrThrow(function () {
      appendAuditLinesLocked(SIGNIN_AUDIT_SUBJECT,
        [signinAuditLine(email, otpInfo.codeIssuedAt, params.device, signinAt)]);
    });
  } catch (e) { /* non-fatal */ }

  var token = mintSession(email);
  return { status: 'ok', sessionToken: token, email: email, access: getMyAccess(email) };
}

// ── GOOGLE SIGN-IN — A SECOND DOOR, NEVER A REPLACEMENT ───────────────────────
//
// For anyone whose browser is already signed into their @indrones.com Workspace
// account, this reads the address Google reports for the CALLER and nothing else.
// No password, no emailed code: on this door the Workspace session IS the factor.
//
// It is deliberately additive. `doLoginPassword` above is untouched and stays a
// first-class door — the recovery path for a machine with no Google session (a
// shared laptop, a lab PC, a phone signed into a personal account), and the ONLY
// door for the external address in CONFIG.EXTERNAL_EMAILS, which no domain-
// restricted deployment will admit. The forced first-login change still stands in
// password mode, and this door REFUSES a temp-password account and points it at
// that door rather than quietly handing it a session: minting one here would be the
// exact bypass the no-token rule in doLoginPassword exists to prevent.
//
// getActiveUser, NEVER getEffectiveUser. The latter returns the SCRIPT OWNER, so
// under "Execute as: Me" it would report monish.raza for every caller on earth and
// make everyone the same person. That one word is the difference between an
// identity source and a catastrophic one.
//
// This only works from a deployment whose access is "Anyone within indrones.com".
// Under plain "Anyone", getActiveUser() returns '' for every caller and the ladder
// below refuses every time — a closed door, never a broken one. See docs/05.
function googleCallerEmail() {
  try {
    var u = Session.getActiveUser();
    return usersKey(u && u.getEmail ? u.getEmail() : '');
  } catch (e) {
    return '';
  }
}

// The refusal ladder, shared by the probe and the door so the button is only ever
// offered where the door would actually open. Returns { error } to refuse, or
// { email, user } to admit.
//
// Every branch gives the SAME answer the password door gives for the same
// condition, so someone who tries both doors is never told two different things.
function googleDoorCheck() {
  var email = googleCallerEmail();
  if (!email) {
    return { error: { status: 'error', message: 'Google did not report an account for this browser. Use your email and password instead.' } };
  }
  var at = email.lastIndexOf('@');
  if ((at === -1 ? '' : email.slice(at + 1)) !== CONFIG.ALLOWED_DOMAIN) {
    return { error: { status: 'error', message: 'Sign in with your @' + CONFIG.ALLOWED_DOMAIN + ' Google account, or use your email and password instead.' } };
  }
  // There is still NO self-signup. A Google account is an identity, not a
  // membership: the admin provisions the row exactly as before, and this door
  // cannot create one, re-enable one, or hand one a first password.
  var u = findUser(email);
  if (!u) {
    return { error: { status: 'error', message: 'No account found for this email — ask an admin to create one.' } };
  }
  if (userField(u, 'status').toLowerCase() === 'disabled') {
    return { error: { status: 'error', message: 'This account has been disabled. Ask an admin to re-enable it.' } };
  }
  if (isTempPasswordAccount(u)) {
    var stale = tempPasswordExpired(u);
    if (stale) return { error: stale };
    return { error: { status: 'error', message: 'Set your own password first: sign in with your temporary password, then use Google from then on.' } };
  }
  return { email: email, user: u };
}

// ── THE HANDOFF CODE — what the Google door hands back to the browser ─────────
//
// The door cannot return a session directly. It is a NAVIGATION: the browser is
// on script.google.com, not in the app, so all this deployment can do is offer the
// browser a link back to CONFIG.APP_URL — and it must carry something that proves,
// once it arrives, which Workspace account opened the door. That something is a
// handoff code, and it travels in the URL FRAGMENT (`#sso=…`) for one reason:
// fragments are never sent to a server, so the code cannot land in a proxy log, a
// CDN log or a Referer header on the way back.
//
// 32 hex characters from Utilities.getUuid — about 122 bits, so it is not
// guessable, which is what makes googleExchange safe to serve from the "Anyone"
// deployment where no Google session is attached. Unlike the emailed 6-digit code
// it needs no attempt counter: an attacker cannot walk 122 bits, and the counter
// exists only because 6 digits IS walkable.
var HANDOFF_TTL_MIN = 2;

// Look an entry up BY CODE. This is the whole reason a handoff is not the same
// thing as an emailed code: at the moment the browser comes back, the app has a
// code and not yet an email — an emailed code is looked up by the address it was
// sent to, and there is nothing to look it up by here.
function findHandoffIn(entries, code) {
  var want = String(code || '').trim();
  if (!want) return null;
  for (var i = entries.length - 1; i >= 0; i--) {
    var e = entries[i];
    if (String(e.purpose) !== 'google') continue;
    if (String(e.code) !== want) continue;
    return e;                       // used/expired entries are judged by the caller
  }
  return null;
}

// Issue one, retiring any earlier live handoff for the same address — so asking
// twice in two minutes cannot leave two working codes in the wild.
function issueHandoff(email) {
  return withRowLockOrThrow(function () {
    var raw = readJsonLocked('codes.json');
    var entries = pruneCodesIn((raw && raw.entries instanceof Array) ? raw.entries : []);
    var now = Date.now();
    var k = usersKey(email);
    entries.forEach(function (e) {
      if (String(e.purpose) === 'google' && usersKey(e.email) === k && !e.used) e.used = true;
    });
    var code = Utilities.getUuid().replace(/-/g, '');
    entries.push({ email: k, code: code, purpose: 'google', createdAt: now,
                   expiresAt: now + HANDOFF_TTL_MIN * 60 * 1000, attempts: 0, used: false });
    writeJsonLocked('codes.json', { entries: entries });
    return code;
  });
}

// Redeem one: single use, and it dies on the first look whatever the outcome, so
// a code that was seen by the wrong browser cannot be tried again.
//
// `used` is checked, not merely set. findHandoffIn deliberately returns a spent
// entry when the code matches — the code is the address and a caller holding a
// used one must get the same refusal as any other, rather than a different answer
// that would tell them the code was real once.
//
// The refusals deliberately do NOT say whether the code existed and expired, or
// never existed at all. Both are answered the same way because the caller here is
// unauthenticated — distinguishing them would turn this action into an oracle for
// "is this a real handoff code", which is the one thing a 122-bit secret must not
// be asked.
function redeemHandoff(code) {
  var refused = { error: { status: 'error', message: 'That Google sign-in link is no longer valid — click Sign in with Google again.' } };
  return withRowLockOrThrow(function () {
    var raw = readJsonLocked('codes.json');
    var entries = (raw && raw.entries instanceof Array) ? raw.entries : [];
    var found = findHandoffIn(entries, code);
    if (!found || found.used) return refused;
    found.used = true;
    writeJsonLocked('codes.json', { entries: entries });
    // An unreadable expiry refuses. There is no third answer here: a handoff is
    // either fresh enough to use or it is not, and treating "cannot tell" as fresh
    // would be the one way to make a 2-minute window unbounded.
    var exp = asDate(found.expiresAt);
    if (!exp || exp.getTime() < Date.now()) return refused;
    return { email: usersKey(found.email) };
  });
}

// Everything after a Google identity has been established, shared by the two
// halves so they cannot drift: the handoff door must produce exactly the session
// the direct door did — same last-login stamp, same `google sso · <device>` audit
// line, same mint. Extracted rather than copied because the two halves run on two
// DIFFERENT deployments, and a fix applied to one of two copies is a bug the next
// reader cannot see.
//
// Deliberately NO lockout bookkeeping here, in either direction. Not
// recordFailedLogin: a Workspace session is not guessable, so there is nothing to
// throttle. And not clearFailedLogin either — someone fumbling their PASSWORD must
// not be able to wash that counter away by clicking this button. The counter
// belongs to the password door, and only the password door moves it.
function mintGoogleSession(email, device) {
  // Last-login stamp, best-effort, exactly as the password door records it:
  // failing to record it must never fail a sign-in that is already authenticated.
  try {
    withRowLockOrThrow(function () {
      var users = readJsonLocked('users.json');
      if (!users || !users[email]) return;
      users[email].lastLoginAt = Date.now();
      writeJsonLocked('users.json', users);
    });
  } catch (e) { /* non-fatal */ }

  // The sign-in audit, in its OWN try and closed before the session is minted.
  // Same contract as the password door: a log that can block the door it watches
  // is worse than no log, so nothing here may throw outward. The method argument
  // is what makes the line read `google sso · <device>` instead of claiming a code
  // was redeemed on a door that has no code.
  try {
    var signinAt = Date.now();
    withRowLockOrThrow(function () {
      appendAuditLinesLocked(SIGNIN_AUDIT_SUBJECT,
        [signinAuditLine(email, null, device, signinAt, 'google')]);
    });
  } catch (e) { /* non-fatal */ }

  var token = mintSession(email);
  return { status: 'ok', sessionToken: token, email: email, access: getMyAccess(email) };
}

// Escape a string for HTML text or a double-quoted attribute. The identity on the
// page comes from Google and a refusal comes from CONFIG, so neither is
// client-supplied today — but the output is markup, and a value that becomes
// markup is a bug waiting for the first person to make one of them controllable.
function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Where someone goes when the account on this page is the wrong one.
//
// Phones are why this exists. A browser with two Google accounts signed in feeds a
// web app its DEFAULT one, and Apps Script offers no way to ask for another, so the
// only lever is to send the person back to Google's own picker. This page is the
// place to come back TO, not the app: the app's Google button starts at the picker
// anyway, but a link from here has to name its own return address, and coming back
// here means the new account is named on this page before anything is signed in.
//
// The URL is the running deployment's own, read from the platform, so this needs no
// configuration and cannot point at the wrong copy of the script. Empty when that
// read is unavailable, and the caller drops the link rather than shipping a dead one
// — a "choose a different account" link that goes nowhere is worse than no link.
function googleSwitchUrl() {
  var self = '';
  try { self = String(ScriptApp.getService().getUrl() || ''); } catch (err) { self = ''; }
  if (!self) return '';
  return 'https://accounts.google.com/AccountChooser?continue='
       + encodeURIComponent(self + '?action=googleStart');
}

// The page the door ends on, carrying either a fresh handoff code or the reason it
// refused. It ends with ONE TAP on a real link, and both halves of that are forced
// rather than chosen:
//
//   * ContentService cannot serve HTML at all. Its MimeType list is ATOM, CSV,
//     ICAL, JAVASCRIPT, JSON, RSS, TEXT, VCARD, XML — there is no HTML member, so
//     `setMimeType(ContentService.MimeType.HTML)` passes `undefined` and the
//     response goes out as plain text. The door shipped with exactly that bug
//     once: the browser displayed the source of the redirect page instead of
//     running it. Hence HtmlService, which is for pages and nothing else.
//   * Since the 2021 IFRAME sandbox change an Apps Script page renders inside a
//     frame that may not navigate the top-level window without a user gesture
//     (`allow-top-navigation-by-user-activation` replaced `allow-top-navigation`).
//     `location.replace` from here would therefore move only the frame, leaving
//     the app inside an iframe at the wrong origin, where the URL bar and web
//     storage are broken. Google's own guidance for this is to give the user a
//     link to act on, so that is what this is.
//
// `target="_top"` is what makes the tap leave the frame. Removing it silently
// loads the app inside the sandbox, which is the failure this comment exists to
// prevent.
//
// Both branches also carry a SECOND link — "Not you? Choose a different account" —
// pointing at Google's account picker with this page as the address to come back to
// (see googleSwitchUrl). It is deliberately second and deliberately not a button:
// the page's job is still one tap to continue, and this is the way out for the
// person whose phone handed the browser the wrong account.
//
// The link target is built SERVER-SIDE from CONFIG.APP_URL and never from a request
// parameter. That is the open-redirect defence, and it is structural rather than a
// check: there is no client-supplied URL to validate, so there is nothing an
// attacker can point at their own site.
function handoffPage(code, email, message) {
  var base = String(CONFIG.APP_URL || '');
  var href, body;
  if (code) {
    href = base + '#sso=' + code;
    body = '<p class="who">Signed in as <strong>' + htmlEscape(email) + '</strong></p>'
         + '<a class="go" target="_top" href="' + htmlEscape(href) + '">Continue to I-PASSBOOK</a>';
  } else {
    // The refusal rides back in the fragment too, so the reason is still on screen
    // in the app after the tap — the door's own sentence is gone the moment they
    // leave it, and "Sign in with Google" with no explanation is the state this
    // branch exists to avoid.
    href = base + '#ssoerr=' + encodeURIComponent(String(message || 'Google sign-in failed.'));
    body = '<p class="who">' + htmlEscape(message || 'Google sign-in failed.') + '</p>'
         + '<a class="go" target="_top" href="' + htmlEscape(href) + '">Back to sign in</a>';
  }
  // Both branches get it, and both need it for a real case: the account that
  // arrived is the wrong one. On the code branch that means "you picked A, you
  // wanted B"; on a refusal it means the account was fine but has no I-PASSBOOK
  // row, or is disabled, or still holds a temporary password — all of which are
  // things the OTHER indrones account on the same phone may not share. Without
  // this, the only way back to the picker is the browser's back button, which
  // lands on the picker only by luck.
  var sw = googleSwitchUrl();
  var alt = sw
    ? '<a class="alt" target="_top" href="' + htmlEscape(sw) + '">Not you? Choose a different account</a>'
    : '';
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
           + '<meta name="viewport" content="width=device-width,initial-scale=1">'
           + '<title>I-PASSBOOK</title><style>'
           + 'html,body{margin:0}'
           + 'body{display:flex;align-items:center;justify-content:center;padding:24px;'
           + 'box-sizing:border-box;min-height:100vh;text-align:center;background:#f8f8f8;color:#0f0f0f;'
           + 'font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
           + '.card{width:100%;max-width:360px;background:#fff;border-radius:14px;'
           + 'padding:32px 28px;box-shadow:0 1px 2px rgba(15,15,15,.08),0 8px 24px rgba(15,15,15,.06)}'
           + '.brand{margin:0 0 18px;font-size:12px;font-weight:700;letter-spacing:.1em;color:#383838}'
           + '.who{margin:0 0 22px;color:#383838}'
           + '.who strong{color:#0f0f0f;word-break:break-all}'
           + '.go{display:block;padding:14px 18px;border-radius:10px;background:#005cad;'
           + 'color:#fff;font-weight:600;text-decoration:none}'
           + '.go:focus-visible{outline:3px solid #005cad;outline-offset:3px}'
           + '.alt{display:block;margin-top:16px;font-size:14px;font-weight:600;'
           + 'color:#005cad;text-decoration:none}'
           + '.alt:focus-visible{outline:3px solid #005cad;outline-offset:3px}'
           + '@media (prefers-color-scheme: dark){'
           + 'body{background:#171717;color:#f8f8f8}'
           + '.card{background:#1f1f1f;box-shadow:none}'
           + '.brand,.who{color:#afafaf}.who strong{color:#f8f8f8}'
           + '.go{background:#76bef9;color:#0f0f0f}.alt{color:#76bef9}}'
           + '</style></head><body><div class="card">'
           + '<p class="brand">I-PASSBOOK</p>' + body + alt + '</div></body></html>';
  return HtmlService.createHtmlOutput(html);
}

// GET googleStart — the door, opened by a CLICK THAT NAVIGATES.
//
// A GET that mints something deserves the question "can a hostile page trigger
// it?". It can: `<img src="…?action=googleStart">` would make this issue a code
// into the victim's… nothing. The response is a page whose only exit is a link to a
// FIXED server-side URL; an image's response is discarded and no navigation
// happens, so the attacker neither learns the code nor moves the victim. Issuing a
// code also grants no access on its own — it must still be redeemed, from the app,
// by whoever holds it.
function doGoogleStart() {
  var c = googleDoorCheck();
  if (c.error) return handoffPage(null, '', c.error.message);
  var code = issueHandoff(c.email);
  if (!code) return handoffPage(null, '', 'Could not start Google sign-in just now — try again.');
  return handoffPage(code, c.email, '');
}

// POST googleExchange — half two, on the deployment that is "Anyone".
//
// It runs on THAT deployment on purpose: the app is calling it from the browser,
// and a background call to the domain-restricted one is refused by Google before
// any of this runs. Here there is no Google identity to read and none is needed —
// the credential is the handoff code, minted a moment ago by the deployment that
// COULD read it.
function doGoogleExchange(params) {
  var res = redeemHandoff(params.code);
  if (res.error) return res.error;
  return mintGoogleSession(res.email, params.device);
}

// POST googleSignIn — REMOVED, and deliberately not kept "for later".
//
// It read the caller's Workspace identity from a POST body, which is unreachable:
// a browser cannot POST to the domain-restricted deployment without Google
// refusing it first (measured — see the header), and nothing else in this system
// can supply a Google session at all. It and googleSignInProbe were replaced by
// doGoogleStart + doGoogleExchange, which reach the same identity by the one route
// that works. Dead code that looks like a working door is worse than absent: the
// next person to debug this would try it first.

// The sign-in OTP gate, called from doLoginPassword on an already-verified
// password. Returns null to MEAN "carry on and mint the session", or the response
// to send back instead.
//
// Shape: the SAME code is reused for the whole working day (LOGIN_OTP_TTL_MIN,
// 8h30m). A user signing in on their phone at 9am and their desktop at 2pm types
// it once and never sees a second mail. So this deliberately does NOT mint a fresh
// code per attempt: it reuses the live one, and only ISSUES when there is no live
// code to reuse — otherwise the "reusable code" would be silently replaced by a
// newer one on the second sign-in of the day, and the mail already in their inbox
// would stop working.
//
// Note this is NOT marked used on success (consume=false): that is the whole
// feature. The attempt counter still applies and is shared across the day, since
// the entry is — five wrong guesses burn it and force a fresh one.
// `info` is an OUT object the caller owns, filled in only on the success path with
// the issue time of the code that was accepted — the sign-in audit needs the code's
// AGE, and this is the one place that knows a code just verified. It is optional so
// that the return contract stays exactly "a response to send, or null to carry on".
function loginOtpStep(email, supplied, name, info) {
  var code = (supplied || '').toString().trim();

  if (code) {
    var bad = verifyAuthCode(email, 'login', code, false);
    if (bad) return bad;                       // a refusal, not a verification
    // Read AFTER the verify rather than before, so the entry found is the one that
    // was just accepted; verifyAuthCode does not consume it (consume=false), so it
    // is still live and still findable. Best-effort: an unreadable store must not
    // fail a sign-in that has already been verified.
    if (info) {
      try {
        var entry = findCodeEntry(codesEntries(), email, 'login');
        info.codeIssuedAt = entry ? entry.createdAt : null;
      } catch (e) { /* age unknown — the audit says so rather than guessing */ }
    }
    return null;                               // null → verified, mint the session
  }

  // No code supplied: this is the first step of the flow. Reuse a live code if
  // there is one; issue only when there is not.
  //
  // This read is the MEMOISED one, outside any lock, and that is fine: it only
  // decides whether to ASK for a new code, and issueAuthCode re-reads under the
  // lock before it writes. If the memo were stale and we issued needlessly, the
  // 60s resend gap refuses it and the user is told to use the code already sent —
  // which is correct, because the code the memo was stale about is still live.
  var live = null;
  try {
    var found = findCodeEntry(codesEntries(), email, 'login');
    var exp = found ? asDate(found.expiresAt) : null;
    if (exp && exp.getTime() > Date.now()) live = found;
  } catch (e) { /* unreadable store → treat as no live code and issue below */ }

  if (!live) {
    var issued = issueAuthCode(email, 'login', LOGIN_OTP_TTL_MIN);
    if (!issued) {
      // No live code AND we could not issue one. It is a throttle: the per-email
      // hourly budget, the 60s resend gap, or the global hourly ceiling. Note the
      // gap counts codes of ANY purpose, so a password reset requested a moment
      // ago is enough to land here.
      //
      // This is the one place the sign-in path answers with an ERROR rather than a
      // prompt, and it has to: telling the user to "enter the code we emailed you"
      // would be a plain lie — there is no code, and no way forward from that
      // screen. The message deliberately does not say which limit was hit; that is
      // admin-facing detail, not something a person signing in can act on.
      return { status: 'error', message: 'Could not send a sign-in code just now — wait a minute and try again.' };
    }
    // The lifetime is stated as a DURATION from this mail, never as "end of the
    // working day": the code expires LOGIN_OTP_TTL_MIN after it is ISSUED, so a
    // first sign-in at 2pm leaves it live until 10:30pm, not until 5:30pm. Saying
    // "end of the day" would be a promise the clock does not keep for anyone who
    // starts their day late. Derived from the constant so it cannot drift.
    var ttlLabel = Math.floor(LOGIN_OTP_TTL_MIN / 60) + ':' +
                   ('0' + (LOGIN_OTP_TTL_MIN % 60)).slice(-2);
    sendAuthMail(email, 'Your I-PASSBOOK sign-in code',
      'Your I-PASSBOOK sign-in code is ' + issued + '.\n\n' +
      'It is valid for ' + ttlLabel + ' hours from now. You can reuse this same code for ' +
      'every sign-in until it expires — so if you are already signed in on another ' +
      'device, you do not need a new one.\n\n' +
      'If you did not try to sign in, someone may have your password — tell an admin.');
    return {
      status: 'ok', otpRequired: true, email: email, name: name, codeSent: true,
      message: 'We emailed you a 6-digit sign-in code.'
    };
  }

  // A live code already exists, so NONE is issued and NO mail is sent — that is the
  // whole "one code per working day" behaviour. Re-issuing here would retire the
  // live code by design (see issueAuthCode) and break the mail already sitting in
  // the user's inbox.
  return {
    status: 'ok', otpRequired: true, email: email, name: name, codeSent: false,
    message: 'Enter the sign-in code already emailed to you today.'
  };
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
//
// FAILS OPEN on a store error, and that is the whole point of the try/catch.
// app.js's confirmSessionAlive() resolves `!!(status === 'ok' && alive)`, so an
// ERROR answer here is read as "your session is dead" and the user is signed out.
// One unreadable sessions.json would therefore eject all twenty users inside the
// same 90-second poll window. "I could not read the store" is not "your token is
// dead", so it answers alive. A genuinely missing, expired or revoked token still
// answers alive:false, which is the answer that SHOULD eject.
function sessionCheck(e) {
  var email;
  try {
    email = requireAuth(e);
  } catch (err) {
    return { status: 'ok', alive: true, email: '',
             message: 'Session store unreadable — not signing anyone out. ' + ((err && err.message) || '') };
  }
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
    // The Google door's first half — a NAVIGATION, so it is GET, and it answers
    // with an HtmlOutput page rather than JSON. It is checked before the preAuth map
    // because it must return that HtmlOutput and never go through buildResponse.
    if (action === 'googleStart') return doGoogleStart();

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
      getAuditLog:   function () { return getAuditLog(e.parameter.irNumber, e.parameter.limit, e.parameter.fieldId); },
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
      // The Google door, half two. Self-authenticating for the same reason logout
      // is: the credential is the one-time handoff code the domain-restricted
      // deployment just minted, so there is no I-PASSBOOK token to check yet. It
      // runs on THIS deployment because it is called from the app's own browser,
      // and a background call to the domain-restricted one is refused by Google
      // before this script runs. See doGoogleStart and docs/10.
      googleExchange: function () { return doGoogleExchange(params); },
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

      // Put ONE field back to an earlier audited value. `by` is the VERIFIED email,
      // never a client value — the audit line and the admin notice both name the
      // person the token belongs to. The labels are display strings only (the form
      // registry lives in the frontend); see noticeLabel.
      restoreField: function () {
        var labels = {};
        try { labels = JSON.parse(params.labels || '{}') || {}; } catch (e) { labels = {}; }
        return restoreField(params.irNumber, params.sectionId, params.fieldId,
                            params.value, params.expectCurrent, email, labels);
      },

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
// without repeated sign-in prompts. Kept in `_store/sessions.json`.
// ──────────────────────────────────────────────────────────────────────────────
// The six LIVE sections, letters B–G. Section A became the Overview panel and is
// deliberately NOT in this list — nothing grants "edit on Section A" any more,
// because the panel is governed by the Triage flag instead.
//
// `sec-h` and `sec-i` are retired; see SEC_TARGET_MAP below.
var SECTION_KEYS = ['sec-b','sec-c','sec-d','sec-e','sec-f','sec-g'];

// The Overview panel's record id. It keeps the original `sec-a` so the drafts and
// the audit history already keyed on it keep working untouched. It is NOT a
// section: it has no letter and no completion state, and it is never in
// SECTION_KEYS.
var OVERVIEW_KEY = 'sec-a';

// Retired section ids — ids that no longer exist as a section at all.
//
// `sec-h` (PDI) and `sec-i` (Logistics Dispatch) were merged away: their data now
// lives in `sec-f` (Quality Test Report) and `sec-g` (PDI Report/Dispatch Record).
// These ids survive ONLY so `saveSection` can name them when rejecting a client on a
// stale service worker that still holds the old shell and keeps posting them.
//
// ⚠ `sec-g` IS NOT IN THIS LIST, and it must never be added. The old `sec-g` (Flight
// Test) was merged into `sec-f`, but the id itself was REUSED for the new PDI
// Report/Dispatch Record section — so `sec-g` is simultaneously "an id whose old data
// went to sec-f" and "a live section id". This list is about ids that can no longer
// be written, and `sec-g` can. It used to be derived from a `SEC_TARGET_MAP` that
// carried the old→new merge mapping, which listed `sec-g: sec-f` for the merge's sake
// and thereby made the LIVE Section G unsavable — every PDI save was refused with
// "was merged into another section", on a section the frontend still shows and still
// offers a Save button for. The map had no other consumer once the sheet merge was
// deleted, so it is gone and this is a literal instead of a derivation.
var RETIRED_SECTION_IDS = ['sec-h', 'sec-i'];
// Verify a session token and return its email, or null when the session is
// missing, expired or revoked.
//
// NO SLIDE. The expiry is absolute and set at mint time, so a session ends one
// working day after sign-in however busy that day was. It used to slide forward on
// every use — which meant the people who used the app most were the ones whose
// sessions never expired, and the daily sign-in the OTP protects never happened.
// Removing the slide also removed the throttled write this path used to do, so a
// lookup is now a pure read.
//
// THROWS when the store cannot be read. That distinction is load-bearing: `null`
// means "this token is not valid", which the caller answers as `unauthorized` and
// the frontend TRUSTS by signing the user out. A store that cannot be read is not
// a statement about the token, so it must never be reported as one.
function lookupSession(token) {
  if (!token) return null;
  token = String(token).trim();
  if (!token) return null;

  var tokens = sessionsTokens();               // throws on a missing/malformed store
  var s = tokens[token];
  if (!s) return null;

  var exp = asDate(s.expiresAt);
  if (s.revokedAt || !exp) return null;
  if (exp.getTime() <= Date.now()) return null;

  return usersKey(s.email);
}

// Log out: revoke exactly the token that was handed over. Self-authenticating,
// because revoking a token you already hold proves nothing else is needed.
function doLogout(sessionToken) {
  if (!sessionToken) return { status: 'ok' };
  var token = String(sessionToken).trim();
  try {
    withRowLockOrThrow(function () {
      var store = readJsonLocked('sessions.json');
      if (!store || !store.tokens || !store.tokens[token]) return;
      store.tokens[token].revokedAt = Date.now();
      writeJsonLocked('sessions.json', store);
    });
  } catch (e) { /* non-fatal — the client clears its own copy either way */ }
  return { status: 'ok' };
}

// ──────────────────────────────────────────────────────────────────────────────
// ACCESS CONTROL — two levels, and only two.
//
//   VIEW + COMMENT  — every signed-in user, on every section. Nothing to store.
//   EDIT            — granted by DEPARTMENT membership only.
//
// Departments are MANY-TO-MANY in both directions: a person may hold several
// departments, a department holds many people, and each department grants edit on
// a subset of the six sections. So a person's edit rights are the UNION of their
// departments' grants. All of it lives in ONE file, `_store/access.json`:
//
//   {
//     "departments": { "qc": { name, active, grants: {"sec-c": true}, triage,
//                              updatedAt, updatedBy } },
//     "memberships": { "angad.kumbhar@indrones.com": ["qc", "flight-test"] }
//   }
//
// Memberships are a LIST PER PERSON rather than an edge table, so reading one
// person's departments is one key read. That is the whole shape of the win: the
// sheet version needed a full scan of USER_DEPARTMENTS for every single access
// check, and getEffectiveAccess runs on every authenticated request.
//
// TRIAGE is a SECOND, INDEPENDENT AXIS beside the section grants. A department
// may hold it without granting edit on any section — which is exactly what CR and
// Management do. It governs the ticket header (status, assignee, priority, category)
// and the Overview panel's two fields. It is kept OUT of `grants` so no code that
// walks the section grants can mistake Triage for a section.
//
// This file holds AUTHORITY, so it must never be reachable through saveSection's
// sentinel path: a sentinel irNumber skips every ACL check in saveSection, so a
// sentinel that resolved here would let any signed-in user rewrite the grant
// matrix and hand themselves edit everywhere. It is not in SENTINEL_SECTIONS and
// must not be added there.
// ──────────────────────────────────────────────────────────────────────────────
function isAdminEmail(email) {
  email = usersKey(email);
  return CONFIG.ADMIN_EMAILS.map(function (a) { return usersKey(a); }).indexOf(email) > -1;
}

// The access store, normalised. Read-only helper: it answers {} for a store that
// is absent, because "no departments configured yet" is a real state on a fresh
// install. A malformed file still THROWS through readJson — an unreadable grant
// matrix must never read as "everyone is a plain user" silently.
function accessStore() {
  var a = readJson('access.json');
  if (!a || typeof a !== 'object') return { departments: {}, memberships: {} };
  if (!a.departments || typeof a.departments !== 'object') a.departments = {};
  if (!a.memberships || typeof a.memberships !== 'object') a.memberships = {};
  return a;
}

// "Flight Test" -> "flight-test". Stable keys mean renaming a department in the UI
// never orphans the people mapped to it.
function deptKeyFromName(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Every department key a person holds (whether or not the department is active).
function getUserDepartments(email) {
  var k = usersKey(email);
  var m = accessStore().memberships[k];
  if (!(m instanceof Array)) return [];
  var out = [];
  m.forEach(function (x) {
    var key = String(x || '').trim();
    if (key && out.indexOf(key) < 0) out.push(key);
  });
  return out;
}

// What a person's departments grant them, on BOTH axes.
//
// Returned together rather than from two functions because they come from the same
// departments and the same memberships: asking two questions about one record
// invites the two answers to disagree.
//
//   grants  { 'sec-c': true, … }  — the union of section edits
//   triage  true                  — this person may edit the ticket header and
//                                   the Overview panel
//
// Deactivated departments grant nothing on either axis, which is how a department
// is retired without deleting its history.
function departmentCapabilities(email) {
  var out = { grants: {}, triage: false };
  var keys = getUserDepartments(email);
  if (!keys.length) return out;          // short-circuit: no departments, no 2nd read
  var depts = accessStore().departments;
  keys.forEach(function (k) {
    var d = depts[k];
    if (!d) return;                      // a membership naming a department that is gone
    if (String(d.active === undefined ? 'yes' : d.active).trim().toLowerCase() === 'no') return;
    var g = d.grants || {};
    SECTION_KEYS.forEach(function (s) { if (g[s]) out.grants[s] = true; });
    if (d.triage) out.triage = true;
  });
  return out;
}

// Resolve a user's role + per-section permissions + Triage. There is no 'none' any
// more: view+comment is universal, so the only questions this answers are which
// sections are editable and whether the holder may triage.
function getEffectiveAccess(email) {
  email = (email || '').toLowerCase().trim();
  if (isAdminEmail(email)) {
    var all = {};
    SECTION_KEYS.forEach(function (s) { all[s] = 'edit'; });
    // The Overview is not a section, but it IS a gated record, so it gets a
    // permission key like any other. Without it, getPassbook's canView() filter
    // would drop the `sec-a` row for every non-admin — see getPassbook.
    all[OVERVIEW_KEY] = 'edit';
    return { role: 'admin', permissions: all, departments: [], triage: true };
  }
  // Default: view + comment everywhere. Built BEFORE the department read so that
  // any failure below still leaves a usable, minimum-privilege profile — the
  // catch fails open on reads and closed on writes, never to locked-out. `triage`
  // is set early for the same reason: a throw must not leave it undefined-but-true.
  var perms = {};
  SECTION_KEYS.forEach(function (s) { perms[s] = 'view'; });
  perms[OVERVIEW_KEY] = 'view';
  var depts = [];
  var triage = false;
  try {
    depts = getUserDepartments(email);
    var caps = departmentCapabilities(email);
    SECTION_KEYS.forEach(function (s) { if (caps.grants[s]) perms[s] = 'edit'; });
    triage = caps.triage === true;
  } catch (e) { /* keep view-only, no triage */ }
  // Triage also turns the Overview's two inputs editable, through the SAME
  // canEdit() seam every section uses — so the frontend needs no special case.
  if (triage) perms[OVERVIEW_KEY] = 'edit';
  return { role: 'user', permissions: perms, departments: depts, triage: triage };
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
  email = usersKey(email);
  var access = getEffectiveAccess(email);
  var mustChange = false;
  try {
    mustChange = isTempPasswordAccount(findUser(email));
  } catch (e) { /* ignore */ }
  return {
    status: 'ok',
    role: access.role,
    permissions: access.permissions,
    departments: access.departments,
    triage: access.triage === true,
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
  var usersStore = allUsers();
  var users = [];
  Object.keys(usersStore).forEach(function (email) {
    var u = usersStore[email] || {};
    var access = getEffectiveAccess(email);
    var created = asDate(u.createdAt);
    var saw     = asDate(u.lastLoginAt);
    users.push({
      email: email,
      name: userField(u, 'name'),
      status: userField(u, 'status') || 'active',
      mustChangePassword: isTempPasswordAccount(u),
      createdAt: created ? Utilities.formatDate(created, 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
      lastLoginAt: saw ? Utilities.formatDate(saw, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') : '',
      isAdmin: isAdminEmail(email),
      departments: access.departments,
      permissions: access.permissions
    });
  });
  users.sort(function (a, b) { return a.email < b.email ? -1 : (a.email > b.email ? 1 : 0); });

  var store  = accessStore();
  // Member counts, so the Departments tab can show who a change would affect.
  var counts = {};
  Object.keys(store.memberships).forEach(function (e2) {
    var list = store.memberships[e2];
    if (!(list instanceof Array)) return;
    list.forEach(function (dk) { counts[String(dk).trim()] = (counts[String(dk).trim()] || 0) + 1; });
  });

  var departments = Object.keys(store.departments).map(function (key) {
    var d = store.departments[key] || {};
    var grants = {};
    SECTION_KEYS.forEach(function (s) { grants[s] = !!(d.grants && d.grants[s]); });
    return {
      key: key,
      name: String(d.name || key),
      active: String(d.active === undefined ? 'yes' : d.active).toLowerCase() !== 'no',
      grants: grants,
      // The second axis on the same record. Kept OUT of `grants` so no code that
      // walks the section grants can mistake Triage for a section.
      triage: !!d.triage,
      members: counts[key] || 0
    };
  });
  // Deliberately NOT sorted. A JS object keeps string keys in insertion order, so
  // this comes back in the order the departments were created — which is the order
  // the Departments tab has always shown them in.

  return { status: 'ok', users: users, departments: departments, apiVersion: CONFIG.API_VERSION };
}

// POST createUser (admin) — one account + a one-time temporary password.
function createUser(params, authEmail) {
  requireAdmin(authEmail);
  var email = usersKey(params.email);
  var name  = (params.name || '').toString().trim();
  if (!validEmail(email)) return { status: 'error', message: 'Enter a valid email address.' };
  if (findUser(email)) return { status: 'error', message: 'An account already exists for ' + email + '.' };
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

  var created = [], skipped = [];
  emails.forEach(function (em) {
    if (!validEmail(em))          { skipped.push({ email: em, reason: 'not a valid email address' }); return; }
    if (isAdminEmail(em))         { skipped.push({ email: em, reason: 'already an admin' }); return; }
    if (findUser(em))             { skipped.push({ email: em, reason: 'account already exists' }); return; }
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
//
// ONE locked read-merge-write over users.json + sessions.json. Created At/By are
// carried over, not re-derived — this is not a new account.
function resetUserPassword(params, authEmail) {
  requireAdmin(authEmail);
  var email = usersKey(params.email);
  var pw    = makeTempPassword();
  var salt  = Utilities.getUuid();
  var now   = Date.now();
  return withRowLockOrThrow(function () {
    var users = readJsonLocked('users.json');
    var rec = users ? users[email] : null;
    if (!rec) return { status: 'error', message: 'No account found for ' + email + '.' };
    rec.hash           = hashPassword(pw, salt);
    rec.salt           = salt;
    rec.mustChange     = 'yes';
    rec.status         = 'active';
    rec.passwordChangedAt = null;
    rec.tempPwIssuedAt = now;
    writeJsonLocked('users.json', users);

    var sess = readJsonLocked('sessions.json');
    if (sess && sess.tokens && revokeSessionsForIn(sess, email)) writeJsonLocked('sessions.json', sess);

    var att = readJsonLocked('attempts.json');
    if (att && att[email]) { delete att[email]; writeJsonLocked('attempts.json', att); }

    return { status: 'ok', email: email, tempPassword: pw,
             message: 'New temporary password issued. Copy it now — it cannot be shown again.' };
  });
}

// POST setUserStatus (admin) — enable/disable without deleting the account.
function setUserStatus(params, authEmail) {
  requireAdmin(authEmail);
  var email  = usersKey(params.email);
  var status = (params.status || '').toString().toLowerCase() === 'disabled' ? 'disabled' : 'active';
  if (isAdminEmail(email) && status === 'disabled') {
    return { status: 'error', message: 'You cannot disable an admin account.' };
  }
  return withRowLockOrThrow(function () {
    var users = readJsonLocked('users.json');
    var rec = users ? users[email] : null;
    if (!rec) return { status: 'error', message: 'No account found for ' + email + '.' };
    rec.status = status;
    writeJsonLocked('users.json', users);

    // Revoke rather than checking Status on every authenticated request.
    if (status === 'disabled') {
      var sess = readJsonLocked('sessions.json');
      if (sess && sess.tokens && revokeSessionsForIn(sess, email)) writeJsonLocked('sessions.json', sess);
    }
    return { status: 'ok', email: email, status: status, message: email + ' is now ' + status + '.' };
  });
}

// POST saveDepartment (admin) — create or update one department's section grants.
function saveDepartment(params, authEmail) {
  requireAdmin(authEmail);
  var name = (params.name || '').toString().trim();
  var key  = deptKeyFromName((params.key || '').toString().trim() || name);
  if (!name && !key) return { status: 'error', message: 'A department needs a name.' };
  if (!key) return { status: 'error', message: 'Could not derive a key from that name — use letters or digits.' };
  var grants = {};
  try { grants = JSON.parse(params.grants || '{}'); } catch (e) { grants = {}; }

  var sectionGrants = {};
  SECTION_KEYS.forEach(function (s) { if (grants[s]) sectionGrants[s] = true; });

  return withRowLockOrThrow(function () {
    var store = readJsonLocked('access.json') || { departments: {}, memberships: {} };
    if (!store.departments) store.departments = {};
    if (!store.memberships) store.memberships = {};
    var existed = !!store.departments[key];
    store.departments[key] = {
      name:      name || key,
      active:    (params.active === 'no' ? 'no' : 'yes'),
      grants:    sectionGrants,
      // Triage is read from the SAME `grants` object the UI posts, because that is
      // how the grant grid submits it — but stored OUTSIDE `grants`, so no code
      // walking the section grants can mistake it for a section.
      triage:    !!grants['triage'],
      updatedAt: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss'),
      updatedBy: authEmail
    };
    // Replaces ONE key. Writing the whole departments object from `grants` would
    // delete every other department, and with it every grant in the company.
    writeJsonLocked('access.json', store);
    return { status: 'ok', key: key, message: (existed ? 'Saved ' : 'Created ') + key };
  });
}

// POST deleteDepartment (admin) — remove the department AND every membership edge
// naming it, so no one keeps edit rights through a department that no longer exists.
function deleteDepartment(params, authEmail) {
  requireAdmin(authEmail);
  var key = (params.key || '').toString().trim();
  if (!key) return { status: 'error', message: 'Department key required.' };
  return withRowLockOrThrow(function () {
    var store = readJsonLocked('access.json');
    if (!store || !store.departments || !store.departments[key]) {
      return { status: 'ok', message: 'No such department: ' + key };
    }
    delete store.departments[key];
    // Every membership naming it goes too. Removing the edges here is what stops a
    // dangling membership from resurrecting the grants if the key is ever recreated.
    Object.keys(store.memberships || {}).forEach(function (email) {
      var list = store.memberships[email];
      if (!(list instanceof Array)) return;
      var kept = list.filter(function (k) { return String(k).trim() !== key; });
      if (kept.length) store.memberships[email] = kept;
      else delete store.memberships[email];
    });
    writeJsonLocked('access.json', store);
    return { status: 'ok', message: 'Deleted ' + key };
  });
}

// POST setUserDepartments (admin) — replace one person's department memberships.
function setUserDepartments(params, authEmail) {
  requireAdmin(authEmail);
  var email = usersKey(params.email);
  if (!email) return { status: 'error', message: 'Email required.' };
  var keys = [];
  try { keys = JSON.parse(params.departments || '[]'); } catch (e) { keys = []; }
  if (!(keys instanceof Array)) keys = [];
  keys = keys.map(function (k) { return String(k).trim(); }).filter(Boolean);

  return withRowLockOrThrow(function () {
    var store = readJsonLocked('access.json') || { departments: {}, memberships: {} };
    if (!store.memberships) store.memberships = {};
    // ONE key assignment, replacing exactly this person's list. The sheet version
    // deleted then re-appended rows; here the previous list is simply gone.
    if (keys.length) store.memberships[email] = keys;
    else delete store.memberships[email];
    writeJsonLocked('access.json', store);
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
    // Pass 1 — PLAN ONLY. No writes. Read through the lock so the plan describes
    // the exact snapshot the delete pass will act on.
    var users = readJsonLocked('users.json') || {};
    var access = readJsonLocked('access.json') || {};
    var memberships = access.memberships || {};

    var plan = [];
    Object.keys(users).forEach(function (email) {
      if (!email.trim() || isAdminEmail(email)) return;
      var rec = users[email] || {};
      plan.push({
        email: email,
        name: userField(rec, 'Name'),
        createdBy: userField(rec, 'Created By'),
        createdAt: asDate(userField(rec, 'Created At'))
          ? Utilities.formatDate(asDate(userField(rec, 'Created At')), 'Asia/Kolkata', 'dd-MMM-yyyy') : ''
      });
    });
    // Sorted so the dry-run list and the confirm count are stable and readable —
    // a JSON object's key order is insertion order, not alphabetical.
    plan.sort(function (a, b) { return a.email < b.email ? -1 : (a.email > b.email ? 1 : 0); });

    if (dryRun) {
      // Counts only, plus the list. Nothing is written and nothing is locked in.
      var edgeCount = Object.keys(memberships).filter(function (e) {
        return e.trim() && !isAdminEmail(e);
      }).length;
      return { status: 'ok', dryRun: true, removed: plan, count: plan.length,
               blankRows: 0, edges: edgeCount,
               message: 'Nothing deleted. ' + plan.length + ' account(s), '
                        + edgeCount + ' membership(s) would be removed. Copy the list, then confirm.' };
    }

    // Pass 2 — delete exactly what was planned.
    // If the caller reviewed a list, refuse when the world has changed under it:
    // an irreversible delete must remove what was SEEN, or nothing at all.
    var expect = (params.expect === undefined || params.expect === '') ? null : Number(params.expect);
    if (expect !== null && expect !== plan.length) {
      return { status: 'error', message: 'The account list changed while you were reviewing it ('
               + plan.length + ' now, ' + expect + ' when you looked). Nothing was deleted — review it again.' };
    }

    // The rollback path. Written BEFORE the first destructive write, as a new file
    // — the sheet version kept a dated backup tab for exactly this, and Drive
    // revision history is not a durable substitute for these files.
    var backup = snapshotStore('purge-users', ['users.json', 'access.json', 'sessions.json']);

    plan.forEach(function (p) { delete users[p.email]; });
    writeJsonLocked('users.json', users);

    // Every membership for a removed account goes too.
    Object.keys(memberships).forEach(function (e) {
      if (!e.trim() || isAdminEmail(e)) return;
      delete memberships[e];
    });
    access.memberships = memberships;
    writeJsonLocked('access.json', access);

    // And every session, so a still-open tab can't keep working on a dead account.
    // Admins are spared here for the same reason their accounts are: revoking the
    // admin running this would sign them out mid-purge.
    var sess = readJsonLocked('sessions.json');
    if (sess && sess.tokens) {
      var now = Date.now();
      Object.keys(sess.tokens).forEach(function (t) {
        var s = sess.tokens[t];
        if (!s || s.revokedAt) return;
        if (!usersKey(s.email) || isAdminEmail(s.email)) return;
        s.revokedAt = now;
      });
      writeJsonLocked('sessions.json', sess);
    }

    return { status: 'ok', removed: plan, count: plan.length, backup: backup,
             message: 'Removed ' + plan.length + ' account(s). Admins were kept. Backup: ' + backup };
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
    // irs.json is the whole `__IRS__` store: one key per IR. This used to scan
    // APP_DATA rows for the sentinel, which is the same data in a different shape.
    var irs = readJson('irs.json') || {};
    Object.keys(irs).forEach(function (irNum) {
      if (!irNum) return;
      var fields = irs[irNum];
      // Truthiness, not `|| 'Open'`: seedIRState() writes `status: ''` the
      // first time it sees an IR, and an empty string must fall through to
      // the caller's own default rather than overwrite it with 'Open'.
      if (fields && fields.status) map[irNum] = fields.status;
    });
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
  // 'theme' is the site-wide appearance allowlist: { palettes: [...], default }.
  // It is read by every signed-in user (loadPaletteConfig in app.js) but written
  // only by an admin — the write gate is isAdminEmail, checked in saveSection, not
  // this list. Adding it here is what unlocks the write at all; until this ships
  // and the backend is redeployed, the admin UI's save is rejected.
  '__CONFIG__': ['team-directory', 'inward-options', 'iqc-config', 'theme'],
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

  // UNLOCKED read, deliberately. The frontend polls a store every 90 s per user, so
  // locking reads would put ~800 requests an hour in front of one lock, and a
  // slightly stale snapshot is already what today's version returns.
  var stored;
  if (isSentinel) {
    var storeFile = sentinelStoreFile(irNumber);
    if (!storeFile) throw new Error('Unknown app store: ' + irNumber);
    stored = readJson(storeFile) || {};
  } else if (/^IR\d+$/.test(String(irNumber))) {
    stored = readIR(irNumber, false).data;
  } else {
    // Not a sentinel and not an IR number: a junk value from a stale link or a
    // half-typed hash. Empty, exactly as the sheet version answered — reads are
    // tolerant; the WRITE path is where the shape is asserted.
    stored = {};
  }

  var sections = {};
  Object.keys(stored).forEach(function (secId) {
    // Hide real sections the caller can't view. Sentinel app stores (comments,
    // dropdown config) are shared app data — visible to any user with access.
    //
    // `secId !== OVERVIEW_KEY` is load-bearing and must not be "tidied" away.
    // The Overview is not a section: it is absent from SECTION_KEYS, so
    // getEffectiveAccess never puts a `sec-a` key in any permission map. Without
    // this allowance every non-admin would lose the Overview row — the CRM fields
    // AND the legacy activity log — while the admin, who is the one testing it,
    // would still see everything. Blank Overview for 18 people, looks fine to the
    // one person looking. The Overview is shared app data, like the sentinels.
    if (!isSentinel && secId !== OVERVIEW_KEY && access.role !== 'admin' && !canView(access.permissions, secId)) return;
    var fields = stored[secId];
    sections[secId] = (fields && typeof fields === 'object') ? fields : {};
  });

  return { status: 'ok', sections: sections };
}

// ──────────────────────────────────────────────────────────────────────────────
// The MIME type of an uploaded file, decided by its NAME first.
//
// This exists because trusting the browser's `File.type` alone silently lost
// uploads. Android's document picker — and several camera apps — hand Chrome a
// file they cannot type, so `File.type` arrives as '' (or a generic
// application/octet-stream) even for a plain JPEG. The upload loop used to skip
// any file without a MIME type, so on those phones the photo was dropped on the
// floor while the save still reported success: the thumbnail was there before
// saving and gone after a reload, with nothing to explain it. The owner hit
// exactly this on two phones.
//
// So the extension is the primary source and the declared type is the fallback,
// never the reverse. A wrong-but-plausible type (octet-stream) is what makes a
// Drive file refuse to preview, so a name we recognise always wins.
// ──────────────────────────────────────────────────────────────────────────────
function mimeFromName(name) {
  var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  var map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg',
    png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
    pdf: 'application/pdf'
  };
  return m ? (map[m[1]] || '') : '';
}
function resolveMime(declared, name) {
  var d = String(declared || '');
  var generic = !d || d === 'application/octet-stream' || d === 'binary/octet-stream';
  var byName = mimeFromName(name);
  if (generic && byName) return byName;
  return d || byName || 'application/octet-stream';
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
  else if (RETIRED_SECTION_IDS.indexOf(String(sectionId)) > -1)
    // sec-g/sec-h/sec-i were merged into sec-f/sec-g. A client on a stale service
    // worker still holds the old shell and will keep posting them; appending would
    // recreate a retired row that nothing renders. The fix is a reload, not a
    // permission, so say that instead of a bare Forbidden.
    throw new Error('Section ' + sectionId + ' was merged into another section. Reload the app to get the current version.');
  else if (access.role !== 'admin' && !canEdit(access.permissions, sectionId))
    // This branch also covers the Overview (sectionId === OVERVIEW_KEY). It is not
    // a section, but getEffectiveAccess gives it a permission key like one: 'view'
    // for everybody, 'edit' only for admins and Triage holders. So the Overview's
    // two inputs are gated here through the SAME seam every section uses — no
    // second check, and nothing to keep in sync. There is deliberately NO
    // OVERVIEW_KEY exemption on this line: exempting it would let any signed-in
    // user rewrite the ticket header, which is the one thing Triage is for.
    throw new Error('Forbidden: you do not have edit access to ' + sectionId + '.');

  // App stores never carry files. Rejecting uploads here closes the last sentinel
  // hole: the upload branch runs before any ACL is consulted and sets every file to
  // ANYONE_WITH_LINK, so a sentinel write was an unauthenticated-quota way to host
  // arbitrary public files in the company Drive.
  if (isSentinel && files && files.length > 0)
    throw new Error('App stores cannot carry file uploads.');

  // A real IR number becomes a Drive FOLDER and FILE name below, so its shape is
  // asserted here — after the ACL, before any folder or file work.
  if (!isSentinel) assertRealIR(irNumber);

  // Section A intake fields are auto-populated from the customer form and are
  // editable by NO ONE. Strip any of them from the incoming payload so a crafted
  // save can't write a divergent copy into the store. (They're displayed live from
  // the IR Repository, not from here.)
  //
  // Note what is deliberately NOT in this list: a_crmOwner and a_contactPhone,
  // which the Overview panel does write (gated on Triage by the ACL above), and
  // a_activityLog, which nobody writes — it survives only as read-only history.
  // Stripping is not what keeps it, though: this list only drops keys from the
  // INCOMING payload. What actually keeps a_activityLog is that the Overview's write
  // is a merge rather than a replace — see the critical section below.
  if (sectionId === OVERVIEW_KEY) {
    ['a_irNumber','a_droneId','a_dateRaised','a_issueType','a_issueDesc','a_customerName',
     'a_contactEmail','a_incidentLocationWeather','a_evidence','a_companyName'].forEach(function(k) {
      delete fields[k];
    });
  }

  // 1. Handle file uploads — create IR folder / Section subfolder. OUTSIDE the lock:
  // base64 decode, createFile and setSharing are the slow part of a save and none of
  // them touches the store files. Holding the script lock across them would put every
  // other writer behind a Drive upload.
  var fileLinks = {};
  var uploads   = [];   // audit trail — see buildAuditLines
  if (files && files.length > 0) {
    var sectionFolder = getOrCreateSectionFolder(irNumber, sectionId);
    files.forEach(function(file) {
      // A file with no name or no contents is a broken upload, not a reason to
      // skip one quietly. Say so and let the whole save fail: the client keeps the
      // entries as a draft, and the user is told which file to re-pick. The old
      // `return` here is what made "uploads don't work" invisible.
      //
      // NOT asserted: file.mimeType. See resolveMime — an empty one is normal on
      // Android and is recoverable from the filename.
      if (!file.base64 || !file.name)
        throw new Error('A file arrived without its name or contents, so nothing was saved. Re-select the file and save again.');
      var mime     = resolveMime(file.mimeType, file.name);
      var blob     = Utilities.newBlob(Utilities.base64Decode(file.base64), mime, file.name);
      var uploaded = sectionFolder.createFile(blob);
      // Per FILE, never on the folder: the upload folders stay browsable by link,
      // while `_store/` — password hashes, salts, session tokens — is Restricted.
      uploaded.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      if (!fileLinks[file.fieldId]) fileLinks[file.fieldId] = [];
      fileLinks[file.fieldId].push(uploaded.getUrl());
      uploads.push({ fieldId: file.fieldId, name: file.name });
    });
    // Merge file links back into fields as comma-separated URLs
    Object.keys(fileLinks).forEach(function(fid) {
      fields[fid + '_links'] = fileLinks[fid].join(', ');
    });
  }

  // 2. ONE locked read → merge → write. Everything between here and the closing
  // brace is the critical section; Drive has no transactions, so the READ must be
  // inside it. A read taken before the lock would be merged over whatever landed in
  // between and drop that writer's save silently.
  //
  // `reopenIR` is the one thing the critical section DECIDES but must not DO: the
  // folder move is Drive work, and the rule above is that Drive work stays outside
  // the lock. It is read after the lock closes, below.
  var reopenIR = '';
  var result = withRowLockOrThrow(function () {
    var lines;
    if (isSentinel) {
      var storeFile = sentinelStoreFile(irNumber);
      if (!storeFile) throw new Error('Unknown app store: ' + irNumber);
      // readJsonLocked, NOT readJson: the memo may hold a copy read before the lock
      // was taken, and merging onto that copy would clobber the newer file.
      var store = readJsonLocked(storeFile) || {};
      var existing = (store[sectionId] && typeof store[sectionId] === 'object') ? store[sectionId] : {};

      // A ticket LEAVING Close gets its Drive folder back from the archive.
      //
      // Decided here, and only here, because `existing` is the stored status as it
      // was BEFORE this write — the one instant the close→open transition is
      // visible. Left to the daily sweep, a reopened ticket would keep its files
      // archived until the next run, and a new upload would land in the archive
      // beside them, which is exactly what nobody expects a reopened ticket to do.
      //
      // The reverse is deliberately NOT handled here: entering Close does not
      // archive anything. That happens 30 days later, in archiveClosedIRs.
      //
      // The frontend sends the whole merged row (patchIRState), so `fields.status`
      // is the new status, not a missing key.
      if (irNumber === '__IRS__' && existing.status === 'Close' && fields.status !== 'Close') {
        reopenIR = String(sectionId);
      }

      // __NUDGES__ is excluded at the source rather than filtered later: comments
      // already carry their own author and createdAt in the items array, and a nudge
      // save fires on every post, resolve, edit AND markRead, each writing a 500-char
      // copy of the whole comment array. That one store dominated the log.
      lines = (irNumber === '__NUDGES__')
        ? [] : buildAuditLines(irNumber, sectionId, savedBy, existing, fields, uploads);

      // THE ONE KEY. writeJson(storeFile, fields) here would wipe the sibling keys:
      // every other comment on every ticket for __NUDGES__, the team directory and
      // the dropdown config for __CONFIG__, the workflow state of all 450 tickets
      // for __IRS__. This single line is the most dangerous mis-reading of the
      // design and it is deliberate that it is a key assignment and not a write.
      store[sectionId] = fields;
      writeJsonLocked(storeFile, store);

      // The audit goes LAST, inside the same lock: a failed data write must not
      // leave an entry for a save that never happened.
      appendAuditLinesLocked(auditSubjectFor(irNumber, sectionId), lines);
      return { status: 'ok', message: 'Section ' + sectionId + ' saved for ' + irNumber };
    }

    var ir = readIR(irNumber, true, true);
    var data = ir.data;
    var existingFields = (data[sectionId] && typeof data[sectionId] === 'object') ? data[sectionId] : {};

    // The Overview is the ONE section whose payload is a SUBSET of its record.
    // saveOverview posts a_crmOwner and a_contactPhone and nothing else, because
    // everything else in sec-a is app-owned — a_activityLog above all. Replacing the
    // record with a two-key object therefore DELETED the activity log on every
    // Overview save, which is the exact opposite of what the comment on the intake
    // strip below promises. So for the Overview: stored keys first, the posted ones
    // over them.
    //
    // Every other section must KEEP replace semantics, and that is not an oversight:
    // the client posts every field it declares, so replace and merge are the same
    // thing there — and putting a DELETED field back (restoreField) depends on a
    // missing key meaning "gone" rather than "unchanged". A global merge would make a
    // removed field unremovable. smoke-store.mjs pins that contract.
    var next = fields;
    if (sectionId === OVERVIEW_KEY) {
      next = {};
      Object.keys(existingFields).forEach(function (k) { next[k] = existingFields[k]; });
      Object.keys(fields).forEach(function (k) { next[k] = fields[k]; });
    }

    // Diff the STORED record against the object actually being written — never the
    // merged object against itself, which would diff to nothing and lose the very
    // two fields this save is about.
    lines = buildAuditLines(irNumber, sectionId, savedBy, existingFields, next, uploads);

    data[sectionId] = next;
    writeIR(irNumber, data, ir.fileId);
    appendAuditLinesLocked(auditSubjectFor(irNumber, sectionId), lines);

    return { status: 'ok', message: 'Section ' + sectionId + ' saved for ' + irNumber };
  });

  // 3. OUTSIDE the lock, and AFTER the status write has landed. The order is the
  // point: if the move went first, a failure would leave an OPEN ticket whose folder
  // is still archived, and nothing would ever retry it. This way the stored status
  // is already the truth and only the folder lags — which the next save corrects.
  //
  // A failed move does NOT fail the save. The save is already durable, so returning
  // an error here would send the user to re-save a section that saved perfectly. It
  // is said in words instead: a ticket whose files are in the wrong folder is
  // something a person should hear about while they are looking at the screen.
  if (reopenIR) {
    try {
      restoreIRFolder(reopenIR, savedBy);
    } catch (e) {
      result.message += ' (' + reopenIR + "'s folder could not be moved back out of '" +
                        CONFIG.ARCHIVE_FOLDER_NAME + "', so its files are still archived. " + e.message + ')';
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION: restoreField — put ONE field back to a value it held before
// ──────────────────────────────────────────────────────────────────────────────
// The other half of the audit trail. The app has always RECORDED every field change
// (buildAuditLines → audit/<IR>.jsonl); this is the first action that can undo one,
// and it exists because the owner asked for what Confluence and Google Workspace
// both have:
//
//   "a fallback safety where if someone has deleted important info thus by edit
//    history I can go and verify it and if required I can restore that version"
//
// ONE KEY, AND THAT IS THE WHOLE REASON THIS IS NOT A CALL TO saveSection. A section
// save assigns the WHOLE section object (`store[sectionId] = fields`), so restoring
// one field through it would require the caller to resend every other field in that
// section — and a screen holding a slightly stale form would silently revert all of
// them. A bug the user cannot see is worse than the typo they are trying to repair.
// This reads the store itself, inside the lock, and assigns exactly one key.
//
// The permission is saveSection's, copied VERBATIM, because a restore IS a write: a
// view-only reader may look at the history and may not rewind it, and the person who
// can retype a value by hand is exactly the person who may put an old one back.
//
// `expectCurrent` is a guard, not ceremony. Between opening the history and pressing
// the button — which is a deliberate, confirm()ed action, so the gap is real — someone
// else may have set the field to a newer value, and a blind restore would discard that
// with nobody knowing. It is the value the SERVER last told the caller this field
// holds (the newest audited value for it), compared below inside the lock against the
// same snapValue() truncation, so the two sides agree even on a value over 500 chars.
function restoreField(irNumber, sectionId, fieldId, value, expectCurrent, by, labels) {
  if (!irNumber || !sectionId || !fieldId)
    throw new Error('irNumber, sectionId and fieldId are required.');

  // Real IR sections only. A `__…__` store has a different key shape (irs.json is
  // keyed by IR number, comments.json by 'all') and its own allowlist gate, so
  // restoring into one is not a smaller version of this — it is a different action
  // and it is deliberately not offered.
  if (String(irNumber).indexOf('__') === 0)
    throw new Error('An app store cannot be restored through this action.');
  assertRealIR(irNumber);

  var access = getEffectiveAccess(by);
  if (RETIRED_SECTION_IDS.indexOf(String(sectionId)) > -1)
    throw new Error('Section ' + sectionId + ' was merged into another section. Reload the app to get the current version.');
  // Same line as saveSection's, and it covers the Overview for the same reason:
  // getEffectiveAccess folds Triage into permissions[OVERVIEW_KEY], so
  // canEdit(..., 'sec-a') is already the right check there — no special case on
  // either side, and nothing to keep in sync.
  else if (access.role !== 'admin' && !canEdit(access.permissions, sectionId))
    throw new Error('Forbidden: you do not have edit access to ' + sectionId + '.');

  // ── THE TRUNCATION REFUSAL. The one refusal that cannot be argued with. ──────
  //
  // snapValue caps every audited value at 500 characters and appends '…', silently
  // and irreversibly — the full old value is kept NOWHERE else, not in the store and
  // not in a backup. Writing that prefix back would corrupt the field with no error
  // and nothing to compare against afterwards.
  //
  // The test is exact: snapValue can only emit <=500 characters, or exactly 501
  // (500 + the ellipsis). So `length > 500` PROVES the value is a truncated prefix.
  // This is checked here as well as in the frontend (restoreOfferFor), because the
  // frontend's check is a courtesy and this one is the rule.
  var restoreVal = (value == null) ? '' : String(value);
  if (restoreVal.length > 500)
    throw new Error('That earlier value was too long to be recorded in full, so it can be viewed but not put back. Nothing was changed.');

  // What the caller believes the field holds right now. Compared inside the lock.
  var expect = (expectCurrent == null) ? '' : String(expectCurrent);

  var result = withRowLockOrThrow(function () {
    var ir   = readIR(irNumber, false, true);

    // No sections file means no history, so no restore can legitimately be here —
    // and `writeIR` refuses without the id readIR resolved anyway (a name lookup on
    // the write path is how a ticket gets forked in two). Say it in words instead.
    if (!ir.fileId)
      throw new Error('This IR has no saved data yet, so there is nothing to put back.');

    var data = ir.data;
    var stored = (data[sectionId] && typeof data[sectionId] === 'object') ? data[sectionId] : {};

    // A field the section has never stored, with nothing expected, is a caller
    // restoring a value that was REMOVED — the owner's own main case ("someone
    // deleted important info"). So a missing key is not an error; it is exactly
    // where a restore is supposed to put something back.
    var hasKey  = stored.hasOwnProperty(fieldId);
    var current = hasKey ? stored[fieldId] : '';

    // The field moved under the caller. Say so and change NOTHING: a restore that
    // quietly overwrote a newer value would be the exact accident this feature
    // exists to repair, committed by the tool meant to repair it.
    if (snapValue(current) !== expect)
      throw new Error('This field changed while you were looking at its history, so nothing was changed. Reopen the history and put the value back again.');

    // ONE KEY, copied key-by-key so no sibling field can be touched even if the
    // stored object carries keys this action has never heard of.
    var next = {};
    Object.keys(stored).forEach(function (k) { next[k] = stored[k]; });
    next[fieldId] = restoreVal;
    data[sectionId] = next;
    writeIR(irNumber, data, ir.fileId);

    // Same line shape as every other audit row — {t, ir, sec, by, ev, fid, old, nw}
    // — so the timeline needs no second reader.
    //
    // The event is `reverted`, and deliberately NOT `restored`: that value already
    // means "this ticket's folder came back out of the Drive archive"
    // (archiveAuditLine → restoreIRFolder), and the timeline renders it as such.
    // One word for two events is how a reader ends up unable to tell a folder move
    // from a value being put back.
    //
    // `old` is the value being REPLACED (what is there now) and `nw` is the value
    // put back — the same direction every other line reads, so "Was / Now" means
    // the same thing on this row as on a `changed` row.
    var ts = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
    appendAuditLinesLocked(auditSubjectFor(irNumber, sectionId), [
      { t: ts, ir: irNumber, sec: sectionId, by: by, ev: 'reverted',
        fid: fieldId, old: snapValue(current), nw: snapValue(restoreVal) }
    ]);

    return {
      status: 'ok',
      message: 'The earlier value was put back.',
      irNumber: irNumber, sectionId: sectionId, fieldId: fieldId,
      was: snapValue(current), now: snapValue(restoreVal)
    };
  });

  // ── THE NOTICES. Both AFTER the lock, and neither may fail the restore. ──────
  //
  // The durable, atomic half of "tell the admin" is already done: the `reverted`
  // line above is inside the same lock as the write, so it cannot exist without the
  // change and cannot go missing behind it. These two are the loud half, and they
  // are deliberately outside — inside, a failure in either would report an error for
  // a restore that has ALREADY committed, and the user's retry would then be refused
  // by the `expectCurrent` guard, which is a confusing way to learn the write worked.
  // This mirrors saveSection's `reopenIR` rule: the write is durable, so what lags is
  // said in words rather than turned into a failure.
  var sectionLabel = noticeLabel(labels && labels.sectionLabel, sectionId);
  var fieldLabel   = noticeLabel(labels && labels.fieldLabel, fieldId);
  var link         = irDeepLink(irNumber);
  var notes = [];
  try {
    appendAdminNotice({
      irNumber: irNumber, sectionId: sectionId, fieldId: fieldId,
      sectionLabel: sectionLabel, fieldLabel: fieldLabel,
      by: by, was: result.was, now: result.now
    });
  } catch (e) { notes.push('the in-app notice could not be posted'); }

  var body = [
    'An earlier value was put back in a passbook.',
    '',
    'IR:        ' + irNumber,
    'Section:   ' + sectionLabel,
    'Field:     ' + fieldLabel,
    'By:        ' + by,
    'When:      ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss') + ' IST',
    '',
    'Put back:  ' + (result.now === '' ? '(empty)' : result.now),
    'It replaced: ' + (result.was === '' ? '(empty)' : result.was),
    '',
    'This is recorded in the IR’s own history, and everyone who can edit that',
    'section can put a value back — so nothing is lost by this. You are being told',
    'because knowing as it happens is easier than reconstructing it later.'
  ];
  if (link) body = body.concat(['', 'Open the ticket: ' + link]);
  if (!sendAdminNotice('[I-PASSBOOK] ' + irNumber + ' — an old value was put back', body.join('\n'), by))
    notes.push('the admin email was not sent');

  if (notes.length) result.message += ' (' + notes.join(', and ') + '.)';
  return result;
}

// The backend's only in-app notification. Everything in the bell so far has been
// minted by the CLIENT (sendComment in app.js), so this is the first record the
// server writes and it is built to match the client's shape exactly — `isForMe`
// matches on `to`/`mentions`, and renderNudgePanel reads the rest. Nothing in the
// renderer needs to change for this to appear.
//
// Takes its OWN lock, so it must never be called from inside one — nested locks are
// forbidden here (see withRowLock). It is called after restoreField's lock has been
// released, which is also what keeps a failure here from failing the restore.
//
// The id is a UUID rather than a counter: nudge ids are compared and passed around
// as strings by the client, and the client's own ids are uuid-based too.
function appendAdminNotice(n) {
  var recipients = (CONFIG.ADMIN_EMAILS || []).map(function (a) { return String(a).toLowerCase().trim(); })
    .filter(Boolean);
  if (!recipients.length) return null;
  return withRowLockOrThrow(function () {
    var file = sentinelStoreFile('__NUDGES__');
    var store = readJsonLocked(file) || {};
    // Preserve whatever else the store's 'all' key carries — the client owns this
    // key and only its `items` array is ours to append to.
    var keyed = (store.all && typeof store.all === 'object') ? store.all : {};
    var items = (keyed.items instanceof Array) ? keyed.items : [];
    items.push({
      id: 'restore-' + Utilities.getUuid(),
      irNumber: n.irNumber,
      scope: 'field',
      sectionId: n.sectionId,
      fieldId: n.fieldId,
      sectionLabel: n.sectionLabel,
      fieldLabel: n.fieldLabel,
      // `from` is the verified caller's email. The backend holds no display names —
      // the client resolves `from` to a name when it renders.
      from: n.by,
      fromName: n.by,
      to: recipients.join(','),
      mentions: recipients,
      message: 'Put an earlier value back in "' + n.fieldLabel + '" (' + n.sectionLabel + '): now "' +
               (n.now === '' ? '(empty)' : n.now) + '", replacing "' + (n.was === '' ? '(empty)' : n.was) + '".',
      createdAt: Date.now(),
      readBy: [],
      status: 'open',
      resolvedAt: null,
      resolvedBy: null
    });
    keyed.items = items;
    store.all = keyed;
    writeJsonLocked(file, store);
    return items.length;
  });
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
  try { return !!findUser(addr); } catch (e) { return false; }
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
// WHERE AN IR'S OWN FOLDER LIVES — and the one place that knows it.
//
// `root/IR409` while the ticket is live, `root/Archive IRs/IR409` once it has been
// closed long enough (archiveClosedIRs). ONE resolver, because the folder is found
// BY NAME from a parent: a lookup that only ever searched the root would miss an
// archived folder entirely and CREATE A SECOND, EMPTY `root/IR409` on the next
// upload — silently splitting one ticket's files across two folders, with nothing
// anywhere reporting an error. Every path that names an IR's folder goes through
// here, including the move back on reopen.
//
// Returns { folder, archived }, or null when it exists in neither and `create` is
// false.
function findIRFolder(irNumber, create) {
  // Before any folder name is built from it — the same order saveSection uses.
  assertRealIR(irNumber);

  var rootFolder = getRootFolder();
  var inRoot = rootFolder.getFoldersByName(irNumber);
  if (inRoot.hasNext()) return { folder: inRoot.next(), archived: false };

  // Only searched when the folder is NOT in the root. `create` is deliberately NOT
  // passed through: an ordinary upload to a brand-new ticket must not bring the
  // archive folder into existence. Creating it belongs to the move, in
  // moveFolderBetween — see getArchiveFolder.
  var archive = getArchiveFolder(false);
  if (archive) {
    var inArchive = archive.getFoldersByName(irNumber);
    if (inArchive.hasNext()) return { folder: inArchive.next(), archived: true };
  }

  if (!create) return null;
  return { folder: rootFolder.createFolder(irNumber), archived: false };
}

// `root/Archive IRs` — created LAZILY. A store where nothing has been closed yet
// must not grow an empty folder just because the app might one day need one.
function getArchiveFolder(create) {
  var rootFolder = getRootFolder();
  var it = rootFolder.getFoldersByName(CONFIG.ARCHIVE_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return create ? rootFolder.createFolder(CONFIG.ARCHIVE_FOLDER_NAME) : null;
}

function getOrCreateSectionFolder(irNumber, sectionId) {
  // The IR folder wherever it now lives — NOT always the root. An upload to an
  // archived ticket lands beside the files already there.
  var found = findIRFolder(irNumber, true);

  // Section folder: e.g., "Section B - Inward Checklist"
  var sectionLabel = getSectionLabel(sectionId);
  var sectionFolder = getOrCreateSubfolder(found.folder, sectionLabel);

  return sectionFolder;
}

function getOrCreateSubfolder(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

// Drive folder label for a section's uploads. NOT the section's display name, and
// deliberate — merged sections keep the folder of their FIRST-LISTED source, so new
// uploads land beside the files already there instead of in a second folder for the
// same section:
//   sec-f (Quality Test Report) keeps 'Section F - Quality Control'  ← old sec-f
//   sec-g (PDI Report/Dispatch Record) keeps 'Section H - PDI'       ← old sec-h
// 'Section G - Flight Test' and 'Section I - Logistics Dispatch' therefore become
// HISTORICAL: still browsable in Drive, never written again. Renaming them is a
// Drive-wide mutation that needs its own editor function; until then the folder
// name simply does not match the tab letter, which is a documented wart, not a bug.
function getSectionLabel(sectionId) {
  var labels = {
    'sec-a': 'Section A - Preliminary Details',   // Overview; no uploads in practice
    'sec-b': 'Section B - Inward Checklist',
    'sec-c': 'Section C - IQC Inspection',
    'sec-d': 'Section D - Investigation',
    'sec-e': 'Section E - Production Rework',
    'sec-f': 'Section F - Quality Control',
    'sec-g': 'Section H - PDI',
  };
  return labels[sectionId] || sectionId;
}

function snapValue(v) {
  if (v == null) return '';
  var s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
  return s.length > 500 ? s.substring(0, 500) + '…' : s;
}

// BUILD the audit lines for one save. Pure — it reads nothing and writes nothing,
// so the caller can hold the lock across "read the old value → build the lines →
// write the data → append the lines" as one critical section. It used to write to
// the sheet itself, and it was called BEFORE the data write, so a save that then
// failed left an audit entry for a save that never happened.
function buildAuditLines(irNumber, sectionId, savedBy, existingFields, newFields, uploads) {
  var ts = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
  var lines = [];
  var isSentinel = String(irNumber).indexOf('__') === 0;
  // One "saved" marker per HUMAN section save, so even a no-change save is
  // traceable. Sentinel writes are skipped: every section save also fires
  // patchIRState(), so without this guard each save produced two marker rows, one
  // of them contentless. Workflow changes are still recorded — as the field lines
  // below, which the timeline reads by field id (`status`/`assignee`/`priority`/
  // `category`/`subCategory`), not by anything hardcoded here.
  function line(ev, fid, oldV, newV) {
    return { t: ts, ir: irNumber, sec: sectionId, by: savedBy, ev: ev, fid: fid, old: oldV, nw: newV };
  }
  if (!isSentinel) lines.push(line('saved', '', '', ''));
  var ex = existingFields || {};
  var nw = newFields || {};
  Object.keys(nw).forEach(function(k) {
    if (/_links$/.test(k)) return;            // derived Drive-link keys — not user edits
    if (k === 'done') return;                 // completion is implied by the save row
    var had = ex.hasOwnProperty(k);
    var newJ = snapValue(nw[k]);
    if (!had) {
      // A key with an EMPTY value is not an addition. The client posts every field
      // the section declares, so on a section's first save — where the stored
      // section is still {} — a line here claimed the saver had "added" every field
      // in that section, one row per field, all naming them. That is the owner's
      // "untouched fields show my name" report, and it buried the real edits.
      // Dropping it loses nothing: an absent key and a key holding '' are the same
      // thing to every reader (snapValue maps both to ''), so the first real value
      // for this field still diffs correctly against the empty it replaced.
      if (newJ === '') return;
      lines.push(line('added', k, '', newJ));
    } else if (snapValue(ex[k]) !== newJ) {
      lines.push(line('changed', k, snapValue(ex[k]), newJ));
    }
  });
  Object.keys(ex).forEach(function(k) {
    if (/_links$/.test(k)) return;
    if (k === 'done') return;
    // The same rule in the other direction: removing a key that held nothing
    // removes nothing. A genuine deletion still records, with the value it
    // destroyed — which is what a restore reads to put the field back.
    if (!nw.hasOwnProperty(k)) {
      var wasJ = snapValue(ex[k]);
      if (wasJ === '') return;
      lines.push(line('removed', k, wasJ, ''));
    }
  });

  // Uploads leave no trace anywhere else: file keys are `*_links` (skipped above by
  // design) and Drive is never enumerated. One line per uploaded file, sharing the
  // save's timestamp.
  //
  // This does NOT reintroduce the `_links`-key noise, for four independent reasons:
  // the Field ID here is the SOURCE field (f_qcDocs), never the derived key
  // (f_qcDocs_links); a line is emitted only when a human actually picked a file;
  // the `/_links$/` skips above still suppress a spurious `added` delta on first
  // upload; and 'uploaded' is its own event value, so a reader filters on the event
  // and never on the shape of a field name. The URL is deliberately not stored: it
  // is already in fields[<fid>_links], it is long, and it is re-derivable.
  (uploads || []).forEach(function(u) {
    if (!u) return;
    lines.push(line('uploaded', u.fieldId || '', '', snapValue(u.name || '')));
  });
  return lines;
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION: getAuditLog — returns the audit trail for one IR, OLDEST FIRST
// ──────────────────────────────────────────────────────────────────────────────
// Two kinds of line match, and the second is the whole reason the workflow half of
// the timeline needs no new storage:
//
//   section line   ir  === irNumber                      (an ordinary save)
//   workflow line  sec === irNumber AND ir starts with '__'
//
// Workflow writes (every __IRS__ patch) are recorded in the TICKET's own file, with
// `ir` = '__IRS__' and the real IR in `sec`. That is not a trick to make this reader
// work — it is where the entry belongs: a status change on IR409 IS IR409's history,
// and in the sheet version it was written all along, merely unreachable from here
// because the reader matched rows by one column. The `__` guard below is what keeps
// a future sentinel store from leaking into a real ticket's history.
//
// Every returned entry reports `irNumber` as the IR it is ABOUT — for a workflow
// line that is `sec`, never the store name in `ir`.
//
// The read is per-IR, so there is no whole-log scan: the file is ~40 KB and holds
// only this ticket's activity.
//
// `limit` bounds the RESPONSE. It trims from the OLDEST end, because the caller (a
// timeline) wants the most recent activity, and the file order is append-only
// chronological.
//
// `fieldId` narrows the read to ONE field's changes — the field history view, the
// right-click-a-cell equivalent the owner asked for. It filters BEFORE the cap, and
// that ordering is the whole reason the parameter exists: filtering after the trim
// would hand back "that field's changes, minus whatever older ones fell outside the
// ticket's newest 400 lines" — and the OLDEST entries are exactly the ones a
// restore reaches for. With the filter first, `limit` bounds THIS FIELD's history.
//
// A present `fieldId` matches on the line's own `fid`, which means a workflow line
// about that field (`status`, `assignee`, …) comes back with it — correct, since
// those ARE that field's history, and the reader already labels them as triage rows.
var AUDIT_RESPONSE_CAP = 400;

// ONE mapping from a stored audit line to the entry shape a client reads, so the
// reader below and every other caller of it cannot drift apart.
function auditEntryFromLine(l, irNumber) {
  var ir  = String(l.ir || '');
  var sec = String(l.sec || '');
  // A workflow line's own `ir` says `__IRS__` — the store name, not the ticket — so
  // reporting it verbatim would hand a consumer an entry it cannot attribute, and
  // make any future `e.irNumber === irNumber` filter silently drop every status
  // change. `irNumber` is the IR the line is ABOUT, in both halves.
  var isWorkflowRow = (sec === irNumber && ir.indexOf('__') === 0);
  return {
    timestamp: l.t,
    irNumber: isWorkflowRow ? sec : ir,
    sectionId: isWorkflowRow ? '' : sec,
    source: isWorkflowRow ? 'workflow' : 'section',
    savedBy: l.by, event: l.ev, fieldId: l.fid,
    oldValue: l.old, newValue: l.nw
  };
}

function getAuditLog(irNumber, limit, fieldId) {
  if (!irNumber) throw new Error('irNumber is required.');
  var wantField = (fieldId == null) ? '' : String(fieldId);
  var lines = readAuditLines(auditSubjectFor(irNumber, irNumber));
  var entries = [];
  lines.forEach(function (l) {
    var ir  = String(l.ir || '');
    var sec = String(l.sec || '');
    var isSectionRow  = (ir === irNumber);
    var isWorkflowRow = (sec === irNumber && ir.indexOf('__') === 0);
    if (!isSectionRow && !isWorkflowRow) return;
    if (wantField && String(l.fid || '') !== wantField) return;
    // A row that records NOTHING is not history. Until buildAuditLines was fixed, a
    // section's first save wrote an `added` line for every field the section
    // declares — empty ones included — so every clock in that section named the
    // saver for a change nobody made. Those rows are already ON DISK for every IR
    // saved before the fix, and stored history is never rewritten (the backend is
    // under a pinned test that it erases nothing), so they are refused HERE instead.
    // Placed before the cap on purpose: dead rows must not push real ones out of
    // the newest 400, and the oldest rows are what a restore reaches for.
    if (l.ev === 'added'   && String(l.nw  || '') === '') return;
    if (l.ev === 'removed' && String(l.old || '') === '') return;
    entries.push(auditEntryFromLine(l, irNumber));
  });
  var cap = parseInt(limit, 10);
  if (isNaN(cap) || cap <= 0) cap = AUDIT_RESPONSE_CAP;
  if (cap > AUDIT_RESPONSE_CAP) cap = AUDIT_RESPONSE_CAP;
  if (entries.length > cap) entries = entries.slice(entries.length - cap);
  return { status: 'ok', entries: entries, truncated: entries.length === cap };
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
// ONE-TIME SETUP — run these from the Apps Script editor, in this order.
//
//   initializeStore()      creates _store/ and seeds the empty files
//   seedDepartments()      writes the owner's department → section grants
//   seedMemberships()      adds one department edge per person
//   bootstrapAdmin()       creates the admin account, prints its temp password
//   seedAccounts()         creates one account per seeded member, prints temp passwords
//
// There is no cutover ordering problem any more, and that is worth stating plainly
// because the previous version of this file had a long comment explaining why there
// WAS one. The old order existed because (a) widening a DEPARTMENTS tab would be read
// positionally by the still-live old backend and misgrant every section, and (b) the
// APP_DATA merge rewrote rows the live app was reading. Neither exists now: there are
// no columns and no rows, `_store/` is a folder the old backend never looks at, and
// the store starts empty. The whole pre-flight/cutover split collapses into "run five
// functions, then deploy".
//
// seedAccounts() is last because it skips the admin address outright (isAdminEmail),
// so the admin's one printed password comes from bootstrapAdmin() and every other
// person's comes from seedAccounts(). Both functions are safe to re-run.
//
//   Anytime after go-live:
//     maintenancePruneSessions(), maintenancePruneAuditLog()
// ──────────────────────────────────────────────────────────────────────────────

// report() — MAKE AN EDITOR-FACING REPORT VISIBLE.
//
// These functions RETURN a human-readable report, and returning it is still right:
// it keeps them callable from a future UI, and the suites assert on the strings.
// But when you run one from the Apps Script editor, the execution log shows ONLY
// what the code logs — a returned value is never displayed. So without this, a run
// reports "Execution completed" and nothing else: no `dropped` grant list, no
// one-time admin password. Every one of those is something an operator has to READ
// to run the setup safely, which makes an un-loggable report the same as no report.
//
// Wrap EVERY report return in this. The early refusals matter most: "refusing to
// overwrite" is exactly the message that must not be swallowed.
function report(msg) {
  console.log(msg);
  return msg;
}

// Create the department names as EMPTY rows — names only, NO section grants.
// Deliberately no grants: which department may edit which section is the owner's
// call, and a guess here would hand out edit rights nobody asked for. Tick them in
// the app's Departments tab.
var SEED_DEPARTMENTS = [
  'Production', 'QC', 'Flight Test', 'IQC', 'Purchase',
  'Inventory', 'CR', 'Compliance', 'Engineering', 'Management'
];

// ──────────────────────────────────────────────────────────────────────────────
// SEEDED GRANTS — the owner's mapping, supplied 2026-09-16. Changing it is their
// call, not a maintenance decision. Section letters are the CURRENT ones (B–G).
// ──────────────────────────────────────────────────────────────────────────────
//   Production   B C D E G      QC         B C D F     Flight Test  F
//   Purchase     D              Inventory  B D G       Engineering  D
//   CR           — (Triage)     Management — (Triage)  IQC / Compliance  —
//
// An empty list is a REAL answer, not an omission: CR and Management hold Triage
// and edit no section at all — that is what makes this a second axis rather than a
// seventh permission key. IQC and Compliance hold neither.
var SEED_GRANTS = {
  'production':  ['sec-b', 'sec-c', 'sec-d', 'sec-e', 'sec-g'],
  'qc':          ['sec-b', 'sec-c', 'sec-d', 'sec-f'],
  'flight-test': ['sec-f'],
  'iqc':         [],
  'purchase':    ['sec-d'],
  'inventory':   ['sec-b', 'sec-d', 'sec-g'],
  'cr':          [],
  'compliance':  [],
  'engineering': ['sec-d'],
  'management':  []
};

// Departments that may Triage. Same cells as a section grant ('edit'/''), separate
// axis. CR and Management: they own the ticket header, not any section's content.
var TRIAGE_DEPARTMENTS = ['cr', 'management'];

// ──────────────────────────────────────────────────────────────────────────────
// SEEDED MEMBERSHIPS — person ↔ department edges. Owner's list, 2026-09-16.
// ──────────────────────────────────────────────────────────────────────────────
// Purchase and Inventory get BOTH edges for all three people. That is deliberate,
// not lazy: the owner gave one list covering two departments, and the codebase's own
// rule is that inferring which person belongs to which is exactly the "a wrong guess
// grants write access silently" failure. The two departments have DIFFERENT grants
// (B/D/G vs D), so merging them would be wrong too. Both edges is faithful, and it is
// reversible in the Departments tab in seconds.
//
// IQC and Compliance are deliberately absent — nobody was named for them. They hold
// no grants anyway, so this changes nothing about anyone's access; seedMemberships()
// says so in its report so the omission reads as intentional.
var SEED_MEMBERSHIPS = {
  'production':  ['ganesh.suryavanshi', 'satish.dhanawade', 'mukesh.mane', 'nilesh.pawar'],
  'qc':          ['angad.kumbhar'],
  'flight-test': ['ankit.prajapati', 'vicky.malekar', 'angad.kumbhar'],
  'purchase':    ['vaibhav.panchal', 'purchase', 'tushar.kadam'],
  'inventory':   ['vaibhav.panchal', 'purchase', 'tushar.kadam'],
  'engineering': ['lavlesh.poyarekar', 'rushabh.rambhiya', 'ravi.maurya', 'shubham.jolapara', 'ravi'],
  'cr':          ['adhik.nair', 'monish.raza'],
  'management':  ['ravi', 'harshad']
};

function seedDepartments() {
  return report(withRowLockOrThrow(function () {
    var store = readJsonLocked('access.json') || {};
    if (!store.departments) store.departments = {};
    if (!store.memberships) store.memberships = {};

    var ts = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
    var created = [], updated = [], unchanged = [], dropped = [];

    Object.keys(SEED_GRANTS).forEach(function (key) {
      var desiredSecs   = SEED_GRANTS[key];
      var desiredTriage = TRIAGE_DEPARTMENTS.indexOf(key) > -1;
      var name          = seedDeptName(key);
      var existing      = store.departments[key];

      if (!existing) {
        var grants = {};
        SECTION_KEYS.forEach(function (s) { if (desiredSecs.indexOf(s) > -1) grants[s] = true; });
        store.departments[key] = { name: name, active: 'yes', grants: grants,
                                   triage: desiredTriage, updatedAt: ts, updatedBy: 'seed' };
        created.push(key + (desiredSecs.length ? '' : ' (no sections)') + (desiredTriage ? ' +Triage' : ''));
        return;
      }

      // UPSERT, not "already there, skip". `present` used to mean "nothing to do", so
      // a half-granted or wrong department was never corrected — which is the whole
      // failure mode this seeds against.
      var have = existing.grants || {};
      var deltas = [];
      SECTION_KEYS.forEach(function (s) {
        var want = desiredSecs.indexOf(s) > -1;
        var cur  = !!have[s];
        if (cur === want) return;
        if (want) { have[s] = true; deltas.push('+' + s); }
        else {
          delete have[s];
          // Losing a grant is the one thing a rewrite can do silently, so it is
          // reported separately and loudly rather than as just another delta.
          dropped.push(key + ': ' + s);
          deltas.push('-' + s);
        }
      });
      var haveTriage = !!existing.triage;
      if (haveTriage !== desiredTriage) deltas.push(desiredTriage ? '+Triage' : '-Triage');

      existing.name      = name;
      existing.active    = 'yes';
      existing.grants    = have;
      existing.triage    = desiredTriage;
      existing.updatedAt = ts;
      existing.updatedBy = 'seed';
      store.departments[key] = existing;

      if (deltas.length) updated.push(key + ': ' + deltas.join(', '));
      else unchanged.push(key);
    });

    // ONE key per department, written as one file. Any department in the store that
    // SEED_GRANTS does not name is left untouched rather than deleted — a seed that
    // removes things is not a seed.
    writeJsonLocked('access.json', store);

    var lines = [];
    lines.push(created.length  ? 'Created (' + created.length + '): ' + created.join('; ') : 'Created: none');
    lines.push(updated.length  ? 'Updated (' + updated.length + '): ' + updated.join('; ') : 'Updated: none');
    lines.push('Unchanged: ' + (unchanged.length ? unchanged.join(', ') : 'none'));
    lines.push(dropped.length
      ? 'DROPPED GRANTS (' + dropped.length + ') — read these before you trust the matrix: ' + dropped.join('; ')
      : 'DROPPED GRANTS: none.');
    lines.push('');
    lines.push('IQC and Compliance are seeded with no grants and no members — intentional.');
    lines.push('The grants are live as soon as this returns; tick any changes in the app.');
    return lines.join('\n');
  }));
}

// "flight-test" -> "Flight Test" for the display Name.
function seedDeptName(key) {
  var i = SEED_DEPARTMENTS.map(deptKeyFromName).indexOf(key);
  return i > -1 ? SEED_DEPARTMENTS[i] : key;
}

// ──────────────────────────────────────────────────────────────────────────────
// seedMemberships() — add the owner's person↔department edges, ADD ONLY.
// ──────────────────────────────────────────────────────────────────────────────
// Deliberately NOT setUserDepartments(): that REPLACES one person's whole list, which
// is right for an admin editing that person and wrong for a seed, because it would
// wipe any edge somebody added between the seed being written and being run. This
// only ever adds, and says so in its report — "nothing removed" is the property the
// operator needs to trust before running it.
function seedMemberships() {
  return report(withRowLockOrThrow(function () {
    var store = readJsonLocked('access.json') || {};
    if (!store.departments) store.departments = {};
    if (!store.memberships) store.memberships = {};

    var added = 0, already = 0, addedEmails = {};
    // Deterministic department order, so the report reads the same on every run.
    Object.keys(SEED_GRANTS).forEach(function (key) {
      var people = SEED_MEMBERSHIPS[key] || [];
      people.forEach(function (local) {
        var email = local.indexOf('@') > -1 ? local.toLowerCase() : local.toLowerCase() + '@' + CONFIG.ALLOWED_DOMAIN;
        var list  = (store.memberships[email] instanceof Array) ? store.memberships[email] : [];
        if (list.indexOf(key) > -1) { already++; return; }
        list.push(key);
        store.memberships[email] = list;
        addedEmails[email] = true;
        added++;
      });
    });

    writeJsonLocked('access.json', store);

    // Accounts that cannot sign in yet. The edge is still correct — department
    // capabilities read memberships directly — but User Access will list a member
    // with no account, so say which ones.
    var noAccount = Object.keys(addedEmails).filter(function (email) {
      try { return !findUser(email); } catch (e) { return false; }
    });

    var lines = [];
    lines.push('Added ' + added + ' membership(s); ' + already + ' already present. Nothing removed.');
    lines.push('Departments seeded: ' + Object.keys(SEED_GRANTS).filter(function (k) {
      return (SEED_MEMBERSHIPS[k] || []).length;
    }).join(', '));
    lines.push('Purchase AND Inventory each list all three of vaibhav.panchal, purchase, tushar.kadam — intentional.');
    lines.push('IQC and Compliance have no members — intentional (nobody was named for them).');
    lines.push(noAccount.length
      ? 'Added but NOT YET SIGN-IN-ABLE (' + noAccount.length + '): ' + noAccount.join(', ') +
        ' — the edge is correct, they just have no account yet.'
      : 'Every added email already has an account.');
    return lines.join('\n');
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// seedAccounts() — one account per seeded member, each with a temporary password.
// ──────────────────────────────────────────────────────────────────────────────
// Run AFTER seedDepartments() and seedMemberships(), and after bootstrapAdmin().
//
// The roster is the UNION OF SEED_MEMBERSHIPS ITSELF, not a second copy of it. A
// duplicate list would drift the moment somebody joins, and this way every seeded
// department edge is guaranteed an account to attach to — which is the one thing
// seedMemberships() cannot do, and why it prints the addresses that have none.
//
// ADD ONLY, like the other seeds: an existing account is SKIPPED, never rewritten.
// Rewriting one would be worse than useless — it would issue a fresh temp password
// to somebody who is already using theirs, and silently invalidate the password
// they have.
//
// The temp passwords are printed ONCE, to the execution log, and are stored
// nowhere: only the hash, the salt and `tempPwIssuedAt` reach users.json, so there
// is no way to recover one afterwards. Copy the log into the local credentials txt
// at the time. The log is not a private place — anyone with editor access to this
// project can read it, and it does not last forever.
function seedAccounts() {
  // Unique addresses, sorted, so the report reads identically on every run.
  var emails = [];
  Object.keys(SEED_GRANTS).forEach(function (key) {
    (SEED_MEMBERSHIPS[key] || []).forEach(function (local) {
      var email = local.indexOf('@') > -1
        ? local.toLowerCase()
        : local.toLowerCase() + '@' + CONFIG.ALLOWED_DOMAIN;
      if (emails.indexOf(email) < 0) emails.push(email);
    });
  });
  emails.sort();

  var created = [], skipped = [];
  emails.forEach(function (email) {
    if (isAdminEmail(email)) {
      skipped.push(email + ' — admin; bootstrapAdmin() creates this one');
      return;
    }
    if (!validEmail(email)) {
      skipped.push(email + ' — not a valid email address');
      return;
    }
    if (findUser(email)) {
      skipped.push(email + ' — account already exists, password left untouched');
      return;
    }
    // createUserRow takes its own lock and adds ONE key to users.json, so this
    // loop must NOT hold the lock itself — a nested lock is refused, not queued.
    try {
      created.push({ email: email, pw: createUserRow(email, displayNameFor(email), 'seedAccounts') });
    } catch (err) {
      skipped.push(email + ' — ' + ((err && err.message) || 'failed'));
    }
  });

  var lines = [];
  lines.push('Created ' + created.length + ' account(s). Each must set their own password on first sign-in.');
  lines.push('Email' + '\t' + 'Temporary password');
  created.forEach(function (c) { lines.push(c.email + '\t' + c.pw); });
  if (skipped.length) {
    lines.push('');
    lines.push('Skipped (' + skipped.length + '):');
    skipped.forEach(function (s) { lines.push('  ' + s); });
  }
  lines.push('');
  lines.push('⚠ Shown ONCE and stored nowhere — copy this log into the local credentials txt');
  lines.push('  now, hand each person only their own line, then clear this from the log.');
  return report(lines.join('\n'));
}

// A display name derived from an address, when the address is a person's:
// "first.last" → "First Last". Role addresses ("purchase@") and bare names
// ("ravi@") have no derivable full name and stay BLANK rather than being guessed
// at — the admin can set any of them in User Access. Cosmetic only: nothing in the
// app authorises on a name.
function displayNameFor(email) {
  var local = String(email).split('@')[0];
  if (local.indexOf('.') < 0) return '';
  return local.split('.').map(function (part) {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}


// Ensure the admin has a usable account. If the record is missing it is created
// with a temporary password (returned ONCE — copy it out of the execution log); if
// it exists, its password is left alone and only the flags are normalised so the
// admin isn't forced through the first-login change.
function bootstrapAdmin() {
  var email = (CONFIG.ADMIN_EMAILS[0] || '').toLowerCase().trim();
  if (!email) return report('No CONFIG.ADMIN_EMAILS configured.');
  if (findUser(email)) {
    return report(withRowLockOrThrow(function () {
      // readJsonLocked, NOT findUser: findUser reads through the memoised readJson,
      // and that copy may predate the lock. Writing it back would undo a password
      // reset or a disable that landed in between — the whole reason the read has
      // to be inside the lock.
      var users = readJsonLocked('users.json') || {};
      var rec = users[usersKey(email)];
      if (!rec) return 'Admin ' + email + ' vanished mid-run.';
      rec.mustChange = '';
      rec.status     = 'active';
      users[usersKey(email)] = rec;
      writeJsonLocked('users.json', users);
      return 'Admin ' + email + ' already exists — flags normalised, existing password untouched.';
    }));
  }
  var pw = createUserRow(email, 'Monish Raza', 'bootstrap');
  return report('Created admin ' + email + '.\nTEMPORARY PASSWORD: ' + pw +
         '\nSign in with it, set your own password, and delete this log line afterwards.');
}

// Delete long-expired session records. Safe anytime; nothing calls it automatically
// except a best-effort prune at sign-in.
function maintenancePruneSessions() {
  pruneSessions();
  return report('Pruned expired sessions.');
}

// ──────────────────────────────────────────────────────────────────────────────
// MAINTENANCE: pruneAuditLog — drop audit entries older than the retention window
// ──────────────────────────────────────────────────────────────────────────────
// MANUAL, never automatic. The audit trail is the app's evidence of who changed
// what; shrinking it behind anyone's back would be the wrong default, so this is a
// lever an operator pulls on purpose, alongside maintenancePruneSessions().
//
// 400 days, not 90: the Sheet is the system of record for a warranty period, and
// the log is what answers "who changed this and when" a year later.
var AUDIT_RETENTION_DAYS = 400;

// Per-IR files made this cheaper and safer than the tab version: only the affected
// tickets are rewritten, where the old code rewrote one whole tab.
//
// THE RETENTION RULE, and the wart that used to be in it. Pruning is per-subject,
// so an entry older than 400 days could go while its ticket was still open — the
// audit records no open/closed state, so a "smarter rule" was not available here.
//
// It is available now, from a different direction: the IR's own existence is a
// fact this function can just look up. The owner's rule for the field history is
//
//   "Till IR records are being kept in drive, so the history."
//
// so a per-TICKET file is skipped entirely while that IR is still in the store, at
// any age. This is the piece that makes the field-history promise true rather than
// true-until-somebody-runs-a-maintenance-lever: an old value on a live ticket stays
// puttable-back past 400 days, which is precisely the case a restore is for.
//
// Liveness is decided through the SAME read runArchiveSweep uses for the same
// question (`__IRS__` → irs.json), plus sections/index.json — the map of every IR
// with stored data. The second read matters: a ticket that has saved a section but
// has no workflow row yet is invisible to the sweep and utterly alive, and it is
// exactly the ticket a young, half-filled IR is. Erring is toward KEEPING
// throughout — an unreadable store, an IR in neither map, or a file whose name is
// not an IR all leave that file alone.
//
// Sentinel subjects (signins, config, nudges, kb) are NOT ticket files and keep
// today's behaviour — there is no "is it still live?" for a sign-in log.
function maintenancePruneAuditLog() {
  return report(withRowLockOrThrow(function () {
    var folder = getStoreSubfolder(STORE_AUDIT_DIR, false);
    if (!folder) return 'No audit/ folder — nothing to prune.';

    // Two store reads for the whole run, under the same lock. A key that is not an
    // IR number is filtered out rather than trusted: irs.json keys are validated on
    // write as real-world ids, not as IR numbers.
    var live = {};
    var irsStore = readJsonLocked(sentinelStoreFile('__IRS__')) || {};
    Object.keys(irsStore).forEach(function (k) { if (/^IR\d+$/.test(k)) live[k] = true; });
    var idx = readSectionsIndex(true);
    Object.keys(idx.irs || {}).forEach(function (k) { if (/^IR\d+$/.test(k)) live[k] = true; });

    var cutoff = Date.now() - (AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    var files = folder.getFiles();
    var prunedFiles = 0, prunedLines = 0, keptLines = 0, unreadable = 0;
    var skippedLive = 0;

    while (files.hasNext()) {
      var file = files.next();
      var subject = String(file.getName()).replace(/\.jsonl$/, '');

      // A LIVE TICKET'S HISTORY IS NOT PRUNABLE. Skipped before the file is even
      // read — there is nothing to decide line by line.
      if (/^IR\d+$/.test(subject) && live[subject]) {
        skippedLive++;
        continue;
      }

      var lines = parseAuditLines(file.getBlob().getDataAsString(), subject);
      if (!lines.length) continue;
      // `parseAuditLines` turns an unparseable line into a visible placeholder with
      // no timestamp; parseAuditTimestamp answers null for it and it is KEPT, never
      // guessed at. Deleting a line nobody can read is how evidence disappears.
      var keep = lines.filter(function (l) {
        var ms = parseAuditTimestamp(l.t);
        if (ms === null) { unreadable++; return true; }
        return ms >= cutoff;
      });
      var gone = lines.length - keep.length;
      if (!gone) { keptLines += lines.length; continue; }

      // One locked rewrite of this subject's file. The lock is held across the whole
      // loop, which is why there is no read-merge-write race between two tickets.
      file.setContent(keep.map(function (l) { return JSON.stringify(l); }).join('\n') + (keep.length ? '\n' : ''));
      prunedFiles++;
      prunedLines += gone;
      keptLines += keep.length;
    }

    // The skip is REPORTED, not silent: a run that prunes fewer lines than the
    // operator expects should say why, or the next person concludes the rule is
    // broken and "fixes" it.
    var skipNote = skippedLive
      ? ' ' + skippedLive + ' audit file(s) belonging to a LIVE IR were left untouched — the history ' +
        'is kept as long as the ticket is (see the retention note above), so those entries do not expire on age.'
      : '';

    if (!prunedLines) {
      return 'Nothing older than ' + AUDIT_RETENTION_DAYS + ' days. Audit unchanged.' + skipNote;
    }
    return 'Pruned ' + prunedLines + ' audit entr(y/ies) older than ' + AUDIT_RETENTION_DAYS +
           ' days across ' + prunedFiles + ' ticket file(s). ' + keptLines + ' entr(y/ies) kept' +
           (unreadable ? ', including ' + unreadable + ' unreadable line(s) kept on purpose.' : '.') +
           skipNote;
  }));
}

// Read the sign-in audit — `audit/signins.jsonl`, written on every successful
// sign-in by doLoginPassword. An operator lever run from the editor, in the same
// spirit as maintenancePruneAuditLog: the value of the record is that it EXISTS and
// can be produced on demand, so this prints the window to the execution log rather
// than living on a screen nobody opens. Read-only, so it takes no lock.
//
// What it answers is the question the log was added for: was this one person signing
// in twice a day, or was one code used from two places? A line whose code was issued
// hours before it was redeemed is the one to look at.
function reportRecentSignins(days) {
  var windowDays = Number(days) > 0 ? Number(days) : 1;
  var cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  var lines = readAuditLines(SIGNIN_AUDIT_SUBJECT).filter(function (l) {
    var ms = parseAuditTimestamp(l.t);
    return ms !== null && ms >= cutoff;
  });
  if (!lines.length) return report('No sign-ins recorded in the last ' + windowDays + ' day(s).');
  report('Signed in during the last ' + windowDays + ' day(s):');
  lines.forEach(function (l) {
    report('  ' + String(l.t) + '   ' + String(l.by) + '   ' + String(l.nw));
  });
  return report(lines.length + ' sign-in(s) in the last ' + windowDays + ' day(s).');
}

// ──────────────────────────────────────────────────────────────────────────────
// ARCHIVE — move a CLOSED ticket's Drive folder out of the working set.
//
// The owner binds `root/Archive IRs` to the company server, so what lands there is
// synced off Drive. NOTHING HERE ERASES ANYTHING: the sweep MOVES a folder and
// stops. Erasing is a separate decision the owner has deliberately deferred until
// they can see whether Drive space is actually a problem — so do not add it here
// without being asked, and do not "tidy up" what is already in the archive.
//
// The folder KEEPS ITS NAME (`Archive IRs/IR409`, section subfolders intact), and
// every passbook link keeps working: a stored link is a file-id URL, and a move
// does not change a file's id.
// ──────────────────────────────────────────────────────────────────────────────

// How long a ticket must have been closed before its folder is swept. A month means
// a close-then-reopen inside the reporting period never moves anything, which is the
// common case; the reopen path in saveSection covers the rest immediately.
var ARCHIVE_AFTER_DAYS = 30;

// Per run, and deliberately small. The first sweep is something the owner WATCHES
// land in Drive, and sixty simultaneous folder moves is not a thing anyone can
// verify. Re-running continues where this left off — the sweep is idempotent.
var ARCHIVE_MAX_PER_RUN = 10;

// The audit line for an archive move. Same shape buildAuditLines emits for a
// workflow write — `ir` is the STORE name, the ticket is in `sec` — so the timeline
// reads it with no special case. The audit schema has no free-text field, so `nw`
// carries the location and `fid` is '' exactly as `uploaded` does.
function archiveAuditLine(irNumber, ev, newValue, by) {
  return {
    t: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss'),
    ir: '__IRS__', sec: String(irNumber), by: by || '',
    ev: ev, fid: '', old: '', nw: String(newValue || '')
  };
}

// Who to record against an archive move. The audit schema's `by` is its one free
// field, so the actor belongs there: a hand-run sweep records the person who ran
// it, a trigger run records the trigger's owner, and an environment with no Session
// (the test harness) records the sweep itself rather than throwing.
function sweepActor() {
  try {
    var email = Session.getEffectiveUser().getEmail();
    if (email) return email;
  } catch (e) { /* no Session in this environment — fall through */ }
  return 'archive sweep';
}

// The move itself, given the folder. Split out because the sweep has already LISTED
// the archive and holds the folder handle — re-finding it by name would be a second
// search for something it is already holding.
function moveFolderBetween(folder, toArchive) {
  var destination = toArchive
    ? getArchiveFolder(true)
    : getRootFolder();
  // `moveTo`, not copy-and-delete. A file's id is unchanged by a move, so the links
  // already saved in the passbook keep resolving — which is the whole reason
  // archiving a ticket that is still readable is safe.
  folder.moveTo(destination);
}

// Move one IR's folder between the root and `Archive IRs`. BOTH directions, one
// implementation: the reopen path and the sweep have to agree on what "archived"
// means, and two copies of that would drift.
//
// Returns 'archived' | 'restored', or null when the folder is already where it was
// asked to go — the common case for a sweep that runs every day.
function moveIRFolder(irNumber, toArchive) {
  var found = findIRFolder(irNumber, false);
  if (!found) return null;                          // no folder yet — nothing to move
  if (found.archived === !!toArchive) return null;  // already there
  moveFolderBetween(found.folder, toArchive);
  return toArchive ? 'archived' : 'restored';
}

// The reopen half, called from saveSection AFTER the new status has been stored.
// Takes its own lock for the audit append — NOT a nested one: saveSection's lock has
// already been released by the time this runs.
function restoreIRFolder(irNumber, by) {
  var did = moveIRFolder(irNumber, false);
  if (!did) return null;
  withRowLockOrThrow(function () {
    appendAuditLinesLocked(irNumber,
      [archiveAuditLine(irNumber, 'restored', 'Moved back to the main folder', by)]);
  });
  return did;
}

// THE SWEEP. Run it from the Apps Script editor, or let the trigger that
// installArchiveTrigger() sets up run it daily.
//
// It RECONCILES rather than only archiving: a folder in the archive whose ticket is
// no longer closed comes back, and a folder in the root whose ticket has been closed
// for ARCHIVE_AFTER_DAYS goes out. The direction is decided from the STATUS and from
// where the folder actually IS — never from a stored "archived" flag, which would be
// a second source of truth and would start lying the first time anyone dragged a
// folder in the Drive UI.
//
// This wrapper exists so the function can NEVER THROW. A trigger that throws sends
// the owner a failure email every single night, and a nightly email nobody can act
// on is how a real failure goes unread for a month.
function archiveClosedIRs() {
  try {
    return report(runArchiveSweep());
  } catch (e) {
    // The lock being busy is the likeliest cause by far, and it is not a fault:
    // the moves simply did not happen and the next run will do them.
    return report('Archive sweep did not run — ' + e.message + '\n' +
                  'Nothing was erased, and nothing that was already archived was touched. ' +
                  'The next run picks up where this one stopped.');
  }
}

function runArchiveSweep() {
  var by = sweepActor();

  // ── Phase 1: the statuses, under the lock. Nothing but a store read.
  var store = withRowLockOrThrow(function () {
    return readJsonLocked(sentinelStoreFile('__IRS__')) || {};
  });

  // ── Phase 2: where the folders ACTUALLY are, outside the lock. ONE listing of the
  // archive rather than a name search per ticket: ~450 searches a night would be
  // both slower and less reliable than reading one folder's children, and Drive's
  // name search is the eventually-consistent one (see the note on readSectionsIndex).
  var archiveFolder = getArchiveFolder(false);
  var inArchive = {};
  if (archiveFolder) {
    var kids = archiveFolder.getFolders();
    while (kids.hasNext()) {
      var kid = kids.next();
      var name = String(kid.getName());
      if (/^IR\d+$/.test(name)) inArchive[name] = kid;
    }
  }

  // ── Phase 3: decide. Both directions, from the status alone.
  var cutoff = Date.now() - (ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  var candidates = [], restore = [], waiting = 0, noClock = 0, skippedKeys = [];
  var known = {};

  Object.keys(store).forEach(function (irNumber) {
    // An irs.json key is validated on write as a real-world id, NOT as an IR
    // number, so a junk key is possible and has to be filtered here rather than
    // handed to findIRFolder — which asserts the shape and would throw the whole
    // run away over one bad key.
    if (!/^IR\d+$/.test(irNumber)) { skippedKeys.push(irNumber); return; }
    known[irNumber] = true;

    var row = store[irNumber];
    // `statusOwned` is load-bearing. Without it, a status inherited from the Sheet's
    // Col D would read as the app's own decision, and a ticket nobody closed in the
    // app could have its folder archived.
    var closed = !!(row && typeof row === 'object' && row.statusOwned && row.status === 'Close');

    // Archived, but no longer closed. The reopen hook in saveSection runs on the
    // app's own status change and normally gets there first — but it CAN fail (and
    // says so in the save's own message), and a status corrected by hand writes no
    // hook at all. Reconciling here is what makes either case heal within a day.
    if (inArchive[irNumber] && !closed) { restore.push(irNumber); return; }
    if (!closed) return;

    // An unusable `statusAt` is NOT guessed at. The field arrived with statusOwned,
    // so a stored Close can predate it; that ticket waits for the owner to sweep it
    // by hand rather than being archived on an invented date.
    var at = Number(row.statusAt);
    if (!isFinite(at) || at <= 0) { noClock++; return; }

    if (at > cutoff) { waiting++; return; }
    if (inArchive[irNumber]) return;         // already out there — nothing to do
    candidates.push({ ir: irNumber, closedAt: at });
  });

  // A folder in the archive for an IR with NO row at all. That is not a closed
  // ticket by any reading, so it comes back: an IR missing from the store is one
  // whose status nobody knows, and the archived folder is where its evidence lives.
  Object.keys(inArchive).forEach(function (irNumber) {
    if (!known[irNumber]) restore.push(irNumber);
  });

  candidates.sort(function (a, b) { return a.closedAt - b.closedAt; });   // oldest first
  var batch = candidates.slice(0, ARCHIVE_MAX_PER_RUN);

  // ── Phase 4: move, outside the lock.
  var moved = [], returned = [], failed = [], noFolder = [];
  batch.forEach(function (c) {
    try {
      if (moveIRFolder(c.ir, true)) moved.push(c.ir);
      else noFolder.push(c.ir);      // no Drive folder — a ticket with no uploads yet
    } catch (e) {
      failed.push(c.ir + ': ' + e.message);
    }
  });
  restore.forEach(function (irNumber) {
    try {
      // The handle from Phase 2, not a fresh search for something already in hand.
      moveFolderBetween(inArchive[irNumber], false);
      returned.push(irNumber);
    } catch (e) {
      failed.push(irNumber + ' (back): ' + e.message);
    }
  });

  // ── Phase 5: the audit, ONE lock for the whole batch rather than one per ticket,
  // and only for folders that ACTUALLY moved: the log must never claim a move that
  // did not happen.
  if (moved.length || returned.length) {
    withRowLockOrThrow(function () {
      moved.forEach(function (irNumber) {
        appendAuditLinesLocked(irNumber,
          [archiveAuditLine(irNumber, 'archived', 'Moved to ' + CONFIG.ARCHIVE_FOLDER_NAME, by)]);
      });
      returned.forEach(function (irNumber) {
        appendAuditLinesLocked(irNumber,
          [archiveAuditLine(irNumber, 'restored', 'Moved back to the main folder', by)]);
      });
    });
  }

  var tail = [];
  if (moved.length)          tail.push('Archived: ' + moved.join(', '));
  if (returned.length)       tail.push('Restored: ' + returned.join(', '));
  if (candidates.length > batch.length)
    tail.push((candidates.length - batch.length) + ' more are ready — run again to continue.');
  if (waiting)               tail.push(waiting + ' closed ticket(s) not yet ' + ARCHIVE_AFTER_DAYS + ' days old.');
  if (noClock)               tail.push(noClock + ' closed ticket(s) have no usable close date — sweep those by hand.');
  if (noFolder.length)       tail.push('No Drive folder, so nothing to move: ' + noFolder.join(', '));
  if (failed.length)         tail.push('FAILED, left where they were: ' + failed.join(' | '));
  if (skippedKeys.length)    tail.push('Skipped, not IR numbers: ' + skippedKeys.join(', '));
  if (!tail.length)          tail.push('Nothing to do.');

  return 'Archive sweep — archived ' + moved.length + ', restored ' + returned.length +
         ' (cap ' + ARCHIVE_MAX_PER_RUN + ' archived per run).\n' + tail.join('\n');
}

// Install the daily trigger. Run ONCE from the Apps Script editor.
//
// It must be run by the account that OWNS the Drive folder, because a trigger
// executes as the user who created it. Installed from any other account it fails
// every night with a permission error nobody is there to read.
//
// Idempotent: a second run reports the trigger it found rather than adding another.
// Two triggers would just mean two sweeps a day, silently.
function installArchiveTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'archiveClosedIRs';
  });
  if (existing.length) {
    return report('Already installed — ' + existing.length +
                  ' trigger(s) call archiveClosedIRs. Nothing changed.');
  }
  ScriptApp.newTrigger('archiveClosedIRs').timeBased().everyDays(1).atHour(2).create();
  return report('Installed. archiveClosedIRs runs daily around 02:00, in the script\'s own time zone (' +
                Session.getScriptTimeZone() + '), as ' + Session.getEffectiveUser().getEmail() + '.\n' +
                'Until this existed, folders were archived ONLY when someone ran the sweep by hand.');
}

// Remove it again. Installed-but-unwanted is a state worth being able to leave, and
// without this the only way out is the Triggers page.
function removeArchiveTrigger() {
  var found = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'archiveClosedIRs';
  });
  if (!found.length) return report('No archive trigger installed. Nothing changed.');
  found.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return report('Removed ' + found.length + ' archive trigger(s). ' +
                'Folders already moved to "' + CONFIG.ARCHIVE_FOLDER_NAME + '" stay where they are.');
}

// Parse the app's 'dd-MMM-yyyy HH:mm:ss' stamp into epoch ms, or null.
// Date.parse() returns NaN for this format in V8 — it would silently scramble any
// ordering or cutoff built on it, so the format is parsed explicitly here.
function parseAuditTimestamp(v) {
  if (v instanceof Date) return v.getTime();
  var m = String(v || '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})[ T](\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  var mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase());
  if (mon < 0) return null;
  return new Date(parseInt(m[3], 10), mon, parseInt(m[1], 10),
                  parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6], 10)).getTime();
}

// ──────────────────────────────────────────────────────────────────────────────
// RESPONSE HELPER — Always return CORS-friendly JSON
// ──────────────────────────────────────────────────────────────────────────────
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
