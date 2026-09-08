"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clinicalPatients = require("../services/clinicalPatients");

test("parseMoneyAmount accepts non-negative money values", () => {
  assert.equal(clinicalPatients.parseMoneyAmount("1500", "Amount Charged"), 1500);
  assert.equal(clinicalPatients.parseMoneyAmount("1,500.50", "Amount Paid"), 1500.5);
  assert.equal(clinicalPatients.parseMoneyAmount("", "Amount Charged"), 0);
});

test("parseMoneyAmount rejects invalid money values", () => {
  assert.throws(() => clinicalPatients.parseMoneyAmount("-1", "Amount Charged"), /non-negative/);
  assert.throws(() => clinicalPatients.parseMoneyAmount("abc", "Amount Paid"), /non-negative/);
});

test("updateClinicalTreatment updates existing treatment amounts", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM clinic_patient_treatments") && sql.includes("LIMIT 1")) {
        return {
          rows: [
            {
              id: 9,
              clinical_record_id: 3,
              treatment: "Dental Cleaning",
              treatment_date: "2026-06-01",
              amount_charged: 1000,
              amount_paid: 500,
            },
          ],
        };
      }
      if (sql.startsWith("UPDATE clinic_patient_treatments")) {
        return {
          rows: [
            {
              id: 9,
              clinical_record_id: 3,
              treatment: params[0],
              treatment_date: params[1],
              amount_charged: params[2],
              amount_paid: params[3],
              dentist_name: "Dr Test",
              status: "completed",
              notes: "",
              created_at: "2026-06-01T00:00:00.000Z",
              updated_at: "2026-06-05T00:00:00.000Z",
              updated_by: "admin-1",
            },
          ],
        };
      }
      if (sql.startsWith("UPDATE clinic_patient_records")) {
        return { rows: [{ id: 3 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const updated = await clinicalPatients.updateClinicalTreatment(
    db,
    3,
    9,
    {
      treatment: "Dental Cleaning",
      treatmentDate: "2026-06-05",
      amountCharged: 1500,
      amountPaid: 1500,
    },
    { id: "admin-1", role: "admin" }
  );

  assert.equal(updated.treatment, "Dental Cleaning");
  assert.equal(updated.amountCharged, 1500);
  assert.equal(updated.amountPaid, 1500);
  assert.equal(updated.treatmentDate, "2026-06-05");
  assert.ok(calls.some((call) => call.sql.startsWith("UPDATE clinic_patient_treatments")));
});
