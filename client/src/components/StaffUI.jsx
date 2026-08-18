import { X } from "lucide-react";

const statusLabels = {
  checked_in: "Checked-in",
  waiting: "Waiting",
  preparing: "Preparing",
  in_chair: "In Chair",
  dentist: "In Chair",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
  confirmed: "Confirmed",
  pending: "Pending",
  available: "Available",
  unavailable: "Unavailable",
  on_leave: "On Leave",
  active: "Active",
  inactive: "Inactive",
};

export function statusLabel(value) {
  return statusLabels[value] || String(value || "Unknown").replaceAll("_", " ");
}

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

export function formatStaffDate(value, fallback = "—") {
  if (!value) return fallback;
  const text = typeof value === "string" ? value.trim() : value;
  const date =
    typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? new Date(`${text}T00:00:00`)
      : new Date(text);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatStaffTime(value, fallback = "—") {
  if (typeof value !== "string") return fallback;
  const [hours, minutes] = value.split(":");
  if (
    !/^\d{1,2}$/.test(hours || "") ||
    !/^\d{2}$/.test(minutes || "") ||
    Number(hours) > 23 ||
    Number(minutes) > 59
  ) {
    return fallback;
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, Number(hours), Number(minutes)));
}

export function formatStaffDateTime(value, fallback = "Just now") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function staffInitials(user) {
  return `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || ""}`.toUpperCase() || "ST";
}
