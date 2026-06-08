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
    writeReportSheet_(spreadsheet.insertSheet('Shift Roster'), 'Shift Roster', buildShiftRosterRows_(rows));
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

  var normalizedRows = normalizeRowWidth_(rows, width);
  sheet.getRange(1, 1, rows.length, width).setValues(normalizedRows);
  styleReportSheet_(sheet, normalizedRows, width);
  sheet.autoResizeColumns(1, width);
  sheet.setFrozenRows(1);
}

function buildShiftSummaryRows_(finalRows) {
  var summary = {};

  for (var i = 0; i < finalRows.length; i++) {
    var row = finalRows[i];
    var shift = row[7] || 'Unknown';
    if (!summary[shift]) {
      summary[shift] = { agents: 0, attendance: 0, attendanceCount: 0, tickets: 0, inProgress: 0, agentNames: [] };
    }
    summary[shift].agents += 1;
    summary[shift].agentNames.push(row[6] || row[5] || '');
    if (row[8] !== '') {
      summary[shift].attendance += Number(row[8]);
      summary[shift].attendanceCount += 1;
    }
    summary[shift].tickets += Number(row[9] || 0);
    summary[shift].inProgress += Number(row[14] || 0);
  }

  var rows = [['Shift', 'Agents', 'Who Is On Shift', 'Attendance %', 'Tickets Solved', 'In Progress Tickets']];
  for (var shiftName in summary) {
    if (!Object.prototype.hasOwnProperty.call(summary, shiftName)) {
      continue;
    }
    var group = summary[shiftName];
    rows.push([
      shiftName,
      group.agents,
      group.agentNames.filter(function (name) { return name; }).sort().join(', '),
      group.attendanceCount ? round2_(group.attendance / group.attendanceCount) : '',
      group.tickets,
      group.inProgress
    ]);
  }

  return rows;
}

function buildExceptionRows_(finalRows) {
  var rows = [['Agent Email', 'Agent Name', 'Shift', 'Notes', 'In Progress Tickets', 'Open Ticket Notes', 'Ticket Follow-Up Status']];
  for (var i = 0; i < finalRows.length; i++) {
    if (finalRows[i][13] || finalRows[i][14]) {
      rows.push([finalRows[i][5], finalRows[i][6], finalRows[i][7], finalRows[i][13], finalRows[i][14] || 0, finalRows[i][15] || '', finalRows[i][16] || '']);
    }
  }
  return rows;
}

function buildShiftRosterRows_(finalRows) {
  var rows = [['Shift', 'Agent Name', 'Agent Email', 'Team', 'Site', 'Role', 'Ticket Follow-Up Status', 'Open Ticket Notes']];
  var reportRows = (finalRows || []).slice().sort(function (left, right) {
    var leftShift = String(left[7] || '');
    var rightShift = String(right[7] || '');
    if (leftShift !== rightShift) {
      return leftShift.localeCompare(rightShift);
    }
    return String(left[6] || '').localeCompare(String(right[6] || ''));
  });

  for (var i = 0; i < reportRows.length; i++) {
    var row = reportRows[i];
    var agent = getAgentByEmail(row[5]) || {};
    rows.push([
      row[7] || 'Unassigned',
      row[6] || agent.name || '',
      row[5] || agent.email || '',
      agent.team || '',
      agent.site || '',
      agent.role || '',
      row[16] || '',
      row[15] || ''
    ]);
  }

  return rows;
}

function styleReportSheet_(sheet, rows, width) {
  if (!rows || !rows.length) {
    return;
  }

  sheet.getRange(1, 1, 1, width)
    .setBackground('#1f4e79')
    .setFontColor('#ffffff')
    .setFontWeight('bold');

  for (var rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    for (var columnIndex = 0; columnIndex < width; columnIndex++) {
      var value = String(rows[rowIndex][columnIndex] || '').toLowerCase();
      if (value === 'in progress') {
        sheet.getRange(rowIndex + 1, columnIndex + 1)
          .setBackground('#fff2cc')
          .setFontColor('#7f6000')
          .setFontWeight('bold');
      }
    }
  }
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
