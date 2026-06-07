# BMRX Productivity Reporting Engine

## 1. Project Purpose

This repository is the local source of truth for a Google Sheets and Apps Script reporting system that pulls Zendesk ticket data, WFM productivity data, and manually maintained attendance data into one reporting workbook.

The production backend is Apps Script. The Google Sheet is the data engine. The local project is for source control, Codex edits, and clasp sync.

Build order:

1. Google Sheet data engine
2. Apps Script automation engine
3. Excel and email reporting
4. AI summary layer
5. Cloudflare dashboard

## 2. Architecture Summary

```text
Local project
  -> Codex edits local files
  -> Git tracks code
  -> clasp pushes apps-script/ to Google Apps Script
  -> Apps Script runs behind the Google Sheet
  -> Apps Script reads/writes workbook tabs
  -> Zendesk/WFM/attendance data is normalized
  -> Excel reports are generated and saved to Drive
  -> Gmail sends management reports
  -> Cloudflare can read/download reports later
```

The local-control-app is only a future developer control panel. It is not the production backend.

## 3. Required Tools

- Node.js
- npm
- Git
- clasp
- Google account access
- Codex

Install clasp globally if needed:

```bash
npm install -g @google/clasp
```

On Windows PowerShell, if `npm` is blocked by execution policy, run commands with `npm.cmd` instead:

```powershell
npm.cmd run clasp:push
```

## 4. Setup Steps

1. Install local dependencies if any are added later:

```bash
npm install
```

2. Log in to Google with clasp:

```bash
npm run clasp:login
```

3. Create or copy the Google Sheet that will become the reporting workbook.

4. Create an Apps Script project, preferably bound to the reporting Sheet.

5. Copy the Apps Script project ID.

6. Create local `.clasp.json` from `.clasp.example.json`:

```json
{
  "scriptId": "APPS_SCRIPT_ID_HERE",
  "rootDir": "./apps-script"
}
```

7. Set Apps Script Script Properties:

```text
ZENDESK_SUBDOMAIN
ZENDESK_EMAIL
ZENDESK_API_TOKEN
WFM_API_KEY
WFM_REPORT_TEMPLATE_ID
AI_API_KEY
AI_MODEL
INTERNAL_API_SECRET
SPREADSHEET_ID
REPORT_OUTPUT_FOLDER_ID
ATTENDANCE_SPREADSHEET_ID
```

For the current Zendesk WFM report URL:

```text
https://cxsupporthub.zendesk.com/wfm/v2/reports/d3729142-32d3-4042-9d2f-5bcc578b5cf8/display
```

Use this Script Property:

```text
WFM_REPORT_TEMPLATE_ID = d3729142-32d3-4042-9d2f-5bcc578b5cf8
```

`WFM_BASE_URL` is optional. If omitted, the script derives it from `ZENDESK_SUBDOMAIN` as:

```text
https://cxsupporthub.zendesk.com/wfm/public/api
```

The sample WFM CSV export supplied for this project has these columns:

```text
Agent name
Agent email
Team
Location
Unpaid General Task time
Total time
```

The mapper supports those labels. This export is period-level, so it can populate total logged time and general task time by agent. It does not contain date, shift, productive time, or unproductive time columns. Keep `WFM_INFER_PRODUCTIVE_FROM_TOTAL_MINUS_GENERAL` set to `FALSE` unless operations confirms that `Total time - Unpaid General Task time` should be treated as productive time.

For the external attendance workbook, use:

```text
ATTENDANCE_SPREADSHEET_ID = 1b0C-xRp3OO0f3HeHAt6n6Nr3u2tpFA72o7ertA8VxQI
```

`ATTENDANCE_SHEET_NAME` is optional and can be set in the Config tab if the attendance workbook has multiple tabs and the first tab is not the source tab.

8. Push the Apps Script code:

```bash
npm run clasp:push
```

9. In Apps Script, run:

```text
setupProject()
```

10. After setup succeeds and config is reviewed, run:

```text
createTriggers()
```

## 5. Security Notes

Do not store secrets in Google Sheet cells, Git, `projects.json`, frontend code, or local-control-app code.

Secrets must live in Apps Script Script Properties only.

`projects.example.json` and `.clasp.example.json` contain placeholders only. Real `projects.json` and `.clasp.json` are ignored by Git.

## 6. Sheet Tabs Created

`setupProject()` creates or validates these tabs without deleting existing user data:

- Config
- Agent Directory
- Fiscal Calendar
- Raw Attendance
- Raw Zendesk Tickets
- Raw WFM
- Normalized Attendance
- Normalized Ticket Productivity
- Normalized WFM Productivity
- Final Report Dataset
- Generated Reports
- Run Log
- Error Log

The `Config` tab is seeded with non-sensitive defaults only. The `Agent Directory` tab is the source of truth for active agents, and email is the matching key.

## 7. Apps Script Functions

Core setup and sheet functions:

- `setupProject()`
- `getSpreadsheet()`
- `ensureSheet(name, headers)`
- `clearAndWriteRows(sheetName, headers, rows)`
- `appendRows(sheetName, rows)`
- `getSheetData(sheetName)`

Config and agents:

- `getConfig()`
- `getConfigValue(key)`
- `isDailyEnabled()`
- `isWeeklyEnabled()`
- `isMonthlyEnabled()`
- `getReportRecipients()`
- `getOutputFolderId()`
- `validateScriptProperties()`
- `getActiveAgents()`
- `getAgentByEmail(email)`
- `getAgentEmailMap()`

Fiscal and reporting windows:

- `getFiscalInfo(date)`
- `getCurrentFiscalWeek(date)`
- `getCurrentFiscalMonth(date)`
- `getReportWindow(reportType, referenceDate)`
- `getOperationalDayWindow(referenceDate)`

Data ingestion and normalization:

- `pullZendeskTickets(startDate, endDate, agents)`
- `writeRawZendeskTickets(rows)`
- `mapZendeskTicketToRawRow(ticket, agentMap)`
- `dedupeZendeskRows(rows)`
- `pullWfmProductivity(startDate, endDate, agents)`
- `writeRawWfmRows(rows)`
- `dedupeWfmRows(rows)`
- `testWfmReportConnection(referenceDate)`
- `testWfmActivityConnection(referenceDate)`
- `readAttendance(startDate, endDate)`
- `syncAttendanceFromSource(startDate, endDate)`
- `testAttendanceSourceConnection()`
- `normalizeAttendance(rows)`
- `normalizeTicketData(rawTickets)`
- `normalizeWfmData(rawWfm)`
- `buildFinalReportDataset(reportType, startDate, endDate)`

Reports, AI, email, Drive, and logs:

- `generateExcelReport(reportType, finalDataset)`
- `saveReportToDrive(fileBlob, filename)`
- `writeGeneratedReportLog(reportMetadata)`
- `buildAiPayload(finalDataset)`
- `generateAiSummary(payload)`
- `sendReportEmail(reportType, aiSummary, excelFile)`
- `getReportFolder()`
- `saveFile(blob, filename)`
- `logRun(run)`
- `logError(functionName, error, status, retryCount)`
- `generateRunId()`

Scheduling and manual runs:

- `createTriggers()`
- `deleteTriggers()`
- `runShiftPullNight()`
- `runShiftPullDay()`
- `runShiftPullMid()`
- `runDailyReport()`
- `runWeeklyReport()`
- `runMonthlyReport()`
- `manualRunDaily(date)`
- `manualRunWeekly(referenceDate)`
- `manualRunMonthly(referenceDate)`
- `manualRunSetup()`

## 8. Manual Run Instructions

Run these from the Apps Script editor while testing:

```text
manualRunSetup()
manualRunDaily('2026-06-05')
manualRunWeekly('2026-06-08')
manualRunMonthly('2026-07-01')
```

Daily reports use the operational day ending at 08:00. Weekly and monthly reports calculate their own period windows and do not trust trigger time alone.

## 9. Deployment Instructions

Push code to Apps Script:

```bash
npm run clasp:push
```

Open the Apps Script project:

```bash
npm run clasp:open
```

Deploy when the web app endpoint is needed:

```bash
npm run clasp:deploy
```

Use `doPost(e)` only for internal developer/control calls protected by `INTERNAL_API_SECRET`.

## 10. Future Cloudflare Dashboard Plan

Cloudflare comes after the reporting pipeline works.

Planned stack:

- React frontend on Cloudflare Pages
- Cloudflare Worker API
- Google Drive or Google Sheets as report/data source
- Protected access
- Report list, filters, and Excel downloads

The dashboard should read generated reports and normalized data. It should not replace Apps Script as the reporting backend.
