import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, FileText, Image as ImageIcon, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { ApiError, api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDateTime } from "../adminUtils";

function emptyVisitRow() {
  return {
    treatmentDate: "",
    toothNos: "",
    treatment: "",
    dentistName: "",
    amountCharged: "",
    amountPaid: "",
    balance: "",
    nextAppt: "",
  };
}

const emptyPayload = {
  documentForm: "generic",
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
    visits: [],
  },
};

function placeholderFor(value, emptyLabel = "Unreadable") {
  return value ? undefined : emptyLabel;
}

function normalizePayload(input) {
  const next = input && typeof input === "object" ? input : {};
  const visits = Array.isArray(next.procedure?.visits) ? next.procedure.visits : [];
  return {
    ...emptyPayload,
    ...next,
    documentForm: next.documentForm || emptyPayload.documentForm,
    patient: { ...emptyPayload.patient, ...(next.patient || {}) },
    procedure: {
      ...emptyPayload.procedure,
      ...(next.procedure || {}),
      visits: visits.length ? visits : [emptyVisitRow()],
    },
  };
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

  function updateVisit(index, field, value) {
    setPayload((current) => {
      const visits = [...(current.procedure.visits || [])];
      visits[index] = { ...emptyVisitRow(), ...visits[index], [field]: value };
      return {
        ...current,
        procedure: { ...current.procedure, visits },
      };
    });
  }

  function addVisitRow() {
    setPayload((current) => ({
      ...current,
      procedure: {
        ...current.procedure,
        visits: [...(current.procedure.visits || []), emptyVisitRow()],
      },
    }));
  }

  function removeVisitRow(index) {
    setPayload((current) => ({
      ...current,
      procedure: {
        ...current.procedure,
        visits: (current.procedure.visits || []).filter((_, i) => i !== index),
      },
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
      const nextPayload = normalizePayload(
        response.job.editedPayload || response.job.extractedPayload || emptyPayload
      );
      setPayload(nextPayload);
      setEditing(true);
      const filled = [
        nextPayload?.patient?.fullName,
        nextPayload?.patient?.age,
        nextPayload?.patient?.gender,
        ...((nextPayload?.procedure?.visits || []).flatMap((row) => [
          row?.treatmentDate,
          row?.treatment,
          row?.amountCharged,
          row?.toothNos,
          row?.dentistName,
          row?.amountPaid,
          row?.balance,
          row?.nextAppt,
        ]) || []),
      ].filter((value) => String(value || "").trim()).length;
      const autoMessage =
        filled > 0
          ? `Document table copied — ${filled} readable value${filled === 1 ? "" : "s"} filled. Correct OCR mistakes, then Confirm & Save.`
          : response.message ||
            "Document detected. Copy values from the preview into the table, then Confirm & Save.";
      setMessage(autoMessage);
      setStep("review");
      pushToast(autoMessage);
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
      setPayload(normalizePayload(response.job.editedPayload));
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
          setPayload(normalizePayload(response.job.editedPayload));
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
      setPayload(
        normalizePayload(response.job.editedPayload || response.job.extractedPayload || emptyPayload)
      );
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
          <span className="eyebrow">Text to database</span>
          <h2>Document Data Extraction</h2>
          <p>
            Scan a hard-copy paper or upload a PDF / PNG / JPEG. The system reads what it can from the document
            (name, date of birth, age, cellphone, procedure, treatment date, amount), lets you correct mistakes,
            then saves only that structured text to the database. Face photos and non-documents are rejected.
            Scanned files are temporary for reading only — they are not stored.
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
            Hard copy via camera, or digital PDF / PNG / JPEG. Only documents are accepted — a face photo or unrelated
            picture is rejected. When a document is detected, patient and treatment fields auto-fill immediately for
            review. The file is used only to read text; it is not kept after import. Tip: keep the paper upright and
            well-lit. Dense handwriting may still need corrections before Confirm & Save.
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
              <h2>{step === "done" ? "Document successfully imported" : "Review & confirm"}</h2>
              <p>
                The table below is copied from the scanned/attached document. Fix OCR mistakes in the cells, then
                confirm. Blank cells stay blank.
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

            <div className="admin-doc-fields doc-table-card">
              <header className="doc-table-card__header">
                <h3>Document Table</h3>
                <p className="doc-table-card__helper">
                  Copied from the scan/attachment. Edit a cell only to fix OCR mistakes. Leave blank cells blank — do not
                  invent values.
                </p>
              </header>

              <section className="doc-table-card__patient" aria-label="Patient information">
                <span className="doc-table-card__section-label">Patient Information</span>
                <div className="doc-table-card__patient-grid">
                  <label className="doc-table-field">
                    <span>Name</span>
                    <input
                      value={payload.patient.fullName}
                      placeholder={placeholderFor(payload.patient.fullName, "")}
                      disabled={!editing || activeJob.status === "synced"}
                      onChange={(event) => updatePatient("fullName", event.target.value)}
                    />
                  </label>
                  <label className="doc-table-field">
                    <span>Age</span>
                    <input
                      value={payload.patient.age}
                      placeholder={placeholderFor(payload.patient.age, "")}
                      disabled={!editing || activeJob.status === "synced"}
                      onChange={(event) => updatePatient("age", event.target.value)}
                    />
                  </label>
                  <label className="doc-table-field">
                    <span>Gender</span>
                    <input
                      value={payload.patient.gender}
                      placeholder={placeholderFor(payload.patient.gender, "")}
                      disabled={!editing || activeJob.status === "synced"}
                      onChange={(event) => updatePatient("gender", event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <div className="doc-table-card__divider" aria-hidden="true" />

              <section className="doc-table-card__record" aria-label="Treatment record">
                <span className="doc-table-card__section-label">Treatment Record</span>
                <div className="doc-table-card__table-wrap">
                  <table className="doc-table-card__table">
                    <colgroup>
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "22%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "10%" }} />
                      {editing && activeJob.status !== "synced" ? <col style={{ width: "44px" }} /> : null}
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Tooth No./s</th>
                        <th>Procedure</th>
                        <th>Dentist/s</th>
                        <th>Amount Charged</th>
                        <th>Amount Paid</th>
                        <th>Balance</th>
                        <th>Next Appt.</th>
                        {editing && activeJob.status !== "synced" ? <th aria-label="Row actions" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(payload.procedure.visits || [emptyVisitRow()]).map((visit, index) => (
                        <tr key={`visit-${index}`}>
                          <td>
                            <input
                              value={visit.treatmentDate || ""}
                              placeholder=""
                              disabled={!editing || activeJob.status === "synced"}
                              onChange={(event) => updateVisit(index, "treatmentDate", event.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              value={visit.toothNos || ""}
                              disabled={!editing || activeJob.status === "synced"}
                              onChange={(event) => updateVisit(index, "toothNos", event.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              value={visit.treatment || ""}
                              disabled={!editing || activeJob.status === "synced"}
                              onChange={(event) => updateVisit(index, "treatment", event.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              value={visit.dentistName || ""}
                              disabled={!editing || activeJob.status === "synced"}
                              onChange={(event) => updateVisit(index, "dentistName", event.target.value)}
                            />
                          </td>
                          <td className="is-amount">
                            <input
                              value={visit.amountCharged || ""}
                              disabled={!editing || activeJob.status === "synced"}
                              onChange={(event) => updateVisit(index, "amountCharged", event.target.value)}
                            />
                          </td>
                          <td className="is-amount">
                            <input
                              value={visit.amountPaid || ""}
                              disabled={!editing || activeJob.status === "synced"}
                              onChange={(event) => updateVisit(index, "amountPaid", event.target.value)}
                            />
                          </td>
                          <td className="is-amount">
                            <input
                              value={visit.balance || ""}
                              disabled={!editing || activeJob.status === "synced"}
                              onChange={(event) => updateVisit(index, "balance", event.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              value={visit.nextAppt || ""}
                              disabled={!editing || activeJob.status === "synced"}
                              onChange={(event) => updateVisit(index, "nextAppt", event.target.value)}
                            />
                          </td>
                          {editing && activeJob.status !== "synced" ? (
                            <td className="doc-table-card__row-action">
                              <button
                                type="button"
                                className="doc-table-card__icon-btn"
                                title="Remove row"
                                aria-label="Remove row"
                                onClick={() => removeVisitRow(index)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="doc-table-card__footer">
                  {editing && activeJob.status !== "synced" ? (
                    <button type="button" className="doc-table-card__add-btn" onClick={addVisitRow}>
                      <Plus size={15} /> Add Row
                    </button>
                  ) : (
                    <span />
                  )}

                  {activeJob.status !== "synced" ? (
                    <button
                      type="button"
                      className="button button--primary doc-table-card__save-btn"
                      onClick={confirmAndSave}
                      disabled={Boolean(busy)}
                    >
                      <CheckCircle2 size={16} /> {busy === "sync" ? "Saving…" : "Confirm & Save"}
                    </button>
                  ) : (
                    <p className="inline-alert inline-alert--success doc-table-card__saved">
                      Saved to clinical record #{activeJob.linkedPatientId}
                      {activeJob.linkedTreatmentId ? ` · treatment #${activeJob.linkedTreatmentId}` : ""} ·{" "}
                      {formatAdminDateTime(activeJob.syncedAt)}. Original document deleted.
                    </p>
                  )}
                </div>
              </section>

              {matchInfo?.isNewPatient === false && matchInfo?.match ? (
                <p className="inline-alert inline-alert--success">
                  Existing patient match: {matchInfo.match.fullName} (ID {matchInfo.match.id})
                </p>
              ) : null}
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
