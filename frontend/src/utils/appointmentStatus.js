const LABELS = {
  pending: "Pending",
  confirmed: "Confirmed",
  booked: "Confirmed",
  checked_in: "Checked In",
  completed: "Completed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
  no_show: "No-show",
  cancelled: "Cancelled",
  not_served: "Not served",
  needs_review: "Needs review",
};

export function displayAppointmentStatus(status, statusLabel) {
  if (statusLabel) return statusLabel;
  const key = String(status || "pending").toLowerCase();
  return LABELS[key] || key.replaceAll("_", " ");
}

export function canManageAppointment(appointment) {
  const status = String(appointment?.status || "").toLowerCase();
  const outcome = String(appointment?.queueOutcome || appointment?.statusLabel || "").toLowerCase();
  if (["cancelled", "not served", "not_served", "needs review", "needs_review", "no-show", "no_show"].includes(outcome)) {
    return { cancel: false, reschedule: false };
  }
  if (appointment?.canCancel != null || appointment?.canReschedule != null) {
    return {
      cancel: Boolean(appointment.canCancel),
      reschedule: Boolean(appointment.canReschedule),
    };
  }
  const open = ["pending", "confirmed", "checked_in"].includes(status);
  return { cancel: open, reschedule: open };
}

export function clinicTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
