// ═══════════════════════════════════════════════════════════════════
//  QueryDesk v2 — EmailUtils.gs
//  All email helpers.  Course name and university are read from
//  Script Properties (via courseSettings) — never hardcoded.
// ═══════════════════════════════════════════════════════════════════

function getCourseConf() {
  var raw = PropertiesService.getScriptProperties().getProperty('courseSettings');
  return raw ? JSON.parse(raw) : DEFAULT_COURSE_SETTINGS;
}

// Called from JSONP submit (GetHandlers) and POST submit (PostHandlers).
function sendInstructorEmailFromParams(p, refId) {
  if (!INSTRUCTOR_EMAIL) return;
  try {
    var c          = getCourseConf();
    var course     = c.courseName    || 'QueryDesk';
    var sessionLbl = c.sessionLabel  || 'Session';
    var urgentTag  = (p.isUrgent === 'true' || p.isUrgent === true) ? '[URGENT] ' : '';
    MailApp.sendEmail({
      to:      INSTRUCTOR_EMAIL,
      subject: '[' + course + '] ' + urgentTag + 'New ' + (p.queryType || '') + ' query — ' + (p.name || ''),
      body:
        (urgentTag ? '\u26a0 URGENT QUERY\n\n' : '') +
        'Reference:    ' + refId + '\n' +
        'Student:      ' + (p.name || '') + ' (' + (p.rollNumber || '') + ')\n' +
        'Section:      ' + (p.section || '') + '\n' +
        (p.labNumber ? sessionLbl + '(s):  ' + p.labNumber + '\n' : '') +
        'Query type:   ' + (p.queryType || '') + '\n\n' +
        'Description:\n' + (p.description || '') + '\n\n' +
        'Submitted:    ' + new Date().toISOString()
    });
  } catch (err) {
    console.log('Instructor email error: ' + err.toString());
  }
}

function sendStudentConfirmEmailFromParams(p, refId) {
  var email = p.email || '';
  if (!email || email.indexOf('@') === -1) return;
  try {
    var c      = getCourseConf();
    var course = c.courseName || 'QueryDesk';
    MailApp.sendEmail({
      to:      email,
      subject: '[' + course + '] Received \u2014 ' + refId,
      body:
        'Hi ' + (p.name || 'Student') + ',\n\n' +
        'Your query has been received. Here are the details:\n\n' +
        'Reference ID:  ' + refId + '\n' +
        'Query type:    ' + (p.queryType || '') + '\n' +
        'Submitted:     ' + new Date().toISOString() + '\n\n' +
        'Track your query status: enter your roll number in the status tracker on the student form.\n\n' +
        'Do not reply to this email.\n' +
        '\u2014 QueryDesk'
    });
  } catch (err) {
    console.log('Student confirm email error: ' + err.toString());
  }
}

// Sends a status-change notification to the student.
function sendStatusUpdateEmailFromRow(row, status, notes) {
  if (!row) return;
  var email = String(row[2] || '');
  if (!email || email.indexOf('@') === -1) return;
  if (status !== 'Resolved' && status !== 'Rejected') return;
  try {
    var c        = getCourseConf();
    var course   = c.courseName || 'QueryDesk';
    var resolved = status === 'Resolved';
    MailApp.sendEmail({
      to:      email,
      subject: '[' + course + '] ' + status + ' \u2014 ' + String(row[0] || ''),
      body:
        'Hi ' + String(row[3] || 'Student') + ',\n\n' +
        'Your query ' + String(row[0] || '') + ' has been marked as ' + status + '.\n\n' +
        (notes ? 'Instructor note:\n' + notes + '\n\n' : '') +
        (resolved
          ? 'Your query has been resolved.\n\n'
          : 'Your query could not be accommodated. If you believe this is an error, please speak to your instructor directly.\n\n') +
        'Do not reply to this email.\n' +
        '\u2014 QueryDesk'
    });
  } catch (err) {
    console.log('Status update email error: ' + err.toString());
  }
}

// Kept for POST-path backwards compatibility
function sendInstructorEmail(data, attachmentUrl) {
  sendInstructorEmailFromParams(data, data.referenceId || '');
}
function sendStudentConfirmEmail(data) {
  sendStudentConfirmEmailFromParams(data, data.referenceId || '');
}
function sendStatusUpdateEmail(data) {
  var row = getRowByRef(data.referenceId);
  if (row) sendStatusUpdateEmailFromRow(row, data.status, data.notes || '');
}
