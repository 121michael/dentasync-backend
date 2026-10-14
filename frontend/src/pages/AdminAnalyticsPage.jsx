import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleCheck, Clock3, Download, UsersRound } from "lucide-react";
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

  async function exportReport() {
    try {
      await api.downloadAdminExport("appointments");
      pushToast("Analytics report exported successfully.");
    } catch (exportError) {
      pushToast(exportError.message, "error");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data && range !== "custom") return <LoadingState label="Loading analytics…" />;
  if (!data) return <LoadingState label="Select a custom date range…" />;

  const summary = data.summary || {};

  const dentistMax = Math.max(1, ...(data.dentistPerformance || []).map((entry) => Number(entry.completed || 0)));

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
            <button className="button button--secondary" onClick={exportReport}><Download size={16} /> Export Report</button>
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
    </div>
  );
}
