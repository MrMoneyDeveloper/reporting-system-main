function pullZendeskTickets(startDate, endDate, agents) {
  var activeAgents = agents && agents.length ? agents : getActiveAgents();
  var config = getZendeskPullConfig_(activeAgents);

  if (!config.isConfigured) {
    logError('pullZendeskTickets', new Error('Zendesk Script Properties are not configured; skipping pull.'), 'SKIPPED', 0);
    return [];
  }

  var target = loadZendeskTargetUsers_(config, activeAgents);
  if (Object.keys(target.userById).length === 0) {
    logError('pullZendeskTickets', new Error('None of the configured agents could be matched to Zendesk users.'), 'SKIPPED', 0);
    return [];
  }

  var range = buildZendeskDateRange_(startDate, endDate, config.timeZone);
  config.currentRange = range;
  var createdQuery = buildZendeskQuery_(config, 'type:ticket created>=' + range.searchStart + ' created<' + range.searchEnd);
  var solvedQuery = buildZendeskQuery_(config, 'type:ticket solved>=' + range.searchStart + ' solved<' + range.searchEnd);
  var updatedQuery = buildZendeskQuery_(config, 'type:ticket updated>=' + range.searchStart + ' updated<' + range.searchEnd);

  logPipelineEvent_({
    phase: 'zendesk',
    status: 'SEARCH_START',
    message: 'Searching Zendesk created, solved, and updated tickets for ' + Object.keys(target.userById).length + ' matched users.',
    totalAgents: activeAgents.length,
    window: { startDate: range.startDate, endDate: range.endDate }
  });

  var createdSearch = fetchZendeskSearchAll_(config, createdQuery);
  var solvedSearch = fetchZendeskSearchAll_(config, solvedQuery);
  var updatedSearch = fetchZendeskSearchAll_(config, updatedQuery);
  var auditBatch = selectZendeskAuditBatch_(updatedSearch, range, config);
  var updatedTicketsToAudit = auditBatch.tickets;

  if (auditBatch.hasMore) {
    logPipelineEvent_({
      phase: 'zendesk',
      status: 'AUDIT_BATCH',
      message: 'Zendesk updated search returned ' + updatedSearch.length + ' tickets. Auditing ' + updatedTicketsToAudit.length + ' this execution; run again to continue.',
      totalAgents: activeAgents.length,
      window: { startDate: range.startDate, endDate: range.endDate }
    });
  }

  var allTicketIds = uniqueValues_([].concat(
    pluckTicketIds_(createdSearch),
    pluckTicketIds_(solvedSearch),
    pluckTicketIds_(updatedTicketsToAudit)
  ));
  var fullTicketMap = fetchZendeskTicketsByIds_(config, allTicketIds);
  var groupMap = fetchZendeskGroupsMap_(config);
  var rows = [];
  var processedSolved = {};

  addZendeskCreatedTicketRows_(rows, hydrateTickets_(createdSearch, fullTicketMap), target, config, groupMap);
  addZendeskAuditActionRows_(rows, hydrateTickets_(updatedTicketsToAudit, fullTicketMap), target, config, range, groupMap, processedSolved);
  saveZendeskAuditCursor_(auditBatch, range);
  addZendeskSolvedFallbackRows_(rows, hydrateTickets_(solvedSearch, fullTicketMap), target, config, range, groupMap, processedSolved);

  logPipelineEvent_({
    phase: 'zendesk',
    status: 'SEARCH_DONE',
    message: 'Zendesk search found created=' + createdSearch.length + ', solved=' + solvedSearch.length + ', updated=' + updatedSearch.length + ', audited=' + updatedTicketsToAudit.length + ', raw action rows=' + rows.length + '.',
    rowsProcessed: rows.length,
    totalAgents: activeAgents.length,
    window: { startDate: range.startDate, endDate: range.endDate }
  });

  return dedupeZendeskRows(rows);
}

function writeRawZendeskTickets(rows) {
  var uniqueRows = dedupeZendeskRows(rows || []);
  return appendRows(SHEET_NAMES.RAW_ZENDESK, uniqueRows);
}

function getZendeskPullConfig_(activeAgents) {
  var subdomain = normalizeZendeskSubdomain_(getScriptProperty_('ZENDESK_SUBDOMAIN'));
  var email = String(getScriptProperty_('ZENDESK_EMAIL') || '').replace(/\/token$/i, '').trim();
  var token = getScriptProperty_('ZENDESK_API_TOKEN');

  return {
    isConfigured: !!(subdomain && email && token),
    subdomain: subdomain,
    zendeskEmail: email,
    zendeskApiToken: token,
    timeZone: getReportTimezone_(),
    searchFilter: getZendeskConfigValue_('ZENDESK_SEARCH_QUERY_EXTRA') || getZendeskConfigValue_('ZENDESK_SEARCH_FILTER'),
    maxSearchPages: getPositiveZendeskNumber_('ZENDESK_MAX_SEARCH_PAGES', 'MAX_SEARCH_PAGES', 1),
    maxUpdatedTickets: getPositiveZendeskNumber_('ZENDESK_MAX_UPDATED_TICKETS', 'MAX_UPDATED_TICKETS', 100),
    maxAuditPagesPerTicket: getPositiveZendeskNumber_('ZENDESK_MAX_AUDIT_PAGES_PER_TICKET', 'MAX_AUDIT_PAGES_PER_TICKET', 8),
    activeAgentCount: activeAgents ? activeAgents.length : 0
  };
}

function loadZendeskTargetUsers_(config, activeAgents) {
  var target = {
    userById: {},
    agentByUserId: {},
    warnings: []
  };
  var agents = activeAgents && activeAgents.length ? activeAgents : buildDefaultAgentObjects_();
  var seenZendeskUserIds = {};

  for (var i = 0; i < agents.length; i++) {
    var agent = agents[i] || {};
    var identifier = agent.email || agent.name;
    if (!identifier) {
      continue;
    }

    try {
      var user = findZendeskUser_(config, identifier);
      if (!user || !user.id) {
        target.warnings.push('Could not find Zendesk user for ' + identifier + '.');
        continue;
      }

      var userId = String(user.id);
      if (seenZendeskUserIds[userId]) {
        continue;
      }

      seenZendeskUserIds[userId] = true;
      target.userById[userId] = user;
      target.agentByUserId[userId] = agent;
    } catch (error) {
      target.warnings.push('Could not resolve Zendesk user for ' + identifier + ': ' + error.message);
    }
  }

  for (var j = 0; j < target.warnings.length; j++) {
    logPipelineEvent_({
      phase: 'zendesk-user',
      status: 'WARNING',
      message: target.warnings[j],
      totalAgents: agents.length
    });
  }

  return target;
}

function findZendeskUser_(config, identifier) {
  var query = encodeURIComponent(identifier);
  var data = zendeskGet_(config, '/api/v2/users/search.json?query=' + query);
  var users = data.users || [];
  if (!users.length) {
    return null;
  }

  var target = String(identifier || '').trim().toLowerCase();
  var exact;

  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || '').toLowerCase() === target) {
      exact = users[i];
      break;
    }
  }
  if (exact) {
    return exact;
  }

  for (var j = 0; j < users.length; j++) {
    if (String(users[j].name || '').toLowerCase() === target) {
      exact = users[j];
      break;
    }
  }
  if (exact) {
    return exact;
  }

  for (var k = 0; k < users.length; k++) {
    if (users[k].role === 'agent' || users[k].role === 'admin') {
      return users[k];
    }
  }

  return users[0];
}

function fetchZendeskSearchAll_(config, query) {
  var results = [];
  var pageCount = 0;
  var url = '/api/v2/search.json?query=' + encodeURIComponent(query) + '&sort_by=created_at&sort_order=asc&per_page=100';

  while (url && pageCount < config.maxSearchPages) {
    var data = zendeskGet_(config, url);
    var pageResults = data.results || [];
    for (var i = 0; i < pageResults.length; i++) {
      if (!pageResults[i].result_type || pageResults[i].result_type === 'ticket') {
        results.push(pageResults[i]);
      }
    }
    url = data.next_page || '';
    pageCount++;
  }

  if (url) {
    logPipelineEvent_({
      phase: 'zendesk-search',
      status: 'TRUNCATED',
      message: 'Zendesk search stopped at max pages=' + config.maxSearchPages + ' for query: ' + query
    });
  }

  return dedupeTicketsById_(results);
}

function selectZendeskAuditBatch_(updatedSearch, range, config) {
  var propertyValue = PropertiesService.getScriptProperties().getProperty('ZENDESK_AUDIT_CURSOR');
  var cursor = propertyValue ? JSON.parse(propertyValue) : {};
  var windowKey = getZendeskAuditWindowKey_(range);
  var startIndex = cursor.windowKey === windowKey ? Number(cursor.nextIndex || 0) : 0;
  var selected = [];

  if (startIndex >= updatedSearch.length) {
    startIndex = 0;
  }

  for (var i = startIndex; i < updatedSearch.length && selected.length < config.maxUpdatedTickets; i++) {
    selected.push(updatedSearch[i]);
  }

  var nextIndex = startIndex + selected.length;

  return {
    windowKey: windowKey,
    startIndex: startIndex,
    nextIndex: nextIndex,
    tickets: selected,
    hasMore: nextIndex < updatedSearch.length
  };
}

function saveZendeskAuditCursor_(auditBatch, range) {
  var properties = PropertiesService.getScriptProperties();

  if (!auditBatch.hasMore) {
    properties.deleteProperty('ZENDESK_AUDIT_CURSOR');
    return;
  }

  properties.setProperty('ZENDESK_AUDIT_CURSOR', JSON.stringify({
    windowKey: auditBatch.windowKey || getZendeskAuditWindowKey_(range),
    nextIndex: auditBatch.nextIndex || 0,
    updatedAt: new Date().toISOString()
  }));
}

function getZendeskAuditWindowKey_(range) {
  return [
    Utilities.formatDate(range.startDate, getReportTimezone_(), 'yyyyMMddHHmm'),
    Utilities.formatDate(range.endDate, getReportTimezone_(), 'yyyyMMddHHmm')
  ].join('-');
}

function fetchZendeskTicketsByIds_(config, ids) {
  var map = {};
  var chunks = chunkArray_(uniqueValues_(ids || []), 100);

  for (var i = 0; i < chunks.length; i++) {
    if (!chunks[i].length) {
      continue;
    }
    var data = zendeskGet_(config, '/api/v2/tickets/show_many.json?ids=' + chunks[i].join(','));
    var tickets = data.tickets || [];
    for (var j = 0; j < tickets.length; j++) {
      map[String(tickets[j].id)] = tickets[j];
    }
  }

  return map;
}

function fetchZendeskTicketAudits_(config, ticketId) {
  var audits = [];
  var url = '/api/v2/tickets/' + ticketId + '/audits.json';
  var pageCount = 0;

  while (url && pageCount < config.maxAuditPagesPerTicket) {
    var data = zendeskGet_(config, url);
    audits = audits.concat(data.audits || []);
    url = data.next_page || '';
    pageCount++;
  }

  return audits;
}

function fetchZendeskGroupsMap_(config) {
  var map = {};
  var url = '/api/v2/groups.json?per_page=100';
  var pageCount = 0;

  while (url && pageCount < 20) {
    var data = zendeskGet_(config, url);
    var groups = data.groups || [];
    for (var i = 0; i < groups.length; i++) {
      map[String(groups[i].id)] = groups[i].name || '';
    }
    url = data.next_page || '';
    pageCount++;
  }

  return map;
}

function addZendeskCreatedTicketRows_(rows, tickets, target, config, groupMap) {
  for (var i = 0; i < tickets.length; i++) {
    var ticket = tickets[i];
    if (!ticket || !ticket.id || !shouldKeepZendeskTicket_(ticket, groupMap)) {
      continue;
    }

    var submitterId = String(ticket.submitter_id || '');
    if (!target.userById[submitterId] || !isIsoInWindow_(ticket.created_at, config.currentRange)) {
      continue;
    }

    rows.push(mapZendeskActionToRawRow_({
      ticket: ticket,
      user: target.userById[submitterId],
      agent: target.agentByUserId[submitterId],
      groupMap: groupMap,
      eventType: 'Ticket Created',
      eventTime: ticket.created_at,
      productivityCounted: 'No',
      actionDescription: 'Submitted a new ticket. This is workload only.',
      commentText: ''
    }));
  }
}

function addZendeskAuditActionRows_(rows, tickets, target, config, range, groupMap, processedSolved) {
  config.currentRange = range;

  for (var i = 0; i < tickets.length; i++) {
    var ticket = tickets[i];
    if (!ticket || !ticket.id || !shouldKeepZendeskTicket_(ticket, groupMap)) {
      continue;
    }

    var audits = fetchZendeskTicketAudits_(config, ticket.id);
    for (var j = 0; j < audits.length; j++) {
      var audit = audits[j] || {};
      if (!audit.created_at || !isIsoInWindow_(audit.created_at, range)) {
        continue;
      }

      var authorId = String(audit.author_id || '');
      if (!target.userById[authorId]) {
        continue;
      }

      var parsed = parseZendeskAuditEvents_(ticket, audit);
      if (!parsed) {
        continue;
      }

      if (parsed.solved) {
        processedSolved[String(ticket.id) + ':' + authorId] = true;
      }

      rows.push(mapZendeskActionToRawRow_({
        ticket: ticket,
        user: target.userById[authorId],
        agent: target.agentByUserId[authorId],
        groupMap: groupMap,
        eventType: parsed.eventType,
        eventTime: audit.created_at,
        productivityCounted: parsed.productivityCounted ? 'Yes' : 'No',
        actionDescription: parsed.actionDescription,
        commentText: parsed.commentText
      }));
    }
  }
}

function addZendeskSolvedFallbackRows_(rows, tickets, target, config, range, groupMap, processedSolved) {
  for (var i = 0; i < tickets.length; i++) {
    var ticket = tickets[i];
    if (!ticket || !ticket.id || !shouldKeepZendeskTicket_(ticket, groupMap)) {
      continue;
    }

    var assigneeId = String(ticket.assignee_id || '');
    var solvedAt = ticket.solved_at || ticket.updated_at;
    var solvedKey = String(ticket.id) + ':' + assigneeId;

    if (!target.userById[assigneeId] || !solvedAt || !isIsoInWindow_(solvedAt, range) || processedSolved[solvedKey]) {
      continue;
    }

    processedSolved[solvedKey] = true;
    rows.push(mapZendeskActionToRawRow_({
      ticket: ticket,
      user: target.userById[assigneeId],
      agent: target.agentByUserId[assigneeId],
      groupMap: groupMap,
      eventType: 'Ticket Solved',
      eventTime: solvedAt,
      productivityCounted: 'Yes',
      actionDescription: 'Solved the ticket. This counts as productivity.',
      commentText: ''
    }));
  }
}

function parseZendeskAuditEvents_(ticket, audit) {
  var events = audit.events || [];
  var customerReply = false;
  var solved = false;
  var otherAction = false;
  var descriptions = [];
  var commentTexts = [];

  for (var i = 0; i < events.length; i++) {
    var event = events[i] || {};
    var type = event.type || '';

    if (type === 'Comment') {
      var comment = cleanZendeskText_(event.plain_body || event.body || event.html_body || '');
      if (!comment) {
        continue;
      }

      if (event.public === true && !isInitialSubmissionComment_(ticket, audit)) {
        customerReply = true;
        commentTexts.push(comment);
        descriptions.push('Public customer reply');
      } else if (event.public !== true) {
        otherAction = true;
        commentTexts.push(comment);
        descriptions.push('Internal note');
      }
    }

    if (type === 'Change') {
      var fieldName = String(event.field_name || event.field || '').toLowerCase();
      var newValue = String(event.value || '').toLowerCase();
      if (fieldName === 'status' && newValue === 'solved') {
        solved = true;
        descriptions.push('Ticket solved');
      } else {
        otherAction = true;
        descriptions.push('Ticket updated');
      }
    }
  }

  if (!customerReply && !solved && !otherAction) {
    return null;
  }

  var eventType = 'Ticket Updated';
  if (customerReply && solved) {
    eventType = 'Customer Reply + Solved';
  } else if (customerReply) {
    eventType = 'Customer Reply';
  } else if (solved) {
    eventType = 'Ticket Solved';
  }

  return {
    eventType: eventType,
    customerReply: customerReply,
    solved: solved,
    productivityCounted: customerReply || solved,
    actionDescription: uniqueValues_(descriptions).join('; '),
    commentText: commentTexts.join('\n\n')
  };
}

function mapZendeskActionToRawRow_(params) {
  var ticket = params.ticket || {};
  var user = params.user || {};
  var agent = params.agent || {};
  var groupMap = params.groupMap || {};
  var eventType = params.eventType || '';
  var eventTime = params.eventTime || ticket.updated_at || ticket.created_at || '';
  var email = normalizeEmail_(agent.email || user.email);
  var agentName = agent.name || user.name || email;
  var solvedAt = eventType.toLowerCase().indexOf('solved') !== -1 ? eventTime : (ticket.solved_at || '');

  return [
    new Date(),
    ticket.id || '',
    email,
    agentName,
    ticket.status || '',
    ticket.created_at || '',
    solvedAt,
    eventTime || ticket.updated_at || '',
    ticket.ticket_form_id || ticket.ticket_form || '',
    groupMap[String(ticket.group_id)] || ticket.group_id || '',
    Array.isArray(ticket.tags) ? ticket.tags.join(',') : (ticket.tags || ''),
    ticket.via && ticket.via.channel ? ticket.via.channel : '',
    eventType,
    eventTime,
    params.productivityCounted || 'No',
    params.actionDescription || '',
    params.commentText || ''
  ];
}

function dedupeZendeskRows(rows) {
  var existingRows = getSheetData(SHEET_NAMES.RAW_ZENDESK);
  var seen = {};

  for (var i = 0; i < existingRows.length; i++) {
    seen[zendeskDedupeKey_(existingRows[i])] = true;
  }

  var uniqueRows = [];
  for (var j = 0; j < rows.length; j++) {
    var key = zendeskDedupeKey_(rows[j]);
    if (!key || seen[key]) {
      continue;
    }
    seen[key] = true;
    uniqueRows.push(rows[j]);
  }

  return uniqueRows;
}

function zendeskDedupeKey_(row) {
  if (Array.isArray(row)) {
    return [
      row[1],
      normalizeEmail_(row[2]),
      row[12] || '',
      row[13] || row[7] || row[6] || row[5] || ''
    ].join('|');
  }

  return [
    row['Ticket ID'],
    normalizeEmail_(row['Agent Email']),
    row['Event Type'] || '',
    row['Event Time'] || row['Updated At'] || row['Solved At'] || row['Created At'] || ''
  ].join('|');
}

function buildZendeskQuery_(config, baseQuery) {
  var extra = String(config.searchFilter || '').trim();
  return extra ? baseQuery + ' ' + extra : baseQuery;
}

function buildZendeskDateRange_(startDate, endDate, timeZone) {
  var start = parseDate_(startDate);
  var end = parseDate_(endDate);
  var searchStart = Utilities.formatDate(start, timeZone, 'yyyy-MM-dd');
  var searchEnd = Utilities.formatDate(end, timeZone, 'yyyy-MM-dd');

  if (searchStart === searchEnd) {
    searchEnd = Utilities.formatDate(addDays_(start, 1), timeZone, 'yyyy-MM-dd');
  }

  return {
    startDate: start,
    endDate: end,
    searchStart: searchStart,
    searchEnd: searchEnd
  };
}

function zendeskGet_(config, pathOrUrl) {
  var url = String(pathOrUrl || '').indexOf('http') === 0 ? pathOrUrl : 'https://' + config.subdomain + '.zendesk.com' + pathOrUrl;
  var options = buildZendeskRequestOptions_(config.zendeskEmail, config.zendeskApiToken);
  options.headers.Accept = 'application/json';

  for (var attempt = 1; attempt <= 3; attempt++) {
    var response = UrlFetchApp.fetch(url, options);
    var statusCode = response.getResponseCode();
    var body = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      return JSON.parse(body || '{}');
    }

    if (statusCode === 429 || statusCode >= 500) {
      Utilities.sleep(attempt * 2500);
      continue;
    }

    throw new Error('Zendesk API returned HTTP ' + statusCode + ': ' + body);
  }

  throw new Error('Zendesk API failed after retries: ' + url);
}

function buildZendeskRequestOptions_(email, token) {
  return {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(email + '/token:' + token)
    }
  };
}

function shouldKeepZendeskTicket_(ticket, groupMap) {
  var allowedFormIds = getZendeskCsvConfig_('ZENDESK_TICKET_FORM_IDS');
  var allowedGroups = getZendeskCsvConfig_('ZENDESK_GROUP_IDS').map(function (value) {
    return normalizeKey_(value);
  });
  var requiredTags = getZendeskCsvConfig_('ZENDESK_REQUIRED_TAGS').map(function (value) {
    return String(value || '').trim().toLowerCase();
  });

  if (allowedFormIds.length > 0) {
    var formId = String(ticket.ticket_form_id || ticket.ticket_form || ticket.form || '').trim();
    if (allowedFormIds.indexOf(formId) === -1) {
      return false;
    }
  }

  if (allowedGroups.length > 0) {
    var groupId = String(ticket.group_id || '').trim();
    var groupName = groupMap && groupMap[groupId] ? groupMap[groupId] : '';
    var groupKey = normalizeKey_(groupId);
    var groupNameKey = normalizeKey_(groupName);
    if (allowedGroups.indexOf(groupKey) === -1 && allowedGroups.indexOf(groupNameKey) === -1) {
      return false;
    }
  }

  if (requiredTags.length > 0) {
    var tags = Array.isArray(ticket.tags) ? ticket.tags : String(ticket.tags || '').split(',');
    var tagMap = {};
    for (var i = 0; i < tags.length; i++) {
      tagMap[String(tags[i] || '').trim().toLowerCase()] = true;
    }

    var matchedTag = false;
    for (var j = 0; j < requiredTags.length; j++) {
      if (tagMap[requiredTags[j]]) {
        matchedTag = true;
        break;
      }
    }

    if (!matchedTag) {
      return false;
    }
  }

  return true;
}

function isIsoInWindow_(isoString, range) {
  if (!isoString || !range) {
    return false;
  }
  var eventTime = new Date(isoString).getTime();
  return eventTime >= range.startDate.getTime() && eventTime < range.endDate.getTime();
}

function isInitialSubmissionComment_(ticket, audit) {
  if (!ticket.created_at || !audit.created_at || !ticket.submitter_id || !audit.author_id) {
    return false;
  }
  if (String(ticket.submitter_id) !== String(audit.author_id)) {
    return false;
  }
  return Math.abs(new Date(audit.created_at).getTime() - new Date(ticket.created_at).getTime()) / 1000 <= 180;
}

function cleanZendeskText_(text) {
  return String(text || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeZendeskSubdomain_(value) {
  return String(value || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\.zendesk\.com\/?$/i, '')
    .replace(/\/$/g, '')
    .trim();
}

function hydrateTickets_(tickets, ticketMap) {
  var output = [];
  for (var i = 0; i < tickets.length; i++) {
    output.push(ticketMap[String(tickets[i].id)] || tickets[i]);
  }
  return output;
}

function pluckTicketIds_(tickets) {
  var ids = [];
  for (var i = 0; i < (tickets || []).length; i++) {
    if (tickets[i] && tickets[i].id) {
      ids.push(tickets[i].id);
    }
  }
  return ids;
}

function dedupeTicketsById_(tickets) {
  var seen = {};
  var output = [];
  for (var i = 0; i < (tickets || []).length; i++) {
    var key = String(tickets[i].id || '');
    if (!key || seen[key]) {
      continue;
    }
    seen[key] = true;
    output.push(tickets[i]);
  }
  return output;
}

function uniqueValues_(values) {
  var seen = {};
  var output = [];
  for (var i = 0; i < (values || []).length; i++) {
    var value = values[i];
    if (value === null || typeof value === 'undefined' || value === '') {
      continue;
    }
    var key = String(value);
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    output.push(value);
  }
  return output;
}

function chunkArray_(array, size) {
  var chunks = [];
  for (var i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function buildDefaultAgentObjects_() {
  var agents = [];
  for (var i = 0; i < DEFAULT_AGENT_EMAILS.length; i++) {
    agents.push({
      active: true,
      name: nameFromEmail_(DEFAULT_AGENT_EMAILS[i]),
      email: DEFAULT_AGENT_EMAILS[i],
      shift: ''
    });
  }
  return agents;
}

function getPositiveZendeskNumber_(primaryKey, fallbackKey, defaultValue) {
  var value = Number(getZendeskConfigValue_(primaryKey) || getZendeskConfigValue_(fallbackKey) || defaultValue);
  if (!value || value < 1) {
    return defaultValue;
  }
  return value;
}

function getZendeskCsvConfig_(key) {
  var value = getZendeskConfigValue_(key);
  if (!value) {
    return [];
  }

  return String(value).split(',').map(function (item) {
    return item.trim();
  }).filter(function (item) {
    return item;
  });
}

function getZendeskConfigValue_(key) {
  return String(getConfigValue(key, '') || getScriptProperty_(key) || '').trim();
}
