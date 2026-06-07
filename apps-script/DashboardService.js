var DASHBOARD_CACHE_VERSION_KEY_ = 'DASHBOARD_CACHE_VERSION';
var DASHBOARD_LAST_ANALYTICS_REFRESH_KEY_ = 'DASHBOARD_LAST_ANALYTICS_REFRESH_AT';
var DASHBOARD_LAST_SOURCE_SYNC_KEY_ = 'DASHBOARD_LAST_SOURCE_SYNC_AT';
var DASHBOARD_CACHE_TTL_SECONDS_ = 300;

function getDashboardBootstrapCached() {
  return dashboardApiEndpoint_('getDashboardBootstrapCached', {}, function () {
    return dashboardCachedResult_('bootstrap', {}, function () {
      return getDashboardBootstrap();
    });
  }, {
    cacheable: true
  });
}

function getDashboardMetricsCached(request) {
  var normalizedRequest = normalizeDashboardRequest_(request);
  return dashboardApiEndpoint_('getDashboardMetricsCached', normalizedRequest, function () {
    return dashboardCachedResult_('metrics', normalizedRequest, function () {
      return getDashboardMetrics(normalizedRequest);
    });
  }, {
    cacheable: true
  });
}

function getDashboardInsightCached(request) {
  var normalizedRequest = normalizeDashboardRequest_(request);
  return dashboardApiEndpoint_('getDashboardInsightCached', normalizedRequest, function () {
    return dashboardCachedResult_('insight', normalizedRequest, function () {
      return getDashboardInsight(normalizedRequest);
    }, getDashboardCacheTtlSeconds_('insight', 900));
  }, {
    cacheable: true
  });
}

function getDashboardBootstrap() {
  setupProject();
  return {
    status: 'SUCCESS',
    generatedAt: formatDateTime_(new Date()),
    periods: {
      daily: getUniqueDashboardValues_(SHEET_NAMES.DAILY_METRICS, 'Date', true),
      weekly: getUniqueDashboardValues_(SHEET_NAMES.WEEKLY_METRICS, 'Fiscal Week'),
      monthly: getUniqueDashboardValues_(SHEET_NAMES.MONTHLY_METRICS, 'Fiscal Month')
    },
    shifts: ['Day', 'Mid', 'Night'],
    agents: getActiveAgents().map(function (agent) {
      return {
        email: agent.email,
        name: agent.name,
        shift: agent.shift
      };
    })
  };
}

function getDashboardMetrics(request) {
  setupProject();
  var filters = normalizeDashboardRequest_(request);
  var sheetName = getDashboardSheetForPeriod_(filters.periodType);
  var periodField = getDashboardPeriodField_(filters.periodType);
  var records = getSheetData(sheetName);
  var periodKey = filters.periodKey || getLatestDashboardPeriodKey_(records, periodField);
  var rows = filterDashboardRows_(records, periodField, periodKey, filters.agentEmail, filters.shift);
  var normalizedRows = normalizeDashboardRows_(rows, filters.periodType);

  return {
    status: 'SUCCESS',
    generatedAt: formatDateTime_(new Date()),
    filters: {
      periodType: filters.periodType,
      periodKey: periodKey,
      agentEmail: filters.agentEmail,
      shift: filters.shift
    },
    kpis: buildDashboardKpis_(normalizedRows, filters.periodType),
    rows: normalizedRows,
    charts: buildDashboardChartData_(normalizedRows, filters.periodType),
    rankings: buildDashboardRankings_(normalizedRows),
    risks: buildDashboardRisks_(normalizedRows),
    freshness: buildDashboardFreshness_(),
    agentDrilldown: filters.agentEmail ? buildDashboardAgentDrilldown_(filters.agentEmail) : []
  };
}

function getDashboardInsight(request) {
  var metrics = getDashboardMetrics(request);
  var payload = buildDashboardInsightPayload_(metrics);
  var fallback = buildDashboardFallbackInsight_(payload);

  if (!toBoolean_(getConfigValue('AI_SUMMARY_ENABLED', 'TRUE'))) {
    return { status: 'SUCCESS', insight: fallback + '\nAI summary disabled in Config.', fallback: true };
  }

  if (!getAiApiKey_().value) {
    return { status: 'SUCCESS', insight: fallback + '\nAI_API_KEY or GEMINI_API_KEY is not configured, so this fallback insight was used.', fallback: true };
  }

  var prompt = [
    'You are an operations analyst reviewing support productivity data.',
    'Write a concise management insight with bullets for wins, risks, and recommended action.',
    'Use only the compact JSON payload. Do not mention unavailable raw data.',
    JSON.stringify(payload)
  ].join('\n\n');

  try {
    return {
      status: 'SUCCESS',
      insight: callGeminiGenerateContent_(prompt, {
        model: getAiModel_(),
        temperature: 0.2,
        maxOutputTokens: 900
      }),
      fallback: false
    };
  } catch (error) {
    logError('getDashboardInsight', error, 'CONTINUED', 0);
    return { status: 'SUCCESS', insight: fallback + '\nGemini call failed: ' + error.message, fallback: true };
  }
}

function startDashboardHardRefresh(request) {
  return dashboardApiEndpoint_('startDashboardHardRefresh', normalizeDashboardRequest_(request), function () {
    setupProject();
    clearDashboardCache_();
    var sourceStatus = queueDashboardSourceSync_();
    var analyticsStatus = refreshCurrentAnalytics_();
    var status = buildDashboardSyncStatus_();

    logPipelineEvent_({
      reportType: 'Dashboard',
      phase: 'hard-refresh',
      status: 'QUEUED',
      message: 'Dashboard hard refresh queued source sync and refreshed current analytics.',
      rowsProcessed: analyticsStatus.dailyRows || 0
    });

    return {
      status: 'QUEUED',
      sourceSync: sourceStatus,
      analytics: analyticsStatus,
      syncStatus: status,
      request: normalizeDashboardRequest_(request)
    };
  }, {
    logAlways: true
  });
}

function getDashboardSyncStatus() {
  return dashboardApiEndpoint_('getDashboardSyncStatus', {}, function () {
    return buildDashboardSyncStatus_();
  });
}

function buildDashboardSyncStatus_() {
  var properties = PropertiesService.getScriptProperties();
  var sourceJob = getLargeScriptState_(SOURCE_SYNC_JOB_KEY_);
  var analyticsJob = getLargeScriptState_(ANALYTICS_REBUILD_JOB_KEY_);
  var triggers = ScriptApp.getProjectTriggers();
  var triggerHandlers = [];

  for (var i = 0; i < triggers.length; i++) {
    triggerHandlers.push(triggers[i].getHandlerFunction());
  }

  return {
    status: 'SUCCESS',
    generatedAt: formatDateTime_(new Date()),
    sourceSync: sourceJob ? {
      active: true,
      runId: sourceJob.runId || '',
      phase: sourceJob.phase || '',
      cursor: safeSourceSyncDateKey_(sourceJob.cursorDate),
      end: safeSourceSyncDateKey_(sourceJob.endDate),
      rowsProcessed: sourceJob.rowsProcessed || 0
    } : {
      active: false,
      lastCompletedAt: properties.getProperty(DASHBOARD_LAST_SOURCE_SYNC_KEY_) || '',
      lastEndDate: properties.getProperty(SOURCE_SYNC_LAST_END_KEY_) || ''
    },
    analytics: analyticsJob ? {
      active: true,
      runId: analyticsJob.runId || '',
      phase: analyticsJob.phase || '',
      cursor: safeSourceSyncDateKey_(analyticsJob.cursorDate),
      end: safeSourceSyncDateKey_(analyticsJob.endDate),
      rowsProcessed: analyticsJob.rowsProcessed || 0
    } : {
      active: false,
      lastRefreshedAt: properties.getProperty(DASHBOARD_LAST_ANALYTICS_REFRESH_KEY_) || ''
    },
    triggers: {
      expected: getDashboardExpectedTriggerHandlers_(),
      present: triggerHandlers.sort()
    },
    cacheVersion: getDashboardCacheVersion_(),
    apiLogging: {
      mode: getConfigValue('DASHBOARD_API_LOG_MODE', 'SUMMARY'),
      slowRequestMs: getDashboardSlowRequestMs_(),
      cacheTtlSeconds: getDashboardCacheTtlSeconds_('metrics', DASHBOARD_CACHE_TTL_SECONDS_),
      insightCacheTtlSeconds: getDashboardCacheTtlSeconds_('insight', 900),
      cacheMaxBytes: getDashboardCacheMaxBytes_(),
      lastRequestAt: properties.getProperty(DASHBOARD_LAST_API_REQUEST_KEY_) || '',
      lastEndpoint: properties.getProperty(DASHBOARD_LAST_API_ENDPOINT_KEY_) || ''
    }
  };
}

function testGeminiDashboardInsight_() {
  var result = getDashboardInsight({
    periodType: 'monthly'
  });
  logPipelineEvent_({
    reportType: 'Dashboard Diagnostic',
    phase: 'gemini',
    status: result.fallback ? 'FALLBACK' : 'SUCCESS',
    message: compactLogMessage_(result.insight || ''),
    rowsProcessed: 1
  });
  return result;
}

function verifyDashboardDeploymentReadiness_() {
  setupProject();
  var triggers = getDashboardTriggerPresence_();
  var result = {
    status: 'SUCCESS',
    generatedAt: formatDateTime_(new Date()),
    sheets: {
      dailyMetrics: getSheetData(SHEET_NAMES.DAILY_METRICS).length,
      weeklyMetrics: getSheetData(SHEET_NAMES.WEEKLY_METRICS).length,
      monthlyMetrics: getSheetData(SHEET_NAMES.MONTHLY_METRICS).length,
      currentReportView: getSheetData(SHEET_NAMES.CURRENT_REPORT_VIEW).length
    },
    gemini: {
      apiKeyPresent: Boolean(getAiApiKey_().value),
      model: getAiModel_(),
      diagnostic: getGeminiDiagnostic_()
    },
    webApp: {
      htmlTemplate: 'Dashboard',
      frontend: 'React CDN + Bootstrap + Chart.js',
      healthUrlFormat: '?format=json'
    },
    middleware: {
      apiLoggingMode: getConfigValue('DASHBOARD_API_LOG_MODE', 'SUMMARY'),
      slowRequestMs: getDashboardSlowRequestMs_(),
      cacheTtlSeconds: getDashboardCacheTtlSeconds_('metrics', DASHBOARD_CACHE_TTL_SECONDS_),
      insightCacheTtlSeconds: getDashboardCacheTtlSeconds_('insight', 900),
      cacheMaxBytes: getDashboardCacheMaxBytes_()
    },
    triggers: triggers,
    cacheVersion: getDashboardCacheVersion_()
  };

  logPipelineEvent_({
    reportType: 'Dashboard Diagnostic',
    phase: 'readiness',
    status: triggers.missing.length ? 'MISSING_TRIGGERS' : 'SUCCESS',
    message: 'Dashboard readiness checked. Metrics rows: daily=' + result.sheets.dailyMetrics + ', weekly=' + result.sheets.weeklyMetrics + ', monthly=' + result.sheets.monthlyMetrics + '. Missing triggers: ' + (triggers.missing.join(', ') || 'none') + '.',
    rowsProcessed: result.sheets.dailyMetrics + result.sheets.weeklyMetrics + result.sheets.monthlyMetrics
  });

  return result;
}

function testDashboardMiddlewareAndCache_() {
  clearDashboardCache_();

  var firstBootstrap = getDashboardBootstrapCached();
  var secondBootstrap = getDashboardBootstrapCached();
  var firstMetrics = getDashboardMetricsCached({ periodType: 'daily' });
  var secondMetrics = getDashboardMetricsCached({ periodType: 'daily' });
  var syncStatus = getDashboardSyncStatus();

  var result = {
    status: 'SUCCESS',
    generatedAt: formatDateTime_(new Date()),
    bootstrap: {
      firstCacheHit: Boolean(firstBootstrap.cache && firstBootstrap.cache.hit),
      secondCacheHit: Boolean(secondBootstrap.cache && secondBootstrap.cache.hit),
      periods: firstBootstrap.periods || {}
    },
    metrics: {
      firstCacheHit: Boolean(firstMetrics.cache && firstMetrics.cache.hit),
      secondCacheHit: Boolean(secondMetrics.cache && secondMetrics.cache.hit),
      rows: firstMetrics.rows ? firstMetrics.rows.length : 0,
      cacheStatus: firstMetrics.cache ? firstMetrics.cache.status : ''
    },
    apiLogging: syncStatus.apiLogging || {},
    api: syncStatus.api || {}
  };

  logPipelineEvent_({
    reportType: 'Dashboard Diagnostic',
    phase: 'middleware-cache',
    status: result.metrics.secondCacheHit && result.bootstrap.secondCacheHit ? 'SUCCESS' : 'CHECK_CACHE',
    message: 'Dashboard middleware/cache test completed. bootstrap second hit=' + result.bootstrap.secondCacheHit + ', metrics second hit=' + result.metrics.secondCacheHit + ', metric rows=' + result.metrics.rows + '.',
    rowsProcessed: result.metrics.rows
  });

  return result;
}

function normalizeDashboardRequest_(request) {
  var input = request || {};
  var periodType = String(input.periodType || 'monthly').toLowerCase();
  if (periodType !== 'daily' && periodType !== 'weekly' && periodType !== 'monthly') {
    periodType = 'monthly';
  }
  return {
    periodType: periodType,
    periodKey: String(input.periodKey || '').trim(),
    agentEmail: normalizeEmail_(input.agentEmail),
    shift: normalizeShift_(input.shift || '')
  };
}

function getDashboardSheetForPeriod_(periodType) {
  if (periodType === 'daily') {
    return SHEET_NAMES.DAILY_METRICS;
  }
  if (periodType === 'weekly') {
    return SHEET_NAMES.WEEKLY_METRICS;
  }
  return SHEET_NAMES.MONTHLY_METRICS;
}

function getDashboardPeriodField_(periodType) {
  if (periodType === 'daily') {
    return 'Date';
  }
  if (periodType === 'weekly') {
    return 'Fiscal Week';
  }
  return 'Fiscal Month';
}

function getUniqueDashboardValues_(sheetName, field, isDate) {
  var records = getSheetData(sheetName);
  var seen = {};
  var output = [];

  for (var i = 0; i < records.length; i++) {
    var value = dashboardFieldValue_(records[i][field], isDate);
    if (!value || seen[value]) {
      continue;
    }
    seen[value] = true;
    output.push(value);
  }

  output.sort();
  return output;
}

function getLatestDashboardPeriodKey_(records, field) {
  var values = [];
  var seen = {};
  for (var i = 0; i < records.length; i++) {
    var value = dashboardFieldValue_(records[i][field], field === 'Date');
    if (value && !seen[value]) {
      seen[value] = true;
      values.push(value);
    }
  }
  values.sort();
  return values.length ? values[values.length - 1] : '';
}

function filterDashboardRows_(records, periodField, periodKey, agentEmail, shift) {
  var output = [];
  for (var i = 0; i < records.length; i++) {
    if (periodKey && dashboardFieldValue_(records[i][periodField], periodField === 'Date') !== periodKey) {
      continue;
    }
    if (agentEmail && normalizeEmail_(records[i]['Agent Email']) !== agentEmail) {
      continue;
    }
    if (shift && normalizeShift_(records[i].Shift) !== normalizeShift_(shift)) {
      continue;
    }
    output.push(records[i]);
  }
  return output;
}

function normalizeDashboardRows_(records, periodType) {
  var output = [];
  for (var i = 0; i < records.length; i++) {
    var row = records[i];
    output.push({
      periodType: periodType,
      period: getDashboardRowPeriod_(row, periodType),
      start: dashboardFieldValue_(row['Week Start'] || row['Month Start'] || row.Date || '', true),
      end: dashboardFieldValue_(row['Week End'] || row['Month End'] || row.Date || '', true),
      fiscalWeek: row['Fiscal Week'] || '',
      fiscalMonth: row['Fiscal Month'] || '',
      agentEmail: normalizeEmail_(row['Agent Email']),
      agentName: String(row['Agent Name'] || ''),
      shift: String(row.Shift || ''),
      attendanceStatus: String(row['Attendance Status'] || ''),
      attendedDays: Number(row['Attended Days'] || (row['Attendance Status'] ? 1 : 0)),
      attendancePercent: dashboardNumberOrBlank_(row['Attendance %'] !== undefined ? row['Attendance %'] : row['Attendance Score']),
      expectedHours: dashboardNumberOrBlank_(row['Expected Hours']),
      actualHours: dashboardNumberOrBlank_(row['Actual Hours']),
      lateMinutes: dashboardNumberOrBlank_(row['Late Minutes']),
      ticketsSolved: Number(row['Tickets Solved'] || 0),
      ticketsUpdated: Number(row['Tickets Updated'] || 0),
      ticketsCreated: Number(row['Tickets Created'] || 0),
      publicReplies: Number(row['Public Replies'] || 0),
      otherActions: Number(row['Other Actions'] || 0),
      ticketScore: Number(row['Ticket Score'] || 0),
      productivityActions: Number(row['Productivity Actions'] || 0),
      wfmTotalHours: dashboardNumberOrBlank_(row['WFM Total Hours']),
      wfmProductiveHours: dashboardNumberOrBlank_(row['WFM Productive Hours']),
      wfmGeneralTaskHours: dashboardNumberOrBlank_(row['WFM General Task Hours']),
      wfmProductivityPercent: dashboardNumberOrBlank_(row['WFM Productivity %']),
      wfmOutstandingHours: dashboardNumberOrBlank_(row['WFM Outstanding Hours']),
      wfmSurplusHours: dashboardNumberOrBlank_(row['WFM Surplus Hours']),
      wfmNotes: String(row['WFM Notes'] || ''),
      notes: String(row.Notes || '')
    });
  }
  return output;
}

function getDashboardRowPeriod_(row, periodType) {
  if (periodType === 'daily') {
    return dashboardFieldValue_(row.Date, true);
  }
  if (periodType === 'weekly') {
    return String(row['Fiscal Week'] || '');
  }
  return String(row['Fiscal Month'] || '');
}

function dashboardFieldValue_(value, isDate) {
  if (!value) {
    return '';
  }
  if (isDate || value instanceof Date) {
    try {
      return dateKey_(value);
    } catch (error) {
      return String(value || '').trim();
    }
  }
  return String(value || '').trim();
}

function dashboardNumberOrBlank_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return '';
  }
  var number = Number(value);
  return isNaN(number) ? '' : number;
}

function buildDashboardKpis_(rows, periodType) {
  var attendanceTotal = 0;
  var attendanceCount = 0;
  var ticketsSolved = 0;
  var productivityActions = 0;
  var expectedHours = 0;
  var wfmOutstanding = 0;
  var riskCount = 0;

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].attendancePercent !== '') {
      attendanceTotal += Number(rows[i].attendancePercent);
      attendanceCount += 1;
    }
    ticketsSolved += rows[i].ticketsSolved;
    productivityActions += rows[i].productivityActions;
    expectedHours += Number(rows[i].expectedHours || 0);
    wfmOutstanding += Number(rows[i].wfmOutstandingHours || 0);
    if (isDashboardRiskRow_(rows[i])) {
      riskCount += 1;
    }
  }

  return {
    agents: rows.length,
    attendancePercent: attendanceCount ? round2_(attendanceTotal / attendanceCount) : '',
    ticketsSolved: ticketsSolved,
    productivityActions: productivityActions,
    expectedHours: round2_(expectedHours),
    wfmOutstandingHours: periodType === 'monthly' ? round2_(wfmOutstanding) : '',
    riskCount: riskCount
  };
}

function buildDashboardChartData_(rows, periodType) {
  return {
    shiftSummary: buildDashboardShiftChart_(rows),
    attendanceVsTickets: rows.slice().sort(function (left, right) {
      return right.ticketsSolved - left.ticketsSolved;
    }).slice(0, 12).map(function (row) {
      return {
        label: row.agentName,
        attendance: row.attendancePercent === '' ? null : round2_(Number(row.attendancePercent) * 100),
        tickets: row.ticketsSolved,
        actions: row.productivityActions
      };
    }),
    wfmBalance: periodType === 'monthly' ? rows.slice().filter(function (row) {
      return Number(row.wfmOutstandingHours || 0) > 0 || Number(row.wfmSurplusHours || 0) > 0;
    }).sort(function (left, right) {
      return Number(right.wfmOutstandingHours || 0) - Number(left.wfmOutstandingHours || 0);
    }).slice(0, 12).map(function (row) {
      return {
        label: row.agentName,
        outstanding: Number(row.wfmOutstandingHours || 0),
        surplus: Number(row.wfmSurplusHours || 0)
      };
    }) : []
  };
}

function buildDashboardShiftChart_(rows) {
  var groups = {};
  for (var i = 0; i < rows.length; i++) {
    var shift = rows[i].shift || 'Unassigned';
    if (!groups[shift]) {
      groups[shift] = {
        label: shift,
        attendanceTotal: 0,
        attendanceCount: 0,
        tickets: 0,
        actions: 0,
        agents: 0
      };
    }
    groups[shift].agents += 1;
    groups[shift].tickets += Number(rows[i].ticketsSolved || 0);
    groups[shift].actions += Number(rows[i].productivityActions || 0);
    if (rows[i].attendancePercent !== '') {
      groups[shift].attendanceTotal += Number(rows[i].attendancePercent);
      groups[shift].attendanceCount += 1;
    }
  }

  var output = [];
  for (var shiftName in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, shiftName)) {
      continue;
    }
    var group = groups[shiftName];
    output.push({
      label: group.label,
      agents: group.agents,
      attendance: group.attendanceCount ? round2_((group.attendanceTotal / group.attendanceCount) * 100) : null,
      tickets: group.tickets,
      actions: group.actions
    });
  }
  return output.sort(function (left, right) {
    return String(left.label).localeCompare(String(right.label));
  });
}

function buildDashboardRankings_(rows) {
  return {
    topTickets: rows.slice().sort(function (left, right) {
      return right.ticketsSolved - left.ticketsSolved;
    }).slice(0, 8),
    lowAttendance: rows.slice().filter(function (row) {
      return row.attendancePercent !== '';
    }).sort(function (left, right) {
      return Number(left.attendancePercent) - Number(right.attendancePercent);
    }).slice(0, 8),
    wfmOutstanding: rows.slice().filter(function (row) {
      return Number(row.wfmOutstandingHours || 0) > 0;
    }).sort(function (left, right) {
      return Number(right.wfmOutstandingHours || 0) - Number(left.wfmOutstandingHours || 0);
    }).slice(0, 8)
  };
}

function buildDashboardRisks_(rows) {
  var risks = [];
  for (var i = 0; i < rows.length; i++) {
    if (isDashboardRiskRow_(rows[i])) {
      risks.push(rows[i]);
    }
    if (risks.length >= 20) {
      break;
    }
  }
  return risks;
}

function isDashboardRiskRow_(row) {
  return Boolean(row.notes || row.wfmNotes || Number(row.wfmOutstandingHours || 0) > 0 || row.attendancePercent === '');
}

function buildDashboardFreshness_() {
  var history = getSheetData(SHEET_NAMES.WFM_UPLOAD_HISTORY);
  var properties = PropertiesService.getScriptProperties();
  var latest = null;
  var months = {};

  for (var i = 0; i < history.length; i++) {
    var importedAt = history[i]['Imported At'];
    var uploadMonth = String(history[i]['Upload Month'] || '');
    if (uploadMonth) {
      months[uploadMonth] = true;
    }
    if (importedAt && (!latest || parseDate_(importedAt).getTime() > parseDate_(latest).getTime())) {
      latest = importedAt;
    }
  }

  return {
    wfmUploadMonths: Object.keys(months).sort(),
    latestWfmImport: latest ? formatDateTime_(latest) : '',
    lastSourceSync: properties.getProperty(DASHBOARD_LAST_SOURCE_SYNC_KEY_) || '',
    lastAnalyticsRefresh: properties.getProperty(DASHBOARD_LAST_ANALYTICS_REFRESH_KEY_) || '',
    lastDashboardApiRequest: properties.getProperty(DASHBOARD_LAST_API_REQUEST_KEY_) || '',
    lastDashboardApiEndpoint: properties.getProperty(DASHBOARD_LAST_API_ENDPOINT_KEY_) || '',
    cacheVersion: getDashboardCacheVersion_(),
    dailyMetricRows: getSheetData(SHEET_NAMES.DAILY_METRICS).length,
    weeklyMetricRows: getSheetData(SHEET_NAMES.WEEKLY_METRICS).length,
    monthlyMetricRows: getSheetData(SHEET_NAMES.MONTHLY_METRICS).length
  };
}

function buildDashboardAgentDrilldown_(agentEmail) {
  var email = normalizeEmail_(agentEmail);
  var output = [];
  var daily = normalizeDashboardRows_(getSheetData(SHEET_NAMES.DAILY_METRICS), 'daily').filter(function (row) {
    return row.agentEmail === email;
  });
  daily.sort(function (left, right) {
    return String(right.period).localeCompare(String(left.period));
  });
  output = output.concat(daily.slice(0, 14));
  return output;
}

function buildDashboardInsightPayload_(metrics) {
  return {
    filters: metrics.filters,
    kpis: metrics.kpis,
    freshness: metrics.freshness,
    topTickets: compactDashboardRowsForAi_(metrics.rankings.topTickets, 5),
    lowAttendance: compactDashboardRowsForAi_(metrics.rankings.lowAttendance, 5),
    wfmOutstanding: compactDashboardRowsForAi_(metrics.rankings.wfmOutstanding, 5),
    risks: compactDashboardRowsForAi_(metrics.risks, 8)
  };
}

function compactDashboardRowsForAi_(rows, limit) {
  var output = [];
  for (var i = 0; i < Math.min((rows || []).length, limit); i++) {
    output.push({
      agent: rows[i].agentName,
      email: rows[i].agentEmail,
      shift: rows[i].shift,
      attendance: rows[i].attendancePercent,
      ticketsSolved: rows[i].ticketsSolved,
      productivityActions: rows[i].productivityActions,
      wfmOutstandingHours: rows[i].wfmOutstandingHours,
      notes: rows[i].notes || rows[i].wfmNotes || ''
    });
  }
  return output;
}

function buildDashboardFallbackInsight_(payload) {
  var kpis = payload.kpis || {};
  var risks = payload.risks || [];
  return [
    'Dashboard insight for ' + ((payload.filters && payload.filters.periodKey) || 'the selected period') + '.',
    'Agents reviewed: ' + (kpis.agents || 0) + '.',
    'Tickets solved: ' + (kpis.ticketsSolved || 0) + '.',
    'Risk rows flagged: ' + risks.length + '.'
  ].join('\n');
}

function dashboardCachedResult_(prefix, request, builder, ttlSeconds) {
  var cache = CacheService.getScriptCache();
  var key = dashboardCacheKey_(prefix, request);
  var cached = cache.get(key);
  var ttl = getDashboardCacheTtlSeconds_(prefix, ttlSeconds || DASHBOARD_CACHE_TTL_SECONDS_);

  if (cached) {
    try {
      var parsed = JSON.parse(cached);
      parsed.cache = parsed.cache || {};
      parsed.cache.hit = true;
      parsed.cache.servedAt = formatDateTime_(new Date());
      parsed.cache.ttlSeconds = ttl;
      return parsed;
    } catch (ignored) {
      // Fall through and rebuild.
    }
  }

  var result = builder();
  if (!result || typeof result !== 'object') {
    result = { result: result };
  }
  result.cache = {
    hit: false,
    generatedAt: formatDateTime_(new Date()),
    version: getDashboardCacheVersion_(),
    ttlSeconds: ttl,
    status: 'MISS'
  };
  result.cache.bytes = getApiResponseSizeBytes_(result);

  if (result.cache.bytes > getDashboardCacheMaxBytes_()) {
    result.cache.status = 'SKIPPED_TOO_LARGE';
    return result;
  }

  try {
    cache.put(key, JSON.stringify(result), ttl);
    result.cache.status = 'STORED';
  } catch (cacheError) {
    logError('dashboardCachedResult', cacheError, 'CONTINUED', 0);
    result.cache.status = 'WRITE_FAILED';
    result.cache.message = compactLogMessage_(cacheError.message || String(cacheError));
  }

  return result;
}

function dashboardCacheKey_(prefix, request) {
  var raw = [
    String(prefix || 'dashboard'),
    getDashboardCacheVersion_(),
    JSON.stringify(request || {})
  ].join('|');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return 'dashboard_' + String(prefix || 'data') + '_' + Utilities.base64EncodeWebSafe(digest).slice(0, 40);
}

function getDashboardCacheVersion_() {
  var properties = PropertiesService.getScriptProperties();
  var version = properties.getProperty(DASHBOARD_CACHE_VERSION_KEY_);
  if (!version) {
    version = String(new Date().getTime());
    properties.setProperty(DASHBOARD_CACHE_VERSION_KEY_, version);
  }
  return version;
}

function clearDashboardCache_() {
  var version = String(new Date().getTime());
  PropertiesService.getScriptProperties().setProperty(DASHBOARD_CACHE_VERSION_KEY_, version);
  return version;
}

function markDashboardSourceSyncComplete_(job) {
  PropertiesService.getScriptProperties().setProperty(DASHBOARD_LAST_SOURCE_SYNC_KEY_, formatDateTime_(new Date()));
  clearDashboardCache_();
  return job;
}

function markDashboardAnalyticsRefresh_(reason) {
  PropertiesService.getScriptProperties().setProperty(DASHBOARD_LAST_ANALYTICS_REFRESH_KEY_, formatDateTime_(new Date()));
  clearDashboardCache_();
  return reason || '';
}

function queueDashboardSourceSync_() {
  var job = getLargeScriptState_(SOURCE_SYNC_JOB_KEY_);
  if (!job) {
    job = createSourceSyncJob_('shift', new Date(), getLastClosedShiftName_(new Date()));
    saveLargeScriptState_(SOURCE_SYNC_JOB_KEY_, job);
  }

  clearSourceSyncContinuationTriggers_();
  ScriptApp.newTrigger('continueSourceSyncJobTrigger').timeBased().after(1000).create();
  return {
    status: job.phase ? 'QUEUED' : 'STARTED',
    runId: job.runId || '',
    phase: job.phase || '',
    cursor: safeSourceSyncDateKey_(job.cursorDate),
    end: safeSourceSyncDateKey_(job.endDate)
  };
}

function getDashboardExpectedTriggerHandlers_() {
  return [
    'runShiftPullMid',
    'runShiftPullMidCatchUp',
    'runShiftPullNight',
    'runShiftPullNightCatchUp',
    'runShiftPullDay',
    'runShiftPullDayCatchUp',
    'runDailyReport',
    'runWeeklyReport',
    'runMonthlyReport'
  ];
}

function getDashboardTriggerPresence_() {
  var triggers = ScriptApp.getProjectTriggers();
  var present = {};
  for (var i = 0; i < triggers.length; i++) {
    present[triggers[i].getHandlerFunction()] = true;
  }

  var expected = getDashboardExpectedTriggerHandlers_();
  var missing = [];
  for (var j = 0; j < expected.length; j++) {
    if (!present[expected[j]]) {
      missing.push(expected[j]);
    }
  }

  return {
    expected: expected,
    present: Object.keys(present).sort(),
    missing: missing,
    expectedSchedule: {
      runShiftPullMid: '00:30',
      runShiftPullMidCatchUp: '01:30',
      runShiftPullNight: '08:30',
      runShiftPullNightCatchUp: '09:30',
      runShiftPullDay: '16:30',
      runShiftPullDayCatchUp: '17:30'
    }
  };
}
