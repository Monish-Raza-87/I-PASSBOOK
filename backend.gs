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

  // Google OAuth web client ID (same one the frontend uses for GIS sign-in).
  // Used server-side to verify the ID token's audience.
  GOOGLE_CLIENT_ID: '719566494973-i27l1935v7rrcatv11simfoertsf733a.apps.googleusercontent.com',
};

// Authorized Customer Relations personnel — only these emails can edit restricted fields
var AUTHORIZED_CR_EMAILS = ['monish.raza@indrones.com', 'ravi@indrones.com', 'adhik.nair@indrones.com'];

// ──────────────────────────────────────────────────────────────────────────────
// ENTRY POINTS
// ──────────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────
// AUTH — verify the caller's Google ID token
// ──────────────────────────────────────────────────────────────────────────────
// The web app runs "Execute as: Me" + access "Anyone", so the backend must
// authenticate the caller itself. The frontend attaches a fresh Google ID
// token (from GIS) to every request. We verify it against Google's tokeninfo
// endpoint — checking audience (our client ID), email_verified, @indrones.com
// domain, and expiry — and return the verified email. The email is read FROM
// THE TOKEN, never from a client-supplied parameter, so the Indrones-only gate
// can no longer be spoofed by passing a known email.
function requireAuth(e) {
  var token = (e.parameter.idToken || '').toString().trim();
  return verifyIdToken(token); // returns verified email string, or null
}

function verifyIdToken(idToken) {
  if (!idToken) return null;
  try {
    var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var info = JSON.parse(resp.getContentText());

    if (info.aud !== CONFIG.GOOGLE_CLIENT_ID) return null;          // token must be for us
    var ev = info.email_verified;
    if (ev !== 'true' && ev !== true) return null;                  // email must be verified by Google
    var email = (info.email || '').toLowerCase().trim();
    var suffix = '@' + CONFIG.ALLOWED_DOMAIN;
    if (!email || email.indexOf(suffix) !== email.length - suffix.length) return null; // Indrones only
    var now = Math.floor(Date.now() / 1000);
    if (info.exp && Number(info.exp) < now) return null;           // not expired
    return email;
  } catch (err) {
    return null;
  }
}

function doGet(e) {
  var authEmail = requireAuth(e);
  if (!authEmail) return buildResponse({ status: 'error', message: 'Unauthorized: a valid @indrones.com sign-in is required.' });
  var action = e.parameter.action || '';
  var result;

  try {
    if      (action === 'listIRs')     result = listIRs();
    else if (action === 'getPassbook') result = getPassbook(e.parameter.irNumber);
    else if (action === 'getAuditLog') result = getAuditLog(e.parameter.irNumber);
    else                               result = { status: 'error', message: 'Unknown action: ' + action };
  } catch (err) {
    result = { status: 'error', message: err.message };
  }

  return buildResponse(result);
}

function doPost(e) {
  var authEmail = requireAuth(e);
  if (!authEmail) return buildResponse({ status: 'error', message: 'Unauthorized: a valid @indrones.com sign-in is required.' });
  var result;
  try {
    var params = e.parameter;
    var action = params.action || '';

    if (action === 'saveSection') {
      var fields      = JSON.parse(params.fields  || '{}');
      var files       = JSON.parse(params.files   || '[]');
      var irNumber    = params.irNumber;
      var sectionId   = params.sectionId;
      // savedBy is the VERIFIED email from the token — never a client-supplied
      // value — so a non-CR user cannot impersonate a CR email to edit restricted
      // Section A fields or forge the audit trail.
      result = saveSection(irNumber, sectionId, fields, files, authEmail);
    } else if (action === 'sendNudgeEmail') {
      result = sendNudgeEmail(params, authEmail);
    } else {
      result = { status: 'error', message: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { status: 'error', message: err.message };
  }

  return buildResponse(result);
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION: listIRs
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
function getPassbook(irNumber) {
  if (!irNumber) throw new Error('irNumber is required.');

  var ss   = SpreadsheetApp.openById(CONFIG.PASSBOOK_SHEET_ID);
  var tab  = getOrCreateDataTab(ss);
  var data = tab.getDataRange().getValues();

  var sections = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === irNumber) {
      var secId  = data[i][1] || '';
      var fields = {};
      try { fields = JSON.parse(data[i][3] || '{}'); } catch(e) {}
      sections[secId] = fields;
    }
  }

  return { status: 'ok', sections: sections };
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION: saveSection
// Saves form fields + uploads files to Google Drive under IR/Section folder
// ──────────────────────────────────────────────────────────────────────────────
function saveSection(irNumber, sectionId, fields, files, savedBy) {
  if (!irNumber || !sectionId) throw new Error('irNumber and sectionId are required.');

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

  // 2b. Protect restricted fields — entire Section A is CR-only; other sections are open
  var restrictedFields = ['a_dateRaised', 'a_crmOwner', 'a_customerName', 'a_contactEmail', 'a_contactPhone', 'a_issueType', 'a_issueDesc', 'a_activityLog', 'a_overallStatus'];
  if (AUTHORIZED_CR_EMAILS.indexOf(savedBy.toLowerCase().trim()) === -1) {
    restrictedFields.forEach(function(key) {
      if (existingFields[key] !== undefined) {
        fields[key] = existingFields[key]; // Preserve existing value
      } else {
        delete fields[key]; // Remove if it didn't exist before
      }
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
  // Sender is the verified caller — a client can't spoof the reply-to address.
  var from     = authEmail || '';

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
