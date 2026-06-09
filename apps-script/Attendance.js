function readAttendance(startDate, endDate) {
  var rows = getSheetData(SHEET_NAMES.RAW_ATTENDANCE);
  var start = dateOnly_(startDate);
  var end = dateOnly_(endDate);
  var output = [];

  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].Date) {
      continue;
    }

    var rowDate = dateOnly_(rows[i].Date);
    if (rowDate.getTime() >= start.getTime() && rowDate.getTime() < end.getTime()) {
      output.push(rows[i]);
    }
  }

  return output;
}

function syncAttendanceFromSource(startDate, endDate) {
  return syncAttendanceFromSourceDetailed_(startDate, endDate).rowsWritten;
}

function repairRawAttendanceFromSource_(referenceDate) {
  setupProject();
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();
  var startDate = getHistoricalSourceStart_();
  var endDate = getOperationalDayWindow(reference).endDate;
  var result = syncAttendanceFromSourceDetailed_(startDate, endDate);
  var currentWindow = getCurrentOpenOperationalDayWindow_(reference);

  if (result.status === 'SUCCESS') {
    if (typeof refreshAnalyticsForDateRange_ === 'function') {
      result.analyticsRefresh = refreshAnalyticsForDateRange_(startDate, endDate, {
        rebuildRollups: true,
        log: true
      });
    }

    var finalRows = buildFinalReportDataset('daily', currentWindow.startDate, currentWindow.endDate);
    result.currentReportRows = finalRows.length;
    if (typeof clearDashboardCache_ === 'function') {
      clearDashboardCache_();
    }
    logAttendanceRepairDiagnostics_(result.statusChanges || []);
  }

  logPipelineEvent_({
    reportType: 'Attendance Repair',
    phase: 'attendance',
    status: result.status || 'SUCCESS',
    message: 'Raw Attendance repair: source=' + result.sourceRows +
      ', mapped=' + result.mappedRows +
      ', filtered=' + result.filteredRows +
      ', active=' + result.activeRows +
      ', unmatched=' + result.unmatchedRows +
      ', removed=' + (result.rowsRemoved || 0) +
      ', wrote=' + result.rowsWritten +
      ', status changes=' + (result.statusChanges ? result.statusChanges.length : 0) +
      ', current report rows=' + (result.currentReportRows || 0) + '. ' + (result.message || ''),
    rowsProcessed: result.rowsWritten || 0,
    startDate: startDate,
    endDate: endDate
  });

  return result;
}

function syncAttendanceFromSourceDetailed_(startDate, endDate) {
  var result = {
    status: 'SKIPPED',
    sourceRows: 0,
    mappedRows: 0,
    filteredRows: 0,
    activeRows: 0,
    unmatchedRows: 0,
    rowsRemoved: 0,
    rowsWritten: 0,
    statusChanges: [],
    message: ''
  };

  if (!toBoolean_(getConfigValue('ATTENDANCE_SYNC_ENABLED', 'TRUE'))) {
    result.message = 'ATTENDANCE_SYNC_ENABLED is not TRUE.';
    return result;
  }

  var spreadsheetId = getAttendanceSpreadsheetId_();
  if (!spreadsheetId) {
    result.status = 'FAILED';
    result.message = 'ATTENDANCE_SPREADSHEET_ID is not configured.';
    return result;
  }

  try {
    var sourceRows = readAttendanceSourceRows_(spreadsheetId, startDate, endDate);
    var mappedRows = mapAttendanceSourceRows_(sourceRows, startDate, endDate);
    var filteredRows = filterAttendanceRawRowsForWindow_(mappedRows, startDate, endDate);
    var activeResult = filterAttendanceRowsToActiveAgents_(filteredRows);
    var upsertResult = {
      rowsRemoved: 0,
      rowsWritten: 0,
      statusChanges: []
    };
    if (activeResult.rows.length > 0) {
      upsertResult = upsertAttendanceRawRowsForWindow_(activeResult.rows, startDate, endDate);
    }

    result.status = 'SUCCESS';
    result.sourceRows = sourceRows.length;
    result.mappedRows = mappedRows.length;
    result.filteredRows = filteredRows.length;
    result.activeRows = activeResult.rows.length;
    result.unmatchedRows = activeResult.unmatchedRows;
    result.rowsRemoved = upsertResult.rowsRemoved;
    result.rowsWritten = upsertResult.rowsWritten;
    result.statusChanges = upsertResult.statusChanges;
    result.message = activeResult.rows.length > 0
      ? 'Attendance source sync completed with window upsert.'
      : 'Attendance source sync completed with no active rows to upsert.';
    if (sourceRows.length > 0 && mappedRows.length > 0 && filteredRows.length === 0) {
      result.message += ' ' + buildAttendanceNoMatchDebugMessage_(sourceRows, mappedRows, startDate, endDate);
    }
    return result;
  } catch (error) {
    logError('syncAttendanceFromSource', error, 'FAILED_CONTINUED', 0);
    result.status = 'FAILED';
    result.message = error.message;
    return result;
  }
}

function filterAttendanceRowsToActiveAgents_(rows) {
  var agentMap = getAgentEmailMap();
  var output = [];
  var unmatchedRows = 0;

  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i];
    var email = normalizeEmail_(row[3]);
    if (!email || !agentMap[email]) {
      unmatchedRows++;
      continue;
    }
    output.push(row);
  }

  return {
    rows: output,
    unmatchedRows: unmatchedRows
  };
}

function testAttendanceSourceConnection() {
  var spreadsheetId = getAttendanceSpreadsheetId_();
  if (!spreadsheetId) {
    throw new Error('Missing ATTENDANCE_SPREADSHEET_ID Script Property.');
  }

  var windowInfo = getOperationalDayWindow(new Date());
  var sourceRows = readAttendanceSourceRows_(spreadsheetId, windowInfo.startDate, windowInfo.endDate);
  var firstRow = sourceRows.length ? sourceRows[0] : {};

  return {
    status: 'OK',
    spreadsheetId: spreadsheetId,
    sourceRows: sourceRows.length,
    headers: Object.keys(firstRow),
    mappedSample: sourceRows.length ? mapAttendanceSourceRows_([firstRow], windowInfo.startDate, windowInfo.endDate)[0] : []
  };
}

function inspectAttendanceSource(referenceDate) {
  var spreadsheetId = getAttendanceSpreadsheetId_();
  if (!spreadsheetId) {
    throw new Error('Missing ATTENDANCE_SPREADSHEET_ID Script Property.');
  }

  var windowInfo = getReportWindow('monthly', referenceDate || new Date());
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheets = getAttendanceSourceSheets_(spreadsheet, windowInfo.startDate, windowInfo.endDate);
  var output = [];

  for (var i = 0; i < sheets.length; i++) {
    output.push(inspectAttendanceSheet_(sheets[i]));
  }

  var result = {
    status: 'OK',
    spreadsheetId: spreadsheetId,
    window: windowInfo.periodLabel,
    startDate: windowInfo.startDate,
    endDate: windowInfo.endDate,
    tabs: output
  };
  logAttendanceInspection_(result);
  return result;
}

function readAttendanceSourceRows_(spreadsheetId, startDate, endDate) {
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheets = getAttendanceSourceSheets_(spreadsheet, startDate, endDate);
  var records = [];

  for (var i = 0; i < sheets.length; i++) {
    records = records.concat(readAttendanceSheetRecords_(sheets[i]));
  }

  return records;
}

function getAttendanceSourceSheets_(spreadsheet, startDate, endDate) {
  var configuredNames = String(getConfigValue('ATTENDANCE_SHEET_NAME', '') || '').trim();
  if (configuredNames) {
    var configuredSheets = [];
    var names = configuredNames.split(',').map(function (name) {
      return name.trim();
    }).filter(function (name) {
      return name;
    });

    for (var i = 0; i < names.length; i++) {
      var configuredSheet = spreadsheet.getSheetByName(names[i]);
      if (!configuredSheet) {
        throw new Error('Attendance source sheet not found: ' + names[i]);
      }
      configuredSheets.push(configuredSheet);
    }

    return configuredSheets;
  }

  var allSheets = spreadsheet.getSheets();
  var matchedSheets = [];
  var fallbackSheets = [];

  for (var j = 0; j < allSheets.length; j++) {
    var sheet = allSheets[j];
    if (typeof sheet.isSheetHidden === 'function' && sheet.isSheetHidden()) {
      continue;
    }

    if (attendanceSheetNameMatchesWindow_(sheet.getName(), startDate, endDate)) {
      matchedSheets.push(sheet);
    } else {
      fallbackSheets.push(sheet);
    }
  }

  return matchedSheets.length ? matchedSheets : fallbackSheets;
}

function readAttendanceSheetRecords_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return [];
  }

  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headerInfo = detectAttendanceHeaderRow_(values);
  if (!headerInfo) {
    return [];
  }

  if (isAttendanceMatrixHeader_(headerInfo.headers)) {
    return attendanceMatrixRecordsFromValues_(values, headerInfo, sheet.getName());
  }

  return attendanceRecordsFromValues_(values, headerInfo.rowIndex, headerInfo.headers, sheet.getName());
}

function inspectAttendanceSheet_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return {
      tab: sheet.getName(),
      rows: lastRow,
      columns: lastColumn,
      status: 'EMPTY'
    };
  }

  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headerInfo = detectAttendanceHeaderRow_(values);
  var isMatrix = headerInfo ? isAttendanceMatrixHeader_(headerInfo.headers) : false;
  var records = headerInfo
    ? (isMatrix
      ? attendanceMatrixRecordsFromValues_(values, headerInfo, sheet.getName())
      : attendanceRecordsFromValues_(values, headerInfo.rowIndex, headerInfo.headers, sheet.getName()))
    : [];

  return {
    tab: sheet.getName(),
    rows: lastRow,
    columns: lastColumn,
    mode: isMatrix ? 'MATRIX' : 'TABLE',
    detectedHeaderRow: headerInfo ? headerInfo.rowIndex + 1 : '',
    headers: headerInfo ? headerInfo.headers : [],
    sampleRecord: records.length ? records[0] : {},
    mappedSample: records.length ? mapAttendanceSourceRows_([records[0]])[0] : [],
    mappedSamples: records.length ? mapAttendanceSourceRows_(records.slice(0, 3)) : []
  };
}

function logAttendanceInspection_(result) {
  var tabs = result.tabs || [];
  logPipelineEvent_({
    reportType: 'Attendance Source Inspect',
    phase: 'attendance-inspect',
    status: 'SUMMARY',
    message: 'Attendance source inspect: spreadsheet=' + result.spreadsheetId + ', window=' + result.window + ', tabs=' + tabs.length + '.',
    startDate: result.startDate,
    endDate: result.endDate
  });

  var maxTabsToLog = Math.min(tabs.length, 12);
  for (var i = 0; i < maxTabsToLog; i++) {
    var tab = tabs[i];
    var sample = tab.mappedSamples && tab.mappedSamples.length ? tab.mappedSamples[0] : tab.mappedSample;
    logPipelineEvent_({
      reportType: 'Attendance Source Inspect',
      phase: 'attendance-inspect',
      status: tab.status || 'TAB',
      message: buildAttendanceInspectTabMessage_(tab, sample)
    });
  }

  if (tabs.length > maxTabsToLog) {
    logPipelineEvent_({
      reportType: 'Attendance Source Inspect',
      phase: 'attendance-inspect',
      status: 'TRUNCATED',
      message: 'Only logged first ' + maxTabsToLog + ' attendance source tabs out of ' + tabs.length + '.'
    });
  }
}

function buildAttendanceInspectTabMessage_(tab, sample) {
  var headers = (tab.headers || []).filter(function (header) {
    return String(header || '').trim();
  }).slice(0, 12).join(', ');
  var mapped = sample || [];

  return 'Tab "' + tab.tab + '": rows=' + tab.rows +
    ', columns=' + tab.columns +
    ', mode=' + (tab.mode || 'unknown') +
    ', headerRow=' + (tab.detectedHeaderRow || 'not detected') +
    ', headers=' + (headers || 'none') +
    ', sampleDate=' + safeAttendanceDateLabel_(mapped[0]) +
    ', sampleShift=' + safeAttendanceText_(mapped[1]) +
    ', sampleName=' + safeAttendanceText_(mapped[2]) +
    ', sampleEmail=' + safeAttendanceText_(mapped[3]) +
    ', sampleStatus=' + safeAttendanceText_(mapped[4]) + '.';
}

function buildAttendanceNoMatchDebugMessage_(sourceRows, mappedRows, startDate, endDate) {
  return 'No mapped attendance rows matched window ' +
    formatDateTime_(startDate) + ' to ' + formatDateTime_(endDate) +
    '. Sample mapped dates=' + getAttendanceSampleDateLabels_(mappedRows, 6).join(', ') +
    '; source tabs=' + getAttendanceSourceTabLabels_(sourceRows, 6).join(', ') + '.';
}

function getAttendanceSampleDateLabels_(mappedRows, limit) {
  var seen = {};
  var output = [];
  var blankCount = 0;

  for (var i = 0; i < mappedRows.length; i++) {
    var label = safeAttendanceDateLabel_(mappedRows[i][0]);
    if (label === '(blank)') {
      blankCount += 1;
    }
    if (!seen[label]) {
      seen[label] = true;
      output.push(label);
    }
    if (output.length >= limit) {
      break;
    }
  }

  if (blankCount > 0 && !seen['(blank x' + blankCount + ')']) {
    output.push('(blank x' + blankCount + ')');
  }

  return output.length ? output : ['none'];
}

function getAttendanceSourceTabLabels_(sourceRows, limit) {
  var seen = {};
  var output = [];

  for (var i = 0; i < sourceRows.length; i++) {
    var label = String(sourceRows[i]._SourceSheet || 'unknown');
    if (seen[label]) {
      continue;
    }
    seen[label] = true;
    output.push(label);
    if (output.length >= limit) {
      break;
    }
  }

  return output.length ? output : ['unknown'];
}

function safeAttendanceDateLabel_(value) {
  if (!value) {
    return '(blank)';
  }

  try {
    return dateKey_(value);
  } catch (error) {
    return safeAttendanceText_(value);
  }
}

function safeAttendanceText_(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return '(blank)';
  }

  if (value instanceof Date) {
    try {
      return formatDateTime_(value);
    } catch (error) {
      return String(value);
    }
  }

  var text = String(value);
  return text.length > 80 ? text.slice(0, 77) + '...' : text;
}

function isAttendanceMatrixHeader_(headers) {
  var hasAgentName = false;
  var hasShift = false;
  var attendanceColumnCount = 0;

  for (var i = 0; i < (headers || []).length; i++) {
    var key = normalizeKey_(headers[i]);
    if (key === 'agentname' || key === 'agent' || key === 'name' || key === 'employee' || key === 'staffmember') {
      hasAgentName = true;
    }
    if (key === 'shift') {
      hasShift = true;
    }
    if (isAttendanceMatrixStatusColumnKey_(key)) {
      attendanceColumnCount += 1;
    }
  }

  return hasAgentName && hasShift && attendanceColumnCount >= 2;
}

function attendanceMatrixRecordsFromValues_(values, headerInfo, sheetName) {
  var headers = headerInfo.headers || [];
  var headerRowIndex = headerInfo.rowIndex;
  var matrixColumns = getAttendanceMatrixColumns_(headers, values, headerRowIndex, sheetName);
  var agentNameIndex = findAttendanceHeaderIndex_(headers, ['agentname', 'agent', 'name', 'employee', 'staffmember']);
  var shiftIndex = findAttendanceHeaderIndex_(headers, ['shift']);
  var emailIndex = findAttendanceHeaderIndex_(headers, ['email', 'agentemail', 'emailaddress', 'workemail']);
  var agentNameMap = buildAttendanceAgentNameMap_();
  var records = [];

  if (agentNameIndex < 0 || matrixColumns.length === 0) {
    return records;
  }

  for (var rowIndex = headerRowIndex + 1; rowIndex < values.length; rowIndex++) {
    var row = values[rowIndex];
    if (!rowHasValue_(row)) {
      continue;
    }

    var agentName = String(row[agentNameIndex] || '').trim();
    if (!agentName) {
      continue;
    }

    var agent = agentNameMap[normalizeKey_(agentName)] || null;
    var email = emailIndex >= 0 ? normalizeEmail_(row[emailIndex]) : '';
    if (!email && agent) {
      email = agent.email;
    }

    for (var columnIndex = 0; columnIndex < matrixColumns.length; columnIndex++) {
      var column = matrixColumns[columnIndex];
      var attendedValue = row[column.attendedColumn];
      var under15Value = column.under15Column >= 0 ? row[column.under15Column] : '';
      var over15Value = column.over15Column >= 0 ? row[column.over15Column] : '';
      var status = getAttendanceMatrixStatus_(attendedValue, over15Value);

      if (!status) {
        continue;
      }

      records.push({
        Date: column.date,
        Shift: shiftIndex >= 0 ? row[shiftIndex] : (agent ? agent.shift : ''),
        'Agent Name': agent ? agent.name || agentName : agentName,
        'Agent Email': email,
        Status: status,
        'Scheduled Start': '',
        'Scheduled End': '',
        'Actual Start': '',
        'Actual End': '',
        Notes: buildAttendanceMatrixImportNote_(sheetName, attendedValue, under15Value, over15Value, status),
        _SourceSheet: sheetName,
        _SourceRow: rowIndex + 1,
        _SourceColumn: column.attendedColumn + 1
      });
    }
  }

  return records;
}

function buildAttendanceMatrixImportNote_(sheetName, statusValue, under15Value, over15Value, finalStatus) {
  return 'Imported from attendance matrix tab "' + sheetName + '". ' +
    'Source status=' + safeAttendanceText_(statusValue) +
    '; Under 15=' + safeAttendanceText_(under15Value) +
    '; Over 15=' + safeAttendanceText_(over15Value) +
    '; Final status=' + safeAttendanceText_(finalStatus) + '.';
}

function getAttendanceMatrixColumns_(headers, values, headerRowIndex, sheetName) {
  var monthInfo = parseMonthYearFromSheetName_(sheetName, new Date());
  var columns = [];
  var fallbackDay = 1;
  var daysInMonth = monthInfo ? new Date(monthInfo.year, monthInfo.month + 1, 0).getDate() : 31;

  for (var columnIndex = 0; columnIndex < headers.length; columnIndex++) {
    if (!isAttendanceMatrixStatusColumnKey_(normalizeKey_(headers[columnIndex]))) {
      continue;
    }

    var date = resolveAttendanceMatrixDate_(values, headerRowIndex, columnIndex, fallbackDay, monthInfo, daysInMonth);
    fallbackDay += 1;
    if (!date) {
      continue;
    }

    var punctualityColumns = findAttendanceMatrixPunctualityColumns_(headers, values, headerRowIndex, columnIndex, date, monthInfo);
    columns.push({
      attendedColumn: columnIndex,
      under15Column: punctualityColumns.under15Column,
      over15Column: punctualityColumns.over15Column,
      date: date
    });
  }

  return columns;
}

function resolveAttendanceMatrixDate_(values, headerRowIndex, columnIndex, fallbackDay, monthInfo, daysInMonth) {
  var explicitDate = findAttendanceMatrixDateHeader_(values, headerRowIndex, columnIndex, monthInfo);
  if (explicitDate) {
    return explicitDate;
  }

  if (!monthInfo || fallbackDay < 1 || fallbackDay > daysInMonth) {
    return '';
  }

  return dateKey_(new Date(monthInfo.year, monthInfo.month, fallbackDay));
}

function findAttendanceMatrixDateHeader_(values, headerRowIndex, columnIndex, monthInfo) {
  for (var rowIndex = headerRowIndex - 1; rowIndex >= 0; rowIndex--) {
    var offsets = [0, -1, 1];
    for (var i = 0; i < offsets.length; i++) {
      var candidateIndex = columnIndex + offsets[i];
      if (candidateIndex < 0 || candidateIndex >= values[rowIndex].length) {
        continue;
      }

      var date = parseAttendanceMatrixDateValue_(values[rowIndex][candidateIndex], monthInfo);
      if (date) {
        return date;
      }
    }
  }

  return '';
}

function parseAttendanceMatrixDateValue_(value, monthInfo) {
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    return dateKey_(value);
  }

  var text = String(value || '').trim();
  if (!text) {
    return '';
  }

  var isoMatch = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    return dateKey_(new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }

  var dayMatch = text.match(/(?:^|[^0-9])([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?(?:[^0-9]|$)/i);
  if (dayMatch && monthInfo) {
    var day = Number(dayMatch[1]);
    var daysInMonth = new Date(monthInfo.year, monthInfo.month + 1, 0).getDate();
    if (day >= 1 && day <= daysInMonth) {
      return dateKey_(new Date(monthInfo.year, monthInfo.month, day));
    }
  }

  return '';
}

function findAttendanceMatrixPunctualityColumns_(headers, values, headerRowIndex, attendedColumn, targetDate, monthInfo) {
  return {
    under15Column: findAttendanceMatrixPunctualityColumn_(headers, values, headerRowIndex, attendedColumn, targetDate, monthInfo, isAttendanceUnder15Header_),
    over15Column: findAttendanceMatrixPunctualityColumn_(headers, values, headerRowIndex, attendedColumn, targetDate, monthInfo, isAttendanceOver15Header_)
  };
}

function findAttendanceMatrixPunctualityColumn_(headers, values, headerRowIndex, attendedColumn, targetDate, monthInfo, matcher) {
  for (var columnIndex = 0; columnIndex < headers.length; columnIndex++) {
    if (columnIndex === attendedColumn) {
      continue;
    }
    if (!matcher(headers[columnIndex])) {
      continue;
    }

    var candidateDate = findAttendanceMatrixDateHeader_(values, headerRowIndex, columnIndex, monthInfo);
    if (candidateDate && targetDate && String(candidateDate) === String(targetDate)) {
      return columnIndex;
    }
  }

  var offsets = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];
  for (var i = 0; i < offsets.length; i++) {
    var nearbyColumn = attendedColumn + offsets[i];
    if (nearbyColumn < 0 || nearbyColumn >= headers.length) {
      continue;
    }
    if (matcher(headers[nearbyColumn])) {
      return nearbyColumn;
    }
  }

  return -1;
}

function findAttendanceHeaderIndex_(headers, normalizedKeys) {
  var wanted = {};
  for (var i = 0; i < normalizedKeys.length; i++) {
    wanted[normalizedKeys[i]] = true;
  }

  for (var columnIndex = 0; columnIndex < (headers || []).length; columnIndex++) {
    if (wanted[normalizeKey_(headers[columnIndex])]) {
      return columnIndex;
    }
  }

  return -1;
}

function isAttendanceMatrixAttendedKey_(key) {
  return key === 'attended' || key === 'attendedyes' || key === 'present';
}

function isAttendanceMatrixStatusColumnKey_(key) {
  return isAttendanceMatrixAttendedKey_(key) ||
    key === 'status' ||
    key === 'attendancestatus' ||
    key === 'attendance' ||
    /^([1-9]|[12]\d|3[01])(st|nd|rd|th)?$/.test(key) ||
    /^20\d{6}$/.test(key);
}

function isAttendanceMatrixOnTimeKey_(header) {
  var key = normalizeKey_(header);
  return key === 'ontime' ||
    key === 'ontimeyes' ||
    key === 'timeous';
}

function isAttendanceUnder15Header_(header) {
  var text = String(header || '').trim().toLowerCase();
  var key = normalizeKey_(header);
  if ((text.indexOf('<') !== -1 || text.indexOf('under') !== -1 || text.indexOf('less') !== -1) && text.indexOf('15') !== -1) {
    return true;
  }
  return key === 'under15mins' ||
    key === 'under15minutes' ||
    key === 'lessthan15mins' ||
    key === 'lessthan15minutes' ||
    key === 'below15mins' ||
    key === 'below15minutes';
}

function isAttendanceOver15Header_(header) {
  var text = String(header || '').trim().toLowerCase();
  var key = normalizeKey_(header);
  if ((text.indexOf('<') !== -1 || text.indexOf('under') !== -1 || text.indexOf('less') !== -1) &&
      text.indexOf('>') === -1 &&
      text.indexOf('over') === -1 &&
      text.indexOf('more') === -1 &&
      text.indexOf('greater') === -1) {
    return false;
  }
  if ((text.indexOf('>') !== -1 || text.indexOf('over') !== -1 || text.indexOf('more than') !== -1 || text.indexOf('greater than') !== -1) &&
      text.indexOf('15') !== -1) {
    return true;
  }
  return key === 'over15mins' ||
    key === 'over15minutes' ||
    key === 'greaterthan15mins' ||
    key === 'greaterthan15minutes' ||
    key === 'morethan15mins' ||
    key === 'morethan15minutes' ||
    key === 'late15' ||
    key === 'lateover15';
}

function buildAttendanceAgentNameMap_() {
  var agents = getActiveAgents();
  var output = {};

  for (var i = 0; i < agents.length; i++) {
    var agent = agents[i];
    if (agent.name) {
      output[normalizeKey_(agent.name)] = agent;
    }
    output[normalizeKey_(nameFromEmail_(agent.email))] = agent;
  }

  return output;
}

function getAttendanceMatrixStatus_(attendedValue, over15Value) {
  var selectedStatus = normalizeAttendanceStatusValue_(attendedValue);
  if (shouldOverrideAttendanceStatusToLate_(selectedStatus, over15Value)) {
    return 'Late';
  }
  if (selectedStatus) {
    return selectedStatus;
  }

  var attended = attendanceMatrixCellState_(attendedValue);

  if (attended === true) {
    return isOver15PunctualityValue_(over15Value) ? 'Late' : 'Attended';
  }

  if (attended === false) {
    return isOver15PunctualityValue_(over15Value) ? 'Late' : 'Absent';
  }

  if (isOver15PunctualityValue_(over15Value)) {
    return 'Late';
  }

  return '';
}

function attendanceMatrixCellState_(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  var text = String(value || '').trim().toLowerCase();
  if (!text) {
    return null;
  }

  if (text === 'true' || text === 'yes' || text === 'y' || text === '1' || text === 'present' || text === 'attended' || text.indexOf('✔') !== -1 || text.indexOf('✓') !== -1) {
    return true;
  }

  if (text === 'false' || text === 'no' || text === 'n' || text === '0' || text === 'absent' || text === 'late' || text.indexOf('✘') !== -1 || text === 'x') {
    return false;
  }

  return null;
}

function normalizeAttendanceStatusValue_(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return '';
  }

  if (typeof value === 'boolean') {
    return value ? 'Attended' : 'Absent';
  }

  var text = String(value || '').trim();
  if (!text) {
    return '';
  }

  var key = normalizeKey_(text);
  if (key === 'true' || key === 'yes' || key === 'y' || key === '1' || key === 'present' || key === 'attended') {
    return 'Attended';
  }
  if (key === 'late') {
    return 'Late';
  }
  if (key === 'sick') {
    return 'Sick';
  }
  if (key === 'awol') {
    return 'AWOL';
  }
  if (key === 'familyleave') {
    return 'Family Leave';
  }
  if (key === 'familyresponsibility' || key === 'familyresponsibilityleave') {
    return 'Family Responsibility';
  }
  if (key === 'studyleave') {
    return 'Study Leave';
  }
  if (key === 'holiday') {
    return 'Holiday';
  }
  if (key === 'notscheduled') {
    return 'Not Scheduled';
  }
  if (key === 'false' || key === 'no' || key === 'n' || key === '0' || key === 'absent' || key === 'x') {
    return 'Absent';
  }

  return '';
}

function attendanceRecordsFromValues_(values, headerRowIndex, headers, sheetName) {
  var records = [];

  for (var rowIndex = headerRowIndex + 1; rowIndex < values.length; rowIndex++) {
    var row = values[rowIndex];
    if (!rowHasValue_(row)) {
      continue;
    }

    var record = {};
    for (var columnIndex = 0; columnIndex < headers.length; columnIndex++) {
      if (headers[columnIndex]) {
        record[headers[columnIndex]] = row[columnIndex];
      }
    }
    record._SourceSheet = sheetName;
    record._SourceRow = rowIndex + 1;
    records.push(record);
  }

  return records;
}

function detectAttendanceHeaderRow_(values) {
  var best = null;
  var maxRowsToCheck = Math.min(values.length, 10);

  for (var i = 0; i < maxRowsToCheck; i++) {
    var headers = values[i].map(function (header) {
      return String(header || '').trim();
    });
    var score = scoreAttendanceHeaderRow_(headers);

    if (!best || score > best.score) {
      best = {
        rowIndex: i,
        headers: headers,
        score: score
      };
    }
  }

  return best && best.score >= 2 ? best : null;
}

function scoreAttendanceHeaderRow_(headers) {
  var score = 0;
  for (var i = 0; i < headers.length; i++) {
    var key = normalizeKey_(headers[i]);
    if (!key) {
      continue;
    }
    if (key === 'date' || key === 'attendancedate' || key === 'shiftdate' || key === 'day' || key === 'dayofmonth') {
      score += 1;
    }
    if (key === 'agentname' || key === 'agent' || key === 'name' || key === 'employee' || key === 'staffmember') {
      score += 1;
    }
    if (key === 'email' || key === 'agentemail' || key === 'emailaddress' || key === 'workemail') {
      score += 1;
    }
    if (key === 'status' || key === 'attendancestatus' || key === 'attendance') {
      score += 1;
    }
    if (/^([1-9]|[12]\d|3[01])(st|nd|rd|th)?$/.test(key)) {
      score += 1;
    }
    if (key === 'shift') {
      score += 1;
    }
    if (key === 'clockin' || key === 'actualstart' || key === 'scheduledstart') {
      score += 1;
    }
  }
  return score;
}

function mapAttendanceSourceRows_(rows, startDate, endDate) {
  var output = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var status = deriveAttendanceStatusFromSourceRow_(row);
    output.push([
      resolveAttendanceDate_(row, startDate, endDate),
      pickAttendanceValue_(row, ['Shift', 'shift']),
      pickAttendanceValue_(row, ['Agent Name', 'Agent name', 'Name', 'Agent', 'Employee', 'Staff Member', 'Teammate']),
      pickAttendanceValue_(row, ['Email', 'Agent Email', 'Agent email', 'email', 'Email Address', 'Work Email']),
      status,
      pickAttendanceValue_(row, ['Scheduled Start', 'Scheduled start', 'Schedule Start']),
      pickAttendanceValue_(row, ['Scheduled End', 'Scheduled end', 'Schedule End']),
      pickAttendanceValue_(row, ['Actual Start', 'Actual start', 'Clock In', 'Clock in']),
      pickAttendanceValue_(row, ['Actual End', 'Actual end', 'Clock Out', 'Clock out']),
      pickAttendanceValue_(row, ['Notes', 'Note', 'Comment', 'Comments'])
    ]);
  }

  return output;
}

function deriveAttendanceStatusFromSourceRow_(row) {
  var rawStatus = pickAttendanceValue_(row, ['Status', 'Attendance Status', 'Attendance status', 'Attendance']);
  var status = normalizeAttendanceStatusValue_(rawStatus) || String(rawStatus || '').trim();
  var over15 = pickAttendanceValue_(row, [
    '>15',
    '> 15',
    '>15 Mins',
    '> 15 Mins',
    '>15 Minutes',
    '> 15 Minutes',
    'Over 15 Mins',
    'Over 15 Minutes',
    'Greater Than 15 Mins',
    'Greater Than 15 Minutes',
    'More Than 15 Mins',
    'More Than 15 Minutes',
    'Late >15',
    'Late > 15',
    'Late Over 15'
  ]);

  if (shouldOverrideAttendanceStatusToLate_(status, over15)) {
    return 'Late';
  }
  return status;
}

function shouldOverrideAttendanceStatusToLate_(status, over15Value) {
  if (!isOver15PunctualityValue_(over15Value)) {
    return false;
  }

  var normalized = String(status || '').trim().toLowerCase();
  return normalized === '' ||
    normalized === 'attended' ||
    normalized === 'present' ||
    normalized === 'absent' ||
    normalized === 'late';
}

function isOver15PunctualityValue_(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }

  var text = String(value || '').trim().toLowerCase();
  if (!text) {
    return false;
  }
  if (text === 'true' || text === 'yes' || text === 'y' || text === 'late' || text === 'x') {
    return true;
  }
  if (text === 'false' || text === 'no' || text === 'n' || text === '0') {
    return false;
  }

  var numberMatch = text.match(/\d+(\.\d+)?/);
  if (numberMatch && Number(numberMatch[0]) > 0) {
    return true;
  }
  return text.indexOf('>15') !== -1 || text.indexOf('over 15') !== -1 || text.indexOf('more than 15') !== -1;
}

function resolveAttendanceDate_(row, startDate, endDate) {
  var explicitDate = pickAttendanceValue_(row, [
    'Date',
    'date',
    'Attendance Date',
    'Attendance date',
    'Shift Date',
    'Shift date'
  ]);

  if (explicitDate) {
    return explicitDate;
  }

  var dayValue = pickAttendanceValue_(row, ['Day', 'day', 'Day of Month', 'Day Number', 'Date Number']);
  if (!dayValue) {
    return '';
  }

  return buildAttendanceDateFromTab_(row._SourceSheet, dayValue, startDate, endDate);
}

function buildAttendanceDateFromTab_(sheetName, dayValue, startDate, endDate) {
  var day = Number(String(dayValue).trim());
  if (!day || isNaN(day)) {
    return '';
  }

  var monthInfo = parseMonthYearFromSheetName_(sheetName, startDate || endDate || new Date());
  if (!monthInfo) {
    return '';
  }

  var candidate = new Date(monthInfo.year, monthInfo.month, day);
  return dateKey_(candidate);
}

function attendanceSheetNameMatchesWindow_(sheetName, startDate, endDate) {
  var monthInfo = parseMonthYearFromSheetName_(sheetName, startDate || endDate || new Date());
  if (!monthInfo || !startDate || !endDate) {
    return false;
  }

  var monthStart = new Date(monthInfo.year, monthInfo.month, 1);
  var monthEnd = new Date(monthInfo.year, monthInfo.month + 1, 1);
  var start = dateOnly_(startDate).getTime();
  var end = dateOnly_(endDate).getTime();

  return monthEnd.getTime() > start && monthStart.getTime() < end;
}

function parseMonthYearFromSheetName_(sheetName, fallbackDate) {
  var text = String(sheetName || '').trim().toLowerCase();
  var months = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };

  var numericMatch = text.match(/(?:^|[^0-9])(\d{4})[^0-9](0?[1-9]|1[0-2])(?:[^0-9]|$)/) ||
    text.match(/(?:^|[^0-9])(0?[1-9]|1[0-2])[^0-9](\d{4})(?:[^0-9]|$)/);
  if (numericMatch) {
    if (numericMatch[1].length === 4) {
      return { year: Number(numericMatch[1]), month: Number(numericMatch[2]) - 1 };
    }
    return { year: Number(numericMatch[2]), month: Number(numericMatch[1]) - 1 };
  }

  var yearMatch = text.match(/\b(20\d{2})\b/);
  var fallback = fallbackDate ? dateOnly_(fallbackDate) : new Date();
  var year = yearMatch ? Number(yearMatch[1]) : fallback.getFullYear();

  for (var monthName in months) {
    if (Object.prototype.hasOwnProperty.call(months, monthName) && text.indexOf(monthName) !== -1) {
      return {
        year: year,
        month: months[monthName]
      };
    }
  }

  return null;
}

function filterAttendanceRawRowsForWindow_(rows, startDate, endDate) {
  var start = dateOnly_(startDate).getTime();
  var end = dateOnly_(endDate).getTime();
  var output = [];

  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) {
      continue;
    }

    var rowDate = dateOnly_(rows[i][0]).getTime();
    if (rowDate >= start && rowDate < end) {
      output.push(rows[i]);
    }
  }

  return output;
}

function upsertAttendanceRawRowsForWindow_(rows, startDate, endDate) {
  var activeAgents = getAgentEmailMap();
  var incoming = buildUniqueIncomingAttendanceRows_(rows);
  var existingRows = getSheetData(SHEET_NAMES.RAW_ATTENDANCE);
  var keptRows = [];
  var rowsRemoved = 0;
  var statusChanges = [];

  for (var i = 0; i < existingRows.length; i++) {
    var existingRow = attendanceRawObjectToRow_(existingRows[i]);
    var existingEmail = normalizeEmail_(existingRow[3]);
    if (!existingEmail || !activeAgents[existingEmail] || !isAttendanceRawRowInWindow_(existingRow, startDate, endDate)) {
      keptRows.push(existingRow);
      continue;
    }

    rowsRemoved += 1;
    var key = attendanceIdentityKey_(existingRow);
    var replacement = key ? incoming.byKey[key] : null;
    if (replacement && String(existingRow[4] || '') !== String(replacement[4] || '')) {
      statusChanges.push({
        key: key,
        date: dateKey_(replacement[0]),
        shift: normalizeShift_(replacement[1]),
        agentName: replacement[2] || existingRow[2] || '',
        agentEmail: normalizeEmail_(replacement[3]),
        previousRawStatus: existingRow[4] || '',
        sourceStatus: replacement[4] || '',
        sourceDropdownStatus: extractAttendanceImportNoteValue_(replacement[9], 'Source status'),
        under15Value: extractAttendanceImportNoteValue_(replacement[9], 'Under 15'),
        over15Value: extractAttendanceImportNoteValue_(replacement[9], 'Over 15'),
        finalRawStatus: replacement[4] || ''
      });
    }
  }

  var replacementRows = [];
  for (var j = 0; j < incoming.keys.length; j++) {
    replacementRows.push(incoming.byKey[incoming.keys[j]]);
  }

  clearAndWriteRows(
    SHEET_NAMES.RAW_ATTENDANCE,
    SHEET_HEADERS[SHEET_NAMES.RAW_ATTENDANCE],
    keptRows.concat(replacementRows)
  );

  return {
    rowsRemoved: rowsRemoved,
    rowsWritten: replacementRows.length,
    statusChanges: statusChanges
  };
}

function buildUniqueIncomingAttendanceRows_(rows) {
  var byKey = {};
  var keys = [];

  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i];
    var key = attendanceIdentityKey_(row);
    if (!key) {
      continue;
    }
    if (!byKey[key]) {
      keys.push(key);
    }
    byKey[key] = normalizeRowWidth_([row], SHEET_HEADERS[SHEET_NAMES.RAW_ATTENDANCE].length)[0];
  }

  return {
    byKey: byKey,
    keys: keys
  };
}

function attendanceRawObjectToRow_(row) {
  return [
    row.Date,
    row.Shift,
    row['Agent Name'],
    row.Email,
    row.Status,
    row['Scheduled Start'],
    row['Scheduled End'],
    row['Actual Start'],
    row['Actual End'],
    row.Notes
  ];
}

function isAttendanceRawRowInWindow_(row, startDate, endDate) {
  if (!row || !row[0]) {
    return false;
  }

  var rowDate = dateOnly_(row[0]).getTime();
  return rowDate >= dateOnly_(startDate).getTime() && rowDate < dateOnly_(endDate).getTime();
}

function dedupeAttendanceRows_(rows) {
  var existingRows = getSheetData(SHEET_NAMES.RAW_ATTENDANCE);
  var seen = {};

  for (var i = 0; i < existingRows.length; i++) {
    seen[attendanceDedupeKey_(existingRows[i])] = true;
  }

  var uniqueRows = [];
  for (var j = 0; j < rows.length; j++) {
    var key = attendanceDedupeKey_(rows[j]);
    if (!key || seen[key]) {
      continue;
    }
    seen[key] = true;
    uniqueRows.push(rows[j]);
  }

  return uniqueRows;
}

function attendanceDedupeKey_(row) {
  return attendanceIdentityKey_(row);
}

function attendanceIdentityKey_(row) {
  var date = Array.isArray(row) ? row[0] : row.Date;
  var shift = Array.isArray(row) ? row[1] : row.Shift;
  var email = Array.isArray(row) ? row[3] : row.Email;
  if (!date || !normalizeEmail_(email)) {
    return '';
  }
  return [dateKey_(date), normalizeEmail_(email), normalizeShift_(shift)].join('|');
}

function extractAttendanceImportNoteValue_(note, label) {
  var text = String(note || '');
  var pattern = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;\\.]+)');
  var match = text.match(pattern);
  return match ? String(match[1] || '').trim() : '';
}

function logAttendanceRepairDiagnostics_(statusChanges) {
  if (!statusChanges || statusChanges.length === 0) {
    return;
  }

  var rawMap = buildAttendanceStatusMap_(getSheetData(SHEET_NAMES.RAW_ATTENDANCE), {
    date: 'Date',
    email: 'Email',
    shift: 'Shift',
    status: 'Status'
  });
  var normalizedMap = buildAttendanceStatusMap_(getSheetData(SHEET_NAMES.NORMALIZED_ATTENDANCE), {
    date: 'Date',
    email: 'Agent Email',
    shift: 'Shift',
    status: 'Attendance Status'
  });
  var finalMap = buildAttendanceStatusMap_(getSheetData(SHEET_NAMES.CURRENT_REPORT_VIEW), {
    date: 'Period Start',
    email: 'Agent Email',
    shift: 'Shift',
    status: 'Attendance Status'
  });

  var limit = Math.min(statusChanges.length, 25);
  for (var i = 0; i < limit; i++) {
    var change = statusChanges[i];
    var rawStatus = rawMap[change.key] || '';
    var normalizedStatus = normalizedMap[change.key] || '';
    var finalStatus = finalMap[change.key] || '';
    logPipelineEvent_({
      reportType: 'Attendance Repair',
      phase: 'attendance-diagnostic',
      status: 'STATUS_CHANGED',
      message: 'Attendance diagnostic for ' + (change.agentName || change.agentEmail) +
        ' on ' + change.date +
        ' shift=' + (change.shift || 'Unassigned') +
        ': previous raw=' + safeAttendanceText_(change.previousRawStatus) +
        ', source dropdown=' + safeAttendanceText_(change.sourceDropdownStatus || change.sourceStatus) +
        ', under 15=' + safeAttendanceText_(change.under15Value) +
        ', over 15=' + safeAttendanceText_(change.over15Value) +
        ', final raw written=' + safeAttendanceText_(change.finalRawStatus || change.sourceStatus) +
        ', raw after sync=' + safeAttendanceText_(rawStatus) +
        ', normalized=' + safeAttendanceText_(normalizedStatus) +
        ', final report=' + safeAttendanceText_(finalStatus) + '.'
    });
  }

  if (statusChanges.length > limit) {
    logPipelineEvent_({
      reportType: 'Attendance Repair',
      phase: 'attendance-diagnostic',
      status: 'TRUNCATED',
      message: 'Logged first ' + limit + ' attendance status changes out of ' + statusChanges.length + '.'
    });
  }
}

function buildAttendanceStatusMap_(rows, fields) {
  var output = {};
  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i];
    var key = attendanceStatusMapKey_(row[fields.date], row[fields.email], row[fields.shift]);
    if (!key) {
      continue;
    }
    output[key] = row[fields.status] || '';
  }
  return output;
}

function attendanceStatusMapKey_(date, email, shift) {
  if (!date || !normalizeEmail_(email)) {
    return '';
  }
  return [dateKey_(date), normalizeEmail_(email), normalizeShift_(shift)].join('|');
}

function pickAttendanceValue_(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (row[keys[i]] !== '' && row[keys[i]] !== null && typeof row[keys[i]] !== 'undefined') {
      return row[keys[i]];
    }
  }

  var normalizedKeys = {};
  for (var j = 0; j < keys.length; j++) {
    normalizedKeys[normalizeKey_(keys[j])] = true;
  }

  for (var key in row) {
    if (Object.prototype.hasOwnProperty.call(row, key) && normalizedKeys[normalizeKey_(key)]) {
      return row[key];
    }
  }

  return '';
}

function normalizeAttendance(rows) {
  var agentMap = getAgentEmailMap();
  var normalizedRows = [];

  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i];
    var email = normalizeEmail_(row.Email);
    var agent = email ? agentMap[email] : null;

    if (!email) {
      logError('normalizeAttendance', new Error('Attendance row is missing email for: ' + (row['Agent Name'] || 'Unknown')), 'OPEN', 0);
      continue;
    }

    if (!agent) {
      continue;
    }

    var attendanceDate = dateOnly_(row.Date);
    var fiscalInfo = getFiscalInfo(attendanceDate);
    var status = normalizeAttendanceStatusValue_(row.Status) || String(row.Status || '').trim();
    var expectedHours = calculateExpectedHours_(attendanceDate, row['Scheduled Start'], row['Scheduled End'], row.Shift);
    var actualHours = calculateActualHours_(attendanceDate, row['Actual Start'], row['Actual End']);
    var lateMinutes = calculateLateMinutes_(attendanceDate, row['Scheduled Start'], row['Actual Start']);
    if (lateMinutes > 15 && shouldOverrideAttendanceStatusToLate_(status, true)) {
      status = 'Late';
    }
    var score = getAttendanceScore_(status, row.Notes);

    normalizedRows.push([
      dateKey_(attendanceDate),
      fiscalInfo.fiscalWeek,
      fiscalInfo.fiscalMonth,
      normalizeShift_(row.Shift || agent.shift),
      email,
      agent.name || row['Agent Name'] || '',
      status,
      expectedHours,
      actualHours,
      lateMinutes,
      score === null ? '' : score
    ]);
  }

  return normalizedRows;
}

function getAttendanceScore_(status, notes) {
  var normalizedStatus = String(status || '').trim().toLowerCase();
  var normalizedNotes = String(notes || '').trim().toLowerCase();

  if (normalizedStatus === 'present' || normalizedStatus === 'attended') {
    return 1;
  }
  if (normalizedStatus === 'late') {
    return 0.75;
  }
  if (normalizedStatus === 'sick' ||
      normalizedStatus === 'study leave' ||
      normalizedStatus === 'family leave' ||
      normalizedStatus === 'family responsibility' ||
      normalizedStatus === 'holiday' ||
      normalizedStatus === 'not scheduled' ||
      normalizedStatus === 'sick with notice' ||
      normalizedStatus === 'leave approved' ||
      (normalizedStatus === 'leave' && normalizedNotes.indexOf('approved') !== -1)) {
    return null;
  }
  if (normalizedStatus === 'absent' || normalizedStatus === 'awol') {
    return 0;
  }

  return '';
}

function calculateExpectedHours_(date, scheduledStart, scheduledEnd, shift) {
  var start = parseTimeOnDate_(date, scheduledStart);
  var end = parseTimeOnDate_(date, scheduledEnd);

  if (!start || !end) {
    return 8;
  }

  return round2_(hoursBetween_(start, end));
}

function calculateActualHours_(date, actualStart, actualEnd) {
  var start = parseTimeOnDate_(date, actualStart);
  var end = parseTimeOnDate_(date, actualEnd);

  if (!start || !end) {
    return '';
  }

  return round2_(hoursBetween_(start, end));
}

function calculateLateMinutes_(date, scheduledStart, actualStart) {
  var scheduled = parseTimeOnDate_(date, scheduledStart);
  var actual = parseTimeOnDate_(date, actualStart);

  if (!scheduled || !actual || actual.getTime() <= scheduled.getTime()) {
    return 0;
  }

  return Math.round((actual.getTime() - scheduled.getTime()) / (60 * 1000));
}

function parseTimeOnDate_(date, value) {
  if (!value) {
    return null;
  }

  var base = dateOnly_(date);

  if (value instanceof Date) {
    base.setHours(value.getHours(), value.getMinutes(), value.getSeconds(), 0);
    return base;
  }

  var text = String(value).trim();
  var match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  base.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return base;
}

function hoursBetween_(start, end) {
  var adjustedEnd = new Date(end.getTime());
  if (adjustedEnd.getTime() <= start.getTime()) {
    adjustedEnd = addDays_(adjustedEnd, 1);
  }
  return (adjustedEnd.getTime() - start.getTime()) / (60 * 60 * 1000);
}

function round2_(number) {
  return Math.round(Number(number || 0) * 100) / 100;
}
