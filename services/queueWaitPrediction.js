"use strict";

/**
 * Queue wait prediction service.
 * Current algorithm: historical_average_v1 (not machine learning).
 * Swap HistoricalAveragePredictor for an MLPredictor later without changing callers.
 */

const ACTIVE_STATUSES = new Set(["checked_in", "waiting", "preparing", "dentist"]);
const SERVING_STATUSES = new Set(["dentist", "in_chair", "in_treatment"]);
const WAITING_STATUSES = new Set(["checked_in", "waiting", "preparing"]);

let statsCache = { at: 0, byProcedure: new Map(), overall: null };

function getPredictionSettings() {
  const minSamples = Math.max(1, Number(process.env.QUEUE_WAIT_MIN_SAMPLES) || 5);
  const lowerFactor = Number(process.env.QUEUE_WAIT_LOWER_FACTOR);
  const upperFactor = Number(process.env.QUEUE_WAIT_UPPER_FACTOR);
  const fallbackMinutes = Number(process.env.QUEUE_WAIT_FALLBACK_MINUTES);
  const minValidMinutes = Number(process.env.QUEUE_WAIT_MIN_VALID_MINUTES);
  const maxValidMinutes = Number(process.env.QUEUE_WAIT_MAX_VALID_MINUTES);
  const statsTtlMs = Number(process.env.QUEUE_WAIT_STATS_TTL_MS);
  return {
    minSamples,
    lowerFactor: Number.isFinite(lowerFactor) && lowerFactor > 0 ? lowerFactor : 0.9,
    upperFactor: Number.isFinite(upperFactor) && upperFactor > 0 ? upperFactor : 1.15,
    fallbackMinutes: Number.isFinite(fallbackMinutes) && fallbackMinutes > 0 ? fallbackMinutes : 35,
    minValidMinutes: Number.isFinite(minValidMinutes) && minValidMinutes > 0 ? minValidMinutes : 3,
    maxValidMinutes: Number.isFinite(maxValidMinutes) && maxValidMinutes > 0 ? maxValidMinutes : 240,
    statsTtlMs: Number.isFinite(statsTtlMs) && statsTtlMs >= 0 ? statsTtlMs : 60_000,
    methodVersion: "historical_average_v1",
    timeZone: process.env.CLINIC_TIMEZONE || "Asia/Manila",
  };
}

function normalizeProcedure(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roundMinutes(value) {
  const minutes = Math.round(Number(value) || 0);
  return Math.max(0, minutes);
}

function stddev(values, mean) {
  if (!values.length) return 0;
  if (values.length === 1) return 0;
  const variance = values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function emptyStats(procedureType, fallbackMinutes) {
  return {
    procedureType,
    sampleCount: 0,
    averageMinutes: fallbackMinutes,
    minMinutes: fallbackMinutes,
    maxMinutes: fallbackMinutes,
    stdDevMinutes: 0,
    usedFallback: true,
  };
}

function invalidateDurationStatsCache() {
  statsCache = { at: 0, byProcedure: new Map(), overall: null };
}

function HistoricalAveragePredictor(settings) {
  return {
    id: settings.methodVersion,
    confidenceFrom(stats) {
      if (!stats || stats.usedFallback || stats.sampleCount < settings.minSamples) return "low";
      if (stats.sampleCount >= 20) return "high";
      return "moderate";
    },
    rangeFrom(pointEstimate, stats) {
      const point = Math.max(0, Number(pointEstimate) || 0);
      let lowerFactor = settings.lowerFactor;
      let upperFactor = settings.upperFactor;
      if (stats && !stats.usedFallback && stats.sampleCount >= settings.minSamples && stats.averageMinutes > 0) {
        const cv = (Number(stats.stdDevMinutes) || 0) / stats.averageMinutes;
        if (cv > 0) {
          lowerFactor = Math.min(lowerFactor, Math.max(0.7, 1 - cv));
          upperFactor = Math.max(upperFactor, Math.min(1.5, 1 + cv));
        }
      }
      return {
        min: roundMinutes(point * lowerFactor),
        max: Math.max(roundMinutes(point * upperFactor), roundMinutes(point * lowerFactor)),
      };
    },
  };
}

function createPredictionService(overrides = {}) {
  const settings = { ...getPredictionSettings(), ...overrides };
  const predictor = HistoricalAveragePredictor(settings);
  return { settings, predictor };
}

async function loadDurationSamples(db, settings) {
  const samples = [];
  const durationSql = `duration_minutes BETWEEN $1 AND $2`;

  try {
    const recorded = await db.query(
      `SELECT procedure_type, duration_minutes
       FROM clinic_treatment_durations
       WHERE completed_at IS NOT NULL
         AND started_at IS NOT NULL
         AND duration_minutes IS NOT NULL
         AND ${durationSql}`,
      [settings.minValidMinutes, settings.maxValidMinutes]
    );
    for (const row of recorded.rows) {
      samples.push({
        procedure: normalizeProcedure(row.procedure_type),
        minutes: Number(row.duration_minutes),
      });
    }
  } catch (error) {
    if (error?.code !== "42P01") {
      console.warn("Treatment duration history lookup failed:", error.message);
    }
  }

  try {
    const treatments = await db.query(
      `SELECT treatment, duration_minutes
       FROM clinic_patient_treatments
       WHERE LOWER(COALESCE(status, '')) = 'completed'
         AND duration_minutes IS NOT NULL
         AND ${durationSql}`,
      [settings.minValidMinutes, settings.maxValidMinutes]
    );
    for (const row of treatments.rows) {
      samples.push({
        procedure: normalizeProcedure(row.treatment),
        minutes: Number(row.duration_minutes),
      });
    }
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") {
      console.warn("Clinical treatment duration lookup failed:", error.message);
    }
  }

  return samples.filter((item) => item.procedure && Number.isFinite(item.minutes));
}

function buildStatsFromSamples(samples, settings) {
  const byProcedure = new Map();
  const overallValues = [];
  for (const sample of samples) {
    if (!byProcedure.has(sample.procedure)) byProcedure.set(sample.procedure, []);
    byProcedure.get(sample.procedure).push(sample.minutes);
    overallValues.push(sample.minutes);
  }

  function summarize(procedureType, values) {
    if (!values.length) return emptyStats(procedureType, settings.fallbackMinutes);
    const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
    const deviation = stddev(values, mean);
    const usable =
      deviation > 0
        ? values.filter((item) => Math.abs(item - mean) <= Math.max(deviation * 3, settings.minValidMinutes))
        : values;
    const cleaned = usable.length ? usable : values;
    const average = cleaned.reduce((sum, item) => sum + item, 0) / cleaned.length;
    return {
      procedureType,
      sampleCount: cleaned.length,
      averageMinutes: roundMinutes(average) || settings.fallbackMinutes,
      minMinutes: Math.min(...cleaned),
      maxMinutes: Math.max(...cleaned),
      stdDevMinutes: Math.round(stddev(cleaned, average) * 10) / 10,
      usedFallback: cleaned.length < settings.minSamples,
    };
  }

  const mapped = new Map();
  for (const [procedure, values] of byProcedure.entries()) {
    mapped.set(procedure, summarize(procedure, values));
  }
  return {
    byProcedure: mapped,
    overall: summarize("overall", overallValues),
  };
}

async function getDurationStatsMap(db, settings = getPredictionSettings()) {
  const now = Date.now();
  if (statsCache.byProcedure.size && now - statsCache.at < settings.statsTtlMs) {
    return statsCache;
  }
  const samples = await loadDurationSamples(db, settings);
  const built = buildStatsFromSamples(samples, settings);
  statsCache = { at: now, ...built };
  return statsCache;
}

async function getHistoricalDurationStats(db, procedureType, settings = getPredictionSettings()) {
  const cache = await getDurationStatsMap(db, settings);
  const key = normalizeProcedure(procedureType);
  if (key && cache.byProcedure.has(key)) {
    const stats = cache.byProcedure.get(key);
    if (!stats.usedFallback) return stats;
  }
  if (cache.overall && !cache.overall.usedFallback) {
    return { ...cache.overall, procedureType: key || "unknown", usedFallback: true };
  }
  return emptyStats(key || "unknown", settings.fallbackMinutes);
}

async function catalogDurationMinutes(db, serviceId, serviceName, settings) {
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
    }
  } catch (error) {
    if (error?.code !== "42P01") {
      console.warn("Service duration catalog lookup failed:", error.message);
    }
  }
  return settings.fallbackMinutes;
}

async function estimateProcedureDuration(db, entry, settings = getPredictionSettings()) {
  const procedure =
    entry.serviceName ||
    entry.service_name ||
    entry.procedure ||
    entry.procedureType ||
    entry.procedure_type ||
    "";
  const stats = await getHistoricalDurationStats(db, procedure, settings);
  if (!stats.usedFallback) {
    return { minutes: stats.averageMinutes, stats, source: "historical" };
  }
  const catalog = await catalogDurationMinutes(
    db,
    entry.serviceId || entry.service_id,
    procedure,
    settings
  );
  if (catalog && catalog !== settings.fallbackMinutes) {
    return {
      minutes: catalog,
      stats: { ...stats, averageMinutes: catalog, usedFallback: true },
      source: "catalog",
    };
  }
  return { minutes: settings.fallbackMinutes, stats, source: "fallback" };
}

function remainingServingMinutes(entry, fullMinutes, now = new Date()) {
  const status = String(entry.status || "").toLowerCase();
  if (!SERVING_STATUSES.has(status)) {
    return Math.max(0, roundMinutes(fullMinutes));
  }
  const startedRaw = entry.serving_started_at || entry.servingStartedAt || entry.started_at || entry.startedAt;
  if (!startedRaw) {
    const stored = Number(
      entry.procedureDurationMinutes ??
        entry.procedure_duration_minutes ??
        entry.durationMinutes ??
        entry.duration_minutes ??
        entry.estimated_wait_minutes ??
        entry.estimatedWaitMinutes ??
        fullMinutes
    );
    return Math.max(1, roundMinutes(stored || fullMinutes));
  }
  const started = new Date(startedRaw);
  if (Number.isNaN(started.getTime())) {
    return Math.max(1, roundMinutes(fullMinutes));
  }
  const elapsed = Math.max(0, (now.getTime() - started.getTime()) / 60000);
  return Math.max(1, roundMinutes((fullMinutes || 0) - elapsed));
}

async function expectedMinutesForEntry(db, entry, settings, now) {
  const estimated = await estimateProcedureDuration(db, entry, settings);
  const remaining = remainingServingMinutes(entry, estimated.minutes, now);
  return { ...estimated, remainingMinutes: remaining };
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Math.max(0, minutes) * 60000);
}

function serializeEstimate({
  entry,
  waitPoint,
  range,
  durationMinutes,
  now,
  settings,
  predictor,
  stats,
  patientsAhead,
}) {
  const status = String(entry.status || "").toLowerCase();
  const serving = SERVING_STATUSES.has(status);
  const waiting = WAITING_STATUSES.has(status);
  const min = serving ? 0 : range.min;
  const max = serving ? 0 : range.max;
  return {
    queueNumber: entry.token || null,
    queuePosition: Number(entry.position) || null,
    patientsAhead: serving ? 0 : patientsAhead,
    estimatedDurationMinutes: durationMinutes,
    estimatedWaitMinutes: waiting || serving ? { min, max } : null,
    estimatedCallTime:
      waiting || serving
        ? {
            start: addMinutes(now, min).toISOString(),
            end: addMinutes(now, max).toISOString(),
          }
        : null,
    estimationMethod: settings.methodVersion,
    confidenceLevel: predictor.confidenceFrom(stats),
    calculatedAt: now.toISOString(),
    unavailable: false,
  };
}

function waitEstimateFromRow(row) {
  if (!row) return null;
  const min = row.wait_estimate_min_minutes;
  const max = row.wait_estimate_max_minutes;
  if (min == null && max == null && !row.wait_estimate_at) return null;
  return {
    queueNumber: row.token || null,
    queuePosition: Number(row.position) || null,
    estimatedDurationMinutes:
      row.wait_estimate_duration_minutes != null ? Number(row.wait_estimate_duration_minutes) : null,
    estimatedWaitMinutes:
      min == null && max == null
        ? null
        : { min: Number(min || 0), max: Number(max || 0) },
    estimatedCallTime:
      row.wait_estimate_call_start || row.wait_estimate_call_end
        ? {
            start: row.wait_estimate_call_start ? new Date(row.wait_estimate_call_start).toISOString() : null,
            end: row.wait_estimate_call_end ? new Date(row.wait_estimate_call_end).toISOString() : null,
          }
        : null,
    estimationMethod: row.wait_estimate_method || null,
    calculatedAt: row.wait_estimate_at ? new Date(row.wait_estimate_at).toISOString() : null,
    unavailable: false,
  };
}

function publicWaitEstimate(estimate) {
  if (!estimate) {
    return {
      estimatedWaitMinutes: null,
      estimatedCallTime: null,
      unavailable: true,
    };
  }
  return {
    estimatedWaitMinutes: estimate.estimatedWaitMinutes,
    estimatedCallTime: estimate.estimatedCallTime,
    estimatedDurationMinutes: estimate.estimatedDurationMinutes ?? null,
    calculatedAt: estimate.calculatedAt || null,
    unavailable: Boolean(estimate.unavailable),
  };
}

function staffWaitEstimate(estimate) {
  if (!estimate) return publicWaitEstimate(estimate);
  return {
    ...publicWaitEstimate(estimate),
    estimationMethod: estimate.estimationMethod || null,
    confidenceLevel: estimate.confidenceLevel || null,
    patientsAhead: estimate.patientsAhead ?? null,
    queuePosition: estimate.queuePosition ?? null,
  };
}

async function loadTodayQueue(db) {
  try {
    const result = await db.query(
      `SELECT
         queue.id,
         queue.user_id,
         queue.token,
         queue.position,
         queue.status,
         queue.estimated_wait_minutes,
         queue.checked_in_at,
         queue.appointment_id,
         queue.serving_started_at,
         appointment.service_id,
         appointment.service_name,
         appointment.dentist_id
       FROM patient_portal_queue_entries AS queue
       LEFT JOIN patient_portal_appointments AS appointment
         ON appointment.id = queue.appointment_id
       WHERE (queue.checked_in_at AT TIME ZONE $1)::date =
             (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
       ORDER BY queue.position ASC`,
      [process.env.CLINIC_TIMEZONE || "Asia/Manila"]
    );
    return result.rows;
  } catch (error) {
    if (error?.code === "42703") {
      const result = await db.query(
        `SELECT
           queue.id,
           queue.user_id,
           queue.token,
           queue.position,
           queue.status,
           queue.estimated_wait_minutes,
           queue.checked_in_at,
           queue.appointment_id,
           appointment.service_id,
           appointment.service_name,
           appointment.dentist_id
         FROM patient_portal_queue_entries AS queue
         LEFT JOIN patient_portal_appointments AS appointment
           ON appointment.id = queue.appointment_id
         WHERE DATE(queue.checked_in_at) = CURRENT_DATE
         ORDER BY queue.position ASC`
      );
      return result.rows;
    }
    throw error;
  }
}

async function estimateWaitForQueueContext(db, { entry, aheadEntries = [], now = new Date(), settings } = {}) {
  const service = createPredictionService(settings);
  const status = String(entry?.status || "").toLowerCase();
  if (!entry || !ACTIVE_STATUSES.has(status)) {
    return serializeEstimate({
      entry: entry || {},
      waitPoint: 0,
      range: { min: 0, max: 0 },
      durationMinutes: null,
      now,
      settings: service.settings,
      predictor: service.predictor,
      stats: emptyStats("unknown", service.settings.fallbackMinutes),
      patientsAhead: 0,
    });
  }

  const selfDuration = await expectedMinutesForEntry(db, entry, service.settings, now);
  if (SERVING_STATUSES.has(status)) {
    return serializeEstimate({
      entry,
      waitPoint: 0,
      range: { min: 0, max: 0 },
      durationMinutes: selfDuration.minutes,
      now,
      settings: service.settings,
      predictor: service.predictor,
      stats: selfDuration.stats,
      patientsAhead: 0,
    });
  }

  let waitPoint = 0;
  const aheadStats = [];
  for (const ahead of aheadEntries) {
    const aheadStatus = String(ahead.status || "").toLowerCase();
    if (!ACTIVE_STATUSES.has(aheadStatus)) continue;
    const estimated = await expectedMinutesForEntry(db, ahead, service.settings, now);
    waitPoint += estimated.remainingMinutes;
    aheadStats.push(estimated.stats);
  }

  const combined = aheadStats.length
    ? aheadStats.reduce(
        (acc, stats) => {
          acc.sampleCount += stats.sampleCount || 0;
          acc.stdDevMinutes += stats.stdDevMinutes || 0;
          acc.averageMinutes += stats.averageMinutes || 0;
          acc.usedFallback = acc.usedFallback || stats.usedFallback;
          return acc;
        },
        { sampleCount: 0, stdDevMinutes: 0, averageMinutes: 0, usedFallback: false }
      )
    : selfDuration.stats;
  if (aheadStats.length) {
    combined.averageMinutes = roundMinutes(combined.averageMinutes / aheadStats.length);
    combined.stdDevMinutes = combined.stdDevMinutes / aheadStats.length;
  }

  const range = service.predictor.rangeFrom(waitPoint, combined);
  return serializeEstimate({
    entry,
    waitPoint,
    range,
    durationMinutes: selfDuration.minutes,
    now,
    settings: service.settings,
    predictor: service.predictor,
    stats: combined,
    patientsAhead: aheadEntries.filter((item) => ACTIVE_STATUSES.has(String(item.status || "").toLowerCase())).length,
  });
}

async function persistEstimate(db, entryId, estimate, waitPoint) {
  const midpoint = roundMinutes(
    ((estimate.estimatedWaitMinutes?.min || 0) + (estimate.estimatedWaitMinutes?.max || 0)) / 2
  );
  try {
    await db.query(
      `UPDATE patient_portal_queue_entries
       SET estimated_wait_minutes = $2,
           wait_estimate_min_minutes = $3,
           wait_estimate_max_minutes = $4,
           wait_estimate_duration_minutes = $5,
           wait_estimate_call_start = $6,
           wait_estimate_call_end = $7,
           wait_estimate_method = $8,
           wait_estimate_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND status IN ('checked_in', 'waiting', 'preparing')`,
      [
        entryId,
        midpoint || waitPoint || 0,
        estimate.estimatedWaitMinutes?.min ?? 0,
        estimate.estimatedWaitMinutes?.max ?? 0,
        estimate.estimatedDurationMinutes,
        estimate.estimatedCallTime?.start || null,
        estimate.estimatedCallTime?.end || null,
        estimate.estimationMethod,
      ]
    );
  } catch (error) {
    if (error?.code === "42703") {
      await db.query(
        `UPDATE patient_portal_queue_entries
         SET estimated_wait_minutes = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND status IN ('checked_in', 'waiting', 'preparing')`,
        [entryId, midpoint || waitPoint || 0]
      );
      return;
    }
    throw error;
  }
}

async function recalculateQueueWaitEstimates(db, { fromPosition = 0 } = {}) {
  try {
    const now = new Date();
    const rows = await loadTodayQueue(db);
    const active = rows.filter((row) => ACTIVE_STATUSES.has(String(row.status || "").toLowerCase()));
    let updated = 0;
    for (const entry of active) {
      const position = Number(entry.position) || 0;
      if (position < fromPosition) continue;
      const status = String(entry.status || "").toLowerCase();
      if (!WAITING_STATUSES.has(status)) continue;
      const ahead = active.filter((row) => Number(row.position) < position);
      const estimate = await estimateWaitForQueueContext(db, { entry, aheadEntries: ahead, now });
      const waitPoint = roundMinutes(
        ((estimate.estimatedWaitMinutes?.min || 0) + (estimate.estimatedWaitMinutes?.max || 0)) / 2
      );
      await persistEstimate(db, entry.id, estimate, waitPoint);
      updated += 1;
    }
    return { ok: true, updated, calculatedAt: now.toISOString() };
  } catch (error) {
    console.warn("Queue wait estimate recalculation skipped:", error.message);
    return { ok: false, reason: error.message, updated: 0 };
  }
}

async function safeRecalculateQueueWaitEstimates(db, options) {
  try {
    return await recalculateQueueWaitEstimates(db, options);
  } catch (error) {
    console.warn("Queue wait estimate recalculation failed:", error.message);
    return { ok: false, reason: error.message, updated: 0 };
  }
}

const QUEUE_ESTIMATE_SELECT = `
           queue.wait_estimate_min_minutes,
           queue.wait_estimate_max_minutes,
           queue.wait_estimate_duration_minutes,
           queue.wait_estimate_call_start,
           queue.wait_estimate_call_end,
           queue.wait_estimate_method,
           queue.wait_estimate_at,
           queue.serving_started_at`;

module.exports = {
  ACTIVE_STATUSES,
  QUEUE_ESTIMATE_SELECT,
  SERVING_STATUSES,
  WAITING_STATUSES,
  createPredictionService,
  estimateWaitForQueueContext,
  getHistoricalDurationStats,
  getPredictionSettings,
  invalidateDurationStatsCache,
  remainingServingMinutes,
  publicWaitEstimate,
  recalculateQueueWaitEstimates,
  safeRecalculateQueueWaitEstimates,
  staffWaitEstimate,
  waitEstimateFromRow,
  normalizeProcedure,
};
