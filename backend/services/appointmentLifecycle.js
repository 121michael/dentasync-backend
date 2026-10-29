"use strict";

const CLINIC_TIMEZONE = () => process.env.CLINIC_TIMEZONE || "Asia/Manila";
const AUTO_CANCEL_HOUR = 18;
const WAIT_TOO_LONG_MS = 2 * 60 * 60 * 1000;
const IN_TREATMENT_QUEUE = new Set(["dentist"]);
const PROCEEDED_QUEUE = new Set(["preparing", "called", "dentist"]);
const INACTIVE_QUEUE = new Set(["completed", "no_show", "cancelled"]);
const CANCELABLE_APPOINTMENT = new Set(["pending", "confirmed", "checked_in"]);
const RESCHEDULABLE_APPOINTMENT = new Set(["pending", "confirmed", "checked_in"]);
const TERMINAL_APPOINTMENT = new Set(["completed", "cancelled", "rescheduled", "no_show"]);

const PATIENT_STATUS_LABELS = {
  pending: "Pending",
  confirmed: "Confirmed",
  booked: "Confirmed",
  checked_in: "Checked In",
  completed: "Completed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
  no_show: "Cancelled",
};

function clinicTimezone() {
  return CLINIC_TIMEZONE();
}

function displayAppointmentStatus(status) {
  const key = String(status || "pending").toLowerCase();
  return PATIENT_STATUS_LABELS[key] || key.replaceAll("_", " ");
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase();
}

function isTerminalAppointment(status) {
  return TERMINAL_APPOINTMENT.has(normalizeStatus(status));
}

function canPatientCancel(status, queueStatus) {
  if (!CANCELABLE_APPOINTMENT.has(normalizeStatus(status))) return false;
  return !IN_TREATMENT_QUEUE.has(normalizeStatus(queueStatus));
}

function canPatientReschedule(status, queueStatus) {
  if (!RESCHEDULABLE_APPOINTMENT.has(normalizeStatus(status))) return false;
  return !IN_TREATMENT_QUEUE.has(normalizeStatus(queueStatus));
}

function queueHasProceeded(queueStatus) {
  return PROCEEDED_QUEUE.has(normalizeStatus(queueStatus));
}

function waitedTooLong({ checkedInAt, queueStatus, now = new Date() }) {
  if (!checkedInAt) return false;
  if (INACTIVE_QUEUE.has(normalizeStatus(queueStatus))) return false;
  if (IN_TREATMENT_QUEUE.has(normalizeStatus(queueStatus))) return false;
  const started = new Date(checkedInAt);
  if (Number.isNaN(started.getTime())) return false;
  return now.getTime() - started.getTime() >= WAIT_TOO_LONG_MS;
}

function clinicParts(now = new Date(), timeZone = clinicTimezone()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return {
    timeZone,
    date: `${read("year")}-${read("month")}-${read("day")}`,
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

function shouldRunAutoCancel(now = new Date(), timeZone = clinicTimezone()) {
  const parts = clinicParts(now, timeZone);
  return parts.hour >= AUTO_CANCEL_HOUR;
}

function appointmentOwnershipSql(alias = "appointments") {
  return `(
    ${alias}.user_id = $2
    OR ${alias}.user_id IN (
      SELECT dependent_user_id
      FROM patient_portal_dependents
      WHERE guardian_user_id = $2
        AND dependent_user_id IS NOT NULL
        AND LOWER(COALESCE(approval_status, 'approved')) = 'approved'
        AND removed_at IS NULL
    )
  )`;
}

async function loadActiveQueueForAppointment(db, appointmentId) {
  if (!appointmentId) return null;
  try {
    const result = await db.query(
      `SELECT id, status, checked_in_at, appointment_id
       FROM patient_portal_queue_entries
       WHERE appointment_id = $1
         AND status NOT IN ('completed', 'no_show')
       ORDER BY checked_in_at DESC
       LIMIT 1`,
      [appointmentId]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code === "42P01") return null;
    throw error;
  }
}

async function closeQueueForAppointment(db, appointmentId, nextStatus = "no_show") {
  if (!appointmentId) return;
  try {
    await db.query(
      `UPDATE patient_portal_queue_entries
       SET status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE appointment_id = $1
         AND status NOT IN ('completed', 'no_show')`,
      [appointmentId, nextStatus]
    );
  } catch (error) {
    if (error.code !== "42P01") {
      console.warn("Unable to update queue after appointment change:", error.message);
    }
  }
}

module.exports = {
  AUTO_CANCEL_HOUR,
  WAIT_TOO_LONG_MS,
  PATIENT_STATUS_LABELS,
  clinicTimezone,
  clinicParts,
  displayAppointmentStatus,
  canPatientCancel,
  canPatientReschedule,
  isTerminalAppointment,
  queueHasProceeded,
  waitedTooLong,
  shouldRunAutoCancel,
  appointmentOwnershipSql,
  loadActiveQueueForAppointment,
  closeQueueForAppointment,
};
