import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileText,
  Loader2,
  ScanLine,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { api, ApiError } from "../api";
import { useAdminUi } from "../components/AdminLayout";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { EmptyState, LoadingState } from "../components/UI";

const FIELD_ORDER = [
  ["firstName", "First Name", "text"],
  ["middleName", "Middle Name", "text"],
  ["lastName", "Last Name", "text"],
  ["dateOfBirth", "Birthdate", "date"],
  ["sex", "Sex", "sex"],
  ["phone", "Phone Number", "tel"],
  ["email", "Email", "email"],
  ["address", "Address", "text"],
];

const CATEGORY_OPTIONS = [
  { value: "regular", label: "Regular Patient (A)" },
  { value: "senior", label: "Senior Citizen (S)" },
  { value: "pediatric", label: "Pediatric Patient (P)" },
  { value: "pwd", label: "PWD (W)" },
];

const SEX_OPTIONS = ["Male", "Female", "Non-binary", "Prefer to self-describe"];

const STEPS = ["Documents", "Review", "Patient match", "Saved"];

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

function displayPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^63\d{10}$/.test(digits) ? `0${digits.slice(2)}` : digits || "—";
}

function categoryLabel(value) {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label || "—";
}

function fieldTone(field, validation, key) {
  if (validation?.missing?.includes(key)) return "missing";
  if (validation?.invalid?.some((item) => item.key === key)) return "invalid";
  if (field?.status === "manual") return "manual";
  if (field?.status === "extracted" && validation?.lowConfidence?.includes(key)) return "review";
  if (field?.status === "extracted") return "extracted";
  return "empty";
}

export function AdminPatientIntakePage() {
  const { pushToast, confirm } = useAdminUi();
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState([]);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(null); // { name, sourceType }
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState({});
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [matchState, setMatchState] = useState(null); // { matches, isNewPatient }
  const [applyFields, setApplyFields] = useState([]);
  const [saved, setSaved] = useState(null);
  const uploadInputRef = useRef(null);
  const scanInputRef = useRef(null);

  const loadHistory = useCallback(async () => {
    try {
      const response = await api.getAdminIntakeSessions();
      setHistory(response.sessions || []);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 503) {
        setError(loadError.message);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!session) {
      setDraft({});
      return;
    }
    const next = {};
    for (const [key] of FIELD_ORDER) next[key] = session.values?.[key] || "";
    next.patientCategory = session.values?.patientCategory || "";
    setDraft(next);
  }, [session?.id, session?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const processed = (session?.documents || []).filter((doc) => doc.hasPreview);
    if (!processed.length) {
      setPreviewDoc(null);
      return;
    }
    if (!previewDoc || !processed.some((doc) => doc.id === previewDoc.id)) {
      setPreviewDoc(processed[processed.length - 1]);
    }
  }, [session?.documents, previewDoc]);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    if (previewDoc && session) {
      api
        .getAdminIntakeDocumentBlob(session.id, previewDoc.id)
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        })
        .catch(() => setPreviewUrl(""));
    } else {
      setPreviewUrl("");
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewDoc?.id, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = useMemo(() => {
    if (saved) return 3;
    if (matchState) return 2;
    if (session?.documents?.some((doc) => doc.status === "processed")) return 1;
    return 0;
  }, [saved, matchState, session]);

  async function startSession() {
    setError("");
    setSaved(null);
    setMatchState(null);
    setBusy("start");
    try {
      const response = await api.createAdminIntakeSession();
      setSession(response.session);
    } catch (startError) {
      setError(startError.message);
    } finally {
      setBusy("");
    }
  }

  async function openSession(id) {
    setError("");
    setSaved(null);
    setMatchState(null);
    setBusy(`open-${id}`);
    try {
      const response = await api.getAdminIntakeSession(id);
      setSession(response.session);
      if (response.session.status === "saved") {
        setSaved({ session: response.session, patientId: response.session.patientId, record: null });
      }
    } catch (openError) {
      setError(openError.message);
    } finally {
      setBusy("");
    }
  }

  async function handleFile(event, sourceType) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !session) return;
    setError("");
    setMatchState(null);
    setProcessing({ name: file.name, sourceType });
    try {
      const response = await api.uploadAdminIntakeDocument(session.id, file, sourceType);
      setSession(response.session);
      pushToast(response.message, "success");
    } catch (uploadError) {
      setError(uploadError.message);
      await api.getAdminIntakeSession(session.id).then((r) => setSession(r.session)).catch(() => {});
    } finally {
      setProcessing(null);
    }
  }

  async function removeDocument(doc) {
    const ok = await confirm({
      title: "Remove document",
      message: `Remove ${doc.originalName} from this intake? Extracted values from it will be dropped.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(`remove-${doc.id}`);
    try {
      const response = await api.removeAdminIntakeDocument(session.id, doc.id);
      setSession(response.session);
      setMatchState(null);
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy("");
    }
  }

  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMatchState(null);
  }

  const persistEdits = useCallback(
    async (fields) => {
      if (!session) return null;
      setBusy("save-fields");
      try {
        const response = await api.updateAdminIntakeSession(session.id, { fields });
        setSession(response.session);
        return response.session;
      } catch (saveError) {
        setError(saveError.message);
        return null;
      } finally {
        setBusy("");
      }
    },
    [session]
  );

  function changedFields() {
    const changes = {};
    for (const [key] of FIELD_ORDER) {
      if ((draft[key] || "") !== (session?.values?.[key] || "")) changes[key] = draft[key] || "";
    }
    if ((draft.patientCategory || "") !== (session?.values?.patientCategory || "")) {
      changes.patientCategory = draft.patientCategory || "";
    }
    return changes;
  }

  async function saveReview() {
    const changes = changedFields();
    if (!Object.keys(changes).length) return session;
    const next = await persistEdits(changes);
    if (next) pushToast("Reviewed information saved.", "success");
    return next;
  }

  async function resolveConflict(field, value) {
    setBusy(`conflict-${field}`);
    try {
      const response = await api.updateAdminIntakeSession(session.id, { resolveConflicts: { [field]: value } });
      setSession(response.session);
    } catch (resolveError) {
      setError(resolveError.message);
    } finally {
      setBusy("");
    }
  }

  async function confirmCategory(category) {
    const next = await persistEdits({ patientCategory: category });
    if (next) pushToast(`Patient category confirmed: ${categoryLabel(category)}.`, "success");
  }

  async function checkMatches() {
    setError("");
    const current = await saveReview();
    if (!current) return;
    if (!current.validation?.valid) {
      setError("Complete the required patient information (and confirm the category) before continuing.");
      return;
    }
    if (current.conflicts?.length) {
      setError("Resolve the flagged document conflicts before continuing.");
      return;
    }
    setBusy("match");
    try {
      const response = await api.matchAdminIntakeSession(current.id);
      setMatchState(response);
      setApplyFields([]);
    } catch (matchError) {
      setError(matchError.message);
    } finally {
      setBusy("");
    }
  }

  async function finalize({ link = null, createNew = false }) {
    const label = createNew
      ? "Create a new patient record from the reviewed information? The Patient ID is generated now; account verification stays a separate step."
      : "Attach the documents and selected fields to this existing patient? Only the fields you ticked will be updated.";
    const ok = await confirm({
      title: createNew ? "Confirm new patient" : "Confirm existing patient",
      message: label,
      confirmLabel: createNew ? "Create patient record" : "Save to existing patient",
    });
    if (!ok) return;
    setBusy("confirm");
    setError("");
    try {
      const response = await api.confirmAdminIntakeSession(session.id, { link, createNew, applyFields });
      setSaved(response);
      setSession(response.session);
      setMatchState(null);
      pushToast(response.message, "success");
      loadHistory();
    } catch (confirmError) {
      if (confirmError instanceof ApiError && confirmError.data?.matches) {
        setMatchState({ matches: confirmError.data.matches, isNewPatient: !confirmError.data.matches.length });
      }
      setError(confirmError.message);
    } finally {
      setBusy("");
    }
  }

  async function cancelSession() {
    const ok = await confirm({
      title: "Discard intake",
      message: "Discard this intake and delete its temporary documents? Nothing has been saved to a patient record.",
      confirmLabel: "Discard",
      tone: "danger",
    });
    if (!ok) return;
    setBusy("cancel");
    try {
      await api.cancelAdminIntakeSession(session.id);
      setSession(null);
      setMatchState(null);
      setSaved(null);
      loadHistory();
    } catch (cancelError) {
      setError(cancelError.message);
    } finally {
      setBusy("");
    }
  }

  if (!loaded) return <LoadingState label="Loading patient document intake…" />;

  const documents = session?.documents || [];
  const validation = session?.validation || { missing: [], invalid: [], lowConfidence: [] };
  const conflicts = session?.conflicts || [];
  const readOnly = session?.status !== "draft";
  const suggested = session?.suggestedCategory;

  return (
    <div className="admin-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="admin-panel admin-sync-hero">
        <div>
          <span className="eyebrow">Admin-only · Document to patient record</span>
          <h2>Patient Document Intake</h2>
          <p className="muted-copy">
            Upload or scan a patient document once. The system extracts the details, fills the patient form,
            and you review, correct, and confirm before anything is saved. Account verification remains a
            separate Admin action under{" "}
            <Link to="/admin/users">Manage Users</Link>.
          </p>
        </div>
        <ScanLine size={42} aria-hidden="true" />
      </section>

      <ol className="admin-sync-steps" aria-label="Intake steps">
        {STEPS.map((label, index) => (
          <li key={label} className={step === index ? "is-active" : ""}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {!session ? (
        <section className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span className="eyebrow">Start</span>
              <h3>New patient intake</h3>
              <p className="muted-copy">Attach one or more supporting documents (PDF, JPG, PNG, scans, photos).</p>
            </div>
            <button type="button" className="button button--primary" onClick={startSession} disabled={busy === "start"}>
              <Upload size={16} aria-hidden="true" /> Start intake
            </button>
          </div>

          <h4 className="intake-history__title">Recent intakes</h4>
          {history.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Patient</th>
                    <th>Documents</th>
                    <th>Status</th>
                    <th>Patient ID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.createdAt).toLocaleString("en-PH")}</td>
                      <td>{[item.values?.firstName, item.values?.lastName].filter(Boolean).join(" ") || "—"}</td>
                      <td>{item.documentCount}</td>
                      <td>
                        <AdminStatusBadge status={item.status === "draft" ? "pending" : item.status === "saved" ? "completed" : "cancelled"} />
                      </td>
                      <td>{item.patientId ? <code>{item.patientId}</code> : "—"}</td>
                      <td>
                        {item.status !== "cancelled" ? (
                          <button
                            type="button"
                            className="button button--secondary button--compact"
                            onClick={() => openSession(item.id)}
                            disabled={Boolean(busy)}
                          >
                            {item.status === "draft" ? "Continue" : "View"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No intakes yet" detail="Start an intake to process the first patient document." />
          )}
        </section>
      ) : null}

      {session ? (
        <>
          <section className="admin-panel">
            <div className="admin-panel__heading">
              <div>
                <span className="eyebrow">Step 1</span>
                <h3>Upload / Scan Patient Documents</h3>
                <p className="muted-copy">
                  Every document goes through the same extraction pipeline. Multi-page PDFs are read in full and
                  values are combined; conflicting values are flagged instead of overwritten.
                </p>
              </div>
              {!readOnly ? (
                <div className="admin-heading-actions">
                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    hidden
                    onChange={(event) => handleFile(event, "upload")}
                  />
                  <input
                    ref={scanInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(event) => handleFile(event, "scan")}
                  />
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={Boolean(processing) || Boolean(busy)}
                  >
                    <Upload size={16} aria-hidden="true" /> Choose File
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => scanInputRef.current?.click()}
                    disabled={Boolean(processing) || Boolean(busy)}
                  >
                    <Camera size={16} aria-hidden="true" /> Scan Document
                  </button>
                </div>
              ) : null}
            </div>

            {processing ? (
              <div className="intake-processing" role="status" aria-live="polite">
                <Loader2 className="intake-processing__spinner" size={20} aria-hidden="true" />
                <div>
                  <strong>Processing {processing.name}…</strong>
                  <p className="muted-copy">
                    Reading text, detecting Name · Birthdate · Sex · Phone · Address. This can take a moment for
                    scans and photos.
                  </p>
                </div>
              </div>
            ) : null}

            {documents.length ? (
              <ul className="intake-doc-list">
                {documents.map((doc) => (
                  <li key={doc.id} className={`intake-doc intake-doc--${doc.status}`}>
                    <button
                      type="button"
                      className="intake-doc__main"
                      onClick={() => doc.hasPreview && setPreviewDoc(doc)}
                      disabled={!doc.hasPreview}
                    >
                      {doc.status === "failed" ? (
                        <AlertTriangle size={16} aria-hidden="true" />
                      ) : (
                        <CheckCircle2 size={16} aria-hidden="true" />
                      )}
                      <span>
                        <strong>{doc.originalName}</strong>
                        <small>
                          {doc.sourceType === "scan" ? "Scan" : "Upload"} · {doc.pageCount} page{doc.pageCount === 1 ? "" : "s"}
                          {doc.status === "failed" ? ` · ${doc.errorMessage}` : ""}
                          {doc.status !== "failed" && doc.extractionMethod ? ` · ${doc.extractionMethod}` : ""}
                        </small>
                      </span>
                    </button>
                    {!readOnly ? (
                      <button
                        type="button"
                        className="button button--secondary button--compact"
                        onClick={() => removeDocument(doc)}
                        disabled={Boolean(busy)}
                        aria-label={`Remove ${doc.originalName}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : !processing ? (
              <EmptyState
                title="No documents attached"
                detail="Choose a file or scan a document to start extraction. You can also fill the form manually below."
              />
            ) : null}

            {documents.some((doc) => doc.status === "failed") && !readOnly ? (
              <div className="intake-failure">
                <strong>Document processing failed for one or more files.</strong>
                <p className="muted-copy">
                  Possible reasons: blurry document, low image quality, undetectable text, or a damaged file.
                  Try again with a clearer scan, upload another document, or enter the information manually below.
                </p>
              </div>
            ) : null}
          </section>

          <section className="admin-panel">
            <div className="admin-panel__heading">
              <div>
                <span className="eyebrow">Step 2</span>
                <h3>Review Extracted Patient Information</h3>
                <p className="muted-copy">
                  Compare the document with the populated form. Every value stays editable. Low-confidence values are
                  flagged for review; required fields must be complete before saving.
                </p>
              </div>
              {!readOnly ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={saveReview}
                  disabled={Boolean(busy) || !Object.keys(changedFields()).length}
                >
                  {busy === "save-fields" ? "Saving…" : "Save corrections"}
                </button>
              ) : null}
            </div>

            {conflicts.length && !readOnly ? (
              <div className="intake-conflicts">
                {conflicts.map((conflict) => (
                  <div key={conflict.field} className="intake-conflict">
                    <div className="intake-conflict__title">
                      <AlertTriangle size={16} aria-hidden="true" />
                      <strong>Conflict detected — {conflict.label}</strong>
                    </div>
                    <p className="muted-copy">Documents disagree. Choose the correct value or edit it manually.</p>
                    <div className="intake-conflict__options">
                      {conflict.options.map((option) => (
                        <button
                          key={`${option.documentId}-${option.value}`}
                          type="button"
                          className="button button--secondary button--compact"
                          onClick={() => resolveConflict(conflict.field, option.value)}
                          disabled={Boolean(busy)}
                        >
                          {conflict.field === "dateOfBirth" ? formatDate(option.value) : option.value}
                          <small> · {option.documentName || "Document"} · {percent(option.confidence)}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="admin-doc-layout intake-layout">
              <div className="admin-doc-preview">
                <span className="eyebrow">Document preview</span>
                {previewDoc && previewUrl ? (
                  previewDoc.mimeType === "application/pdf" ? (
                    <iframe title={previewDoc.originalName} src={previewUrl} className="admin-doc-preview__frame" />
                  ) : (
                    <img src={previewUrl} alt={previewDoc.originalName} />
                  )
                ) : (
                  <div className="intake-preview-empty">
                    <FileText size={30} aria-hidden="true" />
                    <p className="muted-copy">
                      {documents.length ? "Select a processed document to preview it here." : "The uploaded or scanned document appears here."}
                    </p>
                  </div>
                )}
                {previewDoc ? <small className="muted-copy">{previewDoc.originalName}</small> : null}
              </div>

              <div className="admin-doc-fields doc-table-card">
                <div className="doc-table-card__header">
                  <h3>Patient Information</h3>
                  <p className="muted-copy doc-table-card__helper">
                    Source of truth after saving: the patient account/profile (account-linked) or the clinical record (walk-in).
                  </p>
                </div>

                <div className="intake-form-grid">
                  {FIELD_ORDER.map(([key, label, type]) => {
                    const field = session.fields?.[key];
                    const tone = fieldTone(field, validation, key);
                    const required = validation.requiredFields?.includes(key);
                    return (
                      <label key={key} className={`field intake-field intake-field--${tone}`}>
                        <span>
                          {label}
                          {required ? <em aria-hidden="true"> *</em> : null}
                        </span>
                        {type === "sex" ? (
                          <select
                            value={draft[key] || ""}
                            onChange={(event) => updateDraft(key, event.target.value)}
                            disabled={readOnly}
                          >
                            <option value="">{tone === "missing" ? "Required — not found in document" : "Select"}</option>
                            {SEX_OPTIONS.map((option) => (
                              <option key={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={type === "date" ? "date" : type}
                            value={draft[key] || ""}
                            placeholder={tone === "missing" ? "Required — not found in document" : ""}
                            onChange={(event) => updateDraft(key, event.target.value)}
                            disabled={readOnly}
                          />
                        )}
                        <small className="intake-field__meta">
                          {tone === "missing" ? "Required — not found in document" : null}
                          {tone === "invalid"
                            ? validation.invalid.find((item) => item.key === key)?.message
                            : null}
                          {tone === "review" ? `⚠ Review · ${percent(field.confidence)} confidence` : null}
                          {tone === "extracted" ? `✓ ${percent(field.confidence)} confidence` : null}
                          {tone === "manual" ? "Entered by Admin" : null}
                          {field?.source?.documentName && field.status === "extracted"
                            ? ` · Source: ${field.source.documentName}`
                            : null}
                        </small>
                      </label>
                    );
                  })}
                </div>

                <div className={`intake-category intake-field--${fieldTone(session.fields?.patientCategory, validation, "patientCategory")}`}>
                  <div>
                    <strong>Patient Category *</strong>
                    <p className="muted-copy">
                      {suggested ? `Suggested: ${categoryLabel(suggested.category)} — ${suggested.reason}` : "Choose the patient type."}{" "}
                      {session.age != null ? `Current age: ${session.age}.` : ""} The Patient ID prefix comes from this category and is generated only after you save.
                    </p>
                  </div>
                  <div className="intake-category__controls">
                    <select
                      value={draft.patientCategory || ""}
                      onChange={(event) => updateDraft("patientCategory", event.target.value)}
                      disabled={readOnly}
                    >
                      <option value="">Select category</option>
                      {CATEGORY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {!readOnly ? (
                      <button
                        type="button"
                        className="button button--secondary button--compact"
                        onClick={() => confirmCategory(draft.patientCategory || suggested?.category || "regular")}
                        disabled={Boolean(busy)}
                      >
                        {session.categoryConfirmed && draft.patientCategory === session.values?.patientCategory
                          ? "Category confirmed ✓"
                          : "Confirm category"}
                      </button>
                    ) : (
                      <span className="admin-status admin-status--completed">{categoryLabel(session.values?.patientCategory)}</span>
                    )}
                  </div>
                </div>

                <ul className="intake-checklist" aria-label="Required field status">
                  {[
                    ["Full Name", !validation.missing?.includes("firstName") && !validation.missing?.includes("lastName")],
                    ["Birthdate", !validation.missing?.includes("dateOfBirth") && !validation.invalid?.some((i) => i.key === "dateOfBirth")],
                    ["Sex", !validation.missing?.includes("sex")],
                    ["Phone Number", !validation.missing?.includes("phone") && !validation.invalid?.some((i) => i.key === "phone")],
                    ["Patient Type", session.categoryConfirmed && !validation.missing?.includes("patientCategory")],
                  ].map(([label, ok]) => (
                    <li key={label} className={ok ? "is-ok" : ""}>
                      {ok ? "✓" : "○"} {label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {!readOnly ? (
              <div className="admin-modal__actions intake-actions">
                <button type="button" className="button button--secondary" onClick={cancelSession} disabled={Boolean(busy)}>
                  Discard intake
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={Boolean(busy) || Boolean(processing)}
                >
                  Process Another Document
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={checkMatches}
                  disabled={Boolean(busy) || Boolean(processing)}
                >
                  {busy === "match" ? "Checking existing patients…" : "Confirm & Continue"}
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {matchState && session ? (
        <AdminModal title="Step 3 · Patient match" onClose={() => setMatchState(null)} wide>
          <div className="intake-summary">
            <p>
              <strong>{[draft.firstName, draft.middleName, draft.lastName].filter(Boolean).join(" ")}</strong>
            </p>
            <p className="muted-copy">
              {formatDate(draft.dateOfBirth)} · {draft.sex || "—"} · {displayPhone(draft.phone)} · {categoryLabel(draft.patientCategory)}
            </p>
          </div>

          {matchState.matches?.length ? (
            <>
              <p className="inline-alert inline-alert--warning">
                Possible existing patient{matchState.matches.length === 1 ? "" : "s"} found. Attach these documents to the
                matching patient instead of creating a duplicate, or confirm this is a new patient.
              </p>
              <div className="intake-matches">
                {matchState.matches.map((match) => (
                  <div key={`${match.type}-${match.id}`} className={`intake-match ${match.likely ? "is-likely" : ""}`}>
                    <div className="intake-match__head">
                      {match.type === "account" ? <UserCheck size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
                      <div>
                        <strong>{match.fullName}</strong>
                        <small className="muted-copy">
                          {match.type === "account" ? "Patient account" : "Clinical record (walk-in)"}
                          {match.patientId ? ` · ${match.patientId}` : ""}
                          {match.recordCode ? ` · ${match.recordCode}` : ""}
                          {match.accountStatus ? ` · Account ${match.accountStatus}` : ""}
                        </small>
                      </div>
                      <span className="admin-status admin-status--pending">Matched on {match.reasons.join(", ") || "name"}</span>
                    </div>
                    <div className="admin-detail-grid intake-match__grid">
                      <p><strong>Birthdate:</strong> {formatDate(match.dateOfBirth)}</p>
                      <p><strong>Phone:</strong> {displayPhone(match.phone)}</p>
                      <p><strong>Sex:</strong> {match.gender || "—"}</p>
                      <p><strong>Email:</strong> {match.email || "—"}</p>
                    </div>
                    {match.differences?.length ? (
                      <div className="intake-conflict">
                        <div className="intake-conflict__title">
                          <AlertTriangle size={16} aria-hidden="true" />
                          <strong>Possible information conflict</strong>
                        </div>
                        {match.differences.map((difference) => (
                          <label key={difference.field} className="intake-apply">
                            <input
                              type="checkbox"
                              checked={applyFields.includes(difference.field)}
                              onChange={(event) =>
                                setApplyFields((current) =>
                                  event.target.checked
                                    ? [...current, difference.field]
                                    : current.filter((key) => key !== difference.field)
                                )
                              }
                            />
                            <span>
                              <strong>{difference.field === "dateOfBirth" ? "Birthdate" : "Phone"}</strong> — existing:{" "}
                              {difference.field === "dateOfBirth" ? formatDate(difference.existing) : displayPhone(difference.existing)}; document:{" "}
                              {difference.field === "dateOfBirth" ? formatDate(difference.document) : displayPhone(difference.document)}.
                              Tick to use the document value; leave unticked to keep the existing value.
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                    <div className="intake-match__apply">
                      <span className="muted-copy">Also update on this patient:</span>
                      {["address", "email", "sex", "patientCategory"].map((key) => (
                        <label key={key} className="intake-apply intake-apply--inline">
                          <input
                            type="checkbox"
                            checked={applyFields.includes(key)}
                            onChange={(event) =>
                              setApplyFields((current) =>
                                event.target.checked ? [...current, key] : current.filter((item) => item !== key)
                              )
                            }
                          />
                          <span>{key === "patientCategory" ? "Category" : key === "sex" ? "Sex" : key[0].toUpperCase() + key.slice(1)}</span>
                        </label>
                      ))}
                    </div>
                    <div className="admin-modal__actions">
                      <button
                        type="button"
                        className="button button--primary"
                        onClick={() => finalize({ link: { type: match.type, id: match.id } })}
                        disabled={busy === "confirm"}
                      >
                        <UserCheck size={16} aria-hidden="true" /> Save to this patient
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="inline-alert inline-alert--success">
              No existing patient account or clinical record matched this name, phone, email, or birthdate.
            </p>
          )}

          <div className="admin-modal__actions">
            <button type="button" className="button button--secondary" onClick={() => setMatchState(null)}>
              Back to review
            </button>
            <button
              type="button"
              className={`button ${matchState.matches?.length ? "button--secondary" : "button--primary"}`}
              onClick={() => finalize({ createNew: true })}
              disabled={busy === "confirm"}
            >
              <UserPlus size={16} aria-hidden="true" /> {busy === "confirm" ? "Saving…" : "Confirm new patient & generate Patient ID"}
            </button>
          </div>
        </AdminModal>
      ) : null}

      {saved && session ? (
        <section className="admin-panel intake-saved">
          <div className="admin-panel__heading">
            <div>
              <span className="eyebrow">Step 4 · Saved</span>
              <h3>Patient information stored in the canonical record</h3>
              <p className="muted-copy">
                Basic information now syncs automatically to the Dentist and Staff patient records. The account is{" "}
                <strong>not</strong> verified by this step.
              </p>
            </div>
            <span className="admin-status admin-status--completed">Saved</span>
          </div>
          <div className="admin-detail-grid">
            <p><strong>Patient ID:</strong> {saved.patientId || session.patientId || "Pending (account without ID)"}</p>
            <p><strong>Name:</strong> {saved.record?.fullName || [session.values?.firstName, session.values?.lastName].filter(Boolean).join(" ")}</p>
            <p><strong>Birthdate:</strong> {formatDate(session.values?.dateOfBirth)}</p>
            <p><strong>Category:</strong> {categoryLabel(session.values?.patientCategory)}</p>
            <p><strong>Documents attached:</strong> {documents.filter((doc) => doc.status === "attached").length}</p>
            <p><strong>Record:</strong> {saved.createdNewPatient ? "New patient record created" : "Existing patient updated"}</p>
          </div>
          <div className="admin-modal__actions">
            {saved.linkedUserId || session.linkedUserId ? (
              <Link className="button button--primary" to="/admin/users">
                <UserCheck size={16} aria-hidden="true" /> Go to account verification
              </Link>
            ) : (
              <Link className="button button--secondary" to="/admin/patient-records">
                Open patient records
              </Link>
            )}
            <button type="button" className="button button--secondary" onClick={() => { setSession(null); setSaved(null); }}>
              Start another intake
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
