"use strict";

const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");

const usageContext = new AsyncLocalStorage();

const FEATURE_LABELS = {
  patient_assistant: "Patient AI Assistant",
  patient_image_analysis: "Patient Image Analysis",
  document_sync: "Document Data Sync",
};

function rangePeriodSql(range, column) {
  if (range === "today") {
    return {
      sql: `${column} >= CURRENT_DATE AND ${column} < CURRENT_DATE + INTERVAL '1 day'`,
      params: [],
    };
  }
  if (range === "week") {
    return {
      sql: `${column} >= CURRENT_DATE - INTERVAL '6 days' AND ${column} < CURRENT_DATE + INTERVAL '1 day'`,
      params: [],
    };
  }
  if (range === "month") {
    return {
      sql: `${column} >= date_trunc('month', CURRENT_DATE) AND ${column} < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'`,
      params: [],
    };
  }
  if (range === "year") {
    return {
      sql: `${column} >= date_trunc('year', CURRENT_DATE) AND ${column} < date_trunc('year', CURRENT_DATE) + INTERVAL '1 year'`,
      params: [],
    };
  }
  return {
    sql: `${column} >= $1::date AND ${column} < ($2::date + INTERVAL '1 day')`,
    params: [],
  };
}

function periodLabel(range, from, to) {
  if (range === "today") return "Today";
  if (range === "week") return "This Week";
  if (range === "month") return "This Month";
  if (range === "year") return "This Year";
  if (range === "custom" && from && to) return `${from} to ${to}`;
  return range || "Selected period";
}

function parseGeminiUsage(payload) {
  const meta = payload && typeof payload === "object" ? payload.usageMetadata : null;
  if (!meta || typeof meta !== "object") {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const input = Number.isFinite(Number(meta.promptTokenCount)) ? Number(meta.promptTokenCount) : null;
  const output = Number.isFinite(Number(meta.candidatesTokenCount))
    ? Number(meta.candidatesTokenCount)
    : null;
  const total = Number.isFinite(Number(meta.totalTokenCount))
    ? Number(meta.totalTokenCount)
    : input != null && output != null
      ? input + output
      : null;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function estimateCostUsd(inputTokens, outputTokens) {
  const inputRate = Number(process.env.GEMINI_INPUT_USD_PER_MILLION);
  const outputRate = Number(process.env.GEMINI_OUTPUT_USD_PER_MILLION);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null;
  if (inputTokens == null || outputTokens == null) return null;
  return Number(((inputTokens / 1e6) * inputRate + (outputTokens / 1e6) * outputRate).toFixed(6));
}

function currentAiUsageContext() {
  return usageContext.getStore() || {};
}

function withAiUsageContext(context, fn) {
  const parent = currentAiUsageContext();
  const next = {
    ...parent,
    ...context,
    requestId: context.requestId || parent.requestId || crypto.randomUUID(),
  };
  return usageContext.run(next, fn);
}

function noteAiAttempt(partial) {
  const store = currentAiUsageContext();
  if (!store || typeof store !== "object") return;
  const previous = store.attempt && typeof store.attempt === "object" ? store.attempt : {};
  const incoming = partial && typeof partial === "object" ? partial : {};
  const outcome =
    previous.outcome === "success" || incoming.outcome === "success" ? "success" : incoming.outcome || previous.outcome;
  store.attempt = {
    ...previous,
    ...incoming,
    outcome,
    inputTokens:
      incoming.inputTokens != null ? incoming.inputTokens : previous.inputTokens,
    outputTokens:
      incoming.outputTokens != null ? incoming.outputTokens : previous.outputTokens,
    totalTokens:
      incoming.totalTokens != null ? incoming.totalTokens : previous.totalTokens,
  };
}

async function recordAiUsage(event, database) {
  const db = database || event?.db;
  if (!db || typeof db.query !== "function") return null;
  const requestId = String(event.requestId || crypto.randomUUID()).slice(0, 80);
  const feature = String(event.feature || "unknown").slice(0, 80);
  const outcome = event.outcome === "success" ? "success" : "failed";
  const usage = event.usage || {};
  try {
    const result = await db.query(
      `INSERT INTO ai_usage_events (
         request_id, feature, outcome, user_id, user_role, model,
         input_tokens, output_tokens, total_tokens, http_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (request_id) DO UPDATE SET
         outcome = CASE
           WHEN ai_usage_events.outcome = 'success' THEN ai_usage_events.outcome
           ELSE EXCLUDED.outcome
         END,
         model = COALESCE(EXCLUDED.model, ai_usage_events.model),
         input_tokens = COALESCE(EXCLUDED.input_tokens, ai_usage_events.input_tokens),
         output_tokens = COALESCE(EXCLUDED.output_tokens, ai_usage_events.output_tokens),
         total_tokens = COALESCE(EXCLUDED.total_tokens, ai_usage_events.total_tokens),
         http_status = COALESCE(EXCLUDED.http_status, ai_usage_events.http_status)
       RETURNING id`,
      [
        requestId,
        feature,
        outcome,
        event.userId ? String(event.userId).slice(0, 80) : null,
        event.userRole ? String(event.userRole).slice(0, 40).toLowerCase() : null,
        event.model ? String(event.model).slice(0, 80) : null,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        Number.isFinite(Number(event.httpStatus)) ? Number(event.httpStatus) : null,
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error?.code === "42P01") return null;
    console.warn("AI usage tracking skipped:", error.message);
    return null;
  }
}

function trackAiUsage(event, database) {
  const ctx = currentAiUsageContext();
  const merged = {
    requestId: event.requestId || ctx.requestId,
    feature: event.feature || ctx.feature,
    userId: event.userId || ctx.userId,
    userRole: event.userRole || ctx.userRole,
    ...event,
  };
  const db = database || ctx.db || merged.db;
  Promise.resolve()
    .then(() => recordAiUsage({ ...merged, db }, db))
    .catch((error) => {
      console.warn("AI usage tracking skipped:", error.message);
    });
}

function flushAiUsageAttempt(database) {
  const ctx = currentAiUsageContext();
  if (!ctx?.attempt) return;
  trackAiUsage(
    {
      requestId: ctx.requestId,
      feature: ctx.feature,
      userId: ctx.userId,
      userRole: ctx.userRole,
      outcome: ctx.attempt.outcome || "failed",
      model: ctx.attempt.model,
      httpStatus: ctx.attempt.httpStatus,
      usage: {
        inputTokens: ctx.attempt.inputTokens ?? null,
        outputTokens: ctx.attempt.outputTokens ?? null,
        totalTokens: ctx.attempt.totalTokens ?? null,
      },
    },
    database || ctx.db
  );
}

function emptyAiUsage(range, from, to, extras = {}) {
  return {
    trackingAvailable: extras.trackingAvailable !== false,
    trackingStartedAt: extras.trackingStartedAt || null,
    periodLabel: periodLabel(range, from, to),
    incompleteHistory: Boolean(extras.incompleteHistory),
    summary: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      activeUsers: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
      tokensAvailable: false,
      costAvailable: false,
    },
    requestsOverTime: [],
    outcomes: { success: 0, failed: 0 },
    byFeature: [],
    tokensOverTime: [],
    byRole: [],
  };
}

function bucketSql(range) {
  if (range === "year") {
    return `TO_CHAR(date_trunc('month', created_at), 'YYYY-MM')`;
  }
  if (range === "month") {
    return `TO_CHAR(date_trunc('day', created_at), 'YYYY-MM-DD')`;
  }
  return `TO_CHAR(date_trunc('day', created_at), 'YYYY-MM-DD')`;
}

async function loadAiUsageAnalytics(db, { range = "month", from = null, to = null } = {}) {
  const fallback = emptyAiUsage(range, from, to, { trackingAvailable: false });
  if (!db || typeof db.query !== "function") return fallback;

  const period = rangePeriodSql(range, "created_at");
  const params = range === "custom" ? [from, to] : [];
  if (range === "custom") {
    period.sql = `created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')`;
  }

  try {
    const started = await db.query(
      `SELECT MIN(created_at) AS started_at FROM ai_usage_events`
    );
    const trackingStartedAt = started.rows[0]?.started_at || null;
    const trackingAvailable = true;

    const [summaryResult, timeResult, featureResult, roleResult, tokenTimeResult] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE outcome = 'success') AS successful,
           COUNT(*) FILTER (WHERE outcome = 'failed') AS failed,
           COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS active_users,
           COUNT(input_tokens) FILTER (WHERE input_tokens IS NOT NULL) AS input_rows,
           COUNT(output_tokens) FILTER (WHERE output_tokens IS NOT NULL) AS output_rows,
           SUM(input_tokens) FILTER (WHERE input_tokens IS NOT NULL) AS input_tokens,
           SUM(output_tokens) FILTER (WHERE output_tokens IS NOT NULL) AS output_tokens,
           SUM(total_tokens) FILTER (WHERE total_tokens IS NOT NULL) AS total_tokens
         FROM ai_usage_events
         WHERE ${period.sql}`,
        params
      ),
      db.query(
        `SELECT ${bucketSql(range)} AS label, COUNT(*) AS count
         FROM ai_usage_events
         WHERE ${period.sql}
         GROUP BY 1
         ORDER BY 1`,
        params
      ),
      db.query(
        `SELECT feature, COUNT(*) AS count
         FROM ai_usage_events
         WHERE ${period.sql}
         GROUP BY feature
         ORDER BY count DESC, feature ASC`,
        params
      ),
      db.query(
        `SELECT LOWER(user_role) AS role, COUNT(*) AS count
         FROM ai_usage_events
         WHERE ${period.sql}
           AND user_role IS NOT NULL
           AND BTRIM(user_role) <> ''
         GROUP BY 1
         ORDER BY count DESC, role ASC`,
        params
      ),
      db.query(
        `SELECT ${bucketSql(range)} AS label,
                SUM(input_tokens) FILTER (WHERE input_tokens IS NOT NULL) AS input_tokens,
                SUM(output_tokens) FILTER (WHERE output_tokens IS NOT NULL) AS output_tokens,
                SUM(total_tokens) FILTER (WHERE total_tokens IS NOT NULL) AS total_tokens
         FROM ai_usage_events
         WHERE ${period.sql}
           AND (input_tokens IS NOT NULL OR output_tokens IS NOT NULL OR total_tokens IS NOT NULL)
         GROUP BY 1
         ORDER BY 1`,
        params
      ),
    ]);

    const row = summaryResult.rows[0] || {};
    const inputTokens = row.input_rows && Number(row.input_rows) > 0 ? Number(row.input_tokens || 0) : null;
    const outputTokens = row.output_rows && Number(row.output_rows) > 0 ? Number(row.output_tokens || 0) : null;
    const totalTokens =
      row.total_tokens != null && Number(row.input_rows || row.output_rows || 0) > 0
        ? Number(row.total_tokens)
        : null;
    const tokensAvailable = inputTokens != null || outputTokens != null || totalTokens != null;
    const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens);
    const startedMs = trackingStartedAt ? new Date(trackingStartedAt).getTime() : null;
    const incompleteHistory = Boolean(startedMs);

    return {
      trackingAvailable,
      trackingStartedAt,
      periodLabel: periodLabel(range, from, to),
      incompleteHistory,
      summary: {
        totalRequests: Number(row.total || 0),
        successfulRequests: Number(row.successful || 0),
        failedRequests: Number(row.failed || 0),
        activeUsers: Number(row.active_users || 0),
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd,
        tokensAvailable,
        costAvailable: estimatedCostUsd != null,
      },
      requestsOverTime: timeResult.rows.map((item) => ({
        label: item.label,
        count: Number(item.count || 0),
      })),
      outcomes: {
        success: Number(row.successful || 0),
        failed: Number(row.failed || 0),
      },
      byFeature: featureResult.rows.map((item) => ({
        feature: item.feature,
        label: FEATURE_LABELS[item.feature] || item.feature,
        count: Number(item.count || 0),
      })),
      tokensOverTime: tokenTimeResult.rows.map((item) => ({
        label: item.label,
        input: item.input_tokens == null ? null : Number(item.input_tokens),
        output: item.output_tokens == null ? null : Number(item.output_tokens),
        total: item.total_tokens == null ? null : Number(item.total_tokens),
      })),
      byRole: roleResult.rows.map((item) => ({
        role: item.role,
        count: Number(item.count || 0),
      })),
    };
  } catch (error) {
    if (error?.code === "42P01") {
      return emptyAiUsage(range, from, to, { trackingAvailable: false });
    }
    throw error;
  }
}

module.exports = {
  FEATURE_LABELS,
  periodLabel,
  parseGeminiUsage,
  estimateCostUsd,
  withAiUsageContext,
  currentAiUsageContext,
  noteAiAttempt,
  recordAiUsage,
  trackAiUsage,
  flushAiUsageAttempt,
  loadAiUsageAnalytics,
  emptyAiUsage,
};
