"use strict";

// Preview-only. Does not write. Do not run against the live database from an agent.
// Eligible unresolved visits: still open after the visit date, Called / In Treatment /
// or Waiting with call evidence. Cancelled and Completed rows are listed as skipped.

const clinicSchedule = require("../services/clinicSchedule");

const ELIGIBLE_SQL = `
  SELECT
    queue.id,
    queue.token,
    queue.status,
    queue.called_at,
    queue.serving_started_at,
    queue.branch_id,
    (queue.checked_in_at AT TIME ZONE $1)::date AS visit_date,
    CASE
      WHEN queue.status IN ('called', 'preparing', 'dentist') THEN 'needs_review'
      WHEN queue.called_at IS NOT NULL OR queue.serving_started_at IS NOT NULL THEN 'needs_review'
      WHEN EXISTS (
        SELECT 1 FROM patient_portal_queue_status_events ev
        WHERE ev.queue_entry_id = queue.id
          AND ev.to_status IN ('called', 'preparing', 'dentist')
      ) THEN 'needs_review'
      WHEN queue.status IN ('checked_in', 'waiting') THEN 'cancelled'
      ELSE NULL
    END AS proposed_status
  FROM patient_portal_queue_entries AS queue
  WHERE queue.status IN ('checked_in', 'waiting', 'preparing', 'called', 'dentist')
    AND (queue.checked_in_at AT TIME ZONE $1)::date < (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
  ORDER BY visit_date, queue.id
`;

async function previewEligibleUnresolvedVisits(db, now = new Date()) {
  const tz = process.env.CLINIC_TIMEZONE || "Asia/Manila";
  const today = clinicSchedule.clinicTodayYmd(now);
  const result = await db.query(ELIGIBLE_SQL, [tz]);
  const needsReview = result.rows.filter((row) => row.proposed_status === "needs_review");
  const cancel = result.rows.filter((row) => row.proposed_status === "cancelled");
  return {
    today,
    timezone: tz,
    eligibleOpen: result.rowCount,
    proposedNeedsReview: needsReview.length,
    proposedCancelNeverCalled: cancel.length,
    rows: result.rows,
    skippedPolicy:
      "Do not reopen cancelled or completed visits. Apply only to still-open Called, In Treatment, or previously-called Waiting rows.",
  };
}

module.exports = { previewEligibleUnresolvedVisits, ELIGIBLE_SQL };
