const LABELS = {
  pending: "Pending",
  confirmed: "Confirmed",
  booked: "Confirmed",
  checked_in: "Checked In",
  completed: "Completed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
  no_show: "Cancelled",
};

export function displayAppointmentStatus(status) {
  const key = String(status || "pending").toLowerCase();
  return LABELS[key] || key.replaceAll("_", " ");
}

export function canManageAppointment(appointment) {
  const status = String(appointment?.status || "").toLowerCase();
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
