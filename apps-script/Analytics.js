var ANALYTICS_REBUILD_JOB_KEY_ = 'ANALYTICS_REBUILD_JOB';

function startAnalyticsHistoryRebuild_() {
  setupProject();

  if (!getLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_)) {
    var startDate = getAnalyticsHistoryStart_();
    var endDate = getOperationalDayWindow(new Date()).endDate;
    saveLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_, {
      runId: generateRunId(),
      reportType: 'Analytics History Rebuild',
      startedAt: new Date().toISOString(),
      startDate: startDate.toISOString(),
      cursorDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      rowsProcessed: 0,
      daysProcessed: 0,
      phase: 'daily'
    });
  }

  return continueAnalyticsRebuild_();
}

function continueAnalyticsRebuild_() {
  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    var lockMessage = 'An analytics rebuild step is already running. Check Analytics Rebuild Status shortly.';
    logPipelineEvent_({
      reportType: 'Analytics History Rebuild',
      phase: 'analytics',
      status: 'ALREADY_RUNNING',
      message: lockMessage
    });
    return { status: 'RUNNING', message: lockMessage };
  }

  var job = null;
  try {
    setupProject();
    clearAnalyticsContinuationTriggers_();
    job = getLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_);

    if (!job) {
      logPipelineEvent_({
        reportType: 'Analytics History Rebuild',
        phase: 'analytics',
        status: 'NO_ACTIVE_JOB',
        message: 'No active analytics rebuild job was found.'
      });
      return { status: 'NO_ACTIVE_JOB' };
    }

    var result = processAnalyticsRebuildBatch_(job);
    if (result.status === 'SUCCESS') {
      clearLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_);
      clearAnalyticsContinuationTriggers_();
    } else {
      saveLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_, result.job);
      scheduleAnalyticsContinuation_();
    }
    return result;
  } catch (error) {
    if (job) {
      saveLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_, job);
      scheduleAnalyticsContinuation_();
    }
    logError('continueAnalyticsRebuild', error, 'FAILED', 0);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function continueAnalyticsRebuildTrigger() {
  return continueAnalyticsRebuild_();
}

function processAnalyticsRebuildBatch_(job) {
  var startedAt = new Date().getTime();
  var maxRuntimeMs = Math.min(getPositiveAnalyticsNumber_('ANALYTICS_MAX_RUNTIME_SECONDS', 240), 300) * 1000;
  var maxDays = getPositiveAnalyticsNumber_('ANALYTICS_DAYS_PER_EXECUTION', 7);
  var cursor = parseDate_(job.cursorDate);
  var endDate = parseDate_(job.endDate);
  var daysRun = 0;
  var rowsWritten = 0;

  while (cursor.getTime() < endDate.getTime() && daysRun < maxDays && (new Date().getTime() - startedAt) < maxRuntimeMs) {
    var windowEnd = addDays_(cursor, 1);
    if (windowEnd.getTime() > endDate.getTime()) {
      windowEnd = endDate;
    }
    var refresh = refreshAnalyticsForDateRange_(cursor, windowEnd, { rebuildRollups: false, log: false });
    rowsWritten += refresh.dailyRows || 0;
    daysRun += 1;
    cursor = windowEnd;
  }

  job.cursorDate = cursor.toISOString();
  job.rowsProcessed = Number(job.rowsProcessed || 0) + rowsWritten;
  job.daysProcessed = Number(job.daysProcessed || 0) + daysRun;

  if (cursor.getTime() >= endDate.getTime()) {
    var rollups = rebuildWeeklyMonthlyAnalyticsFromDaily_();
    job.rowsProcessed += Number(rollups.weeklyRows || 0) + Number(rollups.monthlyRows || 0);
    job.phase = 'done';
    job.endedAt = new Date().toISOString();

    logRun({
      runId: job.runId,
      reportType: job.reportType,
      startedAt: parseDate_(job.startedAt),
      endedAt: new Date(),
      status: 'SUCCESS',
      rowsProcessed: job.rowsProcessed || 0,
      emailSent: false
    });
    logPipelineEvent_({
      runId: job.runId,
      reportType: job.reportType,
      phase: 'analytics',
      status: 'SUCCESS',
      message: 'Analytics history rebuilt: daily days=' + job.daysProcessed + ', weekly rows=' + rollups.weeklyRows + ', monthly rows=' + rollups.monthlyRows + '.',
      rowsProcessed: job.rowsProcessed || 0,
      startDate: job.startDate,
      endDate: job.endDate
    });

    return { status: 'SUCCESS', job: job, rowsProcessed: job.rowsProcessed || 0 };
  }

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: 'analytics',
    status: 'AUTO_CONTINUE',
    message: 'Analytics rebuild processed ' + daysRun + ' day(s); cursor=' + dateKey_(cursor) + '.',
    rowsProcessed: job.rowsProcessed || 0,
    startDate: job.startDate,
    endDate: job.endDate
  });

  return { status: 'RUNNING', job: job, rowsProcessed: job.rowsProcessed || 0 };
}

function getAnalyticsRebuildStatus_() {
  var job = getLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_);
  if (!job) {
    logPipelineEvent_({
      reportType: 'Analytics History Rebuild',
      phase: 'analytics',
      status: 'NO_ACTIVE_JOB',
      message: 'No active analytics rebuild job was found.'
    });
    return { status: 'NO_ACTIVE_JOB' };
  }

  ensureAnalyticsContinuation_();
  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: job.phase || 'analytics',
    status: 'STATUS',
    message: 'Analytics rebuild status: cursor=' + safeSourceSyncDateKey_(job.cursorDate) + ', end=' + safeSourceSyncDateKey_(job.endDate) + ', rows=' + (job.rowsProcessed || 0) + '. Automatic continuation is scheduled.',
    rowsProcessed: job.rowsProcessed || 0,
    startDate: job.cursorDate,
    endDate: job.endDate
  });
  return job;
}

function cancelAnalyticsRebuild_() {
  var job = getLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_);
  clearLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_);
  clearAnalyticsContinuationTriggers_();

  logPipelineEvent_({
    runId: job ? job.runId : '',
    reportType: 'Analytics History Rebuild',
    phase: 'analytics',
    status: 'CANCELLED',
    message: 'Analytics rebuild job was cancelled.',
    rowsProcessed: job ? job.rowsProcessed || 0 : 0,
    startDate: job ? job.startDate : '',
    endDate: job ? job.endDate : ''
  });

  return { status: 'CANCELLED' };
}

function refreshCurrentAnalytics_() {
  setupProject();
  var endDate = getOperationalDayWindow(new Date()).endDate;
  var lookbackDays = getOptionalPositiveSourceSyncNumber_('RAW_SYNC_LOOKBACK_DAYS', 2) || 2;
  var startDate = addDays_(endDate, -Math.max(lookbackDays, 2));
  var result = refreshAnalyticsForDateRange_(startDate, endDate, { rebuildRollups: true, log: true });
  return {
    status: 'SUCCESS',
    startDate: formatDateTime_(startDate),
    endDate: formatDateTime_(endDate),
    dailyRows: result.dailyRows,
    weeklyRows: result.weeklyRows,
    monthlyRows: result.monthlyRows
  };
}

function refreshAnalyticsForDateRange_(startDate, endDate, options) {
  var opts = options || {};
  ensureAnalyticsSheets_();
  var dailyRows = buildDailyAgentMetricRowsForRange_(startDate, endDate);
  var dailyWritten = upsertAnalyticsRows_(SHEET_NAMES.DAILY_METRICS, dailyRows, [0, 3, 4]);
  var rollups = { weeklyRows: 0, monthlyRows: 0 };

  if (opts.rebuildRollups !== false) {
    rollups = rebuildWeeklyMonthlyAnalyticsFromDaily_();
  }

  if (opts.log !== false) {
    logPipelineEvent_({
      reportType: 'Analytics Refresh',
      phase: 'analytics',
      status: 'SUCCESS',
      message: 'Analytics refreshed: daily upsert=' + dailyWritten + ', weekly rows=' + rollups.weeklyRows + ', monthly rows=' + rollups.monthlyRows + '.',
      rowsProcessed: dailyWritten + Number(rollups.weeklyRows || 0) + Number(rollups.monthlyRows || 0),
      startDate: startDate,
      endDate: endDate
    });
  }
  if (typeof markDashboardAnalyticsRefresh_ === 'function') {
    markDashboardAnalyticsRefresh_('range');
  }

  return {
    status: 'SUCCESS',
    dailyRows: dailyWritten,
    weeklyRows: rollups.weeklyRows || 0,
    monthlyRows: rollups.monthlyRows || 0
  };
}

function rebuildWeeklyMonthlyAnalyticsFromDaily_() {
  ensureAnalyticsSheets_();
  var weeklyRows = buildWeeklyAgentMetricRowsFromDaily_();
  var monthlyRows = buildMonthlyAgentMetricRowsFromDaily_();
  var weeklyWritten = clearAndWriteRows(SHEET_NAMES.WEEKLY_METRICS, SHEET_HEADERS[SHEET_NAMES.WEEKLY_METRICS], weeklyRows);
  var monthlyWritten = clearAndWriteRows(SHEET_NAMES.MONTHLY_METRICS, SHEET_HEADERS[SHEET_NAMES.MONTHLY_METRICS], monthlyRows);
  if (typeof markDashboardAnalyticsRefresh_ === 'function') {
    markDashboardAnalyticsRefresh_('rollups');
  }
  return {
    weeklyRows: weeklyWritten,
    monthlyRows: monthlyWritten
  };
}

function rebuildMonthlyAgentMetricsFromDaily_() {
  ensureAnalyticsSheets_();
  var monthlyRows = buildMonthlyAgentMetricRowsFromDaily_();
  var monthlyWritten = clearAndWriteRows(SHEET_NAMES.MONTHLY_METRICS, SHEET_HEADERS[SHEET_NAMES.MONTHLY_METRICS], monthlyRows);
  if (typeof markDashboardAnalyticsRefresh_ === 'function') {
    markDashboardAnalyticsRefresh_('monthly');
  }
  logPipelineEvent_({
    reportType: 'Analytics Refresh',
    phase: 'analytics',
    status: 'SUCCESS',
    message: 'Monthly Agent Metrics rebuilt from Daily Agent Metrics and WFM Monthly Balance.',
    rowsProcessed: monthlyWritten
  });
  return {
    status: 'SUCCESS',
    monthlyRows: monthlyWritten
  };
}

function buildDailyAgentMetricRowsForRange_(startDate, endDate) {
  var output = [];
  var cursor = getOperationalDateForDateTime_(startDate);
  var finalDate = getOperationalDateForDateTime_(addMinutes_(endDate, -1));

  while (cursor.getTime() <= finalDate.getTime()) {
    output = output.concat(buildDailyAgentMetricRowsForDay_(cursor));
    cursor = addDays_(cursor, 1);
  }

  return output;
}

function buildDailyAgentMetricRowsForDay_(operationalDate) {
  var day = dateOnly_(operationalDate);
  var startDate = dateTime_(day, 8, 0);
  var endDate = addDays_(startDate, 1);
  var attendanceRows = normalizeAttendance(readAttendance(startDate, endDate));
  var ticketRows = normalizeTicketData(filterRawZendeskForWindow_(getSheetData(SHEET_NAMES.RAW_ZENDESK), startDate, endDate));
  var agents = getActiveAgents();
  var output = [];
  var updatedAt = new Date();
  var fiscalInfo = getFiscalInfo(day);

  for (var i = 0; i < agents.length; i++) {
    var agent = agents[i];
    var attendance = collectMetricRowsForAgent_(attendanceRows, agent.email, agent.shift, dateKey_(day));
    var tickets = collectMetricRowsForAgent_(ticketRows, agent.email, agent.shift, dateKey_(day));
    var shift = agent.shift || firstMetricValue_(attendance, 3) || firstMetricValue_(tickets, 3) || '';
    var attendanceStatus = uniqueMetricValues_(attendance, 6).join(', ');
    var attendanceScore = averageMetricColumn_(attendance, 10);
    var expectedHours = sumMetricColumn_(attendance, 7);
    var actualHours = sumMetricColumn_(attendance, 8);
    var lateMinutes = sumMetricColumn_(attendance, 9);
    var ticketsSolved = sumMetricColumn_(tickets, 6);
    var ticketsUpdated = sumMetricColumn_(tickets, 7);
    var ticketsCreated = sumMetricColumn_(tickets, 8);
    var ticketForms = uniqueMetricValues_(tickets, 9).join(', ');
    var ticketScore = sumMetricColumn_(tickets, 10);
    var publicReplies = sumMetricColumn_(tickets, 11);
    var otherActions = sumMetricColumn_(tickets, 12);
    var productivityActions = sumMetricColumn_(tickets, 13);
    var inProgressTickets = sumMetricColumn_(tickets, 14);
    var openTicketNotes = uniqueMetricValues_(tickets, 15).join('; ');
    var notes = buildDailyMetricNotes_(attendance, tickets, inProgressTickets, openTicketNotes);

    output.push([
      dateKey_(day),
      fiscalInfo.fiscalWeek,
      fiscalInfo.fiscalMonth,
      shift,
      agent.email,
      agent.name,
      attendanceStatus,
      attendanceScore === '' ? '' : round2_(attendanceScore),
      round2_(expectedHours),
      actualHours ? round2_(actualHours) : '',
      lateMinutes ? round2_(lateMinutes) : 0,
      ticketsSolved,
      ticketsUpdated,
      ticketsCreated,
      publicReplies,
      otherActions,
      ticketForms,
      ticketScore,
      productivityActions,
      inProgressTickets,
      openTicketNotes,
      notes,
      updatedAt
    ]);
  }

  return output;
}

function buildWeeklyAgentMetricRowsFromDaily_() {
  var daily = getSheetData(SHEET_NAMES.DAILY_METRICS);
  var groups = {};

  for (var i = 0; i < daily.length; i++) {
    var row = daily[i];
    var email = normalizeEmail_(row['Agent Email']);
    var fiscalWeek = String(row['Fiscal Week'] || '');
    if (!email || !fiscalWeek) {
      continue;
    }

    var key = fiscalWeek + '|' + email;
    if (!groups[key]) {
      var fiscal = getFiscalInfo(row.Date);
      groups[key] = createRollupGroup_(fiscalWeek, dateKey_(fiscal.weekStart), dateKey_(fiscal.weekEnd), String(row['Fiscal Month'] || ''), row);
    }
    addDailyMetricToRollupGroup_(groups[key], row);
  }

  return rollupGroupsToRows_(groups, 'weekly');
}

function buildMonthlyAgentMetricRowsFromDaily_() {
  var daily = getSheetData(SHEET_NAMES.DAILY_METRICS);
  var groups = {};

  for (var i = 0; i < daily.length; i++) {
    var row = daily[i];
    var email = normalizeEmail_(row['Agent Email']);
    var fiscalMonth = String(row['Fiscal Month'] || '');
    if (!email || !fiscalMonth) {
      continue;
    }

    var key = fiscalMonth + '|' + email;
    if (!groups[key]) {
      var fiscal = getFiscalInfo(row.Date);
      groups[key] = createRollupGroup_(fiscalMonth, dateKey_(fiscal.monthStart), dateKey_(fiscal.monthEnd), fiscalMonth, row);
    }
    addDailyMetricToRollupGroup_(groups[key], row);
  }

  return rollupGroupsToRows_(groups, 'monthly');
}

function createRollupGroup_(periodKey, startDate, endDate, fiscalMonth, seedRow) {
  return {
    periodKey: periodKey,
    startDate: startDate,
    endDate: endDate,
    fiscalMonth: fiscalMonth,
    email: normalizeEmail_(seedRow['Agent Email']),
    name: String(seedRow['Agent Name'] || ''),
    shift: String(seedRow.Shift || ''),
    attendedDates: {},
    expectedHours: 0,
    actualHours: 0,
    attendanceScoreTotal: 0,
    attendanceScoreCount: 0,
    ticketsSolved: 0,
    ticketsUpdated: 0,
    ticketsCreated: 0,
    publicReplies: 0,
    otherActions: 0,
    ticketScore: 0,
    productivityActions: 0,
    inProgressTickets: 0,
    openTicketNotes: {},
    missingAttendanceDays: 0,
    noTicketDays: 0
  };
}

function addDailyMetricToRollupGroup_(group, row) {
  if (!group.shift && row.Shift) {
    group.shift = row.Shift;
  }
  if (row['Attendance Status']) {
    group.attendedDates[dateKey_(row.Date)] = true;
  } else {
    group.missingAttendanceDays += 1;
  }
  if (row['Attendance Score'] !== '') {
    group.attendanceScoreTotal += Number(row['Attendance Score'] || 0);
    group.attendanceScoreCount += 1;
  }
  group.expectedHours += Number(row['Expected Hours'] || 0);
  group.actualHours += Number(row['Actual Hours'] || 0);
  group.ticketsSolved += Number(row['Tickets Solved'] || 0);
  group.ticketsUpdated += Number(row['Tickets Updated'] || 0);
  group.ticketsCreated += Number(row['Tickets Created'] || 0);
  group.publicReplies += Number(row['Public Replies'] || 0);
  group.otherActions += Number(row['Other Actions'] || 0);
  group.ticketScore += Number(row['Ticket Score'] || 0);
  group.productivityActions += Number(row['Productivity Actions'] || 0);
  group.inProgressTickets += Number(row['In Progress Tickets'] || 0);
  if (row['Open Ticket Notes']) {
    group.openTicketNotes[String(row['Open Ticket Notes'])] = true;
  }

  if (!Number(row['Tickets Solved'] || 0) && !Number(row['Tickets Updated'] || 0) && !Number(row['Tickets Created'] || 0)) {
    group.noTicketDays += 1;
  }
}

function rollupGroupsToRows_(groups, type) {
  var keys = Object.keys(groups).sort();
  var rows = [];
  var updatedAt = new Date();
  var wfmMap = type === 'monthly' ? buildWfmBalanceMap_() : {};

  for (var i = 0; i < keys.length; i++) {
    var group = groups[keys[i]];
    var attendancePercent = group.attendanceScoreCount ? group.attendanceScoreTotal / group.attendanceScoreCount : '';
    var attendedDays = Object.keys(group.attendedDates).length;
    var openTicketNotes = Object.keys(group.openTicketNotes || {}).join('; ');
    var notes = buildRollupNotes_(group, openTicketNotes);

    if (type === 'weekly') {
      rows.push([
        group.periodKey,
        group.startDate,
        group.endDate,
        group.fiscalMonth,
        group.email,
        group.name,
        group.shift,
        attendedDays,
        round2_(group.expectedHours),
        group.actualHours ? round2_(group.actualHours) : '',
        attendancePercent === '' ? '' : round2_(attendancePercent),
        group.ticketsSolved,
        group.ticketsUpdated,
        group.ticketsCreated,
        group.publicReplies,
        group.otherActions,
        group.ticketScore,
        group.productivityActions,
        group.inProgressTickets,
        openTicketNotes,
        notes,
        updatedAt
      ]);
    } else {
      var wfm = wfmMap[group.periodKey + '|' + group.email] || {};
      rows.push([
        group.periodKey,
        group.startDate,
        group.endDate,
        group.email,
        group.name,
        group.shift,
        attendedDays,
        round2_(group.expectedHours),
        group.actualHours ? round2_(group.actualHours) : '',
        attendancePercent === '' ? '' : round2_(attendancePercent),
        group.ticketsSolved,
        group.ticketsUpdated,
        group.ticketsCreated,
        group.publicReplies,
        group.otherActions,
        group.ticketScore,
        group.productivityActions,
        group.inProgressTickets,
        openTicketNotes,
        wfm['WFM Total Hours'] || '',
        wfm['Productive Hours'] || '',
        wfm['General Task Hours'] || '',
        wfm['Productivity %'] || '',
        wfm['Outstanding Hours'] || '',
        wfm['Surplus Hours'] || '',
        wfm.Notes || '',
        notes,
        updatedAt
      ]);
    }
  }

  return rows;
}

function buildWfmBalanceMap_() {
  var records = getSheetData(SHEET_NAMES.WFM_MONTHLY_BALANCE);
  var map = {};
  for (var i = 0; i < records.length; i++) {
    map[String(records[i]['Fiscal Month'] || '') + '|' + normalizeEmail_(records[i]['Agent Email'])] = records[i];
  }
  return map;
}

function buildDailyMetricNotes_(attendanceRows, ticketRows, inProgressTickets, openTicketNotes) {
  var notes = [];
  if (!attendanceRows.length) {
    notes.push('Missing attendance data');
  }
  if (!ticketRows.length) {
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

function buildRollupNotes_(group, openTicketNotes) {
  var notes = [];
  if (group.missingAttendanceDays) {
    notes.push('Missing attendance on ' + group.missingAttendanceDays + ' day(s)');
  }
  if (group.noTicketDays) {
    notes.push('No ticket activity on ' + group.noTicketDays + ' day(s)');
  }
  if (Number(group.inProgressTickets || 0) > 0) {
    notes.push('Open ticket note activity on ' + Number(group.inProgressTickets || 0) + ' open ticket(s)');
  }
  if (openTicketNotes) {
    notes.push(openTicketNotes);
  }
  return notes.join('; ');
}

function collectMetricRowsForAgent_(rows, email, shift, dateKey) {
  var output = [];
  var normalizedEmail = normalizeEmail_(email);
  var normalizedShift = normalizeShift_(shift);

  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i];
    if (dateKey && String(row[0] || '') !== dateKey) {
      continue;
    }
    if (normalizeEmail_(row[4]) !== normalizedEmail) {
      continue;
    }
    if (normalizedShift && normalizeShift_(row[3]) !== normalizedShift) {
      continue;
    }
    output.push(row);
  }

  return output;
}

function firstMetricValue_(rows, index) {
  for (var i = 0; i < (rows || []).length; i++) {
    if (rows[i][index] !== '' && rows[i][index] !== null && typeof rows[i][index] !== 'undefined') {
      return rows[i][index];
    }
  }
  return '';
}

function uniqueMetricValues_(rows, index) {
  var seen = {};
  var output = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var value = String(rows[i][index] || '').trim();
    if (!value || seen[value]) {
      continue;
    }
    seen[value] = true;
    output.push(value);
  }
  return output;
}

function sumMetricColumn_(rows, index) {
  var total = 0;
  for (var i = 0; i < (rows || []).length; i++) {
    total += Number(rows[i][index] || 0);
  }
  return total;
}

function averageMetricColumn_(rows, index) {
  var total = 0;
  var count = 0;
  for (var i = 0; i < (rows || []).length; i++) {
    if (rows[i][index] === '' || rows[i][index] === null || typeof rows[i][index] === 'undefined') {
      continue;
    }
    total += Number(rows[i][index] || 0);
    count += 1;
  }
  return count ? total / count : '';
}

function upsertAnalyticsRows_(sheetName, newRows, keyIndexes) {
  if (!newRows || !newRows.length) {
    return 0;
  }

  var headers = SHEET_HEADERS[sheetName];
  var existingRows = analyticsObjectsToRows_(getSheetData(sheetName), headers);
  var keys = {};
  for (var i = 0; i < newRows.length; i++) {
    keys[analyticsRowKey_(newRows[i], keyIndexes)] = true;
  }

  var keptRows = [];
  for (var j = 0; j < existingRows.length; j++) {
    if (!keys[analyticsRowKey_(existingRows[j], keyIndexes)]) {
      keptRows.push(existingRows[j]);
    }
  }

  var finalRows = keptRows.concat(newRows);
  finalRows.sort(function (left, right) {
    return analyticsRowKey_(left, keyIndexes).localeCompare(analyticsRowKey_(right, keyIndexes));
  });
  clearAndWriteRows(sheetName, headers, finalRows);
  return newRows.length;
}

function analyticsRowKey_(row, indexes) {
  var parts = [];
  for (var i = 0; i < indexes.length; i++) {
    var value = row[indexes[i]];
    if (value instanceof Date) {
      value = dateKey_(value);
    }
    parts.push(String(value || ''));
  }
  return parts.join('|');
}

function analyticsObjectsToRows_(records, headers) {
  var rows = [];
  for (var i = 0; i < (records || []).length; i++) {
    var row = [];
    for (var j = 0; j < headers.length; j++) {
      row.push(Object.prototype.hasOwnProperty.call(records[i], headers[j]) ? records[i][headers[j]] : '');
    }
    rows.push(row);
  }
  return rows;
}

function ensureAnalyticsSheets_() {
  ensureSheet(SHEET_NAMES.DAILY_METRICS, SHEET_HEADERS[SHEET_NAMES.DAILY_METRICS]);
  ensureSheet(SHEET_NAMES.WEEKLY_METRICS, SHEET_HEADERS[SHEET_NAMES.WEEKLY_METRICS]);
  ensureSheet(SHEET_NAMES.MONTHLY_METRICS, SHEET_HEADERS[SHEET_NAMES.MONTHLY_METRICS]);
  ensureSheet(SHEET_NAMES.CURRENT_REPORT_VIEW, SHEET_HEADERS[SHEET_NAMES.CURRENT_REPORT_VIEW]);
}

function scheduleAnalyticsContinuation_() {
  var delaySeconds = getPositiveAnalyticsNumber_('ANALYTICS_CONTINUATION_DELAY_SECONDS', 60);
  ScriptApp.newTrigger('continueAnalyticsRebuildTrigger').timeBased().after(delaySeconds * 1000).create();
}

function ensureAnalyticsContinuation_() {
  if (!hasAnalyticsContinuationTrigger_()) {
    scheduleAnalyticsContinuation_();
  }
}

function hasAnalyticsContinuationTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'continueAnalyticsRebuildTrigger') {
      return true;
    }
  }
  return false;
}

function clearAnalyticsContinuationTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'continueAnalyticsRebuildTrigger') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function getAnalyticsHistoryStart_() {
  var configured = parseOptionalDate_(getConfigValue('ANALYTICS_HISTORY_START_DATE', '2026-04-01'));
  return dateTime_(configured || dateOnly_('2026-04-01'), 8, 0);
}

function getPositiveAnalyticsNumber_(key, defaultValue) {
  var value = Number(getConfigValue(key, '') || getScriptProperty_(key) || defaultValue);
  if (!value || value < 1) {
    return defaultValue;
  }
  return value;
}
