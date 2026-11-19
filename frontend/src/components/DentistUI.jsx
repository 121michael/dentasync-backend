import { useEffect } from "react";
import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { statusLabel } from "../dentistUtils";

export function DentistStatusBadge({ status }) {
  const safe = String(status || "pending").toLowerCase().replaceAll(" ", "_");
  return <span className={`dentist-status dentist-status--${safe}`}>{statusLabel(safe)}</span>;
}

export function DentistSummaryCard({
  label,
  value,
  detail,
  timeframe,
  icon: Icon,
  tone = "purple",
  to,
  actionable = false,
}) {
  const className = `dentist-stat-card dentist-stat-card--${tone}${to ? " dentist-stat-card--link" : ""}${
    actionable ? " is-actionable" : ""
  }`;
  const body = (
    <>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {timeframe ? <em className="ops-metric-timeframe">{timeframe}</em> : null}
        {detail ? <small>{detail}</small> : null}
      </div>
      {Icon ? (
        <span className="dentist-stat-card__icon" aria-hidden="true">
          <Icon size={15} />
        </span>
      ) : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }
  return <article className={className}>{body}</article>;
}

export function DentistModal({
  title,
  children,
  onClose,
  wide = false,
  stacked = false,
  closeOnEscape = false,
  className = "",
}) {
  useEffect(() => {
    if (!closeOnEscape) return undefined;
    function onKey(event) {
      if (event.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEscape, onClose]);

  return (
    <div
      className={`dentist-modal-backdrop${stacked ? " dentist-modal-backdrop--stacked" : ""}`}
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className={`dentist-modal ${wide ? "dentist-modal--wide" : ""} ${className}`.trim()}
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
