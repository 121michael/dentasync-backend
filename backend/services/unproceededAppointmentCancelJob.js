"use strict";

const lifecycle = require("./appointmentLifecycle");
const { insertPatientNotification } = require("./patientPortalNotifications");

const AUTO_REASON = "missed_after_scheduled_time";
const AUTO_NOTE =
  "Automatically cancelled because the patient had not checked in after the scheduled clinic time.";

const MISSED_WHERE = `
  appointment.status IN ('pending', 'confirmed')
  AND (
    (
      appointment.appointment_time IS NOT NULL
      AND ((appointment.appointment_date + appointment.appointment_time) AT TIME ZONE $2) < $1::timestamptz
    )
    OR (
      appointment.appointment_time IS NULL
      AND appointment.appointment_date < ($1::timestamptz AT TIME ZONE $2)::date
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM patient_portal_queue_entries AS queue
    WHERE queue.appointment_id = appointment.id
      AND queue.status IN ('waiting', 'checked_in', 'preparing', 'called', 'dentist')
  )
`;

function createUnproceededAppointmentCancelJob({ db, intervalMs = 5 * 60 * 1000 } = {}) {
  let timer = null;
  let running = false;

  async function cancelEligible(now = new Date()) {
    const tz = lifecycle.clinicTimezone();
    const params = [now.toISOString(), tz, AUTO_REASON, AUTO_NOTE];
    let result;
    try {
      result = await db.query(
        `UPDATE patient_portal_appointments AS appointment
         SET status = 'cancelled',
             cancellation_reason = $3::text,
             cancelled_at = CURRENT_TIMESTAMP,
             cancelled_by = 'system',
             notes = LEFT(CONCAT_WS(E'\n', NULLIF(appointment.notes, ''), $4::text), 1200),
             updated_at = CURRENT_TIMESTAMP
         WHERE ${MISSED_WHERE}
         RETURNING appointment.id, appointment.user_id, appointment.service_name,
                   appointment.appointment_date, appointment.appointment_time`,
        params
      );
    } catch (error) {
      if (error.code === "42703") {
        result = await db.query(
          `UPDATE patient_portal_appointments AS appointment
           SET status = 'cancelled',
               notes = LEFT(CONCAT_WS(E'\n', NULLIF(appointment.notes, ''), $3::text), 1200),
               updated_at = CURRENT_TIMESTAMP
           WHERE ${MISSED_WHERE}
           RETURNING appointment.id, appointment.user_id, appointment.service_name,
                     appointment.appointment_date, appointment.appointment_time`,
          [now.toISOString(), tz, AUTO_NOTE]
        );
      } else if (error.code === "42P01") {
        return { skipped: false, cancelled: 0, reason: "missing_relation" };
      } else {
        throw error;
      }
    }

    const rows = result.rows || [];
    for (const row of rows) {
      await lifecycle.closeQueueForAppointment(db, row.id, "no_show");
      await insertPatientNotification(db, {
        userId: row.user_id,
        type: "appointment",
        title: "Appointment cancelled",
        body: `Your ${row.service_name} visit on ${row.appointment_date} was cancelled because you did not check in by the scheduled time.`,
        entityType: "appointment",
        entityId: row.id,
      }).catch((notifyError) => {
        console.warn("Auto-cancel notification skipped:", notifyError.message);
      });
    }

    return { skipped: false, cancelled: rows.length, ids: rows.map((row) => row.id) };
  }

  async function runOnce(now = new Date()) {
    if (running) return { skipped: true, cancelled: 0, reason: "in_progress" };
    running = true;
    try {
      return await cancelEligible(now);
    } catch (error) {
      console.error("Unproceeded appointment cancel job failed:", error.message);
      return { error: error.message, cancelled: 0 };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    setTimeout(() => {
      runOnce().then((result) => {
        if (!result?.skipped && result?.cancelled) {
          console.log(`Missed appointment job cancelled ${result.cancelled} visit(s).`);
        }
      });
    }, 25_000);
    timer = setInterval(() => {
      runOnce().catch((error) => console.error("Missed appointment interval error:", error.message));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, runOnce, cancelEligible };
}

module.exports = {
  createUnproceededAppointmentCancelJob,
  AUTO_REASON,
};
