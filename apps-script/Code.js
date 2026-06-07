function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Reporting Engine')
    .addItem('Setup / Repair Workbook', 'manualRunSetup')
    .addItem('Seed Config Only', 'manualSeedConfigOnly')
    .addItem('Repair / Test Logs', 'repairLogSheets')
    .addSeparator()
    .addItem('Start April 2026 Source Backfill', 'manualStartApril2026SourceBackfill')
    .addItem('Start May 2026 Source Backfill', 'manualStartMay2026SourceBackfill')
    .addItem('Start Current Month Source Backfill', 'manualStartCurrentMonthSourceBackfill')
    .addItem('Start April-to-Date Source Backfill', 'manualStartAprilToDateSourceBackfill')
    .addItem('Run Current Shift Source Pull', 'manualRunCurrentShiftSourcePull')
    .addItem('Continue Active Source Sync', 'manualContinueSourceSync')
    .addItem('Source Sync Status', 'manualSourceSyncStatus')
    .addItem('Cancel Source Sync', 'manualCancelSourceSync')
    .addItem('Rebuild Analytics History', 'manualStartAnalyticsHistoryRebuild')
    .addItem('Analytics Rebuild Status', 'manualAnalyticsRebuildStatus')
    .addItem('Cancel Analytics Rebuild', 'manualCancelAnalyticsRebuild')
    .addItem('Refresh Current Analytics', 'manualRefreshCurrentAnalytics')
    .addItem('Verify Dashboard Deployment', 'manualVerifyDashboardDeploymentReadiness')
    .addItem('Test Dashboard Middleware + Cache', 'manualTestDashboardMiddlewareAndCache')
    .addItem('Rebuild Last Closed Daily Dataset', 'manualRebuildLastClosedDailyDataset')
    .addItem('Rebuild Current Open Dataset', 'manualRebuildReportDataset')
    .addSeparator()
    .addItem('Generate + Email Daily Report', 'manualRunDaily')
    .addItem('Generate + Email Weekly Report', 'manualRunWeekly')
    .addItem('Generate + Email Monthly Report', 'manualRunMonthly')
    .addSeparator()
    .addItem('Diagnostic: Populate Zendesk Only', 'manualPopulateZendeskOnly')
    .addItem('Diagnostic: Cancel Zendesk Only', 'manualCancelZendeskOnlyJob')
    .addItem('Import WFM Monthly Upload', 'manualImportWfmMonthlyUpload')
    .addItem('Rebuild WFM Monthly Balance', 'manualRebuildWfmMonthlyBalance')
    .addItem('Clear WFM Upload', 'manualClearWfmUpload')
    .addItem('Clean Up Retired Tabs', 'manualCleanUpRetiredWorkbook')
    .addItem('Inspect Attendance Source', 'manualInspectAttendanceSource')
    .addItem('Repair Raw Attendance From Source', 'manualRepairRawAttendanceFromSource')
    .addItem('Test Gemini Config', 'manualTestGeminiConfig')
    .addItem('Test Gemini Dashboard Insight', 'manualTestGeminiDashboardInsight')
    .addSeparator()
    .addItem('Clean Duplicate Projects', 'trashDuplicateAppsScriptProjects')
    .addSeparator()
    .addItem('Create Scheduled Triggers', 'createTriggers')
    .addItem('Delete Scheduled Triggers', 'deleteTriggers')
    .addToUi();
}

function doGet(e) {
  var startedAt = new Date();
  var requestId = generateRunId();
  if (e && e.parameter && String(e.parameter.format || '').toLowerCase() === 'json') {
    return jsonResponse_(withApiResponseMetadata_({
      status: 'OK',
      service: 'BMRX Productivity Reporting Engine',
      timestamp: formatDateTime_(new Date())
    }, requestId, 'doGet.health', startedAt, { format: 'json' }));
  }

  return HtmlService
    .createTemplateFromFile('Dashboard')
    .evaluate()
    .setTitle('BMRX Productivity Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function dashboardHealth() {
  var startedAt = new Date();
  var requestId = generateRunId();
  return jsonResponse_(withApiResponseMetadata_({
    status: 'OK',
    service: 'BMRX Productivity Reporting Engine',
    timestamp: formatDateTime_(new Date())
  }, requestId, 'dashboardHealth', startedAt, { format: 'json' }));
}

function doPost(e) {
  var startedAt = new Date();
  var requestId = generateRunId();
  var payload = {};
  var action = '';

  try {
    payload = parsePostPayload_(e);
    action = String(payload.action || '');
    authorizeInternalRequest_(payload);

    var result;

    if (action === 'setupProject') {
      result = setupProject();
    } else if (action === 'repairLogSheets') {
      result = repairLogSheets();
    } else if (action === 'populateZendeskOnly') {
      result = manualPopulateZendeskOnly(payload.referenceDate || payload.date);
    } else if (action === 'cancelZendeskOnlyJob') {
      result = manualCancelZendeskOnlyJob();
    } else if (action === 'startFiscalBackfill') {
      result = manualStartFiscalBackfill(payload.referenceDate || payload.date);
    } else if (action === 'startAprilToDateSourceBackfill') {
      result = manualStartAprilToDateSourceBackfill(payload.referenceDate || payload.date);
    } else if (action === 'startApril2026SourceBackfill') {
      result = manualStartApril2026SourceBackfill(payload.referenceDate || payload.date);
    } else if (action === 'startMay2026SourceBackfill') {
      result = manualStartMay2026SourceBackfill(payload.referenceDate || payload.date);
    } else if (action === 'startCurrentMonthSourceBackfill') {
      result = manualStartCurrentMonthSourceBackfill(payload.referenceDate || payload.date);
    } else if (action === 'startSourceBackfillMonth') {
      result = manualStartSourceBackfillMonth(payload.month || payload.uploadMonth || payload.referenceDate || payload.date);
    } else if (action === 'runCurrentShiftSourcePull') {
      result = manualRunCurrentShiftSourcePull(payload.referenceDate || payload.date);
    } else if (action === 'continueSourceSync') {
      result = manualContinueSourceSync();
    } else if (action === 'rebuildReportDataset') {
      result = manualRebuildReportDataset();
    } else if (action === 'rebuildLastClosedDailyDataset') {
      result = manualRebuildLastClosedDailyDataset();
    } else if (action === 'importWfmMonthlyUpload') {
      result = manualImportWfmMonthlyUpload();
    } else if (action === 'rebuildWfmMonthlyBalance') {
      result = manualRebuildWfmMonthlyBalance();
    } else if (action === 'clearWfmUpload') {
      result = manualClearWfmUpload();
    } else if (action === 'cleanUpRetiredWorkbook') {
      result = manualCleanUpRetiredWorkbook();
    } else if (action === 'repairRawAttendanceFromSource') {
      result = manualRepairRawAttendanceFromSource(payload.referenceDate || payload.date);
    } else if (action === 'populateDailyDataset') {
      result = manualPopulateDaily(payload.date);
    } else if (action === 'startDailyPopulateJob') {
      result = manualStartDailyPopulateJob(payload.date);
    } else if (action === 'startWeeklyPopulateJob') {
      result = manualStartWeeklyPopulateJob(payload.referenceDate);
    } else if (action === 'startMonthlyPopulateJob') {
      result = manualStartMonthlyPopulateJob(payload.referenceDate);
    } else if (action === 'continuePopulateJob') {
      result = manualContinuePopulateJob();
    } else if (action === 'populateJobStatus') {
      result = manualPopulateJobStatus();
    } else if (action === 'cancelPopulateJob') {
      result = manualCancelPopulateJob();
    } else if (action === 'syncWfmAttendanceBackfill') {
      result = manualSyncWfmAttendanceBackfill(payload.referenceDate);
    } else if (action === 'syncWfmAttendanceIncremental') {
      result = manualSyncWfmAttendanceIncremental(payload.referenceDate);
    } else if (action === 'sourceSyncStatus') {
      result = manualSourceSyncStatus();
    } else if (action === 'cancelSourceSync') {
      result = manualCancelSourceSync();
    } else if (action === 'startAnalyticsHistoryRebuild') {
      result = manualStartAnalyticsHistoryRebuild();
    } else if (action === 'analyticsRebuildStatus') {
      result = manualAnalyticsRebuildStatus();
    } else if (action === 'cancelAnalyticsRebuild') {
      result = manualCancelAnalyticsRebuild();
    } else if (action === 'refreshCurrentAnalytics') {
      result = manualRefreshCurrentAnalytics();
    } else if (action === 'verifyDashboardDeploymentReadiness') {
      result = manualVerifyDashboardDeploymentReadiness();
    } else if (action === 'testGeminiDashboardInsight') {
      result = manualTestGeminiDashboardInsight();
    } else if (action === 'testGeminiConfig') {
      result = manualTestGeminiConfig();
    } else if (action === 'testDashboardMiddlewareAndCache') {
      result = manualTestDashboardMiddlewareAndCache();
    } else if (action === 'dashboardHardRefresh') {
      result = startDashboardHardRefresh(payload.request || payload);
    } else if (action === 'dashboardSyncStatus') {
      result = getDashboardSyncStatus();
    } else if (action === 'populateWeeklyDataset') {
      result = manualPopulateWeekly(payload.referenceDate);
    } else if (action === 'populateMonthlyDataset') {
      result = manualPopulateMonthly(payload.referenceDate);
    } else if (action === 'pullNightShift') {
      result = manualPullNightShift(payload.referenceDate);
    } else if (action === 'pullDayShift') {
      result = manualPullDayShift(payload.referenceDate);
    } else if (action === 'pullMidShift') {
      result = manualPullMidShift(payload.referenceDate);
    } else if (action === 'runDailyReport') {
      result = manualRunDaily(payload.date);
    } else if (action === 'runWeeklyReport') {
      result = manualRunWeekly(payload.referenceDate);
    } else if (action === 'runMonthlyReport') {
      result = manualRunMonthly(payload.referenceDate);
    } else if (action === 'createTriggers') {
      result = createTriggers();
    } else if (action === 'deleteTriggers') {
      result = deleteTriggers();
    } else {
      throw new Error('Unsupported action: ' + action);
    }

    return jsonResponse_(withApiResponseMetadata_({
      status: 'OK',
      result: result
    }, requestId, 'doPost.' + (action || 'unknown'), startedAt, payload, {
      logAlways: action === 'dashboardHardRefresh'
    }));
  } catch (error) {
    var endpointName = 'doPost.' + (action || 'unknown');
    var failure = buildApiErrorPayload_(error, requestId, endpointName, startedAt);
    logApiEvent_(endpointName, requestId, startedAt, sanitizeApiPayload_(payload), failure, {
      status: 'FAILED',
      logAlways: true
    });
    logError('doPost', error, 'FAILED', 0);
    return jsonResponse_(failure);
  }
}

function parsePostPayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }
  return JSON.parse(e.postData.contents);
}

function authorizeInternalRequest_(payload) {
  var expectedSecret = getScriptProperty_('INTERNAL_API_SECRET');
  if (!expectedSecret) {
    return;
  }

  if (!payload || payload.secret !== expectedSecret) {
    throw new Error('Invalid INTERNAL_API_SECRET.');
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
