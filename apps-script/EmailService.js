function sendReportEmail(reportType, aiSummary, excelFile) {
  var reportWindow = arguments.length > 3 ? arguments[3] : getReportWindow(reportType, new Date());
  var recipients = getReportRecipients();
  if (recipients.length === 0) {
    logError('sendReportEmail', new Error('No EMAIL_RECIPIENTS configured.'), 'SKIPPED', 0);
    return false;
  }

  var subject = buildEmailSubject_(reportType, reportWindow);
  var body = buildEmailBody_(reportWindow, aiSummary);
  var attachments = [];

  if (excelFile) {
    attachments.push(typeof excelFile.getBlob === 'function' ? excelFile.getBlob() : excelFile);
  }

  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      MailApp.sendEmail({
        to: recipients.join(','),
        subject: subject,
        body: body,
        attachments: attachments
      });
      return true;
    } catch (error) {
      logError('sendReportEmail', error, attempt === 3 ? 'FAILED' : 'RETRY', attempt);
      if (attempt === 3) {
        throw error;
      }
      Utilities.sleep(1000 * attempt);
    }
  }

  return false;
}

function buildEmailSubject_(reportType, reportWindow) {
  var type = String(reportType || '').toLowerCase();
  if (type === 'daily') {
    return 'Daily Productivity Summary | ' + Utilities.formatDate(reportWindow.startDate, getReportTimezone_(), 'dd MMMM yyyy');
  }
  if (type === 'weekly') {
    return 'Weekly Productivity Summary | ' + reportWindow.fiscalWeek;
  }
  if (type === 'monthly') {
    return 'Monthly Productivity Summary | ' + reportWindow.fiscalMonth;
  }
  return 'Productivity Summary';
}

function buildEmailBody_(reportWindow, aiSummary) {
  return [
    'Good morning,',
    '',
    'Please find attached the productivity summary for ' + reportWindow.periodLabel + '.',
    '',
    'Top-level summary:',
    aiSummary || 'No AI summary was generated.',
    '',
    'Key points:',
    '- Attendance:',
    '- Ticket output:',
    '- WFM monthly balance:',
    '- Exceptions:',
    '- Recommended actions:',
    '',
    'The full Excel report is attached for review.',
    '',
    'Kind regards,',
    'Automated Reporting System'
  ].join('\n');
}
