"use strict";

const lifecycle = require("./appointmentLifecycle");
const { insertPatientNotification } = require("./patientPortalNotifications");

const AUTO_REASON = "no_show_after_6pm_cutoff";
const AUTO_NOTE =
  "Automatically marked No-show because the patient had not checked in by 6:00 PM.";
const NOTICE_TITLE = "Appointment marked No-show";
const CUTOFF_TIME = "18:00";

const MISSED_WHERE = `
  appointment.status IN ('pending', 'confirmed')
  AND (
    (
      appointment.appointment_time IS NOT NULL
      AND appointment.appointment_time >= TIME '${CUTOFF_TIME}'
      AND ((appointment.appointment_date + appointment.appointment_time) AT TIME ZONE $2) <= $1::timestamptz
    )
    OR (
      (appointment.appointment_time IS NULL OR appointment.appointment_time < TIME '${CUTOFF_TIME}')
      AND ((appointment.appointment_date + TIME '${CUTOFF_TIME}') AT TIME ZONE $2) <= $1::timestamptz
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM patient_portal_queue_entries AS queue
    WHERE queue.appointment_id = appointment.id
      AND queue.status IN ('waiting', 'checked_in', 'preparing', 'called', 'dentist', 'completed')
  )
`;

function noticeBody(row) {
  const day = lifecycle.formatClinicDate(row.appointment_date) || "the appointment date";
  const clock = lifecycle.noShowCutoffClock(row.appointment_time);
  const cutoffLabel = clock === CUTOFF_TIME ? "6:00 PM" : clock;
  const service = row.service_name || "dental";
  return `Your ${service} visit on ${day} was marked No-show because there was no check-in by ${cutoffLabel}.`;
}

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
         SET status = 'no_show',
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
      if (error.code === "42703" || error.code === "23514") {
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
        title: NOTICE_TITLE,
        body: noticeBody(row),
        entityType: "appointment",
        entityId: row.id,
      }).catch((notifyError) => {
        console.warn("Auto no-show notification skipped:", notifyError.message);
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
          console.log(`Missed appointment job marked ${result.cancelled} visit(s) as no-show.`);
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
  AUTO_NOTE,
  NOTICE_TITLE,
};
