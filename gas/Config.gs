// ═══════════════════════════════════════════════════════════════════
//  QueryDesk v2 — Config.gs
//  Token-based session auth, shared constants, response helpers.
// ═══════════════════════════════════════════════════════════════════

// ── Script Properties (set once in GAS editor → Project Settings) ─
//   ADMIN_PASSWORD   — instructor admin password
//   INSTRUCTOR_EMAIL — notification email address
var ADMIN_PASSWORD   = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD')   || '';
var INSTRUCTOR_EMAIL = PropertiesService.getScriptProperties().getProperty('INSTRUCTOR_EMAIL') || '';
var SHEET_NAME       = 'Queries';

// ── Session tokens (CacheService, 8-hour TTL) ─────────────────────
// Password is verified ONCE at login; all subsequent requests use a
// short-lived random token stored server-side in the script cache.
var TOKEN_TTL = 28800; // 8 hours in seconds

function generateToken() {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('qd_tok_' + token, '1', TOKEN_TTL);
  return token;
}
function validateToken(token) {
  if (!token) return false;
  return !!CacheService.getScriptCache().get('qd_tok_' + token);
}
function invalidateToken(token) {
  if (token) CacheService.getScriptCache().remove('qd_tok_' + token);
}

// ── Default query-type toggles ────────────────────────────────────
var DEFAULT_SETTINGS = {
  attendance: true, marks: true, assignment: true, final: true, project: true
};

// ── Default course configuration (first-run fallback) ─────────────
var DEFAULT_COURSE_SETTINGS = {
  courseName:     '',
  isLab:          false,
  sessionCount:   14,
  sessionLabel:   'Session',
  sections:       [],
  term:           '',
  instructorName: '',
  emailDomain:    '',
  submissionOpen: true,
  closedMessage:  '',
  announcement:   '',
  universityName: '',
  rollFormat:     ''
};

// ── Sheet column headers (19 columns) ─────────────────────────────
var HEADERS = [
  'Reference ID', 'Timestamp', 'Email', 'Name', 'Roll Number',
  'Section', 'Session Number', 'Session Date', 'Query Type', 'Description',
  'Extra Date', 'Marks Awarded', 'Marks Expected', 'Issue / Reason',
  'Request Type', 'Status', 'Instructor Notes', 'Attachment URL', 'Urgent'
];

// ── CORS + response helpers ────────────────────────────────────────
function cors(output) {
  return output
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET,POST')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function gasRespond(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return cors(ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON));
}
