"use strict";

const fs = require("fs");
const path = require("path");

const PENDING = "pending_verification";
const VERIFIED = "verified";
const REJECTED = "rejected";
const NOT_ENROLLED = "not_enrolled";
const VERIFICATION_STATUSES = new Set([PENDING, VERIFIED, REJECTED]);

const HMO_VERIFIED_SMS =
  "Amethyst Dental Clinic: Your HMO coverage has been verified. Open your Patient Dashboard to view the status.";

function stringValue(value, maxLength = 160) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeCoveragePart(value) {
  return stringValue(value, 160)?.replace(/\s+/g, " ") || null;
}

function coverageKey(provider, memberNumber) {
  const hmoProvider = normalizeCoveragePart(provider);
  const hmoMemberNumber = normalizeCoveragePart(memberNumber);
  if (!hmoProvider || !hmoMemberNumber) return null;
  return {
    hmoProvider,
    hmoMemberNumber,
    key: `${hmoProvider.toLowerCase()}::${hmoMemberNumber.toLowerCase()}`,
  };
}

function sameCoverage(left, right) {
  const a = coverageKey(left?.hmoProvider || left?.hmo_provider, left?.hmoMemberNumber || left?.hmo_member_number);
  const b = coverageKey(right?.hmoProvider || right?.hmo_provider, right?.hmoMemberNumber || right?.hmo_member_number);
  return Boolean(a && b && a.key === b.key);
}

function numericId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function mapSubmission(row) {
  if (!row) return null;
  const source = row.source === "appointment" || row.appointment_id ? "appointment" : "profile";
  return {
    id: row.id,
    userId: row.user_id,
    patientName: row.patient_name || "Patient",
    patientPhone: row.patient_phone || null,
    patientEmail: row.patient_email || null,
    source,
    sourceLabel: source === "appointment" ? "Appointment-linked" : "Profile submission",
    appointmentId: row.appointment_id || null,
    appointmentStatus: row.appointment_status || null,
    hmoProvider: row.hmo_provider,
    hmoMemberNumber: row.hmo_member_number,
    hmoCompanyName: row.hmo_company_name || null,
    hmoBirthDate: row.hmo_birth_date || null,
    verificationBranchId: row.verification_branch_id,
    verificationBranchName: row.branch_name || null,
    verificationStatus: row.verification_status,
    verificationResult: row.verification_result || null,
    submittedAt: row.submitted_at,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    verifiedByName: row.verified_by_name || null,
    smsNotifiedAt: row.sms_notified_at,
    smsDeliveryStatus: row.sms_delivery_status || null,
  };
}

function formatHmoStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === VERIFIED) return "Verified";
  if (value === PENDING) return "Pending verification";
  if (value === REJECTED) return "Rejected";
  if (value === "not_applicable") return "Not applicable";
  if (value === NOT_ENROLLED) return "Not enrolled";
  return value.replaceAll("_", " ") || "Unknown";
}

async function applyHmoVerificationSchema(db) {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "061_hmo_verification_submissions.sql"),
    "utf8"
  );
  await db.query(sql);
  await backfillSubmissions(db);
}

async function rollbackHmoVerificationSchema(db) {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "061_hmo_verification_submissions_rollback.sql"),
    "utf8"
  );
  await db.query(sql);
}

async function mainBranchId(db) {
  const result = await db.query(
    `SELECT id
     FROM clinic_branches
     WHERE is_main = TRUE
     ORDER BY id ASC
     LIMIT 1`
  );
  return result.rows[0]?.id || null;
}

async function backfillSubmissions(db) {
  const fallbackBranch = await mainBranchId(db);
  if (!fallbackBranch) return;

  try {
    await db.query(
      `INSERT INTO patient_hmo_submissions (
         user_id, source, appointment_id, hmo_provider, hmo_member_number,
         verification_branch_id, verification_status, submitted_at, verified_at
       )
       SELECT
         appointment.user_id,
         'appointment',
         appointment.id,
         btrim(appointment.hmo_provider),
         btrim(appointment.hmo_member_number),
         COALESCE(appointment.branch_id, $1),
         CASE
           WHEN appointment.hmo_verification_status = 'verified' THEN 'verified'
           WHEN appointment.hmo_verification_status = 'rejected' THEN 'rejected'
           ELSE 'pending_verification'
         END,
         appointment.created_at,
         CASE WHEN appointment.hmo_verification_status = 'verified' THEN appointment.updated_at ELSE NULL END
       FROM patient_portal_appointments AS appointment
       WHERE LOWER(COALESCE(appointment.coverage_type, '')) = 'hmo'
         AND btrim(COALESCE(appointment.hmo_provider, '')) <> ''
         AND btrim(COALESCE(appointment.hmo_member_number, '')) <> ''
         AND appointment.hmo_verification_status IN ('pending_verification', 'verified', 'rejected')
         AND NOT EXISTS (
           SELECT 1
           FROM patient_hmo_submissions AS existing
           WHERE existing.user_id = appointment.user_id
             AND lower(btrim(existing.hmo_provider)) = lower(btrim(appointment.hmo_provider))
             AND lower(btrim(existing.hmo_member_number)) = lower(btrim(appointment.hmo_member_number))
             AND (
               existing.verification_status = 'pending_verification'
               OR existing.appointment_id = appointment.id
             )
         )
       ON CONFLICT DO NOTHING`,
      [fallbackBranch]
    );
  } catch (error) {
    if (error?.code !== "42703") throw error;
  }

  await db.query(
    `INSERT INTO patient_hmo_submissions (
       user_id, source, appointment_id, hmo_provider, hmo_member_number,
       verification_branch_id, verification_status, submitted_at, verified_at, verified_by
     )
     SELECT
       profile.user_id,
       'profile',
       NULL,
       btrim(profile.hmo_provider),
       btrim(profile.hmo_member_number),
       COALESCE(profile.hmo_verification_branch_id, $1),
       CASE
         WHEN profile.hmo_status = 'verified' THEN 'verified'
         WHEN profile.hmo_status = 'rejected' THEN 'rejected'
         ELSE 'pending_verification'
       END,
       profile.updated_at,
       profile.hmo_verified_at,
       profile.hmo_verified_by
     FROM patient_portal_profiles AS profile
     WHERE btrim(COALESCE(profile.hmo_provider, '')) <> ''
       AND btrim(COALESCE(profile.hmo_member_number, '')) <> ''
       AND COALESCE(profile.hmo_status, 'not_enrolled') NOT IN ('not_enrolled', 'not_applicable')
       AND NOT EXISTS (
         SELECT 1
         FROM patient_hmo_submissions AS existing
         WHERE existing.user_id = profile.user_id
           AND lower(btrim(existing.hmo_provider)) = lower(profile.hmo_provider)
           AND lower(btrim(existing.hmo_member_number)) = lower(profile.hmo_member_number)
       )
     ON CONFLICT DO NOTHING`,
    [fallbackBranch]
  );
}

async function countPendingUnique(db, { branchId = null } = {}) {
  try {
    const branchClause = branchId
      ? "AND COALESCE(submission.verification_branch_id, appointment.branch_id) = $2"
      : "";
    const params = branchId ? [PENDING, branchId] : [PENDING];
    const result = await db.query(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT
           submission.user_id,
           lower(btrim(submission.hmo_provider)) AS provider_key,
           lower(btrim(submission.hmo_member_number)) AS member_key
         FROM patient_hmo_submissions AS submission
         LEFT JOIN patient_portal_appointments AS appointment
           ON appointment.id = submission.appointment_id
         WHERE submission.verification_status = $1
           ${branchId ? "AND submission.verification_branch_id = $2" : ""}
         UNION
         SELECT
           appointment.user_id,
           lower(btrim(COALESCE(appointment.hmo_provider, ''))),
           lower(btrim(COALESCE(appointment.hmo_member_number, '')))
         FROM patient_portal_appointments AS appointment
         WHERE LOWER(COALESCE(appointment.coverage_type, '')) = 'hmo'
           AND appointment.hmo_verification_status = $1
           AND appointment.status NOT IN ('cancelled')
           ${branchId ? "AND appointment.branch_id = $2" : ""}
           AND NOT EXISTS (
             SELECT 1
             FROM patient_hmo_submissions AS submission
             WHERE submission.user_id = appointment.user_id
               AND submission.verification_status = $1
               AND lower(btrim(submission.hmo_provider)) = lower(btrim(COALESCE(appointment.hmo_provider, '')))
               AND lower(btrim(submission.hmo_member_number)) = lower(btrim(COALESCE(appointment.hmo_member_number, '')))
           )
       ) AS pending_coverage`,
      params
    );
    return Number.parseInt(result.rows[0]?.count || "0", 10);
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") return null;
    throw error;
  }
}

const LIST_SELECT = `
  SELECT
    submission.*,
    CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
    patient.phone AS patient_phone,
    patient.email AS patient_email,
    appointment.status AS appointment_status,
    branch.name AS branch_name,
    CONCAT_WS(' ', staff.first_name, staff.last_name) AS verified_by_name
  FROM patient_hmo_submissions AS submission
  JOIN users AS patient ON patient.id::text = submission.user_id
  LEFT JOIN patient_portal_appointments AS appointment ON appointment.id = submission.appointment_id
  LEFT JOIN clinic_branches AS branch ON branch.id = submission.verification_branch_id
  LEFT JOIN users AS staff ON staff.id::text = submission.verified_by
`;

async function listSubmissions(db, { branchId, status = PENDING, limit = 200 } = {}) {
  const clauses = ["submission.verification_branch_id = $1"];
  const params = [branchId];
  if (status && status !== "all") {
    params.push(status);
    clauses.push(`submission.verification_status = $${params.length}`);
  }
  params.push(Math.min(Number(limit) || 200, 500));
  const result = await db.query(
    `${LIST_SELECT}
     WHERE ${clauses.join(" AND ")}
     ORDER BY submission.submitted_at DESC, submission.id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(mapSubmission);
}

async function getSubmission(db, { id, branchId }) {
  const result = await db.query(
    `${LIST_SELECT}
     WHERE submission.id = $1
       AND submission.verification_branch_id = $2
     LIMIT 1`,
    [id, branchId]
  );
  return mapSubmission(result.rows[0]);
}

async function findPendingCoverage(db, { userId, hmoProvider, hmoMemberNumber }) {
  const coverage = coverageKey(hmoProvider, hmoMemberNumber);
  if (!coverage) return null;
  const result = await db.query(
    `SELECT *
     FROM patient_hmo_submissions
     WHERE user_id = $1
       AND verification_status = $2
       AND lower(btrim(hmo_provider)) = lower($3)
       AND lower(btrim(hmo_member_number)) = lower($4)
     ORDER BY submitted_at DESC
     LIMIT 1`,
    [String(userId), PENDING, coverage.hmoProvider, coverage.hmoMemberNumber]
  );
  return result.rows[0] || null;
}

async function findLatestMatching(db, { userId, hmoProvider, hmoMemberNumber }) {
  const coverage = coverageKey(hmoProvider, hmoMemberNumber);
  if (!coverage) return null;
  const result = await db.query(
    `SELECT *
     FROM patient_hmo_submissions
     WHERE user_id = $1
       AND lower(btrim(hmo_provider)) = lower($2)
       AND lower(btrim(hmo_member_number)) = lower($3)
     ORDER BY
       CASE verification_status
         WHEN 'verified' THEN 0
         WHEN 'pending_verification' THEN 1
         ELSE 2
       END,
       submitted_at DESC
     LIMIT 1`,
    [String(userId), coverage.hmoProvider, coverage.hmoMemberNumber]
  );
  return result.rows[0] || null;
}

async function syncProfileCoverage(db, {
  userId,
  previous = {},
  hmoProvider,
  hmoMemberNumber,
  hmoCompanyName = null,
  hmoBirthDate = null,
  verificationBranchId = null,
}) {
  const next = coverageKey(hmoProvider, hmoMemberNumber);
  if (!next) {
    return {
      hmoStatus: NOT_ENROLLED,
      hmoVerifiedAt: null,
      hmoVerifiedBy: null,
      hmoVerificationBranchId: null,
      submission: null,
    };
  }

  const previousKey = coverageKey(previous.hmo_provider || previous.hmoProvider, previous.hmo_member_number || previous.hmoMemberNumber);
  const coverageUnchanged = Boolean(previousKey && previousKey.key === next.key);
  const previousStatus = String(previous.hmo_status || previous.hmoStatus || NOT_ENROLLED).toLowerCase();
  const branchId =
    numericId(verificationBranchId) ||
    numericId(previous.hmo_verification_branch_id || previous.hmoVerificationBranchId) ||
    (await mainBranchId(db));

  if (!branchId) {
    const error = new Error("Choose an active clinic branch for HMO review.");
    error.status = 400;
    throw error;
  }

  if (coverageUnchanged && previousStatus === VERIFIED) {
    return {
      hmoStatus: VERIFIED,
      hmoVerifiedAt: previous.hmo_verified_at || previous.hmoVerifiedAt || null,
      hmoVerifiedBy: previous.hmo_verified_by || previous.hmoVerifiedBy || null,
      hmoVerificationBranchId: branchId,
      submission: await findLatestMatching(db, {
        userId,
        hmoProvider: next.hmoProvider,
        hmoMemberNumber: next.hmoMemberNumber,
      }),
    };
  }

  const pending = await findPendingCoverage(db, {
    userId,
    hmoProvider: next.hmoProvider,
    hmoMemberNumber: next.hmoMemberNumber,
  });
  let submission = pending;
  if (pending) {
    const result = await db.query(
      `UPDATE patient_hmo_submissions
       SET hmo_provider = $1,
           hmo_member_number = $2,
           hmo_company_name = COALESCE($3, hmo_company_name),
           hmo_birth_date = COALESCE($4, hmo_birth_date),
           verification_branch_id = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [next.hmoProvider, next.hmoMemberNumber, stringValue(hmoCompanyName, 160), hmoBirthDate, branchId, pending.id]
    );
    submission = result.rows[0];
  } else {
    const result = await db.query(
      `INSERT INTO patient_hmo_submissions (
         user_id, source, hmo_provider, hmo_member_number, hmo_company_name,
         hmo_birth_date, verification_branch_id, verification_status
       ) VALUES ($1, 'profile', $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [String(userId), next.hmoProvider, next.hmoMemberNumber, stringValue(hmoCompanyName, 160), hmoBirthDate, branchId, PENDING]
    );
    submission = result.rows[0];
  }

  return {
    hmoStatus: PENDING,
    hmoVerifiedAt: null,
    hmoVerifiedBy: null,
    hmoVerificationBranchId: branchId,
    submission,
  };
}

async function syncAppointmentCoverage(db, appointment) {
  if (!appointment || String(appointment.coverage_type || "").toLowerCase() !== "hmo") {
    return { status: appointment?.hmo_verification_status || "not_applicable", submission: null };
  }
  const coverage = coverageKey(appointment.hmo_provider, appointment.hmo_member_number);
  if (!coverage) {
    return { status: PENDING, submission: null };
  }
  const branchId = numericId(appointment.branch_id) || (await mainBranchId(db));
  const latest = await findLatestMatching(db, {
    userId: appointment.user_id,
    hmoProvider: coverage.hmoProvider,
    hmoMemberNumber: coverage.hmoMemberNumber,
  });

  if (latest?.verification_status === VERIFIED) {
    if (!latest.appointment_id) {
      await db.query(
        `UPDATE patient_hmo_submissions
         SET appointment_id = $1,
             source = 'appointment',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
           AND appointment_id IS NULL`,
        [appointment.id, latest.id]
      );
    }
    await db.query(
      `UPDATE patient_portal_appointments
       SET hmo_verification_status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [VERIFIED, appointment.id]
    );
    return { status: VERIFIED, submission: latest };
  }

  if (latest?.verification_status === PENDING) {
    await db.query(
      `UPDATE patient_hmo_submissions
       SET appointment_id = COALESCE(appointment_id, $1),
           source = 'appointment',
           verification_branch_id = $2,
           hmo_company_name = COALESCE($3, hmo_company_name),
           hmo_birth_date = COALESCE($4, hmo_birth_date),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [
        appointment.id,
        branchId,
        appointment.hmo_company_name || null,
        appointment.hmo_birth_date || null,
        latest.id,
      ]
    );
    await db.query(
      `UPDATE patient_portal_appointments
       SET hmo_verification_status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [PENDING, appointment.id]
    );
    return { status: PENDING, submission: latest };
  }

  const inserted = await db.query(
    `INSERT INTO patient_hmo_submissions (
       user_id, source, appointment_id, hmo_provider, hmo_member_number,
       hmo_company_name, hmo_birth_date, verification_branch_id, verification_status
     ) VALUES ($1, 'appointment', $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      String(appointment.user_id),
      appointment.id,
      coverage.hmoProvider,
      coverage.hmoMemberNumber,
      appointment.hmo_company_name || null,
      appointment.hmo_birth_date || null,
      branchId,
      PENDING,
    ]
  );
  await db.query(
    `UPDATE patient_portal_appointments
     SET hmo_verification_status = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [PENDING, appointment.id]
  );
  return { status: PENDING, submission: inserted.rows[0] };
}

async function applyVerificationToCoverage(db, submission) {
  await db.query(
    `INSERT INTO patient_portal_profiles (
       user_id, hmo_provider, hmo_member_number, hmo_status,
       hmo_verified_at, hmo_verified_by, hmo_verification_branch_id
     ) VALUES ($7, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       hmo_provider = EXCLUDED.hmo_provider,
       hmo_member_number = EXCLUDED.hmo_member_number,
       hmo_status = EXCLUDED.hmo_status,
       hmo_verified_at = EXCLUDED.hmo_verified_at,
       hmo_verified_by = EXCLUDED.hmo_verified_by,
       hmo_verification_branch_id = EXCLUDED.hmo_verification_branch_id,
       updated_at = CURRENT_TIMESTAMP`,
    [
      submission.hmo_provider,
      submission.hmo_member_number,
      submission.verification_status,
      submission.verified_at,
      submission.verified_by,
      submission.verification_branch_id,
      String(submission.user_id),
    ]
  );

  await db.query(
    `UPDATE patient_portal_appointments
     SET hmo_verification_status = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $2
       AND LOWER(COALESCE(coverage_type, '')) = 'hmo'
       AND lower(btrim(COALESCE(hmo_provider, ''))) = lower(btrim($3))
       AND lower(btrim(COALESCE(hmo_member_number, ''))) = lower(btrim($4))`,
    [
      submission.verification_status,
      String(submission.user_id),
      submission.hmo_provider,
      submission.hmo_member_number,
    ]
  );
}

async function notifyVerifiedSms({ db, clinicSms, submission, actorId }) {
  if (submission.sms_notified_at) {
    return { status: submission.sms_delivery_status || "sent", duplicate: true, reason: "already_notified" };
  }
  if (!clinicSms?.sendClinicSms) {
    return { status: "failed", reason: "SMS service is not configured." };
  }
  try {
    const result = await clinicSms.sendClinicSms({
      userId: submission.user_id,
      message: HMO_VERIFIED_SMS,
      messageType: "hmo_verification",
      category: "general",
      actorRole: "staff",
      actorId,
      idempotencyKey: `hmo-verified:${submission.id}`,
      respectPreferences: true,
    });
    const delivered = ["sent", "delivered"].includes(String(result.status || ""));
    await db.query(
      `UPDATE patient_hmo_submissions
       SET sms_delivery_status = $1,
           sms_notified_at = CASE WHEN $2 THEN COALESCE(sms_notified_at, CURRENT_TIMESTAMP) ELSE sms_notified_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [result.status || "failed", delivered, submission.id]
    );
    return result;
  } catch (error) {
    await db.query(
      `UPDATE patient_hmo_submissions
       SET sms_delivery_status = 'failed',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [submission.id]
    );
    return { status: "failed", reason: error.message };
  }
}

async function verifySubmission(db, {
  id,
  branchId,
  staffId,
  status,
  clinicSms = null,
}) {
  const nextStatus = String(status || "").toLowerCase();
  if (!VERIFICATION_STATUSES.has(nextStatus) || nextStatus === PENDING) {
    const error = new Error("Choose verified or rejected.");
    error.status = 400;
    throw error;
  }

  const currentResult = await db.query(
    `SELECT *
     FROM patient_hmo_submissions
     WHERE id = $1
       AND verification_branch_id = $2`,
    [id, branchId]
  );
  const current = currentResult.rows[0];
  if (!current) {
    const error = new Error("HMO submission not found.");
    error.status = 404;
    throw error;
  }

  if (current.verification_status === nextStatus && nextStatus === VERIFIED) {
    const sms = await notifyVerifiedSms({ db, clinicSms, submission: current, actorId: staffId });
    const mapped = await getSubmission(db, { id: current.id, branchId });
    return { submission: mapped, sms, alreadyRecorded: true };
  }

  const updated = await db.query(
    `UPDATE patient_hmo_submissions
     SET verification_status = $1,
         verification_result = $1,
         verified_at = CURRENT_TIMESTAMP,
         verified_by = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [nextStatus, staffId != null ? String(staffId) : null, current.id]
  );
  const saved = updated.rows[0];
  await applyVerificationToCoverage(db, saved);

  let sms = { status: "skipped", reason: "not_verified" };
  if (nextStatus === VERIFIED) {
    sms = await notifyVerifiedSms({ db, clinicSms, submission: saved, actorId: staffId });
  }
  const mapped = await getSubmission(db, { id: saved.id, branchId });
  return { submission: mapped, sms, alreadyRecorded: false };
}

async function verifyByAppointment(db, { appointmentId, branchId, staffId, status, clinicSms = null }) {
  const appointment = await db.query(
    `SELECT *
     FROM patient_portal_appointments
     WHERE id = $1
       AND branch_id = $2
     LIMIT 1`,
    [appointmentId, branchId]
  );
  const row = appointment.rows[0];
  if (!row) {
    const error = new Error("Appointment not found.");
    error.status = 404;
    throw error;
  }
  const synced = await syncAppointmentCoverage(db, row);
  if (!synced.submission?.id) {
    const error = new Error("This appointment has no HMO coverage to review.");
    error.status = 400;
    throw error;
  }
  return verifySubmission(db, {
    id: synced.submission.id,
    branchId: synced.submission.verification_branch_id || branchId,
    staffId,
    status,
    clinicSms,
  });
}

async function coverageSnapshot(db, userId) {
  const profile = await db.query(
    `SELECT hmo_provider, hmo_member_number, hmo_status, hmo_verified_at, hmo_verified_by,
            hmo_verification_branch_id
     FROM patient_portal_profiles
     WHERE user_id = $1
     LIMIT 1`,
    [String(userId)]
  );
  const row = profile.rows[0] || {};
  return {
    hmoProvider: row.hmo_provider || null,
    hmoMemberNumber: row.hmo_member_number || null,
    hmoStatus: row.hmo_status || NOT_ENROLLED,
    hmoVerifiedAt: row.hmo_verified_at || null,
    hmoVerifiedBy: row.hmo_verified_by || null,
    hmoVerificationBranchId: row.hmo_verification_branch_id || null,
  };
}

module.exports = {
  PENDING,
  VERIFIED,
  REJECTED,
  NOT_ENROLLED,
  HMO_VERIFIED_SMS,
  applyHmoVerificationSchema,
  rollbackHmoVerificationSchema,
  countPendingUnique,
  listSubmissions,
  getSubmission,
  mapSubmission,
  formatHmoStatus,
  sameCoverage,
  coverageKey,
  syncProfileCoverage,
  syncAppointmentCoverage,
  verifySubmission,
  verifyByAppointment,
  coverageSnapshot,
  notifyVerifiedSms,
};
