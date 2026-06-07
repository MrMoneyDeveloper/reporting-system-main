var DEFAULT_TIMEZONE = 'Africa/Johannesburg';
var DEFAULT_PROJECT_SPREADSHEET_ID = '1WE1MrG0TJ9rEA3nRVEMGF-lpakzLqTUSeSG05b8RN7Y';
var DEFAULT_ATTENDANCE_SPREADSHEET_ID = '1b0C-xRp3OO0f3HeHAt6n6Nr3u2tpFA72o7ertA8VxQI';
var DEFAULT_AI_MODEL = 'gemini-2.5-flash';
var CONFIG_CACHE_ = null;

var DEFAULT_CONFIG_ROWS = Object.freeze([
  ['DAILY_REPORT_ENABLED', 'TRUE', 'Turn daily email on or off'],
  ['WEEKLY_REPORT_ENABLED', 'TRUE', 'Turn weekly email on or off'],
  ['MONTHLY_REPORT_ENABLED', 'TRUE', 'Turn monthly email on or off'],
  ['SITE_SYNC_ENABLED', 'FALSE', 'Reserved for the future Cloudflare dashboard'],
  ['AI_SUMMARY_ENABLED', 'TRUE', 'Turn AI-generated summaries on or off'],
  ['TIMEZONE', 'Africa/Johannesburg', 'Reporting timezone'],
  ['WEEK_CUTOFF_DAY', 'Sunday', 'Weeks close on Sunday and weekly reports run Monday morning'],
  ['DAILY_REPORT_SEND_TIME', '08:10', 'Send after the night shift closes'],
  ['DAY_SHIFT_START', '08:00', 'Day shift start'],
  ['DAY_SHIFT_END', '16:00', 'Day shift end'],
  ['MID_SHIFT_START', '16:00', 'Mid shift start'],
  ['MID_SHIFT_END', '00:00', 'Mid shift end'],
  ['NIGHT_SHIFT_START', '00:00', 'Night shift start'],
  ['NIGHT_SHIFT_END', '08:00', 'Night shift end'],
  ['WFM_SOURCE_MODE', 'MANUAL_MONTHLY', 'WFM source mode. Manual monthly WFM upload is the active workflow'],
  ['WFM_UPLOAD_MONTH_START', '2026-04', 'First calendar month shown in the WFM Upload month dropdown'],
  ['WFM_BALANCE_ATTENDANCE_STATUSES', 'Present,Late', 'Attendance statuses counted toward monthly WFM expected hours'],
  ['ZENDESK_SEARCH_QUERY_EXTRA', '', 'Optional extra Zendesk search terms appended to every ticket pull'],
  ['ZENDESK_TICKET_FORM_IDS', '', 'Comma-separated Zendesk ticket form IDs to pull; one search request is made per form ID'],
  ['ZENDESK_GROUP_IDS', '', 'Comma-separated Zendesk group IDs or names to keep after the pull'],
  ['ZENDESK_REQUIRED_TAGS', '', 'Comma-separated Zendesk tags; if set, tickets must contain at least one'],
  ['ZENDESK_MAX_SEARCH_PAGES', '100', 'Safety limit for Zendesk Search API pages to list ticket IDs; 100 pages allows up to 10000 tickets'],
  ['ZENDESK_SEARCH_PAGES_PER_CLICK', '2', 'How many Zendesk search pages to fetch per Populate Zendesk Only click'],
  ['ZENDESK_MAX_UPDATED_TICKETS', '500', 'Maximum updated tickets to include in one Zendesk-only populate job'],
  ['ZENDESK_MAX_AUDIT_PAGES_PER_TICKET', '8', 'Safety limit for Zendesk audit pages per ticket'],
  ['ZENDESK_USER_RESOLVE_BATCH_SIZE', '2', 'How many Zendesk users to resolve per Populate Zendesk Only click'],
  ['ZENDESK_AUDIT_TICKETS_PER_CLICK', '5', 'How many updated tickets to audit per Populate Zendesk Only click'],
  ['ZENDESK_AGENT_BATCH_SIZE', '3', 'Number of agents to process per continuation job execution'],
  ['HISTORICAL_SYNC_START_DATE', '2026-04-01', 'One-time historical source sync start date'],
  ['RAW_SYNC_BACKFILL_START_DATE', '2025-12-28', 'Fallback first date if the Fiscal Calendar cannot identify the current fiscal-year start'],
  ['RAW_SYNC_BACKFILL_MAX_DAYS', '7', 'Limit first fiscal backfill to recent operational days; set 0 only when full backfill is safe'],
  ['RAW_SYNC_CHUNK_DAYS', '1', 'How many operational days to sync per fiscal backfill window'],
  ['RAW_SYNC_LOOKBACK_DAYS', '2', 'How many days to overlap on incremental source syncs so late updates are picked up'],
  ['RAW_SYNC_SHIFT_LOOKBACK_MINUTES', '30', 'How many minutes before a closed shift to overlap on routine source pulls'],
  ['SOURCE_SYNC_STEPS_PER_EXECUTION', '10', 'Maximum source-sync steps to process in one Apps Script execution before scheduling continuation'],
  ['SOURCE_SYNC_MAX_RUNTIME_SECONDS', '240', 'Soft runtime cap for one source-sync execution before scheduling continuation'],
  ['SOURCE_SYNC_CONTINUATION_DELAY_SECONDS', '60', 'Delay before the next automatic source-sync continuation trigger'],
  ['SOURCE_SYNC_MAX_RETRIES', '3', 'How many times to retry the same source-sync window before stopping'],
  ['ANALYTICS_HISTORY_START_DATE', '2026-04-01', 'First operational day included in permanent analytics history'],
  ['ANALYTICS_DAYS_PER_EXECUTION', '7', 'How many operational days to rebuild per analytics history continuation'],
  ['ANALYTICS_MAX_RUNTIME_SECONDS', '240', 'Soft runtime cap for one analytics rebuild execution'],
  ['ANALYTICS_CONTINUATION_DELAY_SECONDS', '60', 'Delay before the next analytics rebuild continuation trigger'],
  ['ATTENDANCE_SYNC_ENABLED', 'TRUE', 'Read attendance from the external attendance spreadsheet when configured'],
  ['ATTENDANCE_SHEET_NAME', '', 'Optional source tab name in the external attendance spreadsheet'],
  ['EMAIL_RECIPIENTS', 'management@email.com', 'Comma-separated management report recipients']
]);

var REQUIRED_SCRIPT_PROPERTIES = Object.freeze([
  'ZENDESK_SUBDOMAIN',
  'ZENDESK_EMAIL',
  'ZENDESK_API_TOKEN',
  'AI_API_KEY',
  'AI_MODEL',
  'INTERNAL_API_SECRET',
  'SPREADSHEET_ID',
  'REPORT_OUTPUT_FOLDER_ID',
  'ATTENDANCE_SPREADSHEET_ID'
]);

function getConfig() {
  if (CONFIG_CACHE_) {
    return CONFIG_CACHE_;
  }

  var rows = getSheetData(SHEET_NAMES.CONFIG);
  var config = {};

  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i].Setting || '').trim();
    if (!key) {
      continue;
    }
    config[key] = rows[i].Value;
  }

  CONFIG_CACHE_ = config;
  return CONFIG_CACHE_;
}

function invalidateConfigCache_() {
  CONFIG_CACHE_ = null;
}

function resetRuntimeCaches_() {
  invalidateConfigCache_();

  if (typeof ACTIVE_AGENTS_CACHE_ !== 'undefined') {
    ACTIVE_AGENTS_CACHE_ = null;
  }
  if (typeof AGENT_EMAIL_MAP_CACHE_ !== 'undefined') {
    AGENT_EMAIL_MAP_CACHE_ = null;
  }
  if (typeof SPREADSHEET_CACHE_ !== 'undefined') {
    SPREADSHEET_CACHE_ = null;
  }
  if (typeof SPREADSHEET_CACHE_KEY_ !== 'undefined') {
    SPREADSHEET_CACHE_KEY_ = '';
  }
  if (typeof HEADER_VALIDATION_CACHE_ !== 'undefined') {
    HEADER_VALIDATION_CACHE_ = {};
  }
}

function getConfigValue(key, defaultValue) {
  var config = getConfig();
  if (Object.prototype.hasOwnProperty.call(config, key) && config[key] !== '') {
    return config[key];
  }
  return typeof defaultValue === 'undefined' ? '' : defaultValue;
}

function setConfigValue_(key, value, notes) {
  var sheet = ensureSheet(SHEET_NAMES.CONFIG, SHEET_HEADERS[SHEET_NAMES.CONFIG]);
  var lastRow = sheet.getLastRow();
  var normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    throw new Error('Config key is required.');
  }

  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === normalizedKey) {
        sheet.getRange(i + 2, 2).setValue(value);
        if (typeof notes !== 'undefined') {
          sheet.getRange(i + 2, 3).setValue(notes);
        }
        invalidateConfigCache_();
        return {
          key: normalizedKey,
          value: value,
          row: i + 2
        };
      }
    }
  }

  appendRows(SHEET_NAMES.CONFIG, [[normalizedKey, value, notes || '']]);
  invalidateConfigCache_();
  return {
    key: normalizedKey,
    value: value,
    row: sheet.getLastRow()
  };
}

function cleanUpRetiredConfigRows_() {
  var retiredKeys = {
    WFM_AUTH_MODE: true,
    WFM_BASE_URL: true,
    WFM_EMAIL_AUTOMATION_ENABLED: true,
    WFM_EMAIL_LINK_REGEX: true,
    WFM_EMAIL_PROCESSED_LABEL: true,
    WFM_EMAIL_SEARCH_QUERY: true,
    WFM_MAX_PAGES: true,
    WFM_REPORT_TEMPLATE_ID: true,
    WFM_REPORT_URL: true,
    WFM_TIME_FORMAT: true
  };
  var sheet = ensureSheet(SHEET_NAMES.CONFIG, SHEET_HEADERS[SHEET_NAMES.CONFIG]);
  var lastRow = sheet.getLastRow();
  var removedKeys = [];

  if (lastRow < 2) {
    return {
      status: 'SUCCESS',
      removedKeys: removedKeys
    };
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var key = String(values[i][0] || '').trim();
    if (retiredKeys[key]) {
      sheet.deleteRow(i + 2);
      removedKeys.push(key);
    }
  }

  if (removedKeys.length) {
    invalidateConfigCache_();
  }

  removedKeys.sort();
  return {
    status: 'SUCCESS',
    removedKeys: removedKeys
  };
}

function isDailyEnabled() {
  return toBoolean_(getConfigValue('DAILY_REPORT_ENABLED', 'TRUE'));
}

function isWeeklyEnabled() {
  return toBoolean_(getConfigValue('WEEKLY_REPORT_ENABLED', 'TRUE'));
}

function isMonthlyEnabled() {
  return toBoolean_(getConfigValue('MONTHLY_REPORT_ENABLED', 'TRUE'));
}

function getReportRecipients() {
  var value = String(getConfigValue('EMAIL_RECIPIENTS', '') || '');
  if (!value) {
    return [];
  }

  return value.split(',').map(function (email) {
    return email.trim();
  }).filter(function (email) {
    return email;
  });
}

function getOutputFolderId() {
  return getGoogleIdFromProperty_('REPORT_OUTPUT_FOLDER_ID');
}

function getSpreadsheetId_() {
  return getGoogleIdFromProperty_('SPREADSHEET_ID') || DEFAULT_PROJECT_SPREADSHEET_ID;
}

function getAttendanceSpreadsheetId_() {
  return getGoogleIdFromProperty_('ATTENDANCE_SPREADSHEET_ID') || DEFAULT_ATTENDANCE_SPREADSHEET_ID;
}

function getAiModel_() {
  return getScriptProperty_('AI_MODEL') || DEFAULT_AI_MODEL;
}

function validateScriptProperties() {
  var missing = [];
  var present = [];

  for (var i = 0; i < REQUIRED_SCRIPT_PROPERTIES.length; i++) {
    var key = REQUIRED_SCRIPT_PROPERTIES[i];
    if (getScriptProperty_(key)) {
      present.push(key);
    } else {
      missing.push(key);
    }
  }

  return {
    status: missing.length === 0 ? 'OK' : 'MISSING_PROPERTIES',
    present: present,
    missing: missing
  };
}

function configureKnownProjectProperties() {
  return seedKnownScriptProperties_();
}

function seedKnownScriptProperties_() {
  var properties = PropertiesService.getScriptProperties();
  var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var spreadsheetId = activeSpreadsheet ? activeSpreadsheet.getId() : DEFAULT_PROJECT_SPREADSHEET_ID;
  var configured = {};

  setScriptPropertyIfMissing_(properties, configured, 'SPREADSHEET_ID', spreadsheetId);
  setScriptPropertyIfMissing_(properties, configured, 'ATTENDANCE_SPREADSHEET_ID', DEFAULT_ATTENDANCE_SPREADSHEET_ID);
  setScriptPropertyIfMissing_(properties, configured, 'AI_MODEL', DEFAULT_AI_MODEL);
  setScriptPropertyIfMissing_(properties, configured, 'INTERNAL_API_SECRET', Utilities.getUuid());

  if (!getGoogleIdFromProperty_('REPORT_OUTPUT_FOLDER_ID')) {
    var folder = DriveApp.createFolder('BMRX Productivity Reports');
    properties.setProperty('REPORT_OUTPUT_FOLDER_ID', folder.getId());
    configured.REPORT_OUTPUT_FOLDER_ID = folder.getId();
  }

  return {
    status: 'OK',
    configured: configured,
    validation: validateScriptProperties()
  };
}

function setScriptPropertyIfMissing_(properties, configured, key, value) {
  if (!properties.getProperty(key) && value) {
    properties.setProperty(key, value);
    configured[key] = value;
  }
}

function upgradeDefaultConfigValues_() {
  var upgrades = {
    ZENDESK_MAX_SEARCH_PAGES: {
      oldValues: { '': true, '15': true },
      newValue: '100',
      notes: 'Safety limit for Zendesk Search API pages to list ticket IDs; 100 pages allows up to 10000 tickets'
    },
    ZENDESK_SEARCH_PAGES_PER_CLICK: {
      oldValues: { '': true, '1': true, '10': true },
      newValue: '2',
      notes: 'How many Zendesk search pages to fetch per Populate Zendesk Only click'
    },
    ZENDESK_MAX_UPDATED_TICKETS: {
      oldValues: { '': true, '100': true, '1000': true, '10000': true },
      newValue: '500',
      notes: 'Maximum updated tickets to include in one Zendesk-only populate job'
    },
    ZENDESK_AUDIT_TICKETS_PER_CLICK: {
      oldValues: { '': true, '3': true, '25': true, '50': true },
      newValue: '5',
      notes: 'How many updated tickets to audit per Populate Zendesk Only click'
    },
    ZENDESK_USER_RESOLVE_BATCH_SIZE: {
      oldValues: { '': true, '5': true },
      newValue: '2',
      notes: 'How many Zendesk users to resolve per Populate Zendesk Only click'
    },
    RAW_SYNC_CHUNK_DAYS: {
      oldValues: { '': true, '7': true },
      newValue: '1',
      notes: 'How many operational days to sync per fiscal backfill window'
    },
    RAW_SYNC_BACKFILL_MAX_DAYS: {
      oldValues: { '': true },
      newValue: '7',
      notes: 'Limit first fiscal backfill to recent operational days; set 0 only when full backfill is safe'
    },
    WFM_SOURCE_MODE: {
      oldValues: { '': true, API: true, EMAIL_EXPORT: true },
      newValue: 'MANUAL_MONTHLY',
      notes: 'WFM source mode. Manual monthly WFM upload is the active workflow'
    }
  };
  var sheet = ensureSheet(SHEET_NAMES.CONFIG, SHEET_HEADERS[SHEET_NAMES.CONFIG]);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var changed = [];

  for (var i = 0; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    var upgrade = upgrades[key];
    if (!upgrade) {
      continue;
    }

    var currentValue = String(values[i][1] || '').trim();
    if (!upgrade.oldValues[currentValue]) {
      continue;
    }

    sheet.getRange(i + 2, 2).setValue(upgrade.newValue);
    sheet.getRange(i + 2, 3).setValue(upgrade.notes);
    changed.push(key);
  }

  if (changed.length) {
    invalidateConfigCache_();
  }
  return changed;
}

function getReportTimezone_() {
  return String(getConfigValue('TIMEZONE', DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE);
}

function getScriptProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getGoogleIdFromProperty_(key) {
  return extractGoogleId_(getScriptProperty_(key));
}

function requireScriptProperty_(key) {
  var value = getScriptProperty_(key);
  if (!value) {
    throw new Error('Missing required Script Property: ' + key);
  }
  return value;
}

function toBoolean_(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  var normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'enabled';
}

function extractGoogleId_(value) {
  var text = String(value || '').trim();
  if (!text) {
    return '';
  }

  var spreadsheetMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (spreadsheetMatch) {
    return spreadsheetMatch[1];
  }

  var folderMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return folderMatch[1];
  }

  return text;
}
