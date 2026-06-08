const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const SHIFT_ORDER = ['Day', 'Mid', 'Night'];
const DEFAULT_APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxRhff21JVjkpDbXQg3jSBn_UzYYIMeAwpNBb8k0iiRQOJyRCqhnPXml5mONlGYZeOEQA/exec';
const DEFAULT_DASHBOARD_API_TOKEN = 'cx-dashboard-api-20260608-46f64a04b4044e8d';

export async function onRequest(context) {
  const { request, env } = context;
  const startedAt = Date.now();
  const url = new URL(request.url);
  const route = normalizeRoute(url.pathname);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (route === 'health') {
      return jsonResponse(await buildHealth(env, startedAt), 200);
    }

    if (route === 'bootstrap') {
      return proxyJson(env, 'dashboardBootstrap', {}, startedAt);
    }

    if (route === 'metrics') {
      return proxyJson(env, 'dashboardMetrics', readFiltersFromUrl(url), startedAt);
    }

    if (route === 'sync-status') {
      return proxyJson(env, 'dashboardSyncStatus', {}, startedAt);
    }

    if (route === 'insight') {
      const requestPayload = request.method === 'POST'
        ? await readJsonBody(request)
        : readFiltersFromUrl(url);
      return proxyJson(env, 'dashboardInsight', normalizePayloadRequest(requestPayload), startedAt);
    }

    if (route === 'hard-refresh') {
      if (request.method !== 'POST') {
        return jsonResponse({ status: 'ERROR', message: 'Hard refresh requires POST.' }, 405);
      }
      const requestPayload = await readJsonBody(request);
      return proxyJson(env, 'dashboardHardRefresh', normalizePayloadRequest(requestPayload), startedAt);
    }

    if (route === 'export.csv') {
      const filters = readFiltersFromUrl(url);
      const metrics = await callAppsScript(env, 'dashboardMetrics', filters);
      const csv = buildReportCsv(metrics, filters);
      return new Response(csv, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${buildCsvFilename(metrics, filters)}"`
        }
      });
    }

    return jsonResponse({
      status: 'ERROR',
      message: `Unknown API route: ${route || '/api'}`
    }, 404);
  } catch (error) {
    return jsonResponse({
      status: 'ERROR',
      message: error.message || String(error),
      proxy: {
        route,
        durationMs: Date.now() - startedAt,
        generatedAt: new Date().toISOString()
      }
    }, error.statusCode || 500);
  }
}

async function proxyJson(env, action, requestPayload, startedAt) {
  const result = await callAppsScript(env, action, requestPayload);
  return jsonResponse({
    ...result,
    proxy: {
      action,
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
      source: 'cloudflare-pages-function'
    }
  }, result.status === 'ERROR' ? 502 : 200);
}

async function callAppsScript(env, action, requestPayload) {
  const webAppUrl = getAppsScriptUrl(env);
  if (!webAppUrl) {
    const error = new Error('Apps Script web app URL is not configured in the project API bridge.');
    error.statusCode = 500;
    throw error;
  }

  const internalSecret = getInternalSecret(env);
  if (!internalSecret) {
    return callAppsScriptGet(webAppUrl, action, requestPayload);
  }

  const body = {
    action,
    request: requestPayload || {}
  };
  body.secret = internalSecret;

  const response = await fetch(webAppUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    redirect: 'follow'
  });

  return parseAppsScriptResponse(response, action);
}

async function callAppsScriptGet(webAppUrl, action, requestPayload) {
  const params = new URLSearchParams({
    format: 'json',
    api: action,
    dashboardToken: getDashboardApiToken()
  });

  Object.entries(requestPayload || {}).forEach(([key, value]) => {
    if (value !== null && typeof value !== 'undefined' && typeof value !== 'object') {
      params.set(key, String(value));
    }
  });

  const response = await fetch(addQuery(webAppUrl, params.toString()), {
    method: 'GET',
    redirect: 'follow'
  });

  return parseAppsScriptResponse(response, action);
}

async function parseAppsScriptResponse(response, action) {
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const htmlSnippet = text.replace(/\s+/g, ' ').slice(0, 240);
    const badResponse = new Error(`Apps Script returned non-JSON HTTP ${response.status} for ${action}: ${htmlSnippet}`);
    badResponse.statusCode = 502;
    throw badResponse;
  }

  if (!response.ok || parsed.status === 'ERROR') {
    const message = parsed.message || `Apps Script returned HTTP ${response.status}`;
    const apiError = new Error(message);
    apiError.statusCode = response.ok ? 502 : response.status;
    throw apiError;
  }

  const result = Object.prototype.hasOwnProperty.call(parsed, 'result') ? parsed.result : parsed;
  if (result && result.status === 'ERROR') {
    const resultError = new Error(result.message || 'Apps Script dashboard action failed.');
    resultError.statusCode = 502;
    throw resultError;
  }

  return {
    ...(result && typeof result === 'object' ? result : { result }),
    appScriptApi: parsed.api || null
  };
}

async function buildHealth(env, startedAt) {
  const webAppUrl = getAppsScriptUrl(env);
  const base = {
    status: webAppUrl ? 'SUCCESS' : 'SETUP_REQUIRED',
    service: 'CX Experts Cloudflare dashboard API',
    appsScriptConfigured: Boolean(webAppUrl),
    internalSecretConfigured: Boolean(getInternalSecret(env)),
    connectionMode: getInternalSecret(env) ? 'POST_SECRET' : 'GET_PROJECT_API',
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt
  };

  if (!webAppUrl) {
    return {
      ...base,
      message: 'Apps Script web app URL is not configured in the project API bridge.'
    };
  }

  try {
    const healthUrl = addQuery(webAppUrl, 'format=json&api=health');
    const response = await fetch(healthUrl, { redirect: 'follow' });
    const text = await response.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch (ignored) {
      parsed = { raw: text.replace(/\s+/g, ' ').slice(0, 160) };
    }

    return {
      ...base,
      remoteStatus: response.ok ? 'OK' : 'FAILED',
      remoteHttpStatus: response.status,
      remote: parsed,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ...base,
      status: 'ERROR',
      remoteStatus: 'FAILED',
      message: error.message || String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

function getAppsScriptUrl(env) {
  return String(
    env.APPS_SCRIPT_WEB_APP_URL ||
    env.APPS_SCRIPT_URL ||
    env.VITE_APPS_SCRIPT_WEB_APP_URL ||
    DEFAULT_APPS_SCRIPT_WEB_APP_URL ||
    ''
  ).trim();
}

function getInternalSecret(env) {
  return String(
    env.INTERNAL_API_SECRET ||
    env.APPS_SCRIPT_INTERNAL_API_SECRET ||
    ''
  ).trim();
}

function getDashboardApiToken() {
  return DEFAULT_DASHBOARD_API_TOKEN;
}

function normalizeRoute(pathname) {
  return String(pathname || '')
    .replace(/^\/api\/?/, '')
    .replace(/^\/+|\/+$/g, '') || 'health';
}

function readFiltersFromUrl(url) {
  return {
    periodType: url.searchParams.get('periodType') || 'daily',
    periodKey: url.searchParams.get('periodKey') || '',
    agentEmail: url.searchParams.get('agentEmail') || '',
    shift: url.searchParams.get('shift') || ''
  };
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch (error) {
    return {};
  }
}

function normalizePayloadRequest(payload) {
  if (payload && payload.request && typeof payload.request === 'object') {
    return payload.request;
  }
  return payload || {};
}

function addQuery(url, query) {
  return String(url).includes('?') ? `${url}&${query}` : `${url}?${query}`;
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

function buildCsvFilename(metrics, filters) {
  const periodType = (metrics.filters && metrics.filters.periodType) || filters.periodType || 'report';
  const periodKey = (metrics.filters && metrics.filters.periodKey) || filters.periodKey || 'latest';
  return `cx-experts-${safeFilenamePart(periodType)}-${safeFilenamePart(periodKey)}.csv`;
}

function buildReportCsv(metrics, filters) {
  const activeFilters = metrics.filters || filters || {};
  const rows = Array.isArray(metrics.rows) ? metrics.rows : [];
  const kpis = metrics.kpis || {};
  const freshness = metrics.freshness || {};
  const output = [];

  output.push(['CX Experts Reporting']);
  output.push(['Report Type', activeFilters.periodType || '']);
  output.push(['Report Period', activeFilters.periodKey || '']);
  output.push(['Generated At', metrics.generatedAt || new Date().toISOString()]);
  output.push(['Last Source Sync', freshness.lastSourceSync || '']);
  output.push(['Last Analytics Refresh', freshness.lastAnalyticsRefresh || '']);
  output.push(['Latest WFM Upload', freshness.latestWfmImport || '']);
  output.push([]);
  output.push(['Overall Totals']);
  output.push(['Agents Reviewed', kpis.agents || 0]);
  output.push(['Tickets Solved', kpis.ticketsSolved || 0]);
  output.push(['Productive Actions', kpis.productivityActions || 0]);
  output.push(['In Progress Tickets', kpis.inProgressTickets || 0]);
  output.push(['Review Flags', kpis.riskCount || 0]);
  output.push(['WFM Outstanding Hours', kpis.wfmOutstandingHours || '']);
  output.push([]);

  addSection(output, 'Shift Comparison', buildShiftSummaryRows(metrics.charts && metrics.charts.shiftSummary));
  addSection(output, 'Shift Roster', buildShiftRosterRows(rows));
  addSection(output, 'Zendesk Ticket Output', buildZendeskRows(rows));
  addSection(output, 'Attendance Review', buildAttendanceRows(rows));

  if ((activeFilters.periodType || '').toLowerCase() === 'monthly') {
    addSection(output, 'WFM Balance Review', buildWfmRows(rows));
  }

  addSection(output, 'Risk And Missing Data', buildRiskRows(metrics.risks || []));

  return output.map(toCsvLine).join('\r\n');
}

function addSection(output, title, rows) {
  output.push([]);
  output.push([title]);
  output.push(['Shift', 'Name', 'Details', 'Tasks/Productivity', 'Status', 'Notes']);
  rows.forEach((row) => output.push(row));
}

function buildShiftSummaryRows(rows) {
  return sortByShift(rows || []).map((row) => [
    row.label || '',
    row.label || '',
    `Agents: ${row.agents || 0}; present/missing is reflected by attendance; solved ${row.tickets || 0}; commented ${row.commentedTickets || 0}; in progress ${row.inProgressTickets || 0}`,
    row.actions || 0,
    row.inProgressTickets ? 'In progress' : 'Reviewed',
    'Tickets shown by shift for this reporting period.'
  ]);
}

function buildShiftRosterRows(rows) {
  return sortByShift(rows).map((row) => [
    row.shift || 'Unassigned',
    row.agentName || '',
    `Assigned to ${row.shift || 'Unassigned'} shift`,
    row.inProgressTickets || '',
    getTicketFollowUpStatus(row),
    row.openTicketNotes || ''
  ]);
}

function buildZendeskRows(rows) {
  return sortByShift(rows).map((row) => [
    row.shift || 'Unassigned',
    row.agentName || '',
    `Created ${row.ticketsCreated || 0}; solved ${row.ticketsSolved || 0}; commented ${row.commentedTickets || 0}; in progress ${row.inProgressTickets || 0}`,
    `Solved ${row.ticketsSolved || 0}; commented ${row.commentedTickets || 0}`,
    getTicketFollowUpStatus(row),
    row.openTicketNotes || row.notes || ''
  ]);
}

function buildAttendanceRows(rows) {
  return sortByShift(rows).filter((row) => isAttendanceException(row)).map((row) => [
    row.shift || 'Unassigned',
    row.agentName || '',
    `Status: ${row.attendanceStatus || 'Missing'}; expected hours: ${formatNumber(row.expectedHours)}`,
    formatPercent(row.attendancePercent === '' ? null : Number(row.attendancePercent) * 100),
    row.attendancePercent === '' ? 'Missing data' : 'Reviewed',
    row.notes || ''
  ]);
}

function buildWfmRows(rows) {
  return sortByShift(rows).map((row) => [
    row.shift || 'Unassigned',
    row.agentName || '',
    `Total ${formatNumber(row.wfmTotalHours)}h; productive ${formatNumber(row.wfmProductiveHours)}h; general ${formatNumber(row.wfmGeneralTaskHours)}h`,
    formatNumber(row.wfmOutstandingHours),
    Number(row.wfmOutstandingHours || 0) > 0 ? 'Outstanding' : 'Balanced',
    row.wfmNotes || row.notes || ''
  ]);
}

function buildRiskRows(rows) {
  return sortByShift(rows).map((row) => [
    row.shift || 'Unassigned',
    row.agentName || '',
    row.notes || row.openTicketNotes || row.wfmNotes || 'Review this row.',
    row.productivityActions || row.ticketsSolved || row.inProgressTickets || '',
    row.inProgressTickets ? 'In progress' : 'Needs review',
    row.openTicketNotes || (row.wfmOutstandingHours ? `WFM outstanding ${formatNumber(row.wfmOutstandingHours)}h` : '')
  ]);
}

function isAttendanceException(row) {
  const status = String(row.attendanceStatus || '').toLowerCase();
  const notes = String(row.notes || '').toLowerCase();
  if (row.attendancePercent === '' || status.includes('missing')) return true;
  if (status.includes('late') || status.includes('absent') || status.includes('awol') || status.includes('partial')) return true;
  return notes.includes('attendance') && !notes.includes('no attendance exception');
}

function getTicketFollowUpStatus(row) {
  if (row.ticketFollowUpStatus) return row.ticketFollowUpStatus;
  if (Number(row.inProgressTickets || 0) > 0) return 'In progress';
  return row.ticketsSolved || row.productivityActions ? 'Activity recorded' : 'No activity';
}

function sortByShift(rows) {
  return (rows || []).slice().sort((left, right) => {
    const leftIndex = shiftRank(left.shift || left.label);
    const rightIndex = shiftRank(right.shift || right.label);
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return String(left.agentName || left.label || '').localeCompare(String(right.agentName || right.label || ''));
  });
}

function shiftRank(value) {
  const normalized = String(value || '').toLowerCase();
  const index = SHIFT_ORDER.findIndex((shift) => normalized === shift.toLowerCase());
  return index === -1 ? 99 : index;
}

function toCsvLine(row) {
  return row.map((value) => {
    const text = value === null || typeof value === 'undefined' ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',');
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '';
  return String(Math.round(number * 100) / 100);
}

function formatPercent(value) {
  if (value === null || value === '' || typeof value === 'undefined') return '';
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 10) / 10}%` : '';
}

function safeFilenamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'report';
}
