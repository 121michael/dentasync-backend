import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, SectionHeading } from "../components/UI";
import { useStaffUi } from "../components/StaffLayout";

function statusLabel(status) {
  return String(status || "").replace(/_/g, " ");
}

export function StaffPrescriptionsPage() {
  const { pushToast } = useStaffUi();
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);
  const [returnReason, setReturnReason] = useState("");
  const [confirmation, setConfirmation] = useState(null);
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

  async function openDetail(id) {
    const data = await api.getStaffPrescription(id);
    setDetail(data.prescription);
    setConfirmation(null);
  }

  async function returnRx() {
    setBusy("return");
    try {
      const data = await api.returnStaffPrescription(detail.id, returnReason);
      setDetail(data.prescription);
      setReturnReason("");
      pushToast(data.message);
      await load();
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

  return (
    <div className="staff-page prescription-page">
      <SectionHeading
        eyebrow="Clinical documents"
        title="Prescription Processing"
        detail="Process dentist-authorized prescriptions and email the exact authorized PDF."
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
              {detail.workflowStatus === "authorized" ? (
                <div className="dentist-form__actions prescription-staff-actions">
                  <button type="button" className="button button--primary" onClick={prepareSend} disabled={Boolean(busy)}>
                    Prepare email
                  </button>
                  {["failed", "unknown"].includes(detail.emailStatus) ? (
                    <button type="button" className="button button--secondary" onClick={prepareSend} disabled={Boolean(busy)}>
                      Retry email
                    </button>
                  ) : null}
                </div>
              ) : null}
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
                  <h3>Confirm recipient</h3>
                  <p>
                    <strong>{confirmation.patientName}</strong>
                  </p>
                  <p>Prescription {confirmation.prescriptionNumber}</p>
                  <p>Authorized version {confirmation.authorizedVersion}</p>
                  <p>Registered email {confirmation.recipientEmailMasked}</p>
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
                      {busy === "send" ? "Sending…" : "Send authorized PDF"}
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
    </div>
  );
}
