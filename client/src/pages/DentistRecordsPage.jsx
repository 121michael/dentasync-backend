import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api } from "../api";
import { DentalChart } from "../components/DentalChart";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistModal } from "../components/DentistUI";
import { formatDentistDate, formatDentistDateTime } from "../dentistUtils";

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
  durationMinutes: "",
  toothNumber: "",
  diagnosisNotes: "",
  notes: "",
};

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
      await refreshPatientDetail(patient.id);
      setError("");
    } catch (viewError) {
      setError(viewError.message);
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
        durationMinutes: Number(treatmentForm.durationMinutes) || undefined,
        toothNumber: treatmentForm.toothNumber || undefined,
        diagnosisNotes: treatmentForm.diagnosisNotes,
        notes: treatmentForm.notes,
      });
      setSuccess(response.message || "Treatment recorded.");
      setTreatmentForm(emptyTreatment);
      await refreshPatientDetail(detail.patient.id);
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
                  <th>Patient Profile ID</th>
                  <th>Full Name</th>
                  <th>Phone Contact</th>
                  <th>Age / Sex</th>
                  <th>Last Treatment Action</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.id}>
                    <td>
                      <code>{patient.recordCode || patient.profileCode || patient.id}</code>
                    </td>
                    <td>
                      <strong>{patient.fullName || patient.patientName}</strong>
                    </td>
                    <td>{patient.phone || "—"}</td>
                    <td>
                      {patient.ageSex || [patient.age ?? "—", patient.gender || "—"].join(" / ")}
                    </td>
                    <td>
                      <span className="dentist-date-pill">
                        {formatDentistDate(
                          patient.lastTreatmentDate || patient.lastTreatment,
                          "No visits yet"
                        )}
                      </span>
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
              <strong>ID:</strong> {detail.patient.id}
            </p>
            <p>
              <strong>Phone:</strong> {detail.patient.phone || "—"}
            </p>
            <p>
              <strong>Email:</strong> {detail.patient.email || "—"}
            </p>
            <p>
              <strong>Age / Sex:</strong> {detail.patient.ageSex}
            </p>
          </div>

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
                <span className="eyebrow">Chairside note</span>
                <h2>Add treatment</h2>
              </div>
            </div>
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
                  <span>Tooth (FDI)</span>
                  <input
                    value={treatmentForm.toothNumber}
                    onChange={(event) =>
                      setTreatmentForm((current) => ({
                        ...current,
                        toothNumber: event.target.value,
                      }))
                    }
                    placeholder="11"
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
                <span>Additional notes</span>
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

          <h3 className="admin-subheading">Treatment history</h3>
          <div className="admin-history-list">
            {(detail.treatments || []).length ? (
              detail.treatments.map((treatment) => (
                <article key={treatment.id}>
                  <div>
                    <strong>{treatment.name || treatment.treatment}</strong>
                    <small>
                      {formatDentistDateTime(treatment.date)}
                      {treatment.toothNumber || treatment.tooth_number
                        ? ` · Tooth ${treatment.toothNumber || treatment.tooth_number}`
                        : ""}
                      {treatment.dentist ? ` · ${treatment.dentist}` : ""}
                      {` · ${treatment.status || "completed"}`}
                    </small>
                    {treatment.diagnosisNotes || treatment.diagnosis_notes ? (
                      <small>{treatment.diagnosisNotes || treatment.diagnosis_notes}</small>
                    ) : null}
                    {treatment.notes ? <small>{treatment.notes}</small> : null}
                  </div>
                </article>
              ))
            ) : (
              <p className="muted-copy">No treatments on file.</p>
            )}
          </div>
        </DentistModal>
      ) : null}
    </div>
  );
}
