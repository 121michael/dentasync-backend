"use strict";

const crypto = require("crypto");

function stringValue(value, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeEmail(value) {
  const email = stringValue(value, 254)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizePhone(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const digits = String(value).replace(/\D/g, "");
  if (!digits) {
    return null;
  }
  return /^0\d{10}$/.test(digits) ? `63${digits.slice(1)}` : digits;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseMoneyAmount(value, fieldLabel) {
  if (value == null || value === "") {
    return 0;
  }
  const amount = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(amount) || amount < 0) {
    const error = new Error(`${fieldLabel} must be a valid non-negative amount.`);
    error.status = 400;
    throw error;
  }
  return Math.round(amount * 100) / 100;
}

function mapClinicalTreatment(row) {
  return {
    id: row.id,
    clinicalRecordId: row.clinical_record_id,
    treatment: row.treatment,
    dentistName: row.dentist_name,
    clinicLocation: row.clinic_location,
    coverageStatus: row.coverage_status,
    status: row.status,
    treatmentDate: row.treatment_date,
    notes: row.notes || "",
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    toothNumber: row.tooth_number || null,
    diagnosisNotes: row.diagnosis_notes || null,
    procedureDetails: row.procedure_details || null,
    amountCharged: row.amount_charged != null ? Number(row.amount_charged) : 0,
    amountPaid: row.amount_paid != null ? Number(row.amount_paid) : 0,
    appointmentId: row.appointment_id != null ? Number(row.appointment_id) : null,
    createdBy: row.created_by || null,
    createdByRole: row.created_by_role || null,
    updatedBy: row.updated_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function isMissingRelation(error) {
  return error?.code === "42P01";
}

function mapClinicalRecord(row, extras = {}) {
  const firstName = row.first_name || "";
  const lastName = row.last_name || "";
  return {
    id: row.id,
    recordCode: row.record_code,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    email: row.email || "",
    phone: row.phone || "",
    dateOfBirth: row.date_of_birth || null,
    gender: row.gender || "",
    address: row.address || "",
    notes: row.notes || "",
    linkedUserId: row.linked_user_id || null,
    staffVerificationStatus: row.staff_verification_status || "pending",
    staffVerifiedAt: row.staff_verified_at || null,
    staffVerifiedBy: row.staff_verified_by || null,
    createdBy: row.created_by || null,
    createdByRole: row.created_by_role || null,
    updatedBy: row.updated_by || null,
    archived: Boolean(row.is_archived),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lastTreatment: extras.lastTreatment ?? row.last_treatment ?? "",
    lastTreatmentDate: extras.lastTreatmentDate ?? row.last_treatment_date ?? null,
    age: extras.age ?? row.age ?? null,
  };
}

function generateRecordCode() {
  return `CPR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

async function listClinicalRecords(db, { search = null, includeArchived = false, limit = 100, offset = 0 } = {}) {
  const params = [];
  const clauses = [];
  if (!includeArchived) {
    clauses.push("COALESCE(record.is_archived, FALSE) = FALSE");
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(
      record.first_name ILIKE $${params.length}
      OR record.last_name ILIKE $${params.length}
      OR record.email ILIKE $${params.length}
      OR record.phone ILIKE $${params.length}
      OR record.record_code ILIKE $${params.length}
      OR record.id::text ILIKE $${params.length}
    )`);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit, offset);

  const result = await db.query(
    `SELECT
       record.*,
       (
         SELECT treatment.treatment
         FROM clinic_patient_treatments AS treatment
         WHERE treatment.clinical_record_id = record.id
         ORDER BY treatment.treatment_date DESC, treatment.id DESC
         LIMIT 1
       ) AS last_treatment,
       (
         SELECT treatment.treatment_date
         FROM clinic_patient_treatments AS treatment
         WHERE treatment.clinical_record_id = record.id
         ORDER BY treatment.treatment_date DESC, treatment.id DESC
         LIMIT 1
       ) AS last_treatment_date,
       CASE
         WHEN record.date_of_birth IS NULL THEN NULL
         ELSE DATE_PART('year', AGE(record.date_of_birth::timestamp))::int
       END AS age
     FROM clinic_patient_records AS record
     ${whereSql}
     ORDER BY record.updated_at DESC, record.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return result.rows.map((row) => mapClinicalRecord(row));
}

async function getClinicalRecord(db, recordId) {
  const result = await db.query(
    `SELECT
       record.*,
       CASE
         WHEN record.date_of_birth IS NULL THEN NULL
         ELSE DATE_PART('year', AGE(record.date_of_birth::timestamp))::int
       END AS age
     FROM clinic_patient_records AS record
     WHERE record.id = $1
     LIMIT 1`,
    [recordId]
  );
  if (!result.rows.length) {
    return null;
  }

  const treatments = await db.query(
    `SELECT *
     FROM clinic_patient_treatments
     WHERE clinical_record_id = $1
     ORDER BY treatment_date DESC, id DESC
     LIMIT 250`,
    [recordId]
  );

  return {
    record: mapClinicalRecord(result.rows[0]),
    treatments: treatments.rows.map(mapClinicalTreatment),
  };
}

async function listLinkedAppointments(db, record, { limit = 50 } = {}) {
  if (!record) return [];
  try {
    const result = await db.query(
      `SELECT
         appointment.id,
         appointment.user_id,
         appointment.service_name,
         appointment.dentist_id,
         appointment.appointment_date,
         appointment.appointment_time,
         appointment.clinic_location,
         appointment.status,
         appointment.notes,
         appointment.estimated_cost,
         appointment.created_at,
         CONCAT_WS(' ', dentist.first_name, dentist.last_name) AS dentist_name,
         CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
         patient.email AS patient_email,
         patient.phone AS patient_phone
       FROM patient_portal_appointments AS appointment
       LEFT JOIN users AS dentist ON dentist.id::text = appointment.dentist_id::text
       LEFT JOIN users AS patient ON patient.id::text = appointment.user_id::text
       WHERE (
         ($1::text IS NOT NULL AND appointment.user_id::text = $1)
         OR ($2::text IS NOT NULL AND LOWER(patient.email) = LOWER($2))
         OR ($3::text IS NOT NULL AND patient.phone = $3)
         OR ($2::text IS NOT NULL AND LOWER(COALESCE(appointment.notes, '')) LIKE '%' || LOWER($2) || '%')
       )
       ORDER BY appointment.appointment_date DESC, appointment.appointment_time DESC
       LIMIT $4`,
      [
        record.linkedUserId ? String(record.linkedUserId) : null,
        record.email || null,
        record.phone || null,
        limit,
      ]
    );
    return result.rows.map((row) => ({
      id: row.id,
      patientId: row.user_id,
      patientName: row.patient_name || "Patient",
      patientEmail: row.patient_email || null,
      patientPhone: row.patient_phone || null,
      treatment: row.service_name,
      dentistId: row.dentist_id,
      dentist: row.dentist_name
        ? `Dr. ${String(row.dentist_name).replace(/^Dr\.\s*/i, "")}`
        : null,
      date: row.appointment_date,
      time: row.appointment_time,
      location: row.clinic_location,
      status: row.status,
      notes: row.notes || "",
      estimatedCost: row.estimated_cost === undefined || row.estimated_cost === null
        ? undefined
        : Number(row.estimated_cost),
      createdAt: row.created_at,
    }));
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

function resolveNextAppointment(appointments = [], afterDate = null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const after = afterDate ? new Date(afterDate) : null;
  if (after && !Number.isNaN(after.getTime())) {
    after.setHours(0, 0, 0, 0);
  }

  const upcoming = appointments
    .filter((appointment) => {
      const status = String(appointment.status || "").toLowerCase();
      if (["cancelled", "completed", "no_show", "missed"].includes(status)) return false;
      const date = new Date(appointment.date);
      if (Number.isNaN(date.getTime())) return false;
      date.setHours(0, 0, 0, 0);
      if (after) return date > after;
      return date >= today;
    })
    .sort((a, b) => {
      const left = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (left !== 0) return left;
      return String(a.time || "").localeCompare(String(b.time || ""));
    });

  return upcoming[0] || null;
}

async function createClinicalRecord(db, input, actor = {}) {
  const firstName = stringValue(input.firstName, 80);
  const lastName = stringValue(input.lastName, 80);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const dateOfBirth = stringValue(input.dateOfBirth, 10);
  const gender = stringValue(input.gender, 40);
  const address = stringValue(input.address, 500);
  const notes = stringValue(input.notes, 2000);

  if (!firstName || !lastName) {
    const error = new Error("First name and last name are required.");
    error.status = 400;
    throw error;
  }
  if (dateOfBirth && !isIsoDate(dateOfBirth)) {
    const error = new Error("Provide a valid date of birth (YYYY-MM-DD).");
    error.status = 400;
    throw error;
  }

  let linkedUserId = null;
  if (email || phone) {
    const linked = await db.query(
      `SELECT id
       FROM users
       WHERE LOWER(role) = 'patient'
         AND COALESCE(is_archived, FALSE) = FALSE
         AND (
           ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
           OR ($2::text IS NOT NULL AND phone = $2)
         )
       LIMIT 1`,
      [email, phone]
    );
    linkedUserId = linked.rows[0]?.id || null;
  }

  const result = await db.query(
    `INSERT INTO clinic_patient_records (
       record_code, first_name, last_name, email, phone, date_of_birth, gender,
       address, notes, linked_user_id, created_by, created_by_role, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $11)
     RETURNING *`,
    [
      generateRecordCode(),
      firstName,
      lastName,
      email,
      phone,
      dateOfBirth,
      gender,
      address,
      notes,
      linkedUserId ? String(linkedUserId) : null,
      actor.id ? String(actor.id) : null,
      actor.role || null,
    ]
  );

  return mapClinicalRecord(result.rows[0]);
}

async function updateClinicalRecord(db, recordId, input, actor = {}) {
  const existing = await db.query(
    `SELECT id FROM clinic_patient_records WHERE id = $1 AND COALESCE(is_archived, FALSE) = FALSE LIMIT 1`,
    [recordId]
  );
  if (!existing.rows.length) {
    const error = new Error("Patient record not found.");
    error.status = 404;
    throw error;
  }

  const fields = [];
  const params = [];
  const mapping = {
    firstName: ["first_name", stringValue(input.firstName, 80)],
    lastName: ["last_name", stringValue(input.lastName, 80)],
    email: ["email", Object.prototype.hasOwnProperty.call(input, "email") ? normalizeEmail(input.email) : undefined],
    phone: ["phone", Object.prototype.hasOwnProperty.call(input, "phone") ? normalizePhone(input.phone) : undefined],
    dateOfBirth: ["date_of_birth", Object.prototype.hasOwnProperty.call(input, "dateOfBirth") ? stringValue(input.dateOfBirth, 10) : undefined],
    gender: ["gender", Object.prototype.hasOwnProperty.call(input, "gender") ? stringValue(input.gender, 40) : undefined],
    address: ["address", Object.prototype.hasOwnProperty.call(input, "address") ? stringValue(input.address, 500) : undefined],
    notes: ["notes", Object.prototype.hasOwnProperty.call(input, "notes") ? stringValue(input.notes, 2000) : undefined],
  };

  for (const [key, [column, value]] of Object.entries(mapping)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    if ((key === "firstName" || key === "lastName") && !value) {
      const error = new Error(`${key} cannot be empty.`);
      error.status = 400;
      throw error;
    }
    if (key === "dateOfBirth" && value && !isIsoDate(value)) {
      const error = new Error("Provide a valid date of birth (YYYY-MM-DD).");
      error.status = 400;
      throw error;
    }
    params.push(value);
    fields.push(`${column} = $${params.length}`);
  }

  if (!fields.length) {
    const error = new Error("Provide fields to update.");
    error.status = 400;
    throw error;
  }

  params.push(actor.id ? String(actor.id) : null);
  fields.push(`updated_by = $${params.length}`);
  fields.push("updated_at = CURRENT_TIMESTAMP");
  params.push(recordId);

  const result = await db.query(
    `UPDATE clinic_patient_records
     SET ${fields.join(", ")}
     WHERE id = $${params.length}
     RETURNING *`,
    params
  );
  return mapClinicalRecord(result.rows[0]);
}

async function archiveClinicalRecord(db, recordId, actor = {}) {
  const result = await db.query(
    `UPDATE clinic_patient_records
     SET is_archived = TRUE,
         archived_at = CURRENT_TIMESTAMP,
         archived_by = $2,
         updated_at = CURRENT_TIMESTAMP,
         updated_by = $2
     WHERE id = $1
       AND COALESCE(is_archived, FALSE) = FALSE
     RETURNING *`,
    [recordId, actor.id ? String(actor.id) : null]
  );
  if (!result.rows.length) {
    const error = new Error("Patient record not found.");
    error.status = 404;
    throw error;
  }
  return mapClinicalRecord(result.rows[0]);
}

async function addClinicalTreatment(db, recordId, input, actor = {}) {
  const treatment = stringValue(input.treatment, 200);
  if (!treatment) {
    const error = new Error("Treatment is required.");
    error.status = 400;
    throw error;
  }
  const treatmentDate = stringValue(input.treatmentDate, 10) || new Date().toISOString().slice(0, 10);
  if (!isIsoDate(treatmentDate)) {
    const error = new Error("Provide a valid treatment date (YYYY-MM-DD).");
    error.status = 400;
    throw error;
  }

  const existing = await db.query(
    `SELECT id FROM clinic_patient_records WHERE id = $1 AND COALESCE(is_archived, FALSE) = FALSE LIMIT 1`,
    [recordId]
  );
  if (!existing.rows.length) {
    const error = new Error("Patient record not found.");
    error.status = 404;
    throw error;
  }

  const durationMinutes =
    Number.isFinite(Number(input.durationMinutes)) && Number(input.durationMinutes) > 0
      ? Math.round(Number(input.durationMinutes))
      : null;
  const toothNumber = stringValue(input.toothNumber, 20);
  const diagnosisNotes = stringValue(input.diagnosisNotes, 2000);
  const procedureDetails = stringValue(input.procedureDetails, 2000);
  const amountCharged = parseMoneyAmount(input.amountCharged, "Amount Charged");
  const amountPaid = parseMoneyAmount(input.amountPaid, "Amount Paid");
  const appointmentId =
    Number.isSafeInteger(Number(input.appointmentId)) && Number(input.appointmentId) > 0
      ? Number(input.appointmentId)
      : null;

  let result;
  try {
    result = await db.query(
      `INSERT INTO clinic_patient_treatments (
         clinical_record_id, treatment, dentist_name, clinic_location, coverage_status,
         status, treatment_date, notes, duration_minutes, tooth_number, diagnosis_notes,
         procedure_details, amount_charged, amount_paid, appointment_id,
         created_by, created_by_role, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $16)
       RETURNING *`,
      [
        recordId,
        treatment,
        stringValue(input.dentistName, 160),
        stringValue(input.clinicLocation, 160) || "Amethyst Dental Clinic",
        stringValue(input.coverageStatus, 80),
        stringValue(input.status, 40) || "completed",
        treatmentDate,
        stringValue(input.notes, 2000),
        durationMinutes,
        toothNumber,
        diagnosisNotes,
        procedureDetails,
        amountCharged,
        amountPaid,
        appointmentId,
        actor.id ? String(actor.id) : null,
        actor.role || null,
      ]
    );
  } catch (error) {
    if (error?.code !== "42703") {
      throw error;
    }
    result = await db.query(
      `INSERT INTO clinic_patient_treatments (
         clinical_record_id, treatment, dentist_name, clinic_location, coverage_status,
         status, treatment_date, notes, created_by, created_by_role
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        recordId,
        treatment,
        stringValue(input.dentistName, 160),
        stringValue(input.clinicLocation, 160) || "Amethyst Dental Clinic",
        stringValue(input.coverageStatus, 80),
        stringValue(input.status, 40) || "completed",
        treatmentDate,
        stringValue(input.notes, 2000),
        actor.id ? String(actor.id) : null,
        actor.role || null,
      ]
    );
  }

  await db.query(
    `UPDATE clinic_patient_records
     SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
     WHERE id = $1`,
    [recordId, actor.id ? String(actor.id) : null]
  );

  return mapClinicalTreatment(result.rows[0]);
}

async function updateClinicalTreatment(db, recordId, treatmentId, input, actor = {}) {
  const existing = await db.query(
    `SELECT *
     FROM clinic_patient_treatments
     WHERE id = $1
       AND clinical_record_id = $2
     LIMIT 1`,
    [treatmentId, recordId]
  );
  if (!existing.rows.length) {
    const error = new Error("Treatment history record not found.");
    error.status = 404;
    throw error;
  }

  const treatment = stringValue(input.treatment, 200);
  if (!treatment) {
    const error = new Error("Procedure cannot be empty.");
    error.status = 400;
    throw error;
  }

  const treatmentDate = stringValue(input.treatmentDate, 10);
  if (!treatmentDate || !isIsoDate(treatmentDate)) {
    const error = new Error("Provide a valid treatment date (YYYY-MM-DD).");
    error.status = 400;
    throw error;
  }

  const amountCharged = parseMoneyAmount(input.amountCharged, "Amount Charged");
  const amountPaid = parseMoneyAmount(input.amountPaid, "Amount Paid");
  const actorId = actor.id ? String(actor.id) : null;

  let result;
  try {
    result = await db.query(
      `UPDATE clinic_patient_treatments
       SET treatment = $1,
           treatment_date = $2,
           amount_charged = $3,
           amount_paid = $4,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = $5
       WHERE id = $6
         AND clinical_record_id = $7
       RETURNING *`,
      [treatment, treatmentDate, amountCharged, amountPaid, actorId, treatmentId, recordId]
    );
  } catch (error) {
    if (error?.code === "42703") {
      const fallbackError = new Error(
        "Treatment history amounts are not available. Run npm run migrate:admin-dashboard-updates."
      );
      fallbackError.status = 503;
      throw fallbackError;
    }
    throw error;
  }

  await db.query(
    `UPDATE clinic_patient_records
     SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
     WHERE id = $1`,
    [recordId, actorId]
  );

  return mapClinicalTreatment(result.rows[0]);
}

async function verifyClinicalRecordIdentity(db, recordId, status, actor = {}) {
  const allowed = new Set(["pending", "verified", "rejected"]);
  const normalized = stringValue(status, 40)?.toLowerCase();
  if (!allowed.has(normalized)) {
    const error = new Error("Verification status must be pending, verified, or rejected.");
    error.status = 400;
    throw error;
  }

  const result = await db.query(
    `UPDATE clinic_patient_records
     SET staff_verification_status = $1,
         staff_verified_at = CASE WHEN $1 = 'verified' THEN CURRENT_TIMESTAMP ELSE NULL END,
         staff_verified_by = CASE WHEN $1 = 'verified' THEN $2 ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP,
         updated_by = $2
     WHERE id = $3
       AND COALESCE(is_archived, FALSE) = FALSE
     RETURNING *`,
    [normalized, actor.id ? String(actor.id) : null, recordId]
  );

  if (!result.rows.length) {
    const error = new Error("Patient record not found.");
    error.status = 404;
    throw error;
  }

  return mapClinicalRecord(result.rows[0]);
}

async function linkClinicalRecordsToUser(db, user) {
  if (!db || !user?.id) {
    return 0;
  }

  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : null;
  const phone = user.phone ? String(user.phone) : null;
  if (!email && !phone) {
    return 0;
  }

  try {
    const result = await db.query(
      `UPDATE clinic_patient_records
       SET linked_user_id = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE COALESCE(is_archived, FALSE) = FALSE
         AND (
           linked_user_id IS NULL
           OR linked_user_id = $1
         )
         AND (
           ($2::text IS NOT NULL AND LOWER(email) = $2)
           OR ($3::text IS NOT NULL AND phone = $3)
         )
       RETURNING id`,
      [String(user.id), email, phone]
    );
    return result.rows.length;
  } catch (error) {
    if (error?.code === "42P01") {
      return 0;
    }
    throw error;
  }
}

module.exports = {
  listClinicalRecords,
  getClinicalRecord,
  listLinkedAppointments,
  resolveNextAppointment,
  createClinicalRecord,
  updateClinicalRecord,
  archiveClinicalRecord,
  addClinicalTreatment,
  updateClinicalTreatment,
  mapClinicalTreatment,
  verifyClinicalRecordIdentity,
  linkClinicalRecordsToUser,
  mapClinicalRecord,
  isMissingRelation,
  stringValue,
  normalizeEmail,
  normalizePhone,
  isIsoDate,
  parseMoneyAmount,
};
