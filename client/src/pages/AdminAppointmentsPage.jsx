import { useCallback, useEffect, useState } from "react";
import { Check, Download, RefreshCw, RotateCcw, X } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { formatAdminDate, formatAdminTime } from "../adminUtils";

export function AdminAppointmentsPage() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ search: "", status: "", date: "" });
  const [applied, setApplied] = useState(filters);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reschedule, setReschedule] = useState(null);
  const [form, setForm] = useState({ appointmentDate: "", appointmentTime: "" });
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminAppointments(applied));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(appointment, action, fields = {}) {
    const key = `${appointment.id}-${action}`;
    setBusy(key);
    setError("");
    setSuccess("");
    try {
      await api.updateAdminAppointment(appointment.id, { action, ...fields });
      setSuccess(`Appointment ${action.replaceAll("_", " ")} saved.`);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy("");
    }
  }

  async function submitReschedule(event) {
    event.preventDefault();
    await runAction(reschedule, "reschedule", form);
    setReschedule(null);
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading appointments…" />;

  const appointments = data.appointments || [];

  return (
    <div className="admin-page">
      <SectionHeading
        eyebrow="Scheduling control"
        title="Appointments"
        detail="Approve, reschedule, and update clinic bookings."
        action={
          <div className="admin-heading-actions">
            <button className="button button--secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
            <button className="button button--primary" onClick={() => api.downloadAdminExport("appointments")}><Download size={16} /> Export</button>
          </div>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="admin-panel">
        <form className="admin-toolbar" onSubmit={(event) => { event.preventDefault(); setApplied(filters); }}>
          <input placeholder="Search patient, dentist, or treatment" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
          <input type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} />
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">All statuses</option>
            {["pending", "confirmed", "checked_in", "completed", "cancelled", "no_show"].map((status) => (
              <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
            ))}
          </select>
          <button className="button button--secondary button--compact">Filter</button>
        </form>

        {appointments.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Patient</th>
                  <th>Dentist</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td><code>{appointment.id}</code></td>
                    <td>{appointment.patientName}</td>
                    <td>{appointment.dentist}</td>
                    <td>{formatAdminDate(appointment.date)}</td>
                    <td>{formatAdminTime(appointment.time)}</td>
                    <td>{appointment.treatment}</td>
                    <td><AdminStatusBadge status={appointment.status} /></td>
                    <td>
                      <div className="admin-row-actions">
                        {appointment.status === "pending" ? (
                          <>
                            <button className="button button--primary button--compact" disabled={busy} onClick={() => runAction(appointment, "approve")}><Check size={14} /> Approve</button>
                            <button className="button button--secondary button--compact" disabled={busy} onClick={() => runAction(appointment, "deny")}><X size={14} /> Deny</button>
                          </>
                        ) : null}
                        <button className="button button--secondary button--compact" disabled={busy} onClick={() => {
                          setReschedule(appointment);
                          setForm({
                            appointmentDate: String(appointment.date || "").slice(0, 10),
                            appointmentTime: String(appointment.time || "").slice(0, 5),
                          });
                        }}><RotateCcw size={14} /> Reschedule</button>
                        <button className="button button--danger button--compact" disabled={busy} onClick={() => runAction(appointment, "cancel")}>Cancel</button>
                        <button className="button button--secondary button--compact" disabled={busy} onClick={() => runAction(appointment, "complete")}>Complete</button>
                        <button className="button button--secondary button--compact" disabled={busy} onClick={() => runAction(appointment, "no_show")}>No Show</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No appointments found." detail="Adjust filters or wait for new booking requests." />
        )}
      </section>

      {reschedule ? (
        <AdminModal title={`Reschedule ${reschedule.patientName}`} onClose={() => setReschedule(null)}>
          <form className="admin-form" onSubmit={submitReschedule}>
            <label className="field"><span>Date</span><input type="date" value={form.appointmentDate} onChange={(event) => setForm((current) => ({ ...current, appointmentDate: event.target.value }))} required /></label>
            <label className="field"><span>Time</span><input type="time" value={form.appointmentTime} onChange={(event) => setForm((current) => ({ ...current, appointmentTime: event.target.value }))} required /></label>
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setReschedule(null)}>Cancel</button>
              <button className="button button--primary" disabled={Boolean(busy)}>Confirm Reschedule</button>
            </div>
          </form>
        </AdminModal>
      ) : null}
    </div>
  );
}
