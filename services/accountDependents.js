"use strict";

const patientData = require("./patientData");
const patientIds = require("./patientIds");
const { createClinicalRecord } = require("./clinicalPatients");
const { insertPatientNotification } = require("./patientPortalNotifications");
const { notifyActiveAdmins } = require("./adminNotifications");

const RELATIONSHIPS = new Set(["child", "spouse", "parent", "guardian", "other"]);
const CATEGORIES = new Set(["regular", "senior", "pediatric", "pwd"]);
const STATUSES = new Set(["pending", "approved", "rejected", "removed"]);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function stringValue(value, maxLength = 500) {
  if (typeof value === "number" && Number.isFinite(value)) {
    value = String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeRelationship(value) {
  const raw = stringValue(value, 40)?.toLowerCase();
  if (!raw) return null;
  if (RELATIONSHIPS.has(raw)) return raw;
  if (raw === "daughter" || raw === "son" || raw === "child") return "child";
  if (raw === "wife" || raw === "husband" || raw === "spouse") return "spouse";
  if (raw === "mother" || raw === "father" || raw === "parent") return "parent";
  return null;
}

function normalizeCategory(value) {
  const raw = stringValue(value, 40)?.toLowerCase();
  if (!raw) return "regular";
  if (raw === "senior_citizen" || raw === "senior") return "senior";
  if (raw === "pediatric_patient" || raw === "pediatric") return "pediatric";
  if (CATEGORIES.has(raw)) return raw;
  return "regular";
}

function eligibilityFromCategory(category, age) {
  if (category === "pwd") return "pwd";
  if (category === "senior") return "senior";
  if (category === "pediatric") {
    if (age != null && age < 3) return "toddler";
    return "child_under_12";
  }
  return "other_authorized";
}

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return patientData.normalizeIsoDate(value) || null;
}

function fullName(row) {
  return [row.first_name || row.firstName, row.middle_name || row.middleName, row.last_name || row.lastName]
    .map((part) => (part ? String(part).trim() : ""))
    .filter(Boolean)
    .join(" ");
}

function mapDependent(row) {
  if (!row) return null;
  const rawStatus = row.approval_status || row.approvalStatus;
  const inferredStatus = row.dependent_user_id ? "approved" : "pending";
  const status = String(rawStatus || inferredStatus).toLowerCase();
  const firstName = row.first_name || row.user_first_name || "";
  const middleName = row.middle_name || "";
  const lastName = row.last_name || row.user_last_name || "";
  const birthDate = isoDate(row.date_of_birth);
  return {
    id: row.id,
    guardianUserId: row.guardian_user_id != null ? String(row.guardian_user_id) : null,
    dependentUserId: row.dependent_user_id != null ? String(row.dependent_user_id) : "",
    firstName,
    middleName,
    lastName,
    fullName: fullName({ first_name: firstName, middle_name: middleName, last_name: lastName }) || "Dependent",
    dateOfBirth: birthDate,
    age: birthDate ? patientData.ageFromDateOfBirth(birthDate) : null,
    gender: row.gender || "",
    phone: row.phone || row.user_phone || "",
    relationship: row.relationship || "dependent",
    patientCategory: row.patient_category || "regular",
    eligibilityCategory: row.eligibility_category || null,
    approvalStatus: STATUSES.has(status) ? status : "pending",
    submittedAt: row.submitted_at || row.created_at,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
    rejectionReason: row.rejection_reason || null,
    removedAt: row.removed_at || row.removedAt || null,
    patientId: row.patient_id || null,
    email: row.user_email || "",
    accountHolderName: row.guardian_full_name || null,
    accountHolderEmail: row.guardian_email || null,
    accountHolderPatientId: row.guardian_patient_id || null,
  };
}

function parseSubmission(body = {}) {
  const firstName = stringValue(body.firstName || body.first_name, 80);
  const middleName = stringValue(body.middleName || body.middle_name, 80);
  const lastName = stringValue(body.lastName || body.last_name, 80);
  const dateOfBirth = isoDate(body.birthdate || body.dateOfBirth || body.date_of_birth);
  const gender = patientData.normalizeSex(body.sex || body.gender);
  const phone = stringValue(body.phone || body.phoneNumber, 40);
  const relationship = normalizeRelationship(body.relationship);
  const patientCategory = normalizeCategory(body.patientCategory || body.patient_category);
  const age = dateOfBirth ? patientData.ageFromDateOfBirth(dateOfBirth) : null;

  if (!firstName || !lastName) {
    throw httpError(400, "First name and last name are required.");
  }
  if (!dateOfBirth) {
    throw httpError(400, "Birthdate is required.");
  }
  if (!gender) {
    throw httpError(400, "Sex is required.");
  }
  if (!relationship) {
    throw httpError(400, "Select a relationship to the account holder (child, spouse, parent, or guardian).");
  }

  return {
    firstName,
    middleName,
    lastName,
    dateOfBirth,
    gender,
    phone: phone || null,
    relationship,
    patientCategory,
    eligibilityCategory: eligibilityFromCategory(patientCategory, age),
    age,
  };
}

const SELECT_DEPENDENT = `
  SELECT
    link.id,
    link.guardian_user_id,
    link.dependent_user_id,
    link.relationship,
    link.eligibility_category,
    link.first_name,
    link.middle_name,
    link.last_name,
    link.date_of_birth,
    link.gender,
    link.phone,
    link.patient_category,
    link.approval_status,
    link.submitted_at,
    link.created_at,
    link.reviewed_at,
    link.reviewed_by,
    link.rejection_reason,
    link.removed_at,
    link.removed_by,
    dependent.first_name AS user_first_name,
    dependent.last_name AS user_last_name,
    dependent.email AS user_email,
    dependent.phone AS user_phone,
    dependent.patient_id,
    CONCAT_WS(' ', guardian.first_name, guardian.last_name) AS guardian_full_name,
    guardian.email AS guardian_email,
    guardian.patient_id AS guardian_patient_id
  FROM patient_portal_dependents AS link
  LEFT JOIN users AS dependent ON dependent.id::text = link.dependent_user_id::text
  LEFT JOIN users AS guardian ON guardian.id::text = link.guardian_user_id::text
`;

const SELECT_DEPENDENT_NO_PATIENT_ID = `
  SELECT
    link.id,
    link.guardian_user_id,
    link.dependent_user_id,
    link.relationship,
    link.eligibility_category,
    link.first_name,
    link.middle_name,
    link.last_name,
    link.date_of_birth,
    link.gender,
    link.phone,
    link.patient_category,
    link.approval_status,
    link.submitted_at,
    link.created_at,
    link.reviewed_at,
    link.reviewed_by,
    link.rejection_reason,
    link.removed_at,
    link.removed_by,
    dependent.first_name AS user_first_name,
    dependent.last_name AS user_last_name,
    dependent.email AS user_email,
    dependent.phone AS user_phone,
    CONCAT_WS(' ', guardian.first_name, guardian.last_name) AS guardian_full_name,
    guardian.email AS guardian_email
  FROM patient_portal_dependents AS link
  LEFT JOIN users AS dependent ON dependent.id::text = link.dependent_user_id::text
  LEFT JOIN users AS guardian ON guardian.id::text = link.guardian_user_id::text
`;

const SELECT_DEPENDENT_LEGACY = `
  SELECT
    link.id,
    link.guardian_user_id,
    link.dependent_user_id,
    link.relationship,
    link.created_at,
    dependent.first_name AS user_first_name,
    dependent.last_name AS user_last_name,
    dependent.email AS user_email,
    dependent.phone AS user_phone
  FROM patient_portal_dependents AS link
  LEFT JOIN users AS dependent ON dependent.id::text = link.dependent_user_id::text
`;

let schemaReady = false;

async function ensureAccountDependentSchema(db) {
  if (schemaReady) return;
  const statements = [
    `ALTER TABLE patient_portal_dependents ALTER COLUMN dependent_user_id DROP NOT NULL`,
    `ALTER TABLE patient_portal_dependents
       ADD COLUMN IF NOT EXISTS eligibility_category TEXT,
       ADD COLUMN IF NOT EXISTS first_name TEXT,
       ADD COLUMN IF NOT EXISTS middle_name TEXT,
       ADD COLUMN IF NOT EXISTS last_name TEXT,
       ADD COLUMN IF NOT EXISTS date_of_birth DATE,
       ADD COLUMN IF NOT EXISTS gender TEXT,
       ADD COLUMN IF NOT EXISTS phone TEXT,
       ADD COLUMN IF NOT EXISTS patient_category TEXT,
       ADD COLUMN IF NOT EXISTS approval_status TEXT,
       ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
       ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
       ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS removed_by TEXT`,
    `UPDATE patient_portal_dependents
       SET approval_status = 'approved'
     WHERE dependent_user_id IS NOT NULL
       AND (approval_status IS NULL OR BTRIM(approval_status) = '')`,
    `UPDATE patient_portal_dependents
       SET approval_status = 'pending'
     WHERE dependent_user_id IS NULL
       AND (approval_status IS NULL OR BTRIM(approval_status) = '')`,
    `UPDATE patient_portal_dependents
       SET submitted_at = COALESCE(submitted_at, created_at, CURRENT_TIMESTAMP)
     WHERE submitted_at IS NULL`,
    `ALTER TABLE patient_portal_dependents ALTER COLUMN approval_status SET DEFAULT 'pending'`,
    `ALTER TABLE patient_portal_dependents ALTER COLUMN submitted_at SET DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE patient_portal_dependents
       DROP CONSTRAINT IF EXISTS patient_portal_dependents_approval_status_check`,
    `ALTER TABLE patient_portal_dependents
       ADD CONSTRAINT patient_portal_dependents_approval_status_check
       CHECK (LOWER(approval_status) IN ('pending', 'approved', 'rejected', 'removed'))`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_by_user_id TEXT`,
  ];
  for (const sql of statements) {
    try {
      await db.query(sql);
    } catch (error) {
      if (error?.code === "42P01") {
        throw error;
      }
      console.warn("Account dependents schema ensure skipped:", error.message);
    }
  }
  try {
    await db.query("SELECT approval_status, first_name, submitted_at, removed_at FROM patient_portal_dependents LIMIT 0");
    schemaReady = true;
  } catch (error) {
    if (error?.code === "42P01") {
      throw error;
    }
    schemaReady = false;
  }
}

async function queryDependentRows(db, { whereSql, legacyWhereSql, params = [], orderSql = "" }) {
  await ensureAccountDependentSchema(db);
  const attempts = [
    `${SELECT_DEPENDENT} ${whereSql} ${orderSql}`,
    `${SELECT_DEPENDENT_NO_PATIENT_ID} ${whereSql} ${orderSql}`,
    `${SELECT_DEPENDENT_LEGACY} ${legacyWhereSql || whereSql} ORDER BY link.created_at DESC`,
  ];
  let lastError = null;
  for (const sql of attempts) {
    try {
      return await db.query(sql, params);
    } catch (error) {
      if (error?.code !== "42703") {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

async function findDuplicate(db, guardianUserId, payload, excludeId = null) {
  const params = [
    String(guardianUserId),
    payload.firstName.toLowerCase(),
    payload.lastName.toLowerCase(),
    payload.dateOfBirth,
  ];
  let excludeClause = "";
  if (excludeId != null) {
    params.push(excludeId);
    excludeClause = ` AND link.id <> $${params.length}`;
  }
  const result = await db.query(
    `SELECT link.id
     FROM patient_portal_dependents AS link
     LEFT JOIN users AS dependent ON dependent.id::text = link.dependent_user_id::text
     WHERE link.guardian_user_id::text = $1
       AND LOWER(link.approval_status) IN ('pending', 'approved')
       AND link.removed_at IS NULL
       AND LOWER(TRIM(COALESCE(link.first_name, dependent.first_name, ''))) = $2
       AND LOWER(TRIM(COALESCE(link.last_name, dependent.last_name, ''))) = $3
       AND COALESCE(link.date_of_birth, NULL) = $4::date
       ${excludeClause}
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function listForGuardian(db, guardianUserId) {
  const result = await queryDependentRows(db, {
    whereSql:
      "WHERE link.guardian_user_id::text = $1 AND link.removed_at IS NULL AND LOWER(COALESCE(link.approval_status, 'pending')) <> 'removed'",
    legacyWhereSql: "WHERE link.guardian_user_id::text = $1",
    params: [String(guardianUserId)],
    orderSql: "ORDER BY COALESCE(link.submitted_at, link.created_at) DESC, link.id DESC",
  });
  return result.rows.map(mapDependent);
}

async function getForGuardian(db, guardianUserId, dependentId) {
  const result = await queryDependentRows(db, {
    whereSql:
      "WHERE link.id = $1 AND link.guardian_user_id::text = $2 AND link.removed_at IS NULL AND LOWER(COALESCE(link.approval_status, 'pending')) <> 'removed'",
    legacyWhereSql: "WHERE link.id = $1 AND link.guardian_user_id::text = $2",
    params: [dependentId, String(guardianUserId)],
    orderSql: "",
  });
  const dependent = mapDependent(result.rows[0]);
  if (!dependent) return null;
  dependent.upcomingAppointments = await listUpcomingAppointments(db, dependent.dependentUserId);
  return dependent;
}

function isRemovedDependent(row) {
  if (!row) return false;
  return Boolean(row.removedAt || row.removed_at) || String(row.approvalStatus || row.approval_status || "").toLowerCase() === "removed";
}

async function submitDependent(db, guardianUserId, body, { notifyAdmin } = {}) {
  await ensureAccountDependentSchema(db);
  const payload = parseSubmission(body);
  const duplicate = await findDuplicate(db, guardianUserId, payload);
  if (duplicate) {
    throw httpError(409, "A dependent with the same name and birthdate is already registered on this account.");
  }

  const result = await db.query(
    `INSERT INTO patient_portal_dependents (
       guardian_user_id, dependent_user_id, relationship, eligibility_category,
       first_name, middle_name, last_name, date_of_birth, gender, phone,
       patient_category, approval_status, submitted_at
     ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', CURRENT_TIMESTAMP)
     RETURNING id, guardian_user_id, relationship, eligibility_category, first_name, middle_name,
               last_name, date_of_birth, gender, phone, patient_category, approval_status,
               submitted_at, created_at`,
    [
      String(guardianUserId),
      payload.relationship,
      payload.eligibilityCategory,
      payload.firstName,
      payload.middleName,
      payload.lastName,
      payload.dateOfBirth,
      payload.gender,
      payload.phone,
      payload.patientCategory,
    ]
  );

  const dependent = mapDependent(result.rows[0]);
  const notify = notifyAdmin || ((notification) => notifyActiveAdmins(db, notification));
  await notify({
    type: "dependent",
    title: "Dependent registration pending",
    body: `${dependent.fullName} was submitted as a ${dependent.relationship} and is awaiting Admin approval.`,
    entityType: "dependent",
    entityId: String(dependent.id),
  });

  return dependent;
}

async function listPendingForAdmin(db) {
  const result = await queryDependentRows(db, {
    whereSql:
      "WHERE LOWER(COALESCE(link.approval_status, 'pending')) = 'pending' AND link.removed_at IS NULL",
    legacyWhereSql: "WHERE LOWER(COALESCE(link.approval_status, 'pending')) = 'pending'",
    params: [],
    orderSql: "ORDER BY COALESCE(link.submitted_at, link.created_at) DESC, link.id DESC",
  });
  return result.rows.map(mapDependent);
}

async function listReviewedForAdmin(db) {
  const result = await queryDependentRows(db, {
    whereSql:
      "WHERE LOWER(COALESCE(link.approval_status, '')) IN ('approved', 'rejected') AND link.removed_at IS NULL",
    legacyWhereSql: "WHERE LOWER(COALESCE(link.approval_status, '')) IN ('approved', 'rejected')",
    params: [],
    orderSql: "ORDER BY COALESCE(link.reviewed_at, link.submitted_at, link.created_at) DESC",
  });
  return result.rows.map(mapDependent);
}

async function getForAdmin(db, dependentId) {
  const result = await queryDependentRows(db, {
    whereSql: "WHERE link.id = $1",
    params: [dependentId],
    orderSql: "",
  });
  return mapDependent(result.rows[0]);
}

async function seedManagedProfile(db, userId, payload) {
  try {
    await db.query(
      `INSERT INTO patient_portal_profiles (
         user_id, date_of_birth, birth_date, gender, patient_category, updated_at
       ) VALUES ($1, $2, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE
         SET date_of_birth = EXCLUDED.date_of_birth,
             birth_date = EXCLUDED.birth_date,
             gender = EXCLUDED.gender,
             patient_category = COALESCE(patient_portal_profiles.patient_category, EXCLUDED.patient_category),
             updated_at = CURRENT_TIMESTAMP`,
      [String(userId), payload.dateOfBirth, payload.gender, payload.patientCategory]
    );
  } catch (error) {
    if (error?.code === "42703") {
      await db.query(
        `INSERT INTO patient_portal_profiles (user_id, date_of_birth, gender)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET date_of_birth = EXCLUDED.date_of_birth,
               gender = EXCLUDED.gender,
               updated_at = CURRENT_TIMESTAMP`,
        [String(userId), payload.dateOfBirth, payload.gender]
      );
      return;
    }
    if (error?.code !== "42P01") throw error;
  }
}

async function approveDependent(db, dependentId, adminUser, { notifyPatient } = {}) {
  const existing = await getForAdmin(db, dependentId);
  if (!existing) {
    throw httpError(404, "Dependent request was not found.");
  }
  if (isRemovedDependent(existing)) {
    throw httpError(409, "This dependent was removed by the account holder and cannot be approved.");
  }
  if (existing.approvalStatus === "approved") {
    return existing;
  }
  if (existing.approvalStatus === "rejected") {
    throw httpError(409, "This dependent request was already rejected.");
  }

  const createdAt = existing.submittedAt || new Date();
  const syntheticEmail = `dependent.${existing.id}.${existing.guardianUserId}@managed.invalid`;
  const firstName = [existing.firstName, existing.middleName].filter(Boolean).join(" ").trim() || existing.firstName;

  let userRow;
  try {
    const inserted = await db.query(
      `INSERT INTO users (
         first_name, last_name, email, phone, password_hash, role, is_verified, status, managed_by_user_id
       ) VALUES ($1, $2, $3, $4, '!', 'patient', TRUE, 'Active', $5)
       RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at, managed_by_user_id`,
      [firstName, existing.lastName, syntheticEmail, `managed.${existing.id}`, String(existing.guardianUserId)]
    );
    userRow = inserted.rows[0];
  } catch (error) {
    if (error?.code === "42703") {
      const inserted = await db.query(
        `INSERT INTO users (
           first_name, last_name, email, phone, password_hash, role, is_verified, status
         ) VALUES ($1, $2, $3, $4, '!', 'patient', TRUE, 'Active')
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        [firstName, existing.lastName, syntheticEmail, `managed.${existing.id}`]
      );
      userRow = inserted.rows[0];
    } else {
      throw error;
    }
  }

  let issuedPatientId = null;
  try {
    const issued = await patientIds.allocatePatientId(db, {
      category: existing.patientCategory,
      createdAt,
    });
    issuedPatientId = issued.patientId;
    await db.query(
      `UPDATE users
       SET patient_id = COALESCE(patient_id, $1),
           patient_category = COALESCE(patient_category, $2)
       WHERE id = $3`,
      [issued.patientId, issued.category, userRow.id]
    );
  } catch (idError) {
    if (idError?.code !== "42703") {
      console.warn("Dependent Patient ID allocation skipped:", idError.message);
    }
  }

  await seedManagedProfile(db, userRow.id, existing);

  try {
    await createClinicalRecord(
      db,
      {
        firstName: existing.firstName,
        lastName: existing.lastName,
        email: syntheticEmail,
        phone: null,
        dateOfBirth: existing.dateOfBirth,
        gender: existing.gender,
        patientCategory: existing.patientCategory,
        notes: `Dependent of account holder ${existing.accountHolderName || existing.guardianUserId}.`,
      },
      { id: adminUser?.id, role: "admin" }
    );
  } catch (clinicalError) {
    console.warn("Dependent clinical record create skipped:", clinicalError.message);
  }

  const updated = await db.query(
    `UPDATE patient_portal_dependents
     SET dependent_user_id = $2,
         approval_status = 'approved',
         reviewed_at = CURRENT_TIMESTAMP,
         reviewed_by = $3,
         rejection_reason = NULL
     WHERE id = $1
       AND LOWER(approval_status) = 'pending'
     RETURNING id`,
    [existing.id, String(userRow.id), adminUser?.id != null ? String(adminUser.id) : null]
  );
  if (!updated.rows.length) {
    throw httpError(409, "This dependent request is no longer pending.");
  }

  const notify = notifyPatient || ((payload) => insertPatientNotification(db, payload));
  await notify({
    userId: existing.guardianUserId,
    type: "dependent",
    title: "Dependent approved",
    body: `${existing.fullName} is now an approved dependent on your account${
      issuedPatientId ? ` (Patient ID ${issuedPatientId})` : ""
    }.`,
    entityType: "dependent",
    entityId: String(existing.id),
  });

  return getForAdmin(db, existing.id);
}

async function rejectDependent(db, dependentId, adminUser, { confirmed, reason, notifyPatient } = {}) {
  if (!confirmed) {
    throw httpError(400, "Confirm rejection before declining a dependent request.");
  }
  const existing = await getForAdmin(db, dependentId);
  if (!existing) {
    throw httpError(404, "Dependent request was not found.");
  }
  if (existing.approvalStatus === "rejected") {
    return existing;
  }
  if (existing.approvalStatus === "approved") {
    throw httpError(409, "An approved dependent cannot be rejected from this workflow.");
  }

  const updated = await db.query(
    `UPDATE patient_portal_dependents
     SET approval_status = 'rejected',
         reviewed_at = CURRENT_TIMESTAMP,
         reviewed_by = $2,
         rejection_reason = $3
     WHERE id = $1
       AND LOWER(approval_status) = 'pending'
     RETURNING id`,
    [
      existing.id,
      adminUser?.id != null ? String(adminUser.id) : null,
      stringValue(reason, 500),
    ]
  );
  if (!updated.rows.length) {
    throw httpError(409, "This dependent request is no longer pending.");
  }

  const notify = notifyPatient || ((payload) => insertPatientNotification(db, payload));
  await notify({
    userId: existing.guardianUserId,
    type: "dependent",
    title: "Dependent request declined",
    body: `${existing.fullName}'s dependent registration was not approved.`,
    entityType: "dependent",
    entityId: String(existing.id),
  });

  return getForAdmin(db, existing.id);
}

async function listUpcomingAppointments(db, userId) {
  if (!userId) return [];
  try {
    const result = await db.query(
      `SELECT id, service_name, appointment_date, appointment_time, status
       FROM patient_portal_appointments
       WHERE user_id::text = $1
         AND status IN ('pending', 'confirmed')
         AND appointment_date >= CURRENT_DATE
       ORDER BY appointment_date ASC, appointment_time ASC`,
      [String(userId)]
    );
    return result.rows.map((row) => ({
      id: row.id,
      serviceName: row.service_name,
      appointmentDate: row.appointment_date,
      appointmentTime: row.appointment_time,
      status: row.status,
    }));
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

async function cancelUpcomingAppointments(db, userId) {
  if (!userId) return [];
  try {
    const result = await db.query(
      `UPDATE patient_portal_appointments
       SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE user_id::text = $1
         AND status IN ('pending', 'confirmed')
         AND appointment_date >= CURRENT_DATE
       RETURNING id, service_name, appointment_date, appointment_time`,
      [String(userId)]
    );
    return result.rows;
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

async function removeDependent(db, guardianUserId, dependentId, { confirmed } = {}) {
  if (!confirmed) {
    throw httpError(400, "Confirm deletion before removing this dependent.");
  }
  const guardianId = String(guardianUserId);
  const owned = await queryDependentRows(db, {
    whereSql: "WHERE link.id = $1 AND link.guardian_user_id::text = $2",
    legacyWhereSql: "WHERE link.id = $1 AND link.guardian_user_id::text = $2",
    params: [dependentId, guardianId],
    orderSql: "",
  });
  const existing = mapDependent(owned.rows[0]);
  if (!existing) {
    throw httpError(404, "Dependent was not found on this account.");
  }
  if (existing.dependentUserId && existing.dependentUserId === guardianId) {
    throw httpError(400, "You cannot delete the primary account holder.");
  }
  if (isRemovedDependent(existing)) {
    throw httpError(409, "This dependent has already been removed.");
  }

  const upcomingAppointments = await listUpcomingAppointments(db, existing.dependentUserId);
  const cancelledAppointments = await cancelUpcomingAppointments(db, existing.dependentUserId);

  let updated;
  try {
    updated = await db.query(
      `UPDATE patient_portal_dependents
       SET approval_status = 'removed',
           removed_at = CURRENT_TIMESTAMP,
           removed_by = $3
       WHERE id = $1
         AND guardian_user_id::text = $2
         AND removed_at IS NULL
         AND LOWER(COALESCE(approval_status, '')) <> 'removed'
       RETURNING id`,
      [existing.id, guardianId, guardianId]
    );
  } catch (error) {
    if (error?.code !== "42703" && error?.code !== "23514") throw error;
    updated = await db.query(
      `UPDATE patient_portal_dependents
       SET approval_status = CASE
             WHEN LOWER(COALESCE(approval_status, 'pending')) = 'pending' THEN 'rejected'
             ELSE approval_status
           END,
           rejection_reason = COALESCE(rejection_reason, 'Removed by account holder')
       WHERE id = $1
         AND guardian_user_id::text = $2
       RETURNING id`,
      [existing.id, guardianId]
    );
  }
  if (!updated.rows.length) {
    throw httpError(409, "This dependent could not be removed.");
  }

  return {
    dependent: {
      ...existing,
      approvalStatus: "removed",
      removedAt: new Date().toISOString(),
    },
    cancelledAppointments: cancelledAppointments.length,
    upcomingAppointments,
  };
}

function isApprovedBookingTarget(row) {
  if (!row) return false;
  if (isRemovedDependent(row)) return false;
  const status = String(row.approval_status || row.approvalStatus || "").toLowerCase();
  return status === "approved" && Boolean(row.dependent_user_id || row.dependentUserId);
}

module.exports = {
  RELATIONSHIPS,
  parseSubmission,
  mapDependent,
  listForGuardian,
  getForGuardian,
  submitDependent,
  listPendingForAdmin,
  listReviewedForAdmin,
  getForAdmin,
  approveDependent,
  rejectDependent,
  removeDependent,
  listUpcomingAppointments,
  isApprovedBookingTarget,
  httpError,
};
