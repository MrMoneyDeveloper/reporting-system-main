var SHEET_NAMES = Object.freeze({
  CONFIG: 'Config',
  AGENTS: 'Agent Directory',
  FISCAL_CALENDAR: 'Fiscal Calendar',
  RAW_ATTENDANCE: 'Raw Attendance',
  RAW_ZENDESK: 'Raw Zendesk Tickets',
  RAW_WFM: 'Raw WFM',
  WFM_UPLOAD: 'WFM Upload',
  WFM_UPLOAD_HISTORY: 'WFM Upload History',
  WFM_MONTHLY_BALANCE: 'WFM Monthly Balance',
  DAILY_METRICS: 'Daily Agent Metrics',
  WEEKLY_METRICS: 'Weekly Agent Metrics',
  MONTHLY_METRICS: 'Monthly Agent Metrics',
  CURRENT_REPORT_VIEW: 'Current Report View',
  NORMALIZED_ATTENDANCE: 'Normalized Attendance',
  NORMALIZED_TICKETS: 'Normalized Ticket Productivity',
  NORMALIZED_WFM: 'Normalized WFM Productivity',
  FINAL_DATASET: 'Final Report Dataset',
  GENERATED_REPORTS: 'Generated Reports',
  PIPELINE_LOG: 'Pipeline Log',
  RUN_LOG: 'Run Log',
  ERROR_LOG: 'Error Log'
});

var SHEET_HEADERS = Object.freeze({
  'Config': ['Setting', 'Value', 'Notes'],
  'Agent Directory': ['Active', 'Agent Name', 'Email', 'Team', 'Shift', 'Site', 'Role', 'Start Date', 'End Date'],
  'Fiscal Calendar': ['Date', 'Fiscal Year', 'Fiscal Month', 'Fiscal Week', 'Week Start', 'Week End', 'Month Start', 'Month End'],
  'Raw Attendance': ['Date', 'Shift', 'Agent Name', 'Email', 'Status', 'Scheduled Start', 'Scheduled End', 'Actual Start', 'Actual End', 'Notes'],
  'Raw Zendesk Tickets': ['Pulled At', 'Ticket ID', 'Agent Email', 'Agent Name', 'Status', 'Created At', 'Solved At', 'Updated At', 'Form', 'Group', 'Tags', 'Channel', 'Event Type', 'Event Time', 'Productivity Counted', 'Action Description', 'Comment Text'],
  'Raw WFM': ['Pulled At', 'Agent Email', 'Agent Name', 'Date', 'Shift', 'Productive Time', 'Unproductive Time', 'General Task Time', 'Total Logged Time', 'Activity'],
  'WFM Upload History': ['Upload Month', 'Month Start', 'Month End', 'Imported At', 'Agent Email', 'Agent Name', 'Team', 'Location', 'General Task Hours', 'WFM Total Hours', 'Productive Hours', 'Source Row'],
  'WFM Monthly Balance': ['Fiscal Month', 'Period Start', 'Period End', 'Agent Email', 'Agent Name', 'Attended Days', 'Expected Hours', 'WFM Total Hours', 'Productive Hours', 'Unproductive Hours', 'General Task Hours', 'Productivity %', 'Outstanding Hours', 'Surplus Hours', 'Notes'],
  'Daily Agent Metrics': ['Date', 'Fiscal Week', 'Fiscal Month', 'Shift', 'Agent Email', 'Agent Name', 'Attendance Status', 'Attendance Score', 'Expected Hours', 'Actual Hours', 'Late Minutes', 'Tickets Solved', 'Tickets Updated', 'Tickets Created', 'Public Replies', 'Other Actions', 'Ticket Forms Worked', 'Ticket Score', 'Productivity Actions', 'In Progress Tickets', 'Open Ticket Notes', 'Notes', 'Updated At'],
  'Weekly Agent Metrics': ['Fiscal Week', 'Week Start', 'Week End', 'Fiscal Month', 'Agent Email', 'Agent Name', 'Shift', 'Attended Days', 'Expected Hours', 'Actual Hours', 'Attendance %', 'Tickets Solved', 'Tickets Updated', 'Tickets Created', 'Public Replies', 'Other Actions', 'Ticket Score', 'Productivity Actions', 'In Progress Tickets', 'Open Ticket Notes', 'Notes', 'Updated At'],
  'Monthly Agent Metrics': ['Fiscal Month', 'Month Start', 'Month End', 'Agent Email', 'Agent Name', 'Shift', 'Attended Days', 'Expected Hours', 'Actual Hours', 'Attendance %', 'Tickets Solved', 'Tickets Updated', 'Tickets Created', 'Public Replies', 'Other Actions', 'Ticket Score', 'Productivity Actions', 'In Progress Tickets', 'Open Ticket Notes', 'WFM Total Hours', 'WFM Productive Hours', 'WFM General Task Hours', 'WFM Productivity %', 'WFM Outstanding Hours', 'WFM Surplus Hours', 'WFM Notes', 'Notes', 'Updated At'],
  'Current Report View': ['Period Type', 'Period Start', 'Period End', 'Fiscal Week', 'Fiscal Month', 'Agent Email', 'Agent Name', 'Shift', 'Attendance %', 'Tickets Solved', 'Productive Hours', 'Unproductive Hours', 'Productivity %', 'Notes', 'In Progress Tickets', 'Open Ticket Notes', 'Ticket Follow-Up Status'],
  'Normalized Attendance': ['Date', 'Fiscal Week', 'Fiscal Month', 'Shift', 'Agent Email', 'Agent Name', 'Attendance Status', 'Expected Hours', 'Actual Hours', 'Late Minutes', 'Attendance Score'],
  'Normalized Ticket Productivity': ['Date', 'Fiscal Week', 'Fiscal Month', 'Shift', 'Agent Email', 'Agent Name', 'Tickets Solved', 'Tickets Updated', 'Tickets Created', 'Ticket Forms Worked', 'Ticket Score', 'Public Replies', 'Other Actions', 'Productivity Actions', 'In Progress Tickets', 'Open Ticket Notes'],
  'Normalized WFM Productivity': ['Date', 'Fiscal Week', 'Fiscal Month', 'Shift', 'Agent Email', 'Agent Name', 'Total Hours', 'Productive Hours', 'Unproductive Hours', 'General Task Hours', 'Productivity %'],
  'Final Report Dataset': ['Period Type', 'Period Start', 'Period End', 'Fiscal Week', 'Fiscal Month', 'Agent Email', 'Agent Name', 'Shift', 'Attendance %', 'Tickets Solved', 'Productive Hours', 'Unproductive Hours', 'Productivity %', 'Notes', 'In Progress Tickets', 'Open Ticket Notes', 'Ticket Follow-Up Status'],
  'Generated Reports': ['Timestamp', 'Report Type', 'Period Start', 'Period End', 'Filename', 'File ID', 'File Link', 'Rows'],
  'Pipeline Log': ['Timestamp', 'Run ID', 'Report Type', 'Phase', 'Status', 'Message', 'Agent Index', 'Total Agents', 'Rows Processed', 'Window Start', 'Window End'],
  'Run Log': ['Run ID', 'Report Type', 'Started At', 'Ended At', 'Status', 'Rows Processed', 'File Link', 'Email Sent'],
  'Error Log': ['Timestamp', 'Function', 'Error Type', 'Message', 'Status', 'Retry Count']
});

var REQUIRED_SHEETS = Object.freeze([
  SHEET_NAMES.CONFIG,
  SHEET_NAMES.AGENTS,
  SHEET_NAMES.FISCAL_CALENDAR,
  SHEET_NAMES.RAW_ATTENDANCE,
  SHEET_NAMES.RAW_ZENDESK,
  SHEET_NAMES.WFM_UPLOAD_HISTORY,
  SHEET_NAMES.WFM_MONTHLY_BALANCE,
  SHEET_NAMES.DAILY_METRICS,
  SHEET_NAMES.WEEKLY_METRICS,
  SHEET_NAMES.MONTHLY_METRICS,
  SHEET_NAMES.CURRENT_REPORT_VIEW,
  SHEET_NAMES.NORMALIZED_ATTENDANCE,
  SHEET_NAMES.NORMALIZED_TICKETS,
  SHEET_NAMES.FINAL_DATASET,
  SHEET_NAMES.GENERATED_REPORTS,
  SHEET_NAMES.PIPELINE_LOG,
  SHEET_NAMES.RUN_LOG,
  SHEET_NAMES.ERROR_LOG
]);
var SPREADSHEET_CACHE_ = null;
var SPREADSHEET_CACHE_KEY_ = '';
var HEADER_VALIDATION_CACHE_ = {};

function getSpreadsheet() {
  var spreadsheetId = getSpreadsheetId_();
  var cacheKey = spreadsheetId || '__active__';
  if (SPREADSHEET_CACHE_ && SPREADSHEET_CACHE_KEY_ === cacheKey) {
    return SPREADSHEET_CACHE_;
  }

  if (spreadsheetId) {
    try {
      SPREADSHEET_CACHE_ = SpreadsheetApp.openById(spreadsheetId);
      SPREADSHEET_CACHE_KEY_ = cacheKey;
      return SPREADSHEET_CACHE_;
    } catch (error) {
      var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSpreadsheet) {
        SPREADSHEET_CACHE_ = activeSpreadsheet;
        SPREADSHEET_CACHE_KEY_ = '__active__';
        return SPREADSHEET_CACHE_;
      }
      throw error;
    }
  }

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('No active spreadsheet found. Set Script Property SPREADSHEET_ID for standalone deployments.');
  }

  SPREADSHEET_CACHE_ = spreadsheet;
  SPREADSHEET_CACHE_KEY_ = cacheKey;
  return SPREADSHEET_CACHE_;
}

function ensureSheet(name, headers) {
  var spreadsheet = getSpreadsheet();
  var sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    HEADER_VALIDATION_CACHE_[name] = false;
  }

  if (!HEADER_VALIDATION_CACHE_[name]) {
    ensureHeaders_(sheet, headers || SHEET_HEADERS[name] || []);
    HEADER_VALIDATION_CACHE_[name] = true;
  }
  return sheet;
}

function setupProject() {
  resetRuntimeCaches_();
  seedKnownScriptProperties_();

  var createdOrValidated = [];

  for (var i = 0; i < REQUIRED_SHEETS.length; i++) {
    var sheetName = REQUIRED_SHEETS[i];
    ensureSheet(sheetName, SHEET_HEADERS[sheetName]);
    createdOrValidated.push(sheetName);
  }

  ensureWfmUploadSheet_();
  createdOrValidated.push(SHEET_NAMES.WFM_UPLOAD);

  seedDefaultConfig_();
  var cleanup = cleanUpRetiredWorkbook_();
  seedDefaultAgents_();
  seedFiscalCalendarIfEmpty_();

  return {
    status: 'OK',
    sheets: createdOrValidated,
    cleanup: cleanup,
    message: 'Project workbook setup completed without deleting existing user data.'
  };
}

function hideLegacyWfmSheets_() {
  return cleanUpRetiredWorkbookTabs_();
}

function cleanUpRetiredWorkbook_() {
  var tabCleanup = cleanUpRetiredWorkbookTabs_();
  var configCleanup = typeof cleanUpRetiredConfigRows_ === 'function'
    ? cleanUpRetiredConfigRows_()
    : { removedKeys: [] };

  return {
    status: 'SUCCESS',
    hiddenTabs: tabCleanup.hiddenTabs || [],
    configRowsRemoved: configCleanup.removedKeys || []
  };
}

function cleanUpRetiredWorkbookTabs_() {
  var spreadsheet = getSpreadsheet();
  var legacyNames = [
    SHEET_NAMES.RAW_WFM,
    SHEET_NAMES.NORMALIZED_WFM,
    SHEET_NAMES.FINAL_DATASET
  ];
  var hiddenTabs = [];

  for (var i = 0; i < legacyNames.length; i++) {
    hideSheetIfVisible_(spreadsheet, legacyNames[i], hiddenTabs);
  }

  var defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && isSheetBlank_(defaultSheet)) {
    hideSheetIfVisible_(spreadsheet, 'Sheet1', hiddenTabs);
  }

  return {
    status: 'SUCCESS',
    hiddenTabs: hiddenTabs
  };
}

function hideSheetIfVisible_(spreadsheet, sheetName, hiddenTabs) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet || sheet.isSheetHidden()) {
    return;
  }

  if (countVisibleSheets_(spreadsheet) <= 1) {
    return;
  }

  sheet.hideSheet();
  hiddenTabs.push(sheetName);
}

function countVisibleSheets_(spreadsheet) {
  var sheets = spreadsheet.getSheets();
  var count = 0;
  for (var i = 0; i < sheets.length; i++) {
    if (!sheets[i].isSheetHidden()) {
      count += 1;
    }
  }
  return count;
}

function isSheetBlank_(sheet) {
  if (sheet.getLastRow() > 1 || sheet.getLastColumn() > 1) {
    return false;
  }
  return !String(sheet.getRange(1, 1).getValue() || '').trim();
}

function clearAndWriteRows(sheetName, headers, rows) {
  var sheet = ensureSheet(sheetName, headers);
  sheet.clearContents();
  ensureHeaders_(sheet, headers);

  if (!rows || rows.length === 0) {
    return 0;
  }

  var normalizedRows = normalizeRowWidth_(rows, headers.length);
  sheet.getRange(2, 1, normalizedRows.length, headers.length).setValues(normalizedRows);
  return normalizedRows.length;
}

function appendRows(sheetName, rows) {
  if (!rows || rows.length === 0) {
    return 0;
  }

  var headers = SHEET_HEADERS[sheetName] || [];
  var sheet = ensureSheet(sheetName, headers);
  var width = Math.max(headers.length, rows[0].length || 0);
  var normalizedRows = normalizeRowWidth_(rows, width);
  sheet.getRange(sheet.getLastRow() + 1, 1, normalizedRows.length, width).setValues(normalizedRows);
  return normalizedRows.length;
}

function getSheetData(sheetName) {
  var sheet = ensureSheet(sheetName, SHEET_HEADERS[sheetName] || []);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) {
    return [];
  }

  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = values[0].map(function (header) {
    return String(header || '').trim();
  });
  var records = [];

  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
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
    records.push(record);
  }

  return records;
}

function ensureHeaders_(sheet, headers) {
  if (!headers || headers.length === 0) {
    return;
  }

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  var currentWidth = Math.max(headers.length, sheet.getLastColumn());
  var currentHeaders = sheet.getRange(1, 1, 1, currentWidth).getValues()[0].map(function (header) {
    return String(header || '').trim();
  });

  var finalHeaders = headers.slice();
  for (var i = 0; i < currentHeaders.length; i++) {
    var existingHeader = currentHeaders[i];
    if (existingHeader && finalHeaders.indexOf(existingHeader) === -1) {
      finalHeaders.push(existingHeader);
    }
  }

  if (sheet.getMaxColumns() < finalHeaders.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), finalHeaders.length - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, 1, finalHeaders.length).setValues([finalHeaders]);
  sheet.getRange(1, 1, 1, finalHeaders.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function seedDefaultConfig_() {
  var existingRows = getSheetData(SHEET_NAMES.CONFIG);
  var existingKeys = {};

  for (var i = 0; i < existingRows.length; i++) {
    var setting = String(existingRows[i].Setting || '').trim();
    if (setting) {
      existingKeys[setting] = true;
    }
  }

  var rowsToAppend = [];
  for (var j = 0; j < DEFAULT_CONFIG_ROWS.length; j++) {
    var configRow = DEFAULT_CONFIG_ROWS[j];
    if (!existingKeys[configRow[0]]) {
      rowsToAppend.push(configRow);
    }
  }

  appendRows(SHEET_NAMES.CONFIG, rowsToAppend);
  if (rowsToAppend.length && typeof invalidateConfigCache_ === 'function') {
    invalidateConfigCache_();
  }
  upgradeDefaultConfigValues_();
}

function seedFiscalCalendarIfEmpty_() {
  var sheet = ensureSheet(SHEET_NAMES.FISCAL_CALENDAR, SHEET_HEADERS[SHEET_NAMES.FISCAL_CALENDAR]);
  if (sheet.getLastRow() > 1) {
    return;
  }

  var now = new Date();
  var startDate = new Date(now.getFullYear() - 1, 0, 1);
  var endDate = new Date(now.getFullYear() + 1, 11, 31);
  var rows = buildFiscalCalendarRows_(startDate, endDate);
  appendRows(SHEET_NAMES.FISCAL_CALENDAR, rows);
}

function normalizeRowWidth_(rows, width) {
  var output = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i].slice();
    while (row.length < width) {
      row.push('');
    }
    if (row.length > width) {
      row = row.slice(0, width);
    }
    output.push(row);
  }

  return output;
}

function rowHasValue_(row) {
  for (var i = 0; i < row.length; i++) {
    if (row[i] !== '' && row[i] !== null && typeof row[i] !== 'undefined') {
      return true;
    }
  }
  return false;
}
