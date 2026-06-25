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
  IR_REPO_TAB:      'Form Responses',
  IR_REPO_IR_COL:   2,   // Column B  — "IR Number"
  IR_REPO_ID_COL:   11,  // Column K  — "Mention the Drone Serial No (S250XX)"
  IR_REPO_SUMLINK:  1,   // Column A  — "Summary" (text summary of the issue)
  IR_REPO_DATE_COL: 3,   // Column C  — "Timestamp"

  // The original I-PASSBOOK Master Sheet (Legacy data holder)
  PASSBOOK_SHEET_ID: '14VnWnCg-W7I8Vv97amhuwfSqiozictVMivO3F9Bed5s',
  DATA_TAB:          'APP_DATA',  // Web App data goes here

  // Google Drive root folder for IR photo uploads
  DRIVE_ROOT_FOLDER_ID: '1W41jpmnmIOmoG2XFfdlurkATvFSfxN9r',

  ALLOWED_DOMAIN: 'indrones.com',
};

// ──────────────────────────────────────────────────────────────────────────────
// ENTRY POINTS
// ──────────────────────────────────────────────────────────────────────────────
function doGet(e) {
  var action = e.parameter.action || '';
  var result;

  try {
    if      (action === 'listIRs')     result = listIRs();
    else if (action === 'getPassbook') result = getPassbook(e.parameter.irNumber);
    else                               result = { status: 'error', message: 'Unknown action: ' + action };
  } catch (err) {
    result = { status: 'error', message: err.message };
  }

  return buildResponse(result);
}

function doPost(e) {
  var result;
  try {
    var params = e.parameter;
    var action = params.action || '';

    if (action === 'saveSection') {
      var fields      = JSON.parse(params.fields  || '{}');
      var files       = JSON.parse(params.files   || '[]');
      var irNumber    = params.irNumber;
      var sectionId   = params.sectionId;
      var savedBy     = params.savedBy;

      result = saveSection(irNumber, sectionId, fields, files, savedBy);
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
        dateRaised:  row[CONFIG.IR_REPO_DATE_COL - 1]
                      ? Utilities.formatDate(new Date(row[CONFIG.IR_REPO_DATE_COL - 1]), 'Asia/Kolkata', 'dd-MMM-yyyy')
                      : '',
        irNumber:    irNumber,
        droneId:     (row[CONFIG.IR_REPO_ID_COL - 1] || '').toString().trim(),
        summaryLink: (row[CONFIG.IR_REPO_SUMLINK - 1] || '').toString().trim(),
        status:      statusMap[irNumber] || 'Open',
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
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === irNumber && data[i][1] === sectionId) {
      existingRow = i + 1; // 1-indexed row in sheet
      break;
    }
  }

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
    'sec-d': 'Section D - Tech Support Analysis',
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
