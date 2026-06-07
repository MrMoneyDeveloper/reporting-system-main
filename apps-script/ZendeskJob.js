var ZENDESK_ONLY_JOB_KEY_ = 'ZENDESK_ONLY_JOB';

function continueZendeskOnlyJob_(referenceDate) {
  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    var message = 'A Zendesk-only step is already running. Wait for it to finish, then click Populate Zendesk Only again.';
    logPipelineEvent_({
      reportType: 'Zendesk Only Populate',
      phase: 'zendesk-only',
      status: 'ALREADY_RUNNING',
      message: message
    });
    return {
      status: 'RUNNING',
      message: message
    };
  }

  try {
    setupZendeskOnlyProject_();

    var job = getLargeScriptState_(ZENDESK_ONLY_JOB_KEY_);
    if (!job) {
      job = createZendeskOnlyJob_(referenceDate || new Date());
    }

    var result = processZendeskOnlyJobStep_(job);
    if (result.status === 'SUCCESS') {
      clearLargeScriptState_(ZENDESK_ONLY_JOB_KEY_);
    } else {
      saveLargeScriptState_(ZENDESK_ONLY_JOB_KEY_, result.job);
    }

    return result;
  } finally {
    lock.releaseLock();
  }
}

function cancelZendeskOnlyJob_() {
  clearLargeScriptState_(ZENDESK_ONLY_JOB_KEY_);
  logPipelineEvent_({
    phase: 'zendesk-only',
    status: 'CANCELLED',
    message: 'Zendesk-only job was cancelled.'
  });
  return { status: 'CANCELLED' };
}

function createZendeskOnlyJob_(referenceDate) {
  var windowInfo = getOperationalDayWindow(referenceDate || new Date());

  return {
    runId: generateRunId(),
    startedAt: new Date().toISOString(),
    phase: 'resolveUsers',
    agentIndex: 0,
    rowsProcessed: 0,
    startDate: windowInfo.startDate.toISOString(),
    endDate: windowInfo.endDate.toISOString(),
    target: {
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
    groupMap: {}
  };
}

function processZendeskOnlyJobStep_(job) {
  var agents = getActiveAgents();
  var config = getZendeskPullConfig_(agents);

  if (!config.isConfigured) {
    throw new Error('Zendesk Script Properties are not configured. Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and ZENDESK_API_TOKEN.');
  }

  var range = getZendeskOnlyJobRange_(job, config);
  config.currentRange = range;

  if (job.phase === 'resolveUsers') {
    return processZendeskOnlyResolveUsers_(job, agents, config, range);
  }

  if (job.phase === 'searchCreated') {
    return processZendeskOnlySearchPage_(job, config, range, 'created');
  }

  if (job.phase === 'searchSolved') {
    return processZendeskOnlySearchPage_(job, config, range, 'solved');
  }

  if (job.phase === 'searchUpdated') {
    return processZendeskOnlySearchPage_(job, config, range, 'updated');
  }

  if (job.phase === 'fetchGroups') {
    if (!job.groupMap || Object.keys(job.groupMap).length === 0) {
      job.groupMap = fetchZendeskGroupsMap_(config);
    }
    job.phase = 'processCreated';
    return zendeskOnlyRunningResult_(job, range, 'FETCH_GROUPS_DONE', 'Fetched Zendesk group names. Click Populate Zendesk Only again to process created tickets.');
  }

  if (job.phase === 'processCreated') {
    return processZendeskOnlyCreatedRows_(job, config, range);
  }

  if (job.phase === 'processAudit') {
    return processZendeskOnlyAuditRows_(job, config, range);
  }

  if (job.phase === 'processSolved') {
    return processZendeskOnlySolvedRows_(job, config, range);
  }

  if (job.phase === 'normalize') {
    return finishZendeskOnlyJob_(job, range);
  }

  throw new Error('Unsupported Zendesk-only phase: ' + job.phase);
}

function processZendeskOnlyResolveUsers_(job, agents, config, range) {
  var batchSize = getPositiveZendeskNumber_('ZENDESK_USER_RESOLVE_BATCH_SIZE', '', 5);
  var endIndex = Math.min(agents.length, Number(job.agentIndex || 0) + batchSize);

  for (var i = Number(job.agentIndex || 0); i < endIndex; i++) {
    var agent = agents[i] || {};
    var identifier = agent.email || agent.name;
    if (!identifier) {
      continue;
    }

    try {
      var user = findZendeskUser_(config, identifier);
      if (!user || !user.id) {
        job.target.warnings.push('Could not find Zendesk user for ' + identifier + '.');
        continue;
      }

      var userId = String(user.id);
      job.target.userById[userId] = {
        id: user.id,
        name: user.name || '',
        email: user.email || '',
        role: user.role || ''
      };
      job.target.agentByUserId[userId] = {
        name: agent.name || user.name || '',
        email: normalizeEmail_(agent.email || user.email),
        shift: agent.shift || ''
      };
    } catch (error) {
      job.target.warnings.push('Could not resolve Zendesk user for ' + identifier + ': ' + error.message);
    }
  }

  job.agentIndex = endIndex;

  if (job.agentIndex < agents.length) {
    return zendeskOnlyRunningResult_(job, range, 'RESOLVE_USERS', 'Resolved Zendesk users ' + job.agentIndex + ' of ' + agents.length + '. Click Populate Zendesk Only again.');
  }

  if (Object.keys(job.target.userById).length === 0) {
    throw new Error('No configured agents could be matched to Zendesk users.');
  }

  job.phase = 'searchCreated';
  return zendeskOnlyRunningResult_(job, range, 'RESOLVE_USERS_DONE', 'Resolved ' + Object.keys(job.target.userById).length + ' Zendesk users. Click Populate Zendesk Only again to search created tickets.');
}

function processZendeskOnlySearchPage_(job, config, range, kind) {
  var query = buildZendeskOnlySearchQuery_(job, config, range, kind);
  var nextKey = kind + 'NextUrl';
  var idsKey = kind + 'Ids';
  var pagesKey = kind + 'Pages';
  var startedKey = kind + 'SearchStarted';
  var url = job[nextKey] || ('/api/v2/search.json?query=' + encodeURIComponent(query) + '&sort_by=created_at&sort_order=asc&per_page=100');
  var pagesPerClick = getPositiveZendeskNumber_('ZENDESK_SEARCH_PAGES_PER_CLICK', '', 10);

  if (job[startedKey] && !job[nextKey]) {
    moveZendeskOnlySearchPhase_(job, kind);
    return zendeskOnlyRunningResult_(job, range, 'SEARCH_' + kind.toUpperCase() + '_DONE', 'Finished ' + kind + ' search. Click Populate Zendesk Only again.');
  }

  var ids = job[idsKey] || [];
  var seen = {};
  var pagesFetched = 0;

  for (var i = 0; i < ids.length; i++) {
    seen[String(ids[i])] = true;
  }

  while (url && pagesFetched < pagesPerClick) {
    var data = zendeskGet_(config, url);
    var pageResults = data.results || [];

    for (var j = 0; j < pageResults.length; j++) {
      if (pageResults[j] && (!pageResults[j].result_type || pageResults[j].result_type === 'ticket')) {
        var ticketId = String(pageResults[j].id || '');
        if (ticketId && !seen[ticketId]) {
          seen[ticketId] = true;
          ids.push(ticketId);
          if (kind === 'updated' && ids.length >= config.maxUpdatedTickets) {
            break;
          }
        }
      }
    }

    job[pagesKey] = Number(job[pagesKey] || 0) + 1;
    job[startedKey] = true;
    pagesFetched++;

    if (job[pagesKey] >= config.maxSearchPages || (kind === 'updated' && ids.length >= config.maxUpdatedTickets)) {
      url = '';
      break;
    }

    url = data.next_page || '';
  }

  job[idsKey] = ids;
  job[nextKey] = url;

  if (!job[nextKey]) {
    moveZendeskOnlySearchPhase_(job, kind);
  }

  return zendeskOnlyRunningResult_(
    job,
    range,
    'SEARCH_' + kind.toUpperCase(),
    'Fetched ' + pagesFetched + ' Zendesk ' + kind + ' search page(s) with up to 100 tickets each. Found ' + ids.length + ' total ' + kind + ' IDs so far. Click Populate Zendesk Only again.'
  );
}

function processZendeskOnlyCreatedRows_(job, config, range) {
  var ids = job.createdIds || [];
  var batch = ids.slice(Number(job.createdIndex || 0), Number(job.createdIndex || 0) + 100);

  if (batch.length === 0) {
    job.phase = 'processAudit';
    return zendeskOnlyRunningResult_(job, range, 'CREATED_DONE', 'Created ticket rows are done. Click Populate Zendesk Only again to audit updated tickets.');
  }

  var ticketMap = fetchZendeskTicketsByIds_(config, batch);
  var tickets = hydrateTicketsFromIds_(batch, ticketMap);
  var rows = [];
  addZendeskCreatedTicketRows_(rows, tickets, job.target, config, job.groupMap || {});
  var rowsWritten = writeRawZendeskTickets(rows);
  job.rowsProcessed += rowsWritten;
  job.createdIndex = Number(job.createdIndex || 0) + batch.length;

  return zendeskOnlyRunningResult_(job, range, 'CREATED_ROWS', 'Processed ' + batch.length + ' created ticket IDs and wrote ' + rowsWritten + ' rows. Click Populate Zendesk Only again.');
}

function processZendeskOnlyAuditRows_(job, config, range) {
  var ids = job.updatedIds || [];
  var perClick = getPositiveZendeskNumber_('ZENDESK_AUDIT_TICKETS_PER_CLICK', '', 50);
  var startIndex = Number(job.auditIndex || 0);
  var endIndex = Math.min(ids.length, startIndex + perClick);

  if (startIndex >= ids.length) {
    job.phase = 'processSolved';
    return zendeskOnlyRunningResult_(job, range, 'AUDIT_DONE', 'Updated ticket audits are done. Click Populate Zendesk Only again to process solved fallback rows.');
  }

  var batch = ids.slice(startIndex, endIndex);
  var ticketMap = fetchZendeskTicketsByIds_(config, batch);
  var batchRows = [];

  for (var i = 0; i < batch.length; i++) {
    var ticketId = batch[i];
    var ticket = ticketMap[String(ticketId)];
    if (!ticket) {
      continue;
    }

    addZendeskAuditActionRows_(batchRows, [ticket], job.target, config, range, job.groupMap || {}, job.processedSolved || {});
  }

  var totalRowsWritten = writeRawZendeskTickets(batchRows);
  job.rowsProcessed += totalRowsWritten;
  job.auditIndex = endIndex;

  return zendeskOnlyRunningResult_(job, range, 'AUDIT_ROWS', 'Audited updated tickets ' + job.auditIndex + ' of ' + ids.length + ' and wrote ' + totalRowsWritten + ' rows. Click Populate Zendesk Only again.');
}

function processZendeskOnlySolvedRows_(job, config, range) {
  var ids = job.solvedIds || [];
  var batch = ids.slice(Number(job.solvedIndex || 0), Number(job.solvedIndex || 0) + 100);

  if (batch.length === 0) {
    job.phase = 'normalize';
    return zendeskOnlyRunningResult_(job, range, 'SOLVED_DONE', 'Solved fallback rows are done. Click Populate Zendesk Only again to normalize ticket productivity.');
  }

  var ticketMap = fetchZendeskTicketsByIds_(config, batch);
  var tickets = hydrateTicketsFromIds_(batch, ticketMap);
  var rows = [];
  addZendeskSolvedFallbackRows_(rows, tickets, job.target, config, range, job.groupMap || {}, job.processedSolved || {});
  var rowsWritten = writeRawZendeskTickets(rows);
  job.rowsProcessed += rowsWritten;
  job.solvedIndex = Number(job.solvedIndex || 0) + batch.length;

  return zendeskOnlyRunningResult_(job, range, 'SOLVED_ROWS', 'Processed ' + batch.length + ' solved ticket IDs and wrote ' + rowsWritten + ' rows. Click Populate Zendesk Only again.');
}

function finishZendeskOnlyJob_(job, range) {
  var rawTicketRows = filterRawZendeskForWindow_(getSheetData(SHEET_NAMES.RAW_ZENDESK), range.startDate, range.endDate);
  var normalizedRows = normalizeTicketData(rawTicketRows);
  clearAndWriteRows(SHEET_NAMES.NORMALIZED_TICKETS, SHEET_HEADERS[SHEET_NAMES.NORMALIZED_TICKETS], normalizedRows);

  job.rowsProcessed += normalizedRows.length;
  job.phase = 'done';
  job.endedAt = new Date().toISOString();

  logRun({
    runId: job.runId,
    reportType: job.reportType || 'Zendesk Only Populate',
    startedAt: parseDate_(job.startedAt),
    endedAt: new Date(),
    status: 'SUCCESS',
    rowsProcessed: job.rowsProcessed,
    emailSent: false
  });

  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType || 'Zendesk Only Populate',
    phase: 'zendesk-only',
    status: 'SUCCESS',
    message: 'Zendesk-only job completed. Raw rows plus normalized ticket productivity are ready.',
    rowsProcessed: job.rowsProcessed,
    window: range
  });

  return {
    status: 'SUCCESS',
    job: job,
    rowsProcessed: job.rowsProcessed,
    normalizedRows: normalizedRows.length,
    message: 'Zendesk-only job completed.'
  };
}

function zendeskOnlyRunningResult_(job, range, status, message) {
  logPipelineEvent_({
    runId: job.runId,
    reportType: job.reportType || 'Zendesk Only Populate',
    phase: job.phase,
    status: status,
    message: message,
    agentIndex: job.agentIndex || '',
    totalAgents: getActiveAgents().length,
    rowsProcessed: job.rowsProcessed || 0,
    window: range
  });

  return {
    status: 'RUNNING',
    job: job,
    phase: job.phase,
    rowsProcessed: job.rowsProcessed || 0,
    message: message
  };
}

function setupZendeskOnlyProject_() {
  resetRuntimeCaches_();
  seedKnownScriptProperties_();
  ensureSheet(SHEET_NAMES.CONFIG, SHEET_HEADERS[SHEET_NAMES.CONFIG]);
  ensureSheet(SHEET_NAMES.AGENTS, SHEET_HEADERS[SHEET_NAMES.AGENTS]);
  ensureSheet(SHEET_NAMES.RAW_ZENDESK, SHEET_HEADERS[SHEET_NAMES.RAW_ZENDESK]);
  ensureSheet(SHEET_NAMES.NORMALIZED_TICKETS, SHEET_HEADERS[SHEET_NAMES.NORMALIZED_TICKETS]);
  ensureSheet(SHEET_NAMES.PIPELINE_LOG, SHEET_HEADERS[SHEET_NAMES.PIPELINE_LOG]);
  ensureSheet(SHEET_NAMES.RUN_LOG, SHEET_HEADERS[SHEET_NAMES.RUN_LOG]);
  ensureSheet(SHEET_NAMES.ERROR_LOG, SHEET_HEADERS[SHEET_NAMES.ERROR_LOG]);
  ensureSheet(SHEET_NAMES.FISCAL_CALENDAR, SHEET_HEADERS[SHEET_NAMES.FISCAL_CALENDAR]);
  seedDefaultConfig_();
  seedDefaultAgents_();
}

function buildZendeskOnlySearchQuery_(job, config, range, kind) {
  if (kind === 'created') {
    return buildZendeskQuery_(config, 'type:ticket created>=' + range.searchStart + ' created<' + range.searchEnd);
  }
  if (kind === 'solved') {
    return buildZendeskQuery_(config, 'type:ticket solved>=' + range.searchStart + ' solved<' + range.searchEnd);
  }
  return buildZendeskQuery_(config, 'type:ticket updated>=' + range.searchStart + ' updated<' + range.searchEnd);
}

function moveZendeskOnlySearchPhase_(job, kind) {
  if (kind === 'created') {
    job.phase = 'searchSolved';
  } else if (kind === 'solved') {
    job.phase = 'searchUpdated';
  } else {
    job.phase = 'fetchGroups';
  }
}

function getZendeskOnlyJobRange_(job, config) {
  return buildZendeskDateRange_(parseDate_(job.startDate), parseDate_(job.endDate), config.timeZone);
}

function hydrateTicketsFromIds_(ids, ticketMap) {
  var tickets = [];
  for (var i = 0; i < ids.length; i++) {
    var ticket = ticketMap[String(ids[i])];
    if (ticket) {
      tickets.push(ticket);
    }
  }
  return tickets;
}

function saveLargeScriptState_(baseKey, value) {
  var properties = PropertiesService.getScriptProperties();
  clearLargeScriptState_(baseKey);

  var text = JSON.stringify(value || {});
  var chunkSize = 7500;
  var chunks = Math.ceil(text.length / chunkSize);

  properties.setProperty(baseKey + '_COUNT', String(chunks));
  for (var i = 0; i < chunks; i++) {
    properties.setProperty(baseKey + '_' + i, text.slice(i * chunkSize, (i + 1) * chunkSize));
  }
}

function getLargeScriptState_(baseKey) {
  var properties = PropertiesService.getScriptProperties();
  var count = Number(properties.getProperty(baseKey + '_COUNT') || 0);
  if (!count) {
    return null;
  }

  var text = '';
  for (var i = 0; i < count; i++) {
    text += properties.getProperty(baseKey + '_' + i) || '';
  }

  return text ? JSON.parse(text) : null;
}

function clearLargeScriptState_(baseKey) {
  var properties = PropertiesService.getScriptProperties();
  var count = Number(properties.getProperty(baseKey + '_COUNT') || 0);
  for (var i = 0; i < count; i++) {
    properties.deleteProperty(baseKey + '_' + i);
  }
  properties.deleteProperty(baseKey + '_COUNT');
}
