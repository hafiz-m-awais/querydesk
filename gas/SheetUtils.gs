// ═══════════════════════════════════════════════════════════════════
//  QueryDesk — SheetUtils.gs
//  Google Sheets access helpers
// ═══════════════════════════════════════════════════════════════════

// Returns the Queries sheet, creating and styling it on first run.
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

    sheet.setColumnWidth(1, 110);   // Reference ID
    sheet.setColumnWidth(2, 160);   // Timestamp
    sheet.setColumnWidth(3, 200);   // Email
    sheet.setColumnWidth(4, 130);   // Name
    sheet.setColumnWidth(5, 100);   // Roll Number
    sheet.setColumnWidth(6, 90);    // Section
    sheet.setColumnWidth(7, 70);    // Lab Number
    sheet.setColumnWidth(8, 90);    // Lab Date
    sheet.setColumnWidth(9, 90);    // Query Type
    sheet.setColumnWidth(10, 300);  // Description
    sheet.setColumnWidth(16, 90);   // Status
    sheet.setColumnWidth(17, 200);  // Instructor Notes
  }

  return sheet;
}

// Updates specific columns in the row matching referenceId.
// colValueMap keys are 0-based column indices.
function updateRowField(referenceId, colValueMap) {
  var sheet = getOrCreateSheet();
  if (sheet.getLastRow() <= 1) return false;
  var colA = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

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
