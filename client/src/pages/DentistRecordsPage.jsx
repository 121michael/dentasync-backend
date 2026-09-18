import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api } from "../api";
import { DentalChart } from "../components/DentalChart";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistModal } from "../components/DentistUI";
import { formatDentistDate } from "../dentistUtils";

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  gender: "",
  notes: "",
};

const emptyTreatment = {
  name: "",
  treatmentDate: "",
  durationMinutes: "",
  toothNumber: "",
  diagnosisNotes: "",
  amountCharged: "",
  notes: "",
};

const emptyAgeSexForm = {
  age: "",
  gender: "",
  dateOfBirth: "",
};

function formatMoney(value) {
  return `₱${Number(value || 0).toFixed(2)}`;
}

function formatAgeSex(patient) {
  if (patient?.ageSex) return patient.ageSex;
  const age = patient?.age != null && patient.age !== "" ? patient.age : "—";
  const sex = patient?.gender || "—";
  return `${age} / ${sex}`;
}

function treatmentBalance(treatment) {
  if (treatment?.balance != null && Number.isFinite(Number(treatment.balance))) {
    return Number(treatment.balance);
  }
  return Math.round((Number(treatment?.amountCharged || 0) - Number(treatment?.amountPaid || 0)) * 100) / 100;
}

function nextAppointmentLabel(treatment, fallbackAppointment, patient) {
  const next =
    treatment?.nextAppointment ||
    fallbackAppointment ||
    (patient?.nextAppointmentDate
      ? { date: patient.nextAppointmentDate, time: patient.nextAppointmentTime }
      : null);
  if (!next?.date) return "—";
  const dateLabel = formatDentistDate(next.date);
  return next.time ? `${dateLabel} ${String(next.time).slice(0, 5)}` : dateLabel;
}

export function DentistRecordsPage() {
  const [patients, setPatients] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [xrays, setXrays] = useState([]);
  const [treatmentForm, setTreatmentForm] = useState(emptyTreatment);
  const [ageSexOpen, setAgeSexOpen] = useState(false);
  const [ageSexForm, setAgeSexForm] = useState(emptyAgeSexForm);

  const load = useCallback(async () => {
    try {
      const response = await api.getDentistPatients(applied);
      setPatients(response.patients);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  async function createPatient(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.createDentistPatient(form);
      setSuccess(response.message);
      setFormOpen(false);
      setForm(emptyForm);
      await load();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshPatientDetail(patientId) {
    const response = await api.getDentistPatient(patientId);
    setDetail(response);
    try {
      const xrayResponse = await api.getDentistPatientXrays(patientId);
      setXrays(xrayResponse.xrays || []);
    } catch {
      setXrays([]);
    }
    return response;
  }

  async function viewPatient(patient) {
    try {
      setTreatmentForm(emptyTreatment);
      setAgeSexOpen(false);
      await refreshPatientDetail(patient.id);
      setError("");
    } catch (viewError) {
      setError(viewError.message);
    }
  }

  function isProfileLocked(patient = detail?.patient) {
    return Boolean(patient?.profileLocked || patient?.accountLinked || patient?.linkedUserId);
  }

  function openAgeSexEditor() {
    if (!detail?.patient) return;
    if (isProfileLocked(detail.patient)) {
      setError(
        "Basic patient information comes from the patient account profile and cannot be edited here."
      );
      return;
    }
    setAgeSexForm({
      age: detail.patient.age != null ? String(detail.patient.age) : "",
      gender: detail.patient.gender || "",
      dateOfBirth: detail.patient.dateOfBirth
        ? String(detail.patient.dateOfBirth).slice(0, 10)
        : "",
    });
    setAgeSexOpen(true);
  }

  async function saveAgeSex(event) {
    event.preventDefault();
    if (!detail?.patient?.id) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        gender: ageSexForm.gender,
      };
      if (ageSexForm.dateOfBirth) {
        payload.dateOfBirth = ageSexForm.dateOfBirth;
      } else if (ageSexForm.age !== "") {
        payload.age = Number(ageSexForm.age);
      }
      const response = await api.updateDentistPatient(detail.patient.id, payload);
      setSuccess(response.message || "Age / Sex updated and synced to the patient profile.");
      setAgeSexOpen(false);
      await refreshPatientDetail(detail.patient.id);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveTreatment(event) {
    event.preventDefault();
    if (!detail?.patient?.id) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.addDentistTreatment(detail.patient.id, {
        name: treatmentForm.name,
        treatment: treatmentForm.name,
        treatmentDate: treatmentForm.treatmentDate || undefined,
        durationMinutes: Number(treatmentForm.durationMinutes) || undefined,
        toothNumber: treatmentForm.toothNumber || undefined,
        diagnosisNotes: treatmentForm.diagnosisNotes,
        amountCharged: treatmentForm.amountCharged === "" ? 0 : Number(treatmentForm.amountCharged),
        notes: treatmentForm.notes,
      });
      setSuccess(response.message || "Treatment record saved successfully.");
      setTreatmentForm(emptyTreatment);
      await refreshPatientDetail(detail.patient.id);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !patients) {
    const needsMigration = /migrate:clinical-records/i.test(error);
    return (
      <ErrorState
        message={
          needsMigration
            ? "Patient records need a database update. In C:\\DentaSync-git run: npm run migrate:clinical-records, then restart npm start."
            : error
        }
        onRetry={load}
      />
    );
  }
  if (!patients) return <LoadingState label="Loading dental records vault…" />;

  return (
    <div className="dentist-page">
      <SectionHeading
        eyebrow="Clinical archive"
        title="Dental Records Vault"
        detail="Create clinical patient records for charting. These are not login accounts — patients self-register for the portal."
        action={
          <button className="button button--primary" onClick={() => setFormOpen(true)}>
            <Plus size={16} /> Add New Patient
          </button>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="dentist-panel">
        <form
          className="dentist-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search.trim());
          }}
        >
          <label className="dentist-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search histories by patient keyword or ID..."
            />
          </label>
          <button className="button button--secondary button--compact">Search</button>
        </form>

        <div className="dentist-panel__heading">
          <div>
            <span className="eyebrow">Registry</span>
            <h2>Patient Search Registry Array</h2>
          </div>
        </div>

        {patients.length ? (
          <div className="dentist-table-wrap">
            <table className="dentist-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Age / Sex</th>
                  <th>Treatment</th>
                  <th>Treatment Date</th>
                  <th>Amount Paid</th>
                  <th>Next Appointment</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.id}>
                    <td>
                      <strong>{patient.fullName || patient.patientName}</strong>
                      <small>
                        <code>{patient.recordCode || patient.profileCode || patient.id}</code>
                      </small>
                    </td>
                    <td>{formatAgeSex(patient)}</td>
                    <td>{patient.lastTreatment || patient.lastTreatmentName || "—"}</td>
                    <td>
                      {formatDentistDate(
                        patient.lastTreatmentDate || patient.lastVisit || patient.lastTreatment,
                        "—"
                      )}
                    </td>
                    <td>
                      {patient.amountPaid != null && patient.amountPaid !== ""
                        ? formatMoney(patient.amountPaid)
                        : "—"}
                    </td>
                    <td>
                      {patient.nextAppointmentDate
                        ? `${formatDentistDate(patient.nextAppointmentDate)}${
                            patient.nextAppointmentTime
                              ? ` ${String(patient.nextAppointmentTime).slice(0, 5)}`
                              : ""
                          }`
                        : "—"}
                    </td>
                    <td>
                      <button
                        className="button button--secondary button--compact"
                        onClick={() => viewPatient(patient)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No records found."
            detail="Patients assigned to your clinical schedule will appear here."
          />
        )}
      </section>

      {formOpen ? (
        <DentistModal title="Add Clinical Patient Record" onClose={() => setFormOpen(false)}>
          <form className="dentist-form" onSubmit={createPatient}>
            <p className="muted-copy">
              Creates a clinical chart record only — not a patient login account.
            </p>
            <div className="field-grid field-grid--two">
              <label className="field">
                <span>First Name</span>
                <input
                  value={form.firstName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, firstName: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Last Name</span>
                <input
                  value={form.lastName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, lastName: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Email (optional)</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>Phone (optional)</span>
                <input
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>Date of Birth</span>
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, dateOfBirth: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>Sex</span>
                <input
                  value={form.gender}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, gender: event.target.value }))
                  }
                  placeholder="Female / Male"
                />
              </label>
            </div>
            <div className="dentist-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button className="button button--primary" disabled={busy}>
                {busy ? "Saving…" : "Save Clinical Record"}
              </button>
            </div>
          </form>
        </DentistModal>
      ) : null}

      {detail ? (
        <DentistModal title={detail.patient.fullName} onClose={() => setDetail(null)} wide>
          <div className="dentist-detail-grid">
            <p>
              <strong>Patient ID:</strong> {detail.patient.recordCode || detail.patient.id}
            </p>
            <p>
              <strong>Name:</strong> {detail.patient.fullName || detail.patient.patientName}
            </p>
            <p>
              <strong>Sex:</strong> {detail.patient.gender || "—"}
            </p>
            <p>
              <strong>Age:</strong>{" "}
              {detail.patient.age != null && detail.patient.age !== "" ? detail.patient.age : "—"}
            </p>
            <p>
              <strong>Birthdate:</strong>{" "}
              {detail.patient.dateOfBirth
                ? formatDentistDate(detail.patient.dateOfBirth)
                : "—"}
            </p>
            <p>
              <strong>Phone:</strong> {detail.patient.phone || "—"}
            </p>
            <p>
              <strong>Email:</strong> {detail.patient.email || "—"}
            </p>
            <p>
              <strong>Record type:</strong>{" "}
              {isProfileLocked(detail.patient) ? "Linked account (profile synced)" : "Walk-in clinical record"}
            </p>
            <p>
              <strong>Age / Sex:</strong> {formatAgeSex(detail.patient)}{" "}
              {!isProfileLocked(detail.patient) ? (
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={openAgeSexEditor}
                >
                  Edit
                </button>
              ) : null}
            </p>
            <p>
              <strong>Next Appointment (staff):</strong>{" "}
              {nextAppointmentLabel(null, detail.nextAppointment, detail.patient)}
            </p>
            <p>
              <strong>Amount Paid (staff):</strong>{" "}
              {detail.patient.amountPaid != null && detail.patient.amountPaid !== ""
                ? formatMoney(detail.patient.amountPaid)
                : detail.treatments?.[0]?.amountPaid != null
                  ? formatMoney(detail.treatments[0].amountPaid)
                  : "—"}
            </p>
          </div>

          {isProfileLocked(detail.patient) ? (
            <p className="muted-copy">
              Name, Sex, Age, Birthdate, and Phone are synced from the patient account profile and
              are read-only here.
            </p>
          ) : null}

          {ageSexOpen && !isProfileLocked(detail.patient) ? (
            <form className="dentist-form" onSubmit={saveAgeSex} style={{ marginBottom: "1rem" }}>
              <div className="dentist-panel__heading">
                <div>
                  <span className="eyebrow">Demographics</span>
                  <h2>Edit Age / Sex</h2>
                </div>
              </div>
              <p className="muted-copy">
                For walk-in patients without an account. Prefer birthdate so age stays synchronized.
              </p>
              <div className="field-grid field-grid--two">
                <label className="field">
                  <span>Age</span>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={ageSexForm.age}
                    onChange={(event) =>
                      setAgeSexForm((current) => ({ ...current, age: event.target.value }))
                    }
                    placeholder="21"
                  />
                </label>
                <label className="field">
                  <span>Sex</span>
                  <input
                    value={ageSexForm.gender}
                    onChange={(event) =>
                      setAgeSexForm((current) => ({ ...current, gender: event.target.value }))
                    }
                    placeholder="Male / Female"
                    required
                  />
                </label>
                <label className="field">
                  <span>Date of Birth (optional)</span>
                  <input
                    type="date"
                    value={ageSexForm.dateOfBirth}
                    onChange={(event) =>
                      setAgeSexForm((current) => ({ ...current, dateOfBirth: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="dentist-modal__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setAgeSexOpen(false)}
                >
                  Cancel
                </button>
                <button className="button button--primary" disabled={busy}>
                  {busy ? "Saving…" : "Save Age / Sex"}
                </button>
              </div>
            </form>
          ) : null}

          <DentalChart
            patientId={detail.patient.id}
            dentistName={detail.patient.assignedDentist || ""}
            onTreatmentRecorded={() => refreshPatientDetail(detail.patient.id)}
          />

          <section className="dentist-xray-panel">
            <div className="dentist-panel__heading">
              <div>
                <span className="eyebrow">Imaging</span>
                <h2>X-rays & AI analysis</h2>
              </div>
            </div>
            <p className="muted-copy">
              AI findings are preliminary / supplementary only and are separate from the manual dental
              chart.
            </p>
            {xrays.length ? (
              <div className="xray-list">
                {xrays.map((xray) => (
                  <article className="xray-row" key={xray.id}>
                    <div>
                      <strong>{xray.name || "X-ray image"}</strong>
                      <small>
                        {formatDentistDate(xray.uploadedAt)}
                        {xray.analysis?.confidence != null
                          ? ` · Confidence ${xray.analysis.confidence}%`
                          : ""}
                      </small>
                      <span
                        className={`status-pill status-pill--${String(
                          xray.analysis?.status || "unavailable"
                        ).replaceAll("_", "-")}`}
                      >
                        {String(xray.analysis?.status || "unavailable").replaceAll("_", " ")}
                      </span>
                      {xray.analysis?.summary ? (
                        <p className="muted-copy">{xray.analysis.summary}</p>
                      ) : null}
                      <p className="xray-disclaimer">
                        {xray.analysis?.disclaimer ||
                          "Preliminary / supplementary information only. Not a clinical diagnosis."}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-copy">No uploaded X-rays for this linked patient account.</p>
            )}
          </section>

          <section className="dentist-treatment-form">
            <div className="dentist-panel__heading">
              <div>
                <span className="eyebrow">Clinical information</span>
                <h2>Add treatment</h2>
              </div>
            </div>
            <p className="muted-copy">
              Enter diagnosis, procedure, and clinical notes. Amount paid and next appointment are
              managed by Staff on this same shared record.
            </p>
            <form className="dentist-form" onSubmit={saveTreatment}>
              <div className="field-grid field-grid--two">
                <label className="field">
                  <span>Procedure</span>
                  <input
                    required
                    value={treatmentForm.name}
                    onChange={(event) =>
                      setTreatmentForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="e.g. Composite filling"
                  />
                </label>
                <label className="field">
                  <span>Treatment Date</span>
                  <input
                    type="date"
                    value={treatmentForm.treatmentDate}
                    onChange={(event) =>
                      setTreatmentForm((current) => ({
                        ...current,
                        treatmentDate: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Treatment Cost (Amount Charged)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={treatmentForm.amountCharged}
                    onChange={(event) =>
                      setTreatmentForm((current) => ({
                        ...current,
                        amountCharged: event.target.value,
                      }))
                    }
                    placeholder="1500"
                  />
                </label>
                <label className="field">
                  <span>Duration (minutes)</span>
                  <input
                    type="number"
                    min="1"
                    value={treatmentForm.durationMinutes}
                    onChange={(event) =>
                      setTreatmentForm((current) => ({
                        ...current,
                        durationMinutes: event.target.value,
                      }))
                    }
                    placeholder="45"
                  />
                </label>
                <label className="field">
                  <span>Tooth No/s (FDI)</span>
                  <input
                    value={treatmentForm.toothNumber}
                    onChange={(event) =>
                      setTreatmentForm((current) => ({
                        ...current,
                        toothNumber: event.target.value,
                      }))
                    }
                    placeholder="16 or 16, 17"
                  />
                </label>
                <label className="field">
                  <span>Diagnosis notes</span>
                  <input
                    value={treatmentForm.diagnosisNotes}
                    onChange={(event) =>
                      setTreatmentForm((current) => ({
                        ...current,
                        diagnosisNotes: event.target.value,
                      }))
                    }
                    placeholder="Clinical findings"
                  />
                </label>
              </div>
              <label className="field">
                <span>Dentist notes</span>
                <textarea
                  rows="2"
                  value={treatmentForm.notes}
                  onChange={(event) =>
                    setTreatmentForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </label>
              <button className="button button--primary" disabled={busy}>
                {busy ? "Saving…" : "Save treatment"}
              </button>
            </form>
          </section>

          <section className="treatment-record">
            <div className="treatment-record__header">
              <div>
                <span className="eyebrow">Shared patient dental record</span>
                <h2>Treatment Record</h2>
              </div>
            </div>

            <div className="treatment-record__patient">
              <p>
                <small>Name</small>
                <strong>{detail.patient.fullName || detail.patient.patientName || "—"}</strong>
              </p>
              <p>
                <small>Age / Sex</small>
                <strong>{formatAgeSex(detail.patient)}</strong>
              </p>
              <p>
                <small>Contact</small>
                <strong>{detail.patient.phone || detail.patient.email || "—"}</strong>
              </p>
            </div>

            <div className="treatment-record__table-wrap">
              {(detail.treatments || []).length ? (
                <table className="treatment-record__table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Tooth No/s</th>
                      <th>Procedure</th>
                      <th>Diagnosis</th>
                      <th>Dentist</th>
                      <th>Amount Charged</th>
                      <th>Amount Paid (staff)</th>
                      <th>Balance</th>
                      <th>Next Appt. (staff)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.treatments.map((treatment) => (
                      <tr key={treatment.id}>
                        <td>{formatDentistDate(treatment.date || treatment.treatmentDate)}</td>
                        <td>{treatment.toothNumber || treatment.tooth_number || "—"}</td>
                        <td>{treatment.name || treatment.treatment || "—"}</td>
                        <td>{treatment.diagnosisNotes || "—"}</td>
                        <td>{treatment.dentist || "—"}</td>
                        <td>{formatMoney(treatment.amountCharged)}</td>
                        <td>{formatMoney(treatment.amountPaid)}</td>
                        <td>{formatMoney(treatmentBalance(treatment))}</td>
                        <td>{nextAppointmentLabel(treatment, detail.nextAppointment, detail.patient)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted-copy">No treatments on file.</p>
              )}
            </div>
            {(detail.treatments || []).some((treatment) => treatment.notes) ? (
              <div style={{ marginTop: "1rem" }}>
                <h3 className="admin-subheading">Dentist notes</h3>
                {(detail.treatments || [])
                  .filter((treatment) => treatment.notes)
                  .map((treatment) => (
                    <p key={`note-${treatment.id}`} className="muted-copy">
                      <strong>{treatment.name || treatment.treatment}:</strong> {treatment.notes}
                    </p>
                  ))}
              </div>
            ) : null}
          </section>
        </DentistModal>
      ) : null}
    </div>
  );
}
