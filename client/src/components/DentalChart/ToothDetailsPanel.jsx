import {
  CONDITION_OPTIONS,
  STATUS_OPTIONS,
  TREATMENT_OPTIONS,
  labelFor,
} from "./dentalChartData";
import { formatDentistDateTime } from "../../dentistUtils";

export function ToothDetailsPanel({
  toothNumber,
  draft,
  busy,
  error,
  onChange,
  onToggleCondition,
  onToggleTreatment,
  onSave,
  onCancel,
}) {
  if (!toothNumber || !draft) {
    return (
      <aside className="fdi-panel glass-card">
        <span className="eyebrow">Tooth details</span>
        <h3>Select a tooth</h3>
        <p className="muted-copy">
          Click any FDI tooth on the chart to record condition, treatment, status, and clinical notes.
          This is a manual charting tool — not an automatic diagnosis.
        </p>
      </aside>
    );
  }

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

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <label className="field">
        <span>Status</span>
        <select
          value={draft.status || "healthy"}
          onChange={(event) => onChange({ status: event.target.value })}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="fdi-fieldset">
        <legend>Condition</legend>
        <div className="fdi-check-grid">
          {CONDITION_OPTIONS.map((option) => {
            const checked = (draft.condition || []).includes(option.value);
            return (
              <label key={option.value} className={`fdi-check ${checked ? "is-checked" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleCondition(option.value)}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="fdi-fieldset">
        <legend>Treatment</legend>
        <div className="fdi-check-grid">
          {TREATMENT_OPTIONS.map((option) => {
            const checked = (draft.treatments || []).includes(option.value);
            return (
              <label key={option.value} className={`fdi-check ${checked ? "is-checked" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleTreatment(option.value)}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="field">
        <span>Clinical notes</span>
        <textarea
          rows={4}
          value={draft.notes || ""}
          onChange={(event) => onChange({ notes: event.target.value })}
          placeholder="Tooth-specific clinical notes…"
        />
      </label>

      <div className="fdi-meta">
        <small>
          Last updated:{" "}
          {draft.updatedAt ? formatDentistDateTime(draft.updatedAt) : "Not saved yet"}
        </small>
        <small>Updated by: {draft.updatedBy || draft.createdBy || "—"}</small>
      </div>

      <div className="fdi-panel__actions">
        <button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button button--primary" onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </aside>
  );
}
