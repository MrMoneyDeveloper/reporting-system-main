function manualRunDaily(date) {
  return runReport_('daily', date ? parseDate_(date) : new Date(), true);
}

function manualRunWeekly(referenceDate) {
  return runReport_('weekly', referenceDate ? parseDate_(referenceDate) : new Date(), true);
}

function manualRunMonthly(referenceDate) {
  return runReport_('monthly', referenceDate ? parseDate_(referenceDate) : new Date(), true);
}

function manualRunSetup() {
  return setupProject();
}

function manualSeedConfigOnly() {
  seedKnownScriptProperties_();
  seedDefaultConfig_();
  seedDefaultAgents_();
  return validateScriptProperties();
}

function manualPopulateDaily(date) {
  return populateDataset_('daily', date ? parseDate_(date) : new Date(), true);
}

function manualPopulateWeekly(referenceDate) {
  return populateDataset_('weekly', referenceDate ? parseDate_(referenceDate) : new Date(), true);
}

function manualPopulateMonthly(referenceDate) {
  return populateDataset_('monthly', referenceDate ? parseDate_(referenceDate) : new Date(), true);
}

function manualPopulateZendeskOnly(referenceDate) {
  try {
    return continueZendeskOnlyJob_(referenceDate ? parseDate_(referenceDate) : new Date());
  } catch (error) {
    logError('manualPopulateZendeskOnly', error, 'FAILED', 0);
    throw error;
  }
}

function manualCancelZendeskOnlyJob() {
  return cancelZendeskOnlyJob_();
}

function manualStartFiscalBackfill(referenceDate) {
  return startFiscalBackfillSourceSyncJob_(referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualStartAprilToDateSourceBackfill(referenceDate) {
  return startAprilToDateSourceBackfill_(referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualStartApril2026SourceBackfill(referenceDate) {
  return startApril2026SourceBackfill_(referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualStartMay2026SourceBackfill(referenceDate) {
  return startMay2026SourceBackfill_(referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualStartCurrentMonthSourceBackfill(referenceDate) {
  return startCurrentMonthSourceBackfill_(referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualStartSourceBackfillMonth(monthKey) {
  return startSourceMonthBackfill_(monthKey, new Date());
}

function manualRunCurrentShiftSourcePull(referenceDate) {
  return startCurrentShiftSourceSyncJob_(referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualContinueSourceSync() {
  return continueSourceSyncJob_('continue', new Date());
}

function manualRebuildReportDataset() {
  return rebuildCurrentReportDataset_();
}

function manualStartAnalyticsHistoryRebuild() {
  return startAnalyticsHistoryRebuild_();
}

function manualAnalyticsRebuildStatus() {
  return getAnalyticsRebuildStatus_();
}

function manualCancelAnalyticsRebuild() {
  return cancelAnalyticsRebuild_();
}

function manualRefreshCurrentAnalytics() {
  return refreshCurrentAnalytics_();
}

function manualTestGeminiDashboardInsight() {
  return testGeminiDashboardInsight_();
}

function manualVerifyDashboardDeploymentReadiness() {
  return verifyDashboardDeploymentReadiness_();
}

function manualTestDashboardMiddlewareAndCache() {
  return testDashboardMiddlewareAndCache_();
}

function manualRebuildLastClosedDailyDataset() {
  return populateDataset_('daily', new Date(), true);
}

function manualImportWfmMonthlyUpload() {
  return importWfmMonthlyUpload();
}

function manualRebuildWfmMonthlyBalance() {
  return rebuildWfmMonthlyBalance();
}

function manualClearWfmUpload() {
  return clearWfmUpload();
}

function manualCleanUpRetiredWorkbook() {
  return cleanUpRetiredWorkbook_();
}

function manualStartDailyPopulateJob(date) {
  return startPopulateDatasetJob_('daily', date ? parseDate_(date) : new Date());
}

function manualStartWeeklyPopulateJob(referenceDate) {
  return startPopulateDatasetJob_('weekly', referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualStartMonthlyPopulateJob(referenceDate) {
  return startPopulateDatasetJob_('monthly', referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualContinuePopulateJob() {
  return continuePopulateJob();
}

function manualCancelPopulateJob() {
  return cancelPopulateJob();
}

function manualPopulateJobStatus() {
  return getPopulateJobStatus();
}

function manualSyncWfmAttendanceBackfill(referenceDate) {
  return manualStartFiscalBackfill(referenceDate);
}

function manualSyncWfmAttendanceIncremental(referenceDate) {
  return manualRunCurrentShiftSourcePull(referenceDate);
}

function manualSourceSyncStatus() {
  return getSourceSyncJobStatus_();
}

function manualCancelSourceSync() {
  return cancelSourceSyncJob_();
}

function manualPullNightShift(referenceDate) {
  return runShiftPull_('Night', referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualPullDayShift(referenceDate) {
  return runShiftPull_('Day', referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualPullMidShift(referenceDate) {
  return runShiftPull_('Mid', referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualInspectAttendanceSource(referenceDate) {
  return inspectAttendanceSource(referenceDate ? parseDate_(referenceDate) : new Date());
}

function manualRepairRawAttendanceFromSource(referenceDate) {
  return repairRawAttendanceFromSource_(referenceDate ? parseDate_(referenceDate) : new Date());
}
