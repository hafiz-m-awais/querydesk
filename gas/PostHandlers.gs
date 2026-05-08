// ═══════════════════════════════════════════════════════════════════
//  QueryDesk v2 — PostHandlers.gs
//  POST is used only for query submission (with file attachment).
//  Status updates, deletes, and settings saves use the token-based
//  GET routes in GetHandlers.gs.
// ═══════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    var data   = JSON.parse(e.postData.contents);
    var action = data.action || 'submit';

    // ── New query submission (with attachment) ────────────────────
    if (action === 'submit') {
      var sheet = getOrCreateSheet();

      // Duplicate guard: same roll + type + session within 24 h
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
                message: 'A query of this type for the same session was already submitted today.'
              }))
              .setMimeType(ContentService.MimeType.JSON));
          }
        }
      }

      var attachmentUrl = uploadAttachment(data);
      var pad = function(n, l) { var s = String(n); while (s.length < l) s = '0' + s; return s; };
      var refId = data.referenceId || ('QD-' + new Date().getFullYear() + '-' + pad(Math.max(1, sheet.getLastRow()), 4));

      sheet.appendRow([
        refId,
        data.timestamp || new Date().toISOString(),
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
        'Pending',
        '',
        attachmentUrl,
        data.isUrgent ? 'Yes' : 'No'
      ]);

      sendInstructorEmailFromParams(data, refId);
      sendStudentConfirmEmailFromParams(data, refId);

      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', referenceId: refId }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    // ── All other admin POST actions — verify token ───────────────
    // (updateStatus, deleteRow, saveSettings, saveCourseSettings are
    //  handled by GET+token routes; this block is a legacy fallback.)
    var token = data.token || '';
    if (!validateToken(token)) {
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    if (action === 'saveSettings') {
      PropertiesService.getScriptProperties()
        .setProperty('querySettings', JSON.stringify(data.settings || DEFAULT_SETTINGS));
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    if (action === 'saveCourseSettings') {
      var cs = data.courseSettings || {};
      if (!Array.isArray(cs.sections)) cs.sections = [];
      cs.sessionCount   = parseInt(cs.sessionCount, 10) || DEFAULT_COURSE_SETTINGS.sessionCount;
      cs.submissionOpen = cs.submissionOpen !== false;
      PropertiesService.getScriptProperties()
        .setProperty('courseSettings', JSON.stringify(cs));
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    if (action === 'updateStatus') {
      var result = updateRowField(data.referenceId, {
        15: data.status || 'Pending',
        16: data.notes  || ''
      });
      if (result && data.notify) sendStatusUpdateEmailFromRow(
        getRowByRef(data.referenceId), data.status, data.notes || '');
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: result ? 'ok' : 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    if (action === 'deleteRow') {
      var sheet   = getOrCreateSheet();
      var deleted = false;
      if (sheet.getLastRow() > 1) {
        var colA = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
        for (var i = 0; i < colA.length; i++) {
          if (colA[i][0] === data.referenceId) {
            sheet.deleteRow(i + 2);
            deleted = true;
            break;
          }
        }
      }
      return cors(ContentService
        .createTextOutput(JSON.stringify({ status: deleted ? 'ok' : 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON));
    }

    return cors(ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON));

  } catch (err) {
    return cors(ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON));
  }
}
