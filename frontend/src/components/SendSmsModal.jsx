import { useMemo, useState } from "react";
import { api } from "../api";
import { StaffModal } from "./StaffUI";

const MESSAGE_TYPES = [
  { value: "appointment_confirmed", label: "Appointment confirmation" },
  { value: "appointment_reminder", label: "Appointment reminder" },
  { value: "appointment_rescheduled", label: "Appointment rescheduled" },
  { value: "appointment_cancelled", label: "Appointment cancelled" },
  { value: "appointment_updated", label: "Appointment date/time updated" },
  { value: "queue_updated", label: "Queue status / waiting time" },
  { value: "queue_approaching", label: "Queue turn approaching" },
  { value: "manual", label: "Custom message" },
];

function defaultType(initial) {
  if (initial?.messageType) return initial.messageType;
  if (initial?.queueEntryId) return "queue_updated";
  return "appointment_reminder";
}

export function SendSmsModal({
  onClose,
  onSent,
  pushToast,
  initial = {},
  appointments = [],
}) {
  const [step, setStep] = useState("compose");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    phone: initial.phone || "",
    patientUserId: initial.patientUserId || "",
    appointmentId: initial.appointmentId || "",
    queueEntryId: initial.queueEntryId || "",
    messageType: defaultType(initial),
    message: initial.message || "",
  });
  const [preview, setPreview] = useState(null);

  const selectedAppointment = useMemo(
    () => appointments.find((item) => String(item.id) === String(form.appointmentId)) || null,
    [appointments, form.appointmentId]
  );

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setPreview(null);
    setStep("compose");
  }

  function selectAppointment(appointmentId) {
    const appointment = appointments.find((item) => String(item.id) === String(appointmentId));
    setForm((current) => ({
      ...current,
      appointmentId,
      patientUserId: appointment?.patientId || current.patientUserId,
      phone: appointment?.patientPhone || current.phone,
    }));
    setPreview(null);
    setStep("compose");
  }

  async function loadPreview(event) {
    event.preventDefault();
    setBusy("preview");
    setError("");
    try {
      const response = await api.previewStaffSms({
        phone: form.phone,
        message: form.message,
        messageType: form.messageType,
        patientUserId: form.patientUserId,
        appointmentId: form.appointmentId || undefined,
        queueEntryId: form.queueEntryId || undefined,
      });
      setPreview(response);
      setStep("confirm");
    } catch (previewError) {
      setError(previewError.message);
      pushToast?.(previewError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function sendSms() {
    if (busy === "sms") return;
    setBusy("sms");
    setError("");
    try {
      const response = await api.sendStaffSms({
        phone: form.phone,
        message: preview?.message || form.message,
        messageType: form.messageType,
        patientUserId: form.patientUserId,
        appointmentId: form.appointmentId || undefined,
        queueEntryId: form.queueEntryId || undefined,
        confirm: true,
      });
      const status = response.sms?.status;
      if (status === "failed") {
        pushToast?.(response.message || "SMS failed.", "error");
        setError(response.message || "SMS failed.");
        return;
      }
      pushToast?.(response.message || "SMS accepted by the provider.");
      onSent?.(response);
      onClose();
    } catch (smsError) {
      setError(smsError.message);
      pushToast?.(smsError.message, "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <StaffModal title={step === "confirm" ? "Confirm Send SMS" : "Send SMS"} onClose={onClose}>
      {step === "compose" ? (
        <form className="admin-form" onSubmit={loadPreview}>
          {appointments.length ? (
            <label className="field">
              <span>Patient appointment</span>
              <select value={form.appointmentId} onChange={(event) => selectAppointment(event.target.value)}>
                <option value="">Select an appointment (optional)</option>
                {appointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    #{appointment.id} {appointment.patientName} · {appointment.service || appointment.treatment}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>Patient mobile number</span>
            <input
              required
              value={form.phone}
              onChange={(event) => update("phone", event.target.value)}
              placeholder="09xxxxxxxxx"
            />
          </label>
          <label className="field">
            <span>Notification type</span>
            <select value={form.messageType} onChange={(event) => update("messageType", event.target.value)}>
              {MESSAGE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{form.messageType === "manual" ? "Custom message" : "Message (optional override)"}</span>
            <textarea
              required={form.messageType === "manual"}
              rows="4"
              value={form.message}
              onChange={(event) => update("message", event.target.value)}
              placeholder="Leave blank to use the clinic template, or type a patient-specific instruction."
            />
          </label>
          {selectedAppointment ? (
            <p className="muted-copy">
              Using {selectedAppointment.patientName}'s appointment on {String(selectedAppointment.date || "").slice(0, 10)}{" "}
              at {String(selectedAppointment.time || "").slice(0, 5)}.
            </p>
          ) : null}
          {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
          <div className="staff-modal__actions">
            <button type="button" className="button button--secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="button button--primary" disabled={Boolean(busy)}>
              {busy === "preview" ? "Preparing preview…" : "Preview SMS"}
            </button>
          </div>
        </form>
      ) : (
        <div className="admin-form">
          <div className="sms-preview">
            <p>
              <small>Recipient</small>
              <strong>{preview?.recipientMasked || "••••"}</strong>
            </p>
            <p>
              <small>Notification type</small>
              <strong>{form.messageType.replaceAll("_", " ")}</strong>
            </p>
            <p>
              <small>Message</small>
              <strong>{preview?.message}</strong>
            </p>
          </div>
          {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
          <div className="staff-modal__actions">
            <button type="button" className="button button--secondary" onClick={() => setStep("compose")} disabled={Boolean(busy)}>
              Back
            </button>
            <button type="button" className="button button--primary" onClick={sendSms} disabled={busy === "sms"}>
              {busy === "sms" ? "Sending…" : "Send SMS"}
            </button>
          </div>
        </div>
      )}
    </StaffModal>
  );
}
