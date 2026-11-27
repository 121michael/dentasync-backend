const LABELS = {
  pending: "Pending",
  confirmed: "Confirmed",
  booked: "Confirmed",
  checked_in: "Checked In",
  called: "Called",
  in_treatment: "In Treatment",
  completed: "Completed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
  no_show: "No-show",
  not_served: "Not served",
  needs_review: "Needs Dentist review",
};

const TERMINAL_SECTIONS = new Set([
  "completed",
  "cancelled",
  "rescheduled",
  "no_show",
  "not_served",
]);

export function historySectionOf(appointment, today = clinicTodayYmd()) {
  if (appointment?.historySection) return appointment.historySection;
  const rawDate = appointment?.date;
  const date =
    rawDate instanceof Date && !Number.isNaN(rawDate.getTime())
      ? rawDate.toISOString().slice(0, 10)
      : String(rawDate || "").slice(0, 10);
  const status = String(appointment?.status || "").toLowerCase();
  const outcome = String(appointment?.queueOutcome || "").toLowerCase();
  if (status === "needs_review" || outcome === "needs_review") return "review";
  if (TERMINAL_SECTIONS.has(status) || TERMINAL_SECTIONS.has(outcome)) return "past";
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    date === today &&
    ["checked_in", "called", "in_treatment", "waiting", "preparing", "dentist"].includes(status)
  ) {
    return "current";
  }
  if (["pending", "confirmed"].includes(status) && date >= today) return "upcoming";
  return "past";
}

export function displayAppointmentStatus(status, statusLabel) {
  if (statusLabel) return statusLabel;
  const key = String(status || "pending").toLowerCase();
  return LABELS[key] || key.replaceAll("_", " ");
}

export function canManageAppointment(appointment) {
  const status = String(appointment?.status || "").toLowerCase();
  const outcome = String(appointment?.queueOutcome || appointment?.statusLabel || "").toLowerCase();
  if (
    [
      "cancelled",
      "not served",
      "not_served",
      "needs review",
      "needs_review",
      "needs end-of-day review",
      "no-show",
      "no_show",
      "in treatment",
      "in_treatment",
      "dentist",
    ].includes(outcome)
  ) {
    return { cancel: false, reschedule: false };
  }
  if (appointment?.canCancel != null || appointment?.canReschedule != null) {
    return {
      cancel: Boolean(appointment.canCancel),
      reschedule: Boolean(appointment.canReschedule),
    };
  }
  const open = ["pending", "confirmed", "checked_in", "called"].includes(status);
  return { cancel: open, reschedule: open };
}

export function clinicTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
