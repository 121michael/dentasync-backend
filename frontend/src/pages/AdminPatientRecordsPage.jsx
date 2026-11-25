import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Download, Eye, HeartPulse, Search, ShieldCheck, UserRound } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import {
  PatientRecordCardsBack,
  PatientRecordField,
  PatientRecordIdentity,
  PatientRecordSectionNav,
  PatientRecordSectionSelect,
  hmoCoverageLabel,
} from "../components/PatientRecordCards";
import { PatientRegistryPicker } from "../components/PatientRegistryPicker";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate } from "../adminUtils";
import { matchesNotificationFocus } from "../notificationFocus";
import { displayDateOfBirth, displaySex } from "../patientDemographics";
function listValue(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "—";
}

function formatMoney(value) {
  return `₱${Number(value || 0).toFixed(2)}`;
}

function formatHistoryDate(value) {
  if (!value) return "—";
  const text = typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
  const date =
    typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? new Date(`${text}T00:00:00`)
      : new Date(text);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

function treatmentBalance(treatment) {
  if (treatment?.balance != null && Number.isFinite(Number(treatment.balance))) {
    return Number(treatment.balance);
  }
  return Math.round((Number(treatment?.amountCharged || 0) - Number(treatment?.amountPaid || 0)) * 100) / 100;
}

function nextAppointmentLabel(treatment, fallbackAppointment) {
  const next = treatment?.nextAppointment || fallbackAppointment;
  if (!next?.date) return "No scheduled appointment";
  return formatHistoryDate(next.date);
}

export function AdminPatientRecordsPage() {
  const { pushToast } = useAdminUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [exportJob, setExportJob] = useState(null);
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");
  const focusedRowRef = useRef(null);
  const focusHandledRef = useRef("");
  const [recordSection, setRecordSection] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminClinicalRecords({ search: applied, limit: 50 }));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus) setFocusKey(focus);
  }, [searchParams]);

  useEffect(() => {
    if (!focusKey || !data?.records?.length) return;
    if (focusHandledRef.current === focusKey) return;
    const match = data.records.find((item) =>
      matchesNotificationFocus(item, focusKey, ["id", "linkedUserId", "patientId", "recordCode"])
    );
    if (!match) return;
    focusHandledRef.current = focusKey;
    viewRecord(match);
    const timer = window.setTimeout(() => {
      focusedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clearTimer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (next.has("focus")) {
        next.delete("focus");
        setSearchParams(next, { replace: true });
      }
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [focusKey, data, searchParams, setSearchParams]);

  async function startExport() {
    setExportJob({ phase: "checking", records: [], total: 0, percent: null, message: "" });
    try {
      const preview = await api.previewAdminClinicalExport({ search: applied });
      const matches = preview?.records || [];
      if (!matches.length) {
        setExportJob({
          phase: "error",
          records: [],
          total: 0,
          percent: null,
          message: "No patient records match the current search.",
        });
        return;
      }
      setExportJob({
        phase: "preview",
        records: matches,
        total: Number(preview.total || matches.length),
        percent: null,
        message: "",
        beyondPage: Number(preview.total || matches.length) > (data?.records?.length || 0),
      });
    } catch (exportError) {
      setExportJob({
        phase: "error",
        records: [],
        total: 0,
        percent: null,
        message: exportError.message || "Unable to export patient records.",
      });
    }
  }

  async function downloadExport() {
    setExportJob((current) => ({ ...current, phase: "generating", percent: 0, message: "" }));
    try {
      await api.downloadAdminClinicalExport({ search: applied }, (percent) => {
        setExportJob((current) =>
          current && current.phase === "generating" ? { ...current, percent } : current
        );
      });
      pushToast("Patient records downloaded.");
      setExportJob(null);
    } catch (exportError) {
      setExportJob((current) => ({
        ...(current || { records: [], total: 0 }),
        phase: "error",
        percent: null,
        message: exportError.message || "Unable to export patient records.",
      }));
    }
  }

  async function viewRecord(record) {
    try {
      setDetail(await api.getAdminClinicalRecord(record.id));
      setRecordSection(null);
    } catch (viewError) {
      pushToast(viewError.message || "Unable to load patient record.", "error");
    }
  }

  if (error && !data) {
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
  if (!data) return <LoadingState label="Loading clinical patient records…" />;

  const records = data.records || [];
  const record = detail?.record;
  const appointments = detail?.appointments || [];
  const treatments = detail?.treatments || [];
  const nextAppointment = detail?.nextAppointment || null;
  const sourceDocuments = detail?.sourceDocuments || [];

  async function openSourceDocument(document) {
    try {
      const blob = await api.getAdminDocumentSyncFileBlob(document.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (openError) {
      pushToast(openError.message || "Unable to open the source document.", "error");
    }
  }

  return (
    <div className={`admin-page${detail && record ? " admin-patient-record-page" : ""}`}>
      {detail && record ? null : <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Patient Search Registry Array</span>
            <h2>Patient Records Vault</h2>
          </div>
        </div>

        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search);
          }}
        >
          <label className="admin-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search patient by name, ID, phone, or keyword"
            />
          </label>
          <button className="button button--secondary button--compact" type="submit">Search</button>
          <button
            className="button button--secondary button--compact"
            type="button"
            onClick={startExport}
            disabled={exportJob?.phase === "checking" || exportJob?.phase === "generating"}
          >
            <Download size={16} />
            {exportJob?.phase === "checking"
              ? "Checking records…"
              : exportJob?.phase === "generating"
                ? "Creating workbook…"
                : "Export Data (.xlsx)"}
          </button>
        </form>

        {data.setupRequired || data.message ? (
          <p className="inline-alert inline-alert--error" role="status">
            {data.message ||
              "Clinical tables are missing. In C:\\DentaSync-git\\backend run: npm run migrate:clinical-records, then restart npm start."}
          </p>
        ) : null}

        {records.length ? (
          <>
          <PatientRegistryPicker items={records} onView={viewRecord} focusKey={focusKey} focusedRef={focusedRowRef} />
          <div className="admin-table-wrap patient-registry-table">
            <table className="admin-table admin-table--patient-list">
              <thead>
                <tr>
                  <th>Patient ID</th>
                  <th>Patient Name</th>
                  <th>Sex</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((item) => (
                  <tr
                    key={item.id}
                    ref={
                      matchesNotificationFocus(item, focusKey, ["id", "linkedUserId", "patientId", "recordCode"])
                        ? focusedRowRef
                        : null
                    }
                    className={
                      matchesNotificationFocus(item, focusKey, ["id", "linkedUserId", "patientId", "recordCode"])
                        ? "is-notification-focus"
                        : undefined
                    }
                  >
                    <td><code>{listValue(item.patientId || item.recordCode || item.id)}</code></td>
                    <td><strong>{listValue(item.fullName || item.patientName)}</strong></td>
                    <td>{displaySex(item.gender)}</td>
                    <td>
                      <button className="button button--secondary button--compact" onClick={() => viewRecord(item)}>
                        <Eye size={14} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <EmptyState
            title="No clinical records found"
            detail="Dentists and staff create clinical patient records from their portals."
          />
        )}
      </section>}

      {exportJob ? (
        <AdminModal title="Export Data (.xlsx)" onClose={() => setExportJob(null)}>
          {exportJob.phase === "checking" ? (
            <p className="muted-copy">Checking which records match the current search…</p>
          ) : null}
          {exportJob.phase === "error" ? (
            <p className="inline-alert inline-alert--error" role="alert">{exportJob.message}</p>
          ) : null}
          {exportJob.phase === "preview" || exportJob.phase === "generating" ? (
            <>
              <p>
                {exportJob.total} {exportJob.total === 1 ? "record" : "records"} will be included
                {applied ? ` for “${applied}”` : ""}.
                {exportJob.beyondPage
                  ? " This includes matches that are not on the current page."
                  : ""}
              </p>
              <div className="admin-table-wrap admin-export-preview">
                <table className="admin-table admin-table--patient-list">
                  <thead>
                    <tr>
                      <th>Patient ID</th>
                      <th>Patient Name</th>
                      <th>Sex</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exportJob.records.map((item) => (
                      <tr key={item.id}>
                        <td><code>{listValue(item.patientId)}</code></td>
                        <td><strong>{listValue(item.fullName)}</strong></td>
                        <td>{displaySex(item.gender)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {exportJob.phase === "generating" ? (
            <div className="admin-export-progress">
              <p>Creating the workbook… {exportJob.percent == null ? "" : `${exportJob.percent}%`}</p>
              <progress max={100} value={exportJob.percent == null ? undefined : exportJob.percent} />
            </div>
          ) : null}
          <div className="admin-heading-actions">
            <button className="button button--secondary button--compact" type="button" onClick={() => setExportJob(null)}>
              Close
            </button>
            {exportJob.phase === "preview" ? (
              <button className="button button--primary button--compact" type="button" onClick={downloadExport}>
                <Download size={16} /> Download .xlsx
              </button>
            ) : null}
          </div>
        </AdminModal>
      ) : null}

      {detail && record ? (
        <div className="dentist-patient-record">
          <PatientRecordIdentity
            onBack={() => {
              setDetail(null);
              setRecordSection(null);
            }}
            name={record.fullName}
            patientId={record.patientId || record.recordCode || record.id}
            eyebrow="Administrative patient record"
          >
            <PatientRecordSectionSelect value={recordSection} onChange={setRecordSection} />
          </PatientRecordIdentity>

          {!recordSection ? (
            <PatientRecordSectionNav onSelect={setRecordSection} selectedId={recordSection} />
          ) : (
            <PatientRecordCardsBack onClick={() => setRecordSection(null)} />
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
                <PatientRecordField label="Full name">{record.fullName}</PatientRecordField>
                <PatientRecordField label="Patient ID">
                  {record.patientId || record.recordCode || record.id}
                </PatientRecordField>
                <PatientRecordField label="Age">
                  {record.age != null && record.age !== "" ? record.age : "—"}
                </PatientRecordField>
                <PatientRecordField label="Sex">{displaySex(record.gender)}</PatientRecordField>
                <PatientRecordField label="Date of birth">{displayDateOfBirth(record.dateOfBirth)}</PatientRecordField>
                <PatientRecordField label="Email address">{record.email}</PatientRecordField>
                <PatientRecordField label="Mobile number">{record.phone}</PatientRecordField>
                <PatientRecordField label="Address">{record.address}</PatientRecordField>
                <PatientRecordField label="Created by">
                  <span className="capitalize">{record.createdByRole || "—"}</span>
                </PatientRecordField>
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
                <PatientRecordField label="Contact name">{record.emergencyContactName?.trim()}</PatientRecordField>
                <PatientRecordField label="Relationship">
                  {record.emergencyContactRelationship?.trim()}
                </PatientRecordField>
                <PatientRecordField label="Mobile number">{record.emergencyContactPhone?.trim()}</PatientRecordField>
              </div>
            </section>
          ) : null}

          {recordSection === "clinical" ? (
            <>
              <section className="glass-card profile-section">
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">Shared securely with the care team</span>
                    <h2>Clinical Information</h2>
                  </div>
                  <HeartPulse className="card-heading__icon" size={21} />
                </div>
                <div className="field-grid field-grid--two">
                  <PatientRecordField label="Allergies" warning>{record.allergies?.trim()}</PatientRecordField>
                  <PatientRecordField label="Existing conditions">{record.existingConditions?.trim()}</PatientRecordField>
                  <PatientRecordField label="Current medications">{record.currentMedications?.trim()}</PatientRecordField>
                  <PatientRecordField label="Dental concerns">{record.dentalConcerns?.trim()}</PatientRecordField>
                </div>
              </section>

              <section className="glass-card profile-section">
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">Schedule</span>
                    <h2>Appointments</h2>
                  </div>
                </div>
                <div className="admin-history-list">
                  {appointments.length ? (
                    appointments.map((appointment) => (
                      <article key={appointment.id}>
                        <div>
                          <strong>
                            {formatAdminDate(appointment.date)} · {appointment.time || "—"}
                          </strong>
                          <small>
                            {appointment.treatment || "Appointment"} · {appointment.status || "—"}
                            {appointment.dentist ? ` · ${appointment.dentist}` : ""}
                          </small>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="muted-copy">No appointments on file for this patient.</p>
                  )}
                </div>
              </section>

              <section className="glass-card profile-section treatment-record treatment-record--readonly">
                <div className="treatment-record__header">
                  <div>
                    <span className="eyebrow">Shared clinical ledger</span>
                    <h2>Treatment Record</h2>
                  </div>
                </div>
                <p className="muted-copy">
                  View only. Dentists maintain clinical treatment documentation on this same patient record.
                </p>
                <div className="treatment-record__table-wrap">
                  {treatments.length ? (
                    <table className="treatment-record__table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Tooth No/s</th>
                          <th>Procedure</th>
                          <th>Dentist</th>
                          <th>Amount Charged</th>
                          <th>Amount Paid</th>
                          <th>Balance</th>
                          <th>Next Appt.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {treatments.map((treatment) => (
                          <tr key={treatment.id}>
                            <td data-label="Date">{formatHistoryDate(treatment.treatmentDate)}</td>
                            <td data-label="Tooth No/s">{treatment.toothNumber || "—"}</td>
                            <td data-label="Procedure">{treatment.treatment || "—"}</td>
                            <td data-label="Dentist">{treatment.dentistName || "—"}</td>
                            <td data-label="Amount Charged">{formatMoney(treatment.amountCharged)}</td>
                            <td data-label="Amount Paid">{formatMoney(treatment.amountPaid)}</td>
                            <td data-label="Balance">{formatMoney(treatmentBalance(treatment))}</td>
                            <td data-label="Next Appt.">{nextAppointmentLabel(treatment, nextAppointment)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted-copy">No treatments on file.</p>
                  )}
                </div>
              </section>

              <section className="glass-card profile-section">
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">Document sync</span>
                    <h2>Imported source documents</h2>
                  </div>
                </div>
                {sourceDocuments.length ? (
                  <div className="admin-history-list">
                    {sourceDocuments.map((document) => (
                      <article key={document.id}>
                        <div>
                          <strong>{document.originalName || "Source document"}</strong>
                          <small>
                            {document.syncedAt ? formatHistoryDate(document.syncedAt) : "Saved"}
                            {document.approvedByName ? ` · approved by ${document.approvedByName}` : ""}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="button button--secondary button--compact"
                          onClick={() => openSourceDocument(document)}
                        >
                          Open original
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy">No imported source document is attached to this record.</p>
                )}
              </section>
            </>
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
              <div className={`verification-status${record.hmoStatus === "verified" ? "" : " is-pending"}`}>
                <ShieldCheck size={18} />
                <div>
                  <strong>{hmoCoverageLabel(record)}</strong>
                  <small>
                    {record.hmoVerifiedAt
                      ? `Verified ${formatHistoryDate(record.hmoVerifiedAt)}`
                      : "Admin oversight of coverage on this clinical record."}
                  </small>
                </div>
              </div>
              <div className="field-grid field-grid--two" style={{ marginTop: "1rem" }}>
                <PatientRecordField label="HMO provider">{record.hmoProvider}</PatientRecordField>
                <PatientRecordField label="Coverage status">
                  {(record.hmoStatus || "not_enrolled").replaceAll("_", " ")}
                </PatientRecordField>
                <PatientRecordField label="Staff verification">
                  {(record.staffVerificationStatus || "pending").replaceAll("_", " ")}
                </PatientRecordField>
                <PatientRecordField label="Clinical notes">{record.notes}</PatientRecordField>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
