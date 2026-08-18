import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";

const defaults = {
  clinic: { name: "Amethyst Dental Clinic", address: "", phone: "", email: "", operatingHours: "" },
  appointments: { durationMinutes: 45, bookingLeadDays: 1, cancellationHours: 24, maxDailyAppointments: 40 },
  notifications: { emailNotifications: true, appointmentNotifications: true, systemAlerts: true },
  general: { dateFormat: "MM/DD/YYYY", timeZone: "Asia/Manila" },
};

export function AdminSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.getAdminSettings();
      setSettings({
        clinic: { ...defaults.clinic, ...(response.settings.clinic || {}) },
        appointments: { ...defaults.appointments, ...(response.settings.appointments || {}) },
        notifications: { ...defaults.notifications, ...(response.settings.notifications || {}) },
        general: { ...defaults.general, ...(response.settings.general || {}) },
      });
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.updateAdminSettings({ settings });
      setSettings({
        clinic: { ...defaults.clinic, ...(response.settings.clinic || {}) },
        appointments: { ...defaults.appointments, ...(response.settings.appointments || {}) },
        notifications: { ...defaults.notifications, ...(response.settings.notifications || {}) },
        general: { ...defaults.general, ...(response.settings.general || {}) },
      });
      setSuccess(response.message || "Settings saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !settings) return <ErrorState message={error} onRetry={load} />;
  if (!settings) return <LoadingState label="Loading system settings…" />;

  return (
    <div className="admin-page">
      <SectionHeading eyebrow="Configuration" title="System Settings" detail="Clinic information, booking rules, notifications, and general preferences." />
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <form className="admin-settings-stack" onSubmit={save}>
        <section className="admin-panel">
          <h2>Clinic Information</h2>
          <div className="field-grid field-grid--two">
            <label className="field"><span>Clinic name</span><input value={settings.clinic.name} onChange={(event) => setSettings((current) => ({ ...current, clinic: { ...current.clinic, name: event.target.value } }))} /></label>
            <label className="field"><span>Phone</span><input value={settings.clinic.phone} onChange={(event) => setSettings((current) => ({ ...current, clinic: { ...current.clinic, phone: event.target.value } }))} /></label>
            <label className="field"><span>Email</span><input value={settings.clinic.email} onChange={(event) => setSettings((current) => ({ ...current, clinic: { ...current.clinic, email: event.target.value } }))} /></label>
            <label className="field"><span>Operating hours</span><input value={settings.clinic.operatingHours} onChange={(event) => setSettings((current) => ({ ...current, clinic: { ...current.clinic, operatingHours: event.target.value } }))} /></label>
            <label className="field field--full"><span>Address</span><input value={settings.clinic.address} onChange={(event) => setSettings((current) => ({ ...current, clinic: { ...current.clinic, address: event.target.value } }))} /></label>
          </div>
        </section>

        <section className="admin-panel">
          <h2>Appointment Settings</h2>
          <div className="field-grid field-grid--two">
            <label className="field"><span>Duration (minutes)</span><input type="number" min="15" value={settings.appointments.durationMinutes} onChange={(event) => setSettings((current) => ({ ...current, appointments: { ...current.appointments, durationMinutes: Number(event.target.value) } }))} /></label>
            <label className="field"><span>Booking lead days</span><input type="number" min="0" value={settings.appointments.bookingLeadDays} onChange={(event) => setSettings((current) => ({ ...current, appointments: { ...current.appointments, bookingLeadDays: Number(event.target.value) } }))} /></label>
            <label className="field"><span>Cancellation hours</span><input type="number" min="0" value={settings.appointments.cancellationHours} onChange={(event) => setSettings((current) => ({ ...current, appointments: { ...current.appointments, cancellationHours: Number(event.target.value) } }))} /></label>
            <label className="field"><span>Max daily appointments</span><input type="number" min="1" value={settings.appointments.maxDailyAppointments} onChange={(event) => setSettings((current) => ({ ...current, appointments: { ...current.appointments, maxDailyAppointments: Number(event.target.value) } }))} /></label>
          </div>
        </section>

        <section className="admin-panel">
          <h2>Notification Settings</h2>
          <label className="admin-check"><input type="checkbox" checked={Boolean(settings.notifications.emailNotifications)} onChange={(event) => setSettings((current) => ({ ...current, notifications: { ...current.notifications, emailNotifications: event.target.checked } }))} /> Email notifications</label>
          <label className="admin-check"><input type="checkbox" checked={Boolean(settings.notifications.appointmentNotifications)} onChange={(event) => setSettings((current) => ({ ...current, notifications: { ...current.notifications, appointmentNotifications: event.target.checked } }))} /> Appointment notifications</label>
          <label className="admin-check"><input type="checkbox" checked={Boolean(settings.notifications.systemAlerts)} onChange={(event) => setSettings((current) => ({ ...current, notifications: { ...current.notifications, systemAlerts: event.target.checked } }))} /> System alerts</label>
        </section>

        <section className="admin-panel">
          <h2>General Settings</h2>
          <div className="field-grid field-grid--two">
            <label className="field"><span>Date format</span><input value={settings.general.dateFormat} onChange={(event) => setSettings((current) => ({ ...current, general: { ...current.general, dateFormat: event.target.value } }))} /></label>
            <label className="field"><span>Time zone</span><input value={settings.general.timeZone} onChange={(event) => setSettings((current) => ({ ...current, general: { ...current.general, timeZone: event.target.value } }))} /></label>
          </div>
        </section>

        <button className="button button--primary" disabled={busy}><Save size={16} /> {busy ? "Saving…" : "Save Settings"}</button>
      </form>
    </div>
  );
}
