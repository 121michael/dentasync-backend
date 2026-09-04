import { X } from "lucide-react";
import { statusLabel } from "../dentistUtils";

export function DentistStatusBadge({ status }) {
  const safe = String(status || "pending").toLowerCase().replaceAll(" ", "_");
  return <span className={`dentist-status dentist-status--${safe}`}>{statusLabel(safe)}</span>;
}

export function DentistSummaryCard({ label, value, detail, icon: Icon, tone = "purple" }) {
  return (
    <article className={`dentist-stat-card dentist-stat-card--${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
      {Icon ? (
        <span className="dentist-stat-card__icon" aria-hidden="true">
          <Icon size={20} />
        </span>
      ) : null}
    </article>
  );
}

export function DentistModal({ title, children, onClose, wide = false }) {
  return (
    <div className="dentist-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`dentist-modal ${wide ? "dentist-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dentist-modal__header">
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
