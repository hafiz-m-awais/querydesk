// ═══════════════════════════════════════════════════════════════════
//  QueryDesk — Config.gs
//  Shared constants, defaults, and response helpers.
//  All other .gs files in this project depend on these globals.
// ═══════════════════════════════════════════════════════════════════

// ── Script Properties (set once: GAS editor → Project Settings → Script Properties) ──
var ADMIN_PASSWORD   = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD')   || '';
var INSTRUCTOR_EMAIL = PropertiesService.getScriptProperties().getProperty('INSTRUCTOR_EMAIL') || '';
var SHEET_NAME       = 'Queries';

// ── Default query-type enable/disable state ────────────────────────
var DEFAULT_SETTINGS = {
  attendance:  true,
  marks:       true,
  assignment:  true,
  final:       true,
  project:     true
};

// ── Default course configuration ───────────────────────────────────
var DEFAULT_COURSE_SETTINGS = {
  courseName:     'ML for Business Analytics',
  isLab:          true,
  sessionCount:   14,
  sessionLabel:   'Lab',
  sections:       ['BSBA-6A', 'BSBA-6B', 'MSBA'],
  term:           'Spring 2026',
  instructorName: '',
  emailDomain:    'nu.edu.pk',
  submissionOpen: true,
  closedMessage:  '',
  announcement:   '',
  universityName: 'FAST-NUCES \u00b7 Islamabad',
  rollFormat:     '\\d{2}[IKik]-\\d{4}'
};

// ── Sheet column headers (19 columns) ─────────────────────────────
var HEADERS = [
  'Reference ID', 'Timestamp', 'Email', 'Name', 'Roll Number',
  'Section', 'Lab Number', 'Lab Date', 'Query Type', 'Description',
  'Extra Date', 'Marks Awarded', 'Marks Expected', 'Issue / Reason',
  'Request Type', 'Status', 'Instructor Notes', 'Attachment URL', 'Urgent'
];

// ── CORS response helper ───────────────────────────────────────────
function cors(output) {
  return output
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET,POST')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Unified JSON / JSONP response helper ───────────────────────────
function gasRespond(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return cors(ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON));
}
