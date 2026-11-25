import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, RefreshCw, UserRoundCheck, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffStatusBadge, StaffSummaryCard } from "../components/StaffUI";
import { DashboardSchedulePreview } from "../components/DashboardSchedulePreview";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffTime } from "../staffUtils";

export function StaffDashboardPage() {
  const { pushToast, confirm } = useStaffUi();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async (options = {}) => {
    try {
      setData(await api.getStaffDashboard(options));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ silent: true }), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function checkInAppointment(row) {
    setBusy(`checkin-${row.appointmentId}`);
    try {
      const response = await api.staffCheckIn({
        method: "manual",
        appointmentId: row.appointmentId,
      });
      pushToast(response.message || "Patient checked in successfully.");
      await load();
    } catch (actionError) {
      pushToast(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function updateAppointment(row, action) {
    if (action === "cancel") {
      const ok = await confirm({
        title: "Cancel appointment",
        message: `Are you sure you want to cancel the appointment for ${row.patientName}?`,
        confirmLabel: "Cancel appointment",
      });
      if (!ok) return;
    }
    setBusy(`${action}-${row.appointmentId}`);
    try {
      await api.updateStaffAppointment(row.appointmentId, {
        action: action === "confirm" ? "confirm" : action,
      });
      pushToast(
        action === "confirm"
          ? "Appointment confirmed successfully."
          : action === "cancel"
            ? "Appointment cancelled successfully."
            : "Appointment updated successfully."
      );
      await load();
    } catch (actionError) {
      pushToast(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading clinic operations overview…" />;

  const metrics = data.metrics || {};
  const activity = data.todaysActivity || [];
  const clinicDate = data.clinicDate || data.date;
  const timezone = data.timezone || "Asia/Manila";
  const timeframe = `Today · ${clinicDate} (${timezone})`;
  const branchName = data.branch?.name || data.activeBranch?.name;

  return (
    <div className="staff-page ops-dashboard-clearance">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-welcome-card">
        <div>
          <span className="eyebrow eyebrow--light">Day-to-day clinic floor</span>
          <h2>Clinic Operations Overview</h2>
          <p>
            {branchName ? `${branchName} branch · ` : ""}
            Clinic date {clinicDate} ({timezone}). Counts match the filtered lists they open.
          </p>
        </div>
        <div className="staff-heading-actions">
          <Link className="button button--light" to="/staff/check-in">
            Open Check-In
          </Link>
          <button className="button button--light" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </section>

      <section className="staff-stat-grid">
        <StaffSummaryCard
          label="Booked Today"
          value={metrics.bookedToday ?? metrics.todaysAppointments ?? 0}
          timeframe={timeframe}
          detail="Scheduled visits, excluding cancelled and no-show"
          tone="purple"
          to="/staff/appointments?tab=today"
        />
        <StaffSummaryCard
          label="Checked In"
          value={metrics.checkedIn ?? 0}
          timeframe={timeframe}
          detail="Arrived and not yet waiting or in treatment"
          tone="violet"
          to="/staff/queue?status=checked_in"
        />
        <StaffSummaryCard
          label="Waiting"
          value={metrics.waiting ?? metrics.waitingQueue ?? 0}
          timeframe={timeframe}
          detail="In the live waiting queue"
          tone="amber"
          to="/staff/queue?status=waiting"
          actionable={Number(metrics.waiting ?? metrics.waitingQueue ?? 0) > 0}
        />
        <StaffSummaryCard
          label="In Treatment"
          value={metrics.inTreatment ?? 0}
          timeframe={timeframe}
          detail="Preparing or with a dentist"
          tone="violet"
          to="/staff/queue?status=in_treatment"
        />
        <StaffSummaryCard
          label="Completed"
          value={metrics.completedToday ?? 0}
          timeframe={timeframe}
          detail="Finished visits for this clinic date"
          tone="emerald"
          to="/staff/appointments?tab=completed&when=today"
        />
        <StaffSummaryCard
          label="No-show"
          value={metrics.noShowToday ?? 0}
          timeframe={timeframe}
          detail="Marked no-show for this clinic date"
          tone="rose"
          to="/staff/appointments?tab=no_show"
        />
        <StaffSummaryCard
          label="Pending Requests"
          value={metrics.pendingRequests ?? 0}
          timeframe="Open requests"
          detail="Appointment requests waiting for staff confirmation"
          tone="rose"
          to="/staff/appointments?tab=pending"
          actionable={Number(metrics.pendingRequests ?? 0) > 0}
        />
        <StaffSummaryCard
          label="Pending HMO Verification"
          value={metrics.pendingHmoVerification ?? 0}
          timeframe="Needs review"
          detail="HMO submissions waiting for Staff review."
          tone="amber"
          to="/staff/hmo-verification"
          actionable={Number(metrics.pendingHmoVerification ?? 0) > 0}
        />
      </section>

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Clinic date {clinicDate}</span>
            <h2>Today’s Schedule</h2>
          </div>
        </div>
        <DashboardSchedulePreview
          rows={data.schedulePreview || []}
          appointmentBase="/staff/appointments?tab=today"
          queueBase="/staff/queue"
        />
      </section>

      <section className="staff-panel staff-panel--table">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Live floor board</span>
            <h2>Today&apos;s Clinic Activity</h2>
          </div>
          <div className="staff-quick-links">
            <Link to="/staff/appointments">Appointments</Link>
            <Link to="/staff/queue">Queue</Link>
          </div>
        </div>

        {activity.length ? (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Queue Number</th>
                  <th>Patient Name</th>
                  <th>Appointment Time</th>
                  <th>Service</th>
                  <th>Assigned Dentist</th>
                  <th>Check-In Status</th>
                  <th>Appointment Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={`${row.appointmentId}-${row.queueEntryId || "none"}`}>
                    <td data-label="Queue Number">
                      <code>{row.queueNumber}</code>
                    </td>
                    <td data-label="Patient Name">
                      <strong>{row.patientName}</strong>
                    </td>
                    <td data-label="Appointment Time">{formatStaffTime(String(row.appointmentTime || "").slice(0, 5))}</td>
                    <td data-label="Service">{row.service}</td>
                    <td data-label="Assigned Dentist">{row.dentist}</td>
                    <td data-label="Check-In Status">
                      <StaffStatusBadge status={row.checkInStatus} />
                    </td>
                    <td data-label="Appointment Status">
                      <StaffStatusBadge status={row.appointmentStatus} />
                    </td>
                    <td data-label="Action">
                      <div className="staff-row-actions">
                        <Link
                          className="button button--secondary button--compact"
                          to={`/staff/appointments?focus=${row.appointmentId}`}
                        >
                          View
                        </Link>
                        {row.appointmentStatus === "pending" ? (
                          <button
                            className="button button--primary button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => updateAppointment(row, "confirm")}
                          >
                            Confirm
                          </button>
                        ) : null}
                        {["confirmed", "pending"].includes(row.appointmentStatus) &&
                        row.checkInStatus === "not_checked_in" ? (
                          <button
                            className="button button--primary button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => checkInAppointment(row)}
                          >
                            Check In
                          </button>
                        ) : null}
                        {["pending", "confirmed", "checked_in"].includes(row.appointmentStatus) ? (
                          <button
                            className="button button--danger button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => updateAppointment(row, "cancel")}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No clinic activity yet today"
            detail="Confirmed appointments and check-ins will appear here as the day starts."
          />
        )}
      </section>

      <section className="staff-shortcut-grid">
        <article>
          <CalendarDays size={18} />
          <div>
            <strong>Appointments</strong>
            <p>Confirm, reschedule, or cancel requests.</p>
          </div>
          <Link to="/staff/appointments">Open</Link>
        </article>
        <article>
          <UserRoundCheck size={18} />
          <div>
            <strong>Check-In</strong>
            <p>RFID or QR arrival processing.</p>
          </div>
          <Link to="/staff/check-in">Open</Link>
        </article>
        <article>
          <Users size={18} />
          <div>
            <strong>Queue</strong>
            <p>Monitor waiting and in-treatment patients.</p>
          </div>
          <Link to="/staff/queue">Open</Link>
        </article>
        <article>
          <Clock3 size={18} />
          <div>
            <strong>Billing</strong>
            <p>Create and update invoice records.</p>
          </div>
          <Link to="/staff/billing">Open</Link>
        </article>
        <article>
          <CheckCircle2 size={18} />
          <div>
            <strong>Records</strong>
            <p>Maintain permitted patient information.</p>
          </div>
          <Link to="/staff/patient-records">Open</Link>
        </article>
      </section>
    </div>
  );
}
