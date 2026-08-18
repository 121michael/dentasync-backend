import { X } from "lucide-react";
import { statusLabel } from "../staffUtils";

export function StaffStatusBadge({ status }) {
  const safeStatus = String(status || "pending").toLowerCase().replaceAll(" ", "_");
  return <span className={`staff-status staff-status--${safeStatus}`}>{statusLabel(safeStatus)}</span>;
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

export function StaffDataTable({ children, className = "" }) {
  return <div className={`staff-table-wrap ${className}`}>{children}</div>;
}
