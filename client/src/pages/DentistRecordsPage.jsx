import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DentalChart } from "../components/DentalChart";
import {
  PROCEDURE_FORM_OPTIONS,
  procedureFormValue,
  procedureRequiresTooth,
} from "../components/DentalChart/dentalChartData";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistModal } from "../components/DentistUI";
import { formatDentistDate } from "../dentistUtils";
import { matchesNotificationFocus } from "../notificationFocus";

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
  forCurrentVisit: false,
};

const emptyAgeSexForm = {
  age: "",
  gender: "",
  dateOfBirth: "",
};

function todayIsoDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function newProcedureDraft() {
  return {
    key: `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    treatmentDate: todayIsoDate(),
    durationMinutes: "",
    toothNumber: "",
    diagnosisNotes: "",
    amountCharged: "",
  };
}

function parseToothList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function ProcedureFields({ draft, onChange, requiredTooth }) {
  return (
    <div className="field-grid field-grid--two">
      <label className="field">
        <span>Treatment Type</span>
        <select required value={draft.name} onChange={(event) => onChange({ name: event.target.value })}>
          <option value="">Select Treatment</option>
          {PROCEDURE_FORM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label || option.value}
            </option>
          ))}
          {draft.name && !PROCEDURE_FORM_OPTIONS.some((option) => option.value === draft.name) ? (
            <option value={draft.name}>{draft.name}</option>
          ) : null}
        </select>
      </label>
      <label className="field">
        <span>Treatment Date</span>
        <input
          type="date"
          required
          value={draft.treatmentDate}
          onChange={(event) => onChange({ treatmentDate: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Amount</span>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={draft.amountCharged}
          onChange={(event) => onChange({ amountCharged: event.target.value })}
          placeholder="₱"
        />
      </label>
      <label className="field">
        <span>Tooth Number{requiredTooth ? "" : " (optional)"}</span>
        <input
          value={draft.toothNumber}
          onChange={(event) => onChange({ toothNumber: event.target.value })}
          placeholder={requiredTooth ? "Click the tooth on the chart" : "Optional — or click the chart"}
          required={requiredTooth}
        />
      </label>
      <label className="field field--full">
        <span>Diagnosis</span>
        <textarea
          rows="2"
          value={draft.diagnosisNotes}
          onChange={(event) => onChange({ diagnosisNotes: event.target.value })}
          placeholder="e.g. Dental Caries"
        />
      </label>
    </div>
  );
}

function formatMoney(value) {
  return `₱${Number(value || 0).toFixed(2)}`;
}

function procedureStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "planned" || value === "pending") return "Pending";
  if (value === "in_progress") return "In Progress";
  if (value === "completed") return "Completed";
  return status ? String(status).replaceAll("_", " ") : "—";
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
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [treatmentDrafts, setTreatmentDrafts] = useState(() => [newProcedureDraft()]);
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const [procedureErrors, setProcedureErrors] = useState({});
  const [treatmentFormOpen, setTreatmentFormOpen] = useState(false);
  const [savingTreatment, setSavingTreatment] = useState(false);
  const [editingTreatmentId, setEditingTreatmentId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingTreatment, setDeletingTreatment] = useState(false);
  const [chartRefreshKey, setChartRefreshKey] = useState(0);
  const [ageSexOpen, setAgeSexOpen] = useState(false);
  const [ageSexForm, setAgeSexForm] = useState(emptyAgeSexForm);
  const treatmentFormRef = useRef(null);
  const focusHandledRef = useRef("");
  const focusedRowRef = useRef(null);
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");

  const load = useCallback(async (options = {}) => {
    try {
      const response = await api.getDentistPatients(applied, options);
      setPatients(response.patients);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const focusId = searchParams.get("focus");
    if (focusId) setFocusKey(focusId);
    if (!focusId || !patients?.length) return;
    if (focusHandledRef.current === focusId) return;
    const match = patients.find((patient) =>
      matchesNotificationFocus(patient, focusId, ["id", "linkedUserId", "patientId", "recordCode"])
    );
    focusHandledRef.current = focusId;
    if (match) {
      viewPatient(match);
    } else {
      api
        .getDentistPatient(focusId)
        .then((response) => {
          if (response?.patient) viewPatient(response.patient);
        })
        .catch(() => {});
    }
    const timer = window.setTimeout(() => {
      focusedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    setSearchParams(next, { replace: true });
    return () => window.clearTimeout(timer);
  }, [searchParams, setSearchParams, patients]);

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

  async function refreshPatientDetail(patientId, { silent = false } = {}) {
    const response = await api.getDentistPatient(patientId, { silent });
    setDetail(response);
    try {
      const xrayResponse = await api.getDentistPatientXrays(patientId, { silent });
      setXrays(xrayResponse.xrays || []);
    } catch {
      setXrays([]);
    }
    return response;
  }

  async function viewPatient(patient) {
    try {
      setTreatmentForm(emptyTreatment);
      setTreatmentDrafts([newProcedureDraft()]);
      setActiveDraftIndex(0);
      setProcedureErrors({});
      setTreatmentFormOpen(false);
      setEditingTreatmentId(null);
      setDeleteTarget(null);
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
      setSuccess(response.message || "Age and Sex updated and synced to the patient profile.");
      setAgeSexOpen(false);
      await refreshPatientDetail(detail.patient.id);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  function revealTreatmentForm() {
    setTreatmentFormOpen(true);
    window.requestAnimationFrame(() => {
      treatmentFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function openAddTreatment() {
    setError("");
    setSuccess("");
    setEditingTreatmentId(null);
    setTreatmentForm(emptyTreatment);
    setTreatmentDrafts([newProcedureDraft()]);
    setActiveDraftIndex(0);
    setProcedureErrors({});
    revealTreatmentForm();
  }

  function appendProcedureDraft() {
    setEditingTreatmentId(null);
    setTreatmentDrafts((current) => {
      const next = [...current, newProcedureDraft()];
      setActiveDraftIndex(next.length - 1);
      return next;
    });
    setProcedureErrors((current) => ({ ...current }));
    revealTreatmentForm();
  }

  function openAddAnotherProcedure() {
    setError("");
    setSuccess("");
    if (treatmentFormOpen && !editingTreatmentId) {
      appendProcedureDraft();
      return;
    }
    openAddTreatment();
  }

  function closeTreatmentForm() {
    setTreatmentFormOpen(false);
    setTreatmentForm(emptyTreatment);
    setTreatmentDrafts([newProcedureDraft()]);
    setActiveDraftIndex(0);
    setProcedureErrors({});
    setEditingTreatmentId(null);
  }

  function updateProcedureDraft(index, patch) {
    setTreatmentDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft))
    );
    setProcedureErrors((current) => {
      if (current[index] == null) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
  }

  function removeProcedureDraft(index) {
    setTreatmentDrafts((current) => {
      if (current.length <= 1) return current;
      const next = current.filter((_, draftIndex) => draftIndex !== index);
      setActiveDraftIndex((active) => Math.min(active, next.length - 1));
      return next;
    });
    setProcedureErrors((current) => {
      const next = {};
      Object.entries(current).forEach(([key, message]) => {
        const from = Number(key);
        if (from === index) return;
        next[from > index ? from - 1 : from] = message;
      });
      return next;
    });
  }

  function startEditTreatment(event, treatment) {
    event.preventDefault();
    event.stopPropagation();
    setError("");
    setSuccess("");
    setEditingTreatmentId(treatment.id);
    setTreatmentForm({
      name: procedureFormValue(treatment.name || treatment.treatment || ""),
      treatmentDate: String(treatment.date || treatment.treatmentDate || "").slice(0, 10),
      durationMinutes: treatment.durationMinutes != null ? String(treatment.durationMinutes) : "",
      toothNumber: treatment.toothNumber || treatment.tooth_number || "",
      diagnosisNotes: treatment.diagnosis || treatment.diagnosisNotes || "",
      amountCharged: treatment.amountCharged != null ? String(treatment.amountCharged) : "",
    });
    setTreatmentDrafts([newProcedureDraft()]);
    setActiveDraftIndex(0);
    setProcedureErrors({});
    revealTreatmentForm();
  }

  function validateProcedureDraft(draft, index) {
    if (!String(draft.name || "").trim()) {
      return `Procedure ${index + 1}: Select a treatment type.`;
    }
    if (procedureRequiresTooth(draft.name) && !parseToothList(draft.toothNumber).length) {
      return `Procedure ${index + 1}: Tooth is required for ${draft.name}. Select it on the dental chart.`;
    }
    if (draft.amountCharged !== "" && !Number.isFinite(Number(draft.amountCharged))) {
      return `Procedure ${index + 1}: Enter a valid amount.`;
    }
    if (Number(draft.amountCharged) < 0) {
      return `Procedure ${index + 1}: Amount cannot be negative.`;
    }
    return "";
  }

  async function saveTreatment(event) {
    event.preventDefault();
    if (!detail?.patient?.id) return;
    setError("");
    setSuccess("");

    if (editingTreatmentId) {
      if (procedureRequiresTooth(treatmentForm.name) && !parseToothList(treatmentForm.toothNumber).length) {
        setError("Affected tooth is required for this treatment.");
        return;
      }
      setSavingTreatment(true);
      try {
        const payload = {
          name: treatmentForm.name,
          treatment: treatmentForm.name,
          treatmentDate: treatmentForm.treatmentDate || todayIsoDate(),
          durationMinutes: Number(treatmentForm.durationMinutes) || undefined,
          diagnosisNotes: treatmentForm.diagnosisNotes,
          diagnosis: treatmentForm.diagnosisNotes,
          amountCharged: treatmentForm.amountCharged === "" ? 0 : Number(treatmentForm.amountCharged),
          toothNumber: treatmentForm.toothNumber || "",
        };
        const response = await api.updateDentistTreatment(detail.patient.id, editingTreatmentId, payload);
        setSuccess(response.message || "Treatment saved. Dental chart updated automatically.");
        closeTreatmentForm();
        await refreshPatientDetail(detail.patient.id, { silent: true });
        setChartRefreshKey((key) => key + 1);
        await load({ silent: true });
      } catch (saveError) {
        setError(saveError.message);
      } finally {
        setSavingTreatment(false);
      }
      return;
    }

    const errors = {};
    treatmentDrafts.forEach((draft, index) => {
      const message = validateProcedureDraft(draft, index);
      if (message) errors[index] = message;
    });
    if (Object.keys(errors).length) {
      setProcedureErrors(errors);
      const first = errors[Math.min(...Object.keys(errors).map(Number))];
      setError(first);
      const firstIndex = Number(Object.keys(errors).sort((a, b) => Number(a) - Number(b))[0]);
      setActiveDraftIndex(firstIndex);
      return;
    }

    setSavingTreatment(true);
    setProcedureErrors({});
    try {
      const attachToVisit = Boolean(detail.currentVisit?.queueEntryId);
      const response = await api.addDentistTreatment(detail.patient.id, {
        forCurrentVisit: attachToVisit,
        queueEntryId: detail.currentVisit?.queueEntryId || undefined,
        appointmentId: detail.currentVisit?.appointmentId || undefined,
        procedures: treatmentDrafts.map((draft) => ({
          name: draft.name,
          treatment: draft.name,
          treatmentDate: draft.treatmentDate || todayIsoDate(),
          durationMinutes: Number(draft.durationMinutes) || undefined,
          diagnosisNotes: draft.diagnosisNotes,
          diagnosis: draft.diagnosisNotes,
          amountCharged: draft.amountCharged === "" ? 0 : Number(draft.amountCharged),
          toothNumber: draft.toothNumber || undefined,
        })),
      });
      setSuccess(response.message || "Procedures saved. Dental chart updated automatically.");
      closeTreatmentForm();
      await refreshPatientDetail(detail.patient.id, { silent: true });
      setChartRefreshKey((key) => key + 1);
      await load({ silent: true });
    } catch (saveError) {
      setError(saveError.message);
      if (Number.isInteger(saveError.data?.procedureIndex)) {
        setProcedureErrors({ [saveError.data.procedureIndex]: saveError.message });
        setActiveDraftIndex(saveError.data.procedureIndex);
      }
    } finally {
      setSavingTreatment(false);
    }
  }

  async function confirmDeleteTreatment() {
    if (!detail?.patient?.id || !deleteTarget?.id) return;
    setDeletingTreatment(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.deleteDentistTreatment(detail.patient.id, deleteTarget.id);
      setSuccess(
        response.message || "Treatment deleted. Dental chart recalculated from the remaining treatments."
      );
      setDeleteTarget(null);
      if (editingTreatmentId === deleteTarget.id) closeTreatmentForm();
      await refreshPatientDetail(detail.patient.id, { silent: true });
      setChartRefreshKey((key) => key + 1);
      await load({ silent: true });
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeletingTreatment(false);
    }
  }

  const toothRequired = procedureRequiresTooth(treatmentForm.name);

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
                  <th>Age</th>
                  <th>Sex</th>
                  <th>Treatment</th>
                  <th>Treatment Date</th>
                  <th>Amount Paid</th>
                  <th>Next Appointment</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr
                    key={patient.id}
                    ref={
                      matchesNotificationFocus(patient, focusKey, [
                        "id",
                        "linkedUserId",
                        "patientId",
                        "recordCode",
                      ])
                        ? focusedRowRef
                        : null
                    }
                    className={
                      matchesNotificationFocus(patient, focusKey, [
                        "id",
                        "linkedUserId",
                        "patientId",
                        "recordCode",
                      ])
                        ? "is-notification-focus"
                        : undefined
                    }
                  >
                    <td>
                      <strong>{patient.fullName || patient.patientName}</strong>
                      <small>
                        <code>{patient.patientId || patient.recordCode || patient.profileCode || patient.id}</code>
                      </small>
                    </td>
                    <td>
                      {patient.age != null && patient.age !== "" ? patient.age : "—"}
                    </td>
                    <td>{patient.gender || "—"}</td>
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
          <section className="dentist-patient-info">
            <div className="dentist-panel__heading">
              <div>
                <span className="eyebrow">Shared patient record</span>
                <h2>Patient Information</h2>
              </div>
              <div className="treatment-record__actions">
                {!isProfileLocked(detail.patient) ? (
                  <button
                    type="button"
                    className="button button--secondary button--compact"
                    onClick={openAgeSexEditor}
                  >
                    Edit Age and Sex
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`button ${treatmentFormOpen && !editingTreatmentId ? "button--secondary" : "button--primary"}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (treatmentFormOpen && !editingTreatmentId) {
                      closeTreatmentForm();
                    } else {
                      openAddTreatment();
                    }
                  }}
                >
                  {treatmentFormOpen && !editingTreatmentId ? (
                    "− Close Treatment Form"
                  ) : (
                    <>
                      <Plus size={16} /> Add Treatment
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="dentist-detail-grid">
              <p>
                <strong>Patient ID:</strong>{" "}
                {detail.patient.patientId || detail.patient.recordCode || detail.patient.id}
              </p>
              <p>
                <strong>Name:</strong> {detail.patient.fullName || detail.patient.patientName}
              </p>
              <p>
                <strong>Age:</strong>{" "}
                {detail.patient.age != null && detail.patient.age !== "" ? detail.patient.age : "—"}
              </p>
              <p>
                <strong>Sex:</strong> {detail.patient.gender || "—"}
              </p>
              <p>
                <strong>Birthdate:</strong>{" "}
                {detail.patient.dateOfBirth ? formatDentistDate(detail.patient.dateOfBirth) : "—"}
              </p>
              <p>
                <strong>Phone Number:</strong> {detail.patient.phone || "—"}
              </p>
              <p>
                <strong>Email:</strong> {detail.patient.email || "—"}
              </p>
              <p>
                <strong>Category:</strong> {detail.patient.patientCategory || "—"}
              </p>
              <p>
                <strong>Record type:</strong>{" "}
                {isProfileLocked(detail.patient)
                  ? "Linked account (profile synced)"
                  : "Walk-in clinical record"}
              </p>
              <p>
                <strong>Next Appointment:</strong>{" "}
                {nextAppointmentLabel(null, detail.nextAppointment, detail.patient)}
              </p>
            </div>
            {isProfileLocked(detail.patient) ? (
              <p className="muted-copy">
                Patient ID, Name, Age, Sex, Birthdate, and Phone Number are synced from the patient
                account profile and are read-only here.
              </p>
            ) : null}
          </section>

          {ageSexOpen && !isProfileLocked(detail.patient) ? (
            <form className="dentist-form" onSubmit={saveAgeSex} style={{ marginBottom: "1rem" }}>
              <div className="dentist-panel__heading">
                <div>
                  <span className="eyebrow">Demographics</span>
                  <h2>Edit Age and Sex</h2>
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
                  {busy ? "Saving…" : "Save Age and Sex"}
                </button>
              </div>
            </form>
          ) : null}

          <div
            ref={treatmentFormRef}
            className={`dentist-treatment-form dentist-treatment-form--inline ${
              treatmentFormOpen ? "is-open" : ""
            }`}
          >
            <div
              className={`dentist-treatment-form__panel ${treatmentFormOpen ? "is-open" : ""}`}
              aria-hidden={!treatmentFormOpen}
            >
              {treatmentFormOpen ? (
                <>
                  <div className="dentist-panel__heading">
                    <div>
                      <span className="eyebrow">Clinical information</span>
                      <h2>{editingTreatmentId ? "Edit Treatment" : "Add Treatment"}</h2>
                    </div>
                  </div>
                  <p className="muted-copy">
                    {editingTreatmentId
                      ? "The selected treatment is loaded below. Change any field and Save Changes to update this record only — the dental chart recalculates automatically."
                      : "Add every procedure for this visit here, then save once. Click a procedure section, then click its tooth on the dental chart below. All procedures stay on the same check-in."}
                  </p>
                  <form className="dentist-form" onSubmit={saveTreatment}>
                    {editingTreatmentId ? (
                      <ProcedureFields
                        draft={treatmentForm}
                        requiredTooth={toothRequired}
                        onChange={(patch) =>
                          setTreatmentForm((current) => ({
                            ...current,
                            ...patch,
                          }))
                        }
                      />
                    ) : (
                      <>
                        {treatmentDrafts.map((draft, index) => (
                          <section
                            key={draft.key}
                            className={`procedure-draft ${activeDraftIndex === index ? "is-active" : ""}`}
                            onClick={() => setActiveDraftIndex(index)}
                          >
                            <div className="procedure-draft__header">
                              <strong>
                                Treatment {index + 1}
                                {draft.name ? ` · ${draft.name}` : ""}
                                {parseToothList(draft.toothNumber).length
                                  ? ` · #${parseToothList(draft.toothNumber).join(", #")}`
                                  : ""}
                              </strong>
                              {treatmentDrafts.length > 1 ? (
                                <button
                                  type="button"
                                  className="button button--secondary button--compact"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    removeProcedureDraft(index);
                                  }}
                                  disabled={savingTreatment}
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                            {activeDraftIndex === index ? (
                              <p className="muted-copy">
                                This procedure is selected. Click its tooth on the dental chart below.
                              </p>
                            ) : (
                              <p className="muted-copy">Click this section to assign teeth from the chart.</p>
                            )}
                            <ProcedureFields
                              draft={draft}
                              requiredTooth={procedureRequiresTooth(draft.name)}
                              onChange={(patch) => {
                                setActiveDraftIndex(index);
                                updateProcedureDraft(index, patch);
                              }}
                            />
                            {procedureErrors[index] ? (
                              <p className="inline-alert inline-alert--error">{procedureErrors[index]}</p>
                            ) : null}
                          </section>
                        ))}
                        <button
                          type="button"
                          className="button button--secondary"
                          onClick={(event) => {
                            event.preventDefault();
                            appendProcedureDraft();
                          }}
                          disabled={savingTreatment}
                        >
                          <Plus size={16} /> Add Another Procedure
                        </button>
                        <div className="procedure-draft-summary">
                          <strong>Current visit draft</strong>
                          <ul>
                            {treatmentDrafts.map((draft, index) => (
                              <li key={`${draft.key}-summary`}>
                                Procedure {index + 1}: {draft.name || "Not selected"}
                                {parseToothList(draft.toothNumber).length
                                  ? ` — #${parseToothList(draft.toothNumber).join(", #")}`
                                  : ""}
                                {draft.amountCharged !== ""
                                  ? ` — ${formatMoney(draft.amountCharged)}`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                          <span>
                            Total procedures: {treatmentDrafts.length}
                            {" · "}
                            Total amount:{" "}
                            {formatMoney(
                              treatmentDrafts.reduce(
                                (sum, draft) => sum + (Number(draft.amountCharged) || 0),
                                0
                              )
                            )}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="dentist-form__actions">
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={closeTreatmentForm}
                        disabled={savingTreatment}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="button button--primary" disabled={savingTreatment}>
                        {savingTreatment
                          ? editingTreatmentId
                            ? "Saving Changes…"
                            : "Saving Procedures…"
                          : editingTreatmentId
                            ? "Save Changes"
                            : "Save All Procedures"}
                      </button>
                    </div>
                  </form>
                </>
              ) : null}
            </div>
          </div>

          <DentalChart
            patientId={detail.patient.id}
            patientCategory={detail.patient.patientCategory}
            patientAge={detail.patient.age}
            refreshKey={chartRefreshKey}
            pickMode={treatmentFormOpen}
            selectedTeeth={parseToothList(
              editingTreatmentId
                ? treatmentForm.toothNumber
                : treatmentDrafts[activeDraftIndex]?.toothNumber
            )}
            onTeethChange={(teeth) => {
              const toothNumber = teeth.join(", ");
              if (editingTreatmentId) {
                setTreatmentForm((current) => ({ ...current, toothNumber }));
                return;
              }
              updateProcedureDraft(activeDraftIndex, { toothNumber });
            }}
          />

          {detail.currentVisit?.procedures?.length || detail.currentVisit?.queueEntryId ? (
            <section className="treatment-record" style={{ marginTop: "1.25rem" }}>
              <div className="treatment-record__header">
                <div>
                  <span className="eyebrow">Current visit</span>
                  <h2>Today&apos;s Procedures</h2>
                  <p className="muted-copy">
                    Queue {detail.currentVisit.token || "—"}. All procedures stay on this same check-in.
                  </p>
                </div>
                <button
                  type="button"
                  className={`button ${treatmentFormOpen && !editingTreatmentId ? "button--secondary" : "button--primary"}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (treatmentFormOpen && !editingTreatmentId) {
                      appendProcedureDraft();
                    } else {
                      openAddTreatment();
                    }
                  }}
                >
                  <Plus size={16} />{" "}
                  {treatmentFormOpen && !editingTreatmentId ? "Add Another Procedure" : "Add Treatment"}
                </button>
              </div>
              {(detail.currentVisit.procedures || []).length ? (
                <ol className="visit-procedure-list">
                  {(detail.currentVisit.procedures || []).map((procedure, index) => (
                    <li key={procedure.id || index}>
                      <strong>
                        {index + 1}. {procedure.treatment || procedure.name}
                      </strong>
                      <span>
                        Tooth: {procedure.toothNumber ? `#${procedure.toothNumber}` : "—"}
                      </span>
                      <span>Status: {procedureStatusLabel(procedure.status)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted-copy">No procedures recorded for this visit yet.</p>
              )}
            </section>
          ) : null}

          <section className="treatment-record" style={{ marginTop: "1.25rem" }}>
            <div className="treatment-record__header">
              <div>
                <span className="eyebrow">Shared patient dental record</span>
                <h2>Dental Treatment History</h2>
              </div>
              <button
                type="button"
                className={`button ${treatmentFormOpen && !editingTreatmentId ? "button--secondary" : "button--primary"}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (treatmentFormOpen && !editingTreatmentId) {
                    closeTreatmentForm();
                  } else {
                    openAddTreatment();
                  }
                }}
              >
                {treatmentFormOpen && !editingTreatmentId ? (
                  "− Close Treatment Form"
                ) : (
                  <>
                    <Plus size={16} /> Add Treatment
                  </>
                )}
              </button>
            </div>
            <p className="muted-copy">
              Amount Paid stays in this table. Staff update payments; the dental chart updates from
              these treatment rows.
            </p>

            <div className="treatment-record__table-wrap">
              {(detail.treatments || []).length ? (
                <table className="treatment-record__table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Tooth</th>
                      <th>Procedure</th>
                      <th>Status</th>
                      <th>Diagnosis</th>
                      <th>Dentist</th>
                      <th>Amount Charged</th>
                      <th>Amount Paid</th>
                      <th>Balance</th>
                      <th>Next Appointment</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.treatments.map((treatment) => (
                      <tr key={treatment.id}>
                        <td>{formatDentistDate(treatment.date || treatment.treatmentDate)}</td>
                        <td>
                          {treatment.toothNumber || treatment.tooth_number
                            ? `#${treatment.toothNumber || treatment.tooth_number}`
                            : "—"}
                        </td>
                        <td>{treatment.name || treatment.treatment || "—"}</td>
                        <td>{procedureStatusLabel(treatment.status)}</td>
                        <td>{treatment.diagnosis || treatment.diagnosisNotes || "—"}</td>
                        <td>{treatment.dentist || "—"}</td>
                        <td>{formatMoney(treatment.amountCharged)}</td>
                        <td>{formatMoney(treatment.amountPaid)}</td>
                        <td>{formatMoney(treatmentBalance(treatment))}</td>
                        <td>{nextAppointmentLabel(treatment, detail.nextAppointment, detail.patient)}</td>
                        <td>
                          <div className="treatment-record__actions">
                            <button
                              type="button"
                              className="button button--secondary button--compact"
                              onClick={(event) => startEditTreatment(event, treatment)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button button--danger button--compact"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setDeleteTarget(treatment);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted-copy">No treatments on file yet.</p>
              )}
            </div>
          </section>

          <section className="dentist-xray-panel">
            <div className="dentist-panel__heading">
              <div>
                <span className="eyebrow">Imaging</span>
                <h2>X-rays & AI analysis</h2>
              </div>
            </div>
            <p className="muted-copy">
              AI findings are preliminary / supplementary only and are separate from the dental chart.
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
        </DentistModal>
      ) : null}

      {deleteTarget ? (
        <DentistModal
          stacked
          title="Delete Treatment?"
          onClose={() => {
            if (!deletingTreatment) setDeleteTarget(null);
          }}
        >
          <p className="dentist-confirm-copy">
            This will remove the treatment record and update the dental chart.
          </p>
          <div className="dentist-detail-grid">
            <p>
              <strong>Tooth:</strong>{" "}
              {deleteTarget.toothNumber ? `#${deleteTarget.toothNumber}` : "—"}
            </p>
            <p>
              <strong>Treatment:</strong> {deleteTarget.name || deleteTarget.treatment || "—"}
            </p>
            <p>
              <strong>Diagnosis:</strong>{" "}
              {deleteTarget.diagnosis || deleteTarget.diagnosisNotes || "—"}
            </p>
            <p>
              <strong>Date:</strong>{" "}
              {formatDentistDate(deleteTarget.date || deleteTarget.treatmentDate)}
            </p>
          </div>
          <p className="muted-copy">This action will also update the dental chart.</p>
          <div className="dentist-modal__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingTreatment}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={confirmDeleteTreatment}
              disabled={deletingTreatment}
            >
              {deletingTreatment ? "Deleting…" : "Delete Treatment"}
            </button>
          </div>
        </DentistModal>
      ) : null}
    </div>
  );
}
