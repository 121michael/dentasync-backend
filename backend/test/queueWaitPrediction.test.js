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
  assert.equal(queueStampOnly, 15);
  const overdue = remainingServingMinutes(
    { status: "dentist", treatment_started_at: "2026-09-22T13:00:00.000Z" },
    40,
    now
  );
  assert.equal(overdue, 0);
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

  // Remaining 15 of 30-minute prophylaxis + 45 + 40 = 100.
  assert.equal(estimate.estimatedWaitMinutes.min, 100);
  assert.equal(estimate.estimatedWaitMinutes.max, 100);
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

function proceduresDb(byQueue) {
  return {
    async query(sql, params = []) {
      if (sql.includes("clinic_patient_treatments")) {
        return { rows: byQueue[params[0]] || [] };
      }
      if (sql.includes("clinic_treatment_durations") || sql.includes("clinic_service_durations")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test("next patient waits remaining chair time, then added procedures, then patients ahead", async () => {
  invalidateDurationStatsCache();
  const now = new Date("2026-11-22T10:08:00.000Z");
  const serving = {
    id: 1,
    token: "A-101",
    status: "dentist",
    dentist_id: "d1",
    serving_started_at: "2026-11-22T10:00:00.000Z",
  };
  const firstWaiting = { id: 2, token: "A-102", status: "waiting", dentist_id: "d1" };
  const secondWaiting = { id: 3, token: "A-103", status: "waiting", dentist_id: "d1" };

  const eightMinutesLeft = proceduresDb({
    1: [
      {
        id: 11,
        treatment: "Cleaning",
        status: "in_progress",
        duration_minutes: 8,
        started_at: "2026-11-22T10:08:00.000Z",
        visit_sequence: 1,
        queue_entry_id: 1,
      },
    ],
    2: [
      {
        id: 21,
        treatment: "Exam",
        status: "planned",
        duration_minutes: 10,
        visit_sequence: 1,
        queue_entry_id: 2,
      },
    ],
    3: [
      {
        id: 31,
        treatment: "Filling",
        status: "planned",
        duration_minutes: 15,
        visit_sequence: 1,
        queue_entry_id: 3,
      },
    ],
  });

  const next = await estimateWaitForQueueContext(eightMinutesLeft, {
    now,
    entry: firstWaiting,
    aheadEntries: [serving],
  });
  assert.equal(next.estimatedWaitMinutes.min, 8);
  assert.equal(next.unavailable, false);
  assert.equal(next.treatmentOverrun, false);

  const later = await estimateWaitForQueueContext(eightMinutesLeft, {
    now,
    entry: secondWaiting,
    aheadEntries: [serving, firstWaiting],
  });
  assert.equal(later.estimatedWaitMinutes.min, 18);

  const withExtra = proceduresDb({
    1: [
      {
        id: 11,
        treatment: "Cleaning",
        status: "in_progress",
        duration_minutes: 8,
        started_at: "2026-11-22T10:08:00.000Z",
        visit_sequence: 1,
        queue_entry_id: 1,
      },
      {
        id: 12,
        treatment: "X-ray",
        status: "planned",
        duration_minutes: 12,
        visit_sequence: 2,
        queue_entry_id: 1,
      },
    ],
    2: [
      {
        id: 21,
        treatment: "Exam",
        status: "planned",
        duration_minutes: 10,
        visit_sequence: 1,
        queue_entry_id: 2,
      },
    ],
    3: [
      {
        id: 31,
        treatment: "Filling",
        status: "planned",
        duration_minutes: 15,
        visit_sequence: 1,
        queue_entry_id: 3,
      },
    ],
  });

  const nextAfterAdd = await estimateWaitForQueueContext(withExtra, {
    now,
    entry: firstWaiting,
    aheadEntries: [serving],
  });
  assert.equal(nextAfterAdd.estimatedWaitMinutes.min, 20);

  const laterAfterAdd = await estimateWaitForQueueContext(withExtra, {
    now,
    entry: secondWaiting,
    aheadEntries: [serving, firstWaiting],
  });
  assert.equal(laterAfterAdd.estimatedWaitMinutes.min, 30);
});

test("overrun chair time is not Now, cancelled and completed procedures are ignored, and booked names are not doubled", async () => {
  invalidateDurationStatsCache();
  const now = new Date("2026-11-22T10:20:00.000Z");
  const serving = { id: 1, token: "A-101", status: "dentist", dentist_id: "d1" };
  const waiting = { id: 2, token: "A-102", status: "waiting", dentist_id: "d1", service_name: "Cleaning" };

  const overrun = await estimateWaitForQueueContext(
    proceduresDb({
      1: [
        {
          id: 11,
          treatment: "Cleaning",
          status: "in_progress",
          duration_minutes: 8,
          started_at: "2026-11-22T10:00:00.000Z",
          visit_sequence: 1,
          queue_entry_id: 1,
        },
      ],
    }),
    { now, entry: waiting, aheadEntries: [serving] }
  );
  assert.equal(overrun.treatmentOverrun, true);
  assert.equal(overrun.estimatedWaitMinutes, null);
  assert.equal(overrun.unavailable, false);

  const cleaned = await estimateWaitForQueueContext(
    proceduresDb({
      1: [
        {
          id: 11,
          treatment: "Cleaning",
          status: "completed",
          duration_minutes: 8,
          visit_sequence: 1,
          queue_entry_id: 1,
        },
        {
          id: 12,
          treatment: "Whitening",
          status: "cancelled",
          duration_minutes: 40,
          visit_sequence: 2,
          queue_entry_id: 1,
        },
        {
          id: 13,
          treatment: "Exam",
          status: "planned",
          duration_minutes: 10,
          visit_sequence: 3,
          queue_entry_id: 1,
        },
      ],
    }),
    { now, entry: waiting, aheadEntries: [serving] }
  );
  assert.equal(cleaned.estimatedWaitMinutes.min, 10);

  const missing = await estimateWaitForQueueContext(
    proceduresDb({
      1: [
        {
          id: 11,
          treatment: "Mystery",
          status: "in_progress",
          duration_minutes: null,
          visit_sequence: 1,
          queue_entry_id: 1,
        },
      ],
    }),
    { now, entry: waiting, aheadEntries: [serving] }
  );
  assert.equal(missing.unavailable, true);
  assert.equal(missing.estimatedWaitMinutes, null);
});
