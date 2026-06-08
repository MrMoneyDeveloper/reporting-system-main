# CX Experts Reporting Gateway

This folder is the Cloudflare Pages frontend for the reporting system.

It does not replace Apps Script. Apps Script remains the backend that reads Google Sheets, stores credentials in Script Properties, runs source syncs, generates reports, and calls the AI provider.

## Cloudflare Pages Settings

Use these settings when creating the Pages project:

| Setting | Value |
| --- | --- |
| Framework preset | React / Vite |
| Root directory | `local-control-app` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |

Cloudflare will give you a free URL like:

```text
https://reporting-system-main.pages.dev
```

No custom domain is required.

## Environment Variable

Optional but recommended:

```text
VITE_APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

If this is not set, the frontend lets you paste the Apps Script Web App URL in the browser and saves it in local storage.

## Local Test

```bash
npm install
npm run build
npm run preview
```

## Notes

- Do not put Groq, Zendesk, or Google credentials in this frontend.
- Secrets stay in Apps Script Script Properties.
- The `_redirects` file supports refreshes on client-side routes.
