"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clinicalPatients = require("../services/clinicalPatients");

test("completeInProgressTreatmentForUser finalizes the matching in-progress row", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM clinic_patient_records")) {
        return { rows: [{ id: 12 }] };
      }
      if (sql.startsWith("UPDATE clinic_patient_treatments")) {
        return {
          rows: [
            {
              id: 77,
              clinical_record_id: 12,
              treatment: "Composite filling",
              dentist_name: "Dr Cruz",
              clinic_location: "Amethyst Dental Clinic",
              coverage_status: null,
              status: "completed",
              treatment_date: "2026-09-18",
              notes: "",
              duration_minutes: params[0],
              amount_charged: 1500,
              amount_paid: 0,
              appointment_id: 5,
              created_at: "2026-09-18T01:00:00.000Z",
              updated_at: "2026-09-18T02:00:00.000Z",
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

  const completed = await clinicalPatients.completeInProgressTreatmentForUser(
    db,
    "patient-1",
    { appointmentId: 5, durationMinutes: 45 },
    { id: "dentist-1", role: "dentist" }
  );

  assert.equal(completed.status, "completed");
  assert.equal(completed.durationMinutes, 45);
  assert.equal(completed.treatment, "Composite filling");
  assert.ok(calls.some((call) => call.sql.includes("status = 'completed'")));
});

test("completeInProgressTreatmentForUser returns null when no clinical record exists", async () => {
  const db = {
    async query() {
      return { rows: [] };
    },
  };

  const completed = await clinicalPatients.completeInProgressTreatmentForUser(db, "missing-user", {
    appointmentId: 9,
  });
  assert.equal(completed, null);
});
