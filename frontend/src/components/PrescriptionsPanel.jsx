import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

function statusLabel(status) {
  return String(status || "draft").replace(/_/g, " ");
}

export function PrescriptionsPanel({ role, patientId, onCreate }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load =
      role === "staff"
        ? api.getStaffPatientPrescriptions(patientId)
        : api.getDentistPatientPrescriptions(patientId);
    load
      .then((data) => {
        if (!cancelled) {
          setRows(data.prescriptions || []);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, role]);

  const href =
    role === "staff"
      ? "/staff/prescriptions"
      : `/dentist/prescriptions?patientId=${encodeURIComponent(patientId)}`;

  return (
    <section className="treatment-record prescription-record-section">
      <div className="treatment-record__header">
        <div>
          <span className="eyebrow">Clinical documents</span>
          <h2>Prescriptions</h2>
        </div>
        <div className="treatment-record__actions">
          {role === "dentist" && onCreate ? (
            <button type="button" className="button button--primary button--compact" onClick={onCreate}>
              New prescription
            </button>
          ) : null}
          <Link className="button button--secondary button--compact" to={href}>
            Open {role === "staff" ? "processing" : "management"}
          </Link>
        </div>
      </div>
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {rows.length ? (
        <div className="prescription-mini-list">
          {rows.map((row) => (
            <article key={row.id}>
              <strong>{row.prescriptionNumber}</strong>
              <span>{statusLabel(row.workflowStatus)}</span>
              <span>v{row.currentVersion}</span>
              <span>Email: {row.emailStatus}</span>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted-copy">No prescriptions on file for this patient.</p>
      )}
    </section>
  );
}
