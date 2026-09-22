"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clinicalPatients = require("../services/clinicalPatients");
const {
  estimateWaitForQueueContext,
  expectedMinutesForEntry,
  getPredictionSettings,
  invalidateDurationStatsCache,
} = require("../services/queueWaitPrediction");

function durationDb(proceduresByQueue = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes("clinic_patient_treatments")) {
        const queueId = params[0];
        return { rows: proceduresByQueue[queueId] || [] };
      }
      if (sql.includes("clinic_treatment_durations") || sql.includes("clinic_service_durations")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test("listTreatmentsForVisit returns separate procedure rows in visit order", async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /queue_entry_id/);
      assert.equal(params[0], 101);
      return {
        rows: [
          {
            id: 1,
            treatment: "Oral Prophylaxis",
            visit_sequence: 1,
            queue_entry_id: 101,
            status: "completed",
            tooth_number: null,
          },
          {
            id: 2,
            treatment: "Restoration",
            visit_sequence: 2,
            queue_entry_id: 101,
            status: "planned",
            tooth_number: "14",
          },
          {
            id: 3,
            treatment: "Extraction",
            visit_sequence: 3,
            queue_entry_id: 101,
            status: "planned",
            tooth_number: "36",
          },
        ],
      };
    },
  };

  const rows = await clinicalPatients.listTreatmentsForVisit(db, { queueEntryId: 101 });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].treatment, "Oral Prophylaxis");
  assert.equal(rows[1].treatment, "Restoration");
  assert.equal(rows[1].toothNumber, "14");
  assert.equal(rows[2].treatment, "Extraction");
  assert.notEqual(rows.map((row) => row.treatment).join(", "), "Oral Prophylaxis");
});

test("completeCurrentVisitProcedure promotes the next planned procedure on the same visit", async () => {
  const db = {
    async query(sql) {
      if (sql.includes("FROM clinic_patient_records")) {
        return { rows: [{ id: 12 }] };
      }
      if (sql.includes("SET status = 'completed'")) {
        return {
          rows: [
            {
              id: 1,
              clinical_record_id: 12,
              treatment: "Oral Prophylaxis",
              status: "completed",
              queue_entry_id: 9,
              appointment_id: 5,
              visit_sequence: 1,
            },
          ],
        };
      }
      if (sql.includes("SET status = 'in_progress'")) {
        return {
          rows: [
            {
              id: 2,
              clinical_record_id: 12,
              treatment: "Restoration",
              status: "in_progress",
              queue_entry_id: 9,
              visit_sequence: 2,
              tooth_number: "14",
            },
          ],
        };
      }
      if (sql.startsWith("UPDATE clinic_patient_records")) {
        return { rows: [{ id: 12 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await clinicalPatients.completeCurrentVisitProcedure(
    db,
    "patient-1",
    { queueEntryId: 9, appointmentId: 5 },
    { id: "dentist-1", role: "dentist" }
  );

  assert.equal(result.completed.treatment, "Oral Prophylaxis");
  assert.equal(result.next.treatment, "Restoration");
  assert.equal(result.visitComplete, false);
});

test("remaining visit duration sums in-progress remainder plus pending procedures", async () => {
  invalidateDurationStatsCache();
  const now = new Date("2026-09-22T14:25:00.000Z");
  const db = durationDb({
    2: [
      {
        id: 11,
        treatment: "Restoration",
        status: "in_progress",
        duration_minutes: 45,
        started_at: "2026-09-22T14:00:00.000Z",
        visit_sequence: 1,
        queue_entry_id: 2,
      },
      {
        id: 12,
        treatment: "Crown / Fixed Bridge",
        status: "planned",
        duration_minutes: 90,
        visit_sequence: 2,
        queue_entry_id: 2,
      },
    ],
  });

  const remaining = await expectedMinutesForEntry(db, { id: 2, status: "dentist" }, getPredictionSettings(), now);
  assert.equal(remaining.minutes, 110);
  assert.equal(remaining.procedureCount, 2);
  assert.equal(remaining.source, "visit_procedures");
});

test("completed procedures on the same visit are not counted again", async () => {
  invalidateDurationStatsCache();
  const now = new Date("2026-09-22T15:00:00.000Z");
  const db = durationDb({
    2: [
      {
        id: 1,
        treatment: "Oral Prophylaxis",
        status: "completed",
        duration_minutes: 30,
        visit_sequence: 1,
        queue_entry_id: 2,
      },
      {
        id: 2,
        treatment: "Restoration",
        status: "planned",
        duration_minutes: 45,
        visit_sequence: 2,
        queue_entry_id: 2,
      },
      {
        id: 3,
        treatment: "Crown / Fixed Bridge",
        status: "planned",
        duration_minutes: 90,
        visit_sequence: 3,
        queue_entry_id: 2,
      },
    ],
  });

  const remaining = await expectedMinutesForEntry(db, { id: 2, status: "waiting" }, getPredictionSettings(), now);
  assert.equal(remaining.minutes, 135);
  assert.equal(remaining.procedureCount, 2);
});

test("patients behind a multi-procedure visit wait for the remaining total", async () => {
  invalidateDurationStatsCache();
  const now = new Date("2026-09-22T14:25:00.000Z");
  const db = durationDb({
    2: [
      {
        id: 11,
        treatment: "Restoration",
        status: "in_progress",
        duration_minutes: 45,
        started_at: "2026-09-22T14:00:00.000Z",
        visit_sequence: 1,
        queue_entry_id: 2,
      },
      {
        id: 12,
        treatment: "Crown / Fixed Bridge",
        status: "planned",
        duration_minutes: 90,
        visit_sequence: 2,
        queue_entry_id: 2,
      },
    ],
  });

  const estimate = await estimateWaitForQueueContext(db, {
    now,
    entry: { id: 4, token: "A104", position: 4, status: "waiting" },
    aheadEntries: [{ id: 2, token: "A102", status: "dentist", service_name: "Restoration" }],
  });

  // Remaining restoration 20 + crown 90 = 110. Range 99–126 with default 0.90/1.15.
  assert.equal(estimate.estimatedWaitMinutes.min, 99);
  assert.equal(estimate.estimatedWaitMinutes.max, 126);
  assert.equal(estimate.estimatedDurationMinutes, 35);
});
