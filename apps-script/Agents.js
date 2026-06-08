var DEFAULT_AGENT_EMAILS = Object.freeze([
  'sibane.ngubane.digifycx@gmail.com',
  'asonwabe.ntshiyantshiya.digifycx@gmail.com',
  'amahle.ngwenya.digifycx@gmail.com',
  'busiswa.majozi.digifycx@gmail.com',
  'tristan.govender.digifycx@gmail.com',
  'rorisang.mokati.digifycx@gmail.com',
  'xolelwa.mazibuko.digifycx@gmail.com',
  'sabelo.tshazi.digifycx@gmail.com',
  'sfundo.xulu.digifycx@gmail.com',
  'hamida.moosa.digifycx@gmail.com',
  'lerato.khauta.digifycx@gmail.com',
  'lindeka.bele.digifycx@gmail.com',
  'samkelisiwe.gqada.digifycx@gmail.com',
  'sindiswa.xulu.digifycx@gmail.com',
  'tokoza.bangani.digifycx@gmail.com',
  'alrique.usher.digifycx@gmail.com',
  'nomfundo.mtiyane.digifycx@gmail.com',
  'sbahle.ngidi.digifycx@gmail.com',
  'sanelisiwe.mbele.digifycx@gmail.com',
  'siphiwe.sibisi.digifycx@gmail.com',
  'nothando.shangase.digifycx@gmail.com',
  'atiyyah.sathar.digifycx@gmail.com',
  'nomonde.bhengu.digifycx@gmail.com',
  'nosipho.nkwanyana.digifycx@gmail.com',
  'gugu.xulu.digifycx@gmail.com'
]);
var DEFAULT_AGENT_ROSTER = Object.freeze([
  { name: 'Sibane Ngubane', email: 'sibane.ngubane.digifycx@gmail.com', shift: 'Day', team: 'IT' },
  { name: 'Asonwabe Ntshiyantshiya', email: 'asonwabe.ntshiyantshiya.digifycx@gmail.com', shift: 'Day', team: 'IT' },
  { name: 'Amahle Ngwenya', email: 'amahle.ngwenya.digifycx@gmail.com', shift: 'Day', team: 'IT' },
  { name: 'Busiswa Majozi', email: 'busiswa.majozi.digifycx@gmail.com', shift: 'Night', team: 'IT' },
  { name: 'Tristan Govender', email: 'tristan.govender.digifycx@gmail.com', shift: 'Mid', team: 'IT' },
  { name: 'Rorisang Mokati', email: 'rorisang.mokati.digifycx@gmail.com', shift: 'Mid', team: 'IT' },
  { name: 'Xolelwa Mandisa Mazibuko', email: 'xolelwa.mazibuko.digifycx@gmail.com', shift: 'Day', team: 'Marketing' },
  { name: 'Sabelo Tshazi', email: 'sabelo.tshazi.digifycx@gmail.com', shift: 'Day', team: 'Marketing' },
  { name: 'Sfundo Xulu', email: 'sfundo.xulu.digifycx@gmail.com', shift: 'Day', team: 'Marketing' },
  { name: 'Hamida Moosa', email: 'hamida.moosa.digifycx@gmail.com', shift: 'Night', team: 'Marketing' },
  { name: 'Motlalepule Lerato Ivy Khauta', email: 'lerato.khauta.digifycx@gmail.com', shift: 'Day', team: 'Marketing' },
  { name: 'Lindeka Bele', email: 'lindeka.bele.digifycx@gmail.com', shift: 'Night', team: 'Marketing' },
  { name: 'Samkelisiwe Gqada', email: 'samkelisiwe.gqada.digifycx@gmail.com', shift: 'Night', team: 'Marketing' },
  { name: 'Thoko Sindiswa Xulu', email: 'sindiswa.xulu.digifycx@gmail.com', shift: 'Night', team: 'Marketing' },
  { name: 'Tokoza Bangani', email: 'tokoza.bangani.digifycx@gmail.com', shift: 'Night', team: 'Marketing' },
  { name: 'Alrique Usher', email: 'alrique.usher.digifycx@gmail.com', shift: 'Day', team: 'Zendesk' },
  { name: 'Nomfundo Mtiyane', email: 'nomfundo.mtiyane.digifycx@gmail.com', shift: 'Day', team: 'Zendesk' },
  { name: 'Sbahle Ngidi', email: 'sbahle.ngidi.digifycx@gmail.com', shift: 'Mid', team: 'Zendesk' },
  { name: 'Nothando Shangase', email: 'nothando.shangase.digifycx@gmail.com', shift: 'Mid', team: 'Zendesk' }
]);
var ACTIVE_AGENTS_CACHE_ = null;
var AGENT_EMAIL_MAP_CACHE_ = null;

function getActiveAgents() {
  if (ACTIVE_AGENTS_CACHE_) {
    return ACTIVE_AGENTS_CACHE_;
  }

  var rows = getSheetData(SHEET_NAMES.AGENTS);
  var agents = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!toBoolean_(row.Active)) {
      continue;
    }

    var email = normalizeEmail_(row.Email);
    if (!email) {
      logError('getActiveAgents', new Error('Active agent is missing an email: ' + (row['Agent Name'] || 'Unknown')), 'OPEN', 0);
      continue;
    }

    agents.push({
      active: true,
      name: String(row['Agent Name'] || '').trim(),
      email: email,
      team: String(row.Team || '').trim(),
      shift: normalizeShift_(row.Shift),
      site: String(row.Site || '').trim(),
      role: String(row.Role || '').trim(),
      startDate: row['Start Date'] || '',
      endDate: row['End Date'] || ''
    });
  }

  ACTIVE_AGENTS_CACHE_ = agents;
  return ACTIVE_AGENTS_CACHE_;
}

function seedDefaultAgents_() {
  var existingRows = getSheetData(SHEET_NAMES.AGENTS);
  var existingEmails = {};
  var rosterMap = getDefaultAgentRosterMap_();

  for (var i = 0; i < existingRows.length; i++) {
    var email = normalizeEmail_(existingRows[i].Email);
    if (email) {
      existingEmails[email] = true;
    }
  }

  var rowsToAppend = [];
  for (var j = 0; j < DEFAULT_AGENT_ROSTER.length; j++) {
    var rosterAgent = DEFAULT_AGENT_ROSTER[j];
    var agentEmail = normalizeEmail_(rosterAgent.email);
    if (existingEmails[agentEmail]) {
      continue;
    }

    rowsToAppend.push([
      'TRUE',
      rosterAgent.name,
      agentEmail,
      rosterAgent.team,
      rosterAgent.shift,
      '',
      'Agent',
      '',
      ''
    ]);
  }

  for (var k = 0; k < DEFAULT_AGENT_EMAILS.length; k++) {
    var fallbackEmail = normalizeEmail_(DEFAULT_AGENT_EMAILS[k]);
    if (existingEmails[fallbackEmail] || rosterMap[fallbackEmail]) {
      continue;
    }

    rowsToAppend.push([
      'FALSE',
      nameFromEmail_(fallbackEmail),
      fallbackEmail,
      '',
      '',
      '',
      'Agent',
      '',
      ''
    ]);
  }

  var rowsWritten = appendRows(SHEET_NAMES.AGENTS, rowsToAppend);
  var rowsSynced = syncDefaultAgentRoster_();
  if (rowsWritten || rowsSynced) {
    ACTIVE_AGENTS_CACHE_ = null;
    AGENT_EMAIL_MAP_CACHE_ = null;
  }
  return rowsWritten + rowsSynced;
}

function syncDefaultAgentRoster_() {
  var sheet = ensureSheet(SHEET_NAMES.AGENTS, SHEET_HEADERS[SHEET_NAMES.AGENTS]);
  var lastRow = sheet.getLastRow();
  var lastColumn = Math.max(sheet.getLastColumn(), SHEET_HEADERS[SHEET_NAMES.AGENTS].length);
  if (lastRow < 2) {
    return 0;
  }

  var range = sheet.getRange(1, 1, lastRow, lastColumn);
  var values = range.getValues();
  var headers = values[0].map(function (header) {
    return String(header || '').trim();
  });
  var indexes = {};
  for (var i = 0; i < headers.length; i++) {
    indexes[headers[i]] = i;
  }

  var rosterMap = getDefaultAgentRosterMap_();
  var defaultEmailMap = {};
  for (var j = 0; j < DEFAULT_AGENT_EMAILS.length; j++) {
    defaultEmailMap[normalizeEmail_(DEFAULT_AGENT_EMAILS[j])] = true;
  }

  var updates = 0;
  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    var row = values[rowIndex];
    var email = normalizeEmail_(row[indexes.Email]);
    if (!email) {
      continue;
    }

    if (rosterMap[email]) {
      updates += setAgentRosterCell_(row, indexes.Active, 'TRUE');
      updates += setAgentRosterCell_(row, indexes['Agent Name'], rosterMap[email].name);
      updates += setAgentRosterCell_(row, indexes.Team, rosterMap[email].team);
      updates += setAgentRosterCell_(row, indexes.Shift, rosterMap[email].shift);
      updates += setAgentRosterCell_(row, indexes.Role, row[indexes.Role] || 'Agent');
    } else if (defaultEmailMap[email]) {
      updates += setAgentRosterCell_(row, indexes.Active, 'FALSE');
    }
  }

  if (updates) {
    range.setValues(values);
    ACTIVE_AGENTS_CACHE_ = null;
    AGENT_EMAIL_MAP_CACHE_ = null;
  }

  return updates;
}

function getDefaultAgentRosterMap_() {
  var map = {};
  for (var i = 0; i < DEFAULT_AGENT_ROSTER.length; i++) {
    map[normalizeEmail_(DEFAULT_AGENT_ROSTER[i].email)] = DEFAULT_AGENT_ROSTER[i];
  }
  return map;
}

function setAgentRosterCell_(row, index, value) {
  if (index === null || typeof index === 'undefined' || index < 0) {
    return 0;
  }
  if (String(row[index] || '') === String(value || '')) {
    return 0;
  }
  row[index] = value;
  return 1;
}

function getAgentByEmail(email) {
  var map = getAgentEmailMap();
  return map[normalizeEmail_(email)] || null;
}

function getAgentEmailMap() {
  if (AGENT_EMAIL_MAP_CACHE_) {
    return AGENT_EMAIL_MAP_CACHE_;
  }

  var agents = getActiveAgents();
  var map = {};

  for (var i = 0; i < agents.length; i++) {
    map[agents[i].email] = agents[i];
  }

  AGENT_EMAIL_MAP_CACHE_ = map;
  return AGENT_EMAIL_MAP_CACHE_;
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeKey_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeShift_(shift) {
  var value = String(shift || '').trim().toLowerCase();
  if (value === 'day') {
    return 'Day';
  }
  if (value === 'mid' || value === 'middle') {
    return 'Mid';
  }
  if (value === 'night') {
    return 'Night';
  }
  return String(shift || '').trim();
}

function nameFromEmail_(email) {
  var localPart = String(email || '').split('@')[0].replace(/\.digifycx$/, '');
  return localPart.split('.').map(function (part) {
    return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : '';
  }).join(' ').trim();
}
