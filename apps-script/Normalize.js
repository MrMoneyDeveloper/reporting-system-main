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
        otherActions: 0,
        inProgressTicketIds: {},
        openTicketNotes: [],
        openTicketNoteMap: {}
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
    if (isOpenTicketNoteRow_(row)) {
      addOpenTicketNoteToGroup_(groups[key], row);
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
      group.solved + group.publicReplies,
      Object.keys(group.inProgressTicketIds).length,
      group.openTicketNotes.join('; ')
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
    var inProgressTickets = sumColumn_(tickets, 14);
    var openTicketNotes = uniqueMetricValues_(tickets, 15).join('; ');
    var notes = buildFinalNotes_(attendance, tickets, inProgressTickets, openTicketNotes);
    var ticketFollowUpStatus = inProgressTickets ? 'In progress' : (ticketSolved ? 'Completed' : 'No productivity recorded');

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
      notes,
      inProgressTickets,
      openTicketNotes,
      ticketFollowUpStatus
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

function buildFinalNotes_(attendanceRows, ticketRows, inProgressTickets, openTicketNotes) {
  var notes = [];
  if (attendanceRows.length === 0) {
    notes.push('Missing attendance data');
  }
  if (ticketRows.length === 0) {
    notes.push('No ticket activity');
  }
  if (Number(inProgressTickets || 0) > 0) {
    notes.push('Open ticket note activity on ' + Number(inProgressTickets || 0) + ' open ticket(s)');
  }
  if (openTicketNotes) {
    notes.push(openTicketNotes);
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

function isOpenTicketNoteRow_(row) {
  var status = String(row.Status || '').trim().toLowerCase();
  if (!status || status === 'solved' || status === 'closed' || status === 'deleted') {
    return false;
  }

  var eventType = String(row['Event Type'] || '').toLowerCase();
  var actionDescription = String(row['Action Description'] || '').toLowerCase();
  var commentText = String(row['Comment Text'] || '').trim();

  return Boolean(
    commentText ||
    actionDescription.indexOf('internal note') !== -1 ||
    actionDescription.indexOf('public customer reply') !== -1 ||
    eventType.indexOf('customer reply') !== -1 ||
    eventType.indexOf('public reply') !== -1
  );
}

function addOpenTicketNoteToGroup_(group, row) {
  var ticketId = String(row['Ticket ID'] || '').trim();
  var ticketKey = ticketId || [row['Event Time'], row['Action Description'], row['Comment Text']].join('|');
  var note = formatOpenTicketNote_(row);

  if (ticketKey) {
    group.inProgressTicketIds[ticketKey] = true;
  }
  if (note && !group.openTicketNoteMap[note]) {
    group.openTicketNoteMap[note] = true;
    group.openTicketNotes.push(note);
  }
}

function formatOpenTicketNote_(row) {
  var ticketId = String(row['Ticket ID'] || '').trim();
  var status = String(row.Status || '').trim() || 'open';
  var action = String(row['Action Description'] || row['Event Type'] || 'Note recorded').trim();
  var label = ticketId ? '#' + ticketId : 'Open ticket';
  return label + ' (' + status + '): ' + action;
}

function hasValue_(value) {
  return value !== '' && value !== null && typeof value !== 'undefined';
}
