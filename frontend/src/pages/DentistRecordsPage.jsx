import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  HeartPulse,
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DentalChart } from "../components/DentalChart";
import {
  PROCEDURE_FORM_OPTIONS,
  procedureFormValue,
  procedureRequiresTooth,
} from "../components/DentalChart/dentalChartData";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistModal } from "../components/DentistUI";
import { DentalDocumentPreview } from "../components/DentalDocumentPreview";
import { PrescriptionsPanel } from "../components/PrescriptionsPanel";
import { formatDentistDate } from "../dentistUtils";
import { displayDateOfBirth, displaySex } from "../patientDemographics";
import { matchesNotificationFocus } from "../notificationFocus";
import { useAuth } from "../useAuth";

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

function treatmentToForm(treatment) {
  return {
    name: procedureFormValue(treatment?.name || treatment?.treatment || ""),
    treatmentDate: String(treatment?.date || treatment?.treatmentDate || "").slice(0, 10),
    durationMinutes: treatment?.durationMinutes != null ? String(treatment.durationMinutes) : "",
    toothNumber: treatment?.toothNumber || treatment?.tooth_number || "",
    diagnosisNotes: treatment?.diagnosis || treatment?.diagnosisNotes || "",
    amountCharged: treatment?.amountCharged != null ? String(treatment.amountCharged) : "",
  };
}

const emptyAgeSexForm = {
  age: "",
  gender: "",
  dateOfBirth: "",
};

const emptyWellnessForm = {
  oralHealthScore: "",
  assessmentDate: "",
  clinicalNotes: "",
  nextCheckup: "",
};

function wellnessFormFromDetail(response) {
  const wellness = response?.wellness || {};
  return {
    oralHealthScore:
      wellness.hasAssessment && wellness.oralHealthScore != null ? String(wellness.oralHealthScore) : "",
    assessmentDate: wellness.assessmentDate ? String(wellness.assessmentDate).slice(0, 10) : todayIsoDate(),
    clinicalNotes: wellness.clinicalNotes || "",
    nextCheckup: wellness.nextCheckup ? String(wellness.nextCheckup).slice(0, 10) : "",
  };
}

function todayIsoDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function newProcedureDraft(treatmentDate = todayIsoDate()) {
  return {
    key: `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    treatmentDate: treatmentDate || todayIsoDate(),
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

function listValue(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "—";
}

const RECORD_MENU = [
  {
    id: "personal",
    title: "Personal Information",
    description: "View and update your personal details",
    icon: UserRound,
  },
  {
    id: "emergency",
    title: "Emergency Contact",
    description: "Manage your emergency contact details",
    icon: ShieldCheck,
  },
  {
    id: "clinical",
    title: "Clinical Information",
    description: "Review your dental and clinical information",
    icon: HeartPulse,
  },
  {
    id: "coverage",
    title: "Coverage and Wellness",
    description: "View your coverage and wellness information",
    icon: CalendarDays,
  },
];

function FieldValue({ label, children, warning = false }) {
  const value = children == null || children === "" ? "—" : children;
  return (
    <div className={`field${warning ? " field--warning" : ""}`}>
      <span>{label}</span>
      <p className="field-readonly">{value}</p>
    </div>
  );
}

function StatusBadge({ status, children }) {
  const tone = String(status || "pending")
    .toLowerCase()
    .replaceAll(" ", "_");
  return <span className={`dentist-status dentist-status--${tone}`}>{children || procedureStatusLabel(status)}</span>;
}

function hasRestrictedCrossBranchHistory(detail) {
  if (!detail) return false;
  if (typeof detail.hasRestrictedCrossBranchHistory === "boolean") {
    return detail.hasRestrictedCrossBranchHistory;
  }
  if (typeof detail.access?.hasRestrictedCrossBranchHistory === "boolean") {
    return detail.access.hasRestrictedCrossBranchHistory;
  }
  return false;
}

function AccessRecordHistory({
  patientId,
  onAuthorized,
  grantExpiresAt,
  requestOpenRef,
  compact = false,
  allowRequest = false,
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const onAuthorizedRef = useRef(onAuthorized);
  onAuthorizedRef.current = onAuthorized;
  const dentistName = user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Signed-in dentist";

  useEffect(() => {
    if (!requestOpenRef) return undefined;
    requestOpenRef.current = allowRequest
      ? () => {
          setOpen(true);
          setPassword("");
          setMessage("");
        }
      : null;
    return () => {
      requestOpenRef.current = null;
    };
  }, [requestOpenRef, allowRequest]);

  useEffect(() => {
    if (!grantExpiresAt) return undefined;
    const wait = new Date(grantExpiresAt).getTime() - Date.now();
    if (wait <= 0) return undefined;
    const timer = window.setTimeout(() => onAuthorizedRef.current?.("Restricted access has expired."), wait + 250);
    return () => window.clearTimeout(timer);
  }, [grantExpiresAt]);

  function closeModal() {
    setOpen(false);
    setPassword("");
    setMessage("");
  }

  async function unlockRecords(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await api.unlockDentistRecordAccess(patientId, {
        licenseNumber,
        password,
      });
      setPassword("");
      setOpen(false);
      onAuthorizedRef.current?.(response.message || "Restricted records are available for the permitted history.");
    } catch (requestError) {
      setPassword("");
      setMessage(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {compact ? null : (
        <section className="glass-card profile-section dentist-access-history">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Authorized history</span>
              <h2>Access Record History</h2>
            </div>
            <KeyRound className="card-heading__icon" size={21} />
          </div>
          <p className="muted-copy">
            Ordinary history you are authorized to read. Restricted notes from other permitted branches stay hidden until
            you verify your Admin-configured authorization credential.
          </p>
          {allowRequest ? (
            <button
              className="button button--primary"
              type="button"
              data-request-record-access="true"
              onClick={() => {
                setOpen(true);
                setPassword("");
                setMessage("");
              }}
            >
              Request Record Access
            </button>
          ) : null}
        </section>
      )}
      {open ? (
        <DentistModal title="Request Record Access" className="dentist-modal--request-access" onClose={closeModal}>
          <form className="dentist-request-access" autoComplete="off" onSubmit={unlockRecords}>
            <input type="text" name="username" autoComplete="username" hidden readOnly tabIndex={-1} aria-hidden="true" value="" />
            <label>
              Dentist Name
              <input value={dentistName} readOnly tabIndex={-1} autoComplete="off" />
            </label>
            <label>
              License Number
              <input
                value={licenseNumber}
                autoComplete="off"
                name="ds-record-access-license"
                required
                onChange={(event) => setLicenseNumber(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                name="ds-record-access-password"
                autoComplete="off"
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Checking…" : "Access Records"}
            </button>
            {message ? <p className="dentist-request-access__error">{message}</p> : null}
          </form>
        </DentistModal>
      ) : null}
    </>
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
  const navigate = useNavigate();
  const { patientId } = useParams();
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
  const [treatmentForm, setTreatmentForm] = useState(emptyTreatment);
  const [treatmentDrafts, setTreatmentDrafts] = useState(() => [newProcedureDraft()]);
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const [procedureErrors, setProcedureErrors] = useState({});
  const [treatmentFormOpen, setTreatmentFormOpen] = useState(false);
  const [savingTreatment, setSavingTreatment] = useState(false);
  const [editingTreatmentId, setEditingTreatmentId] = useState(null);
  const [editSnapshot, setEditSnapshot] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingTreatment, setDeletingTreatment] = useState(false);
  const [chartRefreshKey, setChartRefreshKey] = useState(0);
  const [ageSexOpen, setAgeSexOpen] = useState(false);
  const [ageSexForm, setAgeSexForm] = useState(emptyAgeSexForm);
  const [wellnessForm, setWellnessForm] = useState(emptyWellnessForm);
  const [savingWellness, setSavingWellness] = useState(false);
  const [medicalDocuments, setMedicalDocuments] = useState([]);
  const [medicalDocumentsMessage, setMedicalDocumentsMessage] = useState("");
  const [medicalDocumentsBusy, setMedicalDocumentsBusy] = useState("");
  const [filesOpen, setFilesOpen] = useState(() => searchParams.get("files") === "1");
  const openFilesFromQuery = searchParams.get("files") === "1";
  const filesSectionRef = useRef(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  const previewUrlRef = useRef("");
  const treatmentFormRef = useRef(null);
  const requestAccessRef = useRef(null);
  const focusHandledRef = useRef("");
  const focusedRowRef = useRef(null);
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");
  const [recordSection, setRecordSection] = useState(null);
  const [reviewVisit, setReviewVisit] = useState(null);
  const [reviewingOutcome, setReviewingOutcome] = useState("");

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
    if (patientId) return undefined;
    load();
    return undefined;
  }, [load, patientId]);

  useEffect(() => {
    function onBranchChange() {
      setPatients(null);
      setDetail(null);
      if (patientId) {
        navigate("/dentist/patient-records");
        return;
      }
      load();
    }
    window.addEventListener("dentasync-branch-change", onBranchChange);
    return () => window.removeEventListener("dentasync-branch-change", onBranchChange);
  }, [load, navigate, patientId]);

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
      navigate(`/dentist/patient-records/${match.id}`);
    } else {
      api
        .getDentistPatient(focusId)
        .then((response) => {
          if (response?.patient?.id) navigate(`/dentist/patient-records/${response.patient.id}`);
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
  }, [searchParams, setSearchParams, patients, navigate]);

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

  const refreshPatientDetail = useCallback(async (recordId, { silent = false } = {}) => {
    const response = await api.getDentistPatient(recordId, { silent });
    setDetail(response);
    setWellnessForm(wellnessFormFromDetail(response));
    try {
      const documents = await api.getDentistMedicalDocuments(recordId, { silent: true });
      setMedicalDocuments(documents.documents || []);
      setMedicalDocumentsMessage(documents.message || documents.disclaimer || "");
    } catch {
      setMedicalDocuments([]);
      setMedicalDocumentsMessage("");
    }
    return response;
  }, []);

  function closeDocumentPreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
    setDocumentPreview(null);
  }

  async function viewDentalDocument(document) {
    setError("");
    try {
      const file = await api.viewDentistMedicalDocument(detail.patient.id, document);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const objectUrl = URL.createObjectURL(file.blob);
      previewUrlRef.current = objectUrl;
      setDocumentPreview({
        document: {
          ...document,
          mimeType: file.mimeType || document.mimeType,
          filename: file.filename || document.filename,
        },
        objectUrl,
        error: "",
      });
    } catch (viewError) {
      setDocumentPreview({
        document,
        objectUrl: "",
        error: viewError.message || "This dental document could not be opened.",
      });
    }
  }

  function downloadDentalDocument(document) {
    api.downloadDentistMedicalDocument(detail.patient.id, document).catch((downloadError) => {
      setError(downloadError.message);
    });
  }

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function openPatientRecord(patient) {
    if (!patient?.id) return;
    navigate(`/dentist/patient-records/${patient.id}`);
  }

  useEffect(() => {
    if (!patientId) {
      setDetail(null);
      setMedicalDocuments([]);
      setMedicalDocumentsMessage("");
      return undefined;
    }
    let cancelled = false;
    setTreatmentForm(emptyTreatment);
    setTreatmentDrafts([newProcedureDraft()]);
    setActiveDraftIndex(0);
    setProcedureErrors({});
    setTreatmentFormOpen(false);
    setEditingTreatmentId(null);
    setEditSnapshot(null);
    setDeleteTarget(null);
    setAgeSexOpen(false);
    setSavingWellness(false);
    setFilesOpen(openFilesFromQuery);
    setRecordSection(openFilesFromQuery ? "clinical" : null);
    setDetail(null);
    refreshPatientDetail(patientId)
      .then(() => {
        if (!cancelled) setError("");
      })
      .catch((viewError) => {
        if (!cancelled) {
          setDetail(null);
          setError(viewError.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, refreshPatientDetail, openFilesFromQuery]);

  function isProfileLocked(patient = detail?.patient) {
    return Boolean(patient?.profileLocked || patient?.accountLinked || patient?.linkedUserId);
  }

  function openAgeSexEditor() {
    if (!detail?.patient) return;
    setRecordSection("personal");
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

  function resetWellnessForm() {
    setWellnessForm(wellnessFormFromDetail(detail));
    setError("");
  }

  async function saveWellnessAssessment(event) {
    event.preventDefault();
    if (!detail?.patient?.id) return;
    setSavingWellness(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.saveDentistWellnessAssessment(detail.patient.id, {
        oralHealthScore: wellnessForm.oralHealthScore === "" ? "" : Number(wellnessForm.oralHealthScore),
        assessmentDate: wellnessForm.assessmentDate,
        clinicalNotes: wellnessForm.clinicalNotes,
        nextCheckup: wellnessForm.nextCheckup,
      });
      setSuccess(response.message || "Dental wellness assessment saved.");
      await refreshPatientDetail(detail.patient.id, { silent: true });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingWellness(false);
    }
  }

  function revealTreatmentForm() {
    setTreatmentFormOpen(true);
    window.requestAnimationFrame(() => {
      treatmentFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function requestCloseEdit() {
    if (!editingTreatmentId) return true;
    if (savingTreatment) return false;
    if (editSnapshot && JSON.stringify(treatmentForm) !== JSON.stringify(editSnapshot)) {
      const confirmed = window.confirm(
        "You have unsaved changes. Discard them and close Edit Treatment?"
      );
      if (!confirmed) return false;
    }
    setEditingTreatmentId(null);
    setTreatmentForm(emptyTreatment);
    setEditSnapshot(null);
    return true;
  }

  function openAddTreatment(visit = null) {
    if (!requestCloseEdit()) return;
    setRecordSection("clinical");
    setError("");
    setSuccess("");
    setReviewVisit(visit || null);
    setTreatmentForm(emptyTreatment);
    setTreatmentDrafts([newProcedureDraft(visit?.visitDate)]);
    setActiveDraftIndex(0);
    setProcedureErrors({});
    revealTreatmentForm();
  }

  async function finalizeReviewVisit(visit, outcome) {
    if (!detail?.patient?.id || !visit?.queueEntryId) return;
    const confirmed = window.confirm(
      outcome === "completed"
        ? `Complete visit ${visit.token || visit.queueEntryId} from ${visit.visitDate || "this visit"}? This updates the encounter, appointment, and queue to Completed.`
        : `Cancel visit ${visit.token || visit.queueEntryId} from ${visit.visitDate || "this visit"}? Saved treatments, notes, prescriptions, and audit history stay on the record.`
    );
    if (!confirmed) return;
    let reason = null;
    if (outcome === "cancelled") {
      reason = window.prompt("Enter a cancellation reason for this visit.");
      if (reason == null) return;
      reason = String(reason).trim();
      if (reason.length < 3) {
        setError("A cancellation reason is required.");
        return;
      }
    }
    setReviewingOutcome(`${visit.queueEntryId}:${outcome}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.reviewDentistQueueVisit(detail.patient.id, visit.queueEntryId, { outcome, reason });
      setSuccess(response.message || "Visit review saved.");
      if (reviewVisit?.queueEntryId === visit.queueEntryId) setReviewVisit(null);
      await refreshPatientDetail(detail.patient.id, { silent: true });
    } catch (err) {
      setError(err.message || "Unable to finalize this visit.");
    } finally {
      setReviewingOutcome("");
    }
  }

  function appendProcedureDraft() {
    if (!requestCloseEdit()) return;
    setEditingTreatmentId(null);
    setEditSnapshot(null);
    setTreatmentDrafts((current) => {
      const next = [...current, newProcedureDraft(reviewVisit?.visitDate)];
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
    setEditSnapshot(null);
    setReviewVisit(null);
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
    setTreatmentFormOpen(false);
    setTreatmentDrafts([newProcedureDraft()]);
    setActiveDraftIndex(0);
    setProcedureErrors({});
    const next = treatmentToForm(treatment);
    setEditingTreatmentId(treatment.id);
    setTreatmentForm(next);
    setEditSnapshot(next);
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
        setEditingTreatmentId(null);
        setTreatmentForm(emptyTreatment);
        setEditSnapshot(null);
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
      const attachVisit = reviewVisit || detail.currentVisit;
      const attachToVisit = Boolean(attachVisit?.queueEntryId);
      const response = await api.addDentistTreatment(detail.patient.id, {
        forCurrentVisit: attachToVisit,
        queueEntryId: attachVisit?.queueEntryId || undefined,
        appointmentId: attachVisit?.appointmentId || undefined,
        procedures: treatmentDrafts.map((draft) => ({
          name: draft.name,
          treatment: draft.name,
          treatmentDate: draft.treatmentDate || attachVisit?.visitDate || todayIsoDate(),
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

  function toggleUploadedFiles() {
    setRecordSection("clinical");
    setFilesOpen((open) => {
      const next = !open;
      if (next) {
        window.requestAnimationFrame(() => {
          filesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      return next;
    });
  }

  if (!patientId && error && !patients) {
    const needsMigration = /migrate:clinical-records/i.test(error);
    return (
      <ErrorState
        message={
          needsMigration
            ? "Patient records need a database update. In C:\\DentaSync-git\\backend run: npm run migrate:clinical-records, then restart npm start."
            : error
        }
        onRetry={load}
      />
    );
  }
  if (!patientId && !patients) return <LoadingState label="Loading dental records vault…" />;
  if (patientId && !detail && error) {
    return (
      <div className="dentist-page">
        <ErrorState message={error} onRetry={() => refreshPatientDetail(patientId)} />
        <button
          type="button"
          className="button button--secondary"
          onClick={() => navigate("/dentist/patient-records")}
        >
          <ArrowLeft size={16} /> Back to records
        </button>
      </div>
    );
  }
  if (patientId && !detail) return <LoadingState label="Loading patient record…" />;

  return (
    <div className={`dentist-page${patientId ? " dentist-patient-record-page" : ""}`}>
      {patientId && detail ? null : (
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
      )}

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      {!patientId ? (
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
              placeholder="Search by patient name or ID..."
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
            <table className="dentist-table dentist-table--patient-list">
              <thead>
                <tr>
                  <th>Patient ID</th>
                  <th>Patient Name</th>
                  <th>Action</th>
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
                      <code>
                        {listValue(
                          patient.patientId || patient.recordCode || patient.profileCode || patient.id
                        )}
                      </code>
                    </td>
                    <td>
                      <strong>{listValue(patient.fullName || patient.patientName)}</strong>
                    </td>
                    <td>
                      <button
                        className="button button--secondary button--compact"
                        onClick={() => openPatientRecord(patient)}
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
            detail="Search an existing patient by name or patient ID. Treatment history stays with the branch where it was recorded."
          />
        )}
      </section>
      ) : null}

      {formOpen && !patientId ? (
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
        <div className="dentist-patient-record">
          <div className="dentist-record-identity">
            <button
              type="button"
              className="button button--secondary profile-back"
              onClick={() => navigate("/dentist/patient-records")}
            >
              <ArrowLeft size={16} /> Back to Patient Records
            </button>
            <span className="eyebrow">Shared patient record</span>
            <h1>{detail.patient.fullName || detail.patient.patientName || "Patient record"}</h1>
            <p className="dentist-record-identity__id">
              Patient ID · {detail.patient.patientId || detail.patient.recordCode || detail.patient.id}
            </p>
            <div className="dentist-record-identity__actions">
              {hasRestrictedCrossBranchHistory(detail) ? (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => requestAccessRef.current?.()}
                >
                  <KeyRound size={16} /> Request Record Access
                </button>
              ) : null}
              {recordSection === "clinical" ? (
                <>
                  <button
                    type="button"
                    className={`button ${treatmentFormOpen && !editingTreatmentId ? "button--secondary" : "button--primary"}`}
                    onClick={(event) => {
                      event.preventDefault();
                      if (treatmentFormOpen && !editingTreatmentId) closeTreatmentForm();
                      else openAddTreatment();
                    }}
                  >
                    {treatmentFormOpen && !editingTreatmentId ? (
                      "Close Treatment Form"
                    ) : (
                      <>
                        <Plus size={16} /> Add Treatment
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`button ${filesOpen ? "button--primary" : "button--secondary"}`}
                    aria-expanded={filesOpen}
                    onClick={toggleUploadedFiles}
                  >
                    <FolderOpen size={16} /> Dental Documents
                    {medicalDocuments.length ? (
                      <span className="uploaded-files-count">{medicalDocuments.length}</span>
                    ) : null}
                  </button>
                </>
              ) : null}
              {recordSection === "personal" && !isProfileLocked(detail.patient) ? (
                <button type="button" className="button button--secondary" onClick={openAgeSexEditor}>
                  Edit Age and Sex
                </button>
              ) : null}
            </div>
          </div>

          {hasRestrictedCrossBranchHistory(detail) ? (
            <p className="inline-alert inline-alert--warning dentist-restricted-history" role="status">
              {detail.restrictedHistoryMessage ||
                detail.access?.restrictedHistoryMessage ||
                "Treatment history from another branch requires authorization."}
            </p>
          ) : null}

          <AccessRecordHistory
            compact
            allowRequest={hasRestrictedCrossBranchHistory(detail)}
            patientId={patientId}
            patient={detail.patient}
            grantExpiresAt={detail.access?.grantExpiresAt}
            requestOpenRef={requestAccessRef}
            onAuthorized={(notice) => {
              if (notice) setSuccess(notice);
              refreshPatientDetail(patientId);
            }}
          />

          {!recordSection ? (
            <nav className="profile-menu" aria-label="Patient record sections">
              {RECORD_MENU.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="profile-menu__item"
                    onClick={() => setRecordSection(item.id)}
                  >
                    <span className="profile-menu__icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span className="profile-menu__copy">
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                );
              })}
            </nav>
          ) : (
            <button
              type="button"
              className="button button--secondary profile-back"
              onClick={() => setRecordSection(null)}
            >
              <ChevronLeft size={16} /> Back to patient cards
            </button>
          )}

          {recordSection === "personal" ? (
          <section className="glass-card profile-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">About the patient</span>
                <h2>Personal Information</h2>
              </div>
              <UserRound className="card-heading__icon" size={21} />
            </div>
            <div className="field-grid field-grid--two">
              <FieldValue label="Full name">{detail.patient.fullName || detail.patient.patientName}</FieldValue>
              <FieldValue label="Patient ID">
                {detail.patient.patientId || detail.patient.recordCode || detail.patient.id}
              </FieldValue>
              <FieldValue label="Age">
                {detail.patient.age != null && detail.patient.age !== "" ? detail.patient.age : "—"}
              </FieldValue>
              <FieldValue label="Sex">{displaySex(detail.patient.gender)}</FieldValue>
              <FieldValue label="Date of birth">{displayDateOfBirth(detail.patient.dateOfBirth)}</FieldValue>
              <FieldValue label="Patient category">{detail.patient.patientCategory}</FieldValue>
              <FieldValue label="Email address">{detail.patient.email}</FieldValue>
              <FieldValue label="Mobile number">{detail.patient.phone}</FieldValue>
              <FieldValue label="Record type">
                {isProfileLocked(detail.patient) ? "Linked account (profile synced)" : "Walk-in clinical record"}
              </FieldValue>
              <FieldValue label="Next appointment">
                {nextAppointmentLabel(null, detail.nextAppointment, detail.patient)}
              </FieldValue>
            </div>
          </section>
          ) : null}

          {recordSection === "emergency" ? (
          <section className="glass-card profile-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">For peace of mind</span>
                <h2>Emergency Contact</h2>
              </div>
              <ShieldCheck className="card-heading__icon" size={21} />
            </div>
            <div className="field-grid field-grid--three">
              <FieldValue label="Contact name">{detail.patient.emergencyContactName?.trim()}</FieldValue>
              <FieldValue label="Relationship">{detail.patient.emergencyContactRelationship?.trim()}</FieldValue>
              <FieldValue label="Mobile number">{detail.patient.emergencyContactPhone?.trim()}</FieldValue>
            </div>
          </section>
          ) : null}

          {recordSection === "clinical" ? (
          <section className="glass-card profile-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Shared securely with the care team</span>
                <h2>Clinical Information</h2>
              </div>
              <HeartPulse className="card-heading__icon" size={21} />
            </div>
            <div className="field-grid field-grid--two">
              <FieldValue label="Allergies" warning>
                {detail.patient.allergies?.trim()}
              </FieldValue>
              <FieldValue label="Existing conditions">{detail.patient.existingConditions?.trim()}</FieldValue>
              <FieldValue label="Current medications">{detail.patient.currentMedications?.trim()}</FieldValue>
              <FieldValue label="Dental concerns">{detail.patient.dentalConcerns?.trim()}</FieldValue>
            </div>
          </section>
          ) : null}

          {recordSection === "coverage" ? (
          <section className="glass-card profile-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Coverage and Wellness</span>
                <h2>HMO verification</h2>
              </div>
              <CalendarDays className="card-heading__icon" size={21} />
            </div>
            <div className={`verification-status${detail.patient.hmoStatus === "verified" ? "" : " is-pending"}`}>
              <BadgeCheck size={18} />
              <div>
                <strong>
                  {detail.patient.hmoStatus === "verified"
                    ? `HMO Verified${detail.patient.hmoProvider ? ` · ${detail.patient.hmoProvider}` : ""}`
                    : (detail.patient.hmoStatus || "not_enrolled").replaceAll("_", " ")}
                </strong>
                <small>
                  {detail.patient.hmoVerifiedAt
                    ? `Verified ${formatDentistDate(detail.patient.hmoVerifiedAt)}`
                    : "Status is limited to branches this dentist is authorized to view."}
                </small>
              </div>
            </div>
            <div className="field-grid field-grid--two" style={{ marginTop: "1rem" }}>
              <FieldValue label="HMO provider">{detail.patient.hmoProvider}</FieldValue>
              <FieldValue label="Coverage status">
                {(detail.patient.hmoStatus || "not_enrolled").replaceAll("_", " ")}
              </FieldValue>
            </div>
          </section>
          ) : null}

          {recordSection === "personal" && ageSexOpen && !isProfileLocked(detail.patient) ? (
            <form className="glass-card profile-section dentist-form" onSubmit={saveAgeSex}>
              <div className="card-heading">
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

          {recordSection === "coverage" ? (
          <section className="glass-card profile-section treatment-record dentist-wellness-assessment">
            <div className="treatment-record__header">
              <div>
                <span className="eyebrow">Preventive care</span>
                <h2>Dental Wellness Assessment</h2>
              </div>
            </div>
            <p className="muted-copy">
              Enter the patient&apos;s wellness score after a clinical evaluation. Last cleaning is taken
              from completed Oral Prophylaxis in treatment history.
            </p>
            <form className="dentist-form" onSubmit={saveWellnessAssessment}>
              <div className="field-grid field-grid--two">
                <label className="field">
                  <span>Wellness Score</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    required
                    value={wellnessForm.oralHealthScore}
                    onChange={(event) =>
                      setWellnessForm((current) => ({ ...current, oralHealthScore: event.target.value }))
                    }
                    placeholder="0–100"
                  />
                </label>
                <label className="field">
                  <span>Assessment Date</span>
                  <input
                    type="date"
                    required
                    value={wellnessForm.assessmentDate}
                    onChange={(event) =>
                      setWellnessForm((current) => ({ ...current, assessmentDate: event.target.value }))
                    }
                  />
                </label>
                <label className="field field--full">
                  <span>Clinical Assessment / Notes</span>
                  <textarea
                    rows="3"
                    value={wellnessForm.clinicalNotes}
                    onChange={(event) =>
                      setWellnessForm((current) => ({ ...current, clinicalNotes: event.target.value }))
                    }
                    placeholder="Enter assessment notes"
                  />
                </label>
                <label className="field">
                  <span>Last Cleaning</span>
                  <input
                    readOnly
                    value={
                      detail.wellness?.lastCleaning
                        ? formatDentistDate(detail.wellness.lastCleaning)
                        : "Not recorded"
                    }
                  />
                </label>
                <label className="field">
                  <span>Next Recommended Checkup</span>
                  <input
                    type="date"
                    required
                    value={wellnessForm.nextCheckup}
                    onChange={(event) =>
                      setWellnessForm((current) => ({ ...current, nextCheckup: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="dentist-form__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={resetWellnessForm}
                  disabled={savingWellness}
                >
                  Cancel
                </button>
                <button type="submit" className="button button--primary" disabled={savingWellness}>
                  {savingWellness ? "Saving…" : "Save Assessment"}
                </button>
              </div>
            </form>
          </section>
          ) : null}

          {recordSection === "clinical" ? (
          <>
          <div
            ref={treatmentFormRef}
            className={`dentist-treatment-form dentist-treatment-form--inline ${
              treatmentFormOpen ? "is-open glass-card profile-section" : ""
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
                      <h2>Add Treatment</h2>
                      {reviewVisit ? (
                        <p className="muted-copy">
                          Recording against queue {reviewVisit.token || reviewVisit.queueEntryId} from{" "}
                          {reviewVisit.visitDate || "the original visit date"}.
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <p className="muted-copy">
                    Add every procedure for this visit here, then save once. Click a procedure section, then click its tooth on the dental chart below. All procedures stay on the same check-in.
                  </p>
                  <form className="dentist-form" onSubmit={saveTreatment}>
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
                        {savingTreatment ? "Saving Procedures…" : "Save All Procedures"}
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
            pickMode={treatmentFormOpen && !editingTreatmentId}
            selectedTeeth={parseToothList(treatmentDrafts[activeDraftIndex]?.toothNumber)}
            onTeethChange={(teeth) => {
              updateProcedureDraft(activeDraftIndex, { toothNumber: teeth.join(", ") });
            }}
          />

          {(detail.needsReviewVisits || []).length ? (
            <section className="glass-card profile-section treatment-record">
              <div className="treatment-record__header">
                <div>
                  <span className="eyebrow">Closed-day follow-up</span>
                  <h2>Needs end-of-day review</h2>
                  <p className="muted-copy">
                    These encounters were still In Treatment at 6:00 PM on the original clinic date. They are not new
                    queue tickets and are not placed ahead of today&apos;s patients. Add any missing treatment on the
                    original service date, then choose Complete visit or Cancel visit.
                  </p>
                </div>
              </div>
              <div className="dentist-needs-review-list">
                {detail.needsReviewVisits.map((visit) => {
                  const busyKey = reviewingOutcome.startsWith(`${visit.queueEntryId}:`);
                  return (
                    <article key={visit.queueEntryId} className="dentist-needs-review-card">
                      <div className="dentist-needs-review-card__meta">
                        <strong>Queue {visit.token || visit.queueEntryId}</strong>
                        <span>Visit date {visit.visitDate || "—"}</span>
                        <StatusBadge status="needs_review">Needs end-of-day review</StatusBadge>
                      </div>
                      {(visit.procedures || []).length ? (
                        <ol className="visit-procedure-list">
                          {visit.procedures.map((procedure, index) => (
                            <li key={procedure.id || index}>
                              <strong>
                                {index + 1}. {procedure.treatment || procedure.name}
                              </strong>
                              <span>Status: <StatusBadge status={procedure.status} /></span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="muted-copy">No treatment recorded for this visit yet.</p>
                      )}
                      <div className="dentist-needs-review-card__actions">
                        <button
                          type="button"
                          className="button button--secondary"
                          onClick={() => openAddTreatment(visit)}
                        >
                          <Plus size={16} /> Add or verify treatment
                        </button>
                        <button
                          type="button"
                          className="button button--primary"
                          disabled={Boolean(reviewingOutcome)}
                          onClick={() => finalizeReviewVisit(visit, "completed")}
                        >
                          {busyKey && reviewingOutcome.endsWith(":completed") ? "Saving…" : "Complete visit"}
                        </button>
                        <button
                          type="button"
                          className="button button--secondary"
                          disabled={Boolean(reviewingOutcome)}
                          onClick={() => finalizeReviewVisit(visit, "cancelled")}
                        >
                          {busyKey && reviewingOutcome.endsWith(":cancelled") ? "Saving…" : "Cancel visit"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {detail.currentVisit?.procedures?.length || detail.currentVisit?.queueEntryId ? (
            <section className="glass-card profile-section treatment-record">
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
                      <span>Status: <StatusBadge status={procedure.status} /></span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted-copy">No procedures recorded for this visit yet.</p>
              )}
            </section>
          ) : null}

          <section className="glass-card profile-section treatment-record">
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
              {hasRestrictedCrossBranchHistory(detail) ? (
                <p className="inline-alert inline-alert--warning dentist-restricted-history" role="status">
                  {detail.restrictedHistoryMessage ||
                    detail.access?.restrictedHistoryMessage ||
                    "Treatment history from another branch requires authorization."}
                </p>
              ) : null}
              {(detail.treatments || []).length ? (
                <table className="treatment-record__table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Originating branch</th>
                      <th>Recorded</th>
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
                          {treatment.originatingBranchName ||
                            (treatment.attributionReview ? "Unknown" : "—")}
                        </td>
                        <td>{treatment.createdAt ? formatDentistDate(treatment.createdAt) : "—"}</td>
                        <td>
                          {treatment.toothNumber || treatment.tooth_number
                            ? `#${treatment.toothNumber || treatment.tooth_number}`
                            : "—"}
                        </td>
                        <td>{treatment.name || treatment.treatment || "—"}</td>
                        <td><StatusBadge status={treatment.status} /></td>
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

          <section
            ref={filesSectionRef}
            className={`glass-card dentist-medical-docs uploaded-files-folder ${
              filesOpen ? "is-open" : ""
            }`}
          >
            <div className="card-heading uploaded-files-folder__heading">
              <div>
                <span className="eyebrow">Patient uploads</span>
                <h2>Dental Documents</h2>
              </div>
              <button
                type="button"
                className="button button--secondary button--compact"
                aria-expanded={filesOpen}
                onClick={toggleUploadedFiles}
              >
                <FolderOpen size={16} /> {filesOpen ? "Hide files" : "Open folder"}
              </button>
            </div>
            {filesOpen ? (
              <>
                <p className="muted-copy">
                  Files this patient uploaded while booking. The name is the description they entered.
                  Viewing a file does not automatically grant medical clearance.
                </p>
                {medicalDocuments.length ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Filename</th>
                          <th>Uploaded</th>
                          <th>Appointment</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {medicalDocuments.map((document) => (
                          <tr key={document.id}>
                            <td data-label="Document">
                              <strong>{document.name || document.category || "Uploaded file"}</strong>
                            </td>
                            <td data-label="Filename">{document.filename || "—"}</td>
                            <td data-label="Uploaded">
                              {document.uploadedAt
                                ? new Intl.DateTimeFormat("en-US", {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  }).format(new Date(document.uploadedAt))
                                : "—"}
                            </td>
                            <td data-label="Appointment">
                              {document.appointment?.service
                                ? `${document.appointment.service}${
                                    document.appointment.date
                                      ? ` · ${formatDentistDate(document.appointment.date)}`
                                      : ""
                                  }`
                                : "Not linked"}
                            </td>
                            <td className="status-text" data-label="Status">
                              {document.status === "reviewed"
                                ? `Reviewed${document.reviewedByName ? ` by ${document.reviewedByName}` : ""}`
                                : "Uploaded"}
                            </td>
                            <td data-label="Actions">
                              <div className="dental-docs-actions">
                                <button
                                  type="button"
                                  className="button button--primary button--compact"
                                  onClick={() => viewDentalDocument(document)}
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  className="button button--secondary button--compact"
                                  onClick={() => downloadDentalDocument(document)}
                                >
                                  Download
                                </button>
                                {document.status !== "reviewed" ? (
                                  <button
                                    type="button"
                                    className="button button--secondary button--compact"
                                    disabled={medicalDocumentsBusy === document.id}
                                    onClick={async () => {
                                      setMedicalDocumentsBusy(document.id);
                                      try {
                                        const response = await api.reviewDentistMedicalDocument(
                                          detail.patient.id,
                                          document.id
                                        );
                                        setMedicalDocuments((current) =>
                                          current.map((item) =>
                                            item.id === document.id ? response.document : item
                                          )
                                        );
                                        setSuccess(response.message);
                                      } catch (reviewError) {
                                        setError(reviewError.message);
                                      } finally {
                                        setMedicalDocumentsBusy("");
                                      }
                                    }}
                                  >
                                    Mark reviewed
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted-copy">
                    {medicalDocumentsMessage || "No dental documents have been uploaded for this patient."}
                  </p>
                )}
              </>
            ) : (
              <p className="muted-copy uploaded-files-folder__hint">
                {medicalDocuments.length
                  ? `${medicalDocuments.length} file${medicalDocuments.length === 1 ? "" : "s"} on file. Open the folder to review.`
                  : "Open the folder to review files this patient uploaded with a booking."}
              </p>
            )}
          </section>
          <PrescriptionsPanel
            role="dentist"
            patientId={detail.patient.id}
            className="glass-card profile-section"
            onCreate={() => navigate(`/dentist/prescriptions?patientId=${detail.patient.id}`)}
          />
          </>
          ) : null}
        </div>
      ) : null}

      {editingTreatmentId && detail?.patient ? (
        <DentistModal
          stacked
          closeOnEscape
          className="dentist-modal--edit-treatment"
          title="Edit Treatment"
          onClose={requestCloseEdit}
        >
          {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
          <p className="muted-copy">
            The selected treatment is loaded below. Change any field and Save Changes to update this
            record only — the dental chart recalculates automatically.
          </p>
          <form className="dentist-form" onSubmit={saveTreatment}>
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
            <div className="dentist-modal__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={requestCloseEdit}
                disabled={savingTreatment}
              >
                Cancel
              </button>
              <button type="submit" className="button button--primary" disabled={savingTreatment}>
                {savingTreatment ? "Saving Changes…" : "Save Changes"}
              </button>
            </div>
          </form>
        </DentistModal>
      ) : null}

      {documentPreview ? (
        <DentalDocumentPreview
          document={documentPreview.document}
          objectUrl={documentPreview.objectUrl}
          error={documentPreview.error}
          onClose={closeDocumentPreview}
          onDownload={() => downloadDentalDocument(documentPreview.document)}
        />
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
