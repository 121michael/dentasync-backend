import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileUp,
  ShieldCheck,
  Stethoscope,
  X,
} from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";

const TIME_SLOTS = {
  Morning: ["09:00", "09:30", "10:00", "10:30", "11:00"],
  Afternoon: ["13:00", "13:30", "14:00", "14:30", "15:00"],
  Evening: ["16:00", "16:30", "17:00", "17:30"],
};

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(value) {
  if (!value) return "Date to be confirmed";

  const rawValue = value instanceof Date ? value : String(value).trim();
  const date =
    rawValue instanceof Date
      ? rawValue
      : /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
        ? new Date(`${rawValue}T00:00:00`)
        : new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    return "Date to be confirmed";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function displayTime(value) {
  if (value == null) return "Time to be confirmed";
  const text = String(value).trim();
  const [hours, minutes] = text.split(":");
  if (
    !/^\d{1,2}$/.test(hours || "") ||
    !/^\d{2}$/.test(minutes || "") ||
    Number(hours) > 23 ||
    Number(minutes) > 59
  ) {
    return "Time to be confirmed";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, Number(hours), Number(minutes)));
}

export function AppointmentsPage() {
  const [catalog, setCatalog] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [dependents, setDependents] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [timePeriod, setTimePeriod] = useState("Morning");
  const [form, setForm] = useState({
    serviceId: "",
    appointmentDate: tomorrow(),
    appointmentTime: "",
    coverageType: "self_pay",
    hmoProvider: "",
    hmoMemberNumber: "",
    hmoCompanyName: "",
    hmoBirthDate: "",
    notes: "",
    forPatientUserId: "",
  });
  const [authorizationFile, setAuthorizationFile] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [catalogResponse, appointmentResponse, dependentsResponse] = await Promise.all([
        api.getCatalog(),
        api.getAppointments(),
        api.getDependents().catch(() => ({ dependents: [] })),
      ]);
      setCatalog(catalogResponse);
      setAppointments(appointmentResponse.appointments);
      setDependents(dependentsResponse.dependents || dependentsResponse.items || []);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedService = useMemo(
    () => catalog?.services.find((service) => service.id === form.serviceId),
    [catalog, form.serviceId]
  );

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function confirmAppointment(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsBusy(true);
    try {
      let authorizationDocumentId;
      if (form.coverageType === "hmo" && authorizationFile) {
        const upload = await api.uploadHmoAuthorization(authorizationFile);
        authorizationDocumentId = upload.document.id;
      }
      const response = await api.createAppointment({
        ...form,
        forPatientUserId: form.forPatientUserId || undefined,
        authorizationDocumentId,
      });
      setSuccess(`${response.appointment.treatment} was submitted for ${displayDate(response.appointment.date)}.`);
      setForm((current) => ({
        ...current,
        serviceId: "",
        appointmentTime: "",
        hmoProvider: "",
        hmoMemberNumber: "",
        hmoCompanyName: "",
        hmoBirthDate: "",
        notes: "",
      }));
      setAuthorizationFile(null);
      await load();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function cancelAppointment(appointmentId) {
    if (!window.confirm("Cancel this confirmed appointment?")) return;
    setError("");
    try {
      await api.cancelAppointment(appointmentId);
      setAppointments((current) =>
        current.map((appointment) =>
          appointment.id === appointmentId ? { ...appointment, status: "cancelled" } : appointment
        )
      );
    } catch (cancelError) {
      setError(cancelError.message);
    }
  }

  if (error && !catalog) return <ErrorState message={error} onRetry={load} />;
  if (!catalog) return <LoadingState label="Preparing your booking experience" />;

  return (
    <div className="appointments-page">
      <SectionHeading
        eyebrow="Your time, thoughtfully reserved"
        title="Book your appointment"
        detail="Choose your preferred treatment, schedule, and coverage option."
      />

      <div className="booking-progress" aria-label="Appointment booking progress">
        {["Treatment", "Schedule", "Patient details", "Confirmation"].map((step, index) => (
          <span key={step} className={index === 0 ? "is-current" : ""}>
            <b>0{index + 1}</b> {step}
          </span>
        ))}
      </div>

      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {success && <p className="inline-alert inline-alert--success"><Check size={17} /> {success}</p>}

      <form className="booking-layout" onSubmit={confirmAppointment}>
        <div className="booking-form">
          <section className="glass-card booking-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">01 — Treatment</span>
                <h2>Select your care focus</h2>
              </div>
            </div>
            <div className="treatment-grid">
              {catalog.services.map((service) => (
                <button
                  type="button"
                  key={service.id}
                  className={`treatment-option ${form.serviceId === service.id ? "is-selected" : ""}`}
                  onClick={() => setForm((current) => ({ ...current, serviceId: service.id }))}
                >
                  <span className="treatment-option__icon">
                    <Stethoscope size={19} />
                  </span>
                  <strong>{service.name}</strong>
                  <small>{service.description}</small>
                  <em>{service.duration}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="glass-card booking-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">02 — Schedule</span>
                <h2>Find a time that feels right</h2>
              </div>
              <CalendarDays className="card-heading__icon" size={21} />
            </div>
            {dependents.length ? (
              <label className="field" style={{ marginBottom: "1rem" }}>
                <span>Book for</span>
                <select
                  name="forPatientUserId"
                  value={form.forPatientUserId}
                  onChange={updateForm}
                >
                  <option value="">Myself</option>
                  {dependents.map((dependent) => (
                    <option
                      key={dependent.id || dependent.dependentUserId}
                      value={dependent.dependentUserId}
                    >
                      {dependent.fullName || dependent.name || "Dependent"}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="schedule-fields">
              <label className="field">
                <span>Preferred date</span>
                <input
                  type="date"
                  name="appointmentDate"
                  min={tomorrow()}
                  value={form.appointmentDate}
                  onChange={updateForm}
                  required
                />
              </label>
            </div>
            <div className="time-filter-row">
              {Object.keys(TIME_SLOTS).map((period) => (
                <button
                  type="button"
                  key={period}
                  className={`filter-pill ${timePeriod === period ? "is-active" : ""}`}
                  onClick={() => setTimePeriod(period)}
                >
                  {period}
                </button>
              ))}
            </div>
            <div className="time-slots">
              {TIME_SLOTS[timePeriod].map((time) => (
                <button
                  type="button"
                  key={time}
                  className={`time-slot ${form.appointmentTime === time ? "is-selected" : ""}`}
                  onClick={() => setForm((current) => ({ ...current, appointmentTime: time }))}
                >
                  <Clock3 size={15} /> {displayTime(time)}
                </button>
              ))}
            </div>
          </section>

          <section className="glass-card booking-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">03 — Coverage</span>
                <h2>Will you be using an HMO?</h2>
              </div>
              <ShieldCheck className="card-heading__icon" size={21} />
            </div>
            <div className="coverage-options">
              <label className={`coverage-option ${form.coverageType === "hmo" ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="coverageType"
                  value="hmo"
                  checked={form.coverageType === "hmo"}
                  onChange={updateForm}
                />
                <span>
                  <strong>Yes, I have HMO coverage</strong>
                  <small>We’ll securely validate your benefits before your visit.</small>
                </span>
              </label>
              <label className={`coverage-option ${form.coverageType === "self_pay" ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="coverageType"
                  value="self_pay"
                  checked={form.coverageType === "self_pay"}
                  onChange={updateForm}
                />
                <span>
                  <strong>No, I’ll pay out of pocket</strong>
                  <small>Pay at the clinic after your visit.</small>
                </span>
              </label>
            </div>

            {form.coverageType === "hmo" && (
              <div className="hmo-fields">
                <div className="field-row">
                  <label className="field">
                    <span>HMO provider</span>
                    <input name="hmoProvider" value={form.hmoProvider} onChange={updateForm} required />
                  </label>
                  <label className="field">
                    <span>Member number</span>
                    <input name="hmoMemberNumber" value={form.hmoMemberNumber} onChange={updateForm} required />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Company name</span>
                    <input name="hmoCompanyName" value={form.hmoCompanyName} onChange={updateForm} required />
                  </label>
                  <label className="field">
                    <span>Birth date</span>
                    <input
                      type="date"
                      name="hmoBirthDate"
                      value={form.hmoBirthDate}
                      onChange={updateForm}
                      required
                    />
                  </label>
                </div>
                <label className="file-drop">
                  <FileUp size={21} />
                  <span>
                    <strong>Upload authorization document</strong>
                    <small>{authorizationFile ? authorizationFile.name : "PDF, JPG, or PNG — up to 5 MB"}</small>
                  </span>
                  <input
                    type="file"
                    accept=".pdf,image/jpeg,image/png"
                    onChange={(event) => setAuthorizationFile(event.target.files?.[0] || null)}
                  />
                </label>
              </div>
            )}
          </section>

          <section className="glass-card booking-section booking-section--notes">
            <label className="field">
              <span>Anything your care team should know? <small>(optional)</small></span>
              <textarea
                name="notes"
                rows="3"
                value={form.notes}
                onChange={updateForm}
                placeholder="Share accessibility needs, concerns, or preferences."
              />
            </label>
          </section>
        </div>

        <aside className="booking-summary">
          <span className="eyebrow">04 — Confirmation</span>
          <h2>Your visit summary</h2>
          <div className="booking-summary__line">
            <span>Treatment</span>
            <strong>{selectedService?.name || "Select a treatment"}</strong>
          </div>
          <div className="booking-summary__line">
            <span>Date</span>
            <strong>{form.appointmentDate ? displayDate(form.appointmentDate) : "Choose a date"}</strong>
          </div>
          <div className="booking-summary__line">
            <span>Time</span>
            <strong>{form.appointmentTime ? displayTime(form.appointmentTime) : "Choose a time"}</strong>
          </div>
          <div className="booking-summary__line">
            <span>Coverage</span>
            <strong>{form.coverageType === "hmo" ? "HMO coverage" : "Out of pocket"}</strong>
          </div>
          <button
            className="button button--primary button--wide"
            disabled={isBusy || !form.serviceId || !form.appointmentTime}
          >
            {isBusy ? "Submitting your request…" : "Request appointment"} <ChevronRight size={18} />
          </button>
          <p>Final treatment recommendations are confirmed by your dental team.</p>
        </aside>
      </form>

      <section className="appointment-history">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Your schedule</span>
            <h2>Appointments</h2>
          </div>
        </div>
        {appointments.length ? (
          <div className="appointment-list">
            {appointments.map((appointment) => (
              <article className="appointment-row" key={appointment.id}>
                <span className={`status-pill status-pill--${appointment.status}`}>{appointment.status.replaceAll("_", " ")}</span>
                <div>
                  <strong>{appointment.treatment}</strong>
                  <small>{appointment.dentist} · {appointment.location}</small>
                </div>
                <div>
                  <strong>{displayDate(appointment.date)}</strong>
                  <small>{displayTime(appointment.time)}</small>
                </div>
                {["confirmed", "pending"].includes(appointment.status) ? (
                  <button className="icon-button icon-button--danger" onClick={() => cancelAppointment(appointment.id)} aria-label="Cancel appointment">
                    <X size={17} />
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Your schedule is open"
            detail="Choose a treatment above to reserve a premium care visit."
          />
        )}
      </section>
    </div>
  );
}
