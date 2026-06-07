function buildAiPayload(finalDataset) {
  var rows = finalDataset || getFinalDatasetRows_();
  var shiftSummary = {};
  var exceptions = [];
  var topCandidates = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var shift = row[7] || 'Unknown';
    if (!shiftSummary[shift]) {
      shiftSummary[shift] = { shift: shift, attendanceRate: 0, attendanceCount: 0, productivityRate: 0, productivityCount: 0, ticketsSolved: 0 };
    }

    if (row[8] !== '') {
      shiftSummary[shift].attendanceRate += Number(row[8]);
      shiftSummary[shift].attendanceCount += 1;
    }
    if (row[12] !== '') {
      shiftSummary[shift].productivityRate += Number(row[12]);
      shiftSummary[shift].productivityCount += 1;
    }
    shiftSummary[shift].ticketsSolved += Number(row[9] || 0);

    if (row[13]) {
      exceptions.push({
        agent: row[6],
        email: row[5],
        issue: row[13],
        productivity: row[12]
      });
    }

    topCandidates.push({
      agent: row[6],
      tickets: Number(row[9] || 0),
      productivity: Number(row[12] || 0)
    });
  }

  var shiftRows = [];
  for (var shiftName in shiftSummary) {
    if (!Object.prototype.hasOwnProperty.call(shiftSummary, shiftName)) {
      continue;
    }
    var group = shiftSummary[shiftName];
    shiftRows.push({
      shift: group.shift,
      attendance_rate: group.attendanceCount ? round2_(group.attendanceRate / group.attendanceCount) : '',
      productivity_rate: group.productivityCount ? round2_(group.productivityRate / group.productivityCount) : '',
      tickets_solved: group.ticketsSolved
    });
  }

  topCandidates.sort(function (left, right) {
    return (right.tickets + right.productivity) - (left.tickets + left.productivity);
  });

  return {
    report_type: rows.length ? rows[0][0] : '',
    period_start: rows.length ? rows[0][1] : '',
    period_end: rows.length ? rows[0][2] : '',
    fiscal_week: rows.length ? rows[0][3] : '',
    fiscal_month: rows.length ? rows[0][4] : '',
    shift_summary: shiftRows,
    agent_exceptions: exceptions.slice(0, 20),
    top_performers: topCandidates.slice(0, 5)
  };
}

function generateAiSummary(payload) {
  if (!toBoolean_(getConfigValue('AI_SUMMARY_ENABLED', 'TRUE'))) {
    return 'AI summary disabled in Config.';
  }

  var apiKey = getAiApiKey_().value;
  if (!apiKey) {
    logError('generateAiSummary', new Error('AI_API_KEY Script Property is not configured; using fallback summary.'), 'SKIPPED', 0);
    return buildFallbackAiSummary_(payload);
  }

  var model = getAiModel_();
  var prompt = [
    'You are summarizing a support productivity report for managers.',
    'Use concise business language. Mention risks, notable wins, missing data, and next actions.',
    'Only use the JSON data below; do not invent facts.',
    JSON.stringify(payload || {})
  ].join('\n\n');

  try {
    return callGeminiGenerateContent_(prompt, {
      model: model,
      temperature: 0.2,
      maxOutputTokens: 700
    });
  } catch (error) {
    logError('generateAiSummary_gemini', error, 'CONTINUED', 0);
    return buildFallbackAiSummary_(payload) + '\nAI model configured but Gemini call failed: ' + error.message;
  }
}

function callGeminiGenerateContent_(prompt, options) {
  var apiKeyInfo = getAiApiKey_();
  if (!apiKeyInfo.value) {
    throw new Error('AI_API_KEY or GEMINI_API_KEY is not configured.');
  }

  var opts = options || {};
  var model = normalizeGeminiModelName_(opts.model || getAiModel_());
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + model + ':generateContent';
  var payload = {
    contents: [{
      role: 'user',
      parts: [{ text: String(prompt || '') }]
    }],
    generationConfig: {
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2,
      maxOutputTokens: opts.maxOutputTokens || 800
    }
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': apiKeyInfo.value
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var statusCode = response.getResponseCode();
  var body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('Gemini API returned HTTP ' + statusCode + ': ' + compactLogMessage_(body));
  }

  var parsed = JSON.parse(body);
  var candidates = parsed.candidates || [];
  if (!candidates.length || !candidates[0].content || !candidates[0].content.parts) {
    throw new Error('Gemini API returned no text candidates.');
  }

  var parts = candidates[0].content.parts;
  var text = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].text) {
      text.push(parts[i].text);
    }
  }

  if (!text.length) {
    throw new Error('Gemini API response did not include text.');
  }

  return text.join('\n').trim();
}

function getAiApiKey_() {
  var sources = [
    { name: 'Script Property AI_API_KEY', value: getScriptProperty_('AI_API_KEY') },
    { name: 'Script Property GEMINI_API_KEY', value: getScriptProperty_('GEMINI_API_KEY') },
    { name: 'Config AI_API_KEY', value: getConfigValue('AI_API_KEY', '') },
    { name: 'Config GEMINI_API_KEY', value: getConfigValue('GEMINI_API_KEY', '') }
  ];

  for (var i = 0; i < sources.length; i++) {
    var normalized = normalizeSecretValue_(sources[i].value);
    if (normalized) {
      return {
        source: sources[i].name,
        value: normalized,
        masked: maskApiKey_(normalized),
        length: normalized.length,
        hasWhitespaceTrimmed: String(sources[i].value || '').length !== normalized.length
      };
    }
  }

  return {
    source: '',
    value: '',
    masked: '',
    length: 0,
    hasWhitespaceTrimmed: false
  };
}

function normalizeSecretValue_(value) {
  var text = String(value || '').trim();
  if ((text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') ||
      (text.charAt(0) === "'" && text.charAt(text.length - 1) === "'")) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function maskApiKey_(value) {
  var text = String(value || '');
  if (!text) {
    return '';
  }
  if (text.length <= 10) {
    return text.charAt(0) + '***' + text.charAt(text.length - 1);
  }
  return text.slice(0, 6) + '...' + text.slice(-4);
}

function getGeminiDiagnostic_() {
  var apiKeyInfo = getAiApiKey_();
  var model = normalizeGeminiModelName_(getAiModel_());
  return {
    status: apiKeyInfo.value ? 'CONFIGURED' : 'MISSING_KEY',
    keySource: apiKeyInfo.source,
    keyMasked: apiKeyInfo.masked,
    keyLength: apiKeyInfo.length,
    keyWhitespaceOrQuotesTrimmed: apiKeyInfo.hasWhitespaceTrimmed,
    model: model,
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/' + model + ':generateContent'
  };
}

function testGeminiConfig_() {
  var diagnostic = getGeminiDiagnostic_();
  var result = {
    status: diagnostic.status,
    diagnostic: diagnostic,
    generatedAt: formatDateTime_(new Date())
  };

  if (diagnostic.status !== 'CONFIGURED') {
    logPipelineEvent_({
      reportType: 'Gemini Diagnostic',
      phase: 'gemini-config',
      status: 'MISSING_KEY',
      message: 'Gemini key is missing. Configure AI_API_KEY or GEMINI_API_KEY in Script Properties.',
      rowsProcessed: 0
    });
    return result;
  }

  try {
    result.testText = callGeminiGenerateContent_('Reply with exactly: OK', {
      model: getAiModel_(),
      temperature: 0,
      maxOutputTokens: 20
    });
    result.status = 'SUCCESS';
  } catch (error) {
    result.status = 'FAILED';
    result.message = compactLogMessage_(error.message || String(error));
  }

  logPipelineEvent_({
    reportType: 'Gemini Diagnostic',
    phase: 'gemini-config',
    status: result.status,
    message: 'Gemini diagnostic: source=' + diagnostic.keySource + ', key=' + diagnostic.keyMasked + ', length=' + diagnostic.keyLength + ', model=' + diagnostic.model + (result.message ? ', message=' + result.message : ''),
    rowsProcessed: 1
  });

  return result;
}

function normalizeGeminiModelName_(model) {
  var value = String(model || 'gemini-2.5-flash').trim();
  if (value.indexOf('models/') === 0) {
    return value;
  }
  return 'models/' + value;
}

function buildFallbackAiSummary_(payload) {
  var shiftCount = payload && payload.shift_summary ? payload.shift_summary.length : 0;
  var exceptionCount = payload && payload.agent_exceptions ? payload.agent_exceptions.length : 0;
  var period = payload ? (payload.period_start + ' to ' + payload.period_end) : '';

  return [
    'Automated summary for ' + period + '.',
    'Shift groups summarized: ' + shiftCount + '.',
    'Exceptions flagged: ' + exceptionCount + '.',
    'AI provider integration is pending, so this fallback summary was used.'
  ].join('\n');
}
