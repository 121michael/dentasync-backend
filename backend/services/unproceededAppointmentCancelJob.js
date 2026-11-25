"use strict";

const lifecycle = require("./appointmentLifecycle");
const { insertPatientNotification } = require("./patientPortalNotifications");

const AUTO_REASON = "no_show_after_clinic_cutoff";
const AUTO_NOTE =
  "Automatically marked no-show because the patient had not checked in by 6:00 PM on the appointment clinic date.";
const NO_SHOW_TITLE = "Appointment marked as no-show";
const PENDING_CANCEL_REASON = "end_of_clinic_day_unconfirmed";
const PENDING_CANCEL_NOTE = "Cancelled at end of clinic day—appointment not confirmed";
const PENDING_CANCEL_TITLE = "Appointment request cancelled";

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
  )`;
}

async function alreadyNotified(db, userId, appointmentId, title) {
  try {
    const existing = await db.query(
      `SELECT 1
       FROM patient_portal_notifications
       WHERE user_id = $1
         AND entity_type = 'appointment'
         AND entity_id = $2
         AND title = $3
       LIMIT 1`,
      [String(userId), String(appointmentId), title]
    );
    return Boolean(existing.rows[0]);
  } catch (error) {
    if (error.code === "42703" || error.code === "42P01") return false;
    throw error;
  }
}

async function notifyOutcome(db, row) {
  const cancelled = String(row.status || "") === "cancelled";
  const title = cancelled ? PENDING_CANCEL_TITLE : NO_SHOW_TITLE;
  if (await alreadyNotified(db, row.user_id, row.id, title)) return;
  const date = String(row.appointment_date || "").slice(0, 10);
  const body = cancelled
    ? `Your ${row.service_name} request on ${date} was cancelled because it was not confirmed by 6:00 PM.`
    : `Your ${row.service_name} visit on ${date} was marked as no-show because you did not check in by 6:00 PM.`;
  await insertPatientNotification(db, {
    userId: row.user_id,
    type: "appointment",
    title,
    body,
    entityType: "appointment",
    entityId: row.id,
  }).catch((notifyError) => {
    console.warn("Appointment cutoff notification skipped:", notifyError.message);
  });
}

function createUnproceededAppointmentCancelJob({ db, intervalMs = 5 * 60 * 1000 } = {}) {
  let timer = null;
  let running = false;

  async function markEligible(now = new Date()) {
    const tz = lifecycle.clinicTimezone();
    const params = [now.toISOString(), tz, AUTO_REASON, AUTO_NOTE, PENDING_CANCEL_REASON, PENDING_CANCEL_NOTE];
    let result;
    try {
      result = await db.query(
        `UPDATE patient_portal_appointments AS appointment
         SET status = CASE
               WHEN closing.previous_status = 'pending' THEN 'cancelled'
               ELSE 'no_show'
             END,
             cancellation_reason = CASE
               WHEN closing.previous_status = 'pending' THEN $5::text
               ELSE $3::text
             END,
             cancelled_at = CURRENT_TIMESTAMP,
             cancelled_by = 'system',
             notes = LEFT(CONCAT_WS(
               E'\\n',
               NULLIF(appointment.notes, ''),
               CASE
                 WHEN closing.previous_status = 'pending' THEN $6::text
                 ELSE $4::text
               END
             ), 1200),
             updated_at = CURRENT_TIMESTAMP
         FROM (
           SELECT eligible.id, eligible.status AS previous_status
           FROM patient_portal_appointments AS eligible
           WHERE ${missedWhere("eligible")}
           FOR UPDATE SKIP LOCKED
         ) AS closing
         WHERE appointment.id = closing.id
         RETURNING appointment.id, appointment.user_id, appointment.service_name,
                   appointment.appointment_date, appointment.appointment_time, appointment.status`,
        params
      );
    } catch (error) {
      if (error.code === "42703") {
        result = await db.query(
          `UPDATE patient_portal_appointments AS appointment
           SET status = CASE
                 WHEN closing.previous_status = 'pending' THEN 'cancelled'
                 ELSE 'no_show'
               END,
               notes = LEFT(CONCAT_WS(
                 E'\\n',
                 NULLIF(appointment.notes, ''),
                 CASE
                   WHEN closing.previous_status = 'pending' THEN $4::text
                   ELSE $3::text
                 END
               ), 1200),
               updated_at = CURRENT_TIMESTAMP
           FROM (
             SELECT eligible.id, eligible.status AS previous_status
             FROM patient_portal_appointments AS eligible
             WHERE ${missedWhere("eligible")}
           ) AS closing
           WHERE appointment.id = closing.id
           RETURNING appointment.id, appointment.user_id, appointment.service_name,
                     appointment.appointment_date, appointment.appointment_time, appointment.status`,
          [now.toISOString(), tz, AUTO_NOTE, PENDING_CANCEL_NOTE]
        );
      } else if (error.code === "42P01") {
        return { skipped: false, cancelled: 0, noShows: 0, reason: "missing_relation" };
      } else {
        throw error;
      }
    }

    const rows = result.rows || [];
    for (const row of rows) {
      const queueStatus = String(row.status) === "cancelled" ? "cancelled" : "no_show";
      await lifecycle.closeQueueForAppointment(db, row.id, queueStatus);
      await notifyOutcome(db, row);
    }

    const cancelledRows = rows.filter((row) => String(row.status) === "cancelled");
    const noShowRows = rows.filter((row) => String(row.status) === "no_show");
    return {
      skipped: false,
      cancelled: cancelledRows.length,
      noShows: noShowRows.length,
      ids: rows.map((row) => row.id),
    };
  }

  async function runOnce(now = new Date()) {
    if (running) return { skipped: true, cancelled: 0, noShows: 0, reason: "in_progress" };
    running = true;
    try {
      return await markEligible(now);
    } catch (error) {
      console.error("Appointment cutoff job failed:", error.message);
      return { error: error.message, cancelled: 0, noShows: 0 };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    setTimeout(() => {
      runOnce().then((result) => {
        if (result?.skipped) return;
        if (result?.cancelled) {
          console.log(`Missed appointment job cancelled ${result.cancelled} unconfirmed request(s) at 6:00 PM.`);
        }
        if (result?.noShows) {
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
  PENDING_CANCEL_REASON,
  PENDING_CANCEL_NOTE,
  PENDING_CANCEL_TITLE,
};
