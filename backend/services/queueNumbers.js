"use strict";

const { CATEGORY_PREFIX, PREFIX_CATEGORY, parseCanonicalPatientId } = require("./patientIds");

const QUEUE_TOKEN_PATTERN = /^([ASPW])-(\d{3})$/;

function clinicTimezone() {
  return process.env.CLINIC_TIMEZONE || "Asia/Manila";
}

function formatQueueNumber(prefix, sequence) {
  const letter = String(prefix || "").trim().toUpperCase();
  const seq = String(Math.max(1, Number(sequence) || 1)).padStart(3, "0");
  return `${letter}-${seq}`;
}

function parseQueueNumber(token) {
  const match = String(token || "").trim().toUpperCase().match(QUEUE_TOKEN_PATTERN);
  if (!match) return null;
  return { prefix: match[1], sequence: Number(match[2]) };
}

function parseKnownCategory(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (raw === "a" || raw === "regular" || raw === "regular_patient") return "regular";
  if (raw === "s" || raw === "senior" || raw === "senior_citizen") return "senior";
  if (raw === "p" || raw === "pediatric" || raw === "pediatric_patient" || raw === "child") {
    return "pediatric";
  }
  if (raw === "w" || raw === "pwd" || raw === "person_with_disability" || raw === "disability") {
    return "pwd";
  }
  return null;
}

function prefixFromPatientRecord({ patientCategory, clinicPatientId } = {}) {
  const known = parseKnownCategory(patientCategory);
  if (known) return CATEGORY_PREFIX[known];
  const canonical = parseCanonicalPatientId(clinicPatientId);
  if (canonical?.prefix) return canonical.prefix;
  const first = String(clinicPatientId || "")
    .trim()
    .charAt(0)
    .toUpperCase();
  if (PREFIX_CATEGORY[first]) return first;
  return null;
}

function missingCategoryError() {
  const error = new Error(
    "This patient has no valid category (Regular, Senior, Pediatric, or PWD). Update the patient record before check-in."
  );
  error.status = 400;
  error.code = "PATIENT_CATEGORY_REQUIRED";
  return error;
}

async function clinicDateYmd(client) {
  const tz = clinicTimezone();
  const result = await client.query(
    `SELECT (CURRENT_TIMESTAMP AT TIME ZONE $1)::date::text AS clinic_date`,
    [tz]
  );
  return result.rows[0]?.clinic_date || new Date().toISOString().slice(0, 10);
}

async function nextSequenceFromExistingTokens(client, prefix, clinicDate) {
  const tz = clinicTimezone();
  const result = await client.query(
    `SELECT token
     FROM patient_portal_queue_entries
     WHERE token LIKE $1
       AND (checked_in_at AT TIME ZONE $2)::date = $3::date`,
    [`${prefix}-___`, tz, clinicDate]
  );
  let max = 0;
  for (const row of result.rows) {
    const parsed = parseQueueNumber(row.token);
    if (parsed?.prefix === prefix) {
      max = Math.max(max, parsed.sequence);
    }
  }
  return max + 1;
}

async function nextDailySequence(client, prefix, clinicDate) {
  try {
    const result = await client.query(
      `INSERT INTO clinic_daily_queue_counters (clinic_date, prefix, last_sequence)
       VALUES ($1::date, $2, 1)
       ON CONFLICT (clinic_date, prefix)
       DO UPDATE SET last_sequence = clinic_daily_queue_counters.last_sequence + 1
       RETURNING last_sequence`,
      [clinicDate, prefix]
    );
    return Number(result.rows[0].last_sequence);
  } catch (error) {
    if (error.code !== "42P01" && error.code !== "42703") {
      throw error;
    }
    return nextSequenceFromExistingTokens(client, prefix, clinicDate);
  }
}

async function allocateDailyQueueNumber(client, { patientCategory, clinicPatientId } = {}) {
  const prefix = prefixFromPatientRecord({ patientCategory, clinicPatientId });
  if (!prefix) {
    throw missingCategoryError();
  }
  const clinicDate = await clinicDateYmd(client);
  const sequence = await nextDailySequence(client, prefix, clinicDate);
  return formatQueueNumber(prefix, sequence);
}

module.exports = {
  QUEUE_TOKEN_PATTERN,
  clinicTimezone,
  formatQueueNumber,
  parseQueueNumber,
  parseKnownCategory,
  prefixFromPatientRecord,
  missingCategoryError,
  clinicDateYmd,
  nextDailySequence,
  allocateDailyQueueNumber,
};
