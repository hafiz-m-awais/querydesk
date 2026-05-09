// ──────────────────────────────────────────────────────────────────
//  admin.js v2 — Instructor admin panel logic
//  Auth: one-time JSONP login → session token (not password-per-request)
// ──────────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  attendance: 'Attendance', marks: 'Lab Marks', assignment: 'Assignment',
  final: 'Final Marks', project: 'Project Marks'
};

let allRows      = [];
let editingRef   = null;
let loadedCourse = { courseName:'', isLab:false, sessionCount:14, sessionLabel:'Session', sections:[], term:'', instructorName:'', emailDomain:'', universityName:'' };
let sortCol      = 'timestamp';
let sortDir      = -1;
let selectedRefs = new Set();

// ── Pagination ────────────────────────────────────────────────────
let PAGE_SIZE   = 50;
let currentPage = 1;

// ── Auth ──────────────────────────────────────────────────────────
function doLogin() {
  var email = (document.getElementById('email-input') ? document.getElementById('email-input').value : '').trim();
  var pw    = document.getElementById('pw-input').value;
  var btn   = document.querySelector('.login-card .btn-primary');
  if (!email || !pw) return;

  btn.disabled = true; btn.textContent = 'Signing in\u2026';

  doApiLogin(email, pw)
    .then(function(d) {
      btn.disabled = false; btn.textContent = 'Sign in';
      setToken(d.access_token);
      setRefreshToken(d.refresh_token);
      showApp();
    })
    .catch(function() {
      btn.disabled = false; btn.textContent = 'Sign in';
      document.getElementById('login-err').style.display = 'block';
      document.getElementById('pw-input').value = '';
      document.getElementById('pw-input').focus();
    });
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  loadSettings(); loadData();
}

function doLogout() {
  doApiLogout().catch(function() {});
  clearToken();
  clearRefreshToken();
  location.reload();
}

// ── Load data ──────────────────────────────────────────────────────
function loadData() {
  document.getElementById('table-body').innerHTML =
    '<tr><td colspan="10" class="loading-row"><span class="spinner"></span></td></tr>';

  apiGet('/queries', { page: 1, page_size: 500 })
    .then(function(d) {
      // Normalize v3 fields to the UI's legacy field names
      allRows = (d.items || []).map(function(r) {
        return {
          referenceId:   r.id,
          name:          r.student_name,
          rollNumber:    r.roll_no,
          email:         r.student_email,
          section:       '',  // not in v3 schema
          queryType:     'query',
          description:   r.description,
          status:        normalizeStatus(r.status),
          notes:         r.instructor_note || '',
          timestamp:     r.created_at,
          attachmentUrl: r.attachment_url || '',
          labNumber:     '',
          labDate:       '',
          isUrgent:      false,
          _raw:          r   // keep raw for PATCH operations
        };
      });
      currentPage = 1;
      updateStats(); renderTable();
      var now = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      var di = document.getElementById('data-info');
      if (di) di.textContent = allRows.length + ' quer' + (allRows.length === 1 ? 'y' : 'ies') + ' \u00b7 refreshed ' + now;
    })
    .catch(function(err) {
      if (err.status === 401) { clearToken(); location.reload(); return; }
      showErrRow('Network error: ' + err.message);
    });
}

function normalizeStatus(s) {
  var map = { pending:'Pending', in_review:'Reviewing', resolved:'Resolved', rejected:'Rejected' };
  return map[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Pending');
}
function denormalizeStatus(s) {
  var map = { Pending:'pending', Reviewing:'in_review', Resolved:'resolved', Rejected:'rejected' };
  return map[s] || s.toLowerCase();
}

function showErrRow(msg) {
  document.getElementById('table-body').innerHTML =
    '<tr><td colspan="10" class="empty-row" style="color:var(--red)">' + esc(msg) + '</td></tr>';
}

// ── Stats ──────────────────────────────────────────────────────────
function updateStats() {
  var c = { Pending:0, Reviewing:0, Resolved:0, Rejected:0 };
  allRows.forEach(function(r) { if (c[r.status] !== undefined) c[r.status]++; });
  document.getElementById('stat-total').textContent     = allRows.length;
  document.getElementById('stat-pending').textContent   = c.Pending;
  document.getElementById('stat-reviewing').textContent = c.Reviewing;
  document.getElementById('stat-resolved').textContent  = c.Resolved;
  document.getElementById('stat-rejected').textContent  = c.Rejected;
}

// ── Sort ───────────────────────────────────────────────────────────
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
  currentPage = 1; renderTable();
}

// ── Render table (paginated) ───────────────────────────────────────
function renderTable() {
  var q    = document.getElementById('f-search').value.toLowerCase();
  var sec  = document.getElementById('f-section').value;
  var stat = document.getElementById('f-status').value;
  var typ  = document.getElementById('f-type').value;
  var lab  = document.getElementById('f-lab').value;

  var filtered = allRows.filter(function(r) {
    var matchQ   = !q    || [r.referenceId, r.name, r.rollNumber, r.email].some(function(v){ return (v||'').toLowerCase().includes(q); });
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

  var total    = filtered.length;
  var pages    = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  var start    = (currentPage - 1) * PAGE_SIZE;
  var pageRows = filtered.slice(start, start + PAGE_SIZE);

  renderPagination(currentPage, pages, total);

  if (!filtered.length) {
    document.getElementById('table-body').innerHTML =
      '<tr><td colspan="10" class="empty-row">No queries match the current filters.</td></tr>';
    return;
  }

  document.getElementById('table-body').innerHTML = pageRows.map(function(r) {
    var typeLabel  = TYPE_LABELS[r.queryType] || capitalize(r.queryType || '');
    var labDisplay = r.labNumber ? esc(r.labNumber) : '<span style="color:var(--text-hint)">\u2014</span>';
    var isChecked  = selectedRefs.has(r.referenceId);
    var ts         = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : '\u2014';
    return '<tr>' +
      '<td style="padding:8px 4px 8px 10px"><input type="checkbox" class="row-check" data-ref="' + esc(r.referenceId) + '" ' + (isChecked ? 'checked' : '') + ' onchange="toggleRowSelect(\'' + esc(r.referenceId) + '\',this.checked)" style="cursor:pointer"/></td>' +
      '<td><span class="ref-id">' + esc(r.referenceId) + '</span></td>' +
      '<td><div class="student-name">' + esc(r.name) + (r.isUrgent ? ' <span class="urgent-badge">&#128308; Urgent</span>' : '') + '</div><div class="student-roll">' + esc(r.rollNumber) + ' \u00b7 ' + esc(r.email) + '</div></td>' +
      '<td>' + esc(r.section) + '</td>' +
      '<td class="hide-sm" style="font-size:12px">' + labDisplay + '</td>' +
      '<td class="hide-sm" style="font-size:12px;color:var(--text-sec)">' + esc(r.labDate || '\u2014') + '</td>' +
      '<td><span class="t-badge t-' + esc(r.queryType) + '">' + typeLabel + '</span></td>' +
      '<td><span class="s-badge s-' + esc(r.status) + '">' + esc(r.status) + '</span></td>' +
      '<td class="hide-sm" style="font-size:12px;color:var(--text-sec)">' + esc(ts) + '</td>' +
      '<td><button class="btn-sm" onclick="openModal(\'' + esc(r.referenceId) + '\')">Review</button>' +
      (r.attachmentUrl && r.attachmentUrl.indexOf('https://drive.google.com/') === 0 ? ' <a href="' + r.attachmentUrl + '" target="_blank" rel="noopener noreferrer" class="btn-sm" title="View attachment" style="text-decoration:none;padding:5px 8px">&#128206;</a>' : '') +
      '</td></tr>';
  }).join('');
}

function renderPagination(page, pages, total) {
  var el = document.getElementById('pagination');
  if (!el) return;
  if (pages <= 1) { el.innerHTML = ''; return; }
  var start = (page - 1) * PAGE_SIZE + 1;
  var end   = Math.min(page * PAGE_SIZE, total);
  el.innerHTML =
    '<button class="btn-sm" onclick="changePage(-1)" ' + (page <= 1 ? 'disabled' : '') + '>\u2190 Prev</button>' +
    '<span style="font-size:12px;color:var(--text-sec);padding:0 12px">' + start + '\u2013' + end + ' of ' + total + '</span>' +
    '<button class="btn-sm" onclick="changePage(1)" '  + (page >= pages ? 'disabled' : '') + '>Next \u2192</button>';
}

function changePage(dir) {
  var q       = document.getElementById('f-search').value.toLowerCase();
  var filtered = allRows.filter(function(r) {
    return !q || [r.referenceId, r.name, r.rollNumber, r.email].some(function(v){ return (v||'').toLowerCase().includes(q); });
  });
  var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.max(1, Math.min(pages, currentPage + dir));
  renderTable();
}

// ── Modal ──────────────────────────────────────────────────────────
function openModal(refId) {
  var r = allRows.find(function(x) { return x.referenceId === refId; });
  if (!r) return;
  editingRef = refId;
  var typeLabel = TYPE_LABELS[r.queryType] || capitalize(r.queryType || '');
  document.getElementById('m-title').textContent = 'Query \u2014 ' + r.referenceId;
  if (r.isUrgent) {
    var u = document.createElement('span');
    u.className = 'urgent-badge'; u.style.marginLeft = '8px'; u.textContent = '\uD83D\uDD34 Urgent';
    document.getElementById('m-title').appendChild(u);
  }
  document.getElementById('m-desc').textContent = r.description || '(no description)';
  document.getElementById('m-status').value     = r.status || 'Pending';
  document.getElementById('m-notes').value      = r.notes  || '';
  var notify = document.getElementById('m-notify');
  if (notify) notify.checked = false;

  var fields = [
    ['Name', r.name], ['Roll number', r.rollNumber], ['Email', r.email],
    ['Section', r.section], ['Query type', typeLabel],
    ['Submitted', r.timestamp ? new Date(r.timestamp).toLocaleString() : '']
  ];
  if (r.labNumber)     fields.push(['Session(s)',    r.labNumber]);
  if (r.labDate)       fields.push(['Session date',  r.labDate]);
  if (r.extraDate)     fields.push(['Related date',  r.extraDate]);
  if (r.marksAwarded)  fields.push(['Marks awarded', r.marksAwarded]);
  if (r.marksExpected) fields.push(['Marks expected',r.marksExpected]);
  if (r.issue)         fields.push(['Details',       r.issue]);

  document.getElementById('m-grid').innerHTML = fields.map(function(f) {
    return '<div class="detail-item"><label>' + f[0] + '</label><div class="val">' + esc(f[1] || '\u2014') + '</div></div>';
  }).join('');

  var attDiv = document.getElementById('m-attachment'), attLink = document.getElementById('m-attachment-link');
  if (r.attachmentUrl && r.attachmentUrl.indexOf('https://drive.google.com/') === 0) {
    attLink.href = r.attachmentUrl; attDiv.style.display = 'block';
  } else { attDiv.style.display = 'none'; }
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  editingRef = null;
}

// ── Save status ────────────────────────────────────────────────────
function saveStatus() {
  var newStatus = document.getElementById('m-status').value;
  var notes     = document.getElementById('m-notes').value.trim();
  var row = allRows.find(function(r) { return r.referenceId === editingRef; });
  if (!row) return;

  row.status = newStatus; row.notes = notes;
  updateStats(); renderTable(); closeModal();
  toast('Status updated to ' + newStatus);

  apiPatch('/queries/' + row.referenceId, {
    status: denormalizeStatus(newStatus),
    instructor_note: notes || null
  }).catch(function(err) { toast('Sync error: ' + err.message); });
}

// ── Delete — proper confirm modal, not browser confirm() ──────────
function deleteQuery() {
  if (!editingRef) return;
  var refToDelete = editingRef;

  // Show inline confirmation inside the modal footer
  var foot = document.querySelector('#modal .modal-foot');
  if (!foot) return;
  foot.innerHTML =
    '<span style="flex:1;font-size:13px;color:var(--red);font-weight:600">' +
      'Delete ' + esc(refToDelete) + ' permanently? This cannot be undone.' +
    '</span>' +
    '<button class="btn-outline" onclick="cancelDelete()">Cancel</button>' +
    '<button class="btn-danger"  onclick="confirmDelete(\'' + esc(refToDelete) + '\')">Yes, delete</button>';
}

function cancelDelete() {
  var foot = document.querySelector('#modal .modal-foot');
  if (foot) foot.innerHTML =
    '<button class="btn-danger"  onclick="deleteQuery()">Delete</button>' +
    '<button class="btn-outline" onclick="closeModal()">Cancel</button>' +
    '<button class="btn-primary" onclick="saveStatus()">Save changes</button>';
}

function confirmDelete(refId) {
  allRows = allRows.filter(function(r) { return r.referenceId !== refId; });
  updateStats(); renderTable(); closeModal();
  cancelDelete(); // restore footer for next open
  toast('Query deleted');
  apiDelete('/queries/' + refId).catch(function() {});
}

// ── Bulk actions ───────────────────────────────────────────────────
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
  tb.style.display = selectedRefs.size > 0 ? 'flex' : 'none';
  if (selectedRefs.size > 0)
    document.getElementById('bulk-count').textContent = selectedRefs.size + ' selected';
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
  var msg  = 'Change ' + refs.length + ' quer' + (refs.length === 1 ? 'y' : 'ies') + ' to "' + newStatus + '"?';
  if (!confirm(msg)) return;
  refs.forEach(function(ref) {
    var row = allRows.find(function(r) { return r.referenceId === ref; });
    if (row) row.status = newStatus;
  });
  apiPost('/queries/bulk-update', {
    query_ids: refs,
    status: denormalizeStatus(newStatus)
  }).catch(function(err) { toast('Bulk update error: ' + err.message); });
  clearBulk(); updateStats(); renderTable();
  toast('Updated ' + refs.length + ' quer' + (refs.length === 1 ? 'y' : 'ies') + ' to ' + newStatus);
}

// ── Settings / Analytics ──────────────────────────────────────────
function openSettings()  { loadSettingsPanel(); document.getElementById('settings-overlay').classList.add('open'); }
function closeSettings() { document.getElementById('settings-overlay').classList.remove('open'); }
function openAnalytics() { renderAnalytics(); document.getElementById('analytics-overlay').classList.add('open'); }
function closeAnalytics(){ document.getElementById('analytics-overlay').classList.remove('open'); }

function loadSettings() { /* Branding loaded from JWT claims or a future /me endpoint */ }

function loadSettingsPanel() { /* Settings panel shows current loaded course data */ }

function applySettingsToggles(s) {
  ['attendance','marks','assignment','final','project'].forEach(function(k) {
    var el = document.getElementById('tog-' + k);
    if (el) el.checked = s[k] !== false;
  });
}

function applyBranding(c) {
  var h2 = document.querySelector('.topbar-left h2');
  if (h2 && c.courseName) h2.textContent = 'QueryDesk \u2014 ' + c.courseName;
  var topUni = document.querySelector('.topbar-left .uni-label');
  if (topUni) topUni.textContent = c.universityName || '';
}

function loadCourseSettings(c) {
  var fields = {
    's-coursename':     c.courseName     || '',
    's-term':           c.term           || '',
    's-sessionlabel':   c.sessionLabel   || 'Session',
    's-sessioncount':   c.sessionCount   || 14,
    's-sections':       (c.sections || []).join(', '),
    's-instructorname': c.instructorName || '',
    's-emaildomain':    c.emailDomain    || '',
    's-universityname': c.universityName || '',
    's-rollformat':     c.rollFormat     || '',
    's-closedmsg':      c.closedMessage  || '',
    's-announcement':   c.announcement   || ''
  };
  Object.keys(fields).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = fields[id];
  });
  var openToggle = document.getElementById('s-open');
  if (openToggle) openToggle.checked = c.submissionOpen !== false;
}

function saveAllSettings() {
  function gv(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  var openEl = document.getElementById('s-open');

  var courseId = loadedCourse && loadedCourse.id;
  if (!courseId) { toast('No course loaded — open a course first'); return; }

  var body = {
    name:             gv('s-coursename') || undefined,
    semester:         gv('s-term')       || undefined,
    submission_open:  openEl ? openEl.checked : undefined,
    email_pattern:    gv('s-emaildomain') ? ('^[^\\s@]+@' + gv('s-emaildomain').replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '$') : undefined,
    roll_pattern:     gv('s-rollformat') || undefined
  };
  // Remove undefined keys
  Object.keys(body).forEach(function(k){ if (body[k] === undefined) delete body[k]; });

  var btn = document.querySelector('.settings-foot .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }

  apiPatch('/courses/' + courseId, body)
    .then(function() {
      if (btn) { btn.disabled = false; btn.textContent = 'Save all settings'; }
      closeSettings(); loadData(); toast('Settings saved');
    })
    .catch(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save all settings'; }
      toast('Save failed: ' + err.message);
    });
}

// ── Analytics ──────────────────────────────────────────────────────
function renderAnalytics() {
  var body = document.getElementById('analytics-body');
  if (!body || !allRows.length) {
    if (body) body.innerHTML = '<p style="color:var(--text-hint);font-size:14px">No data yet.</p>';
    return;
  }
  var byType = {}, bySection = {}, byStatus = {}, byDay = {};
  allRows.forEach(function(r) {
    var t = r.queryType || 'other';
    var s = r.section   || 'Unknown';
    var x = r.status    || 'Pending';
    var d = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : 'Unknown';
    byType[t]    = (byType[t]    || 0) + 1;
    bySection[s] = (bySection[s] || 0) + 1;
    byStatus[x]  = (byStatus[x]  || 0) + 1;
    byDay[d]     = (byDay[d]     || 0) + 1;
  });
  function tableHtml(title, data) {
    var rows = Object.keys(data).sort(function(a,b){return data[b]-data[a];}).map(function(k) {
      return '<tr><td>' + esc(k) + '</td><td style="font-weight:700">' + data[k] + '</td></tr>';
    }).join('');
    return '<div style="margin-bottom:20px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:8px">' + title + '</div><table style="width:100%;font-size:13px;border-collapse:collapse">' + rows + '</table></div>';
  }
  body.innerHTML = tableHtml('By Status', byStatus) + tableHtml('By Type', byType) + tableHtml('By Section', bySection);
}

// ── Export CSV (server-side) ───────────────────────────────────────
function exportCSV() {
  var filename = 'querydesk-' + new Date().toISOString().slice(0, 10) + '.csv';
  apiDownload('/queries/export', filename)
    .then(function() { toast('CSV downloaded'); })
    .catch(function(err) { toast('Export failed: ' + err.message); });
}

// ── UI helpers ─────────────────────────────────────────────────────
function toast(msg) {
  var t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { t.classList.add('show'); }, 50);
  setTimeout(function() { t.classList.remove('show'); setTimeout(function(){t.remove();}, 400); }, 2500);
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
