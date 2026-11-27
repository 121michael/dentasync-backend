"use strict";

const {
  SERVING_STATUSES,
  WAITING_STATUSES,
  aheadEntriesFor,
  compareQueueOrder,
  dentistLane,
  expectedMinutesForEntry,
  getPredictionSettings,
  safeRecalculateQueueWaitEstimates,
} = require("./queueWaitPrediction");
const {
  QUEUE_APPROACHING_SMS,
  QUEUE_CALLED_SMS,
} = require("./appointmentSms");

const APPROACHING_MAX_MINUTES = 10;
const ESTIMATE_STALE_MS = 2 * 60 * 1000;
const JOB_INTERVAL_MS = 30 * 1000;
const CALLED_STATUSES = new Set(["preparing", "called"]);
const APPROACHING_ELIGIBLE = new Set(["checked_in", "waiting"]);
const APPROACHING_BLOCKED = new Set([
  "preparing",
  "called",
  "dentist",
  "in_chair",
  "in_treatment",
  "completed",
  "cancelled",
  "no_show",
  "not_served",
  "needs_review",
]);

function statusKey(value) {
  return String(value || "").toLowerCase();
}

function calledIdempotencyKey(queueId) {
  return `queue-called:${queueId}`;
}

function approachingIdempotencyKey(queueId) {
  return `queue-approaching:${queueId}`;
}

function estimateIsStale(row, now = new Date()) {
  const at = row?.wait_estimate_at ? new Date(row.wait_estimate_at) : null;
  if (!at || Number.isNaN(at.getTime())) return true;
  return now.getTime() - at.getTime() > ESTIMATE_STALE_MS;
}

function estimateIsUsable(row) {
  const method = String(row?.wait_estimate_method || "").toLowerCase();
  if (!method || method === "unavailable") return false;
  if (row?.wait_estimate_unavailable) return false;
  return true;
}

async function markQueueSmsSent(db, queueId, column) {
  try {
    await db.query(
      `UPDATE patient_portal_queue_entries
          SET ${column} = COALESCE(${column}, CURRENT_TIMESTAMP)
        WHERE id = $1`,
      [queueId]
    );
  } catch (error) {
    if (error?.code !== "42703") {
      console.warn("Unable to persist queue SMS sent timestamp:", error.message);
    }
  }
}

async function loadTodayQueueLanes(db, branchId = null) {
  const params = [process.env.CLINIC_TIMEZONE || "Asia/Manila"];
  let branchSql = "";
  if (branchId != null && branchId !== "") {
    params.push(branchId);
    branchSql = ` AND queue.branch_id = $${params.length}`;
  }
  const sql = `SELECT
         queue.id,
         queue.user_id,
         queue.token,
         queue.position,
         queue.status,
         queue.branch_id,
         queue.appointment_id,
         queue.checked_in_at,
         queue.serving_started_at,
         queue.estimated_wait_minutes,
         queue.wait_estimate_method,
         queue.wait_estimate_at,
         queue.wait_estimate_duration_minutes,
         queue.queue_sms_called_sent_at,
         queue.queue_sms_approaching_sent_at,
         appointment.service_id,
         appointment.service_name,
         appointment.dentist_id,
         appointment.appointment_date,
         appointment.appointment_time,
         appointment.created_at AS appointment_created_at
       FROM patient_portal_queue_entries AS queue
       LEFT JOIN patient_portal_appointments AS appointment
         ON appointment.id = queue.appointment_id
       WHERE (queue.checked_in_at AT TIME ZONE $1)::date =
             (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
             ${branchSql}
       ORDER BY queue.position ASC`;
  try {
    return (await db.query(sql, params)).rows;
  } catch (error) {
    if (error?.code !== "42703") throw error;
    const fallback = await db.query(
      `SELECT
         queue.id,
         queue.user_id,
         queue.token,
         queue.position,
         queue.status,
         queue.appointment_id,
         queue.checked_in_at,
         appointment.service_id,
         appointment.service_name,
         appointment.dentist_id,
         appointment.appointment_date,
         appointment.appointment_time,
         appointment.created_at AS appointment_created_at
       FROM patient_portal_queue_entries AS queue
       LEFT JOIN patient_portal_appointments AS appointment
         ON appointment.id = queue.appointment_id
       WHERE DATE(queue.checked_in_at) = CURRENT_DATE
       ORDER BY queue.position ASC`
    );
    return fallback.rows;
  }
}

async function listTodayBranchIds(db) {
  try {
    const result = await db.query(
      `SELECT DISTINCT branch_id
         FROM patient_portal_queue_entries
        WHERE (checked_in_at AT TIME ZONE $1)::date =
              (CURRENT_TIMESTAMP AT TIME ZONE $1)::date`,
      [process.env.CLINIC_TIMEZONE || "Asia/Manila"]
    );
    const ids = result.rows.map((row) => row.branch_id);
    return ids.length ? ids : [null];
  } catch (error) {
    if (error?.code === "42703") return [null];
    throw error;
  }
}

function groupByDentistLane(rows) {
  const lanes = new Map();
  for (const row of rows) {
    const key = dentistLane(row);
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key).push(row);
  }
  for (const laneRows of lanes.values()) {
    laneRows.sort(compareQueueOrder);
  }
  return lanes;
}

function nextWaitingInLane(laneRows) {
  return laneRows.find((row) => APPROACHING_ELIGIBLE.has(statusKey(row.status)));
}

async function remainingForServing(db, serving, now) {
  const predicted = await expectedMinutesForEntry(db, serving, getPredictionSettings(), now);
  if (!predicted || predicted.unreliable || predicted.source === "fallback") {
    return { ok: false, reason: "unreliable" };
  }
  if (predicted.overrun) {
    return { ok: false, reason: "overrun" };
  }
  const remaining = Number(predicted.remainingMinutes);
  if (!Number.isFinite(remaining)) {
    return { ok: false, reason: "missing" };
  }
  return { ok: true, remaining };
}

function smsSucceeded(result) {
  const status = String(result?.status || "").toLowerCase();
  return ["sent", "delivered"].includes(status) || Boolean(result?.duplicate && ["sent", "delivered"].includes(status));
}

async function notifyQueueCalledSms({ db, clinicSms, userId, queueEntry, actorRole, actorId } = {}) {
  const status = statusKey(queueEntry?.status);
  if (!CALLED_STATUSES.has(status)) return { status: "skipped", reason: "not_called" };
  const queueId = queueEntry?.id;
  if (!queueId || !userId) return { status: "skipped", reason: "missing_target" };
  if (queueEntry.queue_sms_called_sent_at) {
    return { status: "skipped", reason: "already_sent" };
  }
  const result = await clinicSms.sendClinicSms({
    userId,
    category: "queue",
    messageType: "queue_called",
    message: QUEUE_CALLED_SMS,
    queueEntryId: queueId,
    appointmentId: queueEntry.appointment_id || null,
    actorRole,
    actorId,
    origin: "automatic",
    idempotencyKey: calledIdempotencyKey(queueId),
  });
  if (smsSucceeded(result)) {
    await markQueueSmsSent(db, queueId, "queue_sms_called_sent_at");
  }
  return result;
}

async function notifyQueueApproachingSms({ db, clinicSms, userId, queueEntry, actorRole, actorId } = {}) {
  const status = statusKey(queueEntry?.status);
  if (APPROACHING_BLOCKED.has(status) || !APPROACHING_ELIGIBLE.has(status)) {
    return { status: "skipped", reason: "status_blocked" };
  }
  const queueId = queueEntry?.id;
  if (!queueId || !userId) return { status: "skipped", reason: "missing_target" };
  if (queueEntry.queue_sms_approaching_sent_at) {
    return { status: "skipped", reason: "already_sent" };
  }
  const result = await clinicSms.sendClinicSms({
    userId,
    category: "queue",
    messageType: "queue_approaching",
    message: QUEUE_APPROACHING_SMS,
    queueEntryId: queueId,
    appointmentId: queueEntry.appointment_id || null,
    actorRole,
    actorId,
    origin: "automatic",
    idempotencyKey: approachingIdempotencyKey(queueId),
  });
  if (smsSucceeded(result)) {
    await markQueueSmsSent(db, queueId, "queue_sms_approaching_sent_at");
  }
  return result;
}

async function processApproachingQueueSms({ db, clinicSms, now = new Date(), branchId } = {}) {
  const branches = branchId != null && branchId !== "" ? [branchId] : await listTodayBranchIds(db);
  let notified = 0;
  for (const bid of branches) {
    const recalc = await safeRecalculateQueueWaitEstimates(db, {
      fromPosition: 0,
      branchId: bid,
    });
    if (!recalc?.ok) continue;
    const rows = await loadTodayQueueLanes(db, bid);
    const active = rows
      .filter((row) => {
        const status = statusKey(row.status);
        return SERVING_STATUSES.has(status) || WAITING_STATUSES.has(status);
      })
      .sort(compareQueueOrder);
    const lanes = groupByDentistLane(active);
    for (const laneRows of lanes.values()) {
      const serving = laneRows.find((row) => SERVING_STATUSES.has(statusKey(row.status)));
      if (!serving) continue;
      if (!estimateIsUsable(serving) || estimateIsStale(serving, now)) continue;
      const remaining = await remainingForServing(db, serving, now);
      if (!remaining.ok || remaining.remaining > APPROACHING_MAX_MINUTES) continue;
      const next = nextWaitingInLane(laneRows);
      if (!next) continue;
      if (APPROACHING_BLOCKED.has(statusKey(next.status))) continue;
      const ahead = aheadEntriesFor(next, active);
      const blockingAhead = ahead.filter((row) => !SERVING_STATUSES.has(statusKey(row.status)));
      if (blockingAhead.length) continue;
      const sent = await notifyQueueApproachingSms({
        db,
        clinicSms,
        userId: next.user_id,
        queueEntry: next,
        actorRole: "system",
        actorId: "queue-approaching-job",
      });
      if (smsSucceeded(sent)) {
        notified += 1;
      }
    }
  }
  return { ok: true, notified };
}

function createQueueSmsJob({ db, clinicSms, intervalMs = JOB_INTERVAL_MS } = {}) {
  let timer = null;
  let running = false;

  async function runOnce() {
    if (running) return { skipped: true, reason: "in_flight" };
    running = true;
    try {
      return await processApproachingQueueSms({ db, clinicSms, now: new Date() });
    } catch (error) {
      console.warn("Queue approaching SMS job failed:", error.message);
      return { ok: false, reason: error.message };
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        runOnce().catch((error) => console.warn("Queue approaching SMS job failed:", error.message));
      }, intervalMs);
      if (typeof timer.unref === "function") timer.unref();
      runOnce().catch((error) => console.warn("Queue approaching SMS job failed:", error.message));
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    runOnce,
  };
}

module.exports = {
  APPROACHING_MAX_MINUTES,
  QUEUE_APPROACHING_SMS,
  QUEUE_CALLED_SMS,
  createQueueSmsJob,
  notifyQueueApproachingSms,
  notifyQueueCalledSms,
  processApproachingQueueSms,
};
