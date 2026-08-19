import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, RefreshCw, UserRoundCheck, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffStatusBadge, StaffSummaryCard } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffTime } from "../staffUtils";

export function StaffDashboardPage() {
  const { pushToast, confirm } = useStaffUi();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getStaffDashboard());
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 20000);
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

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-welcome-card">
        <div>
          <span className="eyebrow eyebrow--light">Day-to-day clinic floor</span>
          <h2>Clinic Operations Overview</h2>
          <p>
            Monitor today’s appointments, check-ins, waiting patients, and pending requests from one
            operations panel.
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
          label="Today's Appointments"
          value={metrics.todaysAppointments ?? 0}
          detail="Scheduled for today"
          tone="purple"
        />
        <StaffSummaryCard
          label="Checked In"
          value={metrics.checkedIn ?? metrics.todayCheckIns ?? 0}
          detail="Patients arrived"
          tone="violet"
        />
        <StaffSummaryCard
          label="Waiting Queue"
          value={metrics.waitingQueue ?? metrics.activeQueue ?? 0}
          detail="Currently waiting"
          tone="amber"
        />
        <StaffSummaryCard
          label="Completed Today"
          value={metrics.completedToday ?? 0}
          detail="Finished visits"
          tone="emerald"
        />
        <StaffSummaryCard
          label="Pending Requests"
          value={metrics.pendingRequests ?? 0}
          detail="Needs staff action"
          tone="rose"
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
                    <td>
                      <code>{row.queueNumber}</code>
                    </td>
                    <td>
                      <strong>{row.patientName}</strong>
                    </td>
                    <td>{formatStaffTime(String(row.appointmentTime || "").slice(0, 5))}</td>
                    <td>{row.service}</td>
                    <td>{row.dentist}</td>
                    <td>
                      <StaffStatusBadge status={row.checkInStatus} />
                    </td>
                    <td>
                      <StaffStatusBadge status={row.appointmentStatus} />
                    </td>
                    <td>
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
