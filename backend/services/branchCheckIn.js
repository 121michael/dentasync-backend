"use strict";

const fs = require("fs");
const path = require("path");

// Late arrival, grace period, and automatic no-show are not defined in the
// stored clinic rules. Phase 4 does not invent a cutoff. An earlier appointment
// keeps its waiting place after check-in, even when a later appointment checked
// in first. No-show stays a manual staff or dentist action.
const LATE_ARRIVAL_POLICY = "undefined";

const NO_TIME_MESSAGE =
  "This appointment has no preferred time. It still joins this branch queue after timed visits for the same day.";

const QUEUE_ORDER_SQL = `
  CASE
    WHEN queue.status IN ('dentist', 'preparing') THEN 0
    WHEN queue.status IN ('waiting', 'checked_in') THEN 1
    ELSE 2
  END,
  CASE WHEN queue.status IN ('dentist', 'preparing') THEN queue.position ELSE 0 END,
  appointment.appointment_date ASC NULLS LAST,
  appointment.appointment_time ASC NULLS LAST,
  appointment.created_at ASC NULLS LAST,
  appointment.id ASC,
  queue.id ASC
`;

function checkInError(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function applyBranchCheckInSchema(db) {
  const sqlPath = path.join(__dirname, "..", "migrations", "055_branch_check_in.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
}

function clinicZone() {
  return process.env.CLINIC_TIMEZONE || "Asia/Manila";
}

async function optionalQuery(client, sql, params) {
  // Pool.query is auto-commit: SAVEPOINT requires an open transaction (checked-out client).
  if (typeof client.release !== "function") {
    return client.query(sql, params);
  }
  const savepoint = `branch_checkin_${Math.floor(Math.random() * 1e9)}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    throw error;
  }
}

async function loadBranchCheckIn(client, branchId) {
  if (!branchId) return { legacy: false, row: null };
  try {
    const result = await optionalQuery(
      client,
      `SELECT id, name, status, is_main, rfid_enabled, qr_enabled
       FROM clinic_branches
       WHERE id = $1
       LIMIT 1`,
      [branchId]
    );
    return { legacy: false, row: result.rows[0] || null };
  } catch (error) {
    if (error.code === "42703" || error.code === "42P01") {
      return { legacy: true, row: { id: branchId, status: "active", rfid_enabled: true, qr_enabled: true } };
    }
    throw error;
  }
}

async function resolveAuthorizedReader(client) {
  try {
    const result = await optionalQuery(
      client,
      `SELECT reader.id, reader.branch_id, reader.label, branch.name, branch.status, branch.rfid_enabled
       FROM clinic_rfid_readers AS reader
       JOIN clinic_branches AS branch ON branch.id = reader.branch_id
       WHERE reader.authorized = TRUE
       ORDER BY branch.is_main DESC, reader.id ASC
       LIMIT 1`
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code === "42P01" || error.code === "42703") return { legacy: true };
    throw error;
  }
}

async function assertCheckInAllowed(client, { appointment, branchId, method, patientId }) {
  if (!appointment) {
    throw checkInError("No eligible appointment found for this patient today.", 404);
  }
  const settings = await loadBranchCheckIn(client, branchId || appointment.branch_id);
  if (!settings.legacy) {
    if (!settings.row) throw checkInError("Select a valid clinic branch.", 400);
    if (settings.row.status !== "active") {
      throw checkInError("That clinic branch is not accepting check-ins.");
    }
    const normalized = String(method || "manual").toLowerCase();
    if (normalized === "rfid" && !settings.row.rfid_enabled) {
      throw checkInError("RFID check-in is turned off for this clinic branch.");
    }
    if ((normalized === "qr" || normalized === "portal") && !settings.row.qr_enabled) {
      throw checkInError("QR check-in is turned off for this clinic branch.");
    }
  }
  if (patientId && String(appointment.user_id) !== String(patientId)) {
    throw checkInError("This appointment belongs to a different patient.");
  }
  if (
    appointment.branch_id &&
    branchId &&
    String(appointment.branch_id) !== String(branchId)
  ) {
    throw checkInError("This appointment belongs to another clinic branch. Please check in at that branch's staffed desk.");
  }
  const status = String(appointment.status || "").toLowerCase();
  if (!["pending", "confirmed", "checked_in"].includes(status)) {
    throw checkInError("This appointment is not eligible for check-in.");
  }
  const today = await client.query(
    `SELECT ($1::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date) AS is_today`,
    [appointment.appointment_date, clinicZone()]
  );
  if (!today.rows[0]?.is_today) {
    throw checkInError("This appointment is not scheduled for today.");
  }
  return settings;
}

async function resequenceWaitingPositions(client, branchId) {
  if (!branchId) return;
  const zone = clinicZone();
  try {
    await optionalQuery(
      client,
      `WITH serving AS (
         SELECT COUNT(*) AS count
         FROM patient_portal_queue_entries
         WHERE branch_id = $1
           AND (checked_in_at AT TIME ZONE $2)::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
           AND status IN ('dentist', 'preparing')
       ),
       ordered AS (
         SELECT queue.id,
                ROW_NUMBER() OVER (
                  ORDER BY appointment.appointment_date ASC,
                           appointment.appointment_time ASC NULLS LAST,
                           appointment.created_at ASC,
                           appointment.id ASC,
                           queue.id ASC
                ) AS next_position,
                serving.count AS serving_count
         FROM patient_portal_queue_entries AS queue
         JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id
         CROSS JOIN serving
         WHERE queue.branch_id = $1
           AND (queue.checked_in_at AT TIME ZONE $2)::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
           AND queue.status IN ('waiting', 'checked_in')
       )
       UPDATE patient_portal_queue_entries AS queue
       SET position = ordered.next_position,
           estimated_wait_minutes = (ordered.serving_count + ordered.next_position - 1) * 45
       FROM ordered
       WHERE queue.id = ordered.id`,
      [branchId, zone]
    );
  } catch (error) {
    if (error.code !== "42703" && error.code !== "42P01") throw error;
  }
}

async function findQueueForAppointment(client, appointmentId) {
  try {
    const result = await optionalQuery(
      client,
      `SELECT id, token, position, status, estimated_wait_minutes, checked_in_at, check_in_method, appointment_id, user_id
       FROM patient_portal_queue_entries
       WHERE appointment_id = $1
         AND status NOT IN ('completed', 'cancelled', 'no_show', 'not_served', 'needs_review')
       ORDER BY checked_in_at DESC
       LIMIT 1`,
      [appointmentId]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code !== "42703") throw error;
    const result = await client.query(
      `SELECT id, token, position, status, estimated_wait_minutes, checked_in_at, appointment_id, user_id
       FROM patient_portal_queue_entries
       WHERE appointment_id = $1
         AND status NOT IN ('completed', 'cancelled', 'no_show', 'not_served', 'needs_review')
       ORDER BY checked_in_at DESC
       LIMIT 1`,
      [appointmentId]
    );
    return result.rows[0] || null;
  }
}

async function publicQueueBoard(db, { monitor = "" } = {}) {
  let branchId = null;
  let branchName = null;
  if (monitor) {
    const branch = await db.query(
      `SELECT id, name FROM clinic_branches WHERE monitor_token = $1 LIMIT 1`,
      [String(monitor)]
    );
    if (!branch.rows[0]) return { status: 404, body: { message: "This queue display is not recognized." } };
    branchId = branch.rows[0].id;
    branchName = branch.rows[0].name;
  } else {
    const branch = await db.query(`SELECT id, name FROM clinic_branches WHERE is_main ORDER BY id LIMIT 1`);
    branchId = branch.rows[0]?.id || null;
    branchName = branch.rows[0]?.name || null;
  }
  const params = [];
  let branchSql = "";
  if (branchId) {
    params.push(branchId);
    branchSql = ` AND queue.branch_id = $1`;
  }
  const result = await db.query(
    `SELECT queue.token, queue.position, queue.status, queue.estimated_wait_minutes
     FROM patient_portal_queue_entries AS queue
     LEFT JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id
     WHERE DATE(queue.checked_in_at) = CURRENT_DATE
       AND queue.status NOT IN ('completed', 'cancelled', 'no_show', 'not_served', 'needs_review')
       ${branchSql}
     ORDER BY ${QUEUE_ORDER_SQL}
     LIMIT 40`,
    params
  );
  const rows = result.rows.map((row) => ({
    token: row.token,
    position: row.position,
    status: row.status === "dentist" ? "in_chair" : row.status,
    estimatedWaitMinutes: Number(row.estimated_wait_minutes || 0),
  }));
  const nowServing = rows.find((row) => row.status === "in_chair" || row.status === "preparing") || null;
  return {
    status: 200,
    body: {
      clinicName: branchName || "Amethyst Dental Clinic",
      nowServing,
      upNext: rows.filter((row) => row.token !== nowServing?.token).slice(0, 8),
      queue: rows,
    },
  };
}

async function reloadQueueEntry(client, queueId) {
  try {
    const result = await optionalQuery(
      client,
      `SELECT id, token, position, status, estimated_wait_minutes, checked_in_at, check_in_method, appointment_id, user_id, branch_id
       FROM patient_portal_queue_entries
       WHERE id = $1`,
      [queueId]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code !== "42703") throw error;
    const result = await client.query(
      `SELECT id, token, position, status, estimated_wait_minutes, checked_in_at, appointment_id, user_id, branch_id
       FROM patient_portal_queue_entries
       WHERE id = $1`,
      [queueId]
    );
    return result.rows[0] || null;
  }
}

module.exports = {
  LATE_ARRIVAL_POLICY,
  NO_TIME_MESSAGE,
  QUEUE_ORDER_SQL,
  applyBranchCheckInSchema,
  loadBranchCheckIn,
  resolveAuthorizedReader,
  assertCheckInAllowed,
  resequenceWaitingPositions,
  findQueueForAppointment,
  reloadQueueEntry,
  publicQueueBoard,
};
