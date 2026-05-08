// ──────────────────────────────────────────────────────────────────
//  admin.js — Instructor admin panel logic
//  Depends on: api.js (SCRIPT_URL, jsonpGet, gasPost), utils.js (esc)
// ──────────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  attendance: 'Attendance',
  marks:      'Lab Marks',
  assignment: 'Assignment',
  final:      'Final Marks',
  project:    'Project Marks'
};

let allRows       = [];
let editingRef    = null;
let sessionPw     = '';   // set on successful login; never persisted
let loadedCourse  = { courseName:'ML for Business Analytics', isLab:true, sessionCount:14, sessionLabel:'Lab', sections:['BSBA-6A','BSBA-6B','MSBA'], term:'Spring 2026', instructorName:'', emailDomain:'nu.edu.pk' };
let sortCol       = 'timestamp';
let sortDir       = -1;   // -1 = newest first, 1 = oldest first
let selectedRefs  = new Set();

// ── Auth ──────────────────────────────────────────────
function doLogin() {
  var pw  = document.getElementById('pw-input').value;
  var btn = document.querySelector('.login-card .btn-primary');
  if (!pw) return;

  if (!SCRIPT_URL || SCRIPT_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
    // Demo mode — accept any non-empty password
    sessionPw = pw;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadSettings(); loadData(); return;
  }

  btn.disabled = true; btn.textContent = 'Signing in…';
  jsonpGet(SCRIPT_URL + '?action=getData&password=' + encodeURIComponent(pw))
    .then(function(d) {
      if (d.status === 'ok') {
        sessionPw = pw;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        allRows = d.rows; updateStats(); renderTable();
        var now = new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' });
        var di = document.getElementById('data-info');
        if (di) di.textContent = allRows.length + (allRows.length === 1 ? ' query' : ' queries') + ' · refreshed ' + now;
        loadSettings();
      } else {
        document.getElementById('login-err').style.display = 'block';
        document.getElementById('pw-input').value = '';
        document.getElementById('pw-input').focus();
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    })
    .catch(function() {
      document.getElementById('login-err').textContent = 'Network error. Try again.';
      document.getElementById('login-err').style.display = 'block';
      btn.disabled = false; btn.textContent = 'Sign in';
    });
}
function doLogout() { sessionPw = ''; location.reload(); }

// ── Load data from Apps Script ─────────────────────────
function loadData() {
  document.getElementById('table-body').innerHTML =
    '<tr><td colspan="10" class="loading-row"><span class="spinner"></span></td></tr>';

  if (!SCRIPT_URL || SCRIPT_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
    allRows = DEMO_DATA;
    updateStats(); renderTable(); return;
  }

  jsonpGet(SCRIPT_URL + '?action=getData&password=' + encodeURIComponent(sessionPw))
    .then(function(d) {
      if (d.status === 'ok') {
        allRows = d.rows; updateStats(); renderTable();
        var now = new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' });
        var di = document.getElementById('data-info');
        if (di) di.textContent = allRows.length + (allRows.length === 1 ? ' query' : ' queries') + ' · refreshed ' + now;
      } else showErrRow('Auth failed: ' + d.message);
    })
    .catch(function(err) { showErrRow('Network error: ' + err.message); });
}

function showErrRow(msg) {
  document.getElementById('table-body').innerHTML =
    '<tr><td colspan="10" class="empty-row" style="color:var(--red)">' + esc(msg) + '</td></tr>';
}

// ── Stats ──────────────────────────────────────────────
function updateStats() {
  var counts = { Pending:0, Reviewing:0, Resolved:0, Rejected:0 };
  allRows.forEach(function(r) { if (counts[r.status] !== undefined) counts[r.status]++; });
  document.getElementById('stat-total').textContent     = allRows.length;
  document.getElementById('stat-pending').textContent   = counts.Pending;
  document.getElementById('stat-reviewing').textContent = counts.Reviewing;
  document.getElementById('stat-resolved').textContent  = counts.Resolved;
  document.getElementById('stat-rejected').textContent  = counts.Rejected;
}

// ── Sort ──────────────────────────────────────────────
function sortBy(col) {
  if (sortCol === col) { sortDir *= -1; } else { sortCol = col; sortDir = 1; }
  document.querySelectorAll('thead th[data-sort]').forEach(function(th) {
    th.classList.toggle('sort-active', th.dataset.sort === col);
    if (th.dataset.sort === col) {
      th.textContent = th.textContent.replace(/ [\u25b2\u25bc]$/, '') + (sortDir === 1 ? ' \u25b2' : ' \u25bc');
    } else {
      th.textContent = th.textContent.replace(/ [\u25b2\u25bc]$/, '');
    }
  });
  renderTable();
}

// ── Render table ───────────────────────────────────────
function renderTable() {
  var q    = document.getElementById('f-search').value.toLowerCase();
  var sec  = document.getElementById('f-section').value;
  var stat = document.getElementById('f-status').value;
  var typ  = document.getElementById('f-type').value;
  var lab  = document.getElementById('f-lab').value;

  var filtered = allRows.filter(function(r) {
    var matchQ   = !q    || [r.referenceId, r.name, r.rollNumber, r.email].some(function(v) { return (v||'').toLowerCase().includes(q); });
    var matchSec = !sec  || r.section   === sec;
    var matchSt  = !stat || r.status    === stat;
    var matchTyp = !typ  || r.queryType === typ;
    var matchLab = !lab  || (r.labNumber || '').includes(lab);
    return matchQ && matchSec && matchSt && matchTyp && matchLab;
  });

  filtered.sort(function(a, b) {
    var av = (a[sortCol] || '').toString().toLowerCase();
    var bv = (b[sortCol] || '').toString().toLowerCase();
    return av < bv ? -sortDir : av > bv ? sortDir : 0;
  });

  if (!filtered.length) {
    document.getElementById('table-body').innerHTML =
      '<tr><td colspan="10" class="empty-row">No queries match the current filters.</td></tr>';
    return;
  }

  document.getElementById('table-body').innerHTML = filtered.map(function(r) {
    var typeLabel = TYPE_LABELS[r.queryType] || capitalize(r.queryType);
    var labDisplay = r.labNumber ? esc(r.labNumber) : '<span style="color:var(--text-hint)">—</span>';
    var isChecked = selectedRefs.has(r.referenceId);
    return '<tr>' +
      '<td style="padding:8px 4px 8px 10px"><input type="checkbox" class="row-check" data-ref="' + esc(r.referenceId) + '" ' + (isChecked ? 'checked' : '') + ' onchange="toggleRowSelect(\'' + esc(r.referenceId) + '\',this.checked)" style="cursor:pointer"/></td>' +
      '<td><span class="ref-id">' + esc(r.referenceId) + '</span></td>' +
      '<td><div class="student-name">' + esc(r.name) + (r.isUrgent ? ' <span class="urgent-badge">&#128308; Urgent</span>' : '') + '</div><div class="student-roll">' + esc(r.rollNumber) + ' · ' + esc(r.email) + '</div></td>' +
      '<td>' + esc(r.section) + '</td>' +
      '<td class="hide-sm" style="font-size:12px">' + labDisplay + '</td>' +
      '<td class="hide-sm" style="font-size:12px;color:var(--text-sec)">' + esc(r.labDate || '—') + '</td>' +
      '<td><span class="t-badge t-' + esc(r.queryType) + '">' + typeLabel + '</span></td>' +
      '<td><span class="s-badge s-' + esc(r.status) + '">' + esc(r.status) + '</span></td>' +
      '<td class="hide-sm" style="font-size:12px;color:var(--text-sec)">' + esc((r.timestamp || '').split(',')[0]) + '</td>' +
      '<td><button class="btn-sm" onclick="openModal(\'' + esc(r.referenceId) + '\')">Review</button>' +
      (r.attachmentUrl && r.attachmentUrl.indexOf('https://drive.google.com/') === 0 ?
        ' <a href="' + r.attachmentUrl + '" target="_blank" rel="noopener noreferrer" class="btn-sm" title="View attachment" style="text-decoration:none;padding:5px 8px">&#128206;</a>' : '') +
      '</td>' +
      '</tr>';
  }).join('');
}

// ── Modal ──────────────────────────────────────────────
function openModal(refId) {
  var r = allRows.find(function(x) { return x.referenceId === refId; });
  if (!r) return;
  editingRef = refId;

  var typeLabel = TYPE_LABELS[r.queryType] || capitalize(r.queryType);
  document.getElementById('m-title').textContent = 'Query — ' + r.referenceId;
  if (r.isUrgent) {
    var urgBadge = document.createElement('span');
    urgBadge.className = 'urgent-badge';
    urgBadge.style.marginLeft = '8px';
    urgBadge.textContent = '\uD83D\uDD34 Urgent';
    var titleEl = document.getElementById('m-title');
    titleEl.textContent = 'Query \u2014 ' + r.referenceId;
    titleEl.appendChild(urgBadge);
  }
  document.getElementById('m-desc').textContent  = r.description || '(no description)';
  document.getElementById('m-status').value      = r.status || 'Pending';
  document.getElementById('m-notes').value       = r.notes  || '';

  var fields = [
    ['Name',         r.name],
    ['Roll number',  r.rollNumber],
    ['Email',        r.email],
    ['Section',      r.section],
    ['Query type',   typeLabel],
    ['Submitted',    r.timestamp]
  ];
  if (r.labNumber)    fields.push(['Lab(s)',         r.labNumber]);
  if (r.labDate)      fields.push(['Lab date',       r.labDate]);
  if (r.extraDate)    fields.push(['Related date',   r.extraDate]);
  if (r.marksAwarded) fields.push(['Marks awarded',  r.marksAwarded]);
  if (r.marksExpected)fields.push(['Marks expected', r.marksExpected]);
  if (r.issue)        fields.push(['Details',        r.issue]);

  document.getElementById('m-grid').innerHTML = fields.map(function(f) {
    return '<div class="detail-item"><label>' + f[0] + '</label><div class="val">' + esc(f[1] || '—') + '</div></div>';
  }).join('');
  var attDiv  = document.getElementById('m-attachment');
  var attLink = document.getElementById('m-attachment-link');
  if (r.attachmentUrl && r.attachmentUrl.indexOf('https://drive.google.com/') === 0) {
    attLink.href = r.attachmentUrl;
    attDiv.style.display = 'block';
  } else {
    attDiv.style.display = 'none';
  }
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  editingRef = null;
}

// ── Save status ────────────────────────────────────────
function saveStatus() {
  var newStatus = document.getElementById('m-status').value;
  var notes     = document.getElementById('m-notes').value.trim();
  var row = allRows.find(function(r) { return r.referenceId === editingRef; });
  if (!row) return;

  row.status = newStatus;
  row.notes  = notes;

  if (SCRIPT_URL && SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
    gasPost({
      action: 'updateStatus', password: sessionPw,
      referenceId: editingRef, status: newStatus, notes: notes,
      email: row.email || '', name: row.name || ''
    }).then(function() {}).catch(function() {});
  }

  updateStats(); renderTable(); closeModal();
  toast('Status updated to ' + newStatus);
}

// ── Delete ─────────────────────────────────────────────
function deleteQuery() {
  if (!confirm('Delete this query permanently?')) return;
  var refId = editingRef;
  allRows = allRows.filter(function(r) { return r.referenceId !== refId; });

  if (SCRIPT_URL && SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
    gasPost({ action: 'deleteRow', password: sessionPw, referenceId: refId })
      .then(function() {}).catch(function() {});
  }

  updateStats(); renderTable(); closeModal();
  toast('Query deleted');
}

// ── Bulk actions ───────────────────────────────────────
function toggleRowSelect(refId, checked) {
  if (checked) selectedRefs.add(refId); else selectedRefs.delete(refId);
  updateBulkToolbar();
}
function toggleSelectAll(checked) {
  document.querySelectorAll('.row-check').forEach(function(cb) {
    cb.checked = checked;
    if (checked) selectedRefs.add(cb.dataset.ref); else selectedRefs.delete(cb.dataset.ref);
  });
  updateBulkToolbar();
}
function updateBulkToolbar() {
  var tb = document.getElementById('bulk-toolbar');
  if (!tb) return;
  if (selectedRefs.size > 0) {
    tb.style.display = 'flex';
    document.getElementById('bulk-count').textContent = selectedRefs.size + ' selected';
  } else { tb.style.display = 'none'; }
}
function clearBulk() {
  selectedRefs.clear();
  document.querySelectorAll('.row-check').forEach(function(cb) { cb.checked = false; });
  var sac = document.getElementById('select-all-check'); if (sac) sac.checked = false;
  updateBulkToolbar();
}
function applyBulk() {
  var newStatus = document.getElementById('bulk-status').value;
  if (!newStatus || !selectedRefs.size) return;
  var refs = Array.from(selectedRefs);
  if (!confirm('Change ' + refs.length + ' quer' + (refs.length === 1 ? 'y' : 'ies') + ' to "' + newStatus + '"?')) return;
  refs.forEach(function(ref) {
    var row = allRows.find(function(r) { return r.referenceId === ref; });
    if (row) {
      row.status = newStatus;
      if (SCRIPT_URL && SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE')
        gasPost({ action:'updateStatus', password:sessionPw, referenceId:ref,
          status:newStatus, notes:row.notes||'', email:row.email||'', name:row.name||'' }).catch(function(){});
    }
  });
  clearBulk(); updateStats(); renderTable();
  toast('Updated ' + refs.length + ' quer' + (refs.length === 1 ? 'y' : 'ies') + ' to ' + newStatus);
}

// ── Export CSV ─────────────────────────────────────────
function exportCSV() {  var headers = ['Reference ID','Timestamp','Email','Name','Roll Number',
    'Section','Lab Number','Lab Date','Query Type','Description',
    'Extra Date','Marks Awarded','Marks Expected','Issue','Request','Status','Notes','Attachment URL','Urgent'];
  var rows = allRows.map(function(r) {
    return [r.referenceId, r.timestamp, r.email, r.name, r.rollNumber,
      r.section, r.labNumber, r.labDate, r.queryType, r.description,
      r.extraDate, r.marksAwarded, r.marksExpected, r.issue, r.request, r.status, r.notes, r.attachmentUrl || '', r.isUrgent ? 'Yes' : 'No'
    ].map(function(v) { return '"' + (v||'').replace(/"/g, '""') + '"'; });
  });

  var csv  = [headers.join(',')].concat(rows.map(function(r) { return r.join(','); })).join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = 'mllab_queries_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  toast('CSV exported');
}

// ── Analytics ─────────────────────────────────────────
function openAnalytics()  { renderAnalytics(); document.getElementById('analytics-overlay').classList.add('open'); }
function closeAnalytics() { document.getElementById('analytics-overlay').classList.remove('open'); }
function renderAnalytics() {
  var body = document.getElementById('analytics-body');
  if (!allRows.length) { body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-hint)">No data yet.</div>'; return; }
  var sc = { Pending:0, Reviewing:0, Resolved:0, Rejected:0 }, tc = {}, secc = {};
  allRows.forEach(function(r) {
    sc[r.status] = (sc[r.status] || 0) + 1;
    tc[r.queryType] = (tc[r.queryType] || 0) + 1;
    secc[r.section] = (secc[r.section] || 0) + 1;
  });
  var tot = allRows.length;
  function bar(lbl, cnt, color) {
    var p = tot > 0 ? Math.round(cnt / tot * 100) : 0;
    return '<div class="bar-row"><div class="bar-row-lbl"><span>' + esc(lbl) + '</span><span style="font-weight:700">' + cnt + ' (' + p + '%)</span></div>' +
           '<div class="bar-track"><div class="bar-fill" style="width:' + p + '%;background:' + color + '"></div></div></div>';
  }
  var html = '<div style="font-size:12px;color:var(--text-sec);margin-bottom:16px">Total: <strong>' + tot + '</strong> ' + (tot === 1 ? 'query' : 'queries') + '</div>';
  html += '<div class="analytics-section-lbl">Status</div>';
  html += bar('Pending',   sc.Pending   || 0, '#b96a00') +
          bar('Reviewing', sc.Reviewing || 0, '#185FA5') +
          bar('Resolved',  sc.Resolved  || 0, '#1D9E75') +
          bar('Rejected',  sc.Rejected  || 0, '#D85A30');
  html += '<div class="analytics-section-lbl">Query Type</div>';
  Object.keys(tc).sort().forEach(function(k) { html += bar(TYPE_LABELS[k] || k, tc[k], '#1D9E75'); });
  html += '<div class="analytics-section-lbl">Section</div>';
  Object.keys(secc).sort().forEach(function(k) { html += bar(k || 'Unknown', secc[k], '#185FA5'); });
  body.innerHTML = html;
}

// ── Settings panel ────────────────────────────────────
function openSettings() {
  if (SCRIPT_URL && SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
    jsonpGet(SCRIPT_URL + '?action=getSettings')
      .then(function(d) {
        if (d.status === 'ok') applySettingsToToggles(d.settings);
      })
      .catch(function() {});
    jsonpGet(SCRIPT_URL + '?action=getCourseSettings')
      .then(function(d) {
        if (d.status === 'ok' && d.course) populateCourseInputs(d.course);
      })
      .catch(function() {});
  }
  populateCourseInputs(loadedCourse);
  document.getElementById('settings-save-status').style.display = 'none';
  document.getElementById('settings-overlay').classList.add('open');
}

function populateCourseInputs(c) {
  var n = document.getElementById('s-coursename'); if (n) n.value = c.courseName || '';
  var t = document.getElementById('s-term');       if (t) t.value = c.term || '';
  var b = document.getElementById('s-islab');      if (b) b.checked = c.isLab !== false;
  var l = document.getElementById('s-sessionlabel'); if (l) l.value = c.sessionLabel || 'Lab';
  var cnt = document.getElementById('s-sessioncount'); if (cnt) cnt.value = c.sessionCount || 14;
  var sec = document.getElementById('s-sections');  if (sec) sec.value = (c.sections || []).join(', ');
  var instr = document.getElementById('s-instrname'); if (instr) instr.value = c.instructorName || '';
  var ed = document.getElementById('s-emaildomain'); if (ed) ed.value = c.emailDomain || 'nu.edu.pk';
  var u  = document.getElementById('s-uniname');        if (u)  u.value   = c.universityName || '';
  var rf = document.getElementById('s-rollformat');     if (rf) rf.value  = c.rollFormat || '';
  var so = document.getElementById('s-submissionopen'); if (so) so.checked = c.submissionOpen !== false;
  var cm = document.getElementById('s-closedmsg');      if (cm) cm.value  = c.closedMessage || '';
  var an = document.getElementById('s-announcement');   if (an) an.value  = c.announcement || '';
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

function applySettingsToToggles(s) {
  ['attendance','marks','assignment','final','project'].forEach(function(k) {
    var el = document.getElementById('tog-' + k);
    if (el) el.checked = s[k] !== false;
  });
}

function saveSettings() {
  var settings = {
    attendance: document.getElementById('tog-attendance').checked,
    marks:      document.getElementById('tog-marks').checked,
    assignment: document.getElementById('tog-assignment').checked,
    final:      document.getElementById('tog-final').checked,
    project:    document.getElementById('tog-project').checked
  };

  var rawSections = (document.getElementById('s-sections').value || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  var courseSettings = {
    courseName:     document.getElementById('s-coursename').value.trim(),
    term:           document.getElementById('s-term').value.trim(),
    isLab:          document.getElementById('s-islab').checked,
    sessionLabel:   document.getElementById('s-sessionlabel').value.trim() || 'Lab',
    sessionCount:   parseInt(document.getElementById('s-sessioncount').value, 10) || 14,
    sections:       rawSections.length ? rawSections : loadedCourse.sections,
    instructorName: document.getElementById('s-instrname').value.trim(),
    emailDomain:    (document.getElementById('s-emaildomain').value.trim() || 'nu.edu.pk').toLowerCase(),
    universityName: (document.getElementById('s-uniname')        || {}).value ? document.getElementById('s-uniname').value.trim()        : (loadedCourse.universityName || ''),
    rollFormat:     (document.getElementById('s-rollformat')     || {}).value ? document.getElementById('s-rollformat').value.trim()      : (loadedCourse.rollFormat || ''),
    submissionOpen: document.getElementById('s-submissionopen')  ? document.getElementById('s-submissionopen').checked : true,
    closedMessage:  (document.getElementById('s-closedmsg')      || {}).value ? document.getElementById('s-closedmsg').value.trim()       : '',
    announcement:   (document.getElementById('s-announcement')   || {}).value ? document.getElementById('s-announcement').value.trim()    : ''
  };

  if (SCRIPT_URL && SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
    gasPost({ action: 'saveSettings', password: sessionPw, settings: settings })
      .then(function() {}).catch(function() {});
    gasPost({ action: 'saveCourseSettings', password: sessionPw, courseSettings: courseSettings })
      .then(function() {}).catch(function() {});
  }

  loadedCourse = courseSettings;
  populateFilterDropdowns(courseSettings);

  var ss = document.getElementById('settings-save-status');
  ss.style.display = 'inline';
  setTimeout(function() { ss.style.display = 'none'; closeSettings(); }, 1200);
  toast('Settings saved');
}

// ── Toast ──────────────────────────────────────────────
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2500);
}

// ── Helpers ────────────────────────────────────────────
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

// Close modals on overlay click
document.getElementById('modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.getElementById('settings-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeSettings();
});
document.getElementById('analytics-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeAnalytics();
});

// Load settings toggles on app init (called from doLogin)
function loadSettings() {
  if (!SCRIPT_URL || SCRIPT_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') return;
  jsonpGet(SCRIPT_URL + '?action=getSettings')
    .then(function(d) { if (d.status === 'ok') applySettingsToToggles(d.settings); })
    .catch(function() {});
  jsonpGet(SCRIPT_URL + '?action=getCourseSettings')
    .then(function(d) { if (d.status === 'ok' && d.course) { loadedCourse = d.course; populateFilterDropdowns(d.course); } })
    .catch(function() {});
}

function populateFilterDropdowns(c) {
  var secSel = document.getElementById('f-section');
  if (secSel) {
    var curSec = secSel.value;
    secSel.innerHTML = '<option value="">All sections</option>';
    (c.sections || []).forEach(function(s) {
      var o = document.createElement('option'); o.textContent = s; o.value = s; secSel.appendChild(o);
    });
    if (curSec) secSel.value = curSec;
  }
  var labSel = document.getElementById('f-lab');
  if (labSel) {
    var curLab = labSel.value;
    var lbl = c.sessionLabel || 'Lab';
    var cnt = c.sessionCount || 14;
    labSel.innerHTML = '<option value="">All ' + lbl.toLowerCase() + 's</option>';
    for (var i = 1; i <= cnt; i++) {
      var o = document.createElement('option'); o.textContent = lbl + ' ' + i; o.value = lbl + ' ' + i; labSel.appendChild(o);
    }
    if (curLab) labSel.value = curLab;
  }
}

// ── Demo data ──────────────────────────────────────────
var DEMO_DATA = [
  { referenceId:'QRY-A1B2C3', timestamp:'06/05/2026, 10:23 AM', email:'i231001@isb.nu.edu.pk',
    name:'Ali Hassan', rollNumber:'23I-1001', section:'BSBA-6A',
    labNumber:'Lab 3, Lab 5', labDate:'2026-05-01', queryType:'attendance',
    description:'I was present in both labs but my attendance was not marked. The register shows absent for both.',
    extraDate:'2026-05-01', marksAwarded:'', marksExpected:'', issue:'Present but not marked',
    request:'', status:'Pending', notes:'' },
  { referenceId:'QRY-D4E5F6', timestamp:'05/05/2026, 02:11 PM', email:'k221234@nu.edu.pk',
    name:'Sara Khan', rollNumber:'22K-1234', section:'BSBA-6B',
    labNumber:'Lab 2', labDate:'2026-04-28', queryType:'marks',
    description:'My lab marks were entered as 7 but I completed all tasks and expected 10.',
    extraDate:'', marksAwarded:'7', marksExpected:'10', issue:'Wrong marks entered',
    request:'', status:'Reviewing', notes:'Checking with TA' },
  { referenceId:'QRY-G7H8I9', timestamp:'04/05/2026, 09:45 AM', email:'i241567@isb.nu.edu.pk',
    name:'Usman Tariq', rollNumber:'24I-1567', section:'MSBA',
    labNumber:'', labDate:'', queryType:'final',
    description:'My final exam marks were entered incorrectly. Q3 Part B was fully correct but got 0.',
    extraDate:'2026-04-25', marksAwarded:'30', marksExpected:'40', issue:'Checking mistake | Q: Q3 Part B',
    request:'', status:'Resolved', notes:'Verified and corrected.' },
  { referenceId:'QRY-J1K2L3', timestamp:'03/05/2026, 11:00 AM', email:'i231008@isb.nu.edu.pk',
    name:'Fatima Noor', rollNumber:'23I-1008', section:'BSBA-6A',
    labNumber:'', labDate:'', queryType:'project',
    description:'Project phase 2 marks were not entered in the portal yet.',
    extraDate:'2026-04-20', marksAwarded:'', marksExpected:'80', issue:'Marks not entered | Proj: Final Term Project Phase 2',
    request:'', status:'Pending', notes:'' },
  { referenceId:'QRY-M4N5O6', timestamp:'02/05/2026, 03:30 PM', email:'k231099@nu.edu.pk',
    name:'Hassan Raza', rollNumber:'23K-1099', section:'BSBA-6B',
    labNumber:'', labDate:'', queryType:'assignment',
    description:'Assignment 3 was submitted on time but a late penalty was applied incorrectly.',
    extraDate:'2026-04-15', marksAwarded:'14', marksExpected:'20', issue:'Penalty applied incorrectly | Asgn: Assignment 3',
    request:'', status:'Pending', notes:'' }
];

// Populate filter dropdowns with defaults immediately (before login/JSONP)
populateFilterDropdowns(loadedCourse);
