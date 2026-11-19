import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  UserRound,
  UserRoundCheck,
  Users,
  UserX,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { dashboardHref, floorMetricHref } from "../adminDashboardLinks";
import { ErrorState, LoadingState } from "../components/UI";
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
  const scope = { branchId, date: clinicDate };
  const availability = data.dentistAvailability?.dentists || [];
  const calendarHref = dashboardHref("/admin/schedule", scope);
  const fullScheduleHref = dashboardHref("/admin/roster", { ...scope, extra: { metric: "booked" } });

  return (
    <div className="admin-page admin-dashboard-page ops-dashboard-clearance">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="admin-welcome-card">
        <div>
          <span className="eyebrow eyebrow--light">Welcome back</span>
          <h2>Welcome Back, Administrator</h2>
          <p className="admin-dashboard-scope">
            Viewing <strong>{branchName}</strong>
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

      <p className="ops-group-scope">
        Clinic floor · {branchName} · {clinicDate} ({timezone})
      </p>
      <section className="admin-stat-grid" aria-label="Clinic floor today">
        <AdminStatCard
          label="Booked Today"
          value={metrics.bookedToday ?? metrics.appointmentsToday}
          detail="Scheduled visits, excluding cancelled and no-show"
          tone="violet"
          icon={CalendarDays}
          to={floorMetricHref("booked", scope)}
        />
        <AdminStatCard
          label="Checked In"
          value={metrics.checkedIn ?? 0}
          detail="Arrived and not yet waiting or in treatment"
          tone="purple"
          icon={UserRoundCheck}
          to={floorMetricHref("checked_in", scope)}
        />
        <AdminStatCard
          label="Waiting"
          value={metrics.waiting ?? 0}
          detail="In the live waiting queue"
          tone="amber"
          icon={ClipboardList}
          to={floorMetricHref("waiting", scope)}
          actionable={Number(metrics.waiting ?? 0) > 0}
        />
        <AdminStatCard
          label="In Treatment"
          value={metrics.inTreatment ?? 0}
          detail="Preparing or with a dentist"
          tone="violet"
          icon={Stethoscope}
          to={floorMetricHref("in_treatment", scope)}
        />
        <AdminStatCard
          label="Completed"
          value={metrics.completedToday}
          detail="Finished visits for this clinic date"
          tone="emerald"
          icon={CheckCircle2}
          to={floorMetricHref("completed", scope)}
        />
        <AdminStatCard
          label="No-show"
          value={metrics.noShowToday ?? 0}
          detail="Marked no-show for this clinic date"
          tone="danger"
          icon={UserX}
          to={floorMetricHref("no_show", scope)}
        />
      </section>

      <p className="ops-group-scope">Accounts · clinic-wide</p>
      <section className="admin-stat-grid" aria-label="Accounts and actions">
        <AdminStatCard
          label="Total Registered Users"
          value={metrics.totalUsers}
          detail="All non-archived portal accounts"
          tone="purple"
          icon={Users}
          to="/admin/users"
        />
        <AdminStatCard
          label="Active Patients"
          value={metrics.activePatients ?? metrics.totalPatients}
          detail="Non-archived patient accounts"
          tone="violet"
          icon={UserRound}
          to="/admin/users?tab=patient"
        />
        <AdminStatCard
          label="Active Dentists"
          value={metrics.activeDentists}
          detail="Verified dentists currently operational"
          tone="emerald"
          icon={Stethoscope}
          to="/admin/users?tab=dentist&filter=active"
        />
        <AdminStatCard
          label="Active Staff"
          value={metrics.activeStaff}
          detail="Verified staff currently operational"
          tone="amber"
          icon={Users}
          to="/admin/users?tab=staff&filter=active"
        />
        <AdminStatCard
          label="Pending Account Approvals"
          value={metrics.pendingAccountApprovals}
          detail="Patients, staff, or dentists waiting for verification"
          tone="amber"
          icon={ShieldAlert}
          to="/admin/users?tab=patient&filter=pending"
          actionable={Number(metrics.pendingAccountApprovals) > 0}
        />
        <AdminStatCard
          label="Pending HMO Verification"
          value={metrics.pendingHmoVerification ?? 0}
          detail="HMO bookings waiting for authorized review"
          tone="amber"
          icon={HeartPulse}
          to={dashboardHref("/admin/roster", { branchId, extra: { metric: "hmo" } })}
          actionable={Number(metrics.pendingHmoVerification ?? 0) > 0}
        />
        <AdminStatCard
          label="Archived Records"
          value={metrics.archivedRecords}
          detail="Accounts moved to Archive"
          tone="amber"
          icon={Archive}
          to="/admin/archived-records"
        />
        <AdminStatCard
          label="System Status"
          value={data.systemStatus === "online" ? "Online" : "Offline"}
          detail={
            data.systemStatus === "online"
              ? "Core infrastructure healthy · open Sync Data diagnostics"
              : "Database unreachable · open Sync Data diagnostics"
          }
          tone={data.systemStatus === "online" ? "emerald" : "danger"}
          icon={HeartPulse}
          to="/admin/sync-data"
        />
      </section>

      <section className="admin-panel" id="todays-schedule">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">
              {branchName} · {clinicDate}
            </span>
            <h2>Today’s Schedule</h2>
          </div>
          <Link className="button button--secondary button--compact" to={fullScheduleHref}>
            View Full Schedule
          </Link>
        </div>
        <DashboardSchedulePreview
          rows={data.schedulePreview || []}
          rowTo={(row) => dashboardHref("/admin/roster", { ...scope, extra: { metric: "booked", focus: row.appointmentId } })}
          emptyTitle="No visits booked for this clinic date."
          emptyAction={<Link to={calendarHref}>Open calendar</Link>}
        />
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Assigned dentists · {branchName}</span>
            <h2>Dentist Availability</h2>
            <p>Based on recorded schedules, branch assignments, and ongoing treatments.</p>
          </div>
          <Link className="button button--secondary button--compact" to="/admin/roster">
            Manage schedules
          </Link>
        </div>
        {availability.length ? (
          <ul className="ops-availability">
            {availability.map((dentist) => {
              const unknown = dentist.status === "unknown";
              const to = unknown
                ? "/admin/roster"
                : `/admin/users?tab=dentist&focus=${encodeURIComponent(dentist.id)}`;
              return (
                <li key={dentist.id}>
                  <Link
                    className={`ops-availability__row ops-availability__row--link ops-availability__row--${dentist.status}`}
                    to={to}
                    aria-label={`${dentist.name}. ${dentist.label}. Open ${unknown ? "schedule management" : "dentist account"}.`}
                  >
                    <div>
                      <strong>{dentist.name}</strong>
                      <span>{dentist.branches?.length ? dentist.branches.join(", ") : "No branch assignment"}</span>
                    </div>
                    <em>{dentist.label}</em>
                    <small>{dentist.detail}</small>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ops-schedule-empty">
            Availability unknown.{" "}
            <Link to="/admin/schedule">Open clinic calendar</Link>
          </p>
        )}
      </section>
    </div>
  );
}
