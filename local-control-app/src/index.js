const actions = [
  'Sync Apps Script',
  'Deploy Apps Script',
  'Run setup',
  'Run daily report',
  'Run weekly report',
  'Run monthly report',
  'View logs',
  'View errors',
  'Open Google Sheet',
  'Open Apps Script project',
  'Open Drive folder'
];

console.log('BMRX Reporting local-control-app scaffold');
console.log('This tool is developer-only. Production work runs in Apps Script.');
console.log('');
console.log('Planned actions:');
actions.forEach((action) => console.log(`- ${action}`));
