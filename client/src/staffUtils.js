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
