function generateExcelReport(reportType, finalDataset) {
  var type = String(reportType || '').toLowerCase();
  var rows = finalDataset || getFinalDatasetRows_();
  var filename = buildReportFilename_(type, rows);
  var spreadsheet = SpreadsheetApp.create(filename.replace(/\.xlsx$/, ''));

  try {
    writeReportSheet_(spreadsheet.getSheets()[0], 'Executive Summary', [
      ['Report Type', type],
      ['Generated At', formatDateTime_(new Date())],
      ['Rows', rows.length],
      ['AI Summary', 'Generated separately for the email layer in this milestone.']
    ]);

    writeReportSheet_(spreadsheet.insertSheet('Agent Summary'), 'Agent Summary', [
      SHEET_HEADERS[SHEET_NAMES.FINAL_DATASET]
    ].concat(rows));

    writeReportSheet_(spreadsheet.insertSheet('Shift Summary'), 'Shift Summary', buildShiftSummaryRows_(rows));
    writeReportSheet_(spreadsheet.insertSheet('Attendance Detail'), 'Attendance Detail', sheetRowsForReport_(SHEET_NAMES.NORMALIZED_ATTENDANCE));
    writeReportSheet_(spreadsheet.insertSheet('Ticket Detail'), 'Ticket Detail', sheetRowsForReport_(SHEET_NAMES.NORMALIZED_TICKETS));
    if (type === 'monthly') {
      writeReportSheet_(spreadsheet.insertSheet('WFM Monthly Balance'), 'WFM Monthly Balance', monthlyBalanceRowsForReport_(rows));
    }
    writeReportSheet_(spreadsheet.insertSheet('Exceptions'), 'Exceptions', buildExceptionRows_(rows));
    writeReportSheet_(spreadsheet.insertSheet('Raw Export Info'), 'Raw Export Info', buildRawExportInfoRows_(type, rows));

    SpreadsheetApp.flush();
    var driveFile = DriveApp.getFileById(spreadsheet.getId());
    var blob = driveFile.getBlob().getAs(MimeType.MICROSOFT_EXCEL);
    blob.setName(filename);
    driveFile.setTrashed(true);

    return {
      blob: blob,
      filename: filename,
      rows: rows.length
    };
  } catch (error) {
    DriveApp.getFileById(spreadsheet.getId()).setTrashed(true);
    throw error;
  }
}

function saveReportToDrive(fileBlob, filename) {
  return saveFile(fileBlob, filename);
}

function writeGeneratedReportLog(reportMetadata) {
  appendRows(SHEET_NAMES.GENERATED_REPORTS, [[
    new Date(),
    reportMetadata.reportType || '',
    reportMetadata.periodStart || '',
    reportMetadata.periodEnd || '',
    reportMetadata.filename || '',
    reportMetadata.fileId || '',
    reportMetadata.fileLink || '',
    reportMetadata.rows || 0
  ]]);
}

function getFinalDatasetRows_() {
  var headers = SHEET_HEADERS[SHEET_NAMES.CURRENT_REPORT_VIEW] || SHEET_HEADERS[SHEET_NAMES.FINAL_DATASET];
  var rows = getSheetData(SHEET_NAMES.CURRENT_REPORT_VIEW);
  if (!rows.length) {
    rows = getSheetData(SHEET_NAMES.FINAL_DATASET);
  }
  return objectsToRows_(rows, headers);
}

function writeReportSheet_(sheet, name, rows) {
  sheet.setName(name);
  if (!rows || rows.length === 0) {
    rows = [['No data']];
  }

  var width = 1;
  for (var i = 0; i < rows.length; i++) {
    width = Math.max(width, rows[i].length);
  }

  sheet.getRange(1, 1, rows.length, width).setValues(normalizeRowWidth_(rows, width));
  sheet.autoResizeColumns(1, width);
  sheet.setFrozenRows(1);
}

function buildShiftSummaryRows_(finalRows) {
  var summary = {};

  for (var i = 0; i < finalRows.length; i++) {
    var row = finalRows[i];
    var shift = row[7] || 'Unknown';
    if (!summary[shift]) {
      summary[shift] = { agents: 0, attendance: 0, attendanceCount: 0, tickets: 0 };
    }
    summary[shift].agents += 1;
    if (row[8] !== '') {
      summary[shift].attendance += Number(row[8]);
      summary[shift].attendanceCount += 1;
    }
    summary[shift].tickets += Number(row[9] || 0);
  }

  var rows = [['Shift', 'Agents', 'Attendance %', 'Tickets Solved']];
  for (var shiftName in summary) {
    if (!Object.prototype.hasOwnProperty.call(summary, shiftName)) {
      continue;
    }
    var group = summary[shiftName];
    rows.push([
      shiftName,
      group.agents,
      group.attendanceCount ? round2_(group.attendance / group.attendanceCount) : '',
      group.tickets
    ]);
  }

  return rows;
}

function buildExceptionRows_(finalRows) {
  var rows = [['Agent Email', 'Agent Name', 'Shift', 'Notes']];
  for (var i = 0; i < finalRows.length; i++) {
    if (finalRows[i][13]) {
      rows.push([finalRows[i][5], finalRows[i][6], finalRows[i][7], finalRows[i][13]]);
    }
  }
  return rows;
}

function buildRawExportInfoRows_(reportType, finalRows) {
  var periodStart = finalRows.length ? finalRows[0][1] : '';
  var periodEnd = finalRows.length ? finalRows[0][2] : '';
  return [
    ['Report Type', reportType],
    ['Period Start', periodStart],
    ['Period End', periodEnd],
    ['Source Spreadsheet ID', getScriptProperty_('SPREADSHEET_ID') || 'Active spreadsheet'],
    ['Exported At', formatDateTime_(new Date())]
  ];
}

function sheetRowsForReport_(sheetName) {
  var headers = SHEET_HEADERS[sheetName];
  var records = getSheetData(sheetName);
  return [headers].concat(objectsToRows_(records, headers));
}

function monthlyBalanceRowsForReport_(finalRows) {
  var headers = SHEET_HEADERS[SHEET_NAMES.WFM_MONTHLY_BALANCE];
  var fiscalMonth = finalRows && finalRows.length ? String(finalRows[0][4] || '') : '';
  var records = getSheetData(SHEET_NAMES.WFM_MONTHLY_BALANCE);
  var filtered = [];

  for (var i = 0; i < records.length; i++) {
    if (!fiscalMonth || String(records[i]['Fiscal Month'] || '') === fiscalMonth) {
      filtered.push(records[i]);
    }
  }

  return [headers].concat(objectsToRows_(filtered, headers));
}

function objectsToRows_(records, headers) {
  var rows = [];
  for (var i = 0; i < records.length; i++) {
    var row = [];
    for (var j = 0; j < headers.length; j++) {
      row.push(Object.prototype.hasOwnProperty.call(records[i], headers[j]) ? records[i][headers[j]] : '');
    }
    rows.push(row);
  }
  return rows;
}

function buildReportFilename_(reportType, rows) {
  if (rows && rows.length > 0) {
    if (reportType === 'daily') {
      return 'Daily Productivity Report - ' + String(rows[0][1]).slice(0, 10) + '.xlsx';
    }
    if (reportType === 'weekly') {
      return 'Weekly Productivity Report - ' + rows[0][3] + '.xlsx';
    }
    if (reportType === 'monthly') {
      return 'Monthly Productivity Report - ' + rows[0][4] + '.xlsx';
    }
  }

  return reportType + '-productivity-report.xlsx';
}
