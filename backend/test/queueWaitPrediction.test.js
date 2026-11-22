"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  aheadEntriesFor,
  createPredictionService,
  estimateWaitForQueueContext,
  remainingServingMinutes,
  waitEstimateFromRow,
  getHistoricalDurationStats,
  invalidateDurationStatsCache,
  publicWaitEstimate,
} = require("../services/queueWaitPrediction");
const { estimateWaitMinutesForPosition } = require("../services/waitTime");

test("waitEstimateFromRow exposes remaining treatment time for a serving patient", () => {
  const estimate = waitEstimateFromRow({
    token: "A-001",
    position: 1,
    status: "dentist",
    wait_estimate_duration_minutes: 40,
    wait_estimate_min_minutes: 0,
    wait_estimate_max_minutes: 0,
    wait_estimate_at: "2026-09-22T14:25:00.000Z",
    serving_started_at: "2026-09-22T14:00:00.000Z",
  });
  assert.ok(estimate.remainingTreatmentMinutes);
  assert.equal(estimate.remainingTreatmentMinutes.min <= estimate.remainingTreatmentMinutes.max, true);
});

test("remaining serving time subtracts elapsed recorded treatment progress only", () => {
  const now = new Date("2026-09-22T14:25:00.000Z");
  const remaining = remainingServingMinutes(
    { status: "dentist", treatment_started_at: "2026-09-22T14:00:00.000Z" },
    40,
    now
  );
  assert.equal(remaining, 15);
  const queueStampOnly = remainingServingMinutes(
    { status: "dentist", serving_started_at: "2026-09-22T14:00:00.000Z" },
    40,
    now
  );
  assert.equal(queueStampOnly, 40);
  const overdue = remainingServingMinutes(
    { status: "dentist", treatment_started_at: "2026-09-22T13:00:00.000Z" },
    40,
    now
  );
  assert.equal(overdue, 1);
});

test("in-chair patients without a start stamp keep the stored procedure length", async () => {
  const db = {
    async query() {
      throw new Error("Should not look up catalog duration for in-chair patients with a known length");
    },
  };
  const wait = await estimateWaitMinutesForPosition(db, {
    position: 2,
    aheadEntries: [{ status: "dentist", estimated_wait_minutes: 40, service_name: "Cleaning" }],
  });
  assert.equal(wait, 40);
});

test("A104 wait uses remaining A101 plus full A102 and A103", async () => {
  invalidateDurationStatsCache();
  const now = new Date("2026-09-22T15:00:00.000Z");
  const db = {
    async query(sql, params) {
      if (sql.includes("clinic_treatment_durations")) {
        return {
          rows: [
            ...Array.from({ length: 5 }, () => ({ procedure_type: "Oral Prophylaxis", duration_minutes: 30 })),
            ...Array.from({ length: 5 }, () => ({ procedure_type: "Restoration", duration_minutes: 45 })),
            ...Array.from({ length: 5 }, () => ({ procedure_type: "Extraction", duration_minutes: 40 })),
          ],
        };
      }
      if (sql.includes("clinic_patient_treatments")) return { rows: [] };
      if (sql.includes("clinic_service_durations")) return { rows: [] };
      return { rows: [], params };
    },
  };

  const estimate = await estimateWaitForQueueContext(db, {
    now,
    entry: { token: "A104", position: 4, status: "waiting", service_name: "Restoration" },
    aheadEntries: [
      {
        token: "A101",
        status: "dentist",
        service_name: "Oral Prophylaxis",
        serving_started_at: "2026-09-22T14:45:00.000Z",
      },
      { token: "A102", status: "waiting", service_name: "Restoration" },
      { token: "A103", status: "waiting", service_name: "Extraction" },
    ],
  });

  // Full remaining 30 (prophy, no recorded start) + 45 + 40 = 115. Range 104–132.
  assert.equal(estimate.estimatedWaitMinutes.min, 104);
  assert.equal(estimate.estimatedWaitMinutes.max, 132);
  assert.equal(estimate.estimationMethod, "historical_average_v1");
  assert.equal(estimate.patientsAhead, 3);
  const published = publicWaitEstimate(estimate);
  assert.equal(published.estimationMethod, undefined);
  assert.match(published.estimatedCallTime.start, /T/);
});

test("unknown procedure is unavailable instead of inventing a wait", async () => {
  invalidateDurationStatsCache();
  const db = {
    async query(sql) {
      if (sql.includes("clinic_treatment_durations") || sql.includes("clinic_patient_treatments")) {
        return { rows: [] };
      }
      if (sql.includes("clinic_service_durations")) return { rows: [] };
      return { rows: [] };
    },
  };
  const estimate = await estimateWaitForQueueContext(db, {
    now: new Date("2026-09-22T15:00:00.000Z"),
    entry: { token: "A105", position: 2, status: "waiting" },
    aheadEntries: [{ token: "A101", status: "waiting" }],
  });
  assert.equal(estimate.unavailable, true);
  assert.equal(estimate.estimatedWaitMinutes, null);
  assert.equal(estimate.confidenceLevel, "low");
});

test("historical stats require a minimum sample count before dropping fallback", async () => {
  invalidateDurationStatsCache();
  const db = {
    async query(sql) {
      if (sql.includes("clinic_treatment_durations")) {
        return {
          rows: [
            { procedure_type: "Restoration", duration_minutes: 42 },
            { procedure_type: "Restoration", duration_minutes: 47 },
          ],
        };
      }
      if (sql.includes("clinic_patient_treatments")) return { rows: [] };
      return { rows: [] };
    },
  };
  const stats = await getHistoricalDurationStats(db, "Restoration");
  assert.equal(stats.usedFallback, true);
  assert.ok(stats.sampleCount < 5);
});

test("ahead entries stay in the assigned dentist lane", () => {
  const ordered = [
    { id: 1, token: "A-001", dentist_id: "d1", status: "dentist", position: 1, appointment_time: "09:00" },
    { id: 2, token: "A-002", dentist_id: "d2", status: "waiting", position: 2, appointment_time: "09:15" },
    { id: 3, token: "A-003", dentist_id: "d1", status: "waiting", position: 3, appointment_time: "09:30" },
  ];
  assert.deepEqual(
    aheadEntriesFor(ordered[2], ordered).map((row) => row.token),
    ["A-001"]
  );
  assert.deepEqual(aheadEntriesFor(ordered[1], ordered).map((row) => row.token), []);
});

test("uncertainty range is configurable on the prediction service", () => {
  const service = createPredictionService({ lowerFactor: 0.8, upperFactor: 1.25 });
  const range = service.predictor.rangeFrom(100, { usedFallback: true, sampleCount: 0, averageMinutes: 100 });
  assert.equal(range.min, 80);
  assert.equal(range.max, 125);
});
