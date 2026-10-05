import {
  STATUS_OPTIONS,
  TREATMENT_OPTIONS,
  labelFor,
} from "./dentalChartData";
import { formatDentistDateTime } from "../../dentistUtils";

export function ToothDetailsPanel({
  toothNumber,
  draft,
  readOnly = false,
  onCancel,
}) {
  if (!toothNumber || !draft) {
    return (
      <aside className="fdi-panel glass-card">
        <span className="eyebrow">Tooth details</span>
        <h3>Select a tooth</h3>
        <p className="muted-copy">
          {readOnly
            ? "Click any FDI tooth to inspect its existing chart status. Staff cannot change treatments from this panel."
            : "Click any FDI tooth to inspect its chart status. Status is updated automatically when you save a treatment with an affected tooth — no separate “mark tooth” step."}
        </p>
      </aside>
    );
  }

  const treatmentLabels = (draft.treatments || []).map((value) =>
    labelFor(value, TREATMENT_OPTIONS)
  );

  return (
    <aside className="fdi-panel glass-card">
      <div className="fdi-panel__head">
        <div>
          <span className="eyebrow">Selected tooth</span>
          <h3>Tooth {toothNumber}</h3>
        </div>
        <span className={`status-pill status-pill--${String(draft.status || "healthy").replaceAll("_", "-")}`}>
          {labelFor(draft.status || "healthy", STATUS_OPTIONS)}
        </span>
      </div>

      <div className="fdi-readonly-block">
        <p>
          <small>Chart status</small>
          <strong>{labelFor(draft.status || "healthy", STATUS_OPTIONS)}</strong>
        </p>
        <p>
          <small>Treatments on chart</small>
          <strong>{treatmentLabels.length ? treatmentLabels.join(", ") : "None yet"}</strong>
        </p>
        <p>
          <small>Diagnosis / notes</small>
          <strong>{draft.notes?.trim() ? draft.notes : "—"}</strong>
        </p>
      </div>

      <p className="muted-copy">
        {readOnly
          ? "Read-only view. Staff cannot change chart status."
          : "To change this tooth’s status, use Add Treatment (Diagnosis, Treatment, Affected Tooth), then Save Treatment. The chart updates from the treatment record."}
      </p>

      <div className="fdi-meta">
        <small>
          Last updated:{" "}
          {draft.updatedAt ? formatDentistDateTime(draft.updatedAt) : "Not recorded yet"}
        </small>
        <small>Updated by: {draft.updatedBy || draft.createdBy || "—"}</small>
      </div>

      <div className="fdi-panel__actions">
        <button type="button" className="button button--secondary" onClick={onCancel}>
          Close
        </button>
      </div>
    </aside>
  );
}
