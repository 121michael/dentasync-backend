import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, FileText, Image as ImageIcon, RefreshCw, Save, Upload, X } from "lucide-react";
import { ApiError, api } from "../api";
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
    age: "",
    gender: "",
    address: "",
  },
  procedure: {
    treatment: "",
    dentistName: "",
    treatmentDate: "",
    amountCharged: "",
    clinicLocation: "Amethyst Dental Clinic",
    status: "completed",
    notes: "",
    coverageStatus: "",
  },
};

function placeholderFor(value, emptyLabel = "Not detected") {
  return value ? undefined : emptyLabel;
}

function syncFullName(patient) {
  const fullName = patient.fullName?.trim();
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    return {
      ...patient,
      fullName,
      firstName: parts[0] || patient.firstName || "",
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : patient.lastName || "",
    };
  }
  return {
    ...patient,
    fullName: `${patient.firstName || ""} ${patient.lastName || ""}`.trim(),
  };
}

export function AdminSyncPage() {
  const { pushToast, confirm } = useAdminUi();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const pdfInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [payload, setPayload] = useState(emptyPayload);
  const [editing, setEditing] = useState(true);
  const [sourceType, setSourceType] = useState("soft_copy");
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [serverPreviewUrl, setServerPreviewUrl] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [step, setStep] = useState("choose");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [matchInfo, setMatchInfo] = useState(null);

  const clearPreviews = useCallback(() => {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    if (serverPreviewUrl) URL.revokeObjectURL(serverPreviewUrl);
    setLocalPreviewUrl("");
    setServerPreviewUrl("");
  }, [localPreviewUrl, serverPreviewUrl]);

  const load = useCallback(async () => {
    try {
      const jobsResponse = await api.getAdminDocumentSyncJobs();
      setJobs(jobsResponse.jobs || []);
      setError("");
      setLoaded(true);
    } catch (loadError) {
      setError(loadError.message);
      setLoaded(true);
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
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
      if (serverPreviewUrl) URL.revokeObjectURL(serverPreviewUrl);
    };
  }, [localPreviewUrl, serverPreviewUrl]);

  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    const playPromise = videoRef.current.play?.();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  }, [cameraOpen]);

  async function loadServerPreview(jobId) {
    try {
      const blob = await api.getAdminDocumentSyncFileBlob(jobId);
      const url = URL.createObjectURL(blob);
      setServerPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
    } catch {
      setServerPreviewUrl("");
    }
  }

  function updatePatient(field, value) {
    setPayload((current) => {
      const patient = { ...current.patient, [field]: value };
      if (field === "fullName" || field === "firstName" || field === "lastName") {
        return { ...current, patient: syncFullName(patient) };
      }
      return { ...current, patient };
    });
  }

  function updateProcedure(field, value) {
    setPayload((current) => ({
      ...current,
      procedure: { ...current.procedure, [field]: value },
    }));
  }

  function cameraErrorMessage(cameraError) {
    const name = cameraError?.name || "";
    if (!window.isSecureContext) {
      return "Camera requires a secure page. Open the app at http://localhost:5173 (not a LAN IP over plain HTTP).";
    }
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "Camera permission was blocked. Allow camera access for this site in your browser settings, then try again.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No camera was found on this device. Plug in a webcam or use Upload Image instead.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "The camera is already in use by another app. Close that app, then try again.";
    }
    if (name === "SecurityError") {
      return "Browser blocked camera access on this page. Use http://localhost:5173 or HTTPS.";
    }
    return cameraError?.message || "Unable to open the camera. Check browser permissions.";
  }

  async function requestCameraStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error(
        window.isSecureContext
          ? "This browser does not support camera capture. Try Chrome or Edge, or upload an image."
          : "Camera requires a secure page. Open the app at http://localhost:5173."
      );
      err.name = "SecurityError";
      throw err;
    }

    const attempts = [
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: { facingMode: "user" }, audio: false },
      { video: true, audio: false },
    ];

    let lastError = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (attemptError) {
        lastError = attemptError;
        if (attemptError?.name === "NotAllowedError" || attemptError?.name === "PermissionDeniedError") {
          throw attemptError;
        }
      }
    }
    throw lastError || new Error("Unable to open the camera.");
  }

  async function startCamera() {
    setError("");
    setSourceType("hard_copy_scan");
    setStep("scan");
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      const stream = await requestCameraStream();
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (cameraError) {
      const messageText = cameraErrorMessage(cameraError);
      setError(messageText);
      pushToast(messageText, "error");
      setCameraOpen(false);
      setStep("choose");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
  }

  async function processFile(file, nextSourceType) {
    if (!file) return;
    clearPreviews();
    setActiveJob(null);
    setMatchInfo(null);
    setMessage("");
    setError("");
    setEditing(true);
    setSourceType(nextSourceType);
    setLocalPreviewUrl(URL.createObjectURL(file));
    setStep("processing");
    setBusy("scan");
    stopCamera();

    try {
      const response = await api.uploadAdminDocumentSync(file, nextSourceType);
      setActiveJob(response.job);
      setPayload(response.job.editedPayload || response.job.extractedPayload || emptyPayload);
      setMessage(response.message);
      setStep("review");
      pushToast(response.message || "Document extracted for review.");
      await loadServerPreview(response.job.id);
      await load();
    } catch (scanError) {
      setStep("choose");
      setError(scanError.message);
      pushToast(scanError.message, "error");
      clearPreviews();
      await load();
    } finally {
      setBusy("");
    }
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
    await processFile(captured, "hard_copy_scan");
  }

  function onPdfSelected(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    processFile(file, "soft_copy");
  }

  function onImageSelected(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    processFile(file, "soft_copy");
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
      setEditing(false);
      setMessage(response.message);
      pushToast(response.message || "Corrections saved.");
      await load();
    } catch (saveError) {
      setError(saveError.message);
      pushToast(saveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function confirmAndSave() {
    if (!activeJob) return;
    setBusy("sync");
    setError("");
    setMessage("");

    try {
      await api.updateAdminDocumentSync(activeJob.id, { payload });
      const matchPreview = await api.previewAdminDocumentSyncMatch(activeJob.id, { payload });
      setMatchInfo(matchPreview);

      if (matchPreview.isNewPatient) {
        const ok = await confirm({
          title: "New patient record detected",
          message: `No matching patient was found for ${
            matchPreview.proposedPatient?.fullName || "this document"
          }. Create a new clinical patient record and save the imported information?`,
          confirmLabel: "Create Patient & Save",
          tone: "primary",
        });
        if (!ok) {
          setBusy("");
          return;
        }
      } else {
        const ok = await confirm({
          title: "Confirm & save import",
          message: `Save reviewed document data to existing patient ${
            matchPreview.match?.fullName || matchPreview.match?.id
          }? Treatment information will be attached as historical/imported data.`,
          confirmLabel: "Confirm & Save",
          tone: "primary",
        });
        if (!ok) {
          setBusy("");
          return;
        }
      }

      const response = await api.commitAdminDocumentSync(activeJob.id, {
        payload,
        confirmNewPatient: Boolean(matchPreview.isNewPatient),
      });
      setActiveJob(response.job);
      setPayload(response.job.editedPayload);
      setMessage(response.message);
      setStep("done");
      setEditing(false);
      pushToast(response.message || "Document successfully imported and data saved.");
      await load();
    } catch (syncError) {
      if (syncError instanceof ApiError && syncError.data?.needsNewPatientConfirmation) {
        const ok = await confirm({
          title: "New patient record detected",
          message: syncError.message,
          confirmLabel: "Create Patient & Save",
          tone: "primary",
        });
        if (!ok) {
          setBusy("");
          return;
        }
        try {
          const response = await api.commitAdminDocumentSync(activeJob.id, {
            payload,
            confirmNewPatient: true,
          });
          setActiveJob(response.job);
          setPayload(response.job.editedPayload);
          setMessage(response.message);
          setStep("done");
          setEditing(false);
          pushToast(response.message || "Document successfully imported and data saved.");
          await load();
        } catch (retryError) {
          setError(retryError.message);
          pushToast(retryError.message, "error");
        } finally {
          setBusy("");
        }
        return;
      }
      setError(syncError.message);
      pushToast(syncError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function openJob(jobId) {
    setBusy(`open-${jobId}`);
    setError("");
    setMessage("");
    try {
      const response = await api.getAdminDocumentSyncJob(jobId);
      setActiveJob(response.job);
      setPayload(response.job.editedPayload || response.job.extractedPayload || emptyPayload);
      setEditing(response.job.status !== "synced");
      setStep(response.job.status === "synced" ? "done" : response.job.status === "failed" ? "choose" : "review");
      clearPreviews();
      if (response.job.status !== "failed" && response.job.hasPreview) {
        await loadServerPreview(response.job.id);
      }
      if (response.job.status === "failed") {
        setError(response.job.errorMessage || "This document was rejected.");
      }
      if (response.job.status === "synced") {
        setMessage(
          "Import complete. The original source document was discarded; only confirmed structured data is retained."
        );
      }
    } catch (openError) {
      setError(openError.message);
    } finally {
      setBusy("");
    }
  }

  function startOver() {
    stopCamera();
    clearPreviews();
    setActiveJob(null);
    setPayload(emptyPayload);
    setMatchInfo(null);
    setMessage("");
    setError("");
    setEditing(true);
    setStep("choose");
  }

  if (!loaded && error) return <ErrorState message={error} onRetry={load} />;
  if (!loaded) return <LoadingState label="Loading document data extraction…" />;

  const previewUrl = serverPreviewUrl || localPreviewUrl;
  const isPdfPreview =
    activeJob?.mimeType === "application/pdf" ||
    /\.pdf$/i.test(activeJob?.originalName || "");

  return (
    <div className="admin-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {message ? <p className="inline-alert inline-alert--success">{message}</p> : null}

      <section className="admin-panel admin-sync-hero">
        <div>
          <span className="eyebrow">Document → Database</span>
          <h2>Document Data Extraction</h2>
          <p>
            Scan or upload a patient/treatment document temporarily, extract readable fields with OCR,
            review and correct them, then confirm. Only structured data is saved — the original scan/PDF/image
            is deleted afterward.
          </p>
          <div className="admin-heading-actions" style={{ marginTop: "0.85rem" }}>
            <button type="button" className="button button--secondary" onClick={load}>
              <RefreshCw size={16} /> Refresh
            </button>
            {step !== "choose" ? (
              <button type="button" className="button button--secondary" onClick={startOver}>
                New Document
              </button>
            ) : null}
          </div>
        </div>
        <FileText size={42} aria-hidden="true" />
      </section>

      <ol className="admin-sync-steps" aria-label="Import steps">
        <li className={step === "choose" || step === "scan" ? "is-active" : ""}>1. Source</li>
        <li className={step === "processing" ? "is-active" : ""}>2. Reading</li>
        <li className={step === "review" ? "is-active" : ""}>3. Review</li>
        <li className={step === "done" ? "is-active" : ""}>4. Saved</li>
      </ol>

      {(step === "choose" || step === "scan") && !activeJob ? (
        <section className="admin-panel">
          <h2>Choose document source</h2>
          <p className="muted-copy">
            Accepts PDF, PNG, JPEG, or a camera scan of a hard-copy form. Face photos and unrelated images are rejected.
          </p>

          <div className="admin-sync-source-grid">
            <button type="button" className="admin-sync-source-card" onClick={startCamera} disabled={Boolean(busy)}>
              <Camera size={22} />
              <strong>Scan Document</strong>
              <span>Capture a hard-copy paper record with the camera</span>
            </button>
            <button
              type="button"
              className="admin-sync-source-card"
              onClick={() => pdfInputRef.current?.click()}
              disabled={Boolean(busy)}
            >
              <Upload size={22} />
              <strong>Upload PDF</strong>
              <span>Digital patient or treatment document</span>
            </button>
            <button
              type="button"
              className="admin-sync-source-card"
              onClick={() => imageInputRef.current?.click()}
              disabled={Boolean(busy)}
            >
              <ImageIcon size={22} />
              <strong>Upload Image</strong>
              <span>PNG or JPEG scan of a document</span>
            </button>
          </div>

          <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" hidden onChange={onPdfSelected} />
          <input
            ref={imageInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            hidden
            onChange={onImageSelected}
          />

          {cameraOpen ? (
            <div className="admin-camera-panel" style={{ marginTop: "1rem" }}>
              <video ref={videoRef} autoPlay playsInline muted className="admin-camera-preview" />
              <div className="admin-heading-actions">
                <button type="button" className="button button--primary" onClick={captureFromCamera}>
                  <Camera size={16} /> Capture Scan
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => {
                    stopCamera();
                    setStep("choose");
                  }}
                >
                  <X size={16} /> Close Camera
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === "processing" ? (
        <section className="admin-panel">
          <h2>Reading document…</h2>
          <LoadingState label="Validating document content and extracting readable fields…" />
          {localPreviewUrl ? (
            <div className="admin-doc-preview" style={{ marginTop: "1rem" }}>
              <span className="eyebrow">Document preview</span>
              <img src={localPreviewUrl} alt="Uploaded document preview" />
            </div>
          ) : null}
        </section>
      ) : null}

      {(step === "review" || step === "done") && activeJob ? (
        <section className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span className="eyebrow">
                {step === "done" ? "Import complete" : "Document data extraction"} · {activeJob.status}
              </span>
              <h2>{step === "done" ? "Document successfully imported" : "Review extracted information"}</h2>
              <p>
                {activeJob.extractionNotes ||
                  "Compare extracted fields with the source document. Correct OCR mistakes before confirming."}
              </p>
              <small className="muted-copy">
                Source: {activeJob.sourceLabel || activeJob.sourceType} · {activeJob.originalName}
              </small>
            </div>
          </div>

          <div className="admin-doc-layout">
            <div className="admin-doc-preview">
              <span className="eyebrow">Document preview</span>
              {previewUrl ? (
                isPdfPreview ? (
                  <iframe title="Document preview" src={previewUrl} className="admin-doc-preview__frame" />
                ) : (
                  <img src={previewUrl} alt="Uploaded or scanned document" />
                )
              ) : (
                <p className="muted-copy">
                  {activeJob.status === "synced"
                    ? "Source document discarded after import. Only confirmed structured data was saved."
                    : "Temporary preview unavailable for this job."}
                </p>
              )}
            </div>

            <div className="admin-doc-fields">
              <h3>Extracted information</h3>
              <div className="field-grid field-grid--two">
                <label className="field field--full">
                  <span>Full Name</span>
                  <input
                    value={payload.patient.fullName}
                    placeholder={placeholderFor(payload.patient.fullName)}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updatePatient("fullName", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Date of Birth</span>
                  <input
                    type="date"
                    value={payload.patient.dateOfBirth}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updatePatient("dateOfBirth", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Age</span>
                  <input
                    value={payload.patient.age}
                    placeholder={placeholderFor(payload.patient.age)}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updatePatient("age", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Cellphone Number</span>
                  <input
                    value={payload.patient.phone}
                    placeholder={placeholderFor(payload.patient.phone)}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updatePatient("phone", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={payload.patient.email}
                    placeholder={placeholderFor(payload.patient.email)}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updatePatient("email", event.target.value)}
                  />
                </label>
                <label className="field field--full">
                  <span>Procedure</span>
                  <input
                    value={payload.procedure.treatment}
                    placeholder={placeholderFor(payload.procedure.treatment, "Unable to read")}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updateProcedure("treatment", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Treatment Date</span>
                  <input
                    type="date"
                    value={payload.procedure.treatmentDate}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updateProcedure("treatmentDate", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Amount</span>
                  <input
                    value={payload.procedure.amountCharged}
                    placeholder={placeholderFor(payload.procedure.amountCharged)}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updateProcedure("amountCharged", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Dentist</span>
                  <input
                    value={payload.procedure.dentistName}
                    placeholder={placeholderFor(payload.procedure.dentistName)}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updateProcedure("dentistName", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Coverage</span>
                  <input
                    value={payload.procedure.coverageStatus}
                    placeholder={placeholderFor(payload.procedure.coverageStatus)}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updateProcedure("coverageStatus", event.target.value)}
                  />
                </label>
                <label className="field field--full">
                  <span>Notes</span>
                  <textarea
                    rows="3"
                    value={payload.procedure.notes}
                    placeholder={placeholderFor(payload.procedure.notes)}
                    disabled={!editing || activeJob.status === "synced"}
                    onChange={(event) => updateProcedure("notes", event.target.value)}
                  />
                </label>
              </div>

              {matchInfo?.isNewPatient === false && matchInfo?.match ? (
                <p className="inline-alert inline-alert--success">
                  Existing patient match: {matchInfo.match.fullName} (ID {matchInfo.match.id})
                </p>
              ) : null}

              {activeJob.rawText ? (
                <details className="admin-sync-raw">
                  <summary>View extracted raw text</summary>
                  <pre>{activeJob.rawText}</pre>
                </details>
              ) : null}

              {activeJob.status !== "synced" ? (
                <div className="admin-heading-actions">
                  {editing ? (
                    <button type="button" className="button button--secondary" onClick={saveReview} disabled={Boolean(busy)}>
                      <Save size={16} /> {busy === "save" ? "Saving…" : "Save Edits"}
                    </button>
                  ) : (
                    <button type="button" className="button button--secondary" onClick={() => setEditing(true)} disabled={Boolean(busy)}>
                      Edit
                    </button>
                  )}
                  <button type="button" className="button button--primary" onClick={confirmAndSave} disabled={Boolean(busy)}>
                    <CheckCircle2 size={16} /> {busy === "sync" ? "Saving…" : "Confirm & Save"}
                  </button>
                </div>
              ) : (
                <p className="inline-alert inline-alert--success">
                  Saved to clinical record #{activeJob.linkedPatientId}
                  {activeJob.linkedTreatmentId ? ` · treatment #${activeJob.linkedTreatmentId}` : ""} ·{" "}
                  {formatAdminDateTime(activeJob.syncedAt)}. Original document deleted.
                </p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section className="admin-panel">
        <h2>Recent document imports</h2>
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
                    <td>
                      <strong>{job.originalName}</strong>
                      {job.errorMessage ? <div className="muted-copy">{job.errorMessage}</div> : null}
                    </td>
                    <td>{job.sourceLabel || job.sourceType.replaceAll("_", " ")}</td>
                    <td>
                      <span className={`admin-status admin-status--${job.status}`}>{job.status}</span>
                    </td>
                    <td>{formatAdminDateTime(job.updatedAt || job.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="button button--secondary button--compact"
                        onClick={() => openJob(job.id)}
                        disabled={Boolean(busy)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No document imports yet."
            detail="Scan a hard copy or upload a PDF/PNG/JPEG document to begin extraction."
          />
        )}
      </section>
    </div>
  );
}
