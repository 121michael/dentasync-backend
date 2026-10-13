"use strict";

const WELLNESS_SCORE_MIN = 0;
const WELLNESS_SCORE_MAX = 100;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function asDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isCompletedOralProphylaxis(treatment) {
  const status = String(treatment?.status || "").toLowerCase();
  if (status !== "completed") {
    return false;
  }
  const name = String(treatment?.treatment || treatment?.name || "").toLowerCase();
  return /prophylaxis|\bcleaning\b|oral\s*proph/.test(name);
}

function lastCleaningFromTreatments(treatments = []) {
  let latest = null;
  for (const treatment of treatments) {
    if (!isCompletedOralProphylaxis(treatment)) continue;
    const date = asDateOnly(treatment.treatmentDate || treatment.treatment_date || treatment.date);
    if (!date) continue;
    if (!latest || date > latest) {
      latest = date;
    }
  }
  return latest;
}

function parseWellnessScore(value) {
  if (value === null || value === undefined || value === "") {
    throw httpError(400, "Enter a wellness score from 0 to 100.");
  }
  const score = Number(value);
  if (!Number.isInteger(score) || score < WELLNESS_SCORE_MIN || score > WELLNESS_SCORE_MAX) {
    throw httpError(400, "Wellness score must be a whole number from 0 to 100.");
  }
  return score;
}

function emptyWellness(lastCleaning = null) {
  return {
    assessmentId: null,
    oralHealthScore: null,
    assessmentDate: null,
    clinicalNotes: "",
    nextCheckup: null,
    lastCleaning: lastCleaning || null,
    dentistId: null,
    hasAssessment: false,
    updatedAt: null,
  };
}

function mapAssessment(row, lastCleaning = null) {
  if (!row) {
    return emptyWellness(lastCleaning);
  }
  const score = row.wellness_score == null ? null : Number(row.wellness_score);
  return {
    assessmentId: row.id,
    oralHealthScore: Number.isInteger(score) ? score : null,
    assessmentDate: asDateOnly(row.assessment_date),
    clinicalNotes: row.clinical_notes || "",
    nextCheckup: asDateOnly(row.next_checkup),
    lastCleaning: lastCleaning || null,
    dentistId: row.dentist_id || null,
    hasAssessment: Number.isInteger(score),
    updatedAt: row.updated_at || row.created_at || null,
  };
}

async function loadTreatmentsForRecord(db, clinicalRecordId) {
  const result = await db.query(
    `SELECT id, treatment, status, treatment_date
     FROM clinic_patient_treatments
     WHERE clinical_record_id = $1
     ORDER BY treatment_date DESC, id DESC
     LIMIT 250`,
    [clinicalRecordId]
  );
  return result.rows.map((row) => ({
    treatment: row.treatment,
    status: row.status,
    treatmentDate: row.treatment_date,
  }));
}

async function loadLatestAssessment(db, clinicalRecordId) {
  const result = await db.query(
    `SELECT *
     FROM dental_wellness_assessments
     WHERE clinical_record_id = $1
     ORDER BY assessment_date DESC, updated_at DESC, id DESC
     LIMIT 1`,
    [clinicalRecordId]
  );
  return result.rows[0] || null;
}

async function getWellnessForClinicalRecord(db, record, treatments = null) {
  if (!record?.id) {
    return emptyWellness();
  }
  let rows = treatments;
  if (!Array.isArray(rows)) {
    try {
      rows = await loadTreatmentsForRecord(db, record.id);
    } catch (error) {
      if (error?.code !== "42P01") throw error;
      rows = [];
    }
  }
  const lastCleaning = lastCleaningFromTreatments(rows);
  try {
    const assessment = await loadLatestAssessment(db, record.id);
    return mapAssessment(assessment, lastCleaning);
  } catch (error) {
    if (error?.code !== "42P01") throw error;
    return emptyWellness(lastCleaning);
  }
}

async function findLinkedClinicalRecord(db, userId) {
  const result = await db.query(
    `SELECT id, linked_user_id
     FROM clinic_patient_records
     WHERE linked_user_id::text = $1
       AND COALESCE(is_archived, FALSE) = FALSE
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [String(userId)]
  );
  return result.rows[0] || null;
}

async function getPortalWellness(db, userId) {
  if (!userId) {
    return emptyWellness();
  }

  let record = null;
  try {
    record = await findLinkedClinicalRecord(db, userId);
  } catch (error) {
    if (error?.code !== "42P01") throw error;
    return emptyWellness();
  }

  if (!record) {
    return emptyWellness();
  }

  return getWellnessForClinicalRecord(db, { id: record.id });
}

async function syncPatientProfile(db, userId, { oralHealthScore, nextCheckup }) {
  if (!userId) return;
  await db.query(
    `INSERT INTO patient_portal_profiles (user_id, oral_health_score, next_checkup, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       oral_health_score = EXCLUDED.oral_health_score,
       next_checkup = EXCLUDED.next_checkup,
       updated_at = CURRENT_TIMESTAMP`,
    [String(userId), oralHealthScore, nextCheckup]
  );
}

async function saveAssessment(db, record, input, dentist) {
  if (!record?.id) {
    throw httpError(404, "Patient record not found.");
  }
  const dentistId = dentist?.id != null ? String(dentist.id) : "";
  if (!dentistId) {
    throw httpError(403, "Only authorized dentists may save a wellness assessment.");
  }

  const score = parseWellnessScore(input?.oralHealthScore ?? input?.wellnessScore ?? input?.score);
  const assessmentDate = isIsoDate(input?.assessmentDate) ? input.assessmentDate : null;
  if (!assessmentDate) {
    throw httpError(400, "Select a valid assessment date.");
  }
  const nextCheckup = isIsoDate(input?.nextCheckup) ? input.nextCheckup : null;
  if (!nextCheckup) {
    throw httpError(400, "Select the next recommended checkup date.");
  }
  const clinicalNotes =
    typeof input?.clinicalNotes === "string" ? input.clinicalNotes.trim().slice(0, 4000) : "";
  const patientUserId = record.linkedUserId || record.linked_user_id || null;

  let saved;
  try {
    const result = await db.query(
      `INSERT INTO dental_wellness_assessments (
         clinical_record_id,
         patient_user_id,
         assessment_date,
         wellness_score,
         clinical_notes,
         next_checkup,
         dentist_id,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (clinical_record_id) DO UPDATE SET
         patient_user_id = COALESCE(EXCLUDED.patient_user_id, dental_wellness_assessments.patient_user_id),
         assessment_date = EXCLUDED.assessment_date,
         wellness_score = EXCLUDED.wellness_score,
         clinical_notes = EXCLUDED.clinical_notes,
         next_checkup = EXCLUDED.next_checkup,
         dentist_id = EXCLUDED.dentist_id,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [record.id, patientUserId ? String(patientUserId) : null, assessmentDate, score, clinicalNotes || null, nextCheckup, dentistId]
    );
    saved = result.rows[0];
  } catch (error) {
    if (error?.code === "42P01") {
      throw httpError(503, "Wellness assessment tables are not available. Run npm run migrate:dental-wellness.");
    }
    throw error;
  }

  if (patientUserId) {
    try {
      await syncPatientProfile(db, patientUserId, {
        oralHealthScore: score,
        nextCheckup,
      });
    } catch (error) {
      if (error?.code !== "42P01" && error?.code !== "42703") {
        throw error;
      }
    }
  }

  const treatments = await loadTreatmentsForRecord(db, record.id).catch((error) => {
    if (error?.code === "42P01") return [];
    throw error;
  });
  return mapAssessment(saved, lastCleaningFromTreatments(treatments));
}

module.exports = {
  WELLNESS_SCORE_MAX,
  WELLNESS_SCORE_MIN,
  emptyWellness,
  getPortalWellness,
  getWellnessForClinicalRecord,
  isCompletedOralProphylaxis,
  lastCleaningFromTreatments,
  parseWellnessScore,
  saveAssessment,
};
