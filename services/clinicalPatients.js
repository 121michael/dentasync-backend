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
     LIMIT 50`,
    [recordId]
  );

  return {
    record: mapClinicalRecord(result.rows[0]),
    treatments: treatments.rows.map((row) => ({
      id: row.id,
      treatment: row.treatment,
      dentistName: row.dentist_name,
      clinicLocation: row.clinic_location,
      coverageStatus: row.coverage_status,
      status: row.status,
      treatmentDate: row.treatment_date,
      notes: row.notes || "",
      createdAt: row.created_at,
    })),
  };
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

  const result = await db.query(
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

  await db.query(
    `UPDATE clinic_patient_records
     SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
     WHERE id = $1`,
    [recordId, actor.id ? String(actor.id) : null]
  );

  return result.rows[0];
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
  createClinicalRecord,
  updateClinicalRecord,
  archiveClinicalRecord,
  addClinicalTreatment,
  linkClinicalRecordsToUser,
  mapClinicalRecord,
  isMissingRelation,
  stringValue,
  normalizeEmail,
  normalizePhone,
  isIsoDate,
};
