// ═══════════════════════════════════════════════════════════════════
//  QueryDesk — DriveUtils.gs
//  Google Drive attachment upload helpers
// ═══════════════════════════════════════════════════════════════════

var ALLOWED_MIMES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
];

// Uploads a base64-encoded attachment to the shared Drive folder.
// Returns the Drive share URL, a REJECTED string, an ERROR string, or '' if no file.
function uploadAttachment(data) {
  if (!data.attachmentData || !data.attachmentName) return '';
  try {
    var mimeType = (data.attachmentMimeType || '').toLowerCase().split(';')[0].trim();
    if (ALLOWED_MIMES.indexOf(mimeType) === -1) {
      return 'REJECTED: disallowed file type (' + mimeType + ')';
    }
    var folderName = 'ML Lab Query Attachments';
    var folders    = DriveApp.getFoldersByName(folderName);
    var folder     = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var bytes      = Utilities.base64Decode(data.attachmentData);
    var blob       = Utilities.newBlob(
                       bytes,
                       mimeType || 'application/octet-stream',
                       (data.referenceId || 'file') + '_' + data.attachmentName
                     );
    var driveFile  = folder.createFile(blob);
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return driveFile.getUrl();
  } catch (err) {
    console.log('Drive upload error: ' + err.toString());
    return 'ERROR: ' + err.message;
  }
}

// ── TEST: select this function in the GAS editor and click ▶ Run ──
// View → Execution log should show SUCCESS or a specific error.
function testDriveUpload() {
  try {
    var folderName = 'ML Lab Query Attachments';
    var folders    = DriveApp.getFoldersByName(folderName);
    var folder     = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var blob       = Utilities.newBlob('test content', 'text/plain', 'test_attachment.txt');
    var driveFile  = folder.createFile(blob);
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    console.log('SUCCESS — Drive upload works. URL: ' + driveFile.getUrl());
    driveFile.setTrashed(true);
    console.log('Test file deleted.');
  } catch (err) {
    console.log('FAILED — ' + err.toString());
    console.log('Fix: re-deploy as new version and re-grant DriveApp permission.');
  }
}
