"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clinicalPatients = require("../services/clinicalPatients");

test("formatAgeSex combines age and sex in one column", () => {
  assert.equal(clinicalPatients.formatAgeSex(21, "Male"), "21 / Male");
  assert.equal(clinicalPatients.formatAgeSex(19, "Female"), "19 / Female");
  assert.equal(clinicalPatients.formatAgeSex(null, "Male"), "— / Male");
  assert.equal(clinicalPatients.formatAgeSex(30, null), "30 / —");
});

test("deriveDateOfBirthFromAge preserves month/day when possible", () => {
  const dob = clinicalPatients.deriveDateOfBirthFromAge(21, "2000-06-15");
  assert.match(dob, /^\d{4}-06-15$/);
  const ageApprox = new Date().getFullYear() - Number(dob.slice(0, 4));
  assert.ok(ageApprox === 21 || ageApprox === 20 || ageApprox === 22);
});

test("resolveClinicalNextAppointment prefers staff-saved clinical date", () => {
  const next = clinicalPatients.resolveClinicalNextAppointment(
    {
      nextAppointmentDate: "2099-10-05",
      nextAppointmentTime: "10:00",
    },
    [
      {
        id: 9,
        date: "2099-11-01",
        time: "09:00",
        status: "confirmed",
        treatment: "Cleaning",
      },
    ]
  );
  assert.equal(next.date, "2099-10-05");
  assert.equal(next.time, "10:00");
  assert.equal(next.source, "clinical_record");
});

test("updateTreatmentAmountPaid updates only amount_paid", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM clinic_patient_treatments") && sql.includes("LIMIT 1")) {
        return {
          rows: [
            {
              id: 5,
              clinical_record_id: 2,
              treatment: "Tooth Extraction",
              amount_charged: 1500,
              amount_paid: 0,
              status: "completed",
              treatment_date: "2026-09-18",
            },
          ],
        };
      }
      if (sql.startsWith("UPDATE clinic_patient_treatments")) {
        return {
          rows: [
            {
              id: 5,
              clinical_record_id: 2,
              treatment: "Tooth Extraction",
              dentist_name: "Dr Cruz",
              clinic_location: "Amethyst Dental Clinic",
              coverage_status: null,
              status: "completed",
              treatment_date: "2026-09-18",
              notes: "",
              amount_charged: 1500,
              amount_paid: params[0],
              created_at: "2026-09-18T00:00:00.000Z",
              updated_at: "2026-09-18T01:00:00.000Z",
            },
          ],
        };
      }
      if (sql.startsWith("UPDATE clinic_patient_records")) {
        return { rows: [{ id: 2 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const updated = await clinicalPatients.updateTreatmentAmountPaid(
    db,
    2,
    5,
    "1500",
    { id: "staff-1", role: "staff" }
  );
  assert.equal(updated.amountPaid, 1500);
  assert.equal(updated.amountCharged, 1500);
  assert.ok(calls.some((call) => call.sql.includes("amount_paid = $1")));
});
