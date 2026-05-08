// ═══════════════════════════════════════════════════════════════════
//  QueryDesk Registry — Handlers.gs
//
//  GET actions (all support JSONP via ?callback=...):
//    listCourses                        — all approved courses (used by directory.html)
//    register&name=..&instructor=..&..  — instructor self-registration
//    listAll&password=..                — admin: all courses incl. pending
//    approve&gasUrl=..&password=..      — admin: approve a pending course
//    remove&gasUrl=..&password=..       — admin: remove a course
// ═══════════════════════════════════════════════════════════════════

function doGet(e) {
  var p      = e.parameter || {};
  var cb     = p.callback  || null;
  var action = p.action    || 'listCourses';

  try {
    if (action === 'listCourses') {
      return regRespond({ ok: true, courses: listApproved() }, cb);
    }
    if (action === 'listAll') {
      if (!authCheck(p.password)) return regRespond({ ok: false, error: 'Unauthorized' }, cb);
      return regRespond({ ok: true, courses: listAll() }, cb);
    }
    if (action === 'register') {
      return regRespond(registerCourse(p), cb);
    }
    if (action === 'approve') {
      if (!authCheck(p.password)) return regRespond({ ok: false, error: 'Unauthorized' }, cb);
      return regRespond(setApproved(p.gasUrl, true), cb);
    }
    if (action === 'remove') {
      if (!authCheck(p.password)) return regRespond({ ok: false, error: 'Unauthorized' }, cb);
      return regRespond(removeCourse(p.gasUrl), cb);
    }
    return regRespond({ ok: false, error: 'Unknown action' }, cb);
  } catch (err) {
    return regRespond({ ok: false, error: String(err) }, cb);
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (body.action === 'register') return regRespond(registerCourse(body), null);
    return regRespond({ ok: false, error: 'Unknown action' }, null);
  } catch (err) {
    return regRespond({ ok: false, error: String(err) }, null);
  }
}

// ── Sheet access ──────────────────────────────────────────────────

function getSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(REG_SHEET);
    sheet.getRange(1, 1, 1, REG_COLS.length).setValues([REG_COLS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, REG_COLS.length)
      .setBackground('#062d21').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setColumnWidth(6, 400); // GasUrl column wider
  }
  return sheet;
}

function rowToObj(row) {
  return {
    name:         String(row[1] || ''),
    instructor:   String(row[2] || ''),
    dept:         String(row[3] || ''),
    term:         String(row[4] || ''),
    sections:     String(row[5] || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean),
    gasUrl:       String(row[6] || ''),
    university:   String(row[7] || ''),
    contactEmail: String(row[8] || ''),
    approved:     row[9] === true || String(row[9]).toLowerCase() === 'true'
  };
}

function listApproved() {
  var data = getSheet().getDataRange().getValues();
  var out  = [];
  for (var i = 1; i < data.length; i++) {
    var obj = rowToObj(data[i]);
    if (obj.approved && obj.gasUrl) out.push(obj);
  }
  return out;
}

function listAll() {
  var data = getSheet().getDataRange().getValues();
  var out  = [];
  for (var i = 1; i < data.length; i++) out.push(rowToObj(data[i]));
  return out;
}

// ── Registration ──────────────────────────────────────────────────

function registerCourse(p) {
  if (!p.gasUrl || !p.name || !p.instructor) {
    return { ok: false, error: 'gasUrl, name, and instructor are required' };
  }

  // Reject duplicate GAS URLs
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][6]) === String(p.gasUrl)) {
      return { ok: false, error: 'This GAS URL is already registered. Contact the registry admin to update your entry.' };
    }
  }

  sheet.appendRow([
    new Date().toISOString(),
    String(p.name         || ''),
    String(p.instructor   || ''),
    String(p.dept         || ''),
    String(p.term         || ''),
    String(p.sections     || ''),
    String(p.gasUrl       || ''),
    String(p.university   || ''),
    String(p.contactEmail || ''),
    AUTO_APPROVE
  ]);

  if (REGISTRY_EMAIL) {
    try {
      MailApp.sendEmail({
        to:      REGISTRY_EMAIL,
        subject: '[QueryDesk] New registration: ' + (p.name || 'Unnamed Course'),
        body: [
          'A new course was registered in QueryDesk.',
          '',
          'Course:     ' + (p.name         || '—'),
          'Instructor: ' + (p.instructor   || '—'),
          'Dept:       ' + (p.dept         || '—'),
          'Term:       ' + (p.term         || '—'),
          'University: ' + (p.university   || '—'),
          'Contact:    ' + (p.contactEmail || '—'),
          'GAS URL:    ' + (p.gasUrl       || '—'),
          '',
          AUTO_APPROVE
            ? 'AUTO-APPROVED — visible in the directory immediately.'
            : 'PENDING — open the registry sheet to approve:\n' +
              SpreadsheetApp.getActiveSpreadsheet().getUrl()
        ].join('\n')
      });
    } catch (e) { /* non-fatal — registration still saved */ }
  }

  return {
    ok:       true,
    approved: AUTO_APPROVE,
    message:  AUTO_APPROVE
      ? 'Your course is now live in the directory!'
      : 'Registration received! Your course will appear in the directory once approved (usually within 24 hours).'
  };
}

// ── Admin helpers ─────────────────────────────────────────────────

function setApproved(gasUrl, approved) {
  if (!gasUrl) return { ok: false, error: 'gasUrl is required' };
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][6]) === String(gasUrl)) {
      sheet.getRange(i + 1, REG_COLS.indexOf('Approved') + 1).setValue(approved);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Course not found' };
}

function removeCourse(gasUrl) {
  if (!gasUrl) return { ok: false, error: 'gasUrl is required' };
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][6]) === String(gasUrl)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Course not found' };
}

function authCheck(pw) {
  return REGISTRY_ADMIN_PASSWORD.length > 0 && pw === REGISTRY_ADMIN_PASSWORD;
}
