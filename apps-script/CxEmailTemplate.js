function CX_buildReportEmailModel_(reportType, reportWindow, aiSummary, finalRows, reportLink) {
  var type = String(reportType || 'daily').toLowerCase();
  var rows = finalRows || [];
  var totals = CX_calculateReportTotals_(rows);
  var title = CX_reportTitle_(type);

  return {
    reportTitle: title,
    reportDate: reportWindow && reportWindow.startDate ? Utilities.formatDate(reportWindow.startDate, getReportTimezone_(), 'yyyy-MM-dd') : Utilities.formatDate(new Date(), getReportTimezone_(), 'yyyy-MM-dd'),
    reportPeriod: reportWindow && reportWindow.periodLabel ? reportWindow.periodLabel : CX_titleCase_(type),
    timezone: getReportTimezone_(),
    summary: CX_buildReportSummary_(aiSummary, rows, totals),
    metrics: CX_buildReportMetrics_(totals),
    sections: CX_buildReportSections_(rows, type),
    reportLink: reportLink || '',
    companyWebsite: getConfigValue('CX_COMPANY_WEBSITE', 'https://www.cxexperts.co.za/'),
    linkedinUrl: getConfigValue('CX_LINKEDIN_URL', 'https://za.linkedin.com/company/cxexperts'),
    youtubeUrl: getConfigValue('CX_YOUTUBE_URL', 'https://www.youtube.com/@Cx_Experts'),
    whatsappUrl: getConfigValue('CX_WHATSAPP_URL', 'https://chat.whatsapp.com/FlhsM5E5ibwGrsAtI4jNwz')
  };
}

function CX_buildSampleEmailReport_() {
  return {
    reportTitle: 'AI Ticket Summary Report',
    reportDate: Utilities.formatDate(new Date(), getReportTimezone_(), 'yyyy-MM-dd'),
    reportPeriod: 'Template Test',
    timezone: getReportTimezone_(),
    summary: {
      overall: 'The team handled a steady number of support items. This sample confirms the CX Experts report email layout, summary blocks, metric cards, and section tables.',
      highlights: 'Zendesk activity is shown first, followed by attendance and WFM review items. The live reports use the same template with real dashboard data.',
      risks: 'This is a test email only. No operational conclusion should be taken from the sample rows.',
      followUp: 'If this email renders correctly, run the normal daily, weekly, or monthly report email test next.'
    },
    metrics: [
      { label: 'Agents Reviewed', value: 25, note: 'Sample team size' },
      { label: 'Tickets Solved', value: 42, note: 'Sample output' },
      { label: 'In Progress', value: 2, note: 'Open tickets with notes' },
      { label: 'Review Flags', value: 3, note: 'Needs attention' },
      { label: 'WFM Outstanding', value: '4.5h', note: 'Sample balance' }
    ],
    sections: [
      {
        title: 'Shift Roster',
        stream: 'Shift Roster',
        taskHeader: 'Shift',
        rows: [
          {
            name: 'Agent Name',
            requester: 'agent@example.com',
            details: 'Team: Support. Site: Durban. Role: Agent.',
            status: 'Completed',
            tasksCompleted: 'Day',
            notes: 'Assigned to Day shift.'
          }
        ]
      },
      {
        title: 'Zendesk Ticket Output',
        stream: 'Zendesk',
        rows: [
          {
            name: 'Agent Name',
            requester: 'agent@example.com',
            details: 'Handled customer support tickets and recorded productive ticket activity.',
            status: 'Completed',
            tasksCompleted: 8,
            notes: 'Good activity recorded.'
          }
        ]
      },
      {
        title: 'Attendance Review',
        stream: 'Attendance',
        rows: [
          {
            name: 'Agent Name',
            requester: 'agent@example.com',
            details: 'Attendance was present for the selected reporting period.',
            status: 'Completed',
            tasksCompleted: 1,
            notes: 'No attendance exception in this sample.'
          }
        ]
      },
      {
        title: 'WFM Balance Review',
        stream: 'WFM',
        rows: [
          {
            name: 'Agent Name',
            requester: 'agent@example.com',
            details: 'Monthly WFM balance is included only in monthly report context.',
            status: 'In progress',
            tasksCompleted: '4.5h',
            notes: 'Sample monthly review item.'
          }
        ]
      }
    ],
    reportLink: '',
    companyWebsite: 'https://www.cxexperts.co.za/',
    linkedinUrl: 'https://za.linkedin.com/company/cxexperts',
    youtubeUrl: 'https://www.youtube.com/@Cx_Experts',
    whatsappUrl: 'https://chat.whatsapp.com/FlhsM5E5ibwGrsAtI4jNwz'
  };
}

function CX_buildAiReportEmailHtml_(report) {
  report = report || {};

  var title = report.reportTitle || 'AI Summary Report';
  var reportDate = report.reportDate || '';
  var reportPeriod = report.reportPeriod || 'Daily';
  var timezone = report.timezone || 'Africa/Johannesburg';
  var html = '';

  html += '<!DOCTYPE html>';
  html += '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>';
  html += '<body style="margin:0;padding:0;background:#f4f1f8;font-family:Arial,Helvetica,sans-serif;color:#222;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1f8;width:100%;margin:0;padding:0;">';
  html += '<tr><td align="center" style="padding:16px;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:980px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e1eb;">';
  html += CX_buildHeaderHtml_(title, reportDate, reportPeriod, timezone);
  html += CX_buildSummaryHtml_(report.summary || {});
  html += CX_buildMetricsHtml_(report.metrics || []);
  html += CX_buildSectionsHtml_(report.sections || []);
  if (report.reportLink) {
    html += CX_buildReportLinkHtml_(report.reportLink);
  }
  html += CX_buildSignatureHtml_(report);
  html += '</table>';
  html += '</td></tr></table>';
  html += '</body></html>';

  return html;
}

function CX_buildHeaderHtml_(title, reportDate, reportPeriod, timezone) {
  var html = '';

  html += '<tr><td style="background:#4b1d78;color:#ffffff;padding:24px;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>';
  html += '<td style="vertical-align:middle;">';
  html += '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:0.9;">CX Experts Reporting</div>';
  html += '<div style="font-size:26px;font-weight:bold;line-height:1.25;margin-top:8px;">' + CX_escapeHtml_(title) + '</div>';
  html += '<div style="font-size:14px;line-height:1.6;margin-top:10px;">Report Date: <strong>' + CX_escapeHtml_(reportDate) + '</strong></div>';
  html += '<div style="font-size:14px;line-height:1.6;">Period: <strong>' + CX_escapeHtml_(reportPeriod) + '</strong></div>';
  html += '<div style="font-size:13px;line-height:1.6;opacity:0.95;">Timezone: ' + CX_escapeHtml_(timezone) + '</div>';
  html += '</td>';
  html += '<td style="width:170px;text-align:right;vertical-align:middle;">';
  html += '<div style="display:inline-block;background:#7b2cbf;border-radius:14px;padding:12px 16px;color:#ffffff;font-weight:bold;font-size:16px;line-height:1.2;text-align:center;">';
  html += 'CX EXPERTS<br><span style="font-size:9px;font-weight:normal;letter-spacing:1px;">CUSTOMER EXPERIENCE EXPERTS</span>';
  html += '</div>';
  html += '</td>';
  html += '</tr></table>';
  html += '</td></tr>';

  return html;
}

function CX_buildSummaryHtml_(summary) {
  var html = '';
  html += '<tr><td style="padding:22px 26px 10px 26px;">';
  html += '<div style="background:#fbf9fd;border:1px solid #e8dff1;border-radius:14px;padding:18px;">';
  html += '<div style="font-size:20px;font-weight:bold;color:#32104f;margin-bottom:14px;">Manager Summary</div>';
  html += CX_summaryBlock_('Overall Summary', summary.overall);
  html += CX_summaryBlock_('Key Highlights', summary.highlights);
  html += CX_summaryBlock_('Items to Review', summary.risks);
  html += CX_summaryBlock_('Follow-up Needed', summary.followUp);
  html += '</div>';
  html += '</td></tr>';
  return html;
}

function CX_summaryBlock_(heading, text) {
  if (!text) {
    return '';
  }
  return '<div style="margin-bottom:14px;">' +
    '<div style="font-size:14px;font-weight:bold;color:#4b1d78;margin-bottom:4px;">' + CX_escapeHtml_(heading) + '</div>' +
    '<div style="font-size:14px;line-height:1.6;color:#333;">' + CX_escapeHtml_(text) + '</div>' +
    '</div>';
}

function CX_buildMetricsHtml_(metrics) {
  if (!metrics || !metrics.length) {
    return '';
  }

  var html = '';
  html += '<tr><td style="padding:10px 26px;">';
  html += '<div style="font-size:20px;font-weight:bold;color:#32104f;margin-bottom:12px;">Overall Totals</div>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>';

  for (var i = 0; i < metrics.length; i++) {
    html += '<td style="width:20%;padding:6px;vertical-align:top;">';
    html += '<div style="border:1px solid #e5e1eb;border-radius:12px;padding:14px;background:#ffffff;min-height:78px;">';
    html += '<div style="font-size:12px;color:#666;line-height:1.3;">' + CX_escapeHtml_(metrics[i].label) + '</div>';
    html += '<div style="font-size:26px;font-weight:bold;color:#4b1d78;margin-top:5px;line-height:1;">' + CX_escapeHtml_(metrics[i].value) + '</div>';
    html += '<div style="font-size:11px;color:#777;margin-top:6px;">' + CX_escapeHtml_(metrics[i].note || '') + '</div>';
    html += '</div></td>';
  }

  html += '</tr></table>';
  html += '</td></tr>';
  return html;
}

function CX_buildSectionsHtml_(sections) {
  var html = '';
  sections = sections || [];
  for (var i = 0; i < sections.length; i++) {
    html += CX_buildSectionHtml_(sections[i]);
  }
  return html;
}

function CX_buildSectionHtml_(section) {
  section = section || {};
  var rows = section.rows || [];
  var stream = section.stream || section.title || '';
  var taskHeader = section.taskHeader || 'Tasks';
  var html = '';

  html += '<tr><td style="padding:14px 26px;">';
  html += '<div style="border:1px solid #e5e1eb;border-radius:14px;overflow:hidden;">';
  html += '<div style="background:#edf3fb;padding:14px 16px;border-bottom:1px solid #dbe7f5;">';
  html += '<div style="font-size:18px;font-weight:bold;color:#14365d;">' + CX_escapeHtml_(section.title || 'Report Section') + '</div>';
  html += '</div>';
  html += '<div style="padding:14px;">';

  if (!rows.length) {
    html += '<div style="font-size:13px;color:#777;padding:10px;border:1px solid #eee;border-radius:10px;">No records found for this section.</div>';
  } else {
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="background:#1f4e79;color:#ffffff;">';
    html += '<th style="text-align:left;padding:9px;border:1px solid #d5dce5;">Name</th>';
    html += '<th style="text-align:left;padding:9px;border:1px solid #d5dce5;">Stream</th>';
    html += '<th style="text-align:left;padding:9px;border:1px solid #d5dce5;">Requester</th>';
    html += '<th style="text-align:left;padding:9px;border:1px solid #d5dce5;">Details</th>';
    html += '<th style="text-align:left;padding:9px;border:1px solid #d5dce5;">' + CX_escapeHtml_(taskHeader) + '</th>';
    html += '<th style="text-align:left;padding:9px;border:1px solid #d5dce5;">Status</th>';
    html += '<th style="text-align:left;padding:9px;border:1px solid #d5dce5;">Notes</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var rowBg = i % 2 === 0 ? '#ffffff' : '#f2f2f2';
      html += '<tr style="background:' + rowBg + ';">';
      html += '<td style="padding:9px;border:1px solid #ddd;">' + CX_escapeHtml_(rows[i].name || '') + '</td>';
      html += '<td style="padding:9px;border:1px solid #ddd;' + CX_streamStyle_(rows[i].stream || stream) + '">' + CX_escapeHtml_(rows[i].stream || stream) + '</td>';
      html += '<td style="padding:9px;border:1px solid #ddd;">' + CX_escapeHtml_(rows[i].requester || '') + '</td>';
      html += '<td style="padding:9px;border:1px solid #ddd;">' + CX_escapeHtml_(rows[i].details || '') + '</td>';
      html += '<td style="padding:9px;border:1px solid #ddd;">' + CX_escapeHtml_(rows[i].tasksCompleted || '') + '</td>';
      html += '<td style="padding:9px;border:1px solid #ddd;' + CX_statusStyle_(rows[i].status || '') + '">' + CX_escapeHtml_(rows[i].status || '') + '</td>';
      html += '<td style="padding:9px;border:1px solid #ddd;">' + CX_escapeHtml_(rows[i].notes || '') + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
  }

  html += '</div></div>';
  html += '</td></tr>';
  return html;
}

function CX_buildReportLinkHtml_(reportLink) {
  var html = '';
  html += '<tr><td style="padding:14px 26px;">';
  html += '<div style="background:#f8f8f8;border:1px solid #e3e3e3;border-radius:12px;padding:14px;font-size:13px;line-height:1.5;">';
  html += '<strong>Full report details</strong><br>Open the full report using the link below.<br><br>';
  html += '<a href="' + CX_escapeHtml_(reportLink) + '" style="display:inline-block;background:#4b1d78;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:bold;">Open Full Report</a>';
  html += '</div></td></tr>';
  return html;
}

function CX_buildSignatureHtml_(report) {
  var website = report.companyWebsite || 'https://www.cxexperts.co.za/';
  var linkedin = report.linkedinUrl || 'https://za.linkedin.com/company/cxexperts';
  var youtube = report.youtubeUrl || 'https://www.youtube.com/@Cx_Experts';
  var whatsapp = report.whatsappUrl || '#';
  var html = '';

  html += '<tr><td style="padding:20px 26px 24px 26px;">';
  html += '<div style="border-top:1px solid #e5e1eb;padding-top:18px;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>';
  html += '<td style="width:180px;vertical-align:top;padding-right:16px;">';
  html += '<a href="' + CX_escapeHtml_(website) + '" style="text-decoration:none;">';
  html += '<div style="background:#ffffff;border:1px solid #e6e0ee;border-radius:12px;padding:10px;text-align:center;color:#4b1d78;font-weight:bold;">';
  html += 'CX EXPERTS<br><span style="font-size:9px;font-weight:normal;letter-spacing:1px;">CUSTOMER EXPERIENCE EXPERTS</span>';
  html += '</div></a></td>';
  html += '<td style="vertical-align:top;">';
  html += '<div style="font-size:15px;font-weight:bold;color:#32104f;margin-bottom:4px;">CX Experts Reporting Automation</div>';
  html += '<div style="font-size:13px;color:#555;line-height:1.5;margin-bottom:10px;">This report was generated automatically to help management review activity, productivity, and follow-up items.</div>';
  html += '<div style="font-size:13px;line-height:1.8;">';
  html += CX_signatureButton_('Website', website);
  html += CX_signatureButton_('LinkedIn', linkedin);
  html += CX_signatureButton_('YouTube', youtube);
  html += CX_signatureButton_('WhatsApp', whatsapp);
  html += '</div>';
  html += '<div style="font-size:11px;color:#888;margin-top:12px;line-height:1.4;">Confidential internal report. Please do not forward outside the intended management team.</div>';
  html += '</td></tr></table></div>';
  html += '</td></tr>';
  return html;
}

function CX_signatureButton_(label, url) {
  return '<a href="' + CX_escapeHtml_(url) + '" style="display:inline-block;margin:0 6px 6px 0;background:#f3edf9;border:1px solid #e0d3ec;color:#4b1d78;text-decoration:none;font-weight:bold;padding:6px 10px;border-radius:999px;">' + CX_escapeHtml_(label) + '</a>';
}

function CX_calculateReportTotals_(rows) {
  var totals = {
    agents: rows.length,
    ticketsSolved: 0,
    openTicketFollowUps: 0,
    productiveHours: 0,
    unproductiveHours: 0,
    reviewFlags: 0,
    noTicketActivity: 0,
    missingAttendance: 0,
    wfmIssues: 0
  };

  for (var i = 0; i < rows.length; i++) {
    var notes = String(rows[i][13] || '');
    totals.ticketsSolved += Number(rows[i][9] || 0);
    totals.openTicketFollowUps += Number(rows[i][14] || 0);
    totals.productiveHours += Number(rows[i][10] || 0);
    totals.unproductiveHours += Number(rows[i][11] || 0);
    if (notes) {
      totals.reviewFlags += 1;
    }
    if (/no ticket activity/i.test(notes)) {
      totals.noTicketActivity += 1;
    }
    if (/missing attendance/i.test(notes)) {
      totals.missingAttendance += 1;
    }
    if (/wfm|outstanding/i.test(notes)) {
      totals.wfmIssues += 1;
    }
  }

  totals.productiveHours = round2_(totals.productiveHours);
  totals.unproductiveHours = round2_(totals.unproductiveHours);
  return totals;
}

function CX_buildReportSummary_(aiSummary, rows, totals) {
  var overall = aiSummary || 'The report was generated successfully. Review the metrics and section tables below for the selected period.';
  return {
    overall: overall,
    highlights: 'Agents reviewed: ' + totals.agents + '. Tickets solved: ' + totals.ticketsSolved + '. Open tickets with notes: ' + totals.openTicketFollowUps + '.',
    risks: totals.reviewFlags ? (totals.reviewFlags + ' row(s) contain review notes. Missing attendance: ' + totals.missingAttendance + '. No ticket activity: ' + totals.noTicketActivity + '. Open ticket follow-up: ' + totals.openTicketFollowUps + '.') : 'No exception notes were flagged in the current report view.',
    followUp: 'Review rows marked as missing attendance, no ticket activity, open-ticket note follow-up, WFM outstanding, or needing manual follow-up before sending management conclusions.'
  };
}

function CX_buildReportMetrics_(totals) {
  return [
    { label: 'Agents Reviewed', value: totals.agents, note: 'Current report rows' },
    { label: 'Tickets Solved', value: totals.ticketsSolved, note: 'Zendesk output' },
    { label: 'In Progress', value: totals.openTicketFollowUps, note: 'Open tickets with notes' },
    { label: 'Review Flags', value: totals.reviewFlags, note: 'Rows with notes' },
    { label: 'WFM Review', value: totals.wfmIssues, note: 'Monthly balance flags' }
  ];
}

function CX_buildReportSections_(rows, reportType) {
  var sections = [
    {
      title: 'Shift Comparison',
      stream: 'Shift Comparison',
      rows: CX_buildShiftComparisonEmailRows_(rows)
    },
    {
      title: 'Shift Roster',
      stream: 'Shift Roster',
      taskHeader: 'Shift',
      rows: CX_buildShiftRosterEmailRows_(rows)
    }
  ];

  sections = sections.concat(CX_buildZendeskShiftSections_(rows));
  sections = sections.concat([
    {
      title: 'Attendance Review',
      stream: 'Attendance',
      rows: CX_buildAttendanceEmailRows_(rows).slice(0, 25)
    },
    {
      title: 'WFM Balance Review',
      stream: 'WFM',
      rows: CX_buildWfmEmailRows_(rows, reportType).slice(0, 25)
    }
  ]);

  return sections;
}

function CX_buildShiftComparisonEmailRows_(rows) {
  var groups = {};
  var orderedShifts = ['Day', 'Mid', 'Night'];

  for (var i = 0; i < orderedShifts.length; i++) {
    groups[orderedShifts[i]] = CX_emptyShiftSummary_(orderedShifts[i]);
  }

  for (var j = 0; j < rows.length; j++) {
    var shift = CX_normalizeShiftName_(rows[j][7]);
    if (!groups[shift]) {
      groups[shift] = CX_emptyShiftSummary_(shift);
      orderedShifts.push(shift);
    }

    var group = groups[shift];
    var attendance = rows[j][8];
    var notes = String(rows[j][13] || '');

    group.agents += 1;
    group.ticketsSolved += Number(rows[j][9] || 0);
    group.inProgressTickets += Number(rows[j][14] || 0);
    group.productiveHours += Number(rows[j][10] || 0);
    group.unproductiveHours += Number(rows[j][11] || 0);
    if (attendance !== '' && attendance !== null && typeof attendance !== 'undefined') {
      group.attendanceTotal += Number(attendance || 0);
      group.attendanceCount += 1;
    }
    if (notes) {
      group.flags += 1;
    }
    if (/missing attendance/i.test(notes) || attendance === '') {
      group.missingAttendance += 1;
    }
  }

  var rowsOut = [];
  for (var k = 0; k < orderedShifts.length; k++) {
    var item = groups[orderedShifts[k]];
    var attendanceAverage = item.attendanceCount ? round2_(item.attendanceTotal / item.attendanceCount) : '';
    rowsOut.push({
      name: item.shift + ' Shift',
      stream: 'Shift Comparison',
      requester: item.agents + ' agent(s)',
      details: [
        'Attendance avg: ' + CX_formatPercent_(attendanceAverage),
        'Tickets solved: ' + item.ticketsSolved,
        'Open-ticket notes: ' + item.inProgressTickets,
        'Productive hours: ' + round2_(item.productiveHours),
        'Unproductive hours: ' + round2_(item.unproductiveHours)
      ].join('. ') + '.',
      status: item.agents ? (item.flags || item.inProgressTickets ? 'In progress' : 'Completed') : 'No productivity recorded',
      tasksCompleted: item.ticketsSolved,
      notes: item.agents ? (item.flags + ' review flag(s); ' + item.missingAttendance + ' missing attendance row(s); ' + item.inProgressTickets + ' open ticket note(s).') : 'No rows found for this shift in the selected period.'
    });
  }

  return rowsOut;
}

function CX_emptyShiftSummary_(shift) {
  return {
    shift: shift || 'Unassigned',
    agents: 0,
    attendanceTotal: 0,
    attendanceCount: 0,
    ticketsSolved: 0,
    inProgressTickets: 0,
    productiveHours: 0,
    unproductiveHours: 0,
    flags: 0,
    missingAttendance: 0
  };
}

function CX_normalizeShiftName_(shift) {
  var value = String(shift || '').trim().toLowerCase();
  if (value.indexOf('day') !== -1 || value.indexOf('morning') !== -1) {
    return 'Day';
  }
  if (value.indexOf('mid') !== -1 || value.indexOf('afternoon') !== -1 || value.indexOf('evening') !== -1) {
    return 'Mid';
  }
  if (value.indexOf('night') !== -1) {
    return 'Night';
  }
  return value ? CX_titleCase_(value) : 'Unassigned';
}

function CX_shiftRank_(shift) {
  var normalized = CX_normalizeShiftName_(shift);
  if (normalized === 'Day') {
    return 1;
  }
  if (normalized === 'Mid') {
    return 2;
  }
  if (normalized === 'Night') {
    return 3;
  }
  return 99;
}

function CX_buildZendeskEmailRows_(rows) {
  var output = [];
  var copy = rows.slice().sort(function (left, right) {
    return Number(right[9] || 0) - Number(left[9] || 0);
  });

  for (var i = 0; i < copy.length; i++) {
    var inProgressTickets = Number(copy[i][14] || 0);
    var status = inProgressTickets > 0 ? 'In progress' : (Number(copy[i][9] || 0) > 0 ? 'Completed' : 'No productivity recorded');
    output.push({
      name: copy[i][6] || '',
      requester: copy[i][5] || '',
      details: 'Tickets solved: ' + Number(copy[i][9] || 0) + '. Open-ticket notes: ' + inProgressTickets + '. Attendance: ' + CX_formatPercent_(copy[i][8]) + '.',
      status: status,
      tasksCompleted: Number(copy[i][9] || 0),
      notes: CX_joinNotes_(copy[i][15], copy[i][13])
    });
  }
  return output;
}

function CX_buildShiftRosterEmailRows_(rows) {
  var output = [];
  var copy = (rows || []).slice().sort(function (left, right) {
    var leftShift = CX_shiftRank_(left[7]);
    var rightShift = CX_shiftRank_(right[7]);
    if (leftShift !== rightShift) {
      return leftShift - rightShift;
    }
    return String(left[6] || '').localeCompare(String(right[6] || ''));
  });

  for (var i = 0; i < copy.length; i++) {
    var agent = getAgentByEmail(copy[i][5]) || {};
    var shift = copy[i][7] || 'Unassigned';
    output.push({
      name: copy[i][6] || agent.name || '',
      requester: copy[i][5] || agent.email || '',
      details: [
        'Team: ' + CX_valueOrDash_(agent.team),
        'Site: ' + CX_valueOrDash_(agent.site),
        'Role: ' + CX_valueOrDash_(agent.role)
      ].join('. ') + '.',
      status: copy[i][16] || (Number(copy[i][14] || 0) > 0 ? 'In progress' : 'Completed'),
      tasksCompleted: shift,
      notes: copy[i][15] || ('Assigned to ' + shift + ' shift.')
    });
  }

  return output;
}

function CX_buildZendeskShiftSections_(rows) {
  var grouped = CX_groupRowsByShift_(rows);
  var sections = [];
  var order = ['Day', 'Mid', 'Night'];

  for (var i = 0; i < order.length; i++) {
    sections.push({
      title: 'Zendesk Ticket Output - ' + order[i] + ' Shift',
      stream: 'Zendesk',
      rows: CX_buildZendeskEmailRows_(grouped[order[i]] || []).slice(0, 25)
    });
  }

  var extraShifts = Object.keys(grouped).filter(function (shift) {
    return order.indexOf(shift) === -1 && (grouped[shift] || []).length;
  }).sort();

  for (var j = 0; j < extraShifts.length; j++) {
    sections.push({
      title: 'Zendesk Ticket Output - ' + extraShifts[j] + ' Shift',
      stream: 'Zendesk',
      rows: CX_buildZendeskEmailRows_(grouped[extraShifts[j]] || []).slice(0, 25)
    });
  }

  return sections;
}

function CX_groupRowsByShift_(rows) {
  var grouped = {
    Day: [],
    Mid: [],
    Night: []
  };

  for (var i = 0; i < (rows || []).length; i++) {
    var shift = CX_normalizeShiftName_(rows[i][7]);
    if (!grouped[shift]) {
      grouped[shift] = [];
    }
    grouped[shift].push(rows[i]);
  }

  return grouped;
}

function CX_buildAttendanceEmailRows_(rows) {
  var output = [];
  for (var i = 0; i < rows.length; i++) {
    var notes = String(rows[i][13] || '');
    if (/missing attendance|attendance/i.test(notes) || rows[i][8] === '') {
      output.push({
        name: rows[i][6] || '',
        requester: rows[i][5] || '',
        details: 'Attendance score: ' + CX_formatPercent_(rows[i][8]) + '. Shift: ' + (rows[i][7] || 'Unassigned') + '.',
        status: /missing attendance/i.test(notes) || rows[i][8] === '' ? 'No productivity recorded' : 'Completed',
        tasksCompleted: rows[i][8] === '' ? 0 : 1,
        notes: notes || 'Attendance data available.'
      });
    }
  }
  return output;
}

function CX_buildWfmEmailRows_(rows, reportType) {
  var output = [];
  for (var i = 0; i < rows.length; i++) {
    var notes = String(rows[i][13] || '');
    if (String(reportType || '').toLowerCase() === 'monthly' || /wfm|outstanding/i.test(notes) || rows[i][10] !== '' || rows[i][11] !== '') {
      output.push({
        name: rows[i][6] || '',
        requester: rows[i][5] || '',
        details: 'Productive hours: ' + CX_valueOrDash_(rows[i][10]) + '. Unproductive hours: ' + CX_valueOrDash_(rows[i][11]) + '. Productivity: ' + CX_formatPercent_(rows[i][12]) + '.',
        status: /wfm|outstanding|missing/i.test(notes) ? 'In progress' : 'Completed',
        tasksCompleted: CX_valueOrDash_(rows[i][10]),
        notes: notes || 'No WFM exception flagged.'
      });
    }
  }
  return output;
}

function CX_streamStyle_(stream) {
  var value = String(stream || '').toLowerCase();
  if (value.indexOf('zendesk') !== -1) {
    return 'background:#d9ead3;color:#006100;font-weight:bold;';
  }
  if (value.indexOf('attendance') !== -1) {
    return 'background:#cfe2f3;color:#073763;font-weight:bold;';
  }
  if (value.indexOf('wfm') !== -1) {
    return 'background:#eadcf8;color:#4b1d78;font-weight:bold;';
  }
  if (value.indexOf('branding') !== -1) {
    return 'background:#f4cccc;color:#990000;font-weight:bold;';
  }
  if (value.indexOf('it support') !== -1 || value.indexOf('it') !== -1) {
    return 'background:#cfe2f3;color:#073763;font-weight:bold;';
  }
  return 'background:#eeeeee;color:#333;font-weight:bold;';
}

function CX_statusStyle_(status) {
  var value = String(status || '').toLowerCase();
  if (value.indexOf('no productivity') !== -1 || value.indexOf('no activity') !== -1) {
    return 'background:#f4cccc;color:#cc0000;font-weight:bold;';
  }
  if (value.indexOf('in progress') !== -1 || value.indexOf('review') !== -1) {
    return 'background:#fff2cc;color:#7f6000;font-weight:bold;';
  }
  if (value.indexOf('complete') !== -1 || value.indexOf('solved') !== -1 || value.indexOf('done') !== -1) {
    return 'background:#d9ead3;color:#006100;font-weight:bold;';
  }
  return '';
}

function CX_reportTitle_(reportType) {
  if (reportType === 'weekly') {
    return 'Weekly Productivity Summary Report';
  }
  if (reportType === 'monthly') {
    return 'Monthly Productivity Summary Report';
  }
  return 'Daily Productivity Summary Report';
}

function CX_titleCase_(value) {
  var text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';
}

function CX_formatPercent_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return 'Not recorded';
  }
  var number = Number(value);
  if (isNaN(number)) {
    return String(value);
  }
  return round2_(number * 100) + '%';
}

function CX_valueOrDash_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return '-';
  }
  return value;
}

function CX_joinNotes_() {
  var output = [];
  var seen = {};
  for (var i = 0; i < arguments.length; i++) {
    var value = String(arguments[i] || '').trim();
    if (value && !seen[value]) {
      seen[value] = true;
      output.push(value);
    }
  }
  return output.join('; ');
}

function CX_escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function CX_stripHtml_(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
