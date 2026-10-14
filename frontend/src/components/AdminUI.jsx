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

export function AdminBarChart({
  title,
  points = [],
  valueKey = "value",
  labelKey = "label",
  formatValue,
  eyebrow = "Analytics",
}) {
  const max = Math.max(1, ...points.map((point) => Number(point[valueKey] || 0)));
  const display = (value) => (formatValue ? formatValue(value) : String(value));
  return (
    <section className="admin-chart-card">
      <div className="admin-panel__heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      {points.length ? (
        <div className="admin-bar-chart" role="img" aria-label={title}>
          {points.map((point, index) => {
            const value = Number(point[valueKey] || 0);
            const label = point[labelKey];
            const percent = value > 0 ? Math.max(4, (value / max) * 100) : 0;
            return (
              <div className="admin-bar-chart__item" key={`${label}-${index}`}>
                <div className="admin-bar-chart__track">
                  <span style={{ "--bar-height": `${percent}%` }} />
                </div>
                <small>{label}</small>
                <strong>{display(value)}</strong>
                <em className="admin-chart-tip">{`${label}: ${display(value)}`}</em>
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

export function AdminLineChart({
  title,
  points = [],
  valueKey = "count",
  labelKey = "label",
  formatValue,
  eyebrow = "Trend",
}) {
  const display = (value) => (formatValue ? formatValue(value) : String(value));
  const values = points.map((point) => Number(point[valueKey] || 0));
  const max = Math.max(1, ...values);
  const width = 100;
  const height = 44;
  const padX = 3;
  const padY = 5;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : padX + (index / Math.max(1, values.length - 1)) * innerW;
    const y = padY + innerH - (value / max) * innerH;
    return { x, y, value, label: points[index][labelKey] };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${padX},${padY + innerH} ${line} ${padX + innerW},${padY + innerH}`;

  return (
    <section className="admin-chart-card">
      <div className="admin-panel__heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      {points.length ? (
        <div className="admin-line-chart" role="img" aria-label={title}>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {[0.25, 0.5, 0.75].map((step) => (
              <line
                key={step}
                x1={padX}
                x2={width - padX}
                y1={padY + innerH * (1 - step)}
                y2={padY + innerH * (1 - step)}
                className="admin-line-chart__grid"
              />
            ))}
            {coords.length > 1 ? <polygon className="admin-line-chart__area" points={area} /> : null}
            {coords.length > 1 ? <polyline className="admin-line-chart__line" points={line} /> : null}
            {coords.map((point) => (
              <circle key={`${point.label}-${point.x}`} cx={point.x} cy={point.y} r="1.15">
                <title>{`${point.label}: ${display(point.value)}`}</title>
              </circle>
            ))}
          </svg>
          <div className="admin-line-chart__labels">
            {points.map((point, index) => (
              <small key={`${point[labelKey]}-${index}`}>{point[labelKey]}</small>
            ))}
          </div>
        </div>
      ) : (
        <p className="muted-copy">No chart data is available for this range.</p>
      )}
    </section>
  );
}

export function AdminDonutChart({ title, segments = [] }) {
  const rawTotal = segments.reduce((sum, segment) => sum + Number(segment.value || 0), 0);
  const total = rawTotal || 1;
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
        <div
          className="admin-donut"
          style={{ background: `conic-gradient(${gradient || "#ece6f5 0 100%"})` }}
          role="img"
          aria-label={`${title} total ${rawTotal}`}
        >
          <div className="admin-donut__hole">
            <strong>{rawTotal}</strong>
            <small>Total</small>
          </div>
        </div>
        <ul className="admin-donut-legend">
          {segments.map((segment) => (
            <li key={segment.label} title={`${segment.label}: ${segment.value}`}>
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
