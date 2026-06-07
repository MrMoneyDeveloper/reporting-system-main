function createTriggers() {
  deleteTriggers();

  ScriptApp.newTrigger('runShiftPullNight').timeBased().everyDays(1).atHour(8).nearMinute(30).create();
  ScriptApp.newTrigger('runShiftPullNightCatchUp').timeBased().everyDays(1).atHour(9).nearMinute(30).create();
  ScriptApp.newTrigger('runShiftPullDay').timeBased().everyDays(1).atHour(16).nearMinute(30).create();
  ScriptApp.newTrigger('runShiftPullDayCatchUp').timeBased().everyDays(1).atHour(17).nearMinute(30).create();
  ScriptApp.newTrigger('runShiftPullMid').timeBased().everyDays(1).atHour(0).nearMinute(30).create();
  ScriptApp.newTrigger('runShiftPullMidCatchUp').timeBased().everyDays(1).atHour(1).nearMinute(30).create();
  ScriptApp.newTrigger('runDailyReport').timeBased().everyDays(1).atHour(9).nearMinute(0).create();
  ScriptApp.newTrigger('runWeeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).nearMinute(15).create();
  ScriptApp.newTrigger('runMonthlyReport').timeBased().onMonthDay(1).atHour(9).nearMinute(30).create();

  return verifyDashboardDeploymentReadiness_();
}

function deleteTriggers() {
  var managedHandlers = {
    runShiftPullNight: true,
    runShiftPullNightCatchUp: true,
    runShiftPullDay: true,
    runShiftPullDayCatchUp: true,
    runShiftPullMid: true,
    runShiftPullMidCatchUp: true,
    runDailyReport: true,
    runWeeklyReport: true,
    runMonthlyReport: true,
    pollWfmEmailExportTrigger: true,
    continuePopulateJob: true,
    continueSourceSyncJobTrigger: true,
    continueAnalyticsRebuildTrigger: true
  };
  var triggers = ScriptApp.getProjectTriggers();

  for (var i = 0; i < triggers.length; i++) {
    if (managedHandlers[triggers[i].getHandlerFunction()]) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function runShiftPullNight() {
  return runShiftPull_('Night', new Date());
}

function runShiftPullNightCatchUp() {
  return runShiftPull_('Night', new Date());
}

function runShiftPullDay() {
  return runShiftPull_('Day', new Date());
}

function runShiftPullDayCatchUp() {
  return runShiftPull_('Day', new Date());
}

function runShiftPullMid() {
  return runShiftPull_('Mid', new Date());
}

function runShiftPullMidCatchUp() {
  return runShiftPull_('Mid', new Date());
}

function runDailyReport() {
  if (!isDailyEnabled()) {
    return logSkippedReport_('daily');
  }
  return runReport_('daily', new Date(), false);
}

function runWeeklyReport() {
  if (!isWeeklyEnabled()) {
    return logSkippedReport_('weekly');
  }
  return runReport_('weekly', new Date(), false);
}

function runMonthlyReport() {
  if (!isMonthlyEnabled()) {
    return logSkippedReport_('monthly');
  }
  return runReport_('monthly', new Date(), false);
}

function runShiftPull_(shift, referenceDate) {
  return startShiftSourceSyncJob_(shift, referenceDate || new Date());
}

function runReport_(reportType, referenceDate, force) {
  var runId = generateRunId();
  var startedAt = new Date();
  var rowsProcessed = 0;
  var fileLink = '';
  var emailSent = false;

  try {
    setupProject();
    var windowInfo = getReportWindow(reportType, referenceDate || new Date());

    var finalDataset = buildFinalReportDataset(reportType, windowInfo.startDate, windowInfo.endDate);
    rowsProcessed += finalDataset.length;

    var aiSummary = '';
    try {
      aiSummary = generateAiSummary(buildAiPayload(finalDataset));
    } catch (aiError) {
      logError('runReport_' + reportType + '_AI', aiError, 'CONTINUED', 0);
      aiSummary = 'AI summary failed. Report generated without AI summary.';
    }

    var report = generateExcelReport(reportType, finalDataset);
    var file = saveReportToDrive(report.blob, report.filename);
    fileLink = file.getUrl();

    writeGeneratedReportLog({
      reportType: reportType,
      periodStart: formatDateTime_(windowInfo.startDate),
      periodEnd: formatDateTime_(windowInfo.endDate),
      filename: report.filename,
      fileId: file.getId(),
      fileLink: fileLink,
      rows: report.rows
    });

    emailSent = sendReportEmail(reportType, aiSummary, file, windowInfo);

    logRun({
      runId: runId,
      reportType: reportType,
      startedAt: startedAt,
      endedAt: new Date(),
      status: 'SUCCESS',
      rowsProcessed: rowsProcessed,
      fileLink: fileLink,
      emailSent: emailSent
    });

    return { status: 'SUCCESS', fileLink: fileLink, rowsProcessed: rowsProcessed, forced: force === true };
  } catch (error) {
    logError('runReport_' + reportType, error, 'FAILED', 0);
    logRun({
      runId: runId,
      reportType: reportType,
      startedAt: startedAt,
      endedAt: new Date(),
      status: 'FAILED',
      rowsProcessed: rowsProcessed,
      fileLink: fileLink,
      emailSent: emailSent
    });
    throw error;
  }
}

function populateDataset_(reportType, referenceDate, force) {
  var runId = generateRunId();
  var startedAt = new Date();
  var rowsProcessed = 0;

  try {
    setupProject();
    var windowInfo = getReportWindow(reportType, referenceDate || new Date());

    var finalDataset = buildFinalReportDataset(reportType, windowInfo.startDate, windowInfo.endDate);
    rowsProcessed += finalDataset.length;

    logRun({
      runId: runId,
      reportType: reportType + ' Dataset Populate',
      startedAt: startedAt,
      endedAt: new Date(),
      status: 'SUCCESS',
      rowsProcessed: rowsProcessed,
      emailSent: false
    });

    return {
      status: 'SUCCESS',
      reportType: reportType,
      rowsProcessed: rowsProcessed,
      finalRows: finalDataset.length,
      window: windowInfo,
      forced: force === true
    };
  } catch (error) {
    logError('populateDataset_' + reportType, error, 'FAILED', 0);
    logRun({
      runId: runId,
      reportType: reportType + ' Dataset Populate',
      startedAt: startedAt,
      endedAt: new Date(),
      status: 'FAILED',
      rowsProcessed: rowsProcessed,
      emailSent: false
    });
    throw error;
  }
}

function startPopulateDatasetJob_(reportType, referenceDate) {
  setupProject();

  var normalizedReportType = reportType || 'daily';
  var windowInfo = getReportWindow(normalizedReportType, referenceDate || new Date());
  var agents = getActiveAgents();
  var job = {
    runId: generateRunId(),
    reportType: normalizedReportType,
    startedAt: new Date().toISOString(),
    startDate: windowInfo.startDate.toISOString(),
    endDate: windowInfo.endDate.toISOString(),
    fiscalWeek: windowInfo.fiscalWeek,
    fiscalMonth: windowInfo.fiscalMonth,
    phase: 'final',
    agentIndex: 0,
    totalAgents: agents.length,
    zendeskEndpointIndex: 0,
    zendeskEndpointCount: 0,
    zendeskNextEndpoint: '',
    rowsProcessed: 0
  };

  savePopulateJob_(job);
  clearPopulateJobContinuationTriggers_();
  logPipelineEvent_({
    runId: job.runId,
    reportType: reportType,
    phase: 'start',
    status: 'STARTED',
    message: 'Started dataset rebuild job for ' + agents.length + ' agents. Source pulls are handled by Unified Source Sync.',
    agentIndex: 0,
    totalAgents: agents.length,
    rowsProcessed: 0,
    window: windowInfo
  });
  logPopulateJobProgress_(job, 'STARTED', 'Started ' + normalizedReportType + ' dataset rebuild job for ' + agents.length + ' agents.');
  return continuePopulateJob();
}

function continuePopulateJob() {
  var job = getPopulateJob_();
  if (!job) {
    logPipelineEvent_({
      phase: 'continue',
      status: 'NO_ACTIVE_JOB',
      message: 'No active populate job was found.'
    });
    return { status: 'NO_ACTIVE_JOB' };
  }

  clearPopulateJobContinuationTriggers_();

  try {
    var result = processPopulateJob_(job);
    if (result.status === 'RUNNING') {
      savePopulateJob_(result.job);
      schedulePopulateJobContinuation_();
      return result;
    }

    clearPopulateJob_();
    logPipelineEvent_({
      runId: result.job.runId,
      reportType: result.job.reportType,
      phase: 'done',
      status: 'SUCCESS',
      message: 'Populate job completed.',
      agentIndex: result.job.agentIndex,
      totalAgents: result.job.totalAgents,
      rowsProcessed: result.job.rowsProcessed,
      startDate: result.job.startDate,
      endDate: result.job.endDate
    });
    logPopulateJobProgress_(result.job, 'SUCCESS', 'Populate job completed.');
    return result;
  } catch (error) {
    clearPopulateJobContinuationTriggers_();
    savePopulateJob_(job);
    logError('continuePopulateJob', error, 'FAILED', 0);
    logPipelineEvent_({
      runId: job.runId,
      reportType: job.reportType,
      phase: job.phase || 'unknown',
      status: 'FAILED',
      message: error.message,
      agentIndex: job.agentIndex,
      totalAgents: job.totalAgents,
      rowsProcessed: job.rowsProcessed,
      startDate: job.startDate,
      endDate: job.endDate
    });
    logPopulateJobProgress_(job, 'FAILED', error.message);
    throw error;
  }
}

function cancelPopulateJob() {
  var job = getPopulateJob_();
  clearPopulateJob_();
  clearPopulateJobContinuationTriggers_();

  if (job) {
    logPipelineEvent_({
      runId: job.runId,
      reportType: job.reportType,
      phase: job.phase || 'unknown',
      status: 'CANCELLED',
      message: 'Populate job cancelled by user.',
      agentIndex: job.agentIndex,
      totalAgents: job.totalAgents,
      rowsProcessed: job.rowsProcessed,
      startDate: job.startDate,
      endDate: job.endDate
    });
    logPopulateJobProgress_(job, 'CANCELLED', 'Populate job cancelled by user.');
  }

  return { status: 'CANCELLED' };
}

function getPopulateJobStatus() {
  var job = getPopulateJob_();
  if (!job) {
    logPipelineEvent_({
      phase: 'status',
      status: 'NO_ACTIVE_JOB',
      message: 'No active populate job was found.'
    });
    return { status: 'NO_ACTIVE_JOB' };
  }

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: job.phase || 'unknown',
    status: 'STATUS',
    message: 'Current populate job status.',
    agentIndex: job.agentIndex,
    totalAgents: job.totalAgents,
    rowsProcessed: job.rowsProcessed,
    startDate: job.startDate,
    endDate: job.endDate
  });
  return job;
}

function processPopulateJob_(job) {
  var startedAt = new Date();
  var windowInfo = {
    startDate: parseDate_(job.startDate),
    endDate: parseDate_(job.endDate),
    fiscalWeek: job.fiscalWeek,
    fiscalMonth: job.fiscalMonth
  };
  var agents = getActiveAgents();

  if (job.phase === 'zendesk' || job.phase === 'wfm') {
    job.phase = 'final';
    logPipelineEvent_({
      runId: job.runId,
      reportType: job.reportType,
      phase: 'legacy-source-pull',
      status: 'SKIPPED',
      message: 'Legacy populate job source-pull phase skipped. Source pulls now run only through Unified Source Sync.',
      agentIndex: job.agentIndex,
      totalAgents: agents.length,
      rowsProcessed: job.rowsProcessed,
      window: windowInfo
    });
    return { status: 'RUNNING', job: job };
  }

  if (job.phase === 'final') {
    logPipelineEvent_({
      runId: job.runId,
      reportType: job.reportType,
      phase: 'final',
      status: 'START',
      message: 'Building attendance, normalized tabs, and final dataset.',
      agentIndex: job.agentIndex,
      totalAgents: agents.length,
      rowsProcessed: job.rowsProcessed,
      window: windowInfo
    });

    var finalDataset = buildFinalReportDataset(job.reportType, windowInfo.startDate, windowInfo.endDate);
    job.rowsProcessed += finalDataset.length;
    job.phase = 'done';
    job.endedAt = new Date().toISOString();

    logRun({
      runId: job.runId,
      reportType: job.reportType + ' Dataset Populate Job',
      startedAt: parseDate_(job.startedAt),
      endedAt: new Date(),
      status: 'SUCCESS',
      rowsProcessed: job.rowsProcessed,
      emailSent: false
    });

    return {
      status: 'SUCCESS',
      job: job,
      rowsProcessed: job.rowsProcessed,
      finalRows: finalDataset.length,
      elapsedSeconds: Math.round((new Date().getTime() - startedAt.getTime()) / 1000)
    };
  }

  throw new Error('Unsupported populate job phase: ' + job.phase);
}

function processZendeskPopulateJobPage_(job, windowInfo, agents) {
  job.zendeskEndpointIndex = 0;
  job.zendeskEndpointCount = 1;
  job.totalAgents = agents.length;

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: 'zendesk',
    status: 'START',
    message: 'Pulling Zendesk with the combined user/ticket/audit method, capped at configured page limits.',
    agentIndex: job.agentIndex,
    totalAgents: agents.length,
    rowsProcessed: job.rowsProcessed,
    window: windowInfo
  });

  var rows = pullZendeskTickets(windowInfo.startDate, windowInfo.endDate, agents);
  var rowsWritten = writeRawZendeskTickets(rows);
  job.rowsProcessed += rowsWritten;
  job.zendeskNextEndpoint = '';
  job.zendeskEndpointIndex = 1;
  job.agentIndex = agents.length;
  job.phase = 'wfm';

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType,
    phase: 'zendesk',
    status: 'DONE',
    message: 'Zendesk pull wrote ' + rowsWritten + ' new raw rows from ' + rows.length + ' pulled action rows.',
    agentIndex: job.agentIndex,
    totalAgents: agents.length,
    rowsProcessed: job.rowsProcessed,
    window: windowInfo
  });
  logPopulateJobProgress_(job, 'ZENDESK_DONE', 'Zendesk pull completed with combined method.');
  return { status: 'RUNNING', job: job };
}

function savePopulateJob_(job) {
  PropertiesService.getScriptProperties().setProperty('POPULATE_DATASET_JOB', JSON.stringify(job));
}

function getPopulateJob_() {
  var value = PropertiesService.getScriptProperties().getProperty('POPULATE_DATASET_JOB');
  return value ? JSON.parse(value) : null;
}

function clearPopulateJob_() {
  PropertiesService.getScriptProperties().deleteProperty('POPULATE_DATASET_JOB');
}

function schedulePopulateJobContinuation_() {
  ScriptApp.newTrigger('continuePopulateJob').timeBased().after(60 * 1000).create();
}

function clearPopulateJobContinuationTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'continuePopulateJob') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function clearRetiredWfmTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'pollWfmEmailExportTrigger') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function logPopulateJobProgress_(job, status, message) {
  logRun({
    runId: job.runId,
    reportType: job.reportType + ' Dataset Populate Job',
    startedAt: parseDate_(job.startedAt),
    endedAt: new Date(),
    status: status + (message ? ' - ' + message : ''),
    rowsProcessed: job.rowsProcessed || 0,
    emailSent: false
  });
}

function logSkippedReport_(reportType) {
  var runId = generateRunId();
  logRun({
    runId: runId,
    reportType: reportType,
    startedAt: new Date(),
    endedAt: new Date(),
    status: 'SKIPPED_DISABLED',
    rowsProcessed: 0,
    emailSent: false
  });
  return { status: 'SKIPPED_DISABLED', reportType: reportType };
}
