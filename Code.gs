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
// ADMIN_PASSWORD must be set in Apps Script editor → Project Settings → Script Properties
// Key: ADMIN_PASSWORD   Value: (your chosen password)
var ADMIN_PASSWORD = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || '';
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
  'Request Type', 'Status', 'Instructor Notes', 'Attachment URL', 'Urgent'
];

// ── INSTRUCTOR_EMAIL: set in GAS Script Properties ────────────────
// Project Settings → Script Properties → Key: INSTRUCTOR_EMAIL
// Value: your.email@nu.edu.pk
var INSTRUCTOR_EMAIL = PropertiesService.getScriptProperties().getProperty('INSTRUCTOR_EMAIL') || '';

// ── CORS helper ──────────────────────────────────────────────────
function cors(output) {
  return output
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET,POST')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Unified response helper (supports JSON + JSONP) ───────────────
function gasRespond(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    // JSONP: wrap in callback — bypasses CORS entirely
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return cors(ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON));
}

// ── GET handler (admin data fetch + public settings) ─────────────
function doGet(e) {
  var cb = (e.parameter && e.parameter.callback) || '';
  try {
    var action   = (e.parameter && e.parameter.action)   || '';
    var password = (e.parameter && e.parameter.password) || '';

    // ── Public: return enabled query types ────────────────────────
    if (action === 'getSettings') {
      var props    = PropertiesService.getScriptProperties();
      var raw      = props.getProperty('querySettings');
      var settings = raw ? JSON.parse(raw) : DEFAULT_SETTINGS;
      return gasRespond({ status: 'ok', settings: settings }, cb);
    }

    // ── Public: student status tracker by roll number ─────────────
    if (action === 'getStatus') {
      var rollNum = (e.parameter && e.parameter.rollNumber) || '';
      if (!rollNum) {
        return gasRespond({ status: 'error', message: 'rollNumber required' }, cb);
      }
      var sheet = getOrCreateSheet();
      if (sheet.getLastRow() <= 1) {
        return gasRespond({ status: 'ok', rows: [] }, cb);
      }
      var allData = sheet.getDataRange().getValues();
      var result  = [];
      for (var ri = 1; ri < allData.length; ri++) {
        if (String(allData[ri][4]).trim().toUpperCase() === rollNum.trim().toUpperCase()) {
          result.push({
            referenceId: String(allData[ri][0]  || ''),
            timestamp:   String(allData[ri][1]  || ''),
            queryType:   String(allData[ri][8]  || ''),
            labNumber:   String(allData[ri][6]  || ''),
            status:      String(allData[ri][15] || 'Pending'),
            notes:       String(allData[ri][16] || '')
          });
        }
      }
      result.reverse(); // newest first
      return gasRespond({ status: 'ok', rows: result }, cb);
    }

    if (action === 'getData') {
      if (password !== ADMIN_PASSWORD) {
        return gasRespond({ status: 'error', message: 'Invalid password' }, cb);
      }

      var sheet = getOrCreateSheet();
      var data  = sheet.getDataRange().getValues();

      if (data.length <= 1) {
        return gasRespond({ status: 'ok', rows: [] }, cb);
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
          notes:         row[16] || '',
          attachmentUrl: row[17] || '',
          isUrgent:      row[18] === true || row[18] === 'TRUE' || row[18] === 'Yes'
        };
      });

      rows.reverse(); // newest first
      return gasRespond({ status: 'ok', rows: rows }, cb);
    }

    // Default — health check
    return gasRespond({ status: 'ok', message: 'ML Lab Query API running' }, cb);

  } catch(err) {
    return gasRespond({ status: 'error', message: err.toString() }, cb);
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

      // Duplicate guard: same roll number + query type + lab(s) within 24 hours
      if (sheet.getLastRow() > 1) {
        var recent = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
        var cutoff = Date.now() - 86400000;
        for (var d = 0; d < recent.length; d++) {
          var rowRoll = recent[d][4];  // col E: rollNumber
          var rowType = recent[d][8];  // col I: queryType
          var rowLab  = recent[d][6];  // col G: labNumber
          var rowTs   = recent[d][1];  // col B: timestamp (string)
          var rowTime = new Date(rowTs).getTime();
          if (!isNaN(rowTime) && rowTime > cutoff &&
              rowRoll === (data.rollNumber || '') &&
              rowType === (data.queryType  || '') &&
              rowLab  === (data.labNumber  || '')) {
            return cors(ContentService
              .createTextOutput(JSON.stringify({
                status:  'duplicate',
                message: 'A query of this type for the same lab was already submitted today.'
              }))
              .setMimeType(ContentService.MimeType.JSON));
          }
        }
      }

      // ── Optional: save attachment to Drive ─────────────────
      var attachmentUrl = '';
      if (data.attachmentData && data.attachmentName) {
        try {
          // MIME allowlist — only safe document/image types
          var ALLOWED_MIMES = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
          ];
          var mimeType = (data.attachmentMimeType || '').toLowerCase().split(';')[0].trim();
          if (ALLOWED_MIMES.indexOf(mimeType) === -1) {
            attachmentUrl = 'REJECTED: disallowed file type (' + mimeType + ')';
          } else {
          var folderName = 'ML Lab Query Attachments';
          var folders    = DriveApp.getFoldersByName(folderName);
          var folder     = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
          var bytes      = Utilities.base64Decode(data.attachmentData);
          var blob       = Utilities.newBlob(
                             bytes,
                             mimeType || 'application/octet-stream',
                             (data.referenceId || 'file') + '_' + data.attachmentName
                           );
          var driveFile  = folder.createFile(blob);
          driveFile.setSharing(
            DriveApp.Access.ANYONE_WITH_LINK,
            DriveApp.Permission.VIEW
          );
          attachmentUrl = driveFile.getUrl();
          } // end MIME allowlist else
        } catch (attachErr) {
          // Drive upload failed — submission still proceeds without attachment
          console.log('Drive upload error: ' + attachErr.toString());
          attachmentUrl = 'ERROR: ' + attachErr.message;
        }
      }

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
        '',            // notes — empty on submission
        attachmentUrl, // Google Drive URL if a file was attached
        data.isUrgent ? 'Yes' : 'No'  // urgent flag
      ]);

      // ── Email notification to instructor ──────────────────────
      if (INSTRUCTOR_EMAIL) {
        try {
          var urgentTag = data.isUrgent ? '[URGENT] ' : '';
          MailApp.sendEmail({
            to:      INSTRUCTOR_EMAIL,
            subject: '[ML Lab] ' + urgentTag + 'New ' + data.queryType + ' query from ' + data.name,
            body:
              (data.isUrgent ? '\u26a0 URGENT QUERY\n\n' : '') +
              'Reference: '   + data.referenceId + '\n' +
              'Student: '     + data.name + ' (' + data.rollNumber + ')\n' +
              'Section: '     + data.section + '\n' +
              'Lab: '         + (data.labNumber || 'N/A') + ' on ' + (data.labDate || 'N/A') + '\n' +
              'Query type: '  + data.queryType + '\n\n' +
              'Description:\n' + data.description + '\n\n' +
              (attachmentUrl && attachmentUrl.indexOf('https://') === 0 ? 'Attachment: ' + attachmentUrl + '\n\n' : '') +
              'Submitted: '   + data.timestamp
          });
        } catch (mailErr) {
          // Email failed — submission still proceeds
          console.log('Email error: ' + mailErr.toString());
        }
      }

      // ── Confirmation email to student ──────────────────────────
      if (data.email && data.email.indexOf('@') !== -1) {
        try {
          MailApp.sendEmail({
            to:      data.email,
            subject: '[ML Lab Query] Received — ' + data.referenceId,
            body:
              'Hi ' + data.name + ',\n\n' +
              'Your query has been received. Here are the details:\n\n' +
              'Reference ID:  ' + data.referenceId + '\n' +
              'Query type:    ' + data.queryType + '\n' +
              (data.labNumber ? 'Lab(s):        ' + data.labNumber + '\n' : '') +
              'Submitted:     ' + data.timestamp + '\n\n' +
              'You can track the status of your query at any time:\n' +
              'https://hafiz-m-awais.github.io/mllab-query/\n\n' +
              'Enter your roll number (' + data.rollNumber + ') in the tracker at the bottom of the page.\n\n' +
              'Do not reply to this email.\n' +
              '— ML for Business Analytics, FAST-NUCES Islamabad'
          });
        } catch (mailErr) {
          console.log('Student confirmation email error: ' + mailErr.toString());
        }
      }

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

      // ── Email student when status changes to Resolved or Rejected ─
      if (result && (data.status === 'Resolved' || data.status === 'Rejected') && data.email && data.email.indexOf('@') !== -1) {
        try {
          var resolved = data.status === 'Resolved';
          MailApp.sendEmail({
            to:      data.email,
            subject: '[ML Lab Query] ' + data.status + ' — ' + data.referenceId,
            body:
              'Hi ' + (data.name || 'Student') + ',\n\n' +
              'Your query ' + data.referenceId + ' has been marked as ' + data.status + '.\n\n' +
              (data.notes ? 'Instructor note:\n' + data.notes + '\n\n' : '') +
              (resolved
                ? 'Your query has been resolved. If you have further questions, please raise a new query.\n\n'
                : 'Your query could not be accommodated. If you believe this is an error, please speak to your instructor directly.\n\n') +
              'Track all your queries:\n' +
              'https://hafiz-m-awais.github.io/mllab-query/\n\n' +
              'Do not reply to this email.\n' +
              '— ML for Business Analytics, FAST-NUCES Islamabad'
          });
        } catch (mailErr) {
          console.log('Status notification email error: ' + mailErr.toString());
        }
      }

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

// ── TEST: run this from the GAS editor to verify Drive access ────
// Apps Script editor → select testDriveUpload → ▶ Run
// Then check View → Execution log for the result.
function testDriveUpload() {
  try {
    var folderName = 'ML Lab Query Attachments';
    var folders    = DriveApp.getFoldersByName(folderName);
    var folder     = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var blob       = Utilities.newBlob('test content', 'text/plain', 'test_attachment.txt');
    var driveFile  = folder.createFile(blob);
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = driveFile.getUrl();
    console.log('SUCCESS — Drive upload works. URL: ' + url);
    // Clean up test file
    driveFile.setTrashed(true);
    console.log('Test file deleted.');
  } catch (err) {
    console.log('FAILED — ' + err.toString());
    console.log('Fix: re-deploy as new version and grant DriveApp permission.');
  }
}
