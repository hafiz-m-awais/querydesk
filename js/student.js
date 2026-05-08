// ──────────────────────────────────────────────────────────────────
//  student.js v2
//  - Email and roll validation patterns loaded dynamically from settings
//  - Form submission uses JSONP GET (confirmed response, not fire-and-forget)
//  - Status tracker requires OTP verification (student privacy)
// ──────────────────────────────────────────────────────────────────

var MAX_PER_HOUR = 5;
// Dynamic validation — overwritten by applyCourseBranding() when settings load
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var ROLL_RE  = /^.{3,}$/; // accept any non-trivial roll until settings are known

var selectedTypes   = new Set();
var labSelections   = {};
var loadedSettings  = null;
var loadedCourse    = { courseName:'', isLab:false, sessionCount:14, sessionLabel:'Session', sections:[], term:'', instructorName:'', emailDomain:'', rollFormat:'', universityName:'' };
var currentStep     = 1;
var attachmentBase64 = ''; var attachmentFileName = ''; var attachmentMimeType = ''; var attachmentReading = false;
var isUrgent = false;

var ALL_TYPES = {
  attendance: { label:'Attendance', sub:'Missed / not marked', needsLab:true,  badgeClass:'tb-att', badge:'Attendance query',   icon:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="16" r="1.5" fill="#1D9E75"/></svg>' },
  marks:      { label:'Lab Marks',  sub:'Score discrepancy',  needsLab:true,  badgeClass:'tb-mrk', badge:'Lab marks query',    icon:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#854F0B" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>' },
  assignment: { label:'Assignment', sub:'Assignment marks',   needsLab:false, badgeClass:'tb-asg', badge:'Assignment query',   icon:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#185FA5" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
  final:      { label:'Final Marks',sub:'Final exam / theory',needsLab:false, badgeClass:'tb-fin', badge:'Final marks query',  icon:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6B3FA0" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
  project:    { label:'Project',    sub:'Project / term work', needsLab:false, badgeClass:'tb-prj', badge:'Project marks query',icon:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B7A75" stroke-width="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' }
};

// STEP WIZARD
function setStep(n) {
  currentStep = n;
  [1,2,3].forEach(function(i) {
    var panel = document.getElementById('panel'+i), dot = document.getElementById('sd'+i), lbl = document.getElementById('sl'+i);
    panel.classList.toggle('active', i===n);
    dot.classList.toggle('active', i===n); dot.classList.toggle('done', i<n);
    lbl.className = 'step-label'+(i===n?' active':i<n?' done':'');
    dot.textContent = i<n ? '\u2713' : String(i);
  });
  document.getElementById('line1').classList.toggle('done', n>1);
  document.getElementById('line2').classList.toggle('done', n>2);
  document.querySelector('.main-card').scrollIntoView({behavior:'smooth', block:'start'});
}
function goStep1() { setStep(1); }
function goStep2() { if (validateStep1()) setStep(2); }
function goStep3() { if (attachmentReading){alert('Please wait \u2014 file is still being read.');return;} if (validateStep2()) { buildReview(); setStep(3); } }

function validateStep1() {
  clearAllErrors();
  var ok = true;
  if (!EMAIL_RE.test(gv('email').trim())) { showErr('email');   ok = false; }
  if (gv('name').trim().length < 2)       { showErr('name');    ok = false; }
  if (!ROLL_RE.test(gv('roll').trim()))   { showErr('roll');    ok = false; }
  if (!gv('section'))                     { showErr('section'); ok = false; }
  return ok;
}
function validateStep2() {
  var ok = true;
  if (selectedTypes.size === 0) { document.getElementById('err-type').style.display='block'; ok=false; }
  selectedTypes.forEach(function(key) {
    var t = ALL_TYPES[key];
    if (t.needsLab) {
      var sel = labSelections[key] || new Set();
      if (sel.size === 0) { var e=document.getElementById('err-labnum-'+key); if(e) e.style.display='block'; ok=false; }
      else sel.forEach(function(lab) {
        var n  = lab.replace(((loadedCourse&&loadedCourse.sessionLabel)||'Session')+' ','');
        var el = document.getElementById('ldate-'+key+'-'+n);
        if (el && !el.value) { el.style.borderColor='var(--red)'; var er=document.getElementById('err-ldate-'+key+'-'+n); if(er) er.style.display='block'; ok=false; }
      });
    }
    var desc = gv('desc-'+key).trim();
    if (desc.length < 15) { var fd=document.getElementById('f-desc-'+key); if(fd) fd.classList.add('field-invalid'); var ed=document.getElementById('err-desc-'+key); if(ed) ed.style.display='block'; ok=false; }
  });
  return ok;
}
function clearAllErrors() {
  document.querySelectorAll('.field-invalid').forEach(function(f){f.classList.remove('field-invalid');});
  document.querySelectorAll('.err').forEach(function(e){e.style.display='none';});
}

// REVIEW
function buildReview() {
  var html = '';
  html += '<div class="review-student">'+rv('Name',esc(gv('name').trim()))+rv('Roll',esc(gv('roll').trim().toUpperCase()))+rv('Section',esc(gv('section')))+rv('Email',esc(gv('email').trim().toLowerCase()))+'</div>';
  var qIdx = 0;
  selectedTypes.forEach(function(key) {
    qIdx++;
    var t    = ALL_TYPES[key];
    var body = '';
    var sLbl = (loadedCourse && loadedCourse.sessionLabel) || 'Session';
    if (t.needsLab) {
      var sel = Array.from(labSelections[key]||new Set()).sort(function(a,b){return parseInt(a.replace(sLbl+' ',''))-parseInt(b.replace(sLbl+' ',''));});
      sel.forEach(function(lab) {
        var n = lab.replace(sLbl+' ',''), date = gv('ldate-'+key+'-'+n)||'--', parts = '<strong>'+esc(lab)+'</strong> \u00b7 '+esc(date);
        if (key==='attendance'){var iss=gv('lissue-'+key+'-'+n);if(iss)parts+=' \u00b7 '+esc(iss);}
        else if(key==='marks'){var aw=gv('lmawd-'+key+'-'+n),ex=gv('lmexp-'+key+'-'+n),dc=gv('lmdisc-'+key+'-'+n);if(aw)parts+=' \u00b7 Awarded: '+esc(aw);if(ex)parts+=' \u00b7 Expected: '+esc(ex);if(dc)parts+=' \u00b7 '+esc(dc);}
        body += '<div class="rq-row"><div class="rq-item">'+parts+'</div></div>';
      });
    } else {
      var items = [];
      if(gv('d-assno-'+key))    items.push(rvItem('Assignment',gv('d-assno-'+key)));
      if(gv('d-assdate-'+key))  items.push(rvItem('Submission date',gv('d-assdate-'+key)));
      if(gv('d-findate-'+key))  items.push(rvItem('Exam date',gv('d-findate-'+key)));
      if(gv('d-finq-'+key))     items.push(rvItem('Question',gv('d-finq-'+key)));
      if(gv('d-projt-'+key))    items.push(rvItem('Project',gv('d-projt-'+key)));
      if(gv('d-projdate-'+key)) items.push(rvItem('Defence date',gv('d-projdate-'+key)));
      if(gv('d-mawd-'+key))     items.push(rvItem('Marks awarded',gv('d-mawd-'+key)));
      if(gv('d-mexp-'+key))     items.push(rvItem('Marks expected',gv('d-mexp-'+key)));
      if(gv('d-mdisc-'+key))    items.push(rvItem('Issue',gv('d-mdisc-'+key)));
      if (items.length) body += '<div class="rq-row">'+items.join('')+'</div>';
    }
    var desc = esc(gv('desc-'+key).trim());
    if (desc) body += '<div class="rq-desc">'+desc.replace(/\n/g,'<br>')+'</div>';
    html += '<div class="review-qcard"><div class="rq-head"><span class="dyn-badge '+t.badgeClass+'">'+t.badge+'</span><span class="rq-num">Query '+qIdx+' of '+selectedTypes.size+'</span></div><div class="rq-body">'+body+'</div></div>';
  });
  if (attachmentFileName) html += '<div style="background:var(--bl);border:1.5px solid #b3d4f0;border-radius:var(--r);padding:9px 14px;font-size:13px;color:var(--b2);margin-bottom:10px">&#128206; <strong>Attachment:</strong> '+esc(attachmentFileName)+'</div>';
  if (isUrgent) html += '<div style="background:#fee2e2;border:1.5px solid #fca5a5;border-radius:var(--r);padding:9px 14px;font-size:13px;color:#b91c1c;font-weight:700;margin-bottom:10px">&#128308; Marked as Urgent</div>';
  html += '<div class="review-note">&#9757; This is exactly what will be forwarded to your instructor.</div>';
  document.getElementById('review-content').innerHTML = html;
}
function rv(label, val){ return '<div class="rv-field"><span class="rv-label">'+label+'</span><span class="rv-val">'+val+'</span></div>'; }
function rvItem(label, val){ return '<div class="rq-item"><strong>'+esc(label)+'</strong> '+esc(val)+'</div>'; }

// QUERY TYPE CARDS
function renderQueryCards() {
  var grid    = document.getElementById('type-grid');
  var enabled = Object.keys(ALL_TYPES).filter(function(k){ return loadedSettings && loadedSettings[k]; });
  if (enabled.length === 0) { grid.innerHTML = '<p style="color:var(--th);font-size:13px;grid-column:1/-1;padding:12px 0">No query types currently enabled.</p>'; return; }
  var cols = enabled.length <= 2 ? enabled.length : enabled.length <= 4 ? 2 : 3;
  grid.style.gridTemplateColumns = 'repeat('+cols+',1fr)';
  grid.innerHTML = '';
  enabled.forEach(function(key) {
    var t = ALL_TYPES[key];
    var card = document.createElement('div');
    card.className = 'type-card'+(selectedTypes.has(key)?' selected':'');
    card.dataset.key = key;
    card.innerHTML = '<div class="check-tick">\u2713</div>'+t.icon+'<div class="tc-label">'+t.label+'</div><div class="tc-sub">'+t.sub+'</div>';
    card.onclick = (function(k){ return function(){ toggleType(k); }; })(key);
    grid.appendChild(card);
  });
}
function toggleType(key) {
  var card = document.querySelector('.type-card[data-key="'+key+'"]');
  if (selectedTypes.has(key)) {
    selectedTypes.delete(key); if(card) card.classList.remove('selected');
    var sec = document.getElementById('tsec-'+key); if(sec) sec.style.display = 'none';
  } else {
    selectedTypes.add(key); if(card) card.classList.add('selected');
    document.getElementById('err-type').style.display = 'none';
    var sec = document.getElementById('tsec-'+key);
    if (!sec){ sec = buildTypeSection(key); document.getElementById('type-sections').appendChild(sec); }
    else sec.style.display = '';
  }
}

// BUILD TYPE SECTION (unchanged from v1 — session label is dynamic)
function buildTypeSection(key) {
  var t          = ALL_TYPES[key];
  var today      = new Date().toISOString().split('T')[0];
  var sessionLbl = (loadedCourse && loadedCourse.sessionLabel) || 'Session';
  var sessionCnt = (loadedCourse && loadedCourse.sessionCount) || 14;
  var sec = document.createElement('div');
  sec.id = 'tsec-'+key; sec.className = 'type-section';
  var hdr = document.createElement('div');
  hdr.className = 'type-sec-head';
  hdr.innerHTML = '<span class="dyn-badge '+t.badgeClass+'">'+t.badge+'</span><button class="remove-btn" onclick="toggleType(\''+key+'\')">Remove \u2715</button>';
  sec.appendChild(hdr);
  var body = document.createElement('div');
  body.className = 'type-sec-body';
  if (t.needsLab) {
    labSelections[key] = new Set();
    var lbl = document.createElement('label');
    lbl.innerHTML = sessionLbl+' number(s) <span class="req">*</span><span style="font-weight:400;color:var(--th);margin-left:5px">(select one or more)</span>';
    body.appendChild(lbl);
    var grid = document.createElement('div');
    grid.className = 'lab-chips'; grid.id = 'lchips-'+key;
    for (var i = 1; i <= sessionCnt; i++) {
      (function(n, tk, sl) {
        var chip = document.createElement('div');
        chip.className = 'lab-chip'; chip.textContent = sl+' '+n; chip.dataset.lab = sl+' '+n;
        chip.onclick = function(){ toggleLabForType(chip, tk); };
        grid.appendChild(chip);
      })(i, key, sessionLbl);
    }
    body.appendChild(grid);
    var lErr = document.createElement('span');
    lErr.className = 'err'; lErr.id = 'err-labnum-'+key;
    lErr.textContent = 'Please select at least one '+sessionLbl.toLowerCase()+'.';
    body.appendChild(lErr);
    var rows2 = document.createElement('div'); rows2.id = 'lab-rows-'+key;
    body.appendChild(rows2);
  } else {
    var nf = document.createElement('div');
    nf.innerHTML = buildNonLabHtml(key, today);
    body.appendChild(nf);
  }
  var df = document.createElement('div'); df.style.marginTop = '12px';
  df.innerHTML = '<div class="field" id="f-desc-'+key+'"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px"><label style="margin:0">Description <span class="req">*</span></label><span id="cnt-'+key+'" style="font-size:11px;color:var(--th)">0\u202F/\u202F15\u00a0min</span></div><textarea id="desc-'+key+'" placeholder="Describe the issue \u2014 what happened, relevant dates, what you expect\u2026" oninput="updateCounter(\''+key+'\',this.value.length)"></textarea><span class="err" id="err-desc-'+key+'">Please write at least 15 characters.</span></div>';
  body.appendChild(df);
  sec.appendChild(body);
  return sec;
}
function buildNonLabHtml(key, today) {
  if (key==='assignment') return '<div class="frow two"><div class="field"><label>Assignment number / title</label><input type="text" id="d-assno-'+key+'" placeholder="e.g. Assignment 2"/></div><div class="field"><label>Submission date</label><input type="date" id="d-assdate-'+key+'" max="'+today+'"/></div></div><div class="frow three"><div class="field"><label>Marks awarded</label><input type="number" id="d-mawd-'+key+'" min="0" max="100" placeholder="14"/></div><div class="field"><label>Marks expected</label><input type="number" id="d-mexp-'+key+'" min="0" max="100" placeholder="20"/></div><div class="field"><label>Issue type</label><select id="d-mdisc-'+key+'"><option value="">Select</option><option>Not marked yet</option><option>Wrong marks entered</option><option>Penalty applied incorrectly</option><option>Partial despite complete work</option><option>Other</option></select></div></div>';
  if (key==='final')      return '<div class="frow two"><div class="field"><label>Exam date</label><input type="date" id="d-findate-'+key+'" max="'+today+'"/></div><div class="field"><label>Question / section (optional)</label><input type="text" id="d-finq-'+key+'" placeholder="e.g. Q3 Part B"/></div></div><div class="frow three"><div class="field"><label>Marks awarded</label><input type="number" id="d-mawd-'+key+'" min="0" max="100" placeholder="30"/></div><div class="field"><label>Marks expected</label><input type="number" id="d-mexp-'+key+'" min="0" max="100" placeholder="40"/></div><div class="field"><label>Discrepancy type</label><select id="d-mdisc-'+key+'"><option value="">Select</option><option>Marks not entered</option><option>Wrong marks entered</option><option>Checking mistake</option><option>Paper not returned</option><option>Other</option></select></div></div>';
  if (key==='project')    return '<div class="frow two"><div class="field"><label>Project title / phase</label><input type="text" id="d-projt-'+key+'" placeholder="e.g. Final Term Project \u2014 Phase 2"/></div><div class="field"><label>Submission / defence date</label><input type="date" id="d-projdate-'+key+'" max="'+today+'"/></div></div><div class="frow three"><div class="field"><label>Marks awarded</label><input type="number" id="d-mawd-'+key+'" min="0" max="100" placeholder="60"/></div><div class="field"><label>Marks expected</label><input type="number" id="d-mexp-'+key+'" min="0" max="100" placeholder="80"/></div><div class="field"><label>Issue type</label><select id="d-mdisc-'+key+'"><option value="">Select</option><option>Marks not entered</option><option>Wrong marks entered</option><option>Viva marks missing</option><option>Group member marks differ</option><option>Other</option></select></div></div>';
  return '';
}

// LAB CHIPS
function toggleLabForType(chip, typeKey) {
  var lab = chip.dataset.lab, sel = labSelections[typeKey];
  if (!sel) return;
  if (sel.has(lab)) {
    sel.delete(lab); chip.classList.remove('active');
    var row = document.getElementById('lrow-'+typeKey+'-'+lab.split(' ').pop()); if(row) row.remove();
  } else {
    sel.add(lab); chip.classList.add('active');
    document.getElementById('err-labnum-'+typeKey).style.display = 'none';
    insertLabDetailRow(typeKey, lab);
  }
}
function insertLabDetailRow(typeKey, lab) {
  var n         = lab.split(' ').pop();
  var today     = new Date().toISOString().split('T')[0];
  var container = document.getElementById('lab-rows-'+typeKey);
  if (!container) return;
  var row = document.createElement('div');
  row.id = 'lrow-'+typeKey+'-'+n; row.className = 'lrow';
  var inner = '<span class="lrow-label">'+lab+'</span><div class="field"><label>Date <span class="req">*</span></label><input type="date" id="ldate-'+typeKey+'-'+n+'" max="'+today+'"/><span class="err" id="err-ldate-'+typeKey+'-'+n+'">Select date for '+lab+'.</span></div>';
  if(typeKey==='attendance') inner+='<div class="field"><label>Issue</label><select id="lissue-'+typeKey+'-'+n+'"><option value="">Select</option><option>Present but not marked</option><option>Marked absent by mistake</option><option>Late entry not counted</option><option>Portal not showing attendance</option><option>Other</option></select></div>';
  else if(typeKey==='marks') inner+='<div class="field"><label>Marks awarded</label><input type="number" id="lmawd-'+typeKey+'-'+n+'" min="0" max="100" placeholder="e.g. 7"/></div><div class="field"><label>Marks expected</label><input type="number" id="lmexp-'+typeKey+'-'+n+'" min="0" max="100" placeholder="e.g. 10"/></div><div class="field"><label>Discrepancy</label><select id="lmdisc-'+typeKey+'-'+n+'"><option value="">Select</option><option>Not entered in portal</option><option>Wrong marks entered</option><option>Partial despite complete work</option><option>Viva marks missing</option><option>Other</option></select></div>';
  row.innerHTML = inner;
  var existing = container.querySelectorAll('.lrow'), inserted = false;
  for (var i = 0; i < existing.length; i++) {
    if (parseInt(existing[i].id.split('-').pop()) > parseInt(n)) { container.insertBefore(row, existing[i]); inserted=true; break; }
  }
  if (!inserted) container.appendChild(row);
}

// SUBMIT — now JSONP-confirmed; attachment still goes via POST separately
function doSubmit() {
  if (document.getElementById('hp').value) return;
  if (!checkRate()) { document.getElementById('rate-err').style.display='block'; return; }
  var btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Submitting\u2026';
  var email = gv('email').trim().toLowerCase(), name = gv('name').trim(), roll = gv('roll').trim().toUpperCase(), section = gv('section');
  var sLbl  = (loadedCourse && loadedCourse.sessionLabel) || 'Session';
  var payloads = [], idx = 0;
  selectedTypes.forEach(function(key) {
    var t = ALL_TYPES[key];
    idx++;
    var labsSorted=[],labDateParts=[],labIssueParts=[],labMawdParts=[],labMexpParts=[],labMdiscParts=[];
    var extraDate='',marksAwarded='',marksExpected='',issue='',request='';
    if (t.needsLab) {
      var sel = labSelections[key] || new Set();
      labsSorted = Array.from(sel).sort(function(a,b){return parseInt(a.split(' ').pop())-parseInt(b.split(' ').pop());});
      labsSorted.forEach(function(lab) {
        var n = lab.split(' ').pop();
        var ld = gv('ldate-'+key+'-'+n); if(ld) labDateParts.push(lab+': '+ld);
        if(key==='attendance'){var iss=gv('lissue-'+key+'-'+n);if(iss)labIssueParts.push(lab+': '+iss);}
        else if(key==='marks'){var aw=gv('lmawd-'+key+'-'+n),ex=gv('lmexp-'+key+'-'+n),dc=gv('lmdisc-'+key+'-'+n);if(aw)labMawdParts.push(lab+': '+aw);if(ex)labMexpParts.push(lab+': '+ex);if(dc)labMdiscParts.push(lab+': '+dc);}
      });
      issue = key==='attendance' ? labIssueParts.join(' | ') : labMdiscParts.join(' | ');
      marksAwarded = labMawdParts.join(' | '); marksExpected = labMexpParts.join(' | ');
    } else {
      extraDate     = gv('d-assdate-'+key)||gv('d-findate-'+key)||gv('d-projdate-'+key)||'';
      marksAwarded  = gv('d-mawd-'+key)||'';
      marksExpected = gv('d-mexp-'+key)||'';
      issue         = gv('d-mdisc-'+key)||'';
      request       = gv('d-assno-'+key)||gv('d-finq-'+key)||gv('d-projt-'+key)||'';
    }
    payloads.push({ key:key, email:email, name:name, rollNumber:roll, section:section, labNumber:labsSorted.join(', '), labDate:labDateParts.join(' | '), queryType:key, description:gv('desc-'+key).trim(), extraDate:extraDate, marksAwarded:marksAwarded, marksExpected:marksExpected, issue:issue, request:request, isUrgent:isUrgent?'true':'false' });
  });

  submitAllJsonp(payloads, 0, [], email, name, roll, section);
}

function submitAllJsonp(payloads, i, refIds, email, name, roll, section) {
  if (i >= payloads.length) {
    // Attachment upload is fire-and-forget only if attachmentBase64 is set
    if (attachmentBase64 && refIds.length > 0) {
      gasPost({
        action: 'submit', referenceId: refIds[0],
        email: email, name: name, rollNumber: roll, section: section,
        queryType: payloads[0].key, description: payloads[0].description,
        attachmentName: attachmentFileName, attachmentData: attachmentBase64, attachmentMimeType: attachmentMimeType,
        isUrgent: payloads[0].isUrgent
      }).catch(function(){});
    }
    showSuccess(refIds, email, name, roll, section);
    return;
  }

  // Use JSONP GET — we get the actual referenceId back (confirmed)
  apiGetPublic('submitQuery', payloads[i])
    .then(function(d) {
      if (d.status === 'ok') {
        refIds.push(d.referenceId);
      } else if (d.status === 'duplicate') {
        refIds.push('[duplicate — not resubmitted]');
      } else {
        // Fall back to fire-and-forget POST if JSONP fails
        gasPost(Object.assign({ action:'submit' }, payloads[i])).catch(function(){});
        refIds.push('[submitted]');
      }
      submitAllJsonp(payloads, i+1, refIds, email, name, roll, section);
    })
    .catch(function() {
      gasPost(Object.assign({ action:'submit' }, payloads[i])).catch(function(){});
      refIds.push('[submitted]');
      submitAllJsonp(payloads, i+1, refIds, email, name, roll, section);
    });
}

function showSuccess(refIds, email, name, roll, section) {
  document.getElementById('main-card').style.display  = 'none';
  document.getElementById('success-card').style.display = 'block';
  document.getElementById('suc-msg').textContent = name+' ('+roll+') \u00b7 '+section+' \u2014 query recorded to '+email;
  document.getElementById('suc-refs').innerHTML = refIds.map(function(r){ return '<span class="ref-pill">'+esc(r)+'</span>'; }).join('');
  document.getElementById('submitBtn').disabled  = false;
  document.getElementById('submitBtn').innerHTML = 'Submit another query \u2192';
  document.getElementById('st-roll').value = roll;
  document.querySelector('.tracker-card').scrollIntoView({behavior:'smooth', block:'start'});
}

// ── STATUS TRACKER — OTP gated ─────────────────────────────────────
var OTP_STATE = 'idle'; // idle | sent | verified
var OTP_ROLL  = '';

var TYPE_BADGE = {attendance:'tb-att',marks:'tb-mrk',assignment:'tb-asg',final:'tb-fin',project:'tb-prj'};
var TYPE_LABEL = {attendance:'Attendance',marks:'Lab Marks',assignment:'Assignment',final:'Final Marks',project:'Project'};

function checkStatus() {
  var roll  = (gv('st-roll') || '').trim().toUpperCase();
  var errEl = document.getElementById('st-err');
  errEl.style.display = 'none';
  if (!roll || roll.length < 3) { errEl.textContent = 'Please enter your roll number.'; errEl.style.display = 'block'; return; }

  if (OTP_STATE === 'idle' || OTP_ROLL !== roll) {
    requestOtp(roll);
  } else if (OTP_STATE === 'sent') {
    verifyOtp(roll);
  }
}

function requestOtp(roll) {
  var list = document.getElementById('status-list');
  list.innerHTML = '<div class="tracker-empty">Sending verification code\u2026</div>';
  apiGetPublic('requestOtp', { rollNumber: roll })
    .then(function(d) {
      if (d.status === 'ok') {
        OTP_STATE = 'sent'; OTP_ROLL = roll;
        var otpRow = document.getElementById('otp-row');
        if (!otpRow) {
          otpRow = document.createElement('div');
          otpRow.id = 'otp-row';
          otpRow.className = 'tracker-search';
          otpRow.style.marginTop = '10px';
          otpRow.innerHTML = '<input type="text" id="st-otp" placeholder="6-digit code" maxlength="6" style="font-family:monospace;letter-spacing:.15em" onkeydown="if(event.key===\'Enter\')checkStatus()"/><button class="btn-primary" onclick="checkStatus()">Verify</button>';
          document.querySelector('.tracker-body').insertBefore(otpRow, list);
        } else { otpRow.style.display = 'flex'; }
        list.innerHTML = '<div class="tracker-empty" style="color:var(--g2)">A 6-digit code was sent to ' + esc(d.maskedEmail) + '.<br><span style="font-size:12px">Enter it above and click Verify.</span></div>';
      } else {
        list.innerHTML = '<div class="tracker-empty">' + esc(d.message || 'Could not send code. Check your roll number.') + '</div>';
      }
    })
    .catch(function() {
      list.innerHTML = '<div class="tracker-empty">Connection error. Please try again.</div>';
    });
}

function verifyOtp(roll) {
  var otp  = (gv('st-otp') || '').trim();
  var list = document.getElementById('status-list');
  if (!otp) { document.getElementById('st-err').textContent = 'Enter the 6-digit code.'; document.getElementById('st-err').style.display = 'block'; return; }
  list.innerHTML = '<div class="tracker-empty">Verifying\u2026</div>';
  apiGetPublic('checkStatus', { rollNumber: roll, otp: otp })
    .then(function(d) {
      if (d.status === 'ok') {
        OTP_STATE = 'idle';
        var otpRow = document.getElementById('otp-row'); if(otpRow) otpRow.style.display = 'none';
        renderStatusResults(d.rows);
      } else {
        list.innerHTML = '<div class="tracker-empty" style="color:var(--red)">' + esc(d.message || 'Verification failed.') + '</div>';
      }
    })
    .catch(function() {
      list.innerHTML = '<div class="tracker-empty">Connection error. Please try again.</div>';
    });
}

function renderStatusResults(rows) {
  var list = document.getElementById('status-list');
  if (!rows || rows.length === 0) {
    list.innerHTML = '<div class="tracker-empty">No queries found for this roll number.<br><span style="font-size:12px">Submit a query above and it will appear here.</span></div>';
    return;
  }
  var html = '';
  rows.forEach(function(r) {
    var st     = (r.status || 'Pending').trim();
    var stCls  = st==='Resolved'?'st-resolved':st==='Rejected'?'st-rejected':st==='Reviewing'?'st-review':'st-pending';
    var stIcon = st==='Resolved'?'\u2713':st==='Rejected'?'\u2717':st==='Reviewing'?'\uD83D\uDD0D':'\u23F3';
    var tCls   = TYPE_BADGE[r.queryType] || 'tb-att';
    var tLabel = TYPE_LABEL[r.queryType] || esc(r.queryType);
    html += '<div class="status-item"><div class="si-head"><span class="si-ref">'+esc(r.referenceId)+'</span><span class="dyn-badge '+tCls+'" style="font-size:10px;padding:2px 8px">'+tLabel+'</span>'+(r.labNumber?'<span class="si-lab">'+esc(r.labNumber)+'</span>':'')+'<span class="si-ts">'+esc(r.timestamp)+'</span></div><div class="si-body"><span class="status-badge '+stCls+'">'+stIcon+' '+esc(st)+'</span>'+(r.notes?'<div class="instructor-note"><strong>Instructor comment: </strong>'+esc(r.notes)+'</div>':'')+'</div></div>';
  });
  list.innerHTML = html;
}

// SETTINGS — load from API, apply branding dynamically
function loadSettings() {
  loadedSettings = { attendance:true, marks:true, assignment:true, final:true, project:true };
  renderQueryCards();
  apiGetPublic('getCourseSettings')
    .then(function(d) {
      if (d.status === 'ok') {
        if (d.settings) { loadedSettings = d.settings; }
        if (d.course)   { loadedCourse   = d.course; applyCourseBranding(d.course); }
        renderQueryCards();
        Object.keys(ALL_TYPES).forEach(function(k){
          if (loadedSettings && !loadedSettings[k] && selectedTypes.has(k)) toggleType(k);
        });
      }
    })
    .catch(function() {});
}

function applyCourseBranding(c) {
  // Header text
  var h1  = document.querySelector('.card-head h1');
  var sub = document.querySelector('.card-head p');
  if (h1)  h1.textContent  = c.courseName || 'QueryDesk';
  if (sub) sub.textContent = 'Student Query Submission \u00b7 ' + (c.term || '');

  // Section badges
  var badges = document.querySelectorAll('.head-badge');
  if (badges.length >= 2 && c.sections) badges[1].textContent = c.sections.join(' \u00b7 ');

  // University top-bar
  var uniEl = document.querySelector('.top-bar .uni');
  if (uniEl) uniEl.textContent = c.universityName || '';

  // Section dropdown
  var sel = document.getElementById('section');
  if (sel && c.sections && c.sections.length) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">Select your section</option>';
    c.sections.forEach(function(s) {
      var o = document.createElement('option'); o.textContent = s; o.value = s;
      if (s === cur) o.selected = true;
      sel.appendChild(o);
    });
  }

  // Email validation from emailDomain
  var domain = (c.emailDomain || '').trim().toLowerCase();
  if (domain) {
    var esc2 = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    EMAIL_RE  = new RegExp('^[^\\s@]+@' + esc2 + '$', 'i');
    var hint  = document.querySelector('#f-email .hint');
    if (hint) hint.textContent = 'Must use your university email ending in @' + domain;
    var ph    = document.getElementById('email');
    if (ph)   ph.placeholder = 'yourname@' + domain;
  }

  // Roll format from rollFormat (regex string)
  if (c.rollFormat) {
    try { ROLL_RE = new RegExp(c.rollFormat); } catch(e) {}
    var rHint = document.querySelector('#f-roll .hint');
    if (rHint) rHint.textContent = 'Format: ' + c.rollFormat;
  }

  // Announcement banner
  var banner = document.getElementById('announce-banner');
  if (banner) {
    if (c.announcement) {
      document.getElementById('announce-text').textContent = c.announcement;
      banner.style.display = 'flex';
    } else { banner.style.display = 'none'; }
  }

  // Submission open/closed
  var mc = document.getElementById('main-card');
  var cc = document.getElementById('closed-card');
  if (mc && cc) {
    var open = c.submissionOpen !== false;
    mc.style.display = open ? '' : 'none';
    cc.style.display = open ? 'none' : '';
    if (!open && c.closedMessage) {
      var cm = document.getElementById('closed-msg');
      if (cm) cm.textContent = c.closedMessage;
    }
  }
}

// FILE ATTACHMENT (unchanged)
function showFile(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { alert('File too large. Maximum size is 5 MB.'); input.value=''; return; }
  document.getElementById('file-label').textContent = file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)';
  attachmentFileName = file.name; attachmentMimeType = file.type; attachmentReading = true;
  var reader = new FileReader();
  reader.onload = function(e) {
    var b64Full = e.target.result;
    attachmentBase64 = b64Full.indexOf(',') !== -1 ? b64Full.split(',')[1] : b64Full;
    attachmentReading = false;
  };
  reader.onerror = function() { attachmentReading = false; };
  reader.readAsDataURL(file);
}

// RATE LIMIT
var _submitLog = [];
function checkRate() {
  var now  = Date.now();
  _submitLog = _submitLog.filter(function(t){ return now - t < 3600000; });
  if (_submitLog.length >= MAX_PER_HOUR) return false;
  _submitLog.push(now); return true;
}

function updateCounter(key, len) {
  var el = document.getElementById('cnt-'+key);
  if (el) el.textContent = len + '\u202F/\u202F15\u00a0min';
}

function resetForm() {
  location.reload();
}

// ── Offline detection ──────────────────────────────────────────────
window.addEventListener('online',  function() { document.getElementById('offline-banner').style.display='none'; });
window.addEventListener('offline', function() { document.getElementById('offline-banner').style.display='block'; });
