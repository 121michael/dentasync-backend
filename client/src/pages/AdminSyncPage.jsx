import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Cloud, RefreshCw, Save, Upload, X } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { useAdminUi } from "../components/AdminLayout";
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
  const { pushToast, confirm } = useAdminUi();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [healthData, setHealthData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [payload, setPayload] = useState(emptyPayload);
  const [sourceType, setSourceType] = useState("soft_copy");
  const [file, setFile] = useState(null);
  const [captureMode, setCaptureMode] = useState("file");
  const [cameraOpen, setCameraOpen] = useState(false);
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

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

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

  async function startCamera() {
    setError("");
    setCaptureMode("camera");
    setSourceType("hard_copy_scan");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      window.requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });
    } catch (cameraError) {
      setError(cameraError.message || "Unable to open the camera. Check browser permissions.");
      pushToast("Unable to open the camera.", "error");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  async function captureFromCamera() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      setError("Unable to capture camera frame.");
      return;
    }
    const captured = new File([blob], `camera-scan-${Date.now()}.jpg`, { type: "image/jpeg" });
    setFile(captured);
    setSourceType("hard_copy_scan");
    stopCamera();
    pushToast("Camera scan captured. Review the file, then extract.");
  }

  async function scanDocument(event) {
    event.preventDefault();
    if (!file) {
      setError("Choose a file or capture a camera scan first.");
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
      pushToast(response.message || "Document scanned and extracted.");
      setFile(null);
      await load();
    } catch (scanError) {
      setError(scanError.message);
      pushToast(scanError.message, "error");
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
      pushToast(response.message || "Extracted data saved for review.");
      await load();
    } catch (saveError) {
      setError(saveError.message);
      pushToast(saveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function syncToDatabase() {
    if (!activeJob) return;
    const ok = await confirm({
      title: "Confirm database sync",
      message:
        "Sync this reviewed document into a clinical patient record? This does not create a patient login account.",
      confirmLabel: "Sync Data",
      tone: "primary",
    });
    if (!ok) return;
    setBusy("sync");
    setError("");
    setMessage("");
    try {
      const response = await api.commitAdminDocumentSync(activeJob.id, { payload });
      setActiveJob(response.job);
      setPayload(response.job.editedPayload);
      setMessage(response.message);
      pushToast(response.message || "Data synchronized successfully.");
      await load();
    } catch (syncError) {
      setError(syncError.message);
      pushToast(syncError.message, "error");
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
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {message ? <p className="inline-alert inline-alert--success">{message}</p> : null}

      <section className="admin-panel admin-sync-hero">
        <div>
          <span className="eyebrow">Document intake</span>
          <h2>Cloud Data Synchronization</h2>
          <p>
            Upload a file or scan with the camera, extract patient and dental procedure data, review and correct
            fields, then sync into a clinical patient record.
          </p>
          <div className="admin-heading-actions" style={{ marginTop: "0.85rem" }}>
            <button className="button button--secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
          </div>
        </div>
        <Cloud size={42} aria-hidden="true" />
      </section>

      <section className="admin-health-grid">
        <StatusDot ok={health.database} label="Database connection" detail={health.database ? "Ready to receive sync" : "Disconnected"} />
        <StatusDot ok={health.api} label="Current sync status" detail={health.api ? "Online" : "Offline"} />
        <StatusDot ok={true} label="Document OCR" detail="PDF text + image OCR enabled" />
        <StatusDot ok={health.auth} label="Admin authorization" detail={health.auth ? "Authenticated" : "Unavailable"} />
      </section>

      <section className="admin-panel">
        <h2>1. Upload File or Scan via Camera</h2>
        <div className="admin-tabs" role="tablist" aria-label="Capture method">
          <button
            type="button"
            className={`admin-tab ${captureMode === "file" ? "is-active" : ""}`}
            onClick={() => {
              stopCamera();
              setCaptureMode("file");
            }}
          >
            Choose File
          </button>
          <button
            type="button"
            className={`admin-tab ${captureMode === "camera" ? "is-active" : ""}`}
            onClick={startCamera}
          >
            Scan via Camera
          </button>
        </div>

        <form className="admin-form" onSubmit={scanDocument}>
          {captureMode === "file" ? (
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
          ) : (
            <div className="admin-camera-panel">
              {cameraOpen ? (
                <>
                  <video ref={videoRef} autoPlay playsInline muted className="admin-camera-preview" />
                  <div className="admin-heading-actions">
                    <button type="button" className="button button--primary" onClick={captureFromCamera}>
                      <Camera size={16} /> Capture Scan
                    </button>
                    <button type="button" className="button button--secondary" onClick={stopCamera}>
                      <X size={16} /> Close Camera
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted-copy">
                  {file ? `Captured: ${file.name}` : "Open the camera to scan a hard-copy dental record."}
                </p>
              )}
              {!cameraOpen ? (
                <button type="button" className="button button--secondary" onClick={startCamera}>
                  <Camera size={16} /> Open Camera
                </button>
              ) : null}
            </div>
          )}

          {file ? <p className="muted-copy">Ready to extract: <strong>{file.name}</strong></p> : null}

          <button className="button button--primary" disabled={Boolean(busy) || !file}>
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
              <p>{activeJob.extractionNotes || "Verify patient and procedure fields, then sync to a clinical record."}</p>
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
              <Cloud size={16} /> {busy === "sync" ? "Syncing…" : activeJob.status === "synced" ? "Already Synced" : "Sync to Database"}
            </button>
          </div>

          {activeJob.status === "synced" ? (
            <p className="inline-alert inline-alert--success">
              Synced clinical record #{activeJob.linkedPatientId} · treatment #{activeJob.linkedTreatmentId} · {formatAdminDateTime(activeJob.syncedAt)}
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
          <EmptyState title="No document sync jobs yet." detail="Upload a file or scan with the camera to begin extraction." />
        )}
      </section>
    </div>
  );
}
