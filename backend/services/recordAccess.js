"use strict";

const bcrypt = require("bcrypt");
const { writeAdminAudit } = require("./adminAudit");

const GRANT_MINUTES = 30;
const GRANT_RANGE_MINUTES = { min: 15, max: 240 };
const CHALLENGE_MINUTES = 5;
const GRANT_MINUTES_SETTING = "record_access_grant_minutes";
const GENERIC_AUTH_MESSAGE = "Unable to authorize this access.";
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAIL_LIMIT = 5;
const authFailures = new Map();
let dummyPasswordHash = null;

const RESTRICTED_SCOPES = [
  "diagnosis_notes",
  "xrays",
  "medical_documents",
  "wellness",
  "consent_forms",
];

const OPEN_APPOINTMENT_STATUSES = ["confirmed", "checked_in"];
const ACTIVE_ENCOUNTER_STATUSES = ["waiting", "checked_in", "preparing", "dentist"];

function httpError(message, status, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function identityOf(record) {
  if (!record) return null;
  return {
    id: record.id,
    patientId: record.patientId || record.patient_id || record.recordCode || record.record_code || null,
    fullName: record.fullName || record.full_name || `${record.firstName || record.first_name || ""} ${record.lastName || record.last_name || ""}`.trim(),
  };
}

function dentistKeys(dentist) {
  const keys = new Set();
  if (dentist?.id != null) keys.add(String(dentist.id));
  if (dentist?.catalog_dentist_id) keys.add(String(dentist.catalog_dentist_id));
  const fullName = `${dentist?.first_name || ""} ${dentist?.last_name || ""}`.trim().toLowerCase();
  if (fullName) {
    keys.add(fullName);
    keys.add(`dr. ${fullName}`);
  }
  return keys;
}

function appointmentMatchesDentist(row, dentist) {
  const keys = dentistKeys(dentist);
  if (row.dentist_id != null && keys.has(String(row.dentist_id))) return true;
  const name = String(row.dentist_name || "").trim().toLowerCase();
  return Boolean(name) && keys.has(name);
}

async function authorizedBranchIds(db, userId) {
  try {
    const result = await db.query(
      `SELECT assignment.branch_id
       FROM clinic_branch_assignments AS assignment
       JOIN clinic_branches AS branch ON branch.id = assignment.branch_id
       WHERE assignment.user_id::text = $1
         AND branch.status = 'active'`,
      [String(userId)]
    );
    return result.rows.map((row) => String(row.branch_id));
  } catch (error) {
    if (error.code === "42P01" || error.code === "42703") return [];
    throw error;
  }
}

async function qualifyingRelationship(db, dentist, record) {
  const linkedUserId = record?.linkedUserId || record?.linked_user_id || null;
  if (!dentist?.id || !linkedUserId) {
    return { allowed: false, branchIds: [] };
  }
  const branches = await authorizedBranchIds(db, dentist.id);
  if (!branches.length) return { allowed: false, branchIds: [] };

  let appointments;
  let encounters;
  try {
    appointments = await db.query(
      `SELECT id, branch_id, status, dentist_id, dentist_name
       FROM patient_portal_appointments
       WHERE user_id = $1
         AND status = ANY($2::text[])
         AND branch_id::text = ANY($3::text[])`,
      [String(linkedUserId), OPEN_APPOINTMENT_STATUSES, branches]
    );
    encounters = await db.query(
      `SELECT appointment.id, appointment.branch_id, appointment.dentist_id, appointment.dentist_name
       FROM patient_portal_queue_entries AS queue
       JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id
       WHERE queue.user_id = $1
         AND queue.status = ANY($2::text[])
         AND appointment.status NOT IN ('cancelled', 'no_show', 'rescheduled', 'pending')
         AND appointment.branch_id::text = ANY($3::text[])`,
      [String(linkedUserId), ACTIVE_ENCOUNTER_STATUSES, branches]
    );
  } catch (error) {
    if (error.code === "42P01" || error.code === "42703") {
      return { allowed: false, branchIds: [] };
    }
    throw error;
  }

  const branchIds = new Set();
  for (const row of [...appointments.rows, ...encounters.rows]) {
    if (appointmentMatchesDentist(row, dentist)) branchIds.add(String(row.branch_id));
  }
  return { allowed: branchIds.size > 0, branchIds: [...branchIds] };
}

async function expireGrants(db, dentistId, recordId) {
  try {
    await db.query(
      `UPDATE record_access_grants
       SET status = 'expired'
       WHERE requesting_dentist_id = $1
         AND clinical_record_id = $2
         AND status = 'active'
         AND expires_at <= CURRENT_TIMESTAMP`,
      [String(dentistId), recordId]
    );
    await db.query(
      `UPDATE record_access_requests AS request
       SET status = 'expired'
       WHERE request.requesting_dentist_id = $1
         AND request.clinical_record_id = $2
         AND request.status = 'approved'
         AND NOT EXISTS (
           SELECT 1 FROM record_access_grants AS grant_row
           WHERE grant_row.request_id = request.id
             AND grant_row.status = 'active'
         )
         AND EXISTS (
           SELECT 1 FROM record_access_grants AS grant_row
           WHERE grant_row.request_id = request.id
             AND grant_row.status = 'expired'
         )`,
      [String(dentistId), recordId]
    );
  } catch (error) {
    if (error.code !== "42P01" && error.code !== "42703") throw error;
  }
}

async function activeGrants(db, dentistId, recordId) {
  await expireGrants(db, dentistId, recordId);
  try {
    const result = await db.query(
      `SELECT originating_branch_id, scope, expires_at
       FROM record_access_grants
       WHERE requesting_dentist_id = $1
         AND clinical_record_id = $2
         AND status = 'active'
         AND expires_at > CURRENT_TIMESTAMP`,
      [String(dentistId), recordId]
    );
    return result.rows.map((row) => ({
      branchId: String(row.originating_branch_id),
      scope: row.scope,
      expiresAt: row.expires_at,
    }));
  } catch (error) {
    if (error.code === "42P01" || error.code === "42703") return [];
    throw error;
  }
}

function restrictedAllowed({ originatingBranchId, encounterBranchIds, grants, scope }) {
  if (originatingBranchId == null || originatingBranchId === "") return false;
  const branchId = String(originatingBranchId);
  if ((encounterBranchIds || []).map(String).includes(branchId)) return true;
  return (grants || []).some((grant) => grant.scope === scope && grant.branchId === branchId);
}

function presentTreatment(treatment, access) {
  const ordinary = {
    id: treatment.id,
    name: treatment.treatment,
    treatment: treatment.treatment,
    dentist: treatment.dentistName || treatment.dentist || null,
    date: treatment.treatmentDate || treatment.date || null,
    treatmentDate: treatment.treatmentDate || treatment.date || null,
    status: treatment.status,
    toothNumber: treatment.toothNumber || null,
    originatingBranchId: treatment.originatingBranchId || treatment.originating_branch_id || null,
    attributionReview: Boolean(
      treatment.attributionReview ||
      treatment.attribution_review ||
      !(treatment.originatingBranchId || treatment.originating_branch_id)
    ),
    createdAt: treatment.createdAt || treatment.created_at || null,
    treatingDentistId: treatment.treatingDentistId || treatment.treating_dentist_id || null,
    notes: "",
    diagnosis: "",
    diagnosisNotes: "",
    procedureDetails: "",
  };
  const branchId = ordinary.originatingBranchId;
  if (restrictedAllowed({ ...access, originatingBranchId: branchId, scope: "diagnosis_notes" })) {
    const diagnosis = treatment.diagnosisNotes || treatment.diagnosis || "";
    ordinary.diagnosis = diagnosis;
    ordinary.diagnosisNotes = diagnosis;
    ordinary.procedureDetails = treatment.procedureDetails || "";
  }
  return ordinary;
}

function audit(db, req, entry) {
  const actor = req?.dentist || req?.admin || req?.staff || req?.user || {};
  return writeAdminAudit(db, {
    actorId: actor.id,
    actorName: `${actor.first_name || ""} ${actor.last_name || ""}`.trim() || null,
    actorRole: req?.dentist ? "dentist" : req?.admin ? "admin" : req?.staff ? "staff" : null,
    result: "success",
    ...entry,
  });
}

async function createRequest(db, req, { record, requestingBranchId, originatingBranchId, reason, scope }) {
  if (!RESTRICTED_SCOPES.includes(scope)) {
    throw httpError("Choose a restricted record type.", 400);
  }
  const text = String(reason || "").trim();
  if (text.length < 3) throw httpError("Enter a short reason for this request.", 400);
  const requestBranch = Number(requestingBranchId);
  const originBranch = Number(originatingBranchId);
  if (!Number.isSafeInteger(requestBranch) || !Number.isSafeInteger(originBranch)) {
    throw httpError("Choose the branch you are working from and the branch that holds the records.", 400);
  }
  requestingBranchId = requestBranch;
  originatingBranchId = originBranch;
  const relationship = await qualifyingRelationship(db, req.dentist, record);
  if (!relationship.allowed) {
    throw httpError(
      "A confirmed appointment or an active encounter with this patient is required before requesting more of the chart.",
      403,
      { patient: identityOf(record), code: "NO_TREATMENT_RELATIONSHIP" }
    );
  }
  if (!relationship.branchIds.map(String).includes(String(requestingBranchId))) {
    throw httpError("Request the chart from a branch where you are seeing this patient.", 403);
  }
  const branches = await authorizedBranchIds(db, req.dentist.id);
  if (!branches.includes(String(originatingBranchId))) {
    const known = await db.query(`SELECT id, status FROM clinic_branches WHERE id = $1`, [originatingBranchId]);
    if (!known.rows[0] || known.rows[0].status !== "active") {
      throw httpError("Choose an active branch that holds the records.", 400);
    }
  }
  try {
    const inserted = await db.query(
      `INSERT INTO record_access_requests (
         clinical_record_id, patient_user_id, requesting_dentist_id, requesting_branch_id,
         originating_branch_id, reason, scope
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, created_at`,
      [
        record.id,
        record.linkedUserId || record.linked_user_id || null,
        String(req.dentist.id),
        requestingBranchId,
        originatingBranchId,
        text.slice(0, 500),
        scope,
      ]
    );
    await db.query(
      `INSERT INTO record_access_decisions (request_id, actor_id, actor_role, action)
       VALUES ($1, $2, 'dentist', 'requested')`,
      [inserted.rows[0].id, String(req.dentist.id)]
    );
    await audit(db, req, {
      action: "record_access_requested",
      targetType: "clinical_record",
      targetId: String(record.id),
      targetLabel: identityOf(record).patientId,
      detail: `Request ${inserted.rows[0].id} scope ${scope} from branch ${originatingBranchId} at branch ${requestingBranchId}.`,
    });
    return inserted.rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw httpError("A pending request already exists for this patient, branch, and record type.", 409);
    }
    throw error;
  }
}

async function approverMayDecide(db, approver, request) {
  if (!approver?.id) return false;
  if (String(approver.id) === String(request.requesting_dentist_id)) return false;
  if (String(approver.role || "").toLowerCase() === "admin") return true;
  if (String(approver.role || "").toLowerCase() !== "dentist") return false;
  if (approver.can_approve_cross_branch_access !== true) return false;
  const branches = await authorizedBranchIds(db, approver.id);
  return branches.includes(String(request.originating_branch_id));
}

async function decideRequest(db, approver, requestId, decision) {
  if (!["approved", "denied", "revoked"].includes(decision)) {
    throw httpError("Choose approve, deny, or revoke.", 400);
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM record_access_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    const request = locked.rows[0];
    if (!request) {
      await client.query("ROLLBACK");
      throw httpError("Access request not found.", 404);
    }
    const allowed = await approverMayDecide(client, approver, request);
    if (!allowed) {
      await client.query("ROLLBACK");
      const self = String(approver.id) === String(request.requesting_dentist_id);
      throw httpError(
        self
          ? "You cannot approve your own record request."
          : "You cannot decide record requests for this branch.",
        403
      );
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('record-grant'), hashtext($1))`, [
      `${request.requesting_dentist_id}:${request.clinical_record_id}:${request.originating_branch_id}:${request.scope}`,
    ]);

    if (decision === "revoked") {
      await client.query(
        `UPDATE record_access_grants SET status = 'revoked' WHERE request_id = $1 AND status = 'active'`,
        [request.id]
      );
      await client.query(
        `UPDATE record_access_requests SET status = 'revoked', decided_at = CURRENT_TIMESTAMP, decided_by = $2 WHERE id = $1`,
        [request.id, String(approver.id)]
      );
    } else if (request.status !== "pending") {
      const existing = await client.query(
        `SELECT id, status, expires_at FROM record_access_grants WHERE request_id = $1 ORDER BY id DESC LIMIT 1`,
        [request.id]
      );
      await client.query("COMMIT");
      return { request, grant: existing.rows[0] || null, duplicate: true };
    } else if (decision === "approved") {
      await client.query("ROLLBACK");
      throw httpError("Authorize this request at the requesting workstation.", 409);
    } else if (decision === "denied") {
      await client.query(
        `UPDATE record_access_requests SET status = 'denied', decided_at = CURRENT_TIMESTAMP, decided_by = $2 WHERE id = $1`,
        [request.id, String(approver.id)]
      );
    } else {
      await client.query("ROLLBACK");
      throw httpError("Authorize this request at the requesting workstation.", 409);
    }
    await client.query(
      `INSERT INTO record_access_decisions (request_id, actor_id, actor_role, action)
       VALUES ($1, $2, $3, $4)`,
      [request.id, String(approver.id), String(approver.role || "admin").toLowerCase(), decision]
    );
    await client.query("COMMIT");
    await writeAdminAudit(db, {
      actorId: approver.id,
      actorName: `${approver.first_name || ""} ${approver.last_name || ""}`.trim() || null,
      actorRole: approver.role || "admin",
      action: `record_access_${decision}`,
      targetType: "clinical_record",
      targetId: String(request.clinical_record_id),
      detail: `Request ${request.id} scope ${request.scope} branch ${request.originating_branch_id}.`,
    });
    const grant = await db.query(
      `SELECT id, status, expires_at FROM record_access_grants WHERE request_id = $1 ORDER BY id DESC LIMIT 1`,
      [request.id]
    );
    return { request: { ...request, status: decision }, grant: grant.rows[0] || null };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function clampGrantMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return GRANT_MINUTES;
  return Math.min(GRANT_RANGE_MINUTES.max, Math.max(GRANT_RANGE_MINUTES.min, Math.round(minutes)));
}

async function loadGrantMinutes(db) {
  try {
    const result = await db.query(
      `SELECT setting_value FROM admin_portal_settings WHERE setting_key = $1 LIMIT 1`,
      [GRANT_MINUTES_SETTING]
    );
    const raw = result.rows[0]?.setting_value;
    const parsed = raw && typeof raw === "object" && !Array.isArray(raw) && raw.minutes != null ? raw.minutes : raw;
    return clampGrantMinutes(parsed == null ? GRANT_MINUTES : parsed);
  } catch (error) {
    if (error.code === "42P01" || error.code === "42703") return GRANT_MINUTES;
    throw error;
  }
}

async function saveGrantMinutes(db, minutes, adminId) {
  const grantMinutes = clampGrantMinutes(minutes);
  await db.query(
    `INSERT INTO admin_portal_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP, $3)
     ON CONFLICT (setting_key) DO UPDATE SET
       setting_value = EXCLUDED.setting_value,
       updated_at = CURRENT_TIMESTAMP,
       updated_by = EXCLUDED.updated_by`,
    [GRANT_MINUTES_SETTING, JSON.stringify(grantMinutes), adminId ? String(adminId) : null]
  );
  return grantMinutes;
}

function resetAuthFailures() {
  authFailures.clear();
}

function authAttemptKey(identifier, ip) {
  return `${String(identifier || "").trim().toLowerCase()}|${String(ip || "")}`;
}

function assertAuthRateLimit(identifier, ip) {
  const key = authAttemptKey(identifier, ip);
  const now = Date.now();
  const current = authFailures.get(key);
  if (current && now - current.startedAt > AUTH_WINDOW_MS) {
    authFailures.delete(key);
    return;
  }
  if (current && current.count >= AUTH_FAIL_LIMIT) {
    throw httpError("Too many authorization attempts. Please wait 15 minutes and try again.", 429);
  }
}

function recordAuthFailure(identifier, ip) {
  const key = authAttemptKey(identifier, ip);
  const now = Date.now();
  const current = authFailures.get(key);
  if (!current || now - current.startedAt > AUTH_WINDOW_MS) {
    authFailures.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
}

function clearAuthFailure(identifier, ip) {
  authFailures.delete(authAttemptKey(identifier, ip));
}

function normalizeIdentifier(value) {
  const raw = String(value || "").trim();
  if (!raw) return { email: null, phone: raw };
  if (raw.includes("@")) return { email: raw.toLowerCase(), phone: raw };
  return { email: null, phone: raw };
}

async function dummyHash() {
  if (!dummyPasswordHash) dummyPasswordHash = await bcrypt.hash("record-access-dummy", 10);
  return dummyPasswordHash;
}

async function createChallenge(db, req, payload) {
  if (!RESTRICTED_SCOPES.includes(payload.scope)) {
    throw httpError("Choose a restricted record type.", 400);
  }
  const text = String(payload.reason || "").trim();
  if (text.length < 3) throw httpError("Enter a short reason for this request.", 400);
  const requestBranch = Number(payload.requestingBranchId);
  const originBranch = Number(payload.originatingBranchId);
  if (!Number.isSafeInteger(requestBranch) || !Number.isSafeInteger(originBranch)) {
    throw httpError("Choose the branch you are working from and the branch that holds the records.", 400);
  }
  const record = payload.record;
  const relationship = await qualifyingRelationship(db, req.dentist, record);
  if (!relationship.allowed) {
    throw httpError(
      "A confirmed appointment or an active encounter with this patient is required before requesting more of the chart.",
      403,
      { patient: identityOf(record), code: "NO_TREATMENT_RELATIONSHIP" }
    );
  }
  if (!relationship.branchIds.map(String).includes(String(requestBranch))) {
    throw httpError("Request the chart from a branch where you are seeing this patient.", 403);
  }
  const branches = await authorizedBranchIds(db, req.dentist.id);
  if (!branches.includes(String(originBranch))) {
    const known = await db.query(`SELECT id, status FROM clinic_branches WHERE id = $1`, [originBranch]);
    if (!known.rows[0] || known.rows[0].status !== "active") {
      throw httpError("Choose an active branch that holds the records.", 400);
    }
  }

  const pending = await db.query(
    `SELECT id FROM record_access_requests
     WHERE requesting_dentist_id = $1
       AND clinical_record_id = $2
       AND originating_branch_id = $3
       AND scope = $4
       AND status = 'pending'
     ORDER BY id DESC
     LIMIT 1`,
    [String(req.dentist.id), record.id, originBranch, payload.scope]
  );

  await db.query(
    `UPDATE record_access_challenges
     SET consumed_at = CURRENT_TIMESTAMP
     WHERE requesting_dentist_id = $1
       AND clinical_record_id = $2
       AND originating_branch_id = $3
       AND scope = $4
       AND consumed_at IS NULL`,
    [String(req.dentist.id), record.id, originBranch, payload.scope]
  );

  const inserted = await db.query(
    `INSERT INTO record_access_challenges (
       clinical_record_id, patient_user_id, requesting_dentist_id, requesting_branch_id,
       originating_branch_id, reason, scope, legacy_request_id, expires_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP + ($9 || ' minutes')::interval
     )
     RETURNING id, expires_at, requesting_dentist_id, requesting_branch_id, originating_branch_id, scope, reason`,
    [
      record.id,
      record.linkedUserId || record.linked_user_id || null,
      String(req.dentist.id),
      requestBranch,
      originBranch,
      text.slice(0, 500),
      payload.scope,
      pending.rows[0]?.id || null,
      String(CHALLENGE_MINUTES),
    ]
  );
  await audit(db, req, {
    action: "record_access_challenge_created",
    targetType: "clinical_record",
    targetId: String(record.id),
    targetLabel: identityOf(record).patientId,
    detail: `Challenge ${inserted.rows[0].id} scope ${payload.scope} from branch ${originBranch} at branch ${requestBranch}.`,
  });
  return {
    ...inserted.rows[0],
    patient: identityOf(record),
  };
}

async function loadApproverRow(db, identifier) {
  const parsed = normalizeIdentifier(identifier);
  const result = await db.query(
    `SELECT account.id, account.first_name, account.last_name, account.email, account.phone,
            account.role, account.status, account.is_verified, account.is_archived, account.password_hash,
            profile.can_approve_cross_branch_access
     FROM users AS account
     LEFT JOIN admin_portal_dentist_profiles AS profile
       ON profile.user_id::text = account.id::text
     WHERE LOWER(account.email) = $1 OR account.phone = $2 OR account.phone = $3
     LIMIT 1`,
    [parsed.email || parsed.phone.toLowerCase(), parsed.phone, String(identifier || "").trim()]
  );
  return result.rows[0] || null;
}

async function verifyApproverPassword(db, identifier, password) {
  const row = await loadApproverRow(db, identifier);
  const hash = row?.password_hash && row.password_hash !== "synthetic-hash" && row.password_hash !== "!"
    ? row.password_hash
    : await dummyHash();
  const matched = await bcrypt.compare(String(password || ""), hash);
  if (!row || !matched || row.password_hash === "synthetic-hash" || row.password_hash === "!" || !row.password_hash) {
    return null;
  }
  return row;
}

function approverAccountEligible(row) {
  if (!row?.is_verified) return false;
  if (row.is_archived) return false;
  const status = String(row.status || "active").toLowerCase();
  if (["inactive", "disabled", "suspended", "rejected", "pending", "unverified"].includes(status)) return false;
  const role = String(row.role || "").toLowerCase();
  if (role === "admin") return true;
  if (role === "dentist" && row.can_approve_cross_branch_access === true) return true;
  return false;
}

async function authorizeChallenge(db, req, { challengeId, identifier, password }) {
  assertAuthRateLimit(identifier, req.ip);
  const passwordText = String(password || "");
  if (!String(identifier || "").trim() || !passwordText) {
    recordAuthFailure(identifier, req.ip);
    throw httpError(GENERIC_AUTH_MESSAGE, 401);
  }

  const approverRow = await verifyApproverPassword(db, identifier, passwordText);
  if (!approverRow) {
    recordAuthFailure(identifier, req.ip);
    await writeAdminAudit(db, {
      actorId: req.dentist?.id,
      actorRole: "dentist",
      action: "record_access_authorize_failed",
      targetType: "record_access_challenge",
      targetId: String(challengeId),
      result: "failure",
      detail: "Independent verification failed.",
    });
    throw httpError(GENERIC_AUTH_MESSAGE, 401);
  }
  if (!approverAccountEligible(approverRow)) {
    recordAuthFailure(identifier, req.ip);
    throw httpError("You cannot authorize this record access.", 403);
  }
  clearAuthFailure(identifier, req.ip);

  const approver = {
    id: approverRow.id,
    first_name: approverRow.first_name,
    last_name: approverRow.last_name,
    role: String(approverRow.role || "").toLowerCase(),
    can_approve_cross_branch_access: approverRow.can_approve_cross_branch_access === true,
  };

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM record_access_challenges WHERE id = $1 FOR UPDATE`,
      [challengeId]
    );
    const challenge = locked.rows[0];
    if (!challenge) {
      await client.query("ROLLBACK");
      throw httpError("This authorization is no longer valid.", 404);
    }
    if (String(challenge.requesting_dentist_id) !== String(req.dentist.id)) {
      await client.query("ROLLBACK");
      throw httpError("This authorization is no longer valid.", 403);
    }
    if (challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      throw httpError("This authorization is no longer valid.", 409);
    }
    if (String(approver.id) === String(challenge.requesting_dentist_id)) {
      await client.query("ROLLBACK");
      throw httpError("You cannot authorize your own record access.", 403);
    }
    const allowed = await approverMayDecide(client, approver, {
      requesting_dentist_id: challenge.requesting_dentist_id,
      originating_branch_id: challenge.originating_branch_id,
    });
    if (!allowed) {
      await client.query("ROLLBACK");
      throw httpError("You cannot authorize records for this branch.", 403);
    }

    await client.query(`SELECT pg_advisory_xact_lock(hashtext('record-grant'), hashtext($1))`, [
      `${challenge.requesting_dentist_id}:${challenge.clinical_record_id}:${challenge.originating_branch_id}:${challenge.scope}`,
    ]);

    await client.query(
      `UPDATE record_access_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [challenge.id]
    );

    let requestId = challenge.legacy_request_id || null;
    if (requestId) {
      const pending = await client.query(
        `SELECT id, status FROM record_access_requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      if (!pending.rows[0] || pending.rows[0].status !== "pending") requestId = null;
    }
    if (!requestId) {
      const created = await client.query(
        `INSERT INTO record_access_requests (
           clinical_record_id, patient_user_id, requesting_dentist_id, requesting_branch_id,
           originating_branch_id, reason, scope, status, decided_at, decided_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', CURRENT_TIMESTAMP, $8)
         RETURNING id`,
        [
          challenge.clinical_record_id,
          challenge.patient_user_id,
          challenge.requesting_dentist_id,
          challenge.requesting_branch_id,
          challenge.originating_branch_id,
          challenge.reason,
          challenge.scope,
          String(approver.id),
        ]
      );
      requestId = created.rows[0].id;
    } else {
      await client.query(
        `UPDATE record_access_requests
         SET status = 'approved', decided_at = CURRENT_TIMESTAMP, decided_by = $2
         WHERE id = $1`,
        [requestId, String(approver.id)]
      );
    }

    const minutes = await loadGrantMinutes(client);
    let grant;
    try {
      grant = await client.query(
        `INSERT INTO record_access_grants (
           request_id, requesting_dentist_id, clinical_record_id, originating_branch_id, scope, expires_at
         ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + ($6 || ' minutes')::interval)
         RETURNING id, status, expires_at, scope, originating_branch_id, clinical_record_id`,
        [
          requestId,
          challenge.requesting_dentist_id,
          challenge.clinical_record_id,
          challenge.originating_branch_id,
          challenge.scope,
          String(minutes),
        ]
      );
    } catch (error) {
      if (error.code !== "23505") throw error;
      grant = await client.query(
        `SELECT id, status, expires_at, scope, originating_branch_id, clinical_record_id
         FROM record_access_grants
         WHERE requesting_dentist_id = $1
           AND clinical_record_id = $2
           AND originating_branch_id = $3
           AND scope = $4
           AND status = 'active'
         ORDER BY id DESC
         LIMIT 1`,
        [
          challenge.requesting_dentist_id,
          challenge.clinical_record_id,
          challenge.originating_branch_id,
          challenge.scope,
        ]
      );
    }

    await client.query(
      `INSERT INTO record_access_decisions (request_id, actor_id, actor_role, action)
       VALUES ($1, $2, $3, 'approved')`,
      [requestId, String(approver.id), approver.role]
    );
    await client.query("COMMIT");
    await writeAdminAudit(db, {
      actorId: approver.id,
      actorName: `${approver.first_name || ""} ${approver.last_name || ""}`.trim() || null,
      actorRole: approver.role,
      action: "record_access_approved",
      targetType: "clinical_record",
      targetId: String(challenge.clinical_record_id),
      detail: `Grant ${grant.rows[0]?.id || ""} request ${requestId} scope ${challenge.scope} branch ${challenge.originating_branch_id}.`,
    });
    return {
      grant: grant.rows[0] || null,
      requestId,
      minutes,
      approverRole: approver.role,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  GRANT_MINUTES,
  GRANT_RANGE_MINUTES,
  CHALLENGE_MINUTES,
  GENERIC_AUTH_MESSAGE,
  RESTRICTED_SCOPES,
  OPEN_APPOINTMENT_STATUSES,
  ACTIVE_ENCOUNTER_STATUSES,
  identityOf,
  authorizedBranchIds,
  qualifyingRelationship,
  activeGrants,
  restrictedAllowed,
  presentTreatment,
  createRequest,
  createChallenge,
  authorizeChallenge,
  decideRequest,
  approverMayDecide,
  loadGrantMinutes,
  saveGrantMinutes,
  clampGrantMinutes,
  resetAuthFailures,
  audit,
};
