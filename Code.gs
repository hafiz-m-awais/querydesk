// ═══════════════════════════════════════════════════════════════════
//  ML LAB QUERY — Google Apps Script Backend
//  Paste this entire file into your Apps Script editor
//  (Google Sheet → Extensions → Apps Script → replace everything)
// ═══════════════════════════════════════════════════════════════════

// ── CONFIGURATION ───────────────────────────────────────────────
// ADMIN_PASSWORD is read from GAS Script Properties (the GAS equivalent
// of a .env file). Set it once in:
//   Apps Script editor → Project Settings → Script Properties
//   Key: ADMIN_PASSWORD   Value: (your password, same as in admin.html)
// The hardcoded fallback below is only used if the property is not set.
var ADMIN_PASSWORD = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || '@wA!$231347';
var SHEET_NAME     = 'Queries';                    // tab name in your spreadsheet
// ─────────────────────────────────────────────────────────────────

// ── Default enabled query types (if admin has never saved settings) ─
var DEFAULT_SETTINGS = {
  attendance:  true,
  marks:       true,
  assignment:  true,
  final:       true,
  project:     true
};
// ─────────────────────────────────────────────────────────────────

var HEADERS = [
  'Reference ID', 'Timestamp', 'Email', 'Name', 'Roll Number',
  'Section', 'Lab Number', 'Lab Date', 'Query Type', 'Description',
  'Extra Date', 'Marks Awarded', 'Marks Expected', 'Issue / Reason',
  'Request Type', 'Status', 'Instructor Notes'
];

// ── CORS helper ──────────────────────────────────────────────────
function cors(output) {
  return output
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET,POST')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── GET handler (admin data fetch) ──────────────────────────────
function doGet(e) {
  try {
    var action   = (e.parameter && e.parameter.action)   || '';
    var password = (e.parameter && e.parameter.password) || '';

    // ── Public: return enabled query types ────────────────────────
    if (action === 'getSettings') {
      var props = PropertiesService.getScriptProperties();
      var raw   = props.getProperty('querySettings');
      var settings = raw ? JSON.parse(raw) : DEFAULT_SETTINGS;
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', settings: settings }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    if (action === 'getData') {
      if (password !== ADMIN_PASSWORD) {
        return cors(ContentService
          .createTextOutput(JSON.stringify({ status: 'error', message: 'Invalid password' }))
          .setMimeType(ContentService.MimeType.JSON));
      }

      var sheet = getOrCreateSheet();
      var data  = sheet.getDataRange().getValues();

      if (data.length <= 1) {
        return cors(ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', rows: [] }))
          .setMimeType(ContentService.MimeType.JSON));
      }

      var rows = data.slice(1).map(function(row) {
        return {
          referenceId:   row[0]  || '',
          timestamp:     row[1]  || '',
          email:         row[2]  || '',
          name:          row[3]  || '',
          rollNumber:    row[4]  || '',
          section:       row[5]  || '',
          labNumber:     row[6]  || '',
          labDate:       row[7]  || '',
          queryType:     row[8]  || '',
          description:   row[9]  || '',
          extraDate:     row[10] || '',
          marksAwarded:  row[11] || '',
          marksExpected: row[12] || '',
          issue:         row[13] || '',
          request:       row[14] || '',
          status:        row[15] || 'Pending',
          notes:         row[16] || ''
        };
      });

      // Return newest first
      rows.reverse();

      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', rows: rows }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // Default — health check
    return cors(ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', message: 'ML Lab Query API running' }))
      .setMimeType(ContentService.MimeType.JSON));

  } catch(err) {
    return cors(ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON));
  }
}

// ── POST handler (submit + update + delete) ──────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'submit';

    // ── New query submission ────────────────────────────────────
    if (action === 'submit') {
      var sheet = getOrCreateSheet();
      sheet.appendRow([
        data.referenceId   || '',
        data.timestamp     || new Date().toLocaleString(),
        data.email         || '',
        data.name          || '',
        data.rollNumber    || '',
        data.section       || '',
        data.labNumber     || '',
        data.labDate       || '',
        data.queryType     || '',
        data.description   || '',
        data.extraDate     || '',
        data.marksAwarded  || '',
        data.marksExpected || '',
        data.issue         || '',
        data.request       || '',
        data.status        || 'Pending',
        ''   // notes — empty on submission
      ]);

      // ── Optional email notification to instructor ─────────────
      // Uncomment and fill in your email below to receive alerts:
      /*
      MailApp.sendEmail({
        to:      'your.email@nu.edu.pk',
        subject: '[ML Lab] New ' + data.queryType + ' query from ' + data.name,
        body:
          'Reference: '   + data.referenceId + '\n' +
          'Student: '     + data.name + ' (' + data.rollNumber + ')\n' +
          'Section: '     + data.section + '\n' +
          'Lab: '         + data.labNumber + ' on ' + data.labDate + '\n' +
          'Query type: '  + data.queryType + '\n\n' +
          'Description:\n' + data.description + '\n\n' +
          'Submitted: '   + data.timestamp
      });
      */

      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', referenceId: data.referenceId }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── Admin-only actions — verify password first ──────────────
    if (data.password !== ADMIN_PASSWORD) {
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Unauthorised' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── Save query type settings ────────────────────────────────
    if (action === 'saveSettings') {
      var props = PropertiesService.getScriptProperties();
      props.setProperty('querySettings', JSON.stringify(data.settings || DEFAULT_SETTINGS));
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── Update status + notes ───────────────────────────────────
    if (action === 'updateStatus') {
      var result = updateRowField(data.referenceId, {
        15: data.status || 'Pending',
        16: data.notes  || ''
      });
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: result ? 'ok' : 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── Delete row ──────────────────────────────────────────────
    if (action === 'deleteRow') {
      var sheet  = getOrCreateSheet();
      if (sheet.getLastRow() <= 1) {
        return cors(ContentService
          .createTextOutput(JSON.stringify({ status: 'not_found' }))
          .setMimeType(ContentService.MimeType.JSON));
      }
      var colA   = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < colA.length; i++) {
        if (colA[i][0] === data.referenceId) {
          sheet.deleteRow(i + 2);
          return cors(ContentService
            .createTextOutput(JSON.stringify({ status: 'ok' }))
            .setMimeType(ContentService.MimeType.JSON));
        }
      }
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    return cors(ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON));

  } catch(err) {
    return cors(ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON));
  }
}

// ── Helper: get or create the named sheet ───────────────────────
function getOrCreateSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1D9E75');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    // Column widths for readability
    sheet.setColumnWidth(1, 110);   // ref ID
    sheet.setColumnWidth(2, 160);   // timestamp
    sheet.setColumnWidth(3, 200);   // email
    sheet.setColumnWidth(4, 130);   // name
    sheet.setColumnWidth(5, 100);   // roll
    sheet.setColumnWidth(6, 90);    // section
    sheet.setColumnWidth(7, 70);    // lab no
    sheet.setColumnWidth(8, 90);    // lab date
    sheet.setColumnWidth(9, 90);    // type
    sheet.setColumnWidth(10, 300);  // description
    sheet.setColumnWidth(16, 90);   // status
    sheet.setColumnWidth(17, 200);  // notes
  }

  return sheet;
}

// ── Helper: update specific columns in a row by ref ID ──────────
function updateRowField(referenceId, colValueMap) {
  var sheet = getOrCreateSheet();
  if (sheet.getLastRow() <= 1) return false;
  var colA  = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (var i = 0; i < colA.length; i++) {
    if (colA[i][0] === referenceId) {
      var rowNum = i + 2;
      for (var col in colValueMap) {
        sheet.getRange(rowNum, parseInt(col) + 1).setValue(colValueMap[col]);
      }
      return true;
    }
  }
  return false;
}
