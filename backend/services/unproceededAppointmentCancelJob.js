"use strict";

const lifecycle = require("./appointmentLifecycle");
const { insertPatientNotification } = require("./patientPortalNotifications");

const AUTO_REASON = "unproceeded_after_6pm";
const AUTO_NOTE =
  "Automatically cancelled after 6:00 PM clinic time because the visit had not proceeded.";

function createUnproceededAppointmentCancelJob({ db, intervalMs = 5 * 60 * 1000 } = {}) {
  let timer = null;
  let running = false;

  async function cancelEligible(now = new Date()) {
    if (!lifecycle.shouldRunAutoCancel(now)) {
      return { skipped: true, cancelled: 0, reason: "before_cutoff" };
    }

    const tz = lifecycle.clinicTimezone();
    const { date: clinicDate } = lifecycle.clinicParts(now, tz);
    let result;
    try {
      result = await db.query(
        `UPDATE patient_portal_appointments AS appointment
         SET status = 'cancelled',
             cancellation_reason = $2::text,
             cancelled_at = CURRENT_TIMESTAMP,
             cancelled_by = 'system',
             notes = LEFT(CONCAT_WS(E'\n', NULLIF(appointment.notes, ''), $3::text), 1200),
             updated_at = CURRENT_TIMESTAMP
         WHERE appointment.appointment_date = $1::date
           AND appointment.appointment_time <= TIME '18:00'
           AND appointment.status IN ('pending', 'confirmed', 'checked_in')
           AND NOT EXISTS (
             SELECT 1
             FROM patient_portal_queue_entries AS queue
             WHERE queue.appointment_id = appointment.id
               AND queue.status IN ('preparing', 'called', 'dentist')
           )
         RETURNING appointment.id, appointment.user_id, appointment.service_name,
                   appointment.appointment_date, appointment.appointment_time`,
        [clinicDate, AUTO_REASON, AUTO_NOTE]
      );
    } catch (error) {
      if (error.code === "42703") {
        result = await db.query(
          `UPDATE patient_portal_appointments AS appointment
           SET status = 'cancelled',
               notes = LEFT(CONCAT_WS(E'\n', NULLIF(appointment.notes, ''), $2::text), 1200),
               updated_at = CURRENT_TIMESTAMP
           WHERE appointment.appointment_date = $1::date
             AND appointment.appointment_time <= TIME '18:00'
             AND appointment.status IN ('pending', 'confirmed', 'checked_in')
             AND NOT EXISTS (
               SELECT 1
               FROM patient_portal_queue_entries AS queue
               WHERE queue.appointment_id = appointment.id
                 AND queue.status IN ('preparing', 'called', 'dentist')
             )
           RETURNING appointment.id, appointment.user_id, appointment.service_name,
                     appointment.appointment_date, appointment.appointment_time`,
          [clinicDate, AUTO_NOTE]
        );
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
        body: `Your ${row.service_name} visit on ${row.appointment_date} was cancelled because it had not proceeded by 6:00 PM.`,
        entityType: "appointment",
        entityId: row.id,
      }).catch((notifyError) => {
        console.warn("Auto-cancel notification skipped:", notifyError.message);
      });
    }

    return { skipped: false, cancelled: rows.length, clinicDate, ids: rows.map((row) => row.id) };
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
          console.log(`Unproceeded appointment job cancelled ${result.cancelled} visit(s).`);
        }
      });
    }, 25_000);
    timer = setInterval(() => {
      runOnce().catch((error) => console.error("Unproceeded appointment interval error:", error.message));
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
