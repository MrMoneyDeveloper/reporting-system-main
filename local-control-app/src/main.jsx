import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Gauge,
  KeyRound,
  Link as LinkIcon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TableProperties
} from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'cx_reporting_apps_script_url';
const envUrl = import.meta.env.VITE_APPS_SCRIPT_WEB_APP_URL || '';

function App() {
  const [storedUrl, setStoredUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) || '';
    setStoredUrl(saved);
    setInputUrl(saved || envUrl);
  }, []);

  const dashboardUrl = useMemo(() => normalizeUrl(inputUrl || envUrl || storedUrl), [inputUrl, storedUrl]);
  const isReady = Boolean(dashboardUrl);

  function saveUrl() {
    const normalized = normalizeUrl(inputUrl);
    if (!normalized) {
      setMessage('Paste the Apps Script Web App URL first.');
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, normalized);
    setStoredUrl(normalized);
    setInputUrl(normalized);
    setMessage('Dashboard URL saved in this browser.');
  }

  function clearUrl() {
    window.localStorage.removeItem(STORAGE_KEY);
    setStoredUrl('');
    setInputUrl(envUrl);
    setMessage(envUrl ? 'Using Cloudflare environment URL.' : 'Saved URL cleared.');
  }

  function openDashboard() {
    if (!dashboardUrl) {
      setMessage('Add the Apps Script Web App URL first.');
      return;
    }
    window.open(dashboardUrl, '_blank', 'noopener,noreferrer');
  }

  function openHealth() {
    if (!dashboardUrl) {
      setMessage('Add the Apps Script Web App URL first.');
      return;
    }
    window.open(addQuery(dashboardUrl, 'format=json'), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="brand-mark">CX</div>
        <div>
          <p className="eyebrow">CX Experts Reporting</p>
          <h1>Productivity Dashboard Gateway</h1>
        </div>
        <span className={isReady ? 'status ready' : 'status setup'}>
          {isReady ? 'Ready' : 'Setup needed'}
        </span>
      </header>

      <main className="layout">
        <section className="workspace">
          <div className="hero-panel">
            <div>
              <p className="eyebrow">Cloudflare Pages entry point</p>
              <h2>Use your free Pages URL while Apps Script keeps running the reporting engine.</h2>
              <p className="copy">
                This static app is safe to deploy on Cloudflare. It does not contain API keys. It points users to the
                Apps Script dashboard that reads Google Sheets, runs source syncs, and generates AI insight.
              </p>
            </div>
            <div className="action-row">
              <button className="primary" onClick={openDashboard} disabled={!isReady}>
                <ExternalLink size={18} />
                Open Dashboard
              </button>
              <button className="secondary" onClick={openHealth} disabled={!isReady}>
                <Gauge size={18} />
                Health Check
              </button>
            </div>
          </div>

          <section className="config-panel" aria-label="Dashboard URL setup">
            <label htmlFor="apps-script-url">Apps Script Web App URL</label>
            <div className="input-row">
              <input
                id="apps-script-url"
                value={inputUrl}
                onChange={(event) => setInputUrl(event.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
              />
              <button className="secondary" onClick={saveUrl}>
                <LinkIcon size={18} />
                Save
              </button>
              <button className="ghost" onClick={clearUrl}>
                Clear
              </button>
            </div>
            <p className="hint">
              For production, set Cloudflare Pages environment variable <code>VITE_APPS_SCRIPT_WEB_APP_URL</code>.
              Browser save is useful while testing.
            </p>
            {message && <p className="message">{message}</p>}
          </section>

          <section className="preview-panel" aria-label="Embedded dashboard preview">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Preview</p>
                <h3>Embedded Apps Script Dashboard</h3>
              </div>
              <span>{isReady ? 'Configured' : 'Waiting for URL'}</span>
            </div>
            {isReady ? (
              <iframe src={dashboardUrl} title="Apps Script dashboard preview" loading="lazy" />
            ) : (
              <div className="empty-preview">
                <TableProperties size={42} />
                <p>Paste your deployed Apps Script Web App URL to preview the dashboard here.</p>
              </div>
            )}
          </section>
        </section>

        <aside className="side-panel">
          <InfoBlock
            icon={<ShieldCheck size={20} />}
            title="No secrets in Cloudflare"
            text="Groq, Zendesk, and Sheet credentials stay inside Apps Script Script Properties."
          />
          <InfoBlock
            icon={<RefreshCw size={20} />}
            title="Auto-deploy ready"
            text="Cloudflare Pages rebuilds this frontend whenever you push to main."
          />
          <InfoBlock
            icon={<Sparkles size={20} />}
            title="AI stays server-side"
            text="AI insight still uses compact aggregates from Apps Script, not raw full sheets."
          />

          <div className="checklist">
            <h3>Cloudflare Settings</h3>
            <CheckItem label="Root directory" value="local-control-app" />
            <CheckItem label="Build command" value="npm run build" />
            <CheckItem label="Build output" value="dist" />
            <CheckItem label="Production branch" value="main" />
            <CheckItem label="Free URL" value="project-name.pages.dev" />
          </div>

          <div className="metric-grid">
            <MiniMetric icon={<Activity size={18} />} label="Backend" value="Apps Script" />
            <MiniMetric icon={<BarChart3 size={18} />} label="Warehouse" value="Sheets" />
            <MiniMetric icon={<KeyRound size={18} />} label="Secrets" value="Script Props" />
          </div>
        </aside>
      </main>
    </div>
  );
}

function InfoBlock({ icon, title, text }) {
  return (
    <div className="info-block">
      <div className="info-icon">{icon}</div>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </div>
  );
}

function CheckItem({ label, value }) {
  return (
    <div className="check-item">
      <CheckCircle2 size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniMetric({ icon, label, value }) {
  return (
    <div className="mini-metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  return text.replace(/\s/g, '');
}

function addQuery(url, query) {
  if (!url) return '';
  return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
}

createRoot(document.getElementById('root')).render(<App />);
