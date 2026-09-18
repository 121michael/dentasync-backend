"use strict";

/**
 * Estimate waiting time from queue position and known procedure durations.
 * Uses clinic_service_durations and recent completed treatments when available.
 * This is a deterministic clinic heuristic — not a machine-learning model.
 */

const DEFAULT_MINUTES = 45;

async function getServiceDurationMinutes(db, serviceId, serviceName) {
  try {
    if (serviceId) {
      const byId = await db.query(
        `SELECT default_duration_minutes
         FROM clinic_service_durations
         WHERE service_id = $1
         LIMIT 1`,
        [String(serviceId)]
      );
      if (byId.rows[0]?.default_duration_minutes) {
        return Number(byId.rows[0].default_duration_minutes);
      }
    }

    if (serviceName) {
      const byName = await db.query(
        `SELECT default_duration_minutes
         FROM clinic_service_durations
         WHERE LOWER(service_name) = LOWER($1)
         LIMIT 1`,
        [String(serviceName)]
      );
      if (byName.rows[0]?.default_duration_minutes) {
        return Number(byName.rows[0].default_duration_minutes);
      }

      const historical = await db.query(
        `SELECT AVG(duration_minutes)::int AS avg_minutes
         FROM clinic_patient_treatments
         WHERE LOWER(treatment) = LOWER($1)
           AND duration_minutes IS NOT NULL
           AND duration_minutes > 0`,
        [String(serviceName)]
      );
      if (historical.rows[0]?.avg_minutes) {
        return Number(historical.rows[0].avg_minutes);
      }
    }
  } catch (error) {
    if (error?.code !== "42P01") {
      console.warn("Wait-time duration lookup failed:", error.message);
    }
  }

  return DEFAULT_MINUTES;
}

async function estimateWaitMinutesForPosition(db, {
  position,
  aheadEntries = [],
} = {}) {
  const safePosition = Math.max(1, Number(position) || 1);
  if (safePosition <= 1) {
    return 0;
  }

  if (aheadEntries.length) {
    let total = 0;
    for (const entry of aheadEntries) {
      const status = String(entry.status || "").toLowerCase();
      const inService = status === "dentist" || status === "in_chair" || status === "in_treatment";
      const procedureDuration = Number(
        entry.procedureDurationMinutes ??
          entry.procedure_duration_minutes ??
          entry.durationMinutes ??
          entry.duration_minutes ??
          0
      );
      const queuedDuration = Number(entry.estimated_wait_minutes ?? entry.estimatedWaitMinutes ?? 0);

      // In-chair patients use the live procedure duration captured at Start / duration save.
      if (inService && (procedureDuration > 0 || queuedDuration > 0)) {
        total += procedureDuration > 0 ? procedureDuration : queuedDuration;
        continue;
      }

      total += await getServiceDurationMinutes(
        db,
        entry.serviceId || entry.service_id,
        entry.serviceName || entry.service_name || entry.procedure
      );
    }
    return total;
  }

  // Fallback when ahead rows are not provided: average clinic duration × people ahead.
  const avg = await db
    .query(
      `SELECT COALESCE(AVG(default_duration_minutes), $1)::int AS avg_minutes
       FROM clinic_service_durations`,
      [DEFAULT_MINUTES]
    )
    .catch(() => ({ rows: [{ avg_minutes: DEFAULT_MINUTES }] }));

  const averageMinutes = Number(avg.rows[0]?.avg_minutes) || DEFAULT_MINUTES;
  return (safePosition - 1) * averageMinutes;
}

module.exports = {
  DEFAULT_MINUTES,
  getServiceDurationMinutes,
  estimateWaitMinutesForPosition,
};
