function sendReportEmail(reportType, aiSummary, excelFile) {
  var reportWindow = arguments.length > 3 ? arguments[3] : getReportWindow(reportType, new Date());
  var finalRows = arguments.length > 4 ? arguments[4] : getFinalDatasetRows_();
  var recipients = getReportRecipients();
  if (recipients.length === 0) {
    logError('sendReportEmail', new Error('No EMAIL_RECIPIENTS configured.'), 'SKIPPED', 0);
    return false;
  }

  var subject = buildEmailSubject_(reportType, reportWindow);
  var attachments = [];
  var reportLink = excelFile && typeof excelFile.getUrl === 'function' ? excelFile.getUrl() : '';
  var emailModel = CX_buildReportEmailModel_(reportType, reportWindow, aiSummary, finalRows, reportLink);
  var htmlBody = CX_buildAiReportEmailHtml_(emailModel);
  var body = CX_stripHtml_(htmlBody);

  if (excelFile) {
    attachments.push(typeof excelFile.getBlob === 'function' ? excelFile.getBlob() : excelFile);
  }

  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      MailApp.sendEmail({
        to: recipients.join(','),
        subject: subject,
        body: body,
        htmlBody: htmlBody,
        attachments: attachments,
        name: 'CX Experts Reporting'
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

function sendTestCxReportEmail() {
  setupProject();
  var recipients = getTestReportRecipients_();
  if (!recipients.length) {
    throw new Error('No TEST_EMAIL_RECIPIENTS, EMAIL_RECIPIENTS, or active user email was found.');
  }

  var report = CX_buildSampleEmailReport_();
  var htmlBody = CX_buildAiReportEmailHtml_(report);
  var subject = 'TEST - ' + report.reportTitle + ' - ' + report.reportDate;

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: subject,
    body: CX_stripHtml_(htmlBody),
    htmlBody: htmlBody,
    name: 'CX Experts Reporting'
  });

  logPipelineEvent_({
    reportType: 'Email Diagnostic',
    phase: 'cx-template',
    status: 'SENT',
    message: 'Sent CX email template test to ' + recipients.join(', '),
    rowsProcessed: report.metrics ? report.metrics.length : 0
  });

  return {
    status: 'SENT',
    recipients: recipients,
    subject: subject
  };
}

function getTestReportRecipients_() {
  var configured = parseEmailList_(getConfigValue('TEST_EMAIL_RECIPIENTS', ''));
  if (configured.length) {
    return configured;
  }

  var activeEmail = '';
  try {
    activeEmail = Session.getActiveUser().getEmail();
  } catch (ignored) {
    activeEmail = '';
  }

  if (activeEmail) {
    return [activeEmail];
  }

  return getReportRecipients();
}

function parseEmailList_(value) {
  var text = String(value || '');
  if (!text) {
    return [];
  }
  return text.split(',').map(function (email) {
    return email.trim();
  }).filter(function (email) {
    return email;
  });
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
