"use strict";

const HMO_VERIFICATION_STATUSES = new Set([
  "pending_verification",
  "verified",
  "rejected",
  "not_applicable",
]);

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function isMissingSchema(error) {
  return error?.code === "42P01" || error?.code === "42703";
}

async function ensurePatientHmoSchema(db) {
  await db.query(`
    ALTER TABLE clinic_patient_records
      ADD COLUMN IF NOT EXISTS hmo_provider TEXT,
      ADD COLUMN IF NOT EXISTS hmo_member_number TEXT,
      ADD COLUMN IF NOT EXISTS hmo_verification_status TEXT NOT NULL DEFAULT 'not_applicable'
  `);
  await db.query(`
    ALTER TABLE patient_portal_profiles
      ADD COLUMN IF NOT EXISTS hmo_verification_status TEXT NOT NULL DEFAULT 'not_applicable'
  `);
  await db.query(`
    ALTER TABLE patient_portal_appointments
      ADD COLUMN IF NOT EXISTS hmo_verification_status TEXT NOT NULL DEFAULT 'not_applicable'
  `);
}

function buildHmoSnapshot({
  recordStatus = null,
  recordProvider = null,
  recordMember = null,
  profile = null,
  appointment = null,
} = {}) {
  const profileStatus = profile?.hmo_status || profile?.hmoStatus || null;
  const enrolled = Boolean(profileStatus && String(profileStatus).toLowerCase() !== "not_enrolled");
  const coverageIsHmo = String(appointment?.coverage_type || appointment?.coverageType || "").toLowerCase() === "hmo";
  const provider = firstNonEmpty(
    recordProvider,
    profile?.hmo_provider,
    profile?.hmoProvider,
    appointment?.hmo_provider,
    appointment?.hmoProvider
  );
  const memberNumber = firstNonEmpty(
    recordMember,
    profile?.hmo_member_number,
    profile?.hmoMemberNumber,
    appointment?.hmo_member_number,
    appointment?.hmoMemberNumber
  );
  const hasHmoOnFile = Boolean(provider || memberNumber || enrolled || coverageIsHmo);
  const stored = firstNonEmpty(
    recordStatus,
    profile?.hmo_verification_status,
    profile?.hmoVerificationStatus,
    appointment?.hmo_verification_status,
    appointment?.hmoVerificationStatus
  );
  let hmoVerificationStatus = stored || "not_applicable";
  if (!HMO_VERIFICATION_STATUSES.has(hmoVerificationStatus)) {
    hmoVerificationStatus = "not_applicable";
  }
  if (!hasHmoOnFile) {
    hmoVerificationStatus = "not_applicable";
  } else if (!stored || stored === "not_applicable") {
    hmoVerificationStatus = "pending_verification";
  }

  return {
    hasHmoOnFile,
    hmoProvider: provider,
    hmoMemberNumber: memberNumber,
    hmoVerificationStatus,
    hmoVerificationDisplay: hasHmoOnFile ? hmoVerificationStatus : "no_hmo_on_file",
  };
}

async function loadHmoSnapshot(db, { record, branchId = null } = {}) {
  if (!record) {
    return buildHmoSnapshot();
  }

  let profile = null;
  let appointment = null;
  const linkedUserId = record.linkedUserId || record.linked_user_id || null;

  if (linkedUserId) {
    try {
      const profileResult = await db.query(
        `SELECT hmo_provider, hmo_member_number, hmo_status, hmo_verification_status
         FROM patient_portal_profiles
         WHERE user_id::text = $1
         LIMIT 1`,
        [String(linkedUserId)]
      );
      profile = profileResult.rows[0] || null;
    } catch (error) {
      if (!isMissingSchema(error)) throw error;
    }

    try {
      const params = [String(linkedUserId)];
      let branchSql = "";
      if (branchId) {
        params.push(branchId);
        branchSql = ` AND appointment.branch_id = $${params.length}`;
      }
      const appointmentResult = await db.query(
        `SELECT coverage_type, hmo_provider, hmo_member_number, hmo_verification_status
         FROM patient_portal_appointments AS appointment
         WHERE appointment.user_id::text = $1
           AND appointment.coverage_type = 'hmo'
           ${branchSql}
         ORDER BY
           CASE appointment.hmo_verification_status
             WHEN 'verified' THEN 0
             WHEN 'pending_verification' THEN 1
             WHEN 'rejected' THEN 2
             ELSE 3
           END,
           appointment.updated_at DESC NULLS LAST,
           appointment.id DESC
         LIMIT 1`,
        params
      );
      appointment = appointmentResult.rows[0] || null;
    } catch (error) {
      if (!isMissingSchema(error)) throw error;
    }
  }

  return buildHmoSnapshot({
    recordStatus: record.hmoVerificationStatus || record.hmo_verification_status,
    recordProvider: record.hmoProvider || record.hmo_provider,
    recordMember: record.hmoMemberNumber || record.hmo_member_number,
    profile,
    appointment,
  });
}

async function applyHmoVerification(
  db,
  {
    status,
    clinicalRecordId = null,
    linkedUserId = null,
    branchId = null,
    appointmentId = null,
    provider = null,
    memberNumber = null,
  }
) {
  const nextStatus = String(status || "").toLowerCase();
  if (!HMO_VERIFICATION_STATUSES.has(nextStatus)) {
    const error = new Error(
      "Provide a valid HMO verification status: pending_verification, verified, rejected, or not_applicable."
    );
    error.status = 400;
    throw error;
  }

  await ensurePatientHmoSchema(db);

  if (clinicalRecordId) {
    const fields = ["hmo_verification_status = $1", "updated_at = CURRENT_TIMESTAMP"];
    const params = [nextStatus];
    if (provider) {
      params.push(provider);
      fields.push(`hmo_provider = $${params.length}`);
    }
    if (memberNumber) {
      params.push(memberNumber);
      fields.push(`hmo_member_number = $${params.length}`);
    }
    params.push(clinicalRecordId);
    await db.query(
      `UPDATE clinic_patient_records
       SET ${fields.join(", ")}
       WHERE id = $${params.length}`,
      params
    );
  } else if (linkedUserId) {
    await db.query(
      `UPDATE clinic_patient_records
       SET hmo_verification_status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE linked_user_id::text = $2`,
      [nextStatus, String(linkedUserId)]
    );
  }

  if (linkedUserId) {
    await db.query(
      `INSERT INTO patient_portal_profiles (user_id, hmo_verification_status, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE
         SET hmo_verification_status = EXCLUDED.hmo_verification_status,
             updated_at = CURRENT_TIMESTAMP`,
      [String(linkedUserId), nextStatus]
    );
  }

  const appointmentParams = [nextStatus];
  const filters = ["coverage_type = 'hmo'"];
  if (linkedUserId) {
    appointmentParams.push(String(linkedUserId));
    filters.push(`user_id::text = $${appointmentParams.length}`);
    if (branchId) {
      appointmentParams.push(branchId);
      filters.push(`branch_id = $${appointmentParams.length}`);
    }
  } else if (appointmentId) {
    appointmentParams.push(appointmentId);
    filters.push(`id = $${appointmentParams.length}`);
    if (branchId) {
      appointmentParams.push(branchId);
      filters.push(`branch_id = $${appointmentParams.length}`);
    }
  } else {
    return nextStatus;
  }

  await db.query(
    `UPDATE patient_portal_appointments
     SET hmo_verification_status = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE ${filters.join(" AND ")}`,
    appointmentParams
  );

  return nextStatus;
}

module.exports = {
  HMO_VERIFICATION_STATUSES,
  ensurePatientHmoSchema,
  buildHmoSnapshot,
  loadHmoSnapshot,
  applyHmoVerification,
};
