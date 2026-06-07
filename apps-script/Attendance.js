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

  logPipelineEvent_({
    reportType: 'Attendance Repair',
    phase: 'attendance',
    status: result.status || 'SUCCESS',
    message: 'Raw Attendance repair: source=' + result.sourceRows +
      ', mapped=' + result.mappedRows +
      ', filtered=' + result.filteredRows +
      ', active=' + result.activeRows +
      ', unmatched=' + result.unmatchedRows +
      ', wrote=' + result.rowsWritten + '. ' + (result.message || ''),
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
    rowsWritten: 0,
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
    var uniqueRows = dedupeAttendanceRows_(activeResult.rows);

    result.status = 'SUCCESS';
    result.sourceRows = sourceRows.length;
    result.mappedRows = mappedRows.length;
    result.filteredRows = filteredRows.length;
    result.activeRows = activeResult.rows.length;
    result.unmatchedRows = activeResult.unmatchedRows;
    result.rowsWritten = appendRows(SHEET_NAMES.RAW_ATTENDANCE, uniqueRows);
    result.message = 'Attendance source sync completed.';
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
  var attendedCount = 0;

  for (var i = 0; i < (headers || []).length; i++) {
    var key = normalizeKey_(headers[i]);
    if (key === 'agentname' || key === 'agent' || key === 'name' || key === 'employee' || key === 'staffmember') {
      hasAgentName = true;
    }
    if (key === 'shift') {
      hasShift = true;
    }
    if (isAttendanceMatrixAttendedKey_(key)) {
      attendedCount += 1;
    }
  }

  return hasAgentName && hasShift && attendedCount >= 2;
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
      var onTimeValue = column.onTimeColumn >= 0 ? row[column.onTimeColumn] : '';
      var status = getAttendanceMatrixStatus_(attendedValue, onTimeValue);

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
        Notes: 'Imported from attendance matrix tab "' + sheetName + '".',
        _SourceSheet: sheetName,
        _SourceRow: rowIndex + 1,
        _SourceColumn: column.attendedColumn + 1
      });
    }
  }

  return records;
}

function getAttendanceMatrixColumns_(headers, values, headerRowIndex, sheetName) {
  var monthInfo = parseMonthYearFromSheetName_(sheetName, new Date());
  var columns = [];
  var fallbackDay = 1;
  var daysInMonth = monthInfo ? new Date(monthInfo.year, monthInfo.month + 1, 0).getDate() : 31;

  for (var columnIndex = 0; columnIndex < headers.length; columnIndex++) {
    if (!isAttendanceMatrixAttendedKey_(normalizeKey_(headers[columnIndex]))) {
      continue;
    }

    var date = resolveAttendanceMatrixDate_(values, headerRowIndex, columnIndex, fallbackDay, monthInfo, daysInMonth);
    fallbackDay += 1;
    if (!date) {
      continue;
    }

    columns.push({
      attendedColumn: columnIndex,
      onTimeColumn: findAttendanceMatrixOnTimeColumn_(headers, columnIndex),
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

function findAttendanceMatrixOnTimeColumn_(headers, attendedColumn) {
  for (var columnIndex = attendedColumn + 1; columnIndex < Math.min(headers.length, attendedColumn + 4); columnIndex++) {
    if (isAttendanceMatrixOnTimeKey_(normalizeKey_(headers[columnIndex]))) {
      return columnIndex;
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

function isAttendanceMatrixOnTimeKey_(key) {
  return key === 'ontime' || key === 'ontimeyes' || key === 'timeous';
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

function getAttendanceMatrixStatus_(attendedValue, onTimeValue) {
  var attended = attendanceMatrixCellState_(attendedValue);
  var onTime = attendanceMatrixCellState_(onTimeValue);

  if (attended === null && onTime === null) {
    return '';
  }

  if (attended === true) {
    return onTime === false ? 'Late' : 'Present';
  }

  if (attended === false) {
    return 'Absent';
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
    output.push([
      resolveAttendanceDate_(row, startDate, endDate),
      pickAttendanceValue_(row, ['Shift', 'shift']),
      pickAttendanceValue_(row, ['Agent Name', 'Agent name', 'Name', 'Agent', 'Employee', 'Staff Member', 'Teammate']),
      pickAttendanceValue_(row, ['Email', 'Agent Email', 'Agent email', 'email', 'Email Address', 'Work Email']),
      pickAttendanceValue_(row, ['Status', 'Attendance Status', 'Attendance status', 'Attendance']),
      pickAttendanceValue_(row, ['Scheduled Start', 'Scheduled start', 'Schedule Start']),
      pickAttendanceValue_(row, ['Scheduled End', 'Scheduled end', 'Schedule End']),
      pickAttendanceValue_(row, ['Actual Start', 'Actual start', 'Clock In', 'Clock in']),
      pickAttendanceValue_(row, ['Actual End', 'Actual end', 'Clock Out', 'Clock out']),
      pickAttendanceValue_(row, ['Notes', 'Note', 'Comment', 'Comments'])
    ]);
  }

  return output;
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
  if (Array.isArray(row)) {
    return [dateKey_(row[0]), normalizeShift_(row[1]), normalizeEmail_(row[3]), row[4]].join('|');
  }
  return [dateKey_(row.Date), normalizeShift_(row.Shift), normalizeEmail_(row.Email), row.Status].join('|');
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
    var status = String(row.Status || '').trim();
    var expectedHours = calculateExpectedHours_(attendanceDate, row['Scheduled Start'], row['Scheduled End'], row.Shift);
    var actualHours = calculateActualHours_(attendanceDate, row['Actual Start'], row['Actual End']);
    var lateMinutes = calculateLateMinutes_(attendanceDate, row['Scheduled Start'], row['Actual Start']);
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

  if (normalizedStatus === 'present') {
    return 1;
  }
  if (normalizedStatus === 'late') {
    return 0.75;
  }
  if (normalizedStatus === 'sick with notice' || (normalizedStatus === 'sick' && normalizedNotes.indexOf('notice') !== -1)) {
    return 0.75;
  }
  if (normalizedStatus === 'leave approved' || (normalizedStatus === 'leave' && normalizedNotes.indexOf('approved') !== -1)) {
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
