import { X } from "lucide-react";
import { statusLabel } from "../adminUtils";

export function AdminStatusBadge({ status }) {
  const safe = String(status || "pending").toLowerCase().replaceAll(" ", "_");
  return <span className={`admin-status admin-status--${safe}`}>{statusLabel(safe)}</span>;
}

export function AdminModal({ title, children, onClose, wide = false }) {
  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`admin-modal ${wide ? "admin-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-modal__header">
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

export function AdminConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  onConfirm,
  onCancel,
}) {
  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-modal__header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onCancel} aria-label="Close confirmation">
            <X size={18} />
          </button>
        </header>
        <p className="admin-confirm-copy">{message}</p>
        <div className="admin-modal__actions">
          <button className="button button--secondary" onClick={onCancel}>Cancel</button>
          <button
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

export function AdminToastStack({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="admin-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`admin-toast admin-toast--${toast.tone || "success"}`}>
          <span>{toast.message}</span>
          <button className="icon-button" onClick={() => onDismiss?.(toast.id)} aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function AdminStatCard({ label, value, detail, tone = "purple", icon: Icon }) {
  return (
    <article className={`admin-stat-card admin-stat-card--${tone}`}>
      <div className="admin-stat-card__top">
        <span>{label}</span>
        {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      </div>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

export function AdminBarChart({ title, points = [], valueKey = "value", labelKey = "label" }) {
  const max = Math.max(1, ...points.map((point) => Number(point[valueKey] || 0)));
  return (
    <section className="admin-chart-card">
      <div className="admin-panel__heading">
        <div>
          <span className="eyebrow">Analytics</span>
          <h2>{title}</h2>
        </div>
      </div>
      {points.length ? (
        <div className="admin-bar-chart" role="img" aria-label={title}>
          {points.map((point) => {
            const value = Number(point[valueKey] || 0);
            return (
              <div className="admin-bar-chart__item" key={`${point[labelKey]}-${value}`}>
                <div className="admin-bar-chart__track">
                  <span style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />
                </div>
                <small>{point[labelKey]}</small>
                <strong>{value}</strong>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted-copy">No chart data is available for this range.</p>
      )}
    </section>
  );
}

export function AdminDonutChart({ title, segments = [] }) {
  const total = segments.reduce((sum, segment) => sum + Number(segment.value || 0), 0) || 1;
  let cumulative = 0;
  const gradient = segments
    .map((segment) => {
      const start = (cumulative / total) * 100;
      cumulative += Number(segment.value || 0);
      const end = (cumulative / total) * 100;
      return `${segment.color} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <section className="admin-chart-card">
      <div className="admin-panel__heading">
        <div>
          <span className="eyebrow">Distribution</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="admin-donut-wrap">
        <div className="admin-donut" style={{ background: `conic-gradient(${gradient || "#ece6f5 0 100%"})` }} />
        <ul className="admin-donut-legend">
          {segments.map((segment) => (
            <li key={segment.label}>
              <i style={{ background: segment.color }} />
              <span>{segment.label}</span>
              <strong>{segment.value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
