var WFM_UPLOAD_TABLE_START_ROW_ = 5;
var WFM_UPLOAD_DEFAULT_HEADERS_ = Object.freeze([
  'Agent name',
  'Agent email',
  'Team',
  'Location',
  'Unpaid General Task time',
  'Total time'
]);

function ensureWfmUploadSheet_() {
  var spreadsheet = getSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_NAMES.WFM_UPLOAD);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAMES.WFM_UPLOAD);
  }

  sheet.getRange('A1').setValue('Upload Month');
  sheet.getRange('A2').setValue('Paste the WFM calendar-month export below');
  sheet.getRange('A4').setValue('WFM export table');
  ensureWfmUploadMonthDropdown_(sheet);

  var existingHeader = sheet.getRange(WFM_UPLOAD_TABLE_START_ROW_, 1, 1, WFM_UPLOAD_DEFAULT_HEADERS_.length).getValues()[0];
  if (!wfmMonthlyHeadersMatch_(existingHeader, WFM_UPLOAD_DEFAULT_HEADERS_)) {
    sheet.getRange(WFM_UPLOAD_TABLE_START_ROW_, 1, 1, WFM_UPLOAD_DEFAULT_HEADERS_.length).setValues([WFM_UPLOAD_DEFAULT_HEADERS_]);
  }

  sheet.getRange('A1:A2').setFontWeight('bold');
  sheet.getRange(WFM_UPLOAD_TABLE_START_ROW_, 1, 1, WFM_UPLOAD_DEFAULT_HEADERS_.length).setFontWeight('bold');
  sheet.setFrozenRows(WFM_UPLOAD_TABLE_START_ROW_);
  return sheet;
}

function ensureWfmUploadMonthDropdown_(sheet) {
  var months = buildWfmUploadMonthOptions_();
  var monthCell = sheet.getRange('B1');
  monthCell.setNumberFormat('@');
  var current = normalizeWfmUploadMonthKey_(monthCell.getValue());
  if (!current || months.indexOf(current) === -1) {
    current = months.length ? months[months.length - 1] : formatCalendarMonthKey_(new Date());
  }
  monthCell.setValue(current);

  var validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(months, true)
    .setAllowInvalid(false)
    .build();
  monthCell.setDataValidation(validation);
}

function importWfmMonthlyUpload() {
  setupProject();

  var startedAt = new Date();
  var runId = generateRunId();

  try {
    var sheet = ensureWfmUploadSheet_();
    var uploadMonth = readWfmUploadMonth_(sheet);
    var parsed = readWfmMonthlyUploadRows_(sheet);
    var historyRows = mapWfmUploadRecordsToHistoryRows_(uploadMonth, parsed);
    if (!historyRows.length) {
      throw new Error('WFM upload contained no rows matching active agent emails. Check the Agent email column and Agent Directory.');
    }
    var historyWritten = replaceWfmUploadHistoryMonth_(uploadMonth.key, historyRows);
    var rebuildResult = rebuildWfmMonthlyBalance();

    activateWfmManualMonthlySource_();

    var message = 'Imported WFM upload month ' + uploadMonth.key + '; replaced history for that month with ' + historyRows.length + ' rows, rebuilt ' + rebuildResult.rowsWritten + ' balance rows, and refreshed ' + (rebuildResult.monthlyMetricRows || 0) + ' monthly metric rows.';
    logRun({
      runId: runId,
      reportType: 'WFM Monthly Upload',
      startedAt: startedAt,
      endedAt: new Date(),
      status: 'SUCCESS',
      rowsProcessed: historyRows.length,
      emailSent: false
    });
    logPipelineEvent_({
      runId: runId,
      reportType: 'WFM Monthly Upload',
      phase: 'wfm-monthly',
      status: 'SUCCESS',
      message: message,
      rowsProcessed: historyRows.length,
      startDate: uploadMonth.startDate,
      endDate: uploadMonth.endDate
    });

    return {
      status: 'SUCCESS',
      uploadMonth: uploadMonth.key,
      sourceRows: parsed.records.length,
      historyRows: historyRows.length,
      historyWritten: historyWritten,
      balanceRows: rebuildResult.rowsWritten,
      monthlyMetricRows: rebuildResult.monthlyMetricRows || 0,
      message: message
    };
  } catch (error) {
    logRun({
      runId: runId,
      reportType: 'WFM Monthly Upload',
      startedAt: startedAt,
      endedAt: new Date(),
      status: 'FAILED',
      rowsProcessed: 0,
      emailSent: false
    });
    logPipelineEvent_({
      runId: runId,
      reportType: 'WFM Monthly Upload',
      phase: 'wfm-monthly',
      status: 'FAILED',
      message: compactLogMessage_(error.message || String(error))
    });
    logError('importWfmMonthlyUpload', error, 'FAILED', 0);
    throw error;
  }
}

function rebuildWfmMonthlyBalance() {
  setupProject();

  var startedAt = new Date();
  var runId = generateRunId();

  try {
    var history = getSheetData(SHEET_NAMES.WFM_UPLOAD_HISTORY);
    var activeAgents = getActiveAgents();
    var balanceRows = buildWfmMonthlyBalanceFromHistory_(history, activeAgents);
    var rowsWritten = clearAndWriteRows(
      SHEET_NAMES.WFM_MONTHLY_BALANCE,
      SHEET_HEADERS[SHEET_NAMES.WFM_MONTHLY_BALANCE],
      balanceRows
    );
    var analyticsResult = refreshMonthlyAnalyticsAfterWfm_();

    logRun({
      runId: runId,
      reportType: 'WFM Monthly Balance Rebuild',
      startedAt: startedAt,
      endedAt: new Date(),
      status: 'SUCCESS',
      rowsProcessed: rowsWritten,
      emailSent: false
    });
    logPipelineEvent_({
      runId: runId,
      reportType: 'WFM Monthly Balance Rebuild',
      phase: 'wfm-monthly',
      status: 'SUCCESS',
      message: 'Rebuilt WFM Monthly Balance from ' + history.length + ' history rows. Monthly metrics refreshed: ' + analyticsResult.monthlyRows + '.',
      rowsProcessed: rowsWritten + Number(analyticsResult.monthlyRows || 0)
    });

    return {
      status: 'SUCCESS',
      sourceRows: history.length,
      rowsWritten: rowsWritten,
      monthlyMetricRows: analyticsResult.monthlyRows
    };
  } catch (error) {
    logError('rebuildWfmMonthlyBalance', error, 'FAILED', 0);
    throw error;
  }
}

function refreshMonthlyAnalyticsAfterWfm_() {
  if (typeof rebuildMonthlyAgentMetricsFromDaily_ !== 'function') {
    return { monthlyRows: 0 };
  }

  try {
    return rebuildMonthlyAgentMetricsFromDaily_();
  } catch (error) {
    logError('refreshMonthlyAnalyticsAfterWfm', error, 'CONTINUED', 0);
    return { monthlyRows: 0, error: error.message };
  }
}

function clearWfmUpload() {
  setupProject();

  var sheet = ensureWfmUploadSheet_();
  clearWfmUploadTable_(sheet);

  logPipelineEvent_({
    reportType: 'WFM Monthly Upload',
    phase: 'wfm-monthly',
    status: 'CLEARED',
    message: 'Cleared WFM Upload table rows. Upload Month was left in place.'
  });

  return {
    status: 'SUCCESS',
    message: 'WFM Upload table cleared. Upload Month was left in place.'
  };
}

function clearWfmUploadTable_(sheet) {
  var maxRows = Math.max(sheet.getMaxRows() - WFM_UPLOAD_TABLE_START_ROW_ + 1, 1);
  var maxColumns = Math.max(sheet.getMaxColumns(), WFM_UPLOAD_DEFAULT_HEADERS_.length);
  sheet.getRange(WFM_UPLOAD_TABLE_START_ROW_, 1, maxRows, maxColumns).clearContent();
  sheet.getRange(WFM_UPLOAD_TABLE_START_ROW_, 1, 1, WFM_UPLOAD_DEFAULT_HEADERS_.length).setValues([WFM_UPLOAD_DEFAULT_HEADERS_]);
  sheet.getRange(WFM_UPLOAD_TABLE_START_ROW_, 1, 1, WFM_UPLOAD_DEFAULT_HEADERS_.length).setFontWeight('bold');
}

function readWfmUploadMonth_(sheet) {
  var key = normalizeWfmUploadMonthKey_(sheet.getRange('B1').getValue());
  if (!key.match(/^\d{4}-\d{2}$/)) {
    throw new Error('WFM Upload requires an Upload Month in B1, for example 2026-05.');
  }

  var parts = key.split('-');
  var startDate = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  var endDate = new Date(Number(parts[0]), Number(parts[1]), 0);

  return {
    key: key,
    startDate: startDate,
    endDate: endDate
  };
}

function readWfmMonthlyUploadRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < WFM_UPLOAD_TABLE_START_ROW_ || lastColumn < 1) {
    throw new Error('WFM Upload has no pasted table. Paste the monthly export starting at row 5.');
  }

  var values = sheet.getRange(WFM_UPLOAD_TABLE_START_ROW_, 1, lastRow - WFM_UPLOAD_TABLE_START_ROW_ + 1, lastColumn).getValues();
  var headerInfo = detectWfmMonthlyUploadHeader_(values);
  if (!headerInfo) {
    throw new Error('Could not detect WFM monthly upload headers. Expected Agent name, Agent email, Team, Location, Unpaid General Task time, Total time.');
  }

  var records = [];
  for (var rowIndex = headerInfo.rowIndex + 1; rowIndex < values.length; rowIndex++) {
    var row = values[rowIndex];
    if (!rowHasValue_(row)) {
      continue;
    }
    records.push({
      row: row,
      sheetRow: WFM_UPLOAD_TABLE_START_ROW_ + rowIndex
    });
  }

  if (!records.length) {
    throw new Error('WFM Upload headers were found, but no data rows were pasted below them.');
  }

  return {
    headers: headerInfo.headers,
    columnMap: headerInfo.columnMap,
    records: records
  };
}

function detectWfmMonthlyUploadHeader_(values) {
  var best = null;
  var maxRowsToCheck = Math.min(values.length, 15);

  for (var i = 0; i < maxRowsToCheck; i++) {
    var headers = values[i].map(function (header) {
      return String(header || '').trim();
    });
    var columnMap = mapWfmMonthlyUploadColumns_(headers);
    var score = scoreWfmMonthlyUploadHeader_(columnMap);
    if (!best || score > best.score) {
      best = {
        rowIndex: i,
        headers: headers,
        columnMap: columnMap,
        score: score
      };
    }
  }

  return best && best.score >= 5 ? best : null;
}

function scoreWfmMonthlyUploadHeader_(columnMap) {
  var score = 0;
  if (columnMap.name > -1) {
    score += 1;
  }
  if (columnMap.email > -1) {
    score += 2;
  }
  if (columnMap.team > -1) {
    score += 1;
  }
  if (columnMap.location > -1) {
    score += 1;
  }
  if (columnMap.general > -1) {
    score += 2;
  }
  if (columnMap.total > -1) {
    score += 3;
  }
  return score;
}

function mapWfmMonthlyUploadColumns_(headers) {
  var columnMap = {
    name: -1,
    email: -1,
    team: -1,
    location: -1,
    general: -1,
    total: -1
  };

  var aliases = {
    name: { agentname: true, agent: true, name: true, employee: true },
    email: { agentemail: true, email: true, emailaddress: true, workemail: true },
    team: { team: true, group: true },
    location: { location: true, site: true },
    general: { unpaidgeneraltasktime: true, unpaidgeneraltaskhours: true, generaltasktime: true, generaltaskhours: true },
    total: { totaltime: true, totalhours: true, totalloggedtime: true, loggedtime: true }
  };

  for (var i = 0; i < headers.length; i++) {
    var key = normalizeKey_(headers[i]);
    for (var field in aliases) {
      if (Object.prototype.hasOwnProperty.call(aliases, field) && columnMap[field] === -1 && aliases[field][key]) {
        columnMap[field] = i;
      }
    }
  }

  return columnMap;
}

function mapWfmUploadRecordsToHistoryRows_(uploadMonth, parsed) {
  var agentMap = getAgentEmailMap();
  var rows = [];
  var importedAt = new Date();

  for (var i = 0; i < parsed.records.length; i++) {
    var record = parsed.records[i];
    var row = record.row;
    var email = normalizeEmail_(wfmValueAt_(row, parsed.columnMap.email));
    if (!email || !agentMap[email]) {
      continue;
    }

    var totalHours = wfmMonthlyTimeValueToHours_(wfmValueAt_(row, parsed.columnMap.total));
    var generalHours = wfmMonthlyTimeValueToHours_(wfmValueAt_(row, parsed.columnMap.general));
    var productiveHours = Math.max(0, totalHours - generalHours);

    rows.push([
      uploadMonth.key,
      dateKey_(uploadMonth.startDate),
      dateKey_(uploadMonth.endDate),
      importedAt,
      email,
      String(wfmValueAt_(row, parsed.columnMap.name) || agentMap[email].name || '').trim(),
      String(wfmValueAt_(row, parsed.columnMap.team) || '').trim(),
      String(wfmValueAt_(row, parsed.columnMap.location) || '').trim(),
      round2_(generalHours),
      round2_(totalHours),
      round2_(productiveHours),
      record.sheetRow || ''
    ]);
  }

  return rows;
}

function replaceWfmUploadHistoryMonth_(uploadMonthKey, newRows) {
  var headers = SHEET_HEADERS[SHEET_NAMES.WFM_UPLOAD_HISTORY];
  var existingRows = getSheetData(SHEET_NAMES.WFM_UPLOAD_HISTORY);
  var keptRows = [];

  for (var i = 0; i < existingRows.length; i++) {
    if (normalizeWfmUploadMonthKey_(existingRows[i]['Upload Month']) !== uploadMonthKey) {
      keptRows.push(wfmHistoryObjectToRow_(existingRows[i], headers));
    }
  }

  return clearAndWriteRows(SHEET_NAMES.WFM_UPLOAD_HISTORY, headers, keptRows.concat(newRows));
}

function wfmHistoryObjectToRow_(record, headers) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    row.push(Object.prototype.hasOwnProperty.call(record, headers[i]) ? record[headers[i]] : '');
  }
  return row;
}

function buildWfmMonthlyBalanceFromHistory_(historyRows, activeAgents) {
  var fiscalSegments = buildFiscalSegmentsFromWfmHistory_(historyRows);
  var attendanceTotals = calculateAttendanceTotalsForFiscalSegments_(fiscalSegments, activeAgents);
  var groups = initializeWfmBalanceGroups_(fiscalSegments, activeAgents, attendanceTotals);
  var agentMap = getAgentEmailMap();

  for (var i = 0; i < historyRows.length; i++) {
    var row = historyRows[i];
    var email = normalizeEmail_(row['Agent Email']);
    var agent = agentMap[email];
    if (!email || !agent) {
      continue;
    }

    var uploadMonth = String(row['Upload Month'] || '');
    var segments = fiscalSegments.byUploadMonth[uploadMonth] || [];
    var allocation = buildWfmAllocationForAgentMonth_(email, segments, attendanceTotals);

    for (var j = 0; j < segments.length; j++) {
      var segment = segments[j];
      var ratioInfo = allocation[segment.fiscalMonth] || { ratio: 0, fallback: false };
      var key = wfmBalanceKey_(segment.fiscalMonth, email);
      var group = groups[key] || createWfmBalanceGroup_(segment, agent, attendanceTotals[key]);
      var ratio = ratioInfo.ratio;
      var totalHours = Number(row['WFM Total Hours'] || 0) * ratio;
      var generalHours = Number(row['General Task Hours'] || 0) * ratio;
      var productiveHours = Number(row['Productive Hours'] || 0) * ratio;

      group.totalHours += totalHours;
      group.generalHours += generalHours;
      group.productiveHours += productiveHours;
      group.sourceMonths[uploadMonth] = true;
      if (ratioInfo.fallback) {
        group.fallbackUsed = true;
      }
      groups[key] = group;
    }
  }

  return wfmBalanceGroupsToRows_(groups);
}

function buildFiscalSegmentsFromWfmHistory_(historyRows) {
  var byUploadMonth = {};
  var byFiscalMonth = {};

  for (var i = 0; i < historyRows.length; i++) {
    var uploadMonth = normalizeWfmUploadMonthKey_(historyRows[i]['Upload Month']);
    if (!uploadMonth || byUploadMonth[uploadMonth]) {
      continue;
    }

    var monthInfo = parseWfmUploadMonthKey_(uploadMonth);
    var segments = buildFiscalSegmentsForDateRange_(monthInfo.startDate, monthInfo.endDate);
    byUploadMonth[uploadMonth] = segments;
    for (var j = 0; j < segments.length; j++) {
      var fiscalMonth = segments[j].fiscalMonth;
      if (!byFiscalMonth[fiscalMonth]) {
        byFiscalMonth[fiscalMonth] = {
          fiscalMonth: fiscalMonth,
          startDate: segments[j].startDate,
          endDate: segments[j].endDate
        };
      } else {
        if (segments[j].startDate.getTime() < byFiscalMonth[fiscalMonth].startDate.getTime()) {
          byFiscalMonth[fiscalMonth].startDate = segments[j].startDate;
        }
        if (segments[j].endDate.getTime() > byFiscalMonth[fiscalMonth].endDate.getTime()) {
          byFiscalMonth[fiscalMonth].endDate = segments[j].endDate;
        }
      }
    }
  }

  return {
    byUploadMonth: byUploadMonth,
    byFiscalMonth: byFiscalMonth
  };
}

function buildFiscalSegmentsForDateRange_(startDate, endDate) {
  var segments = {};
  var cursor = dateOnly_(startDate);
  var end = dateOnly_(endDate);

  while (cursor.getTime() <= end.getTime()) {
    var fiscalInfo = getFiscalInfo(cursor);
    var key = fiscalInfo.fiscalMonth;
    if (!segments[key]) {
      segments[key] = {
        fiscalMonth: key,
        startDate: dateOnly_(cursor),
        endDate: dateOnly_(cursor),
        dayCount: 0
      };
    }
    segments[key].endDate = dateOnly_(cursor);
    segments[key].dayCount += 1;
    cursor = addDays_(cursor, 1);
  }

  var output = [];
  for (var fiscalMonth in segments) {
    if (Object.prototype.hasOwnProperty.call(segments, fiscalMonth)) {
      output.push(segments[fiscalMonth]);
    }
  }
  output.sort(function (left, right) {
    return left.startDate.getTime() - right.startDate.getTime();
  });
  return output;
}

function calculateAttendanceTotalsForFiscalSegments_(fiscalSegments, activeAgents) {
  var statusMap = getWfmBalanceAttendanceStatusMap_();
  var totals = {};
  var segments = fiscalSegments.byFiscalMonth || {};

  for (var fiscalMonth in segments) {
    if (!Object.prototype.hasOwnProperty.call(segments, fiscalMonth)) {
      continue;
    }
    for (var i = 0; i < activeAgents.length; i++) {
      totals[wfmBalanceKey_(fiscalMonth, activeAgents[i].email)] = {
        attendedDates: {},
        attendedDays: 0,
        expectedHours: 0
      };
    }
  }

  for (var segmentMonth in segments) {
    if (!Object.prototype.hasOwnProperty.call(segments, segmentMonth)) {
      continue;
    }
    var segment = segments[segmentMonth];
    var attendanceRows = normalizeAttendance(readAttendance(segment.startDate, addDays_(segment.endDate, 1)));
    for (var j = 0; j < attendanceRows.length; j++) {
      var row = attendanceRows[j];
      var email = normalizeEmail_(row[4]);
      var status = String(row[6] || '').trim().toLowerCase();
      var key = wfmBalanceKey_(segmentMonth, email);
      if (!totals[key] || !statusMap[status]) {
        continue;
      }
      totals[key].expectedHours += Number(row[7] || 0);
      totals[key].attendedDates[row[0]] = true;
    }
  }

  for (var totalKey in totals) {
    if (Object.prototype.hasOwnProperty.call(totals, totalKey)) {
      totals[totalKey].attendedDays = Object.keys(totals[totalKey].attendedDates).length;
    }
  }

  return totals;
}

function initializeWfmBalanceGroups_(fiscalSegments, activeAgents, attendanceTotals) {
  var groups = {};
  var segments = fiscalSegments.byFiscalMonth || {};

  for (var fiscalMonth in segments) {
    if (!Object.prototype.hasOwnProperty.call(segments, fiscalMonth)) {
      continue;
    }
    for (var i = 0; i < activeAgents.length; i++) {
      var key = wfmBalanceKey_(fiscalMonth, activeAgents[i].email);
      groups[key] = createWfmBalanceGroup_(segments[fiscalMonth], activeAgents[i], attendanceTotals[key]);
    }
  }

  return groups;
}

function createWfmBalanceGroup_(segment, agent, attendance) {
  return {
    fiscalMonth: segment.fiscalMonth,
    startDate: segment.startDate,
    endDate: segment.endDate,
    email: agent.email,
    name: agent.name,
    attendedDays: attendance ? attendance.attendedDays || 0 : 0,
    expectedHours: attendance ? Number(attendance.expectedHours || 0) : 0,
    totalHours: 0,
    productiveHours: 0,
    generalHours: 0,
    sourceMonths: {},
    fallbackUsed: false
  };
}

function buildWfmAllocationForAgentMonth_(email, segments, attendanceTotals) {
  var output = {};
  var totalExpected = 0;
  var totalDays = 0;

  for (var i = 0; i < segments.length; i++) {
    var attendance = attendanceTotals[wfmBalanceKey_(segments[i].fiscalMonth, email)] || {};
    totalExpected += Number(attendance.expectedHours || 0);
    totalDays += Number(segments[i].dayCount || 0);
  }

  for (var j = 0; j < segments.length; j++) {
    var segment = segments[j];
    var key = segment.fiscalMonth;
    var segmentAttendance = attendanceTotals[wfmBalanceKey_(key, email)] || {};
    if (totalExpected > 0) {
      output[key] = {
        ratio: Number(segmentAttendance.expectedHours || 0) / totalExpected,
        fallback: false
      };
    } else {
      output[key] = {
        ratio: totalDays ? Number(segment.dayCount || 0) / totalDays : 0,
        fallback: true
      };
    }
  }

  return output;
}

function wfmBalanceGroupsToRows_(groups) {
  var keys = Object.keys(groups).sort();
  var rows = [];

  for (var i = 0; i < keys.length; i++) {
    var group = groups[keys[i]];
    var productivity = group.totalHours > 0 ? group.productiveHours / group.totalHours : '';
    var outstanding = Math.max(0, group.expectedHours - group.totalHours);
    var surplus = Math.max(0, group.totalHours - group.expectedHours);
    var notes = [];
    var sourceMonths = Object.keys(group.sourceMonths).sort();

    if (!sourceMonths.length) {
      notes.push('No WFM upload history row');
    } else {
      notes.push('Allocated from upload month(s): ' + sourceMonths.join(', '));
    }
    if (group.fallbackUsed) {
      notes.push('Calendar-day allocation fallback used because no counted attendance existed for the upload month');
    }
    if (!group.attendedDays) {
      notes.push('No counted attendance days');
    }

    rows.push([
      group.fiscalMonth,
      dateKey_(group.startDate),
      dateKey_(group.endDate),
      group.email,
      group.name,
      group.attendedDays || 0,
      round2_(group.expectedHours),
      round2_(group.totalHours),
      round2_(group.productiveHours),
      '',
      round2_(group.generalHours),
      productivity === '' ? '' : round2_(productivity),
      round2_(outstanding),
      round2_(surplus),
      notes.join('; ')
    ]);
  }

  return rows;
}

function getWfmBalanceAttendanceStatusMap_() {
  var configured = String(getConfigValue('WFM_BALANCE_ATTENDANCE_STATUSES', 'Present,Late') || 'Present,Late');
  var parts = configured.split(',');
  var map = {};

  for (var i = 0; i < parts.length; i++) {
    var status = String(parts[i] || '').trim().toLowerCase();
    if (status) {
      map[status] = true;
      if (status === 'present') {
        map.attended = true;
      }
      if (status === 'attended') {
        map.present = true;
      }
    }
  }

  return map;
}

function activateWfmManualMonthlySource_() {
  setConfigValue_('WFM_SOURCE_MODE', 'MANUAL_MONTHLY', 'WFM monthly totals are imported manually into WFM Monthly Balance');
  if (typeof clearRetiredWfmTriggers_ === 'function') {
    clearRetiredWfmTriggers_();
  }
}

function buildWfmUploadMonthOptions_() {
  var startKey = String(getConfigValue('WFM_UPLOAD_MONTH_START', '2026-04') || '2026-04').trim();
  var start = parseWfmUploadMonthKey_(startKey).startDate;
  var current = dateOnly_(new Date());
  var cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  var end = new Date(current.getFullYear(), current.getMonth(), 1);
  var months = [];

  while (cursor.getTime() <= end.getTime()) {
    months.push(formatCalendarMonthKey_(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return months;
}

function parseWfmUploadMonthKey_(key) {
  var text = normalizeWfmUploadMonthKey_(key);
  var match = text.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error('Invalid WFM upload month: ' + key + '. Use yyyy-MM.');
  }

  var startDate = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  var endDate = new Date(Number(match[1]), Number(match[2]), 0);
  return {
    key: text,
    startDate: startDate,
    endDate: endDate
  };
}

function normalizeWfmUploadMonthKey_(value) {
  if (value instanceof Date) {
    return formatCalendarMonthKey_(value);
  }

  var text = String(value || '').trim();
  if (!text || text.match(/^\d{4}-\d{2}$/)) {
    return text;
  }

  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return formatCalendarMonthKey_(parsed);
  }

  return text;
}

function formatCalendarMonthKey_(dateValue) {
  var date = dateOnly_(dateValue);
  return date.getFullYear() + '-' + pad2_(date.getMonth() + 1);
}

function wfmMonthlyTimeValueToHours_(value) {
  if (!wfmMonthlyHasValue_(value)) {
    return 0;
  }

  if (typeof value === 'number') {
    return value > 0 && value < 1 ? value * 24 : value;
  }

  if (value instanceof Date) {
    return value.getHours() + value.getMinutes() / 60 + value.getSeconds() / 3600;
  }

  var text = String(value).trim().toLowerCase().replace(/,/g, '');
  if (!text) {
    return 0;
  }

  var durationPattern = /(\d+(?:\.\d+)?)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g;
  var match;
  var total = 0;
  var matched = false;
  while ((match = durationPattern.exec(text)) !== null) {
    var amount = Number(match[1]);
    var unit = match[2];
    matched = true;
    if (unit === 'd' || unit === 'day' || unit === 'days') {
      total += amount * 24;
    } else if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') {
      total += amount;
    } else if (unit === 'm' || unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') {
      total += amount / 60;
    } else if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'second' || unit === 'seconds') {
      total += amount / 3600;
    }
  }
  if (matched) {
    return total;
  }

  var timeMatch = text.match(/^(\d{1,5}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    return Number(timeMatch[1]) + Number(timeMatch[2]) / 60 + Number(timeMatch[3] || 0) / 3600;
  }

  var numeric = Number(text);
  return isNaN(numeric) ? 0 : numeric;
}

function wfmValueAt_(row, index) {
  return index > -1 ? row[index] : '';
}

function wfmBalanceKey_(fiscalMonth, email) {
  return String(fiscalMonth || '') + '|' + normalizeEmail_(email);
}

function wfmMonthlyHeadersMatch_(actual, expected) {
  if (!actual || actual.length < expected.length) {
    return false;
  }
  for (var i = 0; i < expected.length; i++) {
    if (String(actual[i] || '').trim() !== expected[i]) {
      return false;
    }
  }
  return true;
}

function wfmMonthlyHasValue_(value) {
  return value !== '' && value !== null && typeof value !== 'undefined';
}
