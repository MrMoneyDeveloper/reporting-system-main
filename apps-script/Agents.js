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

  for (var i = 0; i < existingRows.length; i++) {
    var email = normalizeEmail_(existingRows[i].Email);
    if (email) {
      existingEmails[email] = true;
    }
  }

  var rowsToAppend = [];
  for (var j = 0; j < DEFAULT_AGENT_EMAILS.length; j++) {
    var agentEmail = DEFAULT_AGENT_EMAILS[j];
    if (existingEmails[agentEmail]) {
      continue;
    }

    rowsToAppend.push([
      'TRUE',
      nameFromEmail_(agentEmail),
      agentEmail,
      '',
      '',
      '',
      'Agent',
      '',
      ''
    ]);
  }

  var rowsWritten = appendRows(SHEET_NAMES.AGENTS, rowsToAppend);
  if (rowsWritten) {
    ACTIVE_AGENTS_CACHE_ = null;
    AGENT_EMAIL_MAP_CACHE_ = null;
  }
  return rowsWritten;
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
