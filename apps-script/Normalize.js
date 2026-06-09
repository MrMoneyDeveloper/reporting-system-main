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
        commentedTicketIds: {},
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
    if (isCommentActivityRow_(row)) {
      addCommentedTicketToGroup_(groups[key], row);
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
      group.openTicketNotes.join('; '),
      Object.keys(group.commentedTicketIds).length
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
  var commentActivityRows = buildZendeskCommentActivityRows_(rawTicketRows);
  clearAndWriteRows(SHEET_NAMES.ZENDESK_COMMENT_ACTIVITY, SHEET_HEADERS[SHEET_NAMES.ZENDESK_COMMENT_ACTIVITY], commentActivityRows);

  var ticketRows = normalizeTicketData(rawTicketRows);
  clearAndWriteRows(SHEET_NAMES.NORMALIZED_TICKETS, SHEET_HEADERS[SHEET_NAMES.NORMALIZED_TICKETS], ticketRows);

  var finalRows = joinFinalRows_(reportType, windowInfo, attendanceRows, ticketRows, []);
  validateFinalReportRows_(reportType, windowInfo, finalRows);
  clearAndWriteRows(SHEET_NAMES.CURRENT_REPORT_VIEW, SHEET_HEADERS[SHEET_NAMES.CURRENT_REPORT_VIEW], finalRows);
  clearAndWriteRows(SHEET_NAMES.FINAL_DATASET, SHEET_HEADERS[SHEET_NAMES.FINAL_DATASET], finalRows);
  return finalRows;
}

function joinFinalRows_(reportType, windowInfo, attendanceRows, ticketRows, wfmRows) {
  var type = String(reportType || '').toLowerCase();
  var agents = getActiveAgents();
  var output = [];
  var wfmMap = type === 'monthly' ? buildFinalWfmBalanceMap_() : {};
  var wfmFreshness = type === 'monthly' ? getLatestWfmUploadFreshness_() : '';

  for (var i = 0; i < agents.length; i++) {
    var agent = agents[i];
    var attendance = collectPeriodRows_(attendanceRows, agent, type, windowInfo);
    var tickets = collectPeriodRows_(ticketRows, agent, type, windowInfo);
    var attendancePercent = calculateAttendancePercent_(attendance);
    var ticketSolved = sumColumn_(tickets, 6);
    var ticketsCreated = sumColumn_(tickets, 8);
    var commentedTickets = sumColumn_(tickets, 16);
    var inProgressTickets = sumColumn_(tickets, 14);
    var openTicketNotes = uniqueMetricValues_(tickets, 15).join('; ');
    var attendanceStatus = summarizeMetricStatuses_(attendance, 6);
    var notes = buildFinalNotes_(attendance, tickets, inProgressTickets, openTicketNotes, commentedTickets);
    var usefulNotes = buildUsefulReportNotes_(notes, openTicketNotes);
    var ticketFollowUpStatus = inProgressTickets ? 'In progress' : ((ticketSolved || commentedTickets || ticketsCreated) ? 'Completed' : 'No productivity recorded');
    var shift = agent.shift || firstPeriodValue_(attendance, 3) || firstPeriodValue_(tickets, 3) || '';
    var wfm = wfmMap[windowInfo.fiscalMonth + '|' + agent.email] || {};
    var wfmTotalHours = wfm['WFM Total Hours'] || '';
    var wfmOutstandingHours = wfm['Outstanding Hours'] || '';
    if (type === 'monthly' && wfm.Notes) {
      notes = safeJoinText_([notes, 'WFM: ' + wfm.Notes]);
      usefulNotes = safeJoinText_([usefulNotes, 'WFM: ' + wfm.Notes]);
    }

    output.push([
      type,
      formatDateTime_(windowInfo.startDate),
      formatDateTime_(windowInfo.endDate),
      windowInfo.fiscalWeek,
      windowInfo.fiscalMonth,
      agent.email,
      agent.name,
      shift,
      attendancePercent === '' ? '' : round2_(attendancePercent),
      ticketSolved,
      '',
      '',
      '',
      notes,
      inProgressTickets,
      openTicketNotes,
      ticketFollowUpStatus,
      attendanceStatus,
      ticketsCreated,
      commentedTickets,
      usefulNotes,
      wfmTotalHours,
      wfmOutstandingHours,
      wfmFreshness
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

function buildFinalNotes_(attendanceRows, ticketRows, inProgressTickets, openTicketNotes, commentedTickets) {
  var notes = [];
  if (attendanceRows.length === 0) {
    notes.push('Missing attendance data');
  }
  if (ticketRows.length === 0) {
    notes.push('No ticket activity');
  }
  if (Number(commentedTickets || 0) > 0) {
    notes.push('Comment activity on ' + Number(commentedTickets || 0) + ' ticket(s)');
  }
  if (Number(inProgressTickets || 0) > 0) {
    notes.push('Open ticket note activity on ' + Number(inProgressTickets || 0) + ' open ticket(s)');
  }
  if (openTicketNotes) {
    notes.push(openTicketNotes);
  }
  return notes.join('; ');
}

function buildZendeskCommentActivityRows_(rawTickets) {
  var rows = rawTickets || [];
  var agentMap = getAgentEmailMap();
  var byKey = {};

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!isCommentActivityRow_(row)) {
      continue;
    }

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
    var ticketId = String(row['Ticket ID'] || '').trim();
    var key = [dateKey_(operationalDate), shift, email, ticketId || i].join('|');
    var snippet = getZendeskCommentSnippet_(row);
    var candidate = [
      dateKey_(operationalDate),
      fiscalInfo.fiscalWeek,
      fiscalInfo.fiscalMonth,
      shift,
      email,
      agentMap[email].name || row['Agent Name'] || '',
      ticketId,
      row.Status || '',
      row['Event Time'] || row['Updated At'] || '',
      row['Event Type'] || '',
      snippet,
      isOpenTicketNoteRow_(row) ? 'TRUE' : 'FALSE'
    ];

    if (!byKey[key] || parseDate_(candidate[8]).getTime() >= parseDate_(byKey[key][8]).getTime()) {
      byKey[key] = candidate;
    }
  }

  var keys = Object.keys(byKey).sort();
  var output = [];
  for (var j = 0; j < keys.length; j++) {
    output.push(byKey[keys[j]]);
  }
  return output;
}

function validateFinalReportRows_(reportType, windowInfo, rows) {
  var type = String(reportType || '').toLowerCase();
  var periodTypes = {};
  var fiscalWeeks = {};
  var fiscalMonths = {};
  for (var i = 0; i < (rows || []).length; i++) {
    periodTypes[String(rows[i][0] || '')] = true;
    if (rows[i][3]) {
      fiscalWeeks[String(rows[i][3])] = true;
    }
    if (rows[i][4]) {
      fiscalMonths[String(rows[i][4])] = true;
    }
  }

  var warnings = [];
  if (Object.keys(periodTypes).length !== 1 || !periodTypes[type]) {
    warnings.push('period type mismatch');
  }
  if (type === 'weekly' && Object.keys(fiscalWeeks).length !== 1) {
    warnings.push('weekly report has ' + Object.keys(fiscalWeeks).length + ' fiscal weeks');
  }
  if (type === 'monthly' && Object.keys(fiscalMonths).length !== 1) {
    warnings.push('monthly report has ' + Object.keys(fiscalMonths).length + ' fiscal months');
  }

  if (warnings.length) {
    logPipelineEvent_({
      reportType: 'Report View Validation',
      phase: 'current-report-view',
      status: 'WARNING',
      message: 'Current Report View validation warning for ' + type + ': ' + warnings.join('; ') + '. Window=' + formatDateTime_(windowInfo.startDate) + ' to ' + formatDateTime_(windowInfo.endDate) + '.',
      rowsProcessed: rows ? rows.length : 0
    });
  }
}

function sumColumn_(rows, index) {
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    total += Number(rows[i][index] || 0);
  }
  return total;
}

function firstPeriodValue_(rows, index) {
  for (var i = 0; i < (rows || []).length; i++) {
    if (rows[i][index] !== '' && rows[i][index] !== null && typeof rows[i][index] !== 'undefined') {
      return rows[i][index];
    }
  }
  return '';
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

  return isCommentActivityRow_(row);
}

function isCommentActivityRow_(row) {
  if (!row) {
    return false;
  }

  var eventType = String(row['Event Type'] || '').toLowerCase();
  var actionDescription = String(row['Action Description'] || '').toLowerCase();
  var commentText = String(row['Comment Text'] || '').trim();

  return Boolean(
    commentText ||
    actionDescription.indexOf('internal note') !== -1 ||
    actionDescription.indexOf('private note') !== -1 ||
    actionDescription.indexOf('note added') !== -1 ||
    actionDescription.indexOf('added note') !== -1 ||
    actionDescription.indexOf('public customer reply') !== -1 ||
    actionDescription.indexOf('public reply') !== -1 ||
    eventType.indexOf('internal note') !== -1 ||
    eventType.indexOf('private note') !== -1 ||
    eventType.indexOf('customer reply') !== -1 ||
    eventType.indexOf('public reply') !== -1 ||
    eventType.indexOf('comment') !== -1
  );
}

function addCommentedTicketToGroup_(group, row) {
  var ticketId = String(row['Ticket ID'] || '').trim();
  var ticketKey = ticketId || [row['Event Time'], row['Action Description'], row['Comment Text']].join('|');
  if (ticketKey) {
    group.commentedTicketIds[ticketKey] = true;
  }
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
  var action = getZendeskCommentSnippet_(row);
  var label = ticketId ? '#' + ticketId : 'Open ticket';
  return label + ' (' + status + '): ' + action;
}

function getZendeskCommentSnippet_(row) {
  var text = String(row && row['Comment Text'] || '').trim();
  if (!text) {
    text = 'Comment text was not available in the raw Zendesk row';
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > 220) {
    text = text.slice(0, 217) + '...';
  }
  return text;
}

function buildUsefulReportNotes_(notes, openTicketNotes) {
  var useful = [];
  if (openTicketNotes) {
    useful.push(openTicketNotes);
  }
  if (/missing attendance/i.test(notes)) {
    useful.push('Missing attendance data');
  }
  if (/no ticket activity/i.test(notes)) {
    useful.push('No ticket activity');
  }
  return uniqueValues_(useful).join('; ');
}

function buildFinalWfmBalanceMap_() {
  var records = getSheetData(SHEET_NAMES.WFM_MONTHLY_BALANCE);
  var map = {};
  for (var i = 0; i < records.length; i++) {
    map[String(records[i]['Fiscal Month'] || '') + '|' + normalizeEmail_(records[i]['Agent Email'])] = records[i];
  }
  return map;
}

function getLatestWfmUploadFreshness_() {
  var rows = getSheetData(SHEET_NAMES.WFM_UPLOAD_HISTORY);
  var latest = null;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i]['Imported At']) {
      continue;
    }
    var importedAt = parseDate_(rows[i]['Imported At']);
    if (!latest || importedAt.getTime() > latest.getTime()) {
      latest = importedAt;
    }
  }
  return latest ? formatDateTime_(latest) : 'No WFM upload history found';
}

function safeJoinText_(parts) {
  var output = [];
  for (var i = 0; i < (parts || []).length; i++) {
    var text = String(parts[i] || '').trim();
    if (text) {
      output.push(text);
    }
  }
  return output.join('; ');
}

function hasValue_(value) {
  return value !== '' && value !== null && typeof value !== 'undefined';
}
