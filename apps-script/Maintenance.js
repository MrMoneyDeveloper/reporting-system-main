function trashDuplicateAppsScriptProjects() {
  var duplicates = [
    '1v-yg9MfJ-gVRCDTMbKPA_5SY3HJTy4p8Ftg2u1GMJjfRUtwdP80xd1MB',
    '1X_MUMxZd0jlAtYeYsuHlvG2T5-n5m0hd3_Bv7OVGfLQ'
  ];
  var protectedIds = {};
  protectedIds[ScriptApp.getScriptId()] = true;
  protectedIds[getSpreadsheetId_()] = true;

  var results = [];
  for (var i = 0; i < duplicates.length; i++) {
    var id = duplicates[i];
    if (!id || protectedIds[id]) {
      results.push({ id: id, status: 'SKIPPED_PROTECTED' });
      continue;
    }

    try {
      var file = DriveApp.getFileById(id);
      file.setTrashed(true);
      results.push({ id: id, name: file.getName(), status: 'TRASHED' });
    } catch (error) {
      results.push({ id: id, status: 'FAILED', message: error.message });
    }
  }

  logPipelineEvent_({
    phase: 'maintenance',
    status: 'DUPLICATE_CLEANUP',
    message: JSON.stringify(results)
  });

  return results;
}
