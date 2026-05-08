// ═══════════════════════════════════════════════════════════════════
//  QueryDesk v2 — GetHandlers.gs
//
//  PUBLIC (no auth):
//    getCourseSettings  — student form settings
//    getSettings        — query-type toggles (legacy compat)
//    login              — verify password → return session token
//    submitQuery        — JSONP-confirmed query submission (no attachment)
//    requestOtp         — send 6-digit OTP to student's email
//    checkStatus        — verify OTP → return student's queries
//    getStatus          — legacy: roll-only lookup (no OTP, kept for compat)
//
//  PROTECTED (require ?token=…):
//    getData            — all queries + settings
//    updateStatus       — change status + optional student notification
//    deleteQuery        — delete a row
//    saveSettings       — save query-type toggles
//    saveCourseSettings — save course configuration
//    logout             — invalidate token
// ═══════════════════════════════════════════════════════════════════

function doGet(e) {
  var p  = e.parameter || {};
  var cb = p.callback  || '';
  try {
    var action = p.action || '';

    // ── PUBLIC ────────────────────────────────────────────────────

    if (action === 'getCourseSettings') {
      var qraw = PropertiesService.getScriptProperties().getProperty('querySettings');
      var craw = PropertiesService.getScriptProperties().getProperty('courseSettings');
      var qs   = qraw ? JSON.parse(qraw) : DEFAULT_SETTINGS;
      var cs   = craw ? JSON.parse(craw) : DEFAULT_COURSE_SETTINGS;
      return gasRespond({ status: 'ok', course: cs, settings: qs }, cb);
    }

    if (action === 'getSettings') {
      var raw = PropertiesService.getScriptProperties().getProperty('querySettings');
      return gasRespond({ status: 'ok', settings: raw ? JSON.parse(raw) : DEFAULT_SETTINGS }, cb);
    }

    // Login — verify password ONCE, return a short-lived session token.
    // The raw password travels the wire only for this single call.
    if (action === 'login') {
      var pw = p.password || '';
      if (!ADMIN_PASSWORD) {
        return gasRespond({ status: 'error', message: 'ADMIN_PASSWORD not set in Script Properties.' }, cb);
      }
      if (pw !== ADMIN_PASSWORD) {
        Utilities.sleep(1200); // rate-limit brute-force
        return gasRespond({ status: 'error', message: 'Incorrect password' }, cb);
      }
      return gasRespond({ status: 'ok', token: generateToken() }, cb);
    }

    // JSONP-confirmed submission (text data only; attachments still via POST).
    if (action === 'submitQuery') {
      return gasRespond(handleSubmitQuery(p), cb);
    }

    // OTP step 1 — request a verification code sent to the student's own email.
    if (action === 'requestOtp') {
      return gasRespond(handleRequestOtp(p.rollNumber || ''), cb);
    }

    // OTP step 2 — verify code and return only that student's queries.
    if (action === 'checkStatus') {
      return gasRespond(handleCheckStatus(p.rollNumber || '', p.otp || ''), cb);
    }

    // Legacy status lookup (no OTP) — kept so existing bookmarks keep working.
    if (action === 'getStatus') {
      var roll  = p.rollNumber || '';
      if (!roll) return gasRespond({ status: 'error', message: 'rollNumber required' }, cb);
      var sheet = getOrCreateSheet();
      if (sheet.getLastRow() <= 1) return gasRespond({ status: 'ok', rows: [] }, cb);
      var data = sheet.getDataRange().getValues();
      var out  = [];
      for (var ri = 1; ri < data.length; ri++) {
        if (String(data[ri][4]).trim().toUpperCase() === roll.trim().toUpperCase()) {
          out.push({
            referenceId: String(data[ri][0]  || ''),
            timestamp:   String(data[ri][1]  || ''),
            queryType:   String(data[ri][8]  || ''),
            labNumber:   String(data[ri][6]  || ''),
            status:      String(data[ri][15] || 'Pending'),
            notes:       String(data[ri][16] || '')
          });
        }
      }
      out.reverse();
      return gasRespond({ status: 'ok', rows: out }, cb);
    }

    // ── PROTECTED — validate token before any admin action ───────

    var token = p.token || '';
    if (!validateToken(token)) {
      return gasRespond({
        status: 'error',
        message: 'Session expired or invalid. Please log in again.',
        needsLogin: true
      }, cb);
    }

    if (action === 'getData') {
      var sheet = getOrCreateSheet();
      var rows  = [];
      if (sheet.getLastRow() > 1) {
        rows = sheet.getDataRange().getValues().slice(1).map(function(r) {
          return {
            referenceId:   String(r[0]  || ''),
            timestamp:     r[1] ? new Date(r[1]).toISOString() : '',
            email:         String(r[2]  || ''),
            name:          String(r[3]  || ''),
            rollNumber:    String(r[4]  || ''),
            section:       String(r[5]  || ''),
            labNumber:     String(r[6]  !== '' ? r[6] : ''),
            labDate:       String(r[7]  || ''),
            queryType:     String(r[8]  || ''),
            description:   String(r[9]  || ''),
            extraDate:     String(r[10] || ''),
            marksAwarded:  String(r[11] !== '' ? r[11] : ''),
            marksExpected: String(r[12] !== '' ? r[12] : ''),
            issue:         String(r[13] || ''),
            request:       String(r[14] || ''),
            status:        String(r[15] || 'Pending'),
            notes:         String(r[16] || ''),
            attachmentUrl: String(r[17] || ''),
            isUrgent:      r[18] === true || String(r[18]).toUpperCase() === 'YES'
          };
        });
        rows.reverse();
      }
      var qraw = PropertiesService.getScriptProperties().getProperty('querySettings');
      var craw = PropertiesService.getScriptProperties().getProperty('courseSettings');
      return gasRespond({
        status:   'ok',
        rows:     rows,
        settings: qraw ? JSON.parse(qraw) : DEFAULT_SETTINGS,
        course:   craw ? JSON.parse(craw) : DEFAULT_COURSE_SETTINGS
      }, cb);
    }

    if (action === 'updateStatus') {
      var refId  = p.referenceId || '';
      var status = p.status      || 'Pending';
      var notes  = p.notes       || '';
      var notify = p.notify      === 'true';
      var result = updateRowField(refId, { 15: status, 16: notes });
      if (result && notify) {
        var row = getRowByRef(refId);
        if (row) sendStatusUpdateEmailFromRow(row, status, notes);
      }
      return gasRespond({ status: result ? 'ok' : 'not_found' }, cb);
    }

    if (action === 'deleteQuery') {
      var refId   = p.referenceId || '';
      var sheet   = getOrCreateSheet();
      var deleted = false;
      if (sheet.getLastRow() > 1) {
        var colA = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
        for (var di = 0; di < colA.length; di++) {
          if (String(colA[di][0]) === refId) {
            sheet.deleteRow(di + 2);
            deleted = true;
            break;
          }
        }
      }
      return gasRespond({ status: deleted ? 'ok' : 'not_found' }, cb);
    }

    if (action === 'saveSettings') {
      var raw = p.settings || '{}';
      PropertiesService.getScriptProperties()
        .setProperty('querySettings', JSON.stringify(JSON.parse(raw)));
      return gasRespond({ status: 'ok' }, cb);
    }

    if (action === 'saveCourseSettings') {
      var cs = JSON.parse(p.courseSettings || '{}');
      if (!Array.isArray(cs.sections)) cs.sections = [];
      cs.sessionCount   = parseInt(cs.sessionCount, 10) || 14;
      cs.submissionOpen = cs.submissionOpen !== false && cs.submissionOpen !== 'false';
      PropertiesService.getScriptProperties()
        .setProperty('courseSettings', JSON.stringify(cs));
      return gasRespond({ status: 'ok' }, cb);
    }

    if (action === 'logout') {
      invalidateToken(token);
      return gasRespond({ status: 'ok' }, cb);
    }

    return gasRespond({ status: 'ok', message: 'QueryDesk v2 API' }, cb);

  } catch (err) {
    return gasRespond({ status: 'error', message: err.toString() }, cb);
  }
}

// ── JSONP submission ───────────────────────────────────────────────
function handleSubmitQuery(p) {
  var sheet = getOrCreateSheet();

  // Duplicate guard: same roll + type + session within 24 h
  if (sheet.getLastRow() > 1) {
    var recent = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
    var cutoff = Date.now() - 86400000;
    for (var d = 0; d < recent.length; d++) {
      var t = new Date(recent[d][1]).getTime();
      if (!isNaN(t) && t > cutoff &&
          recent[d][4] === (p.rollNumber || '') &&
          recent[d][8] === (p.queryType  || '') &&
          recent[d][6] === (p.labNumber  || '')) {
        return {
          status:  'duplicate',
          message: 'A query of this type for the same session was already submitted today.'
        };
      }
    }
  }

  var pad = function(n, l) { var s = String(n); while (s.length < l) s = '0' + s; return s; };
  var refId = 'QD-' + new Date().getFullYear() + '-' + pad(Math.max(1, sheet.getLastRow()), 4);
  sheet.appendRow([
    refId,
    new Date().toISOString(),
    p.email         || '',
    p.name          || '',
    p.rollNumber    || '',
    p.section       || '',
    p.labNumber     || '',
    p.labDate       || '',
    p.queryType     || '',
    p.description   || '',
    p.extraDate     || '',
    p.marksAwarded  || '',
    p.marksExpected || '',
    p.issue         || '',
    p.request       || '',
    'Pending',
    '',
    '', // attachment uploaded separately via POST
    p.isUrgent === 'true' ? 'Yes' : 'No'
  ]);

  sendInstructorEmailFromParams(p, refId);
  sendStudentConfirmEmailFromParams(p, refId);

  return { status: 'ok', referenceId: refId };
}

// ── OTP helpers ───────────────────────────────────────────────────

function handleRequestOtp(rollNumber) {
  if (!rollNumber) return { status: 'error', message: 'Roll number required.' };
  var sheet = getOrCreateSheet();
  if (sheet.getLastRow() <= 1)
    return { status: 'error', message: 'No submissions found for this roll number.' };

  var data  = sheet.getDataRange().getValues();
  var email = '';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][4]).trim().toUpperCase() === rollNumber.trim().toUpperCase()) {
      email = String(data[i][2] || '');
      break;
    }
  }
  if (!email || email.indexOf('@') === -1)
    return { status: 'error', message: 'No submissions found for this roll number.' };

  var otp = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put('otp_' + rollNumber.toUpperCase(), otp, 600);

  try {
    MailApp.sendEmail({
      to:      email,
      subject: '[QueryDesk] Your verification code: ' + otp,
      body:    'Your QueryDesk verification code is: ' + otp +
               '\n\nThis code expires in 10 minutes.\nDo not share it with anyone.'
    });
    var parts  = email.split('@');
    var masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return { status: 'ok', maskedEmail: masked };
  } catch (err) {
    return { status: 'error', message: 'Could not send email: ' + err.message };
  }
}

function handleCheckStatus(rollNumber, otp) {
  if (!rollNumber || !otp)
    return { status: 'error', message: 'Roll number and verification code are required.' };

  var stored = CacheService.getScriptCache().get('otp_' + rollNumber.toUpperCase());
  if (!stored || stored !== otp.trim())
    return { status: 'error', message: 'Incorrect or expired verification code.' };

  CacheService.getScriptCache().remove('otp_' + rollNumber.toUpperCase());

  var sheet = getOrCreateSheet();
  if (sheet.getLastRow() <= 1) return { status: 'ok', rows: [] };

  var data = sheet.getDataRange().getValues();
  var out  = [];
  for (var ri = 1; ri < data.length; ri++) {
    if (String(data[ri][4]).trim().toUpperCase() === rollNumber.trim().toUpperCase()) {
      out.push({
        referenceId: String(data[ri][0]  || ''),
        timestamp:   String(data[ri][1]  || ''),
        queryType:   String(data[ri][8]  || ''),
        labNumber:   String(data[ri][6]  || ''),
        status:      String(data[ri][15] || 'Pending'),
        notes:       String(data[ri][16] || '')
      });
    }
  }
  out.reverse();
  return { status: 'ok', rows: out };
}

// ── Helper ────────────────────────────────────────────────────────
function getRowByRef(refId) {
  var sheet = getOrCreateSheet();
  if (sheet.getLastRow() <= 1) return null;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === refId) return data[i];
  }
  return null;
}
