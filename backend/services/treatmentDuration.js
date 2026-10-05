"use strict";

const { invalidateDurationStatsCache } = require("./queueWaitPrediction");

function minutesBetween(start, end) {
  const started = new Date(start);
  const completed = new Date(end);
  if (Number.isNaN(started.getTime()) || Number.isNaN(completed.getTime())) return null;
  return Math.max(0, Math.round((completed.getTime() - started.getTime()) / 60000));
}

async function markQueueServingStarted(db, queueEntryId) {
  if (!queueEntryId) return;
  try {
    await db.query(
      `UPDATE patient_portal_queue_entries
       SET serving_started_at = COALESCE(serving_started_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [queueEntryId]
    );
  } catch (error) {
    if (error?.code !== "42703") {
      console.warn("Unable to record serving start:", error.message);
    }
  }
}

async function recordTreatmentStart(db, {
  patientUserId = null,
  appointmentId = null,
  queueEntryId = null,
  procedureType,
  dentistId = null,
  chairId = null,
  treatmentId = null,
} = {}) {
  const procedure = String(procedureType || "Unknown").trim() || "Unknown";
  await markQueueServingStarted(db, queueEntryId);
  try {
    await db.query(
      `INSERT INTO clinic_treatment_durations (
         patient_user_id, appointment_id, queue_entry_id, procedure_type,
         started_at, dentist_id, chair_id, source, treatment_id
       )
       SELECT $1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, 'queue', $7
       WHERE $7::bigint IS NULL OR NOT EXISTS (
         SELECT 1 FROM clinic_treatment_durations
         WHERE treatment_id = $7 AND completed_at IS NULL
       )`,
      [
        patientUserId ? String(patientUserId) : null,
        appointmentId || null,
        queueEntryId || null,
        procedure,
        dentistId ? String(dentistId) : null,
        chairId ? String(chairId) : null,
        treatmentId || null,
      ]
    );
  } catch (error) {
    if (error?.code !== "42P01") {
      console.warn("Unable to record treatment start duration:", error.message);
    }
  }

  try {
    await db.query(
      `UPDATE clinic_patient_treatments
       SET started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
       WHERE id = (
         SELECT treatments.id
         FROM clinic_patient_treatments AS treatments
         JOIN clinic_patient_records AS records ON records.id = treatments.clinical_record_id
         WHERE records.linked_user_id = $1
           AND LOWER(COALESCE(treatments.status, '')) = 'in_progress'
         ORDER BY treatments.id DESC
         LIMIT 1
       )`,
      [patientUserId ? String(patientUserId) : ""]
    );
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") {
      console.warn("Unable to stamp clinical treatment started_at:", error.message);
    }
  }
}

async function recordTreatmentComplete(db, {
  patientUserId = null,
  appointmentId = null,
  queueEntryId = null,
  durationMinutes = null,
  treatmentId = null,
} = {}) {
  const now = new Date();
  let computed = Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0
    ? Math.round(Number(durationMinutes))
    : null;
  const closedTreatmentId =
    Number.isSafeInteger(Number(treatmentId)) && Number(treatmentId) > 0 ? Number(treatmentId) : null;

  try {
    const open = await db.query(
      `SELECT id, started_at
       FROM clinic_treatment_durations
       WHERE completed_at IS NULL
         AND (
           ($4::bigint IS NOT NULL AND treatment_id = $4)
           OR ($1::bigint IS NOT NULL AND queue_entry_id = $1 AND $4::bigint IS NULL)
           OR ($2::bigint IS NOT NULL AND appointment_id = $2 AND $4::bigint IS NULL)
           OR ($3::text IS NOT NULL AND patient_user_id = $3 AND $4::bigint IS NULL)
         )
       ORDER BY
         CASE WHEN treatment_id = $4 THEN 0 ELSE 1 END,
         CASE WHEN queue_entry_id = $1 THEN 0 ELSE 1 END,
         id DESC
       LIMIT 1`,
      [queueEntryId || null, appointmentId || null, patientUserId ? String(patientUserId) : null, closedTreatmentId]
    );
    const row = open.rows[0];
    if (row) {
      if (computed == null) {
        computed = minutesBetween(row.started_at, now);
      }
      await db.query(
        `UPDATE clinic_treatment_durations
         SET completed_at = CURRENT_TIMESTAMP,
             duration_minutes = $2
         WHERE id = $1`,
        [row.id, computed]
      );
      invalidateDurationStatsCache();
    }
  } catch (error) {
    if (error?.code !== "42P01") {
      console.warn("Unable to complete treatment duration row:", error.message);
    }
  }

  try {
    await db.query(
      `UPDATE clinic_patient_treatments
       SET completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
           duration_minutes = COALESCE($2, duration_minutes)
       WHERE id = (
         SELECT treatments.id
         FROM clinic_patient_treatments AS treatments
         JOIN clinic_patient_records AS records ON records.id = treatments.clinical_record_id
         WHERE records.linked_user_id = $1
           AND LOWER(COALESCE(treatments.status, '')) = 'completed'
         ORDER BY treatments.id DESC
         LIMIT 1
       )`,
      [patientUserId ? String(patientUserId) : "", computed]
    );
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") {
      console.warn("Unable to stamp clinical treatment completed_at:", error.message);
    }
  }

  return computed;
}

module.exports = {
  markQueueServingStarted,
  minutesBetween,
  recordTreatmentComplete,
  recordTreatmentStart,
};
