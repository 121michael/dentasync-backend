import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate, formatAdminTime } from "../adminUtils";

const emptySchedule = {
  scheduleType: "dentist",
  title: "",
  assigneeId: "",
  assigneeName: "",
  dayOfWeek: "",
  scheduleDate: "",
  startTime: "09:00",
  endTime: "17:00",
  notes: "",
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function AdminSchedulePage() {
  const { pushToast, confirm } = useAdminUi();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptySchedule);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminSchedules());
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSchedule(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        dayOfWeek: form.dayOfWeek === "" ? null : Number(form.dayOfWeek),
        scheduleDate: form.scheduleDate || null,
      };
      const response = await api.createAdminSchedule(payload);
      pushToast(response.message || "Schedule added successfully.");
      setFormOpen(false);
      setForm(emptySchedule);
      await load();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeSchedule(schedule) {
    const ok = await confirm({
      title: "Remove schedule",
      message: `Remove “${schedule.title}” from the clinic roster?`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      const response = await api.deleteAdminSchedule(schedule.id);
      pushToast(response.message || "Schedule removed successfully.");
      await load();
    } catch (removeError) {
      pushToast(removeError.message, "error");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading clinic schedule…" />;

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Roster control</span>
            <h2>Clinic Schedule & Roster</h2>
            <p>
              Manage dentist and staff schedules, clinic operating hours, blocked windows, and appointment
              availability. Conflicts with existing appointments are blocked.
            </p>
          </div>
          <button
            className="button button--primary"
            onClick={() => setFormOpen(true)}
            disabled={Boolean(data.setupRequired)}
          >
            <Plus size={16} /> Add Schedule
          </button>
        </div>

        {data.setupRequired || data.message ? (
          <p className="inline-alert inline-alert--error" role="status">
            {data.message ||
              "Schedule tables are missing. In your backend folder run: npm run migrate:admin-command-center, then restart npm start."}
          </p>
        ) : null}

        <div className="admin-overview-grid">
          <article><span>Clinic operating hours</span><strong>{data.clinicHours || "Not configured"}</strong></article>
          <article><span>Active schedule blocks</span><strong>{data.schedules?.length || 0}</strong></article>
          <article><span>Upcoming appointments</span><strong>{data.appointments?.length || 0}</strong></article>
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Schedule matrix</span>
            <h2>Assigned Schedules</h2>
          </div>
        </div>
        {data.schedules?.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Assignee</th>
                  <th>When</th>
                  <th>Window</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.schedules.map((schedule) => (
                  <tr key={schedule.id}>
                    <td><strong>{schedule.title}</strong></td>
                    <td className="capitalize">{String(schedule.scheduleType).replaceAll("_", " ")}</td>
                    <td>{schedule.assigneeName || schedule.assigneeId || "—"}</td>
                    <td>
                      {schedule.scheduleDate
                        ? formatAdminDate(schedule.scheduleDate)
                        : schedule.dayOfWeek !== null && schedule.dayOfWeek !== undefined
                          ? DAYS[schedule.dayOfWeek]
                          : "Recurring / open"}
                    </td>
                    <td>
                      {schedule.startTime && schedule.endTime
                        ? `${formatAdminTime(schedule.startTime)} – ${formatAdminTime(schedule.endTime)}`
                        : "—"}
                    </td>
                    <td>{schedule.notes || "—"}</td>
                    <td>
                      <button className="button button--danger button--compact" onClick={() => removeSchedule(schedule)}>
                        <Trash2 size={14} /> Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No schedules yet" detail="Add dentist, staff, clinic hours, blocked, or availability entries." />
        )}
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Appointment sync</span>
            <h2>Current Appointments</h2>
            <p>Live appointments synchronized with the booking system for the next two weeks.</p>
          </div>
        </div>
        {data.appointments?.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Treatment</th>
                  <th>Dentist</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.appointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td><strong>{appointment.patientName}</strong></td>
                    <td>{appointment.treatment}</td>
                    <td>{appointment.dentistName}</td>
                    <td>{formatAdminDate(appointment.date)}</td>
                    <td>{formatAdminTime(appointment.time)}</td>
                    <td><AdminStatusBadge status={appointment.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No upcoming appointments" detail="Appointment availability will appear here as bookings arrive." />
        )}
      </section>

      {formOpen ? (
        <AdminModal title="Add schedule" onClose={() => setFormOpen(false)} wide>
          <form className="admin-form" onSubmit={saveSchedule}>
            <label>Schedule type
              <select value={form.scheduleType} onChange={(e) => setForm({ ...form, scheduleType: e.target.value })}>
                <option value="dentist">Dentist schedule</option>
                <option value="staff">Staff schedule</option>
                <option value="clinic_hours">Clinic operating hours</option>
                <option value="blocked">Blocked time</option>
                <option value="availability">Available time slots</option>
              </select>
            </label>
            <label>Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>Assignee name<input value={form.assigneeName} onChange={(e) => setForm({ ...form, assigneeName: e.target.value })} /></label>
            <label>Assignee ID<input value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} /></label>
            <label>Day of week
              <select value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>
                <option value="">None</option>
                {DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
            </label>
            <label>Specific date<input type="date" value={form.scheduleDate} onChange={(e) => setForm({ ...form, scheduleDate: e.target.value })} /></label>
            <label>Start time<input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></label>
            <label>End time<input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></label>
            <label>Notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="button button--primary" disabled={busy}>{busy ? "Saving…" : "Save schedule"}</button>
            </div>
          </form>
        </AdminModal>
      ) : null}
    </div>
  );
}
