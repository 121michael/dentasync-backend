"use strict";

const crypto = require("crypto");
const dentalChartSync = require("./dentalChartSync");
const patientData = require("./patientData");

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

function formatAgeSex(age, gender) {
  const agePart = age != null && age !== "" ? String(age) : "—";
  const sexPart = gender ? String(gender) : "—";
  return `${agePart} / ${sexPart}`;
}

function normalizeAppointmentTime(value) {
  const raw = stringValue(value, 8);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    const error = new Error("Provide a valid appointment time (HH:MM).");
    error.status = 400;
    throw error;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    const error = new Error("Provide a valid appointment time (HH:MM).");
    error.status = 400;
    throw error;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function paymentFields(amountCharged, amountPaid) {
  const summary = patientData.paymentSummary(amountCharged, amountPaid);
  return { balance: summary.balance, paymentStatus: summary.paymentStatus };
}

function mapClinicalTreatment(row) {
  const diagnosis =
    row.diagnosis_notes ||
    row.diagnosisNotes ||
    row.notes ||
    null;
  return {
    id: row.id,
    clinicalRecordId: row.clinical_record_id,
    treatment: row.treatment,
    dentistName: row.dentist_name,
    clinicLocation: row.clinic_location,
    coverageStatus: row.coverage_status,
    status: row.status,
    treatmentDate: row.treatment_date,
    notes: "",
    diagnosis,
    diagnosisNotes: diagnosis,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    toothNumber: row.tooth_number || null,
    procedureDetails: row.procedure_details || null,
    amountCharged: row.amount_charged != null ? Number(row.amount_charged) : 0,
    amountPaid: row.amount_paid != null ? Number(row.amount_paid) : 0,
    ...paymentFields(row.amount_charged, row.amount_paid),
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
  const dateOfBirth = row.date_of_birth || null;
  const gender = row.gender || "";
  const age =
    extras.age ??
    row.age ??
    ageFromDateOfBirth(dateOfBirth) ??
    null;
  return {
    id: row.id,
    recordCode: row.record_code,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    email: row.email || "",
    phone: row.phone || "",
    dateOfBirth,
    gender,
    age,
    ageSex: formatAgeSex(age, gender),
    address: row.address || "",
    notes: row.notes || "",
    linkedUserId: row.linked_user_id || null,
    patientId: row.patient_id || null,
    patientCategory: row.patient_category || null,
    nextAppointmentDate: row.next_appointment_date || null,
    nextAppointmentTime: row.next_appointment_time || null,
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
    lastAmountPaid:
      extras.lastAmountPaid ??
      (row.last_amount_paid != null && row.last_amount_paid !== ""
        ? Number(row.last_amount_paid)
        : null),
  };
}

function generateRecordCode() {
  return `CPR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

async function withSavepoint(db, name, fn) {
  const savepoint = String(name || "sp").replace(/[^a-zA-Z0-9_]/g, "_");
  try {
    await db.query(`SAVEPOINT ${savepoint}`);
  } catch {
    // Pool connections / non-transactional callers have no SAVEPOINT support.
    return fn();
  }
  try {
    const result = await fn();
    try {
      await db.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch {
      // Ignore release failures after success.
    }
    return result;
  } catch (error) {
    try {
      await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      error.savepointRollbackError = rollbackError.message;
    }
    throw error;
  }
}

function ageFromDateOfBirth(value) {
  if (!value) return null;
  const dob =
    value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/**
 * Overlay account-linked basics from users + patient_portal_profiles.
 * Profile/account is the source of truth for Name, Sex, Age, Birthdate, Phone.
 */
async function enrichRecordsFromLinkedProfiles(db, records) {
  if (!Array.isArray(records) || !records.length) return records || [];
  const linkedIds = [
    ...new Set(
      records
        .map((record) => (record.linkedUserId ? String(record.linkedUserId) : null))
        .filter(Boolean)
    ),
  ];
  if (!linkedIds.length) {
    return records.map((record) => ({
      ...record,
      profileLocked: Boolean(record.linkedUserId),
      accountLinked: Boolean(record.linkedUserId),
    }));
  }

  let accountRows = [];
  try {
    const result = await db.query(
      `SELECT
         account.id::text AS user_id,
         account.first_name,
         account.last_name,
         account.email,
         account.phone,
         account.patient_id,
         account.patient_category AS user_patient_category,
         COALESCE(profile.date_of_birth, profile.birth_date) AS date_of_birth,
         profile.gender,
         profile.address,
         profile.patient_category AS profile_patient_category
       FROM users AS account
       LEFT JOIN patient_portal_profiles AS profile
         ON profile.user_id::text = account.id::text
       WHERE account.id::text = ANY($1::text[])`,
      [linkedIds]
    );
    accountRows = result.rows;
  } catch (error) {
    if (error?.code === "42703") {
      const result = await db.query(
        `SELECT
           account.id::text AS user_id,
           account.first_name,
           account.last_name,
           account.email,
           account.phone,
           profile.date_of_birth,
           profile.gender,
           profile.address
         FROM users AS account
         LEFT JOIN patient_portal_profiles AS profile
           ON profile.user_id::text = account.id::text
         WHERE account.id::text = ANY($1::text[])`,
        [linkedIds]
      );
      accountRows = result.rows;
    } else if (error?.code !== "42P01") {
      throw error;
    }
  }

  const byUserId = new Map(accountRows.map((row) => [String(row.user_id), row]));

  return records.map((record) => {
    if (!record.linkedUserId) {
      return {
        ...record,
        profileLocked: false,
        accountLinked: false,
      };
    }
    const account = byUserId.get(String(record.linkedUserId));
    if (!account) {
      return {
        ...record,
        profileLocked: true,
        accountLinked: true,
      };
    }

    const firstName = stringValue(account.first_name, 80) || record.firstName;
    const lastName = stringValue(account.last_name, 80) || record.lastName;
    const dateOfBirth = account.date_of_birth || record.dateOfBirth;
    const gender = stringValue(account.gender, 40) || record.gender;
    const age = ageFromDateOfBirth(dateOfBirth);

    return {
      ...record,
      firstName,
      lastName,
      fullName: `${firstName || ""} ${lastName || ""}`.trim() || record.fullName,
      email: normalizeEmail(account.email) || record.email,
      phone: normalizePhone(account.phone) || record.phone || "",
      dateOfBirth,
      gender: gender || "",
      age,
      ageSex: formatAgeSex(age, gender),
      address: stringValue(account.address, 500) || record.address,
      patientId: account.patient_id || record.patientId || null,
      patientCategory:
        account.user_patient_category ||
        account.profile_patient_category ||
        record.patientCategory ||
        null,
      profileLocked: true,
      accountLinked: true,
    };
  });
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
      OR record.linked_user_id ILIKE $${params.length}
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
       (
         SELECT treatment.amount_paid
         FROM clinic_patient_treatments AS treatment
         WHERE treatment.clinical_record_id = record.id
         ORDER BY treatment.treatment_date DESC, treatment.id DESC
         LIMIT 1
       ) AS last_amount_paid,
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

  const mapped = result.rows.map((row) => mapClinicalRecord(row));
  return enrichRecordsFromLinkedProfiles(db, mapped);
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

  const [record] = await enrichRecordsFromLinkedProfiles(db, [mapClinicalRecord(result.rows[0])]);

  return {
    record,
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

/**
 * Prefer staff-saved next appointment on the clinical record; fall back to linked appointments.
 */
function resolveClinicalNextAppointment(record, appointments = [], afterDate = null) {
  const storedDate =
    record?.nextAppointmentDate instanceof Date
      ? record.nextAppointmentDate.toISOString().slice(0, 10)
      : stringValue(record?.nextAppointmentDate, 10);
  if (storedDate && isIsoDate(storedDate)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const stored = new Date(`${storedDate}T00:00:00`);
    if (!Number.isNaN(stored.getTime())) {
      stored.setHours(0, 0, 0, 0);
      const after = afterDate ? new Date(afterDate) : null;
      if (after && !Number.isNaN(after.getTime())) {
        after.setHours(0, 0, 0, 0);
      }
      const isUpcoming = after ? stored > after : stored >= today;
      if (isUpcoming) {
        return {
          id: null,
          date: storedDate,
          time: record.nextAppointmentTime || null,
          treatment: "Follow-up",
          status: "scheduled",
          source: "clinical_record",
        };
      }
    }
  }
  const linked = resolveNextAppointment(appointments, afterDate);
  return linked ? { ...linked, source: "appointment" } : null;
}

/**
 * Staff-only payment update on a shared clinical treatment row.
 */
async function updateTreatmentAmountPaid(db, recordId, treatmentId, amountPaidRaw, actor = {}) {
  const amountPaid = parseMoneyAmount(amountPaidRaw, "Amount Paid");
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

  const actorId = actor.id ? String(actor.id) : null;
  let result;
  try {
    result = await db.query(
      `UPDATE clinic_patient_treatments
       SET amount_paid = $1,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = $2
       WHERE id = $3
         AND clinical_record_id = $4
       RETURNING *`,
      [amountPaid, actorId, treatmentId, recordId]
    );
  } catch (error) {
    if (error?.code === "42703") {
      const fallbackError = new Error(
        "Treatment payment amounts are not available. Run npm run migrate:admin-dashboard-updates."
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

async function createClinicalRecord(db, input, actor = {}) {
  const patientIds = require("./patientIds");
  const firstName = stringValue(input.firstName, 80);
  const lastName = stringValue(input.lastName, 80);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const dateOfBirth = stringValue(input.dateOfBirth, 10);
  const gender = patientData.normalizeSex(input.gender) || null;
  const address = stringValue(input.address, 500);
  const notes = stringValue(input.notes, 2000);
  const category = patientIds.normalizeCategory(input.patientCategory || input.category || "regular");

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
  let patientId = null;
  let patientCategory = category;
  if (email || phone) {
    try {
      const linked = await withSavepoint(db, "link_clinical_user", async () =>
        db.query(
          `SELECT id, patient_id, patient_category
           FROM users
           WHERE LOWER(role) = 'patient'
             AND COALESCE(is_archived, FALSE) = FALSE
             AND (
               ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
               OR ($2::text IS NOT NULL AND phone = $2)
             )
           LIMIT 1`,
          [email, phone]
        )
      );
      linkedUserId = linked.rows[0]?.id || null;
      patientId = linked.rows[0]?.patient_id || null;
      if (linked.rows[0]?.patient_category) {
        patientCategory = patientIds.normalizeCategory(linked.rows[0].patient_category);
      }
    } catch (error) {
      if (error?.code !== "42703") throw error;
      const linked = await db.query(
        `SELECT id
         FROM users
         WHERE LOWER(role) = 'patient'
           AND (
             ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
             OR ($2::text IS NOT NULL AND phone = $2)
           )
         LIMIT 1`,
        [email, phone]
      );
      linkedUserId = linked.rows[0]?.id || null;
    }
  }

  if (!patientId) {
    try {
      const issued = await patientIds.allocatePatientId(db, {
        category: patientCategory,
        createdAt: new Date(),
      });
      patientId = issued.patientId;
      patientCategory = issued.category;
    } catch (idError) {
      console.warn("Clinical patient ID allocation skipped:", idError.message);
    }
  }

  let result;
  try {
    result = await db.query(
      `INSERT INTO clinic_patient_records (
         record_code, first_name, last_name, email, phone, date_of_birth, gender,
         address, notes, linked_user_id, patient_id, patient_category,
         created_by, created_by_role, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $13)
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
        patientId,
        patientCategory,
        actor.id ? String(actor.id) : null,
        actor.role || null,
      ]
    );
  } catch (error) {
    if (error?.code !== "42703") throw error;
    result = await db.query(
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
  }

  return mapClinicalRecord(result.rows[0]);
}

async function syncLinkedProfileDemographics(db, record) {
  if (!record?.linkedUserId) return;
  const linkedUserId = String(record.linkedUserId);
  const dateOfBirth =
    record.dateOfBirth instanceof Date
      ? record.dateOfBirth.toISOString().slice(0, 10)
      : stringValue(record.dateOfBirth, 10);
  const gender = stringValue(record.gender, 40);

  try {
    await db.query(
      `UPDATE patient_portal_profiles
       SET date_of_birth = COALESCE($1::date, date_of_birth),
           birth_date = COALESCE($1::date, birth_date),
           gender = COALESCE($2, gender),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id::text = $3`,
      [dateOfBirth, gender, linkedUserId]
    );
  } catch (error) {
    if (error?.code === "42703") {
      await db
        .query(
          `UPDATE patient_portal_profiles
           SET date_of_birth = COALESCE($1::date, date_of_birth),
               gender = COALESCE($2, gender),
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id::text = $3`,
          [dateOfBirth, gender, linkedUserId]
        )
        .catch((inner) => {
          if (inner?.code !== "42P01" && inner?.code !== "42703") throw inner;
        });
      return;
    }
    if (error?.code !== "42P01") throw error;
  }
}

function deriveDateOfBirthFromAge(ageYears, existingDob = null) {
  const age = Number(ageYears);
  if (!Number.isInteger(age) || age < 0 || age > 120) {
    const error = new Error("Age must be a whole number between 0 and 120.");
    error.status = 400;
    throw error;
  }

  const today = new Date();
  let month = 0;
  let day = 1;
  if (existingDob) {
    const parsed = new Date(
      existingDob instanceof Date ? existingDob : `${String(existingDob).slice(0, 10)}T00:00:00`
    );
    if (!Number.isNaN(parsed.getTime())) {
      month = parsed.getUTCMonth();
      day = parsed.getUTCDate();
    }
  }
  const year = today.getFullYear() - age;
  const derived = new Date(Date.UTC(year, month, day));
  return derived.toISOString().slice(0, 10);
}

async function updateClinicalRecord(db, recordId, input, actor = {}) {
  const existing = await db.query(
    `SELECT *
     FROM clinic_patient_records
     WHERE id = $1
       AND COALESCE(is_archived, FALSE) = FALSE
     LIMIT 1`,
    [recordId]
  );
  if (!existing.rows.length) {
    const error = new Error("Patient record not found.");
    error.status = 404;
    throw error;
  }

  const current = existing.rows[0];
  const fields = [];
  const params = [];
  const payload = { ...input };

  const profileOwnedFields = [
    "firstName",
    "lastName",
    "email",
    "phone",
    "dateOfBirth",
    "age",
    "gender",
  ];
  if (current.linked_user_id) {
    const blocked = profileOwnedFields.filter((key) =>
      Object.prototype.hasOwnProperty.call(payload, key)
    );
    if (blocked.length) {
      const error = new Error(
        "Basic patient information comes from the patient account profile and cannot be edited here. Ask the patient to update their profile, or contact Admin."
      );
      error.status = 403;
      throw error;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "age") && !Object.prototype.hasOwnProperty.call(payload, "dateOfBirth")) {
    payload.dateOfBirth = deriveDateOfBirthFromAge(payload.age, current.date_of_birth);
  }

  const mapping = {
    firstName: ["first_name", stringValue(payload.firstName, 80)],
    lastName: ["last_name", stringValue(payload.lastName, 80)],
    email: [
      "email",
      Object.prototype.hasOwnProperty.call(payload, "email") ? normalizeEmail(payload.email) : undefined,
    ],
    phone: [
      "phone",
      Object.prototype.hasOwnProperty.call(payload, "phone") ? normalizePhone(payload.phone) : undefined,
    ],
    dateOfBirth: [
      "date_of_birth",
      Object.prototype.hasOwnProperty.call(payload, "dateOfBirth")
        ? stringValue(payload.dateOfBirth, 10)
        : undefined,
    ],
    gender: [
      "gender",
      Object.prototype.hasOwnProperty.call(payload, "gender") ? patientData.normalizeSex(payload.gender) || null : undefined,
    ],
    address: [
      "address",
      Object.prototype.hasOwnProperty.call(payload, "address") ? stringValue(payload.address, 500) : undefined,
    ],
    notes: [
      "notes",
      Object.prototype.hasOwnProperty.call(payload, "notes") ? stringValue(payload.notes, 2000) : undefined,
    ],
    nextAppointmentDate: [
      "next_appointment_date",
      Object.prototype.hasOwnProperty.call(payload, "nextAppointmentDate")
        ? stringValue(payload.nextAppointmentDate, 10)
        : undefined,
    ],
    nextAppointmentTime: [
      "next_appointment_time",
      Object.prototype.hasOwnProperty.call(payload, "nextAppointmentTime")
        ? normalizeAppointmentTime(payload.nextAppointmentTime)
        : undefined,
    ],
  };

  for (const [key, [column, value]] of Object.entries(mapping)) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
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
    if (key === "nextAppointmentDate" && value && !isIsoDate(value)) {
      const error = new Error("Provide a valid next appointment date (YYYY-MM-DD).");
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

  let result;
  try {
    result = await db.query(
      `UPDATE clinic_patient_records
       SET ${fields.join(", ")}
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
  } catch (error) {
    if (error?.code === "42703" && /next_appointment/.test(String(error.message || ""))) {
      const fallbackError = new Error(
        "Next appointment fields are not available. Run npm run migrate:clinical-next-appointment."
      );
      fallbackError.status = 503;
      throw fallbackError;
    }
    throw error;
  }

  const updatedRow = result.rows[0];
  let age = null;
  if (updatedRow.date_of_birth) {
    const dob =
      updatedRow.date_of_birth instanceof Date
        ? updatedRow.date_of_birth
        : new Date(`${String(updatedRow.date_of_birth).slice(0, 10)}T00:00:00`);
    if (!Number.isNaN(dob.getTime())) {
      const today = new Date();
      age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age -= 1;
      }
    }
  }

  const mapped = mapClinicalRecord(updatedRow, { age });

  if (
    Object.prototype.hasOwnProperty.call(payload, "dateOfBirth") ||
    Object.prototype.hasOwnProperty.call(payload, "gender") ||
    Object.prototype.hasOwnProperty.call(payload, "age")
  ) {
    await syncLinkedProfileDemographics(db, mapped);
  }

  return mapped;
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
  const treatment = patientData.canonicalTreatmentName(stringValue(input.treatment, 200));
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
  // Prefer Diagnosis (diagnosisNotes). Legacy `notes` is mapped into diagnosis when diagnosis is empty.
  const diagnosisNotes =
    stringValue(input.diagnosisNotes, 2000) || stringValue(input.diagnosis, 2000) || stringValue(input.notes, 2000);
  const procedureDetails = stringValue(input.procedureDetails, 2000);

  if (dentalChartSync.isToothSpecificTreatment(treatment)) {
    const teeth = dentalChartSync.parseAffectedTeeth(toothNumber);
    if (!teeth.length) {
      const error = new Error("Affected tooth is required for this treatment.");
      error.status = 400;
      throw error;
    }
  }
  const amountCharged = parseMoneyAmount(input.amountCharged, "Amount Charged");
  const amountPaid = parseMoneyAmount(input.amountPaid, "Amount Paid");
  const appointmentId =
    Number.isSafeInteger(Number(input.appointmentId)) && Number(input.appointmentId) > 0
      ? Number(input.appointmentId)
      : null;

  let result;
  try {
    result = await withSavepoint(db, "clinical_treatment_full", async () =>
      db.query(
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
          diagnosisNotes,
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
      )
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
        diagnosisNotes,
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

  const mapped = mapClinicalTreatment(result.rows[0]);
  try {
    await dentalChartSync.syncChartFromTreatment(db, recordId, result.rows[0], actor);
  } catch (syncError) {
    if (syncError.status) throw syncError;
    console.warn("Dental chart sync after treatment skipped:", syncError.message);
  }
  return mapped;
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

  const treatment = patientData.canonicalTreatmentName(stringValue(input.treatment, 200));
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

  const current = existing.rows[0];
  const provided = (key) => input[key] !== undefined;
  const amountCharged = provided("amountCharged")
    ? parseMoneyAmount(input.amountCharged, "Amount Charged")
    : Number(current.amount_charged || 0);
  // Amount paid stays staff-owned: keep the saved value unless it is explicitly sent.
  const amountPaid = provided("amountPaid")
    ? parseMoneyAmount(input.amountPaid, "Amount Paid")
    : Number(current.amount_paid || 0);
  const actorId = actor.id ? String(actor.id) : null;
  const nextStatus = stringValue(input.status, 40);
  const durationMinutes =
    Number.isFinite(Number(input.durationMinutes)) && Number(input.durationMinutes) > 0
      ? Math.round(Number(input.durationMinutes))
      : null;

  const editsTooth = provided("toothNumber") || provided("affectedTooth");
  const toothNumber = editsTooth
    ? stringValue(input.toothNumber ?? input.affectedTooth, 20)
    : current.tooth_number || null;
  const editsDiagnosis = provided("diagnosisNotes") || provided("diagnosis");
  const diagnosisNotes = editsDiagnosis
    ? stringValue(input.diagnosisNotes, 2000) || stringValue(input.diagnosis, 2000)
    : null;
  const editsProcedureDetails = provided("procedureDetails");
  const procedureDetails = editsProcedureDetails ? stringValue(input.procedureDetails, 2000) : null;

  if (dentalChartSync.isToothSpecificTreatment(treatment)) {
    if (!dentalChartSync.parseAffectedTeeth(toothNumber).length) {
      const error = new Error("Affected tooth is required for this treatment.");
      error.status = 400;
      throw error;
    }
  }

  const params = [];
  const assignments = [];
  const assign = (column, value) => {
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  };
  const assignKeep = (column, value) => {
    params.push(value);
    assignments.push(`${column} = COALESCE($${params.length}, ${column})`);
  };

  assign("treatment", treatment);
  assign("treatment_date", treatmentDate);
  assign("amount_charged", amountCharged);
  assign("amount_paid", amountPaid);
  assignKeep("status", nextStatus);
  assignKeep("duration_minutes", durationMinutes);
  if (editsTooth) assign("tooth_number", toothNumber);
  if (editsDiagnosis) {
    assign("diagnosis_notes", diagnosisNotes);
    assign("notes", diagnosisNotes);
  }
  if (editsProcedureDetails) assign("procedure_details", procedureDetails);
  assign("updated_by", actorId);
  assignments.push("updated_at = CURRENT_TIMESTAMP");
  params.push(treatmentId, recordId);

  let result;
  try {
    result = await db.query(
      `UPDATE clinic_patient_treatments
       SET ${assignments.join(", ")}
       WHERE id = $${params.length - 1}
         AND clinical_record_id = $${params.length}
       RETURNING *`,
      params
    );
  } catch (error) {
    if (error?.code !== "42703") {
      throw error;
    }
    try {
      result = await db.query(
        `UPDATE clinic_patient_treatments
         SET treatment = $1,
             treatment_date = $2,
             amount_charged = $3,
             amount_paid = $4,
             status = COALESCE($5, status),
             notes = COALESCE($6, notes),
             updated_at = CURRENT_TIMESTAMP,
             updated_by = $7
         WHERE id = $8
           AND clinical_record_id = $9
         RETURNING *`,
        [
          treatment,
          treatmentDate,
          amountCharged,
          amountPaid,
          nextStatus,
          diagnosisNotes,
          actorId,
          treatmentId,
          recordId,
        ]
      );
    } catch (innerError) {
      if (innerError?.code === "42703") {
        const fallbackError = new Error(
          "Treatment history amounts are not available. Run npm run migrate:admin-dashboard-updates."
        );
        fallbackError.status = 503;
        throw fallbackError;
      }
      throw innerError;
    }
  }

  await db.query(
    `UPDATE clinic_patient_records
     SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
     WHERE id = $1`,
    [recordId, actorId]
  );

  await rebuildChartAfterTreatmentChange(db, recordId, actor);

  return mapClinicalTreatment(result.rows[0]);
}

/** The chart is derived data: rebuild it from whatever treatments remain on the record. */
async function rebuildChartAfterTreatmentChange(db, recordId, actor = {}) {
  try {
    await dentalChartSync.rebuildChartFromTreatments(db, recordId, actor);
  } catch (syncError) {
    if (syncError.status) throw syncError;
    console.warn("Dental chart rebuild after treatment change skipped:", syncError.message);
  }
}

async function deleteClinicalTreatment(db, recordId, treatmentId, actor = {}) {
  const result = await db.query(
    `DELETE FROM clinic_patient_treatments
     WHERE id = $1
       AND clinical_record_id = $2
     RETURNING *`,
    [treatmentId, recordId]
  );
  if (!result.rows.length) {
    const error = new Error("Treatment history record not found.");
    error.status = 404;
    throw error;
  }

  const actorId = actor.id ? String(actor.id) : null;
  await db.query(
    `UPDATE clinic_patient_records
     SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
     WHERE id = $1`,
    [recordId, actorId]
  );

  await rebuildChartAfterTreatmentChange(db, recordId, actor);

  return mapClinicalTreatment(result.rows[0]);
}

/**
 * Finalize the latest in-progress clinical treatment for a portal user.
 * Used when the dentist presses Done on the live queue.
 */
async function completeInProgressTreatmentForUser(db, userId, options = {}, actor = {}) {
  const linkedUserId = String(userId || "").trim();
  if (!linkedUserId) {
    return null;
  }

  const appointmentId =
    Number.isSafeInteger(Number(options.appointmentId)) && Number(options.appointmentId) > 0
      ? Number(options.appointmentId)
      : null;
  const durationMinutes =
    Number.isFinite(Number(options.durationMinutes)) && Number(options.durationMinutes) > 0
      ? Math.round(Number(options.durationMinutes))
      : null;
  const actorId = actor.id ? String(actor.id) : null;

  const recordResult = await db
    .query(
      `SELECT id
       FROM clinic_patient_records
       WHERE linked_user_id = $1
         AND COALESCE(is_archived, FALSE) = FALSE
       ORDER BY updated_at DESC
       LIMIT 1`,
      [linkedUserId]
    )
    .catch((error) => {
      if (error?.code === "42P01") return { rows: [] };
      throw error;
    });
  if (!recordResult.rows.length) {
    return null;
  }

  const clinicalRecordId = recordResult.rows[0].id;

  let result;
  try {
    result = await db.query(
      `UPDATE clinic_patient_treatments
       SET status = 'completed',
           duration_minutes = COALESCE($1, duration_minutes),
           updated_at = CURRENT_TIMESTAMP,
           updated_by = $2
       WHERE id = (
         SELECT id
         FROM clinic_patient_treatments
         WHERE clinical_record_id = $3
           AND LOWER(COALESCE(status, '')) = 'in_progress'
           AND ($4::int IS NULL OR appointment_id = $4 OR appointment_id IS NULL)
         ORDER BY
           CASE WHEN appointment_id = $4 THEN 0 ELSE 1 END,
           id DESC
         LIMIT 1
       )
       RETURNING *`,
      [durationMinutes, actorId, clinicalRecordId, appointmentId]
    );
  } catch (error) {
    if (error?.code === "42703") {
      result = await db.query(
        `UPDATE clinic_patient_treatments
         SET status = 'completed',
             updated_at = CURRENT_TIMESTAMP,
             updated_by = $1
         WHERE id = (
           SELECT id
           FROM clinic_patient_treatments
           WHERE clinical_record_id = $2
             AND LOWER(COALESCE(status, '')) = 'in_progress'
           ORDER BY id DESC
           LIMIT 1
         )
         RETURNING *`,
        [actorId, clinicalRecordId]
      );
    } else if (error?.code === "42P01") {
      return null;
    } else {
      throw error;
    }
  }

  if (!result.rows.length) {
    return null;
  }

  await db.query(
    `UPDATE clinic_patient_records
     SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
     WHERE id = $1`,
    [clinicalRecordId, actorId]
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
           patient_id = COALESCE(clinic_patient_records.patient_id, $4),
           patient_category = COALESCE(clinic_patient_records.patient_category, $5),
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
      [
        String(user.id),
        email,
        phone,
        user.patient_id || user.patientId || null,
        user.patient_category || user.patientCategory || null,
      ]
    );
    return result.rows.length;
  } catch (error) {
    if (error?.code === "42703") {
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
      } catch (fallbackError) {
        if (fallbackError?.code === "42P01") return 0;
        throw fallbackError;
      }
    }
    if (error?.code === "42P01") {
      return 0;
    }
    throw error;
  }
}

async function findOrCreateClinicalRecordForUser(db, userId, actor = {}) {
  const linkedUserId = String(userId || "").trim();
  if (!linkedUserId) {
    const error = new Error("A patient user id is required to open a clinical record.");
    error.status = 400;
    throw error;
  }

  const existing = await db.query(
    `SELECT *
     FROM clinic_patient_records
     WHERE linked_user_id = $1
       AND COALESCE(is_archived, FALSE) = FALSE
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [linkedUserId]
  );
  if (existing.rows[0]) {
    return mapClinicalRecord(existing.rows[0]);
  }

  // users has name/contact fields; DOB/gender live on patient_portal_profiles.
  let user;
  try {
    const userResult = await withSavepoint(db, "load_user_with_profile", async () =>
      db.query(
        `SELECT account.id,
                account.first_name,
                account.last_name,
                account.email,
                account.phone,
                profile.date_of_birth,
                profile.gender
         FROM users AS account
         LEFT JOIN patient_portal_profiles AS profile
           ON profile.user_id::text = account.id::text
         WHERE account.id::text = $1
         LIMIT 1`,
        [linkedUserId]
      )
    );
    user = userResult.rows[0];
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") {
      throw error;
    }
    const fallback = await db.query(
      `SELECT id, first_name, last_name, email, phone
       FROM users
       WHERE id::text = $1
       LIMIT 1`,
      [linkedUserId]
    );
    user = fallback.rows[0];
  }

  if (!user) {
    const error = new Error("Patient account not found for this queue entry.");
    error.status = 404;
    throw error;
  }

  const firstName = stringValue(user.first_name, 80) || "Patient";
  const lastName = stringValue(user.last_name, 80) || linkedUserId;
  let dateOfBirth = null;
  if (user.date_of_birth instanceof Date && !Number.isNaN(user.date_of_birth.getTime())) {
    dateOfBirth = user.date_of_birth.toISOString().slice(0, 10);
  } else if (typeof user.date_of_birth === "string") {
    dateOfBirth = user.date_of_birth.slice(0, 10);
  }

  // Insert directly with linked_user_id to avoid createClinicalRecord's users.is_archived probe.
  const result = await db.query(
    `INSERT INTO clinic_patient_records (
       record_code, first_name, last_name, email, phone, date_of_birth, gender,
       notes, linked_user_id, created_by, created_by_role, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10)
     RETURNING *`,
    [
      generateRecordCode(),
      firstName,
      lastName,
      normalizeEmail(typeof user.email === "string" ? user.email : null),
      normalizePhone(user.phone == null ? null : String(user.phone)),
      dateOfBirth && isIsoDate(dateOfBirth) ? dateOfBirth : null,
      stringValue(typeof user.gender === "string" ? user.gender : null, 40),
      "Auto-created from dentist start-treatment queue flow.",
      linkedUserId,
      actor.id ? String(actor.id) : null,
      actor.role || null,
    ]
  );

  return mapClinicalRecord(result.rows[0]);
}

module.exports = {
  listClinicalRecords,
  getClinicalRecord,
  listLinkedAppointments,
  resolveNextAppointment,
  resolveClinicalNextAppointment,
  createClinicalRecord,
  updateClinicalRecord,
  archiveClinicalRecord,
  addClinicalTreatment,
  updateClinicalTreatment,
  deleteClinicalTreatment,
  updateTreatmentAmountPaid,
  completeInProgressTreatmentForUser,
  mapClinicalTreatment,
  verifyClinicalRecordIdentity,
  linkClinicalRecordsToUser,
  findOrCreateClinicalRecordForUser,
  mapClinicalRecord,
  formatAgeSex,
  enrichRecordsFromLinkedProfiles,
  isMissingRelation,
  stringValue,
  normalizeEmail,
  normalizePhone,
  isIsoDate,
  parseMoneyAmount,
  normalizeAppointmentTime,
  deriveDateOfBirthFromAge,
  ageFromDateOfBirth,
};
