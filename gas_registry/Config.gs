// ═══════════════════════════════════════════════════════════════════
//  QueryDesk Registry — Config.gs
//
//  This is a SEPARATE GAS project from individual course deployments.
//  Deploy it once per institution using gas_registry/ files only.
//
//  Script Properties to set (Project Settings → Script Properties):
//    REGISTRY_ADMIN_PASSWORD — password for approve/remove actions
//    REGISTRY_EMAIL          — notified by email on new registrations
//    AUTO_APPROVE            — set 'true' to skip manual approval step
// ═══════════════════════════════════════════════════════════════════

var REGISTRY_ADMIN_PASSWORD = PropertiesService.getScriptProperties().getProperty('REGISTRY_ADMIN_PASSWORD') || '';
var AUTO_APPROVE            = (PropertiesService.getScriptProperties().getProperty('AUTO_APPROVE') || 'false') === 'true';
var REGISTRY_EMAIL          = PropertiesService.getScriptProperties().getProperty('REGISTRY_EMAIL') || '';

var REG_SHEET = 'Courses';
var REG_COLS  = [
  'Timestamp', 'CourseName', 'InstructorName', 'Dept', 'Term',
  'Sections', 'GasUrl', 'University', 'ContactEmail', 'Approved'
];

function regCors(output) {
  return output
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET,POST')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function regRespond(obj, cb) {
  var json = JSON.stringify(obj);
  if (cb) {
    return regCors(
      ContentService.createTextOutput(cb + '(' + json + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT)
    );
  }
  return regCors(
    ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON)
  );
}
