"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseGeminiUsage,
  estimateCostUsd,
  recordAiUsage,
  loadAiUsageAnalytics,
  periodLabel,
} = require("../services/aiUsage");
const { renderAdminAnalyticsExport } = require("../services/adminAnalyticsExport");

test("Gemini usage metadata is parsed without inventing token counts", () => {
  assert.deepEqual(parseGeminiUsage({}), {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  });
  assert.deepEqual(
    parseGeminiUsage({
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
    }),
    { inputTokens: 12, outputTokens: 8, totalTokens: 20 }
  );
});

test("AI cost stays unavailable unless configured rates exist", () => {
  const previousIn = process.env.GEMINI_INPUT_USD_PER_MILLION;
  const previousOut = process.env.GEMINI_OUTPUT_USD_PER_MILLION;
  delete process.env.GEMINI_INPUT_USD_PER_MILLION;
  delete process.env.GEMINI_OUTPUT_USD_PER_MILLION;
  try {
    assert.equal(estimateCostUsd(1000, 500), null);
  } finally {
    if (previousIn === undefined) delete process.env.GEMINI_INPUT_USD_PER_MILLION;
    else process.env.GEMINI_INPUT_USD_PER_MILLION = previousIn;
    if (previousOut === undefined) delete process.env.GEMINI_OUTPUT_USD_PER_MILLION;
    else process.env.GEMINI_OUTPUT_USD_PER_MILLION = previousOut;
  }
});

test("period labels match the General Analytics selector", () => {
  assert.equal(periodLabel("year"), "This Year");
  assert.equal(periodLabel("custom", "2026-01-01", "2026-01-31"), "2026-01-01 to 2026-01-31");
});

test("AI usage aggregation uses recorded rows for the selected period", async () => {
  const events = [
    {
      created_at: "2026-10-19T02:00:00.000Z",
      feature: "patient_assistant",
      outcome: "success",
      user_id: "p1",
      user_role: "patient",
      input_tokens: 10,
      output_tokens: 4,
      total_tokens: 14,
    },
    {
      created_at: "2026-10-19T03:00:00.000Z",
      feature: "document_sync",
      outcome: "failed",
      user_id: "a1",
      user_role: "admin",
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
    },
  ];
  const db = {
    async query(sql) {
      if (sql.includes("MIN(created_at)")) {
        return { rows: [{ started_at: "2026-10-19T02:00:00.000Z" }] };
      }
      if (sql.includes("COUNT(DISTINCT user_id)")) {
        return {
          rows: [
            {
              total: "2",
              successful: "1",
              failed: "1",
              active_users: "2",
              input_rows: "1",
              output_rows: "1",
              input_tokens: "10",
              output_tokens: "4",
              total_tokens: "14",
            },
          ],
        };
      }
      if (sql.includes("GROUP BY feature")) {
        return {
          rows: [
            { feature: "patient_assistant", count: "1" },
            { feature: "document_sync", count: "1" },
          ],
        };
      }
      if (sql.includes("user_role")) {
        return {
          rows: [
            { role: "patient", count: "1" },
            { role: "admin", count: "1" },
          ],
        };
      }
      if (sql.includes("input_tokens")) {
        return { rows: [{ label: "2026-10-19", input_tokens: "10", output_tokens: "4", total_tokens: "14" }] };
      }
      if (sql.includes("GROUP BY 1")) {
        return { rows: [{ label: "2026-10-19", count: "2" }] };
      }
      throw new Error(sql);
    },
  };
  const usage = await loadAiUsageAnalytics(db, { range: "today" });
  assert.equal(usage.summary.totalRequests, 2);
  assert.equal(usage.summary.successfulRequests, 1);
  assert.equal(usage.summary.failedRequests, 1);
  assert.equal(usage.summary.activeUsers, 2);
  assert.equal(usage.summary.tokensAvailable, true);
  assert.equal(usage.summary.costAvailable, false);
  assert.equal(usage.byFeature.length, 2);
  assert.ok(events.length);
});

test("duplicate request ids do not insert a second analytics row", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 1 }] };
    },
  };
  await recordAiUsage(
    {
      requestId: "req-1",
      feature: "patient_assistant",
      outcome: "success",
      usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
    },
    db
  );
  assert.match(calls[0].sql, /ON CONFLICT \(request_id\)/);
  assert.equal(calls[0].params[0], "req-1");
});

test("analytics export builds PDF and Excel without patient chat content", async () => {
  const data = {
    generatedAt: "2026-10-19T12:00:00.000Z",
    periodLabel: "This Year",
    summary: {
      totalRevenue: 1000,
      patientSatisfaction: 90,
      totalAppointments: 4,
      completedAppointments: 3,
      cancelledAppointments: 0,
      noShowAppointments: 1,
      patientGrowth: 2,
      queueActive: 1,
      queueCompleted: 3,
      averageWaitMinutes: 8,
    },
    revenueByPeriod: [{ label: "2026-01", value: 1000 }],
    appointmentBreakdown: { completed: 3, pending: 0, cancelled: 0, no_show: 1, confirmed: 0, checked_in: 0 },
    patientVolume: [{ label: "2026-10-19", count: 2 }],
    patientGrowth: [{ label: "2026-10", count: 2 }],
    dentistPerformance: [{ dentist: "Dr Cruz", completed: 3, total: 4 }],
    queuePerformance: { active: 1, completed: 3, averageWaitMinutes: 8 },
    aiUsage: {
      trackingAvailable: true,
      trackingStartedAt: "2026-10-19T02:00:00.000Z",
      periodLabel: "This Year",
      summary: {
        totalRequests: 2,
        successfulRequests: 1,
        failedRequests: 1,
        activeUsers: 2,
        tokensAvailable: false,
        costAvailable: false,
      },
      requestsOverTime: [{ label: "2026-10-19", count: 2 }],
      byFeature: [{ label: "Patient AI Assistant", count: 2 }],
      tokensOverTime: [],
      byRole: [{ role: "patient", count: 2 }],
    },
  };

  const pdf = await renderAdminAnalyticsExport(data, "pdf");
  assert.equal(pdf.filename, "DentaSync_General_Analytics_2026-10-19.pdf");
  assert.match(pdf.contentType, /pdf/);
  assert.ok(pdf.buffer.length > 100);
  assert.doesNotMatch(pdf.buffer.toString("latin1"), /password|GEMINI_API_KEY|Tell me about/i);

  const xlsx = await renderAdminAnalyticsExport(data, "xlsx");
  assert.equal(xlsx.filename, "DentaSync_General_Analytics_2026-10-19.xlsx");
  assert.match(xlsx.contentType, /spreadsheetml/);
  assert.ok(xlsx.buffer.length > 100);
});
