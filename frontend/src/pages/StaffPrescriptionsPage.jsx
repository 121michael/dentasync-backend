import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DentalDocumentPreview } from "../components/DentalDocumentPreview";
import { EmptyState, SectionHeading } from "../components/UI";
import { useStaffUi } from "../components/StaffLayout";

function statusLabel(status) {
  return String(status || "").replace(/_/g, " ");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function StaffPrescriptionsPage() {
  const { pushToast } = useStaffUi();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);
  const [returnReason, setReturnReason] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [preview, setPreview] = useState(null);
  const [viewedPdfId, setViewedPdfId] = useState("");
  const [reviewChecked, setReviewChecked] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.getStaffPrescriptions(search ? { search } : {});
      setList(data.prescriptions || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!focusId) return undefined;
    let cancelled = false;
    api.getStaffPrescription(focusId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data.prescription);
        setConfirmation(null);
        setReviewChecked(false);
        setViewedPdfId("");
        setError("");
      })
      .catch((focusError) => {
        if (!cancelled) setError(focusError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [focusId]);

  useEffect(() => {
    return () => {
      if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    };
  }, [preview]);

  async function openDetail(id) {
    const data = await api.getStaffPrescription(id);
    setDetail(data.prescription);
    setConfirmation(null);
    setReviewChecked(false);
    setViewedPdfId("");
  }

  async function returnRx() {
    setBusy("return");
    try {
      const data = await api.returnStaffPrescription(detail.id, returnReason);
      setDetail(data.prescription);
      setReturnReason("");
      setConfirmation(null);
      setReviewChecked(false);
      pushToast(data.message);
      await load();
    } catch (actionError) {
      pushToast(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function generatePdf(regenerate = false) {
    setBusy("generate");
    try {
      const data = await api.generateStaffPrescriptionPdf(detail.id, { regenerate });
      setDetail(data.prescription);
      setConfirmation(null);
      setReviewChecked(false);
      if (regenerate || data.prescription.generatedPdf?.id !== viewedPdfId) {
        setViewedPdfId("");
      }
      pushToast(data.message);
      await load();
    } catch (actionError) {
      pushToast(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function openPdf() {
    setBusy("view");
    try {
      const file = await api.viewStaffPrescriptionPdf(detail.id);
      const blob = file.blob || file;
      const objectUrl = URL.createObjectURL(blob);
      if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
      setPreview({
        document: {
          name: file.filename || `${detail.prescriptionNumber}.pdf`,
          filename: file.filename || `${detail.prescriptionNumber}.pdf`,
          mimeType: file.mimeType || "application/pdf",
        },
        objectUrl,
      });
      setViewedPdfId(detail.generatedPdf?.id || "viewed");
      const refreshed = await api.getStaffPrescription(detail.id);
      setDetail(refreshed.prescription);
    } catch (actionError) {
      pushToast(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function confirmReview() {
    setBusy("review");
    try {
      const data = await api.confirmStaffPrescriptionReview(detail.id, {
        confirmPdfId: detail.generatedPdf?.id,
      });
      setDetail(data.prescription);
      setReviewChecked(true);
      pushToast(data.message);
    } catch (actionError) {
      pushToast(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function prepareSend() {
    setBusy("prepare");
    try {
      const data = await api.prepareStaffPrescriptionSend(detail.id);
      setConfirmation(data.confirmation);
    } catch (actionError) {
      pushToast(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function confirmSend(retry = false) {
    setBusy("send");
    try {
      const body = {
        confirmPrescriptionId: confirmation.prescriptionId,
        confirmVersion: confirmation.authorizedVersion,
        confirmRecipientMasked: confirmation.recipientEmailMasked,
        confirmPdfId: confirmation.pdfId,
      };
      const data = retry
        ? await api.retryStaffPrescriptionSend(detail.id, body)
        : await api.sendStaffPrescription(detail.id, body);
      setDetail(data.prescription);
      setConfirmation(null);
      pushToast(data.message);
      await load();
    } catch (actionError) {
      pushToast(actionError.message, "error");
    } finally {
      setBusy("");
    }
  }

  const authorized = detail?.workflowStatus === "authorized";
  const hasPdf = Boolean(detail?.hasGeneratedPdf);
  const reviewValid = Boolean(detail?.pdfReviewValid);
  const emailSent = detail?.emailStatus === "sent";
  const canView = authorized && hasPdf;
  const canGenerate = authorized;
  const canPrepare = authorized && hasPdf && reviewValid && !emailSent;
  const viewedCurrentPdf = Boolean(
    detail?.generatedPdf?.id && viewedPdfId === detail.generatedPdf.id
  );

  return (
    <div className="staff-page prescription-page">
      <SectionHeading
        eyebrow="Clinical documents"
        title="Prescription Processing"
        detail="Generate the authorized PDF, inspect it, confirm your review, then email that same file."
      />
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      <div className="prescription-layout">
        <section className="dentist-panel">
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
                placeholder="Search prescriptions"
                aria-label="Search prescriptions"
              />
            </label>
            <button className="button button--secondary" type="submit">Search</button>
          </form>
          {list.length ? (
            <div className="prescription-list">
              {list.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={`prescription-list__item ${detail?.id === row.id ? "is-active" : ""}`}
                  onClick={() => openDetail(row.id).catch((openError) => setError(openError.message))}
                >
                  <span className="prescription-list__top">
                    <strong>{row.prescriptionNumber}</strong>
                    <span className="prescription-status">{statusLabel(row.workflowStatus)}</span>
                  </span>
                  <span className="prescription-list__patient">{row.patient?.fullName || "Patient"}</span>
                  <small>
                    {row.dentist?.fullName || "Dentist"} · email {row.emailStatus}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="No prescriptions in queue" detail="Submitted prescriptions will appear here." />
          )}
        </section>
        <section className="dentist-panel">
          {detail ? (
            <>
              <div className="dentist-panel__heading">
                <div>
                  <span className="eyebrow">{detail.prescriptionNumber}</span>
                  <h2>{detail.patient?.fullName || "Patient"}</h2>
                </div>
                <span className="prescription-status">{statusLabel(detail.workflowStatus)}</span>
              </div>
              <p className="muted-copy">
                Patient ID {detail.patient?.patientId || "—"} · Dentist {detail.dentist?.fullName || "—"} · version{" "}
                {detail.currentVersion}
                {detail.authorizedVersion ? ` · authorized v${detail.authorizedVersion}` : " · not authorized"}
                {` · email ${detail.emailStatus}`}
                {hasPdf ? " · PDF stored" : " · PDF not generated"}
                {reviewValid ? " · reviewed" : ""}
              </p>
              <div className="prescription-item-readonly">
                {(detail.items || []).map((item, index) => (
                  <article key={item.id || index}>
                    <strong>
                      {item.medicationName}{" "}
                      <span className="prescription-qty">
                        {String(item.quantity || "").startsWith("#") ? item.quantity : `#${item.quantity || ""}`}
                      </span>
                    </strong>
                    <p>{item.strength || item.dosage}</p>
                    <p>Sig: {item.sig}</p>
                    {item.additionalInstructions ? <p>{item.additionalInstructions}</p> : null}
                  </article>
                ))}
              </div>
              <p className="muted-copy">Clinical content is read-only for staff.</p>
              <div className="prescription-staff-workflow">
                <div className="prescription-staff-actions">
                  <button
                    type="button"
                    className={`button ${hasPdf ? "button--secondary" : "button--primary"}`}
                    onClick={() => generatePdf(hasPdf)}
                    disabled={!canGenerate || Boolean(busy)}
                  >
                    {busy === "generate"
                      ? "Generating…"
                      : hasPdf
                        ? "Regenerate Prescription"
                        : "Generate Prescription"}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={openPdf}
                    disabled={!canView || Boolean(busy)}
                  >
                    {busy === "view" ? "Opening…" : "View Prescription"}
                  </button>
                </div>
                <label className={`field field--check ${!canView ? "is-disabled" : ""}`}>
                  <input
                    type="checkbox"
                    checked={reviewValid || reviewChecked}
                    disabled={!canView || reviewValid || !viewedCurrentPdf || Boolean(busy)}
                    onChange={(event) => {
                      if (event.target.checked) confirmReview();
                      else setReviewChecked(false);
                    }}
                  />
                  <span>
                    I verified the generated PDF: patient name and ID, registered email, prescribing dentist,
                    medications, quantities, dosages, Sig, prescription date, and authorized version.
                    {!viewedCurrentPdf && canView ? " Open View Prescription first." : null}
                  </span>
                </label>
                <div className="prescription-staff-actions">
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={prepareSend}
                    disabled={!canPrepare || Boolean(busy)}
                  >
                    {emailSent ? "Email sent" : "Prepare email"}
                  </button>
                  {["failed", "unknown"].includes(detail.emailStatus) ? (
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={prepareSend}
                      disabled={!canPrepare || Boolean(busy)}
                    >
                      Retry email
                    </button>
                  ) : null}
                </div>
                {emailSent ? (
                  <p className="muted-copy">This authorized version was already emailed. You can still view the stored PDF.</p>
                ) : null}
              </div>
              <label className="field">
                <span>Return to dentist (clinical correction)</span>
                <textarea
                  rows="2"
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  placeholder="Describe the clinical issue"
                />
              </label>
              <button type="button" className="button button--secondary" onClick={returnRx} disabled={!returnReason}>
                Return to dentist
              </button>
              {confirmation ? (
                <div className="prescription-confirm">
                  <h3>Confirm recipient and reviewed PDF</h3>
                  <p>
                    <strong>{confirmation.patientName}</strong>
                    {confirmation.patientId ? ` · Patient ID ${confirmation.patientId}` : ""}
                  </p>
                  <p>Prescription {confirmation.prescriptionNumber}</p>
                  <p>Dentist {confirmation.dentistName || "—"}</p>
                  <p>Authorized version {confirmation.authorizedVersion}</p>
                  <p>Prescription date {formatDate(confirmation.prescriptionDate)}</p>
                  <p>Registered email {confirmation.recipientEmailMasked}</p>
                  {(confirmation.medications || []).map((item, index) => (
                    <p key={`${item.medicationName}-${index}`}>
                      {item.medicationName} · {item.quantity} · {item.dosage} · Sig: {item.sig}
                    </p>
                  ))}
                  <div className="dentist-form__actions">
                    <button type="button" className="button button--secondary" onClick={() => setConfirmation(null)}>
                      Back
                    </button>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => confirmSend(detail.emailStatus === "failed" || detail.emailStatus === "unknown")}
                      disabled={busy === "send"}
                    >
                      {busy === "send" ? "Sending…" : "Send reviewed PDF"}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted-copy">Select a prescription to process it.</p>
          )}
        </section>
      </div>
      {preview ? (
        <DentalDocumentPreview
          document={preview.document}
          objectUrl={preview.objectUrl}
          onClose={() => {
            if (preview.objectUrl) URL.revokeObjectURL(preview.objectUrl);
            setPreview(null);
          }}
          onDownload={() =>
            api.downloadStaffPrescriptionPdf(detail.id, preview.document.filename).catch((downloadError) => {
              pushToast(downloadError.message, "error");
            })
          }
        />
      ) : null}
    </div>
  );
}
