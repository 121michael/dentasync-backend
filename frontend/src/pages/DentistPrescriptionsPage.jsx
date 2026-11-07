import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPlus, Plus, Search, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, SectionHeading } from "../components/UI";
import { DentalDocumentPreview } from "../components/DentalDocumentPreview";

const emptyItem = {
  medicationName: "",
  strength: "",
  quantity: "",
  sig: "",
  additionalInstructions: "",
};

function statusLabel(status) {
  return String(status || "").replace(/_/g, " ");
}

const SIGN_CONFIRMATION = "SIGN THIS PRESCRIPTION";

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round((rect.width || 520) * ratio));
    canvas.height = Math.max(1, Math.round(160 * ratio));
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#1b2a6b";
    return undefined;
  }, []);

  function point(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event) {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const place = point(event);
    drawing.current = true;
    setPreviewUrl("");
    onChange("");
    canvas.setPointerCapture?.(event.pointerId);
    context.beginPath();
    context.moveTo(place.x, place.y);
  }

  function move(event) {
    if (!drawing.current) return;
    const place = point(event);
    const context = canvasRef.current.getContext("2d");
    context.lineTo(place.x, place.y);
    context.stroke();
    if (!hasInk) setHasInk(true);
  }

  function end() {
    drawing.current = false;
  }

  function clearPad() {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setPreviewUrl("");
    onChange("");
  }

  function preview() {
    if (!hasInk) return;
    const url = canvasRef.current.toDataURL("image/png");
    setPreviewUrl(url);
    onChange(url);
  }

  return (
    <div className="rx-esign">
      <p className="rx-esign__label">Electronic signature</p>
      <canvas
        ref={canvasRef}
        className="rx-esign__pad"
        aria-label="Draw your signature"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="rx-esign__actions">
        <button type="button" className="button button--secondary" onClick={clearPad}>
          Clear
        </button>
        <button type="button" className="button button--secondary" onClick={preview} disabled={!hasInk}>
          Preview signature
        </button>
      </div>
      {previewUrl ? (
        <div className="rx-esign__preview">
          <span>Signature preview</span>
          <img src={previewUrl} alt="Preview of the signature before it is applied" />
        </div>
      ) : (
        <p className="muted-copy">Draw your signature, then preview it before confirming this prescription.</p>
      )}
      <p className="muted-copy">
        This drawn mark is a visual signature for the clinic workflow. It is not a cryptographic digital signature.
      </p>
    </div>
  );
}

function statusTone(status) {
  if (status === "authorized") return "is-authorized";
  if (status === "cancelled") return "is-cancelled";
  if (status === "returned_to_dentist") return "is-returned";
  if (status === "draft") return "is-draft";
  return "is-queue";
}

export function DentistPrescriptionsPage() {
  const [searchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    clinicalRecordId: searchParams.get("patientId") || "",
    treatmentId: searchParams.get("treatmentId") || "",
    clinicalNotes: "",
    includeExtractionAftercare: false,
    items: [{ ...emptyItem }],
  });
  const [patientTreatments, setPatientTreatments] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [signaturePng, setSignaturePng] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [licenseVerified, setLicenseVerified] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getDentistProfile()
      .then((data) => {
        if (cancelled) return;
        setLicenseVerified(Boolean(data.profile?.licenseVerified));
        setLicenseNumber(data.profile?.licenseNumber || "");
      })
      .catch(() => {
        if (!cancelled) {
          setLicenseVerified(false);
          setLicenseNumber("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [rx, registry] = await Promise.all([
        api.getDentistPrescriptions(search ? { search } : {}),
        api.getDentistPatients(""),
      ]);
      setList(rx.prescriptions || []);
      setPatients(registry.patients || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  async function openDetail(id) {
    setSelectedId(id);
    const data = await api.getDentistPrescription(id);
    const prescription = data.prescription;
    setDetail(prescription);
    setForm({
      clinicalRecordId: String(prescription.clinicalRecordId),
      treatmentId: prescription.treatmentId ? String(prescription.treatmentId) : "",
      clinicalNotes: prescription.clinicalNotes || "",
      includeExtractionAftercare: Boolean(prescription.includeExtractionAftercare),
      items: prescription.items?.length
        ? prescription.items.map((item) => ({ ...emptyItem, ...item }))
        : [{ ...emptyItem }],
    });
  }

  function startNew() {
    setSelectedId("");
    setDetail(null);
    setForm({
      clinicalRecordId: searchParams.get("patientId") || "",
      treatmentId: searchParams.get("treatmentId") || "",
      clinicalNotes: "",
      includeExtractionAftercare: false,
      items: [{ ...emptyItem }],
    });
  }

  async function saveDraft(event) {
    event.preventDefault();
    setBusy("save");
    try {
      const body = {
        clinicalRecordId: form.clinicalRecordId,
        treatmentId: form.treatmentId || undefined,
        clinicalNotes: form.clinicalNotes,
        includeExtractionAftercare: form.includeExtractionAftercare,
        items: form.items.map((item) => ({
          medicationName: item.medicationName,
          strength: item.strength,
          dosage: item.strength,
          quantity: item.quantity,
          sig: item.sig,
          additionalInstructions: item.additionalInstructions,
        })),
      };
      const data = selectedId
        ? await api.updateDentistPrescription(selectedId, body)
        : await api.createDentistPrescription(body);
      setDetail(data.prescription);
      setSelectedId(data.prescription.id);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy("");
    }
  }

  async function runAction(kind) {
    if (!selectedId) return;
    setBusy(kind);
    try {
      const data =
        kind === "submit"
          ? await api.submitDentistPrescription(selectedId)
          : kind === "authorize"
            ? await api.authorizeDentistPrescription(selectedId, {
                confirmation: confirmPhrase.trim(),
                signaturePng,
              })
            : await api.cancelDentistPrescription(selectedId);
      if (kind === "authorize") {
        setSignaturePng("");
        setConfirmPhrase("");
      }
      setDetail(data.prescription);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy("");
    }
  }

  async function openPdf() {
    if (!selectedId) return;
    try {
      const blob = await api.viewDentistPrescriptionPdf(selectedId);
      setPreview({
        document: { name: `${detail?.prescriptionNumber || "Prescription"}.pdf`, mimeType: "application/pdf" },
        objectUrl: URL.createObjectURL(blob),
      });
    } catch (pdfError) {
      setError(pdfError.message);
    }
  }

  const editable = !detail || ["draft", "returned_to_dentist"].includes(detail.workflowStatus);
  const patientOptions = useMemo(
    () =>
      patients.map((patient) => ({
        id: patient.id,
        label: `${patient.fullName || patient.patientName || "Patient"} (${patient.patientId || patient.id})`,
      })),
    [patients]
  );
  const selectedPatient = patientOptions.find(
    (patient) => String(patient.id) === String(form.clinicalRecordId)
  );

  useEffect(() => {
    if (!form.clinicalRecordId) {
      setPatientTreatments([]);
      return undefined;
    }
    let cancelled = false;
    api
      .getDentistPatient(form.clinicalRecordId, { silent: true })
      .then((data) => {
        if (cancelled) return;
        setPatientTreatments(data.treatments || data.patient?.treatments || []);
      })
      .catch(() => {
        if (!cancelled) setPatientTreatments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.clinicalRecordId]);

  function updateItem(index, field, value) {
    setForm((current) => {
      const items = [...current.items];
      items[index] = { ...items[index], [field]: value };
      return { ...current, items };
    });
  }

  return (
    <div className="dentist-page prescription-page">
      <SectionHeading
        eyebrow="Clinical documents"
        title="Prescription Management"
        detail="Enter each medicine, strength, quantity, and Sig yourself. DentaSync does not suggest or fill dosages."
        action={
          <div className="dentist-heading-actions">
            <button type="button" className="button button--primary prescription-new-btn" onClick={startNew}>
              <Plus size={16} /> New prescription
            </button>
          </div>
        }
      />
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <div className="prescription-layout">
        <section className="dentist-panel prescription-history">
          <div className="prescription-panel-heading">
            <span className="eyebrow">History</span>
            <h2>Prescriptions</h2>
          </div>
          <form
            className="prescription-search"
            onSubmit={(event) => {
              event.preventDefault();
              load();
            }}
          >
            <label className="dentist-search">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Prescription number or patient"
                aria-label="Search prescriptions"
              />
            </label>
            <button className="button button--secondary" type="submit">
              Search
            </button>
          </form>
          {list.length ? (
            <div className="prescription-list">
              {list.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={`prescription-list__item ${selectedId === row.id ? "is-active" : ""}`}
                  onClick={() => openDetail(row.id).catch((openError) => setError(openError.message))}
                >
                  <span className="prescription-list__top">
                    <strong>{row.prescriptionNumber}</strong>
                    <span className={`prescription-status ${statusTone(row.workflowStatus)}`}>
                      {statusLabel(row.workflowStatus)}
                    </span>
                  </span>
                  <span className="prescription-list__patient">{row.patient?.fullName || "Patient"}</span>
                  <small>
                    Email {row.emailStatus} · v{row.currentVersion}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<ClipboardPlus size={22} />}
              title="No prescriptions yet"
              detail="Select a patient on the right and save a draft. Submitted prescriptions will appear here."
            />
          )}
        </section>

        <section className="dentist-panel prescription-composer">
          <form className="dentist-form" onSubmit={saveDraft}>
            <div className="dentist-panel__heading">
              <div>
                <span className="eyebrow">{detail ? detail.prescriptionNumber : "New draft"}</span>
                <h2>{detail ? `Version ${detail.currentVersion}` : "Create prescription"}</h2>
              </div>
              {detail ? (
                <span className={`prescription-status ${statusTone(detail.workflowStatus)}`}>
                  {statusLabel(detail.workflowStatus)}
                </span>
              ) : (
                <span className="prescription-status is-draft">Draft</span>
              )}
            </div>
            {detail?.returnReason ? (
              <p className="inline-alert">Returned: {detail.returnReason}</p>
            ) : null}
            <div className="prescription-patient">
              <label className="field">
                <span>Patient</span>
                <select
                  required
                  disabled={!editable || Boolean(detail)}
                  value={form.clinicalRecordId}
                  onChange={(event) => setForm((current) => ({ ...current, clinicalRecordId: event.target.value }))}
                >
                  <option value="">Select a patient</option>
                  {patientOptions.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedPatient ? (
                <p className="prescription-patient__selected">
                  Selected patient: <strong>{selectedPatient.label}</strong>
                </p>
              ) : (
                <p className="prescription-patient__selected is-empty">Choose an existing clinical patient record. Name, age, sex, and address are filled from that record on the pad.</p>
              )}
              {patientTreatments.length ? (
                <label className="field">
                  <span>Linked procedure (required only for extraction aftercare)</span>
                  <select
                    disabled={!editable}
                    value={form.treatmentId}
                    onChange={(event) => setForm((current) => ({ ...current, treatmentId: event.target.value }))}
                  >
                    <option value="">No linked procedure</option>
                    {patientTreatments.map((treatment) => (
                      <option key={treatment.id} value={treatment.id}>
                        {treatment.treatment || treatment.name || `Treatment ${treatment.id}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {form.items.map((item, index) => (
              <fieldset key={index} className="prescription-item">
                <legend>
                  <span>Medication {index + 1}</span>
                  {editable && form.items.length > 1 ? (
                    <button
                      type="button"
                      className="button button--secondary button--compact"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          items: current.items.filter((_, itemIndex) => itemIndex !== index),
                        }))
                      }
                    >
                      <Trash2 size={14} /> Remove
                    </button>
                  ) : null}
                </legend>
                <div className="field-grid field-grid--two">
                  <label className="field">
                    <span>Medicine name</span>
                    <input
                      required
                      disabled={!editable}
                      placeholder="As you would write it on the pad"
                      value={item.medicationName}
                      onChange={(event) => updateItem(index, "medicationName", event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label className="field">
                    <span>Quantity</span>
                    <input
                      required
                      disabled={!editable}
                      placeholder="#21"
                      value={item.quantity}
                      onChange={(event) => updateItem(index, "quantity", event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label className="field">
                    <span>Strength / dosage</span>
                    <input
                      required
                      disabled={!editable}
                      placeholder="500 mg"
                      value={item.strength || item.dosage || ""}
                      onChange={(event) => updateItem(index, "strength", event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label className="field field--full">
                    <span>Sig / Instructions for taking the medication</span>
                    <textarea
                      required
                      rows="3"
                      disabled={!editable}
                      placeholder="How this patient should take this medicine"
                      value={item.sig}
                      onChange={(event) => updateItem(index, "sig", event.target.value)}
                    />
                  </label>
                  <label className="field field--full">
                    <span>Additional instructions (optional)</span>
                    <textarea
                      rows="2"
                      disabled={!editable}
                      placeholder="Only if needed for this medicine"
                      value={item.additionalInstructions || ""}
                      onChange={(event) => updateItem(index, "additionalInstructions", event.target.value)}
                    />
                  </label>
                </div>
              </fieldset>
            ))}
            {editable ? (
              <button
                type="button"
                className="button button--secondary prescription-add-med"
                onClick={() => setForm((current) => ({ ...current, items: [...current.items, { ...emptyItem }] }))}
              >
                <Plus size={16} /> Add medication
              </button>
            ) : null}
            <label className="field prescription-notes">
              <span>Clinical notes</span>
              <textarea
                rows="4"
                disabled={!editable}
                value={form.clinicalNotes}
                onChange={(event) => setForm((current) => ({ ...current, clinicalNotes: event.target.value }))}
              />
            </label>
            <label className="prescription-aftercare">
              <input
                type="checkbox"
                disabled={!editable}
                checked={form.includeExtractionAftercare}
                onChange={(event) =>
                  setForm((current) => ({ ...current, includeExtractionAftercare: event.target.checked }))
                }
              />
              <span>
                <strong>Print tooth-extraction aftercare from the clinic Rx pad</strong>
                Uses the official Do’s and Don’ts wording only when a confirmed extraction procedure is linked. It does not add any medicine.
              </span>
            </label>
            {detail ? (
              <p className="muted-copy prescription-auth-meta">
                Authorization: {detail.authorizedAt ? `${detail.authorizationMethod} at ${detail.authorizedAt}` : "not authorized"}
                {detail.signedAt ? ` · signed ${detail.signedAt}` : ""}
                {detail.contentHash ? ` · hash ${detail.contentHash.slice(0, 12)}` : ""}
              </p>
            ) : null}
            {detail && detail.workflowStatus !== "cancelled" && detail.workflowStatus !== "authorized" ? (
              <div className="rx-esign-panel">
                {licenseVerified && licenseNumber ? (
                  <p className="muted-copy">Verified license on file: {licenseNumber}</p>
                ) : (
                  <p className="inline-alert inline-alert--error">
                    This prescription cannot be signed yet. An administrator must verify your own license number on the dentist account before a signed prescription can be released.
                  </p>
                )}
                <SignaturePad onChange={setSignaturePng} />
                <label className="field">
                  <span>Type SIGN THIS PRESCRIPTION to confirm this version</span>
                  <input
                    value={confirmPhrase}
                    autoComplete="off"
                    onChange={(event) => setConfirmPhrase(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <div className="dentist-form__actions">
              {editable ? (
                <button className="button button--primary" type="submit" disabled={Boolean(busy)}>
                  {busy === "save" ? "Saving…" : "Save draft"}
                </button>
              ) : null}
              {detail && editable ? (
                <button type="button" className="button button--secondary" onClick={() => runAction("submit")}>
                  Send to staff
                </button>
              ) : null}
              {detail && detail.workflowStatus !== "cancelled" && detail.workflowStatus !== "authorized" ? (
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!signaturePng || confirmPhrase.trim() !== SIGN_CONFIRMATION || Boolean(busy)}
                  onClick={() => runAction("authorize")}
                >
                  Confirm and sign this version
                </button>
              ) : null}
              {detail?.workflowStatus === "authorized" ? (
                <button type="button" className="button button--secondary" onClick={openPdf}>
                  View authorized PDF
                </button>
              ) : null}
              {detail && detail.workflowStatus !== "cancelled" ? (
                <button type="button" className="button button--secondary" onClick={() => runAction("cancel")}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
      {preview ? (
        <DentalDocumentPreview
          document={preview.document}
          objectUrl={preview.objectUrl}
          onClose={() => {
            URL.revokeObjectURL(preview.objectUrl);
            setPreview(null);
          }}
          onDownload={() => api.downloadDentistPrescriptionPdf(selectedId)}
        />
      ) : null}
    </div>
  );
}
