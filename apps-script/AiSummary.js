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

  var apiKeyInfo = getAiApiKey_();
  if (!apiKeyInfo.value) {
    logError('generateAiSummary', new Error(getAiProvider_() + ' API key Script Property is not configured; using fallback summary.'), 'SKIPPED', 0);
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
    return callAiGenerateContent_(prompt, {
      model: model,
      temperature: 0.2,
      maxOutputTokens: 700
    });
  } catch (error) {
    logError('generateAiSummary_ai', error, 'CONTINUED', 0);
    return buildFallbackAiSummary_(payload) + '\nAI model configured but provider call failed: ' + error.message;
  }
}

function callGeminiGenerateContent_(prompt, options) {
  return callAiGenerateContent_(prompt, options);
}

function callAiGenerateContent_(prompt, options) {
  var provider = getAiProvider_();
  if (provider === 'GEMINI') {
    return callGeminiGenerateContentProvider_(prompt, options);
  }
  return callGroqChatCompletion_(prompt, options);
}

function callGroqChatCompletion_(prompt, options) {
  var apiKeyInfo = getAiApiKey_();
  if (!apiKeyInfo.value) {
    throw new Error('GROQ_API_KEY or AI_API_KEY is not configured.');
  }

  var opts = options || {};
  var model = normalizeGroqModelName_(opts.model || getAiModel_());
  var url = 'https://api.groq.com/openai/v1/chat/completions';
  var payload = {
    model: model,
    messages: [
      {
        role: 'system',
        content: 'You write concise operational insights from compact aggregate data. Do not invent facts.'
      },
      {
        role: 'user',
        content: String(prompt || '')
      }
    ],
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2,
    max_completion_tokens: opts.maxOutputTokens || opts.maxTokens || 800
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiKeyInfo.value
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var statusCode = response.getResponseCode();
  var body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('Groq API returned HTTP ' + statusCode + ': ' + compactLogMessage_(body));
  }

  var parsed = JSON.parse(body);
  var choices = parsed.choices || [];
  if (!choices.length || !choices[0].message || !choices[0].message.content) {
    throw new Error('Groq API returned no text choices.');
  }

  return String(choices[0].message.content || '').trim();
}

function callGeminiGenerateContentProvider_(prompt, options) {
  var apiKeyInfo = getAiApiKey_();
  if (!apiKeyInfo.value) {
    throw new Error('GEMINI_API_KEY or AI_API_KEY is not configured.');
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
  var provider = getAiProvider_();
  var sources = [
    { name: 'Script Property GROQ_API_KEY', provider: 'GROQ', value: getScriptProperty_('GROQ_API_KEY') },
    { name: 'Config GROQ_API_KEY', provider: 'GROQ', value: getConfigValue('GROQ_API_KEY', '') },
    { name: 'Script Property AI_API_KEY', value: getScriptProperty_('AI_API_KEY') },
    { name: 'Script Property GEMINI_API_KEY', value: getScriptProperty_('GEMINI_API_KEY') },
    { name: 'Config AI_API_KEY', value: getConfigValue('AI_API_KEY', '') },
    { name: 'Config GEMINI_API_KEY', value: getConfigValue('GEMINI_API_KEY', '') }
  ];

  for (var i = 0; i < sources.length; i++) {
    if (sources[i].provider && sources[i].provider !== provider) {
      continue;
    }
    var normalized = normalizeSecretValue_(sources[i].value);
    if (provider === 'GROQ' && !sources[i].provider && normalized && !isGroqApiKeyCandidate_(normalized)) {
      continue;
    }
    if (normalized) {
      return {
        source: sources[i].name,
        provider: provider,
        value: normalized,
        masked: maskApiKey_(normalized),
        length: normalized.length,
        hasWhitespaceTrimmed: String(sources[i].value || '').length !== normalized.length
      };
    }
  }

  return {
    source: '',
    provider: provider,
    value: '',
    masked: '',
    length: 0,
    hasWhitespaceTrimmed: false
  };
}

function isGroqApiKeyCandidate_(value) {
  return /^gsk_/i.test(String(value || '').trim());
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
  return getAiDiagnostic_();
}

function getAiDiagnostic_() {
  var provider = getAiProvider_();
  var apiKeyInfo = getAiApiKey_();
  var model = provider === 'GEMINI' ? normalizeGeminiModelName_(getAiModel_()) : normalizeGroqModelName_(getAiModel_());
  var endpoint = provider === 'GEMINI'
    ? 'https://generativelanguage.googleapis.com/v1beta/' + model + ':generateContent'
    : 'https://api.groq.com/openai/v1/chat/completions';
  return {
    status: apiKeyInfo.value ? 'CONFIGURED' : 'MISSING_KEY',
    provider: provider,
    keySource: apiKeyInfo.source,
    keyMasked: apiKeyInfo.masked,
    keyLength: apiKeyInfo.length,
    keyWhitespaceOrQuotesTrimmed: apiKeyInfo.hasWhitespaceTrimmed,
    model: model,
    endpoint: endpoint
  };
}

function testGeminiConfig_() {
  return testAiConfig_();
}

function testAiConfig_() {
  var diagnostic = getAiDiagnostic_();
  var result = {
    status: diagnostic.status,
    diagnostic: diagnostic,
    generatedAt: formatDateTime_(new Date())
  };

  if (diagnostic.status !== 'CONFIGURED') {
    logPipelineEvent_({
      reportType: 'AI Diagnostic',
      phase: 'ai-config',
      status: 'MISSING_KEY',
      message: diagnostic.provider + ' key is missing. Configure GROQ_API_KEY or AI_API_KEY in Script Properties.',
      rowsProcessed: 0
    });
    return result;
  }

  try {
    result.testText = callAiGenerateContent_('Reply with exactly: OK', {
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
    reportType: 'AI Diagnostic',
    phase: 'ai-config',
    status: result.status,
    message: 'AI diagnostic: provider=' + diagnostic.provider + ', source=' + diagnostic.keySource + ', key=' + diagnostic.keyMasked + ', length=' + diagnostic.keyLength + ', model=' + diagnostic.model + (result.message ? ', message=' + result.message : ''),
    rowsProcessed: 1
  });

  return result;
}

function switchAiProviderToGroq_() {
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty('AI_PROVIDER', 'GROQ');

  var currentModel = normalizeSecretValue_(properties.getProperty('AI_MODEL'));
  if (!currentModel || /^models\/?gemini/i.test(currentModel) || /^gemini/i.test(currentModel)) {
    properties.setProperty('AI_MODEL', DEFAULT_AI_MODEL);
  }

  setConfigValue_('AI_PROVIDER', 'GROQ', 'AI provider for dashboard/report insight. Supported: GROQ, GEMINI');
  setConfigValue_('AI_MODEL', DEFAULT_AI_MODEL, 'AI model used for dashboard/report insight');
  invalidateConfigCache_();

  var diagnostic = getAiDiagnostic_();
  logPipelineEvent_({
    reportType: 'AI Diagnostic',
    phase: 'ai-provider',
    status: 'GROQ',
    message: 'AI provider switched to GROQ. model=' + diagnostic.model + ', keySource=' + (diagnostic.keySource || 'missing') + ', key=' + (diagnostic.keyMasked || 'missing') + '.',
    rowsProcessed: 1
  });

  return {
    status: 'SUCCESS',
    provider: 'GROQ',
    model: getAiModel_(),
    diagnostic: diagnostic
  };
}

function normalizeGeminiModelName_(model) {
  var value = String(model || 'gemini-2.5-flash').trim();
  if (value.indexOf('models/') === 0) {
    return value;
  }
  return 'models/' + value;
}

function normalizeGroqModelName_(model) {
  var value = String(model || DEFAULT_AI_MODEL).trim();
  if (value.indexOf('models/') === 0) {
    value = value.replace(/^models\//, '');
  }
  if (!value || /^gemini/i.test(value)) {
    return DEFAULT_AI_MODEL;
  }
  return value;
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
