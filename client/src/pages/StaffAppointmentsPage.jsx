import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  Check,
  Download,
  RefreshCw,
  RotateCcw,
  Trash2,
  UserRoundCheck,
  X,
} from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { formatStaffDate, formatStaffTime } from "../staffUtils";
import {
  StaffModal,
  StaffStatusBadge,
} from "../components/StaffUI";

function appointmentDateValue(date) {
  if (!date) return new Date().toISOString().slice(0, 10);
  return String(date).slice(0, 10);
}

export function StaffAppointmentsPage() {
  const [appointmentData, setAppointmentData] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [isAvailabilityOpen, setIsAvailabilityOpen] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleForm, setRescheduleForm] = useState({ appointmentDate: "", appointmentTime: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyAction, setBusyAction] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.getStaffAppointments();
      setAppointmentData(response);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = window.setInterval(load, 30000);
    return () => window.clearInterval(refresh);
  }, [load]);

  async function openAvailability() {
    setIsAvailabilityOpen(true);
    setError("");
    try {
      setAvailability(await api.getStaffDentistAvailability());
    } catch (loadError) {
      setError(loadError.message);
      setAvailability({ availability: [] });
    }
  }

  async function updateAppointment(appointment, action, fields = {}) {
    const actionKey = `${appointment.id}-${action}`;
    setBusyAction(actionKey);
    setError("");
    setSuccess("");
    try {
      await api.updateStaffAppointment(appointment.id, { action, ...fields });
      await load();
      setSuccess(
        action === "approve"
          ? "Appointment request approved."
          : action === "deny"
            ? "Appointment request denied."
            : action === "cancel"
              ? "Appointment cancelled."
              : "Appointment rescheduled."
      );
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusyAction(null);
    }
  }

  function openReschedule(appointment) {
    setRescheduleTarget(appointment);
    setRescheduleForm({
      appointmentDate: appointmentDateValue(appointment.date),
      appointmentTime: String(appointment.time || "").slice(0, 5),
    });
  }

  async function submitReschedule(event) {
    event.preventDefault();
    if (!rescheduleTarget) return;
    await updateAppointment(rescheduleTarget, "reschedule", rescheduleForm);
    setRescheduleTarget(null);
  }

  async function exportAppointments() {
    setIsExporting(true);
    setError("");
    try {
      await api.downloadStaffExport("appointments");
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setIsExporting(false);
    }
  }

  if (error && !appointmentData) return <ErrorState message={error} onRetry={load} />;
  if (!appointmentData) return <LoadingState label="Loading appointment operations…" />;

  const appointments = appointmentData.todayAppointments || [];
  const requests = appointmentData.pendingRequests || [];

  return (
    <div className="staff-page">
      <SectionHeading
        eyebrow="Scheduling desk"
        title="Appointments"
        detail="Manage today’s care schedule and new booking requests."
        action={
          <div className="staff-heading-actions">
            <button className="button button--secondary" onClick={openAvailability}>
              <CalendarClock size={16} /> Dentist Availability
            </button>
            <button className="button button--primary" onClick={exportAppointments} disabled={isExporting}>
              <Download size={16} /> {isExporting ? "Exporting…" : "Export Log"}
            </button>
          </div>
        }
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {success && <p className="inline-alert inline-alert--success"><Check size={17} /> {success}</p>}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Today&apos;s schedule</span>
            <h2>Appointment Command Center</h2>
            <p>Today&apos;s Confirmed Bookings</p>
          </div>
          <button className="icon-button" onClick={load} aria-label="Refresh appointments">
            <RefreshCw size={18} />
          </button>
        </div>

        {appointments.length ? (
          <div className="staff-appointment-grid">
            {appointments.map((appointment) => (
              <article className="staff-appointment-card" key={appointment.id}>
                <div className="staff-appointment-card__time">
                  <CalendarClock size={18} />
                  <strong>{formatStaffTime(appointment.time)}</strong>
                  <small>{formatStaffDate(appointment.date)}</small>
                </div>
                <div className="staff-appointment-card__body">
                  <div className="staff-card-title-row">
                    <div>
                      <h3>{appointment.patientName}</h3>
                      <p>{appointment.treatment}</p>
                    </div>
                    <StaffStatusBadge status={appointment.status} />
                  </div>
                  <small>{appointment.dentist} · {appointment.location || "Amethyst Dental Clinic"}</small>
                  <div className="staff-appointment-card__actions">
                    <button
                      className="button button--secondary button--compact"
                      onClick={() => openReschedule(appointment)}
                      disabled={Boolean(busyAction)}
                    >
                      <RotateCcw size={15} /> Reschedule
                    </button>
                    <button
                      className="button button--danger button--compact"
                      onClick={() => {
                        if (window.confirm(`Cancel ${appointment.patientName}'s appointment?`)) {
                          updateAppointment(appointment, "cancel");
                        }
                      }}
                      disabled={busyAction === `${appointment.id}-cancel`}
                    >
                      <Trash2 size={15} /> {busyAction === `${appointment.id}-cancel` ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No confirmed bookings today" detail="Today’s confirmed appointments will appear here." />
        )}
      </section>

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Incoming requests</span>
            <h2>Booking Requests</h2>
            <p>Review requests that still need staff approval.</p>
          </div>
          <span className="staff-count-badge">{requests.length} pending</span>
        </div>

        {requests.length ? (
          <div className="staff-request-list">
            {requests.map((request) => (
              <article className="staff-request-row" key={request.id}>
                <span className="staff-request-row__icon"><UserRoundCheck size={20} /></span>
                <div>
                  <strong>{request.patientName}</strong>
                  <p>{request.treatment} with {request.dentist}</p>
                  <small>{formatStaffDate(request.date)} · {formatStaffTime(request.time)}</small>
                </div>
                <div className="staff-request-row__actions">
                  <button
                    className="button button--secondary button--compact"
                    onClick={() => updateAppointment(request, "deny")}
                    disabled={busyAction === `${request.id}-deny`}
                  >
                    <X size={15} /> Deny
                  </button>
                  <button
                    className="button button--primary button--compact"
                    onClick={() => updateAppointment(request, "approve")}
                    disabled={busyAction === `${request.id}-approve`}
                  >
                    <Check size={15} /> {busyAction === `${request.id}-approve` ? "Approving…" : "Approve"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No pending booking requests" detail="New appointment requests will appear here for staff review." />
        )}
      </section>

      {isAvailabilityOpen && (
        <StaffModal title="Dentist Availability" onClose={() => setIsAvailabilityOpen(false)} wide>
          {!availability ? (
            <LoadingState label="Loading dentist availability…" />
          ) : availability.availability.length ? (
            <div className="staff-availability-list">
              {availability.availability.map((entry) => (
                <article className="staff-availability-row" key={entry.id}>
                  <div>
                    <strong>{entry.dentistName}</strong>
                    <small>{formatStaffDate(entry.date)} · {formatStaffTime(entry.startTime)} – {formatStaffTime(entry.endTime)}</small>
                  </div>
                  <StaffStatusBadge status={entry.status} />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No availability has been published"
              detail="Dentist schedules will appear here when they are entered in the clinic database."
            />
          )}
        </StaffModal>
      )}

      {rescheduleTarget && (
        <StaffModal title={`Reschedule ${rescheduleTarget.patientName}`} onClose={() => setRescheduleTarget(null)}>
          <form className="staff-modal__form" onSubmit={submitReschedule}>
            <label className="field">
              <span>New date</span>
              <input
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={rescheduleForm.appointmentDate}
                onChange={(event) => setRescheduleForm((current) => ({ ...current, appointmentDate: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>New time</span>
              <input
                type="time"
                value={rescheduleForm.appointmentTime}
                onChange={(event) => setRescheduleForm((current) => ({ ...current, appointmentTime: event.target.value }))}
                required
              />
            </label>
            <div className="staff-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setRescheduleTarget(null)}>Cancel</button>
              <button className="button button--primary" disabled={busyAction === `${rescheduleTarget.id}-reschedule`}>
                <RotateCcw size={16} /> {busyAction === `${rescheduleTarget.id}-reschedule` ? "Saving…" : "Confirm Reschedule"}
              </button>
            </div>
          </form>
        </StaffModal>
      )}
    </div>
  );
}
