import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, FileText, Image as ImageIcon, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDateTime } from "../adminUtils";

function hoursFromNow(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.round(ms / (60 * 60 * 1000)));
}

function hoursAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / (60 * 60 * 1000)));
}

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
    clinicLocation: "",
    status: "completed",
    notes: "",
    coverageStatus: "",
    visits: [],
  },
};

function placeholderFor(value, emptyLabel = "Unreadable") {
  return value ? undefined : emptyLabel;
}

function visitHasSignal(row = {}) {
  return Boolean(
    String(row.treatmentDate || "").trim() ||
      String(row.treatment || "").trim() ||
      String(row.amountCharged || "").trim() ||
      String(row.toothNos || "").trim() ||
      String(row.dentistName || "").trim() ||
      String(row.amountPaid || "").trim() ||
      String(row.balance || "").trim() ||
      String(row.nextAppt || "").trim()
  );
}

/** Always put readable primary procedure fields into the Document Table visit rows. */
function seedVisitsFromProcedure(procedure = {}) {
  const rawVisits = Array.isArray(procedure.visits) ? procedure.visits : [];
  const visits = rawVisits.map((row) => ({ ...emptyVisitRow(), ...(row || {}) }));
  const usable = visits.filter(visitHasSignal);
  if (usable.length) {
    // Every extracted row is kept as its own line; a multi-row document is never
    // collapsed into the single primary procedure.
    if (usable.length > 1) return usable;
    // Single-row documents: fill only the cells the table left blank.
    const first = { ...usable[0] };
    if (procedure.treatment && !first.treatment) first.treatment = procedure.treatment;
    if (procedure.treatmentDate && !first.treatmentDate) first.treatmentDate = procedure.treatmentDate;
    if (procedure.amountCharged && !first.amountCharged) first.amountCharged = procedure.amountCharged;
    // CREDIT OCR sometimes lands in Amount Paid — keep the fee in Amount Charged.
    if (!String(first.amountCharged || "").trim() && String(first.amountPaid || "").trim()) {
      first.amountCharged = first.amountPaid;
      first.amountPaid = "";
    }
    if (procedure.dentistName && !first.dentistName) first.dentistName = procedure.dentistName;
    return [first];
  }
  const seeded = {
    ...emptyVisitRow(),
    treatmentDate: procedure.treatmentDate || "",
    treatment: procedure.treatment || "",
    dentistName: procedure.dentistName || "",
    amountCharged: procedure.amountCharged || "",
  };
  return visitHasSignal(seeded) ? [seeded] : [emptyVisitRow()];
}

function normalizePayload(input) {
  const next = input && typeof input === "object" ? input : {};
  const procedure = { ...emptyPayload.procedure, ...(next.procedure || {}) };
  return {
    ...emptyPayload,
    ...next,
    documentForm: next.documentForm || emptyPayload.documentForm,
    patient: { ...emptyPayload.patient, ...(next.patient || {}) },
    procedure: {
      ...procedure,
      visits: seedVisitsFromProcedure(procedure),
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
  const { pushToast } = useAdminUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const pdfInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const localPreviewRef = useRef("");
  const serverPreviewRef = useRef("");
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [payload, setPayload] = useState(emptyPayload);
  const [editing, setEditing] = useState(true);
  const [sourceType, setSourceType] = useState("soft_copy");
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [serverPreviewUrl, setServerPreviewUrl] = useState("");
  const [previewBroken, setPreviewBroken] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [step, setStep] = useState("choose");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [matchInfo, setMatchInfo] = useState(null);
  const [decision, setDecision] = useState(null);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [conflictIndex, setConflictIndex] = useState(0);
  const [fieldResolutions, setFieldResolutions] = useState({});
  const [manualFields, setManualFields] = useState({});
  const focusHandledRef = useRef("");

  const clearPreviews = useCallback(() => {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current);
      localPreviewRef.current = "";
    }
    if (serverPreviewRef.current) {
      URL.revokeObjectURL(serverPreviewRef.current);
      serverPreviewRef.current = "";
    }
    setLocalPreviewUrl("");
    setServerPreviewUrl("");
    setPreviewBroken(false);
  }, []);

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
    const focus = searchParams.get("focus");
    if (!focus || !loaded) return;
    if (focusHandledRef.current === focus) return;
    const match = jobs.find((job) => String(job.id) === String(focus));
    if (!match) return;
    focusHandledRef.current = focus;
    openJob(match.id);
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, loaded, jobs]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
      if (serverPreviewRef.current) URL.revokeObjectURL(serverPreviewRef.current);
    };
  }, []);

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
      if (serverPreviewRef.current) URL.revokeObjectURL(serverPreviewRef.current);
      serverPreviewRef.current = url;
      setServerPreviewUrl(url);
      setPreviewBroken(false);
    } catch {
      // Keep any local upload preview even if the temporary server file is unavailable.
      if (!localPreviewRef.current) {
        setServerPreviewUrl("");
      }
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
    const localUrl = URL.createObjectURL(file);
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    localPreviewRef.current = localUrl;
    setLocalPreviewUrl(localUrl);
    setPreviewBroken(false);
    setStep("processing");
    setBusy("scan");
    stopCamera();

    try {
      const response = await api.uploadAdminDocumentSync(file, nextSourceType);
      if (response.needsReview) {
        const nextPayload = normalizePayload(
          response.job.editedPayload || response.job.extractedPayload || emptyPayload
        );
        setActiveJob(response.job);
        setPayload(nextPayload);
        setStep("needs-review");
        setMessage(response.message);
        await loadServerPreview(response.job.id);
        await load();
        return;
      }
      const nextPayload = normalizePayload(
        response.job.editedPayload || response.job.extractedPayload || emptyPayload
      );
      const filled = [
        nextPayload?.patient?.fullName,
        nextPayload?.patient?.age,
        nextPayload?.patient?.gender,
        nextPayload?.patient?.phone,
        nextPayload?.patient?.dateOfBirth,
        nextPayload?.patient?.address,
        nextPayload?.procedure?.treatment,
        nextPayload?.procedure?.treatmentDate,
        nextPayload?.procedure?.amountCharged,
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

      if (filled <= 0) {
        const unreadMessage =
          response.message ||
          "Unable to read the uploaded or scanned document. No patient or treatment fields could be detected. Please upload a clearer scan or photo and try again.";
        setStep("choose");
        setError(unreadMessage);
        pushToast(unreadMessage, "error");
        clearPreviews();
        await load();
        return;
      }

      setActiveJob(response.job);
      setPayload(nextPayload);
      setEditing(true);
      const autoMessage =
        response.message ||
        `Document read successfully — auto-filled ${filled} field${filled === 1 ? "" : "s"} from the scan. Review them, then Confirm & Save.`;
      const notes = String(response.job?.extractionNotes || response.extractionNotes || "");
      const buildTag = (autoMessage.match(/autofill-build:\s*[\w.-]+/i) || notes.match(/autofill-build:\s*[\w.-]+/i) || [])[0] || "";
      setMessage(buildTag ? `${autoMessage}${autoMessage.includes("autofill-build") ? "" : ` (${buildTag})`}` : autoMessage);
      setStep("review");
      pushToast(autoMessage);
      await loadServerPreview(response.job.id);
      await load();
    } catch (scanError) {
      const unrecognized =
        scanError instanceof ApiError &&
        (scanError.data?.code === "INVALID_DOCUMENT" ||
          /document not recognized|invalid document|does not appear/i.test(scanError.message || ""));
      setStep(unrecognized ? "unrecognized" : "choose");
      setError(scanError.message);
      pushToast(scanError.message, "error");
      if (!unrecognized) clearPreviews();
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

  async function finishCommit({ confirmNewPatient = false, selectedPatientId = "", resolutions = {}, manuals = {} } = {}) {
    const response = await api.commitAdminDocumentSync(activeJob.id, {
      payload,
      confirmNewPatient,
      selectedPatientId: selectedPatientId || undefined,
      fieldResolutions: resolutions,
      manualFields: manuals,
    });
    setActiveJob(response.job);
    setPayload(normalizePayload(response.job.editedPayload));
    setMessage(response.message);
    setStep("done");
    setEditing(false);
    setDecision(null);
    pushToast(response.message || "Document successfully imported and data saved.");
    await load();
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
      setSelectedMatchId(matchPreview.match?.id || "");
      setFieldResolutions({});
      setManualFields({});
      setConflictIndex(0);

      if (matchPreview.needsSelection) {
        setDecision("multiple");
        return;
      }
      if (matchPreview.needsMergeDecision) {
        setDecision("merge");
        return;
      }
      if (matchPreview.isNewPatient) {
        setDecision("new");
        return;
      }

      await finishCommit({ confirmNewPatient: true });
    } catch (syncError) {
      if (syncError instanceof ApiError && syncError.data?.needsSelection) {
        setMatchInfo((current) => ({ ...current, matches: syncError.data.matches || [] }));
        setDecision("multiple");
        return;
      }
      if (syncError instanceof ApiError && syncError.data?.needsMergeDecision) {
        setMatchInfo((current) => ({
          ...current,
          match: syncError.data.match,
          matches: syncError.data.matches || [syncError.data.match].filter(Boolean),
          conflicts: syncError.data.conflicts || [],
        }));
        setDecision("merge");
        return;
      }
      if (syncError instanceof ApiError && syncError.data?.needsNewPatientConfirmation) {
        setDecision("new");
        return;
      }
      setError(syncError.message);
      pushToast(syncError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function chooseCreateNew() {
    setBusy("sync");
    try {
      await finishCommit({ confirmNewPatient: true });
    } catch (error) {
      setError(error.message);
      pushToast(error.message, "error");
    } finally {
      setBusy("");
    }
  }

  function resolveConflict(field, choice) {
    const nextResolutions = { ...fieldResolutions, [field]: choice };
    setFieldResolutions(nextResolutions);
    const conflicts = matchInfo?.conflicts || [];
    const nextIndex = conflictIndex + 1;
    if (nextIndex < conflicts.length) {
      setConflictIndex(nextIndex);
      return;
    }
    chooseMerge(selectedMatchId || matchInfo?.match?.id, nextResolutions);
  }

  async function chooseMerge(patientId, resolutions = fieldResolutions) {
    const conflicts = matchInfo?.conflicts || [];
    if (conflicts.length && !conflicts.every((item) => resolutions[item.field])) {
      setSelectedMatchId(patientId);
      setDecision("conflicts");
      setConflictIndex(0);
      return;
    }
    setBusy("sync");
    try {
      await finishCommit({
        selectedPatientId: patientId,
        resolutions,
        manuals: manualFields,
      });
    } catch (error) {
      if (error instanceof ApiError && error.data?.needsMergeDecision && (error.data.conflicts || []).length) {
        setMatchInfo((current) => ({ ...current, conflicts: error.data.conflicts }));
        setDecision("conflicts");
        return;
      }
      setError(error.message);
      pushToast(error.message, "error");
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
    setDecision(null);
    setSelectedMatchId("");
    setFieldResolutions({});
    setManualFields({});
    setMessage("");
    setError("");
    setEditing(true);
    setStep("choose");
  }

  if (!loaded && error) return <ErrorState message={error} onRetry={load} />;
  if (!loaded) return <LoadingState label="Loading document data extraction…" />;

  const previewUrl = !previewBroken
    ? localPreviewUrl || serverPreviewUrl
    : serverPreviewUrl || localPreviewUrl;
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
            then saves only that structured text to the database after you review it. Face photos and
            non-documents are rejected. Uploaded scans stay in Recent Scans for 24 hours, then the
            temporary file is deleted. Permanent patient records are never removed with the scan.
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
            Hard copy via camera, or digital PDF / PNG / JPEG. Scanning and uploads are processed for clearer
            readability, then fields are filled only with values that match the scanned document. Blank cells stay
            blank when a value cannot be read — nothing is invented. Existing patient records are not overwritten;
            only new treatment rows are added. Tip: keep the paper upright and well-lit.
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

      {step === "unrecognized" ? (
        <section className="admin-panel">
          <h2>Document Not Recognized</h2>
          <p>
            The uploaded file does not appear to be a supported patient or dental document.
          </p>
          <p className="muted-copy">Please upload a valid:</p>
          <ul className="muted-copy">
            <li>Patient record</li>
            <li>Dental treatment record</li>
            <li>Patient information form</li>
            <li>Scanned dental document</li>
          </ul>
          <div className="admin-heading-actions">
            <button type="button" className="button button--primary" onClick={startOver}>
              <Upload size={16} /> Upload Another Document
            </button>
          </div>
        </section>
      ) : null}

      {step === "needs-review" && activeJob ? (
        <section className="admin-panel">
          <h2>Document Needs Review</h2>
          <p>
            We found text, but we could not confidently identify this as a patient or dental record.
            The original file is kept for 24 hours so you can review it.
          </p>
          <div className="admin-heading-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setEditing(true);
                setStep("review");
              }}
            >
              Review Extraction
            </button>
            <button type="button" className="button button--secondary" onClick={startOver}>
              Upload Another Document
            </button>
          </div>
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
                The table below is filled to match the scanned/attached document. Fix OCR mistakes in the cells, then
                confirm. Blank cells stay blank when unread.
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
                  <img
                    src={previewUrl}
                    alt="Uploaded or scanned document"
                    onError={() => {
                      if (!previewBroken && localPreviewUrl && serverPreviewUrl && previewUrl === localPreviewUrl) {
                        setPreviewBroken(true);
                        return;
                      }
                      setPreviewBroken(true);
                      if (previewUrl === localPreviewUrl) setLocalPreviewUrl("");
                      if (previewUrl === serverPreviewUrl) setServerPreviewUrl("");
                    }}
                  />
                )
              ) : (
                <p className="muted-copy">
                  {activeJob.status === "synced"
                    ? "Source document discarded after import. Only confirmed structured data was saved."
                    : "Temporary preview unavailable. Keep the upload selected or re-upload the photo."}
                </p>
              )}
            </div>

            <div className="admin-doc-fields doc-table-card">
              <header className="doc-table-card__header">
                <h3>Document Table</h3>
                <p className="doc-table-card__helper">
                  Auto-filled to match the scan/attachment. Edit a cell only to fix OCR mistakes. Leave blank cells
                  blank — do not invent values.
                </p>
              </header>

              <section className="doc-table-card__patient" aria-label="Patient information">
                <span className="doc-table-card__section-label">Patient Information</span>
                <div className="doc-table-card__patient-grid">
                  <label className="doc-table-field doc-table-field--wide">
                    <span>Name</span>
                    <input
                      value={payload.patient.fullName}
                      placeholder={placeholderFor(payload.patient.fullName, "")}
                      disabled={!editing || activeJob.status === "synced"}
                      onChange={(event) => updatePatient("fullName", event.target.value)}
                    />
                  </label>
                  <label className="doc-table-field doc-table-field--age">
                    <span>Age</span>
                    <input
                      value={payload.patient.age}
                      placeholder={placeholderFor(payload.patient.age, "")}
                      disabled={!editing || activeJob.status === "synced"}
                      onChange={(event) => updatePatient("age", event.target.value)}
                      aria-label="Age"
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
                  <label className="doc-table-field">
                    <span>Phone / Cellphone</span>
                    <input
                      value={payload.patient.phone}
                      placeholder={placeholderFor(payload.patient.phone, "")}
                      disabled={!editing || activeJob.status === "synced"}
                      onChange={(event) => updatePatient("phone", event.target.value)}
                    />
                  </label>
                  <label className="doc-table-field">
                    <span>Date of Birth</span>
                    <input
                      value={payload.patient.dateOfBirth}
                      placeholder={placeholderFor(payload.patient.dateOfBirth, "")}
                      disabled={!editing || activeJob.status === "synced"}
                      onChange={(event) => updatePatient("dateOfBirth", event.target.value)}
                    />
                  </label>
                  <label className="doc-table-field doc-table-field--wide">
                    <span>Address</span>
                    <input
                      value={payload.patient.address}
                      placeholder={placeholderFor(payload.patient.address, "")}
                      disabled={!editing || activeJob.status === "synced"}
                      onChange={(event) => updatePatient("address", event.target.value)}
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
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "24%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "10%" }} />
                      {editing && activeJob.status !== "synced" ? <col style={{ width: "44px" }} /> : null}
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Tooth</th>
                        <th>Procedure</th>
                        <th>Dentist</th>
                        <th>Amount Charged</th>
                        <th>Amount Paid</th>
                        <th>Balance</th>
                        <th>Next Appt</th>
                        {editing && activeJob.status !== "synced" ? <th aria-label="Row actions" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(payload.procedure.visits || [emptyVisitRow()]).map((visit, index) => (
                        <tr key={`visit-${index}`}>
                          <td className="is-date">
                            <input
                              value={visit.treatmentDate || ""}
                              placeholder=""
                              title={visit.treatmentDate || ""}
                              aria-label="Date"
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
                          <td className="is-procedure">
                            <input
                              value={visit.treatment || ""}
                              title={visit.treatment || ""}
                              aria-label="Procedure"
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

              {matchInfo?.match ? (
                <p className="inline-alert inline-alert--success">
                  Existing patient: {matchInfo.match.fullName} (Patient ID{" "}
                  {matchInfo.match.patientId || matchInfo.match.id})
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="admin-panel">
        <h2>Recent Scans</h2>
        <p className="muted-copy">
          Temporary uploaded or scanned files remain available for 24 hours on the server clock, then
          they are deleted automatically. Saved patient and treatment records stay.
        </p>
        {jobs.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Scan</th>
                  <th>Source</th>
                  <th>Uploaded</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className={String(job.id) === String(searchParams.get("focus") || "") ? "is-notification-focus" : undefined}
                  >
                    <td>
                      <strong>{job.extractedName || "Unnamed scan"}</strong>
                      <div className="muted-copy">{job.originalName}</div>
                    </td>
                    <td>{job.sourceLabel || job.sourceType.replaceAll("_", " ")}</td>
                    <td>
                      {hoursAgo(job.uploadedAt || job.createdAt) != null
                        ? `Uploaded ${hoursAgo(job.uploadedAt || job.createdAt)} hour${
                            hoursAgo(job.uploadedAt || job.createdAt) === 1 ? "" : "s"
                          } ago`
                        : formatAdminDateTime(job.createdAt)}
                    </td>
                    <td>
                      {job.expiresAt
                        ? `Expires in ${hoursFromNow(job.expiresAt)} hour${
                            hoursFromNow(job.expiresAt) === 1 ? "" : "s"
                          }`
                        : "Within 24 hours"}
                    </td>
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
            title="No recent scans."
            detail="Scan a hard copy or upload a PDF/PNG/JPEG. Temporary files appear here until they expire."
          />
        )}
      </section>

      {decision === "merge" && matchInfo?.match ? (
        <AdminModal title="Possible Existing Patient Found" onClose={() => setDecision(null)}>
          <p>Extracted from document:</p>
          <p>
            <strong>{payload.patient.fullName || matchInfo.proposedPatient?.fullName}</strong>
          </p>
          <p>Existing patient:</p>
          <p>
            <strong>{matchInfo.match.fullName}</strong>
            <br />
            Patient ID: {matchInfo.match.patientId || matchInfo.match.id}
          </p>
          <p>What would you like to do?</p>
          <div className="admin-modal__actions">
            <button type="button" className="button button--primary" onClick={() => chooseMerge(matchInfo.match.id)}>
              Merge With Existing Patient
            </button>
            <button type="button" className="button button--secondary" onClick={chooseCreateNew}>
              Create New Patient
            </button>
          </div>
        </AdminModal>
      ) : null}

      {decision === "multiple" && matchInfo?.matches?.length ? (
        <AdminModal title="Possible Matches" onClose={() => setDecision(null)} wide>
          <p>Please select the correct patient:</p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th />
                  <th>Name</th>
                  <th>Patient ID</th>
                  <th>Birthdate</th>
                </tr>
              </thead>
              <tbody>
                {matchInfo.matches.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="radio"
                        name="sync-match"
                        checked={String(selectedMatchId) === String(row.id)}
                        onChange={() => setSelectedMatchId(row.id)}
                      />
                    </td>
                    <td>{row.fullName}</td>
                    <td>{row.patientId || row.id}</td>
                    <td>{row.dateOfBirth ? String(row.dateOfBirth).slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-modal__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={!selectedMatchId}
              onClick={() => chooseMerge(selectedMatchId)}
            >
              Select Patient
            </button>
            <button type="button" className="button button--secondary" onClick={chooseCreateNew}>
              Create New Patient
            </button>
          </div>
        </AdminModal>
      ) : null}

      {decision === "new" ? (
        <AdminModal title="Create New Patient" onClose={() => setDecision(null)}>
          <p>
            No existing patient was selected. Create a new clinical patient from the extracted
            information? The Patient ID is generated by the server.
          </p>
          <p>
            <strong>{payload.patient.fullName}</strong>
          </p>
          <div className="admin-modal__actions">
            <button type="button" className="button button--secondary" onClick={() => setDecision(null)}>
              Cancel
            </button>
            <button type="button" className="button button--primary" onClick={chooseCreateNew}>
              Create New Patient
            </button>
          </div>
        </AdminModal>
      ) : null}

      {decision === "conflicts" && matchInfo?.conflicts?.length ? (
        <AdminModal title="Data Conflict" onClose={() => setDecision(null)}>
          {(() => {
            const conflict = matchInfo.conflicts[conflictIndex] || matchInfo.conflicts[0];
            return (
              <>
                <p>
                  <strong>{conflict.field}</strong>
                </p>
                <p>
                  Existing:
                  <br />
                  <strong>{conflict.existingValue}</strong>
                </p>
                <p>
                  Document:
                  <br />
                  <strong>{conflict.documentValue}</strong>
                </p>
                {fieldResolutions[conflict.field] === "manual" ? (
                  <label className="field">
                    <span>Edit manually</span>
                    <input
                      value={
                        manualFields[
                          conflict.field === "Phone"
                            ? "phone"
                            : conflict.field === "Email"
                              ? "email"
                              : conflict.field === "Address"
                                ? "address"
                                : "dateOfBirth"
                        ] || ""
                      }
                      onChange={(event) => {
                        const key =
                          conflict.field === "Phone"
                            ? "phone"
                            : conflict.field === "Email"
                              ? "email"
                              : conflict.field === "Address"
                                ? "address"
                                : "dateOfBirth";
                        setManualFields((current) => ({ ...current, [key]: event.target.value }));
                      }}
                    />
                  </label>
                ) : null}
                <div className="admin-modal__actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => resolveConflict(conflict.field, "existing")}
                  >
                    Keep Existing
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => resolveConflict(conflict.field, "document")}
                  >
                    Use Document
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() =>
                      setFieldResolutions((current) => ({ ...current, [conflict.field]: "manual" }))
                    }
                  >
                    Edit Manually
                  </button>
                </div>
              </>
            );
          })()}
        </AdminModal>
      ) : null}
    </div>
  );
}
