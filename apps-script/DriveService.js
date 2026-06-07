function getReportFolder() {
  var folderId = getOutputFolderId();
  if (!folderId) {
    var folder = DriveApp.createFolder('BMRX Productivity Reports');
    PropertiesService.getScriptProperties().setProperty('REPORT_OUTPUT_FOLDER_ID', folder.getId());
    return folder;
  }
  return DriveApp.getFolderById(folderId);
}

function saveFile(blob, filename) {
  var folder = getReportFolder();
  var file = folder.createFile(blob);
  if (filename) {
    file.setName(filename);
  }
  return file;
}
