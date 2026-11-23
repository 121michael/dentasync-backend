"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { writeAdminAudit } = require("./adminAudit");
const {
  encryptAuthorizationPassword,
  decryptAuthorizationPassword,
} = require("./dentistCredentialSecret");

const GRANT_MINUTES = 30;
const GRANT_RANGE_MINUTES = { min: 15, max: 240 };
const CHALLENGE_MINUTES = 5;
const GRANT_MINUTES_SETTING = "record_access_grant_minutes";
const GENERIC_AUTH_MESSAGE = "Unable to authorize this access.";
const CHALLENGE_GONE_MESSAGE = "This authorization is no longer valid.";
const SHARED_SESSION_MESSAGE =
  "Authorize this request from a signed-in Admin or delegated dentist account on this workstation.";
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAIL_LIMIT = 5;
const AUTH_PASSWORD_MIN = 10;
const AUTH_HASH_ROUNDS = 12;
const REVEAL_TICKET_MS = 30 * 1000;
const REVEAL_LEGACY_MESSAGE = "Reset this credential to enable viewing.";
const REVEAL_BIND_MESSAGE = "This verification is not valid for this dentist.";
const ADMIN_PASSWORD_WRONG = "Administrator password is incorrect.";
const SETUP_REQUIRED_MESSAGE = "Authorization credential setup is required.";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const authFailures = new Map();
const revealTickets = new Map();
const revealFailures = new Map();

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

const NO_TREATMENT_RELATIONSHIP_MESSAGE =
  "A confirmed appointment or an active encounter with this patient is required before the chart can be opened.";

function dentistMatchParams(dentist) {
  const ids = [];
  const names = [];
  if (dentist?.id != null) ids.push(String(dentist.id));
  if (dentist?.catalog_dentist_id) ids.push(String(dentist.catalog_dentist_id));
  const fullName = `${dentist?.first_name || ""} ${dentist?.last_name || ""}`.trim().toLowerCase();
  if (fullName) {
    names.push(fullName);
    names.push(`dr. ${fullName}`);
  }
  return { ids, names };
}

function appendEligibilityClause(params, { branchId, dentist = null } = {}) {
  if (branchId == null || branchId === "") return "FALSE";
  params.push(String(branchId));
  const branchP = params.length;
  params.push(OPEN_APPOINTMENT_STATUSES);
  const openP = params.length;
  params.push(ACTIVE_ENCOUNTER_STATUSES);
  const encounterP = params.length;
  let dentistSql = "";
  if (dentist) {
    const { ids, names } = dentistMatchParams(dentist);
    params.push(ids);
    const idP = params.length;
    params.push(names);
    const nameP = params.length;
    dentistSql = `AND (
      (cardinality($${idP}::text[]) > 0 AND appointment.dentist_id::text = ANY($${idP}::text[]))
      OR (cardinality($${nameP}::text[]) > 0 AND LOWER(TRIM(appointment.dentist_name)) = ANY($${nameP}::text[]))
    )`;
  }
  return `(
    record.linked_user_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM patient_portal_appointments AS appointment
        WHERE appointment.user_id::text = record.linked_user_id::text
          AND appointment.branch_id::text = $${branchP}
          AND appointment.status = ANY($${openP}::text[])
          ${dentistSql}
      )
      OR EXISTS (
        SELECT 1
        FROM patient_portal_queue_entries AS queue
        JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id
        WHERE queue.user_id::text = record.linked_user_id::text
          AND queue.status = ANY($${encounterP}::text[])
          AND appointment.status NOT IN ('cancelled', 'no_show', 'rescheduled', 'pending')
          AND appointment.branch_id::text = $${branchP}
          ${dentistSql}
      )
    )
  )`;
}

async function loadQualifyingRows(db, linkedUserId, branches) {
  const appointments = await db.query(
    `SELECT id, branch_id, status, dentist_id, dentist_name
     FROM patient_portal_appointments
     WHERE user_id = $1
       AND status = ANY($2::text[])
       AND branch_id::text = ANY($3::text[])`,
    [String(linkedUserId), OPEN_APPOINTMENT_STATUSES, branches]
  );
  const encounters = await db.query(
    `SELECT appointment.id, appointment.branch_id, appointment.dentist_id, appointment.dentist_name
     FROM patient_portal_queue_entries AS queue
     JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id
     WHERE queue.user_id = $1
       AND queue.status = ANY($2::text[])
       AND appointment.status NOT IN ('cancelled', 'no_show', 'rescheduled', 'pending')
       AND appointment.branch_id::text = ANY($3::text[])`,
    [String(linkedUserId), ACTIVE_ENCOUNTER_STATUSES, branches]
  );
  return [...appointments.rows, ...encounters.rows];
}

async function qualifyingRelationship(db, dentist, record, { branchId } = {}) {
  const linkedUserId = record?.linkedUserId || record?.linked_user_id || null;
  if (!dentist?.id || !linkedUserId) {
    return { allowed: false, branchIds: [] };
  }
  let branches = await authorizedBranchIds(db, dentist.id);
  if (!branches.length) return { allowed: false, branchIds: [] };
  if (branchId != null && branchId !== "") {
    if (!branches.includes(String(branchId))) {
      return { allowed: false, branchIds: [] };
    }
    branches = [String(branchId)];
  }

  let rows;
  try {
    rows = await loadQualifyingRows(db, linkedUserId, branches);
  } catch (error) {
    if (error.code === "42P01" || error.code === "42703") {
      return { allowed: false, branchIds: [] };
    }
    throw error;
  }

  const branchIds = new Set();
  for (const row of rows) {
    if (appointmentMatchesDentist(row, dentist)) branchIds.add(String(row.branch_id));
  }
  return { allowed: branchIds.size > 0, branchIds: [...branchIds] };
}

async function staffQualifyingRelationship(db, record, branchId) {
  const linkedUserId = record?.linkedUserId || record?.linked_user_id || null;
  if (!linkedUserId || branchId == null || branchId === "") {
    return { allowed: false, branchIds: [] };
  }
  let rows;
  try {
    rows = await loadQualifyingRows(db, linkedUserId, [String(branchId)]);
  } catch (error) {
    if (error.code === "42P01" || error.code === "42703") {
      return { allowed: false, branchIds: [] };
    }
    throw error;
  }
  const allowed = rows.some((row) => String(row.branch_id) === String(branchId));
  return { allowed, branchIds: allowed ? [String(branchId)] : [] };
}

function denyNoRelationship(record, { includeIdentity = false } = {}) {
  return httpError(NO_TREATMENT_RELATIONSHIP_MESSAGE, 403, {
    code: "NO_TREATMENT_RELATIONSHIP",
    ...(includeIdentity ? { patient: identityOf(record) } : {}),
  });
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

function staffCanViewTreatment(treatment, staffBranchId) {
  if (staffBranchId == null || staffBranchId === "") return false;
  const origin = treatment?.originatingBranchId || treatment?.originating_branch_id;
  if (origin == null || origin === "") return false;
  return String(origin) === String(staffBranchId);
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
  revealFailures.clear();
  revealTickets.clear();
}

function revealAttemptKey(adminId, dentistId) {
  return `reveal:${String(adminId || "")}:${String(dentistId || "")}`;
}

function assertRevealRateLimit(adminId, dentistId) {
  const key = revealAttemptKey(adminId, dentistId);
  const now = Date.now();
  const current = revealFailures.get(key);
  if (current && now - current.startedAt > AUTH_WINDOW_MS) {
    revealFailures.delete(key);
    return;
  }
  if (current && current.count >= AUTH_FAIL_LIMIT) {
    throw httpError("Too many verification attempts. Please wait 15 minutes and try again.", 429);
  }
}

function recordRevealFailure(adminId, dentistId) {
  const key = revealAttemptKey(adminId, dentistId);
  const now = Date.now();
  const current = revealFailures.get(key);
  if (!current || now - current.startedAt > AUTH_WINDOW_MS) {
    revealFailures.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
}

function clearRevealFailure(adminId, dentistId) {
  revealFailures.delete(revealAttemptKey(adminId, dentistId));
}

function purgeRevealTickets(now = Date.now()) {
  for (const [token, row] of revealTickets.entries()) {
    if (!row || row.expiresAt <= now) revealTickets.delete(token);
  }
}

function issueRevealTicket({ adminId, dentistId, sessionId }) {
  purgeRevealTickets();
  const token = crypto.randomBytes(32).toString("hex");
  revealTickets.set(token, {
    adminId: String(adminId),
    dentistId: String(dentistId),
    sessionId: String(sessionId || adminId),
    expiresAt: Date.now() + REVEAL_TICKET_MS,
  });
  return token;
}

function consumeRevealTicket(token, { adminId, dentistId, sessionId }) {
  purgeRevealTickets();
  const key = String(token || "");
  const row = revealTickets.get(key);
  if (row) revealTickets.delete(key);
  if (!row || row.expiresAt <= Date.now()) {
    throw httpError("Administrator verification expired. Verify again to view this credential.", 403);
  }
  if (row.adminId !== String(adminId) || row.sessionId !== String(sessionId || adminId) || row.dentistId !== String(dentistId)) {
    throw httpError(REVEAL_BIND_MESSAGE, 403);
  }
}

function adminActorName(admin) {
  return `${admin?.first_name || admin?.firstName || ""} ${admin?.last_name || admin?.lastName || ""}`.trim() || null;
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

  const approvalCode = await uniqueApprovalCode(db);
  const inserted = await db.query(
    `INSERT INTO record_access_challenges (
       clinical_record_id, patient_user_id, requesting_dentist_id, requesting_branch_id,
       originating_branch_id, reason, scope, legacy_request_id, approval_code, expires_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP + ($10 || ' minutes')::interval
     )
     RETURNING id, approval_code, expires_at, requesting_dentist_id, requesting_branch_id,
               originating_branch_id, scope, reason, clinical_record_id`,
    [
      record.id,
      record.linkedUserId || record.linked_user_id || null,
      String(req.dentist.id),
      requestBranch,
      originBranch,
      text.slice(0, 500),
      payload.scope,
      pending.rows[0]?.id || null,
      approvalCode,
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

function normalizeApprovalCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function randomApprovalCode() {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return code;
}

async function uniqueApprovalCode(db) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomApprovalCode();
    const existing = await db.query(
      `SELECT id FROM record_access_challenges WHERE approval_code = $1 AND consumed_at IS NULL LIMIT 1`,
      [code]
    );
    if (!existing.rows[0]) return code;
  }
  throw httpError("Unable to start record authorization.", 500);
}

function hasAuthorizationHash(row) {
  return Boolean(row?.authorization_password_hash) || row?.has_authorization_credential === true;
}

function presentAuthorization(row = {}) {
  const canApprove = row.can_approve_cross_branch_access === true;
  const hasHash = hasAuthorizationHash(row);
  const configured = canApprove && hasHash;
  const stored = String(row.authorization_credential_status || "").toLowerCase();
  let authorizationCredentialStatus = "none";
  if (hasHash || stored === "configured") authorizationCredentialStatus = "configured";
  else if (canApprove) authorizationCredentialStatus = "setup_required";
  else if (stored === "revoked") authorizationCredentialStatus = "revoked";
  return {
    canApproveCrossBranchAccess: canApprove,
    authorizationCredentialStatus,
    setupRequired: authorizationCredentialStatus === "setup_required",
    credentialConfigured: configured,
    credentialViewable:
      hasHash &&
      (row.has_recoverable_secret === true || Boolean(row.authorization_password_ciphertext)),
  };
}

function accountIsActive(row) {
  if (row?.is_archived) return false;
  const status = String(row?.status || "active").toLowerCase();
  return !["inactive", "disabled", "suspended", "rejected", "pending", "unverified"].includes(status);
}

function approverAccountEligible(row, { requireCredential = true } = {}) {
  if (!accountIsActive(row)) return false;
  const role = String(row.role || "").toLowerCase();
  if (role === "admin") return true;
  if (!row?.is_verified) return false;
  if (role !== "dentist" || row.can_approve_cross_branch_access !== true) return false;
  if (!requireCredential) return true;
  return hasAuthorizationHash(row);
}

function tokenAdminApprover(user) {
  if (String(user?.role || "").toLowerCase() !== "admin" || !user?.id) return null;
  return {
    id: user.id,
    first_name: user.first_name || user.firstName || "",
    last_name: user.last_name || user.lastName || "",
    role: "admin",
    can_approve_cross_branch_access: false,
  };
}

function mapApproverRow(row) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    role: String(row.role || "").toLowerCase(),
    can_approve_cross_branch_access: row.can_approve_cross_branch_access === true,
    has_authorization_credential: hasAuthorizationHash(row),
    authorization_credential_status: row.authorization_credential_status || null,
    authorization_password_hash: row.authorization_password_hash || null,
  };
}

async function sessionApproverStatus(db, user) {
  const role = String(user?.role || "").toLowerCase();
  if (role === "admin") {
    return {
      eligible: true,
      role,
      canApproveCrossBranchAccess: false,
      authorizationCredentialStatus: "none",
      setupRequired: false,
      credentialConfigured: false,
    };
  }
  const approver = await loadSessionApprover(db, user, { requireCredential: false });
  const presented = presentAuthorization(approver || {});
  return {
    eligible: Boolean(approver) && presented.credentialConfigured,
    role,
    ...presented,
  };
}

async function loadSessionApprover(db, user, { requireCredential = true } = {}) {
  if (!user?.id) return null;
  try {
    const result = await db.query(
      `SELECT account.id, account.first_name, account.last_name, account.role, account.status,
              account.is_verified, account.is_archived, profile.can_approve_cross_branch_access,
              profile.authorization_password_hash, profile.authorization_credential_status,
              profile.authorization_password_ciphertext
       FROM users AS account
       LEFT JOIN admin_portal_dentist_profiles AS profile
         ON profile.user_id::text = account.id::text
       WHERE account.id::text = $1
       LIMIT 1`,
      [String(user.id)]
    );
    const row = result.rows[0];
    if (row && approverAccountEligible(row, { requireCredential })) {
      return mapApproverRow(row);
    }
    if (String(row?.role || user.role || "").toLowerCase() === "admin" && approverAccountEligible({
      ...row,
      role: "admin",
      is_archived: row?.is_archived === true,
      status: row?.status || user.status || "active",
    })) {
      return tokenAdminApprover({ ...user, ...row, role: "admin" });
    }
    return null;
  } catch (error) {
    if (error.code === "42703" && String(error.message || "").includes("authorization_password_ciphertext")) {
      try {
        const result = await db.query(
          `SELECT account.id, account.first_name, account.last_name, account.role, account.status,
                  account.is_verified, account.is_archived, profile.can_approve_cross_branch_access,
                  profile.authorization_password_hash, profile.authorization_credential_status
           FROM users AS account
           LEFT JOIN admin_portal_dentist_profiles AS profile
             ON profile.user_id::text = account.id::text
           WHERE account.id::text = $1
           LIMIT 1`,
          [String(user.id)]
        );
        const row = result.rows[0];
        if (row && approverAccountEligible(row, { requireCredential })) {
          return mapApproverRow(row);
        }
      } catch (fallbackError) {
        if (fallbackError.code !== "42703" && fallbackError.code !== "42P01") throw fallbackError;
      }
    }
    if (error.code === "42703" || error.code === "42P01") {
      if (String(user?.role || "").toLowerCase() === "admin") return tokenAdminApprover(user);
      return null;
    }
    throw error;
  }
}

function presentStoredAuthorization(row = {}) {
  return presentAuthorization({
    ...row,
    has_authorization_credential: Boolean(row.authorization_password_hash),
    has_recoverable_secret: Boolean(row.authorization_password_ciphertext),
  });
}

async function loadDentistAuthorization(db, dentistId) {
  try {
    const result = await db.query(
      `SELECT can_approve_cross_branch_access, authorization_password_hash, authorization_credential_status,
              authorization_password_ciphertext
       FROM admin_portal_dentist_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [String(dentistId)]
    );
    return presentStoredAuthorization(result.rows[0] || {});
  } catch (error) {
    if (error.code === "42703") {
      try {
        const result = await db.query(
          `SELECT can_approve_cross_branch_access, authorization_password_hash, authorization_credential_status
           FROM admin_portal_dentist_profiles
           WHERE user_id = $1
           LIMIT 1`,
          [String(dentistId)]
        );
        return presentStoredAuthorization(result.rows[0] || {});
      } catch (fallbackError) {
        if (fallbackError.code === "42703" || fallbackError.code === "42P01") {
          return presentAuthorization({});
        }
        throw fallbackError;
      }
    }
    if (error.code === "42P01") {
      return presentAuthorization({});
    }
    throw error;
  }
}

async function attachDentistAuthorization(db, accounts) {
  if (!accounts?.length) return accounts;
  for (const account of accounts) {
    Object.assign(account, presentAuthorization({}));
  }
  try {
    const flags = await db.query(
      `SELECT user_id, can_approve_cross_branch_access, authorization_password_hash, authorization_credential_status,
              authorization_password_ciphertext
       FROM admin_portal_dentist_profiles
       WHERE user_id = ANY($1::text[])`,
      [accounts.map((account) => String(account.id))]
    );
    const byUser = new Map(flags.rows.map((row) => [String(row.user_id), row]));
    for (const account of accounts) {
      Object.assign(account, presentAuthorization(byUser.get(String(account.id)) || {}));
    }
  } catch (error) {
    if (error.code === "42703") {
      try {
        const flags = await db.query(
          `SELECT user_id, can_approve_cross_branch_access, authorization_password_hash, authorization_credential_status
           FROM admin_portal_dentist_profiles
           WHERE user_id = ANY($1::text[])`,
          [accounts.map((account) => String(account.id))]
        );
        const byUser = new Map(flags.rows.map((row) => [String(row.user_id), row]));
        for (const account of accounts) {
          Object.assign(account, presentAuthorization(byUser.get(String(account.id)) || {}));
        }
        return accounts;
      } catch (hashFallbackError) {
        if (hashFallbackError.code !== "42703") {
          if (hashFallbackError.code === "42P01") return accounts;
          throw hashFallbackError;
        }
      }
      try {
        const flags = await db.query(
          `SELECT user_id, can_approve_cross_branch_access
           FROM admin_portal_dentist_profiles
           WHERE user_id = ANY($1::text[])`,
          [accounts.map((account) => String(account.id))]
        );
        const byUser = new Map(flags.rows.map((row) => [String(row.user_id), row]));
        for (const account of accounts) {
          Object.assign(account, presentAuthorization(byUser.get(String(account.id)) || {}));
        }
      } catch (fallbackError) {
        if (fallbackError.code !== "42703" && fallbackError.code !== "42P01") throw fallbackError;
      }
    } else if (error.code !== "42P01") {
      throw error;
    }
  }
  return accounts;
}

async function assertActiveDentist(db, dentistId) {
  const result = await db.query(
    `SELECT id, first_name, last_name, role, status, is_verified, is_archived, password_hash
     FROM users
     WHERE id::text = $1
       AND LOWER(role) = 'dentist'
     LIMIT 1`,
    [String(dentistId)]
  );
  const dentist = result.rows[0];
  if (!dentist || dentist.is_archived) {
    throw httpError("Dentist record not found.", 404);
  }
  return dentist;
}

async function setAuthorizationCredential(db, admin, dentistId, { password, confirmPassword }) {
  const plain = String(password || "");
  const confirm = String(confirmPassword == null ? password : confirmPassword);
  if (plain.length < AUTH_PASSWORD_MIN) {
    throw httpError("Authorization password must be at least 10 characters long.", 400);
  }
  if (plain !== confirm) {
    throw httpError("Authorization password and confirmation do not match.", 400);
  }
  if (/^•+$/.test(plain)) {
    throw httpError("Enter a new authorization password. The masked indicator is not a password.", 400);
  }
  const dentist = await assertActiveDentist(db, dentistId);
  if (dentist.password_hash && (await bcrypt.compare(plain, dentist.password_hash))) {
    throw httpError("Choose an authorization password that is different from the sign-in password.", 400);
  }
  const secret = encryptAuthorizationPassword(plain);
  const previous = await loadDentistAuthorization(db, dentist.id);
  const hash = await bcrypt.hash(plain, AUTH_HASH_ROUNDS);
  try {
    await db.query(
      `INSERT INTO admin_portal_dentist_profiles (
         user_id, can_approve_cross_branch_access, authorization_password_hash, authorization_credential_status,
         authorization_password_ciphertext, authorization_secret_key_id, updated_at
       ) VALUES ($1, TRUE, $2, 'configured', $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         can_approve_cross_branch_access = TRUE,
         authorization_password_hash = EXCLUDED.authorization_password_hash,
         authorization_credential_status = 'configured',
         authorization_password_ciphertext = EXCLUDED.authorization_password_ciphertext,
         authorization_secret_key_id = EXCLUDED.authorization_secret_key_id,
         updated_at = CURRENT_TIMESTAMP`,
      [String(dentist.id), hash, secret.ciphertext, secret.keyId]
    );
  } catch (error) {
    if (error.code === "42703") {
      throw httpError("Apply the authorization credential secret migration before saving a viewable credential.", 503);
    }
    throw error;
  }
  const action = previous.credentialConfigured ? "record_access_credential_reset" : "record_access_credential_set";
  await writeAdminAudit(db, {
    actorId: admin?.id,
    actorName: `${admin?.first_name || admin?.firstName || ""} ${admin?.last_name || admin?.lastName || ""}`.trim() || null,
    actorRole: admin?.role || "admin",
    action,
    targetType: "dentist",
    targetId: String(dentist.id),
    targetLabel: `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim() || null,
    detail: previous.credentialConfigured
      ? "Authorization credential replaced. Permission preserved."
      : "Authorization credential configured. Cross-branch approval permission enabled.",
  });
  return loadDentistAuthorization(db, dentist.id);
}

async function revokeAuthorizationCredential(db, admin, dentistId) {
  const dentist = await assertActiveDentist(db, dentistId);
  try {
    await db.query(
      `INSERT INTO admin_portal_dentist_profiles (
         user_id, can_approve_cross_branch_access, authorization_password_hash, authorization_credential_status,
         authorization_password_ciphertext, authorization_secret_key_id, updated_at
       ) VALUES ($1, FALSE, NULL, 'revoked', NULL, NULL, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         can_approve_cross_branch_access = FALSE,
         authorization_password_hash = NULL,
         authorization_credential_status = 'revoked',
         authorization_password_ciphertext = NULL,
         authorization_secret_key_id = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [String(dentist.id)]
    );
  } catch (error) {
    if (error.code !== "42703") throw error;
    await db.query(
      `INSERT INTO admin_portal_dentist_profiles (
         user_id, can_approve_cross_branch_access, authorization_password_hash, authorization_credential_status, updated_at
       ) VALUES ($1, FALSE, NULL, 'revoked', CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         can_approve_cross_branch_access = FALSE,
         authorization_password_hash = NULL,
         authorization_credential_status = 'revoked',
         updated_at = CURRENT_TIMESTAMP`,
      [String(dentist.id)]
    );
  }
  await writeAdminAudit(db, {
    actorId: admin?.id,
    actorName: `${admin?.first_name || admin?.firstName || ""} ${admin?.last_name || admin?.lastName || ""}`.trim() || null,
    actorRole: admin?.role || "admin",
    action: "record_access_credential_revoked",
    targetType: "dentist",
    targetId: String(dentist.id),
    targetLabel: `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim() || null,
    detail: "Authorization credential revoked. Cross-branch approval permission removed.",
  });
  return loadDentistAuthorization(db, dentist.id);
}

async function loadRecoverableCredential(db, dentistId) {
  const result = await db.query(
    `SELECT authorization_password_hash, authorization_password_ciphertext, authorization_credential_status,
            can_approve_cross_branch_access
     FROM admin_portal_dentist_profiles
     WHERE user_id = $1
     LIMIT 1`,
    [String(dentistId)]
  );
  return result.rows[0] || {};
}

async function verifyAdminForCredentialReveal(db, admin, dentistId, adminPassword, req) {
  if (String(admin?.role || "").toLowerCase() !== "admin") {
    throw httpError("Only an administrator can view this credential.", 403);
  }
  const dentist = await assertActiveDentist(db, dentistId);
  assertRevealRateLimit(admin.id, dentist.id);
  const plain = String(adminPassword || "");
  if (!plain) {
    throw httpError("Enter your administrator login password.", 400);
  }
  const matched = await bcrypt.compare(plain, admin.password_hash || "");
  if (!matched) {
    recordRevealFailure(admin.id, dentist.id);
    await writeAdminAudit(db, {
      actorId: admin.id,
      actorName: adminActorName(admin),
      actorRole: "admin",
      action: "record_access_credential_reveal_failed",
      targetType: "dentist",
      targetId: String(dentist.id),
      targetLabel: `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim() || null,
      result: "blocked",
      detail: "Administrator password was rejected. No credential was returned.",
      ipAddress: req?.ip || null,
      sessionId: String(admin.id),
    });
    throw httpError(ADMIN_PASSWORD_WRONG, 401);
  }
  clearRevealFailure(admin.id, dentist.id);
  const stored = await loadRecoverableCredential(db, dentist.id);
  const presented = presentStoredAuthorization(stored);
  const verificationToken = issueRevealTicket({
    adminId: admin.id,
    dentistId: dentist.id,
    sessionId: admin.id,
  });
  return {
    verificationToken,
    expiresInSeconds: Math.round(REVEAL_TICKET_MS / 1000),
    credentialConfigured: presented.credentialConfigured,
    credentialViewable: presented.credentialViewable,
    authorizationCredentialStatus: presented.authorizationCredentialStatus,
    message: presented.credentialConfigured && !presented.credentialViewable ? REVEAL_LEGACY_MESSAGE : undefined,
  };
}

async function revealAuthorizationCredential(db, admin, dentistId, verificationToken, req) {
  if (String(admin?.role || "").toLowerCase() !== "admin") {
    throw httpError("Only an administrator can view this credential.", 403);
  }
  const dentist = await assertActiveDentist(db, dentistId);
  consumeRevealTicket(verificationToken, {
    adminId: admin.id,
    dentistId: dentist.id,
    sessionId: admin.id,
  });
  const stored = await loadRecoverableCredential(db, dentist.id);
  const presented = presentStoredAuthorization(stored);
  if (!presented.credentialConfigured) {
    await writeAdminAudit(db, {
      actorId: admin.id,
      actorName: adminActorName(admin),
      actorRole: "admin",
      action: "record_access_credential_reveal_denied",
      targetType: "dentist",
      targetId: String(dentist.id),
      targetLabel: `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim() || null,
      result: "blocked",
      detail: "Reveal requested but no authorization credential is configured.",
      ipAddress: req?.ip || null,
      sessionId: String(admin.id),
    });
    throw httpError("No authorization credential is set for this dentist.", 404);
  }
  if (!presented.credentialViewable) {
    await writeAdminAudit(db, {
      actorId: admin.id,
      actorName: adminActorName(admin),
      actorRole: "admin",
      action: "record_access_credential_reveal_denied",
      targetType: "dentist",
      targetId: String(dentist.id),
      targetLabel: `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim() || null,
      result: "blocked",
      detail: "Legacy hash-only credential cannot be viewed. Reset is required.",
      ipAddress: req?.ip || null,
      sessionId: String(admin.id),
    });
    return {
      credentialViewable: false,
      credentialConfigured: true,
      message: REVEAL_LEGACY_MESSAGE,
    };
  }
  const password = decryptAuthorizationPassword(stored.authorization_password_ciphertext);
  await writeAdminAudit(db, {
    actorId: admin.id,
    actorName: adminActorName(admin),
    actorRole: "admin",
    action: "record_access_credential_revealed",
    targetType: "dentist",
    targetId: String(dentist.id),
    targetLabel: `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim() || null,
    detail: "Administrator viewed the authorization credential after login-password verification.",
    ipAddress: req?.ip || null,
    sessionId: String(admin.id),
  });
  return {
    credentialViewable: true,
    credentialConfigured: true,
    password,
  };
}

async function verifyApproverPassword(db, approver, password, req) {
  const role = String(approver?.role || "").toLowerCase();
  if (role === "admin") return;
  const presented = presentAuthorization(approver);
  if (presented.setupRequired || !presented.credentialConfigured) {
    recordAuthFailure(String(req.user?.id || req.ip), req.ip);
    throw httpError(SETUP_REQUIRED_MESSAGE, 403);
  }
  const plain = String(password || "");
  if (!plain) {
    recordAuthFailure(String(req.user?.id || req.ip), req.ip);
    throw httpError("Enter the authorization password.", 400);
  }
  const matched = await bcrypt.compare(plain, approver.authorization_password_hash || "");
  if (!matched) {
    recordAuthFailure(String(req.user?.id || req.ip), req.ip);
    await writeAdminAudit(db, {
      actorId: approver.id,
      actorRole: "dentist",
      action: "record_access_authorize_failed",
      targetType: "record_access_challenge",
      result: "failure",
      detail: "Authorization password was rejected.",
    });
    throw httpError(GENERIC_AUTH_MESSAGE, 401);
  }
}

function normalizeLicenseNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function loadDentistUnlockProfile(db, dentistId) {
  const result = await db.query(
    `SELECT account.id, account.first_name, account.last_name, account.role, account.status,
            account.is_verified, account.is_archived, account.password_hash,
            profile.can_approve_cross_branch_access, profile.authorization_password_hash,
            profile.authorization_credential_status, profile.license_number, profile.license_verified
     FROM users AS account
     LEFT JOIN admin_portal_dentist_profiles AS profile
       ON profile.user_id::text = account.id::text
     WHERE account.id::text = $1
     LIMIT 1`,
    [String(dentistId)]
  );
  return result.rows[0] || null;
}

async function issuePermittedGrants(client, { dentistId, record, requestingBranchId, originatingBranchIds, minutes }) {
  const grants = [];
  const reason = "Verified authorization credential for permitted cross-branch history.";
  for (const originatingBranchId of originatingBranchIds) {
    for (const scope of RESTRICTED_SCOPES) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('record-grant'), hashtext($1))`, [
        `${dentistId}:${record.id}:${originatingBranchId}:${scope}`,
      ]);
      const created = await client.query(
        `INSERT INTO record_access_requests (
           clinical_record_id, patient_user_id, requesting_dentist_id, requesting_branch_id,
           originating_branch_id, reason, scope, status, decided_at, decided_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', CURRENT_TIMESTAMP, $3)
         RETURNING id`,
        [
          record.id,
          record.linkedUserId || record.linked_user_id || null,
          String(dentistId),
          requestingBranchId,
          originatingBranchId,
          reason,
          scope,
        ]
      );
      const requestId = created.rows[0].id;
      let grant;
      try {
        grant = await client.query(
          `INSERT INTO record_access_grants (
             request_id, requesting_dentist_id, clinical_record_id, originating_branch_id, scope, expires_at
           ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + ($6 || ' minutes')::interval)
           RETURNING id, status, expires_at, scope, originating_branch_id`,
          [requestId, String(dentistId), record.id, originatingBranchId, scope, String(minutes)]
        );
      } catch (error) {
        if (error.code !== "23505") throw error;
        grant = await client.query(
          `UPDATE record_access_grants
           SET expires_at = CURRENT_TIMESTAMP + ($5 || ' minutes')::interval, status = 'active'
           WHERE requesting_dentist_id = $1
             AND clinical_record_id = $2
             AND originating_branch_id = $3
             AND scope = $4
             AND status = 'active'
           RETURNING id, status, expires_at, scope, originating_branch_id`,
          [String(dentistId), record.id, originatingBranchId, scope, String(minutes)]
        );
      }
      await client.query(
        `INSERT INTO record_access_decisions (request_id, actor_id, actor_role, action)
         VALUES ($1, $2, 'dentist', 'self_unlocked')`,
        [requestId, String(dentistId)]
      );
      if (grant.rows[0]) grants.push(grant.rows[0]);
    }
  }
  return grants;
}

async function unlockOwnRecordAccess(db, req, { record, licenseNumber, password }) {
  const dentistId = String(req.dentist?.id || req.user?.id || "");
  assertAuthRateLimit(dentistId, req.ip);
  if (!record?.id) {
    recordAuthFailure(dentistId, req.ip);
    throw httpError("Patient record not found.", 404);
  }

  let profile;
  try {
    profile = await loadDentistUnlockProfile(db, dentistId);
  } catch (error) {
    if (error.code === "42703" || error.code === "42P01") {
      throw httpError("Authorization credential setup is required.", 403);
    }
    throw error;
  }
  if (!profile || !accountIsActive(profile) || String(profile.role || "").toLowerCase() !== "dentist") {
    recordAuthFailure(dentistId, req.ip);
    throw httpError("This dashboard is available to active dentist accounts only.", 403);
  }
  const presented = presentAuthorization(profile);
  if (!presented.credentialConfigured) {
    recordAuthFailure(dentistId, req.ip);
    throw httpError(
      presented.setupRequired
        ? SETUP_REQUIRED_MESSAGE
        : "You are not authorized to open restricted records.",
      403
    );
  }

  const storedLicense = normalizeLicenseNumber(profile.license_number);
  const enteredLicense = normalizeLicenseNumber(licenseNumber);
  if (!profile.license_verified || !storedLicense) {
    recordAuthFailure(dentistId, req.ip);
    throw httpError("A verified license number is required before accessing restricted records.", 403);
  }
  if (!enteredLicense || enteredLicense !== storedLicense) {
    recordAuthFailure(dentistId, req.ip);
    await writeAdminAudit(db, {
      actorId: dentistId,
      actorRole: "dentist",
      action: "record_access_unlock_failed",
      targetType: "clinical_record",
      targetId: String(record.id),
      result: "failure",
      detail: "License number did not match this dentist.",
    });
    throw httpError("That license number does not belong to this dentist.", 403);
  }

  const plain = String(password || "");
  if (!plain) {
    recordAuthFailure(dentistId, req.ip);
    throw httpError("Enter the authorization password.", 400);
  }
  const matched = await bcrypt.compare(plain, profile.authorization_password_hash || "");
  if (!matched) {
    recordAuthFailure(dentistId, req.ip);
    await writeAdminAudit(db, {
      actorId: dentistId,
      actorRole: "dentist",
      action: "record_access_unlock_failed",
      targetType: "clinical_record",
      targetId: String(record.id),
      result: "failure",
      detail: "Authorization password was rejected.",
    });
    throw httpError(GENERIC_AUTH_MESSAGE, 401);
  }

  const relationship = await qualifyingRelationship(db, req.dentist, record);
  if (!relationship.allowed) {
    recordAuthFailure(dentistId, req.ip);
    throw httpError(
      "A confirmed appointment or an active encounter with this patient is required before requesting more of the chart.",
      403,
      { patient: identityOf(record), code: "NO_TREATMENT_RELATIONSHIP" }
    );
  }

  const requestingBranchId = Number(req.branchAccess?.activeBranch?.id);
  if (!Number.isSafeInteger(requestingBranchId)) {
    throw httpError("Choose the branch you are working from.", 400);
  }
  if (!relationship.branchIds.map(String).includes(String(requestingBranchId))) {
    throw httpError("Request the chart from a branch where you are seeing this patient.", 403);
  }

  const assigned = await authorizedBranchIds(db, dentistId);
  const originatingBranchIds = assigned
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id));
  if (!originatingBranchIds.length) {
    throw httpError("You cannot open restricted records for this branch.", 403);
  }

  const minutes = await loadGrantMinutes(db);
  const client = await db.connect();
  let grants;
  try {
    await client.query("BEGIN");
    grants = await issuePermittedGrants(client, {
      dentistId,
      record,
      requestingBranchId,
      originatingBranchIds,
      minutes,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  clearAuthFailure(dentistId, req.ip);
  const expiresAt = grants
    .map((row) => row.expires_at)
    .filter(Boolean)
    .sort()[0] || null;
  await writeAdminAudit(db, {
    actorId: dentistId,
    actorName: `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || null,
    actorRole: "dentist",
    action: "record_access_self_unlocked",
    targetType: "clinical_record",
    targetId: String(record.id),
    targetLabel: identityOf(record)?.patientId || null,
    detail: `Read-only grant ${minutes} minutes for ${originatingBranchIds.length} permitted origin(s) and ${RESTRICTED_SCOPES.length} scopes.`,
  });
  return {
    minutes,
    expiresAt,
    grants: grants.map((row) => ({
      id: row.id,
      status: row.status,
      expiresAt: row.expires_at,
      scope: row.scope,
      originatingBranchId: row.originating_branch_id,
    })),
  };
}

function rejectSharedSessionAuthorize() {
  throw httpError(SHARED_SESSION_MESSAGE, 410);
}

async function requesterChallengeStatus(db, req, { recordId, challengeId }) {
  const result = await db.query(
    `SELECT id, clinical_record_id, requesting_dentist_id, requesting_branch_id, originating_branch_id,
            scope, reason, approval_code, expires_at, consumed_at
     FROM record_access_challenges
     WHERE id = $1
     LIMIT 1`,
    [challengeId]
  );
  const challenge = result.rows[0];
  if (!challenge || String(challenge.requesting_dentist_id) !== String(req.dentist.id)) {
    throw httpError("Access request not found.", 404);
  }
  if (recordId && Number(challenge.clinical_record_id) !== Number(recordId)) {
    throw httpError("Access request not found.", 404);
  }
  const grant = challenge.consumed_at
    ? await db.query(
        `SELECT id, status, expires_at, scope
         FROM record_access_grants
         WHERE requesting_dentist_id = $1
           AND clinical_record_id = $2
           AND originating_branch_id = $3
           AND scope = $4
         ORDER BY id DESC
         LIMIT 1`,
        [
          challenge.requesting_dentist_id,
          challenge.clinical_record_id,
          challenge.originating_branch_id,
          challenge.scope,
        ]
      )
    : { rows: [] };
  const expired = !challenge.consumed_at && new Date(challenge.expires_at).getTime() <= Date.now();
  let status = "pending";
  if (challenge.consumed_at && grant.rows[0]?.status === "active") status = "approved";
  else if (challenge.consumed_at) status = "consumed";
  else if (expired) status = "expired";
  return {
    id: challenge.id,
    approvalCode: challenge.approval_code,
    status,
    expiresAt: challenge.expires_at,
    scope: challenge.scope,
    reason: challenge.reason,
    requestingBranchId: challenge.requesting_branch_id,
    originatingBranchId: challenge.originating_branch_id,
    grant: grant.rows[0]
      ? {
          id: grant.rows[0].id,
          status: grant.rows[0].status,
          expiresAt: grant.rows[0].expires_at,
          scope: grant.rows[0].scope,
        }
      : null,
  };
}

async function previewChallenge(db, req, code) {
  const approvalCode = normalizeApprovalCode(code);
  assertAuthRateLimit(String(req.user?.id || req.ip), req.ip);
  if (!approvalCode) {
    recordAuthFailure(String(req.user?.id || req.ip), req.ip);
    throw httpError(CHALLENGE_GONE_MESSAGE, 404);
  }
  const approver = await loadSessionApprover(db, req.user);
  if (!approver) {
    recordAuthFailure(String(req.user?.id || req.ip), req.ip);
    throw httpError("You cannot authorize this record access.", 403);
  }
  const result = await db.query(
    `SELECT challenge.*, requester.first_name AS requester_first_name, requester.last_name AS requester_last_name,
            record.record_code, record.patient_id, record.first_name AS patient_first_name, record.last_name AS patient_last_name
     FROM record_access_challenges AS challenge
     LEFT JOIN users AS requester ON requester.id::text = challenge.requesting_dentist_id
     LEFT JOIN clinic_patient_records AS record ON record.id = challenge.clinical_record_id
     WHERE challenge.approval_code = $1
     LIMIT 1`,
    [approvalCode]
  );
  const challenge = result.rows[0];
  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
    recordAuthFailure(String(req.user?.id || req.ip), req.ip);
    throw httpError(CHALLENGE_GONE_MESSAGE, 404);
  }
  if (String(approver.id) === String(challenge.requesting_dentist_id)) {
    throw httpError("You cannot authorize your own record access.", 403);
  }
  const allowed = await approverMayDecide(db, approver, {
    requesting_dentist_id: challenge.requesting_dentist_id,
    originating_branch_id: challenge.originating_branch_id,
  });
  if (!allowed) {
    throw httpError("You cannot authorize records for this branch.", 403);
  }
  clearAuthFailure(String(req.user?.id || req.ip), req.ip);
  return {
    approvalCode: challenge.approval_code,
    expiresAt: challenge.expires_at,
    scope: challenge.scope,
    reason: challenge.reason,
    requestingBranchId: challenge.requesting_branch_id,
    originatingBranchId: challenge.originating_branch_id,
    requesterName: `${challenge.requester_first_name || ""} ${challenge.requester_last_name || ""}`.trim() || null,
    patient: {
      id: challenge.clinical_record_id,
      patientId: challenge.patient_id || challenge.record_code || null,
      fullName: `${challenge.patient_first_name || ""} ${challenge.patient_last_name || ""}`.trim() || null,
    },
  };
}

async function authorizeChallenge(db, req, { code, authorizationPassword }) {
  const approvalCode = normalizeApprovalCode(code);
  assertAuthRateLimit(String(req.user?.id || req.ip), req.ip);
  if (!approvalCode) {
    recordAuthFailure(String(req.user?.id || req.ip), req.ip);
    throw httpError(CHALLENGE_GONE_MESSAGE, 404);
  }

  const approver = await loadSessionApprover(db, req.user, { requireCredential: false });
  if (!approver) {
    recordAuthFailure(String(req.user?.id || req.ip), req.ip);
    await writeAdminAudit(db, {
      actorId: req.user?.id,
      actorRole: String(req.user?.role || "user").toLowerCase(),
      action: "record_access_authorize_failed",
      targetType: "record_access_challenge",
      result: "failure",
      detail: "Approver session is not eligible.",
    });
    throw httpError("You cannot authorize this record access.", 403);
  }
  await verifyApproverPassword(db, approver, authorizationPassword, req);
  if (String(approver.role || "").toLowerCase() !== "admin" && !presentAuthorization(approver).credentialConfigured) {
    throw httpError(SETUP_REQUIRED_MESSAGE, 403);
  }
  clearAuthFailure(String(req.user?.id || req.ip), req.ip);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM record_access_challenges WHERE approval_code = $1 FOR UPDATE`,
      [approvalCode]
    );
    const challenge = locked.rows[0];
    if (!challenge) {
      await client.query("ROLLBACK");
      throw httpError(CHALLENGE_GONE_MESSAGE, 404);
    }
    if (challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      throw httpError(CHALLENGE_GONE_MESSAGE, 409);
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
      grant: grant.rows[0]
        ? {
            id: grant.rows[0].id,
            status: grant.rows[0].status,
            expires_at: grant.rows[0].expires_at,
            scope: grant.rows[0].scope,
          }
        : null,
      requestId,
      minutes,
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
  CHALLENGE_GONE_MESSAGE,
  SHARED_SESSION_MESSAGE,
  RESTRICTED_SCOPES,
  OPEN_APPOINTMENT_STATUSES,
  ACTIVE_ENCOUNTER_STATUSES,
  NO_TREATMENT_RELATIONSHIP_MESSAGE,
  identityOf,
  authorizedBranchIds,
  dentistMatchParams,
  appendEligibilityClause,
  qualifyingRelationship,
  staffQualifyingRelationship,
  denyNoRelationship,
  activeGrants,
  restrictedAllowed,
  staffCanViewTreatment,
  presentTreatment,
  createRequest,
  createChallenge,
  authorizeChallenge,
  previewChallenge,
  requesterChallengeStatus,
  rejectSharedSessionAuthorize,
  loadSessionApprover,
  sessionApproverStatus,
  presentAuthorization,
  assertActiveDentist,
  attachDentistAuthorization,
  loadDentistAuthorization,
  setAuthorizationCredential,
  revokeAuthorizationCredential,
  verifyAdminForCredentialReveal,
  revealAuthorizationCredential,
  unlockOwnRecordAccess,
  decideRequest,
  approverMayDecide,
  loadGrantMinutes,
  saveGrantMinutes,
  clampGrantMinutes,
  resetAuthFailures,
  audit,
};
