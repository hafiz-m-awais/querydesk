// ═══════════════════════════════════════════════════════════════════
//  QueryDesk — GetHandlers.gs
//  HTTP GET handler — public endpoints + admin data fetch
// ═══════════════════════════════════════════════════════════════════

function doGet(e) {
  var cb = (e.parameter && e.parameter.callback) || '';
  try {
    var action   = (e.parameter && e.parameter.action)   || '';
    var password = (e.parameter && e.parameter.password) || '';

    // ── Public: enabled query types ─────────────────────────────
    if (action === 'getSettings') {
      var props    = PropertiesService.getScriptProperties();
      var raw      = props.getProperty('querySettings');
      var settings = raw ? JSON.parse(raw) : DEFAULT_SETTINGS;
      return gasRespond({ status: 'ok', settings: settings }, cb);
    }

    // ── Public: course configuration ────────────────────────────
    if (action === 'getCourseSettings') {
      var props  = PropertiesService.getScriptProperties();
      var raw    = props.getProperty('courseSettings');
      var course = raw ? JSON.parse(raw) : DEFAULT_COURSE_SETTINGS;
      return gasRespond({ status: 'ok', course: course }, cb);
    }

    // ── Public: student status tracker ──────────────────────────
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
      result.reverse();
      return gasRespond({ status: 'ok', rows: result }, cb);
    }

    // ── Admin: full data ────────────────────────────────────────
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
      rows.reverse();
      return gasRespond({ status: 'ok', rows: rows }, cb);
    }

    // ── Health check ────────────────────────────────────────────
    return gasRespond({ status: 'ok', message: 'ML Lab Query API running' }, cb);

  } catch(err) {
    return gasRespond({ status: 'error', message: err.toString() }, cb);
  }
}
