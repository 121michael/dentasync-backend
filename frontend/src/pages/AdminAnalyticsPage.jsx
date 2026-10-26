import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Clock3, Download, FileSpreadsheet, FileText, UsersRound } from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/UI";
import { AdminBarChart, AdminDonutChart, AdminLineChart, AdminStatCard } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { currencyPHP } from "../adminUtils";

export function AdminAnalyticsPage() {
  const { pushToast } = useAdminUi();
  const [range, setRange] = useState("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState("");
  const exportRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminAnalytics(range, range === "custom" ? { from, to } : {}));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [from, range, to]);

  useEffect(() => {
    if (range === "custom" && (!from || !to)) return;
    load();
  }, [load, range, from, to]);

  useEffect(() => {
    function onPointer(event) {
      if (!exportRef.current?.contains(event.target)) setExportOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  const segments = useMemo(() => {
    if (!data) return [];
    const breakdown = data.appointmentBreakdown;
    return [
      { label: "Completed", value: breakdown.completed, color: "#168567" },
      { label: "Pending", value: breakdown.pending, color: "#b86b13" },
      { label: "Confirmed", value: breakdown.confirmed, color: "#5b2a86" },
      { label: "Cancelled", value: breakdown.cancelled, color: "#bb4d64" },
      { label: "No Show", value: breakdown.no_show, color: "#8d57be" },
    ];
  }, [data]);

  const aiOutcomeSegments = useMemo(() => {
    const outcomes = data?.aiUsage?.outcomes;
    if (!outcomes) return [];
    return [
      { label: "Successful", value: outcomes.success || 0, color: "#168567" },
      { label: "Failed", value: outcomes.failed || 0, color: "#bb4d64" },
    ];
  }, [data]);

  async function exportReport(format) {
    setExporting(format);
    setExportOpen(false);
    try {
      await api.downloadAdminAnalyticsExport(format, range, range === "custom" ? { from, to } : {});
      pushToast(format === "pdf" ? "PDF report exported successfully." : "Excel report exported successfully.");
    } catch (exportError) {
      pushToast(exportError.message, "error");
    } finally {
      setExporting("");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data && range !== "custom") return <LoadingState label="Loading analytics…" />;
  if (!data) return <LoadingState label="Select a custom date range…" />;

  const summary = data.summary || {};
  const ai = data.aiUsage || {};
  const aiSummary = ai.summary || {};
  const dentistMax = Math.max(1, ...(data.dentistPerformance || []).map((entry) => Number(entry.completed || 0)));
  const busy = Boolean(exporting);

  return (
    <div className="admin-page admin-analytics-page">
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Management monitoring</span>
            <h2>General Operations Analytics</h2>
            <p>Revenue, satisfaction, volume, and queue performance generated from live clinic data.</p>
          </div>
          <div className="admin-heading-actions">
            <select className="admin-range-select" value={range} onChange={(event) => setRange(event.target.value)}>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
              <option value="custom">Custom Date Range</option>
            </select>
            {range === "custom" ? (
              <>
                <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </>
            ) : null}
            <div className="admin-export-menu" ref={exportRef}>
              <button
                className="button button--secondary"
                type="button"
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                disabled={busy}
                onClick={() => setExportOpen((open) => !open)}
              >
                <Download size={16} />
                {busy ? "Generating report…" : "Export Report"}
              </button>
              {exportOpen ? (
                <div className="admin-export-menu__panel" role="menu">
                  <button type="button" role="menuitem" disabled={busy} onClick={() => exportReport("pdf")}>
                    <FileText size={16} aria-hidden="true" />
                    <span>Export as PDF</span>
                  </button>
                  <button type="button" role="menuitem" disabled={busy} onClick={() => exportReport("xlsx")}>
                    <FileSpreadsheet size={16} aria-hidden="true" />
                    <span>Export as Excel (.xlsx)</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="admin-stat-grid">
        <AdminStatCard label="Total Clinic Revenue" value={currencyPHP(summary.totalRevenue)} tone="purple" />
        <AdminStatCard label="Patient Satisfaction" value={`${summary.patientSatisfaction ?? 0}%`} tone="emerald" />
        <AdminStatCard label="Total Appointments" value={summary.totalAppointments ?? 0} tone="violet" />
        <AdminStatCard label="Completed Appointments" value={summary.completedAppointments ?? 0} tone="emerald" />
        <AdminStatCard label="Cancelled Appointments" value={summary.cancelledAppointments ?? 0} tone="danger" />
        <AdminStatCard label="No-show Appointments" value={summary.noShowAppointments ?? 0} tone="amber" />
        <AdminStatCard label="Patient Growth" value={summary.patientGrowth ?? 0} tone="violet" />
        <AdminStatCard
          label="Queue Performance"
          value={`${summary.averageWaitMinutes ?? 0}m`}
          detail={`${summary.queueActive ?? 0} active · ${summary.queueCompleted ?? 0} completed`}
          tone="amber"
        />
      </section>

      <div className="admin-analytics-grid">
        <AdminBarChart
          title="Revenue Trends"
          eyebrow="Clinic revenue"
          points={data.revenueByPeriod}
          formatValue={currencyPHP}
        />
        <AdminDonutChart title="Appointment Status" segments={segments} />
        <AdminBarChart
          title="Patient Volume"
          eyebrow="Visit volume"
          points={data.patientVolume || []}
          valueKey="count"
        />
        <AdminLineChart title="Patient Growth" points={data.patientGrowth} valueKey="count" />
        <section className="admin-chart-card">
          <div className="admin-panel__heading">
            <div>
              <span className="eyebrow">Queue performance</span>
              <h2>Waiting Room Efficiency</h2>
            </div>
          </div>
          <div className="admin-analytics-kpis">
            <article>
              <UsersRound size={18} aria-hidden="true" />
              <span>Active Queue</span>
              <strong>{data.queuePerformance?.active ?? 0}</strong>
            </article>
            <article>
              <CircleCheck size={18} aria-hidden="true" />
              <span>Completed Queue</span>
              <strong>{data.queuePerformance?.completed ?? 0}</strong>
            </article>
            <article>
              <Clock3 size={18} aria-hidden="true" />
              <span>Average Wait (Minutes)</span>
              <strong>{data.queuePerformance?.averageWaitMinutes ?? 0}</strong>
            </article>
          </div>
        </section>
        <section className="admin-chart-card">
          <div className="admin-panel__heading">
            <div>
              <span className="eyebrow">Monthly clinic activity</span>
              <h2>Dentist Completion Load</h2>
            </div>
          </div>
          <div className="admin-dentist-load">
            {data.dentistPerformance.length ? data.dentistPerformance.map((entry) => (
              <article key={entry.dentist}>
                <div className="admin-dentist-load__meta">
                  <strong>{entry.dentist}</strong>
                  <small>{entry.completed} completed · {entry.total} total</small>
                </div>
                <div className="admin-dentist-load__bar" aria-hidden="true">
                  <span style={{ width: `${Math.round((Number(entry.completed || 0) / dentistMax) * 100)}%` }} />
                </div>
                <span className="admin-count-chip">{entry.completed}</span>
              </article>
            )) : <p className="muted-copy">No dentist performance data for this range.</p>}
          </div>
        </section>
      </div>

      <section className="admin-panel admin-ai-usage">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Provider usage</span>
            <h2>AI Usage</h2>
            <p>
              Recorded Gemini requests for {ai.periodLabel || data.periodLabel}. Clinic catalog
              answers that never call Gemini are not counted. If Gemini is unavailable and the
              assistant still replies from the clinic FAQ, that turn is counted as successful.
              {ai.trackingStartedAt
                ? ` Complete tracking began ${new Date(ai.trackingStartedAt).toLocaleString()}. Earlier requests are not included.`
                : " No AI requests have been recorded yet."}
              {!ai.trackingAvailable ? " Usage tracking is not installed on this database yet." : ""}
            </p>
          </div>
        </div>

        <section className="admin-stat-grid admin-ai-usage__stats">
          <AdminStatCard label="Total AI Requests" value={aiSummary.totalRequests ?? 0} tone="purple" />
          <AdminStatCard label="Successful AI Requests" value={aiSummary.successfulRequests ?? 0} tone="emerald" />
          <AdminStatCard label="Failed AI Requests" value={aiSummary.failedRequests ?? 0} tone="danger" />
          <AdminStatCard label="Active AI Users" value={aiSummary.activeUsers ?? 0} tone="violet" />
          {aiSummary.tokensAvailable ? (
            <>
              <AdminStatCard label="Input tokens used" value={aiSummary.inputTokens ?? 0} tone="violet" />
              <AdminStatCard label="Output tokens used" value={aiSummary.outputTokens ?? 0} tone="purple" />
              <AdminStatCard label="Total tokens used" value={aiSummary.totalTokens ?? 0} tone="amber" />
            </>
          ) : (
            <AdminStatCard
              label="Token usage"
              value="—"
              detail="Not reported by the provider for recorded requests"
              tone="amber"
            />
          )}
          {aiSummary.costAvailable ? (
            <AdminStatCard
              label="Estimated AI API cost"
              value={`$${aiSummary.estimatedCostUsd}`}
              detail="From configured per-million token rates"
              tone="purple"
            />
          ) : null}
        </section>

        <div className="admin-analytics-grid">
          <AdminLineChart
            title="AI Requests Over Time"
            eyebrow={ai.periodLabel || "Selected period"}
            points={ai.requestsOverTime || []}
            valueKey="count"
          />
          <AdminDonutChart title="AI Request Outcomes" segments={aiOutcomeSegments} />
          {(ai.byFeature || []).length ? (
            <AdminBarChart
              title="AI Usage by Feature"
              eyebrow="Verified AI functions"
              points={ai.byFeature}
              valueKey="count"
              labelKey="label"
            />
          ) : null}
          {(ai.tokensOverTime || []).length ? (
            <AdminLineChart
              title="Token Usage Over Time"
              eyebrow="Provider-reported tokens"
              points={ai.tokensOverTime.map((point) => ({ label: point.label, count: point.total ?? 0 }))}
              valueKey="count"
            />
          ) : null}
          {(ai.byRole || []).length ? (
            <AdminBarChart
              title="AI Usage by User Role"
              eyebrow="Authenticated users"
              points={ai.byRole.map((item) => ({
                label: item.role,
                count: item.count,
              }))}
              valueKey="count"
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
