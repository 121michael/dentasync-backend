import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { AdminBarChart, AdminDonutChart } from "../components/AdminUI";
import { currencyPHP } from "../adminUtils";

export function AdminAnalyticsPage() {
  const [range, setRange] = useState("month");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminAnalytics(range));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

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

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading analytics…" />;

  const revenueTotal = data.revenueByPeriod.reduce((sum, point) => sum + Number(point.value || 0), 0);

  return (
    <div className="admin-page">
      <SectionHeading
        eyebrow="Clinic intelligence"
        title="Reports / Analytics"
        detail="Revenue, appointments, patient growth, and dentist performance from live clinic data."
        action={
          <select className="admin-range-select" value={range} onChange={(event) => setRange(event.target.value)}>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
          </select>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Revenue overview</span>
            <h2>Completed Visit Revenue</h2>
            <p>Estimated completed appointment value for the selected range: <strong>{currencyPHP(revenueTotal)}</strong></p>
          </div>
        </div>
      </section>

      <div className="admin-analytics-grid">
        <AdminBarChart title="Revenue Over Time" points={data.revenueByPeriod} />
        <AdminDonutChart title="Appointment Analytics" segments={segments} />
        <AdminBarChart title="Patient Growth" points={data.patientGrowth} valueKey="count" />
        <section className="admin-chart-card">
          <div className="admin-panel__heading">
            <div>
              <span className="eyebrow">Dentist performance</span>
              <h2>Completed vs Total Bookings</h2>
            </div>
          </div>
          <div className="admin-history-list">
            {data.dentistPerformance.length ? data.dentistPerformance.map((entry) => (
              <article key={entry.dentist}>
                <div>
                  <strong>{entry.dentist}</strong>
                  <small>{entry.completed} completed · {entry.total} total</small>
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
