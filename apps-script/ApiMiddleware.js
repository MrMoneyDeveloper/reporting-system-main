var DASHBOARD_LAST_API_REQUEST_KEY_ = 'DASHBOARD_LAST_API_REQUEST_AT';
var DASHBOARD_LAST_API_ENDPOINT_KEY_ = 'DASHBOARD_LAST_API_ENDPOINT';
var DASHBOARD_DEFAULT_SLOW_REQUEST_MS_ = 5000;
var DASHBOARD_DEFAULT_CACHE_MAX_BYTES_ = 90000;

function dashboardApiEndpoint_(endpointName, request, handler, options) {
  var startedAt = new Date();
  var requestId = generateRunId();
  var opts = options || {};
  var safeRequest = sanitizeApiPayload_(request || {});

  try {
    var result = handler();
    var response = attachApiMetadata_(result, requestId, endpointName, startedAt, opts);
    markDashboardApiRequest_(endpointName);
    maybeLogApiEvent_(endpointName, requestId, startedAt, safeRequest, response, opts);
    return response;
  } catch (error) {
    var failure = buildApiErrorPayload_(error, requestId, endpointName, startedAt);
    markDashboardApiRequest_(endpointName);
    logApiEvent_(endpointName, requestId, startedAt, safeRequest, failure, {
      status: 'FAILED',
      logAlways: true
    });
    logError(endpointName, error, 'FAILED', 0);
    return failure;
  }
}

function attachApiMetadata_(payload, requestId, endpointName, startedAt, options) {
  var output = payload && typeof payload === 'object' ? payload : { result: payload };
  var durationMs = new Date().getTime() - startedAt.getTime();
  output.api = {
    requestId: requestId,
    endpoint: endpointName,
    durationMs: durationMs,
    generatedAt: formatDateTime_(new Date())
  };

  if (options && options.cacheable) {
    output.api.cacheable = true;
  }

  return output;
}

function buildApiErrorPayload_(error, requestId, endpointName, startedAt) {
  return {
    status: 'ERROR',
    message: compactLogMessage_(error && error.message ? error.message : String(error)),
    api: {
      requestId: requestId,
      endpoint: endpointName,
      durationMs: new Date().getTime() - startedAt.getTime(),
      generatedAt: formatDateTime_(new Date())
    }
  };
}

function withApiResponseMetadata_(payload, requestId, endpointName, startedAt, requestSummary, options) {
  var response = attachApiMetadata_(payload || {}, requestId, endpointName, startedAt, options || {});
  markDashboardApiRequest_(endpointName);
  maybeLogApiEvent_(endpointName, requestId, startedAt, sanitizeApiPayload_(requestSummary || {}), response, options || {});
  return response;
}

function logApiEvent_(endpointName, requestId, startedAt, requestSummary, response, options) {
  var durationMs = new Date().getTime() - startedAt.getTime();
  var status = (options && options.status) || (response && response.status) || 'SUCCESS';
  var cache = response && response.cache ? response.cache : {};
  var messageParts = [
    'endpoint=' + endpointName,
    'requestId=' + requestId,
    'durationMs=' + durationMs,
    'cache=' + (cache.hit === true ? 'HIT' : cache.hit === false ? 'MISS' : (cache.status || 'N/A')),
    'request=' + JSON.stringify(requestSummary || {})
  ];

  if (response && response.message && status !== 'SUCCESS' && status !== 'OK') {
    messageParts.push('message=' + response.message);
  }

  logPipelineEvent_({
    runId: requestId,
    reportType: 'Dashboard API',
    phase: endpointName,
    status: status,
    message: messageParts.join('; '),
    rowsProcessed: response && response.rows ? response.rows.length : ''
  });
}

function maybeLogApiEvent_(endpointName, requestId, startedAt, requestSummary, response, options) {
  var opts = options || {};
  var durationMs = new Date().getTime() - startedAt.getTime();
  var status = String((response && response.status) || 'SUCCESS').toUpperCase();
  var cache = response && response.cache ? response.cache : {};

  if (opts.logAlways || status === 'ERROR' || status === 'FAILED') {
    logApiEvent_(endpointName, requestId, startedAt, requestSummary, response, opts);
    return;
  }

  if (String(getConfigValue('DASHBOARD_API_LOG_MODE', 'SUMMARY')).toUpperCase() === 'VERBOSE') {
    logApiEvent_(endpointName, requestId, startedAt, requestSummary, response, opts);
    return;
  }

  if (durationMs >= getDashboardSlowRequestMs_()) {
    logApiEvent_(endpointName, requestId, startedAt, requestSummary, response, opts);
    return;
  }

  if (cache.hit === false || cache.status === 'SKIPPED_TOO_LARGE' || cache.status === 'WRITE_FAILED') {
    logApiEvent_(endpointName, requestId, startedAt, requestSummary, response, opts);
  }
}

function sanitizeApiPayload_(value) {
  return sanitizeApiPayloadDepth_(value, 0);
}

function sanitizeApiPayloadDepth_(value, depth) {
  if (depth > 3) {
    return '[max-depth]';
  }

  if (value === null || typeof value === 'undefined') {
    return '';
  }

  if (value instanceof Date) {
    return formatDateTime_(value);
  }

  if (typeof value !== 'object') {
    var primitive = String(value);
    return primitive.length > 120 ? primitive.slice(0, 117) + '...' : primitive;
  }

  if (Object.prototype.toString.call(value) === '[object Array]') {
    var arrayOutput = [];
    for (var i = 0; i < Math.min(value.length, 10); i++) {
      arrayOutput.push(sanitizeApiPayloadDepth_(value[i], depth + 1));
    }
    if (value.length > 10) {
      arrayOutput.push('+' + (value.length - 10) + ' more');
    }
    return arrayOutput;
  }

  var output = {};
  var keys = Object.keys(value).sort();
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    if (/secret|token|key|password|authorization/i.test(key)) {
      output[key] = '[redacted]';
    } else {
      output[key] = sanitizeApiPayloadDepth_(value[key], depth + 1);
    }
  }
  return output;
}

function markDashboardApiRequest_(endpointName) {
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty(DASHBOARD_LAST_API_REQUEST_KEY_, formatDateTime_(new Date()));
  properties.setProperty(DASHBOARD_LAST_API_ENDPOINT_KEY_, endpointName || '');
}

function getDashboardSlowRequestMs_() {
  var value = Number(getConfigValue('DASHBOARD_SLOW_REQUEST_MS', DASHBOARD_DEFAULT_SLOW_REQUEST_MS_));
  return value > 0 ? value : DASHBOARD_DEFAULT_SLOW_REQUEST_MS_;
}

function getDashboardCacheMaxBytes_() {
  var value = Number(getConfigValue('DASHBOARD_CACHE_MAX_BYTES', DASHBOARD_DEFAULT_CACHE_MAX_BYTES_));
  return value > 0 ? value : DASHBOARD_DEFAULT_CACHE_MAX_BYTES_;
}

function getDashboardCacheTtlSeconds_(prefix, defaultTtl) {
  var key = prefix === 'insight' ? 'DASHBOARD_INSIGHT_CACHE_TTL_SECONDS' : 'DASHBOARD_CACHE_TTL_SECONDS';
  var value = Number(getConfigValue(key, defaultTtl || DASHBOARD_CACHE_TTL_SECONDS_));
  return value > 0 ? value : (defaultTtl || DASHBOARD_CACHE_TTL_SECONDS_);
}

function getApiResponseSizeBytes_(payload) {
  try {
    return Utilities.newBlob(JSON.stringify(payload || {})).getBytes().length;
  } catch (error) {
    return 0;
  }
}

