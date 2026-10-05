export function dentistInitials(user) {
  return `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || ""}`.toUpperCase() || "DR";
}

export function formatDentistDate(value, fallback = "—") {
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

export function formatDentistTime(value, fallback = "—") {
  if (typeof value !== "string") return fallback;
  const [hours, minutes] = value.split(":");
  if (!/^\d{1,2}$/.test(hours || "") || !/^\d{2}$/.test(minutes || "")) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, Number(hours), Number(minutes)));
}

export function formatDentistDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function statusLabel(value) {
  return String(value || "unknown").replaceAll("_", " ");
}
