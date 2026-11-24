"use strict";

const lifecycle = require("./appointmentLifecycle");
const { insertPatientNotification } = require("./patientPortalNotifications");

const AUTO_REASON = "no_show_after_clinic_cutoff";
const AUTO_NOTE =
  "Automatically marked no-show because the patient had not checked in by 6:00 PM on the appointment clinic date.";
const NO_SHOW_TITLE = "Appointment marked as no-show";
const ACTIVE_QUEUE = "('waiting', 'checked_in', 'preparing', 'called', 'dentist')";

function missedWhere(alias = "appointment") {
  return `
  ${alias}.status IN ('pending', 'confirmed')
  AND (
    ${alias}.appointment_date < ($1::timestamptz AT TIME ZONE $2)::date
    OR (
      ${alias}.appointment_date = ($1::timestamptz AT TIME ZONE $2)::date
      AND EXTRACT(HOUR FROM ($1::timestamptz AT TIME ZONE $2)) >= ${lifecycle.AUTO_CANCEL_HOUR}
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM patient_portal_queue_entries AS queue
    WHERE queue.appointment_id = ${alias}.id
      AND queue.status IN ${ACTIVE_QUEUE}
  )`;
}

async function alreadyNotifiedNoShow(db, userId, appointmentId) {
  try {
    const existing = await db.query(
      `SELECT 1
       FROM patient_portal_notifications
       WHERE user_id = $1
         AND entity_type = 'appointment'
         AND entity_id = $2
         AND title = $3
       LIMIT 1`,
      [String(userId), String(appointmentId), NO_SHOW_TITLE]
    );
    return Boolean(existing.rows[0]);
  } catch (error) {
    if (error.code === "42703" || error.code === "42P01") return false;
    throw error;
  }
}

async function notifyNoShow(db, row) {
  if (await alreadyNotifiedNoShow(db, row.user_id, row.id)) return;
  await insertPatientNotification(db, {
    userId: row.user_id,
    type: "appointment",
    title: NO_SHOW_TITLE,
    body: `Your ${row.service_name} visit on ${row.appointment_date} was marked as no-show because you did not check in by 6:00 PM.`,
    entityType: "appointment",
    entityId: row.id,
  }).catch((notifyError) => {
    console.warn("No-show notification skipped:", notifyError.message);
  });
}

function createUnproceededAppointmentCancelJob({ db, intervalMs = 5 * 60 * 1000 } = {}) {
  let timer = null;
  let running = false;

  async function markEligible(now = new Date()) {
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
             notes = LEFT(CONCAT_WS(E'\\n', NULLIF(appointment.notes, ''), $4::text), 1200),
             updated_at = CURRENT_TIMESTAMP
         WHERE appointment.id IN (
           SELECT eligible.id
           FROM patient_portal_appointments AS eligible
           WHERE ${missedWhere("eligible")}
           FOR UPDATE SKIP LOCKED
         )
         RETURNING appointment.id, appointment.user_id, appointment.service_name,
                   appointment.appointment_date, appointment.appointment_time`,
        params
      );
    } catch (error) {
      if (error.code === "42703") {
        result = await db.query(
          `UPDATE patient_portal_appointments AS appointment
           SET status = 'no_show',
               notes = LEFT(CONCAT_WS(E'\\n', NULLIF(appointment.notes, ''), $3::text), 1200),
               updated_at = CURRENT_TIMESTAMP
           WHERE ${missedWhere("appointment")}
           RETURNING appointment.id, appointment.user_id, appointment.service_name,
                     appointment.appointment_date, appointment.appointment_time`,
          [now.toISOString(), tz, AUTO_NOTE]
        );
      } else if (error.code === "42P01") {
        return { skipped: false, cancelled: 0, noShows: 0, reason: "missing_relation" };
      } else {
        throw error;
      }
    }

    const rows = result.rows || [];
    for (const row of rows) {
      await lifecycle.closeQueueForAppointment(db, row.id, "no_show");
      await notifyNoShow(db, row);
    }

    return { skipped: false, cancelled: rows.length, noShows: rows.length, ids: rows.map((row) => row.id) };
  }

  async function runOnce(now = new Date()) {
    if (running) return { skipped: true, cancelled: 0, noShows: 0, reason: "in_progress" };
    running = true;
    try {
      return await markEligible(now);
    } catch (error) {
      console.error("Appointment no-show job failed:", error.message);
      return { error: error.message, cancelled: 0, noShows: 0 };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    setTimeout(() => {
      runOnce().then((result) => {
        if (!result?.skipped && result?.noShows) {
          console.log(`Missed appointment job marked ${result.noShows} visit(s) as no-show.`);
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

  return { start, stop, runOnce, cancelEligible: markEligible, markEligible };
}

module.exports = {
  createUnproceededAppointmentCancelJob,
  AUTO_REASON,
  NO_SHOW_TITLE,
};
