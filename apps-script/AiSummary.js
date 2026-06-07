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

  var apiKey = getScriptProperty_('AI_API_KEY');
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
  var apiKey = getScriptProperty_('AI_API_KEY');
  if (!apiKey) {
    throw new Error('AI_API_KEY Script Property is not configured.');
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
      'x-goog-api-key': apiKey
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
