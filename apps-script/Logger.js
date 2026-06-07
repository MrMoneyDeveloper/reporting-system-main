function generateRunId() {
  return Utilities.formatDate(new Date(), getReportTimezone_(), 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 8);
}

function logRun(run) {
  var row = [
    run.runId || generateRunId(),
    run.reportType || '',
    run.startedAt || '',
    run.endedAt || new Date(),
    run.status || '',
    run.rowsProcessed || 0,
    run.fileLink || '',
    run.emailSent === true ? 'TRUE' : run.emailSent === false ? 'FALSE' : ''
  ];

  safeAppendLogRows_(SHEET_NAMES.RUN_LOG, [row]);
  return row[0];
}

function logError(functionName, error, status, retryCount) {
  var errorObject = error || {};
  var message = compactLogMessage_(errorObject.message || String(errorObject));
  var errorType = errorObject.name || 'Error';

  safeAppendLogRows_(SHEET_NAMES.ERROR_LOG, [[
    new Date(),
    functionName || '',
    errorType,
    message,
    status || 'OPEN',
    retryCount || 0
  ]]);

  safeLogPipelineEvent_({
    phase: functionName || 'Error',
    status: status || 'ERROR',
    message: errorType + ': ' + message
  });
}

function logPipelineEvent_(event) {
  safeLogPipelineEvent_(event);
}

function safeLogPipelineEvent_(event) {
  var pipelineEvent = event || {};
  var windowInfo = pipelineEvent.window || {};
  var message = compactLogMessage_(pipelineEvent.message || '');

  safeAppendLogRows_(SHEET_NAMES.PIPELINE_LOG, [[
    new Date(),
    pipelineEvent.runId || '',
    pipelineEvent.reportType || '',
    pipelineEvent.phase || '',
    pipelineEvent.status || '',
    message,
    pipelineEvent.agentIndex === 0 || pipelineEvent.agentIndex ? pipelineEvent.agentIndex : '',
    pipelineEvent.totalAgents === 0 || pipelineEvent.totalAgents ? pipelineEvent.totalAgents : '',
    pipelineEvent.rowsProcessed === 0 || pipelineEvent.rowsProcessed ? pipelineEvent.rowsProcessed : '',
    safeFormatLogDate_(windowInfo.startDate || pipelineEvent.startDate),
    safeFormatLogDate_(windowInfo.endDate || pipelineEvent.endDate)
  ]]);
}

function safeAppendLogRows_(sheetName, rows) {
  if (!rows || rows.length === 0) {
    return 0;
  }

  var lock = LockService.getScriptLock();
  var locked = false;

  try {
    locked = lock.tryLock(5000);
    var spreadsheet = getLogSpreadsheet_();
    var headers = SHEET_HEADERS[sheetName] || [];
    var sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
      HEADER_VALIDATION_CACHE_[sheetName] = false;
    }

    if (!HEADER_VALIDATION_CACHE_[sheetName]) {
      ensureHeaders_(sheet, headers);
      HEADER_VALIDATION_CACHE_[sheetName] = true;
    }
    var width = Math.max(headers.length, rows[0].length || 0);
    var normalizedRows = normalizeRowWidth_(compactLogRows_(rows), width);
    sheet.getRange(sheet.getLastRow() + 1, 1, normalizedRows.length, width).setValues(normalizedRows);
    return normalizedRows.length;
  } catch (error) {
    consoleFallbackLog_(sheetName, rows, error);
    return 0;
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

function compactLogRows_(rows) {
  var output = [];
  for (var i = 0; i < rows.length; i++) {
    var row = [];
    for (var j = 0; j < rows[i].length; j++) {
      row.push(typeof rows[i][j] === 'string' ? compactLogMessage_(rows[i][j]) : rows[i][j]);
    }
    output.push(row);
  }
  return output;
}

function compactLogMessage_(value) {
  var text = String(value || '');
  if (!text) {
    return '';
  }

  text = text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 800) {
    return text.slice(0, 797) + '...';
  }
  return text;
}

function getLogSpreadsheet_() {
  var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    return activeSpreadsheet;
  }

  var spreadsheetId = getSpreadsheetId_();
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  return getSpreadsheet();
}

function consoleFallbackLog_(sheetName, rows, error) {
  try {
    Logger.log('Failed to write ' + sheetName + ': ' + (error && error.message ? error.message : error));
    Logger.log(JSON.stringify(rows || []));
  } catch (ignored) {
    // Nothing else is safe to do here.
  }
}

function safeFormatLogDate_(value) {
  if (!value) {
    return '';
  }

  try {
    return formatDateTime_(value);
  } catch (error) {
    return String(value || '');
  }
}

function repairLogSheets() {
  var sheets = [
    SHEET_NAMES.PIPELINE_LOG,
    SHEET_NAMES.RUN_LOG,
    SHEET_NAMES.ERROR_LOG
  ];
  var repaired = [];

  for (var i = 0; i < sheets.length; i++) {
    var sheet = ensureSheet(sheets[i], SHEET_HEADERS[sheets[i]]);
    repaired.push({
      sheet: sheets[i],
      rows: sheet.getLastRow(),
      columns: sheet.getLastColumn()
    });
  }

  var runId = generateRunId();
  logRun({
    runId: runId,
    reportType: 'Logging Repair',
    startedAt: new Date(),
    endedAt: new Date(),
    status: 'SUCCESS',
    rowsProcessed: repaired.length,
    emailSent: false
  });
  safeLogPipelineEvent_({
    runId: runId,
    reportType: 'Logging Repair',
    phase: 'logging',
    status: 'SUCCESS',
    message: 'Run Log, Error Log, and Pipeline Log were repaired and tested.',
    rowsProcessed: repaired.length
  });
  logError('repairLogSheets', new Error('Test error row. Logging is working.'), 'TEST', 0);

  return {
    status: 'SUCCESS',
    repaired: repaired
  };
}
