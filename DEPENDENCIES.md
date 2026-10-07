# Reporting System / Customer Digest — Dependencies and Configuration

Companion to [HANDOVER.md](HANDOVER.md). Based on repository documentation and configuration/source inspected on 7 October 2026; the live deployment must be reconciled before sign-off. Package manifests and lockfiles remain authoritative for exact transitive versions; this is the operational dependency list, not a frozen software bill of materials.

| Dependency | Required setup / configuration | Source or handover action |
| --- | --- | --- |
| Tooling/runtime | Node/npm, clasp; Google Apps Script; Google Sheets/Drive/Gmail; Cloudflare Pages frontend/functions | package.json; local-control-app/package.json; apps-script/appsscript.json |
| Zendesk | ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN | Apps Script Script Properties; rotate token and confirm account/scope. |
| AI | GROQ_API_KEY, AI_PROVIDER, AI_MODEL; any additional provider key actually configured | Script Properties; rotate enabled provider keys and confirm billing/model access. |
| Internal API | INTERNAL_API_SECRET | Match Script Properties and server-side Pages environment if protected POST mode is used; never expose it to the browser. |
| Google resources | SPREADSHEET_ID, REPORT_OUTPUT_FOLDER_ID, ATTENDANCE_SPREADSHEET_ID, optional ATTENDANCE_SHEET_NAME | Transfer workbook/folder access, script execution identity, Google consent, deployment and installable triggers. |
| WFM/report delivery | Configured WFM data source/authentication, agent directory, report recipients, schedules and timezone | Inspect live Config and Script Properties; document only key names in Git. Do not assume an undocumented WFM token name. |

## API and OAuth completion requirements

For **every enabled API/OAuth integration**, record its accountable owner, provider/project, credential name, scopes, secret-store location, endpoint/redirect URI, expiry/renewal behavior and dependent consumers in the private operations register. Rotate/reissue all applicable keys, client secrets, tokens, grants and deployment credentials; configure each consumer; test the new identity; then revoke the superseded credentials. See the ordered procedure in [HANDOVER.md](HANDOVER.md).

Never put secret values in this file. If the live environment has additional integrations, add their non-secret dependency details before handover sign-off. Items absent from inspected source are unverified, not automatically unnecessary. This documentation update does not perform credential rotation or modify runtime settings.
