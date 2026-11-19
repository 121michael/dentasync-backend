import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminStatCard } from "../components/AdminUI";
import { DashboardSchedulePreview } from "../components/DashboardSchedulePreview";

const BRANCH_KEY = "dentasync.adminDashboardBranchId";

export function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [branchId, setBranchId] = useState(() => sessionStorage.getItem(BRANCH_KEY) || "all");

  const load = useCallback(async () => {
    try {
      setData(
        await api.getAdminDashboard({
          query: { branchId: branchId && branchId !== "all" ? branchId : undefined },
        })
      );
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  function onBranchChange(event) {
    const next = event.target.value || "all";
    setBranchId(next);
    if (next === "all") sessionStorage.removeItem(BRANCH_KEY);
    else sessionStorage.setItem(BRANCH_KEY, next);
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading dashboard data…" />;

  const metrics = data.metrics;
  const clinicDate = data.clinicDate || data.date;
  const timezone = data.timezone || "Asia/Manila";
  const branchName = data.selectedBranch?.name || "All branches";
  const timeframe = `Today · ${clinicDate} (${timezone})`;
  const availability = data.dentistAvailability?.dentists || [];

  return (
    <div className="admin-page admin-dashboard-page ops-dashboard-clearance">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="admin-welcome-card">
        <div>
          <span className="eyebrow eyebrow--light">Welcome back</span>
          <h2>Welcome Back, Administrator</h2>
          <p className="admin-dashboard-scope">
            Viewing <strong>{branchName}</strong> for clinic date {clinicDate} ({timezone}).
          </p>
        </div>
        <div className="admin-welcome-card__actions">
          <label className="admin-dashboard-branch">
            <span>Branch</span>
            <select value={branchId} onChange={onBranchChange} aria-label="Selected clinic branch">
              <option value="all">All branches</option>
              {(data.branches || []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <Link className="button button--light" to="/admin/users">
            <Users size={16} /> Audit Accounts
          </Link>
          <Link className="button button--light" to="/admin/analytics">
            <BarChart3 size={16} /> View General Analytics
          </Link>
          <button className="button button--light" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </section>

      <section className="admin-stat-grid" aria-label="Clinic floor today">
        <AdminStatCard
          label="Booked Today"
          value={metrics.bookedToday ?? metrics.appointmentsToday}
          timeframe={timeframe}
          detail="Scheduled visits, excluding cancelled and no-show"
          tone="violet"
          to="/admin/dashboard#todays-schedule"
        />
        <AdminStatCard
          label="Checked In"
          value={metrics.checkedIn ?? 0}
          timeframe={timeframe}
          detail="Arrived and not yet waiting or in treatment"
          tone="purple"
        />
        <AdminStatCard
          label="Waiting"
          value={metrics.waiting ?? 0}
          timeframe={timeframe}
          detail="In the live waiting queue"
          tone="amber"
        />
        <AdminStatCard
          label="In Treatment"
          value={metrics.inTreatment ?? 0}
          timeframe={timeframe}
          detail="Preparing or with a dentist"
          tone="violet"
        />
        <AdminStatCard
          label="Completed"
          value={metrics.completedToday}
          timeframe={timeframe}
          detail="Finished visits for this clinic date"
          tone="emerald"
        />
        <AdminStatCard
          label="No-show"
          value={metrics.noShowToday ?? 0}
          timeframe={timeframe}
          detail="Marked no-show for this clinic date"
          tone="danger"
        />
      </section>

      <section className="admin-stat-grid" aria-label="Accounts and actions">
        <AdminStatCard label="Total Registered Users" value={metrics.totalUsers} tone="purple" detail="All non-archived portal accounts" />
        <AdminStatCard label="Active Patients" value={metrics.activePatients ?? metrics.totalPatients} tone="violet" />
        <AdminStatCard label="Active Dentists" value={metrics.activeDentists} tone="emerald" />
        <AdminStatCard label="Active Staff" value={metrics.activeStaff} tone="amber" />
        <AdminStatCard
          label="Pending Account Approvals"
          value={metrics.pendingAccountApprovals}
          timeframe="Needs review"
          detail="Patients, staff, or dentists waiting for verification"
          tone="amber"
          to="/admin/users?tab=patient&filter=pending"
          actionable={Number(metrics.pendingAccountApprovals) > 0}
        />
        <AdminStatCard
          label="Pending HMO Verification"
          value={metrics.pendingHmoVerification ?? 0}
          timeframe="Open requests"
          detail="HMO bookings still waiting for staff review"
          tone="amber"
        />
        <AdminStatCard label="Archived Records" value={metrics.archivedRecords} tone="amber" />
        <AdminStatCard
          label="System Status"
          value={data.systemStatus === "online" ? "Online" : "Offline"}
          detail={data.systemStatus === "online" ? "Core infrastructure healthy" : "Database unreachable"}
          tone={data.systemStatus === "online" ? "emerald" : "danger"}
        />
      </section>

      <section className="admin-panel" id="todays-schedule">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Clinic date {clinicDate}</span>
            <h2>Today’s Schedule</h2>
          </div>
        </div>
        <DashboardSchedulePreview rows={data.schedulePreview || []} />
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Assigned dentists</span>
            <h2>Dentist Availability</h2>
            <p>Based on recorded schedules, branch assignments, and ongoing treatments.</p>
          </div>
        </div>
        {availability.length ? (
          <ul className="ops-availability">
            {availability.map((dentist) => (
              <li key={dentist.id} className={`ops-availability__row ops-availability__row--${dentist.status}`}>
                <div>
                  <strong>{dentist.name}</strong>
                  <span>{dentist.branches?.length ? dentist.branches.join(", ") : "No branch assignment"}</span>
                </div>
                <em>{dentist.label}</em>
                <small>{dentist.detail}</small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Availability unknown"
            detail="No dentist schedules or branch assignments are available for this view."
          />
        )}
      </section>
    </div>
  );
}
