// ═══════════════════════════════════════════════════════════════════
//  QueryDesk — PostHandlers.gs
//  HTTP POST handler — submit, updateStatus, deleteRow,
//                      saveSettings, saveCourseSettings
// ═══════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    var data   = JSON.parse(e.postData.contents);
    var action = data.action || 'submit';

    // ── New query submission ──────────────────────────────────────
    if (action === 'submit') {
      var sheet = getOrCreateSheet();

      // Duplicate guard: same roll + type + lab within 24 hours
      if (sheet.getLastRow() > 1) {
        var recent = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
        var cutoff = Date.now() - 86400000;
        for (var d = 0; d < recent.length; d++) {
          var rowTime = new Date(recent[d][1]).getTime();
          if (!isNaN(rowTime) && rowTime > cutoff &&
              recent[d][4] === (data.rollNumber || '') &&
              recent[d][8] === (data.queryType  || '') &&
              recent[d][6] === (data.labNumber  || '')) {
            return cors(ContentService
              .createTextOutput(JSON.stringify({
                status:  'duplicate',
                message: 'A query of this type for the same lab was already submitted today.'
              }))
              .setMimeType(ContentService.MimeType.JSON));
          }
        }
      }

      var attachmentUrl = uploadAttachment(data);

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
        '',               // Instructor Notes — empty on submission
        attachmentUrl,
        data.isUrgent ? 'Yes' : 'No'
      ]);

      sendInstructorEmail(data, attachmentUrl);
      sendStudentConfirmEmail(data);

      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', referenceId: data.referenceId }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── Admin-only actions — verify password first ────────────────
    if (data.password !== ADMIN_PASSWORD) {
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Unauthorised' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── Save query-type settings ──────────────────────────────────
    if (action === 'saveSettings') {
      PropertiesService.getScriptProperties()
        .setProperty('querySettings', JSON.stringify(data.settings || DEFAULT_SETTINGS));
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── Save course configuration ─────────────────────────────────
    if (action === 'saveCourseSettings') {
      var course = data.courseSettings || {};
      if (!Array.isArray(course.sections)) {
        course.sections = DEFAULT_COURSE_SETTINGS.sections;
      }
      course.sessionCount = parseInt(course.sessionCount, 10) || DEFAULT_COURSE_SETTINGS.sessionCount;
      PropertiesService.getScriptProperties()
        .setProperty('courseSettings', JSON.stringify(course));
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── Update status + notes ─────────────────────────────────────
    if (action === 'updateStatus') {
      var result = updateRowField(data.referenceId, {
        15: data.status || 'Pending',
        16: data.notes  || ''
      });
      sendStatusUpdateEmail(data);
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: result ? 'ok' : 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── Delete row ────────────────────────────────────────────────
    if (action === 'deleteRow') {
      var sheet = getOrCreateSheet();
      if (sheet.getLastRow() <= 1) {
        return cors(ContentService
          .createTextOutput(JSON.stringify({ status: 'not_found' }))
          .setMimeType(ContentService.MimeType.JSON));
      }
      var colA = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
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
