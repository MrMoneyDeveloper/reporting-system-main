import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Users
} from 'lucide-react';
import './styles.css';

const PERIOD_TYPES = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' }
];

const NAV_ITEMS = [
  { key: 'overview', label: 'Overview' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'agent', label: 'Agent Drilldown' },
  { key: 'risk', label: 'Risk Flags' },
  { key: 'wfm', label: 'WFM Balance' },
  { key: 'sync', label: 'Sync Status' }
];

const SHIFT_ORDER = ['Day', 'Mid', 'Night'];
const DEFAULT_FILTERS = {
  periodType: 'daily',
  periodKey: '',
  agentEmail: '',
  shift: ''
};
const API_BASE_URL = String(import.meta.env.VITE_DASHBOARD_API_BASE_URL || '/api').replace(/\/+$/, '');

function App() {
  const [activeView, setActiveView] = useState('overview');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [bootstrap, setBootstrap] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [insight, setInsight] = useState('');
  const [loading, setLoading] = useState({
    bootstrap: true,
    metrics: false,
    insight: false,
    hardRefresh: false,
    sync: false
  });
  const [error, setError] = useState('');
  const [visibleRows, setVisibleRows] = useState(12);

  useEffect(() => {
    loadBootstrap();
    loadSyncStatus();
  }, []);

  useEffect(() => {
    if (!bootstrap) return;
    const periods = getPeriods(bootstrap, filters.periodType);
    if (!filters.periodKey && periods.length) {
      setFilters((current) => ({ ...current, periodKey: periods[periods.length - 1] }));
    }
  }, [bootstrap, filters.periodType, filters.periodKey]);

  useEffect(() => {
    if (!bootstrap) return;
    loadMetrics();
  }, [bootstrap, filters.periodType, filters.periodKey, filters.agentEmail, filters.shift]);

  const agents = useMemo(() => {
    return (bootstrap?.agents || []).slice().sort((left, right) => {
      return String(left.name || left.email).localeCompare(String(right.name || right.email));
    });
  }, [bootstrap]);

  const periods = useMemo(() => getPeriods(bootstrap, filters.periodType), [bootstrap, filters.periodType]);
  const currentFilters = metrics?.filters || filters;
  const freshness = metrics?.freshness || {};
  const rows = metrics?.rows || [];
  const shiftSummary = useMemo(() => normalizeShiftSummary(metrics?.charts?.shiftSummary || [], rows), [metrics, rows]);
  const groupedRows = useMemo(() => groupRowsByShift(rows), [rows]);
  const pagedRows = rows.slice(0, visibleRows);

  async function loadBootstrap() {
    setLoading((current) => ({ ...current, bootstrap: true }));
    setError('');
    try {
      const data = await fetchJson(apiUrl('/bootstrap'));
      setBootstrap(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading((current) => ({ ...current, bootstrap: false }));
    }
  }

  async function loadMetrics() {
    setLoading((current) => ({ ...current, metrics: true }));
    setError('');
    setVisibleRows(12);
    try {
      const query = new URLSearchParams(cleanFilters(filters)).toString();
      const data = await fetchJson(apiUrl(`/metrics?${query}`));
      setMetrics(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading((current) => ({ ...current, metrics: false }));
    }
  }

  async function loadSyncStatus() {
    setLoading((current) => ({ ...current, sync: true }));
    try {
      const data = await fetchJson(apiUrl('/sync-status'));
      setSyncStatus(data);
    } catch (requestError) {
      setSyncStatus({ status: 'ERROR', message: requestError.message });
    } finally {
      setLoading((current) => ({ ...current, sync: false }));
    }
  }

  async function loadInsight() {
    setLoading((current) => ({ ...current, insight: true }));
    setInsight('');
    try {
      const data = await fetchJson(apiUrl('/insight'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: cleanFilters(currentFilters) })
      });
      setInsight(data.insight || 'No insight returned for this period.');
    } catch (requestError) {
      setInsight(`Insight failed: ${requestError.message}`);
    } finally {
      setLoading((current) => ({ ...current, insight: false }));
    }
  }

  async function hardRefresh() {
    setLoading((current) => ({ ...current, hardRefresh: true }));
    setError('');
    try {
      await fetchJson(apiUrl('/hard-refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: cleanFilters(currentFilters) })
      });
      await Promise.all([loadSyncStatus(), loadMetrics()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading((current) => ({ ...current, hardRefresh: false }));
    }
  }

  function changePeriodType(periodType) {
    const nextPeriods = getPeriods(bootstrap, periodType);
    setFilters((current) => ({
      ...current,
      periodType,
      periodKey: nextPeriods.length ? nextPeriods[nextPeriods.length - 1] : ''
    }));
    if (periodType === 'daily' || periodType === 'weekly' || periodType === 'monthly') {
      setActiveView(periodType);
    }
  }

  function openCsvExport() {
    const query = new URLSearchParams(cleanFilters(currentFilters)).toString();
    window.location.href = apiUrl(`/export.csv?${query}`);
  }

  if (loading.bootstrap) {
    return <LoadingScreen />;
  }

  if (error && !bootstrap && !metrics) {
    return <SetupScreen message={error} onRetry={loadBootstrap} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">CX</div>
          <div>
            <p className="eyebrow">CX Experts Reporting</p>
            <h1>Productivity Dashboard</h1>
          </div>
        </div>
        <div className="top-actions">
          <button className="btn btn-outline-secondary action-btn" onClick={loadSyncStatus}>
            <Gauge size={17} />
            Status
          </button>
          <button className="btn btn-outline-primary action-btn" onClick={openCsvExport} disabled={!metrics}>
            <Download size={17} />
            Export CSV
          </button>
          <button className="btn btn-primary action-btn" onClick={hardRefresh} disabled={loading.hardRefresh}>
            {loading.hardRefresh ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
            Hard Refresh
          </button>
        </div>
      </header>

      <nav className="nav-strip" aria-label="Dashboard sections">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={activeView === item.key ? 'nav-pill active' : 'nav-pill'}
            onClick={() => {
              setActiveView(item.key);
              if (item.key === 'daily' || item.key === 'weekly' || item.key === 'monthly') {
                changePeriodType(item.key);
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="dashboard-grid">
        <section className="main-column">
          <FilterBar
            filters={filters}
            periods={periods}
            agents={agents}
            onPeriodTypeChange={changePeriodType}
            onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
          />

          {error && <AlertBanner message={error} onClose={() => setError('')} />}

          <FreshnessBar freshness={freshness} cache={metrics?.cache} proxy={metrics?.proxy} />

          {loading.metrics ? (
            <Panel>
              <InlineLoading label="Loading dashboard metrics" />
            </Panel>
          ) : (
            <>
              {(activeView === 'overview' || activeView === 'daily' || activeView === 'weekly' || activeView === 'monthly') && (
                <>
                  <KpiGrid metrics={metrics} periodType={currentFilters.periodType} />
                  <ShiftComparison shiftSummary={shiftSummary} />
                  <ChartRow metrics={metrics} periodType={currentFilters.periodType} />
                  <ShiftTicketOutput groupedRows={groupedRows} />
                </>
              )}

              {activeView === 'agent' && (
                <AgentDrilldown rows={rows} drilldown={metrics?.agentDrilldown || []} agents={agents} filters={filters} />
              )}

              {activeView === 'risk' && (
                <RiskFlags risks={metrics?.risks || []} />
              )}

              {activeView === 'wfm' && (
                <WfmBalance rows={rows} periodType={currentFilters.periodType} freshness={freshness} />
              )}

              {activeView === 'sync' && (
                <SyncStatusPanel syncStatus={syncStatus} loading={loading.sync} onRefresh={loadSyncStatus} />
              )}

              <Panel title="Detailed Rows" icon={<TableProperties size={18} />}>
                <MetricTable rows={pagedRows} periodType={currentFilters.periodType} />
                {rows.length > visibleRows && (
                  <div className="table-footer">
                    <button className="btn btn-outline-secondary" onClick={() => setVisibleRows((current) => current + 12)}>
                      Show more rows
                    </button>
                    <span>{visibleRows} of {rows.length} visible</span>
                  </div>
                )}
              </Panel>
            </>
          )}
        </section>

        <aside className="insight-column">
          <Panel title="AI Insight" icon={<Bot size={18} />}>
            <p className="muted">
              Uses compact dashboard aggregates, top and bottom samples, risk rows, and freshness checks.
            </p>
            <button className="btn btn-dark w-100 action-btn" onClick={loadInsight} disabled={loading.insight || !metrics}>
              {loading.insight ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
              Generate Insight
            </button>
            <div className="insight-box">
              {insight ? <InsightText text={insight} /> : <span>Run insight after choosing a period.</span>}
            </div>
          </Panel>

          <Panel title="Sync Freshness" icon={<Clock3 size={18} />}>
            <FreshnessList freshness={freshness} syncStatus={syncStatus} />
          </Panel>

          <Panel title="Quick Checks" icon={<ShieldCheck size={18} />}>
            <CheckLine label="Metrics loaded" ok={Boolean(metrics?.rows)} value={`${rows.length} rows`} />
            <CheckLine label="WFM upload" ok={Boolean(freshness.latestWfmImport)} value={freshness.latestWfmImport || 'Missing'} />
            <CheckLine label="Source sync" ok={Boolean(freshness.lastSourceSync)} value={freshness.lastSourceSync || 'Not seen'} />
            <CheckLine label="Analytics refresh" ok={Boolean(freshness.lastAnalyticsRefresh)} value={freshness.lastAnalyticsRefresh || 'Not seen'} />
          </Panel>
        </aside>
      </main>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="center-screen">
      <Loader2 className="spin" size={34} />
      <h1>Loading CX Experts dashboard</h1>
      <p>Connecting to the reporting engine and loading the latest analytics tables.</p>
    </div>
  );
}

function SetupScreen({ message, onRetry }) {
  return (
    <div className="center-screen setup-screen">
      <div className="brand-mark">CX</div>
      <h1>Dashboard API unavailable</h1>
      <p>{message}</p>
      <div className="setup-card">
        <h2>Project-coded connection</h2>
        <p className="muted">
          This dashboard uses the repository API bridge under <code>/api</code> to read Apps Script and Google Sheets data. Redeploy the latest project build if this screen appears after a code update.
        </p>
      </div>
      <button className="btn btn-primary action-btn" onClick={onRetry}>
        <RefreshCw size={17} />
        Try Again
      </button>
    </div>
  );
}

function FilterBar({ filters, periods, agents, onPeriodTypeChange, onChange }) {
  return (
    <section className="filter-bar">
      <div className="segmented-control">
        {PERIOD_TYPES.map((period) => (
          <button
            key={period.key}
            className={filters.periodType === period.key ? 'segment active' : 'segment'}
            onClick={() => onPeriodTypeChange(period.key)}
          >
            {period.label}
          </button>
        ))}
      </div>
      <label>
        <span>Period</span>
        <select value={filters.periodKey} onChange={(event) => onChange({ periodKey: event.target.value })}>
          <option value="">Latest available</option>
          {periods.map((period) => <option key={period} value={period}>{period}</option>)}
        </select>
      </label>
      <label>
        <span>Shift</span>
        <select value={filters.shift} onChange={(event) => onChange({ shift: event.target.value })}>
          <option value="">All shifts</option>
          {SHIFT_ORDER.map((shift) => <option key={shift} value={shift}>{shift}</option>)}
        </select>
      </label>
      <label>
        <span>Agent</span>
        <select value={filters.agentEmail} onChange={(event) => onChange({ agentEmail: event.target.value })}>
          <option value="">All agents</option>
          {agents.map((agent) => (
            <option key={agent.email} value={agent.email}>{agent.name || agent.email}</option>
          ))}
        </select>
      </label>
    </section>
  );
}

function AlertBanner({ message, onClose }) {
  return (
    <div className="alert-banner">
      <AlertTriangle size={18} />
      <span>{message}</span>
      <button onClick={onClose}>Dismiss</button>
    </div>
  );
}

function FreshnessBar({ freshness, cache, proxy }) {
  return (
    <section className="freshness-bar">
      <FreshnessPill label="Last source sync" value={freshness.lastSourceSync || 'Not available'} />
      <FreshnessPill label="Analytics refresh" value={freshness.lastAnalyticsRefresh || 'Not available'} />
      <FreshnessPill label="Latest WFM upload" value={freshness.latestWfmImport || 'Not uploaded'} />
      <FreshnessPill label="Cache" value={cache?.hit ? `Hit ${cache.servedAt || ''}` : `Generated ${cache?.generatedAt || proxy?.generatedAt || ''}`} />
    </section>
  );
}

function FreshnessPill({ label, value }) {
  return (
    <div className="freshness-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function KpiGrid({ metrics, periodType }) {
  const kpis = metrics?.kpis || {};
  return (
    <section className="kpi-grid">
      <KpiCard icon={<Users size={20} />} label="Agents Reviewed" value={formatNumber(kpis.agents || 0, 0)} note="Current filtered period" />
      <KpiCard icon={<CheckCircle2 size={20} />} label="Attendance" value={formatRatioPercent(kpis.attendancePercent)} note="Average attendance" />
      <KpiCard icon={<BarChart3 size={20} />} label="Tickets Solved" value={formatNumber(kpis.ticketsSolved || 0, 0)} note="Zendesk solved count" />
      <KpiCard icon={<Layers3 size={20} />} label="Commented Tickets" value={formatNumber(kpis.commentedTickets || 0, 0)} note="Unique note/reply activity" />
      <KpiCard icon={<Search size={20} />} label="In Progress" value={formatNumber(kpis.inProgressTickets || 0, 0)} note="Open tickets with notes" />
      <KpiCard icon={<AlertTriangle size={20} />} label="Review Flags" value={formatNumber(kpis.riskCount || 0, 0)} note="Missing data or risk rows" />
      <KpiCard icon={<Clock3 size={20} />} label="WFM Outstanding" value={periodType === 'monthly' ? `${formatNumber(kpis.wfmOutstandingHours || 0)}h` : 'Monthly only'} note="Manual WFM balance" />
    </section>
  );
}

function KpiCard({ icon, label, value, note }) {
  return (
    <article className="kpi-card">
      <div className="kpi-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function ShiftComparison({ shiftSummary }) {
  return (
    <Panel title="Shift Comparison" icon={<CalendarDays size={18} />}>
      <div className="shift-grid">
        {shiftSummary.map((shift) => (
          <div key={shift.label} className="shift-card">
            <div>
              <span>{shift.label} Shift</span>
              <strong>{formatNumber(shift.tickets || 0, 0)} tickets solved</strong>
            </div>
            <div className="mini-bars">
              <MetricBar label="Attendance" value={shift.attendance || 0} max={100} suffix="%" />
              <MetricBar label="Commented" value={shift.commentedTickets || 0} max={maxValue(shiftSummary, 'commentedTickets')} />
            </div>
            <p>{formatNumber(shift.agents || 0, 0)} agents reviewed, {formatNumber(shift.commentedTickets || 0, 0)} commented, {formatNumber(shift.inProgressTickets || 0, 0)} in progress</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ChartRow({ metrics, periodType }) {
  const topRows = metrics?.charts?.attendanceVsTickets || [];
  const wfmRows = metrics?.charts?.wfmBalance || [];
  return (
    <div className="chart-row">
      <Panel title="Attendance vs Tickets" icon={<BarChart3 size={18} />}>
        <HorizontalBarList rows={topRows.map((row) => ({
          label: row.label,
          value: row.tickets || 0,
          subValue: row.attendance === null ? 'No attendance' : `${formatNumber(row.attendance)}% attendance`
        }))} empty="No Zendesk trend rows for this period." />
      </Panel>
      <Panel title="Tickets vs WFM" icon={<Clock3 size={18} />}>
        {periodType === 'monthly' ? (
          <HorizontalBarList rows={wfmRows.map((row) => ({
            label: row.label,
            value: row.outstanding || 0,
            subValue: `${formatNumber(row.surplus || 0)}h surplus`
          }))} empty="No outstanding WFM balances for this month." />
        ) : (
          <div className="empty-state">WFM is monthly only. Daily and weekly views stay ticket and attendance based.</div>
        )}
      </Panel>
    </div>
  );
}

function ShiftTicketOutput({ groupedRows }) {
  return (
    <Panel title="Zendesk Ticket Output By Shift" icon={<Search size={18} />}>
      <div className="shift-sections">
        {SHIFT_ORDER.map((shift) => (
          <section key={shift} className="shift-section">
            <div className="shift-section-heading">
              <h3>{shift} Shift</h3>
              <span>{groupedRows[shift]?.length || 0} agents</span>
            </div>
            <CompactRows rows={groupedRows[shift] || []} type="zendesk" />
          </section>
        ))}
        {Object.keys(groupedRows).filter((shift) => !SHIFT_ORDER.includes(shift)).map((shift) => (
          <section key={shift} className="shift-section">
            <div className="shift-section-heading">
              <h3>{shift}</h3>
              <span>{groupedRows[shift].length} agents</span>
            </div>
            <CompactRows rows={groupedRows[shift]} type="zendesk" />
          </section>
        ))}
      </div>
    </Panel>
  );
}

function CompactRows({ rows, type }) {
  if (!rows.length) {
    return <div className="empty-state compact">No rows for this shift.</div>;
  }

  return (
    <div className="compact-table">
      {rows.slice(0, 8).map((row) => (
        <div key={`${row.agentEmail}-${row.period}-${type}`} className="compact-row">
          <span>{row.agentName || row.agentEmail}</span>
          <strong>{type === 'zendesk' ? `${row.ticketsSolved || 0} solved` : formatRatioPercent(row.attendancePercent)}</strong>
          {type === 'zendesk' && row.inProgressTickets ? (
            <TicketStatusBadge row={row} />
          ) : (
            <small>{type === 'zendesk' ? `${row.commentedTickets || 0} commented, ${row.productivityActions || 0} actions` : row.attendanceStatus || 'Missing'}</small>
          )}
        </div>
      ))}
    </div>
  );
}

function AgentDrilldown({ rows, drilldown, agents, filters }) {
  const selectedAgent = agents.find((agent) => agent.email === filters.agentEmail);
  const displayRows = filters.agentEmail ? drilldown : rows.slice().sort((left, right) => {
    return Number(right.productivityActions || 0) - Number(left.productivityActions || 0);
  }).slice(0, 15);

  return (
    <Panel title="Agent Drilldown" icon={<Users size={18} />}>
      <p className="muted">
        {selectedAgent ? `Showing recent history for ${selectedAgent.name || selectedAgent.email}.` : 'Select an agent to see recent daily history. Current view shows top activity rows.'}
      </p>
      <MetricTable rows={displayRows} periodType="daily" compact />
    </Panel>
  );
}

function RiskFlags({ risks }) {
  return (
    <Panel title="Low Activity, Missing Data, And Risk Flags" icon={<AlertTriangle size={18} />}>
      {risks.length ? (
        <MetricTable rows={risks} compact />
      ) : (
        <div className="empty-state">No risk rows found for this filter.</div>
      )}
    </Panel>
  );
}

function WfmBalance({ rows, periodType, freshness }) {
  const wfmRows = rows.filter((row) => Number(row.wfmOutstandingHours || 0) > 0 || Number(row.wfmSurplusHours || 0) > 0);
  return (
    <Panel title="WFM Monthly Balance" icon={<Clock3 size={18} />}>
      <p className="muted">Latest WFM upload: {freshness.latestWfmImport || 'not uploaded yet'}.</p>
      {periodType !== 'monthly' && <div className="empty-state">Switch to Monthly to review WFM balance against attendance expectations.</div>}
      {periodType === 'monthly' && (wfmRows.length ? <MetricTable rows={wfmRows} periodType="monthly" compact /> : <div className="empty-state">No outstanding or surplus WFM balance rows for this month.</div>)}
    </Panel>
  );
}

function SyncStatusPanel({ syncStatus, loading, onRefresh }) {
  if (loading && !syncStatus) {
    return (
      <Panel title="Sync Status" icon={<Gauge size={18} />}>
        <InlineLoading label="Loading sync status" />
      </Panel>
    );
  }

  const source = syncStatus?.sourceSync || {};
  const analytics = syncStatus?.analytics || {};
  const triggers = syncStatus?.triggers || {};
  const missingTriggers = (triggers.expected || []).filter((handler) => !(triggers.present || []).includes(handler));

  return (
    <Panel title="Sync Status" icon={<Gauge size={18} />}>
      <button className="btn btn-outline-secondary action-btn mb-3" onClick={onRefresh}>
        <RefreshCw size={17} />
        Refresh Status
      </button>
      <div className="status-grid">
        <StatusBlock title="Source Sync" active={source.active} lines={[
          `Phase: ${source.phase || 'idle'}`,
          `Cursor: ${source.cursor || source.lastEndDate || 'none'}`,
          `Last completed: ${source.lastCompletedAt || 'not recorded'}`
        ]} />
        <StatusBlock title="Analytics" active={analytics.active} lines={[
          `Phase: ${analytics.phase || 'idle'}`,
          `Cursor: ${analytics.cursor || 'none'}`,
          `Last refreshed: ${analytics.lastRefreshedAt || 'not recorded'}`
        ]} />
        <StatusBlock title="Triggers" active={!missingTriggers.length} lines={[
          `Expected: ${(triggers.expected || []).length}`,
          `Present: ${(triggers.present || []).length}`,
          `Missing: ${missingTriggers.length ? missingTriggers.join(', ') : 'none'}`
        ]} />
      </div>
    </Panel>
  );
}

function StatusBlock({ title, active, lines }) {
  return (
    <div className="status-block">
      <div className={active ? 'status-dot good' : 'status-dot'} />
      <h3>{title}</h3>
      {lines.map((line) => <p key={line}>{line}</p>)}
    </div>
  );
}

function MetricTable({ rows, compact }) {
  if (!rows.length) {
    return <div className="empty-state">No rows for this filter.</div>;
  }

  return (
    <div className={compact ? 'table-wrap compact' : 'table-wrap'}>
      <table>
        <thead>
          <tr>
            <th>Shift</th>
            <th>Agent</th>
            <th>Attendance</th>
            <th>Solved</th>
            <th>Commented</th>
            <th>Actions</th>
            <th>Status</th>
            <th>Expected</th>
            <th>WFM Outstanding</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.period}-${row.agentEmail}-${row.shift}`}>
              <td>{row.shift || 'Unassigned'}</td>
              <td>
                <strong>{row.agentName || row.agentEmail}</strong>
                <span>{row.agentEmail}</span>
              </td>
              <td>{formatRatioPercent(row.attendancePercent)}</td>
              <td>{formatNumber(row.ticketsSolved || 0, 0)}</td>
              <td>{formatNumber(row.commentedTickets || 0, 0)}</td>
              <td>{formatNumber(row.productivityActions || 0, 0)}</td>
              <td><TicketStatusBadge row={row} /></td>
              <td>{formatNumber(row.expectedHours || 0)}h</td>
              <td>{row.wfmOutstandingHours === '' ? '' : `${formatNumber(row.wfmOutstandingHours)}h`}</td>
              <td>{row.openTicketNotes || row.notes || row.wfmNotes || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketStatusBadge({ row }) {
  const status = getTicketFollowUpStatus(row);
  return <span className={`status-badge ${statusClass(status)}`}>{status}</span>;
}

function HorizontalBarList({ rows, empty }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  if (!rows.length) {
    return <div className="empty-state">{empty}</div>;
  }

  return (
    <div className="bar-list">
      {rows.slice(0, 10).map((row) => (
        <div key={row.label} className="bar-row">
          <div className="bar-label">
            <span>{row.label}</span>
            <strong>{formatNumber(row.value)}</strong>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(4, (Number(row.value || 0) / max) * 100)}%` }} />
          </div>
          <small>{row.subValue}</small>
        </div>
      ))}
    </div>
  );
}

function MetricBar({ label, value, max, suffix }) {
  const safeMax = Math.max(1, Number(max || 0));
  const width = Math.max(4, Math.min(100, (Number(value || 0) / safeMax) * 100));
  return (
    <div className="metric-bar">
      <div>
        <span>{label}</span>
        <strong>{formatNumber(value)}{suffix || ''}</strong>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Panel({ title, icon, children }) {
  return (
    <section className="panel">
      {title && (
        <div className="panel-heading">
          <div className="panel-title">
            {icon}
            <h2>{title}</h2>
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

function InlineLoading({ label }) {
  return (
    <div className="inline-loading">
      <Loader2 className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

function FreshnessList({ freshness, syncStatus }) {
  return (
    <div className="freshness-list">
      <DetailLine label="Last source sync" value={freshness.lastSourceSync || syncStatus?.sourceSync?.lastCompletedAt || 'Not recorded'} />
      <DetailLine label="Last analytics refresh" value={freshness.lastAnalyticsRefresh || syncStatus?.analytics?.lastRefreshedAt || 'Not recorded'} />
      <DetailLine label="Latest WFM import" value={freshness.latestWfmImport || 'Not uploaded'} />
      <DetailLine label="Cache version" value={freshness.cacheVersion || syncStatus?.cacheVersion || 'Unknown'} />
    </div>
  );
}

function DetailLine({ label, value }) {
  return (
    <div className="detail-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CheckLine({ label, ok, value }) {
  return (
    <div className="check-line">
      <CheckCircle2 className={ok ? 'ok' : 'warn'} size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InsightText({ text }) {
  return (
    <div>
      {String(text).split('\n').filter(Boolean).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`API returned non-JSON HTTP ${response.status}.`);
  }

  if (!response.ok || data.status === 'ERROR') {
    throw new Error(data.message || `API returned HTTP ${response.status}.`);
  }

  return data;
}

function apiUrl(path) {
  const cleanPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  return `${API_BASE_URL}${cleanPath}`;
}

function getPeriods(bootstrap, periodType) {
  const values = bootstrap?.periods?.[periodType] || [];
  return values.slice().sort();
}

function cleanFilters(input) {
  return {
    periodType: input.periodType || 'daily',
    periodKey: input.periodKey || '',
    agentEmail: input.agentEmail || '',
    shift: input.shift || ''
  };
}

function normalizeShiftSummary(summary, rows) {
  const byShift = {};
  summary.forEach((item) => {
    byShift[item.label || 'Unassigned'] = { ...item };
  });

  rows.forEach((row) => {
    const shift = row.shift || 'Unassigned';
    if (!byShift[shift]) {
      byShift[shift] = { label: shift, agents: 0, attendance: null, tickets: 0, commentedTickets: 0, actions: 0, inProgressTickets: 0 };
    }
  });

  SHIFT_ORDER.forEach((shift) => {
    if (!byShift[shift]) {
      byShift[shift] = { label: shift, agents: 0, attendance: 0, tickets: 0, commentedTickets: 0, actions: 0, inProgressTickets: 0 };
    }
  });

  return Object.values(byShift).sort((left, right) => shiftRank(left.label) - shiftRank(right.label));
}

function groupRowsByShift(rows) {
  const output = {};
  rows.forEach((row) => {
    const shift = row.shift || 'Unassigned';
    if (!output[shift]) output[shift] = [];
    output[shift].push(row);
  });
  Object.keys(output).forEach((shift) => {
    output[shift].sort((left, right) => Number(right.productivityActions || 0) - Number(left.productivityActions || 0));
  });
  return output;
}

function shiftRank(value) {
  const normalized = String(value || '').toLowerCase();
  const index = SHIFT_ORDER.findIndex((shift) => shift.toLowerCase() === normalized);
  return index === -1 ? 99 : index;
}

function maxValue(rows, key) {
  return Math.max(1, ...rows.map((row) => Number(row[key] || 0)));
}

function getTicketFollowUpStatus(row) {
  if (row?.ticketFollowUpStatus) return row.ticketFollowUpStatus;
  if (Number(row?.inProgressTickets || 0) > 0) return 'In progress';
  return Number(row?.ticketsSolved || 0) > 0 || Number(row?.productivityActions || 0) > 0 ? 'Activity recorded' : 'No activity';
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('progress') || normalized.includes('review')) return 'warning';
  if (normalized.includes('no activity') || normalized.includes('no productivity')) return 'danger';
  return 'success';
}

function formatNumber(value, decimals = 1) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '';
  return number.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatRatioPercent(value) {
  if (value === '' || value === null || typeof value === 'undefined') return 'Missing';
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Missing';
  const percent = number <= 1 ? number * 100 : number;
  return `${formatNumber(percent)}%`;
}

createRoot(document.getElementById('root')).render(<App />);
