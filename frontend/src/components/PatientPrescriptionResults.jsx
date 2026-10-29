import { useCallback, useEffect, useState } from "react";
import { ClipboardPlus, RefreshCw } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "./UI";
import { DentalDocumentPreview } from "./DentalDocumentPreview";

function prettyDate(value) {
  if (!value) return "Date pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date pending";
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function workflowTone(status) {
  if (status === "authorized") return "is-authorized";
  if (status === "processing") return "is-processing";
  if (status === "sent_to_staff") return "is-pending";
  return "is-pending";
}

function emailTone(status) {
  if (status === "sent") return "is-sent";
  if (status === "failed" || status === "bounced") return "is-failed";
  return "is-pending";
}

export function PatientPrescriptionResults() {
  const [status, setStatus] = useState("loading");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await api.getPatientPrescriptions();
      setRows(Array.isArray(data.prescriptions) ? data.prescriptions : []);
      setStatus("ready");
    } catch (loadError) {
      setRows([]);
      setError(loadError.message || "Unable to load your prescriptions.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openPrescription(row) {
    if (!row?.canViewDocument) return;
    setBusyId(row.id);
    try {
      const result = await api.viewPatientPrescriptionPdf(row.id);
      const blob = result?.blob || result;
      setPreview({
        document: {
          name: `${row.prescriptionNumber}.pdf`,
          mimeType: "application/pdf",
        },
        objectUrl: URL.createObjectURL(blob),
        id: row.id,
      });
    } catch (viewError) {
      setError(viewError.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="glass-card patient-rx-results">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Your records</span>
          <h2>Prescription Results</h2>
          <p className="muted-copy">
            Status of prescriptions your dentist authorized. Staff email the document to your registered
            address; you can also view an authorized copy here.
          </p>
        </div>
        <button type="button" className="button button--secondary button--compact" onClick={load}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {status === "loading" ? (
        <LoadingState inline label="Loading prescription results…" />
      ) : null}
      {status === "error" ? <ErrorState message={error} onRetry={load} /> : null}

      {status === "ready" && !rows.length ? (
        <EmptyState
          icon={<ClipboardPlus size={22} />}
          title="No prescriptions yet"
          detail="When your dentist authorizes a prescription, it will appear here with its email status."
        />
      ) : null}

      {status === "ready" && rows.length ? (
        <div className="patient-rx-list">
          {rows.map((row) => (
            <article key={row.id} className="patient-rx-card">
              <div className="patient-rx-card__top">
                <div>
                  <strong>{row.prescriptionNumber}</strong>
                  <small>
                    {prettyDate(row.issuedAt)}
                    {row.dentistName ? ` · ${row.dentistName}` : ""}
                  </small>
                </div>
                <div className="patient-rx-card__pills">
                  <span className={`patient-rx-pill ${workflowTone(row.workflowStatus)}`}>
                    {row.workflowLabel}
                  </span>
                  <span className={`patient-rx-pill ${emailTone(row.emailStatus)}`}>{row.emailLabel}</span>
                </div>
              </div>
              {row.medications?.length ? (
                <ul className="patient-rx-meds">
                  {row.medications.map((item, index) => (
                    <li key={`${row.id}-med-${index}`}>
                      <span>{item.medicationName}</span>
                      <small>
                        Qty {item.quantity}
                        {item.dosage ? ` · ${item.dosage}` : ""}
                        {item.sig ? ` · ${item.sig}` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">
                  {row.workflowStatus === "sent_to_staff"
                    ? "Waiting for the dentist to authorize this prescription."
                    : "Medication details are available after the dentist authorizes this prescription."}
                </p>
              )}
              {row.canViewDocument ? (
                <div className="patient-rx-card__actions">
                  <button
                    type="button"
                    className="button button--primary button--compact"
                    disabled={busyId === row.id}
                    onClick={() => openPrescription(row)}
                  >
                    {busyId === row.id ? "Opening…" : "View Prescription"}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {preview ? (
        <DentalDocumentPreview
          document={preview.document}
          objectUrl={preview.objectUrl}
          onClose={() => {
            URL.revokeObjectURL(preview.objectUrl);
            setPreview(null);
          }}
          onDownload={() => api.downloadPatientPrescriptionPdf(preview.id, preview.document.name)}
        />
      ) : null}
    </section>
  );
}
