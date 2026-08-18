import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Shield, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { AdminStatCard } from "../components/AdminUI";

export function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminDashboard());
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function exportOverview() {
    setExporting(true);
    try {
      await api.downloadAdminExport("accounts");
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setExporting(false);
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading dashboard data…" />;

  const metrics = data.metrics;

  return (
    <div className="admin-page">
      <SectionHeading
        eyebrow="Clinic command center"
        title="Admin Dashboard"
        detail={new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(new Date(data.date))}
        action={
          <div className="admin-heading-actions">
            <button className="button button--secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
            <button className="button button--primary" onClick={exportOverview} disabled={exporting}>
              <Download size={16} /> {exporting ? "Exporting…" : "Export"}
            </button>
          </div>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="admin-welcome-card">
        <div>
          <span className="eyebrow eyebrow--light">Welcome back</span>
          <h2>Welcome Back, {data.welcomeName}</h2>
          <p>Manage your clinic operations, users, appointments, and system activity from one place.</p>
        </div>
        <div className="admin-welcome-card__actions">
          <Link className="button button--light" to="/admin/staff"><Users size={16} /> Manage Users</Link>
          <Link className="button button--light" to="/admin/analytics"><Shield size={16} /> View Reports</Link>
        </div>
      </section>

      <section className="admin-stat-grid">
        <AdminStatCard label="Total Patients" value={metrics.totalPatients} detail={`+${metrics.monthGrowth}% this month`} tone="purple" />
        <AdminStatCard label="Appointments Today" value={metrics.appointmentsToday} tone="violet" />
        <AdminStatCard label="Active Dentists" value={metrics.activeDentists} tone="emerald" />
        <AdminStatCard label="Staff Members" value={metrics.activeStaff} tone="amber" />
        <AdminStatCard label="Pending Requests" value={metrics.pendingRequests} tone="amber" />
        <AdminStatCard label="System Alerts" value={metrics.systemAlerts} tone="danger" />
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Management overview</span>
            <h2>Clinic Operations Snapshot</h2>
            <p>Live counts from registered accounts and today’s appointment activity.</p>
          </div>
        </div>
        <div className="admin-overview-grid">
          <article><span>Total patients</span><strong>{metrics.totalPatients}</strong></article>
          <article><span>Active staff</span><strong>{metrics.activeStaff}</strong></article>
          <article><span>Active dentists</span><strong>{metrics.activeDentists}</strong></article>
          <article><span>Today&apos;s appointments</span><strong>{metrics.appointmentsToday}</strong></article>
          <article><span>Pending appointment requests</span><strong>{metrics.pendingRequests}</strong></article>
          <article><span>Completed appointments</span><strong>{metrics.completedToday}</strong></article>
          <article><span>Cancelled / no-show</span><strong>{metrics.cancelledToday}</strong></article>
        </div>
      </section>
    </div>
  );
}
