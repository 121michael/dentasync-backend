import { X } from "lucide-react";
const statusLabelFallback = {
  checked_in: "Checked In",
  not_checked_in: "Not Checked In",
  waiting: "Waiting",
  preparing: "Called",
  called: "Called",
  in_chair: "In Treatment",
  dentist: "In Treatment",
  in_treatment: "In Treatment",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "Skipped",
  skipped: "Skipped",
  confirmed: "Confirmed",
  pending: "Pending",
  scheduled: "Scheduled",
  paid: "Paid",
  partially_paid: "Partially Paid",
  active: "Active",
  clinical_record: "Clinical Record",
  linked_account: "Linked Account",
  sent: "Sent",
  failed: "Failed",
};

export function statusLabel(value) {
  const key = String(value || "").toLowerCase().replaceAll(" ", "_");
  return statusLabelFallback[key] || String(value || "Unknown").replaceAll("_", " ");
}

export function StaffStatusBadge({ status }) {
  const safeStatus = String(status || "pending").toLowerCase().replaceAll(" ", "_");
  return <span className={`staff-status staff-status--${safeStatus}`}>{statusLabel(safeStatus)}</span>;
}

export function StaffSummaryCard({ label, value, detail, tone = "purple" }) {
  return (
    <article className={`staff-summary-card staff-summary-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

export function StaffModal({ title, children, onClose, wide = false }) {
  return (
    <div className="staff-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`staff-modal ${wide ? "staff-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="staff-modal__header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function StaffConfirmModal({
  title = "Confirm action",
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  onConfirm,
  onCancel,
}) {
  return (
    <div className="staff-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="staff-modal staff-modal--confirm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="staff-modal__header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onCancel} aria-label="Close confirmation">
            <X size={18} />
          </button>
        </header>
        <p className="staff-confirm-copy">{message}</p>
        <div className="staff-heading-actions">
          <button type="button" className="button button--secondary" onClick={onCancel}>
            Keep
          </button>
          <button
            type="button"
            className={`button ${tone === "danger" ? "button--danger" : "button--primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function StaffToastStack({ toasts = [] }) {
  if (!toasts.length) return null;
  return (
    <div className="staff-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`staff-toast staff-toast--${toast.tone || "success"}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export function StaffDataTable({ children, className = "" }) {
  return <div className={`staff-table-wrap ${className}`}>{children}</div>;
}
