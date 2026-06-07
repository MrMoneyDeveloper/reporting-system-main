function normalizeTicketData(rawTickets) {
  var rows = rawTickets || getSheetData(SHEET_NAMES.RAW_ZENDESK);
  var agentMap = getAgentEmailMap();
  var groups = {};

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var email = normalizeEmail_(row['Agent Email']);
    if (!email || !agentMap[email]) {
      continue;
    }

    var eventDateTime = getTicketEventDateTime_(row);
    if (!eventDateTime) {
      continue;
    }

    var operationalDate = getOperationalDateForDateTime_(eventDateTime);
    var shift = getShiftForDateTime_(eventDateTime);
    var fiscalInfo = getFiscalInfo(operationalDate);
    var key = [email, dateKey_(operationalDate), shift].join('|');

    if (!groups[key]) {
      groups[key] = {
        date: dateKey_(operationalDate),
        fiscalWeek: fiscalInfo.fiscalWeek,
        fiscalMonth: fiscalInfo.fiscalMonth,
        shift: shift,
        email: email,
        name: agentMap[email].name || row['Agent Name'] || '',
        solved: 0,
        updated: 0,
        created: 0,
        forms: {},
        publicReplies: 0,
        otherActions: 0
      };
    }

    var eventType = String(row['Event Type'] || '').toLowerCase();
    var status = String(row.Status || '').toLowerCase();
    if (eventType) {
      if (eventType.indexOf('solved') !== -1) {
        groups[key].solved += 1;
      }
      if (eventType.indexOf('customer reply') !== -1 || eventType.indexOf('public reply') !== -1) {
        groups[key].publicReplies += 1;
        groups[key].updated += 1;
      } else if (eventType.indexOf('created') !== -1 || eventType.indexOf('submitted') !== -1) {
        groups[key].created += 1;
      } else if (eventType.indexOf('updated') !== -1) {
        groups[key].updated += 1;
        groups[key].otherActions += 1;
      }
    } else {
      if (row['Solved At'] || status === 'solved' || status === 'closed') {
        groups[key].solved += 1;
      }
      if (row['Updated At']) {
        groups[key].updated += 1;
      }
      if (row['Created At']) {
        groups[key].created += 1;
      }
    }
    if (row.Form) {
      groups[key].forms[String(row.Form)] = true;
    }
  }

  var output = [];
  for (var groupKey in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, groupKey)) {
      continue;
    }
    var group = groups[groupKey];
    output.push([
      group.date,
      group.fiscalWeek,
      group.fiscalMonth,
      group.shift,
      group.email,
      group.name,
      group.solved,
      group.updated,
      group.created,
      Object.keys(group.forms).join(', '),
      group.solved + group.publicReplies,
      group.publicReplies,
      group.otherActions,
      group.solved + group.publicReplies
    ]);
  }

  return output;
}

function buildFinalReportDataset(reportType, startDate, endDate) {
  var windowInfo = getReportWindow(reportType, endDate || new Date());
  if (startDate && endDate) {
    windowInfo.startDate = parseDate_(startDate);
    windowInfo.endDate = parseDate_(endDate);
    var fiscalInfo = getFiscalInfo(windowInfo.startDate);
    windowInfo.fiscalWeek = fiscalInfo.fiscalWeek;
    windowInfo.fiscalMonth = fiscalInfo.fiscalMonth;
  }

  var attendanceRows = normalizeAttendance(readAttendance(windowInfo.startDate, windowInfo.endDate));
  clearAndWriteRows(SHEET_NAMES.NORMALIZED_ATTENDANCE, SHEET_HEADERS[SHEET_NAMES.NORMALIZED_ATTENDANCE], attendanceRows);

  var rawTicketRows = filterRawZendeskForWindow_(getSheetData(SHEET_NAMES.RAW_ZENDESK), windowInfo.startDate, windowInfo.endDate);
  var ticketRows = normalizeTicketData(rawTicketRows);
  clearAndWriteRows(SHEET_NAMES.NORMALIZED_TICKETS, SHEET_HEADERS[SHEET_NAMES.NORMALIZED_TICKETS], ticketRows);

  var finalRows = joinFinalRows_(reportType, windowInfo, attendanceRows, ticketRows, []);
  clearAndWriteRows(SHEET_NAMES.CURRENT_REPORT_VIEW, SHEET_HEADERS[SHEET_NAMES.CURRENT_REPORT_VIEW], finalRows);
  clearAndWriteRows(SHEET_NAMES.FINAL_DATASET, SHEET_HEADERS[SHEET_NAMES.FINAL_DATASET], finalRows);
  return finalRows;
}

function joinFinalRows_(reportType, windowInfo, attendanceRows, ticketRows, wfmRows) {
  var type = String(reportType || '').toLowerCase();
  var agents = getActiveAgents();
  var output = [];

  for (var i = 0; i < agents.length; i++) {
    var agent = agents[i];
    var attendance = collectPeriodRows_(attendanceRows, agent, type, windowInfo);
    var tickets = collectPeriodRows_(ticketRows, agent, type, windowInfo);
    var attendancePercent = calculateAttendancePercent_(attendance);
    var ticketSolved = sumColumn_(tickets, 6);
    var notes = buildFinalNotes_(attendance, tickets);

    output.push([
      type,
      formatDateTime_(windowInfo.startDate),
      formatDateTime_(windowInfo.endDate),
      windowInfo.fiscalWeek,
      windowInfo.fiscalMonth,
      agent.email,
      agent.name,
      agent.shift,
      attendancePercent === '' ? '' : round2_(attendancePercent),
      ticketSolved,
      '',
      '',
      '',
      notes
    ]);
  }

  return output;
}

function collectPeriodRows_(rows, agent, reportType, windowInfo) {
  var output = [];
  var operationalDate = dateKey_(windowInfo.startDate);

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var email = normalizeEmail_(row[4]);
    if (email !== agent.email) {
      continue;
    }

    if (reportType === 'daily') {
      if (row[0] === operationalDate && (!agent.shift || normalizeShift_(row[3]) === agent.shift)) {
        output.push(row);
      }
    } else if (reportType === 'weekly') {
      if (row[1] === windowInfo.fiscalWeek) {
        output.push(row);
      }
    } else if (reportType === 'monthly') {
      if (row[2] === windowInfo.fiscalMonth) {
        output.push(row);
      }
    }
  }

  return output;
}

function calculateAttendancePercent_(rows) {
  var scoreTotal = 0;
  var scoreCount = 0;

  for (var i = 0; i < rows.length; i++) {
    var score = rows[i][10];
    if (score === '' || score === null || typeof score === 'undefined') {
      continue;
    }
    scoreTotal += Number(score);
    scoreCount += 1;
  }

  return scoreCount > 0 ? scoreTotal / scoreCount : '';
}

function buildFinalNotes_(attendanceRows, ticketRows) {
  var notes = [];
  if (attendanceRows.length === 0) {
    notes.push('Missing attendance data');
  }
  if (ticketRows.length === 0) {
    notes.push('No ticket activity');
  }
  return notes.join('; ');
}

function sumColumn_(rows, index) {
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    total += Number(rows[i][index] || 0);
  }
  return total;
}

function hasColumnValue_(rows, index) {
  for (var i = 0; i < rows.length; i++) {
    if (hasValue_(rows[i][index])) {
      return true;
    }
  }
  return false;
}

function filterRawZendeskForWindow_(rows, startDate, endDate) {
  var start = parseDate_(startDate).getTime();
  var end = parseDate_(endDate).getTime();
  var output = [];

  for (var i = 0; i < rows.length; i++) {
    var eventDate = getTicketEventDateTime_(rows[i]);
    if (!eventDate) {
      continue;
    }
    var eventTime = eventDate.getTime();
    if (eventTime >= start && eventTime < end) {
      output.push(rows[i]);
    }
  }

  return output;
}

function getTicketEventDateTime_(row) {
  var value = row['Event Time'] || row['Solved At'] || row['Updated At'] || row['Created At'];
  if (!value) {
    return null;
  }
  return parseDate_(value);
}

function hasValue_(value) {
  return value !== '' && value !== null && typeof value !== 'undefined';
}
