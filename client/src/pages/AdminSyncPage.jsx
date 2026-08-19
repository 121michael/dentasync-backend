import { useCallback, useEffect, useState } from "react";
import { FileScan, RefreshCw, Save, Upload } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { formatAdminDateTime } from "../adminUtils";

const emptyPayload = {
  patient: {
    firstName: "",
    lastName: "",
    fullName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    gender: "",
    address: "",
  },
  procedure: {
    treatment: "",
    dentistName: "",
    treatmentDate: "",
    clinicLocation: "Amethyst Dental Clinic",
    status: "completed",
    notes: "",
    coverageStatus: "",
  },
};

function StatusDot({ ok, label, detail }) {
  return (
    <article className={`admin-health-card ${ok ? "is-online" : "is-offline"}`}>
      <span className="admin-health-card__dot" />
      <div>
        <strong>{label}</strong>
        <small>{detail || (ok ? "Connected" : "Unavailable")}</small>
      </div>
    </article>
  );
}

export function AdminSyncPage() {
  const [healthData, setHealthData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [payload, setPayload] = useState(emptyPayload);
  const [sourceType, setSourceType] = useState("soft_copy");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const [syncResponse, jobsResponse] = await Promise.all([
        api.getAdminSync(),
        api.getAdminDocumentSyncJobs(),
      ]);
      setHealthData(syncResponse);
      setJobs(jobsResponse.jobs || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updatePatient(field, value) {
    setPayload((current) => ({
      ...current,
      patient: { ...current.patient, [field]: value },
    }));
  }

  function updateProcedure(field, value) {
    setPayload((current) => ({
      ...current,
      procedure: { ...current.procedure, [field]: value },
    }));
  }

  async function scanDocument(event) {
    event.preventDefault();
    if (!file) {
      setError("Choose a PDF, TXT, JPG, or PNG document to scan.");
      return;
    }
    setBusy("scan");
    setError("");
    setMessage("");
    try {
      const response = await api.uploadAdminDocumentSync(file, sourceType);
      setActiveJob(response.job);
      setPayload(response.job.editedPayload || response.job.extractedPayload || emptyPayload);
      setMessage(response.message);
      setFile(null);
      await load();
    } catch (scanError) {
      setError(scanError.message);
    } finally {
      setBusy("");
    }
  }

  async function saveReview() {
    if (!activeJob) return;
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const response = await api.updateAdminDocumentSync(activeJob.id, { payload });
      setActiveJob(response.job);
      setPayload(response.job.editedPayload);
      setMessage(response.message);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy("");
    }
  }

  async function syncToDatabase() {
    if (!activeJob) return;
    setBusy("sync");
    setError("");
    setMessage("");
    try {
      const response = await api.commitAdminDocumentSync(activeJob.id, { payload });
      setActiveJob(response.job);
      setPayload(response.job.editedPayload);
      setMessage(response.message);
      await load();
    } catch (syncError) {
      setError(syncError.message);
    } finally {
      setBusy("");
    }
  }

  async function openJob(jobId) {
    setBusy(`open-${jobId}`);
    setError("");
    try {
      const response = await api.getAdminDocumentSyncJob(jobId);
      setActiveJob(response.job);
      setPayload(response.job.editedPayload || response.job.extractedPayload || emptyPayload);
    } catch (openError) {
      setError(openError.message);
    } finally {
      setBusy("");
    }
  }

  if (error && !healthData) return <ErrorState message={error} onRetry={load} />;
  if (!healthData) return <LoadingState label="Loading document synchronization…" />;

  const health = healthData.health;

  return (
    <div className="admin-page">
      <SectionHeading
        eyebrow="Clinic data intake"
        title="System Synchronization"
        detail="Scan hard or soft-copy dental documents, review extracted patient and procedure data, then sync into the database."
        action={
          <button className="button button--secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {message ? <p className="inline-alert inline-alert--success">{message}</p> : null}

      <section className="admin-panel admin-sync-hero">
        <div>
          <span className="eyebrow">Document Data Synchronization</span>
          <h2>Scan → Extract → Review → Sync</h2>
          <p>
            Upload a patient chart, treatment form, or scanned dental record. The system extracts important patient
            and procedure fields for verification before saving to PostgreSQL.
          </p>
        </div>
        <FileScan size={34} aria-hidden="true" />
      </section>

      <section className="admin-health-grid">
        <StatusDot ok={health.database} label="Database" detail={health.database ? "Ready to receive sync" : "Disconnected"} />
        <StatusDot ok={health.api} label="API Server" detail={health.api ? "Online" : "Offline"} />
        <StatusDot ok={true} label="Document OCR" detail="PDF text + image OCR enabled" />
        <StatusDot ok={health.auth} label="Admin Access" detail={health.auth ? "Authenticated" : "Unavailable"} />
      </section>

      <section className="admin-panel">
        <h2>1. Upload / Scan Document</h2>
        <form className="admin-form" onSubmit={scanDocument}>
          <div className="field-grid field-grid--two">
            <label className="field">
              <span>Document source</span>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                <option value="soft_copy">Soft copy (PDF / TXT)</option>
                <option value="hard_copy_scan">Hard copy scan (JPG / PNG)</option>
              </select>
            </label>
            <label className="field">
              <span>Choose file</span>
              <input
                type="file"
                accept=".pdf,.txt,.csv,.jpg,.jpeg,.png,.webp"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </label>
          </div>
          <button className="button button--primary" disabled={Boolean(busy)}>
            <Upload size={16} /> {busy === "scan" ? "Scanning & extracting…" : "Scan & Extract Data"}
          </button>
        </form>
      </section>

      {activeJob ? (
        <section className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span className="eyebrow">Extracted draft · {activeJob.status}</span>
              <h2>2. Review & Edit Before Sync</h2>
              <p>{activeJob.extractionNotes || "Verify patient and procedure fields, then sync to the database."}</p>
              <small className="muted-copy">Source file: {activeJob.originalName}</small>
            </div>
          </div>

          <div className="field-grid field-grid--two">
            <label className="field"><span>First name</span><input value={payload.patient.firstName} onChange={(event) => updatePatient("firstName", event.target.value)} /></label>
            <label className="field"><span>Last name</span><input value={payload.patient.lastName} onChange={(event) => updatePatient("lastName", event.target.value)} /></label>
            <label className="field"><span>Email</span><input type="email" value={payload.patient.email} onChange={(event) => updatePatient("email", event.target.value)} /></label>
            <label className="field"><span>Phone</span><input value={payload.patient.phone} onChange={(event) => updatePatient("phone", event.target.value)} /></label>
            <label className="field"><span>Date of birth</span><input type="date" value={payload.patient.dateOfBirth} onChange={(event) => updatePatient("dateOfBirth", event.target.value)} /></label>
            <label className="field"><span>Gender / Sex</span><input value={payload.patient.gender} onChange={(event) => updatePatient("gender", event.target.value)} /></label>
            <label className="field field--full"><span>Address</span><input value={payload.patient.address} onChange={(event) => updatePatient("address", event.target.value)} /></label>
            <label className="field field--full"><span>Dental procedure</span><input value={payload.procedure.treatment} onChange={(event) => updateProcedure("treatment", event.target.value)} /></label>
            <label className="field"><span>Dentist</span><input value={payload.procedure.dentistName} onChange={(event) => updateProcedure("dentistName", event.target.value)} /></label>
            <label className="field"><span>Treatment date</span><input type="date" value={payload.procedure.treatmentDate} onChange={(event) => updateProcedure("treatmentDate", event.target.value)} /></label>
            <label className="field"><span>Coverage</span><input value={payload.procedure.coverageStatus} onChange={(event) => updateProcedure("coverageStatus", event.target.value)} /></label>
            <label className="field">
              <span>Status</span>
              <select value={payload.procedure.status} onChange={(event) => updateProcedure("status", event.target.value)}>
                <option value="completed">Completed</option>
                <option value="in_progress">In progress</option>
                <option value="planned">Planned</option>
              </select>
            </label>
            <label className="field field--full"><span>Clinic location</span><input value={payload.procedure.clinicLocation} onChange={(event) => updateProcedure("clinicLocation", event.target.value)} /></label>
            <label className="field field--full"><span>Notes / findings</span><textarea rows="3" value={payload.procedure.notes} onChange={(event) => updateProcedure("notes", event.target.value)} /></label>
          </div>

          {activeJob.rawText ? (
            <details className="admin-sync-raw">
              <summary>View extracted raw text</summary>
              <pre>{activeJob.rawText}</pre>
            </details>
          ) : null}

          <div className="admin-heading-actions">
            <button type="button" className="button button--secondary" onClick={saveReview} disabled={Boolean(busy) || activeJob.status === "synced"}>
              <Save size={16} /> {busy === "save" ? "Saving…" : "Save Review"}
            </button>
            <button type="button" className="button button--primary" onClick={syncToDatabase} disabled={Boolean(busy) || activeJob.status === "synced"}>
              <FileScan size={16} /> {busy === "sync" ? "Syncing…" : activeJob.status === "synced" ? "Already Synced" : "Sync to Database"}
            </button>
          </div>

          {activeJob.status === "synced" ? (
            <p className="inline-alert inline-alert--success">
              Synced patient #{activeJob.linkedPatientId} · treatment #{activeJob.linkedTreatmentId} · {formatAdminDateTime(activeJob.syncedAt)}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="admin-panel">
        <h2>Recent Document Sync Jobs</h2>
        {jobs.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td><strong>{job.originalName}</strong></td>
                    <td>{job.sourceType.replaceAll("_", " ")}</td>
                    <td><span className={`admin-status admin-status--${job.status}`}>{job.status}</span></td>
                    <td>{formatAdminDateTime(job.updatedAt || job.createdAt)}</td>
                    <td>
                      <button className="button button--secondary button--compact" onClick={() => openJob(job.id)} disabled={Boolean(busy)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No document sync jobs yet." detail="Upload a dental document above to begin extraction and review." />
        )}
      </section>
    </div>
  );
}
