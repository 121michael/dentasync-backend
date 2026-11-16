"use strict";

const { writeAdminAudit } = require("./adminAudit");

// Grants last 30 minutes. If Admin configuration is added later, the allowed
// range is 15 to 240 minutes. Do not expose a setting until that range is accepted.
const GRANT_MINUTES = 30;
const GRANT_RANGE_MINUTES = { min: 15, max: 240 };

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
      `SELECT originating_branch_id, scope
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
    } else if (decision === "denied") {
      await client.query(
        `UPDATE record_access_requests SET status = 'denied', decided_at = CURRENT_TIMESTAMP, decided_by = $2 WHERE id = $1`,
        [request.id, String(approver.id)]
      );
    } else {
      await client.query(
        `UPDATE record_access_requests SET status = 'approved', decided_at = CURRENT_TIMESTAMP, decided_by = $2 WHERE id = $1`,
        [request.id, String(approver.id)]
      );
      try {
        await client.query(
          `INSERT INTO record_access_grants (
             request_id, requesting_dentist_id, clinical_record_id, originating_branch_id, scope, expires_at
           ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + ($6 || ' minutes')::interval)`,
          [
            request.id,
            request.requesting_dentist_id,
            request.clinical_record_id,
            request.originating_branch_id,
            request.scope,
            String(GRANT_MINUTES),
          ]
        );
      } catch (error) {
        if (error.code !== "23505") throw error;
      }
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
    return { request: { ...request, status: decision === "approved" ? "approved" : decision }, grant: grant.rows[0] || null };
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
  decideRequest,
  approverMayDecide,
  audit,
};
