import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DentalAuthorizationDocument, statusLabel } from "./DentalAuthorizationDocument";

function emptyForm(patient, treatments, appointments) {
  const latestTreatment = treatments?.[0] || null;
  const latestAppointment = appointments?.[0] || null;
  return {
    procedureName: latestTreatment?.treatment || latestAppointment?.treatment || "",
    toothOrArea: latestTreatment?.toothNumber || "",
    treatingDentist: latestTreatment?.dentistName || latestAppointment?.dentist || "",
    plannedProcedureDate: String(
      latestAppointment?.date || latestTreatment?.treatmentDate || ""
    ).slice(0, 10),
    clinicalNotes: "",
    appointmentId: latestAppointment?.id ? String(latestAppointment.id) : "",
    treatmentId: latestTreatment?.id ? String(latestTreatment.id) : "",
    patientOrRepresentativeName: patient?.fullName || patient?.patientName || "",
    representativeRelationship: "",
    dentistName: latestTreatment?.dentistName || "",
    witnessName: "",
    guardianName: "",
    signedCopyConfirmed: false,
  };
}

export function ProcedureAuthorizationPanel({
  portal,
  patientId,
  patient,
  treatments = [],
  appointments = [],
  canManage = true,
  onToast,
}) {
  const [documents, setDocuments] = useState([]);
  const [template, setTemplate] = useState(null);
  const [clinic, setClinic] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState(() => emptyForm(patient, treatments, appointments));
  const [preview, setPreview] = useState(null);
  const [uploadTarget, setUploadTarget] = useState(null);
  const [signTarget, setSignTarget] = useState(null);
  const [file, setFile] = useState(null);

  const load = useCallback(async () => {
    try {
      const response = await api.listAuthorizations(portal, patientId);
      setDocuments(response.documents || []);
      if (response.template) setTemplate(response.template);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [portal, patientId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setForm(emptyForm(patient, treatments, appointments));
  }, [patient, treatments, appointments]);

  useEffect(() => {
    let cancelled = false;
    api
      .getPublicClinicInfo?.()
      .then((info) => {
        if (!cancelled) setClinic(info?.clinic || info);
      })
      .catch(() => {});
    if (portal === "admin") {
      api
        .getAdminSettings()
        .then((response) => {
          if (!cancelled) setClinic(response?.settings?.clinic || null);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [portal]);

  const current = useMemo(
    () => documents.find((item) => item.status !== "superseded" && item.status !== "voided") || documents[0],
    [documents]
  );

  async function generate(event) {
    event.preventDefault();
    setBusy("generate");
    try {
      await api.createAuthorization(portal, patientId, {
        procedureName: form.procedureName,
        toothOrArea: form.toothOrArea,
        treatingDentist: form.treatingDentist,
        plannedProcedureDate: form.plannedProcedureDate || null,
        clinicalNotes: form.clinicalNotes || null,
        appointmentId: form.appointmentId || null,
        treatmentId: form.treatmentId || null,
        dentistName: form.dentistName || form.treatingDentist,
        witnessName: form.witnessName,
        guardianName: form.guardianName,
      });
      onToast?.("Authorization document generated as a draft.", "success");
      await load();
    } catch (saveError) {
      onToast?.(saveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function runAction(label, fn) {
    setBusy(label);
    try {
      await fn();
      await load();
    } catch (actionError) {
      onToast?.(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function uploadSigned(event) {
    event.preventDefault();
    if (!uploadTarget || !file) {
      onToast?.("Choose a PDF, JPG, or PNG file.", "error");
      return;
    }
    setBusy("upload");
    try {
      await api.uploadAuthorization(portal, uploadTarget.id, file, form.signedCopyConfirmed);
      onToast?.(
        form.signedCopyConfirmed
          ? "Signed copy uploaded and recorded."
          : "File uploaded. Status was not changed to Signed.",
        "success"
      );
      setUploadTarget(null);
      setFile(null);
      setForm((currentForm) => ({ ...currentForm, signedCopyConfirmed: false }));
      await load();
    } catch (uploadError) {
      onToast?.(uploadError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function recordSign(event) {
    event.preventDefault();
    if (!signTarget) return;
    setBusy("sign");
    try {
      await api.signAuthorization(portal, signTarget.id, {
        patientOrRepresentativeName: form.patientOrRepresentativeName,
        representativeRelationship: form.representativeRelationship,
        dentistName: form.dentistName || form.treatingDentist,
        witnessName: form.witnessName,
        guardianName: form.guardianName,
      });
      onToast?.("Authorized signature recorded. Status is now Signed.", "success");
      setSignTarget(null);
      await load();
    } catch (signError) {
      onToast?.(signError.message, "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="procedure-auth-panel" data-testid="procedure-auth-panel">
      <div className="treatment-record__header">
        <div>
          <span className="eyebrow">Patient recordkeeping</span>
          <h2>Procedure Authorization</h2>
        </div>
      </div>
      <p className="muted-copy">
        Generate a printable informed-consent form, upload a signed copy, and keep prior versions.
        Unsigned uploads are never marked Signed. This template must be reviewed by the treating dentist
        before use with patients.
      </p>
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      {documents.length ? (
        <div className="procedure-auth-list">
          {documents.map((document) => (
            <article key={document.id} className="procedure-auth-item">
              <div>
                <strong>{document.documentNumber}</strong>
                <small>
                  {document.procedureName}
                  {document.toothOrArea ? ` · Tooth/area ${document.toothOrArea}` : ""}
                </small>
                <small>
                  Uploaded {document.uploadedAt ? new Date(document.uploadedAt).toLocaleString() : "—"}
                  {document.uploadedByRole ? ` · ${document.uploadedByRole}` : ""}
                </small>
              </div>
              <span className={`procedure-auth-status procedure-auth-status--${document.status}`}>
                {statusLabel(document.status)}
              </span>
              <div className="procedure-auth-item__actions">
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={() => setPreview(document)}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={() => api.downloadAuthorizationPdf(portal, document)}
                >
                  PDF
                </button>
                {document.hasUpload ? (
                  <button
                    type="button"
                    className="button button--secondary button--compact"
                    onClick={() => api.downloadAuthorizationFile(portal, document)}
                  >
                    Download upload
                  </button>
                ) : null}
                {canManage && document.status !== "voided" && document.status !== "superseded" ? (
                  <>
                    {document.status === "draft" ? (
                      <button
                        type="button"
                        className="button button--secondary button--compact"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          runAction("issue", async () => {
                            await api.issueAuthorization(portal, document.id);
                            onToast?.("Document is awaiting patient signature.", "success");
                          })
                        }
                      >
                        Issue for signature
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button button--secondary button--compact"
                      onClick={() => setUploadTarget(document)}
                    >
                      Upload
                    </button>
                    {portal !== "staff" && document.status !== "signed" ? (
                      <button
                        type="button"
                        className="button button--primary button--compact"
                        onClick={() => setSignTarget(document)}
                      >
                        Record signature
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button button--secondary button--compact"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        runAction("replace", async () => {
                          await api.replaceAuthorization(portal, document.id, {
                            procedureName: form.procedureName || document.procedureName,
                            toothOrArea: form.toothOrArea || document.toothOrArea,
                            treatingDentist: form.treatingDentist || document.treatingDentist,
                            plannedProcedureDate: form.plannedProcedureDate || null,
                          });
                          onToast?.("A new version was created. The prior record was kept as Superseded.", "success");
                        })
                      }
                    >
                      New version
                    </button>
                    {portal !== "staff" ? (
                      <button
                        type="button"
                        className="button button--secondary button--compact"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          runAction("void", async () => {
                            await api.voidAuthorization(portal, document.id, {
                              reason: "Voided from patient record.",
                            });
                            onToast?.("Authorization voided. The record was retained.", "success");
                          })
                        }
                      >
                        Void
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted-copy">No procedure authorization documents on this patient record yet.</p>
      )}

      {canManage ? (
        <form className="dentist-form" onSubmit={generate}>
          <div className="field-grid field-grid--two">
            <label className="field">
              <span>Procedure / treatment</span>
              <input
                value={form.procedureName}
                onChange={(event) => setForm((current) => ({ ...current, procedureName: event.target.value }))}
                required
                list="procedure-auth-treatments"
              />
              <datalist id="procedure-auth-treatments">
                {treatments.map((treatment) => (
                  <option key={treatment.id} value={treatment.treatment || treatment.name} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Tooth number / treatment area</span>
              <input
                value={form.toothOrArea}
                onChange={(event) => setForm((current) => ({ ...current, toothOrArea: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Treating dentist</span>
              <input
                value={form.treatingDentist}
                onChange={(event) => setForm((current) => ({ ...current, treatingDentist: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Planned procedure date</span>
              <input
                type="date"
                value={form.plannedProcedureDate}
                onChange={(event) =>
                  setForm((current) => ({ ...current, plannedProcedureDate: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Link appointment (optional)</span>
              <select
                value={form.appointmentId}
                onChange={(event) => setForm((current) => ({ ...current, appointmentId: event.target.value }))}
              >
                <option value="">Not linked</option>
                {appointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {appointment.date} · {appointment.treatment || "Appointment"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Link treatment (optional)</span>
              <select
                value={form.treatmentId}
                onChange={(event) => setForm((current) => ({ ...current, treatmentId: event.target.value }))}
              >
                <option value="">Not linked</option>
                {treatments.map((treatment) => (
                  <option key={treatment.id} value={treatment.id}>
                    {treatment.treatment || treatment.name} {treatment.toothNumber ? `#${treatment.toothNumber}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Relevant clinical notes (authorized staff only)</span>
            <textarea
              rows={3}
              value={form.clinicalNotes}
              onChange={(event) => setForm((current) => ({ ...current, clinicalNotes: event.target.value }))}
            />
          </label>
          {template ? (
            <p className="muted-copy">
              General consent wording is included automatically. Procedure-specific risks must still be
              reviewed by the treating dentist.
            </p>
          ) : null}
          <div className="dentist-form__actions">
            <button className="button button--primary" disabled={Boolean(busy)}>
              {busy === "generate" ? "Generating…" : "Generate authorization"}
            </button>
          </div>
        </form>
      ) : null}

      {preview ? (
        <div className="dental-auth-preview" role="dialog" aria-modal="true">
          <div className="dental-auth-preview__toolbar no-print">
            <strong>{preview.documentNumber}</strong>
            <div>
              <button type="button" className="button button--secondary button--compact" onClick={() => window.print()}>
                Print
              </button>
              <button
                type="button"
                className="button button--secondary button--compact"
                onClick={() => api.downloadAuthorizationPdf(portal, preview)}
              >
                Download PDF
              </button>
              <button type="button" className="button button--primary button--compact" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
          </div>
          <DentalAuthorizationDocument document={preview} clinic={clinic} />
        </div>
      ) : null}

      {uploadTarget ? (
        <form className="procedure-auth-upload" onSubmit={uploadSigned}>
          <h3>Upload authorization file</h3>
          <p className="muted-copy">
            PDF, JPG, or PNG, 5 MB or smaller. Uploading a file does not mark the document as Signed unless
            a dentist or administrator confirms that a signed copy was received.
          </p>
          <label className="field">
            <span>File</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              required
            />
          </label>
          {portal !== "staff" ? (
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={form.signedCopyConfirmed}
                onChange={(event) =>
                  setForm((current) => ({ ...current, signedCopyConfirmed: event.target.checked }))
                }
              />
              <span>This upload is a signed copy (record status as Signed)</span>
            </label>
          ) : (
            <p className="muted-copy">Staff may upload the file. A dentist or administrator records the signature.</p>
          )}
          <div className="dentist-form__actions">
            <button type="button" className="button button--secondary" onClick={() => setUploadTarget(null)}>
              Cancel
            </button>
            <button className="button button--primary" disabled={busy === "upload"}>
              {busy === "upload" ? "Uploading…" : "Save upload"}
            </button>
          </div>
        </form>
      ) : null}

      {signTarget ? (
        <form className="procedure-auth-upload" onSubmit={recordSign}>
          <h3>Record authorized signature</h3>
          <p className="muted-copy">
            Use this only after the patient or authorized representative has actually signed, or an approved
            signing process has been completed.
          </p>
          <div className="field-grid field-grid--two">
            <label className="field">
              <span>Patient or representative name</span>
              <input
                required
                value={form.patientOrRepresentativeName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, patientOrRepresentativeName: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Relationship (if representative)</span>
              <input
                value={form.representativeRelationship}
                onChange={(event) =>
                  setForm((current) => ({ ...current, representativeRelationship: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Treating dentist name</span>
              <input
                value={form.dentistName}
                onChange={(event) => setForm((current) => ({ ...current, dentistName: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Witness name</span>
              <input
                value={form.witnessName}
                onChange={(event) => setForm((current) => ({ ...current, witnessName: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Guardian name</span>
              <input
                value={form.guardianName}
                onChange={(event) => setForm((current) => ({ ...current, guardianName: event.target.value }))}
              />
            </label>
          </div>
          <div className="dentist-form__actions">
            <button type="button" className="button button--secondary" onClick={() => setSignTarget(null)}>
              Cancel
            </button>
            <button className="button button--primary" disabled={busy === "sign"}>
              {busy === "sign" ? "Saving…" : "Record signature"}
            </button>
          </div>
        </form>
      ) : null}

      {!current ? null : <span className="sr-only">Current authorization {current.documentNumber}</span>}
    </section>
  );
}
