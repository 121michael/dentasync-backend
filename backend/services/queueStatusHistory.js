"use strict";

const CALLED_TO_STATUSES = new Set(["called", "preparing", "dentist"]);

async function markQueueCalled(db, queueEntryId) {
  if (!queueEntryId) return;
  try {
    await db.query(
      `UPDATE patient_portal_queue_entries
       SET called_at = COALESCE(called_at, CURRENT_TIMESTAMP)
       WHERE id = $1
         AND called_at IS NULL`,
      [queueEntryId]
    );
  } catch (error) {
    if (error?.code !== "42703") {
      console.warn("Unable to record queue called_at:", error.message);
    }
  }
}

async function recordQueueStatusEvent(db, { queueEntryId, fromStatus, toStatus, actorId = null, actorRole = null } = {}) {
  if (!queueEntryId || !toStatus) return;
  try {
    await db.query(
      `INSERT INTO patient_portal_queue_status_events (
         queue_entry_id, from_status, to_status, actor_id, actor_role
       ) VALUES ($1, $2, $3, $4, $5)`,
      [queueEntryId, fromStatus || null, String(toStatus), actorId ? String(actorId) : null, actorRole || null]
    );
  } catch (error) {
    if (error?.code !== "42P01") {
      console.warn("Unable to record queue status event:", error.message);
    }
  }
  if (CALLED_TO_STATUSES.has(String(toStatus).toLowerCase())) {
    await markQueueCalled(db, queueEntryId);
  }
}

function previousStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  if (key === "preparing" || key === "called") return "Called";
  if (key === "dentist") return "In Treatment";
  if (key === "waiting" || key === "checked_in") return "Waiting";
  if (key === "needs_review") return "Needs Dentist review";
  if (!key) return "Unknown";
  return key.replaceAll("_", " ");
}

module.exports = {
  CALLED_TO_STATUSES,
  markQueueCalled,
  recordQueueStatusEvent,
  previousStatusLabel,
};
