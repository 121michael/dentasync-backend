"use strict";

const fs = require("fs");
const path = require("path");
const clinicSchedule = require("./clinicSchedule");
const { writeAdminAudit } = require("./adminAudit");

const LOOKBACK_DAYS = 14;
const ADVISORY_LOCK_NS = 87201401;
const SYSTEM_ACTOR = {
  actorId: "system",
  actorName: "Queue day closure",
  actorRole: "system",
};

function addDaysYmd(ymd, days) {
  const [year, month, day] = String(ymd).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clinicClockHm(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.CLINIC_TIMEZONE || "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value || "00";
  const minute = parts.find((part) => part.type === "minute")?.value || "00";
  return `${hour}:${minute}`;
}

function isClosingDue(isoDate, hours, now = new Date()) {
  const today = clinicSchedule.clinicTodayYmd(now);
  if (!isoDate || isoDate > today) return false;
  if (isoDate < today) return true;
  if (!hours || hours.closed) return true;
  const close = hours.close || "23:59";
  return clinicClockHm(now) >= close;
}

async function applyQueueDayClosureSchema(db) {
  const sqlPath = path.join(__dirname, "..", "migrations", "062_queue_day_closure.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  return { file: "062_queue_day_closure.sql" };
}

async function listCloseableBranches(db) {
  try {
    const result = await db.query(
      `SELECT id FROM clinic_branches WHERE LOWER(COALESCE(status, 'active')) = 'active' ORDER BY id`
    );
    return result.rows.map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

async function closeBranchOperatingDate(client, { branchId, operatingDate, now = new Date() }) {
  const tz = process.env.CLINIC_TIMEZONE || "Asia/Manila";
  await client.query(
    `INSERT INTO clinic_queue_day_closures (branch_id, operating_date, closed_at, updated_count)
     VALUES ($1, $2::date, CURRENT_TIMESTAMP, 0)
     ON CONFLICT (branch_id, operating_date) DO NOTHING`,
    [branchId, operatingDate]
  );

  const updated = await client.query(
    `WITH closing AS (
       SELECT id, status AS previous_status, token, user_id
       FROM patient_portal_queue_entries
       WHERE branch_id = $1
         AND (checked_in_at AT TIME ZONE $2)::date = $3::date
         AND status IN ('checked_in', 'waiting', 'preparing', 'dentist')
       FOR UPDATE
     )
     UPDATE patient_portal_queue_entries AS queue
     SET status = CASE
           WHEN queue.status = 'dentist' THEN 'needs_review'
           WHEN queue.status IN ('checked_in', 'waiting', 'preparing') THEN 'not_served'
           ELSE queue.status
         END,
         closed_at = COALESCE(queue.closed_at, CURRENT_TIMESTAMP),
         closed_operating_date = $3::date,
         updated_at = CURRENT_TIMESTAMP
     FROM closing
     WHERE queue.id = closing.id
     RETURNING queue.id, queue.token, queue.status, closing.previous_status, queue.user_id`,
    [branchId, tz, operatingDate]
  );

  if (updated.rowCount) {
    await client.query(
      `UPDATE clinic_queue_day_closures
       SET updated_count = updated_count + $3,
           closed_at = CURRENT_TIMESTAMP
       WHERE branch_id = $1
         AND operating_date = $2::date`,
      [branchId, operatingDate, updated.rowCount]
    );
  }

  for (const row of updated.rows) {
    const fromStatus = row.previous_status;
    await writeAdminAudit(client, {
      ...SYSTEM_ACTOR,
      action: "queue_day_closure",
      targetType: "queue_entry",
      targetId: String(row.id),
      targetLabel: row.token || `queue-${row.id}`,
      result: "success",
      detail: `Automatic end-of-day closure on ${operatingDate}. Status ${fromStatus} → ${row.status}. Check-in timestamp unchanged.`,
    });
  }

  return {
    branchId,
    operatingDate,
    updated: updated.rowCount,
    ids: updated.rows.map((row) => Number(row.id)),
    dueAt: now.toISOString(),
  };
}

async function closeDueQueueDays(db, now = new Date(), { lookbackDays = LOOKBACK_DAYS } = {}) {
  const branches = await listCloseableBranches(db);
  if (!branches.length) return { skipped: true, reason: "no_branches", closed: 0 };

  const today = clinicSchedule.clinicTodayYmd(now);
  const start = addDaysYmd(today, -Math.max(1, lookbackDays));
  const defaults = await clinicSchedule.loadDefaults(db);
  const dates = [];
  for (let cursor = start; cursor <= today; cursor = addDaysYmd(cursor, 1)) {
    dates.push(cursor);
  }

  const results = [];
  for (const branchId of branches) {
    const dayMap = await clinicSchedule.loadDayMap(db, start, today, branchId);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [ADVISORY_LOCK_NS, branchId]);
      for (const operatingDate of dates) {
        const hours = clinicSchedule.resolveOperatingHours(operatingDate, dayMap.get(operatingDate), defaults);
        if (!isClosingDue(operatingDate, hours, now)) continue;
        results.push(await closeBranchOperatingDate(client, { branchId, operatingDate, now }));
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    skipped: false,
    closed: results.reduce((sum, row) => sum + row.updated, 0),
    results,
  };
}

async function finalizeNeedsReviewVisit(
  db,
  { queueId, patientUserId, branchId = null, outcome, actor = {} } = {}
) {
  const nextStatus = outcome === "completed" ? "completed" : outcome === "not_served" ? "not_served" : null;
  if (!nextStatus) {
    const error = new Error("Choose Completed or Not Served after reviewing this visit.");
    error.status = 400;
    throw error;
  }
  if (!queueId || !patientUserId) {
    const error = new Error("A valid visit is required.");
    error.status = 400;
    throw error;
  }

  const client = await db.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const current = await client.query(
      `SELECT id, user_id, appointment_id, token, status, branch_id, checked_in_at, reviewed_at
       FROM patient_portal_queue_entries
       WHERE id = $1
       FOR UPDATE`,
      [queueId]
    );
    const row = current.rows[0];
    if (!row) {
      const error = new Error("Queue visit not found.");
      error.status = 404;
      throw error;
    }
    if (String(row.user_id) !== String(patientUserId)) {
      const error = new Error("This visit does not belong to the selected patient.");
      error.status = 409;
      throw error;
    }
    if (branchId != null && branchId !== "" && String(row.branch_id) !== String(branchId)) {
      const error = new Error("This visit is outside the dentist's active branch.");
      error.status = 403;
      throw error;
    }
    if (String(row.status) !== "needs_review") {
      const error = new Error("This visit is no longer waiting for dentist review.");
      error.status = 409;
      throw error;
    }

    const updated = await client.query(
      `UPDATE patient_portal_queue_entries
       SET status = $1,
           reviewed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND status = 'needs_review'
       RETURNING id, token, status, checked_in_at, reviewed_at, appointment_id, branch_id`,
      [nextStatus, queueId]
    );
    if (!updated.rowCount) {
      const error = new Error("This visit is no longer waiting for dentist review.");
      error.status = 409;
      throw error;
    }

    if (row.appointment_id && nextStatus === "completed") {
      await client.query(
        `UPDATE patient_portal_appointments
         SET status = 'completed', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.appointment_id]
      );
    }

    const saved = updated.rows[0];
    await writeAdminAudit(client, {
      actorId: actor.actorId || null,
      actorName: actor.actorName || null,
      actorRole: actor.actorRole || "dentist",
      action: "queue_visit_review",
      targetType: "queue_entry",
      targetId: String(saved.id),
      targetLabel: saved.token || `queue-${saved.id}`,
      result: "success",
      detail: `Dentist review needs_review → ${nextStatus}. Original check-in timestamp preserved. Review recorded at reviewed_at.`,
    });
    await client.query("COMMIT");
    transactionOpen = false;
    return saved;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function createQueueDayClosureJob({ db, intervalMs = 60 * 1000 } = {}) {
  let timer = null;
  let running = false;

  async function runOnce(now = new Date()) {
    if (running) return { skipped: true, closed: 0, reason: "in_progress" };
    running = true;
    try {
      return await closeDueQueueDays(db, now);
    } catch (error) {
      console.error("Queue day closure job failed:", error.message);
      return { error: error.message, closed: 0 };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    setTimeout(() => {
      runOnce().then((result) => {
        if (!result?.skipped && result?.closed) {
          console.log(`Queue day closure updated ${result.closed} visit(s).`);
        }
      });
    }, 25_000);
    timer = setInterval(() => {
      runOnce().catch((error) => console.error("Queue day closure interval error:", error.message));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { runOnce, start, stop, closeDueQueueDays };
}

module.exports = {
  LOOKBACK_DAYS,
  addDaysYmd,
  clinicClockHm,
  isClosingDue,
  applyQueueDayClosureSchema,
  closeDueQueueDays,
  closeBranchOperatingDate,
  finalizeNeedsReviewVisit,
  createQueueDayClosureJob,
};
