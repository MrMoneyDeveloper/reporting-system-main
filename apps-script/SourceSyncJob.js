var SOURCE_SYNC_JOB_KEY_ = 'SOURCE_SYNC_JOB';
var SOURCE_SYNC_LAST_END_KEY_ = 'SOURCE_SYNC_LAST_END';

function startFiscalBackfillSourceSyncJob_(referenceDate) {
  if (!getLargeScriptState_(SOURCE_SYNC_JOB_KEY_)) {
    saveLargeScriptState_(SOURCE_SYNC_JOB_KEY_, createSourceSyncJob_('backfill', referenceDate || new Date()));
  }
  return continueSourceSyncJob_('continue', referenceDate || new Date());
}

function startAprilToDateSourceBackfill_(referenceDate) {
  if (!getLargeScriptState_(SOURCE_SYNC_JOB_KEY_)) {
    saveLargeScriptState_(SOURCE_SYNC_JOB_KEY_, createSourceSyncJob_('historical', referenceDate || new Date()));
  }
  return continueSourceSyncJob_('continue', referenceDate || new Date());
}

function startApril2026SourceBackfill_(referenceDate) {
  return startSourceMonthBackfill_('2026-04', referenceDate || new Date());
}

function startMay2026SourceBackfill_(referenceDate) {
  return startSourceMonthBackfill_('2026-05', referenceDate || new Date());
}

function startCurrentMonthSourceBackfill_(referenceDate) {
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();
  return startSourceMonthBackfill_(formatSourceSyncMonthKey_(reference), reference);
}

function startSourceMonthBackfill_(monthKey, referenceDate) {
  var monthInfo = parseSourceSyncMonthKey_(monthKey);
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();
  var startDate = dateTime_(monthInfo.startDate, 8, 0);
  var endDate = dateTime_(addDays_(monthInfo.endDate, 1), 8, 0);
  var currentMonthKey = formatSourceSyncMonthKey_(reference);

  if (monthInfo.key === currentMonthKey) {
    var currentEnd = getOperationalDayWindow(reference).endDate;
    if (currentEnd.getTime() < endDate.getTime()) {
      endDate = currentEnd;
    }
  }

  return startSourceSyncRangeJob_(startDate, endDate, 'calendar month ' + monthInfo.key, reference);
}

function startSourceSyncRangeJob_(startDate, endDate, label, referenceDate) {
  var activeJob = getLargeScriptState_(SOURCE_SYNC_JOB_KEY_);
  if (!activeJob) {
    saveLargeScriptState_(SOURCE_SYNC_JOB_KEY_, createSourceSyncRangeJob_(startDate, endDate, label));
  } else {
    logPipelineEvent_({
      runId: activeJob.runId || '',
      reportType: activeJob.reportType || 'Unified Source Sync',
      phase: activeJob.phase || 'source-sync',
      status: 'ALREADY_ACTIVE',
      message: 'A source-sync job is already active. Continue or cancel it before starting ' + (label || 'another range') + '.',
      rowsProcessed: activeJob.rowsProcessed || 0,
      startDate: activeJob.currentWindowStart || activeJob.startDate,
      endDate: activeJob.currentWindowEnd || activeJob.endDate
    });
  }
  return continueSourceSyncJob_('continue', referenceDate || new Date());
}

function startCurrentShiftSourceSyncJob_(referenceDate) {
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();
  return startShiftSourceSyncJob_(getLastClosedShiftName_(reference), reference);
}

function startShiftSourceSyncJob_(shift, referenceDate) {
  if (!getLargeScriptState_(SOURCE_SYNC_JOB_KEY_)) {
    saveLargeScriptState_(SOURCE_SYNC_JOB_KEY_, createSourceSyncJob_('shift', referenceDate || new Date(), shift));
  }
  return continueSourceSyncJob_('continue', referenceDate || new Date());
}

function continueSourceSyncJob_(mode, referenceDate) {
  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    var lockMessage = 'A unified source-sync step is already running. Wait for it to finish, then check Source Sync Status.';
    logPipelineEvent_({
      reportType: 'Unified Source Sync',
      phase: 'source-sync',
      status: 'ALREADY_RUNNING',
      message: lockMessage
    });
    return {
      status: 'RUNNING',
      message: lockMessage
    };
  }

  var job = null;
  try {
    setupProject();
    clearSourceSyncContinuationTriggers_();

    job = getLargeScriptState_(SOURCE_SYNC_JOB_KEY_);
    if (!job && mode !== 'continue') {
      job = createSourceSyncJob_(mode || 'shift', referenceDate || new Date());
    }

    if (!job) {
      logPipelineEvent_({
        reportType: 'Unified Source Sync',
        phase: 'source-sync',
        status: 'NO_ACTIVE_JOB',
        message: 'No active source-sync job was found.'
      });
      return { status: 'NO_ACTIVE_JOB' };
    }

    var result = processSourceSyncJobBatch_(job);
    job = result.job || job;
    if (result.status === 'SUCCESS' || result.status === 'NO_WORK') {
      clearLargeScriptState_(SOURCE_SYNC_JOB_KEY_);
    } else {
      saveLargeScriptState_(SOURCE_SYNC_JOB_KEY_, result.job);
      scheduleSourceSyncContinuation_();
    }

    return result;
  } catch (error) {
    return handleSourceSyncError_(job || getLargeScriptState_(SOURCE_SYNC_JOB_KEY_), error);
  } finally {
    lock.releaseLock();
  }
}

function continueSourceSyncJobTrigger() {
  return continueSourceSyncJob_('continue', new Date());
}

function processSourceSyncJobBatch_(job) {
  var startedAt = new Date().getTime();
  var maxSteps = getPositiveSourceSyncNumber_('SOURCE_SYNC_STEPS_PER_EXECUTION', 10);
  var maxRuntimeSeconds = Math.min(getPositiveSourceSyncNumber_('SOURCE_SYNC_MAX_RUNTIME_SECONDS', 240), 300);
  var maxRuntimeMs = maxRuntimeSeconds * 1000;
  var result = {
    status: 'RUNNING',
    job: job,
    rowsProcessed: job.rowsProcessed || 0,
    message: ''
  };
  var stepsRun = 0;

  while (stepsRun < maxSteps && (new Date().getTime() - startedAt) < maxRuntimeMs) {
    result = processSourceSyncJobStep_(job);
    stepsRun += 1;
    job = result.job || job;

    if (result.status === 'SUCCESS' || result.status === 'NO_WORK') {
      result.stepsRun = stepsRun;
      return result;
    }
  }

  result.job = job;
  result.status = result.status || 'RUNNING';
  result.stepsRun = stepsRun;
  result.rowsProcessed = job.rowsProcessed || 0;

  if (result.status === 'RUNNING') {
    logPipelineEvent_({
      runId: job.runId,
      reportType: job.reportType || 'Unified Source Sync',
      phase: job.phase || 'source-sync',
      status: 'AUTO_CONTINUE',
      message: 'Processed ' + stepsRun + ' source-sync step(s) this execution; automatic continuation will run again.',
      rowsProcessed: job.rowsProcessed || 0,
      startDate: job.currentWindowStart || job.startDate,
      endDate: job.currentWindowEnd || job.endDate
    });
  }

  return result;
}

function createSourceSyncJob_(mode, referenceDate, shift) {
  var normalizedMode = String(mode || 'shift').toLowerCase();
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();
  var startDate;
  var endDate;
  var shiftName = shift ? normalizeShift_(shift) : '';

  if (normalizedMode === 'historical') {
    startDate = getHistoricalSourceStart_();
    endDate = getOperationalDayWindow(reference).endDate;
  } else if (normalizedMode === 'backfill') {
    startDate = getCurrentFiscalYearSourceStart_(reference);
    endDate = getOperationalDayWindow(reference).endDate;
  } else {
    shiftName = shiftName || getLastClosedShiftName_(reference);
    var shiftWindow = getShiftWindow(shiftName, reference);
    var lookbackDays = getOptionalPositiveSourceSyncNumber_('RAW_SYNC_LOOKBACK_DAYS', 2);
    startDate = lookbackDays ? addDays_(shiftWindow.startDate, -lookbackDays) : addMinutes_(shiftWindow.startDate, -getPositiveSourceSyncNumber_('RAW_SYNC_SHIFT_LOOKBACK_MINUTES', 30));
    endDate = shiftWindow.endDate;
  }

  if (startDate.getTime() > endDate.getTime()) {
    startDate = endDate;
  }

  return buildSourceSyncJob_(normalizedMode, startDate, endDate, shiftName, '');
}

function createSourceSyncRangeJob_(startDate, endDate, label) {
  var start = parseDate_(startDate);
  var end = parseDate_(endDate);
  if (start.getTime() > end.getTime()) {
    start = end;
  }
  return buildSourceSyncJob_('range', start, end, '', label || '');
}

function buildSourceSyncJob_(mode, startDate, endDate, shiftName, label) {
  return {
    runId: generateRunId(),
    mode: mode || 'shift',
    reportType: 'Unified Source Sync',
    startedAt: new Date().toISOString(),
    phase: 'prepare',
    sourcePhase: '',
    shift: shiftName || '',
    label: label || '',
    startDate: startDate.toISOString(),
    cursorDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    currentWindowStart: '',
    currentWindowEnd: '',
    retryCount: 0,
    rowsProcessed: 0,
    windowsProcessed: 0,
    rowsBySource: {
      zendesk: 0,
      wfm: 0,
      attendance: 0,
      rebuild: 0
    },
    rowsThisWindow: {
      zendesk: 0,
      wfm: 0,
      attendance: 0,
      rebuild: 0
    },
    zendeskTarget: null,
    zendeskGroupMap: null,
    zendeskJob: null,
    lastError: ''
  };
}

function processSourceSyncJobStep_(job) {
  job = normalizeSourceSyncJob_(job);

  if (job.phase === 'prepare') {
    return prepareSourceSyncWindow_(job);
  }

  if (job.phase === 'zendesk') {
    return processSourceSyncZendesk_(job);
  }

  if (job.phase === 'wfm') {
    return processSourceSyncWfm_(job);
  }

  if (job.phase === 'attendance') {
    return processSourceSyncAttendance_(job);
  }

  if (job.phase === 'rebuild') {
    return processSourceSyncRebuild_(job);
  }

  if (job.phase === 'advance') {
    return advanceSourceSyncWindow_(job);
  }

  throw new Error('Unsupported source-sync phase: ' + job.phase);
}

function prepareSourceSyncWindow_(job) {
  var cursor = parseDate_(job.cursorDate);
  var endDate = parseDate_(job.endDate);

  if (cursor.getTime() >= endDate.getTime()) {
    return finishSourceSyncJob_(job, 'SUCCESS', 'Unified source sync completed.');
  }

  var windowEnd = (job.mode === 'backfill' || job.mode === 'historical' || job.mode === 'range') ? addDays_(cursor, 1) : endDate;
  if (windowEnd.getTime() > endDate.getTime()) {
    windowEnd = endDate;
  }

  job.currentWindowStart = cursor.toISOString();
  job.currentWindowEnd = windowEnd.toISOString();
  job.rowsThisWindow = { zendesk: 0, wfm: 0, attendance: 0, rebuild: 0 };
  job.retryCount = 0;
  job.lastError = '';
  job.phase = 'zendesk';

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: 'window',
    status: 'START',
    message: 'Starting unified source window ' + formatDateTime_(cursor) + ' to ' + formatDateTime_(windowEnd) + '.',
    rowsProcessed: job.rowsProcessed || 0,
    startDate: cursor,
    endDate: windowEnd
  });

  return processSourceSyncZendesk_(job);
}

function processSourceSyncZendesk_(job) {
  if (!job.zendeskJob) {
    job.zendeskJob = createSourceSyncZendeskJob_(job);
  }

  var result = processZendeskOnlyJobStep_(job.zendeskJob);
  job.zendeskJob = result.job;
  job.sourcePhase = job.zendeskJob.phase;

  if (job.zendeskJob.phase === 'normalize' || result.status === 'SUCCESS') {
    var rowsWritten = Number(job.zendeskJob.rowsProcessed || 0);
    job.zendeskTarget = job.zendeskJob.target || job.zendeskTarget;
    job.zendeskGroupMap = job.zendeskJob.groupMap || job.zendeskGroupMap;
    job.rowsThisWindow.zendesk = rowsWritten;
    job.rowsBySource.zendesk = Number(job.rowsBySource.zendesk || 0) + rowsWritten;
    job.rowsProcessed += rowsWritten;
    job.zendeskJob = null;
    job.sourcePhase = '';
    job.phase = 'attendance';
    job.retryCount = 0;

    logPipelineEvent_({
      runId: job.runId,
      reportType: job.reportType,
      phase: 'zendesk',
      status: 'DONE',
      message: 'Zendesk source phase completed and wrote ' + rowsWritten + ' raw rows.',
      rowsProcessed: job.rowsProcessed || 0,
      startDate: job.currentWindowStart,
      endDate: job.currentWindowEnd
    });
  }

  return sourceSyncRunningResult_(job, 'Zendesk phase is ' + job.phase + '.');
}

function createSourceSyncZendeskJob_(job) {
  var cachedTarget = job.zendeskTarget || null;
  var cachedGroupMap = job.zendeskGroupMap || null;
  var hasCachedTarget = cachedTarget && cachedTarget.userById && Object.keys(cachedTarget.userById).length > 0;

  return {
    runId: job.runId,
    reportType: job.reportType,
    startedAt: job.startedAt,
    phase: hasCachedTarget ? 'searchCreated' : 'resolveUsers',
    agentIndex: hasCachedTarget ? getActiveAgents().length : 0,
    rowsProcessed: 0,
    startDate: parseDate_(job.currentWindowStart).toISOString(),
    endDate: parseDate_(job.currentWindowEnd).toISOString(),
    target: hasCachedTarget ? cachedTarget : {
      userById: {},
      agentByUserId: {},
      warnings: []
    },
    createdIds: [],
    solvedIds: [],
    updatedIds: [],
    createdNextUrl: '',
    solvedNextUrl: '',
    updatedNextUrl: '',
    createdSearchStarted: false,
    solvedSearchStarted: false,
    updatedSearchStarted: false,
    createdPages: 0,
    solvedPages: 0,
    updatedPages: 0,
    createdIndex: 0,
    auditIndex: 0,
    solvedIndex: 0,
    processedSolved: {},
    groupMap: cachedGroupMap || {}
  };
}

function processSourceSyncWfm_(job) {
  job.rowsThisWindow.wfm = 0;
  job.rowsBySource.wfm = Number(job.rowsBySource.wfm || 0);
  job.phase = 'attendance';
  job.retryCount = 0;

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: 'wfm',
    status: 'SKIPPED',
    message: 'Daily WFM source pull is retired. Monthly WFM balance is imported from WFM Upload.',
    rowsProcessed: job.rowsProcessed || 0,
    startDate: job.currentWindowStart,
    endDate: job.currentWindowEnd
  });

  return sourceSyncRunningResult_(job, 'WFM phase completed.');
}

function processSourceSyncAttendance_(job) {
  var result = syncAttendanceFromSourceDetailed_(parseDate_(job.currentWindowStart), parseDate_(job.currentWindowEnd));
  if (result.status === 'FAILED') {
    throw new Error(result.message || 'Attendance source sync failed.');
  }
  var rowsWritten = Number(result.rowsWritten || 0);

  job.rowsThisWindow.attendance = rowsWritten;
  job.rowsBySource.attendance = Number(job.rowsBySource.attendance || 0) + rowsWritten;
  job.rowsProcessed += rowsWritten;
  job.phase = job.mode === 'shift' ? 'rebuild' : 'advance';
  job.retryCount = 0;

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: 'attendance',
    status: result.status || 'SUCCESS',
    message: 'Attendance source=' + result.sourceRows + ', mapped=' + result.mappedRows + ', filtered=' + result.filteredRows + ', unmatched=' + result.unmatchedRows + ', wrote=' + rowsWritten + '. ' + (result.message || ''),
    rowsProcessed: job.rowsProcessed || 0,
    startDate: job.currentWindowStart,
    endDate: job.currentWindowEnd
  });

  return sourceSyncRunningResult_(job, 'Attendance phase completed.');
}

function processSourceSyncRebuild_(job) {
  var reportWindow = buildSourceSyncDailyWindowForCurrentWindow_(job);
  var finalRows = buildFinalReportDataset('daily', reportWindow.startDate, reportWindow.endDate);

  job.rowsThisWindow.rebuild = finalRows.length;
  job.rowsBySource.rebuild = Number(job.rowsBySource.rebuild || 0) + finalRows.length;
  job.rowsProcessed += finalRows.length;
  job.phase = 'advance';
  job.retryCount = 0;

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: 'rebuild',
    status: 'DONE',
    message: 'Rebuilt current daily dataset from raw rows with ' + finalRows.length + ' final rows.',
    rowsProcessed: job.rowsProcessed || 0,
    startDate: reportWindow.startDate,
    endDate: reportWindow.endDate
  });

  return sourceSyncRunningResult_(job, 'Rebuild phase completed.');
}

function advanceSourceSyncWindow_(job) {
  var windowStart = parseDate_(job.currentWindowStart);
  var windowEnd = parseDate_(job.currentWindowEnd);
  var analyticsMessage = '';

  if (typeof refreshAnalyticsForDateRange_ === 'function') {
    try {
      var analytics = refreshAnalyticsForDateRange_(windowStart, windowEnd, {
        rebuildRollups: job.mode === 'shift',
        log: false
      });
      analyticsMessage = ' Analytics daily upsert=' + analytics.dailyRows + (job.mode === 'shift' ? ', weekly=' + analytics.weeklyRows + ', monthly=' + analytics.monthlyRows : '') + '.';
    } catch (analyticsError) {
      logError('advanceSourceSyncWindow_analytics', analyticsError, 'CONTINUED', 0);
      analyticsMessage = ' Analytics refresh failed: ' + analyticsError.message;
    }
  }

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: 'window',
    status: 'DONE',
    message: 'Completed unified source window ' + formatDateTime_(windowStart) + ' to ' + formatDateTime_(windowEnd) + ': Zendesk wrote ' + job.rowsThisWindow.zendesk + ', Attendance wrote ' + job.rowsThisWindow.attendance + '.' + analyticsMessage,
    rowsProcessed: job.rowsProcessed || 0,
    startDate: windowStart,
    endDate: windowEnd
  });

  job.windowsProcessed = Number(job.windowsProcessed || 0) + 1;
  job.cursorDate = windowEnd.toISOString();
  job.currentWindowStart = '';
  job.currentWindowEnd = '';
  job.rowsThisWindow = { zendesk: 0, wfm: 0, attendance: 0, rebuild: 0 };
  job.phase = 'prepare';
  job.retryCount = 0;

  if (parseDate_(job.cursorDate).getTime() >= parseDate_(job.endDate).getTime()) {
    return finishSourceSyncJob_(job, 'SUCCESS', 'Unified source sync completed.');
  }

  return sourceSyncRunningResult_(job, 'Advanced to next source window.');
}

function finishSourceSyncJob_(job, status, message) {
  if (status === 'SUCCESS' && typeof rebuildWeeklyMonthlyAnalyticsFromDaily_ === 'function') {
    try {
      var rollups = rebuildWeeklyMonthlyAnalyticsFromDaily_();
      message += ' Analytics rollups refreshed: weekly rows=' + rollups.weeklyRows + ', monthly rows=' + rollups.monthlyRows + '.';
    } catch (analyticsError) {
      logError('finishSourceSyncJob_analytics', analyticsError, 'CONTINUED', 0);
      message += ' Analytics rollup refresh failed: ' + analyticsError.message;
    }
  }

  if (status === 'SUCCESS' && (job.mode === 'backfill' || job.mode === 'historical')) {
    var currentWindow = getCurrentOpenOperationalDayWindow_(new Date());
    try {
      var finalRows = buildFinalReportDataset('daily', currentWindow.startDate, currentWindow.endDate);
      job.rowsBySource.rebuild = Number(job.rowsBySource.rebuild || 0) + finalRows.length;
      job.rowsProcessed += finalRows.length;
      message += ' Current daily dataset rebuilt with ' + finalRows.length + ' final rows.';
    } catch (rebuildError) {
      logError('finishSourceSyncJob_rebuild', rebuildError, 'CONTINUED', 0);
      message += ' Current daily dataset rebuild failed: ' + rebuildError.message;
    }
  }

  job.endedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(SOURCE_SYNC_LAST_END_KEY_, dateKey_(job.endDate));
  if (status === 'SUCCESS' && typeof markDashboardSourceSyncComplete_ === 'function') {
    markDashboardSourceSyncComplete_(job);
  }

  logRun({
    runId: job.runId,
    reportType: job.reportType,
    startedAt: parseDate_(job.startedAt),
    endedAt: new Date(),
    status: status,
    rowsProcessed: job.rowsProcessed || 0,
    emailSent: false
  });

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: 'source-sync',
    status: status,
    message: message,
    rowsProcessed: job.rowsProcessed || 0,
    startDate: job.startDate,
    endDate: job.endDate
  });

  return {
    status: status,
    job: job,
    rowsProcessed: job.rowsProcessed || 0,
    message: message
  };
}

function rebuildCurrentReportDataset_() {
  setupProject();
  var startedAt = new Date();
  var runId = generateRunId();
  var windowInfo = getCurrentOpenOperationalDayWindow_(new Date());
  var rows = buildFinalReportDataset('daily', windowInfo.startDate, windowInfo.endDate);

  logRun({
    runId: runId,
    reportType: 'Dataset Rebuild',
    startedAt: startedAt,
    endedAt: new Date(),
    status: 'SUCCESS',
    rowsProcessed: rows.length,
    emailSent: false
  });

  logPipelineEvent_({
    runId: runId,
    reportType: 'Dataset Rebuild',
    phase: 'rebuild',
    status: 'SUCCESS',
    message: 'Rebuilt current daily dataset from existing raw rows.',
    rowsProcessed: rows.length,
    window: windowInfo
  });

  return {
    status: 'SUCCESS',
    rowsProcessed: rows.length,
    window: windowInfo
  };
}

function getSourceSyncJobStatus_() {
  var job = getLargeScriptState_(SOURCE_SYNC_JOB_KEY_);
  if (!job) {
    logPipelineEvent_({
      reportType: 'Unified Source Sync',
      phase: 'source-sync',
      status: 'NO_ACTIVE_JOB',
      message: 'No active unified source-sync job was found.'
    });
    return { status: 'NO_ACTIVE_JOB' };
  }

  ensureSourceSyncContinuation_();

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: job.phase || 'source-sync',
    status: 'STATUS',
    message: 'Current source-sync status: phase=' + job.phase + ', cursor=' + safeSourceSyncDateKey_(job.cursorDate) + ', end=' + safeSourceSyncDateKey_(job.endDate) + '. Automatic continuation is scheduled.',
    rowsProcessed: job.rowsProcessed || 0,
    startDate: job.currentWindowStart || job.startDate,
    endDate: job.currentWindowEnd || job.endDate
  });

  return job;
}

function cancelSourceSyncJob_() {
  var job = getLargeScriptState_(SOURCE_SYNC_JOB_KEY_);
  clearLargeScriptState_(SOURCE_SYNC_JOB_KEY_);
  clearSourceSyncContinuationTriggers_();

  logPipelineEvent_({
    runId: job ? job.runId : '',
    reportType: 'Unified Source Sync',
    phase: 'source-sync',
    status: 'CANCELLED',
    message: 'Unified source-sync job was cancelled.',
    rowsProcessed: job ? job.rowsProcessed || 0 : 0,
    startDate: job ? job.startDate : '',
    endDate: job ? job.endDate : ''
  });

  return { status: 'CANCELLED' };
}

function handleSourceSyncError_(job, error) {
  if (!job) {
    logError('continueSourceSyncJob', error, 'FAILED', 0);
    throw error;
  }

  job.retryCount = Number(job.retryCount || 0) + 1;
  job.lastError = compactLogMessage_(error.message || String(error));
  var maxRetries = getPositiveSourceSyncNumber_('SOURCE_SYNC_MAX_RETRIES', 3);

  logError('continueSourceSyncJob_' + (job.phase || 'unknown'), error, job.retryCount <= maxRetries ? 'RETRYING' : 'FAILED', job.retryCount);
  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType || 'Unified Source Sync',
    phase: job.phase || 'source-sync',
    status: job.retryCount <= maxRetries ? 'RETRYING' : 'FAILED',
    message: 'Source sync error on same window, retry ' + job.retryCount + ' of ' + maxRetries + ': ' + job.lastError,
    rowsProcessed: job.rowsProcessed || 0,
    startDate: job.currentWindowStart || job.startDate,
    endDate: job.currentWindowEnd || job.endDate
  });

  saveLargeScriptState_(SOURCE_SYNC_JOB_KEY_, job);
  if (job.retryCount <= maxRetries) {
    scheduleSourceSyncContinuation_();
    return {
      status: 'RETRYING',
      job: job,
      message: job.lastError
    };
  }

  return {
    status: 'FAILED',
    job: job,
    message: job.lastError
  };
}

function sourceSyncRunningResult_(job, message) {
  return {
    status: 'RUNNING',
    job: job,
    phase: job.phase,
    rowsProcessed: job.rowsProcessed || 0,
    message: message || ''
  };
}

function scheduleSourceSyncContinuation_() {
  var delaySeconds = getPositiveSourceSyncNumber_('SOURCE_SYNC_CONTINUATION_DELAY_SECONDS', 60);
  ScriptApp.newTrigger('continueSourceSyncJobTrigger').timeBased().after(delaySeconds * 1000).create();
}

function ensureSourceSyncContinuation_() {
  if (!hasSourceSyncContinuationTrigger_()) {
    scheduleSourceSyncContinuation_();
  }
}

function hasSourceSyncContinuationTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'continueSourceSyncJobTrigger') {
      return true;
    }
  }

  return false;
}

function clearSourceSyncContinuationTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'continueSourceSyncJobTrigger') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function normalizeSourceSyncJob_(job) {
  job.reportType = job.reportType || 'Unified Source Sync';
  job.phase = job.phase || 'prepare';
  job.rowsBySource = job.rowsBySource || { zendesk: 0, wfm: 0, attendance: 0, rebuild: 0 };
  job.rowsThisWindow = job.rowsThisWindow || { zendesk: 0, wfm: 0, attendance: 0, rebuild: 0 };
  job.windowsProcessed = Number(job.windowsProcessed || 0);
  job.retryCount = Number(job.retryCount || 0);
  return job;
}

function getCurrentFiscalYearSourceStart_(referenceDate) {
  var reference = referenceDate ? dateOnly_(referenceDate) : dateOnly_(new Date());
  var fiscalInfo = getFiscalInfo(reference);
  var rows = getSheetData(SHEET_NAMES.FISCAL_CALENDAR);
  var earliest = null;

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Fiscal Year'] || '') !== String(fiscalInfo.fiscalYear || '')) {
      continue;
    }

    var candidate = dateOnly_(rows[i].Date);
    if (!earliest || candidate.getTime() < earliest.getTime()) {
      earliest = candidate;
    }
  }

  if (!earliest) {
    var yearMatch = String(fiscalInfo.fiscalYear || '').match(/20\d{2}/);
    earliest = yearMatch ? getFiscalYearStart_(Number(yearMatch[0])) : dateOnly_(getConfigValue('RAW_SYNC_BACKFILL_START_DATE', '2025-12-28'));
  }

  var configuredStart = parseOptionalDate_(getConfigValue('RAW_SYNC_BACKFILL_START_DATE', ''));
  if (configuredStart && configuredStart.getTime() > earliest.getTime()) {
    earliest = configuredStart;
  }

  var maxDays = getOptionalPositiveSourceSyncNumber_('RAW_SYNC_BACKFILL_MAX_DAYS', 7);
  if (maxDays) {
    var cappedStart = addDays_(reference, -maxDays);
    if (cappedStart.getTime() > earliest.getTime()) {
      earliest = cappedStart;
    }
  }

  return dateTime_(earliest, 8, 0);
}

function getHistoricalSourceStart_() {
  var configuredStart = parseOptionalDate_(getConfigValue('HISTORICAL_SYNC_START_DATE', '2026-04-01'));
  var startDate = configuredStart || dateOnly_('2026-04-01');
  return dateTime_(startDate, 8, 0);
}

function parseSourceSyncMonthKey_(monthKey) {
  var text = String(monthKey || '').trim();
  var match = text.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error('Invalid source sync month: ' + monthKey + '. Use yyyy-MM.');
  }

  var year = Number(match[1]);
  var month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error('Invalid source sync month: ' + monthKey + '. Use yyyy-MM.');
  }

  return {
    key: year + '-' + pad2_(month),
    startDate: new Date(year, month - 1, 1),
    endDate: new Date(year, month, 0)
  };
}

function formatSourceSyncMonthKey_(dateValue) {
  var date = dateOnly_(dateValue);
  return date.getFullYear() + '-' + pad2_(date.getMonth() + 1);
}

function parseOptionalDate_(value) {
  if (!value) {
    return null;
  }

  try {
    return dateOnly_(value);
  } catch (error) {
    return null;
  }
}

function getLastClosedShiftName_(referenceDate) {
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();
  var hour = reference.getHours();

  if (hour >= 8 && hour < 16) {
    return 'Night';
  }
  if (hour >= 16) {
    return 'Day';
  }
  return 'Mid';
}

function buildSourceSyncDailyWindowForCurrentWindow_(job) {
  var windowStart = parseDate_(job.currentWindowStart || job.cursorDate || new Date());
  var operationalDate = getOperationalDateForDateTime_(windowStart);
  var start = dateTime_(operationalDate, 8, 0);
  var end = addDays_(start, 1);
  var fiscalInfo = getFiscalInfo(operationalDate);
  return buildWindow_('daily', start, end, fiscalInfo);
}

function getCurrentOpenOperationalDayWindow_(referenceDate) {
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();
  var operationalDate = getOperationalDateForDateTime_(reference);
  var start = dateTime_(operationalDate, 8, 0);
  var end = addDays_(start, 1);
  var fiscalInfo = getFiscalInfo(operationalDate);
  return buildWindow_('daily', start, end, fiscalInfo);
}

function safeSourceSyncDateKey_(value) {
  if (!value) {
    return '';
  }

  try {
    return dateKey_(value);
  } catch (error) {
    return String(value);
  }
}

function getPositiveSourceSyncNumber_(key, defaultValue) {
  var value = Number(getConfigValue(key, '') || getScriptProperty_(key) || defaultValue);
  if (!value || value < 1) {
    return defaultValue;
  }
  return value;
}

function getOptionalPositiveSourceSyncNumber_(key, defaultValue) {
  var raw = getConfigValue(key, '');
  if (raw === '' || raw === null || typeof raw === 'undefined') {
    raw = getScriptProperty_(key);
  }
  if (raw === '' || raw === null || typeof raw === 'undefined') {
    raw = defaultValue;
  }

  var value = Number(raw);
  if (!value || value < 1) {
    return 0;
  }
  return value;
}
