// ═══════════════════════════════════════════════════════════════════
//  QueryDesk — EmailUtils.gs
//  Email notification helpers (instructor + student)
// ═══════════════════════════════════════════════════════════════════

// Reads course config from Script Properties (or falls back to defaults).
function getCourseConf() {
  var raw = PropertiesService.getScriptProperties().getProperty('courseSettings');
  return raw ? JSON.parse(raw) : DEFAULT_COURSE_SETTINGS;
}

// Sends a new-query notification to the instructor.
function sendInstructorEmail(data, attachmentUrl) {
  if (!INSTRUCTOR_EMAIL) return;
  try {
    var c          = getCourseConf();
    var sessionLbl = c.sessionLabel || 'Lab';
    var urgentTag  = data.isUrgent ? '[URGENT] ' : '';
    MailApp.sendEmail({
      to:      INSTRUCTOR_EMAIL,
      subject: '[' + c.courseName + '] ' + urgentTag + 'New ' + data.queryType + ' query from ' + data.name,
      body:
        (data.isUrgent ? '\u26a0 URGENT QUERY\n\n' : '') +
        'Reference: '   + data.referenceId + '\n' +
        'Student: '     + data.name + ' (' + data.rollNumber + ')\n' +
        'Section: '     + data.section + '\n' +
        sessionLbl + ': ' + (data.labNumber || 'N/A') + ' on ' + (data.labDate || 'N/A') + '\n' +
        'Query type: '  + data.queryType + '\n\n' +
        'Description:\n' + data.description + '\n\n' +
        (attachmentUrl && attachmentUrl.indexOf('https://') === 0 ? 'Attachment: ' + attachmentUrl + '\n\n' : '') +
        'Submitted: '   + data.timestamp
    });
  } catch (mailErr) {
    console.log('Instructor email error: ' + mailErr.toString());
  }
}

// Sends a submission confirmation to the student.
function sendStudentConfirmEmail(data) {
  if (!data.email || data.email.indexOf('@') === -1) return;
  try {
    var c           = getCourseConf();
    var sessionLbl2 = c.sessionLabel || 'Lab';
    MailApp.sendEmail({
      to:      data.email,
      subject: '[' + c.courseName + '] Received \u2014 ' + data.referenceId,
      body:
        'Hi ' + data.name + ',\n\n' +
        'Your query has been received. Here are the details:\n\n' +
        'Reference ID:  ' + data.referenceId + '\n' +
        'Query type:    ' + data.queryType + '\n' +
        (data.labNumber ? sessionLbl2 + '(s):  ' + data.labNumber + '\n' : '') +
        'Submitted:     ' + data.timestamp + '\n\n' +
        'You can track the status of your query at any time:\n' +
        'https://hafiz-m-awais.github.io/mllab-query/\n\n' +
        'Enter your roll number (' + data.rollNumber + ') in the tracker at the bottom of the page.\n\n' +
        'Do not reply to this email.\n' +
        '\u2014 QueryDesk | ' + c.courseName + ', FAST-NUCES Islamabad'
    });
  } catch (mailErr) {
    console.log('Student confirmation email error: ' + mailErr.toString());
  }
}

// Sends a status-change notification to the student (Resolved / Rejected only).
function sendStatusUpdateEmail(data) {
  if (!data.email || data.email.indexOf('@') === -1) return;
  if (data.status !== 'Resolved' && data.status !== 'Rejected') return;
  try {
    var c        = getCourseConf();
    var resolved = data.status === 'Resolved';
    MailApp.sendEmail({
      to:      data.email,
      subject: '[' + c.courseName + '] ' + data.status + ' \u2014 ' + data.referenceId,
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
        '\u2014 QueryDesk | ' + c.courseName + ', FAST-NUCES Islamabad'
    });
  } catch (mailErr) {
    console.log('Status update email error: ' + mailErr.toString());
  }
}
