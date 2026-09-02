import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffModal, StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDate, formatStaffTime } from "../staffUtils";

const TABS = [
  { id: "pending", label: "Pending" },
  { id: "confirmed", label: "Confirmed" },
  { id: "today", label: "Today" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

export function StaffAppointmentsPage() {
  const { pushToast, confirm } = useStaffUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "today");
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleForm, setRescheduleForm] = useState({ appointmentDate: "", appointmentTime: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getStaffAppointments(tab));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [tab]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const focusId = searchParams.get("focus");
    if (!focusId || !data?.appointments?.length) return;
    const match = data.appointments.find((item) => String(item.id) === String(focusId));
    if (match) {
      openDetails(match.id);
      setSearchParams({}, { replace: true });
    }
  }, [data, searchParams, setSearchParams]);

  const rows = useMemo(() => data?.appointments || [], [data]);

  async function openDetails(appointmentId) {
    setBusy(`detail-${appointmentId}`);
    try {
      const response = await api.getStaffAppointment(appointmentId);
      setDetail(response.appointment);
    } catch (detailError) {
      pushToast(detailError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function runAction(appointment, action, fields = {}) {
    if (action === "cancel" || action === "deny") {
      const ok = await confirm({
        title: action === "deny" ? "Decline request" : "Cancel appointment",
        message:
          action === "deny"
            ? `Decline the appointment request for ${appointment.patientName}?`
            : `Are you sure you want to cancel this appointment for ${appointment.patientName}?`,
        confirmLabel: action === "deny" ? "Decline" : "Cancel appointment",
      });
      if (!ok) return;
    }

    setBusy(`${action}-${appointment.id}`);
    try {
      await api.updateStaffAppointment(appointment.id, { action, ...fields });
      pushToast(
        action === "confirm" || action === "approve"
          ? "Appointment confirmed successfully."
          : action === "reschedule"
            ? "Appointment rescheduled successfully."
            : "Appointment cancelled successfully."
      );
      setDetail(null);
      setRescheduleTarget(null);
      await load();
    } catch (actionError) {
      pushToast(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  function openReschedule(appointment) {
    setRescheduleTarget(appointment);
    setRescheduleForm({
      appointmentDate: String(appointment.date || "").slice(0, 10),
      appointmentTime: String(appointment.time || "").slice(0, 5),
    });
  }

  async function submitReschedule(event) {
    event.preventDefault();
    if (!rescheduleTarget) return;
    const ok = await confirm({
      title: "Confirm reschedule",
      message: `Reschedule ${rescheduleTarget.patientName} to ${rescheduleForm.appointmentDate} at ${rescheduleForm.appointmentTime}?`,
      confirmLabel: "Reschedule",
      tone: "primary",
    });
    if (!ok) return;
    await runAction(rescheduleTarget, "reschedule", rescheduleForm);
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading appointments…" />;

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Scheduling desk</span>
            <h2>Appointment Management</h2>
            <p>Confirm, reschedule, and cancel appointments. Patient notifications are sent automatically.</p>
          </div>
          <button className="button button--secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <div className="admin-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`admin-tab ${tab === item.id ? "is-active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {rows.length ? (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Appointment ID</th>
                  <th>Patient</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Service</th>
                  <th>Dentist</th>
                  <th>HMO</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((appointment) => (
                  <tr key={appointment.id}>
                    <td>
                      <code>#{appointment.id}</code>
                    </td>
                    <td>
                      <strong>{appointment.patientName}</strong>
                      <small>{appointment.patientPhone || "No phone"}</small>
                    </td>
                    <td>{formatStaffDate(appointment.date)}</td>
                    <td>{formatStaffTime(String(appointment.time || "").slice(0, 5))}</td>
                    <td>{appointment.service || appointment.treatment}</td>
                    <td>{appointment.dentist}</td>
                    <td>
                      {appointment.coverageType === "hmo"
                        ? appointment.hmoProvider || "HMO"
                        : appointment.coverageType || "Self-pay"}
                    </td>
                    <td>
                      <StaffStatusBadge status={appointment.status} />
                    </td>
                    <td>
                      <div className="staff-row-actions">
                        <button
                          className="button button--secondary button--compact"
                          onClick={() => openDetails(appointment.id)}
                          disabled={Boolean(busy)}
                        >
                          <Eye size={14} /> View
                        </button>
                        {appointment.status === "pending" ? (
                          <button
                            className="button button--primary button--compact"
                            onClick={() => runAction(appointment, "confirm")}
                            disabled={Boolean(busy)}
                          >
                            Confirm
                          </button>
                        ) : null}
                        {["pending", "confirmed", "checked_in"].includes(appointment.status) ? (
                          <>
                            <button
                              className="button button--secondary button--compact"
                              onClick={() => openReschedule(appointment)}
                              disabled={Boolean(busy)}
                            >
                              <RotateCcw size={14} /> Reschedule
                            </button>
                            <button
                              className="button button--danger button--compact"
                              onClick={() => runAction(appointment, "cancel")}
                              disabled={Boolean(busy)}
                            >
                              <Trash2 size={14} /> Cancel
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No appointments in this tab" detail="Try another status filter." />
        )}
      </section>

      {detail ? (
        <StaffModal title="Appointment request details" onClose={() => setDetail(null)} wide>
          <div className="staff-detail-grid">
            <p><small>Patient name</small><strong>{detail.patientName}</strong></p>
            <p><small>Patient ID</small><strong>{detail.patientId}</strong></p>
            <p><small>Contact</small><strong>{detail.patientPhone || detail.patientEmail || "—"}</strong></p>
            <p><small>Date</small><strong>{formatStaffDate(detail.date)}</strong></p>
            <p><small>Time</small><strong>{formatStaffTime(String(detail.time || "").slice(0, 5))}</strong></p>
            <p><small>Service</small><strong>{detail.service || detail.treatment}</strong></p>
            <p><small>Dentist</small><strong>{detail.dentist}</strong></p>
            <p><small>HMO status</small><strong>{detail.coverageType || "—"}</strong></p>
            <p><small>HMO provider</small><strong>{detail.hmoProvider || "—"}</strong></p>
            <p><small>HMO ID</small><strong>{detail.hmoMemberNumber || "—"}</strong></p>
            <p><small>Company</small><strong>{detail.companyName || "—"}</strong></p>
            <p><small>Birth date</small><strong>{detail.birthDate ? formatStaffDate(detail.birthDate) : "—"}</strong></p>
          </div>
          {detail.notes ? <p className="staff-detail-copy">{detail.notes}</p> : null}
          <div className="staff-heading-actions">
            {detail.status === "pending" ? (
              <button className="button button--primary" onClick={() => runAction(detail, "confirm")} disabled={Boolean(busy)}>
                Confirm
              </button>
            ) : null}
            {["pending", "confirmed", "checked_in"].includes(detail.status) ? (
              <>
                <button className="button button--secondary" onClick={() => openReschedule(detail)} disabled={Boolean(busy)}>
                  Reschedule
                </button>
                <button className="button button--danger" onClick={() => runAction(detail, "cancel")} disabled={Boolean(busy)}>
                  Cancel
                </button>
              </>
            ) : null}
          </div>
        </StaffModal>
      ) : null}

      {rescheduleTarget ? (
        <StaffModal title="Reschedule appointment" onClose={() => setRescheduleTarget(null)}>
          <form className="admin-form" onSubmit={submitReschedule}>
            <label className="field">
              <span>New date</span>
              <input
                type="date"
                required
                value={rescheduleForm.appointmentDate}
                onChange={(event) =>
                  setRescheduleForm((current) => ({ ...current, appointmentDate: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>New time</span>
              <input
                type="time"
                required
                value={rescheduleForm.appointmentTime}
                onChange={(event) =>
                  setRescheduleForm((current) => ({ ...current, appointmentTime: event.target.value }))
                }
              />
            </label>
            <button className="button button--primary" disabled={Boolean(busy)}>
              Save reschedule
            </button>
          </form>
        </StaffModal>
      ) : null}
    </div>
  );
}
