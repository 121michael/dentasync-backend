import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/UI";
import { AdminStatCard } from "../components/AdminUI";

export function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

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

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading dashboard data…" />;

  const metrics = data.metrics;

  return (
    <div className="admin-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="admin-welcome-card">
        <div>
          <span className="eyebrow eyebrow--light">Welcome back</span>
          <h2>Welcome Back, Administrator</h2>
          <p>
            Your centralized command node is ready. All clinic arrays, user permissions, AI diagnostic
            parameters, and schedule matrices are operating at optimal capacity.
          </p>
        </div>
        <div className="admin-welcome-card__actions">
          <Link className="button button--light" to="/admin/users"><Users size={16} /> Audit Accounts</Link>
          <Link className="button button--light" to="/admin/analytics"><BarChart3 size={16} /> View General Analytics</Link>
          <button className="button button--light" onClick={load}><RefreshCw size={16} /> Refresh</button>
        </div>
      </section>

      <section className="admin-stat-grid">
        <AdminStatCard label="Total Registered Users" value={metrics.totalUsers} tone="purple" />
        <AdminStatCard label="Active Patients" value={metrics.activePatients ?? metrics.totalPatients} tone="violet" />
        <AdminStatCard label="Active Dentists" value={metrics.activeDentists} tone="emerald" />
        <AdminStatCard label="Active Staff" value={metrics.activeStaff} tone="amber" />
        <AdminStatCard label="Pending Account Approvals" value={metrics.pendingAccountApprovals} tone="amber" />
        <AdminStatCard label="Today's Appointments" value={metrics.appointmentsToday} tone="violet" />
        <AdminStatCard label="Patients In Queue" value={metrics.patientsInQueue} tone="purple" />
        <AdminStatCard label="Completed Appointments" value={metrics.completedToday} tone="emerald" />
        <AdminStatCard label="Archived Records" value={metrics.archivedRecords} tone="amber" />
        <AdminStatCard
          label="System Status"
          value={data.systemStatus === "online" ? "Online" : "Offline"}
          detail={data.systemStatus === "online" ? "Core infrastructure healthy" : "Database unreachable"}
          tone={data.systemStatus === "online" ? "emerald" : "danger"}
        />
      </section>
    </div>
  );
}
